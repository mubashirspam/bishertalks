"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Package, Truck, MapPin, CreditCard, Phone, MessageCircle, History, Mail } from "lucide-react";
import { formatIST, timeAgo } from "@/lib/format-date";
import { describeAudit } from "@/lib/audit";
import {
  STATUS_LABELS,
  STATUS_STEPS,
  STATUS_BADGE,
  type Order,
  type OrderStatus,
} from "@/lib/types/order";
import { funnelWaMessage, deliveryWaMessage, waLink, telLink } from "@/lib/wa-message";

const ALL_STATUSES: OrderStatus[] = [
  "confirmed", "processing", "shipped", "out_for_delivery", "delivered", "cancelled",
];

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const [form, setForm] = useState({
    status: "" as OrderStatus,
    tracking_number: "",
    courier_name: "",
    expected_delivery: "",
    notes: "",
  });

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data: Order) => {
        setOrder(data);
        setForm({
          status: data.status,
          tracking_number: data.tracking_number ?? "",
          courier_name: data.courier_name ?? "",
          expected_delivery: data.expected_delivery ?? "",
          notes: data.notes ?? "",
        });
      })
      .catch(() => router.push("/admin/orders"))
      .finally(() => setLoading(false));
  }, [id, router]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/orders/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_number: id, ...form }),
    });
    if (res.ok) {
      const updated = await res.json();
      setOrder(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  const sendEmail = async () => {
    setEmailing(true);
    setEmailMsg(null);
    try {
      const res = await fetch("/api/admin/orders/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setEmailMsg({ text: "Confirmation emailed." });
        // Reflect the new sent timestamp without a full reload.
        const fresh = await fetch(`/api/orders/${id}`).then((r) => r.json());
        setOrder(fresh);
      } else {
        setEmailMsg({ text: json.error ?? "Could not send", bad: true });
      }
    } catch {
      setEmailMsg({ text: "Network error", bad: true });
    } finally {
      setEmailing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-500">
        Loading…
      </div>
    );
  }

  if (!order) return null;

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const inputCls =
    "w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-neutral-900 placeholder-neutral-400 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  const date = `${formatIST(order.created_at)} (${timeAgo(order.created_at)})`;

  const currentStep = STATUS_STEPS.indexOf(order.status as OrderStatus);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/orders" className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Orders
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="font-mono text-primary-600 text-sm">{id}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left col */}
        <div className="space-y-5">
          {/* Status stepper */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-sm text-neutral-700 mb-5 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary-500" /> Order Progress
            </h2>
            <div className="flex gap-1 flex-wrap mb-4">
              {STATUS_STEPS.map((step, i) => (
                <div
                  key={step}
                  className={`h-1.5 flex-1 rounded-full transition-all ${
                    i <= currentStep ? "bg-primary-500" : "bg-neutral-200"
                  }`}
                />
              ))}
            </div>
            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_BADGE[order.status as OrderStatus]}`}>
              {STATUS_LABELS[order.status as OrderStatus]}
            </span>

            {/* Whether the parcel label has been printed — the same signal the
                Delivery queue sorts on, so both screens agree. */}
            <div className="mt-4 pt-4 border-t border-neutral-100 text-xs">
              {order.label_downloaded_at ? (
                <p className="text-neutral-600">
                  Address label printed {formatIST(order.label_downloaded_at)}
                  {order.label_download_count > 1 &&
                    ` · ${order.label_download_count} times`}
                </p>
              ) : (
                <p className="text-neutral-400">
                  Address label not printed yet —{" "}
                  <Link href="/admin/delivery" className="text-primary-600 hover:underline">
                    Delivery queue
                  </Link>
                </p>
              )}
            </div>
          </div>

          {/* Buyer info */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-sm text-neutral-700 mb-4 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary-500" /> Buyer & Address
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-500">Name</span>
                <span className="text-neutral-900 font-medium">
                  {order.buyer_name ?? <span className="text-neutral-400">—</span>}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Phone</span>
                {order.buyer_phone ? (
                  <span className="flex items-center gap-2">
                    <span className="text-neutral-900">+91 {order.buyer_phone}</span>
                    <a
                      href={telLink(order.buyer_phone)}
                      title="Call"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <a
                      href={waLink(
                        order.buyer_phone,
                        order.payment_status === "paid" && order.address_line1
                          ? deliveryWaMessage(order)
                          : funnelWaMessage(order)
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="WhatsApp"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  </span>
                ) : (
                  <span className="text-neutral-400">—</span>
                )}
              </div>
              {order.buyer_email && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Email</span>
                  <span className="text-neutral-900">{order.buyer_email}</span>
                </div>
              )}
              <div className="pt-2 border-t border-neutral-200 text-neutral-600 leading-relaxed">
                {order.address_line1 ? (
                  <>
                    {order.address_line1}
                    {order.address_line2 && <>, {order.address_line2}</>}
                    <br />
                    {order.city}, {order.state} — {order.pincode}
                  </>
                ) : order.payment_status === "paid" ? (
                  // Paid but unshippable — the case that costs real money.
                  <span className="text-orange-600 font-medium">
                    Paid, but no delivery address yet — chase this customer.
                  </span>
                ) : (
                  <span className="text-neutral-400 italic">
                    No address yet — collected after payment
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Payment */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-sm text-neutral-700 mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary-500" /> Payment
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-500">Amount</span>
                <span className="text-primary-600 font-bold">₹{Math.round(order.amount_paise / 100)}</span>
              </div>
              {order.discount_paise > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Promo</span>
                  <span className="text-green-600">
                    {order.promo_code} (−₹{Math.round(order.discount_paise / 100)})
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-neutral-500">Status</span>
                <span className={order.payment_status === "paid" ? "text-green-600" : "text-amber-600"}>
                  {order.payment_status.charAt(0).toUpperCase() + order.payment_status.slice(1)}
                </span>
              </div>
              {order.razorpay_payment_id && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Payment ID</span>
                  <span className="text-neutral-900 font-mono text-xs">{order.razorpay_payment_id}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-neutral-500">Date</span>
                <span className="text-neutral-900">{date}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right col — Update form */}
        <div className="space-y-5">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-sm text-neutral-700 mb-5 flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary-500" /> Update Order
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-semibold block mb-1.5">Status</label>
                <select className={`${inputCls} appearance-none cursor-pointer`} value={form.status} onChange={set("status")}>
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-semibold block mb-1.5">Courier Name</label>
                <input className={inputCls} placeholder="e.g. Delhivery, Blue Dart" value={form.courier_name} onChange={set("courier_name")} />
              </div>

              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-semibold block mb-1.5">Tracking Number</label>
                <input className={inputCls} placeholder="Courier tracking ID" value={form.tracking_number} onChange={set("tracking_number")} />
              </div>

              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-semibold block mb-1.5">Expected Delivery</label>
                <input className={inputCls} type="date" value={form.expected_delivery} onChange={set("expected_delivery")} />
              </div>

              <div>
                <label className="text-xs text-neutral-500 uppercase tracking-wider font-semibold block mb-1.5">Internal Notes</label>
                <textarea
                  className={`${inputCls} resize-none`}
                  rows={3}
                  placeholder="Notes visible only to you…"
                  value={form.notes}
                  onChange={set("notes")}
                />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className={`w-full py-3 rounded-full font-bold text-sm flex items-center justify-center gap-2 transition-all
                  ${saved
                    ? "bg-green-500 text-white"
                    : "bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-60"
                  }`}
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving…" : saved ? "Saved ✓" : "Update Order"}
              </button>
              <p className="text-neutral-400 text-xs text-center">
                WhatsApp notification auto-sent on Shipped &amp; Delivered updates
              </p>
            </div>
          </div>

          {/* Confirmation email. Most orders have no email address — it's optional
              at checkout — so this states which case you're looking at rather
              than showing a dead button. */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-neutral-700 font-medium flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-primary-500" /> Confirmation email
                </p>
                <p className="text-xs text-neutral-500 mt-0.5 truncate">
                  {!order.buyer_email
                    ? "No email address on this order"
                    : order.invoice_email_sent_at
                      ? `Sent ${formatIST(order.invoice_email_sent_at)}`
                      : "Not sent yet"}
                </p>
              </div>
              {order.buyer_email && order.payment_status === "paid" && (
                <button
                  onClick={sendEmail}
                  disabled={emailing}
                  className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:border-neutral-400 disabled:opacity-50 whitespace-nowrap transition-colors"
                >
                  {emailing
                    ? "Sending…"
                    : order.invoice_email_sent_at
                      ? "Send again"
                      : "Send now"}
                </button>
              )}
            </div>
            {emailMsg && (
              <p className={`text-xs mt-2 ${emailMsg.bad ? "text-red-600" : "text-green-600"}`}>
                {emailMsg.text}
              </p>
            )}
          </div>

          {/* Tracking link */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <span className="text-sm text-neutral-500">Customer tracking link</span>
            <button
              onClick={() =>
                navigator.clipboard?.writeText(
                  `${window.location.origin}/neuro-code/track?id=${id}`
                )
              }
              className="text-xs text-primary-600 hover:text-primary-700 transition-colors"
            >
              Copy Link
            </button>
          </div>

          {/* History — who changed what. Only meaningful since staff accounts
              exist; older orders simply have nothing to show. */}
          {order.history && order.history.length > 0 && (
            <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
              <h2 className="font-semibold text-sm text-neutral-700 mb-3 flex items-center gap-2">
                <History className="w-4 h-4 text-primary-500" /> History
              </h2>
              <ul className="space-y-2.5">
                {order.history.map((h) => (
                  <li key={h.id} className="flex items-start gap-2.5 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 mt-1.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-neutral-700">{describeAudit(h)}</p>
                      <p className="text-neutral-400 mt-0.5">
                        {h.actor_email} · {formatIST(h.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
