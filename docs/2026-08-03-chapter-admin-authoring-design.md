# Chapter Admin Authoring — Design

Chapter admins need to manage their chapter's content — events, news, the microsite
page, committees, partners, and inbound contact submissions — **without holding a
Strapi admin seat**. Strapi bills per admin-panel user; ~45 chapters of admins would
cost roughly $700/month.

The resolution is that chapter admins stay ordinary `users-permissions` users
(`up_users`, free) and get elevated capability through the **content API**, never the
admin panel. That means the authoring UI lives in the Astro frontend
(`../areaa-frontend`), not in Strapi.

This design extends decisions D5 and D6 in [`2026-05-20-ontology.md`](./2026-05-20-ontology.md),
which already anticipated it: *"a chapter admin is a User with the appropriate role
plus an `administeredChapters` relation."*

---

## Decisions

- **CA1** — Chapter admins are `up_users` with a `Chapter Admin` role. No admin-panel
  seats are provisioned for them, ever.
- **CA2** — Authorization is two-axis: the **role** grants capability (*what kinds of
  action*), `administeredChapters` grants **scope** (*on which chapters*). Both are
  checked on every write.
- **CA3** — Scope is enforced in a dedicated `src/api/chapter-admin/` API mounted at
  `/api/chapter-admin/*`. Stock core routes are never opened to chapter admins.
- **CA4** — Chapter admins publish immediately. No national review gate. The API is
  shaped so one could be added later without reworking the UI.
- **CA5** — The chapter microsite page is a **fixed template** — the reserved
  `slug: 'home'` page. Admins fill defined slots; they cannot add, remove, or reorder
  dynamic-zone components. Event and member grids populate automatically.
- **CA6** — Member management is limited to **committee assignment** in v1. The
  capability model must accommodate growth to full member admin (status, dues,
  approvals) without rearchitecting scope enforcement.
- **CA7** — Partners are shared global records. Chapter admins **attach and detach**
  them; they do not edit Partner records, which would affect every chapter using them.
- **CA8** — Rich text is authored with **TipTap** (on ProseMirror), behind a pure
  converter boundary so the editor is swappable.
- **CA9** — Media upload goes through a custom, validated endpoint. The stock
  `plugin::upload` permission is never granted to the Chapter Admin role.
- **CA10** — Concurrent edits are **last-write-wins**, accepted knowingly. Chapters
  have few admins; optimistic concurrency is deferred.
- **CA11** — Every chapter-admin write to a draft-and-publish type **publishes
  explicitly**. Six of the seven write targets have `draftAndPublish: true`, and the
  Strapi 5 documents API writes drafts by default, so a save without
  `status: 'published'` is invisible on the live site. `form-submission` is
  `draftAndPublish: false` and must not receive the flag.
- **CA12** — `DELETE` is a real delete, not an archive flag. Chapter admins remove
  their own mistakes; national retains the admin panel for recovery.

---

## Schema changes required

**None.** Every feature in this design works against the schema as it stands.

One relation is worth understanding but not changing. `committee.members` is
`oneToMany` and unidirectional, where the ontology table records `manyToMany`. Despite
the cardinality name this does **not** limit a member to one committee: Strapi 5
implements it as a join table (`committees_members_lnk`, composite-unique on
`committee_id, user_id`), and the "drop previous relations" cleanup in
`@strapi/database` is gated on the relation being *bidirectional*, which this one is
not. Multi-committee membership works today — users 38 and 39 in the seeded data each
sit on four committees.

What the unidirectional relation actually costs is the inverse: there is no
`user.committees`, so "which committees is this member on" cannot be populated from the
user side. Nothing in v1 needs that, so migrating a live relation — 8 committees,
including the national Delegate and Executive Boards that `/about/*` renders from — is
deferred until a screen requires it.

`event.slug` / `news-item.slug` likewise stay `uid` — see Slugs below.

---

## Authorization model

### Two axes

| Axis | Mechanism | Answers |
|---|---|---|
| Capability | `Chapter Admin` users-permissions role, granted on the custom routes | *What kinds of action?* |
| Scope | `user.administeredChapters` (manyToMany → chapter) | *On which chapters?* |

Separating them means growth (CA6) is a new route plus a permission toggle in the
admin UI, with scope-enforcement code untouched.

### Where the code lives

A dedicated `src/api/chapter-admin/` API — controllers, routes, services — **not** an
addition to the users-permissions extension. The routes span eight content types, so
they do not belong under a user-centric extension, and a first-class API yields
conventional grant strings:

```
api::chapter-admin.chapter-admin.<action>
```

`src/extensions/users-permissions/strapi-server.js` is still amended, but only for the
`me` override (see Frontend surface).

### Role bootstrap

`src/index.js`'s existing `AUTHENTICATED_GRANTS` loop looks up a role by `type` and
returns early if absent — it never creates one. `Chapter Admin` does not exist, so
bootstrap must **create the role row first**, then grant.

`user.role` is `manyToOne` — a user has exactly **one** role. A Chapter Admin is
therefore *not* also Authenticated, so the new role must carry the existing
Authenticated grants **plus** the chapter-admin ones, or chapter admins lose their own
profile page:

```
plugin::users-permissions.user.updateMe          # inherited from Authenticated
plugin::users-permissions.auth.changePassword    # inherited
plugin::users-permissions.user.directory         # inherited
api::chapter-admin.chapter-admin.*               # new, one per action
```

Idempotent and run on boot, following the existing pattern, so it survives fresh
databases and new environments.

### The scoping rule

This is the core invariant, and the reason CA3 rejects stock core routes:

```
create → target chapter read from the PAYLOAD, must be ∈ administeredChapters
update → target chapter read from the EXISTING DB RECORD, never the payload
delete → same as update
```

`chapter` is absent from every editable field whitelist. Together these close
reassignment: an admin cannot pull another chapter's record into their own scope, nor
push their own record out.

`ctx.state.user` does not populate relations, so `administeredChapters` is fetched
once per request and memoized on the context.

### Why not policies on core routes

Stock core controllers accept arbitrary fields and arbitrary query filters. A policy
guarding them must catch every escape — `chapter` reassignment on update, `author`
spoofing, `?filters=` used as a read primitive, publishing an unowned page. Missing
one fails silently. This is structurally the same trap as the stock
`PUT /api/users/:id` that `strapi-server.js` already had to override. Whitelist by
default; do not filter a permissive endpoint.

### The factory

A helper generates the handler set for the three resources that are full CRUD —
**events, news, committees** — so the ownership check exists once and is tested once:

```js
chapterScopedResource({
  uid: 'api::event.event',
  editableFields: ['title', 'startsAt', 'endsAt', 'description',
                   'memberPrice', 'publicPrice', 'location', 'locationUrl', 'figure'],
  slug: { from: 'title', prefixWithChapter: true },
})
// → { list, create, update, delete }
```

Five more (`/page`, `/chapter`, `/members`, `/partners`, `/submissions`) are bespoke
handlers — each a partial verb set with resource-specific rules — but they all call the
same shared `assertChapterScope(ctx, chapterId)` helper. `/media` is the ninth route
and not a resource at all: it is gated by role only, since an upload has no owning
chapter until a record references it. The factory is a convenience over the shared
helper, never the enforcement point.

---

## Draft & Publish

Six of the seven types this design writes to have `draftAndPublish: true`:

| | event | news-item | page | chapter | committee | partner | form-submission |
|---|---|---|---|---|---|---|---|
| `draftAndPublish` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

In Strapi 5, `documents().create()` and `documents().update()` operate on the **draft**
unless given `status: 'published'`. The frontend reads published content by default
(`lib/content.ts` — `status: ContentStatus = "published"`). So a chapter-admin save
without an explicit publish is written successfully and is invisible on the live site,
with no error anywhere — exactly the silent-failure class this design is trying to
avoid.

Per CA4/CA11, every write to these types passes `status: 'published'`, which writes the
draft and publishes in one call. `form-submission` (`draftAndPublish: false`) is the
exception and takes no flag. This is also the seam where a future review gate lands:
dropping the flag turns the same endpoints into draft-only submission with no UI rework.

One consequence to accept: **Strapi publishes the document, not the delta.** If national
has an in-progress unpublished revision of a chapter's home page, a chapter admin's save
publishes that revision along with their own change. This is distinct from CA10's
last-write-wins — nothing is lost, but something unintended may go live. Acceptable at
current volumes; revisit if national begins staging chapter-page revisions.

This does not disturb Live Preview. `config/admin.js` and the frontend's
`resolveStatus()` continue to gate draft reads behind `PREVIEW_SECRET` for national
staff working in the admin panel.

---

## Slugs

`event.slug` and `news-item.slug` are `uid` fields targeting `title`. Two verified
facts drive the handling:

1. **uid is not auto-generated on programmatic create.** Commit `ebd2299`
   ("fix: seed event slugs") exists precisely because Strapi wrote `slug: null`,
   breaking every `/events/[slug]` link. Explicit values are stored verbatim. The
   handler must supply a slug regardless — prefixing costs nothing extra.
2. **There is no unique constraint.** The column is `slug varchar(255) null` with no
   unique index; Strapi 5 enforces uid uniqueness in the admin UI only. Duplicates are
   silently accepted, and since `events/[slug].astro` filters by slug and takes `[0]`,
   the loser becomes unreachable with no error.

So the create handler owns the whole invariant: generate
`${chapterSlug}-${slugify(title)}`, query for an existing match, append `-2`/`-3` on
collision. The seed already uses this convention (`` slug: `${slug}-summer-mixer` ``).

`slug` is excluded from update whitelists — set once at create, immutable after, so
renaming cannot break inbound links or collide on rewrite. National-created global
events keep unprefixed slugs; the invariant is "this endpoint always writes a unique
slug," not "all slugs are prefixed."

**`chapter.slug` is likewise immutable here.** It is a `uid` from `name` and will not
regenerate when `PUT /chapter` changes `name`, and already-written event slug prefixes
would not follow it if it did. `slug` is excluded from the `/chapter` whitelist
deliberately; renaming a chapter's URL stays a national operation.

---

## API surface

All under `/api/chapter-admin/*`, all requiring the `Chapter Admin` role.

| Route | Methods | Scope source | Notes |
|---|---|---|---|
| `/events` | GET POST PUT DELETE | `event.chapter` | Factory-generated |
| `/news` | GET POST PUT DELETE | `newsItem.chapter` | Factory; `author` forced to `ctx.state.user` |
| `/committees` | GET POST PUT DELETE | `committee.chapter` | Factory; member picker restricted to chapter members |
| `/page` | GET PUT | `page.chapter` | Fixed template, upsert — see below |
| `/chapter` | GET PUT | the record itself | `name`, `email` only |
| `/members` | GET | `user.chapter` | Directory-shaped rows, for the committee picker |
| `/partners` | GET PUT | via `chapter.partners` | GET lists the global catalogue; PUT attaches/detaches |
| `/submissions` | GET PUT | `formSubmission.chapter` | Read + mark `handled` |
| `/media` | POST | n/a | Validated upload — see below |

Constraints worth stating explicitly:

- **`news.author` is server-set** from the session user, never the payload. An admin
  cannot publish under another member's byline.
- **`GET /chapter` excludes `administrators`.** Chapter admins must not appoint other
  chapter admins, or the role becomes self-propagating. Appointment stays a national
  action in the Strapi admin.
- **`GET /partners` returns the full Partner catalogue** — name, logo, sponsorship
  level — because the attach/detach picker needs to enumerate candidates. It is a read
  of global data, not chapter-scoped, and exposes nothing that is not already on public
  microsites. PUT accepts only a set of partner ids to associate with the chapter.

`api::resource` has no `chapter` relation and is therefore out of scope — resources
remain national-managed.

### `/page` — the fixed template

**The record** is the chapter's page with the reserved `slug: 'home'`
(`scripts/seed.js:879`; `lib/content.ts` `getChapterHomePage` filters
`slug $eq "home"` + chapter slug). `chapter.pages` is `oneToMany`, so this must filter
on both fields — a chapter may accumulate other pages later.

**Upsert, not update.** If a chapter has no `home` page — a newly created chapter, or
one national has not set up — `PUT` creates it from the template rather than 404ing, so
a chapter admin can bootstrap their own microsite. This is why the route is GET+PUT
with no separate POST. `page.title` and `page.slug` are both `required: true`, so the
create path supplies `slug: 'home'` and defaults the title to the chapter name; neither
is an editable slot.

**The slots**, in the order the seeded chapter home page defines them
(`scripts/seed.js:884`–`:965`) — eleven component instances across nine types:

| # | Component | Admin-editable |
|---|---|---|
| 1 | `shared.hero` | title, body, figure, primaryCta, secondaryCta |
| 2 | `shared.upcoming-events` | title, link only — events auto-populate |
| 3 | `shared.social-media-feed` | title, platform, feedUrl |
| 4 | `shared.video-embed` | title, videoUrl, caption |
| 5 | `shared.gallery` | title, photos |
| 6 | `shared.section` | title, body, figure, primaryCta, secondaryCta |
| 7 | `shared.contact-form` | title, intro — `fields` are national-configured |
| 8–10 | `shared.member-group` ×3 | title, link, member picker (chapter members only) |
| 11 | `shared.partner-group` | title; partners via `/partners` (CA7) |

**Dynamic zones are replace-on-write** — Strapi does not patch a dynamic zone; writing
it replaces the whole array. `PUT /page` must therefore rebuild the entire array, which
makes the write rule load-bearing:

> Match each existing component **by position**, update the fields of recognised slots
> from the submitted values, and pass through everything else unchanged — unknown
> component types, and whatever ordering national has established in the admin panel.

This is a positional merge, not a reconstruction from the table above. Emitting the
table's order literally would silently reorder all 45 microsites on each chapter's
first save, violating CA5's own "cannot add, remove, or reorder." The table documents
*which slots are editable*; it does not define the array the handler writes.

Template slots missing from an existing page are appended at the end rather than
inserted, so the rule still holds for pages that predate a new slot.

---

## Frontend surface

Routes: `/account/chapter/[chapterSlug]/…` — index, `events`, `news`, `page`,
`committees`, `submissions`, `settings`.

The chapter slug is a **path parameter, not session state**. `administeredChapters` is
manyToMany, so a person can administer several chapters, and a hidden "active chapter"
is exactly the state that lands an edit on the wrong microsite. In the URL it is
explicit, bookmarkable, and every handler receives its target rather than inferring it.
Single-chapter admins are redirected from `/account/chapter` to their one slug.

### Identity plumbing (cross-repo)

`AccountMember` currently carries `chapter` as a bare name string and no role:

- `strapi-server.js` — `readSelf` adds `role` and `administeredChapters` (name + slug)
- `lib/account.ts` — `AccountMember` gains `administeredChapters: {name, slug}[]`
- `middleware.ts` — `/account/chapter/*` additionally requires the path slug to be in
  that array; a 403-shaped response, not a login bounce, since the user *is* signed in

**This middleware check is a UX guard, not the security boundary.** It prevents a
member seeing an admin screen they cannot use. Enforcement is the scoping rule in
Strapi, which holds against a direct POST.

### Forms

Every screen is `AccountLayout` + `FormField`, POSTing to an Astro API route that
mirrors `pages/api/profile.ts` — forward to Strapi with the session JWT, redirect back
with flash params. No client JS except the rich-text field.

`FormField` today supports text, email, tel, password, search, select, and textarea.
This design needs four additions:

| Type | Used by |
|---|---|
| `datetime-local` | `event.startsAt` / `endsAt` |
| `number` | `event.memberPrice` / `publicPrice` |
| `checkbox` | `submission.handled` |
| `file` | media upload |

Plus one new component — a **multi-select picker** (committee members, partner
attach/detach, `member-group` slots) — which is not a `FormField` variant and should be
its own component with its own tests.

The windowed `pageItems()` helper in `account/members.astro` moves to `lib/` rather
than being copied into the events and news list screens.

---

## Rich text

`event.description` and `news-item.body` are Strapi `blocks` — a nested JSON AST.
`RichText.astro` renders them; nothing authors them.

**TipTap** (on ProseMirror) provides the editor and toolbar. ProseMirror over Wordgard
because Wordgard is 0.1, expects ~a year of API churn before stabilizing, and does not
accept pull requests — acceptable for a side project, not for the authoring surface of
45 chapters. The schema-constrained editing that makes Wordgard attractive here is
ProseMirror's defining feature too.

The decision that outlives the library choice is the **converter boundary**:

```ts
blocksToDoc(blocks: StrapiBlock[]): TipTapDoc
docToBlocks(doc: TipTapDoc): StrapiBlock[]
```

Pure functions, unit-tested against real Strapi payloads, editor strictly behind them.
Swapping editors later is then a contained change.

The TipTap schema permits **exactly** Strapi's block vocabulary — paragraph, heading,
ordered/unordered list, quote, code, link, bold/italic/underline/strikethrough, image
— and nothing else. Because the schema is total over that vocabulary, content authored
by national staff in Strapi's own block editor round-trips without loss. If an
unrepresentable block is ever encountered on load, the field locks with a pointer to
the CMS rather than silently dropping it on save.

This is the one field that requires client JS; it serializes to a hidden input on
submit.

---

## Media upload

`POST /api/chapter-admin/media`. The stock `plugin::upload.content-api.upload`
permission is **not** granted to the role (CA9) — granting it means unrestricted upload
to the S3 bucket with no type or size checks, which is the "whitelist by default"
principle again.

The handler:

- requires the `Chapter Admin` role
- enforces a size cap (5 MB)
- validates mime against a **raster-only** allowlist: jpeg, png, webp, avif
- delegates to `strapi.plugin('upload').service('upload')`, reusing the existing
  S3/CloudFront provider config unchanged
- returns the media id for the form to reference

No `destroy` grant. Admins detach media from a record; they do not delete from the
shared library.

**SVG is excluded deliberately.** Uploads are served from the same CloudFront
distribution as the site under `/uploads/*` — same origin. An SVG is an XML document
that can carry `<script>`, making an uploaded SVG stored XSS on the site's own origin.

**Two upload paths, both specified:**

1. **Form fields** (event figure, gallery photos, hero image) — the Astro route accepts
   `multipart/form-data` and streams it to `/chapter-admin/media`, receiving a media id
   which it writes into the record on save. Works without client JS.
2. **TipTap inline images** — the editor uploads via `fetch` to the same Astro route on
   drop/paste and inserts the returned id. This path requires JS, which the rich-text
   field already does.

**Orphaned media is accepted.** An upload whose form is abandoned leaves a file in the
shared library that no chapter admin can delete (no `destroy` grant, by design). This
is a known, bounded cost — a periodic national cleanup, not a code path. Making uploads
transactional with record saves is explicitly not worth the complexity here.

---

## Error handling

- Strapi: 403 out-of-scope, 400 validation, 404 missing.
- Astro: flash params via redirect, per the `api/profile.ts` pattern.
- **A save that did not save must never render as one that did.** Failing soft into an
  ambiguous empty state (as `lib/directory.ts` does on read) is materially worse on a
  write path. The publish gap in CA11 is the same failure class and is closed the same
  way.
- Slug collisions resolve silently server-side; everything else surfaces to the user.
- Concurrent edits are last-write-wins (CA10) — accepted, not overlooked.

---

## Testing

Neither repo has test infrastructure today; there is no `test` script in either
`package.json`. This adds Vitest to both.

The scope check, slug generator, field whitelist, and block converters are all written
as **pure functions**, so the bulk of the suite needs no booted Strapi and no
supertest. Only a thin set of route-level integration tests pays that cost.

- ownership check, table-driven — admin of A touching B's record; payload attempting
  chapter reassignment; create targeting an unowned chapter
- field whitelist — a payload carrying `role`, `status`, `chapter` writes none of them
- slug generation and collision suffixing
- `blocksToDoc` / `docToBlocks` round-trip against real payloads
- `/page` reconstruction — unknown components survive a template write

---

## Rollout

This is roughly three plans, and the seams are stated so they can be planned
separately:

1. **Strapi authorization spine** — role creation + bootstrap, the scope helper and
   factory, slugs, publish handling, media endpoint. Ends with **the events routes
   proven API-only** — integration tests and curl against a real member JWT, no UI.
   Deliberately a backend slice: plan 1 has no dependency on plan 2, and plan 2's
   screens land on routes already known to work.
2. **Frontend authoring screens** — identity plumbing, the `/account/chapter/*` routes,
   `FormField` additions, the multi-select picker, and the remaining resources against
   the proven spine.
3. **TipTap editor + converter boundary** — independently testable, and the plain
   textarea it replaces is a two-line placeholder until it lands.

The `/account/chapter` nav entry renders only for users with a non-empty
`administeredChapters`, so the surface stays dark until national appoints someone.

---

## Out of scope

- National review/approval workflow (CA4/CA11 — the `status: 'published'` flag is the
  seam where it lands)
- Full member administration: status, dues, approvals (CA6 — capability model
  accommodates it)
- `api::resource` management — no chapter relation exists
- Editing Partner records (CA7 — attach/detach only)
- Optimistic concurrency (CA10)
- Archival-instead-of-delete (CA12)
- Reconciling `page.slug` per-chapter uniqueness, which the ontology assigned to "app
  logic / a lifecycle hook" that was never implemented. Harmless while `/page` has no
  general create; revisit if chapter admins ever gain multi-page microsites.

## Related

Independent of this work, anonymous `GET /api/users` currently returns every member's
email, status, and dues fields — the Public role holds
`plugin::users-permissions.user.find` (`scripts/seed.js`) and no user fields are marked
`private`. The scoping care taken in `GET /chapter-admin/members` is correct on its own
terms but buys little until that is closed. Tracked separately.

The ontology's component table predates `shared.faq`, which is now in the
`page.components` dynamic zone. Not load-bearing here — the FAQ component is not a
chapter-admin slot — but worth reconciling on the next ontology pass.
