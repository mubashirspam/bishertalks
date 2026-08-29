export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * A customer's photo or voice note, fetched back from Meta.
 *
 * This has to be a proxy, not a redirect. Media on the Cloud API takes two
 * calls — the id exchanges for a URL, and that URL only answers to a request
 * carrying the access token — so a browser cannot follow it, and handing the
 * URL to the page would either fail or leak the token into a client the moment
 * somebody made it work.
 *
 * The id also has to come from our own database rather than the request. An id
 * off the wire would let anyone with a staff login read any media on the
 * WhatsApp account, including another business's if an id were ever guessed;
 * looking it up by message id means you can only fetch what is already in a
 * thread you are allowed to read.
 *
 * Meta deletes media 30 days after it was sent. Past that this answers 404,
 * truthfully — the file is gone, not missing.
 */

/** Long enough for a voice note on a slow connection, short enough to fail. */
const TIMEOUT_MS = 20_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("crm.view");
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // The message row, not the media id. See the note above.
  const { data, error } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("media_id, media_mime, media_filename, kind")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // The column is missing on a database still on 0053. Say which migration,
    // because "media unavailable" sends somebody looking at Meta.
    console.error("[CRM] media lookup failed:", error.message);
    return NextResponse.json(
      { error: "Media columns are missing — apply migration 0054" },
      { status: 500 }
    );
  }

  const row = data as {
    media_id: string | null;
    media_mime: string | null;
    media_filename: string | null;
    kind: string;
  } | null;

  if (!row?.media_id) {
    return NextResponse.json({ error: "No media on that message" }, { status: 404 });
  }

  const token = process.env.WHATSAPP_TOKEN;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token) {
    return NextResponse.json({ error: "WhatsApp is not configured" }, { status: 503 });
  }

  try {
    // 1 · id → a URL that lives about five minutes.
    const lookup = await fetch(
      `https://graph.facebook.com/${version}/${row.media_id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      }
    );

    const meta = (await lookup.json().catch(() => ({}))) as {
      url?: string;
      mime_type?: string;
      error?: { message?: string; code?: number };
    };

    if (!lookup.ok || meta.error || !meta.url) {
      // 100 is "object does not exist", which after 30 days means expired
      // rather than wrong. Worth separating: one is nothing to fix.
      const expired = meta.error?.code === 100;
      console.warn("[CRM] media unavailable:", row.media_id, meta.error?.message);
      return NextResponse.json(
        {
          error: expired
            ? "WhatsApp keeps media for 30 days. This one has expired."
            : (meta.error?.message ?? "Could not reach WhatsApp"),
        },
        { status: expired ? 404 : 502 }
      );
    }

    // 2 · the URL, with the token. Without the header this answers 401.
    const file = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!file.ok || !file.body) {
      console.warn("[CRM] media download failed:", row.media_id, file.status);
      return NextResponse.json({ error: "Could not download the file" }, { status: 502 });
    }

    const mime = row.media_mime ?? meta.mime_type ?? "application/octet-stream";

    // Streamed rather than buffered: a video is the one thing here that could
    // be tens of megabytes, and holding it in memory to hand it straight on
    // achieves nothing.
    return new NextResponse(file.body, {
      headers: {
        "Content-Type": mime,
        // A document downloads under the name the customer saw; everything
        // else plays where it sits.
        "Content-Disposition":
          row.kind === "document"
            ? `attachment; filename="${(row.media_filename ?? "file").replace(/"/g, "")}"`
            : "inline",
        // Private, because this is a customer's photo. `no-store` would make
        // an audio player re-fetch on every seek, so it is cached briefly and
        // only in the browser that asked.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("[CRM] media proxy failed:", row.media_id, e);
    return NextResponse.json({ error: "Could not fetch the file" }, { status: 502 });
  }
}
