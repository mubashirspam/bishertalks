import Link from "@/components/admin/AdminLink";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/admin-auth";
import { getProductPricing } from "@/lib/db/courses";
import DirectSaleForm from "./DirectSaleForm";

export const dynamic = "force-dynamic";

/**
 * Add a book that was sold directly.
 *
 * `orders.edit` rather than `orders.view`: this writes a paid order, which is
 * the same authority as changing one, and a long way from being allowed to
 * look at the list.
 */
export default async function NewDirectSalePage() {
  await requirePageAccess("orders.edit");

  // The same resolver the checkout charges from — offer price and any
  // scheduled price change included — so the figure this form suggests is the
  // one the shop is actually selling at today.
  const pricing = await getProductPricing();

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Orders
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-black">Add a direct sale</h1>
        <p className="text-sm text-neutral-500 mt-1.5 max-w-prose">
          For a book paid for by QR code, UPI, cash or bank transfer, with the address
          sent over WhatsApp. It becomes a normal parcel — routed, labelled, handed over
          and tracked like any other — while its money is reported separately from the
          Razorpay totals.
        </p>
      </div>

      <DirectSaleForm unitPrice={pricing.payable} />
    </div>
  );
}
