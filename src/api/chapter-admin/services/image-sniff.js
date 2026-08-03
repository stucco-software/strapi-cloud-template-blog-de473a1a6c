'use strict';

/**
 * Detect an image type from its leading bytes. Pure.
 *
 * This exists because Strapi's own MIME detection lives in the upload plugin's
 * CONTROLLERS (prepareUploadRequest -> enforceUploadSecurity), not its service.
 * We call the service directly in order to reuse the S3 provider config, so we
 * get no detection for free — and `file.mimetype` is just the client's
 * Content-Type header. Trusting it would let an SVG posted as image/png through
 * the raster-only allowlist and store script-bearing XML on our own origin.
 *
 * Returns a mime string or null. Never throws.
 */
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // WEBP: "RIFF" ???? "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // AVIF: ???? "ftypavif" (brand at offset 8 within the ftyp box)
  if (buf.toString('ascii', 4, 8) === 'ftyp' && buf.toString('ascii', 8, 12) === 'avif') {
    return 'image/avif';
  }

  return null;
}

module.exports = { sniffImageType };
