// ---------------------------------------------------------------------------
// Supabase / PostgREST pagination helper
//
// PostgREST caps every unpaginated response at the project's "Max rows" setting
// (1000 by default, and not overridden on this project). A plain
// `.select().is('deleted_at', null)` therefore silently truncates any table
// with more than 1000 rows — which is exactly what happened to the iPad billing
// view once the full worklog history (2700+ rows) was synced: only the first
// page came back, so most months looked empty.
//
// fetchAllPaged walks `.range(from, to)` pages until a short page signals the
// end, concatenating everything. The caller MUST apply a stable `.order()` on a
// unique column on the query it returns, otherwise rows can be skipped or
// duplicated between page requests (PostgREST gives no ordering guarantee).
// ---------------------------------------------------------------------------

/** Supabase's default per-request row cap; also our page size. */
export const SUPABASE_PAGE_SIZE = 1000;

/** Minimal shape of a PostgREST range response (a thenable Supabase builder). */
export interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Fetch every row of a query by paging through inclusive `.range()` windows.
 *
 * @param page    Called once per page with the inclusive `from`/`to` row indices;
 *                returns the Supabase result for `query.range(from, to)`.
 * @param pageSize Rows per request. Defaults to the Supabase 1000-row cap.
 * @throws whatever a page returns in its `error` field.
 */
export async function fetchAllPaged<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    // A page shorter than the window means we've reached the end.
    if (rows.length < pageSize) break;
  }
  return all;
}
