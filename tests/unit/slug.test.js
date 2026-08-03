import { describe, it, expect } from 'vitest';
import { slugify, buildSlug, nextAvailableSlug, SlugError }
  from '../../src/api/chapter-admin/services/slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Spring Gala 2026')).toBe('spring-gala-2026');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugify('AREAA: "A-List" — Awards!!')).toBe('areaa-a-list-awards');
  });

  it('strips accents', () => {
    expect(slugify('Café Night')).toBe('cafe-night');
  });

  it('returns empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify('中文活动')).toBe('');
  });
});

describe('buildSlug', () => {
  it('prefixes with the chapter slug', () => {
    expect(buildSlug('boston', 'Spring Gala')).toBe('boston-spring-gala');
  });

  it('throws SlugError — not a bare Error — on an unslugifiable title', () => {
    // AREAA is the Asian Real Estate Association; CJK and Hangul event titles
    // are ordinary, not an edge case. The caller turns SlugError into a 400.
    expect(() => buildSlug('boston', '中文活动')).toThrow(SlugError);
    expect(() => buildSlug('boston', '!!!')).toThrow(SlugError);
    expect(() => buildSlug('boston', undefined)).toThrow(SlugError);
  });
});

describe('nextAvailableSlug', () => {
  it('returns the desired slug when free', () => {
    expect(nextAvailableSlug('boston-gala', [])).toBe('boston-gala');
  });

  it('appends -2 on the first collision', () => {
    expect(nextAvailableSlug('boston-gala', ['boston-gala'])).toBe('boston-gala-2');
  });

  it('skips past runs of taken suffixes', () => {
    expect(nextAvailableSlug('boston-gala',
      ['boston-gala', 'boston-gala-2', 'boston-gala-3'])).toBe('boston-gala-4');
  });

  it('is not confused by unrelated slugs sharing a prefix', () => {
    expect(nextAvailableSlug('boston-gala', ['boston-gala-dinner'])).toBe('boston-gala');
  });
});
