import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown, jwtFor, makeChapterAdmin, draftChapters } from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, sections, snapshot, zoneRows;
let ctaSnapshot, mediaSnapshot;

/** The draft and published parent ids for one section index. */
const parentIdsFor = async (index) => {
  const zone = await strapi.db.connection('pages_cmps as z')
    .join('pages as p', 'p.id', 'z.entity_id')
    .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
    .join('chapters as c', 'c.id', 'l.chapter_id')
    .where('c.document_id', chapterA.documentId).andWhere('p.slug', 'home')
    .orderBy(['z.entity_id', 'z.order'])
    .select('z.cmp_id', 'z.entity_id', 'z.order');
  const byPage = {};
  for (const r of zone) (byPage[r.entity_id] ??= []).push(r.cmp_id);
  return Object.values(byPage).map((ids) => ids[index]).filter((v) => v !== undefined);
};

const publishedIdFor = async (index) => (await parentIdsFor(index))[1];

/** Both statuses' shared.cta ids for one slot of one section. */
const ctaIdsFor = async (index, slot) => {
  const CMPS = {
    'shared.hero': 'components_shared_heroes_cmps',
    'shared.section': 'components_shared_sections_cmps',
    'shared.upcoming-events': 'components_shared_upcoming_events_cmps',
    'shared.member-group': 'components_shared_member_groups_cmps',
    'shared.news-and-resources': 'components_shared_news_and_resources_cmps',
    'shared.partner-callout': 'components_shared_partner_callouts_cmps',
  };
  const type = sections.find((s) => s.index === index).type;
  const out = [];
  for (const parentId of await parentIdsFor(index)) {
    const row = await strapi.db.connection(CMPS[type])
      .where({ entity_id: parentId, component_type: 'shared.cta', field: slot }).first();
    if (row) out.push(row.cmp_id);
  }
  return out;
};

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

  // Every CTA row on this chapter's zone, both statuses. Without this, one
  // green run permanently rewrites aloha's PUBLISHED hero button with test
  // junk — the text snapshot above covers component columns only, and a CTA
  // lives in its own row in another table.
  ctaSnapshot = [];
  for (const s of sections) {
    for (const slot of (s.ctas ?? []).map((c) => c.slot)) {
      for (const id of await ctaIdsFor(s.index, slot)) {
        const row = await strapi.db.query('shared.cta').findOne({ where: { id } });
        if (row) ctaSnapshot.push({ id, label: row.label, href: row.href });
      }
    }
  }

  // Every media relation on this chapter's zone, both statuses.
  //
  // Matched on (related_type, related_id) as a PAIR. `related_id` alone is not
  // unique — it is a row id in whichever table `related_type` names, so a
  // whereIn on it also selects, and then "restores", media on unrelated
  // components that happen to share a numeric id.
  const owners = new Set();
  for (const s of sections) {
    for (const id of await parentIdsFor(s.index)) owners.add(`${s.type}#${id}`);
  }
  mediaSnapshot = (await strapi.db.connection('files_related_mph')
    .whereIn('related_id', [...owners].map((k) => Number(k.split('#')[1])))
    .select('related_id', 'related_type', 'field', 'file_id', 'order'))
    .filter((m) => owners.has(`${m.related_type}#${m.related_id}`));
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
      for (const c of ctaSnapshot ?? []) {
        await strapi.db.query('shared.cta')
          .update({ where: { id: c.id }, data: { label: c.label, href: c.href } });
      }
      for (const m of mediaSnapshot ?? []) {
        await strapi.db.query(m.related_type)
          .update({ where: { id: m.related_id }, data: { [m.field]: m.file_id } });
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
    // The facet shape replaced plan 5's flat `wrote`: a save now carries text,
    // buttons and an image, each of which can land on a different number of
    // statuses, so one number cannot describe the result.
    expect(res.body.data.facets).toEqual([{ kind: 'text', wrote: 2 }]);
    expect(res.body.data.live).toBe(1);
    expect(res.body.data.held).toBe(0);

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
      expect(res.body.data.facets).toEqual([{ kind: 'text', wrote: 1 }]);
      expect(res.body.data.held).toBe(1);
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

describe('PUT /api/chapter-admin/page — buttons', () => {
  const withCta = () => sections.find((s) => (s.ctas ?? []).length > 0);

  it('returns the buttons a section carries, with their current link', async () => {
    const s = withCta();
    expect(s).toBeTruthy();                       // aloha's zone has three
    expect(s.ctas[0]).toHaveProperty('slot');
    expect(s.ctas[0].href).toMatch(/^[/#]|^https?:/);
  });

  it('offers NO buttons for a section that has none', () => {
    const gallery = sections.find((s) => s.type === 'shared.gallery');
    expect(gallery.ctas).toEqual([]);
  });

  it('writes a new label and link at BOTH statuses', async () => {
    const s = withCta();
    const slot = s.ctas[0].slot;
    const res = await save({ index: s.index, ctas: { [slot]: {
      label: `Join ${RUN}`, href: '/chapters/aloha-hawaii/events' } } });
    expect(res.status).toBe(200);

    // Assert the rows directly — a re-read would only prove the draft changed.
    const ids = await ctaIdsFor(s.index, slot);          // helper, both statuses
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const row = await strapi.db.query('shared.cta').findOne({ where: { id } });
      expect(row.label).toBe(`Join ${RUN}`);
      expect(row.href).toBe('/chapters/aloha-hawaii/events');
    }
  });

  it('normalises an off-site link so the renderer can see it is external', async () => {
    const s = withCta();
    await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: 'Off site', href: '//evil.example/x' } } });
    const [draftId] = await ctaIdsFor(s.index, s.ctas[0].slot);
    const row = await strapi.db.query('shared.cta').findOne({ where: { id: draftId } });
    expect(row.href).toBe('https://evil.example/x');
  });

  it('400s a javascript: link and writes nothing', async () => {
    const s = withCta();
    const [draftId] = await ctaIdsFor(s.index, s.ctas[0].slot);
    const before = await strapi.db.query('shared.cta').findOne({ where: { id: draftId } });
    const res = await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: 'Bad', href: 'javascript:alert(1)' } } });
    expect(res.status).toBe(400);
    const after = await strapi.db.query('shared.cta').findOne({ where: { id: draftId } });
    expect(after).toEqual(before);
  });

  it('400s WITHOUT committing the text that came with the bad link', async () => {
    // The test above is buttons-only, so it has no text write to observe and
    // passed even when the handler wrote text before validating buttons —
    // measured leaving a new heading committed at both statuses behind a 400.
    // The real form posts heading, body and buttons together.
    const s = withCta();
    const row = await strapi.db.query(s.type).findOne({ where: { id: s.draftId } });
    const res = await save({ index: s.index, title: `Should not land ${RUN}`,
      ctas: { [s.ctas[0].slot]: { label: 'Bad', href: 'javascript:alert(1)' } } });
    expect(res.status).toBe(400);
    const after = await strapi.db.query(s.type).findOne({ where: { id: s.draftId } });
    expect(after.title).toBe(row.title);
  });

  it('ACCEPTS a save carrying only buttons, with no text field', async () => {
    // The guard `shapeComponentEdit` throws is correct for plan 5 and fatal
    // here: a buttons-only payload is what the form posts when the admin
    // touched only the button. Without Task 3's hasExtras tolerance EVERY line
    // of the CTA and image code is unreachable — verified: cta-only saves
    // returned 400 "Nothing editable was submitted", and four tests in this
    // very suite passed against that guard instead of the code they name.
    const s = withCta();
    const res = await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: `Buttons only ${RUN}`, href: '/join' } } });
    expect(res.status).toBe(200);
    const [draftId] = await ctaIdsFor(s.index, s.ctas[0].slot);
    expect((await strapi.db.query('shared.cta').findOne({ where: { id: draftId } })).label)
      .toBe(`Buttons only ${RUN}`);
  });

  it('400s a slot the section does not have', async () => {
    const gallery = sections.find((s) => s.type === 'shared.gallery');
    const res = await save({ index: gallery.index, ctas: { primaryCta: {
      label: 'X', href: '/join' } } });
    expect(res.status).toBe(400);
  });

  it('never touches another section\'s button', async () => {
    // Derived from the database, independently of the handler's own lookup.
    const s = withCta();
    const mine = new Set(await ctaIdsFor(s.index, s.ctas[0].slot));
    const others = await strapi.db.connection('components_shared_ctas')
      .whereNotIn('id', [...mine]).select('id', 'label');
    expect(others.length).toBeGreaterThan(0);

    await save({ index: s.index, ctas: { [s.ctas[0].slot]: {
      label: `Isolated ${RUN}`, href: '/join' } } });

    for (const { id, label } of others) {
      const now = await strapi.db.query('shared.cta').findOne({ where: { id } });
      expect(now.label).toBe(label);
    }
  });
});

describe('PUT /api/chapter-admin/page — image', () => {
  it('reports the current image for a section that has one', () => {
    const hero = sections.find((s) => s.type === 'shared.hero');
    expect(hero.image.slot).toBe('figure');
    // NOT toContain('placeholder'): this suite reassigns the figure. With the
    // restore in beforeAll/afterAll the assertion survives, but it is one
    // deleted restore away from passing once and failing on every later run.
    expect(hero.image.url).toMatch(/^\/uploads\//);
  });

  it('reports none for a section that has no image slot', () => {
    expect(sections.find((s) => s.type === 'shared.contact-form').image).toBeNull();
  });

  it('holds the published image back when the two figures already differ', async () => {
    // The vacuous-gate case. An image-only payload means `data` is {}, so a
    // gate over Object.keys(data) compares nothing and returns true — measured
    // changing a PUBLISHED figure on rows that were already diverged.
    const hero = sections.find((x) => x.type === 'shared.hero');
    const pubId = await publishedIdFor(hero.index);
    const files = await strapi.db.connection('files').orderBy('id').limit(2);
    expect(files.length).toBe(2);

    // Diverge the two figures deliberately.
    await strapi.db.query('shared.hero')
      .update({ where: { id: pubId }, data: { figure: files[1].id } });
    await strapi.db.query('shared.hero')
      .update({ where: { id: hero.draftId }, data: { figure: files[0].id } });

    const res = await save({ index: hero.index, figureId: files[1].id });
    expect(res.status).toBe(200);
    expect(res.body.data.facets.find((f) => f.kind === 'image').wrote).toBe(1);

    const pubRow = await strapi.db.connection('files_related_mph')
      .where({ related_id: pubId, related_type: 'shared.hero', field: 'figure' }).first();
    expect(pubRow.file_id).toBe(files[1].id);   // untouched
  });

  it('attaches an uploaded image at both statuses when they are in step', async () => {
    const hero = sections.find((s) => s.type === 'shared.hero');
    // A file that is NOT the one already attached, so the assertion is not
    // satisfied by the starting state.
    const current = await strapi.db.connection('files_related_mph')
      .where({ related_id: hero.draftId, related_type: 'shared.hero', field: 'figure' }).first();
    const file = await strapi.db.connection('files')
      .whereNot('id', current?.file_id ?? -1).orderBy('id').first();
    expect(file).toBeTruthy();

    const res = await save({ index: hero.index, figureId: file.id });
    expect(res.status).toBe(200);

    for (const id of [hero.draftId, await publishedIdFor(hero.index)]) {
      const linked = await strapi.db.connection('files_related_mph')
        .where({ related_id: id, related_type: 'shared.hero', field: 'figure' }).first();
      expect(linked.file_id).toBe(file.id);
    }
  });

  it('ACCEPTS a save carrying only an image, with no text field', async () => {
    const hero = sections.find((x) => x.type === 'shared.hero');
    const current = await strapi.db.connection('files_related_mph')
      .where({ related_id: hero.draftId, related_type: 'shared.hero', field: 'figure' }).first();
    const file = await strapi.db.connection('files')
      .whereNot('id', current?.file_id ?? -1).orderBy('id').first();
    expect((await save({ index: hero.index, figureId: file.id })).status).toBe(200);
  });

  it('accepts a figureId posted as a string, which is what the form sends', async () => {
    const hero = sections.find((x) => x.type === 'shared.hero');
    const file = await strapi.db.connection('files').orderBy('id').first();
    expect((await save({ index: hero.index, figureId: String(file.id) })).status).toBe(200);
  });

  it('400s a figureId that is not a positive integer', async () => {
    const hero = sections.find((s) => s.type === 'shared.hero');
    for (const bad of [0, -1, 1.5, 'abc', {}]) {
      expect((await save({ index: hero.index, figureId: bad })).status,
             JSON.stringify(bad)).toBe(400);
    }
  });

  it('400s an image on a section with no image slot', async () => {
    const contact = sections.find((s) => s.type === 'shared.contact-form');
    const file = await strapi.db.connection('files').first();
    expect((await save({ index: contact.index, figureId: file.id })).status).toBe(400);
  });
});
