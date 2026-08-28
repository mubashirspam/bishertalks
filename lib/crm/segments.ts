import { supabaseAdmin } from "@/lib/supabase/admin";
import { toWhatsAppNumber } from "@/lib/whatsapp";
import {
  listPeople,
  PERSON_STAGES,
  PERSON_STAGE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type PersonStage,
  type Priority,
} from "@/lib/crm/people";
import type { OrderStage } from "@/lib/order-stage";
import type { DeliveryStage } from "@/lib/delivery-stage";

/**
 * Who a campaign goes to.
 *
 * Built on the stages the app already derives rather than a second definition
 * of "payment failed" — `orderStage()` and `deliveryStage()` are the truth,
 * and `portal_orders` exposes `delivery_stage` as a column (migration 0045),
 * so a segment is a filter over rows the rest of the admin already agrees on.
 *
 * The one rule this file enforces on its own: **an opted-out contact is never
 * returned.** Not filtered in the UI, not skipped by the caller — excluded in
 * the query, so a segment physically cannot contain someone who asked us to
 * stop even if every later check were removed.
 */

export interface Segment {
  /**
   * Funnel stage counted per PERSON — the furthest they ever got.
   *
   * Prefer this over `orderStage` for anything that chases a payment. The two
   * differ by 149 people in this database: that is how many have a failed
   * order in their history AND have since paid, and `orderStage: "failed"`
   * puts every one of them in the list. See lib/crm/people.ts.
   */
  personStage?: PersonStage;
  /** How worth chasing they are, worked out per person. */
  priority?: Priority;
  /** "no" is the people nobody has messaged yet. */
  messaged?: "yes" | "no";
  /**
   * Funnel stage counted per ORDER.
   *
   * Kept because a campaign about one order — "your payment for ORD-X failed"
   * — is a real thing to want, and because campaigns created before the
   * person-level segment existed are stored with it. It is the wrong default.
   */
  orderStage?: OrderStage;
  /** Delivery stage, for parcels. */
  deliveryStage?: DeliveryStage;
  /** Orders placed on or after this date (ISO, IST-aware at the caller). */
  from?: string;
  /** Orders placed before this date. */
  to?: string;
  district?: string;
  /** Only contacts who have written to us at least once. */
  hasReplied?: boolean;
  /** Only contacts who have opted in to marketing. */
  marketingOptInOnly?: boolean;
}

export interface SegmentMember {
  contactId: string;
  phone: string;
  name: string | null;
  orderNumber: string | null;
}

export interface SegmentResult {
  members: SegmentMember[];
  /** Contacts the segment matched but will not message, and why. */
  excluded: { reason: string; count: number }[];
  /** Orders whose phone number is unusable — they can never be messaged. */
  unreachable: number;
}

/**
 * The vocabularies the composer offers, in the order it should offer them.
 *
 * People first, deliberately. It is the one that cannot chase a customer for
 * money they have already paid, and a dropdown's first option is what most
 * campaigns will be built from.
 */
export const SEGMENT_SOURCES = [
  {
    key: "personStage" as const,
    label: "Where they got to — one row per person",
    options: PERSON_STAGES.map((v) => ({ value: v, label: PERSON_STAGE_LABELS[v] })),
  },
  {
    key: "priority" as const,
    label: "How worth chasing they are",
    options: PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABELS[v] })),
  },
  {
    key: "orderStage" as const,
    label: "Where one ORDER got to (may repeat a person)",
    options: [
      { value: "lead", label: "Never started payment" },
      { value: "payment_started", label: "Payment started, not finished" },
      { value: "failed", label: "Payment failed" },
      { value: "paid_no_address", label: "Paid, no address yet" },
      { value: "complete", label: "Paid, with an address" },
    ],
  },
  {
    key: "deliveryStage" as const,
    label: "Where the parcel is",
    options: [
      { value: "assigned", label: "Routed to a courier" },
      { value: "shipped", label: "Shipped" },
      { value: "out_for_delivery", label: "Out for delivery" },
      { value: "delivered", label: "Delivered" },
      { value: "returned", label: "Returned to us" },
    ],
  },
];

/**
 * Resolve a segment to the people it would actually message.
 *
 * This is what "dry run" calls. It does the whole selection and every
 * exclusion, and sends nothing — so the numbers on screen before a campaign
 * starts are the real ones, not an estimate.
 */
export async function resolveSegment(
  segment: Segment,
  limit = 5000
): Promise<SegmentResult> {
  // One entry per phone either way — the difference is what "matches" means.
  // The person path decides a stage from someone's whole history; the order
  // path matches rows and collapses afterwards, which is what let a customer
  // who paid on their sixth attempt keep matching "payment failed" on the
  // first five.
  const { byPhone, unreachable } = usesPeople(segment)
    ? await peopleSeeds(segment, limit)
    : await orderSeeds(segment, limit);

  if (!byPhone.size) {
    return { members: [], excluded: [], unreachable };
  }

  const phones = [...byPhone.keys()];
  const contacts = await contactsFor(phones);

  const members: SegmentMember[] = [];
  const excluded: Record<string, number> = {};

  for (const phone of phones) {
    const seed = byPhone.get(phone)!;
    const contact = contacts.get(phone);

    // No contact row yet is fine — the campaign creates one when it queues.
    // No consent has been withdrawn, because none was ever recorded.
    if (!contact) {
      members.push({
        contactId: "",
        phone,
        name: seed.name,
        orderNumber: seed.orderNumber,
      });
      continue;
    }

    if (contact.opt_out_at) {
      excluded["Asked us to stop"] = (excluded["Asked us to stop"] ?? 0) + 1;
      continue;
    }
    if (segment.hasReplied && !contact.last_inbound_at) {
      excluded["Has never written to us"] = (excluded["Has never written to us"] ?? 0) + 1;
      continue;
    }
    if (segment.marketingOptInOnly && !contact.marketing_opt_in_at) {
      excluded["No marketing opt-in"] = (excluded["No marketing opt-in"] ?? 0) + 1;
      continue;
    }

    members.push({
      contactId: contact.id,
      phone,
      name: contact.display_name ?? seed.name,
      orderNumber: seed.orderNumber,
    });
  }

  return {
    members,
    excluded: Object.entries(excluded).map(([reason, count]) => ({ reason, count })),
    unreachable,
  };
}

type Seeds = {
  byPhone: Map<string, { name: string | null; orderNumber: string }>;
  unreachable: number;
};

/** Whether any person-level filter is set, which decides how members are found. */
function usesPeople(segment: Segment): boolean {
  return !!(segment.personStage || segment.priority || segment.messaged);
}

/**
 * Members from the person-level funnel.
 *
 * Everything the People screen shows, with the same definitions, so a campaign
 * built from a filter reaches exactly the people that filter was showing. The
 * count on screen and the count in the dry run are the same number because
 * they come from the same function.
 */
async function peopleSeeds(segment: Segment, limit: number): Promise<Seeds> {
  const { rows } = await listPeople(
    {
      stage: segment.personStage,
      priority: segment.priority,
      messaged: segment.messaged,
      district: segment.district,
      from: segment.from,
      to: segment.to,
      replied: segment.hasReplied || undefined,
    },
    0,
    limit
  );

  return {
    // Hottest first, which listPeople already sorted them into — so a capped
    // campaign spends its cap on the people most worth spending it on.
    byPhone: new Map(
      rows.map((p) => [p.phone, { name: p.name, orderNumber: p.lastOrderNumber }])
    ),
    // A person with no usable number never became a person at all.
    unreachable: 0,
  };
}

/** Members from matching order rows, collapsed to one per phone afterwards. */
async function orderSeeds(segment: Segment, limit: number): Promise<Seeds> {
  const orders = await matchingOrders(segment, limit);
  const byPhone: Seeds["byPhone"] = new Map();
  let unreachable = 0;

  for (const o of orders) {
    const phone = toWhatsAppNumber(o.buyer_phone);
    if (!phone) {
      unreachable++;
      continue;
    }
    if (!byPhone.has(phone)) {
      byPhone.set(phone, { name: o.buyer_name, orderNumber: o.order_number });
    }
  }

  return { byPhone, unreachable };
}

interface OrderRow {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
}

async function matchingOrders(segment: Segment, limit: number): Promise<OrderRow[]> {
  // portal_orders carries both derived stages as columns, so neither has to be
  // reassembled from raw fields here — the thing migration 0045 exists to stop.
  let query = supabaseAdmin
    .from("portal_orders")
    .select("order_number, buyer_name, buyer_phone, ordered_at")
    .order("ordered_at", { ascending: false })
    .limit(limit);

  if (segment.deliveryStage) {
    query = query
      .eq("delivery_stage", segment.deliveryStage)
      .eq("payment_status", "paid")
      .not("address_line1", "is", null);
  }

  if (segment.orderStage) {
    switch (segment.orderStage) {
      case "lead":
        query = query.is("razorpay_order_id", null).neq("payment_status", "paid");
        break;
      case "payment_started":
        query = query.not("razorpay_order_id", "is", null).eq("payment_status", "pending");
        break;
      case "failed":
        query = query.eq("payment_status", "failed");
        break;
      case "paid_no_address":
        query = query.eq("payment_status", "paid").is("address_line1", null);
        break;
      case "complete":
        query = query.eq("payment_status", "paid").not("address_line1", "is", null);
        break;
    }
  }

  if (segment.from) query = query.gte("ordered_at", segment.from);
  if (segment.to) query = query.lt("ordered_at", segment.to);
  if (segment.district) query = query.eq("district", segment.district);

  const { data, error } = await query;
  if (error) {
    console.error("[CRM] segment query failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as OrderRow[];
}

interface ContactLite {
  id: string;
  phone: string;
  display_name: string | null;
  opt_out_at: string | null;
  marketing_opt_in_at: string | null;
  last_inbound_at: string | null;
}

/** Contacts for a list of phones, in chunks Postgres will accept. */
async function contactsFor(phones: string[]): Promise<Map<string, ContactLite>> {
  const map = new Map<string, ContactLite>();
  const CHUNK = 500;

  for (let i = 0; i < phones.length; i += CHUNK) {
    const { data } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("id, phone, display_name, opt_out_at, marketing_opt_in_at, last_inbound_at")
      .in("phone", phones.slice(i, i + CHUNK));

    for (const c of (data ?? []) as unknown as ContactLite[]) {
      map.set(c.phone, c);
    }
  }
  return map;
}

export function describeSegment(segment: Segment): string {
  const parts: string[] = [];
  if (segment.personStage) parts.push(PERSON_STAGE_LABELS[segment.personStage]);
  if (segment.priority) parts.push(`${PRIORITY_LABELS[segment.priority]} priority`);
  if (segment.messaged === "no") parts.push("never messaged");
  if (segment.messaged === "yes") parts.push("already messaged");
  if (segment.orderStage) {
    parts.push(
      SEGMENT_SOURCES[0].options.find((o) => o.value === segment.orderStage)?.label ??
        segment.orderStage
    );
  }
  if (segment.deliveryStage) {
    parts.push(
      SEGMENT_SOURCES[1].options.find((o) => o.value === segment.deliveryStage)?.label ??
        segment.deliveryStage
    );
  }
  if (segment.district) parts.push(`in ${segment.district}`);
  if (segment.from) parts.push(`from ${segment.from.slice(0, 10)}`);
  if (segment.to) parts.push(`before ${segment.to.slice(0, 10)}`);
  if (segment.hasReplied) parts.push("who have written to us");
  if (segment.marketingOptInOnly) parts.push("opted in to marketing");
  return parts.join(" · ") || "Everyone";
}
