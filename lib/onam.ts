import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";

/**
 * The Onam 2026 campaign window.
 *
 * A seasonal band on the landing page, shown only between these two IST days
 * and gone by itself afterwards. That last part is the whole reason this is a
 * date range and not a boolean somebody toggles: an "ഓണാശംസകൾ" banner still
 * sitting on the page in November is worse than never having run one, and it
 * would survive exactly as long as it took someone to remember it.
 *
 * ── Confirm these dates ──────────────────────────────────────────────────
 * Onam follows the Malayalam calendar, and Thiruvonam moves by a fortnight or
 * more between years — it was 5 September in 2025 and falls in late August in
 * 2026. The window below is set to the surrounding sale season rather than to
 * one day, and no date is printed anywhere in the copy, so nothing on screen
 * can contradict the calendar. Change these two lines to move the campaign;
 * nothing else needs touching.
 */
export const ONAM_FIRST_DAY = "2026-08-20";
export const ONAM_LAST_DAY = "2026-09-06";

/** Inclusive start, IST midnight. */
export function onamStartsAt(): Date {
  return new Date(istDayStartUTC(ONAM_FIRST_DAY));
}

/** Exclusive end — the instant the last IST day finishes. */
export function onamEndsAt(): Date {
  return new Date(istDayEndUTC(ONAM_LAST_DAY));
}

/**
 * Is the campaign running?
 *
 * Answered on the server and handed to the client, for the same reason the
 * launch campaign is: a reader loading the page across midnight would get one
 * answer from the server and another from React, and a festive band that
 * appears and vanishes between hydration and first paint looks broken.
 */
export function onamIsLive(now: number = Date.now()): boolean {
  return now >= onamStartsAt().getTime() && now < onamEndsAt().getTime();
}
