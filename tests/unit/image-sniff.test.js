import { describe, it, expect } from 'vitest';
import { sniffImageType } from '../../src/api/chapter-admin/services/image-sniff.js';

const png  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif'), Buffer.alloc(4)]);
const svg  = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('sniffImageType', () => {
  it('detects each allowed raster format', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(avif)).toBe('image/avif');
  });

  it('returns null for SVG — this is the attack it exists to stop', () => {
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null regardless of what the client claimed', () => {
    // An SVG posted as Content-Type: image/png. The declared type is not an
    // input here, which is the point.
    expect(sniffImageType(svg)).toBeNull();
  });

  it('returns null for other non-images', () => {
    expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImageType(Buffer.from('<html></html>'))).toBeNull();
  });

  it('returns null for short or empty buffers rather than throwing', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(null)).toBeNull();
  });
});
