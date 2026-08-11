'use strict';

const {
  AUTHENTICATED_GRANTS, CHAPTER_ADMIN_GRANTS, PUBLIC_GRANTS,
} = require('./api/chapter-admin/grants');
const {
  seedCapabilities, backfillCapabilities,
} = require('./api/member-capability/seed');

// Chapter admins are ordinary up_users with an elevated role — never Strapi
// admin-panel seats, which are billed per user. `user.role` is manyToOne, so a
// Chapter Admin is NOT also Authenticated: the role must repeat the
// Authenticated grants or chapter admins lose their own profile page.
//
// Capability lives in the grants list; SCOPE lives in user.administeredChapters
// and is enforced per-request in src/api/chapter-admin. Both are required.
const CHAPTER_ADMIN_ROLE = {
  name: 'Chapter Admin',
  description:
    "Manages one or more chapters' own content through /api/chapter-admin. Scope is " +
    "controlled by the user's administeredChapters relation, not by this role.",
  type: 'chapter_admin',
};

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
    // Capabilities first: the backfill at the end of this function reads them.
    await seedCapabilities(strapi);

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

    // The public contact form. One action, and only this one — see PUBLIC_GRANTS.
    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });
    if (publicRole) await grant(strapi, publicRole.id, PUBLIC_GRANTS);

    // Last, because it reads role.type and the roles must exist by now. Every
    // existing admin ends up holding the capability matching the role they
    // already had, so the capability model changes nothing on day one.
    await backfillCapabilities(strapi);
  },
};
