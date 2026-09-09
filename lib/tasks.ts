/**
 * What a task is, in the same five-part shape every status/priority module in
 * this codebase already uses (see lib/delivery-priority.ts, lib/order-stage.ts):
 * a type, its values, labels, badge colours, and a guard/coerce pair that
 * defaults rather than throws — a row written before a value existed, or by a
 * path that skipped it, should still render plainly.
 */

// ── Status ───────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "in_progress" | "waiting" | "solved";

export const TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "waiting", "solved"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  // Genuinely stuck on somebody else — the courier, the customer, another
  // team — not idle and not being worked right now. Distinct from
  // "in progress" on purpose (0072): the two answer different questions,
  // "is someone doing this" and "is anyone able to right now".
  waiting: "Waiting on someone",
  solved: "Solved",
};

export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  waiting: "bg-purple-50 text-purple-700 border-purple-200",
  solved: "bg-green-50 text-green-700 border-green-200",
};

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as string[]).includes(v);
}

export function taskStatus(v: unknown): TaskStatus {
  return isTaskStatus(v) ? v : "open";
}

// ── Priority ─────────────────────────────────────────────────────────────
//
// Two values and no more, for the same reason delivery parcels stopped at
// two: a scale invites "medium", which is what everything gets when someone
// is entering ten tasks and doesn't want to think, and a flag that's true of
// most rows tells the board nothing. Urgent has to be scarce to mean anything.

export type TaskPriority = "normal" | "urgent";

export const TASK_PRIORITIES: TaskPriority[] = ["normal", "urgent"];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  normal: "Normal",
  urgent: "Urgent",
};

/** Red, and only for urgent — normal gets no badge at all. See PRIORITY_BADGE
 * in lib/delivery-priority.ts for why: a badge on every row is noise that
 * makes the few urgent ones harder to see, not easier. */
export const TASK_PRIORITY_BADGE: Record<TaskPriority, string> = {
  normal: "",
  urgent: "bg-red-100 text-red-800 border-red-200",
};

export function isTaskPriority(v: unknown): v is TaskPriority {
  return typeof v === "string" && (TASK_PRIORITIES as string[]).includes(v);
}

export function taskPriority(v: unknown): TaskPriority {
  return isTaskPriority(v) ? v : "normal";
}

// ── Category ─────────────────────────────────────────────────────────────
//
// A fixed, short list rather than free text — a filter can't select on a
// sentence, and a category every task-writer spells differently is no
// category at all. Kept as a plain constant rather than admin-editable in v1;
// it's one array to extend if a new kind of task shows up often enough to
// deserve its own bucket.

export type TaskCategory =
  | "delivery_issue"
  | "marked_delivered_not_received"
  | "tracking_request"
  | "payment_issue"
  | "address_correction"
  | "order_issue"
  | "customer_query"
  | "internal"
  | "other";

export const TASK_CATEGORIES: TaskCategory[] = [
  "delivery_issue",
  "marked_delivered_not_received",
  "tracking_request",
  "payment_issue",
  "address_correction",
  "order_issue",
  "customer_query",
  "internal",
  "other",
];

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  delivery_issue: "Delivery issue",
  marked_delivered_not_received: "Marked delivered, not received",
  tracking_request: "Tracking request",
  payment_issue: "Payment issue",
  address_correction: "Address correction",
  order_issue: "Wrong / damaged item",
  customer_query: "Customer query",
  internal: "Internal",
  other: "Other",
};

export function isTaskCategory(v: unknown): v is TaskCategory {
  return typeof v === "string" && (TASK_CATEGORIES as string[]).includes(v);
}

export function taskCategory(v: unknown): TaskCategory {
  return isTaskCategory(v) ? v : "other";
}

/**
 * Which categories the resolution form leads with a tracking ID box for
 * (0072) — the common case where "what fixed this" is a waybill or article
 * number. Not a restriction: the field is on the form for every category,
 * this only decides whether it's offered first or tucked under "more".
 */
export const TASK_TRACKING_CATEGORIES: TaskCategory[] = [
  "delivery_issue",
  "marked_delivered_not_received",
  "tracking_request",
];

/** The filter bar's status tabs, "All" plus every real status. */
export const TASK_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] })),
];
