import crypto from "crypto";

// HMAC-signed cookie that remembers a verified phone number for course access.
// The phone is stored signed so it cannot be forged client-side. Access is still
// re-checked against the DB on every course load (so revoke is immediate).

export const ACCESS_COOKIE = "course_access_phone";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  return (
    process.env.INTERNAL_API_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dev-insecure-secret"
  );
}

function sign(value: string): string {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

/** Produce a signed cookie value for a (normalized) phone number. */
export function signAccessToken(phone: string): string {
  return `${phone}.${sign(phone)}`;
}

/** Verify a signed cookie value and return the phone, or null if tampered. */
export function verifyAccessToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const phone = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(phone);
  // Constant-time comparison.
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  return phone;
}
