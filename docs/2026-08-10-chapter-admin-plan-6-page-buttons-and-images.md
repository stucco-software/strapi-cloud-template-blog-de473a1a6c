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

  it('returns null rather than throwing when the path normalises to an authority', () => {
    // `new URL('//', base)` throws. Fuzzing found 54 inputs that reach it, and
    // every one produced an HTTP 500 with no message because shapeCtaEdit
    // calls this outside any try.
    for (const u of ['/..//', '/.//', './/', '..//', 'a/..//', '/..///', '/.\\']) {
      expect(() => normaliseUrl(u), JSON.stringify(u)).not.toThrow();
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('REJECTS anything that normalises to an empty href', () => {
    // `?` and `?#` produced '' — stored, rendering <a href=""> which reloads
    // the page, and contradicting this plan's own "a blank is a 400" rule.
    for (const u of ['?', '?#', '#']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('caps the OUTPUT, not just the input', () => {
    // Percent-encoding can triple the length. An 801-char href that stores as
    // 2401 saves once and then fails every later save of that section forever.
    const long = '/' + '<'.repeat(800);
    expect(long.length).toBeLessThan(MAX_URL_LEN);
    expect(normaliseUrl(long)).toBeNull();
  });

  it('is idempotent — normalising twice changes nothing', () => {
    // A save re-reads and re-writes; a non-idempotent normaliser would drift a
    // href on every edit.
    // Includes the inputs that broke the first draft's version of this test:
    // it hand-picked six that happened to work while asserting a property that
    // was false for '?' (→ '') and for anything percent-expanding.
    for (const u of ['/join', '#contact', 'https://areaa.org/x', 'mailto:a@b.org',
                     '//evil.example/x', '/.//evil.example/x', '/a b', '/%2e%2e//x',
                     '/events?q=a b#top']) {
      const once = normaliseUrl(u);
      if (once === null) continue;
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
  if (raw === '') return null;
  // The cap is re-checked on the OUTPUT at the end. Checking only the input
  // lets an 801-character href normalise to 2401 percent-encoded characters,
  // store fine, and then fail every subsequent save of that section forever —
  // the same trap `page-content.js` documents for MAX_TEXT_LEN.
  if (raw.length > MAX_URL_LEN) return null;

  // EVERYTHING inside the try. `new URL('//', base)` throws — there is no host
  // — and a pathname can normalise to exactly `//` from ordinary-looking input.
  // Fuzzing found 54 such strings (`/..//`, `.//`, `/.\`, `a/..//`, …); each
  // one produced an uncaught TypeError and an HTTP 500 with no message,
  // because shapeCtaEdit calls this outside any try.
  let out;
  try {
    const parsed = new URL(raw, `${BASE}/`);

    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;
    if (parsed.username !== '' || parsed.password !== '') return null;

    if (parsed.origin !== BASE_ORIGIN) {
      out = parsed.href;                       // off-site: absolute, so the
                                               // renderer can tell
    } else {
      const rel = `${parsed.pathname}${parsed.search}${parsed.hash}`;

      if (rel.startsWith('//')) {
        // The path itself is an authority. `/.//evil.example/x` normalises to
        // `//evil.example/x`, which renders as an in-site link and navigates
        // off-site.
        out = new URL(rel, `${BASE}/`).href;
      } else if (parsed.pathname === '/' && raw.startsWith('#')) {
        out = parsed.hash;                     // `#contact` scrolls; `/#contact`
      } else if (parsed.pathname === '/' && raw.startsWith('?')) {
        out = `${parsed.search}${parsed.hash}`;
      } else {
        out = rel;
      }
    }
  } catch {
    return null;
  }

  // `?` and `?#` reach here as the empty string, which would store href="" and
  // render <a href=""> — a link that reloads the page. Both fields are
  // required:true on the component; an empty result is a refusal.
  if (typeof out !== 'string' || out === '') return null;
  if (out.length > MAX_URL_LEN) return null;
  return out;
}

module.exports = { normaliseUrl, MAX_URL_LEN, ALLOWED_SCHEMES };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/safe-url.test.js
```

Expected: PASS, **14 tests**.

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
    expect(ctaSlotsFor('shared.news-and-resources')).toEqual(['link']);
  });

  it('does NOT offer a slot for partner-callout, which has no renderer', () => {
    // Its schema has a `link`, but PageBody never dispatches it and
    // toPartnershipProps never forwards a cta — the button would be editable
    // and invisible.
    expect(ctaSlotsFor('shared.partner-callout')).toEqual([]);
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
  'shared.upcoming-events': ['link'],
  'shared.member-group': ['link'],
  'shared.news-and-resources': ['link'],
  // NO 'shared.partner-callout'. It has a `link` in its schema and NO RENDERER:
  // PageBody dispatches partner-GROUP to Partnership.astro and lets
  // partner-callout fall through to null. Zero rows exist in any zone. An
  // editable button on a component that never appears is a screen that lies.
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

Expected: **55 tests** (42 + 13) — 4 `ctaSlotsFor`, 8 `shapeCtaEdit`, 1 table-parity.

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
 * The join table that carries a component's nested components.
 *
 * AN EXPLICIT MAP, NOT A DERIVATION. The obvious string transform
 * (`replace('shared.','shared_')` + `'s_cmps'`) is wrong for every entry that
 * matters: `shared.hero` yields `components_shared_heros_cmps` where the real
 * table is `..._heroes_cmps`, and `shared.upcoming-events` yields a doubled
 * `...eventss_cmps`. English pluralisation is not a string transform.
 *
 * This matters more than a typo: a wrong table name returns NO ROWS. The read
 * shows no buttons and the write edits nothing — silently, with a 200.
 */
const CMPS_TABLE = {
  'shared.hero': 'components_shared_heroes_cmps',
  'shared.section': 'components_shared_sections_cmps',
  'shared.upcoming-events': 'components_shared_upcoming_events_cmps',
  'shared.member-group': 'components_shared_member_groups_cmps',
  'shared.news-and-resources': 'components_shared_news_and_resources_cmps',
};

/** The `shared.cta` row in one slot of one component, at one status. */
async function ctaIn(strapiInstance, parentType, parentId, slot) {
  const table = CMPS_TABLE[parentType];
  if (!table) return null;
  const row = await strapiInstance.db.connection(table)
    .where({ entity_id: parentId, component_type: 'shared.cta', field: slot })
    .first();
  if (!row) return null;
  return strapiInstance.db.query('shared.cta').findOne({ where: { id: row.cmp_id } });
}
```

**Every name in that map must be checked against `sqlite_master` before anything
depends on it** — Task 4 Step 1 does exactly that, and it is a gate, not a
formality.

`CMPS_TABLE` lives beside `CTA_SLOTS` in **`services/page-content.js`**, not in
the controller, and both are exported — otherwise the parity test below cannot
be written. Add it to Task 2's file, which brings that suite to **54**:

```js
  it('has a join table for every type that declares a CTA slot', () => {
    // Without this, a component gaining a slot without a table entry shows no
    // buttons and saves nothing — silently, with a 200. `ctaIn` returns null
    // for an unknown table and `getPage` filters nulls, so the runtime failure
    // is invisible. This test is the only loud one.
    expect(Object.keys(CMPS_TABLE).sort()).toEqual(Object.keys(CTA_SLOTS).sort());
  });
```

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
    // --- text --------------------------------------------------------------
    // `shapeComponentEdit` THROWS when no whitelisted text field is present.
    // That is correct for plan 5, where text was the only thing a save could
    // carry — but a buttons-only or image-only payload has none, and without
    // this the CTA and image code below is unreachable. Verified: every
    // cta-only save returned `400 Nothing editable was submitted`, three of
    // this plan's own tests failed, and four more passed against a guard that
    // never reached the code they name.
    const hasExtras = Boolean(input.ctas) || input.figureId !== undefined;
    let data = {};
    try {
      data = shapeComponentEdit(input, pair.type);
    } catch (err) {
      if (!(err instanceof BadInputError)) throw err;
      // Only tolerable when the save is carrying something else.
      if (!hasExtras || err.message !== 'Nothing editable was submitted') {
        return ctx.badRequest(err.message);
      }
    }

**Plan 5's text-write line changes too.** It currently reads

```js
    const targets = [pair.draftId, publishedId].filter((id) => id !== null);
```

and must become

```js
    // Empty when the save carries only buttons or only an image.
    const targets = Object.keys(data).length === 0
      ? [] : [pair.draftId, publishedId].filter((id) => id !== null);
```

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

- [ ] **Step 2b: Report each facet, because they are gated independently**

A single `wrote` number cannot describe this save. Three things are written
under three different rules: text is parity-gated, each button is parity-gated
**separately**, and the image is ungated by design. Measured on aloha's Header
card, where the text is diverged but the CTAs are byte-identical:

```
text  -> 1 (held back)      buttons -> 2 (live)      image -> 2 (live)
Math.min(...) = 1  ->  "your live page hasn't changed yet"
```

…while the live page's button text and hero image had just changed. `Math.min`
is also plain wrong once `targets` is empty: `Math.min(0, 2)` is 0.

Report the facets and let the screen tell the truth:

```js
    const facets = [];
    if (Object.keys(data).length > 0) facets.push({ kind: 'text', wrote: targets.length });
    for (const c of ctaResults) facets.push({ kind: 'button', slot: c.slot, wrote: c.wrote });
    if (wroteImage) facets.push({ kind: 'image', wrote: imageTargets.length });

    const live = facets.filter((f) => f.wrote === 2).length;
    const held = facets.filter((f) => f.wrote < 2).length;

    ctx.body = {
      data: { index, type: pair.type, facets, live, held },
      meta: {
        structureDiverged: found.structureDiverged,
        // Only when something was actually held back.
        skipReason: held > 0 ? (skipReason ?? 'content-diverged') : null,
      },
    };
```

**This changes the response shape, and the client reads the old one.** Task 6
must carry `live` and `held` across the repo boundary or the feature works while
the screen reports the opposite. Traced end to end against a stubbed body: with
`savePageSection` still doing `wrote: body?.data?.wrote ?? 0`, `wrote` is
**always 0**, plan 5's route branches `if (result.wrote < 2)` — always true — and
**every save, including a completely successful one, reports "Saved to your
draft. Your live page hasn't changed yet."** All 121 tests stay green.

Six hops, all of which Task 6 must specify:

1. `savePageSection`'s return type gains `live: number; held: number` and stops
   reading `data.wrote`.
2. Its body read becomes `live: body?.data?.live ?? 0, held: body?.data?.held ?? 0`.
3. `src/pages/api/chapter-admin/page.ts` branches three ways instead of two.
4. `page.astro`'s `flashes` map gains a third key.
5. A `PageSaveResult` type is declared and exported.
6. **A unit test for `savePageSection` that stubs the new body** — there is no
   client test in the suite today, which is exactly why this hop was silent.

```ts
// src/pages/api/chapter-admin/page.ts
    if (result.held === 0) return back(base, "saved=1");
    if (result.live === 0) return back(base, `saved=draft&why=${result.skipReason ?? "unknown"}`);
    return back(base, "saved=partial");
```

```ts
// page.astro
    "partial": "Saved. Part of this section is live now; the rest is waiting for AREAA national to publish.",
```

| `live` | `held` | Flash |
|---|---|---|
| >0 | 0 | "Section saved." |
| 0 | >0 | "Saved to your draft." + the `skipReason` explanation |
| >0 | >0 | "Saved. Part of this section is live now; the rest is waiting…" |

The third row is what aloha's Header does **today** — its text is diverged, its
buttons are not — so it is the common case, not an edge.

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

The component row must be read **with the media relation populated**, or
`row.figure` is undefined and the screen never shows the current image. Change
the existing read in the section loop:

```js
      const slot = mediaSlotFor(pair.type);
      const row = await strapi.db.query(pair.type).findOne({
        where: { id: pair.draftId },
        ...(slot ? { populate: { [slot]: true } } : {}),
      });
```

then, alongside `ctas`:

```js
        image: slot ? { slot, url: row?.[slot]?.url ?? null } : null,
```

**Verify this populates before building on it.** `db.query(...).findOne` on a
*component* is not obviously the same as on an entity:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node -e '
const { createStrapi, compileStrapi } = require("@strapi/strapi");
(async () => {
  const app = await createStrapi(await compileStrapi()).load(); app.log.level = "error";
  const row = await app.db.query("shared.hero").findOne({ where: { id: 3 }, populate: { figure: true } });
  console.log("figure =", JSON.stringify(row?.figure));
  await app.destroy(); process.exit(0);
})();'
```

Expected: a media object with a `url`. **If it comes back undefined, stop** — the
read shape is wrong and every image assertion below is untestable.

Write, after the text fields:

```js
    // --- image -------------------------------------------------------------
    // `figureId` is a media id the /chapter-admin/media endpoint already
    // returned; that endpoint owns the magic-byte sniffing and the size cap, so
    // there is nothing to re-validate here beyond "is it a number".
    //
    // Media rows are NOT draft/published — one file, two component rows
    // pointing at it — so there is no unpublished-edit to accidentally publish.
    //
    // BUT the parity gate has a second job the first draft missed: it also
    // catches a MISPAIRING. Position plus matching type is not proof two rows
    // are the same component, and a same-type reorder in the draft means
    // `pair.publishedId` can name a component the admin never opened. Use the
    // gated `publishedId`, not the raw pair, or their new image lands publicly
    // on someone else's section with a 200.
    const slot = mediaSlotFor(pair.type);
    let wroteImage = false;
    let imageTargets = [];
    if (input.figureId !== undefined && input.figureId !== null) {
      if (!slot) return ctx.badRequest('This section has no image');
      // A string is legitimate — the form posts one — but it must be a whole
      // positive number.
      const figureId = Number(input.figureId);
      if (!Number.isInteger(figureId) || figureId <= 0) {
        return ctx.badRequest('That image could not be attached');
      }
      imageTargets = [pair.draftId, publishedId].filter(Boolean);
      for (const id of imageTargets) {
        await strapi.db.query(pair.type).update({ where: { id }, data: { [slot]: figureId } });
      }
      wroteImage = true;
    }
```

**Verify this writes `files_related_mph` before building on it**, for the same
reason — component media relations are not obviously the same as entity ones:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node -e '
const { createStrapi, compileStrapi } = require("@strapi/strapi");
(async () => {
  const app = await createStrapi(await compileStrapi()).load(); app.log.level = "error";
  const before = await app.db.connection("files_related_mph")
    .where({ related_id: 3, related_type: "shared.hero", field: "figure" }).first();
  console.log("before:", JSON.stringify(before));
  const other = await app.db.connection("files").whereNot("id", before.file_id).first();
  await app.db.query("shared.hero").update({ where: { id: 3 }, data: { figure: other.id } });
  const after = await app.db.connection("files_related_mph")
    .where({ related_id: 3, related_type: "shared.hero", field: "figure" }).first();
  console.log("after :", JSON.stringify(after));
  await app.db.query("shared.hero").update({ where: { id: 3 }, data: { figure: before.file_id } });
  console.log("restored");
  await app.destroy(); process.exit(0);
})();'
```

Expected: `file_id` changes and changes back. **If it does not, the write shape is
wrong** and the correct form is a direct `files_related_mph` upsert — find out
here, not from a green test suite that asserted nothing.

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
status — **for text only**. Left as-is, one green run permanently rewrites
aloha's *published* hero button and *published* hero image with test junk.
Measured:

```
175|Learn More|/about  ->  175|Isolated …|/join   (draft)
178|Learn More|/about  ->  178|Isolated …|/join   (PUBLISHED)
hero figure: file 12 (placeholder)  ->  file 1 ("Screenshot 2026-05-20…png")
```

The suite is also not re-runnable: the second run fails
`expect(hero.image.url).toContain('placeholder')`, because the first run
destroyed the placeholder that assertion depends on.

- [ ] **Step 0: Extend the snapshot and the restore — before adding any case**

In `beforeAll`, alongside the existing text capture:

```js
  // Every CTA row on this chapter's zone, both statuses.
  ctaSnapshot = [];
  for (const s of sections) {
    for (const slot of (s.ctas ?? []).map((c) => c.slot)) {
      for (const id of await ctaIdsFor(s.index, slot)) {
        const row = await strapi.db.query('shared.cta').findOne({ where: { id } });
        if (row) ctaSnapshot.push({ id, label: row.label, href: row.href });
      }
    }
  }

  // Every media relation on this chapter's zone, both statuses.
  mediaSnapshot = await strapi.db.connection('files_related_mph')
    .whereIn('related_id', (await Promise.all(
      sections.map((s) => parentIdsFor(s.index)))).flat())
    .select('related_id', 'related_type', 'field', 'file_id', 'order');
```

and in `afterAll`, inside the existing inner `try`:

```js
    for (const c of ctaSnapshot) {
      await strapi.db.query('shared.cta')
        .update({ where: { id: c.id }, data: { label: c.label, href: c.href } });
    }
    for (const m of mediaSnapshot) {
      await strapi.db.query(m.related_type)
        .update({ where: { id: m.related_id }, data: { [m.field]: m.file_id } });
    }
```

Declare `ctaSnapshot` and `mediaSnapshot` beside `snapshot` at the top.

Then replace the seed-dependent assertion, which the suite destroys:

```diff
-    expect(hero.image.url).toContain('placeholder');   // every chapter, today
+    // NOT toContain('placeholder') — this suite reassigns the figure, so that
+    // assertion passes once and fails on every later run.
+    expect(hero.image.url).toMatch(/^\/uploads\//);
```

- [ ] **Step 1: Write the tests**

These use two helpers the suite does not have yet. Define them beside the
existing ones, and derive them from `pages_cmps` rather than from the handler's
own lookup — otherwise the tests use the function under test as their oracle:

```js
/** The draft and published parent ids for one section index. */
const parentIdsFor = async (index) => {
  const zone = await strapi.db.connection('pages_cmps as z')
    .join('pages as p', 'p.id', 'z.entity_id')
    .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
    .join('chapters as c', 'c.id', 'l.chapter_id')
    .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
    .orderBy(['z.entity_id', 'z.order'])
    .select('z.cmp_id', 'z.entity_id', 'z.order');
  const byPage = {};
  for (const r of zone) (byPage[r.entity_id] ??= []).push(r.cmp_id);
  return Object.values(byPage).map((ids) => ids[index]).filter((v) => v !== undefined);
};

const publishedIdFor = async (index) => (await parentIdsFor(index))[1];

/** Both statuses' shared.cta ids for one slot of one section. */
const ctaIdsFor = async (index, slot) => {
  const CMPS = {
    'shared.hero': 'components_shared_heroes_cmps',
    'shared.section': 'components_shared_sections_cmps',
    'shared.upcoming-events': 'components_shared_upcoming_events_cmps',
    'shared.member-group': 'components_shared_member_groups_cmps',
    'shared.news-and-resources': 'components_shared_news_and_resources_cmps',
    'shared.partner-callout': 'components_shared_partner_callouts_cmps',
  };
  const type = sections.find((s) => s.index === index).type;
  const out = [];
  for (const parentId of await parentIdsFor(index)) {
    const row = await strapi.db.connection(CMPS[type])
      .where({ entity_id: parentId, component_type: 'shared.cta', field: slot }).first();
    if (row) out.push(row.cmp_id);
  }
  return out;
};
```

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

  it('ACCEPTS a save carrying only buttons, with no text field', async () => {
    // The guard `shapeComponentEdit` throws is correct for plan 5 and fatal
    // here: a buttons-only payload is what the form posts when the admin
    // touched only the button. Without Task 3's hasExtras tolerance EVERY line
    // of the CTA and image code is unreachable — verified: cta-only saves
    // returned 400 "Nothing editable was submitted", and four tests in this
    // very suite passed against that guard instead of the code they name.
    const s = withCta();
    const res = await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: `Buttons only ${RUN}`, href: '/join' } } });
    expect(res.status).toBe(200);
    const [draftId] = await ctaIdsFor(s.index, s.ctas[0].slot);
    expect((await strapi.db.query('shared.cta').findOne({ where: { id: draftId } })).label)
      .toBe(`Buttons only ${RUN}`);
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
    // A file that is NOT the one already attached, so the assertion is not
    // satisfied by the starting state.
    const current = await strapi.db.connection('files_related_mph')
      .where({ related_id: hero.draftId, related_type: 'shared.hero', field: 'figure' }).first();
    const file = await strapi.db.connection('files')
      .whereNot('id', current?.file_id ?? -1).orderBy('id').first();
    expect(file).toBeTruthy();

    const res = await save({ index: hero.index, figureId: file.id });
    expect(res.status).toBe(200);

    for (const id of [hero.draftId, await publishedIdFor(hero.index)]) {
      const linked = await strapi.db.connection('files_related_mph')
        .where({ related_id: id, related_type: 'shared.hero', field: 'figure' }).first();
      expect(linked.file_id).toBe(file.id);
    }
  });

  it('ACCEPTS a save carrying only an image, with no text field', async () => {
    const hero = sections.find((x) => x.type === 'shared.hero');
    const current = await strapi.db.connection('files_related_mph')
      .where({ related_id: hero.draftId, related_type: 'shared.hero', field: 'figure' }).first();
    const file = await strapi.db.connection('files')
      .whereNot('id', current?.file_id ?? -1).orderBy('id').first();
    expect((await save({ index: hero.index, figureId: file.id })).status).toBe(200);
  });

  it('accepts a figureId posted as a string, which is what the form sends', async () => {
    const hero = sections.find((x) => x.type === 'shared.hero');
    const file = await strapi.db.connection('files').orderBy('id').first();
    expect((await save({ index: hero.index, figureId: String(file.id) })).status).toBe(200);
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

Expected: **33 tests** in that file (18 + 15 — 8 buttons, 7 image), then **277 overall** (235 + 14 safe-url + 13 page-content + 15 integration).

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

- [ ] **Step 1: Types, and the message the admin needs to see**

`savePageSection` returns `{ok, status, wrote, skipReason}` — **no `message`** —
and the route collapses every 400 into `error=stale` → *"That section changed
while you were editing. Reload and try again."* So `"That link is not a valid web
address"`, `"Button text is required"` and `"No such button on this section"` all
reach the admin as advice to reload, which does nothing. They retype the same
href and get the same non-answer.

Carry the reason through, exactly as plan 5 carries `skipReason`:

```ts
// src/lib/chapter-admin/page.ts
// `SkipReason` is plan 5's, already exported from this file.
export interface PageSaveResult {
    ok: boolean;
    status: number;
    /** Facets that reached the published row. */
    live: number;
    /** Facets held back by the parity gate. */
    held: number;
    skipReason: SkipReason;
    message: string;
}

export async function savePageSection(
    jwt: string,
    chapterSlug: string,
    index: number,
    values: Record<string, unknown>,
    extra: { ctas?: Record<string, { label: string; href: string }>; figureId?: number } = {}
): Promise<PageSaveResult> {
    const { status, body } = await call(jwt, "/page", {
        method: "PUT",
        // NOTE the shape: values are spread at TOP LEVEL, beside chapterSlug and
        // index — not nested under `values`. The server reads input.title,
        // input.ctas, input.figureId. Nesting them posts a body it ignores.
        body: JSON.stringify({ chapterSlug, index, ...values, ...extra }),
    });
    return {
        ok: status === 200 && Boolean(body?.data),
        status,
        // `live` and `held` COUNT FACETS, not statuses. One save writes text,
        // each button and the image under three different gates, so a single
        // number cannot describe it — and reading the `wrote` this endpoint no
        // longer sends yields 0, which makes every save look like a failure.
        live: body?.data?.live ?? 0,
        held: body?.data?.held ?? 0,
        skipReason: body?.meta?.skipReason ?? null,
        message: body?.error?.message ?? "",
    };
}
```

In the route, a 400 now carries its reason:

```ts
    if (result.status === 400) {
        return back(base, `error=invalid&why=${encodeURIComponent(result.message)}`);
    }
```

and the screen renders it, falling back when the server sent nothing:

```ts
    invalid: why || "Please check that section and try again.",
```

**Two consequences the first draft did not weigh.** The value is reflected
verbatim into a `role="alert"` box, so (a) a crafted URL can put arbitrary text
on an admin's own page — Astro escapes it, so it is a phishing surface rather
than an XSS, but plan 5's `why` was looked up in a fixed map and this one is
not; and (b) every reachable 400 message is now admin-facing copy. Audit them
before shipping: `chapterSlug is required`, `title is too long`,
`Nothing editable was submitted` and `body is too long` all read as developer
strings. **Map a small set of known reasons on the screen and fall back for the rest.**
That keeps the reflection surface closed and is the smaller change; leaving the
choice open means a worker copies the reflecting variant and skips the audit.

```ts
const SERVER_REASONS: Record<string, string> = {
    "That link is not a valid web address": "That link is not a valid web address.",
    "Button text is required": "Every button needs text.",
    "No such button on this section": "That button is no longer on this section. Reload the page.",
    "This section has no image": "That section doesn't have an image.",
};
// … invalid: SERVER_REASONS[why ?? ""] ?? "Please check that section and try again.",
```

`error=stale` becomes unreachable once 400s carry `invalid`; delete it from
`errorMessages` rather than leaving dead copy.

- [ ] **Step 1b: Types**

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
    // OPTIONAL, deliberately. Plan 5's test fixtures carry neither, and an API
    // one deploy behind sends neither. The component reads both defensively.
    ctas?: PageCta[];
    image?: PageImage | null;
}
```

`savePageSection` gains `ctas?: Record<string, {label: string; href: string}>` and
`figureId?: number`.

- [ ] **Step 1c: A client test, because this hop has never had one**

`tests/unit/page-client.test.ts`. The facet boundary broke silently precisely
because nothing exercised `savePageSection`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { savePageSection } from "../../src/lib/chapter-admin/page";

const respond = (body: unknown, status = 200) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
        JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
};
afterEach(() => vi.unstubAllGlobals());

describe("savePageSection", () => {
    it("reads live and held from the facet response", async () => {
        respond({ data: { facets: [], live: 2, held: 1 }, meta: { skipReason: "content-diverged" } });
        const r = await savePageSection("j", "boston", 0, {});
        expect(r.live).toBe(2);
        expect(r.held).toBe(1);
        expect(r.skipReason).toBe("content-diverged");
    });

    it("reports nothing held when the save was clean", async () => {
        respond({ data: { facets: [], live: 3, held: 0 }, meta: { skipReason: null } });
        const r = await savePageSection("j", "boston", 0, {});
        expect(r.held).toBe(0);
        expect(r.ok).toBe(true);
    });

    it("carries the server's message on a 400", async () => {
        respond({ error: { message: "That link is not a valid web address" } }, 400);
        const r = await savePageSection("j", "boston", 0, {});
        expect(r.ok).toBe(false);
        expect(r.message).toBe("That link is not a valid web address");
    });

    it("does not invent facets when the server sends none", async () => {
        respond({ data: {} });
        const r = await savePageSection("j", "boston", 0, {});
        expect(r.live).toBe(0);
        expect(r.held).toBe(0);
    });
});
```

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

**Both of plan 5's early returns have to move.** Note this is currently
*unreachable from the UI*: `PageSectionForm` gates the whole `<form>` on
`canEdit = section.editable.length > 0`, so a section with buttons and no
editable text renders no form at all. Every CTA-bearing type has `title` today,
so nothing breaks — but the guard and the server's matching `hasExtras`
tolerance (Task 3 Step 2) are what make the capability real rather than
asserted, and the first type without editable text would otherwise fail with
`Nothing editable was submitted` shown verbatim to the admin.

Change `canEdit` in the same step, **and gate the read-only note on it** — a
section with a CTA but no editable text otherwise renders "There's nothing to
edit on this section." directly above a working Save button. Measured:
`HAS NOTE: true  HAS FORM: true  HAS SAVE: true`.

```diff
-const canEdit = section.editable.length > 0;
+const canEdit = section.editable.length > 0 || ctas.length > 0 || Boolean(image);
```

```diff
-    {section.readOnlyReason === "not-editable" && (
+    {section.readOnlyReason === "not-editable" && !canEdit && (
```

Not reachable today — every CTA-bearing and media-bearing type has `title` in
`EDITABLE_BY_TYPE` — so this is future-proofing whose only observable effect
today would be that contradiction. Both halves or neither.

```diff
-    if (editable.length === 0) return null;
     …
-    if (Object.keys(values).length === 0) return null;
+    // Null only when there is nothing to save. `figureId` is NOT checked here:
+    // the route uploads the file and passes the id straight to
+    // savePageSection, so it never reaches this function.
+    if (Object.keys(values).length === 0 && !ctas) return null;
```

`ctas` is omitted entirely rather than sent as `{}` when the form declared no
slots — an empty object would make the server iterate and the response claim a
button was written.

- [ ] **Step 4: The component**

`PageSectionForm.astro` gains, inside the existing form:

`ctas` and `image` are **optional** on `PageSection`, and plan 5's existing test
fixture supplies neither. Read them defensively at the top of the frontmatter, or
the component throws on every one of plan 5's tests:

```astro
const ctas = section.ctas ?? [];
const image = section.image ?? null;
```

```astro
    <input type="hidden" name="ctaSlots" value={ctas.map((c) => c.slot).join(",")} />

    {ctas.map((cta, i) => (
        <fieldset class="psec__cta">
            {/* By POSITION among the rendered slots, not by slot name: a
                section whose only CTA sits in `secondaryCta` — which is aloha's
                Text Section — would otherwise be headed "Second button" with no
                first button anywhere. */}
            <legend>{ctas.length > 1 ? `Button ${i + 1}` : "Button"}</legend>
            <FormField label="Button text" name={`cta.${cta.slot}.label`} value={cta.label}
                idSuffix={String(section.index)} required />
            <FormField label="Button links to" name={`cta.${cta.slot}.href`} value={cta.href}
                idSuffix={String(section.index)} required
                helper="A page on this site, like /events, or a full web address." />
        </fieldset>
    ))}

    {image && (
        <div class="psec__image">
            <p class="psec__image-label">Image</p>
            {image.url && (
                <img src={mediaUrl({ url: image.url })} alt="" class="psec__image-preview" />
            )}
            <FormField label="Replace image" name="figure" type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                helper="Leave empty to keep the current image." />
        </div>
    )}
```

`mediaUrl` from `../lib/media` — Strapi's local provider stores `/uploads/…`,
which 404s when rendered from the Astro origin.

**The file input needs a unique id.** `FormField.astro` builds
`id={`field-${name}`}`, and `MEDIA_SLOTS` covers both `shared.hero` and
`shared.section` — aloha's zone has one of each, so two elements would carry
`id="field-figure"` and clicking the Text Section's "Replace image" label would
open the **Header's** file picker. Plan 5 already duplicates `field-title` across
eleven cards, but a label *is* the affordance for a file input, and this is the
first case where mis-targeting changes which section gets edited.

**Every field on this card needs it, not just the file input.** `CTA_SLOTS`
gives hero *and* section `primaryCta`, so `id="field-cta.primaryCta.label"`
collides across the two exactly as `field-figure` does — clicking the Text
Section's "Button text" label focuses the Header's input. Measured; the plan's
own argument for the file input applies verbatim and was not applied.

`FormField.astro` gains the prop and uses it:

```diff
 interface Props {
     label: string;
     name: string;
+    /** Disambiguates ids when the same field name appears on one page. */
+    idSuffix?: string;
```

```diff
-const id = `field-${name}`;
+const id = idSuffix ? `field-${name}-${idSuffix}` : `field-${name}`;
```

Then pass `section.index` to all three:

```astro
    <FormField label="Replace image" name="figure" type="file" idSuffix={String(section.index)}
        accept="image/jpeg,image/png,image/webp,image/avif"
        helper="Leave empty to keep the current image." />
```

with a render test asserting two sections produce two different ids.

The `<form>` tag gains `enctype="multipart/form-data"` **unconditionally**, not
only when an image slot is present: it is harmless for a text-only section and a
conditional attribute is one more thing to get wrong per component type.

`href` gets `required` alongside `label` — the schema marks both required, and
without it an admin can clear the link and get a server 400 instead of the
browser's own message.

Add CSS for `.psec__cta`, `.psec__image`, `.psec__image-label` and
`.psec__image-preview`; the preview needs `max-width: 200px; height: auto;` or a
placeholder renders at natural size in a 720px column.

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

and pass `figureId` through to `savePageSection`.

**Upload AFTER the payload check, not before** — `event.ts` validates first for a
reason: an upload that succeeds and is then abandoned leaves an orphaned file in
the media library.

The route already appends `&message=…`, and `page.astro` never reads it, so
plan 1's actual reason — "that file is not an image", "that file is too large" —
is discarded. Read it, as the screen already does for `why`:

```ts
    upload: message || "That image couldn't be uploaded. Please try another file.",
```

with `const message = sp.get("message");` beside the existing `why`. Add a
walkthrough row for a rejected upload, or nothing exercises this path.

- [ ] **Step 6: Write the failing render test**

The existing file defines a `section(over)` **factory**, not a `base` object —
use it, or the whole file fails to collect and takes plan 5's 8 tests with it.
Add these to `tests/unit/page-section-render.test.ts`; it is **not** a new file:

```ts
describe("PageSectionForm — buttons and image", () => {
    const withCta = section({
        ctas: [{ slot: "primaryCta", label: "Learn More", href: "/about" }],
    });

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
        const html = await render({ section: section({ ctas: [] }) });
        expect(html).not.toContain("cta.");
        // Astro serialises an empty-string attribute BARE — `value` with no
        // `=""`. Asserting on `value=""` matches no implementation at all.
        expect(html).toMatch(/name="ctaSlots"[^>]*value(\s|>)/);
    });

    it("shows the current image, through mediaUrl, and a replace field", async () => {
        // Strapi's local provider stores a RELATIVE url; rendered from the Astro
        // origin it 404s. Every public renderer goes through mediaUrl(); this
        // must too, or the preview is a broken image on every chapter.
        const html = await render({ section: section({
            image: { slot: "figure", url: "/uploads/placeholder.png" } }) });
        // NOT a hardcoded origin: mediaUrl reads STRAPI_URL, so asserting
        // "http://localhost:1337/…" turns a dev pointed at staging red for
        // reasons unrelated to the code. Verified: STRAPI_URL=https://…
        // fails that assertion.
        expect(html).toContain(mediaUrl({ url: "/uploads/placeholder.png" }));
        expect(html).not.toContain('src="/uploads/');
        expect(html).toContain('type="file"');
        expect(html).toContain("multipart/form-data");
    });

    it("renders NO image field for a section without one", async () => {
        const html = await render({ section: section({ image: null }) });
        expect(html).not.toContain('type="file"');
    });

    it("posts as multipart even when the section has no image", async () => {
        // Unconditional by design — a conditional enctype is one more thing to
        // get wrong per component type. Mutating it to be conditional survived
        // the first draft's tests, because the only enctype assertion rendered
        // a section that HAD an image.
        const html = await render({ section: section({ image: null }) });
        expect(html).toContain("multipart/form-data");
    });

    it("marks both button fields required, as the schema does", async () => {
        // label and href are both required:true on shared.cta. Dropping either
        // survived the first draft's tests.
        const html = await render({ section: withCta });
        const label = html.slice(html.indexOf('name="cta.primaryCta.label"') - 200,
                                 html.indexOf('name="cta.primaryCta.label"') + 200);
        const href = html.slice(html.indexOf('name="cta.primaryCta.href"') - 200,
                                html.indexOf('name="cta.primaryCta.href"') + 200);
        expect(label).toContain("required");
        expect(href).toContain("required");
    });

    it("gives every field an id unique to its section", async () => {
        // Promised by Step 4 and never written; both idSuffix mutations
        // survived because of it. `CTA_SLOTS` and `MEDIA_SLOTS` each cover
        // hero AND section, so without this two cards share `field-figure`
        // and `field-cta.primaryCta.label`, and a label focuses the wrong card.
        const a = await render({ section: section({ index: 0,
            ctas: [{ slot: "primaryCta", label: "A", href: "/a" }],
            image: { slot: "figure", url: "/uploads/x.png" } }) });
        const b = await render({ section: section({ index: 2,
            ctas: [{ slot: "primaryCta", label: "B", href: "/b" }],
            image: { slot: "figure", url: "/uploads/y.png" } }) });
        const ids = (h: string) => [...h.matchAll(/id="(field-[^"]+)"/g)].map((m) => m[1]);
        expect(ids(a).length).toBeGreaterThan(2);
        expect(ids(a).some((i) => ids(b).includes(i))).toBe(false);
    });

    it("does not say 'nothing to edit' above a working Save button", async () => {
        // The canEdit relaxation's only observable effect if half-applied.
        const html = await render({ section: section({
            editable: [], readOnlyReason: "not-editable",
            ctas: [{ slot: "primaryCta", label: "A", href: "/a" }] }) });
        expect(html).toContain("Save Section");
        expect(html).not.toContain("nothing to edit");
    });

    it("names a lone secondary button plainly, not 'Second button'", async () => {
        // aloha's Text Section carries its ONLY cta in the secondaryCta slot,
        // so a naive `slot === 'secondaryCta' ? 'Second button'` heads that
        // card with "Second button" and no first. Label by position among the
        // rendered slots, not by slot name.
        const html = await render({ section: section({
            ctas: [{ slot: "secondaryCta", label: "View Benefits", href: "/membership" }] }) });
        expect(html).not.toContain("Second button");
    });

    it("survives a section whose ctas and image are absent entirely", async () => {
        // Plan 5's own fixture has neither, and an API one deploy behind sends
        // neither. The component must read them defensively or it throws
        // `Cannot read properties of undefined (reading 'map')` and takes plan
        // 5's eight tests down with it — verified.
        const html = await render({ section: section() });
        expect(html).toContain("<form");
    });
});
```

- [ ] **Step 7: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: 0 errors, then **111 passed** (90 + 4 client + 6 payload + 11 render). Task 7 takes it to **131**.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && git add -A src/ tests/ && \
  git commit -m "feat: edit the page's buttons and hero image"
```

---

### Task 7: External CTAs get a rel guard

**Files:** Modify `src/components/{Hero,Section,Events,NewMembers,Spotlight,Partnership}.astro`; create `tests/unit/cta-link-safety.test.ts`

**Six renderers, not two.** `CTA_SLOTS` makes `link` editable on
`upcoming-events`, `member-group`, `news-and-resources` and `partner-callout`
as well as the two `primaryCta`/`secondaryCta` types — and all four render a
bare `<a href={cta.href}>`:

| Component | Renderer | Line | Reachable by a chapter admin? |
|---|---|---|---|
| hero | `Hero.astro` | 48, 56 | ✅ |
| section | `Section.astro` | 54, 62 | ✅ |
| upcoming-events | `Events.astro` | 76 | ✅ |
| member-group | `NewMembers.astro` | 67 | ✅ |
| news-and-resources | `Spotlight.astro` | 66 | ✅ |
| partner-callout | *(none)* | — | ❌ **no renderer at all** |

Patching two of five reachable renderers leaves an admin who points the Upcoming
Events button at `https://evil.example` with exactly the unguarded
`window.opener` this task exists to close.

**`shared.partner-callout` is a false entry and must come out of `CTA_SLOTS`.**
`PageBody.astro:46` dispatches `shared.partner-group` → `Partnership.astro`;
`partner-callout` falls through to `default: return null` and renders nothing.
`toPartnershipProps` never forwards a `cta` either, so `Partnership`'s anchor is
permanently its hardcoded `/partners` default. Verified: **zero
`shared.partner-callout` rows exist in any zone.** Offering an editable button on
a component that appears on no page is a screen that lies; remove the entry, and
note it in Known limitations.

Chunk 1 normalises an off-site href to absolute **so the renderer can tell it is
off-site**. Verified: it cannot. `Hero.astro:46-53` and `Section.astro` render

```astro
<a href={primaryCta.href} class="hero__btn hero__btn--primary">{primaryCta.label}</a>
```

with **no `rel`, no `target`, no protocol inspection**. Repo-wide, `noopener`
appears only in `RichTextInline` (a different data path that never sees a
`shared.cta`), `events/[slug].astro`, and two "view current image" links. Without
this task the absolutising in Chunk 1 buys nothing at render time, and the
Done-when criterion built on it is false.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import Hero from "../../src/components/Hero.astro";
import Section from "../../src/components/Section.astro";
import Events from "../../src/components/Events.astro";
import NewMembers from "../../src/components/NewMembers.astro";
import Spotlight from "../../src/components/Spotlight.astro";

const container = await AstroContainer.create();
const cta = (href: string) => ({ label: "Go", href });

/**
 * One entry per renderer a chapter-settable CTA can actually reach.
 *
 * THE PROP NAMES ARE NOT GUESSES — they come from each component's own `Props`
 * interface. An earlier draft passed `{heading, events, link}` to `Events`,
 * which takes `{heading?, items?, cta?}`; Astro silently ignored the unknown
 * keys, `cta` fell back to its default `{label:"View All Events", href:"#"}`,
 * and the test href never reached the anchor. Four of the seven cases were
 * measured failing, and — worse — their "leaves an in-site button alone" twins
 * PASSED IDENTICALLY with the fix deleted from all four components. A negative
 * assertion over a default href tests nothing.
 *
 * `Partnership` is deliberately absent. `PageBody` dispatches
 * `shared.partner-group` to it, not `shared.partner-callout`, and
 * `toPartnershipProps` never forwards a `cta` — so its anchor is permanently
 * the hardcoded default and no chapter admin can reach it. See Task 2's note.
 */
const CASES: [string, (href: string) => Promise<string>][] = [
    ["Hero primary",   (h) => container.renderToString(Hero, { props: { heading: "H", primaryCta: cta(h), secondaryCta: null } })],
    ["Hero secondary", (h) => container.renderToString(Hero, { props: { heading: "H", primaryCta: null, secondaryCta: cta(h) } })],
    ["Section",        (h) => container.renderToString(Section, { props: { heading: "H", primaryCta: cta(h), secondaryCta: null } })],
    ["Events",         (h) => container.renderToString(Events, { props: { heading: "E", items: [], cta: cta(h) } })],
    ["NewMembers",     (h) => container.renderToString(NewMembers, { props: { heading: "M", items: [], cta: cta(h) } })],
    ["Spotlight",      (h) => container.renderToString(Spotlight, { props: { heading: "S", items: [], cta: cta(h) } })],
];

describe("CTA link safety", () => {
    for (const [name, render] of CASES) {
        it(`${name}: renders the href it was given`, async () => {
            // THE ANTI-VACUITY CHECK, and it must come first. Without it a
            // component that ignores the props still passes both assertions
            // below, because its default href is in-site.
            expect(await render("/sentinel-path")).toContain('href="/sentinel-path"');
        });

        it(`${name}: opens an off-site button in a new tab, with a rel guard`, async () => {
            const html = await render("https://evil.example/x");
            expect(html).toContain('href="https://evil.example/x"');
            expect(html).toContain('rel="noopener noreferrer"');
            expect(html).toContain('target="_blank"');
        });

        it(`${name}: leaves an in-site button alone`, async () => {
            const html = await render("/events");
            expect(html).toContain('href="/events"');      // reached the anchor
            expect(html).not.toContain("noopener");
            expect(html).not.toContain('target="_blank"');
        });
    }

    it("treats a fragment and a mailto as in-site", async () => {
        for (const href of ["#contact", "mailto:hi@areaa.org"]) {
            const html = await CASES[0][1](href);
            expect(html, href).not.toContain('target="_blank"');
        }
    });

    it("requires the // — a bare scheme is not an absolute url", async () => {
        // `/^https?:/i` without the slashes matches `https:foo`, a relative
        // path in some parsers. Mutating the regex that way survived.
        expect(await CASES[0][1]("/https:not-a-scheme")).not.toContain('target="_blank"');
        expect(await CASES[0][1]("HTTPS://evil.example/x")).toContain('target="_blank"');
        expect(await CASES[0][1]("//evil.example/x")).not.toContain('target="_blank"');
    });
});
```

`Hero`'s props default `primaryCta`/`secondaryCta` to `{href: "#"}`, so pass
`null` explicitly for the one under test — that is what `toCta()` returns in
production, and without it the assertion partly tests a default.

- [ ] **Step 2: Implement**

Reuse the shape `RichTextInline` already uses, so they agree. Put it in **one
place** — `src/lib/links.ts` — rather than copying it into six components:

```ts
/** Off-site, and therefore worth a rel guard. Matches RichTextInline's rule. */
export const isExternal = (url?: string | null) => !!url && /^https?:\/\//i.test(url);

/** Spread onto an anchor. */
export const linkGuard = (url?: string | null) =>
    isExternal(url) ? { target: "_blank", rel: "noopener noreferrer" } : {};
```

Import it into all six components and spread `{...linkGuard(cta.href)}` onto
**every** CTA anchor — including `secondaryCta`, which is the one a mutation
proved untested. Update `RichTextInline` to import it too, so the sixth copy of
the regex does not become a seventh.

**This is why Chunk 1 absolutises.** A stored `//evil.example/x` does not match
that regex; `https://evil.example/x` does. Normalising is what makes the
inference correct.

- [ ] **Step 3: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/cta-link-safety.test.ts
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **20 tests** — the 6-renderer loop yields 18 (3 each, the first proving the href reaches the anchor), plus 2 standalone. 0 errors.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/links.ts \
          src/components/Hero.astro src/components/Section.astro \
          src/components/Events.astro src/components/NewMembers.astro \
          src/components/Spotlight.astro src/components/RichTextInline.astro \
          tests/unit/cta-link-safety.test.ts && \
  git commit -m "fix: external CTAs open in a new tab with a rel guard"
```

All seven files, not two — the earlier list was left over from the
two-renderer draft and would have committed components importing an untracked
`links.ts`, red on a clean checkout.

---

## Chunk 5: Verification

### Task 8: Both suites, twice, with no drift

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **277 CMS**, **131 frontend**, 0 typecheck errors, `pages_cmps`
byte-identical across two CMS runs, and the extended copy snapshot unchanged.

### Task 9: Prove it in a browser

Snapshot first, with a scripted restore ready **before** the servers start.

**Use the Text Section for rows 2–6, not the Header.** aloha's draft and
published *hero* differ today (`Chorp Chipper` / `Our Chapter`), so plan 5's
parity gate nulls the published write and the hero reports `wrote: 1` — an
earlier draft of this walkthrough expected "Section saved." on the hero in row 2
and "Saved to your draft…" on the same card in row 9, which cannot both hold.
Row 9 exercises the hero deliberately; everything else uses a section whose two
statuses agree.

| # | Action | Expected |
|---|---|---|
| 1 | `/page`, the Text Section card | Heading, Body Text, **Button text** "View Membership Benefits", **Button links to** `/membership` |
| 2 | Change it to "Join AREAA Hawaii" → `/chapters/aloha-hawaii` → Save | "Section saved." |
| 3 | **Visit the microsite** | The section button says the new text and goes to the chapter page — **the thing this plan exists for** |
| 4 | Upload a real image on the **Header** card → Save | Preview updates and the microsite hero shows it. **Expect "Saved. Part of this section is live now; the rest is waiting…"** — the image and the buttons reach the live page, the diverged text does not. The Text Section has no image relation, which is why this one row uses the Header. |
| 5 | Set a button link to `javascript:alert(1)` | Refused, and the screen shows **"That link is not a valid web address"** — not "reload and try again" |
| 6 | Set a button link to `//evil.example` | Stored as `https://evil.example/`; the rendered link carries `target="_blank"` and `rel="noopener noreferrer"` (Task 7) |
| 7 | Gallery card | Heading only — no button, no image field |
| 8 | Upload a `.txt` renamed to `.png` | Refused with plan 1's reason, shown on screen |
| 9 | Disable JavaScript, repeat 2 and 4 | Both work — a file input needs no JS either |
| 10 | Edit the **Header**'s button text and its heading together | **"Saved. Part of this section is live now…"** — the button writes at both statuses (its two rows are identical), the heading does not (they diverge). A single "saved to your draft" here would be a lie about the button. |
| 11 | As `twochapter@areaa.test`, chapter B's page | B's own buttons, not A's |

Restore, verify against the snapshot, then stop the servers.

**The restore must also unwind the uploads.** Rows 4 and 9 create `files` rows,
`files_folder_lnk` rows and bytes under `public/uploads`; pointing `figure` back
at file 12 leaves all of that behind, and the snapshot diff reports clean while
the media library has grown. Record the high-water mark **before starting**:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  set MAXID (sqlite3 .tmp/data.db "SELECT MAX(id) FROM files;") && echo "MAXID=$MAXID"
```

(fish syntax — `$MAXID` unset expands to nothing and the `WHERE` below becomes a
syntax error rather than deleting everything, but capture it properly.)

Then, **after** the figure has been pointed back at its original file and
**before** `pkill` — in that order, or the hero loses its image with nothing to
restore it from:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT url FROM files WHERE id > $MAXID; \
                        SELECT formats FROM files WHERE id > $MAXID;" && \
  sqlite3 .tmp/data.db "DELETE FROM files_related_mph WHERE file_id > $MAXID; \
                        DELETE FROM files_folder_lnk WHERE file_id > $MAXID; \
                        DELETE FROM files WHERE id > $MAXID;"
```

`rm` every printed path under `public/` — **including the ones inside
`formats`**. A real upload generates `thumbnail_…` and `small_…` derivatives
whose urls live only in that JSON column; selecting `url` alone leaves them on
disk. Verified against the seed: file 1 carries two.

---

## Done when

- **277 CMS and 131 frontend tests green**, CMS twice, `pages_cmps` byte-identical.
- A chapter admin changes a button's text and link, **with JavaScript disabled**, and the public microsite shows it.
- A chapter admin replaces the hero placeholder with a real image, and the microsite shows it.
- The **button** is written at draft and published under plan 5's content-parity gate. The **image** is written at both unconditionally — media rows are not draft/published, so there is nothing to diverge (Task 4 Step 3 says so; this criterion used to contradict it).
- `javascript:` is refused and **the reason reaches the screen** — not "reload and try again".
- `//evil.example` is stored absolute, **and all five reachable CTA renderers** — Hero (both slots), Section, Events, NewMembers, Spotlight — render an off-site CTA with `target="_blank"` and `rel="noopener noreferrer"` (Task 7). Neither half is worth much without the other, and each renderer is proved to receive the href before the guard is asserted.
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
- **The external-link inference is one regex in `src/lib/links.ts`**, imported by the five reachable CTA renderers and by `RichTextInline`. A sixth renderer gets it by importing, not by copying — but nothing *enforces* the import, so a new component with a bare `<a href>` would silently miss it.
- **`shared.partner-callout` has a `link` in its schema and no renderer at all.** `PageBody` dispatches `partner-group` to `Partnership.astro` and lets `partner-callout` fall through to null; zero rows exist in any zone. It is excluded from `CTA_SLOTS` for that reason, so a chapter admin cannot edit a button nobody can see. If a renderer is ever added, the slot map and `CMPS_TABLE` both need an entry.
- **`Partnership.astro`'s own button is not chapter-editable.** `toPartnershipProps` never forwards a `cta`, so it renders its hardcoded `/partners` default. Out of scope here, but it means one visible button on the microsite is still national-only.
