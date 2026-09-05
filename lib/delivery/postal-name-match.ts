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
export type MatchTier = "exact" | "initials" | "tokens" | "fuzzy";

export const TIER_LABELS: Record<MatchTier, string> = {
  exact: "name matches exactly",
  initials: "name matches ignoring initials",
  tokens: "every word of the shorter name appears in the longer",
  fuzzy: "name is a near-spelling, above the similarity threshold",
};

/** Below this, two names are not the same person. Overridable per call. */
export const DEFAULT_SIMILARITY = 0.8;

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

// ── Similarity, for the names the three tiers above cannot reach ────────────
//
// The tiers are all-or-nothing: they compare whole words, so one transposed
// letter fails every one of them. That is most of what a post office counter
// produces. "SREEKUMAR MK" against "Sreekumàr M K" is the same customer and
// matches at `initials`; "GOOPKUMAR K V" against "Gopakumar k v" is also the
// same customer and matches nothing at all, because "GOOPKUMAR" is not
// "GOPAKUMAR" and no amount of word comparison will make it so.
//
// So this measures how far apart two names are per character, and the caller
// decides where to draw the line. It is deliberately the LAST tier: a score is
// a weaker kind of evidence than an agreement, and anything the strict tiers
// can claim, they claim first.

/** Edit distance, with a rolling two-row table rather than a full matrix. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Edit distance as a 0-1 agreement, so length does not decide the score. */
const ratio = (a: string, b: string): number =>
  !a.length && !b.length ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length);

/**
 * How alike two names are, 0 to 1.
 *
 * Compared three ways, best wins, because the two sides disagree about word
 * ORDER as often as they disagree about spelling:
 *
 *   token set   the words they share, against each side's full set. This is
 *               what carries "AMJAD ABDUL KHADER M" against
 *               "Amjad Abdulkhader.M" — one side split a word the other joined.
 *   token sort  both word lists alphabetised, then compared. Survives a
 *               surname written first on one side.
 *   plain       the normalised strings as they stand, which is the only one of
 *               the three that catches a single-word name.
 *
 * Normalisation is `normaliseName`'s — upper case, no punctuation, honorifics
 * dropped — so an accent or a trailing full stop costs nothing. Single-letter
 * initials are dropped from the token comparisons for the same reason they are
 * in `nameAgreement`, but kept in the plain one, where "T S" against "TS" is
 * exactly the difference being measured.
 */
export function nameSimilarity(rawA: string, rawB: string): number {
  const na = normaliseName(rawA);
  const nb = normaliseName(rawB);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = nameTokens(na);
  const tb = nameTokens(nb);
  if (!ta.length || !tb.length) return ratio(na, nb);

  const sa = new Set(ta);
  const sb = new Set(tb);
  const shared = [...sa].filter((t) => sb.has(t)).sort().join(" ");
  const onlyA = [shared, ...[...sa].filter((t) => !sb.has(t)).sort()].join(" ").trim();
  const onlyB = [shared, ...[...sb].filter((t) => !sa.has(t)).sort()].join(" ").trim();

  return Math.max(
    ratio(shared, onlyA),
    ratio(shared, onlyB),
    ratio(onlyA, onlyB),
    ratio([...ta].sort().join(" "), [...tb].sort().join(" ")),
    ratio(na, nb)
  );
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
  /** How alike the two names are, 0-1, or null where no name was compared. */
  score: number | null;
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
 *
 * `fuzzy` adds the similarity tier after the three strict ones, for the
 * counter's spelling. OFF by default, and deliberately so: it is the only tier
 * that can match two names no human rule says are equal, so it is something a
 * person turns on for a file they are going to read, not the standing
 * behaviour of every import.
 */
export interface MatchOptions {
  /** Allow the similarity tier. Default false. */
  fuzzy?: boolean;
  /** Where the similarity tier draws its line. Default DEFAULT_SIMILARITY. */
  threshold?: number;
}

export function matchBookings(
  bookings: BookingRow[],
  orders: CandidateOrder[],
  options: MatchOptions = {}
): MatchResult[] {
  const { fuzzy = false, threshold = DEFAULT_SIMILARITY } = options;
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

  /**
   * Unpaid matches, held back until every tier has run.
   *
   * A tier claims a booking the moment it finds one candidate, and the tiers
   * run strongest first — so an UNPAID order agreeing at `initials` consumes a
   * booking that a PAID order would have matched at `fuzzy`, and the paid
   * order is then reported as if nothing was posted for it. Pincode 679303 had
   * exactly that: their "YUSEPH P C" went to a `pending` order reading
   * "YUSEPH", while the paid "Yuseph PC" two rows down got nothing.
   *
   * This module already holds that the book was posted against the order that
   * was paid for — that is why the twins rule exists a few lines below. The
   * twins rule can only apply it WITHIN a tier, because that is the only place
   * it can see both orders at once. Deferring is the same principle across
   * tiers: an unpaid candidate is remembered, not acted on, and only becomes
   * the answer once no tier has found a paid order for that booking.
   */
  const deferred = new Map<string, { order: CandidateOrder; tier: MatchTier }>();

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
      score: null,
      order: hit,
      others: [],
      note: `already on ${hit.order_number}`,
    });
  }

  // Passes 1-3: one tier at a time, so a stronger agreement always wins the
  // order it wants.
  const tiers: MatchTier[] = fuzzy
    ? ["exact", "initials", "tokens", "fuzzy"]
    : ["exact", "initials", "tokens"];

  for (const tier of tiers) {
    for (const p of pending) {
      if (p.done) continue;

      const pin = normalisePin(p.booking.pincode);
      if (!pin) continue;

      const free = (byPin.get(pin) ?? []).filter(
        (o) =>
          !taken.has(o.order_number) &&
          // Already posted under a different article. Not ours to reassign.
          !o.postal_barcode &&
          !o.tracking_number
      );

      // The strict tiers ask whether the names AGREE, which is a yes or no.
      // The fuzzy tier asks how ALIKE they are, and only considers names the
      // strict tiers have already declined — so turning it on can never change
      // which order an agreement would have claimed, only add matches where
      // there was nothing before.
      let candidates: CandidateOrder[];

      if (tier !== "fuzzy") {
        candidates = free.filter(
          (o) => nameAgreement(p.booking.receiverName, o.buyer_name ?? "") === tier
        );
      } else {
        const scored = free
          .filter((o) => nameAgreement(p.booking.receiverName, o.buyer_name ?? "") === null)
          .map((o) => ({ o, s: nameSimilarity(p.booking.receiverName, o.buyer_name ?? "") }))
          .filter((c) => c.s >= threshold);

        // Within a strict tier every candidate is equally good, so two of them
        // is a real ambiguity. Here they are not equal — a closer name is
        // better evidence — so only the best score stays in the running, and
        // ambiguity means a genuine TIE at the top rather than two names of
        // visibly different quality.
        const best = Math.max(0, ...scored.map((c) => c.s));
        candidates = scored.filter((c) => c.s >= best - 1e-9).map((c) => c.o);
      }

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
          score: null,
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

      // Unpaid, and a later tier may yet find the paid order this booking
      // really belongs to. Remember the best one seen and carry on.
      if (only.payment_status !== "paid") {
        if (!deferred.has(p.booking.article)) deferred.set(p.booking.article, { order: only, tier });
        continue;
      }

      p.done = true;
      taken.add(only.order_number);

      const score = nameSimilarity(p.booking.receiverName, only.buyer_name ?? "");
      emit({
        booking: p.booking,
        verdict: "matched",
        tier,
        score,
        order: only,
        others: candidates.length > 1 ? candidates.filter((c) => c !== only) : [],
        note:
          `${TIER_LABELS[tier]}${tier === "fuzzy" ? ` (${Math.round(score * 1000) / 10}%)` : ""}, pincode ${pin} agrees` +
          (candidates.length > 1
            ? ` (chosen over ${candidates.length - 1} unpaid order(s) of the same name)`
            : ""),
      });
    }
  }

  // The unpaid matches nobody paid outbid. Emitted now, under their own
  // verdict, so a book posted against an order whose payment never landed is
  // still reported — it is one of the most useful things this exercise finds.
  for (const p of pending) {
    if (p.done) continue;

    const held = deferred.get(p.booking.article);
    if (!held || taken.has(held.order.order_number)) continue;

    p.done = true;
    taken.add(held.order.order_number);

    const score = nameSimilarity(p.booking.receiverName, held.order.buyer_name ?? "");
    emit({
      booking: p.booking,
      verdict: "matched_unpaid",
      tier: held.tier,
      score,
      order: held.order,
      others: [],
      note:
        `${TIER_LABELS[held.tier]}${held.tier === "fuzzy" ? ` (${Math.round(score * 1000) / 10}%)` : ""}, ` +
        `pincode ${normalisePin(p.booking.pincode) ?? "?"} agrees — but this order's ` +
        `payment reads "${held.order.payment_status}"`,
    });
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
        score: null,
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
      score: null,
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
