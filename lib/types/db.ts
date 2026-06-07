// Database row types for the new production tables (Supabase).

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type GrantedVia = "purchase" | "admin";
export type AccessStatus = "active" | "revoked";

export interface CourseAccess {
  id: string;
  user_id: string;
  course_id: string;
  granted_via: GrantedVia;
  status: AccessStatus;
  order_id: string | null;
  granted_at: string;
  created_at: string;
  updated_at: string;
}

export interface DbCourse {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  thumbnail: string | null;
  is_locked: boolean;
  sort_order: number;
  // Whole-rupee pricing, admin-managed. NULL price falls back to the env default.
  price: number | null;
  offer_price: number | null;
}

export type PromoDiscountType = "percent" | "flat";

export interface PromoCode {
  id: string;
  code: string;
  discount_type: PromoDiscountType;
  discount_value: number;
  is_active: boolean;
  expires_at: string | null;
  usage_limit: number | null;
  used_count: number;
  created_at: string;
  updated_at: string;
}

export interface DbModule {
  id: string;
  course_id: string;
  title: string;
  sort_order: number;
}

export interface DbLesson {
  id: string;
  module_id: string;
  slug: string;
  title: string;
  type: "video" | "pdf";
  url: string;
  duration: string | null;
  sort_order: number;
}

// The NLP course slug that a paid book purchase unlocks.
export const BOOK_BONUS_COURSE_SLUG = "nlp";
