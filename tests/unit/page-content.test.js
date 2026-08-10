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
    // Children carry real text, so the PARAGRAPH-TYPE check is what rejects
    // these. With `children: []` the spacer guard catches them instead and the
    // type check becomes unprotected — the mutation gate found exactly that.
    expect(isPlainBlocks([
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Heading' }] },
    ])).toBe(false);
    expect(isPlainBlocks([
      { type: 'list', format: 'unordered', children: [{ type: 'text', text: 'Item' }] },
    ])).toBe(false);
    expect(isPlainBlocks([
      { type: 'quote', children: [{ type: 'text', text: 'Quoted' }] },
    ])).toBe(false);
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
