import { supabaseAdmin } from "@/lib/supabase/admin";
import type { GrantedVia } from "@/lib/types/db";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
import { normalizePhone, upsertUserByPhone } from "@/lib/db/users";

/**
 * Does the given phone number have ACTIVE access to the given course?
 * Re-checked on every course load, so admin revoke takes effect immediately.
 */
export async function hasCourseAccessByPhone(
  rawPhone: string,
  courseSlug: string
): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (!user) return false;

  const { data: course } = await supabaseAdmin
    .from("courses")
    .select("id")
    .eq("slug", courseSlug)
    .maybeSingle();
  if (!course) return false;

  const { data: access } = await supabaseAdmin
    .from("course_access")
    .select("status")
    .eq("user_id", user.id)
    .eq("course_id", course.id)
    .maybeSingle();

  return access?.status === "active";
}

/** Grant (or re-activate) access for a user to a course. Idempotent. */
export async function grantCourseAccess(params: {
  userId: string;
  courseId: string;
  grantedVia: GrantedVia;
  orderId?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("course_access").upsert(
    {
      user_id: params.userId,
      course_id: params.courseId,
      granted_via: params.grantedVia,
      status: "active",
      order_id: params.orderId ?? null,
      granted_at: new Date().toISOString(),
    },
    { onConflict: "user_id,course_id" }
  );
  if (error) throw new Error(`grantCourseAccess failed: ${error.message}`);
}

/** Grant access by phone + course slug (used by purchase flow and admin). */
export async function grantCourseAccessByPhone(params: {
  phone: string;
  courseSlug: string;
  grantedVia: GrantedVia;
  orderId?: string | null;
}): Promise<void> {
  const phone = normalizePhone(params.phone);

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (!user) throw new Error("grantCourseAccessByPhone: user not found");

  const { data: course } = await supabaseAdmin
    .from("courses")
    .select("id")
    .eq("slug", params.courseSlug)
    .maybeSingle();
  if (!course) throw new Error("grantCourseAccessByPhone: course not found");

  await grantCourseAccess({
    userId: user.id,
    courseId: course.id,
    grantedVia: params.grantedVia,
    orderId: params.orderId ?? null,
  });
}

export async function revokeCourseAccess(params: {
  userId: string;
  courseId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("course_access")
    .update({ status: "revoked" })
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId);
  if (error) throw new Error(`revokeCourseAccess failed: ${error.message}`);
}

/**
 * Called when an order is paid. Ensures the buyer has a user record and grants
 * them access to the bonus (NLP) course, linked to the order. Idempotent and
 * safe to call from both the verify endpoint and the Razorpay webhook.
 */
export async function grantBookBonusForOrderNumber(
  orderNumber: string
): Promise<void> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, user_id, buyer_phone, buyer_name, buyer_email, city, state")
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (!order) return;

  let userId = order.user_id as string | null;

  // Backfill a user + link if the order wasn't connected (safety / old orders).
  if (!userId) {
    const user = await upsertUserByPhone({
      phone: order.buyer_phone,
      name: order.buyer_name,
      email: order.buyer_email,
      city: order.city,
      state: order.state,
    });
    userId = user.id;
    await supabaseAdmin
      .from("orders")
      .update({ user_id: userId })
      .eq("id", order.id);
  }

  const { data: course } = await supabaseAdmin
    .from("courses")
    .select("id")
    .eq("slug", BOOK_BONUS_COURSE_SLUG)
    .maybeSingle();
  if (!course) {
    console.error(
      "grantBookBonusForOrderNumber: bonus course not found:",
      BOOK_BONUS_COURSE_SLUG
    );
    return;
  }

  await grantCourseAccess({
    userId,
    courseId: course.id,
    grantedVia: "purchase",
    orderId: order.id,
  });
}
