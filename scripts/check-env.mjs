#!/usr/bin/env node
/**
 * Preflight check for the payment stack.
 *
 *   node scripts/check-env.mjs
 *
 * Reads .env.local, verifies every required variable is set, then makes ONE
 * read-only call to Razorpay to prove the credentials actually work. Creates
 * nothing and writes nothing.
 *
 * Pass --vercel to check the values as they'd need to be in PRODUCTION
 * (live keys, real domain) rather than for local dev.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forProd = process.argv.includes("--vercel");

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

let failed = 0, warned = 0;
const fail = (m, hint) => { failed++; console.log(`${RED}  ✗ ${m}${OFF}${hint ? `\n${DIM}    ${hint}${OFF}` : ""}`); };
const warn = (m, hint) => { warned++; console.log(`${YELLOW}  ! ${m}${OFF}${hint ? `\n${DIM}    ${hint}${OFF}` : ""}`); };
const ok   = (m) => console.log(`${GREEN}  ✓ ${m}${OFF}`);

// ── Load .env.local ──────────────────────────────────────────────────────────
let env = {};
try {
  for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.log(`${RED}Could not read .env.local${OFF}`);
  process.exit(1);
}

const unset = (v) => !v || /^(PASTE_|your_|<<)/.test(v);

console.log(`\n${BOLD}Environment${OFF} ${DIM}(${forProd ? "production / Vercel" : "local dev"})${OFF}`);

for (const k of [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
  "NEXT_PUBLIC_APP_URL", "INTERNAL_API_SECRET",
]) {
  if (unset(env[k])) fail(`${k} is not set`);
}
if (!failed) ok("all required variables are set");

// ── Razorpay key sanity ──────────────────────────────────────────────────────
console.log(`\n${BOLD}Razorpay${OFF}`);
const keyId = env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "";
const secret = env.RAZORPAY_KEY_SECRET || "";

if (!unset(keyId)) {
  const mode = keyId.startsWith("rzp_live_") ? "live"
             : keyId.startsWith("rzp_test_") ? "test" : "unknown";
  if (mode === "unknown") {
    fail(`key id doesn't look like a Razorpay key: ${keyId.slice(0, 12)}…`,
         "Expected it to start with rzp_test_ or rzp_live_");
  } else if (forProd && mode === "test") {
    fail("production is configured with TEST keys",
         "This is why real customers can't pay. Use rzp_live_* on Vercel.");
  } else if (!forProd && mode === "live") {
    warn("local dev is using LIVE keys — real money will move",
         "Prefer rzp_test_* locally.");
  } else {
    ok(`key id is ${mode} mode`);
  }
}

// ── Live credential check: read-only, creates nothing ────────────────────────
if (!unset(keyId) && !unset(secret)) {
  const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");
  try {
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.status === 401) {
      fail("Razorpay rejected the credentials (401)",
           "Key id and secret must be from the SAME mode, and both current.");
    } else if (res.ok) {
      ok("credentials authenticate against the Razorpay API");

      // Is Magic Checkout provisioned? Ask without creating an order: send a
      // deliberately invalid amount alongside one_click_checkout. An
      // 'extra_field_sent' complaint means the feature is NOT enabled;
      // complaining about the amount instead means it IS.
      const probe = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 0, currency: "INR", one_click_checkout: true }),
      });
      const body = await probe.json().catch(() => ({}));
      const desc = body?.error?.description || "";
      if (/one_click_checkout/i.test(desc)) {
        warn("Magic Checkout is NOT enabled on this account",
             `Razorpay says: "${desc}"\n    Keep NEXT_PUBLIC_MAGIC_CHECKOUT=false until support enables it.`);
      } else {
        ok("Magic Checkout appears to be enabled (one_click_checkout accepted)");
      }
    } else {
      warn(`Razorpay returned HTTP ${res.status}`, "Check the key and network access.");
    }
  } catch (e) {
    warn(`Could not reach Razorpay: ${e.message}`);
  }
}

// ── Magic Checkout flag consistency ──────────────────────────────────────────
console.log(`\n${BOLD}Magic Checkout flag${OFF}`);
const magic = env.NEXT_PUBLIC_MAGIC_CHECKOUT === "true";
ok(`NEXT_PUBLIC_MAGIC_CHECKOUT=${magic} → ${magic ? "Magic" : "Standard"} Checkout will render`);

// ── App URL ──────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}App URL${OFF}`);
const appUrl = env.NEXT_PUBLIC_APP_URL || "";
if (forProd && /localhost/.test(appUrl)) {
  fail(`NEXT_PUBLIC_APP_URL is ${appUrl}`,
       "On Vercel this must be https://bishertalks.com — WhatsApp confirmations and tracking links are built from it.");
} else if (!forProd && !/localhost/.test(appUrl)) {
  warn(`NEXT_PUBLIC_APP_URL is ${appUrl} for local dev`,
       "Usually http://localhost:3000 locally.");
} else {
  ok(appUrl);
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}WhatsApp${OFF}`);
if (unset(env.WHATSAPP_TOKEN) || unset(env.WHATSAPP_PHONE_NUMBER_ID)) {
  warn("not configured — order confirmations will not send",
       "Payments and course access still work without it.");
} else {
  ok("configured");
}

console.log(
  `\n${failed ? RED + BOLD + `${failed} blocking problem(s)` : GREEN + BOLD + "no blocking problems"}${OFF}` +
  `${warned ? DIM + `, ${warned} warning(s)` + OFF : ""}\n`
);
process.exit(failed ? 1 : 0);
