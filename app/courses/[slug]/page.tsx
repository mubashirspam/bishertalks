import { notFound } from 'next/navigation';
import { courses, getCourse } from '@/lib/courses-data';
import CourseContent from './CourseContent';

export async function generateStaticParams() {
  return courses.map((course) => ({
    slug: course.slug,
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = getCourse(slug);
  if (!course) return { title: 'Course Not Found' };

  return {
    title: `${course.title} | Free Course by Bisher KC`,
    description: course.description,
    openGraph: {
      title: `${course.title} | Free Course by Bisher KC`,
      description: course.description,
    },
  };
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = getCourse(slug);

  if (!course) {
    notFound();
  }

  return <CourseContent course={course} />;
}
