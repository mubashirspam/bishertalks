import Link from "@/components/admin/AdminLink";
import { AlertCircle, Phone, MessageCircle, ArrowRight, Gift, PenLine, Plus } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { orderStage, STAGE_LABELS, STAGE_BADGE } from "@/lib/order-stage";
import { formatISTShort, timeAgo } from "@/lib/format-date";
import { SOURCE_LABELS, SOURCE_BADGE, isTrafficSource } from "@/lib/attribution";
import { funnelWaMessage, waLink, telLink } from "@/lib/wa-message";
import OrderFilters from "./OrderFilters";
import FollowUpCell from "./FollowUpCell";
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
  followUp?: string;
  books?: string;
  /** "online" | "manual" | undefined for both (0061). */
  channel?: string;
  pageNum: number;
}
import { requirePageAccess } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const PER_PAGE = 20;

interface Row {
  id: string;
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  amount_paise: number;
  quantity: number;
  is_gift: boolean;
  is_signed: boolean;
  payment_status: string;
  /** Sent back through Razorpay (0055). 0 on every order never refunded. */
  refunded_paise: number;
  address_line1: string | null;
  razorpay_order_id: string | null;
  /** "online" | "manual" (0061). Direct sales are badged in the table. */
  sales_channel: string | null;
  city: string | null;
  state: string | null;
  created_at: string;
  ordered_at: string;
  source: string | null;
  utm_campaign: string | null;
  follow_up_status: string | null;
  follow_up_at: string | null;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string; q?: string; page?: string; from?: string; to?: string;
    source?: string;
    followUp?: string;
    books?: string;
    channel?: string;
  }>;
}) {
  // Cached per request and shared with the layout, so this no longer costs a
  // second round trip to Supabase auth.
  const staff = await requirePageAccess("orders.view");

  const { stage, q, page = "1", from, to, source, followUp, books, channel } =
    await searchParams;
  const pageNum = Math.max(0, parseInt(page) - 1);

  // Nothing is awaited past this point: the shell renders now and the two
  // sections below stream in when the (single, shared) query resolves.
  const queryArgs: QueryArgs = {
    stage, q, from, to, source, followUp, books, channel, pageNum,
  };

  return (
    <NavigationPending>
      {/* Heading is rendered by the top bar (components/admin/PageTitle), not
          here — see the layout. */}

      {/* Filters render immediately — they need no data, so making them wait
          for the query was pure delay. The row count is streamed into them. */}
      {/* The page itself refuses without `orders.create` — this only stops
          offering a button that leads to a redirect. */}
      {can(staff, "orders.create") && (
        <div className="flex justify-end mb-3">
          <Link
            href="/admin/orders/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            <Plus className="w-4 h-4" />
            Add direct sale
          </Link>
        </div>
      )}

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
    props.stage, props.q, props.from, props.to, props.source, props.followUp, props.books,
    props.channel, props.pageNum, PER_PAGE
  );
  const filtered =
    !!props.stage || !!props.q || !!props.from || !!props.to || !!props.source ||
    !!props.followUp || !!props.books || !!props.channel;

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
    props.stage, props.q, props.from, props.to, props.source, props.followUp, props.books,
    props.channel, props.pageNum, PER_PAGE
  );
  const orders = rows as unknown as Row[];
  const pageNum = props.pageNum;
  const totalPages = Math.ceil(count / PER_PAGE);

  /**
   * Page links carry every active filter.
   *
   * They used to rebuild the URL from stage and q alone, so paging out of a
   * filtered view silently dropped the date range, source and follow-up
   * filters — page 2 of "failed orders this week" was page 2 of everything.
   * Built from the same args the query ran with, so a new filter can't be
   * forgotten here again.
   */
  const pageLink = (p: number) => {
    const sp = new URLSearchParams();
    if (props.stage) sp.set("stage", props.stage);
    if (props.q) sp.set("q", props.q);
    if (props.from) sp.set("from", props.from);
    if (props.to) sp.set("to", props.to);
    if (props.source) sp.set("source", props.source);
    if (props.followUp) sp.set("followUp", props.followUp);
    if (props.books) sp.set("books", props.books);
    if (props.channel) sp.set("channel", props.channel);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };

  return (
    <>

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
                  {([
                    { label: "Order" },
                    { label: "Customer" },
                    { label: "Stage" },
                    { label: "Follow-up" },
                    { label: "Came from", narrow: true },
                    { label: "Amount", narrow: true },
                    // ordered_at (0043), not created_at. This used to be
                    // labelled "Started" because created_at is when checkout
                    // began — a lead that paid three days later kept the day it
                    // started, which made the panel look like it disagreed with
                    // Razorpay. It is the payment date now, and the column can
                    // honestly be called what everyone was already reading it as.
                    {
                      label: "Ordered",
                      title:
                        "When the order was confirmed — the day the money landed. For a lead that never paid, the day checkout began.",
                    },
                    { label: "", key: "view" },
                  ] as { label: string; narrow?: boolean; key?: string; title?: string }[]).map((h) => (
                    <th
                      key={h.key ?? h.label}
                      title={h.title}
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
                        {/* On the order number rather than beside the amount:
                            this decides how the parcel is packed, so it has to
                            be visible on the narrow view where the money
                            column is hidden. */}
                        {o.is_gift && (
                          <span
                            title="Gift — wrap and write the card"
                            className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-200 text-[10px] font-bold align-middle"
                          >
                            <Gift className="w-2.5 h-2.5" /> Gift
                          </span>
                        )}
                        {o.is_signed && (
                          <span
                            title="Signed — every copy signed before wrapping"
                            className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold align-middle"
                          >
                            <PenLine className="w-2.5 h-2.5" /> Signed
                          </span>
                        )}
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
                      <td className="px-4 py-3">
                        {o.payment_status === "paid" ? (
                          <span className="text-neutral-300 text-xs">—</span>
                        ) : (
                          <FollowUpCell
                            orderNumber={o.order_number}
                            status={o.follow_up_status}
                            followedAt={o.follow_up_at}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {/* Where the money came from, which is not where the
                            CUSTOMER came from — both can be true at once, so
                            this sits above the attribution badge rather than
                            replacing it. */}
                        {o.sales_channel === "manual" && (
                          <span className="inline-flex px-2 py-0.5 mb-1 rounded-full text-[11px] font-medium border border-dashed border-neutral-400 bg-neutral-50 text-neutral-600 whitespace-nowrap">
                            Direct sale
                          </span>
                        )}
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
                        {/* Struck through once money went back, with what was
                            actually kept beside it. A refunded order is not
                            removed from this list — it happened, and the row is
                            how anyone finds it again. */}
                        {(o.refunded_paise ?? 0) > 0 ? (
                          <p className="flex items-baseline gap-1.5 whitespace-nowrap">
                            <span className="line-through text-neutral-400">
                              ₹{Math.round((o.amount_paise ?? 0) / 100)}
                            </span>
                            <span className="font-bold">
                              ₹{Math.round(((o.amount_paise ?? 0) - o.refunded_paise) / 100)}
                            </span>
                          </p>
                        ) : (
                          <p>₹{Math.round((o.amount_paise ?? 0) / 100)}</p>
                        )}
                        {(o.refunded_paise ?? 0) > 0 && (
                          <span className="inline-flex mt-0.5 px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] font-semibold whitespace-nowrap">
                            {o.refunded_paise >= (o.amount_paise ?? 0)
                              ? "refunded"
                              : `−₹${Math.round(o.refunded_paise / 100)} refunded`}
                          </span>
                        )}
                        {/* How many copies that ₹ actually is. Without it a
                            ₹2,097 row looks like a pricing bug rather than
                            three books, and the multi-copy buyers — the ones
                            worth calling — are invisible in the list. */}
                        {(o.quantity ?? 1) > 1 ? (
                          <span className="inline-flex mt-0.5 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold whitespace-nowrap">
                            {o.quantity} books
                          </span>
                        ) : (
                          <span className="text-neutral-400 text-[11px]">1 book</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <p className="text-neutral-700 font-medium">
                          {formatISTShort(o.ordered_at)}
                        </p>
                        <p className="text-neutral-400 mt-0.5">
                          {timeAgo(o.ordered_at)}
                        </p>
                      </td>
                      <td className="pl-1 pr-3 py-3">
                        <Link
                          href={`/admin/orders/${o.order_number}`}
                          title="View details"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary-50 text-primary-600 hover:bg-primary-100 hover:translate-x-0.5 transition-all"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Link>
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
              <Link href={pageLink(pageNum)} className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all">
                ← Prev
              </Link>
            )}
            {pageNum + 1 < totalPages && (
              <Link href={pageLink(pageNum + 2)} className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 text-sm hover:border-neutral-300 transition-all">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
