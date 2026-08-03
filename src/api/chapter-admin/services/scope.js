'use strict';

class ScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeError';
  }
}

/**
 * The core invariant of the whole design.
 *
 * Pure. Throws unless `targetChapterDocumentId` is one of
 * `administeredChapterDocumentIds`. A missing target throws rather than passing
 * — failing closed matters more here than a helpful error.
 *
 * These are `documentId` strings, NEVER numeric entry ids. `chapter` is
 * draft-and-publish, so every chapter is two rows with different ids sharing one
 * documentId; comparing entry ids rejects every legitimate request while looking
 * like a working check.
 */
function assertChapterScope(administeredChapterDocumentIds, targetChapterDocumentId) {
  if (!targetChapterDocumentId) {
    throw new ScopeError('No target chapter on this request');
  }
  const allowed = (administeredChapterDocumentIds || []).map(String);
  if (!allowed.includes(String(targetChapterDocumentId))) {
    throw new ScopeError('Chapter not administered by this user');
  }
  return true;
}

/**
 * Load the documentIds of the chapters this request's user administers.
 *
 * `ctx.state.user` arrives without relations, so this costs one query, memoized
 * on the context. `strapiInstance` is injected so this is testable without a
 * boot; production callers pass the global.
 */
async function resolveAdministeredChapters(ctx, strapiInstance = global.strapi) {
  if (ctx.state.administeredChapterIds) return ctx.state.administeredChapterIds;

  const user = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findOne({
      documentId: ctx.state.user.documentId,
      populate: { administeredChapters: { fields: ['slug'] } },
    });

  const ids = (user?.administeredChapters ?? []).map((c) => c.documentId);
  ctx.state.administeredChapterIds = ids;
  return ids;
}

module.exports = { assertChapterScope, ScopeError, resolveAdministeredChapters };
