import Link from "@/components/admin/AdminLink";
import {
  IndianRupee, CalendarDays, CalendarRange, CalendarCheck, AlertCircle, ArrowRight, Clock,
} from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/db/paginate";
import { orderStage, STAGE_LABELS, STAGE_BADGE } from "@/lib/order-stage";
import { formatISTShort, timeAgo, istToday, istDayStartUTC } from "@/lib/format-date";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { stockWarning, LOW_STOCK_DAYS } from "@/lib/db/inventory";
import { Suspense } from "react";
import { SkeletonStats, SkeletonTable } from "@/components/admin/Skeleton";
import { listCouriers } from "@/lib/db/couriers";
import RevenueCharts from "./RevenueCharts";
import HourlyOrders from "./HourlyOrders";
import CourierStatusTable from "./CourierStatusTable";

export const dynamic = "force-dynamic";

const rupees = (paise: number) => Math.round(paise / 100).toLocaleString("en-IN");

async function count(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) {
  const { count } = await build(base());
  return count ?? 0;
}
const base = () =>
  supabaseAdmin.from("orders").select("id", { count: "exact", head: true });

export default async function AdminDashboard() {
  const staff = await requirePageAccess("orders.view");

  // Six queries feed this screen. None of them block the shell any more — the
  // heading is up instantly and the numbers arrive when they arrive.
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black">Dashboard</h1>
      </div>

      {/* Above everything, and outside the Suspense boundary below, because
          this is the one thing on the dashboard that is a decision rather than
          a figure — and it is cached, so it costs nothing to await. */}
      {can(staff, "inventory.view") && <StockBanner />}
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

/**
 * "You are about to run out of books."
 *
 * Renders nothing at all unless that is true — no stock set up, comfortable
 * cover, or a viewer without the permission all produce silence. A banner that
 * is always present is furniture, and stops being read on the day it matters.
 *
 * It says days rather than copies, because copies is the number that misleads:
 * a thousand books sounds like plenty and is five days at this shop's rate.
 */
async function StockBanner() {
  const stock = await stockWarning();
  if (!stock || (!stock.low && !stock.oversold)) return null;

  const oversold = stock.oversold;

  return (
    <div
      className={`mb-6 flex items-start gap-2.5 rounded-2xl border px-5 py-4 text-sm ${
        oversold
          ? "border-red-300 bg-red-50 text-red-900"
          : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {oversold ? (
          <p className="font-semibold">
            {Math.abs(stock.free).toLocaleString("en-IN")} books are sold that
            don&apos;t exist.
          </p>
        ) : (
          <p className="font-semibold">
            About {Math.floor(stock.days!)} days of books left.
          </p>
        )}
        <p className="mt-1 leading-relaxed">
          {stock.free.toLocaleString("en-IN")} free to sell at{" "}
          {Math.round(stock.perDay)} a day.{" "}
          {oversold
            ? "Either a print run has not been recorded, or the shop is selling stock it does not have."
            : `A print run takes longer than ${LOW_STOCK_DAYS} days to arrive.`}{" "}
          <Link
            href="/admin/inventory"
            className="font-semibold underline underline-offset-2"
          >
            Stock
          </Link>
        </p>
      </div>
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
    couriers,
  ] = await Promise.all([
    // Paged. A plain .limit() here silently stopped at 1000 rows, which is why
    // the dashboard used to under-report both revenue and order count once the
    // shop passed a thousand paid orders. See lib/db/paginate.ts.
    fetchAllRows<{
      amount_paise: number | null;
      /** Sent back through Razorpay (0055). Comes off every total below. */
      refunded_paise: number | null;
      quantity: number | null;
      ordered_at: string;
      source: string | null;
      // Two more columns on a read this screen already does. The courier x
      // status table below is counted from these rows rather than from a
      // second full-table pass — same 3,500 rows, one trip.
      status: string;
      courier_id: string | null;
    }>(
      (from, to) =>
        supabaseAdmin
          .from("orders")
          .select("amount_paise,refunded_paise,quantity,ordered_at,source,status,courier_id")
          .eq("payment_status", "paid")
      // ordered_at, not created_at: every row here is paid, so this is the
      // payment date — and money must be counted on the day it arrived, not on
      // the day its customer first opened the checkout.
          .order("ordered_at", { ascending: true })
          .range(from, to),
      { label: "dashboard totals" }
    ),
    count((q) => q.eq("payment_status", "paid").is("address_line1", null)),
    supabaseAdmin
      .from("orders")
      .select("order_number,buyer_name,buyer_phone,amount_paise,refunded_paise,payment_status,address_line1,razorpay_order_id,ordered_at")
      // "Today's orders" means paid today. On created_at this panel silently
      // omitted anyone who started checkout earlier in the week and paid today.
      .gte("ordered_at", todayStart)
      .order("ordered_at", { ascending: false })
      .limit(8),
    // Names for the table below. Memoised per request, and every other screen
    // that needs them has already paid for it.
    listCouriers(),
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
   *
   * Refunds are subtracted, not filtered out (0055): a partly refunded order is
   * still an order and still a book, it is just worth less money. A refund is
   * counted against the day the order was PAID rather than the day it was sent
   * back, so this figure always answers "what did that day end up being worth",
   * which is the question the comparison against last week is asking.
   */
  const totalsSince = (since: string) =>
    paid.reduce(
      (acc, o) => {
        if (o.ordered_at >= since) {
          acc.paise += (o.amount_paise ?? 0) - (o.refunded_paise ?? 0);
          acc.orders += 1;
          acc.books += o.quantity ?? 1;
          acc.refundedPaise += o.refunded_paise ?? 0;
        }
        return acc;
      },
      { paise: 0, orders: 0, books: 0, refundedPaise: 0 }
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
      // The refund line only appears once there is one. It has to appear: the
      // headline is now net, so without it the card silently disagrees with
      // Razorpay's own settlement total and nobody can see why.
      sub:
        `${total.orders} paid order${total.orders === 1 ? "" : "s"}${books(total)}` +
        (total.refundedPaise > 0 ? ` · ₹${rupees(total.refundedPaise)} refunded` : ""),
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

      <CourierStatusTable
        rows={paid}
        courierNames={new Map(couriers.map((c) => [c.id, c.name]))}
      />

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
                    <span> · {formatISTShort(o.ordered_at)} ({timeAgo(o.ordered_at)})</span>
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
