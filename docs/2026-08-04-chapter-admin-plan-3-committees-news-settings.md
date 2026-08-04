# Chapter Admin — Plan 3: Committees, News, Settings and Submissions

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chapter admin manages their chapter's committees — including who sits on them — plus news items, chapter settings, and inbound contact submissions, in a browser, with no client JS.

**Architecture:** Four more resources against the two spines already proven. The backend reuses `chapterScopedResource` from plan 1, extended with three hooks it turns out to need; `/members`, `/chapter` and `/submissions` are bespoke handlers calling the same `assertChapterScope`. The frontend reuses plan 2's Astro-route-plus-form pattern, adding one genuinely new component — the multi-select picker, built with `<select multiple>` so it works without JavaScript.

**Tech Stack:** Strapi 5.45.1, Node 24, CommonJS, Astro 6.4, TypeScript strict, Vitest 3.

**Spec:** [`2026-08-03-chapter-admin-authoring-design.md`](./2026-08-03-chapter-admin-authoring-design.md).
**Predecessors:** [plan 1](./2026-08-03-chapter-admin-plan-1-authorization-spine.md) (59 tests green) and [plan 2](./2026-08-03-chapter-admin-plan-2-events-authoring-ui.md) (24 frontend tests green) — both complete.

---

## Scope

Four resources, backend and screens together: **committees**, **news**, **chapter settings**, **submissions**.

Committees is first because it is the most valuable and the most expensive. It needs two things nothing else has yet:

- **`GET /chapter-admin/members`**, so the form can offer the chapter's members as candidates.
- **The multi-select picker**, which the spec calls out as carrying more UI surface than anything else in the design. Built once here, reused four more times in plan 4.

That ordering is deliberate: build the picker against the one screen that needs it least ambiguously, then reuse it.

**Deferred to plan 4:** `/page` (the fixed-template microsite editor) and `/partners`. Both depend on the picker this plan builds, and `/page`'s dynamic-zone positional merge is the single riskiest piece in the design — it deserves its own plan, not the tail end of this one.

**Deferred to plan 5:** TipTap and the real blocks converters. `news-item.body` uses plan 2's `textToBlocks` placeholder, same as `event.description`.

---

## Read this first: submissions has no capture path

**`/submissions` is specified as read-only administration of data that nothing currently writes.**

- `form_submissions` holds **0 rows**.
- `scripts/seed.js` creates none.
- `src/components/ContactForm.astro:45-46` is presentational only. Its own comment says so: *"Presentational submit: no backend wired yet, so show a success state in place of the form. (When ready, POST to /api/form-submissions here.)"* It calls `event.preventDefault()`, hides the form, and shows **"Thank you — your message is on its way."**

So the public site currently tells visitors their message was sent when nothing was sent, and the screen this plan builds will be permanently empty until that changes.

**This plan builds the admin side exactly as the spec defines it (GET + mark handled) and does not wire the capture path.** That is a deliberate refusal to widen scope: a public write endpoint brings spam handling, rate limiting, a Public-role grant, and chapter/page association — a separate subsystem the design document never scoped, and not one to design as a side effect of an authoring plan.

Two consequences to accept before starting:

1. Task 17's verification seeds a submission directly through the document service, because there is no other way to produce one.
2. **The "message is on its way" lie is a live bug on the public site, unrelated to chapter admin.** It should be tracked separately — either wire the capture path or change the copy.

If you would rather this plan include capture, stop and say so; it is roughly three extra tasks and one design decision (how to keep the endpoint from being a spam sink).

---

## Preconditions

**1. Node 24 for anything touching the CMS repo.** `better-sqlite3` is built for module version 137.

```bash
node --version    # v24.x, or use PATH="/opt/homebrew/bin:$PATH"
```

**2. Two repos.** Every command block states its own `cd`; agent shells reset cwd between calls.

| Repo | Path |
|---|---|
| CMS | `/Users/nk/Projects/AREAA/areaa-cms` |
| Frontend | `/Users/nk/Projects/AREAA/areaa-frontend` |

**3. The CMS dev server must be STOPPED for tests and boots, RUNNING for browser verification.** Both it and the test suite open the same SQLite file.

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

Checked against the installed Strapi 5.45.1 by executing the calls. Do not re-litigate; do re-check if the Strapi version changes.

| Assumption | Verdict |
|---|---|
| `committee` has **no `slug`** field | ✅ Attributes are `name`, `description`, `members`, `chapter`. Factory takes `hasSlug: false` |
| `committee.description` is `text`, not `blocks` | ✅ Plain textarea, no converter needed — unlike news |
| `committee.members` accepts `[{ documentId }]` longhand on create | ✅ Wrote 2, read back 2 |
| Updating `members` **replaces** rather than appends | ✅ Set 2 → updated to 1 → read back 1. This is what a picker needs |
| `members` can be cleared with `[]` | ✅ Read back 0. "Remove everyone" is expressible |
| `news-item.body` is `required: true` and **enforced** on create | ✅ Throws ``body must be a `array` type, but the final value was: `null` ``. Must be validated to a 400, not a 500 |
| `form-submission` is `draftAndPublish: false` | ✅ Per schema |
| `status: 'published'` on a non-D&P type is accepted and ignored | ✅ Created a form-submission with the flag; no error. CA11's warning is about clarity, not a crash |
| `chapter` has `name`, `email`, and a `uid` `slug` | ✅ Per schema. `slug` and `administrators` stay out of the whitelist |
| `GET /api/users/directory` returns **no identifier** | ✅ `DirectoryMember` is display-only, so the picker cannot reuse it — `/members` must return `documentId` |
| Plan 2's `listPopulate` hook exists on the factory | ✅ Added in plan 2 for `figure` |

### One assumption deliberately NOT relied upon

Plan 1's known-limitations note says to add `strapi.contentAPI.sanitize.output` when the factory is reused for `/members`. **This plan does not do that**, for two reasons:

1. `sanitize.output` filters against what the caller's role may read, and the Chapter Admin role holds no `find` grant for any content type. Two comments in `src/extensions/users-permissions/strapi-server.js` document this behaviour biting already — `readSelf` has to re-attach `chapter` "because the Authenticated role has no chapter read-grant." Applying it to the factory risks silently stripping `chapter` from every list row, which the events UI reads.
2. The codebase already has a proven pattern for exactly this problem: `plugin.controllers.user.directory` **hand-builds** its response from a field whitelist, "regardless of schema field privacy, so it can't leak PII the way a raw `GET /api/users` can."

`/members` therefore hand-builds its rows (Task 2). This is strictly safer than sanitization — it is a whitelist, not a filter — and it sidesteps the grant question entirely. An attempt to verify the sanitizer's behaviour under chapter-admin auth was inconclusive; rather than build on an unverified claim, the design avoids needing it.

---

## The API contract, as built

What plans 1 and 2 leave you. All routes require the `Chapter Admin` role; scope is enforced per-request.

| Route | Methods | Notes |
|---|---|---|
| `/api/chapter-admin/events` | GET POST PUT DELETE | Factory-generated |
| `/api/chapter-admin/media` | POST | Field name `files`, one file, magic-byte sniffed |

Facts that shape this plan:

- **Create identifies the chapter by `chapterSlug`; update ignores it** and reads the owning chapter from the stored record.
- **`slug` and `chapter` are never editable.** The factory throws at load if either appears in a whitelist.
- **Every write to a draft-and-publish type passes `status: 'published'`** (CA11), or it is written and invisible.
- **Scope is keyed on `documentId`, never the numeric entry id.**
- Errors: `403` out of scope, `400` validation, `404` missing.

---

## File structure

**CMS — create:**

| Path | Responsibility |
|---|---|
| `src/api/chapter-admin/services/members.js` | Pure `toDirectoryRow` + `assertMembersInChapter` |
| `tests/unit/members.test.js` | Row shaping and the membership check |
| `tests/integration/committees.test.js` | Committee CRUD + the cross-chapter member attack |
| `tests/integration/resources.test.js` | News, chapter settings, submissions |

**CMS — modify:** `src/api/chapter-admin/services/resource-factory.js` (three hooks), `src/api/chapter-admin/controllers/chapter-admin.js`, `src/api/chapter-admin/routes/chapter-admin.js`, `src/index.js` (grants).

**Frontend — create:**

| Path | Responsibility |
|---|---|
| `src/components/MultiSelect.astro` | The picker. `<select multiple>`, no client JS |
| `src/components/CommitteeForm.astro` | Create + edit committee |
| `src/components/NewsForm.astro` | Create + edit news item |
| `src/lib/committee-form.ts` | Pure FormData → committee payload |
| `src/lib/news-form.ts` | Pure FormData → news payload |
| `tests/unit/committee-form.test.ts` | Payload mapping, incl. the empty-members case |
| `tests/unit/news-form.test.ts` | Payload mapping, incl. required body |
| `src/pages/api/chapter-admin/committee.ts` | Form POST → save or delete |
| `src/pages/api/chapter-admin/news.ts` | Form POST → save or delete |
| `src/pages/api/chapter-admin/settings.ts` | Form POST → save chapter |
| `src/pages/api/chapter-admin/submission.ts` | Form POST → toggle handled |
| `src/pages/account/chapter/[chapterSlug]/committees/index.astro` | List |
| `src/pages/account/chapter/[chapterSlug]/committees/new.astro` | Create |
| `src/pages/account/chapter/[chapterSlug]/committees/[documentId].astro` | Edit |
| `src/pages/account/chapter/[chapterSlug]/news/index.astro` | List |
| `src/pages/account/chapter/[chapterSlug]/news/new.astro` | Create |
| `src/pages/account/chapter/[chapterSlug]/news/[documentId].astro` | Edit |
| `src/pages/account/chapter/[chapterSlug]/settings.astro` | Chapter name + email |
| `src/pages/account/chapter/[chapterSlug]/submissions.astro` | Read + mark handled |

**Frontend — modify:** `src/lib/chapter-admin.ts` (client calls), `src/layouts/ChapterAdminLayout.astro` (nav).

**Why one form component per resource** rather than a generic one: committees and news share almost no fields, and a component that branches on resource type would be harder to read than two that do not. `EventForm.astro` already established the shape; these follow it.

---

## Chunk 1: Members and the factory hooks

### Task 1: Extend the factory with the three hooks the new resources need

The factory currently supports `editableFields`, `hasSlug`, `listFields` and `listPopulate`. Three resources need more:

- **News** must force `author` to the session user (the spec: *"An admin cannot publish under another member's byline"*) — a derived field.
- **News** must reject a missing `body` with 400, because Strapi throws on it — a required-field check.
- **Committees** must reject members who do not belong to the chapter — an async validation hook.

**Files:** Modify `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Add the options to the signature and document them**

Replace the JSDoc block and the destructure:

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
 *                                  returned unless named here.
 * @param {string[]} requiredFields fields that must be present and non-empty on
 *                                  CREATE. Strapi throws a 500 on a missing
 *                                  required attribute; this turns that into a
 *                                  400 the form can render.
 * @param {Function} deriveOnCreate (ctx) => object, merged into the create
 *                                  payload AFTER the whitelist. This is how a
 *                                  server-owned field like `news.author` is set
 *                                  without ever being client-writable.
 * @param {Function} validateData   async (data, { ctx, chapterDocumentId, strapi })
 *                                  => void. Throws ScopeError or SlugError to
 *                                  reject. Runs on create AND update.
 *                                  NOTE: it may also NORMALISE `data` in place —
 *                                  the committee hook rewrites `members` to the
 *                                  longhand relation form once it has checked
 *                                  them. That makes it a validate-and-coerce
 *                                  step, not a pure predicate; keep the two
 *                                  concerns adjacent rather than walking the
 *                                  same array twice.
 * @param {object}   strapiInstance injected for testability
 */
function chapterScopedResource({
  uid, editableFields, hasSlug = false, listFields = null, listPopulate = null,
  requiredFields = [], deriveOnCreate = null, validateData = null,
  strapiInstance = null,
}) {
```

- [ ] **Step 2: Add a shared required-field check**

Add above the `return {`:

```js
  /**
   * Strapi throws on a missing required attribute, which surfaces as a 500.
   * Catch it first so the form gets a 400 and a sentence it can show.
   */
  function missingRequired(data) {
    for (const field of requiredFields) {
      const value = data[field];
      const empty =
        value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0);
      if (empty) return field;
    }
    return null;
  }
```

- [ ] **Step 3: Wire all three into `create`**

In `create`, replace everything from `const data = pickWhitelisted(...)` down to the `ctx.body =` line with:

```js
      const data = pickWhitelisted(input, editableFields);
      // Longhand relation form: mapRelation's isNumeric() uses parseInt, so a
      // documentId beginning with a digit could be misread as an entry id.
      data.chapter = { documentId: chapter.documentId };

      // Derived AFTER the whitelist, so a client-supplied value cannot win.
      if (deriveOnCreate) Object.assign(data, deriveOnCreate(ctx));

      const missing = missingRequired(data);
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
      // API writes a DRAFT unless told otherwise. Without this the save succeeds
      // and is invisible on the live site.
      ctx.body = { data: await docs().create({ data, status: 'published' }) };
```

- [ ] **Step 4: Wire validation into `update`**

In `update`, after `const data = pickWhitelisted(input, editableFields);` add:

```js
      // Note: no requiredFields check on update. A partial payload legitimately
      // omits fields, and pickWhitelisted leaves absent keys untouched rather
      // than blanking them — so "absent" here means "unchanged", not "cleared".
      if (validateData) {
        await validateData(data, { ctx, chapterDocumentId, strapi: s() });
      }
```

- [ ] **Step 5: Confirm the existing suite still passes**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **59 passed**. All three hooks default to off, so events must be untouched. A failure here means the refactor changed existing behaviour.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/resource-factory.js && \
  git commit -m "feat: required-field, derived-field and validation hooks on the resource factory"
```

---

### Task 2: The members service

Two pure functions. `toDirectoryRow` decides what a chapter admin may see about a member; `assertMembersInChapter` is a security check, not a convenience — without it a chapter admin can attach **any user in the system** to their committee.

**Files:** Create `src/api/chapter-admin/services/members.js`, `tests/unit/members.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { toDirectoryRow, assertMembersInChapter, MEMBER_FIELDS }
  from '../../src/api/chapter-admin/services/members.js';
import { ScopeError } from '../../src/api/chapter-admin/services/scope.js';

describe('toDirectoryRow', () => {
  it('returns an identifier the picker can submit', () => {
    const row = toDirectoryRow({
      id: 7, documentId: 'usr-1', firstName: 'Mei', lastName: 'Tanaka',
      displayName: '', title: 'Broker',
    });
    expect(row.documentId).toBe('usr-1');
  });

  it('falls back to first + last when displayName is empty', () => {
    expect(toDirectoryRow({ documentId: 'u', firstName: 'Mei', lastName: 'Tanaka' }).displayName)
      .toBe('Mei Tanaka');
  });

  it('prefers an explicit displayName', () => {
    expect(toDirectoryRow({ documentId: 'u', firstName: 'Mei', lastName: 'Tanaka', displayName: 'M. Tanaka' }).displayName)
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

describe('assertMembersInChapter', () => {
  const chapterMembers = [{ documentId: 'm1' }, { documentId: 'm2' }];
  const strapi = {
    documents: () => ({ findMany: async () => chapterMembers }),
  };

  it('accepts members of the chapter', async () => {
    await expect(assertMembersInChapter(strapi, 'chap-a', ['m1', 'm2'])).resolves.toBe(true);
  });

  it('accepts an empty selection — removing everyone is legal', async () => {
    await expect(assertMembersInChapter(strapi, 'chap-a', [])).resolves.toBe(true);
  });

  it("rejects a user who is not in the chapter", async () => {
    // The attack: a chapter admin attaching an arbitrary user to their own
    // committee, which would publish that person on their microsite.
    await expect(assertMembersInChapter(strapi, 'chap-a', ['m1', 'outsider']))
      .rejects.toThrow(ScopeError);
  });

  it('rejects duplicates of an outsider even when a valid member is present', async () => {
    await expect(assertMembersInChapter(strapi, 'chap-a', ['outsider', 'outsider']))
      .rejects.toThrow(ScopeError);
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

/**
 * Exactly what a chapter admin may see about one of their members.
 *
 * Hand-built rather than sanitized, following the pattern already established
 * by `plugin.controllers.user.directory`: a whitelist cannot leak a field
 * somebody later forgets to mark `private`, and it does not depend on the
 * caller's role holding a read grant. `documentId` is included — unlike the
 * public directory row — because the picker has to submit something.
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
 * Every submitted member must actually belong to the chapter.
 *
 * This is a security boundary, not validation for the user's benefit. Without
 * it `PUT /committees/:id` with an arbitrary user documentId would attach any
 * member of any chapter — or a national board member — to a committee, and the
 * public microsite would then display them as part of that chapter.
 */
async function assertMembersInChapter(strapiInstance, chapterDocumentId, memberDocumentIds) {
  const wanted = [...new Set(memberDocumentIds ?? [])];
  if (wanted.length === 0) return true;

  const rows = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findMany({
      filters: {
        documentId: { $in: wanted },
        chapter: { documentId: chapterDocumentId },
      },
      // `fields` always unions `id` and `documentId` regardless of what is
      // asked for (verified in plan 1), so documentId comes back here even
      // though it is not listed. Do not "fix" this by adding it.
      fields: ['id'],
      limit: -1,
    });

  const found = new Set(rows.map((r) => r.documentId));
  const stranger = wanted.find((id) => !found.has(id));
  if (stranger) {
    throw new ScopeError('One or more selected members do not belong to this chapter');
  }
  return true;
}

module.exports = { toDirectoryRow, assertMembersInChapter, MEMBER_FIELDS };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/members.test.js
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/members.js tests/unit/members.test.js && \
  git commit -m "feat: chapter member row shaping and membership assertion"
```

---

### Task 3: Wire the members, committees, news, chapter and submissions routes

All five at once, because they share one controller file and one routes table; splitting them would mean five edits to the same two files.

**Files:** Modify `src/api/chapter-admin/controllers/chapter-admin.js`, `src/api/chapter-admin/routes/chapter-admin.js`

- [ ] **Step 1: Add the requires and the resource definitions**

At the top of the controller, after the existing requires:

```js
const { toDirectoryRow, assertMembersInChapter } = require('../services/members');
const { resolveAdministeredChapters, assertChapterScope } = require('../services/scope');
```

Then, after the `events` definition:

```js
// Committees. No slug field on this type, so hasSlug stays false. `members` is
// writable but every id is checked against the chapter's own membership first.
const committees = chapterScopedResource({
  uid: 'api::committee.committee',
  editableFields: ['name', 'description', 'members'],
  listPopulate: { members: { fields: ['firstName', 'lastName', 'displayName', 'title'] } },
  requiredFields: ['name'],
  async validateData(data, { chapterDocumentId, strapi }) {
    if (!('members' in data)) return;
    // Accept either ['id'] or [{documentId}] so the handler is not coupled to
    // exactly how the form serialised it.
    const ids = (data.members ?? []).map((m) => (typeof m === 'string' ? m : m?.documentId));
    await assertMembersInChapter(strapi, chapterDocumentId, ids);
    data.members = ids.map((documentId) => ({ documentId }));
  },
});

// News. `author` is server-set from the session so an admin cannot publish
// under another member's byline. `body` is required:true in the schema and
// Strapi throws on it, so it is declared here to get a 400 instead of a 500.
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

- [ ] **Step 2: Add the three bespoke handlers**

Inside `module.exports`, after `deleteEvent`:

```js
  // --- members -----------------------------------------------------------
  // Read-only. Feeds the committee picker; plan 4 reuses it for the
  // member-group slots. Hand-built rows — see services/members.js.
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
      filters: { chapter: { documentId: chapter.documentId }, blocked: { $ne: true } },
      fields: ['firstName', 'lastName', 'displayName', 'title'],
      sort: ['lastName:asc', 'firstName:asc'],
      limit: -1,
    });

    ctx.body = { data: rows.map(toDirectoryRow) };
  }),

  // --- chapter settings --------------------------------------------------
  // `name` and `email` only. `slug` is excluded because it is a uid that will
  // not regenerate and already-written event slug prefixes would not follow it;
  // `administrators` is excluded so the role cannot self-propagate.
  getChapter: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    const chapterSlug = String(ctx.query.chapterSlug ?? '');
    if (!chapterSlug) return ctx.badRequest('chapterSlug is required');

    const chapter = await strapi.documents('api::chapter.chapter').findFirst({
      filters: { slug: chapterSlug }, fields: ['name', 'slug', 'email'], status: 'draft',
    });
    if (!chapter) return ctx.notFound('No such chapter');
    assertChapterScope(administered, chapter.documentId);

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

    const data = pickWhitelisted(input, ['name', 'email']);
    if (data.name === '') return ctx.badRequest('name is required');

    ctx.body = { data: await strapi.documents('api::chapter.chapter').update({
      documentId: chapter.documentId, data, status: 'published',
    }) };
  }),

  // --- submissions -------------------------------------------------------
  // form-submission is draftAndPublish:FALSE, so no status flag anywhere here.
  // (Passing one is harmless — verified — but stating it would imply the type
  // has a draft, which it does not.)
  listSubmissions: guarded(async (ctx) => {
    const administered = await resolveAdministeredChapters(ctx);
    if (administered.length === 0) return ctx.forbidden('No administered chapters');

    const rows = await strapi.documents('api::form-submission.form-submission').findMany({
      filters: { chapter: { documentId: { $in: administered } } },
      populate: { chapter: { fields: ['name', 'slug'] } },
      sort: ['submittedAt:desc'],
      limit: 200,
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

Also add `const { pickWhitelisted } = require('../services/fields');` to the requires, and export the committee/news handler sets:

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

- [ ] **Step 3: Add the routes**

Append to the `routes` array:

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

- [ ] **Step 4: Grant the new actions**

In `src/index.js`, extend `CHAPTER_ADMIN_GRANTS` with the thirteen new actions:

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

- [ ] **Step 5: Boot and confirm all eighteen actions are granted**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: `18` — the five from plan 1 plus these thirteen. A lower number means a controller method name and its grant string disagree; compare the two lists.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ src/index.js && \
  git commit -m "feat: members, committees, news, chapter and submissions routes"
```

---

## Chunk 2: Backend proof

### Task 4: Integration-test committees and the member attack

The membership check is the one genuinely new security boundary in this plan, so it gets a dedicated file and an explicit attack case.

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

  // One member in each chapter, so the cross-chapter case is real.
  const mk = async (chapter, tag) => strapi.plugin('users-permissions').service('user').add({
    username: `cm-${tag}-${RUN}@areaa.test`, email: `cm-${tag}-${RUN}@areaa.test`,
    password: 'Password123!', confirmed: true, provider: 'local',
    firstName: 'Cmte', lastName: tag, chapter: chapter.id,
  });
  memberA = await mk(chapterA, 'Ay');
  memberB = await mk(chapterB, 'Bee');
});

afterAll(async () => {
  const junk = await strapi.documents('api::committee.committee').findMany({
    filters: { name: { $contains: String(RUN) } }, fields: ['name'], limit: -1, status: 'draft',
  });
  for (const c of junk) {
    await strapi.documents('api::committee.committee').delete({ documentId: c.documentId });
  }
  await shutdown();
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const name = (n) => `${n} ${RUN}`;

describe('GET /api/chapter-admin/members', () => {
  it('lists the chapter\'s members with an identifier the picker can submit', async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    const row = res.body.data.find((m) => m.displayName.includes('Ay'));
    expect(row.documentId).toEqual(expect.any(String));
  });

  it('leaks no contact or entitlement PII', async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterA.slug}`));
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
  it('creates a committee with members and publishes it', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Events Cmte'), chapterSlug: chapterA.slug,
              description: 'Runs events', members: [memberA.documentId] });

    expect(res.status).toBe(200);
    const published = await strapi.documents('api::committee.committee')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('400s on a missing name rather than 500ing', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ chapterSlug: chapterA.slug, description: 'Nameless' });
    expect(res.status).toBe(400);
  });

  it("REFUSES a member from another chapter", async () => {
    // The attack this check exists to stop: attaching an arbitrary user to
    // your own committee, which publishes them on your microsite.
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Trespass'), chapterSlug: chapterA.slug, members: [memberB.documentId] });

    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/do not belong/i);
  });
});

describe('PUT /api/chapter-admin/committees/:documentId', () => {
  it('replaces the member list rather than appending', async () => {
    const created = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Replaceable'), chapterSlug: chapterA.slug, members: [memberA.documentId] });

    await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [] });

    const after = await strapi.documents('api::committee.committee').findOne({
      documentId: created.body.data.documentId, populate: { members: true }, status: 'draft',
    });
    expect(after.members).toHaveLength(0);
  });

  it('refuses a foreign member on update too', async () => {
    const created = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Guarded'), chapterSlug: chapterA.slug });

    const res = await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [memberB.documentId] });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/committees.test.js
```

Expected: PASS, 8 tests. **The two 403 cases are the ones that matter** — a 200 on either means any chapter admin can attach any member in the system to their committee.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/committees.test.js && \
  git commit -m "test: committee CRUD and the cross-chapter member attack"
```

---

### Task 5: Integration-test news, settings and submissions

**Files:** Create `tests/integration/resources.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
const BODY = [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }];
let strapi, chapterA, chapterB, tokenA, adminA;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  adminA = await makeChapterAdmin(strapi, {
    email: `res-admin-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, adminA.id);
});

afterAll(async () => {
  const junk = await strapi.documents('api::news-item.news-item').findMany({
    filters: { title: { $contains: String(RUN) } }, fields: ['title'], limit: -1, status: 'draft',
  });
  for (const n of junk) {
    await strapi.documents('api::news-item.news-item').delete({ documentId: n.documentId });
  }
  const subs = await strapi.documents('api::form-submission.form-submission').findMany({
    filters: { data: { $notNull: true } }, limit: -1,
  });
  for (const sVal of subs.filter((x) => x.data?.run === RUN)) {
    await strapi.documents('api::form-submission.form-submission').delete({ documentId: sVal.documentId });
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

  it('400s on a missing body rather than 500ing', async () => {
    // body is required:true and Strapi throws on it — without requiredFields
    // this is a 500 and the form shows nothing useful.
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Bodyless'), chapterSlug: chapterA.slug });
    expect(res.status).toBe(400);
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

  it("refuses another chapter's news", async () => {
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Trespass'), chapterSlug: chapterB.slug, body: BODY });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('chapter settings', () => {
  it('reads name and email but never administrators', async () => {
    const res = await auth(api().get(`/api/chapter-admin/chapter?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('administrators');
  });

  it('updates the name', async () => {
    const original = (await auth(api().get(`/api/chapter-admin/chapter?chapterSlug=${chapterA.slug}`))).body.data.name;
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: `${original} ` });
    expect(res.status).toBe(200);
    // Restore, so re-runs are idempotent.
    await auth(api().put('/api/chapter-admin/chapter')).send({ chapterSlug: chapterA.slug, name: original });
  });

  it('cannot change the slug, even when the payload says so', async () => {
    await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, slug: 'hijacked' });
    const after = await strapi.documents('api::chapter.chapter')
      .findOne({ documentId: chapterA.documentId, fields: ['slug'], status: 'draft' });
    expect(after.slug).toBe(chapterA.slug);
  });

  it("refuses another chapter", async () => {
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterB.slug, name: 'Nice try' });
    expect(res.status).toBe(403);
  });
});

describe('submissions', () => {
  /** Nothing writes submissions yet — see the plan's opening section. */
  const seedSubmission = async (chapter) =>
    strapi.documents('api::form-submission.form-submission').create({
      data: {
        chapter: { documentId: chapter.documentId },
        data: { name: 'Visitor', email: 'v@example.test', message: 'Hi', run: RUN },
        submittedAt: new Date(RUN).toISOString(),
        handled: false,
      },
    });

  it('lists only administered chapters', async () => {
    await seedSubmission(chapterA);
    await seedSubmission(chapterB);
    const res = await auth(api().get('/api/chapter-admin/submissions'));
    expect(res.status).toBe(200);
    expect(res.body.data.every((s) => s.chapter?.slug === chapterA.slug)).toBe(true);
  });

  it('marks one handled', async () => {
    const sub = await seedSubmission(chapterA);
    const res = await auth(api().put(`/api/chapter-admin/submissions/${sub.documentId}`))
      .send({ handled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.handled).toBe(true);
  });

  it("refuses another chapter's submission", async () => {
    const foreign = await seedSubmission(chapterB);
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

Expected: **PASS, 87 tests across 10 files** — 59 from plans 1–2, 9 unit from Task 2, 8 from Task 4, 11 here.

- [ ] **Step 3: Run it a second time without reseeding**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **87 again.** A failure means a fixture is not uniquified per run or a teardown is not deleting what it created — plan 2 had to fix exactly this after accumulated fixtures broke the public events page.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/resources.test.js && \
  git commit -m "test: news, chapter settings and submissions end to end"
```

---

## Chunk 3: The multi-select picker

### Task 6: `MultiSelect.astro`

The spec calls this out as carrying more of the design's UI surface than anything else. Built with `<select multiple>` because plan 2's no-client-JS constraint holds: a native multiple select posts repeated keys that `FormData.getAll()` reads, and it is keyboard- and screen-reader-accessible for free.

**Files:** Create `src/components/MultiSelect.astro`

- [ ] **Step 1: Write it**

```astro
---
// Multi-select picker. Used for committee members here; plan 4 reuses it for
// the member-group, upcoming-events and partner-group page slots.
//
// A native <select multiple> rather than a JS widget, because every other form
// in the chapter-admin area works without client JS and this one should too.
// It posts one repeated key per selection, which FormData.getAll(name) reads.
interface Option {
    value: string;
    label: string;
    hint?: string;
}

interface Props {
    label: string;
    name: string;
    options: Option[];
    /** Currently-selected values. */
    selected?: string[];
    helper?: string;
    /** Rows shown before scrolling. */
    size?: number;
    emptyMessage?: string;
}

const {
    label, name, options, selected = [], helper,
    size = 8, emptyMessage = "No options available.",
} = Astro.props;

const id = `field-${name}`;
const chosen = new Set(selected);
---

<div class="multi">
    <label class="multi__label" for={id}>{label}</label>

    {options.length === 0 ? (
        <p class="multi__empty">{emptyMessage}</p>
    ) : (
        <select
            id={id}
            name={name}
            class="multi__control"
            multiple
            size={Math.min(size, Math.max(options.length, 2))}
        >
            {options.map((o) => (
                <option value={o.value} selected={chosen.has(o.value)}>
                    {o.label}{o.hint ? ` — ${o.hint}` : ""}
                </option>
            ))}
        </select>
    )}

    <p class="multi__helper">
        {helper ?? "Hold Command (Mac) or Control (Windows) to select more than one."}
    </p>

    {/*
      An empty <select multiple> posts NOTHING, so "everyone removed" would be
      indistinguishable from "field absent" — and the API's whitelist leaves
      absent fields untouched, so the removal would silently not happen. This
      always-present marker makes the field's presence unconditional.
    */}
    <input type="hidden" name={`${name}__present`} value="1" />
</div>

<style>
    .multi { display: flex; flex-direction: column; gap: var(--space-200); width: 100%; }
    .multi__label {
        font-family: var(--font-family-body); font-size: 14px; font-weight: 600;
        line-height: 1; text-transform: uppercase;
        color: var(--primitive-neutral-500); order: -1;
    }
    .multi__control {
        width: 100%; padding: var(--space-200);
        background-color: var(--primitive-neutral-50);
        border: var(--stroke-border) solid var(--primitive-neutral-300);
        border-radius: var(--radius-100);
        font-family: var(--font-family-body); font-size: 16px;
        color: var(--primitive-neutral-900);
    }
    .multi__control:focus-visible {
        outline: var(--stroke-focus-ring) solid var(--primitive-brand-300);
        outline-offset: 1px; border-color: var(--primitive-brand-300);
    }
    .multi__control option { padding: var(--space-100) var(--space-200); }
    .multi__helper, .multi__empty {
        margin: 0; font-family: var(--font-family-body); font-size: 12px;
        line-height: 1.4; color: var(--primitive-neutral-600);
    }
    .multi__empty { font-size: 14px; }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/components/MultiSelect.astro && \
  git commit -m "feat: no-JS multi-select picker"
```

---

### Task 7: Committee payload mapping

The `__present` marker from Task 6 is what makes "remove everyone" expressible. This is where it gets read, and it is the subtle part of the whole plan.

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

    it("collects every selected member", () => {
        const p = toCommitteePayload(
            form({ name: "E", members: ["m1", "m2", "m3"], members__present: "1" }),
            { chapterSlug: "b" });
        expect(p.members).toEqual(["m1", "m2", "m3"]);
    });

    it("sends an EMPTY array when the picker was shown and nothing chosen", () => {
        // An empty <select multiple> posts nothing at all. Without the marker
        // this is indistinguishable from "members untouched", and the API's
        // whitelist would leave the old membership in place — so unchecking
        // everyone would silently do nothing.
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

    it("drops an empty description rather than clearing with an empty string", () => {
        const p = toCommitteePayload(form({ name: "E", description: "" }), { chapterSlug: "b" });
        expect(p).not.toHaveProperty("description");
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
 * The `<name>__present` marker is load-bearing. An empty <select multiple>
 * posts no keys at all, so without it "the admin deselected everyone" and "the
 * form had no member picker" look identical — and because the API whitelist
 * leaves absent fields untouched, the first case would silently keep the old
 * membership. The marker is emitted unconditionally by MultiSelect.astro.
 */
export function toCommitteePayload(
    fd: FormData,
    opts: { chapterSlug: string | null }
): CommitteePayload {
    const payload: CommitteePayload = { name: str(fd, "name") };

    if (opts.chapterSlug) payload.chapterSlug = opts.chapterSlug;

    const description = str(fd, "description");
    if (description) payload.description = description;

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

### Task 8: News payload mapping

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

    it("requires a body — the schema marks it required and Strapi throws", () => {
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
 * required:true and Strapi THROWS on a null — verified. Catching it in the form
 * turns a 500 into a sentence.
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

    const excerpt = str(fd, "excerpt");
    if (excerpt) payload.excerpt = excerpt;

    const publishedDate = str(fd, "publishedDate");
    if (publishedDate) payload.publishedDate = publishedDate;

    if (typeof opts.figureId === "number") payload.figure = opts.figureId;

    return payload;
}
```

- [ ] **Step 4: Run it, then the whole frontend suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  npx vitest run tests/unit/news-form.test.ts && npm test
```

Expected: 8 tests, then **40 across 5 files** (24 from plan 2, 8 committee, 8 news).

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/news-form.ts tests/unit/news-form.test.ts && \
  git commit -m "feat: news form payload mapping"
```

---

## Chunk 4: Client and Astro routes

### Task 9: Extend the chapter-admin client

**Files:** Modify `src/lib/chapter-admin.ts`

- [ ] **Step 1: Add the types and calls**

Append to the file:

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

/** Members of one chapter, for the pickers. Fails soft to an empty list. */
export async function listMembers(jwt: string, chapterSlug: string): Promise<ChapterMember[]> {
    const { status, body } = await call(jwt, `/members?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && Array.isArray(body?.data) ? body.data : [];
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

export async function listSubmissions(jwt: string): Promise<AdminSubmission[] | null> {
    const { status, body } = await call(jwt, "/submissions");
    return status === 200 && body?.data ? body.data : null;
}

export async function setSubmissionHandled(jwt: string, documentId: string, handled: boolean) {
    const { status } = await call(jwt, `/submissions/${documentId}`, {
        method: "PUT", body: JSON.stringify({ handled }),
    });
    return { ok: status === 200, status };
}
```

Note `listCommittees` and `getCommittee` share the fetch-and-find shape `getEvent` uses. See Known limitations.

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/lib/chapter-admin.ts && \
  git commit -m "feat: client calls for members, committees, news, settings and submissions"
```

---

### Task 10: The four Astro API routes

All four mirror `src/pages/api/chapter-admin/event.ts` — dispatch on `_action`, forward with the session JWT, redirect with a flash param.

**Files:** Create `src/pages/api/chapter-admin/{committee,news,settings,submission}.ts`

- [ ] **Step 1: `committee.ts`**

```ts
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../../lib/auth";
import { administers } from "../../../lib/account";
import { toCommitteePayload, validateCommitteeForm } from "../../../lib/committee-form";
import { saveCommittee, deleteCommittee } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, locals }) => {
    const jwt = cookies.get(SESSION_COOKIE)?.value;
    if (!jwt || !locals.user) return redirect("/login?next=/account/chapter", 303);

    const form = await request.formData();
    const action = String(form.get("_action") ?? "save");
    const chapterSlug = String(form.get("chapterSlug") ?? "");
    const documentId = String(form.get("documentId") ?? "");

    if (!chapterSlug || !administers(locals.user, chapterSlug)) {
        return redirect("/account?error=not-chapter-admin", 303);
    }

    const base = `/account/chapter/${chapterSlug}/committees`;
    const back = (path: string, params: string) => redirect(`${path}?${params}`, 303);
    const editPath = documentId ? `${base}/${documentId}` : `${base}/new`;

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
        // 403 here is either "not your chapter" or "that member isn't in your
        // chapter" — the API distinguishes them in the message, and the form
        // shows a single sentence covering both.
        if (result.status === 403) return back(editPath, "error=forbidden");
        return back(editPath, `error=save&message=${encodeURIComponent(result.message)}`);
    }
    return back(base, documentId ? "saved=1" : "created=1");
};
```

- [ ] **Step 2: `news.ts`**

Identical in shape, with the image-upload branch copied from `event.ts`:

```ts
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../../lib/auth";
import { administers } from "../../../lib/account";
import { toNewsPayload, validateNewsForm } from "../../../lib/news-form";
import { saveNews, deleteNews, uploadMedia } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, locals }) => {
    const jwt = cookies.get(SESSION_COOKIE)?.value;
    if (!jwt || !locals.user) return redirect("/login?next=/account/chapter", 303);

    const form = await request.formData();
    const action = String(form.get("_action") ?? "save");
    const chapterSlug = String(form.get("chapterSlug") ?? "");
    const documentId = String(form.get("documentId") ?? "");

    if (!chapterSlug || !administers(locals.user, chapterSlug)) {
        return redirect("/account?error=not-chapter-admin", 303);
    }

    const base = `/account/chapter/${chapterSlug}/news`;
    const back = (path: string, params: string) => redirect(`${path}?${params}`, 303);
    const editPath = documentId ? `${base}/${documentId}` : `${base}/new`;

    if (action === "delete") {
        if (!documentId) return back(base, "error=missing");
        const result = await deleteNews(jwt, documentId);
        return back(base, result.ok ? "deleted=1" : `error=${result.status === 403 ? "forbidden" : "delete"}`);
    }

    const invalid = validateNewsForm(form);
    if (invalid) return back(editPath, `error=${invalid}`);

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
import { SESSION_COOKIE } from "../../../lib/auth";
import { administers } from "../../../lib/account";
import { saveChapterSettings } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, locals }) => {
    const jwt = cookies.get(SESSION_COOKIE)?.value;
    if (!jwt || !locals.user) return redirect("/login?next=/account/chapter", 303);

    const form = await request.formData();
    const chapterSlug = String(form.get("chapterSlug") ?? "");
    if (!chapterSlug || !administers(locals.user, chapterSlug)) {
        return redirect("/account?error=not-chapter-admin", 303);
    }

    const path = `/account/chapter/${chapterSlug}/settings`;
    const name = String(form.get("name") ?? "").trim();
    if (!name) return redirect(`${path}?error=name-required`, 303);

    // `slug` is deliberately not sent: it is a uid that will not regenerate,
    // and already-written event slug prefixes would not follow it if it did.
    const result = await saveChapterSettings(jwt, {
        chapterSlug, name, email: String(form.get("email") ?? "").trim(),
    });

    if (!result.ok) {
        if (result.status === 403) return redirect(`${path}?error=forbidden`, 303);
        return redirect(`${path}?error=save`, 303);
    }
    return redirect(`${path}?saved=1`, 303);
};
```

- [ ] **Step 4: `submission.ts`**

```ts
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../../lib/auth";
import { administers } from "../../../lib/account";
import { setSubmissionHandled } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect, locals }) => {
    const jwt = cookies.get(SESSION_COOKIE)?.value;
    if (!jwt || !locals.user) return redirect("/login?next=/account/chapter", 303);

    const form = await request.formData();
    const chapterSlug = String(form.get("chapterSlug") ?? "");
    const documentId = String(form.get("documentId") ?? "");

    if (!chapterSlug || !administers(locals.user, chapterSlug)) {
        return redirect("/account?error=not-chapter-admin", 303);
    }

    const path = `/account/chapter/${chapterSlug}/submissions`;
    if (!documentId) return redirect(`${path}?error=missing`, 303);

    // A checkbox posts nothing when unchecked, which is exactly the semantics
    // wanted here: present means handled, absent means not.
    const handled = form.get("handled") != null;
    const result = await setSubmissionHandled(jwt, documentId, handled);

    return redirect(`${path}?${result.ok ? "saved=1" : "error=save"}`, 303);
};
```

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/pages/api/chapter-admin/ && \
  git commit -m "feat: committee, news, settings and submission API routes"
```

---

## Chunk 5: The screens

### Task 11: Add the nav entries

**Files:** Modify `src/layouts/ChapterAdminLayout.astro`

- [ ] **Step 1: Extend `NAV`**

```js
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

---

### Task 12: `CommitteeForm.astro`

**Files:** Create `src/components/CommitteeForm.astro`

- [ ] **Step 1: Write it**

```astro
---
import FormField from "./FormField.astro";
import MultiSelect from "./MultiSelect.astro";
import type { AdminCommittee, ChapterMember } from "../lib/chapter-admin";

interface Props {
    chapterSlug: string;
    members: ChapterMember[];
    committee?: AdminCommittee | null;
    error?: string | null;
}

const { chapterSlug, members, committee = null, error = null } = Astro.props;
const isEdit = Boolean(committee?.documentId);

const selected = (committee?.members ?? [])
    .map((m) => m.documentId)
    .filter(Boolean) as string[];

const options = members.map((m) => ({
    value: m.documentId,
    label: m.displayName || "(unnamed member)",
    hint: m.title || undefined,
}));

const messages: Record<string, string> = {
    "name-required": "Give the committee a name.",
    forbidden: "You don't have permission to change this, or someone you selected isn't a member of this chapter.",
    save: "Something went wrong saving this committee. Please try again.",
    missing: "That committee could not be found.",
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

    <MultiSelect
        label="Members"
        name="members"
        options={options}
        selected={selected}
        emptyMessage="This chapter has no members to assign yet."
        helper="Hold Command (Mac) or Control (Windows) to select more than one. Only this chapter's members are listed."
    />

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
    .cform__error {
        margin: 0; padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body); font-size: 16px;
    }
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

---

### Task 13: Committee pages

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
const committees = await listCommittees(jwt);
const failed = committees === null;
const rows = committees ?? [];

const sp = Astro.url.searchParams;
const flash = sp.get("saved") ? "Committee saved."
    : sp.get("created") ? "Committee created."
    : sp.get("deleted") ? "Committee deleted."
    : null;

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
    {failed && (
        <p class="clist__error" role="alert">
            Couldn't load committees. Please refresh, or try again shortly.
        </p>
    )}

    {!failed && rows.length === 0 ? (
        <p class="clist__empty">No committees yet. <a href={`${base}/new`}>Create the first one.</a></p>
    ) : (
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

Same as `new.astro`, plus the fetch:

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

---

### Task 14: News form and pages

**Files:** Create `src/components/NewsForm.astro` and the three pages under `news/`

- [ ] **Step 1: `NewsForm.astro`**

Model it on `EventForm.astro` — same structure, different fields. Key differences:

- `enctype="multipart/form-data"` (it has an image)
- `body` is a **required** textarea carrying the same "Plain text for now" helper as events
- `publishedDate` is a plain `date` input, so pass `type="text"` with a `YYYY-MM-DD` placeholder — `FormField` has no `date` type and adding one is out of scope here
- messages map adds `"body-required": "Write the article body."`

```astro
---
import FormField from "./FormField.astro";
import { blocksToPlainText } from "../lib/blocks";
import type { AdminNewsItem } from "../lib/chapter-admin";

interface Props {
    chapterSlug: string;
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
    missing: "That article could not be found.",
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

- [ ] **Step 2: The three pages**

Copy `events/index.astro`, `events/new.astro` and `events/[documentId].astro`, substituting:

| events | news |
|---|---|
| `listEvents` / `getEvent` | `listNews` / `getNewsItem` |
| `result.events` | `result.items` |
| `EventForm` | `NewsForm` |
| `active="events"` | `active="news"` |
| `e.startsAt` in the row | `n.publishedDate` |
| "Add Event" | "Add Article" |

Keep the pagination block verbatim — `listNews` returns the same `Pagination` shape.

- [ ] **Step 3: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/components/NewsForm.astro "src/pages/account/chapter/[chapterSlug]/news/" && \
  git commit -m "feat: news form and pages"
```

---

### Task 15: Settings and submissions pages

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
        <p class="cset__error" role="alert">Couldn't load this chapter's settings.</p>
    ) : (
        <form class="cset" method="post" action="/api/chapter-admin/settings">
            <input type="hidden" name="chapterSlug" value={chapter.slug} />

            <FormField label="Chapter Name" name="name" required value={settings.name} />
            <FormField label="Contact Email" name="email" type="email" value={settings.email}
                placeholder="chapter@areaa.org"
                helper="Shown on your microsite and used for contact form replies." />

            <div class="cset__readonly">
                <p class="cset__readonly-label">Web address</p>
                <p class="cset__readonly-value">/chapters/{settings.slug}</p>
                <p class="cset__readonly-note">
                    Changing a chapter's web address would break existing links and every
                    event URL already published under it, so it stays a national operation.
                    Contact national if it needs to change.
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

One form per row, so unchecking works without JS. `data` is a free-form JSON blob, so render its entries generically.

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
const submissions = await listSubmissions(jwt);
const failed = submissions === null;
const rows = submissions ?? [];

const sp = Astro.url.searchParams;
const flash = sp.get("saved") ? "Updated." : null;

// `data` is a JSON blob whose shape the contact form decides, so render whatever
// keys are present rather than assuming name/email/message.
const entriesOf = (d: Record<string, unknown> | null) =>
    Object.entries(d ?? {}).filter(([, v]) => v !== null && v !== "" && typeof v !== "object");
---

<ChapterAdminLayout
    title={`Submissions | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="submissions"
>
    <h1 class="sub__title">Submissions</h1>

    {flash && <p class="sub__flash" role="status">{flash}</p>}
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
                        <p class="sub__when">
                            {s.submittedAt
                                ? new Date(s.submittedAt).toLocaleString("en-US", {
                                      month: "long", day: "numeric", year: "numeric",
                                      hour: "numeric", minute: "2-digit",
                                  })
                                : "Date unknown"}
                        </p>
                        <dl class="sub__data">
                            {entriesOf(s.data).map(([k, v]) => (
                                <>
                                    <dt>{k}</dt>
                                    <dd>{String(v)}</dd>
                                </>
                            ))}
                        </dl>
                    </div>

                    <form method="post" action="/api/chapter-admin/submission" class="sub__form">
                        <input type="hidden" name="chapterSlug" value={chapter.slug} />
                        <input type="hidden" name="documentId" value={s.documentId} />
                        {/* Checked means "mark unhandled" on submit, and vice versa —
                            an unchecked checkbox posts nothing, which is the semantics
                            the route reads. */}
                        {!s.handled && <input type="hidden" name="handled" value="1" />}
                        <button type="submit" class="sub__toggle">
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
    .sub__data { margin: 0; font-family: var(--font-family-body); font-size: 15px;
        display: grid; grid-template-columns: auto 1fr; gap: var(--space-100) var(--space-400); }
    .sub__data dt { font-weight: 700; color: var(--primitive-neutral-700); text-transform: capitalize; }
    .sub__data dd { margin: 0; color: var(--primitive-neutral-900); overflow-wrap: anywhere; }
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

---

## Chunk 6: Verification

### Task 16: Both suites

- [ ] **Step 1: Run them**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test && npm run check
```

Expected: **87 CMS**, **40 frontend**, 0 typecheck errors.

- [ ] **Step 2: Run the CMS suite again without reseeding**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: 87 again, and no growth in row counts:

```bash
sqlite3 .tmp/data.db "SELECT (SELECT COUNT(DISTINCT document_id) FROM committees) AS committees, \
  (SELECT COUNT(DISTINCT document_id) FROM news_items) AS news, \
  (SELECT COUNT(*) FROM form_submissions) AS submissions;"
```

Run it before and after a suite run; the numbers must match. Plan 2 shipped a suite that grew the events table on every run and eventually broke the public site.

---

### Task 17: Prove it in a browser

- [ ] **Step 1: Seed one submission, since nothing writes them**

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

- [ ] **Step 2: Start both servers**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop &
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run dev &
```

Note the port Astro reports — it takes the next free one if 4321 is busy.

- [ ] **Step 3: Walk the path**

Sign in as `chapadmin@areaa.test` / `Password123!`.

| # | Action | Expected |
|---|---|---|
| 1 | Open the chapter, check the sidebar | Overview, Events, News, Committees, Submissions, Settings |
| 2 | Committees → Add Committee → name + pick two members → Create | "Committee created."; the row lists both names |
| 3 | Open it, deselect everyone, Save | **0 members.** This is the `__present` marker working; without it the removal silently does nothing |
| 4 | Re-open, select one member, Save | 1 member — replace, not append |
| 5 | Submit a committee with no name | "Give the committee a name." |
| 6 | News → Add Article → title only, no body | "Write the article body." — not a 500 |
| 7 | Add a body, Publish | Back at the list; slug prefixed with the chapter slug |
| 8 | Open it and check the byline in Strapi admin | Author is **chapadmin**, whatever the form was told |
| 9 | Attach an image, Save | Reopens showing "Current image: view" |
| 10 | Settings → change the contact email, Save | "Settings saved."; persists on reload |
| 11 | Settings → confirm the web address | Shown read-only with the explanation, no input |
| 12 | Submissions | The seeded one, with its fields and Mark handled |
| 13 | Mark handled, then unhandled | Row dims and undims; state persists on reload |
| 14 | Disable JavaScript entirely and repeat 2–4 | Everything still works, including the member picker |

- [ ] **Step 4: Confirm the public site reflects it**

Visit the chapter microsite and `/news` (if a listing exists). A published news item must be publicly readable — that is CA11 again, and it is the thing most likely to be silently wrong.

- [ ] **Step 5: Try the attacks by hand**

```bash
# Substitute a real JWT and a member documentId from ANOTHER chapter.
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:1337/api/chapter-admin/committees \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"Attack","chapterSlug":"aloha-hawaii","members":["<foreign-member-documentId>"]}'
```

Expected: **403.** A 200 means any chapter admin can put any member of any chapter on their committee.

- [ ] **Step 6: Commit anything outstanding**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && git status --short
cd /Users/nk/Projects/AREAA/areaa-cms && git status --short
```

Expected: clean in both.

---

## Done when

- **87 CMS tests and 40 frontend tests green**, CMS twice in a row without reseeding and without row growth.
- A chapter admin can create, edit and delete committees, and change who sits on them — **including removing everyone** — with JavaScript disabled.
- A committee write naming a member of another chapter returns **403 with "do not belong"**, not a 200 and not a 403 for an incidental reason.
- News publishes with a chapter-prefixed slug and the **author forced to the session user**, and a missing body is a 400.
- Chapter name and email save; the slug is visibly read-only and unchangeable through the API.
- Submissions list scoped to administered chapters and toggle handled.
- `sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%'"` reports **18**.

## Not in this plan

- **`/page`** — the fixed-template microsite editor, and its dynamic-zone positional merge. Plan 4. It reuses the picker built here.
- **`/partners`** — attach/detach. Plan 4, alongside `/page`'s partner-group slot.
- **TipTap and the real blocks converters.** Plan 5. `news.body` uses the same plain-text placeholder as `event.description`.
- **Wiring the contact form to actually capture submissions** — see the opening section. This plan builds the admin side of a table nothing writes.

## Known limitations, accepted

- **`getCommittee` and `getNewsItem` fetch a page and find one in the list**, inheriting `getEvent`'s shape, because there is still no single-record route. Committees are few; news is capped at 100 and will silently stop finding older items past that. Adding `GET /chapter-admin/<resource>/:documentId` would retire all three at once and is the right first task of plan 4.
- **`publishedDate` is a free-text field** rather than a date picker, because `FormField` has no `date` type. A malformed value is rejected by Strapi as a 400 with a generic message.
- **The member picker lists every member of the chapter with no search.** Fine at current chapter sizes; a chapter with several hundred members will want filtering, and `<select multiple>` will stop being the right control at that point.
- **Committee membership is not validated on read.** If national moves a member to another chapter, that member stays on the committee until someone re-saves it. Enforcing on read would mean filtering every list response against current membership.
- **No single "unsaved changes" guard anywhere.** Consistent with CA10's last-write-wins posture.
