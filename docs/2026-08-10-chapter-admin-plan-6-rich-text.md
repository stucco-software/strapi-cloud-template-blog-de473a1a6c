# Plan 6: Real rich text — TipTap, a bidirectional converter, and the sanitiser it requires

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text placeholder converter with a real bidirectional one, so a chapter admin can write headings, lists, links, quotes and emphasis — and so the content national already authored in Strapi's block editor stops being read-only to them.

**Architecture:** The textarea stays. It is what the server renders, it is what posts without JavaScript, and it remains the fallback forever. A progressive-enhancement script mounts TipTap over it, writes the document into a hidden field, and **creates** a presence marker — the same `__present` shape `MultiSelect` already uses twice, deliberately created in JS rather than server-rendered so a browser cannot restore a stale one.

It claims the rich payload **only after verifying a round trip**, because ProseMirror silently discards an entire document when it meets a node or mark its schema does not know. The server accepts **both** shapes and **sanitises every blocks value on every write**, because the rich payload is client-supplied JSON and the public renderer puts `node.url` straight into an `href`.

**Tech Stack:** `@tiptap/core` + `@tiptap/starter-kit` + `@tiptap/extension-link` used **vanilla** (no framework integration), Strapi 5.45.1, Astro 6.4.2, Vitest.

---

## Why this is worth doing now

Three things changed since "TipTap, plan 6" was first written down as a one-liner.

**Plan 5 turned a cosmetic limitation into a functional one.** `blocksToPlainText` is lossy by design, so plan 5 gates body editing on a plain-blocks check: a section whose body carries any formatting renders **read-only**. That is correct — the alternative is silently stripping a national author's work — but it means an admin with one bold word cannot fix a typo in that paragraph. Plan 5's own known limitations say this "will be reported as a bug."

**There are now two independent copies of the converter.** `src/lib/blocks.ts` in the frontend and `textToBlocks`/`blocksToText` in the CMS's `page-content.js`. Nothing asserts they agree. A body saved through `/page` and one saved through the news form can diverge.

**The public renderer already supports far more than the editor can produce.** `RichText.astro` and `RichTextInline.astro` render headings, ordered and nested unordered lists, quotes, code blocks, images, inline links and five marks. All of that is reachable by national through Strapi's admin panel and unreachable by chapter admins through ours. The renderer is not the gap; the editor is.

---

## The thing this plan must not get wrong

**Today a chapter admin cannot produce a link node.** `textToBlocks` emits paragraphs of plain text and nothing else, so no chapter-admin write path can put a `url` anywhere.

`RichTextInline.astro:25` renders `href={node.url ?? "#"}` with **no sanitisation anywhere in either repo** — verified by grep. Astro escapes the attribute value; it does not block the scheme. The moment this plan lets a chapter admin insert a link, `javascript:` and `data:` URLs become stored XSS on a public microsite.

So the sanitiser is not a nice-to-have bolted on at the end. It is Chunk 1, it runs on the **server** on **every** blocks write, and it is the reason this plan is ordered the way it is. A version of this plan that adds the editor first and sanitises later is a version that ships an XSS.

---

## Scope

**In:**

- A single shared blocks vocabulary and **sanitiser**, server-side, applied to every chapter-admin write of a blocks field: `event.description`, `news-item.body`, and the three `/page` bodies.
- Link URL scheme whitelisting.
- One `RichTextField.astro` replacing the three bare textareas, rendering the textarea baseline plus the hidden rich payload and its format marker.
- A vanilla TipTap enhancement script, loaded only on the authoring screens.
- Retiring plan 5's rich-body lock, because the editor can now round-trip what the lock existed to protect.
- **Pinning** the two converter copies together with a test. (Not collapsing them — they live in different runtimes across a CJS/ESM boundary, and Task 3 Step 1 keeps both files. The first draft's scope line said "collapsing", which contradicted its own task.)

**Not in:**

- **Images inside rich text.** `RichText.astro` renders an `image` block, but inserting one needs the upload flow, a media picker and alt-text capture. The sanitiser **preserves** existing image blocks so national's work survives a chapter admin's edit; the editor does not offer to add them.
- **Tables, footnotes, embeds.** Not in the renderer, so not in the vocabulary.
- **Heading level 1.** `RichText.astro` clamps headings to `h2`–`h4`; the page already has one `h1`. The editor offers 2–4.
- **A national/admin-panel editor.** Strapi's own block editor is unchanged.
- **Collaborative editing, comments, version history.**
- **`FAQ.answer` and `FAQItem.answer`.** They are blocks fields with no chapter-admin screen at all. Whenever one arrives it uses this field component.

---

## Preconditions

**1. Branch.** Trunk-based; commit to `main` in both repos.

**2. Baselines, measured immediately before writing this plan.**

| | Tests | Files |
|---|---|---|
| `areaa-cms` | **235** | 17 |
| `areaa-frontend` | **90** | 12 |

`api::chapter-admin%` permissions: **25**. This plan adds **no routes and no grants** — it changes what existing routes accept.

**3. Plan 7 is independent; plan 5 is a hard prerequisite.** This plan retires a guard plan 5 introduced and reuses its `page-content.js`. Do not execute it against a tree without plan 5. If plan 7 has landed, add its **+42 CMS / +25 frontend** to every number below.

**4. Every CMS command needs `cd /Users/nk/Projects/AREAA/areaa-cms`** and every frontend command `cd /Users/nk/Projects/AREAA/areaa-frontend`.

**5. `PATH="/opt/homebrew/bin:$PATH"`** on CMS test and boot commands.

**6. This plan installs dependencies.** `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-link` in the **frontend only**. Commit the lockfile.

**7. `.tmp/data.db` is untracked**, and Chunk 3's walkthrough edits live copy. Snapshot as plan 5 did.

---

## Verified assumptions

Executed against the installed Strapi 5.45.1, the seeded database, and both repos on 2026-08-10.

| Assumption | Verdict |
|---|---|
| `RichTextInline.astro:25` renders `href={node.url ?? "#"}` | ✅ Verified verbatim |
| **No URL sanitisation exists in either repo** | ✅ `grep` for `javascript:`, `sanitiz`, `sanitis`, `isSafeUrl`, `allowedProtocol` returns nothing |
| A chapter admin **cannot** produce a link node today | ✅ `textToBlocks` emits only `{type:'paragraph', children:[{type:'text', text}]}`. This plan is what opens it. |
| `RichText.astro` renders paragraph, heading, list (ordered/unordered, nested), quote, code, image; default → paragraph | ✅ Read in full |
| It clamps headings to **h2–h4** | ✅ `Math.min(Math.max(level || 2, 2), 4)` |
| `RichTextInline` renders link + bold/italic/underline/strikethrough/code, nesting marks outward | ✅ `code → s → u → em → strong` |
| It splits `\n` inside a text leaf into `<br>` | ✅ Strapi stores soft breaks that way; TipTap uses `hardBreak` **nodes**, so this is a real mapping mismatch the converter must handle |
| Links may contain their own marked children | ✅ `RichTextInline` recurses into `node.children` for links |
| **No framework integration is installed** | ✅ Dependencies are `@astrojs/check`, `@astrojs/node`, `@astrojs/sitemap`, `@types/qs`, `astro`, `qs`, `sirv`, `typescript`, `vitest`. No React/Vue/Svelte/Solid — so TipTap must be used vanilla via `@tiptap/core`, not `@tiptap/react`. |
| Zero `<script>` tags in the chapter-admin **form components** | ⚠️ True of EventForm, NewsForm, CommitteeForm, MultiSelect, PageSectionForm and FormField — all six checked. **But the first draft's stronger claim, "zero in the entire chapter-admin UI … this plan introduces the first", is false.** Every admin page renders `ChapterAdminLayout → MainLayout → Header.astro`, which has a `<script>` for the dropdown and mobile nav; `MediaLibrary`, `join.astro` and `ContactForm` have more. Client JS already ships on these pages and Astro's bundling is not new territory. The no-JS baseline is still worth keeping — every *form* works without it, and that is the property under test — but the premise was overstated. |
| Blocks fields in the CMS: `Hero.body`, `Section.body`, `PartnerCallout.body`, `NewsItem.body`, `Event.description`, `FAQ.answer`, `FAQItem.answer` | ✅ Seven; the first five are reachable from chapter-admin screens, the FAQ two are not |
| Events and news already POST **blocks JSON** from the frontend | ✅ `event-form.ts:79` and `news-form.ts:43` call `textToBlocks` client-side; `/page` posts plain text and converts server-side in `page-content.js:165`. **The two surfaces are asymmetric today** and this plan unifies them. |
| `chapterScopedResource` has a `validateData` hook that may normalise `data` in place, on create AND update | ✅ Documented in the factory; this is the insertion point for the sanitiser on events and news |
| Only **2 of 42** blocks values in the database are richer than plain paragraphs | ✅ `components_shared_sections` ids 4 and 5, `bold` marks only. **No links, no headings, no lists, no images anywhere in the seed** — so the sanitiser's interesting paths are unreachable from real data and every one needs a constructed fixture. |
| Neither rich row is on a page | ✅ Zone sections are 112–123 |
| Plan 5's `isPlainBlocks` currently gates `/page` body editing | ✅ `chapter-admin.js:343` — this plan retires that branch |

---

## Chunk 1: The vocabulary and the sanitiser

Server-side, pure, and first — before anything can produce rich content.

### Task 1: `sanitiseBlocks`

**Files:** Create `src/api/chapter-admin/services/blocks.js`, `tests/unit/blocks-sanitise.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sanitiseBlocks, normaliseUrl, isSafeUrl, ALLOWED_BLOCKS, ALLOWED_MARKS, MAX_BLOCKS,
} = require('../../src/api/chapter-admin/services/blocks.js');

const para = (...children) => ({ type: 'paragraph', children });
const text = (t, marks = {}) => ({ type: 'text', text: t, ...marks });

describe('normaliseUrl', () => {
  // Returns a NORMALISED url, or null. Normalising is the point, not decoration:
  // a validator that only says yes/no leaves `\\evil.example/x` in the database,
  // where RichTextInline's `isExternal` (/^https?:\/\//i) does not match it — so
  // it renders as an in-site link with NO rel="noopener" and no target, pointing
  // at an attacker. The first draft of this plan accepted and stored that exact
  // string; review found it by resolving it against a real URL parser.
  it('keeps a safe absolute url, normalised', () => {
    expect(normaliseUrl('https://x.example/a?b=1')).toBe('https://x.example/a?b=1');
    expect(normaliseUrl('http://x.example')).toBe('http://x.example/');
  });

  it('keeps mailto and tel', () => {
    expect(normaliseUrl('mailto:hi@areaa.org')).toBe('mailto:hi@areaa.org');
    expect(normaliseUrl('tel:+18005551234')).toBe('tel:+18005551234');
  });

  it('keeps a site-relative link relative', () => {
    // Absolutising these would point every internal link at the parsing base.
    expect(normaliseUrl('/chapters/boston')).toBe('/chapters/boston');
    expect(normaliseUrl('/events/x#top')).toBe('/events/x#top');
    expect(normaliseUrl('#section')).toBe('#section');
  });

  it('REJECTS javascript:, in every disguise', () => {
    // Verified empirically against Astro: RichTextInline emits
    // <a href="javascript:alert(1)"> verbatim. Astro escapes the VALUE — it
    // does not touch the SCHEME.
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)',
                     '  javascript:alert(1)', 'java\tscript:alert(1)',
                     'java\nscript:alert(1)', 'java\u0000script:alert(1)']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('REJECTS data:, vbscript:, blob:, file: and about:', () => {
    for (const u of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)',
                     'blob:https://x.example/abc', 'file:///etc/passwd', 'about:blank']) {
      expect(normaliseUrl(u), u).toBeNull();
    }
  });

  it('ABSOLUTISES anything that leaves the site, so the renderer can see it', () => {
    // The bypass. WHATWG canonicalises \ to / for special schemes, so all four
    // resolve off-site; storing them verbatim hides that from `isExternal`.
    for (const u of ['//evil.example/x', '\\evil.example/x',
                     '/\\evil.example/x', '\\/evil.example/x']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBe('https://evil.example/x');
    }
  });

  it('REJECTS userinfo, which makes a hostile host look trusted', () => {
    // The visible href begins with areaa.org and navigates to evil.example.
    expect(normaliseUrl('https://areaa.org@evil.example/')).toBeNull();
    expect(normaliseUrl('https://user:pw@evil.example/')).toBeNull();
  });

  it('rejects empty, blank, non-string, unparseable and absurdly long values', () => {
    for (const u of ['', '   ', null, undefined, 42, {},
                     'https://x.example/' + 'a'.repeat(5000)]) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });
});

describe('sanitiseBlocks', () => {
  it('passes plain paragraphs through unchanged', () => {
    const input = [para(text('One')), para(text('Two'))];
    expect(sanitiseBlocks(input)).toEqual(input);
  });

  it('keeps every mark the renderer supports', () => {
    const input = [para(text('x', { bold: true, italic: true, underline: true,
                                    strikethrough: true, code: true }))];
    expect(sanitiseBlocks(input)).toEqual(input);
  });

  it('DROPS a mark the renderer does not support', () => {
    // An unknown key would ride along into the stored JSON and mean nothing —
    // or worse, mean something to a future renderer.
    const out = sanitiseBlocks([para(text('x', { bold: true, highlight: true }))]);
    expect(out[0].children[0]).toEqual({ type: 'text', text: 'x', bold: true });
  });

  it('coerces a truthy mark to a real boolean', () => {
    const out = sanitiseBlocks([para({ type: 'text', text: 'x', bold: 'yes' })]);
    expect(out[0].children[0].bold).toBe(true);
  });

  it('keeps headings, clamped to the levels the renderer emits', () => {
    // RichText.astro clamps to h2-h4; storing level 1 or 6 would render as
    // something other than what the editor showed.
    const out = sanitiseBlocks([
      { type: 'heading', level: 1, children: [text('A')] },
      { type: 'heading', level: 3, children: [text('B')] },
      { type: 'heading', level: 9, children: [text('C')] },
    ]);
    expect(out.map((b) => b.level)).toEqual([2, 3, 4]);
  });

  it('keeps ordered and unordered lists, including nesting', () => {
    const input = [{
      type: 'list', format: 'unordered', children: [
        { type: 'list-item', children: [text('One')] },
        { type: 'list-item', children: [
          text('Two'),
          { type: 'list', format: 'ordered', children: [
            { type: 'list-item', children: [text('Nested')] },
          ]},
        ]},
      ],
    }];
    expect(sanitiseBlocks(input)).toEqual(input);
  });

  it('defaults an unknown list format rather than dropping the list', () => {
    const out = sanitiseBlocks([{ type: 'list', format: 'spiral',
      children: [{ type: 'list-item', children: [text('x')] }] }]);
    expect(out[0].format).toBe('unordered');
  });

  it('keeps quotes and code blocks', () => {
    const input = [
      { type: 'quote', children: [text('Quoted')] },
      { type: 'code', children: [text('const x = 1;')] },
    ];
    expect(sanitiseBlocks(input)).toEqual(input);
  });

  it('PRESERVES an image block it cannot author', () => {
    // National inserts images through Strapi's editor. A chapter admin editing
    // the surrounding prose must not delete them.
    const img = { type: 'image', image: { url: '/uploads/x.png', alternativeText: 'X' },
                  children: [text('')] };
    expect(sanitiseBlocks([img, para(text('after'))])[0]).toEqual(img);
  });

  it('WHITELISTS the image object rather than passing it through', () => {
    // The first draft returned `{ type: 'image', image: block.image }` — the
    // entire client-supplied object. mediaUrl() puts anything starting with
    // "http" straight into <img src>, so a chapter admin could POST a tracking
    // pixel on a public microsite, plus arbitrary extra keys.
    const out = sanitiseBlocks([{ type: 'image', image: {
      url: '/uploads/x.png', alternativeText: 'X', width: 10, height: 20,
      onerror: 'alert(1)', nested: { a: 1 },
    }}]);
    expect(Object.keys(out[0].image).sort())
      .toEqual(['alternativeText', 'height', 'url', 'width']);
  });

  it('DROPS an image whose url is not safe', () => {
    for (const url of ['javascript:alert(1)', 'https://evil.example/track.gif']) {
      expect(sanitiseBlocks([{ type: 'image', image: { url } }])).toEqual([]);
    }
  });

  it('keeps an image served from the CMS', () => {
    expect(sanitiseBlocks([{ type: 'image', image: { url: '/uploads/ok.png' } }]))
      .toHaveLength(1);
  });

  it('DROPS a block type the renderer does not handle', () => {
    const out = sanitiseBlocks([{ type: 'table', children: [] }, para(text('kept'))]);
    expect(out).toEqual([para(text('kept'))]);
  });

  it('DROPS a bare list-item at the root', () => {
    // ALLOWED_BLOCKS is a flat set; the grammar is nested. Without a position
    // check a root-level list-item stores and RichText.astro renders it as a
    // stray <li> outside any list.
    expect(sanitiseBlocks([{ type: 'list-item', children: [text('orphan')] },
                           para(text('kept'))])).toEqual([para(text('kept'))]);
  });

  it('DROPS a non-list-item child of a list', () => {
    // RichText.astro renders EVERY child of a list as an <li>, whatever its
    // type — so the renderer would not catch this. Verified: `paragraph`,
    // `heading` and even `banana` all render as <li>.
    const out = sanitiseBlocks([{ type: 'list', format: 'unordered', children: [
      { type: 'list-item', children: [text('real')] },
      { type: 'heading', level: 2, children: [text('smuggled')] },
    ]}]);
    expect(out[0].children).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain('smuggled');
  });

  it('keeps a safe link, with its own marked children', () => {
    const input = [para({ type: 'link', url: 'https://areaa.org',
      children: [text('AREAA', { bold: true })] })];
    expect(sanitiseBlocks(input)).toEqual(input);
  });

  it('UNWRAPS an unsafe link to its text, rather than dropping the words', () => {
    // Deleting the text would silently lose what the author wrote. Keeping the
    // href would ship stored XSS. Unwrapping keeps the prose and kills the URL.
    const out = sanitiseBlocks([para(
      text('Click '),
      { type: 'link', url: 'javascript:alert(1)', children: [text('here')] },
      text(' now'))]);
    expect(out).toEqual([para(text('Click '), text('here'), text(' now'))]);
  });

  it('strips a link nested inside a link', () => {
    const out = sanitiseBlocks([para({ type: 'link', url: 'https://a.example',
      children: [text('a'), { type: 'link', url: 'https://b.example',
                              children: [text('b')] }] })]);
    expect(JSON.stringify(out)).not.toContain('b.example');
  });

  it('DROPS an empty paragraph entirely', () => {
    // Three reasons, and the first draft got this wrong in a way that bricked
    // a section:
    //  1. RichText.astro already filters them (`hasContent`), so storing one
    //     renders nothing — the vocabulary should match the renderer.
    //  2. TipTap emits a TRAILING empty paragraph by default, so this is the
    //     normal shape of every document the editor produces, not a corner.
    //  3. Plan 5's still-live `isPlainBlocks` returns FALSE for a blank
    //     paragraph. Storing one made every subsequent save to that section
    //     400 with "contains formatting this editor would remove" — verified
    //     live. Chunk 1 ships before Chunk 3 retires that lock, so between the
    //     two commits an empty paragraph permanently locks a section.
    expect(sanitiseBlocks([para(text('')), para(text('kept'))])).toEqual([para(text('kept'))]);
    expect(sanitiseBlocks([para()])).toEqual([]);
    expect(sanitiseBlocks([{ type: 'paragraph' }])).toEqual([]);
  });

  it('keeps an empty LIST ITEM, which is not the same thing', () => {
    // A blank bullet is visible in the rendered list; a blank paragraph is not.
    const out = sanitiseBlocks([{ type: 'list', format: 'unordered', children: [
      { type: 'list-item', children: [] }] }]);
    expect(out[0].children).toHaveLength(1);
  });

  it('returns [] for anything that is not an array of blocks', () => {
    for (const bad of [null, undefined, 'nope', 42, { type: 'paragraph' }]) {
      expect(sanitiseBlocks(bad)).toEqual([]);
    }
  });

  it('survives a deeply nested document without blowing the stack', () => {
    let node = { type: 'list', format: 'unordered',
                 children: [{ type: 'list-item', children: [text('deep')] }] };
    for (let i = 0; i < 200; i += 1) {
      node = { type: 'list', format: 'unordered',
               children: [{ type: 'list-item', children: [node] }] };
    }
    expect(() => sanitiseBlocks([node])).not.toThrow();
  });

  it('truncates nesting beyond MAX_DEPTH, measured against the input', () => {
    // NOT a fixed byte threshold — the first draft asserted < 20000 on a 2635
    // byte input, which passes for the identity function and for deleting
    // MAX_DEPTH entirely. Measure the actual nesting instead.
    const depthOf = (b) => {
      let d = 0, n = b;
      while (n && Array.isArray(n.children) && n.children[0]) { d += 1; n = n.children[0]; }
      return d;
    };
    let node = { type: 'list', format: 'unordered',
                 children: [{ type: 'list-item', children: [text('deep')] }] };
    for (let i = 0; i < 30; i += 1) {
      node = { type: 'list', format: 'unordered',
               children: [{ type: 'list-item', children: [node] }] };
    }
    expect(depthOf(node)).toBeGreaterThan(MAX_DEPTH * 2);      // the input is deep
    expect(depthOf(sanitiseBlocks([node])[0])).toBeLessThanOrEqual(MAX_DEPTH + 1);
  });

  it('caps the number of top-level blocks', () => {
    // MAX_BODY_LEN guards a STRING. Once the payload is an array that guard is
    // meaningless, and a 50 MB blocks document posts and stores.
    const many = Array.from({ length: MAX_BLOCKS + 50 }, (_, i) => para(text(`p${i}`)));
    expect(sanitiseBlocks(many)).toHaveLength(MAX_BLOCKS);
  });

  it('strips any key the vocabulary does not name', () => {
    // Whatever a future TipTap extension adds must not reach the database just
    // because it was in the payload.
    const out = sanitiseBlocks([{ type: 'paragraph', children: [text('x')],
                                  onclick: 'evil()', style: 'x' }]);
    expect(Object.keys(out[0]).sort()).toEqual(['children', 'type']);
  });

  it('ignores a __proto__ key arriving through JSON', () => {
    // `__proto__: {}` in an object LITERAL sets [[Prototype]], not an own
    // property, so the literal form tests nothing — the first draft used it.
    // JSON.parse DOES create an own property, which is the real vector.
    const payload = JSON.parse(
      '[{"type":"paragraph","children":[{"type":"text","text":"x"}],' +
      '"__proto__":{"polluted":true}}]');
    const out = sanitiseBlocks(payload);
    expect(Object.keys(out[0]).sort()).toEqual(['children', 'type']);
    expect({}.polluted).toBeUndefined();
  });

  it('is idempotent', () => {
    const messy = [
      { type: 'heading', level: 1, children: [text('A', { highlight: true })] },
      para({ type: 'link', url: 'javascript:x', children: [text('b')] }),
      { type: 'table', children: [] },
    ];
    const once = sanitiseBlocks(messy);
    expect(sanitiseBlocks(once)).toEqual(once);
  });

  it('names its vocabulary, so the editor and the renderer can be checked against it', () => {
    expect(ALLOWED_BLOCKS).toEqual(
      ['paragraph', 'heading', 'list', 'list-item', 'quote', 'code', 'image']);
    expect(ALLOWED_MARKS).toEqual(
      ['bold', 'italic', 'underline', 'strikethrough', 'code']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/blocks-sanitise.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

/**
 * The blocks vocabulary, and the sanitiser that enforces it.
 *
 * WHY THIS IS THE FIRST TASK IN THIS PLAN.
 *
 * Before this plan, a chapter admin could not produce a link: textToBlocks
 * emitted paragraphs of plain text and nothing else. RichTextInline.astro
 * renders `href={node.url ?? "#"}` with no sanitisation anywhere in either
 * repo — Astro escapes the attribute VALUE, it does not block the SCHEME. So
 * the moment the editor can insert a link, `javascript:` is stored XSS on a
 * public microsite.
 *
 * Every chapter-admin write of a blocks field goes through here. The payload is
 * client-supplied JSON; nothing about it is trusted.
 *
 * The vocabulary is bounded by what RichText.astro / RichTextInline.astro
 * actually render. Anything else is dropped rather than stored, because stored
 * JSON that nothing renders is a trap for whoever writes the next renderer.
 */

const ALLOWED_BLOCKS = ['paragraph', 'heading', 'list', 'list-item', 'quote', 'code', 'image'];
const ALLOWED_MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code'];

/** RichText.astro clamps headings to h2-h4; store what will actually render. */
const MIN_HEADING = 2;
const MAX_HEADING = 4;

/** Deep enough for any real document, shallow enough to bound the output. */
const MAX_DEPTH = 12;

/**
 * Top-level block cap. MAX_BODY_LEN in page-content.js guards a STRING; once
 * the payload is an array that guard is meaningless and a 50 MB document posts.
 */
const MAX_BLOCKS = 500;

const MAX_URL_LEN = 2048;

/** The only image keys the renderer reads, plus what Strapi's node requires. */
const IMAGE_KEYS = ['url', 'alternativeText', 'width', 'height'];

/**
 * The URL, normalised — or null if it must not become an href.
 *
 * USE THE PLATFORM PARSER. The first draft of this plan hand-rolled this and
 * shipped two real bypasses, both found by review and both reproduced against
 * a live endpoint:
 *
 *  - `\\evil.example/x` — WHATWG canonicalises `\` to `/` for special schemes,
 *    so it resolves to `https://evil.example/x`. A hand-rolled `//` check never
 *    sees it. Worse, `RichTextInline`'s `isExternal` (/^https?:\/\//i) does not
 *    match it either, so it rendered as an in-site link with NO
 *    `rel="noopener noreferrer"` — a stored phishing primitive that looks local.
 *  - `https://areaa.org@evil.example/` — userinfo. The visible href starts with
 *    a trusted host and navigates elsewhere.
 *
 * NORMALISING rather than merely validating is what closes the first: anything
 * resolving off-site comes back absolute, so the renderer's external-link
 * handling tells the truth about it.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/** Any absolute origin; it exists only so relative URLs can be parsed. */
const BASE = 'https://base.invalid/';
const BASE_ORIGIN = new URL(BASE).origin;

function normaliseUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw === '' || raw.length > MAX_URL_LEN) return null;

  let parsed;
  try {
    parsed = new URL(raw, BASE);
  } catch {
    return null;
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;
  if (parsed.username !== '' || parsed.password !== '') return null;

  // Same origin as the parsing base => the input was genuinely relative. Keep
  // it relative; absolutising would point every internal link at base.invalid.
  if (parsed.origin === BASE_ORIGIN) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return parsed.href;
}

/** Thin predicate for call sites that only need yes/no. */
const isSafeUrl = (url) => normaliseUrl(url) !== null;

const boolMark = (v) => v === true || v === 'true' || v === 1 || v === 'yes' || v === 'on';

function sanitiseLeaf(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.text !== 'string') return null;

  const out = { type: 'text', text: node.text };
  for (const mark of ALLOWED_MARKS) {
    if (node[mark] !== undefined && boolMark(node[mark])) out[mark] = true;
  }
  return out;
}

/** Inline children: text leaves and links. `inLink` forbids nesting a link. */
function sanitiseInline(children, inLink, depth) {
  const out = [];
  for (const child of Array.isArray(children) ? children : []) {
    if (!child || typeof child !== 'object') continue;

    if (child.type === 'link') {
      // A link inside a link, or an unsafe URL: UNWRAP to the text. Dropping it
      // would silently delete words the author wrote; keeping the href would
      // ship the attack.
      const inner = sanitiseInline(child.children, true, depth + 1);
      const href = normaliseUrl(child.url);
      if (inLink || href === null || depth >= MAX_DEPTH) {
        out.push(...inner);
      } else {
        // The NORMALISED url, never the raw one.
        out.push({ type: 'link', url: href, children: inner });
      }
      continue;
    }

    const leaf = sanitiseLeaf(child);
    // An empty leaf carries nothing; an empty PARAGRAPH is a deliberate blank
    // line and is preserved by the block-level pass.
    if (leaf && leaf.text !== '') out.push(leaf);
  }
  return out;
}

function sanitiseBlock(block, depth) {
  if (!block || typeof block !== 'object') return null;
  if (depth > MAX_DEPTH) return null;
  if (!ALLOWED_BLOCKS.includes(block.type)) return null;

  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(block.level) || MIN_HEADING, MIN_HEADING), MAX_HEADING);
      return { type: 'heading', level, children: sanitiseInline(block.children, false, depth) };
    }
    case 'list': {
      const format = block.format === 'ordered' ? 'ordered' : 'unordered';
      const children = [];
      for (const item of Array.isArray(block.children) ? block.children : []) {
        // Only list-items. RichText.astro renders EVERY child of a list as an
        // <li> regardless of type, so the renderer would not catch a smuggled
        // heading — the grammar has to be enforced here.
        if (!item || item.type !== 'list-item') continue;
        const clean = sanitiseBlock(item, depth + 1);
        if (clean) children.push(clean);
      }
      return { type: 'list', format, children };
    }
    case 'list-item': {
      // A list item mixes inline content with nested lists.
      const children = [];
      for (const child of Array.isArray(block.children) ? block.children : []) {
        if (child && child.type === 'list') {
          const nested = sanitiseBlock(child, depth + 1);
          if (nested) children.push(nested);
        } else {
          children.push(...sanitiseInline([child], false, depth));
        }
      }
      return { type: 'list-item', children };
    }
    case 'image': {
      // Not authorable here, but national's images must survive a chapter
      // admin editing the prose around them.
      //
      // WHITELIST the object; do not pass it through. mediaUrl() sends anything
      // starting with "http" straight into <img src>, so an unfiltered image
      // lets a chapter admin plant a tracking pixel on a public microsite —
      // and any extra key rides along into the column.
      if (!block.image || typeof block.image !== 'object') return null;
      if (normaliseUrl(block.image.url) === null) return null;
      // Off-site images are not authored here and not wanted: an external URL
      // in <img src> leaks every visitor's IP and UA to whoever set it.
      if (/^[a-z]+:/i.test(String(block.image.url).trim())) return null;

      const image = {};
      for (const key of IMAGE_KEYS) {
        if (block.image[key] !== undefined) image[key] = block.image[key];
      }
      // Strapi's own image node requires `children`; keep it if present so the
      // stored JSON stays valid against its validator.
      return Array.isArray(block.children)
        ? { type: 'image', image, children: sanitiseInline(block.children, false, depth) }
        : { type: 'image', image };
    }
    case 'quote':
    case 'code':
    case 'paragraph':
    default:
      return { type: block.type, children: sanitiseInline(block.children, false, depth) };
  }
}

/** The only entry point. Returns a new array; never mutates its input. */
function sanitiseBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  const out = [];
  for (const block of blocks) {
    if (out.length >= MAX_BLOCKS) break;
    // A bare list-item at the root renders as a stray <li> outside any list.
    if (block && block.type === 'list-item') continue;
    const clean = sanitiseBlock(block, 0);
    if (!clean) continue;
    // An empty paragraph renders as nothing (RichText.astro filters it), is
    // TipTap's default trailing node, and trips plan 5's isPlainBlocks — so it
    // is dropped rather than stored. See the test for the full reasoning.
    if (clean.type === 'paragraph' && clean.children.length === 0) continue;
    out.push(clean);
  }
  return out;
}

module.exports = {
  sanitiseBlocks, normaliseUrl, isSafeUrl, ALLOWED_BLOCKS, ALLOWED_MARKS,
  MIN_HEADING, MAX_HEADING, MAX_DEPTH, MAX_BLOCKS,
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/blocks-sanitise.test.js
```

Expected: PASS, **36 tests** — 8 `normaliseUrl`, 28 `sanitiseBlocks`.

- [ ] **Step 5: Mutation-check the guards that carry the security weight**

Every mutation must assert it applied. A silently unmatched replacement is indistinguishable from an uncaught mutation — plan 5 shipped exactly that mistake.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && cat > /tmp/mutate6.py <<'EOF'
import subprocess, shutil, sys
SRC = 'src/api/chapter-admin/services/blocks.js'
MUTATIONS = [
    # (label, find, replace) -- each MUST kill at least one test
    ('allow any scheme',
     "  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;", ''),
    ('allow userinfo',
     "  if (parsed.username !== '' || parsed.password !== '') return null;", ''),
    ('keep the raw url instead of the normalised one',
     "        out.push({ type: 'link', url: href, children: inner });",
     "        out.push({ type: 'link', url: child.url, children: inner });"),
    ('allow any block type',
     "  if (!ALLOWED_BLOCKS.includes(block.type)) return null;", ''),
    ('keep unknown marks',
     "    if (node[mark] !== undefined && boolMark(node[mark])) out[mark] = true;",
     "    if (node[mark] !== undefined) out[mark] = node[mark];"),
    ('allow nested links',
     "      if (inLink || href === null || depth >= MAX_DEPTH) {",
     "      if (href === null) {"),
    ('pass the image object through',
     "      for (const key of IMAGE_KEYS) {", "      for (const key of Object.keys(block.image)) {"),
    ('allow any list child',
     "        if (!item || item.type !== 'list-item') continue;", ''),
    ('keep empty paragraphs',
     "    if (clean.type === 'paragraph' && clean.children.length === 0) continue;", ''),
]
shutil.copy(SRC, '/tmp/blocks.bak')
survived = []
try:
    for label, old, new in MUTATIONS:
        src = open('/tmp/blocks.bak').read()
        if old not in src:
            print('DID NOT APPLY  %s' % label); survived.append(label + ' (unmatched)'); continue
        open(SRC, 'w').write(src.replace(old, new, 1))
        r = subprocess.run(['npx', 'vitest', 'run', 'tests/unit/blocks-sanitise.test.js'],
                           capture_output=True, text=True)
        killed = r.returncode != 0
        print('%s  %s' % ('KILLED  ' if killed else 'SURVIVED', label))
        if not killed: survived.append(label)
finally:
    shutil.copy('/tmp/blocks.bak', SRC)
sys.exit(1 if survived else 0)
EOF
PATH="/opt/homebrew/bin:$PATH" python3 /tmp/mutate6.py
```

Expected: **nine `KILLED` lines**. A `SURVIVED` means that defence is untested — and for the first three, untested means an XSS or a phishing link nobody would notice.

**Two rules this gate exists to enforce, both learned the hard way.** Never put a
literal control character in the source: the first draft's regex contained a real
NUL byte, which made the whole plan file binary to `grep`, and the mutation
searched for the textual escape instead — so it never applied and the gate exited
1 with `DID NOT APPLY`. And never keep a mutation that cannot be killed: that
draft's control-character strip was an *equivalent mutant*, because the
colon-position logic already rejected every payload the test fed it. Both were
verified by execution. An agent hitting either one stops dead.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/blocks.js tests/unit/blocks-sanitise.test.js && \
  git commit -m "feat: blocks vocabulary and sanitiser, with link scheme allow-listing"
```

---

### Task 2: Every blocks write goes through it

Three write paths, three insertion points. All of them server-side, because the frontend is not the trust boundary.

**Files:** Modify `src/api/chapter-admin/services/resource-factory.js`, `controllers/chapter-admin.js`, `services/page-content.js`; modify `tests/unit/factory-hooks.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/factory-hooks.test.js`:

```js
describe('blocksFields', () => {
  const res = (s) => chapterScopedResource({
    uid: 'api::news-item.news-item', editableFields: ['title', 'body'],
    blocksFields: ['body'], strapiInstance: s,
  });

  const evil = [{ type: 'paragraph', children: [
    { type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'x' }] },
  ]}];

  it('sanitises a blocks field on CREATE', async () => {
    const s = fakeStrapi();
    await res(s).create(makeCtx({ title: 'T', body: evil, chapterSlug: 'boston' }));
    expect(JSON.stringify(s.calls.create[0].data.body)).not.toContain('javascript:');
  });

  it('sanitises a blocks field on UPDATE', async () => {
    // Both, or the attack simply moves to the edit form.
    const s = fakeStrapi();
    await res(s).update(makeCtx({ body: evil }, { documentId: 'r-1' }));
    expect(JSON.stringify(s.calls.update[0].data.body)).not.toContain('javascript:');
  });

  it('leaves a field that is not declared blocks alone', async () => {
    const s = fakeStrapi();
    await res(s).create(makeCtx({ title: 'javascript:not-a-url', body: [], chapterSlug: 'boston' }));
    expect(s.calls.create[0].data.title).toBe('javascript:not-a-url');
  });

  it('turns a non-array blocks value into [] rather than storing it raw', async () => {
    const s = fakeStrapi();
    await res(s).create(makeCtx({ title: 'T', body: 'nope', chapterSlug: 'boston' }));
    expect(s.calls.create[0].data.body).toEqual([]);
  });

  it('does not add the field when the payload omits it', async () => {
    // Absent means unchanged; sanitising an absent field would blank it.
    const s = fakeStrapi();
    await res(s).update(makeCtx({ title: 'T' }, { documentId: 'r-1' }));
    expect(s.calls.update[0].data).not.toHaveProperty('body');
  });
});
```

- [ ] **Step 2: Implement in the factory**

`blocksFields` is a new option, sanitised **after** the whitelist and **before** `validateData`, on both create and update:

```js
  uid, editableFields, hasSlug = false, listFields = null, listPopulate = null,
  getOnePopulate = null, requiredFields = [], blocksFields = [],
  deriveOnCreate = null, validateData = null, strapiInstance = null,
```

```js
  /**
   * Rich-text fields arrive as client-supplied JSON and are rendered into HTML
   * by RichTextInline, which puts `node.url` straight into an href. Sanitise
   * every one on every write — create AND update, since an attack that only
   * had to avoid create would just use the edit form.
   */
  function sanitiseBlocksIn(data) {
    for (const field of blocksFields) {
      if (field in data) data[field] = sanitiseBlocks(data[field]);
    }
  }
```

Call it immediately after `pickWhitelisted` in both `create` and `update`.

- [ ] **Step 3: Declare the fields on the two resources**

```js
// events
  blocksFields: ['description'],
// news
  blocksFields: ['body'],
```

- [ ] **Step 4: And in `page-content.js`, where `/page` converts server-side**

`shapeComponentEdit` currently calls `textToBlocks(text)` for body fields. Once the form can post rich JSON it must handle both, and sanitise either way:

```js
    if (BLOCK_FIELDS.has(field)) {
      // Two shapes reach here: plain text from the no-JS textarea, and blocks
      // JSON from the editor. Both end up sanitised — the JSON because it is
      // untrusted, the converted text because sanitiseBlocks is also what
      // guarantees the shape is well-formed.
      const blocks = Array.isArray(raw) ? raw : textToBlocks(text);
      data[field] = sanitiseBlocks(blocks);
    }
```

Note this changes `shapeComponentEdit`'s contract: it must now accept an **array** for a body field, where before any non-string threw `BadInputError`. Adjust the object-rejection check so an array of blocks is allowed for `BLOCK_FIELDS` and still rejected for text fields.

- [ ] **Step 5: Run the affected suites**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/factory-hooks.test.js tests/unit/page-content.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **24 tests** in `factory-hooks.test.js` (19 + 5), then **277 overall** — 235 plus 36 sanitiser, 5 factory and 1 page-integration. (Task 5 later removes 8 with `isPlainBlocks`, landing at **269**.)

- [ ] **Step 6: Prove it end to end, over HTTP**

Add to `tests/integration/page.test.js`:

```js
  it('sanitises a javascript: link posted directly to the API', async () => {
    // The screen will not offer one; the endpoint must refuse it anyway.
    const s = sections.find((x) => x.editable.includes('body'));
    await save({ index: s.index, body: [{ type: 'paragraph', children: [
      { type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', text: 'click' }] },
    ]}]});
    const row = await strapi.db.query(s.type).findOne({ where: { id: s.draftId } });
    expect(JSON.stringify(row.body)).not.toContain('javascript:');
    expect(JSON.stringify(row.body)).toContain('click');   // the words survive
  });
```

- [ ] **Step 7: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ tests/ && \
  git commit -m "feat: sanitise every chapter-admin blocks write"
```

---

## Chunk 2: The field

### Task 3: One converter, and the field that posts both shapes

**Files:** Modify `src/lib/blocks.ts`; create `src/lib/rich-text-field.ts`, `tests/unit/rich-text-field.test.ts`, `src/components/RichTextField.astro`, `tests/unit/rich-text-field-render.test.ts`

- [ ] **Step 1: Collapse the two converters into one**

`textToBlocks` exists twice — `src/lib/blocks.ts` and the CMS's `page-content.js` — with nothing asserting they agree. Plan 5 flagged this. Keep both files (they serve different runtimes and CJS/ESM boundaries make sharing painful) but **pin them together with a test**, so a change to one that is not made to the other fails.

Add to `tests/unit/blocks.test.ts`:

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const cms = require("../../../areaa-cms/src/api/chapter-admin/services/page-content.js");

describe("the two textToBlocks implementations agree", () => {
    // One in this repo, one in the CMS. A body saved through /page and one
    // saved through the news form must produce identical JSON.
    const cases = ["", "One", "One\nTwo", "  padded  ", "a\r\nb", "\n\n", "line\n\nline"];
    for (const input of cases) {
        it(`agrees on ${JSON.stringify(input)}`, () => {
            expect(textToBlocks(input)).toEqual(cms.textToBlocks(input));
        });
    }
});
```

This resolves **only because the two repos are siblings** under
`/Users/nk/Projects/AREAA/`; it fails from any other layout, and it was verified
to fail from a worktree. Say so in the test's own comment.

Note also that **neither repo has a CI test job** — `.github/workflows/` contains
only `deploy-dev.yml`, which builds a Docker image from a single-repo checkout.
So this test can only ever run locally, which is worth stating plainly rather
than leaving as a conditional. If that changes, copy the CMS implementation into
a fixture and assert against that instead; the point is that a divergence fails a
test, not where the file lives.

- [ ] **Step 2: Write the failing payload test**

```ts
import { describe, it, expect } from "vitest";
import { fromRichTextField, PRESENT_SUFFIX } from "../../src/lib/rich-text-field";

const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
};

const para = (t: string) => ({ type: "paragraph", children: [{ type: "text", text: t }] });

describe("fromRichTextField", () => {
    it("converts the textarea when no format marker is present", () => {
        // The no-JS path, and the one that must never regress: every form in
        // this system works with JavaScript disabled.
        expect(fromRichTextField(form({ body: "One\nTwo" }), "body"))
            .toEqual([para("One"), para("Two")]);
    });

    it("uses the rich payload when the marker is present", () => {
        const blocks = [{ type: "heading", level: 2, children: [{ type: "text", text: "H" }] }];
        const fd = form({
            body: "H", [`body${PRESENT_SUFFIX}`]: "1",
            body__blocks: JSON.stringify(blocks),
        });
        expect(fromRichTextField(fd, "body")).toEqual(blocks);
    });

    it("FALLS BACK to the textarea when the rich payload will not parse", () => {
        // A half-written hidden field must not cost someone their document.
        const fd = form({
            body: "One", [`body${PRESENT_SUFFIX}`]: "1", body__blocks: "{not json",
        });
        expect(fromRichTextField(fd, "body")).toEqual([para("One")]);
    });

    it("falls back when the rich payload parses to a non-array", () => {
        const fd = form({
            body: "One", [`body${PRESENT_SUFFIX}`]: "1", body__blocks: '{"type":"paragraph"}',
        });
        expect(fromRichTextField(fd, "body")).toEqual([para("One")]);
    });

    it("returns null when the field was not on the form at all", () => {
        // Distinct from "" — absent means unchanged, empty means cleared. The
        // same distinction MultiSelect's presence marker exists for.
        expect(fromRichTextField(form({}), "body")).toBeNull();
    });

    it("returns [] for a deliberately emptied textarea", () => {
        expect(fromRichTextField(form({ body: "" }), "body")).toEqual([]);
    });

    it("returns [] for a deliberately emptied editor", () => {
        const fd = form({ body: "", [`body${PRESENT_SUFFIX}`]: "1", body__blocks: "[]" });
        expect(fromRichTextField(fd, "body")).toEqual([]);
    });

    it("falls back when the marker is present but the payload is missing", () => {
        // The script sets the marker last, so this should be unreachable — but
        // the textarea is the thing the user could see, and it wins.
        const fd = form({ body: "One", [`body${PRESENT_SUFFIX}`]: "1" });
        expect(fromRichTextField(fd, "body")).toEqual([para("One")]);
    });
});
```

- [ ] **Step 3: Implement**

```ts
import { textToBlocks } from "./blocks";
import type { StrapiBlock } from "../types/strapi";

/**
 * A PRESENCE marker, matching `members__present` and `partners__present` — the
 * shape this codebase already uses twice. The first draft used a value marker
 * (`__format="text"|"blocks"`), which is server-rendered and therefore
 * restorable by the browser on a soft reload: a restored `blocks` claim beside
 * a server-fresh hidden field is a stale-payload save. This input is created by
 * the script and never rendered, so there is nothing to restore.
 */
export const PRESENT_SUFFIX = "__rich";
export const BLOCKS_SUFFIX = "__blocks";

/**
 * One rich-text field -> blocks, from whichever shape the browser could post.
 *
 * Two shapes, because this UI has no JavaScript anywhere else and must keep
 * working without it:
 *
 *  - NO JS: the textarea posts as it always has. No marker, no hidden field.
 *  - JS:    the enhancement script writes the editor's document into
 *           `<name>__blocks` and CREATES `<name>__rich`.
 *
 * Every fallback direction favours the textarea, because the textarea is the
 * thing the user could actually see. A malformed hidden field is a bug in our
 * script; losing someone's writing over it would be worse.
 *
 * Returns null when the field was absent entirely — absent means unchanged,
 * empty means cleared, and collapsing those is how a save silently blanks
 * content it never showed.
 */
export function fromRichTextField(fd: FormData, name: string): StrapiBlock[] | null {
    const raw = fd.get(name);
    if (raw === null) return null;

    if (fd.get(`${name}${PRESENT_SUFFIX}`) !== null) {
        const json = fd.get(`${name}${BLOCKS_SUFFIX}`);
        if (json !== null) {
            try {
                const parsed = JSON.parse(String(json));
                if (Array.isArray(parsed)) return parsed as StrapiBlock[];
            } catch {
                // fall through to the textarea
            }
        }
    }
    return textToBlocks(String(raw));
}
```

The server sanitises whatever comes back. This function's job is choosing a shape, not trusting one.

- [ ] **Step 4: Write the failing render test**

```ts
import { describe, it, expect } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import RichTextField from "../../src/components/RichTextField.astro";

const para = (t: string) => ({ type: "paragraph", children: [{ type: "text", text: t }] });

const render = async (props: Record<string, unknown> = {}) => {
    const container = await AstroContainer.create();
    return container.renderToString(RichTextField, {
        props: { label: "Body Text", name: "body", blocks: [para("One"), para("Two")], ...props },
    });
};

describe("RichTextField", () => {
    it("renders a real textarea carrying the current text", async () => {
        // The no-JS baseline IS the served markup. If this ever becomes an
        // empty div waiting for hydration, the form stops working for anyone
        // whose JavaScript failed to load.
        const html = await render();
        expect(html).toContain("<textarea");
        expect(html).toContain('name="body"');
        expect(html).toContain("One\nTwo");
    });

    it("renders the hidden rich payload and its format marker", async () => {
        const html = await render();
        expect(html).toContain('name="body__blocks"');
    });

    it("renders NO presence marker — only the script may create one", async () => {
        // A server-rendered marker can be restored by the browser on a soft
        // reload and pair a stale "rich" claim with a fresh hidden field. If
        // the script never runs — blocked, failed to load, threw — there is
        // nothing to restore and the textarea posts as it always has.
        const html = await render();
        expect(html).not.toContain("__rich");
    });

    it("warns, in a noscript, that saving without JavaScript flattens formatting", async () => {
        // Done-when requires this and the first draft specified it nowhere, so
        // an implementer following the plan literally shipped no warning with
        // every test green.
        const html = await render({ blocks: [
            { type: "heading", level: 2, children: [{ type: "text", text: "H" }] }] });
        expect(html).toContain("<noscript");
        expect(html).toMatch(/formatting/i);
    });

    it("omits the noscript warning when the body is already plain", async () => {
        // Nothing to lose, so nothing to warn about.
        expect(await render()).not.toContain("<noscript");
    });

    it("seeds the hidden payload with the CURRENT document, not empty", async () => {
        // If the script initialises but the user edits nothing and saves, the
        // hidden field must already hold the real document.
        const html = await render();
        expect(html).toContain("&quot;paragraph&quot;");
    });

    it("marks up the mount point the script looks for", async () => {
        expect(await render()).toContain("data-rich-text");
    });

    it("shows rich content as flattened text in the textarea", async () => {
        // The no-JS view of a rich document. Lossy, and labelled as such —
        // saving without JS replaces the formatting, which is why the label
        // says so rather than pretending otherwise.
        const html = await render({ blocks: [
            { type: "heading", level: 2, children: [{ type: "text", text: "Heading" }] },
            para("Body"),
        ]});
        expect(html).toContain("Heading\nBody");
    });

    it("renders nothing rich when given no blocks at all", async () => {
        const html = await render({ blocks: null });
        expect(html).toContain("<textarea");
        expect(html).toMatch(/name="body__blocks"[^>]*value="\[\]"/);
    });
});
```

- [ ] **Step 5: The component**

```astro
---
import FormField from "./FormField.astro";
import { blocksToPlainText } from "../lib/blocks";
import { BLOCKS_SUFFIX } from "../lib/rich-text-field";
import type { StrapiBlock } from "../types/strapi";

interface Props {
    label: string;
    name: string;
    /** The stored document. The single source for BOTH the textarea and the
     *  hidden payload — passing them separately is how they drift. */
    blocks?: StrapiBlock[] | null;
    required?: boolean;
    helper?: string;
}

const { label, name, blocks = null, required = false, helper } = Astro.props;

const doc = blocks ?? [];
// The no-JS view. Lossy by construction — which is exactly what the noscript
// warning below is about.
const text = blocksToPlainText(doc);

// Would saving through the textarea lose anything? Only warn when it would.
const isPlain = doc.every(
    (b) => b.type === "paragraph" &&
        (b.children ?? []).every((c) => c.type === "text" &&
            Object.keys(c).every((k) => k === "type" || k === "text")));
---

<div class="rtf" data-rich-text={name}>
    <FormField
        label={label} name={name} type="textarea"
        value={text} required={required} helper={helper}
    />

    {/* Seeded with the CURRENT document: if the script mounts an editor and the
        user saves without typing, the payload is already correct. */}
    <input type="hidden" name={`${name}${BLOCKS_SUFFIX}`} value={JSON.stringify(doc)} />

    {/* NO presence marker here. Only the enhancement script may create one —
        a server-rendered marker can be restored by the browser on a soft reload
        and pair a stale claim with a fresh payload. */}

    {!isPlain && (
        <noscript>
            <p class="rtf__warn">
                This text has formatting — headings, lists, links or emphasis. Your browser
                has JavaScript turned off, so you're editing it as plain text and
                <strong>saving will remove that formatting</strong>.
            </p>
        </noscript>
    )}
</div>

<style>
    .rtf__warn {
        margin: var(--space-200) 0 0; padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50); color: var(--primitive-brand-700);
        font-family: var(--font-family-body); font-size: 14px; line-height: 1.4;
    }
</style>
```

**One `blocks` prop, not `blocks` plus `text`.** The first draft specified the
prop list twice — `{label, name, blocks}` in this task and "passes
`section.values[name]` as text **and** the raw blocks" in Task 5 — and the two
flatteners available (`blocksToPlainText` in the frontend, `blocksToText` in the
CMS) disagree on trimming, blank lines and list expansion. Deriving the text here
from the same `blocks` makes drift impossible.

**No `<script>` in this component.** The enhancement is loaded once per screen in
Task 4, so a page with three rich fields loads TipTap once.

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/rich-text-field.test.ts tests/unit/rich-text-field-render.test.ts
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **17 tests** (8 payload + 9 render), plus **7** added to `blocks.test.ts` by the converter-agreement loop. 0 errors.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/rich-text-field.ts src/lib/blocks.ts src/components/RichTextField.astro tests/unit/ && \
  git commit -m "feat: rich-text field with a no-JS textarea baseline"
```

---

### Task 4: The enhancement

The first client-side script in this authoring UI. It is additive: everything works without it.

**Files:** Create `src/scripts/rich-text.ts`; modify `package.json`

- [ ] **Step 1: Install**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  npm install @tiptap/core @tiptap/starter-kit @tiptap/extension-link
```

**Vanilla, not `@tiptap/react`.** This repo has no framework integration at all — dependencies are Astro, `@astrojs/*`, `qs`, `sirv`, `typescript`, `vitest` — and adding React to render one editor would be a much larger change than the editor itself.

- [ ] **Step 2: The script**

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { StrapiImage } from "../lib/strapi-image-node";
import { tiptapToBlocks, blocksToTiptap } from "../lib/tiptap-blocks";
import { BLOCKS_SUFFIX, PRESENT_SUFFIX } from "../lib/rich-text-field";

/**
 * Progressive enhancement, and nothing more.
 *
 * If this file fails to parse, fails to load, or throws anywhere below, every
 * form it touches still works: the textarea is real, it holds the current text,
 * and no presence marker was ever written. That is the entire reason the markup
 * is shaped the way it is.
 */
for (const mount of document.querySelectorAll<HTMLElement>("[data-rich-text]")) {
    try {
        const name = mount.dataset.richText!;
        const textarea = mount.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);
        const blocksInput = mount.querySelector<HTMLInputElement>(
            `input[name="${name}${BLOCKS_SUFFIX}"]`);
        if (!textarea || !blocksInput) continue;

        let initial: unknown[] = [];
        try { initial = JSON.parse(blocksInput.value || "[]"); } catch { continue; }

        const host = document.createElement("div");
        host.className = "rte";
        textarea.parentElement!.insertBefore(host, textarea);

        const editor = new Editor({
            element: host,
            extensions: [
                StarterKit.configure({ link: {}, heading: { levels: [2, 3, 4] } }),
                StrapiImage,
            ],
            content: blocksToTiptap(initial as any),
            onUpdate: ({ editor: e }) => {
                blocksInput.value = JSON.stringify(tiptapToBlocks(e.getJSON()));
            },
        });

        // VERIFY BEFORE CLAIMING. ProseMirror does not throw on a node or mark
        // its schema does not know — it silently discards the whole document.
        // If we trusted it here, an admin would see an empty editor, change
        // only the title, save, and lose the body. Round-trip first; only if
        // the editor genuinely holds what we gave it do we hide the textarea
        // and let the rich payload win.
        const roundTripped = tiptapToBlocks(editor.getJSON());
        if (JSON.stringify(roundTripped) !== JSON.stringify(initial)) {
            editor.destroy();
            host.remove();
            continue;                       // textarea stays visible and wins
        }

        blocksInput.value = JSON.stringify(roundTripped);

        // Hide the textarea only now. Clear `required` with it: a required,
        // empty, non-focusable control fails constraint validation and the
        // browser cannot show the bubble — Chrome logs "not focusable" and the
        // Save button silently does nothing.
        textarea.required = false;
        textarea.hidden = true;

        // The presence marker is CREATED here, never server-rendered. A
        // server-rendered value marker can be restored by the browser on a soft
        // reload and pair a stale "blocks" claim with a fresh hidden field.
        // Nothing to restore means nothing to get wrong — the same reason
        // MultiSelect tests presence rather than value.
        const present = document.createElement("input");
        present.type = "hidden";
        present.name = `${name}${PRESENT_SUFFIX}`;
        present.value = "1";
        mount.appendChild(present);
    } catch {
        // One bad field must not blind the rest of the form.
        continue;
    }
}
```

- [ ] **Step 3: The converter that does the actual work**

`src/lib/tiptap-blocks.ts` — `blocksToTiptap` and `tiptapToBlocks`, pure and fully tested. The mismatches worth naming, each of which needs its own test:

| Strapi blocks | TipTap 3.x | Note |
|---|---|---|
| `strikethrough: true` | mark **`strike`** | **The names differ.** The first draft called this row a pure boolean↔array conversion and never mentioned the rename — which is a document-destroying bug, not a typo. See below. |
| soft break as `"\n"` **inside** a text leaf | `hardBreak` **node** | `RichTextInline` splits `\n` into `<br>`. Getting this wrong doubles every paragraph containing a line break. |
| `list` + `format: "ordered"/"unordered"` | `orderedList` / `bulletList` | Two node types, one Strapi type plus an attribute. `orderedList` also carries `attrs: {start: 1, type: null}` — ignore both. |
| `list-item` children mix inline and nested `list` | `listItem` wraps `paragraph` + nested list | TipTap always wraps item text in a paragraph; Strapi does not. Unwrap on the way back. |
| `quote` children are **inline** | `blockquote` requires a **block** child | Not in the first draft's table at all. Needs the same paragraph wrapper as `listItem`. |
| `code` children joined with `"\n"` | `codeBlock`, `attrs: {language: null}` | ignore `language` |
| marks as **boolean keys on the leaf** | `marks: [{type}]` **array** | |
| `link` is a **node with children** | `link` is a **mark** | Structural, and the most error-prone direction. Its `attrs` carry `href` plus `target`, `rel`, `class`, `title` — read `href`, ignore the rest. |
| `heading.level` 1–6 | `heading.attrs.level` | Clamp to 2–4 both ways |
| `image` block | **no image node exists in the schema** | See below. |
| `[]` (empty body) | `{type:"doc", content:[{type:"paragraph"}]}`, and an empty doc has **no `content` key at all** | `tiptapToBlocks` must not dereference `.content` unguarded, and an empty document must map back to `[]`. |

**Two of these will silently destroy a document, and ProseMirror gives no error.**
Feeding it a node or mark its schema does not know does not drop that node — it
**discards the entire document** and logs a warning:

```
IN : doc -> [image, paragraph("after")]
[tiptap warn]: Invalid content. RangeError: Unknown node type: image
OUT: {"type":"doc","content":[{"type":"paragraph"}]}
getText(): ""
```

Same for `marks:[{type:"strikethrough"}]` — `RangeError: There is no mark type
strikethrough in this schema`, whole document gone. Both were reproduced against
a real editor during review, and both are entries in this plan's own corpus.

So:

- **`strikethrough` ↔ `strike` must be renamed in both directions.**
- **`image` needs a node to land on.** Register a minimal atom so ProseMirror
  accepts it and round-trips it untouched:

```ts
import { Node } from "@tiptap/core";

/**
 * National inserts images through Strapi's editor; the schema TipTap builds
 * from StarterKit has no image node, and an unknown node makes ProseMirror
 * throw away the WHOLE document. This exists so those images survive a chapter
 * admin editing the prose around them. It is deliberately not insertable — no
 * toolbar button, no input rule — because inserting one needs the upload flow.
 */
export const StrapiImage = Node.create({
    name: "strapiImage",
    group: "block",
    atom: true,
    selectable: true,
    addAttributes: () => ({ image: { default: null } }),
    parseHTML: () => [{ tag: "div[data-strapi-image]" }],
    renderHTML: ({ HTMLAttributes }) => [
        "div", { "data-strapi-image": "", class: "rte__image" },
        ["img", { src: HTMLAttributes.image?.url ?? "",
                  alt: HTMLAttributes.image?.alternativeText ?? "" }],
    ],
});
```

- **`StarterKit.configure({ link: false })`.** StarterKit v3 already bundles
  Link, so adding `@tiptap/extension-link` alongside it emits
  `[tiptap warn]: Duplicate extension names found: ['link']` and which config
  wins is undefined. Either disable StarterKit's and configure your own, or drop
  the extra package. **Pin the versions** — `underline` is in StarterKit in v3
  and was a separate package in v2, so an unpinned install changes the schema.

**The load-bearing test is the round trip**, over a corpus that includes every shape in `ALLOWED_BLOCKS`. Anything that fails it is content a chapter admin can destroy by opening a form and pressing Save without typing.

`tests/unit/tiptap-blocks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blocksToTiptap, tiptapToBlocks } from "../../src/lib/tiptap-blocks";

const text = (t: string, marks = {}) => ({ type: "text", text: t, ...marks });
const para = (...c: any[]) => ({ type: "paragraph", children: c });
const roundTrip = (b: any[]) => tiptapToBlocks(blocksToTiptap(b));

// Every shape ALLOWED_BLOCKS names, plus every mark. This corpus is the
// contract: anything here that does not survive is content an admin destroys
// by opening a form and pressing Save without typing a character.
const CORPUS: Record<string, any[]> = {
    empty: [],
    paragraph: [para(text("One")), para(text("Two"))],
    marks: [para(text("plain "), text("bold", { bold: true }),
                 text("italic", { italic: true }), text("under", { underline: true }),
                 text("struck", { strikethrough: true }), text("code", { code: true }))],
    combined: [para(text("both", { bold: true, italic: true }))],
    heading: [{ type: "heading", level: 2, children: [text("H2")] },
              { type: "heading", level: 4, children: [text("H4")] }],
    unordered: [{ type: "list", format: "unordered", children: [
        { type: "list-item", children: [text("One")] },
        { type: "list-item", children: [text("Two")] }]}],
    ordered: [{ type: "list", format: "ordered", children: [
        { type: "list-item", children: [text("First")] }]}],
    nested: [{ type: "list", format: "unordered", children: [
        { type: "list-item", children: [
            text("Outer"),
            { type: "list", format: "ordered", children: [
                { type: "list-item", children: [text("Inner")] }]}]}]}],
    quote: [{ type: "quote", children: [text("Quoted")] }],
    code: [{ type: "code", children: [text("const x = 1;")] }],
    link: [para({ type: "link", url: "https://areaa.org", children: [text("AREAA")] })],
    linkMarked: [para({ type: "link", url: "https://areaa.org",
                        children: [text("AREAA", { bold: true })] })],
    softBreak: [para(text("Line one\nLine two"))],
    image: [{ type: "image", image: { url: "/uploads/x.png", alternativeText: "X" } }],
    mixed: [{ type: "heading", level: 3, children: [text("Title")] },
            para(text("Body with "), { type: "link", url: "/events", children: [text("a link")] }),
            { type: "list", format: "unordered", children: [
                { type: "list-item", children: [text("Point")] }]}],
};

describe("round trip", () => {
    for (const [name, blocks] of Object.entries(CORPUS)) {
        it(`preserves ${name}`, () => {
            expect(roundTrip(blocks)).toEqual(blocks);
        });
    }
});

describe("the mismatches that make this hard", () => {
    it("keeps a soft break INSIDE one paragraph, not as two paragraphs", () => {
        // Strapi stores shift+enter as "\n" in a text leaf and RichTextInline
        // splits it into <br>. TipTap uses a hardBreak NODE. Getting this wrong
        // silently doubles every paragraph that contains a line break.
        const out = roundTrip([para(text("a\nb"))]);
        expect(out).toHaveLength(1);
        expect(out[0].children[0].text).toBe("a\nb");
    });

    it("maps list format to the right TipTap node type and back", () => {
        const doc = blocksToTiptap(CORPUS.ordered);
        expect(JSON.stringify(doc)).toContain("orderedList");
        expect(JSON.stringify(blocksToTiptap(CORPUS.unordered))).toContain("bulletList");
    });

    it("unwraps TipTap's paragraph inside a list item", () => {
        // TipTap always wraps item content in a paragraph; Strapi does not. An
        // extra paragraph node inside list-item is not in ALLOWED_BLOCKS, so it
        // would be sanitised away along with its text.
        const out = roundTrip(CORPUS.unordered);
        expect(out[0].children[0].children[0]).toEqual(text("One"));
    });

    it("converts marks between boolean keys and a marks array", () => {
        const doc: any = blocksToTiptap(CORPUS.marks);
        const leaf = doc.content[0].content.find((n: any) => n.text === "bold");
        expect(leaf.marks.map((m: any) => m.type)).toContain("bold");
    });

    it("converts a link between a NODE and a MARK, the most error-prone direction", () => {
        const doc: any = blocksToTiptap(CORPUS.link);
        const leaf = doc.content[0].content[0];
        expect(leaf.type).toBe("text");
        expect(leaf.marks.find((m: any) => m.type === "link").attrs.href)
            .toBe("https://areaa.org");
        expect(roundTrip(CORPUS.link)).toEqual(CORPUS.link);
    });

    it("keeps a link's own marks alongside the link mark", () => {
        expect(roundTrip(CORPUS.linkMarked)).toEqual(CORPUS.linkMarked);
    });

    it("clamps heading levels to what the renderer emits, in both directions", () => {
        expect(roundTrip([{ type: "heading", level: 1, children: [text("A")] }]))
            .toEqual([{ type: "heading", level: 2, children: [text("A")] }]);
        expect(roundTrip([{ type: "heading", level: 6, children: [text("A")] }]))
            .toEqual([{ type: "heading", level: 4, children: [text("A")] }]);
    });

    it("passes an image through untouched, though the editor cannot make one", () => {
        expect(roundTrip(CORPUS.image)).toEqual(CORPUS.image);
    });

    it("survives a TipTap document containing a node type we never emit", () => {
        // A future StarterKit version, or a paste. Must not throw, and must not
        // invent a block type the sanitiser will silently drop.
        const doc = { type: "doc", content: [
            { type: "horizontalRule" },
            { type: "paragraph", content: [{ type: "text", text: "kept" }] }]};
        expect(() => tiptapToBlocks(doc as any)).not.toThrow();
        expect(tiptapToBlocks(doc as any)).toEqual([para(text("kept"))]);
    });

    it("returns an empty document for junk input rather than throwing", () => {
        for (const bad of [null, undefined, "nope", 42, {}]) {
            expect(tiptapToBlocks(bad as any)).toEqual([]);
            expect(() => blocksToTiptap(bad as any)).not.toThrow();
        }
    });
});
```

That is **15 round-trip cases plus 10 mismatch tests = 25** — and **none of them
proves anything about TipTap**, because `blocksToTiptap` and `tiptapToBlocks` are
both ours and `roundTrip` composes them against each other. Measured during
review: pasting these 25 tests over `const blocksToTiptap = x => x; const
tiptapToBlocks = x => x;` gives **19 passing**, including all 15 round-trip cases.
A converter written faithfully to the table above passes 14 of 15 pure — and
wipes the document on `marks` and `image` through a real editor.

- [ ] **Step 3b: The gate — the same corpus through a REAL editor**

This is the test that would have caught both document-destroying bugs. It needs
a DOM, which this repo's vitest config does not currently provide.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm install -D jsdom
```

`tests/unit/tiptap-editor.test.ts` — note the docblock pragma, so only this file
pays for a DOM:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { StrapiImage } from "../../src/lib/strapi-image-node";
import { blocksToTiptap, tiptapToBlocks } from "../../src/lib/tiptap-blocks";
import { CORPUS } from "./tiptap-corpus";

const through = (blocks: any[]) => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...a) => warnings.push(a);
    try {
        const editor = new Editor({
            element: document.createElement("div"),
            extensions: [StarterKit.configure({ link: false, heading: { levels: [2, 3, 4] } }),
                         StrapiImage],
            content: blocksToTiptap(blocks),
        });
        const out = tiptapToBlocks(editor.getJSON());
        editor.destroy();
        return { out, warnings };
    } finally {
        console.warn = warn;
    }
};

describe("round trip THROUGH a real editor", () => {
    for (const [name, blocks] of Object.entries(CORPUS)) {
        it(`preserves ${name}`, () => {
            const { out, warnings } = through(blocks);
            // ProseMirror does not throw on an unknown node or mark — it
            // discards the WHOLE document and warns. An assertion on the
            // output alone would report an empty array as a mismatch; this
            // says which failure it was.
            expect(warnings, `tiptap warned: ${JSON.stringify(warnings)}`).toEqual([]);
            expect(out).toEqual(blocks);
        });
    }
});
```

Extract `CORPUS` into `tests/unit/tiptap-corpus.ts` so both files share exactly
one definition. **This suite is the gate, not the pure one** — the pure tests stay
because they localise a failure to the converter rather than the schema, but a
green pure suite means nothing on its own.

- [ ] **Step 4: Load it on the authoring screens only**

In `EventForm.astro`, `NewsForm.astro` and `PageSectionForm.astro`:

```astro
<script>
    import "../scripts/rich-text";
</script>
```

Astro bundles this through Vite and it never reaches the public microsite, which has no editor.

- [ ] **Step 5: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/tiptap-blocks.test.ts
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run build
```

Expected: **25 pure + 15 editor-backed tests**, 0 errors, and a build that succeeds — the build is the gate that catches an import the dev server tolerated.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/scripts/ src/lib/tiptap-blocks.ts tests/unit/tiptap-blocks.test.ts \
          src/components/ package.json package-lock.json && \
  git commit -m "feat: TipTap enhancement over the textarea baseline"
```

---

## Chunk 3: The three surfaces

### Task 5: Wire them, and retire plan 5's lock

**Files:** Modify `src/lib/event-form.ts`, `src/lib/news-form.ts`, `src/components/{EventForm,NewsForm,PageSectionForm}.astro`, `src/pages/api/chapter-admin/page.ts`; modify `controllers/chapter-admin.js`

- [ ] **Step 1: The two form mappers use the new field**

The line above the one being replaced has to go too, or `description` is
declared twice and the file will not compile:

```diff
- const description = str(fd, "description");
- if (description) payload.description = textToBlocks(description);
+ const description = fromRichTextField(fd, "description");
+ if (description !== null) payload.description = description;
```

Same shape in `news-form.ts` (`const body = str(fd, "body")` and the line after).

The change from `if (description)` to `if (description !== null)` is deliberate —
the old test was falsy, so an emptied field was dropped rather than cleared — but
it has a consequence the first draft did not name: **an emptied news body now
posts `[]`, and `resource-factory.js` counts `[]` as empty against
`requiredFields: ['title','body']`, so it 400s with "body is required" instead of
clearing.** That is arguably the right behaviour; it is a behaviour change either
way, and it needs a test in `tests/unit/factory-hooks.test.js`.

- [ ] **Step 2: The three components render `RichTextField`**

In `EventForm.astro` and `NewsForm.astro`, replace the `description` / `body`
`<FormField type="textarea">` with `<RichTextField … blocks={…} />`.

In `PageSectionForm.astro` the field is produced inside a `.map()` over
`section.editable`, so it needs a branch:

```astro
    {section.editable.map((name) => (
        name === "body"
            ? <RichTextField label={FIELD_LABELS[name]} name={name} blocks={section.blocks ?? []} />
            : <FormField label={FIELD_LABELS[name] ?? name} name={name} type="text"
                         value={section.values[name] ?? ""} />
    ))}
```

- [ ] **Step 2b: The `/page` save path, which does not exist yet**

**Without this the whole `/page` half of this plan silently does nothing.**
`toSectionPayload` reads only the server-declared field names and `String()`s
them, so `body__blocks` and `body__rich` are dropped on the floor — there is even
an existing test pinning that (`page-form.test.ts`, "ignores a field the section
did not declare"). The first draft never mentioned this file, so the editor would
have posted `editor.getText()` and every heading, list and link would have been
flattened by `textToBlocks` on the server, with plan 5's lock already removed to
stop complaining about it.

`src/lib/page-form.ts` — split the rich field out:

```ts
export function toSectionPayload(
    fd: FormData, editable: string[]
): { index: number; values: Record<string, unknown> } | null {
    // …index checks unchanged…
    const values: Record<string, unknown> = {};
    for (const name of editable) {
        if (name === "body") {
            const blocks = fromRichTextField(fd, name);
            if (blocks !== null) values[name] = blocks;
            continue;
        }
        const v = fd.get(name);
        if (v !== null) values[name] = String(v);
    }
    if (Object.keys(values).length === 0) return null;
    return { index, values };
}
```

`Record<string, string>` becomes `Record<string, unknown>` here, in
`savePageSection` (`src/lib/chapter-admin/page.ts`), and in the route. Add
`blocks?: StrapiBlock[]` to the `PageSection` interface in the same file, or
`section.blocks` in Step 2 is a typecheck error.

Add two tests to `page-form.test.ts`:

```ts
    it("sends body as blocks when the editor was present", () => {
        const fd = form({ sectionIndex: "0", title: "T", body: "H",
                          body__rich: "1", body__blocks: '[{"type":"heading","level":2,"children":[]}]' });
        expect(toSectionPayload(fd, ["title", "body"])!.values.body)
            .toEqual([{ type: "heading", level: 2, children: [] }]);
    });

    it("converts the textarea when the editor was absent", () => {
        const fd = form({ sectionIndex: "0", body: "One" });
        expect(toSectionPayload(fd, ["body"])!.values.body)
            .toEqual([{ type: "paragraph", children: [{ type: "text", text: "One" }] }]);
    });
```

- [ ] **Step 3: `getPage` returns blocks alongside text**

```diff
-        values: Object.fromEntries(
-          editable.map((f) => [f, f === 'body' ? blocksToText(row?.body) : (row?.[f] ?? '')])),
+        values: Object.fromEntries(
+          editable.map((f) => [f, f === 'body' ? blocksToText(row?.body) : (row?.[f] ?? '')])),
+        // The editor needs the real document; the textarea needs the flattened
+        // text. Both are sent, and which one posts depends on whether the
+        // enhancement script ran.
+        blocks: editable.includes('body') ? (row?.body ?? []) : undefined,
```

- [ ] **Step 4: Retire the rich-body lock**

This is the payoff. `chapter-admin.js:343` currently removes `body` from `editable` when the stored blocks are rich, and `updatePage` 400s a write to such a field. Both go:

```diff
-      const bodyIsRich = fields.includes('body') && !isPlainBlocks(row?.body);
-      const editable = bodyIsRich ? fields.filter((f) => f !== 'body') : fields;
+      const editable = fields;
```

```diff
-    if ('body' in input && !isPlainBlocks(row.body)) {
-      return ctx.badRequest(
-        'That section now contains formatting this editor would remove. Reload the page.');
-    }
```

**Delete `isPlainBlocks` from the CMS, along with everything downstream of it.**
The first draft said to keep it "deciding whether the no-JS textarea is safe to
offer" — but the server cannot know whether the client will have JavaScript, so
there is no coherent job left. The equivalent check now lives in
`RichTextField.astro`, client-side, where the answer is knowable, and drives the
`<noscript>` warning.

Removing it is not one line. Everything below is currently reachable only through
`bodyIsRich`, and leaving it in place means dead code plus **two frontend tests
still asserting a world that no longer exists while staying green**:

| Delete | Where |
|---|---|
| `isPlainBlocks` + its 8 unit tests | `services/page-content.js`, `tests/unit/page-content.test.js` |
| the `readOnlyReason: 'rich-body'` union member | `src/lib/chapter-admin/page.ts` |
| the `rich-body` branch | `PageSectionForm.astro` |
| "explains a rich body instead of offering a textarea" | `tests/unit/page-section-render.test.ts` |
| "still offers title when only the body is locked" | same file |
| "refuses to edit a body that carries formatting" | `tests/integration/page.test.js` — **replace**, do not delete |

That last one is the important replacement. It becomes: a rich body is now
returned in `editable`, `getPage` includes it in `blocks`, and a PUT carrying
rich blocks round-trips through `sanitiseBlocks` unchanged. Write it that way
explicitly — "assert the new behaviour" is not enough instruction on its own.

`readOnlyReason` keeps its other member, `not-editable`, so the field and its
branch stay; only the `rich-body` case goes.

**Net test movement: −8 CMS unit, −2 frontend render, 0 integration** (one
replaced in place). Both totals below already account for it.

- [ ] **Step 5: Full suites**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **269 CMS**, **154 frontend** — 90 + 7 agreement + 8 payload + 9 render + 25 tiptap-pure + 15 tiptap-editor + 2 page-form − 2 retired rich-body.

Plan 5's tests that asserted the lock must be **updated, not deleted** — they now assert that a rich body is editable and round-trips.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && git add -A src/ && git commit -m "feat: rich text on events, news and page bodies"
cd /Users/nk/Projects/AREAA/areaa-cms && git add -A src/ tests/ && git commit -m "feat: page bodies are editable when rich, now that the editor can round-trip them"
```

---

## Chunk 4: Verification

### Task 6: Both suites, twice, with no drift

- [ ] **Step 1: Snapshot, run, compare**

Recreate plan 5's snapshot SQL (it lives in `/tmp` and does not survive a reboot; the query is in plan 5 Task 4 Step 3). Expected: **269 CMS**, **154 frontend**, `pages_cmps` byte-identical, all component copy identical.

### Task 7: Prove it in a browser — twice

The only task in this plan that can catch a broken enhancement, because every test above runs without a DOM.

- [ ] **Step 1: Snapshot as plan 5 did**, JSON per component, with a scripted restore ready **before** the servers start.

- [ ] **Step 2: With JavaScript ENABLED**

| # | Action | Expected |
|---|---|---|
| 1 | `/page`, a Text Section | A toolbar and an editable area, not a bare textarea |
| 2 | Type a heading, a bullet list, a bold word, a link to `https://areaa.org` | All render in the editor |
| 3 | Save | "Section saved." |
| 4 | **Public microsite** | `<h2>`, `<ul>`, `<strong>`, and an `<a href="https://areaa.org">` |
| 5 | Reopen `/page` | The editor shows the same document — not flattened text |
| 6 | Insert a link, then edit its URL to `javascript:alert(1)` via devtools, and save | The words survive; the `href` does not. No alert on the public page. |
| 7 | Event description and News body | Same editor, same round trip |

- [ ] **Step 3: With JavaScript DISABLED**

| # | Action | Expected |
|---|---|---|
| 8 | `/page`, same section | A plain textarea holding the flattened text, plus a `<noscript>` warning that saving will remove formatting |
| 9 | Edit the text and save | Saves; the document becomes paragraphs — exactly what the warning said |
| 10 | Re-enable JS, reopen | Editor shows the paragraphs |
| 11 | Every other admin form | Still works — this plan touched three components, and nothing else may have regressed |

- [ ] **Step 4: Restore, verify against the snapshot, then stop the servers.**

---

## Done when

- **269 CMS and 154 frontend tests green**, CMS twice, `pages_cmps` byte-identical.
- A chapter admin writes a heading, a list, a bold word and a link, and the **public microsite renders all four**.
- Reopening the form shows the **document**, not flattened text.
- A `javascript:` URL posted directly to the API is stripped while its text survives — proven by an integration test, not only by the UI refusing to offer it.
- **With JavaScript disabled**, every form still submits and saves, and a `<noscript>` warning says what will be lost.
- The two `textToBlocks` implementations are pinned together by a test.
- The 15-case corpus round-trips **through a real `Editor`** with **zero TipTap warnings** — the gate that catches a schema mismatch. The pure round trip passing is not sufficient and is not the criterion.
- Plan 5's rich-body lock is gone and its tests assert the new behaviour.
- All nine sanitiser mutations are killed.

## Known limitations, accepted

- **Saving with JavaScript disabled still flattens a rich document.** This plan trades plan 5's hard server-side lock for a `<noscript>` warning, because the server cannot know whether the client will have an editor. That is strictly weaker, and it is the price of making rich content editable at all.
- **No images in the editor.** Existing image blocks survive; new ones need the upload flow.
- **TipTap plus ProseMirror is a large bundle** on three authoring screens. It is not loaded on any public page. If it becomes a problem, the fix is a dynamic import behind a "Format" button, not a smaller editor.
- **Three things must now move together, and nothing enforces it:** `sanitiseBlocks`'s vocabulary, `RichText.astro`'s renderer, and TipTap's schema. Adding a renderer case without the sanitiser stores content that never appears; adding it to the sanitiser without TipTap makes ProseMirror discard whole documents. The `strikethrough`/`strike` rename and the missing image node are both instances of the third pair drifting.
- **Retiring the lock removes a SERVER-side guarantee, not just a no-JS one.** Any client can now flatten a rich body over `PUT /page` with no guard. The `<noscript>` warning covers the case this UI creates; it does not cover a hand-rolled request, and nothing else does either.
- **The pure converter tests prove only that our two functions agree with each other.** The editor-backed suite in Task 4 Step 3b is the real gate; the pure ones survive because they localise a failure to the converter rather than the schema.
- **`sanitiseBlocks` can emit blocks Strapi's own validator would reject** — empty-children headings, quotes and code nodes. Verified: nothing on the chapter-admin write path runs `blocks-validator`, so they store. Any future path that does validate (content-manager, an import, a Strapi upgrade) will reject them.
- **No sanitisation of what national writes** through Strapi's own admin panel. They are trusted, and their content is not client-supplied JSON — but it is the same column, and a compromised national account is a different threat model than this plan addresses.
- **`FAQ.answer` and `FAQItem.answer`** remain unreachable from any chapter-admin screen.
