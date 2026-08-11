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

const CHAPTER_ADMIN_GRANTS = [
  ...AUTHENTICATED_GRANTS,

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

module.exports = { AUTHENTICATED_GRANTS, CHAPTER_ADMIN_GRANTS, PUBLIC_GRANTS };
