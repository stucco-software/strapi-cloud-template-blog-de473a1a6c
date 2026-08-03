'use strict';

/**
 * Slug helpers. Pure — the caller supplies the set of already-taken slugs.
 *
 * These carry the entire uniqueness invariant, because there is NO unique index
 * on `slug` in the database (verified: `slug varchar(255) null`). Strapi 5
 * enforces uid uniqueness only in the admin UI, so a duplicate written through
 * the content API is accepted silently and the loser becomes unreachable —
 * `events/[slug].astro` filters by slug and takes `[0]`.
 */

const MAX_SLUG_LENGTH = 80;

// Combining diacritical marks, U+0300–U+036F. Written as escapes deliberately:
// a literal U+0300 immediately after `[` renders as a combining accent on the
// bracket and is silently mangled by editors, copy/paste, or Unicode
// normalization — and the failure is quiet, because accents simply stop being
// stripped and `Café Night` becomes `caf-night`.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

class SlugError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SlugError';
  }
}

function slugify(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/** `boston` + `Spring Gala` -> `boston-spring-gala`. */
function buildSlug(chapterSlug, title) {
  const base = slugify(title);
  if (!base) {
    throw new SlugError(
      'Title must contain at least one letter or number that can be used in a URL'
    );
  }
  const prefix = slugify(chapterSlug);
  return prefix ? `${prefix}-${base}` : base;
}

/** First free variant of `desired`: itself, then -2, -3, … */
function nextAvailableSlug(desired, taken) {
  const used = new Set(taken || []);
  if (!used.has(desired)) return desired;
  let n = 2;
  while (used.has(`${desired}-${n}`)) n += 1;
  return `${desired}-${n}`;
}

module.exports = { slugify, buildSlug, nextAvailableSlug, SlugError, MAX_SLUG_LENGTH };
