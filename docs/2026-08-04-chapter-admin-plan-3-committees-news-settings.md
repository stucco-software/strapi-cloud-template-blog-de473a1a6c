# Chapter Admin — Plan 3: Committees, News, Settings and Submissions

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chapter admin manages their chapter's committees — including who sits on them — plus news items, chapter settings, and inbound contact submissions, in a browser, with no client JS.

**Architecture:** Four more resources against the two spines already proven. The backend reuses `chapterScopedResource` from plan 1, extended with three hooks it turns out to need; `/members`, `/chapter` and `/submissions` are bespoke handlers calling the same `assertChapterScope`. The frontend reuses plan 2's Astro-route-plus-form pattern, adding one genuinely new component — a no-JS checkbox picker — and extracting the routes' shared security preamble into one helper.

**Tech Stack:** Strapi 5.45.1, Node 24, CommonJS, Astro 6.4.2, TypeScript strict, Vitest 3.

**Spec:** [`2026-08-03-chapter-admin-authoring-design.md`](./2026-08-03-chapter-admin-authoring-design.md).
**Predecessors:** [plan 1](./2026-08-03-chapter-admin-plan-1-authorization-spine.md) (59 tests green) and [plan 2](./2026-08-03-chapter-admin-plan-2-events-authoring-ui.md) (24 frontend tests green) — both complete.

---

## Revision note

This is v2. v1 was reviewed chunk-by-chunk and **no chunk was approved**. The structure held — every edit anchor applied, all 13 grant strings matched, import depths were right, counts were accurate — but two defect classes ran through it:

1. **Tests that could not fail.** Committee members were never asserted to attach, so an implementation that silently dropped them passed 8/8. The `members` unit tests stubbed `findMany` ignoring `filters`, so deleting the chapter clause left 9/9 green.
2. **Silent failure on write paths**, six instances — the class the spec's error-handling section exists to prevent.

Plus three specific bugs: `assertMembersInChapter` was falsy-blind, the "expect 18 permissions" step was **inert**, and `publishedDate` rendered the wrong day.

Everything below is the corrected version. Where v1 was wrong, the fix carries a comment saying so, because those are the places a future editor is most likely to "simplify" back.

---

## Scope

Four resources, backend and screens together: **committees**, **news**, **chapter settings**, **submissions**.

Committees is first because it is the most valuable and the most expensive. It needs two things nothing else has yet:

- **`GET /chapter-admin/members`**, so the form can offer the chapter's members as candidates.
- **The multi-select picker**, which the spec calls out as carrying more UI surface than anything else in the design. Built once here, reused four more times in plan 4.

**Deferred to plan 4:** `/page` (the fixed-template microsite editor) and `/partners`. Both depend on the picker this plan builds.

**Deferred to plan 5:** TipTap and the real blocks converters. `news-item.body` uses plan 2's `textToBlocks` placeholder.

---

## Read this first: submissions has no capture path

**`/submissions` is specified as read-only administration of data that nothing currently writes.**

- `form_submissions` holds **0 rows**; `scripts/seed.js` creates none.
- `src/components/ContactForm.astro:45-46` is presentational only. Its own comment says so. It calls `event.preventDefault()` (line 54) and shows **"Thank you — your message is on its way."** (line 37).

So the public site tells visitors their message was sent when nothing was sent, and this screen is empty until that changes.

**This plan builds the admin side exactly as the spec defines it and does not wire capture.** A public write endpoint brings spam handling, rate limiting, a Public-role grant and chapter association — a separate subsystem the design never scoped.

Task 20 Step 1 seeds a submission through the document service so the screen is verifiable. **Task 21 files the public-site bug**, so the note survives this plan being closed.

If you would rather this plan include capture, stop and say so; it is roughly three extra tasks and one design decision.

---

## Preconditions

**1. Node 24 for anything touching the CMS repo.** `better-sqlite3` is built for module version 137. Bare `node` on this machine is v22.12.0; `/opt/homebrew/bin/node` is v24.1.0, so the `PATH=` prefix below is load-bearing, not decoration.

**2. Two repos.** Every command block states its own `cd` — including the `sqlite3` ones. Agent shells reset cwd between calls.

| Repo | Path |
|---|---|
| CMS | `/Users/nk/Projects/AREAA/areaa-cms` |
| Frontend | `/Users/nk/Projects/AREAA/areaa-frontend` |

**3. The CMS dev server must be STOPPED for tests and boots, RUNNING for browser verification.** Both open the same SQLite file.

```bash
pkill -f "strapi develop"                                    # before tests
cd /Users/nk/Projects/AREAA/areaa-cms && \
  PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop   # for the browser
```

**4. Test accounts** (created during plan 2, still present):

| Account | Password | Role |
|---|---|---|
| `chapadmin@areaa.test` | `Password123!` | Chapter Admin of `aloha-hawaii` |
| `plainmember@areaa.test` | `Password123!` | Ordinary member, administers nothing |

Any new test user **must** be created with `provider: 'local'` or it cannot log in.

---

## Verified assumptions

Checked against the installed Strapi 5.45.1 by executing the calls.

| Assumption | Verdict |
|---|---|
| `committee` has **no `slug`** field | ✅ `name`, `description`, `members`, `chapter`. Factory takes `hasSlug: false` |
| `committee.description` is `text`, not `blocks` | ✅ Plain textarea, no converter — unlike news |
| `committee.members` accepts `[{ documentId }]` on create | ✅ Wrote 2, read back 2 |
| Updating `members` **replaces** rather than appends | ✅ Set 2 → updated to 1 → read back 1 |
| `members` can be cleared with `[]` | ✅ Read back 0 |
| `committees_members_lnk` is unique on `(committee_id, user_id)` only | ✅ So one member may sit on several committees |
| `news-item.body` is `required: true` and enforced | ✅ Throws ``body must be a `array` type`` |
| `form-submission` is `draftAndPublish: false` | ✅ Per schema |
| `status: 'published'` on a non-D&P type is accepted and ignored | ✅ Verified; CA11's warning is about clarity, not a crash |
| Nested `populate: { x: { fields: [...] } }` still returns `documentId` | ✅ `transform/populate.js` runs nested fields through `transformFields`. The member pre-check in Chunks 3–5 depends on this |
| `GET /api/users/directory` returns **no identifier** | ✅ `DirectoryMember` is display-only, so the picker cannot reuse it |
| `experimental_AstroContainer` exists in Astro 6.4.2 | ✅ Exported from `astro/container`; enables the Task 12 component test |

### Corrected from v1

- **v1 claimed Strapi returns a 500 on a missing required attribute.** Overstated: `@strapi/utils` `ValidationError` maps to **400** through the koa error middleware. `requiredFields` is still worth having — it produces a message the form can render instead of a schema-shaped one — but it is not preventing a 500. The tests assert 400 either way.
- **v1 relied on `sanitize.output` being wrong for `/members`.** It is still not used, but the reason stands on its own: `directory` already hand-builds its payload, and a whitelist cannot leak a field somebody forgets to mark `private`.

---

## File structure

**CMS — create:**

| Path | Responsibility |
|---|---|
| `src/api/chapter-admin/services/members.js` | `toDirectoryRow`, `normaliseMemberIds`, `assertMembersInChapter` |
| `tests/unit/members.test.js` | Row shaping, id normalisation, the membership check |
| `tests/unit/factory-hooks.test.js` | The three new factory hooks, against a fake strapi |
| `tests/unit/grants.test.js` | Grant strings vs controller exports — replaces v1's inert count check |
| `tests/integration/committees.test.js` | Committee CRUD + the cross-chapter member attack |
| `tests/integration/resources.test.js` | News, chapter settings, submissions |

**CMS — modify:** `src/api/chapter-admin/services/resource-factory.js`, `services/fields.js` (adds `BadInputError`), `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `src/index.js`.

**Frontend — create:**

| Path | Responsibility |
|---|---|
| `src/components/MultiSelect.astro` | Scrollable checkbox picker, no client JS |
| `tests/unit/multi-select.test.ts` | Renders via Astro container; asserts the marker contract |
| `src/lib/form-route.ts` | `beginChapterAdminPost()` — the shared security preamble |
| `src/components/CommitteeForm.astro` | Create + edit committee |
| `src/components/NewsForm.astro` | Create + edit news item |
| `src/lib/committee-form.ts` | Pure FormData → committee payload |
| `src/lib/news-form.ts` | Pure FormData → news payload |
| `tests/unit/committee-form.test.ts` | Payload mapping, incl. the empty-members case |
| `tests/unit/news-form.test.ts` | Payload mapping, incl. required body |
| `src/pages/api/chapter-admin/{committee,news,settings,submission}.ts` | Form POST handlers |
| `src/pages/account/chapter/[chapterSlug]/committees/{index,new,[documentId]}.astro` | Committee screens |
| `src/pages/account/chapter/[chapterSlug]/news/{index,new,[documentId]}.astro` | News screens |
| `src/pages/account/chapter/[chapterSlug]/settings.astro` | Chapter name + email |
| `src/pages/account/chapter/[chapterSlug]/submissions.astro` | Read + mark handled |

**Frontend — modify:** `src/lib/chapter-admin.ts`, `src/layouts/ChapterAdminLayout.astro`, `src/pages/api/chapter-admin/event.ts` (adopts the shared preamble).

---

## Chunk 1: Members and the factory hooks

### Task 1: Extend the factory with the three hooks the new resources need

News must force `author` to the session user and reject a missing `body`; committees must reject members who do not belong to the chapter.

**Files:** Modify `src/api/chapter-admin/services/fields.js`, `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Add `BadInputError` to `fields.js`**

The factory needs a way for a validation hook to produce a **400**. Today only `ScopeError` (403) and `SlugError` (400, and only around `buildSlug`) exist. Append to `fields.js`, and add it to the exports:

```js
/**
 * A client-input problem that should surface as 400, not 500.
 *
 * Exists because `validateData` hooks need to reject malformed payloads —
 * `members: 'x'` instead of `members: ['x']` — and the only 400-shaped error
 * available was SlugError, which is about slugs. The controller's `guarded`
 * wrapper maps this to ctx.badRequest.
 */
class BadInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadInputError';
  }
}

module.exports = { pickWhitelisted, BadInputError };
```

- [ ] **Step 2: Replace the factory's JSDoc and destructure**

Note `listPopulate`'s existing comment is **preserved** — it records a bug plan 2 already hit, and v1 of this plan silently dropped it.

```js
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
 * @param {object}   listPopulate   extra relations to populate on list, merged
 *                                  with `chapter`. Media relations are NOT
 *                                  returned unless named here — an authoring UI
 *                                  that renders "current image" needs `figure`,
 *                                  and without it silently shows nothing.
 * @param {string[]} requiredFields fields that must be non-empty. Checked on
 *                                  create, and on update for fields the payload
 *                                  actually carries — an edit form posts every
 *                                  field, so clearing a required one arrives as
 *                                  '' and must be rejected, not written.
 * @param {Function} deriveOnCreate (ctx) => object, merged into the create
 *                                  payload AFTER the whitelist. This is how a
 *                                  server-owned field like `news.author` is set
 *                                  without ever being client-writable.
 * @param {Function} validateData   async (data, { ctx, chapterDocumentId, strapi })
 *                                  => void. Runs on create AND update. May throw
 *                                  ScopeError (=> 403) or BadInputError (=> 400).
 *                                  MAY ALSO NORMALISE `data` in place — the
 *                                  committee hook rewrites `members` to longhand
 *                                  relation form once it has checked them.
 * @param {object}   strapiInstance injected for testability
 */
function chapterScopedResource({
  uid, editableFields, hasSlug = false, listFields = null, listPopulate = null,
  requiredFields = [], deriveOnCreate = null, validateData = null,
  strapiInstance = null,
}) {
```

- [ ] **Step 3: Add the required-field check**

Add above the `return {`:

```js
  const isEmpty = (value) =>
    value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);

  /** On create, every requiredField must be present and non-empty. */
  function missingOnCreate(data) {
    return requiredFields.find((field) => isEmpty(data[field])) ?? null;
  }

  /**
   * On update, only fields the payload actually CARRIES are checked.
   *
   * v1 skipped this check entirely on update, reasoning that absent means
   * unchanged. True for absent fields — but the edit forms post every field, so
   * an admin who clears the title sends `title: ''`, which pickWhitelisted
   * trims and forwards, blanking a required attribute. Absent is still fine;
   * present-and-empty is not.
   */
  function blankedOnUpdate(data) {
    return requiredFields.find((field) => field in data && isEmpty(data[field])) ?? null;
  }
```

- [ ] **Step 4: Wire the hooks into `create`**

Replace from `const data = pickWhitelisted(...)` down to the `ctx.body =` line:

```js
      const data = pickWhitelisted(input, editableFields);
      // Longhand relation form: mapRelation's isNumeric() uses parseInt, so a
      // documentId beginning with a digit could be misread as an entry id.
      data.chapter = { documentId: chapter.documentId };

      // Derived AFTER the whitelist, so a client-supplied value cannot win.
      if (deriveOnCreate) Object.assign(data, deriveOnCreate(ctx));

      const missing = missingOnCreate(data);
      if (missing) return ctx.badRequest(`${missing} is required`);

      if (validateData) {
        await validateData(data, { ctx, chapterDocumentId: chapter.documentId, strapi: s() });
      }

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
      // API writes a DRAFT unless told otherwise.
      ctx.body = { data: await docs().create({ data, status: 'published' }) };
```

- [ ] **Step 5: Wire the hooks into `update`**

After `const data = pickWhitelisted(input, editableFields);`:

```js
      const blanked = blankedOnUpdate(data);
      if (blanked) return ctx.badRequest(`${blanked} is required`);

      if (validateData) {
        await validateData(data, { ctx, chapterDocumentId, strapi: s() });
      }
```

- [ ] **Step 6: Write the hook tests**

v1 changed the factory with no tests at all, verified only by "the existing 59 still pass" — which cannot exercise hooks that default off. Create `tests/unit/factory-hooks.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { chapterScopedResource } from '../../src/api/chapter-admin/services/resource-factory.js';
import { BadInputError } from '../../src/api/chapter-admin/services/fields.js';

const CHAP = { id: 55, documentId: 'chap-a', slug: 'boston' };

function fakeStrapi({ stored = { documentId: 'r-1', chapter: CHAP } } = {}) {
  const calls = { create: [], update: [] };
  return {
    calls,
    documents: (uid) => {
      if (uid === 'plugin::users-permissions.user') {
        return { findOne: async () => ({ administeredChapters: [CHAP] }) };
      }
      if (uid === 'api::chapter.chapter') {
        return { findFirst: async () => CHAP };
      }
      return {
        findOne: async () => stored,
        findMany: async () => [],
        count: async () => 0,
        create: async (a) => { calls.create.push(a); return { documentId: 'new', ...a.data }; },
        update: async (a) => { calls.update.push(a); return { documentId: 'r-1', ...a.data }; },
      };
    },
  };
}

const makeCtx = (body = {}, params = {}) => ({
  state: { user: { documentId: 'u1' } },
  params, query: {}, request: { body }, body: undefined,
  badRequest: vi.fn(function (m) { this.body = { error: m }; this.status = 400; }),
  notFound: vi.fn(function (m) { this.body = { error: m }; this.status = 404; }),
  forbidden: vi.fn(function (m) { this.body = { error: m }; this.status = 403; }),
});

describe('requiredFields', () => {
  const res = (s) => chapterScopedResource({
    uid: 'api::news-item.news-item', editableFields: ['title', 'body'],
    requiredFields: ['title', 'body'], strapiInstance: s,
  });

  it('400s on create when a required field is missing', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'T', chapterSlug: 'boston' });
    await res(s).create(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('body is required');
    expect(s.calls.create).toHaveLength(0);
  });

  it('treats an empty array as missing', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'T', body: [], chapterSlug: 'boston' });
    await res(s).create(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
  });

  it('400s on update when the payload BLANKS a required field', async () => {
    // The v1 bug: update skipped the check entirely, so an edit form that
    // posts every field could clear the title and blank a required attribute.
    const s = fakeStrapi();
    const ctx = makeCtx({ title: '' }, { documentId: 'r-1' });
    await res(s).update(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('title is required');
    expect(s.calls.update).toHaveLength(0);
  });

  it('allows a partial update that OMITS a required field', async () => {
    const s = fakeStrapi();
    await res(s).update(makeCtx({ body: [{ t: 1 }] }, { documentId: 'r-1' }));
    expect(s.calls.update).toHaveLength(1);
  });
});

describe('deriveOnCreate', () => {
  it('overrides a client-supplied value', async () => {
    const s = fakeStrapi();
    const r = chapterScopedResource({
      uid: 'api::news-item.news-item', editableFields: ['title', 'author'],
      deriveOnCreate: (ctx) => ({ author: { documentId: ctx.state.user.documentId } }),
      strapiInstance: s,
    });
    await r.create(makeCtx({ title: 'T', author: { documentId: 'someone-else' }, chapterSlug: 'boston' }));
    expect(s.calls.create[0].data.author).toEqual({ documentId: 'u1' });
  });
});

describe('validateData', () => {
  it('runs on create and can reject with a 400', async () => {
    const s = fakeStrapi();
    const r = chapterScopedResource({
      uid: 'x', editableFields: ['title'], strapiInstance: s,
      validateData: async () => { throw new BadInputError('nope'); },
    });
    await expect(r.create(makeCtx({ title: 'T', chapterSlug: 'boston' })))
      .rejects.toThrow(BadInputError);
    expect(s.calls.create).toHaveLength(0);
  });

  it('runs on UPDATE too, with the stored record\'s chapter', async () => {
    const s = fakeStrapi();
    const seen = [];
    const r = chapterScopedResource({
      uid: 'x', editableFields: ['title'], strapiInstance: s,
      validateData: async (_d, meta) => { seen.push(meta.chapterDocumentId); },
    });
    await r.update(makeCtx({ title: 'T' }, { documentId: 'r-1' }));
    expect(seen).toEqual(['chap-a']);
  });

  it('normalisation performed by the hook reaches the write', async () => {
    // The hook mutates `data` in place; nothing else verifies the coercion
    // survives to create(). This is the mechanism the committee picker rides on.
    const s = fakeStrapi();
    const r = chapterScopedResource({
      uid: 'x', editableFields: ['members'], strapiInstance: s,
      validateData: async (data) => { data.members = [{ documentId: 'm1' }]; },
    });
    await r.create(makeCtx({ members: ['m1'], chapterSlug: 'boston' }));
    expect(s.calls.create[0].data.members).toEqual([{ documentId: 'm1' }]);
  });
});
```

- [ ] **Step 7: Run the new tests, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/unit/factory-hooks.test.js && \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: PASS, 8 tests, then **67 passed** (59 existing + 8). Events must be untouched — all three hooks default off.

- [ ] **Step 8: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/ tests/unit/factory-hooks.test.js && \
  git commit -m "feat: required-field, derived-field and validation hooks on the resource factory"
```

---

### Task 2: The members service

Three functions. `toDirectoryRow` decides what a chapter admin may see; `normaliseMemberIds` turns whatever the form sent into a checked list of strings; `assertMembersInChapter` is a security boundary — without it a chapter admin can attach **any user in the system** to their committee.

**Files:** Create `src/api/chapter-admin/services/members.js`, `tests/unit/members.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import {
  toDirectoryRow, normaliseMemberIds, assertMembersInChapter, MEMBER_FIELDS,
} from '../../src/api/chapter-admin/services/members.js';
import { ScopeError } from '../../src/api/chapter-admin/services/scope.js';
import { BadInputError } from '../../src/api/chapter-admin/services/fields.js';

describe('toDirectoryRow', () => {
  it('returns an identifier the picker can submit', () => {
    expect(toDirectoryRow({ id: 7, documentId: 'usr-1', firstName: 'Mei', lastName: 'Tanaka' }).documentId)
      .toBe('usr-1');
  });

  it('falls back to first + last when displayName is empty', () => {
    expect(toDirectoryRow({ documentId: 'u', firstName: 'Mei', lastName: 'Tanaka' }).displayName)
      .toBe('Mei Tanaka');
  });

  it('prefers an explicit displayName', () => {
    expect(toDirectoryRow({ documentId: 'u', firstName: 'Mei', lastName: 'T', displayName: 'M. Tanaka' }).displayName)
      .toBe('M. Tanaka');
  });

  it('leaks no contact or entitlement PII', () => {
    const row = toDirectoryRow({
      documentId: 'u', firstName: 'A', lastName: 'B',
      email: 'a@b.test', phone: '555', postalCode: '94110',
      status: 'Active', duesPaidThrough: '2027-01-01', password: 'x',
    });
    for (const leaked of ['email', 'phone', 'postalCode', 'status', 'duesPaidThrough', 'password']) {
      expect(row).not.toHaveProperty(leaked);
    }
    expect(Object.keys(row).sort()).toEqual([...MEMBER_FIELDS].sort());
  });

  it('never returns undefined values', () => {
    const row = toDirectoryRow({ documentId: 'u' });
    expect(row.displayName).toBe('');
    expect(row.title).toBe('');
  });
});

describe('normaliseMemberIds', () => {
  it('accepts a list of id strings', () => {
    expect(normaliseMemberIds(['m1', 'm2'])).toEqual(['m1', 'm2']);
  });

  it('accepts longhand relation objects', () => {
    expect(normaliseMemberIds([{ documentId: 'm1' }])).toEqual(['m1']);
  });

  it('de-duplicates', () => {
    expect(normaliseMemberIds(['m1', 'm1'])).toEqual(['m1']);
  });

  it('accepts an empty list — removing everyone is legal', () => {
    expect(normaliseMemberIds([])).toEqual([]);
  });

  it('400s rather than 500s on a non-array', () => {
    // v1 did (data.members ?? []).map(...), so members:'m1' threw
    // "TypeError: .map is not a function" and surfaced as a 500.
    expect(() => normaliseMemberIds('m1')).toThrow(BadInputError);
  });

  it('rejects entries that are not usable ids', () => {
    // v1's guard was `if (stranger)`, which is falsy-blind: members:[''] got
    // past the membership check and wrote {documentId: ''}.
    for (const bad of [[''], [null], [undefined], [5], [{ id: 5 }], [{}]]) {
      expect(() => normaliseMemberIds(bad)).toThrow(BadInputError);
    }
  });
});

describe('assertMembersInChapter', () => {
  /** Records the filter it was called with, so the test can assert on it. */
  const spyStrapi = (rows) => {
    const seen = [];
    return {
      seen,
      documents: () => ({
        findMany: async (args) => { seen.push(args); return rows; },
      }),
    };
  };

  it('accepts members of the chapter', async () => {
    const s = spyStrapi([{ documentId: 'm1' }, { documentId: 'm2' }]);
    await expect(assertMembersInChapter(s, 'chap-a', ['m1', 'm2'])).resolves.toBe(true);
  });

  it('SCOPES THE QUERY TO THE CHAPTER', async () => {
    // v1's fake ignored `filters` entirely, so deleting the chapter clause —
    // the whole point of this function — left every test green.
    const s = spyStrapi([{ documentId: 'm1' }]);
    await assertMembersInChapter(s, 'chap-a', ['m1']);
    expect(s.seen[0].filters.chapter).toEqual({ documentId: 'chap-a' });
    expect(s.seen[0].filters.documentId).toEqual({ $in: ['m1'] });
  });

  it('excludes blocked users from the accepted set', async () => {
    const s = spyStrapi([{ documentId: 'm1' }]);
    await assertMembersInChapter(s, 'chap-a', ['m1']);
    expect(s.seen[0].filters.blocked).toEqual({ $ne: true });
  });

  it('does not query at all for an empty selection', async () => {
    const s = spyStrapi([]);
    await expect(assertMembersInChapter(s, 'chap-a', [])).resolves.toBe(true);
    expect(s.seen).toHaveLength(0);
  });

  it('rejects a user who is not in the chapter', async () => {
    // The attack: attaching an arbitrary user to your own committee, which
    // publishes them on your microsite.
    const s = spyStrapi([{ documentId: 'm1' }]);
    await expect(assertMembersInChapter(s, 'chap-a', ['m1', 'outsider']))
      .rejects.toThrow(ScopeError);
  });

  it('rejects an outsider even when a valid member is present', async () => {
    const s = spyStrapi([{ documentId: 'm1' }]);
    await expect(assertMembersInChapter(s, 'chap-a', ['m1', 'outsider']))
      .rejects.toThrow(/do not belong/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/members.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

const { ScopeError } = require('./scope');
const { BadInputError } = require('./fields');

/**
 * Exactly what a chapter admin may see about one of their members.
 *
 * Hand-built rather than sanitized, following `plugin.controllers.user.directory`:
 * a whitelist cannot leak a field somebody later forgets to mark `private`, and
 * it does not depend on the caller's role holding a read grant. `documentId` is
 * included — unlike the public directory row — because the picker must submit
 * something.
 */
const MEMBER_FIELDS = ['documentId', 'displayName', 'title'];

function toDirectoryRow(user) {
  return {
    documentId: user.documentId,
    displayName:
      user.displayName || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    title: user.title ?? '',
  };
}

/**
 * Whatever the form sent -> a de-duplicated list of id strings.
 *
 * Accepts `['id']` or `[{documentId}]` so the caller is not coupled to how the
 * form serialised it, and throws BadInputError (=> 400) on anything else.
 * Strict about entry shape on purpose: the previous version silently produced
 * `undefined` for unexpected entries, which then either bypassed the membership
 * check or reached Knex as `whereIn(..., [undefined])`.
 */
function normaliseMemberIds(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new BadInputError('members must be a list');
  }
  const ids = raw.map((entry) => {
    const id = typeof entry === 'string' ? entry : entry?.documentId;
    if (typeof id !== 'string' || id === '') {
      throw new BadInputError('every member must be identified by a documentId');
    }
    return id;
  });
  return [...new Set(ids)];
}

/**
 * Every submitted member must actually belong to the chapter.
 *
 * A security boundary, not validation for the user's benefit. Without it
 * `PUT /committees/:id` with an arbitrary user documentId attaches any member of
 * any chapter — or a national board member — to a committee, and the public
 * microsite then displays them as part of that chapter.
 */
async function assertMembersInChapter(strapiInstance, chapterDocumentId, memberDocumentIds) {
  const wanted = normaliseMemberIds(memberDocumentIds);
  if (wanted.length === 0) return true;

  const rows = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findMany({
      filters: {
        documentId: { $in: wanted },
        chapter: { documentId: chapterDocumentId },
        // A blocked member is not listed by the picker; without this they could
        // still be attached by a hand-crafted request.
        blocked: { $ne: true },
      },
      // `fields` always unions `id` and `documentId` regardless of what is asked
      // for (verified in plan 1), so documentId comes back here even though it
      // is not listed. Do not "fix" this by adding it.
      fields: ['id'],
      limit: -1,
    });

  const found = new Set(rows.map((r) => r.documentId));
  // `!== undefined`, NOT a truthiness test: `find` returning '' is a real miss,
  // and the previous truthiness check let it through.
  const stranger = wanted.find((id) => !found.has(id));
  if (stranger !== undefined) {
    throw new ScopeError('One or more selected members do not belong to this chapter');
  }
  return true;
}

module.exports = {
  toDirectoryRow, normaliseMemberIds, assertMembersInChapter, MEMBER_FIELDS,
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/members.test.js
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/members.js tests/unit/members.test.js && \
  git commit -m "feat: chapter member row shaping, id normalisation and membership assertion"
```

---

### Task 3: A grant-consistency test that actually detects a typo

v1 verified the wiring by counting permission rows and expecting 18. **That check is inert.** `syncPermissions` deletes DB permissions whose action is absent from the live controller registry, but it runs in the *plugin* bootstrap, which precedes `src/index.js`'s bootstrap — and `grant()` inserts unconditionally. A misspelled action is deleted and immediately re-created, so the count reads 18 either way.

**Files:** Create `tests/unit/grants.test.js`

- [ ] **Step 1: Write the test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const controller = require('../../src/api/chapter-admin/controllers/chapter-admin.js');
const routes = require('../../src/api/chapter-admin/routes/chapter-admin.js');
const { CHAPTER_ADMIN_GRANTS } = require('../../src/index.js');

const PREFIX = 'api::chapter-admin.chapter-admin.';

const grantedActions = CHAPTER_ADMIN_GRANTS
  .filter((a) => a.startsWith(PREFIX))
  .map((a) => a.slice(PREFIX.length));

const controllerActions = Object.keys(controller);
const routedActions = routes.routes.map((r) => r.handler.replace('chapter-admin.', ''));

describe('chapter-admin wiring', () => {
  it('grants exactly the actions the controller exports', () => {
    expect([...grantedActions].sort()).toEqual([...controllerActions].sort());
  });

  it('routes exactly the actions the controller exports', () => {
    expect([...new Set(routedActions)].sort()).toEqual([...controllerActions].sort());
  });

  it('every routed handler resolves to a function', () => {
    for (const action of routedActions) {
      expect(typeof controller[action]).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Export the grants from `src/index.js`**

Add `CHAPTER_ADMIN_GRANTS` to the module exports alongside the lifecycle functions so the test can read it without booting:

```js
module.exports = {
  register(/* { strapi } */) {},
  async bootstrap({ strapi }) { /* … unchanged … */ },
  // Exported for tests/unit/grants.test.js — a misspelled grant is otherwise
  // undetectable, because syncPermissions deletes unknown actions during plugin
  // bootstrap and the grant loop re-creates them on the next line.
  CHAPTER_ADMIN_GRANTS,
};
```

- [ ] **Step 3: Confirm it fails on a deliberate typo, then passes**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/grants.test.js
```

Expected at this point: **FAIL** — the controller does not yet export the 13 new actions. That is correct; Task 4 makes it pass. Re-run it after Task 4 and expect PASS, 3 tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/unit/grants.test.js src/index.js && \
  git commit -m "test: assert grants, routes and controller exports agree"
```

---

### Task 4: Wire the members, committees, news, chapter and submissions routes

All five at once, because they share one controller file and one routes table.

**Files:** Modify `src/api/chapter-admin/controllers/chapter-admin.js`, `src/api/chapter-admin/routes/chapter-admin.js`, `src/index.js`

- [ ] **Step 1: Widen `guarded` to map the 400-shaped errors**

`guarded` currently maps only `ScopeError`. A `BadInputError` or `SlugError` thrown by a `validateData` hook would propagate uncaught and 500 — v1 documented a contract it did not implement.

```js
const { ScopeError } = require('../services/scope');
const { SlugError } = require('../services/slug');
const { BadInputError, pickWhitelisted } = require('../services/fields');
const {
  toDirectoryRow, normaliseMemberIds, assertMembersInChapter,
} = require('../services/members');
const { resolveAdministeredChapters, assertChapterScope } = require('../services/scope');

/** ScopeError -> 403; client-input errors -> 400; everything else surfaces. */
const guarded = (handler) => async (ctx) => {
  try {
    return await handler(ctx);
  } catch (err) {
    if (err instanceof ScopeError) return ctx.forbidden(err.message);
    if (err instanceof BadInputError || err instanceof SlugError) {
      return ctx.badRequest(err.message);
    }
    throw err;
  }
};
```

- [ ] **Step 2: Add the two factory-backed resources**

```js
// Committees. No slug field on this type, so hasSlug stays false. `members` is
// writable but every id is normalised and then checked against the chapter's
// own membership before it reaches the write.
const committees = chapterScopedResource({
  uid: 'api::committee.committee',
  editableFields: ['name', 'description', 'members'],
  listPopulate: { members: { fields: ['firstName', 'lastName', 'displayName', 'title'] } },
  requiredFields: ['name'],
  async validateData(data, { chapterDocumentId, strapi }) {
    // Absent means unchanged; [] means clear. Only touch it when present.
    if (!('members' in data)) return;
    const ids = normaliseMemberIds(data.members);   // throws BadInputError -> 400
    await assertMembersInChapter(strapi, chapterDocumentId, ids); // throws ScopeError -> 403
    data.members = ids.map((documentId) => ({ documentId }));
  },
});

// News. `author` is server-set from the session so an admin cannot publish
// under another member's byline. `body` is required:true in the schema.
const news = chapterScopedResource({
  uid: 'api::news-item.news-item',
  hasSlug: true,
  editableFields: ['title', 'excerpt', 'body', 'figure', 'publishedDate'],
  listPopulate: {
    figure: { fields: ['url', 'name'] },
    author: { fields: ['firstName', 'lastName', 'displayName'] },
  },
  requiredFields: ['title', 'body'],
  deriveOnCreate: (ctx) => ({ author: { documentId: ctx.state.user.documentId } }),
});
```

- [ ] **Step 3: Add the bespoke handlers**

Both list handlers take a `chapterSlug`. v1's did not, so a multi-chapter admin visiting `/account/chapter/A/submissions` saw chapter B's messages — and for committees it was worse than cosmetic, because clicking through rendered the form with the wrong chapter's members and every save 403'd with no way forward.

```js
  /** Resolve a chapterSlug query/body param to a scope-checked chapter. */
  // (helper, defined next to the handlers)

  listMembers: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    const chapterSlug = String(ctx.query.chapterSlug ?? '');
    if (!chapterSlug) return ctx.badRequest('chapterSlug is required');

    const chapter = await strapi.documents('api::chapter.chapter').findFirst({
      filters: { slug: chapterSlug }, fields: ['slug'], status: 'draft',
    });
    if (!chapter) return ctx.notFound('No such chapter');
    assertChapterScope(administered, chapter.documentId);

    const rows = await strapi.documents('plugin::users-permissions.user').findMany({
      // `confirmed` matches the established directory filter; without it the
      // picker offers people who have never completed signup.
      filters: {
        chapter: { documentId: chapter.documentId },
        confirmed: true,
        blocked: { $ne: true },
      },
      fields: ['firstName', 'lastName', 'displayName', 'title'],
      sort: ['lastName:asc', 'firstName:asc'],
      limit: -1,
    });

    ctx.body = { data: rows.map(toDirectoryRow) };
  }),

  getChapter: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    const chapterSlug = String(ctx.query.chapterSlug ?? '');
    if (!chapterSlug) return ctx.badRequest('chapterSlug is required');

    const chapter = await strapi.documents('api::chapter.chapter').findFirst({
      filters: { slug: chapterSlug }, fields: ['name', 'slug', 'email'], status: 'draft',
    });
    if (!chapter) return ctx.notFound('No such chapter');
    assertChapterScope(administered, chapter.documentId);

    // Hand-built: `administrators` must never ship, or chapter admins can see
    // (and eventually appoint) each other.
    ctx.body = { data: { documentId: chapter.documentId, name: chapter.name,
      slug: chapter.slug, email: chapter.email ?? '' } };
  }),

  updateChapter: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const chapterSlug = String(input.chapterSlug ?? '');
    if (!chapterSlug) return ctx.badRequest('chapterSlug is required');

    const chapter = await strapi.documents('api::chapter.chapter').findFirst({
      filters: { slug: chapterSlug }, fields: ['slug'], status: 'draft',
    });
    if (!chapter) return ctx.notFound('No such chapter');
    assertChapterScope(administered, chapter.documentId);

    // `slug` is absent from this whitelist deliberately: it is a uid that will
    // not regenerate, and already-written event slug prefixes would not follow
    // it if it did.
    const data = pickWhitelisted(input, ['name', 'email']);
    if ('name' in data && data.name === '') return ctx.badRequest('name is required');

    ctx.body = { data: await strapi.documents('api::chapter.chapter').update({
      documentId: chapter.documentId, data, status: 'published',
    }) };
  }),

  // form-submission is draftAndPublish:FALSE, so no status flag anywhere here.
  listSubmissions: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    const chapterSlug = String(ctx.query.chapterSlug ?? '');
    if (!chapterSlug) return ctx.badRequest('chapterSlug is required');

    const chapter = await strapi.documents('api::chapter.chapter').findFirst({
      filters: { slug: chapterSlug }, fields: ['slug'], status: 'draft',
    });
    if (!chapter) return ctx.notFound('No such chapter');
    assertChapterScope(administered, chapter.documentId);

    const rows = await strapi.documents('api::form-submission.form-submission').findMany({
      filters: { chapter: { documentId: chapter.documentId } },
      populate: { chapter: { fields: ['name', 'slug'] } },
      sort: ['submittedAt:desc'],
      limit: 200,   // see Known limitations — no pagination on this screen yet
    });
    ctx.body = { data: rows };
  }),

  updateSubmission: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    const { documentId } = ctx.params;

    const record = await strapi.documents('api::form-submission.form-submission').findOne({
      documentId, populate: { chapter: { fields: ['slug'] } },
    });
    if (!record) return ctx.notFound();
    assertChapterScope(administered, record.chapter?.documentId ?? null);

    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    ctx.body = { data: await strapi.documents('api::form-submission.form-submission').update({
      documentId, data: { handled: Boolean(input.handled) },
    }) };
  }),
```

And the eight factory-backed exports:

```js
  listCommittees: guarded(committees.list),
  createCommittee: guarded(committees.create),
  updateCommittee: guarded(committees.update),
  deleteCommittee: guarded(committees.delete),

  listNews: guarded(news.list),
  createNews: guarded(news.create),
  updateNews: guarded(news.update),
  deleteNews: guarded(news.delete),
```

- [ ] **Step 4: Add the routes**

```js
    { method: 'GET',    path: '/chapter-admin/members',                  handler: 'chapter-admin.listMembers' },

    { method: 'GET',    path: '/chapter-admin/committees',              handler: 'chapter-admin.listCommittees' },
    { method: 'POST',   path: '/chapter-admin/committees',              handler: 'chapter-admin.createCommittee' },
    { method: 'PUT',    path: '/chapter-admin/committees/:documentId',  handler: 'chapter-admin.updateCommittee' },
    { method: 'DELETE', path: '/chapter-admin/committees/:documentId',  handler: 'chapter-admin.deleteCommittee' },

    { method: 'GET',    path: '/chapter-admin/news',                    handler: 'chapter-admin.listNews' },
    { method: 'POST',   path: '/chapter-admin/news',                    handler: 'chapter-admin.createNews' },
    { method: 'PUT',    path: '/chapter-admin/news/:documentId',        handler: 'chapter-admin.updateNews' },
    { method: 'DELETE', path: '/chapter-admin/news/:documentId',        handler: 'chapter-admin.deleteNews' },

    { method: 'GET',    path: '/chapter-admin/chapter',                 handler: 'chapter-admin.getChapter' },
    { method: 'PUT',    path: '/chapter-admin/chapter',                 handler: 'chapter-admin.updateChapter' },

    { method: 'GET',    path: '/chapter-admin/submissions',                 handler: 'chapter-admin.listSubmissions' },
    { method: 'PUT',    path: '/chapter-admin/submissions/:documentId',     handler: 'chapter-admin.updateSubmission' },
```

- [ ] **Step 5: Grant the new actions**

Extend `CHAPTER_ADMIN_GRANTS` in `src/index.js`:

```js
  'api::chapter-admin.chapter-admin.listMembers',
  'api::chapter-admin.chapter-admin.listCommittees',
  'api::chapter-admin.chapter-admin.createCommittee',
  'api::chapter-admin.chapter-admin.updateCommittee',
  'api::chapter-admin.chapter-admin.deleteCommittee',
  'api::chapter-admin.chapter-admin.listNews',
  'api::chapter-admin.chapter-admin.createNews',
  'api::chapter-admin.chapter-admin.updateNews',
  'api::chapter-admin.chapter-admin.deleteNews',
  'api::chapter-admin.chapter-admin.getChapter',
  'api::chapter-admin.chapter-admin.updateChapter',
  'api::chapter-admin.chapter-admin.listSubmissions',
  'api::chapter-admin.chapter-admin.updateSubmission',
```

- [ ] **Step 6: Run the grants test — this is the real wiring check**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/grants.test.js
```

Expected: PASS, 3 tests. A typo in any of the 18 grant strings, route handlers or controller keys fails this with a readable diff.

To prove the test earns its place, temporarily misspell one grant (`listNewss`), re-run, watch it fail, then restore.

- [ ] **Step 7: Boot once to confirm the permissions land**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: `BOOTSTRAP OK`, then `18`. Treat this as a smoke check only — per Task 3 it reads 18 even when an action is misspelled, which is why the unit test exists.

- [ ] **Step 8: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ src/index.js && \
  git commit -m "feat: members, committees, news, chapter and submissions routes"
```

---

## Chunk 2: Backend proof

### Task 5: Integration-test committees and the member attack

v1's committee tests **could not fail**: create asserted only `status 200`, and the replace test updated to `[]` and asserted length 0 — which an implementation that silently drops `members` also produces. Every assertion below reads the stored record back.

**Files:** Create `tests/integration/committees.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, memberA, memberB;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `cmte-admin-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);

  const mk = async (chapter, tag) => strapi.plugin('users-permissions').service('user').add({
    username: `cm-${tag}-${RUN}@areaa.test`, email: `cm-${tag}-${RUN}@areaa.test`,
    password: 'Password123!', confirmed: true, provider: 'local',
    firstName: 'Cmte', lastName: tag, chapter: chapter.id,
  });
  memberA = await mk(chapterA, `Ay${RUN}`);
  memberB = await mk(chapterB, `Bee${RUN}`);
});

afterAll(async () => {
  const junk = await strapi.documents('api::committee.committee').findMany({
    filters: { name: { $contains: String(RUN) } }, fields: ['name'], limit: -1, status: 'draft',
  });
  for (const c of junk) {
    await strapi.documents('api::committee.committee').delete({ documentId: c.documentId });
  }

  // v1 deleted committees but NOT the three users each run creates. Those users
  // are `confirmed: true` with a `chapter`, which is exactly the predicate the
  // member directory admits — sorted lastName:asc, pageSize 12 — so fixtures
  // named 'Ay'/'Bee' sorted to the top of page one and accumulated two per run.
  // Identical shape to the plan-2 events leak that broke the public site.
  const users = await strapi.query('plugin::users-permissions.user')
    .findMany({ where: { email: { $contains: String(RUN) } } });
  for (const u of users) {
    await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
  }

  await shutdown();
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const name = (n) => `${n} ${RUN}`;

/** Read a committee's stored members straight from the DB. */
const storedMembers = async (documentId) => {
  const c = await strapi.documents('api::committee.committee').findOne({
    documentId, populate: { members: { fields: ['firstName'] } }, status: 'draft',
  });
  return (c?.members ?? []).map((m) => m.documentId);
};

describe('GET /api/chapter-admin/members', () => {
  it('lists the chapter members with an identifier the picker can submit', async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    const row = res.body.data.find((m) => m.documentId === memberA.documentId);
    expect(row).toBeDefined();
    expect(row.displayName).toContain('Cmte');
  });

  it('leaks no contact or entitlement PII', async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterA.slug}`));
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(Object.keys(row).sort()).toEqual(['displayName', 'documentId', 'title']);
    }
  });

  it("refuses another chapter's roster", async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('POST /api/chapter-admin/committees', () => {
  it('creates a committee AND ACTUALLY ATTACHES THE MEMBERS', async () => {
    // v1 asserted only status 200, so a handler that dropped `members` passed.
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Events Cmte'), chapterSlug: chapterA.slug,
              description: 'Runs events', members: [memberA.documentId] });

    expect(res.status).toBe(200);
    expect(await storedMembers(res.body.data.documentId)).toEqual([memberA.documentId]);

    const published = await strapi.documents('api::committee.committee')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('400s on a missing name rather than 500ing', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ chapterSlug: chapterA.slug, description: 'Nameless' });
    expect(res.status).toBe(400);
  });

  it('REFUSES a member from another chapter', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Trespass'), chapterSlug: chapterA.slug, members: [memberB.documentId] });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/do not belong/i);
  });

  it('400s on a malformed members payload rather than 500ing', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Malformed'), chapterSlug: chapterA.slug, members: 'not-a-list' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/chapter-admin/committees/:documentId', () => {
  const create = (members = []) => auth(api().post('/api/chapter-admin/committees'))
    .send({ name: name(`C${Math.random().toString(36).slice(2, 7)}`), chapterSlug: chapterA.slug, members });

  it('REPLACES the member list rather than appending', async () => {
    const created = await create([memberA.documentId]);
    const second = await strapi.plugin('users-permissions').service('user').add({
      username: `cm-Cee${RUN}@areaa.test`, email: `cm-Cee${RUN}@areaa.test`,
      password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Cmte', lastName: `Cee${RUN}`, chapter: chapterA.id,
    });

    await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [second.documentId] });

    expect(await storedMembers(created.body.data.documentId)).toEqual([second.documentId]);
  });

  it('clears the member list when sent an empty array', async () => {
    const created = await create([memberA.documentId]);
    await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [] });
    expect(await storedMembers(created.body.data.documentId)).toEqual([]);
  });

  it('leaves members untouched when the payload omits them', async () => {
    // Absent means unchanged; [] means clear. The picker's __present marker
    // exists to keep those two distinguishable across the wire.
    const created = await create([memberA.documentId]);
    await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ name: name('Renamed') });
    expect(await storedMembers(created.body.data.documentId)).toEqual([memberA.documentId]);
  });

  it('refuses a foreign member on update too', async () => {
    const created = await create();
    const res = await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [memberB.documentId] });
    expect(res.status).toBe(403);
  });

  it('400s when the payload blanks the required name', async () => {
    const created = await create();
    const res = await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ name: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/chapter-admin/committees', () => {
  it('lists only administered chapters', async () => {
    const res = await auth(api().get('/api/chapter-admin/committees'));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((c) => c.chapter?.slug === chapterA.slug)).toBe(true);
  });

  it('populates members, which the edit screen reads to pre-check the picker', async () => {
    const created = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Populated'), chapterSlug: chapterA.slug, members: [memberA.documentId] });

    const res = await auth(api().get('/api/chapter-admin/committees?pageSize=100'));
    const row = res.body.data.find((c) => c.documentId === created.body.data.documentId);
    expect(row.members).toHaveLength(1);
    expect(row.members[0].documentId).toBe(memberA.documentId);
  });
});

describe('DELETE /api/chapter-admin/committees/:documentId', () => {
  it('deletes an own committee', async () => {
    const created = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Doomed'), chapterSlug: chapterA.slug });
    const res = await auth(api().delete(`/api/chapter-admin/committees/${created.body.data.documentId}`));
    expect(res.status).toBe(200);

    const gone = await strapi.documents('api::committee.committee')
      .findOne({ documentId: created.body.data.documentId, status: 'draft' });
    expect(gone).toBeNull();
  });

  it("refuses another chapter's committee", async () => {
    const foreign = await strapi.documents('api::committee.committee').create({
      data: { name: name('Theirs'), chapter: { documentId: chapterB.documentId } },
      status: 'published',
    });
    const res = await auth(api().delete(`/api/chapter-admin/committees/${foreign.documentId}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});
```

- [ ] **Step 2: Run them**

```bash
pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/committees.test.js
```

Expected: PASS, **16 tests**. The three 403 cases and "ACTUALLY ATTACHES" are the ones that matter.

- [ ] **Step 3: Prove the suite leaves no residue**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_users WHERE email LIKE 'cm-%@areaa.test' OR email LIKE 'cmte-admin-%';" && \
  sqlite3 .tmp/data.db "SELECT COUNT(DISTINCT document_id) FROM committees;"
```

Expected: `0`, then whatever the count was before the run. A leaked fixture user does not change the test count, so the suite stays green while the member directory fills up — this query is the only thing that catches it.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/committees.test.js && \
  git commit -m "test: committee CRUD, member attachment and the cross-chapter attack"
```

---

### Task 6: Integration-test news, settings and submissions

**Files:** Create `tests/integration/resources.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
const BODY = [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }];
let strapi, chapterA, chapterB, tokenA, adminA, originalChapterName;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  adminA = await makeChapterAdmin(strapi, {
    email: `res-admin-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, adminA.id);
  originalChapterName = chapterA.name;
});

afterAll(async () => {
  // Restore the chapter name here rather than inline, so a thrown assertion
  // cannot leave a real chapter renamed. v1 restored only on the happy path.
  if (originalChapterName) {
    await strapi.documents('api::chapter.chapter').update({
      documentId: chapterA.documentId, data: { name: originalChapterName }, status: 'published',
    });
  }

  for (const uid of ['api::news-item.news-item']) {
    const junk = await strapi.documents(uid).findMany({
      filters: { title: { $contains: String(RUN) } }, fields: ['title'], limit: -1, status: 'draft',
    });
    for (const n of junk) await strapi.documents(uid).delete({ documentId: n.documentId });
  }

  const subs = await strapi.documents('api::form-submission.form-submission')
    .findMany({ limit: -1 });
  for (const s of subs.filter((x) => String(x.data?.run) === String(RUN))) {
    await strapi.documents('api::form-submission.form-submission').delete({ documentId: s.documentId });
  }

  const users = await strapi.query('plugin::users-permissions.user')
    .findMany({ where: { email: { $contains: String(RUN) } } });
  for (const u of users) {
    await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
  }

  await shutdown();
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const title = (n) => `${n} ${RUN}`;

describe('news', () => {
  it('creates with a chapter-prefixed slug and publishes', async () => {
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Chapter Update'), chapterSlug: chapterA.slug, body: BODY });

    expect(res.status).toBe(200);
    expect(res.body.data.slug.startsWith(`${chapterA.slug}-chapter-update`)).toBe(true);
    const published = await strapi.documents('api::news-item.news-item')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('400s on a missing body rather than surfacing a schema error', async () => {
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Bodyless'), chapterSlug: chapterA.slug });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/body/i);
  });

  it('forces author to the session user, ignoring the payload', async () => {
    const someoneElse = await strapi.documents('plugin::users-permissions.user')
      .findFirst({ filters: { id: { $ne: adminA.id } }, fields: ['firstName'] });

    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Byline'), chapterSlug: chapterA.slug, body: BODY,
              author: { documentId: someoneElse.documentId } });

    const stored = await strapi.documents('api::news-item.news-item').findOne({
      documentId: res.body.data.documentId, populate: { author: { fields: ['id'] } }, status: 'draft',
    });
    expect(stored.author.documentId).toBe(adminA.documentId);
  });

  it('updates without resending the body', async () => {
    // The requiredFields check is skipped for ABSENT fields on update; this is
    // the path every "change the title only" save takes.
    const created = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Editable'), chapterSlug: chapterA.slug, body: BODY });

    const res = await auth(api().put(`/api/chapter-admin/news/${created.body.data.documentId}`))
      .send({ excerpt: 'Just the excerpt' });

    expect(res.status).toBe(200);
    const stored = await strapi.documents('api::news-item.news-item')
      .findOne({ documentId: created.body.data.documentId, status: 'draft' });
    expect(stored.excerpt).toBe('Just the excerpt');
    expect(stored.body).not.toBeNull();
  });

  it('400s when an update BLANKS the required body', async () => {
    const created = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Blankable'), chapterSlug: chapterA.slug, body: BODY });
    const res = await auth(api().put(`/api/chapter-admin/news/${created.body.data.documentId}`))
      .send({ body: [] });
    expect(res.status).toBe(400);
  });

  it('deletes an own item', async () => {
    const created = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Doomed'), chapterSlug: chapterA.slug, body: BODY });
    const res = await auth(api().delete(`/api/chapter-admin/news/${created.body.data.documentId}`));
    expect(res.status).toBe(200);
    const gone = await strapi.documents('api::news-item.news-item')
      .findOne({ documentId: created.body.data.documentId, status: 'draft' });
    expect(gone).toBeNull();
  });

  it("refuses another chapter's news", async () => {
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Trespass'), chapterSlug: chapterB.slug, body: BODY });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('chapter settings', () => {
  it('reads name and email', async () => {
    const res = await auth(api().get(`/api/chapter-admin/chapter?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    expect(res.body.data.name).toEqual(expect.any(String));
    expect(res.body.data.name.length).toBeGreaterThan(0);
    expect(res.body.data).toHaveProperty('email');
    expect(res.body.data.slug).toBe(chapterA.slug);
  });

  it('never returns administrators', async () => {
    const res = await auth(api().get(`/api/chapter-admin/chapter?chapterSlug=${chapterA.slug}`));
    expect(res.body.data).not.toHaveProperty('administrators');
  });

  it('actually persists a name change', async () => {
    const next = `${originalChapterName} ${RUN}`;
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: next });

    expect(res.status).toBe(200);
    const stored = await strapi.documents('api::chapter.chapter')
      .findOne({ documentId: chapterA.documentId, fields: ['name'], status: 'draft' });
    expect(stored.name).toBe(next);   // afterAll restores it
  });

  it('accepts clearing the contact email', async () => {
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: originalChapterName, email: '' });
    expect(res.status).toBe(200);
  });

  it('cannot change the slug, even when the payload says so', async () => {
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: originalChapterName, slug: 'hijacked' });
    expect(res.status).toBe(200);   // the write succeeds; `slug` is simply dropped
    const after = await strapi.documents('api::chapter.chapter')
      .findOne({ documentId: chapterA.documentId, fields: ['slug'], status: 'draft' });
    expect(after.slug).toBe(chapterA.slug);
  });

  it('refuses another chapter', async () => {
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterB.slug, name: 'Nice try' });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('submissions', () => {
  /** Nothing writes submissions yet — see the plan's opening section. */
  const seed = async (chapter, tag) =>
    strapi.documents('api::form-submission.form-submission').create({
      data: {
        chapter: { documentId: chapter.documentId },
        data: { name: tag, email: 'v@example.test', message: 'Hi', run: RUN },
        submittedAt: new Date().toISOString(),
        handled: false,
      },
    });

  it('lists the requested chapter and EXCLUDES the other one', async () => {
    // v1 asserted `.every(...)`, which is vacuously true on an empty list — and
    // form_submissions holds 0 rows, so a broken filter passed.
    const mine = await seed(chapterA, 'Mine');
    const theirs = await seed(chapterB, 'Theirs');

    const res = await auth(api().get(`/api/chapter-admin/submissions?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((s) => s.documentId);
    expect(ids).toContain(mine.documentId);
    expect(ids).not.toContain(theirs.documentId);
  });

  it("refuses to list another chapter's submissions", async () => {
    const res = await auth(api().get(`/api/chapter-admin/submissions?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('marks one handled, and back again', async () => {
    const sub = await seed(chapterA, 'Toggle');
    const on = await auth(api().put(`/api/chapter-admin/submissions/${sub.documentId}`))
      .send({ handled: true });
    expect(on.status).toBe(200);
    expect(on.body.data.handled).toBe(true);

    const off = await auth(api().put(`/api/chapter-admin/submissions/${sub.documentId}`))
      .send({ handled: false });
    expect(off.body.data.handled).toBe(false);
  });

  it("refuses another chapter's submission", async () => {
    const foreign = await seed(chapterB, 'Foreign');
    const res = await auth(api().put(`/api/chapter-admin/submissions/${foreign.documentId}`))
      .send({ handled: true });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});
```

- [ ] **Step 2: Run the whole CMS suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **PASS, 120 tests across 12 files** — 59 from plans 1–2, plus 8 factory-hooks, 17 members, 3 grants, 16 committees, 17 here.

- [ ] **Step 3: Run it again and prove nothing accumulated**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(DISTINCT document_id) FROM committees) c, \
    (SELECT COUNT(DISTINCT document_id) FROM news_items) n, \
    (SELECT COUNT(*) FROM form_submissions) s, \
    (SELECT COUNT(*) FROM up_users) u;" && \
  PATH="/opt/homebrew/bin:$PATH" npm test > /dev/null && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(DISTINCT document_id) FROM committees) c, \
    (SELECT COUNT(DISTINCT document_id) FROM news_items) n, \
    (SELECT COUNT(*) FROM form_submissions) s, \
    (SELECT COUNT(*) FROM up_users) u;"
```

Expected: **the two rows are identical**, and the suite is 120 again. The user count is the one that matters — plan 2 shipped a leak that stayed invisible because test counts do not change when a fixture survives.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/resources.test.js && \
  git commit -m "test: news, chapter settings and submissions end to end"
```

---

## Chunk 3: The picker

### Task 7: Let Vitest render Astro components

The picker is the one place in this plan where a rendering bug causes silent data loss, so it needs a real render test. Importing a `.astro` file under plain Vitest fails — the file needs Astro's Vite plugin.

**Files:** Modify `vitest.config.ts`

- [ ] **Step 1: Wrap the config**

```ts
import { getViteConfig } from "astro/config";

// getViteConfig gives Vitest the Astro plugin, so tests can import .astro files
// and render them with experimental_AstroContainer. Verified present in the
// installed astro@6.4.2.
export default getViteConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        passWithNoTests: true,
    },
});
```

- [ ] **Step 2: Confirm the existing suite is unaffected**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: **24 passed** — the three plan-2 files, unchanged. If this drops or errors, the config wrapper is wrong; fix it before adding tests that depend on it.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add vitest.config.ts && git commit -m "test: let vitest render astro components"
```

---

### Task 8: `MultiSelect.astro`

A **scrollable checkbox list**, not `<select multiple>`. Keyboard-only users would need Ctrl+Arrow/Ctrl+Space on a multi-select, and macOS Safari handles those listboxes badly — arrows replace rather than extend the selection. Checkboxes are unambiguous on keyboard, touch and screen reader; a `max-height` container keeps a large chapter compact. Since unchecked boxes also post nothing, the `__present` marker design is unchanged.

**Files:** Create `src/components/MultiSelect.astro`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/multi-select.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import MultiSelect from "../../src/components/MultiSelect.astro";

const OPTIONS = [
    { value: "m1", label: "Mei Tanaka", hint: "Broker" },
    { value: "m2", label: "David Park" },
];

const render = async (props: Record<string, unknown>) => {
    const container = await AstroContainer.create();
    return container.renderToString(MultiSelect, { props });
};

describe("MultiSelect", () => {
    it("renders one checkbox per option, named for the field", async () => {
        const html = await render({ legend: "Members", name: "members", options: OPTIONS });
        expect(html.match(/type="checkbox"/g)).toHaveLength(2);
        expect(html).toContain('name="members"');
        expect(html).toContain('value="m1"');
        expect(html).toContain("Mei Tanaka");
    });

    it("pre-checks the selected options and only those", async () => {
        const html = await render({
            legend: "Members", name: "members", options: OPTIONS, selected: ["m2"],
        });
        expect(html.match(/checked/g)).toHaveLength(1);
        expect(html).toMatch(/value="m2"[^>]*checked|checked[^>]*value="m2"/);
    });

    it("ALWAYS emits the __present marker when options are rendered", async () => {
        // The marker is what makes "deselect everyone" expressible: an all-
        // unchecked list posts nothing, so without it the mapper cannot tell
        // "cleared" from "field absent".
        const html = await render({ legend: "Members", name: "members", options: OPTIONS });
        expect(html).toContain('name="members__present"');
    });

    it("does NOT emit the marker when there are no options", async () => {
        // v1's bug: the marker sat outside the empty-options branch, so a picker
        // with nothing to show still posted `members: []` and the API replaced
        // the roster with nothing. Combined with listMembers failing soft to [],
        // a transient fetch error plus a rename silently deleted the committee's
        // whole membership.
        const html = await render({ legend: "Members", name: "members", options: [] });
        expect(html).not.toContain("__present");
    });

    it("shows the empty message, with no orphan label, when there are no options", async () => {
        const html = await render({
            legend: "Members", name: "members", options: [], emptyMessage: "Nobody yet.",
        });
        expect(html).toContain("Nobody yet.");
        expect(html).not.toContain("<input");
    });

    it("renders the hint alongside the label", async () => {
        const html = await render({ legend: "Members", name: "members", options: OPTIONS });
        expect(html).toContain("Broker");
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/multi-select.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```astro
---
// Multi-select picker. Used for committee members here; plan 4 reuses it for
// the member-group, upcoming-events and partner-group page slots.
//
// A checkbox list rather than <select multiple>: every other form in the
// chapter-admin area works without client JS and this one must too, and native
// multi-selects are unreliable on keyboard (macOS Safari especially). Checkboxes
// post one repeated key per checked box, which FormData.getAll(name) reads.
interface Option {
    value: string;
    label: string;
    hint?: string;
}

interface Props {
    /** Group label. Rendered as a <legend>, so it names the whole set. */
    legend: string;
    name: string;
    options: Option[];
    /** Currently-selected values. */
    selected?: string[];
    helper?: string;
    emptyMessage?: string;
}

const {
    legend, name, options, selected = [], helper,
    emptyMessage = "No options available.",
} = Astro.props;

const chosen = new Set(selected);
---

<fieldset class="multi">
    <legend class="multi__legend">{legend}</legend>

    {options.length === 0 ? (
        <p class="multi__empty">{emptyMessage}</p>
    ) : (
        <>
            <div class="multi__scroll">
                {options.map((o) => (
                    <label class="multi__option">
                        <input
                            type="checkbox"
                            name={name}
                            value={o.value}
                            checked={chosen.has(o.value)}
                        />
                        <span class="multi__text">
                            {o.label}
                            {o.hint && <span class="multi__hint">{o.hint}</span>}
                        </span>
                    </label>
                ))}
            </div>

            {/*
              INSIDE the non-empty branch, deliberately. An all-unchecked list
              posts nothing, so this marker is what tells the mapper "the picker
              was on the form and the user chose none" rather than "no picker".
              When there are no options at all there is no user intent to record,
              and emitting it here would clear the stored relation on any save —
              which is exactly the bug this comment exists to prevent recurring.
            */}
            <input type="hidden" name={`${name}__present`} value="1" />
        </>
    )}

    {helper && <p class="multi__helper">{helper}</p>}
</fieldset>

<style>
    .multi {
        display: flex;
        flex-direction: column;
        gap: var(--space-200);
        width: 100%;
        margin: 0;
        padding: 0;
        border: 0;
    }
    .multi__legend {
        padding: 0;
        font-family: var(--font-family-body);
        font-size: 14px;
        font-weight: 600;
        line-height: 1;
        text-transform: uppercase;
        color: var(--primitive-neutral-500);
    }
    .multi__scroll {
        display: flex;
        flex-direction: column;
        max-height: 260px;
        overflow-y: auto;
        padding: var(--space-200);
        background-color: var(--primitive-neutral-50);
        border: var(--stroke-border) solid var(--primitive-neutral-300);
        border-radius: var(--radius-100);
    }
    .multi__option {
        display: flex;
        align-items: baseline;
        gap: var(--space-300);
        padding: var(--space-200);
        font-family: var(--font-family-body);
        font-size: 16px;
        color: var(--primitive-neutral-900);
        cursor: pointer;
    }
    .multi__option:hover { background-color: var(--primitive-neutral-100); }
    .multi__option input:focus-visible {
        outline: var(--stroke-focus-ring) solid var(--primitive-brand-300);
        outline-offset: 2px;
    }
    .multi__text { display: flex; flex-direction: column; gap: var(--space-100); }
    .multi__hint { font-size: 13px; color: var(--primitive-neutral-600); }
    .multi__helper, .multi__empty {
        margin: 0;
        font-family: var(--font-family-body);
        font-size: 12px;
        line-height: 1.4;
        color: var(--primitive-neutral-600);
    }
    .multi__empty { font-size: 14px; }
</style>
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/multi-select.test.ts
```

Expected: PASS, 6 tests. The "does NOT emit the marker" case is the one guarding against silent roster deletion.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/components/MultiSelect.astro tests/unit/multi-select.test.ts && \
  git commit -m "feat: no-JS checkbox picker with a tested presence marker"
```

---

### Task 9: Committee payload mapping

**Files:** Create `src/lib/committee-form.ts`, `tests/unit/committee-form.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toCommitteePayload, validateCommitteeForm } from "../../src/lib/committee-form";

const form = (entries: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) {
        if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
        else fd.set(k, v);
    }
    return fd;
};

describe("validateCommitteeForm", () => {
    it("requires a name", () => {
        expect(validateCommitteeForm(form({ name: "" }))).toBe("name-required");
        expect(validateCommitteeForm(form({ name: "   " }))).toBe("name-required");
    });

    it("accepts a name alone", () => {
        expect(validateCommitteeForm(form({ name: "Events" }))).toBeNull();
    });
});

describe("toCommitteePayload", () => {
    it("maps name and description", () => {
        const p = toCommitteePayload(form({ name: " Events ", description: " Runs things " }),
            { chapterSlug: "boston" });
        expect(p.name).toBe("Events");
        expect(p.description).toBe("Runs things");
        expect(p.chapterSlug).toBe("boston");
    });

    it("collects every checked member", () => {
        const p = toCommitteePayload(
            form({ name: "E", members: ["m1", "m2", "m3"], members__present: "1" }),
            { chapterSlug: "b" });
        expect(p.members).toEqual(["m1", "m2", "m3"]);
    });

    it("sends an EMPTY array when the picker was shown and nothing checked", () => {
        // An all-unchecked checkbox list posts nothing at all. Without the
        // marker this is indistinguishable from "members untouched", and the
        // API's whitelist would leave the old membership in place — so
        // unchecking everyone would silently do nothing.
        const p = toCommitteePayload(form({ name: "E", members__present: "1" }), { chapterSlug: "b" });
        expect(p.members).toEqual([]);
    });

    it("omits members entirely when the picker was NOT on the form", () => {
        const p = toCommitteePayload(form({ name: "E" }), { chapterSlug: "b" });
        expect(p).not.toHaveProperty("members");
    });

    it("omits chapterSlug on update", () => {
        const p = toCommitteePayload(form({ name: "E" }), { chapterSlug: null });
        expect(p).not.toHaveProperty("chapterSlug");
    });

    it("sends an empty description so it can be cleared", () => {
        // Unlike the events form, which drops empty strings: a description the
        // admin deliberately emptied must actually be emptied. `name` is
        // required and validated above, so this cannot blank a required field.
        const p = toCommitteePayload(form({ name: "E", description: "" }), { chapterSlug: "b" });
        expect(p.description).toBe("");
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/committee-form.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface CommitteePayload {
    name: string;
    chapterSlug?: string;
    description?: string;
    members?: string[];
}

export type CommitteeFormError = "name-required";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

export function validateCommitteeForm(fd: FormData): CommitteeFormError | null {
    return str(fd, "name") ? null : "name-required";
}

/**
 * FormData -> API payload.
 *
 * The `<name>__present` marker is load-bearing. An all-unchecked checkbox list
 * posts no keys at all, so without it "the admin unchecked everyone" and "the
 * form had no member picker" look identical — and because the API whitelist
 * leaves absent fields untouched, the first case would silently keep the old
 * membership. MultiSelect.astro emits the marker whenever it renders options,
 * and deliberately does not when it has none.
 *
 * `description` IS sent when empty, unlike the events form's optional fields,
 * so a description can be cleared. Safe because `name` is the only required
 * field and it is validated first.
 */
export function toCommitteePayload(
    fd: FormData,
    opts: { chapterSlug: string | null }
): CommitteePayload {
    const payload: CommitteePayload = { name: str(fd, "name") };

    if (opts.chapterSlug) payload.chapterSlug = opts.chapterSlug;

    if (fd.has("description")) payload.description = str(fd, "description");

    if (fd.get("members__present") !== null) {
        payload.members = fd.getAll("members").map((m) => String(m)).filter(Boolean);
    }

    return payload;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/committee-form.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/committee-form.ts tests/unit/committee-form.test.ts && \
  git commit -m "feat: committee form payload mapping"
```

---

### Task 10: News payload mapping

**Files:** Create `src/lib/news-form.ts`, `tests/unit/news-form.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toNewsPayload, validateNewsForm } from "../../src/lib/news-form";

const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
};

describe("validateNewsForm", () => {
    it("requires a title", () => {
        expect(validateNewsForm(form({ title: "", body: "x" }))).toBe("title-required");
    });

    it("requires a body — the schema marks it required and Strapi rejects it", () => {
        expect(validateNewsForm(form({ title: "T" }))).toBe("body-required");
        expect(validateNewsForm(form({ title: "T", body: "   " }))).toBe("body-required");
    });

    it("accepts title plus body", () => {
        expect(validateNewsForm(form({ title: "T", body: "Hello" }))).toBeNull();
    });
});

describe("toNewsPayload", () => {
    it("converts the body to blocks", () => {
        const p = toNewsPayload(form({ title: "T", body: "One\nTwo" }), { chapterSlug: "b" });
        expect(p.body).toHaveLength(2);
    });

    it("passes excerpt and publishedDate through", () => {
        const p = toNewsPayload(
            form({ title: "T", body: "x", excerpt: "Short", publishedDate: "2026-09-01" }),
            { chapterSlug: "b" });
        expect(p.excerpt).toBe("Short");
        expect(p.publishedDate).toBe("2026-09-01");
    });

    it("never forwards author — the server sets the byline", () => {
        const p = toNewsPayload(form({ title: "T", body: "x", author: "someone-else" }),
            { chapterSlug: "b" });
        expect(p).not.toHaveProperty("author");
    });

    it("never forwards slug", () => {
        const p = toNewsPayload(form({ title: "T", body: "x", slug: "attacker" }), { chapterSlug: "b" });
        expect(p).not.toHaveProperty("slug");
    });

    it("includes figure only when a media id was supplied", () => {
        const base = form({ title: "T", body: "x" });
        expect(toNewsPayload(base, { chapterSlug: "b" })).not.toHaveProperty("figure");
        expect(toNewsPayload(base, { chapterSlug: "b", figureId: 9 }).figure).toBe(9);
    });

    it("omits chapterSlug on update", () => {
        const p = toNewsPayload(form({ title: "T", body: "x" }), { chapterSlug: null });
        expect(p).not.toHaveProperty("chapterSlug");
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/news-form.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { textToBlocks } from "./blocks";
import type { StrapiBlock } from "../types/strapi";

export interface NewsPayload {
    title: string;
    chapterSlug?: string;
    body?: StrapiBlock[];
    excerpt?: string;
    publishedDate?: string;
    figure?: number;
}

export type NewsFormError = "title-required" | "body-required";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/**
 * `body` is validated here as well as server-side because the schema marks it
 * required:true. Catching it in the form turns a schema-shaped rejection into a
 * sentence the author can act on.
 */
export function validateNewsForm(fd: FormData): NewsFormError | null {
    if (!str(fd, "title")) return "title-required";
    if (!str(fd, "body")) return "body-required";
    return null;
}

/**
 * `author` and `slug` are never forwarded. The server sets the byline from the
 * session so nobody can publish under another member's name, and the slug is
 * written once at create.
 */
export function toNewsPayload(
    fd: FormData,
    opts: { chapterSlug: string | null; figureId?: number }
): NewsPayload {
    const payload: NewsPayload = { title: str(fd, "title") };

    if (opts.chapterSlug) payload.chapterSlug = opts.chapterSlug;

    const body = str(fd, "body");
    if (body) payload.body = textToBlocks(body);

    if (fd.has("excerpt")) payload.excerpt = str(fd, "excerpt");
    if (fd.has("publishedDate")) payload.publishedDate = str(fd, "publishedDate");

    if (typeof opts.figureId === "number") payload.figure = opts.figureId;

    return payload;
}
```

- [ ] **Step 4: Run it, then the whole frontend suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  npx vitest run tests/unit/news-form.test.ts && npm test
```

Expected: 9 tests, then **47 across 6 files** (24 from plan 2, 6 multi-select, 8 committee, 9 news).

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/news-form.ts tests/unit/news-form.test.ts && \
  git commit -m "feat: news form payload mapping"
```

---

## Chunk 4: Client, route helper and Astro routes

### Task 11: Extract the routes' shared security preamble

Five form routes would each open with the same fifteen lines: read the JWT, assert `locals.user`, parse the form, pull `chapterSlug`/`documentId`, run the `administers` guard, build the redirect helpers. That block is the security-relevant part — a copy-paste that loses the `administers` line degrades silently to a worse error page — and five copies is past the point where extraction is speculative.

The route **bodies** stay duplicated. They differ by function identity, and a generic resource handler there would be the bad abstraction.

**Files:** Create `src/lib/form-route.ts`; modify `src/pages/api/chapter-admin/event.ts`

- [ ] **Step 1: Write the helper**

```ts
import type { APIContext } from "astro";
import { SESSION_COOKIE } from "./auth";
import { administers } from "./account";

/** Everything a chapter-admin form route needs, once the guards have passed. */
export interface ChapterAdminPost {
    jwt: string;
    form: FormData;
    /** Hidden `_action` field; "save" when absent. */
    action: string;
    chapterSlug: string;
    /** Empty string when creating. */
    documentId: string;
    /** `/account/chapter/<slug>/<section>` */
    base: string;
    /** The form to return to on validation failure. */
    editPath: string;
    /** Redirect back with flash params, always 303. */
    back: (path: string, params: string) => Response;
}

/**
 * The shared preamble for every chapter-admin form POST.
 *
 * Returns a `Response` when the request must be rejected, or the parsed context
 * when it may proceed — so callers start with:
 *
 *     const begun = await beginChapterAdminPost(ctx, "committees");
 *     if (begun instanceof Response) return begun;
 *
 * The `administers` check is a courtesy that produces a decent error page.
 * Strapi enforces scope on every call regardless, so removing it would cost a
 * nice message, not safety. It lives here precisely so it cannot be dropped by
 * a copy-paste into the sixth route.
 */
export async function beginChapterAdminPost(
    ctx: Pick<APIContext, "request" | "cookies" | "redirect" | "locals">,
    section: string
): Promise<Response | ChapterAdminPost> {
    const { request, cookies, redirect, locals } = ctx;

    const jwt = cookies.get(SESSION_COOKIE)?.value;
    if (!jwt || !locals.user) return redirect("/login?next=/account/chapter", 303);

    const form = await request.formData();
    const chapterSlug = String(form.get("chapterSlug") ?? "");
    const documentId = String(form.get("documentId") ?? "");

    if (!chapterSlug || !administers(locals.user, chapterSlug)) {
        return redirect("/account?error=not-chapter-admin", 303);
    }

    const base = `/account/chapter/${chapterSlug}/${section}`;

    return {
        jwt,
        form,
        action: String(form.get("_action") ?? "save"),
        chapterSlug,
        documentId,
        base,
        editPath: documentId ? `${base}/${documentId}` : `${base}/new`,
        back: (path, params) => redirect(`${path}?${params}`, 303),
    };
}
```

- [ ] **Step 2: Adopt it in `event.ts`**

Replace the preamble in the existing plan-2 route — everything from `const jwt =` down to the `editPath` assignment — with:

```ts
import type { APIRoute } from "astro";
import { beginChapterAdminPost } from "../../../lib/form-route";
import { toEventPayload, validateEventForm } from "../../../lib/event-form";
import {
    createEvent, updateEvent, deleteEvent, uploadMedia,
} from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
    const begun = await beginChapterAdminPost(ctx, "events");
    if (begun instanceof Response) return begun;
    const { jwt, form, action, chapterSlug, documentId, base, editPath, back } = begun;

    // …the rest of the handler is unchanged from plan 2…
```

Leave the delete branch, validation, upload and save dispatch exactly as they are.

- [ ] **Step 3: Prove events still work end to end**

This is shipped, working code; the refactor must not change behaviour. With the CMS running:

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && npm test
```

Expected: 0 errors, 47 passed. Then sign in as `chapadmin@areaa.test`, create an event, edit it, delete it. If any of those break, revert this step rather than debugging forward — the extraction is a convenience, not a requirement.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/form-route.ts src/pages/api/chapter-admin/event.ts && \
  git commit -m "refactor: extract the chapter-admin form route preamble"
```

---

### Task 12: Extend the chapter-admin client

**Files:** Modify `src/lib/chapter-admin.ts`

- [ ] **Step 1: Add the types and calls**

Note every list call takes a `chapterSlug`. v1's did not, so a multi-chapter admin saw another chapter's records on a page scoped to this one.

```ts
export interface ChapterMember {
    documentId: string;
    displayName: string;
    title: string;
}

export interface AdminCommittee {
    documentId: string;
    name: string;
    description?: string;
    members?: { documentId: string; displayName?: string; firstName?: string; lastName?: string }[];
    chapter?: { name: string; slug: string } | null;
}

export interface AdminNewsItem {
    documentId: string;
    title: string;
    slug: string;
    excerpt?: string;
    body?: unknown[];
    publishedDate?: string;
    figure?: { id: number; url: string } | null;
    author?: { displayName?: string; firstName?: string; lastName?: string } | null;
    // Present so the list page can filter to the chapter in the URL, the same
    // way the committees page does.
    chapter?: { name: string; slug: string } | null;
}

export interface AdminChapterSettings {
    documentId: string;
    name: string;
    slug: string;
    email: string;
}

export interface AdminSubmission {
    documentId: string;
    data: Record<string, unknown> | null;
    submittedAt?: string;
    handled: boolean;
    chapter?: { name: string; slug: string } | null;
}

/**
 * Members of one chapter, for the pickers.
 *
 * Returns null on failure rather than an empty list. A soft [] would render as
 * "this chapter has no members", and combined with the picker's presence marker
 * that once meant a save could silently clear the whole roster.
 */
export async function listMembers(
    jwt: string, chapterSlug: string
): Promise<ChapterMember[] | null> {
    const { status, body } = await call(jwt, `/members?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && Array.isArray(body?.data) ? body.data : null;
}

export async function listCommittees(jwt: string): Promise<AdminCommittee[] | null> {
    const { status, body } = await call(jwt, "/committees?pageSize=100");
    return status === 200 && body?.data ? body.data : null;
}

export async function getCommittee(jwt: string, documentId: string): Promise<AdminCommittee | null> {
    const all = await listCommittees(jwt);
    return all?.find((c) => c.documentId === documentId) ?? null;
}

export async function saveCommittee(
    jwt: string, documentId: string | null, payload: unknown
): Promise<{ ok: boolean; status: number; message: string }> {
    const { status, body } = documentId
        ? await call(jwt, `/committees/${documentId}`, { method: "PUT", body: JSON.stringify(payload) })
        : await call(jwt, "/committees", { method: "POST", body: JSON.stringify(payload) });
    return { ok: status === 200 && Boolean(body?.data), status, message: messageOf(body, status) };
}

export async function deleteCommittee(jwt: string, documentId: string) {
    const { status } = await call(jwt, `/committees/${documentId}`, { method: "DELETE" });
    return { ok: status === 200, status };
}

export async function listNews(jwt: string, { page = 1, pageSize = 25 } = {}): Promise<
    { ok: true; items: AdminNewsItem[]; pagination: Pagination } | { ok: false; status: number }
> {
    const { status, body } = await call(jwt, `/news?page=${page}&pageSize=${pageSize}`);
    if (status !== 200 || !body?.data) return { ok: false, status };
    return { ok: true, items: body.data, pagination: body.meta?.pagination ?? EMPTY_PAGINATION };
}

export async function getNewsItem(jwt: string, documentId: string): Promise<AdminNewsItem | null> {
    const res = await listNews(jwt, { pageSize: 100 });
    if (!res.ok) return null;
    return res.items.find((n) => n.documentId === documentId) ?? null;
}

export async function saveNews(
    jwt: string, documentId: string | null, payload: unknown
): Promise<{ ok: boolean; status: number; message: string }> {
    const { status, body } = documentId
        ? await call(jwt, `/news/${documentId}`, { method: "PUT", body: JSON.stringify(payload) })
        : await call(jwt, "/news", { method: "POST", body: JSON.stringify(payload) });
    return { ok: status === 200 && Boolean(body?.data), status, message: messageOf(body, status) };
}

export async function deleteNews(jwt: string, documentId: string) {
    const { status } = await call(jwt, `/news/${documentId}`, { method: "DELETE" });
    return { ok: status === 200, status };
}

export async function getChapterSettings(
    jwt: string, chapterSlug: string
): Promise<AdminChapterSettings | null> {
    const { status, body } = await call(jwt, `/chapter?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && body?.data ? body.data : null;
}

export async function saveChapterSettings(
    jwt: string, payload: unknown
): Promise<{ ok: boolean; status: number; message: string }> {
    const { status, body } = await call(jwt, "/chapter", { method: "PUT", body: JSON.stringify(payload) });
    return { ok: status === 200 && Boolean(body?.data), status, message: messageOf(body, status) };
}

export async function listSubmissions(
    jwt: string, chapterSlug: string
): Promise<AdminSubmission[] | null> {
    const { status, body } = await call(
        jwt, `/submissions?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && body?.data ? body.data : null;
}

export async function setSubmissionHandled(jwt: string, documentId: string, handled: boolean) {
    const { status } = await call(jwt, `/submissions/${documentId}`, {
        method: "PUT", body: JSON.stringify({ handled }),
    });
    return { ok: status === 200, status };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **0 errors.**

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/chapter-admin.ts && \
  git commit -m "feat: client calls for members, committees, news, settings and submissions"
```

---

### Task 13: The four Astro API routes

Committee and news dispatch on `_action`; settings and submission have a single action each. All four start from `beginChapterAdminPost`.

**Files:** Create `src/pages/api/chapter-admin/{committee,news,settings,submission}.ts`

- [ ] **Step 1: `committee.ts`**

```ts
import type { APIRoute } from "astro";
import { beginChapterAdminPost } from "../../../lib/form-route";
import { toCommitteePayload, validateCommitteeForm } from "../../../lib/committee-form";
import { saveCommittee, deleteCommittee } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
    const begun = await beginChapterAdminPost(ctx, "committees");
    if (begun instanceof Response) return begun;
    const { jwt, form, action, chapterSlug, documentId, base, editPath, back } = begun;

    if (action === "delete") {
        if (!documentId) return back(base, "error=missing");
        const result = await deleteCommittee(jwt, documentId);
        return back(base, result.ok ? "deleted=1" : `error=${result.status === 403 ? "forbidden" : "delete"}`);
    }

    const invalid = validateCommitteeForm(form);
    if (invalid) return back(editPath, `error=${invalid}`);

    const payload = toCommitteePayload(form, { chapterSlug: documentId ? null : chapterSlug });
    const result = await saveCommittee(jwt, documentId || null, payload);

    if (!result.ok) {
        // 403 is either "not your chapter" or "that member isn't in your
        // chapter"; the form shows one sentence covering both.
        if (result.status === 403) return back(editPath, "error=forbidden");
        return back(editPath, `error=save&message=${encodeURIComponent(result.message)}`);
    }
    return back(base, documentId ? "saved=1" : "created=1");
};
```

- [ ] **Step 2: `news.ts`**

```ts
import type { APIRoute } from "astro";
import { beginChapterAdminPost } from "../../../lib/form-route";
import { toNewsPayload, validateNewsForm } from "../../../lib/news-form";
import { saveNews, deleteNews, uploadMedia } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
    const begun = await beginChapterAdminPost(ctx, "news");
    if (begun instanceof Response) return begun;
    const { jwt, form, action, chapterSlug, documentId, base, editPath, back } = begun;

    if (action === "delete") {
        if (!documentId) return back(base, "error=missing");
        const result = await deleteNews(jwt, documentId);
        return back(base, result.ok ? "deleted=1" : `error=${result.status === 403 ? "forbidden" : "delete"}`);
    }

    const invalid = validateNewsForm(form);
    if (invalid) return back(editPath, `error=${invalid}`);

    // Uploaded first so its id rides along in the same save. An upload whose
    // save then fails leaves an orphan, which the spec accepts.
    let figureId: number | undefined;
    const file = form.get("figure");
    if (file instanceof File && file.size > 0) {
        const upload = await uploadMedia(jwt, file);
        if (!upload.ok) {
            return back(editPath, `error=upload&message=${encodeURIComponent(upload.message)}`);
        }
        figureId = upload.id;
    }

    const payload = toNewsPayload(form, {
        chapterSlug: documentId ? null : chapterSlug, figureId,
    });
    const result = await saveNews(jwt, documentId || null, payload);

    if (!result.ok) {
        if (result.status === 403) return back(editPath, "error=forbidden");
        return back(editPath, `error=save&message=${encodeURIComponent(result.message)}`);
    }
    return back(base, documentId ? "saved=1" : "created=1");
};
```

- [ ] **Step 3: `settings.ts`**

```ts
import type { APIRoute } from "astro";
import { beginChapterAdminPost } from "../../../lib/form-route";
import { saveChapterSettings } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
    const begun = await beginChapterAdminPost(ctx, "settings");
    if (begun instanceof Response) return begun;
    const { jwt, form, chapterSlug, back } = begun;

    // `settings` is a page, not a directory, so the section path needs no
    // trailing segment — back() is called with the page path directly.
    const path = `/account/chapter/${chapterSlug}/settings`;

    const name = String(form.get("name") ?? "").trim();
    if (!name) return back(path, "error=name-required");

    // `slug` is deliberately not sent: it is a uid that will not regenerate, and
    // already-written event slug prefixes would not follow it if it did.
    const result = await saveChapterSettings(jwt, {
        chapterSlug, name, email: String(form.get("email") ?? "").trim(),
    });

    if (!result.ok) {
        return back(path, result.status === 403 ? "error=forbidden" : "error=save");
    }
    return back(path, "saved=1");
};
```

- [ ] **Step 4: `submission.ts`**

```ts
import type { APIRoute } from "astro";
import { beginChapterAdminPost } from "../../../lib/form-route";
import { setSubmissionHandled } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
    const begun = await beginChapterAdminPost(ctx, "submissions");
    if (begun instanceof Response) return begun;
    const { jwt, form, chapterSlug, documentId, back } = begun;

    const path = `/account/chapter/${chapterSlug}/submissions`;
    if (!documentId) return back(path, "error=missing");

    // The form posts the state it WANTS, not the state it has: `handled`
    // present => set true, absent => set false. submissions.astro renders the
    // hidden field only for rows that are currently unhandled, so one button
    // toggles both directions with no JS. (There is no checkbox here — an
    // earlier draft's comment said there was.)
    const handled = form.get("handled") != null;
    const result = await setSubmissionHandled(jwt, documentId, handled);

    return back(path, result.ok ? "saved=1" : "error=save");
};
```

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/pages/api/chapter-admin/ && \
  git commit -m "feat: committee, news, settings and submission API routes"
```

Expected: **0 errors.**

---

## Chunk 5: Committee screens

### Task 14: Add the nav entries

**Files:** Modify `src/layouts/ChapterAdminLayout.astro`

- [ ] **Step 1: Replace `NAV` and its now-stale comment**

The existing comment above `NAV` reads "Only events exist today; plan 3 adds the rest." Replace both:

```js
// Chapter-scoped navigation. Listed here rather than in lib/account.ts because
// this nav belongs to a chapter, not to the member. /page and /partners arrive
// in plan 4.
const NAV = [
    { key: "overview", label: "Overview", href: `/account/chapter/${chapterSlug}` },
    { key: "events", label: "Events", href: `/account/chapter/${chapterSlug}/events` },
    { key: "news", label: "News", href: `/account/chapter/${chapterSlug}/news` },
    { key: "committees", label: "Committees", href: `/account/chapter/${chapterSlug}/committees` },
    { key: "submissions", label: "Submissions", href: `/account/chapter/${chapterSlug}/submissions` },
    { key: "settings", label: "Settings", href: `/account/chapter/${chapterSlug}/settings` },
];
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/layouts/ChapterAdminLayout.astro && \
  git commit -m "feat: nav entries for the new chapter-admin sections"
```

Expected: **0 errors.**

---

### Task 15: `CommitteeForm.astro`

**Files:** Create `src/components/CommitteeForm.astro`

- [ ] **Step 1: Write it**

```astro
---
import FormField from "./FormField.astro";
import MultiSelect from "./MultiSelect.astro";
import type { AdminCommittee, ChapterMember } from "../lib/chapter-admin";

interface Props {
    chapterSlug: string;
    /** null means the member list could not be loaded — NOT that it is empty. */
    members: ChapterMember[] | null;
    committee?: AdminCommittee | null;
    error?: string | null;
}

const { chapterSlug, members, committee = null, error = null } = Astro.props;
const isEdit = Boolean(committee?.documentId);

const selected = (committee?.members ?? [])
    .map((m) => m.documentId)
    .filter(Boolean) as string[];

const options = (members ?? []).map((m) => ({
    value: m.documentId,
    label: m.displayName || "(unnamed member)",
    hint: m.title || undefined,
}));

const messages: Record<string, string> = {
    "name-required": "Give the committee a name.",
    forbidden: "You don't have permission to change this, or someone you selected isn't a member of this chapter.",
    save: "Something went wrong saving this committee. Please try again.",
};
const errorMessage = error ? (messages[error] ?? messages.save) : null;
---

<form class="cform" method="post" action="/api/chapter-admin/committee">
    <input type="hidden" name="_action" value="save" />
    <input type="hidden" name="chapterSlug" value={chapterSlug} />
    {isEdit && <input type="hidden" name="documentId" value={committee!.documentId} />}

    {errorMessage && <p class="cform__error" role="alert">{errorMessage}</p>}

    <FormField label="Name" name="name" required value={committee?.name ?? ""}
        placeholder="Membership Committee" />

    <FormField label="Description" name="description" type="textarea"
        value={committee?.description ?? ""}
        placeholder="What does this committee do?" />

    {members === null ? (
        /*
          The member list failed to load. Render the current membership as
          read-only text and DO NOT render the picker — MultiSelect would emit
          no presence marker for an empty option list anyway, but being explicit
          here means a save on this screen cannot touch the roster at all.
        */
        <div class="cform__members-error" role="alert">
            <p>Couldn't load this chapter's members, so the roster can't be edited right now.</p>
            <p class="cform__members-note">
                Saving will leave the current members unchanged. Refresh to try again.
            </p>
        </div>
    ) : (
        <MultiSelect
            legend="Members"
            name="members"
            options={options}
            selected={selected}
            emptyMessage="This chapter has no members to assign yet."
            helper="Only this chapter's members are listed. Unchecking everyone removes them all."
        />
    )}

    <div class="cform__actions">
        <button type="submit" class="btn btn--primary">
            {isEdit ? "Save Changes" : "Create Committee"}
        </button>
        <a href={`/account/chapter/${chapterSlug}/committees`} class="btn btn--secondary">Cancel</a>
    </div>
</form>

{isEdit && (
    <form class="cform__danger" method="post" action="/api/chapter-admin/committee">
        <input type="hidden" name="_action" value="delete" />
        <input type="hidden" name="chapterSlug" value={chapterSlug} />
        <input type="hidden" name="documentId" value={committee!.documentId} />
        <button type="submit" class="cform__delete">Delete this committee</button>
    </form>
)}

<style>
    .cform { display: flex; flex-direction: column; gap: var(--space-600); }
    .cform__error, .cform__members-error {
        margin: 0; padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body); font-size: 16px;
    }
    .cform__members-error p { margin: 0; }
    .cform__members-note { margin-top: var(--space-200) !important; font-size: 14px; }
    .cform__actions { display: flex; gap: var(--space-400); }
    .cform__danger { margin-top: var(--space-1200); }
    .cform__delete {
        background: none; border: none; padding: 0; cursor: pointer;
        font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-600); text-decoration: underline;
    }
    .cform__delete:hover, .cform__delete:focus-visible { color: var(--primitive-brand-500); }
    @media (max-width: 768px) {
        .cform__actions { flex-direction: column; }
        .cform__actions .btn { width: 100%; }
    }
</style>
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/components/CommitteeForm.astro && \
  git commit -m "feat: committee form component"
```

Expected: **0 errors.**

---

### Task 16: Committee pages

**Files:** Create the three pages under `src/pages/account/chapter/[chapterSlug]/committees/`

- [ ] **Step 1: `index.astro`**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { listCommittees } from "../../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const all = await listCommittees(jwt);
const failed = all === null;
// The API scopes to every chapter the caller administers; this page is scoped
// to one. Without the filter a multi-chapter admin sees another chapter's
// committees here, and clicking through renders the form with THIS chapter's
// members — so every save 403s with no way forward.
const rows = (all ?? []).filter((c) => c.chapter?.slug === chapter.slug);

const sp = Astro.url.searchParams;
const flash = sp.get("saved") ? "Committee saved."
    : sp.get("created") ? "Committee created."
    : sp.get("deleted") ? "Committee deleted."
    : null;

const errorMessages: Record<string, string> = {
    missing: "That committee could not be found.",
    forbidden: "You don't have permission to change that committee.",
    delete: "That committee couldn't be deleted. Please try again.",
};
const errorParam = sp.get("error");
const errorMessage = errorParam ? (errorMessages[errorParam] ?? errorMessages.delete) : null;

const base = `/account/chapter/${chapter.slug}/committees`;
const nameOf = (m: { displayName?: string; firstName?: string; lastName?: string }) =>
    m.displayName || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "(unnamed)";
---

<ChapterAdminLayout
    title={`Committees | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="committees"
>
    <div class="clist__head">
        <h1 class="clist__title">Committees</h1>
        <a href={`${base}/new`} class="btn btn--primary">Add Committee</a>
    </div>

    {flash && <p class="clist__flash" role="status">{flash}</p>}
    {errorMessage && <p class="clist__error" role="alert">{errorMessage}</p>}
    {failed && (
        <p class="clist__error" role="alert">
            Couldn't load committees. Please refresh, or try again shortly.
        </p>
    )}

    {!failed && rows.length === 0 && (
        <p class="clist__empty">No committees yet. <a href={`${base}/new`}>Create the first one.</a></p>
    )}

    {rows.length > 0 && (
        <ul class="clist__list">
            {rows.map((c) => (
                <li class="clist__row">
                    <div>
                        <a class="clist__name" href={`${base}/${c.documentId}`}>{c.name}</a>
                        {c.members && c.members.length > 0 && (
                            <p class="clist__members">{c.members.map(nameOf).join(", ")}</p>
                        )}
                    </div>
                    <span class="clist__count">
                        {c.members?.length ?? 0} {c.members?.length === 1 ? "member" : "members"}
                    </span>
                </li>
            ))}
        </ul>
    )}
</ChapterAdminLayout>

<style>
    .clist__head { display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-800); margin-bottom: var(--space-800); }
    .clist__title { margin: 0; font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    .clist__flash, .clist__error {
        margin: 0 0 var(--space-600); padding: var(--space-300) var(--space-400);
        border-radius: var(--radius-100); font-family: var(--font-family-body);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        background-color: var(--primitive-brand-50); color: var(--primitive-brand-700);
    }
    .clist__empty { font-family: var(--font-family-body); color: var(--primitive-neutral-700); }
    .clist__list { margin: 0; padding: 0; list-style: none;
        display: flex; flex-direction: column; gap: var(--space-300); }
    .clist__row { display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-600); padding: var(--space-400);
        background-color: var(--primitive-neutral-100); border-radius: var(--radius-100); }
    .clist__name { font-family: var(--font-family-body); font-weight: 700;
        color: var(--primitive-brand-500); text-decoration: none; }
    .clist__name:hover, .clist__name:focus-visible { text-decoration: underline; }
    .clist__members { margin: var(--space-100) 0 0; font-family: var(--font-family-body);
        font-size: 13px; color: var(--primitive-neutral-600); }
    .clist__count { font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-700); white-space: nowrap; }
    @media (max-width: 768px) {
        .clist__title { font-size: 36px; }
        .clist__head { flex-direction: column; align-items: flex-start; }
        .clist__row { flex-direction: column; align-items: flex-start; gap: var(--space-200); }
    }
</style>
```

- [ ] **Step 2: `new.astro`**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import CommitteeForm from "../../../../../components/CommitteeForm.astro";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { listMembers } from "../../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
// null means "could not load", which the form renders differently from "none".
const members = await listMembers(jwt, chapter.slug);
const error = Astro.url.searchParams.get("error");
---

<ChapterAdminLayout
    title={`New Committee | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="committees"
>
    <h1 class="cnew__title">New Committee</h1>
    <CommitteeForm chapterSlug={chapter.slug} members={members} error={error} />
</ChapterAdminLayout>

<style>
    .cnew__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    @media (max-width: 768px) { .cnew__title { font-size: 36px; } }
</style>
```

- [ ] **Step 3: `[documentId].astro`**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import CommitteeForm from "../../../../../components/CommitteeForm.astro";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { getCommittee, listMembers } from "../../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug, documentId } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const [committee, members] = await Promise.all([
    getCommittee(jwt, documentId!),
    listMembers(jwt, chapter.slug),
]);

// getCommittee searches the caller's own chapter-scoped list, so a miss means
// the committee does not exist OR belongs to someone else — indistinguishable
// here, and a redirect is the right answer either way.
if (!committee) return Astro.redirect(`/account/chapter/${chapter.slug}/committees?error=missing`);

const error = Astro.url.searchParams.get("error");
---

<ChapterAdminLayout
    title={`${committee.name} | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="committees"
>
    <h1 class="cedit__title">Edit Committee</h1>
    <CommitteeForm chapterSlug={chapter.slug} members={members} committee={committee} error={error} />
</ChapterAdminLayout>

<style>
    .cedit__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    @media (max-width: 768px) { .cedit__title { font-size: 36px; } }
</style>
```

- [ ] **Step 4: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add "src/pages/account/chapter/[chapterSlug]/committees/" && \
  git commit -m "feat: committee list, create and edit pages"
```

Expected: **0 errors.**

---

## Chunk 6: News, settings and submissions screens

### Task 17: `NewsForm.astro`

**Files:** Create `src/components/NewsForm.astro`

- [ ] **Step 1: Write it**

```astro
---
import FormField from "./FormField.astro";
import { blocksToPlainText } from "../lib/blocks";
import type { AdminNewsItem } from "../lib/chapter-admin";

interface Props {
    chapterSlug: string;
    /** Absent when creating. Named `item`, not `event`. */
    item?: AdminNewsItem | null;
    error?: string | null;
}

const { chapterSlug, item = null, error = null } = Astro.props;
const isEdit = Boolean(item?.documentId);

const messages: Record<string, string> = {
    "title-required": "Give the article a title.",
    "body-required": "Write the article body.",
    forbidden: "You don't have permission to edit this chapter's news.",
    upload: "That image couldn't be uploaded. It must be a JPEG, PNG, WebP or AVIF under 5MB.",
    save: "Something went wrong saving this article. Please try again.",
};
const errorMessage = error ? (messages[error] ?? messages.save) : null;
---

<form class="nform" method="post" action="/api/chapter-admin/news" enctype="multipart/form-data" novalidate>
    <input type="hidden" name="_action" value="save" />
    <input type="hidden" name="chapterSlug" value={chapterSlug} />
    {isEdit && <input type="hidden" name="documentId" value={item!.documentId} />}

    {errorMessage && <p class="nform__error" role="alert">{errorMessage}</p>}

    <FormField label="Title" name="title" required value={item?.title ?? ""}
        placeholder="Chapter wins national award" />

    <FormField label="Excerpt" name="excerpt" type="textarea" value={item?.excerpt ?? ""}
        placeholder="One or two sentences for listings." helper="Optional." />

    <FormField label="Body" name="body" type="textarea" required
        value={blocksToPlainText((item?.body ?? []) as never)}
        placeholder="The article."
        helper="Plain text for now — one paragraph per line. Formatting is coming soon." />

    <FormField label="Published Date" name="publishedDate" value={item?.publishedDate ?? ""}
        placeholder="2026-09-01" helper="YYYY-MM-DD. Optional." />

    <FormField label={item?.figure ? "Replace Image" : "Image"} name="figure" type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        helper="JPEG, PNG, WebP or AVIF, up to 5MB." />
    {item?.figure && (
        <p class="nform__current">
            Current image: <a href={item.figure.url} target="_blank" rel="noopener">view</a>
        </p>
    )}

    <div class="nform__actions">
        <button type="submit" class="btn btn--primary">
            {isEdit ? "Save Changes" : "Publish Article"}
        </button>
        <a href={`/account/chapter/${chapterSlug}/news`} class="btn btn--secondary">Cancel</a>
    </div>
</form>

{isEdit && (
    <form class="nform__danger" method="post" action="/api/chapter-admin/news">
        <input type="hidden" name="_action" value="delete" />
        <input type="hidden" name="chapterSlug" value={chapterSlug} />
        <input type="hidden" name="documentId" value={item!.documentId} />
        <button type="submit" class="nform__delete">Delete this article</button>
    </form>
)}

<style>
    .nform { display: flex; flex-direction: column; gap: var(--space-600); }
    .nform__error {
        margin: 0; padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body); font-size: 16px;
    }
    .nform__current { margin: 0; font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-700); }
    .nform__actions { display: flex; gap: var(--space-400); }
    .nform__danger { margin-top: var(--space-1200); }
    .nform__delete {
        background: none; border: none; padding: 0; cursor: pointer;
        font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-600); text-decoration: underline;
    }
    .nform__delete:hover, .nform__delete:focus-visible { color: var(--primitive-brand-500); }
    @media (max-width: 768px) {
        .nform__actions { flex-direction: column; }
        .nform__actions .btn { width: 100%; }
    }
</style>
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/components/NewsForm.astro && git commit -m "feat: news form component"
```

Expected: **0 errors.**

---

### Task 18: News pages

v1 specified these as "copy the events pages and substitute", which omitted `const base`, the `error=missing` redirect target and the `/events/{slug}` row text — all of which typecheck and run wrong. Full source below.

**Files:** Create the three pages under `src/pages/account/chapter/[chapterSlug]/news/`

- [ ] **Step 1: `index.astro`**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { listNews } from "../../../../../lib/chapter-admin";
import { pageItems } from "../../../../../lib/pagination";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const sp = Astro.url.searchParams;
const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const result = await listNews(jwt, { page });
const failed = !result.ok;
// Scoped to the chapter in the URL — the API returns every administered chapter.
const items = result.ok ? result.items.filter((n) => n.chapter?.slug === chapter.slug) : [];
const pagination = result.ok ? result.pagination : { page: 1, pageSize: 25, pageCount: 1, total: 0 };

const flash = sp.get("saved") ? "Article saved."
    : sp.get("created") ? "Article published."
    : sp.get("deleted") ? "Article deleted."
    : null;

const errorMessages: Record<string, string> = {
    missing: "That article could not be found.",
    forbidden: "You don't have permission to change that article.",
    delete: "That article couldn't be deleted. Please try again.",
};
const errorParam = sp.get("error");
const errorMessage = errorParam ? (errorMessages[errorParam] ?? errorMessages.delete) : null;

const base = `/account/chapter/${chapter.slug}/news`;
const items_ = pageItems(page, pagination.pageCount);

// publishedDate is a Strapi `date` ("2026-09-01"), which parses as UTC
// midnight. Formatting it in local time shows the PREVIOUS day in any negative-
// offset zone — lib/auth.ts documents the same trap for memberSince. Do not
// reuse the events page's toLocaleString here.
const formatPublished = (iso?: string) => {
    if (!iso) return "No date";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "No date";
    return d.toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
    });
};
---

<ChapterAdminLayout
    title={`News | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="news"
>
    <div class="nlist__head">
        <h1 class="nlist__title">News</h1>
        <a href={`${base}/new`} class="btn btn--primary">Add Article</a>
    </div>

    {flash && <p class="nlist__flash" role="status">{flash}</p>}
    {errorMessage && <p class="nlist__error" role="alert">{errorMessage}</p>}
    {failed && (
        <p class="nlist__error" role="alert">
            Couldn't load news. Please refresh, or try again shortly.
        </p>
    )}

    {!failed && items.length === 0 && (
        <p class="nlist__empty">No articles yet. <a href={`${base}/new`}>Write the first one.</a></p>
    )}

    {items.length > 0 && (
        <ul class="nlist__list">
            {items.map((n) => (
                <li class="nlist__row">
                    <div>
                        <a class="nlist__name" href={`${base}/${n.documentId}`}>{n.title}</a>
                        <p class="nlist__slug">/news/{n.slug}</p>
                    </div>
                    <span class="nlist__date">{formatPublished(n.publishedDate)}</span>
                </li>
            ))}
        </ul>
    )}

    {pagination.pageCount > 1 && (
        <nav class="nlist__pagination" aria-label="News pages">
            <ul>
                {items_.map((it) =>
                    it === "…" ? (
                        <li><span>…</span></li>
                    ) : (
                        <li>
                            <a href={`${base}?page=${it}`}
                               class:list={["nlist__page", { "nlist__page--active": it === page }]}
                               aria-current={it === page ? "page" : undefined}>{it}</a>
                        </li>
                    )
                )}
            </ul>
        </nav>
    )}
</ChapterAdminLayout>

<style>
    .nlist__head { display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-800); margin-bottom: var(--space-800); }
    .nlist__title { margin: 0; font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    .nlist__flash, .nlist__error {
        margin: 0 0 var(--space-600); padding: var(--space-300) var(--space-400);
        border-radius: var(--radius-100); font-family: var(--font-family-body);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        background-color: var(--primitive-brand-50); color: var(--primitive-brand-700);
    }
    .nlist__empty { font-family: var(--font-family-body); color: var(--primitive-neutral-700); }
    .nlist__list { margin: 0; padding: 0; list-style: none;
        display: flex; flex-direction: column; gap: var(--space-300); }
    .nlist__row { display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-600); padding: var(--space-400);
        background-color: var(--primitive-neutral-100); border-radius: var(--radius-100); }
    .nlist__name { font-family: var(--font-family-body); font-weight: 700;
        color: var(--primitive-brand-500); text-decoration: none; }
    .nlist__name:hover, .nlist__name:focus-visible { text-decoration: underline; }
    .nlist__slug { margin: var(--space-100) 0 0; font-family: var(--font-family-body);
        font-size: 13px; color: var(--primitive-neutral-500); }
    .nlist__date { font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-700); white-space: nowrap; }
    .nlist__pagination ul { display: flex; gap: var(--space-300); list-style: none;
        margin: var(--space-800) 0 0; padding: 0; font-family: var(--font-family-body); }
    .nlist__page { color: var(--primitive-neutral-700); text-decoration: none; }
    .nlist__page--active { color: var(--primitive-brand-500); font-weight: 700; }
    @media (max-width: 768px) {
        .nlist__title { font-size: 36px; }
        .nlist__head { flex-direction: column; align-items: flex-start; }
        .nlist__row { flex-direction: column; align-items: flex-start; gap: var(--space-200); }
    }
</style>
```

- [ ] **Step 2: `new.astro`**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import NewsForm from "../../../../../components/NewsForm.astro";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const error = Astro.url.searchParams.get("error");
---

<ChapterAdminLayout
    title={`New Article | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="news"
>
    <h1 class="nnew__title">New Article</h1>
    <NewsForm chapterSlug={chapter.slug} error={error} />
</ChapterAdminLayout>

<style>
    .nnew__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    @media (max-width: 768px) { .nnew__title { font-size: 36px; } }
</style>
```

- [ ] **Step 3: `[documentId].astro`**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import NewsForm from "../../../../../components/NewsForm.astro";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { getNewsItem } from "../../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug, documentId } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const item = await getNewsItem(jwt, documentId!);
// A miss means the article does not exist OR belongs to another chapter —
// indistinguishable here, and the same redirect is right either way.
if (!item) return Astro.redirect(`/account/chapter/${chapter.slug}/news?error=missing`);

const error = Astro.url.searchParams.get("error");
---

<ChapterAdminLayout
    title={`${item.title} | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="news"
>
    <h1 class="nedit__title">Edit Article</h1>
    <NewsForm chapterSlug={chapter.slug} item={item} error={error} />
</ChapterAdminLayout>

<style>
    .nedit__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    @media (max-width: 768px) { .nedit__title { font-size: 36px; } }
</style>
```

- [ ] **Step 4: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add "src/pages/account/chapter/[chapterSlug]/news/" && \
  git commit -m "feat: news list, create and edit pages"
```

Expected: **0 errors.**

---

### Task 19: Settings and submissions pages

**Files:** Create `settings.astro` and `submissions.astro` under `src/pages/account/chapter/[chapterSlug]/`

- [ ] **Step 1: `settings.astro`**

```astro
---
import ChapterAdminLayout from "../../../../layouts/ChapterAdminLayout.astro";
import FormField from "../../../../components/FormField.astro";
import { SESSION_COOKIE } from "../../../../lib/auth";
import { getChapterSettings } from "../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const settings = await getChapterSettings(jwt, chapter.slug);

const sp = Astro.url.searchParams;
const flash = sp.get("saved") ? "Settings saved." : null;
const error = sp.get("error");
const messages: Record<string, string> = {
    "name-required": "The chapter needs a name.",
    forbidden: "You don't have permission to change this chapter.",
    save: "Something went wrong saving. Please try again.",
};
const errorMessage = error ? (messages[error] ?? messages.save) : null;
---

<ChapterAdminLayout
    title={`Settings | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="settings"
>
    <h1 class="cset__title">Settings</h1>

    {flash && <p class="cset__flash" role="status">{flash}</p>}
    {errorMessage && <p class="cset__error" role="alert">{errorMessage}</p>}

    {settings === null ? (
        <p class="cset__error" role="alert">Couldn't load this chapter's settings. Please refresh.</p>
    ) : (
        <form class="cset" method="post" action="/api/chapter-admin/settings" novalidate>
            <input type="hidden" name="chapterSlug" value={chapter.slug} />

            <FormField label="Chapter Name" name="name" required value={settings.name} />
            <FormField label="Contact Email" name="email" type="email" value={settings.email}
                placeholder="chapter@areaa.org"
                helper="Shown on your chapter's microsite." />

            <div class="cset__readonly">
                <p class="cset__readonly-label">Web address</p>
                <p class="cset__readonly-value">/chapters/{settings.slug}</p>
                <p class="cset__readonly-note">
                    Changing a chapter's web address would break existing links and every
                    event and article URL already published under it, so it stays a national
                    operation. Contact national if it needs to change.
                </p>
            </div>

            <div class="cset__actions">
                <button type="submit" class="btn btn--primary">Save Settings</button>
            </div>
        </form>
    )}
</ChapterAdminLayout>

<style>
    .cset__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    .cset { display: flex; flex-direction: column; gap: var(--space-600); max-width: 640px; }
    .cset__flash, .cset__error {
        margin: 0 0 var(--space-600); padding: var(--space-300) var(--space-400);
        border-radius: var(--radius-100); font-family: var(--font-family-body);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        background-color: var(--primitive-brand-50); color: var(--primitive-brand-700);
    }
    .cset__readonly { font-family: var(--font-family-body); }
    .cset__readonly-label { margin: 0 0 var(--space-100); font-size: 14px; font-weight: 600;
        text-transform: uppercase; color: var(--primitive-neutral-500); }
    .cset__readonly-value { margin: 0; font-size: 16px; color: var(--primitive-neutral-900); }
    .cset__readonly-note { margin: var(--space-200) 0 0; font-size: 12px; line-height: 1.4;
        color: var(--primitive-neutral-600); }
    .cset__actions { display: flex; gap: var(--space-400); }
    @media (max-width: 768px) { .cset__title { font-size: 36px; } }
</style>
```

- [ ] **Step 2: `submissions.astro`**

```astro
---
import ChapterAdminLayout from "../../../../layouts/ChapterAdminLayout.astro";
import { SESSION_COOKIE } from "../../../../lib/auth";
import { listSubmissions } from "../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const submissions = await listSubmissions(jwt, chapter.slug);
const failed = submissions === null;
const rows = submissions ?? [];

const sp = Astro.url.searchParams;
const flash = sp.get("saved") ? "Updated." : null;
const errorMessages: Record<string, string> = {
    missing: "That submission could not be found.",
    save: "That change couldn't be saved. Please try again.",
};
const errorParam = sp.get("error");
const errorMessage = errorParam ? (errorMessages[errorParam] ?? errorMessages.save) : null;

// `data` is a free-form JSON blob whose shape the contact form will decide, so
// render whatever keys are present. Non-primitives are stringified rather than
// dropped — on a screen whose whole purpose is "show me what the visitor sent",
// silently hiding a nested value is worse than showing it raw.
const entriesOf = (d: Record<string, unknown> | null) =>
    Object.entries(d ?? {})
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)] as const);

const when = (iso?: string) =>
    iso
        ? new Date(iso).toLocaleString("en-US", {
              month: "long", day: "numeric", year: "numeric",
              hour: "numeric", minute: "2-digit",
          })
        : "Date unknown";
---

<ChapterAdminLayout
    title={`Submissions | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="submissions"
>
    <h1 class="sub__title">Submissions</h1>

    {flash && <p class="sub__flash" role="status">{flash}</p>}
    {errorMessage && <p class="sub__error" role="alert">{errorMessage}</p>}
    {failed && <p class="sub__error" role="alert">Couldn't load submissions. Please refresh.</p>}

    {!failed && rows.length === 0 && (
        <div class="sub__empty">
            <p>No contact submissions yet.</p>
            <p class="sub__empty-note">
                Submissions appear here when someone uses the contact form on your
                chapter's microsite.
            </p>
        </div>
    )}

    {rows.length > 0 && (
        <ul class="sub__list">
            {rows.map((s) => (
                <li class:list={["sub__row", { "sub__row--handled": s.handled }]}>
                    <div class="sub__body">
                        <p class="sub__when">{when(s.submittedAt)}</p>
                        {entriesOf(s.data).length === 0 ? (
                            <p class="sub__nodetail">(no details recorded)</p>
                        ) : (
                            <dl class="sub__data">
                                {entriesOf(s.data).map(([k, v]) => (
                                    <>
                                        <dt>{k}</dt>
                                        <dd>{v}</dd>
                                    </>
                                ))}
                            </dl>
                        )}
                    </div>

                    <form method="post" action="/api/chapter-admin/submission" class="sub__form">
                        <input type="hidden" name="chapterSlug" value={chapter.slug} />
                        <input type="hidden" name="documentId" value={s.documentId} />
                        {/*
                          The form posts the state it WANTS. Present => set
                          handled; absent => clear it. So the hidden field is
                          rendered only for rows that are currently unhandled,
                          and one button toggles both directions with no JS.
                        */}
                        {!s.handled && <input type="hidden" name="handled" value="1" />}
                        <button
                            type="submit"
                            class="sub__toggle"
                            aria-label={`${s.handled ? "Mark unhandled" : "Mark handled"}: submission from ${when(s.submittedAt)}`}
                        >
                            {s.handled ? "Mark unhandled" : "Mark handled"}
                        </button>
                    </form>
                </li>
            ))}
        </ul>
    )}
</ChapterAdminLayout>

<style>
    .sub__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    .sub__flash, .sub__error {
        margin: 0 0 var(--space-600); padding: var(--space-300) var(--space-400);
        border-radius: var(--radius-100); font-family: var(--font-family-body);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        background-color: var(--primitive-brand-50); color: var(--primitive-brand-700);
    }
    .sub__empty { font-family: var(--font-family-body); color: var(--primitive-neutral-700); }
    .sub__empty-note { font-size: 14px; color: var(--primitive-neutral-600); }
    .sub__list { margin: 0; padding: 0; list-style: none;
        display: flex; flex-direction: column; gap: var(--space-400); }
    .sub__row { display: flex; align-items: flex-start; justify-content: space-between;
        gap: var(--space-600); padding: var(--space-400);
        background-color: var(--primitive-neutral-100); border-radius: var(--radius-100); }
    .sub__row--handled { opacity: 0.6; }
    .sub__body { min-width: 0; }
    .sub__when { margin: 0 0 var(--space-200); font-family: var(--font-family-body);
        font-size: 13px; color: var(--primitive-neutral-500); }
    .sub__nodetail { margin: 0; font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-600); }
    .sub__data { margin: 0; font-family: var(--font-family-body); font-size: 15px;
        display: grid; grid-template-columns: auto 1fr; gap: var(--space-100) var(--space-400); }
    .sub__data dt { font-weight: 700; color: var(--primitive-neutral-700); text-transform: capitalize; }
    .sub__data dd { margin: 0; color: var(--primitive-neutral-900);
        overflow-wrap: anywhere; white-space: pre-wrap; }
    .sub__toggle {
        background: none; border: var(--stroke-border) solid var(--primitive-neutral-300);
        border-radius: var(--radius-100); padding: var(--space-200) var(--space-300);
        cursor: pointer; white-space: nowrap;
        font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-700);
    }
    .sub__toggle:hover, .sub__toggle:focus-visible {
        color: var(--primitive-brand-500); border-color: var(--primitive-brand-300);
    }
    @media (max-width: 768px) {
        .sub__title { font-size: 36px; }
        .sub__row { flex-direction: column; }
    }
</style>
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add "src/pages/account/chapter/[chapterSlug]/settings.astro" \
          "src/pages/account/chapter/[chapterSlug]/submissions.astro" && \
  git commit -m "feat: chapter settings and submissions pages"
```

Expected: **0 errors.**

---

## Chunk 7: Verification

### Task 20: Prove it end to end

- [ ] **Step 1: Both suites**

```bash
pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test && npm run check
```

Expected: **120 CMS**, **47 frontend**, 0 typecheck errors.

- [ ] **Step 2: Seed one submission, since nothing writes them**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node -e "
const { createStrapi, compileStrapi } = require('@strapi/strapi');
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';
  const ch = await app.documents('api::chapter.chapter').findFirst({ filters: { slug: 'aloha-hawaii' }, status: 'draft' });
  await app.documents('api::form-submission.form-submission').create({
    data: { chapter: { documentId: ch.documentId },
            data: { name: 'Dana Visitor', email: 'dana@example.test', message: 'How do I join?' },
            submittedAt: new Date().toISOString(), handled: false },
  });
  console.log('seeded one submission for', ch.slug);
  await app.destroy(); process.exit(0);
})();
"
```

- [ ] **Step 3: Start both servers**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop &
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run dev &
```

Note the port Astro reports — it takes the next free one if 4321 is busy.

- [ ] **Step 4: Walk the path**

Sign in as `chapadmin@areaa.test` / `Password123!`.

| # | Action | Expected |
|---|---|---|
| 1 | Open the chapter, check the sidebar | Overview, Events, News, Committees, Submissions, Settings |
| 2 | Committees → Add Committee → name + check two members → Create | "Committee created."; the row lists both names |
| 3 | Open it, **uncheck everyone**, Save | **0 members.** This is the presence marker working; without it the removal silently does nothing |
| 4 | Re-open, check one member, Save | 1 member — replace, not append |
| 5 | Re-open, change only the **name**, Save | Membership unchanged. Absent ≠ cleared |
| 6 | Submit a committee with no name | "Give the committee a name." |
| 7 | **Delete this committee** | Back at the list, "Committee deleted.", gone |
| 8 | News → Add Article → title only, no body | "Write the article body." |
| 9 | Add a body, Publish | Back at the list; slug shown as `/news/aloha-hawaii-…` |
| 10 | Set Published Date to today's date, Save, reload the list | **The date shown matches what you typed** — not the day before |
| 11 | Open it and check the byline in Strapi admin | Author is **chapadmin**, whatever the form was told |
| 12 | Attach an image, Save | Reopens showing "Current image: view" |
| 13 | Edit only the title and Save | Succeeds — the body is not required on a partial update |
| 14 | **Delete this article** | "Article deleted.", gone |
| 15 | Settings → change the contact email, Save | "Settings saved."; persists on reload |
| 16 | Settings → confirm the web address | Read-only with the explanation, no input |
| 17 | Submissions | The seeded one, with its fields and Mark handled |
| 18 | Mark handled, then unhandled | Row dims and undims; state persists on reload |
| 19 | **Disable JavaScript entirely and repeat 2–5** | Everything still works, including the picker |

- [ ] **Step 5: Confirm the public site reflects it**

Create an article, then visit the chapter microsite. A published news item must be publicly readable — CA11 again, and the thing most likely to be silently wrong.

- [ ] **Step 6: Try the attacks by hand**

Get a token and a foreign member id first — v1 said "substitute a real JWT" and stopped, which is a dead end:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
JWT=$(curl -s -X POST http://localhost:1337/api/auth/local -H "Content-Type: application/json" \
  -d '{"identifier":"chapadmin@areaa.test","password":"Password123!"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['jwt'])") && \
FOREIGN=$(sqlite3 .tmp/data.db "SELECT u.document_id FROM up_users u \
  JOIN up_users_chapter_lnk l ON l.user_id = u.id \
  JOIN chapters c ON c.id = l.chapter_id \
  WHERE c.slug != 'aloha-hawaii' LIMIT 1;") && \
echo "foreign member: $FOREIGN" && \
echo "--- foreign member on a committee (expect 403) ---" && \
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:1337/api/chapter-admin/committees \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"name\":\"Attack\",\"chapterSlug\":\"aloha-hawaii\",\"members\":[\"$FOREIGN\"]}" && \
echo "--- malformed members (expect 400) ---" && \
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:1337/api/chapter-admin/committees \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"Attack2","chapterSlug":"aloha-hawaii","members":"nope"}' && \
echo "--- another chapter's roster (expect 403) ---" && \
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $JWT" \
  "http://localhost:1337/api/chapter-admin/members?chapterSlug=boston"
```

Expected: `403`, `400`, `403`. **A 200 on the first means any chapter admin can put any member of any chapter on their committee.**

- [ ] **Step 7: Stop the servers and confirm both trees are clean**

Leaving `strapi develop` running violates precondition 3 for whoever runs tests next.

```bash
pkill -f "strapi develop" ; pkill -f "astro dev" ; sleep 2
cd /Users/nk/Projects/AREAA/areaa-frontend && git status --short
cd /Users/nk/Projects/AREAA/areaa-cms && git status --short
```

Expected: clean in both, no processes left.

---

### Task 21: File the public-site contact-form bug

The opening section notes that `ContactForm.astro` tells visitors "your message is on its way" while sending nothing. That is a live bug on the public site, unrelated to chapter admin, and a prose note dies when this plan is closed.

- [ ] **Step 1: Record it where it will outlive this plan**

Create `docs/2026-08-04-contact-form-sends-nothing.md`:

```markdown
# Contact form reports success without sending anything

**Severity:** live on the public site.

`src/components/ContactForm.astro` (areaa-frontend) intercepts submit, calls
`preventDefault()`, hides the form and shows "Thank you — your message is on its
way." Nothing is posted anywhere. `form_submissions` holds 0 rows and
`scripts/seed.js` creates none.

Every contact enquiry made through the site since launch has been silently
discarded, and the visitor was told otherwise.

**Two ways out, in order of preference:**

1. Wire capture — a validated public endpoint writing `api::form-submission`,
   with spam handling, rate limiting and chapter/page association. The chapter
   admin screen built in plan 3 then has data to show.
2. If that is not happening soon, change the copy so it stops claiming the
   message was sent, and point people at a real email address.

**Not** a chapter-admin problem: plan 3 deliberately did not widen scope to fix
it, because a public write endpoint is its own subsystem.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add docs/2026-08-04-contact-form-sends-nothing.md && \
  git commit -m "docs: file the contact form reporting false success"
```

---

## Done when

- **120 CMS tests and 47 frontend tests green**, CMS twice in a row with **no row-count growth** (committees, news_items, form_submissions and **up_users** all unchanged).
- A chapter admin can create, edit and delete committees, and change who sits on them — **including unchecking everyone** — with JavaScript disabled.
- A committee write naming a member of another chapter returns **403 "do not belong"**; a malformed `members` payload returns **400**, not 500.
- Editing only a committee's name leaves its membership untouched.
- News publishes with a chapter-prefixed slug and the **author forced to the session user**; a missing body is 400 on create, and an update may omit the body but not blank it.
- A published date renders as the day that was typed, in any timezone.
- Chapter name and email save; the slug is read-only and unchangeable through the API.
- Submissions list scoped to **the chapter in the URL**, and toggle handled both ways.
- Every failed write renders a message. No `?error=` code is emitted that its destination page cannot display.
- `tests/unit/grants.test.js` passes, and fails when any grant string is misspelled.

## Not in this plan

- **`/page`** — the fixed-template microsite editor and its dynamic-zone positional merge. Plan 4; reuses the picker built here.
- **`/partners`** — attach/detach. Plan 4.
- **TipTap and the real blocks converters.** Plan 5.
- **Wiring the contact form to capture submissions.** Filed as its own document in Task 21.
- **A `checkbox` type on `FormField`.** The spec's frontend table lists one for `submission.handled`; this plan uses a per-row submit button instead, because a checkbox would need its own submit button anyway to work without JS. Deliberate substitution, recorded here so the spec item is not simply lost.

## Known limitations, accepted

- **`getCommittee` and `getNewsItem` fetch a page and find one in the list**, inheriting `getEvent`'s shape, because there is no single-record route. `listCommittees` also hardcodes `pageSize=100` and the committees index has **no pagination UI**, so both the list and the edit lookup silently truncate at 100. Adding `GET /chapter-admin/<resource>/:documentId` retires all three and is the right first task of plan 4.
- **`listSubmissions` hardcodes `limit: 200`** with no pagination, while every factory list paginates. Invisible today at 0 rows, which is exactly when it should be written down.
- **`src/lib/chapter-admin.ts` reaches ~270 lines** holding transport, error shaping and six resource clients. Still a flat list of small functions, so it stays scannable — but plan 4 adds two more resources and the `GET /:documentId` retrofit touches every getter. That is the moment to become `src/lib/chapter-admin/` with `client.ts` plus one module per resource and an `index.ts` re-export, keeping every import site unchanged.
- **The controller holds four factory configs plus hand-written logic for three resources.** `services/chapter-settings.js` and `services/submissions.js` alongside `services/members.js` would follow the plan's own "split by responsibility" rule; deferred to keep this plan's diff reviewable.
- **Committee membership is not re-validated on read.** If national moves a member to another chapter, that member stays on the committee until someone re-saves it.
- **The member picker lists every member with no search.** Fine at current chapter sizes; a chapter with several hundred members will want filtering.
- **No CSRF token.** Astro's native `checkOrigin` covers these POSTs, the same as every other form on the site.
- **`publishedDate` is a free-text field** rather than a date picker, because `FormField` has no `date` type. A malformed value is rejected by Strapi with a generic message.
