import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DbCourse, DbModule, DbLesson } from "@/lib/types/db";
import { revalidateCourses } from "@/lib/db/cache-tags";

// ── Read (full tree with real ids, for the admin editor) ─────────────────────

export interface AdminLesson {
  id: string;
  slug: string;
  title: string;
  type: "video" | "pdf";
  url: string;
  duration: string | null;
  sort_order: number;
}
export interface AdminModule {
  id: string;
  title: string;
  sort_order: number;
  lessons: AdminLesson[];
}
export interface AdminCourse extends DbCourse {
  modules: AdminModule[];
}

export async function getCourseForAdmin(slug: string): Promise<AdminCourse | null> {
  const { data: course } = await supabaseAdmin
    .from("courses")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!course) return null;

  const { data: modules } = await supabaseAdmin
    .from("modules")
    .select("id,title,sort_order")
    .eq("course_id", course.id)
    .order("sort_order", { ascending: true });

  const moduleIds = (modules ?? []).map((m) => m.id);
  const { data: lessons } = await supabaseAdmin
    .from("lessons")
    .select("id,module_id,slug,title,type,url,duration,sort_order")
    .in("module_id", moduleIds.length ? moduleIds : ["00000000-0000-0000-0000-000000000000"])
    .order("sort_order", { ascending: true });

  return {
    ...(course as DbCourse),
    modules: (modules ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      sort_order: m.sort_order,
      lessons: (lessons ?? [])
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          id: l.id,
          slug: l.slug,
          title: l.title,
          type: l.type as "video" | "pdf",
          url: l.url,
          duration: l.duration,
          sort_order: l.sort_order,
        })),
    })),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function nextSortOrder(table: string, column: string, parentId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from(table)
    .select("sort_order")
    .eq(column, parentId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.sort_order ?? -1) + 1;
}

async function reorder(table: string, orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) =>
      supabaseAdmin.from(table).update({ sort_order: i }).eq("id", id)
    )
  );
  revalidateCourses();
}

// ── Courses ──────────────────────────────────────────────────────────────────

export interface CourseFields {
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  thumbnail: string | null;
  price: number | null;
  offer_price: number | null;
  is_locked: boolean;
}

export async function createCourse(fields: CourseFields): Promise<DbCourse> {
  // Append to the end of the ordered list.
  const { count } = await supabaseAdmin
    .from("courses")
    .select("id", { count: "exact", head: true });
  const { data, error } = await supabaseAdmin
    .from("courses")
    .insert({ ...fields, sort_order: count ?? 0 })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidateCourses();
  return data as DbCourse;
}

export async function updateCourse(id: string, fields: Partial<CourseFields>): Promise<void> {
  const { error } = await supabaseAdmin.from("courses").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
  revalidateCourses();
}

export async function deleteCourse(id: string): Promise<void> {
  // modules/lessons/course_access cascade via FK ON DELETE CASCADE.
  const { error } = await supabaseAdmin.from("courses").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateCourses();
}

// ── Modules ──────────────────────────────────────────────────────────────────

export async function createModule(courseId: string, title: string): Promise<DbModule> {
  const sort_order = await nextSortOrder("modules", "course_id", courseId);
  const { data, error } = await supabaseAdmin
    .from("modules")
    .insert({ course_id: courseId, title, sort_order })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidateCourses();
  return data as DbModule;
}

export async function updateModule(id: string, title: string): Promise<void> {
  const { error } = await supabaseAdmin.from("modules").update({ title }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidateCourses();
}

export async function deleteModule(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("modules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateCourses();
}

export async function reorderModules(orderedIds: string[]): Promise<void> {
  await reorder("modules", orderedIds);
}

// ── Lessons ──────────────────────────────────────────────────────────────────

export interface LessonFields {
  slug: string;
  title: string;
  type: "video" | "pdf";
  url: string;
  duration: string | null;
}

export async function createLesson(moduleId: string, fields: LessonFields): Promise<DbLesson> {
  const sort_order = await nextSortOrder("lessons", "module_id", moduleId);
  const { data, error } = await supabaseAdmin
    .from("lessons")
    .insert({ module_id: moduleId, ...fields, sort_order })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidateCourses();
  return data as DbLesson;
}

export async function updateLesson(id: string, fields: Partial<LessonFields>): Promise<void> {
  const { error } = await supabaseAdmin.from("lessons").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
  revalidateCourses();
}

export async function deleteLesson(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("lessons").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateCourses();
}

export async function reorderLessons(orderedIds: string[]): Promise<void> {
  await reorder("lessons", orderedIds);
}
