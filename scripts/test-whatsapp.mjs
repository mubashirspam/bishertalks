#!/usr/bin/env node
/**
 * Send one real WhatsApp template message, to check the setup end to end.
 *
 *   node scripts/test-whatsapp.mjs <phone> [template]
 *   node scripts/test-whatsapp.mjs 9876543210 course_access
 *
 * Templates: payment_received | order_confirmed | order_shipped |
 *             order_delivered | course_access
 * Defaults to course_access.
 *
 * Uses sample values, touches no orders and writes nothing. Meta's error
 * responses are decoded into plain English, because the raw ones are cryptic.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RED = "\x1b[31m", GREEN = "\x1b[32m", DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const [rawPhone, template = "course_access"] = process.argv.slice(2);
if (!rawPhone) {
  console.log("Usage: node scripts/test-whatsapp.mjs <phone> [template]");
  process.exit(1);
}

const env = {};
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const token = env.WHATSAPP_TOKEN;
const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
const appUrl = env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";

const unset = (v) => !v || /^(your_|PASTE_|<<)/.test(v);
if (unset(token) || unset(phoneId)) {
  console.log(`${RED}WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set in .env.local${OFF}`);
  console.log(`${DIM}See WHATSAPP_SETUP.md — you need a System User permanent token.${OFF}`);
  process.exit(1);
}

const digits = rawPhone.replace(/\D/g, "").replace(/^91/, "");
const to = `91${digits}`;

const SAMPLES = {
  payment_received: ["Test User", "ORD-TEST01", "599", `${appUrl}/neuro-code/address?id=ORD-TEST01&t=sample`],
  order_confirmed: ["Test User", "ORD-TEST01", "599", "Kochi, Kerala", "5–7 business days", `${appUrl}/neuro-code/track?id=ORD-TEST01`],
  order_shipped:   ["Test User", "ORD-TEST01", "BlueDart", "1234567890", "12 Aug 2026", `${appUrl}/neuro-code/track?id=ORD-TEST01`],
  order_delivered: ["Test User", "ORD-TEST01", `${appUrl}/neuro-code`],
  course_access:   ["Test User", "Neuro Linguistic Programming", `${appUrl}/courses/nlp`, digits],
};

const parameters = SAMPLES[template];
if (!parameters) {
  console.log(`${RED}Unknown template "${template}"${OFF}`);
  console.log(`Available: ${Object.keys(SAMPLES).join(" | ")}`);
  process.exit(1);
}

console.log(`\n${BOLD}Sending${OFF} ${template} → +${to}  ${DIM}(${parameters.length} variables)${OFF}`);

const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: "en" },
      components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }],
    },
  }),
});

const body = await res.json().catch(() => ({}));

if (res.ok) {
  console.log(`${GREEN}✓ Accepted by Meta — message id ${body.messages?.[0]?.id}${OFF}`);
  console.log(`${DIM}  "Accepted" only means queued. Check the handset actually receives it.${OFF}\n`);
  process.exit(0);
}

const err = body.error ?? {};
console.log(`${RED}✗ Failed (HTTP ${res.status})${OFF}`);
console.log(`${DIM}  ${err.message ?? JSON.stringify(body)}${OFF}`);

const m = `${err.message ?? ""} ${err.error_user_msg ?? ""}`.toLowerCase();
const hint =
  m.includes("template name does not exist") || m.includes("not found")
    ? `Template "${template}" isn't approved, or was created in a different language.\n  The code sends language "en" — English (US)/en_US will NOT match.`
  : m.includes("param") || m.includes("number of parameters")
    ? `Variable count mismatch. "${template}" must have exactly ${parameters.length} body variables.`
  : err.code === 190
    ? `Token is invalid or expired. The API Setup page token lasts 24h — use a System User permanent token.`
  : m.includes("re-engagement") || m.includes("24")
    ? `Outside the 24-hour window, which is expected — this is why an approved template is required.`
  : m.includes("phone") || m.includes("recipient")
    ? `Recipient rejected. In test mode Meta only delivers to numbers added as verified recipients.`
  : null;

if (hint) console.log(`\n${BOLD}Likely cause:${OFF}\n  ${hint}`);
console.log("");
process.exit(1);
