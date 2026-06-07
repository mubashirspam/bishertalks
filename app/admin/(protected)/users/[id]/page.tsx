import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { STATUS_BADGE, STATUS_LABELS, type Order, type OrderStatus } from "@/lib/types/order";
import type { User } from "@/lib/types/db";
import AccessToggle from "./AccessToggle";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!user) notFound();
  const u = user as User;

  // Orders by this user (linked by user_id, with phone fallback for old rows).
  const { data: ordersById } = await supabaseAdmin
    .from("orders")
    .select("*")
    .or(`user_id.eq.${u.id},buyer_phone.eq.${u.phone}`)
    .order("created_at", { ascending: false });
  const orders = (ordersById as Order[]) ?? [];

  // All courses + this user's access rows.
  const { data: courses } = await supabaseAdmin
    .from("courses")
    .select("id,slug,title,sort_order")
    .order("sort_order", { ascending: true });

  const { data: accessRows } = await supabaseAdmin
    .from("course_access")
    .select("course_id,status,granted_via,granted_at")
    .eq("user_id", u.id);

  const accessByCourse = new Map(
    (accessRows ?? []).map((a) => [a.course_id, a])
  );

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-2 text-neutral-500 hover:text-neutral-900 text-sm mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Users
      </Link>

      {/* User header */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 mb-6 shadow-sm">
        <h1 className="text-2xl font-black mb-1 text-neutral-900">{u.name || "Unnamed user"}</h1>
        <p className="font-mono text-primary-600 text-sm">+91 {u.phone}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm text-neutral-500">
          {u.email && <span>{u.email}</span>}
          {(u.city || u.state) && <span>{[u.city, u.state].filter(Boolean).join(", ")}</span>}
          <span>
            Joined{" "}
            {new Date(u.created_at).toLocaleDateString("en-IN", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </span>
        </div>
      </div>

      {/* Course access */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 mb-6 shadow-sm">
        <h2 className="font-bold mb-4 text-neutral-900">Course Access</h2>
        <div className="space-y-3">
          {(courses ?? []).map((c) => {
            const a = accessByCourse.get(c.id);
            const active = a?.status === "active";
            return (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 border border-neutral-200 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="font-medium text-sm text-neutral-900">{c.title}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {active
                      ? `Active · via ${a?.granted_via === "purchase" ? "purchase" : "admin"}`
                      : a?.status === "revoked"
                      ? "Revoked"
                      : "No access"}
                  </p>
                </div>
                <AccessToggle userId={u.id} courseId={c.id} active={active} />
              </div>
            );
          })}
          {!courses?.length && (
            <p className="text-neutral-500 text-sm">
              No courses in the database yet. Seed courses first.
            </p>
          )}
        </div>
      </div>

      {/* Orders */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
        <h2 className="font-bold mb-4 text-neutral-900">Orders ({orders.length})</h2>
        {!orders.length ? (
          <p className="text-neutral-500 text-sm">No orders.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.order_number}`}
                className="flex items-center justify-between gap-3 border border-neutral-200 rounded-xl px-4 py-3 hover:border-neutral-300 transition-colors"
              >
                <div>
                  <p className="font-mono text-primary-600 text-xs">{o.order_number}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    ₹{Math.round(o.amount_paise / 100)} · {o.payment_status}
                  </p>
                </div>
                <span
                  className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_BADGE[o.status as OrderStatus]}`}
                >
                  {STATUS_LABELS[o.status as OrderStatus]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
