import { supabaseAdmin } from "@/lib/supabase/admin";

export {
  KNOWN_TAGS,
  HOLD_TAGS,
  TAG_LABELS,
  type KnownTag,
} from "@/lib/crm/tag-labels";
import { HOLD_TAGS } from "@/lib/crm/tag-labels";

/**
 * Tags and the relationship stage.
 *
 * A tag says something a customer told us — `later_buyer`, `slow_reader`,
 * `delivery_issue`. A stage says where the relationship has got to, and there
 * is only ever one of those at a time.
 *
 * Neither is the funnel stage. That one — never started, payment started,
 * failed, paid — is derived from the orders themselves in lib/crm/people.ts
 * and must stay derived: it changes when a payment lands, which is a thing
 * that happens without anybody touching this file. A stored copy would be
 * wrong within a week and nobody would notice.
 */

/**
 * Add a tag, keeping the array a set.
 *
 * Done in SQL with `array_append` guarded by a `NOT (tags @> …)` filter rather
 * than read-modify-write, so two button taps arriving together cannot lose one
 * of the two tags. The update simply matches nothing when the tag is already
 * there.
 */
export async function addTag(contactId: string, tag: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("crm_add_tag", {
    p_contact_id: contactId,
    p_tag: tag,
  });

  // The RPC is optional — migration 0053 ships the columns, and this helper
  // works without it. Falling back to read-modify-write costs a round trip and
  // a theoretical lost tag under simultaneous taps, which is a fair trade
  // against not working at all on a database where the function is missing.
  if (error) await addTagFallback(contactId, tag);
}

async function addTagFallback(contactId: string, tag: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("whatsapp_contacts")
    .select("tags")
    .eq("id", contactId)
    .maybeSingle();

  const tags = new Set<string>(((data as { tags?: string[] } | null)?.tags ?? []) as string[]);
  if (tags.has(tag)) return;
  tags.add(tag);

  const { error } = await supabaseAdmin
    .from("whatsapp_contacts")
    .update({ tags: [...tags], updated_at: new Date().toISOString() })
    .eq("id", contactId);

  if (error) console.error("[CRM] addTag failed:", contactId, tag, error.message);
}

export async function removeTag(contactId: string, tag: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("whatsapp_contacts")
    .select("tags")
    .eq("id", contactId)
    .maybeSingle();

  const tags = ((data as { tags?: string[] } | null)?.tags ?? []).filter((t) => t !== tag);

  const { error } = await supabaseAdmin
    .from("whatsapp_contacts")
    .update({ tags, updated_at: new Date().toISOString() })
    .eq("id", contactId);

  if (error) console.error("[CRM] removeTag failed:", contactId, tag, error.message);
}

/** Where the relationship has got to. One at a time; the latest wins. */
export async function setStage(contactId: string, stage: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("whatsapp_contacts")
    .update({ current_stage: stage, updated_at: new Date().toISOString() })
    .eq("id", contactId);

  if (error) console.error("[CRM] setStage failed:", contactId, stage, error.message);
}

/**
 * Tags and stage, read separately from the contact itself.
 *
 * Separate on purpose. `getContact` is called by the webhook on every inbound
 * message, and selecting a column that does not exist fails the entire query —
 * so putting 0053's columns in the contact SELECT would stop customer messages
 * arriving on any database where the migration has not been applied. Here, a
 * missing column costs an empty tag list and nothing else.
 */
export async function crmFieldsFor(
  contactId: string
): Promise<{ tags: string[]; stage: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_contacts")
    .select("tags, current_stage")
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    console.warn("[CRM] tags unavailable — apply migration 0053:", error.message);
    return { tags: [], stage: null };
  }

  const row = data as { tags?: string[] | null; current_stage?: string | null } | null;
  return { tags: row?.tags ?? [], stage: row?.current_stage ?? null };
}

/** Their tags, or an empty list on a database without the column yet. */
export async function tagsFor(contactId: string): Promise<string[]> {
  return (await crmFieldsFor(contactId)).tags;
}

/** Is this person on hold — a delivery problem or an open support request? */
export function onHold(tags: readonly string[]): boolean {
  return tags.some((t) => HOLD_TAGS.includes(t));
}

/**
 * Record that a marketing message is welcome.
 *
 * Called when somebody taps a button that only an interested person taps —
 * "More Details", "Buy Now". The gate refuses MARKETING templates without
 * this, and no contact in the database has it set, so without something like
 * this every campaign in the brief is refused to everyone.
 *
 * Deliberately narrow: tapping *Later* or *Not Now* does not set it. Consent
 * comes from someone leaning in, never from them declining politely.
 */
export async function noteMarketingOptIn(contactId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("whatsapp_contacts")
    .update({ marketing_opt_in_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", contactId)
    // Never overwrite an earlier yes with a later one — the first time they
    // agreed is the date that matters if anybody ever asks.
    .is("marketing_opt_in_at", null);

  if (error) console.error("[CRM] marketing opt-in failed:", contactId, error.message);
}
