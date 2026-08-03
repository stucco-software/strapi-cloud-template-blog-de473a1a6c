import { createRequire } from 'node:module';

// Load @strapi/strapi through require so the harness shares ONE module graph
// with Strapi's own loader and with scripts/seed.js (the known-working
// reference). Importing it would resolve the `import` condition to dist/index.mjs
// — a second, separate copy.
const require = createRequire(import.meta.url);
const { createStrapi, compileStrapi } = require('@strapi/strapi');

let instance;

export async function boot() {
  if (!instance) {
    instance = await createStrapi(await compileStrapi()).load();
    instance.log.level = 'error';
    await instance.server.mount(); // load() never mounts; only listen() does
  }
  return instance;
}

export async function shutdown() {
  if (instance) { await instance.destroy(); instance = null; }
}

/**
 * Fetch chapters at DRAFT status.
 *
 * This matters more than it looks. `chapter` is draft-and-publish, so each has
 * two rows with different numeric ids sharing one documentId. Populating
 * administeredChapters resolves at draft status, so linking a user to the
 * PUBLISHED id yields an empty populate and every request 403s.
 */
export async function draftChapters(strapi, limit = 2) {
  return strapi.documents('api::chapter.chapter')
    .findMany({ fields: ['slug'], limit, sort: ['slug:asc'], status: 'draft' });
}

/** jwt.issue() returns a string in legacy mode and a Promise under 'refresh'. */
export async function jwtFor(strapi, userId) {
  return strapi.plugin('users-permissions').service('jwt').issue({ id: userId });
}

/** Create a chapter admin. `chapterIds` are numeric DRAFT entry ids. */
export async function makeChapterAdmin(strapi, { email, chapterIds }) {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'chapter_admin' } });

  return strapi.plugin('users-permissions').service('user').add({
    username: email, email, password: 'Password123!', confirmed: true,
    firstName: 'Test', lastName: 'Admin',
    role: role.id,
    administeredChapters: chapterIds,
  });
}
