import { MetadataRoute } from "next";

/**
 * AI assistant crawlers, allowed explicitly and deliberately: this site sells
 * a book, and being quoted when someone asks ChatGPT or Perplexity for "a
 * good NLP book" is distribution, not theft. The wildcard rule already lets
 * them in — the named entries make the intent survive any future "block the
 * bots" edit.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Google-Extended",
  "Amazonbot",
  "Bytespider",
  "cohere-ai",
  "meta-externalagent",
];

export default function robots(): MetadataRoute.Robots {
  // Nothing useful for a crawler behind these; /admin also leaks nothing but
  // a login form, and keeping it out of the index avoids "bishertalks admin"
  // ever ranking.
  const disallow = [
    "/api/", "/admin/",
    "/neuro-code/track", "/neuro-code/thank-you", "/neuro-code/address",
    // Share links — thousands of URLs that all redirect to one page.
    "/refer/",
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: "https://bishertalks.com/sitemap.xml",
    host: "https://bishertalks.com",
  };
}
