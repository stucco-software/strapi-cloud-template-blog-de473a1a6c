'use strict';

// Self-service permissions the member area relies on. These are granted to the
// built-in Authenticated role on boot so the profile page works without a
// manual admin toggle (and so it survives fresh DBs / new environments).
//   - user.updateMe       → PUT /api/users/me            (edit own profile)
//   - auth.changePassword → POST /api/auth/change-password
const AUTHENTICATED_GRANTS = [
  'plugin::users-permissions.user.updateMe',
  'plugin::users-permissions.auth.changePassword',
];

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    const role = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });

    if (!role) return;

    for (const action of AUTHENTICATED_GRANTS) {
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: role.id } });

      if (!existing) {
        await strapi
          .query('plugin::users-permissions.permission')
          .create({ data: { action, role: role.id } });
      }
    }
  },
};
