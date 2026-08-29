/**
 * Send one real template to one number, for testing.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/alias-loader.mjs \
 *     scripts/send-test-template.ts --template=<name> --order=<ORD-…> \
 *     --to=<10 digits> [--send]
 *
 * Dry by default. Without `--send` it prints the message exactly as it would
 * go out — filled body, filled button links, the lot — and sends nothing. That
 * is the safe mode and it is the one you get by forgetting a flag.
 *
 * It goes through `sendTemplateMessage`, not the Graph API, which matters for
 * two reasons: the gate still runs, so a test cannot message somebody who
 * asked us to stop; and the send is recorded in the CRM, so this doubles as a
 * test of the whole path rather than just of Meta.
 *
 * `--to` is deliberately separate from the order. The point of a test is to
 * read a real order's message on your own handset, and defaulting to the
 * order's own number would message a customer the first time somebody forgot
 * the flag.
 */
import { TEMPLATES, TEMPLATE_LANGUAGE, type TemplateDef } from "@/lib/whatsapp-templates";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertContact } from "@/lib/crm/contacts";
import { sendTemplateMessage } from "@/lib/crm/send";
import { toWhatsAppNumber } from "@/lib/whatsapp";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const templateName = arg("template");
const orderNumber = arg("order");
const to = arg("to");
const send = process.argv.includes("--send");

if (!templateName || !orderNumber || !to) {
  console.log(
    "Usage: --template=<name> --order=<ORD-…> --to=<digits> [--send]\n" +
      `Templates: ${Object.values(TEMPLATES).map((t) => t.name).join(", ")}`
  );
  process.exit(1);
}

const def: TemplateDef | undefined = Object.values(TEMPLATES).find(
  (t) => t.name === templateName
);
if (!def) {
  console.log(`${RED}No template named ${templateName}${OFF}`);
  process.exit(1);
}

const { data: order } = await supabaseAdmin
  .from("orders")
  .select(
    "order_number, buyer_name, buyer_phone, amount_paise, city, district, " +
      "state, pincode, expected_delivery"
  )
  .eq("order_number", orderNumber)
  .maybeSingle();

if (!order) {
  console.log(`${RED}No order ${orderNumber}${OFF}`);
  process.exit(1);
}

const o = order as {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  amount_paise: number;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  expected_delivery: string | null;
};

const base = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";

/**
 * The same shape lib/notify.ts builds, assembled here because that one is
 * private to the notify path and takes a wire payload rather than an order.
 *
 * Every field is filled even when this template does not use it: an empty
 * parameter fails the whole send, and a test that silently skips a field is a
 * test that passes for the wrong reason.
 */
const context = {
  customerName: o.buyer_name?.trim() || "സുഹൃത്തേ",
  orderNumber: o.order_number,
  amount: String(Math.round(o.amount_paise / 100)),
  addressShort:
    [o.city?.trim() || o.district, o.state].filter(Boolean).join(", ") || "Kerala",
  expectedDelivery: o.expected_delivery
    ? new Date(o.expected_delivery).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
      })
    : "5–7 ദിവസം",
  addressUrl: `${base}/neuro-code/address?id=${o.order_number}`,
  trackingUrl: `${base}/neuro-code/track?id=${o.order_number}`,
  courseTitle: "Neuro Linguistic Programming",
  courseUrl: `${base}/courses/nlp`,
  loginPhone: (o.buyer_phone ?? "").replace(/\D/g, "").slice(-10),
};

const params = def.params(context);
const buttonParams = (def.buttons ?? [])
  .filter((b) => b.type === "URL" && b.param)
  .map((b) => (b.type === "URL" && b.param ? b.param(context) : ""));

let preview = def.body;
params.forEach((v, i) => {
  preview = preview.replaceAll(`{{${i + 1}}}`, v);
});

console.log(`${BOLD}${def.name}${OFF} ${DIM}· ${def.category} · ${TEMPLATE_LANGUAGE}${OFF}\n`);
console.log(preview.split("\n").map((l) => `  ${l}`).join("\n"));
console.log("");

let variable = 0;
for (const b of def.buttons ?? []) {
  if (b.type === "QUICK_REPLY") {
    console.log(`  ${DIM}[ ${b.text} ]  (quick reply)${OFF}`);
  } else {
    const url = b.param ? b.url.replace("{{1}}", buttonParams[variable++]) : b.url;
    console.log(`  ${DIM}[ ${b.text} ]  → ${url}${OFF}`);
  }
}

const phone = toWhatsAppNumber(to);
console.log(`\n${DIM}to: ${phone ?? "UNUSABLE NUMBER"}${OFF}`);

if (!phone) process.exit(1);

if (!send) {
  console.log(`\n${YELLOW}Dry run — nothing sent. Add --send.${OFF}`);
  process.exit(0);
}

const contact = await upsertContact(phone, { name: o.buyer_name, orderNumber: o.order_number });
if (!contact) {
  console.log(`${RED}Could not create a contact for ${phone}${OFF}`);
  process.exit(1);
}

const outcome = await sendTemplateMessage({
  contact,
  // A receipt, and this is the receipt template. Transactional is also what
  // the real send uses, so the gate applies the same rules to the test.
  kind: "transactional",
  template: { name: def.name, category: def.category, language: TEMPLATE_LANGUAGE },
  params,
  buttonParams,
  preview,
});

if (outcome.ok) {
  console.log(`\n${GREEN}✓ sent — wamid ${outcome.wamid ?? "(none returned)"}${OFF}`);
} else if (outcome.refused) {
  console.log(`\n${YELLOW}Refused by the gate: ${outcome.reason}${OFF}`);
} else {
  console.log(`\n${RED}✗ ${outcome.error}${OFF}`);
}
