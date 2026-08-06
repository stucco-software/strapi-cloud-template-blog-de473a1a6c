import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// One createRequire: an ESM import beside the service's CJS require gives two
// class objects and `toThrow(BadInputError)` fails on the wrong one.
const require = createRequire(import.meta.url);
const {
  toPartnerRow, normalisePartnerIds, findPartnerGroups, PARTNER_FIELDS,
} = require('../../src/api/chapter-admin/services/partners.js');
const { BadInputError } = require('../../src/api/chapter-admin/services/fields.js');

describe('toPartnerRow', () => {
  it('returns what the picker needs to render and submit', () => {
    expect(toPartnerRow({
      documentId: 'p1', name: 'Chase', sponsorshipLevel: 'Gold',
      logo: { url: '/uploads/chase.png' },
    })).toEqual({
      documentId: 'p1', name: 'Chase', sponsorshipLevel: 'Gold', logoUrl: '/uploads/chase.png',
    });
  });

  it('tolerates a missing logo even though the schema requires one', () => {
    expect(toPartnerRow({ documentId: 'p1', name: 'Chase' }).logoUrl).toBe('');
  });

  it('never returns undefined values', () => {
    const row = toPartnerRow({ documentId: 'p1' });
    expect(Object.keys(row).sort()).toEqual([...PARTNER_FIELDS].sort());
    for (const v of Object.values(row)) expect(v).not.toBeUndefined();
  });
});

describe('normalisePartnerIds', () => {
  it('accepts id strings and longhand objects', () => {
    expect(normalisePartnerIds(['p1', { documentId: 'p2' }])).toEqual(['p1', 'p2']);
  });

  it('de-duplicates', () => {
    expect(normalisePartnerIds(['p1', 'p1'])).toEqual(['p1']);
  });

  it('preserves order — partner_ord is a real column the microsite renders by', () => {
    expect(normalisePartnerIds(['p3', 'p1', 'p2'])).toEqual(['p3', 'p1', 'p2']);
  });

  it('accepts an empty list — detaching everything is legal', () => {
    expect(normalisePartnerIds([])).toEqual([]);
  });

  it('treats undefined as absent', () => {
    expect(normalisePartnerIds(undefined)).toEqual([]);
  });

  it('rejects a bare null rather than treating it as "detach all"', () => {
    expect(() => normalisePartnerIds(null)).toThrow(BadInputError);
  });

  it('rejects a non-array', () => {
    expect(() => normalisePartnerIds('p1')).toThrow(BadInputError);
  });

  it('rejects entries that are not usable ids', () => {
    for (const bad of [[''], [null], [5], [{}], [{ id: 5 }]]) {
      expect(() => normalisePartnerIds(bad)).toThrow(BadInputError);
    }
  });
});

// findPartnerGroups is where this task's complexity lives, and integration
// covers only the two happy branches. These four cover the rest — including the
// published-only case, which is a live data-loss path rather than a curiosity.
describe('findPartnerGroups', () => {
  // Returns whatever `pages[status]` holds. `null` means "no home page".
  const stub = (pages) => ({
    documents: () => ({ findFirst: async ({ status }) => pages[status] ?? null }),
  });
  const withGroup = (id) => ({ components: [{ __component: 'shared.partner-group', id }] });

  it('reports no-home-page when neither status has one', async () => {
    expect(await findPartnerGroups(stub({}), 'pdx')).toEqual({ error: 'no-home-page' });
  });

  it('reports no-partner-group when the page has no slot at either status', async () => {
    const pages = { draft: { components: [{ __component: 'shared.hero' }] }, published: null };
    expect(await findPartnerGroups(stub(pages), 'boston')).toEqual({ error: 'no-partner-group' });
  });

  it('reports no-partner-group when only PUBLISHED has a slot', async () => {
    // The data-loss case. Reachable by removing the Partner Group section in
    // the admin panel and saving without publishing. Returning {groups:
    // {published}} here would let the form render a picker with nothing checked
    // while the live site still shows sponsors — and one Save would wipe them.
    const pages = { draft: { components: [] }, published: withGroup(35) };
    expect(await findPartnerGroups(stub(pages), 'aloha-hawaii'))
      .toEqual({ error: 'no-partner-group' });
  });

  it('returns both slots when both statuses have one, keyed by status', async () => {
    const pages = { draft: withGroup(34), published: withGroup(35) };
    expect(await findPartnerGroups(stub(pages), 'aloha-hawaii'))
      .toEqual({ groups: { draft: 34, published: 35 } });
  });

  it('returns the draft slot alone for a never-published page', async () => {
    // The mirror of the case above, and legitimate: writing draft-only is
    // correct when there is no published component to keep in step.
    const pages = { draft: withGroup(34), published: null };
    expect(await findPartnerGroups(stub(pages), 'greater-chicago'))
      .toEqual({ groups: { draft: 34 } });
  });
});
