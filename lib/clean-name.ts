/**
 * A buyer's name, cleaned rather than rejected.
 *
 * This runs on a name that is about to be printed on a shipping label and
 * handed to a courier, so the standard is "will a postman read this", not
 * "does it match a pattern".
 *
 * ── Why it cleans instead of refusing ───────────────────────────────────
 *
 * The customer typing this has already paid. A validation error at this point
 * costs a delivery address, and every rule below is something we can simply
 * fix ourselves:
 *
 *   trailing spaces      invisible, and the label centres text — a name with
 *                        four trailing spaces prints off-centre
 *   double spaces        a paste artefact, never intentional
 *   emoji                courier sheets are .xlsx and India Post's validator
 *                        refuses non-Latin symbols in a name field; the whole
 *                        file is rejected for one, so one buyer's 😊 costs
 *                        everybody in that batch their parcel that day
 *
 * None of that is worth an error message. The one thing that IS worth
 * refusing — a name too short to be a name — is refused by the caller, not
 * here, because only the caller knows whether it can afford to.
 *
 * ── What is deliberately kept ───────────────────────────────────────────
 *
 * Malayalam, and every other script. This shop's customers write their names
 * in Malayalam and the courier reads Malayalam. Stripping to ASCII would
 * mangle a real name into an unreadable one, which is the exact failure this
 * function exists to prevent. Only pictographs go.
 *
 * Dots, apostrophes and hyphens stay too: "Asif P.", "D'Cruz" and
 * "Abdul-Rahman" are all names people actually have.
 */

/**
 * Pictographs, dingbats, flags and the modifiers that join them.
 *
 * Written as explicit ranges rather than \p{Emoji}, which is far broader than
 * it sounds — it matches the digits 0-9 and '#' and '*', so a name containing
 * a house number would come back with the number missing.
 */
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}]/gu;

/** The minimum that can plausibly be a name. Two initials and a stop is 3. */
export const NAME_MIN = 3;

/**
 * Clean a name for storage. Never throws, never returns undefined.
 *
 * Idempotent: cleaning an already-clean name changes nothing, so it is safe on
 * every write path including the ones that re-save an unchanged row.
 */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(EMOJI, "")
    // Every kind of space — including the non-breaking space a paste from
    // WhatsApp Web brings with it — collapsed to one ordinary one.
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this long enough to be a name, once cleaned?
 *
 * Counted in code points, not UTF-16 units: a three-letter Malayalam name is
 * three characters to a reader and can be more than three `.length`, and a
 * rule that counts bytes would accept or refuse names by script.
 */
export function isUsableName(raw: unknown): boolean {
  return [...cleanName(raw)].length >= NAME_MIN;
}
