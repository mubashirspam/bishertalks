"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, X, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { formatIST } from "@/lib/format-date";
import { fullAddressLines } from "@/lib/address";
import { STATUS_LABELS, STATUS_BADGE, type Order, type OrderStatus } from "@/lib/types/order";

/**
 * A quick look at an order from inside a conversation.
 *
 * Before this, the order id in the corner was a `<Link>` — one click and the
 * whole conversation was gone, swapped for the order screen in another tree.
 * Coming back meant losing the composer's draft and the scroll position. A
 * popup answers the question ("what's the status, what did they order")
 * without leaving the thread; "Open full page" is still here for whoever
 * actually needs to edit the order.
 */
export default function OrderPeekModal({
  orderNumber,
}: {
  orderNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || order || loading) return;
    setLoading(true);
    setError(null);
    fetch(`/api/orders/${orderNumber}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data: Order) => setOrder(data))
      .catch(() => setError("Could not load this order."))
      .finally(() => setLoading(false));
  }, [open, order, loading, orderNumber]);

  // Esc closes it, same as any other modal on this admin.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-primary-700 transition hover:border-primary-300 hover:bg-primary-50"
      >
        <Package className="h-3.5 w-3.5" /> {orderNumber}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="flex items-center gap-1.5 font-mono text-sm font-bold text-neutral-900">
                <Package className="h-4 w-4 text-primary-500" /> {orderNumber}
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded p-1 text-neutral-400 hover:text-neutral-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              {loading && (
                <div className="flex items-center justify-center py-8 text-neutral-300">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}

              {error && (
                <p className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
                </p>
              )}

              {order && (
                <div className="space-y-3 text-sm">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[order.status as OrderStatus]}`}
                  >
                    {STATUS_LABELS[order.status as OrderStatus]}
                  </span>

                  <div className="space-y-1.5">
                    <Row label="Buyer" value={order.buyer_name} />
                    <Row
                      label="Phone"
                      value={order.buyer_phone ? `+91 ${order.buyer_phone}` : null}
                    />
                    <Row
                      label="Amount"
                      value={`₹${Math.round(order.amount_paise / 100).toLocaleString("en-IN")}`}
                    />
                    {order.quantity > 1 && <Row label="Books" value={`× ${order.quantity}`} />}
                    <Row label="Ordered" value={order.ordered_at ? formatIST(order.ordered_at) : null} />
                    <Row label="Courier" value={order.courier_name} />
                    <Row label="Tracking no." value={order.tracking_number} mono />
                  </div>

                  {order.address_line1 && (
                    <div className="border-t border-neutral-100 pt-3 text-xs leading-relaxed text-neutral-600">
                      {fullAddressLines(order).map((l, i) => (
                        <span key={i} className="block">
                          {l}
                        </span>
                      ))}
                    </div>
                  )}

                  <Link
                    href={`/admin/orders/${orderNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open full order page
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-neutral-500">{label}</span>
      <span className={`text-right text-neutral-900 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}
