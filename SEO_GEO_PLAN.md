# SEO + GEO Plan — bishertalks.com

Goal: sell **Neuro Code** and rank the free **NLP course** — in Google *and* in
AI answers (ChatGPT, Perplexity, Google AI Overviews). SEO gets you into the
index; GEO (Generative Engine Optimization) gets you **cited and recommended**
when someone asks an AI "best psychology books with exercises" or "is there a
free NLP course worth doing".

Ordered by impact. Phase 1 is fixes to what exists — everything there is a bug,
not an improvement. Nothing here needs a new framework or dependency.

---

## Phase 1 — Foundation bugs (do first, ~1 day)

Things that are silently broken today:

- [ ] **`/neuro-code` is missing from `app/sitemap.ts`.** The page the whole
      business runs on is not in the sitemap. Add it with `priority: 1.0`.
- [ ] **Remove fragment URLs from the sitemap** (`/#about`, `/#services`,
      `/#values`, `/#contact`). Google ignores `#fragments`; they're noise that
      dilutes the file. A sitemap should be: `/`, `/neuro-code`, `/courses`,
      each course slug, `/privacy-policy`, `/terms`.
- [ ] **`public/og-image.jpg` does not exist** — but layout metadata points at
      it. Every WhatsApp/Instagram/X share of the site currently renders with
      no image. For a book sold largely through social sharing this is the
      single highest-leverage asset. Create 1200×630: book cover + "Free NLP
      course included". Same for the referenced-but-missing `logo.png`,
      `icon.svg`, `apple-touch-icon.png`, `images/bisher-kc.jpg`.
- [ ] **`verification.google` is the literal string
      `"your-google-verification-code"`.** Set the real Search Console token
      (or remove it and verify via DNS).
- [ ] **Home `<h1>` is "Bisher kc"** — lowercase kc, and the h1 of the
      homepage. Fix casing; better: "Bisher KC — Life Coach & Author of
      Neuro Code" (entity + product in the one heading Google weighs most).
- [ ] **Register on Bing Webmaster Tools.** Not optional in a GEO world:
      ChatGPT search is Bing-fed. Most sites skip this; it's free coverage.
- [ ] **Set up Google Search Console + submit sitemap** (if not already done —
      the placeholder token suggests not).

---

## Phase 2 — Page-level SEO: titles, headings, per-page metadata (~1 day)

Headings today are visual fragments ("What Is", "Six Codes That…", "What
Readers"). They read fine on screen but carry no query terms. The pattern for
every rewrite: **keep the hook, add the entity** — headings can stay stylish
and still contain words people search.

### `/neuro-code` (the money page)

| Now | Proposed |
|---|---|
| h1 "Rewrite Your Programming" | "Neuro Code — Rewrite Your Mental Programming" |
| "What Is [Neuro Code]" | "What Is the Neuro Code Book About?" *(matches the literal question people ask AI)* |
| "Six Codes That [Shape You]" | "The Six Neuro Codes That Shape Your Thoughts and Habits" |
| "Get This Course [Free]" | "Free NLP Mastery Course with Every Copy — ₹2,499 Value" |
| "Meet [Bisher KC]" | "About the Author — Bisher KC" |
| "What Readers [Say]" | "Neuro Code Reviews — What Readers Say" |
| "Start Your [Transformation]" | keep — CTA sections don't need keywords |

- [ ] Apply heading rewrites above.
- [ ] Add `openGraph` + `twitter` blocks to `/neuro-code`'s metadata with a
      **book-specific** OG image (cover shot), not the site-wide one.
- [ ] Title now: "Neuro Code — The Book by Bisher KC | Free NLP Course
      Included" — good, keep. Add to description: "psychology", "workbook
      exercises", price. Descriptions are ad copy for the SERP; the ₹ number
      raises CTR.

### `/courses` and `/courses/[slug]`

- [ ] Each course page h1 = course title verbatim (verify — gated content is
      fine, but the *landing* portion of a locked course must be public and
      crawlable: title, description, module list, instructor).
- [ ] **Module names are the keyword inventory.** "NLP anchoring", "reframing",
      "submodalities", "belief change" are all searched as standalone terms.
      The public course page should list every module by its real name in an
      `<h3>`/`<li>` structure, not summarize ("14 modules on NLP techniques"
      ranks for nothing; the list of 14 names ranks for 14 things).

### Homepage

- [ ] Section headings same treatment: "Corporate Training Programs in India",
      "Life Coaching with Bisher KC", etc.
- [ ] One page = one h1, everywhere (Hero.tsx currently renders two h1s —
      mobile + desktop variants both in the DOM; make one a `<p>` styled
      identically or use one responsive element).

---

## Phase 3 — Structured data that sells the book (~1 day)

The current JSON-LD graph in `app/layout.tsx` has the right bones (Person,
WebSite, Book, Course) but the Book is a stub. Rich results (price, stars,
"In stock") are what make a Google listing look like a store instead of a blog.

- [ ] **Upgrade Book → full `Book` + `Product` with live `Offer`:**
      ISBN (if it has one), `image` (cover URL), `numberOfPages`, `bookFormat`,
      and an `offers` block with the **actual live price** from
      `getProductPricing()` — move this schema out of the static root layout
      onto `/neuro-code/page.tsx`, which already fetches pricing. Static
      schema with a dynamic price will drift and Google flags mismatches.
- [ ] **`AggregateRating` + `Review`** — only once real reviews exist on the
      page (fabricated ratings risk a manual action). The testimonials
      section is the source; mark the real ones up.
- [ ] **`FAQPage` schema + a visible FAQ section on `/neuro-code`.** This is
      the highest-value GEO block on the whole site (see Phase 4). Questions
      to answer — phrased exactly as people ask them:
      - What is the Neuro Code book about?
      - Who is Bisher KC?
      - Is the NLP course really free with the book?
      - How many pages / what language is Neuro Code?
      - How long does delivery take in India?
      - Is Neuro Code good for beginners to psychology/NLP?
- [ ] **Fix stale Course numbers** in layout JSON-LD ("13+ modules, 40+
      lessons, 18 worksheets" vs the real 14/42/17 used on the landing page).
      Contradictory numbers across a site is exactly what makes an AI hedge
      instead of stating facts. One source of truth — generate the schema
      from the same DB the page renders from.
- [ ] `Course` schema per course page with `syllabusSections` built from the
      module rows — free, and it's generated from data you already have.
- [ ] `BreadcrumbList` on course pages.

---

## Phase 4 — GEO: getting cited by AI engines (~1 day + ongoing)

AI assistants are becoming the first stop for "what book should I read to fix
my mindset". GEO is about being the source they quote. The levers:

- [ ] **Allow AI crawlers explicitly in `app/robots.ts`.** Add allow rules for
      `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `ClaudeBot`,
      `Claude-User`, `Google-Extended`, `Bytespider`, `Amazonbot`, `cohere-ai`.
      Default `*` already allows them, but explicit entries survive a future
      "block bots" edit and signal intent. (Deliberate choice: you *want* to be
      in training data and answer indexes — you're selling, not protecting
      content.)
- [ ] **Add `public/llms.txt`** — the emerging convention (llmstxt.org): a
      markdown file at the root that tells LLM agents what the site is, in
      plain language. ~30 lines: who Bisher KC is, what Neuro Code is, price,
      the free-course offer, links to the key pages. Cheap, zero risk, and the
      agents that respect it get a clean canonical summary instead of parsing
      your React.
- [ ] **Quotable fact blocks.** AI engines lift self-contained sentences.
      Every important page needs 2–3 sentences that survive being copied out
      of context: "Neuro Code is a self-help psychology book by Indian life
      coach Bisher KC. Every copy includes free access to his 14-module NLP
      Mastery video course (₹2,499 value). Ships across India; ₹X99." Put one
      near the top of `/neuro-code` as real visible copy, not hidden text.
- [ ] **Entity consistency sweep.** Same name, same claims, same numbers on:
      site, Instagram bio, YouTube about, LinkedIn, Amazon/Flipkart listing if
      any. AI engines cross-check sources before asserting facts; mismatches
      get you dropped from the answer.
- [ ] **FAQ section (Phase 3) is the GEO workhorse** — conversational Q&A is
      the format engines quote most. Write answers as complete standalone
      paragraphs (2–4 sentences), never "see above".
- [ ] **IndexNow** — ping Bing instantly on content changes (one small API
      route or just the key file). Bing freshness = ChatGPT-search freshness.

---

## Phase 5 — Content engine: the compounding part (ongoing, 2–4 posts/month)

Everything above optimizes ~5 pages. Ranking for the psychology/NLP *category*
("books to rewire your brain", "how to break limiting beliefs", "NLP anchoring
technique explained") needs pages that answer those queries. This is where the
course content is an unfair advantage: **the material already exists — each
module is a blog post.**

- [ ] Add `/learn` (or `/blog`) — MDX or DB-backed, `Article` schema, author
      → the existing `#person` entity (Google connects author authority
      across pages).
- [ ] **Cluster 1 — book-buyer intent** (links to `/neuro-code`):
      best psychology books with exercises · self-help books that actually
      work India · books to reprogram your subconscious mind · Neuro Code
      review/summary (own your own SERP before someone else does).
- [ ] **Cluster 2 — NLP learner intent** (links to `/courses/nlp`):
      one article per big module — what is NLP anchoring · reframing with
      examples · submodalities explained · limiting beliefs: how to find and
      break them. Each ends with "this is module N of the free course".
- [ ] **Cluster 3 — workbook/exercise intent**: the 17 worksheets are
      downloadable-lead-magnet material. One page per worksheet theme with a
      preview; the download CTA is the course signup.
- [ ] Every article: one h1 matching the query, FAQ block at the end, internal
      link to book + course, quotable summary paragraph up top (GEO).
- [ ] YouTube: Bisher KC already has a channel — each article gets a short
      video and vice versa; `VideoObject` schema on pages that embed. Video
      results are a second SERP you can occupy with the same content.

---

## Phase 6 — Geographic SEO (India/Kerala) (~half a day)

The other "geo". Buyers are Indian; competition for "life coach Kerala" is
thin.

- [ ] **Google Business Profile** for Bisher KC / Skillage (category: life
      coach / training centre). Reviews there feed both Maps and AI answers.
- [ ] `areaServed` is already in the Service schema — good. Add
      `addressLocality` (city) to the Person schema.
- [ ] Landing copy already says "Ships across India" — make sure delivery
      promise + COD/prepaid + timescale is stated as crawlable text (it's
      also an FAQ answer).
- [ ] Skip hreflang — site is en-only; `en_IN` locale in OG is already right.

---

## Technical notes (fold into whichever phase touches the file)

- `force-dynamic` on `/neuro-code` is fine for SEO (it's still SSR), but the
  price is the only dynamic thing. Consider ISR (`revalidate: 300`) — faster
  TTFB helps Core Web Vitals, and price changes are rare.
- All images through `next/image` with real `alt` text ("Neuro Code book
  cover — Bisher KC", not "hero1").
- Keywords meta tag: Google ignores it; harmless, but stop investing in it —
  the 50-item list in layout.tsx buys nothing. Headings and body copy are
  where those phrases need to live.
- Measure: GSC + Bing Webmaster + GA4. For GEO, monthly manual check: ask
  ChatGPT/Perplexity/Gemini "best NLP books India", "free NLP course online",
  "Neuro Code book review" — track when you start appearing. That's the KPI.

---

## Order of operations

| When | What | Why first |
|---|---|---|
| Week 1 | Phase 1 + Phase 2 | Broken foundations cap everything else |
| Week 2 | Phase 3 + Phase 4 | Rich results + AI citability on existing pages |
| Week 3 | Phase 6 + first 2 articles | Local moat is cheap; content flywheel starts |
| Monthly | Phase 5 cadence | Compounding traffic; everything else is a one-off |
