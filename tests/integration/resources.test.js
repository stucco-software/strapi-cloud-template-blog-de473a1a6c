import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
const BODY = [{ type: 'paragraph', children: [{ type: 'text', text: 'Hello' }] }];
let strapi, chapterA, chapterB, tokenA, adminA, originalChapterName;

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  adminA = await makeChapterAdmin(strapi, {
    email: `res-admin-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, adminA.id);

  // draftChapters() asks for fields:['slug'], and `fields` unions in only `id`
  // and `documentId` — so chapterA.name is UNDEFINED. Reading it from there
  // would write "undefined <RUN>" to a real chapter and pass, while the
  // afterAll restore silently became dead code. Fetch it, and fail loudly.
  const full = await strapi.documents('api::chapter.chapter')
    .findOne({ documentId: chapterA.documentId, fields: ['name'], status: 'draft' });
  originalChapterName = full?.name;
  if (!originalChapterName) {
    throw new Error('fixture setup failed: could not read the chapter name to restore later');
  }
});

afterAll(async () => {
  // Restore here rather than inline, so a thrown assertion cannot leave a real
  // chapter renamed.
  if (originalChapterName) {
    await strapi.documents('api::chapter.chapter').update({
      documentId: chapterA.documentId, data: { name: originalChapterName }, status: 'published',
    });
  }

  const junk = await strapi.documents('api::news-item.news-item').findMany({
    filters: { title: { $contains: String(RUN) } }, fields: ['title'], limit: -1, status: 'draft',
  });
  for (const n of junk) {
    await strapi.documents('api::news-item.news-item').delete({ documentId: n.documentId });
  }

  const subs = await strapi.documents('api::form-submission.form-submission')
    .findMany({ limit: -1 });
  for (const s of subs.filter((x) => String(x.data?.run) === String(RUN))) {
    await strapi.documents('api::form-submission.form-submission').delete({ documentId: s.documentId });
  }

  const users = await strapi.query('plugin::users-permissions.user')
    .findMany({ where: { email: { $contains: String(RUN) } } });
  for (const u of users) {
    await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
  }

  await shutdown();
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const title = (n) => `${n} ${RUN}`;

describe('news', () => {
  it('creates with a chapter-prefixed slug and publishes', async () => {
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Chapter Update'), chapterSlug: chapterA.slug, body: BODY });

    expect(res.status).toBe(200);
    expect(res.body.data.slug.startsWith(`${chapterA.slug}-chapter-update`)).toBe(true);
    const published = await strapi.documents('api::news-item.news-item')
      .findOne({ documentId: res.body.data.documentId, status: 'published' });
    expect(published).not.toBeNull();
  });

  it('400s on a missing body rather than surfacing a schema error', async () => {
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Bodyless'), chapterSlug: chapterA.slug });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/body/i);
  });

  it('forces author to the session user, ignoring the payload', async () => {
    const someoneElse = await strapi.documents('plugin::users-permissions.user')
      .findFirst({ filters: { id: { $ne: adminA.id } }, fields: ['firstName'] });

    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Byline'), chapterSlug: chapterA.slug, body: BODY,
              author: { documentId: someoneElse.documentId } });

    const stored = await strapi.documents('api::news-item.news-item').findOne({
      documentId: res.body.data.documentId, populate: { author: { fields: ['id'] } }, status: 'draft',
    });
    expect(stored.author.documentId).toBe(adminA.documentId);
  });

  it('updates without resending the body', async () => {
    // requiredFields is skipped for ABSENT fields on update; this is the path
    // every "change the title only" save takes.
    const created = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Editable'), chapterSlug: chapterA.slug, body: BODY });

    const res = await auth(api().put(`/api/chapter-admin/news/${created.body.data.documentId}`))
      .send({ excerpt: 'Just the excerpt' });

    expect(res.status).toBe(200);
    const stored = await strapi.documents('api::news-item.news-item')
      .findOne({ documentId: created.body.data.documentId, status: 'draft' });
    expect(stored.excerpt).toBe('Just the excerpt');
    // not.toBeNull() would also pass for [] — the exact failure this guards.
    expect(stored.body).toEqual(BODY);
  });

  it('400s when an update BLANKS the required body', async () => {
    const created = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Blankable'), chapterSlug: chapterA.slug, body: BODY });
    const res = await auth(api().put(`/api/chapter-admin/news/${created.body.data.documentId}`))
      .send({ body: [] });
    expect(res.status).toBe(400);
  });

  it('lists this chapter and populates figure and author for the UI', async () => {
    const created = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Listed'), chapterSlug: chapterA.slug, body: BODY });

    const res = await auth(api().get('/api/chapter-admin/news?pageSize=100'));
    expect(res.status).toBe(200);
    const row = res.body.data.find((n) => n.documentId === created.body.data.documentId);
    expect(row).toBeDefined();
    expect(row.chapter?.slug).toBe(chapterA.slug);   // the pages filter on this
    expect(row.author).toBeTruthy();
  });

  it('deletes an own item', async () => {
    const created = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Doomed'), chapterSlug: chapterA.slug, body: BODY });
    const res = await auth(api().delete(`/api/chapter-admin/news/${created.body.data.documentId}`));
    expect(res.status).toBe(200);
    const gone = await strapi.documents('api::news-item.news-item')
      .findOne({ documentId: created.body.data.documentId, status: 'draft' });
    expect(gone).toBeNull();
  });

  it("refuses another chapter's news", async () => {
    const res = await auth(api().post('/api/chapter-admin/news'))
      .send({ title: title('Trespass'), chapterSlug: chapterB.slug, body: BODY });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('chapter settings', () => {
  it('reads name and email', async () => {
    const res = await auth(api().get(`/api/chapter-admin/chapter?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    expect(res.body.data.name).toEqual(expect.any(String));
    expect(res.body.data.name.length).toBeGreaterThan(0);
    expect(res.body.data).toHaveProperty('email');
    expect(res.body.data.slug).toBe(chapterA.slug);
  });

  it('never returns administrators', async () => {
    const res = await auth(api().get(`/api/chapter-admin/chapter?chapterSlug=${chapterA.slug}`));
    expect(res.body.data).not.toHaveProperty('administrators');
  });

  it('actually persists a name change', async () => {
    const next = `${originalChapterName} ${RUN}`;
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: next });

    expect(res.status).toBe(200);
    const stored = await strapi.documents('api::chapter.chapter')
      .findOne({ documentId: chapterA.documentId, fields: ['name'], status: 'draft' });
    expect(stored.name).toBe(next);   // afterAll restores it
  });

  it('actually clears the contact email', async () => {
    // The handler maps '' -> null, because Strapi rejects '' on an `email`
    // attribute with "email cannot be empty".
    await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: originalChapterName, email: 'x@areaa.test' });
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: originalChapterName, email: '' });

    expect(res.status).toBe(200);
    const stored = await strapi.documents('api::chapter.chapter')
      .findOne({ documentId: chapterA.documentId, fields: ['email'], status: 'draft' });
    expect(stored.email).toBeNull();
  });

  it('cannot change the slug, even when the payload says so', async () => {
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterA.slug, name: originalChapterName, slug: 'hijacked' });
    expect(res.status).toBe(200);   // the write succeeds; `slug` is simply dropped
    const after = await strapi.documents('api::chapter.chapter')
      .findOne({ documentId: chapterA.documentId, fields: ['slug'], status: 'draft' });
    expect(after.slug).toBe(chapterA.slug);
  });

  it('refuses another chapter', async () => {
    const res = await auth(api().put('/api/chapter-admin/chapter'))
      .send({ chapterSlug: chapterB.slug, name: 'Nice try' });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('submissions', () => {
  /** Nothing writes submissions yet — see the plan's opening section. */
  const seed = async (chapter, tag) =>
    strapi.documents('api::form-submission.form-submission').create({
      data: {
        chapter: { documentId: chapter.documentId },
        data: { name: tag, email: 'v@example.test', message: 'Hi', run: RUN },
        submittedAt: new Date().toISOString(),
        handled: false,
      },
    });

  it('lists the requested chapter and EXCLUDES the other one', async () => {
    // `.every(...)` would be vacuously true on an empty list, and
    // form_submissions holds 0 rows — so a broken filter would pass.
    const mine = await seed(chapterA, 'Mine');
    const theirs = await seed(chapterB, 'Theirs');

    const res = await auth(api().get(`/api/chapter-admin/submissions?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((s) => s.documentId);
    expect(ids).toContain(mine.documentId);
    expect(ids).not.toContain(theirs.documentId);
  });

  it("refuses to list another chapter's submissions", async () => {
    const res = await auth(api().get(`/api/chapter-admin/submissions?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('marks one handled, and back again', async () => {
    const sub = await seed(chapterA, 'Toggle');
    const on = await auth(api().put(`/api/chapter-admin/submissions/${sub.documentId}`))
      .send({ handled: true });
    expect(on.status).toBe(200);
    expect(on.body.data.handled).toBe(true);

    const off = await auth(api().put(`/api/chapter-admin/submissions/${sub.documentId}`))
      .send({ handled: false });
    expect(off.body.data.handled).toBe(false);
  });

  it("refuses another chapter's submission", async () => {
    const foreign = await seed(chapterB, 'Foreign');
    const res = await auth(api().put(`/api/chapter-admin/submissions/${foreign.documentId}`))
      .send({ handled: true });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});
