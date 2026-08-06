'use strict';

const { BadInputError } = require('./fields');

/**
 * What the attach/detach picker needs.
 *
 * Partners are global, public-facing records — name, logo and sponsorship level
 * already appear on every microsite that uses them — so there is no PII
 * question here, unlike services/members.js. The whitelist is for shape
 * stability, not secrecy.
 */
const PARTNER_FIELDS = ['documentId', 'name', 'sponsorshipLevel', 'logoUrl'];

function toPartnerRow(partner) {
  return {
    documentId: partner.documentId,
    name: partner.name ?? '',
    sponsorshipLevel: partner.sponsorshipLevel ?? '',
    // `logo` is required:true, but a populate that omits it must not throw.
    logoUrl: partner.logo?.url ?? '',
  };
}

/**
 * Whatever the form sent -> a de-duplicated, ORDER-PRESERVING list of ids.
 *
 * Order matters: `partner_ord` is a real column and the microsite renders by it.
 *
 * Identical contract to normaliseMemberIds, including the explicit null
 * rejection: Strapi treats `partners: null` as "clear", so returning [] for it
 * would detach every sponsor on a malformed request while `'x'` correctly 400s.
 */
function normalisePartnerIds(raw) {
  if (raw === undefined) return [];
  if (raw === null) {
    throw new BadInputError('partners must be a list, or omitted entirely');
  }
  if (!Array.isArray(raw)) {
    throw new BadInputError('partners must be a list');
  }
  const ids = raw.map((entry) => {
    const id = typeof entry === 'string' ? entry : entry?.documentId;
    if (typeof id !== 'string' || id === '') {
      throw new BadInputError('every partner must be identified by a documentId');
    }
    return id;
  });
  return [...new Set(ids)];
}

/**
 * Locate the `shared.partner-group` component on a chapter's home page, at BOTH
 * statuses.
 *
 * Two verified facts make this necessary rather than incidental:
 *
 *  1. Draft and published pages carry DIFFERENT component rows. `aloha-hawaii`'s
 *     draft page holds component 34, its published page component 35. Writing
 *     one leaves the other stale — published is what the public site renders,
 *     draft is what the admin panel shows.
 *  2. Not every chapter has a home page (`pdx` has none), and a page may have
 *     no partner-group slot. Both are ordinary states, not errors to assume away.
 *
 * Returns `{ groups: { draft?: id, published?: id } }` or `{ error }`.
 */
async function findPartnerGroups(strapiInstance, chapterSlug) {
  const groups = {};
  let sawPage = false;

  for (const status of ['draft', 'published']) {
    const page = await strapiInstance.documents('api::page.page').findFirst({
      filters: { slug: 'home', chapter: { slug: chapterSlug } },
      populate: { components: true },
      status,
    });
    if (!page) continue;
    sawPage = true;
    const group = (page.components ?? []).find((c) => c.__component === 'shared.partner-group');
    if (group?.id) groups[status] = group.id;
  }

  if (!sawPage) return { error: 'no-home-page' };

  // The DRAFT slot is required, not merely preferred. It is the editing
  // surface: the picker pre-checks from it, so without it the form would render
  // every box unchecked while the published page still shows sponsors — and one
  // Save would replace them with nothing. Reachable by ordinary CMS use: remove
  // the Partner Group section in the admin panel and save without publishing.
  //
  // The published slot is written when present and skipped when absent (a page
  // that has never been published), which is correct in both directions.
  if (!groups.draft) return { error: 'no-partner-group' };
  return { groups };
}

module.exports = {
  toPartnerRow, normalisePartnerIds, findPartnerGroups, PARTNER_FIELDS,
};
