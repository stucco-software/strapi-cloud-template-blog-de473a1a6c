# Chapter Admin — Plan 1: Strapi Authorization Spine

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Strapi-side authorization spine that lets chapter admins write their own chapter's content through the content API, proven end-to-end on the `/events` routes with no UI.

**Architecture:** A content-type-less API at `src/api/chapter-admin/` exposes routes under `/api/chapter-admin/*`. A `Chapter Admin` users-permissions role grants *capability*; the `administeredChapters` relation grants *scope*. All authorization logic is extracted into pure functions (`fields`, `scope`, `slug`, `media`) that take plain data and return plain data, so the bulk of the test suite needs no booted Strapi. A single `chapterScopedResource` factory turns those pure helpers into CRUD handlers.

**Tech Stack:** Strapi 5.45.1, Node 22, CommonJS, Vitest 3, SQLite (local dev).

**Spec:** [`2026-08-03-chapter-admin-authoring-design.md`](./2026-08-03-chapter-admin-authoring-design.md). This plan implements **rollout step 1 only**. Steps 2 (frontend screens) and 3 (TipTap) are separate plans and have no dependency on this one beyond the routes it produces.

---

## Verified Assumptions

These were checked against the installed Strapi source before writing this plan. Do not re-litigate them; do re-check if the Strapi version changes.

| Assumption | Evidence |
|---|---|
| An API folder with no content-type loads its routes/controllers/services | `node_modules/@strapi/core/dist/loaders/apis.js:59-79` — `contentTypes: contentTypes \|\| {}` |
| Such an API appears in the users-permissions role matrix | `node_modules/@strapi/plugin-users-permissions/server/services/users-permissions.js:51-74,163-166` — actions built from controllers as `api::${apiName}.${controllerName}.${actionName}` |
| `uid` fields are **not** auto-generated on programmatic create | commit `ebd2299`; Strapi wrote `slug: null` until the seed passed slugs explicitly |
| `slug` has **no** unique DB constraint | `sqlite3 .tmp/data.db ".schema events"` — `slug varchar(255) null`, no unique index |
| `documents().create/update` write drafts unless given `status: 'published'` | Strapi 5 documents API; all target types have `draftAndPublish: true` |
| `user.role` is `manyToOne` — one role per user | `src/extensions/users-permissions/content-types/user/schema.json` |

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `vitest.config.js` | Test runner config, Node environment |
| `src/api/chapter-admin/services/fields.js` | Pure. Whitelist an input object. |
| `src/api/chapter-admin/services/scope.js` | Pure `assertChapterScope` + impure `resolveAdministeredChapters` |
| `src/api/chapter-admin/services/slug.js` | Pure. Build and de-collide slugs. |
| `src/api/chapter-admin/services/media.js` | Pure `validateUpload` + impure `uploadImage` |
| `src/api/chapter-admin/services/resource-factory.js` | Assembles CRUD handlers from the pure helpers |
| `src/api/chapter-admin/controllers/chapter-admin.js` | Names the actions the permission matrix sees |
| `src/api/chapter-admin/routes/chapter-admin.js` | Route table |
| `tests/unit/fields.test.js` | |
| `tests/unit/scope.test.js` | |
| `tests/unit/slug.test.js` | |
| `tests/unit/media.test.js` | |
| `tests/integration/events.test.js` | Booted-Strapi proof of the whole path |
| `tests/integration/helpers.js` | Boot/teardown + JWT minting |

**Modify:**

| Path | Change |
|---|---|
| `package.json` | Add `vitest` devDependency and `test` script |
| `src/index.js` | Create the `Chapter Admin` role and grant its actions on bootstrap |

**Why this split:** every file with authorization logic in it is a pure function taking plain arguments. `resource-factory.js` is the only place that combines them with Strapi's document service, and the controller/routes files carry no logic at all. That keeps the security-relevant surface small enough to hold in your head and testable without a database.

---

## Chunk 1: Test harness and pure helpers

### Task 1: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`

- [ ] **Step 1: Install Vitest**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms
npm install --save-dev vitest@^3
```

- [ ] **Step 2: Add the test scripts**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:unit": "vitest run tests/unit"
```

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Integration tests boot a real Strapi against SQLite; they cannot run
    // concurrently against the same file.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
```

- [ ] **Step 4: Verify the runner starts**

Run: `npm test`
Expected: exits 0 with "No test files found" — the runner works, there is nothing to run yet.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js
git commit -m "test: add vitest"
```

---

### Task 2: Field whitelist

The single function that decides what a chapter admin is allowed to write. Note it copies **only keys present in the input** — an absent field is left untouched rather than blanked. (The frontend's `pages/api/profile.ts` has the opposite behaviour and will silently wipe fields on a partial POST; do not copy that pattern here.)

**Files:**
- Create: `src/api/chapter-admin/services/fields.js`
- Test: `tests/unit/fields.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { pickWhitelisted } from '../../src/api/chapter-admin/services/fields.js';

describe('pickWhitelisted', () => {
  it('keeps whitelisted fields', () => {
    expect(pickWhitelisted({ title: 'Gala', location: 'SF' }, ['title', 'location']))
      .toEqual({ title: 'Gala', location: 'SF' });
  });

  it('drops everything not whitelisted', () => {
    const input = { title: 'Gala', chapter: 7, role: 1, status: 'Active' };
    expect(pickWhitelisted(input, ['title'])).toEqual({ title: 'Gala' });
  });

  it('omits absent fields rather than blanking them', () => {
    expect(pickWhitelisted({ title: 'Gala' }, ['title', 'location']))
      .toEqual({ title: 'Gala' });
  });

  it('preserves an explicit empty string (a real clear)', () => {
    expect(pickWhitelisted({ location: '' }, ['location'])).toEqual({ location: '' });
  });

  it('trims strings but leaves other types alone', () => {
    expect(pickWhitelisted({ title: '  Gala  ', memberPrice: 20, figure: null },
      ['title', 'memberPrice', 'figure']))
      .toEqual({ title: 'Gala', memberPrice: 20, figure: null });
  });

  it('returns an empty object for non-object input', () => {
    expect(pickWhitelisted(null, ['title'])).toEqual({});
    expect(pickWhitelisted('nope', ['title'])).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/fields.test.js`
Expected: FAIL — cannot resolve `src/api/chapter-admin/services/fields.js`.

- [ ] **Step 3: Implement**

```js
'use strict';

/**
 * Keep only whitelisted keys from an input object, trimming string values.
 *
 * Pure — no Strapi, no I/O. Anything not on the list is silently dropped, which
 * is what makes this the enforcement point for "a chapter admin may not write
 * `chapter`, `role`, or `status`". Fields absent from the input are omitted, not
 * blanked, so a partial payload cannot erase data.
 */
function pickWhitelisted(input, allowedFields) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const field of allowedFields) {
    if (!(field in input)) continue;
    const value = input[field];
    out[field] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

module.exports = { pickWhitelisted };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/fields.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/services/fields.js tests/unit/fields.test.js
git commit -m "feat: field whitelist helper for chapter-admin writes"
```

---

### Task 3: Scope assertion

**Files:**
- Create: `src/api/chapter-admin/services/scope.js`
- Test: `tests/unit/scope.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { assertChapterScope, ScopeError } from '../../src/api/chapter-admin/services/scope.js';

describe('assertChapterScope', () => {
  it('allows a chapter the user administers', () => {
    expect(assertChapterScope([1, 2], 1)).toBe(true);
  });

  it('rejects a chapter the user does not administer', () => {
    expect(() => assertChapterScope([1, 2], 3)).toThrow(ScopeError);
  });

  it('rejects when the user administers nothing', () => {
    expect(() => assertChapterScope([], 1)).toThrow(ScopeError);
    expect(() => assertChapterScope(undefined, 1)).toThrow(ScopeError);
  });

  it('rejects a missing target rather than defaulting open', () => {
    for (const bad of [null, undefined, '']) {
      expect(() => assertChapterScope([1], bad)).toThrow(ScopeError);
    }
  });

  it('compares ids as strings so numeric ids and documentIds both work', () => {
    expect(assertChapterScope(['1'], 1)).toBe(true);
    expect(assertChapterScope([1], '1')).toBe(true);
    expect(assertChapterScope(['abc123'], 'abc123')).toBe(true);
  });

  it('does not treat a substring match as a hit', () => {
    expect(() => assertChapterScope(['12'], '1')).toThrow(ScopeError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/scope.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure half**

```js
'use strict';

class ScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeError';
  }
}

/**
 * The core invariant of the whole design.
 *
 * Pure. Throws unless `targetChapterId` is one of `administeredChapterIds`.
 * A missing target throws rather than passing — failing closed matters more
 * here than a helpful error.
 *
 * Ids are compared as strings because Strapi 5 hands back numeric `id` in some
 * paths and string `documentId` in others; callers should not have to care.
 */
function assertChapterScope(administeredChapterIds, targetChapterId) {
  if (targetChapterId === null || targetChapterId === undefined || targetChapterId === '') {
    throw new ScopeError('No target chapter on this request');
  }
  const allowed = (administeredChapterIds || []).map(String);
  if (!allowed.includes(String(targetChapterId))) {
    throw new ScopeError('Chapter not administered by this user');
  }
  return true;
}

module.exports = { assertChapterScope, ScopeError };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/scope.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/services/scope.js tests/unit/scope.test.js
git commit -m "feat: chapter scope assertion"
```

---

### Task 4: Slug generation

**Files:**
- Create: `src/api/chapter-admin/services/slug.js`
- Test: `tests/unit/slug.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { slugify, buildSlug, nextAvailableSlug } from '../../src/api/chapter-admin/services/slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Spring Gala 2026')).toBe('spring-gala-2026');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('AREAA: “A-List” — Awards!!')).toBe('areaa-a-list-awards');
  });

  it('strips accents', () => {
    expect(slugify('Café Night')).toBe('cafe-night');
  });

  it('returns empty string for input with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify(null)).toBe('');
  });
});

describe('buildSlug', () => {
  it('prefixes with the chapter slug', () => {
    expect(buildSlug('boston', 'Spring Gala')).toBe('boston-spring-gala');
  });

  it('throws on a title that slugifies to nothing', () => {
    expect(() => buildSlug('boston', '!!!')).toThrow();
  });
});

describe('nextAvailableSlug', () => {
  it('returns the desired slug when free', () => {
    expect(nextAvailableSlug('boston-gala', [])).toBe('boston-gala');
  });

  it('appends -2 on the first collision', () => {
    expect(nextAvailableSlug('boston-gala', ['boston-gala'])).toBe('boston-gala-2');
  });

  it('skips past runs of taken suffixes', () => {
    expect(nextAvailableSlug('boston-gala', ['boston-gala', 'boston-gala-2', 'boston-gala-3']))
      .toBe('boston-gala-4');
  });

  it('is not confused by unrelated slugs sharing a prefix', () => {
    expect(nextAvailableSlug('boston-gala', ['boston-gala-dinner'])).toBe('boston-gala');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/slug.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

/**
 * Slug helpers. Pure — the caller supplies the set of already-taken slugs.
 *
 * These carry the whole uniqueness invariant, because there is no unique index
 * on `slug` in the database (verified: `slug varchar(255) null`). Strapi 5
 * enforces uid uniqueness only in the admin UI, so a duplicate written through
 * the content API is accepted silently and the loser becomes unreachable —
 * `events/[slug].astro` filters by slug and takes `[0]`.
 */

const MAX_SLUG_LENGTH = 80;

function slugify(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/** `boston` + `Spring Gala` -> `boston-spring-gala`. */
function buildSlug(chapterSlug, title) {
  const base = slugify(title);
  if (!base) {
    throw new Error('Cannot build a slug from a title with no alphanumeric characters');
  }
  const prefix = slugify(chapterSlug);
  return prefix ? `${prefix}-${base}` : base;
}

/** First free variant of `desired`: itself, then -2, -3, … */
function nextAvailableSlug(desired, taken) {
  const used = new Set(taken || []);
  if (!used.has(desired)) return desired;
  let n = 2;
  while (used.has(`${desired}-${n}`)) n += 1;
  return `${desired}-${n}`;
}

module.exports = { slugify, buildSlug, nextAvailableSlug, MAX_SLUG_LENGTH };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/slug.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/services/slug.js tests/unit/slug.test.js
git commit -m "feat: chapter-prefixed slug generation with collision handling"
```

---

### Task 5: Upload validation

**Files:**
- Create: `src/api/chapter-admin/services/media.js`
- Test: `tests/unit/media.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { validateUpload, ALLOWED_MIME, MAX_BYTES } from '../../src/api/chapter-admin/services/media.js';

describe('validateUpload', () => {
  it('accepts each allowed raster type', () => {
    for (const mimetype of ALLOWED_MIME) {
      expect(validateUpload({ mimetype, size: 1024 })).toEqual({ ok: true });
    }
  });

  it('rejects SVG — it is script-capable and served from our own origin', () => {
    const result = validateUpload({ mimetype: 'image/svg+xml', size: 1024 });
    expect(result.ok).toBe(false);
  });

  it('rejects non-images', () => {
    for (const mimetype of ['application/pdf', 'text/html', 'application/octet-stream']) {
      expect(validateUpload({ mimetype, size: 1024 }).ok).toBe(false);
    }
  });

  it('rejects a missing mimetype rather than defaulting open', () => {
    expect(validateUpload({ size: 1024 }).ok).toBe(false);
  });

  it('rejects files over the cap', () => {
    expect(validateUpload({ mimetype: 'image/png', size: MAX_BYTES + 1 }).ok).toBe(false);
  });

  it('accepts a file exactly at the cap', () => {
    expect(validateUpload({ mimetype: 'image/png', size: MAX_BYTES })).toEqual({ ok: true });
  });

  it('rejects empty or malformed sizes', () => {
    for (const size of [0, -1, undefined, 'big']) {
      expect(validateUpload({ mimetype: 'image/png', size }).ok).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/media.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure half**

```js
'use strict';

/**
 * Raster only, deliberately. Uploads are served from the same CloudFront
 * distribution as the site under /uploads/*, so they share its origin. SVG is
 * an XML document that can carry <script>, which would make an uploaded SVG
 * stored XSS on our own domain. Do not add 'image/svg+xml' to this list.
 */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

/** Pure. `{ ok: true }` or `{ ok: false, reason }`. */
function validateUpload({ mimetype, size } = {}) {
  if (!mimetype || !ALLOWED_MIME.includes(mimetype)) {
    return { ok: false, reason: `Unsupported file type. Allowed: ${ALLOWED_MIME.join(', ')}` };
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, reason: 'File is empty or its size could not be read' };
  }
  if (size > MAX_BYTES) {
    return { ok: false, reason: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB limit` };
  }
  return { ok: true };
}

module.exports = { validateUpload, ALLOWED_MIME, MAX_BYTES };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/media.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole unit suite and commit**

```bash
npx vitest run tests/unit
git add src/api/chapter-admin/services/media.js tests/unit/media.test.js
git commit -m "feat: upload validation, raster-only"
```

Expected: PASS, 29 tests across 4 files.

---

## Chunk 2: Role bootstrap

### Task 6: Create the Chapter Admin role on boot

`src/index.js` currently looks a role up by `type` and returns early when it is absent — it never creates one. `Chapter Admin` does not exist, so it must be created before anything can be granted to it.

Because `user.role` is `manyToOne`, a Chapter Admin is *not* also Authenticated. The new role therefore has to carry the Authenticated grants as well, or chapter admins lose their own profile page.

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Read the existing bootstrap**

Run: `sed -n '1,60p' src/index.js`
Note the existing `AUTHENTICATED_GRANTS` array and its idempotent grant loop — the new code mirrors that shape.

- [ ] **Step 2: Replace the file**

```js
'use strict';

// Self-service permissions the member area relies on. Granted to the built-in
// Authenticated role on boot so the profile page works without a manual admin
// toggle (and so it survives fresh DBs / new environments).
const AUTHENTICATED_GRANTS = [
  'plugin::users-permissions.user.updateMe',
  'plugin::users-permissions.auth.changePassword',
  'plugin::users-permissions.user.directory',
];

// Chapter admins are ordinary up_users with an elevated role — never Strapi
// admin-panel seats, which are billed per user. `user.role` is manyToOne, so a
// Chapter Admin is NOT also Authenticated: this role must repeat the
// Authenticated grants or chapter admins lose their own profile page.
//
// Capability lives here; SCOPE lives in user.administeredChapters and is
// enforced per-request in src/api/chapter-admin. Both are required.
const CHAPTER_ADMIN_ROLE = {
  name: 'Chapter Admin',
  description:
    "Manages one or more chapters' own content through /api/chapter-admin. Scope is " +
    'controlled by the user\'s administeredChapters relation, not by this role.',
  type: 'chapter_admin',
};

const CHAPTER_ADMIN_GRANTS = [
  ...AUTHENTICATED_GRANTS,
  'api::chapter-admin.chapter-admin.listEvents',
  'api::chapter-admin.chapter-admin.createEvent',
  'api::chapter-admin.chapter-admin.updateEvent',
  'api::chapter-admin.chapter-admin.deleteEvent',
  'api::chapter-admin.chapter-admin.uploadMedia',
];

async function grant(strapi, roleId, actions) {
  for (const action of actions) {
    const existing = await strapi
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: roleId } });

    if (!existing) {
      await strapi
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: roleId } });
    }
  }
}

module.exports = {
  register(/* { strapi } */) {},

  async bootstrap({ strapi }) {
    const authenticated = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });

    if (authenticated) {
      await grant(strapi, authenticated.id, AUTHENTICATED_GRANTS);
    }

    // Create-or-find, then grant. Idempotent: safe on every boot.
    let chapterAdmin = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: CHAPTER_ADMIN_ROLE.type } });

    if (!chapterAdmin) {
      chapterAdmin = await strapi
        .query('plugin::users-permissions.role')
        .create({ data: CHAPTER_ADMIN_ROLE });
      strapi.log.info(`Created the "${CHAPTER_ADMIN_ROLE.name}" role.`);
    }

    await grant(strapi, chapterAdmin.id, CHAPTER_ADMIN_GRANTS);
  },
};
```

- [ ] **Step 3: Boot and confirm the role exists**

The routes those grants name do not exist yet, so Strapi will ignore the unknown actions — that is expected and harmless. The role itself must appear.

```bash
npm run dev
# wait for "Server listening", then Ctrl-C
sqlite3 .tmp/data.db "SELECT id, name, type FROM up_roles;"
```

Expected: a row `Chapter Admin | chapter_admin` alongside `public` and `authenticated`.

- [ ] **Step 4: Boot again to prove idempotency**

```bash
npm run dev   # Ctrl-C once listening
sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_roles WHERE type='chapter_admin';"
```

Expected: `1`. A second row means the create-or-find is wrong.

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat: create and grant the Chapter Admin role on bootstrap"
```

---

## Chunk 3: API scaffold and scope resolution

### Task 7: Scaffold the chapter-admin API

Prove the routes load and the permission matrix sees them before building any logic behind them. This is the assumption most likely to cost a day if it is wrong.

**Files:**
- Create: `src/api/chapter-admin/controllers/chapter-admin.js`
- Create: `src/api/chapter-admin/routes/chapter-admin.js`

- [ ] **Step 1: Create the controller with one trivial action**

```js
'use strict';

/**
 * chapter-admin controller.
 *
 * This API deliberately has no content-type. Strapi loads routes, controllers
 * and services independently of content-types
 * (@strapi/core/dist/loaders/apis.js), and users-permissions builds its action
 * list from CONTROLLERS, as `api::<api>.<controller>.<action>`
 * (plugin-users-permissions/server/services/users-permissions.js). So every
 * method named here becomes a togglable permission on the Chapter Admin role.
 *
 * Handlers are assembled from services/ — nothing but wiring belongs in here.
 */

module.exports = {
  async whoami(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    ctx.body = { ok: true, userId: ctx.state.user.id };
  },
};
```

- [ ] **Step 2: Create the routes file**

```js
'use strict';

/**
 * chapter-admin routes, mounted under /api/chapter-admin/*.
 *
 * Every route is Authenticated-plus-role: users-permissions rejects the request
 * before the handler runs unless the caller's role has the matching action
 * granted. That is the CAPABILITY check. The SCOPE check — which chapter — is
 * enforced inside each handler and is not expressible in this table.
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/chapter-admin/whoami',
      handler: 'chapter-admin.whoami',
    },
  ],
};
```

- [ ] **Step 3: Boot and confirm the action is registered**

```bash
npm run dev   # Ctrl-C once listening
sqlite3 .tmp/data.db \
  "SELECT action FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: nothing yet — `whoami` is not in `CHAPTER_ADMIN_GRANTS`. That is the point of the next step.

- [ ] **Step 4: Confirm the action is *visible* to the permission system**

```bash
sqlite3 .tmp/data.db "SELECT id FROM up_roles WHERE type='chapter_admin';"
# then, in the admin UI at http://localhost:1337/admin
# Settings → Users & Permissions → Roles → Chapter Admin
```

Expected: a `Chapter-admin` section listing `whoami`. **If this section is missing, stop** — the content-type-less API assumption is wrong for this Strapi version and the plan needs rework before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/
git commit -m "feat: scaffold the chapter-admin API"
```

---

### Task 8: Resolve the caller's administered chapters

`ctx.state.user` does not populate relations, so `administeredChapters` needs a query. It is memoized on the context because several handlers touch it in one request.

**Files:**
- Modify: `src/api/chapter-admin/services/scope.js`
- Test: `tests/unit/scope.test.js` (extend)

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/scope.test.js`:

```js
import { resolveAdministeredChapters } from '../../src/api/chapter-admin/services/scope.js';

describe('resolveAdministeredChapters', () => {
  const fakeStrapi = (chapters) => ({
    documents: () => ({
      findOne: async () => ({ administeredChapters: chapters }),
    }),
  });

  it('returns the ids of the chapters the user administers', async () => {
    const ctx = { state: { user: { documentId: 'u1' } } };
    const ids = await resolveAdministeredChapters(ctx, fakeStrapi([
      { id: 1, slug: 'boston' }, { id: 2, slug: 'seattle' },
    ]));
    expect(ids).toEqual([1, 2]);
  });

  it('returns an empty array when the user administers nothing', async () => {
    const ctx = { state: { user: { documentId: 'u1' } } };
    expect(await resolveAdministeredChapters(ctx, fakeStrapi([]))).toEqual([]);
    expect(await resolveAdministeredChapters({ state: { user: { documentId: 'u2' } } },
      fakeStrapi(null))).toEqual([]);
  });

  it('queries once per request and memoizes on the context', async () => {
    let calls = 0;
    const counting = {
      documents: () => ({
        findOne: async () => { calls += 1; return { administeredChapters: [{ id: 1 }] }; },
      }),
    };
    const ctx = { state: { user: { documentId: 'u1' } } };
    await resolveAdministeredChapters(ctx, counting);
    await resolveAdministeredChapters(ctx, counting);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/scope.test.js`
Expected: FAIL — `resolveAdministeredChapters is not a function`.

- [ ] **Step 3: Implement**

Append to `src/api/chapter-admin/services/scope.js`, before `module.exports`:

```js
/**
 * Load the ids of the chapters this request's user administers.
 *
 * `ctx.state.user` arrives without relations, so this costs one query. It is
 * memoized on the context because several handlers read it per request.
 *
 * `strapiInstance` is injected so this is testable without booting Strapi;
 * production callers pass the global.
 */
async function resolveAdministeredChapters(ctx, strapiInstance = global.strapi) {
  if (ctx.state.administeredChapterIds) return ctx.state.administeredChapterIds;

  const user = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findOne({
      documentId: ctx.state.user.documentId,
      populate: { administeredChapters: { fields: ['slug'] } },
    });

  const ids = (user?.administeredChapters ?? []).map((c) => c.id);
  ctx.state.administeredChapterIds = ids;
  return ids;
}
```

and add it to the exports:

```js
module.exports = { assertChapterScope, ScopeError, resolveAdministeredChapters };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/scope.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/services/scope.js tests/unit/scope.test.js
git commit -m "feat: per-request administered-chapter resolution"
```

---

## Chunk 4: Resource factory and the events routes

### Task 9: The chapter-scoped resource factory

The crux. Read the scoping rule before writing it:

```
create → target chapter read from the PAYLOAD, must be ∈ administeredChapters
update → target chapter read from the EXISTING DB RECORD, never the payload
delete → same as update
```

`chapter` and `slug` are absent from every whitelist, so neither can be reassigned after creation.

**Files:**
- Create: `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Write the factory**

```js
'use strict';

const { pickWhitelisted } = require('./fields');
const { assertChapterScope, resolveAdministeredChapters } = require('./scope');
const { buildSlug, nextAvailableSlug } = require('./slug');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Build the CRUD handler set for a content type owned by a chapter.
 *
 * @param {string}   uid            e.g. 'api::event.event'
 * @param {string[]} editableFields whitelist; MUST NOT contain 'chapter' or 'slug'
 * @param {boolean}  hasSlug        generate a chapter-prefixed slug on create
 * @param {string[]} listFields     fields returned by list()
 */
function chapterScopedResource({ uid, editableFields, hasSlug = false, listFields = null }) {
  if (editableFields.includes('chapter') || editableFields.includes('slug')) {
    // A misconfiguration here silently reopens chapter reassignment, so fail loudly at load.
    throw new Error(`${uid}: 'chapter' and 'slug' must never be editable`);
  }

  const docs = () => strapi.documents(uid);

  /** Read the owning chapter id off a stored record — never off the payload. */
  async function ownerChapterId(documentId) {
    const record = await docs().findOne({
      documentId,
      populate: { chapter: { fields: ['id'] } },
      status: 'draft', // the draft always exists; the published row may not
    });
    return { record, chapterId: record?.chapter?.id ?? null };
  }

  /** All slugs already taken for this type, for collision avoidance. */
  async function takenSlugs(prefix) {
    const rows = await docs().findMany({
      filters: { slug: { $startsWith: prefix } },
      fields: ['slug'],
      limit: -1,
      status: 'draft',
    });
    return rows.map((r) => r.slug).filter(Boolean);
  }

  return {
    async list(ctx) {
      const administered = await resolveAdministeredChapters(ctx);
      if (administered.length === 0) return ctx.forbidden('No administered chapters');

      const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
      const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(ctx.query.pageSize, 10) || DEFAULT_PAGE_SIZE)
      );

      const filters = { chapter: { id: { $in: administered } } };
      const [rows, total] = await Promise.all([
        docs().findMany({
          filters,
          ...(listFields ? { fields: listFields } : {}),
          populate: { chapter: { fields: ['name', 'slug'] } },
          sort: ['updatedAt:desc'],
          limit: pageSize,
          start: (page - 1) * pageSize,
          status: 'draft',
        }),
        docs().count({ filters }),
      ]);

      ctx.body = {
        data: rows,
        meta: {
          pagination: {
            page, pageSize, total,
            pageCount: Math.max(1, Math.ceil(total / pageSize)),
          },
        },
      };
    },

    async create(ctx) {
      const administered = await resolveAdministeredChapters(ctx);
      const input = ctx.request.body?.data ?? ctx.request.body ?? {};

      // CREATE is the one verb that reads the chapter from the payload.
      const chapterId = input.chapter;
      assertChapterScope(administered, chapterId);

      const data = pickWhitelisted(input, editableFields);
      data.chapter = chapterId;

      if (hasSlug) {
        const chapter = await strapi.documents('api::chapter.chapter').findFirst({
          filters: { id: chapterId },
          fields: ['slug'],
          status: 'draft',
        });
        if (!chapter?.slug) return ctx.badRequest('Chapter has no slug');
        const desired = buildSlug(chapter.slug, data.title);
        data.slug = nextAvailableSlug(desired, await takenSlugs(desired));
      }

      // Publish explicitly: all these types are draftAndPublish, and the
      // documents API writes a DRAFT unless told otherwise. Without this the
      // save succeeds and is invisible on the live site.
      const created = await docs().create({ data, status: 'published' });
      ctx.body = { data: created };
    },

    async update(ctx) {
      const administered = await resolveAdministeredChapters(ctx);
      const { id: documentId } = ctx.params;

      // UPDATE reads the chapter from the STORED RECORD. Any `chapter` in the
      // payload is ignored — it is not on the whitelist — which is what stops
      // an admin pulling another chapter's record into their own scope.
      const { record, chapterId } = await ownerChapterId(documentId);
      if (!record) return ctx.notFound();
      assertChapterScope(administered, chapterId);

      const input = ctx.request.body?.data ?? ctx.request.body ?? {};
      const data = pickWhitelisted(input, editableFields);

      const updated = await docs().update({ documentId, data, status: 'published' });
      ctx.body = { data: updated };
    },

    async delete(ctx) {
      const administered = await resolveAdministeredChapters(ctx);
      const { id: documentId } = ctx.params;

      const { record, chapterId } = await ownerChapterId(documentId);
      if (!record) return ctx.notFound();
      assertChapterScope(administered, chapterId);

      await docs().delete({ documentId });
      ctx.body = { data: { documentId } };
    },
  };
}

module.exports = { chapterScopedResource };
```

- [ ] **Step 2: Verify it loads**

Run: `node -e "require('./src/api/chapter-admin/services/resource-factory.js'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Verify the misconfiguration guard fires**

```bash
node -e "
const { chapterScopedResource } = require('./src/api/chapter-admin/services/resource-factory.js');
try { chapterScopedResource({ uid: 'x', editableFields: ['chapter'] }); console.log('NO GUARD'); }
catch (e) { console.log('guarded:', e.message); }
"
```

Expected: `guarded: x: 'chapter' and 'slug' must never be editable`.

- [ ] **Step 4: Commit**

```bash
git add src/api/chapter-admin/services/resource-factory.js
git commit -m "feat: chapter-scoped CRUD factory"
```

---

### Task 10: Wire the events routes

**Files:**
- Modify: `src/api/chapter-admin/controllers/chapter-admin.js`
- Modify: `src/api/chapter-admin/routes/chapter-admin.js`

- [ ] **Step 1: Add the events handlers to the controller**

Replace the controller with:

```js
'use strict';

const { chapterScopedResource } = require('../services/resource-factory');
const { ScopeError } = require('../services/scope');

// Whitelist mirrors api::event.event minus `chapter` and `slug`, both of which
// are set at create time and immutable after.
const events = chapterScopedResource({
  uid: 'api::event.event',
  hasSlug: true,
  editableFields: [
    'title', 'startsAt', 'endsAt', 'description',
    'memberPrice', 'publicPrice', 'location', 'locationUrl', 'figure',
  ],
});

/** Turn a ScopeError into a 403; let everything else surface normally. */
const guarded = (handler) => async (ctx) => {
  try {
    return await handler(ctx);
  } catch (err) {
    if (err instanceof ScopeError) return ctx.forbidden(err.message);
    throw err;
  }
};

module.exports = {
  async whoami(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();
    ctx.body = { ok: true, userId: ctx.state.user.id };
  },

  listEvents: guarded(events.list),
  createEvent: guarded(events.create),
  updateEvent: guarded(events.update),
  deleteEvent: guarded(events.delete),
};
```

- [ ] **Step 2: Add the routes**

Replace the `routes` array with:

```js
    { method: 'GET',    path: '/chapter-admin/whoami',      handler: 'chapter-admin.whoami' },
    { method: 'GET',    path: '/chapter-admin/events',      handler: 'chapter-admin.listEvents' },
    { method: 'POST',   path: '/chapter-admin/events',      handler: 'chapter-admin.createEvent' },
    { method: 'PUT',    path: '/chapter-admin/events/:id',  handler: 'chapter-admin.updateEvent' },
    { method: 'DELETE', path: '/chapter-admin/events/:id',  handler: 'chapter-admin.deleteEvent' },
```

- [ ] **Step 3: Boot and confirm the grants land**

```bash
npm run dev   # Ctrl-C once listening
sqlite3 .tmp/data.db \
  "SELECT action FROM up_permissions WHERE action LIKE 'api::chapter-admin%' ORDER BY action;"
```

Expected: the four event actions plus `uploadMedia` — the five listed in `CHAPTER_ADMIN_GRANTS`. `whoami` is absent by design.

- [ ] **Step 4: Commit**

```bash
git add src/api/chapter-admin/
git commit -m "feat: chapter-scoped events routes"
```

---

## Chunk 5: Media

### Task 11: The upload handler

**Files:**
- Modify: `src/api/chapter-admin/services/media.js`
- Modify: `src/api/chapter-admin/controllers/chapter-admin.js`
- Modify: `src/api/chapter-admin/routes/chapter-admin.js`

- [ ] **Step 1: Add the impure half to `media.js`**

Append before `module.exports`, and add `uploadImage` to the exports:

```js
/**
 * Validate and store one uploaded image.
 *
 * Delegates to the upload plugin's own service so the S3/CloudFront provider
 * config in config/plugins.js is reused unchanged. The stock
 * `plugin::upload.content-api.upload` permission is deliberately NOT granted to
 * the Chapter Admin role — this endpoint is the only upload path, so the
 * validation above cannot be bypassed.
 *
 * There is no delete counterpart on purpose: admins detach media from records,
 * they do not delete from the shared library.
 */
async function uploadImage(file, strapiInstance = global.strapi) {
  const check = validateUpload({ mimetype: file?.mimetype, size: file?.size });
  if (!check.ok) {
    const err = new Error(check.reason);
    err.name = 'UploadValidationError';
    throw err;
  }

  const [uploaded] = await strapiInstance
    .plugin('upload')
    .service('upload')
    .upload({ data: {}, files: file });

  return uploaded;
}
```

- [ ] **Step 2: Add the controller action**

```js
const { uploadImage } = require('../services/media');

// …inside module.exports:
  async uploadMedia(ctx) {
    const file = ctx.request.files?.files;
    if (!file || Array.isArray(file)) {
      return ctx.badRequest('Attach exactly one file under the field name "files"');
    }
    try {
      const uploaded = await uploadImage(file);
      ctx.body = { data: { id: uploaded.id, url: uploaded.url, name: uploaded.name } };
    } catch (err) {
      if (err.name === 'UploadValidationError') return ctx.badRequest(err.message);
      throw err;
    }
  },
```

- [ ] **Step 3: Add the route**

```js
    { method: 'POST', path: '/chapter-admin/media', handler: 'chapter-admin.uploadMedia' },
```

- [ ] **Step 4: Boot and confirm nothing regressed**

Run: `npm run dev` — Ctrl-C once listening. Expect no startup errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/
git commit -m "feat: validated chapter-admin media upload"
```

---

## Chunk 6: Integration proof

### Task 12: Integration harness

**Files:**
- Create: `tests/integration/helpers.js`

- [ ] **Step 1: Write the harness**

```js
import { createStrapi, compileStrapi } from '@strapi/strapi';

let instance;

export async function boot() {
  if (!instance) {
    instance = await createStrapi(await compileStrapi()).load();
    instance.log.level = 'error';
    await instance.server.mount();
  }
  return instance;
}

export async function shutdown() {
  if (instance) { await instance.destroy(); instance = null; }
}

/** Mint a JWT for an existing user, as /api/auth/local would. */
export function jwtFor(strapi, userId) {
  return strapi.plugin('users-permissions').service('jwt').issue({ id: userId });
}

/** Create a chapter admin who administers `chapterIds`. */
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
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/helpers.js
git commit -m "test: integration harness for booted Strapi"
```

---

### Task 13: End-to-end events tests

The tests that matter. Everything before this is unit-level; this is the proof that capability, scope, slugs, and publish all hold together against a real database.

**Files:**
- Create: `tests/integration/events.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin } from './helpers.js';

let strapi, chapterA, chapterB, adminA, tokenA;

beforeAll(async () => {
  strapi = await boot();
  const chapters = await strapi.documents('api::chapter.chapter')
    .findMany({ fields: ['slug'], limit: 2, status: 'published' });
  [chapterA, chapterB] = chapters;

  adminA = await makeChapterAdmin(strapi, {
    email: `admin-a-${Date.now()}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = jwtFor(strapi, adminA.id);
}, 60000);

afterAll(async () => { await shutdown(); });

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);

describe('POST /api/chapter-admin/events', () => {
  it('creates an event in an administered chapter, published and slugged', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: 'Spring Gala', chapter: chapterA.id, location: 'SF' });

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe(`${chapterA.slug}-spring-gala`);

    // The whole point of CA11: it must be visible to a PUBLISHED read.
    const published = await strapi.documents('api::event.event')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('de-collides a duplicate title within the same chapter', async () => {
    const body = { title: 'Repeat Night', chapter: chapterA.id };
    const first = await auth(api().post('/api/chapter-admin/events')).send(body);
    const second = await auth(api().post('/api/chapter-admin/events')).send(body);

    expect(first.body.data.slug).toBe(`${chapterA.slug}-repeat-night`);
    expect(second.body.data.slug).toBe(`${chapterA.slug}-repeat-night-2`);
  });

  it('refuses to create in a chapter the caller does not administer', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: 'Trespass', chapter: chapterB.id });
    expect(res.status).toBe(403);
  });

  it('ignores non-whitelisted fields in the payload', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: 'Clean', chapter: chapterA.id, slug: 'attacker-chosen', publishedAt: null });
    expect(res.body.data.slug).toBe(`${chapterA.slug}-clean`);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await api().post('/api/chapter-admin/events')
      .send({ title: 'Anon', chapter: chapterA.id });
    expect([401, 403]).toContain(res.status);
  });
});

describe('PUT /api/chapter-admin/events/:id', () => {
  it('updates an own event', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: 'Editable', chapter: chapterA.id });
    const res = await auth(api().put(`/api/chapter-admin/events/${created.body.data.documentId}`))
      .send({ location: 'Oakland' });

    expect(res.status).toBe(200);
    expect(res.body.data.location).toBe('Oakland');
  });

  it('cannot move an event to another chapter via the payload', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: 'Stay Put', chapter: chapterA.id });
    await auth(api().put(`/api/chapter-admin/events/${created.body.data.documentId}`))
      .send({ chapter: chapterB.id, location: 'Nice try' });

    const after = await strapi.documents('api::event.event').findOne({
      documentId: created.body.data.documentId,
      populate: { chapter: { fields: ['id'] } },
      status: 'draft',
    });
    expect(after.chapter.id).toBe(chapterA.id);
  });

  it("refuses to update another chapter's event", async () => {
    const foreign = await strapi.documents('api::event.event').create({
      data: { title: 'Theirs', slug: `${chapterB.slug}-theirs`, chapter: chapterB.id },
      status: 'published',
    });
    const res = await auth(api().put(`/api/chapter-admin/events/${foreign.documentId}`))
      .send({ location: 'Hijacked' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/chapter-admin/events', () => {
  it('lists only administered chapters events', async () => {
    const res = await auth(api().get('/api/chapter-admin/events'));
    expect(res.status).toBe(200);
    const chapterIds = res.body.data.map((e) => e.chapter?.id);
    expect(chapterIds.every((id) => id === chapterA.id)).toBe(true);
  });
});

describe('DELETE /api/chapter-admin/events/:id', () => {
  it("refuses to delete another chapter's event", async () => {
    const foreign = await strapi.documents('api::event.event').create({
      data: { title: 'Not Yours', slug: `${chapterB.slug}-not-yours`, chapter: chapterB.id },
      status: 'published',
    });
    const res = await auth(api().delete(`/api/chapter-admin/events/${foreign.documentId}`));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Install supertest**

```bash
npm install --save-dev supertest
```

- [ ] **Step 3: Seed a clean database first**

The tests assume at least two chapters exist. `make seed` must be run with the dev server **stopped** — both open the same SQLite file.

```bash
make fresh
```

- [ ] **Step 4: Run the integration suite**

Run: `npx vitest run tests/integration`
Expected: PASS, 10 tests. The cross-chapter cases (403s) are the ones that matter — if any of them returns 200, stop and fix before going further.

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: PASS, 39 tests across 6 files.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/events.test.js package.json package-lock.json
git commit -m "test: end-to-end chapter-scoped events"
```

---

## Done when

- `npm test` is green.
- A chapter admin JWT can create, list, update, and delete events in their own chapter, and every one of those verbs returns 403 against another chapter.
- A created event is visible to a `status: 'published'` read — not merely written as a draft.
- Slugs are chapter-prefixed and de-collide.
- `sqlite3 .tmp/data.db "SELECT action FROM up_permissions WHERE action LIKE 'api::chapter-admin%'"` lists the five granted actions.

## Not in this plan

Per the spec's rollout, these are plans 2 and 3:

- Every route other than `/events` and `/media` — `/news`, `/page`, `/committees`, `/chapter`, `/members`, `/partners`, `/submissions`. They reuse the factory and the scope helper, so they are repetition against a proven spine rather than new design.
- All frontend work: identity plumbing, `/account/chapter/*`, `FormField` additions, the multi-select picker.
- TipTap and the `blocksToDoc` / `docToBlocks` converters.
