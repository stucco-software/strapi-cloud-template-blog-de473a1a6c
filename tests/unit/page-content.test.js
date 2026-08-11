import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// One createRequire so BadInputError is the SAME class the service throws.
const require = createRequire(import.meta.url);
const {
  EDITABLE_BY_TYPE, editableFieldsFor, isPlainBlocks, textToBlocks, blocksToText,
  shapeComponentEdit, pairZones, sameForFields, findPageZones,
  CTA_SLOTS, ctaSlotsFor, shapeCtaEdit, CMPS_TABLE,
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
      { draftId: 100, publishedId: 150, type: 'shared.hero', index: 0, ambiguous: false },
      { draftId: 101, publishedId: 151, type: 'shared.member-group', index: 1, ambiguous: true },
      { draftId: 102, publishedId: 152, type: 'shared.member-group', index: 2, ambiguous: true },
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

  it('flags a pair as ambiguous ONLY when its type repeats in the zone', () => {
    // This is what the content-parity gate is really for. Position pairing can
    // only put one component's text into another when the zone holds MORE THAN
    // ONE of that type — with a single hero, position 0 in the draft and
    // position 0 in published are provably the same component.
    //
    // Gating the unique types too made them permanently uneditable: the gate
    // compares draft against published, an admin's save only ever reaches the
    // draft, so the two diverge on the first save and never converge again.
    // Measured on aloha's hero — every later save returned
    // `saved=draft&why=content-diverged` and the live page never changed.
    const d = zone(['shared.hero', 'shared.member-group', 'shared.member-group']);
    const p = d.map((c) => ({ ...c, id: c.id + 50 }));
    expect(pairZones(d, p).map((x) => x.ambiguous)).toEqual([false, true, true]);
  });

  it('flags nothing ambiguous when there is no published zone', () => {
    // Nothing to mispair against.
    const d = zone(['shared.member-group', 'shared.member-group']);
    expect(pairZones(d, null).map((x) => x.ambiguous)).toEqual([false, false]);
  });

  it('pairs the draft alone when there is no published zone', () => {
    // A page that has never been published is legitimate; draft-only writes
    // are correct there.
    const d = zone(['shared.hero']);
    expect(pairZones(d, null)).toEqual([
      { draftId: 100, publishedId: null, type: 'shared.hero', index: 0, ambiguous: false },
    ]);
  });
});

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
      { draftId: 3, publishedId: 4, type: 'shared.hero', index: 0, ambiguous: false },
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

describe('CMPS_TABLE', () => {
  it('has a join table for every type that declares a CTA slot', () => {
    // Without this, a component gaining a slot without a table entry shows no
    // buttons and saves nothing — silently, with a 200. `ctaIn` returns null
    // for an unknown table and `getPage` filters nulls, so the runtime failure
    // is invisible. This test is the only loud one.
    expect(Object.keys(CMPS_TABLE).sort()).toEqual(Object.keys(CTA_SLOTS).sort());
  });
});
