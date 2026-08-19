import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  DEFAULT_CHECKOUT_SETTINGS,
  type CheckoutSettings,
} from "@/lib/checkout-settings";

/**
 * Reading and writing the checkout settings (migration 0042).
 *
 * No cached variant, unlike lib/db/gift.ts. Nothing statically rendered mentions
 * the promo field — it is drawn by the checkout, which is force-dynamic, and by
 * the admin screen, which is too. A tag with no static reader to invalidate
 * would be scaffolding around nothing.
 */

const COLUMNS = "promo_field_is_enabled";

interface Row {
  promo_field_is_enabled: boolean;
}

const shape = (row: Row | null): CheckoutSettings =>
  row
    ? { promoFieldIsEnabled: row.promo_field_is_enabled }
    : DEFAULT_CHECKOUT_SETTINGS;

/**
 * What the checkout shows right now.
 *
 * Memoised per request: the checkout page reads it to decide whether to draw
 * the field, and /api/orders/create reads it to decide whether to honour what
 * came back, so neither should pay for a second round trip.
 *
 * A failed read falls back to the defaults rather than throwing — the checkout
 * has to keep working through a database blip.
 */
export const getCheckoutSettings = cache(
  async function getCheckoutSettings(): Promise<CheckoutSettings> {
    const { data, error } = await supabaseAdmin
      .from("checkout_settings")
      .select(COLUMNS)
      .eq("id", true)
      .maybeSingle();

    if (error) {
      // Migrations here are applied by hand, so "relation does not exist" is a
      // real possibility on a database the code has already been deployed to.
      console.error(
        "[Checkout] settings read failed — is migration 0042 applied?",
        error.message
      );
      return DEFAULT_CHECKOUT_SETTINGS;
    }
    return shape(data as Row | null);
  }
);

/**
 * Save the settings. Returns what was actually stored, or null if it failed.
 *
 * Upsert rather than update, so a database whose seed row went missing repairs
 * itself on the first save instead of silently accepting an edit that changed
 * no rows — same reasoning as updateGiftSettings.
 */
export async function updateCheckoutSettings(
  settings: CheckoutSettings
): Promise<CheckoutSettings | null> {
  const { data, error } = await supabaseAdmin
    .from("checkout_settings")
    .upsert(
      {
        id: true,
        promo_field_is_enabled: settings.promoFieldIsEnabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[Checkout] settings save failed:", error.message);
    return null;
  }

  return shape(data as Row);
}
