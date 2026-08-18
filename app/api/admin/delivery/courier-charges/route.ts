export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCourierBySlug } from "@/lib/db/couriers";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { freightFor, parcelGrams } from "@/lib/delhivery/charges";

/**
 * Ask the courier what these parcels cost to carry.
 *
 * Read-only at their end — it prices a hypothetical parcel from two pincodes
 * and a weight, and creates nothing — so it answers to `delivery.view` rather
 * than the permission sending needs.
 *
 * The answer is stored per order, not recomputed on display, for the same
 * reason the gift charge and the referral commission are stored: it is what we
 * were charged at the time, and a rate card that changes next month must not
 * rewrite last month's margin.
 *
 * Priced by (destination pincode, weight) rather than per parcel, because that
 * pair is all their pricing depends on — a hundred books to one town is one
 * question, not a hundred.
 */

const MAX = 500;

export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.view");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const orderNumbers: string[] = Array.isArray(body.order_numbers)
    ? body.order_numbers.filter((n: unknown): n is string => typeof n === "string").slice(0, MAX)
    : [];

  const courier = await getCourierBySlug("delhivery");
  if (!courier) {
    return NextResponse.json({ error: "Delhivery is not configured." }, { status: 400 });
  }

  const { ready, settings, missing } = delhiveryReadiness(courier.config);
  if (!ready || !settings) {
    return NextResponse.json({ error: "Delhivery is not set up yet.", missing }, { status: 400 });
  }

  // Only parcels we would actually be billed for. A parcel with no waybill was
  // never carried, so pricing it would put an invented cost in the accounts.
  let query = supabaseAdmin
    .from("orders")
    .select("order_number,pincode,quantity")
    .not("tracking_number", "is", null)
    .neq("tracking_number", "")
    .is("courier_freight_paise", null)
    .limit(MAX);

  if (orderNumbers.length) query = query.in("order_number", orderNumbers);

  const { data, error } = await query;
  if (error) {
    console.error("[Charges] lookup failed:", error.message);
    return NextResponse.json({ error: "Could not load those parcels" }, { status: 500 });
  }

  const rows = (data ?? []) as { order_number: string; pincode: string | null; quantity: number }[];
  if (!rows.length) return NextResponse.json({ ok: true, priced: 0, total_paise: 0 });

  // One question per (pincode, weight). Their pricing depends on nothing else,
  // so asking per parcel would be the same answer several hundred times.
  const quotes = new Map<string, Awaited<ReturnType<typeof freightFor>>>();
  let priced = 0;
  let totalPaise = 0;
  let failed = 0;

  for (const row of rows) {
    const pin = (row.pincode ?? "").replace(/\D/g, "");
    const grams = parcelGrams(row.quantity);
    const key = `${pin}:${grams}`;

    if (!quotes.has(key)) {
      try {
        quotes.set(key, await freightFor({ destinationPin: pin, grams }, settings));
      } catch (e) {
        console.warn("[Charges] quote failed for", key, e);
        quotes.set(key, null);
      }
    }

    const quote = quotes.get(key);
    if (!quote) { failed++; continue; }

    const { error: writeError } = await supabaseAdmin
      .from("orders")
      .update({
        courier_freight_paise: quote.paise,
        courier_charge_detail: quote.detail,
        courier_charge_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("order_number", row.order_number);

    if (writeError) { failed++; continue; }
    priced++;
    totalPaise += quote.paise;
  }

  return NextResponse.json({
    ok: true,
    priced,
    failed,
    total_paise: totalPaise,
    // How many distinct questions it took, which is the useful number when
    // wondering whether this is cheap to run over the whole table.
    quotes: quotes.size,
  });
}
