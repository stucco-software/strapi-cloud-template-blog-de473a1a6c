import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normaliseUrl, MAX_URL_LEN } = require('../../src/api/chapter-admin/services/safe-url.js');

describe('normaliseUrl', () => {
  it('keeps a safe absolute url, normalised', () => {
    expect(normaliseUrl('https://areaa.org/join')).toBe('https://areaa.org/join');
    expect(normaliseUrl('http://x.example')).toBe('http://x.example/');
  });

  it('keeps mailto and tel', () => {
    expect(normaliseUrl('mailto:hawaii@areaa.org')).toBe('mailto:hawaii@areaa.org');
    expect(normaliseUrl('tel:+18005551234')).toBe('tel:+18005551234');
  });

  it('keeps a site-relative link relative', () => {
    // These are the common case: every seeded CTA is one.
    expect(normaliseUrl('/join')).toBe('/join');
    expect(normaliseUrl('/chapters/aloha-hawaii/events')).toBe('/chapters/aloha-hawaii/events');
    expect(normaliseUrl('/events?year=2026')).toBe('/events?year=2026');
  });

  it('keeps a bare fragment as a fragment', () => {
    // `#contact` scrolls; `/#contact` navigates to the home page. Rewriting one
    // into the other silently breaks every in-page anchor.
    expect(normaliseUrl('#contact')).toBe('#contact');
    expect(normaliseUrl('/events#top')).toBe('/events#top');
  });

  it('REJECTS javascript:, in every disguise', () => {
    // Hero.astro renders href={primaryCta.href} unsanitised. Astro escapes the
    // VALUE; it does not touch the SCHEME.
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)',
                     '  javascript:alert(1)', 'java\tscript:alert(1)',
                     'java\nscript:alert(1)']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('REJECTS data:, vbscript:, blob:, file: and about:', () => {
    for (const u of ['data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)',
                     'blob:https://x.example/a', 'file:///etc/passwd', 'about:blank']) {
      expect(normaliseUrl(u), u).toBeNull();
    }
  });

  it('ABSOLUTISES anything that leaves the site', () => {
    // An off-site link is allowed — but it must be stored absolute, because
    // that is what tells a renderer to add rel="noopener".
    expect(normaliseUrl('//evil.example/x')).toBe('https://evil.example/x');
    expect(normaliseUrl('\\\\evil.example/x')).toBe('https://evil.example/x');
  });

  it('ABSOLUTISES a relative path that escapes into an authority', () => {
    // The bypass a review found in the obvious implementation: `parsed.pathname`
    // can itself begin with `//`, which the browser resolves as a host. Returned
    // relative it would render as an in-site link with no rel guard.
    for (const u of ['/.//evil.example/x', '/..//evil.example/x', '/a/..//evil.example/x']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBe('https://evil.example/x');
    }
  });

  it('REJECTS userinfo, which makes a hostile host look trusted', () => {
    expect(normaliseUrl('https://areaa.org@evil.example/')).toBeNull();
    expect(normaliseUrl('https://user:pw@evil.example/')).toBeNull();
  });

  it('rejects empty, blank, non-string and over-long values', () => {
    for (const u of ['', '   ', null, undefined, 42, {},
                     'https://x.example/' + 'a'.repeat(MAX_URL_LEN)]) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('returns null rather than throwing when the path normalises to an authority', () => {
    // `new URL('//', base)` throws. Fuzzing found 54 inputs that reach it, and
    // every one produced an HTTP 500 with no message because shapeCtaEdit
    // calls this outside any try.
    // Every one of these really does normalise to a pathname beginning `//`.
    for (const u of ['/..//', '/.//', './/', '..//', 'a/..//', '/..///']) {
      expect(() => normaliseUrl(u), JSON.stringify(u)).not.toThrow();
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('keeps a backslash path that resolves to the site root', () => {
    // `/.\` does NOT become an authority — WHATWG folds `\` to `/` for
    // special schemes, so it resolves to pathname `/`. An earlier draft put it
    // in the list above and the suite went red against its own implementation,
    // which stopped Task 1 dead: the mutation gate refuses a red baseline.
    expect(normaliseUrl('/.\\')).toBe('/');
  });

  it('REJECTS anything that normalises to an empty href', () => {
    // `?` and `?#` produced '' — stored, rendering <a href=""> which reloads
    // the page, and contradicting this plan's own "a blank is a 400" rule.
    for (const u of ['?', '?#', '#']) {
      expect(normaliseUrl(u), JSON.stringify(u)).toBeNull();
    }
  });

  it('caps the OUTPUT, not just the input', () => {
    // Percent-encoding can triple the length. An 801-char href that stores as
    // 2401 saves once and then fails every later save of that section forever.
    const long = '/' + '<'.repeat(800);
    expect(long.length).toBeLessThan(MAX_URL_LEN);
    expect(normaliseUrl(long)).toBeNull();
  });

  it('is idempotent — normalising twice changes nothing', () => {
    // A save re-reads and re-writes; a non-idempotent normaliser would drift a
    // href on every edit.
    // Includes the inputs that broke the first draft's version of this test:
    // it hand-picked six that happened to work while asserting a property that
    // was false for '?' (→ '') and for anything percent-expanding.
    for (const u of ['/join', '#contact', 'https://areaa.org/x', 'mailto:a@b.org',
                     '//evil.example/x', '/.//evil.example/x', '/a b', '/%2e%2e//x',
                     '/events?q=a b#top']) {
      const once = normaliseUrl(u);
      if (once === null) continue;
      expect(normaliseUrl(once), JSON.stringify(u)).toBe(once);
    }
  });

  it('rejects an over-long input even when it collapses to something short', () => {
    // `/../../../…x` is 2102 characters and normalises to `/x`. The output cap
    // cannot see it; without the input cap the parser does the work anyway.
    const collapsing = '/' + '../'.repeat(700) + 'x';
    expect(collapsing.length).toBeGreaterThan(MAX_URL_LEN);
    expect(normaliseUrl(collapsing)).toBeNull();
  });
});
