import { Boxes, AlertTriangle, Printer, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import StockForms from "./StockForms";
import {
  getBookStock,
  listPrintRuns,
  listStockMovements,
  salesRate,
  daysOfCover,
  movementAdds,
  MOVEMENT_LABELS,
} from "@/lib/db/inventory";
import { formatISTShort } from "@/lib/format-date";

export const dynamic = "force-dynamic";

/**
 * How many books there are.
 *
 * The number this page exists for is `free`, not `on hand`. On the day it was
 * built those were 1,254 and 3,565 — the difference being 2,311 books already
 * paid for by people waiting for them. "3,565 left" and "1,254 left" describe
 * very different businesses and only one of them is safe to sell against, and
 * every screen the shop had until now implied the larger one.
 */

/** Below this many days of cover, the page stops being a report and warns. */
const WARN_DAYS = 21;

export default async function InventoryPage() {
  const staff = await requirePageAccess("inventory.view");

  const [stock, runs, movements, rate] = await Promise.all([
    getBookStock(),
    listPrintRuns(),
    listStockMovements(50),
    salesRate(7),
  ]);

  // Migration 0056 is applied by hand, so a deploy can land before it. Say
  // which step is missing rather than rendering zeros that read as "no books".
  if (!stock) {
    return (
      <div>
        <h1 className="text-2xl font-black mb-2">Stock</h1>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-semibold">Inventory isn&apos;t set up yet.</p>
          <p className="mt-1.5 leading-relaxed">
            Apply <code className="font-mono text-xs">0056_book_inventory.sql</code> in
            Supabase. It creates the print-run and stock-movement tables, and seeds
            the 6,000 copies printed so far. Nothing here works until it has run —
            and nothing else in the admin is affected by it.
          </p>
        </div>
      </div>
    );
  }

  const cover = daysOfCover(stock.free, rate);
  const low = cover !== null && cover < WARN_DAYS;
  const oversold = stock.free < 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-black">
          <Boxes className="h-6 w-6 text-neutral-400" /> Stock
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {stock.printed.toLocaleString("en-IN")} books printed ·{" "}
          {stock.shippedOut.toLocaleString("en-IN")} shipped out
        </p>
      </div>

      {/* ── The warning, when there is one ─────────────────────────────────
          Above the numbers, because somebody who opens this page while it is
          true needs to act rather than read. */}
      {(low || oversold) && (
        <div
          className={`mb-5 flex items-start gap-2.5 rounded-2xl border px-5 py-4 text-sm ${
            oversold
              ? "border-red-300 bg-red-50 text-red-900"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {oversold ? (
              <>
                <p className="font-semibold">
                  {Math.abs(stock.free).toLocaleString("en-IN")} books are sold that
                  don&apos;t exist.
                </p>
                <p className="mt-1 leading-relaxed">
                  More copies are paid for than are on the shelf. Either a print run
                  hasn&apos;t been recorded yet, or the shop is selling against stock it
                  doesn&apos;t have.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">
                  About {Math.floor(cover!)} days of stock left.
                </p>
                <p className="mt-1 leading-relaxed">
                  {stock.free.toLocaleString("en-IN")} books are free to sell, and
                  orders are running at {Math.round(rate.perDay)} a day. A print run
                  takes longer than this to arrive.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── The three numbers ──────────────────────────────────────────────── */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure
          label="On the shelf"
          value={stock.onHand}
          hint="Printed, less everything that has shipped"
        />
        <Figure
          label="Already sold"
          value={stock.committed}
          hint="Paid for, not yet dispatched"
          muted
        />
        <Figure
          label="Free to sell"
          value={stock.free}
          hint={
            cover === null
              ? "No orders in the last week"
              : `About ${Math.floor(cover)} days at ${Math.round(rate.perDay)}/day`
          }
          accent={oversold ? "bad" : low ? "warn" : "good"}
        />
      </div>

      {/* ── How it adds up ─────────────────────────────────────────────────
          Spelled out rather than trusted, because every figure above is
          derived and somebody will reasonably want to check the arithmetic. */}
      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          How that adds up
        </h2>
        <dl className="space-y-1.5 text-sm">
          <Line label="Printed, all runs" value={stock.printed} />
          <Line label="Shipped, out for delivery or delivered" value={-stock.shippedOut} />
          {stock.adjustIn > 0 && <Line label="Added by hand" value={stock.adjustIn} />}
          {stock.adjustOut > 0 && <Line label="Written off" value={-stock.adjustOut} />}
          <div className="border-t border-neutral-200 pt-1.5">
            <Line label="On the shelf" value={stock.onHand} bold />
          </div>
          <Line label="Already sold and waiting" value={-stock.committed} />
          <div className="border-t border-neutral-200 pt-1.5">
            <Line label="Free to sell" value={stock.free} bold />
          </div>
        </dl>

        <p className="mt-4 border-t border-neutral-100 pt-3 text-xs leading-relaxed text-neutral-500">
          {stock.cancelled.toLocaleString("en-IN")} cancelled orders need no
          adjustment — those books never left.{" "}
          {stock.cameBack > 0 ? (
            <>
              {stock.cameBack.toLocaleString("en-IN")} parcels came back, of which{" "}
              {stock.returnedToStock.toLocaleString("en-IN")} have been put back on
              the shelf. A returned book only counts again once somebody has opened
              the parcel and said it is sellable.
            </>
          ) : (
            <>
              No parcels have come back yet. When one does it will not count as stock
              again until somebody opens it and says it is sellable.
            </>
          )}
        </p>
      </section>

      <StockForms canManage={can(staff, "inventory.manage")} />

      {/* ── Print runs ──────────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          <Printer className="h-3.5 w-3.5" /> Print runs
        </h2>
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Edition</th>
                <th className="px-4 py-2.5 font-semibold">Copies</th>
                <th className="px-4 py-2.5 font-semibold">Received</th>
                <th className="px-4 py-2.5 font-semibold">Cost each</th>
                <th className="px-4 py-2.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2.5 font-semibold">#{r.edition}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {r.copies.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600">{r.received_on}</td>
                  <td className="px-4 py-2.5 tabular-nums text-neutral-600">
                    {r.unit_cost_paise
                      ? `₹${Math.round(r.unit_cost_paise / 100)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-neutral-500">
                    {r.note ?? r.printer ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Movement log ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Stock corrections
        </h2>
        {!movements.length ? (
          <p className="rounded-2xl border border-neutral-200 bg-white px-5 py-5 text-sm text-neutral-400">
            Nothing recorded. This log is for what orders can&apos;t explain — a
            damaged copy, one given to the author, a stocktake that disagreed, or a
            returned parcel put back on the shelf.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {movements.map((m) => {
                  const adds = movementAdds(m.kind);
                  return (
                    <tr key={m.id} className="border-t border-neutral-100 first:border-t-0">
                      <td className="px-4 py-2.5 w-14">
                        <span
                          className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${
                            adds ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          {adds ? (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          )}
                          {m.copies}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-neutral-800">
                          {MOVEMENT_LABELS[m.kind]}
                        </span>
                        <span className="block text-xs text-neutral-500">
                          {m.reason}
                          {m.order_number ? ` · ${m.order_number}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-neutral-400">
                        {formatISTShort(m.created_at)}
                        {m.actor_email ? (
                          <span className="block">{m.actor_email}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  muted,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  muted?: boolean;
  accent?: "good" | "warn" | "bad";
}) {
  const tone =
    accent === "bad"
      ? "text-red-700"
      : accent === "warn"
        ? "text-amber-700"
        : accent === "good"
          ? "text-green-700"
          : muted
            ? "text-neutral-500"
            : "text-neutral-900";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className={`mt-1.5 text-3xl font-black tabular-nums ${tone}`}>
        {value.toLocaleString("en-IN")}
      </p>
      <p className="mt-1 text-xs text-neutral-500">{hint}</p>
    </div>
  );
}

/** One line of the arithmetic. Negative values print with their sign. */
function Line({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={bold ? "font-semibold text-neutral-900" : "text-neutral-600"}>
        {label}
      </dt>
      <dd
        className={`tabular-nums ${
          bold ? "font-bold text-neutral-900" : "text-neutral-700"
        }`}
      >
        {value < 0 ? "−" : ""}
        {Math.abs(value).toLocaleString("en-IN")}
      </dd>
    </div>
  );
}
