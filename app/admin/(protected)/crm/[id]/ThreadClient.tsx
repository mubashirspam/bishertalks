"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Lock,
  Ban,
  RotateCcw,
  AlertCircle,
  Check,
  CheckCheck,
  Paperclip,
  Loader2,
  Clock,
  X,
} from "lucide-react";
import type { QuickReply, ReplyLanguage } from "@/lib/crm/quick-replies";
import type { ThreadCursor } from "@/lib/crm/thread-view";

/**
 * The conversation, and the box under it.
 *
 * The box is the point of this component. Meta only permits free text for 24
 * hours after the customer's own last message; outside that the only legal
 * send is an approved template. So the composer is not disabled when the
 * window shuts — it is replaced by an explanation, because a greyed-out box
 * with no reason is how someone ends up typing the same reply three times
 * wondering what is broken.
 */

interface ThreadMessage {
  id: string;
  direction: "in" | "out";
  body: string | null;
  kind: string;
  /** True when Meta has (or had) a file for this message — see MediaBubble. */
  hasMedia?: boolean;
  mediaMime?: string | null;
  mediaFilename?: string | null;
  templateName: string | null;
  status: string | null;
  error: string | null;
  createdAt: string;
}

/** Union by id, favouring the incoming copy, then sorted back into order. */
function mergeMessages(a: ThreadMessage[], b: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map(a.map((m) => [m.id, m]));
  for (const m of b) byId.set(m.id, m);
  return Array.from(byId.values()).sort(
    (x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id)
  );
}

export default function ThreadClient({
  contact,
  messages,
  hasMoreOlder = false,
  oldestCursor = null,
  window: win,
  canReply,
  canConsent,
  quickReplies,
  onChanged,
}: {
  contact: { id: string; phone: string; optedOut: boolean; marketingOptIn: boolean };
  messages: ThreadMessage[];
  /** True when older messages exist beyond what `messages` holds. */
  hasMoreOlder?: boolean;
  /** Pass to /thread/[id]/messages?before= to fetch the next page back. */
  oldestCursor?: ThreadCursor | null;
  window: { open: boolean; label: string; everWrote: boolean };
  canReply: boolean;
  canConsent: boolean;
  /**
   * The canned messages, already filled in for this contact, in both
   * languages. Built on the server because they carry the site URL and the
   * customer's login number — see lib/crm/quick-replies.ts.
   */
  quickReplies: Record<ReplyLanguage, QuickReply[]>;
  /**
   * What to do once a send or a consent change lands.
   *
   * The thread PAGE has no answer but `router.refresh()`, which re-runs its
   * server component — five awaits, and the screen blanks. Inside the inbox
   * that is the wrong tool entirely: the list beside it has not changed, and
   * refreshing throws away its scroll position and search to rebuild it.
   *
   * So the inbox passes its own re-fetch, which reloads this one conversation
   * over JSON and leaves everything else alone. Absent, the old behaviour
   * stands, which is what the standalone page still wants.
   */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const changed = onChanged ?? (() => router.refresh());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Malayalam first, because most of these conversations are in Malayalam.
  const [lang, setLang] = useState<ReplyLanguage>("ml");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // One file at a time, attached but not yet sent. A caption typed alongside
  // it rides in the same message as Meta's media types — image, video and
  // document all take one — so this doesn't send on its own; Send does.
  const [attachment, setAttachment] = useState<File | null>(null);
  const previewUrl = useMemo(
    () =>
      attachment && attachment.type.startsWith("image/")
        ? URL.createObjectURL(attachment)
        : null,
    [attachment]
  );
  // Only cleanup here — the URL itself is derived above, not stored in state.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    setAttachment(f);
    setError(null);
  }

  /** A screenshot pasted straight from the clipboard — no save-to-disk step. */
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          // Otherwise some browsers also paste the image as garbled text.
          e.preventDefault();
          pickFile(file);
        }
        return;
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    pickFile(e.dataTransfer.files?.[0]);
  }

  /**
   * The messages actually on screen, kept locally rather than read straight
   * off the `messages` prop.
   *
   * The prop is only ever "the newest page" — a poll refresh, or the re-fetch
   * after sending, asks for it again and gets the same top slice back. Taking
   * that prop as truth on every change would snap anyone who had scrolled up
   * to load older messages straight back down to the last 50, mid-read. So
   * incoming messages are merged into what's already showing — new or changed
   * rows applied, nothing already on screen ever removed — see mergeMessages.
   */
  const [msgs, setMsgs] = useState(messages);
  const [hasMore, setHasMore] = useState(hasMoreOlder);
  const [cursor, setCursor] = useState(oldestCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Merging a new `messages` prop into local state during render — React's
  // documented pattern for "adjust state when a prop changes" — rather than
  // in an effect, which would cost an extra render pass for something that
  // has to happen before this render paints anyway.
  const [mergedFrom, setMergedFrom] = useState(messages);
  if (messages !== mergedFrom) {
    setMergedFrom(messages);
    setMsgs((prev) => mergeMessages(prev, messages));
  }

  // Scroll to the bottom only when the newest message actually changes — not
  // when older ones are prepended by loadOlder, which manages scroll itself.
  const newestId = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [newestId]);

  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;

    try {
      const qs = new URLSearchParams({ before: cursor.createdAt, beforeId: cursor.id });
      const res = await fetch(`/api/admin/crm/thread/${contact.id}/messages?${qs}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages: ThreadMessage[];
        hasMore: boolean;
        oldest: { createdAt: string; id: string } | null;
      };
      setMsgs((prev) => mergeMessages(prev, data.messages));
      setHasMore(data.hasMore);
      setCursor(data.oldest);
      // Older messages just grew the scroll height above the viewport — hold
      // the reader's place instead of letting the browser keep them at
      // whatever scrollTop they were at, which reads as the view "jumping".
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  // Opening a conversation is reading it. Fire and forget: a failed unread
  // reset is not worth an error message to somebody who is already reading.
  useEffect(() => {
    fetch("/api/admin/crm/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", contact_id: contact.id }),
    }).catch(() => {});
  }, [contact.id]);

  /**
   * Drop a canned message into the box.
   *
   * Fills rather than sends, and that is deliberate — see the note on
   * lib/crm/quick-replies.ts. Appends to whatever is already typed instead of
   * replacing it, so tapping a chip can never destroy a half-written reply;
   * two chips in a row give two paragraphs, which is usually what was wanted.
   */
  function insert(body: string) {
    setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${body}` : body));
    // Back to the box with the caret at the end, ready to edit.
    requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }

  async function send() {
    const body = text.trim();
    if ((!body && !attachment) || busy) return;

    setBusy(true);
    setError(null);

    let res: Response;
    if (attachment) {
      const form = new FormData();
      form.append("contact_id", contact.id);
      form.append("file", attachment);
      if (body) form.append("caption", body);
      res = await fetch("/api/admin/crm/reply/media", { method: "POST", body: form });
    } else {
      res = await fetch("/api/admin/crm/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contact.id, body }),
      });
    }
    const json = await res.json().catch(() => ({}));

    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "The message did not send.");
      return;
    }
    setText("");
    setAttachment(null);
    changed();
  }

  async function consent(action: string) {
    const reason = prompt(
      action === "resume"
        ? "Why may this contact be messaged again? This undoes something they asked for."
        : "Why are you stopping messages to this contact?"
    );
    if (!reason?.trim()) return;

    setBusy(true);
    const res = await fetch("/api/admin/crm/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, contact_id: contact.id, reason }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) setError(json.error ?? "That didn't work.");
    else changed();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {/* ── Messages ───────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="max-h-[540px] space-y-2.5 overflow-y-auto bg-neutral-50 px-4 py-4"
      >
        {!msgs.length && (
          <p className="py-8 text-center text-xs text-neutral-400">
            No messages yet.
          </p>
        )}

        {hasMore && (
          <div className="flex justify-center pb-1">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] font-medium text-neutral-500 transition hover:border-primary-300 hover:text-primary-700 disabled:opacity-50"
            >
              {loadingOlder && <Loader2 className="h-3 w-3 animate-spin" />}
              {loadingOlder ? "Loading…" : "Load older messages"}
            </button>
          </div>
        )}

        {msgs.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                m.direction === "out"
                  ? "rounded-br-sm bg-[#dcf8c6] text-neutral-900"
                  : "rounded-bl-sm border border-neutral-200 bg-white text-neutral-900"
              }`}
            >
              {m.templateName && (
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-neutral-500">
                  {m.templateName}
                </p>
              )}

              {m.hasMedia && (
                <MediaBubble
                  id={m.id}
                  kind={m.kind}
                  mime={m.mediaMime ?? null}
                  filename={m.mediaFilename ?? null}
                />
              )}

              {/* A caption sits under its picture. A message with media and no
                  caption says nothing here rather than "(image)" beneath an
                  image, which is what the thread used to show instead of the
                  image itself. */}
              {(m.body || !m.hasMedia) && (
                <p className="whitespace-pre-wrap break-words">
                  {m.body ?? <span className="italic text-neutral-400">({m.kind})</span>}
                </p>
              )}

              <p className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-neutral-500">
                {new Date(m.createdAt).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {m.direction === "out" && <Receipt status={m.status} />}
              </p>

              {m.error && (
                <p className="mt-1 flex items-start gap-1 text-[10px] text-red-700">
                  <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                  {m.error}
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* ── The composer, or why there isn't one ───────────────────────── */}
      <div className="border-t border-neutral-100 p-3">
        {error && (
          <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </p>
        )}

        {contact.optedOut ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-800">
            <p className="flex items-center gap-1.5 font-semibold">
              <Ban className="h-3.5 w-3.5" /> This contact asked us to stop.
            </p>
            <p className="mt-1">
              Nothing can be sent to them. If they have asked to hear from us
              again, that has to be recorded deliberately.
            </p>
            {canConsent && (
              <button
                onClick={() => consent("resume")}
                disabled={busy}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Allow messages again
              </button>
            )}
          </div>
        ) : !win.open ? (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-xs text-neutral-600">
            <p className="flex items-center gap-1.5 font-semibold text-neutral-800">
              <Lock className="h-3.5 w-3.5" /> Free replies are closed
            </p>
            <p className="mt-1">
              {win.everWrote
                ? "More than 24 hours have passed since they last wrote. WhatsApp only allows an approved template now — send one from the campaigns screen, or wait for them to write again."
                : "They have never written to this number, so there is no reply window open. Only an approved template can start a conversation."}
            </p>
          </div>
        ) : !canReply ? (
          <p className="px-1 text-xs text-neutral-400">
            You can read this conversation but not reply to it.
          </p>
        ) : (
          <>
            <p className="mb-1.5 px-1 text-[11px] text-green-700">
              Free reply open · {win.label}
            </p>

            {/* ── Canned messages ──────────────────────────────────────
                Fill the box, never send. The language toggle sits with them
                because it only governs these — a hand-typed reply is in
                whatever language the agent is already typing. */}
            {!!quickReplies[lang].length && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <div className="mr-0.5 flex overflow-hidden rounded-md border border-neutral-200">
                  {(["ml", "en"] as const).map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setLang(code)}
                      aria-pressed={lang === code}
                      className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                        lang === code
                          ? "bg-neutral-800 text-white"
                          : "bg-white text-neutral-500 hover:bg-neutral-50"
                      }`}
                    >
                      {code === "ml" ? "മലയാളം" : "English"}
                    </button>
                  ))}
                </div>

                {quickReplies[lang].map((reply) => (
                  <button
                    key={reply.id}
                    type="button"
                    onClick={() => insert(reply.body)}
                    disabled={busy}
                    title={reply.body}
                    className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-600 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-40"
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            )}

            {attachment && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                )}
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  disabled={busy}
                  aria-label="Remove attachment"
                  className="shrink-0 text-neutral-400 transition hover:text-red-600 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div
              className="flex gap-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                title="Attach a file"
                className="shrink-0 self-end rounded-lg border border-neutral-200 p-2.5 text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800 disabled:opacity-40"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                ref={boxRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
                onPaste={handlePaste}
                rows={2}
                placeholder="Reply in Malayalam… or paste a screenshot"
                className="flex-1 resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
              />
              <button
                onClick={send}
                disabled={busy || (!text.trim() && !attachment)}
                className="shrink-0 self-end rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-neutral-400">
              ⌘/Ctrl + Enter to send · paste or drop a file to attach it
            </p>
          </>
        )}

        {canConsent && !contact.optedOut && (
          <button
            onClick={() => consent("stop")}
            disabled={busy}
            className="mt-3 text-[11px] font-medium text-neutral-400 underline-offset-2 transition hover:text-red-600 hover:underline disabled:opacity-50"
          >
            Stop all messages to this contact
          </button>
        )}
      </div>
    </div>
  );
}

/** The tick, the way the customer's own app shows it. */
function Receipt({ status }: { status: string | null }) {
  switch (status) {
    case "read":
      return <CheckCheck className="h-3 w-3 text-sky-500" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-neutral-400" />;
    case "sent":
      return <Check className="h-3 w-3 text-neutral-400" />;
    // The message is already visible in the thread; Meta hasn't been asked
    // yet, or hasn't answered — see queueReply/deliverQueuedReply.
    case "queued":
      return <Clock className="h-3 w-3 text-neutral-300" />;
    case "failed":
      return <AlertCircle className="h-3 w-3 text-red-500" />;
    default:
      return null;
  }
}

/**
 * A customer's photo, voice note, video or document.
 *
 * Everything loads through /api/admin/crm/media/<message id>, which is a proxy
 * rather than a link: Meta's media URLs expire in minutes and only answer to a
 * request carrying the access token, so there is nothing here a browser could
 * fetch on its own.
 *
 * Lazily, and only when the bubble is on screen. A thread with forty voice
 * notes should not make forty authenticated round trips to Meta because
 * somebody scrolled past them — the browser fetches an <img> or an <audio>
 * source when it decides to, and that is the right moment.
 *
 * Nothing here retries. Media older than 30 days is gone from Meta's side, and
 * a retry loop against a file that no longer exists is just noise.
 */
function MediaBubble({
  id,
  kind,
  mime,
  filename,
}: {
  id: string;
  kind: string;
  mime: string | null;
  filename: string | null;
}) {
  const src = `/api/admin/crm/media/${id}`;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p className="mb-1.5 flex items-start gap-1 rounded-lg bg-neutral-100 px-2 py-1.5 text-[11px] text-neutral-500">
        <AlertCircle className="mt-px h-3 w-3 shrink-0" />
        <span>
          This {kind} could not be loaded. WhatsApp keeps media for 30 days —
          older files are gone from their side.
        </span>
      </p>
    );
  }

  if (kind === "image" || kind === "sticker") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${kind} from the customer`}
        loading="lazy"
        onError={() => setFailed(true)}
        onClick={() => window.open(src, "_blank")}
        className={`mb-1.5 cursor-zoom-in rounded-lg ${
          kind === "sticker" ? "max-h-32 w-auto" : "max-h-64 w-auto"
        }`}
      />
    );
  }

  if (kind === "audio") {
    return (
      // A voice note is the one kind people actually send this number, and it
      // needs no more than the browser's own player.
      <audio
        controls
        preload="none"
        onError={() => setFailed(true)}
        className="mb-1.5 w-56 max-w-full"
      >
        <source src={src} type={mime ?? undefined} />
      </audio>
    );
  }

  if (kind === "video") {
    return (
      <video
        controls
        preload="none"
        onError={() => setFailed(true)}
        className="mb-1.5 max-h-64 w-auto rounded-lg"
      >
        <source src={src} type={mime ?? undefined} />
      </video>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-2 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-200"
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{filename ?? `Download ${kind}`}</span>
    </a>
  );
}
