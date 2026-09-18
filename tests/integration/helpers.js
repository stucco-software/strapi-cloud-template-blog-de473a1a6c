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

/**
 * Look up a capability by slug. Returns the numeric id — member-capability is
 * NOT draft-and-publish, so one capability is one row and one id.
 */
export async function capabilityId(strapi, slug) {
  const cap = await strapi.documents('api::member-capability.member-capability')
    .findFirst({ filters: { slug } });
  if (!cap) throw new Error(`No such capability: ${slug}`);
  return cap.id;
}

/**
 * Create a chapter that has NO home page, and return its DRAFT row.
 *
 * Provisioned rather than looked up. Three tests used to assert against a
 * seeded `pdx` chapter, which scripts/seed.js has never created — it makes
 * aloha-hawaii, greater-chicago and boston, and all three have home pages. The
 * fixture only ever existed in one developer's local database, so the tests
 * died the moment anyone rebuilt theirs, reporting a missing row rather than
 * the 404 behaviour they were written to cover.
 *
 * Created at published status because that is what the seed does: `chapter` is
 * draft-and-publish, so this writes BOTH rows and the caller gets the draft id
 * — the one administeredChapters resolves against (see draftChapters above).
 */
export async function makePagelessChapter(strapi, slug) {
  await strapi.documents('api::chapter.chapter')
    .create({ data: { name: `No Page (${slug})`, slug }, status: 'published' });
  const draft = await strapi.documents('api::chapter.chapter')
    .findFirst({ filters: { slug }, fields: ['slug'], status: 'draft' });
  if (!draft) throw new Error(`could not provision pageless chapter ${slug}`);
  return draft;
}

/** Remove a chapter provisioned for one test, both statuses. */
export async function dropChapter(strapi, documentId) {
  await strapi.documents('api::chapter.chapter').delete({ documentId }).catch(() => {});
}

/**
 * Create an ordinary member: the Authenticated role, no capabilities, no
 * chapters. The baseline every authority test measures against.
 */
export async function makeMember(strapi, { email }) {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });

  return strapi.plugin('users-permissions').service('user').add({
    username: email, email, password: 'Password123!', confirmed: true,
    provider: 'local', firstName: 'Plain', lastName: 'Member', role: role.id,
  });
}

/**
 * Create a chapter admin. `chapterIds` are numeric DRAFT entry ids.
 *
 * Capabilities must be attached explicitly. The boot-time backfill only sees
 * users that already exist, and these are created after it has run — so a user
 * minted here with the role alone holds no authority and 403s everywhere.
 * Pass `capabilities: []` deliberately to build exactly that case.
 */
export async function makeChapterAdmin(
  strapi, { email, chapterIds, capabilities = ['chapter_admin'] }
) {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'chapter_admin' } });

  const capIds = [];
  for (const slug of capabilities) capIds.push(await capabilityId(strapi, slug));

  return strapi.plugin('users-permissions').service('user').add({
    capabilities: capIds,
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
