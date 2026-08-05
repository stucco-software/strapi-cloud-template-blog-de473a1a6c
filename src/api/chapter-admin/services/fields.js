'use strict';

/**
 * Keep only whitelisted keys from an input object, trimming string values.
 *
 * Pure. Anything not on the list is silently dropped, which makes this the
 * enforcement point for "a chapter admin may not write `chapter`, `role`, or
 * `status`". Fields absent from the input are omitted rather than blanked, so a
 * partial payload cannot erase data.
 */
function pickWhitelisted(input, allowedFields) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const field of allowedFields) {
    if (!(field in input)) continue;
    const value = input[field];
    out[field] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/**
 * A client-input problem that should surface as 400, not 500.
 *
 * Exists because `validateData` hooks need to reject malformed payloads —
 * `members: 'x'` instead of `members: ['x']` — and the only 400-shaped error
 * available was SlugError, which is about slugs. The controller's `guarded`
 * wrapper maps this to ctx.badRequest.
 */
class BadInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadInputError';
  }
}

module.exports = { pickWhitelisted, BadInputError };
