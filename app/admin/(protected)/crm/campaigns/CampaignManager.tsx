"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Pause, Square, Eye, Plus } from "lucide-react";
import { SEGMENT_SOURCES } from "@/lib/crm/segments";

/**
 * Compose, preview, and run a campaign.
 *
 * The Create button stays disabled until a dry run has been done. That is
 * deliberate friction: the dry run is the only place the real recipient count
 * and every exclusion appear, and a campaign nobody previewed is a campaign
 * nobody checked.
 */

interface CampaignRow {
  id: string;
  name: string;
  templateName: string;
  status: string;
  haltReason: string | null;
  cap: number;
  sent: number;
  failed: number;
  refused: number;
  createdBy: string | null;
  createdAt: string;
}

interface TemplateOption {
  name: string;
  category: string;
  body: string;
  approved: boolean;
}

interface DryRunResult {
  willSend: number;
  preview: string | null;
  excluded: { reason: string; count: number }[];
  unreachable: number;
  members: unknown[];
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-600 border-neutral-200",
  sending: "bg-blue-50 text-blue-700 border-blue-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  done: "bg-green-50 text-green-700 border-green-200",
  halted: "bg-red-50 text-red-700 border-red-200",
};

export default function CampaignManager({
  campaigns,
  templates,
  canRun,
  defaultCap,
}: {
  campaigns: CampaignRow[];
  templates: TemplateOption[];
  canRun: boolean;
  defaultCap: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [templateName, setTemplateName] = useState(templates[0]?.name ?? "");
  const [orderStage, setOrderStage] = useState("");
  const [deliveryStage, setDeliveryStage] = useState("");
  const [cap, setCap] = useState(defaultCap);
  const [dry, setDry] = useState<DryRunResult | null>(null);

  const segment = () => ({
    ...(orderStage ? { orderStage } : {}),
    ...(deliveryStage ? { deliveryStage } : {}),
  });

  // Any change to what is being sent, or to whom, invalidates the preview.
  // Otherwise someone previews one segment and creates another.
  function invalidate<T>(setter: (v: T) => void) {
    return (v: T) => {
      setDry(null);
      setter(v);
    };
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/crm/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "That didn't work.");
      return null;
    }
    return json;
  }

  async function runDry() {
    const json = await post({
      action: "dry_run",
      template_name: templateName,
      cap,
      segment: segment(),
    });
    if (json) setDry(json as DryRunResult);
  }

  async function create() {
    const json = await post({
      action: "create",
      name,
      template_name: templateName,
      cap,
      segment: segment(),
    });
    if (json) {
      setOpen(false);
      setDry(null);
      setName("");
      router.refresh();
    }
  }

  async function control(id: string, action: string) {
    if (action === "stop" && !confirm("Stop this campaign? It cannot be restarted."))
      return;
    const json = await post({ action, campaign_id: id });
    if (json) router.refresh();
  }

  const selected = templates.find((t) => t.name === templateName);

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {canRun && !open && (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600"
        >
          <Plus className="h-4 w-4" /> New campaign
        </button>
      )}

      {/* ── Composer ───────────────────────────────────────────────────── */}
      {open && (
        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">
                Name (for you, not the customer)
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="August abandoned checkouts"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">
                Template
              </span>
              <select
                value={templateName}
                onChange={(e) => invalidate(setTemplateName)(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              >
                {templates.map((t) => (
                  <option key={t.name} value={t.name} disabled={!t.approved}>
                    {t.name} · {t.category}
                    {t.approved ? "" : " — not approved by Meta"}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">
                Where they got to in checkout
              </span>
              <select
                value={orderStage}
                onChange={(e) => invalidate(setOrderStage)(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              >
                <option value="">Any</option>
                {SEGMENT_SOURCES[0].options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">
                Where the parcel is
              </span>
              <select
                value={deliveryStage}
                onChange={(e) => invalidate(setDeliveryStage)(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
              >
                <option value="">Any</option>
                {SEGMENT_SOURCES[1].options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">
                Send to at most
              </span>
              <input
                type="number"
                min={1}
                max={5000}
                value={cap}
                onChange={(e) => invalidate(setCap)(Number(e.target.value))}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm tabular-nums focus:border-primary-400 focus:outline-none"
              />
              <span className="mt-1 block text-[11px] text-neutral-400">
                Keep the first one at 50.
              </span>
            </label>
          </div>

          {selected && (
            <div className="rounded-lg bg-neutral-50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                What they will read
              </p>
              <p className="max-w-md whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3.5 py-2.5 text-[13px] leading-relaxed">
                {dry?.preview ?? selected.body}
              </p>
            </div>
          )}

          {/* ── Dry run result ───────────────────────────────────────────── */}
          {dry && (
            <div className="rounded-lg border border-neutral-200 p-3.5 text-sm">
              <p className="font-bold text-neutral-900">
                Would message{" "}
                <span className="tabular-nums">{dry.willSend}</span>{" "}
                {dry.willSend === 1 ? "person" : "people"}
              </p>
              {!!dry.excluded.length && (
                <ul className="mt-2 space-y-0.5 text-xs text-neutral-600">
                  {dry.excluded.map((e) => (
                    <li key={e.reason}>
                      <span className="tabular-nums font-semibold">{e.count}</span>{" "}
                      excluded — {e.reason}
                    </li>
                  ))}
                </ul>
              )}
              {dry.unreachable > 0 && (
                <p className="mt-1 text-xs text-neutral-500 tabular-nums">
                  {dry.unreachable} orders have no usable phone number.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={runDry}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
            >
              <Eye className="h-4 w-4" /> Preview
            </button>
            <button
              onClick={create}
              disabled={busy || !dry || !name.trim() || !selected?.approved}
              title={
                !dry
                  ? "Preview it first"
                  : !selected?.approved
                    ? "That template is not approved by Meta"
                    : ""
              }
              className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-40"
            >
              Create (queues, sends nothing yet)
            </button>
            <button
              onClick={() => { setOpen(false); setDry(null); }}
              className="px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Existing campaigns ─────────────────────────────────────────── */}
      {!campaigns.length ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
          No campaigns yet.
        </p>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-neutral-900">
                    {c.name}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        STATUS_STYLE[c.status] ?? STATUS_STYLE.draft
                      }`}
                    >
                      {c.status}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {c.templateName} · cap {c.cap} ·{" "}
                    {c.createdBy ?? "unknown"} ·{" "}
                    {c.createdAt.slice(0, 10)}
                  </p>
                </div>

                {canRun && (
                  <div className="flex shrink-0 gap-1.5">
                    {(c.status === "draft" || c.status === "paused") && (
                      <button
                        onClick={() => control(c.id, "start")}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg border border-green-300 bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-700 transition hover:bg-green-100 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> Start
                      </button>
                    )}
                    {c.status === "sending" && (
                      <button
                        onClick={() => control(c.id, "pause")}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </button>
                    )}
                    {(c.status === "sending" || c.status === "paused") && (
                      <button
                        onClick={() => control(c.id, "stop")}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        <Square className="h-3.5 w-3.5" /> Stop
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 tabular-nums">
                <span><span className="text-neutral-400">Sent</span> {c.sent}</span>
                <span><span className="text-neutral-400">Refused</span> {c.refused}</span>
                <span><span className="text-neutral-400">Failed</span> {c.failed}</span>
              </div>

              {c.haltReason && (
                <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  <strong>Halted:</strong> {c.haltReason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
