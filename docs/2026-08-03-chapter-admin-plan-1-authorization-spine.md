# Chapter Admin — Plan 1: Strapi Authorization Spine

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Strapi-side authorization spine that lets chapter admins write their own chapter's content through the content API, proven end-to-end on `/events` and `/media` with no UI.

**Architecture:** A content-type-less API at `src/api/chapter-admin/` exposes routes under `/api/chapter-admin/*`. A `Chapter Admin` users-permissions role grants *capability*; the `administeredChapters` relation grants *scope*. All authorization logic lives in pure functions taking plain data, so the bulk of the suite needs no booted Strapi. A single `chapterScopedResource` factory combines them with Strapi's document service.

**Tech Stack:** Strapi 5.45.1, **Node 24**, CommonJS, Vitest 3, SQLite (local dev).

**Spec:** [`2026-08-03-chapter-admin-authoring-design.md`](./2026-08-03-chapter-admin-authoring-design.md). Implements **rollout step 1 only**.

---

## Preconditions

Read this section before Task 1. Three environment facts will each cost you an hour if you meet them as a mystery failure.

**1. Node 24 is required.** The installed `better-sqlite3` is compiled for `NODE_MODULE_VERSION 137` (Node 24). Booting Strapi under Node 22 dies with `ERR_DLOPEN_FAILED` before any of this plan's verification steps can run.

```bash
node --version    # must be v24.x
# if not: nvm use 24, or `npm rebuild better-sqlite3` under your current node
```

**2. Every command assumes this working directory.** Agent shell invocations reset cwd between calls, so each block below re-establishes it. Do not strip the `cd`.

```
/Users/nk/Projects/AREAA/areaa-cms
```

**3. Never use `npm run dev` for verification.** `strapi develop` is a foreground watcher with no terminating condition — an agentic worker cannot Ctrl-C it. Task 6 creates `scripts/boot-once.js`, which boots Strapi programmatically, runs bootstrap, and exits. Use it for every "did the role/permission land" check. It works because `Strapi.load()` calls `bootstrap()` directly (`@strapi/core/dist/Strapi.js:301-303`), which runs plugin then user BOOTSTRAP (`:385`, `:389`).

Also: the dev server must be **stopped** during any step that boots Strapi or runs tests — both open the same SQLite file. This is the one place the repo's CLAUDE.md convention ("leave the dev server running after a migration") does not apply.

---

## Verified Assumptions

Checked against the installed Strapi 5.45.1 by booting it and executing the calls. Do not re-litigate; do re-check if the Strapi version changes.

| Assumption | Verdict |
|---|---|
| A content-type-less API loads and appears in the role matrix | ✅ `loaders/apis.js:59-79`; `register-routes.js:86-105` sets scope `api::chapter-admin.chapter-admin.<action>` |
| CJS `module.exports` + ESM `import` under Vitest 3 | ✅ Verified by running all four unit files: 32/32 pass |
| `findMany({ limit, start })` pagination; `limit: -1` means unbounded | ✅ `@strapi/utils` `SHARED_QUERY_PARAM_KEYS`, `convertLimitQueryParams` |
| `docs().count({ filters })` exists, same filter shape | ✅ `document-service/repository.js` |
| `$startsWith` operator | ✅ `@strapi/utils/dist/operators.js:22` |
| `filters: { chapter: { documentId: { $in: [...] } } }` | ✅ `isValidSchemaAttribute` special-cases `documentId` |
| `create({ data, status: 'published' })` creates **and** publishes | ✅ `repository.js` `create()` tail-calls `publish()`. CA11 is safe |
| The draft row always exists; publishing keeps it | ✅ `events` holds 10 rows for 5 documents |
| `ctx.state.administeredChapterIds` collides with nothing | ✅ Strapi sets only `user`, `auth`, `isAuthenticated`, `route` |
| `instanceof ScopeError` across module boundaries | ✅ Provided `ScopeError` is always obtained by direct `require`, never via `strapi.service(...)` |
| `plugin('upload').service('upload').upload({ data: {}, files })` | ✅ Matches `services/upload.js:147`; same shape `seed.js` uses |
| `ctx.request.files.files` populated by `strapi::body` | ✅ koa-body → formidable; single file is an object, not an array |
| `server.mount()` required before supertest | ✅ `load()` never calls `mount()`; only `listen()` does |
| `fields: ['slug']` still returns `id` and `documentId` | ✅ `convertFieldsQueryParams` unions both unconditionally |

### Two assumptions that turned out FALSE

These were in the first draft of this plan and are corrected throughout. They are recorded because both look correct on inspection.

**Scope cannot be keyed on the numeric entry `id`.** `chapter` is draft-and-publish, so each chapter is two rows with different `id`s sharing one `documentId` (`boston` = `59` draft / `63` published). Populating `administeredChapters` resolves at draft status and returns the *draft* id, while any caller reading published content holds the *published* one — so an entry-id comparison rejects every legitimate request while looking like a working scope check. **Everything is keyed on `documentId`.**

**The upload service does not sniff MIME types.** Detection lives in the upload plugin's *controllers* (`prepareUploadRequest` → `enforceUploadSecurity`), which is what sets `file.detectedMimeType`; `services/upload.js:123` only prefers it if already present. Calling the service directly — which this design does, to reuse the S3 provider config — skips detection entirely. Validating `file.mimetype` would validate a client-supplied header, and an SVG posted as `image/png` would pass a raster-only allowlist. **Task 14 sniffs magic bytes.**

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `vitest.config.js` | Test runner config |
| `scripts/boot-once.js` | Boot Strapi, run bootstrap, exit — non-interactive verification |
| `src/api/chapter-admin/services/fields.js` | Pure. Whitelist an input object. |
| `src/api/chapter-admin/services/scope.js` | Pure `assertChapterScope` + injected-strapi `resolveAdministeredChapters` |
| `src/api/chapter-admin/services/slug.js` | Pure. Build and de-collide slugs. |
| `src/api/chapter-admin/services/image-sniff.js` | Pure. Magic-byte image type detection. |
| `src/api/chapter-admin/services/media.js` | `validateUpload` (pure) + `uploadImage` (injected strapi) |
| `src/api/chapter-admin/services/resource-factory.js` | Assembles CRUD handlers; takes an injected strapi so it is unit-testable |
| `src/api/chapter-admin/controllers/chapter-admin.js` | Names the actions the permission matrix sees. Wiring only. |
| `src/api/chapter-admin/routes/chapter-admin.js` | Route table |
| `tests/unit/fields.test.js` | Whitelist behaviour |
| `tests/unit/scope.test.js` | Scope assertion + administered-chapter resolution |
| `tests/unit/slug.test.js` | Slugify, build, de-collide |
| `tests/unit/image-sniff.test.js` | Magic-byte detection incl. SVG-as-PNG |
| `tests/unit/media.test.js` | Upload validation |
| `tests/unit/resource-factory.test.js` | The scoping invariant, against a fake document service |
| `tests/integration/helpers.js` | Boot/teardown, JWT minting, fixture creation |
| `tests/integration/events.test.js` | End-to-end proof |

**Modify:** `package.json` (add `vitest`, `supertest`, scripts), `src/index.js` (create + grant the role), `config/middlewares.js` (formidable size cap).

---

## Chunk 1: Test harness and pure helpers

### Task 1: Add Vitest

- [ ] **Step 1: Confirm Node 24 and install**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms
node --version
npm install --save-dev vitest@^3 supertest
```

Expected: `v24.x`, then a clean install. If Node is 22, stop and fix it — see Preconditions.

- [ ] **Step 2: Add scripts**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:unit": "vitest run tests/unit",
"test:integration": "vitest run tests/integration"
```

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // passWithNoTests so the very first run of this plan is green rather than
    // exit 1, which an executing agent would read as a failure.
    passWithNoTests: true,
    // Integration tests boot a real Strapi against one SQLite file; they cannot
    // run concurrently.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
```

- [ ] **Step 4: Verify the runner starts**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npm test
```

Expected: exit code 0, "No test files found" — the runner works and there is nothing to run yet.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add package.json package-lock.json vitest.config.js && \
  git commit -m "test: add vitest and supertest"
```

---

### Task 2: Field whitelist

The single function deciding what a chapter admin may write. It copies **only keys present in the input** — an absent field is left untouched rather than blanked. (`pages/api/profile.ts` in the frontend does the opposite and will wipe fields on a partial POST. Do not copy that.)

**Files:** Create `src/api/chapter-admin/services/fields.js`, `tests/unit/fields.test.js`

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
    expect(pickWhitelisted({ title: 'Gala', chapter: 7, role: 1, status: 'Active' }, ['title']))
      .toEqual({ title: 'Gala' });
  });

  it('omits absent fields rather than blanking them', () => {
    expect(pickWhitelisted({ title: 'Gala' }, ['title', 'location'])).toEqual({ title: 'Gala' });
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

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/fields.test.js
```

Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement**

```js
'use strict';

/**
 * Keep only whitelisted keys from an input object, trimming string values.
 *
 * Pure. Anything not on the list is silently dropped, which makes this the
 * enforcement point for "a chapter admin may not write `chapter`, `role`, or
 * `status`". Fields absent from the input are omitted rather than blanked, so a
 * partial payload cannot erase data.
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

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/fields.test.js
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/fields.js tests/unit/fields.test.js && \
  git commit -m "feat: field whitelist helper for chapter-admin writes"
```

---

### Task 3: Scope assertion

**Files:** Create `src/api/chapter-admin/services/scope.js`, `tests/unit/scope.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  assertChapterScope, ScopeError, resolveAdministeredChapters,
} from '../../src/api/chapter-admin/services/scope.js';

describe('assertChapterScope', () => {
  it('allows a documentId the user administers', () => {
    expect(assertChapterScope(['doc-a', 'doc-b'], 'doc-a')).toBe(true);
  });

  it('rejects one they do not', () => {
    expect(() => assertChapterScope(['doc-a'], 'doc-c')).toThrow(ScopeError);
  });

  it('rejects when the user administers nothing', () => {
    expect(() => assertChapterScope([], 'doc-a')).toThrow(ScopeError);
    expect(() => assertChapterScope(undefined, 'doc-a')).toThrow(ScopeError);
  });

  it('fails closed on a missing target', () => {
    for (const bad of [null, undefined, '']) {
      expect(() => assertChapterScope(['doc-a'], bad)).toThrow(ScopeError);
    }
  });

  it('does not treat a substring as a hit', () => {
    expect(() => assertChapterScope(['doc-ab'], 'doc-a')).toThrow(ScopeError);
  });
});

describe('resolveAdministeredChapters', () => {
  const fakeStrapi = (chapters) => ({
    documents: () => ({ findOne: async () => ({ administeredChapters: chapters }) }),
  });

  it('returns documentIds, not numeric entry ids', async () => {
    const ctx = { state: { user: { documentId: 'u1' } } };
    const ids = await resolveAdministeredChapters(ctx, fakeStrapi([
      { id: 55, documentId: 'chap-a', slug: 'boston' },
      { id: 57, documentId: 'chap-b', slug: 'seattle' },
    ]));
    expect(ids).toEqual(['chap-a', 'chap-b']);
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
        findOne: async () => { calls += 1; return { administeredChapters: [{ documentId: 'chap-a' }] }; },
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

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/scope.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

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
 * Pure. Throws unless `targetChapterDocumentId` is one of
 * `administeredChapterDocumentIds`. A missing target throws rather than passing
 * — failing closed matters more here than a helpful error.
 *
 * These are `documentId` strings, NEVER numeric entry ids. `chapter` is
 * draft-and-publish, so every chapter is two rows with different ids sharing one
 * documentId; comparing entry ids rejects every legitimate request while looking
 * like a working check.
 */
function assertChapterScope(administeredChapterDocumentIds, targetChapterDocumentId) {
  if (!targetChapterDocumentId) {
    throw new ScopeError('No target chapter on this request');
  }
  const allowed = (administeredChapterDocumentIds || []).map(String);
  if (!allowed.includes(String(targetChapterDocumentId))) {
    throw new ScopeError('Chapter not administered by this user');
  }
  return true;
}

/**
 * Load the documentIds of the chapters this request's user administers.
 *
 * `ctx.state.user` arrives without relations, so this costs one query, memoized
 * on the context. `strapiInstance` is injected so this is testable without a
 * boot; production callers pass the global.
 */
async function resolveAdministeredChapters(ctx, strapiInstance = global.strapi) {
  if (ctx.state.administeredChapterIds) return ctx.state.administeredChapterIds;

  const user = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findOne({
      documentId: ctx.state.user.documentId,
      populate: { administeredChapters: { fields: ['slug'] } },
    });

  const ids = (user?.administeredChapters ?? []).map((c) => c.documentId);
  ctx.state.administeredChapterIds = ids;
  return ids;
}

module.exports = { assertChapterScope, ScopeError, resolveAdministeredChapters };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/scope.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/scope.js tests/unit/scope.test.js && \
  git commit -m "feat: documentId-keyed chapter scope assertion"
```

---

### Task 4: Slug generation

**Files:** Create `src/api/chapter-admin/services/slug.js`, `tests/unit/slug.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { slugify, buildSlug, nextAvailableSlug, SlugError }
  from '../../src/api/chapter-admin/services/slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Spring Gala 2026')).toBe('spring-gala-2026');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('AREAA: "A-List" — Awards!!')).toBe('areaa-a-list-awards');
  });

  it('strips accents', () => {
    expect(slugify('Café Night')).toBe('cafe-night');
  });

  it('returns empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify('中文活动')).toBe('');
  });
});

describe('buildSlug', () => {
  it('prefixes with the chapter slug', () => {
    expect(buildSlug('boston', 'Spring Gala')).toBe('boston-spring-gala');
  });

  it('throws SlugError — not a bare Error — on an unslugifiable title', () => {
    // AREAA is the Asian Real Estate Association; CJK and Hangul event titles
    // are ordinary, not an edge case. The caller turns SlugError into a 400.
    expect(() => buildSlug('boston', '中文活动')).toThrow(SlugError);
    expect(() => buildSlug('boston', '!!!')).toThrow(SlugError);
    expect(() => buildSlug('boston', undefined)).toThrow(SlugError);
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
    expect(nextAvailableSlug('boston-gala',
      ['boston-gala', 'boston-gala-2', 'boston-gala-3'])).toBe('boston-gala-4');
  });

  it('is not confused by unrelated slugs sharing a prefix', () => {
    expect(nextAvailableSlug('boston-gala', ['boston-gala-dinner'])).toBe('boston-gala');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/slug.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Note the diacritic range is written as `̀-ͯ` escapes deliberately. A literal U+0300 immediately after `[` renders as a combining accent on the bracket and is silently mangled by editors, copy/paste, or Unicode normalization — and the failure is quiet: accents simply stop being stripped and `Café Night` becomes `caf-night`.

```js
'use strict';

/**
 * Slug helpers. Pure — the caller supplies the set of already-taken slugs.
 *
 * These carry the entire uniqueness invariant, because there is NO unique index
 * on `slug` in the database (verified: `slug varchar(255) null`). Strapi 5
 * enforces uid uniqueness only in the admin UI, so a duplicate written through
 * the content API is accepted silently and the loser becomes unreachable —
 * `events/[slug].astro` filters by slug and takes `[0]`.
 */

const MAX_SLUG_LENGTH = 80;

class SlugError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SlugError';
  }
}

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
    throw new SlugError(
      'Title must contain at least one letter or number that can be used in a URL'
    );
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

module.exports = { slugify, buildSlug, nextAvailableSlug, SlugError, MAX_SLUG_LENGTH };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/slug.test.js
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/slug.js tests/unit/slug.test.js && \
  git commit -m "feat: chapter-prefixed slug generation with collision handling"
```

---

### Task 5: Magic-byte image sniffing

The security-critical half of media upload. See Preconditions — the upload service does **not** sniff, so this is the only thing standing between an attacker-controlled `Content-Type` header and a stored SVG.

**Files:** Create `src/api/chapter-admin/services/image-sniff.js`, `tests/unit/image-sniff.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { sniffImageType } from '../../src/api/chapter-admin/services/image-sniff.js';

const png  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif'), Buffer.alloc(4)]);
const svg  = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('sniffImageType', () => {
  it('detects each allowed raster format', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(avif)).toBe('image/avif');
  });

  it('returns null for SVG — this is the attack it exists to stop', () => {
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null regardless of what the client claimed', () => {
    // An SVG posted as Content-Type: image/png. The declared type is not an
    // input here, which is the point.
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null for other non-images', () => {
    expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImageType(Buffer.from('<html></html>'))).toBeNull();
  });

  it('returns null for short or empty buffers rather than throwing', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/image-sniff.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

/**
 * Detect an image type from its leading bytes. Pure.
 *
 * This exists because Strapi's own MIME detection lives in the upload plugin's
 * CONTROLLERS (prepareUploadRequest -> enforceUploadSecurity), not its service.
 * We call the service directly in order to reuse the S3 provider config, so we
 * get no detection for free — and `file.mimetype` is just the client's
 * Content-Type header. Trusting it would let an SVG posted as image/png through
 * the raster-only allowlist and store script-bearing XML on our own origin.
 *
 * Returns a mime string or null. Never throws.
 */
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // WEBP: "RIFF" ???? "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // AVIF: ???? "ftypavif" (brand at offset 8 within the ftyp box)
  if (buf.toString('ascii', 4, 8) === 'ftyp' && buf.toString('ascii', 8, 12) === 'avif') {
    return 'image/avif';
  }

  return null;
}

module.exports = { sniffImageType };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/image-sniff.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/image-sniff.js tests/unit/image-sniff.test.js && \
  git commit -m "feat: magic-byte image sniffing"
```

---

### Task 6: Upload validation

**Files:** Create `src/api/chapter-admin/services/media.js`, `tests/unit/media.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { validateUpload, ALLOWED_MIME, MAX_BYTES }
  from '../../src/api/chapter-admin/services/media.js';

describe('validateUpload', () => {
  it('accepts each allowed raster type when the bytes agree', () => {
    for (const mime of ALLOWED_MIME) {
      expect(validateUpload({ detectedMime: mime, size: 1024 })).toEqual({ ok: true });
    }
  });

  it('rejects a null detection — SVG, PDF, anything unrecognised', () => {
    expect(validateUpload({ detectedMime: null, size: 1024 }).ok).toBe(false);
  });

  it('rejects an unlisted but detected type', () => {
    expect(validateUpload({ detectedMime: 'image/gif', size: 1024 }).ok).toBe(false);
  });

  it('rejects files over the cap', () => {
    expect(validateUpload({ detectedMime: 'image/png', size: MAX_BYTES + 1 }).ok).toBe(false);
  });

  it('accepts a file exactly at the cap', () => {
    expect(validateUpload({ detectedMime: 'image/png', size: MAX_BYTES })).toEqual({ ok: true });
  });

  it('rejects empty or malformed sizes', () => {
    for (const size of [0, -1, undefined, 'big', NaN]) {
      expect(validateUpload({ detectedMime: 'image/png', size }).ok).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/media.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure half**

```js
'use strict';

/**
 * Raster only, deliberately. Uploads are served from the same CloudFront
 * distribution as the site under /uploads/*, so they share its origin. SVG is
 * XML that can carry <script>, which would make an uploaded SVG stored XSS on
 * our own domain. Do not add 'image/svg+xml' to this list.
 */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Pure. Takes the DETECTED mime (from image-sniff), never the declared one.
 * `{ ok: true }` or `{ ok: false, reason }`.
 */
function validateUpload({ detectedMime, size } = {}) {
  if (!detectedMime || !ALLOWED_MIME.includes(detectedMime)) {
    return {
      ok: false,
      reason: `File is not a supported image. Allowed: ${ALLOWED_MIME.join(', ')}`,
    };
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

- [ ] **Step 4: Run it and watch it pass, then the whole unit suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  npx vitest run tests/unit/media.test.js && npx vitest run tests/unit
```

Expected: 6 tests, then 35 tests across 5 files.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/media.js tests/unit/media.test.js && \
  git commit -m "feat: upload validation against sniffed type"
```

---

## Chunk 2: Role bootstrap

### Task 7: Non-interactive boot script

Every later verification needs to run Strapi's bootstrap and exit. `strapi develop` cannot do that.

**Files:** Create `scripts/boot-once.js`

- [ ] **Step 1: Write it**

```js
'use strict';

// Boot Strapi far enough to run register + bootstrap lifecycles, then exit.
// `load()` calls `bootstrap()` internally (@strapi/core/dist/Strapi.js:301-303),
// which runs plugin BOOTSTRAP then user BOOTSTRAP (:385, :389) — so src/index.js
// runs and its role/permission writes land.
//
// Exists because `strapi develop` is a foreground watcher with no terminating
// condition, which an agentic worker cannot Ctrl-C. Same boot pattern as
// scripts/seed.js, which is known-working.
const { createStrapi, compileStrapi } = require('@strapi/strapi');

(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';
  console.log('BOOTSTRAP OK');
  await app.destroy();
  process.exit(0);
})().catch((err) => {
  console.error('BOOTSTRAP FAILED:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it boots and exits**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node scripts/boot-once.js
```

Expected: `BOOTSTRAP OK`, exit 0, prompt returns. If it hangs, the dev server is running against the same SQLite file — stop it.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add scripts/boot-once.js && git commit -m "chore: non-interactive boot script"
```

---

### Task 8: Create the Chapter Admin role on boot

`src/index.js` currently looks a role up by `type` and returns early when absent — it never creates one. Because `user.role` is `manyToOne`, a Chapter Admin is *not* also Authenticated, so the new role must carry the Authenticated grants too.

**Files:** Modify `src/index.js`

- [ ] **Step 1: Read what is there now**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && cat src/index.js
```

Note the `AUTHENTICATED_GRANTS` array, its idempotent grant loop, and the three inline comments mapping each grant to its route — those comments are preserved below.

- [ ] **Step 2: Replace the file**

```js
'use strict';

// Self-service permissions the member area relies on. Granted to the built-in
// Authenticated role on boot so the profile page works without a manual admin
// toggle (and so it survives fresh DBs / new environments).
//   - user.updateMe       → PUT /api/users/me            (edit own profile)
//   - auth.changePassword → POST /api/auth/change-password
//   - user.directory      → GET /api/users/directory     (privacy-safe member list)
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
    "controlled by the user's administeredChapters relation, not by this role.",
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

- [ ] **Step 3: Boot and verify the role and its grants**

The routes those grants name do not exist yet. That is fine and expected: users-permissions' `syncPermissions` prunes unknown actions during *plugin* bootstrap, which runs **before** user bootstrap — so this code re-inserts them every boot regardless.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT name, type FROM up_roles ORDER BY id;" && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: three roles including `Chapter Admin|chapter_admin`, then `5`.

- [ ] **Step 4: Boot again to prove idempotency**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_roles WHERE type='chapter_admin';" && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: `1` then `5`. Any other numbers mean the create-or-find or the grant loop is wrong.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/index.js && \
  git commit -m "feat: create and grant the Chapter Admin role on bootstrap"
```

---

## Chunk 3: API scaffold

### Task 9: Scaffold the chapter-admin API

Prove the routes load and the permission matrix sees them before building logic behind them — this is the assumption most likely to cost a day if wrong.

**Files:** Create `src/api/chapter-admin/controllers/chapter-admin.js`, `src/api/chapter-admin/routes/chapter-admin.js`

- [ ] **Step 1: Create the controller**

```js
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
```

- [ ] **Step 2: Create the routes file**

```js
'use strict';

/**
 * chapter-admin routes, mounted under /api/chapter-admin/*.
 *
 * Every route is authenticated-plus-role: users-permissions rejects the request
 * before the handler runs unless the caller's role has the matching action
 * granted. That is the CAPABILITY check. The SCOPE check — which chapter — is
 * enforced inside each handler and is not expressible in this table.
 */

module.exports = {
  routes: [
    { method: 'GET', path: '/chapter-admin/whoami', handler: 'chapter-admin.whoami' },
  ],
};
```

- [ ] **Step 3: Boot and confirm the action is visible to the permission system**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT action FROM up_permissions WHERE action LIKE 'api::chapter-admin%' ORDER BY action;"
```

Expected: the **five** actions from `CHAPTER_ADMIN_GRANTS` — `createEvent`, `deleteEvent`, `listEvents`, `updateEvent`, `uploadMedia`. `whoami` is absent because it was never granted.

**If instead you get zero rows, stop.** That means `syncPermissions` pruned them and the user bootstrap did not re-insert, i.e. the lifecycle ordering assumption is wrong for this version and the plan needs rework.

- [ ] **Step 4: Confirm the matrix renders the API**

Start the admin panel manually (this step is for a human; skip if running headless):
Settings → Users & Permissions → Roles → Chapter Admin → expect a `Chapter-admin` section listing `whoami`.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && git commit -m "feat: scaffold the chapter-admin API"
```

---

## Chunk 4: The factory and the events routes

### Task 10: The chapter-scoped resource factory

The crux. The scoping rule, restated because everything depends on it:

```
create → target chapter from the PAYLOAD's chapterSlug, must be ∈ administeredChapters
update → target chapter from the EXISTING DB RECORD, never the payload
delete → same as update
```

`chapter` and `slug` are absent from every whitelist, so neither can be reassigned after creation. `strapi` is injected rather than reached for globally, so Task 11 can test this without a boot.

**Files:** Create `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Write the factory**

```js
'use strict';

const { pickWhitelisted } = require('./fields');
const { assertChapterScope, resolveAdministeredChapters } = require('./scope');
const { buildSlug, nextAvailableSlug, SlugError } = require('./slug');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Build the CRUD handler set for a content type owned by a chapter.
 *
 * All chapter identity is `documentId`, never the numeric entry id — `chapter`
 * is draft-and-publish, so each chapter is two rows with different ids sharing
 * one documentId, and an entry-id comparison rejects every legitimate request.
 *
 * @param {string}   uid            e.g. 'api::event.event'
 * @param {string[]} editableFields whitelist; MUST NOT contain 'chapter' or 'slug'
 * @param {boolean}  hasSlug        generate a chapter-prefixed slug on create
 * @param {object}   strapiInstance injected for testability
 */
function chapterScopedResource({
  uid, editableFields, hasSlug = false, listFields = null, strapiInstance = null,
}) {
  if (editableFields.includes('chapter') || editableFields.includes('slug')) {
    // A misconfiguration here silently reopens chapter reassignment. Fail at load.
    throw new Error(`${uid}: 'chapter' and 'slug' must never be editable`);
  }

  const s = () => strapiInstance || global.strapi;
  const docs = () => s().documents(uid);

  /** Read the owning chapter documentId off a STORED record — never the payload. */
  async function ownerChapter(documentId) {
    const record = await docs().findOne({
      documentId,
      populate: { chapter: { fields: ['slug'] } },
      status: 'draft', // the draft row always exists; the published one may not
    });
    return { record, chapterDocumentId: record?.chapter?.documentId ?? null };
  }

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
      const administered = await resolveAdministeredChapters(ctx, s());
      if (administered.length === 0) return ctx.forbidden('No administered chapters');

      const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
      const pageSize = Math.min(MAX_PAGE_SIZE,
        Math.max(1, parseInt(ctx.query.pageSize, 10) || DEFAULT_PAGE_SIZE));

      const filters = { chapter: { documentId: { $in: administered } } };
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
        // status passed explicitly: it must match the findMany above or
        // pageCount silently disagrees with the rows returned.
        docs().count({ filters, status: 'draft' }),
      ]);

      ctx.body = {
        data: rows,
        meta: { pagination: { page, pageSize, total,
          pageCount: Math.max(1, Math.ceil(total / pageSize)) } },
      };
    },

    async create(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const input = ctx.request.body?.data ?? ctx.request.body ?? {};

      // The payload identifies the chapter by SLUG. The frontend never has an
      // id: AccountMember.administeredChapters carries {name, slug} and the
      // route is /account/chapter/[chapterSlug]/…
      const chapterSlug = input.chapterSlug;
      if (!chapterSlug) return ctx.badRequest('chapterSlug is required');

      const chapter = await s().documents('api::chapter.chapter').findFirst({
        filters: { slug: chapterSlug },
        fields: ['slug'],
        status: 'draft',
      });
      if (!chapter) return ctx.notFound('No such chapter');

      assertChapterScope(administered, chapter.documentId);

      const data = pickWhitelisted(input, editableFields);
      // Longhand relation form: mapRelation's isNumeric() uses parseInt, so a
      // documentId beginning with a digit could be misread as an entry id.
      data.chapter = { documentId: chapter.documentId };

      if (hasSlug) {
        let desired;
        try {
          desired = buildSlug(chapter.slug, data.title);
        } catch (err) {
          if (err instanceof SlugError) return ctx.badRequest(err.message);
          throw err;
        }
        data.slug = nextAvailableSlug(desired, await takenSlugs(desired));
      }

      // Publish explicitly: these types are draftAndPublish and the documents
      // API writes a DRAFT unless told otherwise. Without this the save succeeds
      // and is invisible on the live site.
      ctx.body = { data: await docs().create({ data, status: 'published' }) };
    },

    async update(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const { documentId } = ctx.params;

      // UPDATE reads the chapter from the STORED RECORD. Any `chapter` in the
      // payload is ignored — it is not on the whitelist — which is what stops an
      // admin pulling another chapter's record into their own scope.
      const { record, chapterDocumentId } = await ownerChapter(documentId);
      if (!record) return ctx.notFound();
      assertChapterScope(administered, chapterDocumentId);

      const input = ctx.request.body?.data ?? ctx.request.body ?? {};
      const data = pickWhitelisted(input, editableFields);

      ctx.body = { data: await docs().update({ documentId, data, status: 'published' }) };
    },

    async delete(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const { documentId } = ctx.params;

      const { record, chapterDocumentId } = await ownerChapter(documentId);
      if (!record) return ctx.notFound();
      assertChapterScope(administered, chapterDocumentId);

      await docs().delete({ documentId });
      ctx.body = { data: { documentId } };
    },
  };
}

module.exports = { chapterScopedResource };
```

- [ ] **Step 2: Verify it loads and the guard fires**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node -e "
const { chapterScopedResource } = require('./src/api/chapter-admin/services/resource-factory.js');
try { chapterScopedResource({ uid: 'x', editableFields: ['chapter'] }); console.log('NO GUARD'); }
catch (e) { console.log('guarded:', e.message); }
"
```

Expected: `guarded: x: 'chapter' and 'slug' must never be editable`.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/resource-factory.js && \
  git commit -m "feat: chapter-scoped CRUD factory"
```

---

### Task 11: Unit-test the scoping invariant

The factory is the most security-relevant file in the plan and Task 10 only proved it parses. These tests use a fake document service — no boot, no database.

**Files:** Create `tests/unit/resource-factory.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, vi } from 'vitest';
import { chapterScopedResource } from '../../src/api/chapter-admin/services/resource-factory.js';

const CHAP_A = { id: 55, documentId: 'chap-a', slug: 'boston' };
const CHAP_B = { id: 57, documentId: 'chap-b', slug: 'seattle' };

/** A fake strapi whose event store is a single record owned by `owner`. */
function fakeStrapi({ owner = CHAP_A, chapters = [CHAP_A, CHAP_B] } = {}) {
  const calls = { create: [], update: [], delete: [] };
  const api = {
    calls,
    documents: (uid) => {
      if (uid === 'plugin::users-permissions.user') {
        return { findOne: async () => ({ administeredChapters: [CHAP_A] }) };
      }
      if (uid === 'api::chapter.chapter') {
        return {
          findFirst: async ({ filters }) =>
            chapters.find((c) => c.slug === filters.slug) ?? null,
        };
      }
      return {
        findOne: async () => ({ documentId: 'ev-1', title: 'Existing', chapter: owner }),
        findMany: async () => [],
        count: async () => 0,
        create: async (args) => { calls.create.push(args); return { documentId: 'ev-new', ...args.data }; },
        update: async (args) => { calls.update.push(args); return { documentId: 'ev-1', ...args.data }; },
        delete: async (args) => { calls.delete.push(args); return {}; },
      };
    },
  };
  return api;
}

const makeCtx = (body = {}, params = {}) => ({
  state: { user: { documentId: 'u1' } },
  params,
  query: {},
  request: { body },
  body: undefined,
  badRequest: vi.fn(function (m) { this.body = { error: m }; this.status = 400; }),
  notFound: vi.fn(function (m) { this.body = { error: m }; this.status = 404; }),
  forbidden: vi.fn(function (m) { this.body = { error: m }; this.status = 403; }),
});

const resource = (strapiInstance) => chapterScopedResource({
  uid: 'api::event.event',
  editableFields: ['title', 'location'],
  hasSlug: true,
  strapiInstance,
});

describe('create', () => {
  it('creates in an administered chapter and publishes', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'Gala', chapterSlug: 'boston' });
    await resource(s).create(ctx);

    expect(s.calls.create).toHaveLength(1);
    expect(s.calls.create[0].status).toBe('published');
    expect(s.calls.create[0].data.chapter).toEqual({ documentId: 'chap-a' });
    expect(s.calls.create[0].data.slug).toBe('boston-gala');
  });

  it('refuses a chapter the caller does not administer', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'Trespass', chapterSlug: 'seattle' });
    await expect(resource(s).create(ctx)).rejects.toThrow(/not administered/);
    expect(s.calls.create).toHaveLength(0);
  });

  it('400s rather than 500s on an unslugifiable title', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: '中文活动', chapterSlug: 'boston' });
    await resource(s).create(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(s.calls.create).toHaveLength(0);
  });

  it('400s when chapterSlug is missing', async () => {
    const s = fakeStrapi();
    await resource(s).create(makeCtx({ title: 'Gala' }));
    expect(s.calls.create).toHaveLength(0);
  });
});

describe('update', () => {
  it('updates an own record', async () => {
    const s = fakeStrapi({ owner: CHAP_A });
    await resource(s).update(makeCtx({ location: 'Oakland' }, { documentId: 'ev-1' }));
    expect(s.calls.update[0].data).toEqual({ location: 'Oakland' });
    expect(s.calls.update[0].status).toBe('published');
  });

  it('reads the chapter from the record, not the payload', async () => {
    // Record belongs to B; caller administers A. A payload claiming A must not help.
    const s = fakeStrapi({ owner: CHAP_B });
    const ctx = makeCtx({ chapterSlug: 'boston', chapter: 'chap-a' }, { documentId: 'ev-1' });
    await expect(resource(s).update(ctx)).rejects.toThrow(/not administered/);
    expect(s.calls.update).toHaveLength(0);
  });

  it('drops `chapter` from the payload even on an owned record', async () => {
    const s = fakeStrapi({ owner: CHAP_A });
    await resource(s).update(
      makeCtx({ location: 'X', chapter: 'chap-b' }, { documentId: 'ev-1' })
    );
    expect(s.calls.update[0].data).not.toHaveProperty('chapter');
  });

  it('fails closed on a record with no chapter', async () => {
    const s = fakeStrapi({ owner: null });
    await expect(
      resource(s).update(makeCtx({ location: 'X' }, { documentId: 'ev-1' }))
    ).rejects.toThrow(/No target chapter/);
  });
});

describe('delete', () => {
  it("refuses another chapter's record", async () => {
    const s = fakeStrapi({ owner: CHAP_B });
    await expect(
      resource(s).delete(makeCtx({}, { documentId: 'ev-1' }))
    ).rejects.toThrow(/not administered/);
    expect(s.calls.delete).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run and watch them pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/unit/resource-factory.test.js
```

Expected: PASS, 9 tests. If "reads the chapter from the record, not the payload" fails, the central invariant is broken — fix before continuing.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/unit/resource-factory.test.js && \
  git commit -m "test: chapter scoping invariant"
```

---

### Task 12: Wire the events routes

**Files:** Modify the controller and routes

- [ ] **Step 1: Replace the controller**

`whoami` is deleted here rather than left in place — it was never granted, so it would 403 for every caller forever.

```js
'use strict';

const { chapterScopedResource } = require('../services/resource-factory');
// ScopeError must be obtained by direct require, never via strapi.service(...).
// Strapi's loadFiles deletes the require cache per file, so a service-registry
// lookup can hand back a DIFFERENT class object and `instanceof` silently fails.
const { ScopeError } = require('../services/scope');

// Mirrors api::event.event minus `chapter` and `slug`, both set at create and
// immutable after.
const events = chapterScopedResource({
  uid: 'api::event.event',
  hasSlug: true,
  editableFields: [
    'title', 'startsAt', 'endsAt', 'description',
    'memberPrice', 'publicPrice', 'location', 'locationUrl', 'figure',
  ],
});

/** Turn a ScopeError into a 403; let everything else surface. */
const guarded = (handler) => async (ctx) => {
  try {
    return await handler(ctx);
  } catch (err) {
    if (err instanceof ScopeError) return ctx.forbidden(err.message);
    throw err;
  }
};

module.exports = {
  listEvents: guarded(events.list),
  createEvent: guarded(events.create),
  updateEvent: guarded(events.update),
  deleteEvent: guarded(events.delete),
};
```

- [ ] **Step 2: Replace the routes**

Paths use `:documentId` so the handler's destructure matches the param name.

```js
'use strict';

module.exports = {
  routes: [
    { method: 'GET',    path: '/chapter-admin/events',              handler: 'chapter-admin.listEvents' },
    { method: 'POST',   path: '/chapter-admin/events',              handler: 'chapter-admin.createEvent' },
    { method: 'PUT',    path: '/chapter-admin/events/:documentId',  handler: 'chapter-admin.updateEvent' },
    { method: 'DELETE', path: '/chapter-admin/events/:documentId',  handler: 'chapter-admin.deleteEvent' },
  ],
};
```

- [ ] **Step 3: Boot and confirm the grants**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT action FROM up_permissions WHERE action LIKE 'api::chapter-admin%' ORDER BY action;"
```

Expected: the same five actions. `whoami` gone.

- [ ] **Step 4: Prove it over HTTP with curl**

The spec's rollout asks for "integration tests **and** curl against a real member JWT." This catches a wrong handler string or param name that a DB query cannot.

Create a chapter admin and mint a token:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node -e "
const { createStrapi, compileStrapi } = require('@strapi/strapi');
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';
  const role = await app.query('plugin::users-permissions.role').findOne({ where: { type: 'chapter_admin' } });
  const chapter = await app.documents('api::chapter.chapter').findFirst({ fields: ['slug'], status: 'draft' });
  const email = 'curl-admin@areaa.test';
  let user = await app.query('plugin::users-permissions.user').findOne({ where: { email } });
  if (!user) {
    user = await app.plugin('users-permissions').service('user').add({
      username: email, email, password: 'Password123!', confirmed: true,
      firstName: 'Curl', lastName: 'Admin', role: role.id,
      administeredChapters: [chapter.id],
    });
  }
  const jwt = await app.plugin('users-permissions').service('jwt').issue({ id: user.id });
  console.log(JSON.stringify({ jwt, chapterSlug: chapter.slug }));
  await app.destroy(); process.exit(0);
})();
" > /tmp/curl-admin.json && cat /tmp/curl-admin.json
```

Note `administeredChapters: [chapter.id]` uses the numeric **draft** entry id — `user.add` goes through `strapi.db.query`, which needs an entry id, not a documentId. The *scope check* still compares documentIds; only this link write uses the numeric id.

Now start the server, exercise it, and stop it:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  npx strapi develop > /tmp/strapi.log 2>&1 &
  for i in $(seq 1 90); do grep -q "Strapi started successfully" /tmp/strapi.log && break; sleep 1; done
  JWT=$(node -e "console.log(require('/tmp/curl-admin.json').jwt)")
  SLUG=$(node -e "console.log(require('/tmp/curl-admin.json').chapterSlug)")
  echo "--- list (expect 200) ---"
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $JWT" \
    http://localhost:1337/api/chapter-admin/events
  echo "--- create in own chapter (expect 200) ---"
  curl -s -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d "{\"title\":\"Curl Smoke $(date +%s)\",\"chapterSlug\":\"$SLUG\"}" \
    http://localhost:1337/api/chapter-admin/events | head -c 300; echo
  echo "--- create in a foreign chapter (expect 403) ---"
  FOREIGN=$(sqlite3 .tmp/data.db "SELECT slug FROM chapters WHERE slug != '$SLUG' LIMIT 1;")
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Trespass\",\"chapterSlug\":\"$FOREIGN\"}" \
    http://localhost:1337/api/chapter-admin/events
  echo "--- unauthenticated (expect 401/403) ---"
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:1337/api/chapter-admin/events
  pkill -f "strapi develop"
```

Expected: `200`, a JSON body whose `slug` starts with the chapter slug, `403`, then `401` or `403`. **A 200 on the foreign-chapter create means the scope check is not working — stop and fix.**

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: chapter-scoped events routes"
```

---

## Chunk 5: Media

### Task 13: Cap the upload size at the transport layer

Without this, `strapi::body` (koa-body → formidable) accepts its 200 MB default and writes the whole file to disk before the 5 MB check rejects it.

**Files:** Modify `config/middlewares.js`

- [ ] **Step 1: Replace the `strapi::body` entry**

The current file lists `'strapi::body'` as a bare string. Replace that one line with:

```js
  {
    name: 'strapi::body',
    config: {
      // Reject oversized uploads at the transport layer. The chapter-admin
      // media endpoint caps at 5MB; this stops a 200MB body being written to
      // disk before that check ever runs. Headroom left for admin-panel uploads.
      formidable: { maxFileSize: 20 * 1024 * 1024 },
    },
  },
```

- [ ] **Step 2: Verify Strapi still boots**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node scripts/boot-once.js
```

Expected: `BOOTSTRAP OK`.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add config/middlewares.js && \
  git commit -m "chore: cap upload size at the transport layer"
```

---

### Task 14: The upload handler

**Files:** Modify `src/api/chapter-admin/services/media.js`, the controller, the routes

- [ ] **Step 1: Add the impure half to `media.js`**

Append before `module.exports`, and extend the export list to include `uploadImage`:

```js
const fs = require('node:fs');
const { sniffImageType } = require('./image-sniff');

const SNIFF_BYTES = 32;

/**
 * Validate and store one uploaded image.
 *
 * The type is decided by SNIFFING THE FILE'S BYTES, not by `file.mimetype`,
 * which is only the client's Content-Type header. Strapi's own detection lives
 * in the upload plugin's controllers and is skipped when calling the service
 * directly — which we do in order to reuse the S3 provider config.
 *
 * No delete counterpart on purpose: admins detach media from records, they do
 * not delete from the shared library.
 */
async function uploadImage(file, strapiInstance = global.strapi) {
  const fd = await fs.promises.open(file.filepath, 'r');
  let detectedMime;
  try {
    const { buffer, bytesRead } = await fd.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
    detectedMime = sniffImageType(buffer.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }

  const check = validateUpload({ detectedMime, size: file.size });
  if (!check.ok) {
    const err = new Error(check.reason);
    err.name = 'UploadValidationError';
    throw err;
  }

  // Force the stored type to the detected one so a mislabelled extension or
  // header cannot survive into the media library.
  const [uploaded] = await strapiInstance
    .plugin('upload')
    .service('upload')
    .upload({ data: {}, files: { ...file, mimetype: detectedMime } });

  return uploaded;
}
```

- [ ] **Step 2: Add the controller action**

Add the require at the top of the controller alongside the existing ones, and the action inside `module.exports`:

```js
const { uploadImage } = require('../services/media');

// …inside module.exports, after deleteEvent:
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

- [ ] **Step 4: Confirm the action is granted and reachable**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT action FROM up_permissions WHERE action LIKE '%uploadMedia';"
```

Expected: exactly `api::chapter-admin.chapter-admin.uploadMedia`. An empty result means the controller method name and the grant string disagree.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: chapter-admin media upload validated by magic bytes"
```

---

## Chunk 6: Integration proof

### Task 15: Integration harness

**Files:** Create `tests/integration/helpers.js`

- [ ] **Step 1: Write the harness**

```js
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
```

- [ ] **Step 2: Verify the harness in isolation**

Failures here are otherwise ambiguous with handler failures in Task 16.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && node --input-type=module -e "
import { boot, shutdown, draftChapters, jwtFor } from './tests/integration/helpers.js';
const s = await boot();
const chapters = await draftChapters(s);
console.log('chapters:', chapters.map(c => c.slug).join(', '));
console.log('httpServer:', s.server.httpServer.constructor.name);
console.log('jwt is string:', typeof await jwtFor(s, 1) === 'string');
await shutdown(); process.exit(0);
"
```

Expected: two chapter slugs, `Server`, `true`.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/helpers.js && \
  git commit -m "test: integration harness"
```

---

### Task 16: End-to-end proof

Every title is uniquified per run, so the suite is re-runnable without `make fresh`. The earlier draft of this plan asserted exact slugs and failed on a second run once the collision suffix advanced.

**Files:** Create `tests/integration/events.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();                       // uniquifies titles per run
let strapi, chapterA, chapterB, tokenA;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `admin-a-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);
});

afterAll(async () => { await shutdown(); });

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const title = (name) => `${name} ${RUN}`;

/** Create an event owned by `chapter` directly, bypassing the API. */
async function seedEvent(chapter, name) {
  return strapi.documents('api::event.event').create({
    data: {
      title: title(name),
      slug: `${chapter.slug}-${name.toLowerCase()}-${RUN}`,
      chapter: { documentId: chapter.documentId },
    },
    status: 'published',
  });
}

describe('POST /api/chapter-admin/events', () => {
  it('creates in an administered chapter, published and slugged', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Spring Gala'), chapterSlug: chapterA.slug, location: 'SF' });

    expect(res.status).toBe(200);
    expect(res.body.data.slug.startsWith(`${chapterA.slug}-spring-gala`)).toBe(true);

    // The whole point of CA11: visible to a PUBLISHED read, not just written.
    const published = await strapi.documents('api::event.event')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('de-collides a duplicate title in the same chapter', async () => {
    const body = { title: title('Repeat Night'), chapterSlug: chapterA.slug };
    const first = await auth(api().post('/api/chapter-admin/events')).send(body);
    const second = await auth(api().post('/api/chapter-admin/events')).send(body);

    expect(second.body.data.slug).toBe(`${first.body.data.slug}-2`);
  });

  it('refuses a chapter the caller does not administer', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Trespass'), chapterSlug: chapterB.slug });
    expect(res.status).toBe(403);
  });

  it('400s on an unslugifiable title rather than 500ing', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: '中文活动', chapterSlug: chapterA.slug });
    expect(res.status).toBe(400);
  });

  it('ignores non-whitelisted fields', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Clean'), chapterSlug: chapterA.slug, slug: 'attacker-chosen' });
    expect(res.body.data.slug).not.toBe('attacker-chosen');
  });

  it('rejects an unauthenticated request', async () => {
    const res = await api().post('/api/chapter-admin/events')
      .send({ title: title('Anon'), chapterSlug: chapterA.slug });
    expect([401, 403]).toContain(res.status);
  });
});

describe('PUT /api/chapter-admin/events/:documentId', () => {
  it('updates an own event', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Editable'), chapterSlug: chapterA.slug });
    const res = await auth(api().put(`/api/chapter-admin/events/${created.body.data.documentId}`))
      .send({ location: 'Oakland' });

    expect(res.status).toBe(200);
    expect(res.body.data.location).toBe('Oakland');
  });

  it('cannot move an event to another chapter via the payload', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Stay Put'), chapterSlug: chapterA.slug });
    await auth(api().put(`/api/chapter-admin/events/${created.body.data.documentId}`))
      .send({ chapter: chapterB.documentId, chapterSlug: chapterB.slug, location: 'Nice try' });

    const after = await strapi.documents('api::event.event').findOne({
      documentId: created.body.data.documentId,
      populate: { chapter: { fields: ['slug'] } },
      status: 'draft',
    });
    expect(after.chapter.documentId).toBe(chapterA.documentId);
  });

  it("refuses another chapter's event, on the scope check", async () => {
    const foreign = await seedEvent(chapterB, 'Theirs');
    const res = await auth(api().put(`/api/chapter-admin/events/${foreign.documentId}`))
      .send({ location: 'Hijacked' });

    expect(res.status).toBe(403);
    // Must fail because the chapter is not administered — NOT because the
    // record has no chapter at all, which would be a test that cannot fail.
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('GET /api/chapter-admin/events', () => {
  it('lists only administered chapters', async () => {
    const res = await auth(api().get('/api/chapter-admin/events'));
    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.chapter?.slug === chapterA.slug)).toBe(true);
  });
});

describe('DELETE /api/chapter-admin/events/:documentId', () => {
  it('deletes an own event', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Doomed'), chapterSlug: chapterA.slug });
    const res = await auth(api().delete(`/api/chapter-admin/events/${created.body.data.documentId}`));
    expect(res.status).toBe(200);
  });

  it("refuses another chapter's event, on the scope check", async () => {
    const foreign = await seedEvent(chapterB, 'NotYours');
    const res = await auth(api().delete(`/api/chapter-admin/events/${foreign.documentId}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('POST /api/chapter-admin/media', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  it('accepts a real PNG', async () => {
    const res = await auth(api().post('/api/chapter-admin/media'))
      .attach('files', png, { filename: 'ok.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBeDefined();
  });

  it('rejects an SVG disguised as a PNG — the header is not trusted', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await auth(api().post('/api/chapter-admin/media'))
      .attach('files', svg, { filename: 'evil.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Ensure a seeded database and a stopped dev server**

The suite needs at least two chapters. `make seed` must run with the dev server stopped — both open the same SQLite file.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; make fresh
```

- [ ] **Step 3: Run the integration suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/integration
```

Expected: PASS, 14 tests. The three cross-chapter cases are the ones that matter — a 200 on any of them means scoping is broken.

- [ ] **Step 4: Run it a second time without re-seeding**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npx vitest run tests/integration
```

Expected: PASS, 14 tests again. A failure here means titles are not uniquified per run.

- [ ] **Step 5: Run everything**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && npm test
```

Expected: PASS, **58 tests across 7 files**:

| File | Tests |
|---|---|
| `tests/unit/fields.test.js` | 6 |
| `tests/unit/scope.test.js` | 8 |
| `tests/unit/slug.test.js` | 10 |
| `tests/unit/image-sniff.test.js` | 5 |
| `tests/unit/media.test.js` | 6 |
| `tests/unit/resource-factory.test.js` | 9 |
| `tests/integration/events.test.js` | 14 |
| **Total** | **58** |

`tests/integration/helpers.js` is not counted — the `include` pattern matches only `*.test.js`.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/events.test.js && \
  git commit -m "test: end-to-end chapter-scoped events and media"
```

---

## Done when

- `npm test` is green, twice in a row, without re-seeding between runs.
- A chapter-admin JWT can create, list, update, and delete events in its own chapter, and every one of those verbs returns **403 with "not administered"** against another chapter — not 403 for an incidental reason.
- A created event is visible to a `status: 'published'` read.
- Slugs are chapter-prefixed and de-collide.
- An SVG posted as `image/png` is rejected with 400.
- `sqlite3 .tmp/data.db "SELECT action FROM up_permissions WHERE action LIKE 'api::chapter-admin%'"` lists exactly the five granted actions.

## Not in this plan

Per the spec's rollout, plans 2 and 3 cover:

- Every route other than `/events` and `/media` — `/news`, `/page`, `/committees`, `/chapter`, `/members`, `/partners`, `/submissions`. They reuse the factory and the scope helper, so they are repetition against a proven spine.
- All frontend work: identity plumbing, `/account/chapter/*`, `FormField` additions, the multi-select picker.
- TipTap and the `blocksToDoc` / `docToBlocks` converters.

## Known limitations, accepted

- **Slug de-collision is read-then-write and not atomic.** Two concurrent creates of the same title in one chapter can both take `-2`, and there is no unique index to catch it. Consistent with CA10's last-write-wins posture; revisit if it ever bites.
- **No output sanitization.** The factory returns raw entities. Harmless for events; it will not be when the factory is reused for `/members` in plan 2 — add `strapi.contentAPI.sanitize.output` there.
- **Uploads carry no chapter attribution**, so there is no audit trail of who uploaded what. The spec accepts orphaned media as a known cost; anonymity is the part worth revisiting.
- **`instance.destroy()` calls `process.removeAllListeners()`**, stripping Vitest's own handlers. Fine with `fileParallelism: false` and one integration file; expect odd teardown if a second is added.
