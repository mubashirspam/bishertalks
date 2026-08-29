"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Tag, X, CalendarClock, AlertTriangle } from "lucide-react";
import { TAG_LABELS, HOLD_TAGS } from "@/lib/crm/tags";

/**
 * Tags, stage and what happens next.
 *
 * The panel answers the question the inbox could not: *why* is this customer
 * getting a message in nine days, and what did they tell us to make that
 * happen. A follow-up nobody can see is a follow-up nobody can stop.
 */

export interface PendingEvent {
  id: string;
  eventType: string;
  templateName: string | null;
  scheduledAt: string;
  reason: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  later_reminder: "Reminder about the book",
  reading_followup_10d: "10-day reading check",
  encouragement: "Reading encouragement",
  feedback_30d: "30-day feedback",
  referral_followup: "Referral follow-up",
};

const STAGE_LABELS: Record<string, string> = {
  ordering: "Sent to the order page",
  delivered_confirmed: "Confirmed the book arrived",
  active_reader: "Reading well",
  slow_reader: "Reading slowly",
  not_started: "Not started reading",
  feedback_requested: "Asked for feedback",
  referral_interested: "Open to referring",
};

export default function CrmPanel({
  contactId,
  tags,
  stage,
  pending,
  canEdit,
}: {
  contactId: string;
  tags: string[];
  stage: string | null;
  pending: PendingEvent[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await fetch(`/api/admin/crm/${contactId}/crm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "That didn't work.");
      return;
    }
    router.refresh();
  }

  const held = tags.some((t) => HOLD_TAGS.includes(t));

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        CRM
      </h2>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </p>
      )}

      {/* A hold is the loudest thing on this panel because it is the one that
          silently stops messages going out. Somebody has to know why. */}
      {held && (
        <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>On hold.</strong> No follow-up will be sent until the
            problem tag is cleared.
          </span>
        </p>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white px-3.5 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          Stage
        </p>
        <p className="mt-0.5 text-xs font-medium text-neutral-800">
          {stage ? (STAGE_LABELS[stage] ?? stage) : "—"}
        </p>
        {/* Named so nobody reads it as the funnel stage, which is derived from
            the orders and lives on the People screen. */}
        <p className="mt-1 text-[10px] text-neutral-400">
          Where the relationship got to. Their funnel stage is on People.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white px-3.5 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          Tags
        </p>

        {!tags.length && <p className="text-[11px] text-neutral-400">None yet.</p>}

        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              title={TAG_LABELS[t] ?? t}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                HOLD_TAGS.includes(t)
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-neutral-200 bg-neutral-50 text-neutral-600"
              }`}
            >
              <Tag className="h-2.5 w-2.5" />
              {TAG_LABELS[t] ?? t}
              {canEdit && (
                <button
                  onClick={() => post({ action: "remove_tag", tag: t }, `rm:${t}`)}
                  disabled={busy === `rm:${t}`}
                  title="Remove this tag"
                  className="ml-0.5 text-neutral-400 transition hover:text-red-600 disabled:opacity-40"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>

        {canEdit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const tag = adding.trim().toLowerCase().replace(/\s+/g, "_");
              if (!tag) return;
              setAdding("");
              void post({ action: "add_tag", tag }, `add:${tag}`);
            }}
            className="mt-2 flex gap-1.5"
          >
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="Add a tag"
              className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] focus:border-primary-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!adding.trim() || !!busy}
              className="rounded-lg border border-neutral-300 px-2 py-1 text-[11px] font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
            >
              Add
            </button>
          </form>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white px-3.5 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          <CalendarClock className="h-3 w-3" /> Next follow-up
        </p>

        {!pending.length ? (
          <p className="text-[11px] text-neutral-400">Nothing scheduled.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((e) => (
              <li key={e.id} className="text-[11px]">
                <p className="font-semibold text-neutral-800">
                  {EVENT_LABELS[e.eventType] ?? e.eventType}
                </p>
                <p className="flex items-center gap-1 text-neutral-500">
                  <Clock className="h-2.5 w-2.5" />
                  {new Date(e.scheduledAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                {/* Why it is queued. Usually the button they tapped. */}
                {e.reason && <p className="text-neutral-400">{e.reason}</p>}
                {canEdit && (
                  <button
                    onClick={() => post({ action: "cancel_event", id: e.id }, `x:${e.id}`)}
                    disabled={busy === `x:${e.id}`}
                    className="mt-0.5 text-[10px] text-neutral-500 underline underline-offset-2 transition hover:text-red-600 disabled:opacity-40"
                  >
                    Cancel this
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
