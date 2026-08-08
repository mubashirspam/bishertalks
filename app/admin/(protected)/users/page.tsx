import { Suspense } from "react";
import { SkeletonFilters, SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { User } from "@/lib/types/db";
import { getCourseList } from "@/lib/db/courses";
import AddUserForm from "./AddUserForm";
import ImportUsersForm from "./ImportUsersForm";
import { requirePageAccess } from "@/lib/admin-auth";

const PER_PAGE = 20;

export default async function Page(props: Parameters<typeof UsersBody>[0]) {
  // Guard runs in the shell so an unauthorised visitor is redirected before
  // any of the work below is started. The staff lookup is memoised per
  // request, so the body re-reading it costs nothing.
  await requirePageAccess("users.view");

  return (
    <Suspense fallback={<><SkeletonHeader /><SkeletonFilters /><SkeletonTable rows={10} columns={5} /></>}>
      <UsersBody {...props} />
    </Suspense>
  );
}

async function UsersBody({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requirePageAccess("users.view");

  const { q, page = "1" } = await searchParams;
  const pageNum = Math.max(0, parseInt(page) - 1);

  let query = supabaseAdmin
    .from("users")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(pageNum * PER_PAGE, (pageNum + 1) * PER_PAGE - 1);

  if (q) {
    query = query.or(`phone.ilike.%${q}%,name.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data: users, count } = await query;
  const totalPages = Math.ceil((count || 0) / PER_PAGE);

  const courses = await getCourseList();
  const courseOptions = courses.map((c) => ({ slug: c.slug, title: c.title }));

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-neutral-900">Users</h1>
          <p className="text-neutral-500 text-sm mt-1">{count ?? 0} total users</p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2 flex-1 min-w-[260px]">
          <ImportUsersForm courses={courseOptions} />
          <AddUserForm />
        </div>
      </div>

      {/* Search */}
      <form className="mb-5 max-w-xs">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name, phone, email…"
          className="w-full bg-white border border-neutral-300 rounded-xl px-4 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors"
        />
      </form>

      {!users?.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
          No users found
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Phone</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden md:table-cell">Email</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden lg:table-cell">Joined</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(users as User[]).map((u) => (
                  <tr key={u.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-primary-600 text-xs">
                      <Link href={`/admin/users/${u.id}`} className="hover:text-primary-700">
                        +91 {u.phone}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-900 font-medium">{u.name || "—"}</td>
                    <td className="px-4 py-3 text-neutral-500 hidden md:table-cell">{u.email || "—"}</td>
                    <td className="px-4 py-3 text-neutral-500 text-xs hidden lg:table-cell">
                      {new Date(u.created_at).toLocaleDateString("en-IN", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-xs text-neutral-500 hover:text-neutral-900"
                      >
                        Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-neutral-500 text-xs">Page {pageNum + 1} of {totalPages}</p>
          <div className="flex gap-2">
            {pageNum > 0 && (
              <Link
                href={`/admin/users?page=${pageNum}${q ? `&q=${q}` : ""}`}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm text-neutral-700 hover:border-neutral-300 transition-all"
              >
                ← Prev
              </Link>
            )}
            {pageNum + 1 < totalPages && (
              <Link
                href={`/admin/users?page=${pageNum + 2}${q ? `&q=${q}` : ""}`}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm text-neutral-700 hover:border-neutral-300 transition-all"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
