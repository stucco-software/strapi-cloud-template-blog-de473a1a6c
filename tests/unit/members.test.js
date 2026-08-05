import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// All three modules through ONE createRequire. Mixing `import` here with the
// `require` inside members.js gives Vitest two distinct module instances, so
// toThrow(BadInputError) fails with the right error and the wrong class object —
// the same class-identity hazard the controller's ScopeError comment warns
// about, firing in the test harness instead of the service registry.
const require = createRequire(import.meta.url);
const {
  toDirectoryRow, normaliseMemberIds, assertMembersInChapter, MEMBER_FIELDS,
} = require('../../src/api/chapter-admin/services/members.js');
const { ScopeError } = require('../../src/api/chapter-admin/services/scope.js');
const { BadInputError } = require('../../src/api/chapter-admin/services/fields.js');

describe('toDirectoryRow', () => {
  it('returns an identifier the picker can submit', () => {
    expect(toDirectoryRow({ id: 7, documentId: 'usr-1', firstName: 'Mei', lastName: 'Tanaka' }).documentId)
      .toBe('usr-1');
  });

  it('falls back to first + last when displayName is empty', () => {
    expect(toDirectoryRow({ documentId: 'u', firstName: 'Mei', lastName: 'Tanaka' }).displayName)
      .toBe('Mei Tanaka');
  });

  it('prefers an explicit displayName', () => {
    expect(toDirectoryRow({ documentId: 'u', firstName: 'Mei', lastName: 'T', displayName: 'M. Tanaka' }).displayName)
      .toBe('M. Tanaka');
  });

  it('leaks no contact or entitlement PII', () => {
    const row = toDirectoryRow({
      documentId: 'u', firstName: 'A', lastName: 'B',
      email: 'a@b.test', phone: '555', postalCode: '94110',
      status: 'Active', duesPaidThrough: '2027-01-01', password: 'x',
    });
    for (const leaked of ['email', 'phone', 'postalCode', 'status', 'duesPaidThrough', 'password']) {
      expect(row).not.toHaveProperty(leaked);
    }
    expect(Object.keys(row).sort()).toEqual([...MEMBER_FIELDS].sort());
  });

  it('never returns undefined values', () => {
    const row = toDirectoryRow({ documentId: 'u' });
    expect(row.displayName).toBe('');
    expect(row.title).toBe('');
  });
});

describe('normaliseMemberIds', () => {
  it('accepts a list of id strings', () => {
    expect(normaliseMemberIds(['m1', 'm2'])).toEqual(['m1', 'm2']);
  });

  it('accepts longhand relation objects', () => {
    expect(normaliseMemberIds([{ documentId: 'm1' }])).toEqual(['m1']);
  });

  it('de-duplicates', () => {
    expect(normaliseMemberIds(['m1', 'm1'])).toEqual(['m1']);
  });

  it('accepts an empty list — removing everyone is legal', () => {
    expect(normaliseMemberIds([])).toEqual([]);
  });

  it('400s rather than 500s on a non-array', () => {
    expect(() => normaliseMemberIds('m1')).toThrow(BadInputError);
  });

  it('rejects a bare null rather than treating it as "clear"', () => {
    // Strapi accepts `members: null` and silently clears the relation, so the
    // hook's `'members' in data` guard would let a stray null wipe the roster
    // while `members: 'x'` correctly 400s.
    expect(() => normaliseMemberIds(null)).toThrow(BadInputError);
  });

  it('rejects entries that are not usable ids', () => {
    for (const bad of [[''], [null], [undefined], [5], [{ id: 5 }], [{}]]) {
      expect(() => normaliseMemberIds(bad)).toThrow(BadInputError);
    }
  });
});

describe('assertMembersInChapter', () => {
  /** Records the filter it was called with, so the test can assert on it. */
  const spyStrapi = (rows) => {
    const seen = [];
    return {
      seen,
      documents: () => ({
        findMany: async (args) => { seen.push(args); return rows; },
      }),
    };
  };

  it('accepts members of the chapter', async () => {
    const s = spyStrapi([{ documentId: 'm1' }, { documentId: 'm2' }]);
    await expect(assertMembersInChapter(s, 'chap-a', ['m1', 'm2'])).resolves.toBe(true);
  });

  it('SCOPES THE QUERY TO THE CHAPTER', async () => {
    // Without asserting on the filter, deleting the chapter clause — the whole
    // point of this function — would leave every test green.
    const s = spyStrapi([{ documentId: 'm1' }]);
    await assertMembersInChapter(s, 'chap-a', ['m1']);
    expect(s.seen[0].filters.chapter).toEqual({ documentId: 'chap-a' });
    expect(s.seen[0].filters.documentId).toEqual({ $in: ['m1'] });
  });

  it('excludes blocked users from the accepted set', async () => {
    const s = spyStrapi([{ documentId: 'm1' }]);
    await assertMembersInChapter(s, 'chap-a', ['m1']);
    expect(s.seen[0].filters.blocked).toEqual({ $ne: true });
  });

  it('does not query at all for an empty selection', async () => {
    const s = spyStrapi([]);
    await expect(assertMembersInChapter(s, 'chap-a', [])).resolves.toBe(true);
    expect(s.seen).toHaveLength(0);
  });

  it('rejects a user who is not in the chapter', async () => {
    const s = spyStrapi([{ documentId: 'm1' }]);
    await expect(assertMembersInChapter(s, 'chap-a', ['m1', 'outsider']))
      .rejects.toThrow(ScopeError);
  });

  it('rejects an outsider even when a valid member is present', async () => {
    const s = spyStrapi([{ documentId: 'm1' }]);
    await expect(assertMembersInChapter(s, 'chap-a', ['m1', 'outsider']))
      .rejects.toThrow(/do not belong/i);
  });
});
