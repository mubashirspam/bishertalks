#!/usr/bin/env node
/**
 * Find old parcels the courier already has, without a reference to look them up by.
 *
 *   node scripts/delhivery-legacy-match.mjs          # dry run
 *   node scripts/delhivery-legacy-match.mjs --write  # save the confirmed ones
 *
 * Orders placed before migration 0024 have no courier_reference, but they are
 * in Delhivery's system under an earlier scheme. This tries every scheme we
 * know and — crucially — refuses to accept a match on the reference alone.
 *
 * BISH + a pincode collides constantly: hundreds of our parcels go to 673001,
 * so that candidate matches *somebody's* shipment nearly every time. Claiming
 * it would put one customer's waybill on another customer's order, and the
 * mistake would surface as a tracking link for a town they have never heard
 * of. So a candidate must also agree on two independent facts — the invoice
 * amount and the destination pincode, both of which Delhivery returns — and
 * disagree on none. Everything else is reported as ambiguous and left alone.
 *
 * Mirrors lib/delhivery/legacy.ts. Change one, change the other.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync("/Users/mymac/projects/web/bishertalks/.env.local", "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, T = env.DELHIVERY_API_TOKEN;
const h = { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" };
const R = t => `\x1b[31m${t}\x1b[0m`, G = t => `\x1b[32m${t}\x1b[0m`, Y = t => `\x1b[33m${t}\x1b[0m`, D = t => `\x1b[2m${t}\x1b[0m`, B = t => `\x1b[1m${t}\x1b[0m`;
const WRITE = process.argv.includes("--write");

const digits = p => { const d = (p || "").replace(/\D/g, ""); return d.length === 12 && d.startsWith("91") ? d.slice(2) : d; };

function candidates(o) {
  const d = digits(o.buyer_phone), pin = (o.pincode || "").replace(/\D/g, "");
  const out = [];
  if (d) { out.push("BISH" + d, "BISH" + d.slice(-6), "BISH" + d.slice(-5), "BISH" + d.slice(-4)); }
  if (/^\d{6}$/.test(pin)) out.push("BISH" + pin);
  out.push(o.order_number);
  return [...new Set(out)].filter(Boolean);
}

function corroborates(o, s) {
  const agreed = [], conflicted = [];
  const ours = Math.round((o.amount_paise || 0) / 100);
  if (s.invoiceAmount != null && ours > 0) {
    if (Math.round(s.invoiceAmount) === ours) agreed.push("amount"); else conflicted.push(`amount ${s.invoiceAmount}≠${ours}`);
  }
  const op = (o.pincode || "").replace(/\D/g, ""), tp = (s.destinationPin || "").replace(/\D/g, "");
  if (op && tp) { if (op === tp) agreed.push("pincode"); else conflicted.push(`pin ${tp}≠${op}`); }
  if (conflicted.length) return { ok: false, why: conflicted.join(", ") };
  if (agreed.length < 2) return { ok: false, why: agreed.length ? `only ${agreed[0]} agrees` : "nothing to check against" };
  return { ok: true, why: agreed.join("+") };
}

const page = async q => { let out = [], f = 0; for (;;) { const r = await fetch(`${U}/rest/v1/${q}&limit=1000&offset=${f}`, { headers: h }); const b = await r.json(); if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 200)); out.push(...b); if (b.length < 1000) break; f += 1000; } return out; };

const orders = await page(
  "orders?select=order_number,buyer_name,buyer_phone,pincode,amount_paise,status,courier_entered_at,created_at" +
  "&payment_status=eq.paid&address_line1=not.is.null&status=neq.cancelled" +
  "&or=(courier_reference.is.null,courier_reference.eq.)&or=(tracking_number.is.null,tracking_number.eq.)" +
  "&courier_entered_at=not.is.null&order=created_at.asc"
);

console.log(`\n${B("Legacy match")} ${D(WRITE ? "WRITING" : "dry run — nothing will be saved")}`);
console.log(`${orders.length} order(s) with no reference but marked handed over\n`);

// Which orders proposed each candidate. A candidate proposed by more than one
// order can never be claimed — we would be guessing which of them it is.
const proposedBy = new Map();
for (const o of orders) for (const c of candidates(o)) {
  if (!proposedBy.has(c)) proposedBy.set(c, []);
  proposedBy.get(c).push(o);
}
const allRefs = [...proposedBy.keys()];
console.log(D(`${allRefs.length} candidate references to try`));

const shipments = new Map();
for (let i = 0; i < allRefs.length; i += 50) {
  const batch = allRefs.slice(i, i + 50);
  try {
    const r = await fetch(`https://track.delhivery.com/api/v1/packages/json/?ref_ids=${batch.join(",")}`,
      { headers: { Authorization: "Token " + T, Accept: "application/json" } });
    const j = await r.json();
    for (const e of j.ShipmentData ?? []) {
      const sh = e.Shipment; if (!sh?.AWB) continue;
      // A LIST per reference, not one. Delhivery genuinely files two parcels
      // under BISH3317 — the old four-digit scheme collided — and keying a map
      // by reference made the second overwrite the first, so which customer an
      // order matched depended on response order.
      const key = String(sh.ReferenceNo);
      if (!shipments.has(key)) shipments.set(key, []);
      shipments.get(key).push({
        waybill: String(sh.AWB),
        invoiceAmount: Number.isFinite(Number(sh.InvoiceAmount)) ? Number(sh.InvoiceAmount) : null,
        destinationPin: sh.Consignee?.PinCode ? String(sh.Consignee.PinCode) : null,
        consigneeName: sh.Consignee?.Name ?? null,
        status: sh.Status?.Status ?? "",
      });
    }
  } catch (e) { console.log(R(`  batch ${i / 50 + 1} failed: ${e.message}`)); }
  process.stdout.write(D(`  tried ${Math.min(i + 50, allRefs.length)}/${allRefs.length}\r`));
}
console.log(" ".repeat(50) + "\r");

const confirmed = [], ambiguous = [], contested = [], nothing = [];
const claimed = new Set();

for (const o of orders) {
  let best = null;
  for (const c of candidates(o)) {
    const list = shipments.get(c); if (!list?.length) continue;
    if (proposedBy.get(c).length > 1) { contested.push({ o, c, n: proposedBy.get(c).length }); continue; }

    // Every shipment under this reference, not just one of them. Accepted only
    // if exactly one fits — two plausible answers is not a coin flip worth
    // taking when being wrong means a customer tracks another parcel.
    const fits = list.map(s => ({ s, v: corroborates(o, s) })).filter(r => r.v.ok);
    if (fits.length === 1) { best = { c, s: fits[0].s, why: fits[0].v.why }; break; }
    if (fits.length > 1) { ambiguous.push({ o, c, s: fits[0].s, why: `${fits.length} shipments fit equally well` }); continue; }
    ambiguous.push({ o, c, s: list[0], why: corroborates(o, list[0]).why + (list.length > 1 ? ` (of ${list.length} under this ref)` : "") });
  }
  if (best) {
    if (claimed.has(best.s.waybill)) { contested.push({ o, c: best.c, n: 2 }); continue; }
    claimed.add(best.s.waybill); confirmed.push({ o, ...best });
  } else if (!ambiguous.some(a => a.o.order_number === o.order_number) && !contested.some(a => a.o.order_number === o.order_number)) {
    nothing.push(o);
  }
}

console.log(`${B("RESULT")}`);
console.log(`  ${G(String(confirmed.length).padStart(4))}  confirmed — two facts agree, none conflict`);
console.log(`  ${Y(String(ambiguous.length).padStart(4))}  key matched but the shipment did not corroborate`);
console.log(`  ${Y(String(contested.length).padStart(4))}  candidate claimed by more than one order`);
console.log(`  ${D(String(nothing.length).padStart(4))}  no candidate found at the courier at all`);

if (confirmed.length) {
  console.log(`\n${B("WOULD CLAIM")}`);
  for (const m of confirmed.slice(0, 15))
    console.log(`  ${m.o.order_number}  ${String(m.c).padEnd(16)} -> ${m.s.waybill}  ${D(m.why + " | " + m.s.status)}`);
  if (confirmed.length > 15) console.log(D(`  …and ${confirmed.length - 15} more`));
}
if (ambiguous.length) {
  console.log(`\n${B("REFUSED — would have been a wrong match")}`);
  for (const a of ambiguous.slice(0, 12))
    console.log(`  ${a.o.order_number}  ${String(a.c).padEnd(16)} ${R(a.why)}  ${D("their consignee: " + (a.s.consigneeName || "?"))}`);
  if (ambiguous.length > 12) console.log(D(`  …and ${ambiguous.length - 12} more`));
}

if (!WRITE) { console.log(`\n${Y("Dry run. Re-run with --write to save the confirmed ones.")}\n`); process.exit(0); }

let saved = 0;
for (const m of confirmed) {
  const r = await fetch(`${U}/rest/v1/orders?order_number=eq.${encodeURIComponent(m.o.order_number)}`, {
    method: "PATCH", headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ tracking_number: m.s.waybill, courier_reference: m.c, updated_at: new Date().toISOString() }),
  });
  if (r.ok) saved++; else console.log(R(`  ${m.o.order_number}: ${await r.text()}`));
}
console.log(`\n${G(`${saved} waybill(s) attached.`)} Ambiguous and contested were left untouched.\n`);
