export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getCourier } from "@/lib/db/couriers";
import { canSendAutomatically } from "@/lib/couriers";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { manifestParcels, type ManifestResult } from "@/lib/delhivery/manifest";
import { checkPincodes } from "@/lib/delhivery/serviceability";
import { DelhiveryError } from "@/lib/delhivery/client";
import {
  claimForSend,
  releaseClaim,
  markSendUncertain,
  recordSent,
} from "@/lib/db/courier-send";
import { auditMany } from "@/lib/audit";

/**
 * Hand picked parcels to their courier's API.
 *
 * Nothing here happens on a schedule or as a side effect of anything else —
 * this route runs when somebody presses a button, which is the whole point of
 * the design. Assigning a courier and sending to it are separate decisions.
 *
 * Gated on `delivery.assign`, not `delivery.portal`: a delivery agent keeps the
 * portal and the tick columns, but pushing parcels into a courier's system is
 * an owner's call. One line to widen if that changes.
 *
 * The order of operations is the interesting part, and it is not negotiable:
 * claim first, call second. See lib/db/courier-send.ts.
 */

const MAX_BATCH = 100;

export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? [
        ...new Set<string>(
          body.order_numbers.filter((n: unknown): n is string => typeof n === "string")
        ),
      ]
    : [];

  const courierId = typeof body.courier_id === "string" ? body.courier_id : "";

  if (!orderNumbers.length) {
    return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
  }
  if (orderNumbers.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `${MAX_BATCH} parcels at a time.` },
      { status: 400 }
    );
  }
  if (!courierId) {
    return NextResponse.json({ error: "No courier chosen" }, { status: 400 });
  }

  const courier = await getCourier(courierId);
  if (!courier) {
    return NextResponse.json({ error: "Unknown courier" }, { status: 400 });
  }

  // A courier we have not written an integration for. Says which, because the
  // fix differs: a `manual` partner is working as intended and the parcel just
  // gets handed over, while an `api` one with no adapter is a misconfiguration.
  if (!canSendAutomatically(courier)) {
    return NextResponse.json(
      {
        error:
          courier.handoff === "api"
            ? `${courier.name} is set to send automatically, but no integration has been written for it yet.`
            : `${courier.name} parcels are not sent from here — hand them over and enter the tracking number.`,
      },
      { status: 400 }
    );
  }

  // Everything Delhivery refuses to work without. Checked before a single
  // parcel is claimed, so an unconfigured account cannot leave rows locked.
  const { ready, missing, settings } = delhiveryReadiness(courier.config);
  if (!ready || !settings) {
    return NextResponse.json(
      {
        error: "Delhivery is not set up yet.",
        missing,
      },
      { status: 400 }
    );
  }

  // Claim, then call. A parcel that fails any of the sendable conditions simply
  // isn't in this list, and the difference is reported rather than swallowed.
  let claimed;
  try {
    claimed = await claimForSend(orderNumbers, courierId);
  } catch {
    return NextResponse.json({ error: "Could not prepare the parcels" }, { status: 500 });
  }

  if (!claimed.length) {
    return NextResponse.json(
      {
        error:
          "None of those parcels can be sent — they may already be with the courier, " +
          "or assigned to a different one. Refresh and try again.",
      },
      { status: 400 }
    );
  }

  // Drop anything Delhivery definitely won't deliver to, before they refuse
  // the batch over it. Advisory: a lookup that fails leaves the parcel in, and
  // the claim is given straight back so nothing is left locked.
  const unserviceable: { order_number: string; error: string }[] = [];
  let sendable = claimed;

  try {
    const checks = await checkPincodes(
      claimed.map((p) => (p.pincode ?? "").replace(/\D/g, "")),
      settings
    );

    sendable = [];
    for (const parcel of claimed) {
      const pin = (parcel.pincode ?? "").replace(/\D/g, "");
      if (checks.get(pin)?.serviceable === false) {
        const error = `Delhivery doesn't deliver to ${pin}.`;
        await releaseClaim(parcel.order_number, error);
        unserviceable.push({ order_number: parcel.order_number, error });
      } else {
        sendable.push(parcel);
      }
    }
  } catch (e) {
    // Never a reason to stop. Send everything claimed.
    console.warn("[Courier] serviceability check skipped:", e);
    sendable = claimed;
  }

  if (!sendable.length) {
    return NextResponse.json(
      {
        error: "Delhivery doesn't deliver to any of those addresses.",
        failed: unserviceable,
      },
      { status: 400 }
    );
  }

  const claimedNumbers = sendable.map((p) => p.order_number);

  // Per-parcel outcomes. Delhivery rejects individual shipments inside a batch
  // it otherwise accepted, so the successes and the failures both matter.
  const sent: string[] = [];
  // Order numbers, not just a count — needed below to work out which claimed
  // parcels onResult never got to, if the run breaks early.
  const heldNumbers: string[] = [];
  // Seeded with the addresses Delhivery doesn't reach, so one list answers
  // "what didn't go, and why" whatever the reason was.
  const failed: { order_number: string; error: string }[] = [...unserviceable];

  // Persisted the moment THIS parcel's own outcome is known, not after the
  // whole claimed batch finishes — see manifestParcels. Wrapped in its own
  // try/catch so a database hiccup recording one parcel can never stop the
  // others in the same run from being recorded at all.
  const onResult = async (r: ManifestResult) => {
    try {
      if (r.ok && r.waybill) {
        try {
          await recordSent(r.order_number, r.waybill);
          sent.push(r.order_number);
        } catch {
          // The parcel IS at Delhivery; only our bookkeeping failed. Keep the
          // claim and say so — releasing it would invite a duplicate send.
          await markSendUncertain(
            [r.order_number],
            `Delhivery accepted it (waybill ${r.waybill}) but we could not save that`
          );
          failed.push({
            order_number: r.order_number,
            error: `Sent, but not recorded. Waybill ${r.waybill} — enter it by hand.`,
          });
        }
      } else if (r.uncertain) {
        // Delhivery either could not say, or said the package might have been
        // saved. Releasing the claim here is what offers a second manifest
        // for a shipment that may already exist, and hands one customer two
        // parcels. Hold it; Sync now asks by order number and can settle it
        // either way.
        await markSendUncertain([r.order_number], r.error ?? "Outcome unknown");
        heldNumbers.push(r.order_number);
      } else {
        await releaseClaim(r.order_number, r.error ?? "Refused");
        failed.push({ order_number: r.order_number, error: r.error ?? "Refused" });
      }
    } catch (e) {
      // The claim stays either way — safer to leave a parcel looking
      // routed-but-unresolved than to risk a second manifest for one that may
      // already exist at Delhivery. Sync finds it from here.
      console.error("[Courier] could not record outcome for", r.order_number, e);
      markSendUncertain([r.order_number], "Outcome recorded late — check Sync").catch(() => {});
      heldNumbers.push(r.order_number);
    }
  };

  try {
    await manifestParcels(sendable, settings, onResult);
  } catch (e) {
    // manifestOne never throws, so reaching here means something broke before
    // any per-parcel outcome was even attempted — not a single parcel's send
    // failing, which onResult above already handled. Whatever onResult has
    // already recorded stands; only the parcels it never got to are unknown.
    const err = e instanceof DelhiveryError ? e : null;
    const settled = new Set([
      ...sent,
      ...heldNumbers,
      ...failed.map((f) => f.order_number),
    ]);
    const unresolved = claimedNumbers.filter((n) => !settled.has(n));

    if (!err || err.kind === "unknown") {
      await markSendUncertain(
        unresolved,
        err?.message ?? "The send did not complete"
      );
      console.error("[Courier] send outcome unknown:", unresolved, e);
      return NextResponse.json(
        {
          error:
            "We could not confirm what happened to some of these. They are " +
            "held until someone checks Delhivery — they may already be there.",
          sent: sent.length,
          held: heldNumbers.length + unresolved.length,
          failed,
        },
        { status: 502 }
      );
    }

    await Promise.all(unresolved.map((n) => releaseClaim(n, err.message)));
    console.error("[Courier] send rejected:", err.message, err.body);
    return NextResponse.json(
      { error: `Delhivery refused the rest of the batch: ${err.message}` },
      { status: 400 }
    );
  }

  if (sent.length) {
    await auditMany(auth.staff, "order.courier_sent", "order", sent, {
      courier: courier.slug,
      env: settings.env,
    });
  }

  const skipped = orderNumbers.length - claimed.length;

  return NextResponse.json({
    sent: sent.length,
    held: heldNumbers.length,
    failed,
    skipped,
    courier: courier.name,
    // Staging shipments are not real. Say so, or someone will wait for a van.
    env: settings.env,
  });
}
