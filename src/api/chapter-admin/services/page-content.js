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
      draftId: c.id, publishedId: null, type: c.__component, index, ambiguous: false,
    }));
  }
  if (published.length !== d.length) return null;
  for (let i = 0; i < d.length; i += 1) {
    if (d[i].__component !== published[i].__component) return null;
  }

  // How many components of each type the zone holds. A type that appears ONCE
  // can only pair one way: position 0 in the draft and position 0 in published
  // are provably the same component, and no content comparison can tell us
  // anything position has not already settled.
  //
  // This is what the content-parity gate is for, and the only case it is for.
  // Applying it to unique types froze them: the gate compares draft against
  // published, an admin's save only ever reaches the draft, so the first save
  // diverges the two and every later save is refused for the divergence the
  // first one caused. Measured on aloha's hero — permanently uneditable.
  const counts = {};
  for (const c of d) counts[c.__component] = (counts[c.__component] ?? 0) + 1;

  return d.map((c, index) => ({
    draftId: c.id,
    publishedId: published[index].id,
    type: c.__component,
    index,
    ambiguous: counts[c.__component] > 1,
  }));
}

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

module.exports = {
  EDITABLE_BY_TYPE, editableFieldsFor, isPlainBlocks, textToBlocks, blocksToText,
  shapeComponentEdit, pairZones, sameForFields, findPageZones,
  CTA_SLOTS, ctaSlotsFor, shapeCtaEdit, CMPS_TABLE, MEDIA_SLOTS, mediaSlotFor,
  MAX_BODY_LEN, MAX_TEXT_LEN,
};
