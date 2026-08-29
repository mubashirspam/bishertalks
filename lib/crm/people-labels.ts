/**
 * The funnel's vocabulary: stage names, priorities, labels, tones.
 *
 * Data only — this module imports nothing, which is the whole point. The
 * People filter bar is a client component and needs the labels; lib/crm/people
 * reads every order in the database. Importing one from the other pulled the
 * Supabase admin client into the browser bundle.
 *
 * The precedence rule lives here too, because it is a definition rather than a
 * behaviour: a person's stage is the highest their orders reach, so paying
 * outranks failing and failing outranks never opening the payment screen.
 */

// ── Stages ───────────────────────────────────────────────────────────────────

/**
 * In order of how far someone got. The order IS the precedence rule: a
 * person's stage is the highest their orders reach, so paying outranks
 * failing, and failing outranks never having opened the payment screen.
 */
export const PERSON_STAGES = [
  "not_started",
  "payment_started",
  "failed",
  "customer",
] as const;

export type PersonStage = (typeof PERSON_STAGES)[number];

export const PERSON_STAGE_LABELS: Record<PersonStage, string> = {
  not_started: "Never started payment",
  payment_started: "Payment started, not finished",
  failed: "Payment failed",
  customer: "Paid",
};

/** The one-line explanation each chip carries, so nobody has to guess. */
export const PERSON_STAGE_HINTS: Record<PersonStage, string> = {
  not_started: "Left their details, never opened the payment screen",
  payment_started: "Opened payment and did not finish — and has never paid",
  failed: "A payment of theirs was refused — and they have never paid since",
  customer: "Has paid at least once. However many times they failed first",
};

export const STAGE_RANK: Record<PersonStage, number> = {
  not_started: 0,
  payment_started: 1,
  failed: 2,
  customer: 3,
};

/** Where one order sits. A person's stage is the best of these. */
export function stageOfOrder(o: {
  payment_status: string;
  razorpay_order_id: string | null;
}): PersonStage {
  // Refunded counts as paid: the money did arrive, and whatever should happen
  // next for that person, it is not a "your payment failed" message.
  if (o.payment_status === "paid" || o.payment_status === "refunded") return "customer";
  if (o.payment_status === "failed") return "failed";
  // A Razorpay order id means the payment screen actually opened. Without one
  // they only ever left their details.
  if (o.razorpay_order_id) return "payment_started";
  return "not_started";
}

// ── Priority ─────────────────────────────────────────────────────────────────

/**
 * Who is worth a message first, worked out rather than typed in.
 *
 * Three things decide it, and they are the three a person would use:
 *
 *   how recently they tried   intent decays fast; a payment abandoned this
 *                             morning is a different prospect from one
 *                             abandoned in June
 *   how many times they tried two failed attempts is not twice the accident,
 *                             it is somebody who really meant to buy
 *   whether we already asked  a first message to someone we have never
 *                             contacted is worth more than a fourth to
 *                             somebody ignoring us
 *
 * Anyone who has paid is "customer" and out of the chasing ladder entirely —
 * they are the audience for something else, never for "complete your payment".
 */
export const PRIORITIES = ["hot", "warm", "cold", "customer"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
  customer: "Customer",
};

export const PRIORITY_HINTS: Record<Priority, string> = {
  hot: "Tried in the last 3 days, or twice in the last week — chase these today",
  warm: "Tried in the last 3 weeks, or never messaged and still recent",
  cold: "Went quiet a while ago. Worth a campaign, not a phone call",
  customer: "Has paid. Not a chasing target",
};

export const PRIORITY_TONE: Record<Priority, string> = {
  hot: "border-red-500 bg-red-50 text-red-700",
  warm: "border-amber-500 bg-amber-50 text-amber-800",
  cold: "border-neutral-400 bg-neutral-100 text-neutral-600",
  customer: "border-green-600 bg-green-50 text-green-700",
};

const DAY = 86_400_000;
