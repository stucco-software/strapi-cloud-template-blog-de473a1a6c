'use strict';

// ScopeError by direct require, never via strapi.service(...). Strapi's
// loadFiles deletes the require cache per file, so a service-registry lookup
// can hand back a DIFFERENT class object and `instanceof` silently fails —
// which would turn every 403 into a 500. Same reason as
// controllers/chapter-admin.js:3.
const { ScopeError } = require('./scope');

/**
 * The seeded capabilities. Mirrors src/api/member-capability/seed.js, and
 * tests/unit/capabilities.test.js asserts the two lists agree.
 */
const CAPABILITY_SLUGS = ['national_admin', 'committee_leader', 'chapter_admin'];

/**
 * Capabilities that stand in for others. DECLARED, not buried in a conditional,
 * so "what does National Admin actually let me do" is answerable by reading one
 * object.
 *
 * National Admin implies Chapter Admin because unscoped authority over every
 * chapter is a superset of authority over some of them. The alternative —
 * requiring both to be assigned by hand — is one data-entry slip away from the
 * bug this codebase already shipped once: a member with the scope link and the
 * wrong role passed every frontend guard and then got 403 from every API call
 * behind it, showing six panels each blaming something different.
 */
const IMPLIES = { national_admin: ['chapter_admin'] };

/**
 * The held slugs plus everything they imply. One level deep, deliberately: a
 * transitive closure would make the implication graph something you have to
 * simulate to read, and two levels have no use case here.
 */
function heldWithImplied(heldSlugs) {
  const out = new Set();
  for (const slug of heldSlugs ?? []) {
    out.add(slug);
    for (const implied of IMPLIES[slug] ?? []) out.add(implied);
  }
  return out;
}

/**
 * The capability half of the authorization rule. Pure.
 *
 * Throws unless `requiredSlug` is held, directly or by implication. A missing
 * `requiredSlug` throws rather than passing: a handler wired without a declared
 * capability must be unreachable, not unguarded. Failing closed matters more
 * here than a helpful error.
 *
 * Accepts an array or a Set — resolveAuthority hands back a Set.
 */
function assertCapability(heldSlugs, requiredSlug) {
  if (!requiredSlug) {
    throw new ScopeError('No capability declared for this route');
  }
  if (!heldWithImplied(heldSlugs).has(requiredSlug)) {
    throw new ScopeError('Capability not held by this user');
  }
  return true;
}

module.exports = { CAPABILITY_SLUGS, IMPLIES, assertCapability, heldWithImplied };
