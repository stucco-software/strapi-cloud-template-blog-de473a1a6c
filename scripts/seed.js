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

async function main() {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';

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

  const memberData = [
    { first: 'Mei', last: 'Tanaka', chapter: 'aloha-hawaii', status: 'Active', title: 'Chapter President' },
    { first: 'David', last: 'Park', chapter: 'aloha-hawaii', status: 'Active', title: 'Membership Chair' },
    { first: 'Priya', last: 'Nair', chapter: 'greater-chicago', status: 'Active', title: 'Chapter President' },
    { first: 'James', last: 'Wong', chapter: 'greater-chicago', status: 'Lapsed', title: 'Board Member' },
    { first: 'Sofia', last: 'Reyes', chapter: 'boston', status: 'Active', title: 'Chapter President' },
    { first: 'Aaron', last: 'Kim', chapter: 'boston', status: 'Honorary', title: 'Founding Member' },
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
      role: authRole.id,
      firstName: m.first,
      lastName: m.last,
      displayName: `${m.first} ${m.last}`,
      status: m.status,
      title: m.title,
      bio: `${m.first} is a real estate professional active in the ${m.chapter} chapter.`,
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

  // --- back-fill chapter relations -----------------------------------------
  const chapterAssignments = {
    'aloha-hawaii': { partners: [0, 1] },
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
        partners: a.partners.map((i) => partners[i].documentId),
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
      startsAt: '2026-05-09T16:00:00.000Z',
      endsAt: '2026-05-09T21:00:00.000Z',
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
      startsAt: '2026-11-20T19:00:00.000Z',
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

  // A chapter-scoped event apiece, for richer sample data.
  for (const slug of Object.keys(chapters)) {
    await docs('api::event.event').create({
      data: {
        title: `${chapters[slug].name} Summer Mixer`,
        slug: `${slug}-summer-mixer`,
        startsAt: '2026-08-12T01:30:00.000Z',
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
            __component: 'shared.upcoming-events',
            title: 'Upcoming Events',
            link: cta('View All Events', '/events', 'Secondary'),
            events: nationalEvents.map((e) => e.documentId),
          },
          {
            __component: 'shared.social-media-feed',
            title: 'Follow Us',
            platform: 'Instagram',
            feedUrl: `https://instagram.com/areaa-${slug}`,
          },
          {
            __component: 'shared.video-embed',
            title: 'Chapter Highlights',
            videoUrl: 'https://youtube.com/embed/example-chapter',
            caption: 'A look at recent chapter events.',
          },
          {
            __component: 'shared.gallery',
            title: 'Photo Gallery',
            photos: [img],
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

  console.log(
    `Seeded: ${chapterData.length} chapters, ${members.length} members, ` +
      `${delegates.length} delegates, ${officers.length} officers, ` +
      `${partners.length} partners, ` +
      `${committeeData.length + 2} committees, ` +
      `${nationalEvents.length + chapterData.length} events, ${resources.length} resources, ` +
      `${newsItems.length} news items, ${faqData.length} FAQs, ` +
      `${2 + chapterData.length} pages, 3 single types.`
  );

  await app.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
