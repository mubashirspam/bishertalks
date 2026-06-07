"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";

export default function AddUserForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [grantNlp, setGrantNlp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, email, grantNlp }),
      });
      const data = await res.json();
      if (data.success) {
        setPhone("");
        setName("");
        setEmail("");
        setOpen(false);
        router.refresh();
      } else {
        setError(data.error || "Failed to add user.");
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-400 text-white text-sm font-semibold transition-all"
      >
        <UserPlus className="w-4 h-4" /> Add User
      </button>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 w-full shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm text-neutral-900">Add User</h3>
        <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-900">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex">
          <span className="bg-neutral-100 border border-r-0 border-neutral-300 rounded-l-xl px-3 flex items-center text-neutral-500 text-sm select-none">
            +91
          </span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="Mobile number *"
            inputMode="numeric"
            maxLength={10}
            className="flex-1 bg-white border border-neutral-300 rounded-r-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500"
          />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (optional)"
          type="email"
          className="w-full bg-white border border-neutral-300 rounded-xl px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
          <input
            type="checkbox"
            checked={grantNlp}
            onChange={(e) => setGrantNlp(e.target.checked)}
            className="accent-primary-500 w-4 h-4"
          />
          Also approve NLP course access
        </label>
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white font-bold text-sm transition-all"
        >
          {loading ? "Saving…" : "Save User"}
        </button>
      </form>
    </div>
  );
}
