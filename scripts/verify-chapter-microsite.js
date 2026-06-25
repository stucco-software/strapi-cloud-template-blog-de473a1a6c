'use strict';

/**
 * Smoke-test the public REST API for a chapter microsite page.
 * Run (with `make dev` serving on :1337):
 *   node scripts/verify-chapter-microsite.js [chapterSlug]   # default: aloha-hawaii
 *
 * Validates the deep dynamic-zone populate (frontend plan §3) against real
 * seeded data:
 *  - public read works (no token, no 403)
 *  - EVERY component type is listed in the `on` map (unlisted types are dropped
 *    by Strapi v5 — this is why the populate must be exhaustive)
 *  - two-level media populate (section -> figure)
 *  - nested relation populate (member-group -> members -> image), which only
 *    works once the Public role has `find` on plugin::users-permissions.user
 *  - field-restriction on the page endpoint (no email/status/dues leak)
 *
 * Exits non-zero on any failed check so it can double as a CI smoke test.
 */

const qs = require('qs');

const BASE = process.env.STRAPI_URL || 'http://localhost:1337';
const chapterSlug = process.argv[2] || 'aloha-hawaii';

// Fields the public member-group is allowed to expose — anything else (beyond
// the populated `image`) is a leak.
const ALLOWED_MEMBER_FIELDS = new Set([
  'id',
  'documentId',
  'displayName',
  'firstName',
  'lastName',
  'title',
]);

// Exhaustive `on` map — every component type the Page dynamic zone can hold.
// A type omitted here is omitted from the response, so keep this in lockstep
// with the renderer's populate.
const query = qs.stringify(
  {
    filters: { slug: { $eq: 'home' }, chapter: { slug: { $eq: chapterSlug } } },
    status: 'published',
    populate: {
      chapter: { fields: ['name', 'slug'] },
      components: {
        on: {
          'shared.hero': {
            populate: { figure: true, primaryCta: true, secondaryCta: true },
          },
          'shared.section': {
            populate: { figure: true, primaryCta: true, secondaryCta: true },
          },
          'shared.upcoming-events': {
            populate: { link: true, events: { populate: { figure: true } } },
          },
          'shared.member-group': {
            populate: {
              link: true,
              members: {
                populate: { image: true },
                fields: ['displayName', 'firstName', 'lastName', 'title'],
              },
            },
          },
          'shared.partner-group': {
            populate: { partners: { populate: { logo: true } } },
          },
          'shared.partner-callout': {
            populate: { link: true, partner: { populate: { logo: true } } },
          },
          'shared.gallery': { populate: { photos: true } },
          'shared.video-embed': { populate: '*' },
          'shared.social-media-feed': { populate: '*' },
          'shared.contact-form': { populate: { fields: true } },
          'shared.news-and-resources': {
            populate: { link: true, newsItems: true, resources: true },
          },
        },
      },
    },
  },
  { encodeValuesOnly: true }
);

const checks = [];
const record = (label, pass, detail) => {
  checks.push({ label, pass });
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const res = await fetch(`${BASE}/api/pages?${query}`);

  record(`public read (HTTP ${res.status})`, res.ok, res.ok ? null : 'expected 200');
  if (!res.ok) return finish();

  const page = (await res.json()).data?.[0];
  record('chapter "home" page found', !!page, page ? null : `no page for ${chapterSlug}`);
  if (!page) return finish();

  const components = page.components || [];
  record(
    `dynamic zone populated (${components.length} components)`,
    components.length > 0,
    components.map((c) => c.__component.replace('shared.', '')).join(', ')
  );

  const hero = components.find((c) => c.__component === 'shared.hero');
  record('hero -> figure (two-level media)', !!hero?.figure?.url, hero?.figure?.url || 'missing');

  const mg = components.find((c) => c.__component === 'shared.member-group');
  const members = mg?.members || [];
  record(
    'member-group -> members -> image (nested relation)',
    members.length > 0,
    members.length ? `${members.length} members` : 'EMPTY — grant Public `find` on users'
  );

  if (members.length) {
    const leaked = Object.keys(members[0]).filter(
      (k) => !ALLOWED_MEMBER_FIELDS.has(k) && k !== 'image'
    );
    record(
      'member field-restriction (no PII leak on page endpoint)',
      leaked.length === 0,
      leaked.length ? `LEAKED: ${leaked.join(', ')}` : `keys: ${Object.keys(members[0]).join(', ')}`
    );
  }

  finish();
}

function finish() {
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} CHECK(S) FAILED`} (${checks.length} total)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Request failed:', err.message);
  console.error(`Is Strapi running at ${BASE}? Start it with \`make dev\`.`);
  process.exit(1);
});
