/**
 * Run `work` over `items`, at most `limit` at a time.
 *
 * For the per-parcel writes that used to be a `for … await` loop: each one is
 * conditional on its own row and independent of the others, so waiting for
 * one to finish before starting the next only adds round-trip latency. A
 * limit rather than a bare Promise.all so a 300-parcel batch doesn't open
 * 300 connections to the database at once.
 *
 * `work` should not throw — callers handle their own failures per item, the
 * same way the loops they replace did. A throw still rejects the whole call.
 */
export async function inBatches<T>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<void>
): Promise<void> {
  for (let start = 0; start < items.length; start += limit) {
    await Promise.all(
      items.slice(start, start + limit).map((item, i) => work(item, start + i))
    );
  }
}

/** How many per-parcel database writes run side by side. */
export const WRITE_CONCURRENCY = 10;
