import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows, type PageResult } from "@/lib/db/paginate";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";
import type { OrderStatus } from "@/lib/types/order";
import { COURIER_SHEET_MAX, type CourierParcel } from "@/lib/courier-sheet";
import { CONTACT_COLUMNS, type ContactRow } from "@/lib/delivery/contacts";

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
 * is recorded on `courier_entered_at` (migration 0016). The other four are
 * fulfilment statuses the customer also sees.
 */
export const PORTAL_STATUS_STEPS = [
  "processing",
  "shipped",
  // Out for delivery was missing here, and its absence was doing real damage:
  // it is a status a Delhivery scan sets on its own (statusFromScan reads their
  // "Dispatched" as exactly this), so parcels arrived in a state the portal had
  // no column for. `reached()` found no index for it and ticked nothing, which
  // drew a parcel out on the van today as less far along than one merely
  // shipped, and no filter chip could select the pile at all.
  "out_for_delivery",
  "delivered",
] as const satisfies readonly OrderStatus[];

export type PortalStatusStep = (typeof PORTAL_STATUS_STEPS)[number];

/** Column headings, in the agent's words rather than the database's. */
export const PORTAL_STEP_LABELS: Record<PortalStatusStep, string> = {
  processing: "Packed",
  shipped: "Shipped",
  // "On the van" rather than the customer-facing "Out for Delivery": this is a
  // column heading in a grid that already has four of them, and it is the
  // courier's own word for the scan an agent is ticking against.
  out_for_delivery: "On the van",
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
  out_for_delivery: "On the van",
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
  out_for_delivery: "Out for delivery",
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
 * Parcels that need something done to them before the box is taped shut.
 *
 * Worth a filter because they are rare and unrecoverable: about 10 parcels in
 * 1,270 are gifts and 5 of those are signed, which is far too few to find by
 * scrolling — and the mistake they guard against, an unwrapped gift or an
 * unsigned copy, is only discovered by the customer.
 *
 * Single-select rather than two checkboxes because the two are nested in the
 * data, not independent: `is_signed` is only ever set alongside `is_gift`
 * (verified — zero signed-but-not-gift rows), so "signed" is already a subset
 * of "gift" and offering them as separate toggles would imply a combination
 * that cannot exist.
 */
export const PORTAL_PACKING = ["gift", "signed", "plain"] as const;

export type PortalPacking = (typeof PORTAL_PACKING)[number];

export const PORTAL_PACKING_LABELS: Record<PortalPacking, string> = {
  gift: "Gift wrap",
  signed: "Signed",
  plain: "Nothing extra",
};

export const PORTAL_PACKING_HINTS: Record<PortalPacking, string> = {
  gift: "Wrap before it goes in the box",
  signed: "Every copy signed — and gift wrapped",
  plain: "Pack and send as it is",
};

export const portalPacking = (v: string | undefined): PortalPacking | null =>
  (PORTAL_PACKING as readonly string[]).includes(v ?? "") ? (v as PortalPacking) : null;

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
  /** Get every copy signed before wrapping it (0040). */
  is_signed: boolean;
  status: OrderStatus;
  courier_entered_at: string | null;
  /** The number this parcel went to the courier under — see migration 0024. */
  courier_reference: string | null;
  /**
   * India Post's article number, where one has been allotted (0049).
   *
   * Merged in after the page query rather than selected with it — see
   * `withPostalBarcodes` below.
   */
  postal_barcode?: string | null;
  /** Which logistics partner carries it, or null if undecided (0030). */
  courier_id: string | null;
  /** The derived state — see migration 0035 and lib/delivery/handover.ts. */
  handover_state: string | null;
  /** When their API accepted it — the parcel is out of the agent's hands. */
  courier_sent_at: string | null;
  /** The courier's own latest scan, and when they recorded it. */
  courier_last_scan: string | null;
  courier_last_scan_at: string | null;
  tracking_number: string | null;
  assigned_agent_id: string | null;
  /** When checkout began. The parcel's own date is `ordered_at` (0043). */
  created_at: string;
  paid_at: string | null;
  ordered_at: string;
  /** When an agent was given it, or null if it went straight to a courier. */
  assigned_at: string | null;
  /**
   * The date this screen is organised by — see migration 0046.
   *
   * `assigned_at` where there is one, `ordered_at` where there is not, and
   * `work_at_is_assignment` is which. The grid has to show that difference: a
   * quarter of the portal is courier-only parcels nobody was ever assigned, and
   * a column that silently means "assigned" on some rows and "ordered" on
   * others is worse than either.
   *
   * Only the view has these. On the fallback path below they are absent, which
   * the grid reads as "just show the order date".
   */
  work_at?: string | null;
  work_at_is_assignment?: boolean | null;
}

/**
 * Fill in each row's India Post article number.
 *
 * A second query rather than a column on the page query, and the reason is the
 * view. `portal_orders` is `SELECT o.*`, which Postgres expanded to the column
 * list as it stood when the view was created — so it carries every column
 * `orders` had in 0028 and none added since. `postal_barcode` arrived in 0049
 * and is not in it.
 *
 * The documented fix is to rebuild the view in the migration that adds the
 * column, and that is still the right thing to do — see the note on
 * fetchPortalPage. But migrations here are applied by hand, and adding
 * `postal_barcode` to PORTAL_COLUMNS before somebody runs one would throw the
 * view query on every load and drop the whole screen onto its degraded
 * fallback, losing the handover filter for everyone.
 *
 * So: one extra lookup, keyed by order number, over the fifty rows already on
 * the page. It cannot break the view, it needs nothing run by hand, and it
 * fails soft — a lookup that errors leaves the numbers blank rather than
 * taking the portal down with it.
 */
export async function withPostalBarcodes<T extends { order_number: string }>(
  rows: T[]
): Promise<(T & { postal_barcode: string | null })[]> {
  const blank = rows.map((r) => ({ ...r, postal_barcode: null as string | null }));
  if (!rows.length) return blank;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("order_number,postal_barcode")
    .in("order_number", rows.map((r) => r.order_number))
    .not("postal_barcode", "is", null);

  if (error) {
    console.error("[Portal] article number lookup failed:", error.message);
    return blank;
  }

  const byOrder = new Map(
    (data ?? []).map((r) => {
      const row = r as { order_number: string; postal_barcode: string };
      return [row.order_number, row.postal_barcode];
    })
  );
  if (!byOrder.size) return blank;

  return rows.map((r) => ({ ...r, postal_barcode: byOrder.get(r.order_number) ?? null }));
}

const PORTAL_COLUMNS =
  "id,order_number,buyer_name,buyer_phone,address_line1,address_line2,city,district," +
  "state,pincode,amount_paise,quantity,is_gift,gift_message,is_signed," +
  "status,courier_entered_at,courier_reference,courier_id,courier_sent_at," +
  "courier_last_scan,courier_last_scan_at,handover_state," +
  "tracking_number,assigned_agent_id,created_at,paid_at,ordered_at,assigned_at";

/** The view's derived columns. Absent from `orders`, so the fallback drops them. */
const PORTAL_VIEW_COLUMNS = PORTAL_COLUMNS + ",work_at,work_at_is_assignment";

/**
 * The same list, minus everything only the view can answer.
 *
 * `handover_state` is derived in SQL (0035) and does not exist on `orders`, so
 * asking the table for it fails — which meant the fallback below, the whole
 * point of which is to survive a stale view, could not itself run. The portal
 * did not degrade on a missing column; it went blank. Both retries selected the
 * column that had just failed.
 *
 * It matters more now than it did: 0046 changes the sort key, so a deploy that
 * lands before its migration takes this path on every request.
 */
const PORTAL_TABLE_COLUMNS = PORTAL_COLUMNS.replace("handover_state,", "");

const isDate = (s?: string): s is string => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

/** The portal's scope and filters — the same against the view or the table. */
function portalQuery(
  table: "portal_orders" | "orders",
  /**
   * One day, or the start of a range — see `dateTo`.
   *
   * Kept as `date` rather than renamed to `dateFrom`: links to this screen get
   * pasted into WhatsApp and stay in people's history, and a parameter rename
   * would quietly widen every one of them to "all days".
   */
  date: string | undefined,
  status: string | undefined,
  /** Whose parcels. null = every agent's, for an owner or manager. */
  agentId: string | null,
  columns: string = PORTAL_COLUMNS,
  /** Which courier's parcels. null = all of them. */
  courierId: string | null = null,
  /** Whether the courier has a record of it. null = don't care. */
  tracking: PortalTracking | null = null,
  /** A handover_state value (migration 0035), or null for all of them. */
  handover: string | null = null,
  /** Gift / signed / neither, or null for all of them. */
  packing: PortalPacking | null = null,
  /**
   * The last day of the range, inclusive. Absent means `date` is a single day.
   *
   * A range because the portal is not always worked a day at a time: a backlog
   * is drained across a week, and "everything from Monday to Thursday" was
   * four page loads and a mental tally.
   */
  dateTo: string | undefined = undefined
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
  // Only the view carries handover_state. On the fallback path below there is
  // no such column, so the filter is skipped rather than throwing — a degraded
  // screen beats a blank one.
  if (handover && table === "portal_orders") {
    query = query.eq("handover_state", handover);
  }

  if (tracking === "with") {
    query = query.not("tracking_number", "is", null).neq("tracking_number", "");
  } else if (tracking === "without") {
    query = query.or("tracking_number.is.null,tracking_number.eq.");
  }

  // `is`, not `eq`, and `not.is.true` for the negative case.
  //
  // These are nullable booleans: a row created before the column existed holds
  // NULL rather than false. `eq false` would silently drop every one of those
  // from "Nothing extra" — the filter that most has to be complete, because it
  // is the pile somebody packs without looking. `not.is.true` catches false and
  // NULL together.
  //
  // Written as two `not` filters rather than two `or`s on purpose: the scope
  // above already spends this query's one `or`, and PostgREST combining several
  // top-level `or` parameters is not something to rest a packing instruction
  // on. Two `not`s are ANDed with no ambiguity at all.
  if (packing === "gift") {
    query = query.is("is_gift", true);
  } else if (packing === "signed") {
    query = query.is("is_signed", true);
  } else if (packing === "plain") {
    query = query.not("is_gift", "is", true).not("is_signed", "is", true);
  }

  // The day picker filters on the same clock the list is sorted by — the day
  // the parcel was assigned (0046), falling back to the day it was ordered.
  //
  // It used to filter on `created_at`, the moment checkout BEGAN, while the
  // sort key was the order date. Those are different instants, so picking a day
  // could show a parcel the heading above it dated differently. Two controls,
  // one clock.
  //
  // Timestamps are UTC and the day is an IST calendar day — convert, or the
  // filter is 5h30m out and silently drops the early-morning parcels.
  if (isDate(date) || isDate(dateTo)) {
    // `work_at` exists only on the view. The fallback path keeps the old
    // column, because a degraded screen beats a thrown query.
    const column = table === "portal_orders" ? "work_at" : "created_at";

    // Either end may stand alone: "since Monday" and "up to Thursday" are both
    // things people ask for, and a range that demanded both would turn each of
    // them into a date somebody had to invent.
    //
    // Both ends are IST calendar days and the column is UTC, so the end is the
    // START of the following day, exclusive — otherwise the last day of a
    // range is silently dropped except for its first instant.
    if (isDate(date)) query = query.gte(column, istDayStartUTC(date));
    if (isDate(dateTo)) query = query.lt(column, istDayEndUTC(dateTo));
    // One day, given only as `date`: closed on both sides, as before.
    else if (isDate(date)) query = query.lt(column, istDayEndUTC(date));
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
  tracking: PortalTracking | null = null,
  /** A handover_state value, or null for all of them. */
  handover: string | null = null,
  /** Gift / signed / neither, or null for all of them. */
  packing: PortalPacking | null = null,
  /** The last day of the range, inclusive. Absent means `date` is one day. */
  dateTo: string | undefined = undefined
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
  //
  // The day is the ASSIGNED day now, not the order day (0046). A batch routed
  // this morning lands together under this morning, which is how the work
  // actually happened — before this, one morning's routing was spread across
  // however many days of order dates it happened to cover.
  let result = await portalQuery(
    "portal_orders",
    date,
    status,
    agentId,
    PORTAL_VIEW_COLUMNS,
    courierId,
    tracking,
    handover,
    packing,
    dateTo
  )
    .order("work_day", { ascending })
    .order("needs_entry", { ascending: false })
    .order("work_at", { ascending })
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
  // is dropped and rebuilt. See migration 0028 — and 0046, which is the one
  // that has to be applied for the assigned-day ordering to take effect at all.
  //
  // Note the fallback sorts by `created_at`, not by the assigned day: `work_at`
  // is a view column and there is nothing to order by on the bare table. A
  // database missing 0046 therefore keeps the OLD ordering rather than breaking
  // — degraded and legible, which is the whole point of this path.
  if (result.error) {
    console.error(
      "[Portal] worklist query failed — portal_orders may be stale. If this " +
        "says work_at/work_day does not exist, migration 0046 has not been " +
        "applied and the list is falling back to the OLD order-date ordering.",
      result.error.message
    );
    result = await portalQuery(
      "orders",
      date,
      status,
      agentId,
      PORTAL_TABLE_COLUMNS,
      courierId,
      tracking,
      handover,
      packing,
      dateTo
    )
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
        PORTAL_TABLE_COLUMNS.replace("courier_reference,", ""),
        courierId,
        tracking,
        handover,
        packing,
        dateTo
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

/**
 * Every parcel the current filters match, as a contact row.
 *
 * The same `portalQuery` the grid is built from, with two differences that are
 * the whole reason it exists: five columns instead of thirty, and no page —
 * "download what I filtered" means the 674 the count says, not the 100 on
 * screen. Paged through `fetchAllRows`, because PostgREST silently truncates
 * at 1000 and an export that quietly stops two thirds of the way through is
 * worse than one that refuses.
 *
 * Ordered oldest first: an export is worked top to bottom, and the customer
 * who has waited longest should be the first line of the file.
 *
 * Read-only, and it stays that way. Nothing here ticks, reserves or hands over
 * anything — see lib/delivery/contacts.ts.
 */
export async function fetchPortalContacts(
  date: string | undefined,
  status: string | undefined,
  agentId: string | null = null,
  courierId: string | null = null,
  tracking: PortalTracking | null = null,
  handover: string | null = null,
  packing: PortalPacking | null = null,
  dateTo: string | undefined = undefined
): Promise<{ rows: ContactRow[]; truncated: boolean }> {
  const query = (table: "portal_orders" | "orders", from: number, to: number) =>
    portalQuery(
      table,
      date,
      status,
      agentId,
      CONTACT_COLUMNS,
      courierId,
      tracking,
      handover,
      packing,
      // The end of the range. Omitting it here did not fail — `dateTo`
      // defaults to undefined and portalQuery quietly treats the range as a
      // single day — so the export returned the first day of whatever range
      // was on screen and called it the answer. A dropped argument that
      // type-checks is the kind this list of ten positional parameters
      // invites.
      dateTo
    )
      // `ordered_at` rather than the view's work_at: it is on both tables, so
      // the fallback below sorts the file the same way as the view does rather
      // than handing someone a differently-ordered spreadsheet on a day the
      // view happens to be stale.
      .order("ordered_at", { ascending: true })
      .range(from, to);

  // Which table can answer, decided before paging rather than during it.
  // `fetchAllRows` deliberately swallows a mid-page failure and returns what it
  // has, so a stale view would otherwise produce an empty file and call it a
  // success — the one outcome an export must never have. One cheap row settles
  // it. The only filter that needs the view is `handover`, which portalQuery
  // already skips on the table.
  const probe = await query("portal_orders", 0, 0);
  const table = probe.error ? "orders" : "portal_orders";

  if (probe.error) {
    console.error(
      "[Portal] contact export fell back to the orders table — portal_orders may be stale:",
      probe.error.message
    );
  }

  return fetchAllRows<ContactRow>(
    // The cast is the same one fetchPortalPage makes on its own rows: the
    // column list is a runtime string, so PostgREST's generics cannot know it
    // describes a ContactRow and infer an error shape instead.
    (from, to) => query(table, from, to) as unknown as PromiseLike<PageResult<ContactRow>>,
    { label: "portal contact export" }
  );
}

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
 * "New" in the strict sense the sheet needs: paid, addressed, routed to a
 * courier, still at 'confirmed', and not yet handed over. A parcel
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
  limit: number = COURIER_SHEET_MAX,
  /**
   * The partner asking, or null for someone who may sheet up anybody's parcels.
   *
   * This is the guard, not the order numbers: the ids come from the browser and
   * prove nothing. A parcel belonging to another courier simply is not returned,
   * so it never reaches the file — which matters more here than on any other
   * route, because the file IS every customer's name, mobile and home address.
   */
  courierId: string | null = null
): Promise<CourierParcel[]> {
  if (!orderNumbers.length) return [];

  let query = supabaseAdmin
    .from("orders")
    .select(
      "order_number,buyer_name,buyer_phone,buyer_email,address_line1,address_line2,city," +
        // courier_id, because the reference is coded per partner — see
        // referenceCode() in lib/couriers.
        "district,state,pincode,amount_paise,quantity,courier_reference,courier_id,is_gift," +
        // Allotted before this parcel was ever put on a sheet. A re-download
        // must reuse it rather than spend a second number — see
        // lib/db/postal-barcodes.ts.
        "postal_barcode"
    )
    .in("order_number", orderNumbers.slice(0, limit))
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    // Routed to a courier — which is what "somebody is taking this" means now.
    // This asked for an assigned_agent_id until the courier became the
    // decision, at which point it silently matched nothing: a parcel assigned
    // to KKR and to nobody else produced an empty sheet and a refusal saying
    // none of the parcels could go on one.
    .not("courier_id", "is", null)
    .eq("status", "confirmed")
    .is("courier_entered_at", null);

  // Kept for an owner narrowing to one agent's parcels. A delivery login is no
  // longer scoped this way — it sees the courier's work — so this is normally
  // null and `courierId` below is what actually confines a partner.
  if (agentId) query = query.eq("assigned_agent_id", agentId);
  if (courierId) query = query.eq("courier_id", courierId);

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
 * The couriers these order numbers are routed to.
 *
 * A cheap lookup — two columns against an indexed `in` — run before the real
 * fetch so the route knows which kind of sheet it is building before it builds
 * it. India Post and everyone else answer a different question about which
 * parcels may go on a file, and that question has to be settled first.
 *
 * Carries no personal data on purpose: the order numbers came from a browser,
 * and this runs before any scope check. All it learns is which partner a
 * parcel belongs to; the scoped fetch afterwards is what decides whether the
 * caller may see it.
 */
export async function routedCouriersFor(orderNumbers: string[]): Promise<Set<string>> {
  if (!orderNumbers.length) return new Set();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("courier_id")
    .in("order_number", orderNumbers.slice(0, COURIER_SHEET_MAX))
    .not("courier_id", "is", null);

  if (error) {
    console.error("[Portal] could not read routing for this batch:", error.message);
    throw new Error(error.message);
  }

  return new Set(
    (data ?? [])
      .map((r) => (r as { courier_id: string | null }).courier_id)
      .filter((id): id is string => !!id)
  );
}

/**
 * The parcels that can go on an India Post booking file.
 *
 * Deliberately NOT `fetchPickedForCourierSheet`, and the difference is one
 * clause that matters more than it looks.
 *
 * That one refuses anything with a `courier_entered_at`, because for Delhivery
 * the download IS the handover — a parcel that has been on a sheet is with the
 * courier, and putting it on a second one would enter the same address twice.
 *
 * India Post cannot use that test. A Speed Post parcel is not "with them" until
 * it carries an article number out of our allotment: that number is what their
 * booking file is keyed by and what every scan afterwards is recorded against.
 * `courier_entered_at` on such a parcel says only that somebody ticked it
 * Confirmed — which is true of every parcel routed to Speed Post before this
 * workbook existed, and of any parcel confirmed by hand on the grid.
 *
 * Gating on `courier_entered_at` therefore locked exactly the parcels that
 * need numbers out of the only route that hands them out. They printed with an
 * empty barcode strip, for ever, with a full allotment sitting unused.
 *
 * So the gate is the honest one: **routed to this courier, still Confirmed,
 * and not yet holding an article number.** It keeps the property the other
 * gate was protecting — a parcel can appear on exactly one booking file,
 * because the first one gives it a number and the number is never returned —
 * and it drops the part that was never true of India Post.
 */
export async function fetchPickedForPostalSheet(
  orderNumbers: string[],
  limit: number = COURIER_SHEET_MAX,
  /** The partner asking. The guard, exactly as in the sibling above. */
  courierId: string | null = null
): Promise<CourierParcel[]> {
  if (!orderNumbers.length) return [];

  let query = supabaseAdmin
    .from("orders")
    .select(
      "order_number,buyer_name,buyer_phone,buyer_email,address_line1,address_line2,city," +
        "district,state,pincode,amount_paise,quantity,courier_reference,courier_id,is_gift," +
        "postal_barcode"
    )
    .in("order_number", orderNumbers.slice(0, limit))
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .not("courier_id", "is", null)
    .eq("status", "confirmed")
    // The whole difference, and it takes both halves.
    //
    // A parcel that has been on a booking file has two marks on it: the file
    // gave it an article number, and downloading the file stamped
    // courier_entered_at. Having BOTH is what "already booked" means, so
    // missing EITHER puts it back in scope.
    //
    // One clause on its own is wrong in a way that strands parcels:
    //   * `postal_barcode IS NULL` alone strands a parcel that took a number
    //     from a download that then failed before it was stamped — it would
    //     hold a number and never be offered a file again.
    //   * `courier_entered_at IS NULL` alone — the Delhivery test — strands
    //     every parcel confirmed by hand or routed to Speed Post before this
    //     workbook existed, which was all of them.
    .or("postal_barcode.is.null,courier_entered_at.is.null");

  if (courierId) query = query.eq("courier_id", courierId);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error(
      "[Portal] postal sheet query failed — is migration 0049 applied?",
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

/**
 * The addresses behind a set of ticked rows, for the printable sheet.
 *
 * Deliberately NOT `fetchPickedForCourierSheet`. That one is the handover: it
 * only returns parcels that can still go onto an upload file, because
 * downloading it confirms them. This is paper. A partner reprints a page they
 * dropped, or prints one for parcels they handed over yesterday, and refusing
 * them because a column says `courier_entered_at` would be a rule protecting
 * nothing.
 *
 * The scope is the portal's own — paid, addressed, not cancelled, routed to
 * somebody — plus the caller's courier. `courierId` is the guard: the order
 * numbers arrive from a browser and prove nothing, and this query is every
 * customer's name, mobile and home address.
 */
export async function fetchAddressesForSheet(
  orderNumbers: string[],
  courierId: string | null,
  limit: number = COURIER_SHEET_MAX
): Promise<AddressSheetRow[]> {
  if (!orderNumbers.length) return [];

  let query = supabaseAdmin
    .from("orders")
    .select(
      "order_number,buyer_name,buyer_phone,address_line1,address_line2,city," +
        // courier_id because the return address is per courier — the sheet
        // stamps each parcel with the address it would actually come back to.
        // postal_barcode and courier_reference because the foot of every cell
        // is a barcode — the article number where India Post allotted one, the
        // courier's reference otherwise. See sheetBarcodeValue().
        "district,state,pincode,quantity,is_gift,is_signed,ordered_at,courier_id," +
        "postal_barcode,courier_reference"
    )
    .in("order_number", orderNumbers.slice(0, limit))
    .eq("payment_status", "paid")
    .not("address_line1", "is", null)
    .neq("status", "cancelled")
    .or("assigned_agent_id.not.is.null,courier_id.not.is.null");

  if (courierId) query = query.eq("courier_id", courierId);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[Portal] address sheet query failed:", error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as AddressSheetRow[];
}

/** Exactly what buildAddressSheet reads — see lib/address-sheet.ts. */
export interface AddressSheetRow {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  quantity: number | null;
  is_gift: boolean | null;
  is_signed: boolean | null;
  ordered_at: string;
  /** India Post's article number, where one has been allotted. */
  postal_barcode: string | null;
  /** What the courier files this parcel under (0024). */
  courier_reference: string | null;
  /** Whose return address goes on this one. Null for a parcel routed to nobody. */
  courier_id: string | null;
}

/**
 * Which courier is carrying this parcel — `undefined` if there is no such order.
 *
 * The portal's write guard since 0047, replacing the agent check above. Same
 * reasoning, one level up: a partner's screen only ever shows their own
 * courier's parcels, and the screen is not the enforcement. A POST carrying
 * another partner's order number is one devtools console away, and it would
 * expose that customer's name, mobile and home address to a competitor.
 *
 * `null` — routed to nobody yet — is a real answer and deliberately not an
 * error. `mayHandle` in lib/delivery/scope.ts refuses it for a partner and
 * allows it for an owner, which is the correct split: an unrouted parcel is
 * the owner's to route.
 */
export async function courierOf(
  orderNumber: string
): Promise<string | null | undefined> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("courier_id")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (error) {
    console.error("[Portal] courier lookup failed:", error.message);
    throw new Error(error.message);
  }
  return data ? ((data.courier_id as string | null) ?? null) : undefined;
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
