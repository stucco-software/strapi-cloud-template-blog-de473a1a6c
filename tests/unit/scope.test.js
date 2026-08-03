import { describe, it, expect } from 'vitest';
import {
  assertChapterScope, ScopeError, resolveAdministeredChapters,
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
