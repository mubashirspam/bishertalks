import { Suspense } from "react";
import { SkeletonHeader, SkeletonTable } from "@/components/admin/Skeleton";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import NewCourseButton from "./NewCourseButton";
import DeleteCourseButton from "./DeleteCourseButton";
import { requirePageAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Guard runs in the shell so an unauthorised visitor is redirected before
  // any of the work below is started. The staff lookup is memoised per
  // request, so the body re-reading it costs nothing.
  await requirePageAccess("courses.manage");

  return (
    <Suspense fallback={<><SkeletonHeader /><SkeletonTable rows={5} columns={4} /></>}>
      <CoursesBody  />
    </Suspense>
  );
}

async function CoursesBody() {
  await requirePageAccess("courses.manage");

  const { data: courses } = await supabaseAdmin
    .from("courses")
    .select("id,slug,title,subtitle,thumbnail,price,offer_price,is_locked,sort_order")
    .order("sort_order", { ascending: true });

  const rows = await Promise.all(
    (courses ?? []).map(async (c) => {
      const [{ count: moduleCount }, { count: accessCount }] = await Promise.all([
        supabaseAdmin
          .from("modules")
          .select("id", { count: "exact", head: true })
          .eq("course_id", c.id),
        supabaseAdmin
          .from("course_access")
          .select("id", { count: "exact", head: true })
          .eq("course_id", c.id)
          .eq("status", "active"),
      ]);
      return { ...c, moduleCount: moduleCount ?? 0, accessCount: accessCount ?? 0 };
    })
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-black text-neutral-900">Courses</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Create and manage courses, modules, and lessons.
          </p>
        </div>
        <NewCourseButton />
      </div>

      {!rows.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
          No courses yet. Click <strong className="text-neutral-900">New Course</strong> to create one.
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Course</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Pricing</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Modules</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Active access</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/courses/${c.slug}`} className="flex items-center gap-3 group">
                        <div className="w-12 h-9 rounded-md overflow-hidden bg-neutral-100 border border-neutral-200 flex-shrink-0">
                          {c.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.thumbnail} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div>
                          <p className="text-neutral-900 font-medium group-hover:text-primary-600 transition-colors">{c.title}</p>
                          <p className="font-mono text-neutral-400 text-xs">{c.slug}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.price == null ? (
                        <span className="text-neutral-400 text-xs">Default</span>
                      ) : c.offer_price != null ? (
                        <span>
                          <span className="font-semibold text-neutral-900">₹{c.offer_price}</span>{" "}
                          <span className="text-neutral-400 line-through text-xs">₹{c.price}</span>
                        </span>
                      ) : (
                        <span className="font-semibold text-neutral-900">₹{c.price}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{c.moduleCount}</td>
                    <td className="px-4 py-3 text-neutral-700">{c.accessCount}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200">
                        {c.is_locked ? "Locked" : "Open"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/admin/courses/${c.slug}`}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Link>
                        <DeleteCourseButton id={c.id} title={c.title} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
