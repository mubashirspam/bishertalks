import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CourierParcel } from "@/lib/courier-sheet";

/**
 * Claiming parcels before they are sent, and recording what happened after.
 *
 * The problem this solves: a manifest call that times out may still have
 * created the shipment. If the parcel looks unsent afterwards, someone presses
 * the button again and the customer gets two parcels, two waybills and one
 * book. So a parcel is claimed *before* the call, not marked after it:
 *
 *   claim    → courier_sent_at = now, conditional on it being null.
 *              Only one caller can win. The claim is the permission to call.
 *   success  → the waybill is written, the claim stands.
 *   rejected → Delhivery definitely said no. Release the claim, record why,
 *              and the parcel is sendable again.
 *   unknown  → we never found out. KEEP the claim, record that nobody knows.
 *              A human checks Delhivery's dashboard and decides.
 *
 * That last branch is the whole point. Releasing on an unknown would be the
 * convenient choice and the wrong one — it is exactly the case where the
 * shipment probably does exist.
 *
 * Same shape as `claimPaidTransition` in lib/payment-claim.ts, for the same
 * reason: a conditional UPDATE is the only lock we need.
 */

/** What the sheet builder needs, plus the id we send to Delhivery. */
const PARCEL_COLUMNS =
  "order_number,buyer_name,buyer_phone,address_line1,address_line2,city," +
  "district,state,pincode,amount_paise,quantity,courier_reference";

/**
 * Take the parcels that are genuinely sendable, and claim them in one statement.
 *
 * The order numbers from the browser are a filter, never the scope: everything
 * that makes a parcel sendable is re-asserted here, so a page open since this
 * morning cannot send a parcel that has since been cancelled, refunded,
 * reassigned to another courier, or already sent.
 *
 * Returns the parcels now claimed — which may be fewer than were asked for, and
 * that difference is worth reporting rather than swallowing.
 */
export async function claimForSend(
  orderNumbers: string[],
  courierId: string
): Promise<CourierParcel[]> {
  if (!orderNumbers.length) return [];

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      courier_sent_at: new Date().toISOString(),
      courier_send_error: null,
      updated_at: new Date().toISOString(),
    })
    .in("order_number", orderNumbers)
    .eq("courier_id", courierId)
    .eq("payment_status", "paid")
    .eq("status", "confirmed")
    .not("address_line1", "is", null)
    // The claim itself. A parcel already sent has a timestamp here, and this
    // is what stops a second send.
    .is("courier_sent_at", null)
    // And a parcel that already carries a waybill is already with the courier,
    // however it got there. Without this, the 571 parcels KKR uploaded on a
    // spreadsheet — which have waybills but no courier_sent_at, because we
    // never made that call — could be manifested a second time and come back
    // with a second waybill for one book. courier_sent_at alone only knows
    // about sends *we* made.
    .or("tracking_number.is.null,tracking_number.eq.")
    .select(PARCEL_COLUMNS);

  if (error) {
    console.error("[Courier] claim failed:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as CourierParcel[];
}

/**
 * Give a claim back, because Delhivery definitely refused this parcel.
 *
 * Only ever called for a *rejected* result. The error is kept so the admin can
 * see why without going through the logs.
 */
export async function releaseClaim(
  orderNumber: string,
  reason: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      courier_sent_at: null,
      courier_send_error: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber);

  if (error) console.error("[Courier] release failed:", orderNumber, error.message);
}

/**
 * Keep the claim, but say that nobody knows whether it worked.
 *
 * For the unknown case only. The parcel stays unsendable on purpose — someone
 * has to look at Delhivery's dashboard, and the message says so, because an
 * error a person cannot act on is just noise.
 */
export async function markSendUncertain(
  orderNumbers: string[],
  reason: string
): Promise<void> {
  if (!orderNumbers.length) return;

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      courier_send_error:
        `${reason} — check Delhivery before sending again; it may already be there.`.slice(
          0,
          500
        ),
      updated_at: new Date().toISOString(),
    })
    .in("order_number", orderNumbers);

  if (error) console.error("[Courier] uncertain mark failed:", error.message);
}

/**
 * A parcel Delhivery accepted.
 *
 * The waybill goes into `tracking_number` — the column the customer's tracking
 * page reads and the "shipped" WhatsApp quotes — and `courier_entered_at` is
 * set with the same meaning it has always had: this parcel is with the courier.
 * That keeps the portal's New/Confirmed filters honest across every handoff.
 *
 * COALESCE on courier_entered_at is deliberate: a parcel someone had already
 * ticked keeps the moment it really happened.
 */
export async function recordSent(
  orderNumber: string,
  waybill: string
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_courier_sent", {
    p_order_number: orderNumber,
    p_waybill: waybill,
  });

  if (error) {
    console.error("[Courier] recordSent failed:", orderNumber, error.message);
    throw new Error(error.message);
  }
}

/**
 * Parcels that went out on a spreadsheet and have no waybill stored.
 *
 * The whole back catalogue: KKR uploaded these to Delhivery by hand, so they
 * have real waybills and real scans — we just never learned them, because the
 * Excel handoff gives nothing back. `courier_reference` is the Reference No
 * printed on that sheet, and Delhivery indexes on it, so it is the key that
 * unlocks a year of tracking nobody had to type in.
 *
 * Ordered newest first: an old delivered parcel has nothing left to tell us,
 * and today's is the one someone is being asked about on the phone.
 */
export async function unmatchedSheetParcels(limit = 200): Promise<
  { order_number: string; courier_reference: string }[]
> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number,courier_reference")
    .not("courier_reference", "is", null)
    // `neq ""` as well as `is null`: an agent saving an empty tracking box
    // stores an empty string, which is not the same as never having one.
    .or("tracking_number.is.null,tracking_number.eq.")
    .not("status", "in", "(delivered,returned,cancelled)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[Courier] unmatched sheet lookup failed:", error.message);
    return [];
  }
  return (data ?? []) as { order_number: string; courier_reference: string }[];
}

/**
 * Store the waybill we learned for a parcel that went out on a sheet.
 *
 * Deliberately not `recordSent`: that one means "we handed this to the courier
 * just now" and stamps courier_entered_at. These parcels were handed over long
 * ago and already have that timestamp from when the sheet was downloaded —
 * this only fills in the number we were missing.
 */
export async function attachWaybill(
  orderNumber: string,
  waybill: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("orders")
    .update({ tracking_number: waybill, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber)
    .or("tracking_number.is.null,tracking_number.eq.");

  if (error) console.error("[Courier] waybill attach failed:", orderNumber, error.message);
}

/** Waybills we are still waiting on a terminal scan for. */
export async function trackableParcels(limit = 200): Promise<
  { order_number: string; tracking_number: string }[]
> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number,tracking_number")
    .not("tracking_number", "is", null)
    .neq("tracking_number", "")
    .not("courier_sent_at", "is", null)
    // Terminal states have nothing left to learn.
    .not("status", "in", "(delivered,returned,cancelled)")
    .order("courier_sent_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[Courier] trackable lookup failed:", error.message);
    return [];
  }
  return (data ?? []) as { order_number: string; tracking_number: string }[];
}

/** Store the latest scan against an order, for the screens to show. */
export async function recordScan(
  orderNumber: string,
  description: string,
  at: string | null
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      courier_last_scan: description.slice(0, 300),
      courier_last_scan_at: at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber);

  if (error) console.error("[Courier] scan record failed:", orderNumber, error.message);
}
