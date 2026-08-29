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
  validateTemplate,
  variableCount,
  FLOW_TEMPLATES,
  CAMPAIGN_TEMPLATES,
  metaTemplatePayload,
  type TemplateDef,
} from "../lib/whatsapp-templates.ts";
// Data only, no imports of its own — see the note at the top of that file.
import { validateFlows } from "../lib/crm/flow-table.ts";

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

  // Every registry something sends from, not just the order events. Checking
  // TEMPLATES alone printed "(not used by this app)" against all seven
  // conversation-flow templates the day they were submitted, which is the
  // opposite of true and exactly the sort of thing that gets a working
  // template deleted.
  const ours = new Set([
    ...Object.values(TEMPLATES).map((t) => t.name),
    ...Object.values(FLOW_TEMPLATES).map((t) => t.name),
    ...Object.values(CAMPAIGN_TEMPLATES).map((t) => t.name),
  ]);

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
  const problems = [...validateAllTemplates(), ...validateFlows()];

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

/**
 * Submit the eight Neuro Code flow templates.
 *
 * A separate command from `push` on purpose. `push` submits the order
 * notifications, which are Utility and uncontroversial; this submits six
 * MARKETING templates, and six marketing templates arriving at Meta because
 * somebody ran the wrong command is a bad afternoon for the number's rating.
 *
 * The payload comes from metaTemplatePayload(), the same function the docs
 * quote — so what is approved and what this app sends cannot drift apart.
 */
async function pushFlows() {
  const { token, wabaId } = credentials();
  const existing = await fetchExisting();

  const problems = validateFlows();
  if (problems.length) {
    for (const p of problems) console.log(`${RED}✗ ${p}${OFF}`);
    console.log(`\n${RED}Fix the flow table first — these templates would arrive unroutable.${OFF}`);
    process.exit(1);
  }

  for (const def of Object.values(FLOW_TEMPLATES)) {
    const live = existing.find(
      (t) => t.name === def.name && t.language === TEMPLATE_LANGUAGE
    );

    if (live) {
      console.log(`${DIM}· ${def.name} already exists (${live.status}) — skipping${OFF}`);
      continue;
    }

    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(metaTemplatePayload(def)),
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
    `\n${DIM}Approval takes minutes to a day. Run the health cron afterwards so ` +
      `whatsapp_template_status catches up, or the gate is checking nothing.${OFF}`
  );
}

/**
 * Submit everything the code expects to be able to send.
 *
 * TEMPLATES, FLOW_TEMPLATES and CAMPAIGN_TEMPLATES — every registry something
 * actually sends from. DRAFT_TEMPLATES is excluded, and that is the whole
 * reason drafts are a separate registry: they are written and deliberately not
 * shown to Meta.
 *
 * Anything Meta already holds is skipped, whatever its status. A rejected
 * template cannot be recreated under the same name — it has to be edited, or
 * resubmitted under a new one — so silently retrying it would just print a
 * confusing error every run.
 */
async function pushAll() {
  const { token, wabaId } = credentials();
  const existing = await fetchExisting();

  const problems = [...validateAllTemplates(), ...validateFlows()];
  if (problems.length) {
    for (const p of problems) console.log(`${RED}✗ ${p}${OFF}`);
    console.log(`\n${RED}Nothing submitted — fix these first.${OFF}`);
    process.exit(1);
  }

  const all: { def: TemplateDef; group: string }[] = [
    ...Object.values(TEMPLATES).map((def) => ({ def, group: "automatic" })),
    ...Object.values(FLOW_TEMPLATES).map((c) => ({
      def: { ...c, params: () => c.example } as TemplateDef,
      group: "flow",
    })),
    ...Object.values(CAMPAIGN_TEMPLATES).map((c) => ({
      def: { ...c, params: () => c.example } as TemplateDef,
      group: "campaign",
    })),
  ];

  let submitted = 0;
  let skipped = 0;
  let failed = 0;

  for (const { def, group } of all) {
    const live = existing.find(
      (t) => t.name === def.name && t.language === TEMPLATE_LANGUAGE
    );

    if (live) {
      console.log(`${DIM}· ${def.name} already at Meta (${live.status}) — skipping${OFF}`);
      skipped++;
      continue;
    }

    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(metaTemplatePayload(def)),
    });

    const json = (await res.json()) as {
      id?: string;
      status?: string;
      error?: { message?: string; error_user_msg?: string };
    };

    if (json.error) {
      console.log(
        `${RED}✗ ${def.name} (${group}): ${json.error.error_user_msg ?? json.error.message}${OFF}`
      );
      failed++;
    } else if (json.status === "REJECTED") {
      // Meta auto-rejects some templates at creation, in seconds, with no
      // human review. Worth calling out separately: it reads as a success
      // otherwise, and it is the opposite.
      console.log(`${RED}✗ ${def.name} (${group}) submitted and REJECTED immediately${OFF}`);
      failed++;
    } else {
      console.log(`${GREEN}✓ ${def.name} (${group}) submitted (${json.status ?? "PENDING"})${OFF}`);
      submitted++;
    }
  }

  console.log(
    `\n${BOLD}${submitted} submitted · ${skipped} already at Meta · ${failed} refused${OFF}`
  );
  console.log(
    `${DIM}Drafts were not submitted — that is what DRAFT_TEMPLATES is for.\n` +
      `Run this again with \`list\` to see how review went.${OFF}`
  );
}

/**
 * Edit templates Meta already holds, so a wording or button change reaches it.
 *
 * `push` only ever creates. That gap is how the corrected `course_access`
 * wording sat in this file for months doing nothing: the name existed at Meta,
 * push skipped it, and the fix never left the repo.
 *
 * Meta re-reviews an edited template. The previous version keeps sending while
 * that happens, so this is safe to run on something live — but the edit budget
 * is finite (Meta allows a limited number per template per month), which is
 * why this takes names rather than editing everything it can.
 *
 *   node scripts/whatsapp-templates.ts edit payment_reminder_1 payment_failed_1
 */
async function edit(names: string[]) {
  if (!names.length) {
    console.log(`${RED}Name at least one template to edit.${OFF}`);
    process.exit(1);
  }

  const { token } = credentials();
  const existing = await fetchExisting();

  const byName = new Map<string, TemplateDef>();
  for (const def of Object.values(TEMPLATES)) byName.set(def.name, def);
  for (const c of Object.values(FLOW_TEMPLATES)) {
    byName.set(c.name, { ...c, params: () => c.example } as TemplateDef);
  }
  for (const c of Object.values(CAMPAIGN_TEMPLATES)) {
    byName.set(c.name, { ...c, params: () => c.example } as TemplateDef);
  }

  for (const name of names) {
    const def = byName.get(name);
    if (!def) {
      console.log(`${RED}✗ ${name}: no template by that name in the code${OFF}`);
      continue;
    }

    const live = existing.find(
      (t) => t.name === name && t.language === TEMPLATE_LANGUAGE
    );
    if (!live) {
      console.log(`${YELLOW}· ${name} is not at Meta — use push, not edit${OFF}`);
      continue;
    }

    const res = await fetch(`${GRAPH}/${live.id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // Components only. Sending `name` or `language` on an edit is rejected,
      // and the category is Meta's to decide.
      body: JSON.stringify({ components: componentsFor(def) }),
    });

    const json = (await res.json()) as {
      success?: boolean;
      error?: { message?: string; error_user_msg?: string };
    };

    if (json.error) {
      console.log(
        `${RED}✗ ${name}: ${json.error.error_user_msg ?? json.error.message}${OFF}`
      );
    } else {
      console.log(`${GREEN}✓ ${name} edited — back in review${OFF}`);
    }
  }

  console.log(
    `\n${DIM}The previous version keeps sending until the edit is approved.${OFF}`
  );
}

/**
 * Submit one named draft, and only one named draft.
 *
 * Drafts are excluded from `push` and `push-all` so they cannot reach Meta by
 * accident. This is the deliberate way through: you have to type the name,
 * which is the point — a draft goes up when somebody decides to spend the
 * attempt, not because they ran the wrong command.
 *
 * Submitting does not wire it to anything. It stays in DRAFT_TEMPLATES until
 * somebody moves it into TEMPLATES under an event, which is a separate
 * decision with its own consequences.
 */
async function pushDraft(names: string[]) {
  if (!names.length) {
    console.log(`${RED}Name the draft to submit.${OFF}`);
    console.log(`${DIM}Drafts: ${Object.keys(DRAFT_TEMPLATES).join(", ")}${OFF}`);
    process.exit(1);
  }

  const { token, wabaId } = credentials();
  const existing = await fetchExisting();

  for (const key of names) {
    const def =
      DRAFT_TEMPLATES[key] ??
      Object.values(DRAFT_TEMPLATES).find((d) => d.name === key);

    if (!def) {
      console.log(`${RED}✗ ${key}: not a draft. Drafts: ${Object.keys(DRAFT_TEMPLATES).join(", ")}${OFF}`);
      continue;
    }

    const problems = validateTemplate(def);
    if (problems.length) {
      for (const p of problems) console.log(`${RED}✗ ${p}${OFF}`);
      continue;
    }

    const live = existing.find(
      (t) => t.name === def.name && t.language === TEMPLATE_LANGUAGE
    );
    if (live) {
      console.log(
        `${YELLOW}· ${def.name} is already at Meta (${live.status}) — use edit${OFF}`
      );
      continue;
    }

    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(metaTemplatePayload(def)),
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
    } else if (json.status === "REJECTED") {
      console.log(`${RED}✗ ${def.name} submitted and REJECTED immediately${OFF}`);
    } else {
      console.log(`${GREEN}✓ ${def.name} submitted (${json.status ?? "PENDING"})${OFF}`);
      console.log(
        `${DIM}  Still a draft. Nothing sends it until it moves into TEMPLATES.${OFF}`
      );
    }
  }
}

const command = process.argv[2] ?? "check";

if (command === "check") check();
else if (command === "list") await list();
else if (command === "push") await push();
else if (command === "push-flows") await pushFlows();
else if (command === "push-all") await pushAll();
else if (command === "edit") await edit(process.argv.slice(3));
else if (command === "push-draft") await pushDraft(process.argv.slice(3));
else {
  console.log(
    "Usage: node scripts/whatsapp-templates.ts " +
      "[check|list|push|push-flows|push-all|edit <name>...|push-draft <name>]"
  );
  process.exit(1);
}
