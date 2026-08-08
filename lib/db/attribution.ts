import type { NextRequest } from "next/server";
import {
  decodeAttribution,
  attributionColumns,
  ATTR_FIRST_COOKIE,
  ATTR_LAST_COOKIE,
} from "@/lib/attribution";

/**
 * Turn the attribution cookies on a request into order columns.
 *
 * Shared by the two routes that create order rows, so a lead and a Magic
 * Checkout order can't end up attributed by different rules.
 */
export function attributionFromRequest(
  request: NextRequest
): Record<string, string> {
  const last = decodeAttribution(request.cookies.get(ATTR_LAST_COOKIE)?.value);
  const first = decodeAttribution(request.cookies.get(ATTR_FIRST_COOKIE)?.value);
  return attributionColumns(last, first);
}

/**
 * Columns that must never be rewritten once set.
 *
 * A customer who types their number on Monday from an Instagram link and comes
 * back on Friday by typing the URL is still an Instagram customer. Overwriting
 * on the later visit would quietly move every slow-converting sale into
 * "direct" — the exact failure that makes attribution data untrustworthy.
 */
export function firstWriteOnly(
  columns: Record<string, string>,
  existing: Record<string, unknown> | null
): Record<string, string> {
  if (!existing) return columns;

  const out: Record<string, string> = {};
  for (const [col, value] of Object.entries(columns)) {
    if (!existing[col]) out[col] = value;
  }
  return out;
}

/**
 * The referral code this visitor arrived with, from the first-touch cookie.
 *
 * First touch, not last: the person who introduced the customer earns the
 * commission, even if the customer wandered off and came back through Google a
 * week later. Read from the cookie rather than the request body so it can't be
 * forged by editing what the browser posts.
 */
export function refCodeFromRequest(request: NextRequest): string | null {
  const first = decodeAttribution(request.cookies.get(ATTR_FIRST_COOKIE)?.value);
  const last = decodeAttribution(request.cookies.get(ATTR_LAST_COOKIE)?.value);
  return first?.ref_code ?? last?.ref_code ?? null;
}

/** The attribution columns to select when checking what's already recorded. */
export const ATTRIBUTION_COLUMNS =
  "source,first_source,utm_source,utm_medium,utm_campaign,utm_content,referrer_url,landing_path";
