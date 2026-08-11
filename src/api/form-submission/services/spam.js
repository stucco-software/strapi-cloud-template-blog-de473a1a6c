'use strict';

/**
 * Cheap spam resistance with no external dependency.
 *
 * None of this is a strong guarantee. A determined attacker reads the HTML,
 * omits the honeypot, forges the timestamp and rotates IPs. What these do is
 * raise the cost above "point a generic form-spam script at it", which is the
 * traffic a small association site actually gets. reCAPTCHA was considered and
 * deferred: it needs provisioned keys and degrades badly without JavaScript,
 * which every other form in this system survives.
 */

/** Named to look worth filling in. Real users never see it. */
const HONEYPOT_FIELD = 'website';

/** Below this, nobody typed a name, an email and a message. */
const MIN_FILL_MS = 2500;

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function isHoneypotTripped(raw) {
  const v = raw?.[HONEYPOT_FIELD];
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * @param {string|undefined} renderedAt  ms epoch the form was rendered
 * @param {number}           now         ms epoch now
 *
 * Absent or unparseable => NOT too fast. A stale cached page or a stripped
 * field must not cost someone their enquiry; the honeypot and rate limit still
 * apply. A future timestamp is rejected, because that only happens deliberately.
 */
function isTooFast(renderedAt, now) {
  const then = Number(renderedAt);
  if (!Number.isFinite(then) || then <= 0) return false;
  if (then > now) return true;
  return now - then < MIN_FILL_MS;
}

/**
 * Per-IP sliding window, in memory.
 *
 * IN MEMORY IS THE LIMITATION. It resets on restart and is per-process, so a
 * multi-instance deploy gets `limit x instances`. Moving to Redis is the fix
 * when there is more than one instance; until then this is honest and free.
 */
class RateLimiter {
  constructor({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  allow(ip, now) {
    // A missing IP collapses to one shared bucket. The alternative — skipping
    // the check — turns "we could not identify the caller" into "no limit".
    const key = ip || '__unknown__';
    const cutoff = now - this.windowMs;

    for (const [k, times] of this.hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) this.hits.delete(k);
      else this.hits.set(k, live);
    }

    const times = this.hits.get(key) ?? [];
    if (times.length >= this.limit) return false;
    times.push(now);
    this.hits.set(key, times);
    return true;
  }

  size() { return this.hits.size; }

  /** Test affordance. One process-wide limiter means one suite exhausts it. */
  reset() { this.hits.clear(); }
}

/**
 * The one limiter the capture endpoint uses. Exported so a test suite can
 * reset it: every request from supertest shares 127.0.0.1, so without this the
 * fifth test exhausts the window and everything after it 429s.
 */
const captureLimiter = new RateLimiter();

module.exports = {
  isHoneypotTripped, isTooFast, RateLimiter, captureLimiter,
  HONEYPOT_FIELD, MIN_FILL_MS, RATE_LIMIT, RATE_WINDOW_MS,
};
