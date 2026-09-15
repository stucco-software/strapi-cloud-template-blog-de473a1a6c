'use strict';

const { ScopeError } = require('./scope');
const { BadInputError } = require('./fields');

/**
 * Exactly what a chapter admin may see about one of their members.
 *
 * Hand-built rather than sanitized, following `plugin.controllers.user.directory`:
 * a whitelist cannot leak a field somebody later forgets to mark `private`, and
 * it does not depend on the caller's role holding a read grant. `documentId` is
 * included — unlike the public directory row — because the picker must submit
 * something.
 */
const MEMBER_FIELDS = ['documentId', 'displayName', 'title'];

function toDirectoryRow(user) {
  return {
    documentId: user.documentId,
    displayName:
      user.displayName || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    title: user.title ?? '',
  };
}

/**
 * The roster row: what a chapter admin may see about their own members.
 *
 * A SECOND whitelist, deliberately not a widening of MEMBER_FIELDS. That list
 * feeds the committee picker, and a picker response has no business carrying
 * membership status around the app just because one screen needs it.
 *
 * `status` is the one `private: true` field here, and it is in scope by an
 * explicit ruling (J1, 2026-08-11): the client asked to see who is current and
 * who has lapsed, which is the whole point of a roster. Every other private
 * field is OUT and stays out — no email, phone, postalCode, duesPaidThrough or
 * autoRenew. Dues dates especially: "Active" answers the question a chapter
 * admin has, and a payment date is the finance module's business.
 */
const ROSTER_FIELDS = [
  'documentId', 'firstName', 'lastName', 'displayName', 'title',
  'company', 'location', 'languages', 'designations', 'status',
];

function toRosterRow(user) {
  return {
    documentId: user.documentId,
    displayName:
      user.displayName || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
    title: user.title ?? '',
    company: user.company ?? '',
    location: user.location ?? '',
    languages: user.languages ?? '',
    designations: user.designations ?? '',
    // May be null on a member who predates the field; the UI says "Unknown"
    // rather than implying they are inactive.
    status: user.status ?? null,
    image: user.image?.url ?? null,
  };
}

/**
 * Whatever the form sent -> a de-duplicated list of id strings.
 *
 * Accepts `['id']` or `[{documentId}]` so the caller is not coupled to how the
 * form serialised it, and throws BadInputError (=> 400) on anything else.
 * Strict about entry shape on purpose: a permissive version silently produced
 * `undefined` for unexpected entries, which then either bypassed the membership
 * check or reached Knex as `whereIn(..., [undefined])`.
 */
function normaliseMemberIds(raw) {
  if (raw === undefined) return [];
  // `null` is NOT treated as "absent". The committee hook guards on
  // `'members' in data`, which is true for null, and Strapi accepts
  // `members: null` as "clear" — so returning [] here would wipe the whole
  // roster on a stray null while `members: 'x'` correctly 400s.
  if (raw === null) {
    throw new BadInputError('members must be a list, or omitted entirely');
  }
  if (!Array.isArray(raw)) {
    throw new BadInputError('members must be a list');
  }
  const ids = raw.map((entry) => {
    const id = typeof entry === 'string' ? entry : entry?.documentId;
    if (typeof id !== 'string' || id === '') {
      throw new BadInputError('every member must be identified by a documentId');
    }
    return id;
  });
  return [...new Set(ids)];
}

/**
 * Every submitted member must actually belong to the chapter.
 *
 * A security boundary, not validation for the user's benefit. Without it
 * `PUT /committees/:id` with an arbitrary user documentId attaches any member of
 * any chapter — or a national board member — to a committee, and the public
 * microsite then displays them as part of that chapter.
 */
async function assertMembersInChapter(strapiInstance, chapterDocumentId, memberDocumentIds) {
  const wanted = normaliseMemberIds(memberDocumentIds);
  if (wanted.length === 0) return true;

  const rows = await strapiInstance
    .documents('plugin::users-permissions.user')
    .findMany({
      filters: {
        documentId: { $in: wanted },
        chapter: { documentId: chapterDocumentId },
        // A blocked member is not listed by the picker; without this they could
        // still be attached by a hand-crafted request.
        blocked: { $ne: true },
      },
      // `fields` always unions `id` and `documentId` regardless of what is asked
      // for (verified in plan 1), so documentId comes back here even though it
      // is not listed. Do not "fix" this by adding it.
      fields: ['id'],
      limit: -1,
    });

  const found = new Set(rows.map((r) => r.documentId));
  // `!== undefined`, NOT a truthiness test: `find` returning '' is a real miss.
  const stranger = wanted.find((id) => !found.has(id));
  if (stranger !== undefined) {
    throw new ScopeError('One or more selected members do not belong to this chapter');
  }
  return true;
}

/**
 * Member documentIds -> the numeric row ids a component relation needs, IN THE
 * SUBMITTED ORDER.
 *
 * The documents API takes `{documentId}`, but a component's relation is written
 * through `db.query`, which takes entity ids. `findMany` does not promise the
 * order it was asked in, and the order is the display order of the roster on
 * the public page, so map back deliberately rather than using what comes out.
 *
 * Call AFTER assertMembersInChapter — this does no scope checking of its own.
 */
async function resolveMemberRowIds(strapiInstance, documentIds) {
  if (documentIds.length === 0) return [];
  const rows = await strapiInstance.documents('plugin::users-permissions.user').findMany({
    filters: { documentId: { $in: documentIds } },
    fields: ['id'],
    limit: -1,
  });
  const byDoc = new Map(rows.map((r) => [r.documentId, r.id]));
  return documentIds.map((d) => byDoc.get(d)).filter((id) => id !== undefined);
}

module.exports = {
  toDirectoryRow, toRosterRow, normaliseMemberIds, assertMembersInChapter,
  resolveMemberRowIds, MEMBER_FIELDS, ROSTER_FIELDS,
};
