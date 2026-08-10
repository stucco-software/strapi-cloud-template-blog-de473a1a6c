# Plan 6: Real rich text — TipTap, a bidirectional converter, and the sanitiser it requires

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text placeholder converter with a real bidirectional one, so a chapter admin can write headings, lists, links, quotes and emphasis — and so the content national already authored in Strapi's block editor stops being read-only to them.

**Architecture:** The textarea stays. It is what the server renders, it is what posts without JavaScript, and it remains the fallback forever. A progressive-enhancement script mounts TipTap over it, and on submit serialises the document into a hidden field alongside a `__format` marker — the same presence-marker shape used twice already in this codebase. The server accepts **both** shapes and **sanitises every blocks value on every write**, because the rich payload is client-supplied JSON and the public renderer puts `node.url` straight into an `href`.

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
- Collapsing the two converter copies into one, with a test that pins them together.

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
| **Zero `<script>` tags in the entire chapter-admin UI** | ✅ EventForm, NewsForm, CommitteeForm, MultiSelect, PageSectionForm, FormField — all zero. This plan introduces the first, which is why the no-JS baseline is non-negotiable rather than aspirational. |
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
  sanitiseBlocks, isSafeUrl, ALLOWED_BLOCKS, ALLOWED_MARKS,
} = require('../../src/api/chapter-admin/services/blocks.js');

const para = (...children) => ({ type: 'paragraph', children });
const text = (t, marks = {}) => ({ type: 'text', text: t, ...marks });

describe('isSafeUrl', () => {
  it('allows http, https, mailto and tel', () => {
    for (const u of ['http://x.example', 'https://x.example/a?b=1',
                     'mailto:hi@areaa.org', 'tel:+18005551234']) {
      expect(isSafeUrl(u), u).toBe(true);
    }
  });

  it('allows site-relative links', () => {
    for (const u of ['/chapters/boston', '/events/x#top', '#section']) {
      expect(isSafeUrl(u), u).toBe(true);
    }
  });

  it('REJECTS javascript:, in every disguise', () => {
    // RichTextInline puts node.url straight into href with no sanitisation.
    // Astro escapes the VALUE; it does not block the SCHEME.
    for (const u of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'javascript:alert(1)',
    ]) {
      expect(isSafeUrl(u), JSON.stringify(u)).toBe(false);
    }
  });

  it('REJECTS data: and vbscript:', () => {
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejects a protocol-relative URL, which inherits the page scheme', () => {
    expect(isSafeUrl('//evil.example/x')).toBe(false);
  });

  it('rejects empty, non-string and absurdly long values', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(42)).toBe(false);
    expect(isSafeUrl('https://x.example/' + 'a'.repeat(5000))).toBe(false);
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
    const img = { type: 'image', image: { url: '/uploads/x.png', alternativeText: 'X' } };
    expect(sanitiseBlocks([img, para(text('after'))])[0]).toEqual(img);
  });

  it('DROPS a block type the renderer does not handle', () => {
    const out = sanitiseBlocks([{ type: 'table', children: [] }, para(text('kept'))]);
    expect(out).toEqual([para(text('kept'))]);
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

  it('drops a text leaf with no text, but keeps a deliberate empty paragraph', () => {
    const out = sanitiseBlocks([para(text('')), para(text('kept'))]);
    expect(out).toEqual([{ type: 'paragraph', children: [] }, para(text('kept'))]);
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

  it('truncates nesting beyond a sane depth rather than storing it', () => {
    let node = { type: 'list', format: 'unordered',
                 children: [{ type: 'list-item', children: [text('deep')] }] };
    for (let i = 0; i < 30; i += 1) {
      node = { type: 'list', format: 'unordered',
               children: [{ type: 'list-item', children: [node] }] };
    }
    expect(JSON.stringify(sanitiseBlocks([node])).length).toBeLessThan(20000);
  });

  it('strips any key the vocabulary does not name', () => {
    // Whatever a future TipTap extension adds must not reach the database
    // just because it was in the payload.
    const out = sanitiseBlocks([{ type: 'paragraph', children: [text('x')],
                                  onclick: 'evil()', __proto__: {} }]);
    expect(Object.keys(out[0]).sort()).toEqual(['children', 'type']);
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

const MAX_URL_LEN = 2048;

/**
 * Is this URL safe to put in an href?
 *
 * Scheme allow-list, not a deny-list. The control-character strip matters:
 * browsers ignore tabs, newlines and C0 characters inside a scheme, so
 * `java\tscript:` and `java\nscript:` both execute.
 */
function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  if (url.length === 0 || url.length > MAX_URL_LEN) return false;

  // eslint-disable-next-line no-control-regex
  const cleaned = url.replace(/[ - ]/g, '').toLowerCase();
  if (cleaned === '') return false;

  // Protocol-relative: inherits the page's scheme and points off-site.
  if (cleaned.startsWith('//')) return false;

  // Relative and fragment links are fine and common.
  if (cleaned.startsWith('/') || cleaned.startsWith('#') || cleaned.startsWith('?')) return true;

  const colon = cleaned.indexOf(':');
  if (colon === -1) return true;                    // bare relative path
  const scheme = cleaned.slice(0, colon);
  return ['http', 'https', 'mailto', 'tel'].includes(scheme);
}

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
      if (inLink || !isSafeUrl(child.url) || depth >= MAX_DEPTH) {
        out.push(...inner);
      } else {
        out.push({ type: 'link', url: child.url, children: inner });
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
      if (!block.image || typeof block.image !== 'object') return null;
      return { type: 'image', image: block.image };
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
    const clean = sanitiseBlock(block, 0);
    if (clean) out.push(clean);
  }
  return out;
}

module.exports = {
  sanitiseBlocks, isSafeUrl, ALLOWED_BLOCKS, ALLOWED_MARKS,
  MIN_HEADING, MAX_HEADING, MAX_DEPTH,
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/blocks-sanitise.test.js
```

Expected: PASS, **26 tests** — 6 URL, 20 sanitiser.

- [ ] **Step 5: Mutation-check the guards that carry the security weight**

Every mutation must assert it applied. A silently unmatched replacement is indistinguishable from an uncaught mutation — plan 5 shipped exactly that mistake.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && cat > /tmp/mutate6.py <<'EOF'
import subprocess, shutil, sys
SRC = 'src/api/chapter-admin/services/blocks.js'
MUTATIONS = [
    ('allow any scheme',        "  return ['http', 'https', 'mailto', 'tel'].includes(scheme);", '  return true;'),
    ('skip control-char strip', "  const cleaned = url.replace(/[\\u0000-\\u0020]/g, '').toLowerCase();", '  const cleaned = url.toLowerCase();'),
    ('allow protocol-relative', "  if (cleaned.startsWith('//')) return false;", ''),
    ('allow any block type',    "  if (!ALLOWED_BLOCKS.includes(block.type)) return null;", ''),
    ('keep unknown marks',      "    if (node[mark] !== undefined && boolMark(node[mark])) out[mark] = true;", '    if (node[mark] !== undefined) out[mark] = node[mark];'),
    ('allow nested links',      "      if (inLink || !isSafeUrl(child.url) || depth >= MAX_DEPTH) {", '      if (!isSafeUrl(child.url)) {'),
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

Expected: **six `KILLED` lines**. A `SURVIVED` means that defence is untested — and for the first three, untested means an XSS nobody would notice.

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

Expected: **24 tests** in `factory-hooks.test.js` (19 + 5), then **267 overall** — 235 plus 26 sanitiser, 5 factory and 1 page-integration.

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

If the relative path across repos is unworkable in CI, copy the CMS implementation into a fixture and assert against that instead — the point is that a divergence fails a test, not where the file lives.

- [ ] **Step 2: Write the failing payload test**

```ts
import { describe, it, expect } from "vitest";
import { fromRichTextField, FORMAT_SUFFIX } from "../../src/lib/rich-text-field";

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

    it("uses the rich payload when the marker says blocks", () => {
        const blocks = [{ type: "heading", level: 2, children: [{ type: "text", text: "H" }] }];
        const fd = form({
            body: "H", [`body${FORMAT_SUFFIX}`]: "blocks",
            body__blocks: JSON.stringify(blocks),
        });
        expect(fromRichTextField(fd, "body")).toEqual(blocks);
    });

    it("FALLS BACK to the textarea when the rich payload will not parse", () => {
        // A half-written hidden field must not cost someone their document.
        const fd = form({
            body: "One", [`body${FORMAT_SUFFIX}`]: "blocks", body__blocks: "{not json",
        });
        expect(fromRichTextField(fd, "body")).toEqual([para("One")]);
    });

    it("falls back when the rich payload parses to a non-array", () => {
        const fd = form({
            body: "One", [`body${FORMAT_SUFFIX}`]: "blocks", body__blocks: '{"type":"paragraph"}',
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
        const fd = form({ body: "", [`body${FORMAT_SUFFIX}`]: "blocks", body__blocks: "[]" });
        expect(fromRichTextField(fd, "body")).toEqual([]);
    });

    it("ignores a marker naming a format it does not know", () => {
        const fd = form({ body: "One", [`body${FORMAT_SUFFIX}`]: "markdown", body__blocks: "[]" });
        expect(fromRichTextField(fd, "body")).toEqual([para("One")]);
    });
});
```

- [ ] **Step 3: Implement**

```ts
import { textToBlocks } from "./blocks";
import type { StrapiBlock } from "../types/strapi";

export const FORMAT_SUFFIX = "__format";
export const BLOCKS_SUFFIX = "__blocks";

/**
 * One rich-text field -> blocks, from whichever shape the browser could post.
 *
 * Two shapes, because this UI has no JavaScript anywhere else and must keep
 * working without it:
 *
 *  - NO JS: the textarea posts as it always has. No marker, no hidden field.
 *  - JS:    the enhancement script writes the editor's document into
 *           `<name>__blocks` and sets `<name>__format` to "blocks".
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

    if (String(fd.get(`${name}${FORMAT_SUFFIX}`) ?? "") === "blocks") {
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
        expect(html).toContain('name="body__format"');
    });

    it("defaults the format marker to text, so a broken script degrades safely", async () => {
        // The script flips this to "blocks". If it never runs — blocked, failed
        // to load, an error before this line — the textarea posts as it always
        // has, and nothing is lost.
        const html = await render();
        expect(html).toMatch(/name="body__format"[^>]*value="text"/);
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

`RichTextField.astro` renders, in order: the label, a `<textarea name={name}>` holding `blocksToPlainText(blocks)`, `<input type="hidden" name={`${name}__blocks`} value={JSON.stringify(blocks ?? [])}>`, `<input type="hidden" name={`${name}__format`} value="text">`, and a helper line. The wrapper carries `data-rich-text={name}`.

**No `<script>` in this component.** The enhancement is loaded once per screen in Task 4, so a page with three rich fields loads TipTap once.

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/rich-text-field.test.ts tests/unit/rich-text-field-render.test.ts
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **15 tests** (8 payload + 7 render), plus **7** added to `blocks.test.ts` by the converter-agreement loop. 0 errors.

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
import Link from "@tiptap/extension-link";
import { tiptapToBlocks, blocksToTiptap } from "../lib/tiptap-blocks";
import { FORMAT_SUFFIX, BLOCKS_SUFFIX } from "../lib/rich-text-field";

/**
 * Progressive enhancement, and nothing more.
 *
 * If this file fails to parse, fails to load, or throws before it finishes,
 * every form it touches still works: the textarea is real, it holds the current
 * text, and the format marker still says "text". That is the entire reason the
 * markup is shaped the way it is.
 */
for (const mount of document.querySelectorAll<HTMLElement>("[data-rich-text]")) {
    const name = mount.dataset.richText!;
    const textarea = mount.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);
    const blocksInput = mount.querySelector<HTMLInputElement>(`input[name="${name}${BLOCKS_SUFFIX}"]`);
    const formatInput = mount.querySelector<HTMLInputElement>(`input[name="${name}${FORMAT_SUFFIX}"]`);
    if (!textarea || !blocksInput || !formatInput) continue;

    let initial: unknown[] = [];
    try { initial = JSON.parse(blocksInput.value || "[]"); } catch { initial = []; }

    const host = document.createElement("div");
    host.className = "rte";
    textarea.parentElement!.insertBefore(host, textarea);
    // Hidden, not removed: it is still the submitted field if anything below
    // throws, and screen readers keep the label association.
    textarea.hidden = true;

    const editor = new Editor({
        element: host,
        extensions: [
            StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
            Link.configure({ openOnClick: false, autolink: false }),
        ],
        content: blocksToTiptap(initial as any),
        onUpdate: ({ editor: e }) => {
            blocksInput.value = JSON.stringify(tiptapToBlocks(e.getJSON()));
            // Keep the textarea in step so a no-JS-shaped submit is still right.
            textarea.value = e.getText();
        },
    });

    // Only claim "blocks" once an editor genuinely exists.
    formatInput.value = "blocks";
    blocksInput.value = JSON.stringify(tiptapToBlocks(editor.getJSON()));
}
```

- [ ] **Step 3: The converter that does the actual work**

`src/lib/tiptap-blocks.ts` — `blocksToTiptap` and `tiptapToBlocks`, pure and fully tested. The mismatches worth naming, each of which needs its own test:

| Strapi blocks | TipTap | Note |
|---|---|---|
| soft break as `"\n"` **inside** a text leaf | `hardBreak` **node** | Verified: `RichTextInline` splits `\n` into `<br>`. Round-tripping must not turn one paragraph into two. |
| `list` + `format: "ordered"\|"unordered"` | `orderedList` / `bulletList` | Two node types, one Strapi type plus an attribute |
| `list-item` children mix inline and nested `list` | `listItem` wraps `paragraph` + nested list | TipTap always wraps item text in a paragraph; Strapi does not |
| marks as **boolean keys on the leaf** | `marks: [{type}]` **array** | |
| `link` is a **node with children** | `link` is a **mark** | Structural, not cosmetic — the most error-prone direction |
| `heading.level` 1–6 | `heading.attrs.level` | Clamp to 2–4 both ways |
| `code` block children joined with `"\n"` | `codeBlock` with a text node | |
| `image` block | *not offered* | Must survive a round trip untouched |

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

That is **15 round-trip cases plus 10 mismatch tests = 25**.

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

Expected: **25 tests**, 0 errors, and a build that succeeds — the build is the gate that catches an import the dev server tolerated.

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

```diff
- if (description) payload.description = textToBlocks(description);
+ const description = fromRichTextField(fd, "description");
+ if (description !== null) payload.description = description;
```

Same shape in `news-form.ts` for `body`. Note the change from `if (description)` to `if (description !== null)`: the old test was falsy, so an emptied field was silently dropped rather than cleared.

- [ ] **Step 2: The three components render `RichTextField`**

Replace the `<FormField type="textarea">` for `description` / `body` in all three. `PageSectionForm` passes `section.values[name]` as text and the raw blocks when the API supplies them — which means `getPage` must now return the **blocks**, not just the flattened text, for body fields.

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

**Do not delete `isPlainBlocks` itself.** It keeps one job: deciding whether the **no-JS textarea** is safe to offer. Without JavaScript the only editor is a textarea, and saving a rich document through it still flattens it. So `readOnlyReason: 'rich-body'` survives as a *no-script* concern, expressed with a `<noscript>` block in `RichTextField` rather than a server-side lock — the server can no longer know whether the client will have an editor.

State plainly in the plan's own limitations that this trades a hard guarantee for a softer one: before, rich content could not be flattened by this UI at all; after, it can be flattened by someone who saves with JavaScript disabled. The `<noscript>` warning is what makes that visible, and it is weaker than a lock.

- [ ] **Step 5: Full suites**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **267 CMS**, **137 frontend** (90 + 7 agreement + 8 payload + 7 render + 25 tiptap), 0 typecheck errors.

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

Reuse plan 5's `/tmp/p5-copy.sql`. Expected: **267 CMS**, **137 frontend**, `pages_cmps` byte-identical, all component copy identical.

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

- **267 CMS and 137 frontend tests green**, CMS twice, `pages_cmps` byte-identical.
- A chapter admin writes a heading, a list, a bold word and a link, and the **public microsite renders all four**.
- Reopening the form shows the **document**, not flattened text.
- A `javascript:` URL posted directly to the API is stripped while its text survives — proven by an integration test, not only by the UI refusing to offer it.
- **With JavaScript disabled**, every form still submits and saves, and a `<noscript>` warning says what will be lost.
- The two `textToBlocks` implementations are pinned together by a test.
- `tiptapToBlocks(blocksToTiptap(b))` deep-equals `b` across a 15-case corpus covering every allowed block type, every mark, nesting, links and soft breaks.
- Plan 5's rich-body lock is gone and its tests assert the new behaviour.
- All six sanitiser mutations are killed.

## Known limitations, accepted

- **Saving with JavaScript disabled still flattens a rich document.** This plan trades plan 5's hard server-side lock for a `<noscript>` warning, because the server cannot know whether the client will have an editor. That is strictly weaker, and it is the price of making rich content editable at all.
- **No images in the editor.** Existing image blocks survive; new ones need the upload flow.
- **TipTap plus ProseMirror is a large bundle** on three authoring screens. It is not loaded on any public page. If it becomes a problem, the fix is a dynamic import behind a "Format" button, not a smaller editor.
- **`sanitiseBlocks` is an allow-list of what `RichText.astro` renders today.** Adding a renderer case without adding it here means content that stores and never appears; adding it here without the renderer means the reverse. They must move together, and nothing enforces that.
- **No sanitisation of what national writes** through Strapi's own admin panel. They are trusted, and their content is not client-supplied JSON — but it is the same column, and a compromised national account is a different threat model than this plan addresses.
- **`FAQ.answer` and `FAQItem.answer`** remain unreachable from any chapter-admin screen.
