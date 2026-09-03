export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCourier } from "@/lib/db/couriers";
import { auditMany } from "@/lib/audit";
import { ensureReferences } from "@/lib/db/courier-reference";
import { allocateBarcodes } from "@/lib/db/postal-barcodes";
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
  let routedCourier: Awaited<ReturnType<typeof getCourier>> = null;
  if (courierId) {
    routedCourier = await getCourier(courierId);
    if (!routedCourier) {
      return NextResponse.json({ error: "Unknown courier" }, { status: 400 });
    }
    if (!routedCourier.is_active) {
      return NextResponse.json(
        { error: `${routedCourier.name} is switched off — turn it back on first.` },
        { status: 400 }
      );
    }
    courierName = routedCourier.name;
  }

  // ── Refuse before assigning, for a courier that asks to be protected ──────
  //
  // The ordinary path routes first and reports serviceability afterwards. A
  // courier carrying `require_serviceable` wants the opposite: a parcel it
  // cannot deliver must not become its parcel at all, so the question is asked
  // here, before a single row is written.
  //
  // Why this way round matters: routing is what puts a parcel on the courier's
  // sheet, and for a manual channel the sheet IS the handover. Marking a
  // routed parcel `unserviceable` after the fact relies on somebody reading
  // the report; leaving it unassigned puts it back in front of whoever is
  // routing, which is the only place the decision can actually be changed.
  //
  // Only a definite `false` refuses. Unknown routes, exactly as everywhere
  // else — see the note on `require_serviceable`.
  const refusedForPincode = new Map<string, string>();
  let preChecked: Awaited<ReturnType<typeof serviceabilityFor>> | null = null;

  if (courierId && routedCourier?.config.require_serviceable) {
    const { data: candidates } = await supabaseAdmin
      .from("orders")
      .select("order_number,pincode")
      .in("order_number", orderNumbers)
      .is("courier_sent_at", null);

    const rows = (candidates ?? []) as { order_number: string; pincode: string | null }[];

    try {
      preChecked = await serviceabilityFor(
        routedCourier,
        rows.map((r) => r.pincode ?? "")
      );

      for (const row of rows) {
        const pin = (row.pincode ?? "").replace(/\D/g, "");
        if (preChecked.get(pin)?.serviceable === false) {
          refusedForPincode.set(
            row.order_number,
            `${routedCourier.name} does not deliver to ${pin || "this pincode"} — not assigned.`
          );
        }
      }
    } catch (e) {
      // Fails open, loudly. A lookup we could not complete is not a refusal,
      // and a day's parcels must not stop because a secondary API was down.
      console.warn("[Courier] pre-routing serviceability check skipped:", e);
    }
  }

  // What the UPDATE below is allowed to touch.
  const requested = refusedForPincode.size
    ? orderNumbers.filter((n) => !refusedForPincode.has(n))
    : orderNumbers;

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
      // When this parcel became this courier's (0057), and who decided.
      //
      // Stamped on every routing decision including a re-route, because the
      // question the reports screen asks is "what did I hand to Delhivery on
      // the 24th" — and a parcel moved from Speed Post to Delhivery on the
      // 24th belongs in that answer, under its new courier, on the day it
      // moved. Cleared alongside the courier for the same reason: an unrouted
      // parcel was assigned to nobody, on no date.
      courier_assigned_at: courierId ? new Date().toISOString() : null,
      courier_assigned_by: courierId ? (auth.staff?.id ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .in("order_number", requested)
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

  // Refused before they were ever assigned. Reported in the same vocabulary as
  // a post-hoc refusal so the screen needs no second case — the difference is
  // that these parcels still have whatever courier they had before, which is
  // the point.
  for (const [n, reason] of refusedForPincode) mark(n, "unserviceable", { error: reason });

  // Everything below is routing consequence, not routing itself. The courier
  // is already written; these fill in what the parcel needs to be worked on,
  // and none of them may fail the assignment.
  let minted = 0;
  /** Article numbers handed out on this run, and how many could not be. */
  let articles = 0;
  let articleShortfall = 0;
  let unserviceable: string[] = [];

  if (courierId && updated.length) {
    const courier = routedCourier;

    // Can this courier actually reach these addresses? Asked now, in one
    // batch, rather than discovered in a rejected upload after someone packed
    // them. Cached per (courier, pincode), so a day of Kozhikode parcels is
    // one question.
    if (courier) {
      const rows = (data ?? []) as { order_number: string; pincode: string | null }[];
      try {
        // Already answered above when the courier demanded it. Reused rather
        // than re-asked: the cache would make a second call cheap, but two
        // lookups in one request could disagree, and then the parcel that was
        // routed and the parcel that was recorded would be different parcels.
        const answers =
          preChecked ??
          (await serviceabilityFor(
            courier,
            rows.map((r) => r.pincode ?? "")
          ));

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

    // ── India Post: the article number, at the same moment ─────────────────
    //
    // Same reasoning as the reference above, and for India Post it is the
    // stronger case. Their article number is not a label we can print on
    // demand — it comes out of a finite allotment and it is the only identity
    // the postal system has for the parcel. Handing it out here means the
    // number exists from the moment the parcel is routed, so the label, the
    // address sheet and the booking workbook can all be printed, reprinted and
    // printed again in any order, days apart, and carry the same number.
    //
    // It used to be allotted when the workbook was downloaded, which tied a
    // permanent property of the parcel to one transient act — and since that
    // download also confirms the batch, a parcel could only ever get its
    // number once, on a file nobody could produce twice.
    //
    // Never fails the assignment. A parcel routed to Speed Post with the stock
    // empty is still routed; it simply has no number yet, every screen says
    // so, and the portal's Allot button picks it up once a range is loaded.
    if (courier?.config.tracking === "india-post") {
      try {
        const result = await allocateBarcodes(courier.id, updated);
        articles = result.allocated.length;
        articleShortfall = result.shortfall;
      } catch (e) {
        console.warn("[Courier] article numbers not allotted:", e);
      }
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
  const courier = wantsSend ? routedCourier : null;
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
    unserviceable: unserviceable.length + refusedForPincode.size,
    refused_before_routing: refusedForPincode.size,
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
    // India Post only, and zero everywhere else. `article_shortfall` is what
    // the screen warns on: the parcels are routed and postable, but nothing
    // can be booked for them until a range is loaded.
    articles,
    article_shortfall: articleShortfall,
    // The ones this courier cannot deliver. Named, not just counted, so the
    // screen can offer to move them somewhere else. Includes both kinds: those
    // routed and then found unserviceable, and those a `require_serviceable`
    // courier refused before routing — the per-parcel `results` entry says
    // which, and only the first kind actually carries this courier now.
    unserviceable: [...unserviceable, ...refusedForPincode.keys()],
  });
}
