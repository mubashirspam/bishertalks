import crypto from "crypto";

/**
 * ImageKit, without the SDK.
 *
 * Uploading needs exactly one thing from the server: a short-lived signature.
 * The browser then posts the file straight to ImageKit — the bytes never touch
 * this app, which matters because a serverless function has a request body
 * limit a phone video would blow straight through.
 *
 * Same reasoning as lib/make.ts and lib/email.ts: one endpoint, a few
 * lines of crypto, no dependency in the bundle.
 */

export const IMAGEKIT_UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

export function imagekitConfigured(): boolean {
  return !!(process.env.IMAGEKIT_PRIVATE_KEY && process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY);
}

export interface ImageKitAuth {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
}

/**
 * Credentials for one upload.
 *
 * The signature is HMAC-SHA1 of `token + expire` with the private key — that's
 * the scheme ImageKit specifies, SHA1 and all; it's a short-lived upload token,
 * not a password digest.
 *
 * Expiry is deliberately tight. It only has to survive picking a file and
 * starting the request, and a leaked token is useless a few minutes later.
 * ImageKit rejects anything more than an hour out.
 */
export function createUploadAuth(ttlSeconds = 600): ImageKitAuth | null {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY;
  if (!privateKey || !publicKey) return null;

  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = crypto
    .createHmac("sha1", privateKey)
    .update(token + expire)
    .digest("hex");

  return { token, expire, signature, publicKey };
}

/** Where uploads land, so the ImageKit media library stays navigable. */
export const IMAGEKIT_FOLDERS = {
  testimonialVideo: "/neuro-code/testimonials/video",
  testimonialImage: "/neuro-code/testimonials/image",
  testimonialAudio: "/neuro-code/testimonials/audio",
  avatar: "/neuro-code/testimonials/avatars",
  explainer: "/neuro-code/explainer",
  receipt: "/neuro-code/expenses/receipts",
} as const;

export type ImageKitFolder = (typeof IMAGEKIT_FOLDERS)[keyof typeof IMAGEKIT_FOLDERS];

/**
 * Upload limits, enforced in the browser before a byte is sent.
 *
 * Not security — anyone can post to ImageKit with a valid token — but a phone
 * video is easily 200MB, and finding that out after a five-minute upload on
 * mobile data is a genuinely bad experience.
 */
export const UPLOAD_LIMITS = {
  image: { maxMB: 10, accept: "image/*" },
  audio: { maxMB: 25, accept: "audio/*" },
  video: { maxMB: 200, accept: "video/*" },
  // A bill. Photographed off a phone far more often than exported as a PDF,
  // so both are accepted and the limit is sized for a camera image rather
  // than a scan.
  document: { maxMB: 10, accept: "image/*,application/pdf" },
} as const;

export type UploadKind = keyof typeof UPLOAD_LIMITS;
