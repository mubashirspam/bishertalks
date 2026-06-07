import { supabaseAdmin } from "@/lib/supabase/admin";
import type { User } from "@/lib/types/db";

/**
 * Normalise a phone number to a bare 10-digit Indian mobile number.
 * Strips spaces, +91 / 91 prefixes, and any non-digits.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  // Drop a leading country code 91 if the result would still be 10 digits.
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

export async function getUserByPhone(rawPhone: string): Promise<User | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  const { data } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  return (data as User) ?? null;
}

/**
 * Create or update a user keyed by phone. Only the fields provided are written,
 * so an existing user's data is never overwritten with blanks.
 */
export async function upsertUserByPhone(input: {
  phone: string;
  name?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  notes?: string | null;
}): Promise<User> {
  const phone = normalizePhone(input.phone);

  const payload: Record<string, unknown> = { phone };
  if (input.name != null && input.name !== "") payload.name = input.name;
  if (input.email != null && input.email !== "") payload.email = input.email;
  if (input.city != null && input.city !== "") payload.city = input.city;
  if (input.state != null && input.state !== "") payload.state = input.state;
  if (input.notes != null) payload.notes = input.notes;

  const { data, error } = await supabaseAdmin
    .from("users")
    .upsert(payload, { onConflict: "phone" })
    .select()
    .single();

  if (error) throw new Error(`upsertUserByPhone failed: ${error.message}`);
  return data as User;
}
