import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SendKind } from "@/lib/crm/gate";

/**
 * The number's health, and what each state is allowed to do.
 *
 * Meta publishes a quality rating per phone number: GREEN, YELLOW, RED. It
 * moves *after* the damage — people block or report you, then the rating
 * falls — so it is a confirmation, not a warning. The leading indicators are
 * in `campaignRisk()` below and in the opt-out rate per campaign.
 *
 * The rule this file exists to enforce: a rating that is not green stops
 * discretionary messaging automatically, without waiting for a person to read
 * a dashboard.
 */

export interface NumberHealth {
  checked_at: string;
  quality_rating: string | null;
  messaging_tier: string | null;
  number_status: string | null;
  name_status: string | null;
  error: string | null;
}

/** The most recent snapshot the cron wrote. */
export async function latestHealth(): Promise<NumberHealth | null> {
  try {
    const { data } = await supabaseAdmin
      .from("whatsapp_number_health")
      .select("checked_at, quality_rating, messaging_tier, number_status, name_status, error")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as NumberHealth | null) ?? null;
  } catch {
    return null;
  }
}

export async function healthHistory(days = 30): Promise<NumberHealth[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabaseAdmin
    .from("whatsapp_number_health")
    .select("checked_at, quality_rating, messaging_tier, number_status, name_status, error")
    .gte("checked_at", since)
    .order("checked_at", { ascending: false });
  return (data ?? []) as NumberHealth[];
}

/**
 * What a given rating permits.
 *
 * Transactional messages survive yellow: someone who paid for a book is
 * entitled to know it shipped, and withholding that would create the support
 * conversation that a bad rating least needs. Nothing survives red.
 *
 * An unknown rating — nothing synced yet — is treated as green rather than
 * blocking. The cron may simply not have run; refusing every order
 * notification because a status table is empty would be a worse failure than
 * the one it is guarding against, and every other check still applies.
 */
export function ratingAllows(
  rating: string | null,
  kind: SendKind
): { ok: true } | { ok: false; reason: string } {
  const r = (rating ?? "").toUpperCase();

  if (r === "RED") {
    return {
      ok: false,
      reason: "Number quality is RED — all sending is stopped until it recovers",
    };
  }
  if (r === "YELLOW" && kind !== "transactional") {
    return {
      ok: false,
      reason: "Number quality is YELLOW — only order notifications are sending",
    };
  }
  return { ok: true };
}

/** For the dashboard: is this rating worth interrupting someone about? */
export function ratingTone(rating: string | null): "good" | "warn" | "bad" | "unknown" {
  switch ((rating ?? "").toUpperCase()) {
    case "GREEN": return "good";
    case "YELLOW": return "warn";
    case "RED": return "bad";
    default: return "unknown";
  }
}

/**
 * Fetch the live numbers from Meta and store a snapshot.
 *
 * Called by the daily cron. Writes a row even on failure, with the error in
 * it — a gap in the history would otherwise be indistinguishable from a day
 * nobody checked, and "when did this start" is the question the table exists
 * to answer.
 */
export async function syncNumberHealth(): Promise<NumberHealth> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";

  let row: Omit<NumberHealth, "checked_at"> = {
    quality_rating: null,
    messaging_tier: null,
    number_status: null,
    name_status: null,
    error: null,
  };

  if (!token || !phoneId) {
    row.error = "WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not set";
  } else {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${version}/${phoneId}` +
          `?fields=quality_rating,messaging_limit_tier,status,name_status`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const json = (await res.json()) as {
        quality_rating?: string;
        messaging_limit_tier?: string;
        status?: string;
        name_status?: string;
        error?: { message?: string; code?: number };
      };

      if (json.error) {
        row.error =
          json.error.code === 190
            ? "Access token expired or revoked — see docs/whatsapp-meta-setup.md"
            : json.error.message ?? "Meta refused the request";
      } else {
        row = {
          quality_rating: json.quality_rating ?? null,
          messaging_tier: json.messaging_limit_tier ?? null,
          number_status: json.status ?? null,
          name_status: json.name_status ?? null,
          error: null,
        };
      }
    } catch (e) {
      row.error = e instanceof Error ? e.message : "Could not reach Meta";
    }
  }

  const checked_at = new Date().toISOString();
  try {
    await supabaseAdmin.from("whatsapp_number_health").insert({ ...row, checked_at });
  } catch (e) {
    console.error("[Health] snapshot write failed:", e);
  }

  return { ...row, checked_at };
}

/**
 * Pull every template's status into the database.
 *
 * The gate reads this rather than calling Graph, and the campaign composer
 * uses it to grey out what cannot be sent. Same call the admin templates
 * screen makes, run once a day instead of once a page view.
 */
export async function syncTemplateStatus(): Promise<{ synced: number; error: string | null }> {
  const token = process.env.WHATSAPP_TOKEN;
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";

  if (!token || !wabaId) {
    return { synced: 0, error: "WHATSAPP_TOKEN or WHATSAPP_WABA_ID is not set" };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${wabaId}/message_templates` +
        `?fields=name,language,status,category,rejected_reason&limit=200`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const json = (await res.json()) as {
      data?: {
        name: string;
        language: string;
        status: string;
        category?: string;
        rejected_reason?: string;
      }[];
      error?: { message?: string };
    };

    if (json.error) return { synced: 0, error: json.error.message ?? "Meta refused" };

    const rows = (json.data ?? []).map((t) => ({
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category ?? null,
      rejected_reason:
        t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      synced_at: new Date().toISOString(),
    }));

    if (rows.length) {
      await supabaseAdmin
        .from("whatsapp_template_status")
        .upsert(rows, { onConflict: "name,language" });
    }
    return { synced: rows.length, error: null };
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : "Request failed" };
  }
}

export interface TemplateStatusRow {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejected_reason: string | null;
  synced_at: string;
}

/** Which templates a campaign is allowed to choose from. */
export async function approvedTemplates(): Promise<TemplateStatusRow[]> {
  const { data } = await supabaseAdmin
    .from("whatsapp_template_status")
    .select("name, language, status, category, rejected_reason, synced_at")
    .eq("status", "APPROVED")
    .eq("language", "ml");
  return (data ?? []) as TemplateStatusRow[];
}
