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
    // 41 distinct actions: the 5 authenticated + the 36 chapter-admin ones.
    // Was 30/25 — chapter-owned sponsors added list/get/create/update/delete
    // for both `tiers` and `own-partners`, plus the roster read.
    expect(CHAPTER_ADMIN_GRANTS).toHaveLength(41);
    expect(new Set(CHAPTER_ADMIN_GRANTS).size).toBe(41);
  });
});

const {
  assertCapability, heldWithImplied, IMPLIES, CAPABILITY_SLUGS,
} = require('../../src/api/chapter-admin/services/capabilities.js');
const { ScopeError } = require('../../src/api/chapter-admin/services/scope.js');

describe('assertCapability', () => {
  it('allows a capability held directly', () => {
    expect(assertCapability(['chapter_admin'], 'chapter_admin')).toBe(true);
  });

  it('accepts a Set, which is what resolveAuthority returns', () => {
    expect(assertCapability(new Set(['chapter_admin']), 'chapter_admin')).toBe(true);
  });

  it('rejects one not held', () => {
    expect(() => assertCapability(['committee_leader'], 'chapter_admin'))
      .toThrow(ScopeError);
  });

  it('rejects when nothing is held', () => {
    expect(() => assertCapability([], 'chapter_admin')).toThrow(ScopeError);
    expect(() => assertCapability(undefined, 'chapter_admin')).toThrow(ScopeError);
  });

  it('fails closed when the route declares no capability', () => {
    // A handler wired without a declared capability must be unreachable, not
    // wide open. This is the failure mode the whole design has to survive.
    for (const bad of [null, undefined, '']) {
      expect(() => assertCapability(['chapter_admin'], bad)).toThrow(ScopeError);
    }
  });

  it('does not treat a substring as a hit', () => {
    expect(() => assertCapability(['chapter_admin_x'], 'chapter_admin'))
      .toThrow(ScopeError);
  });

  it('lets national_admin stand in for chapter_admin, by declaration', () => {
    expect(assertCapability(['national_admin'], 'chapter_admin')).toBe(true);
    expect(IMPLIES.national_admin).toContain('chapter_admin');
  });

  it('does not imply in the other direction', () => {
    expect(() => assertCapability(['chapter_admin'], 'national_admin'))
      .toThrow(ScopeError);
  });

  it('every implied slug is a real capability', () => {
    for (const implied of Object.values(IMPLIES).flat()) {
      expect(CAPABILITY_SLUGS).toContain(implied);
    }
  });

  it('lists the same slugs the seed creates', () => {
    const { CAPABILITIES } = require('../../src/api/member-capability/seed.js');
    expect([...CAPABILITY_SLUGS].sort())
      .toEqual(CAPABILITIES.map((c) => c.slug).sort());
  });
});

describe('heldWithImplied', () => {
  it('expands one held capability into everything it implies', () => {
    expect([...heldWithImplied(['national_admin'])].sort())
      .toEqual(['chapter_admin', 'national_admin']);
  });

  it('is a no-op for a capability that implies nothing', () => {
    expect([...heldWithImplied(['committee_leader'])]).toEqual(['committee_leader']);
  });

  it('is empty for nothing held', () => {
    expect([...heldWithImplied([])]).toEqual([]);
    expect([...heldWithImplied(undefined)]).toEqual([]);
  });
});
