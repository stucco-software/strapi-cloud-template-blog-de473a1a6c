import { describe, it, expect } from 'vitest';
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
