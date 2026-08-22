export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { updateBookPricing, applyScheduledPricing } from "@/lib/db/checkout-settings";
import { audit } from "@/lib/audit";

/**
 * The book's price, and the change scheduled to replace it.
 *
 * Answers to `promos.manage`, the permission the Checkout tab already runs on —
 * the same person who sets the wrapping fee and switches the promo field.
 *
 * Everything is re-validated here. The card validates too, but the card is a
 * browser and this is the number every customer is charged: a bad price reaching
 * the database is a real amount debited from a real card, and no amount of
 * client-side care prevents a hand-rolled request.
 */

/** Whole rupees, or null. Rejects anything that is not a sane amount. */
function rupees(v: unknown): number | null | undefined {
  if (v === null || v === "" || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  // `undefined` is the error channel here — null is a legitimate "no offer".
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) return undefined;
  return n;
}

/**
 * A wall-clock string from the form, as an instant.
 *
 * The form sends "2026-08-23T00:00" with no zone, and it means IST — that is
 * the clock everybody involved reads. Parsing it with `new Date()` would use
 * the SERVER's timezone, which on Vercel is UTC, and would quietly move a
 * midnight price change to 5:30am.
 */
function istInstant(local: unknown): Date | null {
  if (typeof local !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) {
    return null;
  }
  const at = new Date(`${local.slice(0, 16)}:00+05:30`);
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePermission("promos.manage");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  // Fold an already-arrived change into the live price and empty the schedule.
  // Nothing depends on this — the read resolves a past moment as the live price
  // regardless — so it is housekeeping, and it refuses a change that has not
  // arrived yet rather than bringing it forward.
  if (body.apply === true) {
    const ok = await applyScheduledPricing();
    if (!ok) {
      return NextResponse.json(
        { error: "There's no change that has taken effect yet." },
        { status: 400 }
      );
    }
    await audit({
      actor: auth.staff,
      action: "pricing.applied",
      entity: "checkout_settings",
      entityId: "book",
      meta: {},
    });
    return NextResponse.json({ ok: true });
  }

  const price = rupees(body.price);
  if (price === undefined || price === null) {
    return NextResponse.json(
      { error: "Enter the struck-through price in whole rupees." },
      { status: 400 }
    );
  }

  const offer = rupees(body.offer_price);
  if (offer === undefined) {
    return NextResponse.json({ error: "That offer price isn't a number." }, { status: 400 });
  }
  if (offer !== null && offer > price) {
    return NextResponse.json(
      { error: "The charged price can't be more than the struck-through one." },
      { status: 400 }
    );
  }

  // ── The scheduled change ──────────────────────────────────────────────────
  let next: { price: number; offerPrice: number | null; effectiveAt: string } | null =
    null;

  if (body.next) {
    const nextPrice = rupees(body.next.price);
    if (nextPrice === undefined || nextPrice === null) {
      return NextResponse.json(
        { error: "Enter the new struck-through price, or clear the schedule." },
        { status: 400 }
      );
    }

    const nextOffer = rupees(body.next.offer_price);
    if (nextOffer === undefined) {
      return NextResponse.json({ error: "That new offer price isn't a number." }, { status: 400 });
    }
    if (nextOffer !== null && nextOffer > nextPrice) {
      return NextResponse.json(
        { error: "The new charged price can't be more than its struck-through one." },
        { status: 400 }
      );
    }

    const at = istInstant(body.next.effective_at_local);
    if (!at) {
      return NextResponse.json(
        { error: "Pick the date and time the new price starts." },
        { status: 400 }
      );
    }

    // A past moment is allowed on purpose — it means "now", which is a thing
    // somebody genuinely wants when a change was meant to happen an hour ago.
    // It is not silently rewritten to now, so the audit log keeps what was asked.
    next = { price: nextPrice, offerPrice: nextOffer, effectiveAt: at.toISOString() };
  }

  const ok = await updateBookPricing({ price, offerPrice: offer, next });
  if (!ok) {
    return NextResponse.json({ error: "Could not save the pricing." }, { status: 500 });
  }

  // Money, changed by a person. Worth a row saying who and to what.
  await audit({
    actor: auth.staff,
    action: "pricing.updated",
    entity: "checkout_settings",
    entityId: "book",
    meta: {
      price,
      offer_price: offer,
      next_price: next?.price ?? null,
      next_offer_price: next?.offerPrice ?? null,
      effective_at: next?.effectiveAt ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
