# Chapter Admin — Plan 4: Partners, Single-Record Routes and Structural Cleanups

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chapter admins attach and detach the partners shown on their microsite; and the three structural debts plans 1–3 knowingly accrued are paid off before `/page` lands on top of them.

**Architecture:** One new resource (`/partners`, attach/detach only — partner records are never edited) plus four cleanups the previous plans explicitly deferred: a real single-record route to retire the fetch-a-page-and-find-it hack, server-side chapter scoping on the factory lists to retire the client-side filters, a split of the frontend client, and error rendering on `/account`.

**Tech Stack:** Strapi 5.45.1, Node 24, CommonJS, Astro 6.4.2, TypeScript strict, Vitest 3.

**Spec:** [`2026-08-03-chapter-admin-authoring-design.md`](./2026-08-03-chapter-admin-authoring-design.md).
**Predecessors:** [plan 1](./2026-08-03-chapter-admin-plan-1-authorization-spine.md), [plan 2](./2026-08-03-chapter-admin-plan-2-events-authoring-ui.md), [plan 3](./2026-08-04-chapter-admin-plan-3-committees-news-settings.md) — all complete, **122 CMS + 54 frontend tests green**.

---

## Scope

**In:** `/partners`, plus these four, each named in a predecessor's Known limitations:

| Debt | Named in | Why now |
|---|---|---|
| `GET /<resource>/:documentId` | plan 3, "the right first task of plan 4" | `getEvent`/`getCommittee`/`getNewsItem` each fetch 100 records and `.find()`. Past 100 they silently stop finding older ones |
| Server-side chapter scoping on `list` | plan 3 | The committee and news pages filter client-side *after* server pagination, so a multi-chapter admin sees wrong page counts and empty pages |
| Split `src/lib/chapter-admin.ts` | plan 3 | 303 lines, six resource clients. The single-record work touches every getter — this is the moment |
| `/account` renders `error=not-chapter-admin` | plan 3 | Five routes and ten page guards emit it; the landing page shows nothing, so a bounced member sees their dashboard with no explanation |

**Out:** `/page` — the fixed-template microsite editor. Plan 5, deliberately alone: its dynamic-zone positional merge is the one piece of this design where a mistake corrupts 45 live microsites, and it deserves undivided review. It will land on the cleanups this plan makes.

**Out:** TipTap and the real blocks converters. Plan 6.

---

## Why partners is small and `/page` is not

The spec gives partners two verbs and one rule (CA7): chapter admins **attach and detach** shared Partner records; they never edit them, because a Partner row appears on every chapter that uses it. So `/partners` is a catalogue read plus a set-write on `chapter.partners` — structurally the committee member picker again, with a global candidate list instead of a chapter-scoped one.

`/page` is the opposite: eleven component instances, a replace-on-write dynamic zone, and a positional-merge rule that must preserve national's ordering and unknown component types. Bundling them would bury the risky one.

---

## Preconditions

**1. Node 24 for anything touching the CMS repo.** Bare `node` here is v22.12.0; `/opt/homebrew/bin/node` is v24.1.0, so the `PATH=` prefix is load-bearing.

**2. Two repos.** Every command block states its own `cd`, including the `sqlite3` ones.

| Repo | Path |
|---|---|
| CMS | `/Users/nk/Projects/AREAA/areaa-cms` |
| Frontend | `/Users/nk/Projects/AREAA/areaa-frontend` |

**3. The CMS dev server must be STOPPED for tests and boots, RUNNING for browser verification.**

```bash
pkill -f "strapi develop"
cd /Users/nk/Projects/AREAA/areaa-cms && \
  PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop
```

**4. Test accounts** (present since plan 2):

| Account | Password | Role |
|---|---|---|
| `chapadmin@areaa.test` | `Password123!` | Chapter Admin of `aloha-hawaii` |
| `plainmember@areaa.test` | `Password123!` | Ordinary member, administers nothing |

Any new test user **must** carry `provider: 'local'` or it cannot log in.

**5. A second-chapter admin is needed this time.** Several behaviours in this plan only differ for someone administering two chapters, and `chapadmin` administers one. **Task 13 Step 1** creates `twochapter@areaa.test`.

---

## Verified assumptions

Executed against the installed Strapi 5.45.1.

| Assumption | Verdict |
|---|---|
| `partner` has `name` (required), `logo` (media, **required**), `url`, `sponsorshipLevel` (enum) | ✅ Per schema |
| `partner` is `draftAndPublish: true` | ✅ So it is two rows sharing a documentId — key on documentId, never entry id |
| `chapter.partners` is manyToMany **inversedBy** `partner.chapters` — i.e. bidirectional | ✅ Unlike `committee.members`, which is unidirectional |
| Writing `chapter.partners` with `[{documentId}]` works | ✅ Set 2, read back 2 |
| Updating `chapter.partners` **replaces** rather than appends | ✅ 2 → 1 read back 1 |
| `chapter.partners: []` clears it | ✅ Read back 0 |
| Writing one chapter's partners leaves **other chapters' lists untouched** | ✅ Verified explicitly — the bidirectional relation made this worth checking, since `@strapi/database`'s "drop previous relations" cleanup is gated on bidirectionality |
| `/account/index.astro` renders nothing for any `error` param | ✅ Zero occurrences of the string |

### Carried forward from plan 3, still true

- `fields: [...]` always unions `id` and `documentId`.
- Nested `populate: { x: { fields: [...] } }` still returns `documentId`.
- Strapi validates `src/index.js` and rejects any export beyond `register`/`bootstrap`/`destroy` — this is why grants live in `src/api/chapter-admin/grants.js`. **Do not move them back.**
- The `sqlite3` CLI defaults `PRAGMA foreign_keys = 0`; any manual purge must set it ON or it leaves orphan link rows.
- Error classes must be compared across one module system. Tests that assert `toThrow(SomeError)` load the service **and** the error through a single `createRequire`.

---

## File structure

**CMS — create:**

| Path | Responsibility |
|---|---|
| `src/api/chapter-admin/services/partners.js` | `toPartnerRow`, `normalisePartnerIds` |
| `tests/unit/partners.test.js` | Row shaping and id normalisation |
| `tests/integration/partners.test.js` | Catalogue read, attach/detach, scope |
| `tests/integration/single-record.test.js` | `GET /<resource>/:documentId` across all three |

**CMS — modify:** `services/resource-factory.js` (adds `getOne`, optional list scoping), `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `grants.js`.

**Frontend — create:**

| Path | Responsibility |
|---|---|
| `src/lib/chapter-admin/client.ts` | `call`, `messageOf`, `Pagination`, `EMPTY_PAGINATION` |
| `src/lib/chapter-admin/{events,committees,news,chapter,submissions,members,partners,media}.ts` | One module per resource |
| `src/lib/chapter-admin/index.ts` | Re-export, so every existing import site is unchanged |
| `src/lib/partners-form.ts` | Pure FormData → partner payload |
| `tests/unit/partners-form.test.ts` | Payload mapping |
| `src/components/PartnersForm.astro` | The attach/detach screen body |
| `src/pages/api/chapter-admin/partners.ts` | Form POST |
| `src/pages/account/chapter/[chapterSlug]/partners.astro` | The screen |

**Frontend — modify:** `src/layouts/ChapterAdminLayout.astro` (nav), `src/pages/account/index.astro` (error rendering), the committee and news list/edit pages (drop the client-side filters), `src/lib/chapter-admin.ts` → **deleted**, replaced by the directory.

---

## Chunk 1: Single-record routes

### Task 1: Add `getOne` to the factory

Three client functions currently fetch a page of up to 100 records and `.find()` the one they want. Past 100 they silently return null, which the pages render as "could not be found".

**Files:** Modify `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/factory-hooks.test.js`:

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

  it('403s a record in a chapter the caller does not administer', async () => {
    const s = fakeStrapi({ stored: { documentId: 'r-1', chapter: { documentId: 'chap-z' } } });
    await expect(res(s).getOne(makeCtx({}, { documentId: 'r-1' })))
      .rejects.toThrow(/not administered/);
  });

  it('404s a record in a DIFFERENT administered chapter when chapterSlug is given', async () => {
    // The multi-chapter case: the caller may administer both, but this URL is
    // scoped to one. Answering with the other chapter's record is how plan 3's
    // roster wipe became reachable.
    const s = fakeStrapi();               // stored record is in chap-a / boston
    const ctx = makeCtx({}, { documentId: 'r-1' });
    ctx.query = { chapterSlug: 'seattle' };
    await res(s).getOne(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('applies getOnePopulate so the edit screen gets its relations', async () => {
    const s = fakeStrapi();
    const seen = [];
    s.documents = ((orig) => (uid) => {
      const d = orig(uid);
      return { ...d, findOne: async (args) => { seen.push(args); return d.findOne(args); } };
    })(s.documents);
    await res(s, { getOnePopulate: { members: { fields: ['firstName'] } } })
      .getOne(makeCtx({}, { documentId: 'r-1' }));
    expect(seen[0].populate).toHaveProperty('members');
    expect(seen[0].populate).toHaveProperty('chapter');   // always merged
  });
});
```

`fakeStrapi` needs a `stored: null` case; extend its default:

```js
function fakeStrapi({ stored = { documentId: 'r-1', chapter: CHAP } } = {}) {
```

is already correct — pass `{ stored: null }` explicitly and `findOne` returns null.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js
```

Expected: FAIL — `getOne is not a function`.

- [ ] **Step 3: Implement**

Add `getOnePopulate = null` to the factory's destructured options, and this handler to the returned object, above `list`:

```js
    /**
     * One record by documentId, scope-checked.
     *
     * Replaces the client-side "fetch a page and .find() it" in getEvent,
     * getCommittee and getNewsItem, which silently stopped finding anything
     * past the 100th record.
     *
     * `chapterSlug` is optional but the pages always send it: a caller may
     * administer several chapters, and answering /chapter/A/…/<B's-id> with B's
     * record is exactly how a cross-chapter edit screen became reachable. With
     * it, a record from another chapter is a 404 rather than a usable form.
     */
    async getOne(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const { documentId } = ctx.params;

      const record = await docs().findOne({
        documentId,
        populate: { chapter: { fields: ['name', 'slug'] }, ...(getOnePopulate ?? {}) },
        status: 'draft',
      });
      if (!record) return ctx.notFound();

      assertChapterScope(administered, record.chapter?.documentId ?? null);

      const wanted = String(ctx.query?.chapterSlug ?? '');
      if (wanted && record.chapter?.slug !== wanted) return ctx.notFound();

      ctx.body = { data: record };
    },
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js
```

Expected: PASS, 13 tests (8 existing + 5).

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/resource-factory.js tests/unit/factory-hooks.test.js && \
  git commit -m "feat: single-record getOne on the chapter-scoped factory"
```

---

### Task 2: Optional chapter scoping on `list`

The committee and news pages filter to their chapter *after* the server has paginated across every administered chapter. A multi-chapter admin therefore gets a page count that overstates their chapter and can land on a page rendering none of it.

**Files:** Modify `src/api/chapter-admin/services/resource-factory.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/factory-hooks.test.js`:

```js
describe('list scoping', () => {
  /** Captures the filters the list handler builds. */
  const spy = () => {
    const seen = [];
    const s = fakeStrapi();
    const orig = s.documents;
    s.documents = (uid) => {
      const d = orig(uid);
      if (uid === 'api::committee.committee') {
        return { ...d, findMany: async (a) => { seen.push(a); return []; }, count: async () => 0 };
      }
      return d;
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

  it('403s a chapterSlug the caller does not administer', async () => {
    const { s } = spy();
    const ctx = makeCtx();
    ctx.query = { chapterSlug: 'seattle' };
    await expect(res(s).list(ctx)).rejects.toThrow(/not administered/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js
```

Expected: FAIL — the second case still gets `$in`.

- [ ] **Step 3: Implement**

In `list`, replace the `filters` construction:

```js
      // Optional single-chapter narrowing. Without it the pages have to filter
      // client-side AFTER pagination, which makes pageCount describe a larger
      // set than the rows shown — a multi-chapter admin sees "page 2 of 3"
      // render nothing.
      const wanted = String(ctx.query?.chapterSlug ?? '');
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

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js && \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: 16 tests in that file, then **125 overall** (122 + 3). The existing suites must be untouched — `chapterSlug` is optional and nothing sends it yet.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/resource-factory.js tests/unit/factory-hooks.test.js && \
  git commit -m "feat: optional server-side chapter scoping on factory lists"
```

---

### Task 3: Wire the three single-record routes

**Files:** Modify `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `grants.js`

- [ ] **Step 1: Give each resource its populate and export the handlers**

`events` and `news` already declare `listPopulate`; reuse the same shape for the edit screen. Add to each factory config:

```js
// events
  getOnePopulate: { figure: { fields: ['url', 'name'] } },
// committees
  getOnePopulate: { members: { fields: ['firstName', 'lastName', 'displayName', 'title'] } },
// news
  getOnePopulate: {
    figure: { fields: ['url', 'name'] },
    author: { fields: ['firstName', 'lastName', 'displayName'] },
  },
```

Then, alongside the existing exports:

```js
  getEvent: guarded(events.getOne),
  getCommittee: guarded(committees.getOne),
  getNewsItem: guarded(news.getOne),
```

- [ ] **Step 2: Add the routes**

**Order matters.** Strapi matches in declaration order, so a literal path must precede a parameterised one that could swallow it. There is no such collision today (`/members`, `/chapter`, `/submissions` are distinct roots), but keep the single-record routes immediately after their list route so it stays obvious:

```js
    { method: 'GET', path: '/chapter-admin/events/:documentId',      handler: 'chapter-admin.getEvent' },
    { method: 'GET', path: '/chapter-admin/committees/:documentId',  handler: 'chapter-admin.getCommittee' },
    { method: 'GET', path: '/chapter-admin/news/:documentId',        handler: 'chapter-admin.getNewsItem' },
```

- [ ] **Step 3: Grant them**

In `src/api/chapter-admin/grants.js`, add to `CHAPTER_ADMIN_GRANTS`:

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

Expected: PASS, 3 tests. It diffs grants against controller exports against routes — a typo in any of the three lists fails it with a readable diff. Do **not** substitute a permission row count; that check is inert, because `syncPermissions` prunes unknown actions and the grant loop re-creates them.

- [ ] **Step 5: Boot and confirm**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: `BOOTSTRAP OK`, then `21` (18 + 3).

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

  // Administers BOTH — several behaviours here only differ for that caller.
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
  await shutdown();
});

const api = () => request(strapi.server.httpServer);
const as = (token) => (r) => r.set('Authorization', `Bearer ${token}`);
const tag = (n) => `${n} ${RUN}`;

/** Create one of each, owned by the given chapter, via the API. */
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

    const ev = await as(tokenA)(api().get(`/api/chapter-admin/events/${own.ev.documentId}`));
    expect(ev.status).toBe(200);
  });

  it('404s a documentId that does not exist', async () => {
    const res = await as(tokenA)(api().get('/api/chapter-admin/committees/doesnotexist000000000000'));
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
    // The multi-chapter case. Both chapters are administered, so the scope check
    // passes — only the chapterSlug comparison stops the caller getting a form
    // for B's record under A's URL, which is how a cross-chapter save became
    // reachable in plan 3.
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

  it('finds a record beyond the first 100, which the old client hack could not', async () => {
    // The whole point of this route. Rather than creating 101 fixtures, assert
    // the mechanism: the handler does a findOne by documentId, so a record's
    // position in any list is irrelevant. A list-and-find implementation is
    // detectable because it would need pagination params — this one takes none.
    const res = await as(tokenA)(api().get(`/api/chapter-admin/events/${own.ev.documentId}?page=999`));
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
    // and the pagination now describes the narrowed set
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
pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/single-record.test.js
```

Expected: PASS, **8 tests**.

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

Two pure functions, mirroring `services/members.js`. Partners are a **global** catalogue, so there is no per-chapter membership check — the security question is only "may this caller write this chapter", which `resolveScopedChapter` already answers.

**Files:** Create `src/api/chapter-admin/services/partners.js`, `tests/unit/partners.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// One createRequire: an ESM import beside the service's CJS require gives two
// class objects and `toThrow(BadInputError)` fails on the wrong one.
const require = createRequire(import.meta.url);
const {
  toPartnerRow, normalisePartnerIds, PARTNER_FIELDS,
} = require('../../src/api/chapter-admin/services/partners.js');
const { BadInputError } = require('../../src/api/chapter-admin/services/fields.js');

describe('toPartnerRow', () => {
  it('returns what the picker needs to render and submit', () => {
    const row = toPartnerRow({
      documentId: 'p1', name: 'Chase', sponsorshipLevel: 'Gold',
      logo: { url: '/uploads/chase.png' },
    });
    expect(row).toEqual({
      documentId: 'p1', name: 'Chase', sponsorshipLevel: 'Gold', logoUrl: '/uploads/chase.png',
    });
  });

  it('tolerates a missing logo even though the schema requires one', () => {
    // `logo` is required:true, but a populate that omits it or a partner
    // created before that constraint would otherwise throw here.
    const row = toPartnerRow({ documentId: 'p1', name: 'Chase' });
    expect(row.logoUrl).toBe('');
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

  it('accepts an empty list — detaching everything is legal', () => {
    expect(normalisePartnerIds([])).toEqual([]);
  });

  it('treats undefined as absent', () => {
    expect(normalisePartnerIds(undefined)).toEqual([]);
  });

  it('rejects a bare null rather than treating it as "detach all"', () => {
    // Strapi accepts `partners: null` and silently clears the relation, so a
    // stray null would wipe a chapter's sponsor list while 'x' correctly 400s.
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
 * question here, unlike services/members.js. The whitelist exists for shape
 * stability, not secrecy.
 */
const PARTNER_FIELDS = ['documentId', 'name', 'sponsorshipLevel', 'logoUrl'];

function toPartnerRow(partner) {
  return {
    documentId: partner.documentId,
    name: partner.name ?? '',
    sponsorshipLevel: partner.sponsorshipLevel ?? '',
    // `logo` is required:true in the schema, but a populate that omits it or a
    // record predating the constraint must not throw here.
    logoUrl: partner.logo?.url ?? '',
  };
}

/**
 * Whatever the form sent -> a de-duplicated list of documentId strings.
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

module.exports = { toPartnerRow, normalisePartnerIds, PARTNER_FIELDS };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/partners.test.js
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/partners.js tests/unit/partners.test.js && \
  git commit -m "feat: partner row shaping and id normalisation"
```

---

### Task 6: The partners routes

**Files:** Modify `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `grants.js`

- [ ] **Step 1: Add the handlers**

```js
  // --- partners ----------------------------------------------------------
  // Partner records are SHARED and are never written here (CA7): a Partner row
  // appears on every chapter that uses it, so editing one would change other
  // chapters' microsites. This endpoint only reads the catalogue and writes the
  // chapter's own `partners` relation.
  listPartners: guarded(async (ctx) => {
    // Scope-checked even though the catalogue is global: the screen belongs to a
    // chapter, and answering for a chapter the caller cannot administer would
    // leak which chapters exist.
    const { error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const rows = await strapi.documents('api::partner.partner').findMany({
      fields: ['name', 'sponsorshipLevel'],
      populate: { logo: { fields: ['url'] } },
      sort: ['name:asc'],
      limit: -1,
      status: 'draft',   // partner is draftAndPublish; draft is the stable side
    });

    ctx.body = { data: rows.map(toPartnerRow) };
  }),

  updatePartners: guarded(async (ctx) => {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, input.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const ids = normalisePartnerIds(input.partners);   // BadInputError -> 400

    // Every id must name a real partner. Unlike committee members there is no
    // chapter-membership question — the catalogue is global — but a documentId
    // that matches nothing would be silently dropped by Strapi, so the admin
    // would see a partner vanish with no explanation.
    if (ids.length > 0) {
      const found = await strapi.documents('api::partner.partner').findMany({
        filters: { documentId: { $in: ids } }, fields: ['name'], limit: -1, status: 'draft',
      });
      if (found.length !== ids.length) {
        return ctx.badRequest('One or more selected partners no longer exist');
      }
    }

    const updated = await strapi.documents('api::chapter.chapter').update({
      documentId: chapter.documentId,
      data: { partners: ids.map((documentId) => ({ documentId })) },
      status: 'published',
    });

    ctx.body = { data: { documentId: updated.documentId, attached: ids.length } };
  }),
```

Add the requires at the top:

```js
const { toPartnerRow, normalisePartnerIds } = require('../services/partners');
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

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/grants.test.js && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: 3 tests pass, `BOOTSTRAP OK`, then `23`.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: chapter partner attach/detach routes"
```

---

### Task 7: Integration-test partners

**Files:** Create `tests/integration/partners.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, catalogue, originalA, originalB;

const partnersOf = async (chapter) => {
  const c = await strapi.documents('api::chapter.chapter').findOne({
    documentId: chapter.documentId, populate: { partners: { fields: ['name'] } }, status: 'draft',
  });
  return (c?.partners ?? []).map((p) => p.documentId).sort();
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

  // These are REAL chapters with real sponsor lists; capture and restore.
  originalA = await partnersOf(chapterA);
  originalB = await partnersOf(chapterB);
});

afterAll(async () => {
  for (const [chapter, original] of [[chapterA, originalA], [chapterB, originalB]]) {
    await strapi.documents('api::chapter.chapter').update({
      documentId: chapter.documentId,
      data: { partners: original.map((documentId) => ({ documentId })) },
      status: 'published',
    });
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

  it("refuses a chapter the caller does not administer", async () => {
    const res = await auth(api().get(`/api/chapter-admin/partners?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('PUT /api/chapter-admin/partners', () => {
  it('ACTUALLY ATTACHES the selected partners', async () => {
    const want = [catalogue[0].documentId, catalogue[1].documentId].sort();
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: want });

    expect(res.status).toBe(200);
    expect(res.body.data.attached).toBe(2);
    expect(await partnersOf(chapterA)).toEqual(want);
  });

  it('REPLACES rather than appending', async () => {
    await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: [catalogue[0].documentId, catalogue[1].documentId] });
    await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: [catalogue[0].documentId] });

    expect(await partnersOf(chapterA)).toEqual([catalogue[0].documentId]);
  });

  it('detaches everything when sent an empty list', async () => {
    await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: [] });
    expect(await partnersOf(chapterA)).toEqual([]);
  });

  it('leaves OTHER chapters untouched', async () => {
    // chapter.partners is manyToMany and bidirectional, so a write from this
    // side could plausibly disturb the inverse. It does not — assert it.
    const before = await partnersOf(chapterB);
    await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: [catalogue[0].documentId] });
    expect(await partnersOf(chapterB)).toEqual(before);
  });

  it('400s on a partner documentId that does not exist', async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: ['nosuchpartner000000000000'] });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/no longer exist/i);
  });

  it('400s on a malformed payload rather than 500ing', async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: 'nope' });
    expect(res.status).toBe(400);
  });

  it('400s on partners:null rather than silently detaching everything', async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: null });
    expect(res.status).toBe(400);
  });

  it("refuses another chapter", async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterB.slug, partners: [] });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('never writes the Partner record itself', async () => {
    // CA7: partners are shared. A name change here would rename the sponsor on
    // every other chapter's microsite.
    const before = await strapi.documents('api::partner.partner')
      .findOne({ documentId: catalogue[0].documentId, fields: ['name'], status: 'draft' });

    await auth(api().put('/api/chapter-admin/partners')).send({
      chapterSlug: chapterA.slug,
      partners: [{ documentId: catalogue[0].documentId, name: 'Renamed By Chapter' }],
    });

    const after = await strapi.documents('api::partner.partner')
      .findOne({ documentId: catalogue[0].documentId, fields: ['name'], status: 'draft' });
    expect(after.name).toBe(before.name);
  });
});
```

- [ ] **Step 2: Run them, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/partners.test.js && \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **11 tests**, then **159 across 15 files** — 122 from plans 1–3, plus 5 getOne, 3 list-scoping, 8 single-record, 10 partners unit, 11 partners integration. (Note 5+3 land inside the existing `factory-hooks.test.js`, so the file count rises by 3, not 5.)

- [ ] **Step 3: Prove the sponsor lists were restored**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT c.slug, COUNT(l.partner_id) FROM chapters c LEFT JOIN chapters_partners_lnk l ON l.chapter_id = c.id WHERE c.published_at IS NULL GROUP BY c.slug ORDER BY c.slug;"
```

Expected: the same counts as before the run. These are real chapters with real sponsors — the suite must put them back.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/partners.test.js && \
  git commit -m "test: partner catalogue, attach/detach and the shared-record invariant"
```

---

## Chunk 3: Split the client

### Task 8: `src/lib/chapter-admin.ts` becomes a directory

303 lines holding transport, error shaping and six resource clients. This chunk's single-record work touches every getter, so the split happens now rather than after.

**The rule: no import site changes.** Every existing `from "../../lib/chapter-admin"` keeps working, because `index.ts` re-exports everything. If a page needs editing, the split is wrong.

**Files:** Create `src/lib/chapter-admin/`; delete `src/lib/chapter-admin.ts`

- [ ] **Step 1: Create `client.ts` — the shared transport**

Move `STRAPI_URL`, `call`, `messageOf`, `Pagination`, `EMPTY_PAGINATION` verbatim, exporting all of them:

```ts
// Shared transport for the /api/chapter-admin/* clients.
// Server-only: every call carries the member's session JWT, which never reaches
// the browser.
const env = import.meta.env as Record<string, string | undefined>;
const STRAPI_URL =
    process.env.STRAPI_URL || env.STRAPI_URL || "http://localhost:1337";

export interface Pagination {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
}

export const EMPTY_PAGINATION: Pagination = { page: 1, pageSize: 25, pageCount: 1, total: 0 };

export async function call(
    jwt: string,
    path: string,
    init: RequestInit = {}
): Promise<{ status: number; body: any }> {
    try {
        const res = await fetch(`${STRAPI_URL}/api/chapter-admin${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${jwt}`,
                ...(init.body && !(init.body instanceof FormData)
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(init.headers ?? {}),
            },
        });
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
    } catch {
        return { status: 0, body: null }; // transport failure
    }
}

/** Strapi error bodies are `{ error: { message } }`; fall back to the status. */
export function messageOf(body: any, status: number): string {
    return body?.error?.message || `Request failed (${status})`;
}
```

- [ ] **Step 2: One module per resource**

Move each group verbatim into `events.ts`, `committees.ts`, `news.ts`, `chapter.ts`, `submissions.ts`, `members.ts`, `media.ts`, each importing what it needs from `./client`. Keep every interface with its resource (`AdminEvent` in `events.ts`, and so on).

**Two changes while moving**, both retiring the fetch-and-find hack:

```ts
// committees.ts
export async function getCommittee(
    jwt: string, documentId: string, chapterSlug: string
): Promise<AdminCommittee | null> {
    // Was: fetch a page of 100 and .find() it, which silently stopped working
    // past the 100th committee. The route scope-checks and 404s a record from
    // another chapter, so the chapterSlug check is now server-side.
    const { status, body } = await call(
        jwt, `/committees/${documentId}?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && body?.data ? body.data : null;
}
```

```ts
// news.ts — identical shape
export async function getNewsItem(
    jwt: string, documentId: string, chapterSlug: string
): Promise<AdminNewsItem | null> {
    const { status, body } = await call(
        jwt, `/news/${documentId}?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && body?.data ? body.data : null;
}
```

```ts
// events.ts — gains the chapterSlug the others already had
export async function getEvent(
    jwt: string, documentId: string, chapterSlug: string
): Promise<AdminEvent | null> {
    const { status, body } = await call(
        jwt, `/events/${documentId}?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && body?.data ? body.data : null;
}
```

`getEvent` gaining a required third argument is a **breaking change to one call site** — `events/[documentId].astro`, updated in Task 10.

Also give the two factory-backed list calls the optional slug:

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
```

- [ ] **Step 3: `partners.ts` — the new resource**

```ts
import { call } from "./client";

export interface AdminPartner {
    documentId: string;
    name: string;
    sponsorshipLevel: string;
    logoUrl: string;
}

/** The global catalogue. null on failure, never a soft []. */
export async function listPartners(
    jwt: string, chapterSlug: string
): Promise<AdminPartner[] | null> {
    const { status, body } = await call(
        jwt, `/partners?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    return status === 200 && Array.isArray(body?.data) ? body.data : null;
}

/** The chapter's current selection, read off the chapter record. */
export async function listAttachedPartners(
    jwt: string, chapterSlug: string
): Promise<string[] | null> {
    const { status, body } = await call(
        jwt, `/chapter?chapterSlug=${encodeURIComponent(chapterSlug)}&include=partners`);
    return status === 200 && body?.data ? (body.data.partners ?? []) : null;
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

**`listAttachedPartners` needs a server change**: `getChapter` currently hand-builds `{documentId, name, slug, email}` and does not populate `partners`. Add it, gated so the default response is unchanged:

```js
  // in getChapter, after the scope check
  const body = { documentId: chapter.documentId, name: chapter.name,
    slug: chapter.slug, email: chapter.email ?? '' };

  // `administrators` must never ship — chapter admins must not see or appoint
  // each other. `partners` is opt-in so the settings screen's payload does not
  // grow a relation it has no use for.
  if (String(ctx.query.include ?? '') === 'partners') {
    const withPartners = await strapi.documents('api::chapter.chapter').findOne({
      documentId: chapter.documentId,
      populate: { partners: { fields: ['name'] } },
      status: 'draft',
    });
    body.partners = (withPartners?.partners ?? []).map((p) => p.documentId);
  }

  ctx.body = { data: body };
```

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

- [ ] **Step 5: Delete the old file and typecheck**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && rm src/lib/chapter-admin.ts && \
  npm run check && npm test
```

Expected: **0 errors** and **54 passed**. The only expected error is `events/[documentId].astro` failing to supply `getEvent`'s third argument — fix it there (Task 10), not by making the parameter optional. If any *other* file errors, `index.ts` is missing an export.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add -A src/lib/ && \
  git commit -m "refactor: split the chapter-admin client into one module per resource"
```

---

## Chunk 4: Partners UI

### Task 9: Payload mapping and the screen

**Files:** Create `src/lib/partners-form.ts`, `tests/unit/partners-form.test.ts`, `src/components/PartnersForm.astro`, `src/pages/api/chapter-admin/partners.ts`, `src/pages/account/chapter/[chapterSlug]/partners.astro`

- [ ] **Step 1: Write the failing test**

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
    it("collects every checked partner", () => {
        expect(toPartnersPayload(form({ partners: ["p1", "p2"], partners__present: "1" })))
            .toEqual(["p1", "p2"]);
    });

    it("returns an EMPTY array when the picker was shown and nothing checked", () => {
        // Detaching every sponsor is a legitimate act; without the marker it is
        // indistinguishable from "no picker on the form".
        expect(toPartnersPayload(form({ partners__present: "1" }))).toEqual([]);
    });

    it("returns null when the picker was NOT on the form", () => {
        // null tells the route to skip the write entirely, rather than sending
        // [] and detaching everything.
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

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/partners-form.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * FormData -> the partner documentId list, or null when the picker was absent.
 *
 * Same presence-marker contract as the committee member picker: an all-
 * unchecked checkbox list posts no keys, so without `partners__present` the
 * route cannot tell "detach everything" from "this form had no picker" — and
 * sending [] for the second case would silently drop every sponsor.
 */
export function toPartnersPayload(fd: FormData): string[] | null {
    if (fd.get("partners__present") === null) return null;
    const ids = fd.getAll("partners").map((p) => String(p)).filter(Boolean);
    return [...new Set(ids)];
}
```

- [ ] **Step 4: The route**

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

    const partners = toPartnersPayload(form);
    // null means the picker never rendered — do not send [] and detach the lot.
    if (partners === null) return back(base, "error=missing");

    const result = await savePartners(jwt, chapterSlug, partners);
    if (!result.ok) {
        return back(base, result.status === 403 ? "error=forbidden" : "error=save");
    }
    return back(base, "saved=1");
};
```

- [ ] **Step 5: The component**

`PartnersForm.astro` is `MultiSelect` plus a submit button. Reuse the picker exactly — its `hint` slot carries the sponsorship level:

```astro
---
import MultiSelect from "./MultiSelect.astro";
import type { AdminPartner } from "../lib/chapter-admin";

interface Props {
    chapterSlug: string;
    /** null means the catalogue could not be loaded — NOT that it is empty. */
    catalogue: AdminPartner[] | null;
    attached: string[];
    error?: string | null;
}

const { chapterSlug, catalogue, attached, error = null } = Astro.props;

const options = (catalogue ?? []).map((p) => ({
    value: p.documentId,
    label: p.name,
    hint: p.sponsorshipLevel || undefined,
}));

const messages: Record<string, string> = {
    forbidden: "You don't have permission to change this chapter's partners.",
    missing: "The partner list didn't load, so nothing was changed. Please refresh.",
    save: "Something went wrong saving. Please try again.",
};
const errorMessage = error ? (messages[error] ?? messages.save) : null;
---

<form class="pform" method="post" action="/api/chapter-admin/partners" novalidate>
    <input type="hidden" name="chapterSlug" value={chapterSlug} />

    {errorMessage && <p class="pform__error" role="alert">{errorMessage}</p>}

    {catalogue === null ? (
        <p class="pform__error" role="alert">
            Couldn't load the partner catalogue. Refresh to try again — nothing has changed.
        </p>
    ) : (
        <>
            <MultiSelect
                legend="Partners on your microsite"
                name="partners"
                options={options}
                selected={attached}
                emptyMessage="No partners have been set up nationally yet."
                helper="Partner details are managed nationally — you choose which appear on your chapter's page. Unchecking everything removes them all."
            />
            <div class="pform__actions">
                <button type="submit" class="btn btn--primary">Save Partners</button>
            </div>
        </>
    )}
</form>

<style>
    .pform { display: flex; flex-direction: column; gap: var(--space-600); max-width: 640px; }
    .pform__error {
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

- [ ] **Step 6: The page**

`src/pages/account/chapter/[chapterSlug]/partners.astro` — four levels up, matching `settings.astro`:

```astro
---
import ChapterAdminLayout from "../../../../layouts/ChapterAdminLayout.astro";
import PartnersForm from "../../../../components/PartnersForm.astro";
import { SESSION_COOKIE } from "../../../../lib/auth";
import { listPartners, listAttachedPartners } from "../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const [catalogue, attached] = await Promise.all([
    listPartners(jwt, chapter.slug),
    listAttachedPartners(jwt, chapter.slug),
]);

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

    <PartnersForm
        chapterSlug={chapter.slug}
        catalogue={catalogue}
        attached={attached ?? []}
        error={error}
    />
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

- [ ] **Step 7: Nav entry**

In `ChapterAdminLayout.astro`, between Committees and Submissions:

```js
    { key: "partners", label: "Partners", href: `/account/chapter/${chapterSlug}/partners` },
```

- [ ] **Step 8: Typecheck, test, commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && npm test
```

Expected: 0 errors, **59 passed** (54 + 5).

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/partners-form.ts tests/unit/partners-form.test.ts \
          src/components/PartnersForm.astro src/pages/api/chapter-admin/partners.ts \
          "src/pages/account/chapter/[chapterSlug]/partners.astro" \
          src/layouts/ChapterAdminLayout.astro && \
  git commit -m "feat: partner attach/detach screen"
```

---

## Chunk 5: Retire the client-side filters

### Task 10: Pages use the server-side scoping

Three pages currently filter after the fact, and `events/[documentId].astro` must supply `getEvent`'s new third argument.

**Files:** Modify the committee and news list pages, and all three `[documentId].astro` edit pages

- [ ] **Step 1: Committee list**

```diff
-const all = await listCommittees(jwt);
+const all = await listCommittees(jwt, chapter.slug);
 const failed = all === null;
-// The API scopes to every chapter the caller administers; this page is scoped
-// to one. …
-const rows = (all ?? []).filter((c) => c.chapter?.slug === chapter.slug);
+// Scoped server-side now; no client-side narrowing.
+const rows = all ?? [];
```

The two-branch empty state collapses back to one, since `rows` and `all` are now the same set:

```diff
-    {!failed && rows.length === 0 && (all ?? []).length === 0 && (
-        <p class="clist__empty">No committees yet. …</p>
-    )}
-    {!failed && rows.length === 0 && (all ?? []).length > 0 && (
-        <p class="clist__empty">No committees for {chapter.name} yet. …</p>
-    )}
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

And the split empty state collapses, because `pagination.total` now describes this chapter alone:

```diff
-    {!failed && pagination.total === 0 && ( … "No articles yet" … )}
-    {!failed && pagination.total > 0 && items.length === 0 && ( … "on this page" … )}
+    {!failed && items.length === 0 && (
+        <p class="nlist__empty">No articles yet. <a href={`${base}/new`}>Write the first one.</a></p>
+    )}
```

This is the point of the change: pagination and rendering finally describe the same set, so "page 2 of 3" can no longer render nothing.

- [ ] **Step 3: The three edit pages**

`committees/[documentId].astro` and `news/[documentId].astro` already pass `chapter.slug`; they need no edit — the *client* changed, not the call. `events/[documentId].astro` does:

```diff
-const event = await getEvent(jwt, documentId!);
+const event = await getEvent(jwt, documentId!, chapter.slug);
```

- [ ] **Step 4: Typecheck and test**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && npm test
```

Expected: 0 errors, 59 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add "src/pages/account/chapter/[chapterSlug]/" && \
  git commit -m "refactor: pages use server-side chapter scoping"
```

---

### Task 11: `/account` explains a bounce

Five routes and ten page guards redirect to `/account?error=not-chapter-admin`, and the page renders nothing — so a bounced member lands on their dashboard with no idea why.

**Files:** Modify `src/pages/account/index.astro`

- [ ] **Step 1: Render the message**

In the frontmatter:

```ts
const errorMessages: Record<string, string> = {
    "not-chapter-admin": "You don't have access to that chapter's admin area.",
};
const errorParam = Astro.url.searchParams.get("error");
const errorMessage = errorParam ? (errorMessages[errorParam] ?? null) : null;
```

and near the top of the rendered body, before the existing content:

```astro
{errorMessage && <p class="account__error" role="alert">{errorMessage}</p>}
```

with a style matching the other flash blocks:

```css
    .account__error {
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

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/pages/account/index.astro && \
  git commit -m "feat: /account explains a chapter-admin bounce"
```

Expected: 0 errors.

---

## Chunk 6: Verification

### Task 12: Both suites

- [ ] **Step 1: Run them**

```bash
pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test && npm run check
```

Expected: **159 CMS**, **59 frontend**, 0 typecheck errors.

- [ ] **Step 2: Twice, with no row growth**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(*) FROM up_users) u, (SELECT COUNT(DISTINCT document_id) FROM committees) c, (SELECT COUNT(DISTINCT document_id) FROM news_items) n, (SELECT COUNT(DISTINCT document_id) FROM events) e, (SELECT COUNT(*) FROM files) f, (SELECT COUNT(*) FROM chapters_partners_lnk) p;" && \
  PATH="/opt/homebrew/bin:$PATH" npm test > /dev/null && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(*) FROM up_users) u, (SELECT COUNT(DISTINCT document_id) FROM committees) c, (SELECT COUNT(DISTINCT document_id) FROM news_items) n, (SELECT COUNT(DISTINCT document_id) FROM events) e, (SELECT COUNT(*) FROM files) f, (SELECT COUNT(*) FROM chapters_partners_lnk) p;"
```

Expected: **the two rows are identical.** `chapters_partners_lnk` is new to this gate and matters most — the partners suite rewrites real chapters' sponsor lists and must put them back.

---

### Task 13: Prove it in a browser

- [ ] **Step 1: Create a two-chapter admin**

Several behaviours in this plan only differ for a caller who administers more than one chapter, and `chapadmin` administers one.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node -e "
const { createStrapi, compileStrapi } = require('@strapi/strapi');
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';
  const role = await app.query('plugin::users-permissions.role').findOne({ where: { type: 'chapter_admin' } });
  const chapters = await app.documents('api::chapter.chapter').findMany({ fields: ['slug'], limit: 2, sort: ['slug:asc'], status: 'draft' });
  const email = 'twochapter@areaa.test';
  let user = await app.query('plugin::users-permissions.user').findOne({ where: { email } });
  if (!user) {
    user = await app.plugin('users-permissions').service('user').add({
      username: email, email, password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Two', lastName: 'Chapter', role: role.id,
      administeredChapters: chapters.map((c) => c.id),
    });
  }
  console.log('two-chapter admin administers:', chapters.map((c) => c.slug).join(', '));
  await app.destroy(); process.exit(0);
})();
"
```

- [ ] **Step 2: Start both servers**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop &
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run dev &
```

Note the port Astro reports.

- [ ] **Step 3: Walk it as `chapadmin@areaa.test` / `Password123!`**

| # | Action | Expected |
|---|---|---|
| 1 | Sidebar | Overview, Events, News, Committees, **Partners**, Submissions, Settings |
| 2 | Partners → check two → Save | "Partners saved."; both stay checked on reload |
| 3 | **Uncheck everything** → Save | All unchecked on reload — the presence marker again |
| 4 | Visit the chapter's public microsite | The partner grid matches what you selected |
| 5 | Open a committee, edit, Save | Still works — the client split changed nothing visible |
| 6 | Open an event, edit, Save | Still works, via the new single-record route |
| 7 | Disable JavaScript, repeat 2–3 | Everything still works |

- [ ] **Step 4: Walk the multi-chapter cases as `twochapter@areaa.test`**

These are the ones `chapadmin` cannot exercise, and the reason Step 1 exists.

| # | Action | Expected |
|---|---|---|
| 8 | `/account` | **Two** entries under Chapter Admin |
| 9 | Chapter A → Committees | Only A's committees; the count matches the rows |
| 10 | Chapter B → Committees | Only B's |
| 11 | Copy a committee id from B, open it under **A's** URL | Redirected to A's list with "That committee could not be found." — **not** an editable form |
| 12 | Same for a news item | Same |
| 13 | Chapter A → News, page through if there is more than one page | Every page renders rows; no page count that overstates the chapter |

Row 11 is the important one: it is the cross-chapter edit screen that made a silent roster wipe reachable, now closed server-side rather than by a client-side `.find()`.

- [ ] **Step 5: A member who administers nothing**

Sign in as `plainmember@areaa.test`. Visit `/account/chapter/aloha-hawaii/partners` directly.

Expected: redirected to `/account`, **and the page now says** "You don't have access to that chapter's admin area." — previously it said nothing at all.

- [ ] **Step 6: Attacks by hand**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
JWT=$(curl -s -X POST http://localhost:1337/api/auth/local -H "Content-Type: application/json" \
  -d '{"identifier":"chapadmin@areaa.test","password":"Password123!"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['jwt'])") && \
echo "--- partners:null (expect 400, not a silent detach) ---" && \
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:1337/api/chapter-admin/partners \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"chapterSlug":"aloha-hawaii","partners":null}' && \
echo "--- unknown partner id (expect 400) ---" && \
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:1337/api/chapter-admin/partners \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"chapterSlug":"aloha-hawaii","partners":["nosuchpartner000000000000"]}' && \
echo "--- another chapter's partners (expect 403) ---" && \
FOREIGN=$(sqlite3 .tmp/data.db "SELECT slug FROM chapters WHERE slug != 'aloha-hawaii' LIMIT 1;") && \
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:1337/api/chapter-admin/partners \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "{\"chapterSlug\":\"$FOREIGN\",\"partners\":[]}"
```

Expected: `400`, `400`, `403`.

- [ ] **Step 7: Stop the servers and confirm both trees are clean**

```bash
pkill -f "strapi develop" ; pkill -f "astro dev" ; sleep 2
cd /Users/nk/Projects/AREAA/areaa-frontend && git status --short
cd /Users/nk/Projects/AREAA/areaa-cms && git status --short
```

Expected: clean in both, no processes left. **Also restore anything the walkthrough changed** — the partner selections in rows 2–3 are real sponsor lists on a real chapter.

---

## Done when

- **159 CMS and 59 frontend tests green**, CMS twice in a row with **no row-count growth**, including `chapters_partners_lnk`.
- A chapter admin can attach and detach partners with JavaScript disabled, and **unchecking everything genuinely detaches everything**.
- `partners: null`, an unknown partner id, and another chapter's slug each return **400 / 400 / 403** — never a silent detach.
- **A Partner record is never written.** Sending `{documentId, name}` changes no partner's name.
- `GET /chapter-admin/{events,committees,news}/:documentId` returns the record with its edit-screen relations, 404s a record from another administered chapter when `chapterSlug` names this one, and 403s one from a chapter the caller does not administer.
- The committee and news lists are scoped **server-side**: no page renders zero rows while claiming more pages exist.
- Every existing import of `../lib/chapter-admin` still resolves after the split — **no page imports were edited to accommodate it**, except `events/[documentId].astro` gaining `getEvent`'s third argument.
- `/account?error=not-chapter-admin` explains itself.
- `tests/unit/grants.test.js` passes and fails on a misspelled grant.

## Not in this plan

- **`/page`** — the fixed-template microsite editor and its dynamic-zone positional merge. **Plan 5, alone.**
- **TipTap and the real blocks converters.** Plan 6.
- **Wiring the contact form to capture submissions.** Filed as `2026-08-04-contact-form-sends-nothing.md`.
- **Splitting the controller.** It reaches ~260 lines with partners. Plan 3's Known limitations argue for `services/chapter-settings.js` and `services/submissions.js`; deferred again because plan 5 will move `/page` logic into a service anyway, and doing both splits at once is one reviewable change rather than two.

## Known limitations, accepted

- **`listSubmissions` still hardcodes `limit: 200`** with no pagination. Invisible while the contact form writes nothing.
- **The member and partner pickers have no search.** A chapter with several hundred members, or a national catalogue of dozens of sponsors, will want filtering. `MultiSelect` scrolls at 260px, so the page stays usable; finding a specific entry does not.
- **`listAttachedPartners` costs a second round trip** to `/chapter?include=partners` rather than being returned by `/partners`. Keeps the catalogue endpoint chapter-independent and cacheable later; revisit if the screen feels slow.
- **Detaching a partner does not check whether the microsite's `partner-group` slot references it.** The slot renders from the chapter relation, so it simply shows fewer partners — but plan 5 introduces a stored relation on the component itself, and the two can then disagree. Resolve it there.
- **Partner ordering is the catalogue's, alphabetical by name.** Sponsorship level is shown but not sorted on, so Platinum sponsors do not float to the top of the picker.
