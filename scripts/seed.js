'use strict';

/**
 * Sample-content seed script.
 * Run with: node scripts/seed.js
 *
 * Boots a standalone Strapi instance, wipes the seedable content types,
 * and populates them with representative sample data. The Home page and
 * chapter microsite pages mirror the layouts in:
 *   - Homepage_v3.pdf
 *   - Chapter Microsite Template.pdf
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStrapi, compileStrapi } = require('@strapi/strapi');
const {
  backfillCapabilities,
} = require('../src/api/member-capability/seed');

// 1x1 PNG used as a stand-in for every media field.
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Rich-text (blocks) paragraph helper.
const p = (text) => ({ type: 'paragraph', children: [{ type: 'text', text }] });
// Rich-text (blocks) unordered-list helper — one <li> per string. Produces a
// real `list` block (renders as <ul> via the frontend RichText component)
// instead of a paragraph of manual "• …\n• …" bullets.
const ul = (items) => ({
  type: 'list',
  format: 'unordered',
  children: items.map((text) => ({
    type: 'list-item',
    children: [{ type: 'text', text }],
  })),
});
// CTA component helper.
const cta = (label, href, style) => ({ label, href, style });

/**
 * Refuse to run against anything but a local SQLite file.
 *
 * This script DELETES every document in nine collection types — including
 * `form-submission`, which holds real member inquiries — and then repopulates
 * them with sample data. It has no prompt and no dry run.
 *
 * It also reads whatever `.env` or environment variables happen to be present,
 * so `node scripts/seed.js` in a shell with DATABASE_URL pointing at the
 * deployed Postgres would silently destroy every page, event, chapter and
 * contact submission in that environment. `make fresh` is a two-word path to
 * the same place.
 *
 * Local SQLite runs unguarded. Anything else must be named explicitly:
 *
 *   SEED_CONFIRM="<DATABASE_NAME or DATABASE_URL>" node scripts/seed.js
 *
 * Typing the target is the point — it cannot be satisfied by accident.
 */
function assertSafeTarget() {
  const client = process.env.DATABASE_CLIENT || 'sqlite';
  const url = process.env.DATABASE_URL || '';
  const name = process.env.DATABASE_NAME || '';
  const target = url || name;

  if (client === 'sqlite' && !url) return; // local dev — the intended case

  if (target && process.env.SEED_CONFIRM === target) {
    console.warn(`⚠️  Seeding a NON-LOCAL database (${client}): ${target}`);
    return;
  }

  console.error(
    [
      '',
      '✋ Refusing to seed.',
      '',
      `   This script wipes all seedable content and would run against: ${client}${target ? ` → ${target}` : ''}`,
      '   That includes every form-submission (real member inquiries).',
      '',
      '   Local SQLite runs without a guard. To target anything else, name it:',
      `     SEED_CONFIRM="${target || '<DATABASE_NAME or DATABASE_URL>'}" node scripts/seed.js`,
      '',
    ].join('\n')
  );
  process.exit(1);
}

async function main() {
  assertSafeTarget();

  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';

  /*
    Event dates RELATIVE to when the seed runs, never absolute.

    Every event here was pinned to a 2026 calendar date, and they have all since
    passed — so a chapter's only event sat in the past and its Upcoming Events
    section rendered empty, while the page still looked populated because the
    one national event that happened to remain in the future was attached to it.
    A fixture that silently expires is worse than no fixture: the bug it creates
    looks like a code bug, and it appears months after anyone touched the seed.
  */
  const inDays = (days, hour = 17) => {
    const d = new Date(Date.now() + days * 86400000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const docs = (uid) => app.documents(uid);
  const pub = { status: 'published' };

  // Single types in v5: documents().update() is a no-op when the entry doesn't
  // exist yet, leaving GET /api/<single-type> returning 404. Create-or-update
  // explicitly. Same call shape as docs(uid).update({ data }) so call sites read
  // the same.
  const putSingle = (uid) => ({
    update: async ({ data }) => {
      const existing = await docs(uid).findFirst();
      return existing
        ? docs(uid).update({ documentId: existing.documentId, data })
        : docs(uid).create({ data });
    },
  });

  // --- clean slate ----------------------------------------------------------
  const collectionUids = [
    'api::news-item.news-item',
    'api::form-submission.form-submission',
    'api::page.page',
    'api::event.event',
    'api::committee.committee',
    'api::resource.resource',
    'api::faq.faq',
    'api::partner.partner',
    'api::partner-tier.partner-tier',
    'api::chapter.chapter',
  ];
  for (const uid of collectionUids) {
    const existing = await docs(uid).findMany({ limit: -1 });
    for (const entry of existing) {
      await docs(uid).delete({ documentId: entry.documentId });
    }
  }
  const oldUsers = await app.db
    .query('plugin::users-permissions.user')
    .findMany({ where: { email: { $contains: '@areaa.example' } } });
  for (const u of oldUsers) {
    await app.db.query('plugin::users-permissions.user').delete({ where: { id: u.id } });
  }

  // --- placeholder image ----------------------------------------------------
  const tmpFile = path.join(os.tmpdir(), 'areaa-placeholder.png');
  fs.writeFileSync(tmpFile, Buffer.from(PLACEHOLDER_PNG, 'base64'));
  const [placeholder] = await app
    .plugin('upload')
    .service('upload')
    .upload({
      data: {},
      files: {
        filepath: tmpFile,
        originalFilename: 'placeholder.png',
        mimetype: 'image/png',
        size: fs.statSync(tmpFile).size,
      },
    });
  const img = placeholder.id;

  // --- chapters -------------------------------------------------------------
  const chapterData = [
    { name: 'Aloha (Hawaii)', slug: 'aloha-hawaii', email: 'hawaii@areaa.example' },
    { name: 'Greater Chicago', slug: 'greater-chicago', email: 'chicago@areaa.example' },
    { name: 'Boston', slug: 'boston', email: 'boston@areaa.example' },
  ];
  const chapters = {};
  for (const c of chapterData) {
    chapters[c.slug] = await docs('api::chapter.chapter').create({ data: c, ...pub });
  }

  // --- members (extended users) --------------------------------------------
  const authRole = await app.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'authenticated' } });

  // Chapter Admin exists by now: src/index.js bootstrap() creates it (and the
  // three capabilities) on every boot, including this script's own boot. The
  // seed wires chapter.administrators — SCOPE — for six members, but scope
  // alone passes the route guards and then 403s behind every chapter-admin API
  // call, so at least one seeded user needs the role too, or a fresh database
  // has no working chapter admin to log in as.
  const chapterAdminRole = await app.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'chapter_admin' } });

  if (!chapterAdminRole) {
    throw new Error(
      'The Chapter Admin role is missing. bootstrap() in src/index.js creates ' +
        'it on boot — if it is absent, the boot failed and seeding would ' +
        'produce a database with no chapter admin.'
    );
  }

  const memberData = [
    // The seeded chapter admin for aloha-hawaii — see chapterAdmin below.
    { first: 'Mei', last: 'Tanaka', chapter: 'aloha-hawaii', status: 'Active', title: 'Chapter President',
      chapterAdmin: true,
      memberSince: '2014-03-01', autoRenew: true, duesPaidThrough: '2027-07-20',
      location: 'Honolulu, HI', company: 'Aloha Realty Group', phone: '(808) 555-0142',
      postalCode: '96815', languages: 'English, Japanese', designations: 'CIPS, ABR',
      x: 'meitanaka', instagram: 'mei.tanaka.realty' },
    { first: 'David', last: 'Park', chapter: 'aloha-hawaii', status: 'Active', title: 'Membership Chair',
      memberSince: '2019-09-15', autoRenew: true, duesPaidThrough: '2026-09-15',
      location: 'Kailua, HI', company: 'Pacific Homes', phone: '(808) 555-0177',
      postalCode: '96734', languages: 'English, Korean', designations: 'ABR',
      x: '', instagram: 'davidpark.homes' },
    { first: 'Priya', last: 'Nair', chapter: 'greater-chicago', status: 'Active', title: 'Chapter President',
      memberSince: '2016-06-10', autoRenew: false, duesPaidThrough: '2026-06-10',
      location: 'Chicago, IL', company: 'Lakeside Property Partners', phone: '(312) 555-0198',
      postalCode: '60601', languages: 'English, Hindi, Malayalam', designations: 'CIPS, GRI',
      x: 'priyanair_re', instagram: '' },
    { first: 'James', last: 'Wong', chapter: 'greater-chicago', status: 'Lapsed', title: 'Board Member',
      memberSince: '2021-01-20', autoRenew: false, duesPaidThrough: '2025-01-20',
      location: 'Naperville, IL', company: 'Wong Realty', phone: '(630) 555-0111',
      postalCode: '60540', languages: 'English, Cantonese, Mandarin', designations: '',
      x: '', instagram: '' },
    { first: 'Sofia', last: 'Reyes', chapter: 'boston', status: 'Active', title: 'Chapter President',
      memberSince: '2018-11-05', autoRenew: true, duesPaidThrough: '2026-11-05',
      location: 'Boston, MA', company: 'Bay State Realty Advisors', phone: '(617) 555-0164',
      postalCode: '02108', languages: 'English, Spanish, Tagalog', designations: 'ABR, SRS',
      x: 'sofiareyesRE', instagram: 'sofia.reyes.homes' },
    { first: 'Aaron', last: 'Kim', chapter: 'boston', status: 'Honorary', title: 'Founding Member',
      memberSince: '2009-05-01', autoRenew: false, duesPaidThrough: null,
      location: 'Cambridge, MA', company: 'Kim & Associates', phone: '(617) 555-0129',
      postalCode: '02139', languages: 'English, Korean', designations: 'CRS, CIPS',
      x: '', instagram: '' },
  ];
  const members = [];
  for (const m of memberData) {
    const username = `${m.first}.${m.last}`.toLowerCase();
    const user = await app.plugin('users-permissions').service('user').add({
      username,
      email: `${username}@areaa.example`,
      password: 'Password123!',
      provider: 'local',
      confirmed: true,
      role: m.chapterAdmin ? chapterAdminRole.id : authRole.id,
      firstName: m.first,
      lastName: m.last,
      displayName: `${m.first} ${m.last}`,
      status: m.status,
      title: m.title,
      bio: `${m.first} is a real estate professional active in the ${m.chapter} chapter.`,
      memberSince: m.memberSince,
      autoRenew: m.autoRenew,
      duesPaidThrough: m.duesPaidThrough,
      location: m.location,
      company: m.company,
      phone: m.phone,
      postalCode: m.postalCode,
      languages: m.languages,
      designations: m.designations,
      x: m.x,
      instagram: m.instagram,
    });
    members.push({ ...user, chapterSlug: m.chapter });
  }
  const byChapter = (slug) => members.filter((u) => u.chapterSlug === slug);

  // --- partners / sponsors --------------------------------------------------
  const partnerData = [
    { name: 'Chase', sponsorshipLevel: 'Platinum', url: 'https://example.com/chase' },
    { name: 'Bank of America', sponsorshipLevel: 'Gold', url: 'https://example.com/bofa' },
    { name: 'Citi', sponsorshipLevel: 'Silver', url: 'https://example.com/citi' },
    { name: 'Wells Fargo', sponsorshipLevel: 'Bronze', url: 'https://example.com/wells-fargo' },
    { name: 'Rocket Mortgage', url: 'https://example.com/rocket' },
  ];
  const partners = [];
  for (const part of partnerData) {
    partners.push(
      await docs('api::partner.partner').create({ data: { ...part, logo: img }, ...pub })
    );
  }

  // --- chapter-owned tiers and sponsors ------------------------------------
  // The five partners above are NATIONAL: no `chapter`, shared by every
  // microsite and the national sponsor page, and not editable from a chapter
  // screen. These are the other kind — a chapter's own tier structure, with
  // its own labels and order, and a sponsor filed under one.
  //
  // aloha-hawaii only, deliberately: greater-chicago and boston are left with
  // no tiers so the empty state is reachable without editing the seed.
  const tierData = [
    { name: 'Presenting', rank: 10 },
    { name: 'Gold', rank: 20 },
    { name: 'Community', rank: 30 },
  ];
  const alohaTiers = {};
  for (const tier of tierData) {
    alohaTiers[tier.name] = await docs('api::partner-tier.partner-tier').create({
      data: { ...tier, chapter: chapters['aloha-hawaii'].documentId },
      ...pub,
    });
  }

  const chapterPartnerData = [
    { name: 'Aloha Mortgage Co.', tier: 'Presenting', url: 'https://example.com/aloha-mortgage' },
    { name: 'Island Title & Escrow', tier: 'Gold', url: 'https://example.com/island-title' },
    // No tier and no url: both are optional, and the microsite has to render
    // an untiered sponsor somewhere rather than dropping it.
    { name: "Hale 'Aina Realty", tier: null, url: '' },
  ];
  for (const part of chapterPartnerData) {
    partners.push(await docs('api::partner.partner').create({
      data: {
        name: part.name,
        url: part.url || null,
        logo: img,
        chapter: chapters['aloha-hawaii'].documentId,
        tier: part.tier ? alohaTiers[part.tier].documentId : null,
      },
      ...pub,
    }));
  }

  // --- back-fill chapter relations -----------------------------------------
  // Indices into `partners`. 0-4 are the national rows; 5-7 are aloha's own,
  // appended above — so aloha's microsite shows both kinds together, which is
  // the case the grouped renderer has to get right.
  const chapterAssignments = {
    'aloha-hawaii': { partners: [0, 1, 5, 6, 7] },
    'greater-chicago': { partners: [2, 3] },
    boston: { partners: [1, 4] },
  };
  for (const [slug, a] of Object.entries(chapterAssignments)) {
    const chapterMembers = byChapter(slug);
    const president = chapterMembers.find((m) => m.title.includes('President'));
    await docs('api::chapter.chapter').update({
      documentId: chapters[slug].documentId,
      data: {
        president: president ? president.id : undefined,
        administrators: chapterMembers.map((m) => m.id),
        members: chapterMembers.map((m) => m.id),
      },
      ...pub,
    });
  }

  // --- national delegate board ----------------------------------------------
  // AREAA's Delegate Board is the association's national governing body —
  // chapter presidents and national committee leaders. Seeded as standalone
  // users (no chapter relation, so they don't surface on chapter microsites)
  // and grouped under a chapter-less "Delegate Board" committee that the
  // /about/delegate-board page renders. `title` holds each member's board role.
  const delegateData = [
    { first: 'Manolito', last: 'Acebedo', title: 'Greater East Bay Chapter President' },
    { first: 'Brenda', last: 'Barrett', title: 'Greater Denver Chapter President' },
    { first: 'Chantal', last: 'Camarillo', title: 'Mortgage Committee Vice-Chair' },
    { first: 'Ann', last: 'Chang', title: 'TheEdge Committee Vice-Chair' },
    { first: 'Peter', last: 'Chang', title: 'Greater Los Angeles Chapter President' },
    { first: 'Shirley', last: 'Chen', title: 'Tri-County Chapter President' },
    { first: 'Phoenix', last: 'Chiang', title: 'Member Services Committee Vice-Chair' },
    { first: 'Miriam', last: 'Crispin', title: 'Chapter Services Committee Chair' },
  ];
  const delegates = [];
  for (const d of delegateData) {
    const username = `${d.first}.${d.last}`.toLowerCase();
    const user = await app.plugin('users-permissions').service('user').add({
      username,
      email: `${username}@areaa.example`,
      password: 'Password123!',
      provider: 'local',
      confirmed: true,
      role: authRole.id,
      firstName: d.first,
      lastName: d.last,
      displayName: `${d.first} ${d.last}`,
      status: 'Active',
      title: d.title,
    });
    delegates.push(user);
  }

  // --- national executive board ---------------------------------------------
  // AREAA's Executive Board is the association's slate of national officers
  // (President, Vice-President, Treasurer, …). Seeded like the delegates —
  // chapter-less users grouped under a chapter-less "Executive Board" that the
  // /about/executive-board page renders. Ordered by office rank, not
  // alphabetically; `title` holds each officer's role.
  const officerData = [
    { first: 'Bryan', last: 'Ahn', title: '2026 President' },
    { first: 'William', last: 'Wang', title: '2026 Vice-President' },
    { first: 'Jamie', last: 'Tian', title: 'Immediate Past President' },
    { first: 'Gary', last: 'Lai', title: '2026 Treasurer' },
  ];
  const officers = [];
  for (const o of officerData) {
    const username = `${o.first}.${o.last}`.toLowerCase();
    const user = await app.plugin('users-permissions').service('user').add({
      username,
      email: `${username}@areaa.example`,
      password: 'Password123!',
      provider: 'local',
      confirmed: true,
      role: authRole.id,
      firstName: o.first,
      lastName: o.last,
      displayName: `${o.first} ${o.last}`,
      status: 'Active',
      title: o.title,
    });
    officers.push(user);
  }

  // --- committees -----------------------------------------------------------
  const committeeData = [
    { name: 'Executive Committee', chapter: 'aloha-hawaii' },
    { name: 'Board of Directors', chapter: 'aloha-hawaii' },
    { name: 'Events Committee', chapter: 'greater-chicago' },
    { name: 'Education Committee', chapter: 'boston' },
  ];
  for (const c of committeeData) {
    await docs('api::committee.committee').create({
      data: {
        name: c.name,
        description: `The ${c.name} for the ${chapters[c.chapter].name} chapter.`,
        chapter: chapters[c.chapter].documentId,
        members: byChapter(c.chapter).map((m) => m.id),
      },
      ...pub,
    });
  }

  // National Delegate Board — no chapter relation.
  await docs('api::committee.committee').create({
    data: {
      name: 'Delegate Board',
      description:
        "AREAA's Delegate Board is the association's national governing body. " +
        'Composed of chapter presidents and national committee leaders elected ' +
        'from AREAA chapters across the country, it sets policy, ratifies the ' +
        "annual budget, and elects the association's national officers.",
      members: delegates.map((d) => d.id),
    },
    ...pub,
  });

  // National Executive Board — no chapter relation. Distinct from the
  // aloha-hawaii chapter "Executive Committee" above; the /about page fetches
  // scoped to chapter-null so national and chapter bodies never collide.
  await docs('api::committee.committee').create({
    data: {
      name: 'Executive Board',
      description:
        "AREAA's Executive Board is the association's slate of national " +
        'officers — the President, Vice-President, Immediate Past President, and ' +
        'Treasurer — who lead strategy, finances, and day-to-day governance ' +
        'between Delegate Board meetings.',
      members: officers.map((o) => o.id),
    },
    ...pub,
  });

  // --- events ---------------------------------------------------------------
  // Two national events shown on both the Home page and chapter microsites,
  // matching the "Upcoming Events" block in the PDFs.
  const policySummitDesc =
    "AREAA's Housing Policy Summit is the leading event for Asian American " +
    'homeownership advocacy. As the new administration and Congress begin their ' +
    'tenure, it is important to make sure that the political and economic ' +
    'opportunity within our community is not forgotten.';
  const webinarDesc =
    "This year's State of Asia America report takes a distinctly human-centered " +
    'approach shedding light on the emotional and economic toll of recent climate ' +
    'disasters on AANHPI families. From the rising cost of rebuilding to the ' +
    'shrinking safety net of home insurance, we unpack the data, stories, and ' +
    'policies shaping the future of homeownership and resilience in our communities.';

  const policySummit = await docs('api::event.event').create({
    data: {
      title: '2026 AREAA Policy Summit',
      slug: '2026-areaa-policy-summit',
      startsAt: inDays(45, 16),
      endsAt: inDays(45, 21),
      location: 'Washington, DC',
      memberPrice: 0,
      publicPrice: 0,
      figure: img,
      description: [p(policySummitDesc)],
    },
    ...pub,
  });
  const reportWebinar = await docs('api::event.event').create({
    data: {
      title: 'State of Asia America Report Webinar',
      slug: 'state-of-asia-america-report-webinar',
      startsAt: inDays(120, 19),
      location: 'Online',
      locationUrl: 'https://example.com/webinar/state-of-asia-america',
      memberPrice: 0,
      publicPrice: 0,
      figure: img,
      description: [p(webinarDesc)],
    },
    ...pub,
  });
  const nationalEvents = [policySummit, reportWebinar];

  // A chapter-scoped event apiece, for richer sample data. Captured by slug:
  // each chapter's home page attaches its OWN event, not national's.
  const chapterEvents = {};
  for (const slug of Object.keys(chapters)) {
    chapterEvents[slug] = await docs('api::event.event').create({
      data: {
        title: `${chapters[slug].name} Summer Mixer`,
        slug: `${slug}-summer-mixer`,
        startsAt: inDays(21, 1),
        location: `${chapters[slug].name} — venue TBD`,
        memberPrice: 20,
        publicPrice: 40,
        figure: img,
        description: [p(`A networking mixer hosted by the ${chapters[slug].name} chapter.`)],
        chapter: chapters[slug].documentId,
      },
      ...pub,
    });
  }

  // --- resources ------------------------------------------------------------
  // The first three mirror the "Latest News and Resources" cards in the PDFs.
  const resourceData = [
    { title: '2025 State of Asia America Report', kind: 'Download', file: img },
    { title: 'Fall 2025 a|r|e Publication', kind: 'Download', file: img },
    {
      title: '2025 AREAA A-List Press Release',
      kind: 'Link',
      url: 'https://example.com/areaa-a-list-2025',
    },
    { title: 'AREAA Member Handbook 2026', kind: 'Download', file: img },
    {
      title: 'Webinar: Navigating a Shifting Market',
      kind: 'Webinar',
      url: 'https://youtube.com/watch?v=example-webinar',
    },
  ];
  const resources = [];
  for (const r of resourceData) {
    resources.push(
      await docs('api::resource.resource').create({
        data: {
          title: r.title,
          kind: r.kind,
          file: r.file,
          url: r.url,
          figure: img,
          description: `${r.title} — sample resource entry.`,
          publishedDate: '2025-10-01',
        },
        ...pub,
      })
    );
  }

  // --- news items -----------------------------------------------------------
  const newsData = [
    { title: 'AREAA Welcomes Record Membership in 2026', chapter: null, author: members[0] },
    { title: 'Aloha Chapter Hosts Sold-Out Networking Gala', chapter: 'aloha-hawaii', author: members[1] },
    { title: 'Chicago Advocacy Win on Down-Payment Assistance', chapter: 'greater-chicago', author: members[2] },
  ];
  const newsItems = [];
  for (const n of newsData) {
    newsItems.push(
      await docs('api::news-item.news-item').create({
        data: {
          title: n.title,
          excerpt: `${n.title} — a short summary for listing pages.`,
          body: [p(`${n.title}.`), p('This is sample article body content.')],
          figure: img,
          publishedDate: '2026-04-15',
          author: n.author.id,
          chapter: n.chapter ? chapters[n.chapter].documentId : undefined,
        },
        ...pub,
      })
    );
  }

  // --- faqs -----------------------------------------------------------------
  // Questions mirror the current live AREAA FAQ page. "Who are we?" uses the real
  // published copy; the remaining answers are drafts — replace them with final
  // copy in the Strapi admin (the /faq page renders whatever is stored here).
  const faqData = [
    {
      question: 'Who are we?',
      category: 'About',
      answer: [
        p(
          "AREAA's members are real estate, mortgage, and housing professionals that serve the diverse Asian American and Pacific Islander (AAPI) market. AREAA is the only trade association dedicated to representing the interests of the AAPI real estate market nationwide and is the largest AAPI organization in North America."
        ),
        p(
          'You do not need to be Asian American or Pacific Islander to be an AREAA member! Professionals of all cultural backgrounds who are interested in better supporting and serving the AAPI community and furthering the mission of increasing sustainable AAPI homeownership are welcome to join.'
        ),
      ],
    },
    {
      question: 'What is AREAA?',
      category: 'About',
      answer: [
        p(
          'AREAA — the Asian Real Estate Association of America — is a national nonprofit trade organization dedicated to improving the lives of the AAPI community through sustainable homeownership. Founded in 2003, AREAA represents tens of thousands of real estate and housing professionals through chapters across North America.'
        ),
      ],
    },
    {
      question: 'What are the benefits of having AREAA as a partner?',
      category: 'Partnership',
      answer: [
        p(
          'Partnering with AREAA connects your organization to the fastest-growing homebuying demographic in the country. Partners gain visibility across our national events, chapter network, and digital channels, plus opportunities to build lasting relationships with AAPI real estate and housing professionals.'
        ),
      ],
    },
    {
      question: 'Want to join AREAA?',
      category: 'Membership',
      answer: [
        p(
          'Becoming a member is quick and easy. Visit our membership page to select your local chapter and complete your registration online. Membership connects you to a nationwide network, exclusive events, and professional development resources.'
        ),
      ],
    },
    {
      question: 'How much does AREAA membership cost?',
      category: 'Membership',
      answer: [
        p(
          'Membership dues vary by chapter. You can see the exact prorated amount and annual renewal rate for your local chapter when you begin the registration process on our membership page.'
        ),
      ],
    },
    {
      question: 'Can I attend other chapter events outside my local chapter?',
      category: 'Events',
      answer: [
        p(
          'Yes! AREAA membership is national. You are welcome to attend events hosted by any AREAA chapter, not just your local one — a great way to expand your network while traveling or connecting with other markets.'
        ),
      ],
    },
    {
      question: 'How do I cancel my membership?',
      category: 'Membership',
      answer: [
        p(
          'AREAA memberships renew annually on July 1. To cancel, email contact@areaa.org before the July 1 renewal date and our team will assist you.'
        ),
      ],
    },
  ];
  for (const f of faqData) {
    await docs('api::faq.faq').create({
      data: {
        question: f.question,
        category: f.category,
        answer: f.answer,
      },
      ...pub,
    });
  }

  // --- Home page (mirrors Homepage_v3.pdf) ---------------------------------
  await docs('api::page.page').create({
    data: {
      title: 'Home',
      slug: 'index',
      description: 'The Asian Real Estate Association of America.',
      keywords: 'real estate, AREAA, membership, AANHPI',
      components: [
        {
          __component: 'shared.hero',
          title: 'Primary Value Statement Goes Here',
          figure: img,
          body: [
            p(
              'Supporting body text goes here. What is the #1 thing you want ' +
                'visitors to know about you as soon as they come to the website?'
            ),
          ],
          primaryCta: cta('Primary CTA', '/join', 'Primary'),
          secondaryCta: cta('Secondary CTA', '/about', 'Secondary'),
        },
        {
          __component: 'shared.news-and-resources',
          title: 'Latest News and Resources',
          link: cta('View All Resources', '/resources', 'Secondary'),
          resources: resources.slice(0, 3).map((r) => r.documentId),
          newsItems: [],
        },
        {
          __component: 'shared.upcoming-events',
          title: 'Upcoming Events',
          link: cta('View All Events', '/events', 'Secondary'),
          events: nationalEvents.map((e) => e.documentId),
        },
        {
          __component: 'shared.section',
          title: 'The Voice of the AANHPI Community',
          body: [
            p(
              "AREAA's membership represents a vast array of cultural, ethnic, " +
                'and professional backgrounds. AREAA is open to anyone and everyone ' +
                'who works with or seeks to work with the AAPI community. AREAA is a ' +
                'powerful national voice not only for its members, housing and real ' +
                'estate professionals, but the communities they serve.'
            ),
          ],
          primaryCta: cta('Become a Member', '/join', 'Primary'),
        },
        {
          __component: 'shared.member-group',
          title: 'Welcome New Members!',
          link: cta('View All', '/members', 'Secondary'),
          members: members.map((m) => m.id),
        },
        {
          __component: 'shared.section',
          title: 'Partnership',
          body: [
            p(
              'AREAA partners with over 30 local and international organizations ' +
                'and sponsors that enable us to carry out our vision and mission to ' +
                'represent the AAPI community in our advocacy for greater ' +
                'homeownership access for all.'
            ),
          ],
          secondaryCta: cta('Become a Partner', '/partners', 'Secondary'),
        },
        {
          __component: 'shared.partner-group',
          partners: partners.map((part) => part.documentId),
        },
      ],
    },
    ...pub,
  });

  // --- Programs: A-List (served flat at /a-list via the catch-all) ----------
  // Exercises shared.section (with real `list` blocks — winners archive,
  // eligibility, brands) + shared.faq (accordion) dynamic-zone components.
  // Content transcribed from the live areaa.org A-List page; "View 20XX A-List"/
  // winner links are placeholders (#) pending real URLs.
  await docs('api::page.page').create({
    data: {
      title: "AREAA's A-List",
      slug: 'a-list',
      description:
        "Apply for AREAA's 2026 A-List — honoring the best individual agents and teams in the AANHPI real estate community, powered by RealTrends Verified.",
      keywords: 'AREAA, A-List, RealTrends, top producers, awards',
      components: [
        {
          __component: 'shared.hero',
          title: 'Apply for the 2026 A-List Today!',
          body: [
            p('Honoring the Best of the Best in AREAA'),
            p(
              'AREAA is thrilled to partner with RealTrends and their RealTrends ' +
                'Verified program to once again create the AREAA A-List, which ' +
                'honored hundreds of individual agents and teams last year.'
            ),
          ],
          primaryCta: cta('View 2025 A-List', '#', 'Primary'),
          secondaryCta: cta('View 2024 A-List', '#', 'Secondary'),
        },
        {
          __component: 'shared.section',
          body: [
            p(
              'AREAA members who qualify for RealTrends Verified — which includes ' +
                "America's Best Real Estate Professionals and The Thousand — will " +
                "also be considered for AREAA's A-List."
            ),
            ul([
              'An individual must have closed at least 25 sides OR $10 million ' +
                'in sales volume in 2025.',
              'A team must have closed at least 40 sides OR $16 million in ' +
                'sales volume in 2025.',
              'The team lead must be an AREAA member.',
              'All participating teams must email Wellington Clave ' +
                '(wclave@areaa.org) by April 20, 2026 with: the full name of the ' +
                'team, the name of the team lead (must be an AREAA member to be ' +
                'considered), and the full company name including brand name.',
            ]),
          ],
        },
        {
          __component: 'shared.section',
          body: [
            p(
              'The following brands will submit a list of all agents who met the ' +
                'above minimums directly to RealTrends at no cost to the agent. ' +
                'Those who are also AREAA members will be considered for the A-List:'
            ),
            ul([
              'Berkshire Hathaway HomeServices',
              'Better Homes & Gardens Real Estate',
              'Century 21',
              'Coldwell Banker',
              'Compass',
              'Corcoran',
              "Sotheby's International Realty",
              'Douglas Elliman',
              'Engel & Völkers',
              'Exit Realty',
              'eXp Realty',
              'Intero',
              'Keller Williams',
              'NextHome',
              'Redfin',
              'RE/MAX',
              'The Agency',
            ]),
            p(
              'Note: Realty Executives and LeadingRE agents and teams should use ' +
                'the code provided by your corporate office in lieu of payment.'
            ),
          ],
        },
        {
          __component: 'shared.section',
          body: [
            p(
              'If your brand/company is NOT on the above list, you can still apply ' +
                'at www.realtrends.com. The deadline for entry is April 20, 2026. ' +
                'You will be responsible for the discounted $100 fee for your ' +
                'submission. Please note that the promo code AREAA2026 is required ' +
                'to apply the discount. Be prepared to submit third-party ' +
                'verification via an MLS production report or a signed letter from ' +
                'your broker attesting to your production.'
            ),
          ],
        },
        {
          __component: 'shared.section',
          title: 'View Previous A-List Winners',
          body: [
            ul([
              '2023 A-List Winners',
              '2022 A-List Winners',
              '2021 A-List Winners',
              '2020 Top Originators Winners',
              '2020 Top Producers Winners',
              '2019 Winners',
              '2018 Winners',
              '2017 Winners',
              '2016 Winners',
              '2015 Winners',
              '2014 Winners',
            ]),
          ],
        },
        {
          __component: 'shared.faq',
          title: 'Frequently Asked Questions',
          items: [
            {
              question: 'Why have we partnered with RealTrends Verified?',
              answer: [
                p(
                  'RealTrends Verified is one of the leading organizations in our ' +
                    'industry and annually produces definitive lists highlighting ' +
                    'agent and team productivity. With support from Bank of America, ' +
                    'RealTrends will power our list. We also benefit because ' +
                    'RealTrends verifies all data submissions with submitting brands ' +
                    'and/or brokers, accountants, etc.'
                ),
              ],
            },
            {
              question: 'What is RealTrends Verified?',
              answer: [
                p(
                  'RealTrends Verified produces the definitive third-party verified ' +
                    'ranking for all elements of the residential real estate ' +
                    'industry. Their annual rankings showcase exceptional ' +
                    'performance by real estate brokerages, teams, and agents.'
                ),
              ],
            },
            {
              question: 'When will the A-List be announced?',
              answer: [p('Summer 2026.')],
            },
            {
              question: 'When is the deadline for entry?',
              answer: [p('April 20, 2026.')],
            },
            {
              question: 'What if I moved from one company to another in 2025?',
              answer: [
                p(
                  'If you moved to a brand that submits to RealTrends on your ' +
                    'behalf, have your broker/owner reach out directly to your brand ' +
                    'to ensure they sent your FULL 2025 production. You can also ' +
                    'contact RealTrends at Rankings@RealTrends.com. If you are not ' +
                    'with one of those brands, include all of your 2025 production ' +
                    'when you visit www.realtrends.com/realtrends-submissions.'
                ),
              ],
            },
            {
              question: 'What happens if I make the A-List?',
              answer: [
                p(
                  'If you qualify, AREAA will reach out to you with further ' +
                    'instructions.'
                ),
              ],
            },
            {
              question: 'What are the benefits of being on the A-List?',
              answer: [
                p(
                  "All named to the list will benefit from: an exclusive invitation " +
                    "to AREAA's A-List Luncheon at the National Convention; an " +
                    'unparalleled opportunity to meet other top producers; ' +
                    "recognition on AREAA's A-List, including physical signage, a " +
                    'personalized award, and digital recognition via our national ' +
                    'media channels and website; and a distinction that indicates ' +
                    'you are a leader who supports sustainable homeownership for the ' +
                    'AANHPI community.'
                ),
              ],
            },
            {
              question:
                'Do I have to be Asian American or Pacific Islander to apply?',
              answer: [
                p(
                  "No — we invite anyone supportive of AREAA's mission (to advance " +
                    'sustainable homeownership for Asian Americans and Pacific ' +
                    'Islanders) to apply.'
                ),
              ],
            },
            {
              question: 'Do I have to be a member to apply?',
              answer: [
                p(
                  'Yes. You can join at areaa.org/membership-registration. It is ' +
                    'your sole responsibility to ensure your membership is current.'
                ),
              ],
            },
            {
              question: 'Do we have a program for mortgage professionals?',
              answer: [
                p(
                  'Yes. We take member submissions highlighting production. Last ' +
                    'year AREAA honored nearly 40 members.'
                ),
              ],
            },
            {
              question: 'Questions?',
              answer: [
                p(
                  'Email wclave@areaa.org. If you have questions about payment or ' +
                    'your entry, please contact RealTrends at Rankings@RealTrends.com.'
                ),
              ],
            },
          ],
        },
      ],
    },
    ...pub,
  });

  // --- Policy & Advocacy (served flat at /advocacy via the catch-all) -------
  // Was `frontend/src/pages/advocacy.astro`, ~720 hardcoded lines with zero CMS
  // calls — the client flagged at the 2026-08-07 meeting that they could not
  // edit it. Exercises the three new dynamic-zone components (shared.stat-band,
  // shared.card-grid, shared.timeline) alongside hero/section.
  //
  // PLACEHOLDER copy is carried over verbatim from the mockup and is marked
  // below; it is the client's to replace in the admin now that it is editable.
  await docs('api::page.page').create({
    data: {
      title: 'Policy & Advocacy',
      slug: 'advocacy',
      description:
        'AREAA advocates on behalf of the AANHPI community nationwide, focusing on the legislative issues critical to promoting sustainable homeownership.',
      keywords: 'AREAA, advocacy, policy, AANHPI, homeownership, legislation',
      components: [
        {
          __component: 'shared.hero',
          eyebrow: 'Policy & Advocacy',
          title: 'The Voice of The AANHPI Community',
          body: [
            p(
              'The Asian Real Estate Association of America (AREAA) advocates on ' +
                'behalf of the AANHPI community nationwide. AREAA focuses on ' +
                'legislative issues that are critical to its mission: promoting ' +
                'sustainable homeownership opportunities for the AANHPI community.'
            ),
          ],
          figure: img,
        },
        {
          __component: 'shared.stat-band',
          items: [
            { value: '20+', label: 'Years of Advocacy' },
            { value: '18K+', label: 'Members Nationwide' },
            { value: '40+', label: 'Local Chapters' },
          ],
        },
        {
          __component: 'shared.card-grid',
          title: 'Current Policy Points',
          items: [
            {
              title: 'Language Access',
              body: [
                p(
                  'Language barriers are costing AANHPI borrowers homeownership ' +
                    'opportunities. Research shows they face higher mortgage denial ' +
                    'rates despite similar credit profiles to White peers — a ' +
                    "disparity worsened by the recent removal of HUD's translation " +
                    'resources.'
                ),
              ],
              figure: img,
            },
            {
              // PLACEHOLDER — the mockup repeated the Language Access text here.
              title: 'Housing Supply',
              body: [
                p(
                  'Placeholder copy — final Housing Supply messaging to come. This ' +
                    "paragraph stands in for AREAA's position on expanding " +
                    'attainable housing supply for AANHPI families.'
                ),
              ],
              figure: img,
            },
            {
              // PLACEHOLDER — the mockup repeated the Language Access text here.
              title: 'Homeownership Rights',
              body: [
                p(
                  'Placeholder copy — final Homeownership Rights messaging to come. ' +
                    "This paragraph stands in for AREAA's position on protecting and " +
                    'expanding fair access to homeownership.'
                ),
              ],
              figure: img,
            },
          ],
        },
        {
          // Split row per the client mockup: heading/lead/CTA in a text column,
          // the portrait plan cover beside it. Default (white) background.
          __component: 'shared.section',
          layout: 'Split',
          title: 'Our Three-Point Policy Plan',
          body: [
            // PLACEHOLDER — final lead-in copy to come.
            p(
              'Placeholder copy — a short lead-in describing the 2025 Three-Point ' +
                'Policy Plan to boost AANHPI homeownership.'
            ),
          ],
          primaryCta: cta('Download Our Three-Point Plan', '#', 'Primary'),
          figure: img,
        },
        {
          // Same split, but on the mockup's grey ground rather than white.
          __component: 'shared.section',
          layout: 'Split',
          background: 'Muted',
          title: 'The Policy Summit',
          body: [
            // PLACEHOLDER — final event copy to come.
            p(
              "Placeholder copy — an overview of AREAA's annual Policy Summit: who " +
                'attends, what it advances, and why it matters to the AANHPI ' +
                'community. Replace with final event copy.'
            ),
          ],
          primaryCta: cta('View Event Page', '#', 'Primary'),
          figure: img,
        },
        {
          // Mockup order is preserved intentionally (2016, 2022, 2023, 2020) —
          // it is not chronological in the design. All copy here is real.
          __component: 'shared.timeline',
          title: 'AREAA Advocacy at Work',
          items: [
            {
              heading: '2016 - NoOther Campaign',
              body: [
                p(
                  'AREAA successfully persuaded the US Census Bureau to track and ' +
                    'include Asian housing data as a standalone category in its ' +
                    'quarterly reports on homeownership by race and ethnicity.'
                ),
              ],
            },
            {
              heading: '2022 - Preferred Language Field',
              body: [
                p(
                  'AREAA worked with FHFA to include a Preferred Language Field on ' +
                    'the 2020 redesigned URLA in order to better capture the needs ' +
                    'of LEP borrowers. In 2019, the FHFA removed the question. AREAA ' +
                    'continues to advocate for the reversal of its decision.'
                ),
              ],
            },
            {
              heading: '2023 - Translation Clearinghouse',
              body: [
                p(
                  'AREAA collaborated with the GSEs to create translated resources ' +
                    'in Chinese for LEP borrowers. Korean, Vietnamese, and Tagalog ' +
                    'are set to launch this year.'
                ),
              ],
            },
            {
              heading: '2020 - Eliminating the 1% Rule',
              body: [
                p(
                  'AREAA helped change underwriting standards to more fairly account ' +
                    'for student loans that were in deferment when calculating a ' +
                    "borrower's debt-to-income ratio."
                ),
              ],
            },
          ],
        },
        {
          __component: 'shared.section',
          title: 'Join the Movement',
          body: [
            p(
              "There's power in numbers. Become part of the national voice for the " +
                'AANHPI community and help shape the policies that determine who ' +
                'gets to own a home in America.'
            ),
          ],
          primaryCta: cta('Join Today', '/join', 'Primary'),
        },
        {
          // Closing full-bleed group photo, as in the mockup. Placeholder image
          // until AREAA supplies the real one.
          __component: 'shared.image-band',
          figure: img,
          height: 'Tall',
        },
      ],
    },
    ...pub,
  });

  // --- global About page ---------------------------------------------------
  await docs('api::page.page').create({
    data: {
      title: 'About Us',
      slug: 'about',
      description: 'About the Asian Real Estate Association of America.',
      components: [
        {
          __component: 'shared.section',
          title: 'Our Mission',
          body: [
            p(
              'AREAA is dedicated to improving the lives of the Asian American ' +
                'and Pacific Islander community through homeownership.'
            ),
          ],
        },
      ],
    },
    ...pub,
  });

  // --- chapter microsite home pages (mirror Chapter Microsite Template.pdf) -
  for (const slug of Object.keys(chapters)) {
    const chapter = chapters[slug];
    const president = byChapter(slug).find((m) => m.title.includes('President'));
    const chapterMembers = byChapter(slug).map((m) => m.id);
    const chapterPartners = chapterAssignments[slug].partners.map(
      (i) => partners[i].documentId
    );

    await docs('api::page.page').create({
      data: {
        title: 'Home',
        slug: 'home',
        description: `Home page for the ${chapter.name} chapter.`,
        chapter: chapter.documentId,
        components: [
          {
            __component: 'shared.hero',
            title: 'Our Chapter',
            figure: img,
            body: [
              p(
                'Founded in 2003, the Asian Real Estate Association of America ' +
                  '(AREAA) is a national nonprofit trade organization dedicated to ' +
                  'improving the lives of the Asian American and Pacific Islander ' +
                  '(AAPI) community through homeownership.'
              ),
            ],
            primaryCta: cta('Learn More', '/about', 'Primary'),
          },
          {
            // The chapter's OWN event. This attached `nationalEvents`, so every
            // chapter microsite advertised the Policy Summit and the report
            // webinar while its own mixer appeared nowhere.
            //
            // The frontend no longer reads this relation on a chapter page — it
            // queries the chapter's upcoming events, because a chapter admin
            // cannot edit a relation and creating an event never attached it
            // here. Seeding it correctly anyway: an editor opening this page in
            // /admin should not see another chapter's content listed.
            __component: 'shared.upcoming-events',
            title: 'Upcoming Events',
            link: cta('View All Events', '/events', 'Secondary'),
            events: [chapterEvents[slug].documentId],
          },
          {
            __component: 'shared.social-media-feed',
            title: 'Follow Us',
            platform: 'Instagram',
            feedUrl: `https://instagram.com/areaa-${slug}`,
          },
          /*
            NO shared.video-embed on the chapter template (Mark, 2026-09-18).

            It was seeded as "Chapter Highlights" pointing at
            youtube.com/embed/example-chapter — an id that can never embed, so
            the component correctly refused to frame it and degraded to a bare
            link. Every chapter page therefore carried a heading, the words
            "Watch this video" and a caption, describing a video that did not
            exist. The component and its renderer stay; national can add one to
            a chapter page. Note videoUrl is national-only to edit, so a chapter
            admin could not have supplied the missing video themselves.
          */
          {
            /*
              Seeded with NO photos (Mark, 2026-09-18), which is how a real
              chapter starts. `photos: [img]` attached the 1x1 PLACEHOLDER_PNG
              every other fixture uses, and a gallery cell stretches it into a
              solid pink block — so every chapter's public page carried a Photo
              Gallery heading above one meaningless rectangle.

              Gallery.astro already guards on photos.length > 0, so an empty one
              renders nothing publicly. It stays in the zone because the chapter
              admin's editing screen still needs to offer it.
            */
            __component: 'shared.gallery',
            title: 'Photo Gallery',
            photos: [],
          },
          {
            __component: 'shared.section',
            title: 'Membership Benefits',
            body: [
              p(
                'With over 17,000 members in 45 chapters across the US and Canada, ' +
                  'AREAA is the largest Asian American and Pacific Islander (AAPI) ' +
                  'trade organization in North America. As a member, you will receive ' +
                  'discounted pricing to all AREAA events, FREE webinar training to ' +
                  'help fine-tune your skill sets, and be kept informed on news and ' +
                  'issues within the AAPI communities.'
              ),
            ],
            secondaryCta: cta('View Membership Benefits', '/membership', 'Secondary'),
          },
          {
            __component: 'shared.contact-form',
            title: 'Contact Us',
            intro:
              `${president ? president.displayName : 'Chapter President'}, ` +
              `Chapter President\n${chapter.email}`,
            submitLabel: 'Get in Touch',
            fields: [
              { label: 'First Name', name: 'firstName', type: 'text', required: true },
              { label: 'Last Name', name: 'lastName', type: 'text', required: true },
              { label: 'Email', name: 'email', type: 'email', required: true },
              { label: 'Message', name: 'message', type: 'textarea', required: true },
            ],
          },
          {
            __component: 'shared.member-group',
            title: 'Executive Committee',
            members: chapterMembers,
          },
          {
            __component: 'shared.member-group',
            title: 'Board of Directors',
            members: chapterMembers,
          },
          {
            __component: 'shared.member-group',
            title: 'Committee Chair',
            members: chapterMembers,
          },
          {
            __component: 'shared.partner-group',
            title: 'Sponsors',
            partners: chapterPartners,
          },
        ],
      },
      ...pub,
    });
  }

  // --- single types ---------------------------------------------------------
  const navigation = {
    items: [
      {
        label: 'About Us',
        url: '/about',
        children: [
          { label: 'Delegate Board', url: '/about/delegate-board' },
          { label: 'Executive Board', url: '/about/executive-board' },
          { label: 'FAQ', url: '/faq' },
          { label: 'Contact Us', url: '/contact' },
        ],
      },
      // Top-level link, no submenu — /membership redirects to /join (see
      // astro.config redirects). Membership == Join AREAA in the IA.
      { label: 'Membership', url: '/membership' },
      { label: 'Advocacy', url: '/advocacy' },
      // Chapters renders as a search dropdown in the header (lists chapters
      // from Strapi). The url is the fallback landing page.
      { label: 'Chapters', url: '/chapters' },
      { label: 'Events', url: '/events' },
      {
        label: 'Programs',
        url: '/programs',
        children: [
          // Programs is a nav *grouping* only — each program page is served at a
          // flat root slug (/a-list, not /programs/a-list) via the frontend
          // catch-all. Deliberate IA call by the CMS team.
          { label: 'A List', url: '/a-list' },
          { label: '10 X 30', url: '/10x30' },
          { label: 'Mentorship Program', url: '/mentorship' },
          { label: 'Webinar', url: '/webinar' },
        ],
      },
      {
        label: 'Media',
        url: '/media',
        children: [
          { label: 'State of Asia America', url: '/media/state-of-asia-america' },
          { label: 'ARE Publications', url: '/media/are-publications' },
          { label: 'Press Releases', url: '/media/press-releases' },
        ],
      },
    ],
  };

  await putSingle('api::global.global').update({
    data: {
      siteName: 'AREAA',
      siteDescription: 'The Asian Real Estate Association of America.',
      favicon: img,
      defaultSocialImage: img,
      contactEmail: 'contact@areaa.org',
    },
  });

  await putSingle('api::top-nav.top-nav').update({
    data: {
      logo: img,
      phoneNumber: '(619) 795-7873',
      emailAddress: 'contact@areaa.org',
      navigation,
    },
  });

  await putSingle('api::footer.footer').update({
    data: {
      navigation,
      copyright: 'Copyright 2026 AREAA. All Rights Reserved.',
      socialLinks: [
        { platform: 'Facebook', url: 'https://facebook.com/areaa' },
        { platform: 'Instagram', url: 'https://instagram.com/areaa' },
        { platform: 'LinkedIn', url: 'https://linkedin.com/company/areaa' },
        { platform: 'X', url: 'https://x.com/areaa' },
        { platform: 'YouTube', url: 'https://youtube.com/@areaa' },
      ],
    },
  });

  // --- public read permissions ----------------------------------------------
  // Grant the Public (unauthenticated) role read access so the SSR frontend can
  // fetch content without an API token. Idempotent — skips already-enabled
  // actions, so re-running the seed is safe.
  const publicRole = await app.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  // Collection types: allow both list (find) and detail (findOne).
  const collectionReads = [
    'api::chapter.chapter',
    'api::page.page',
    'api::event.event',
    'api::partner.partner',
    // The microsite populates `partner.tier` through the page endpoint to group
    // and label sponsors, and a populated relation needs its own public find —
    // the same trap `member-group.members` documents. Without it every sponsor
    // renders untiered, with no error anywhere.
    'api::partner-tier.partner-tier',
    'api::committee.committee',
    'api::news-item.news-item',
    'api::resource.resource',
    'api::faq.faq',
  ];
  // Single types: only `find`. NOTE: form-submission is intentionally omitted —
  // the frontend writes submissions server-to-server with an API token, not via
  // the public role.
  const singleTypeReads = ['api::global.global', 'api::top-nav.top-nav', 'api::footer.footer'];

  // member-group.members targets plugin::users-permissions.user. Strapi strips
  // relations to the protected user type unless the role can read it, so the
  // member grids come back EMPTY without this `find`.
  //
  // ⚠️ This opens GET /api/users to the public. The page-level populate restricts
  // fields per request, but the raw users endpoint does not. Production hardening
  // (colleague's domain): mark sensitive User fields (email, status, bio,
  // duesPaidThrough) `"private": true` in the user content-type schema, and/or
  // populate members via a custom page controller instead of opening /api/users.
  const userReads = ['plugin::users-permissions.user.find'];

  const readActions = [
    ...collectionReads.flatMap((uid) => [`${uid}.find`, `${uid}.findOne`]),
    ...singleTypeReads.map((uid) => `${uid}.find`),
    ...userReads,
  ];

  let grantedCount = 0;
  for (const action of readActions) {
    const existing = await app.db
      .query('plugin::users-permissions.permission')
      .findOne({ where: { action, role: publicRole.id } });
    if (!existing) {
      await app.db
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: publicRole.id } });
      grantedCount += 1;
    }
  }

  console.log(
    `Public role: ${readActions.length} read actions ensured ` +
      `(${grantedCount} newly granted).`
  );

  // The capability that matches the role, so a freshly seeded chapter admin
  // works on THIS boot rather than on the next one. bootstrap() runs the same
  // backfill, but it ran before these users existed. Idempotent either way.
  const linked = await backfillCapabilities(app);
  console.log(
    `Chapter admin: mei.tanaka@areaa.example (aloha-hawaii), ` +
      `${linked} capability link(s) added.`
  );

  console.log(
    `Seeded: ${chapterData.length} chapters, ${members.length} members, ` +
      `${delegates.length} delegates, ${officers.length} officers, ` +
      `${partners.length} partners, ` +
      `${committeeData.length + 2} committees, ` +
      `${nationalEvents.length + chapterData.length} events, ${resources.length} resources, ` +
      `${newsItems.length} news items, ${faqData.length} FAQs, ` +
      `${4 + chapterData.length} pages, 3 single types.`
  );

  await app.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
