import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AUTHENTICATED_GRANTS, CAPABILITY_GRANTS, CHAPTER_ADMIN_GRANTS, grantsFor,
} = require('../../src/api/chapter-admin/grants.js');

describe('grantsFor', () => {
  it('always includes the authenticated baseline, even for no capability', () => {
    expect(grantsFor([]).sort()).toEqual([...AUTHENTICATED_GRANTS].sort());
  });

  it('unions two capabilities rather than letting the last one win', () => {
    const both = grantsFor(['national_admin', 'chapter_admin']);
    for (const action of CAPABILITY_GRANTS.chapter_admin) {
      expect(both).toContain(action);
    }
    for (const action of CAPABILITY_GRANTS.national_admin) {
      expect(both).toContain(action);
    }
    for (const action of AUTHENTICATED_GRANTS) {
      expect(both).toContain(action);
    }
  });

  it('is order-independent', () => {
    expect(grantsFor(['national_admin', 'chapter_admin']))
      .toEqual(grantsFor(['chapter_admin', 'national_admin']));
  });

  it('de-duplicates an action two capabilities both grant', () => {
    const both = grantsFor(['national_admin', 'chapter_admin']);
    expect(new Set(both).size).toBe(both.length);
  });

  it('ignores an unrecognised capability rather than throwing', () => {
    // Capabilities are authorable in the admin UI, so an unknown slug is a
    // routine state, not a bug. It grants nothing — fail closed — but it must
    // not take the boot down with it.
    expect(grantsFor(['no_such_capability']).sort())
      .toEqual([...AUTHENTICATED_GRANTS].sort());
  });

  it('tolerates null/undefined rather than throwing', () => {
    expect(grantsFor(undefined).sort()).toEqual([...AUTHENTICATED_GRANTS].sort());
    expect(grantsFor(null).sort()).toEqual([...AUTHENTICATED_GRANTS].sort());
  });

  it('no authored list spreads another', () => {
    // The whole point of the change: with one role per user, a Chapter Admin
    // who is also a Committee Leader needed a THIRD role re-listing both sets.
    for (const [slug, actions] of Object.entries(CAPABILITY_GRANTS)) {
      for (const authenticated of AUTHENTICATED_GRANTS) {
        expect(actions, `${slug} re-lists ${authenticated}`).not.toContain(authenticated);
      }
    }
  });

  it('reproduces the shipped chapter-admin grant list exactly', () => {
    // 30 distinct actions: the 5 authenticated + the 25 chapter-admin ones.
    expect(CHAPTER_ADMIN_GRANTS).toHaveLength(30);
    expect(new Set(CHAPTER_ADMIN_GRANTS).size).toBe(30);
  });
});
