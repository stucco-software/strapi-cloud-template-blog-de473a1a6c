import { describe, it, expect } from 'vitest';
import {
  HAS_LOCATION,
  NO_LOCATION,
  LOCATED_SORT,
  UNLOCATED_SORT,
  locationPageWindow,
} from '../../src/extensions/users-permissions/directory-sort.js';

/**
 * The window function is the whole reason this fix is not a one-liner: the page
 * that straddles the located/unlocated boundary is where a naive
 * "query one partition or the other" drops or repeats rows.
 */
describe('locationPageWindow', () => {
  it('draws the whole page from located members when the page fits inside them', () => {
    const { located, unlocated } = locationPageWindow(0, 12, 40);
    expect(located).toEqual({ start: 0, limit: 12 });
    // Nothing to ask the second partition for — limit 0 means "do not query".
    expect(unlocated.limit).toBe(0);
  });

  it('draws the whole page from unlocated members once past the located ones', () => {
    const { located, unlocated } = locationPageWindow(24, 12, 20);
    expect(located.limit).toBe(0);
    // Offset restarts from the top of the unlocated partition: 24 - 20.
    expect(unlocated).toEqual({ start: 4, limit: 12 });
  });

  it('fills a straddling page from BOTH, with no gap and no overlap', () => {
    // 5 located rows, page 1 of 12 -> 5 located then the first 7 unlocated.
    const { located, unlocated } = locationPageWindow(0, 12, 5);
    expect(located).toEqual({ start: 0, limit: 5 });
    expect(unlocated).toEqual({ start: 0, limit: 7 });
    expect(located.limit + unlocated.limit).toBe(12);
  });

  it('starts the unlocated partition at its first row on the straddling page', () => {
    // start(3) is still inside the located partition, so the unlocated rows
    // begin at 0 — NOT at 3 - 5 = -2, which would read backwards.
    const { located, unlocated } = locationPageWindow(3, 12, 5);
    expect(located).toEqual({ start: 3, limit: 2 });
    expect(unlocated).toEqual({ start: 0, limit: 10 });
  });

  it('lands exactly on the boundary without double-counting the first unlocated row', () => {
    const { located, unlocated } = locationPageWindow(5, 12, 5);
    expect(located.limit).toBe(0);
    expect(unlocated).toEqual({ start: 0, limit: 12 });
  });

  it('never asks either partition for more than the page size', () => {
    for (const locatedTotal of [0, 1, 5, 11, 12, 13, 100]) {
      for (const start of [0, 5, 12, 24, 99]) {
        const { located, unlocated } = locationPageWindow(start, 12, locatedTotal);
        expect(located.limit + unlocated.limit).toBeLessThanOrEqual(12);
        expect(located.limit).toBeGreaterThanOrEqual(0);
        expect(unlocated.limit).toBeGreaterThanOrEqual(0);
        expect(unlocated.start).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('asks only the unlocated partition when nobody has a location', () => {
    const { located, unlocated } = locationPageWindow(0, 12, 0);
    expect(located.limit).toBe(0);
    expect(unlocated).toEqual({ start: 0, limit: 12 });
  });

  it('walks every row exactly once across consecutive pages', () => {
    // 7 located + 9 unlocated = 16 rows, paged 5 at a time. Rebuild the read
    // plan page by page and assert it reconstructs both partitions in order.
    const locatedTotal = 7;
    const unlocatedTotal = 9;
    const pageSize = 5;
    const seen = [];

    for (let start = 0; start < locatedTotal + unlocatedTotal; start += pageSize) {
      const { located, unlocated } = locationPageWindow(start, pageSize, locatedTotal);
      for (let i = 0; i < located.limit; i += 1) seen.push(`L${located.start + i}`);
      for (let i = 0; i < unlocated.limit; i += 1) seen.push(`U${unlocated.start + i}`);
    }

    // The located rows come first, all of them, in order.
    const located = seen.filter((s) => s.startsWith('L'));
    expect(located).toEqual(
      Array.from({ length: locatedTotal }, (_, i) => `L${i}`)
    );

    // Then the unlocated rows, contiguous from 0 — no gap, no repeat, which is
    // the property that actually matters and the one a boundary bug breaks.
    const unlocated = seen.filter((s) => s.startsWith('U'));
    expect(unlocated).toEqual(
      Array.from({ length: unlocated.length }, (_, i) => `U${i}`)
    );

    // Every real unlocated row is reached. The tail over-asks past the end,
    // because the window cannot know the unlocated total — harmless, since the
    // query just returns fewer rows than the limit allows.
    expect(unlocated.length).toBeGreaterThanOrEqual(unlocatedTotal);

    // And the located rows all precede the unlocated ones.
    expect(seen.indexOf('U0')).toBeGreaterThan(seen.lastIndexOf(`L${locatedTotal - 1}`));
  });
});

describe('the partition filters', () => {
  it('treat NULL and empty string alike, on both sides', () => {
    // The two must be exact complements. If '' counted as located, the members
    // this fix exists for would sort to the top again.
    expect(HAS_LOCATION).toEqual({
      $and: [{ location: { $notNull: true } }, { location: { $ne: '' } }],
    });
    expect(NO_LOCATION).toEqual({
      $or: [{ location: { $null: true } }, { location: { $eq: '' } }],
    });
  });

  it('break ties by name so paging is deterministic', () => {
    expect(LOCATED_SORT).toEqual(['location:asc', 'lastName:asc', 'firstName:asc']);
    expect(UNLOCATED_SORT).toEqual(['lastName:asc', 'firstName:asc']);
  });
});
