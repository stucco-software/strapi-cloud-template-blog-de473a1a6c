import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, sections, snapshot, zoneRows;

/** Every component row on chapterA's home page, BOTH statuses, straight from the DB. */
async function zoneComponentRows() {
  return strapi.db.connection('pages_cmps as z')
    .join('pages as p', 'p.id', 'z.entity_id')
    .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
    .join('chapters as c', 'c.id', 'l.chapter_id')
    .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
    .orderBy(['z.entity_id', 'z.order'])
    .select('z.cmp_id', 'z.component_type', 'z.entity_id', 'z.order');
}

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `pg-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);

  const res = await request(strapi.server.httpServer)
    .get(`/api/chapter-admin/page?chapterSlug=${chapterA.slug}`)
    .set('Authorization', `Bearer ${tokenA}`);
  expect(res.status).toBe(200);
  sections = res.body.data;

  // Snapshot BOTH statuses, read from the component rows themselves.
  //
  // The first version of this plan snapshotted the GET response — which is
  // DRAFT ONLY — and restored it through the API, which writes both statuses.
  // That does not restore, it NORMALISES published to draft: aloha's published
  // hero ("Our Chapter") was permanently overwritten with its unpublished draft
  // title ("Chorp Chipper") every time the suite ran, and the plan's own
  // restore gate reported COPY RESTORED because it only diffed sections.
  zoneRows = await zoneComponentRows();
  snapshot = [];
  for (const r of zoneRows) {
    const fields = ['title', 'body', 'intro', 'submitLabel', 'caption'];
    const row = await strapi.db.query(r.component_type).findOne({ where: { id: r.cmp_id } });
    if (!row) continue;
    snapshot.push({
      id: r.cmp_id,
      type: r.component_type,
      values: Object.fromEntries(
        fields.filter((f) => f in row).map((f) => [f, row[f]])),
    });
  }
  expect(snapshot.length).toBe(zoneRows.length);
});

afterAll(async () => {
  try {
    try {
      // Restore each component ROW independently, at its own status. NEVER
      // through the API: the API writes both statuses from one set of values,
      // which is what corrupted the published rows in the first version.
      for (const s of snapshot) {
        if (Object.keys(s.values).length === 0) continue;
        await strapi.db.query(s.type).update({ where: { id: s.id }, data: s.values });
      }
    } finally {
      const users = await strapi.query('plugin::users-permissions.user')
        .findMany({ where: { email: { $contains: String(RUN) } } });
      for (const u of users) {
        await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
      }
    }
  } finally {
    await shutdown();
  }
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const save = (body) => auth(api().put('/api/chapter-admin/page'))
  .send({ chapterSlug: chapterA.slug, ...body });
const reread = async () => (await auth(
  api().get(`/api/chapter-admin/page?chapterSlug=${chapterA.slug}`))).body;

const firstOfType = (type) => sections.find((s) => s.type === type && s.editable.includes('title'));

describe('GET /api/chapter-admin/page', () => {
  it('returns the zone in the order the page stores it', async () => {
    // Compared against pages_cmps."order", NOT against the array's own
    // positions. The first version asserted `indexes === [0..n]`, which the
    // controller guarantees by construction — it could not fail, and order is
    // the one thing positional pairing still depends on.
    const draftRows = (await zoneComponentRows())
      .filter((r) => r.entity_id === Math.min(...zoneRows.map((z) => z.entity_id)));
    expect(sections.map((s) => s.type)).toEqual(draftRows.map((r) => r.component_type));
    expect(sections.map((s) => s.draftId)).toEqual(draftRows.map((r) => r.cmp_id));
  });

  it('offers title on every known component type', () => {
    for (const s of sections) {
      if (s.readOnlyReason === 'not-editable') continue;
      expect(s.editable).toContain('title');
    }
  });

  it('NEVER returns notificationEmails, even on the contact form', () => {
    // It is a staff routing address; returning it would publish it to the
    // browser of anyone who can open this screen.
    const body = JSON.stringify(sections);
    expect(body).not.toContain('notificationEmails');
    const contact = sections.find((s) => s.type === 'shared.contact-form');
    expect(contact).toBeTruthy();
    expect(contact.editable.sort()).toEqual(['intro', 'submitLabel', 'title']);
  });

  it('never offers a relation or a media field', () => {
    for (const s of sections) {
      for (const banned of ['members', 'partners', 'events', 'figure', 'photos', 'fields']) {
        expect(s.editable).not.toContain(banned);
      }
    }
  });

  it('403s a chapter the caller does not administer', async () => {
    const res = await auth(api().get(`/api/chapter-admin/page?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
  });

  it('404s a chapter with no home page', async () => {
    const noPage = await strapi.documents('api::chapter.chapter')
      .findFirst({ filters: { slug: 'pdx' }, fields: ['slug'], status: 'draft' });
    // Asserted, not skipped: pdx has no home page today, and if that changes
    // this test must fail loudly rather than quietly stop testing.
    expect(noPage).toBeTruthy();
    const admin = await makeChapterAdmin(strapi, {
      email: `pg-nopage-${RUN}@areaa.test`, chapterIds: [noPage.id],
    });
    const token = await jwtFor(strapi, admin.id);
    const res = await api().get('/api/chapter-admin/page?chapterSlug=pdx')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error?.message ?? '').toMatch(/no microsite page/i);
  });
});

describe('PUT /api/chapter-admin/page', () => {
  it('writes BOTH statuses, which is what makes the public site change', async () => {
    const s = firstOfType('shared.section');
    const title = `Plan5 ${RUN}`;
    const res = await save({ index: s.index, title });
    expect(res.status).toBe(200);
    expect(res.body.data.wrote).toBe(2);

    // Assert the rows directly — a re-read through the API would only prove the
    // draft changed.
    const pairIds = await strapi.db.connection('pages_cmps as z')
      .join('pages as p', 'p.id', 'z.entity_id')
      .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
      .join('chapters as c', 'c.id', 'l.chapter_id')
      .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
      .andWhere('z.component_type', 'shared.section').select('z.cmp_id');
    expect(pairIds.length).toBe(2);            // one draft, one published
    for (const { cmp_id } of pairIds) {
      const row = await strapi.db.query('shared.section').findOne({ where: { id: cmp_id } });
      expect(row.title).toBe(title);
    }
  });

  it('converts body text to paragraph blocks', async () => {
    const s = sections.find((x) => x.editable.includes('body'));
    expect(s).toBeTruthy();
    await save({ index: s.index, body: `One ${RUN}\nTwo` });
    const after = (await reread()).data.find((x) => x.index === s.index);
    expect(after.values.body).toBe(`One ${RUN}\nTwo`);
  });

  it('addresses sections by POSITION, so a component id in the payload is inert', async () => {
    // Actually post one, which the first version never did — it only tested
    // index 999 and would have passed against a handler that honoured a
    // client-supplied id.
    const foreign = await strapi.db.connection('pages_cmps')
      .where('component_type', 'shared.section')
      .whereNotIn('cmp_id', (await zoneComponentRows()).map((r) => r.cmp_id))
      .first();
    expect(foreign).toBeTruthy();
    const before = await strapi.db.query('shared.section')
      .findOne({ where: { id: foreign.cmp_id } });

    const s = firstOfType('shared.section');
    await save({ index: s.index, draftId: foreign.cmp_id, id: foreign.cmp_id,
                 title: `Position ${RUN}` });

    const after = await strapi.db.query('shared.section')
      .findOne({ where: { id: foreign.cmp_id } });
    expect(after.title).toBe(before.title);
  });

  it('400s an out-of-range index', async () => {
    const res = await save({ index: 999, title: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/no such section/i);
  });

  it('400s a malformed index rather than defaulting to the hero', async () => {
    // Number(null), Number('') and Number(false) are all 0, and index 0 is the
    // hero. Verified reachable in the first version: {index: null} returned 200
    // and rewrote the page headline at both statuses.
    const hero = sections[0];
    const before = await strapi.db.query(hero.type).findOne({ where: { id: hero.draftId } });
    for (const bad of [null, '', false, [], {}, 1.5, -1]) {
      const res = await save({ index: bad, title: `Malformed ${RUN}` });
      expect(res.status, `index=${JSON.stringify(bad)}`).toBe(400);
    }
    const after = await strapi.db.query(hero.type).findOne({ where: { id: hero.draftId } });
    expect(after.title).toBe(before.title);
  });

  it('DROPS a field the component type does not allow', async () => {
    const contact = sections.find((s) => s.type === 'shared.contact-form');
    const before = await strapi.db.query('shared.contact-form')
      .findOne({ where: { id: contact.draftId } });
    await save({
      index: contact.index, title: `Contact ${RUN}`,
      notificationEmails: 'attacker@evil.example',
    });
    const after = await strapi.db.query('shared.contact-form')
      .findOne({ where: { id: contact.draftId } });
    expect(after.title).toBe(`Contact ${RUN}`);
    expect(after.notificationEmails).toBe(before.notificationEmails);
  });

  it('400s when nothing editable was submitted', async () => {
    const s = firstOfType('shared.section');
    const res = await save({ index: s.index, partners: ['p1'] });
    expect(res.status).toBe(400);
  });

  it('refuses to edit a body that carries formatting', async () => {
    // The live data-loss path. Plant marks on the draft row, then confirm the
    // API both stops offering `body` and refuses a write.
    const s = sections.find((x) => x.editable.includes('body'));
    const row = await strapi.db.query(s.type).findOne({ where: { id: s.draftId } });
    const plain = row.body;
    await strapi.db.query(s.type).update({
      where: { id: s.draftId },
      data: { body: [{ type: 'paragraph', children: [{ type: 'text', text: 'Bold', bold: true }] }] },
    });
    try {
      const listed = (await reread()).data.find((x) => x.index === s.index);
      expect(listed.editable).not.toContain('body');
      expect(listed.readOnlyReason).toBe('rich-body');

      const res = await save({ index: s.index, body: 'this would strip the bold' });
      expect(res.status).toBe(400);
      expect(res.body.error?.message ?? '').toMatch(/formatting/i);
    } finally {
      await strapi.db.query(s.type).update({ where: { id: s.draftId }, data: { body: plain } });
    }
  });

  it('never touches a component on another chapter page', async () => {
    // Derived from the database independently of findPageZones — deriving it
    // from the same lookup would make the function its own oracle.
    //
    // `mine` must cover BOTH statuses. The first version used `sections`, which
    // carries draftId only, so this chapter's own PUBLISHED section landed in
    // `others` — and the save legitimately writes it. The test failed 100% of
    // the time and took the 220 gate with it.
    const mine = new Set(
      (await zoneComponentRows())
        .filter((r) => r.component_type === 'shared.section')
        .map((r) => r.cmp_id));
    const others = await strapi.db.connection('pages_cmps')
      .where('component_type', 'shared.section')
      .whereNotIn('cmp_id', [...mine]).select('cmp_id');
    expect(others.length).toBeGreaterThan(0);

    const before = {};
    for (const { cmp_id } of others) {
      before[cmp_id] = (await strapi.db.query('shared.section')
        .findOne({ where: { id: cmp_id } }))?.title ?? null;
    }
    await save({ index: firstOfType('shared.section').index, title: `Isolated ${RUN}` });
    for (const { cmp_id } of others) {
      const now = (await strapi.db.query('shared.section')
        .findOne({ where: { id: cmp_id } }))?.title ?? null;
      expect(now).toBe(before[cmp_id]);
    }
  });

  it('403s a chapter the caller does not administer', async () => {
    const res = await auth(api().put('/api/chapter-admin/page'))
      .send({ chapterSlug: chapterB.slug, index: 0, title: 'nope' });
    expect(res.status).toBe(403);
  });

  it('SKIPS the published write when that row has diverged, and says so', async () => {
    // The plan's central safety property, and the first version proved it
    // nowhere: draftChapters yields two fully-published chapters, so `wrote`
    // was always 2 and the only assertion was toBe(2).
    //
    // Real data already contains this state — aloha's draft hero title differs
    // from its published one — but construct it explicitly so the test does not
    // depend on which chapters draftChapters happens to return.
    const s = firstOfType('shared.section');
    const rows = (await zoneComponentRows()).filter((r) => r.component_type === 'shared.section');
    expect(rows.length).toBe(2);
    const [draftRow, pubRow] = rows;
    const pubBefore = await strapi.db.query('shared.section').findOne({ where: { id: pubRow.cmp_id } });

    // Make published differ from draft, as an unpublished national edit would.
    await strapi.db.query('shared.section')
      .update({ where: { id: pubRow.cmp_id }, data: { title: `Diverged ${RUN}` } });
    try {
      const res = await save({ index: s.index, title: `Attempt ${RUN}` });
      expect(res.status).toBe(200);
      expect(res.body.data.wrote).toBe(1);
      expect(res.body.meta.skipReason).toBe('content-diverged');

      const draftAfter = await strapi.db.query('shared.section')
        .findOne({ where: { id: draftRow.cmp_id } });
      const pubAfter = await strapi.db.query('shared.section')
        .findOne({ where: { id: pubRow.cmp_id } });
      expect(draftAfter.title).toBe(`Attempt ${RUN}`);
      // Untouched. Writing it would have PUBLISHED an edit nobody approved.
      expect(pubAfter.title).toBe(`Diverged ${RUN}`);
    } finally {
      await strapi.db.query('shared.section')
        .update({ where: { id: pubRow.cmp_id }, data: { title: pubBefore.title } });
    }
  });

  it('does not change the zone STRUCTURE', async () => {
    // The central safety claim: no component added, removed or reordered.
    const shape = async () => (await strapi.db.connection('pages_cmps as z')
      .join('pages as p', 'p.id', 'z.entity_id')
      .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
      .join('chapters as c', 'c.id', 'l.chapter_id')
      .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
      .orderBy(['z.entity_id', 'z.order'])
      .select('z.entity_id', 'z.order', 'z.component_type', 'z.cmp_id'));

    const before = await shape();
    await save({ index: firstOfType('shared.section').index, title: `Shape ${RUN}` });
    expect(await shape()).toEqual(before);
  });
});
