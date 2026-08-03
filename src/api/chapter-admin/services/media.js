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

const fs = require('node:fs');
const { sniffImageType } = require('./image-sniff');

const SNIFF_BYTES = 32;

/**
 * Validate and store one uploaded image.
 *
 * The type is decided by SNIFFING THE FILE'S BYTES, not by `file.mimetype`,
 * which is only the client's Content-Type header. Strapi's own detection lives
 * in the upload plugin's controllers and is skipped when calling the service
 * directly — which we do in order to reuse the S3 provider config.
 *
 * No delete counterpart on purpose: admins detach media from records, they do
 * not delete from the shared library.
 */
async function uploadImage(file, strapiInstance = global.strapi) {
  const fd = await fs.promises.open(file.filepath, 'r');
  let detectedMime;
  try {
    const { buffer, bytesRead } = await fd.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
    detectedMime = sniffImageType(buffer.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }

  const check = validateUpload({ detectedMime, size: file.size });
  if (!check.ok) {
    const err = new Error(check.reason);
    err.name = 'UploadValidationError';
    throw err;
  }

  // Force the stored type to the detected one so a mislabelled extension or
  // header cannot survive into the media library.
  const [uploaded] = await strapiInstance
    .plugin('upload')
    .service('upload')
    .upload({ data: {}, files: { ...file, mimetype: detectedMime } });

  return uploaded;
}

module.exports = { validateUpload, uploadImage, ALLOWED_MIME, MAX_BYTES };
