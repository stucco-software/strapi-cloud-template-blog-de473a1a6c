import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';
import {
  boot, shutdown, draftChapters, jwtFor, makeChapterAdmin, makeMember,
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

/**
 * Accounts this file creates, torn down in afterAll.
 *
 * Not optional hygiene. Several tests below build DELIBERATELY broken users —
 * the chapter_admin role with no capability, for instance — and the
 * equivalence test asserts over every user in the database. Left behind, those
 * counterexamples are indistinguishable from a real regression on the next
 * run, and they accumulate one set per run.
 */
const created = [];
const track = (user) => { created.push(user.documentId); return user; };

beforeAll(async () => { strapi = await boot(); });

afterAll(async () => {
  for (const documentId of created) {
    await strapi.documents('plugin::users-permissions.user')
      .delete({ documentId }).catch(() => {});
  }
  await shutdown();
});

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

    const user = track(await strapi.plugin('users-permissions').service('user').add({
      username: `multicap-${RUN}@areaa.test`, email: `multicap-${RUN}@areaa.test`,
      password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Multi', lastName: 'Cap',
      capabilities: caps.map((c) => c.id),
    }));

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

    const user = track(await strapi.plugin('users-permissions').service('user').add({
      username: `leader-${RUN}@areaa.test`, email: `leader-${RUN}@areaa.test`,
      password: 'Password123!', confirmed: true, provider: 'local',
      firstName: 'Lead', lastName: 'Er',
      ledCommittees: [committees[0].id],
    }));

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
    const user = track(await makeChapterAdmin(strapi, {
      email: `nocap-${RUN}@areaa.test`, chapterIds: [chapter.id], capabilities: [],
    }));
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
    const user = track(await makeChapterAdmin(strapi, {
      email: `leaderonly-${RUN}@areaa.test`, chapterIds: [chapter.id],
      capabilities: ['committee_leader'],
    }));
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
    const user = track(await makeChapterAdmin(strapi, {
      email: `national-${RUN}@areaa.test`, chapterIds: [],
      capabilities: ['national_admin'],
    }));
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
    const national = track(await makeChapterAdmin(strapi, {
      email: `national-list-${RUN}@areaa.test`, chapterIds: [],
      capabilities: ['national_admin'],
    }));
    const scoped = track(await makeChapterAdmin(strapi, {
      email: `scoped-list-${RUN}@areaa.test`, chapterIds: [chapterA.id],
    }));

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
    const national = track(await makeChapterAdmin(strapi, {
      email: `national-null-${RUN}@areaa.test`, chapterIds: [],
      capabilities: ['national_admin'],
    }));
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

describe('GET /api/users/me', () => {
  it('exposes the caller’s capabilities', async () => {
    const [chapter] = await draftChapters(strapi, 1);
    const user = track(await makeChapterAdmin(strapi, {
      email: `mecaps-${RUN}@areaa.test`, chapterIds: [chapter.id],
      capabilities: ['chapter_admin', 'national_admin'],
    }));

    const res = await request(strapi.server.httpServer)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${await jwtFor(strapi, user.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.capabilities.map((c) => c.slug).sort())
      .toEqual(['chapter_admin', 'national_admin']);
    expect(res.body.capabilities.every((c) => typeof c.name === 'string')).toBe(true);
    // categories is the authority model; no client needs it and shipping it
    // would invite the frontend to re-derive authorization decisions.
    expect(res.body.capabilities.every((c) => !('categories' in c))).toBe(true);

    // Unchanged: the existing shape must survive.
    expect(res.body.role.type).toBe('chapter_admin');
    expect(Array.isArray(res.body.administeredChapters)).toBe(true);
  });

  it('returns an empty array, never undefined, for a plain member', async () => {
    // Created here rather than looked up. This read a fixed
    // `plainmember@areaa.test` that no seed has ever written, so it failed on a
    // missing row rather than on the response shape it exists to pin. Tracked
    // for teardown like every other account this file mints — the equivalence
    // test below excludes post-boot users by design.
    const member = track(await makeMember(strapi, {
      email: `plainmember-${RUN}@areaa.test`,
    }));

    const res = await request(strapi.server.httpServer)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${await jwtFor(strapi, member.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual([]);
  });
});

describe('backfill equivalence', () => {
  it("every user's effective grants match what their role granted before", async () => {
    const { grantsFor, AUTHENTICATED_GRANTS } =
      require('../../src/api/chapter-admin/grants.js');
    const baseline = [...AUTHENTICATED_GRANTS].sort();

    // Every user the backfill actually migrated — i.e. everyone who existed at
    // boot. Accounts THIS FILE fabricated after boot are excluded on purpose:
    // several are deliberately broken (the chapter_admin role with no
    // capability) to prove the fail-closed path, they were never backfilled,
    // and counting them here would assert that a counterexample is not a
    // counterexample.
    const all = await strapi.query('plugin::users-permissions.user').findMany({
      populate: { role: true, capabilities: true },
      limit: -1,
    });
    const users = all.filter((u) => !created.includes(u.documentId));
    expect(users.length).toBeGreaterThan(0);
    expect(users.length).toBeLessThan(all.length); // the filter did something

    let sawAdmin = false;
    let sawMember = false;

    for (const user of users) {
      // What the role grants today — read from the database, the shipped truth.
      // Distinct actions, NOT row counts: chapter_admin has 31 link rows against
      // 30 distinct actions (one orphan pointing at a deleted permission), so
      // comparing counts would report a regression that is not there.
      const rows = await strapi.query('plugin::users-permissions.permission')
        .findMany({ where: { role: user.role.id } });
      const fromRole = [...new Set(rows.map((r) => r.action))].sort();

      // What the capability model computes.
      const fromCaps = grantsFor((user.capabilities ?? []).map((c) => c.slug));

      if (user.role.type === 'chapter_admin') {
        sawAdmin = true;
        expect(fromCaps, user.email).toEqual(fromRole);
      } else {
        sawMember = true;
        // Ordinary members hold no capability, so the model gives them exactly
        // the baseline — stated as a literal set, not derived from fromRole,
        // which would make the assertion agree with itself.
        expect(fromCaps, user.email).toEqual(baseline);
        // …and the baseline is genuinely a subset of what the role already
        // granted them, so nobody GAINED anything from the migration.
        for (const action of fromCaps) {
          expect(fromRole, `${user.email} gained ${action}`).toContain(action);
        }
      }
    }

    // Both branches must actually have run, or this passes by covering nothing.
    expect(sawAdmin, 'no chapter_admin user in the fixture').toBe(true);
    expect(sawMember, 'no ordinary member in the fixture').toBe(true);
  });
});
