export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/admin-auth";

/**
 * Renders a tracked link as a QR code, for printing.
 *
 * This lives here rather than in the browser because the alternative — pasting
 * the link into whichever free QR site comes up first — is how a tagged link
 * quietly becomes an untagged one, or worse, a link that stops working the day
 * the generator decides to charge for it. The QR encodes exactly the URL the
 * builder shows and nothing else: no redirect, no third party in the middle of
 * a code that will be printed on ten thousand books.
 *
 * SVG by default: a QR that gets scaled up for a back cover must stay crisp,
 * and a printer will ask for vector. PNG is offered because most people paste
 * into Canva or Word, which are happier with it.
 */

/** Anything else on this host would be a link we don't control. */
function isOurUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const allowed = new URL(
      process.env.NEXT_PUBLIC_APP_URL || "https://bishertalks.com"
    );
    const host = u.host.replace(/^www\./, "");
    return host === allowed.host.replace(/^www\./, "") || host.startsWith("localhost");
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requirePermission("insights.view");
  if (!auth.ok) return auth.response;

  const p = request.nextUrl.searchParams;
  const data = (p.get("data") ?? "").slice(0, 500);
  const format = p.get("format") === "png" ? "png" : "svg";
  const download = p.get("download") === "1";

  if (!isOurUrl(data)) {
    return NextResponse.json({ error: "Not a bishertalks.com link" }, { status: 400 });
  }

  const options = {
    // Level M survives a smudged print and a phone held at an angle, without
    // making the pattern so dense it stops scanning at business-card size.
    errorCorrectionLevel: "M" as const,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  };

  const filename = `qr-${new Date().toISOString().slice(0, 10)}.${format}`;
  const disposition = `${download ? "attachment" : "inline"}; filename="${filename}"`;

  try {
    if (format === "png") {
      // 1024px so it still looks like a QR and not a mosaic when someone drops
      // it into a print layout at 300dpi.
      const png = await QRCode.toBuffer(data, { ...options, type: "png", width: 1024 });
      return new NextResponse(new Uint8Array(png), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": disposition,
          "Cache-Control": "no-store",
        },
      });
    }

    const svg = await QRCode.toString(data, { ...options, type: "svg", width: 512 });
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[QR] render failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not draw that code" }, { status: 500 });
  }
}
