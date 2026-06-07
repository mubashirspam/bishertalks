import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Course } from "@/lib/courses-data";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";

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
export async function getCourseList(): Promise<CourseListItem[]> {
  const { data } = await supabaseAdmin
    .from("courses")
    .select(COURSE_FIELDS)
    .order("sort_order", { ascending: true });
  return (data as CourseListItem[]) ?? [];
}

/**
 * Courses for the public listing, with lesson counts. One query per table
 * (courses, modules, lessons) aggregated in memory — fine for a small catalog.
 */
export async function getCoursesForListing(): Promise<CourseListItemWithStats[]> {
  const { data: courses } = await supabaseAdmin
    .from("courses")
    .select(`id,${COURSE_FIELDS}`)
    .order("sort_order", { ascending: true });
  if (!courses?.length) return [];

  const courseIds = courses.map((c) => c.id);
  const { data: modules } = await supabaseAdmin
    .from("modules")
    .select("id,course_id")
    .in("course_id", courseIds);

  const moduleIds = (modules ?? []).map((m) => m.id);
  const { data: lessons } = await supabaseAdmin
    .from("lessons")
    .select("module_id,type")
    .in("module_id", moduleIds.length ? moduleIds : ["00000000-0000-0000-0000-000000000000"]);

  const moduleToCourse = new Map((modules ?? []).map((m) => [m.id, m.course_id]));

  return courses.map((c) => {
    const courseModules = (modules ?? []).filter((m) => m.course_id === c.id);
    const courseLessons = (lessons ?? []).filter(
      (l) => moduleToCourse.get(l.module_id) === c.id
    );
    return {
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle,
      description: c.description,
      thumbnail: c.thumbnail,
      is_locked: c.is_locked,
      price: c.price,
      offer_price: c.offer_price,
      moduleCount: courseModules.length,
      videoCount: courseLessons.filter((l) => l.type === "video").length,
      pdfCount: courseLessons.filter((l) => l.type === "pdf").length,
    };
  });
}

/** Lightweight course header (no lessons) — safe to render on the locked gate. */
export async function getCourseMeta(slug: string): Promise<CourseListItem | null> {
  const { data } = await supabaseAdmin
    .from("courses")
    .select(COURSE_FIELDS)
    .eq("slug", slug)
    .maybeSingle();
  return (data as CourseListItem) ?? null;
}

/**
 * Full course with modules + lessons, mapped into the `Course` shape used by
 * the existing CourseContent component. Only call this AFTER an access check —
 * it returns lesson URLs.
 */
export async function getCourseWithContent(slug: string): Promise<Course | null> {
  const { data: course } = await supabaseAdmin
    .from("courses")
    .select("id,slug,title,subtitle,description,thumbnail")
    .eq("slug", slug)
    .maybeSingle();
  if (!course) return null;

  const { data: modules } = await supabaseAdmin
    .from("modules")
    .select("id,title,sort_order")
    .eq("course_id", course.id)
    .order("sort_order", { ascending: true });

  const moduleIds = (modules ?? []).map((m) => m.id);

  const { data: lessons } = await supabaseAdmin
    .from("lessons")
    .select("module_id,slug,title,type,url,duration,sort_order")
    .in("module_id", moduleIds.length ? moduleIds : ["00000000-0000-0000-0000-000000000000"])
    .order("sort_order", { ascending: true });

  return {
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle ?? "",
    description: course.description ?? "",
    thumbnail: course.thumbnail ?? "",
    modules: (modules ?? []).map((m, i) => ({
      id: i,
      title: m.title,
      lessons: (lessons ?? [])
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          slug: l.slug,
          title: l.title,
          type: l.type as "video" | "pdf",
          url: l.url,
          duration: l.duration ?? undefined,
        })),
    })),
  };
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

/**
 * Pricing for the sellable product (the book, which bundles the bonus course).
 * Sourced from the bonus course row so admins can edit it; falls back to the
 * env BOOK_PRICE_PAISE (default ₹499) when no price has been set.
 */
export async function getProductPricing(): Promise<ProductPricing> {
  const fallbackRupees = Math.round(
    parseInt(process.env.BOOK_PRICE_PAISE || "49900", 10) / 100
  );

  const { data } = await supabaseAdmin
    .from("courses")
    .select("price,offer_price")
    .eq("slug", BOOK_BONUS_COURSE_SLUG)
    .maybeSingle();

  const price = data?.price ?? fallbackRupees;
  const offerPrice =
    data?.offer_price != null && data.offer_price < price ? data.offer_price : null;
  const payable = offerPrice ?? price;

  return { price, offerPrice, payable, payablePaise: payable * 100 };
}
