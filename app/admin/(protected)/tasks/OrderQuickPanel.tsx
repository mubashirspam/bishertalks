"use client";

import { useEffect, useState } from "react";
import Link from "@/components/admin/AdminLink";
import {
  MapPin, Phone, MessageCircle, PencilLine, X, Truck, Save, ExternalLink, AlertCircle, Gift, Copy, Check,
} from "lucide-react";
import { formatIST } from "@/lib/format-date";
import { STATUS_LABELS, STATUS_BADGE, type Order, type OrderStatus } from "@/lib/types/order";
import { orderStage, STAGE_LABELS as FUNNEL_LABELS, STAGE_BADGE as FUNNEL_BADGE } from "@/lib/order-stage";
import { funnelWaMessage, deliveryWaMessage, waLink, telLink } from "@/lib/wa-message";
import { fullAddressLines } from "@/lib/address";
import { deliveryPriority, PRIORITY_BADGE } from "@/lib/delivery-priority";

const ALL_STATUSES: OrderStatus[] = [
  "confirmed", "processing", "shipped", "out_for_delivery", "delivered", "cancelled",
];

type Msg = { text: string; bad?: boolean } | null;

const EMPTY_ADDR = {
  buyer_name: "", house_name: "", door_no: "", address_line1: "", address_line2: "",
  city: "", district: "", state: "", pincode: "",
};

/**
 * The parts of an order a task is usually about — who, where, and where the
 * parcel is — without leaving the task list. Same endpoints as the full order
 * page (/api/orders/[id] and /api/orders/update), so the same permission
 * checks and the same notifications on a status change. Everything rarer
 * (payment links, bills, WhatsApp log, phone correction) stays on the full
 * page, one link away.
 */
export default function OrderQuickPanel({
  orderNumber,
  canEdit,
}: {
  orderNumber: string;
  /** orders.edit — without it the panel is read-only rather than offering a
   *  Save that the route would refuse. */
  canEdit: boolean;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [editingAddress, setEditingAddress] = useState(false);
  const [addr, setAddr] = useState(EMPTY_ADDR);
  const [addrSaving, setAddrSaving] = useState(false);
  const [addrMsg, setAddrMsg] = useState<Msg>(null);

  const [form, setForm] = useState({
    status: "" as OrderStatus,
    courier_name: "",
    tracking_number: "",
    expected_delivery: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<Msg>(null);
  const [copied, setCopied] = useState(false);

  const hydrate = (data: Order) => {
    setOrder(data);
    setForm({
      status: data.status,
      courier_name: data.courier_name ?? "",
      tracking_number: data.tracking_number ?? "",
      expected_delivery: data.expected_delivery ?? "",
      notes: data.notes ?? "",
    });
    setAddr({
      buyer_name: data.buyer_name ?? "",
      house_name: data.house_name ?? "",
      door_no: data.door_no ?? "",
      address_line1: data.address_line1 ?? "",
      address_line2: data.address_line2 ?? "",
      city: data.city ?? "",
      district: data.district ?? "",
      state: data.state ?? "",
      pincode: data.pincode ?? "",
    });
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${encodeURIComponent(orderNumber)}`)
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) throw new Error("You don't have access to order details.");
        if (!r.ok) throw new Error("Order not found.");
        return r.json();
      })
      .then((data: Order) => !cancelled && hydrate(data))
      .catch((e: Error) => !cancelled && setLoadError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  const update = async (body: Record<string, unknown>): Promise<string | null> => {
    const res = await fetch("/api/orders/update", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_number: orderNumber, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return json.error ?? "Could not save";
    setOrder((prev) => (prev ? { ...prev, ...json, history: prev.history, notifications: prev.notifications } : prev));
    return null;
  };

  const saveShipment = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const err = await update(form);
      setSaveMsg(err ? { text: err, bad: true } : { text: "Saved" });
      if (!err) setTimeout(() => setSaveMsg(null), 2000);
    } catch {
      setSaveMsg({ text: "Network error", bad: true });
    } finally {
      setSaving(false);
    }
  };

  const saveAddress = async () => {
    setAddrSaving(true);
    setAddrMsg(null);
    try {
      const err = await update(addr);
      if (err) setAddrMsg({ text: err, bad: true });
      else setEditingAddress(false);
    } catch {
      setAddrMsg({ text: "Network error", bad: true });
    } finally {
      setAddrSaving(false);
    }
  };

  const lookupPincode = async (pin: string) => {
    if (!/^\d{6}$/.test(pin)) return;
    try {
      const json = await fetch(`/api/pincode/${pin}`).then((r) => r.json());
      if (json.found) {
        setAddr((p) => ({ ...p, city: p.city || json.district, district: json.district, state: json.state }));
      }
    } catch {
      // Soft-fail — manual entry still works.
    }
  };

  const inputCls =
    "w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-neutral-900 placeholder-neutral-400 text-sm focus:outline-none focus:border-primary-500 transition-colors disabled:bg-neutral-50 disabled:text-neutral-500";
  const labelCls = "text-[11px] text-neutral-500 font-semibold uppercase tracking-wide block mb-1";
  const card = "bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm";

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-16 bg-neutral-100 rounded-2xl" />
        <div className="h-40 bg-neutral-100 rounded-2xl" />
        <div className="h-64 bg-neutral-100 rounded-2xl" />
      </div>
    );
  }

  if (loadError || !order) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>{loadError || "Order not found."}</p>
      </div>
    );
  }

  const paid = order.payment_status === "paid";
  const setField = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));
  const addrInput = (k: keyof typeof addr, label: string, span2 = false) => (
    <div className={span2 ? "col-span-2" : ""}>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} value={addr[k]} onChange={(e) => setAddr((p) => ({ ...p, [k]: e.target.value }))} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-primary-600 font-semibold">{order.order_number}</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              {formatIST(order.ordered_at)} · ₹{Math.round(order.amount_paise / 100)}
              {order.quantity > 1 && (
                <span className="ml-1.5 font-bold text-amber-700">× {order.quantity} books</span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {paid ? (
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[order.status]}`}>
                {STATUS_LABELS[order.status]}
              </span>
            ) : (
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${FUNNEL_BADGE[orderStage(order)]}`}>
                {FUNNEL_LABELS[orderStage(order)]}
              </span>
            )}
            {deliveryPriority(order.delivery_priority) === "urgent" && (
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${PRIORITY_BADGE.urgent}`}>
                ⚡ Urgent
              </span>
            )}
          </div>
        </div>
        {order.is_gift && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-primary-800 bg-primary-50 border border-primary-200 rounded-lg px-2.5 py-1.5">
            <Gift className="w-3.5 h-3.5" />
            Gift{order.is_signed ? " · signed copies" : ""}
            {order.gift_message ? ` — “${order.gift_message}”` : ""}
          </p>
        )}
      </div>

      {/* Buyer & address */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-neutral-700 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary-500" /> Buyer & address
          </h3>
          {canEdit && (
            <button
              onClick={() => {
                setEditingAddress((v) => !v);
                setAddrMsg(null);
              }}
              className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              {editingAddress ? <X className="w-3.5 h-3.5" /> : <PencilLine className="w-3.5 h-3.5" />}
              {editingAddress ? "Cancel" : "Edit"}
            </button>
          )}
        </div>

        {!editingAddress ? (
          <div className="text-sm space-y-2">
            <p className="font-medium text-neutral-900">{order.buyer_name ?? <span className="text-neutral-400">No name</span>}</p>
            {order.buyer_phone && (
              <div className="flex items-center gap-2">
                <span className="text-neutral-700 tabular-nums">+91 {order.buyer_phone}</span>
                <a
                  href={telLink(order.buyer_phone)}
                  title="Call"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
                <a
                  href={waLink(order.buyer_phone, paid && order.address_line1 ? deliveryWaMessage(order) : funnelWaMessage(order))}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="WhatsApp"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-50 text-green-600 hover:bg-green-100"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
            {(order as { alt_phone?: string | null }).alt_phone && (
              <div className="flex items-center gap-2">
                <span className="text-neutral-500 text-xs">Alt.</span>
                <span className="text-neutral-700 tabular-nums">
                  +91 {(order as { alt_phone?: string | null }).alt_phone}
                </span>
                <a
                  href={telLink((order as { alt_phone?: string | null }).alt_phone!)}
                  title="Call the alternative number"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
            {order.buyer_email && <p className="text-neutral-500 text-xs">{order.buyer_email}</p>}
            <div className="pt-2 border-t border-neutral-100 text-neutral-600 leading-relaxed">
              {order.address_line1 ? (
                <>
                  {fullAddressLines(order).map((l, i) => (
                    <span key={i} className="block">{l}</span>
                  ))}
                  <button
                    onClick={async () => {
                      await navigator.clipboard?.writeText(
                        [order.buyer_name, ...fullAddressLines(order), order.buyer_phone].filter(Boolean).join("\n")
                      );
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy address"}
                  </button>
                  {!order.house_name && (
                    <span className="mt-1.5 block text-xs text-amber-600">
                      No house or building name — add it if you know it.
                    </span>
                  )}
                </>
              ) : paid ? (
                <span className="text-orange-600 font-medium">Paid, but no delivery address yet.</span>
              ) : (
                <span className="text-neutral-400 italic">No address yet — collected after payment</span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {addrInput("buyer_name", "Name", true)}
              {addrInput("house_name", "House / building")}
              {addrInput("door_no", "Flat / door no.")}
              {addrInput("address_line1", "Area, street, locality", true)}
              {addrInput("address_line2", "Landmark", true)}
              <div>
                <label className={labelCls}>Pincode</label>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  maxLength={6}
                  value={addr.pincode}
                  onChange={(e) => {
                    const pin = e.target.value.replace(/\D/g, "");
                    setAddr((p) => ({ ...p, pincode: pin }));
                    void lookupPincode(pin);
                  }}
                />
              </div>
              {addrInput("city", "City")}
              {addrInput("district", "District")}
              {addrInput("state", "State")}
            </div>
            <button
              onClick={saveAddress}
              disabled={addrSaving || !addr.address_line1 || addr.pincode.length !== 6}
              className="w-full py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white font-bold text-sm disabled:opacity-50"
            >
              {addrSaving ? "Saving…" : "Save address"}
            </button>
            {addrMsg && <p className={`text-xs ${addrMsg.bad ? "text-red-600" : "text-green-600"}`}>{addrMsg.text}</p>}
          </div>
        )}
      </div>

      {/* Shipment */}
      <div className={card}>
        <h3 className="font-semibold text-sm text-neutral-700 mb-3 flex items-center gap-2">
          <Truck className="w-4 h-4 text-primary-500" /> Delivery & tracking
        </h3>

        {(order.courier_last_scan || order.courier_send_error) && (
          <div className="mb-3 text-xs space-y-1.5">
            {order.courier_last_scan && (
              <p className="text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
                <span className="text-neutral-400">Last scan: </span>
                {order.courier_last_scan}
                {order.courier_last_scan_at && (
                  <span className="text-neutral-400"> · {formatIST(order.courier_last_scan_at)}</span>
                )}
              </p>
            )}
            {order.courier_send_error && (
              <p className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-red-800">
                {order.courier_send_error}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Status</label>
            <select className={`${inputCls} cursor-pointer`} value={form.status} onChange={setField("status")} disabled={!canEdit}>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Courier</label>
            <input className={inputCls} placeholder="e.g. Delhivery" value={form.courier_name} onChange={setField("courier_name")} disabled={!canEdit} />
          </div>
          <div>
            <label className={labelCls}>Expected delivery</label>
            <input className={inputCls} type="date" value={form.expected_delivery} onChange={setField("expected_delivery")} disabled={!canEdit} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Tracking number</label>
            <input
              className={`${inputCls} font-mono placeholder:font-sans`}
              placeholder="Waybill / tracking ID"
              value={form.tracking_number}
              onChange={setField("tracking_number")}
              disabled={!canEdit}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Internal notes</label>
            <textarea className={`${inputCls} resize-none`} rows={2} value={form.notes} onChange={setField("notes")} disabled={!canEdit} />
          </div>
        </div>

        {canEdit ? (
          <>
            <button
              onClick={saveShipment}
              disabled={saving}
              className={`mt-4 w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 ${
                saveMsg && !saveMsg.bad ? "bg-green-500 text-white" : "bg-primary-500 hover:bg-primary-600 text-white"
              }`}
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving…" : saveMsg && !saveMsg.bad ? "Saved ✓" : "Update order"}
            </button>
            {saveMsg?.bad && <p className="text-xs text-red-600 mt-2">{saveMsg.text}</p>}
            <p className="text-neutral-400 text-[11px] text-center mt-2">
              WhatsApp is auto-sent on Shipped &amp; Delivered
            </p>
          </>
        ) : (
          <p className="text-neutral-400 text-xs mt-3">Read-only — you don&apos;t have permission to edit orders.</p>
        )}
      </div>

      <Link
        href={`/admin/orders/${order.order_number}`}
        className="flex items-center justify-center gap-1.5 text-xs text-neutral-500 hover:text-primary-600 py-2"
      >
        Payment, bill, messages & history on the full order page <ExternalLink className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
