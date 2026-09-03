/**
 * Date helpers for the admin panel.
 *
 * Everything is rendered in Asia/Kolkata explicitly. These pages are server
 * components and Vercel runs in UTC, so without a fixed timeZone every
 * timestamp would display 5h30m earlier than the customer actually acted —
 * enough to make a late-evening order look like it happened that afternoon.
 */

const IST = "Asia/Kolkata";

/** e.g. "5 Aug 2026, 9:40 pm" */
export function formatIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** e.g. "5 Aug, 9:40 pm" — for tables where the year is noise. */
export function formatISTShort(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * e.g. "24 Aug 26" — the date alone, for a table that shows five of them per
 * row. The time is noise when the question is which day something happened,
 * and the year is not: a report can span years, and "24 Aug" in a list that
 * also holds last August is ambiguous in the one place it must not be.
 */
export function formatISTDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

/**
 * IST day boundaries as UTC instants, for filtering `created_at` (stored UTC).
 *
 * IST is UTC+5:30, so "5 Aug" in IST runs 2026-08-04T18:30Z → 2026-08-05T18:30Z.
 * Filtering on the bare date string instead would silently drop orders placed
 * between midnight and 5:30am IST and pull in the previous evening's.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start of the given IST calendar day (YYYY-MM-DD), as a UTC ISO string. */
export function istDayStartUTC(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - IST_OFFSET_MS).toISOString();
}

/** Exclusive end of the given IST calendar day, as a UTC ISO string. */
export function istDayEndUTC(date: string): string {
  return new Date(
    new Date(`${date}T00:00:00Z`).getTime() - IST_OFFSET_MS + 24 * 60 * 60 * 1000
  ).toISOString();
}

/** Today's date in IST as YYYY-MM-DD, for date-input defaults. */
export function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** N days before today, in IST, as YYYY-MM-DD. */
export function istDaysAgo(n: number): string {
  return new Date(Date.now() + IST_OFFSET_MS - n * 864e5).toISOString().slice(0, 10);
}

/**
 * "2h ago", "3d ago". How fresh a lead is matters more than the absolute
 * timestamp when deciding who to chase first.
 */
export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
