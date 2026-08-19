"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Package, Truck, MapPin, CreditCard, Phone, MessageCircle, History, Mail, Link2, Copy, Check, PencilLine, X, Receipt, Gift, PenLine } from "lucide-react";
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
import { orderStage, STAGE_LABELS as FUNNEL_LABELS, STAGE_BADGE as FUNNEL_BADGE } from "@/lib/order-stage";

const ALL_STATUSES: OrderStatus[] = [
  "confirmed", "processing", "shipped", "out_for_delivery", "delivered", "cancelled",
];

/** Wire event names from lib/notify.ts, in the words an admin would use. */
const NOTIFY_LABELS: Record<string, string> = {
  "payment.received": "Payment received — address requested",
  "order.confirmed": "Order confirmed",
  "order.shipped": "Shipped",
  "order.delivered": "Delivered",
  "course.access": "Course unlocked",
};

/**
 * What each state means to whoever is asking "did they get it?".
 *
 * Sending direct through Meta means these are now facts rather than
 * hand-overs: 'sent' is Meta accepting the message, and only 'delivered' says
 * it reached the phone. 'queued' is the honest word for a message claimed but
 * not yet accepted — it is not a success, so it doesn't get a green dot.
 */
const NOTIFY_STATUS_LABELS: Record<string, string> = {
  queued: "queued",
  sent: "sent to WhatsApp",
  delivered: "delivered to phone",
  read: "read by customer",
  failed: "failed",
  skipped: "not configured",
};

const NOTIFY_DOT: Record<string, string> = {
  queued: "bg-amber-400",
  sent: "bg-lime-500",
  delivered: "bg-green-500",
  read: "bg-emerald-600",
  failed: "bg-red-500",
  skipped: "bg-neutral-300",
};

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [billing, setBilling] = useState(false);
  const [billMsg, setBillMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkMsg, setLinkMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addrSaving, setAddrSaving] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [confirmingPhone, setConfirmingPhone] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [courierMsg, setCourierMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [addr, setAddr] = useState({
    buyer_name: "",
    address_line1: "",
    address_line2: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
  });

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
        setAddr({
          buyer_name: data.buyer_name ?? "",
          address_line1: data.address_line1 ?? "",
          address_line2: data.address_line2 ?? "",
          city: data.city ?? "",
          district: data.district ?? "",
          state: data.state ?? "",
          pincode: data.pincode ?? "",
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

  // Download the bill as a PDF — nothing is emailed, messaged or recorded;
  // the file just lands in the admin's downloads folder.
  const downloadBill = async () => {
    setBilling(true);
    setBillMsg(null);
    try {
      const res = await fetch("/api/admin/orders/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setBillMsg({ text: json.error ?? "Could not generate bill", bad: true });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `bill-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setBillMsg({ text: "Bill downloaded." });
    } catch {
      setBillMsg({ text: "Network error", bad: true });
    } finally {
      setBilling(false);
    }
  };

  const generateLink = async (regenerate = false) => {
    setLinkLoading(true);
    setLinkMsg(null);
    try {
      const res = await fetch("/api/admin/orders/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: id, regenerate }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setOrder((prev) =>
          prev ? { ...prev, payment_link_id: json.link_id, payment_link_url: json.url } : prev
        );
        setLinkMsg({ text: json.reused ? "Existing link is still live." : "Payment link ready." });
      } else {
        setLinkMsg({ text: json.error ?? "Could not create link", bad: true });
      }
    } catch {
      setLinkMsg({ text: "Network error", bad: true });
    } finally {
      setLinkLoading(false);
    }
  };

  const copyLink = async (url: string) => {
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Webhooks occasionally miss — ask Razorpay directly whether the link was
  // paid, and flip the order here if it was.
  const syncPayment = async () => {
    setLinkLoading(true);
    setLinkMsg(null);
    try {
      const res = await fetch("/api/admin/orders/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: id, sync: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.changed) {
          const fresh = await fetch(`/api/orders/${id}`).then((r) => r.json());
          setOrder(fresh);
          setLinkMsg({ text: "Payment confirmed — order is now paid." });
        } else {
          setLinkMsg({
            text: json.status === "paid" ? "Already marked paid." : `Razorpay says: ${json.status}.`,
          });
        }
      } else {
        setLinkMsg({ text: json.error ?? "Sync failed", bad: true });
      }
    } catch {
      setLinkMsg({ text: "Network error", bad: true });
    } finally {
      setLinkLoading(false);
    }
  };

  const lookupPincode = async (pin: string) => {
    if (!/^\d{6}$/.test(pin)) return;
    try {
      const res = await fetch(`/api/pincode/${pin}`);
      const json = await res.json();
      if (json.found) {
        setAddr((prev) => ({
          ...prev,
          city: prev.city || json.district,
          district: json.district,
          state: json.state,
        }));
      }
    } catch {
      // Soft-fail — manual entry still works.
    }
  };

  const saveAddress = async () => {
    setAddrSaving(true);
    const res = await fetch("/api/orders/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_number: id, ...addr }),
    });
    if (res.ok) {
      const updated = await res.json();
      setOrder((prev) => (prev ? { ...prev, ...updated, history: prev.history } : prev));
      setEditingAddress(false);
    }
    setAddrSaving(false);
  };

  const startPhoneEdit = () => {
    setPhoneDraft(order?.buyer_phone ?? "");
    setConfirmingPhone(false);
    setPhoneMsg(null);
    setEditingPhone(true);
  };

  // Same normalisation as the server: a pasted +91 or leading 0 comes off.
  const reviewPhoneChange = () => {
    const digits = phoneDraft.replace(/\D/g, "");
    const normalized =
      digits.length === 12 && digits.startsWith("91")
        ? digits.slice(2)
        : digits.length === 11 && digits.startsWith("0")
          ? digits.slice(1)
          : digits;
    if (!/^[6-9]\d{9}$/.test(normalized)) {
      setPhoneMsg({ text: "Enter a valid 10-digit mobile number", bad: true });
      return;
    }
    if (normalized === order?.buyer_phone) {
      setPhoneMsg({ text: "That is the current number", bad: true });
      return;
    }
    setPhoneDraft(normalized);
    setPhoneMsg(null);
    setConfirmingPhone(true);
  };

  const savePhone = async () => {
    setPhoneSaving(true);
    setPhoneMsg(null);
    try {
      const res = await fetch("/api/orders/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: id, buyer_phone: phoneDraft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhoneMsg({ text: json.error ?? "Could not update the number", bad: true });
        return;
      }
      // The number also moves the user link and course access server-side —
      // re-read so the row and the history entry both show.
      const fresh = await fetch(`/api/orders/${id}`).then((r) => r.json());
      setOrder(fresh);
      setEditingPhone(false);
      setConfirmingPhone(false);
    } catch {
      setPhoneMsg({ text: "Network error", bad: true });
    } finally {
      setPhoneSaving(false);
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

  /**
   * Cancel the shipment with the courier.
   *
   * The real undo for a send — clearing our own columns would leave the two
   * systems describing different journeys while a van still came. The route
   * calls the courier first and only changes anything here if they agree, so a
   * refusal (usually "already out for delivery") leaves the parcel untouched.
   */
  const cancelWithCourier = async () => {
    const sure = window.confirm(
      `Cancel ${id} with the courier?\n\n` +
        `Only possible while they still have it on the shelf. If they refuse, ` +
        `nothing changes and the parcel carries on.`
    );
    if (!sure) return;

    setCancelling(true);
    setCourierMsg(null);
    try {
      const res = await fetch("/api/admin/delivery/courier-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: id }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setCourierMsg({ text: data.error ?? "Could not cancel.", bad: true });
        return;
      }

      setCourierMsg({ text: data.message ?? "Cancelled with the courier." });
      const fresh = await fetch(`/api/orders/${id}`).then((r) => r.json());
      if (!fresh.error) setOrder(fresh);
      router.refresh();
    } catch {
      setCourierMsg({ text: "Could not reach the server.", bad: true });
    } finally {
      setCancelling(false);
    }
  };

  const date = `${formatIST(order.created_at)} (${timeAgo(order.created_at)})`;

  /**
   * Roughly when the money landed.
   *
   * There is no paid_at column, and created_at is the wrong answer: it is when
   * checkout began, which for a lead that came back days later is nowhere near
   * the payment. The receipt email goes out inside payment verification, so its
   * timestamp is within seconds of the capture; the address submission is the
   * next best thing on the flows that have no email address. Both are labelled
   * as approximate, because the exact capture time lives in Razorpay.
   */
  const paidAt =
    order.payment_status === "paid"
      ? (order.invoice_email_sent_at ?? order.address_submitted_at ?? null)
      : null;

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

      {/* Full width and above both columns, because it changes what physically
          goes in the parcel. Buried in the payment card on the right, it would
          be found after the box was taped shut. */}
      {order.is_gift && (
        <div className="mb-6 bg-primary-50 border border-primary-200 rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-sm text-primary-900 flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary-600" />
            {order.is_signed
              ? "Gift order — get every copy signed, then wrap"
              : "Gift order — wrap before shipping"}
          </h2>

          {/* Above the message, because it is the step that has to happen
              first and the one that cannot be done after the box is taped. */}
          {order.is_signed && (
            <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-primary-900 bg-white border border-primary-200 rounded-xl px-4 py-3">
              <PenLine className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary-600" />
              <span>
                Signed copies — all {order.quantity} book
                {order.quantity === 1 ? "" : "s"} in this parcel go to Bisher to
                be signed before wrapping.
              </span>
            </p>
          )}
          {order.gift_message ? (
            <>
              <p className="text-xs font-semibold text-primary-700 uppercase tracking-wider mt-4 mb-1.5">
                Write this on the card
              </p>
              {/* Serif and large: this gets copied out by hand onto a card, and
                  a mis-read name is the one mistake a gift cannot survive. */}
              <p className="font-serif text-lg text-neutral-900 bg-white border border-primary-200 rounded-xl px-4 py-3 leading-snug">
                {order.gift_message}
              </p>
            </>
          ) : (
            <p className="text-sm text-primary-800 mt-2">
              Wrapping only — the customer left no message, so send a blank card.
            </p>
          )}
          <p className="text-xs text-primary-700 mt-3">
            No invoice or price goes in the parcel. Charged ₹
            {Math.round(order.gift_charge_paise / 100)} for wrapping
            {order.is_signed && " — signing is free"}.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left col */}
        <div className="space-y-5">
          {/* Status stepper. The delivery column is written as "confirmed" the
              moment checkout starts, so for an unpaid order it would lie —
              "Order Confirmed" on a failed payment. Until money lands, this
              card shows the funnel stage instead of the delivery stepper. */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-sm text-neutral-700 mb-5 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary-500" /> Order Progress
            </h2>
            {order.payment_status === "paid" ? (
              <>
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
              </>
            ) : (
              <>
                <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${FUNNEL_BADGE[orderStage(order)]}`}>
                  {FUNNEL_LABELS[orderStage(order)]}
                </span>
                <p className="text-neutral-400 text-xs mt-4 pt-4 border-t border-neutral-100">
                  Nothing to ship until payment lands — generate a payment link below, or follow up on WhatsApp.
                </p>
              </>
            )}
          </div>

          {/* Buyer info */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm text-neutral-700 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary-500" /> Buyer & Address
              </h2>
              <button
                onClick={() => setEditingAddress((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                {editingAddress ? <X className="w-3.5 h-3.5" /> : <PencilLine className="w-3.5 h-3.5" />}
                {editingAddress ? "Cancel" : "Edit"}
              </button>
            </div>
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
                    <button
                      onClick={startPhoneEdit}
                      title="Correct a mistyped number"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                    >
                      <PencilLine className="w-4 h-4" />
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-neutral-400">—</span>
                    <button
                      onClick={startPhoneEdit}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors"
                    >
                      Add
                    </button>
                  </span>
                )}
              </div>

              {/* Number correction. A wrong digit at checkout strands the
                  course sign-in and sends WhatsApp updates to a stranger, so
                  the save goes through a confirmation, not a blind click. */}
              {editingPhone && (
                <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 space-y-2.5">
                  {!confirmingPhone ? (
                    <>
                      <label className="text-xs text-neutral-500 font-semibold block">Correct mobile number</label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-neutral-500 flex-shrink-0">+91</span>
                        <input
                          className={inputCls}
                          inputMode="numeric"
                          maxLength={12}
                          placeholder="10-digit mobile"
                          value={phoneDraft}
                          onChange={(e) => setPhoneDraft(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={reviewPhoneChange}
                          className="flex-1 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold transition-colors"
                        >
                          Review change
                        </button>
                        <button
                          onClick={() => setEditingPhone(false)}
                          className="px-4 py-2 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:border-neutral-400 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-neutral-800">Change the number on this order?</p>
                      <p className="text-sm text-neutral-900 tabular-nums">
                        +91 {order.buyer_phone ?? "—"} → <span className="font-bold">+91 {phoneDraft}</span>
                      </p>
                      <p className="text-[11px] text-neutral-500 leading-relaxed">
                        {order.payment_status === "paid"
                          ? "Course sign-in and WhatsApp updates move to the new number, and the access granted to the old one is revoked."
                          : "WhatsApp updates — and the course sign-in once paid — will use the new number."}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={savePhone}
                          disabled={phoneSaving}
                          className="flex-1 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold disabled:opacity-50 transition-colors"
                        >
                          {phoneSaving ? "Saving…" : "Yes, change number"}
                        </button>
                        <button
                          onClick={() => setConfirmingPhone(false)}
                          className="px-4 py-2 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:border-neutral-400 transition-colors"
                        >
                          Back
                        </button>
                      </div>
                    </>
                  )}
                  {phoneMsg && (
                    <p className={`text-[11px] ${phoneMsg.bad ? "text-red-600" : "text-green-600"}`}>
                      {phoneMsg.text}
                    </p>
                  )}
                </div>
              )}
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
                    {order.city}
                    {order.district ? `, ${order.district}` : ""}, {order.state} — {order.pincode}
                  </>
                ) : order.payment_status === "paid" ? (
                  // Paid but unshippable — the case that costs real money.
                  <span className="text-orange-600 font-medium">
                    Paid, but no delivery address yet — chase this customer, or tap Edit above and type it in.
                  </span>
                ) : (
                  <span className="text-neutral-400 italic">
                    No address yet — collected after payment
                  </span>
                )}
              </div>
            </div>

            {/* Manual entry — for the customer who reads their address out on a
                call instead of filling the form. Pincode autofills city/state. */}
            {editingAddress && (
              <div className="mt-4 pt-4 border-t border-neutral-100 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-neutral-500 font-semibold block mb-1">Name</label>
                    <input className={inputCls} value={addr.buyer_name} onChange={(e) => setAddr((p) => ({ ...p, buyer_name: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-neutral-500 font-semibold block mb-1">Address line 1</label>
                    <input className={inputCls} value={addr.address_line1} onChange={(e) => setAddr((p) => ({ ...p, address_line1: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-neutral-500 font-semibold block mb-1">Address line 2</label>
                    <input className={inputCls} value={addr.address_line2} onChange={(e) => setAddr((p) => ({ ...p, address_line2: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 font-semibold block mb-1">Pincode</label>
                    <input
                      className={inputCls}
                      inputMode="numeric"
                      maxLength={6}
                      value={addr.pincode}
                      onChange={(e) => {
                        const pin = e.target.value.replace(/\D/g, "");
                        setAddr((p) => ({ ...p, pincode: pin }));
                        lookupPincode(pin);
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 font-semibold block mb-1">City</label>
                    <input className={inputCls} value={addr.city} onChange={(e) => setAddr((p) => ({ ...p, city: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 font-semibold block mb-1">District</label>
                    <input className={inputCls} value={addr.district} onChange={(e) => setAddr((p) => ({ ...p, district: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 font-semibold block mb-1">State</label>
                    <input className={inputCls} value={addr.state} onChange={(e) => setAddr((p) => ({ ...p, state: e.target.value }))} />
                  </div>
                </div>
                <button
                  onClick={saveAddress}
                  disabled={addrSaving || !addr.address_line1 || addr.pincode.length !== 6}
                  className="w-full py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white font-bold text-sm disabled:opacity-50 transition-colors"
                >
                  {addrSaving ? "Saving…" : "Save address"}
                </button>
              </div>
            )}
          </div>

          {/* Payment */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-sm text-neutral-700 mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary-500" /> Payment
            </h2>
            <div className="space-y-2 text-sm">
              {/* Only when it isn't one. A "Books: 1" row on every order is
                  noise; a missing one on a three-book order is a mis-pack. */}
              {order.quantity > 1 && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Books</span>
                  <span className="font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2">
                    × {order.quantity}
                  </span>
                </div>
              )}
              {order.gift_charge_paise > 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Gift wrapping</span>
                  <span className="text-neutral-900">
                    ₹{Math.round(order.gift_charge_paise / 100)}
                  </span>
                </div>
              )}
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
                <span
                  className="text-neutral-500"
                  title="When checkout began — not necessarily when it was paid"
                >
                  Started
                </span>
                <span className="text-neutral-900">{date}</span>
              </div>
              {paidAt && (
                <div className="flex justify-between">
                  <span
                    className="text-neutral-500"
                    title="Taken from the receipt email, which is sent as the payment is verified — within a few seconds of the capture. Razorpay has the exact time."
                  >
                    Paid ≈
                  </span>
                  <span className="text-neutral-900">{formatIST(paidAt)}</span>
                </div>
              )}
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

          {/* Collect payment — recovery for failed/abandoned checkouts. The
              link opens Razorpay's hosted page (UPI QR, cards, netbanking) for
              exactly this order's amount; paying it flips the order to paid
              via the payment_link.paid webhook, same as a normal checkout. */}
          {order.payment_status !== "paid" && (
            <div className="bg-white border border-primary-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-neutral-700 font-medium flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-primary-500" /> Payment link
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {order.payment_link_url
                      ? "Link is live — share it on WhatsApp"
                      : "Generate a link the customer can pay directly"}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {order.payment_link_url && (
                    <button
                      onClick={syncPayment}
                      disabled={linkLoading}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:border-neutral-400 disabled:opacity-50 whitespace-nowrap transition-colors"
                    >
                      Sync status
                    </button>
                  )}
                  <button
                    onClick={() => generateLink(!!order.payment_link_url)}
                    disabled={linkLoading}
                    className="px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap transition-colors"
                  >
                    {linkLoading
                      ? "Working…"
                      : order.payment_link_url
                        ? "Regenerate"
                        : "Generate"}
                  </button>
                </div>
              </div>
              {order.payment_link_url && (
                <div className="flex items-center gap-2 mt-3">
                  <code className="flex-1 min-w-0 truncate bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-700">
                    {order.payment_link_url}
                  </code>
                  <button
                    onClick={() => copyLink(order.payment_link_url!)}
                    title="Copy link"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-neutral-200 text-neutral-600 hover:border-neutral-400 transition-colors flex-shrink-0"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  {order.buyer_phone && (
                    <a
                      href={waLink(
                        order.buyer_phone,
                        `Hi ${order.buyer_name?.trim() || ""},\nNeuro Code ഓർഡർ (${order.order_number}) പൂർത്തിയാക്കാൻ ഈ ലിങ്കിൽ പേയ്മെന്റ് ചെയ്യാം 👇\n${order.payment_link_url}\n\nUPI, Card, Netbanking — എല്ലാം ലഭ്യം. Payment ആയതിന് ശേഷം book അഡ്രസ്സിൽ എത്തിക്കും + സൗജന്യ NLP course ഉടൻ unlock ആവും.\nThank you`
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Send on WhatsApp"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors flex-shrink-0"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  )}
                </div>
              )}
              {linkMsg && (
                <p className={`text-xs mt-2 ${linkMsg.bad ? "text-red-600" : "text-green-600"}`}>
                  {linkMsg.text}
                </p>
              )}
            </div>
          )}

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

          {/* Bill on request — for the customer who asks for one. Books are
              GST-exempt, so the PDF shows GST as Nil; it downloads straight to
              this machine and goes nowhere else. */}
          <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-neutral-700 font-medium flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-primary-500" /> Bill / invoice
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {order.payment_status === "paid"
                    ? "GST-exempt bill, downloads as a PDF"
                    : "Available once the order is paid"}
                </p>
              </div>
              {order.payment_status === "paid" && (
                <button
                  onClick={downloadBill}
                  disabled={billing}
                  className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:border-neutral-400 disabled:opacity-50 whitespace-nowrap transition-colors"
                >
                  {billing ? "Generating…" : "Generate & download"}
                </button>
              )}
            </div>
            {billMsg && (
              <p className={`text-xs mt-2 ${billMsg.bad ? "text-red-600" : "text-green-600"}`}>
                {billMsg.text}
              </p>
            )}
          </div>

          {/* What the courier has done with this parcel. Read-only: sending and
              cancelling are the only two actions, and everything else about a
              parcel's journey is ticked off in the portal. */}
          {(order.courier_sent_at || order.courier_send_error || order.courier_last_scan) && (
            <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">
              <h2 className="font-semibold text-sm text-neutral-700 mb-3 flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary-500" /> With the courier
              </h2>

              <dl className="space-y-2 text-sm">
                {order.courier_sent_at && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-500">Sent</dt>
                    <dd className="text-neutral-900 text-right">
                      {formatIST(order.courier_sent_at)}
                    </dd>
                  </div>
                )}
                {order.tracking_number && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-500">Waybill</dt>
                    <dd className="font-mono text-neutral-900 text-right break-all">
                      {order.tracking_number}
                    </dd>
                  </div>
                )}
                {order.courier_last_scan && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-500">Last scan</dt>
                    <dd className="text-neutral-900 text-right">
                      {order.courier_last_scan}
                      {order.courier_last_scan_at && (
                        <span className="block text-xs text-neutral-400">
                          {formatIST(order.courier_last_scan_at)}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {/* The held state. Says what to do, because "unknown" is only
                  useful if it comes with the next step. */}
              {order.courier_send_error && (
                <p className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                  {order.courier_send_error}
                </p>
              )}

              {order.courier_sent_at && order.tracking_number && (
                <button
                  onClick={cancelWithCourier}
                  disabled={cancelling}
                  className="mt-3 w-full px-3 py-2 rounded-xl border border-neutral-200 text-xs font-medium text-neutral-600 hover:border-red-300 hover:text-red-700 transition-colors disabled:opacity-40"
                >
                  {cancelling ? "Cancelling…" : "Cancel with the courier"}
                </button>
              )}

              {courierMsg && (
                <p className={`text-xs mt-2 ${courierMsg.bad ? "text-red-600" : "text-green-600"}`}>
                  {courierMsg.text}
                </p>
              )}
            </div>
          )}

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

          {/* Messages actually sent to this customer (migration 0014). Before
              this the only answer to "did they get the WhatsApp?" was reading
              server logs. */}
          {order.notifications && order.notifications.length > 0 && (
            <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
              <h2 className="font-semibold text-sm text-neutral-700 mb-3 flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-primary-500" /> WhatsApp messages
              </h2>
              <ul className="space-y-2.5">
                {order.notifications.map((n) => (
                  <li key={n.id} className="flex items-start gap-2.5 text-xs">
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                        NOTIFY_DOT[n.status] ?? "bg-neutral-300"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-neutral-700">
                        {NOTIFY_LABELS[n.event] ?? n.event}
                        <span className="text-neutral-400">
                          {" · "}
                          {NOTIFY_STATUS_LABELS[n.status] ?? n.status}
                        </span>
                      </p>
                      <p className="text-neutral-400 mt-0.5">{formatIST(n.created_at)}</p>
                      {n.error && (
                        <p className="text-red-500 mt-0.5 break-words">{n.error}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
