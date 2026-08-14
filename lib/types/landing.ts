/**
 * Landing CMS shapes and labels, with no database code attached.
 *
 * Split out of lib/db/landing.ts because the admin editor is a client
 * component and needs KIND_LABELS and TESTIMONIAL_KINDS as real values. While
 * those lived alongside the queries, importing them dragged the server-only
 * half — the service-role Supabase client and next/cache — into the browser
 * bundle, which fails the build. Types and constants here; queries stay there.
 */

export type TestimonialKind = "video" | "image" | "audio" | "text";

export const TESTIMONIAL_KINDS: TestimonialKind[] = ["video", "image", "audio", "text"];

export const KIND_LABELS: Record<TestimonialKind, string> = {
  video: "Video",
  image: "Screenshot",
  audio: "Voice note",
  text: "Written",
};

export interface Testimonial {
  id: string;
  kind: TestimonialKind;
  name: string;
  role: string | null;
  quote: string | null;
  youtube_id: string | null;
  video_url: string | null;
  image_url: string | null;
  audio_url: string | null;
  avatar_url: string | null;
  duration: string | null;
  sent_at_label: string | null;
  rating: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface LandingSettings {
  explainer_youtube_id: string | null;
  explainer_video_url: string | null;
  explainer_length: string | null;
  show_placeholders: boolean;
}

export interface LandingContent {
  testimonials: Testimonial[];
  settings: LandingSettings;
}

export const DEFAULT_SETTINGS: LandingSettings = {
  explainer_youtube_id: null,
  explainer_video_url: null,
  explainer_length: null,
  show_placeholders: true,
};
