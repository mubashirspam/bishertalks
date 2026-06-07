"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tag, X } from "lucide-react";

export default function AddPromoForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "flat">("percent");
  const [value, setValue] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          discount_type: type,
          discount_value: value,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          usage_limit: usageLimit,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCode("");
        setValue("");
        setExpiresAt("");
        setUsageLimit("");
        setOpen(false);
        router.refresh();
      } else {
        setError(data.error || "Failed to create code.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-all"
      >
        <Tag className="w-4 h-4" /> New Promo Code
      </button>
    );
  }

  const inputCls =
    "w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors";

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 w-full max-w-md shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-neutral-900">New Promo Code</h3>
        <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-900">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))}
          placeholder="CODE e.g. SAVE20 *"
          className={`${inputCls} font-mono tracking-wider`}
        />
        <div className="grid grid-cols-2 gap-3">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "percent" | "flat")}
            className={`${inputCls} cursor-pointer`}
          >
            <option value="percent">% off</option>
            <option value="flat">₹ off (flat)</option>
          </select>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder={type === "percent" ? "20" : "100"}
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Expires (optional)</label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Usage limit (optional)</label>
            <input
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Unlimited"
              className={inputCls}
            />
          </div>
        </div>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white font-bold text-sm transition-all"
        >
          {loading ? "Saving…" : "Create Code"}
        </button>
      </form>
    </div>
  );
}
