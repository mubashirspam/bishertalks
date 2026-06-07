import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { STATUS_BADGE, STATUS_LABELS, type Order, type OrderStatus } from "@/lib/types/order";

const PER_PAGE = 15;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { status, q, page = "1" } = await searchParams;
  const pageNum = Math.max(0, parseInt(page) - 1);

  let query = supabaseAdmin
    .from("orders")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(pageNum * PER_PAGE, (pageNum + 1) * PER_PAGE - 1);

  if (status && status !== "all") query = query.eq("status", status);
  if (q) {
    query = query.or(
      `order_number.ilike.%${q}%,buyer_name.ilike.%${q}%,buyer_phone.ilike.%${q}%`
    );
  }

  const { data: orders, count } = await query;
  const totalPages = Math.ceil((count || 0) / PER_PAGE);

  const statusFilters = [
    { label: "All", value: "all" },
    { label: "Confirmed", value: "confirmed" },
    { label: "Processing", value: "processing" },
    { label: "Shipped", value: "shipped" },
    { label: "Delivered", value: "delivered" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-neutral-900">Orders</h1>
          <p className="text-neutral-500 text-sm mt-1">{count ?? 0} total orders</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex gap-1 bg-white border border-neutral-200 rounded-xl p-1 shadow-sm">
          {statusFilters.map((f) => (
            <Link
              key={f.value}
              href={`/admin/orders?status=${f.value}${q ? `&q=${q}` : ""}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${(status ?? "all") === f.value
                  ? "bg-primary-500 text-white"
                  : "text-neutral-500 hover:text-neutral-900"
                }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <form className="flex-1 max-w-xs">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name, phone, order #…"
            className="w-full bg-white border border-neutral-300 rounded-xl px-4 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors"
          />
        </form>
      </div>

      {/* Table */}
      {!orders?.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
          No orders found
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Order</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Buyer</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden md:table-cell">Phone</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden md:table-cell">Amount</th>
                  <th className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider hidden lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {(orders as Order[]).map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${order.order_number}`}
                        className="font-mono text-primary-600 hover:text-primary-700 text-xs font-medium"
                      >
                        {order.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-900 font-medium">{order.buyer_name}</td>
                    <td className="px-4 py-3 text-neutral-500 hidden md:table-cell">{order.buyer_phone}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_BADGE[order.status as OrderStatus]}`}
                      >
                        {STATUS_LABELS[order.status as OrderStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-900 hidden md:table-cell">
                      ₹{Math.round(order.amount_paise / 100)}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 text-xs hidden lg:table-cell">
                      {new Date(order.created_at).toLocaleDateString("en-IN", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-neutral-500 text-xs">
            Page {pageNum + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            {pageNum > 0 && (
              <Link
                href={`/admin/orders?page=${pageNum}&status=${status ?? "all"}${q ? `&q=${q}` : ""}`}
                className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm text-neutral-700 hover:border-neutral-300 transition-all"
              >
                ← Prev
              </Link>
            )}
            {pageNum + 1 < totalPages && (
              <Link
                href={`/admin/orders?page=${pageNum + 2}&status=${status ?? "all"}${q ? `&q=${q}` : ""}`}
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
