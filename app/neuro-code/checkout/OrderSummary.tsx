import Image from "next/image";
import { Gift, ShieldCheck, Minus, Plus, Check, PenLine, Truck, Zap, CalendarClock } from "lucide-react";
import type { PreorderFacts } from "@/lib/preorder";
import { OFFER, NLP_COURSE } from "@/app/neuro-code/content";
import { MAX_BOOKS } from "@/lib/quantity";
import { giftRupees, MAX_GIFT_MESSAGE, type GiftSettings } from "@/lib/gift";
import type { ProductPricing } from "@/lib/db/courses";

/**
 * What the customer is actually buying, itemised.
 *
 * The summary used to be one line — "Neuro Code ₹699" — which undersold the
 * order: the course that comes with it is what the landing page spends most of
 * its length promising, and at the moment of paying it vanished. It's listed
 * here as its own line, marked Included, with no price theatre: a struck-out
 * "worth ₹3,000" beside a ₹0 reads as a sales tactic at exactly the moment
 * someone is deciding whether to trust you with a card number.
 *
 * Delivery isn't a line here either — it's free, so it belongs in the bill
 * below (₹0 against "Delivery charge") rather than posing as something in the
 * box.
 */

export type AppliedPromo = {
  code: string;
  discountPaise: number;
  finalPaise: number;
};

const rupees = (paise: number) => Math.round(paise / 100);

/** ₹3,000 rather than ₹3000 — Indian grouping, as everywhere else on the site. */
const inr = (amount: number) => amount.toLocaleString("en-IN");

const rowCls =
  "flex items-start gap-3 py-3 border-b border-neutral-200 dark:border-white/8 last:border-0";

/** The package: the book you can buy several of, and the course you can't. */
export function PackageItems({
  pricing,
  quantity,
  onQuantity,
  disabled,
}: {
  pricing: ProductPricing;
  quantity: number;
  onQuantity: (next: number) => void;
  /** True while the payment sheet is opening — the basket is settled by then. */
  disabled?: boolean;
}) {
  const lineTotal = pricing.payable * quantity;

  return (
    <div className="mb-5 pb-1 border-b border-neutral-200 dark:border-white/8">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">
        In this package
      </p>

      {/* The book — the only line with money against it, and the only one with
          a quantity. */}
      <div className={rowCls}>
        <div className="relative w-11 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-neutral-100 dark:bg-neutral-800">
          <Image src="/images/book_front.png" alt="Neuro Code" fill sizes="44px" className="object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-neutral-900 dark:text-white leading-tight">
            Neuro Code
          </p>
          <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-0.5">
            Paperback by Bisher KC · 4th edition
          </p>
          {/* Said on the line itself, not only in the delivery note below. The
              basket is what someone re-reads before paying, and "pre-order" is
              the word that has to survive that re-read. */}
          <p className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
            Pre-order
          </p>
          <Stepper value={quantity} onChange={onQuantity} disabled={disabled} />
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-bold text-sm text-neutral-900 dark:text-white">
            ₹{inr(lineTotal)}
          </p>
          {pricing.offerPrice != null && quantity === 1 && (
            <p className="text-neutral-400 line-through text-[11px]">
              ₹{inr(pricing.price)}
            </p>
          )}
          {quantity > 1 && (
            <p className="text-neutral-400 text-[11px]">₹{inr(pricing.payable)} each</p>
          )}
        </div>
      </div>

      {/* The course. One login per customer, so it has no quantity and never
          changes with the book count — said plainly, because someone ordering
          three copies as gifts will otherwise assume they get three logins. */}
      <div className={rowCls}>
        <span className="flex-shrink-0 w-11 h-14 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-500/20 flex items-center justify-center">
          <Gift className="w-5 h-5 text-primary-500" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-neutral-900 dark:text-white leading-tight">
            {OFFER.bonusTitle}
          </p>
          <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-0.5">
            {NLP_COURSE.modules} modules · {NLP_COURSE.videos} videos · online
          </p>
          <p className="text-primary-600 dark:text-primary-400 text-[11px] font-medium mt-0.5">
            Unlocked instantly after payment
            {quantity > 1 && " · one login per order"}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="inline-flex px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 text-[11px] font-bold text-green-700 dark:text-green-400">
            Included
          </span>
        </div>
      </div>
    </div>
  );
}

/** − 1 + on the book line. Bounded at both ends by lib/quantity.ts. */
function Stepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const btn =
    "w-7 h-7 flex items-center justify-center rounded-lg border border-neutral-300 dark:border-white/15 text-neutral-600 dark:text-neutral-300 transition-colors enabled:hover:border-neutral-500 enabled:hover:text-neutral-900 dark:enabled:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center gap-2 mt-2">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= 1}
        aria-label="One book fewer"
        className={btn}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span
        className="min-w-6 text-center text-sm font-bold text-neutral-900 dark:text-white tabular-nums"
        aria-live="polite"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= MAX_BOOKS}
        aria-label="One book more"
        className={btn}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      {value >= MAX_BOOKS && (
        <span className="text-[10px] text-neutral-400">max {MAX_BOOKS}</span>
      )}
    </div>
  );
}

/**
 * "Make it a gift" — wrapping plus a written card.
 *
 * Collapsed to a single line until it's ticked, because most orders aren't
 * gifts and a message box sitting open above the pay button is one more thing
 * to read past. The price is on the label rather than revealed after ticking:
 * a charge that appears only once you've committed is the kind of surprise
 * people abandon a checkout over.
 *
 * The message is optional even when the box is ticked. Someone may just want
 * the paper.
 *
 * Signing lives inside this box rather than beside it, and only appears once
 * the box is ticked. It is sold as part of the gift, not as a third line on the
 * page — and a checkout that grows a new priced checkbox for everyone, most of
 * whom are buying a book for themselves, is a checkout that converts worse.
 *
 * Renders nothing at all when wrapping is switched off in the admin. A greyed
 * out option with no explanation is worse than no option: it reads as a broken
 * page at the moment someone is deciding whether to trust you with a card.
 */
export function GiftOption({
  settings,
  checked,
  onChange,
  message,
  onMessage,
  signed,
  onSigned,
  quantity,
  disabled,
}: {
  /** What the add-ons cost, and whether each is on offer at all. */
  settings: GiftSettings;
  checked: boolean;
  onChange: (next: boolean) => void;
  message: string;
  onMessage: (next: string) => void;
  /** Sign the books before wrapping them. Free — see lib/gift.ts. */
  signed: boolean;
  onSigned: (next: boolean) => void;
  /** Copies in the basket, so the label can say "books" rather than "book". */
  quantity: number;
  disabled?: boolean;
}) {
  const left = MAX_GIFT_MESSAGE - message.length;

  if (!settings.isEnabled) return null;

  return (
    <div
      className={`mb-5 rounded-2xl border transition-colors ${
        checked
          ? "border-primary-300 dark:border-primary-500/40 bg-primary-50/60 dark:bg-primary-900/10"
          : "border-neutral-200 dark:border-white/8 bg-neutral-50 dark:bg-neutral-800/40"
      }`}
    >
      <label className="flex items-start gap-3 p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 flex-shrink-0 accent-primary-500 cursor-pointer disabled:cursor-not-allowed"
        />
        <span className="flex-1 min-w-0">
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm text-neutral-900 dark:text-white flex items-center gap-1.5">
              <Gift className="w-4 h-4 text-primary-500" /> Premium gift package
            </span>
            <span className="font-bold text-sm text-neutral-900 dark:text-white flex-shrink-0">
              +₹{inr(giftRupees(settings))}
            </span>
          </span>
          <span className="block text-neutral-500 dark:text-neutral-400 text-xs mt-1 leading-relaxed">
            Hand-wrapped with your message on a card, <span className="text-primary-600 dark:text-primary-400 font-medium">plus option for signed copies</span>
          </span>
        </span>
      </label>

      {checked && (
        <div className="px-4 pb-4">
          {settings.signedIsEnabled && (
            <label className="flex items-start gap-3 mb-4 cursor-pointer rounded-xl border border-primary-200 dark:border-primary-500/30 bg-white/70 dark:bg-neutral-800/50 p-3">
              <input
                type="checkbox"
                checked={signed}
                disabled={disabled}
                onChange={(e) => onSigned(e.target.checked)}
                className="mt-0.5 w-4 h-4 flex-shrink-0 accent-primary-500 cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-neutral-900 dark:text-white flex items-center gap-1.5">
                    <PenLine className="w-4 h-4 text-primary-500" /> Signed by
                    Bisher
                  </span>
                  {/* Said in the same slot the wrapping fee occupies, so the
                      eye that went looking for a price finds the answer there
                      rather than having to conclude it from a total that did
                      not move. */}
                  <span className="font-bold text-sm text-green-600 dark:text-green-400 flex-shrink-0">
                    Free
                  </span>
                </span>
                <span className="block text-neutral-500 dark:text-neutral-400 text-xs mt-1 leading-relaxed">
                  {quantity > 1
                    ? `All ${quantity} copies signed by hand before wrapping`
                    : "Signed by hand before it is wrapped"}
                </span>
              </span>
            </label>
          )}

          <label
            htmlFor="gift-message"
            className="text-xs font-semibold text-neutral-500 uppercase tracking-wider block mb-1.5"
          >
            Message on the card{" "}
            <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <textarea
            id="gift-message"
            value={message}
            disabled={disabled}
            // Hard-capped as well as counted: the card is a fixed size, and a
            // message we silently trim later is one the customer never agreed to.
            maxLength={MAX_GIFT_MESSAGE}
            onChange={(e) => onMessage(e.target.value)}
            rows={2}
            placeholder="Happy birthday Rahul — break the patterns!"
            className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors resize-none"
          />
          <p
            className={`text-[11px] mt-1 text-right ${
              left <= 15 ? "text-amber-600 dark:text-amber-400" : "text-neutral-400"
            }`}
          >
            {left} characters left
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The arithmetic, with every line the customer was promised.
 *
 * The zero rows stay visible rather than being folded into the total: a bill
 * that lists what you are *not* being charged for is the one people trust.
 */
export function OrderTotals({
  pricing,
  promo,
  totalPaise,
  quantity,
  giftPaise = 0,
}: {
  pricing: ProductPricing;
  promo: AppliedPromo | null;
  totalPaise: number;
  quantity: number;
  /** Wrapping, when it was asked for. Zero on an ordinary order. */
  giftPaise?: number;
}) {
  // What the offer takes off: the book's own discount on every copy, the whole
  // course, and any promo on top. The course counts once however many books are
  // ordered — it's one login per customer, so a second copy doesn't double it.
  const bookSaving =
    (pricing.offerPrice != null ? pricing.price - pricing.payable : 0) * quantity;
  const saved = bookSaving + OFFER.mrpRupees + (promo ? rupees(promo.discountPaise) : 0);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
        <span>{quantity > 1 ? `Books × ${quantity}` : "Book"}</span>
        <span className="text-neutral-900 dark:text-white">
          ₹{inr(pricing.payable * quantity)}
        </span>
      </div>

      {/* The course is ₹0 because the offer zeroed it, and the line says which
          offer — otherwise the saving below arrives from nowhere. */}
      <div className="flex justify-between items-start text-neutral-500 dark:text-neutral-400">
        <span className="min-w-0">
          {OFFER.bonusTitle}
          <span className="block text-[11px] text-green-600 dark:text-green-400 font-medium">
            Welcome offer applied
          </span>
        </span>
        <span className="flex items-baseline gap-1.5 flex-shrink-0">
          <span className="text-neutral-400 line-through text-xs">
            ₹{inr(OFFER.mrpRupees)}
          </span>
          <span className="text-green-600 dark:text-green-400 font-medium">₹0</span>
        </span>
      </div>
      <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
        <span>Delivery charge</span>
        <span className="text-green-600 dark:text-green-400 font-medium">₹0</span>
      </div>
      {promo && (
        <div className="flex justify-between text-green-600 dark:text-green-400">
          <span>Discount ({promo.code})</span>
          <span>−₹{inr(rupees(promo.discountPaise))}</span>
        </div>
      )}

      {/* Below the discount, because it is the one line here that adds. Sitting
          it among the ₹0 rows above would read as another thing included. */}
      {giftPaise > 0 && (
        <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
          <span className="flex items-center gap-1.5">
            <Gift className="w-3.5 h-3.5 text-primary-500" /> Gift wrapping
          </span>
          <span className="text-neutral-900 dark:text-white">
            ₹{inr(rupees(giftPaise))}
          </span>
        </div>
      )}

      <div className="flex justify-between font-bold text-base pt-2 border-t border-neutral-200 dark:border-white/8 mt-2">
        <span>Total payable</span>
        <span className="text-primary-600 dark:text-primary-400">
          ₹{inr(rupees(totalPaise))}
        </span>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg py-1.5 mt-1">
        <Check className="w-3.5 h-3.5" /> You save ₹{inr(saved)} on this order
      </p>
    </div>
  );
}

/**
 * Who is taking the money.
 *
 * Two lines and no more. A wall of compliance badges at the moment of paying
 * protests too much — naming a processor people already trust does the work,
 * and the accepted methods answer the only other question anyone has here.
 */
/**
 * When the book comes, and what does not wait for it.
 *
 * This was one line in each of the two checkout forms, saying "5–7 business
 * days" — a promise that stopped being true the moment the 3rd edition sold
 * out and every order became a pre-order against a print run.
 *
 * Two facts, in this order. The wait is stated first and plainly, because a
 * delivery estimate a buyer discovers afterwards is a refund; and the course is
 * stated second, because "you get the course today" only reassures somebody who
 * has already been told what they are waiting for. Softening the first with the
 * second — or leading with the second — is how a page ends up sounding like it
 * is managing you.
 *
 * One component rather than two copies, so the promise cannot drift between the
 * Magic and Standard checkouts. They are different forms, not different offers.
 */
export function DeliveryPromise({ preorder }: { preorder: PreorderFacts }) {
  return (
    <div className="mt-2.5 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800/60 divide-y divide-neutral-200 dark:divide-white/10 overflow-hidden">
      <div className="flex items-center gap-3 px-3.5 py-3 text-xs text-neutral-600 dark:text-neutral-400">
        <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-neutral-200 dark:bg-white/10">
          <Truck className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
        </span>
        <span>
          4th edition — delivery in{" "}
          <strong className="text-neutral-900 dark:text-white font-semibold">
            {preorder.deliveryDays} days
          </strong>
          , free across India.
          <span className="block text-neutral-500 dark:text-neutral-500 mt-0.5">
            Order today and it should reach you around {preorder.arrivesBy}.
          </span>
        </span>
      </div>

      <div className="flex items-center gap-3 px-3.5 py-3 text-xs text-green-700 dark:text-green-400">
        <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-green-100 dark:bg-green-500/15">
          <Zap className="w-3.5 h-3.5" />
        </span>
        <span>
          The <strong className="font-semibold">NLP Mastery course opens immediately</strong> —
          you do not wait for the book to start.
        </span>
      </div>

      {/* Only while there is a deadline. A checkout still advertising an offer
          that ended is worse than one that never mentioned it. */}
      {preorder.live && (
        <div className="flex items-center gap-3 px-3.5 py-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50/70 dark:bg-amber-500/10">
          <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-500/15">
            <CalendarClock className="w-3.5 h-3.5" />
          </span>
          <span>
            This price holds until{" "}
            <strong className="font-semibold">{preorder.day}</strong>. It goes up
            for the 4th edition after that.
          </span>
        </div>
      )}
    </div>
  );
}

export function PaymentTrust() {
  return (
    <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800/60 px-3.5 py-3">
      <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
        <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-neutral-900 dark:text-white">
          Payments powered by <span className="text-[#3395FF]">Razorpay</span>
        </p>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          {["UPI", "Visa", "Mastercard", "RuPay", "Net Banking"].join(" · ")}
        </p>
      </div>
    </div>
  );
}
