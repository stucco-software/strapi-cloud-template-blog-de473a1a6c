'use strict';

/**
 * member-capability router
 *
 * The core routes exist so the type is a first-class API, but NO role is
 * granted any action on them — not even Authenticated. Capabilities are read
 * server-side and re-attached to GET /api/users/me; nothing needs to fetch the
 * collection over HTTP, and a member enumerating the authority model buys
 * nothing but reconnaissance. If a screen ever needs it, grant `find` to a
 * specific role deliberately.
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::member-capability.member-capability');
