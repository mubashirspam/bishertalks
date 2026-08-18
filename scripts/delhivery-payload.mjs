#!/usr/bin/env node
/**
 * Print the create.json payload for parcels waiting to be handed over.
 *
 *   node scripts/delhivery-payload.mjs            # all of them
 *   node scripts/delhivery-payload.mjs ORD-XXXX   # one
 *
 * SENDS NOTHING. It builds the body and prints it, so the exact request can be
 * shown to Delhivery when asking a question about it, or checked by eye before
 * anybody uploads anything.
 *
 * This is the payload Delhivery accepted on 18 August — six shipments, waybills
 * 54132310017275 through ...323 — so it is a working example rather than a
 * guess. Creating shipments is KKR's job; there is deliberately no code here
 * that posts this anywhere.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync("/Users/mymac/projects/web/bishertalks/.env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: K, Authorization: "Bearer " + K };

const PICKUP = "KKR LOGISTICS FRANCHISE";
const D = {
  weightPerBookGrams: 250, lengthCm: 10, breadthCm: 10, heightCm: 10, product: "BOOK",
  returnAddress: "GROUND FLOOR, 63/2069/C2, HI DAWN TOWER, KUNIYIL KAVU ROAD, KOZHIKODE",
  returnPin: 673001, sellerName: "BISHER", sellerAddress: "KOZHIKODE-6282680794", fragile: "true",
};

const phoneDigits = p => { const d = (p || "").replace(/\D/g, ""); return d.length === 12 && d.startsWith("91") ? d.slice(2) : d; };

/** The one address string Delhivery reads, ending in the mobile as their sheet does. */
function address(p) {
  const parts = [];
  for (const raw of [p.address_line1, p.address_line2, p.city, p.district]) {
    const part = raw?.trim(); if (!part) continue;
    if (parts.some(s => s.toLowerCase() === part.toLowerCase())) continue;
    parts.push(part);
  }
  const phone = phoneDigits(p.buyer_phone);
  return (parts.join(", ") + (phone ? `,${phone}` : "")).slice(0, 400)
    .replace(/&/g, " and ").replace(/#/g, " ").replace(/\s+/g, " ").trim();
}

function shipment(p) {
  const books = Math.max(1, p.quantity || 1);
  return {
    name: (p.buyer_name ?? "").toUpperCase(),
    add: address(p),
    pin: (p.pincode ?? "").replace(/\D/g, ""),
    city: p.city ?? "",
    state: p.state ?? "",
    country: "India",
    phone: phoneDigits(p.buyer_phone),
    // Our order number. Comes back as `refnum` on the response and as
    // ReferenceNo on every tracking call, so a scan maps to an order with no
    // lookup table.
    order: p.order_number,
    // Left blank: Delhivery assigns one. Filling it in is the alternative, via
    // their Bulk Waybill API.
    waybill: "",
    payment_mode: "Prepaid",
    total_amount: Math.round((p.amount_paise ?? 0) / 100),
    cod_amount: 0,
    products_desc: D.product,
    quantity: books,
    weight: D.weightPerBookGrams * books,
    shipment_length: D.lengthCm,
    shipment_width: D.breadthCm,
    shipment_height: D.heightCm,
    fragile_shipment: D.fragile,
    shipping_mode: "Surface",
    seller_name: D.sellerName,
    seller_add: D.sellerAddress,
    return_add: D.returnAddress,
    return_pin: String(D.returnPin),
    return_name: D.sellerName,
  };
}

const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
const COLS = "order_number,buyer_name,buyer_phone,address_line1,address_line2,city,district,state,pincode,amount_paise,quantity,courier_reference";
const q = only.length
  ? `orders?select=${COLS}&order_number=in.(${only.join(",")})`
  : `portal_orders?select=${COLS}&handover_state=eq.to_hand_over&order=created_at.asc`;

const parcels = await (await fetch(`${U}/rest/v1/${q}`, { headers: h })).json();
if (!Array.isArray(parcels) || !parcels.length) {
  console.log("Nothing waiting to be handed over.");
  process.exit(0);
}

const payload = {
  shipments: parcels.map(shipment),
  pickup_location: { name: PICKUP, country: "India" },
};

console.log(`\n\x1b[1mPOST\x1b[0m https://track.delhivery.com/api/cmu/create.json`);
console.log(`\x1b[1mHeaders\x1b[0m`);
console.log(`  Authorization: Token <DELHIVERY_API_TOKEN>`);
console.log(`  Content-Type: application/json     \x1b[2m(yes — json, with the form-shaped body below)\x1b[0m`);
console.log(`\n\x1b[1mBody\x1b[0m  \x1b[2m(format=json&data=<raw JSON, NOT url-encoded>)\x1b[0m\n`);
console.log("format=json&data=" + JSON.stringify(payload, null, 2));
console.log(`\n\x1b[2m${parcels.length} shipment(s). Nothing was sent.\x1b[0m\n`);
