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

module.exports = { pickWhitelisted };
