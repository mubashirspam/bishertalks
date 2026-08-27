import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  isCourierHandoff,
  type Courier,
  type CourierConfig,
  type CourierHandoff,
} from "@/lib/couriers/types";

/**
 * Reading and writing the logistics partners (migration 0030).
 *
 * Kept apart from lib/couriers/types.ts because that module is imported by
 * client components — dragging the service-role client into that import graph
 * would put the database key in the browser bundle.
 */

const COLUMNS = "id,name,slug,handoff,config,is_active,sort_order";

interface Row {
  id: string;
  name: string;
  slug: string;
  handoff: string;
  config: CourierConfig | null;
  is_active: boolean;
  sort_order: number;
}

/**
 * A row as the rest of the code wants it.
 *
 * `handoff` is re-validated rather than cast: the column has a CHECK, but this
 * is also the boundary where a value edited directly in the Supabase UI would
 * arrive, and a partner whose handoff we don't recognise must not become a
 * partner we try to call. Anything unknown degrades to "manual" — hand it over
 * yourself — which is the only safe way to be wrong here.
 */
function shape(row: Row): Courier {
  const handoff: CourierHandoff = isCourierHandoff(row.handoff)
    ? row.handoff
    : "manual";

  if (handoff !== row.handoff) {
    console.error(
      `[Couriers] unknown handoff "${row.handoff}" on ${row.slug} — treating as manual`
    );
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    handoff,
    config: row.config ?? {},
    is_active: row.is_active,
    sort_order: row.sort_order,
  };
}

/**
 * Every partner, active first, in the order the admin arranged them.
 *
 * Includes the switched-off ones: the delivery list has to name the partner on
 * a parcel that went out last month under a partner we have since stopped
 * using, and a picker can filter them out itself.
 *
 * Memoised per request — several screens ask for this to label rows, and they
 * should not each pay for a round trip.
 */
export const listCouriers = cache(async function listCouriers(): Promise<Courier[]> {
  const { data, error } = await supabaseAdmin
    .from("couriers")
    .select(COLUMNS)
    .order("is_active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    // Migrations here are applied by hand, so "relation does not exist" is a
    // real possibility on a database the code has already been deployed to.
    console.error(
      "[Couriers] list failed — is migration 0030 applied?",
      error.message
    );
    return [];
  }
  return (data as Row[]).map(shape);
});

/** The ones a parcel can actually be assigned to today. */
export async function listActiveCouriers(): Promise<Courier[]> {
  return (await listCouriers()).filter((c) => c.is_active);
}

/**
 * One partner by id, or null.
 *
 * Reads through the memoised list rather than querying: the caller is almost
 * always a screen that has already listed them, and there are a handful of rows
 * in total.
 */
export async function getCourier(id: string): Promise<Courier | null> {
  return (await listCouriers()).find((c) => c.id === id) ?? null;
}

/**
 * One partner by slug — how code names a specific integration.
 *
 * Returns null rather than throwing when the row is missing. A database that
 * has not had 0030 applied should degrade to "no couriers configured", which
 * every screen can say, rather than crashing the page.
 */
export async function getCourierBySlug(slug: string): Promise<Courier | null> {
  return (await listCouriers()).find((c) => c.slug === slug) ?? null;
}

/**
 * The ids of every partner whose parcels Delhivery can answer for.
 *
 * Used to keep a Delhivery lookup away from parcels that are not Delhivery's.
 * Their reference index is not unique on their side and it is not scoped to
 * how a parcel reached them, so asking "what do you know about SP-YP97XR" is a
 * question they will answer about *some* shipment if that string exists in
 * their system — and until now we asked it about every parcel we had a
 * reference for, India Post's included. One of them came back with another
 * customer's waybill.
 *
 * Reads the memoised list, so this costs nothing on a request that has already
 * drawn a courier column.
 */
export async function delhiveryCourierIds(): Promise<string[]> {
  return courierIdsForTracking("delhivery");
}

/**
 * Every courier whose parcels a given tracking integration can answer for.
 *
 * The generalisation of the above, and the reason the poller can run once per
 * carrier instead of once. Several rows share one integration — both KKR rows
 * are Delhivery underneath — and a carrier must only ever be asked about
 * parcels that are actually theirs.
 *
 * That is not a tidiness rule. Asking Delhivery about an India Post parcel is
 * how ORD-YP97XR inherited a stranger's waybill and their "Delivered" scan:
 * Delhivery had another customer's shipment filed under the same reference
 * string, answered confidently, and the answer was written to our order.
 */
export async function courierIdsForTracking(trackingKey: string): Promise<string[]> {
  return (await listCouriers())
    .filter((c) => c.config.tracking === trackingKey)
    .map((c) => c.id);
}
