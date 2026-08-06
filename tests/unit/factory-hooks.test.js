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

describe('getOne', () => {
  const res = (s, extra = {}) => chapterScopedResource({
    uid: 'api::committee.committee', editableFields: ['name'],
    strapiInstance: s, ...extra,
  });

  it('returns a record in an administered chapter', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({}, { documentId: 'r-1' });
    await res(s).getOne(ctx);
    expect(ctx.body.data.documentId).toBe('r-1');
  });

  it('404s a record that does not exist', async () => {
    const s = fakeStrapi({ stored: null });
    const ctx = makeCtx({}, { documentId: 'nope' });
    await res(s).getOne(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('404s — does NOT 403 — a record with no chapter at all', async () => {
    // `chapter` is not required on event/news/committee, and the real database
    // holds national content with none. A 403 here would make this new read
    // surface an existence oracle: 403 means it exists, 404 means it does not.
    const s = fakeStrapi({ stored: { documentId: 'r-1', chapter: null } });
    const ctx = makeCtx({}, { documentId: 'r-1' });
    await res(s).getOne(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('403s a record in a chapter the caller does not administer', async () => {
    const s = fakeStrapi({ stored: { documentId: 'r-1', chapter: { documentId: 'chap-z', slug: 'seattle' } } });
    await expect(res(s).getOne(makeCtx({}, { documentId: 'r-1' })))
      .rejects.toThrow(/not administered/);
  });

  it('404s when chapterSlug names a different chapter than the record is in', async () => {
    const s = fakeStrapi();                 // stored record is in chap-a / boston
    const ctx = makeCtx({}, { documentId: 'r-1' });
    ctx.query = { chapterSlug: 'seattle' };
    await res(s).getOne(ctx);
    expect(ctx.notFound).toHaveBeenCalled();
  });

  it('applies getOnePopulate so the edit screen gets its relations', async () => {
    const s = fakeStrapi();
    const seen = [];
    const orig = s.documents;
    // Gated on uid: resolveAdministeredChapters reads the USER first, so an
    // ungated spy asserts against the wrong call.
    s.documents = (uid) => {
      const d = orig(uid);
      if (uid !== 'api::committee.committee') return d;
      return { ...d, findOne: async (args) => { seen.push(args); return d.findOne(args); } };
    };
    await res(s, { getOnePopulate: { members: { fields: ['firstName'] } } })
      .getOne(makeCtx({}, { documentId: 'r-1' }));
    expect(seen[0].populate).toHaveProperty('members');
    expect(seen[0].populate).toHaveProperty('chapter');   // always merged
  });

  it('falls back to listPopulate when getOnePopulate is unset', async () => {
    // The edit screen needs at least what the list needs. Without this, adding
    // a relation to listPopulate alone silently leaves the edit form blank.
    const s = fakeStrapi();
    const seen = [];
    const orig = s.documents;
    s.documents = (uid) => {
      const d = orig(uid);
      if (uid !== 'api::committee.committee') return d;
      return { ...d, findOne: async (args) => { seen.push(args); return d.findOne(args); } };
    };
    await res(s, { listPopulate: { figure: { fields: ['url'] } } })
      .getOne(makeCtx({}, { documentId: 'r-1' }));
    expect(seen[0].populate).toHaveProperty('figure');
  });
});
