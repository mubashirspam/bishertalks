/**
 * Matching India Post's booking rows to our orders by name and pincode.
 *
 * The last resort, and it is deliberately treated as one.
 *
 * Every other way of connecting a parcel to an order is an identifier that one
 * side minted and the other stored: the article number, the waybill, our own
 * reference. Those cannot be wrong. This one can — two customers can share a
 * name, and a name typed at a post office counter is not the name typed at
 * checkout. So nothing here decides anything. It produces a ranked opinion with
 * the evidence attached, and a person approves it.
 *
 * WHAT IT IS FOR. Parcels booked over the counter carry the post office's own
 * docket ("1103/1") instead of our reference, and the article number they were
 * given was never recorded here. Those parcels are invisible to the tracking
 * import — it reports them as "matches no parcel here" — and they stay at
 * Handed over forever. Their booking export carries the receiver's name and
 * destination pincode, which is enough to find them.
 *
 * ── The rule that makes this safe ──
 *
 * THE PINCODE MUST AGREE. Always, in every tier below. A name alone is a guess;
 * a name plus the pincode the parcel was actually sent to is a different order
 * of evidence, because the pincode was typed by the post office off the label
 * we printed. Matching on the name alone would attach parcels to the wrong
 * customers, and a wrong attachment here later marks the wrong order delivered
 * and approves a referral commission nobody earned.
 *
 * And where a name plus a pincode still identifies more than one order, that is
 * reported as ambiguous rather than resolved by picking the first. Two people
 * called Muhammed Ashraf in one pincode is not a rare event in Kerala.
 */

/** How the name was matched, strongest first. */
export type MatchTier = "exact" | "initials" | "tokens";

export const TIER_LABELS: Record<MatchTier, string> = {
  exact: "name matches exactly",
  initials: "name matches ignoring initials",
  tokens: "every word of the shorter name appears in the longer",
};

/**
 * A name, reduced to what can be compared.
 *
 * Upper-cased, punctuation dropped, whitespace collapsed. Honorifics go too:
 * "MR MUHAMMED FIRAZ" and "MUHAMMED FIRAZ" are the same person, and the post
 * office counter adds them about as often as our checkout does not.
 */
export function normaliseName(raw: string): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\b(MR|MRS|MS|MISS|DR|SHRI|SMT|SRI)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The words of a name, with single letters — Indian initials — dropped. */
export function nameTokens(normalised: string): string[] {
  return normalised.split(" ").filter((t) => t.length > 1);
}

/** Just the digits, six of them, or null. */
export function normalisePin(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

/**
 * How well two names agree, or null if they do not.
 *
 * Three tiers, and the caller is told which one fired so a person approving a
 * page of these can read down the confidence column rather than re-deciding
 * each row.
 *
 *   exact      identical once normalised
 *   initials   identical once single-letter initials are dropped. "SREELESH
 *              P T" and "SREELESH" are the same customer; the counter clerk
 *              copies the initials off the label and our checkout often does
 *              not collect them.
 *   tokens     every word of the shorter name appears in the longer one, and
 *              there are at least two such words. One-word agreement is not a
 *              match — "MUHAMMED" alone would tie half a district together.
 */
export function nameAgreement(a: string, b: string): MatchTier | null {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return null;

  if (na === nb) return "exact";

  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  if (!ta.length || !tb.length) return null;

  if (ta.join(" ") === tb.join(" ")) return "initials";

  // Every word of the shorter inside the longer. Two-word minimum, so a single
  // shared forename cannot carry a match on its own.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return null;

  const set = new Set(long);
  return short.every((t) => set.has(t)) ? "tokens" : null;
}

/** One row of their booking export, reduced to what matching needs. */
export interface BookingRow {
  article: string;
  receiverName: string;
  receiverAddress: string | null;
  pincode: string | null;
  bookedAt: string | null;
  /** Their docket, or our reference where the parcel was booked through the portal. */
  reference: string | null;
  event: string | null;
}

/** One of our parcels, as the matcher sees it. */
export interface CandidateOrder {
  order_number: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  pincode: string | null;
  city: string | null;
  status: string;
  /** Which partner is carrying it, or null. Decides where the number is written. */
  courier_id: string | null;
  /**
   * Whether the money landed.
   *
   * Carried into the matcher rather than filtered out before it, and that is
   * the point. Every other screen here defines a parcel as a PAID order with an
   * address — but India Post is holding a physical book, and a booking whose
   * order reads `failed` or `pending` is not a bad match, it is a real parcel
   * against an order this system believes was never paid for.
   *
   * Filtering those out before matching hides exactly the rows most worth
   * seeing. They come back as `matched_unpaid` instead.
   */
  payment_status: string;
  ordered_at: string;
  postal_barcode: string | null;
  tracking_number: string | null;
  courier_reference: string | null;
}

export type Verdict =
  /** Their article number is already stored against one of our orders. */
  | "already_linked"
  /** One order, name and pincode both agree. Safe to approve. */
  | "matched"
  /**
   * Name and pincode agree, but our record says the money never arrived.
   *
   * Its own verdict rather than a match, because it is two facts at once: the
   * parcel is identified, AND an order marked unpaid had a book posted against
   * it. The first is useful and the second needs somebody to look, so putting
   * it in with the clean matches would let it be approved without being read.
   */
  | "matched_unpaid"
  /** Several orders agree equally well. A person picks, or nobody does. */
  | "ambiguous"
  /** A name agreed but the pincode did not. Deliberately NOT a match. */
  | "pincode_mismatch"
  /** Nothing here carries that name. */
  | "no_match";

export interface MatchResult {
  booking: BookingRow;
  verdict: Verdict;
  tier: MatchTier | null;
  /** The order this is proposed against, when exactly one was found. */
  order: CandidateOrder | null;
  /** Every order that agreed, for the ambiguous and mismatch cases. */
  others: CandidateOrder[];
  /** Why, in the words the report prints. */
  note: string;
}

/**
 * Match a booking export against our parcels.
 *
 * `orders` is every parcel worth considering — the caller decides that scope,
 * because "which of our orders could this be" is a question about the shop, not
 * about names.
 *
 * An order already carrying a DIFFERENT article number is not a candidate. It
 * is a parcel that has already been posted once, and attaching a second
 * article to it would silently replace a number somebody may be tracking.
 */
export function matchBookings(
  bookings: BookingRow[],
  orders: CandidateOrder[]
): MatchResult[] {
  // Every article number we already hold, whichever column it landed in.
  const known = new Map<string, CandidateOrder>();
  for (const o of orders) {
    if (o.postal_barcode) known.set(o.postal_barcode.toUpperCase(), o);
    if (o.tracking_number) known.set(o.tracking_number.toUpperCase(), o);
  }

  // Bucketed by pincode first. It is the cheap half of the test and it cuts
  // the name comparison from every order to a handful — and, more to the
  // point, it means a name can never be compared against an order in another
  // district at all.
  const byPin = new Map<string, CandidateOrder[]>();
  for (const o of orders) {
    const pin = normalisePin(o.pincode);
    if (!pin) continue;
    const list = byPin.get(pin);
    if (list) list.push(o);
    else byPin.set(pin, [o]);
  }

  /** Orders spoken for by an earlier booking in this same run. */
  const taken = new Set<string>();

  const results: MatchResult[] = [];

  // Strongest tier first across the WHOLE file, not row by row. Otherwise an
  // early row with a loose token match could claim an order that a later row
  // matches exactly, and the exact one would then be reported as unmatched.
  const pending = bookings.map((booking) => ({ booking, done: false as boolean }));

  const emit = (r: MatchResult) => results.push(r);

  // Pass 0: articles we already have. Nothing to decide.
  for (const p of pending) {
    const hit = known.get(p.booking.article.toUpperCase());
    if (!hit) continue;
    p.done = true;
    taken.add(hit.order_number);
    emit({
      booking: p.booking,
      verdict: "already_linked",
      tier: null,
      order: hit,
      others: [],
      note: `already on ${hit.order_number}`,
    });
  }

  // Passes 1-3: one tier at a time, so a stronger agreement always wins the
  // order it wants.
  for (const tier of ["exact", "initials", "tokens"] as MatchTier[]) {
    for (const p of pending) {
      if (p.done) continue;

      const pin = normalisePin(p.booking.pincode);
      if (!pin) continue;

      const candidates = (byPin.get(pin) ?? []).filter(
        (o) =>
          !taken.has(o.order_number) &&
          // Already posted under a different article. Not ours to reassign.
          !o.postal_barcode &&
          !o.tracking_number &&
          nameAgreement(p.booking.receiverName, o.buyer_name ?? "") === tier
      );

      if (!candidates.length) continue;

      // ── Twins from a retried checkout are not really ambiguous ────────────
      //
      // A customer whose payment fails and who tries again leaves two orders
      // with the same name and the same pincode — one `failed`, one `paid`.
      // Treating that as ambiguous would push the single most common shape of
      // duplicate onto a person to resolve by hand, hundreds of times, when the
      // answer is never in doubt: the book was posted against the order that
      // was paid for.
      //
      // Only applied when it settles the question outright. Two PAID orders to
      // one name and pincode is a genuine ambiguity — the same customer buying
      // twice, or two people — and stays one.
      const paid = candidates.filter((o) => o.payment_status === "paid");
      const resolved = paid.length === 1 ? paid : candidates;

      if (resolved.length > 1) {
        p.done = true;
        emit({
          booking: p.booking,
          verdict: "ambiguous",
          tier,
          order: null,
          others: resolved,
          note:
            `${resolved.length} orders in ${pin} carry that name` +
            (paid.length > 1 ? ` (${paid.length} of them paid)` : "") +
            " — pick one by hand",
        });
        continue;
      }

      const only = resolved[0];
      p.done = true;
      taken.add(only.order_number);

      const isPaid = only.payment_status === "paid";
      emit({
        booking: p.booking,
        verdict: isPaid ? "matched" : "matched_unpaid",
        tier,
        order: only,
        others: candidates.length > 1 ? candidates.filter((c) => c !== only) : [],
        note:
          (isPaid
            ? `${TIER_LABELS[tier]}, pincode ${pin} agrees`
            : `${TIER_LABELS[tier]}, pincode ${pin} agrees — but this order's payment reads "${only.payment_status}"`) +
          (candidates.length > 1
            ? ` (chosen over ${candidates.length - 1} unpaid order(s) of the same name)`
            : ""),
      });
    }
  }

  // Whatever is left. Separating "the name is here but in another pincode"
  // from "the name is not here at all" is the difference between a row worth
  // looking at and one worth ignoring.
  for (const p of pending) {
    if (p.done) continue;

    const elsewhere = orders.filter(
      (o) =>
        !o.postal_barcode &&
        !o.tracking_number &&
        !taken.has(o.order_number) &&
        nameAgreement(p.booking.receiverName, o.buyer_name ?? "") !== null
    );

    if (elsewhere.length) {
      emit({
        booking: p.booking,
        verdict: "pincode_mismatch",
        tier: null,
        order: null,
        others: elsewhere.slice(0, 5),
        note:
          `name matches ${elsewhere.length} order(s), but the pincode does not — ` +
          `posted to ${normalisePin(p.booking.pincode) ?? "?"}, ours says ` +
          elsewhere
            .slice(0, 3)
            .map((o) => normalisePin(o.pincode) ?? "?")
            .join(", "),
      });
      continue;
    }

    emit({
      booking: p.booking,
      verdict: "no_match",
      tier: null,
      order: null,
      others: [],
      note: "no order here carries that name",
    });
  }

  // Back into the file's own order, so a person reading the report alongside
  // the spreadsheet they exported is looking at the same sequence.
  const position = new Map(bookings.map((b, i) => [b.article, i]));
  results.sort(
    (a, b) =>
      (position.get(a.booking.article) ?? 0) - (position.get(b.booking.article) ?? 0)
  );

  return results;
}
