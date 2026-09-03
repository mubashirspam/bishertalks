import { supabaseAdmin } from "@/lib/supabase/admin";
import { listCouriers } from "@/lib/db/couriers";
import { articleNumber, isValidArticleNumber } from "@/lib/india-post/article-number";

/**
 * The article-number stock, and taking numbers out of it.
 *
 * Migration 0049. The rule everything here exists to protect:
 *
 *   **A number is never returned to stock.** Not on a refused booking, not on
 *   a timeout, not on an admin undoing something. A booking whose outcome we
 *   never learned may well have registered that number at India Post, and two
 *   parcels travelling under one article number is not something we can fix
 *   from here. Wasting a number costs nothing; reusing one costs a parcel.
 *
 * So `allocate` is the only way numbers leave the stock, and nothing in this
 * module puts one back. `markSpent` exists to record that a number is dead —
 * which is a different thing from making it available again.
 */

export interface AllocatedBarcode {
  barcode: string;
  orderNumber: string;
}

/** What the SQL side hands back — see claim_postal_serials in 0049. */
interface Claim {
  range_id: string;
  prefix: string;
  suffix: string;
  first_serial: number;
  claimed: number;
}

/**
 * Whose ranges does this courier draw from?
 *
 * Usually itself. The exception is two couriers posting under one India Post
 * contract: Speed Post and Mubashir Logistic carry the same `contract_id` and
 * `customer_id`, because they are the same contractual account booked at two
 * counters. India Post allots numbers to the *account*, so a second courier
 * with its own empty stock would report a shortfall while nine hundred numbers
 * sat unused under the first.
 *
 * ── The two rules that keep this safe ─────────────────────────────────────
 *
 * **Only postal couriers group.** Not by contract alone — the Delhivery row
 * in this database also carries contract 41767647, left over from however its
 * config was first filled in. Grouping on the contract by itself would put
 * Delhivery in the postal pool and let one of its parcels take an article
 * number, which is precisely what /api/admin/delivery/allot-articles refuses
 * to allow. A courier that is not `tracking: "india-post"` is never rehomed.
 *
 * **The group member holding the ranges wins, not the first one listed.**
 * Deciding by `sort_order` would have made Mubashir Logistic (20) the owner
 * over Speed Post (30) and orphaned every number already loaded. So the answer
 * is read from where the ranges actually are, and a courier holding its own
 * ranges always keeps them.
 *
 * Falls back to the courier itself whenever the answer is unclear — no group,
 * no ranges anywhere, or a lookup that failed. That is the conservative
 * direction: it can report an empty stock that someone then loads a range
 * into, where the opposite mistake spends another account's numbers.
 */
export async function postalStockOwner(courierId: string): Promise<string> {
  try {
    const couriers = await listCouriers();
    const self = couriers.find((c) => c.id === courierId);

    const contract = self?.config?.contract_id?.trim();
    if (!self || self.config?.tracking !== "india-post" || !contract) return courierId;

    const group = couriers.filter(
      (c) =>
        c.config?.tracking === "india-post" && c.config?.contract_id?.trim() === contract
    );
    if (group.length < 2) return courierId;

    const { data, error } = await supabaseAdmin
      .from("postal_barcode_ranges")
      .select("courier_id")
      .in(
        "courier_id",
        group.map((c) => c.id)
      );
    if (error) {
      console.error("[Postal] stock owner lookup failed:", error.message);
      return courierId;
    }

    const holders = new Set(
      ((data ?? []) as { courier_id: string }[]).map((r) => r.courier_id)
    );
    if (holders.has(courierId)) return courierId;

    // Deterministic among the rest, so two requests never disagree.
    const owner = group
      .filter((c) => holders.has(c.id))
      .sort((a, b) => a.sort_order - b.sort_order)[0];

    return owner?.id ?? courierId;
  } catch (e) {
    console.error("[Postal] stock owner resolution threw:", e);
    return courierId;
  }
}

/**
 * How many numbers are left, for the admin panel and the low-stock warning.
 *
 * Reads the view rather than counting rows: "unused" means what the range
 * cursors say is left, and deriving it a second way is how two screens come to
 * disagree about whether we are about to run out.
 *
 * Reports the *shared* stock where a contract is split across two couriers —
 * see postalStockOwner. A screen showing Mubashir Logistic zero while Speed
 * Post shows nine hundred, when both spend the same allotment, is a screen
 * that gets somebody to order numbers they already have.
 */
export async function barcodeStock(courierId: string): Promise<{
  unused: number;
  allotted: number;
  openRanges: number;
}> {
  const owner = await postalStockOwner(courierId);
  const { data, error } = await supabaseAdmin
    .from("postal_barcode_stock")
    .select("unused,allotted,open_ranges")
    .eq("courier_id", owner)
    .maybeSingle();

  if (error) {
    console.error("[Postal] stock read failed — is migration 0049 applied?", error.message);
    return { unused: 0, allotted: 0, openRanges: 0 };
  }

  const row = data as { unused: number; allotted: number; open_ranges: number } | null;
  return {
    unused: Number(row?.unused ?? 0),
    allotted: Number(row?.allotted ?? 0),
    openRanges: Number(row?.open_ranges ?? 0),
  };
}

/**
 * Record a range India Post has allotted us.
 *
 * Validated here as well as by the table's constraints, because the useful
 * error is "that prefix is not two letters", not a Postgres check-violation
 * string shown to someone pasting an allotment letter into a form.
 */
export async function addBarcodeRange(input: {
  courierId: string;
  prefix: string;
  serialFrom: number;
  serialTo: number;
  suffix?: string;
  note?: string;
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const prefix = input.prefix.trim().toUpperCase();
  const suffix = (input.suffix ?? "IN").trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(prefix)) return { ok: false, error: "The prefix must be two letters, like ET." };
  if (!/^[A-Z]{2}$/.test(suffix)) return { ok: false, error: "The suffix must be two letters, normally IN." };

  const from = Math.trunc(input.serialFrom);
  const to = Math.trunc(input.serialTo);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 99_999_999) {
    return { ok: false, error: "Serials must be whole numbers of at most eight digits." };
  }
  if (to < from) return { ok: false, error: "The last serial cannot be lower than the first." };

  // A range whose ends do not produce valid article numbers is a range typed
  // wrongly. Caught before it is stored, because every number minted from it
  // afterwards would be structurally perfect and belong to somebody else.
  for (const serial of [from, to]) {
    if (!isValidArticleNumber(articleNumber(prefix, serial, suffix))) {
      return { ok: false, error: `${prefix}${serial}${suffix} is not a valid article number.` };
    }
  }

  const { error } = await supabaseAdmin.from("postal_barcode_ranges").insert({
    courier_id: input.courierId,
    prefix,
    suffix,
    serial_from: from,
    serial_to: to,
    next_serial: from,
    note: input.note?.trim() || null,
  });

  if (error) {
    // The exclusion constraint from 0049. Worth naming, because the fix is to
    // check the allotment letter rather than to retry.
    if (/exclusion|overlap/i.test(error.message)) {
      return { ok: false, error: "That range overlaps one already recorded." };
    }
    console.error("[Postal] range insert failed:", error.message);
    return { ok: false, error: "Could not save the range." };
  }

  return { ok: true, count: to - from + 1 };
}

/**
 * Give each of these orders an article number.
 *
 * Orders that already have one keep it — re-running is harmless, and it has to
 * be: this runs immediately before a booking, and a booking that had to be
 * retried must not consume a second number for a parcel that already holds one.
 *
 * Numbers are claimed from the range in one statement per range (see
 * `claim_postal_serials`), then written to `orders.postal_barcode` and recorded
 * in `postal_barcodes`. The recording happens whether or not the write to the
 * order succeeds — a number that left the stock is gone even if we then failed
 * to use it, and the safe direction to be wrong in is "spent".
 *
 * Returns only the orders that now hold a number. A short result means the
 * stock ran out; the caller reports that rather than booking a partial batch
 * silently.
 */
export async function allocateBarcodes(
  courierId: string,
  orderNumbers: string[]
): Promise<{ allocated: AllocatedBarcode[]; shortfall: number }> {
  if (!orderNumbers.length) return { allocated: [], shortfall: 0 };

  // Who already has one. Asked first so a retry costs nothing from the stock.
  const { data: existing, error: readError } = await supabaseAdmin
    .from("orders")
    .select("order_number,postal_barcode")
    .in("order_number", orderNumbers)
    .not("postal_barcode", "is", null);

  if (readError) {
    console.error("[Postal] could not read existing barcodes:", readError.message);
    throw new Error("Could not check which parcels already have an article number");
  }

  const held = new Map(
    (existing ?? []).map((r) => {
      const row = r as { order_number: string; postal_barcode: string };
      return [row.order_number, row.postal_barcode];
    })
  );

  const allocated: AllocatedBarcode[] = orderNumbers
    .filter((n) => held.has(n))
    .map((n) => ({ orderNumber: n, barcode: held.get(n)! }));

  const needing = orderNumbers.filter((n) => !held.has(n));
  if (!needing.length) return { allocated, shortfall: 0 };

  // Claim against whoever holds the ranges, which is not always the courier
  // carrying the parcel — see postalStockOwner. Resolved once here rather than
  // inside the loop: the answer cannot change mid-batch, and asking per
  // iteration would put a courier read between two claims.
  const stockOwner = await postalStockOwner(courierId);

  // Claim from as many ranges as it takes. One statement per range; the loop
  // exists because an allotment can be split across several and the last one
  // may have three numbers left.
  const minted: string[] = [];
  let remaining = needing.length;

  while (remaining > 0) {
    const { data, error } = await supabaseAdmin.rpc("claim_postal_serials", {
      p_courier_id: stockOwner,
      p_wanted: remaining,
    });

    if (error) {
      console.error("[Postal] claim failed — is migration 0049 applied?", error.message);
      break;
    }

    const claim = (Array.isArray(data) ? data[0] : data) as Claim | undefined;
    if (!claim || !claim.claimed) break; // stock exhausted

    for (let i = 0; i < claim.claimed; i++) {
      minted.push(articleNumber(claim.prefix, Number(claim.first_serial) + i, claim.suffix));
    }

    // Recorded before they are attached to anything. If this process dies on
    // the next line, the numbers are still marked gone — which is the safe
    // direction, and the reason this is not done in the same write as the order.
    const rows = minted.slice(minted.length - claim.claimed).map((barcode) => ({
      barcode,
      range_id: claim.range_id,
      state: "allocated" as const,
    }));

    const { error: writeError } = await supabaseAdmin.from("postal_barcodes").insert(rows);
    if (writeError) {
      // The numbers are already out of the range — the cursor moved. Losing
      // them is the correct outcome: we cannot prove they were not used.
      console.error("[Postal] could not record claimed numbers:", writeError.message);
      throw new Error("Could not record the article numbers that were claimed");
    }

    remaining -= claim.claimed;
  }

  // Attach one number to one order, conditional on the order still having
  // none, so two requests racing over the same parcel cannot both write.
  let used = 0;
  for (const orderNumber of needing) {
    const barcode = minted[used];
    if (!barcode) break;

    const { data: updated, error } = await supabaseAdmin
      .from("orders")
      .update({ postal_barcode: barcode, updated_at: new Date().toISOString() })
      .eq("order_number", orderNumber)
      .is("postal_barcode", null)
      .select("order_number");

    if (error) {
      console.error(`[Postal] ${orderNumber} could not take ${barcode}:`, error.message);
      await markSpent(barcode, `Could not attach to ${orderNumber}: ${error.message}`);
      used++;
      continue;
    }

    if (!updated?.length) {
      // Another request got there first. Its number stands; ours is spent.
      await markSpent(barcode, `${orderNumber} already had a number`);
      used++;
      continue;
    }

    await supabaseAdmin
      .from("postal_barcodes")
      .update({ order_number: orderNumber })
      .eq("barcode", barcode);

    allocated.push({ orderNumber, barcode });
    used++;
  }

  return { allocated, shortfall: needing.length - used };
}

/** India Post accepted this number. The parcel is now theirs. */
/**
 * Write an article number somebody read off a counter receipt.
 *
 * The escape hatch for the case the allotment cannot cover: the stock ran out,
 * or the parcel was booked at the window and came back with a number that was
 * never ours to mint. Without this the label prints a blank barcode and the
 * parcel has no machine-readable identity in the system carrying it.
 *
 * ── Deliberately not part of the allotment ────────────────────────────────
 *
 * Nothing is written to `postal_barcodes`. That table is the ledger of numbers
 * *we* own — every row points at the range it was minted from, and `range_id`
 * is NOT NULL because a number with no range is not one of ours to account
 * for. A counter-issued number was never in our stock and spends none of it,
 * so recording it there would overstate what we have used and give it a range
 * it did not come from.
 *
 * ── The three refusals ────────────────────────────────────────────────────
 *
 * **Not a real article number.** Checked against the UPU format and its
 * modulus-11 check digit, the same function the minter validates its own
 * output with. A mistyped number prints a barcode that scans cleanly and
 * resolves to nothing, which is worse than the blank it replaced.
 *
 * **Already ours.** If the number is in `postal_barcodes` it belongs to a
 * parcel the allotment gave it to, and typing it here would put one number on
 * two parcels — with the ledger insisting it is somewhere else.
 *
 * **Already on another order.** The same collision by the other route, since
 * `orders.postal_barcode` carries no unique constraint (0049 indexes it, but
 * does not make it unique).
 *
 * ── Why confirmation closes it ────────────────────────────────────────────
 *
 * Once `courier_entered_at` is set the parcel is on a booking file that has
 * gone to India Post under that number. Changing it afterwards leaves their
 * file and our row disagreeing about which parcel is which, and the parcel is
 * already out of our hands. An allotted number is never overwritten either,
 * whatever the confirmation state: it is spent, and silently replacing it
 * would strand it while the ledger still says it is in use here.
 */
export async function setManualArticleNumber(
  orderNumber: string,
  value: string
): Promise<{ ok: true; barcode: string } | { ok: false; error: string }> {
  const barcode = (value ?? "").trim().toUpperCase();

  if (!barcode) return { ok: false, error: "Type an article number first." };
  if (!isValidArticleNumber(barcode)) {
    return {
      ok: false,
      error:
        "That is not a valid article number. They run two letters, nine " +
        "digits and two letters — like CX054909015IN — and the last digit " +
        "before the country code is a check digit, so a single mistyped " +
        "figure is caught here rather than at the counter.",
    };
  }

  const { data: order, error: readError } = await supabaseAdmin
    .from("orders")
    .select("order_number,postal_barcode,courier_entered_at")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (readError) {
    console.error("[Postal] manual number: order read failed:", readError.message);
    return { ok: false, error: "Could not read that parcel." };
  }
  if (!order) return { ok: false, error: "No such order." };

  const current = (order.postal_barcode as string | null)?.trim() ?? "";
  if (current === barcode) return { ok: true, barcode };

  if (order.courier_entered_at) {
    return {
      ok: false,
      error:
        "This parcel is already confirmed with the courier, so its article " +
        "number is on a booking file India Post has. Untick Confirmed first " +
        "if it really needs to change.",
    };
  }

  // An allotted number is ours and spent. Replacing it here would strand it.
  if (current) {
    const { data: mine } = await supabaseAdmin
      .from("postal_barcodes")
      .select("barcode")
      .eq("barcode", current)
      .maybeSingle();

    if (mine) {
      return {
        ok: false,
        error:
          `${current} came out of our own allotment, so it cannot be typed ` +
          "over — it would be left spent and attached to nothing.",
      };
    }
  }

  const [{ data: allotted }, { data: taken }] = await Promise.all([
    supabaseAdmin.from("postal_barcodes").select("order_number").eq("barcode", barcode).maybeSingle(),
    supabaseAdmin
      .from("orders")
      .select("order_number")
      .eq("postal_barcode", barcode)
      .neq("order_number", orderNumber)
      .maybeSingle(),
  ]);

  if (allotted) {
    const owner = (allotted as { order_number: string | null }).order_number;
    return {
      ok: false,
      error:
        `${barcode} is one of our own allotted numbers` +
        (owner ? `, already on ${owner}.` : " and is already spent.") +
        " Two parcels cannot carry the same number.",
    };
  }
  if (taken) {
    return {
      ok: false,
      error: `${barcode} is already on ${(taken as { order_number: string }).order_number}.`,
    };
  }

  // Conditional on the confirmation state as well, so a batch confirmed
  // between the read above and this write cannot slip through.
  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update({ postal_barcode: barcode, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber)
    .is("courier_entered_at", null)
    .select("order_number");

  if (error) {
    console.error("[Postal] manual number write failed:", orderNumber, error.message);
    return { ok: false, error: "Could not save that number." };
  }
  if (!updated?.length) {
    return {
      ok: false,
      error: "That parcel was confirmed with the courier a moment ago — reload and check.",
    };
  }

  return { ok: true, barcode };
}

export async function markBooked(barcode: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("postal_barcodes")
    .update({ state: "booked", booked_at: new Date().toISOString(), error: null })
    .eq("barcode", barcode);

  if (error) console.error("[Postal] could not mark booked:", barcode, error.message);
}

/**
 * This number is dead. It is **not** returned to stock.
 *
 * Called for a refused booking and for one whose outcome we never learned, and
 * deliberately the same state for both: from the point of view of reuse there
 * is no difference between "they said no" and "we do not know", because only
 * one of those is safe to assume.
 */
export async function markSpent(barcode: string, reason: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("postal_barcodes")
    .update({ state: "spent", error: reason.slice(0, 500) })
    .eq("barcode", barcode);

  if (error) console.error("[Postal] could not mark spent:", barcode, error.message);
}

/**
 * Detach a dead number from its order so the parcel can be given a fresh one.
 *
 * The number itself stays spent forever; this only clears the order's side, so
 * a parcel whose booking was refused can be booked again rather than being
 * stuck holding a number India Post will not accept.
 */
export async function releaseFromOrder(orderNumber: string, reason: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("postal_barcode")
    .eq("order_number", orderNumber)
    .maybeSingle();

  const barcode = (data as { postal_barcode: string | null } | null)?.postal_barcode;
  if (!barcode) return;

  await markSpent(barcode, reason);

  await supabaseAdmin
    .from("orders")
    .update({ postal_barcode: null, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber)
    .eq("postal_barcode", barcode);
}
