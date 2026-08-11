'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { BadInputError } = require('../../chapter-admin/services/fields');
const { shapeSubmission, NATIONAL_FIELDS } = require('../services/capture');
const { isHoneypotTripped, isTooFast, RateLimiter } = require('../services/spam');

// One limiter for the process lifetime. See the class comment for why in-memory
// is a real limitation rather than a shortcut.
const limiter = new RateLimiter();

/**
 * Resolve the form's field configuration AND its owning chapter from the page.
 *
 * The client sends a page documentId, never a chapter. That is the whole point:
 * the chapter is derived from the page's own relation, so a caller cannot file
 * an enquiry against a chapter of their choosing. Requiring the page to
 * actually carry a contact-form component closes the remaining gap — a random
 * page documentId resolves to no form and is refused.
 */
async function resolveForm(strapiInstance, pageDocumentId) {
  if (!pageDocumentId) {
    // The national /contact form. No page, no chapter, fixed field set.
    return { fields: NATIONAL_FIELDS, chapterDocumentId: null, pageDocumentId: null };
  }

  const page = await strapiInstance.documents('api::page.page').findOne({
    documentId: pageDocumentId,
    populate: { chapter: { fields: ['slug'] }, components: { populate: { fields: true } } },
    status: 'published',   // only a LIVE page can receive a submission
  });
  if (!page) return { error: 'no-such-page' };

  const form = (page.components ?? []).find((c) => c.__component === 'shared.contact-form');
  if (!form) return { error: 'no-contact-form' };

  return {
    fields: form.fields ?? [],
    chapterDocumentId: page.chapter?.documentId ?? null,
    pageDocumentId: page.documentId,
  };
}

module.exports = createCoreController('api::form-submission.form-submission', ({ strapi }) => ({
  async capture(ctx) {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const now = Date.now();

    // Honeypot and timing both return 200 with no record written. Telling a bot
    // WHY it failed is free tuning information; a human never reaches here.
    if (isHoneypotTripped(input) || isTooFast(input.renderedAt, now)) {
      ctx.body = { data: { received: true } };
      return;
    }

    const ip = ctx.request.ip;
    if (!limiter.allow(ip, now)) {
      ctx.status = 429;
      ctx.body = { error: { message: 'Too many messages. Please try again shortly.' } };
      return;
    }

    const resolved = await resolveForm(strapi, input.pageDocumentId);
    if (resolved.error) return ctx.notFound('That form is no longer available');

    let data;
    try {
      data = shapeSubmission(input.values ?? {}, resolved.fields);
    } catch (err) {
      if (err instanceof BadInputError) return ctx.badRequest(err.message);
      throw err;
    }

    // A form configured with zero renderable fields would store {} forever.
    if (Object.keys(data).length === 0) {
      return ctx.badRequest('That form has no fields to submit');
    }

    const record = await strapi.documents('api::form-submission.form-submission').create({
      data: {
        data,
        submittedAt: new Date(now).toISOString(),
        handled: false,          // set here, never from the payload
        ...(resolved.chapterDocumentId
          ? { chapter: { documentId: resolved.chapterDocumentId } } : {}),
        ...(resolved.pageDocumentId
          ? { page: { documentId: resolved.pageDocumentId } } : {}),
      },
    });

    // Deliberately thin: the caller is the public, and a submission id is not
    // theirs to have.
    ctx.body = { data: { received: true } };
    strapi.log.info(`form-submission captured ${record.documentId}`);
  },
}));
