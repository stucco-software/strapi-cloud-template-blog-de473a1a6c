'use strict';

/**
 * The capabilities created on boot, and the backfill that gives existing users
 * the one matching the role they already hold.
 *
 * DB-stored rather than hard-coded so RFP §3.1.1.10 holds: a new capability can
 * be authored in the admin UI without a deploy. These three are seeded because
 * the system cannot start without them — the backfill and every authorization
 * check name them.
 *
 * `categories` are the §3.1.1.8 permission categories. THE VALUES BELOW ARE A
 * FIRST CUT and are meant to be edited in the admin UI; seeding is create-only,
 * so an edit made there is never overwritten by a later boot.
 */

const CATEGORIES = ['Content', 'Event', 'Membership', 'Financial', 'Communication'];

const CAPABILITIES = [
  {
    slug: 'national_admin',
    name: 'National Admin',
    description:
      'Unscoped authority across every chapter. Bypasses chapter scope by ' +
      'design — see assertChapterScope({ unscoped }).',
    categories: CATEGORIES,
  },
  {
    slug: 'committee_leader',
    name: 'Committee Leader',
    description:
      "Leads one or more committees. Scope is the user's ledCommittees " +
      'relation, per committee, not per chapter.',
    categories: ['Content', 'Event', 'Communication'],
  },
  {
    slug: 'chapter_admin',
    name: 'Chapter Admin',
    description:
      "Manages one or more chapters' own content. Scope is the user's " +
      'administeredChapters relation.',
    categories: ['Content', 'Event', 'Membership', 'Communication'],
  },
];

const UID = 'api::member-capability.member-capability';

/** Create-or-find each capability. Idempotent; never updates an existing row. */
async function seedCapabilities(strapi) {
  const bySlug = {};
  for (const cap of CAPABILITIES) {
    const existing = await strapi.documents(UID).findFirst({
      filters: { slug: cap.slug },
    });
    bySlug[cap.slug] = existing
      ?? await strapi.documents(UID).create({ data: cap });
    if (!existing) strapi.log.info(`Created the "${cap.name}" capability.`);
  }
  return bySlug;
}

module.exports = { CAPABILITIES, CATEGORIES, seedCapabilities, UID };
