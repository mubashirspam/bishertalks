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
