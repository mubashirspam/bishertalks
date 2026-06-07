"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      className="text-xs text-neutral-500 hover:text-neutral-900 transition-colors px-3 py-1.5 rounded-lg hover:bg-neutral-100"
    >
      Sign out
    </button>
  );
}
