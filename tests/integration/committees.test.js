import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, memberA, memberB;

const mkMember = (chapter, tag) =>
  strapi.plugin('users-permissions').service('user').add({
    username: `cm-${tag}-${RUN}@areaa.test`, email: `cm-${tag}-${RUN}@areaa.test`,
    password: 'Password123!', confirmed: true, provider: 'local',
    firstName: 'Cmte', lastName: tag, chapter: chapter.id,
  });

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `cmte-admin-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);

  memberA = await mkMember(chapterA, `Ay${RUN}`);
  memberB = await mkMember(chapterB, `Bee${RUN}`);
});

afterAll(async () => {
  const junk = await strapi.documents('api::committee.committee').findMany({
    filters: { name: { $contains: String(RUN) } }, fields: ['name'], limit: -1, status: 'draft',
  });
  for (const c of junk) {
    await strapi.documents('api::committee.committee').delete({ documentId: c.documentId });
  }

  // Fixture users are `confirmed: true` WITH a chapter, which is exactly the
  // predicate the member directory admits — sorted lastName:asc, pageSize 12.
  // Left behind they accumulate at the top of page one, and no test count
  // changes to reveal it.
  const users = await strapi.query('plugin::users-permissions.user')
    .findMany({ where: { email: { $contains: String(RUN) } } });
  for (const u of users) {
    await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
  }

  await shutdown();
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const name = (n) => `${n} ${RUN}`;

/** Read a committee's stored members straight from the DB. */
const storedMembers = async (documentId) => {
  const c = await strapi.documents('api::committee.committee').findOne({
    documentId, populate: { members: { fields: ['firstName'] } }, status: 'draft',
  });
  return (c?.members ?? []).map((m) => m.documentId);
};

describe('GET /api/chapter-admin/members', () => {
  it('lists the chapter members with an identifier the picker can submit', async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    const row = res.body.data.find((m) => m.documentId === memberA.documentId);
    expect(row).toBeDefined();
    expect(row.displayName).toContain('Cmte');
  });

  it('leaks no contact or entitlement PII', async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterA.slug}`));
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(Object.keys(row).sort()).toEqual(['displayName', 'documentId', 'title']);
    }
  });

  it("refuses another chapter's roster", async () => {
    const res = await auth(api().get(`/api/chapter-admin/members?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('POST /api/chapter-admin/committees', () => {
  it('creates a committee AND ACTUALLY ATTACHES THE MEMBERS', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Events Cmte'), chapterSlug: chapterA.slug,
              description: 'Runs events', members: [memberA.documentId] });

    expect(res.status).toBe(200);
    expect(await storedMembers(res.body.data.documentId)).toEqual([memberA.documentId]);

    const published = await strapi.documents('api::committee.committee')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('400s on a missing name rather than 500ing', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ chapterSlug: chapterA.slug, description: 'Nameless' });
    expect(res.status).toBe(400);
  });

  it('REFUSES a member from another chapter', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Trespass'), chapterSlug: chapterA.slug, members: [memberB.documentId] });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/do not belong/i);
  });

  it('400s on a malformed members payload rather than 500ing', async () => {
    const res = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Malformed'), chapterSlug: chapterA.slug, members: 'not-a-list' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/chapter-admin/committees/:documentId', () => {
  const create = (members = []) => auth(api().post('/api/chapter-admin/committees'))
    .send({ name: name(`C${Math.random().toString(36).slice(2, 7)}`), chapterSlug: chapterA.slug, members });

  it('REPLACES the member list rather than appending', async () => {
    const created = await create([memberA.documentId]);
    const second = await mkMember(chapterA, `Cee${RUN}`);

    await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [second.documentId] });

    expect(await storedMembers(created.body.data.documentId)).toEqual([second.documentId]);
  });

  it('clears the member list when sent an empty array', async () => {
    const created = await create([memberA.documentId]);
    await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [] });
    expect(await storedMembers(created.body.data.documentId)).toEqual([]);
  });

  it('leaves members untouched when the payload omits them', async () => {
    // Absent means unchanged; [] means clear. The picker's __present marker
    // exists to keep those two distinguishable across the wire.
    const created = await create([memberA.documentId]);
    await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ name: name('Renamed') });
    expect(await storedMembers(created.body.data.documentId)).toEqual([memberA.documentId]);
  });

  it('refuses a foreign member on update too', async () => {
    const created = await create();
    const res = await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ members: [memberB.documentId] });
    expect(res.status).toBe(403);
  });

  it('400s when the payload blanks the required name', async () => {
    const created = await create();
    const res = await auth(api().put(`/api/chapter-admin/committees/${created.body.data.documentId}`))
      .send({ name: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/chapter-admin/committees', () => {
  it('lists only administered chapters', async () => {
    const res = await auth(api().get('/api/chapter-admin/committees?pageSize=100'));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((c) => c.chapter?.slug === chapterA.slug)).toBe(true);
  });

  it('populates members, which the edit screen reads to pre-check the picker', async () => {
    const created = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Populated'), chapterSlug: chapterA.slug, members: [memberA.documentId] });

    const res = await auth(api().get('/api/chapter-admin/committees?pageSize=100'));
    const row = res.body.data.find((c) => c.documentId === created.body.data.documentId);
    expect(row.members).toHaveLength(1);
    expect(row.members[0].documentId).toBe(memberA.documentId);
  });
});

describe('DELETE /api/chapter-admin/committees/:documentId', () => {
  it('deletes an own committee', async () => {
    const created = await auth(api().post('/api/chapter-admin/committees'))
      .send({ name: name('Doomed'), chapterSlug: chapterA.slug });
    const res = await auth(api().delete(`/api/chapter-admin/committees/${created.body.data.documentId}`));
    expect(res.status).toBe(200);

    const gone = await strapi.documents('api::committee.committee')
      .findOne({ documentId: created.body.data.documentId, status: 'draft' });
    expect(gone).toBeNull();
  });

  it("refuses another chapter's committee", async () => {
    const foreign = await strapi.documents('api::committee.committee').create({
      data: { name: name('Theirs'), chapter: { documentId: chapterB.documentId } },
      status: 'published',
    });
    const res = await auth(api().delete(`/api/chapter-admin/committees/${foreign.documentId}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});
