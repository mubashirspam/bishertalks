#!/usr/bin/env node
/**
 * Prove the India Post sandbox is reachable, one call at a time.
 *
 *   node scripts/india-post-smoke.mjs
 *
 * Read-only: it logs in, prices a parcel and reads a tracking number. It books
 * nothing and spends no article number.
 *
 * Run this the moment the portal work is done. It answers, in order, the three
 * things that can be wrong before any code matters: is this machine's IP
 * whitelisted, do the credentials work, and are the APIs actually subscribed.
 * Each failure prints what to go and change rather than the raw error.
 */
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const BASE = env.INDIA_POST_BASE_URL || "https://test.cept.gov.in/beextcustomer";
const USER = env.INDIA_POST_USERNAME, PASS = env.INDIA_POST_PASSWORD;
const CUST = env.INDIA_POST_CUSTOMER_ID;

const G = t => `\x1b[32m${t}\x1b[0m`, R = t => `\x1b[31m${t}\x1b[0m`,
      Y = t => `\x1b[33m${t}\x1b[0m`, D = t => `\x1b[2m${t}\x1b[0m`, B = t => `\x1b[1m${t}\x1b[0m`;

console.log(`\n${B("India Post sandbox smoke test")}  ${D(BASE)}\n`);

if (!USER || !PASS) {
  console.log(R("INDIA_POST_USERNAME / INDIA_POST_PASSWORD are not set in .env.local."));
  console.log(D("  These are the Customer Selfservice Portal login, not a separate API key.\n"));
  process.exit(1);
}

// What this machine looks like from outside — the address that must be on the
// UAT whitelist. Printed first because it is the answer to the most likely
// failure below.
let ip = "unknown";
try { ip = (await (await fetch("https://api.ipify.org")).text()).trim(); } catch { /* offline */ }
console.log(`${D("This machine's public IP:")} ${B(ip)}`);
console.log(D("It must appear under UAT Environment at /customer-selfservice/whitelist-ip-address\n"));

// ── 1. Log in ────────────────────────────────────────────────────────────────
process.stdout.write("1. Access token (AUTH02) … ");
let token;
try {
  const r = await fetch(`${BASE}/v1/access/TokenWithRtoken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const text = await r.text();

  if (r.status === 403) {
    console.log(R("blocked"));
    console.log(R(`   Their gateway refused this address. Add ${ip} to the UAT whitelist and retry.`));
    console.log(D(`   ${text.slice(0, 200)}\n`));
    process.exit(1);
  }
  if (!r.ok) {
    console.log(R(`HTTP ${r.status}`));
    console.log(D(`   ${text.slice(0, 300)}`));
    console.log(Y("   If this says the API is not subscribed, subscribe AUTH01/AUTH02 in the portal.\n"));
    process.exit(1);
  }

  const body = JSON.parse(text);
  token = body?.data?.access_token;
  if (!token) {
    console.log(R("no token in the response"));
    console.log(D(`   ${text.slice(0, 300)}\n`));
    process.exit(1);
  }
  console.log(G("ok") + D(`  expires in ${body.data.expires_in}s, refresh token ${body.data.refresh_token ? "present" : "absent"}`));
} catch (e) {
  console.log(R("failed"));
  console.log(D(`   ${e.message}\n`));
  process.exit(1);
}

const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };

const call = async (label, url, init = {}) => {
  process.stdout.write(`${label} … `);
  try {
    const r = await fetch(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    const text = await r.text();
    if (!r.ok) {
      console.log(R(`HTTP ${r.status}`));
      console.log(D(`   ${text.slice(0, 300)}`));
      return null;
    }
    console.log(G("ok"));
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    console.log(R("failed"));
    console.log(D(`   ${e.message}`));
    return null;
  }
};

// ── 2. Tariff ────────────────────────────────────────────────────────────────
// One real book to a real Kerala pincode: 380 g, 25 x 15 x 2.5 cm, Kozhikode
// to Malappuram. This is also the call that settles the single-book article
// type question — read product_code in the answer.
const tariff = await call(
  "2. Speed Post tariff (TCD02)",
  `${BASE}/v1/speed-post/tariffs?product-code=SP&weight=380&source-pincode=673001&destination-pincode=676105&length=25&width=15&height=2.5`
);
if (tariff) {
  console.log(D(`   product_code ${B(tariff.product_code)} · chargeable ${tariff.chargeable_weight} g · final ₹${tariff.final_amount}`));
  if (tariff.product_code === "SP_INLAND_DOC") {
    console.log(Y("   ↑ priced as a DOCUMENT, whose height limit is 2 cm. Ours is 2.5."));
    console.log(Y("     This is the open question — ask whether it may be booked as SP_INLAND_PARCEL."));
  }
}

// A two-book parcel, which is unambiguous, as the control.
const tariff2 = await call(
  "3. Same, two books (760 g)",
  `${BASE}/v1/speed-post/tariffs?product-code=SP&weight=760&source-pincode=673001&destination-pincode=676105&length=25&width=15&height=5`
);
if (tariff2) {
  console.log(D(`   product_code ${B(tariff2.product_code)} · chargeable ${tariff2.chargeable_weight} g · final ₹${tariff2.final_amount}`));
}

// ── 4. Tracking ──────────────────────────────────────────────────────────────
// A barcode from their own documentation. We expect either real events or a
// clean "not found" — both prove the endpoint answers us.
const tracked = await call("4. Bulk tracking (TNT02)", `${BASE}/v1/tracking/bulk`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ bulk: ["EB126023474IN"] }),
});
if (tracked) {
  const first = tracked?.data?.[0];
  console.log(D(`   ${first ? `${first.booking_details?.article_number}: ${first.tracking_details?.length ?? 0} events, ${first.del_status?.del_status ?? "—"}` : "no data for that article (fine — the endpoint answered)"}`));
}

console.log(`\n${D("Nothing was booked. No article number was spent.")}\n`);
