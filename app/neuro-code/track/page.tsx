import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Circle, Package, Truck, Home, MapPin } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  STATUS_LABELS,
  STATUS_STEPS,
  type Order,
  type OrderStatus,
} from "@/lib/types/order";
import ReferralShare from "@/components/ReferralShare";
import { ensureReferrerForOrder, getReferralSettings } from "@/lib/db/referrals";

async function getOrder(id: string): Promise<Order | null> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select(
      `order_number, buyer_name, city, state, status, payment_status,
       amount_paise, tracking_number, courier_name, expected_delivery,
       created_at, address_line1, address_line2, pincode,
       label_downloaded_at, shipped_at, delivered_at`
    )
    .eq("order_number", id)
    .single();
  return data as Order | null;
}

const STEP_ICONS = [Package, Package, Truck, Truck, Home];

/** Share block data, or null. Never throws — see the thank-you page. */
async function getReferralBlock(orderNumber: string) {
  try {
    const settings = await getReferralSettings();
    if (!settings.is_enabled) return null;

    const referrer = await ensureReferrerForOrder(orderNumber);
    if (!referrer) return null;

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
    confirmed: order.created_at,
    processing: order.label_downloaded_at,
    shipped: order.shipped_at,
    out_for_delivery: null,
    delivered: order.delivered_at,
    cancelled: null,
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
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id) redirect("/neuro-code");

  const order = await getOrder(id);
  if (!order) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="text-center">
          <Package className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Order Not Found</h1>
          <p className="text-neutral-400 text-sm mb-6">
            We couldn&apos;t find order <strong>{id}</strong>. Check your order number and try again.
          </p>
          <Link href="/neuro-code" className="px-6 py-3 rounded-full bg-primary-500 text-white text-sm font-bold">
            Back to Book
          </Link>
        </div>
      </div>
    );
  }

  const currentStep = STATUS_STEPS.indexOf(order.status as OrderStatus);
  const isCancelled = order.status === "cancelled";
  const dates = stepDates(order);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com";
  const referral = await getReferralBlock(order.order_number);

  const date = new Date(order.created_at).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/neuro-code" className="text-neutral-400 hover:text-white text-sm transition-colors">
            ← Neuro Code
          </Link>
          <h1 className="text-2xl font-black mt-3">Track Order</h1>
          <p className="text-neutral-400 text-sm font-mono mt-1">{order.order_number}</p>
        </div>

        {/* Status Stepper */}
        <div className="bg-neutral-900 border border-white/8 rounded-2xl p-6 mb-5">
          <h2 className="font-semibold text-sm text-neutral-300 mb-6">Order Status</h2>
          {isCancelled ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
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
                            : "bg-neutral-800 text-neutral-600"
                          }
                          ${isActive ? "ring-2 ring-primary-400 ring-offset-2 ring-offset-neutral-900" : ""}
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
                        <div className={`w-0.5 h-8 my-1 ${i < currentStep ? "bg-primary-500" : "bg-neutral-800"}`} />
                      )}
                    </div>
                    {/* Label */}
                    <div className="pb-6 last:pb-0 flex-1">
                      <p className={`text-sm font-medium ${isDone ? "text-white" : "text-neutral-600"}`}>
                        {STATUS_LABELS[step]}
                      </p>
                      {isDone && dates[step] && (
                        <p className="text-neutral-500 text-xs mt-0.5">
                          {stepStamp(dates[step]!)}
                        </p>
                      )}
                      {isActive && (
                        <p className="text-primary-400 text-xs mt-0.5">Current Status</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Shipping info (if shipped+) */}
        {(order.tracking_number || order.courier_name) && (
          <div className="bg-neutral-900 border border-white/8 rounded-2xl p-6 mb-5">
            <h2 className="font-semibold text-sm text-neutral-300 mb-4 flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary-400" /> Shipping Details
            </h2>
            <div className="space-y-3 text-sm">
              {order.courier_name && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Courier</span>
                  <span className="text-white">{order.courier_name}</span>
                </div>
              )}
              {order.tracking_number && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Tracking #</span>
                  <span className="text-white font-mono">{order.tracking_number}</span>
                </div>
              )}
              {order.expected_delivery && (
                <div className="flex justify-between">
                  <span className="text-neutral-400">Expected</span>
                  <span className="text-green-400 font-medium">
                    {new Date(order.expected_delivery).toLocaleDateString("en-IN", {
                      day: "numeric", month: "long",
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Order details */}
        <div className="bg-neutral-900 border border-white/8 rounded-2xl p-6 mb-5">
          <h2 className="font-semibold text-sm text-neutral-300 mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-primary-400" /> Order Details
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">Book</span>
              <span className="text-white">Neuro Code by Bisher KC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Amount Paid</span>
              <span className="text-primary-400 font-bold">₹{Math.round(order.amount_paise / 100)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Order Date</span>
              <span className="text-white">{date}</span>
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
        <div className="bg-neutral-900 border border-white/8 rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Need help?</p>
            <p className="text-neutral-500 text-xs mt-0.5">We&apos;re here to assist you</p>
          </div>
          <a
            href={`https://wa.me/916282680794?text=Hi, I need help with order ${order.order_number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-all"
          >
            <MapPin className="w-3.5 h-3.5" /> WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
