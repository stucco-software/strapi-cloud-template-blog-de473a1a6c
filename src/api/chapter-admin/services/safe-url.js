'use strict';

/**
 * A URL that is safe to put in an href — normalised — or null.
 *
 * This exists because THIS PLAN is what lets a chapter admin set an href.
 * `Hero.astro:48` and `Section.astro:54` render `href={primaryCta.href}` with no
 * sanitisation anywhere in either repo. Astro escapes the attribute VALUE; it
 * does nothing to the SCHEME, so `javascript:` would execute.
 *
 * Use the platform parser, not a hand-rolled one. Two things a hand-rolled
 * version got wrong, both found by review:
 *
 *  - `\\evil.example/x` — WHATWG canonicalises `\` to `/` for special schemes,
 *    so it resolves off-site. A textual `//` check never sees it.
 *  - `/.//evil.example/x` — `parsed.pathname` itself begins `//`, so returning
 *    the relative form re-creates the same problem one layer down.
 *
 * NORMALISING, not merely validating, is what closes both: anything that
 * resolves off-site comes back absolute, so a renderer can tell.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
const MAX_URL_LEN = 2048;

/** Any absolute origin; it exists only so relative URLs can be parsed. */
const BASE = 'https://base.invalid';
const BASE_ORIGIN = new URL(BASE).origin;

function normaliseUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw === '') return null;
  // The cap is re-checked on the OUTPUT at the end. Checking only the input
  // lets an 801-character href normalise to 2401 percent-encoded characters,
  // store fine, and then fail every subsequent save of that section forever —
  // the same trap `page-content.js` documents for MAX_TEXT_LEN.
  if (raw.length > MAX_URL_LEN) return null;

  // EVERYTHING inside the try. `new URL('//', base)` throws — there is no host
  // — and a pathname can normalise to exactly `//` from ordinary-looking input.
  // Fuzzing found 54 such strings (`/..//`, `.//`, `/.\`, `a/..//`, …); each
  // one produced an uncaught TypeError and an HTTP 500 with no message,
  // because shapeCtaEdit calls this outside any try.
  let out;
  try {
    const parsed = new URL(raw, `${BASE}/`);

    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) return null;
    if (parsed.username !== '' || parsed.password !== '') return null;

    if (parsed.origin !== BASE_ORIGIN) {
      out = parsed.href;                       // off-site: absolute, so the
                                               // renderer can tell
    } else {
      const rel = `${parsed.pathname}${parsed.search}${parsed.hash}`;

      if (rel.startsWith('//')) {
        // The path itself is an authority. `/.//evil.example/x` normalises to
        // `//evil.example/x`, which renders as an in-site link and navigates
        // off-site.
        out = new URL(rel, `${BASE}/`).href;
      } else if (parsed.pathname === '/' && raw.startsWith('#')) {
        out = parsed.hash;                     // `#contact` scrolls; `/#contact`
      } else if (parsed.pathname === '/' && raw.startsWith('?')) {
        out = `${parsed.search}${parsed.hash}`;
      } else {
        out = rel;
      }
    }
  } catch {
    return null;
  }

  // `?` and `?#` reach here as the empty string, which would store href="" and
  // render <a href=""> — a link that reloads the page. Both fields are
  // required:true on the component; an empty result is a refusal.
  if (typeof out !== 'string' || out === '') return null;
  if (out.length > MAX_URL_LEN) return null;
  return out;
}

module.exports = { normaliseUrl, MAX_URL_LEN, ALLOWED_SCHEMES };
