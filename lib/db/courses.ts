import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Course } from "@/lib/courses-data";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
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

export interface ProductPricing {
  /** Original price in whole rupees (the struck-through "MRP"). */
  price: number;
  /** Discounted price in whole rupees, or null if there's no offer. */
  offerPrice: number | null;
  /** What the customer pays before any promo, in whole rupees. */
  payable: number;
  /** Same as payable, in paise (for Razorpay / order amount). */
  payablePaise: number;
}

interface PricingRow {
  price: number | null;
  offer_price: number | null;
}

/** Turn the course row into the shape callers use. An offer only counts if it
 *  actually undercuts the price, so a stale higher "offer" can't raise it. */
function shapePricing(row: PricingRow | null): ProductPricing {
  const fallbackRupees = Math.round(
    parseInt(process.env.BOOK_PRICE_PAISE || "49900", 10) / 100
  );

  const price = row?.price ?? fallbackRupees;
  const offerPrice =
    row?.offer_price != null && row.offer_price < price ? row.offer_price : null;
  const payable = offerPrice ?? price;

  return { price, offerPrice, payable, payablePaise: payable * 100 };
}

const PRICING_COLUMNS = "price,offer_price";

/**
 * Pricing for the sellable product (the book, which bundles the bonus course).
 * Sourced from the bonus course row so admins can edit it; falls back to the
 * env BOOK_PRICE_PAISE (default ₹499) when no price has been set.
 *
 * Uncached, and deliberately so: this is what /api/orders/create and
 * /api/promo/validate charge from. A cached price that lagged an admin edit
 * would debit a customer an amount the page never showed them. It runs once per
 * order, so reading it live costs nothing worth optimising — use
 * `getCachedProductPricing` for the display path instead, which is the one that
 * runs on every visit.
 */
export async function getProductPricing(): Promise<ProductPricing> {
  const { data } = await supabaseAdmin
    .from("courses")
    .select(PRICING_COLUMNS)
    .eq("slug", BOOK_BONUS_COURSE_SLUG)
    .maybeSingle();

  return shapePricing(data as PricingRow | null);
}

/**
 * Throws rather than falling back, because the result of this one gets stored.
 * Caching the env fallback would pin the wrong price on the sales page for the
 * next five minutes every time a read blipped.
 */
const readPricingCached = cached("product-pricing", async (): Promise<ProductPricing> => {
  const { data, error } = await supabaseAdmin
    .from("courses")
    .select(PRICING_COLUMNS)
    .eq("slug", BOOK_BONUS_COURSE_SLUG)
    .maybeSingle();

  if (error) throw new Error(`product pricing read failed: ${error.message}`);
  return shapePricing(data as PricingRow | null);
});

/**
 * Same price, for pages that only display it.
 *
 * The landing page renders on every visit and used to pay for this read twice —
 * once in generateMetadata, once in the page body — which put two database
 * round trips in front of every visitor for a number that changes when an admin
 * edits it and not otherwise. Tagged with COURSES_TAG, so `revalidateCourses()`
 * (already called after every course mutation) makes an edit visible at once.
 */
export async function getCachedProductPricing(): Promise<ProductPricing> {
  try {
    return await readPricingCached();
  } catch (e) {
    // A live read still beats showing the env fallback, and it keeps the page
    // up if the cache layer itself is the thing that's unhappy.
    console.error("[Pricing] cached read failed, reading live:", e);
    return getProductPricing();
  }
}
