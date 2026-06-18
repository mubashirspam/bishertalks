// Migrate course files (PDF/DOCX) from Google Drive -> Supabase Storage.
//
// Reads every lesson whose url points at Google Drive, downloads the file,
// uploads it to the public `course-files` bucket, and rewrites lessons.url
// to the new Supabase public URL.
//
// Usage:
//   node scripts/migrate-drive-to-supabase.mjs           # DRY RUN (no writes)
//   node scripts/migrate-drive-to-supabase.mjs --apply   # perform migration
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
// and the Drive files shared as "Anyone with the link -> Viewer".

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const BUCKET = "course-files";

// --- load .env.local (simple KEY=value parser) ---------------------------
function loadEnv() {
  let raw;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- helpers -------------------------------------------------------------
function driveFileId(url) {
  // .../file/d/<ID>/view  |  ...?id=<ID>  |  .../document/d/<ID>/...
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extFromContentType(ct) {
  if (!ct) return "";
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("wordprocessingml")) return ".docx";
  if (ct.includes("msword")) return ".doc";
  if (ct.includes("presentationml")) return ".pptx";
  if (ct.includes("spreadsheetml")) return ".xlsx";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg")) return ".jpg";
  return "";
}

function filenameFromDisposition(cd) {
  if (!cd) return null;
  const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// Download a Drive file, transparently handling the large-file virus-scan
// confirmation interstitial.
async function downloadDriveFile(id) {
  const base = "https://drive.google.com/uc?export=download&id=" + id;
  let res = await fetch(base);
  let cookies = res.headers.get("set-cookie") || "";

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    // Interstitial. Parse the confirm form/token and retry.
    const html = await res.text();
    let confirmUrl = null;
    const formAction = html.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/);
    if (formAction) {
      const action = formAction[1].replace(/&amp;/g, "&");
      const params = new URLSearchParams();
      for (const inp of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) {
        params.set(inp[1], inp[2]);
      }
      confirmUrl = action + (action.includes("?") ? "&" : "?") + params.toString();
    } else {
      const tok = html.match(/confirm=([0-9A-Za-z_-]+)/);
      if (tok) confirmUrl = base + "&confirm=" + tok[1];
    }
    if (!confirmUrl) {
      throw new Error("could not parse Drive confirmation page (file may be restricted)");
    }
    res = await fetch(confirmUrl, { headers: cookies ? { cookie: cookies } : {} });
  }

  if (!res.ok) throw new Error("HTTP " + res.status);
  const finalCt = res.headers.get("content-type") || "";
  if (finalCt.includes("text/html")) {
    throw new Error("got HTML, not a file (restricted or quota-limited)");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    buf,
    contentType: finalCt.split(";")[0].trim(),
    filename: filenameFromDisposition(res.headers.get("content-disposition")),
  };
}

// --- main ----------------------------------------------------------------
async function ensureBucket() {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  if (!APPLY) {
    console.log(`[dry-run] would create public bucket "${BUCKET}"`);
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !String(error.message).includes("already exists")) throw error;
  console.log(`Created public bucket "${BUCKET}"`);
}

async function run() {
  console.log(APPLY ? "=== APPLY MODE (writing) ===" : "=== DRY RUN (no writes) ===\n");

  await ensureBucket();

  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("id, slug, title, type, url");
  if (error) throw error;

  const drive = lessons.filter((l) => /drive\.google\.com|docs\.google\.com/.test(l.url || ""));
  console.log(`Found ${drive.length} lessons with Google links (of ${lessons.length} total).\n`);

  const failures = [];
  let ok = 0;

  for (const l of drive) {
    const id = driveFileId(l.url);
    if (!id) {
      failures.push({ slug: l.slug, reason: "could not parse file id", url: l.url });
      console.log(`✗ ${l.slug}: cannot parse file id`);
      continue;
    }

    try {
      const { buf, contentType, filename } = await downloadDriveFile(id);
      const ext =
        (filename && filename.includes(".") ? "." + filename.split(".").pop() : "") ||
        extFromContentType(contentType) ||
        ".pdf";
      const path = `${l.slug}-${id.slice(0, 8)}${ext}`;
      const sizeKb = (buf.length / 1024).toFixed(0);

      // Normalize content type by extension so the browser previews PDFs
      // inline instead of force-downloading the octet-stream Drive returns.
      const typeByExt = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      const uploadType =
        contentType && contentType !== "application/octet-stream"
          ? contentType
          : typeByExt[ext] || "application/octet-stream";

      if (!APPLY) {
        console.log(`[dry-run] ${l.slug}: ${sizeKb}KB ${uploadType} -> ${BUCKET}/${path}`);
        ok++;
        continue;
      }

      const up = await supabase.storage
        .from(BUCKET)
        .upload(path, buf, { contentType: uploadType, upsert: true });
      if (up.error) throw up.error;

      const pub = supabase.storage.from(BUCKET).getPublicUrl(path);
      const newUrl = pub.data.publicUrl;

      const upd = await supabase.from("lessons").update({ url: newUrl }).eq("id", l.id);
      if (upd.error) throw upd.error;

      console.log(`✓ ${l.slug}: ${sizeKb}KB -> ${newUrl}`);
      ok++;
    } catch (e) {
      failures.push({ slug: l.slug, reason: e.message, url: l.url });
      console.log(`✗ ${l.slug}: ${e.message}`);
    }
  }

  console.log(`\nDone. ${ok} ok, ${failures.length} failed.`);
  if (failures.length) {
    console.log("\nFailed (handle manually — likely 'restricted' sharing):");
    for (const f of failures) console.log(`  - ${f.slug}: ${f.reason}\n    ${f.url}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
