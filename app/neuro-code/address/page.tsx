import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyOrderToken } from "@/lib/order-token";
import AddressForm from "./AddressForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Delivery address",
  robots: { index: false, follow: false },
};

export default async function AddressPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; t?: string }>;
}) {
  const { id, t } = await searchParams;
  if (!id) redirect("/neuro-code");

  // The link is the only credential here, so the token has to check out before
  // we reveal or accept anything about this order.
  if (!verifyOrderToken(id, t)) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-bold mb-2">This link isn&apos;t valid</h1>
          <p className="text-neutral-400 text-sm mb-6">
            Please use the link from your WhatsApp confirmation, or contact us
            with your order number.
          </p>
          <Link href="/neuro-code" className="px-6 py-3 rounded-full bg-primary-500 text-white text-sm font-bold">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "order_number, buyer_name, address_line1, address_line2, city, district, state, pincode, payment_status"
    )
    .eq("order_number", id)
    .maybeSingle();

  if (!order) redirect("/neuro-code");

  // Already submitted — don't show an editable form as if nothing happened.
  if (order.address_line1) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">We already have your address</h1>
          <p className="text-neutral-400 text-sm mb-1">
            {order.address_line1}
            {order.address_line2 ? `, ${order.address_line2}` : ""}
          </p>
          <p className="text-neutral-400 text-sm mb-6">
            {order.city}, {order.state} — {order.pincode}
          </p>
          <Link
            href={`/neuro-code/track?id=${order.order_number}`}
            className="px-6 py-3 rounded-full bg-primary-500 text-white text-sm font-bold"
          >
            Track your order
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AddressForm
      orderNumber={order.order_number}
      token={t!}
      initial={{
        name: order.buyer_name,
        address1: order.address_line1,
        address2: order.address_line2,
        city: order.city,
        district: order.district,
        state: order.state,
        pincode: order.pincode,
      }}
    />
  );
}
