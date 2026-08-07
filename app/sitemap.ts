import { MetadataRoute } from "next";
import { courses } from "@/lib/courses-data";

/**
 * Real, crawlable URLs only. Fragment URLs (/#about etc.) used to be listed
 * here — search engines ignore fragments, so they were pure noise.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://bishertalks.com";
  const currentDate = new Date().toISOString();

  return [
    {
      url: baseUrl,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    // The product page the whole business runs on.
    {
      url: `${baseUrl}/neuro-code`,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/courses`,
      lastModified: currentDate,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...courses.map((course) => ({
      url: `${baseUrl}/courses/${course.slug}`,
      lastModified: currentDate,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    {
      url: `${baseUrl}/privacy-policy`,
      lastModified: currentDate,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: currentDate,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
