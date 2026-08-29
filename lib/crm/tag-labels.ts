/**
 * Tag names and their labels. Data only — this module imports nothing.
 *
 * Split out of lib/crm/tags.ts because the admin panel is a client component
 * and needs the labels, while tags.ts talks to the database. Importing the
 * labels from there pulled the Supabase admin client into the browser bundle:
 * the service-role key is not inlined into client code, so nothing leaked,
 * but shipping a database client to a browser that can never use it is dead
 * weight and one refactor away from being worse.
 */

/** Tags the flows set. Free-form is allowed; these are the ones code knows. */
export const KNOWN_TAGS = [
  "later_buyer",
  "reminder_paused",
  "opted_out",
  "support_needed",
  "delivery_issue",
  "active_reader",
  "slow_reader",
  "not_started",
  "started_reading",
  "reading_later",
  "feedback_requested",
  "referral_interested",
  "referral_details_requested",
  "referral_link_shared",
  "referral_paused",
  "still_reading",
] as const;

export type KnownTag = (typeof KNOWN_TAGS)[number];

/**
 * Tags that mean "stop selling to this person until somebody has looked".
 *
 * A customer whose book never arrived must not receive a reading follow-up
 * three days later, and the brief says so. This is the list the scheduler
 * checks; adding a tag here is how a new kind of problem gets that protection.
 */
export const HOLD_TAGS: readonly string[] = ["delivery_issue", "support_needed"];

export const TAG_LABELS: Record<string, string> = {
  later_buyer: "Asked us to come back later",
  reminder_paused: "Reminders paused",
  opted_out: "Asked us to stop",
  support_needed: "Needs support",
  delivery_issue: "Delivery problem",
  active_reader: "Reading well",
  slow_reader: "Reading slowly",
  not_started: "Not started reading",
  started_reading: "Started reading",
  reading_later: "Will read later",
  feedback_requested: "Feedback asked for",
  referral_interested: "Open to referring",
  referral_details_requested: "Referral details asked for",
  referral_link_shared: "Sent the referral link",
  referral_paused: "Referral paused",
  still_reading: "Still reading",
};
