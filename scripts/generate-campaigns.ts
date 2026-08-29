/**
 * Create the standing campaigns as drafts.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/alias-loader.mjs \
 *     scripts/generate-campaigns.ts [--create]
 *
 * `--env-file` is not optional: this reads and writes the real database
 * through the app's own client, which reads its credentials from the
 * environment exactly as the server does.
 *
 * Without `--create` it only dry-runs: the real segment, the real exclusions,
 * the real recipient count, and nothing written. That is the default on
 * purpose — a campaign is the one thing here that reaches a thousand people,
 * and the safe mode should be the one you get by forgetting a flag.
 *
 * With `--create` it writes each campaign at status `draft` and queues its
 * recipients. **Nothing sends.** A draft campaign is inert until somebody
 * starts it from /admin/crm/campaigns, and the worker only drains campaigns in
 * `sending`.
 *
 * Segments are person-level (lib/crm/people.ts), so a customer who failed five
 * times and then paid is a customer, not a chase target — and `messaged: "no"`
 * keeps each list to people nobody has contacted yet.
 *
 * Re-running is safe. Recipients are unique per campaign, and createCampaign
 * drops anyone who has already had that exact template from any campaign.
 */
import { dryRun, createCampaign } from "@/lib/crm/campaigns";
import type { Segment } from "@/lib/crm/segments";

const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m",
      DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

/** Keep the first run of anything at 50 — see CAMPAIGN_TEMPLATES. */
const CAP = 50;

interface Plan {
  name: string;
  template: string;
  segment: Segment;
  why: string;
}

const PLANS: Plan[] = [
  {
    name: "Never started payment — introduce the book",
    template: "neuro_interest_intro",
    // Left their number and never opened the payment screen. The largest
    // untouched group, and the only one this template is written for.
    segment: { personStage: "not_started", messaged: "no" },
    why: "705 people left details and never opened payment",
  },
  {
    name: "Payment started, not finished",
    template: "payment_reminder_1",
    // They chose the book and opened the payment page. Strongest intent of
    // the three, and nothing about their history says they changed their mind.
    segment: { personStage: "payment_started", messaged: "no" },
    why: "They got as far as the payment page",
  },
  {
    name: "Payment failed — nothing they did wrong",
    template: "payment_failed_1",
    // Person-level, so nobody who failed and later paid is in here. That
    // distinction is 149 people in this database.
    segment: { personStage: "failed", messaged: "no" },
    why: "Their payment was refused and they have never paid since",
  },
];

const create = process.argv.includes("--create");

console.log(
  `${BOLD}${create ? "Creating" : "Dry run — nothing will be written"}${OFF}\n`
);

for (const plan of PLANS) {
  console.log(`${BOLD}${plan.name}${OFF}`);
  console.log(`${DIM}  ${plan.template} · ${plan.why}${OFF}`);

  const dry = await dryRun(plan.segment, plan.template, CAP);

  console.log(`  would message ${BOLD}${dry.willSend}${OFF} of ${dry.members.length} matched`);
  for (const e of dry.excluded) {
    const tone = e.reason.startsWith("Would be refused") ? RED : DIM;
    console.log(`  ${tone}· ${e.count} — ${e.reason}${OFF}`);
  }

  if (!create) {
    console.log("");
    continue;
  }

  if (!dry.members.length) {
    console.log(`  ${YELLOW}· nobody to queue — skipped${OFF}\n`);
    continue;
  }

  const result = await createCampaign({
    name: plan.name,
    templateName: plan.template,
    segment: plan.segment,
    cap: CAP,
    createdBy: { id: null, email: "generate-campaigns script" },
  });

  if (result.ok) {
    console.log(
      `  ${GREEN}✓ created as draft — ${result.campaign.id}${OFF}\n` +
        `  ${DIM}Nothing sends until somebody starts it in /admin/crm/campaigns.${OFF}\n`
    );
  } else {
    console.log(`  ${RED}✗ ${result.error}${OFF}\n`);
  }
}

console.log(
  create
    ? `${DIM}Drafts only. Review each at /admin/crm/campaigns before starting it.${OFF}`
    : `${DIM}Re-run with --create to write these as drafts.${OFF}`
);
