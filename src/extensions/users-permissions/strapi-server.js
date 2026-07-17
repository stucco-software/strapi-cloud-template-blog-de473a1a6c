'use strict';

/**
 * users-permissions plugin extension.
 *
 * 1. The stock `GET /api/users/me` controller ignores `populate` and strips all
 *    relations, so the member dashboard could never read the signed-in user's
 *    chapter. Override `me` to return the chapter (name + slug) alongside the
 *    user's own fields.
 *
 * 2. The stock `PUT /api/users/:id` lets any authenticated user edit ANY user
 *    (no ownership check) and every field (status, chapter, role, dues…). Add a
 *    custom `updateMe` action + `PUT /api/users/me` route that only edits the
 *    signed-in user and only a whitelist of self-service profile fields.
 *
 * Output is always run through the content-API sanitizer, so password/token
 * fields stay hidden exactly as the default does.
 */

// Profile fields a member may edit about themselves. Deliberately excludes
// identity/entitlement fields (email, status, chapter, role, memberSince,
// duesPaidThrough, autoRenew) — those are set by admins/billing, not the form.
const EDITABLE_FIELDS = [
  'bio',
  'location',
  'company',
  'phone',
  'postalCode',
  'languages',
  'designations',
  'x',
  'instagram',
];

module.exports = (plugin) => {
  const sanitizeOutput = (user, ctx) => {
    const schema = strapi.getModel('plugin::users-permissions.user');
    return strapi.contentAPI.sanitize.output(user, schema, {
      auth: ctx.state.auth,
    });
  };

  // Fetch the signed-in user with chapter populated, sanitize, and re-attach a
  // minimal chapter view (the sanitizer drops it because the Authenticated role
  // has no chapter read-grant). Shared by `me` and `updateMe`.
  const readSelf = async (ctx) => {
    const user = await strapi
      .documents('plugin::users-permissions.user')
      .findOne({
        documentId: ctx.state.user.documentId,
        populate: { chapter: { fields: ['name', 'slug'] } },
      });

    const body = await sanitizeOutput(user, ctx);
    if (user?.chapter) {
      body.chapter = { name: user.chapter.name, slug: user.chapter.slug };
    }
    return body;
  };

  plugin.controllers.user.me = async (ctx) => {
    if (!ctx.state.user) {
      return ctx.unauthorized();
    }
    ctx.body = await readSelf(ctx);
  };

  plugin.controllers.user.updateMe = async (ctx) => {
    if (!ctx.state.user) {
      return ctx.unauthorized();
    }

    // Accept either a flat body or Strapi's `{ data: {...} }` convention, then
    // keep only whitelisted keys. Everything else is silently ignored.
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const data = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in input) {
        const value = input[field];
        data[field] = typeof value === 'string' ? value.trim() : value;
      }
    }

    if (Object.keys(data).length > 0) {
      await strapi.documents('plugin::users-permissions.user').update({
        documentId: ctx.state.user.documentId,
        data,
      });
    }

    ctx.body = await readSelf(ctx);
  };

  // Register PUT /api/users/me. Must precede PUT /api/users/:id (same method),
  // otherwise "me" is captured as the :id param. `prefix: ''` mounts it at
  // /api/users/me like the stock user routes.
  plugin.routes['content-api'].routes.unshift({
    method: 'PUT',
    path: '/users/me',
    handler: 'user.updateMe',
    config: {
      prefix: '',
    },
  });

  return plugin;
};
