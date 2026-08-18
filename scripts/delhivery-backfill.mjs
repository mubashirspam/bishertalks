#!/usr/bin/env node
/**
 * Catch our records up with where Delhivery says the parcels actually are.
 *
 *   node scripts/delhivery-backfill.mjs                 # dry run, changes nothing
 *   node scripts/delhivery-backfill.mjs --limit 50      # dry run, first 50
 *   node scripts/delhivery-backfill.mjs --write         # actually save
 *
 * Every parcel that went out on the Excel sheet carries a Reference No from
 * `courier_reference` (migration 0024), and Delhivery indexes on it — so a year
 * of parcels handed over on a spreadsheet can be looked up without anyone ever
 * typing a waybill in. This stores the waybill it gets back and moves the order
 * to whatever Delhivery's latest scan says.
 *
 * DELIBERATELY SILENT. It sends no WhatsApp messages. This is a catch-up on
 * history — a customer who has been holding their book for a week should not
 * get "your parcel has shipped" today, and several hundred of those at once is
 * how a business number gets reported. Ordinary tracking from here on (the
 * poller and the webhook) does notify.
 *
 * Referral commissions ARE settled, through the same RPCs the admin uses, so a
 * parcel that turns out to be delivered pays the referrer exactly as it would
 * have done had someone ticked it off by hand.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const env = {};
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = env.DELHIVERY_API_TOKEN;
if (!SUPA || !KEY || !TOKEN) {
  console.error(`${RED}Missing Supabase or Delhivery credentials in .env.local${OFF}`);
  process.exit(1);
}

// Tracking is read-only, so it runs against production regardless of
// DELHIVERY_ENV — the parcels we are asking about are real ones.
const DELHIVERY = "https://track.delhivery.com";
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 2000;
const BATCH = 50; // Delhivery's cap per tracking call

const sb = (path, init = {}) =>
  fetch(`${SUPA}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

/**
 * Mirrors lib/delhivery/status.ts. Kept in step by hand because this is a
 * standalone script — if the mapping there changes, change it here.
 */
function statusFromScan(status, statusType) {
  const type = (statusType ?? "").trim().toUpperCase();
  const text = (status ?? "").trim().toLowerCase();
  const isRto = text.includes("rto") || text.includes("dto") || type === "RT";

  if (isRto && (text.includes("delivered") || text.includes("received"))) return "returned";
  if (isRto) return null;
  if (type === "DL" || text === "delivered") return "delivered";
  if (text.includes("dispatched") || text.includes("out for delivery")) return "out_for_delivery";
  if (text.includes("in transit") || text.includes("intransit")) return "shipped";
  if (text.includes("picked") && !text.includes("not picked")) return "shipped";
  if (text.includes("manifested") || text.includes("not picked") || type === "PP") return "processing";
  return null;
}

const RANK = { confirmed: 0, processing: 1, shipped: 2, out_for_delivery: 3, delivered: 4 };
const TERMINAL = new Set(["delivered", "returned", "cancelled"]);

function canMoveTo(current, next) {
  if (current === next) return false;
  if (next === "returned") return !TERMINAL.has(current);
  if (TERMINAL.has(current)) return false;
  const from = RANK[current], to = RANK[next];
  return from !== undefined && to !== undefined && to > from;
}

// ── Load the parcels ─────────────────────────────────────────────────────────
console.log(`\n${BOLD}Delhivery backfill${OFF} ${DIM}${WRITE ? "WRITING" : "dry run — nothing will be saved"}${OFF}\n`);

const res = await sb(
  `orders?select=order_number,courier_reference,tracking_number,status,courier_last_scan` +
    `&courier_reference=not.is.null` +
    `&status=in.(confirmed,processing,shipped,out_for_delivery)` +
    `&order=created_at.desc&limit=${LIMIT}`
);
const orders = await res.json();
if (!Array.isArray(orders)) {
  console.error(`${RED}Could not read orders:${OFF}`, orders);
  process.exit(1);
}

const byRef = new Map(orders.map((o) => [o.courier_reference, o]));
console.log(`${orders.length} parcel(s) to check\n`);

const plan = [];        // { order, from, to, waybill, scan }
const scanOnly = [];    // waybill/scan learned, status unchanged
const unknown = [];     // Delhivery has never heard of it
let asked = 0;

const refs = [...byRef.keys()];
for (let i = 0; i < refs.length; i += BATCH) {
  const batch = refs.slice(i, i + BATCH);
  asked += batch.length;

  let data;
  try {
    const r = await fetch(`${DELHIVERY}/api/v1/packages/json/?ref_ids=${batch.join(",")}`, {
      headers: { Authorization: `Token ${TOKEN}`, Accept: "application/json" },
    });
    data = await r.json();
  } catch (e) {
    console.log(`${RED}  batch ${i / BATCH + 1} failed: ${e.message}${OFF}`);
    continue;
  }

  const seen = new Set();
  for (const entry of data.ShipmentData ?? []) {
    const sh = entry.Shipment ?? {};
    const st = sh.Status ?? {};
    const order = byRef.get(String(sh.ReferenceNo));
    if (!order || !sh.AWB) continue;
    seen.add(String(sh.ReferenceNo));

    const next = statusFromScan(st.Status, st.StatusType);
    const scanText = [st.Status, st.StatusLocation].filter(Boolean).join(" — ");
    const row = {
      order,
      waybill: String(sh.AWB),
      scan: scanText,
      scanAt: st.StatusDateTime ?? null,
      from: order.status,
      to: next && canMoveTo(order.status, next) ? next : null,
    };
    (row.to ? plan : scanOnly).push(row);
  }
  for (const ref of batch) if (!seen.has(ref)) unknown.push(byRef.get(ref));

  process.stdout.write(`${DIM}  checked ${Math.min(asked, refs.length)}/${refs.length}\r${OFF}`);
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(" ".repeat(40) + "\r");

const moves = {};
for (const p of plan) {
  const k = `${p.from} → ${p.to}`;
  moves[k] = (moves[k] ?? 0) + 1;
}

console.log(`${BOLD}Status changes${OFF}`);
if (!plan.length) console.log(`${DIM}  none${OFF}`);
for (const [k, v] of Object.entries(moves).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${GREEN}${String(v).padStart(4)}${OFF}  ${k}`);
}

console.log(`\n${BOLD}Waybill + scan only${OFF} ${DIM}(status already correct)${OFF}`);
console.log(`  ${String(scanOnly.length).padStart(4)}  parcels`);

console.log(`\n${BOLD}Not found at Delhivery${OFF}`);
console.log(`  ${unknown.length ? YELLOW : DIM}${String(unknown.length).padStart(4)}${OFF}  parcels`);
for (const o of unknown.slice(0, 10)) {
  console.log(`${DIM}        ${o.order_number}  ref=${o.courier_reference}${OFF}`);
}
if (unknown.length > 10) console.log(`${DIM}        …and ${unknown.length - 10} more${OFF}`);

console.log(`\n${BOLD}Sample${OFF}`);
for (const p of plan.slice(0, 8)) {
  console.log(`  ${p.order.order_number}  ${p.from} → ${GREEN}${p.to}${OFF}  ${DIM}${p.waybill}  ${p.scan}${OFF}`);
}

if (!WRITE) {
  console.log(`\n${YELLOW}Dry run. Re-run with --write to save.${OFF}\n`);
  process.exit(0);
}

// ── Write ────────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Writing…${OFF}`);

let saved = 0, failed = 0;

// Waybill and last scan for everything we found — plain column writes, no
// status involved, so they are safe to apply in one pass.
for (const row of [...plan, ...scanOnly]) {
  const r = await sb(`orders?order_number=eq.${encodeURIComponent(row.order.order_number)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      tracking_number: row.waybill,
      courier_last_scan: row.scan.slice(0, 300),
      courier_last_scan_at: row.scanAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (r.ok) saved++;
  else { failed++; console.log(`${RED}  ${row.order.order_number}: ${await r.text()}${OFF}`); }
}
console.log(`  ${saved} waybill/scan saved${failed ? `, ${RED}${failed} failed${OFF}` : ""}`);

// Status changes go through the same RPC the admin uses, so the referral
// consequences below stay identical to a parcel ticked off by hand.
const byStatus = {};
for (const p of plan) (byStatus[p.to] ??= []).push(p.order.order_number);

for (const [status, numbers] of Object.entries(byStatus)) {
  const r = await sb(`rpc/set_delivery_status`, {
    method: "POST",
    body: JSON.stringify({ p_order_numbers: numbers, p_status: status, p_courier: "Delhivery" }),
  });
  const updated = r.ok ? await r.json() : [];
  console.log(`  ${Array.isArray(updated) ? updated.length : 0} → ${status}`);

  // Same settlement the admin path performs. Delivered pays the referrer;
  // returned takes it back. Skipping this would silently underpay people.
  if (status === "delivered" && updated.length) {
    await sb(`rpc/approve_referral_commissions`, {
      method: "POST",
      body: JSON.stringify({ p_order_numbers: updated }),
    });
    console.log(`${DIM}    referral commissions approved${OFF}`);
  }
  if (status === "returned" && updated.length) {
    await sb(`rpc/void_referral_commissions`, {
      method: "POST",
      body: JSON.stringify({ p_order_numbers: updated }),
    });
    console.log(`${DIM}    referral commissions voided${OFF}`);
  }
}

console.log(`\n${GREEN}${BOLD}Done.${OFF} No customer messages were sent.\n`);
