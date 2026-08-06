'use strict';

const { chapterScopedResource } = require('../services/resource-factory');
// ScopeError must be obtained by direct require, never via strapi.service(...).
// Strapi's loadFiles deletes the require cache per file, so a service-registry
// lookup can hand back a DIFFERENT class object and `instanceof` silently fails.
const {
  ScopeError, resolveAdministeredChapters, assertChapterScope,
} = require('../services/scope');
const { SlugError } = require('../services/slug');
const { BadInputError, pickWhitelisted } = require('../services/fields');
const {
  toDirectoryRow, normaliseMemberIds, assertMembersInChapter,
} = require('../services/members');
const { uploadImage } = require('../services/media');
const {
  toPartnerRow, normalisePartnerIds, findPartnerGroups,
} = require('../services/partners');

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

/** ScopeError -> 403; client-input errors -> 400; everything else surfaces. */
const guarded = (handler) => async (ctx) => {
  try {
    return await handler(ctx);
  } catch (err) {
    if (err instanceof ScopeError) return ctx.forbidden(err.message);
    if (err instanceof BadInputError || err instanceof SlugError) {
      return ctx.badRequest(err.message);
    }
    throw err;
  }
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
  const administered = await resolveAdministeredChapters(ctx);
  const chapterSlug = firstStr(rawSlug);
  if (!chapterSlug) return { error: 'chapterSlug is required' };

  const chapter = await strapi.documents('api::chapter.chapter').findFirst({
    filters: { slug: chapterSlug }, fields: ['name', 'slug', 'email'], status: 'draft',
  });
  if (!chapter) return { error: 'No such chapter', notFound: true };

  assertChapterScope(administered, chapter.documentId);
  return { chapter };
}

module.exports = {
  getEvent: guarded(events.getOne),
  listEvents: guarded(events.list),
  createEvent: guarded(events.create),
  updateEvent: guarded(events.update),
  deleteEvent: guarded(events.delete),

  // Role-gated only: an upload has no owning chapter until a record references
  // it, so there is nothing to scope-check here.
  async uploadMedia(ctx) {
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
  },

  getCommittee: guarded(committees.getOne),
  listCommittees: guarded(committees.list),
  createCommittee: guarded(committees.create),
  updateCommittee: guarded(committees.update),
  deleteCommittee: guarded(committees.delete),

  getNewsItem: guarded(news.getOne),
  listNews: guarded(news.list),
  createNews: guarded(news.create),
  updateNews: guarded(news.update),
  deleteNews: guarded(news.delete),

  // --- members -----------------------------------------------------------
  // Read-only. Feeds the committee picker; plan 4 reuses it for the
  // member-group slots. Hand-built rows — see services/members.js.
  listMembers: guarded(async (ctx) => {
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

  // --- chapter settings --------------------------------------------------
  getChapter: guarded(async (ctx) => {
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    // Hand-built: `administrators` must never ship, or chapter admins can see
    // (and eventually appoint) each other.
    ctx.body = { data: { documentId: chapter.documentId, name: chapter.name,
      slug: chapter.slug, email: chapter.email ?? '' } };
  }),

  updateChapter: guarded(async (ctx) => {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, input.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    // `slug` is absent from this whitelist deliberately: it is a uid that will
    // not regenerate, and already-written event slug prefixes would not follow
    // it if it did.
    const data = pickWhitelisted(input, ['name', 'email']);
    if ('name' in data && data.name === '') return ctx.badRequest('name is required');

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
  listSubmissions: guarded(async (ctx) => {
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

  updateSubmission: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    const { documentId } = ctx.params;

    const record = await strapi.documents('api::form-submission.form-submission').findOne({
      documentId, populate: { chapter: { fields: ['slug'] } },
    });
    if (!record) return ctx.notFound();
    assertChapterScope(administered, record.chapter?.documentId ?? null);

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
  listPartners: guarded(async (ctx) => {
    // Scope-checked even though the catalogue is global: the screen belongs to
    // a chapter, and answering for one the caller cannot administer would leak
    // which chapters exist.
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const rows = await strapi.documents('api::partner.partner').findMany({
      fields: ['name', 'sponsorshipLevel'],
      populate: { logo: { fields: ['url'] } },
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

  updatePartners: guarded(async (ctx) => {
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
};
