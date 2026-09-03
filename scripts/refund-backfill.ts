/**
 * Find refunds Razorpay already made and this system never heard about.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/alias-loader.mjs \
 *     scripts/refund-backfill.ts [--write]
 *
 * WHY THIS EXISTS. Until migration 0055 there was nowhere to put a refund, so
 * every rupee sent back from the Razorpay dashboard is still counted as revenue
 * on the reports. The webhook now catches refunds as they happen; this catches
 * the ones that happened before it was listening. Run it once after deploying,
 * and again any time refunds were issued while the webhook was misconfigured.
 *
 * Razorpay is the only source. Nothing here reads `status = 'cancelled'` or
 * infers a refund from anything on our side, because a cancellation is not a
 * refund — most cancelled orders never had money returned, and guessing would
 * replace an over-count with an under-count.
 *
 * Dry by default. `--write` is the flag that touches the database, and the
 * write goes through lib/db/refunds.ts — the same function the webhook uses —
 * so a backfilled refund is indistinguishable from a live one.
 *
 * Re-running is safe: the recorder assigns the gateway's running total rather
 * than adding to ours, so a second run over the same refunds changes nothing.
 */
import { recordRefund } from "@/lib/db/refunds";
import { supabaseAdmin } from "@/lib/supabase/admin";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const WRITE = process.argv.includes("--write");

const KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
const SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY || !SECRET) {
  console.error(
    `${RED}NEXT_PUBLIC_RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set.${OFF}\n` +
    `Pass --env-file=.env.local.`
  );
  process.exit(1);
}

const AUTH = "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64");

interface RzpRefund {
  id: string;
  amount: number;
  payment_id: string;
  /** 'pending' | 'processed' | 'failed'. */
  status: string;
  created_at: number;
}

async function rzp<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: { Authorization: AUTH },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `Razorpay ${path} → ${res.status} ${JSON.stringify(body).slice(0, 300)}`
    );
  }
  return body as T;
}

/**
 * Every refund on the account, oldest first.
 *
 * Paged at 100, which is Razorpay's ceiling for `count`. A shop with a handful
 * of refunds does one request; the loop is here so the script does not silently
 * stop at the hundredth refund the way an unpaged read would.
 */
async function allRefunds(): Promise<RzpRefund[]> {
  const out: RzpRefund[] = [];
  for (let skip = 0; ; skip += 100) {
    const page = await rzp<{ items: RzpRefund[] }>(
      `/refunds?count=100&skip=${skip}`
    );
    const items = page.items ?? [];
    out.push(...items);
    process.stdout.write(`${DIM}  fetched ${out.length} refunds…${OFF}\r`);
    if (items.length < 100) break;
  }
  process.stdout.write("\r\x1b[K");
  return out;
}

console.log(
  `\n${BOLD}Refund backfill${OFF} ${DIM}${
    WRITE ? "WRITING" : "dry run — nothing will be saved"
  }${OFF}\n`
);

// Migration 0055 first, or every lookup below fails on the missing column and
// the run reports "matched no order" for refunds that match perfectly well.
// A wrong answer that looks like an answer is the failure worth spending six
// lines to prevent.
{
  const { error } = await supabaseAdmin
    .from("orders")
    .select("refunded_paise")
    .limit(1);
  if (error) {
    console.error(
      `${RED}The orders table has no refund columns yet.${OFF}\n` +
      `Run ${BOLD}supabase/migrations/0055_a_refund_is_not_a_cancellation.sql${OFF} ` +
      `in the Supabase SQL editor, then re-run this.\n${DIM}(${error.message})${OFF}\n`
    );
    process.exit(1);
  }
}

const refunds = await allRefunds();
console.log(`Razorpay reports ${BOLD}${refunds.length}${OFF} refund(s).\n`);

if (!refunds.length) {
  console.log(`${GREEN}Nothing to do.${OFF}\n`);
  process.exit(0);
}

/**
 * Roll them up per payment, because that is the unit an order maps to.
 *
 * A failed refund is skipped rather than subtracted: Razorpay never sent the
 * money, so it was never part of the total. The newest refund's id and time are
 * kept as the ones worth showing on the order.
 */
const byPayment = new Map<
  string,
  { paise: number; latestId: string; latestAt: number; count: number }
>();

let failed = 0;
for (const r of refunds) {
  if (r.status === "failed") {
    failed++;
    continue;
  }
  const cur = byPayment.get(r.payment_id);
  if (!cur) {
    byPayment.set(r.payment_id, {
      paise: r.amount,
      latestId: r.id,
      latestAt: r.created_at,
      count: 1,
    });
  } else {
    cur.paise += r.amount;
    cur.count++;
    if (r.created_at >= cur.latestAt) {
      cur.latestId = r.id;
      cur.latestAt = r.created_at;
    }
  }
}

if (failed) {
  console.log(`${DIM}${failed} failed refund(s) ignored — that money never left.${OFF}\n`);
}

/**
 * The payment id is the handle, and it is on the order already for anything
 * paid through this system. When it is not — an order whose row was written
 * before the payment id was stored, or a payment taken outside the site — ask
 * Razorpay what order it belonged to and try that instead.
 */
async function fallbackLookup(paymentId: string) {
  try {
    const payment = await rzp<{
      order_id?: string;
      notes?: Record<string, string>;
    }>(`/payments/${paymentId}`);
    if (payment.notes?.order_number) {
      return { orderNumber: payment.notes.order_number } as const;
    }
    if (payment.order_id) return { razorpayOrderId: payment.order_id } as const;
  } catch (e) {
    console.error(`${DIM}  payment lookup failed for ${paymentId}: ${e}${OFF}`);
  }
  return null;
}

let recorded = 0, unchanged = 0, orphaned = 0, totalPaise = 0;
const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;

for (const [paymentId, agg] of byPayment) {
  const facts = {
    amountRefundedPaise: agg.paise,
    refundId: agg.latestId,
    at: new Date(agg.latestAt * 1000).toISOString(),
  };

  if (!WRITE) {
    // Dry run reads the row directly rather than going through the recorder,
    // so it can report exactly what a write would change without doing it.
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("order_number, amount_paise, refunded_paise")
      .eq("razorpay_payment_id", paymentId)
      .maybeSingle();

    if (!order) {
      orphaned++;
      console.log(
        `${YELLOW}?${OFF} ${paymentId} ${rupees(agg.paise)} ${DIM}— no order carries this payment id${OFF}`
      );
      continue;
    }

    const already = order.refunded_paise ?? 0;
    const target = Math.min(agg.paise, order.amount_paise ?? 0);
    if (already === target) {
      unchanged++;
      continue;
    }
    recorded++;
    totalPaise += target - already;
    console.log(
      `${GREEN}→${OFF} ${order.order_number} ${DIM}${rupees(order.amount_paise ?? 0)} →${OFF} ` +
      `refund ${BOLD}${rupees(target)}${OFF}` +
      `${target >= (order.amount_paise ?? 0) ? " (full)" : " (partial)"}` +
      `${agg.count > 1 ? ` ${DIM}across ${agg.count} refunds${OFF}` : ""}`
    );
    continue;
  }

  let result = await recordRefund({ razorpayPaymentId: paymentId }, facts);

  if (!result) {
    const fallback = await fallbackLookup(paymentId);
    if (fallback) result = await recordRefund(fallback, facts);
  }

  if (!result) {
    orphaned++;
    console.log(
      `${YELLOW}?${OFF} ${paymentId} ${rupees(agg.paise)} ${DIM}— matched no order, skipped${OFF}`
    );
    continue;
  }

  if (!result.changed) {
    unchanged++;
    continue;
  }

  recorded++;
  totalPaise += result.refundedPaise - result.previousPaise;
  console.log(
    `${GREEN}✓${OFF} ${result.orderNumber} ${DIM}${rupees(result.amountPaise)} →${OFF} ` +
    `refunded ${BOLD}${rupees(result.refundedPaise)}${OFF}` +
    `${result.full ? " (full)" : " (partial)"}`
  );
}

console.log(
  `\n${BOLD}${recorded}${OFF} order(s) ${WRITE ? "updated" : "would change"}, ` +
  `${rupees(totalPaise)} coming off revenue.` +
  `${unchanged ? ` ${DIM}${unchanged} already correct.${OFF}` : ""}` +
  `${orphaned ? ` ${YELLOW}${orphaned} matched no order.${OFF}` : ""}`
);

if (!WRITE && recorded) {
  console.log(`\n${YELLOW}Dry run.${OFF} Re-run with ${BOLD}--write${OFF} to save.\n`);
} else {
  console.log("");
}
