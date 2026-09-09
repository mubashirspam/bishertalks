import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit, type AuditEntry } from "@/lib/audit";
import type { CurrentStaff } from "@/lib/admin-auth";
import {
  taskCategory,
  taskPriority,
  taskStatus,
  TASK_STATUSES,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  order_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_by_id: string | null;
  created_by_email: string;
  assigned_to_id: string | null;
  assigned_to_email: string | null;
  solved_at: string | null;
  solved_by_email: string | null;
  /** What actually fixed it, written on solving (0072). Null until then. */
  resolution_note: string | null;
  /** The waybill/article number that explains it, where there is one (0072). */
  resolution_tracking_id: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, title, description, category, priority, status, order_id, order_number, " +
  "customer_name, customer_phone, created_by_id, created_by_email, " +
  "assigned_to_id, assigned_to_email, solved_at, solved_by_email, " +
  "resolution_note, resolution_tracking_id, created_at, updated_at";

/**
 * Coerce a raw row into a Task, both for the enum columns and for the row's
 * type itself — the `tasks` table is new enough that the generated Supabase
 * types don't know its shape yet, same reason lib/crm/campaigns.ts and
 * lib/crm/automation.ts cast through `unknown` rather than typing the client.
 */
function toTask(row: unknown): Task {
  const r = row as Record<string, unknown>;
  return {
    ...(r as unknown as Task),
    category: taskCategory(r.category),
    priority: taskPriority(r.priority),
    status: taskStatus(r.status),
  };
}

export interface TaskFilters {
  /** A TaskStatus, or "all". */
  status?: string;
  /** "urgent" to show only unsolved urgent tasks, or "all". */
  priority?: string;
  category?: string;
  /** A staff id, "none" for unassigned, or "" for everyone. */
  assignedTo?: string;
  q?: string;
}

export async function listTasks(
  filters: TaskFilters,
  page = 0,
  perPage = 20
): Promise<{ rows: Task[]; count: number }> {
  const from = page * perPage;
  let query = supabaseAdmin
    .from("tasks")
    .select(COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.priority === "urgent") query = query.eq("priority", "urgent").neq("status", "solved");
  if (filters.category && filters.category !== "all") query = query.eq("category", filters.category);
  if (filters.assignedTo === "none") query = query.is("assigned_to_id", null);
  else if (filters.assignedTo) query = query.eq("assigned_to_id", filters.assignedTo);

  if (filters.q) {
    const term = filters.q.replace(/[%,()]/g, "");
    if (term) {
      query = query.or(
        `title.ilike.%${term}%,description.ilike.%${term}%,customer_name.ilike.%${term}%,` +
          `customer_phone.ilike.%${term}%,order_number.ilike.%${term}%`
      );
    }
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[Tasks] list failed:", error.message);
    return { rows: [], count: 0 };
  }
  return { rows: (data ?? []).map(toTask), count: count ?? 0 };
}

export interface TaskCounts {
  open: number;
  in_progress: number;
  waiting: number;
  solved: number;
  /** Unsolved and urgent — the number worth interrupting anyone for. */
  urgent: number;
}

/**
 * Counts for the tab row and the nav badge. Zeroes on failure — a badge is
 * navigation, and a screen that refuses to render over a failed count is
 * worse than one showing zero.
 *
 * `assignedTo` narrows every count to one staff id (or "none" for
 * unassigned) — a scoped, tasks.view-only login gets counts of their own
 * tasks, not the whole board's. Undefined counts everyone's, as before.
 */
export async function taskCounts(assignedTo?: string): Promise<TaskCounts> {
  const counts: TaskCounts = { open: 0, in_progress: 0, waiting: 0, solved: 0, urgent: 0 };

  for (const status of TASK_STATUSES) {
    let query = supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (assignedTo === "none") query = query.is("assigned_to_id", null);
    else if (assignedTo) query = query.eq("assigned_to_id", assignedTo);

    const { count, error } = await query;
    if (error) {
      console.error("[Tasks] count failed:", status, error.message);
      continue;
    }
    counts[status] = count ?? 0;
  }

  let urgentQuery = supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("priority", "urgent")
    .neq("status", "solved");
  if (assignedTo === "none") urgentQuery = urgentQuery.is("assigned_to_id", null);
  else if (assignedTo) urgentQuery = urgentQuery.eq("assigned_to_id", assignedTo);

  const { count: urgent } = await urgentQuery;
  counts.urgent = urgent ?? 0;

  return counts;
}

/**
 * Just the number for the nav badge — one count query, not the whole tab row.
 *
 * `assignedTo` scopes it the same way `taskCounts` does, for a tasks.view-only
 * login: the sidebar badge should say how many of THEIR tasks are urgent, not
 * how many exist across a board they cannot even open to see.
 */
export async function urgentTaskCount(assignedTo?: string): Promise<number> {
  let query = supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("priority", "urgent")
    .neq("status", "solved");

  if (assignedTo === "none") query = query.is("assigned_to_id", null);
  else if (assignedTo) query = query.eq("assigned_to_id", assignedTo);

  const { count, error } = await query;
  if (error) {
    console.error("[Tasks] urgent count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function getTask(id: string): Promise<Task | null> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return toTask(data);
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  orderId?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  assignedToId?: string | null;
  assignedToEmail?: string | null;
}

export async function createTask(
  input: CreateTaskInput,
  staff: CurrentStaff
): Promise<Task | null> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .insert({
      title: input.title,
      description: input.description || null,
      category: input.category,
      priority: input.priority,
      order_id: input.orderId || null,
      order_number: input.orderNumber || null,
      customer_name: input.customerName || null,
      customer_phone: input.customerPhone || null,
      created_by_id: staff.id,
      created_by_email: staff.email,
      assigned_to_id: input.assignedToId || null,
      assigned_to_email: input.assignedToEmail || null,
    })
    .select(COLUMNS)
    .maybeSingle();

  if (error || !data) {
    console.error("[Tasks] create failed:", error?.message);
    return null;
  }

  const task = toTask(data);

  const entries: AuditEntry[] = [
    { actor: staff, action: "task.created", entity: "task", entityId: task.id, meta: { title: task.title } },
  ];
  if (task.assigned_to_id) {
    entries.push({
      actor: staff,
      action: "task.assigned",
      entity: "task",
      entityId: task.id,
      meta: { to: task.assigned_to_email },
    });
  }
  await Promise.all(entries.map((e) => audit(e)));

  return task;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  category?: TaskCategory;
  priority?: TaskPriority;
  status?: TaskStatus;
  /** Explicit null unassigns — undefined leaves it untouched. */
  assignedToId?: string | null;
  assignedToEmail?: string | null;
  /** What fixed it — asked for alongside status: "solved" (0072). */
  resolutionNote?: string | null;
  /** The waybill/article number, where the fix was that specific. */
  resolutionTrackingId?: string | null;
  /**
   * A short note on WHY the status is changing, for any status — not just
   * solved (0073). Not stored as its own column: it belongs to the moment of
   * the change, not to the task, so it rides on that change's own
   * `task.status_changed` audit row instead of overwriting the way a single
   * "current note" field would. See describeAudit() in lib/audit.ts.
   */
  statusNote?: string | null;
}

/**
 * Change a task. Writes one audit row per thing that actually changed, so
 * "who assigned this, and when did it get solved" reads straight off the
 * history rather than off a single "task.updated" that says nothing.
 */
export async function updateTask(
  id: string,
  patch: UpdateTaskInput,
  staff: CurrentStaff
): Promise<Task | null> {
  const before = await getTask(id);
  if (!before) return null;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description || null;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.assignedToId !== undefined) {
    row.assigned_to_id = patch.assignedToId;
    row.assigned_to_email = patch.assignedToEmail ?? null;
  }
  if (patch.status !== undefined) {
    row.status = patch.status;
    // Stamped here rather than left to a trigger — this is the one column
    // that means something different depending on direction, so the code
    // that decides the direction is the code that should set it.
    if (patch.status === "solved" && before.status !== "solved") {
      row.solved_at = new Date().toISOString();
      row.solved_by_email = staff.email;
    } else if (patch.status !== "solved" && before.status === "solved") {
      row.solved_at = null;
      row.solved_by_email = null;
      // Reopening is a fresh attempt — the old resolution no longer explains
      // a task that is, by definition, not solved. Whoever solves it again
      // writes a new one rather than leaving a stale answer standing.
      row.resolution_note = null;
      row.resolution_tracking_id = null;
    }
  }
  // Independent of the status branch above: a resolution can be corrected
  // after the fact (a better tracking id turns up) without re-triggering the
  // solved_at stamp, and it can also arrive in the same request as the
  // status flip to "solved" — the common case, one Confirm click.
  if (patch.resolutionNote !== undefined) row.resolution_note = patch.resolutionNote || null;
  if (patch.resolutionTrackingId !== undefined) {
    row.resolution_tracking_id = patch.resolutionTrackingId || null;
  }

  const { data, error } = await supabaseAdmin
    .from("tasks")
    .update(row)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error || !data) {
    console.error("[Tasks] update failed:", id, error?.message);
    return null;
  }

  const task = toTask(data);

  if (patch.assignedToId !== undefined && patch.assignedToId !== before.assigned_to_id) {
    await audit({
      actor: staff,
      action: "task.assigned",
      entity: "task",
      entityId: id,
      meta: { to: task.assigned_to_email ?? "nobody" },
    });
  }
  if (patch.status !== undefined && patch.status !== before.status) {
    await audit({
      actor: staff,
      action: "task.status_changed",
      entity: "task",
      entityId: id,
      meta: {
        status: patch.status,
        ...(patch.statusNote?.trim() ? { note: patch.statusNote.trim() } : {}),
      },
    });
  }
  // Its own row, separate from the status change, so a later correction to
  // just the note or the tracking id (see the comment above) still leaves a
  // trace — "task.status_changed" alone would say a solve happened with no
  // record of what was actually written down.
  if (
    (patch.resolutionNote !== undefined && patch.resolutionNote !== before.resolution_note) ||
    (patch.resolutionTrackingId !== undefined &&
      patch.resolutionTrackingId !== before.resolution_tracking_id)
  ) {
    await audit({
      actor: staff,
      action: "task.resolved",
      entity: "task",
      entityId: id,
      meta: {
        note: task.resolution_note,
        tracking_id: task.resolution_tracking_id,
      },
    });
  }

  return task;
}

export interface OrderMatch {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
}

/**
 * A short list of orders matching a search, for the task form's attach-order
 * picker. A narrower, faster sibling of buildOrdersQuery (lib/db/orders-query.ts) —
 * that one drives the full order book with every filter it carries; this
 * exists only to answer "which order did they mean" in a dropdown.
 */
export async function searchOrdersForTask(q: string, limit = 8): Promise<OrderMatch[]> {
  const term = q.trim().replace(/[%,()]/g, "");
  if (term.length < 2) return [];

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, buyer_name, buyer_phone")
    .or(`order_number.ilike.%${term}%,buyer_name.ilike.%${term}%,buyer_phone.ilike.%${term}%`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[Tasks] order search failed:", error.message);
    return [];
  }
  return (data ?? []) as OrderMatch[];
}
