/**
 * Customer care calling — the vocabulary.
 *
 * Free of any Supabase import, because the portal's filter bar and call cards
 * are client components and need the same labels the API validates against.
 * Same split as lib/tasks.ts beside lib/db/tasks.ts.
 */

export const CALL_STATUSES = [
  "not_called",
  "attended",
  "not_attended",
  "switched_off",
  "wrong_number",
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];

/** What a logged call can end as — "not called" is only ever the start. */
export const CALL_OUTCOMES: CallStatus[] = [
  "attended",
  "not_attended",
  "switched_off",
  "wrong_number",
];

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  not_called: "Not called",
  attended: "Attended",
  not_attended: "Not attended",
  switched_off: "Switched off / busy",
  wrong_number: "Wrong number",
};

export const CALL_STATUS_BADGE: Record<CallStatus, string> = {
  not_called: "bg-neutral-100 text-neutral-700 border-neutral-200",
  attended: "bg-green-50 text-green-700 border-green-200",
  not_attended: "bg-amber-50 text-amber-800 border-amber-200",
  switched_off: "bg-orange-50 text-orange-700 border-orange-200",
  wrong_number: "bg-rose-50 text-rose-700 border-rose-200",
};

export const CALL_FLAGS = [
  "recall",
  "urgent",
  "not_received",
  "address_issue",
  "wants_cancel",
  "says_delivered",
  "escalate",
] as const;

export type CallFlag = (typeof CALL_FLAGS)[number];

export const CALL_FLAG_LABELS: Record<CallFlag, string> = {
  recall: "Call back",
  urgent: "Urgent",
  not_received: "Not received",
  address_issue: "Address issue",
  wants_cancel: "Wants cancel / refund",
  says_delivered: "Says delivered",
  escalate: "Escalate",
};

/** Active chip colours. Inactive chips are plain outlines. */
export const CALL_FLAG_BADGE: Record<CallFlag, string> = {
  recall: "bg-sky-50 text-sky-700 border-sky-300",
  urgent: "bg-red-600 text-white border-red-600",
  not_received: "bg-rose-50 text-rose-700 border-rose-300",
  address_issue: "bg-amber-50 text-amber-800 border-amber-300",
  wants_cancel: "bg-purple-50 text-purple-700 border-purple-300",
  says_delivered: "bg-green-50 text-green-700 border-green-300",
  escalate: "bg-neutral-900 text-white border-neutral-900",
};

export function isCallStatus(v: unknown): v is CallStatus {
  return typeof v === "string" && (CALL_STATUSES as readonly string[]).includes(v);
}

export function isCallFlag(v: unknown): v is CallFlag {
  return typeof v === "string" && (CALL_FLAGS as readonly string[]).includes(v);
}

/**
 * The courier's own last word, as the delivery portal's remark filter reads
 * it: courier_last_scan is "Status — Location — Instructions", and the last
 * segment is the part that says why.
 */
export function remarkOf(scan: string | null | undefined): string | null {
  if (!scan) return null;
  const parts = scan.split(" — ");
  return (parts.length > 1 ? parts[parts.length - 1] : scan).trim() || null;
}

/** One click should not hand somebody a week of dialling. */
export const CALL_ASSIGN_MAX = 2000;

// ── Filters ──────────────────────────────────────────────────────────────────

export type CallView = "open" | "done" | "all";
export type CallDelivery = "undelivered" | "delivered" | "returned";
export type CallSort = "due" | "newest" | "oldest" | "attempts";

export interface CallFilters {
  view: CallView;
  status?: CallStatus;
  flag?: CallFlag;
  /** Only calls whose call-back time has come. */
  due: boolean;
  /** A staff id, or "none". Ignored for a scoped (calls.view-only) login. */
  assignee?: string;
  /**
   * One "Assign calls" click. Every call it created shares the exact
   * assigned_at stamp, so that timestamp is the batch's id — no separate
   * table needed.
   */
  batch?: string;
  /** IST dates, YYYY-MM-DD, on the day the call was assigned. */
  from?: string;
  to?: string;
  q?: string;
  remark?: string;
  delivery?: CallDelivery;
  sort: CallSort;
}

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function parseCallFilters(p: Record<string, string | undefined>): CallFilters {
  const view = p.view;
  const delivery = p.delivery;
  const sort = p.sort;
  return {
    view: view === "done" || view === "all" ? view : "open",
    status: isCallStatus(p.status) ? p.status : undefined,
    flag: isCallFlag(p.flag) ? p.flag : undefined,
    due: p.due === "1",
    assignee: p.assignee || undefined,
    batch: p.batch && !Number.isNaN(Date.parse(p.batch)) ? p.batch : undefined,
    from: isDate(p.from) ? p.from : undefined,
    to: isDate(p.to) ? p.to : undefined,
    q: p.q || undefined,
    remark: p.remark || undefined,
    delivery:
      delivery === "undelivered" || delivery === "delivered" || delivery === "returned"
        ? delivery
        : undefined,
    sort: sort === "newest" || sort === "oldest" || sort === "attempts" ? sort : "due",
  };
}

/** A link to this view with some things changed; null removes a parameter. */
export function callsHref(f: CallFilters, changes: Record<string, string | null> = {}): string {
  const p = new URLSearchParams();
  if (f.view !== "open") p.set("view", f.view);
  if (f.status) p.set("status", f.status);
  if (f.flag) p.set("flag", f.flag);
  if (f.due) p.set("due", "1");
  if (f.assignee) p.set("assignee", f.assignee);
  if (f.batch) p.set("batch", f.batch);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.q) p.set("q", f.q);
  if (f.remark) p.set("remark", f.remark);
  if (f.delivery) p.set("delivery", f.delivery);
  if (f.sort !== "due") p.set("sort", f.sort);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  return qs ? `/admin/calls?${qs}` : "/admin/calls";
}

export function hasCallNarrowing(f: CallFilters): boolean {
  return !!(
    f.view !== "open" || f.status || f.flag || f.due || f.assignee || f.batch || f.from ||
    f.to || f.q || f.remark || f.delivery || f.sort !== "due"
  );
}
