import { can, type PermissionHolder } from "@/lib/permissions";

/**
 * Who may see and touch which tasks.
 *
 * Same shape as `lib/delivery/scope.ts`'s `portalScope`/`mayHandle` — one
 * shared pair of functions used by both the page (what to query, what to
 * show) and every mutating API route (what to allow), because the expensive
 * failure is those two disagreeing: a screen that shows a task and a route
 * that then refuses to let it be touched.
 *
 * `tasks.manage` runs the whole board — create, assign to anyone, see every
 * task. `tasks.view` alone is the narrow half: your own assigned tasks, and
 * only their status. Someone with neither never reaches the page at all —
 * see requirePageAccessAny(["tasks.view", "tasks.manage"]) on the page.
 */

export type TaskScope = {
  /** Runs the whole board: every task, create, and reassignment. */
  seesEveryone: boolean;
  /**
   * Their own staff id, when scoped. Read this ONLY together with
   * `seesEveryone` — null means two different things depending on it:
   * irrelevant for someone who sees everyone, and "no identity to scope to
   * at all" (the ADMIN_EMAIL owner fallback, which never reaches this
   * branch) for someone who is.
   */
  staffId: string | null;
};

export function taskScope(staff: PermissionHolder & { id: string | null }): TaskScope {
  if (can(staff, "tasks.manage")) return { seesEveryone: true, staffId: null };
  return { seesEveryone: false, staffId: staff.id };
}

/** May this user change something on a task assigned to `assignedToId`? */
export function mayTouchTask(scope: TaskScope, assignedToId: string | null): boolean {
  if (scope.seesEveryone) return true;
  return !!scope.staffId && assignedToId === scope.staffId;
}
