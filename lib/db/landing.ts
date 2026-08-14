import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  LANDING_TAG,
  LANDING_CACHE_SECONDS,
  revalidateLanding,
} from "@/lib/db/cache-tags";
import {
  DEFAULT_SETTINGS,
  type Testimonial,
  type LandingSettings,
  type LandingContent,
} from "@/lib/types/landing";

/**
 * Landing page content, from the database.
 *
 * Testimonials and the explainer video used to be constants in content.ts,
 * which made adding a reader's voice note a code change and a deploy. The
 * static Malayalam prose still lives there — it changes rarely and belongs
 * with the layout it was written for.
 */

// Shapes and labels live in lib/types/landing.ts so the client-side admin
// editor can import them without pulling this file's server-only code with
// them. Re-exported here so server callers can keep importing from one place.
export {
  TESTIMONIAL_KINDS,
  KIND_LABELS,
  DEFAULT_SETTINGS,
  type TestimonialKind,
  type Testimonial,
  type LandingSettings,
  type LandingContent,
} from "@/lib/types/landing";

const COLUMNS =
  "id,kind,name,role,quote,youtube_id,video_url,image_url,audio_url,avatar_url," +
  "duration,sent_at_label,rating,sort_order,is_active,created_at";

const SETTINGS_COLUMNS =
  "explainer_youtube_id,explainer_video_url,explainer_length,show_placeholders";

/**
 * Throws on a failed read instead of falling back, because this result is
 * stored. An empty testimonial list cached for five minutes would strip the
 * social proof off the sales page long after the blip that caused it.
 */
const readLandingContent = unstable_cache(
  async (): Promise<LandingContent> => {
    const [{ data: rows, error: rowsError }, { data: settings, error: settingsError }] =
      await Promise.all([
        supabaseAdmin
          .from("landing_testimonials")
          .select(COLUMNS)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("landing_settings")
          .select(SETTINGS_COLUMNS)
          .eq("id", true)
          .maybeSingle(),
      ]);

    const error = rowsError ?? settingsError;
    if (error) throw new Error(`landing content read failed: ${error.message}`);

    return {
      testimonials: (rows as unknown as Testimonial[]) ?? [],
      // A missing settings row is a legitimate state, not a failure — the
      // defaults are what the page shipped with before the CMS existed.
      settings: (settings as unknown as LandingSettings) ?? DEFAULT_SETTINGS,
    };
  },
  ["landing-content"],
  { tags: [LANDING_TAG], revalidate: LANDING_CACHE_SECONDS }
);

/**
 * Everything the public page needs. Falls back to empty rather than throwing —
 * a CMS problem must never take the sales page down.
 *
 * Cached because it runs on every visit to /neuro-code and returns content that
 * only changes when someone edits it in admin; the mutations below drop the tag,
 * so an edit still shows up immediately.
 */
export async function getLandingContent(): Promise<LandingContent> {
  try {
    return await readLandingContent();
  } catch (e) {
    console.error("[Landing] content read failed:", e);
    return { testimonials: [], settings: DEFAULT_SETTINGS };
  }
}

/** Admin view: inactive ones included, so they can be switched back on. */
export async function listAllTestimonials(): Promise<Testimonial[]> {
  const { data } = await supabaseAdmin
    .from("landing_testimonials")
    .select(COLUMNS)
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true });
  return (data as unknown as Testimonial[]) ?? [];
}

export async function getLandingSettings(): Promise<LandingSettings> {
  const { data } = await supabaseAdmin
    .from("landing_settings")
    .select(SETTINGS_COLUMNS)
    .eq("id", true)
    .maybeSingle();
  return (data as unknown as LandingSettings) ?? DEFAULT_SETTINGS;
}

export async function updateLandingSettings(
  patch: Partial<LandingSettings>
): Promise<LandingSettings | null> {
  const { data, error } = await supabaseAdmin
    .from("landing_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select(SETTINGS_COLUMNS)
    .single();

  if (error) {
    console.error("[Landing] settings update failed:", error.message);
    return null;
  }
  revalidateLanding();
  return data as unknown as LandingSettings;
}

/** Columns a client is allowed to set. Anything else in the body is ignored. */
const WRITABLE = [
  "kind", "name", "role", "quote", "youtube_id", "video_url", "image_url",
  "audio_url", "avatar_url", "duration", "sent_at_label", "rating",
  "sort_order", "is_active",
] as const;

export function sanitizeTestimonial(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (!(key in body)) continue;
    const v = body[key];
    if (key === "is_active") out[key] = !!v;
    else if (key === "sort_order" || key === "rating") {
      out[key] = v === null || v === "" ? null : Number(v);
    } else {
      out[key] = typeof v === "string" ? v.trim() || null : null;
    }
  }
  return out;
}

export async function createTestimonial(
  fields: Record<string, unknown>
): Promise<Testimonial | null> {
  // Sorts to the end of its own kind by default, leaving gaps of 10 so a row
  // can later be dropped between two others without renumbering everything.
  if (fields.sort_order == null) {
    const { data: last } = await supabaseAdmin
      .from("landing_testimonials")
      .select("sort_order")
      .eq("kind", fields.kind as string)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    fields.sort_order = ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 10;
  }

  const { data, error } = await supabaseAdmin
    .from("landing_testimonials")
    .insert(fields)
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[Landing] create failed:", error.message);
    return null;
  }
  revalidateLanding();
  return data as unknown as Testimonial;
}

export async function updateTestimonial(
  id: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("landing_testimonials")
    .update(fields)
    .eq("id", id);
  if (error) console.error("[Landing] update failed:", error.message);
  else revalidateLanding();
  return !error;
}

export async function deleteTestimonial(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("landing_testimonials")
    .delete()
    .eq("id", id);
  if (error) console.error("[Landing] delete failed:", error.message);
  else revalidateLanding();
  return !error;
}

/**
 * Move one testimonial up or down within its kind.
 *
 * Swaps sort_order with the neighbour rather than rewriting the whole list —
 * two updates instead of N, and no chance of a half-applied reorder leaving
 * the page in a strange sequence.
 */
export async function moveTestimonial(id: string, direction: "up" | "down"): Promise<boolean> {
  const { data: row } = await supabaseAdmin
    .from("landing_testimonials")
    .select("id,kind,sort_order")
    .eq("id", id)
    .maybeSingle();
  if (!row) return false;

  const current = row as { id: string; kind: string; sort_order: number };

  const { data: neighbourRow } = await supabaseAdmin
    .from("landing_testimonials")
    .select("id,sort_order")
    .eq("kind", current.kind)
    [direction === "up" ? "lt" : "gt"]("sort_order", current.sort_order)
    .order("sort_order", { ascending: direction !== "up" })
    .limit(1)
    .maybeSingle();

  if (!neighbourRow) return true; // already at the end — not an error

  const neighbour = neighbourRow as { id: string; sort_order: number };

  await Promise.all([
    supabaseAdmin
      .from("landing_testimonials")
      .update({ sort_order: neighbour.sort_order })
      .eq("id", current.id),
    supabaseAdmin
      .from("landing_testimonials")
      .update({ sort_order: current.sort_order })
      .eq("id", neighbour.id),
  ]);

  revalidateLanding();
  return true;
}
