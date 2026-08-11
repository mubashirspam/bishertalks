#!/usr/bin/env node
/**
 * Post one sample event to the Make.com scenario, to check the wiring end to
 * end without touching an order.
 *
 *   node scripts/test-make.mjs --phone=9876543210
 *   node scripts/test-make.mjs --phone=9876543210 --event=order.shipped
 *   node scripts/test-make.mjs --phone=9876543210 --event=all --real
 *
 * Events: payment.received | order.confirmed | order.shipped |
 *         order.delivered | course.access | all
 * Defaults to payment.received.
 *
 * By default the payload carries env "development", so the scenario's env
 * filter drops it and NO WhatsApp message is sent — you are testing that Make
 * receives and parses the payload. Add --real to send env "production" and
 * have a message actually arrive on the handset.
 *
 * Touches no orders and writes nothing.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const env = {};
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const unset = (v) => !v || /^(your_|PASTE_|<<|https:\/\/hook\.REGION)/.test(v);

const url = env.MAKE_WEBHOOK_URL;
const secret = env.MAKE_WEBHOOK_SECRET;
const appUrl = env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";

if (unset(url)) {
  console.log(`${RED}MAKE_WEBHOOK_URL is not set in .env.local${OFF}`);
  console.log(`${DIM}Create the scenario first — see MAKE_WHATSAPP.md step 2.${OFF}`);
  process.exit(1);
}
if (unset(secret)) {
  console.log(`${YELLOW}MAKE_WEBHOOK_SECRET is not set — the scenario will reject this.${OFF}`);
}

const rawPhone = String(args.phone ?? "");
const digits = rawPhone.replace(/\D/g, "").replace(/^91/, "");
if (digits.length !== 10) {
  console.log(`${RED}Pass a 10-digit Indian mobile: --phone=9876543210${OFF}`);
  process.exit(1);
}

const real = args.real === true;
const stamp = Date.now();
const orderNumber = "ORD-TEST01";

/** Same shape lib/notify.ts builds. Keep the two in step. */
const base = {
  version: 1,
  sent_at: new Date().toISOString(),
  env: real ? "production" : "development",
  customer: {
    name: "Test User",
    phone: `+91${digits}`,
    phone_digits: digits,
    email: "test@example.com",
  },
  order: {
    number: orderNumber,
    amount: 599,
    amount_paise: 59900,
    currency: "INR",
    status: "confirmed",
    payment_status: "paid",
    product: "Neuro Code",
    address: {
      line1: "12 MG Road",
      line2: null,
      city: "Kochi",
      district: "Ernakulam",
      state: "Kerala",
      pincode: "682001",
      short: "Kochi, Kerala",
    },
    courier: "BlueDart",
    tracking_number: "1234567890",
    expected_delivery: "12 Aug 2026",
    payment_link_url: null,
  },
  links: {
    address: `${appUrl}/neuro-code/address?id=${orderNumber}&t=sample`,
    tracking: `${appUrl}/neuro-code/track?id=${orderNumber}`,
    site: `${appUrl}/neuro-code`,
    course: `${appUrl}/courses/nlp`,
  },
  course: null,
};

const EVENTS = [
  "payment.received",
  "order.confirmed",
  "order.shipped",
  "order.delivered",
  "course.access",
];

const chosen = args.event === "all" ? EVENTS : [String(args.event ?? "payment.received")];

for (const event of chosen) {
  if (!EVENTS.includes(event)) {
    console.log(`${RED}Unknown event "${event}"${OFF}`);
    console.log(`Available: ${EVENTS.join(" | ")} | all`);
    process.exit(1);
  }
}

console.log(
  `\n${BOLD}Posting${OFF} ${chosen.length} event(s) → Make  ` +
    `${DIM}(env: ${real ? "production — a real message will be sent" : "development — scenario should drop it"})${OFF}`
);

let failed = 0;

for (const event of chosen) {
  const payload = {
    ...base,
    event,
    event_id: `${orderNumber}:${event}:test:${stamp}`,
    course:
      event === "course.access"
        ? {
            title: "Neuro Linguistic Programming",
            slug: "nlp",
            url: `${appUrl}/courses/nlp`,
            login_phone: digits,
          }
        : null,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bisher-Secret": secret ?? "",
        "X-Bisher-Event": event,
        "X-Bisher-Delivery": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text().catch(() => "");

    if (res.ok) {
      console.log(`${GREEN}  ✓ ${event}${OFF} ${DIM}HTTP ${res.status} ${text.slice(0, 60)}${OFF}`);
    } else {
      failed++;
      console.log(`${RED}  ✗ ${event}${OFF} ${DIM}HTTP ${res.status} ${text.slice(0, 200)}${OFF}`);
    }
  } catch (e) {
    failed++;
    console.log(`${RED}  ✗ ${event}${OFF} ${DIM}${e.message}${OFF}`);
  }
}

if (failed) {
  console.log(`\n${BOLD}Likely causes${OFF}`);
  console.log(`${DIM}  404  the scenario is off, or the webhook URL is stale.
  400  Make is still waiting to "determine the data structure" — hit Run once,
       post again, then click "Save the structure".
  410  the webhook was deleted in Make.
  timeouts — the scenario has no early "Webhook response" module, so Make is
       holding the connection until the whole run finishes.${OFF}`);
} else {
  console.log(
    `\n${GREEN}All accepted.${OFF} ${DIM}Open the scenario → History to see the run.` +
      `${real ? "" : "\n  Nothing was sent to WhatsApp — add --real for that."}${OFF}`
  );
}

console.log("");
process.exit(failed ? 1 : 0);
