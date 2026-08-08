import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Package, Home, GraduationCap, MessageCircle } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types/order";
import { BOOK_BONUS_COURSE_SLUG } from "@/lib/types/db";
import CopyLinkButton from "./CopyLinkButton";

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

  // Support number for the WhatsApp button, with the order number pre-filled so
  // we know who's asking. Set NEXT_PUBLIC_SUPPORT_WHATSAPP to your real number.
  const support = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "916282680794")
    .replace(/\D/g, "");
  const whatsappHref = `https://wa.me/${support}?text=${encodeURIComponent(
    `Hi! I just placed order ${order.order_number} for Neuro Code.`
  )}`;
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

        {/* Bonus course — the thing they get instantly, so it leads */}
        <div className="bg-gradient-to-br from-primary-500/15 to-primary-600/5 border border-primary-500/30 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold bg-primary-500 text-white px-2 py-0.5 rounded-full">
              UNLOCKED
            </span>
            <p className="font-bold text-sm">Your free NLP course</p>
          </div>
          <p className="text-neutral-300 text-sm mb-4 leading-relaxed">
            Start straight away — no waiting for delivery. Sign in with the mobile
            number{" "}
            <span className="text-white font-medium">{order.buyer_phone}</span>.
          </p>
          <Link
            href={`/courses/${BOOK_BONUS_COURSE_SLUG}`}
            className="flex items-center justify-center gap-2 py-3.5 rounded-full bg-primary-500 hover:bg-primary-400 text-white font-bold transition-all w-full"
          >
            <GraduationCap className="w-4 h-4" /> Start Learning Now
          </Link>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold transition-all"
          >
            <MessageCircle className="w-4 h-4" /> Chat with us on WhatsApp
          </a>
          <Link
            href={`/neuro-code/track?id=${order.order_number}`}
            className="flex items-center justify-center gap-2 py-3.5 rounded-full border border-white/20 hover:border-white/40 text-white font-medium transition-all"
          >
            <Package className="w-4 h-4" /> Track Your Order
          </Link>
          <Link
            href="/"
            className="flex items-center justify-center gap-2 py-3.5 rounded-full text-neutral-400 hover:text-white font-medium transition-all"
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
          <CopyLinkButton />
        </div>
      </div>
    </div>
  );
}
