import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import {
  type Course,
  getTotalVideos,
  getTotalPdfs,
} from "@/lib/courses-data";
import CourseContent from "./CourseContent";
import CourseGate from "./CourseGate";
import { ACCESS_COOKIE, verifyAccessToken } from "@/lib/access-cookie";
import { hasCourseAccessByPhone } from "@/lib/db/access";
import { getCourseBundle } from "@/lib/db/courses";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = (await getCourseBundle(slug))?.course;
  if (!course) return { title: "Course Not Found" };

  const totalVideos = getTotalVideos(course);
  const totalPdfs = getTotalPdfs(course);

  const nlpKeywords = [
    `${course.title} course free`,
    `${course.title} by Bisher KC`,
    `learn ${course.title} online free`,
    `${course.title} video lessons`,
    `${course.title} training`,
    "NLP course free India",
    "neuro linguistic programming free course",
    "NLP online course free",
    "NLP training by Bisher KC",
    "NLP techniques training",
    "NLP filters",
    "NLP anchoring technique",
    "NLP modelling",
    "NLP sub modalities",
    "NLP reframing",
    "NLP belief system",
    "NLP representational system",
    "VAKOG NLP",
    "NLP mental map",
    "NLP conditioning",
    "NLP outcome setting",
    "NLP mindfulness",
    "NLP affirmation visualization",
    "NLP for personal development",
    "NLP for confidence",
    "NLP for success",
    "free NLP certification course",
    "NLP practitioner course free",
    "Bisher KC NLP trainer",
    "BisherTalks NLP",
    "life coaching NLP India",
    "mind programming NLP",
    "limiting beliefs NLP",
    "empowering beliefs NLP",
  ];

  return {
    title: `${course.title} — Free ${course.modules.length}-Module Course with ${totalVideos} Videos`,
    description: `${course.description} Free ${course.modules.length}-module course with ${totalVideos} video lessons and ${totalPdfs} downloadable worksheets by Bisher KC. Learn NLP techniques including filters, anchoring, modalities, reframing, belief systems, and more.`,
    keywords: nlpKeywords,
    alternates: {
      canonical: `https://bishertalks.com/courses/${course.slug}`,
    },
    openGraph: {
      title: `${course.title} — Free Course by Bisher KC | BisherTalks`,
      description: `Master ${course.title} with ${totalVideos} video lessons and ${totalPdfs} worksheets. Free ${course.modules.length}-module structured course by Bisher KC.`,
      url: `https://bishertalks.com/courses/${course.slug}`,
      type: "website",
      siteName: "BisherTalks",
      images: [
        {
          url: "/og-image.jpg",
          width: 1200,
          height: 630,
          alt: `${course.title} Free Course by Bisher KC`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${course.title} — Free Course | BisherTalks`,
      description: `Learn ${course.title} free: ${totalVideos} videos, ${totalPdfs} PDFs, ${course.modules.length} modules. By Bisher KC.`,
      images: ["/og-image.jpg"],
    },
  };
}

function getCourseJsonLd(course: Course | null) {
  if (!course) return null;

  const totalVideos = getTotalVideos(course);
  const totalPdfs = getTotalPdfs(course);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Course",
        "@id": `https://bishertalks.com/courses/${course.slug}#course`,
        name: course.title,
        description: course.description,
        url: `https://bishertalks.com/courses/${course.slug}`,
        provider: {
          "@type": "Person",
          "@id": "https://bishertalks.com/#person",
          name: "Bisher KC",
          url: "https://bishertalks.com",
        },
        instructor: {
          "@type": "Person",
          name: "Bisher KC",
          url: "https://bishertalks.com",
          jobTitle: "Life Coach & NLP Trainer",
        },
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "INR",
          availability: "https://schema.org/InStock",
          category: "Free",
        },
        inLanguage: "en",
        courseMode: "online",
        educationalLevel: "Beginner to Advanced",
        numberOfCredits: course.modules.length,
        hasCourseInstance: {
          "@type": "CourseInstance",
          courseMode: "online",
          courseWorkload: `${totalVideos} video lessons, ${totalPdfs} worksheets`,
        },
        syllabusSections: course.modules.map((module) => ({
          "@type": "Syllabus",
          name: module.title,
          description: `Module ${module.id}: ${module.title} — ${module.lessons.filter((l) => l.type === "video").length} videos, ${module.lessons.filter((l) => l.type === "pdf").length} PDFs`,
        })),
        about: [
          { "@type": "Thing", name: "Neuro Linguistic Programming" },
          { "@type": "Thing", name: "NLP Techniques" },
          { "@type": "Thing", name: "Personal Development" },
          { "@type": "Thing", name: "Mindset Coaching" },
          { "@type": "Thing", name: "Belief Systems" },
          { "@type": "Thing", name: "NLP Anchoring" },
          { "@type": "Thing", name: "NLP Modalities" },
          { "@type": "Thing", name: "NLP Reframing" },
        ],
        // No aggregateRating here deliberately: Google requires the ratings
        // to be real and visible on the page. A made-up number is how a site
        // loses rich results for everything. Add it back when the page shows
        // genuine collected reviews.
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://bishertalks.com",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Courses",
            item: "https://bishertalks.com/courses",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: course.title,
            item: `https://bishertalks.com/courses/${course.slug}`,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Is this NLP course free?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes, this NLP course by Bisher KC is completely free. It includes video lessons on YouTube and downloadable PDF worksheets.",
            },
          },
          {
            "@type": "Question",
            name: "How many modules are in this NLP course?",
            acceptedAnswer: {
              "@type": "Answer",
              text: `This course has ${course.modules.length} modules covering NLP fundamentals to advanced techniques like anchoring, reframing, modelling, and more.`,
            },
          },
          {
            "@type": "Question",
            name: "Who teaches this NLP course?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "This NLP course is taught by Bisher KC, a renowned Life Coach, Author of Neuro Code, and Corporate Trainer with 15+ years of experience.",
            },
          },
          {
            "@type": "Question",
            name: "What will I learn in this NLP course?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "You will learn NLP filters, representational systems, VAKOG, mental maps, modalities, sub-modalities, conditioning, anchoring, outcome setting, belief systems, reframing, programming, mindfulness, visualization, affirmation, and modelling.",
            },
          },
        ],
      },
    ],
  };
}

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // ── Access check (no user login): signed cookie holds a verified phone,
  // re-checked against the DB every load so admin revoke is immediate. ──
  const cookieStore = await cookies();
  const phone = verifyAccessToken(cookieStore.get(ACCESS_COOKIE)?.value);

  // Course content + presentation come entirely from the DB. Fetched in
  // parallel with the access check — they don't depend on each other.
  const [bundle, hasAccess] = await Promise.all([
    getCourseBundle(slug),
    phone ? hasCourseAccessByPhone(phone, slug) : Promise.resolve(false),
  ]);

  const course = bundle?.course;
  const meta = bundle?.meta;

  if (!course) {
    notFound();
  }

  const jsonLd = getCourseJsonLd(course);

  if (!hasAccess) {
    const outline = course.modules.map((m) => ({
      title: m.title,
      videos: m.lessons.filter((l) => l.type === "video").length,
      pdfs: m.lessons.filter((l) => l.type === "pdf").length,
    }));
    return (
      <>
        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />
        )}
        <CourseGate
          slug={course.slug}
          title={meta?.title ?? course.title}
          subtitle={meta?.subtitle ?? course.subtitle}
          description={meta?.description ?? course.description}
          outline={outline}
          totalVideos={getTotalVideos(course)}
          totalPdfs={getTotalPdfs(course)}
          price={meta?.price ?? null}
          offerPrice={meta?.offer_price ?? null}
        />
      </>
    );
  }

  // Approved — serve content from the DB.
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <CourseContent course={course} />
    </>
  );
}
