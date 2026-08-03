import { describe, it, expect } from 'vitest';
import { pickWhitelisted } from '../../src/api/chapter-admin/services/fields.js';

describe('pickWhitelisted', () => {
  it('keeps whitelisted fields', () => {
    expect(pickWhitelisted({ title: 'Gala', location: 'SF' }, ['title', 'location']))
      .toEqual({ title: 'Gala', location: 'SF' });
  });

  it('drops everything not whitelisted', () => {
    expect(pickWhitelisted({ title: 'Gala', chapter: 7, role: 1, status: 'Active' }, ['title']))
      .toEqual({ title: 'Gala' });
  });

  it('omits absent fields rather than blanking them', () => {
    expect(pickWhitelisted({ title: 'Gala' }, ['title', 'location'])).toEqual({ title: 'Gala' });
  });

  it('preserves an explicit empty string (a real clear)', () => {
    expect(pickWhitelisted({ location: '' }, ['location'])).toEqual({ location: '' });
  });

  it('trims strings but leaves other types alone', () => {
    expect(pickWhitelisted({ title: '  Gala  ', memberPrice: 20, figure: null },
      ['title', 'memberPrice', 'figure']))
      .toEqual({ title: 'Gala', memberPrice: 20, figure: null });
  });

  it('returns an empty object for non-object input', () => {
    expect(pickWhitelisted(null, ['title'])).toEqual({});
    expect(pickWhitelisted('nope', ['title'])).toEqual({});
  });
});
