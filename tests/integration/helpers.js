import { createRequire } from 'node:module';

// Load @strapi/strapi through require so the harness shares ONE module graph
// with Strapi's own loader and with scripts/seed.js (the known-working
// reference). Importing it would resolve the `import` condition to dist/index.mjs
// — a second, separate copy.
const require = createRequire(import.meta.url);
const { createStrapi, compileStrapi } = require('@strapi/strapi');

let instance;
let pristineListeners;

export async function boot() {
  if (!instance) {
    // Snapshot the process listeners BEFORE Strapi installs its signal traps,
    // so this set is Vitest's own and nothing else. shutdown() restores exactly
    // this — see the comment there.
    pristineListeners = process.eventNames().map((name) => [name, process.listeners(name)]);

    instance = await createStrapi(await compileStrapi()).load();
    instance.log.level = 'error';
    await instance.server.mount(); // load() never mounts; only listen() does
  }
  return instance;
}

export async function shutdown() {
  if (!instance) return;

  // strapi.destroy() calls process.removeAllListeners() with NO arguments
  // (@strapi/core/dist/Strapi.js:419), which strips Vitest's own IPC handlers
  // along with Strapi's signal traps. Left unrestored, the pool worker's next
  // send() rejects with ERR_IPC_CHANNEL_CLOSED and the run exits 1 even though
  // every test passed — a red suite that means nothing.
  //
  // Restore the PRE-BOOT snapshot, not a snapshot taken here. Taking it here
  // would also reinstate Strapi's own SIGTERM/SIGINT trap, which then fires at
  // process exit and calls destroy() a second time:
  // "Destroy for plugin::content-manager has already been called".
  try {
    await instance.destroy();
  } finally {
    instance = null;
    for (const [name, listeners] of pristineListeners ?? []) {
      const current = process.listeners(name);
      for (const listener of listeners) {
        if (!current.includes(listener)) process.on(name, listener);
      }
    }
    pristineListeners = null;
  }
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
    // Required for POST /api/auth/local to find them: the local strategy filters
    // on `provider: 'local'`, so a user created without it has a valid password
    // hash and still fails login with "Invalid identifier or password".
    // scripts/seed.js sets this everywhere; these tests mint JWTs directly and
    // so never noticed.
    provider: 'local',
    firstName: 'Test', lastName: 'Admin',
    role: role.id,
    administeredChapters: chapterIds,
  });
}
