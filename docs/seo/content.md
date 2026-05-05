---
name: Brutus SEO — Content & Structured Data Reference
description: Expert reference for content quality (HCU, E-E-A-T), structured data, rich results, AI Overviews, and the exact rules for the planned 200+ programmatic landing pages
type: reference
originSessionId: 850bd198-1a06-48dc-aeeb-44b9b2e9ee6e
---
# Google Search — Content & Search Appearance Expert Brief

> **Sourcing note:** Synthesized from Google Search Central documentation as of January 2026. Reflects March 2024 core/spam updates, May 2024 site-reputation-abuse policy, Dec 2022 E-E-A-T addition, Aug 2023 FAQ/HowTo deprecations, AI Overviews guidance. Doc page slugs cited so any line can be re-verified at `developers.google.com/search/docs/{slug}`.

---

## 1. Helpful Content System

**Slug:** `fundamentals/creating-helpful-content`

In the **March 2024 core update**, the standalone "Helpful Content System" was folded into Google's core ranking system. It is no longer a separate classifier; "helpfulness" is now a continuous core signal. The self-assessment questions remain published.

**Operative principle:** "people-first content" — written for humans first, with SEO as secondary polish. Not "search-engine-first content."

**Google's published self-assessment questions (categorized):**

*Content and quality questions*
- Does the content provide original information, reporting, research, or analysis?
- Does it provide a substantial, complete, or comprehensive description of the topic?
- Does it provide insightful analysis or interesting information beyond the obvious?
- If drawing on other sources, does it avoid simply copying or rewriting them, and instead provide substantial additional value and originality?
- Does the headline / page title provide a descriptive, helpful summary of the content?
- Does it avoid being exaggerating or shocking in nature?
- Is this the sort of page you'd want to bookmark, share, or recommend?
- Would you expect to see this content in or referenced by a printed magazine, encyclopedia, or book?
- Does the content provide substantial value when compared to other pages in search results?
- Does the content have any spelling or stylistic issues?
- Is the content well-produced, or does it appear sloppy or hastily produced?
- Is the content mass-produced by or outsourced to a large number of creators, or spread across a large network of sites, so that individual pages or sites don't get as much attention or care?

*Expertise questions*
- Does the content present information in a way that makes you want to trust it (clear sourcing, evidence of expertise, background of the author/site)?
- If researched, does it cite primary sources?
- Is the author/site recognized as an authority on the topic?
- Is the content free from easily-verified factual errors?
- Would you trust this content for issues relating to your money or your life?

*Presentation and production*
- Free from intrusive ads that interfere with the main content?
- Displays well on mobile?

*People-first content questions*
- Do you have an existing or intended audience for your business that would find the content useful if they came directly to you?
- Does your content clearly demonstrate first-hand expertise and depth of knowledge (e.g., expertise from actually using a product or visiting a place)?
- Does your site have a primary purpose or focus?
- After reading, will someone leave feeling they've learned enough about a topic to help achieve their goal?
- Will someone reading your content leave feeling like they've had a satisfying experience?

*"Avoid" questions (search-engine-first signals)*
- Is content primarily made to attract visits from search engines?
- Are you producing lots of content on different topics in hopes that some will rank?
- Are you using extensive automation to produce content on many topics?
- Are you mainly summarizing what others have to say without much value?
- Are you writing about things simply because they seem trending, not because you'd write about them otherwise?
- Does your content leave readers feeling they need to search again for better info from other sources?
- Are you writing to a particular word count because you've heard Google has a preferred word count? (Google: **no preferred word count**)
- Did you decide to enter a niche topic without real expertise, mainly because you thought you'd get search traffic?
- Does your content promise to answer a question that has no actual answer (e.g., "release date for a product not yet announced")?

**For brutusai.coach:** Every page should answer "would a sales rep bookmark this?" Avoid "10 ways to handle objections" filler. Demonstrate first-hand product use, real call examples, named author with sales background.

---

## 2. E-E-A-T

**Slug:** `fundamentals/creating-helpful-content` (E-E-A-T section) and the **Search Quality Rater Guidelines** PDF.

E-E-A-T = **Experience, Expertise, Authoritativeness, Trust**. Trust is the **most important** member; the other three support it. (Added "Experience" in Dec 2022 — the second E.)

**Important:** E-E-A-T is **not a direct ranking factor**. Google has explicitly stated it does not have an "E-E-A-T score." It's a conceptual framework that maps to many underlying signals.

**How each is signaled:**

- **Experience:** First-hand or life experience with the topic. Signals: phrases like "I tested," "we built," original photos/screenshots, dated personal accounts, before/after data. Critical for product reviews.
- **Expertise:** Skill/knowledge in the topic area. Signals: credentials, author bios, depth of analysis, correct terminology, citations of primary sources.
- **Authoritativeness:** Recognized go-to source. Signals: external citations, mentions on authoritative sites, Wikipedia presence (not gameable), industry recognition.
- **Trust:** Site is accurate, honest, safe, reliable. Signals: HTTPS, contact info, clear ownership, About page, secure checkout, transparent business practices, refund/return policies, no deceptive UX.

**YMYL ("Your Money or Your Life"):** Topics that can impact health, finances, safety, or major life decisions get **stricter E-E-A-T scrutiny** by raters. SaaS billing/pricing pages have YMYL-adjacent characteristics (financial transactions). Sales coaching content itself isn't strict YMYL, but pricing/refund/auth pages are.

**For brutusai.coach:**
- About page must name the founder with credentials and a real photo.
- Author bylines on every blog/landing page (`Person` schema with `sameAs` → LinkedIn, X, GitHub).
- Footer links to privacy policy, terms, refund policy.
- "Built by sales operators" type copy — demonstrate first-hand sales experience.
- Add testimonials with named users (not anonymous "Sarah K.").

---

## 3. Quality Rater Guidelines (operative summary)

**Source:** Public PDF, ~170 pages (`static.googleusercontent.com/media/guidelines.raterhub.com/en//searchqualityevaluatorguidelines.pdf`). Used by ~16,000 contractors who rate result quality. Their ratings train Google's systems but **do not directly affect individual page rankings**.

**Page Quality (PQ) ratings:** Lowest, Low, Medium, High, Highest.

**Lowest PQ triggers:**
- Harmful content
- Deceptive purpose / misleading
- Hateful or violently extremist
- Lacks E-E-A-T to a severe degree on YMYL topics
- Created with no effort, no originality, no skill
- Auto-generated content with no editorial value
- Hacked, defaced, spammed pages

**Highest PQ requires:**
- Very high level of E-E-A-T
- Very satisfying main content (high-effort, high-skill, original)
- Positive reputation (external, verifiable)
- Clear info about the website and content creator

**Needs Met (NM) ratings:** Fully Meets, Highly Meets, Moderately Meets, Slightly Meets, Fails to Meet — based on whether the page satisfies the user's likely query intent.

**Operative rules for SaaS marketing pages:**
- Every page should have visible **Main Content** that's high-effort.
- **Supplementary content** (sidebars, related links) should help users, not overwhelm.
- **Ads** should not dominate or push main content below the fold.
- The site needs **clear info about who's behind it** — About page, contact, ownership.
- **External reputation** matters: G2 reviews, Product Hunt, press mentions, GitHub stars all contribute.

---

## 4. Title Elements, Meta Descriptions, Headings, Alt Text

### Title links (`<title>` element)

**Slug:** `appearance/title-link`

- Google uses `<title>` ~80% of the time but **rewrites** it when it's poor (truncated, keyword-stuffed, boilerplate, missing, or doesn't match query).
- Recommended: **descriptive and concise**, distinct per page.
- No fixed character limit, but SERPs typically display **~50–60 characters / ~600 pixels** before truncation.
- Avoid: ALL CAPS, repeated boilerplate ("Home — Site Name | Site Name"), keyword stuffing.
- Format: `Specific Page Topic — Brand Name` works well. Keep brand last unless homepage.
- `<h1>` content is one of the signals Google uses to rewrite a poor title.

### Meta descriptions

**Slug:** `appearance/snippet`

- **Not a ranking factor.** Used as the snippet ~30% of the time; Google generates from page content otherwise.
- Recommended: ~150–160 characters, unique per page, accurately summarizes the page.
- Use `<meta name="description">`. Google may pull from page text or structured data instead.
- Use `data-nosnippet` attribute or `<meta name="robots" content="max-snippet:N">` to control snippet length.

### Heading hierarchy

- Use `<h1>`–`<h6>` semantically. Google has stated **multiple `<h1>`s are fine** (HTML5 sectioning) but a clear single `<h1>` per page is recommended for clarity.
- Headings help Google understand structure and are a signal for **featured snippet selection**.
- Don't use headings purely for visual styling.

### Image alt text

**Slug:** `appearance/google-images`

- Alt text is for **accessibility AND a ranking signal for Google Images**.
- Be descriptive but concise. Avoid "image of" / "picture of."
- Decorative images: use `alt=""`.
- Include relevant keywords **only when they accurately describe the image** — keyword stuffing alt text is a spam signal.
- Filenames also matter: `red-leather-sales-notebook.jpg` > `IMG_4421.jpg`.

### Link best practices

**Slug:** `crawling-indexing/links-crawlable`

- Use real `<a href="...">` tags. JS-only navigation may not be crawled reliably.
- **Anchor text** should be descriptive — Google uses it as a strong relevance signal for the destination page.
- Avoid "click here" / "read more" — provides no signal.
- Use `rel="nofollow"`, `rel="ugc"` (user-generated), `rel="sponsored"` for paid/affiliate links.

---

## 5. AI-Generated Content & Scaled Content Abuse

**Slug:** `essentials/spam-policies` (scaled content abuse section), and Google Search Central blog post Feb 2023 + March 2024 update.

**Google's stated position:** "Appropriate use of AI or automation is not against our guidelines. However, using AI **with the primary purpose of manipulating ranking** in search results is a violation."

### What's allowed
- AI-assisted content where a human edits, fact-checks, adds expertise, and ensures quality.
- AI used to brainstorm, outline, draft sections — then humans refine.
- AI used for translation, summarization, formatting — with human oversight.
- The **E-E-A-T standard applies regardless of how content is created.**

### What's prohibited (Scaled Content Abuse — formalized March 2024)

The policy: producing **many pages with the primary purpose of manipulating search rankings, where pages don't provide original value to users**. Applies whether content is AI-generated, human-generated, or both.

**Triggers:**
- Pages stitched together from scraped/RSS feeds with no value-add
- Mass-generated articles on many topics where individual pages have no clear expertise
- Templated pages where only a keyword/location/name changes, and the rest is boilerplate
- Pages summarizing other sources without adding insight
- Pages answering questions that have no real answer (made-up "release dates," etc.)
- Translation of others' content with no value-add

**Consequence:** Manual action ("Scaled content abuse") and/or algorithmic suppression. Sites hit can lose 90%+ of organic traffic.

### Practical line for brutusai.coach 200+ programmatic pages
The line is **value-add per page**, not "AI vs human." A programmatic page is safe if:
1. **Each page answers a distinct, real user query** (look at GSC + actual search volume, not made-up combinations).
2. **Each page has substantial unique content** — not just template fills with [VARIABLE] swapped.
3. **Each page demonstrates first-hand expertise** — real example dialog, real stats, real call snippet.
4. A reasonable human reading 3 pages would say "these are different valuable resources" — not "this is the same page with a word swapped."

**Red line:** If you generate 200 pages titled "How to handle the [X] objection" where [X] varies and the body is 80% identical templated text with one paragraph changed — that is scaled content abuse.

---

## 6. Spam Policies (Content Side)

**Slug:** `essentials/spam-policies`

| Policy | Trigger | Consequence |
|---|---|---|
| **Cloaking** | Showing different content to users vs. Googlebot | Manual action, deindexing |
| **Doorway pages** | Multiple similar pages targeting variants of a query, funneling to same destination | Manual action ("Pure spam" or "User-generated spam") |
| **Hacked content** | Content injected by an attacker | Manual action, security warning |
| **Hidden text/links** | Text colored to match background, off-screen positioning, font-size 0 | Manual action |
| **Keyword stuffing** | Lists of keywords, repeated unnatural phrases, blocks of city/region names | Algorithmic suppression + manual action |
| **Link spam** | Buying/selling links that pass PageRank, excessive reciprocal links, large-scale guest posting with keyword anchors | Manual action ("Unnatural links to/from your site") |
| **Machine-generated traffic** | Automated queries to Google | Account/IP block |
| **Malware / malicious behavior** | Drive-by downloads, deceptive software | Removal + Safe Browsing warning |
| **Misleading functionality** | Buttons that don't do what they claim (fake "download," "play") | Manual action |
| **Scaled content abuse** | (See section 5) | Manual action |
| **Scraped content** | Content copied from other sites without value-add | Manual action |
| **Sneaky redirects** | Redirecting users to a different URL than the one they intended | Manual action |
| **Site reputation abuse** ("Parasite SEO") | Hosting third-party low-quality content on a high-authority site to exploit reputation | Manual action — **enforced May 2024** |
| **Expired domain abuse** | Buying expired domain for its backlinks and using for unrelated/low-value content | Manual action — **enforced March 2024** |
| **User-generated spam** | Spam in comments, forums, profiles | Manual action against site |
| **Thin affiliate** | Pages with affiliate links and no value-add | Algorithmic suppression |

**For brutusai.coach:** **Scaled content abuse** is the live risk for the 200-page plan. **Doorway pages** is the secondary risk if all 200 pages funnel to the same `/signup` with near-identical bodies.

---

## 7. Structured Data — Every Schema Type That Matters for B2B SaaS

**Slug:** `appearance/structured-data` (overview), individual pages per type. **Google strongly recommends JSON-LD format** in the document `<head>`.

### Highly relevant for brutusai.coach

**Organization** — `appearance/structured-data/organization`
- Used to establish the entity behind the site, populate the **knowledge panel** and the **site name** in SERPs.
- Properties: `name`, `url`, `logo`, `sameAs` (array of social profiles), `contactPoint`, `address`, `foundingDate`.
- Place on homepage, ideally also footer-injected on every page.
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Brutus AI",
  "url": "https://brutusai.coach",
  "logo": "https://brutusai.coach/logo.png",
  "sameAs": [
    "https://www.linkedin.com/company/brutus-ai",
    "https://x.com/brutusai",
    "https://github.com/TurnkeyIsaiah/Brutus"
  ]
}
```

**SoftwareApplication** — `appearance/structured-data/software-app`
- **The single most important schema currently missing.** Eligible for SaaS marketing sites.
- Produces rich snippet with rating + price.
- Required: `name`, `offers` (or `aggregateRating` or `review`).
- Recommended: `applicationCategory`, `operatingSystem`, `aggregateRating`, `offers.price`, `offers.priceCurrency`.
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Brutus AI",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Windows, macOS",
  "offers": {
    "@type": "Offer",
    "price": "10",
    "priceCurrency": "USD"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "47"
  }
}
```
- **Eligibility:** rating must come from real users; faking it = manual action.

**BreadcrumbList** — `appearance/structured-data/breadcrumb`
- Replaces the URL line in SERPs with a clickable breadcrumb path.
- Add to all non-homepage pages. Useful for the planned 200 landing pages.
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://brutusai.coach/"},
    {"@type": "ListItem", "position": 2, "name": "Objections", "item": "https://brutusai.coach/objections/"},
    {"@type": "ListItem", "position": 3, "name": "Price Objection", "item": "https://brutusai.coach/objections/price/"}
  ]
}
```

**Person** — `appearance/structured-data/profile-page` (when used on author pages) or inline in `Article`
- For author bylines. Use with `sameAs` to link to LinkedIn/X.
- Strong E-E-A-T signal.

**Article** — `appearance/structured-data/article`
- For blog posts.
- Required: `headline`, `image`, `datePublished`, `author` (as `Person` with `name` + ideally `url`).
- Eligible for: Top Stories carousel (news only), Article rich result with date/author.

**FAQPage** — `appearance/structured-data/faqpage`
- **RESTRICTED Aug 2023.** Only shown for authoritative government and health sites. Most sites no longer get the rich result.
- **Still worth keeping** for non-rich-result SEO benefits (semantic clarity, AI Overviews input). Already deployed — leave it.

**VideoObject** — `appearance/structured-data/video`
- For demo videos. Eligible for video rich result, key moments, watch action.
- Required: `name`, `description`, `thumbnailUrl`, `uploadDate`.

**Review** / **AggregateRating** — `appearance/structured-data/review-snippet`
- Standalone reviews. **Self-serving reviews (review of your own product/service) are no longer eligible** as of 2019. Must be embedded in Product, SoftwareApplication, etc.

### Marginal relevance

**Course** — only if you publish actual courses. Eligible for Course list rich result.
**Event** — for webinars. Eligible for Event rich result with date/location.
**LocalBusiness** — only if you have a physical location.
**JobPosting** — only if you're hiring publicly. Different rules apply.

### Deprecated / restricted

| Schema | Status |
|---|---|
| **HowTo** | **Deprecated Sep 2023.** Removed from all desktop results, then mobile. Don't add it. |
| **FAQPage** | Restricted Aug 2023 to government/health. Keep markup but don't expect rich result. |
| **Recipe** | Still active but irrelevant to SaaS. |
| **DataVocabulary** | Deprecated 2020. Migrate any to Schema.org. |
| **News article (`@type: NewsArticle`)** | Active but requires Google News inclusion. |

### Validation tools
- **Rich Results Test:** `search.google.com/test/rich-results` — confirms eligibility for specific rich results.
- **Schema Markup Validator:** `validator.schema.org` — checks syntax, no Google-specific eligibility.
- **GSC > Enhancements** — shows which structured data Google has parsed and any errors.

---

## 8. Rich Results & SERP Features

**Slug:** `appearance/visual-elements-gallery`

| Feature | Triggered by | Notes |
|---|---|---|
| **Sitelinks** | Algorithmic — Google chooses based on site structure, internal linking, and clarity of nav. **Not configurable**; you can only `noindex` pages you don't want shown. The old "demote sitelink" GSC tool was removed. |
| **Breadcrumbs in SERP** | `BreadcrumbList` schema + a real breadcrumb in HTML | Replaces URL display |
| **Site name** | `Organization` or `WebSite` schema with `name`, plus consistent branding | Google chose to surface site names ~Oct 2022. May still show domain if signals are unclear. |
| **Favicon** | A `<link rel="icon">` ≥48×48px (multiple of 48), accessible to Googlebot | Slug: `appearance/favicon-in-search` |
| **Sitelinks search box** | Auto-shown for sites Google judges to have site search; you can opt out with `<meta name="google" content="nositelinkssearchbox">` | Slug: `appearance/sitelinks-search-box`. **Google deprecated the markup-based version in Oct 2024**; now purely algorithmic. |
| **Rich snippets (rating, price, etc.)** | Schema markup | See section 7 |
| **Featured snippet** | Page text, HTML structure, query relevance | See section 9 |
| **Knowledge panel** | Entity recognition + `Organization` schema + external authoritative sources | Cannot directly request; can claim via GSC for some entities |
| **People Also Ask** | Algorithmic | Optimize answer-style content |
| **Image pack** | Image SEO | Filename, alt, surrounding text |
| **Video carousel** | `VideoObject` schema + video sitemap | |

---

## 9. Featured Snippets & AI Overviews

**Slug:** `appearance/featured-snippets`

### Featured snippets

**Three formats:**
1. **Paragraph** (~40-60 words) — most common. Triggered by clear definitional / explanatory content.
2. **List** (ordered or unordered) — Google extracts from `<ol>`/`<ul>` or numbered headings.
3. **Table** — extracted from `<table>` markup.

**How to win them:**
- Identify queries that have a featured snippet (use Ahrefs/SEMrush or manual SERP check).
- Answer the query **directly in the first 1-2 sentences after a heading that matches the query**.
- Use semantic HTML: `<h2>` with the question, then `<p>` with the answer.
- For lists: use real `<ol>`/`<ul>`, with descriptive list items.
- For tables: real `<table>` with `<th>`.
- Don't pad with marketing fluff before the answer.

**How to opt out:**
- Page-level: `<meta name="googlebot" content="nosnippet">` — kills featured snippet AND meta description snippet.
- Length cap: `<meta name="robots" content="max-snippet:50">` — too short for featured snippet eligibility (~150 char minimum).
- Element-level: `data-nosnippet` attribute on a `<span>`, `<div>`, or `<section>`.

### AI Overviews (formerly SGE)

**Slug:** `appearance/ai-features`

Google has published limited specifics. What's confirmed:

- AI Overviews use the same ranking signals as traditional search to **select source pages**, then summarize them with Gemini.
- **No new markup or special schema required.** Optimization for AI Overviews = optimization for regular search + structured/clear answers.
- Pages cited in AI Overviews tend to have: clear definitions, scannable structure, authoritative tone, schema markup, fresh dates.
- Opt-out: same controls as snippets — `nosnippet`, `max-snippet`, `data-nosnippet`. There's **no separate AI Overview opt-out flag**; suppressing snippets removes you from AI Overview citations.
- `noindex` removes you from both regular results and AI Overviews.

---

## 10. Title Links & Snippets

**Slug:** `appearance/title-link` and `appearance/snippet`

### How Google generates the title link

Sources Google considers (in rough order):
1. `<title>` element
2. Main visible heading (`<h1>`)
3. Other headings
4. Anchor text from links pointing to the page
5. On-page text emphasized (bold, large)
6. DMOZ (deprecated, no longer used)

### When Google overrides your `<title>`
- Title is empty, missing, or boilerplate ("Untitled Document," "Home")
- Title is keyword-stuffed
- Title is identical across many pages
- Title doesn't reflect page content
- Title is too long and would truncate awkwardly
- Title doesn't match the user's specific query (Google may rewrite per-query)

### How to influence
- Concise, descriptive, unique titles
- Front-load the topic, not the brand
- Match the page's `<h1>` reasonably closely
- Use brand at end with `—` or `|` separator
- Don't repeat the same phrase across all titles

### Snippets
- Generated dynamically per query in most cases.
- Pulled from: meta description, on-page text near matched keywords, structured data.
- Override controls: `nosnippet`, `max-snippet:N`, `data-nosnippet`.

---

## 11. Internal Linking & Navigation

**Slug:** `crawling-indexing/links-crawlable` and `crawling-indexing/sitemaps/overview`

- **Crawlability:** Use `<a href="...">`. Don't rely on JS `onclick` for navigation. Even with rendering, Googlebot may miss.
- **Anchor text:** Descriptive, specific. A link to the pricing page should say "pricing plans" not "click here."
- **Internal link equity:** Pages closer to the homepage in click-depth tend to rank better. Important pages should be ≤3 clicks from the homepage.
- **Sitewide nav:** Keep main nav stable. Footer links are weighted less than main nav but still useful.
- **Contextual links:** In-body links pass more signal than footer links. Link to related pages from within content.
- **Orphan pages** (no internal links) are unlikely to be crawled or ranked. Every page in the planned 200-page set must have at least one internal link from a parent hub page.
- **Hub-and-spoke model:** Create a `/objections/` hub page that links to all 200 individual objection pages, and have each spoke link back to the hub + 3-5 sibling pages.
- **Pagination:** Use real `<a href>` for paginated lists. `rel="next"`/`rel="prev"` is **deprecated** as of 2019; Google figures out pagination on its own.
- **`nofollow` internally:** Don't use it on internal links. It blocks PageRank flow without meaningful benefit.

---

## 12. Programmatic & Scaled Content — Exact Rules (CRITICAL)

This is where the 200-page plan lives or dies. Synthesizing across `essentials/spam-policies`, `fundamentals/creating-helpful-content`, and Google's public statements (esp. SearchLiaison on X):

### Google's actual position
"There's no rule against programmatic content. There's a rule against **content that doesn't help people**." — paraphrase of multiple Google statements.

### The pass/fail framework (use this on every template)

A programmatic page passes if **ALL of the following are true**:

1. **Real demand exists** for the specific page topic. The query has actual search volume (verify with GSC, Ahrefs, or even autocomplete). You're not generating "Brutus AI for left-handed dentists in Toledo" because the combinatorial math gave you that cell.

2. **Each page provides substantive unique value.** Concrete bar (Google has not published a number, but rater patterns suggest):
   - **Minimum ~400-600 words of genuinely unique content** beyond the template chrome.
   - Unique content should include: specific examples, original analysis, different angles for different keywords — not just `[OBJECTION]` swap.
   - For "How to handle the [X] objection" pages: each needs unique example dialog, unique psychology of *that specific* objection, unique counter-frames. Generic "stay calm and ask questions" copy across all 200 = fail.

3. **The page satisfies a clear user intent.** Someone landing from Google should leave thinking "that answered my question," not "that was a thin promo for the product."

4. **A human reviewed and approved each page.** AI-drafted is fine. Untouched AI dump-of-200 is risk.

5. **Pages aren't doorways.** They shouldn't all funnel users to the same conversion page with identical CTAs. Variation in internal linking, content focus, and cross-references matters.

6. **Indexing is intentional.** Don't index everything by default. Start with 20-30 best pages indexed; only expand if they perform. Use `noindex` on weaker pages while you improve them.

### The fail patterns that trigger Scaled Content Abuse
- All pages share >70% of their text (template fill ratio too high)
- Pages target keywords with no real volume / made-up combinations
- No author byline or credentials
- Generic stock images repeated across pages
- Identical CTAs, identical FAQ sections, identical testimonials on every page
- Pages were created in a single day in bulk
- No page-level analytics review or iteration

### Concrete blueprint for the Brutus 200-page plan

Recommended structure for `/objections/[slug]`:

1. **Unique H1** matching the search query (e.g., "How to handle 'we're already using a competitor' in cold calls")
2. **150-word unique intro** — why this specific objection comes up, what it really means
3. **Unique example dialog** — 3-5 turn back-and-forth showing rep + prospect, specific to *this* objection
4. **Unique psychology section** — what the prospect is actually thinking when they say this exact phrase
5. **3-5 counter-frames** specific to this objection (not generic "ask a question")
6. **Common mistakes** specific to this objection
7. **When to walk away** specific to this objection
8. **Brutus-specific section** — how Brutus handles this objection in real-time (ties to product, but not the whole page)
9. **Related objections** — internal links to 3-5 sibling pages
10. **Author byline** — Person schema, with sales background

Total per page: ~1200-1500 words, ~70%+ unique content.

### Index strategy
- Phase 1: Build 20 best pages, index, monitor GSC for 60 days.
- Phase 2: If those rank and don't trigger Helpful Content suppression, expand in batches of 30.
- Phase 3: Cap at the number of objections that actually have search demand — likely 80-150, not a forced 200.

---

## 13. Common Content Mistakes Google Explicitly Warns Against

- **Writing to a target word count.** Google has explicitly said there is no preferred word count. Long for the sake of long is a negative signal.
- **Producing content because it's trending, not because you have something to say.**
- **Summarizing without adding value** ("we read this study so you don't have to" with no original analysis).
- **Promising answers to questions that have no answer** (release dates not yet announced, etc.).
- **Heavy outsourcing across many topics** with no single expert behind any one piece.
- **Auto-translating content without human review.**
- **Low-effort AI-generated content at scale.**
- **Stuffing keywords in alt text, title, meta keywords** (`<meta name="keywords">` is **completely ignored** by Google — has been since 2009).
- **Using `<noscript>` to hide alternate content** (cloaking risk).
- **Making the site about SEO instead of about users.** ("If you'd remove this content if search engines didn't exist, then yes — that signals search-first content.")
- **Faking dates** to appear fresh. Google has said it can detect this.
- **Creating fake reviews** or `aggregateRating` markup not backed by real users — manual action.
- **Stuffing FAQs** with marketing fluff disguised as questions.

### Folklore Google has debunked
- "LSI keywords" — not a thing Google uses.
- "Bounce rate as ranking signal" — Google does not use Google Analytics data for ranking.
- "Domain age" — registration date is not a direct ranking factor.
- "PageRank score" — toolbar PageRank is dead since 2016. Internal PageRank still exists but isn't user-visible.
- "Keyword density" — no specific target ratio.
- "Word count minimums" — no preferred length.

---

## 14. Recommendations Specific to brutusai.coach

Ranked by impact-to-effort ratio. Specific files referenced.

### Immediate (this week)

1. **Add `SoftwareApplication` schema to `index.html` and `features.html`.** Single biggest schema gap. Use the JSON-LD example in section 7. Once you have any real reviews, add `aggregateRating`. Eligibility for the rich snippet with rating + price = significant CTR lift.

2. **Add `BreadcrumbList` schema to all non-homepage pages** (`features.html`, `pricing.html`, `about.html`, `dna.html`). Cleaner SERP appearance, especially helpful when 200 programmatic pages launch.

3. **Add `Person` schema with `sameAs` to `about.html`** for the founder. LinkedIn + X + GitHub URLs in `sameAs`. Strongest single E-E-A-T signal you can add today.

4. **Audit `<title>` tags across all 5 pages.** Each unique, ~50-60 chars, format `[Specific Topic] — Brutus AI`. Don't repeat brand-first.

5. **Audit meta descriptions.** Each unique, ~150 chars, written for click-through not for rankings.

### Short-term (next 30 days)

6. **Build `about.html` into a real E-E-A-T page.** Founder photo, sales background, why you built it, named team if any, contact email, link to LLC (La Rios Co), press mentions if any. This is the page raters will judge "trust" by.

7. **Add `Organization` schema improvements** if not complete: `logo`, `sameAs` array (LinkedIn, X, GitHub), `contactPoint`. Place on every page (footer-injectable JSON-LD block).

8. **Set up favicon properly.** A 48×48 (or 96×96, 144×144) `.ico` or `.png` linked via `<link rel="icon">`. Makes your favicon appear in mobile SERPs.

9. **Audit footer links.** Every page should link to: privacy, terms, refund policy, contact, About. Trust signals + crawl path.

10. **Don't add `HowTo` schema** even if a tool suggests it — deprecated.

11. **Keep your `FAQPage` schema** but don't expect rich results. Helps with AI Overviews and semantic clarity.

### For the 200-page programmatic plan — DO NOT SKIP

12. **Build the template using the section-12 blueprint.** Bake in: unique H1, unique 150-word intro, unique example dialog, unique counter-frames per page, author byline, related-objections internal links.

13. **Validate uniqueness programmatically.** Before publishing, run a similarity check (cosine similarity on TF-IDF or embeddings) across all generated pages. **Reject any pair with >70% similarity.** This is the single most important automated guardrail.

14. **Verify search demand for each slug.** Don't generate combinations that have zero searches. Pull GSC + Ahrefs/SEMrush data; only build pages for queries with verified intent.

15. **Phased indexing.** Launch 20, wait 60 days for GSC data. Expand only if traffic and impressions are healthy and no Helpful Content suppression appears.

16. **Hub page at `/objections/`** linking to all live objection pages. Every spoke links back to hub + 3-5 siblings.

17. **Per-page author bylines** with `Person` schema. Even if it's the same author on all pages, the byline signals real ownership.

18. **Avoid identical CTAs and FAQs across pages.** Vary the closing call-to-action and FAQ section per page.

### Ongoing

19. **Monitor GSC > Manual Actions weekly** once 200-page plan is live. Any "Scaled content abuse" notification = pause expansion immediately.

20. **Track Helpful Content Update impacts.** Google rolls these into core updates now. After each core update, check GSC traffic for 30 days. A 30%+ drop tied to an update = remove or improve weakest pages.

21. **Get real product reviews** on G2, Product Hunt, Capterra. These feed `aggregateRating` schema legitimately and strengthen E-E-A-T externally.

22. **Don't add llms.txt SEO hopes** — confirmed it's not a Google ranking signal. Keep it for future LLM indexing but don't rely on it for SERP.

---

**Bottom line for the 200-page plan:** The line between "useful programmatic content" and "scaled content abuse" is **per-page substantive uniqueness backed by real demand**. Templates fine; template fills failing. Build 20 great ones, prove they rank, expand methodically.
