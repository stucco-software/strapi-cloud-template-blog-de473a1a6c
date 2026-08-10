# Plan 6: Finish the microsite page editor — buttons and images

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chapter admin can edit everything on their microsite home page that is theirs to edit. Plan 5 gave them the words. This gives them the **buttons** and the **images**.

**Architecture:** Identical to plan 5, deliberately. No dynamic zone is ever written; each save updates component rows **by id**, at both statuses, gated on content parity. A CTA is just another component row (`shared.cta`), reached through its parent's `_cmps` join table. An image is a media relation set to an id the existing `/chapter-admin/media` endpoint already returns. There is no new mechanism in this plan.

**Tech Stack:** Strapi 5.45.1, Astro 6.4.2, Vitest, supertest. **No new dependencies.**

---

## What a visitor sees that the chapter admin cannot change

Measured against `aloha-hawaii`'s live home page zone. "Editable" is what plan 5 shipped.

| Component | Editable today | **Not editable** |
|---|---|---|
| Hero | title, body | **image** (`placeholder_4a2182a099.png`), **button** "Learn More" → `/about` |
| Upcoming Events | title | **button** "View All Events" → `/events` |
| Social Feed | title | feed url |
| Video | title, caption | video url |
| Gallery | title | **photos** (placeholder) |
| Text Section | title, body | **button** "View Membership Benefits" → `/membership` |
| Contact Form | title, intro, submitLabel | — |
| Member Group ×3 | title | — |
| Partners | title | (plan 4 covers the selection) |

Three things stand out, and none of them is rich text:

1. **The hero image is a placeholder on every chapter.** It is the largest element on the page.
2. **Every button on the page points at a national route** — `/about`, `/events`, `/membership`. A chapter that wants its hero button to say "Join AREAA Hawaii" and link to its own membership page cannot do it.
3. The gallery is placeholders too.

## Why this replaces the previous plan 6

The previous draft was "TipTap and the real blocks converters" — an editor, treated as the goal. Two review rounds found blockers in it, and the second round found blockers in the *fixes* from the first. The fatal one: ProseMirror silently discards an entire document when it meets a node its schema does not know, and every guard written against that was itself broken.

More importantly it was aimed at the wrong thing. Rich text would let an admin bold a word in a paragraph. **Buttons and images are what a visitor actually looks at**, and both are currently placeholders pointing at the wrong pages.

The rich-text findings are not lost — see *Deferred: rich text* at the end, which records what was verified so the next attempt starts from facts rather than from memory.

---

## Scope

**In:**

- **Buttons.** `label` and `href` on every `shared.cta` a chapter home page carries, through its parent component.
- **Images.** The single `figure` on hero, section and partner-callout, uploaded through the endpoint that already exists.
- **URL safety for `href`.** `Hero.astro:48` renders `href={primaryCta.href}` with no sanitisation anywhere in either repo. Today a chapter admin cannot set an href, so it is latent; this plan is what opens it. One function, one field — not a document vocabulary.
- Both written at draft **and** published, content-parity gated, exactly as plan 5 does.

**Not in:**

- **Rich text.** Its own plan. See the deferred section.
- **Gallery photos.** A repeatable media list needs add/remove/reorder — a different UI from "replace this one image". The single `figure` covers the hero, which is the visible one.
- **`videoUrl`, `feedUrl`, `platform`.** Configuration rather than content: they change *what is embedded*, not what the page says. A chapter repointing its own social feed is reasonable and is a small follow-on; it is not this plan.
- **`style` on a CTA** (Primary/Secondary). It is design, not content, and the two render differently by intent.
- **Adding, removing or reordering components.** Still the only thing that needs a zone write.
- **Relations** — members, partners, events. Their own screens.

---

## Preconditions

**1. Branch.** Trunk-based; commit to `main` in both repos.

**2. Baselines, measured immediately before writing this plan.**

| | Tests | Files |
|---|---|---|
| `areaa-cms` | **235** | 17 |
| `areaa-frontend` | **90** | 12 |

`api::chapter-admin%` permissions: **25**. This plan adds **no routes and no grants** — `GET`/`PUT /chapter-admin/page` learn new fields.

**3. Plan 5 is a hard prerequisite.** This extends its `page-content.js`, its handlers and its screen. Plan 7 is independent.

**4. Every CMS command needs `cd /Users/nk/Projects/AREAA/areaa-cms`**, every frontend command `cd /Users/nk/Projects/AREAA/areaa-frontend`, and CMS test/boot commands need `PATH="/opt/homebrew/bin:$PATH"`.

**5. `.tmp/data.db` is untracked** and this plan edits live microsite content. Snapshot with plan 5's query before the walkthrough; restore with a script before killing the servers.

**6. Astro form POSTs need a matching `Origin` header** when driven by curl.

---

## Verified assumptions

Executed against the installed Strapi 5.45.1 and the seeded database on 2026-08-10.

| Assumption | Verdict |
|---|---|
| `shared.cta` is `{label: string (required), href: string (required), style: enum}` | ✅ |
| A chapter home zone carries **three** CTAs — on the hero, upcoming-events and section | ✅ aloha: cta 175 "Learn More"→`/about`, 176 "View All Events"→`/events`, 177 "View Membership Benefits"→`/membership` |
| All three point at **national** routes, not the chapter's | ✅ That is the gap |
| CTAs hang off their parent through a `_cmps` join table | ✅ `components_shared_heroes_cmps(entity_id, cmp_id, component_type='shared.cta', field='primaryCta')` |
| CTA slot names differ per parent: `primaryCta`/`secondaryCta` on hero and section, `link` on upcoming-events, member-group, news-and-resources, partner-callout | ✅ per component schemas |
| `Hero.astro:48` renders `href={primaryCta.href}` with **no sanitisation in either repo** | ✅ grep for `javascript:`, `sanitiz`, `isSafeUrl`, `allowedProtocol` returns nothing |
| A chapter admin **cannot** set an href today | ✅ `EDITABLE_BY_TYPE` in plan 5 covers title/body/intro/submitLabel/caption only |
| Every chapter hero's `figure` is `placeholder_4a2182a099.png` | ✅ all 8 hero rows |
| `POST /chapter-admin/media` exists, with magic-byte sniffing and a size cap | ✅ plan 1; wired at `routes/chapter-admin.js:19` |
| The upload → id → attach flow is already proven | ✅ `pages/api/chapter-admin/event.ts:37-45` does exactly this for `event.figure` |
| Media rows are **not** draft/published — one file, two component rows pointing at it | ✅ `files_related_mph` keys on `related_id` + `related_type`; so attaching at both statuses is two relation writes to one file |
| Plan 5's `pairZones`, content-parity guard and `sameForFields` exist and are tested | ✅ 42 unit tests in `page-content.test.js` |
| aloha's draft and published hero **differ** (`Chorp Chipper` / `Our Chapter`) | ✅ still true — the content-parity guard fires on real data, and this plan inherits it |

---

## Chunk 1: Safe hrefs

One function. It exists because this plan is what makes `href` client-settable.

### Task 1: `normaliseUrl`

**Files:** Create `src/api/chapter-admin/services/safe-url.js`, `tests/unit/safe-url.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normaliseUrl, MAX_URL_LEN } = require('../../src/api/chapter-admin/services/safe-url.js');

describe('normaliseUrl', () => {
  it('keeps a safe absolute url, normalised', () => {
    expect(normaliseUrl('https://areaa.org/join')).toBe('https://areaa.org/join');
    expect(normaliseUrl('http://x.example')).toBe('http://x.example/');
  });

  it('keeps mailto and tel', () => {
    expect(normaliseUrl('mailto:hawaii@areaa.org')).toBe('mailto:hawaii@areaa.org');
    expect(normaliseUrl('tel:+18005551234')).toBe('tel:+18005551234');
  });

  it('keeps a site-relative link relative', () => {
    // These are the common case: every seeded CTA is one.
    expect(normaliseUrl('/join')).toBe('/join');
    expect(normaliseUrl('/chapters/aloha-hawaii/events')).toBe('/chapters/aloha-hawaii/events');
    expect(normaliseUrl('/events?year=2026')).toBe('/events?year=2026');
  });

  it('keeps a bare fragment as a fragment', () => {
    // `#contact` scrolls; `/#contact` navigates to the home page. Rewriting one
    // into the other silently breaks every in-page anchor.
    expect(normaliseUrl('#contact')).toBe('#contact');
    expect(normaliseUrl('/events#top')).toBe('/events#top');
  });

  it('REJECTS javascript:, in every disguise', () => {
    // Hero.astro renders href={primaryCta.href} unsanitised. Astro escapes the
    // VALUE; it does not touch the SCHEME.
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)',
                     '  javascript:alert(1)', 'java\tscript:alert(1)',
                     'java\nscript:alert(1)']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('REJECTS data:, vbscript:, blob:, file: and about:', () => {
    for (const u of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)',
                     'blob:https://x.example/a', 'file:///etc/passwd', 'about:blank']) {
      expect(normaliseUrl(u), u).toBeNull();
    }
  });

  it('ABSOLUTISES anything that leaves the site', () => {
    // An off-site link is allowed — but it must be stored absolute, because
    // that is what tells a renderer to add rel="noopener".
    expect(normaliseUrl('//evil.example/x')).toBe('https://evil.example/x');
    expect(normaliseUrl('\\\\evil.example/x')).toBe('https://evil.example/x');
  });

  it('ABSOLUTISES a relative path that escapes into an authority', () => {
    // The bypass a review found in the obvious implementation: `parsed.pathname`
    // can itself begin with `//`, which the browser resolves as a host. Returned
    // relative it would render as an in-site link with no rel guard.
    for (const u of ['/.//evil.example/x', '/..//evil.example/x', '/a/..//evil.example/x']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBe('https://evil.example/x');
    }
  });

  it('REJECTS userinfo, which makes a hostile host look trusted', () => {
    expect(normaliseUrl('https://areaa.org@evil.example/')).toBeNull();
    expect(normaliseUrl('https://user:pw@evil.example/')).toBeNull();
  });

  it('rejects empty, blank, non-string and over-long values', () => {
    for (const u of ['', '   ', null, undefined, 42, {},
                     'https://x.example/' + 'a'.repeat(MAX_URL_LEN)]) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('is idempotent — normalising twice changes nothing', () => {
    // A save re-reads and re-writes; a non-idempotent normaliser would drift a
    // href on every edit.
    for (const u of ['/join', '#contact', 'https://areaa.org/x', 'mailto:a@b.org',
                     '//evil.example/x', '/.//evil.example/x']) {
      const once = normaliseUrl(u);
      expect(normaliseUrl(once), JSON.stringify(u)).toBe(once);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/safe-url.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

/**
 * A URL that is safe to put in an href — normalised — or null.
 *
 * This exists because THIS PLAN is what lets a chapter admin set an href.
 * `Hero.astro:48` and `Section.astro:54` render `href={primaryCta.href}` with no
 * sanitisation anywhere in either repo. Astro escapes the attribute VALUE; it
 * does nothing to the SCHEME, so `javascript:` would execute.
 *
 * Use the platform parser, not a hand-rolled one. Two things a hand-rolled
 * version got wrong, both found by review:
 *
 *  - `\\evil.example/x` — WHATWG canonicalises `\` to `/` for special schemes,
 *    so it resolves off-site. A textual `//` check never sees it.
 *  - `/.//evil.example/x` — `parsed.pathname` itself begins `//`, so returning
 *    the relative form re-creates the same problem one layer down.
 *
 * NORMALISING, not merely validating, is what closes both: anything that
 * resolves off-site comes back absolute, so a renderer can tell.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
const MAX_URL_LEN = 2048;

/** Any absolute origin; it exists only so relative URLs can be parsed. */
const BASE = 'https://base.invalid';
const BASE_ORIGIN = new URL(BASE).origin;

function normaliseUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw === '' || raw.length > MAX_URL_LEN) return null;

  let parsed;
  try {
    parsed = new URL(raw, `${BASE}/`);
  } catch {
    return null;
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;
  if (parsed.username !== '' || parsed.password !== '') return null;

  // Off-site: return it absolute so the renderer's external-link handling sees
  // the truth.
  if (parsed.origin !== BASE_ORIGIN) return parsed.href;

  // Same-origin as the parsing base => genuinely relative. Keep it relative, or
  // every internal link would point at base.invalid.
  const rel = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  // ...unless the path itself starts with `//`, which a browser reads as an
  // authority. `/.//evil.example/x` normalises to `//evil.example/x`, which
  // would render as an in-site link and navigate off-site.
  if (rel.startsWith('//')) return `${new URL(rel, `${BASE}/`).href}`;

  // A bare fragment or query must stay bare: `#contact` scrolls, `/#contact`
  // navigates to the site root.
  if (parsed.pathname === '/' && raw.startsWith('#')) return parsed.hash || '#';
  if (parsed.pathname === '/' && raw.startsWith('?')) return `${parsed.search}${parsed.hash}`;

  return rel;
}

module.exports = { normaliseUrl, MAX_URL_LEN, ALLOWED_SCHEMES };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/safe-url.test.js
```

Expected: PASS, **11 tests**.

- [ ] **Step 5: Mutation-check, with a green baseline first**

A gate that never checks the unmutated suite passes will report every mutation as
killed on an already-red suite. That has happened in this project; assert the
control run first.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && cat > /tmp/mutate-url.py <<'EOF'
import subprocess, shutil, sys
SRC = 'src/api/chapter-admin/services/safe-url.js'
RUN = ['npx', 'vitest', 'run', 'tests/unit/safe-url.test.js']
MUTATIONS = [
    ('allow any scheme',        "  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;", ''),
    ('allow userinfo',          "  if (parsed.username !== '' || parsed.password !== '') return null;", ''),
    ('return off-site relative',"  if (parsed.origin !== BASE_ORIGIN) return parsed.href;", ''),
    ('allow // in the path',    "  if (rel.startsWith('//')) return `${new URL(rel, `${BASE}/`).href}`;", ''),
    ('absolutise fragments',    "  if (parsed.pathname === '/' && raw.startsWith('#')) return parsed.hash || '#';", ''),
    ('drop the length cap',     "  if (raw === '' || raw.length > MAX_URL_LEN) return null;", "  if (raw === '') return null;"),
]
if subprocess.run(RUN, capture_output=True).returncode != 0:
    print('BASELINE IS RED — fix the suite before trusting this gate'); sys.exit(1)
print('baseline green')
shutil.copy(SRC, '/tmp/safe-url.bak')
survived = []
try:
    for label, old, new in MUTATIONS:
        src = open('/tmp/safe-url.bak').read()
        if old not in src:
            print('DID NOT APPLY  %s' % label); survived.append(label); continue
        open(SRC, 'w').write(src.replace(old, new, 1))
        killed = subprocess.run(RUN, capture_output=True).returncode != 0
        print('%s  %s' % ('KILLED  ' if killed else 'SURVIVED', label))
        if not killed: survived.append(label)
finally:
    shutil.copy('/tmp/safe-url.bak', SRC)
sys.exit(1 if survived else 0)
EOF
PATH="/opt/homebrew/bin:$PATH" python3 /tmp/mutate-url.py
```

Expected: `baseline green`, then **six `KILLED` lines**.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/safe-url.js tests/unit/safe-url.test.js && \
  git commit -m "feat: href normalisation, before chapter admins can set one"
```

---

## Chunk 2: Buttons

### Task 2: Locate and shape a section's CTAs

**Files:** Modify `src/api/chapter-admin/services/page-content.js`, `tests/unit/page-content.test.js`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('ctaSlotsFor', () => {
  it('names the CTA slots each component type carries', () => {
    expect(ctaSlotsFor('shared.hero')).toEqual(['primaryCta', 'secondaryCta']);
    expect(ctaSlotsFor('shared.section')).toEqual(['primaryCta', 'secondaryCta']);
    expect(ctaSlotsFor('shared.upcoming-events')).toEqual(['link']);
    expect(ctaSlotsFor('shared.member-group')).toEqual(['link']);
  });

  it('returns none for a component with no CTA', () => {
    // A slot list that guessed wrong would make the screen offer a button
    // editor for something that has no button.
    for (const t of ['shared.gallery', 'shared.contact-form', 'shared.partner-group',
                     'shared.video-embed', 'shared.social-media-feed']) {
      expect(ctaSlotsFor(t), t).toEqual([]);
    }
  });

  it('returns none for a type it does not know', () => {
    expect(ctaSlotsFor('shared.brand-new-thing')).toEqual([]);
  });
});

describe('shapeCtaEdit', () => {
  it('keeps a label and a normalised href', () => {
    expect(shapeCtaEdit({ label: '  Join Us  ', href: '/join' }))
      .toEqual({ label: 'Join Us', href: '/join' });
  });

  it('absolutises an off-site href', () => {
    expect(shapeCtaEdit({ label: 'X', href: '//evil.example/x' }).href)
      .toBe('https://evil.example/x');
  });

  it('400s an unsafe href rather than storing it', () => {
    // Both fields are `required: true` on the component, so there is no
    // "clear it" path — refusing is the only correct answer.
    expect(() => shapeCtaEdit({ label: 'X', href: 'javascript:alert(1)' }))
      .toThrow(BadInputError);
  });

  it('400s an empty label or href, which the schema requires', () => {
    expect(() => shapeCtaEdit({ label: '', href: '/join' })).toThrow(BadInputError);
    expect(() => shapeCtaEdit({ label: 'X', href: '   ' })).toThrow(BadInputError);
  });

  it('400s a label longer than the cap', () => {
    expect(() => shapeCtaEdit({ label: 'x'.repeat(201), href: '/join' }))
      .toThrow(BadInputError);
  });

  it('DROPS style, which is design rather than content', () => {
    expect(shapeCtaEdit({ label: 'X', href: '/join', style: 'Primary' }))
      .not.toHaveProperty('style');
  });

  it('400s a non-string value', () => {
    expect(() => shapeCtaEdit({ label: { a: 1 }, href: '/join' })).toThrow(BadInputError);
  });

  it('requires both fields together', () => {
    // A partial write would leave a button with a stale label and a new href.
    expect(() => shapeCtaEdit({ label: 'X' })).toThrow(BadInputError);
    expect(() => shapeCtaEdit({ href: '/join' })).toThrow(BadInputError);
  });
});
```

Add `ctaSlotsFor, shapeCtaEdit` to the `require` at the top of the file.

- [ ] **Step 2: Implement**

```js
const { normaliseUrl } = require('./safe-url');

const MAX_LABEL_LEN = 200;

/**
 * Which `shared.cta` slots each component type carries.
 *
 * The slot NAMES differ by parent — `primaryCta`/`secondaryCta` on hero and
 * section, `link` everywhere else — and they are the `field` column of the
 * parent's `_cmps` join table, so getting one wrong silently edits nothing.
 */
const CTA_SLOTS = {
  'shared.hero': ['primaryCta', 'secondaryCta'],
  'shared.section': ['primaryCta', 'secondaryCta'],
  'shared.partner-callout': ['link'],
  'shared.upcoming-events': ['link'],
  'shared.member-group': ['link'],
  'shared.news-and-resources': ['link'],
};

const ctaSlotsFor = (type) => CTA_SLOTS[type] ?? [];

/**
 * Submitted values -> the data written to one `shared.cta` row.
 *
 * `label` and `href` are both `required: true` on the component, so unlike the
 * text fields there is no legitimate "clear it" — a blank is a 400, not an
 * empty string. `style` is deliberately not editable: Primary and Secondary
 * render differently by design, and that is a national decision.
 */
function shapeCtaEdit(input) {
  for (const field of ['label', 'href']) {
    const raw = input?.[field];
    if (raw === undefined) throw new BadInputError(`${field} is required`);
    if (raw !== null && typeof raw === 'object') throw new BadInputError(`${field} must be text`);
  }

  const label = String(input.label ?? '').trim();
  if (label === '') throw new BadInputError('Button text is required');
  if (label.length > MAX_LABEL_LEN) throw new BadInputError('Button text is too long');

  const href = normaliseUrl(input.href);
  if (href === null) throw new BadInputError('That link is not a valid web address');

  return { label, href };
}
```

Export both, plus `CTA_SLOTS`.

- [ ] **Step 3: Run and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/page-content.test.js
```

Expected: **53 tests** (42 + 11) — 3 `ctaSlotsFor`, 8 `shapeCtaEdit`.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/page-content.js tests/unit/page-content.test.js && \
  git commit -m "feat: CTA slot map and button validation"
```

---

### Task 3: Read and write the buttons

**Files:** Modify `controllers/chapter-admin.js`

- [ ] **Step 1: `getPage` returns each section's buttons**

A CTA hangs off its parent through the parent's `_cmps` join table. Read the
draft parent's slots, and pair each to the published parent's same slot:

```js
/**
 * The `shared.cta` row in one slot of one component, at one status.
 *
 * The join table is named after the PARENT (`components_shared_heroes_cmps`),
 * keyed by `entity_id` = the parent's id, with `field` = the slot name. A
 * mis-derived table name silently returns nothing rather than erroring.
 */
async function ctaIn(strapiInstance, parentType, parentId, slot) {
  const table = `components_${parentType.replace('shared.', 'shared_').replace(/-/g, '_')}s_cmps`;
  const row = await strapiInstance.db.connection(table)
    .where({ entity_id: parentId, component_type: 'shared.cta', field: slot })
    .first();
  if (!row) return null;
  return strapiInstance.db.query('shared.cta').findOne({ where: { id: row.cmp_id } });
}
```

**Derive the table name once and assert it**, rather than trusting the
pluralisation: `shared.hero` → `components_shared_heroes_cmps`,
`shared.upcoming-events` → `components_shared_upcoming_events_cmps`. Task 4 Step 1
checks every one against `sqlite_master` before anything depends on it.

In the section loop, alongside `values`:

```js
        ctas: await Promise.all(ctaSlotsFor(pair.type).map(async (slot) => {
          const row = await ctaIn(strapi, pair.type, pair.draftId, slot);
          return row ? { slot, label: row.label ?? '', href: row.href ?? '' } : null;
        })).then((list) => list.filter(Boolean)),
```

- [ ] **Step 2: `updatePage` writes them**

The payload gains an optional `ctas` object keyed by slot. Each is written at
both statuses, **through the same content-parity gate the text fields use** —
the reason is identical: position plus type is not proof two rows are the same
component, and an unpublished national edit must not be published as a side
effect.

```js
    // --- buttons -----------------------------------------------------------
    // Each CTA is its own component row, reached through the parent's slot.
    // Same both-statuses write and same parity gate as the text fields: a
    // published CTA that already differs from its draft is an unpublished
    // national edit, and writing it would publish something nobody approved.
    const ctaResults = [];
    for (const [slot, raw] of Object.entries(input.ctas ?? {})) {
      if (!ctaSlotsFor(pair.type).includes(slot)) {
        return ctx.badRequest('No such button on this section');
      }
      let ctaData;
      try {
        ctaData = shapeCtaEdit(raw);
      } catch (err) {
        if (err instanceof BadInputError) return ctx.badRequest(err.message);
        throw err;
      }

      const draftCta = await ctaIn(strapi, pair.type, pair.draftId, slot);
      if (!draftCta) return ctx.notFound('That button no longer exists');

      const pubCta = pair.publishedId
        ? await ctaIn(strapi, pair.type, pair.publishedId, slot) : null;
      const writeBoth = pubCta && sameForFields(draftCta, pubCta, Object.keys(ctaData));

      await strapi.db.query('shared.cta').update({ where: { id: draftCta.id }, data: ctaData });
      if (writeBoth) {
        await strapi.db.query('shared.cta').update({ where: { id: pubCta.id }, data: ctaData });
      }
      ctaResults.push({ slot, wrote: writeBoth ? 2 : 1 });
    }
```

Fold the weakest result into the response so the screen can tell the truth:

```js
    const allWrote = Math.min(targets.length, ...ctaResults.map((c) => c.wrote));
```

and report `wrote: ctaResults.length ? allWrote : targets.length`.

- [ ] **Step 3: Verify the wiring**

No new routes, no new grants — assert that, rather than assuming it:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/grants.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: 3 tests, `BOOTSTRAP OK`, then **25** — unchanged.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: chapter admins edit their page's buttons"
```

---

## Chunk 3: Images

### Task 4: The hero image

**Files:** Modify `controllers/chapter-admin.js`, `services/page-content.js`

- [ ] **Step 1: Prove the join-table naming before depending on it**

Both this chunk and Chunk 2 derive table names from component types. Check every
one that matters against the database, once:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'components_shared_%_cmps' ORDER BY name;"
```

Expected to include `components_shared_heroes_cmps`,
`components_shared_sections_cmps`, `components_shared_upcoming_events_cmps`,
`components_shared_member_groups_cmps`. **If a derived name is not in this list,
fix the derivation before writing code against it** — a wrong name returns no
rows and edits nothing, silently.

- [ ] **Step 2: The media slot map**

```js
/**
 * Single-media slots a chapter admin may replace.
 *
 * `gallery.photos` is deliberately absent: a repeatable list needs
 * add/remove/reorder, which is a different screen. `figure` is the one a
 * visitor actually looks at — every chapter hero is currently the same
 * placeholder.
 */
const MEDIA_SLOTS = {
  'shared.hero': 'figure',
  'shared.section': 'figure',
  'shared.partner-callout': 'figure',
};

const mediaSlotFor = (type) => MEDIA_SLOTS[type] ?? null;
```

- [ ] **Step 3: `getPage` reports the current image; `updatePage` sets a new one**

Read, alongside `ctas`:

```js
        image: mediaSlotFor(pair.type)
          ? { slot: mediaSlotFor(pair.type), url: row?.[mediaSlotFor(pair.type)]?.url ?? null }
          : null,
```

`getOnePopulate`-style population is needed for that to be non-null — populate
the media slot when reading the component row.

Write, after the text fields:

```js
    // --- image -------------------------------------------------------------
    // `figureId` is a media id the /chapter-admin/media endpoint already
    // returned; that endpoint owns the magic-byte sniffing and the size cap, so
    // there is nothing to re-validate here beyond "is it a number".
    //
    // Media rows are NOT draft/published — one file, two component rows
    // pointing at it — so both statuses attach the same id and the parity gate
    // does not apply.
    const slot = mediaSlotFor(pair.type);
    if (input.figureId !== undefined && input.figureId !== null) {
      if (!slot) return ctx.badRequest('This section has no image');
      const figureId = Number(input.figureId);
      if (!Number.isInteger(figureId) || figureId <= 0) {
        return ctx.badRequest('That image could not be attached');
      }
      for (const id of [pair.draftId, pair.publishedId].filter(Boolean)) {
        await strapi.db.query(pair.type).update({ where: { id }, data: { [slot]: figureId } });
      }
    }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: chapter admins replace their page's hero image"
```

---

### Task 5: Integration-test buttons and images

**Files:** Modify `tests/integration/page.test.js`

This suite already snapshots and restores every editable column per row, per
status. **Extend the snapshot to `shared.cta` rows and the media relation**
before adding cases, or the restore silently stops covering what the new tests
change.

- [ ] **Step 1: Write the tests**

```js
describe('PUT /api/chapter-admin/page — buttons', () => {
  const withCta = () => sections.find((s) => (s.ctas ?? []).length > 0);

  it('returns the buttons a section carries, with their current link', async () => {
    const s = withCta();
    expect(s).toBeTruthy();                       // aloha's zone has three
    expect(s.ctas[0]).toHaveProperty('slot');
    expect(s.ctas[0].href).toMatch(/^[/#]|^https?:/);
  });

  it('offers NO buttons for a section that has none', () => {
    const gallery = sections.find((s) => s.type === 'shared.gallery');
    expect(gallery.ctas).toEqual([]);
  });

  it('writes a new label and link at BOTH statuses', async () => {
    const s = withCta();
    const slot = s.ctas[0].slot;
    const res = await save({ index: s.index, ctas: { [slot]: {
      label: `Join ${RUN}`, href: '/chapters/aloha-hawaii/events' } } });
    expect(res.status).toBe(200);

    // Assert the rows directly — a re-read would only prove the draft changed.
    const ids = await ctaIdsFor(s.index, slot);          // helper, both statuses
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const row = await strapi.db.query('shared.cta').findOne({ where: { id } });
      expect(row.label).toBe(`Join ${RUN}`);
      expect(row.href).toBe('/chapters/aloha-hawaii/events');
    }
  });

  it('normalises an off-site link so the renderer can see it is external', async () => {
    const s = withCta();
    await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: 'Off site', href: '//evil.example/x' } } });
    const [draftId] = await ctaIdsFor(s.index, s.ctas[0].slot);
    const row = await strapi.db.query('shared.cta').findOne({ where: { id: draftId } });
    expect(row.href).toBe('https://evil.example/x');
  });

  it('400s a javascript: link and writes nothing', async () => {
    const s = withCta();
    const [draftId] = await ctaIdsFor(s.index, s.ctas[0].slot);
    const before = await strapi.db.query('shared.cta').findOne({ where: { id: draftId } });
    const res = await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: 'Bad', href: 'javascript:alert(1)' } } });
    expect(res.status).toBe(400);
    const after = await strapi.db.query('shared.cta').findOne({ where: { id: draftId } });
    expect(after).toEqual(before);
  });

  it('400s a slot the section does not have', async () => {
    const gallery = sections.find((s) => s.type === 'shared.gallery');
    const res = await save({ index: gallery.index, ctas: { primaryCta: {
      label: 'X', href: '/join' } } });
    expect(res.status).toBe(400);
  });

  it('never touches another section\'s button', async () => {
    // Derived from the database, independently of the handler's own lookup.
    const s = withCta();
    const mine = new Set(await ctaIdsFor(s.index, s.ctas[0].slot));
    const others = await strapi.db.connection('components_shared_ctas')
      .whereNotIn('id', [...mine]).select('id', 'label');
    expect(others.length).toBeGreaterThan(0);

    await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: `Isolated ${RUN}`, href: '/join' } } });

    for (const { id, label } of others) {
      const now = await strapi.db.query('shared.cta').findOne({ where: { id } });
      expect(now.label).toBe(label);
    }
  });
});

describe('PUT /api/chapter-admin/page — image', () => {
  it('reports the current image for a section that has one', () => {
    const hero = sections.find((s) => s.type === 'shared.hero');
    expect(hero.image.slot).toBe('figure');
    expect(hero.image.url).toContain('placeholder');   // every chapter, today
  });

  it('reports none for a section that has no image slot', () => {
    expect(sections.find((s) => s.type === 'shared.contact-form').image).toBeNull();
  });

  it('attaches an uploaded image at both statuses', async () => {
    const hero = sections.find((s) => s.type === 'shared.hero');
    const file = await strapi.db.connection('files').first();
    expect(file).toBeTruthy();

    const res = await save({ index: hero.index, figureId: file.id });
    expect(res.status).toBe(200);

    for (const id of [hero.draftId, await publishedIdFor(hero.index)]) {
      const linked = await strapi.db.connection('files_related_mph')
        .where({ related_id: id, related_type: 'shared.hero', field: 'figure' }).first();
      expect(linked.file_id).toBe(file.id);
    }
  });

  it('400s a figureId that is not a positive integer', async () => {
    const hero = sections.find((s) => s.type === 'shared.hero');
    for (const bad of [0, -1, 1.5, 'abc', {}]) {
      expect((await save({ index: hero.index, figureId: bad })).status,
             JSON.stringify(bad)).toBe(400);
    }
  });

  it('400s an image on a section with no image slot', async () => {
    const contact = sections.find((s) => s.type === 'shared.contact-form');
    const file = await strapi.db.connection('files').first();
    expect((await save({ index: contact.index, figureId: file.id })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/page.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **30 tests** in that file (18 + 12 — 7 buttons, 5 image), then **269 overall** (235 + 11 safe-url + 11 page-content + 12 integration).

- [ ] **Step 3: Prove the copy, the buttons AND the image came back**

Extend plan 5's snapshot query to cover CTAs and the media relation, then:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && sqlite3 .tmp/data.db < /tmp/p6-copy.sql > /tmp/p6-before.txt
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/integration/page.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && sqlite3 .tmp/data.db < /tmp/p6-copy.sql > /tmp/p6-after.txt
diff /tmp/p6-before.txt /tmp/p6-after.txt && echo "RESTORED"
```

Run the diff **whether or not the suite passed** — a failed run is exactly when
the restore is most likely to have been skipped. Then break one label by hand
and re-run the diff to confirm the gate can fail before trusting it.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/page.test.js && \
  git commit -m "test: page buttons and hero image, both statuses"
```

---

## Chunk 4: The screen

### Task 6: Buttons and an image on the page editor

**Files:** Modify `src/lib/chapter-admin/page.ts`, `src/lib/page-form.ts`, `src/components/PageSectionForm.astro`, `src/pages/api/chapter-admin/page.ts`; create `tests/unit/page-form-cta.test.ts`

- [ ] **Step 1: Types**

```ts
export interface PageCta { slot: string; label: string; href: string }
export interface PageImage { slot: string; url: string | null }

export interface PageSection {
    index: number;
    type: string;
    draftId: number;
    editable: string[];
    readOnlyReason: "rich-body" | "not-editable" | null;
    values: Record<string, string>;
    ctas: PageCta[];
    image: PageImage | null;
}
```

`savePageSection` gains `ctas?: Record<string, {label: string; href: string}>` and
`figureId?: number`.

- [ ] **Step 2: Write the failing payload test**

```ts
import { describe, it, expect } from "vitest";
import { toSectionPayload } from "../../src/lib/page-form";

const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
};

describe("toSectionPayload — buttons", () => {
    it("collects a button the section declared", () => {
        const fd = form({ sectionIndex: "0", title: "T",
                          ctaSlots: "primaryCta",
                          "cta.primaryCta.label": "Join", "cta.primaryCta.href": "/join" });
        expect(toSectionPayload(fd, ["title"])!.ctas)
            .toEqual({ primaryCta: { label: "Join", href: "/join" } });
    });

    it("collects two buttons independently", () => {
        const fd = form({ sectionIndex: "0", ctaSlots: "primaryCta,secondaryCta",
                          "cta.primaryCta.label": "A", "cta.primaryCta.href": "/a",
                          "cta.secondaryCta.label": "B", "cta.secondaryCta.href": "/b" });
        expect(Object.keys(toSectionPayload(fd, [])!.ctas!)).toEqual(["primaryCta", "secondaryCta"]);
    });

    it("ignores a slot the form did not declare, even if posted", () => {
        // Same rule as the editable-field whitelist: the form says what it
        // rendered, and nothing else gets through.
        const fd = form({ sectionIndex: "0", ctaSlots: "primaryCta",
                          "cta.primaryCta.label": "A", "cta.primaryCta.href": "/a",
                          "cta.smuggled.label": "X", "cta.smuggled.href": "/x" });
        expect(Object.keys(toSectionPayload(fd, [])!.ctas!)).toEqual(["primaryCta"]);
    });

    it("omits ctas entirely when the section declared none", () => {
        // Absent, not {} — an empty object would make the server iterate and
        // the response claim a button was written.
        expect(toSectionPayload(form({ sectionIndex: "0", title: "T" }), ["title"]))
            .not.toHaveProperty("ctas");
    });

    it("keeps a blank label so the server can reject it with a message", () => {
        // Dropping it here would turn "button text is required" into "no button
        // was submitted", and the admin would see nothing explaining the refusal.
        const fd = form({ sectionIndex: "0", ctaSlots: "primaryCta",
                          "cta.primaryCta.label": "", "cta.primaryCta.href": "/a" });
        expect(toSectionPayload(fd, [])!.ctas!.primaryCta.label).toBe("");
    });

    it("returns null when nothing at all was submitted", () => {
        expect(toSectionPayload(form({ sectionIndex: "0" }), [])).toBeNull();
    });
});
```

- [ ] **Step 3: Implement**

`toSectionPayload` reads `ctaSlots` — the comma-separated list the form
rendered — and pulls `cta.<slot>.label` / `cta.<slot>.href` for each. Exactly the
`editableFields` pattern plan 5 uses, for the same reason: the route cannot know
which slots a section has, and the server whitelists again regardless.

- [ ] **Step 4: The component**

`PageSectionForm.astro` gains, inside the existing form:

```astro
    <input type="hidden" name="ctaSlots" value={section.ctas.map((c) => c.slot).join(",")} />

    {section.ctas.map((cta) => (
        <fieldset class="psec__cta">
            <legend>{cta.slot === "secondaryCta" ? "Second button" : "Button"}</legend>
            <FormField label="Button text" name={`cta.${cta.slot}.label`} value={cta.label} required />
            <FormField label="Button links to" name={`cta.${cta.slot}.href`} value={cta.href}
                helper="A page on this site, like /events, or a full web address." />
        </fieldset>
    ))}

    {section.image && (
        <div class="psec__image">
            <p class="psec__image-label">Image</p>
            {section.image.url && <img src={section.image.url} alt="" class="psec__image-preview" />}
            <FormField label="Replace image" name="figure" type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                helper="Leave empty to keep the current image." />
        </div>
    )}
```

The form needs `enctype="multipart/form-data"` once an image slot is present.

- [ ] **Step 5: The route uploads, then saves**

Mirror `event.ts` exactly — it is the proven flow:

```ts
    let figureId: number | undefined;
    const file = form.get("figure");
    if (file instanceof File && file.size > 0) {
        const upload = await uploadMedia(jwt, file);
        if (!upload.ok) return back(base, `error=upload&message=${encodeURIComponent(upload.message)}`);
        figureId = upload.id;
    }
```

and pass `figureId` through to `savePageSection`. Add `upload` to the screen's
`errorMessages` map, or an upload failure redirects to a code with no message.

- [ ] **Step 6: Write the failing render test**

```ts
describe("PageSectionForm — buttons and image", () => {
    const withCta = { ...base, ctas: [{ slot: "primaryCta", label: "Learn More", href: "/about" }] };

    it("renders a text and a link field per button, with current values", async () => {
        const html = await render({ section: withCta });
        expect(html).toContain('name="cta.primaryCta.label"');
        expect(html).toContain("Learn More");
        expect(html).toContain('name="cta.primaryCta.href"');
        expect(html).toContain("/about");
    });

    it("declares its slots so the save route knows what to collect", async () => {
        // Omitting this makes every button save silently do nothing, with the
        // whole suite green — the shape of a bug plan 5 shipped and caught.
        const html = await render({ section: withCta });
        expect(html).toContain('name="ctaSlots"');
        expect(html).toContain('value="primaryCta"');
    });

    it("renders NO button fields for a section with none", async () => {
        const html = await render({ section: { ...base, ctas: [] } });
        expect(html).not.toContain("cta.");
        expect(html).toMatch(/value=""[^>]*name="ctaSlots"|name="ctaSlots"[^>]*value=""/);
    });

    it("shows the current image and a replace field", async () => {
        const html = await render({ section: { ...base,
            image: { slot: "figure", url: "/uploads/placeholder.png" } } });
        expect(html).toContain("/uploads/placeholder.png");
        expect(html).toContain('type="file"');
        expect(html).toContain("multipart/form-data");
    });

    it("renders NO image field for a section without one", async () => {
        const html = await render({ section: { ...base, image: null } });
        expect(html).not.toContain('type="file"');
    });

    it("survives a section whose ctas and image are absent entirely", async () => {
        // An API a version behind must degrade to plan 5's behaviour, not throw.
        const { ctas, image, ...older } = base as any;
        const html = await render({ section: older });
        expect(html).toContain("<form");
    });
});
```

- [ ] **Step 7: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: 0 errors, then **102 passed** (90 + 6 payload + 6 render).

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && git add -A src/ tests/ && \
  git commit -m "feat: edit the page's buttons and hero image"
```

---

## Chunk 5: Verification

### Task 7: Both suites, twice, with no drift

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **269 CMS**, **102 frontend**, 0 typecheck errors, `pages_cmps`
byte-identical across two CMS runs, and the extended copy snapshot unchanged.

### Task 8: Prove it in a browser

Snapshot first, with a scripted restore ready **before** the servers start.

| # | Action | Expected |
|---|---|---|
| 1 | `/page`, the Header card | Heading, Body Text, **Button text** "Learn More", **Button links to** `/about`, and the current **image** |
| 2 | Change the button to "Join AREAA Hawaii" → `/chapters/aloha-hawaii` → Save | "Section saved." |
| 3 | **Visit the microsite** | The hero button says the new text and goes to the chapter page — **the thing this plan exists for** |
| 4 | Upload a real image on the hero → Save | Preview updates; the microsite shows it, replacing the placeholder |
| 5 | Set a button link to `javascript:alert(1)` | Refused with "That link is not a valid web address"; nothing written; no alert on the public page |
| 6 | Set a button link to `//evil.example` | Stored as `https://evil.example/`, and the rendered link carries `rel="noopener noreferrer"` |
| 7 | Gallery card | Heading only — no button, no image field |
| 8 | Disable JavaScript, repeat 2 | Works identically. Repeat 4 — a file input needs no JS either |
| 9 | Edit the hero, whose draft and published differ today | "Saved to your draft…" — plan 5's parity guard still fires |
| 10 | As `twochapter@areaa.test`, chapter B's page | B's own buttons, not A's |

Restore, verify against the snapshot, then stop the servers.

---

## Done when

- **269 CMS and 102 frontend tests green**, CMS twice, `pages_cmps` byte-identical.
- A chapter admin changes a button's text and link, **with JavaScript disabled**, and the public microsite shows it.
- A chapter admin replaces the hero placeholder with a real image, and the microsite shows it.
- Both are written at draft **and** published, under plan 5's content-parity gate.
- `javascript:` is refused with a message the admin can act on; `//evil.example` is stored absolute so the renderer adds `rel="noopener"`.
- A section with no button offers no button fields; one with no image offers no file field.
- All six `normaliseUrl` mutations are killed, on a baseline asserted green first.
- Permissions are still **25** — this plan adds no routes.

## Deferred: rich text

Not in this plan, and the reasons are worth keeping because they were expensive
to learn. Two review rounds against a TipTap-based draft established:

- **ProseMirror does not reject an unknown node or mark — it discards the entire
  document** and logs to `console.warn`. Any converter mismatch is total silent
  data loss, not a degraded paragraph.
- **The mark is `strike`, not `strikethrough`**, and **StarterKit has no image
  node at all**; a Strapi image block destroys the document unless a custom atom
  node is registered. A minimal one was written and verified to round-trip.
- **StarterKit v3 already bundles Link**; adding `@tiptap/extension-link`
  alongside it warns and the winning config is undefined. `link: false` removes
  the mark entirely.
- **A `JSON.stringify` comparison cannot be used to verify a round trip** —
  national's block editor emits mixed key order within a single array, so 7 of 8
  realistic documents compare unequal while being logically identical.
- `blocksToPlainText` is lossy in three ways a naive "is it plain?" check misses:
  soft breaks, leading/trailing whitespace, and deliberate spacer paragraphs.

A future plan should start from an editor-backed round-trip test over real
database rows, written **before** any converter, and treat the pure test as a
diagnostic rather than a gate.

## Known limitations, accepted

- **`style` on a button is not editable.** Primary and Secondary render
  differently by design; a chapter admin can change what a button says and where
  it goes, not how prominent it is.
- **Gallery photos are still placeholders.** A repeatable media list needs its
  own screen.
- **The old image is not deleted** when a new one is uploaded. Strapi's media
  library keeps it, as it does for events today. Orphan cleanup is its own job.
- **No image dimension or aspect guidance.** A chapter admin can upload a
  portrait photo into a landscape hero and it will be cropped by CSS.
- **`videoUrl` and `feedUrl` remain national-only**, so a chapter cannot point
  its own video or social feed anywhere.
- **`rel="noopener"` depends on the renderer**, which infers "external" from the
  href starting `http`. Storing off-site links absolute is what makes that
  inference correct — but the inference itself lives in `RichTextInline` and
  `Hero.astro` and is not enforced by this plan.
