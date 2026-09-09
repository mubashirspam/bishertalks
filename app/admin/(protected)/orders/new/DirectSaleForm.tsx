"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, AlertCircle } from "lucide-react";
import {
  MANUAL_PAYMENT_METHODS,
  MANUAL_PAYMENT_LABELS,
} from "@/lib/db/sales-channel";
import { TRAFFIC_SOURCES, SOURCE_LABELS } from "@/lib/attribution";
import {
  ADDRESS_TYPES,
  ADDRESS_TYPE_LABELS,
  splitPastedAddress,
  type AddressType,
} from "@/lib/address";
import {
  DELIVERY_PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_HINTS,
} from "@/lib/delivery-priority";

/**
 * The form for a book sold off the platform.
 *
 * Everything here is a field the delivery pipeline needs, plus the two facts
 * only a direct sale has — how the money arrived and its reference. Nothing on
 * this form is optional decoration: an order that cannot be addressed cannot
 * be posted, so the required set is exactly what a courier will ask for.
 *
 * The amount is entered in RUPEES. Every money column in the database is
 * paise, and the route converts — but a person typing 749 into a box labelled
 * paise is a data-entry error waiting to happen, and it would land in a figure
 * nobody reconciles.
 *
 * It arrives pre-filled at the book's live selling price times the number of
 * copies, because that is what almost every direct sale actually is, and
 * retyping the same number all day is how a wrong one eventually gets typed.
 * The price comes from `getProductPricing()` — the same resolver the checkout
 * charges from, offer price and scheduled price change included — so it cannot
 * drift from what the shop is really selling at.
 *
 * It stays editable, and the moment it is edited by hand the quantity stops
 * driving it. Somebody entering a discounted sale, a bundle or an amount that
 * included postage should not have their figure silently recomputed under
 * them when they go back and fix the copies.
 */

const LABEL = "text-xs font-medium text-neutral-500 mb-1.5 block";
const INPUT =
  "w-full text-sm border border-neutral-200 rounded-xl px-3 py-2 bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-400";

export default function DirectSaleForm({
  unitPrice,
  couriers,
}: {
  unitPrice: number;
  /** Active partners, from the couriers table — never a hard-coded list. */
  couriers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Pincode drives district, state and the locality list, exactly as the
  // customer's own address form does — same /api/pincode route, same cached
  // India Post data. Typing a Kerala district by hand forty times a week is
  // how "Kozhikkode" and "Calicut" end up in the same column.
  const [pincode, setPincode] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [state, setState] = useState("Kerala");
  const [localities, setLocalities] = useState<string[]>([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinNote, setPinNote] = useState("");

  /**
   * Look the pincode up, once it is six digits.
   *
   * Called from the field's own change handler rather than an effect. There is
   * exactly one thing that changes a pincode — somebody typing in that box —
   * so an effect watching the value would be a second mechanism describing the
   * same event, and it is what react-hooks/set-state-in-effect flags.
   *
   * `seq` guards against a slow lookup landing after a faster later one: type
   * 673027 then correct it to 673028 and the first reply must not overwrite the
   * second. Every response checks it is still the newest before it writes.
   */
  const lookupSeq = useRef(0);

  async function lookupPincode(code: string) {
    const seq = ++lookupSeq.current;
    setPinLoading(true);
    setPinNote("");
    try {
      const res = await fetch(`/api/pincode/${code}`);
      const data = await res.json();
      if (seq !== lookupSeq.current) return;

      if (data.found) {
        setDistrict(data.district);
        setState(data.state);
        setLocalities(data.localities ?? []);
        // One post office means there is nothing to choose.
        if (data.localities?.length === 1) setCity(data.localities[0]);
        setPinNote(`${data.district}, ${data.state}`);
      } else {
        // Never a blocker. The operator has the address in front of them and
        // can type it; a third-party lookup being down must not stop a sale
        // being recorded.
        setLocalities([]);
        setPinNote("Not found — type the town and district yourself.");
      }
    } catch {
      if (seq === lookupSeq.current) {
        setPinNote("Lookup unavailable — type them yourself.");
      }
    } finally {
      if (seq === lookupSeq.current) setPinLoading(false);
    }
  }

  // 0064 fields. Controlled, because a paste into the street box distributes
  // itself across them — see handleAddressPaste.
  const [addrType, setAddrType] = useState<AddressType>("home");
  const [houseName, setHouseName] = useState("");
  const [doorNo, setDoorNo] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [pasteNote, setPasteNote] = useState("");

  /**
   * Somebody pasted a whole WhatsApp address into one box.
   *
   * That is what actually happens forty times a day, so the form takes the
   * blob and distributes it rather than making the operator cut and paste five
   * times. Only fields that are still EMPTY are filled: a paste must never
   * overwrite something already typed, or correcting one field and pasting
   * into another would silently undo the correction.
   */
  function handleAddressPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    // One line with no commas is an ordinary paste into one field. Splitting
    // it would be worse than leaving it alone.
    if (!/[\n,]/.test(text)) return;

    e.preventDefault();
    const parsed = splitPastedAddress(text);
    const filled: string[] = [];

    if (parsed.house_name && !houseName) { setHouseName(parsed.house_name); filled.push("house"); }
    if (parsed.door_no && !doorNo) { setDoorNo(parsed.door_no); filled.push("door no"); }
    if (parsed.pincode && !pincode) {
      setPincode(parsed.pincode);
      lookupPincode(parsed.pincode);
      filled.push("pincode");
    }
    // Whatever could not be placed goes to the street box, where a human sees
    // it. Never dropped.
    if (parsed.rest) setLine1(line1 ? `${line1}, ${parsed.rest}` : parsed.rest);

    setPasteNote(
      filled.length
        ? `Split the paste — filled ${filled.join(", ")}. Check each box.`
        : "Pasted into the street box. Move the house name up if it is in there."
    );
  }

  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState(String(unitPrice));
  /** Set once the operator types their own figure — see the note above. */
  const [amountEdited, setAmountEdited] = useState(false);
  /** Paid now, or paid to the courier at the door — see lib/delivery-mode.ts.
   * Drives whether "how they paid" even makes sense to ask yet. */
  const [deliveryMode, setDeliveryMode] = useState<"normal" | "cod">("normal");
  const isCod = deliveryMode === "cod";

  const expected = unitPrice * quantity;
  const differs = amountEdited && Number(amount) !== expected;

  function changeQuantity(next: number) {
    const q = Math.max(1, Math.floor(next || 1));
    setQuantity(q);
    if (!amountEdited) setAmount(String(unitPrice * q));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());

    try {
      const res = await fetch("/api/admin/orders/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, is_signed: fd.get("is_signed") === "on" }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Could not save the order.");
        setSaving(false);
        return;
      }
      setDone(json.order_number);
      // Straight to the order, which is where the next thing to do — routing it
      // to a courier — actually happens.
      router.push(`/admin/orders/${json.order_number}`);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <section className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-semibold text-sm mb-4">Who bought it</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Name</label>
            <input name="buyer_name" required className={INPUT} placeholder="As it goes on the label" />
          </div>
          <div>
            <label className={LABEL}>Phone</label>
            <input
              name="buyer_phone" required inputMode="numeric" className={INPUT}
              placeholder="10 digits" pattern="[0-9\s+\-]{10,15}"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Email (optional)</label>
            <input name="buyer_email" type="email" className={INPUT} placeholder="For the receipt, if they gave one" />
          </div>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-semibold text-sm mb-1">Where it goes</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Paste the whole address from their WhatsApp message into any box — it splits
          itself across the fields, and you correct what it got wrong. The courier will
          refuse anything incomplete.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={LABEL}>This address is</label>
            <div className="flex gap-2">
              {ADDRESS_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAddrType(t)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold border transition-colors ${
                    addrType === t
                      ? "bg-neutral-900 border-neutral-900 text-white"
                      : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400"
                  }`}
                >
                  {ADDRESS_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <input type="hidden" name="address_type" value={addrType} />
          </div>

          <div>
            <label className={LABEL}>
              {addrType === "office" ? "Office / building name" : "House / building name"}
            </label>
            <input
              name="house_name" required className={INPUT}
              placeholder="Thoppil House"
              value={houseName} onChange={(e) => setHouseName(e.target.value)}
              onPaste={handleAddressPaste}
            />
          </div>
          <div>
            <label className={LABEL}>Flat / floor / door no. (optional)</label>
            <input
              name="door_no" className={INPUT} placeholder="2B"
              value={doorNo} onChange={(e) => setDoorNo(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Area, street, locality</label>
            <input
              name="address_line1" required className={INPUT}
              placeholder="Asarithodi, Nallalam"
              value={line1} onChange={(e) => setLine1(e.target.value)}
              onPaste={handleAddressPaste}
            />
            {pasteNote && (
              <p className="text-[11px] text-amber-600 mt-1">{pasteNote}</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Landmark (optional)</label>
            <input
              name="address_line2" className={INPUT}
              placeholder="Near Ayurkerala hospital"
              value={line2} onChange={(e) => setLine2(e.target.value)}
            />
          </div>
          {/* Pincode first, because it fills in the three below it. */}
          <div>
            <label className={LABEL}>Pincode</label>
            <div className="relative">
              <input
                name="pincode" required inputMode="numeric" pattern="\d{6}"
                className={INPUT} placeholder="6 digits"
                value={pincode}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setPincode(next);
                  if (next.length === 6) {
                    lookupPincode(next);
                  } else {
                    // An incomplete pincode has no answer, so drop the last
                    // one rather than leaving it on screen next to a
                    // different number.
                    lookupSeq.current++;
                    setLocalities([]);
                    setPinNote("");
                    setPinLoading(false);
                  }
                }}
              />
              {pinLoading && (
                <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-2.5 text-neutral-400" />
              )}
            </div>
            {pinNote && (
              <p className="text-[11px] text-neutral-400 mt-1">{pinNote}</p>
            )}
          </div>
          <div>
            <label className={LABEL}>City / town</label>
            {/* A datalist, not a select: the post office names are the common
                answers, and somebody who knows the locality better than India
                Post does must still be able to type it. */}
            <input
              name="city" required className={INPUT} list="pin-localities"
              value={city} onChange={(e) => setCity(e.target.value)}
            />
            <datalist id="pin-localities">
              {localities.map((l) => <option key={l} value={l} />)}
            </datalist>
          </div>
          <div>
            <label className={LABEL}>District</label>
            <input
              name="district" className={INPUT}
              value={district} onChange={(e) => setDistrict(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL}>State</label>
            <input
              name="state" required className={INPUT}
              value={state} onChange={(e) => setState(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-semibold text-sm mb-1">How it goes out</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Both optional, and both are things only the person taking the sale knows.
          Either can be changed later from the delivery queue.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Delivery service</label>
            <select name="courier_id" defaultValue="" className={INPUT}>
              {/* Empty by default rather than guessing a partner. A parcel
                  with no service picked lands in the queue as New, which is
                  exactly where an undecided parcel belongs. */}
              <option value="">Decide later</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-neutral-400 mt-1">
              Picking one routes the parcel now, so it reaches the queue already
              assigned.
            </p>
          </div>
          <div>
            <label className={LABEL}>Priority</label>
            <select name="delivery_priority" defaultValue="normal" className={INPUT}>
              {DELIVERY_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
            <p className="text-[11px] text-neutral-400 mt-1">
              {PRIORITY_HINTS.urgent}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
        <h2 className="font-semibold text-sm mb-1">The money</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Recorded against this order, and reported on its own. It is never added to
          Total revenue, Today, This week or This month — those are checked against
          Razorpay, and this never went through Razorpay.
        </p>

        {/* Determines everything below it — there's nothing to ask about
            "how they paid" until they actually have. */}
        <div className="mb-4">
          <label className={LABEL}>How is this paid?</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeliveryMode("normal")}
              className={`px-3.5 py-2 rounded-xl border text-sm font-medium transition-colors ${
                !isCod
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400"
              }`}
            >
              Paid already
            </button>
            <button
              type="button"
              onClick={() => setDeliveryMode("cod")}
              className={`px-3.5 py-2 rounded-xl border text-sm font-medium transition-colors ${
                isCod
                  ? "bg-amber-600 text-white border-amber-600"
                  : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400"
              }`}
            >
              Cash on delivery
            </button>
          </div>
          {isCod && (
            <p className="text-[11px] text-neutral-500 mt-1.5">
              Nothing is recorded as paid yet. The courier collects it, and marking that
              done — from the delivery portal — is what settles this order&apos;s payment.
            </p>
          )}
          {/* Hidden rather than removed from the DOM entirely is tempting, but a
              hidden select still submits its value — and a leftover "upi" on a
              COD order would tell the API this was already paid. Not rendering
              it at all is the only way to be sure the field simply isn't there. */}
          <input type="hidden" name="delivery_mode" value={deliveryMode} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>{isCod ? "Amount due (₹)" : "Amount paid (₹)"}</label>
            <input
              name="amount_rupees" required type="number" min="0" step="1"
              className={INPUT}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountEdited(true);
              }}
            />
            <p className="text-[11px] text-neutral-400 mt-1">
              {quantity === 1
                ? `Selling price ₹${unitPrice.toLocaleString("en-IN")}`
                : `₹${unitPrice.toLocaleString("en-IN")} × ${quantity} = ₹${expected.toLocaleString("en-IN")}`}
              {differs && (
                <button
                  type="button"
                  onClick={() => {
                    setAmount(String(expected));
                    setAmountEdited(false);
                  }}
                  className="ml-1.5 underline hover:text-neutral-600"
                >
                  reset
                </button>
              )}
            </p>
          </div>
          <div>
            <label className={LABEL}>Books</label>
            <input
              name="quantity" type="number" min="1" step="1" className={INPUT}
              value={quantity}
              onChange={(e) => changeQuantity(Number(e.target.value))}
            />
          </div>
          {/* Nothing to ask yet on a COD sale — see lib.delivery-mode.ts and the
              API route, which stores neither as null until it's actually paid. */}
          {!isCod && (
            <>
              <div>
                <label className={LABEL}>How they paid</label>
                <select name="manual_payment_method" defaultValue="upi" className={INPUT}>
                  {MANUAL_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{MANUAL_PAYMENT_LABELS[m]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>Reference (optional)</label>
                <input
                  name="manual_payment_ref" className={INPUT}
                  placeholder="UPI txn id, or a note"
                />
              </div>
            </>
          )}
          <div>
            <label className={LABEL}>Came from</label>
            <select name="source" defaultValue="direct" className={INPUT}>
              {TRAFFIC_SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" name="is_signed" className="rounded border-neutral-300" />
              Signed copy
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL}>Note (optional)</label>
            <input name="notes" className={INPUT} placeholder="Anything worth remembering about this sale" />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !!done}
          className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {done && <Check className="w-4 h-4" />}
          {done ? `Saved ${done}` : saving ? "Saving…" : "Save direct sale"}
        </button>
        <p className="text-xs text-neutral-500">
          Saves as paid and confirmed, ready to route to a courier. The customer gets the
          same confirmation message an online buyer does.
        </p>
      </div>
    </form>
  );
}
