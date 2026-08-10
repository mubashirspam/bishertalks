"use client";

import { useRef, useState } from "react";
import { Upload, X, Loader2, AlertCircle, Music, Film, ImageIcon } from "lucide-react";
import { IMAGEKIT_UPLOAD_URL, UPLOAD_LIMITS, type UploadKind } from "@/lib/imagekit";

/**
 * Uploads a file to ImageKit and hands back its URL.
 *
 * The browser fetches a short-lived signature from our server, then posts the
 * file directly to ImageKit. The bytes never pass through this app — a phone
 * video is routinely 100MB+, which no serverless request body will carry.
 *
 * `value` is the stored URL; clearing it is the caller's business, so this
 * stays a controlled input rather than holding its own idea of the truth.
 */
export default function MediaUpload({
  kind,
  folder,
  value,
  onChange,
  label,
}: {
  kind: UploadKind;
  folder: string;
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const limit = UPLOAD_LIMITS[kind];

  const upload = async (file: File) => {
    setError("");

    // Checked here rather than after the upload: discovering a 200MB video was
    // too big only once it finished is a genuinely miserable five minutes on
    // mobile data.
    const maxBytes = limit.maxMB * 1024 * 1024;
    if (file.size > maxBytes) {
      setError(`${Math.round(file.size / 1024 / 1024)}MB — the limit is ${limit.maxMB}MB`);
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      const authRes = await fetch("/api/admin/imagekit/auth");
      if (!authRes.ok) {
        const { error: msg } = await authRes.json().catch(() => ({}));
        throw new Error(msg ?? "Could not authorise the upload");
      }
      const { token, expire, signature, publicKey } = await authRes.json();

      const form = new FormData();
      form.append("file", file);
      // Prefixed with the time so re-uploading "voice.mp3" doesn't collide
      // with last week's "voice.mp3".
      form.append("fileName", `${Date.now()}-${file.name.replace(/\s+/g, "-")}`);
      form.append("folder", folder);
      form.append("publicKey", publicKey);
      form.append("signature", signature);
      form.append("expire", String(expire));
      form.append("token", token);
      form.append("useUniqueFileName", "true");

      // XHR rather than fetch: fetch still can't report upload progress, and a
      // 200MB video with no progress bar looks like a hung page.
      const url: string = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", IMAGEKIT_UPLOAD_URL);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const body = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body.url);
            else reject(new Error(body?.message ?? `Upload failed (${xhr.status})`));
          } catch {
            reject(new Error("ImageKit returned something unreadable"));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(form);
      });

      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const Icon = kind === "audio" ? Music : kind === "video" ? Film : ImageIcon;

  return (
    <div>
      <label className="text-xs font-medium text-neutral-500 mb-1.5 block">{label}</label>

      {value ? (
        <div className="flex items-center gap-3 bg-white border border-neutral-200 rounded-xl p-2.5">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
          ) : kind === "audio" ? (
            <audio src={value} controls className="h-9 flex-1 min-w-0" />
          ) : (
            <video src={value} className="w-20 h-12 rounded-lg object-cover flex-shrink-0" />
          )}

          {kind !== "audio" && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-600 hover:underline truncate flex-1 min-w-0"
            >
              {value.split("/").pop()}
            </a>
          )}

          <button
            onClick={() => onChange(null)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
            title="Remove"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-neutral-300 hover:border-primary-400 rounded-xl px-4 py-5 text-sm text-neutral-500 hover:text-primary-600 transition-colors disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {progress > 0 ? `Uploading ${progress}%` : "Starting…"}
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              <Icon className="w-4 h-4" />
              Upload {kind} · max {limit.maxMB}MB
            </>
          )}
        </button>
      )}

      {busy && progress > 0 && (
        <div className="h-1 bg-neutral-200 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-red-600 text-xs mt-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={limit.accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
    </div>
  );
}
