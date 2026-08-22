"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

/**
 * The way out of the admin panel.
 *
 * Two shapes, because it has to live in three places that look nothing alike:
 *
 *   inline  a quiet link in the desktop header, beside the page title
 *   block   a full-width row, for the sidebar footer and the mobile menu
 *
 * The block form exists because the header it used to be the only home for is
 * `hidden lg:flex` for anyone with a sidebar — which meant an owner on a phone
 * had no way to sign out at all. The sidebar owns both places a phone user
 * actually looks, so it now carries one too.
 */
export default function LogoutButton({
  variant = "inline",
}: {
  variant?: "inline" | "block";
}) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    // The admin shell resolves the staff row on the server, so the push alone
    // would land on a cached tree that still believes somebody is signed in.
    router.refresh();
  };

  if (variant === "block") {
    return (
      <button
        onClick={handleLogout}
        className="mt-3 flex w-full items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-900"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      // An icon as well as the word. At 12px grey this was findable only by
      // somebody who already knew it was there.
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
    >
      <LogOut className="h-3.5 w-3.5" />
      Sign out
    </button>
  );
}
