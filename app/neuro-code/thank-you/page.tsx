import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Package, Home, Share2 } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types/order";

async function getOrder(id: string): Promise<Order | null> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("order_number", id)
    .single();
  return data;
}

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id) redirect("/neuro-code");

  const order = await getOrder(id);
  if (!order) redirect("/neuro-code");

  const amount = Math.round(order.amount_paise / 100);
  const date = new Date(order.created_at).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        {/* Success icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-green-400" />
          </div>
        </div>

        <h1 className="text-3xl font-black text-center mb-2">Thank You! 🎉</h1>
        <p className="text-neutral-400 text-center mb-8">
          Your order is confirmed. You&apos;ll receive a WhatsApp update shortly at{" "}
          <span className="text-white">+91 {order.buyer_phone}</span>.
        </p>

        {/* Order details */}
        <div className="bg-neutral-900 border border-white/8 rounded-2xl p-6 mb-6 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Order Number</span>
            <span className="text-white font-bold font-mono">{order.order_number}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Date</span>
            <span className="text-white">{date}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Amount Paid</span>
            <span className="text-primary-400 font-bold">₹{amount}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-400">Delivering to</span>
            <span className="text-white">{order.city}, {order.state}</span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-white/8">
            <span className="text-neutral-400">Est. Delivery</span>
            <span className="text-green-400 font-medium">5–7 business days</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Link
            href={`/neuro-code/track?id=${order.order_number}`}
            className="flex items-center justify-center gap-2 py-3.5 rounded-full bg-primary-500 hover:bg-primary-400 text-white font-bold transition-all"
          >
            <Package className="w-4 h-4" /> Track Your Order
          </Link>
          <Link
            href="/"
            className="flex items-center justify-center gap-2 py-3.5 rounded-full border border-white/20 hover:border-white/40 text-white font-medium transition-all"
          >
            <Home className="w-4 h-4" /> Back to Home
          </Link>
        </div>

        {/* Share */}
        <div className="mt-6 bg-neutral-900 border border-white/8 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Share with friends</p>
            <p className="text-neutral-500 text-xs">Spread the knowledge 📖</p>
          </div>
          <button
            onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/neuro-code`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-sm transition-all"
          >
            <Share2 className="w-3.5 h-3.5" /> Copy Link
          </button>
        </div>
      </div>
    </div>
  );
}
