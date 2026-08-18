import { revalidateTag } from "next/cache";

/**
 * Every cached read of course/module/lesson data carries this tag, so a single
 * revalidation call after any admin edit refreshes the whole public catalogue.
 */
export const COURSES_TAG = "courses";

/**
 * Backstop lifetime for cached catalogue reads. Admin edits invalidate the tag
 * immediately; this only bounds how long stale data could survive if a
 * revalidation is ever missed (e.g. a row edited directly in the Supabase UI).
 */
export const COURSES_CACHE_SECONDS = 300;

/**
 * Drop the cached catalogue. Called from the admin DB layer after every
 * mutation, so it can't be forgotten when a new admin route is added.
 * Safe to call from route handlers and server actions.
 */
export function revalidateCourses(): void {
  // `{ expire: 0 }` = expire now. Next 16 requires an explicit profile here;
  // the named "max" profile would keep serving stale entries while it
  // revalidates, which would make admin edits look like they hadn't saved.
  // `updateTag` is not an option — it throws outside Server Actions, and these
  // mutations run in route handlers.
  revalidateTag(COURSES_TAG, { expire: 0 });
}

/**
 * The landing CMS — testimonials and the explainer settings.
 *
 * Kept separate from COURSES_TAG on purpose: editing a testimonial shouldn't
 * flush the catalogue, and re-pricing a course shouldn't flush the testimonial
 * list. They're edited from different screens at different times.
 */
export const LANDING_TAG = "landing";

/** Same backstop reasoning as COURSES_CACHE_SECONDS. */
export const LANDING_CACHE_SECONDS = 300;

/**
 * Drop the cached landing content. Called from the landing DB layer after every
 * mutation — same placement as revalidateCourses, so a new admin route can't
 * forget it.
 */
export function revalidateLanding(): void {
  revalidateTag(LANDING_TAG, { expire: 0 });
}

/**
 * Gift wrapping's on/off switch and its fee (migration 0029).
 *
 * Its own tag for the same reason as the two above: the only page that caches
 * this is the static home page, which mentions wrapping in one line under the
 * buy button. Turning wrapping off has to take that line with it, and nothing
 * else on that page needs rebuilding for it.
 *
 * The checkout does NOT read through this cache — it reads live, so the price
 * on the page and the price charged can never be a stale copy apart.
 */
export const GIFT_TAG = "gift";

/** Same backstop reasoning as COURSES_CACHE_SECONDS. */
export const GIFT_CACHE_SECONDS = 300;

export function revalidateGift(): void {
  revalidateTag(GIFT_TAG, { expire: 0 });
}
