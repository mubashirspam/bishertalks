"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "@/components/admin/AdminLink";
import { PhoneCall, Loader2, X } from "lucide-react";
import { CALL_ASSIGN_MAX } from "@/lib/calls";

/**
 * Put exactly what the report is showing on somebody's calling list.
 *
 * Same contract as ReportDownload beside it: sends the page's own query
 * string, so the list assigned is the list on screen.
 */
export default function AssignCalls({
  staff,
  count,
}: {
  staff: { id: string; name: string }[];
  count: number;
}) {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [label, setLabel] = useState(params.get("remark") ?? "");
  const [reassign, setReassign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; href?: string } | null>(null);

  const tooMany = count > CALL_ASSIGN_MAX;
  const who = staff.find((s) => s.id === staffId)?.name;

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const qs = new URLSearchParams(params.toString());
      qs.delete("page");
      const res = await fetch("/api/admin/calls/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: qs.toString(), staff_id: staffId, reassign, label }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ text: json.error ?? "Could not assign", bad: true });
        return;
      }
      const parts = [`${json.created} new call${json.created === 1 ? "" : "s"} for ${json.assignee}`];
      if (json.reassigned) parts.push(`${json.reassigned} moved from someone else`);
      if (json.skipped) parts.push(`${json.skipped} already on a list`);
      setMsg({ text: parts.join(" · "), href: `/admin/calls?assignee=${staffId}` });
    } catch {
      setMsg({ text: "Network error", bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={count === 0}
        title="Give these customers to a staff member to call"
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all disabled:opacity-50 bg-primary-500 border-primary-500 text-white hover:bg-primary-600"
      >
        <PhoneCall className="w-3.5 h-3.5" /> Assign calls
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-80 max-w-[calc(100vw-2rem)] bg-white border border-neutral-200 rounded-2xl shadow-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-neutral-900">
              Assign {count.toLocaleString("en-IN")} customer{count === 1 ? "" : "s"} to call
            </p>
            <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-900">
              <X className="w-4 h-4" />
            </button>
          </div>

          {tooMany ? (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-2">
              That&apos;s more than {CALL_ASSIGN_MAX.toLocaleString("en-IN")} — narrow the filters first.
            </p>
          ) : staff.length === 0 ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              Nobody has customer care access yet. On the Staff screen, tick “Work your own calling list” for whoever should call.
            </p>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">Who calls</label>
                <select
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm cursor-pointer"
                >
                  <option value="">Pick a staff member…</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">List name (optional)</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Consignee Unavailable — 15 Sep"
                  className="w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-start gap-2 text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={reassign}
                  onChange={(e) => setReassign(e.target.checked)}
                  className="mt-0.5"
                />
                Also move customers already on someone else&apos;s list
              </label>
              <button
                onClick={() => void submit()}
                disabled={busy || !staffId}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {who ? `Assign to ${who}` : "Assign"}
              </button>
            </>
          )}

          {msg && (
            <p className={`text-xs ${msg.bad ? "text-rose-600" : "text-green-700"}`}>
              {msg.text}
              {msg.href && (
                <>
                  {" · "}
                  <Link href={msg.href} className="underline font-medium">
                    Open list
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
