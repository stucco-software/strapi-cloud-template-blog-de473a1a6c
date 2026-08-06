import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
const BODY = [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }];
let strapi, chapterA, chapterB, tokenBoth, tokenA;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);

  const both = await makeChapterAdmin(strapi, {
    email: `sr-both-${RUN}@areaa.test`, chapterIds: [chapterA.id, chapterB.id],
  });
  tokenBoth = await jwtFor(strapi, both.id);

  const one = await makeChapterAdmin(strapi, {
    email: `sr-one-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, one.id);
});

afterAll(async () => {
  try {
    for (const uid of ['api::committee.committee', 'api::news-item.news-item', 'api::event.event']) {
      const field = uid.includes('committee') ? 'name' : 'title';
      const junk = await strapi.documents(uid).findMany({
        filters: { [field]: { $contains: String(RUN) } }, limit: -1, status: 'draft',
      });
      for (const r of junk) await strapi.documents(uid).delete({ documentId: r.documentId });
    }
    const users = await strapi.query('plugin::users-permissions.user')
      .findMany({ where: { email: { $contains: String(RUN) } } });
    for (const u of users) {
      await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
    }
  } finally {
    // ALWAYS shut down. helpers.js documents that skipping it produces
    // ERR_IPC_CHANNEL_CLOSED and a red suite that means nothing.
    await shutdown();
  }
});

const api = () => request(strapi.server.httpServer);
const as = (token) => (r) => r.set('Authorization', `Bearer ${token}`);
const tag = (n) => `${n} ${RUN}`;

const seed = async (token, chapter) => {
  const auth = as(token);
  const cm = await auth(api().post('/api/chapter-admin/committees'))
    .send({ name: tag('SR Cmte'), chapterSlug: chapter.slug });
  const nw = await auth(api().post('/api/chapter-admin/news'))
    .send({ title: tag('SR News'), chapterSlug: chapter.slug, body: BODY });
  const ev = await auth(api().post('/api/chapter-admin/events'))
    .send({ title: tag('SR Event'), chapterSlug: chapter.slug });
  return { cm: cm.body.data, nw: nw.body.data, ev: ev.body.data };
};

describe('GET /api/chapter-admin/<resource>/:documentId', () => {
  let own;
  beforeAll(async () => { own = await seed(tokenA, chapterA); });

  it('returns each resource with its edit-screen relations populated', async () => {
    const cm = await as(tokenA)(api().get(`/api/chapter-admin/committees/${own.cm.documentId}`));
    expect(cm.status).toBe(200);
    expect(cm.body.data.chapter.slug).toBe(chapterA.slug);
    expect(cm.body.data).toHaveProperty('members');

    const nw = await as(tokenA)(api().get(`/api/chapter-admin/news/${own.nw.documentId}`));
    expect(nw.status).toBe(200);
    expect(nw.body.data.author).toBeTruthy();

    // v1 asserted only status here, so a missing events getOnePopulate went
    // undetected — the figure key must be present even when null.
    const ev = await as(tokenA)(api().get(`/api/chapter-admin/events/${own.ev.documentId}`));
    expect(ev.status).toBe(200);
    expect(ev.body.data).toHaveProperty('figure');
  });

  it('404s a documentId that does not exist', async () => {
    const res = await as(tokenA)(api().get('/api/chapter-admin/committees/doesnotexist000000000000'));
    expect(res.status).toBe(404);
  });

  it('404s a chapterless record rather than confirming it exists', async () => {
    // The seed holds national events with no chapter. A 403 would be an
    // existence oracle on a brand-new read surface.
    const national = await strapi.documents('api::event.event')
      .findFirst({ filters: { chapter: { documentId: { $null: true } } }, fields: ['title'], status: 'draft' });
    // NOT `if (!national) return` — that is how a test quietly stops testing.
    // Verified present: 4 chapterless events, 2 chapterless news items.
    expect(national).toBeTruthy();
    const res = await as(tokenA)(api().get(`/api/chapter-admin/events/${national.documentId}`));
    expect(res.status).toBe(404);
  });

  it("403s a record in a chapter the caller does not administer", async () => {
    const theirs = await strapi.documents('api::committee.committee').create({
      data: { name: tag('SR Foreign'), chapter: { documentId: chapterB.documentId } },
      status: 'published',
    });
    const res = await as(tokenA)(api().get(`/api/chapter-admin/committees/${theirs.documentId}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('404s a record from ANOTHER administered chapter when chapterSlug names this one', async () => {
    // The multi-chapter case: both are administered, so the scope check passes
    // — only the chapterSlug comparison stops the caller getting a form for B's
    // record under A's URL, which is how a cross-chapter save became reachable.
    const inB = await seed(tokenBoth, chapterB);
    const res = await as(tokenBoth)(
      api().get(`/api/chapter-admin/committees/${inB.cm.documentId}?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(404);
  });

  it('returns it when chapterSlug names the right chapter', async () => {
    const inB = await seed(tokenBoth, chapterB);
    const res = await as(tokenBoth)(
      api().get(`/api/chapter-admin/committees/${inB.cm.documentId}?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(200);
  });

  it('reads by documentId, so list position is irrelevant', async () => {
    // NOT a >100 test — it cannot be one without 101 fixtures, and v1's
    // `?page=999` version asserted nothing a list-and-find implementation
    // would fail. What it does prove: no pagination parameter influences the
    // result, which a list-and-find implementation could not honour.
    const res = await as(tokenA)(
      api().get(`/api/chapter-admin/events/${own.ev.documentId}?page=999&pageSize=1`));
    expect(res.status).toBe(200);
    expect(res.body.data.documentId).toBe(own.ev.documentId);
  });
});

describe('GET /api/chapter-admin/committees?chapterSlug=', () => {
  it('narrows to one chapter for a multi-chapter admin', async () => {
    await seed(tokenBoth, chapterA);
    await seed(tokenBoth, chapterB);

    const all = await as(tokenBoth)(api().get('/api/chapter-admin/committees?pageSize=100'));
    const slugs = new Set(all.body.data.map((c) => c.chapter?.slug));
    expect(slugs.size).toBeGreaterThan(1);

    const one = await as(tokenBoth)(
      api().get(`/api/chapter-admin/committees?pageSize=100&chapterSlug=${chapterA.slug}`));
    expect(one.body.data.length).toBeGreaterThan(0);
    expect(one.body.data.every((c) => c.chapter?.slug === chapterA.slug)).toBe(true);
    expect(one.body.meta.pagination.total).toBeLessThan(all.body.meta.pagination.total);
  });

  it('403s a chapterSlug the caller does not administer', async () => {
    const res = await as(tokenA)(
      api().get(`/api/chapter-admin/committees?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
  });
});
