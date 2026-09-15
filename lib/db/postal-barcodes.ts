import { supabaseAdmin } from "@/lib/supabase/admin";
import { listCouriers } from "@/lib/db/couriers";
import { articleNumber, isValidArticleNumber } from "@/lib/india-post/article-number";
import { inBatches, WRITE_CONCURRENCY } from "@/lib/concurrency";

/**
 * The article-number stock, and taking numbers out of it.
 *
 * Migration 0049. The rule everything here exists to protect:
 *
 *   **Only explicitly released, unbooked numbers return to stock (0081).**
 *   Never on a refused booking, never on
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
}): Promise<
  | {
      ok: true;
      /** How many numbers were actually stored. */
      count: number;
      /** How many separate sub-ranges it had to be broken into. */
      parts: number;
      /** How many of the numbers asked for were already recorded. */
      alreadyHeld: number;
    }
  | { ok: false; error: string }
> {
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

  // ── Load the parts we do not already hold, not nothing ────────────────────
  //
  // Their "Allocated Barcodes" export is cumulative: every upload carries the
  // numbers from the last one too. So a block in the file routinely straddles a
  // range already recorded, and the exclusion constraint from 0049 refuses on
  // ANY overlap — which used to throw away the new numbers either side of the
  // old range along with the duplicate middle.
  //
  // That is not a hypothetical tidy-up. The 04/09 upload skipped
  // CL669228010IN–CL669228726IN whole because 36 of its 72 numbers were already
  // held from 30/08; the other 36 were allotted to us, paid for, and silently
  // never loaded. The message said "overlaps one already recorded", which is
  // true and reads exactly like the 53 skips that really were pure duplicates.
  //
  // So subtract what is recorded and insert the gaps. Duplicates still cannot
  // be stored twice; the difference is only that the numbers we do not have
  // stop being collateral.
  //
  // Matched on prefix+suffix ACROSS COURIERS, because that is how the
  // constraint is scoped — an article number belongs to an allotment, not to
  // whoever posts under it — so subtracting only this courier's ranges would
  // compute a gap the database then refuses.
  const { data: existing, error: readError } = await supabaseAdmin
    .from("postal_barcode_ranges")
    .select("serial_from,serial_to")
    .eq("prefix", prefix)
    .eq("suffix", suffix)
    .lte("serial_from", to)
    .gte("serial_to", from);

  if (readError) {
    console.error("[Postal] range read failed:", readError.message);
    return { ok: false, error: "Could not check the range against the ones already recorded." };
  }

  const held = (existing ?? [])
    .map((r) => ({ from: Number(r.serial_from), to: Number(r.serial_to) }))
    .sort((a, b) => a.from - b.from);

  const gaps: { from: number; to: number }[] = [];
  let cursor = from;
  for (const h of held) {
    if (h.from > cursor) gaps.push({ from: cursor, to: Math.min(h.from - 1, to) });
    cursor = Math.max(cursor, h.to + 1);
    if (cursor > to) break;
  }
  if (cursor <= to) gaps.push({ from: cursor, to });

  const alreadyHeld = to - from + 1 - gaps.reduce((n, g) => n + g.to - g.from + 1, 0);

  if (!gaps.length) {
    return { ok: false, error: "Every number in that range is already recorded." };
  }

  const { error } = await supabaseAdmin.from("postal_barcode_ranges").insert(
    gaps.map((g) => ({
      courier_id: input.courierId,
      prefix,
      suffix,
      serial_from: g.from,
      serial_to: g.to,
      next_serial: g.from,
      note: input.note?.trim() || null,
    }))
  );

  if (error) {
    // Still reachable: another upload can record a range between the read
    // above and this insert. The constraint is the backstop, and the fix is to
    // run the upload again — the second pass subtracts what the first stored.
    if (/exclusion|overlap/i.test(error.message)) {
      return {
        ok: false,
        error: "That range overlaps one recorded while this file was loading — upload it again.",
      };
    }
    console.error("[Postal] range insert failed:", error.message);
    return { ok: false, error: "Could not save the range." };
  }

  return {
    ok: true,
    count: gaps.reduce((n, g) => n + g.to - g.from + 1, 0),
    parts: gaps.length,
    alreadyHeld,
  };
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
  const { data: eligible, error: eligibilityError } = await supabaseAdmin.from("orders")
    .select("order_number").in("order_number", orderNumbers)
    .eq("courier_id", courierId).is("courier_service", null);
  if (eligibilityError) throw new Error("Could not check postal services");
  orderNumbers = (eligible ?? []).map(row => row.order_number);
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

  let needing = orderNumbers.filter((n) => !held.has(n));
  if (!needing.length) return { allocated, shortfall: 0 };

  // Claim against whoever holds the ranges, which is not always the courier
  // carrying the parcel — see postalStockOwner. Resolved once here rather than
  // inside the loop: the answer cannot change mid-batch, and asking per
  // iteration would put a courier read between two claims.
  const stockOwner = await postalStockOwner(courierId);

  const { data: reused, error: reuseError } = await supabaseAdmin.rpc("claim_reusable_postal_articles", {
    p_courier_id: stockOwner, p_order_numbers: needing,
  });
  // Existing allocation remains available while migration 0081 is being deployed.
  if (reuseError && reuseError.code !== "PGRST202") {
    throw new Error(`Could not check reusable articles: ${reuseError.message}`);
  }
  for (const row of reused ?? []) {
    allocated.push({ orderNumber: row.order_number, barcode: row.barcode });
    held.set(row.order_number, row.barcode);
  }
  needing = needing.filter((n) => !held.has(n));
  if (!needing.length) return { allocated, shortfall: 0 };


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
  //
  // Pairing is fixed up front — the Nth parcel still needing a number gets
  // the Nth number claimed, exactly as the sequential loop did — so only the
  // waiting changes: each pair's writes touch its own order and its own
  // barcode row, and run alongside the others.
  const pairs = needing
    .slice(0, minted.length)
    .map((orderNumber, i) => ({ orderNumber, barcode: minted[i] }));
  const attached: (AllocatedBarcode | null)[] = pairs.map(() => null);

  await inBatches(pairs, WRITE_CONCURRENCY, async ({ orderNumber, barcode }, i) => {
    const { data: updated, error } = await supabaseAdmin
      .from("orders")
      .update({ postal_barcode: barcode, updated_at: new Date().toISOString() })
      .eq("order_number", orderNumber)
      .is("postal_barcode", null)
      .select("order_number");

    if (error) {
      console.error(`[Postal] ${orderNumber} could not take ${barcode}:`, error.message);
      await markSpent(barcode, `Could not attach to ${orderNumber}: ${error.message}`);
      return;
    }

    if (!updated?.length) {
      // Another request got there first. Its number stands; ours is spent.
      await markSpent(barcode, `${orderNumber} already had a number`);
      return;
    }

    await supabaseAdmin
      .from("postal_barcodes")
      .update({ order_number: orderNumber })
      .eq("barcode", barcode);

    attached[i] = { orderNumber, barcode };
  });

  // Same order as before: already-held numbers first, then new ones in
  // parcel order.
  for (const a of attached) if (a) allocated.push(a);

  // Every pair was attempted, attached or spent — the same count the loop's
  // `used` reached before it ran out of numbers.
  const used = pairs.length;
  return { allocated, shortfall: needing.length - used };
}

/** Replace a postal article atomically and return an unbooked allotment to stock. */
export async function setManualArticleNumber(
  orderNumber: string,
  value: string
): Promise<{ ok: true; barcode: string; released: string | null } | { ok: false; error: string }> {
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

  const { data, error } = await supabaseAdmin.rpc("replace_postal_article", {
    p_order_number: orderNumber,
    p_barcode: barcode,
  });
  if (error) return { ok: false, error: error.code === "PGRST202"
    ? "Article replacement needs database migration 0081. Apply it before replacing this number."
    : error.message };
  return { ok: true, barcode, released: data?.released ?? null };
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
