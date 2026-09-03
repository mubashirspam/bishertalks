import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Circle, Package, Truck, Home, MapPin, ExternalLink } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  STATUS_LABELS,
  STATUS_STEPS,
  type Order,
  type OrderStatus,
} from "@/lib/types/order";
import { getCourier } from "@/lib/db/couriers";
import { publicTracking } from "@/lib/couriers";
import ReferralShare from "@/components/ReferralShare";
import { getReferrerForOrder, getReferralSettings } from "@/lib/db/referrals";
import OrderDetails, { type DetailsOrder } from "./OrderDetails";
import ArticleNumber from "./ArticleNumber";

/** The course that comes with the book. Same pair lib/notify.ts sends. */
const BONUS_COURSE = { title: "Neuro Linguistic Programming", slug: "nlp" };

async function getOrder(id: string): Promise<Order | null> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      `order_number, buyer_name, city, state, status, payment_status,
       amount_paise, tracking_number, courier_name, courier_id, expected_delivery,
       created_at, ordered_at, address_line1, address_line2, pincode,
       label_downloaded_at, shipped_at, delivered_at, returned_at,
       postal_barcode, courier_entered_at`
    )
    .eq("order_number", id)
    .single();
  return data as Order | null;
}

/**
 * The same order, with the fields only the details view shows.
 *
 * A separate read rather than widening getOrder(): the tracking view is opened
 * repeatedly while a parcel is in transit and has no use for an address it
 * already knows or a gift flag it never renders.
 */
async function getOrderDetails(id: string): Promise<DetailsOrder | null> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      `order_number, buyer_name, buyer_phone, address_line1, address_line2,
       city, district, state, pincode, amount_paise, quantity, is_gift,
       is_signed, payment_status, status, ordered_at`
    )
    .eq("order_number", id)
    .single();
  return (data as DetailsOrder | null) ?? null;
}

const STEP_ICONS = [Package, Package, Truck, Truck, Home];

/** Share block data, or null. Never throws — see the thank-you page. */
async function getReferralBlock(orderNumber: string) {
  try {
    const settings = await getReferralSettings();
    if (!settings.is_enabled) return null;

    // Look-up only. Referrers are added by hand in admin, so most buyers
    // have no code and simply don't see this block.
    const referrer = await getReferrerForOrder(orderNumber);
    if (!referrer || !referrer.is_active) return null;

    return {
      code: referrer.code,
      discountRupees: settings.referee_discount_rupees,
      commissionRupees:
        referrer.commission_type === "flat"
          ? referrer.commission_value
          : settings.customer_commission_rupees,
    };
  } catch {
    return null;
  }
}

/**
 * When each step happened. Undated steps simply show nothing — better than a
 * placeholder, and the only ones without their own timestamp are the two we
 * can't date honestly (out for delivery shares the shipping date, which would
 * be misleading).
 */
function stepDates(order: Order): Record<OrderStatus, string | null> {
  return {
    // ordered_at, not created_at: "Order Confirmed" is a payment event, and a
    // customer who abandoned checkout on Monday and paid on Friday should not
    // be told their order was confirmed on Monday.
    confirmed: order.ordered_at,
    // The print, or failing that the moment the parcel went onto a courier's
    // file. A Speed Post parcel is never printed from the master queue — its
    // batch is confirmed straight onto a booking sheet — so reading only
    // `label_downloaded_at` left the step it has demonstrably reached undated.
    processing: order.label_downloaded_at ?? order.courier_entered_at,
    shipped: order.shipped_at,
    out_for_delivery: null,
    delivered: order.delivered_at,
    cancelled: null,
    returned: order.returned_at,
  };
}

/** e.g. "5 Aug, 9:40 pm" */
function stepStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; view?: string }>;
}) {
  const { id, view } = await searchParams;
  if (!id) redirect("/neuro-code");

  // `?view=details` is the second button on the order confirmation. It used to
  // resolve here — the parameter existed only so the template's two buttons
  // had different URLs, which Meta requires — and both landed on the same
  // page, which made one of the two buttons a lie.
  if (view === "details") {
    const details = await getOrderDetails(id);
    if (details) {
      return (
        <OrderDetails
          order={details}
          courseTitle={BONUS_COURSE.title}
          courseUrl={`${process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com"}/courses/${BONUS_COURSE.slug}`}
        />
      );
    }
    // No order under that number: fall through to the not-found card below
    // rather than inventing a second one that says the same thing.
  }

  const order = await getOrder(id);
  if (!order) {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-white flex items-center justify-center px-4">
        <div className="text-center">
          <Package className="w-12 h-12 text-neutral-400 dark:text-neutral-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Order Not Found</h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-6">
            We couldn&apos;t find order <strong>{id}</strong>. Check your order number and try again.
          </p>
          <Link href="/neuro-code" className="px-6 py-3 rounded-full bg-primary-500 text-white text-sm font-bold">
            Back to Book
          </Link>
        </div>
      </div>
    );
  }

  // How far the stepper has come.
  //
  // Normally the status decides, and for a Delhivery parcel it is the whole
  // answer — their scans walk the order through the queue on their own.
  //
  // India Post has no such feed here, so a posted parcel can sit at
  // 'confirmed' for its whole journey and the stepper shows step one of five:
  // a page telling a customer nothing has happened since they paid, about a
  // parcel already in the postal system. `courier_entered_at` is the fact that
  // fixes it — the agent recorded this parcel onto the courier's file, which
  // is packed and handed over however the status column reads.
  //
  // It advances to Packed and no further, deliberately. Being on a booking
  // file is not the same as the post office having accepted it, and "Shipped"
  // is a claim only a real handover or a scan should make.
  const statusStep = STATUS_STEPS.indexOf(order.status as OrderStatus);
  const packedStep = STATUS_STEPS.indexOf("processing");
  const currentStep =
    order.courier_entered_at && statusStep < packedStep && statusStep >= 0
      ? packedStep
      : statusStep;
  const isCancelled = order.status === "cancelled";
  const dates = stepDates(order);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";
  const referral = await getReferralBlock(order.order_number);

  // The courier's own page, for the buyer who wants every hop rather than the
  // five steps we keep. Resolved through courier_id and never the free-text
  // courier name: that field is whatever an admin typed, and guessing a partner
  // from it would hand someone a link that 404s at the worst possible moment.
  // getCourier returns null on a database that has not had 0030 applied, which
  // costs the link and nothing else.
  const courier = order.courier_id ? await getCourier(order.courier_id) : null;
  const courierTracking = publicTracking(courier, order.tracking_number);

  // ── The India Post case ──────────────────────────────────────────────────
  //
  // These parcels used to show the customer nothing at all. The shipping card
  // below was gated on `tracking_number || courier_name`, and a Speed Post
  // parcel has neither: the number it carries is an *article* number in its
  // own column, and nobody types a courier name for a parcel the system
  // routed. So a paid, labelled, posted parcel rendered as "Order Confirmed"
  // and four grey steps — a page that reads as though nothing has happened
  // since the money left, which is exactly the message it should not send.
  //
  // The number alone is not the fix, because an allotted article number is not
  // yet a trackable one. It is minted from our own stock before the parcel is
  // handed over, so between allotment and posting it looks up to nothing on
  // India Post's site. Showing it as "track this" during that window trades
  // one confusion for a worse one — the customer tries it, gets "no
  // information", and now distrusts the number as well as the page.
  //
  // So the two states are told apart, and the parcel being *with* India Post
  // is what separates them: the agent's Confirmed tick, or any status from
  // shipped onwards.
  const isPostal = courier?.config.tracking === "india-post";
  const postalNumber = isPostal ? order.postal_barcode?.trim() || null : null;
  const postalPosted =
    !!order.courier_entered_at ||
    ["shipped", "out_for_delivery", "delivered", "returned"].includes(order.status);

  // The carrier's number for this parcel, whatever kind it is. India Post's
  // article number stands in where no waybill has been recorded, which is
  // every postal parcel until one is.
  const parcelNumber = order.tracking_number?.trim() || postalNumber;
  const numberLabel = postalNumber && !order.tracking_number ? "Article no." : "Tracking #";

  // A routed parcel always has something worth saying, even before a number
  // exists — at minimum which courier is carrying it.
  const showShipping = !!(parcelNumber || order.courier_name || courier);
  const courierLabel = courier?.name || order.courier_name;

  // The order date the customer will check against their bank statement.
  const date = new Date(order.ordered_at).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/neuro-code" className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white text-sm transition-colors">
            ← Neuro Code
          </Link>
          <h1 className="text-2xl font-black mt-3">Track Order</h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm font-mono mt-1">{order.order_number}</p>
        </div>

        {/* Status Stepper */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 mb-5 shadow-sm dark:shadow-none">
          <h2 className="font-semibold text-sm text-neutral-700 dark:text-neutral-300 mb-6">Order Status</h2>
          {isCancelled ? (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-4 text-red-700 dark:text-red-400 text-sm">
              This order has been cancelled.
            </div>
          ) : (
            <div className="space-y-0">
              {STATUS_STEPS.map((step, i) => {
                const Icon = STEP_ICONS[i];
                const isDone = i <= currentStep;
                const isActive = i === currentStep;
                const isLast = i === STATUS_STEPS.length - 1;

                return (
                  <div key={step} className="flex gap-4">
                    {/* Line + icon */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all
                          ${isDone
                            ? "bg-primary-500 text-white"
                            : "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-600"
                          }
                          ${isActive ? "ring-2 ring-primary-400 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900" : ""}
                        `}
                      >
                        {isDone && !isActive ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : isDone ? (
                          <Icon className="w-4 h-4" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </div>
                      {!isLast && (
                        <div className={`w-0.5 h-8 my-1 ${i < currentStep ? "bg-primary-500" : "bg-neutral-200 dark:bg-neutral-800"}`} />
                      )}
                    </div>
                    {/* Label */}
                    <div className="pb-6 last:pb-0 flex-1">
                      <p className={`text-sm font-medium ${isDone ? "text-neutral-900 dark:text-white" : "text-neutral-400 dark:text-neutral-600"}`}>
                        {STATUS_LABELS[step]}
                      </p>
                      {isDone && dates[step] && (
                        <p className="text-neutral-500 dark:text-neutral-500 text-xs mt-0.5">
                          {stepStamp(dates[step]!)}
                        </p>
                      )}
                      {isActive && (
                        <p className="text-primary-600 dark:text-primary-400 text-xs mt-0.5">Current Status</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Who is carrying it, and under what number */}
        {showShipping && (
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 mb-5 shadow-sm dark:shadow-none">
            <h2 className="font-semibold text-sm text-neutral-700 dark:text-neutral-300 mb-4 flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary-600 dark:text-primary-400" /> Shipping Details
            </h2>
            <div className="space-y-3 text-sm">
              {courierLabel && (
                <div className="flex justify-between">
                  <span className="text-neutral-500 dark:text-neutral-400">Courier</span>
                  <span className="text-neutral-900 dark:text-white">{courierLabel}</span>
                </div>
              )}
              {parcelNumber && (
                <div className="flex justify-between gap-3">
                  <span className="text-neutral-500 dark:text-neutral-400">{numberLabel}</span>
                  {/* Copyable, because tracking an India Post parcel means
                      typing this into their site by hand — see ArticleNumber. */}
                  <ArticleNumber value={parcelNumber} />
                </div>
              )}
              {order.expected_delivery && (
                <div className="flex justify-between">
                  <span className="text-neutral-500 dark:text-neutral-400">Expected</span>
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {new Date(order.expected_delivery).toLocaleDateString("en-IN", {
                      day: "numeric", month: "long",
                    })}
                  </span>
                </div>
              )}
            </div>

            {/* ── India Post, in plain words ──────────────────────────────
                The confusion this page created was never really about a
                missing number. It was silence: a customer whose parcel had
                genuinely been posted saw a stepper stuck on "Order Confirmed"
                and concluded nothing had happened. What ends that is saying
                what is true — where the parcel is, and why this page will not
                move on its own the way a Delhivery one does.

                No link is offered. India Post publish no address that carries
                a consignment number into their form — it is typed, behind a
                CAPTCHA — so a button would land people on a blank page having
                promised them their parcel. The number and where to type it is
                the honest version, and the copy button is what makes it work. */}
            {isPostal && (
              <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
                {postalPosted ? (
                  <>
                    <p className="text-amber-900 dark:text-amber-300 text-sm font-semibold">
                      Your parcel is with India Post.
                    </p>
                    <p className="text-amber-800 dark:text-amber-200/80 text-xs mt-1.5 leading-relaxed">
                      India Post don&apos;t send us live updates the way a
                      courier does, so the steps above move only when we hear
                      something. To see exactly where it is right now, copy the
                      article number above and track it at{" "}
                      <span className="font-semibold">indiapost.gov.in</span> →
                      Track Consignment.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-amber-900 dark:text-amber-300 text-sm font-semibold">
                      Being prepared for India Post.
                    </p>
                    <p className="text-amber-800 dark:text-amber-200/80 text-xs mt-1.5 leading-relaxed">
                      {postalNumber
                        ? "Your parcel has its article number and is being packed. " +
                          "The number starts working on India Post's website once " +
                          "the parcel is handed over at the post office — we'll " +
                          "message you on WhatsApp when that happens."
                        : "Your parcel is being packed and will go out by India Post. " +
                          "We'll message you on WhatsApp with the article number " +
                          "once it has been posted."}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Straight to the courier, where every scan lives. Ours is the
                summary; theirs answers "which city is it in right now". */}
            {courierTracking && (
              <a
                href={courierTracking.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/25 text-primary-700 dark:text-primary-400 text-sm font-semibold hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-all"
              >
                Live tracking on {courierTracking.name}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        {/* Order details */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-6 mb-5 shadow-sm dark:shadow-none">
          <h2 className="font-semibold text-sm text-neutral-700 dark:text-neutral-300 mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-primary-600 dark:text-primary-400" /> Order Details
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">Book</span>
              <span className="text-neutral-900 dark:text-white">Neuro Code by Bisher KC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">Amount Paid</span>
              <span className="text-primary-600 dark:text-primary-400 font-bold">₹{Math.round(order.amount_paise / 100)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">Order Date</span>
              <span className="text-neutral-900 dark:text-white">{date}</span>
            </div>
          </div>
        </div>

        {/* Referral — the tracking page gets opened repeatedly while a parcel
            is in transit, which makes it the best repeat surface for sharing. */}
        {referral && (
          <div className="mb-5">
            <ReferralShare
              code={referral.code}
              appUrl={appUrl}
              discountRupees={referral.discountRupees}
              commissionRupees={referral.commissionRupees}
              compact
            />
          </div>
        )}

        {/* Help */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 rounded-2xl p-5 shadow-sm dark:shadow-none flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Need help?</p>
            <p className="text-neutral-500 dark:text-neutral-500 text-xs mt-0.5">We&apos;re here to assist you</p>
          </div>
          <a
            href={`https://wa.me/916282680794?text=Hi, I need help with order ${order.order_number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-500/20 transition-all"
          >
            <MapPin className="w-3.5 h-3.5" /> WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
