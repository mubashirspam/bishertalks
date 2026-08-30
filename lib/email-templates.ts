import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";

/**
 * The purchase confirmation email.
 *
 * Deliberately short: what they paid, and the button that opens the course.
 * No itemised bill, no discount lines, no attachment — the customer already
 * knows what they bought, and everything extra is one more thing between them
 * and the course they can start right now.
 *
 * Built as tables with inline styles, which looks like 2005 and is still the
 * only thing Gmail, Outlook and Indian webmail render identically. Flexbox,
 * grid and <style> blocks are variously stripped or ignored.
 *
 * A plain-text alternative goes alongside: HTML-only mail scores worse with
 * spam filters, and some people genuinely read text.
 */

export interface PurchaseEmailOrder {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  city: string | null;
  state: string | null;
  amount_paise: number;
}

export interface PurchaseEmail {
  subject: string;
  html: string;
  text: string;
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function purchaseEmail(
  order: PurchaseEmailOrder,
  appUrl: string
): PurchaseEmail {
  const base = appUrl.replace(/\/$/, "");
  const courseUrl = `${base}/courses/${BOOK_BONUS_COURSE_SLUG}`;
  const trackUrl = `${base}/neuro-code/track?id=${order.order_number}`;

  const name = order.buyer_name?.trim().split(/\s+/)[0] || "there";
  const amount = `₹${Math.round(order.amount_paise / 100).toLocaleString("en-IN")}`;
  const place = [order.city, order.state].filter(Boolean).join(", ");

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.06);">

  <!-- Header -->
  <tr><td align="center" style="padding:36px 28px 28px;">
    <div style="width:52px;height:52px;line-height:52px;border-radius:50%;background:#dcfce7;color:#16a34a;font-size:26px;margin:0 auto 16px;">&#10003;</div>
    <p style="margin:0;font-size:21px;font-weight:800;color:#111;">Thank you, ${escape(name)}</p>
    <p style="margin:8px 0 0;font-size:14px;color:#666;line-height:1.6;">
      Your payment went through and your copy of <strong style="color:#111;">Neuro Code</strong> is on its way.
    </p>
  </td></tr>

  <!-- Amount + order number -->
  <tr><td style="padding:0 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #eee;border-radius:12px;">
      <tr>
        <td style="padding:18px 20px;">
          <p style="margin:0;font-size:11px;color:#888;letter-spacing:.4px;font-weight:700;">AMOUNT PAID</p>
          <p style="margin:4px 0 0;font-size:26px;font-weight:800;color:#111;">${amount}</p>
        </td>
        <td align="right" style="padding:18px 20px;">
          <p style="margin:0;font-size:11px;color:#888;letter-spacing:.4px;font-weight:700;">ORDER</p>
          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#111;font-family:monospace;">${escape(order.order_number)}</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- The course: the thing they get this second, so it's the loudest element -->
  <tr><td style="padding:16px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;">
      <tr><td style="padding:22px 20px;" align="center">
        <p style="margin:0 0 6px;font-size:11px;font-weight:800;color:#c2410c;letter-spacing:.5px;">UNLOCKED NOW</p>
        <p style="margin:0 0 8px;font-size:17px;font-weight:800;color:#111;">Your free NLP course</p>
        <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#555;">
          14 modules · 42 videos · 17 worksheets.<br/>
          Start today — no need to wait for the book.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
          <td style="background:#f97316;border-radius:999px;">
            <a href="${courseUrl}" style="display:inline-block;padding:14px 34px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Start the course</a>
          </td>
        </tr></table>
        ${
          order.buyer_phone
            ? `<p style="margin:14px 0 0;font-size:12px;color:#888;">Sign in with <strong style="color:#555;">${escape(order.buyer_phone)}</strong></p>`
            : ""
        }
      </td></tr>
    </table>
  </td></tr>

  <!-- Delivery -->
  <tr><td style="padding:22px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:13px;color:#666;padding:5px 0;">Delivery</td>
        <td align="right" style="font-size:13px;color:#111;padding:5px 0;">${place ? escape(place) : "Across India"}</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#666;padding:5px 0;">Expected</td>
        <td align="right" style="font-size:13px;color:#16a34a;font-weight:600;padding:5px 0;">7–12 days</td>
      </tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:20px 28px 30px;">
    <a href="${trackUrl}" style="font-size:13px;color:#f97316;font-weight:600;text-decoration:none;">Track your order →</a>
  </td></tr>

  <tr><td style="background:#fafafa;padding:18px 28px;border-top:1px solid #eee;" align="center">
    <p style="margin:0;font-size:12px;line-height:1.6;color:#999;">
      Reply to this email if anything's wrong — it reaches us directly.
    </p>
    <p style="margin:6px 0 0;font-size:12px;color:#bbb;">Bisher KC · bishertalks.com</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    `Thank you, ${name}`,
    ``,
    `Your payment went through and your copy of Neuro Code is on its way.`,
    ``,
    `Amount paid: ${amount}`,
    `Order: ${order.order_number}`,
    ``,
    `YOUR FREE NLP COURSE IS UNLOCKED NOW`,
    `14 modules, 42 videos, 17 worksheets. Start today:`,
    courseUrl,
    order.buyer_phone ? `Sign in with ${order.buyer_phone}.` : "",
    ``,
    place ? `Delivery: ${place}` : "",
    `Expected: 5-7 business days`,
    `Track your order: ${trackUrl}`,
    ``,
    `Reply to this email if anything's wrong.`,
    `Bisher KC · bishertalks.com`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    subject: `Order confirmed — Neuro Code (${order.order_number})`,
    html,
    text,
  };
}
