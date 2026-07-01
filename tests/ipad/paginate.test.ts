import { describe, it, expect } from 'vitest';
import { fetchAllPaged, SUPABASE_PAGE_SIZE } from '@watchtower/data-supabase';

// ---------------------------------------------------------------------------
// fetchAllPaged — PostgREST pagination. Worklog history exceeds the 1000-row
// "Max rows" cap, so an unpaginated fetch silently truncates the dataset.
// A fake `page` slices a backing array and records the ranges it was asked for.
// ---------------------------------------------------------------------------

function makePager(total: number) {
  const backing = Array.from({ length: total }, (_, i) => ({ id: i }));
  const ranges: Array<[number, number]> = [];
  const page = (from: number, to: number) => {
    ranges.push([from, to]);
    // PostgREST .range(from,to) is inclusive and clamps to available rows.
    return Promise.resolve({ data: backing.slice(from, to + 1), error: null });
  };
  return { page, ranges };
}

describe('fetchAllPaged', () => {
  it('pages through a dataset larger than one page and concatenates all rows', async () => {
    const { page, ranges } = makePager(2716);
    const rows = await fetchAllPaged(page, 1000);
    expect(rows).toHaveLength(2716);
    // Three requests: 0-999, 1000-1999, 2000-2999 (last returns 716 < 1000 → stop).
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('issues one extra empty page when total is an exact multiple of pageSize', async () => {
    const { page, ranges } = makePager(2000);
    const rows = await fetchAllPaged(page, 1000);
    expect(rows).toHaveLength(2000);
    // 0-999 (full), 1000-1999 (full), 2000-2999 (empty → stop).
    expect(ranges).toHaveLength(3);
  });

  it('makes a single request when the dataset fits in one page', async () => {
    const { page, ranges } = makePager(42);
    const rows = await fetchAllPaged(page, 1000);
    expect(rows).toHaveLength(42);
    expect(ranges).toEqual([[0, 999]]);
  });

  it('returns an empty array for an empty dataset (one request)', async () => {
    const { page, ranges } = makePager(0);
    const rows = await fetchAllPaged(page, 1000);
    expect(rows).toEqual([]);
    expect(ranges).toEqual([[0, 999]]);
  });

  it('preserves row order across pages', async () => {
    const { page } = makePager(2500);
    const rows = await fetchAllPaged<{ id: number }>(page, 1000);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
  });

  it('throws when a page returns an error', async () => {
    const boom = new Error('postgrest down');
    await expect(
      fetchAllPaged(() => Promise.resolve({ data: null, error: boom })),
    ).rejects.toBe(boom);
  });

  it('defaults pageSize to the Supabase 1000-row cap', () => {
    expect(SUPABASE_PAGE_SIZE).toBe(1000);
  });
});
