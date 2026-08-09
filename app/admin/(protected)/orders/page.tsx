import Link from "next/link";
import { AlertCircle, Phone, MessageCircle } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  orderStage, STAGE_LABELS, STAGE_BADGE, type OrderStage,
} from "@/lib/order-stage";
import { formatISTShort, timeAgo } from "@/lib/format-date";
import { SOURCE_LABELS, SOURCE_BADGE, isTrafficSource } from "@/lib/attribution";
import { funnelWaMessage, waLink, telLink } from "@/lib/wa-message";
import OrderFilters from "./OrderFilters";
import { Suspense } from "react";
import { SkeletonTable } from "@/components/admin/Skeleton";
import { NavigationPending, StaleWhileRevalidating } from "@/components/admin/Revalidating";
import { fetchOrdersPage } from "@/lib/db/orders-page";

/** Filter values, passed as primitives so React cache dedupes the query. */
interface QueryArgs {
  stage?: string;
  q?: string;
  from?: string;
  to?: string;
  source?: string;
  pageNum: number;
}
import { requirePageAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const PER_PAGE = 20;

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
  state: string | null;
  created_at: string;
  source: string | null;
  utm_campaign: string | null;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string; q?: string; page?: string; from?: string; to?: string;
    source?: string;
  }>;
}) {
  // Cached per request and shared with the layout, so this no longer costs a
  // second round trip to Supabase auth.
  await requirePageAccess("orders.view");

  const { stage, q, page = "1", from, to, source } = await searchParams;
  const pageNum = Math.max(0, parseInt(page) - 1);
  const activeStage = (stage ?? "all") as OrderStage | "all";

  // Nothing is awaited past this point: the shell renders now and the two
  // sections below stream in when the (single, shared) query resolves.
  const queryArgs: QueryArgs = { stage, q, from, to, source, pageNum };

  return (
    <NavigationPending>
      <div className="mb-6">
        <h1 className="text-2xl font-black">Orders</h1>
        <p className="text-neutral-500 text-sm mt-1">
          {activeStage === "all" ? "All customers" : STAGE_LABELS[activeStage]}
        </p>
      </div>

      {/* Filters render immediately — they need no data, so making them wait
          for the query was pure delay. The row count is streamed into them. */}
      <OrderFilters
        countSlot={
          <Suspense fallback={<span className="text-neutral-400">Counting…</span>}>
            <OrderCount {...queryArgs} />
          </Suspense>
        }
      />

      {/* The rows. On first load this shows a skeleton; on a filter change the
          previous rows stay visible and dimmed until the new ones arrive. */}
      <StaleWhileRevalidating>
        <Suspense fallback={<SkeletonTable rows={10} columns={6} />}>
          <OrdersTable {...queryArgs} />
        </Suspense>
      </StaleWhileRevalidating>
    </NavigationPending>
  );
}

/** Just the count, so the filter bar can paint before the query resolves. */
async function OrderCount(props: QueryArgs) {
  const { count } = await fetchOrdersPage(
    props.stage, props.q, props.from, props.to, props.source, props.pageNum, PER_PAGE
  );
  const filtered =
    !!props.stage || !!props.q || !!props.from || !!props.to || !!props.source;

  return (
    <>
      {count} order{count === 1 ? "" : "s"}
      {filtered && " matching filters"}
    </>
  );
}

/** The table itself. Shares one query with OrderCount via React cache. */
async function OrdersTable(props: QueryArgs) {
  const { rows, count } = await fetchOrdersPage(
    props.stage, props.q, props.from, props.to, props.source, props.pageNum, PER_PAGE
  );
  const orders = rows as unknown as Row[];
  const activeStage = (props.stage ?? "all") as OrderStage | "all";
  const pageNum = props.pageNum;
  const totalPages = Math.ceil(count / PER_PAGE);
  const q = props.q;

  const link = (s: string, p?: number) =>
    `/admin/orders?stage=${s}${q ? `&q=${q}` : ""}${p ? `&page=${p}` : ""}`;

  return (
    <>
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
                  {[
                    { label: "Order" },
                    { label: "Customer" },
                    { label: "Stage" },
                    { label: "Came from", narrow: true },
                    { label: "Amount", narrow: true },
                    { label: "Date & time" },
                  ].map((h) => (
                    <th
                      key={h.label}
                      className={`px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider ${
                        h.narrow ? "hidden md:table-cell" : ""
                      }`}
                    >
                      {h.label}
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
                        <p className="text-neutral-500 text-xs flex items-center gap-1.5">
                          <span>
                            {o.buyer_phone ?? "—"}
                            {o.city ? ` · ${o.city}` : ""}
                            {o.state ? `, ${o.state}` : ""}
                          </span>
                          {o.buyer_phone && (
                            <span className="inline-flex items-center gap-1">
                              <a
                                href={telLink(o.buyer_phone)}
                                title="Call"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                              >
                                <Phone className="w-4 h-4" />
                              </a>
                              <a
                                href={waLink(o.buyer_phone, funnelWaMessage(o))}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="WhatsApp"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                              >
                                <MessageCircle className="w-4 h-4" />
                              </a>
                            </span>
                          )}
                        </p>
                        {/* What they'd typed before leaving — makes an
                            abandoned checkout actionable rather than a dead row. */}
                        {!o.address_line1 && (
                          <p className="text-amber-600 text-[11px] mt-0.5">no address</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${STAGE_BADGE[s]}`}>
                          {STAGE_LABELS[s]}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {isTrafficSource(o.source) && (
                          <>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${SOURCE_BADGE[o.source]}`}>
                              {SOURCE_LABELS[o.source]}
                            </span>
                            {/* Which reel / post, when the link was tagged. */}
                            {o.utm_campaign && (
                              <p className="text-neutral-400 text-[11px] mt-0.5 truncate max-w-[120px]" title={o.utm_campaign}>
                                {o.utm_campaign}
                              </p>
                            )}
                          </>
                        )}
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
    </>
  );
}
