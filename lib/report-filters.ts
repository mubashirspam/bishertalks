import { istDayStartUTC, istDayEndUTC, istToday, istDaysAgo } from "@/lib/format-date";
import { DELIVERY_STAGES, type DeliveryStage } from "@/lib/delivery-stage";

/**
 * What the reports screen is asking, as one object.
 *
 * Deliberately in its own module and deliberately free of any Supabase import,
 * because the filter bar is a client component and the export route is a
 * server one, and both need the same vocabulary. Dragging `lib/db/*` in here
 * would put the service-role key in the browser bundle — the same reason
 * `lib/delivery-stage.ts` is separate from `lib/db/delivery-query.ts`.
 *
 * Every filter travels as a URL parameter, so a view can be bookmarked, sent
 * to somebody, or reloaded without losing its place — and the download button
 * simply forwards the page's own query string, which is what makes the
 * spreadsheet always equal what was on screen.
 */

// ── Which date the range applies to ──────────────────────────────────────────

/**
 * The report's date axis.
 *
 * This is the control that answers "show me what I assigned to Delhivery on
 * 24 August": pick `courier_assigned`, then set both dates to the 24th.
 *
 * Anything but `ordered` also excludes parcels that have no such date, and
 * that is the point rather than a side effect — "shipped this year" must not
 * count parcels that never shipped.
 */
export const DATE_MODES = [
  "ordered",
  "courier_assigned",
  "agent_assigned",
  "shipped",
  "delivered",
] as const;

export type DateMode = (typeof DATE_MODES)[number];

export const DATE_MODE_LABELS: Record<DateMode, string> = {
  ordered: "Ordered",
  courier_assigned: "Assigned to courier",
  agent_assigned: "Assigned to agent",
  shipped: "Shipped",
  delivered: "Delivered",
};

export const DATE_MODE_HINTS: Record<DateMode, string> = {
  ordered: "The day the customer paid. Every parcel has one.",
  courier_assigned:
    "The day someone chose the courier. Parcels not yet routed are left out.",
  agent_assigned:
    "The day a delivery agent was given the parcel. Parcels with no agent are left out.",
  shipped: "The day it went out. Parcels not yet shipped are left out.",
  delivered: "The day it arrived. Only delivered parcels.",
};

export function isDateMode(v: string | undefined): v is DateMode {
  return !!v && (DATE_MODES as readonly string[]).includes(v);
}

// ── What lateness is measured from ───────────────────────────────────────────

/**
 * A parcel is late relative to something, and which something is the question.
 *
 * "Ten days since the order" is the customer's complaint. "Ten days since we
 * gave it to the courier" is the courier's problem. "Ten days since it
 * shipped" is the road. They point at three different people, so the reader
 * chooses.
 */
export const LATE_BASES = ["ordered", "courier_assigned", "shipped"] as const;

export type LateBasis = (typeof LATE_BASES)[number];

export const LATE_BASIS_LABELS: Record<LateBasis, string> = {
  ordered: "ordered",
  courier_assigned: "assigned to a courier",
  shipped: "shipped",
};

export function isLateBasis(v: string | undefined): v is LateBasis {
  return !!v && (LATE_BASES as readonly string[]).includes(v);
}

/** The threshold chips. Anything else is typed into the box beside them. */
export const LATE_CHIPS = [5, 10, 15];

/** What "late" means when nobody has said otherwise. */
export const DEFAULT_LATE_DAYS = 10;

// ── The delivery promise ─────────────────────────────────────────────────────

/**
 * How long each leg of the journey is allowed to take.
 *
 * Three legs, three different people to chase, which is why they are measured
 * apart rather than as one "days since the order" number:
 *
 *   routing    the order is paid and addressed and nobody has chosen a courier
 *              for it yet. That is entirely ours, and it is the leg this shop
 *              is worst at.
 *   handover   a courier is chosen but the parcel has not shipped. Packing,
 *              manifesting and the physical hand-over.
 *   transit    it is with the courier and moving. Theirs, not ours.
 *
 * The targets live here rather than in the panel that draws them because the
 * same numbers decide three things — the compliance figure, the colour of the
 * card, and the `late` threshold the chase link puts in the URL — and three
 * copies of "2" is how they end up disagreeing.
 *
 * `stages` and `basis` are how each leg is expressed in the filters this screen
 * already has, so a card can hand the parcel table the exact query behind its
 * own number. If those stop matching, the card and the list it opens disagree,
 * which is the one failure that makes a report untrustworthy.
 */
export interface SlaLeg {
  key: "routing" | "handover" | "transit";
  label: string;
  /** What the clock runs from. */
  from: "ordered_at" | "courier_assigned_at" | "shipped_at";
  /** What stops it. Null means it is still running. */
  to: "courier_assigned_at" | "shipped_at" | "delivered_at";
  /** Whole days. Over this and the parcel has missed the promise. */
  target: number;
  /** The delivery stages a parcel on this leg is sitting in. */
  stages: DeliveryStage[];
  /** The matching `lateFrom` basis, for the chase link. */
  basis: LateBasis;
  /** Said in the panel, under the number. */
  blurb: string;
}

export const SLA_LEGS: SlaLeg[] = [
  {
    key: "routing",
    label: "Order to courier",
    from: "ordered_at",
    to: "courier_assigned_at",
    target: 2,
    stages: ["new"],
    basis: "ordered",
    blurb: "Paid and addressed, waiting for somebody to choose a courier.",
  },
  {
    key: "handover",
    label: "Courier to shipped",
    from: "courier_assigned_at",
    to: "shipped_at",
    target: 2,
    stages: ["assigned"],
    basis: "courier_assigned",
    blurb: "Routed, but not yet packed and handed over.",
  },
  {
    key: "transit",
    label: "Shipped to delivered",
    from: "shipped_at",
    to: "delivered_at",
    target: 5,
    stages: ["shipped", "out_for_delivery"],
    basis: "shipped",
    blurb: "On the road with the courier.",
  },
];

// ── Ageing buckets ───────────────────────────────────────────────────────────

/**
 * How long undelivered parcels have been waiting.
 *
 * The boundaries mirror the late chips (5 and 10), so the bucket a parcel
 * falls into and the threshold that flags it as late tell the same story
 * rather than two slightly different ones.
 *
 * `max: null` is the open-ended top bucket.
 */
export const AGE_BUCKETS: { key: string; label: string; min: number; max: number | null }[] = [
  { key: "0-2", label: "0–2 days", min: 0, max: 2 },
  { key: "3-5", label: "3–5 days", min: 3, max: 5 },
  { key: "6-10", label: "6–10 days", min: 6, max: 10 },
  { key: "11-15", label: "11–15 days", min: 11, max: 15 },
  { key: "16+", label: "16+ days", min: 16, max: null },
];

// ── The filter object ────────────────────────────────────────────────────────

export interface ReportFilters {
  by: DateMode;
  /** IST calendar dates, YYYY-MM-DD. `to` is inclusive. */
  from?: string;
  to?: string;
  /** A courier id, or "none" for parcels nobody has routed. */
  courier?: string;
  /** A staff id, or "none" for parcels no agent is carrying. */
  agent?: string;
  /** Several stages at once — "in transit" is two of them. */
  stages: DeliveryStage[];
  /** One handover_state (0035) — what is actually happening to it. */
  handover?: string;
  /** The late threshold in days. Always set; 0 switches lateness off. */
  late: number;
  lateFrom: LateBasis;
  /** Show only the late ones. The threshold above still colours the rest. */
  onlyLate: boolean;
  /** Ageing bucket drill-down, in days since the order. */
  ageMin?: number;
  ageMax?: number;
  books?: string;
  gift?: string;
  signed?: string;
  q?: string;
  /** Delivery address state, matched case- and space-insensitively. */
  state?: string;
  sort: "newest" | "oldest" | "age";
}

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** A whole number from a URL, or undefined. Negatives and junk are dropped. */
function toInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Read filters off a URL or a plain params object, ignoring anything we do not
 * recognise.
 *
 * Accepts both shapes because a Next.js page gets `searchParams` as an object
 * and an API route gets `URLSearchParams`, and both call this — a second
 * parser is a second set of defaults to fall out of step.
 */
export function parseReportFilters(
  p: Pick<URLSearchParams, "get"> | Record<string, string | undefined>
): ReportFilters {
  const get = (k: string) =>
    typeof (p as URLSearchParams).get === "function"
      ? ((p as URLSearchParams).get(k) ?? undefined)
      : (p as Record<string, string | undefined>)[k];

  const by = get("by");
  const lateFrom = get("late_from");
  const sort = get("sort");

  // Comma-separated, and filtered against the known list rather than trusted:
  // it goes into a SQL array parameter, and an unknown stage would quietly
  // match nothing while the screen claimed to be showing it.
  const stages = (get("stage") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is DeliveryStage =>
      (DELIVERY_STAGES as string[]).includes(s)
    );

  const late = toInt(get("late"));

  return {
    by: isDateMode(by) ? by : "ordered",
    from: isDate(get("from")) ? get("from") : undefined,
    to: isDate(get("to")) ? get("to") : undefined,
    courier: get("courier") || undefined,
    agent: get("agent") || undefined,
    stages,
    handover: get("handover") || undefined,
    late: late === undefined ? DEFAULT_LATE_DAYS : late,
    lateFrom: isLateBasis(lateFrom) ? lateFrom : "ordered",
    onlyLate: get("only_late") === "1",
    ageMin: toInt(get("age_min")),
    ageMax: toInt(get("age_max")),
    books: get("books") || undefined,
    gift: get("gift") || undefined,
    signed: get("signed") || undefined,
    q: get("q") || undefined,
    state: get("state") || undefined,
    sort: sort === "oldest" ? "oldest" : sort === "age" ? "age" : "newest",
  };
}

/**
 * The arguments `report_scope` and `report_summary` take.
 *
 * Kept beside the parser on purpose: these two are the pair that must agree
 * with the SQL. Anything added to `ReportFilters` has to be added here and to
 * `report_scope` in migration 0058, and if it is missed the screen offers a
 * control that changes nothing — which is worse than not offering it.
 *
 * `undefined` becomes null, which the SQL reads as "no filter".
 */
export function reportArgs(f: ReportFilters) {
  return {
    p_by: f.by,
    p_from: f.from ? istDayStartUTC(f.from) : null,
    p_to: f.to ? istDayEndUTC(f.to) : null,
    p_courier: f.courier ?? null,
    p_agent: f.agent ?? null,
    p_stages: f.stages.length ? f.stages : null,
    p_handover: f.handover ?? null,
    p_late: f.late,
    p_late_from: f.lateFrom,
    p_only_late: f.onlyLate,
    p_age_min: f.ageMin ?? null,
    p_age_max: f.ageMax ?? null,
    p_books: f.books ?? null,
    p_gift: f.gift ?? null,
    p_signed: f.signed ?? null,
    p_q: f.q ?? null,
    p_state: f.state ?? null,
  };
}

/**
 * The same arguments minus the three the summary must not apply.
 *
 * The stage chips, the ageing bucket and the late-only switch select FROM the
 * breakdown; applying them to the breakdown itself would make it a mirror.
 * Narrow to Delivered and every tile would read 100% delivered, which is true
 * and useless. Same rule as `delivery_stats_summary` in 0045.
 *
 * `p_late` survives, because the Late tile has to count with the threshold the
 * reader chose. Computing the flag is not filtering on it.
 */
export function summaryArgs(f: ReportFilters, bucket: "day" | "month") {
  return {
    p_by: f.by,
    p_from: f.from ? istDayStartUTC(f.from) : null,
    p_to: f.to ? istDayEndUTC(f.to) : null,
    p_courier: f.courier ?? null,
    p_agent: f.agent ?? null,
    p_handover: f.handover ?? null,
    p_late: f.late,
    p_late_from: f.lateFrom,
    p_books: f.books ?? null,
    p_gift: f.gift ?? null,
    p_signed: f.signed ?? null,
    p_q: f.q ?? null,
    p_state: f.state ?? null,
    p_bucket: bucket,
  };
}

/**
 * Days or months for the time chart.
 *
 * A fortnight of daily bars is readable and a year of monthly ones is too; a
 * year of days is 365 slivers nobody can point at. The cut is at 70 days,
 * comfortably past the 30-day preset.
 */
export function bucketFor(f: ReportFilters): "day" | "month" {
  if (!f.from || !f.to) return "month";
  const days =
    (Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 864e5;
  return days <= 70 ? "day" : "month";
}

/** Everything except the date axis and the late threshold, which always exist. */
export function hasNarrowing(f: ReportFilters): boolean {
  return !!(
    f.from ||
    f.to ||
    f.courier ||
    f.agent ||
    f.stages.length ||
    f.handover ||
    f.onlyLate ||
    f.ageMin !== undefined ||
    f.ageMax !== undefined ||
    f.books ||
    f.gift ||
    f.signed ||
    f.q ||
    f.state
  );
}

// ── Links ────────────────────────────────────────────────────────────────────

/**
 * The filters back as a query string.
 *
 * Round-tripping through this rather than passing the raw `searchParams` down
 * the tree is what lets every tile, table cell and chart bar build a link from
 * the `ReportFilters` object it already has. `parseReportFilters` is total —
 * it never rejects, only defaults — so parse(serialise(f)) is f, and a link
 * built here lands on exactly the view it came from plus the one thing it
 * changed.
 *
 * Defaults are omitted, so an unfiltered view has a clean URL and the "Clear"
 * button has something to compare against.
 */
export function toParams(f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.by !== "ordered") p.set("by", f.by);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.courier) p.set("courier", f.courier);
  if (f.agent) p.set("agent", f.agent);
  if (f.stages.length) p.set("stage", f.stages.join(","));
  if (f.handover) p.set("handover", f.handover);
  if (f.late !== DEFAULT_LATE_DAYS) p.set("late", String(f.late));
  if (f.lateFrom !== "ordered") p.set("late_from", f.lateFrom);
  if (f.onlyLate) p.set("only_late", "1");
  if (f.ageMin !== undefined) p.set("age_min", String(f.ageMin));
  if (f.ageMax !== undefined) p.set("age_max", String(f.ageMax));
  if (f.books) p.set("books", f.books);
  if (f.gift) p.set("gift", f.gift);
  if (f.signed) p.set("signed", f.signed);
  if (f.q) p.set("q", f.q);
  if (f.state) p.set("state", f.state);
  if (f.sort !== "newest") p.set("sort", f.sort);
  return p;
}

/**
 * A link to this view with a few things changed.
 *
 * `null` removes a parameter. `page` is always dropped, because every change
 * here invalidates which page you were on — landing on page 4 of a list that
 * now has two pages is the classic way a drill-down appears to be empty.
 */
export function reportHref(
  f: ReportFilters,
  changes: Record<string, string | null> = {}
): string {
  const p = toParams(f);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  p.delete("page");
  const qs = p.toString();
  return qs ? `/admin/analytics?${qs}` : "/admin/analytics";
}

// ── Date presets ─────────────────────────────────────────────────────────────

/**
 * The ranges worth one click.
 *
 * Both year presets are here because this shop keeps two years at once: the
 * calendar one everybody talks in, and the Indian financial year that April
 * starts and the accountant asks about. Each is only a from/to pair, so any
 * other range is still typed in by hand.
 */
export interface DatePreset {
  label: string;
  from: string;
  to: string;
}

/** The financial year containing `date`, which begins on 1 April. */
export function financialYearOf(date: string): { from: string; to: string; label: string } {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return {
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
    label: `FY ${String(start).slice(2)}–${String(start + 1).slice(2)}`,
  };
}

export function datePresets(today = istToday()): DatePreset[] {
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const fy = financialYearOf(today);

  return [
    { label: "Today", from: today, to: today },
    { label: "7 days", from: istDaysAgo(6), to: today },
    { label: "30 days", from: istDaysAgo(29), to: today },
    { label: "This month", from: `${month}-01`, to: today },
    { label: year, from: `${year}-01-01`, to: `${year}-12-31` },
    { label: fy.label, from: fy.from, to: fy.to },
  ];
}

// ── Saved views ──────────────────────────────────────────────────────────────

/**
 * The questions this screen was built to answer, each as a set of parameters.
 *
 * Not a feature so much as an admission: the filter bar can express hundreds
 * of views and about six of them are ever wanted. These are the six, spelled
 * out, so the common case is one click and the bar is there for the rest.
 */
export interface ReportPreset {
  key: string;
  label: string;
  hint: string;
  params: Record<string, string>;
}

export function reportPresets(today = istToday()): ReportPreset[] {
  const fy = financialYearOf(today);
  return [
    {
      key: "late",
      label: "Late over 10 days",
      hint: "Ordered more than 10 days ago and still not delivered.",
      params: { only_late: "1", late: "10", late_from: "ordered", by: "ordered" },
    },
    {
      key: "late5",
      label: "Late over 5 days",
      hint: "The earlier warning — still ours to fix before anyone complains.",
      params: { only_late: "1", late: "5", late_from: "ordered", by: "ordered" },
    },
    {
      key: "stuck",
      label: "Stuck with a courier",
      hint: "Handed over more than 10 days ago and still not delivered.",
      params: { only_late: "1", late: "10", late_from: "courier_assigned" },
    },
    {
      key: "unrouted",
      label: "Not routed yet",
      hint: "Paid, addressed, and nobody has chosen a courier.",
      params: { courier: "none", stage: "new" },
    },
    {
      key: "assigned-today",
      label: "Assigned today",
      hint: "Everything given to a courier today.",
      params: { by: "courier_assigned", from: today, to: today },
    },
    {
      key: "shipped-fy",
      label: `Shipped ${fy.label}`,
      hint: "Everything that went out this financial year.",
      params: { by: "shipped", from: fy.from, to: fy.to },
    },
  ];
}
