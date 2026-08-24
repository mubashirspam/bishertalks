#!/usr/bin/env node
/**
 * Re-code the references of parcels that never left, and undo the damage the
 * old scheme did.
 *
 *   node scripts/reference-recode.mjs           # dry run
 *   node scripts/reference-recode.mjs --write
 *
 * Every reference used to be `BISH` plus digits of the customer's mobile,
 * whichever partner was carrying the parcel. Two things follow from that, and
 * both have already happened:
 *
 *   * The string says nothing about whose parcel it is. ORD-YP97XR went to
 *     India Post under BISH40490. Delhivery had a different customer's
 *     shipment — Nisam's, pincode 676504, delivered 15 Aug — filed under
 *     BISH40490 too. The tracking sync asked Delhivery about every parcel we
 *     had a reference for, matched the two, and wrote Nisam's waybill and his
 *     "Delivered" scan onto Faisal's unposted order.
 *   * Two customers sharing five digits of a mobile is not rare enough to
 *     ignore, and a courier holding an old parcel under that same string is
 *     rarer still but far worse.
 *
 * The code now mints `<courier code>-<order number>` and never asks a courier
 * about a parcel that is not theirs. This fixes what is already stored:
 *
 *   1. Undoes a scan that came from another courier's shipment — the waybill,
 *      the scan text, the status it caused.
 *   2. Re-codes the reference of every parcel routed to a partner it does not
 *      match, but only where nothing outside this system has seen it: no
 *      waybill, never pushed, never on a downloaded sheet. A number a courier
 *      has been given is left exactly as it is, whatever shape it is in.
 *
 * Mirrors lib/db/courier-reference.ts. Safe to re-run; the second run finds
 * nothing to do.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, T = env.DELHIVERY_API_TOKEN;
const BASE = env.DELHIVERY_ENV === "production" ? "https://track.delhivery.com" : "https://staging-express.delhivery.com";
const h = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
const G = t => `\x1b[32m${t}\x1b[0m`, Y = t => `\x1b[33m${t}\x1b[0m`, R = t => `\x1b[31m${t}\x1b[0m`, D = t => `\x1b[2m${t}\x1b[0m`, B = t => `\x1b[1m${t}\x1b[0m`;
const WRITE = process.argv.includes("--write");

/** Mirrors REFERENCE_CODES in lib/couriers/types.ts. */
const REFERENCE_CODES = { delhivery: "BISH", "delhivery-sheet": "BISH", "speed-post": "SP", "mubashir-logistic": "ML" };
const derive = slug => {
  const parts = slug.split(/[^a-zA-Z]+/).filter(Boolean);
  return ((parts.length > 1 ? parts.map(p => p[0]).join("") : (parts[0] ?? "").slice(0, 4)).toUpperCase()) || "BISH";
};

const page = async q => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${q}&limit=1000&offset=${f}`, { headers: h }); const b = await r.json(); if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 300)); o.push(...b); if (b.length < 1000) break; f += 1000; } return o; };
const patch = async (q, body) => {
  const r = await fetch(`${U}/rest/v1/orders?${q}`, { method: "PATCH", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(body) });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b).slice(0, 300));
  return b;
};

console.log(`\n${B("Reference recode")} ${D(WRITE ? "WRITING" : "dry run — nothing will be saved")}`);

const couriers = await page("couriers?select=id,slug,name,handoff,config&order=sort_order.asc");
const byId = new Map(couriers.map(c => [c.id, c]));
const codeFor = id => { const c = byId.get(id); return c ? (REFERENCE_CODES[c.slug] ?? derive(c.slug)) : "BISH"; };
const tracksDelhivery = id => byId.get(id)?.config?.tracking === "delhivery";

const orders = await page(
  "orders?select=order_number,buyer_name,buyer_phone,pincode,amount_paise,courier_id,courier_reference," +
  "tracking_number,courier_sent_at,courier_entered_at,status,courier_last_scan,courier_last_scan_at," +
  "delivered_at,returned_at&courier_reference=not.is.null&order=created_at.desc"
);
console.log(D(`  ${orders.length} parcel(s) carry a reference\n`));

// ── 1. Scans that came from somebody else's shipment ────────────────────────
// The test is the one lib/delhivery/legacy.ts already uses: a shipment that
// *conflicts* with the order — wrong town, wrong money — is not this parcel,
// and one disagreement is enough.
//
// Nothing weaker will do. A parcel routed to a partner Delhivery does not track
// can still have a Delhivery waybill honestly: KKR sheeted plenty of them
// before they were moved to another partner, and Delhivery's record for those
// is the same customer, the same pincode, the same amount. Undoing those would
// destroy real tracking to fix an imaginary problem. So only a demonstrable
// mismatch is touched, and a shipment Delhivery tells us nothing checkable
// about is left exactly as it is.
const suspects = orders.filter(o => o.tracking_number && o.courier_id && !tracksDelhivery(o.courier_id));
const contaminated = [];
const kept = [];

for (const o of suspects) {
  let theirs = null;
  try {
    const r = await fetch(`${BASE}/api/v1/packages/json/?waybill=${encodeURIComponent(o.tracking_number)}`,
      { headers: { Authorization: "Token " + T, Accept: "application/json" } });
    const j = await r.json();
    theirs = j.ShipmentData?.[0]?.Shipment ?? null;
  } catch (e) {
    console.log(R(`  could not check ${o.order_number}: ${e.message}`));
    continue;
  }
  // Delhivery does not know it: then it is a tracking number somebody typed in
  // by hand, which is exactly what a `manual` courier's parcels are supposed to
  // have. Leave it alone.
  if (!theirs) continue;

  const ourPin = (o.pincode || "").replace(/\D/g, "");
  const theirPin = String(theirs.Consignee?.PinCode ?? "").replace(/\D/g, "");
  const ourRupees = Math.round((o.amount_paise ?? 0) / 100);
  const theirRupees = theirs.InvoiceAmount != null ? Math.round(Number(theirs.InvoiceAmount)) : null;
  const money = theirRupees != null && ourRupees > 0 && theirRupees !== ourRupees ? ` ₹${theirRupees} vs ₹${ourRupees}` : "";

  // The destination, and only the destination. `corroborates()` weighs the
  // invoice amount too, and here it lies: Delhivery holds 798 for parcels we
  // charged 699 — the sheet's Package Amount was written under an older price
  // — on shipments whose consignee name and pincode match ours exactly. A test
  // that flags those would delete ten parcels' real tracking. A pincode does
  // not drift: a shipment addressed to a different town is a different parcel.
  const conflicts = [];
  if (ourPin && theirPin && ourPin !== theirPin) conflicts.push(`pincode ${theirPin} vs ${ourPin}`);

  const row = {
    ...o,
    courier: byId.get(o.courier_id)?.name ?? "—",
    theirName: theirs.Consignee?.Name ?? "",
    theirPin,
    theirRef: theirs.ReferenceNo ?? "",
    theirStatus: theirs.Status?.Status ?? "",
    conflicts: conflicts.join(", "),
    money,
  };
  if (conflicts.length) contaminated.push(row); else kept.push(row);
}

console.log(B("Parcels wearing another shipment's tracking"));
if (!contaminated.length) console.log(D("  none\n"));
for (const c of contaminated) {
  console.log(`  ${R(c.order_number)} ${c.buyer_name} ${D(`(${c.courier}, ref ${c.courier_reference})`)}`);
  console.log(D(`     holds AWB ${c.tracking_number} — Delhivery files it as "${c.theirName}" pin ${c.theirPin}, ref ${c.theirRef}, ${c.theirStatus}`));
  console.log(R(`     conflicts on ${c.conflicts}`));
  console.log(D(`     clearing waybill + scan, status ${c.status} -> confirmed`));
}

if (kept.length) {
  console.log(`\n${B("Checked and kept — Delhivery's record agrees with the order")}`);
  for (const k of kept) {
    console.log(D(`  ${k.order_number} ${k.buyer_name} (${k.courier}) AWB ${k.tracking_number} — "${k.theirName}" pin ${k.theirPin}, ${k.theirStatus}${k.money}`));
  }
}

// ── 2. References that name the wrong partner ───────────────────────────────
// Only where nothing outside this system has seen the number. A parcel already
// pushed, sheeted or waybilled keeps whatever it has, because renaming it here
// would not rename it at the courier.
const recode = [];
const taken = new Set(orders.map(o => o.courier_reference));

for (const o of orders) {
  if (!o.courier_id) continue;
  const code = codeFor(o.courier_id);
  if (o.courier_reference.startsWith(`${code}-`)) continue;

  const stuck = [];
  // A cleared waybill (above) is not a reason to keep the old reference — that
  // waybill was never ours.
  const willClear = contaminated.some(c => c.order_number === o.order_number);
  if (o.tracking_number && !willClear) stuck.push("has a waybill");
  // A `manual` partner is handed a parcel across a counter and never sees our
  // reference — see referenceIsPrivate(). Being marked entered with India Post
  // does not mean India Post was told anything, so those stay correctable.
  if (byId.get(o.courier_id)?.handoff !== "manual") {
    if (o.courier_sent_at) stuck.push("pushed to the courier");
    if (o.courier_entered_at) stuck.push("on a downloaded sheet");
  }

  const tail = o.order_number.replace(/\W/g, "").slice(-6).toUpperCase();
  let next = `${code}-${tail}`;
  for (let n = 2; taken.has(next); n++) next = `${code}-${tail}-${n}`;

  recode.push({
    order_number: o.order_number,
    buyer_name: o.buyer_name,
    courier: byId.get(o.courier_id)?.name ?? "—",
    from: o.courier_reference,
    to: next,
    stuck: stuck.join(", "),
  });
  if (!stuck.length) taken.add(next);
}

const doable = recode.filter(r => !r.stuck);
const held = recode.filter(r => r.stuck);

console.log(`\n${B("References to re-code")}`);
const perCourier = {};
for (const r of doable) perCourier[r.courier] = (perCourier[r.courier] ?? 0) + 1;
for (const [name, n] of Object.entries(perCourier)) console.log(`  ${G(n)}  ${name}`);
if (!doable.length) console.log(D("  none"));
for (const r of doable.slice(0, 12)) console.log(D(`     ${r.order_number} ${r.from} -> ${r.to}`));
if (doable.length > 12) console.log(D(`     …and ${doable.length - 12} more`));

if (held.length) {
  console.log(`\n${B("Left alone — the courier already has these numbers")}`);
  for (const r of held.slice(0, 12)) console.log(D(`  ${r.order_number} ${r.from} (${r.stuck})`));
  if (held.length > 12) console.log(D(`  …and ${held.length - 12} more`));
}

if (!WRITE) {
  console.log(`\n${Y("Dry run. Re-run with --write to save.")}\n`);
  process.exit(0);
}

// ── Writing ─────────────────────────────────────────────────────────────────
// Order matters: the waybill goes first, so a parcel whose reference is about
// to change is no longer wearing a number that made it look tracked.
let cleared = 0;
for (const c of contaminated) {
  try {
    // Conditional on the waybill still being the one we checked at Delhivery.
    const rows = await patch(
      `order_number=eq.${encodeURIComponent(c.order_number)}&tracking_number=eq.${encodeURIComponent(c.tracking_number)}`,
      {
        tracking_number: null,
        courier_last_scan: null,
        courier_last_scan_at: null,
        courier_checked_at: null,
        // Back to where a routed, un-posted parcel belongs. Whoever is working
        // the queue decides what actually happened to it; this only stops the
        // system asserting something it was told by the wrong shipment.
        status: c.status === "delivered" || c.status === "returned" ? "confirmed" : c.status,
        delivered_at: null,
        returned_at: null,
        updated_at: new Date().toISOString(),
      }
    );
    if (rows.length) cleared++;
  } catch (e) {
    console.log(R(`  ${c.order_number}: ${e.message}`));
  }
}

let recoded = 0;
for (const r of doable) {
  try {
    // Conditional on the old number still being there, so a routing change that
    // happened while this ran wins rather than being overwritten.
    const rows = await patch(
      `order_number=eq.${encodeURIComponent(r.order_number)}&courier_reference=eq.${encodeURIComponent(r.from)}`,
      { courier_reference: r.to, updated_at: new Date().toISOString() }
    );
    if (rows.length) recoded++;
  } catch (e) {
    console.log(R(`  ${r.order_number}: ${e.message}`));
  }
}

console.log(`\n${G(`${cleared} parcel(s) un-contaminated, ${recoded} reference(s) re-coded.`)}\n`);
