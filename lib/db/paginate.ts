/**
 * Reading more than a thousand rows.
 *
 * PostgREST caps every response at `db-max-rows`, which Supabase sets to 1000.
 * It does this *silently*: ask for 20,000 rows and you get 1000 back, with no
 * error and no warning. Several aggregates in this codebase carried a
 * `.limit(20000)` and a comment saying the ceiling would "fail loudly rather
 * than silently halving" — it never could, because the truncation happens on
 * the server before the limit is ever consulted.
 *
 * What that looked like from the outside: the dashboard stopped counting at
 * 1000 orders, Insights stopped at 1000 leads, the profit report understated
 * revenue, and the Excel export dropped everything past the thousandth row.
 * All while looking completely healthy.
 *
 * So anything that aggregates over the whole table pages through it here.
 */

/** Supabase's `db-max-rows`. Asking for more per request achieves nothing. */
export const PAGE_SIZE = 1000;

/**
 * A hard stop, so a runaway loop cannot hold a request open forever.
 *
 * Well above any plausible order count for this shop, and if it is ever
 * reached the caller is told rather than quietly handed a partial answer —
 * which is the whole failure this module exists to end.
 */
const DEFAULT_MAX = 100_000;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Read every row a query matches, a page at a time.
 *
 * `page` is called with a row range and must apply it — typically
 * `.range(from, to)` on a Supabase query builder:
 *
 *     const { rows } = await fetchAllRows(
 *       (from, to) => supabaseAdmin.from("orders").select("amount_paise").range(from, to),
 *       { label: "dashboard revenue" }
 *     );
 *
 * `truncated` is true only if the safety ceiling was hit. It is not the normal
 * end of the data — that is signalled by a short page — so a caller can show
 * "these figures are partial" and mean it.
 *
 * Ordering matters: an unordered paged read can repeat or skip rows between
 * pages, because Postgres makes no promise about row order without an ORDER BY.
 * Callers should order by something stable, and every one here does.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  { label, max = DEFAULT_MAX }: { label: string; max?: number }
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];

  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);

    if (error) {
      // Return what we have rather than throwing: a dashboard that renders
      // slightly stale numbers beats one that shows a stack trace. The log is
      // how anyone finds out, so it names the caller.
      console.error(`[Paginate] ${label} failed at row ${from}:`, error.message);
      return { rows, truncated: true };
    }

    const batch = data ?? [];
    rows.push(...batch);

    // A short page is the end of the data — the only reliable signal, since
    // PostgREST does not tell us whether more exist.
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }

  console.warn(`[Paginate] ${label} hit the ${max}-row ceiling — figures are partial`);
  return { rows, truncated: true };
}
