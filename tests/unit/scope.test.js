import { describe, it, expect } from 'vitest';
import {
  assertChapterScope, assertCommitteeScope, ScopeError,
  resolveAdministeredChapters, resolveAuthority,
} from '../../src/api/chapter-admin/services/scope.js';

describe('assertChapterScope', () => {
  it('allows a documentId the user administers', () => {
    expect(assertChapterScope(['doc-a', 'doc-b'], 'doc-a')).toBe(true);
  });

  it('rejects one they do not', () => {
    expect(() => assertChapterScope(['doc-a'], 'doc-c')).toThrow(ScopeError);
  });

  it('rejects when the user administers nothing', () => {
    expect(() => assertChapterScope([], 'doc-a')).toThrow(ScopeError);
    expect(() => assertChapterScope(undefined, 'doc-a')).toThrow(ScopeError);
  });

  it('fails closed on a missing target', () => {
    for (const bad of [null, undefined, '']) {
      expect(() => assertChapterScope(['doc-a'], bad)).toThrow(ScopeError);
    }
  });

  it('does not treat a substring as a hit', () => {
    expect(() => assertChapterScope(['doc-ab'], 'doc-a')).toThrow(ScopeError);
  });

  it('lets an unscoped caller through for any chapter', () => {
    expect(assertChapterScope([], 'doc-anything', { unscoped: true })).toBe(true);
    expect(assertChapterScope(undefined, 'doc-anything', { unscoped: true })).toBe(true);
  });

  it('still fails closed on a missing target when unscoped', () => {
    // National Admin bypasses WHICH chapter, never WHETHER there is one. A
    // request that names no chapter is malformed regardless of who sent it,
    // and answering it would mean guessing which records to act on.
    for (const bad of [null, undefined, '']) {
      expect(() => assertChapterScope(['doc-a'], bad, { unscoped: true }))
        .toThrow(ScopeError);
    }
  });

  it('defaults to scoped when no options are passed', () => {
    expect(() => assertChapterScope(['doc-a'], 'doc-c')).toThrow(ScopeError);
    expect(() => assertChapterScope(['doc-a'], 'doc-c', {})).toThrow(ScopeError);
    expect(() => assertChapterScope(['doc-a'], 'doc-c', { unscoped: false }))
      .toThrow(ScopeError);
  });
});

describe('assertCommitteeScope', () => {
  it('allows a documentId the user leads', () => {
    expect(assertCommitteeScope(['cmt-a', 'cmt-b'], 'cmt-a')).toBe(true);
  });

  it('rejects a committee they do not lead — the cross-scope attack', () => {
    expect(() => assertCommitteeScope(['cmt-a'], 'cmt-c')).toThrow(ScopeError);
  });

  it('rejects when the user leads nothing', () => {
    expect(() => assertCommitteeScope([], 'cmt-a')).toThrow(ScopeError);
    expect(() => assertCommitteeScope(undefined, 'cmt-a')).toThrow(ScopeError);
  });

  it('fails closed on a missing target', () => {
    for (const bad of [null, undefined, '']) {
      expect(() => assertCommitteeScope(['cmt-a'], bad)).toThrow(ScopeError);
    }
  });

  it('does not treat a substring as a hit', () => {
    expect(() => assertCommitteeScope(['cmt-ab'], 'cmt-a')).toThrow(ScopeError);
  });

  it('compares documentIds, so a numeric entry id is never a hit', () => {
    // `committee` is draft-and-publish: one document, two rows, two numeric
    // ids, one documentId. Comparing entry ids rejects every legitimate
    // request while looking like a working check.
    expect(() => assertCommitteeScope(['cmt-a'], 42)).toThrow(ScopeError);
  });

  it('lets an unscoped caller through, and still needs a target', () => {
    expect(assertCommitteeScope([], 'cmt-anything', { unscoped: true })).toBe(true);
    expect(() => assertCommitteeScope([], null, { unscoped: true })).toThrow(ScopeError);
  });
});

describe('resolveAdministeredChapters', () => {
  const fakeStrapi = (chapters) => ({
    documents: () => ({ findOne: async () => ({ administeredChapters: chapters }) }),
  });

  it('returns documentIds, not numeric entry ids', async () => {
    const ctx = { state: { user: { documentId: 'u1' } } };
    const ids = await resolveAdministeredChapters(ctx, fakeStrapi([
      { id: 55, documentId: 'chap-a', slug: 'boston' },
      { id: 57, documentId: 'chap-b', slug: 'seattle' },
    ]));
    expect(ids).toEqual(['chap-a', 'chap-b']);
  });

  it('returns an empty array when the user administers nothing', async () => {
    const ctx = { state: { user: { documentId: 'u1' } } };
    expect(await resolveAdministeredChapters(ctx, fakeStrapi([]))).toEqual([]);
    expect(await resolveAdministeredChapters({ state: { user: { documentId: 'u2' } } },
      fakeStrapi(null))).toEqual([]);
  });

  it('queries once per request and memoizes on the context', async () => {
    let calls = 0;
    const counting = {
      documents: () => ({
        findOne: async () => { calls += 1; return { administeredChapters: [{ documentId: 'chap-a' }] }; },
      }),
    };
    const ctx = { state: { user: { documentId: 'u1' } } };
    await resolveAdministeredChapters(ctx, counting);
    await resolveAdministeredChapters(ctx, counting);
    expect(calls).toBe(1);
  });
});

describe('resolveAuthority', () => {
  const USER = {
    documentId: 'u1',
    capabilities: [{ slug: 'chapter_admin' }, { slug: 'national_admin' }],
    administeredChapters: [{ id: 55, documentId: 'chap-a', slug: 'boston' }],
    ledCommittees: [{ id: 9, documentId: 'cmt-a', name: 'Events' }],
  };

  const fakeStrapi = (user, counter) => ({
    documents: () => ({
      findOne: async () => { counter.n += 1; return user; },
    }),
  });

  it('returns capabilities, chapters and committees as slugs/documentIds', async () => {
    const ctx = { state: { user: { documentId: 'u1' } } };
    const auth = await resolveAuthority(ctx, fakeStrapi(USER, { n: 0 }));
    expect([...auth.capabilities].sort()).toEqual(['chapter_admin', 'national_admin']);
    expect(auth.chapters).toEqual(['chap-a']);
    expect(auth.committees).toEqual(['cmt-a']);
  });

  it('costs exactly one query per request, memoized on the context', async () => {
    // Also pins that resolveAdministeredChapters shares the memo: every
    // existing caller must get the cached answer, not a second round trip.
    const counter = { n: 0 };
    const ctx = { state: { user: { documentId: 'u1' } } };
    const strapi = fakeStrapi(USER, counter);
    await resolveAuthority(ctx, strapi);
    await resolveAuthority(ctx, strapi);
    await resolveAdministeredChapters(ctx, strapi);
    expect(counter.n).toBe(1);
  });

  it('is empty, not undefined, for a user holding nothing', async () => {
    const ctx = { state: { user: { documentId: 'u2' } } };
    const auth = await resolveAuthority(ctx, fakeStrapi({ documentId: 'u2' }, { n: 0 }));
    expect([...auth.capabilities]).toEqual([]);
    expect(auth.chapters).toEqual([]);
    expect(auth.committees).toEqual([]);
  });
});
