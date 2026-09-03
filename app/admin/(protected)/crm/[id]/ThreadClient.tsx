"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Lock, Ban, RotateCcw, AlertCircle, Check, CheckCheck, Paperclip } from "lucide-react";
import type { QuickReply, ReplyLanguage } from "@/lib/crm/quick-replies";

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

export default function ThreadClient({
  contact,
  messages,
  window: win,
  canReply,
  canConsent,
  quickReplies,
}: {
  contact: { id: string; phone: string; optedOut: boolean; marketingOptIn: boolean };
  messages: ThreadMessage[];
  window: { open: boolean; label: string; everWrote: boolean };
  canReply: boolean;
  canConsent: boolean;
  /**
   * The canned messages, already filled in for this contact, in both
   * languages. Built on the server because they carry the site URL and the
   * customer's login number — see lib/crm/quick-replies.ts.
   */
  quickReplies: Record<ReplyLanguage, QuickReply[]>;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Malayalam first, because most of these conversations are in Malayalam.
  const [lang, setLang] = useState<ReplyLanguage>("ml");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

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
    if (!body || busy) return;

    setBusy(true);
    setError(null);

    const res = await fetch("/api/admin/crm/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contact.id, body }),
    });
    const json = await res.json().catch(() => ({}));

    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "The message did not send.");
      return;
    }
    setText("");
    router.refresh();
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
    else router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {/* ── Messages ───────────────────────────────────────────────────── */}
      <div className="max-h-[540px] space-y-2.5 overflow-y-auto bg-neutral-50 px-4 py-4">
        {!messages.length && (
          <p className="py-8 text-center text-xs text-neutral-400">
            No messages yet.
          </p>
        )}

        {messages.map((m) => (
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

            <div className="flex gap-2">
              <textarea
                ref={boxRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
                rows={2}
                placeholder="Reply in Malayalam…"
                className="flex-1 resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
              />
              <button
                onClick={send}
                disabled={busy || !text.trim()}
                className="shrink-0 self-end rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 px-1 text-[10px] text-neutral-400">
              ⌘/Ctrl + Enter to send
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
