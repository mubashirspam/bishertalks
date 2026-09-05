"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Clock, Search, ArrowLeft, Loader2, MessageSquare, X } from "lucide-react";
import ThreadClient from "./[id]/ThreadClient";
import type { ThreadView } from "@/lib/crm/thread-view";

/**
 * The inbox, as a messaging app rather than a list of links.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * Every conversation used to be a `<Link>` to /admin/crm/[id]. Clicking one
 * was a full navigation into a server component with five awaits in it, so the
 * screen blanked and rebuilt — including the list you had just clicked in,
 * which lost its scroll position, its filter and whatever you had typed in the
 * search box. Sending a message was worse: `router.refresh()` re-ran that same
 * page, so every reply cost the whole screen again.
 *
 * Neither delay was doing any work. The list does not change when you open a
 * conversation, and it barely changes when you send one. So the list is
 * rendered once and stays; selecting somebody fetches only their thread, over
 * JSON, into the right-hand pane.
 *
 * THE URL STILL MOVES. Selection is written to `?c=<id>` with
 * `history.pushState` rather than a router navigation — the address bar stays
 * honest, Back steps through the conversations you opened, and a reload puts
 * you back where you were, all without Next re-rendering the page. The old
 * /admin/crm/[id] route is untouched and still works as a deep link.
 */

export interface ConversationRow {
  id: string;
  phone: string;
  displayName: string | null;
  unread: number;
  optedOut: boolean;
  lastOrderNumber: string | null;
  lastInboundAt: string | null;
  windowOpen: boolean;
  windowLabel: string;
}

type Loaded = ThreadView & { canReply: boolean; canConsent: boolean };

export default function InboxShell({
  conversations,
  initialId,
}: {
  conversations: ConversationRow[];
  initialId: string | null;
}) {
  const [rows, setRows] = useState(conversations);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [thread, setThread] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // The request that is allowed to write to state. Clicking three people
  // quickly fires three fetches, and without this the slowest one wins and
  // renders the wrong conversation into the pane you are looking at.
  const latest = useRef(0);

  const load = useCallback(async (id: string, markRead: boolean) => {
    const ticket = ++latest.current;
    setLoading(true);
    setFailed(null);

    try {
      const res = await fetch(
        `/api/admin/crm/thread/${id}${markRead ? "?read=1" : ""}`,
        { cache: "no-store" }
      );
      if (ticket !== latest.current) return;

      if (!res.ok) {
        setFailed(res.status === 404 ? "That conversation is gone." : "Could not load it.");
        setThread(null);
        return;
      }
      const data = (await res.json()) as Loaded;
      if (ticket !== latest.current) return;

      setThread(data);
      // Opening a conversation is reading it, so the badge goes here too
      // rather than waiting for the list to be rebuilt from the server.
      if (markRead) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, unread: 0 } : r)));
      }
    } catch {
      if (ticket === latest.current) {
        setFailed("Could not reach the server.");
        setThread(null);
      }
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  function select(id: string) {
    if (id === selected) return;
    setSelected(id);
    setThread(null);
    window.history.pushState(null, "", `/admin/crm?c=${id}`);
    void load(id, true);
  }

  function clear() {
    setSelected(null);
    setThread(null);
    window.history.pushState(null, "", "/admin/crm");
  }

  // Back and forward move between conversations without a page load.
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get("c");
      setSelected(id);
      setThread(null);
      if (id) void load(id, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  // The conversation open on first paint, when arriving at /admin/crm?c=…
  //
  // Scheduled rather than called straight from the effect body: `load` sets
  // state on its first line, and doing that synchronously inside an effect
  // cascades an extra render before the browser has painted anything. Both
  // dependencies are stable, so this still runs once.
  useEffect(() => {
    if (!initialId) return;
    queueMicrotask(() => void load(initialId, true));
  }, [initialId, load]);

  /**
   * New messages, while you are looking at the thread.
   *
   * Ten seconds, and only for the open conversation — polling the whole list
   * would put a full inbox query on a timer for every open admin tab. Paused
   * while the tab is hidden, because a backgrounded tab polling a WhatsApp API
   * all afternoon is how a rate limit gets found.
   */
  useEffect(() => {
    if (!selected) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load(selected, false);
    };
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [selected, load]);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) =>
        `${r.displayName ?? ""} ${r.phone} ${r.lastOrderNumber ?? ""}`
          .toLowerCase()
          .includes(needle)
      )
    : rows;

  return (
    <div className="grid h-[calc(100vh-13rem)] min-h-[520px] overflow-hidden rounded-xl border border-neutral-200 bg-white lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ── The list ──────────────────────────────────────────────────── */}
      <div
        className={`flex min-h-0 flex-col border-neutral-200 lg:border-r ${
          selected ? "hidden lg:flex" : "flex"
        }`}
      >
        <div className="shrink-0 border-b border-neutral-100 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, number or order"
              aria-label="Search conversations"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-8 text-sm focus:border-primary-400 focus:bg-white focus:outline-none"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!shown.length ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">
              {needle ? "Nobody matches that." : "No conversations yet."}
            </p>
          ) : (
            shown.map((c) => (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                className={`flex w-full items-center gap-3 border-b border-neutral-50 px-4 py-3 text-left transition ${
                  c.id === selected ? "bg-primary-50" : "hover:bg-neutral-50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                    <span className="truncate">{c.displayName?.trim() || c.phone}</span>
                    {c.unread > 0 && (
                      <span className="shrink-0 rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                        {c.unread}
                      </span>
                    )}
                    {c.optedOut && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                        <Ban className="h-2.5 w-2.5" /> Stopped
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs tabular-nums text-neutral-400">
                    {c.phone}
                    {c.lastOrderNumber ? ` · ${c.lastOrderNumber}` : ""}
                  </p>
                </div>
                <div className="shrink-0">
                  {c.windowOpen ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                      <Clock className="h-2.5 w-2.5" />
                      {c.windowLabel}
                    </span>
                  ) : (
                    <span className="text-[10px] text-neutral-400">
                      {c.lastInboundAt ? "Closed" : "—"}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── The conversation ──────────────────────────────────────────── */}
      <div className={`min-h-0 flex-col ${selected ? "flex" : "hidden lg:flex"}`}>
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
            <MessageSquare className="h-8 w-8" />
            <p className="text-sm">Pick a conversation</p>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-3 border-b border-neutral-100 px-4 py-3">
              <button
                onClick={clear}
                aria-label="Back to conversations"
                className="-ml-1 rounded p-1 text-neutral-500 hover:text-neutral-900 lg:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">
                  {thread?.displayName ??
                    rows.find((r) => r.id === selected)?.displayName ??
                    rows.find((r) => r.id === selected)?.phone ??
                    "…"}
                </p>
                <p className="truncate text-xs tabular-nums text-neutral-400">
                  {thread?.contact.phone ?? rows.find((r) => r.id === selected)?.phone}
                  {thread?.window.open ? ` · window ${thread.window.label}` : ""}
                </p>
              </div>
              {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-300" />}
              <a
                href={`/admin/crm/${selected}`}
                className="shrink-0 text-xs text-neutral-400 underline hover:text-neutral-700"
              >
                Full page
              </a>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {failed ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {failed}
                </p>
              ) : !thread ? (
                <div className="flex h-full items-center justify-center text-neutral-300">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <>
                  {thread.optOut && (
                    <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      <strong>
                        Asked us to stop on {thread.optOut.at.slice(0, 10)}.
                      </strong>{" "}
                      {thread.optOut.reason}
                      {thread.optOut.source ? ` (${thread.optOut.source})` : ""}. Nothing
                      can be sent until someone with permission lifts it.
                    </p>
                  )}
                  <ThreadClient
                    key={thread.contact.id}
                    contact={thread.contact}
                    messages={thread.messages}
                    window={thread.window}
                    canReply={thread.canReply}
                    canConsent={thread.canConsent}
                    quickReplies={thread.quickReplies}
                    // Re-fetch this conversation only. No navigation, so the
                    // list keeps its scroll, its search and its place.
                    onChanged={() => void load(thread.contact.id, false)}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
