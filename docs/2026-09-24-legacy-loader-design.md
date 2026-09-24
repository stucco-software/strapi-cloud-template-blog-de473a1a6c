# Legacy loader — design

Date: 2026-09-24. Loads the output of the legacy translator
(`AREAA/data/translate`, spec: `AREAA/data/docs/superpowers/specs/2026-09-24-legacy-translator-design.md`)
into a Strapi database. Slice 1: **chapters and users**.

## Decisions

| # | Decision |
|---|---|
| L1 | **Local only for now.** The loader writes a local SQLite database. How production gets the data is decided once events, pages and media have loaders too. |
| L2 | **Its own database.** `.tmp/legacy.db`; the seeded dev database (`.tmp/data.db`) is never touched. |
| L3 | **Rebuild on every run.** Each run deletes the target database and inserts everything from `cms/*.json`. No upserts, no pruning, no "field became empty" rules. (Supersedes the translator spec's T4 "the loader upserts by it" for now.) |
| L4 | **Documents API for all writes, `db.query` only for the password.** Strapi handles validation, schema defaults and draft/publish relations exactly as in the app; the only raw write puts the legacy bcrypt hash in place. |
| L5 | **`legacyId` becomes a schema field** (`{"type": "string", "private": true}`) on `user` and `chapter`, committed before the loader. No `unique` constraint — uniqueness is guaranteed by the translator, and `unique` on a draft-and-publish type (two rows per document) is untested here. |

## Facts this rests on

Verified against the installed Strapi 5.45 source:

- Both the Documents API (`@strapi/core/dist/services/document-service/attributes/transforms.js`)
  and the users-permissions `user` service (`ensureHashedPasswords`) bcrypt-hash any
  `password` value. `strapi.db.query(...).update` stores it verbatim (no lifecycle on
  `up_users`). bcryptjs 2.4.3, used for login, accepts Laravel's `$2y$` hashes.
- `chapter` is draft-and-publish: one document, a draft row and a published row with
  different numeric ids. Chapter-admin scope is resolved at **draft** status
  (`src/api/chapter-admin/services/scope.js`); linking a user to the published row's id
  makes every chapter-admin request 403. Creating a (non-draft-and-publish) user through
  the Documents API with a chapter **documentId** links both the draft and the published
  row, on either side of the relation (`administeredChapters` is the `mappedBy` side).
  `role` and `capabilities` accept numeric ids.
- The Documents API wraps every call in `strapi.db.transaction`, and each successful
  write queues a content event (`entry.create` / `entry.publish`) that fires **after
  commit, un-awaited**, doing a deep-populate read. On SQLite (one pooled connection)
  those reads can still be queued when the script calls `app.destroy()`, which rejects
  them — an unhandled rejection can fail a run whose work already succeeded.
- `password` is not required on the user schema; `documentId`, `createdAt` etc. are
  generated; username uniqueness is validated per create.
- Scalar schema defaults (`status: "Pending"`, `autoRenew: false`, …) are applied on
  create by both the Documents API and `db.query().create` (not by `update`). The
  translator spec's loader note saying otherwise is wrong.
- Booting with `createStrapi(await compileStrapi()).load()` runs `bootstrap()` in
  `src/index.js`, which creates the Chapter Admin role and the capabilities
  (`national_admin`, `committee_leader`, `chapter_admin`) and runs
  `backfillCapabilities` — on **every** boot.
- Strapi reads `.env` with dotenv, which does not override variables already set in
  `process.env`. `config/database.js` builds the SQLite path as
  `path.join(<areaa-cms root>, DATABASE_FILENAME)` — relative to the project root even
  for absolute-looking values.

## Input

The translator's `cms/` directory: `../data/cms` by default, or `LEGACY_DIR` —
both resolved against the areaa-cms root, not the working directory.

- `manifest.json` — `asOf`, `records` (counts per file), `inputs` (sha256 of every
  input; the `areaa-cms/…` keys are the CMS files the payloads were validated against).
- `chapter.json`, `user.json` — `{"type": "<uid>", "records": [...]}`. Records carry
  `legacyId`, Strapi fields, underscore-prefixed loader directives (`_publish`), and
  relations as refs:

| ref | example | resolved to |
|---|---|---|
| legacy | `{"ref": "chapters/12"}` | the `documentId` of the chapter created from that `legacyId` |
| role | `{"ref": "role:chapter_admin"}` | `plugin::users-permissions.role` id, by `type` |
| capability | `{"ref": "capability:national_admin"}` | `api::member-capability.member-capability` id, by `slug` |

**Order of operations when the schema changes:** adding `legacyId` (L5) changes the
schema files' hashes, so the translator must be re-run after that change and before
loading. The loader's hash check enforces this.

## Flow — `scripts/load-legacy.js`

The script is a thin `main()` over small functions in `scripts/legacy/` (input check,
ref resolution, payload preparation, verification) so each can be unit-tested without
Strapi.

1. **Pin the target.** Before requiring Strapi: `DATABASE_CLIENT = "sqlite"`, and
   `DATABASE_FILENAME` = `LEGACY_DB` if set explicitly, else `.tmp/legacy.db`. The value
   is relative to the areaa-cms root, like `config/database.js` (an absolute `LEGACY_DB`
   is refused, since `path.join` would silently nest it under the root); the loader computes the
   file path with the same `path.join(root, value)` for deleting and for checks. It
   refuses (exit 1) if the normalized path equals the dev database
   `path.join(root, ".tmp/data.db")`. `.env`'s database settings are never used, so the
   script cannot reach the dev database or a remote one.
2. **Check the input** (before booting): `manifest.json`, `chapter.json`, `user.json`
   exist and parse; each file's `type` is the expected uid; each file's `records`
   length equals `manifest.records`; the chapter schema, user schema and
   `src/api/member-capability/seed.js` keys are **present** in `manifest.inputs`, and
   **every** `areaa-cms/…` key there equals the sha256 of the current file. Any mismatch → exit 1 naming what differs and
   "re-run the translator".
3. **Rebuild.** Delete the target file and its `-wal`/`-shm`/`-journal` siblings if present.
4. **Boot** Strapi (creates tables; `bootstrap()` creates roles and capabilities).
5. **Resolve namespaced refs.** Look up every `role:` type and `capability:` slug used
   in `user.json`; any unknown → exit 1 (before writing).
6. **Load** — one Documents API call per record (each its own transaction; no outer
   transaction, so events fire as the load proceeds instead of in one burst at the end):
   1. **Chapters:** strip `_` directives; create via
      `strapi.documents('api::chapter.chapter').create({ data, status: 'published' })`
      when `_publish` is true, else as draft. Map `legacyId → documentId`.
   2. **Users:** replace refs (chapter refs by documentId; roles and capabilities by
      id), strip `_` directives, take `password` out of the data, and create via
      `strapi.documents('plugin::users-permissions.user').create({ data })` — **without**
      a password (hashing a throwaway costs ~50 ms per user, ~12 minutes per run). Then,
      if the record has one, write the legacy hash with
      `strapi.db.query('plugin::users-permissions.user').update({ where: { id }, data: { password } })`.
      A user without a password cannot log in.
   Progress is printed every 1,000 users.
7. **Verify** against the database, then print the summary:
   - chapter **documents** (`documents('api::chapter.chapter').count({ status: 'draft' })`)
     and users equal `manifest.records`;
   - for every user whose record had `administeredChapters`, the chapters populated at
     **draft** status (the same call shape the app's scope check uses) have exactly the
     expected documentIds;
   - every stored password equals the input hash.
   Any failure → exit 1.
8. **Drain, then shut down.** Poll with `setTimeout` (a timer, not a microtask loop),
   with a timeout, until the knex (tarn) pool has no used connections and no pending
   acquires or creates — then `app.destroy()` and `process.exit(0)`. This signals that
   the queued content-event handlers have finished because the SQLite driver
   (better-sqlite3) is synchronous and no event subscriber does non-database I/O on a
   fresh database (no webhooks; audit logs are EE-only). Most runs pass on the first
   poll; the drain is a guard, not a fix for an observed failure.

**On any failure** after step 3: delete the target database file and its
`-wal`/`-shm`/`-journal` siblings, then `process.exit(1)` explicitly (Strapi keeps
handles open), so a half-loaded database never lingers.

**Summary** (counts and ids only — never names, emails or hashes):
```
legacy.db ← ../data/cms (translated as of 2026-01-06)
chapters 46 / 46   users 13946 / 13946
chapter-admin scope resolvable at draft: 47 / 47
password hashes verified: 13946 / 13946
```

## Errors

Every failure exits 1 and names the offending `legacyId` (and Strapi's validation
message where there is one). The translator already validated the payloads against
these schemas, so a Strapi validation error means the two have drifted — the message
says so.

## Make targets

- `make legacy` — `node scripts/load-legacy.js` (reads `../data/cms`, or `LEGACY_DIR`).
- `make dev-legacy` — `DATABASE_CLIENT=sqlite DATABASE_FILENAME=.tmp/legacy.db npm run dev`: browse the
  imported data in the admin, log in as an imported chapter admin.
- Don't run `make legacy` while `make dev-legacy` is up — they share `.tmp/legacy.db`.
  (`make dev` / `make seed` use `.tmp/data.db` and are unaffected.)

**Later boots change the loaded data slightly:** every boot runs
`backfillCapabilities`, so after the first `make dev-legacy` the imported users with
role `chapter_admin` who hold only `national_admin` also get `chapter_admin`
(`national_admin` implies it anyway). Expected, not a loader bug.

## Testing (vitest)

- **Unit** (`tests/unit/legacy-load.test.js`), on the functions in `scripts/legacy/`:
  target pinning (default, `LEGACY_DB`, refusal of the dev database incl. `./.tmp/data.db`
  spellings), the input check (match; missing file; wrong `type`; record-count mismatch;
  hash mismatch), ref resolution (legacy / role / capability; unknown refs), directive
  stripping and password separation, and the verification comparisons.
- **Integration** (`tests/integration/legacy-load.test.js`, explicit test **and hook**
  timeouts well above the 60 s defaults — it boots Strapi twice): writes a fixture `cms/` directory — 2 chapters, 3 users
  (a member with a status, a member without one, a chapter admin), a `$2y$` bcrypt hash
  of a known password — with a manifest whose hashes are computed from the current
  files. Runs the loader as a **child process** (so it doesn't share a Strapi instance
  with the other integration tests) with `LEGACY_DB` set to a relative path under
  `.tmp/`, asserts exit 0, then — with `DATABASE_CLIENT=sqlite` and
  `DATABASE_FILENAME=<that path>` set in `process.env` **before** `boot()`, or `.env`
  would point it at the dev database the other integration tests use — boots Strapi on
  that file (its bootstrap re-runs `backfillCapabilities`; harmless, capabilities aren't
  asserted) and asserts: rows and
  `legacyId`s exist; the omitted `status` defaulted to `Pending`; the chapter admin's
  scope resolves at draft status; the stored hash equals the fixture's;
  `POST /api/auth/local` with the known password succeeds. Cleans up the file.
- **Acceptance (smoke test):** one full run on the real translator output
  (`make legacy`) exits 0 with every summary line complete.

## Also in this work

In the `AREAA/data` repo: point the translator spec's T4 and "Notes for the loader
spec" at this document (L3/L5, and the corrected defaults fact), and fix the stale
"The loader upserts by legacyId" comment in `translate/overrides.py`.

## Out of scope

Production loading and `strapi transfer`; media (profile images, chapter thumbnails);
every content type other than chapters and users; board seats.
