import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/db/paginate";

/**
 * Unit economics: what a book earns, when the milestones land, and what a
 * different price would do to both.
 *
 * Everything here is arithmetic over two inputs — the paid orders we already
 * store, and the cost figures the owner types into /admin/reports. There is no
 * hidden constant: any number the report shows can be traced to one of those
 * two, which is the only way a projection is worth acting on.
 *
 * Money is paise throughout, as everywhere else in this codebase. Rates are
 * percentages, named `...Percent`, and converted at the point of use.
 */

/** Days in an average month. Milestone dates are months away; 30 would drift. */
const DAYS_PER_MONTH = 30.44;

export interface BusinessCosts {
  printingPaise: number;
  packagingPaise: number;
  deliveryPaise: number;
  marketingPaise: number;
  otherVariablePaise: number;
  paymentFeePercent: number;
  salaryMonthlyPaise: number;
  techMonthlyPaise: number;
  otherFixedMonthlyPaise: number;
  rtoPercent: number;
  rtoCostPaise: number;
  priceElasticity: number;
}

export const DEFAULT_COSTS: BusinessCosts = {
  printingPaise: 0,
  packagingPaise: 0,
  deliveryPaise: 0,
  marketingPaise: 0,
  otherVariablePaise: 0,
  paymentFeePercent: 2.36,
  salaryMonthlyPaise: 0,
  techMonthlyPaise: 0,
  otherFixedMonthlyPaise: 0,
  rtoPercent: 0,
  rtoCostPaise: 0,
  priceElasticity: 12,
};

/**
 * Costs as stored, and whether they have ever been filled in.
 *
 * The flag matters more than it looks. With no row the defaults are all zero,
 * and zero costs make every book pure profit — the report would show ₹680 a
 * copy and a milestone timeline paved with money, confidently and completely
 * wrongly. The page uses this to say "nothing entered yet" instead.
 */
export async function getBusinessCosts(): Promise<
  BusinessCosts & { configured: boolean; tableMissing: boolean }
> {
  const { data, error } = await supabaseAdmin
    .from("business_costs")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  // Two different problems that look identical in the numbers and need
  // opposite fixes: the migration never ran, or it ran and nobody has typed
  // anything in yet. Telling someone to run a migration they already ran is
  // the fastest way to make them distrust the whole screen.
  if (error) {
    console.error("[Economics] business_costs unreadable:", error.message);
    return { ...DEFAULT_COSTS, configured: false, tableMissing: true };
  }

  if (!data) return { ...DEFAULT_COSTS, configured: false, tableMissing: false };

  const configured =
    (data.printing_paise ?? 0) > 0 ||
    (data.packaging_paise ?? 0) > 0 ||
    (data.delivery_paise ?? 0) > 0 ||
    (data.marketing_paise ?? 0) > 0 ||
    (data.salary_monthly_paise ?? 0) > 0;

  return {
    configured,
    tableMissing: false,
    printingPaise: data.printing_paise ?? 0,
    packagingPaise: data.packaging_paise ?? 0,
    deliveryPaise: data.delivery_paise ?? 0,
    marketingPaise: data.marketing_paise ?? 0,
    otherVariablePaise: data.other_variable_paise ?? 0,
    paymentFeePercent: Number(data.payment_fee_percent ?? 2.36),
    salaryMonthlyPaise: Number(data.salary_monthly_paise ?? 0),
    techMonthlyPaise: Number(data.tech_monthly_paise ?? 0),
    otherFixedMonthlyPaise: Number(data.other_fixed_monthly_paise ?? 0),
    rtoPercent: Number(data.rto_percent ?? 0),
    rtoCostPaise: Number(data.rto_cost_paise ?? 0),
    priceElasticity: Number(data.price_elasticity ?? 12),
  };
}

// ── Trading history ─────────────────────────────────────────────────────────

export interface TradingHistory {
  booksSold: number;
  orders: number;
  revenuePaise: number;
  /** Revenue divided by books — the price actually realised after discounts. */
  realisedPricePaise: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  daysTrading: number;
  /** Books per day over each window. The 7-day figure is what projections use. */
  perDay7: number;
  perDay30: number;
  perDayAll: number;
  /** Books shipped and delivered — how much of the cost model is still theory. */
  shipped: number;
  delivered: number;
  returned: number;
}

/**
 * What has actually been sold.
 *
 * Counts books rather than orders: one order can carry several copies, and
 * every cost below is per book. Paid orders only — a pending row is a intention,
 * not revenue.
 */
export async function getTradingHistory(): Promise<TradingHistory> {
  // Paged: this had no limit at all, which meant PostgREST handed back the
  // first 1000 paid orders and every profit figure on the report was computed
  // from them as though they were the whole business.
  const { rows } = await fetchAllRows<{
    amount_paise: number | null;
    quantity: number | null;
    ordered_at: string;
    shipped_at: string | null;
    delivered_at: string | null;
    returned_at: string | null;
  }>(
    (from, to) =>
      supabaseAdmin
        .from("orders")
        .select("amount_paise, quantity, ordered_at, shipped_at, delivered_at, returned_at")
        .eq("payment_status", "paid")
        // The day the money arrived, not the day checkout began — see 0043.
        .order("ordered_at", { ascending: true })
        .range(from, to),
    { label: "trading history" }
  );

  const booksSold = rows.reduce((s, o) => s + (o.quantity ?? 1), 0);
  const revenuePaise = rows.reduce((s, o) => s + (o.amount_paise ?? 0), 0);

  const firstOrderAt = rows[0]?.ordered_at ?? null;
  const lastOrderAt = rows[rows.length - 1]?.ordered_at ?? null;

  // Measured to now, not to the last order: a quiet week is part of the average
  // and hiding it would flatter every projection built on top.
  const daysTrading = firstOrderAt
    ? Math.max(1, (Date.now() - new Date(firstOrderAt).getTime()) / 86_400_000)
    : 0;

  const booksSince = (days: number) => {
    const cutoff = Date.now() - days * 86_400_000;
    return rows
      .filter((o) => new Date(o.ordered_at).getTime() >= cutoff)
      .reduce((s, o) => s + (o.quantity ?? 1), 0);
  };

  return {
    booksSold,
    orders: rows.length,
    revenuePaise,
    realisedPricePaise: booksSold ? Math.round(revenuePaise / booksSold) : 0,
    firstOrderAt,
    lastOrderAt,
    daysTrading,
    // Divided by the window length even when trading is younger than the
    // window, so a 3-day-old business doesn't report its 3-day total as a
    // 30-day rate.
    perDay7: booksSince(7) / Math.min(7, Math.max(daysTrading, 1)),
    perDay30: booksSince(30) / Math.min(30, Math.max(daysTrading, 1)),
    perDayAll: daysTrading ? booksSold / daysTrading : 0,
    shipped: rows.filter((o) => o.shipped_at).length,
    delivered: rows.filter((o) => o.delivered_at).length,
    returned: rows.filter((o) => o.returned_at).length,
  };
}

// ── Unit economics ──────────────────────────────────────────────────────────

export interface UnitEconomics {
  pricePaise: number;
  /** Books per month this was computed against — fixed costs divide by it. */
  monthlyVolume: number;

  printingPaise: number;
  packagingPaise: number;
  deliveryPaise: number;
  marketingPaise: number;
  otherVariablePaise: number;
  gatewayPaise: number;
  rtoDragPaise: number;
  /** Everything that scales with the book. */
  variablePaise: number;

  /** Monthly fixed costs divided by monthly volume. Falls as volume rises. */
  fixedPerBookPaise: number;
  fixedMonthlyPaise: number;

  /** Price less variable cost. What one more book adds before overheads. */
  contributionPaise: number;
  contributionPercent: number;

  /** Contribution less this book's share of the overheads. The real number. */
  netProfitPaise: number;
  netMarginPercent: number;

  /** The most that could be paid to acquire a buyer before the book loses money. */
  breakEvenCacPaise: number;
  /** Books a month needed for contribution to cover the fixed costs. */
  breakEvenVolume: number;
}

/**
 * A parcel that comes back earns nothing and still costs money, so its cost has
 * to be carried by the parcels that arrive. At a 25% return rate every three
 * delivered books carry one failure, hence the share rather than the rate.
 */
function rtoDrag(costs: BusinessCosts): number {
  // 100% would mean nothing is ever delivered; there is no book to load it onto.
  const rate = Math.min(costs.rtoPercent, 99.9) / 100;
  return Math.round((rate / (1 - rate)) * costs.rtoCostPaise);
}

export function unitEconomics(
  costs: BusinessCosts,
  pricePaise: number,
  monthlyVolume: number,
  /** Overrides the stored CAC when a scenario has moved it. */
  marketingOverridePaise?: number
): UnitEconomics {
  const marketingPaise = marketingOverridePaise ?? costs.marketingPaise;
  const gatewayPaise = Math.round((pricePaise * costs.paymentFeePercent) / 100);
  const rtoDragPaise = rtoDrag(costs);

  const variablePaise =
    costs.printingPaise +
    costs.packagingPaise +
    costs.deliveryPaise +
    marketingPaise +
    costs.otherVariablePaise +
    gatewayPaise +
    rtoDragPaise;

  const fixedMonthlyPaise =
    costs.salaryMonthlyPaise + costs.techMonthlyPaise + costs.otherFixedMonthlyPaise;

  // Zero volume would divide by zero and report an infinite cost per book; with
  // nothing sold there is no book to charge the overheads to.
  const fixedPerBookPaise =
    monthlyVolume > 0 ? Math.round(fixedMonthlyPaise / monthlyVolume) : 0;

  const contributionPaise = pricePaise - variablePaise;
  const netProfitPaise = contributionPaise - fixedPerBookPaise;

  // What is left for acquisition once every other cost is paid.
  const breakEvenCacPaise = contributionPaise + marketingPaise - fixedPerBookPaise;

  // Contribution here excludes fixed costs by definition, so this is the volume
  // at which the month's overheads are exactly covered.
  const contributionExFixed = contributionPaise;
  const breakEvenVolume =
    contributionExFixed > 0 ? Math.ceil(fixedMonthlyPaise / contributionExFixed) : Infinity;

  return {
    pricePaise,
    monthlyVolume,
    printingPaise: costs.printingPaise,
    packagingPaise: costs.packagingPaise,
    deliveryPaise: costs.deliveryPaise,
    marketingPaise,
    otherVariablePaise: costs.otherVariablePaise,
    gatewayPaise,
    rtoDragPaise,
    variablePaise,
    fixedPerBookPaise,
    fixedMonthlyPaise,
    contributionPaise,
    contributionPercent: pricePaise ? (contributionPaise / pricePaise) * 100 : 0,
    netProfitPaise,
    netMarginPercent: pricePaise ? (netProfitPaise / pricePaise) * 100 : 0,
    breakEvenCacPaise,
    breakEvenVolume,
  };
}

// ── Milestones ──────────────────────────────────────────────────────────────

/** Revenue milestones, in rupees. Labelled the way the owner says them. */
export const MILESTONES: { label: string; rupees: number }[] = [
  { label: "₹1M", rupees: 1_000_000 },
  { label: "₹5M", rupees: 5_000_000 },
  { label: "₹10M", rupees: 10_000_000 },
  { label: "₹25M", rupees: 25_000_000 },
  { label: "₹50M", rupees: 50_000_000 },
  { label: "₹100M", rupees: 100_000_000 },
];

export interface Milestone {
  label: string;
  targetPaise: number;
  /** Books to have sold in total by the time it is reached. */
  booksNeeded: number;
  booksRemaining: number;
  reached: boolean;
  percentComplete: number;
  daysAway: number | null;
  projectedDate: string | null;
  /** Months of fixed cost carried from the first order to that date. */
  monthsElapsed: number;
  cumulativeCostPaise: number;
  cumulativeProfitPaise: number;
  /** Profit margin on everything sold up to that point. */
  marginPercent: number;
}

/**
 * When each milestone lands, and what is left over when it does.
 *
 * Projected from a books-per-day rate the caller chooses — the 7-day rate while
 * ads are running, which is the honest read on a business three days into a
 * scale-up. It assumes that rate holds, which it will not; the value is in the
 * ordering and the rough distance, not the exact date.
 *
 * Fixed costs accrue against the calendar rather than the books, so a milestone
 * reached slowly costs more to reach than the same milestone reached quickly.
 * That is the whole reason to model them separately.
 */
export function projectMilestones(
  history: TradingHistory,
  costs: BusinessCosts,
  booksPerDay: number,
  pricePaise: number
): Milestone[] {
  const perBookVariable = unitEconomics(
    costs,
    pricePaise,
    Math.max(1, booksPerDay * DAYS_PER_MONTH)
  ).variablePaise;

  const fixedMonthlyPaise =
    costs.salaryMonthlyPaise + costs.techMonthlyPaise + costs.otherFixedMonthlyPaise;

  return MILESTONES.map(({ label, rupees }) => {
    const targetPaise = rupees * 100;
    const booksNeeded = pricePaise ? Math.ceil(targetPaise / pricePaise) : 0;
    const booksRemaining = Math.max(0, booksNeeded - history.booksSold);
    const reached = history.revenuePaise >= targetPaise;

    const daysAway =
      reached ? 0 : booksPerDay > 0 ? booksRemaining / booksPerDay : null;

    const projectedDate =
      daysAway === null
        ? null
        : new Date(Date.now() + daysAway * 86_400_000).toISOString();

    // From the first order to the milestone, which is what the overheads are
    // actually billed for.
    const monthsElapsed =
      (history.daysTrading + (daysAway ?? 0)) / DAYS_PER_MONTH;

    const cumulativeCostPaise =
      booksNeeded * perBookVariable + Math.round(monthsElapsed * fixedMonthlyPaise);

    const revenueAtMilestone = booksNeeded * pricePaise;
    const cumulativeProfitPaise = revenueAtMilestone - cumulativeCostPaise;

    return {
      label,
      targetPaise,
      booksNeeded,
      booksRemaining,
      reached,
      percentComplete: targetPaise
        ? Math.min(100, (history.revenuePaise / targetPaise) * 100)
        : 0,
      daysAway,
      projectedDate,
      monthsElapsed,
      cumulativeCostPaise,
      cumulativeProfitPaise,
      marginPercent: revenueAtMilestone
        ? (cumulativeProfitPaise / revenueAtMilestone) * 100
        : 0,
    };
  });
}

// ── Price scenarios ─────────────────────────────────────────────────────────

export interface PriceScenario {
  pricePaise: number;
  priceChangePercent: number;
  /** Share of today's conversion the model expects to survive the change. */
  conversionMultiplier: number;
  booksPerDay: number;
  /** CAC rises when conversion falls: the same ad spend buys fewer buyers. */
  effectiveCacPaise: number;
  contributionPaise: number;
  netProfitPaise: number;
  netMarginPercent: number;
  dailyProfitPaise: number;
  annualBooks: number;
  annualProfitPaise: number;
  annualRevenuePaise: number;
  isCurrent: boolean;

  /**
   * The buyer loss at which this price earns exactly what today's price earns.
   * Positive is a loss you can absorb; negative means a price cut that only
   * pays if volume actually rises by that much.
   */
  breakEvenLossPercent: number;
  /** What the elasticity assumption predicts you will actually lose. */
  predictedLossPercent: number;
  /** Predicted loss comfortably inside break-even, rather than on the line. */
  verdict: "safe" | "marginal" | "bad";
}

/**
 * Price less everything variable except acquisition.
 *
 * Acquisition is excluded because the ad budget does not move with the price —
 * the same spend buys the same clicks. That is what makes the break-even below
 * solve so cleanly: total ad spend per day is identical in both scenarios and
 * cancels, as does the daily share of fixed costs.
 */
function contributionExCac(costs: BusinessCosts, pricePaise: number): number {
  return (
    pricePaise -
    costs.printingPaise -
    costs.packagingPaise -
    costs.deliveryPaise -
    costs.otherVariablePaise -
    Math.round((pricePaise * costs.paymentFeePercent) / 100) -
    rtoDrag(costs)
  );
}

/**
 * How far conversion can fall before a new price stops being worth it.
 *
 * Daily profit is `books × m × contributionExCac(P) − daily ad spend − daily
 * fixed`, and the last two terms are the same at any price. Setting the two
 * sides equal leaves `m = contributionExCac(today) / contributionExCac(new)` —
 * no volume, no overheads, no CAC in it at all.
 *
 * This is the number the decision actually turns on: not "is the new price more
 * profitable per book" (a higher price always is) but "how many buyers can I
 * lose before that stops mattering".
 */
function breakEvenLoss(
  costs: BusinessCosts,
  currentPricePaise: number,
  pricePaise: number
): number {
  const target = contributionExCac(costs, pricePaise);
  if (target <= 0) return -Infinity;
  const multiplier = contributionExCac(costs, currentPricePaise) / target;
  return (1 - multiplier) * 100;
}

/**
 * The same business at a different price.
 *
 * Two effects, and leaving out the second is what makes naive pricing models
 * lie. Raise the price and fewer people buy — that much is obvious. But the ad
 * spend does not fall with them: the same budget buys the same clicks and
 * converts fewer of them, so the cost of acquiring each remaining buyer rises
 * by exactly the conversion drop. A price rise therefore eats into its own
 * margin gain, and past a point it stops paying for itself entirely.
 *
 * The conversion response comes from `price_elasticity` — percent of buyers
 * lost per 10% added to the price — which is a number nobody knows without
 * running a split test. It is an input, not a fact, and every figure derived
 * from it inherits that.
 */
export function priceScenarios(
  costs: BusinessCosts,
  currentPricePaise: number,
  currentBooksPerDay: number,
  prices: number[]
): PriceScenario[] {
  return prices.map((pricePaise) => {
    const priceChangePercent = currentPricePaise
      ? ((pricePaise - currentPricePaise) / currentPricePaise) * 100
      : 0;

    // Elasticity is quoted per 10% of price, so scale the change into that unit.
    // Floored at 5%: the model is linear and would otherwise promise negative
    // buyers at a high enough price, which is not a forecast, it is arithmetic
    // running off the end of its own assumption.
    const conversionMultiplier = Math.max(
      0.05,
      1 - (priceChangePercent / 10) * (costs.priceElasticity / 100)
    );

    const booksPerDay = currentBooksPerDay * conversionMultiplier;
    const effectiveCacPaise = Math.round(costs.marketingPaise / conversionMultiplier);
    const monthlyVolume = Math.max(1, booksPerDay * DAYS_PER_MONTH);

    const econ = unitEconomics(costs, pricePaise, monthlyVolume, effectiveCacPaise);
    const annualBooks = Math.round(booksPerDay * 365);

    const breakEvenLossPercent = breakEvenLoss(costs, currentPricePaise, pricePaise);
    const predictedLossPercent = (1 - conversionMultiplier) * 100;

    // A quarter of the allowance is the line between "worth doing" and "a coin
    // flip dressed as a strategy" — when the prediction sits on the break-even,
    // the whole decision rests on an elasticity figure nobody has measured.
    const slack = breakEvenLossPercent - predictedLossPercent;
    const verdict: PriceScenario["verdict"] =
      pricePaise === currentPricePaise
        ? "safe"
        : slack <= 0
          ? "bad"
          : slack < Math.abs(breakEvenLossPercent) * 0.25
            ? "marginal"
            : "safe";

    return {
      breakEvenLossPercent,
      predictedLossPercent,
      verdict,
      pricePaise,
      priceChangePercent,
      conversionMultiplier,
      booksPerDay,
      effectiveCacPaise,
      contributionPaise: econ.contributionPaise,
      netProfitPaise: econ.netProfitPaise,
      netMarginPercent: econ.netMarginPercent,
      dailyProfitPaise: Math.round(booksPerDay * econ.netProfitPaise),
      annualBooks,
      annualProfitPaise: Math.round(annualBooks * econ.netProfitPaise),
      annualRevenuePaise: annualBooks * pricePaise,
      isCurrent: pricePaise === currentPricePaise,
    };
  });
}

/** A ladder of round prices around the current one, for the scenario table. */
export function priceLadder(currentPricePaise: number): number[] {
  const current = Math.round(currentPricePaise / 100);
  const steps = [-150, -100, -50, 0, 50, 100, 150, 200, 300];
  const rupees = steps
    .map((d) => current + d)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  return Array.from(new Set(rupees)).map((r) => r * 100);
}

export interface PriceRecommendation {
  /** The price the elasticity model says earns most over a year. */
  bestPricePaise: number;
  bestAnnualProfitPaise: number;
  currentAnnualProfitPaise: number;
  upliftPaise: number;
  /** The cheapest price that still clears the target margin. */
  healthyPricePaise: number | null;
  targetMarginPercent: number;
}

/**
 * The profit-maximising price, found by sweeping rather than by calculus — the
 * cost function has a percentage fee and an integer CAC in it, so a closed form
 * would be more precise about a model that is itself a guess.
 *
 * Swept in ₹10 steps across a wide band so the answer is a price someone would
 * actually print, and reported alongside the current one so the size of the
 * prize is visible. If they are the same, the current price is already right.
 */
export function recommendPrice(
  costs: BusinessCosts,
  currentPricePaise: number,
  currentBooksPerDay: number,
  targetMarginPercent = 40
): PriceRecommendation {
  const candidates: number[] = [];
  const lo = Math.max(1000, Math.round(currentPricePaise * 0.5));
  const hi = Math.round(currentPricePaise * 2);
  for (let p = lo; p <= hi; p += 1000) candidates.push(p);

  const scenarios = priceScenarios(costs, currentPricePaise, currentBooksPerDay, candidates);

  const best = scenarios.reduce((a, b) =>
    b.annualProfitPaise > a.annualProfitPaise ? b : a
  );
  const current = unitEconomics(
    costs,
    currentPricePaise,
    Math.max(1, currentBooksPerDay * DAYS_PER_MONTH)
  );
  const currentAnnualProfitPaise = Math.round(
    currentBooksPerDay * 365 * current.netProfitPaise
  );

  const healthy = scenarios.find((s) => s.netMarginPercent >= targetMarginPercent);

  return {
    bestPricePaise: best.pricePaise,
    bestAnnualProfitPaise: best.annualProfitPaise,
    currentAnnualProfitPaise,
    upliftPaise: best.annualProfitPaise - currentAnnualProfitPaise,
    healthyPricePaise: healthy?.pricePaise ?? null,
    targetMarginPercent,
  };
}

// ── The whole report ────────────────────────────────────────────────────────

export interface EconomicsReport {
  costs: BusinessCosts;
  /** False until someone has entered real figures — see getBusinessCosts. */
  configured: boolean;
  /** True only when migration 0026 has not been applied. */
  tableMissing: boolean;
  history: TradingHistory;
  /** The rate every projection is built on, and which window it came from. */
  booksPerDay: number;
  rateBasis: "7-day" | "30-day" | "all-time";
  economics: UnitEconomics;
  milestones: Milestone[];
  scenarios: PriceScenario[];
  recommendation: PriceRecommendation;
}

export async function getEconomicsReport(): Promise<EconomicsReport> {
  const [stored, history] = await Promise.all([getBusinessCosts(), getTradingHistory()]);
  const { configured, tableMissing, ...costs } = stored;

  // The most recent window with something in it. A business that sold nothing
  // this week is described by its 30-day rate, not by a zero.
  const rateBasis: EconomicsReport["rateBasis"] =
    history.perDay7 > 0 ? "7-day" : history.perDay30 > 0 ? "30-day" : "all-time";
  const booksPerDay =
    rateBasis === "7-day"
      ? history.perDay7
      : rateBasis === "30-day"
        ? history.perDay30
        : history.perDayAll;

  const pricePaise = history.realisedPricePaise;
  const monthlyVolume = Math.max(1, booksPerDay * DAYS_PER_MONTH);

  return {
    costs,
    configured,
    tableMissing,
    history,
    booksPerDay,
    rateBasis,
    economics: unitEconomics(costs, pricePaise, monthlyVolume),
    milestones: projectMilestones(history, costs, booksPerDay, pricePaise),
    scenarios: priceScenarios(costs, pricePaise, booksPerDay, priceLadder(pricePaise)),
    recommendation: recommendPrice(costs, pricePaise, booksPerDay),
  };
}
