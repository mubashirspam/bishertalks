#!/usr/bin/env node
/**
 * Prove the Delhivery integration works before trusting it.
 *
 *   node scripts/delhivery-smoke.mjs --serviceability 673001
 *   node scripts/delhivery-smoke.mjs --track <waybill>
 *
 * Task 0.4 of docs/delhivery-integration-plan.md, made repeatable: the payload
 * the app sends has never been accepted by Delhivery, and their errors are
 * terse. Start with --serviceability, which is read-only and proves the token
 * and the host agree.
 *
 * Every call here is read-only. Creating shipments is KKR's job, so there is
 * no manifest option and there should not be one.
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

// Manifesting is deliberately absent. KKR LOGISTICS FRANCHISE creates the
// shipments; nothing in this repository may call /api/cmu/create.json, and a
// "just for testing" arm in a smoke script is exactly how that rule gets
// broken at 11pm. The endpoints below are all read-only.

if (has("--track")) {
  const waybill = valueOf("--track");
  console.log(`\n${BOLD}Track — ${waybill}${OFF}`);
  await call("/api/v1/packages/json/", { query: { waybill } });
}


if (!args.length) {
  console.log(
    `${BOLD}Usage${OFF}\n` +
      `  --serviceability <pin>   read-only; start here\n` +

      `  --track <waybill>\n`
  );
}
