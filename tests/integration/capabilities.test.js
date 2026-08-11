import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { boot, shutdown } from './helpers.js';

// src/ is CJS throughout; require it the same way tests/unit/grants.test.js does
// rather than fighting ESM interop for a namespace that has no default export.
const require = createRequire(import.meta.url);

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
      username: 'multicap@areaa.test', email: 'multicap@areaa.test',
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

describe('Committee Leader scope', () => {
  it('links a leader to committees by documentId, both ways', async () => {
    // status:'draft' is not decoration. `committee` is draft-and-publish, so
    // linking to the PUBLISHED numeric id yields an empty populate and every
    // scope check 403s — the trap helpers.js:60 documents for chapters.
    const committees = await strapi.documents('api::committee.committee')
      .findMany({ fields: ['name'], limit: 1, status: 'draft' });
    expect(committees).toHaveLength(1);

    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'leader@areaa.test', email: 'leader@areaa.test',
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
    expect(back.leaders.map((u) => u.username)).toContain('leader@areaa.test');

    await strapi.documents('plugin::users-permissions.user')
      .delete({ documentId: user.documentId });
  });
});
