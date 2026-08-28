#!/usr/bin/env node
/**
 * The Malayalam message templates, and Meta's copy of them.
 *
 *   node scripts/whatsapp-templates.ts check    validate and print them
 *   node scripts/whatsapp-templates.ts list     what Meta has, and its status
 *   node scripts/whatsapp-templates.ts push     submit anything missing
 *
 * Templates are submitted from the definitions in lib/whatsapp-templates.ts
 * rather than typed into WhatsApp Manager by hand. Malayalam pasted through a
 * browser form picks up stray spaces and normalises characters, and either one
 * comes back days later as "template not found" on a live order.
 *
 * `push` only creates what is missing. Meta will not let an approved template's
 * text change through this endpoint — editing an approved template is a
 * different call and resets it to review — so a wording change means a new
 * name, or an edit in WhatsApp Manager. `list` is how you check what is live.
 *
 * Nothing here sends a message to anybody.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TEMPLATES,
  DRAFT_TEMPLATES,
  TEMPLATE_LANGUAGE,
  validateAllTemplates,
  variableCount,
  type TemplateDef,
} from "../lib/whatsapp-templates.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

// ── Environment ─────────────────────────────────────────────────────────────
// Same hand-rolled .env.local reader as scripts/check-env.mjs — one dependency
// avoided in a script that runs a handful of times a year.
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
try {
  for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    if (!env[key]) env[key] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // Fine — the variables may come from the shell instead.
}

const API_VERSION = env.WHATSAPP_API_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

function credentials(): { token: string; wabaId: string } {
  const token = env.WHATSAPP_TOKEN;
  const wabaId = env.WHATSAPP_WABA_ID;
  if (!token || !wabaId) {
    console.log(
      `${RED}WHATSAPP_TOKEN and WHATSAPP_WABA_ID must be set.${OFF}\n` +
        `${DIM}See META_WHATSAPP.md — you need a permanent system-user token with\n` +
        `whatsapp_business_management, and the WhatsApp Business Account id.${OFF}`
    );
    process.exit(1);
  }
  return { token, wabaId };
}

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  /** Only present when Meta rejected it. */
  rejected_reason?: string;
}

async function fetchExisting(): Promise<MetaTemplate[]> {
  const { token, wabaId } = credentials();
  const url =
    `${GRAPH}/${wabaId}/message_templates` +
    `?fields=id,name,language,status,category,rejected_reason&limit=200`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { data?: MetaTemplate[]; error?: { message: string } };

  if (json.error) {
    console.log(`${RED}Meta refused the request: ${json.error.message}${OFF}`);
    process.exit(1);
  }
  return json.data ?? [];
}

/** The shape Meta wants: a BODY, and BUTTONS when the template has any. */
function componentsFor(def: TemplateDef) {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: def.body,
      // Required whenever the body has variables: Meta reviews the message as
      // a customer would see it, not as a string full of {{1}}.
      ...(def.example.length ? { example: { body_text: [def.example] } } : {}),
    },
  ];

  // All buttons go in one component — Meta reads them as an ordered set, not
  // as one component each. `example` is the whole URL filled in, and only
  // belongs on a button whose URL actually varies.
  if (def.buttons?.length) {
    components.push({
      type: "BUTTONS",
      buttons: def.buttons.map((b) =>
        b.type === "URL"
          ? {
              type: "URL",
              text: b.text,
              url: b.url,
              ...(b.param ? { example: [b.example] } : {}),
            }
          : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }

  return components;
}

async function push() {
  const { token, wabaId } = credentials();
  const existing = await fetchExisting();

  for (const def of Object.values(TEMPLATES)) {
    const live = existing.find(
      (t) => t.name === def.name && t.language === TEMPLATE_LANGUAGE
    );

    if (live) {
      console.log(
        `${DIM}· ${def.name} already exists (${live.status}) — skipping${OFF}`
      );
      continue;
    }

    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: def.name,
        language: TEMPLATE_LANGUAGE,
        category: def.category,
        components: componentsFor(def),
      }),
    });

    const json = (await res.json()) as {
      id?: string;
      status?: string;
      error?: { message?: string; error_user_msg?: string };
    };

    if (json.error) {
      console.log(
        `${RED}✗ ${def.name}: ${json.error.error_user_msg ?? json.error.message}${OFF}`
      );
    } else {
      console.log(`${GREEN}✓ ${def.name} submitted (${json.status ?? "PENDING"})${OFF}`);
    }
  }

  console.log(
    `\n${DIM}Approval usually takes minutes, occasionally hours. Run\n` +
      `  node scripts/whatsapp-templates.ts list\n` +
      `until every one says APPROVED — a template in review cannot send.${OFF}`
  );
}

async function list() {
  const existing = await fetchExisting();
  const ours = new Set(Object.values(TEMPLATES).map((t) => t.name));

  console.log(`${BOLD}Templates on this WhatsApp Business Account${OFF}\n`);
  for (const t of existing) {
    const mine = ours.has(t.name);
    const tone =
      t.status === "APPROVED" ? GREEN : t.status === "REJECTED" ? RED : YELLOW;
    console.log(
      `${tone}${t.status.padEnd(10)}${OFF} ${t.name.padEnd(22)} ${t.language.padEnd(6)}` +
        `${mine ? "" : `${DIM}(not used by this app)${OFF}`}` +
        (t.rejected_reason ? `\n${DIM}           reason: ${t.rejected_reason}${OFF}` : "")
    );
  }

  // The failure that costs a day: the code sends `ml`, WhatsApp Manager
  // defaulted the template to `en_US`, and Meta answers "template not found".
  console.log("");
  for (const def of Object.values(TEMPLATES)) {
    const live = existing.find(
      (t) => t.name === def.name && t.language === TEMPLATE_LANGUAGE
    );
    if (!live) {
      const wrongLanguage = existing.find((t) => t.name === def.name);
      console.log(
        wrongLanguage
          ? `${RED}✗ ${def.name} exists but in '${wrongLanguage.language}', not '${TEMPLATE_LANGUAGE}' — sends will fail${OFF}`
          : `${YELLOW}! ${def.name} has not been submitted yet${OFF}`
      );
    } else if (live.status !== "APPROVED") {
      console.log(`${YELLOW}! ${def.name} is ${live.status}, not APPROVED${OFF}`);
    }
  }
}

function check() {
  const problems = validateAllTemplates();

  for (const [event, def] of Object.entries(TEMPLATES)) {
    let filled = def.body;
    def.example.forEach((v, i) => {
      filled = filled.replaceAll(`{{${i + 1}}}`, v);
    });

    console.log(
      `\n${BOLD}${event}${OFF} ${DIM}→ ${def.name} · ${TEMPLATE_LANGUAGE} · ` +
        `${def.category} · ${variableCount(def.body)} variables${OFF}\n`
    );
    console.log(filled.split("\n").map((l) => `  ${l}`).join("\n"));
  }

  // Drafts print under their own heading so nobody reads one of these as
  // something a customer is receiving. `push` never touches them.
  for (const [key, def] of Object.entries(DRAFT_TEMPLATES)) {
    let filled = def.body;
    def.example.forEach((v, i) => {
      filled = filled.replaceAll(`{{${i + 1}}}`, v);
    });

    console.log(
      `\n${BOLD}${key}${OFF} ${YELLOW}(draft — not submitted)${OFF} ${DIM}→ ` +
        `${def.name} · ${TEMPLATE_LANGUAGE} · ${def.category} · ` +
        `${variableCount(def.body)} variables${OFF}\n`
    );
    console.log(filled.split("\n").map((l) => `  ${l}`).join("\n"));
    for (const b of def.buttons ?? []) {
      console.log(
        `\n  ${DIM}[ ${b.text} ]${OFF}` +
          (b.type === "URL" ? ` ${DIM}→ ${b.url}${OFF}` : ` ${DIM}(quick reply)${OFF}`)
      );
    }
  }

  console.log("");
  if (problems.length) {
    for (const p of problems) console.log(`${RED}✗ ${p}${OFF}`);
    process.exit(1);
  }
  console.log(
    `${GREEN}✓ all ${Object.keys(TEMPLATES).length} templates are valid${OFF}` +
      (Object.keys(DRAFT_TEMPLATES).length
        ? ` ${DIM}(+ ${Object.keys(DRAFT_TEMPLATES).length} draft, not submitted)${OFF}`
        : "")
  );
}

const command = process.argv[2] ?? "check";

if (command === "check") check();
else if (command === "list") await list();
else if (command === "push") await push();
else {
  console.log("Usage: node scripts/whatsapp-templates.ts [check|list|push]");
  process.exit(1);
}
