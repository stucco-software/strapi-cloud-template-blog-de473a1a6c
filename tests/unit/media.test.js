import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateUpload, ALLOWED_MIME, MAX_BYTES }
  from '../../src/api/chapter-admin/services/media.js';

describe('validateUpload', () => {
  it('accepts each allowed raster type when the bytes agree', () => {
    for (const mime of ALLOWED_MIME) {
      expect(validateUpload({ detectedMime: mime, size: 1024 })).toEqual({ ok: true });
    }
  });

  it('rejects a null detection — SVG, PDF, anything unrecognised', () => {
    expect(validateUpload({ detectedMime: null, size: 1024 }).ok).toBe(false);
  });

  it('rejects an unlisted but detected type', () => {
    expect(validateUpload({ detectedMime: 'image/gif', size: 1024 }).ok).toBe(false);
  });

  it('rejects files over the cap', () => {
    expect(validateUpload({ detectedMime: 'image/png', size: MAX_BYTES + 1 }).ok).toBe(false);
  });

  it('accepts a file exactly at the cap', () => {
    expect(validateUpload({ detectedMime: 'image/png', size: MAX_BYTES })).toEqual({ ok: true });
  });

  it('rejects empty or malformed sizes', () => {
    for (const size of [0, -1, undefined, 'big', NaN]) {
      expect(validateUpload({ detectedMime: 'image/png', size }).ok).toBe(false);
    }
  });
});

describe('the cap itself', () => {
  it('is 15MB — enough for a phone photo, which is what a gallery gets', () => {
    // Raised from 5MB for the chapter photo gallery (2026-09-20). 5MB was
    // sized for a single hero figure an admin picks deliberately; a current
    // iPhone photo is routinely 4-12MB, so the old cap rejected ORDINARY
    // input on the one surface built for bulk uploads.
    expect(MAX_BYTES).toBe(15 * 1024 * 1024);
  });

  it('stays below the transport cap, so refusals stay readable', () => {
    // `formidable.maxFileSize` in config/middlewares rejects at the transport
    // layer, before this check can produce a message the admin can act on.
    // If the two ever cross, an oversized upload fails with a framework error
    // instead of "File exceeds the 15MB limit".
    const middlewares = readFileSync('config/middlewares.js', 'utf8');
    const match = middlewares.match(/maxFileSize:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(match).not.toBeNull();
    const transportCap = Number(match[1]) * 1024 * 1024;
    expect(MAX_BYTES).toBeLessThan(transportCap);
  });

  it('accepts a 12MB photo, which 5MB refused', () => {
    expect(validateUpload({ detectedMime: 'image/jpeg', size: 12 * 1024 * 1024 }).ok).toBe(true);
  });
});
