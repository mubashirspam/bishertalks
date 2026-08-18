export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCourier } from "@/lib/db/couriers";
import { auditMany } from "@/lib/audit";
import { ensureReferences } from "@/lib/db/courier-reference";
import { serviceabilityFor, recordServiceability } from "@/lib/db/serviceability";
import { canSendAutomatically } from "@/lib/couriers";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { manifestParcels } from "@/lib/delhivery/manifest";
import { DelhiveryError } from "@/lib/delhivery/client";
import {
  claimForSend,
  releaseClaim,
  markSendUncertain,
  recordSent,
} from "@/lib/db/courier-send";

/**
 * Route a batch of parcels, and hand them over.
 *
 * One request does the three things that were three decisions:
 *
 *   1. sets the courier, so the parcel is somebody's
 *   2. gives it a reference and checks the pincode, so it is workable
 *   3. hands it to the courier, so it exists at their end
 *
 * They were deliberately separate at first — assign today, dispatch when the
 * parcel is actually packed — and that was the wrong shape for this shop, where
 * both happen in the same motion and splitting them meant parcels sitting
 * routed-but-nowhere while everybody assumed they had gone.
 *
 * `send: false` still assigns without dispatching, for a parcel someone wants
 * to route ahead of time. Clearing the courier never sends.
 *
 * On the manifestation question: Delhivery's only way to receive an order is
 * /api/cmu/create.json, which assigns a waybill in the same response. There is
 * no push-without-manifest. The parcels land in KKR LOGISTICS FRANCHISE's own
 * account under their pickup location, and KKR prints and collects them as
 * usual — the step this removes is the typing, not their work.
 *
 *   { order_numbers: [...], courier_id: "uuid" }               route and send
 *   { order_numbers: [...], courier_id: "uuid", send: false }  route only
 *   { order_numbers: [...], courier_id: null }                 clear
 */

const MAX_BATCH = 300;

export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? body.order_numbers.filter((n: unknown): n is string => typeof n === "string")
    : [];

  if (!orderNumbers.length) {
    return NextResponse.json({ error: "No orders selected" }, { status: 400 });
  }
  if (orderNumbers.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Too many orders — ${MAX_BATCH} at a time` },
      { status: 400 }
    );
  }

  const courierId = typeof body.courier_id === "string" ? body.courier_id : null;

  // Check the target against the list rather than trusting an id off the wire,
  // the same way the agent assignment does.
  let courierName: string | null = null;
  if (courierId) {
    const courier = await getCourier(courierId);
    if (!courier) {
      return NextResponse.json({ error: "Unknown courier" }, { status: 400 });
    }
    if (!courier.is_active) {
      return NextResponse.json(
        { error: `${courier.name} is switched off — turn it back on first.` },
        { status: 400 }
      );
    }
    courierName = courier.name;
  }

  // A parcel already at the courier keeps the courier that has it. Changing the
  // label on a shipment somebody else is already carrying would leave the two
  // systems describing different journeys — cancel it with them first.
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ courier_id: courierId, updated_at: new Date().toISOString() })
    .in("order_number", orderNumbers)
    .is("courier_sent_at", null)
    .select("order_number,pincode");

  if (error) {
    console.error("[Courier] assign failed:", error.message);
    return NextResponse.json({ error: "Could not set the courier" }, { status: 500 });
  }

  const updated = (data ?? []).map(
    (r) => (r as { order_number: string; pincode: string | null }).order_number
  );

  // Everything below is routing consequence, not routing itself. The courier
  // is already written; these fill in what the parcel needs to be worked on,
  // and none of them may fail the assignment.
  let minted = 0;
  let unserviceable: string[] = [];

  if (courierId && updated.length) {
    const courier = await getCourier(courierId);

    // Can this courier actually reach these addresses? Asked now, in one
    // batch, rather than discovered in a rejected upload after someone packed
    // them. Cached per (courier, pincode), so a day of Kozhikode parcels is
    // one question.
    if (courier) {
      const rows = (data ?? []) as { order_number: string; pincode: string | null }[];
      try {
        const answers = await serviceabilityFor(
          courier,
          rows.map((r) => r.pincode ?? "")
        );

        const yes: string[] = [];
        for (const row of rows) {
          const pin = (row.pincode ?? "").replace(/\D/g, "");
          const answer = answers.get(pin)?.serviceable;
          if (answer === true) yes.push(row.order_number);
          else if (answer === false) unserviceable.push(row.order_number);
          // undefined stays unknown — the state derivation reads that as
          // "checking", not as a refusal.
        }
        if (yes.length) await recordServiceability(yes, true);
        if (unserviceable.length) await recordServiceability(unserviceable, false);
      } catch (e) {
        // Never blocks routing. A courier we could not ask is not a courier
        // that cannot deliver.
        console.warn("[Courier] serviceability check skipped:", e);
      }
    }

    // Give every routed parcel the number its courier will file it under, so
    // it is identifiable from this moment rather than from whenever a sheet
    // happens to be built. Harmless to re-run: an existing number is kept.
    try {
      minted = await ensureReferences(updated);
    } catch (e) {
      console.warn("[Courier] reference minting skipped:", e);
    }
  }

  // ── Hand them over ────────────────────────────────────────────────────────
  // Everything above is bookkeeping and can be redone. This part cannot: an
  // accepted shipment has to be cancelled with the courier, not undone here.
  const sent: string[] = [];
  const failed: { order_number: string; error: string }[] = [];
  let held = 0;

  const wantsSend = body.send !== false && courierId && updated.length;
  const courier = wantsSend ? await getCourier(courierId) : null;
  const readiness = courier ? delhiveryReadiness(courier.config) : null;

  if (courier && canSendAutomatically(courier) && readiness?.ready && readiness.settings) {
    // Parcels the courier cannot reach were released above and must not be
    // offered to them; everything else that survived the claim goes.
    const sendable = updated.filter((n) => !unserviceable.includes(n));

    let claimed: Awaited<ReturnType<typeof claimForSend>> = [];
    try {
      claimed = await claimForSend(sendable, courierId);
    } catch {
      console.error("[Courier] claim failed — parcels routed but not sent");
    }

    if (claimed.length) {
      const numbers = claimed.map((p) => p.order_number);
      try {
        const results = await manifestParcels(claimed, readiness.settings);

        for (const r of results) {
          if (r.ok && r.waybill) {
            try {
              await recordSent(r.order_number, r.waybill);
              sent.push(r.order_number);
            } catch {
              // At the courier, but our note of it failed. Keep the claim:
              // releasing it would invite a duplicate shipment.
              await markSendUncertain(
                [r.order_number],
                `Accepted (waybill ${r.waybill}) but we could not save that`
              );
              failed.push({
                order_number: r.order_number,
                error: `Sent — waybill ${r.waybill}. Enter it by hand.`,
              });
            }
          } else if (r.uncertain) {
            // Delhivery said the package might have been saved. Holding it is
            // the only safe reading: releasing would offer a second manifest
            // for a shipment that may already exist.
            await markSendUncertain([r.order_number], r.error ?? "Outcome unknown");
            held++;
          } else {
            await releaseClaim(r.order_number, r.error ?? "Refused");
            failed.push({ order_number: r.order_number, error: r.error ?? "Refused" });
          }
        }
      } catch (e) {
        const err = e instanceof DelhiveryError ? e : null;
        if (!err || err.kind === "unknown") {
          // We never found out. The claim stays: this is exactly the case
          // where the shipment probably does exist.
          await markSendUncertain(numbers, err?.message ?? "The send did not complete");
          held = numbers.length;
          console.error("[Courier] send outcome unknown:", numbers, e);
        } else {
          await Promise.all(numbers.map((n) => releaseClaim(n, err.message)));
          for (const n of numbers) failed.push({ order_number: n, error: err.message });
        }
      }
    }
  }

  await auditMany(auth.staff, "order.courier_assigned", "order", updated, {
    courier_id: courierId,
    courier_name: courierName,
    unserviceable: unserviceable.length,
    sent: sent.length,
  });

  return NextResponse.json({
    updated: updated.length,
    sent: sent.length,
    failed,
    held,
    // Already-sent parcels that were skipped, so the message can say so rather
    // than reporting a smaller number with no explanation.
    skipped: orderNumbers.length - updated.length,
    courier_name: courierName,
    references: minted,
    // The ones this courier cannot deliver. Named, not just counted, so the
    // screen can offer to move them somewhere else.
    unserviceable,
  });
}
