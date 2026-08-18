#!/usr/bin/env node
/**
 * Send routed parcels to Delhivery, using the exact payload lib/delhivery/manifest.ts builds.
 *
 *   node scripts/delhivery-send.mjs --one          # the oldest ready parcel
 *   node scripts/delhivery-send.mjs --all          # every ready parcel
 *
 * These are REAL shipments on a production account. Delhivery will collect and
 * bill for them.
 *
 * The claim ordering is the same as the route's and is not negotiable: a parcel
 * is marked sent BEFORE the call, so a timeout cannot leave it looking unsent
 * and invite a second manifest. A definite refusal releases it; an unknown
 * outcome keeps it held and says so.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync("/Users/mymac/projects/web/bishertalks/.env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, T = env.DELHIVERY_API_TOKEN;
const h = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
const G = t => `\x1b[32m${t}\x1b[0m`, R = t => `\x1b[31m${t}\x1b[0m`, Y = t => `\x1b[33m${t}\x1b[0m`, D = t => `\x1b[2m${t}\x1b[0m`, B = t => `\x1b[1m${t}\x1b[0m`;

const ONE = process.argv.includes("--one"), ALL = process.argv.includes("--all");
if (!ONE && !ALL) { console.log("Pass --one or --all"); process.exit(1); }

const PICKUP = "KKR LOGISTICS FRANCHISE";
const D_ = { weightPerBookGrams: 250, lengthCm: 10, breadthCm: 10, heightCm: 10, product: "BOOK",
  returnAddress: "GROUND FLOOR, 63/2069/C2, HI DAWN TOWER, KUNIYIL KAVU ROAD, KOZHIKODE",
  returnPin: 673001, sellerName: "BISHER", sellerAddress: "KOZHIKODE-6282680794", fragile: "true" };

const phoneDigits = p => { const d = (p || "").replace(/\D/g, ""); return d.length === 12 && d.startsWith("91") ? d.slice(2) : d; };

/** Mirrors courierAddress() + safeAddress() in lib/delhivery/manifest.ts. */
function address(p) {
  const parts = [];
  for (const raw of [p.address_line1, p.address_line2, p.city, p.district]) {
    const part = raw?.trim(); if (!part) continue;
    if (parts.some(s => s.toLowerCase() === part.toLowerCase())) continue;
    parts.push(part);
  }
  const phone = phoneDigits(p.buyer_phone);
  const line = (parts.join(", ") + (phone ? `,${phone}` : "")).slice(0, 400);
  return line.replace(/&/g, " and ").replace(/#/g, " ").replace(/\s+/g, " ").trim();
}

function shipment(p) {
  const books = Math.max(1, p.quantity || 1);
  const mobile = phoneDigits(p.buyer_phone);
  return {
    name: (p.buyer_name ?? "").toUpperCase(),
    add: address(p),
    pin: (p.pincode ?? "").replace(/\D/g, ""),
    city: p.city ?? "", state: p.state ?? "", country: "India",
    phone: mobile,
    order: p.order_number,
    waybill: "",
    payment_mode: "Prepaid",
    total_amount: Math.round((p.amount_paise ?? 0) / 100),
    cod_amount: 0,
    products_desc: D_.product,
    quantity: books,
    weight: D_.weightPerBookGrams * books,
    shipment_length: D_.lengthCm, shipment_width: D_.breadthCm, shipment_height: D_.heightCm,
    fragile_shipment: D_.fragile,
    shipping_mode: "Surface",
    seller_name: D_.sellerName, seller_add: D_.sellerAddress,
    return_add: D_.returnAddress, return_pin: String(D_.returnPin), return_name: D_.sellerName,
  };
}

const COLS = "order_number,buyer_name,buyer_phone,address_line1,address_line2,city,district,state,pincode,amount_paise,quantity,courier_reference";
const ready = await (await fetch(`${U}/rest/v1/portal_orders?select=${COLS}&handover_state=eq.ready&order=created_at.asc`, { headers: h })).json();
const targets = ONE ? ready.slice(0, 1) : ready;

console.log(`\n${B("Delhivery send")} ${R("PRODUCTION — these become real shipments")}`);
console.log(`${ready.length} ready · sending ${targets.length}\n`);
if (!targets.length) process.exit(0);

const payload = { shipments: targets.map(shipment), pickup_location: { name: PICKUP, country: "India" } };
console.log(D(JSON.stringify(payload.shipments[0], null, 2)) + "\n");

// Claim first. A timeout after this must not look like "never sent".
const numbers = targets.map(t => t.order_number);
const claim = await fetch(`${U}/rest/v1/orders?order_number=in.(${numbers.join(",")})&courier_sent_at=is.null`, {
  method: "PATCH", headers: { ...h, Prefer: "return=representation" },
  body: JSON.stringify({ courier_sent_at: new Date().toISOString(), courier_send_error: null }),
});
const claimed = await claim.json();
console.log(D(`claimed ${claimed.length}/${targets.length} before calling`));

let res, text;
try {
  res = await fetch("https://track.delhivery.com/api/cmu/create.json", {
    method: "POST",
    headers: { Authorization: "Token " + T, "Content-Type": "application/json", Accept: "application/json" },
    body: `format=json&data=${JSON.stringify(payload)}`,
  });
  text = await res.text();
} catch (e) {
  console.log(R(`\nNO ANSWER: ${e.message}`));
  console.log(Y("Parcels left HELD — check Delhivery before sending again."));
  await fetch(`${U}/rest/v1/orders?order_number=in.(${numbers.join(",")})`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ courier_send_error: "Send did not complete — check Delhivery before sending again; it may already be there." }) });
  process.exit(1);
}

console.log(`${res.ok ? G("← " + res.status) : R("← " + res.status)}`);
let json; try { json = JSON.parse(text); } catch { console.log(text.slice(0, 1500)); process.exit(1); }
console.log(D(JSON.stringify(json, null, 2).slice(0, 2000)));

const packages = json.packages ?? [];
let ok = 0, bad = 0;
for (const t of targets) {
  const pkg = packages.find(p => String(p.refnum) === t.order_number);
  const good = pkg && String(pkg.status).toLowerCase() === "success" && pkg.waybill;
  if (good) {
    await fetch(`${U}/rest/v1/orders?order_number=eq.${t.order_number}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify({ tracking_number: String(pkg.waybill), courier_entered_at: new Date().toISOString(), courier_send_error: null, updated_at: new Date().toISOString() }) });
    console.log(`  ${G("✓")} ${t.order_number} -> ${pkg.waybill}`);
    ok++;
  } else {
    const why = pkg ? (Array.isArray(pkg.remarks) ? pkg.remarks.join("; ") : String(pkg.remarks ?? "refused")) : (json.rmk || "not mentioned in the response");
    await fetch(`${U}/rest/v1/orders?order_number=eq.${t.order_number}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
      body: JSON.stringify({ courier_sent_at: null, courier_send_error: why.slice(0, 500), updated_at: new Date().toISOString() }) });
    console.log(`  ${R("✗")} ${t.order_number} — ${why}`);
    bad++;
  }
}
console.log(`\n${ok ? G(ok + " sent") : ""}${bad ? R(" · " + bad + " refused") : ""}\n`);
