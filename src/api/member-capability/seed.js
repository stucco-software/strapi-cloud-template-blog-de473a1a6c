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

/**
 * Roles whose holders should be given a matching capability on boot.
 *
 * `authenticated` deliberately maps to NOTHING. Authenticated is the baseline
 * every signed-in member has, not a unit of authority, and granting it as a
 * capability would make "holds no capability" unrepresentable.
 */
const ROLE_TO_CAPABILITY = { chapter_admin: 'chapter_admin' };

/**
 * Give every user holding a mapped role the matching capability, once.
 *
 * This is what makes day-one behaviour byte-identical: every existing admin
 * ends up holding the capability that matches the role they already had.
 *
 * Returns how many links were added, so a caller — and the idempotency test —
 * can tell a no-op from work. Filtered to the mapped roles rather than scanning
 * every user, so it stays cheap as the membership grows.
 */
async function backfillCapabilities(strapi) {
  const bySlug = await seedCapabilities(strapi);
  let added = 0;

  for (const [roleType, slug] of Object.entries(ROLE_TO_CAPABILITY)) {
    const capability = bySlug[slug];
    if (!capability) continue;

    const users = await strapi.query('plugin::users-permissions.user').findMany({
      where: { role: { type: roleType } },
      populate: { capabilities: true },
    });

    for (const user of users) {
      const held = (user.capabilities ?? []).map((c) => c.slug);
      if (held.includes(slug)) continue;

      // Numeric ids here, not documentIds: `query` is the ORM layer and
      // member-capability is not draft-and-publish, so one row is one id.
      await strapi.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          capabilities: [
            ...(user.capabilities ?? []).map((c) => c.id), capability.id,
          ],
        },
      });
      added += 1;
    }
  }

  if (added > 0) strapi.log.info(`Backfilled ${added} capability link(s).`);
  return added;
}

module.exports = {
  CAPABILITIES, CATEGORIES, ROLE_TO_CAPABILITY,
  seedCapabilities, backfillCapabilities, UID,
};
