#!/usr/bin/env node
/**
 * Give already-routed parcels what routing now gives them automatically.
 *
 *   node scripts/route-backfill.mjs           # dry run
 *   node scripts/route-backfill.mjs --write
 *
 * Assigning a courier now mints a reference and checks the pincode, but
 * anything routed before that landed has neither: no number to look it up by,
 * and no answer to whether the courier can even reach the address. This fills
 * both in. Idempotent — a parcel that already has a reference keeps it, since
 * a number the courier has seen must never change.
 *
 * Mirrors lib/db/courier-reference.ts and lib/db/serviceability.ts.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync("/Users/mymac/projects/web/bishertalks/.env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, T = env.DELHIVERY_API_TOKEN;
const h = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
const G = t => `\x1b[32m${t}\x1b[0m`, Y = t => `\x1b[33m${t}\x1b[0m`, R = t => `\x1b[31m${t}\x1b[0m`, D = t => `\x1b[2m${t}\x1b[0m`, B = t => `\x1b[1m${t}\x1b[0m`;
const WRITE = process.argv.includes("--write");

const digits = p => { const d = (p || "").replace(/\D/g, ""); return d.length === 12 && d.startsWith("91") ? d.slice(2) : d; };
const page = async q => { let o = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${q}&limit=1000&offset=${f}`, { headers: h }); const b = await r.json(); if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 200)); o.push(...b); if (b.length < 1000) break; f += 1000; } return o; };

console.log(`\n${B("Route backfill")} ${D(WRITE ? "WRITING" : "dry run — nothing will be saved")}`);

// ── References ──────────────────────────────────────────────────────────────
const needRef = await page(
  "orders?select=order_number,buyer_phone&courier_id=not.is.null" +
  "&or=(courier_reference.is.null,courier_reference.eq.)&order=created_at.asc"
);
// Every reference already in use, so a new one cannot collide with it. The
// unique index is the real guard, but colliding then retrying is slower than
// simply not colliding.
const existing = await page("orders?select=courier_reference&courier_reference=not.is.null&order=order_number.asc");
const taken = new Set(existing.map(o => o.courier_reference).filter(Boolean));

const mint = [];
for (const o of needRef) {
  const d = digits(o.buyer_phone);
  const tail = o.order_number.replace(/\W/g, "").slice(-6);
  // Same ladder as courierReference(): five digits, then six, then all of it,
  // then something that cannot collide at all.
  const ladder = d ? [`BISH${d.slice(-5)}`, `BISH${d.slice(-6)}`, `BISH${d}`, `BISH${d}-${tail}`] : [`BISH${tail}`];
  const pick = ladder.find(r => !taken.has(r)) ?? `BISH${d}-${tail}`;
  taken.add(pick);
  mint.push({ order_number: o.order_number, reference: pick });
}
console.log(`\n${B("References")}`);
console.log(`  ${mint.length ? G(mint.length) : D(0)}  routed parcels with no reference`);
for (const m of mint.slice(0, 10)) console.log(D(`     ${m.order_number} -> ${m.reference}`));
if (mint.length > 10) console.log(D(`     …and ${mint.length - 10} more`));

// ── Serviceability ──────────────────────────────────────────────────────────
const needPin = await page(
  "orders?select=order_number,pincode&courier_id=not.is.null&pincode_serviceable=is.null" +
  "&payment_status=eq.paid&address_line1=not.is.null&order=created_at.asc"
);
const pins = [...new Set(needPin.map(o => (o.pincode || "").replace(/\D/g, "")).filter(p => /^\d{6}$/.test(p)))];
console.log(`\n${B("Serviceability")}`);
console.log(`  ${needPin.length} parcel(s) unchecked, across ${pins.length} distinct pincode(s)`);

const answer = new Map();
for (const p of pins) {
  try {
    const r = await fetch(`https://track.delhivery.com/c/api/pin-codes/json/?filter_codes=${p}`,
      { headers: { Authorization: "Token " + T, Accept: "application/json" } });
    const j = await r.json();
    const code = j.delivery_codes?.[0]?.postal_code;
    // No record at all is their way of saying not serviced. A record that
    // refuses prepaid is, for us, the same answer.
    answer.set(p, !code ? false : String(code.pre_paid ?? "Y").toUpperCase() !== "N");
  } catch { /* leave unknown — never treated as a refusal */ }
  process.stdout.write(D(`  checked ${answer.size}/${pins.length}\r`));
}
console.log(" ".repeat(40) + "\r");
const no = [...answer.entries()].filter(([, v]) => v === false).map(([p]) => p);
console.log(`  ${G(pins.filter(p => answer.get(p) === true).length)} serviceable · ${no.length ? R(no.length) : D(0)} not · ${D((pins.length - answer.size) + " unknown")}`);
if (no.length) console.log(R(`  Delhivery does not deliver to: ${no.join(", ")}`));

if (!WRITE) { console.log(`\n${Y("Dry run. Re-run with --write to save.")}\n`); process.exit(0); }

let refs = 0;
for (const m of mint) {
  const r = await fetch(`${U}/rest/v1/orders?order_number=eq.${encodeURIComponent(m.order_number)}&or=(courier_reference.is.null,courier_reference.eq.)`, {
    method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ courier_reference: m.reference, updated_at: new Date().toISOString() }),
  });
  if (r.ok) refs++; else console.log(R(`  ${m.order_number}: ${await r.text()}`));
}

let pinned = 0;
for (const [pin, serviceable] of answer) {
  const targets = needPin.filter(o => (o.pincode || "").replace(/\D/g, "") === pin).map(o => o.order_number);
  if (!targets.length) continue;
  const r = await fetch(`${U}/rest/v1/orders?order_number=in.(${targets.join(",")})`, {
    method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ pincode_serviceable: serviceable, pincode_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  if (r.ok) pinned += targets.length;
}
console.log(`\n${G(`${refs} reference(s) minted, ${pinned} parcel(s) pincode-checked.`)}\n`);
