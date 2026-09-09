/**
 * Mark a named batch of orders delivered — a one-off list from the shop, not
 * a courier scan or a portal tick.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/alias-loader.mjs \
 *     scripts/mark-delivered-batch.ts [--write]
 *
 * Dry by default. `--write` is the flag that touches the database.
 *
 * Goes through setDeliveryStatus() and notifyStatusChange() — the same
 * functions the delivery portal's own Delivered tick calls — so this cannot
 * drift from what a real tick does: the referral commission settles exactly
 * as it would from the portal, and the customer gets the same "delivered"
 * WhatsApp a portal tick would send.
 *
 * Three kinds of order in the list are refused rather than force-marked,
 * for the same reason the portal itself refuses them:
 *
 *   - already delivered      nothing to do, and re-marking would re-notify
 *   - cancelled              the book never shipped; "delivered" would be a
 *                            lie the reports would then repeat
 *   - COD and not yet paid   marking this delivered without the cash being
 *                            collected is how a shop ships a book and never
 *                            gets paid for it — see app/api/admin/delivery/
 *                            portal/route.ts's own guard, mirrored here
 *
 * Everything else in the list is marked delivered regardless of its current
 * status — this is a named list from the shop, not a forward-only scan, so
 * there is no "must already be shipped" check the way a courier scan has.
 */
import { setDeliveryStatus, notifyStatusChange } from "@/lib/db/delivery";
import { supabaseAdmin } from "@/lib/supabase/admin";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const WRITE = process.argv.includes("--write");

// The list, exactly as given — duplicates deduped below.
const RAW_ORDER_NUMBERS = [
  "ORD-6R64MC", "ORD-DAGQG8", "ORD-USDYHW", "ORD-65SVGZ", "ORD-4K3ZJP",
  "ORD-DLK3Y5", "ORD-GYUUXS", "ORD-FWKRMR", "ORD-FZTV99", "ORD-XRF88W",
  "ORD-SUZSYT", "ORD-BRWG2N", "ORD-KWVNHG", "ORD-TSJ8Q6", "ORD-V3RH5C",
  "ORD-Y9JLPP", "ORD-U46SGR", "ORD-8EUZWF", "ORD-EEAP7R", "ORD-QYBKGH",
  "ORD-D7SGVM", "ORD-6F72FU", "ORD-F9GKS5", "ORD-3CQEGD", "ORD-9Z7KS5",
  "ORD-42Y4AP", "ORD-6R64MC", "ORD-DAGQG8", "ORD-USDYHW", "ORD-KJGS89",
  "ORD-LJGB53", "ORD-5WYVLS", "ORD-M35M9N",
];

async function main() {
  console.log(`${BOLD}Mark delivered — batch${OFF} ${WRITE ? `${RED}(WRITE MODE)` : `${DIM}(dry run — pass --write to save)`}${OFF}\n`);

  const orderNumbers = [...new Set(RAW_ORDER_NUMBERS)];
  if (orderNumbers.length !== RAW_ORDER_NUMBERS.length) {
    console.log(
      `${YELLOW}${RAW_ORDER_NUMBERS.length - orderNumbers.length} duplicate order number(s) in the list — counted once.${OFF}\n`
    );
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number,buyer_name,status,delivery_mode,payment_status")
    .in("order_number", orderNumbers);

  if (error) {
    console.error(`${RED}Could not read orders: ${error.message}${OFF}`);
    process.exit(1);
  }

  const found = new Map((data ?? []).map((o) => [o.order_number, o]));
  const missing = orderNumbers.filter((n) => !found.has(n));

  const eligible: string[] = [];
  const skipped: { order_number: string; reason: string }[] = [];

  for (const n of orderNumbers) {
    const o = found.get(n);
    if (!o) continue; // reported separately, under `missing`

    if (o.status === "delivered") {
      skipped.push({ order_number: n, reason: "already delivered" });
    } else if (o.status === "cancelled") {
      skipped.push({ order_number: n, reason: "cancelled — never shipped" });
    } else if (o.delivery_mode === "cod" && o.payment_status !== "paid") {
      skipped.push({ order_number: n, reason: "COD, cash not yet collected — use Collect instead" });
    } else {
      eligible.push(n);
    }
  }

  console.log(`${BOLD}${orderNumbers.length}${OFF} order(s) in the list, ${BOLD}${found.size}${OFF} found.\n`);

  if (missing.length) {
    console.log(`${RED}Not found (${missing.length}):${OFF}`);
    for (const n of missing) console.log(`  ${n}`);
    console.log();
  }

  if (skipped.length) {
    console.log(`${YELLOW}Skipped — not marked (${skipped.length}):${OFF}`);
    for (const s of skipped) {
      const o = found.get(s.order_number)!;
      console.log(`  ${s.order_number}  ${DIM}${o.buyer_name ?? ""} — was ${o.status}${OFF}  ${YELLOW}${s.reason}${OFF}`);
    }
    console.log();
  }

  console.log(`${GREEN}To mark delivered (${eligible.length}):${OFF}`);
  for (const n of eligible) {
    const o = found.get(n)!;
    console.log(`  ${n}  ${DIM}${o.buyer_name ?? ""} — was ${o.status}${OFF}`);
  }
  console.log();

  if (!eligible.length) {
    console.log(`${DIM}Nothing to do.${OFF}`);
    return;
  }

  if (!WRITE) {
    console.log(`${DIM}Dry run — nothing written. Re-run with --write to mark these ${eligible.length} delivered and notify their customers.${OFF}`);
    return;
  }

  const updated = await setDeliveryStatus(eligible, "delivered");
  console.log(`${GREEN}${updated.length} order(s) marked delivered.${OFF}`);

  const notified = await notifyStatusChange(updated, "delivered");
  console.log(`${GREEN}${notified} customer(s) notified on WhatsApp.${OFF}`);

  const notUpdated = eligible.filter((n) => !updated.includes(n));
  if (notUpdated.length) {
    console.log(`${RED}Did not update (check these by hand): ${notUpdated.join(", ")}${OFF}`);
  }
}

main().catch((e) => {
  console.error(`${RED}Failed:${OFF}`, e);
  process.exit(1);
});
