import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getCourseForAdmin } from "@/lib/db/courses-admin";
import CourseFieldsForm from "./CourseFieldsForm";
import ModulesEditor from "./ModulesEditor";

export const dynamic = "force-dynamic";

export default async function AdminCourseEditorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = await getCourseForAdmin(slug);
  if (!course) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/admin/courses"
          className="inline-flex items-center gap-2 text-neutral-500 hover:text-neutral-900 text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> All Courses
        </Link>
        <Link
          href={`/courses/${course.slug}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 text-sm transition-colors"
        >
          View live <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-black text-neutral-900">{course.title}</h1>
        <p className="font-mono text-neutral-400 text-sm">{course.slug}</p>
      </div>

      <CourseFieldsForm course={course} />

      <ModulesEditor courseId={course.id} modules={course.modules} />
    </div>
  );
}
