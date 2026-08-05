import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

// Loaded through one createRequire so the error classes asserted on here are
// the SAME class objects the services throw. An ESM import beside a CJS require
// gives Vitest two distinct module instances and `instanceof` silently fails.
const require = createRequire(import.meta.url);
const { chapterScopedResource } = require('../../src/api/chapter-admin/services/resource-factory.js');
const { BadInputError } = require('../../src/api/chapter-admin/services/fields.js');

const CHAP = { id: 55, documentId: 'chap-a', slug: 'boston' };

function fakeStrapi({ stored = { documentId: 'r-1', chapter: CHAP } } = {}) {
  const calls = { create: [], update: [] };
  return {
    calls,
    documents: (uid) => {
      if (uid === 'plugin::users-permissions.user') {
        return { findOne: async () => ({ administeredChapters: [CHAP] }) };
      }
      if (uid === 'api::chapter.chapter') {
        return { findFirst: async ({ filters }) => (filters.slug === CHAP.slug ? CHAP : null) };
      }
      return {
        findOne: async () => stored,
        findMany: async () => [],
        count: async () => 0,
        create: async (a) => { calls.create.push(a); return { documentId: 'new', ...a.data }; },
        update: async (a) => { calls.update.push(a); return { documentId: 'r-1', ...a.data }; },
      };
    },
  };
}

const makeCtx = (body = {}, params = {}) => ({
  state: { user: { documentId: 'u1' } },
  params, query: {}, request: { body }, body: undefined,
  badRequest: vi.fn(function (m) { this.body = { error: m }; this.status = 400; }),
  notFound: vi.fn(function (m) { this.body = { error: m }; this.status = 404; }),
  forbidden: vi.fn(function (m) { this.body = { error: m }; this.status = 403; }),
});

describe('requiredFields', () => {
  const res = (s) => chapterScopedResource({
    uid: 'api::news-item.news-item', editableFields: ['title', 'body'],
    requiredFields: ['title', 'body'], strapiInstance: s,
  });

  it('400s on create when a required field is missing', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'T', chapterSlug: 'boston' });
    await res(s).create(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('body is required');
    expect(s.calls.create).toHaveLength(0);
  });

  it('treats an empty array as missing', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'T', body: [], chapterSlug: 'boston' });
    await res(s).create(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
  });

  it('400s on update when the payload BLANKS a required field', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: '' }, { documentId: 'r-1' });
    await res(s).update(ctx);
    expect(ctx.badRequest).toHaveBeenCalledWith('title is required');
    expect(s.calls.update).toHaveLength(0);
  });

  it('allows a partial update that OMITS a required field', async () => {
    const s = fakeStrapi();
    await res(s).update(makeCtx({ body: [{ t: 1 }] }, { documentId: 'r-1' }));
    expect(s.calls.update).toHaveLength(1);
  });
});

describe('deriveOnCreate', () => {
  it('overrides a client-supplied value', async () => {
    const s = fakeStrapi();
    const r = chapterScopedResource({
      uid: 'api::news-item.news-item', editableFields: ['title', 'author'],
      deriveOnCreate: (ctx) => ({ author: { documentId: ctx.state.user.documentId } }),
      strapiInstance: s,
    });
    await r.create(makeCtx({ title: 'T', author: { documentId: 'someone-else' }, chapterSlug: 'boston' }));
    expect(s.calls.create[0].data.author).toEqual({ documentId: 'u1' });
  });
});

describe('validateData', () => {
  it('runs on create and can reject with a 400', async () => {
    const s = fakeStrapi();
    const r = chapterScopedResource({
      uid: 'x', editableFields: ['title'], strapiInstance: s,
      validateData: async () => { throw new BadInputError('nope'); },
    });
    await expect(r.create(makeCtx({ title: 'T', chapterSlug: 'boston' })))
      .rejects.toThrow(BadInputError);
    expect(s.calls.create).toHaveLength(0);
  });

  it("runs on UPDATE too, with the stored record's chapter", async () => {
    const s = fakeStrapi();
    const seen = [];
    const r = chapterScopedResource({
      uid: 'x', editableFields: ['title'], strapiInstance: s,
      validateData: async (_d, meta) => { seen.push(meta.chapterDocumentId); },
    });
    await r.update(makeCtx({ title: 'T' }, { documentId: 'r-1' }));
    expect(seen).toEqual(['chap-a']);
  });

  it('normalisation performed by the hook reaches the write', async () => {
    // The hook mutates `data` in place; nothing else verifies the coercion
    // survives to create(). This is the mechanism the committee picker rides on.
    const s = fakeStrapi();
    const r = chapterScopedResource({
      uid: 'x', editableFields: ['members'], strapiInstance: s,
      validateData: async (data) => { data.members = [{ documentId: 'm1' }]; },
    });
    await r.create(makeCtx({ members: ['m1'], chapterSlug: 'boston' }));
    expect(s.calls.create[0].data.members).toEqual([{ documentId: 'm1' }]);
  });
});
