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
import type { ParcelOutcome, RouteOutcome } from "@/lib/delivery/route-outcome";

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
 *
 * Every parcel named in the request comes back named in `results`, with what
 * became of it — see lib/delivery/route-outcome.ts. The counts are still there
 * and are now derived from that list rather than tallied alongside it, so the
 * summary and the per-parcel rows cannot disagree.
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
    .update({
      courier_id: courierId,
      // A new routing decision starts clean. Without this, a parcel the last
      // courier refused keeps that refusal after being moved to a different
      // one — it would still read `send_refused` (0044) and still show the old
      // courier's reason on the row, which is a lie about the courier now
      // carrying it. The claim is already null on everything reachable here:
      // `.is("courier_sent_at", null)` below is what makes that true.
      courier_send_error: null,
      updated_at: new Date().toISOString(),
    })
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

  // ── What became of each parcel ────────────────────────────────────────────
  // One entry per order number the caller named, refined as the run learns
  // more. Every parcel starts `skipped`, so one that fell out of the UPDATE
  // above — already sent, already gone — is reported as such rather than being
  // silently absent from the answer, which is how a run could appear to have
  // handled fifty parcels while touching thirty.
  const outcomes = new Map<string, ParcelOutcome>();
  for (const n of orderNumbers) {
    outcomes.set(n, {
      order_number: n,
      outcome: "skipped",
      waybill: null,
      error: null,
    });
  }

  const mark = (
    orderNumber: string,
    outcome: RouteOutcome,
    extra: { waybill?: string | null; error?: string | null } = {}
  ) => {
    const row = outcomes.get(orderNumber);
    // A number we never asked about cannot have an outcome. Should not happen —
    // everything below comes from `updated`, which is a subset — but silently
    // growing the ledger would make the totals lie.
    if (!row) return;
    row.outcome = outcome;
    if (extra.waybill !== undefined) row.waybill = extra.waybill;
    if (extra.error !== undefined) row.error = extra.error;
  };

  for (const n of updated) mark(n, courierId ? "routed" : "cleared");

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
    // happens to be built. Coded for this courier, so nobody else's tracking
    // can ever answer for it. Harmless to re-run: a number that has left the
    // building is kept.
    try {
      minted = await ensureReferences(updated, courier);
    } catch (e) {
      console.warn("[Courier] reference minting skipped:", e);
    }
  }

  for (const n of unserviceable) {
    mark(n, "unserviceable", {
      error: `${courierName ?? "This courier"} does not deliver to this pincode.`,
    });
  }

  // ── Hand them over ────────────────────────────────────────────────────────
  // Everything above is bookkeeping and can be redone. This part cannot: an
  // accepted shipment has to be cancelled with the courier, not undone here.
  //
  // Each branch below writes an outcome, and the vocabulary is deliberately
  // finer than the counters it replaced. The distinction that matters is not
  // "did it work" but "is the parcel at the courier": `save_failed` used to be
  // reported as a refusal, which told someone to send a parcel that was already
  // on its way. See lib/delivery/route-outcome.ts.
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

    // Parcels the claim would not take. `claimForSend` re-asserts everything
    // that makes a parcel sendable — paid, confirmed, addressed, not already at
    // a courier — so a parcel missing here is one this screen believed was
    // ready and the database did not. It stays routed, which is the truth, and
    // now says so instead of vanishing from the report.
    const claimedSet = new Set(claimed.map((p) => p.order_number));
    for (const n of sendable) {
      if (claimedSet.has(n)) continue;
      mark(n, "routed", {
        error:
          "Routed, but not handed over — it is already at a courier, or no " +
          "longer paid, confirmed and addressed.",
      });
    }

    if (claimed.length) {
      const numbers = claimed.map((p) => p.order_number);
      try {
        const results = await manifestParcels(claimed, readiness.settings);

        for (const r of results) {
          if (r.ok && r.waybill) {
            try {
              await recordSent(r.order_number, r.waybill);
              // `adopted` is not a lesser `sent`: nothing was created for it.
              // Reporting it as sent would claim an action that never happened
              // and hide the fact that a previous run had already succeeded
              // without us noticing.
              mark(r.order_number, r.adopted ? "adopted" : "sent", {
                waybill: r.waybill,
              });
            } catch {
              // At the courier, but our note of it failed. Keep the claim:
              // releasing it would invite a duplicate shipment.
              //
              // This is the case that used to be filed as a refusal. It is the
              // opposite of one — the shipment exists, only our record is
              // missing — and Sync repairs it by asking Delhivery for the
              // waybill under the order number we sent.
              await markSendUncertain(
                [r.order_number],
                `Accepted (waybill ${r.waybill}) but we could not save that`
              );
              mark(r.order_number, "save_failed", {
                waybill: r.waybill,
                error: `Accepted as waybill ${r.waybill}, but saving it here failed.`,
              });
            }
          } else if (r.uncertain) {
            // Delhivery said the package might have been saved. Holding it is
            // the only safe reading: releasing would offer a second manifest
            // for a shipment that may already exist.
            await markSendUncertain([r.order_number], r.error ?? "Outcome unknown");
            mark(r.order_number, "held", { error: r.error ?? "Outcome unknown" });
          } else {
            await releaseClaim(r.order_number, r.error ?? "Refused");
            mark(r.order_number, "refused", { error: r.error ?? "Refused" });
          }
        }
      } catch (e) {
        const err = e instanceof DelhiveryError ? e : null;
        if (!err || err.kind === "unknown") {
          // We never found out. The claim stays: this is exactly the case
          // where the shipment probably does exist.
          const reason = err?.message ?? "The send did not complete";
          await markSendUncertain(numbers, reason);
          for (const n of numbers) mark(n, "held", { error: reason });
          console.error("[Courier] send outcome unknown:", numbers, e);
        } else {
          await Promise.all(numbers.map((n) => releaseClaim(n, err.message)));
          for (const n of numbers) mark(n, "refused", { error: err.message });
        }
      }
    }
  }

  // Counted off the ledger rather than tallied beside it, so the summary and
  // the per-parcel rows are the same facts read two ways and cannot disagree.
  const results = [...outcomes.values()];
  const count = (o: RouteOutcome) => results.filter((r) => r.outcome === o).length;

  await auditMany(auth.staff, "order.courier_assigned", "order", updated, {
    courier_id: courierId,
    courier_name: courierName,
    unserviceable: unserviceable.length,
    sent: count("sent"),
  });

  return NextResponse.json({
    // Every parcel the caller named, and what became of it. The screen draws
    // one row per entry; everything below is that same list counted.
    results,

    updated: updated.length,
    sent: count("sent"),
    adopted: count("adopted"),
    held: count("held"),
    // Accepted by the courier but not written down here. Kept apart from
    // `failed` on purpose — these parcels are on their way, and offering them
    // to another courier would be the expensive mistake.
    save_failed: count("save_failed"),
    failed: results
      .filter((r) => r.outcome === "refused")
      .map((r) => ({ order_number: r.order_number, error: r.error ?? "Refused" })),
    // Already-sent parcels that were skipped, so the message can say so rather
    // than reporting a smaller number with no explanation.
    skipped: count("skipped"),
    courier_name: courierName,
    references: minted,
    // The ones this courier cannot deliver. Named, not just counted, so the
    // screen can offer to move them somewhere else.
    unserviceable,
  });
}
