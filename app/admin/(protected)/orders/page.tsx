import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  orderStage, applyStageFilter, STAGE_LABELS, STAGE_BADGE, type OrderStage,
} from "@/lib/order-stage";
import { formatISTShort, timeAgo } from "@/lib/format-date";

export const dynamic = "force-dynamic";

const PER_PAGE = 20;

/** Buckets, ordered by how urgently they need attention. */
const STAGE_TABS: { label: string; value: OrderStage | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Needs address", value: "paid_no_address" },
  { label: "Complete", value: "complete" },
  { label: "Started payment", value: "payment_started" },
  { label: "Payment failed", value: "failed" },
  { label: "Left before paying", value: "lead" },
];

interface Row {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  amount_paise: number;
  payment_status: string;
  address_line1: string | null;
  razorpay_order_id: string | null;
  city: string | null;
  created_at: string;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string; page?: string }>;
}) {
  const { stage, q, page = "1" } = await searchParams;
  const pageNum = Math.max(0, parseInt(page) - 1);
  const activeStage = (stage ?? "all") as OrderStage | "all";

  let query = supabaseAdmin
    .from("orders")
    .select(
      "id,order_number,buyer_name,buyer_phone,amount_paise,payment_status,address_line1,razorpay_order_id,city,created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(pageNum * PER_PAGE, (pageNum + 1) * PER_PAGE - 1);

  if (activeStage !== "all") {
    query = applyStageFilter(query, activeStage);
  }
  if (q) {
    query = query.or(
      `order_number.ilike.%${q}%,buyer_name.ilike.%${q}%,buyer_phone.ilike.%${q}%`
    );
  }

  const { data, count } = await query;
  const orders = (data ?? []) as Row[];
  const totalPages = Math.ceil((count || 0) / PER_PAGE);

  const link = (s: string, p?: number) =>
    `/admin/orders?stage=${s}${q ? `&q=${q}` : ""}${p ? `&page=${p}` : ""}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black">Orders</h1>
        <p className="text-neutral-500 text-sm mt-1">
          {count ?? 0} {activeStage === "all" ? "total" : STAGE_LABELS[activeStage].toLowerCase()}
        </p>
      </div>

      {/* Stage buckets — every customer sits in exactly one */}
      <div className="flex flex-wrap gap-2 mb-4">
        {STAGE_TABS.map((t) => {
          const active = activeStage === t.value;
          const urgent = t.value === "paid_no_address";
          return (
            <Link
              key={t.value}
              href={link(t.value)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                active
                  ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                  : urgent
                    ? "bg-orange-50 text-orange-700 border-orange-200 hover:border-orange-300"
                    : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300"
              }`}
            >
              {urgent && !active && <AlertCircle className="w-3 h-3 inline mr-1 -mt-0.5" />}
              {t.label}
            </Link>
          );
        })}
      </div>

      <form className="mb-5 max-w-xs">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, phone, order #…"
          className="w-full bg-white border border-neutral-300 rounded-xl px-4 py-2 text-sm placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors"
        />
        {activeStage !== "all" && <input type="hidden" name="stage" value={activeStage} />}
      </form>

      {activeStage === "paid_no_address" && orders.length > 0 && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4 text-sm">
          <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
          <p className="text-orange-800">
            These customers have <strong>paid</strong> but never submitted a delivery
            address. Call them, or open an order to resend the address link.
          </p>
        </div>
      )}

      {!orders.length ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-12 text-center text-neutral-500 shadow-sm">
          Nothing here.
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                  {["Order", "Customer", "Stage", "Amount", "Date & time"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider ${
                        i === 3 ? "hidden md:table-cell" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const s = orderStage(o);
                  return (
                    <tr
                      key={o.id}
                      className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/orders/${o.order_number}`}
                          className="font-mono text-primary-600 hover:text-primary-700 text-xs font-medium"
                        >
                          {o.order_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-neutral-900 font-medium">
                          {o.buyer_name ?? <span className="text-neutral-400 font-normal">—</span>}
                        </p>
                        <p className="text-neutral-500 text-xs">
                          {o.buyer_phone ? (
                            <a
                              href={`https://wa.me/91${o.buyer_phone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-green-600"
                            >
                              {o.buyer_phone}
                            </a>
                          ) : "—"}
                          {o.city ? ` · ${o.city}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${STAGE_BADGE[s]}`}>
                          {STAGE_LABELS[s]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-900 hidden md:table-cell">
                        ₹{Math.round((o.amount_paise ?? 0) / 100)}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <p className="text-neutral-700 font-medium">
                          {formatISTShort(o.created_at)}
                        </p>
                        <p className="text-neutral-400 mt-0.5">
                          {timeAgo(o.created_at)}
                        </p>
                      </td>
                    </tr>
                  );
                })}
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
              <Link href={link(activeStage, pageNum)} className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all">
                ← Prev
              </Link>
            )}
            {pageNum + 1 < totalPages && (
              <Link href={link(activeStage, pageNum + 2)} className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
