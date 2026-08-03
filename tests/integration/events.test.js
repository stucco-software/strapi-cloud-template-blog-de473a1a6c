import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();                       // uniquifies titles per run
let strapi, chapterA, chapterB, tokenA;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `admin-a-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);
});

afterAll(async () => { await shutdown(); });

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const title = (name) => `${name} ${RUN}`;

/** Create an event owned by `chapter` directly, bypassing the API. */
async function seedEvent(chapter, name) {
  return strapi.documents('api::event.event').create({
    data: {
      title: title(name),
      slug: `${chapter.slug}-${name.toLowerCase()}-${RUN}`,
      chapter: { documentId: chapter.documentId },
    },
    status: 'published',
  });
}

describe('POST /api/chapter-admin/events', () => {
  it('creates in an administered chapter, published and slugged', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Spring Gala'), chapterSlug: chapterA.slug, location: 'SF' });

    expect(res.status).toBe(200);
    expect(res.body.data.slug.startsWith(`${chapterA.slug}-spring-gala`)).toBe(true);

    // The whole point of CA11: visible to a PUBLISHED read, not just written.
    const published = await strapi.documents('api::event.event')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('de-collides a duplicate title in the same chapter', async () => {
    const body = { title: title('Repeat Night'), chapterSlug: chapterA.slug };
    const first = await auth(api().post('/api/chapter-admin/events')).send(body);
    const second = await auth(api().post('/api/chapter-admin/events')).send(body);

    expect(second.body.data.slug).toBe(`${first.body.data.slug}-2`);
  });

  it('refuses a chapter the caller does not administer', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Trespass'), chapterSlug: chapterB.slug });
    expect(res.status).toBe(403);
    // On the scope check specifically — not 403 for an incidental reason such
    // as a missing chapter or an unresolvable slug.
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('400s on an unslugifiable title rather than 500ing', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: '中文活动', chapterSlug: chapterA.slug });
    expect(res.status).toBe(400);
  });

  it('ignores non-whitelisted fields', async () => {
    const res = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Clean'), chapterSlug: chapterA.slug, slug: 'attacker-chosen' });
    expect(res.body.data.slug).not.toBe('attacker-chosen');
  });

  it('rejects an unauthenticated request', async () => {
    const res = await api().post('/api/chapter-admin/events')
      .send({ title: title('Anon'), chapterSlug: chapterA.slug });
    expect([401, 403]).toContain(res.status);
  });
});

describe('PUT /api/chapter-admin/events/:documentId', () => {
  it('updates an own event', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Editable'), chapterSlug: chapterA.slug });
    const res = await auth(api().put(`/api/chapter-admin/events/${created.body.data.documentId}`))
      .send({ location: 'Oakland' });

    expect(res.status).toBe(200);
    expect(res.body.data.location).toBe('Oakland');
  });

  it('cannot move an event to another chapter via the payload', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Stay Put'), chapterSlug: chapterA.slug });
    await auth(api().put(`/api/chapter-admin/events/${created.body.data.documentId}`))
      .send({ chapter: chapterB.documentId, chapterSlug: chapterB.slug, location: 'Nice try' });

    const after = await strapi.documents('api::event.event').findOne({
      documentId: created.body.data.documentId,
      populate: { chapter: { fields: ['slug'] } },
      status: 'draft',
    });
    expect(after.chapter.documentId).toBe(chapterA.documentId);
  });

  it("refuses another chapter's event, on the scope check", async () => {
    const foreign = await seedEvent(chapterB, 'Theirs');
    const res = await auth(api().put(`/api/chapter-admin/events/${foreign.documentId}`))
      .send({ location: 'Hijacked' });

    expect(res.status).toBe(403);
    // Must fail because the chapter is not administered — NOT because the
    // record has no chapter at all, which would be a test that cannot fail.
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('GET /api/chapter-admin/events', () => {
  it('lists only administered chapters', async () => {
    const res = await auth(api().get('/api/chapter-admin/events'));
    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.chapter?.slug === chapterA.slug)).toBe(true);
  });
});

describe('DELETE /api/chapter-admin/events/:documentId', () => {
  it('deletes an own event', async () => {
    const created = await auth(api().post('/api/chapter-admin/events'))
      .send({ title: title('Doomed'), chapterSlug: chapterA.slug });
    const res = await auth(api().delete(`/api/chapter-admin/events/${created.body.data.documentId}`));
    expect(res.status).toBe(200);
  });

  it("refuses another chapter's event, on the scope check", async () => {
    const foreign = await seedEvent(chapterB, 'NotYours');
    const res = await auth(api().delete(`/api/chapter-admin/events/${foreign.documentId}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('POST /api/chapter-admin/media', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  it('accepts a real PNG', async () => {
    const res = await auth(api().post('/api/chapter-admin/media'))
      .attach('files', png, { filename: 'ok.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBeDefined();
  });

  it('rejects an SVG disguised as a PNG — the header is not trusted', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await auth(api().post('/api/chapter-admin/media'))
      .attach('files', svg, { filename: 'evil.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});
