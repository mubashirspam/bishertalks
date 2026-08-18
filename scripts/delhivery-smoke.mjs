#!/usr/bin/env node
/**
 * Prove the Delhivery integration works before trusting it.
 *
 *   node scripts/delhivery-smoke.mjs --serviceability 673001
 *   node scripts/delhivery-smoke.mjs --manifest
 *   node scripts/delhivery-smoke.mjs --track <waybill>
 *   node scripts/delhivery-smoke.mjs --cancel <waybill>
 *
 * Task 0.4 of docs/delhivery-integration-plan.md, made repeatable: the payload
 * the app sends has never been accepted by Delhivery, and their errors are
 * terse. Start with --serviceability, which is read-only and proves the token
 * and the host agree.
 *
 * It runs against whichever host DELHIVERY_ENV names. On production
 * --manifest additionally needs --yes-create-real-shipment, because there the
 * result is a live parcel Delhivery will collect and bill for.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RED = "\x1b[31m", GREEN = "\x1b[32m", DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const env = {};
try {
  for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.error(`${RED}Could not read .env.local${OFF}`);
  process.exit(1);
}

// Staging and production take DIFFERENT tokens. A production token answers
// "Login or API Key Required" against staging, which is the single most
// confusing failure in this integration — so the host is chosen explicitly and
// printed, rather than assumed.
const PROD = (env.DELHIVERY_ENV || "staging").toLowerCase() === "production";
const BASE = PROD
  ? "https://track.delhivery.com"
  : "https://staging-express.delhivery.com";

const TOKEN = env.DELHIVERY_API_TOKEN;
if (!TOKEN) {
  console.error(`${RED}DELHIVERY_API_TOKEN is not set.${OFF}`);
  process.exit(1);
}

console.log(`${DIM}host: ${BASE}${OFF}`);

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => args[args.indexOf(flag) + 1];

async function call(path, { method = "GET", form, json, query, contentType } = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const headers = { Authorization: `Token ${TOKEN}`, Accept: "application/json" };
  let body;
  if (form !== undefined) {
    headers["Content-Type"] = contentType ?? "application/x-www-form-urlencoded";
    body = form;
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  console.log(`${DIM}→ ${method} ${url}${OFF}`);
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();

  console.log(`${res.ok ? GREEN : RED}← ${res.status}${OFF}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 2000));
  }
  return { ok: res.ok, text };
}

// ── Serviceability: read-only, and the cheapest proof the token works ────────
if (has("--serviceability")) {
  const pin = valueOf("--serviceability") ?? "673001";
  console.log(`\n${BOLD}Pincode serviceability — ${pin}${OFF}`);
  await call("/c/api/pin-codes/json/", { query: { filter_codes: pin } });
}

// ── Manifest: creates a shipment on staging ──────────────────────────────────
if (has("--manifest")) {
  // The only call here that creates something real. On production it needs to
  // be asked for twice — the resulting parcel is a live shipment Delhivery
  // will try to collect and charge for.
  if (PROD && !has("--yes-create-real-shipment")) {
    console.error(
      `${RED}This is a PRODUCTION token — --manifest would create a real shipment.\n` +
        `If that is what you want, add --yes-create-real-shipment, and cancel it\n` +
        `afterwards with --cancel <waybill>.${OFF}`
    );
    process.exit(1);
  }

  const pickup = env.DELHIVERY_PICKUP_LOCATION;
  if (!pickup) {
    console.error(
      `${RED}Set DELHIVERY_PICKUP_LOCATION in .env.local first — it must match a\n` +
        `warehouse Delhivery has registered, exactly, or they reject the payload.${OFF}`
    );
    process.exit(1);
  }

  // A deliberately obvious test order number, so anything it creates is easy to
  // recognise and cancel afterwards.
  const orderId = `SMOKE-${Date.now().toString(36).toUpperCase()}`;

  const payload = {
    shipments: [
      {
        name: "SMOKE TEST",
        add: "Ground Floor, Hi Dawn Tower, Kuniyil Kavu Road, Kozhikode,9999999999",
        pin: "673001",
        city: "Kozhikode",
        state: "Kerala",
        country: "India",
        phone: "9999999999",
        order: orderId,
        waybill: "",
        payment_mode: "Prepaid",
        total_amount: 699,
        cod_amount: 0,
        products_desc: "BOOK",
        quantity: 1,
        weight: 250,
        shipment_length: 10,
        shipment_width: 10,
        shipment_height: 10,
        fragile_shipment: "true",
        shipping_mode: env.DELHIVERY_MODE || "Surface",
        seller_name: "BISHER",
        seller_add: "KOZHIKODE-6282680794",
        seller_gst_tin: env.DELHIVERY_SELLER_GST || "",
        hsn_code: env.DELHIVERY_HSN_CODE || "4901",
        return_add: "GROUND FLOOR, 63/2069/C2, HI DAWN TOWER, KUNIYIL KAVU ROAD, KOZHIKODE",
        return_pin: "673001",
        return_name: "BISHER",
        client: env.DELHIVERY_CLIENT_NAME || "",
      },
    ],
    pickup_location: { name: pickup },
  };

  console.log(`\n${BOLD}Manifest — order ${orderId}${OFF}`);
  console.log(`${DIM}${JSON.stringify(payload, null, 2)}${OFF}`);
  // Content-Type json with a form-shaped body, and the JSON NOT url-encoded —
  // exactly as Delhivery's own Postman collection sends it, and exactly what
  // lib/delhivery/manifest.ts does.
  await call("/api/cmu/create.json", {
    method: "POST",
    form: `format=json&data=${JSON.stringify(payload)}`,
    contentType: "application/json",
  });
  console.log(
    `\n${DIM}If a waybill came back, cancel it:\n` +
      `  node scripts/delhivery-smoke.mjs --cancel <waybill>${OFF}`
  );
}

if (has("--track")) {
  const waybill = valueOf("--track");
  console.log(`\n${BOLD}Track — ${waybill}${OFF}`);
  await call("/api/v1/packages/json/", { query: { waybill } });
}

if (has("--cancel")) {
  const waybill = valueOf("--cancel");
  console.log(`\n${BOLD}Cancel — ${waybill}${OFF}`);
  await call("/api/p/edit", {
    method: "POST",
    json: { waybill, cancellation: "true" },
  });
}

if (!args.length) {
  console.log(
    `${BOLD}Usage${OFF}\n` +
      `  --serviceability <pin>   read-only; start here\n` +
      `  --manifest               CREATES A SHIPMENT (needs --yes-create-real-shipment on prod)\n` +
      `  --track <waybill>\n` +
      `  --cancel <waybill>\n`
  );
}
