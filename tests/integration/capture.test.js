import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown } from './helpers.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { captureLimiter } = require('../../src/api/form-submission/services/spam.js');

const RUN = Date.now();
let strapi, chapterPage, chapterSlug;

// Old enough to clear MIN_FILL_MS on every request.
const human = () => String(Date.now() - 30_000);

beforeAll(async () => {
  strapi = await boot();

  // A REAL published chapter home page carrying a contact-form component.
  // Asserted, not skipped: cmp_ids 25-30 sit on three chapter home pages, and
  // if that stops being true this suite must fail loudly rather than pass.
  const pages = await strapi.documents('api::page.page').findMany({
    filters: { slug: 'home' },
    populate: {
      chapter: { fields: ['slug'] },
      components: { on: { 'shared.contact-form': { populate: { fields: true } } } },
    },
    status: 'published', limit: -1,
  });
  chapterPage = pages.find((p) =>
    p.chapter && (p.components ?? []).some((c) => c.__component === 'shared.contact-form'));
  expect(chapterPage).toBeTruthy();
  chapterSlug = chapterPage.chapter.slug;
});

afterAll(async () => {
  try {
    const junk = await strapi.documents('api::form-submission.form-submission')
      .findMany({ limit: -1 });
    for (const r of junk) {
      const blob = JSON.stringify(r.data ?? {});
      if (blob.includes(String(RUN))) {
        await strapi.documents('api::form-submission.form-submission')
          .delete({ documentId: r.documentId });
      }
    }
  } finally {
    await shutdown();
  }
});

// Every supertest request shares 127.0.0.1, so one shared window means the
// fifth test exhausts it and everything after 429s. Reset per test; the flood
// test drives the limiter deliberately.
beforeEach(() => captureLimiter.reset());

const api = () => request(strapi.server.httpServer);
const post = (body) => api().post('/api/form-submissions/capture').send(body);
const tag = (n) => `${n} ${RUN}`;

const nationalValues = () => ({
  firstName: tag('Jane'), lastName: 'Doe', email: 'jane@example.com', message: tag('Hello'),
});

const findMine = async (needle) => {
  const all = await strapi.documents('api::form-submission.form-submission')
    .findMany({ populate: { chapter: { fields: ['slug'] }, page: { fields: ['slug'] } }, limit: -1 });
  return all.find((r) => JSON.stringify(r.data ?? {}).includes(needle));
};

describe('POST /api/form-submissions/capture', () => {
  it('accepts a national submission with NO authentication', async () => {
    // The entire point: the public can reach this. Every other write endpoint
    // in this system 401s without a JWT.
    const res = await post({ renderedAt: human(), values: nationalValues() });
    expect(res.status).toBe(200);
    expect(res.body.data.received).toBe(true);
  });

  it('actually writes a row — the bug this plan exists to fix', async () => {
    const message = tag('Persisted');
    await post({ renderedAt: human(), values: { ...nationalValues(), message } });
    const row = await findMine(message);
    expect(row).toBeTruthy();
    expect(row.data.message).toBe(message);
    expect(row.handled).toBe(false);
    expect(row.submittedAt).toBeTruthy();
  });

  it('derives the chapter from the page, so the chapter admin screen can see it', async () => {
    const message = tag('ChapterScoped');
    const res = await post({
      renderedAt: human(), pageDocumentId: chapterPage.documentId,
      // The chapter form configures firstName, lastName, email and message —
      // ALL required. Omitting lastName is a correct 400, not a bug.
      values: { firstName: tag('Ivy'), lastName: 'Chen', email: 'ivy@example.com', message },
    });
    expect(res.status).toBe(200);
    const row = await findMine(message);
    expect(row.chapter?.slug).toBe(chapterSlug);
    expect(row.page).toBeTruthy();
  });

  it('IGNORES a client-supplied chapter and handled flag', async () => {
    // The reason this is not the core `create`. A spammer marking their own
    // submission handled would hide it from the screen meant to surface it.
    const message = tag('Smuggle');
    await post({
      renderedAt: human(),
      values: { ...nationalValues(), message, handled: true, chapter: 'boston' },
    });
    const row = await findMine(message);
    expect(row.handled).toBe(false);
    expect(row.chapter).toBeFalsy();
    expect(row.data).not.toHaveProperty('handled');
  });

  it('400s a missing required field', async () => {
    const res = await post({
      renderedAt: human(), values: { firstName: 'Jane', email: 'j@example.com' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/required/i);
  });

  it('400s an email that is not an email', async () => {
    const res = await post({
      renderedAt: human(), values: { ...nationalValues(), email: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('404s a page documentId that does not exist', async () => {
    const res = await post({
      renderedAt: human(), pageDocumentId: 'nosuchpage000000000000',
      values: nationalValues(),
    });
    expect(res.status).toBe(404);
  });

  it('404s a real page that carries no contact form', async () => {
    // Stops a caller attributing an enquiry to any chapter they like by naming
    // one of that chapter's other pages.
    const pages = await strapi.documents('api::page.page').findMany({
      filters: { slug: { $ne: 'home' } }, populate: { components: true },
      status: 'published', limit: -1,
    });
    const noForm = pages.find((p) =>
      !(p.components ?? []).some((c) => c.__component === 'shared.contact-form'));
    expect(noForm).toBeTruthy();
    const res = await post({
      renderedAt: human(), pageDocumentId: noForm.documentId, values: nationalValues(),
    });
    expect(res.status).toBe(404);
  });

  it('swallows a honeypot hit with a 200 and writes nothing', async () => {
    const message = tag('Honeypot');
    const res = await post({
      renderedAt: human(), website: 'http://spam.example',
      values: { ...nationalValues(), message },
    });
    expect(res.status).toBe(200);          // a bot learns nothing
    expect(await findMine(message)).toBeFalsy();
  });

  it('swallows an instant submission with a 200 and writes nothing', async () => {
    const message = tag('TooFast');
    const res = await post({
      renderedAt: String(Date.now()), values: { ...nationalValues(), message },
    });
    expect(res.status).toBe(200);
    expect(await findMine(message)).toBeFalsy();
  });

  it('still accepts a submission whose timestamp is missing entirely', async () => {
    // A stale cached page must not cost someone their enquiry.
    const message = tag('NoTimestamp');
    const res = await post({ values: { ...nationalValues(), message } });
    expect(res.status).toBe(200);
    expect(await findMine(message)).toBeTruthy();
  });

  it('429s once the per-IP window is full', async () => {
    // RATE_LIMIT is 5; this suite has already spent some of the window, so
    // drive it deliberately rather than assuming a starting count.
    let sawLimit = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await post({
        renderedAt: human(), values: { ...nationalValues(), message: tag(`Flood${i}`) },
      });
      if (res.status === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });

  it('never exposes captured submissions to the public', async () => {
    // The grant is `capture` alone. `find` would publish every enquiry the
    // association has ever received.
    expect((await api().get('/api/form-submissions')).status).toBe(403);
  });
});
