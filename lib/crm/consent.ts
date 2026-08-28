/**
 * The stop flag.
 *
 * Once someone says stop, messaging them again must be impossible rather than
 * merely discouraged. That is enforced in two places: here, where the flag is
 * set and cleared, and in `assertSendable()`, where it is the first check and
 * has no exemption.
 *
 * Nothing in this file throws. A consent write that failed loudly in the
 * middle of a webhook would leave Meta retrying the delivery, and a retried
 * inbound message must never be able to *un*-set a flag.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Words that set the flag.
 *
 * Malayalam matters at least as much as English here — customers of this shop
 * write in Malayalam, and an opt-out list that only understood English would
 * quietly fail for most of the people using it.
 *
 * Matched as whole words against normalised text (see `normalise`), so a
 * message that merely contains these letters inside a longer word does not
 * trigger. The Malayalam entries are matched as substrings instead: Malayalam
 * is agglutinative and "വേണ്ട" legitimately appears joined to what precedes
 * it, where an English-style word boundary would never match.
 */
const STOP_WORDS_LATIN = [
  "stop",
  "unsubscribe",
  "unsubscibe",
  "remove me",
  "dont message",
  "do not message",
  "dont send",
  "do not send",
  "no message",
  "leave me alone",
  // Manglish — Malayalam typed in Latin script, which is how a great many
  // people actually reply.
  "venda",
  "vendaa",
  "nirthu",
  "nirthuka",
  "message venda",
  "msg venda",
  "ayakkaruth",
  "ayakkaruthu",
];

const STOP_WORDS_MALAYALAM = [
  "നിർത്തുക",
  "നിര്‍ത്തുക",
  "വേണ്ട",
  "അയക്കരുത്",
  "അയയ്ക്കരുത്",
  "മെസ്സേജ് വേണ്ട",
  "മെസേജ് വേണ്ട",
  "ഒഴിവാക്കുക",
];

/**
 * Flatten a message for matching.
 *
 * Zero-width joiners are stripped because Malayalam text carries them around
 * conjuncts, and the same word copied from two keyboards differs only by an
 * invisible character. Punctuation goes for the same reason: "STOP." and
 * "stop" are one intent.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[.,!?;:"'()\[\]{}<>@#*_~`|\\/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this inbound message ask us to stop?
 *
 * Returns the phrase that matched, so the opt-out reason can record what the
 * customer actually wrote rather than a generic "opted out".
 *
 * Biased towards saying yes. A false positive costs one customer their
 * messages, which they can ask to reverse; a false negative costs the number
 * its quality rating, which nobody can reverse.
 */
export function stopWordIn(text: string | null | undefined): string | null {
  if (!text) return null;

  for (const word of STOP_WORDS_MALAYALAM) {
    if (text.includes(word)) return word;
  }

  const flat = normalise(text);
  if (!flat) return null;

  for (const phrase of STOP_WORDS_LATIN) {
    // Whole-word (or whole-phrase) match, so "stopped by the shop" is not an
    // opt-out but "stop" and "please stop" both are.
    const pattern = new RegExp(`(^|\\s)${phrase.replace(/\s+/g, "\\s+")}(\\s|$)`);
    if (pattern.test(flat)) return phrase;
  }

  return null;
}

export type OptOutSource = "customer" | "staff" | "system";

/**
 * Set the flag.
 *
 * Idempotent, and deliberately one-directional: an existing opt-out is never
 * overwritten with a later one, so the record keeps the moment consent was
 * first withdrawn rather than the most recent time somebody said it again.
 */
export async function setOptOut(
  contactId: string,
  reason: string,
  source: OptOutSource
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_contacts")
      .update({
        opt_out_at: new Date().toISOString(),
        opt_out_reason: reason.slice(0, 500),
        opt_out_source: source,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
      .is("opt_out_at", null)
      .select("id");

    if (error) {
      console.error("[Consent] opt-out write failed:", contactId, error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (e) {
    console.error("[Consent] opt-out threw:", contactId, e);
    return false;
  }
}

/**
 * Clear the flag.
 *
 * Only ever called from one admin route, which requires `crm.consent` and
 * writes an audit row naming who did it. There is deliberately no bulk clear
 * and no import path that can reach this — the only way back in is one person,
 * one contact, one typed reason.
 */
export async function clearOptOut(contactId: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from("whatsapp_contacts")
      .update({
        opt_out_at: null,
        opt_out_reason: null,
        opt_out_source: null,
        failed_streak: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId);

    if (error) {
      console.error("[Consent] clear failed:", contactId, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[Consent] clear threw:", contactId, e);
    return false;
  }
}

/** Marketing needs a positive signal, not merely the absence of a stop. */
export async function setMarketingOptIn(
  contactId: string,
  optedIn: boolean
): Promise<void> {
  try {
    await supabaseAdmin
      .from("whatsapp_contacts")
      .update({
        marketing_opt_in_at: optedIn ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId);
  } catch (e) {
    console.error("[Consent] marketing opt-in write failed:", contactId, e);
  }
}

/**
 * How many undeliverable sends in a row before we assume we were blocked.
 *
 * Meta never tells you a customer blocked you. A run of sends that Meta itself
 * declined to deliver is the closest signal there is, and continuing to push
 * at a number that keeps refusing is what turns one block into a rating.
 */
const BLOCK_STREAK = 3;

/**
 * Record a delivery failure, and stop by ourselves if it keeps happening.
 *
 * Returns true when this failure was the one that set the flag.
 */
export async function noteDeliveryFailure(
  contactId: string,
  code: number | null | undefined
): Promise<boolean> {
  // Codes that mean Meta would not deliver it, as opposed to a transport
  // problem on our side. Only these count towards the streak.
  const UNDELIVERABLE = new Set([131026, 131049, 131047, 470]);
  if (code === undefined || code === null || !UNDELIVERABLE.has(code)) {
    return false;
  }

  try {
    const { data } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("failed_streak, opt_out_at")
      .eq("id", contactId)
      .maybeSingle();

    if (!data || data.opt_out_at) return false;

    const streak = (data.failed_streak ?? 0) + 1;
    await supabaseAdmin
      .from("whatsapp_contacts")
      .update({ failed_streak: streak, updated_at: new Date().toISOString() })
      .eq("id", contactId);

    if (streak >= BLOCK_STREAK) {
      return await setOptOut(
        contactId,
        `${streak} undeliverable sends in a row (last code ${code}) — assumed blocked`,
        "system"
      );
    }
    return false;
  } catch (e) {
    console.error("[Consent] failure streak write failed:", contactId, e);
    return false;
  }
}

/** A successful delivery means whatever was wrong isn't any more. */
export async function clearFailureStreak(contactId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("whatsapp_contacts")
      .update({ failed_streak: 0 })
      .eq("id", contactId)
      .gt("failed_streak", 0);
  } catch {
    // Best effort. A stale streak costs nothing until it reaches the limit,
    // and the next success clears it.
  }
}
