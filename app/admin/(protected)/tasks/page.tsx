import { Suspense } from "react";
import { ListChecks } from "lucide-react";
import Link from "@/components/admin/AdminLink";
import { requirePageAccessAny } from "@/lib/admin-auth";
import { taskScope } from "@/lib/tasks-scope";
import { SkeletonHeader, SkeletonTabs, SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import { listTasks, taskCounts } from "@/lib/db/tasks";
import { listStaff } from "@/lib/db/staff";
import TasksFilters from "./TasksFilters";
import TaskTable from "./TaskTable";
import NewTaskForm from "./NewTaskForm";

export const dynamic = "force-dynamic";

const PER_PAGE = 20;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    category?: string;
    assignee?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const staff = await requirePageAccessAny(["tasks.view", "tasks.manage"]);
  const scope = taskScope(staff);
  const params = await searchParams;
  const pageNum = Math.max(0, parseInt(params.page ?? "1") - 1);

  return (
    <NavigationPending>
      <div className="mb-5">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-primary-500" /> Tasks
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Anything staff need to do — assign it, flag it urgent, mark it solved.
        </p>
      </div>

      <Suspense
        fallback={
          <>
            <SkeletonHeader />
            <SkeletonTabs count={5} />
            <SkeletonTable rows={PER_PAGE} columns={5} />
          </>
        }
      >
        <Body
          status={params.status}
          priority={params.priority}
          category={params.category}
          assignee={params.assignee}
          q={params.q}
          page={pageNum}
          canManage={scope.seesEveryone}
          ownStaffId={scope.staffId}
        />
      </Suspense>
    </NavigationPending>
  );
}

async function Body({
  status,
  priority,
  category,
  assignee,
  q,
  page,
  canManage,
  ownStaffId,
}: {
  status?: string;
  priority?: string;
  category?: string;
  assignee?: string;
  q?: string;
  page: number;
  /** Full access — create, assign to anyone, see every task (tasks.manage). */
  canManage: boolean;
  /** Their own id, when scoped — see lib/tasks-scope.ts. */
  ownStaffId: string | null;
}) {
  // A scoped login's own tasks, whatever the URL says — the assignee filter
  // is a URL param and proves nothing about who is asking. An unscoped one
  // reads it as the filter it has always been.
  const assignedTo = canManage ? assignee : (ownStaffId ?? "none");

  const [staff, counts, { rows, count }] = await Promise.all([
    listStaff(),
    taskCounts(canManage ? undefined : assignedTo),
    listTasks({ status, priority, category, assignedTo, q }, page, PER_PAGE),
  ]);

  const totalPages = Math.ceil(count / PER_PAGE);
  const link = (p: number) => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (priority) sp.set("priority", priority);
    if (category) sp.set("category", category);
    if (assignee) sp.set("assignee", assignee);
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/tasks${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      {canManage && <NewTaskForm staff={staff} />}
      <TasksFilters counts={counts} staff={staff} canManage={canManage} />

      <StaleWhileRevalidating>
        <TaskTable tasks={rows} staff={staff} canManage={canManage} />
      </StaleWhileRevalidating>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-neutral-500">
            {count.toLocaleString("en-IN")} task{count === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            {page > 0 && (
              <Link
                href={link(page)}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm text-neutral-700 hover:border-neutral-300"
              >
                ← Prev
              </Link>
            )}
            {page + 1 < totalPages && (
              <Link
                href={link(page + 2)}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm text-neutral-700 hover:border-neutral-300"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
