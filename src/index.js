'use strict';

// Self-service permissions the member area relies on. Granted to the built-in
// Authenticated role on boot so the profile page works without a manual admin
// toggle (and so it survives fresh DBs / new environments).
//   - user.updateMe       → PUT /api/users/me            (edit own profile)
//   - auth.changePassword → POST /api/auth/change-password
//   - user.directory      → GET /api/users/directory     (privacy-safe member list)
const AUTHENTICATED_GRANTS = [
  'plugin::users-permissions.user.updateMe',
  'plugin::users-permissions.auth.changePassword',
  'plugin::users-permissions.user.directory',
];

// Chapter admins are ordinary up_users with an elevated role — never Strapi
// admin-panel seats, which are billed per user. `user.role` is manyToOne, so a
// Chapter Admin is NOT also Authenticated: this role must repeat the
// Authenticated grants or chapter admins lose their own profile page.
//
// Capability lives here; SCOPE lives in user.administeredChapters and is
// enforced per-request in src/api/chapter-admin. Both are required.
const CHAPTER_ADMIN_ROLE = {
  name: 'Chapter Admin',
  description:
    "Manages one or more chapters' own content through /api/chapter-admin. Scope is " +
    "controlled by the user's administeredChapters relation, not by this role.",
  type: 'chapter_admin',
};

const CHAPTER_ADMIN_GRANTS = [
  ...AUTHENTICATED_GRANTS,
  'api::chapter-admin.chapter-admin.listEvents',
  'api::chapter-admin.chapter-admin.createEvent',
  'api::chapter-admin.chapter-admin.updateEvent',
  'api::chapter-admin.chapter-admin.deleteEvent',
  'api::chapter-admin.chapter-admin.uploadMedia',
];

async function grant(strapi, roleId, actions) {
  for (const action of actions) {
    const existing = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: roleId } });

    if (!existing) {
      await strapi
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: roleId } });
    }
  }
}

module.exports = {
  register(/* { strapi } */) {},

  async bootstrap({ strapi }) {
    const authenticated = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });

    if (authenticated) {
      await grant(strapi, authenticated.id, AUTHENTICATED_GRANTS);
    }

    // Create-or-find, then grant. Idempotent: safe on every boot.
    let chapterAdmin = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: CHAPTER_ADMIN_ROLE.type } });

    if (!chapterAdmin) {
      chapterAdmin = await strapi
        .query('plugin::users-permissions.role')
        .create({ data: CHAPTER_ADMIN_ROLE });
      strapi.log.info(`Created the "${CHAPTER_ADMIN_ROLE.name}" role.`);
    }

    await grant(strapi, chapterAdmin.id, CHAPTER_ADMIN_GRANTS);
  },
};
