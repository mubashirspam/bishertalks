"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Lock, Ban, RotateCcw, AlertCircle, Check, CheckCheck } from "lucide-react";

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
}: {
  contact: { id: string; phone: string; optedOut: boolean; marketingOptIn: boolean };
  messages: ThreadMessage[];
  window: { open: boolean; label: string; everWrote: boolean };
  canReply: boolean;
  canConsent: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

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

              <p className="whitespace-pre-wrap break-words">
                {m.body ?? <span className="italic text-neutral-400">({m.kind})</span>}
              </p>

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
            <div className="flex gap-2">
              <textarea
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
