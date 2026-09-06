import { Suspense } from "react";
import {
  Calculator, TrendingUp, TrendingDown, Flag, Package, Wallet,
  AlertTriangle, Target, Check, Info,
} from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { SkeletonStats, SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending } from "@/components/admin/Revalidating";
import {
  getEconomicsReport,
  type EconomicsReport,
  type Milestone,
  type UnitEconomics,
} from "@/lib/db/economics";
import CostEditor from "./CostEditor";
import ActualSpend from "./ActualSpend";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/db/paginate";
import { istToday, istDayStartUTC, istDayEndUTC } from "@/lib/format-date";
import { REVENUE_SCOPE } from "@/lib/db/sales-channel";
import { actualsVsAssumed } from "@/lib/db/expenses";

export const dynamic = "force-dynamic";

// ── Formatting ──────────────────────────────────────────────────────────────

const rupees = (paise: number) =>
  `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/**
 * Indian short scale, because ₹69,90,00,000 is unreadable at a glance and this
 * report is read at a glance. Crore above one crore, lakh above one lakh.
 */
function compact(paise: number): string {
  const r = paise / 100;
  const sign = r < 0 ? "-" : "";
  const a = Math.abs(r);
  if (a >= 1_00_00_000) return `${sign}₹${(a / 1_00_00_000).toFixed(2)}Cr`;
  if (a >= 1_00_000) return `${sign}₹${(a / 1_00_000).toFixed(2)}L`;
  if (a >= 1_000) return `${sign}₹${(a / 1_000).toFixed(1)}k`;
  return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
}

const pct = (n: number) => `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(1)}%`;

function relativeDays(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return "today";
  if (days < 60) return `${Math.round(days)} days`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function ReportsPage() {
  await requirePageAccess("reports.view");

  return (
    <NavigationPending>
      <div className="mb-6">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary-500" /> Profit &amp; targets
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          What a book earns, when each milestone lands, and what a different
          price would do to both.
        </p>
      </div>

      <Suspense
        fallback={
          <>
            <SkeletonStats />
            <SkeletonTable rows={6} columns={5} />
          </>
        }
      >
        <ReportBody />
      </Suspense>
    </NavigationPending>
  );
}

async function ReportBody() {
  const report = await getEconomicsReport();

  return (
    <div className="space-y-5">
      <Kpis report={report} />
      <NotConfigured report={report} />
      <FulfilmentWarning report={report} />
      {/* The only block on this page made of real transactions rather than
          typed assumptions. Above the editor on purpose: the gap it shows is
          the reason to go and correct the numbers below it. */}
      <Suspense
        fallback={<div className="h-64 rounded-2xl bg-neutral-100 animate-pulse" />}
      >
        <ActualSpendBlock report={report} />
      </Suspense>
      <CostEditor costs={report.costs} />
      <Breakdown economics={report.economics} report={report} />
      <Milestones report={report} />
      <Scenarios report={report} />
    </div>
  );
}

/**
 * Actual spend for the current month, against what the model expected.
 *
 * The month to date rather than all time, because that is the period somebody
 * can still do something about, and because an all-time comparison would be
 * dominated by whatever the assumptions were years ago.
 *
 * Revenue and books are counted for the SAME range as the spend, and through
 * `REVENUE_SCOPE` — a profit figure built from all-time revenue and one
 * month's costs would be a very encouraging lie.
 */
async function ActualSpendBlock({ report }: { report: EconomicsReport }) {
  const today = istToday();
  const from = `${today.slice(0, 7)}-01`;

  const { rows } = await fetchAllRows<{
    amount_paise: number | null;
    refunded_paise: number | null;
    quantity: number | null;
    sales_channel: string | null;
  }>(
    (a, b) =>
      supabaseAdmin
        .from("orders")
        .select("amount_paise,refunded_paise,quantity,sales_channel")
        .eq("payment_status", "paid")
        .gte("ordered_at", istDayStartUTC(from))
        .lte("ordered_at", istDayEndUTC(today))
        .order("ordered_at", { ascending: true })
        .range(a, b) as never,
    { label: "reports actual spend" }
  );

  let revenuePaise = 0;
  let directSalesPaise = 0;
  let booksSold = 0;

  for (const o of rows) {
    const net = (o.amount_paise ?? 0) - (o.refunded_paise ?? 0);
    if (o.sales_channel === "manual") {
      directSalesPaise += net;
      continue;
    }
    revenuePaise += net;
    booksSold += o.quantity ?? 1;
  }

  const actuals = await actualsVsAssumed(
    from,
    today,
    {
      perBookVariablePaise: report.economics.variablePaise,
      monthlyFixedPaise: report.economics.fixedMonthlyPaise,
    },
    booksSold
  );

  return (
    <ActualSpend
      actuals={actuals}
      revenuePaise={revenuePaise}
      directSalesPaise={directSalesPaise}
    />
  );
}

// ── Top: the numbers as they stand ──────────────────────────────────────────

function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "bad";
  icon: typeof Wallet;
}) {
  const valueTone =
    tone === "good" ? "text-green-600" : tone === "bad" ? "text-red-600" : "text-neutral-900";
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-neutral-400">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-black mt-1.5 ${valueTone}`}>{value}</p>
      {sub && <p className="text-[11px] text-neutral-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function Kpis({ report }: { report: EconomicsReport }) {
  const { history, economics, booksPerDay, rateBasis, listPricePaise, discountGapPercent } =
    report;
  const monthlyProfit = economics.netProfitPaise * booksPerDay * 30.44;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi
        icon={Package}
        label="Books per day"
        value={booksPerDay.toFixed(1)}
        sub={`${rateBasis} average · ${history.booksSold.toLocaleString("en-IN")} sold so far`}
      />
      <Kpi
        icon={Wallet}
        label="Realised price"
        value={rupees(history.realisedPricePaise)}
        // Everything else on this page is computed at the LIST price, so how
        // far this sits below it has to be visible.
        //
        // Two things live in that gap and they are worth not confusing: real
        // discounts (promos, referrals), and the fact that the back catalogue
        // was sold at whatever the price was THEN. Right after a rise most of
        // the gap is the second, and it shrinks on its own as new orders land.
        // So the label says where the number sits, and does not claim why.
        // Refunds are inside this number — revenue is net of them (0055) — so
        // when there are any, say so here rather than letting the realised
        // price quietly sag with no visible cause.
        sub={
          history.refundedPaise > 0
            ? `${compact(history.revenuePaise)} kept · ${compact(history.refundedPaise)} refunded on ${history.refundedOrders} order${history.refundedOrders === 1 ? "" : "s"}`
            : discountGapPercent >= 0.5
              ? `${discountGapPercent.toFixed(0)}% below today's ${rupees(listPricePaise)} · every book ever sold`
              : `after discounts · ${compact(history.revenuePaise)} collected`
        }
      />
      <Kpi
        icon={economics.netProfitPaise >= 0 ? TrendingUp : TrendingDown}
        label="Profit per book"
        value={rupees(economics.netProfitPaise)}
        tone={economics.netProfitPaise >= 0 ? "good" : "bad"}
        sub={`${pct(economics.netMarginPercent)} margin · after overheads`}
      />
      <Kpi
        icon={economics.netProfitPaise >= 0 ? TrendingUp : TrendingDown}
        label="Profit run-rate"
        value={`${compact(monthlyProfit)}/mo`}
        tone={monthlyProfit >= 0 ? "good" : "bad"}
        sub={`${compact(monthlyProfit * 12)} a year at this pace`}
      />
    </div>
  );
}

/**
 * With no costs entered every book looks like pure profit, which is the most
 * dangerous thing this page could quietly say. Say it out loud instead.
 */
function NotConfigured({ report }: { report: EconomicsReport }) {
  if (report.configured) return null;

  if (report.tableMissing) {
    return (
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
        <p className="text-[12.5px] text-red-900 leading-relaxed">
          <span className="font-bold">Costs table not found.</span> Run{" "}
          <code className="font-mono text-[11px] bg-red-100 px-1 rounded">
            supabase/migrations/0026_unit_economics.sql
          </code>{" "}
          in the Supabase SQL editor. Until then the form below cannot save and
          every figure treats the book as free to make.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <p className="text-[12.5px] text-amber-900 leading-relaxed">
        <span className="font-bold">No costs entered yet.</span> Every figure
        below treats the book as free to make, so the profit shown is just the
        price. Fill in the form and save — the whole page recalculates.
      </p>
    </div>
  );
}

/**
 * The report is built on costs that have not been tested against reality yet.
 *
 * Printing and delivery are quotes until parcels actually arrive, and the
 * return rate cannot be known before anything has been returned. Saying so on
 * the screen is the difference between a forecast and a guess wearing a
 * forecast's clothes.
 */
function FulfilmentWarning({ report }: { report: EconomicsReport }) {
  const { history } = report;
  const share = history.booksSold ? history.delivered / history.booksSold : 0;
  if (history.booksSold === 0 || share >= 0.2) return null;

  return (
    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <p className="text-[12.5px] text-amber-900 leading-relaxed">
        <span className="font-bold">
          {history.delivered} of {history.booksSold.toLocaleString("en-IN")} books
          delivered.
        </span>{" "}
        Printing, delivery and return costs below are estimates, not measurements
        — nothing has come back yet because almost nothing has arrived yet. Treat
        every profit figure on this page as provisional until a few hundred
        parcels have landed and the real numbers replace the typed ones.
      </p>
    </div>
  );
}

// ── Where the money goes ────────────────────────────────────────────────────

function Bar({
  label,
  paise,
  pricePaise,
  tone,
}: {
  label: string;
  paise: number;
  pricePaise: number;
  tone: string;
}) {
  if (paise <= 0) return null;
  const width = pricePaise ? Math.min(100, (paise / pricePaise) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 flex-shrink-0 text-xs text-neutral-600">{label}</span>
      <div className="flex-1 h-5 bg-neutral-100 rounded-md overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-20 flex-shrink-0 text-right text-xs font-bold tabular-nums text-neutral-700">
        {rupees(paise)}
      </span>
      <span className="w-12 flex-shrink-0 text-right text-[11px] tabular-nums text-neutral-400">
        {width.toFixed(0)}%
      </span>
    </div>
  );
}

function Breakdown({
  economics: e,
  report,
}: {
  economics: UnitEconomics;
  report: EconomicsReport;
}) {
  const headroom = e.breakEvenCacPaise - e.marketingPaise;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100">
        <h2 className="font-bold text-sm text-neutral-800">
          Where {rupees(e.pricePaise)} goes
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          One book, at today&apos;s realised price and{" "}
          {Math.round(e.monthlyVolume).toLocaleString("en-IN")} books a month.
        </p>
      </div>

      <div className="p-5 space-y-2">
        <Bar label="Printing" paise={e.printingPaise} pricePaise={e.pricePaise} tone="bg-neutral-400" />
        <Bar label="Packaging" paise={e.packagingPaise} pricePaise={e.pricePaise} tone="bg-neutral-400" />
        <Bar label="Delivery" paise={e.deliveryPaise} pricePaise={e.pricePaise} tone="bg-neutral-500" />
        <Bar label="Marketing (CAC)" paise={e.marketingPaise} pricePaise={e.pricePaise} tone="bg-orange-400" />
        <Bar label="Gateway fee" paise={e.gatewayPaise} pricePaise={e.pricePaise} tone="bg-neutral-300" />
        <Bar label="Returns drag" paise={e.rtoDragPaise} pricePaise={e.pricePaise} tone="bg-red-300" />
        <Bar label="Other variable" paise={e.otherVariablePaise} pricePaise={e.pricePaise} tone="bg-neutral-300" />
        <Bar label="Overheads share" paise={e.fixedPerBookPaise} pricePaise={e.pricePaise} tone="bg-purple-300" />
        <div className="pt-2 mt-1 border-t border-dashed border-neutral-200">
          <Bar
            label="Profit"
            paise={Math.max(0, e.netProfitPaise)}
            pricePaise={e.pricePaise}
            tone="bg-green-500"
          />
          {e.netProfitPaise < 0 && (
            <p className="text-xs font-bold text-red-600 mt-2">
              Losing {rupees(-e.netProfitPaise)} on every book sold.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-neutral-100 border-t border-neutral-100">
        <Stat
          label="Contribution"
          value={rupees(e.contributionPaise)}
          sub={`${pct(e.contributionPercent)} — before overheads`}
        />
        <Stat
          label="Break-even CAC"
          value={rupees(e.breakEvenCacPaise)}
          sub={
            headroom >= 0
              ? `${rupees(headroom)} of headroom left`
              : `${rupees(-headroom)} over — losing money`
          }
          tone={headroom >= 0 ? "good" : "bad"}
        />
        <Stat
          label="Overheads share"
          value={rupees(e.fixedPerBookPaise)}
          sub={`${compact(e.fixedMonthlyPaise)}/mo ÷ volume`}
        />
        <Stat
          label="Break-even volume"
          value={
            Number.isFinite(e.breakEvenVolume)
              ? `${e.breakEvenVolume.toLocaleString("en-IN")}/mo`
              : "never"
          }
          sub="books to cover the fixed costs"
          tone={
            Number.isFinite(e.breakEvenVolume) && e.breakEvenVolume <= e.monthlyVolume
              ? "good"
              : "bad"
          }
        />
      </div>

      {report.costs.rtoPercent === 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-neutral-500 px-5 py-3 border-t border-neutral-100">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px text-neutral-400" />
          Return rate is set to 0, which is right while every order is prepaid.
          The day COD goes live, set it to what you actually see — at 25% it
          takes {rupees(Math.round((0.25 / 0.75) * (report.costs.rtoCostPaise || 13000)))} off
          every book that does arrive.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const valueTone =
    tone === "good" ? "text-green-600" : tone === "bad" ? "text-red-600" : "text-neutral-900";
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className={`text-lg font-black mt-0.5 ${valueTone}`}>{value}</p>
      <p className="text-[11px] text-neutral-500 mt-0.5">{sub}</p>
    </div>
  );
}

// ── Milestones ──────────────────────────────────────────────────────────────

function MilestoneRow({ m, last }: { m: Milestone; last: boolean }) {
  return (
    <li className="relative pl-8 pb-5 last:pb-0">
      {!last && (
        <span className="absolute left-[9px] top-5 bottom-0 w-px bg-neutral-200" aria-hidden="true" />
      )}
      <span
        className={`absolute left-0 top-1 w-[19px] h-[19px] rounded-full border-2 flex items-center justify-center ${
          m.reached
            ? "bg-green-500 border-green-500"
            : "bg-white border-neutral-300"
        }`}
        aria-hidden="true"
      >
        {m.reached && <Check className="w-3 h-3 text-white" />}
      </span>

      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-black text-sm text-neutral-900">{m.label}</span>
        <span className="text-[11px] text-neutral-400">
          {m.booksNeeded.toLocaleString("en-IN")} books
        </span>
        {m.reached ? (
          <span className="text-[11px] font-bold text-green-600">reached</span>
        ) : (
          <span className="text-[11px] text-neutral-500">
            {relativeDays(m.daysAway)} away · {shortDate(m.projectedDate)}
          </span>
        )}
      </div>

      <div className="mt-1.5 h-1.5 bg-neutral-100 rounded-full overflow-hidden max-w-md">
        <div
          className={`h-full rounded-full ${m.reached ? "bg-green-500" : "bg-primary-500"}`}
          style={{ width: `${m.percentComplete}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px]">
        <span className="text-neutral-500">
          Books left{" "}
          <span className="font-bold text-neutral-700">
            {m.booksRemaining.toLocaleString("en-IN")}
          </span>
        </span>
        <span className="text-neutral-500">
          Total cost <span className="font-bold text-neutral-700">{compact(m.cumulativeCostPaise)}</span>
        </span>
        <span className="text-neutral-500">
          Profit{" "}
          <span
            className={`font-bold ${
              m.cumulativeProfitPaise >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {compact(m.cumulativeProfitPaise)}
          </span>
        </span>
        <span className="text-neutral-500">
          Margin <span className="font-bold text-neutral-700">{pct(m.marginPercent)}</span>
        </span>
      </div>
    </li>
  );
}

function Milestones({ report }: { report: EconomicsReport }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100">
        <h2 className="font-bold text-sm text-neutral-800 flex items-center gap-2">
          <Flag className="w-4 h-4 text-primary-500" /> Revenue milestones
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Dates assume {report.booksPerDay.toFixed(1)} books a day holds — the{" "}
          {report.rateBasis} average. Profit is cumulative to that point, with
          overheads charged for every month it takes to get there.
        </p>
      </div>
      <ol className="p-5">
        {report.milestones.map((m, i) => (
          <MilestoneRow key={m.label} m={m} last={i === report.milestones.length - 1} />
        ))}
      </ol>
    </div>
  );
}

// ── Price scenarios ─────────────────────────────────────────────────────────

function Scenarios({ report }: { report: EconomicsReport }) {
  const { scenarios, recommendation: rec, costs } = report;
  const best = Math.max(...scenarios.map((s) => s.annualProfitPaise));

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100">
        <h2 className="font-bold text-sm text-neutral-800 flex items-center gap-2">
          <Target className="w-4 h-4 text-primary-500" /> If the price changed
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Built around <strong className="text-neutral-700">{rupees(report.listPricePaise)}</strong>,
          the price on the Checkout tab right now — change it there and this
          whole table moves with it. Assumes {costs.priceElasticity}% of buyers
          are lost for every 10% added to the price, and that the ad budget stays
          put — so fewer conversions means a higher cost per buyer, not a smaller
          bill.
        </p>
        <p className="text-xs text-neutral-500 mt-1.5">
          <span className="font-semibold text-neutral-700">Can lose</span> is the
          number to act on: how far conversion can fall before that price earns
          exactly what today&apos;s earns. It needs no assumption at all — the ad
          spend and overheads are the same either way and cancel out. Green means
          the predicted loss sits well inside it; amber means the two are close
          enough that the decision rests entirely on the guess above.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-neutral-400 border-b border-neutral-100">
              <th className="text-left font-semibold px-4 py-2.5">Price</th>
              <th className="text-right font-semibold px-3 py-2.5">Books/day</th>
              <th className="text-right font-semibold px-3 py-2.5">Real CAC</th>
              <th className="text-right font-semibold px-3 py-2.5">Profit/book</th>
              <th className="text-right font-semibold px-3 py-2.5">Margin</th>
              <th
                className="text-right font-semibold px-3 py-2.5"
                title="How many buyers you can lose before this price earns exactly what today's price earns. Compare it with the loss the model predicts."
              >
                Can lose
              </th>
              <th className="text-right font-semibold px-3 py-2.5">Books/yr</th>
              <th className="text-right font-semibold px-4 py-2.5">Profit/yr</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const isBest = s.annualProfitPaise === best;
              return (
                <tr
                  key={s.pricePaise}
                  className={`border-b border-neutral-50 last:border-0 ${
                    s.isCurrent ? "bg-primary-50/60" : isBest ? "bg-green-50/50" : ""
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-bold text-neutral-900">{rupees(s.pricePaise)}</span>
                    {s.isCurrent && (
                      <span className="ml-2 text-[10px] font-bold text-primary-600 uppercase">
                        now
                      </span>
                    )}
                    {isBest && !s.isCurrent && (
                      <span className="ml-2 text-[10px] font-bold text-green-600 uppercase">
                        best
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                    {s.booksPerDay.toFixed(1)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                    {rupees(s.effectiveCacPaise)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums font-bold ${
                      s.netProfitPaise >= 0 ? "text-neutral-900" : "text-red-600"
                    }`}
                  >
                    {rupees(s.netProfitPaise)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                    {pct(s.netMarginPercent)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {s.isCurrent ? (
                      <span className="text-neutral-300">—</span>
                    ) : (
                      <span
                        className={
                          s.verdict === "bad"
                            ? "text-red-600 font-bold"
                            : s.verdict === "marginal"
                              ? "text-amber-600 font-bold"
                              : "text-green-600 font-bold"
                        }
                        title={
                          s.breakEvenLossPercent < 0
                            ? `Only pays if buyers rise by ${Math.abs(s.breakEvenLossPercent).toFixed(1)}%. Model predicts ${Math.abs(s.predictedLossPercent).toFixed(1)}%.`
                            : `Break-even at ${s.breakEvenLossPercent.toFixed(1)}% lost. Model predicts ${s.predictedLossPercent.toFixed(1)}% lost.`
                        }
                      >
                        {s.breakEvenLossPercent < 0
                          ? `needs +${Math.abs(s.breakEvenLossPercent).toFixed(1)}%`
                          : `${s.breakEvenLossPercent.toFixed(1)}%`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                    {s.annualBooks.toLocaleString("en-IN")}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-black ${
                      s.annualProfitPaise >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {compact(s.annualProfitPaise)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-4 border-t border-neutral-100 bg-neutral-50">
        <p className="text-xs font-bold text-neutral-700 mb-1">
          {rec.bestPricePaise === report.economics.pricePaise
            ? `${rupees(rec.bestPricePaise)} is already the profit-maximising price.`
            : `The model's best price is ${rupees(rec.bestPricePaise)} — ${
                rec.upliftPaise >= 0 ? "+" : ""
              }${compact(rec.upliftPaise)} a year against today.`}
        </p>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          {rec.healthyPricePaise
            ? `${rupees(rec.healthyPricePaise)} is the lowest price that still clears a ${rec.targetMarginPercent}% net margin. `
            : `No price on this ladder reaches a ${rec.targetMarginPercent}% net margin at today's costs — the fix is cost or volume, not price. `}
          This rests entirely on the {costs.priceElasticity}% sensitivity figure
          above, which is a guess until a split test replaces it. Treat the
          ordering as informative and the exact rupees as indicative.
        </p>
      </div>
    </div>
  );
}
