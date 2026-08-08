"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  UserPlus, KeyRound, Trash2, Copy, Check, X, AlertCircle, Power,
} from "lucide-react";
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_PRESETS,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_BADGE,
  STAFF_ROLES,
  type Permission,
  type StaffRole,
} from "@/lib/permissions";
import type { Staff } from "@/lib/db/staff";
import { formatISTShort } from "@/lib/format-date";

interface Draft {
  id?: string;
  email: string;
  name: string;
  phone: string;
  role: StaffRole;
  permissions: Permission[];
}

const blank = (): Draft => ({
  email: "",
  name: "",
  phone: "",
  role: "delivery",
  permissions: [...ROLE_PRESETS.delivery],
});

export default function StaffManager({
  staff,
  currentStaffId,
}: {
  staff: Staff[];
  currentStaffId: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Shown once, never retrievable again — see the API route. */
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const editing = !!draft?.id;

  const call = async (method: string, body: unknown, query = "") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/staff${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
        return null;
      }
      router.refresh();
      return json;
    } catch {
      setError("Network error — try again");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const result = editing
      ? await call("PATCH", {
          id: draft.id,
          name: draft.name,
          phone: draft.phone,
          role: draft.role,
          permissions: draft.permissions,
        })
      : await call("POST", draft);

    if (!result) return;
    if (result.password) {
      setTempPassword({ email: draft.email, password: result.password });
    }
    setDraft(null);
  };

  const resetPassword = async (s: Staff) => {
    const result = await call("PATCH", { id: s.id, action: "reset_password" });
    if (result?.password) setTempPassword({ email: s.email, password: result.password });
  };

  const toggleActive = (s: Staff) =>
    call("PATCH", { id: s.id, is_active: !s.is_active });

  const remove = async (s: Staff) => {
    if (!confirm(`Remove ${s.name}? Their login stops working immediately.`)) return;
    await call("DELETE", null, `?id=${s.id}`);
  };

  const copyPassword = async () => {
    if (!tempPassword) return;
    await navigator.clipboard?.writeText(tempPassword.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const field =
    "bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div>
      {/* One-time password hand-off */}
      {tempPassword && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 mb-4">
          <div className="flex items-start gap-2">
            <KeyRound className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Temporary password for {tempPassword.email}
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Send it to them now — it can&apos;t be shown again. They sign in at
                /admin/login and should change it.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="font-mono text-base font-bold bg-white border border-amber-300 rounded-lg px-3 py-1.5 text-neutral-900">
                  {tempPassword.password}
                </code>
                <button
                  onClick={copyPassword}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    copied ? "bg-green-500 text-white" : "bg-neutral-900 text-white hover:bg-neutral-700"
                  }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <button onClick={() => setTempPassword(null)} className="text-amber-700 hover:text-amber-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Add / edit form */}
      {draft ? (
        <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm mb-5">
          <h2 className="font-semibold text-sm text-neutral-700 mb-4">
            {editing ? `Edit ${draft.name}` : "Add someone"}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Full name"
                className={`${field} w-full`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Email</label>
              <input
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="name@example.com"
                // Changing an email would desync the Supabase Auth account.
                disabled={editing}
                className={`${field} w-full disabled:bg-neutral-50 disabled:text-neutral-500`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Phone <span className="text-neutral-400 font-normal">(optional)</span>
              </label>
              <input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="10-digit mobile"
                className={`${field} w-full`}
              />
            </div>
          </div>

          {/* Role — picking one refills the permission ticks below */}
          <label className="text-xs font-medium text-neutral-500 mb-1.5 block">Role</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            {STAFF_ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setDraft({ ...draft, role: r, permissions: [...ROLE_PRESETS[r]] })}
                className={`text-left p-3 rounded-xl border transition-all ${
                  draft.role === r
                    ? "border-primary-500 bg-primary-50"
                    : "border-neutral-200 hover:border-neutral-400"
                }`}
              >
                <p className="text-sm font-semibold text-neutral-900">{ROLE_LABELS[r]}</p>
                <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug">
                  {ROLE_DESCRIPTIONS[r]}
                </p>
              </button>
            ))}
          </div>

          {draft.role === "owner" ? (
            <p className="text-xs text-neutral-500 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5">
              Owners can do everything — there&apos;s nothing to tick.
            </p>
          ) : (
            <>
              <label className="text-xs font-medium text-neutral-500 mb-1.5 block">
                Can do
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                      {group.label}
                    </p>
                    {group.permissions.map((p) => (
                      <label key={p} className="flex items-start gap-2 py-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.permissions.includes(p)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              permissions: e.target.checked
                                ? [...draft.permissions, p]
                                : draft.permissions.filter((x) => x !== p),
                            })
                          }
                          className="w-4 h-4 mt-0.5 rounded border-neutral-300 accent-primary-500"
                        />
                        <span className="text-xs text-neutral-700 leading-snug">
                          {PERMISSIONS[p]}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex gap-2 mt-5 pt-4 border-t border-neutral-100">
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold disabled:opacity-60 transition-colors"
            >
              {busy ? "Saving…" : editing ? "Save changes" : "Create account"}
            </button>
            <button
              onClick={() => { setDraft(null); setError(""); }}
              className="px-4 py-2 rounded-xl border border-neutral-200 text-sm text-neutral-600 hover:border-neutral-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setDraft(blank()); setError(""); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-bold mb-5 transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Add someone
        </button>
      )}

      {/* The team */}
      <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left bg-neutral-50">
                {["Person", "Role", "Can do", "Added", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => {
                const isMe = !!currentStaffId && currentStaffId === s.id;
                return (
                  <tr
                    key={s.id}
                    className={`border-b border-neutral-100 last:border-0 ${
                      s.is_active ? "" : "bg-neutral-50/60 opacity-70"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <p className="text-neutral-900 font-medium">
                        {s.name}
                        {isMe && <span className="text-neutral-400 font-normal"> (you)</span>}
                      </p>
                      <p className="text-neutral-500 text-xs">{s.email}</p>
                      {!s.is_active && (
                        <p className="text-red-600 text-[11px] font-medium mt-0.5">Switched off</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${ROLE_BADGE[s.role]}`}>
                        {ROLE_LABELS[s.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500 max-w-[220px]">
                      {s.role === "owner"
                        ? "Everything"
                        : s.permissions.length
                          ? `${s.permissions.length} permission${s.permissions.length === 1 ? "" : "s"}`
                          : <span className="text-amber-600">Nothing yet</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500 whitespace-nowrap">
                      {formatISTShort(s.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() =>
                            setDraft({
                              id: s.id,
                              email: s.email,
                              name: s.name,
                              phone: s.phone ?? "",
                              role: s.role,
                              permissions: s.permissions as Permission[],
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:border-neutral-400 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => resetPassword(s)}
                          disabled={busy}
                          title="Generate a new temporary password"
                          className="p-1.5 rounded-lg border border-neutral-200 text-neutral-500 hover:border-neutral-400 transition-colors"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        {!isMe && (
                          <>
                            <button
                              onClick={() => toggleActive(s)}
                              disabled={busy}
                              title={s.is_active ? "Switch off access" : "Switch access back on"}
                              className={`p-1.5 rounded-lg border transition-colors ${
                                s.is_active
                                  ? "border-neutral-200 text-neutral-500 hover:border-neutral-400"
                                  : "border-green-200 text-green-600 hover:border-green-400"
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => remove(s)}
                              disabled={busy}
                              title="Remove permanently"
                              className="p-1.5 rounded-lg border border-neutral-200 text-red-500 hover:border-red-300 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
