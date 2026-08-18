import Link from "next/link";
import {
  IndianRupee, CalendarDays, CalendarRange, CalendarCheck, AlertCircle, ArrowRight, Clock,
} from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/db/paginate";
import { orderStage, STAGE_LABELS, STAGE_BADGE } from "@/lib/order-stage";
import { formatISTShort, timeAgo, istToday, istDayStartUTC } from "@/lib/format-date";
import { requirePageAccess } from "@/lib/admin-auth";
import { Suspense } from "react";
import { SkeletonStats, SkeletonTable } from "@/components/admin/Skeleton";
import RevenueCharts from "./RevenueCharts";
import HourlyOrders from "./HourlyOrders";

export const dynamic = "force-dynamic";

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

async function count(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  const { count } = await build(base());
  return count ?? 0;
}
const base = () =>
  supabaseAdmin.from("orders").select("id", { count: "exact", head: true });

export default async function AdminDashboard() {
  await requirePageAccess("orders.view");

  // Six queries feed this screen. None of them block the shell any more — the
  // heading is up instantly and the numbers arrive when they arrive.
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black">Dashboard</h1>
      </div>
      <Suspense
        fallback={
          <>
            <SkeletonStats />
            <SkeletonTable rows={6} columns={4} />
          </>
        }
      >
        <DashboardBody />
      </Suspense>
    </div>
  );
}

async function DashboardBody() {
  // Revenue boundaries on IST calendar days — the dashboard is for an
  // India-based seller, so "today" means IST midnight, not server-local.
  const today = istToday();
  const todayStart = istDayStartUTC(today);
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const weekStartDate = new Date(istNow);
  weekStartDate.setUTCDate(istNow.getUTCDate() - ((istNow.getUTCDay() + 6) % 7));
  const weekStart = istDayStartUTC(weekStartDate.toISOString().slice(0, 10));
  const monthStart = istDayStartUTC(`${today.slice(0, 7)}-01`);

  const [
    paidOrders,
    needsAddress,
    recent,
  ] = await Promise.all([
    // Paged. A plain .limit() here silently stopped at 1000 rows, which is why
    // the dashboard used to under-report both revenue and order count once the
    // shop passed a thousand paid orders. See lib/db/paginate.ts.
    fetchAllRows<{
      amount_paise: number | null;
      quantity: number | null;
      created_at: string;
      source: string | null;
    }>(
      (from, to) =>
        supabaseAdmin
          .from("orders")
          .select("amount_paise,quantity,created_at,source")
          .eq("payment_status", "paid")
          .order("created_at", { ascending: true })
          .range(from, to),
      { label: "dashboard totals" }
    ),
    count((q) => q.eq("payment_status", "paid").is("address_line1", null)),
    supabaseAdmin
      .from("orders")
      .select("order_number,buyer_name,buyer_phone,amount_paise,payment_status,address_line1,razorpay_order_id,created_at")
      .gte("created_at", todayStart)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const paid = paidOrders.rows;

  /**
   * Revenue, order count and book count for one period, in a single pass.
   *
   * All three matter together: ₹12,000 is a different day depending on whether
   * it came from two orders or twenty, and the money alone can't say which.
   * Books are counted separately from orders because one order can carry
   * several copies — without that, a day with a two-book order looks like a day
   * that lost an order, since the money goes up while the row count doesn't.
   */
  const totalsSince = (since: string) =>
    paid.reduce(
      (acc, o) => {
        if (o.created_at >= since) {
          acc.paise += o.amount_paise ?? 0;
          acc.orders += 1;
          acc.books += o.quantity ?? 1;
        }
        return acc;
      },
      { paise: 0, orders: 0, books: 0 }
    );

  const orders = (n: number) => `${n} order${n === 1 ? "" : "s"}`;

  /**
   * " · 147 books", or nothing at all when every order was a single copy.
   *
   * Shown only when the two disagree: on a day of one-book orders "147 orders ·
   * 147 books" is noise, and the whole point of the figure is to explain the
   * days where it isn't.
   */
  const books = (t: { orders: number; books: number }) =>
    t.books === t.orders ? "" : ` · ${t.books.toLocaleString("en-IN")} books`;

  const total = totalsSince("");
  const todayTotals = totalsSince(todayStart);
  const weekTotals = totalsSince(weekStart);
  const monthTotals = totalsSince(monthStart);

  const stats = [
    {
      label: "Total revenue", value: `₹${rupees(total.paise)}`,
      sub: `${total.orders} paid order${total.orders === 1 ? "" : "s"}${books(total)}`,
      icon: IndianRupee,
      card: "bg-gradient-to-br from-green-500 to-emerald-600",
      chip: "bg-white/20 text-white", valueTone: "text-white", subTone: "text-green-100",
    },
    {
      label: "Today", value: `₹${rupees(todayTotals.paise)}`,
      sub: `${orders(todayTotals.orders)}${books(todayTotals)} · since midnight IST`, icon: CalendarDays,
      card: "bg-gradient-to-br from-blue-500 to-indigo-600",
      chip: "bg-white/20 text-white", valueTone: "text-white", subTone: "text-blue-100",
    },
    {
      label: "This week", value: `₹${rupees(weekTotals.paise)}`,
      sub: `${orders(weekTotals.orders)}${books(weekTotals)} · since Monday`, icon: CalendarRange,
      card: "bg-gradient-to-br from-purple-500 to-fuchsia-600",
      chip: "bg-white/20 text-white", valueTone: "text-white", subTone: "text-purple-100",
    },
    {
      label: "This month", value: `₹${rupees(monthTotals.paise)}`,
      sub: `${orders(monthTotals.orders)}${books(monthTotals)} · ${new Date().toLocaleString("en-IN", { month: "long", year: "numeric" })}`,
      icon: CalendarCheck,
      card: "bg-gradient-to-br from-primary-500 to-amber-600",
      chip: "bg-white/20 text-white", valueTone: "text-white", subTone: "text-orange-100",
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`${s.card} rounded-2xl p-4 sm:p-5 shadow-sm h-full`}
          >
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${s.chip}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <p className={`text-xl sm:text-2xl font-black leading-none ${s.valueTone}`}>{s.value}</p>
            <p className={`text-sm font-semibold mt-2 ${s.valueTone}`}>{s.label}</p>
            <p className={`text-xs mt-0.5 ${s.subTone}`}>{s.sub}</p>
          </div>
        ))}
      </div>

      <RevenueCharts rows={paid} />

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

      <HourlyOrders rows={paid} />

      <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100">
          <h2 className="font-semibold text-sm">Today&apos;s activity</h2>
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
                  <p className="text-neutral-400 text-xs mt-0.5">
                    <span className="font-mono">{o.order_number}</span>
                    <span> · {formatISTShort(o.created_at)} ({timeAgo(o.created_at)})</span>
                  </p>
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
              No activity today.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
