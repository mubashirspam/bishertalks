import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  courierReference,
  referenceCandidates,
  type CourierParcel,
} from "@/lib/courier-sheet";
import { referenceCode, referenceIsPrivate, type Courier } from "@/lib/couriers";
import { takenReferences } from "@/lib/db/delivery-portal";

/**
 * Giving a parcel the number its courier will file it under.
 *
 * This used to happen when the Excel sheet was built, which made sense when a
 * sheet was the only way a parcel left. It does not any more: a parcel routed
 * to Delhivery and sent by API never touches a sheet, and until it was sent it
 * had no identifier at all — so a parcel could sit assigned for a day with
 * nothing to look it up by, on either side.
 *
 * Now it happens at assignment. Every routed parcel is identifiable
 * immediately, whichever way it eventually leaves, and the sheet builder finds
 * the number already there.
 *
 * Uniqueness is not optional: the courier rejects an entire upload file over
 * one repeated reference, and a duplicate would attach two orders to one
 * shipment. The number is the courier's code and the order number — unique by
 * construction, see `courierReference` — and the partial unique index from
 * 0024 is the backstop if two requests race.
 */

/** Enough of an order to build a reference from, and to know if it may change. */
const COLUMNS =
  "order_number,buyer_name,buyer_phone,address_line1,address_line2,city," +
  "district,state,pincode,amount_paise,quantity,courier_reference,courier_id," +
  // Read only to decide whether a stale reference may be re-coded. A number
  // anybody outside this system has seen is never rewritten.
  "tracking_number,courier_sent_at,courier_entered_at";

/**
 * Make sure each of these orders has the right reference for the courier now
 * carrying it. Returns how many were written.
 *
 * A number any courier has already seen never changes, so re-running this is
 * harmless. The one number that does change is a stale code on a parcel that
 * has not left yet — see `stale()`.
 */
export async function ensureReferences(
  orderNumbers: string[],
  /** Whose parcels these now are — the reference is coded per courier. */
  courier: Courier | null
): Promise<number> {
  if (!orderNumbers.length) return 0;

  const code = referenceCode(courier);

  // Everything in the batch, not only the ones with no reference: a parcel
  // re-routed to a different partner may be carrying the previous partner's
  // code, and `stale()` below decides whether that can safely be corrected.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(COLUMNS)
    .in("order_number", orderNumbers);

  if (error) {
    console.error("[Reference] lookup failed:", error.message);
    return 0;
  }

  const rows = (data ?? []) as unknown as Row[];

  // What each of them is carrying now, so the write below can be conditional on
  // it not having moved under us.
  const before = new Map(rows.map((r) => [r.order_number, r.courier_reference]));

  const parcels = rows
    .filter((r) => !r.courier_reference || stale(r, code, courier))
    // A stale one is re-minted, which means the builder must not be handed the
    // old number — it would keep it, which is exactly what it is for.
    .map((r) => ({ ...r, courier_reference: null })) as CourierParcel[];

  if (!parcels.length) return 0;

  // Which of the numbers this batch might want are already spoken for. Asked
  // once for the whole batch rather than per parcel: a hundred-odd strings
  // against a unique index, not a round trip each.
  let taken: string[];
  try {
    taken = await takenReferences(parcels.flatMap((p) => referenceCandidates(p, code)));
  } catch {
    console.error("[Reference] could not check which are taken — not minting");
    return 0;
  }

  const seen = new Set(taken);
  let minted = 0;

  for (const parcel of parcels) {
    const reference = courierReference(parcel, seen, code);
    seen.add(reference);

    // Conditional on the order still being where we read it, so two requests
    // racing over one parcel cannot overwrite each other — the loser writes
    // nothing. For a fresh mint that means the reference is still empty; for a
    // re-code it means the old number is still there and the parcel still has
    // not gone anywhere, so a hand-over that happened in between wins.
    const previous = before.get(parcel.order_number);

    let write = supabaseAdmin
      .from("orders")
      .update({ courier_reference: reference, updated_at: new Date().toISOString() })
      .eq("order_number", parcel.order_number);

    write = previous
      ? write
          .eq("courier_reference", previous)
          .is("tracking_number", null)
          .is("courier_sent_at", null)
          .is("courier_entered_at", null)
      : write.or("courier_reference.is.null,courier_reference.eq.");

    const { data: updated, error: writeError } = await write.select("order_number");

    if (writeError) {
      // A unique violation here means another request took this number between
      // our check and our write. Rare, self-correcting on the next assignment,
      // and never worth failing the whole routing action over.
      console.warn(
        `[Reference] ${parcel.order_number} could not take ${reference}:`,
        writeError.message
      );
      continue;
    }
    if (updated?.length) minted++;
  }

  return minted;
}

/** What the lookup above returns: a parcel, plus the handover facts. */
type Row = CourierParcel & {
  tracking_number: string | null;
  courier_sent_at: string | null;
  courier_entered_at: string | null;
};

/**
 * May this parcel's existing reference be replaced?
 *
 * Only when it belongs to a different courier than the one now carrying it,
 * and only when nobody outside this system has ever been shown it. Once a
 * parcel has a waybill, has been pushed, or has been on a downloaded sheet,
 * its number is the courier's too, and renaming it there is not something we
 * can do from here — so we do not do it here either.
 *
 * The case this exists for: a parcel routed to India Post, then moved to
 * Delhivery before it was posted. Without this it would go to Delhivery under
 * `SP-…`, which is the misleading label the code was introduced to end.
 */
function stale(row: Row, code: string, courier: Courier | null): boolean {
  const reference = row.courier_reference ?? "";
  if (!reference) return false;
  if (reference.startsWith(`${code}-`)) return false;

  // A waybill means the parcel is out there under a number somebody is
  // tracking, whoever is carrying it.
  if (row.tracking_number) return false;

  // A partner that never sees the reference cannot be confused by it changing.
  // Posting a parcel over a counter is `courier_entered_at` on a manual
  // courier, and it does not mean India Post has been told anything.
  if (referenceIsPrivate(courier)) return true;

  return !row.courier_sent_at && !row.courier_entered_at;
}
