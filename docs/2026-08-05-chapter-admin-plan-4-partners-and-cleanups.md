# Chapter Admin — Plan 4: Partners, Single-Record Routes and Structural Cleanups

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chapter admins choose which partners appear on their microsite; and the four structural debts plans 1–3 knowingly accrued are paid off before `/page` lands on top of them.

**Architecture:** One new resource (`/partners`, attach/detach only — Partner records are never edited) plus four deferred cleanups: a real single-record route, server-side chapter scoping on the factory lists, a split of the frontend client, and error rendering on `/account`.

**Tech Stack:** Strapi 5.45.1, Node 24, CommonJS, Astro 6.4.2, TypeScript strict, Vitest 3.

**Spec:** [`2026-08-03-chapter-admin-authoring-design.md`](./2026-08-03-chapter-admin-authoring-design.md).
**Predecessors:** [plan 1](./2026-08-03-chapter-admin-plan-1-authorization-spine.md), [plan 2](./2026-08-03-chapter-admin-plan-2-events-authoring-ui.md), [plan 3](./2026-08-04-chapter-admin-plan-3-committees-news-settings.md) — all complete, **122 CMS + 54 frontend tests green**.

---

## Revision note

This is v2. v1 was reviewed by three independent readers and **none approved it**. One finding invalidated the feature outright, and is why this version's partners work looks nothing like v1's.

**v1 wrote `chapter.partners`. Nothing reads it.** The microsite renders partners from the `shared.partner-group` component's *own* relation (`src/lib/content.ts:65` populates it; `adapters.ts:137` maps it). The frontend contains **zero** references to `chapter.partners`. v1 would have let an admin attach partners, save successfully, and see no change — while its walkthrough asserted the opposite.

The spec contains the same contradiction: its API table says `/partners` works *"via `chapter.partners`"*, while its `/page` slot table says partner-group content comes *"via `/partners`"*. Those cannot both hold. **This plan resolves it in favour of the renderer.**

Other v1 defects fixed here, each found by a reviewer running the code rather than reading it:

- Two unit tests **failed against v1's own implementation** — a `findOne` spy that captured the wrong call, and a fake that 404'd before reaching the assertion under test.
- The partners suite **destroyed sponsor ordering** on real chapters (`partner_ord` is a real column; the `afterAll` wrote back a `.sort()`ed list), and the row-count gate could not detect it.
- Two tests **could not fail** for the reasons they named.
- Tasks 8 and 9 both **committed with a red typecheck**, and `check && test` short-circuited so the test gate was never observed.
- A fifth instance of this project's recurring arithmetic slip (`125` where `130` was correct).

---

## Scope

**In:** `/partners`, plus these four, each named in a predecessor's Known limitations:

| Debt | Named in | Why now |
|---|---|---|
| `GET /<resource>/:documentId` | plan 3, "the right first task of plan 4" | `getEvent`/`getCommittee`/`getNewsItem` each fetch 100 records and `.find()`. Past 100 they silently stop finding older ones |
| Server-side chapter scoping on `list` | plan 3 | The committee and news pages filter client-side *after* server pagination, so a multi-chapter admin sees wrong page counts and empty pages |
| Split `src/lib/chapter-admin.ts` | plan 3 | 303 lines, six resource clients. The single-record work touches every getter |
| `/account` renders `error=not-chapter-admin` | plan 3 | Twelve page guards plus `form-route.ts` and `middleware.ts` emit it; the landing page shows nothing |

**Out:** `/page` — the fixed-template microsite editor. Plan 5, alone.
**Out:** TipTap and the real blocks converters. Plan 6.

---

## Why this does NOT drag in `/page`

Writing a component's relation sounds like it needs a dynamic-zone write, which is `/page`'s hard problem. It does not, and this was verified rather than assumed:

- `strapi.db.query('shared.partner-group').update({ where: { id }, data: { partners: [...] } })` **replaces the relation cleanly and preserves `partner_ord`.** Probed on a real component and restored.
- The **dynamic zone is never touched.** Which components a page has, and in what order, is unchanged — only a relation *inside* one component moves. There is no positional merge here.

One structural fact shapes the implementation: **draft and published pages hold different component rows.** `aloha-hawaii`'s draft home page (79) carries partner-group component **34**; its published page (80) carries component **35**. Writing one leaves the other stale, so `/partners` writes **both** — published is what the public site renders, draft is what the admin panel shows.

---

## Preconditions

**1. Node 24 for anything touching the CMS repo.** Bare `node` here is v22.12.0; `/opt/homebrew/bin/node` is v24.1.0, so the `PATH=` prefix is load-bearing.

**2. Command-line tools.** Task 13 depends on all three; present on this machine, but a zero-context worker elsewhere needs them:

| Tool | Used by |
|---|---|
| `sqlite3` | every DB check, and the Task 13 restore |
| `python3` | JSON parsing in the Task 13 curls |
| `curl` | the Task 13 attack suite |

**3. Two repos.** Every command block states its own `cd`.

| Repo | Path |
|---|---|
| CMS | `/Users/nk/Projects/AREAA/areaa-cms` |
| Frontend | `/Users/nk/Projects/AREAA/areaa-frontend` |

**4. The CMS dev server must be STOPPED for tests and boots, RUNNING for browser verification.**

```bash
pkill -f "strapi develop"
cd /Users/nk/Projects/AREAA/areaa-cms && \
  PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop
```

**5. Test accounts.** `chapadmin@areaa.test` and `plainmember@areaa.test` exist from plan 2 (`provider='local'`, confirmed, unblocked). Task 13 Step 1 creates `twochapter@areaa.test`. Any new user **must** carry `provider: 'local'` or it cannot log in.

---

## Verified assumptions

Executed against the installed Strapi 5.45.1 and the seeded database.

| Assumption | Verdict |
|---|---|
| `shared.partner-group` has its **own** `partners` relation (oneToMany → partner) | ✅ Per the component schema; 22 rows in `components_shared_partner_groups_partners_lnk` |
| The microsite renders from **that** relation, not `chapter.partners` | ✅ `content.ts:65` populates it; zero frontend references to `chapter.partners` |
| `db.query('shared.partner-group').update({ data: { partners } })` replaces the relation | ✅ Probed: 5 → 1 → restored to 5, `partner_ord` intact |
| Draft and published pages hold **different** component rows | ✅ 8 distinct components across 8 pages; aloha draft→cmp34, published→cmp35 |
| The document service finds the component id at either status | ✅ `findFirst({ populate: { components: true }, status })` returns `__component` and `id` |
| `populate: { components: true }` does **not** populate nested relations | ✅ `partners` comes back unpopulated — request it explicitly |
| **Not every chapter has a `home` page** | ✅ `pdx` has none. `/partners` must handle this, not assume |
| Two partner-group components belong to **non-chapter** pages | ✅ Components 32 and 33 sit on pages 75/76 — never write those |
| `partner` is `draftAndPublish: true`, `logo` required | ✅ Per schema |
| `{documentId: '<one>'}` filter shorthand ≡ `$eq` ≡ `$in:[one]` | ✅ Probed on committees, events and news; a bogus id returns 0 rows, not everything |
| No route shadowing with the five new routes registered | ✅ `router.match` resolves every literal and parameterised path correctly |
| `/account/index.astro` renders nothing for any `error` param | ✅ Zero occurrences of the string |

### Carried forward from plan 3, still true

- `fields: [...]` always unions `id` and `documentId`; nested `populate: { x: { fields } }` still returns `documentId`.
- Strapi validates `src/index.js` and rejects any export beyond `register`/`bootstrap`/`destroy` — grants live in `src/api/chapter-admin/grants.js`. **Do not move them back.**
- The `sqlite3` CLI defaults `PRAGMA foreign_keys = 0`; any manual purge must set it ON.
- Tests asserting `toThrow(SomeError)` must load the service **and** the error through one `createRequire`.

---

## File structure

**CMS — create:**

| Path | Responsibility |
|---|---|
| `src/api/chapter-admin/services/partners.js` | `toPartnerRow`, `normalisePartnerIds`, `findPartnerGroups` |
| `tests/unit/partners.test.js` | Row shaping, id normalisation |
| `tests/integration/partners.test.js` | Catalogue, component targeting, scope |
| `tests/integration/single-record.test.js` | `GET /<resource>/:documentId` |

**CMS — modify:** `services/resource-factory.js`, `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `grants.js`.

**Frontend — create:**

| Path | Responsibility |
|---|---|
| `src/lib/chapter-admin/` (client + one module per resource + `index.ts`) | The split |
| `src/lib/partners-form.ts`, `tests/unit/partners-form.test.ts` | Pure payload mapping |
| `src/components/PartnersForm.astro`, `tests/unit/partners-form-render.test.ts` | The picker and its failure branches |
| `src/pages/api/chapter-admin/partner.ts` | Form POST (**singular**, matching `event.ts`/`committee.ts`/`news.ts`) |
| `src/pages/account/chapter/[chapterSlug]/partners.astro` | The screen |

**Frontend — modify:** `ChapterAdminLayout.astro`, `account/index.astro`, the committee/news/**events** list pages, `events/[documentId].astro`, and `src/lib/chapter-admin.ts` → **deleted**.

---

## Chunk 1: Single-record routes

### Task 1: Add `getOne` to the factory

**Files:** Modify `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/factory-hooks.test.js`. **The spy is gated on uid** — v1's was not, so it captured `resolveAdministeredChapters`' user lookup instead of the resource read, and failed against v1's own implementation.

```js
describe('getOne', () => {
  const res = (s, extra = {}) => chapterScopedResource({
    uid: 'api::committee.committee', editableFields: ['name'],
    strapiInstance: s, ...extra,
  });

  it('returns a record in an administered chapter', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({}, { documentId: 'r-1' });
    await res(s).getOne(ctx);
    expect(ctx.body.data.documentId).toBe('r-1');
  });

  it('404s a record that does not exist', async () => {
    const s = fakeStrapi({ stored: null });
    const ctx = makeCtx({}, { documentId: 'nope' });
    await res(s).getOne(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('404s — does NOT 403 — a record with no chapter at all', async () => {
    // `chapter` is not required on event/news/committee, and the real database
    // holds national content with none. A 403 here would make this new read
    // surface an existence oracle: 403 means it exists, 404 means it does not.
    const s = fakeStrapi({ stored: { documentId: 'r-1', chapter: null } });
    const ctx = makeCtx({}, { documentId: 'r-1' });
    await res(s).getOne(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('403s a record in a chapter the caller does not administer', async () => {
    const s = fakeStrapi({ stored: { documentId: 'r-1', chapter: { documentId: 'chap-z', slug: 'seattle' } } });
    await expect(res(s).getOne(makeCtx({}, { documentId: 'r-1' })))
      .rejects.toThrow(/not administered/);
  });

  it('404s when chapterSlug names a different chapter than the record is in', async () => {
    const s = fakeStrapi();                 // stored record is in chap-a / boston
    const ctx = makeCtx({}, { documentId: 'r-1' });
    ctx.query = { chapterSlug: 'seattle' };
    await res(s).getOne(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('applies getOnePopulate so the edit screen gets its relations', async () => {
    const s = fakeStrapi();
    const seen = [];
    const orig = s.documents;
    // Gated on uid: resolveAdministeredChapters reads the USER first, so an
    // ungated spy asserts against the wrong call.
    s.documents = (uid) => {
      const d = orig(uid);
      if (uid !== 'api::committee.committee') return d;
      return { ...d, findOne: async (args) => { seen.push(args); return d.findOne(args); } };
    };
    await res(s, { getOnePopulate: { members: { fields: ['firstName'] } } })
      .getOne(makeCtx({}, { documentId: 'r-1' }));
    expect(seen[0].populate).toHaveProperty('members');
    expect(seen[0].populate).toHaveProperty('chapter');   // always merged
  });

  it('falls back to listPopulate when getOnePopulate is unset', async () => {
    // The edit screen needs at least what the list needs. Without this, adding
    // a relation to listPopulate alone silently leaves the edit form blank.
    const s = fakeStrapi();
    const seen = [];
    const orig = s.documents;
    s.documents = (uid) => {
      const d = orig(uid);
      if (uid !== 'api::committee.committee') return d;
      return { ...d, findOne: async (args) => { seen.push(args); return d.findOne(args); } };
    };
    await res(s, { listPopulate: { figure: { fields: ['url'] } } })
      .getOne(makeCtx({}, { documentId: 'r-1' }));
    expect(seen[0].populate).toHaveProperty('figure');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js
```

Expected: FAIL — `getOne is not a function`.

- [ ] **Step 3: Implement**

Add `getOnePopulate = null` to the destructured options (it *overrides* `listPopulate`; leaving it unset inherits), a `firstStr` near the top of the file, and the handler above `list`.

`firstStr` already exists in `controllers/chapter-admin.js` and again in the
users-permissions extension. This makes a third copy — deliberate for now, since
the factory is a service and importing from a controller would invert the
dependency, but worth collapsing into `services/` when something else needs it:

```js
/** Query params can arrive as string | string[]; take the first. */
const firstStr = (v) => (Array.isArray(v) ? v[0] : v ?? '').toString().trim();
```

```js
    /**
     * One record by documentId, scope-checked.
     *
     * Replaces the client-side "fetch a page and .find() it", which silently
     * stopped finding anything past the 100th record.
     *
     * `chapterSlug` is optional but the pages always send it: a caller may
     * administer several chapters, and answering /chapter/A/…/<B's-id> with B's
     * record is how a cross-chapter edit screen became reachable in plan 3.
     */
    async getOne(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const { documentId } = ctx.params;

      // Defaults to listPopulate. The edit screen needs at least what the list
      // needs, and three hand-written copies byte-identical to the listPopulate
      // blocks directly above them is duplication that will drift the first time
      // someone adds a relation to one and not the other.
      const record = await docs().findOne({
        documentId,
        populate: { chapter: { fields: ['name', 'slug'] }, ...(getOnePopulate ?? listPopulate ?? {}) },
        status: 'draft',
      });
      if (!record) return ctx.notFound();

      // A chapterless record (national content) is a 404, not a 403 — a 403
      // would confirm to a caller who may not see it that the record exists.
      if (!record.chapter) return ctx.notFound();

      assertChapterScope(administered, record.chapter.documentId);

      const wanted = firstStr(ctx.query?.chapterSlug);
      if (wanted && record.chapter.slug !== wanted) return ctx.notFound();

      ctx.body = { data: record };
    },
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js
```

Expected: PASS, **15 tests** (8 existing + 7).

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/resource-factory.js tests/unit/factory-hooks.test.js && \
  git commit -m "feat: single-record getOne on the chapter-scoped factory"
```

---

### Task 2: Optional chapter scoping on `list`

**Files:** Modify `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Write the failing test**

The fake needs a chapter that **exists but is not administered**, or the 403 branch is unreachable. v1's knew only `'boston'`, so `'seattle'` 404'd before `assertChapterScope` ran and the test failed.

Extend `fakeStrapi`'s chapter stub:

```js
      if (uid === 'api::chapter.chapter') {
        // CHAP is administered; OTHER exists but is not.
        const OTHER = { id: 56, documentId: 'chap-z', slug: 'seattle' };
        return {
          findFirst: async ({ filters }) =>
            [CHAP, OTHER].find((c) => c.slug === filters.slug) ?? null,
        };
      }
```

Then append:

```js
describe('list scoping', () => {
  const spy = () => {
    const seen = [];
    const s = fakeStrapi();
    const orig = s.documents;
    s.documents = (uid) => {
      const d = orig(uid);
      if (uid !== 'api::committee.committee') return d;
      return { ...d, findMany: async (a) => { seen.push(a); return []; }, count: async () => 0 };
    };
    return { s, seen };
  };

  const res = (s) => chapterScopedResource({
    uid: 'api::committee.committee', editableFields: ['name'], strapiInstance: s,
  });

  it('spans every administered chapter when no chapterSlug is given', async () => {
    const { s, seen } = spy();
    await res(s).list(makeCtx());
    expect(seen[0].filters.chapter).toEqual({ documentId: { $in: ['chap-a'] } });
  });

  it('narrows to ONE chapter when chapterSlug is given', async () => {
    const { s, seen } = spy();
    const ctx = makeCtx();
    ctx.query = { chapterSlug: 'boston' };
    await res(s).list(ctx);
    expect(seen[0].filters.chapter).toEqual({ documentId: 'chap-a' });
  });

  it('403s a chapterSlug that EXISTS but is not administered', async () => {
    const { s } = spy();
    const ctx = makeCtx();
    ctx.query = { chapterSlug: 'seattle' };
    await expect(res(s).list(ctx)).rejects.toThrow(/not administered/);
  });

  it('404s a chapterSlug that does not exist at all', async () => {
    const { s } = spy();
    const ctx = makeCtx();
    ctx.query = { chapterSlug: 'atlantis' };
    await res(s).list(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js
```

Expected: FAIL — the narrowing cases still see `$in`.

- [ ] **Step 3: Implement**

In `list`, replace the `filters` construction:

```js
      // Optional single-chapter narrowing. Without it the pages must filter
      // client-side AFTER pagination, so pageCount describes a larger set than
      // the rows shown — a multi-chapter admin sees "page 2 of 3" render
      // nothing. The bare `{documentId: 'x'}` shorthand is equivalent to $eq
      // (verified) — no operator needed.
      const wanted = firstStr(ctx.query?.chapterSlug);
      let scope = { documentId: { $in: administered } };
      if (wanted) {
        const chapter = await s().documents('api::chapter.chapter').findFirst({
          filters: { slug: wanted }, fields: ['slug'], status: 'draft',
        });
        if (!chapter) return ctx.notFound('No such chapter');
        assertChapterScope(administered, chapter.documentId);
        scope = { documentId: chapter.documentId };
      }

      const filters = { chapter: scope };
```

`count()` already receives this same object, so `pageCount` cannot disagree with the rows.

- [ ] **Step 4: Run it, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js && \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **19 tests** in that file (8 + 7 + 4), then **133 overall** (122 + 11). Nothing sends `chapterSlug` yet, so the existing suites are untouched.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/resource-factory.js tests/unit/factory-hooks.test.js && \
  git commit -m "feat: optional server-side chapter scoping on factory lists"
```

---

### Task 3: Wire the three single-record routes

**Files:** Modify `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `grants.js`

- [ ] **Step 1: Export the handlers**

**No `getOnePopulate` anywhere.** All three would have been byte-identical to
the `listPopulate` blocks already sitting above them, and Task 1's fallback
covers it. The option exists for a future resource whose edit screen genuinely
needs more than its list — none of these three does.

```js
  getEvent: guarded(events.getOne),
  getCommittee: guarded(committees.getOne),
  getNewsItem: guarded(news.getOne),
```

- [ ] **Step 2: Add the routes**

Verified free of shadowing with all five new routes registered — `router.match` resolves `/members`, `/chapter`, `/partners` and `/submissions` to their literal handlers.

```js
    { method: 'GET', path: '/chapter-admin/events/:documentId',      handler: 'chapter-admin.getEvent' },
    { method: 'GET', path: '/chapter-admin/committees/:documentId',  handler: 'chapter-admin.getCommittee' },
    { method: 'GET', path: '/chapter-admin/news/:documentId',        handler: 'chapter-admin.getNewsItem' },
```

- [ ] **Step 3: Grant them**

```js
  'api::chapter-admin.chapter-admin.getEvent',
  'api::chapter-admin.chapter-admin.getCommittee',
  'api::chapter-admin.chapter-admin.getNewsItem',
```

- [ ] **Step 4: The grants test is the wiring check**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/grants.test.js
```

Expected: PASS, 3 tests. Do **not** substitute a permission row count — that check is inert, because `syncPermissions` prunes unknown actions and the grant loop re-creates them.

- [ ] **Step 5: Boot and confirm**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: `BOOTSTRAP OK`, then `21`.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: GET /chapter-admin/{events,committees,news}/:documentId"
```

---

### Task 4: Integration-test the single-record routes

**Files:** Create `tests/integration/single-record.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
const BODY = [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }];
let strapi, chapterA, chapterB, tokenBoth, tokenA;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);

  const both = await makeChapterAdmin(strapi, {
    email: `sr-both-${RUN}@areaa.test`, chapterIds: [chapterA.id, chapterB.id],
  });
  tokenBoth = await jwtFor(strapi, both.id);

  const one = await makeChapterAdmin(strapi, {
    email: `sr-one-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, one.id);
});

afterAll(async () => {
  try {
    for (const uid of ['api::committee.committee', 'api::news-item.news-item', 'api::event.event']) {
      const field = uid.includes('committee') ? 'name' : 'title';
      const junk = await strapi.documents(uid).findMany({
        filters: { [field]: { $contains: String(RUN) } }, limit: -1, status: 'draft',
      });
      for (const r of junk) await strapi.documents(uid).delete({ documentId: r.documentId });
    }
    const users = await strapi.query('plugin::users-permissions.user')
      .findMany({ where: { email: { $contains: String(RUN) } } });
    for (const u of users) {
      await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
    }
  } finally {
    // ALWAYS shut down. helpers.js documents that skipping it produces
    // ERR_IPC_CHANNEL_CLOSED and a red suite that means nothing.
    await shutdown();
  }
});

const api = () => request(strapi.server.httpServer);
const as = (token) => (r) => r.set('Authorization', `Bearer ${token}`);
const tag = (n) => `${n} ${RUN}`;

const seed = async (token, chapter) => {
  const auth = as(token);
  const cm = await auth(api().post('/api/chapter-admin/committees'))
    .send({ name: tag('SR Cmte'), chapterSlug: chapter.slug });
  const nw = await auth(api().post('/api/chapter-admin/news'))
    .send({ title: tag('SR News'), chapterSlug: chapter.slug, body: BODY });
  const ev = await auth(api().post('/api/chapter-admin/events'))
    .send({ title: tag('SR Event'), chapterSlug: chapter.slug });
  return { cm: cm.body.data, nw: nw.body.data, ev: ev.body.data };
};

describe('GET /api/chapter-admin/<resource>/:documentId', () => {
  let own;
  beforeAll(async () => { own = await seed(tokenA, chapterA); });

  it('returns each resource with its edit-screen relations populated', async () => {
    const cm = await as(tokenA)(api().get(`/api/chapter-admin/committees/${own.cm.documentId}`));
    expect(cm.status).toBe(200);
    expect(cm.body.data.chapter.slug).toBe(chapterA.slug);
    expect(cm.body.data).toHaveProperty('members');

    const nw = await as(tokenA)(api().get(`/api/chapter-admin/news/${own.nw.documentId}`));
    expect(nw.status).toBe(200);
    expect(nw.body.data.author).toBeTruthy();

    // v1 asserted only status here, so a missing events getOnePopulate went
    // undetected — the figure key must be present even when null.
    const ev = await as(tokenA)(api().get(`/api/chapter-admin/events/${own.ev.documentId}`));
    expect(ev.status).toBe(200);
    expect(ev.body.data).toHaveProperty('figure');
  });

  it('404s a documentId that does not exist', async () => {
    const res = await as(tokenA)(api().get('/api/chapter-admin/committees/doesnotexist000000000000'));
    expect(res.status).toBe(404);
  });

  it('404s a chapterless record rather than confirming it exists', async () => {
    // The seed holds national events with no chapter. A 403 would be an
    // existence oracle on a brand-new read surface.
    const national = await strapi.documents('api::event.event')
      .findFirst({ filters: { chapter: { documentId: { $null: true } } }, fields: ['title'], status: 'draft' });
    // NOT `if (!national) return` — that is how a test quietly stops testing.
    // Verified present: 4 chapterless events, 2 chapterless news items.
    expect(national).toBeTruthy();
    const res = await as(tokenA)(api().get(`/api/chapter-admin/events/${national.documentId}`));
    expect(res.status).toBe(404);
  });

  it("403s a record in a chapter the caller does not administer", async () => {
    const theirs = await strapi.documents('api::committee.committee').create({
      data: { name: tag('SR Foreign'), chapter: { documentId: chapterB.documentId } },
      status: 'published',
    });
    const res = await as(tokenA)(api().get(`/api/chapter-admin/committees/${theirs.documentId}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('404s a record from ANOTHER administered chapter when chapterSlug names this one', async () => {
    // The multi-chapter case: both are administered, so the scope check passes
    // — only the chapterSlug comparison stops the caller getting a form for B's
    // record under A's URL, which is how a cross-chapter save became reachable.
    const inB = await seed(tokenBoth, chapterB);
    const res = await as(tokenBoth)(
      api().get(`/api/chapter-admin/committees/${inB.cm.documentId}?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(404);
  });

  it('returns it when chapterSlug names the right chapter', async () => {
    const inB = await seed(tokenBoth, chapterB);
    const res = await as(tokenBoth)(
      api().get(`/api/chapter-admin/committees/${inB.cm.documentId}?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(200);
  });

  it('reads by documentId, so list position is irrelevant', async () => {
    // NOT a >100 test — it cannot be one without 101 fixtures, and v1's
    // `?page=999` version asserted nothing a list-and-find implementation
    // would fail. What it does prove: no pagination parameter influences the
    // result, which a list-and-find implementation could not honour.
    const res = await as(tokenA)(
      api().get(`/api/chapter-admin/events/${own.ev.documentId}?page=999&pageSize=1`));
    expect(res.status).toBe(200);
    expect(res.body.data.documentId).toBe(own.ev.documentId);
  });
});

describe('GET /api/chapter-admin/committees?chapterSlug=', () => {
  it('narrows to one chapter for a multi-chapter admin', async () => {
    await seed(tokenBoth, chapterA);
    await seed(tokenBoth, chapterB);

    const all = await as(tokenBoth)(api().get('/api/chapter-admin/committees?pageSize=100'));
    const slugs = new Set(all.body.data.map((c) => c.chapter?.slug));
    expect(slugs.size).toBeGreaterThan(1);

    const one = await as(tokenBoth)(
      api().get(`/api/chapter-admin/committees?pageSize=100&chapterSlug=${chapterA.slug}`));
    expect(one.body.data.length).toBeGreaterThan(0);
    expect(one.body.data.every((c) => c.chapter?.slug === chapterA.slug)).toBe(true);
    expect(one.body.meta.pagination.total).toBeLessThan(all.body.meta.pagination.total);
  });

  it('403s a chapterSlug the caller does not administer', async () => {
    const res = await as(tokenA)(
      api().get(`/api/chapter-admin/committees?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/single-record.test.js
```

Expected: PASS, **9 tests**.

- [ ] **Step 3: Prove no residue**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(*) FROM up_users) u, (SELECT COUNT(DISTINCT document_id) FROM committees) c, (SELECT COUNT(DISTINCT document_id) FROM news_items) n, (SELECT COUNT(DISTINCT document_id) FROM events) e;" && \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/single-record.test.js > /dev/null && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(*) FROM up_users) u, (SELECT COUNT(DISTINCT document_id) FROM committees) c, (SELECT COUNT(DISTINCT document_id) FROM news_items) n, (SELECT COUNT(DISTINCT document_id) FROM events) e;"
```

Expected: **the two rows are identical.**

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/single-record.test.js && \
  git commit -m "test: single-record routes and server-side list scoping"
```

---

## Chunk 2: Partners

### Task 5: The partners service

Three functions. `findPartnerGroups` is where this plan's real complexity lives, and it exists because of two verified facts: draft and published pages carry **different** component rows, and each links to the **matching-status** partner rows.

**Files:** Create `src/api/chapter-admin/services/partners.js`, `tests/unit/partners.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// One createRequire: an ESM import beside the service's CJS require gives two
// class objects and `toThrow(BadInputError)` fails on the wrong one.
const require = createRequire(import.meta.url);
const {
  toPartnerRow, normalisePartnerIds, findPartnerGroups, PARTNER_FIELDS,
} = require('../../src/api/chapter-admin/services/partners.js');
const { BadInputError } = require('../../src/api/chapter-admin/services/fields.js');

describe('toPartnerRow', () => {
  it('returns what the picker needs to render and submit', () => {
    expect(toPartnerRow({
      documentId: 'p1', name: 'Chase', sponsorshipLevel: 'Gold',
      logo: { url: '/uploads/chase.png' },
    })).toEqual({
      documentId: 'p1', name: 'Chase', sponsorshipLevel: 'Gold', logoUrl: '/uploads/chase.png',
    });
  });

  it('tolerates a missing logo even though the schema requires one', () => {
    expect(toPartnerRow({ documentId: 'p1', name: 'Chase' }).logoUrl).toBe('');
  });

  it('never returns undefined values', () => {
    const row = toPartnerRow({ documentId: 'p1' });
    expect(Object.keys(row).sort()).toEqual([...PARTNER_FIELDS].sort());
    for (const v of Object.values(row)) expect(v).not.toBeUndefined();
  });
});

describe('normalisePartnerIds', () => {
  it('accepts id strings and longhand objects', () => {
    expect(normalisePartnerIds(['p1', { documentId: 'p2' }])).toEqual(['p1', 'p2']);
  });

  it('de-duplicates', () => {
    expect(normalisePartnerIds(['p1', 'p1'])).toEqual(['p1']);
  });

  it('preserves order — partner_ord is a real column the microsite renders by', () => {
    expect(normalisePartnerIds(['p3', 'p1', 'p2'])).toEqual(['p3', 'p1', 'p2']);
  });

  it('accepts an empty list — detaching everything is legal', () => {
    expect(normalisePartnerIds([])).toEqual([]);
  });

  it('treats undefined as absent', () => {
    expect(normalisePartnerIds(undefined)).toEqual([]);
  });

  it('rejects a bare null rather than treating it as "detach all"', () => {
    expect(() => normalisePartnerIds(null)).toThrow(BadInputError);
  });

  it('rejects a non-array', () => {
    expect(() => normalisePartnerIds('p1')).toThrow(BadInputError);
  });

  it('rejects entries that are not usable ids', () => {
    for (const bad of [[''], [null], [5], [{}], [{ id: 5 }]]) {
      expect(() => normalisePartnerIds(bad)).toThrow(BadInputError);
    }
  });
});

// findPartnerGroups is where this task's complexity lives, and integration
// covers only the two happy branches. These four cover the rest — including the
// published-only case, which is a live data-loss path rather than a curiosity.
describe('findPartnerGroups', () => {
  // Returns whatever `pages[status]` holds. `null` means "no home page".
  const stub = (pages) => ({
    documents: () => ({ findFirst: async ({ status }) => pages[status] ?? null }),
  });
  const withGroup = (id) => ({ components: [{ __component: 'shared.partner-group', id }] });

  it('reports no-home-page when neither status has one', async () => {
    expect(await findPartnerGroups(stub({}), 'pdx')).toEqual({ error: 'no-home-page' });
  });

  it('reports no-partner-group when the page has no slot at either status', async () => {
    const pages = { draft: { components: [{ __component: 'shared.hero' }] }, published: null };
    expect(await findPartnerGroups(stub(pages), 'boston')).toEqual({ error: 'no-partner-group' });
  });

  it('reports no-partner-group when only PUBLISHED has a slot', async () => {
    // The data-loss case. Reachable by removing the Partner Group section in
    // the admin panel and saving without publishing. Returning {groups:
    // {published}} here would let the form render a picker with nothing checked
    // while the live site still shows sponsors — and one Save would wipe them.
    const pages = { draft: { components: [] }, published: withGroup(35) };
    expect(await findPartnerGroups(stub(pages), 'aloha-hawaii'))
      .toEqual({ error: 'no-partner-group' });
  });

  it('returns both slots when both statuses have one, keyed by status', async () => {
    const pages = { draft: withGroup(34), published: withGroup(35) };
    expect(await findPartnerGroups(stub(pages), 'aloha-hawaii'))
      .toEqual({ groups: { draft: 34, published: 35 } });
  });

  it('returns the draft slot alone for a never-published page', async () => {
    // The mirror of the case above, and legitimate: writing draft-only is
    // correct when there is no published component to keep in step.
    const pages = { draft: withGroup(34), published: null };
    expect(await findPartnerGroups(stub(pages), 'greater-chicago'))
      .toEqual({ groups: { draft: 34 } });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/partners.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

const { BadInputError } = require('./fields');

/**
 * What the attach/detach picker needs.
 *
 * Partners are global, public-facing records — name, logo and sponsorship level
 * already appear on every microsite that uses them — so there is no PII
 * question here, unlike services/members.js. The whitelist is for shape
 * stability, not secrecy.
 */
const PARTNER_FIELDS = ['documentId', 'name', 'sponsorshipLevel', 'logoUrl'];

function toPartnerRow(partner) {
  return {
    documentId: partner.documentId,
    name: partner.name ?? '',
    sponsorshipLevel: partner.sponsorshipLevel ?? '',
    // `logo` is required:true, but a populate that omits it must not throw.
    logoUrl: partner.logo?.url ?? '',
  };
}

/**
 * Whatever the form sent -> a de-duplicated, ORDER-PRESERVING list of ids.
 *
 * Order matters: `partner_ord` is a real column and the microsite renders by it.
 *
 * Identical contract to normaliseMemberIds, including the explicit null
 * rejection: Strapi treats `partners: null` as "clear", so returning [] for it
 * would detach every sponsor on a malformed request while `'x'` correctly 400s.
 */
function normalisePartnerIds(raw) {
  if (raw === undefined) return [];
  if (raw === null) {
    throw new BadInputError('partners must be a list, or omitted entirely');
  }
  if (!Array.isArray(raw)) {
    throw new BadInputError('partners must be a list');
  }
  const ids = raw.map((entry) => {
    const id = typeof entry === 'string' ? entry : entry?.documentId;
    if (typeof id !== 'string' || id === '') {
      throw new BadInputError('every partner must be identified by a documentId');
    }
    return id;
  });
  return [...new Set(ids)];
}

/**
 * Locate the `shared.partner-group` component on a chapter's home page, at BOTH
 * statuses.
 *
 * Two verified facts make this necessary rather than incidental:
 *
 *  1. Draft and published pages carry DIFFERENT component rows. `aloha-hawaii`'s
 *     draft page holds component 34, its published page component 35. Writing
 *     one leaves the other stale — published is what the public site renders,
 *     draft is what the admin panel shows.
 *  2. Not every chapter has a home page (`pdx` has none), and a page may have
 *     no partner-group slot. Both are ordinary states, not errors to assume away.
 *
 * Returns `{ groups: { draft?: id, published?: id } }` or `{ error }`.
 */
async function findPartnerGroups(strapiInstance, chapterSlug) {
  const groups = {};
  let sawPage = false;

  for (const status of ['draft', 'published']) {
    const page = await strapiInstance.documents('api::page.page').findFirst({
      filters: { slug: 'home', chapter: { slug: chapterSlug } },
      populate: { components: true },
      status,
    });
    if (!page) continue;
    sawPage = true;
    const group = (page.components ?? []).find((c) => c.__component === 'shared.partner-group');
    if (group?.id) groups[status] = group.id;
  }

  if (!sawPage) return { error: 'no-home-page' };

  // The DRAFT slot is required, not merely preferred. It is the editing
  // surface: the picker pre-checks from it, so without it the form would render
  // every box unchecked while the published page still shows sponsors — and one
  // Save would replace them with nothing. Reachable by ordinary CMS use: remove
  // the Partner Group section in the admin panel and save without publishing.
  //
  // The published slot is written when present and skipped when absent (a page
  // that has never been published), which is correct in both directions.
  if (!groups.draft) return { error: 'no-partner-group' };
  return { groups };
}

module.exports = {
  toPartnerRow, normalisePartnerIds, findPartnerGroups, PARTNER_FIELDS,
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/partners.test.js
```

Expected: PASS, **16 tests** — 4 `toPartnerRow`, 7 `normalisePartnerIds`, 5 `findPartnerGroups`.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/partners.js tests/unit/partners.test.js && \
  git commit -m "feat: partner row shaping, id normalisation and partner-group lookup"
```

---

### Task 6: The partners routes

**Files:** Modify `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `grants.js`

- [ ] **Step 1: Add the handlers**

```js
  // --- partners ----------------------------------------------------------
  // Partner records are SHARED and are never written here (CA7): a Partner row
  // appears on every chapter that uses it. This endpoint reads the catalogue
  // and writes the chapter home page's partner-group component relation —
  // which is what the public microsite actually renders. `chapter.partners`
  // exists but has no reader; see the plan's revision note.
  listPartners: guarded(async (ctx) => {
    // Scope-checked even though the catalogue is global: the screen belongs to
    // a chapter, and answering for one the caller cannot administer would leak
    // which chapters exist.
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const rows = await strapi.documents('api::partner.partner').findMany({
      fields: ['name', 'sponsorshipLevel'],
      populate: { logo: { fields: ['url'] } },
      sort: ['name:asc'],
      limit: -1,
      status: 'draft',
    });

    // The chapter's current selection, read off the DRAFT component so it
    // matches what a subsequent save will replace.
    // findPartnerGroups guarantees a draft slot whenever it returns no error,
    // so `attached` is never silently [] while a slot exists somewhere.
    const found = await findPartnerGroups(strapi, chapter.slug);
    let attached = [];
    if (!found.error) {
      const cmp = await strapi.db.query('shared.partner-group').findOne({
        where: { id: found.groups.draft }, populate: { partners: true },
      });
      attached = (cmp?.partners ?? []).map((p) => p.documentId);
    }

    ctx.body = {
      data: rows.map(toPartnerRow),
      meta: { attached, slot: found.error ?? 'ok' },
    };
  }),

  updatePartners: guarded(async (ctx) => {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, input.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const ids = normalisePartnerIds(input.partners);   // BadInputError -> 400

    // Every id must name a real partner. A documentId matching nothing would be
    // silently dropped by the relation write, so the admin would watch a
    // partner vanish with no explanation.
    if (ids.length > 0) {
      const found = await strapi.documents('api::partner.partner').findMany({
        filters: { documentId: { $in: ids } }, fields: ['name'], limit: -1, status: 'draft',
      });
      if (found.length !== ids.length) {
        return ctx.badRequest('One or more selected partners no longer exist');
      }
    }

    const located = await findPartnerGroups(strapi, chapter.slug);
    if (located.error === 'no-home-page') {
      return ctx.notFound('This chapter has no microsite page yet, so there is nowhere to show partners');
    }
    if (located.error === 'no-partner-group') {
      return ctx.notFound("This chapter's page has no partners section");
    }

    // Write BOTH component rows, resolving partner documentIds to entry ids at
    // the MATCHING status — verified: draft components link to draft partner
    // rows (id 61), published components to published rows (id 62). Getting
    // this wrong links to the correct partner in the wrong publication state.
    for (const [status, componentId] of Object.entries(located.groups)) {
      const rows = ids.length
        ? await strapi.documents('api::partner.partner').findMany({
            filters: { documentId: { $in: ids } }, fields: ['name'], limit: -1, status,
          })
        : [];
      const byDoc = new Map(rows.map((r) => [r.documentId, r.id]));
      // Map in the SUBMITTED order — partner_ord follows the write order.
      const entryIds = ids.map((d) => byDoc.get(d)).filter((v) => v !== undefined);

      await strapi.db.query('shared.partner-group').update({
        where: { id: componentId }, data: { partners: entryIds },
      });
    }

    ctx.body = { data: { chapterSlug: chapter.slug, attached: ids.length } };
  }),
```

Add the require:

```js
const {
  toPartnerRow, normalisePartnerIds, findPartnerGroups,
} = require('../services/partners');
```

- [ ] **Step 2: Add the routes and grants**

```js
    { method: 'GET', path: '/chapter-admin/partners', handler: 'chapter-admin.listPartners' },
    { method: 'PUT', path: '/chapter-admin/partners', handler: 'chapter-admin.updatePartners' },
```

```js
  'api::chapter-admin.chapter-admin.listPartners',
  'api::chapter-admin.chapter-admin.updatePartners',
```

- [ ] **Step 3: Verify the wiring**

Two commands, run separately — chaining them with `;` lets a failing grants test
scroll past under Strapi's boot output:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/grants.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: 3 tests pass, `BOOTSTRAP OK`, then `23`.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: partner attach/detach writing the partner-group component"
```

---

### Task 7: Integration-test partners

This suite writes **real chapters' live microsite content**. v1's version restored a `.sort()`ed list, silently reordering sponsors on a page the public sees, and its count-based gate could not detect it. Everything below captures and restores exact order.

**Files:** Create `tests/integration/partners.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, catalogue, groupsA, originalA;

/** Component partner documentIds, IN ORDER, for one status. */
const componentPartners = async (componentId) => {
  const cmp = await strapi.db.query('shared.partner-group').findOne({
    where: { id: componentId }, populate: { partners: true },
  });
  return (cmp?.partners ?? []).map((p) => p.documentId);
};

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `pt-admin-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);

  catalogue = await strapi.documents('api::partner.partner')
    .findMany({ fields: ['name'], limit: 3, sort: ['name:asc'], status: 'draft' });
  if (catalogue.length < 2) throw new Error('fixture setup: need at least two seeded partners');

  const { findPartnerGroups } = await import(
    '../../src/api/chapter-admin/services/partners.js'
  ).then((m) => m.default ?? m).catch(async () => {
    const { createRequire } = await import('node:module');
    return createRequire(import.meta.url)('../../src/api/chapter-admin/services/partners.js');
  });
  const located = await findPartnerGroups(strapi, chapterA.slug);
  if (located.error) throw new Error(`fixture setup: ${chapterA.slug} has no partner-group slot`);
  groupsA = located.groups;

  // Capture the live microsite content, IN ORDER, at both statuses.
  originalA = {};
  for (const [status, id] of Object.entries(groupsA)) {
    originalA[status] = await componentPartners(id);
  }
});

afterAll(async () => {
  try {
    // Restore exactly — order included. NEVER write back a sorted list:
    // partner_ord is real and the microsite renders by it.
    //
    // Its own try/finally: a failed restore must not also leak fixture users.
    try {
    if (groupsA && originalA) {
      for (const [status, id] of Object.entries(groupsA)) {
        const docIds = originalA[status] ?? [];
        const rows = docIds.length
          ? await strapi.documents('api::partner.partner').findMany({
              filters: { documentId: { $in: docIds } }, fields: ['name'], limit: -1, status,
            })
          : [];
        const byDoc = new Map(rows.map((r) => [r.documentId, r.id]));
        await strapi.db.query('shared.partner-group').update({
          where: { id },
          data: { partners: docIds.map((d) => byDoc.get(d)).filter((v) => v !== undefined) },
        });
      }
    }
    } finally {
      const users = await strapi.query('plugin::users-permissions.user')
        .findMany({ where: { email: { $contains: String(RUN) } } });
      for (const u of users) {
        await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
      }
    }
  } finally {
    // Always, even if the restore threw or beforeAll failed part-way.
    await shutdown();
  }
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const attach = (partners) => auth(api().put('/api/chapter-admin/partners'))
  .send({ chapterSlug: chapterA.slug, partners });

describe('GET /api/chapter-admin/partners', () => {
  it('returns the global catalogue with what the picker renders', async () => {
    const res = await auth(api().get(`/api/chapter-admin/partners?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    for (const row of res.body.data) {
      expect(Object.keys(row).sort())
        .toEqual(['documentId', 'logoUrl', 'name', 'sponsorshipLevel']);
    }
  });

  it("reports the chapter's current selection and that the slot exists", async () => {
    const res = await auth(api().get(`/api/chapter-admin/partners?chapterSlug=${chapterA.slug}`));
    expect(res.body.meta.slot).toBe('ok');
    expect(Array.isArray(res.body.meta.attached)).toBe(true);
  });

  it("refuses a chapter the caller does not administer", async () => {
    const res = await auth(api().get(`/api/chapter-admin/partners?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('PUT /api/chapter-admin/partners', () => {
  it('writes the partner-group component the microsite actually renders', async () => {
    const want = [catalogue[0].documentId, catalogue[1].documentId];
    const res = await attach(want);

    expect(res.status).toBe(200);
    expect(res.body.data.attached).toBe(2);
    // Not chapter.partners — the component. This is the whole point of v2.
    expect(await componentPartners(groupsA.draft)).toEqual(want);
  });

  it('writes the PUBLISHED component too, which is what the public site reads', async () => {
    const want = [catalogue[1].documentId, catalogue[0].documentId];
    await attach(want);
    expect(await componentPartners(groupsA.published)).toEqual(want);
  });

  it('links each component to its OWN status\'s partner rows', async () => {
    // Draft components link to draft partner rows, published to published.
    // Linking both to the same row would look right in a documentId read and
    // be wrong in the database.
    await attach([catalogue[0].documentId]);
    const draftRow = await strapi.db.connection('components_shared_partner_groups_partners_lnk')
      .where('partner_group_id', groupsA.draft).first();
    const pubRow = await strapi.db.connection('components_shared_partner_groups_partners_lnk')
      .where('partner_group_id', groupsA.published).first();
    expect(draftRow.partner_id).not.toBe(pubRow.partner_id);

    const draftPartner = await strapi.db.connection('partners').where('id', draftRow.partner_id).first();
    const pubPartner = await strapi.db.connection('partners').where('id', pubRow.partner_id).first();
    expect(draftPartner.published_at).toBeNull();
    expect(pubPartner.published_at).not.toBeNull();
    expect(draftPartner.document_id).toBe(pubPartner.document_id);
  });

  it('PRESERVES the submitted order — partner_ord drives the rendered order', async () => {
    await attach([catalogue[1].documentId, catalogue[0].documentId]);
    expect(await componentPartners(groupsA.draft))
      .toEqual([catalogue[1].documentId, catalogue[0].documentId]);
  });

  it('REPLACES rather than appending', async () => {
    await attach([catalogue[0].documentId, catalogue[1].documentId]);
    await attach([catalogue[0].documentId]);
    expect(await componentPartners(groupsA.draft)).toEqual([catalogue[0].documentId]);
  });

  it('detaches everything when sent an empty list', async () => {
    await attach([]);
    expect(await componentPartners(groupsA.draft)).toEqual([]);
  });

  it('targets exactly the components on THIS chapter\'s home page', async () => {
    // Derived independently of findPartnerGroups — deriving `others` from
    // groupsA would make the function its own oracle, and a widened lookup
    // would move both sides together. (Verified: dropping the chapter filter
    // left the old version of this test passing.)
    const mine = await strapi.db.connection('pages_cmps as z')
      .join('pages as p', 'p.id', 'z.entity_id')
      .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
      .join('chapters as c', 'c.id', 'l.chapter_id')
      .where('z.component_type', 'shared.partner-group')
      .andWhere('p.slug', 'home')
      .andWhere('c.document_id', chapterA.documentId)
      .select('z.cmp_id');
    expect(new Set(Object.values(groupsA)))
      .toEqual(new Set(mine.map((r) => r.cmp_id)));
  });

  it('never touches a component on another page', async () => {
    const others = await strapi.db.connection('pages_cmps')
      .where('component_type', 'shared.partner-group')
      .whereNotIn('cmp_id', Object.values(groupsA)).select('cmp_id');
    expect(others.length).toBeGreaterThan(0);   // 32/33 sit on national pages
    const before = {};
    for (const { cmp_id } of others) before[cmp_id] = await componentPartners(cmp_id);

    await attach([catalogue[0].documentId]);

    for (const { cmp_id } of others) {
      expect(await componentPartners(cmp_id)).toEqual(before[cmp_id]);
    }
  });

  it('400s on a partner documentId that does not exist', async () => {
    const res = await attach(['nosuchpartner000000000000']);
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/no longer exist/i);
  });

  it('400s on a malformed payload rather than 500ing', async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: 'nope' });
    expect(res.status).toBe(400);
  });

  it('400s on partners:null rather than silently detaching everything', async () => {
    const res = await attach(null);
    expect(res.status).toBe(400);
  });

  it("refuses another chapter", async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterB.slug, partners: [] });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('404s a chapter with no home page, rather than failing obscurely', async () => {
    // `pdx` has none. Give the admin a real reason.
    const noPage = await strapi.documents('api::chapter.chapter')
      .findFirst({ filters: { slug: 'pdx' }, fields: ['slug'], status: 'draft' });
    // Asserted, not skipped: `pdx` has no home page today, and if the seed
    // changes this test must fail loudly rather than silently pass.
    expect(noPage).toBeTruthy();
    const admin = await makeChapterAdmin(strapi, {
      email: `pt-nopage-${RUN}@areaa.test`, chapterIds: [noPage.id],
    });
    const token = await jwtFor(strapi, admin.id);
    const res = await api().put('/api/chapter-admin/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({ chapterSlug: 'pdx', partners: [] });
    expect(res.status).toBe(404);
    expect(res.body.error?.message ?? '').toMatch(/no microsite page/i);
  });

  it('never writes the Partner record itself', async () => {
    // CA7: partners are shared. This asserts the OUTCOME, not the mechanism —
    // v1's version could not fail, because the payload shape it sent was
    // stripped before the write regardless.
    const before = await strapi.db.connection('partners')
      .where('document_id', catalogue[0].documentId).select('id', 'name');

    await auth(api().put('/api/chapter-admin/partners')).send({
      chapterSlug: chapterA.slug,
      partners: [{ documentId: catalogue[0].documentId, name: 'Renamed By Chapter' }],
    });

    const after = await strapi.db.connection('partners')
      .where('document_id', catalogue[0].documentId).select('id', 'name');
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run them, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/partners.test.js && \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **17 tests**, then **175 across 15 files** — 122 from plans 1–3, plus 7 getOne, 4 list-scoping, 9 single-record, 16 partners unit, 17 partners integration. (The first two land inside the existing `factory-hooks.test.js`, so the file count rises by 3, not 5.)

- [ ] **Step 3: Prove the live microsite content is byte-identical**

A count gate cannot see reordering. Compare the actual ordered lists:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT partner_group_id, group_concat(partner_id, ',') FROM (SELECT * FROM components_shared_partner_groups_partners_lnk ORDER BY partner_group_id, partner_ord) GROUP BY partner_group_id;" > /tmp/pg-before.txt && \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/partners.test.js > /dev/null && \
  sqlite3 .tmp/data.db "SELECT partner_group_id, group_concat(partner_id, ',') FROM (SELECT * FROM components_shared_partner_groups_partners_lnk ORDER BY partner_group_id, partner_ord) GROUP BY partner_group_id;" > /tmp/pg-after.txt && \
  diff /tmp/pg-before.txt /tmp/pg-after.txt && echo "IDENTICAL — order preserved" || echo "MICROSITE CONTENT CHANGED — fix the restore before continuing"
```

Expected: `IDENTICAL — order preserved`.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/partners.test.js && \
  git commit -m "test: partner catalogue, component targeting and the shared-record invariant"
```

---

## Chunk 3: Split the client

### Task 8: `src/lib/chapter-admin.ts` becomes a directory

303 lines holding transport, error shaping and six resource clients. This plan's single-record work touches every getter, so the split happens now.

**The rule: no import site changes.** Every existing `from "../../lib/chapter-admin"` keeps working via `index.ts`. Verified empirically: the split typechecks at 0 errors, with all 23 distinct symbols across 18 import statements resolving.

**Files:** Create `src/lib/chapter-admin/`; delete `src/lib/chapter-admin.ts`; modify `events/[documentId].astro`

- [ ] **Step 1: Create `client.ts`**

Move `STRAPI_URL`, `call`, `messageOf`, `Pagination`, `EMPTY_PAGINATION` verbatim, exporting all of them.

- [ ] **Step 2: One module per resource**

Move each group verbatim into `events.ts`, `committees.ts`, `news.ts`, `chapter.ts`, `submissions.ts`, `members.ts`, `media.ts`, each importing from `./client`. Keep every interface with its resource.

Three getters change, retiring the fetch-and-find hack:

```ts
// events.ts / committees.ts / news.ts — same shape in each
export async function getEvent(
    jwt: string, documentId: string, chapterSlug: string
): Promise<AdminEvent | null> {
    // Was: fetch a page of 100 and .find() it, which silently stopped working
    // past the 100th record. The route scope-checks and 404s a record from
    // another chapter, so that check is now server-side.
    const { status, body } = await call(
        jwt, `/events/${documentId}?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && body?.data ? body.data : null;
}
```

And the two factory-backed lists gain the optional slug:

```ts
export async function listCommittees(
    jwt: string, chapterSlug?: string
): Promise<AdminCommittee[] | null> {
    const q = chapterSlug ? `&chapterSlug=${encodeURIComponent(chapterSlug)}` : "";
    const { status, body } = await call(jwt, `/committees?pageSize=100${q}`);
    return status === 200 && body?.data ? body.data : null;
}

export async function listNews(
    jwt: string, { page = 1, pageSize = 25, chapterSlug = "" } = {}
): Promise<{ ok: true; items: AdminNewsItem[]; pagination: Pagination } | { ok: false; status: number }> {
    const q = chapterSlug ? `&chapterSlug=${encodeURIComponent(chapterSlug)}` : "";
    const { status, body } = await call(jwt, `/news?page=${page}&pageSize=${pageSize}${q}`);
    if (status !== 200 || !body?.data) return { ok: false, status };
    return { ok: true, items: body.data, pagination: body.meta?.pagination ?? EMPTY_PAGINATION };
}

export async function listEvents(
    jwt: string, { page = 1, pageSize = 25, chapterSlug = "" } = {}
): Promise<ListResult> {
    const q = chapterSlug ? `&chapterSlug=${encodeURIComponent(chapterSlug)}` : "";
    const { status, body } = await call(jwt, `/events?page=${page}&pageSize=${pageSize}${q}`);
    if (status !== 200 || !body?.data) return { ok: false, status };
    return { ok: true, events: body.data, pagination: body.meta?.pagination ?? EMPTY_PAGINATION };
}
```

- [ ] **Step 3: `partners.ts`**

```ts
import { call } from "./client";

export interface AdminPartner {
    documentId: string;
    name: string;
    sponsorshipLevel: string;
    logoUrl: string;
}

export interface PartnerCatalogue {
    partners: AdminPartner[];
    /** documentIds currently on the chapter's partner-group slot. */
    attached: string[];
    /** 'ok' | 'no-home-page' | 'no-partner-group' */
    slot: string;
}

/**
 * Catalogue AND current selection in one call.
 *
 * Returns null on failure, never a soft empty — a soft `[]` for `attached`
 * renders every checkbox unchecked, and combined with the picker's presence
 * marker a save would then detach every sponsor.
 */
export async function listPartners(
    jwt: string, chapterSlug: string
): Promise<PartnerCatalogue | null> {
    const { status, body } = await call(
        jwt, `/partners?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    if (status !== 200 || !Array.isArray(body?.data) || !Array.isArray(body?.meta?.attached)) {
        return null;
    }
    return { partners: body.data, attached: body.meta.attached, slot: body.meta.slot ?? "ok" };
}

export async function savePartners(
    jwt: string, chapterSlug: string, partners: string[]
): Promise<{ ok: boolean; status: number }> {
    const { status, body } = await call(jwt, "/partners", {
        method: "PUT", body: JSON.stringify({ chapterSlug, partners }),
    });
    return { ok: status === 200 && Boolean(body?.data), status };
}
```

One call, not two: the catalogue and the current selection arrive together, so there is no state where one loaded and the other did not — which is the condition that makes an accidental detach possible.

- [ ] **Step 4: `index.ts` re-exports everything**

```ts
// Re-export so every existing `from "../lib/chapter-admin"` keeps working.
// If adding a resource here means editing a page, the split has gone wrong.
export * from "./client";
export * from "./events";
export * from "./committees";
export * from "./news";
export * from "./chapter";
export * from "./members";
export * from "./submissions";
export * from "./partners";
export * from "./media";
```

- [ ] **Step 5: Fix the one call site the split breaks**

`getEvent` gains a required third argument. Fix it **here**, in the same task, so the chunk ends green — v1 deferred this to Task 10 and left two commits with a red typecheck:

```diff
 // events/[documentId].astro
-const event = await getEvent(jwt, documentId!);
+const event = await getEvent(jwt, documentId!, chapter.slug);
```

- [ ] **Step 6: Delete the old file and verify**

Run the two gates **separately** — `&&` short-circuits, so a typecheck failure would hide whether the tests ran at all:

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && rm src/lib/chapter-admin.ts && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: **0 errors**, then **54 passed**. Any error naming a file other than the ones this task touched means `index.ts` is missing an export.

- [ ] **Step 7: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add -A src/lib/ "src/pages/account/chapter/[chapterSlug]/events/[documentId].astro" && \
  git commit -m "refactor: split the chapter-admin client into one module per resource"
```

---

## Chunk 4: Partners UI

### Task 9: Payload mapping, the form, the route and the screen

**Files:** Create `src/lib/partners-form.ts`, `tests/unit/partners-form.test.ts`, `src/components/PartnersForm.astro`, `tests/unit/partners-form-render.test.ts`, `src/pages/api/chapter-admin/partner.ts`, `src/pages/account/chapter/[chapterSlug]/partners.astro`

- [ ] **Step 1: Write the failing payload test**

```ts
import { describe, it, expect } from "vitest";
import { toPartnersPayload } from "../../src/lib/partners-form";

const form = (entries: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) {
        if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
        else fd.set(k, v);
    }
    return fd;
};

describe("toPartnersPayload", () => {
    it("collects every checked partner, in order", () => {
        expect(toPartnersPayload(form({ partners: ["p2", "p1"], partners__present: "1" })))
            .toEqual(["p2", "p1"]);
    });

    it("returns an EMPTY array when the picker was shown and nothing checked", () => {
        expect(toPartnersPayload(form({ partners__present: "1" }))).toEqual([]);
    });

    it("returns null when the picker was NOT on the form", () => {
        // null tells the route to skip the write entirely, rather than sending
        // [] and detaching every sponsor.
        expect(toPartnersPayload(form({}))).toBeNull();
    });

    it("de-duplicates", () => {
        expect(toPartnersPayload(form({ partners: ["p1", "p1"], partners__present: "1" })))
            .toEqual(["p1"]);
    });

    it("drops empty values", () => {
        expect(toPartnersPayload(form({ partners: ["p1", ""], partners__present: "1" })))
            .toEqual(["p1"]);
    });
});
```

- [ ] **Step 2: Implement the mapper**

```ts
/**
 * FormData -> the partner documentId list, or null when the picker was absent.
 *
 * Same presence-marker contract as the committee member picker: an all-
 * unchecked checkbox list posts no keys, so without `partners__present` the
 * route cannot tell "detach everything" from "this form had no picker" — and
 * sending [] for the second case would silently drop every sponsor.
 *
 * Order is preserved: partner_ord drives the order the microsite renders.
 */
export function toPartnersPayload(fd: FormData): string[] | null {
    if (fd.get("partners__present") === null) return null;
    const ids = fd.getAll("partners").map((p) => String(p)).filter(Boolean);
    return [...new Set(ids)];
}
```

- [ ] **Step 3: Write the failing render test**

This is the guard v1 lacked. `MultiSelect` emits its presence marker whenever it renders options, so **the form must not render the picker unless it knows the current selection** — otherwise every box shows unchecked and a save detaches everything. The same shape closed for committee members in plan 3.

```ts
import { describe, it, expect } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import PartnersForm from "../../src/components/PartnersForm.astro";

const CATALOGUE = {
    partners: [
        { documentId: "p1", name: "Chase", sponsorshipLevel: "Gold", logoUrl: "/a.png" },
        { documentId: "p2", name: "Citi", sponsorshipLevel: "Silver", logoUrl: "/b.png" },
    ],
    attached: ["p2"],
    slot: "ok",
};

const render = async (props: Record<string, unknown>) => {
    const container = await AstroContainer.create();
    return container.renderToString(PartnersForm, { props: { chapterSlug: "boston", ...props } });
};

describe("PartnersForm", () => {
    it("renders the picker with the current selection pre-checked", async () => {
        const html = await render({ catalogue: CATALOGUE });
        expect(html.match(/type="checkbox"/g)).toHaveLength(2);
        expect(html.match(/\schecked[\s>]/g)).toHaveLength(1);
        expect(html).toContain('name="partners__present"');
        expect(html).toContain("Save Partners");
    });

    it("renders NO picker and NO save button when the catalogue failed to load", async () => {
        // With a picker rendered here, the presence marker would post and the
        // save would replace the real selection with nothing.
        const html = await render({ catalogue: null });
        expect(html).not.toContain("__present");
        expect(html).not.toContain("<input type=\"checkbox\"");
        expect(html).not.toContain("Save Partners");
    });

    it("explains, without a save button, when the chapter has no page or slot", async () => {
        for (const slot of ["no-home-page", "no-partner-group"]) {
            const html = await render({ catalogue: { ...CATALOGUE, slot } });
            expect(html).not.toContain("__present");
            expect(html).not.toContain("Save Partners");
        }
    });

    it("explains, without a save button, when no partners exist nationally", async () => {
        // v1 rendered a Save button here that could only ever fail, with a
        // message claiming the list had not loaded.
        const html = await render({ catalogue: { partners: [], attached: [], slot: "ok" } });
        expect(html).not.toContain("Save Partners");
        expect(html).toContain("no partners");
    });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/partners-form-render.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: The component**

```astro
---
import MultiSelect from "./MultiSelect.astro";
import type { PartnerCatalogue } from "../lib/chapter-admin";

interface Props {
    chapterSlug: string;
    /** null means the catalogue OR the current selection could not be read. */
    catalogue: PartnerCatalogue | null;
    error?: string | null;
}

const { chapterSlug, catalogue, error = null } = Astro.props;

const messages: Record<string, string> = {
    forbidden: "You don't have permission to change this chapter's partners.",
    missing: "The partner list didn't load, so nothing was changed. Please refresh.",
    stale: "One of those partners has since been removed nationally. Refresh and try again.",
    save: "Something went wrong saving. Please try again.",
};
const errorMessage = error ? (messages[error] ?? messages.save) : null;

const slotMessages: Record<string, string> = {
    "no-home-page": "This chapter doesn't have a microsite page yet, so there's nowhere to show partners. Contact national to have one set up.",
    "no-partner-group": "This chapter's page doesn't have a partners section. Contact national to have one added.",
};

// The picker renders ONLY when we know both the candidates and the current
// selection. Rendering it otherwise emits the presence marker, and a save would
// then replace the real selection with whatever happened to be checked.
const canEdit = catalogue !== null && catalogue.slot === "ok" && catalogue.partners.length > 0;

const options = (catalogue?.partners ?? []).map((p) => ({
    value: p.documentId,
    label: p.name,
    hint: p.sponsorshipLevel || undefined,
}));
---

<form class="pform" method="post" action="/api/chapter-admin/partner" novalidate>
    <input type="hidden" name="chapterSlug" value={chapterSlug} />

    {errorMessage && <p class="pform__error" role="alert">{errorMessage}</p>}

    {catalogue === null && (
        <p class="pform__error" role="alert">
            Couldn't load the partner list. Refresh to try again — nothing has changed.
        </p>
    )}

    {catalogue !== null && catalogue.slot !== "ok" && (
        <p class="pform__note">{slotMessages[catalogue.slot] ?? slotMessages["no-partner-group"]}</p>
    )}

    {catalogue !== null && catalogue.slot === "ok" && catalogue.partners.length === 0 && (
        <p class="pform__note">
            There are no partners set up nationally yet, so there is nothing to choose from.
        </p>
    )}

    {canEdit && (
        <>
            <MultiSelect
                legend="Partners on your microsite"
                name="partners"
                options={options}
                selected={catalogue!.attached}
                helper="Partner details are managed nationally — you choose which appear on your chapter's page, and in what order. Unchecking everything removes them all."
            />
            <div class="pform__actions">
                <button type="submit" class="btn btn--primary">Save Partners</button>
            </div>
        </>
    )}
</form>

<style>
    .pform { display: flex; flex-direction: column; gap: var(--space-600); max-width: 640px; }
    .pform__error, .pform__note {
        margin: 0; padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body); font-size: 16px;
    }
    .pform__actions { display: flex; gap: var(--space-400); }
</style>
```

- [ ] **Step 6: The route** (`partner.ts`, singular — matching `event.ts`, `committee.ts`, `news.ts`)

```ts
import type { APIRoute } from "astro";
import { beginChapterAdminPost } from "../../../lib/form-route";
import { toPartnersPayload } from "../../../lib/partners-form";
import { savePartners } from "../../../lib/chapter-admin";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
    const begun = await beginChapterAdminPost(ctx, "partners");
    if (begun instanceof Response) return begun;
    const { jwt, form, chapterSlug, base, back } = begun;

    // `settings`-style section: `base` IS the page path, and `editPath` is
    // meaningless here — do not use it.
    const partners = toPartnersPayload(form);
    // null means the picker never rendered. Do NOT send [] and detach the lot.
    if (partners === null) return back(base, "error=missing");

    const result = await savePartners(jwt, chapterSlug, partners);
    if (!result.ok) {
        if (result.status === 403) return back(base, "error=forbidden");
        // 400 is the deliberate "a partner was removed nationally" case —
        // collapsing it into a generic retry invites an infinite loop.
        if (result.status === 400) return back(base, "error=stale");
        return back(base, "error=save");
    }
    return back(base, "saved=1");
};
```

- [ ] **Step 7: The page** (four levels up, matching `settings.astro`)

```astro
---
import ChapterAdminLayout from "../../../../layouts/ChapterAdminLayout.astro";
import PartnersForm from "../../../../components/PartnersForm.astro";
import { SESSION_COOKIE } from "../../../../lib/auth";
import { listPartners } from "../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
// One call: candidates and current selection arrive together, so there is no
// state where one loaded and the other did not.
const catalogue = await listPartners(jwt, chapter.slug);

const sp = Astro.url.searchParams;
const flash = sp.get("saved") ? "Partners saved." : null;
const error = sp.get("error");
---

<ChapterAdminLayout
    title={`Partners | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="partners"
>
    <h1 class="ppage__title">Partners</h1>
    {flash && <p class="ppage__flash" role="status">{flash}</p>}

    <PartnersForm chapterSlug={chapter.slug} catalogue={catalogue} error={error} />
</ChapterAdminLayout>

<style>
    .ppage__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    .ppage__flash {
        margin: 0 0 var(--space-600); padding: var(--space-300) var(--space-400);
        border-radius: var(--radius-100); font-family: var(--font-family-body);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        background-color: var(--primitive-brand-50); color: var(--primitive-brand-700);
    }
    @media (max-width: 768px) { .ppage__title { font-size: 36px; } }
</style>
```

- [ ] **Step 8: Nav entry**

In `ChapterAdminLayout.astro`, between Committees and Submissions:

```js
    { key: "partners", label: "Partners", href: `/account/chapter/${chapterSlug}/partners` },
```

And replace the comment above `NAV` (lines 15–17), which still says partners
"arrive in plan 4" and puts `/page` in the same sentence — `/page` is plan 5:

```diff
 // Chapter-scoped navigation. Listed here rather than in lib/account.ts because
-// this nav belongs to a chapter, not to the member. /page and /partners arrive
-// in plan 4.
+// this nav belongs to a chapter, not to the member. /page arrives in plan 5.
```

- [ ] **Step 9: Verify and commit**

Separate gates, not `&&`:

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: **0 errors**, then **63 passed** (54 + 5 + 4).

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/partners-form.ts tests/unit/partners-form.test.ts \
          src/components/PartnersForm.astro tests/unit/partners-form-render.test.ts \
          src/pages/api/chapter-admin/partner.ts \
          "src/pages/account/chapter/[chapterSlug]/partners.astro" \
          src/layouts/ChapterAdminLayout.astro && \
  git commit -m "feat: partner attach/detach screen"
```

---

## Chunk 5: Retire the client-side filters, and explain a bounce

### Task 10: Pages use the server-side scoping

Three list pages filter after the fact — and the events list does not filter at all, which from **Task 8** (when the client starts calling the single-record route) leaves rows that redirect to an error the page cannot render.

**Files:** Modify the committee, news and **events** list pages

- [ ] **Step 1: Committee list**

The existing three-line comment above `rows` explains the client-side filter and
must go with it — the hunk below includes it, so apply the whole span:

```diff
-const all = await listCommittees(jwt);
+const all = await listCommittees(jwt, chapter.slug);
 const failed = all === null;
-// The API scopes to every chapter the caller administers; this page is scoped
-// to one. Reaching another chapter's edit page by URL is guarded separately, in
-// getCommittee — with an empty member selection such a save succeeds and
-// silently clears that chapter's roster.
-const rows = (all ?? []).filter((c) => c.chapter?.slug === chapter.slug);
+// Scoped server-side by chapterSlug. Cross-chapter edit URLs are guarded in
+// getCommittee, which 404s a record from another chapter.
+const rows = all ?? [];
```

The two-branch empty state collapses to one, because `rows` and `all` are now the same set:

```diff
-    {!failed && rows.length === 0 && (all ?? []).length === 0 && ( … )}
-    {!failed && rows.length === 0 && (all ?? []).length > 0 && ( … )}
+    {!failed && rows.length === 0 && (
+        <p class="clist__empty">No committees yet. <a href={`${base}/new`}>Create the first one.</a></p>
+    )}
```

- [ ] **Step 2: News list**

```diff
-const result = await listNews(jwt, { page });
+const result = await listNews(jwt, { page, chapterSlug: chapter.slug });
 const failed = !result.ok;
-const items = result.ok ? result.items.filter((n) => n.chapter?.slug === chapter.slug) : [];
+const items = result.ok ? result.items : [];
```

**Keep both empty-state branches**, and update the second's wording and its comment. Scoping fixes *which chapter*, not *which page*: `?page=99` from a stale bookmark, or a deletion that shrinks `pageCount`, still yields zero items with `total > 0`. Collapsing them would print "No articles yet. Write the first one." above a pagination nav listing real pages.

**Replace the comment above these branches too** — it currently justifies them with "the filter runs after", which stops being true here. The next reader would otherwise delete the branch this step just argued to keep:

```astro
    {/*
      Two branches, deliberately. Scoping is server-side now, so `total`
      describes THIS chapter — but it still describes the whole chapter, not
      the current page. `?page=99` from a stale bookmark, or a deletion that
      shrinks pageCount, yields zero items with total > 0, and a single
      "No articles yet" branch would print it above a nav listing real pages.
    */}
    {!failed && pagination.total === 0 && (
        <p class="nlist__empty">No articles yet. <a href={`${base}/new`}>Write the first one.</a></p>
    )}
    {!failed && pagination.total > 0 && items.length === 0 && (
        <p class="nlist__empty">
            No articles on this page.
            {page > 1 && <> <a href={base}>Back to the first page.</a></>}
        </p>
    )}
```

The committee page has no pagination, so collapsing **is** right there. The two pages are not symmetric.

- [ ] **Step 3: Events list — scoping AND an error map**

`events/index.astro` never filtered, so a multi-chapter admin sees other chapters' events. From **Task 8** those rows redirect with `error=missing`, and this page has no `errorMessages` — so clicking one would do nothing visible.

```diff
-const result = await listEvents(jwt, { page });
+const result = await listEvents(jwt, { page, chapterSlug: chapter.slug });
```

Add the map alongside the existing flash handling, mirroring the committee page:

```ts
const errorMessages: Record<string, string> = {
    missing: "That event could not be found.",
    forbidden: "You don't have permission to change that event.",
    delete: "That event couldn't be deleted. Please try again.",
    save: "Something went wrong. Please try again.",
};
const errorParam = sp.get("error");
const errorMessage = errorParam ? (errorMessages[errorParam] ?? errorMessages.save) : null;
```

```astro
    {errorMessage && <p class="evlist__error" role="alert">{errorMessage}</p>}
```

Do the same for the chapter overview (`[chapterSlug]/index.astro`), whose "total events" count currently spans every administered chapter:

```diff
-const result = await listEvents(jwt, { pageSize: 5 });
+const result = await listEvents(jwt, { pageSize: 5, chapterSlug: chapter.slug });
```

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: 0 errors, 63 passed.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add "src/pages/account/chapter/[chapterSlug]/" && \
  git commit -m "refactor: pages use server-side chapter scoping"
```

---

### Task 11: `/account` explains a bounce

Twelve page guards plus `form-route.ts` and `middleware.ts` redirect to `/account?error=not-chapter-admin`, and the page renders nothing.

**Files:** Modify `src/pages/account/index.astro`

- [ ] **Step 1: Render the message**

Frontmatter — the file's own BEM namespace is `welcome__*`, so match it:

```ts
const errorMessages: Record<string, string> = {
    "not-chapter-admin": "You don't have access to that chapter's admin area.",
};
const errorParam = Astro.url.searchParams.get("error");
const errorMessage = errorParam ? (errorMessages[errorParam] ?? null) : null;
```

Before the `welcome` block:

```astro
{errorMessage && <p class="welcome__error" role="alert">{errorMessage}</p>}
```

```css
    .welcome__error {
        margin: 0 0 var(--space-600);
        padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body);
    }
```

Unknown codes render nothing rather than a generic fallback — `/account` is a normal destination and should not accuse the user of an error it cannot name.

- [ ] **Step 2: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/pages/account/index.astro && \
  git commit -m "feat: /account explains a chapter-admin bounce"
```

Expected: 0 errors.

---

## Chunk 6: Verification

### Task 12: Both suites, twice, with no drift

- [ ] **Step 1: Run them**

Separate gates, not `&&`:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **175 CMS**, **63 frontend**, 0 typecheck errors. The `cd` on the first
line is load-bearing: the preceding task leaves the shell in the frontend repo,
so without it this gate silently runs the frontend suite and reports 63.

- [ ] **Step 2: Twice, with no row growth AND no reordering**

A count gate cannot see a reordered sponsor list, which is what v1's did wrong.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  snapshot() { sqlite3 .tmp/data.db "SELECT (SELECT COUNT(*) FROM up_users) u, (SELECT COUNT(DISTINCT document_id) FROM committees) c, (SELECT COUNT(DISTINCT document_id) FROM news_items) n, (SELECT COUNT(DISTINCT document_id) FROM events) e, (SELECT COUNT(*) FROM files) f;" ; \
    sqlite3 .tmp/data.db "SELECT partner_group_id, group_concat(partner_id, ',') FROM (SELECT * FROM components_shared_partner_groups_partners_lnk ORDER BY partner_group_id, partner_ord) GROUP BY partner_group_id;" ; } && \
  snapshot > /tmp/p4-before.txt && \
  PATH="/opt/homebrew/bin:$PATH" npm test > /dev/null && \
  snapshot > /tmp/p4-after.txt && \
  diff /tmp/p4-before.txt /tmp/p4-after.txt && echo "IDENTICAL" || echo "DRIFT — do not proceed"
```

Expected: `IDENTICAL`.

---

### Task 13: Prove it in a browser

- [ ] **Step 1: Create a two-chapter admin, and pick chapters that can exercise it**

Several behaviours only differ for a caller administering more than one chapter, and `chapadmin` administers one. **The chapters must be chosen, not assumed**: the walkthrough needs each to hold at least one committee and one news item, and `boston` currently has zero news.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node -e "
const { createStrapi, compileStrapi } = require('@strapi/strapi');
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';
  const role = await app.query('plugin::users-permissions.role').findOne({ where: { type: 'chapter_admin' } });
  const chapters = await app.documents('api::chapter.chapter').findMany({ fields: ['slug'], limit: -1, status: 'draft' });

  // Report what each chapter actually holds, so the walkthrough uses chapters
  // that can exercise it rather than whichever two sort first.
  for (const c of chapters) {
    const [cm, nw, pg] = await Promise.all([
      app.documents('api::committee.committee').count({ filters: { chapter: { slug: c.slug } }, status: 'draft' }),
      app.documents('api::news-item.news-item').count({ filters: { chapter: { slug: c.slug } }, status: 'draft' }),
      app.documents('api::page.page').findFirst({ filters: { slug: 'home', chapter: { slug: c.slug } }, status: 'draft' }),
    ]);
    console.log(\`  \${c.slug}: committees=\${cm} news=\${nw} homePage=\${pg ? 'yes' : 'NO'}\`);
  }

  const usable = [];
  for (const c of chapters) {
    const cm = await app.documents('api::committee.committee').count({ filters: { chapter: { slug: c.slug } }, status: 'draft' });
    const nw = await app.documents('api::news-item.news-item').count({ filters: { chapter: { slug: c.slug } }, status: 'draft' });
    if (cm > 0 && nw > 0) usable.push(c);
  }
  if (usable.length < 2) {
    console.log('\nWARNING: fewer than two chapters hold BOTH a committee and a news item.');
    console.log('Rows 11-12 need one of each in each chapter — create them, or skip those rows and say so.');
  }
  const picked = (usable.length >= 2 ? usable : chapters).slice(0, 2);

  const email = 'twochapter@areaa.test';
  let user = await app.query('plugin::users-permissions.user').findOne({ where: { email } });
  if (!user) {
    user = await app.plugin('users-permissions').service('user').add({
      username: email, email, password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Two', lastName: 'Chapter', role: role.id,
      administeredChapters: picked.map((c) => c.id),
    });
  } else {
    // Re-assert rather than skip: a leftover account from an earlier attempt
    // may administer different chapters, or none, and the log would still look
    // fine while the walkthrough silently tested nothing.
    await app.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      // provider/confirmed/password too, not just role and scope: a leftover
      // account from an aborted run may have been created without `provider`,
      // and Precondition 5 says it then cannot log in — Step 5 would stall with
      // no visible reason why.
      data: {
        role: role.id, administeredChapters: picked.map((c) => c.id),
        provider: 'local', confirmed: true, blocked: false,
      },
    });
  }
  console.log('\ntwochapter@areaa.test now administers:', picked.map((c) => c.slug).join(', '));
  await app.destroy(); process.exit(0);
})();
"
```

Use the two slugs it prints as **A** and **B** below.

- [ ] **Step 2: Snapshot the live microsite content before touching it**

Rows 2–3 rewrite a real chapter's sponsor list. `git status` cannot see this — `.tmp/data.db` is untracked.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT partner_group_id, group_concat(partner_id, ',') FROM (SELECT * FROM components_shared_partner_groups_partners_lnk ORDER BY partner_group_id, partner_ord) GROUP BY partner_group_id;" > /tmp/p4-walk-before.txt && \
  cat /tmp/p4-walk-before.txt
```

**Also snapshot the partner _names_.** The picker shows names and never entry
ids, so an id-only snapshot is unusable if a human ever has to restore by hand:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT l.partner_group_id, l.partner_ord, l.partner_id, p.name FROM components_shared_partner_groups_partners_lnk l JOIN partners p ON p.id = l.partner_id ORDER BY l.partner_group_id, l.partner_ord;" > /tmp/p4-walk-names.txt && \
  cat /tmp/p4-walk-names.txt
```

- [ ] **Step 3: Start both servers**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop &
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run dev &
```

Note the port Astro reports.

- [ ] **Step 4: Walk it as `chapadmin@areaa.test` / `Password123!`**

| # | Action | Expected |
|---|---|---|
| 1 | Sidebar | Overview, Events, News, Committees, **Partners**, Submissions, Settings |
| 2 | Partners → check two, in a deliberate order → Save | "Partners saved."; both checked on reload, **in that order** |
| 3 | **Visit the chapter's public microsite** | The partner grid shows exactly those two, in that order — this is the claim v1 could not make |
| 4 | **Uncheck everything** → Save → reload the microsite | Grid empty |
| 5 | Re-check one → Save | Grid shows one |
| 6 | Open a committee, edit, Save | Still works — the client split changed nothing visible |
| 7 | Open an event, edit, Save | Still works, via the new single-record route |
| 8 | Disable JavaScript, repeat 2 and 4 | Everything still works |

- [ ] **Step 5: The multi-chapter cases, as `twochapter@areaa.test`**

These are what `chapadmin` cannot exercise.

| # | Action | Expected |
|---|---|---|
| 9 | `/account` | **Two** entries under Chapter Admin |
| 10 | Chapter A → Committees, then Chapter B → Committees | Each shows only its own; counts match the rows |
| 11 | Copy a committee id from B, open it under **A's** URL | Redirected to A's list with "That committee could not be found." — **not** an editable form |
| 12 | Same for a news item, and for an event | Same, including a visible message on the events list |

Row 11 is the important one: the cross-chapter edit screen that made a silent roster wipe reachable, now closed server-side.

- [ ] **Step 6: A member who administers nothing**

Sign in as `plainmember@areaa.test`, visit `/account/chapter/<A>/partners`.

Expected: redirected to `/account`, **and the page says** "You don't have access to that chapter's admin area." — previously it said nothing.

- [ ] **Step 7: Attacks by hand**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
JWT=$(curl -s -X POST http://localhost:1337/api/auth/local -H "Content-Type: application/json" \
  -d '{"identifier":"chapadmin@areaa.test","password":"Password123!"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['jwt'])") && \
PARTNER=$(sqlite3 .tmp/data.db "SELECT document_id FROM partners WHERE published_at IS NULL LIMIT 1;") && \
echo "--- partners:null (expect 400, not a silent detach) ---" && \
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:1337/api/chapter-admin/partners \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"chapterSlug":"aloha-hawaii","partners":null}' && \
echo "--- unknown partner id (expect 400) ---" && \
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:1337/api/chapter-admin/partners \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"chapterSlug":"aloha-hawaii","partners":["nosuchpartner000000000000"]}' && \
echo "--- rename smuggle (expect the name UNCHANGED) ---" && \
echo -n "  before: " && sqlite3 .tmp/data.db "SELECT DISTINCT name FROM partners WHERE document_id='$PARTNER';" && \
curl -s -o /dev/null -X PUT http://localhost:1337/api/chapter-admin/partners \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"chapterSlug\":\"aloha-hawaii\",\"partners\":[{\"documentId\":\"$PARTNER\",\"name\":\"Hacked\"}]}" && \
echo -n "  after:  " && sqlite3 .tmp/data.db "SELECT DISTINCT name FROM partners WHERE document_id='$PARTNER';" && \
echo "--- another chapter's partners (expect 403) ---" && \
FOREIGN=$(sqlite3 .tmp/data.db "SELECT slug FROM chapters WHERE slug != 'aloha-hawaii' LIMIT 1;") && \
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:1337/api/chapter-admin/partners \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"chapterSlug\":\"$FOREIGN\",\"partners\":[]}"
```

Expected: `400`, `400`, an unchanged partner name, `403`.

- [ ] **Step 8: Restore the microsite, then stop the servers**

Rows 2, 4 and 5 deliberately end with **one** partner attached where
`aloha-hawaii` started with two, so "restore through the UI if the diff is
non-empty" was both guaranteed to trigger and impossible to do after `pkill`.
Script it, reusing the shape of Task 7's `afterAll`, and run it **first**:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  node -e '
const fs = require("fs");
const { createStrapi, compileStrapi } = require("@strapi/strapi");
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  const T = "components_shared_partner_groups_partners_lnk";
  for (const line of fs.readFileSync("/tmp/p4-walk-before.txt", "utf8").trim().split("\n")) {
    const [cmp, ids] = line.split("|");
    const partnerIds = ids.split(",").map(Number);
    await app.db.connection(T).where("partner_group_id", Number(cmp)).del();
    let ord = 1;
    for (const pid of partnerIds) {
      await app.db.connection(T).insert({
        partner_group_id: Number(cmp), partner_id: pid, partner_ord: ord++,
      });
    }
    console.log("restored", cmp, "->", partnerIds.join(","));
  }
  await app.destroy(); process.exit(0);
})();'
```

Order is rewritten from the snapshot rather than left to fall where it may:
`partner_ord` is what the microsite renders by, and row 2 of the walkthrough
exists specifically to prove that.

Then confirm and stop:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT partner_group_id, group_concat(partner_id, ',') FROM (SELECT * FROM components_shared_partner_groups_partners_lnk ORDER BY partner_group_id, partner_ord) GROUP BY partner_group_id;" > /tmp/p4-walk-after.txt && \
  diff /tmp/p4-walk-before.txt /tmp/p4-walk-after.txt && echo "RESTORED CLEAN"
pkill -f "strapi develop" ; pkill -f "astro dev" ; sleep 2
cd /Users/nk/Projects/AREAA/areaa-frontend && git status --short
cd /Users/nk/Projects/AREAA/areaa-cms && git status --short
```

Expected: `RESTORED CLEAN`, clean in both repos, no processes left. If the diff
is still non-empty, `/tmp/p4-walk-names.txt` from Step 2 gives the names to
re-check by hand — restart the servers first.

---

## Done when

- **175 CMS and 63 frontend tests green**, CMS twice in a row with **no row growth and no sponsor reordering**.
- A chapter admin can choose which partners appear on their microsite, with JavaScript disabled, and **the public page reflects it** — both when adding and when removing all.
- The submitted **order** is what the microsite renders.
- `partners: null`, an unknown partner id, and another chapter's slug return **400 / 400 / 403**; a `{documentId, name}` smuggle leaves the Partner's name unchanged.
- A chapter with **no home page** gets a 404 explaining why, not an obscure failure. *(Tests only — Task 7's integration test and Task 9's render test. The walkthrough never sees it: it uses `aloha-hawaii` throughout, and no `pdx` admin account exists.)*
- **No component on a non-chapter page is ever written.**
- The partners screen renders **no picker and no Save button** whenever it cannot read both the catalogue and the current selection. *(Task 9's render tests only — not reachable from the walkthrough at all. The corresponding server-side guarantee, that `findPartnerGroups` never reports `ok` without a draft slot, is Task 6's unit tests.)*
- `GET /chapter-admin/{events,committees,news}/:documentId` returns the record with its edit-screen relations, 404s a record from another administered chapter when `chapterSlug` names this one, 403s one from an unadministered chapter, and **404s a chapterless record rather than confirming it exists**.
- The committee, news and events lists are scoped **server-side**, and the events list can display an error. *(Walkthrough rows 10–12.)* The "no page renders zero rows while claiming more pages exist" half is **reasoning, not a test**: it needs >25 news items in one chapter and the seed has one. Task 4 asserts only that the scoped `total` shrinks.
- Every existing import of `../lib/chapter-admin` still resolves after the split.
- `/account?error=not-chapter-admin` explains itself.
- `tests/unit/grants.test.js` passes.

## Not in this plan

- **`/page`** — the fixed-template microsite editor and its dynamic-zone positional merge. **Plan 5, alone.** This plan writes a relation *inside* one component and never touches the zone; `/page` rewrites the zone itself.
- **TipTap and the real blocks converters.** Plan 6.
- **Wiring the contact form to capture submissions.** Filed as `2026-08-04-contact-form-sends-nothing.md`.
- **Splitting the controller.** ~280 lines with partners. Plan 5 will move `/page` logic into a service anyway; doing both splits at once is one reviewable change rather than two.
- **A `chapter.partners` reader.** The relation still exists and this plan leaves it alone. It is now definitively write-only — nothing sets it, nothing reads it. Removing it is a schema migration, and belongs with whoever next touches the chapter model.

## Known limitations, accepted

- **`chapter.partners` will diverge from what the site renders.** Plans 1–3 assumed it was the partner store; it never was — the microsite reads the `shared.partner-group` component. But it is not dead: `scripts/seed.js:261` populates it, `chapters_partners_lnk` holds 12 rows today, and the admin panel exposes it as an editable field. So after this plan there are two stores, one authoritative and one that merely looks it. A chapter admin's save updates the component; `chapter.partners` keeps whatever the seed put there. That is worse than dead weight, because the next person to read the spec's API table will find `chapter.partners` described as the mechanism and the data will appear to confirm it. Reconciling them — migrate and drop, or make the component the only writer and empty the field — is plan 5 work, deliberately not smuggled in here.
- **The committee list still truncates at 100** with no pagination UI (`pageSize=100`, `MAX_PAGE_SIZE=100`). Task 2 makes that limit per-chapter rather than shared across all administered chapters — strictly better, but still a cap. Carried forward from plan 3, still unpaid. `listCommittees` discards `meta`, so the page cannot even say "showing the first 100 of N".
- **No CSRF token**, and this plan adds a sixth form POST. Astro's native `checkOrigin` covers it, as with every other form on the site.
- **A draft-only partner can be attached but will not render.** `listPartners` reads the catalogue at `status: 'draft'`, so a partner national created but never published is offered in the picker and accepted on save. It attaches to the draft component; the published component silently drops it, because no published row exists to link. The screen then reports it as attached while the public page does not show it. Not reachable with the current seed — every partner is published — but a national admin creating a partner and not publishing it makes it reachable immediately. The honest fix is to filter the catalogue to published partners, which needs a decision about whether chapter admins should see unpublished national content at all; deferred, not overlooked.
- **Only the first partner-group slot on a page is written.** `components` is a repeatable dynamic zone, so a page could hold two; `findPartnerGroups` takes `.find()`, not `.filter()`. Every seeded home page has exactly one, and a second would be a page-design mistake rather than a supported layout — but this plan does not detect or warn about it.
- **No search on the partner picker**, as with members. Fine for a national catalogue of a handful; not for dozens.
- **`listSubmissions` still hardcodes `limit: 200`** with no pagination. Invisible while the contact form writes nothing.
- **`publishedDate` is free text**, `listMembers` requires `confirmed` while `assertMembersInChapter` does not, committee membership is not re-validated on read, and `form-submission.chapter` is optional. All unchanged from plan 3.
