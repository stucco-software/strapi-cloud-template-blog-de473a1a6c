import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isHoneypotTripped, isTooFast, RateLimiter, HONEYPOT_FIELD, MIN_FILL_MS,
} = require('../../src/api/form-submission/services/spam.js');

describe('honeypot', () => {
  it('passes when the trap field is absent', () => {
    expect(isHoneypotTripped({})).toBe(false);
  });

  it('passes when the trap field is present but empty', () => {
    // Browsers post empty hidden inputs; that is the NORMAL case, not a bot.
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: '' })).toBe(false);
  });

  it('trips when the trap field is filled', () => {
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: 'http://spam.example' })).toBe(true);
  });

  it('does NOT trip on whitespace alone', () => {
    // A browser or extension padding the field must not cost a real visitor
    // their enquiry; only actual content counts as a bot filling it in.
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: '   ' })).toBe(false);
  });
});

describe('isTooFast', () => {
  const now = 1_700_000_000_000;

  it('accepts a form filled at human speed', () => {
    expect(isTooFast(String(now - 30_000), now)).toBe(false);
  });

  it('rejects one submitted faster than any human could type', () => {
    expect(isTooFast(String(now - 100), now)).toBe(true);
  });

  it('accepts a missing timestamp rather than blocking the submission', () => {
    // A stale cached page, or a browser that stripped the field. Refusing a
    // real enquiry is worse than accepting a possible bot — the honeypot and
    // the rate limit still apply.
    expect(isTooFast(undefined, now)).toBe(false);
  });

  it('accepts a garbage timestamp for the same reason', () => {
    expect(isTooFast('not-a-number', now)).toBe(false);
  });

  it('accepts a very old timestamp — a slow writer is not a bot', () => {
    expect(isTooFast(String(now - 6 * 60 * 60 * 1000), now)).toBe(false);
  });

  it('rejects a timestamp from the future', () => {
    expect(isTooFast(String(now + 60_000), now)).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('allows submissions up to the limit', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    let t = 1000;
    for (let i = 0; i < 3; i += 1) expect(rl.allow('1.2.3.4', t++)).toBe(true);
  });

  it('blocks the one after', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    let t = 1000;
    for (let i = 0; i < 3; i += 1) rl.allow('1.2.3.4', t++);
    expect(rl.allow('1.2.3.4', t)).toBe(false);
  });

  it('keeps buckets per IP', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.allow('1.1.1.1', 1000)).toBe(true);
    expect(rl.allow('2.2.2.2', 1000)).toBe(true);
    expect(rl.allow('1.1.1.1', 1001)).toBe(false);
  });

  it('lets the window slide', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.allow('1.1.1.1', 1000)).toBe(true);
    expect(rl.allow('1.1.1.1', 1500)).toBe(false);
    expect(rl.allow('1.1.1.1', 2100)).toBe(true);
  });

  it('treats a missing IP as one shared bucket rather than skipping the limit', () => {
    // If the IP cannot be read, the safe reading is "everyone is one caller",
    // not "no limit applies".
    const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.allow(undefined, 1000)).toBe(true);
    expect(rl.allow(undefined, 1001)).toBe(false);
  });

  it('evicts stale buckets so the map cannot grow without bound', () => {
    const rl = new RateLimiter({ limit: 5, windowMs: 1000 });
    for (let i = 0; i < 50; i += 1) rl.allow(`10.0.0.${i}`, 1000);
    expect(rl.size()).toBe(50);
    rl.allow('10.1.1.1', 100_000);          // far outside every window
    expect(rl.size()).toBe(1);
  });
});
