import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidateCourses } from "@/lib/db/cache-tags";
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


/**
 * The book's price, and the change waiting to replace it (0048).
 *
 * Kept in this module rather than in lib/db/courses.ts, which reads it: reading
 * happens on every page render and belongs next to the other cached catalogue
 * reads, while writing happens on one admin screen and belongs next to the
 * other settings writes. The columns are the same either way.
 */
export interface BookPricingInput {
  /** Struck-through compare-at, in whole rupees. */
  price: number;
  /** What is charged, or null for no offer. */
  offerPrice: number | null;
  /**
   * The pending change, or null to clear it.
   *
   * All-or-nothing on purpose, matching the CHECK in 0048: a price with no
   * moment never arrives, and a moment with no price would blank the checkout.
   */
  next: { price: number; offerPrice: number | null; effectiveAt: string } | null;
}

/**
 * Save the book's pricing. Returns false if the write failed.
 *
 * `revalidateCourses()` because the display path caches the pricing row under
 * COURSES_TAG — without this an edit would sit behind the cache for up to five
 * minutes while the admin stared at the old number and reasonably concluded the
 * save had not worked.
 */
export async function updateBookPricing(input: BookPricingInput): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("checkout_settings")
    .upsert(
      {
        id: true,
        book_price_rupees: input.price,
        book_offer_rupees: input.offerPrice,
        next_book_price_rupees: input.next?.price ?? null,
        next_book_offer_rupees: input.next?.offerPrice ?? null,
        price_effective_at: input.next?.effectiveAt ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

  if (error) {
    console.error("[Checkout] book pricing save failed:", error.message);
    return false;
  }

  revalidateCourses();
  return true;
}

/**
 * Fold a scheduled change into the live price and empty the schedule.
 *
 * Nothing depends on this happening — the read already resolves a past
 * `price_effective_at` as the live price, so a schedule left in place goes on
 * being correct forever. It exists so the admin card can stop showing a change
 * that happened last week as though it were still pending.
 *
 * Reads before writing rather than doing it in one statement, because a
 * column-to-column UPDATE would also happily fire on a schedule that has NOT
 * arrived yet — turning "next week's price" into "today's" with one click.
 */
export async function applyScheduledPricing(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("checkout_settings")
    .select("next_book_price_rupees,next_book_offer_rupees,price_effective_at")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) {
    console.error("[Checkout] could not read the schedule:", error?.message);
    return false;
  }

  const row = data as {
    next_book_price_rupees: number | null;
    next_book_offer_rupees: number | null;
    price_effective_at: string | null;
  };

  // Only a change that has actually arrived.
  if (
    row.price_effective_at == null ||
    row.next_book_price_rupees == null ||
    new Date(row.price_effective_at).getTime() > Date.now()
  ) {
    return false;
  }

  return updateBookPricing({
    price: row.next_book_price_rupees,
    offerPrice: row.next_book_offer_rupees,
    next: null,
  });
}
