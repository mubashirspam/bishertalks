import Link from "next/link";
import {
  IndianRupee, ShoppingBag, AlertCircle, TrendingDown, ArrowRight, Clock,
} from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { orderStage, STAGE_LABELS, STAGE_BADGE } from "@/lib/order-stage";

export const dynamic = "force-dynamic";

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

async function count(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  const { count } = await build(base());
  return count ?? 0;
}
const base = () =>
  supabaseAdmin.from("orders").select("id", { count: "exact", head: true });

export default async function AdminDashboard() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 864e5).toISOString();

  const [
    paidOrders,
    ordersToday,
    needsAddress,
    leads,
    failed,
    recent,
  ] = await Promise.all([
    supabaseAdmin.from("orders").select("amount_paise").eq("payment_status", "paid"),
    count((q) => q.eq("payment_status", "paid").gte("created_at", startOfToday)),
    count((q) => q.eq("payment_status", "paid").is("address_line1", null)),
    count((q) => q.is("razorpay_order_id", null).neq("payment_status", "paid").gte("created_at", sevenDaysAgo)),
    count((q) => q.eq("payment_status", "failed").gte("created_at", sevenDaysAgo)),
    supabaseAdmin
      .from("orders")
      .select("order_number,buyer_name,buyer_phone,amount_paise,payment_status,address_line1,razorpay_order_id,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const revenuePaise = (paidOrders.data ?? []).reduce(
    (sum, o) => sum + (o.amount_paise ?? 0), 0
  );
  const paidCount = paidOrders.data?.length ?? 0;

  const stats = [
    {
      label: "Revenue", value: `₹${rupees(revenuePaise)}`,
      sub: `${paidCount} paid order${paidCount === 1 ? "" : "s"}`,
      icon: IndianRupee, tone: "text-green-600 bg-green-50",
    },
    {
      label: "Paid today", value: String(ordersToday),
      sub: "since midnight", icon: ShoppingBag, tone: "text-blue-600 bg-blue-50",
    },
    {
      label: "Needs address", value: String(needsAddress),
      sub: needsAddress ? "can't ship these" : "all shippable",
      icon: AlertCircle,
      tone: needsAddress ? "text-orange-600 bg-orange-50" : "text-neutral-400 bg-neutral-100",
      href: "/admin/orders?stage=paid_no_address",
      urgent: needsAddress > 0,
    },
    {
      label: "Left before paying", value: String(leads),
      sub: "last 7 days", icon: TrendingDown, tone: "text-neutral-600 bg-neutral-100",
      href: "/admin/orders?stage=lead",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-black">Dashboard</h1>
      <p className="text-neutral-500 text-sm mt-1 mb-6">
        {failed > 0
          ? `${failed} payment${failed === 1 ? "" : "s"} failed in the last 7 days.`
          : "No failed payments in the last 7 days."}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => {
          const card = (
            <div
              className={`bg-white border rounded-2xl p-5 shadow-sm h-full transition-all ${
                s.urgent ? "border-orange-300 ring-1 ring-orange-200" : "border-neutral-200"
              } ${s.href ? "hover:shadow-md hover:border-neutral-300" : ""}`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${s.tone}`}>
                <s.icon className="w-4 h-4" />
              </div>
              <p className="text-2xl font-black leading-none">{s.value}</p>
              <p className="text-neutral-900 text-sm font-medium mt-2">{s.label}</p>
              <p className="text-neutral-400 text-xs mt-0.5">{s.sub}</p>
            </div>
          );
          return s.href ? (
            <Link key={s.label} href={s.href}>{card}</Link>
          ) : (
            <div key={s.label}>{card}</div>
          );
        })}
      </div>

      {needsAddress > 0 && (
        <Link
          href="/admin/orders?stage=paid_no_address"
          className="flex items-center gap-3 bg-orange-50 border border-orange-300 rounded-2xl px-5 py-4 mb-8 hover:bg-orange-100 transition-colors"
        >
          <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-orange-900 text-sm">
              {needsAddress} paid order{needsAddress === 1 ? "" : "s"} with no delivery address
            </p>
            <p className="text-orange-700 text-xs mt-0.5">
              These customers have paid but can&apos;t be shipped to. Chase them.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-orange-600" />
        </Link>
      )}

      <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="font-semibold text-sm">Recent activity</h2>
          <Link href="/admin/orders" className="text-primary-600 text-xs font-medium hover:underline">
            View all
          </Link>
        </div>
        <div className="divide-y divide-neutral-100">
          {(recent.data ?? []).map((o) => {
            const stage = orderStage(o);
            return (
              <Link
                key={o.order_number}
                href={`/admin/orders/${o.order_number}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {o.buyer_name || <span className="text-neutral-400">No name yet</span>}
                    <span className="text-neutral-400 font-normal"> · {o.buyer_phone ?? "—"}</span>
                  </p>
                  <p className="text-neutral-400 text-xs font-mono mt-0.5">{o.order_number}</p>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${STAGE_BADGE[stage]}`}>
                  {STAGE_LABELS[stage]}
                </span>
                <span className="text-sm font-semibold w-16 text-right">
                  ₹{rupees(o.amount_paise ?? 0)}
                </span>
              </Link>
            );
          })}
          {!recent.data?.length && (
            <p className="px-5 py-8 text-center text-neutral-400 text-sm">
              <Clock className="w-4 h-4 mx-auto mb-2" />
              No activity yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
