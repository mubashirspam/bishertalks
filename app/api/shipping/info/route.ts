export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

/**
 * Shipping Information API for Razorpay Magic Checkout (custom platform).
 *
 * Razorpay calls this from THEIR servers, mid-checkout, with the customer's
 * candidate addresses. It must stay publicly reachable with no authentication
 * and must answer well inside Razorpay's 10s timeout — past that the request is
 * killed and the customer sees a checkout error. So: no DB calls, no awaits,
 * pure computation.
 *
 * Current policy (change here, it's the single source of truth):
 *   • Ships anywhere in India, free of charge.
 *   • COD is disabled — this is a prepaid-only integration.
 *
 * NOTE: Razorpay's public docs do not publish the exact request schema, so the
 * address list is parsed defensively and every documented response field is
 * echoed back. Confirm the contract against Dashboard → Magic Checkout →
 * Checkout Settings before going live, and check the shape logged below.
 */

/** Free, all-India. Set a paise value here to start charging for shipping. */
const SHIPPING_FEE_PAISE = 0;

/** Prepaid only — COD is intentionally not offered. */
const COD_ENABLED = false;

interface IncomingAddress {
  id?: string | number;
  zipcode?: string;
  postal_code?: string;
  state_code?: string;
  state?: string;
  country?: string;
}

function extractAddresses(body: unknown): IncomingAddress[] {
  if (Array.isArray(body)) return body as IncomingAddress[];
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.addresses)) return b.addresses as IncomingAddress[];
    // Some payload variants nest the list under `order`.
    const order = b.order as Record<string, unknown> | undefined;
    if (order && Array.isArray(order.addresses)) {
      return order.addresses as IncomingAddress[];
    }
  }
  return [];
}

/** Serviceability rule. Today: any valid 6-digit Indian pincode. */
function isServiceable(zipcode: string | null): boolean {
  if (!zipcode) return false;
  return /^\d{6}$/.test(zipcode);
}

/**
 * Permissive fallback used when the payload can't be parsed. Shipping is free
 * and all-India, so "yes" is the correct answer for every real address — better
 * to approve than to block a paying customer over a schema mismatch.
 */
const PERMISSIVE = {
  addresses: [
    {
      id: 0,
      serviceable: true,
      shipping_fee: SHIPPING_FEE_PAISE,
      cod: COD_ENABLED,
      cod_fee: 0,
    },
  ],
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const addresses = extractAddresses(body);

    // Logged so the real payload shape can be confirmed against a live checkout.
    console.log(
      "[ShippingInfo] received",
      addresses.length,
      "address(es):",
      JSON.stringify(body).slice(0, 500)
    );

    // Parsed nothing out of a non-empty body: Razorpay's schema isn't what we
    // expect. Shout about it, but still let the customer through.
    if (addresses.length === 0) {
      console.error(
        "[ShippingInfo] SCHEMA MISMATCH — no addresses parsed from payload:",
        JSON.stringify(body).slice(0, 1000)
      );
      return NextResponse.json(PERMISSIVE);
    }

    const results = addresses.map((addr, i) => {
      const zipcode = (addr.zipcode ?? addr.postal_code ?? "").toString().trim();
      const serviceable = isServiceable(zipcode || null);
      return {
        id: addr.id ?? i,
        zipcode,
        state_code: addr.state_code ?? null,
        country: addr.country ?? "in",
        serviceable,
        shipping_fee: serviceable ? SHIPPING_FEE_PAISE : 0,
        cod: COD_ENABLED,
        // Mandatory field — must be 0 whenever `cod` is false.
        cod_fee: 0,
      };
    });

    return NextResponse.json({ addresses: results });
  } catch (e) {
    // Never 500 here: an error response blocks the customer from checking out.
    console.error("[ShippingInfo] failed, defaulting to serviceable:", e);
    return NextResponse.json(PERMISSIVE);
  }
}

/** Health check — handy for confirming public reachability from Razorpay. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "magic-checkout-shipping-info",
    shipping_fee_paise: SHIPPING_FEE_PAISE,
    cod: COD_ENABLED,
  });
}
