import Link from "next/link";
import {
  Package,
  GraduationCap,
  BookOpen,
  Truck,
  Gift,
  PenLine,
  MapPin,
} from "lucide-react";

/**
 * The order, in full, behind the "Order Details" button on the confirmation.
 *
 * A different job from the tracking view, which answers "where is my parcel".
 * This answers the three questions that arrive by WhatsApp in the days after a
 * purchase, in the order they arrive: what exactly did I buy, how do I get
 * into the course, and what am I supposed to do with the book.
 *
 * English for the receipt, Malayalam for the instructions.
 *
 * The split is not arbitrary. Order number, amount, date and address are
 * reference — a customer checks them against a bank statement or reads them
 * out on a call, and the rest of the site says them in English. The login
 * steps and the reading advice are somebody being told what to do, and those
 * are in the language the shop actually talks to its customers in. The
 * reading lines are word for word what the follow-up messages already send.
 *
 * Light-first with dark variants, like the rest of the site. The theme comes
 * from next-themes, which defaults to light and has a toggle in the header —
 * so a page painted only in dark colours stays dark in light mode, which is
 * what this one did until the classes below gained their `dark:` halves.
 *
 * Reached by order number alone, like the tracking view, so it shows what a
 * receipt shows and no more: no payment reference, no full phone number
 * beyond the one they type to log in, nothing that would matter if the link
 * were forwarded.
 */

export interface DetailsOrder {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  amount_paise: number;
  quantity: number | null;
  is_gift: boolean | null;
  is_signed: boolean | null;
  payment_status: string;
  status: string;
  ordered_at: string;
}

const CARD =
  "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/8 " +
  "rounded-2xl p-6 mb-5 shadow-sm dark:shadow-none";
const HEADING =
  "font-semibold text-sm text-neutral-700 dark:text-neutral-300 mb-4 " +
  "flex items-center gap-2";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="text-right text-neutral-900 dark:text-white">{value}</span>
    </div>
  );
}

export default function OrderDetails({
  order,
  courseUrl,
  courseTitle,
}: {
  order: DetailsOrder;
  courseUrl: string;
  courseTitle: string;
}) {
  const date = new Date(order.ordered_at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const copies = order.quantity ?? 1;
  const paid = order.payment_status === "paid";

  const address = [
    order.address_line1,
    order.address_line2,
    [order.city, order.district].filter(Boolean).join(", "),
    [order.state, order.pincode].filter(Boolean).join(" "),
  ]
    .filter((l) => l && l.trim())
    .join("\n");

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900 dark:bg-neutral-950 dark:text-white">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <Link
            href="/neuro-code"
            className="text-sm text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
          >
            ← Neuro Code
          </Link>
          <h1 className="mt-3 text-2xl font-black">Order Details</h1>
          <p className="mt-1 font-mono text-sm text-neutral-500 dark:text-neutral-400">
            {order.order_number}
          </p>
        </div>

        {/* ── 1 · What they bought ─────────────────────────────────────── */}
        <div className={CARD}>
          <h2 className={HEADING}>
            <Package className="h-4 w-4 text-primary-600 dark:text-primary-400" /> Order Details
          </h2>
          <div className="space-y-3 text-sm">
            <Row label="Book" value="Neuro Code — Bisher KC" />
            {copies > 1 && <Row label="Copies" value={String(copies)} />}
            <Row
              label="Amount paid"
              value={
                <span className="font-bold text-primary-600 dark:text-primary-400">
                  ₹{Math.round(order.amount_paise / 100)}
                </span>
              }
            />
            <Row label="Order date" value={date} />
            {order.buyer_name && <Row label="Name" value={order.buyer_name} />}
          </div>

          {/* The two things a customer worries were missed, shown only when
              they apply — a badge saying "not a gift" would be noise. */}
          {(order.is_gift || order.is_signed) && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-neutral-200 pt-4 dark:border-white/8">
              {order.is_gift && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                  <Gift className="h-3 w-3" /> Gift wrapped
                </span>
              )}
              {order.is_signed && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                  <PenLine className="h-3 w-3" /> Signed copy
                </span>
              )}
            </div>
          )}

          {address && (
            <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-white/8">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <MapPin className="h-3 w-3" /> Delivery address
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700 dark:text-neutral-200">
                {address}
              </p>
            </div>
          )}
        </div>

        {/* ── 2 · The course ───────────────────────────────────────────── */}
        {/*
          Only on a paid order. The course is what the payment unlocks, and an
          unpaid order showing a course link is an invitation to skip paying.

          This is also the page that carries course access at all: the WhatsApp
          template for it has been refused five times, so the announcement was
          held (see HELD_EVENTS). The instructions have to live somewhere the
          customer can reach, and this is it.
        */}
        {paid && (
          <div className={CARD}>
            <h2 className={HEADING}>
              <GraduationCap className="h-4 w-4 text-primary-600 dark:text-primary-400" /> Course access
            </h2>

            <div className="mb-4 space-y-3 text-sm">
              <Row label="Course" value={courseTitle} />
              <Row
                label="Price"
                value={
                  <span className="text-green-600 dark:text-green-400">₹0 — free with the book</span>
                }
              />
              <Row label="Validity" value="1 year" />
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/8 dark:bg-neutral-950/60">
              <p className="mb-2.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                എങ്ങനെ ലോഗിൻ ചെയ്യാം
              </p>
              <ol className="space-y-2 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                <li className="flex gap-2.5">
                  <span className="shrink-0 text-primary-600 dark:text-primary-400">1.</span>
                  <span>താഴെയുള്ള ബട്ടൺ ഉപയോഗിച്ച് കോഴ്‌സ് പേജ് തുറക്കുക</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="shrink-0 text-primary-600 dark:text-primary-400">2.</span>
                  <span>
                    ഓർഡർ ചെയ്ത മൊബൈൽ നമ്പർ നൽകുക
                    {order.buyer_phone && (
                      <span className="ml-1 font-mono text-neutral-900 dark:text-white">
                        ({order.buyer_phone})
                      </span>
                    )}
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="shrink-0 text-primary-600 dark:text-primary-400">3.</span>
                  {/* The single most-asked question this page can pre-empt. */}
                  <span>പാസ്‌വേഡ് വേണ്ട — നമ്പർ മാത്രം മതി</span>
                </li>
              </ol>
            </div>

            <a
              href={courseUrl}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-primary-600"
            >
              <GraduationCap className="h-4 w-4" /> Open course
            </a>
          </div>
        )}

        {/* ── 3 · What to do with the book ─────────────────────────────── */}
        <div className={CARD}>
          <h2 className={HEADING}>
            <BookOpen className="h-4 w-4 text-primary-600 dark:text-primary-400" /> പുസ്തകം എങ്ങനെ
            വായിക്കാം
          </h2>
          {/* The one section that stays Malayalam, on purpose. Everything
              above is a receipt and reads the same in either language; this is
              encouragement, and it is word for word what the shop already
              sends in its reading follow-ups. Meeting the same advice twice in
              two languages would make one of them sound like a translation. */}
          <ul className="space-y-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            <li className="flex gap-2.5">
              <span className="shrink-0 text-primary-600 dark:text-primary-400">•</span>
              <span>
                ദിവസവും 10-15 minutes മാറ്റിവെച്ചാൽ നല്ല progress ഉണ്ടാകും.
                ചെറിയ consistency മതി.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="shrink-0 text-primary-600 dark:text-primary-400">•</span>
              <span>
                ഓരോ അധ്യായത്തിലെയും activities ചെയ്യാൻ മറക്കരുത് — അതാണ് result
                കാണാൻ സഹായിക്കുന്നത്.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="shrink-0 text-primary-600 dark:text-primary-400">•</span>
              <span>
                ഇന്ന് തന്നെ 2 pages വായിച്ച് തുടങ്ങൂ. ചെറിയ തുടക്കം തന്നെ വലിയ
                മാറ്റത്തിന്റെ beginning ആണ്.
              </span>
            </li>
          </ul>
        </div>

        {/* ── 4 · Tracking, last ───────────────────────────────────────── */}
        {/* Last on purpose: somebody who opened *this* button wanted the order,
            not the parcel. The way back to the parcel still has to be here,
            because it is the other half of the same question. */}
        <Link
          href={`/neuro-code/track?id=${order.order_number}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-4 text-sm font-semibold text-neutral-900 shadow-sm transition-all hover:border-neutral-300 dark:border-white/10 dark:bg-neutral-900 dark:text-white dark:shadow-none dark:hover:border-white/20"
        >
          <Truck className="h-4 w-4 text-primary-600 dark:text-primary-400" /> Track order
        </Link>

        <div className="mt-5 flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-white/8 dark:bg-neutral-900 dark:shadow-none">
          <div>
            <p className="text-sm font-medium">Need help?</p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-500">
              We&rsquo;re here to assist you
            </p>
          </div>
          <a
            href={`https://wa.me/916282680794?text=Hi, I need help with order ${order.order_number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-4 py-2 text-xs font-medium text-green-700 transition-all hover:bg-green-100 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20"
          >
            WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
