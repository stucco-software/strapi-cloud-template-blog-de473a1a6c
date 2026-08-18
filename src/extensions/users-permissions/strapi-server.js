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

const {
  HAS_LOCATION,
  NO_LOCATION,
  LOCATED_SORT,
  UNLOCATED_SORT,
  locationPageWindow,
} = require('./directory-sort');

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

// Whitelisted sort modes (§3.1.6.7 — sort by name/location). The public `sort`
// param maps to a fixed order; anything unrecognized falls back to name. Every
// option ends in name order so paging stays deterministic on ties. (Relevance
// ranking is Phase B — it needs a scored query the document service can't express.)
// `location` is the whitelist entry, not the whole story: sorting by it needs
// blanks last, which one order list cannot express, so the handler branches to
// the two-partition read in directory-sort.js. The order below is what the
// LOCATED partition uses.
const DIRECTORY_SORTS = {
  name: ['lastName:asc', 'firstName:asc'],
  location: LOCATED_SORT,
};
const DIRECTORY_DEFAULT_SORT = 'name';

// Query params can arrive as string | string[] (repeated keys). Take the first.
const firstStr = (v) => (Array.isArray(v) ? v[0] : v ?? '').toString().trim();

module.exports = (plugin) => {
  const sanitizeOutput = (user, ctx) => {
    const schema = strapi.getModel('plugin::users-permissions.user');
    return strapi.contentAPI.sanitize.output(user, schema, {
      auth: ctx.state.auth,
    });
  };

  // Fields marked `private` in the user schema so that anonymous GET /api/users
  // cannot leak them, but which a member is entitled to see about THEMSELVES.
  // The account area reads every one of these: MemberMeta renders memberSince /
  // autoRenew / duesPaidThrough, the profile page renders the status badge, and
  // the profile form edits phone and postalCode.
  //
  // `private` is absolute in Strapi — the sanitizer strips these for every
  // caller including the owner — so `me` re-attaches them explicitly. This is
  // the same technique the `chapter` re-attach below already uses, for the same
  // reason: sanitize first, then put back exactly what this caller may have.
  const SELF_VISIBLE_PRIVATE_FIELDS = [
    'email',
    'status',
    'memberSince',
    'duesPaidThrough',
    'autoRenew',
    'phone',
    'postalCode',
  ];

  // Fetch the signed-in user with chapter populated, sanitize, and re-attach a
  // minimal chapter view (the sanitizer drops it because the Authenticated role
  // has no chapter read-grant) plus the member's own private fields. Shared by
  // `me` and `updateMe`.
  const readSelf = async (ctx) => {
    const user = await strapi
      .documents('plugin::users-permissions.user')
      .findOne({
        documentId: ctx.state.user.documentId,
        populate: {
          chapter: { fields: ['name', 'slug'] },
          // The sanitizer drops both of these — `role` is private on the user
          // model and the Authenticated role has no chapter read-grant — so
          // they are re-attached below, same as `chapter`.
          role: { fields: ['name', 'type'] },
          administeredChapters: { fields: ['name', 'slug'] },
          capabilities: { fields: ['slug', 'name'] },
        },
      });

    const body = await sanitizeOutput(user, ctx);
    if (user?.chapter) {
      body.chapter = { name: user.chapter.name, slug: user.chapter.slug };
    }
    if (user?.role) {
      body.role = { name: user.role.name, type: user.role.type };
    }
    // Drives the whole chapter-admin surface on the frontend. Always an array,
    // never undefined, so callers need no guard.
    body.administeredChapters = (user?.administeredChapters ?? []).map((c) => ({
      name: c.name,
      slug: c.slug,
    }));

    // Same technique again: the sanitizer drops this because the Authenticated
    // role has no read-grant on the capability type. Always an array, never
    // undefined, so callers need no guard.
    //
    // Slug + name only. `categories` is the authority model, and shipping it
    // would invite the frontend to re-derive authorization decisions the server
    // has already made — the split that produced the missing-role bug.
    body.capabilities = (user?.capabilities ?? []).map((c) => ({
      slug: c.slug,
      name: c.name,
    }));

    for (const field of SELF_VISIBLE_PRIVATE_FIELDS) {
      if (user && field in user) body[field] = user[field];
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
    // Resolve the KEY, not just the sort array: sorting by location takes a
    // different query shape, so the branch below needs to know which mode won
    // the whitelist check rather than inferring it back out of the order list.
    const rawSort = firstStr(query.sort);
    const sortKey = DIRECTORY_SORTS[rawSort] ? rawSort : DIRECTORY_DEFAULT_SORT;

    const docs = strapi.documents('plugin::users-permissions.user');
    const populate = {
      chapter: { fields: ['name', 'slug'] },
      image: { fields: ['url', 'alternativeText'] },
    };
    const start = (pageNum - 1) * pageSize;

    let rows;
    let total;

    if (sortKey === 'location') {
      // Blanks last, which `location:asc` cannot express — see directory-sort.js.
      const [locatedTotal, all] = await Promise.all([
        docs.count({ filters: { $and: [filters, HAS_LOCATION] } }),
        docs.count({ filters }),
      ]);
      total = all;

      const window = locationPageWindow(start, pageSize, locatedTotal);
      const [located, unlocated] = await Promise.all([
        window.located.limit
          ? docs.findMany({
              filters: { $and: [filters, HAS_LOCATION] },
              fields: DIRECTORY_FIELDS,
              populate,
              sort: LOCATED_SORT,
              limit: window.located.limit,
              start: window.located.start,
            })
          : [],
        window.unlocated.limit
          ? docs.findMany({
              filters: { $and: [filters, NO_LOCATION] },
              fields: DIRECTORY_FIELDS,
              populate,
              sort: UNLOCATED_SORT,
              limit: window.unlocated.limit,
              start: window.unlocated.start,
            })
          : [],
      ]);
      rows = [...located, ...unlocated];
    } else {
      [rows, total] = await Promise.all([
        docs.findMany({
          filters,
          fields: DIRECTORY_FIELDS,
          populate,
          sort: DIRECTORY_SORTS[sortKey],
          limit: pageSize,
          start,
        }),
        docs.count({ filters }),
      ]);
    }

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
        image: u.image
          ? { url: u.image.url, alt: u.image.alternativeText ?? '' }
          : null,
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
