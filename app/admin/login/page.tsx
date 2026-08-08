"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BookOpen } from "lucide-react";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    // Land on /admin and let the page guard forward them to the first screen
    // their permissions allow — a delivery agent ends up on the queue, not on
    // a redirect bounce from a page they can't open.
    router.push("/admin");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-primary-50 border border-primary-200 rounded-xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-6 h-6 text-primary-500" />
          </div>
          <h1 className="text-xl font-bold text-neutral-900">Admin Login</h1>
          <p className="text-neutral-500 text-sm mt-1">Neuro Code · Order Management</p>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-white border border-neutral-200 rounded-2xl p-6 space-y-4 shadow-sm"
        >
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider font-semibold block mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-300 rounded-xl px-4 py-3 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors text-sm"
              placeholder="Email"
              required
            />
          </div>
          <div>
            <label className="text-xs text-neutral-500 uppercase tracking-wider font-semibold block mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-300 rounded-xl px-4 py-3 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-primary-500 transition-colors text-sm"
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-full bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white font-bold text-sm transition-all"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
