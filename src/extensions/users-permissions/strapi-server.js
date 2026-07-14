'use strict';

/**
 * users-permissions plugin extension.
 *
 * The stock `GET /api/users/me` controller ignores `populate` and strips all
 * relations, so the member dashboard could never read the signed-in user's
 * chapter. Override `me` to return the chapter (name + slug) alongside the
 * user's own fields. Output is still run through the content-API sanitizer, so
 * password/token fields stay hidden exactly as the default does.
 */
module.exports = (plugin) => {
  const sanitizeOutput = (user, ctx) => {
    const schema = strapi.getModel('plugin::users-permissions.user');
    return strapi.contentAPI.sanitize.output(user, schema, {
      auth: ctx.state.auth,
    });
  };

  plugin.controllers.user.me = async (ctx) => {
    if (!ctx.state.user) {
      return ctx.unauthorized();
    }

    const user = await strapi
      .documents('plugin::users-permissions.user')
      .findOne({
        documentId: ctx.state.user.documentId,
        populate: { chapter: { fields: ['name', 'slug'] } },
      });

    const body = await sanitizeOutput(user, ctx);

    // The content-API sanitizer drops the `chapter` relation because the
    // Authenticated role has no chapter read-grant. Re-attach a minimal, safe
    // view of it (name + slug only) so the dashboard can show the chapter.
    if (user?.chapter) {
      body.chapter = { name: user.chapter.name, slug: user.chapter.slug };
    }

    ctx.body = body;
  };

  return plugin;
};
