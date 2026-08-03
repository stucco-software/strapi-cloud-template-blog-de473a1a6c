'use strict';

const { pickWhitelisted } = require('./fields');
const { assertChapterScope, resolveAdministeredChapters } = require('./scope');
const { buildSlug, nextAvailableSlug, SlugError } = require('./slug');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Build the CRUD handler set for a content type owned by a chapter.
 *
 * All chapter identity is `documentId`, never the numeric entry id — `chapter`
 * is draft-and-publish, so each chapter is two rows with different ids sharing
 * one documentId, and an entry-id comparison rejects every legitimate request.
 *
 * @param {string}   uid            e.g. 'api::event.event'
 * @param {string[]} editableFields whitelist; MUST NOT contain 'chapter' or 'slug'
 * @param {boolean}  hasSlug        generate a chapter-prefixed slug on create
 * @param {object}   strapiInstance injected for testability
 */
function chapterScopedResource({
  uid, editableFields, hasSlug = false, listFields = null, strapiInstance = null,
}) {
  if (editableFields.includes('chapter') || editableFields.includes('slug')) {
    // A misconfiguration here silently reopens chapter reassignment. Fail at load.
    throw new Error(`${uid}: 'chapter' and 'slug' must never be editable`);
  }

  const s = () => strapiInstance || global.strapi;
  const docs = () => s().documents(uid);

  /** Read the owning chapter documentId off a STORED record — never the payload. */
  async function ownerChapter(documentId) {
    const record = await docs().findOne({
      documentId,
      populate: { chapter: { fields: ['slug'] } },
      status: 'draft', // the draft row always exists; the published one may not
    });
    return { record, chapterDocumentId: record?.chapter?.documentId ?? null };
  }

  async function takenSlugs(prefix) {
    const rows = await docs().findMany({
      filters: { slug: { $startsWith: prefix } },
      fields: ['slug'],
      limit: -1,
      status: 'draft',
    });
    return rows.map((r) => r.slug).filter(Boolean);
  }

  return {
    async list(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      if (administered.length === 0) return ctx.forbidden('No administered chapters');

      const page = Math.max(1, parseInt(ctx.query.page, 10) || 1);
      const pageSize = Math.min(MAX_PAGE_SIZE,
        Math.max(1, parseInt(ctx.query.pageSize, 10) || DEFAULT_PAGE_SIZE));

      const filters = { chapter: { documentId: { $in: administered } } };
      const [rows, total] = await Promise.all([
        docs().findMany({
          filters,
          ...(listFields ? { fields: listFields } : {}),
          populate: { chapter: { fields: ['name', 'slug'] } },
          sort: ['updatedAt:desc'],
          limit: pageSize,
          start: (page - 1) * pageSize,
          status: 'draft',
        }),
        // status passed explicitly: it must match the findMany above or
        // pageCount silently disagrees with the rows returned.
        docs().count({ filters, status: 'draft' }),
      ]);

      ctx.body = {
        data: rows,
        meta: { pagination: { page, pageSize, total,
          pageCount: Math.max(1, Math.ceil(total / pageSize)) } },
      };
    },

    async create(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const input = ctx.request.body?.data ?? ctx.request.body ?? {};

      // The payload identifies the chapter by SLUG. The frontend never has an
      // id: AccountMember.administeredChapters carries {name, slug} and the
      // route is /account/chapter/[chapterSlug]/…
      const chapterSlug = input.chapterSlug;
      if (!chapterSlug) return ctx.badRequest('chapterSlug is required');

      const chapter = await s().documents('api::chapter.chapter').findFirst({
        filters: { slug: chapterSlug },
        fields: ['slug'],
        status: 'draft',
      });
      if (!chapter) return ctx.notFound('No such chapter');

      assertChapterScope(administered, chapter.documentId);

      const data = pickWhitelisted(input, editableFields);
      // Longhand relation form: mapRelation's isNumeric() uses parseInt, so a
      // documentId beginning with a digit could be misread as an entry id.
      data.chapter = { documentId: chapter.documentId };

      if (hasSlug) {
        let desired;
        try {
          desired = buildSlug(chapter.slug, data.title);
        } catch (err) {
          if (err instanceof SlugError) return ctx.badRequest(err.message);
          throw err;
        }
        data.slug = nextAvailableSlug(desired, await takenSlugs(desired));
      }

      // Publish explicitly: these types are draftAndPublish and the documents
      // API writes a DRAFT unless told otherwise. Without this the save succeeds
      // and is invisible on the live site.
      ctx.body = { data: await docs().create({ data, status: 'published' }) };
    },

    async update(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const { documentId } = ctx.params;

      // UPDATE reads the chapter from the STORED RECORD. Any `chapter` in the
      // payload is ignored — it is not on the whitelist — which is what stops an
      // admin pulling another chapter's record into their own scope.
      const { record, chapterDocumentId } = await ownerChapter(documentId);
      if (!record) return ctx.notFound();
      assertChapterScope(administered, chapterDocumentId);

      const input = ctx.request.body?.data ?? ctx.request.body ?? {};
      const data = pickWhitelisted(input, editableFields);

      ctx.body = { data: await docs().update({ documentId, data, status: 'published' }) };
    },

    async delete(ctx) {
      const administered = await resolveAdministeredChapters(ctx, s());
      const { documentId } = ctx.params;

      const { record, chapterDocumentId } = await ownerChapter(documentId);
      if (!record) return ctx.notFound();
      assertChapterScope(administered, chapterDocumentId);

      await docs().delete({ documentId });
      ctx.body = { data: { documentId } };
    },
  };
}

module.exports = { chapterScopedResource };
