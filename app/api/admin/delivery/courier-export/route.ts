export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCourierBySlug, delhiveryCourierIds } from "@/lib/db/couriers";
import { delhiveryReadiness } from "@/lib/delhivery/config";
import { delhiveryRequest } from "@/lib/delhivery/client";
import { toXLSX } from "@/lib/export";
import { istToday } from "@/lib/format-date";

/**
 * Everything Delhivery knows about our parcels, as a spreadsheet.
 *
 * Worth being precise about what this can and cannot be. Delhivery has no
 * "list every shipment on this account" endpoint — `/api/v1/packages/json/`
 * refuses without specific ids. So this asks about every parcel *we* can name,
 * by waybill where we have one and by our reference where we do not.
 *
 * That means a shipment on the franchise's account that we have no reference
 * for cannot appear here, and there is no way to make it appear. KKR is a
 * franchise carrying other sellers' parcels too, so their portal total will be
 * larger than this file, and the difference is not missing data — it is
 * somebody else's.
 *
 * Read-only, so it answers to `delivery.view`.
 */

/** Their cap per tracking call. */
const BATCH = 50;
/** Enough for the whole table today, with room; guards a runaway loop. */
const MAX = 3000;

interface Shipment {
  AWB?: string;
  ReferenceNo?: string;
  OrderType?: string;
  InvoiceAmount?: number | string;
  CODAmount?: number | string;
  Origin?: string;
  SenderName?: string;
  PickupLocation?: string;
  PickedupDate?: string;
  PromisedDeliveryDate?: string;
  ExpectedDeliveryDate?: string;
  DispatchCount?: number;
  ReverseInTransit?: boolean;
  Status?: {
    Status?: string;
    StatusType?: string;
    StatusDateTime?: string;
    StatusLocation?: string;
    Instructions?: string;
  };
  Consignee?: {
    Name?: string;
    City?: string;
    State?: string;
    PinCode?: number | string;
    Telephone1?: string;
  };
  Scans?: unknown[];
}

const HEADERS = [
  "Order number",
  "Reference",
  "Waybill",
  "Status",
  "Status type",
  "Status date",
  "Status location",
  "Instructions",
  "Consignee",
  "Town",
  "State",
  "Pincode",
  "Payment",
  "Invoice amount",
  "COD amount",
  "Origin",
  "Pickup location",
  "Picked up",
  "Promised delivery",
  "Expected delivery",
  "Failed attempts",
  "In RTO",
  "Scans",
  "Our status",
  "Our courier",
];

export async function GET(request: NextRequest) {
  // Every customer's name, town and phone, in one file.
  const auth = await requirePermission("delivery.view");
  if (!auth.ok) return auth.response;

  const courier = await getCourierBySlug("delhivery");
  if (!courier) {
    return NextResponse.json({ error: "Delhivery is not configured." }, { status: 400 });
  }
  const { ready, settings, missing } = delhiveryReadiness(courier.config);
  if (!ready || !settings) {
    return NextResponse.json({ error: "Delhivery is not set up yet.", missing }, { status: 400 });
  }

  // Everything we can name. Paged, because there are more than a thousand and
  // PostgREST caps a response at 1000 whatever you ask for (lib/db/paginate).
  const ours: {
    order_number: string;
    courier_reference: string | null;
    tracking_number: string | null;
    status: string;
    courier_id: string | null;
  }[] = [];
  //
  // Delhivery's parcels and the unrouted back catalogue, and nobody else's:
  // asking them about an India Post reference gets an answer about whatever
  // shipment happens to carry that string, and the file would then print
  // another customer's waybill against our order number.
  const delhivery = await delhiveryCourierIds();
  const courierScope = delhivery.length
    ? `courier_id.is.null,courier_id.in.(${delhivery.join(",")})`
    : "courier_id.is.null";

  for (let from = 0; from < MAX; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("order_number,courier_reference,tracking_number,status,courier_id")
      .or("tracking_number.not.is.null,courier_reference.not.is.null")
      .or(courierScope)
      .order("ordered_at", { ascending: true })
      .range(from, from + 999);

    if (error) {
      console.error("[Export] order read failed:", error.message);
      return NextResponse.json({ error: "Could not read the orders" }, { status: 500 });
    }
    const batch = (data ?? []) as typeof ours;
    ours.push(...batch);
    if (batch.length < 1000) break;
  }

  // Look up by waybill where we have one — it is theirs and unambiguous — and
  // by our reference otherwise.
  const byWaybill = new Map<string, (typeof ours)[number]>();
  const byReference = new Map<string, (typeof ours)[number]>();
  for (const o of ours) {
    if (o.tracking_number) byWaybill.set(o.tracking_number, o);
    else if (o.courier_reference) byReference.set(o.courier_reference, o);
  }

  const rows: unknown[][] = [];
  const seen = new Set<string>();

  const collect = async (keys: string[], param: "waybill" | "ref_ids", lookup: Map<string, (typeof ours)[number]>) => {
    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      let data: { ShipmentData?: { Shipment?: Shipment }[]; Error?: string };
      try {
        data = await delhiveryRequest({
          settings,
          path: "/api/v1/packages/json/",
          query: { [param]: batch.join(",") },
          retryOnNetworkError: true,
        });
      } catch (e) {
        // One bad batch must not lose the rest of a 900-row export.
        console.warn("[Export] batch failed:", e);
        continue;
      }
      if (data.Error) continue;

      for (const entry of data.ShipmentData ?? []) {
        const s = entry.Shipment;
        if (!s?.AWB) continue;
        const key = param === "waybill" ? String(s.AWB) : String(s.ReferenceNo ?? "");
        const order = lookup.get(key);
        if (seen.has(String(s.AWB))) continue;
        seen.add(String(s.AWB));

        const st = s.Status ?? {};
        const c = s.Consignee ?? {};
        rows.push([
          order?.order_number ?? "",
          s.ReferenceNo ?? "",
          s.AWB ?? "",
          st.Status ?? "",
          st.StatusType ?? "",
          st.StatusDateTime ?? "",
          st.StatusLocation ?? "",
          st.Instructions ?? "",
          c.Name ?? "",
          c.City ?? "",
          c.State ?? "",
          c.PinCode ?? "",
          s.OrderType ?? "",
          s.InvoiceAmount ?? "",
          s.CODAmount ?? "",
          s.Origin ?? "",
          s.PickupLocation ?? "",
          s.PickedupDate ?? "",
          s.PromisedDeliveryDate ?? "",
          s.ExpectedDeliveryDate ?? "",
          s.DispatchCount ?? 0,
          s.ReverseInTransit ? "yes" : "",
          Array.isArray(s.Scans) ? s.Scans.length : 0,
          order?.status ?? "",
          order?.courier_id ? courier.name : "",
        ]);
      }
    }
  };

  await collect([...byWaybill.keys()], "waybill", byWaybill);
  await collect([...byReference.keys()], "ref_ids", byReference);

  if (!rows.length) {
    return NextResponse.json(
      { error: "Delhivery returned nothing for any of our parcels." },
      { status: 400 }
    );
  }

  const file = toXLSX(HEADERS, rows, "Delhivery");
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="delhivery-${istToday()}-${rows.length}.xlsx"`,
      "Cache-Control": "no-store",
      "X-Row-Count": String(rows.length),
      // What we asked about vs what came back — the gap is parcels Delhivery
      // has no record of, which is worth knowing before reading the file.
      "X-Asked": String(ours.length),
    },
  });
}
