#!/usr/bin/env node
/**
 * Record marketing consent for contacts who gave us their number at checkout.
 *
 *   node scripts/crm-consent-backfill.mjs           # dry run
 *   node scripts/crm-consent-backfill.mjs --write
 *
 * Why this exists
 * ───────────────
 * Meta classifies the campaign templates as MARKETING, and the send gate
 * refuses a MARKETING template to any contact without `marketing_opt_in_at`.
 * Nothing set that flag, so every campaign refused every recipient.
 *
 * The shop's decision is that entering your phone number at checkout, for a
 * specific order, is consent to be messaged about that order — which is
 * already the standing of every `order_confirmed` this app has ever sent to
 * the same numbers. This records that basis explicitly rather than leaving the
 * two standards silently different.
 *
 * What it will not touch
 * ──────────────────────
 *   * A contact with no order. Somebody who only ever messaged the number has
 *     not been through a checkout and has consented to nothing.
 *   * A contact who has opted out. The stop flag wins over everything,
 *     including this — that is the whole point of it, and a backfill that
 *     could undo one would make the flag worthless.
 *   * A contact who already has an opt-in date. It records when consent was
 *     first given, so it is never overwritten with a later one.
 *
 * Every write gets an audit row naming the order it was based on, so the
 * question "why is this person marketable?" has an answer per contact rather
 * than a note in a commit message.
 *
 * Safe to re-run, and now normally a no-op. `upsertContact` records the same
 * consent on the same basis the moment it sees an order, so new customers no
 * longer arrive unmarketable and this no longer has to be run periodically to
 * keep campaigns from refusing everybody.
 *
 * Kept for the one thing that fix cannot do: a contact whose row already
 * existed before it landed. This is what caught up the 1,783 of those.
 */

import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const WRITE = process.argv.includes("--write");
const BATCH = 100;

/**
 * Eligible contacts.
 *
 * The three conditions are the three exclusions above, expressed as a filter
 * rather than checked in a loop — a row that does not match cannot be written
 * to even by a bug further down.
 */
async function eligible() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(
      `${URL_BASE}/rest/v1/whatsapp_contacts` +
        `?select=id,phone,display_name,last_order_number` +
        `&last_order_number=not.is.null` +
        `&opt_out_at=is.null` +
        `&marketing_opt_in_at=is.null` +
        `&order=created_at.asc&limit=1000&offset=${offset}`,
      { headers: H }
    );
    const page = await res.json();
    if (!Array.isArray(page)) {
      console.error("Read failed:", page);
      process.exit(1);
    }
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

const contacts = await eligible();

console.log(`${WRITE ? "WRITING" : "DRY RUN"} — ${contacts.length} contacts eligible\n`);
for (const c of contacts.slice(0, 5)) {
  console.log(`  ${c.phone}  ${(c.display_name ?? "").slice(0, 22).padEnd(22)} ${c.last_order_number}`);
}
if (contacts.length > 5) console.log(`  … and ${contacts.length - 5} more`);

if (!contacts.length) {
  console.log("\nNothing to do.");
  process.exit(0);
}

if (!WRITE) {
  console.log("\nRe-run with --write to record consent.");
  process.exit(0);
}

const at = new Date().toISOString();
let written = 0;

for (let i = 0; i < contacts.length; i += BATCH) {
  const slice = contacts.slice(i, i + BATCH);

  // The filter is repeated on the write, not just the read. Between the two
  // somebody could have opted out, and the stop flag has to win even against
  // a job that already decided they were eligible.
  const res = await fetch(
    `${URL_BASE}/rest/v1/whatsapp_contacts` +
      `?id=in.(${slice.map((c) => c.id).join(",")})` +
      `&opt_out_at=is.null&marketing_opt_in_at=is.null`,
    {
      method: "PATCH",
      headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({ marketing_opt_in_at: at, updated_at: at }),
    }
  );

  const updated = await res.json();
  if (!Array.isArray(updated)) {
    console.error("Write failed:", updated);
    process.exit(1);
  }
  written += updated.length;

  await fetch(`${URL_BASE}/rest/v1/audit_log`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(
      slice.map((c) => ({
        actor_id: null,
        actor_email: "system:consent-backfill",
        action: "crm.marketing.opt_in",
        entity: "whatsapp_contact",
        entity_id: c.id,
        meta: {
          basis: "checkout",
          order_number: c.last_order_number,
          phone: c.phone,
          note: "Number given at checkout for this order; shop treats that as consent to message about it.",
        },
      }))
    ),
  });

  process.stdout.write(`\r  ${written}/${contacts.length}`);
}

console.log(`\n\nRecorded consent for ${written} contacts, each with an audit row.`);
