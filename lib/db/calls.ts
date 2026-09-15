import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit, auditMany } from "@/lib/audit";
import { can, type PermissionHolder } from "@/lib/permissions";
import type { CurrentStaff } from "@/lib/admin-auth";
import { istDayStartUTC, istDayEndUTC } from "@/lib/format-date";
import {
  CALL_STATUSES,
  CALL_FLAGS,
  isCallFlag,
  isCallStatus,
  type CallFilters,
  type CallFlag,
  type CallStatus,
} from "@/lib/calls";

/**
 * Customer care calling lists (migration 0083).
 *
 * The order's own columns — name, phone, courier remark, where the parcel is —
 * are read live through the order_id join rather than copied, so the person
 * dialling always sees today's remark and a corrected number.
 */

export interface CallOrder {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  status: string;
  payment_status: string;
  delivery_mode: string | null;
  courier_id: string | null;
  assigned_agent_id: string | null;
  tracking_number: string | null;
  courier_last_scan: string | null;
  courier_last_scan_at: string | null;
  ordered_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  quantity: number;
}

export interface CallTask {
  id: string;
  order_id: string;
  order_number: string;
  assigned_to_id: string | null;
  assigned_to_email: string | null;
  assigned_by_email: string;
  assigned_at: string;
  batch_label: string | null;
  call_status: CallStatus;
  flags: CallFlag[];
  note: string | null;
  callback_at: string | null;
  attempts: number;
  last_called_at: string | null;
  last_called_by_email: string | null;
  done: boolean;
  done_at: string | null;
  done_by_email: string | null;
  created_at: string;
  updated_at: string;
  order: CallOrder | null;
}

export interface CallAttempt {
  id: string;
  outcome: CallStatus;
  note: string | null;
  callback_at: string | null;
  staff_email: string;
  created_at: string;
}

const ORDER_COLUMNS =
  "order_number, buyer_name, buyer_phone, city, district, state, pincode, status, " +
  "payment_status, delivery_mode, courier_id, assigned_agent_id, tracking_number, " +
  "courier_last_scan, courier_last_scan_at, ordered_at, shipped_at, delivered_at, quantity";

// `!inner` so filters on the order (search, remark, delivery stage) narrow the
// calls themselves rather than just blanking the embedded order.
const COLUMNS =
  "id, order_id, order_number, assigned_to_id, assigned_to_email, assigned_by_email, " +
  "assigned_at, batch_label, call_status, flags, note, callback_at, attempts, " +
  "last_called_at, last_called_by_email, done, done_at, done_by_email, created_at, updated_at, " +
  `orders!inner(${ORDER_COLUMNS})`;

const HEAD_COLUMNS = "id, orders!inner(order_number)";

function toCall(row: unknown): CallTask {
  const r = row as Record<string, unknown>;
  const { orders, ...rest } = r;
  return {
    ...(rest as unknown as CallTask),
    call_status: isCallStatus(r.call_status) ? r.call_status : "not_called",
    flags: Array.isArray(r.flags) ? r.flags.filter(isCallFlag) : [],
    order: (Array.isArray(orders) ? orders[0] : orders) as CallOrder | null,
  };
}

// ── Who sees what ────────────────────────────────────────────────────────────

/**
 * Same shape as lib/tasks-scope.ts. `calls.manage` assigns lists and sees
 * everyone's; `calls.view` alone works the calls assigned to that login.
 */
export interface CallScope {
  seesEveryone: boolean;
  staffId: string | null;
}

export function callScope(staff: PermissionHolder & { id: string | null }): CallScope {
  if (can(staff, "calls.manage")) return { seesEveryone: true, staffId: null };
  return { seesEveryone: false, staffId: staff.id };
}

export function mayTouchCall(scope: CallScope, call: Pick<CallTask, "assigned_to_id">): boolean {
  if (scope.seesEveryone) return true;
  return !!scope.staffId && call.assigned_to_id === scope.staffId;
}

/** Matches nothing — a scoped login with no staff row sees no calls. */
const NO_ID = "00000000-0000-0000-0000-000000000000";

// ── Reading ──────────────────────────────────────────────────────────────────

function scoped(
  select: string,
  head: boolean,
  f: CallFilters,
  scope: CallScope,
  skip: { status?: boolean; flag?: boolean; due?: boolean } = {}
) {
  let q = supabaseAdmin.from("call_tasks").select(select, { count: "exact", head });

  if (!scope.seesEveryone) q = q.eq("assigned_to_id", scope.staffId ?? NO_ID);
  else if (f.assignee === "none") q = q.is("assigned_to_id", null);
  else if (f.assignee) q = q.eq("assigned_to_id", f.assignee);

  if (f.view === "open") q = q.eq("done", false);
  else if (f.view === "done") q = q.eq("done", true);

  if (!skip.status && f.status) q = q.eq("call_status", f.status);
  if (!skip.flag && f.flag) q = q.contains("flags", [f.flag]);
  if (!skip.due && f.due) {
    q = q.not("callback_at", "is", null).lte("callback_at", new Date().toISOString());
  }

  if (f.from) q = q.gte("assigned_at", istDayStartUTC(f.from));
  if (f.to) q = q.lte("assigned_at", istDayEndUTC(f.to));

  if (f.q) {
    const t = f.q.replace(/[%,()]/g, "").trim();
    if (t) {
      q = q.or(
        `buyer_name.ilike.%${t}%,buyer_phone.ilike.%${t}%,order_number.ilike.%${t}%`,
        { referencedTable: "orders" }
      );
    }
  }

  // The delivery portal's own cleaning, so a remark means the same parcels here.
  if (f.remark) {
    const t = f.remark.replace(/[%_,()]/g, " ").trim();
    if (t) q = q.ilike("orders.courier_last_scan", `%${t}%`);
  }

  if (f.delivery === "undelivered") {
    q = q.not("orders.status", "in", "(delivered,returned,cancelled)");
  } else if (f.delivery) {
    q = q.eq("orders.status", f.delivery);
  }

  return q;
}

export async function listCalls(
  f: CallFilters,
  scope: CallScope,
  page = 0,
  perPage = 30
): Promise<{ rows: CallTask[]; count: number }> {
  let q = scoped(COLUMNS, false, f, scope);

  if (f.sort === "newest") q = q.order("assigned_at", { ascending: false });
  else if (f.sort === "oldest") q = q.order("assigned_at", { ascending: true });
  else if (f.sort === "attempts") {
    q = q.order("attempts", { ascending: true }).order("assigned_at", { ascending: false });
  } else {
    // Call-backs that are due first, then the rest newest-assigned.
    q = q
      .order("callback_at", { ascending: true, nullsFirst: false })
      .order("assigned_at", { ascending: false });
  }

  const from = page * perPage;
  const { data, error, count } = await q
    .order("id", { ascending: true })
    .range(from, from + perPage - 1);

  if (error) {
    console.error("[Calls] list failed:", error.message);
    return { rows: [], count: 0 };
  }
  return { rows: (data ?? []).map(toCall), count: count ?? 0 };
}

export interface CallCounts {
  total: number;
  byStatus: Record<CallStatus, number>;
  byFlag: Record<CallFlag, number>;
  due: number;
}

/**
 * Counts for the chip rows. Each group ignores its own filter — the status
 * chips count across every status, or they'd read 100% of whichever was picked.
 */
export async function callCounts(f: CallFilters, scope: CallScope): Promise<CallCounts> {
  const n = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count, error } = await q;
    if (error) {
      console.error("[Calls] count failed:", error.message);
      return 0;
    }
    return count ?? 0;
  };

  const base = { status: true } as const;
  const [total, statuses, flags, due] = await Promise.all([
    n(scoped(HEAD_COLUMNS, true, f, scope, base)),
    Promise.all(
      CALL_STATUSES.map((s) =>
        n(scoped(HEAD_COLUMNS, true, f, scope, base).eq("call_status", s))
      )
    ),
    Promise.all(
      CALL_FLAGS.map((fl) =>
        n(scoped(HEAD_COLUMNS, true, f, scope, { flag: true }).contains("flags", [fl]))
      )
    ),
    n(
      scoped(HEAD_COLUMNS, true, f, scope, { due: true })
        .not("callback_at", "is", null)
        .lte("callback_at", new Date().toISOString())
    ),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(CALL_STATUSES.map((s, i) => [s, statuses[i]])) as Record<CallStatus, number>,
    byFlag: Object.fromEntries(CALL_FLAGS.map((fl, i) => [fl, flags[i]])) as Record<CallFlag, number>,
    due,
  };
}

export async function getCall(id: string): Promise<CallTask | null> {
  const { data, error } = await supabaseAdmin
    .from("call_tasks")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[Calls] get failed:", error.message);
    return null;
  }
  return data ? toCall(data) : null;
}

export async function listAttempts(callId: string): Promise<CallAttempt[]> {
  const { data, error } = await supabaseAdmin
    .from("call_attempts")
    .select("id, outcome, note, callback_at, staff_email, created_at")
    .eq("call_task_id", callId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    console.error("[Calls] attempts failed:", error.message);
    return [];
  }
  return (data ?? []) as CallAttempt[];
}

// ── Assigning ────────────────────────────────────────────────────────────────

export interface AssignResult {
  created: number;
  reassigned: number;
  /** Already open on somebody's list and left there. */
  skipped: number;
  /** Order numbers that no longer resolve to an order. */
  missing: number;
  error?: string;
}

const CHUNK = 300;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Put a filtered report on somebody's calling list.
 *
 * An order already open on a list is left alone unless `reassign` is set — so
 * assigning the same filter twice never rings a customer twice, and moving a
 * list from one person to another is a deliberate choice rather than a
 * side effect.
 */
export async function assignCalls(
  orderNumbers: string[],
  assignee: { id: string; email: string },
  actor: CurrentStaff,
  opts: { reassign: boolean; label: string | null }
): Promise<AssignResult> {
  const result: AssignResult = { created: 0, reassigned: 0, skipped: 0, missing: 0 };
  const unique = [...new Set(orderNumbers)];

  const orders: { id: string; order_number: string }[] = [];
  for (const part of chunks(unique)) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number")
      .in("order_number", part);
    if (error) return { ...result, error: error.message };
    orders.push(...((data ?? []) as { id: string; order_number: string }[]));
  }
  result.missing = unique.length - orders.length;

  const open: { id: string; order_id: string; assigned_to_id: string | null }[] = [];
  for (const part of chunks(orders.map((o) => o.id))) {
    const { data, error } = await supabaseAdmin
      .from("call_tasks")
      .select("id, order_id, assigned_to_id")
      .eq("done", false)
      .in("order_id", part);
    if (error) return { ...result, error: error.message };
    open.push(...((data ?? []) as typeof open));
  }

  const openOrders = new Set(open.map((o) => o.order_id));
  const toCreate = orders.filter((o) => !openOrders.has(o.id));
  const toMove = opts.reassign ? open.filter((o) => o.assigned_to_id !== assignee.id) : [];
  result.skipped = open.length - toMove.length;

  const now = new Date().toISOString();
  const touched: string[] = [];

  for (const part of chunks(toCreate)) {
    const { data, error } = await supabaseAdmin
      .from("call_tasks")
      .insert(
        part.map((o) => ({
          order_id: o.id,
          order_number: o.order_number,
          assigned_to_id: assignee.id,
          assigned_to_email: assignee.email,
          assigned_by_email: actor.email,
          assigned_at: now,
          batch_label: opts.label,
        }))
      )
      .select("id");
    if (error) {
      console.error("[Calls] assign insert failed:", error.message);
      return { ...result, error: error.message };
    }
    const ids = ((data ?? []) as { id: string }[]).map((d) => d.id);
    touched.push(...ids);
    result.created += ids.length;
  }

  for (const part of chunks(toMove.map((o) => o.id))) {
    const { error } = await supabaseAdmin
      .from("call_tasks")
      .update({
        assigned_to_id: assignee.id,
        assigned_to_email: assignee.email,
        assigned_at: now,
        updated_at: now,
        ...(opts.label ? { batch_label: opts.label } : {}),
      })
      .in("id", part);
    if (error) {
      console.error("[Calls] reassign failed:", error.message);
      return { ...result, error: error.message };
    }
    touched.push(...part);
    result.reassigned += part.length;
  }

  await auditMany(actor, "call.assigned", "call", touched, {
    to: assignee.email,
    label: opts.label,
  });

  return result;
}

// ── Working a call ───────────────────────────────────────────────────────────

/**
 * Record one call. Appends to the attempt history and moves the call's
 * current state along with it. A call-back time turns the "Call back" flag on;
 * a call that was answered with no call-back asked for turns it off.
 */
export async function logCall(
  call: CallTask,
  input: { outcome: CallStatus; note: string | null; callbackAt: string | null },
  actor: CurrentStaff
): Promise<{ call?: CallTask; error?: string }> {
  const now = new Date().toISOString();

  const { error: attemptError } = await supabaseAdmin.from("call_attempts").insert({
    call_task_id: call.id,
    outcome: input.outcome,
    note: input.note,
    callback_at: input.callbackAt,
    staff_id: actor.id,
    staff_email: actor.email,
  });
  if (attemptError) {
    console.error("[Calls] attempt insert failed:", attemptError.message);
    return { error: "Could not save the call." };
  }

  let flags = [...call.flags];
  if (input.callbackAt) {
    if (!flags.includes("recall")) flags.push("recall");
  } else if (input.outcome === "attended") {
    flags = flags.filter((f) => f !== "recall");
  }

  const { error } = await supabaseAdmin
    .from("call_tasks")
    .update({
      call_status: input.outcome,
      attempts: call.attempts + 1,
      last_called_at: now,
      last_called_by_email: actor.email,
      callback_at: input.callbackAt,
      flags,
      updated_at: now,
      ...(input.note ? { note: input.note } : {}),
    })
    .eq("id", call.id);
  if (error) {
    console.error("[Calls] log update failed:", error.message);
    return { error: "Could not save the call." };
  }

  await audit({
    actor,
    action: "call.logged",
    entity: "call",
    entityId: call.id,
    meta: { outcome: input.outcome, note: input.note, callback_at: input.callbackAt },
  });

  return { call: (await getCall(call.id)) ?? undefined };
}

export interface CallPatch {
  flags?: CallFlag[];
  note?: string | null;
  callbackAt?: string | null;
  done?: boolean;
  assignee?: { id: string; email: string } | null;
}

export async function updateCall(
  call: CallTask,
  patch: CallPatch,
  actor: CurrentStaff
): Promise<{ call?: CallTask; error?: string }> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { updated_at: now };
  const meta: Record<string, unknown> = {};

  if (patch.flags !== undefined) {
    row.flags = [...new Set(patch.flags)];
    meta.flags = row.flags;
  }
  if (patch.note !== undefined) {
    row.note = patch.note?.trim() || null;
    meta.note = row.note;
  }
  if (patch.callbackAt !== undefined) {
    row.callback_at = patch.callbackAt;
    meta.callback_at = patch.callbackAt;
  }
  if (patch.done !== undefined) {
    row.done = patch.done;
    row.done_at = patch.done ? now : null;
    row.done_by_email = patch.done ? actor.email : null;
    meta.done = patch.done;
  }
  if (patch.assignee !== undefined) {
    row.assigned_to_id = patch.assignee?.id ?? null;
    row.assigned_to_email = patch.assignee?.email ?? null;
    row.assigned_at = now;
    meta.to = patch.assignee?.email ?? null;
  }

  const { error } = await supabaseAdmin.from("call_tasks").update(row).eq("id", call.id);
  if (error) {
    // The one-open-call-per-order index, hit by reopening an old call.
    if (error.code === "23505") {
      return { error: "This order already has an open call on someone's list — close that one first." };
    }
    console.error("[Calls] update failed:", error.message);
    return { error: "Could not update the call." };
  }

  const action =
    patch.assignee !== undefined
      ? "call.reassigned"
      : patch.done === true
        ? "call.done"
        : patch.done === false
          ? "call.reopened"
          : "call.updated";
  await audit({ actor, action, entity: "call", entityId: call.id, meta });

  return { call: (await getCall(call.id)) ?? undefined };
}
