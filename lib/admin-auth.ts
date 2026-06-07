import { createClient } from "@/lib/supabase/server";

/** True if the current request is an authenticated admin (Supabase session). */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return !!user && user.email === process.env.ADMIN_EMAIL;
}
