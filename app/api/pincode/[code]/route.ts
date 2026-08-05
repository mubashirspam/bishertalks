import { NextResponse } from "next/server";

/**
 * Pincode → district / state / localities, for auto-filling the address form.
 *
 * Proxied through our server rather than called from the browser so we can
 * cache it (India Post takes ~1.5s cold) and so a change of provider doesn't
 * mean shipping new client code.
 *
 * Cached for a day — pincode data effectively never changes.
 */
export const revalidate = 86400;

interface PostOffice {
  Name: string;
  District: string;
  State: string;
  Block?: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid pincode" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${code}`, {
      // Don't hang the address form on a slow upstream.
      signal: AbortSignal.timeout(6000),
      next: { revalidate: 86400 },
    });

    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : null;

    if (entry?.Status !== "Success" || !entry?.PostOffice?.length) {
      return NextResponse.json(
        { found: false, error: "Pincode not found" },
        { status: 404 }
      );
    }

    const offices = entry.PostOffice as PostOffice[];

    return NextResponse.json({
      found: true,
      pincode: code,
      district: offices[0].District,
      state: offices[0].State,
      // Locality options — the customer picks the one nearest them.
      localities: [...new Set(offices.map((o) => o.Name))].sort(),
    });
  } catch (e) {
    console.error("[Pincode] lookup failed:", code, e);
    // Soft-fail: the form falls back to manual entry rather than blocking.
    return NextResponse.json(
      { found: false, error: "Lookup unavailable" },
      { status: 503 }
    );
  }
}
