import { indiaPostRequest } from "./client";
import { ENDPOINTS, TRACK_BATCH, type IndiaPostSettings } from "./config";
import { eventTimestamp, type IndiaPostEvent } from "./status";

/**
 * Asking India Post where our parcels are.
 *
 * Richer than Delhivery's tracking in a way that matters: their answer carries
 * the **whole** event history for every article, not just the latest scan. So
 * a poll is never "what changed" — it is always the complete story again, and
 * the forward-only guard in applyCarrierScan is doing real work on every single
 * call rather than only when a webhook arrives out of order.
 *
 * Fifty articles a call, from the portal's own description of TNT02. The
 * approach document says five hundred; believing it would mean every poll
 * silently dropping nine parcels in ten.
 */

export interface TrackedArticle {
  articleNumber: string;
  /** The most recent event, which is what a scan is applied from. */
  latest: IndiaPostEvent | null;
  /** Their own summary, when they give one — "delivered", and so on. */
  deliveryStatus: string | null;
  bookedAt: string | null;
  destinationPincode: string | null;
  /** How many events they hold. Useful only for saying "nothing new yet". */
  eventCount: number;
}

interface BulkResponse {
  status_code?: number;
  success?: boolean;
  message?: string;
  data?: {
    booking_details?: {
      article_number?: string;
      booked_on?: string;
      destination_pincode?: string | number;
      article_type?: string;
    };
    tracking_details?: {
      date?: string;
      time?: string;
      office?: string;
      officeid?: number;
      event?: string;
      event_code?: string;
    }[];
    del_status?: { del_status?: string };
  }[];
}

/** Chunk article numbers into calls their API will accept. */
export function trackingBatches(articles: string[]): string[][] {
  const clean = [...new Set(articles.filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < clean.length; i += TRACK_BATCH) {
    out.push(clean.slice(i, i + TRACK_BATCH));
  }
  return out;
}

/**
 * Track up to TRACK_BATCH articles.
 *
 * An article they have never heard of is simply absent from the answer — the
 * caller decides what that means, because "not found" an hour after booking is
 * a lag and a week after one is a problem.
 */
export async function trackArticles(
  articles: string[],
  settings: IndiaPostSettings
): Promise<TrackedArticle[]> {
  const bulk = [...new Set(articles.filter(Boolean))].slice(0, TRACK_BATCH);
  if (!bulk.length) return [];

  const response = await indiaPostRequest<BulkResponse>({
    settings,
    path: ENDPOINTS.trackBulk,
    method: "POST",
    json: { bulk },
    // A read. Repeating it costs nothing and changes nothing.
    retryOnNetworkError: true,
  });

  const out: TrackedArticle[] = [];

  for (const entry of response.data ?? []) {
    const article = (entry.booking_details?.article_number ?? "").trim().toUpperCase();
    if (!article) continue;

    const events = entry.tracking_details ?? [];

    // Their list arrives oldest first in every sample. Sorted anyway rather
    // than trusted: taking the wrong end of it would apply a booking scan to a
    // delivered parcel, and the forward-only guard would then hide the bug by
    // ignoring it — a silent wrong answer instead of a loud one.
    const withTime = events
      .map((e) => ({ e, at: eventTimestamp(e.date ?? "", e.time ?? "") }))
      .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

    const last = withTime[withTime.length - 1];

    out.push({
      articleNumber: article,
      latest: last
        ? {
            // Bulk tracking sends no event code — only the wording, and the
            // wording for a delivery is the bare "Item Delivered" with no clue
            // which way the parcel went. `deliverySummary` is what settles it.
            eventCode: (last.e.event_code ?? "").trim().toUpperCase(),
            eventDescription: last.e.event ?? "",
            at: last.at,
            office: last.e.office ?? null,
            nonDeliveryReason: null,
            deliverySummary: entry.del_status?.del_status ?? null,
          }
        : null,
      deliveryStatus: entry.del_status?.del_status?.trim() || null,
      bookedAt: entry.booking_details?.booked_on ?? null,
      destinationPincode:
        entry.booking_details?.destination_pincode != null
          ? String(entry.booking_details.destination_pincode)
          : null,
      eventCount: events.length,
    });
  }

  return out;
}
