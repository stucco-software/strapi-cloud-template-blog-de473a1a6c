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
 *
 * `unscoped` is the National Admin bypass, and it is deliberately narrow: it
 * skips the membership test only. A missing target still throws, because
 * bypassing WHICH chapter is not the same as bypassing WHETHER there is one —
 * a request naming no chapter is malformed no matter who sent it.
 */
function assertChapterScope(
  administeredChapterDocumentIds,
  targetChapterDocumentId,
  { unscoped = false } = {}
) {
  if (!targetChapterDocumentId) {
    throw new ScopeError('No target chapter on this request');
  }
  if (unscoped) return true;
  const allowed = (administeredChapterDocumentIds || []).map(String);
  if (!allowed.includes(String(targetChapterDocumentId))) {
    throw new ScopeError('Chapter not administered by this user');
  }
  return true;
}

/**
 * The committee half of the same invariant.
 *
 * Committee Leader is scoped PER COMMITTEE, not per chapter, so this reads
 * `ledCommittees` and never derives authority from the committee's chapter.
 *
 * Same rules throughout: documentIds only, missing target throws, `unscoped`
 * skips only the membership test.
 *
 * The near-duplication with assertChapterScope is deliberate. Folding them into
 * one parameterised function saves nine lines and costs the thing that makes
 * them readable: each states its own invariant in its own words, and each is
 * the first thing someone reads when auditing "can a leader reach another
 * chapter's committee?" Two short, obvious functions beat one clever one at a
 * security boundary.
 */
function assertCommitteeScope(
  ledCommitteeDocumentIds,
  targetCommitteeDocumentId,
  { unscoped = false } = {}
) {
  if (!targetCommitteeDocumentId) {
    throw new ScopeError('No target committee on this request');
  }
  if (unscoped) return true;
  const allowed = (ledCommitteeDocumentIds || []).map(String);
  if (!allowed.includes(String(targetCommitteeDocumentId))) {
    throw new ScopeError('Committee not led by this user');
  }
  return true;
}

/**
 * Everything this request's user is allowed to be, in one query.
 *
 * `ctx.state.user` arrives without relations, so this costs one round trip,
 * memoized on the context. Capabilities, chapter scope and committee scope all
 * live on the same row; fetching them separately would be three queries for one
 * read. `strapiInstance` is injected so this is testable without a boot;
 * production callers pass the global.
 */
async function resolveAuthority(ctx, strapiInstance = global.strapi) {
  if (ctx.state.authority) return ctx.state.authority;

  const user = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findOne({
      documentId: ctx.state.user.documentId,
      populate: {
        capabilities: { fields: ['slug'] },
        administeredChapters: { fields: ['slug'] },
        ledCommittees: { fields: ['name'] },
      },
    });

  const authority = {
    capabilities: new Set((user?.capabilities ?? []).map((c) => c.slug)),
    chapters: (user?.administeredChapters ?? []).map((c) => c.documentId),
    committees: (user?.ledCommittees ?? []).map((c) => c.documentId),
  };

  ctx.state.authority = authority;
  // Kept in step so resolveAdministeredChapters' own memo never diverges.
  ctx.state.administeredChapterIds = authority.chapters;
  return authority;
}

/**
 * The chapter half of resolveAuthority, under the name every existing caller
 * already uses. Shares the same memo, so this costs no extra query.
 */
async function resolveAdministeredChapters(ctx, strapiInstance = global.strapi) {
  if (ctx.state.administeredChapterIds) return ctx.state.administeredChapterIds;
  const { chapters } = await resolveAuthority(ctx, strapiInstance);
  return chapters;
}

module.exports = {
  assertChapterScope, assertCommitteeScope, ScopeError,
  resolveAdministeredChapters, resolveAuthority,
};
