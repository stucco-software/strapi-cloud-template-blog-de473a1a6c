'use strict';

const { chapterScopedResource } = require('../services/resource-factory');
// ScopeError must be obtained by direct require, never via strapi.service(...).
// Strapi's loadFiles deletes the require cache per file, so a service-registry
// lookup can hand back a DIFFERENT class object and `instanceof` silently fails.
const {
  ScopeError, resolveAuthority, assertChapterScope, assertChapterScopeFor,
} = require('../services/scope');
const { assertCapability } = require('../services/capabilities');
const { SlugError } = require('../services/slug');
const { BadInputError, pickWhitelisted } = require('../services/fields');
const {
  toDirectoryRow, toRosterRow, normaliseMemberIds, assertMembersInChapter,
  resolveMemberRowIds, ROSTER_FIELDS,
} = require('../services/members');
const { uploadImage } = require('../services/media');
const { normaliseUrl } = require('../services/safe-url');
const {
  toPartnerRow, normalisePartnerIds, findPartnerGroups,
} = require('../services/partners');
const {
  editableFieldsFor, isPlainBlocks, shapeComponentEdit, findPageZones,
  blocksToText, sameForFields, ctaSlotsFor, shapeCtaEdit, CMPS_TABLE, mediaSlotFor,
  photoSlotFor, normalisePhotoIds,
  memberSlotFor,
} = require('../services/page-content');

// Mirrors api::event.event minus `chapter` and `slug`, both set at create and
// immutable after.
const events = chapterScopedResource({
  uid: 'api::event.event',
  hasSlug: true,
  // `figure` is a media relation, so it is absent from list rows unless
  // populated. The authoring UI reads it to show the current image.
  listPopulate: { figure: { fields: ['url', 'name'] } },
  editableFields: [
    'title', 'startsAt', 'endsAt', 'description',
    'memberPrice', 'publicPrice', 'location', 'locationUrl', 'figure',
  ],
});

// Committees. No slug field on this type, so hasSlug stays false. `members` is
// writable but every id is normalised and then checked against the chapter's
// own membership before it reaches the write.
const committees = chapterScopedResource({
  uid: 'api::committee.committee',
  editableFields: ['name', 'description', 'members'],
  listPopulate: { members: { fields: ['firstName', 'lastName', 'displayName', 'title'] } },
  requiredFields: ['name'],
  async validateData(data, { chapterDocumentId, strapi }) {
    // Absent means unchanged; [] means clear. Only touch it when present.
    if (!('members' in data)) return;
    const ids = normaliseMemberIds(data.members);              // BadInputError -> 400
    await assertMembersInChapter(strapi, chapterDocumentId, ids); // ScopeError -> 403
    data.members = ids.map((documentId) => ({ documentId }));
  },
});

// Sponsorship tiers. Chapter-OWNED: a tier with no `chapter` is national's and
// this API never returns or touches it, so one chapter renaming "Gold" cannot
// rename another's. `rank` orders them on the microsite; ties fall back to name.
const partnerTiers = chapterScopedResource({
  uid: 'api::partner-tier.partner-tier',
  editableFields: ['name', 'rank'],
  requiredFields: ['name'],
  async validateData(data) {
    if (!('rank' in data)) return;
    // An edit form posts every field, so a cleared rank arrives as ''. Treat
    // that as 0 rather than rejecting it — an unranked tier is a real thing,
    // and `rank` is required:true in the schema so null would 500.
    const raw = String(data.rank ?? '').trim();
    if (raw === '') {
      data.rank = 0;
      return;
    }
    const rank = Number(raw);
    if (!Number.isInteger(rank) || rank < 0 || rank > 9999) {
      throw new BadInputError('Rank must be a whole number between 0 and 9999');
    }
    data.rank = rank;
  },
});

// Partners a chapter owns outright — its own sponsors, with its own logos and
// links. National partner rows are NOT editable here: they are shared by every
// chapter and the national sponsor page, so a chapter changing one logo would
// change it everywhere. Those can still be ATTACHED to a microsite through
// updatePartners; this is the create/edit/delete path for a chapter's own.
//
// `logo` is required:true in the schema, and the id comes from the media
// endpoint, which owns the magic-byte sniffing and the size cap.
const chapterPartners = chapterScopedResource({
  uid: 'api::partner.partner',
  editableFields: ['name', 'url', 'logo', 'tier'],
  requiredFields: ['name'],
  listPopulate: {
    logo: { fields: ['url', 'name'] },
    // `documentId` explicitly: the edit form's tier <select> submits it, and a
    // `fields` list that omits it leaves the current tier unselected on every
    // row — the form would silently offer to untier a sponsor on save.
    tier: { fields: ['documentId', 'name', 'rank'] },
  },
  async validateData(data, { chapterDocumentId, strapi: s }) {
    if ('url' in data) {
      const raw = String(data.url ?? '').trim();
      // Empty clears it — a sponsor without a link is ordinary.
      if (raw === '') {
        data.url = null;
      } else {
        const safe = normaliseUrl(raw);
        if (!safe) throw new BadInputError('That link is not a valid web address');
        data.url = safe;
      }
    }

    if ('tier' in data) {
      const raw = String(data.tier ?? '').trim();
      if (raw === '') {
        data.tier = null;
      } else {
        // THE hole this closes: without it a chapter admin can file their
        // partner under another chapter's tier, and that chapter's microsite
        // then renders someone else's sponsor under its own heading.
        const tier = await s.documents('api::partner-tier.partner-tier').findOne({
          documentId: raw,
          populate: { chapter: { fields: ['documentId'] } },
          status: 'draft',
        });
        if (!tier) throw new BadInputError('That tier no longer exists');
        if (tier.chapter?.documentId !== chapterDocumentId) {
          throw new ScopeError('That tier belongs to another chapter');
        }
        data.tier = { documentId: raw };
      }
    }
  },
});

// News. `author` is server-set from the session so an admin cannot publish
// under another member's byline. `body` is required:true in the schema.
const news = chapterScopedResource({
  uid: 'api::news-item.news-item',
  hasSlug: true,
  editableFields: ['title', 'excerpt', 'body', 'figure', 'publishedDate'],
  listPopulate: {
    figure: { fields: ['url', 'name'] },
    author: { fields: ['firstName', 'lastName', 'displayName'] },
  },
  requiredFields: ['title', 'body'],
  deriveOnCreate: (ctx) => ({ author: { documentId: ctx.state.user.documentId } }),
});

// Which capability each exported action requires. Populated by `declare`, read
// by tests/unit/grants.test.js — so an action exported without going through
// `declare` fails the suite rather than shipping unguarded.
const DECLARED = {};

/**
 * Capability check, then error translation.
 *
 * `capability` is REQUIRED and asserted before the handler runs. It cannot be
 * defaulted: with the fine-grained check living here rather than in the route
 * table, a handler wrapped without one would be reachable by anyone the coarse
 * role gate lets through.
 *
 * ScopeError -> 403; client-input errors -> 400; everything else surfaces.
 */
const guarded = (capability, handler) => {
  if (!capability) {
    throw new Error('guarded() needs a capability — see plan 8, Task 11');
  }
  return async (ctx) => {
    try {
      const { capabilities } = await resolveAuthority(ctx);
      assertCapability(capabilities, capability);
      return await handler(ctx);
    } catch (err) {
      if (err instanceof ScopeError) return ctx.forbidden(err.message);
      if (err instanceof BadInputError || err instanceof SlugError) {
        return ctx.badRequest(err.message);
      }
      throw err;
    }
  };
};

/** `guarded`, plus recording the declaration for the wiring test. */
const declare = (name, capability, handler) => {
  DECLARED[name] = capability;
  return guarded(capability, handler);
};

// Query params can arrive as string | string[] (repeated keys); take the first,
// matching the `firstStr` helper the users-permissions extension already uses.
const firstStr = (v) => (Array.isArray(v) ? v[0] : v ?? '').toString().trim();

/**
 * Resolve a chapterSlug to a chapter this caller administers.
 *
 * Returns `{ chapter }` on success or `{ error, notFound }` describing how to
 * reject, so the bespoke handlers stop repeating the same six lines. Throws
 * ScopeError -> 403 via `guarded` when the chapter is not administered.
 */
async function resolveScopedChapter(ctx, rawSlug) {
  const { capabilities, chapters } = await resolveAuthority(ctx);
  const chapterSlug = firstStr(rawSlug);
  if (!chapterSlug) return { error: 'chapterSlug is required' };

  const chapter = await strapi.documents('api::chapter.chapter').findFirst({
    filters: { slug: chapterSlug }, fields: ['name', 'slug', 'email'], status: 'draft',
  });
  if (!chapter) return { error: 'No such chapter', notFound: true };

  // National Admin is unscoped by decision. The missing-target case above still
  // rejects everyone, national included.
  assertChapterScope(chapters, chapter.documentId, {
    unscoped: capabilities.has('national_admin'),
  });
  return { chapter };
}

/** The `shared.cta` row in one slot of one component, at one status. */
async function ctaIn(strapiInstance, parentType, parentId, slot) {
  const table = CMPS_TABLE[parentType];
  if (!table) return null;
  const row = await strapiInstance.db.connection(table)
    .where({ entity_id: parentId, component_type: 'shared.cta', field: slot })
    .first();
  if (!row) return null;
  return strapiInstance.db.query('shared.cta').findOne({ where: { id: row.cmp_id } });
}

module.exports = {
  getEvent: declare('getEvent', 'chapter_admin', events.getOne),
  listEvents: declare('listEvents', 'chapter_admin', events.list),
  createEvent: declare('createEvent', 'chapter_admin', events.create),
  updateEvent: declare('updateEvent', 'chapter_admin', events.update),
  deleteEvent: declare('deleteEvent', 'chapter_admin', events.delete),

  // Capability-gated but NOT scope-checked: an upload has no owning chapter
  // until a record references it, so there is no target to scope against. The
  // record that references it IS scope-checked, on write.
  //
  // This was a bare handler before plan 8 — the only export that never went
  // through `guarded` — on the assumption that the role gate was the whole
  // check. It no longer is, which is why grants.test.js now diffs the declared
  // map against the exports rather than trusting anyone to remember.
  uploadMedia: declare('uploadMedia', 'chapter_admin', async (ctx) => {
    const file = ctx.request.files?.files;
    if (!file || Array.isArray(file)) {
      return ctx.badRequest('Attach exactly one file under the field name "files"');
    }
    try {
      const uploaded = await uploadImage(file);
      ctx.body = { data: { id: uploaded.id, url: uploaded.url, name: uploaded.name } };
    } catch (err) {
      if (err.name === 'UploadValidationError') return ctx.badRequest(err.message);
      throw err;
    }
  }),

  getCommittee: declare('getCommittee', 'chapter_admin', committees.getOne),
  listCommittees: declare('listCommittees', 'chapter_admin', committees.list),
  createCommittee: declare('createCommittee', 'chapter_admin', committees.create),
  updateCommittee: declare('updateCommittee', 'chapter_admin', committees.update),
  deleteCommittee: declare('deleteCommittee', 'chapter_admin', committees.delete),

  getNewsItem: declare('getNewsItem', 'chapter_admin', news.getOne),
  listNews: declare('listNews', 'chapter_admin', news.list),
  createNews: declare('createNews', 'chapter_admin', news.create),
  updateNews: declare('updateNews', 'chapter_admin', news.update),
  deleteNews: declare('deleteNews', 'chapter_admin', news.delete),

  // --- members -----------------------------------------------------------
  // Read-only. Feeds the committee picker; plan 4 reuses it for the
  // member-group slots. Hand-built rows — see services/members.js.
  listMembers: declare('listMembers', 'chapter_admin', async (ctx) => {
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const rows = await strapi.documents('plugin::users-permissions.user').findMany({
      // `confirmed` matches the established directory filter; without it the
      // picker offers people who have never completed signup.
      filters: {
        chapter: { documentId: chapter.documentId },
        confirmed: true,
        blocked: { $ne: true },
      },
      fields: ['firstName', 'lastName', 'displayName', 'title'],
      sort: ['lastName:asc', 'firstName:asc'],
      limit: -1,
    });

    ctx.body = { data: rows.map(toDirectoryRow) };
  }),

  // --- membership roster -------------------------------------------------
  // Read-only, and a SEPARATE endpoint from listMembers on purpose: that one
  // feeds the committee picker, and widening its response would ship
  // membership status to every screen that opens a picker.
  //
  // Same filters as the picker — `confirmed`, not `blocked` — so the two
  // screens cannot disagree about who belongs to the chapter. An unconfirmed
  // signup is not yet a member, and the directory takes the same view.
  listRoster: declare('listRoster', 'chapter_admin', async (ctx) => {
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const rows = await strapi.documents('plugin::users-permissions.user').findMany({
      filters: {
        chapter: { documentId: chapter.documentId },
        confirmed: true,
        blocked: { $ne: true },
      },
      fields: ROSTER_FIELDS,
      populate: { image: { fields: ['url'] } },
      sort: ['lastName:asc', 'firstName:asc'],
      limit: -1,
    });

    // The count ships alongside: the screen states the roster size, and
    // deriving it from a list the client may later paginate is how a total
    // starts quietly meaning "rows on this page".
    ctx.body = { data: rows.map(toRosterRow), meta: { total: rows.length } };
  }),

  // --- chapter settings --------------------------------------------------
  getChapter: declare('getChapter', 'chapter_admin', async (ctx) => {
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    // Hand-built: `administrators` must never ship, or chapter admins can see
    // (and eventually appoint) each other.
    ctx.body = { data: { documentId: chapter.documentId, name: chapter.name,
      slug: chapter.slug, email: chapter.email ?? '' } };
  }),

  updateChapter: declare('updateChapter', 'chapter_admin', async (ctx) => {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, input.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    // `slug` is absent from this whitelist deliberately: it is a uid that will
    // not regenerate, and already-written event slug prefixes would not follow
    // it if it did.
    //
    // `name` is absent for a different reason: the chapter's name is national's
    // to set, not a chapter admin's. It appears on the national chapter list,
    // in the member directory's chapter filter and on every member's profile,
    // so a chapter renaming itself changes copy across the whole site. The
    // field stays READ-ONLY in the admin UI and is rejected here too — the UI
    // is a courtesy, this is the boundary.
    const data = pickWhitelisted(input, ['email']);

    // `chapter.email` is an `email` attribute: Strapi rejects '' with "email
    // cannot be empty" (400) but accepts null. Without this an admin who empties
    // the field gets a generic save error and can never clear it.
    if ('email' in data && data.email === '') data.email = null;

    ctx.body = { data: await strapi.documents('api::chapter.chapter').update({
      documentId: chapter.documentId, data, status: 'published',
    }) };
  }),

  // --- submissions -------------------------------------------------------
  // form-submission is draftAndPublish:FALSE, so no status flag anywhere here.
  listSubmissions: declare('listSubmissions', 'chapter_admin', async (ctx) => {
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const rows = await strapi.documents('api::form-submission.form-submission').findMany({
      filters: { chapter: { documentId: chapter.documentId } },
      populate: { chapter: { fields: ['name', 'slug'] } },
      sort: ['submittedAt:desc'],
      limit: 200,   // see Known limitations — no pagination on this screen yet
    });
    ctx.body = { data: rows };
  }),

  updateSubmission: declare('updateSubmission', 'chapter_admin', async (ctx) => {
    const { documentId } = ctx.params;

    const record = await strapi.documents('api::form-submission.form-submission').findOne({
      documentId, populate: { chapter: { fields: ['slug'] } },
    });
    if (!record) return ctx.notFound();
    // `?? null` is load-bearing: a submission from the NATIONAL contact form has
    // no chapter, and a missing target throws for everyone — national admins
    // included. Those live in the Strapi admin panel, not here.
    await assertChapterScopeFor(ctx, record.chapter?.documentId ?? null);

    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    ctx.body = { data: await strapi.documents('api::form-submission.form-submission').update({
      documentId, data: { handled: Boolean(input.handled) },
    }) };
  }),

  // --- partners ----------------------------------------------------------
  // Partner records are SHARED and are never written here (CA7): a Partner row
  // appears on every chapter that uses it. This endpoint reads the catalogue
  // and writes the chapter home page's partner-group component relation —
  // which is what the public microsite actually renders. `chapter.partners`
  // exists but has no reader; see the plan's revision note.
  // --- sponsorship tiers -------------------------------------------------
  // A chapter's own tier structure and labels. National tiers (chapter null)
  // are invisible here by construction — the factory scopes every read and
  // write to the caller's chapter.
  listTiers: declare('listTiers', 'chapter_admin', partnerTiers.list),
  getTier: declare('getTier', 'chapter_admin', partnerTiers.getOne),
  createTier: declare('createTier', 'chapter_admin', partnerTiers.create),
  updateTier: declare('updateTier', 'chapter_admin', partnerTiers.update),
  deleteTier: declare('deleteTier', 'chapter_admin', partnerTiers.delete),

  // --- the chapter's own partners ----------------------------------------
  // Distinct from listPartners/updatePartners below, which are about the
  // national catalogue and which of it appears on the microsite. These own the
  // rows themselves: a chapter's sponsors, its logos, its links.
  listOwnPartners: declare('listOwnPartners', 'chapter_admin', chapterPartners.list),
  getOwnPartner: declare('getOwnPartner', 'chapter_admin', chapterPartners.getOne),
  createOwnPartner: declare('createOwnPartner', 'chapter_admin', chapterPartners.create),
  updateOwnPartner: declare('updateOwnPartner', 'chapter_admin', chapterPartners.update),
  deleteOwnPartner: declare('deleteOwnPartner', 'chapter_admin', chapterPartners.delete),

  listPartners: declare('listPartners', 'chapter_admin', async (ctx) => {
    // Scope-checked even though the catalogue is global: the screen belongs to
    // a chapter, and answering for one the caller cannot administer would leak
    // which chapters exist.
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    // National rows PLUS this chapter's own — never another chapter's.
    //
    // This filter became load-bearing the moment partners could be
    // chapter-owned: an unfiltered catalogue now hands every chapter's sponsor
    // list to every chapter admin, and offers them for attaching.
    const rows = await strapi.documents('api::partner.partner').findMany({
      filters: {
        $or: [
          { chapter: { documentId: { $null: true } } },
          { chapter: { documentId: chapter.documentId } },
        ],
      },
      fields: ['name', 'sponsorshipLevel'],
      populate: {
        logo: { fields: ['url'] },
        chapter: { fields: ['documentId'] },
        tier: { fields: ['name', 'rank'] },
      },
      sort: ['name:asc'],
      limit: -1,
      status: 'draft',
    });

    // The chapter's current selection, read off the DRAFT component so it
    // matches what a subsequent save will replace.
    // findPartnerGroups guarantees a draft slot whenever it returns no error,
    // so `attached` is never silently [] while a slot exists somewhere.
    const found = await findPartnerGroups(strapi, chapter.slug);
    let attached = [];
    if (!found.error) {
      const cmp = await strapi.db.query('shared.partner-group').findOne({
        where: { id: found.groups.draft }, populate: { partners: true },
      });
      attached = (cmp?.partners ?? []).map((p) => p.documentId);
    }

    ctx.body = {
      data: rows.map(toPartnerRow),
      meta: { attached, slot: found.error ?? 'ok' },
    };
  }),

  updatePartners: declare('updatePartners', 'chapter_admin', async (ctx) => {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, input.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const ids = normalisePartnerIds(input.partners);   // BadInputError -> 400

    // Every id must name a real partner. A documentId matching nothing would be
    // silently dropped by the relation write, so the admin would watch a
    // partner vanish with no explanation.
    if (ids.length > 0) {
      const found = await strapi.documents('api::partner.partner').findMany({
        filters: { documentId: { $in: ids } }, fields: ['name'], limit: -1, status: 'draft',
      });
      if (found.length !== ids.length) {
        return ctx.badRequest('One or more selected partners no longer exist');
      }
    }

    const located = await findPartnerGroups(strapi, chapter.slug);
    if (located.error === 'no-home-page') {
      return ctx.notFound('This chapter has no microsite page yet, so there is nowhere to show partners');
    }
    if (located.error === 'no-partner-group') {
      return ctx.notFound("This chapter's page has no partners section");
    }

    // Write BOTH component rows, resolving partner documentIds to entry ids at
    // the MATCHING status — verified: draft components link to draft partner
    // rows (id 61), published components to published rows (id 62). Getting
    // this wrong links to the correct partner in the wrong publication state.
    for (const [status, componentId] of Object.entries(located.groups)) {
      const rows = ids.length
        ? await strapi.documents('api::partner.partner').findMany({
            filters: { documentId: { $in: ids } }, fields: ['name'], limit: -1, status,
          })
        : [];
      const byDoc = new Map(rows.map((r) => [r.documentId, r.id]));
      // Map in the SUBMITTED order — partner_ord follows the write order.
      const entryIds = ids.map((d) => byDoc.get(d)).filter((v) => v !== undefined);

      await strapi.db.query('shared.partner-group').update({
        where: { id: componentId }, data: { partners: entryIds },
      });
    }

    ctx.body = { data: { chapterSlug: chapter.slug, attached: ids.length } };
  }),

  // --- page text ----------------------------------------------------------
  // Chapter admins edit COPY, never structure. Nothing here writes
  // `page.components`: dynamic zones are replace-on-write, so assigning the
  // array would rewrite every component including ones this screen never
  // rendered. Each save updates one component ROW by id, exactly as the
  // partner-group write does.
  getPage: declare('getPage', 'chapter_admin', async (ctx) => {
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const found = await findPageZones(strapi, chapter.slug);
    if (found.error === 'no-home-page') {
      return ctx.notFound('This chapter has no microsite page yet');
    }

    // Read each draft component row for its current values. The draft is what
    // the admin edits; published is only ever a write target.
    const sections = [];
    for (const pair of found.pairs) {
      const fields = editableFieldsFor(pair.type);
      const slot = mediaSlotFor(pair.type);
      const roster = memberSlotFor(pair.type);
      const photoSlot = photoSlotFor(pair.type);
      const row = await strapi.db.query(pair.type).findOne({
        where: { id: pair.draftId },
        populate: {
          ...(slot ? { [slot]: true } : {}),
          ...(roster ? { [roster]: true } : {}),
          ...(photoSlot ? { [photoSlot]: true } : {}),
        },
      });

      // `body` is editable only when a plain textarea can round-trip it.
      // blocksToPlainText flattens headings, lists and links, so offering a
      // textarea over rich content would silently strip a national author's
      // formatting on the next save.
      const bodyIsRich = fields.includes('body') && !isPlainBlocks(row?.body);
      const editable = bodyIsRich ? fields.filter((f) => f !== 'body') : fields;

      sections.push({
        index: pair.index,
        type: pair.type,
        draftId: pair.draftId,
        editable,
        readOnlyReason:
          editable.length === 0 ? 'not-editable' : bodyIsRich ? 'rich-body' : null,
        values: Object.fromEntries(
          editable.map((f) => [f, f === 'body' ? blocksToText(row?.body) : (row?.[f] ?? '')])),
        ctas: await Promise.all(ctaSlotsFor(pair.type).map(async (ctaSlot) => {
          const cta = await ctaIn(strapi, pair.type, pair.draftId, ctaSlot);
          return cta ? { slot: ctaSlot, label: cta.label ?? '', href: cta.href ?? '' } : null;
        })).then((list) => list.filter(Boolean)),
        image: slot ? { slot, url: row?.[slot]?.url ?? null } : null,
        // The roster the microsite renders under this heading. documentIds, to
        // match the picker every other screen posts.
        members: roster
          ? { slot: roster, selected: (row?.[roster] ?? []).map((m) => m.documentId) }
          : null,
        // The gallery's current photos, IN ORDER — the editor renders them as
        // the list it reorders and removes from, so it needs the url to show
        // and the id to post back. Row ids, not documentIds: media files are
        // not documents, and `figureId` on the same screen is already a row id.
        photos: photoSlot
          ? {
            slot: photoSlot,
            items: (row?.[photoSlot] ?? []).map((f) => ({
              id: f.id,
              url: f.url,
              alt: f.alternativeText ?? '',
              name: f.name ?? '',
              width: f.width ?? null,
              height: f.height ?? null,
            })),
          }
          : null,
      });
    }

    ctx.body = {
      data: sections,
      meta: { structureDiverged: found.structureDiverged },
    };
  }),

  updatePage: declare('updatePage', 'chapter_admin', async (ctx) => {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, input.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const found = await findPageZones(strapi, chapter.slug);
    if (found.error === 'no-home-page') {
      return ctx.notFound('This chapter has no microsite page yet');
    }

    // Address the component by its POSITION in the zone, not by a raw component
    // id from the payload. A client-supplied id could name a component on
    // another chapter's page — position is meaningless outside this zone, so it
    // cannot be pointed anywhere else.
    //
    // Validate BEFORE coercing. `Number(null)`, `Number('')` and `Number(false)`
    // are all 0, and index 0 is the hero — so a dropped or malformed field
    // would rewrite the page's headline at both statuses and return 200.
    // Verified reachable: {index: null} rewrote the hero. The client-side
    // mapper guards this too, but the server is the boundary.
    // An empty or blank string is the trap: it passes a bare typeof check and
    // Number('') is 0, which is the hero. Reject it explicitly.
    const rawIndex = input.index;
    const indexIsUsable =
      typeof rawIndex === 'number' ||
      (typeof rawIndex === 'string' && rawIndex.trim() !== '');
    if (!indexIsUsable) return ctx.badRequest('No such section on this page');
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0) {
      return ctx.badRequest('No such section on this page');
    }
    const pair = found.pairs.find((p) => p.index === index);
    if (!pair) return ctx.badRequest('No such section on this page');

    const row = await strapi.db.query(pair.type).findOne({ where: { id: pair.draftId } });
    if (!row) return ctx.notFound('That section no longer exists');

    // Re-check the rich-body guard on WRITE, not just on read. The read that
    // built the form may be minutes old, and a national author may have added
    // formatting since.
    if ('body' in input && !isPlainBlocks(row.body)) {
      return ctx.badRequest(
        'That section now contains formatting this editor would remove. Reload the page.');
    }

    // --- text --------------------------------------------------------------
    // `shapeComponentEdit` THROWS when no whitelisted text field is present.
    // That is correct for plan 5, where text was the only thing a save could
    // carry — but a buttons-only or image-only payload has none, and without
    // this the CTA and image code below is unreachable. Verified: every
    // cta-only save returned `400 Nothing editable was submitted`, three of
    // this plan's own tests failed, and four more passed against a guard that
    // never reached the code they name.
    const hasExtras = Boolean(input.ctas) || input.figureId !== undefined
      || Boolean(input.figure__clear)
      || input.members !== undefined || Boolean(input.members__present)
      || input.photos !== undefined || Boolean(input.photos__present);
    let data = {};
    try {
      data = shapeComponentEdit(input, pair.type);
    } catch (err) {
      if (!(err instanceof BadInputError)) throw err;
      // Only tolerable when the save is carrying something else.
      if (!hasExtras || err.message !== 'Nothing editable was submitted') {
        return ctx.badRequest(err.message);
      }
    }

    // --- buttons -----------------------------------------------------------
    // Each CTA is its own component row, reached through the parent's slot.
    // Same both-statuses write and same parity gate as the text fields: a
    // published CTA that already differs from its draft is an unpublished
    // national edit, and writing it would publish something nobody approved.
    //
    // VALIDATE EVERYTHING BEFORE WRITING ANYTHING. A save carries text, buttons
    // and an image together, and each can fail on its own. Interleaving the
    // checks with the writes means a payload whose SECOND button is malformed
    // has already stored the first when the 400 goes out — the admin sees a
    // failure, reloads, and finds half their edit applied.
    const ctaPlan = [];
    for (const [slot, raw] of Object.entries(input.ctas ?? {})) {
      if (!ctaSlotsFor(pair.type).includes(slot)) {
        return ctx.badRequest('No such button on this section');
      }
      let ctaData;
      try {
        ctaData = shapeCtaEdit(raw);
      } catch (err) {
        if (err instanceof BadInputError) return ctx.badRequest(err.message);
        throw err;
      }

      const draftCta = await ctaIn(strapi, pair.type, pair.draftId, slot);
      if (!draftCta) return ctx.notFound('That button no longer exists');

      const pubCta = pair.publishedId
        ? await ctaIn(strapi, pair.type, pair.publishedId, slot) : null;
      // Same rule as the text: the parity check guards against MISPAIRING, and
      // mispairing is only possible when the zone holds more than one component
      // of this type. On a unique type it froze the button after one save.
      const writeBoth = Boolean(pubCta)
        && (!pair.ambiguous || sameForFields(draftCta, pubCta, Object.keys(ctaData)));

      ctaPlan.push({ slot, ctaData, draftCta, pubCta, writeBoth });
    }

    // --- image -------------------------------------------------------------
    // `figureId` is a media id the /chapter-admin/media endpoint already
    // returned; that endpoint owns the magic-byte sniffing and the size cap, so
    // there is nothing to re-validate here beyond "is it a number".
    //
    // The image gets its OWN parity check, on the figure — not the text's.
    //
    // Neither of the obvious readings works, and an earlier draft asserted all
    // four of them in different places. `sameForFields(row, pubRow,
    // Object.keys(data))` is VACUOUS on an image-only save: `data` is `{}`, so
    // it compares zero fields and returns true. Measured on aloha's hero, whose
    // two statuses are demonstrably diverged, an image-only save changed the
    // PUBLISHED figure and reported 200.
    //
    // Reusing the text's gated `publishedId` is wrong the other way: a diverged
    // heading has nothing to do with the image, and holding the image back
    // because of it makes walkthrough row 4 false.
    //
    // So: compare the figures. Same file on both => they are in step, write
    // both. Different => someone changed one without the other, and publishing
    // is not ours to do.
    // --- roster ------------------------------------------------------------
    // The member-group is what the microsite actually renders for a chapter's
    // committees and boards. Editing an `api::committee` record changes nothing
    // a visitor sees — no public page reads that collection.
    //
    // `members__present` distinguishes "cleared to empty" from "this form did
    // not carry a roster at all". Without it an empty multi-select and an
    // absent field are the same request, and one of them must not wipe.
    const rosterSlot = memberSlotFor(pair.type);
    let rosterIds = null;
    let rosterTargets = [];
    if (input.members__present || input.members !== undefined) {
      if (!rosterSlot) return ctx.badRequest('This section has no member list');
      // BadInputError -> 400, ScopeError -> 403, both via `guarded`. The scope
      // check is the boundary: without it any user documentId at all can be
      // attached and the public microsite then shows them as this chapter's.
      const docIds = normaliseMemberIds(input.members ?? []);
      await assertMembersInChapter(strapi, chapter.documentId, docIds);
      rosterIds = await resolveMemberRowIds(strapi, docIds);

      rosterTargets = [pair.draftId];
      if (pair.publishedId) {
        // Its OWN gate, on its own field — `Object.keys(data)` is empty on a
        // roster-only save, so borrowing the text's comparison would compare
        // nothing and return true.
        const [dRow, pRow] = await Promise.all([
          strapi.db.query(pair.type).findOne({
            where: { id: pair.draftId }, populate: { [rosterSlot]: true } }),
          strapi.db.query(pair.type).findOne({
            where: { id: pair.publishedId }, populate: { [rosterSlot]: true } }),
        ]);
        const ids = (r) => (r?.[rosterSlot] ?? []).map((m) => m.id).join(',');
        if (!pair.ambiguous || ids(dRow) === ids(pRow)) rosterTargets.push(pair.publishedId);
      }
    }

    // --- photos ------------------------------------------------------------
    // The gallery's repeatable list. Written like the roster above and NOT
    // like `figure` below: order is meaningful (it is the grid order), so the
    // whole array goes in one write and `db.query` preserves it.
    //
    // `photos__present` carries the same distinction `members__present` does.
    // An admin who removed the last photo and an admin whose form never had a
    // gallery on it both arrive with no `photos`, and only the first should
    // empty the slot. Without the flag, every text-only save on some OTHER
    // section would read as "clear the photos".
    const photoSlot = photoSlotFor(pair.type);
    let photoIds = null;
    let photoTargets = [];
    if (input.photos__present || input.photos !== undefined) {
      if (!photoSlot) return ctx.badRequest('This section has no photo gallery');
      // BadInputError -> 400 via `guarded`.
      photoIds = normalisePhotoIds(input.photos ?? []);

      photoTargets = [pair.draftId];
      if (pair.publishedId) {
        // Its OWN parity gate, on its own field — the same reasoning as the
        // roster and the figure. `Object.keys(data)` is empty on a photo-only
        // save, so borrowing the text's comparison would compare nothing and
        // wave the published write through.
        //
        // Compare the FILE ids in order, not the join rows: files_related_mph
        // is delete+insert, so its row ids churn on every save and would
        // report divergence after any earlier edit. Order is part of the
        // comparison because a pure reorder IS a difference here.
        const [dRow, pRow] = await Promise.all([
          strapi.db.query(pair.type).findOne({
            where: { id: pair.draftId }, populate: { [photoSlot]: true } }),
          strapi.db.query(pair.type).findOne({
            where: { id: pair.publishedId }, populate: { [photoSlot]: true } }),
        ]);
        const ids = (r) => (r?.[photoSlot] ?? []).map((m) => m.id).join(',');
        if (!pair.ambiguous || ids(dRow) === ids(pRow)) photoTargets.push(pair.publishedId);
      }
    }

    const slotName = mediaSlotFor(pair.type);
    let figureId = null;
    let imageTargets = [];

    // `figure__clear` is the same distinction `members__present` makes below: a
    // form that CLEARED the image and a form that never carried one both arrive
    // with no figureId, and only one of them should detach anything. An absent
    // figureId can therefore never mean "remove" — hence the explicit flag.
    const clearFigure = Boolean(input.figure__clear);
    const attaching = input.figureId !== undefined && input.figureId !== null;

    // Contradictory instructions are rejected rather than resolved. Picking a
    // winner here means someone who checked "remove" and then chose a
    // replacement gets one of the two silently ignored, and only finds out by
    // looking at the live page.
    if (clearFigure && attaching) {
      return ctx.badRequest('Choose either a new image or removing the current one, not both');
    }

    if (clearFigure || attaching) {
      if (!slotName) return ctx.badRequest('This section has no image');
      if (attaching) {
        // A string is legitimate — the form posts one — but it must be a whole
        // positive number.
        figureId = Number(input.figureId);
        if (!Number.isInteger(figureId) || figureId <= 0) {
          return ctx.badRequest('That image could not be attached');
        }
      }
      // else: figureId stays null, which is what detaches the relation.

      imageTargets = [pair.draftId];
      if (pair.publishedId) {
        const [draftFig, pubFig] = await Promise.all([
          strapi.db.query(pair.type).findOne({
            where: { id: pair.draftId }, populate: { [slotName]: true } }),
          strapi.db.query(pair.type).findOne({
            where: { id: pair.publishedId }, populate: { [slotName]: true } }),
        ]);
        // Compare the FILE, not the row: files_related_mph is delete+insert, so
        // the join row's own id churns on every re-attach and comparing it
        // would report divergence after any earlier save.
        if (!pair.ambiguous
            || (draftFig?.[slotName]?.id ?? null) === (pubFig?.[slotName]?.id ?? null)) {
          imageTargets.push(pair.publishedId);
        }
      }
    }

    // CONTENT PARITY gates the published write.
    //
    // Position plus matching type is not proof the two rows are the same
    // component: a zone holds three member-groups, and a same-type reorder in
    // the draft produces a pairing that looks perfect and is wrong. Reproduced
    // against real data — an admin edited "Board of Directors" and the public
    // site's "Executive Committee" heading changed, reporting wrote: 2.
    //
    // The same check also stops a chapter admin's unrelated save PUBLISHING an
    // unpublished national draft edit. aloha's hero is in exactly that state
    // today (draft "Chorp Chipper", published "Our Chapter").
    //
    // Compare the PRE-EDIT draft values, field by field, against the published
    // row. Equal => same component, safe to write both. Different => either a
    // mispairing or an unpublished edit, and both mean hands off published.
    let publishedId = pair.publishedId;
    let skipReason = null;
    if (publishedId !== null && pair.ambiguous) {
      const pubRow = await strapi.db.query(pair.type).findOne({ where: { id: publishedId } });
      if (!pubRow || !sameForFields(row, pubRow, Object.keys(data))) {
        publishedId = null;
        skipReason = 'content-diverged';
      }
    } else if (publishedId === null) {
      skipReason = found.structureDiverged ? 'structure-diverged' : 'never-published';
    }

    // Empty when the save carries only buttons or only an image.
    const targets = Object.keys(data).length === 0
      ? [] : [pair.draftId, publishedId].filter((id) => id !== null);

    // --- everything is valid; write ----------------------------------------
    for (const id of targets) {
      await strapi.db.query(pair.type).update({ where: { id }, data });
    }
    for (const c of ctaPlan) {
      await strapi.db.query('shared.cta').update({ where: { id: c.draftCta.id }, data: c.ctaData });
      if (c.writeBoth) {
        await strapi.db.query('shared.cta').update({ where: { id: c.pubCta.id }, data: c.ctaData });
      }
    }
    for (const id of imageTargets) {
      await strapi.db.query(pair.type).update({ where: { id }, data: { [slotName]: figureId } });
    }
    for (const id of photoTargets) {
      // Same as the roster: the array's order is the order the grid renders in.
      await strapi.db.query(pair.type).update({ where: { id }, data: { [photoSlot]: photoIds } });
    }
    for (const id of rosterTargets) {
      // Order is meaningful — it is the order the roster renders in — and
      // `db.query` preserves the array it is given.
      await strapi.db.query(pair.type).update({ where: { id }, data: { [rosterSlot]: rosterIds } });
    }

    const facets = [];
    if (Object.keys(data).length > 0) facets.push({ kind: 'text', wrote: targets.length });
    for (const c of ctaPlan) facets.push({ kind: 'button', slot: c.slot, wrote: c.writeBoth ? 2 : 1 });
    if (imageTargets.length > 0) facets.push({ kind: 'image', wrote: imageTargets.length });
    if (rosterTargets.length > 0) facets.push({ kind: 'members', wrote: rosterTargets.length });
    if (photoTargets.length > 0) facets.push({ kind: 'photos', wrote: photoTargets.length });

    const live = facets.filter((f) => f.wrote === 2).length;
    const held = facets.filter((f) => f.wrote < 2).length;

    ctx.body = {
      data: { index, type: pair.type, facets, live, held },
      meta: {
        structureDiverged: found.structureDiverged,
        // Only when something was actually held back.
        skipReason: held > 0 ? (skipReason ?? 'content-diverged') : null,
      },
    };
  }),

  // Metadata, not an action. tests/unit/grants.test.js diffs this against the
  // exported handlers, so a handler added without `declare` fails the suite.
  __capabilities: DECLARED,
};
