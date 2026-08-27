import { indiaPostReadiness, TRACK_BATCH } from "@/lib/india-post/config";
import { trackArticles } from "@/lib/india-post/track";
import { statusFromEvent, describeEvent } from "@/lib/india-post/status";
import type { CourierConfig } from "@/lib/couriers/types";
import type { CarrierAdapter, CarrierScan } from "./types";

/**
 * India Post, behind the seam.
 *
 * Tracking only, and that is the whole point of building it now. Booking,
 * labels and the office lookup do not exist yet, so `capabilities.book` is
 * false and no Send button is drawn — but every Speed Post parcel whose
 * article number we know can be polled the moment credentials work.
 *
 * ── Why there is no trackByReference ──────────────────────────────────────
 *
 * Delhivery indexes on the reference we mint, so a parcel handed over on a
 * spreadsheet can be found without ever seeing its waybill. India Post cannot
 * do that: `/v1/tracking/bulk` takes article numbers and nothing else.
 *
 * That turns out not to matter, because the asymmetry runs the other way.
 * India Post's article number is *ours* — we mint it from an allotted range
 * before booking (see article-number.ts), so it is on the order from the
 * moment the parcel is routed. There was never a window where we knew the
 * parcel and not its number, which is exactly the window `trackByReference`
 * exists to cover for Delhivery.
 *
 * ── Fifty, not five hundred ───────────────────────────────────────────────
 *
 * `TRACK_BATCH` is 50, from the portal's own description of TNT02. The
 * approach document says 500. Believing it would mean every poll silently
 * dropping nine parcels in ten, so the conservative number stands until one
 * real response says otherwise.
 */

export const indiaPostAdapter: CarrierAdapter = {
  slug: "speed-post",
  trackingKey: "india-post",

  capabilities: {
    // Not yet: lib/india-post/booking.ts does not exist. Declaring this true
    // would draw a Send button that throws.
    book: false,
    track: true,
    // The pincode lookup (/v1/pincode-search) is confirmed available but
    // offices.ts is not written. False until it is.
    serviceability: false,
    // tariff.ts exists and works; nothing routes through the seam to it yet.
    quote: false,
    label: false,
  },

  trackBatch: TRACK_BATCH,

  readiness(config: CourierConfig) {
    const { ready, missing } = indiaPostReadiness(config);
    return { ready, missing };
  },

  async trackByCarrierId(ids: string[], config: CourierConfig): Promise<CarrierScan[]> {
    const { ready, settings } = indiaPostReadiness(config);
    if (!ready || !settings) return [];

    const tracked = await trackArticles(ids, settings);

    const out: CarrierScan[] = [];
    for (const article of tracked) {
      // An article they hold no events for yet. Absent rather than guessed at:
      // a booking that has not been scanned is not a movement.
      if (!article.latest) continue;

      out.push({
        carrierId: article.articleNumber,
        // They do not echo our reference back, and do not need to — see above.
        reference: null,
        scan: {
          description: describeEvent(article.latest),
          at: article.latest.at,
          next: statusFromEvent(article.latest),
        },
      });
    }
    return out;
  },
};
