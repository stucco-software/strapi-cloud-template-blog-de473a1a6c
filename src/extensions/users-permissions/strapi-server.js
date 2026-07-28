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
 * 3. The member directory needs a privacy-safe, searchable, paginated list of
 *    members. Add a custom `directory` action + `GET /api/users/directory` route
 *    (Authenticated only) that returns a hand-built payload of display-only
 *    fields — never email/phone/postalCode/status/dues — regardless of schema
 *    field privacy, so it can't leak PII the way a raw `GET /api/users` can.
 *
 * Output is always run through the content-API sanitizer (or an explicit field
 * whitelist), so password/token fields stay hidden exactly as the default does.
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

// Fields the member directory reads + returns. Display-only + searchable; NO
// contact/entitlement PII (email, phone, postalCode, status, dues, socials).
const DIRECTORY_FIELDS = [
  'displayName',
  'firstName',
  'lastName',
  'location',
  'languages',
  'company',
  'designations',
  'title',
];

const DIRECTORY_MAX_PAGE_SIZE = 50;
const DIRECTORY_DEFAULT_PAGE_SIZE = 12;

// Query params can arrive as string | string[] (repeated keys). Take the first.
const firstStr = (v) => (Array.isArray(v) ? v[0] : v ?? '').toString().trim();

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

  // GET /api/users/directory — searchable, paginated, privacy-safe member list.
  plugin.controllers.user.directory = async (ctx) => {
    if (!ctx.state.user) {
      return ctx.unauthorized();
    }

    const query = ctx.request.query ?? {};
    const q = firstStr(query.q);
    const name = firstStr(query.name);
    const city = firstStr(query.city);
    const company = firstStr(query.company);
    const chapter = firstStr(query.chapter);
    const designation = firstStr(query.designation);

    // Only real, browsable members: confirmed, not blocked, and chapter-affiliated.
    // The chapter filter excludes national board members (delegates/officers are
    // seeded with chapter:null and no member-profile fields; they have their own
    // /about/* pages). Flip/remove this line if the directory should list them too.
    const and = [
      { confirmed: true },
      { blocked: { $ne: true } },
      { chapter: { documentId: { $notNull: true } } },
    ];

    if (q) {
      and.push({
        $or: [
          { displayName: { $containsi: q } },
          { company: { $containsi: q } },
          { location: { $containsi: q } },
          { languages: { $containsi: q } },
          { designations: { $containsi: q } },
        ],
      });
    }
    if (name) {
      and.push({
        $or: [
          { displayName: { $containsi: name } },
          { firstName: { $containsi: name } },
          { lastName: { $containsi: name } },
        ],
      });
    }
    if (city) {
      and.push({
        $or: [
          { location: { $containsi: city } },
          { postalCode: { $containsi: city } },
        ],
      });
    }
    if (company) and.push({ company: { $containsi: company } });
    if (designation) and.push({ designations: { $containsi: designation } });
    if (chapter) and.push({ chapter: { slug: { $eqi: chapter } } });

    const filters = { $and: and };

    const pageNum = Math.max(1, parseInt(firstStr(query.page), 10) || 1);
    const pageSize = Math.min(
      DIRECTORY_MAX_PAGE_SIZE,
      Math.max(1, parseInt(firstStr(query.pageSize), 10) || DIRECTORY_DEFAULT_PAGE_SIZE)
    );

    const docs = strapi.documents('plugin::users-permissions.user');
    const [rows, total] = await Promise.all([
      docs.findMany({
        filters,
        fields: DIRECTORY_FIELDS,
        populate: { chapter: { fields: ['name', 'slug'] } },
        sort: ['lastName:asc', 'firstName:asc'],
        limit: pageSize,
        start: (pageNum - 1) * pageSize,
      }),
      docs.count({ filters }),
    ]);

    // Hand-build the response — only whitelisted, display-safe fields ship.
    ctx.body = {
      data: rows.map((u) => ({
        displayName:
          u.displayName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
        location: u.location ?? '',
        languages: u.languages ?? '',
        company: u.company ?? '',
        designations: u.designations ?? '',
        title: u.title ?? '',
        chapter: u.chapter
          ? { name: u.chapter.name, slug: u.chapter.slug }
          : null,
      })),
      meta: {
        pagination: {
          page: pageNum,
          pageSize,
          pageCount: Math.max(1, Math.ceil(total / pageSize)),
          total,
        },
      },
    };
  };

  // Register the custom routes. Both must precede the stock `/users/:id` routes
  // (same method) or "me"/"directory" get captured as the :id param.
  // `prefix: ''` mounts them at /api/users/... like the stock user routes.
  plugin.routes['content-api'].routes.unshift(
    {
      method: 'PUT',
      path: '/users/me',
      handler: 'user.updateMe',
      config: { prefix: '' },
    },
    {
      method: 'GET',
      path: '/users/directory',
      handler: 'user.directory',
      config: { prefix: '' },
    }
  );

  return plugin;
};
