# Plan 5: `/page` — chapter admins edit their microsite copy

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a chapter admin edit the **text** on their microsite — section headings, body copy, the contact form's intro — without being able to reorder, add, remove, or otherwise restructure the page.

**Architecture:** No dynamic zone is ever written. Each save updates **one component row by id**, at both draft and published status, exactly as plan 4 does for the partner-group relation. `page.components` is never assigned, so replace-on-write cannot bite.

Draft and published components are paired by **position within the zone**, and position alone is not trustworthy. A type-sequence check catches structural divergence, but it is **strictly weaker than it sounds**: same length plus same type sequence plus different components is undetectable, and a chapter zone holds three consecutive `shared.member-group` components, so a same-type reorder produces a wrong-but-plausible pairing. That was reproduced against the real database — an admin edited "Board of Directors" and the public site's "Executive Committee" heading changed, reporting full success.

So the published write is gated on **content parity**, not on structure: before writing the published row, its current values for the fields being written must equal the **pre-edit draft** values. If they differ, the two rows are not the same component — or they are the same component carrying an unpublished national edit — and in both cases writing published is wrong. The write then reaches the draft alone and reports `wrote: 1`, which the screen surfaces as "your live page has not changed".

This single guard closes three separate defects: the same-type reorder above; a draft-only edit by national being silently published by a chapter admin's unrelated save; and a rich published body being flattened because the guard read the draft.

**Tech Stack:** Strapi 5.45.1 (CJS services, `db.query` for component rows), Astro 6.4.2 (SSR, `experimental_AstroContainer` for render tests), Vitest, supertest.

---

## What this plan is not

Earlier plans deferred `/page` with language that no longer describes it:

> **`/page`** — the fixed-template microsite editor and its dynamic-zone positional merge. **Plan 5, alone.** This plan writes a relation *inside* one component and never touches the zone; `/page` rewrites the zone itself.

**`/page` no longer rewrites the zone.** Scope was narrowed to text-only, fixed order, which removes the positional merge from the write path entirely and makes this plan roughly the size of plan 4 rather than twice it. Adding, removing and reordering sections stays national and is not in this plan.

Position still matters in one place — **pairing** a draft component with its published counterpart on read — and that is a comparison, not a merge. It gets a guard and its own tests.

---

## Scope

**In:**

- `GET /chapter-admin/page?chapterSlug=` — the chapter's home page zone, with the editable text of each component and a per-component reason when something is not editable.
- `PUT /chapter-admin/page` — save one component's text, at both statuses.
- A per-type **editable-field whitelist**. `title` everywhere; `body` on hero/section/partner-callout; `intro` and `submitLabel` on contact-form; `caption` on video-embed.
- A **plain-blocks guard**: `body` is editable only when the stored blocks are plain paragraphs with no marks. `blocksToPlainText` is lossy by its own admission, so a round-trip through a textarea would silently strip a national author's bold, links and headings.
- `/account/chapter/[chapterSlug]/page` — one form per editable component, in zone order, JavaScript optional.

**Not in:**

- **Adding, removing or reordering components.** Chosen deliberately. It is the only thing that requires writing the zone, and the zone is replace-on-write.
- **Media.** No `figure`, no `photos`. Uploads exist (`/chapter-admin/media`) but swapping a hero image is a different screen with a different failure mode.
- **Relations.** `members`, `partners`, `events`, `newsItems`, `resources` are edited on their own screens; `partners` got plan 4.
- **Nested components.** `primaryCta`/`secondaryCta` (`shared.cta`), `fields` (`shared.form-field`), `items` (`shared.faq-item`). Each is a repeatable sub-editor and belongs with whatever plan gives it a UI.
- **`notificationEmails`, `videoUrl`, `feedUrl`, `platform`.** Configuration rather than copy. `notificationEmails` is a staff routing address and must never reach the browser; the others change what is embedded, not what is written.
- **Rich text.** Plan 6 (TipTap and real converters). Until then `body` is a plain textarea and the guard above stops it destroying anything.
- **National pages.** `/page` edits the chapter's own `home` page only.

---

## Preconditions

**1. Branch.** Trunk-based; commit to `main` in both repos.

**2. Baselines, measured immediately before writing this plan.**

| | Tests | Files |
|---|---|---|
| `areaa-cms` | **175** | 15 |
| `areaa-frontend` | **75** | 10 |

`api::chapter-admin%` permissions: **23**.

**Plan 5 and plan 7 are independent and touch no common file** — verified by diffing their `**Files:**` lists in both repos. `ChapterAdminLayout.astro` appears nowhere in plan 7, and although both mention `shared.contact-form` they treat different fields from different directions.

Two caveats that follow from that, and belong here because this plan is the one asserting the independence:

- **Whichever runs second inherits the other's totals.** If plan 7 has already landed, add its **+42 CMS / +25 frontend** to every expected number below. Plan 7 contains no reciprocal note, so if **plan 5** lands first its baseline table and every gate are wrong — tell whoever executes plan 7, or amend it.
- **Plan 7 Task 8 runs a blanket `git add src/pages/`**, which would sweep this plan's `src/pages/api/chapter-admin/page.ts` and `src/pages/account/chapter/[chapterSlug]/page.astro` into plan 7's commit if they are uncommitted at that moment. Commit this plan's work before starting plan 7's Chunk 4.

**3. Every CMS command needs `cd /Users/nk/Projects/AREAA/areaa-cms`** and every frontend command `cd /Users/nk/Projects/AREAA/areaa-frontend`. A missing `cd` in plan 4 made the headline gate run the wrong repo's suite.

**4. `PATH="/opt/homebrew/bin:$PATH"`** on CMS test and boot commands (sqlite3).

**5. Test accounts.** `chapadmin@areaa.test` / `Password123!` administers `aloha-hawaii`. `twochapter@areaa.test` administers `aloha-hawaii` and `greater-chicago`. `pdx` has **no home page** and is the fixture for the 404 branch.

**6. Astro form POSTs need a matching `Origin` header** when driven by curl; `checkOrigin` is on.

**7. `.tmp/data.db` is untracked and this plan edits live microsite copy.** Snapshot before the browser walkthrough and restore with a script, not by hand.

---

## Verified assumptions

Executed against the installed Strapi 5.45.1 and the seeded database on 2026-08-10.

| Assumption | Verdict |
|---|---|
| Every shared component has a `title:string` | ✅ All 12 inspected |
| `body:blocks` exists on **hero, section, partner-callout** only | ✅ |
| `contact-form` has `intro:text` and `submitLabel:string`; `video-embed` has `caption:string` | ✅ |
| `contact-form.notificationEmails` is a plain string on the component | ✅ Must be excluded from both the whitelist and the API response |
| A chapter home zone holds **11 components** | ✅ aloha, boston and greater-chicago all 11 |
| A zone can hold **several components of the same type** | ✅ aloha's zone has **three** `shared.member-group` (cmp 86, 87, 88). Pairing by type alone is therefore ambiguous — position is required. |
| Draft and published zones have **identical type sequences** on all three chapters | ✅ Verified per chapter — **but this is NOT sufficient for safe pairing.** Same length and same type sequence with different components is undetectable; reproduced by reordering aloha's member-groups. Structure parity is a necessary condition, not a sufficient one. |
| Draft and published component **content** can differ | ⚠️ **It differs today, and the first version of this plan missed it.** aloha's draft hero title is `Chorp Chipper`; its published hero is `Our Chapter` — an unpublished national edit. Any save that writes both statuses unconditionally would *publish* that edit as a side effect. This is why the published write is gated on content parity. |
| Draft/published component ids pair consecutively | ✅ aloha `(3,4) (45,46) (19,20) (37,38) …` — but the plan pairs by **position**, never by `id+1`, because consecutive ids are an artefact of seeding order |
| `blocksToPlainText` is **lossy by design** | ✅ Its own docstring: "flattens whatever the CMS holds (headings, lists, links) down to lines". `textToBlocks` emits paragraphs only. |
| Rich `body` content **exists in the database today** | ⚠️ Partly. `components_shared_sections` id 4 and 5 carry **`bold: true` marks only** — there are **no link nodes anywhere in the database**, contrary to this plan's first version. Neither row is on a page, so the guard is not reachable through the UI with this seed — **the walkthrough must plant one to exercise it** (Task 8, Step 3). |
| `db.query(type).findOne()` returns `body` as a **parsed array**, not a JSON string | ✅ Verified. The whole rich-body guard depends on it and the first version never stated it. |
| `documents().findFirst({ populate: { components: true } })` returns components **in `order` sequence** at both statuses | ✅ Verified. `pairZones` depends on it and does not sort defensively. |
| `pdx` has no home page | ✅ Confirmed in plan 4 and unchanged |
| Plan 4's `findPartnerGroups` already establishes "write the component row by id at both statuses" | ✅ `src/api/chapter-admin/services/partners.js`; this plan generalises the same shape |
| `db.query('shared.<type>').update({ where: { id }, data })` writes a component row without touching its page | ✅ Proven by plan 4's partner-group writes and its byte-identical `pages_cmps` check |
| `blocks.ts`'s header comment says TipTap arrives in "plan 4" | ✅ Stale — it is plan 6. Fixed in Task 5. |

---

## Chunk 1: The page-content service

Pure functions and one lookup, so every rule is testable without HTTP.

### Task 1: The editable whitelist and the plain-blocks guard

**Files:** Create `src/api/chapter-admin/services/page-content.js`, `tests/unit/page-content.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// One createRequire so BadInputError is the SAME class the service throws.
const require = createRequire(import.meta.url);
const {
  EDITABLE_BY_TYPE, editableFieldsFor, isPlainBlocks, textToBlocks, blocksToText,
  shapeComponentEdit, pairZones, sameForFields,
} = require('../../src/api/chapter-admin/services/page-content.js');
const { BadInputError } = require('../../src/api/chapter-admin/services/fields.js');

const para = (text) => ({ type: 'paragraph', children: [{ type: 'text', text }] });

describe('editableFieldsFor', () => {
  it('offers title everywhere', () => {
    for (const type of Object.keys(EDITABLE_BY_TYPE)) {
      expect(editableFieldsFor(type)).toContain('title');
    }
  });

  it('offers body only where a body exists', () => {
    expect(editableFieldsFor('shared.hero')).toContain('body');
    expect(editableFieldsFor('shared.section')).toContain('body');
    expect(editableFieldsFor('shared.gallery')).not.toContain('body');
  });

  it('offers the contact form its intro and submit label', () => {
    expect(editableFieldsFor('shared.contact-form').sort())
      .toEqual(['intro', 'submitLabel', 'title']);
  });

  it('NEVER offers notificationEmails', () => {
    // A staff routing address. Editable here would also mean readable in the
    // API response, and from there rendered into a page.
    expect(editableFieldsFor('shared.contact-form')).not.toContain('notificationEmails');
    for (const fields of Object.values(EDITABLE_BY_TYPE)) {
      expect(fields).not.toContain('notificationEmails');
    }
  });

  it('never offers a relation, a media field or a nested component', () => {
    const banned = ['members', 'partners', 'events', 'newsItems', 'resources',
                    'figure', 'photos', 'primaryCta', 'secondaryCta', 'fields', 'items'];
    for (const fields of Object.values(EDITABLE_BY_TYPE)) {
      for (const b of banned) expect(fields).not.toContain(b);
    }
  });

  it('never offers embed configuration', () => {
    // Changing a feed URL changes what is embedded, not what is written.
    expect(editableFieldsFor('shared.video-embed')).not.toContain('videoUrl');
    expect(editableFieldsFor('shared.social-media-feed')).not.toContain('feedUrl');
    expect(editableFieldsFor('shared.social-media-feed')).not.toContain('platform');
  });

  it('returns an empty list for a type it does not know', () => {
    // A component added to the CMS later must render read-only, not crash and
    // not become silently editable.
    expect(editableFieldsFor('shared.brand-new-thing')).toEqual([]);
  });

  it('agrees with the actual component schemas on disk', () => {
    // The hand-written banned-lists above are self-consistency checks: they
    // assert the map against itself. THIS reads the real schemas, so it catches
    // the next component national adds, a field that gets renamed, and a
    // whitelisted field that is secretly a relation.
    const require2 = createRequire(import.meta.url);
    const page = require2('../../src/api/page/content-types/page/schema.json');
    const zone = page.attributes.components.components;   // the dynamiczone list

    expect(Object.keys(EDITABLE_BY_TYPE).sort()).toEqual([...zone].sort());

    for (const [type, fields] of Object.entries(EDITABLE_BY_TYPE)) {
      const file = type.replace('shared.', '');
      const schema = require2(`../../src/components/shared/${file}.json`);
      for (const field of fields) {
        const attr = schema.attributes[field];
        expect(attr, `${type}.${field} must exist`).toBeTruthy();
        // Text only. A relation, media or nested component slipping in here is
        // exactly how a "text edit" screen starts clearing a roster.
        expect(['string', 'text', 'blocks']).toContain(attr.type);
      }
    }
  });
});

describe('isPlainBlocks', () => {
  it('accepts plain paragraphs', () => {
    expect(isPlainBlocks([para('One'), para('Two')])).toBe(true);
  });

  it('accepts an empty body', () => {
    expect(isPlainBlocks([])).toBe(true);
    expect(isPlainBlocks(null)).toBe(true);
  });

  it('REJECTS a paragraph carrying marks', () => {
    // The live case: sections 4 and 5 hold link/bold marks. A textarea
    // round-trip would strip them and nobody would be told.
    expect(isPlainBlocks([
      { type: 'paragraph', children: [{ type: 'text', text: 'Hi', bold: true }] },
    ])).toBe(false);
  });

  it('REJECTS a link child', () => {
    expect(isPlainBlocks([
      { type: 'paragraph', children: [{ type: 'link', url: 'http://x', children: [] }] },
    ])).toBe(false);
  });

  it('REJECTS headings and lists', () => {
    expect(isPlainBlocks([{ type: 'heading', level: 2, children: [] }])).toBe(false);
    expect(isPlainBlocks([{ type: 'list', children: [] }])).toBe(false);
  });

  it('rejects a non-array rather than assuming it is safe', () => {
    expect(isPlainBlocks('nope')).toBe(false);
    expect(isPlainBlocks({ type: 'paragraph' })).toBe(false);
  });
});

describe('shapeComponentEdit', () => {
  it('keeps only the fields the type allows', () => {
    expect(shapeComponentEdit({ title: 'T', intro: 'I' }, 'shared.contact-form'))
      .toEqual({ title: 'T', intro: 'I' });
  });

  it('DROPS a field the type does not allow', () => {
    const out = shapeComponentEdit(
      { title: 'T', notificationEmails: 'me@evil.example', partners: ['p1'] },
      'shared.contact-form');
    expect(out).toEqual({ title: 'T' });
  });

  it('converts body text to paragraph blocks', () => {
    const out = shapeComponentEdit({ body: 'Line one\nLine two' }, 'shared.section');
    expect(out.body).toEqual([para('Line one'), para('Line two')]);
  });

  it('allows clearing an optional text field', () => {
    expect(shapeComponentEdit({ title: '' }, 'shared.section')).toEqual({ title: '' });
  });

  it('omits a field the payload did not carry, rather than blanking it', () => {
    // The form posts one component at a time; an absent field means unchanged.
    expect(shapeComponentEdit({ title: 'T' }, 'shared.section')).not.toHaveProperty('body');
  });

  it('400s a body longer than the cap', () => {
    expect(() => shapeComponentEdit({ body: 'x'.repeat(20001) }, 'shared.section'))
      .toThrow(BadInputError);
  });

  it('400s a non-string value', () => {
    expect(() => shapeComponentEdit({ title: { a: 1 } }, 'shared.section')).toThrow(BadInputError);
  });

  it('400s when nothing editable was submitted', () => {
    // Otherwise the route writes {} and reports success having changed nothing.
    expect(() => shapeComponentEdit({ partners: ['p1'] }, 'shared.section')).toThrow(BadInputError);
  });
});

// blocksToText fills EVERY textarea on the screen and the first version of this
// plan specified it in one sentence of prose, with no implementation and no
// test. The render tests use literal fixtures, so a broken one is invisible
// there — and combines with a blank textarea into silent body loss on save.
describe('blocksToText', () => {
  it('joins paragraphs with newlines', () => {
    expect(blocksToText([para('One'), para('Two')])).toBe('One\nTwo');
  });

  it('returns an empty string for an empty or absent body', () => {
    expect(blocksToText([])).toBe('');
    expect(blocksToText(null)).toBe('');
    expect(blocksToText(undefined)).toBe('');
  });

  it('survives a non-array rather than throwing into a 500', () => {
    expect(blocksToText('nope')).toBe('');
  });

  it('ROUND-TRIPS every shape isPlainBlocks accepts', () => {
    // The property the whole guard exists to guarantee, and the first version
    // asserted it nowhere. If a shape passes isPlainBlocks but does not survive
    // blocksToText -> textToBlocks, the guard is a lie and an unedited save
    // silently rewrites the body.
    const shapes = [
      [],
      [para('One')],
      [para('One'), para('Two')],
      [para('Trailing space is trimmed on write')],
    ];
    for (const blocks of shapes) {
      expect(isPlainBlocks(blocks)).toBe(true);
      expect(textToBlocks(blocksToText(blocks))).toEqual(blocks);
    }
  });

  it('does NOT accept a spacer paragraph, because it cannot round-trip one', () => {
    // blocksToText drops empty lines and textToBlocks filters falsy ones, so an
    // unedited GET->PUT would delete a deliberate spacer. Rejecting it as rich
    // keeps the guard honest: anything isPlainBlocks accepts is safe.
    expect(isPlainBlocks([para('One'), para(''), para('Two')])).toBe(false);
    expect(isPlainBlocks([para('   ')])).toBe(false);
  });
});

// The published write is gated on this, so it carries the plan's central
// safety property.
describe('sameForFields', () => {
  it('is true when every compared field matches', () => {
    expect(sameForFields({ title: 'A', intro: 'B' }, { title: 'A', intro: 'B' },
      ['title', 'intro'])).toBe(true);
  });

  it('is false when any compared field differs', () => {
    // aloha's hero today: draft "Chorp Chipper", published "Our Chapter".
    expect(sameForFields({ title: 'Chorp Chipper' }, { title: 'Our Chapter' },
      ['title'])).toBe(false);
  });

  it('ignores fields not being written', () => {
    expect(sameForFields({ title: 'A', caption: 'x' }, { title: 'A', caption: 'y' },
      ['title'])).toBe(true);
  });

  it('compares blocks by value, not by reference', () => {
    expect(sameForFields({ body: [para('One')] }, { body: [para('One')] }, ['body'])).toBe(true);
    expect(sameForFields({ body: [para('One')] }, { body: [para('Two')] }, ['body'])).toBe(false);
  });

  it('treats null and empty string as the same absence', () => {
    // Strapi returns NULL for a never-set column and '' for a cleared one;
    // treating those as a divergence would make the published write
    // permanently unreachable on any component with an unset optional field.
    expect(sameForFields({ title: null }, { title: '' }, ['title'])).toBe(true);
  });
});

describe('pairZones', () => {
  const zone = (types) => types.map((t, i) => ({ __component: t, id: 100 + i, order: i }));

  it('pairs positionally, not by type', () => {
    // Three member-groups sit on a real chapter zone; matching by type alone
    // would pair the wrong ones.
    const d = zone(['shared.hero', 'shared.member-group', 'shared.member-group']);
    const p = d.map((c) => ({ ...c, id: c.id + 50 }));
    expect(pairZones(d, p)).toEqual([
      { draftId: 100, publishedId: 150, type: 'shared.hero', index: 0 },
      { draftId: 101, publishedId: 151, type: 'shared.member-group', index: 1 },
      { draftId: 102, publishedId: 152, type: 'shared.member-group', index: 2 },
    ]);
  });

  it('returns null when the type sequences differ', () => {
    // The draft has been restructured without publishing. Writing published by
    // position would put a hero's text into a gallery.
    expect(pairZones(zone(['shared.hero', 'shared.section']),
                     zone(['shared.section', 'shared.hero']))).toBeNull();
  });

  it('returns null when the lengths differ', () => {
    expect(pairZones(zone(['shared.hero', 'shared.section']), zone(['shared.hero']))).toBeNull();
  });

  it('pairs the draft alone when there is no published zone', () => {
    // A page that has never been published is legitimate; draft-only writes
    // are correct there.
    const d = zone(['shared.hero']);
    expect(pairZones(d, null)).toEqual([
      { draftId: 100, publishedId: null, type: 'shared.hero', index: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/page-content.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

const { BadInputError } = require('./fields');

/** Body text cap. Generous — this is a page section, not a tweet. */
const MAX_BODY_LEN = 20000;

/**
 * Cap for single-line text, checked against what is actually stored: the
 * longest seeded values are `intro` 51, titles 33, `caption` 32.
 *
 * It matters that this is not tight. The form posts EVERY editable field of a
 * section at once, so a cap below an existing value would make that section
 * permanently unsaveable -- including its title. 500 was the first version's
 * number and was never checked against the content it applies to.
 */
const MAX_TEXT_LEN = 2000;

/**
 * What a chapter admin may edit, per component type.
 *
 * TEXT ONLY, and deliberately narrow. Everything absent from this map is
 * absent on purpose:
 *
 *  - `notificationEmails` is a staff routing address. Editable here would mean
 *    readable in the API response and from there rendered into a page.
 *  - `videoUrl`, `feedUrl`, `platform` change what is EMBEDDED, not what is
 *    written. A chapter admin repointing an embed is a different decision from
 *    fixing a typo.
 *  - relations (`members`, `partners`, `events`, `newsItems`, `resources`) have
 *    their own screens; `partners` got plan 4.
 *  - media (`figure`, `photos`) needs the upload flow and its own failure modes.
 *  - nested components (`primaryCta`, `fields`, `items`) are repeatable
 *    sub-editors, each its own piece of UI.
 *
 * A type missing from this map renders READ-ONLY. That is the safe default for
 * a component added to the CMS after this plan shipped.
 */
const EDITABLE_BY_TYPE = {
  'shared.hero': ['title', 'body'],
  'shared.section': ['title', 'body'],
  'shared.partner-callout': ['title', 'body'],
  'shared.contact-form': ['title', 'intro', 'submitLabel'],
  'shared.video-embed': ['title', 'caption'],
  'shared.gallery': ['title'],
  'shared.upcoming-events': ['title'],
  'shared.news-and-resources': ['title'],
  'shared.member-group': ['title'],
  'shared.partner-group': ['title'],
  'shared.social-media-feed': ['title'],
  'shared.faq': ['title'],
};

const BLOCK_FIELDS = new Set(['body']);

function editableFieldsFor(type) {
  return EDITABLE_BY_TYPE[type] ?? [];
}

/**
 * Is this `blocks` value something a plain textarea can round-trip losslessly?
 *
 * `blocksToPlainText` says of itself that it flattens headings, lists and links
 * down to lines, and `textToBlocks` emits paragraphs only. So editing anything
 * richer through the textarea SILENTLY DESTROYS a national author's formatting.
 * Components failing this check render read-only until plan 6 brings a real
 * editor.
 *
 * Rich content exists today: `components_shared_sections` 4 and 5 carry marks.
 */
function isPlainBlocks(blocks) {
  if (blocks === null || blocks === undefined) return true;
  if (!Array.isArray(blocks)) return false;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') return false;
    if (block.type !== 'paragraph') return false;

    let text = '';
    for (const child of block.children ?? []) {
      if (!child || typeof child !== 'object') return false;
      if (child.type !== 'text') return false;          // links, images, anything else
      // Any mark at all — bold, italic, underline, strikethrough, code.
      // `bold: false` counts too: some serialisers emit explicit false marks
      // after a toggle, and this errs toward read-only rather than toward loss.
      for (const key of Object.keys(child)) {
        if (key !== 'type' && key !== 'text') return false;
      }
      text += child.text ?? '';
    }

    // Must survive blocksToText -> textToBlocks unchanged. A blank or
    // whitespace-only paragraph is a deliberate spacer that both functions
    // drop, so an UNEDITED save would delete it. Rejecting it here keeps the
    // guard's promise literally true: anything this accepts is safe to edit.
    if (text.trim() === '') return false;
  }
  return true;
}

/**
 * Blocks -> the text a textarea shows. The inverse of textToBlocks for every
 * shape isPlainBlocks accepts; see the round-trip test, which is the property
 * the rich-body guard actually rests on.
 */
function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (b?.children ?? []).map((c) => c?.text ?? '').join(''))
    .join('\n');
}

/**
 * Do these two component rows agree on the fields about to be written?
 *
 * This is what gates the published write. Position plus type is not proof two
 * rows are the same component, and an unpublished national edit is not a
 * mispairing but must be treated the same way -- hands off published.
 *
 * NULL and '' compare equal: Strapi returns NULL for a never-set optional
 * column and '' for a cleared one, and treating that as divergence would make
 * the published write permanently unreachable on ordinary content.
 */
function sameForFields(a, b, fields) {
  const norm = (v) => (v === null || v === undefined ? '' : v);
  for (const field of fields) {
    if (JSON.stringify(norm(a?.[field])) !== JSON.stringify(norm(b?.[field]))) return false;
  }
  return true;
}

/** Plain text -> paragraph blocks. Mirrors the frontend's textToBlocks. */
function textToBlocks(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: 'paragraph', children: [{ type: 'text', text: line }] }));
}

/**
 * Submitted values -> the data written to ONE component row.
 *
 * Absent means unchanged: the form edits one component at a time, so a missing
 * key is "not on this form", not "clear it". Present-and-empty DOES clear,
 * because these are optional strings and an admin removing a heading is a
 * legitimate edit.
 */
function shapeComponentEdit(input, type) {
  const allowed = editableFieldsFor(type);
  const data = {};

  for (const field of allowed) {
    if (!(field in input)) continue;

    const raw = input[field];
    if (raw !== null && typeof raw === 'object') {
      throw new BadInputError(`${field} must be text`);
    }
    const text = raw === null || raw === undefined ? '' : String(raw);

    if (BLOCK_FIELDS.has(field)) {
      if (text.length > MAX_BODY_LEN) throw new BadInputError(`${field} is too long`);
      data[field] = textToBlocks(text);
    } else {
      if (text.length > MAX_TEXT_LEN) throw new BadInputError(`${field} is too long`);
      data[field] = text.trim();
    }
  }

  if (Object.keys(data).length === 0) {
    // Without this the route writes {}, returns 200, and the admin believes a
    // save happened.
    throw new BadInputError('Nothing editable was submitted');
  }
  return data;
}

/**
 * Pair each draft component with its published counterpart, BY POSITION.
 *
 * Position, not type: a real chapter zone holds three `shared.member-group`
 * components, so type is ambiguous. Not `id + 1` either — consecutive ids are
 * an artefact of seeding order, not a guarantee.
 *
 * Returns null when the two zones have different shapes. That happens when the
 * draft has been restructured and not published, and writing published by
 * position would then put one component's text into another. The caller must
 * degrade to a draft-only write and say so, never guess.
 */
function pairZones(draft, published) {
  const d = draft ?? [];
  if (!published) {
    return d.map((c, index) => ({
      draftId: c.id, publishedId: null, type: c.__component, index,
    }));
  }
  if (published.length !== d.length) return null;
  for (let i = 0; i < d.length; i += 1) {
    if (d[i].__component !== published[i].__component) return null;
  }
  return d.map((c, index) => ({
    draftId: c.id, publishedId: published[index].id, type: c.__component, index,
  }));
}

module.exports = {
  EDITABLE_BY_TYPE, editableFieldsFor, isPlainBlocks, textToBlocks, blocksToText,
  shapeComponentEdit, pairZones, sameForFields, MAX_BODY_LEN, MAX_TEXT_LEN,
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/page-content.test.js
```

Expected: PASS, **36 tests** — 8 whitelist (incl. the schema-derived one), 8 plain-blocks, 5 blocksToText/round-trip, 5 sameForFields, 6 shaping, 4 pairing.

- [ ] **Step 5: Mutation-check the two guards that carry weight**

Both of these exist because removing them causes silent data loss, so prove they can fail:

Write `scripts/mutate-page-content.sh`, so each mutation **asserts that it
applied** before running. A silently unmatched replacement is indistinguishable
from an uncaught mutation, and the first version of this plan shipped exactly
that.

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && cat > /tmp/mutate.py <<'EOF'
import subprocess, shutil, sys
SRC = 'src/api/chapter-admin/services/page-content.js'
MUTATIONS = [
    # (label, find, replace) -- each must kill at least one test
    ('let marks through',        "        if (key !== 'type' && key !== 'text') return false;", '        continue;'),
    ('ignore type sequence',     "    if (d[i].__component !== published[i].__component) return null;", ''),
    ('sameForFields always true', "    if (JSON.stringify(norm(a?.[field])) !== JSON.stringify(norm(b?.[field]))) return false;", ''),
    ('accept any block type',    "    if (block.type !== 'paragraph') return false;", ''),
]
shutil.copy(SRC, '/tmp/pc.bak')
failed = []
for label, old, new in MUTATIONS:
    src = open('/tmp/pc.bak').read()
    assert old in src, f'MUTATION DID NOT APPLY: {label}'
    open(SRC, 'w').write(src.replace(old, new, 1))
    r = subprocess.run(['npx', 'vitest', 'run', 'tests/unit/page-content.test.js'],
                       capture_output=True, text=True)
    killed = r.returncode != 0
    print(f'{"KILLED " if killed else "SURVIVED"}  {label}')
    if not killed:
        failed.append(label)
shutil.copy('/tmp/pc.bak', SRC)
sys.exit(1 if failed else 0)
EOF
PATH="/opt/homebrew/bin:$PATH" python3 /tmp/mutate.py && \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/unit/page-content.test.js 2>&1 | grep "Tests "
```

Expected: **four `KILLED` lines**, then the full file passing again. A `SURVIVED`
line means that test is decorative and the guard it names is unprotected.

Do **not** mutate `if (child.type !== 'text') return false;` — it is an
*equivalent mutant*. A link node `{type:'link', url, children}` still trips the
key-whitelist loop on `url`, so removing the line changes nothing and the gate
can never go red. Verified by execution; the first version of this plan made it
mutation 1 and an executing agent would have hard-stopped on a gate that cannot
be satisfied.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/page-content.js tests/unit/page-content.test.js && \
  git commit -m "feat: page text whitelist, plain-blocks guard and zone pairing"
```

---

### Task 2: Locating the zones

**Files:** Modify `src/api/chapter-admin/services/page-content.js`, `tests/unit/page-content.test.js`

Generalises plan 4's `findPartnerGroups` from one component type to the whole zone.

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('findPageZones', () => {
  const cmp = (type, id) => ({ __component: type, id });
  // HONOURS the filters. A stub that ignores them cannot catch a lookup that
  // drops `chapter: { slug }` or asks for the wrong page, and the first version
  // of this plan shipped exactly that: removing the chapter filter left all
  // five tests passing.
  const stub = (pages, seen = []) => ({
    seen,
    documents: (uid) => ({
      findFirst: async ({ filters, status }) => {
        seen.push({ uid, filters, status });
        if (uid !== 'api::page.page') return null;
        if (filters?.slug !== 'home') return null;
        if (filters?.chapter?.slug !== pages.__slug) return null;
        return pages[status] ?? null;
      },
    }),
  });

  it('reports no-home-page when neither status has one', async () => {
    // `pdx` is this chapter today.
    expect(await findPageZones(stub({ __slug: 'pdx' }), 'pdx')).toEqual({ error: 'no-home-page' });
  });

  it('asks for THIS chapter\'s home page, not just any home page', async () => {
    const seen = [];
    await findPageZones(stub({ __slug: 'aloha-hawaii' }, seen), 'aloha-hawaii');
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.uid).toBe('api::page.page');
      expect(call.filters.slug).toBe('home');
      expect(call.filters.chapter.slug).toBe('aloha-hawaii');
    }
  });

  it('returns paired components when both zones agree', async () => {
    const res = await findPageZones(stub({
      __slug: 'aloha-hawaii',
      draft: { documentId: 'pg1', components: [cmp('shared.hero', 3)] },
      published: { documentId: 'pg1', components: [cmp('shared.hero', 4)] },
    }), 'aloha-hawaii');
    expect(res.pairs).toEqual([
      { draftId: 3, publishedId: 4, type: 'shared.hero', index: 0 },
    ]);
    expect(res.structureDiverged).toBe(false);
  });

  it('flags divergence and falls back to draft-only pairing', async () => {
    // The admin restructured the draft and did not publish. Writing published
    // by position would put the hero's text into the gallery.
    const res = await findPageZones(stub({
      __slug: 'aloha-hawaii',
      draft: { documentId: 'pg1', components: [cmp('shared.hero', 3), cmp('shared.gallery', 9)] },
      published: { documentId: 'pg1', components: [cmp('shared.gallery', 4)] },
    }), 'aloha-hawaii');
    expect(res.structureDiverged).toBe(true);
    expect(res.pairs.every((p) => p.publishedId === null)).toBe(true);
  });

  it('pairs draft-only for a page that has never been published', async () => {
    const res = await findPageZones(stub({
      __slug: 'greater-chicago',
      draft: { documentId: 'pg1', components: [cmp('shared.hero', 3)] },
    }), 'greater-chicago');
    expect(res.pairs[0].publishedId).toBeNull();
    expect(res.structureDiverged).toBe(false);   // not a divergence, just unpublished
  });

  it('requires the DRAFT zone, mirroring plan 4', async () => {
    // Published-only would mean editing against a zone the admin cannot see,
    // which is the shape of the bug plan 4's review caught in findPartnerGroups.
    expect(await findPageZones(stub({
      __slug: 'aloha-hawaii',
      published: { documentId: 'pg1', components: [cmp('shared.hero', 4)] },
    }), 'aloha-hawaii')).toEqual({ error: 'no-home-page' });
  });
});
```

Add `findPageZones` to the `require` destructuring at the top of the file.

- [ ] **Step 2: Implement**

```js
/**
 * The chapter's home page zone at both statuses, paired.
 *
 * The DRAFT zone is required — it is the editing surface, and plan 4's review
 * found the equivalent published-only path in `findPartnerGroups` was a live
 * data-loss bug. `structureDiverged` distinguishes "never published" (fine,
 * write draft only) from "draft restructured without publishing" (write draft
 * only AND tell the admin why the live site will not change).
 */
async function findPageZones(strapiInstance, chapterSlug) {
  const load = (status) => strapiInstance.documents('api::page.page').findFirst({
    filters: { slug: 'home', chapter: { slug: chapterSlug } },
    populate: { components: true },
    status,
  });

  const draft = await load('draft');
  if (!draft) return { error: 'no-home-page' };
  const published = await load('published');

  const paired = pairZones(draft.components ?? [], published?.components ?? null);

  if (paired === null) {
    // Shapes differ. Degrade to draft-only rather than guessing an alignment.
    return {
      pageDocumentId: draft.documentId,
      pairs: pairZones(draft.components ?? [], null),
      structureDiverged: true,
    };
  }
  return { pageDocumentId: draft.documentId, pairs: paired, structureDiverged: false };
}
```

Export it.

- [ ] **Step 3: Run and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/page-content.test.js
```

Expected: PASS, **42 tests** (36 + 6).

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/services/page-content.js tests/unit/page-content.test.js && \
  git commit -m "feat: locate a chapter home page's zones at both statuses"
```

---

## Chunk 2: The routes

### Task 3: `GET /chapter-admin/page` and `PUT /chapter-admin/page`

**Files:** Modify `controllers/chapter-admin.js`, `routes/chapter-admin.js`, `grants.js`, `services/page-content.js`

The controller needs:

```js
const {
  editableFieldsFor, isPlainBlocks, shapeComponentEdit, findPageZones,
  blocksToText, sameForFields,
} = require('../services/page-content');
```

- [ ] **Step 1: The read handler**

```js
  // --- page text ----------------------------------------------------------
  // Chapter admins edit COPY, never structure. Nothing here writes
  // `page.components`: dynamic zones are replace-on-write, so assigning the
  // array would rewrite every component including ones this screen never
  // rendered. Each save updates one component ROW by id, exactly as the
  // partner-group write does.
  getPage: guarded(async (ctx) => {
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, ctx.query.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const found = await findPageZones(strapi, chapter.slug);
    if (found.error === 'no-home-page') {
      return ctx.notFound('This chapter has no microsite page yet');
    }

    // Read each draft component row for its current values. The draft is what
    // the admin edits; published is only ever a write target.
    const sections = [];
    for (const pair of found.pairs) {
      const fields = editableFieldsFor(pair.type);
      const row = await strapi.db.query(pair.type).findOne({ where: { id: pair.draftId } });

      // `body` is editable only when a plain textarea can round-trip it.
      // blocksToPlainText flattens headings, lists and links, so offering a
      // textarea over rich content would silently strip a national author's
      // formatting on the next save.
      const bodyIsRich = fields.includes('body') && !isPlainBlocks(row?.body);
      const editable = bodyIsRich ? fields.filter((f) => f !== 'body') : fields;

      sections.push({
        index: pair.index,
        type: pair.type,
        draftId: pair.draftId,
        editable,
        readOnlyReason:
          editable.length === 0 ? 'not-editable' : bodyIsRich ? 'rich-body' : null,
        values: Object.fromEntries(
          editable.map((f) => [f, f === 'body' ? blocksToText(row?.body) : (row?.[f] ?? '')])),
      });
    }

    ctx.body = {
      data: sections,
      meta: { structureDiverged: found.structureDiverged },
    };
  }),
```

`blocksToText` is the CMS-side mirror of the frontend's `blocksToPlainText`; add it to `page-content.js` alongside `textToBlocks` so both directions live together.

- [ ] **Step 2: The write handler**

```js
  updatePage: guarded(async (ctx) => {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const { chapter, error, notFound } = await resolveScopedChapter(ctx, input.chapterSlug);
    if (error) return notFound ? ctx.notFound(error) : ctx.badRequest(error);

    const found = await findPageZones(strapi, chapter.slug);
    if (found.error === 'no-home-page') {
      return ctx.notFound('This chapter has no microsite page yet');
    }

    // Address the component by its POSITION in the zone, not by a raw component
    // id from the payload. A client-supplied id could name a component on
    // another chapter's page — position is meaningless outside this zone, so it
    // cannot be pointed anywhere else.
    //
    // Validate BEFORE coercing. `Number(null)`, `Number('')` and `Number(false)`
    // are all 0, and index 0 is the hero — so a dropped or malformed field
    // would rewrite the page's headline at both statuses and return 200.
    // Verified reachable: {index: null} rewrote the hero. The client-side
    // mapper guards this too, but the server is the boundary.
    if (typeof input.index !== 'number' && typeof input.index !== 'string') {
      return ctx.badRequest('No such section on this page');
    }
    const index = Number(input.index);
    if (!Number.isInteger(index) || index < 0) {
      return ctx.badRequest('No such section on this page');
    }
    const pair = found.pairs.find((p) => p.index === index);
    if (!pair) return ctx.badRequest('No such section on this page');

    const row = await strapi.db.query(pair.type).findOne({ where: { id: pair.draftId } });
    if (!row) return ctx.notFound('That section no longer exists');

    // Re-check the rich-body guard on WRITE, not just on read. The read that
    // built the form may be minutes old, and a national author may have added
    // formatting since.
    if ('body' in input && !isPlainBlocks(row.body)) {
      return ctx.badRequest(
        'That section now contains formatting this editor would remove. Reload the page.');
    }

    let data;
    try {
      data = shapeComponentEdit(input, pair.type);
    } catch (err) {
      if (err instanceof BadInputError) return ctx.badRequest(err.message);
      throw err;
    }

    // CONTENT PARITY gates the published write.
    //
    // Position plus matching type is not proof the two rows are the same
    // component: a zone holds three member-groups, and a same-type reorder in
    // the draft produces a pairing that looks perfect and is wrong. Reproduced
    // against real data — an admin edited "Board of Directors" and the public
    // site's "Executive Committee" heading changed, reporting wrote: 2.
    //
    // The same check also stops a chapter admin's unrelated save PUBLISHING an
    // unpublished national draft edit. aloha's hero is in exactly that state
    // today (draft "Chorp Chipper", published "Our Chapter").
    //
    // Compare the PRE-EDIT draft values, field by field, against the published
    // row. Equal => same component, safe to write both. Different => either a
    // mispairing or an unpublished edit, and both mean hands off published.
    let publishedId = pair.publishedId;
    let skipReason = null;
    if (publishedId !== null) {
      const pubRow = await strapi.db.query(pair.type).findOne({ where: { id: publishedId } });
      if (!pubRow || !sameForFields(row, pubRow, Object.keys(data))) {
        publishedId = null;
        skipReason = 'content-diverged';
      }
    } else {
      skipReason = found.structureDiverged ? 'structure-diverged' : 'never-published';
    }

    const targets = [pair.draftId, publishedId].filter((id) => id !== null);
    for (const id of targets) {
      await strapi.db.query(pair.type).update({ where: { id }, data });
    }

    ctx.body = {
      data: { index, type: pair.type, wrote: targets.length },
      // `skipReason` distinguishes the three ways a save reaches the draft only.
      // The screen must say WHICH — "contact national to publish" is wrong
      // advice for a page that has simply never been published.
      meta: { structureDiverged: found.structureDiverged, skipReason },
    };
  }),
```

**`wrote` is load-bearing, and `wrote: 1` is common rather than exceptional.** Any legitimate draft/published difference makes the published write unreachable — including aloha's hero today. A save that touched only the draft returns `wrote: 1` with a `skipReason`, and the screen must say the live site has not changed *and why*. Silently writing one row while implying both is the failure this plan is most likely to ship; telling the admin the wrong reason is the second.

| `skipReason` | Means | What the screen says |
|---|---|---|
| `null` | both rows written | "Section saved." |
| `never-published` | the page has no published version | "Saved. This page isn't published yet, so there's nothing live to update." |
| `structure-diverged` | draft and published zones differ in shape | "Saved to your draft. Your live page has unpublished structural changes — contact national to publish them." |
| `content-diverged` | this component differs between draft and published | "Saved to your draft. This section has unpublished changes from AREAA national, so your live page hasn't changed yet." |

- [ ] **Step 3: Routes and grants**

```js
    { method: 'GET', path: '/chapter-admin/page', handler: 'chapter-admin.getPage' },
    { method: 'PUT', path: '/chapter-admin/page', handler: 'chapter-admin.updatePage' },
```

```js
  'api::chapter-admin.chapter-admin.getPage',
  'api::chapter-admin.chapter-admin.updatePage',
```

- [ ] **Step 4: Verify the wiring**

Two commands, separately — chaining with `;` lets a failing test scroll past under Strapi's boot output:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/grants.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM up_permissions WHERE action LIKE 'api::chapter-admin%';"
```

Expected: 3 tests pass, `BOOTSTRAP OK`, then **25**.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter-admin/ && \
  git commit -m "feat: GET/PUT /chapter-admin/page for chapter microsite copy"
```

---

### Task 4: Integration-test the routes

This suite edits **real microsite copy**. Snapshot and restore exactly, as plan 4's partner suite does.

**Files:** Create `tests/integration/page.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, sections, snapshot, zoneRows;

/** Every component row on chapterA's home page, BOTH statuses, straight from the DB. */
async function zoneComponentRows() {
  return strapi.db.connection('pages_cmps as z')
    .join('pages as p', 'p.id', 'z.entity_id')
    .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
    .join('chapters as c', 'c.id', 'l.chapter_id')
    .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
    .orderBy(['z.entity_id', 'z.order'])
    .select('z.cmp_id', 'z.component_type', 'z.entity_id', 'z.order');
}

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `pg-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);

  const res = await request(strapi.server.httpServer)
    .get(`/api/chapter-admin/page?chapterSlug=${chapterA.slug}`)
    .set('Authorization', `Bearer ${tokenA}`);
  expect(res.status).toBe(200);
  sections = res.body.data;

  // Snapshot BOTH statuses, read from the component rows themselves.
  //
  // The first version of this plan snapshotted the GET response — which is
  // DRAFT ONLY — and restored it through the API, which writes both statuses.
  // That does not restore, it NORMALISES published to draft: aloha's published
  // hero ("Our Chapter") was permanently overwritten with its unpublished draft
  // title ("Chorp Chipper") every time the suite ran, and the plan's own
  // restore gate reported COPY RESTORED because it only diffed sections.
  zoneRows = await zoneComponentRows();
  snapshot = [];
  for (const r of zoneRows) {
    const fields = ['title', 'body', 'intro', 'submitLabel', 'caption'];
    const row = await strapi.db.query(r.component_type).findOne({ where: { id: r.cmp_id } });
    if (!row) continue;
    snapshot.push({
      id: r.cmp_id,
      type: r.component_type,
      values: Object.fromEntries(
        fields.filter((f) => f in row).map((f) => [f, row[f]])),
    });
  }
  expect(snapshot.length).toBe(zoneRows.length);
});

afterAll(async () => {
  try {
    try {
      // Restore each component ROW independently, at its own status. NEVER
      // through the API: the API writes both statuses from one set of values,
      // which is what corrupted the published rows in the first version.
      for (const s of snapshot) {
        if (Object.keys(s.values).length === 0) continue;
        await strapi.db.query(s.type).update({ where: { id: s.id }, data: s.values });
      }
    } finally {
      const users = await strapi.query('plugin::users-permissions.user')
        .findMany({ where: { email: { $contains: String(RUN) } } });
      for (const u of users) {
        await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
      }
    }
  } finally {
    await shutdown();
  }
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const save = (body) => auth(api().put('/api/chapter-admin/page'))
  .send({ chapterSlug: chapterA.slug, ...body });
const reread = async () => (await auth(
  api().get(`/api/chapter-admin/page?chapterSlug=${chapterA.slug}`))).body;

const firstOfType = (type) => sections.find((s) => s.type === type && s.editable.includes('title'));

describe('GET /api/chapter-admin/page', () => {
  it('returns the zone in the order the page stores it', async () => {
    // Compared against pages_cmps."order", NOT against the array's own
    // positions. The first version asserted `indexes === [0..n]`, which the
    // controller guarantees by construction — it could not fail, and order is
    // the one thing positional pairing still depends on.
    const draftRows = (await zoneComponentRows())
      .filter((r) => r.entity_id === Math.min(...zoneRows.map((z) => z.entity_id)));
    expect(sections.map((s) => s.type)).toEqual(draftRows.map((r) => r.component_type));
    expect(sections.map((s) => s.draftId)).toEqual(draftRows.map((r) => r.cmp_id));
  });

  it('offers title on every known component type', () => {
    for (const s of sections) {
      if (s.readOnlyReason === 'not-editable') continue;
      expect(s.editable).toContain('title');
    }
  });

  it('NEVER returns notificationEmails, even on the contact form', () => {
    // It is a staff routing address; returning it would publish it to the
    // browser of anyone who can open this screen.
    const body = JSON.stringify(sections);
    expect(body).not.toContain('notificationEmails');
    const contact = sections.find((s) => s.type === 'shared.contact-form');
    expect(contact).toBeTruthy();
    expect(contact.editable.sort()).toEqual(['intro', 'submitLabel', 'title']);
  });

  it('never offers a relation or a media field', () => {
    for (const s of sections) {
      for (const banned of ['members', 'partners', 'events', 'figure', 'photos', 'fields']) {
        expect(s.editable).not.toContain(banned);
      }
    }
  });

  it('403s a chapter the caller does not administer', async () => {
    const res = await auth(api().get(`/api/chapter-admin/page?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
  });

  it('404s a chapter with no home page', async () => {
    const noPage = await strapi.documents('api::chapter.chapter')
      .findFirst({ filters: { slug: 'pdx' }, fields: ['slug'], status: 'draft' });
    // Asserted, not skipped: pdx has no home page today, and if that changes
    // this test must fail loudly rather than quietly stop testing.
    expect(noPage).toBeTruthy();
    const admin = await makeChapterAdmin(strapi, {
      email: `pg-nopage-${RUN}@areaa.test`, chapterIds: [noPage.id],
    });
    const token = await jwtFor(strapi, admin.id);
    const res = await api().get('/api/chapter-admin/page?chapterSlug=pdx')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error?.message ?? '').toMatch(/no microsite page/i);
  });
});

describe('PUT /api/chapter-admin/page', () => {
  it('writes BOTH statuses, which is what makes the public site change', async () => {
    const s = firstOfType('shared.section');
    const title = `Plan5 ${RUN}`;
    const res = await save({ index: s.index, title });
    expect(res.status).toBe(200);
    expect(res.body.data.wrote).toBe(2);

    // Assert the rows directly — a re-read through the API would only prove the
    // draft changed.
    const pairIds = await strapi.db.connection('pages_cmps as z')
      .join('pages as p', 'p.id', 'z.entity_id')
      .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
      .join('chapters as c', 'c.id', 'l.chapter_id')
      .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
      .andWhere('z.component_type', 'shared.section').select('z.cmp_id');
    expect(pairIds.length).toBe(2);            // one draft, one published
    for (const { cmp_id } of pairIds) {
      const row = await strapi.db.query('shared.section').findOne({ where: { id: cmp_id } });
      expect(row.title).toBe(title);
    }
  });

  it('converts body text to paragraph blocks', async () => {
    const s = sections.find((x) => x.editable.includes('body'));
    expect(s).toBeTruthy();
    await save({ index: s.index, body: `One ${RUN}\nTwo` });
    const after = (await reread()).data.find((x) => x.index === s.index);
    expect(after.values.body).toBe(`One ${RUN}\nTwo`);
  });

  it('addresses sections by POSITION, so a component id in the payload is inert', async () => {
    // Actually post one, which the first version never did — it only tested
    // index 999 and would have passed against a handler that honoured a
    // client-supplied id.
    const foreign = await strapi.db.connection('pages_cmps')
      .where('component_type', 'shared.section')
      .whereNotIn('cmp_id', (await zoneComponentRows()).map((r) => r.cmp_id))
      .first();
    expect(foreign).toBeTruthy();
    const before = await strapi.db.query('shared.section')
      .findOne({ where: { id: foreign.cmp_id } });

    const s = firstOfType('shared.section');
    await save({ index: s.index, draftId: foreign.cmp_id, id: foreign.cmp_id,
                 title: `Position ${RUN}` });

    const after = await strapi.db.query('shared.section')
      .findOne({ where: { id: foreign.cmp_id } });
    expect(after.title).toBe(before.title);
  });

  it('400s an out-of-range index', async () => {
    const res = await save({ index: 999, title: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/no such section/i);
  });

  it('400s a malformed index rather than defaulting to the hero', async () => {
    // Number(null), Number('') and Number(false) are all 0, and index 0 is the
    // hero. Verified reachable in the first version: {index: null} returned 200
    // and rewrote the page headline at both statuses.
    const hero = sections[0];
    const before = await strapi.db.query(hero.type).findOne({ where: { id: hero.draftId } });
    for (const bad of [null, '', false, [], {}, 1.5, -1]) {
      const res = await save({ index: bad, title: `Malformed ${RUN}` });
      expect(res.status, `index=${JSON.stringify(bad)}`).toBe(400);
    }
    const after = await strapi.db.query(hero.type).findOne({ where: { id: hero.draftId } });
    expect(after.title).toBe(before.title);
  });

  it('DROPS a field the component type does not allow', async () => {
    const contact = sections.find((s) => s.type === 'shared.contact-form');
    const before = await strapi.db.query('shared.contact-form')
      .findOne({ where: { id: contact.draftId } });
    await save({
      index: contact.index, title: `Contact ${RUN}`,
      notificationEmails: 'attacker@evil.example',
    });
    const after = await strapi.db.query('shared.contact-form')
      .findOne({ where: { id: contact.draftId } });
    expect(after.title).toBe(`Contact ${RUN}`);
    expect(after.notificationEmails).toBe(before.notificationEmails);
  });

  it('400s when nothing editable was submitted', async () => {
    const s = firstOfType('shared.section');
    const res = await save({ index: s.index, partners: ['p1'] });
    expect(res.status).toBe(400);
  });

  it('refuses to edit a body that carries formatting', async () => {
    // The live data-loss path. Plant marks on the draft row, then confirm the
    // API both stops offering `body` and refuses a write.
    const s = sections.find((x) => x.editable.includes('body'));
    const row = await strapi.db.query(s.type).findOne({ where: { id: s.draftId } });
    const plain = row.body;
    await strapi.db.query(s.type).update({
      where: { id: s.draftId },
      data: { body: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bold', bold: true }] }] },
    });
    try {
      const listed = (await reread()).data.find((x) => x.index === s.index);
      expect(listed.editable).not.toContain('body');
      expect(listed.readOnlyReason).toBe('rich-body');

      const res = await save({ index: s.index, body: 'this would strip the bold' });
      expect(res.status).toBe(400);
      expect(res.body.error?.message ?? '').toMatch(/formatting/i);
    } finally {
      await strapi.db.query(s.type).update({ where: { id: s.draftId }, data: { body: plain } });
    }
  });

  it('never touches a component on another chapter page', async () => {
    // Derived from the database independently of findPageZones — deriving it
    // from the same lookup would make the function its own oracle.
    //
    // `mine` must cover BOTH statuses. The first version used `sections`, which
    // carries draftId only, so this chapter's own PUBLISHED section landed in
    // `others` — and the save legitimately writes it. The test failed 100% of
    // the time and took the 220 gate with it.
    const mine = new Set(
      (await zoneComponentRows())
        .filter((r) => r.component_type === 'shared.section')
        .map((r) => r.cmp_id));
    const others = await strapi.db.connection('pages_cmps')
      .where('component_type', 'shared.section')
      .whereNotIn('cmp_id', [...mine]).select('cmp_id');
    expect(others.length).toBeGreaterThan(0);

    const before = {};
    for (const { cmp_id } of others) {
      before[cmp_id] = (await strapi.db.query('shared.section')
        .findOne({ where: { id: cmp_id } }))?.title ?? null;
    }
    await save({ index: firstOfType('shared.section').index, title: `Isolated ${RUN}` });
    for (const { cmp_id } of others) {
      const now = (await strapi.db.query('shared.section')
        .findOne({ where: { id: cmp_id } }))?.title ?? null;
      expect(now).toBe(before[cmp_id]);
    }
  });

  it('403s a chapter the caller does not administer', async () => {
    const res = await auth(api().put('/api/chapter-admin/page'))
      .send({ chapterSlug: chapterB.slug, index: 0, title: 'nope' });
    expect(res.status).toBe(403);
  });

  it('SKIPS the published write when that row has diverged, and says so', async () => {
    // The plan's central safety property, and the first version proved it
    // nowhere: draftChapters yields two fully-published chapters, so `wrote`
    // was always 2 and the only assertion was toBe(2).
    //
    // Real data already contains this state — aloha's draft hero title differs
    // from its published one — but construct it explicitly so the test does not
    // depend on which chapters draftChapters happens to return.
    const s = firstOfType('shared.section');
    const rows = (await zoneComponentRows()).filter((r) => r.component_type === 'shared.section');
    expect(rows.length).toBe(2);
    const [draftRow, pubRow] = rows;
    const pubBefore = await strapi.db.query('shared.section').findOne({ where: { id: pubRow.cmp_id } });

    // Make published differ from draft, as an unpublished national edit would.
    await strapi.db.query('shared.section')
      .update({ where: { id: pubRow.cmp_id }, data: { title: `Diverged ${RUN}` } });
    try {
      const res = await save({ index: s.index, title: `Attempt ${RUN}` });
      expect(res.status).toBe(200);
      expect(res.body.data.wrote).toBe(1);
      expect(res.body.meta.skipReason).toBe('content-diverged');

      const draftAfter = await strapi.db.query('shared.section')
        .findOne({ where: { id: draftRow.cmp_id } });
      const pubAfter = await strapi.db.query('shared.section')
        .findOne({ where: { id: pubRow.cmp_id } });
      expect(draftAfter.title).toBe(`Attempt ${RUN}`);
      // Untouched. Writing it would have PUBLISHED an edit nobody approved.
      expect(pubAfter.title).toBe(`Diverged ${RUN}`);
    } finally {
      await strapi.db.query('shared.section')
        .update({ where: { id: pubRow.cmp_id }, data: { title: pubBefore.title } });
    }
  });

  it('does not change the zone STRUCTURE', async () => {
    // The central safety claim: no component added, removed or reordered.
    const shape = async () => (await strapi.db.connection('pages_cmps as z')
      .join('pages as p', 'p.id', 'z.entity_id')
      .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
      .join('chapters as c', 'c.id', 'l.chapter_id')
      .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
      .orderBy(['z.entity_id', 'z.order'])
      .select('z.entity_id', 'z.order', 'z.component_type', 'z.cmp_id'));

    const before = await shape();
    await save({ index: firstOfType('shared.section').index, title: `Shape ${RUN}` });
    expect(await shape()).toEqual(before);
  });
});
```

- [ ] **Step 2: Run them, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/page.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **18 tests**, then **235 across 17 files** — 175 from plans 1–4, plus 42 page-content unit and 18 page integration.

- [ ] **Step 3: Prove the microsite copy came back**

A count gate cannot see changed text. Compare the values:

Two problems with the obvious version, both real. It diffed **one table's
titles**, so a corrupted hero, body, intro or contact form was invisible — and
that is exactly what the first version's restore corrupted. And `&&`-chaining
the test run to the diff meant a **failing suite** short-circuited to the `||`
branch and printed "fix the restore", sending the operator after a bug that was
not there.

Snapshot every editable column of every zone component type, `quote()` so `NULL`
and `''` stay distinguishable, and keep the run separate from the diff:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && cat > /tmp/p5-copy.sql <<'EOF'
SELECT 'hero',    id, quote(title), quote(body)  FROM components_shared_heroes
UNION ALL SELECT 'section', id, quote(title), quote(body)  FROM components_shared_sections
UNION ALL SELECT 'contact', id, quote(title), quote(intro) FROM components_shared_contact_forms
UNION ALL SELECT 'video',   id, quote(title), quote(caption) FROM components_shared_video_embeds
UNION ALL SELECT 'gallery', id, quote(title), '' FROM components_shared_galleries
UNION ALL SELECT 'events',  id, quote(title), '' FROM components_shared_upcoming_events
UNION ALL SELECT 'members', id, quote(title), '' FROM components_shared_member_groups
UNION ALL SELECT 'partners',id, quote(title), '' FROM components_shared_partner_groups
UNION ALL SELECT 'social',  id, quote(title), '' FROM components_shared_social_media_feeds
ORDER BY 1, 2;
EOF
sqlite3 .tmp/data.db < /tmp/p5-copy.sql > /tmp/p5-before.txt
```

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/page.test.js
```

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db < /tmp/p5-copy.sql > /tmp/p5-after.txt
diff /tmp/p5-before.txt /tmp/p5-after.txt && echo "COPY RESTORED"
```

Expected: the suite passes, then `COPY RESTORED`. Run the diff **whether or not
the suite passed** — a failed run is exactly when the restore is most likely to
have been skipped.

Verify the gate can fail before trusting it: change one title by hand, re-run
the diff, confirm it reports the difference, then put it back.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/page.test.js && \
  git commit -m "test: page copy editing, both statuses, and zone-structure invariance"
```

---

## Chunk 3: The screen

### Task 5: Client and payload mapping

**Files:** Create `src/lib/chapter-admin/page.ts`, `src/lib/page-form.ts`, `tests/unit/page-form.test.ts`

- [ ] **Step 1: The client**

```ts
import { call } from "./client";

export interface PageSection {
    index: number;
    type: string;
    draftId: number;
    editable: string[];
    readOnlyReason: "rich-body" | "not-editable" | null;
    values: Record<string, string>;
}

export interface PageContent {
    sections: PageSection[];
    /** Draft restructured without publishing: saves reach the draft only. */
    structureDiverged: boolean;
}

/** Returns null on failure, never a soft empty — an empty zone renders no forms. */
export async function getPageContent(
    jwt: string, chapterSlug: string
): Promise<PageContent | null> {
    const { status, body } = await call(
        jwt, `/page?chapterSlug=${encodeURIComponent(chapterSlug)}`);
    if (status !== 200 || !Array.isArray(body?.data)) return null;
    return { sections: body.data, structureDiverged: Boolean(body.meta?.structureDiverged) };
}

export type SkipReason = "never-published" | "structure-diverged" | "content-diverged" | null;

export async function savePageSection(
    jwt: string, chapterSlug: string, index: number, values: Record<string, string>
): Promise<{ ok: boolean; status: number; wrote: number; skipReason: SkipReason }> {
    const { status, body } = await call(jwt, "/page", {
        method: "PUT",
        body: JSON.stringify({ chapterSlug, index, ...values }),
    });
    // `skipReason` must survive this hop. `wrote: 1` has three distinct causes
    // and they need three distinct messages — telling an admin whose page has
    // simply never been published to "contact national to publish your
    // structural changes" is a wrong answer delivered confidently.
    return {
        ok: status === 200 && Boolean(body?.data),
        status,
        wrote: body?.data?.wrote ?? 0,
        skipReason: body?.meta?.skipReason ?? null,
    };
}
```

Add `export * from "./page";` to `src/lib/chapter-admin/index.ts`.

- [ ] **Step 2: Write the failing payload test**

```ts
import { describe, it, expect } from "vitest";
import { toSectionPayload, SECTION_INDEX_FIELD } from "../../src/lib/page-form";

const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
};

describe("toSectionPayload", () => {
    it("reads the section index the form declares", () => {
        const fd = form({ [SECTION_INDEX_FIELD]: "3", title: "T" });
        expect(toSectionPayload(fd, ["title"])?.index).toBe(3);
    });

    it("collects only the fields this section declared editable", () => {
        const fd = form({ [SECTION_INDEX_FIELD]: "0", title: "T", body: "B" });
        expect(toSectionPayload(fd, ["title"])?.values).toEqual({ title: "T" });
    });

    it("keeps a cleared field, so an admin can remove a heading", () => {
        const fd = form({ [SECTION_INDEX_FIELD]: "0", title: "" });
        expect(toSectionPayload(fd, ["title"])?.values).toEqual({ title: "" });
    });

    it("returns null when the index is missing", () => {
        // Not 0 — index 0 is a real section, and coercing a missing value to 0
        // would edit the hero whenever the field was dropped.
        expect(toSectionPayload(form({ title: "T" }), ["title"])).toBeNull();
    });

    it("returns null for a non-numeric index", () => {
        expect(toSectionPayload(form({ [SECTION_INDEX_FIELD]: "abc", title: "T" }), ["title"]))
            .toBeNull();
    });

    it("returns null when the section declared nothing editable", () => {
        // Posting {} would 400; refusing here gives a clearer message.
        expect(toSectionPayload(form({ [SECTION_INDEX_FIELD]: "0" }), [])).toBeNull();
    });

    it("ignores a field the section did not declare, even if posted", () => {
        const fd = form({ [SECTION_INDEX_FIELD]: "0", title: "T", notificationEmails: "x@y.z" });
        expect(toSectionPayload(fd, ["title"])?.values).not.toHaveProperty("notificationEmails");
    });
});
```

- [ ] **Step 3: Implement**

```ts
export const SECTION_INDEX_FIELD = "sectionIndex";

/**
 * One section form -> its save payload.
 *
 * `editable` comes from the server's own answer for THIS section, so a field
 * the type does not allow cannot be smuggled in by adding an input. The server
 * whitelists again; this is convenience, not the boundary.
 *
 * A missing index returns null rather than defaulting to 0 — index 0 is the
 * hero, and a dropped field would otherwise silently edit it.
 */
export function toSectionPayload(
    fd: FormData, editable: string[]
): { index: number; values: Record<string, string> } | null {
    const raw = fd.get(SECTION_INDEX_FIELD);
    if (raw === null || String(raw).trim() === "") return null;
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0) return null;
    if (editable.length === 0) return null;

    const values: Record<string, string> = {};
    for (const name of editable) {
        const v = fd.get(name);
        if (v !== null) values[name] = String(v);
    }
    if (Object.keys(values).length === 0) return null;
    return { index, values };
}
```

- [ ] **Step 4: Run and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/page-form.test.ts
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **7 tests**, 0 errors.

- [ ] **Step 5: Correct the stale comment in `blocks.ts`**

`src/lib/blocks.ts:6` says "Plan 4 replaces the textarea these serve with TipTap". It is plan 6, and this plan adds a second consumer of those converters:

```diff
- * PLACEHOLDER, deliberately. Plan 4 replaces the textarea these serve with
- * TipTap and a real bidirectional converter. Until then a chapter admin can
- * write paragraphs and nothing else, which is why the form labels the field as
- * plain text rather than implying formatting is available.
+ * PLACEHOLDER, deliberately. Plan 6 replaces the textareas these serve with
+ * TipTap and a real bidirectional converter. Until then a chapter admin can
+ * write paragraphs and nothing else, which is why the forms label the field as
+ * plain text rather than implying formatting is available.
+ *
+ * Plan 5's /page screen only offers a body textarea when the stored blocks are
+ * plain paragraphs, precisely because blocksToPlainText below is lossy.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/chapter-admin/page.ts src/lib/chapter-admin/index.ts \
          src/lib/page-form.ts tests/unit/page-form.test.ts src/lib/blocks.ts && \
  git commit -m "feat: page content client and section payload mapping"
```

---

### Task 6: The form component and the screen

**Files:** Create `src/components/PageSectionForm.astro`, `tests/unit/page-section-render.test.ts`, `src/pages/api/chapter-admin/page.ts`, `src/pages/account/chapter/[chapterSlug]/page.astro`; modify `ChapterAdminLayout.astro`

- [ ] **Step 1: Write the failing render test**

```ts
import { describe, it, expect } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import PageSectionForm from "../../src/components/PageSectionForm.astro";

const section = (over = {}) => ({
    index: 2, type: "shared.section", draftId: 118,
    editable: ["title", "body"], readOnlyReason: null,
    values: { title: "Our Chapter", body: "Line one" },
    ...over,
});

const render = async (props: Record<string, unknown>) => {
    const container = await AstroContainer.create();
    return container.renderToString(PageSectionForm, {
        props: { chapterSlug: "boston", section: section(), ...props },
    });
};

describe("PageSectionForm", () => {
    it("renders an input per editable field, with current values", async () => {
        const html = await render({});
        expect(html).toContain('name="title"');
        expect(html).toContain("Our Chapter");
        expect(html).toContain('name="body"');
        // The BODY's value, not just the title's. Without this the test passes
        // against a blank textarea, and a heading-only save wipes the body at
        // both statuses on the live site.
        expect(html).toContain("Line one");
        expect(html).toContain('name="sectionIndex"');
        expect(html).toContain('value="2"');
    });

    it("carries editableFields, which the save route reads to build the payload", async () => {
        // Omitting it makes every save bounce to ?error=missing while the whole
        // suite stays green — verified against a component built without it.
        const html = await render({});
        expect(html).toContain('name="editableFields"');
        expect(html).toContain('value="title,body"');
    });

    it("carries the chapter slug the save needs", async () => {
        expect(await render({})).toContain('name="chapterSlug"');
    });

    it("names the section by type, so the admin can tell them apart", async () => {
        // A zone holds three member-groups; "Section" alone is not enough.
        expect(await render({})).toMatch(/Text Section/i);
    });

    it("renders NO form and NO save button for a read-only section", async () => {
        const html = await render({ section: section({ editable: [], readOnlyReason: "not-editable" }) });
        expect(html).not.toContain("<form");
        expect(html).not.toMatch(/Save/i);
    });

    it("explains a rich body instead of offering a textarea that would strip it", async () => {
        // The live data-loss path: blocksToPlainText flattens marks.
        const html = await render({
            section: section({ editable: ["title"], readOnlyReason: "rich-body" }),
        });
        expect(html).toContain('name="title"');
        expect(html).not.toContain('name="body"');
        expect(html).toMatch(/formatting/i);
    });

    it("still offers title when only the body is locked", async () => {
        const html = await render({
            section: section({ editable: ["title"], readOnlyReason: "rich-body" }),
        });
        expect(html).toContain("<form");
        expect(html).toMatch(/Save/i);
    });

    it("never renders a field the server did not mark editable", async () => {
        const html = await render({
            section: section({ editable: ["title"], values: { title: "T" } }),
        });
        expect(html).not.toContain('name="body"');
    });
});
```

- [ ] **Step 2: The component**

Labels come from a type map, because "Section" is not distinguishable when a zone holds three member-groups:

```ts
const TYPE_LABELS: Record<string, string> = {
    "shared.hero": "Header",
    "shared.section": "Text Section",
    "shared.partner-callout": "Partner Callout",
    "shared.contact-form": "Contact Form",
    "shared.video-embed": "Video",
    "shared.gallery": "Photo Gallery",
    "shared.upcoming-events": "Upcoming Events",
    "shared.news-and-resources": "News & Resources",
    "shared.member-group": "Member Group",
    "shared.partner-group": "Partners",
    "shared.social-media-feed": "Social Feed",
    "shared.faq": "FAQ",
};
const FIELD_LABELS: Record<string, string> = {
    title: "Heading", body: "Body Text", intro: "Intro", submitLabel: "Button Label",
    caption: "Caption",
};
```

The component renders `<form method="post" action="/api/chapter-admin/page">` with **three** hidden inputs — `chapterSlug`, `sectionIndex`, and **`editableFields`** — a `FormField` per editable name (`body` as a textarea, **carrying its current value**), and a Save button, **only when `editable.length > 0`**:

```astro
    <input type="hidden" name="chapterSlug" value={chapterSlug} />
    <input type="hidden" name="sectionIndex" value={String(section.index)} />
    {/*
      The route cannot know which fields THIS section allows — the whitelist is
      per component type and lives on the server. Omitting this input makes
      `toSectionPayload` return null and EVERY save bounce to ?error=missing,
      while every test and the typecheck stay green. The first version of this
      plan specified the route's read of it and not the input itself.
    */}
    <input type="hidden" name="editableFields" value={section.editable.join(",")} />

    {section.editable.map((name) => (
        <FormField
            label={FIELD_LABELS[name] ?? name}
            name={name}
            type={name === "body" ? "textarea" : "text"}
            value={section.values[name] ?? ""}
        />
    ))}
```

`value={section.values[name] ?? ""}` is load-bearing on **every** field, not just `title`. A body textarea rendered without its value looks empty; an admin fixing only the heading posts `body=""`, and `textToBlocks("")` clears the body at both statuses on the live site. When `readOnlyReason` is `rich-body` it renders the remaining fields plus a note: *"The body of this section was formatted by AREAA national. Editing it here would remove that formatting, so it's shown on your site as-is."* When `not-editable`, it renders the type label and nothing else.

- [ ] **Step 3: The API route**

Follows `partner.ts`. `base` is the page path; `editable` must come from the form itself, since the route cannot know which fields this section allows:

```ts
const editable = String(form.get("editableFields") ?? "").split(",").filter(Boolean);
const payload = toSectionPayload(form, editable);
if (payload === null) return back(base, "error=missing");

const result = await savePageSection(jwt, chapterSlug, payload.index, payload.values);
if (!result.ok) {
    if (result.status === 403) return back(base, "error=forbidden");
    if (result.status === 400) return back(base, "error=stale");
    return back(base, "error=save");
}
// wrote === 1 means the draft changed but the live page did not, and WHY
// decides what the admin should do about it.
if (result.wrote < 2) return back(base, `saved=draft&why=${result.skipReason ?? "unknown"}`);
return back(base, "saved=1");
```

- [ ] **Step 4: The screen**

`/account/chapter/[chapterSlug]/page.astro` loads `getPageContent`, renders one `PageSectionForm` per section in zone order, and adds a **Partners** style nav entry. Flash messages:

```ts
const flashes: Record<string, string> = {
    "1": "Section saved.",
    // Three distinct causes of wrote:1, three distinct answers. The first
    // version collapsed them into the structural message, which is simply
    // false for a page that has never been published.
    "draft:never-published":
        "Saved. This page isn't published yet, so there's nothing live to update.",
    "draft:structure-diverged":
        "Saved to your draft. Your live page has unpublished structural changes — contact national to publish them.",
    "draft:content-diverged":
        "Saved to your draft. This section has unpublished changes from AREAA national, so your live page hasn't changed yet.",
    "draft:unknown": "Saved to your draft. Your live page hasn't changed yet.",
};

const errorMessages: Record<string, string> = {
    // Emitted whenever the form could not be turned into a payload. Unmapped
    // in the first version, so the one failure mode most likely to ship was
    // also the one with no message.
    missing: "That form couldn't be submitted. Please reload the page and try again.",
    forbidden: "You don't have permission to edit this chapter's page.",
    stale: "That section changed while you were editing. Reload and try again.",
    save: "Something went wrong saving. Please try again.",
};
```

When `structureDiverged` is true, show a persistent banner above every form, because the admin needs to know *before* saving rather than after.

When `getPageContent` returns null, render **no forms at all** — same rule as the partners picker: never render an editor over content you could not read. **Say which failure it was**, using `messageOf` from `client.ts`: a `pdx` admin should see "This chapter has no microsite page yet", not a blank screen. Have `getPageContent` return a discriminated result rather than bare `null` so the page can tell 404 from 403 from a transport failure.

- [ ] **Step 5: Nav entry**

```js
    { key: "page", label: "Page", href: `/account/chapter/${chapterSlug}/page` },
```

Between Overview and Events. Remove the stale `// /page arrives in plan 5.` comment.

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: 0 errors, then **90 passed** (75 + 7 payload + 8 render).

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/components/PageSectionForm.astro tests/unit/page-section-render.test.ts \
          src/pages/api/chapter-admin/page.ts \
          "src/pages/account/chapter/[chapterSlug]/page.astro" \
          src/layouts/ChapterAdminLayout.astro && \
  git commit -m "feat: chapter admins edit their microsite copy"
```

---

## Chunk 4: Verification

### Task 7: Both suites, twice, with no drift

- [ ] **Step 1: Run them**

Note the `cd` on the first line — the preceding task leaves the shell in the frontend repo:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **235 CMS**, **90 frontend**, 0 typecheck errors.

- [ ] **Step 2: Twice, with the zone structure unchanged**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT entity_id, \"order\", component_type, cmp_id FROM pages_cmps ORDER BY entity_id, \"order\";" > /tmp/p5-zone-before.txt
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT entity_id, \"order\", component_type, cmp_id FROM pages_cmps ORDER BY entity_id, \"order\";" > /tmp/p5-zone-after.txt && \
  diff /tmp/p5-zone-before.txt /tmp/p5-zone-after.txt && echo "ZONE STRUCTURE IDENTICAL"
```

Expected: `ZONE STRUCTURE IDENTICAL`. This is the plan's central safety claim; a diff here means something wrote `page.components`.

---

### Task 8: Prove it in a browser

- [ ] **Step 1: Snapshot the live copy AS RESTORABLE JSON**

Titles alone are not enough — Step 2 row 5 edits a **body**, and Step 3 replaces
one. Capture every editable column as JSON so the restore is mechanical:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node -e '
const fs = require("fs");
const { createStrapi, compileStrapi } = require("@strapi/strapi");
const FIELDS = ["title", "body", "intro", "submitLabel", "caption"];
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = "error";
  const rows = await app.db.connection("pages_cmps as z")
    .join("pages as p", "p.id", "z.entity_id")
    .join("pages_chapter_lnk as l", "l.page_id", "p.id")
    .join("chapters as c", "c.id", "l.chapter_id")
    .andWhere("p.slug", "home")
    .select("z.cmp_id", "z.component_type", "c.slug");
  const snap = [];
  for (const r of rows) {
    const row = await app.db.query(r.component_type).findOne({ where: { id: r.cmp_id } });
    if (!row) continue;
    snap.push({ id: r.cmp_id, type: r.component_type, chapter: r.slug,
      values: Object.fromEntries(FIELDS.filter((f) => f in row).map((f) => [f, row[f]])) });
  }
  fs.writeFileSync("/tmp/p5-copy-before.json", JSON.stringify(snap, null, 2));
  console.log("snapshotted", snap.length, "components");
  await app.destroy(); process.exit(0);
})();'
```

Keep `/tmp/p5-copy-before.json` until Step 5 has verified the restore.

- [ ] **Step 2: Start both servers, walk it as `chapadmin@areaa.test`**

| # | Action | Expected |
|---|---|---|
| 1 | Sidebar | Overview, **Page**, Events, News, Committees, Partners, Submissions, Settings |
| 2 | Page | One card per component, in zone order, each named by type — three distinct "Member Group" cards, not one |
| 3 | Edit a Text Section heading → Save | "Section saved." |
| 4 | **Visit `/chapters/aloha-hawaii`** | The heading changed on the public page |
| 5 | Edit a body over several lines → Save → reload | Paragraphs preserved; public page shows them |
| 6 | Contact Form card | Heading, Intro and Button Label offered — **no notificationEmails field anywhere in the HTML** |
| 7 | Partners / Member Group cards | Heading only; no picker, no member list. *(Note: `readOnlyReason: 'not-editable'` is NOT reachable here — all nine component types on a chapter zone are in the whitelist. The unit test is its only coverage.)* |
| 8 | Disable JavaScript, repeat 3 **and 5** | Both work identically; re-check the public page after each |
| 14 | Make one published row differ (Step 3's script pattern), then edit that section | "Saved to your draft… unpublished changes from AREAA national"; public page unchanged; `wrote: 1` |
| 9 | View source on the Page screen | `notificationEmails` appears nowhere |

- [ ] **Step 3: Exercise the rich-body guard, which the seed cannot reach**

Sections 4 and 5 carry marks but are not on any page, so plant one.

**Stop `strapi develop` first.** The script below boots a second Strapi against
the same SQLite file, which runs bootstrap and schema sync while the dev server
holds it. And run this **before** Step 2 row 5 edits a body, or the "original"
it captures is already the walkthrough's own text:

```bash
pkill -f "strapi develop" ; sleep 2
```

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node -e '
const { createStrapi, compileStrapi } = require("@strapi/strapi");
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = "error";
  const rows = await app.db.connection("pages_cmps as z")
    .join("pages as p", "p.id", "z.entity_id")
    .join("pages_chapter_lnk as l", "l.page_id", "p.id")
    .join("chapters as c", "c.id", "l.chapter_id")
    .where("c.slug", "aloha-hawaii").andWhere("p.slug", "home")
    .andWhere("z.component_type", "shared.section").select("z.cmp_id");
  for (const { cmp_id } of rows) {
    const before = await app.db.query("shared.section").findOne({ where: { id: cmp_id } });
    console.log("cmp", cmp_id, "original body:", JSON.stringify(before.body));
    await app.db.query("shared.section").update({ where: { id: cmp_id }, data: { body: [
      { type: "paragraph", children: [
        { type: "text", text: "This is " },
        { type: "text", text: "important", bold: true },
      ]},
    ]}});
  }
  await app.destroy(); process.exit(0);
})();'
```

| # | Action | Expected |
|---|---|---|
| 10 | Reload Page | That section shows **Heading only**, with the "formatted by AREAA national" note and **no body textarea** |
| 11 | Save its heading | Succeeds; the bold body is untouched on the public page |

**Restore the original bodies from the printed JSON before continuing.**

- [ ] **Step 4: The multi-chapter case, as `twochapter@areaa.test`**

| # | Action | Expected |
|---|---|---|
| 12 | Chapter A → Page, edit a heading | Only A's page changes; B's is untouched |
| 13 | Open B's Page | B's own copy, not A's |

- [ ] **Step 5: Restore, verify, then stop**

Run this **before** killing anything — plan 4 shipped a walkthrough whose
restore was impossible to perform after the servers were gone:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; sleep 2
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node -e '
const fs = require("fs");
const { createStrapi, compileStrapi } = require("@strapi/strapi");
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = "error";
  const snap = JSON.parse(fs.readFileSync("/tmp/p5-copy-before.json", "utf8"));
  let n = 0;
  for (const c of snap) {
    if (Object.keys(c.values).length === 0) continue;
    await app.db.query(c.type).update({ where: { id: c.id }, data: c.values });
    n += 1;
  }
  console.log("restored", n, "components");
  await app.destroy(); process.exit(0);
})();'
```

Each row is restored **at its own id**, so draft and published keep whatever
they held — including aloha's hero, whose two statuses legitimately differ.

Verify against the snapshot before believing it:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db < /tmp/p5-copy.sql > /tmp/p5-walk-after.txt && \
  sqlite3 .tmp/data.db < /tmp/p5-copy.sql > /dev/null && \
  diff <(sqlite3 .tmp/data.db < /tmp/p5-copy.sql) /tmp/p5-before.txt && echo "COPY RESTORED"
```

Then:

```bash
pkill -f "strapi develop" ; pkill -f "astro dev" ; sleep 2
cd /Users/nk/Projects/AREAA/areaa-cms && git status --short
cd /Users/nk/Projects/AREAA/areaa-frontend && git status --short
```

---

## Done when

- **235 CMS and 90 frontend tests green**, CMS twice, with `pages_cmps` byte-identical across runs.
- A chapter admin edits a heading and body on `/page`, **with JavaScript disabled**, and the public microsite shows the change.
- **No component is added, removed or reordered by any save** — proven by comparing `pages_cmps` before and after.
- Both rows are written **only when their content already agrees**; otherwise the draft alone is written, `wrote: 1` comes back with a `skipReason`, and the screen says which of the three reasons applies. *(Integration test plus walkthrough row 14.)*
- **A same-type reorder cannot write the wrong component.** *(Unit test on `pairZones` plus the content-parity integration test — not reachable from the walkthrough.)*
- **A malformed `index` — `null`, `''`, `false` — 400s rather than rewriting the hero.** *(Integration test only.)*
- `notificationEmails` appears nowhere in the API response or the rendered HTML.
- A section whose body carries formatting renders **no body textarea**, and a write to it 400s.
- Relations and media are absent from every form on the screen.
- A chapter with no home page gets a 404 **and the screen says so**, rather than rendering blank. *(Integration test for the status; the rendered message is walkthrough-only, since `pdx` has no admin account — create one or accept that this is unproven in the browser.)*
- The zone-copy restore gate is **demonstrated to fail** on a hand-made change before it is trusted.

## Not in this plan

- **Adding, removing, reordering sections.** The one thing that needs a zone write.
- **Media and relations.** Their own screens.
- **Nested components** — `shared.cta`, `shared.form-field`, `shared.faq-item`.
- **Rich text.** Plan 6. Until then the guard above stops the textarea destroying anything.
- **National pages.**

## Known limitations, accepted

- **A rich body is uneditable, not just unformatted.** An admin with a bold word in their section cannot fix a typo in it from this screen. Correct until plan 6, but it will be reported as a bug — the note in the UI is what makes it legible rather than mysterious.
- **`wrote: 1` is a soft failure.** The save succeeded and the live page did not change. The screen says so, but nothing in this plan lets the admin publish; that stays national.
- **Positional pairing is guarded by content, not by structure.** The type-sequence check catches an added or removed component; it does **not** catch a same-type reorder, which is why the published write additionally requires content parity. The cost is that any legitimate draft/published difference — including an unpublished national edit, which exists on aloha's hero today — makes the published write unreachable until national publishes. `wrote: 1` will therefore be common, not exceptional, and the screen has to say so clearly rather than treating it as an edge case.
- **A chapter admin cannot resolve a divergence.** When content parity fails they can only edit the draft; publishing stays national. The screen explains this; nothing in this plan lets them act on it.
- **No optimistic-concurrency check.** Two admins editing the same section overwrite each other last-write-wins, exactly as every other form in this system. The rich-body re-check on write is the only staleness guard.
- **No edit history.** Overwriting national copy is unrecoverable from the app; Strapi's admin panel is the only trail.
- **Two independent copies of `textToBlocks`** — one in the CMS (`page-content.js`), one in the frontend (`blocks.ts`) — with nothing asserting they agree. They must, or a body saved through `/page` renders differently from one saved through the event form. A shared fixture tested on both sides would close it; deferred.
