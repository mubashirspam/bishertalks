import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows, type PageResult } from "@/lib/db/paginate";
import { toWhatsAppNumber } from "@/lib/whatsapp";

/**
 * The funnel, counted in people rather than in orders.
 *
 * This exists because the two give different answers and only one of them is
 * the answer anybody wants. `lib/crm/segments.ts` filters ORDERS by stage and
 * collapses to one message per phone afterwards, so a customer who tried five
 * times, failed five times, and then paid matches the "payment failed" segment
 * on all five of those rows. They are in the list. They get chased for a
 * payment they already made — and there are people in this database with
 * exactly that history.
 *
 * The fix is not a better filter over orders; it is asking a different
 * question. A person is a phone number, their stage is the furthest they ever
 * got, and every count on the screen is a count of people. Someone appears in
 * exactly one bucket, always, and paying takes precedence over every failure
 * that came before it.
 *
 * Aggregated here rather than in SQL on purpose. Migrations in this repo are
 * applied by hand — several screens already carry fallbacks for a view that
 * had not been rebuilt yet — so a feature that needs a new view is a feature
 * that is broken until somebody remembers to run it. Five thousand orders is
 * a second of reading and a few milliseconds of counting.
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

const STAGE_RANK: Record<PersonStage, number> = {
  not_started: 0,
  payment_started: 1,
  failed: 2,
  customer: 3,
};

/** Where one order sits. A person's stage is the best of these. */
function stageOfOrder(o: OrderLite): PersonStage {
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

function priorityOf(
  stage: PersonStage,
  lastAt: string,
  attempts: number,
  messaged: boolean,
  now: number
): Priority {
  if (stage === "customer") return "customer";

  const days = Math.floor((now - Date.parse(lastAt)) / DAY);

  // Today, yesterday, the day before — or someone who has tried more than once
  // inside a week, which is the strongest buying signal an abandoned checkout
  // ever gives.
  if (days <= 3 || (days <= 7 && attempts >= 2)) return "hot";

  // Three weeks is roughly how long "I was going to buy that" survives. The
  // second clause is the one that earns its place: somebody we have never
  // messaged is still worth a first message well after they would otherwise
  // have gone cold, because nothing has been spent on them yet.
  if (days <= 21 || (days <= 45 && !messaged)) return "warm";

  return "cold";
}

// ── The person ───────────────────────────────────────────────────────────────

export interface Person {
  /** The twelve-digit WhatsApp form. This is the identity — one row per phone. */
  phone: string;
  name: string | null;
  stage: PersonStage;
  priority: Priority;
  /** Every order row they have, whatever became of it. */
  orders: number;
  /** Failed plus abandoned. What "tried and did not pay" adds up to. */
  attempts: number;
  paidOrders: number;
  failedOrders: number;
  /** Their most recent order of any kind, ISO. */
  lastAt: string;
  firstAt: string;
  lastOrderNumber: string;
  district: string | null;
  pincode: string | null;
  /** Null until this system has a contact row for them. */
  contactId: string | null;
  /** When we last got a message OUT to them, or null for never. */
  messagedAt: string | null;
  /** When they last wrote to us. */
  repliedAt: string | null;
  optedOut: boolean;
}

interface OrderLite {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  payment_status: string;
  razorpay_order_id: string | null;
  district: string | null;
  pincode: string | null;
  ordered_at: string;
}

interface ContactLite {
  id: string;
  phone: string;
  display_name: string | null;
  opt_out_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
}

/**
 * Everyone, built once per request.
 *
 * Memoised with React `cache`, so the chip counts, the table and the paginator
 * on one screen share a single pass over the orders rather than three.
 */
export const loadPeople = cache(async function loadPeople(): Promise<{
  people: Person[];
  /** Orders whose phone number cannot be messaged, so no person exists for them. */
  unreachable: number;
  truncated: boolean;
}> {
  const [orders, contacts] = await Promise.all([
    fetchAllRows<OrderLite>(
      (from, to) =>
        supabaseAdmin
          .from("orders")
          .select(
            "order_number,buyer_name,buyer_phone,payment_status," +
              "razorpay_order_id,district,pincode,ordered_at"
          )
          // Oldest first, so "first non-null wins" below reads as "their
          // earliest known district" and the last write wins for recency.
          .order("ordered_at", { ascending: true })
          .range(from, to) as unknown as PromiseLike<PageResult<OrderLite>>,
      { label: "CRM people" }
    ),
    loadContacts(),
  ]);

  const byPhone = new Map<string, Person>();
  let unreachable = 0;

  for (const o of orders.rows) {
    const phone = toWhatsAppNumber(o.buyer_phone);
    if (!phone) {
      unreachable++;
      continue;
    }

    const stage = stageOfOrder(o);
    const existing = byPhone.get(phone);

    if (!existing) {
      byPhone.set(phone, {
        phone,
        name: o.buyer_name?.trim() || null,
        stage,
        priority: "cold", // settled below, once the whole history is known
        orders: 1,
        attempts: stage === "customer" ? 0 : 1,
        paidOrders: stage === "customer" ? 1 : 0,
        failedOrders: stage === "failed" ? 1 : 0,
        lastAt: o.ordered_at,
        firstAt: o.ordered_at,
        lastOrderNumber: o.order_number,
        district: o.district,
        pincode: o.pincode,
        contactId: null,
        messagedAt: null,
        repliedAt: null,
        optedOut: false,
      });
      continue;
    }

    existing.orders++;
    if (stage === "customer") existing.paidOrders++;
    else existing.attempts++;
    if (stage === "failed") existing.failedOrders++;

    // The furthest they ever got, which is the whole point of this file.
    if (STAGE_RANK[stage] > STAGE_RANK[existing.stage]) existing.stage = stage;

    // Rows arrive oldest first, so later rows are more recent by construction.
    existing.lastAt = o.ordered_at;
    existing.lastOrderNumber = o.order_number;
    if (o.buyer_name?.trim()) existing.name = o.buyer_name.trim();
    if (o.district) existing.district = o.district;
    if (o.pincode) existing.pincode = o.pincode;
  }

  const now = Date.now();

  for (const person of byPhone.values()) {
    const contact = contacts.get(person.phone);
    if (contact) {
      person.contactId = contact.id;
      person.messagedAt = contact.last_outbound_at;
      person.repliedAt = contact.last_inbound_at;
      person.optedOut = !!contact.opt_out_at;
      // A name staff typed on the contact beats whatever Razorpay sent back.
      if (contact.display_name) person.name = contact.display_name;
    }
    person.priority = priorityOf(
      person.stage,
      person.lastAt,
      person.attempts,
      !!person.messagedAt,
      now
    );
  }

  return {
    people: [...byPhone.values()],
    unreachable,
    truncated: orders.truncated,
  };
});

async function loadContacts(): Promise<Map<string, ContactLite>> {
  const { rows } = await fetchAllRows<ContactLite>(
    (from, to) =>
      supabaseAdmin
        .from("whatsapp_contacts")
        .select("id, phone, display_name, opt_out_at, last_inbound_at, last_outbound_at")
        .order("created_at", { ascending: true })
        .range(from, to) as unknown as PromiseLike<PageResult<ContactLite>>,
    { label: "CRM contacts" }
  );
  return new Map(rows.map((c) => [c.phone, c]));
}

// ── Filtering ────────────────────────────────────────────────────────────────

export interface PeopleFilters {
  stage?: PersonStage;
  priority?: Priority;
  /**
   * Whether a message has ever reached them.
   *
   * "no" is the useful half and the reason this filter exists: it is the list
   * of people nobody has spoken to yet, which is where a first campaign should
   * always start.
   */
  messaged?: "yes" | "no";
  /** Only people who have written back. */
  replied?: boolean;
  /** Hide anyone who asked us to stop. They can never be messaged anyway. */
  contactableOnly?: boolean;
  /** Name or phone, matched loosely. */
  q?: string;
  /** Their most recent order, on or after / before (ISO). */
  from?: string;
  to?: string;
  district?: string;
}

export function isPersonStage(v: string | undefined | null): v is PersonStage {
  return !!v && (PERSON_STAGES as readonly string[]).includes(v);
}

export function isPriority(v: string | undefined | null): v is Priority {
  return !!v && (PRIORITIES as readonly string[]).includes(v);
}

function matches(p: Person, f: PeopleFilters): boolean {
  if (f.stage && p.stage !== f.stage) return false;
  if (f.priority && p.priority !== f.priority) return false;
  if (f.messaged === "yes" && !p.messagedAt) return false;
  if (f.messaged === "no" && p.messagedAt) return false;
  if (f.replied && !p.repliedAt) return false;
  if (f.contactableOnly && p.optedOut) return false;
  if (f.district && p.district !== f.district) return false;
  if (f.from && p.lastAt < f.from) return false;
  if (f.to && p.lastAt >= f.to) return false;

  if (f.q) {
    const needle = f.q.trim().toLowerCase();
    // Digits only on the phone side, so "98470 12345" and "+919847012345"
    // both find the same person.
    const digits = needle.replace(/\D/g, "");
    const inName = (p.name ?? "").toLowerCase().includes(needle);
    const inPhone = digits.length >= 4 && p.phone.includes(digits);
    if (!inName && !inPhone) return false;
  }

  return true;
}

const PRIORITY_ORDER: Record<Priority, number> = { hot: 0, warm: 1, cold: 2, customer: 3 };

export interface PeoplePage {
  rows: Person[];
  /** How many people the filters match, before paging. */
  total: number;
  /** Everyone, whatever the filters — the denominator on screen. */
  totalPeople: number;
  /**
   * Per-chip counts.
   *
   * Each facet is counted with every filter applied EXCEPT itself, so the
   * number on the "Payment failed" chip is what you would get by clicking it
   * rather than what you have now — which is the only reading of a filter
   * count anybody ever uses.
   */
  stageCounts: Record<PersonStage, number>;
  priorityCounts: Record<Priority, number>;
  messagedCounts: { yes: number; no: number };
  unreachable: number;
  truncated: boolean;
}

export async function listPeople(
  filters: PeopleFilters,
  page = 0,
  perPage = 50
): Promise<PeoplePage> {
  const { people, unreachable, truncated } = await loadPeople();

  const countBy = <K extends string>(
    keys: readonly K[],
    without: keyof PeopleFilters,
    of: (p: Person) => K
  ): Record<K, number> => {
    const rest = { ...filters, [without]: undefined } as PeopleFilters;
    const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    for (const p of people) if (matches(p, rest)) out[of(p)]++;
    return out;
  };

  const stageCounts = countBy(PERSON_STAGES, "stage", (p) => p.stage);
  const priorityCounts = countBy(PRIORITIES, "priority", (p) => p.priority);
  const messaged = countBy(["yes", "no"] as const, "messaged", (p) =>
    p.messagedAt ? "yes" : "no"
  );

  const hits = people.filter((p) => matches(p, filters));

  // Hottest first, and within a band the most recent — which is the order
  // somebody working down the list would put them in by hand.
  hits.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      b.lastAt.localeCompare(a.lastAt)
  );

  return {
    rows: hits.slice(page * perPage, (page + 1) * perPage),
    total: hits.length,
    totalPeople: people.length,
    stageCounts,
    priorityCounts,
    messagedCounts: messaged,
    unreachable,
    truncated,
  };
}

/** Every district that has anybody in it, for the filter dropdown. */
export async function peopleDistricts(): Promise<string[]> {
  const { people } = await loadPeople();
  return [...new Set(people.map((p) => p.district).filter((d): d is string => !!d))].sort();
}
