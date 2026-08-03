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
- **CA3** — Scope is enforced in Strapi via custom endpoints under
  `/api/chapter-admin/*`. Stock core routes are never opened to chapter admins.
- **CA4** — Chapter admins publish immediately. No national review gate. The API is
  shaped so one could be added later without reworking the UI.
- **CA5** — The chapter microsite page is a **fixed template**. Admins fill defined
  slots; they cannot add, remove, or reorder dynamic-zone components. Event, news,
  and member grids populate automatically from the chapter's records.
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

---

## Authorization model

### Two axes

| Axis | Mechanism | Answers |
|---|---|---|
| Capability | `Chapter Admin` users-permissions role, granted on the custom routes | *What kinds of action?* |
| Scope | `user.administeredChapters` (manyToMany → chapter) | *On which chapters?* |

Separating them means growth (CA6) is a new route plus a permission toggle in the
admin UI, with scope-enforcement code untouched.

### Role bootstrap constraint

`user.role` is `manyToOne` — a user has exactly **one** role. A Chapter Admin is
therefore *not* also Authenticated, so the `Chapter Admin` role must be seeded with
the existing Authenticated grants **plus** the chapter-admin ones, or chapter admins
lose their own profile page:

```
plugin::users-permissions.user.updateMe          # inherited from Authenticated
plugin::users-permissions.auth.changePassword    # inherited
plugin::users-permissions.user.directory         # inherited
plugin::users-permissions.user.chapterAdmin*     # new
```

Seeded on boot in `src/index.js`, following the existing `AUTHENTICATED_GRANTS`
pattern, so it survives fresh databases and new environments.

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

One helper emits the handler set, so the ownership check exists once and is tested
once:

```js
chapterScopedResource({
  uid: 'api::event.event',
  editableFields: ['title', 'startsAt', 'endsAt', 'description',
                   'memberPrice', 'publicPrice', 'location', 'locationUrl', 'figure'],
  slug: { from: 'title', prefixWithChapter: true },
})
// → { list, create, update, delete }
```

Six content types become six config blocks.

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

---

## API surface

All under `/api/chapter-admin/*`, all requiring the `Chapter Admin` role.

| Route | Methods | Scope source | Notes |
|---|---|---|---|
| `/events` | GET POST PUT DELETE | `event.chapter` | Factory-generated |
| `/news` | GET POST PUT DELETE | `newsItem.chapter` | `author` forced to `ctx.state.user` |
| `/page` | GET PUT | `page.chapter` | Fixed template (CA5); no create/delete |
| `/committees` | GET POST PUT DELETE | `committee.chapter` | Member picker restricted to chapter members |
| `/chapter` | GET PUT | the record itself | `name`, `email` only |
| `/members` | GET | `user.chapter` | Directory-shaped rows, for the committee picker |
| `/partners` | PUT | via `chapter.partners` | Attach/detach only (CA7) |
| `/submissions` | GET PUT | `formSubmission.chapter` | Read + mark `handled` |
| `/media` | POST | n/a | Validated upload (see below) |

Three constraints worth stating explicitly:

- **`news.author` is server-set** from the session user, never the payload. An admin
  cannot publish under another member's byline.
- **`GET /chapter` excludes `administrators`.** Chapter admins must not appoint other
  chapter admins, or the role becomes self-propagating. Appointment stays a national
  action in the Strapi admin.
- **`DELETE` is a real delete.** If archival is wanted instead, that is a schema
  addition and should be decided before implementation.

`api::resource` has no `chapter` relation and is therefore out of scope — resources
remain national-managed.

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

- `FormField` gains `datetime-local` for event start/end.
- The windowed `pageItems()` helper in `account/members.astro` moves to `lib/` rather
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
to the S3 bucket with no type or size checks, which is the § "whitelist by default"
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

---

## Error handling

- Strapi: 403 out-of-scope, 400 validation, 404 missing.
- Astro: flash params via redirect, per the `api/profile.ts` pattern.
- **A save that did not save must never render as one that did.** Failing soft into an
  ambiguous empty state (as `lib/directory.ts` does on read) is materially worse on a
  write path.
- Slug collisions resolve silently server-side; everything else surfaces to the user.
- Concurrent edits are last-write-wins (CA10) — accepted, not overlooked.

---

## Testing

Neither repo has test infrastructure today; there is no `test` script in either
`package.json`. This adds Jest + supertest (Strapi) and Vitest (Astro).

Coverage is focused on the logic that branches most and fails least visibly:

- ownership check, table-driven — admin of A touching B's record; payload attempting
  chapter reassignment; create targeting an unowned chapter
- field whitelist — a payload carrying `role`, `status`, `chapter` writes none of them
- slug generation and collision suffixing
- `blocksToDoc` / `docToBlocks` round-trip against real payloads

---

## Rollout

1. `Chapter Admin` role bootstrap + identity plumbing (`me` override, `AccountMember`,
   middleware guard)
2. Ownership factory + **events end-to-end** — one vertical slice exercising auth,
   scoping, slugs, media, and the editor
3. Remaining resources against the proven spine: news, page, committees, chapter
   settings, partners, submissions
4. The `/account/chapter` nav entry renders only for users with a non-empty
   `administeredChapters`, so the surface stays dark until national appoints someone

---

## Out of scope

- National review/approval workflow (CA4 — API shaped to allow adding it)
- Full member administration: status, dues, approvals (CA6 — capability model
  accommodates it)
- `api::resource` management — no chapter relation exists
- Editing Partner records (CA7 — attach/detach only)
- Optimistic concurrency (CA10)
- Archival-instead-of-delete

## Related

Independent of this work, anonymous `GET /api/users` currently returns every member's
email, status, and dues fields — the Public role holds
`plugin::users-permissions.user.find` (`scripts/seed.js`) and no user fields are marked
`private`. The scoping care taken in `GET /chapter-admin/members` is correct on its own
terms but buys little until that is closed. Tracked separately.
