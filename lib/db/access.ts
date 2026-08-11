import { supabaseAdmin } from "@/lib/supabase/admin";
import type { GrantedVia } from "@/lib/types/db";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
import { normalizePhone, upsertUserByPhone } from "@/lib/db/users";
import { notifyCourseAccess } from "@/lib/notify";

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

  // Single joined query — resolving user and course separately cost three
  // sequential round trips, which dominated course page load time.
  const { data: access } = await supabaseAdmin
    .from("course_access")
    .select("status,users!inner(phone),courses!inner(slug)")
    .eq("users.phone", phone)
    .eq("courses.slug", courseSlug)
    .maybeSingle();

  return access?.status === "active";
}

/**
 * Grant (or re-activate) access for a user to a course. Idempotent.
 *
 * `notify` sends the learner a WhatsApp telling them the course is unlocked.
 * It defaults to OFF on purpose: bulk CSV import calls this in a loop, and a
 * few hundred messages fired by accident would be unrecoverable. Turn it on
 * explicitly for single, user-initiated grants.
 */
export async function grantCourseAccess(params: {
  userId: string;
  courseId: string;
  grantedVia: GrantedVia;
  orderId?: string | null;
  /** Human order number, so the notification log ties to the order screen. */
  orderNumber?: string | null;
  notify?: boolean;
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

  if (params.notify) {
    // Look up what the message needs. Failures here must not undo the grant.
    try {
      const [{ data: user }, { data: course }] = await Promise.all([
        supabaseAdmin
          .from("users")
          .select("phone,name")
          .eq("id", params.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("courses")
          .select("slug,title")
          .eq("id", params.courseId)
          .maybeSingle(),
      ]);
      if (user?.phone && course?.slug) {
        await notifyCourseAccess({
          phone: user.phone,
          name: user.name,
          courseTitle: course.title,
          courseSlug: course.slug,
          orderNumber: params.orderNumber ?? null,
        });
      }
    } catch (e) {
      console.error("grantCourseAccess: notification failed:", e);
    }
  }
}

/** Grant access by phone + course slug (used by purchase flow and admin). */
export async function grantCourseAccessByPhone(params: {
  phone: string;
  courseSlug: string;
  grantedVia: GrantedVia;
  orderId?: string | null;
  /** Defaults to true — this path is only used for single, deliberate grants. */
  notify?: boolean;
}): Promise<void> {
  const phone = normalizePhone(params.phone);

  const [{ data: user }, { data: course }] = await Promise.all([
    supabaseAdmin.from("users").select("id").eq("phone", phone).maybeSingle(),
    supabaseAdmin
      .from("courses")
      .select("id")
      .eq("slug", params.courseSlug)
      .maybeSingle(),
  ]);
  if (!user) throw new Error("grantCourseAccessByPhone: user not found");
  if (!course) throw new Error("grantCourseAccessByPhone: course not found");

  await grantCourseAccess({
    userId: user.id,
    courseId: course.id,
    grantedVia: params.grantedVia,
    orderId: params.orderId ?? null,
    notify: params.notify ?? true,
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
    .select(
      "id, user_id, buyer_phone, buyer_name, buyer_email, city, state, payment_status"
    )
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (!order) return;

  // The course is what the book buys. An order row exists from the moment
  // someone types their phone number into checkout, long before they pay — so
  // this function refuses to act on anything that isn't actually paid for,
  // rather than trusting every caller to have checked first.
  //
  // Both current callers do check, but this is the last gate before a free
  // ₹2,499 course is handed out, and a guard here can't be forgotten by the
  // next route that needs to grant access.
  if (order.payment_status !== "paid") {
    console.error(
      "grantBookBonusForOrderNumber: refusing to grant, order is not paid:",
      orderNumber,
      order.payment_status
    );
    return;
  }

  let userId = order.user_id as string | null;

  // Backfill a user + link if the order wasn't connected (safety / old orders).
  if (!userId) {
    // Magic Checkout orders have no phone until it's copied back from Razorpay.
    // Without one there's no identity to grant access to — bail rather than
    // creating a junk user with an empty phone.
    if (!order.buyer_phone) {
      console.error(
        "grantBookBonusForOrderNumber: order has no buyer_phone yet:",
        orderNumber
      );
      return;
    }
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
    orderNumber,
    notify: true,
  });
}
