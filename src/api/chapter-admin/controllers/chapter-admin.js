'use strict';

/**
 * chapter-admin controller.
 *
 * This API deliberately has no content-type. Strapi loads routes, controllers
 * and services independently of content-types (@strapi/core loaders/apis.js),
 * and users-permissions builds its action list from CONTROLLERS as
 * `api::<api>.<controller>.<action>`. So every method named here becomes a
 * togglable permission on the Chapter Admin role.
 *
 * Handlers are assembled from services/ — nothing but wiring belongs here.
 */

module.exports = {
  // Temporary canary, replaced in Task 11. Not granted to any role, so it 403s;
  // its only job is to prove the action appears in the permission matrix.
  async whoami(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    ctx.body = { ok: true, userId: ctx.state.user.id };
  },
};
