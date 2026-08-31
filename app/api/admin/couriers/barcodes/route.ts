export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin-auth";
import { getCourier } from "@/lib/db/couriers";
import { addBarcodeRange, barcodeStock } from "@/lib/db/postal-barcodes";
import { parseAllottedBarcodes, describeRange } from "@/lib/india-post/barcode-import";
import { readXLSX, readCSV } from "@/lib/xlsx-read";
import { audit } from "@/lib/audit";
import type { CurrentStaff } from "@/lib/admin-auth";

/**
 * The article-number stock, and loading the next allotment into it.
 *
 * India Post allots a block of barcodes against the contractual account and
 * publishes it in the portal under *Barcode Management System → Allocated
 * Barcodes*, with an Export to Excel button. That file is what this takes.
 *
 * Uploading it rather than typing the range is the whole point. The numbers
 * are the one input where a typo is invisible: a wrong digit still produces
 * article numbers that pass every check, and the parcels posted under them
 * belong to another customer's allotment. Reading their own file removes the
 * transcription, and — because their file lists the numbers — lets us verify
 * our check-digit arithmetic against theirs before a single parcel is posted.
 *
 * Gated on `delivery.assign`, like the rest of the courier admin: deciding
 * which numbers this shop posts under is the same authority as deciding which
 * courier a parcel goes to.
 */

/** Bigger than any allotment they issue, and small enough to parse in memory. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * How much is left, for the stock panel.
 *
 * `?courier_id=…`, because stock is per contractual account and a shop can
 * have more than one postal partner row.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const courierId = request.nextUrl.searchParams.get("courier_id") ?? "";
  if (!courierId) {
    return NextResponse.json({ error: "Which courier?" }, { status: 400 });
  }

  const stock = await barcodeStock(courierId);
  return NextResponse.json(stock);
}

/**
 * Load an allotment.
 *
 * Two ways in, and they are the same path after the first step: a file from
 * their portal (multipart), or a range typed in by hand (JSON) for the case
 * where somebody has an allotment letter and no file.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePermission("delivery.assign");
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return uploadedFile(request, auth.staff);
  }
  return typedRange(request, auth.staff);
}

type Staff = CurrentStaff | null;

async function uploadedFile(request: NextRequest, staff: Staff) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const courierId = String(form.get("courier_id") ?? "");
  const file = form.get("file");

  if (!courierId) return NextResponse.json({ error: "Which courier?" }, { status: 400 });
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose the file India Post gave you." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too big to be an allotment." }, { status: 400 });
  }

  const courier = await getCourier(courierId);
  if (!courier) {
    return NextResponse.json({ error: "No such courier." }, { status: 404 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const isCsv = /\.(csv|txt)$/i.test(file.name);

  let rows: string[][];
  try {
    rows = isCsv
      ? readCSV(buf.toString("utf8"))
      : readXLSX(buf).flatMap((sheet) => sheet.rows);
  } catch {
    return NextResponse.json(
      {
        error:
          `"${file.name}" is not a spreadsheet this can read. ` +
          "Use the Export to Excel from Allocated Barcodes, or a .csv.",
      },
      { status: 400 }
    );
  }

  const parsed = parseAllottedBarcodes(rows);

  if (!parsed.found) {
    return NextResponse.json(
      {
        error:
          "No article numbers in that file — they look like ET21433001XIN. " +
          "Check it is the Allocated Barcodes export and not the booking template.",
      },
      { status: 400 }
    );
  }

  // The one failure this whole upload exists to catch. See the note in
  // lib/india-post/barcode-import.ts: if their numbers and our arithmetic
  // disagree, every parcel we post would carry an invalid check digit.
  if (parsed.mismatched.length) {
    return NextResponse.json(
      {
        error:
          `${parsed.mismatched[0]} does not match the check digit we would ` +
          "calculate for it. Nothing was loaded — send this file and this " +
          "message to whoever maintains the site before posting anything.",
      },
      { status: 400 }
    );
  }

  // Saved one range at a time so a file covering two allotments, or one with a
  // gap in it, loads as the blocks it actually is — and so a range that
  // overlaps something already recorded is reported by itself rather than
  // taking the rest of the file down with it.
  const loaded: string[] = [];
  const skipped: string[] = [];

  for (const range of parsed.ranges) {
    const result = await addBarcodeRange({
      courierId,
      prefix: range.prefix,
      suffix: range.suffix,
      serialFrom: range.serialFrom,
      serialTo: range.serialTo,
      note: `Imported from ${file.name}`,
    });

    if (result.ok) loaded.push(`${describeRange(range)} (${result.count})`);
    else skipped.push(`${describeRange(range)} — ${result.error}`);
  }

  if (loaded.length) {
    await audit({
      actor: staff,
      action: "courier.barcodes_loaded",
      entity: "courier",
      entityId: courierId,
      meta: { file: file.name, found: parsed.found, loaded, skipped },
    });
  }

  const stock = await barcodeStock(courierId);

  return NextResponse.json({
    found: parsed.found,
    loaded,
    skipped,
    stock,
    message: loaded.length
      ? `Loaded ${loaded.length} range${loaded.length === 1 ? "" : "s"} — ${stock.unused} numbers now unused.`
      : "Nothing new to load; every range in that file was already recorded.",
  });
}

async function typedRange(request: NextRequest, staff: Staff) {
  const body = await request.json().catch(() => ({}));

  const courierId = typeof body.courier_id === "string" ? body.courier_id : "";
  if (!courierId) return NextResponse.json({ error: "Which courier?" }, { status: 400 });

  const courier = await getCourier(courierId);
  if (!courier) return NextResponse.json({ error: "No such courier." }, { status: 404 });

  // Accepts either the two full article numbers or the bare serials, because
  // an allotment letter can be written either way and retyping the prefix
  // twice is another chance to get it wrong.
  const parsed = parseAllottedBarcodes([[String(body.from ?? ""), String(body.to ?? "")]]);

  let prefix: string;
  let suffix: string;
  let serialFrom: number;
  let serialTo: number;

  if (parsed.ranges.length) {
    if (parsed.mismatched.length) {
      return NextResponse.json(
        {
          error:
            `${parsed.mismatched[0]} does not match the check digit we would ` +
            "calculate for it. Check the number against the allotment.",
        },
        { status: 400 }
      );
    }
    // Two numbers a range apart parse as two single-serial runs; the block is
    // the span between the ends of whatever was given.
    prefix = parsed.ranges[0].prefix;
    suffix = parsed.ranges[0].suffix;
    serialFrom = Math.min(...parsed.ranges.map((r) => r.serialFrom));
    serialTo = Math.max(...parsed.ranges.map((r) => r.serialTo));
  } else {
    prefix = String(body.prefix ?? "").trim().toUpperCase();
    suffix = String(body.suffix ?? "IN").trim().toUpperCase();
    serialFrom = Number(String(body.from ?? "").replace(/\D/g, ""));
    serialTo = Number(String(body.to ?? "").replace(/\D/g, ""));

    if (!Number.isFinite(serialFrom) || !Number.isFinite(serialTo)) {
      return NextResponse.json(
        { error: "Give the first and last article number of the range." },
        { status: 400 }
      );
    }
  }

  const result = await addBarcodeRange({
    courierId,
    prefix,
    suffix,
    serialFrom,
    serialTo,
    note: typeof body.note === "string" ? body.note : "Typed in by hand",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await audit({
    actor: staff,
    action: "courier.barcodes_loaded",
    entity: "courier",
    entityId: courierId,
    meta: { typed: true, prefix, suffix, from: serialFrom, to: serialTo, count: result.count },
  });

  const stock = await barcodeStock(courierId);

  return NextResponse.json({
    loaded: [`${prefix}${serialFrom}${suffix} – ${prefix}${serialTo}${suffix} (${result.count})`],
    skipped: [],
    stock,
    message: `Loaded ${result.count} numbers — ${stock.unused} now unused.`,
  });
}
