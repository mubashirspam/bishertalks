import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";
import type { OrderStatus } from "@/lib/types/order";
import { COURIER_SHEET_MAX, type CourierParcel } from "@/lib/courier-sheet";

/**
 * The delivery portal's data.
 *
 * Deliberately its own query rather than a reuse of `buildDeliveryQuery`: that
 * one is organised around the *label printing* workflow (to_print / packed are
 * derived from whether a PDF was generated), and the portal has no printing at
 * all.
 *
 * The scope is the same definition of shippable the master queue uses — paid,
 * and we know where to send it. An order missing either belongs in the funnel
 * at /admin/orders, not in front of someone packing parcels.
 */

/**
 * The tick columns, in the order the work happens.
 *
 * "Confirmed" is the odd one out and the reason this isn't just a status list:
 * it means the agent has entered the address into the courier's system, which
 * is recorded on `courier_entered_at` (migration 0016). The other three are
 * fulfilment statuses the customer also sees.
 */
export const PORTAL_STATUS_STEPS = [
  "processing",
  "shipped",
  "delivered",
] as const satisfies readonly OrderStatus[];

export type PortalStatusStep = (typeof PORTAL_STATUS_STEPS)[number];

/** Column headings, in the agent's words rather than the database's. */
export const PORTAL_STEP_LABELS: Record<PortalStatusStep, string> = {
  processing: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
};

/** What the first column means, spelled out where an agent will see it. */
export const ENTERED_LABEL = "Confirmed";
export const ENTERED_HINT = "Address entered in the courier's system";

/**
 * The portal's filter chips, in pipeline order.
 *
 * "new" is not a database status — it is the agent's to-do list: still at
 * 'confirmed' AND not yet entered into the courier's system
 * (courier_entered_at is null). "Confirmed" is the other half of that same
 * status: entered, but not yet packed. Splitting them is the whole point —
 * one chip for 'confirmed' kept showing parcels the agent had already sheeted
 * up, next to ones nobody had touched.
 *
 * No 'cancelled': a cancelled order is not a parcel, there is nothing for an
 * agent to do with one, and reversing a cancellation is an owner's decision
 * made on the order screen. They are excluded from the query outright, so the
 * filter has nothing to offer either.
 */
export const PORTAL_FILTERS = [
  "new",
  "confirmed",
  ...PORTAL_STATUS_STEPS,
  "returned",
] as const;

export type PortalFilter = (typeof PORTAL_FILTERS)[number];

export function isPortalFilter(v: string | undefined): v is PortalFilter {
  return !!v && (PORTAL_FILTERS as readonly string[]).includes(v);
}

export const PORTAL_FILTER_LABELS: Record<PortalFilter, string> = {
  new: "New",
  confirmed: "Confirmed",
  processing: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
};

/**
 * A fulfilment status in words, for the grid's undo prompts. Only the steps
 * past 'confirmed' ever appear there — you cannot untick your way below New.
 */
export const PORTAL_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  processing: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
};

/**
 * Statuses an agent's tick may set — real order statuses only. The filters
 * add a "new" pseudo-status on top of these (see PORTAL_FILTERS), and that
 * one must never reach a write.
 */
const PORTAL_SETTABLE = ["confirmed", ...PORTAL_STATUS_STEPS, "returned"] as const;

export function isPortalStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && (PORTAL_SETTABLE as readonly string[]).includes(v);
}

/**
 * Whether the courier actually has the parcel.
 *
 * A separate question from fulfilment status, and the one the Excel channel
 * could never answer: a sheet being downloaded stamped courier_entered_at and
 * looked exactly like success, whether or not anyone uploaded it. Having a
 * waybill is the only proof the courier ever received it.
 *
 *   "with"     the courier has it — a waybill came back
 *   "without"  we marked it handed over and the courier has no record
 */
export const PORTAL_TRACKING = ["with", "without"] as const;

export type PortalTracking = (typeof PORTAL_TRACKING)[number];

export const PORTAL_TRACKING_LABELS: Record<PortalTracking, string> = {
  with: "With the courier",
  without: "Not with them",
};

export const portalTracking = (v: string | undefined): PortalTracking | null =>
  v === "with" || v === "without" ? v : null;

/**
 * Which end of the queue is at the top.
 *
 * "newest" is the default and the day's job — today's parcels first. "oldest"
 * is for draining a backlog: the customer who has waited longest is the first
 * row on the screen, which is the order the courier sheet is built in anyway.
 *
 * The same two words the master delivery queue uses (see delivery-query.ts),
 * so a link copied between the two screens means the same thing.
 */
export type PortalSort = "newest" | "oldest";

export const portalSort = (v: string | undefined): PortalSort =>
  v === "oldest" ? "oldest" : "newest";

export interface PortalRow {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  amount_paise: number;
  quantity: number;
  /** Wrap it before it goes out (0027). The message stays on the order page. */
  is_gift: boolean;
  gift_message: string | null;
  status: OrderStatus;
  courier_entered_at: string | null;
  /** The number this parcel went to the courier under — see migration 0024. */
  courier_reference: string | null;
  /** Which logistics partner carries it, or null if undecided (0030). */
  courier_id: string | null;
  /** When their API accepted it — the parcel is out of the agent's hands. */
  courier_sent_at: string | null;
  /** The courier's own latest scan, and when they recorded it. */
  courier_last_scan: string | null;
  courier_last_scan_at: string | null;
  tracking_number: string | null;
  assigned_agent_id: string | null;
  created_at: string;
}

const PORTAL_COLUMNS =
  "id,order_number,buyer_name,buyer_phone,address_line1,address_line2,city,district," +
  "state,pincode,amount_paise,quantity,is_gift,gift_message," +
  "status,courier_entered_at,courier_reference,courier_id,courier_sent_at," +
  "courier_last_scan,courier_last_scan_at," +
  "tracking_number,assigned_agent_id,created_at";

const isDate = (s?: string): s is string => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

/** The portal's scope and filters — the same against the view or the table. */
function portalQuery(
  table: "portal_orders" | "orders",
  date: string | undefined,
  status: string | undefined,
  /** Whose parcels. null = every agent's, for an owner or manager. */
  agentId: string | null,
  columns: string = PORTAL_COLUMNS,
  /** Which courier's parcels. null = all of them. */
  courierId: string | null = null,
  /** Whether the courier has a record of it. null = don't care. */
  tracking: PortalTracking | null = null
) {
  let query = supabaseAdmin
    .from(table)
    .select(columns, { count: "exact" })
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .neq("status", "cancelled")
    // Only parcels somebody is carrying. An order with neither an agent nor a
    // courier is not yet anyone's job — it sits in "New" on /admin/delivery
    // until an owner routes it, and showing it here would put work in front of
    // someone that nobody decided was theirs.
    //
    // Either is enough: a parcel handed straight to Delhivery never needs a
    // staff agent, and one an agent is carrying may not have a courier yet.
    .or("assigned_agent_id.not.is.null,courier_id.not.is.null");

  if (agentId) query = query.eq("assigned_agent_id", agentId);
  if (courierId) query = query.eq("courier_id", courierId);

  // An empty string counts as no waybill: an agent saving a blank tracking box
  // stores "", which is not the same as the courier having given us a number.
  if (tracking === "with") {
    query = query.not("tracking_number", "is", null).neq("tracking_number", "");
  } else if (tracking === "without") {
    query = query.or("tracking_number.is.null,tracking_number.eq.");
  }

  // created_at is UTC but the day is an IST calendar day — convert, or the
  // filter is 5h30m out and silently drops the early-morning orders.
  if (isDate(date)) {
    query = query
      .gte("created_at", istDayStartUTC(date))
      .lt("created_at", istDayEndUTC(date));
  }

  if (status === "new") {
    // The to-do list: not yet entered into the courier's system.
    query = query.eq("status", "confirmed").is("courier_entered_at", null);
  } else if (status === "confirmed") {
    // Entered with the courier, not yet packed.
    query = query.eq("status", "confirmed").not("courier_entered_at", "is", null);
  } else if (isPortalFilter(status)) {
    query = query.eq("status", status);
  }

  return query;
}

/**
 * One page of parcels, in the order the work happens.
 *
 * Reads the `portal_orders` view (migration 0018, last rebuilt in 0028), which
 * exists only to give the two derived sort keys names PostgREST can order by.
 * Adding a column to `orders` means rebuilding that view in the same migration
 * — see 0028 for why, and for what it looks like when nobody does.
 *
 * Memoised per request so the header count and the grid resolve from a single
 * round trip, the same way the orders list does.
 */
export const fetchPortalPage = cache(async function fetchPortalPage(
  date: string | undefined,
  status: string | undefined,
  pageNum: number,
  perPage: number,
  /** The signed-in agent, or null for someone who may see every agent's work. */
  agentId: string | null = null,
  sort: PortalSort = "newest",
  /** Which courier's parcels, or null for every one. */
  courierId: string | null = null,
  /** Whether the courier has a record of it, or null for either. */
  tracking: PortalTracking | null = null
) {
  const from = pageNum * perPage;
  const to = (pageNum + 1) * perPage - 1;
  const ascending = sort === "oldest";

  // Newest day first by default — today is the day being worked; "oldest"
  // walks the days the other way, for clearing a backlog. Within a day, the
  // parcels nobody has started come before the ones already handled whichever
  // way round the days run, so the work left is at the top of the day rather
  // than scattered through it. Then the parcels themselves, same direction as
  // the days.
  let result = await portalQuery(
    "portal_orders",
    date,
    status,
    agentId,
    PORTAL_COLUMNS,
    courierId,
    tracking
  )
    .order("ist_day", { ascending })
    .order("needs_entry", { ascending: false })
    .order("created_at", { ascending })
    .range(from, to);

  // Migrations are applied by hand, so the view can be missing — or stale — on
  // a database the code has already been deployed against. An agent seeing an
  // empty portal would read it as "no parcels today", far worse than the old
  // ordering, so fall back to the plain table. Note this only saves the *view*:
  // the assignment columns come from 0019 and both queries need them.
  //
  // "column portal_orders.<x> does not exist" is the stale case, and it is the
  // one that actually happens: the view is `SELECT o.*`, expanded once when it
  // was created, so a column added to orders is invisible here until the view
  // is dropped and rebuilt. See migration 0028.
  if (result.error) {
    console.error(
      "[Portal] worklist query failed — portal_orders may be stale; a column " +
        "added to orders needs the view rebuilt (migration 0028).",
      result.error.message
    );
    result = await portalQuery("orders", date, status, agentId, PORTAL_COLUMNS, courierId, tracking)
      .order("created_at", { ascending })
      .range(from, to);

    // Same reasoning one step further down. The view is rebuilt by 0024 to
    // carry courier_reference, so a database still on 0023 fails both queries
    // above on a column that only fills in the Reference cell — the entire
    // portal would go blank over a nice-to-have. Drop the column instead.
    if (result.error) {
      console.error(
        "[Portal] retrying without courier_reference — is migration 0024 applied?",
        result.error.message
      );
      result = await portalQuery(
        "orders",
        date,
        status,
        agentId,
        PORTAL_COLUMNS.replace("courier_reference,", ""),
        courierId,
        tracking
      )
        .order("created_at", { ascending })
        .range(from, to);
    }

    if (result.error) console.error("[Portal] query failed:", result.error.message);
  }

  return {
    rows: (result.data ?? []) as unknown as PortalRow[],
    count: result.count ?? 0,
  };
});

// ── The courier's bulk-upload sheet ─────────────────────────────────────────

/**
 * The picked parcels, re-read through what the sheet will actually accept.
 *
 * The agent ticks rows and the browser sends their order numbers, but ticked
 * boxes are not proof of anything: the page may have been open since this
 * morning, and a parcel someone else has since put on a sheet must not go onto
 * a second one. So the ids are a filter, never the scope — everything the
 * portal requires is asserted again here, and anything that no longer fits
 * silently drops out of the batch rather than being written to the file.
 *
 * "New" in the strict sense the sheet needs: paid, addressed, assigned to an
 * agent, still at 'confirmed', and not yet entered with the courier. A parcel
 * that has been on a sheet already has a courier_entered_at and fails that
 * last test on its own.
 *
 * Oldest first — the file is a queue being drained, so the customer who has
 * waited longest is at the top of it whatever order the boxes were ticked in.
 *
 * Reads `orders` rather than the portal view: no derived sort key is needed
 * here, and the fewer things this depends on the better, given it is the query
 * whose failure would leave an agent with no way to post anything.
 */
export async function fetchPickedForCourierSheet(
  orderNumbers: string[],
  /** The signed-in agent, or null for someone who may see every agent's work. */
  agentId: string | null,
  limit: number = COURIER_SHEET_MAX
): Promise<CourierParcel[]> {
  if (!orderNumbers.length) return [];

  let query = supabaseAdmin
    .from("orders")
    .select(
      "order_number,buyer_name,buyer_phone,address_line1,address_line2,city," +
        "district,state,pincode,amount_paise,quantity,courier_reference"
    )
    .in("order_number", orderNumbers.slice(0, limit))
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .not("assigned_agent_id", "is", null)
    .eq("status", "confirmed")
    .is("courier_entered_at", null);

  // An agent may only put their own parcels on a sheet. Same rule as every
  // other portal write, and the reason the ids alone are never enough.
  if (agentId) query = query.eq("assigned_agent_id", agentId);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    // courier_reference arrives with migration 0024, and migrations are applied
    // by hand here — say so, because "column does not exist" on a screen an
    // agent is standing in front of is otherwise a mystery.
    console.error(
      "[Portal] courier sheet query failed — is migration 0024 applied?",
      error.message
    );
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as CourierParcel[];
}

/**
 * Which of these reference numbers are already spoken for.
 *
 * Only the candidates for the batch in hand — a hundred-odd strings against a
 * unique index, rather than reading every reference we have ever issued.
 */
export async function takenReferences(candidates: string[]): Promise<string[]> {
  if (!candidates.length) return [];

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("courier_reference")
    .in("courier_reference", candidates);

  if (error) {
    console.error("[Portal] reference lookup failed:", error.message);
    throw new Error(error.message);
  }
  return (data ?? [])
    .map((r) => (r as { courier_reference: string | null }).courier_reference)
    .filter((r): r is string => !!r);
}

/**
 * Record (or undo) "I've entered this into the courier's system".
 *
 * `onlyIfUnset` is what makes ticking a later stage imply this one without
 * rewriting the time it actually happened: an agent who jumps straight to
 * Packed clearly entered it first, but if they'd already ticked Confirmed an
 * hour ago that is the timestamp worth keeping.
 */
export async function setCourierEntered(
  orderNumber: string,
  entered: boolean,
  { onlyIfUnset = false } = {}
): Promise<boolean> {
  let query = supabaseAdmin
    .from("orders")
    .update({
      courier_entered_at: entered ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber);

  if (onlyIfUnset) query = query.is("courier_entered_at", null);

  const { data, error } = await query.select("order_number");

  if (error) {
    console.error("[Portal] courier_entered update failed:", error.message);
    throw new Error(error.message);
  }
  return !!data?.length;
}

/**
 * Who is carrying this parcel — `undefined` if there is no such order.
 *
 * The portal's write guard. An agent's screen only ever shows their own
 * parcels, but the screen is not the enforcement: a POST with someone else's
 * order number is one devtools console away, and marking a colleague's parcel
 * delivered would message that customer over a parcel still in a bag.
 */
export async function assignedAgentOf(
  orderNumber: string
): Promise<string | null | undefined> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("assigned_agent_id")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (error) {
    console.error("[Portal] assignment lookup failed:", error.message);
    throw new Error(error.message);
  }
  return data ? ((data.assigned_agent_id as string | null) ?? null) : undefined;
}

/** Longest courier AWB worth accepting — real ones run 10-20 characters. */
export const TRACKING_MAX = 64;

/**
 * Save the courier's tracking ID against an order.
 *
 * Optional everywhere it's offered: plenty of parcels go out without one, and
 * an agent shouldn't be stopped from marking a parcel shipped because the
 * courier's screen hasn't produced a number yet. An empty string clears it,
 * which is how a typo gets taken back.
 *
 * Writes the same `tracking_number` column the order detail page edits and the
 * customer's tracking page reads, so a number entered here shows up wherever
 * one entered by an owner would.
 */
export async function setTrackingNumber(
  orderNumber: string,
  tracking: string
): Promise<boolean> {
  const value = tracking.trim().slice(0, TRACKING_MAX);

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      tracking_number: value || null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber)
    .select("order_number");

  if (error) {
    console.error("[Portal] tracking update failed:", error.message);
    throw new Error(error.message);
  }
  return !!data?.length;
}
