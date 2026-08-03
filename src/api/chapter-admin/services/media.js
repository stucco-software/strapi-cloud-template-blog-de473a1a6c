'use strict';

/**
 * Raster only, deliberately. Uploads are served from the same CloudFront
 * distribution as the site under /uploads/*, so they share its origin. SVG is
 * XML that can carry <script>, which would make an uploaded SVG stored XSS on
 * our own domain. Do not add 'image/svg+xml' to this list.
 */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Pure. Takes the DETECTED mime (from image-sniff), never the declared one.
 * `{ ok: true }` or `{ ok: false, reason }`.
 */
function validateUpload({ detectedMime, size } = {}) {
  if (!detectedMime || !ALLOWED_MIME.includes(detectedMime)) {
    return {
      ok: false,
      reason: `File is not a supported image. Allowed: ${ALLOWED_MIME.join(', ')}`,
    };
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { ok: false, reason: 'File is empty or its size could not be read' };
  }
  if (size > MAX_BYTES) {
    return { ok: false, reason: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB limit` };
  }
  return { ok: true };
}

module.exports = { validateUpload, ALLOWED_MIME, MAX_BYTES };
