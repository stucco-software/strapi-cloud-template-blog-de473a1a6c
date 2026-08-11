'use strict';

/**
 * The users-permissions actions the Chapter Admin role is granted on boot.
 *
 * Lives here rather than in src/index.js because Strapi validates that file's
 * shape and rejects any export other than register/bootstrap/destroy — so the
 * list could not be exported from there for tests/unit/grants.test.js to read.
 * Next to the API it grants is the better home regardless.
 *
 * Every entry must match a method exported by controllers/chapter-admin.js.
 * Counting permission rows cannot catch a typo: users-permissions prunes unknown
 * actions during plugin bootstrap and src/index.js re-creates them immediately,
 * so the row count is correct either way. grants.test.js diffs the lists.
 */

// Self-service permissions the member area relies on. `user.me` and
// auth.logout come from Strapi's default Authenticated role; they are repeated
// because user.role is manyToOne, so a Chapter Admin is NOT also Authenticated
// and a role without them 403s on GET /api/users/me — which is how the frontend
// resolves every session.
const AUTHENTICATED_GRANTS = [
  'plugin::users-permissions.user.me',
  'plugin::users-permissions.user.updateMe',
  'plugin::users-permissions.auth.changePassword',
  'plugin::users-permissions.auth.logout',
  'plugin::users-permissions.user.directory',
];

/**
 * Actions the PUBLIC (unauthenticated) role is granted on boot.
 *
 * Only `capture`. Deliberately NOT the core router's `create`: that accepts
 * arbitrary attributes, so a spammer could POST `handled: true` to hide their
 * own submission from the screen built to surface it, or attribute it to any
 * chapter. And never `find` — that would publish every enquiry the association
 * has ever received.
 *
 * Here rather than in scripts/seed.js, which is where the other public reads
 * live, because the seed only runs on demand: a deploy that did not re-seed
 * would ship a contact form posting to a 403.
 */
const PUBLIC_GRANTS = [
  'api::form-submission.form-submission.capture',
];

// The chapter-authoring surface, scoped per chapter via administeredChapters.
const CHAPTER_ADMIN_ACTIONS = [
  'api::chapter-admin.chapter-admin.getEvent',
  'api::chapter-admin.chapter-admin.listEvents',
  'api::chapter-admin.chapter-admin.createEvent',
  'api::chapter-admin.chapter-admin.updateEvent',
  'api::chapter-admin.chapter-admin.deleteEvent',
  'api::chapter-admin.chapter-admin.uploadMedia',

  'api::chapter-admin.chapter-admin.listMembers',

  'api::chapter-admin.chapter-admin.getCommittee',
  'api::chapter-admin.chapter-admin.listCommittees',
  'api::chapter-admin.chapter-admin.createCommittee',
  'api::chapter-admin.chapter-admin.updateCommittee',
  'api::chapter-admin.chapter-admin.deleteCommittee',

  'api::chapter-admin.chapter-admin.getNewsItem',
  'api::chapter-admin.chapter-admin.listNews',
  'api::chapter-admin.chapter-admin.createNews',
  'api::chapter-admin.chapter-admin.updateNews',
  'api::chapter-admin.chapter-admin.deleteNews',

  'api::chapter-admin.chapter-admin.getChapter',
  'api::chapter-admin.chapter-admin.updateChapter',

  'api::chapter-admin.chapter-admin.listPartners',
  'api::chapter-admin.chapter-admin.updatePartners',
  'api::chapter-admin.chapter-admin.getPage',
  'api::chapter-admin.chapter-admin.updatePage',
  'api::chapter-admin.chapter-admin.listSubmissions',
  'api::chapter-admin.chapter-admin.updateSubmission',
];

/**
 * Actions each capability grants, keyed by capability slug.
 *
 * NO list here spreads another. That is the point of the whole change: with one
 * role per user, a Chapter Admin who is also a Committee Leader needed a THIRD
 * role re-listing both sets, and every later edit had to be applied to every
 * combination containing it. Composition happens in grantsFor().
 *
 * The authenticated baseline is NOT repeated here — grantsFor() always adds it.
 *
 * national_admin and chapter_admin list the same actions today, and that is
 * duplication of a different kind: two independent authority definitions that
 * happen to coincide, and will diverge as soon as the National Admin portal
 * adds national-only endpoints. Do NOT define one in terms of the other — that
 * reintroduces exactly the coupling this change exists to remove.
 */
const CAPABILITY_GRANTS = {
  // Unscoped by decision: a National Admin reaches every chapter.
  national_admin: [...CHAPTER_ADMIN_ACTIONS],

  // Scoped per committee via user.ledCommittees. No route grants these yet —
  // the capability is holdable, scoped and tested, and the endpoints arrive
  // with the committee-leader UI.
  committee_leader: [
    'api::chapter-admin.chapter-admin.getCommittee',
    'api::chapter-admin.chapter-admin.listCommittees',
    'api::chapter-admin.chapter-admin.createCommittee',
    'api::chapter-admin.chapter-admin.updateCommittee',
    'api::chapter-admin.chapter-admin.deleteCommittee',
  ],

  // Scoped per chapter via user.administeredChapters.
  chapter_admin: [...CHAPTER_ADMIN_ACTIONS],
};

/**
 * The union of the authenticated baseline and every held capability's grants.
 *
 * Union, never last-write: two capabilities compose, they do not shadow. An
 * unrecognised slug grants nothing and does not throw — capabilities are
 * authorable in the admin UI, so an unknown one is a routine state, and taking
 * the boot down over it would be a worse failure than ignoring it. Sorted so
 * the output is comparable.
 */
function grantsFor(capabilitySlugs) {
  const out = new Set(AUTHENTICATED_GRANTS);
  for (const slug of capabilitySlugs ?? []) {
    for (const action of CAPABILITY_GRANTS[slug] ?? []) out.add(action);
  }
  return [...out].sort();
}

// Derived, not authored — the role still needs all 30 actions in the database
// because it is still the coarse route gate. Exported under the old name so
// src/index.js and tests/unit/grants.test.js keep working.
const CHAPTER_ADMIN_GRANTS = grantsFor(['chapter_admin']);

module.exports = {
  AUTHENTICATED_GRANTS, CAPABILITY_GRANTS, CHAPTER_ADMIN_GRANTS,
  PUBLIC_GRANTS, grantsFor,
};
