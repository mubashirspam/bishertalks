"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { X } from "lucide-react";
import {
  TEMPLATE_FILTERS,
  FILTER_LABELS,
  FILTER_HINTS,
  PURPOSE_LABELS,
  PURPOSE_HINTS,
  type TemplateFilter,
  type TemplatePurpose,
} from "@/lib/whatsapp-registry";

/**
 * Two axes, because they answer two different questions.
 *
 * Status answers "what can send right now" — the one somebody checks after a
 * push. Purpose answers "what is this for", which is what you want when a
 * customer is on the phone and you need the receipt, not the campaign.
 *
 * Counts are on the chips, and each is counted with the *other* axis applied
 * but not itself, so the number on a chip is what clicking it would show.
 */

const STATUS_TONE: Record<TemplateFilter, string> = {
  approved: "border-green-600 bg-green-50 text-green-700",
  pending: "border-amber-500 bg-amber-50 text-amber-800",
  rejected: "border-red-500 bg-red-50 text-red-700",
  not_submitted: "border-neutral-500 bg-neutral-100 text-neutral-800",
  other: "border-violet-500 bg-violet-50 text-violet-700",
};

const PURPOSES: TemplatePurpose[] = [
  "automatic",
  "flow",
  "campaign",
  "draft",
  "orphan",
];

export default function TemplateFilters({
  statusCounts,
  purposeCounts,
  total,
  showing,
}: {
  statusCounts: Record<TemplateFilter, number>;
  purposeCounts: Record<TemplatePurpose, number>;
  total: number;
  showing: number;
}) {
  const params = useSearchParams();
  const router = useRouter();

  const status = params.get("status") ?? "";
  const purpose = params.get("purpose") ?? "";

  const push = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.push(`/admin/templates${qs ? `?${qs}` : ""}`);
  };

  const chip = (active: boolean, activeClass: string) =>
    `px-3 py-1.5 rounded-lg border text-xs transition-all ${
      active
        ? `${activeClass} font-semibold`
        : "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
    }`;

  const count = (n: number) => <span className="tabular-nums opacity-70"> {n}</span>;

  return (
    <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-neutral-100 pb-3">
        <span className="text-xs font-medium text-neutral-500">Status</span>
        <button
          onClick={() => push({ status: null })}
          className={chip(!status, "border-neutral-900 bg-neutral-900 text-white")}
        >
          All{count(total)}
        </button>
        {TEMPLATE_FILTERS.map((f) => (
          <button
            key={f}
            title={FILTER_HINTS[f]}
            onClick={() => push({ status: status === f ? null : f })}
            className={chip(status === f, STATUS_TONE[f])}
          >
            {FILTER_LABELS[f]}
            {count(statusCounts[f])}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-500">Kind</span>
        <button
          onClick={() => push({ purpose: null })}
          className={chip(!purpose, "border-neutral-900 bg-neutral-900 text-white")}
        >
          Any
        </button>
        {PURPOSES.map((p) => (
          <button
            key={p}
            title={PURPOSE_HINTS[p]}
            onClick={() => push({ purpose: purpose === p ? null : p })}
            className={chip(purpose === p, "border-primary-500 bg-primary-50 text-primary-700")}
          >
            {PURPOSE_LABELS[p]}
            {count(purposeCounts[p])}
          </button>
        ))}

        <p className="ml-auto whitespace-nowrap text-xs tabular-nums text-neutral-500">
          {showing} of {total}
        </p>

        {(status || purpose) && (
          <button
            onClick={() => router.push("/admin/templates")}
            className="flex items-center gap-1 text-xs text-neutral-500 transition-colors hover:text-neutral-900"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
