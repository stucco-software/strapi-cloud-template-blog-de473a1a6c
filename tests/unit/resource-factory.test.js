import { describe, it, expect, vi } from 'vitest';
import { chapterScopedResource } from '../../src/api/chapter-admin/services/resource-factory.js';

const CHAP_A = { id: 55, documentId: 'chap-a', slug: 'boston' };
const CHAP_B = { id: 57, documentId: 'chap-b', slug: 'seattle' };

/** A fake strapi whose event store is a single record owned by `owner`. */
function fakeStrapi({ owner = CHAP_A, chapters = [CHAP_A, CHAP_B] } = {}) {
  const calls = { create: [], update: [], delete: [] };
  const api = {
    calls,
    documents: (uid) => {
      if (uid === 'plugin::users-permissions.user') {
        return { findOne: async () => ({ administeredChapters: [CHAP_A] }) };
      }
      if (uid === 'api::chapter.chapter') {
        return {
          findFirst: async ({ filters }) =>
            chapters.find((c) => c.slug === filters.slug) ?? null,
        };
      }
      return {
        findOne: async () => ({ documentId: 'ev-1', title: 'Existing', chapter: owner }),
        findMany: async () => [],
        count: async () => 0,
        create: async (args) => { calls.create.push(args); return { documentId: 'ev-new', ...args.data }; },
        update: async (args) => { calls.update.push(args); return { documentId: 'ev-1', ...args.data }; },
        delete: async (args) => { calls.delete.push(args); return {}; },
      };
    },
  };
  return api;
}

const makeCtx = (body = {}, params = {}) => ({
  state: { user: { documentId: 'u1' } },
  params,
  query: {},
  request: { body },
  body: undefined,
  badRequest: vi.fn(function (m) { this.body = { error: m }; this.status = 400; }),
  notFound: vi.fn(function (m) { this.body = { error: m }; this.status = 404; }),
  forbidden: vi.fn(function (m) { this.body = { error: m }; this.status = 403; }),
});

const resource = (strapiInstance) => chapterScopedResource({
  uid: 'api::event.event',
  editableFields: ['title', 'location'],
  hasSlug: true,
  strapiInstance,
});

describe('create', () => {
  it('creates in an administered chapter and publishes', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'Gala', chapterSlug: 'boston' });
    await resource(s).create(ctx);

    expect(s.calls.create).toHaveLength(1);
    expect(s.calls.create[0].status).toBe('published');
    expect(s.calls.create[0].data.chapter).toEqual({ documentId: 'chap-a' });
    expect(s.calls.create[0].data.slug).toBe('boston-gala');
  });

  it('refuses a chapter the caller does not administer', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: 'Trespass', chapterSlug: 'seattle' });
    await expect(resource(s).create(ctx)).rejects.toThrow(/not administered/);
    expect(s.calls.create).toHaveLength(0);
  });

  it('400s rather than 500s on an unslugifiable title', async () => {
    const s = fakeStrapi();
    const ctx = makeCtx({ title: '中文活动', chapterSlug: 'boston' });
    await resource(s).create(ctx);
    expect(ctx.badRequest).toHaveBeenCalled();
    expect(s.calls.create).toHaveLength(0);
  });

  it('400s when chapterSlug is missing', async () => {
    const s = fakeStrapi();
    await resource(s).create(makeCtx({ title: 'Gala' }));
    expect(s.calls.create).toHaveLength(0);
  });
});

describe('update', () => {
  it('updates an own record', async () => {
    const s = fakeStrapi({ owner: CHAP_A });
    await resource(s).update(makeCtx({ location: 'Oakland' }, { documentId: 'ev-1' }));
    expect(s.calls.update[0].data).toEqual({ location: 'Oakland' });
    expect(s.calls.update[0].status).toBe('published');
  });

  it('reads the chapter from the record, not the payload', async () => {
    // Record belongs to B; caller administers A. A payload claiming A must not help.
    const s = fakeStrapi({ owner: CHAP_B });
    const ctx = makeCtx({ chapterSlug: 'boston', chapter: 'chap-a' }, { documentId: 'ev-1' });
    await expect(resource(s).update(ctx)).rejects.toThrow(/not administered/);
    expect(s.calls.update).toHaveLength(0);
  });

  it('drops `chapter` from the payload even on an owned record', async () => {
    const s = fakeStrapi({ owner: CHAP_A });
    await resource(s).update(
      makeCtx({ location: 'X', chapter: 'chap-b' }, { documentId: 'ev-1' })
    );
    expect(s.calls.update[0].data).not.toHaveProperty('chapter');
  });

  it('fails closed on a record with no chapter', async () => {
    const s = fakeStrapi({ owner: null });
    await expect(
      resource(s).update(makeCtx({ location: 'X' }, { documentId: 'ev-1' }))
    ).rejects.toThrow(/No target chapter/);
  });
});

describe('delete', () => {
  it("refuses another chapter's record", async () => {
    const s = fakeStrapi({ owner: CHAP_B });
    await expect(
      resource(s).delete(makeCtx({}, { documentId: 'ev-1' }))
    ).rejects.toThrow(/not administered/);
    expect(s.calls.delete).toHaveLength(0);
  });
});
