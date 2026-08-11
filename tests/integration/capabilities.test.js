import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';
import {
  boot, shutdown, draftChapters, jwtFor, makeChapterAdmin,
} from './helpers.js';

// src/ is CJS throughout; require it the same way tests/unit/grants.test.js does
// rather than fighting ESM interop for a namespace that has no default export.
const require = createRequire(import.meta.url);

// Every other integration file suffixes the accounts it creates with a run
// stamp, and for a reason: `username` and `email` are unique, so a fixed
// address turns any mid-run failure into a permanent unique-constraint failure
// on every later run. Same pattern here.
const RUN = Date.now();

let strapi;
beforeAll(async () => { strapi = await boot(); });
afterAll(shutdown);

describe('capability seed', () => {
  it('creates exactly the three capabilities, each with categories', async () => {
    const rows = await strapi.documents('api::member-capability.member-capability')
      .findMany({ fields: ['slug', 'name', 'categories'], limit: -1, sort: ['slug:asc'] });

    expect(rows.map((r) => r.slug)).toEqual([
      'chapter_admin', 'committee_leader', 'national_admin',
    ]);
    for (const row of rows) {
      expect(Array.isArray(row.categories)).toBe(true);
      expect(row.categories.length).toBeGreaterThan(0);
    }
  });

  it('is idempotent — a second seed run creates no duplicates', async () => {
    const { seedCapabilities } = require('../../src/api/member-capability/seed.js');
    await seedCapabilities(strapi);

    const count = await strapi.documents('api::member-capability.member-capability')
      .count({});
    expect(count).toBe(3);
  });

  it('stores one row per capability, not two', async () => {
    // draftAndPublish is off, so a capability is ONE row. Strapi 5 still puts
    // published_at on the table — that is the document model, not the feature —
    // so the column's existence proves nothing and the row count is the check.
    const rows = await strapi.db.connection('member_capabilities').select('slug');
    expect(rows).toHaveLength(3);
  });
});

describe('User.capabilities', () => {
  it('holds more than one capability at once — the whole point', async () => {
    const caps = await strapi.documents('api::member-capability.member-capability')
      .findMany({ filters: { slug: { $in: ['national_admin', 'chapter_admin'] } } });
    expect(caps).toHaveLength(2);

    const user = await strapi.plugin('users-permissions').service('user').add({
      username: `multicap-${RUN}@areaa.test`, email: `multicap-${RUN}@areaa.test`,
      password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Multi', lastName: 'Cap',
      capabilities: caps.map((c) => c.id),
    });

    const read = await strapi.documents('plugin::users-permissions.user').findOne({
      documentId: user.documentId,
      populate: { capabilities: { fields: ['slug'] } },
    });

    expect(read.capabilities.map((c) => c.slug).sort())
      .toEqual(['chapter_admin', 'national_admin']);

    await strapi.documents('plugin::users-permissions.user')
      .delete({ documentId: user.documentId });
  });
});

describe('backfill', () => {
  it('gives every chapter_admin-role user the chapter_admin capability', async () => {
    const users = await strapi.query('plugin::users-permissions.user').findMany({
      where: { role: { type: 'chapter_admin' } },
      populate: { capabilities: true },
    });
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.capabilities.map((c) => c.slug)).toContain('chapter_admin');
    }
  });

  it('gives ordinary members nothing — Authenticated is a baseline, not a capability', async () => {
    const users = await strapi.query('plugin::users-permissions.user').findMany({
      where: { role: { type: 'authenticated' } },
      populate: { capabilities: true },
    });
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u.capabilities).toHaveLength(0);
    }
  });

  it('is idempotent — a second run adds no duplicate link', async () => {
    const { backfillCapabilities } = require('../../src/api/member-capability/seed.js');
    const added = await backfillCapabilities(strapi);
    expect(added).toBe(0);
  });
});

describe('Committee Leader scope', () => {
  it('links a leader to committees by documentId, both ways', async () => {
    // status:'draft' is not decoration. `committee` is draft-and-publish, so
    // linking to the PUBLISHED numeric id yields an empty populate and every
    // scope check 403s — the trap helpers.js:60 documents for chapters.
    const committees = await strapi.documents('api::committee.committee')
      .findMany({ fields: ['name'], limit: 1, status: 'draft' });
    expect(committees).toHaveLength(1);

    const user = await strapi.plugin('users-permissions').service('user').add({
      username: `leader-${RUN}@areaa.test`, email: `leader-${RUN}@areaa.test`,
      password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Lead', lastName: 'Er',
      ledCommittees: [committees[0].id],
    });

    const read = await strapi.documents('plugin::users-permissions.user').findOne({
      documentId: user.documentId,
      populate: { ledCommittees: { fields: ['name'] } },
    });
    expect(read.ledCommittees.map((c) => c.documentId))
      .toEqual([committees[0].documentId]);

    // `username`, not `email`: email is private:true on the user schema and the
    // content-API validator rejects a private field in `fields` outright.
    const back = await strapi.documents('api::committee.committee').findOne({
      documentId: committees[0].documentId, status: 'draft',
      populate: { leaders: { fields: ['username'] } },
    });
    expect(back.leaders.map((u) => u.username)).toContain(`leader-${RUN}@areaa.test`);

    await strapi.documents('plugin::users-permissions.user')
      .delete({ documentId: user.documentId });
  });
});

describe('fail closed', () => {
  it('403s a user with the role and the scope but no capability', async () => {
    // The shape of the bug this codebase already shipped once, inverted: scope
    // and role present, authority absent. It must be a clean 403 — not a 500,
    // and above all not a silent success.
    const [chapter] = await draftChapters(strapi, 1);
    const user = await makeChapterAdmin(strapi, {
      email: `nocap-${RUN}@areaa.test`, chapterIds: [chapter.id], capabilities: [],
    });
    const jwt = await jwtFor(strapi, user.id);

    const res = await request(strapi.server.httpServer)
      .get(`/api/chapter-admin/events?chapterSlug=${chapter.slug}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(403);
  });

  it('403s a committee leader who holds no chapter capability', async () => {
    // committee_leader has no routes yet by design. Holding it must not open
    // the chapter-admin surface — the cross-capability attack.
    const [chapter] = await draftChapters(strapi, 1);
    const user = await makeChapterAdmin(strapi, {
      email: `leaderonly-${RUN}@areaa.test`, chapterIds: [chapter.id],
      capabilities: ['committee_leader'],
    });
    const jwt = await jwtFor(strapi, user.id);

    const res = await request(strapi.server.httpServer)
      .get(`/api/chapter-admin/events?chapterSlug=${chapter.slug}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(403);
  });

  it('200s a national admin for a chapter they do not administer', async () => {
    // The bypass. Scope link deliberately empty: unscoped is a National
    // Admin's normal state, not a misconfiguration.
    const [chapter] = await draftChapters(strapi, 1);
    const user = await makeChapterAdmin(strapi, {
      email: `national-${RUN}@areaa.test`, chapterIds: [],
      capabilities: ['national_admin'],
    });
    const jwt = await jwtFor(strapi, user.id);

    const res = await request(strapi.server.httpServer)
      .get(`/api/chapter-admin/events?chapterSlug=${chapter.slug}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(200);
  });

  it('lists across every chapter for an unscoped national admin', async () => {
    // Without chapterSlug, "unscoped" has to mean every chapter — not the
    // empty set its administeredChapters literally contains.
    const [chapterA, chapterB] = await draftChapters(strapi, 2);
    const national = await makeChapterAdmin(strapi, {
      email: `national-list-${RUN}@areaa.test`, chapterIds: [],
      capabilities: ['national_admin'],
    });
    const scoped = await makeChapterAdmin(strapi, {
      email: `scoped-list-${RUN}@areaa.test`, chapterIds: [chapterA.id],
    });

    const [wide, narrow] = await Promise.all([
      request(strapi.server.httpServer).get('/api/chapter-admin/events')
        .set('Authorization', `Bearer ${await jwtFor(strapi, national.id)}`),
      request(strapi.server.httpServer).get('/api/chapter-admin/events')
        .set('Authorization', `Bearer ${await jwtFor(strapi, scoped.id)}`),
    ]);

    expect(wide.status).toBe(200);
    expect(narrow.status).toBe(200);

    // Both must actually return rows, or every assertion below is vacuous.
    expect(narrow.body.meta.pagination.total).toBeGreaterThan(0);

    // The scoped admin sees their own chapter and nothing else.
    const narrowChapters = new Set(narrow.body.data.map((r) => r.chapter.slug));
    expect([...narrowChapters]).toEqual([chapterA.slug]);

    // The national admin sees STRICTLY more, spanning more than one chapter —
    // including chapterB, which they are not an administrator of.
    const wideChapters = new Set(wide.body.data.map((r) => r.chapter?.slug));
    expect(wide.body.meta.pagination.total)
      .toBeGreaterThan(narrow.body.meta.pagination.total);
    expect(wideChapters.size).toBeGreaterThan(1);
    expect(wideChapters).toContain(chapterB.slug);

    // And never a chapterless national record: "every chapter" is not "no
    // chapter". getOne 404s those, so the list must not surface them either.
    for (const row of wide.body.data) expect(row.chapter).toBeTruthy();
  });

  it('still refuses a national admin a request that names no chapter target', async () => {
    // updateSubmission on a chapterless (national contact form) submission.
    // Bypassing WHICH chapter is not bypassing WHETHER there is one.
    const national = await makeChapterAdmin(strapi, {
      email: `national-null-${RUN}@areaa.test`, chapterIds: [],
      capabilities: ['national_admin'],
    });
    const submission = await strapi.documents('api::form-submission.form-submission')
      .create({ data: { name: `Null Chapter ${RUN}`, email: 'x@example.com' } });

    const res = await request(strapi.server.httpServer)
      .put(`/api/chapter-admin/submissions/${submission.documentId}`)
      .set('Authorization', `Bearer ${await jwtFor(strapi, national.id)}`)
      .send({ handled: true });

    expect(res.status).toBe(403);

    await strapi.documents('api::form-submission.form-submission')
      .delete({ documentId: submission.documentId });
  });
});
