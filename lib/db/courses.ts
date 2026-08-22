import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Course } from "@/lib/courses-data";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
import {
  resolvePricing,
  shapePair,
  envFallbackRupees,
  type ProductPricing,
  type PricingRow,
} from "@/lib/pricing";
import {
  COURSES_TAG,
  COURSES_CACHE_SECONDS,
  revalidateCourses,
} from "@/lib/db/cache-tags";

/**
 * Catalogue reads are shared across requests and tagged, so admin edits flush
 * them instantly (see `revalidateCourses`). Access checks are deliberately NOT
 * cached — revoking a user's access must take effect on their next page load.
 */
function cached<A extends unknown[], R>(
  keyPart: string,
  fn: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return unstable_cache(fn, [keyPart], {
    tags: [COURSES_TAG],
    revalidate: COURSES_CACHE_SECONDS,
  });
}

export interface CourseListItem {
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  thumbnail: string | null;
  is_locked: boolean;
  price: number | null;
  offer_price: number | null;
}

export interface CourseListItemWithStats extends CourseListItem {
  moduleCount: number;
  videoCount: number;
  pdfCount: number;
}

const COURSE_FIELDS = "slug,title,subtitle,description,thumbnail,is_locked,price,offer_price,sort_order";

/** All courses for the listing page, ordered. */
export const getCourseList = cached(
  "course-list",
  async (): Promise<CourseListItem[]> => {
    const { data } = await supabaseAdmin
      .from("courses")
      .select(COURSE_FIELDS)
      .order("sort_order", { ascending: true });
    return (data as CourseListItem[]) ?? [];
  }
);

/**
 * Courses for the public listing, with lesson counts. A single embedded query
 * (courses → modules → lessons) so the page costs one round trip, not three.
 */
export const getCoursesForListing = cached("courses-listing", async (): Promise<
  CourseListItemWithStats[]
> => {
  const { data: courses } = await supabaseAdmin
    .from("courses")
    .select(`${COURSE_FIELDS},modules(id,lessons(type))`)
    .order("sort_order", { ascending: true });
  if (!courses?.length) return [];

  return (courses as unknown as Array<
    CourseListItem & { modules: Array<{ id: string; lessons: Array<{ type: string }> }> }
  >).map((c) => {
    const lessons = (c.modules ?? []).flatMap((m) => m.lessons ?? []);
    return {
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      description: c.description,
      thumbnail: c.thumbnail,
      is_locked: c.is_locked,
      price: c.price,
      offer_price: c.offer_price,
      moduleCount: (c.modules ?? []).length,
      videoCount: lessons.filter((l) => l.type === "video").length,
      pdfCount: lessons.filter((l) => l.type === "pdf").length,
    };
  });
});

/** Lightweight course header (no lessons) — safe to render on the locked gate. */
export const getCourseMeta = cache(
  cached("course-meta", async (slug: string): Promise<CourseListItem | null> => {
    const { data } = await supabaseAdmin
      .from("courses")
      .select(COURSE_FIELDS)
      .eq("slug", slug)
      .maybeSingle();
    return (data as CourseListItem) ?? null;
  })
);

/** A course plus its gate metadata (price / lock state), from one query. */
export interface CourseWithMeta {
  course: Course;
  meta: CourseListItem;
}

interface CourseRow extends CourseListItem {
  modules: Array<{
    id: string;
    title: string;
    sort_order: number | null;
    lessons: Array<{
      slug: string;
      title: string;
      type: string;
      url: string;
      duration: string | null;
      sort_order: number | null;
    }>;
  }>;
}

const bySortOrder = (a: { sort_order: number | null }, b: { sort_order: number | null }) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0);

/**
 * Full course with modules + lessons AND the listing metadata, in a single
 * embedded query. Wrapped in React `cache()` so `generateMetadata` and the page
 * body share one fetch per request instead of hitting the DB twice.
 *
 * Only render the returned lesson URLs AFTER an access check.
 */
export const getCourseBundle = cache(
  cached("course-bundle", async (slug: string): Promise<CourseWithMeta | null> => {
    const { data } = await supabaseAdmin
      .from("courses")
      .select(
        `${COURSE_FIELDS},modules(id,title,sort_order,lessons(slug,title,type,url,duration,sort_order))`
      )
      .eq("slug", slug)
      .maybeSingle();

    const row = data as unknown as CourseRow | null;
    if (!row) return null;

    const course: Course = {
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle ?? "",
      description: row.description ?? "",
      thumbnail: row.thumbnail ?? "",
      modules: [...(row.modules ?? [])].sort(bySortOrder).map((m, i) => ({
        id: i,
        title: m.title,
        lessons: [...(m.lessons ?? [])].sort(bySortOrder).map((l) => ({
          slug: l.slug,
          title: l.title,
          type: l.type as "video" | "pdf",
          url: l.url,
          duration: l.duration ?? undefined,
        })),
      })),
    };

    return {
      course,
      meta: {
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle,
        description: row.description,
        thumbnail: row.thumbnail,
        is_locked: row.is_locked,
        price: row.price,
        offer_price: row.offer_price,
      },
    };
  })
);

/**
 * Full course with modules + lessons, mapped into the `Course` shape used by
 * the existing CourseContent component. Only call this AFTER an access check —
 * it returns lesson URLs.
 */
export async function getCourseWithContent(slug: string): Promise<Course | null> {
  return (await getCourseBundle(slug))?.course ?? null;
}

/** Update admin-managed course settings (thumbnail / price / offer price). */
export async function updateCourseSettings(
  slug: string,
  fields: { thumbnail?: string | null; price?: number | null; offer_price?: number | null }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("courses")
    .update(fields)
    .eq("slug", slug);
  if (error) throw new Error(`updateCourseSettings failed: ${error.message}`);
  revalidateCourses();
}

// Re-exported so the dozen callers that import ProductPricing from here keep
// working — the type moved to lib/pricing.ts to get it away from the React
// cache, not to make everyone rewrite an import.
export type { ProductPricing };
export { resolvePricing };

/** The old shape, for the fallback path below. */
interface CoursePricingRow {
  price: number | null;
  offer_price: number | null;
}

const PRICING_COLUMNS =
  "book_price_rupees,book_offer_rupees,next_book_price_rupees," +
  "next_book_offer_rupees,price_effective_at";

const COURSE_PRICING_COLUMNS = "price,offer_price";

/**
 * Where the price used to live, for a database that has not had 0048 applied.
 *
 * Migrations here are applied by hand, so a deploy can land first — and this is
 * the number every order is charged. Falling straight to BOOK_PRICE_PAISE would
 * quietly sell the book for ₹499. The row we are migrating away from is still
 * correct until somebody edits the new one, so read that instead.
 */
async function readCoursePricing(): Promise<ProductPricing> {
  const { data } = await supabaseAdmin
    .from("courses")
    .select(COURSE_PRICING_COLUMNS)
    .eq("slug", BOOK_BONUS_COURSE_SLUG)
    .maybeSingle();

  const row = data as CoursePricingRow | null;
  return shapePair(row?.price ?? envFallbackRupees(), row?.offer_price ?? null);
}

/**
 * Pricing for the sellable product (the book, which bundles the bonus course).
 *
 * Lives on `checkout_settings` since 0048 — the table behind the Checkout tab,
 * which is where somebody looks for what a customer pays. It used to be read
 * off the bonus course's own row, which meant the price of the product was a
 * field on the free gift that comes with it.
 *
 * Uncached, and deliberately so: this is what /api/orders/create and
 * /api/promo/validate charge from. A cached price that lagged an admin edit
 * would debit a customer an amount the page never showed them. It runs once per
 * order, so reading it live costs nothing worth optimising — use
 * `getCachedProductPricing` for the display path instead, which is the one that
 * runs on every visit.
 */
export async function getProductPricing(): Promise<ProductPricing> {
  const { data, error } = await supabaseAdmin
    .from("checkout_settings")
    .select(PRICING_COLUMNS)
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error(
      "[Pricing] checkout_settings read failed — is migration 0048 applied? " +
        "Falling back to the course row.",
      error.message
    );
    return readCoursePricing();
  }

  const row = data as PricingRow | null;

  // The columns exist but nobody has put a price in them — the migration ran
  // and its seed did not, or the row was created empty. `resolvePricing` would
  // fall to BOOK_PRICE_PAISE and quietly sell the book at ₹499. The course row
  // it is being migrated away from is still right until somebody edits the new
  // one, so prefer that.
  if (!hasPrice(row)) {
    console.error(
      "[Pricing] checkout_settings has no book price — did 0048's seed run? " +
        "Falling back to the course row."
    );
    return readCoursePricing();
  }

  return resolvePricing(row);
}

/** Is there a real price stored, as opposed to an empty row? */
function hasPrice(row: PricingRow | null): row is PricingRow {
  return row != null && row.book_price_rupees != null;
}

/**
 * The raw row, cached — NOT the resolved price.
 *
 * This distinction is the whole scheduling feature. Caching the resolved price
 * behind COURSES_CACHE_SECONDS (300s) would mean a change set for midnight
 * arrives up to five minutes late, on every server that happened to warm its
 * cache at 23:59. Caching the row and resolving against `Date.now()` on the way
 * out makes the flip exact whatever the cache is doing.
 *
 * Throws rather than falling back, because the result gets cached: pinning a
 * fallback for five minutes every time a read blipped is worse than one slow
 * request.
 */
const readPricingRowCached = cached(
  "product-pricing-row",
  async (): Promise<PricingRow | null> => {
    const { data, error } = await supabaseAdmin
      .from("checkout_settings")
      .select(PRICING_COLUMNS)
      .eq("id", true)
      .maybeSingle();

    if (error) throw new Error(`product pricing read failed: ${error.message}`);
    return data as PricingRow | null;
  }
);

export async function getCachedProductPricing(): Promise<ProductPricing> {
  try {
    // Resolved HERE, outside the cache, against this request's clock. The cache
    // holds the row; the schedule is applied fresh every time. THIS is what
    // makes a change set for midnight land at midnight rather than whenever the
    // cache next expires.
    const row = await readPricingRowCached();

    // Same guard as the live read: an empty row must not become ₹499.
    if (!hasPrice(row)) return getProductPricing();

    return resolvePricing(row);
  } catch (e) {
    // A live read still beats showing a fallback, and it keeps the page up if
    // the cache layer itself is the thing that's unhappy.
    console.error("[Pricing] cached read failed, reading live:", e);
    return getProductPricing();
  }
}

/**
 * The pending price change, for the admin card and the countdown.
 *
 * Separate from `getProductPricing` on purpose: that answers "what does this
 * customer pay", which must never depend on a schedule that has not arrived.
 * This answers "what is about to happen", which only the admin screen and the
 * deadline copy have any business knowing.
 *
 * Returns null when nothing is scheduled, and keeps returning the change after
 * its moment has passed — the card needs to say "took effect at" rather than
 * forgetting, and `lib/preorder.ts` needs the instant either way.
 */
export interface ScheduledPriceChange {
  price: number;
  offerPrice: number | null;
  /** When it takes over. May be in the past. */
  effectiveAt: Date;
  /** Has that moment already passed? */
  applied: boolean;
}

export async function getScheduledPriceChange(): Promise<ScheduledPriceChange | null> {
  const { data, error } = await supabaseAdmin
    .from("checkout_settings")
    .select(PRICING_COLUMNS)
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("[Pricing] schedule read failed:", error.message);
    return null;
  }

  const row = data as PricingRow | null;
  if (!row?.price_effective_at || row.next_book_price_rupees == null) return null;

  const effectiveAt = new Date(row.price_effective_at);
  return {
    price: row.next_book_price_rupees,
    offerPrice: row.next_book_offer_rupees,
    effectiveAt,
    applied: effectiveAt.getTime() <= Date.now(),
  };
}
