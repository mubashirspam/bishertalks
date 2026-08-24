import { supabaseAdmin } from "@/lib/supabase/admin";
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
 * How many numbers are left, for the admin panel and the low-stock warning.
 *
 * Reads the view rather than counting rows: "unused" means what the range
 * cursors say is left, and deriving it a second way is how two screens come to
 * disagree about whether we are about to run out.
 */
export async function barcodeStock(courierId: string): Promise<{
  unused: number;
  allotted: number;
  openRanges: number;
}> {
  const { data, error } = await supabaseAdmin
    .from("postal_barcode_stock")
    .select("unused,allotted,open_ranges")
    .eq("courier_id", courierId)
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

  // Claim from as many ranges as it takes. One statement per range; the loop
  // exists because an allotment can be split across several and the last one
  // may have three numbers left.
  const minted: string[] = [];
  let remaining = needing.length;

  while (remaining > 0) {
    const { data, error } = await supabaseAdmin.rpc("claim_postal_serials", {
      p_courier_id: courierId,
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
