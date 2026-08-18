import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GIFT_TAG, GIFT_CACHE_SECONDS, revalidateGift } from "@/lib/db/cache-tags";
import {
  DEFAULT_GIFT_SETTINGS,
  MAX_GIFT_CHARGE_PAISE,
  type GiftSettings,
} from "@/lib/gift";

/**
 * Reading and writing the gift wrapping settings (migration 0029).
 *
 * Kept apart from lib/gift.ts because that module is imported by the checkout
 * forms, which are client components — dragging the service-role client into
 * that import graph would put the database key in the browser bundle.
 */

const COLUMNS = "is_enabled,charge_paise";

interface Row {
  is_enabled: boolean;
  charge_paise: number;
}

const shape = (row: Row | null): GiftSettings =>
  row
    ? { isEnabled: row.is_enabled, chargePaise: row.charge_paise }
    : DEFAULT_GIFT_SETTINGS;

/**
 * What wrapping costs right now, and whether it is on offer at all.
 *
 * Memoised per request: the checkout page reads it to draw the option and the
 * create route reads it to charge for one, and neither should pay for a second
 * round trip because the other already asked.
 *
 * A failed read falls back to the defaults rather than throwing. The checkout
 * has to keep working through a database blip, and the honest fallback is the
 * price we have always charged — never free wrapping, which is what a `?? 0`
 * would quietly produce.
 */
export const getGiftSettings = cache(async function getGiftSettings(): Promise<GiftSettings> {
  const { data, error } = await supabaseAdmin
    .from("gift_settings")
    .select(COLUMNS)
    .eq("id", true)
    .maybeSingle();

  if (error) {
    // Migrations here are applied by hand, so "relation does not exist" is a
    // real possibility on a database the code has already been deployed to.
    console.error(
      "[Gift] settings read failed — is migration 0029 applied?",
      error.message
    );
    return DEFAULT_GIFT_SETTINGS;
  }
  return shape(data as Row | null);
});

/**
 * The same settings, for a page that only mentions wrapping in passing.
 *
 * The home page is statically rendered and says "gift wrapping available at
 * checkout" under the buy button. That line has to disappear when wrapping is
 * switched off, but it is not worth making the whole page server-render on
 * every visit — so it reads through a tagged cache, and saving the settings
 * flushes the tag.
 *
 * Never use this where money is decided. The checkout and the create route read
 * live, so the price shown and the price charged cannot be a stale copy apart.
 */
export const getCachedGiftSettings = unstable_cache(
  async (): Promise<GiftSettings> => {
    const { data, error } = await supabaseAdmin
      .from("gift_settings")
      .select(COLUMNS)
      .eq("id", true)
      .maybeSingle();

    // Not thrown: this feeds one advisory line, and a page that 500s over it
    // would be a far worse outcome than a line that is briefly wrong.
    if (error) {
      console.error("[Gift] cached settings read failed:", error.message);
      return DEFAULT_GIFT_SETTINGS;
    }
    return shape(data as Row | null);
  },
  ["gift-settings"],
  { tags: [GIFT_TAG], revalidate: GIFT_CACHE_SECONDS }
);

/**
 * Save the settings. Returns what was actually stored, or null if it failed.
 *
 * Upsert rather than update, so a database whose seed row went missing repairs
 * itself on the first save instead of silently accepting an edit that changed
 * no rows.
 */
export async function updateGiftSettings(
  settings: GiftSettings
): Promise<GiftSettings | null> {
  const { data, error } = await supabaseAdmin
    .from("gift_settings")
    .upsert(
      {
        id: true,
        is_enabled: settings.isEnabled,
        // Clamped here as well as in the route: this is the last thing between
        // a number and a CHECK constraint that would reject the whole write.
        charge_paise: Math.min(
          Math.max(0, Math.round(settings.chargePaise)),
          MAX_GIFT_CHARGE_PAISE
        ),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[Gift] settings save failed:", error.message);
    return null;
  }

  // Here rather than in the route, so a second caller can never forget it —
  // same placement as revalidateCourses and revalidateLanding.
  revalidateGift();

  return shape(data as Row);
}
