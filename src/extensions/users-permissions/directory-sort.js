'use strict';

/**
 * Sorting the member directory by location, with blanks LAST.
 *
 * `location:asc` orders '' and NULL ahead of every real value, so "sort by
 * location" opened with every member who never filled the field in — the least
 * useful rows first, and the ones a member scrolling for a city cares about
 * pushed off page one. It was logged as a known gap when the sort control
 * shipped (4G Phase A) and deferred to here.
 *
 * Strapi's document service cannot express NULLS LAST, so the ordering is
 * expressed as two partitions read in sequence: located members ordered by
 * location, then unlocated members ordered by name. The alternative — sorting
 * in JS after the fetch — would only order the current page, which is not the
 * same thing and silently breaks at the page boundary.
 */

/** Members with a usable location. NULL and '' are both "no location". */
const HAS_LOCATION = {
  $and: [{ location: { $notNull: true } }, { location: { $ne: '' } }],
};

/** Members without one. The complement of HAS_LOCATION, stated explicitly. */
const NO_LOCATION = {
  $or: [{ location: { $null: true } }, { location: { $eq: '' } }],
};

/** Located members: by location, then name so ties page deterministically. */
const LOCATED_SORT = ['location:asc', 'lastName:asc', 'firstName:asc'];

/** Unlocated members: name order is the only meaningful one left. */
const UNLOCATED_SORT = ['lastName:asc', 'firstName:asc'];

/**
 * How to fill one page from the two partitions. Pure.
 *
 * The page window [start, start + pageSize) is laid over the located rows
 * first and the unlocated rows after, so a page straddling the boundary draws
 * from both — which is the case that a naive "query one or the other" gets
 * wrong, dropping or duplicating rows exactly where the two meet.
 *
 * Returns a `{ start, limit }` pair per partition; a `limit` of 0 means that
 * partition contributes nothing to this page and need not be queried.
 */
function locationPageWindow(start, pageSize, locatedTotal) {
  const located = { start: 0, limit: 0 };
  const unlocated = { start: 0, limit: 0 };

  if (start < locatedTotal) {
    located.start = start;
    located.limit = Math.min(pageSize, locatedTotal - start);
  }

  const remaining = pageSize - located.limit;
  if (remaining > 0) {
    // Past the located rows, the offset restarts from the top of the unlocated
    // ones. Clamped at 0 for the straddling page, where `start` is still inside
    // the located partition and the unlocated one begins at its first row.
    unlocated.start = Math.max(0, start - locatedTotal);
    unlocated.limit = remaining;
  }

  return { located, unlocated };
}

module.exports = {
  HAS_LOCATION,
  NO_LOCATION,
  LOCATED_SORT,
  UNLOCATED_SORT,
  locationPageWindow,
};
