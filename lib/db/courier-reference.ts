import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  courierReference,
  referenceCandidates,
  type CourierParcel,
} from "@/lib/courier-sheet";
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
 * shipment. `courierReference` walks candidates — five digits of the mobile,
 * then six, then all of it, then an order-number suffix that cannot collide —
 * and the partial unique index from 0024 is the backstop if two requests race.
 */

/** Enough of an order to build a reference from. */
const COLUMNS =
  "order_number,buyer_name,buyer_phone,address_line1,address_line2,city," +
  "district,state,pincode,amount_paise,quantity,courier_reference";

/**
 * Make sure each of these orders has a reference. Returns how many were minted.
 *
 * Orders that already have one keep it — a number the courier has already seen
 * must never change, and re-running this is therefore harmless.
 */
export async function ensureReferences(orderNumbers: string[]): Promise<number> {
  if (!orderNumbers.length) return 0;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(COLUMNS)
    .in("order_number", orderNumbers)
    .or("courier_reference.is.null,courier_reference.eq.");

  if (error) {
    console.error("[Reference] lookup failed:", error.message);
    return 0;
  }

  const parcels = (data ?? []) as unknown as CourierParcel[];
  if (!parcels.length) return 0;

  // Which of the numbers this batch might want are already spoken for. Asked
  // once for the whole batch rather than per parcel: a hundred-odd strings
  // against a unique index, not a round trip each.
  let taken: string[];
  try {
    taken = await takenReferences(parcels.flatMap(referenceCandidates));
  } catch {
    console.error("[Reference] could not check which are taken — not minting");
    return 0;
  }

  const seen = new Set(taken);
  let minted = 0;

  for (const parcel of parcels) {
    const reference = courierReference(parcel, seen);
    seen.add(reference);

    // Conditional on it still being empty, so two requests racing over the
    // same order cannot overwrite each other — the loser writes nothing.
    const { data: updated, error: writeError } = await supabaseAdmin
      .from("orders")
      .update({ courier_reference: reference, updated_at: new Date().toISOString() })
      .eq("order_number", parcel.order_number)
      .or("courier_reference.is.null,courier_reference.eq.")
      .select("order_number");

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
