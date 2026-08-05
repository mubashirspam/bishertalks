import { sendWhatsApp } from "@/lib/whatsapp";

/**
 * Course-access notifications.
 *
 * Unlike order notifications these aren't tied to an order — access is also
 * granted by an admin, or by CSV import, where no order exists. So this takes a
 * phone number directly and calls the WhatsApp API server-side rather than
 * hopping through /api/whatsapp/send.
 *
 * That hop depends on NEXT_PUBLIC_APP_URL being correct; when it was pointing
 * at a dead domain every notification silently failed. A direct call can't
 * break that way.
 *
 * Never throws — a notification failure must never undo a granted course or a
 * confirmed payment.
 */
export async function notifyCourseAccess(params: {
  phone: string | null | undefined;
  name?: string | null;
  courseTitle: string;
  courseSlug: string;
}): Promise<void> {
  const { phone, name, courseTitle, courseSlug } = params;

  if (!phone) {
    console.error("[Notify] course access: no phone, skipping");
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";
  const digits = phone.replace(/\D/g, "").replace(/^91/, "");

  try {
    await sendWhatsApp({
      phone: `91${digits}`,
      templateName: "course_access",
      parameters: [
        name?.trim() || "there",
        courseTitle,
        `${appUrl}/courses/${courseSlug}`,
        digits,
      ],
    });
  } catch (e) {
    console.error("[Notify] course access send failed:", e);
  }
}
