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
