import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  boot, shutdown, jwtFor, makeChapterAdmin, draftChapters,
  makePagelessChapter, dropChapter,
} from './helpers.js';

const RUN = Date.now();
let strapi, chapterA, chapterB, tokenA, catalogue, groupsA, originalA;

/** Component partner documentIds, IN ORDER, for one status. */
const componentPartners = async (componentId) => {
  const cmp = await strapi.db.query('shared.partner-group').findOne({
    where: { id: componentId }, populate: { partners: true },
  });
  return (cmp?.partners ?? []).map((p) => p.documentId);
};

beforeAll(async () => {
  strapi = await boot();
  [chapterA, chapterB] = await draftChapters(strapi, 2);
  const admin = await makeChapterAdmin(strapi, {
    email: `pt-admin-${RUN}@areaa.test`, chapterIds: [chapterA.id],
  });
  tokenA = await jwtFor(strapi, admin.id);

  catalogue = await strapi.documents('api::partner.partner')
    .findMany({ fields: ['name'], limit: 3, sort: ['name:asc'], status: 'draft' });
  if (catalogue.length < 2) throw new Error('fixture setup: need at least two seeded partners');

  const { findPartnerGroups } = await import(
    '../../src/api/chapter-admin/services/partners.js'
  ).then((m) => m.default ?? m).catch(async () => {
    const { createRequire } = await import('node:module');
    return createRequire(import.meta.url)('../../src/api/chapter-admin/services/partners.js');
  });
  const located = await findPartnerGroups(strapi, chapterA.slug);
  if (located.error) throw new Error(`fixture setup: ${chapterA.slug} has no partner-group slot`);
  groupsA = located.groups;

  // Capture the live microsite content, IN ORDER, at both statuses.
  originalA = {};
  for (const [status, id] of Object.entries(groupsA)) {
    originalA[status] = await componentPartners(id);
  }
});

afterAll(async () => {
  try {
    // Restore exactly — order included. NEVER write back a sorted list:
    // partner_ord is real and the microsite renders by it.
    //
    // Its own try/finally: a failed restore must not also leak fixture users.
    try {
    if (groupsA && originalA) {
      for (const [status, id] of Object.entries(groupsA)) {
        const docIds = originalA[status] ?? [];
        const rows = docIds.length
          ? await strapi.documents('api::partner.partner').findMany({
              filters: { documentId: { $in: docIds } }, fields: ['name'], limit: -1, status,
            })
          : [];
        const byDoc = new Map(rows.map((r) => [r.documentId, r.id]));
        await strapi.db.query('shared.partner-group').update({
          where: { id },
          data: { partners: docIds.map((d) => byDoc.get(d)).filter((v) => v !== undefined) },
        });
      }
    }
    } finally {
      const users = await strapi.query('plugin::users-permissions.user')
        .findMany({ where: { email: { $contains: String(RUN) } } });
      for (const u of users) {
        await strapi.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
      }
    }
  } finally {
    // Always, even if the restore threw or beforeAll failed part-way.
    await shutdown();
  }
});

const api = () => request(strapi.server.httpServer);
const auth = (r) => r.set('Authorization', `Bearer ${tokenA}`);
const attach = (partners) => auth(api().put('/api/chapter-admin/partners'))
  .send({ chapterSlug: chapterA.slug, partners });

describe('GET /api/chapter-admin/partners', () => {
  it('returns the global catalogue with what the picker renders', async () => {
    const res = await auth(api().get(`/api/chapter-admin/partners?chapterSlug=${chapterA.slug}`));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    for (const row of res.body.data) {
      // `owned` says whether THIS chapter may edit the row or only attach it,
      // and `tier` is what the microsite groups under. Both arrived with
      // chapter-owned sponsors; the catalogue row is what a CHECKBOX needs.
      expect(Object.keys(row).sort())
        .toEqual(['documentId', 'logoUrl', 'name', 'owned', 'sponsorshipLevel', 'tier']);
    }
  });

  it("reports the chapter's current selection and that the slot exists", async () => {
    const res = await auth(api().get(`/api/chapter-admin/partners?chapterSlug=${chapterA.slug}`));
    expect(res.body.meta.slot).toBe('ok');
    expect(Array.isArray(res.body.meta.attached)).toBe(true);
  });

  it("refuses a chapter the caller does not administer", async () => {
    const res = await auth(api().get(`/api/chapter-admin/partners?chapterSlug=${chapterB.slug}`));
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });
});

describe('PUT /api/chapter-admin/partners', () => {
  it('writes the partner-group component the microsite actually renders', async () => {
    const want = [catalogue[0].documentId, catalogue[1].documentId];
    const res = await attach(want);

    expect(res.status).toBe(200);
    expect(res.body.data.attached).toBe(2);
    // Not chapter.partners — the component. This is the whole point of v2.
    expect(await componentPartners(groupsA.draft)).toEqual(want);
  });

  it('writes the PUBLISHED component too, which is what the public site reads', async () => {
    const want = [catalogue[1].documentId, catalogue[0].documentId];
    await attach(want);
    expect(await componentPartners(groupsA.published)).toEqual(want);
  });

  it('links each component to its OWN status\'s partner rows', async () => {
    // Draft components link to draft partner rows, published to published.
    // Linking both to the same row would look right in a documentId read and
    // be wrong in the database.
    await attach([catalogue[0].documentId]);
    const draftRow = await strapi.db.connection('components_shared_partner_groups_partners_lnk')
      .where('partner_group_id', groupsA.draft).first();
    const pubRow = await strapi.db.connection('components_shared_partner_groups_partners_lnk')
      .where('partner_group_id', groupsA.published).first();
    expect(draftRow.partner_id).not.toBe(pubRow.partner_id);

    const draftPartner = await strapi.db.connection('partners').where('id', draftRow.partner_id).first();
    const pubPartner = await strapi.db.connection('partners').where('id', pubRow.partner_id).first();
    expect(draftPartner.published_at).toBeNull();
    expect(pubPartner.published_at).not.toBeNull();
    expect(draftPartner.document_id).toBe(pubPartner.document_id);
  });

  it('PRESERVES the submitted order — partner_ord drives the rendered order', async () => {
    await attach([catalogue[1].documentId, catalogue[0].documentId]);
    expect(await componentPartners(groupsA.draft))
      .toEqual([catalogue[1].documentId, catalogue[0].documentId]);
  });

  it('REPLACES rather than appending', async () => {
    await attach([catalogue[0].documentId, catalogue[1].documentId]);
    await attach([catalogue[0].documentId]);
    expect(await componentPartners(groupsA.draft)).toEqual([catalogue[0].documentId]);
  });

  it('detaches everything when sent an empty list', async () => {
    await attach([]);
    expect(await componentPartners(groupsA.draft)).toEqual([]);
  });

  it('targets exactly the components on THIS chapter\'s home page', async () => {
    // Derived independently of findPartnerGroups — deriving `others` from
    // groupsA would make the function its own oracle, and a widened lookup
    // would move both sides together. (Verified: dropping the chapter filter
    // left the old version of this test passing.)
    const mine = await strapi.db.connection('pages_cmps as z')
      .join('pages as p', 'p.id', 'z.entity_id')
      .join('pages_chapter_lnk as l', 'l.page_id', 'p.id')
      .join('chapters as c', 'c.id', 'l.chapter_id')
      .where('z.component_type', 'shared.partner-group')
      .andWhere('p.slug', 'home')
      .andWhere('c.document_id', chapterA.documentId)
      .select('z.cmp_id');
    expect(new Set(Object.values(groupsA)))
      .toEqual(new Set(mine.map((r) => r.cmp_id)));
  });

  it('never touches a component on another page', async () => {
    const others = await strapi.db.connection('pages_cmps')
      .where('component_type', 'shared.partner-group')
      .whereNotIn('cmp_id', Object.values(groupsA)).select('cmp_id');
    expect(others.length).toBeGreaterThan(0);   // 32/33 sit on national pages
    const before = {};
    for (const { cmp_id } of others) before[cmp_id] = await componentPartners(cmp_id);

    await attach([catalogue[0].documentId]);

    for (const { cmp_id } of others) {
      expect(await componentPartners(cmp_id)).toEqual(before[cmp_id]);
    }
  });

  it('400s on a partner documentId that does not exist', async () => {
    const res = await attach(['nosuchpartner000000000000']);
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/no longer exist/i);
  });

  it('400s on a malformed payload rather than 500ing', async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterA.slug, partners: 'nope' });
    expect(res.status).toBe(400);
  });

  it('400s on partners:null rather than silently detaching everything', async () => {
    const res = await attach(null);
    expect(res.status).toBe(400);
  });

  it("refuses another chapter", async () => {
    const res = await auth(api().put('/api/chapter-admin/partners'))
      .send({ chapterSlug: chapterB.slug, partners: [] });
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? '').toMatch(/not administered/i);
  });

  it('404s a chapter with no home page, rather than failing obscurely', async () => {
    // A chapter with no home page must get a real reason, not an obscure error.
    // Provisioned, not looked up. This asserted on a seeded `pdx` chapter that
    // scripts/seed.js has never created — the fixture lived only in one
    // developer's local database, so the test failed on a missing row instead
    // of exercising the 404 it was written for. A chapter with no home page is
    // cheap to make and belongs to the test that needs it.
    const slug = `nopage-pt-${RUN}`;
    const noPage = await makePagelessChapter(strapi, slug);
    try {
      const admin = await makeChapterAdmin(strapi, {
        email: `pt-nopage-${RUN}@areaa.test`, chapterIds: [noPage.id],
      });
      const token = await jwtFor(strapi, admin.id);
      const res = await api().put('/api/chapter-admin/partners')
        .set('Authorization', `Bearer ${token}`)
        .send({ chapterSlug: slug, partners: [] });
      expect(res.status).toBe(404);
      expect(res.body.error?.message ?? '').toMatch(/no microsite page/i);
    } finally {
      await dropChapter(strapi, noPage.documentId);
    }
  });

  it('never writes the Partner record itself', async () => {
    // CA7: partners are shared. This asserts the OUTCOME, not the mechanism —
    // v1's version could not fail, because the payload shape it sent was
    // stripped before the write regardless.
    const before = await strapi.db.connection('partners')
      .where('document_id', catalogue[0].documentId).select('id', 'name');

    await auth(api().put('/api/chapter-admin/partners')).send({
      chapterSlug: chapterA.slug,
      partners: [{ documentId: catalogue[0].documentId, name: 'Renamed By Chapter' }],
    });

    const after = await strapi.db.connection('partners')
      .where('document_id', catalogue[0].documentId).select('id', 'name');
    expect(after).toEqual(before);
  });
});
