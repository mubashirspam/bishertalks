import crypto from "crypto";
import type { NextRequest } from "next/server";

/**
 * Shared secret check for scheduled routes.
 *
 * Same contract the courier poller has used since it was written: header
 * first, query parameter as a fallback because some schedulers cannot set
 * headers, and a constant-time comparison either way.
 *
 * An unset CRON_SECRET refuses rather than allows. A scheduled job that
 * anybody can trigger is worse than one that never runs — these routes send
 * messages to customers.
 */
export function cronAuthorised(request: NextRequest, label: string): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error(`[${label}] CRON_SECRET is unset — refusing to run`);
    return false;
  }

  const sent =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    new URL(request.url).searchParams.get("key") ||
    "";

  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
