# Plan 8: Additive permissions — multi-role without forking users-permissions

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authority **additive** — a member can hold National Admin *and* Committee Leader *and* Chapter Admin at once, with the union of their grants — without changing `user.role`, forking users-permissions, or buying admin-panel seats.

**Architecture:** A new DB-stored `api::member-capability` collection, held by users through a `manyToMany` relation. `user.role` is untouched and keeps doing exactly what it does today: acting as the coarse users-permissions route gate. The *fine* capability decision moves into the handler, next to the scope check that already lives there — which is the only place a union can be computed per-request. Scope stays per-capability: chapters via the existing `administeredChapters`, committees via a new `ledCommittees`, and National Admin bypasses chapter scope entirely.

**Tech Stack:** Strapi 5.45.1 (CJS services, documents API, users-permissions 5.45.1), Vitest 3.2.7, better-sqlite3 12.8.0, node v22.12.0.

---

## Why this plan exists

RFP §3.1.1.1–7 requires multi-role per user with additive permissions. The shipped model is one role per user, and the cost is already visible in the source. From `src/index.js:8`:

> `user.role` is manyToOne, so a Chapter Admin is NOT also Authenticated: the role must repeat the Authenticated grants or chapter admins lose their own profile page.

And `src/api/chapter-admin/grants.js:47` pays it:

```js
const CHAPTER_ADMIN_GRANTS = [
  ...AUTHENTICATED_GRANTS,
  // + 25 more
];
```

Five duplicated actions at two roles. The cost is combinatorial, not linear: a user who is both National Admin and Committee Leader needs a *third* role re-listing both grant sets, and every later change must be applied to every combination containing it.

This plan is the output of the multi-role proposal dated 2026-08-06. Nik's four decisions are recorded under **Settled decisions** below and are not re-litigated here.

**Tracker:** 4A · RBAC, roles & audit (RFP §3.1.1). Unblocks the National Admin member-management portal (4C), which the tracker gates explicitly on this decision.

**Series naming:** the `chapter-admin-plan-N` prefix is kept for continuity with plans 1–7 and so `ls docs/*chapter-admin-plan*` still finds everything. The subject is 4A, not the chapter-admin workstream.

---

## Settled decisions

Recorded verbatim in intent, so no step below has to guess.

| # | Question | Nik's answer | Consequence in this plan |
|---|---|---|---|
| 1 | Committee Leader scope: per-committee or per-chapter? | **Per committee** | `User.ledCommittees` ⇄ `Committee.leaders`, `manyToMany`. Chunk 2. |
| 2 | National Admin: bypass chapter scope, or hold every chapter? | **Bypass chapter scope** | `assertChapterScope(..., { unscoped })`. Chunk 4, Task 12. |
| 3 | Permission categories: `json` or their own relation? | **`categories` json is fine** | `"categories": { "type": "json" }`. Chunk 1. |
| 4 | Field name: `capabilities` or `memberRoles`? | **`capabilities`** — the conceptual collision with users-permissions' own "permissions" is acknowledged and accepted | `User.capabilities`, `api::member-capability`. Throughout. |

---

## Scope

**In:**

- `api::member-capability`, DB-stored and editable in the admin UI — which is what §3.1.1.10 asks for: new roles without a code change.
- `User.capabilities` (`manyToMany`) — the additive layer, and the whole fix.
- `User.ledCommittees` ⇄ `Committee.leaders` — scope for Committee Leader.
- Collapsing the grant duplication: no authored list spreads another.
- `assertCapability`, `assertCommitteeScope`, and National Admin's chapter-scope bypass, as pure, tested functions wired into every chapter-admin handler.
- A boot-time backfill so day-one behaviour is byte-identical, plus a test that proves it.
- `capabilities` exposed on `GET /api/users/me`, so the frontend can stop reading `role.name` in a later plan.

**Not in:**

- **Routes for National Admin or Committee Leader.** Both capabilities become holdable, scoped and tested by this plan; neither has an endpoint yet. The National Admin portal is 4C and builds its own routes on top of the primitives here. Seeding a capability nothing routes to is deliberate, not an oversight — it is what lets 4C be purely additive.
- **Any frontend change.** `chapterAccess()` in `areaa-frontend/src/lib/chapter-access.ts` keeps reading `role === "Chapter Admin"` and keeps being correct, because `role` is untouched. Switching it to read `capabilities` is a follow-up, listed under **Follow-ups** and explicitly out of this plan's gate.
- **Audit logging.** De-scoped at the 4A level: it is Strapi Enterprise-only ($20–25k/yr) and the client took the $45/mo Pro plan. Nothing in this plan depends on it.
- **Making `user.role` many-to-many.** Non-goal, and the reason is load-bearing: JWT issuance, route policies and permission resolution in users-permissions all assume exactly one role, so multi-valuing it means forking the plugin's permission resolver and re-forking on every Strapi upgrade.
- **Member Active / Non-Active and Guest**, which the tracker lists as roles. They are not authority. `user.status` (`Active`/`Lapsed`/`Pending`/`Honorary`, `private: true`) is already built and is lifecycle; Guest is the unauthenticated Public role and needs no modelling. 4A lists five open roles; only **two** are real, which is why this plan is smaller than the tracker implies.

---

## Preconditions

**1. Branch.** Trunk-based; commit to `main` as plans 1–7 did. Commit at the end of every task.

**2. Every command needs `cd /Users/nk/Projects/AREAA/areaa-cms`.** A missing `cd` in plan 4 made the headline gate run the wrong repo's suite. Assume nothing about the inherited directory.

**3. PATH — this changed, and plans 1–7 have it wrong.**

Plans 1–7 say to prepend Homebrew: `PATH="/opt/homebrew/bin:$PATH"`. **Do not.** Homebrew's node is now v24.1.0 and nvm's — the one `better-sqlite3` was compiled against — is v22.12.0. Prepending shadows nvm, and every integration test dies before a single assertion:

```
Error: The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 137.
```

Which then surfaces as `TypeError: Cannot read properties of undefined (reading 'documents')` in seven suites — a failure that reads like a code bug and is not one.

**Append instead**, so nvm's node still wins and the Homebrew CLI tools are still reachable:

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run
```

Also: **`sqlite3` is not at `/opt/homebrew/bin/sqlite3`** on this machine. It is at `/opt/homebrew/opt/sqlite/bin/sqlite3` (the keg-only install; `/usr/bin/sqlite3` is Apple's and also works). Use the full path in every DB check below.

**3a. Never run two vitest invocations at once.** `vitest.config.js` sets `fileParallelism: false` because the integration tests boot a real Strapi against one SQLite file. That protects a *single* run; it does nothing about two runs racing each other. Two concurrent invocations take the suite from ~16s to ~1000s and start tripping the 60s `hookTimeout`, which surfaces as file-level `FAIL` with no assertion message — a failure that reads like a code bug and is not one. If a run appears to hang, check for a backgrounded earlier run before touching any source.

**3b. Run-stamp every account a test creates.** Every existing integration file suffixes usernames with `const RUN = Date.now()`. Follow it. `up_users.username` is *not* unique at the database level despite the schema saying so, so a fixed address does not fail loudly — it silently accumulates duplicate rows on every failed run, and those rows then poison later runs' assertions. Clean leaked accounts through Strapi (`strapi.query(...).delete`), never raw SQL, or the join-table rows survive.

**4. Baselines, measured immediately before writing this plan.**

| | Test files | Tests |
|---|---|---|
| `areaa-cms` unit | 14 | **202** |
| `areaa-cms` integration | 7 | **133** |
| `areaa-cms` total | 21 | **335** |
| `areaa-frontend` | 27 | **246** |

Permission link rows, from `.tmp/data.db`:

| Role | Link rows | Distinct actions |
|---|---|---|
| `authenticated` | 5 | 5 |
| `chapter_admin` | 31 | **30** |
| `public` | 29 | 29 |

`api::chapter-admin.*` permission rows: **25**. Users: 10 total — 8 `authenticated`, 2 `chapter_admin`.

> **Note the 31 vs 30.** `chapter_admin` has 31 rows in `up_permissions_role_lnk` but only 30 distinct actions, and no action is duplicated. One link row points at a `permission_id` that no longer exists in `up_permissions` — an orphan left by an earlier prune. It is harmless (the join drops it) and this plan does not clean it up, but **the equivalence check in Chunk 5 compares distinct actions, not row counts**, precisely so this orphan does not read as a regression.

Reproduce all of it:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
/opt/homebrew/opt/sqlite/bin/sqlite3 .tmp/data.db \
  "select r.type, count(distinct p.action) from up_roles r
   left join up_permissions_role_lnk l on l.role_id = r.id
   left join up_permissions p on p.id = l.permission_id
   group by r.type;"
```

**5. Test accounts.** `chapadmin@areaa.test` / `Password123!` administers `aloha-hawaii`. `twochapter@areaa.test` administers `aloha-hawaii` and `greater-chicago`. Any new user **must** carry `provider: 'local'` and `confirmed: true` or it cannot log in — the local strategy filters on `provider`, so a user without it has a valid password hash and still fails with "Invalid identifier or password".

**6. A content-type change is a migration that runs on boot** against the shared dev database. Every schema edit in this plan is purely additive (new collection, new relations); none alters or drops an existing column. Rollback is in the last section and is real, not aspirational.

---

## The architecture, stated once

This is the part worth reading twice, because it is where the proposal was under-specified and where getting it wrong fails open.

### Where the capability check actually happens

users-permissions enforces capability **per role, per route, before the handler runs**. Capabilities live on the *user*. So the union of two capabilities can never be computed by the route gate — the gate only ever sees one role.

Therefore:

- **`user.role` stays exactly as it is** and keeps being the coarse gate: "is this caller an admin of some kind at all?" It still 403s an ordinary member before any handler runs. It is not weakened and not re-pointed.
- **The fine check moves into the handler**, next to `assertChapterScope`, which is the only place that can read `user.capabilities` and take a union. `src/api/chapter-admin/routes/chapter-admin.js:6` already says the scope check "is not expressible in this table"; after this plan, the *specific* capability check isn't either, and the comment there is updated to say so.

The rule, in full:

- **Capability** — may this actor perform this kind of action? The union of the baseline grants and every held capability's grants. **Never last-write.**
- **Scope** — on which records? Enforced per capability, per request: chapters through `administeredChapters`, committees through `ledCommittees`. National Admin bypasses chapter scope by decision 2.
- **Fail closed.** A missing or unrecognised capability throws. A missing target throws — *including for National Admin*, who bypasses **which** chapter, never **whether there is one**.
- **`documentId` is the key, never numeric entry ids.** `chapter` and `committee` are both draft-and-publish, so one document is two rows with different ids sharing one `documentId`. Comparing entry ids rejects every legitimate request while looking like a working check. This invariant is unchanged, and the new committee scope must honour it.

Both halves stay required. A capability without scope grants nothing.

### The hazard this introduces, and the structural defence

Moving the fine check into the handler means **the in-handler check becomes load-bearing for capability as well as scope**. A handler someone forgets to wrap is now reachable by any caller whose role passes the coarse gate.

That is not a hypothetical: `uploadMedia` in `controllers/chapter-admin.js` is **not** wrapped in `guarded()` today. It is a bare `async (ctx)`, and its own comment says "Role-gated only" — which is exactly the assumption this plan changes.

So the defence is structural, not a code-review promise: `guarded()` gains a **required** capability argument, throws at module load if it is missing, and **Task 15 adds a test that every action exported by the controller went through `guarded` with a declared capability**. Same shape as the existing `grants.test.js` wiring tests, and for the same reason: counting things cannot catch an omission, so diff the lists.

### Does National Admin imply Chapter Admin?

Yes, through a **declared** map, not a hidden `if`:

```js
const IMPLIES = { national_admin: ['chapter_admin'] };
```

The alternative — requiring a national admin to also be given `chapter_admin` explicitly — is one data-entry mistake away from the exact bug this codebase already shipped once. From `areaa-frontend/src/lib/chapter-access.ts:16`:

> This app checked scope alone, so a member with the link and the plain "Authenticated" role walked through every guard and then got 403 from every single API call behind it. What they saw was six panels each blaming something different […] one of them blaming the network.

A declared, tested implication map makes "National Admin" mean something on its own. It is data in one place, and Task 11 tests it.

### File structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/api/member-capability/content-types/member-capability/schema.json` | The collection. |
| `src/api/member-capability/controllers/member-capability.js` | Core factory. |
| `src/api/member-capability/routes/member-capability.js` | Core factory. |
| `src/api/member-capability/services/member-capability.js` | Core factory. |
| `src/api/member-capability/seed.js` | Create-or-find the three capabilities; backfill holders from `role.type`. Called from `src/index.js`. Not a Strapi-loader folder, so it is an ordinary module — same precedent as `src/api/chapter-admin/grants.js`. |
| `src/api/chapter-admin/services/capabilities.js` | `CAPABILITY_SLUGS`, `IMPLIES`, `assertCapability`, `heldWithImplied`. Pure. |
| `tests/unit/capabilities.test.js` | Unit tests for the above + `grantsFor`. |
| `tests/integration/capabilities.test.js` | Backfill equivalence, fail-closed, cross-scope. |

**Modify:**

| Path | Change |
|---|---|
| `src/extensions/users-permissions/content-types/user/schema.json` | `+capabilities`, `+ledCommittees`. |
| `src/api/committee/content-types/committee/schema.json` | `+leaders` (owning side). |
| `src/api/chapter-admin/grants.js` | `CAPABILITY_GRANTS` + `grantsFor()`; `CHAPTER_ADMIN_GRANTS` becomes derived, not authored. |
| `src/api/chapter-admin/services/scope.js` | `{ unscoped }` option, `assertCommitteeScope`, `resolveAuthority` (one query, three answers). |
| `src/api/chapter-admin/controllers/chapter-admin.js` | `guarded(capability, handler)`; wrap `uploadMedia`. |
| `src/api/chapter-admin/routes/chapter-admin.js` | Header comment only — the capability check is no longer wholly in the table. |
| `src/index.js` | Compose the role's grants; call the capability seed + backfill. |
| `src/extensions/users-permissions/strapi-server.js` | `readSelf` re-attaches `capabilities`. |
| `tests/integration/helpers.js` | `makeChapterAdmin` also attaches the `chapter_admin` capability. |
| `tests/unit/grants.test.js`, `tests/unit/scope.test.js` | Extend for the new shape. |

**Chunk independence.** Chunks 1–3 are behaviour-neutral and can ship alone: they add a collection, add relations nothing reads yet, and refactor a list into a function that produces the identical list. **Chunk 4 is the one that changes request handling** and should not be split across a deploy.

---

## Executed — 2026-08-12

All five chunks landed. Final state: **CMS 23 files / 387 tests**, **frontend 27 files / 246 tests**, both green from a cold start (`rm -rf .strapi dist`). Database identical to baseline: `authenticated|5`, `chapter_admin|30`, `public|29`, 10 users, 3 capabilities.

Seven things the plan got wrong or under-specified, corrected in place:

1. **`published_at` is expected.** Task 1 Step 3 said its presence meant `draftAndPublish` had not taken. False — Strapi 5 puts `document_id`, `locale` and `published_at` on every content type. The real invariant is row count, now tested directly.
2. **`list()` would have 403'd national admins.** It built its filter from `administeredChapters` and refused an empty one, so an unscoped national admin was rejected and then shown nothing. Fixed with `$notNull` rather than `{}` — "every chapter" must not quietly become "no chapter" and start surfacing the chapterless national records `getOne` 404s.
3. **`assertChapterScopeFor`** was added, unplanned. Seven call sites needed the bypass; threading `unscoped` through each by hand is how one gets forgotten, and a forgotten one reads as a data problem rather than a code one.
4. **`makeChapterAdmin` had to attach capabilities.** The boot backfill only sees users that already exist; tests mint theirs afterwards. 67 tests failed until the helper was taught this — expected, and exactly what the plan predicted would happen if the backfill were skipped.
5. **The equivalence test must exclude fabricated accounts.** Several tests deliberately build broken users (the role with no capability) to prove fail-closed. Counting them would assert that a counterexample is not a counterexample.
6. **`email` cannot appear in `populate.fields`** — it is `private: true` and the content-API validator rejects it outright. Use `username`.
7. **The `__capabilities` non-function export is fine.** Flagged as a risk in Task 11; `npm run develop` boots clean, so the fallback module was not needed.

Not done, and needing a human: **clicking through the admin UI.** Verified programmatically instead — the content type is registered, `content-manager` visible, and a capability authored at runtime attaches to a user with no code change (§3.1.1.10). The literal UI walk-through in Task 15 Step 3 is still worth doing once.

Two intermittents observed, neither traced to this work and both worth knowing:

- **The frontend's `auth-outage` / `client-retry` tests failed once** in a full run and passed in isolation and in three subsequent full runs. No frontend file was touched by this plan. Timing-sensitive; pre-existing.
- **Two CMS runs took ~1000s instead of ~16s** and still passed. Cause was concurrent vitest invocations (see precondition 3a) plus leaked fixture users; both are fixed. Two of those slow runs remain unexplained after the fix, so if it recurs, start at precondition 3a rather than at the source.

---

## Chunk 1: The capability collection

### Task 1: `api::member-capability` content type

**Files:**
- Create: `src/api/member-capability/content-types/member-capability/schema.json`
- Create: `src/api/member-capability/controllers/member-capability.js`
- Create: `src/api/member-capability/routes/member-capability.js`
- Create: `src/api/member-capability/services/member-capability.js`

- [ ] **Step 1: Write the schema**

`draftAndPublish` is **false**. This is not a stylistic choice: with it on, every capability is two rows sharing a `documentId`, and a lookup by `slug` returns whichever the query happened to hit. A capability has no editorial lifecycle and nothing about it should ever be "unpublished".

```json
{
  "kind": "collectionType",
  "collectionName": "member_capabilities",
  "info": {
    "singularName": "member-capability",
    "pluralName": "member-capabilities",
    "displayName": "Member Capability",
    "description": "A unit of authority a member may hold. Additive: a user may hold any number, and their grants are the union. Scope is held separately, on the user."
  },
  "options": {
    "draftAndPublish": false
  },
  "pluginOptions": {},
  "attributes": {
    "slug": {
      "type": "uid",
      "targetField": "name",
      "required": true
    },
    "name": {
      "type": "string",
      "required": true
    },
    "description": {
      "type": "text"
    },
    "categories": {
      "type": "json"
    },
    "holders": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "plugin::users-permissions.user",
      "mappedBy": "capabilities"
    }
  }
}
```

`categories` carries the §3.1.1.8 permission categories — Content, Event, Membership, Financial, Communication — so a capability declares *what* it may manage rather than being an opaque label.

> **Owning side.** `holders` is `mappedBy`, so the **user** owns this relation — the mirror of `administeredChapters`, where the *chapter* owns (`chapter.administrators` is `inversedBy`). The two conventions differ on purpose: `capabilities` is the field every read starts from, and the owning side is the one that writes cleanly from a `user.update`. Whichever you pick, `mappedBy` and `inversedBy` must name each other exactly or Strapi builds two unrelated join tables and every populate returns `[]`.

- [ ] **Step 2: Write the three core factory files**

Identical in shape to `src/api/faq/`, which is the house pattern.

`controllers/member-capability.js`:
```js
'use strict';

/**
 * member-capability controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::member-capability.member-capability');
```

`routes/member-capability.js`:
```js
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
```

`services/member-capability.js`:
```js
'use strict';

/**
 * member-capability service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::member-capability.member-capability');
```

- [ ] **Step 3: Boot once so the migration runs, and verify the table**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/committees.test.js
/opt/homebrew/opt/sqlite/bin/sqlite3 .tmp/data.db ".schema member_capabilities"
```

Expected: the integration suite still passes (booting Strapi runs the migration), and `.schema` prints a `member_capabilities` table with `slug`, `name`, `description`, `categories`.

> **A `published_at` column is expected and is not a bug.** Strapi 5 puts `document_id`, `locale` and `published_at` on *every* content type; they are part of the document model, not the draft-and-publish feature. `draftAndPublish: false` changes how many **rows** a document gets, not which columns exist. The invariant to check is therefore row count, and it is checked in Task 2 Step 5 once there is something to count: three seeded capabilities must be three rows, not six.

- [ ] **Step 4: Confirm the full suite is unmoved**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
```

Expected: `21 passed`, `335 passed`. A new collection nothing references changes no test.

- [ ] **Step 5: Commit**

```bash
git add src/api/member-capability
git commit -m "feat: member-capability, the collection authority will be held in"
```

---

### Task 2: Seed the three capabilities

**Files:**
- Create: `src/api/member-capability/seed.js`
- Modify: `src/index.js`
- Test: `tests/integration/capabilities.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/capabilities.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, shutdown } from './helpers.js';

let strapi;
beforeAll(async () => { strapi = await boot(); });
afterAll(shutdown);

describe('capability seed', () => {
  it('creates exactly the three capabilities, each with categories', async () => {
    const rows = await strapi.documents('api::member-capability.member-capability')
      .findMany({ fields: ['slug', 'name', 'categories'], limit: -1, sort: ['slug:asc'] });

    expect(rows.map((r) => r.slug)).toEqual([
      'chapter_admin', 'committee_leader', 'national_admin',
    ]);
    for (const row of rows) {
      expect(Array.isArray(row.categories)).toBe(true);
      expect(row.categories.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — a second seed run creates no duplicates', async () => {
    const { seedCapabilities } = await import('../../src/api/member-capability/seed.js')
      .then((m) => m.default ?? m);
    await seedCapabilities(strapi);

    const count = await strapi.documents('api::member-capability.member-capability')
      .count({});
    expect(count).toBe(3);
  });
});
```

> `seed.js` is CJS, like every other module in `src/`. The dynamic `import()` above resolves the CJS namespace; if `seedCapabilities` comes back `undefined`, use the `createRequire` idiom the other tests already use (`tests/unit/grants.test.js:2`) instead of fighting interop.

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: FAIL — the first test gets `[]`, the second cannot resolve the module.

- [ ] **Step 3: Write `src/api/member-capability/seed.js`**

```js
'use strict';

/**
 * The capabilities created on boot, and the backfill that gives existing users
 * the one matching the role they already hold.
 *
 * DB-stored rather than hard-coded so §3.1.1.10 holds: a new capability can be
 * authored in the admin UI without a deploy. These three are seeded because the
 * system cannot start without them — the backfill and every authorization check
 * name them.
 *
 * `categories` are the §3.1.1.8 permission categories. THE VALUES BELOW ARE A
 * FIRST CUT and are meant to be edited in the admin UI; seeding is create-only,
 * so an edit made there is never overwritten by a later boot.
 */

const CATEGORIES = ['Content', 'Event', 'Membership', 'Financial', 'Communication'];

const CAPABILITIES = [
  {
    slug: 'national_admin',
    name: 'National Admin',
    description:
      'Unscoped authority across every chapter. Bypasses chapter scope by ' +
      'design — see assertChapterScope({ unscoped }).',
    categories: CATEGORIES,
  },
  {
    slug: 'committee_leader',
    name: 'Committee Leader',
    description:
      "Leads one or more committees. Scope is the user's ledCommittees " +
      'relation, per committee, not per chapter.',
    categories: ['Content', 'Event', 'Communication'],
  },
  {
    slug: 'chapter_admin',
    name: 'Chapter Admin',
    description:
      "Manages one or more chapters' own content. Scope is the user's " +
      'administeredChapters relation.',
    categories: ['Content', 'Event', 'Membership', 'Communication'],
  },
];

const UID = 'api::member-capability.member-capability';

/** Create-or-find each capability. Idempotent; never updates an existing row. */
async function seedCapabilities(strapi) {
  const bySlug = {};
  for (const cap of CAPABILITIES) {
    const existing = await strapi.documents(UID).findFirst({
      filters: { slug: cap.slug },
    });
    bySlug[cap.slug] = existing
      ?? await strapi.documents(UID).create({ data: cap });
    if (!existing) strapi.log.info(`Created the "${cap.name}" capability.`);
  }
  return bySlug;
}

module.exports = { CAPABILITIES, CATEGORIES, seedCapabilities, UID };
```

- [ ] **Step 4: Call it from `src/index.js`**

Add the require at the top, beside the grants require:

```js
const { seedCapabilities } = require('./api/member-capability/seed');
```

and, as the **first** thing inside `bootstrap({ strapi })` — before the role work, because Task 3's backfill depends on the rows existing:

```js
    // Capabilities before roles: the backfill below reads them.
    const capabilities = await seedCapabilities(strapi);
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/api/member-capability/seed.js src/index.js tests/integration/capabilities.test.js
git commit -m "feat: seed the three capabilities on boot, create-only"
```

---

## Chunk 2: The additive layer on the user

### Task 3: `User.capabilities`

**Files:**
- Modify: `src/extensions/users-permissions/content-types/user/schema.json`
- Test: `tests/integration/capabilities.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/capabilities.test.js`:

```js
describe('User.capabilities', () => {
  it('holds more than one capability at once — the whole point', async () => {
    const caps = await strapi.documents('api::member-capability.member-capability')
      .findMany({ filters: { slug: { $in: ['national_admin', 'chapter_admin'] } } });
    expect(caps).toHaveLength(2);

    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'multicap@areaa.test', email: 'multicap@areaa.test',
      password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Multi', lastName: 'Cap',
      capabilities: caps.map((c) => c.id),
    });

    const read = await strapi.documents('plugin::users-permissions.user').findOne({
      documentId: user.documentId,
      populate: { capabilities: { fields: ['slug'] } },
    });

    expect(read.capabilities.map((c) => c.slug).sort())
      .toEqual(['chapter_admin', 'national_admin']);

    await strapi.documents('plugin::users-permissions.user')
      .delete({ documentId: user.documentId });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js -t 'more than one'
```

Expected: FAIL — `capabilities` is not an attribute, so it is dropped on write and the populate returns nothing.

- [ ] **Step 3: Add the attribute**

In `src/extensions/users-permissions/content-types/user/schema.json`, after `administeredChapters`:

```json
    "capabilities": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::member-capability.member-capability",
      "inversedBy": "holders"
    },
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm nothing else moved**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
```

Expected: `338 passed` (335 + 3). If `GET /api/users/me` assertions fail here, stop: the new relation is leaking into the sanitized payload, which is Task 16's job to do deliberately, not this task's to do by accident.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/users-permissions/content-types/user/schema.json tests/integration/capabilities.test.js
git commit -m "feat: User.capabilities — a member may hold any number at once"
```

---

### Task 4: `ledCommittees` ⇄ `Committee.leaders`

**Files:**
- Modify: `src/api/committee/content-types/committee/schema.json`
- Modify: `src/extensions/users-permissions/content-types/user/schema.json`
- Test: `tests/integration/capabilities.test.js`

Per decision 1, Committee Leader is scoped **per committee**, not per chapter. This mirrors `administeredChapters` exactly, including which side owns.

- [ ] **Step 1: Write the failing test**

```js
describe('Committee Leader scope', () => {
  it('links a leader to committees by documentId, both ways', async () => {
    const committees = await strapi.documents('api::committee.committee')
      .findMany({ fields: ['name'], limit: 1, status: 'draft' });
    expect(committees).toHaveLength(1);

    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'leader@areaa.test', email: 'leader@areaa.test',
      password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Lead', lastName: 'Er',
      ledCommittees: [committees[0].id],
    });

    const read = await strapi.documents('plugin::users-permissions.user').findOne({
      documentId: user.documentId,
      populate: { ledCommittees: { fields: ['name'] } },
    });
    expect(read.ledCommittees.map((c) => c.documentId))
      .toEqual([committees[0].documentId]);

    const back = await strapi.documents('api::committee.committee').findOne({
      documentId: committees[0].documentId, status: 'draft',
      populate: { leaders: { fields: ['email'] } },
    });
    expect(back.leaders.map((u) => u.email)).toContain('leader@areaa.test');

    await strapi.documents('plugin::users-permissions.user')
      .delete({ documentId: user.documentId });
  });
});
```

> `status: 'draft'` is not decoration. `committee` is draft-and-publish, so linking to the *published* numeric id yields an empty populate and every scope check 403s — the same trap `tests/integration/helpers.js:60` documents for chapters.

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js -t 'both ways'
```

Expected: FAIL — neither attribute exists.

- [ ] **Step 3: Add both sides**

`src/api/committee/content-types/committee/schema.json`, after `members` — the committee owns, mirroring `chapter.administrators`:

```json
    "leaders": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "plugin::users-permissions.user",
      "inversedBy": "ledCommittees"
    },
```

`src/extensions/users-permissions/content-types/user/schema.json`, after `capabilities`:

```json
    "ledCommittees": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::committee.committee",
      "mappedBy": "leaders"
    },
```

> `committee.members` and `committee.leaders` are different relations on purpose. A leader need not be a member and a member is not a leader; collapsing them would make "who may edit this committee" unauthorable.

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Confirm the committee suite is unmoved**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/committees.test.js tests/unit/members.test.js
```

Expected: all pass. `chapterScopedResource` for committees whitelists `['name','description','members']`, so `leaders` is not writable through the chapter-admin API and no editable-fields test should move.

- [ ] **Step 6: Commit**

```bash
git add src/api/committee/content-types/committee/schema.json src/extensions/users-permissions/content-types/user/schema.json tests/integration/capabilities.test.js
git commit -m "feat: ledCommittees/leaders — per-committee scope for Committee Leader"
```

---

### Task 5: Backfill existing users

**Files:**
- Modify: `src/api/member-capability/seed.js`
- Modify: `src/index.js`
- Test: `tests/integration/capabilities.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('backfill', () => {
  it('gives every chapter_admin-role user the chapter_admin capability', async () => {
    const users = await strapi.query('plugin::users-permissions.user').findMany({
      where: { role: { type: 'chapter_admin' } },
      populate: { capabilities: true },
    });
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.capabilities.map((c) => c.slug)).toContain('chapter_admin');
    }
  });

  it('gives ordinary members nothing — Authenticated is a baseline, not a capability', async () => {
    const users = await strapi.query('plugin::users-permissions.user').findMany({
      where: { role: { type: 'authenticated' } },
      populate: { capabilities: true },
    });
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.capabilities).toHaveLength(0);
    }
  });

  it('is idempotent — a second run adds no duplicate link', async () => {
    const { backfillCapabilities } = await import('../../src/api/member-capability/seed.js')
      .then((m) => m.default ?? m);
    const added = await backfillCapabilities(strapi);
    expect(added).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js -t backfill
```

Expected: FAIL — no user holds anything.

- [ ] **Step 3: Add the backfill to `seed.js`**

```js
/**
 * Give every user holding a role that maps to a capability the matching
 * capability, once. Returns how many links were added, so a caller (and the
 * idempotency test) can tell a no-op from work.
 *
 * Only `chapter_admin` maps. `authenticated` deliberately maps to nothing:
 * Authenticated is the baseline every signed-in member has, not a unit of
 * authority, and granting it as a capability would make "holds no capability"
 * unrepresentable.
 *
 * Filtered to the mapped roles rather than scanning every user, so this stays
 * cheap as the membership grows.
 */
const ROLE_TO_CAPABILITY = { chapter_admin: 'chapter_admin' };

async function backfillCapabilities(strapi) {
  const bySlug = await seedCapabilities(strapi);
  let added = 0;

  for (const [roleType, slug] of Object.entries(ROLE_TO_CAPABILITY)) {
    const capability = bySlug[slug];
    if (!capability) continue;

    const users = await strapi.query('plugin::users-permissions.user').findMany({
      where: { role: { type: roleType } },
      populate: { capabilities: true },
    });

    for (const user of users) {
      const held = (user.capabilities ?? []).map((c) => c.slug);
      if (held.includes(slug)) continue;

      // Numeric ids here, not documentIds: `query` is the ORM layer and
      // member-capability is not draft-and-publish, so one row is one id.
      await strapi.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { capabilities: [...(user.capabilities ?? []).map((c) => c.id), capability.id] },
      });
      added += 1;
    }
  }

  if (added > 0) strapi.log.info(`Backfilled ${added} capability link(s).`);
  return added;
}
```

Export it: `module.exports = { CAPABILITIES, CATEGORIES, ROLE_TO_CAPABILITY, seedCapabilities, backfillCapabilities, UID };`

- [ ] **Step 4: Call it from `src/index.js`**

Replace the Task 2 line with:

```js
    const { backfillCapabilities } = require('./api/member-capability/seed');
```

and at the **end** of `bootstrap`, after the role work — the backfill reads `role.type`, so the roles must exist first:

```js
    // Day-one equivalence: every existing admin ends up holding the capability
    // that matches the role they already had, so nothing changes behaviour.
    await backfillCapabilities(strapi);
```

> Order matters and is the opposite of Task 2's. `seedCapabilities` runs first (rows must exist); `backfillCapabilities` runs last (roles must exist). `backfillCapabilities` calls `seedCapabilities` itself, so it is safe standalone — the early call in `bootstrap` stays only to make the ordering explicit at the top of the function.

- [ ] **Step 5: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Verify against the database directly**

```bash
/opt/homebrew/opt/sqlite/bin/sqlite3 .tmp/data.db \
  "select u.email, c.slug from up_users u
   join up_users_capabilities_lnk l on l.user_id = u.id
   join member_capabilities c on c.id = l.member_capability_id
   order by u.email;"
```

Expected: exactly the two `chapter_admin` users, each with `chapter_admin`. **If the link table has a different name**, find it — `.tables` and grep for `capabilit` — and record the real name in this document, because Chunk 5's equivalence check queries it.

- [ ] **Step 7: Commit**

```bash
git add src/api/member-capability/seed.js src/index.js tests/integration/capabilities.test.js
git commit -m "feat: backfill capabilities from role.type, idempotently"
```

---

## Chunk 3: Collapse the grant duplication

### Task 6: `grantsFor()` — union, never override

**Files:**
- Modify: `src/api/chapter-admin/grants.js`
- Test: `tests/unit/capabilities.test.js`

This is proposal item 4 and test-plan item 1. Note carefully what does and does not change: the `chapter_admin` **role** must still end up with all 30 actions in the database, because it is still the coarse route gate and `/api/users/me` is still behind it. What disappears is the duplication **in the source** — no authored list spreads another; the role's list is *derived*.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/capabilities.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AUTHENTICATED_GRANTS, CAPABILITY_GRANTS, CHAPTER_ADMIN_GRANTS, grantsFor,
} = require('../../src/api/chapter-admin/grants.js');

describe('grantsFor', () => {
  it('always includes the authenticated baseline, even for no capability', () => {
    expect(grantsFor([]).sort()).toEqual([...AUTHENTICATED_GRANTS].sort());
  });

  it('unions two capabilities rather than letting the last one win', () => {
    const both = grantsFor(['national_admin', 'chapter_admin']);
    for (const action of CAPABILITY_GRANTS.chapter_admin) {
      expect(both).toContain(action);
    }
    for (const action of CAPABILITY_GRANTS.national_admin) {
      expect(both).toContain(action);
    }
    for (const action of AUTHENTICATED_GRANTS) {
      expect(both).toContain(action);
    }
  });

  it('is order-independent', () => {
    expect(grantsFor(['national_admin', 'chapter_admin']))
      .toEqual(grantsFor(['chapter_admin', 'national_admin']));
  });

  it('de-duplicates an action two capabilities both grant', () => {
    const both = grantsFor(['national_admin', 'chapter_admin']);
    expect(new Set(both).size).toBe(both.length);
  });

  it('ignores an unrecognised capability rather than throwing', () => {
    // Capabilities are authorable in the admin UI, so an unknown slug is a
    // routine state, not a bug. It grants nothing — fail closed — but it must
    // not take the boot down with it.
    expect(grantsFor(['no_such_capability']).sort())
      .toEqual([...AUTHENTICATED_GRANTS].sort());
  });

  it('no authored list spreads another', () => {
    for (const [slug, actions] of Object.entries(CAPABILITY_GRANTS)) {
      for (const authenticated of AUTHENTICATED_GRANTS) {
        expect(actions, `${slug} re-lists ${authenticated}`).not.toContain(authenticated);
      }
    }
  });

  it('reproduces the shipped chapter-admin grant list exactly', () => {
    // 30 distinct actions: the 5 authenticated + the 25 chapter-admin ones.
    expect(CHAPTER_ADMIN_GRANTS).toHaveLength(30);
    expect(new Set(CHAPTER_ADMIN_GRANTS).size).toBe(30);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/capabilities.test.js
```

Expected: FAIL — `grantsFor` and `CAPABILITY_GRANTS` are not exported.

- [ ] **Step 3: Restructure `grants.js`**

Keep `AUTHENTICATED_GRANTS` and `PUBLIC_GRANTS` exactly as they are. Replace the `CHAPTER_ADMIN_GRANTS` array with:

```js
/**
 * Actions each capability grants, keyed by capability slug.
 *
 * NO list here spreads another. That is the point of the whole change: with one
 * role per user, a Chapter Admin who is also a Committee Leader needed a THIRD
 * role re-listing both sets, and every later edit had to be applied to every
 * combination containing it. Composition happens in grantsFor().
 *
 * The authenticated baseline is NOT repeated here — grantsFor() always adds it.
 */
const CAPABILITY_GRANTS = {
  // Unscoped by decision: a National Admin reaches every chapter. Same action
  // surface as chapter_admin today; 4C adds its own routes on top.
  national_admin: [
    'api::chapter-admin.chapter-admin.getEvent',
    // …all 25, verbatim from the previous CHAPTER_ADMIN_GRANTS body
  ],

  // Scoped per committee via user.ledCommittees. No routes grant these yet —
  // the capability is holdable, scoped and tested, and the endpoints arrive
  // with the committee-leader UI.
  committee_leader: [
    'api::chapter-admin.chapter-admin.getCommittee',
    'api::chapter-admin.chapter-admin.listCommittees',
    'api::chapter-admin.chapter-admin.createCommittee',
    'api::chapter-admin.chapter-admin.updateCommittee',
    'api::chapter-admin.chapter-admin.deleteCommittee',
  ],

  // Scoped per chapter via user.administeredChapters. The 25 actions that were
  // authored inline here before, unchanged.
  chapter_admin: [
    'api::chapter-admin.chapter-admin.getEvent',
    // …the same 25
  ],
};

/**
 * The union of the authenticated baseline and every held capability's grants.
 *
 * Union, never last-write: two capabilities compose, they do not shadow. An
 * unrecognised slug grants nothing and does not throw — capabilities are
 * authorable in the admin UI, so an unknown one is a routine state, and taking
 * the boot down over it would be a worse failure than ignoring it. Sorted so
 * the output is comparable.
 */
function grantsFor(capabilitySlugs) {
  const out = new Set(AUTHENTICATED_GRANTS);
  for (const slug of capabilitySlugs ?? []) {
    for (const action of CAPABILITY_GRANTS[slug] ?? []) out.add(action);
  }
  return [...out].sort();
}

// Derived, not authored — the role still needs all 30 actions in the database
// because it is still the coarse route gate. Exported under the old name so
// src/index.js and tests/unit/grants.test.js keep working.
const CHAPTER_ADMIN_GRANTS = grantsFor(['chapter_admin']);

module.exports = {
  AUTHENTICATED_GRANTS, CAPABILITY_GRANTS, CHAPTER_ADMIN_GRANTS,
  PUBLIC_GRANTS, grantsFor,
};
```

> **`national_admin` and `chapter_admin` list the same 25 actions.** That is duplication of a kind, but not the kind this plan is removing: these are two independent authority definitions that happen to coincide today and will diverge the moment 4C adds national-only endpoints. Do **not** define one in terms of the other — that reintroduces exactly the coupling the change exists to remove.

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/capabilities.test.js tests/unit/grants.test.js
```

Expected: PASS. `grants.test.js` is untouched and must still pass — it diffs `CHAPTER_ADMIN_GRANTS` against the controller's exports, and the derived list is the same 25 actions.

- [ ] **Step 5: Prove the database is unchanged**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/events.test.js
/opt/homebrew/opt/sqlite/bin/sqlite3 .tmp/data.db \
  "select count(distinct p.action) from up_permissions p
   join up_permissions_role_lnk l on l.permission_id = p.id
   join up_roles r on r.id = l.role_id where r.type = 'chapter_admin';"
```

Expected: **30**, exactly the baseline. A different number means the refactor changed the role's actual authority and must be fixed before going further.

- [ ] **Step 6: Commit**

```bash
git add src/api/chapter-admin/grants.js tests/unit/capabilities.test.js
git commit -m "refactor: grants compose per capability; no list spreads another"
```

---

## Chunk 4: Enforcement — the only chunk that changes behaviour

### Task 7: `assertCapability` and the implication map

**Files:**
- Create: `src/api/chapter-admin/services/capabilities.js`
- Test: `tests/unit/capabilities.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/capabilities.test.js`:

```js
const {
  assertCapability, heldWithImplied, IMPLIES, CAPABILITY_SLUGS,
} = require('../../src/api/chapter-admin/services/capabilities.js');
const { ScopeError } = require('../../src/api/chapter-admin/services/scope.js');

describe('assertCapability', () => {
  it('allows a capability held directly', () => {
    expect(assertCapability(['chapter_admin'], 'chapter_admin')).toBe(true);
  });

  it('rejects one not held', () => {
    expect(() => assertCapability(['committee_leader'], 'chapter_admin'))
      .toThrow(ScopeError);
  });

  it('rejects when nothing is held', () => {
    expect(() => assertCapability([], 'chapter_admin')).toThrow(ScopeError);
    expect(() => assertCapability(undefined, 'chapter_admin')).toThrow(ScopeError);
  });

  it('fails closed when the route declares no capability', () => {
    // A handler wired without a declared capability must be unreachable, not
    // wide open. This is the failure mode the whole design has to survive.
    for (const bad of [null, undefined, '']) {
      expect(() => assertCapability(['chapter_admin'], bad)).toThrow(ScopeError);
    }
  });

  it('does not treat a substring as a hit', () => {
    expect(() => assertCapability(['chapter_admin_x'], 'chapter_admin'))
      .toThrow(ScopeError);
  });

  it('lets national_admin stand in for chapter_admin, by declaration', () => {
    expect(assertCapability(['national_admin'], 'chapter_admin')).toBe(true);
    expect(IMPLIES.national_admin).toContain('chapter_admin');
  });

  it('does not imply in the other direction', () => {
    expect(() => assertCapability(['chapter_admin'], 'national_admin'))
      .toThrow(ScopeError);
  });

  it('every implied slug is a real capability', () => {
    for (const implied of Object.values(IMPLIES).flat()) {
      expect(CAPABILITY_SLUGS).toContain(implied);
    }
  });
});

describe('heldWithImplied', () => {
  it('expands one held capability into everything it implies', () => {
    expect([...heldWithImplied(['national_admin'])].sort())
      .toEqual(['chapter_admin', 'national_admin']);
  });

  it('is a no-op for a capability that implies nothing', () => {
    expect([...heldWithImplied(['committee_leader'])]).toEqual(['committee_leader']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/capabilities.test.js
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `src/api/chapter-admin/services/capabilities.js`**

```js
'use strict';

// ScopeError by direct require, never via strapi.service(...). Strapi's
// loadFiles deletes the require cache per file, so a service-registry lookup
// can hand back a DIFFERENT class object and `instanceof` silently fails —
// which would turn every 403 into a 500. Same reason as
// controllers/chapter-admin.js:4.
const { ScopeError } = require('./scope');

/** The seeded capabilities. Mirrors src/api/member-capability/seed.js. */
const CAPABILITY_SLUGS = ['national_admin', 'committee_leader', 'chapter_admin'];

/**
 * Capabilities that stand in for others. DECLARED, not buried in a conditional,
 * so "what does National Admin actually let me do" is answerable by reading one
 * object.
 *
 * National Admin implies Chapter Admin because unscoped authority over every
 * chapter is a superset of authority over some of them. The alternative —
 * requiring both to be assigned by hand — is one data-entry slip away from the
 * bug this codebase already shipped once: a member with the scope link and the
 * wrong role passed every frontend guard and then got 403 from every API call
 * behind it, showing six panels each blaming something different.
 */
const IMPLIES = { national_admin: ['chapter_admin'] };

/** The held slugs plus everything they imply, transitively-free (one level). */
function heldWithImplied(heldSlugs) {
  const out = new Set();
  for (const slug of heldSlugs ?? []) {
    out.add(slug);
    for (const implied of IMPLIES[slug] ?? []) out.add(implied);
  }
  return out;
}

/**
 * The capability half of the authorization rule. Pure.
 *
 * Throws unless `requiredSlug` is held, directly or by implication. A missing
 * `requiredSlug` throws rather than passing: a handler wired without a declared
 * capability must be unreachable, not unguarded. Failing closed matters more
 * here than a helpful error.
 */
function assertCapability(heldSlugs, requiredSlug) {
  if (!requiredSlug) {
    throw new ScopeError('No capability declared for this route');
  }
  if (!heldWithImplied(heldSlugs).has(requiredSlug)) {
    throw new ScopeError('Capability not held by this user');
  }
  return true;
}

module.exports = { CAPABILITY_SLUGS, IMPLIES, assertCapability, heldWithImplied };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/capabilities.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/services/capabilities.js tests/unit/capabilities.test.js
git commit -m "feat: assertCapability, with a declared implication map"
```

---

### Task 8: National Admin bypasses chapter scope

**Files:**
- Modify: `src/api/chapter-admin/services/scope.js`
- Test: `tests/unit/scope.test.js`

Decision 2. The bypass is deliberately narrow: it says nothing about *which* chapter, and nothing about whether there is one.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/scope.test.js`, inside the existing `assertChapterScope` describe:

```js
  it('lets an unscoped caller through for any chapter', () => {
    expect(assertChapterScope([], 'doc-anything', { unscoped: true })).toBe(true);
    expect(assertChapterScope(undefined, 'doc-anything', { unscoped: true })).toBe(true);
  });

  it('still fails closed on a missing target when unscoped', () => {
    // National Admin bypasses WHICH chapter, never WHETHER there is one. A
    // request that names no chapter is malformed regardless of who sent it,
    // and answering it would mean guessing which records to act on.
    for (const bad of [null, undefined, '']) {
      expect(() => assertChapterScope(['doc-a'], bad, { unscoped: true }))
        .toThrow(ScopeError);
    }
  });

  it('defaults to scoped when no options are passed', () => {
    expect(() => assertChapterScope(['doc-a'], 'doc-c')).toThrow(ScopeError);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/scope.test.js
```

Expected: FAIL on the first two — the third argument is ignored today, so an unscoped call still throws.

- [ ] **Step 3: Add the option**

In `src/api/chapter-admin/services/scope.js`, amend the signature and the docblock:

```js
/**
 * […existing docblock…]
 *
 * `unscoped` is the National Admin bypass, and it is deliberately narrow: it
 * skips the membership test only. A missing target still throws, because
 * bypassing WHICH chapter is not the same as bypassing WHETHER there is one —
 * a request naming no chapter is malformed no matter who sent it.
 */
function assertChapterScope(
  administeredChapterDocumentIds,
  targetChapterDocumentId,
  { unscoped = false } = {}
) {
  if (!targetChapterDocumentId) {
    throw new ScopeError('No target chapter on this request');
  }
  if (unscoped) return true;
  const allowed = (administeredChapterDocumentIds || []).map(String);
  if (!allowed.includes(String(targetChapterDocumentId))) {
    throw new ScopeError('Chapter not administered by this user');
  }
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/scope.test.js
```

Expected: PASS. Every pre-existing assertion in that file must still pass untouched — the default is scoped, so no caller changes meaning.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/services/scope.js tests/unit/scope.test.js
git commit -m "feat: assertChapterScope({ unscoped }) — the National Admin bypass"
```

---

### Task 9: `assertCommitteeScope`

**Files:**
- Modify: `src/api/chapter-admin/services/scope.js`
- Test: `tests/unit/scope.test.js`

Test-plan item 2: the committee cross-scope attack, mirroring the existing cross-chapter test.

- [ ] **Step 1: Write the failing test**

```js
describe('assertCommitteeScope', () => {
  it('allows a documentId the user leads', () => {
    expect(assertCommitteeScope(['cmt-a', 'cmt-b'], 'cmt-a')).toBe(true);
  });

  it('rejects a committee they do not lead — the cross-scope attack', () => {
    expect(() => assertCommitteeScope(['cmt-a'], 'cmt-c')).toThrow(ScopeError);
  });

  it('rejects when the user leads nothing', () => {
    expect(() => assertCommitteeScope([], 'cmt-a')).toThrow(ScopeError);
    expect(() => assertCommitteeScope(undefined, 'cmt-a')).toThrow(ScopeError);
  });

  it('fails closed on a missing target', () => {
    for (const bad of [null, undefined, '']) {
      expect(() => assertCommitteeScope(['cmt-a'], bad)).toThrow(ScopeError);
    }
  });

  it('does not treat a substring as a hit', () => {
    expect(() => assertCommitteeScope(['cmt-ab'], 'cmt-a')).toThrow(ScopeError);
  });

  it('compares documentIds, so a numeric entry id is never a hit', () => {
    // `committee` is draft-and-publish: one document, two rows, two numeric
    // ids, one documentId. Comparing entry ids rejects every legitimate
    // request while looking like a working check.
    expect(() => assertCommitteeScope(['cmt-a'], 42)).toThrow(ScopeError);
  });

  it('lets an unscoped caller through, and still needs a target', () => {
    expect(assertCommitteeScope([], 'cmt-anything', { unscoped: true })).toBe(true);
    expect(() => assertCommitteeScope([], null, { unscoped: true })).toThrow(ScopeError);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/scope.test.js
```

Expected: FAIL — `assertCommitteeScope` is not exported.

- [ ] **Step 3: Implement it**

```js
/**
 * The committee half of the same invariant. Committee Leader is scoped PER
 * COMMITTEE, not per chapter, so this reads `ledCommittees` and never derives
 * membership from the committee's chapter.
 *
 * Same rules throughout: documentIds only, missing target throws, `unscoped`
 * skips only the membership test.
 */
function assertCommitteeScope(
  ledCommitteeDocumentIds,
  targetCommitteeDocumentId,
  { unscoped = false } = {}
) {
  if (!targetCommitteeDocumentId) {
    throw new ScopeError('No target committee on this request');
  }
  if (unscoped) return true;
  const allowed = (ledCommitteeDocumentIds || []).map(String);
  if (!allowed.includes(String(targetCommitteeDocumentId))) {
    throw new ScopeError('Committee not led by this user');
  }
  return true;
}
```

Add it to the module exports.

> The near-duplication with `assertChapterScope` is deliberate. Folding them into one parameterised function saves nine lines and costs the thing that makes them readable: each states its own invariant in its own words, and each is the first thing someone reads when auditing "can a leader reach another chapter's committee?" Two short, obvious functions beat one clever one at a security boundary.

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/scope.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/chapter-admin/services/scope.js tests/unit/scope.test.js
git commit -m "feat: assertCommitteeScope — per-committee, documentId-keyed"
```

---

### Task 10: `resolveAuthority` — one query, three answers

**Files:**
- Modify: `src/api/chapter-admin/services/scope.js`
- Test: `tests/unit/scope.test.js`

`resolveAdministeredChapters` costs one query and memoizes on the context. Adding two more resolvers naively would make three round trips per request for data that lives on one row.

- [ ] **Step 1: Write the failing test**

```js
describe('resolveAuthority', () => {
  const fakeStrapi = (user, counter) => ({
    documents: () => ({
      findOne: async () => { counter.n += 1; return user; },
    }),
  });

  const USER = {
    documentId: 'u1',
    capabilities: [{ slug: 'chapter_admin' }, { slug: 'national_admin' }],
    administeredChapters: [{ id: 55, documentId: 'chap-a', slug: 'boston' }],
    ledCommittees: [{ id: 9, documentId: 'cmt-a', name: 'Events' }],
  };

  it('returns capabilities, chapters and committees as documentIds/slugs', async () => {
    const ctx = { state: { user: { documentId: 'u1' } } };
    const auth = await resolveAuthority(ctx, fakeStrapi(USER, { n: 0 }));
    expect([...auth.capabilities].sort()).toEqual(['chapter_admin', 'national_admin']);
    expect(auth.chapters).toEqual(['chap-a']);
    expect(auth.committees).toEqual(['cmt-a']);
  });

  it('costs exactly one query per request, memoized on the context', async () => {
    const counter = { n: 0 };
    const ctx = { state: { user: { documentId: 'u1' } } };
    const strapi = fakeStrapi(USER, counter);
    await resolveAuthority(ctx, strapi);
    await resolveAuthority(ctx, strapi);
    await resolveAdministeredChapters(ctx, strapi);
    expect(counter.n).toBe(1);
  });

  it('is empty, not undefined, for a user holding nothing', async () => {
    const ctx = { state: { user: { documentId: 'u2' } } };
    const auth = await resolveAuthority(ctx, fakeStrapi({ documentId: 'u2' }, { n: 0 }));
    expect([...auth.capabilities]).toEqual([]);
    expect(auth.chapters).toEqual([]);
    expect(auth.committees).toEqual([]);
  });
});
```

The second test also pins that `resolveAdministeredChapters` keeps sharing the memo — every existing caller must get the cached answer, not a second query.

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/scope.test.js -t resolveAuthority
```

Expected: FAIL — not exported.

- [ ] **Step 3: Implement, and re-point the existing resolver at it**

```js
/**
 * Everything this request's user is allowed to be, in one query.
 *
 * `ctx.state.user` arrives without relations, so this costs one round trip,
 * memoized on the context. Capabilities, chapter scope and committee scope all
 * live on the same row; fetching them separately would be three queries for one
 * read. `strapiInstance` is injected so this is testable without a boot.
 */
async function resolveAuthority(ctx, strapiInstance = global.strapi) {
  if (ctx.state.authority) return ctx.state.authority;

  const user = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findOne({
      documentId: ctx.state.user.documentId,
      populate: {
        capabilities: { fields: ['slug'] },
        administeredChapters: { fields: ['slug'] },
        ledCommittees: { fields: ['name'] },
      },
    });

  const authority = {
    capabilities: new Set((user?.capabilities ?? []).map((c) => c.slug)),
    chapters: (user?.administeredChapters ?? []).map((c) => c.documentId),
    committees: (user?.ledCommittees ?? []).map((c) => c.documentId),
  };

  ctx.state.authority = authority;
  // Kept in step so resolveAdministeredChapters' own memo never diverges.
  ctx.state.administeredChapterIds = authority.chapters;
  return authority;
}

/** Back-compat shim: the chapter half of resolveAuthority, same memo. */
async function resolveAdministeredChapters(ctx, strapiInstance = global.strapi) {
  if (ctx.state.administeredChapterIds) return ctx.state.administeredChapterIds;
  const { chapters } = await resolveAuthority(ctx, strapiInstance);
  return chapters;
}
```

Add `resolveAuthority` to the exports; keep `resolveAdministeredChapters` exported.

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/scope.test.js
```

Expected: PASS, including the pre-existing `resolveAdministeredChapters` tests, which must not be edited.

- [ ] **Step 5: Confirm the integration suite still passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration --reporter=dot
```

Expected: `133 passed` plus this plan's new capability tests. This is the first change that touches the live request path for every existing handler; if anything 403s that did not before, the populate names in `resolveAuthority` are wrong.

- [ ] **Step 6: Commit**

```bash
git add src/api/chapter-admin/services/scope.js tests/unit/scope.test.js
git commit -m "refactor: resolveAuthority — capabilities and both scopes in one query"
```

---

### Task 11: `guarded` requires a declared capability

**Files:**
- Modify: `src/api/chapter-admin/controllers/chapter-admin.js`
- Modify: `src/api/chapter-admin/routes/chapter-admin.js` (comment only)
- Test: `tests/unit/grants.test.js`

This is where the fine check actually starts running, and where the structural defence goes in.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/grants.test.js`:

```js
describe('every action is capability-guarded', () => {
  it('declares a capability for every exported controller action', () => {
    // The route table is now a COARSE gate: the role says "some kind of admin",
    // and the specific capability is asserted in the handler, because a union
    // of two capabilities is not expressible per-role. That makes the in-handler
    // check load-bearing, so an unwrapped handler is a hole. Diff the lists —
    // counting cannot catch an omission.
    expect(typeof controller.__capabilities).toBe('object');
    expect(Object.keys(controller.__capabilities).sort())
      .toEqual([...controllerActions].sort());
  });

  it('names a real capability for each', () => {
    const { CAPABILITY_SLUGS } = require('../../src/api/chapter-admin/services/capabilities.js');
    for (const [action, slug] of Object.entries(controller.__capabilities)) {
      expect(CAPABILITY_SLUGS, `${action} declares ${slug}`).toContain(slug);
    }
  });
});
```

Also update the existing `controllerActions` derivation at the top of that file so the metadata key is excluded:

```js
const controllerActions = Object.keys(controller).filter((k) => !k.startsWith('__'));
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/unit/grants.test.js
```

Expected: FAIL — `__capabilities` is undefined.

- [ ] **Step 3: Change `guarded` to take the capability first, and record it**

Replace the `guarded` definition in `controllers/chapter-admin.js`:

```js
// Which capability each exported action requires. Populated by `guarded`, read
// by tests/unit/grants.test.js — so an action that is exported without going
// through `guarded` fails the suite rather than shipping unguarded.
const DECLARED = {};

/**
 * Capability + error translation, in that order.
 *
 * `capability` is REQUIRED and asserted before the handler runs. It cannot be
 * defaulted: with the fine check living here rather than in the route table, a
 * handler wrapped without one would be reachable by anyone the coarse role gate
 * lets through.
 *
 * ScopeError -> 403; client-input errors -> 400; everything else surfaces.
 */
const guarded = (capability, handler) => {
  if (!capability) {
    throw new Error('guarded() needs a capability — see plan 8, Task 11');
  }
  return async (ctx) => {
    try {
      const { capabilities } = await resolveAuthority(ctx);
      assertCapability(capabilities, capability);
      return await handler(ctx);
    } catch (err) {
      if (err instanceof ScopeError) return ctx.forbidden(err.message);
      if (err instanceof BadInputError || err instanceof SlugError) {
        return ctx.badRequest(err.message);
      }
      throw err;
    }
  };
};

/** `guarded`, plus recording the declaration for the wiring test. */
const declare = (name, capability, handler) => {
  DECLARED[name] = capability;
  return guarded(capability, handler);
};
```

Update the requires at the top of the file to pull in `resolveAuthority` and `assertCapability`:

```js
const {
  ScopeError, resolveAdministeredChapters, resolveAuthority, assertChapterScope,
} = require('../services/scope');
const { assertCapability } = require('../services/capabilities');
```

- [ ] **Step 4: Re-wire every export through `declare`**

Every one of the 25 actions takes `'chapter_admin'`. They are all chapter-scoped today; National Admin reaches them through the implication map, not through a second declaration.

```js
module.exports = {
  getEvent: declare('getEvent', 'chapter_admin', events.getOne),
  listEvents: declare('listEvents', 'chapter_admin', events.list),
  // …and so on for all 25
  __capabilities: DECLARED,
};
```

**`uploadMedia` must be wrapped too.** It is a bare `async (ctx)` today and its comment says "Role-gated only" — an assumption this plan invalidates. Extract its body to a local `async function uploadMediaHandler(ctx)` and export:

```js
  uploadMedia: declare('uploadMedia', 'chapter_admin', uploadMediaHandler),
```

> **If Strapi's controller loader objects to the non-function `__capabilities` export**, do not fight it: move `DECLARED` into its own module (`src/api/chapter-admin/declared.js`), have `declare` write to it, and point the test at that module instead. The invariant being tested — every exported action went through `declare` with a real capability — is unchanged; only where the map is read from moves. Check `npm run develop` boots cleanly before assuming the export is fine.

Its scope comment stays true and gets sharper:

```js
  // Capability-gated but NOT scope-checked: an upload has no owning chapter
  // until a record references it, so there is no target to scope against. The
  // record that references it is scope-checked on write.
```

- [ ] **Step 5: Update the route table's header comment**

In `routes/chapter-admin.js`, replace "That is the CAPABILITY check" with the truth as of this plan:

```js
 * Every route is authenticated-plus-role: users-permissions rejects the request
 * before the handler runs unless the caller's role has the matching action
 * granted. That is a COARSE capability check — the role only says "some kind of
 * admin", because a union of two capabilities is not expressible per-role
 * (user.role is manyToOne).
 *
 * The SPECIFIC capability and the SCOPE are both enforced inside each handler,
 * by `guarded` and by assertChapterScope/assertCommitteeScope respectively.
 * Neither is expressible in this table.
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
```

Expected: everything green. The `chapter_admin` users hold the `chapter_admin` capability from Task 5's backfill, so every existing integration test exercises the new check and passes unchanged. **If integration tests 403 here, the backfill did not run** — check that `bootstrap` calls `backfillCapabilities` and that the test users were created before it ran.

- [ ] **Step 7: Commit**

```bash
git add src/api/chapter-admin/controllers/chapter-admin.js src/api/chapter-admin/routes/chapter-admin.js tests/unit/grants.test.js
git commit -m "feat: every chapter-admin action declares and asserts a capability"
```

---

### Task 12: Fail-closed, proved end to end

**Files:**
- Modify: `tests/integration/helpers.js`
- Test: `tests/integration/capabilities.test.js`

Test-plan item 3. Unit tests prove the functions fail closed; this proves the wiring does.

- [ ] **Step 1: Teach `helpers.js` about capabilities**

`makeChapterAdmin` currently sets `role` and `administeredChapters`. Add the capability, and add a second helper that deliberately withholds it:

```js
/** Look up a capability by slug. Numeric id — not draft-and-publish. */
export async function capabilityId(strapi, slug) {
  const cap = await strapi.documents('api::member-capability.member-capability')
    .findFirst({ filters: { slug } });
  if (!cap) throw new Error(`No such capability: ${slug}`);
  return cap.id;
}

/** Create a chapter admin. `chapterIds` are numeric DRAFT entry ids. */
export async function makeChapterAdmin(strapi, { email, chapterIds, capabilities = ['chapter_admin'] }) {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'chapter_admin' } });

  const capIds = [];
  for (const slug of capabilities) capIds.push(await capabilityId(strapi, slug));

  return strapi.plugin('users-permissions').service('user').add({
    username: email, email, password: 'Password123!', confirmed: true,
    provider: 'local',
    firstName: 'Test', lastName: 'Admin',
    role: role.id,
    administeredChapters: chapterIds,
    capabilities: capIds,
  });
}
```

Every existing caller keeps working — `capabilities` defaults to the one they implicitly had.

- [ ] **Step 2: Write the failing test**

```js
import request from 'supertest';
import { boot, shutdown, draftChapters, jwtFor, makeChapterAdmin } from './helpers.js';

describe('fail closed', () => {
  it('403s a user with the role and the scope but no capability', async () => {
    // The exact shape of the bug this codebase already shipped once, inverted:
    // scope and role present, authority absent. It must be a clean 403, not a
    // 500 and not a silent success.
    const [chapter] = await draftChapters(strapi, 1);
    const user = await makeChapterAdmin(strapi, {
      email: 'nocap@areaa.test', chapterIds: [chapter.id], capabilities: [],
    });
    const jwt = await jwtFor(strapi, user.id);

    const res = await request(strapi.server.httpServer)
      .get(`/api/chapter-admin/events?chapterSlug=${chapter.slug}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(403);
  });

  it('403s a committee leader who holds no chapter capability', async () => {
    // committee_leader has no routes yet by design. Holding it must not open
    // the chapter-admin surface — the cross-capability attack.
    const [chapter] = await draftChapters(strapi, 1);
    const user = await makeChapterAdmin(strapi, {
      email: 'leaderonly@areaa.test', chapterIds: [chapter.id],
      capabilities: ['committee_leader'],
    });
    const jwt = await jwtFor(strapi, user.id);

    const res = await request(strapi.server.httpServer)
      .get(`/api/chapter-admin/events?chapterSlug=${chapter.slug}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(403);
  });

  it('200s a national admin for a chapter they do not administer', async () => {
    // Decision 2: bypass. Scope link deliberately empty.
    const [chapter] = await draftChapters(strapi, 1);
    const user = await makeChapterAdmin(strapi, {
      email: 'national@areaa.test', chapterIds: [],
      capabilities: ['national_admin'],
    });
    const jwt = await jwtFor(strapi, user.id);

    const res = await request(strapi.server.httpServer)
      .get(`/api/chapter-admin/events?chapterSlug=${chapter.slug}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2a: The third test will fail, and that is the point**

`resolveScopedChapter` calls `assertChapterScope(administered, chapter.documentId)` with no options, so a national admin with no `administeredChapters` is rejected. Decision 2 says they must not be. **Fix it in the same task**, in `controllers/chapter-admin.js`:

```js
async function resolveScopedChapter(ctx, rawSlug) {
  const { capabilities, chapters } = await resolveAuthority(ctx);
  const chapterSlug = firstStr(rawSlug);
  if (!chapterSlug) return { error: 'chapterSlug is required' };

  const chapter = await strapi.documents('api::chapter.chapter').findFirst({
    filters: { slug: chapterSlug }, fields: ['name', 'slug', 'email'], status: 'draft',
  });
  if (!chapter) return { error: 'No such chapter', notFound: true };

  // National Admin is unscoped by decision — see plan 8, decision 2. The
  // missing-target case above still rejects everyone, national included.
  assertChapterScope(chapters, chapter.documentId, {
    unscoped: capabilities.has('national_admin'),
  });
  return { chapter };
}
```

Then find every other `assertChapterScope(` call site — `resource-factory.js` is the big one — and give each the same `unscoped` treatment. **Grep, do not assume:**

```bash
grep -rn "assertChapterScope(" src/
```

Every hit must either pass `unscoped` or carry a one-line comment saying why national admins are deliberately excluded there. A hit with neither is the hole this task exists to close.

- [ ] **Step 3: Run the tests to verify they pass**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: PASS.

- [ ] **Step 4: Run everything**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/helpers.js tests/integration/capabilities.test.js src/api/chapter-admin
git commit -m "feat: national admins bypass chapter scope; everyone else fails closed"
```

---

## Chunk 5: Exposure, equivalence, and the gate

### Task 13: `capabilities` on `GET /api/users/me`

**Files:**
- Modify: `src/extensions/users-permissions/strapi-server.js`
- Test: `tests/integration/capabilities.test.js`

The frontend does not use this yet — it is what lets a later plan replace `hasChapterAdminRole`'s string comparison with a capability check.

- [ ] **Step 1: Write the failing test**

```js
it('exposes capabilities on GET /api/users/me', async () => {
  const [chapter] = await draftChapters(strapi, 1);
  const user = await makeChapterAdmin(strapi, {
    email: 'mecaps@areaa.test', chapterIds: [chapter.id],
    capabilities: ['chapter_admin', 'national_admin'],
  });
  const jwt = await jwtFor(strapi, user.id);

  const res = await request(strapi.server.httpServer)
    .get('/api/users/me').set('Authorization', `Bearer ${jwt}`);

  expect(res.status).toBe(200);
  expect(res.body.capabilities.map((c) => c.slug).sort())
    .toEqual(['chapter_admin', 'national_admin']);
  // Unchanged: the existing shape must survive.
  expect(res.body.role.type).toBe('chapter_admin');
  expect(Array.isArray(res.body.administeredChapters)).toBe(true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Expected: FAIL — `res.body.capabilities` is undefined.

- [ ] **Step 3: Re-attach it in `readSelf`**

Add to the `populate` block:

```js
          capabilities: { fields: ['slug', 'name'] },
```

and after the `administeredChapters` re-attach:

```js
    // Same technique as `chapter` and `role` above: the sanitizer drops this
    // because the Authenticated role has no read-grant on the capability type.
    // Always an array, never undefined, so callers need no guard. Slug + name
    // only — `categories` is the authority model and no client needs it.
    body.capabilities = (user?.capabilities ?? []).map((c) => ({
      slug: c.slug, name: c.name,
    }));
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: PASS.

- [ ] **Step 5: Check the frontend did not notice**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
cd /Users/nk/Projects/AREAA/areaa-cms
```

Expected: `246 passed`, unchanged. `toAccountMember` reads named fields, so an extra key is inert — but any strict-shape assertion on the me payload would break here, and that is worth knowing now rather than at deploy.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/users-permissions/strapi-server.js tests/integration/capabilities.test.js
git commit -m "feat: GET /api/users/me returns the caller's capabilities"
```

---

### Task 14: Backfill equivalence — the migration told the truth

**Files:**
- Test: `tests/integration/capabilities.test.js`

Test-plan item 4. This is the test that lets the change go out: it says every user's effective authority is the same after the migration as before.

- [ ] **Step 1: Write the test**

```js
describe('backfill equivalence', () => {
  it("every user's effective grants match what their role granted before", async () => {
    const { grantsFor, AUTHENTICATED_GRANTS } =
      await import('../../src/api/chapter-admin/grants.js').then((m) => m.default ?? m);
    const baseline = [...AUTHENTICATED_GRANTS].sort();

    const users = await strapi.query('plugin::users-permissions.user').findMany({
      populate: { role: true, capabilities: true },
      limit: -1,
    });
    expect(users.length).toBeGreaterThan(0);

    for (const user of users) {
      // What the role grants today — read from the database, the shipped truth.
      const rows = await strapi.query('plugin::users-permissions.permission')
        .findMany({ where: { role: user.role.id } });
      const fromRole = [...new Set(rows.map((r) => r.action))].sort();

      // What the capability model computes.
      const fromCaps = grantsFor((user.capabilities ?? []).map((c) => c.slug));

      if (user.role.type === 'chapter_admin') {
        expect(fromCaps, user.email).toEqual(fromRole);
      } else {
        // Ordinary members hold no capability, so the model gives them exactly
        // the baseline — stated as a literal set, not derived from fromRole,
        // which would make the assertion agree with itself.
        expect(fromCaps, user.email).toEqual(baseline);
        // …and the baseline is genuinely a subset of what the role already
        // granted them, so nobody GAINED anything from the migration.
        for (const action of fromCaps) {
          expect(fromRole, `${user.email} gained ${action}`).toContain(action);
        }
      }
    }
  });
});
```

> **Distinct actions, not row counts.** The baseline has 31 link rows against 30 distinct actions for `chapter_admin` — one orphan pointing at a deleted permission. Comparing counts would report a phantom regression; comparing sorted distinct actions is both stricter and correct.

- [ ] **Step 2: Run it**

```bash
PATH="$PATH:/opt/homebrew/bin" npx vitest run tests/integration/capabilities.test.js
```

Expected: PASS. If a `chapter_admin` user mismatches, the backfill missed them or `CAPABILITY_GRANTS.chapter_admin` drifted from the 25 authored actions — both are real bugs, not test noise.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/capabilities.test.js
git commit -m "test: effective grants are identical before and after the backfill"
```

---

### Task 15: The headline gate

- [ ] **Step 1: Full suite, both repos, from a cold start**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms
rm -rf .strapi dist
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
```

Expected: **21+ files, 335 + new tests, 0 failures.** The `rm -rf` matters — a stale compiled schema hides a content-type mistake until deploy.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend
PATH="$PATH:/opt/homebrew/bin" npx vitest run --reporter=dot
```

Expected: **27 files, 246 tests, 0 failures** — unchanged, because no frontend file is touched.

- [ ] **Step 2: Database state matches the baseline**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms
/opt/homebrew/opt/sqlite/bin/sqlite3 .tmp/data.db \
  "select r.type, count(distinct p.action) from up_roles r
   left join up_permissions_role_lnk l on l.role_id = r.id
   left join up_permissions p on p.id = l.permission_id
   group by r.type;"
```

Expected: `authenticated|5`, `chapter_admin|30`, `public|29` — **identical to the baseline**. A capability model that changed the role's grants has changed behaviour, and this plan promised it would not.

- [ ] **Step 3: Boot the admin panel and author a capability by hand**

```bash
PATH="$PATH:/opt/homebrew/bin" npm run develop
```

In the admin UI: Content Manager → Member Capability. Confirm all three are listed, create a fourth (`test_capability`), and confirm you can attach it to a user from the User edit screen. **This is §3.1.1.10 — a new role without a code change — and it is the only step that proves it.** Delete the test capability afterwards.

- [ ] **Step 4: Update the docs index and commit**

Add a line to `docs/` conventions if one exists, then:

```bash
git add -A
git commit -m "docs: plan 8 executed — additive permissions"
```

---

## Rollback

Reversible, in this order:

1. **Revert the enforcement first** (Chunks 4–5). `git revert` the Task 11–14 commits. The handler stops asserting capability and the route gate is again the whole check — which is exactly today's behaviour, because `user.role` was never touched.
2. **Then the relations** (Chunk 2). Removing `capabilities` and `ledCommittees` from the schemas leaves orphaned join tables; Strapi does not drop them, and they are harmless. Drop them by hand only if the schema noise matters.
3. **The collection last** (Chunk 1), or not at all — it costs one unused table.

Chunk 3 (`grantsFor`) does not need reverting at any point: it produces the identical list and is a pure refactor.

**The thing that makes rollback safe is that `role` is untouched.** Every existing authorization path — `chapterAccess` on the frontend, the users-permissions route gate, `administeredChapters` — reads exactly what it read before.

---

## Blast radius

Checked across both repos: **nothing gates on `role.type`** for authority. Every authorization check reads the *scope relation*:

- `src/api/chapter-admin/services/scope.js` — `administeredChapters`
- `areaa-frontend/src/middleware.ts:64,71`
- `areaa-frontend/src/lib/account.ts:40,45`, `src/lib/chapter-access.ts`
- ~10 `src/pages/account/chapter/**` files

The one place a role *name* is compared is `chapter-access.ts:27-28` (`user.role === CHAPTER_ADMIN_ROLE`), and it keeps working untouched because the role keeps its name and its grants. The frontend is already capability-shaped — it asks "does this user administer this chapter?", not "is this user a Chapter Admin?"

---

## Follow-ups, explicitly not in this plan

1. **Frontend reads `capabilities` instead of `role.name`.** `hasChapterAdminRole` becomes `user.capabilities.includes('chapter_admin')`, and the `"missing-role"` redirect becomes `"missing-capability"`. Small, but it touches `AccountMember`, `toAccountMember`, `chapterAccess` and the `/account` error banner, and it is not needed for anything until a user holds two capabilities.
2. **National Admin portal (4C).** Adds its own routes, declares `'national_admin'` through `declare()`, and needs a role that grants those routes — the coarse gate question this plan deliberately left alone.
3. **Committee Leader endpoints.** `assertCommitteeScope` exists and is tested; nothing calls it yet. The first caller should add an integration test mirroring the cross-chapter one in `single-record.test.js`.
4. **The orphan permission link row** on `chapter_admin` (31 rows, 30 actions). Cosmetic; worth a one-line cleanup next time the permission table is touched.
5. **`committee_leader` categories.** Seeded as `['Content','Event','Communication']` — a first cut, editable in the admin UI, and worth Nik's eye once the committee-leader UI has a shape.
