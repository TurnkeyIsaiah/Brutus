---
name: Brutus SEO Playbook
description: Prioritized action list for ranking brutusai.coach higher organically. Synthesizes the technical + content briefs into impact-ranked tasks with quick-reference thresholds.
type: project
originSessionId: 850bd198-1a06-48dc-aeeb-44b9b2e9ee6e
---
# Brutus SEO Playbook

**Synthesized 2026-05-03** from `brutus-seo-technical.md` (technical SEO reference) and `brutus-seo-content.md` (content + structured data reference). Both detailed briefs cite Google Search Central doc slugs and reflect documentation through January 2026 (post-March-2024 core update, post-May-2024 site-reputation-abuse policy, post-Aug-2023 FAQ/HowTo deprecations).

## Quick-reference thresholds

- **Core Web Vitals (75th percentile, field data):** LCP ≤2.5s · INP ≤200ms · CLS ≤0.1
- **Title:** ~50–60 chars, unique per page
- **Meta description:** ~150–160 chars, unique per page (not a ranking factor, just CTR)
- **Sitemap limits:** 50,000 URLs OR 50 MB uncompressed per file
- **robots.txt limit:** 500 KiB
- **Sitemap `<changefreq>` and `<priority>`:** ignored — don't bother
- **GSC URL "Request Indexing":** ~10/day per property
- **Programmatic page uniqueness bar:** ≥70% unique content per page; reject pairs >70% similar

## Priority 1 — This week (high impact, low effort)

1. **Add `SoftwareApplication` JSON-LD to `index.html` + `features.html`.** Highest-leverage missing schema. Eligible for rich snippet with rating + price. Schema example in `brutus-seo-content.md` §7.
2. **Add `BreadcrumbList` JSON-LD to `features.html`, `pricing.html`, `about.html`, `dna.html`.** Replaces URL line in SERP — better visual real estate.
3. **Add `Person` JSON-LD to `about.html`** for the founder, with `sameAs` array → LinkedIn, X, GitHub. Single biggest E-E-A-T signal you can add today.
4. **Self-referencing canonicals on every marketing page** — `<link rel="canonical" href="https://brutusai.coach/[page].html">`. Prevents `?utm_*` duplicate-content fights.
5. **Audit `<title>` tags.** Each unique, ~50-60 chars, format `[Specific Topic] — Brutus AI`. Topic first, brand last.
6. **Audit meta descriptions.** Each unique, ~150 chars, click-through copy not keyword copy.
7. **Add `width` + `height` attributes to every `<img>`** in the 5 HTML files. Free CLS win.
8. **Preload hero image** on `index.html` and `dna.html`: `<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">`. Direct LCP improvement.
9. **`robots.txt` audit.** Confirm no CSS/JS blocked, sitemap URL listed, `app.brutusai.coach` has its own `User-agent: *\nDisallow: /` to keep auth flows out of the index.
10. **Favicon.** Confirm `<link rel="icon">` points to a 48×48+ image. Surfaces favicon in mobile SERPs.

## Priority 2 — Next 30 days

11. **Build `about.html` into a real E-E-A-T page.** Founder name, photo, sales background, why you built it, La Rios Co LLC reference, contact email, any press mentions. The page raters judge "trust" by.
12. **Cloudflare (free plan) in front of GitHub Pages.** Adds Brotli, HTTP/3, edge caching, better TTFB globally, WAF, DDoS protection. GH Pages alone is US-centric and gzip-only.
13. **HSTS preload after Cloudflare:** `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` + submit to hstspreload.org.
14. **Convert hero images to WebP/AVIF.** PNG → WebP via `<picture>` is the easiest LCP regression.
15. **Defer non-critical JS.** Add `defer` to all `<script>` except inline critical scripts.
16. **Inline critical CSS** for above-the-fold styles on `index.html` + `dna.html`.
17. **Sitemap hygiene.** Only canonical, indexable, 200-status URLs. Drop any `app.brutusai.coach` references.
18. **`Organization` schema on every page** (footer-injectable JSON-LD), with `logo`, `sameAs`, `contactPoint`.
19. **Footer trust links on every page:** privacy, terms, refund policy, contact, About.
20. **Get real product reviews** on G2, Product Hunt, Capterra. Powers legitimate `aggregateRating` schema + external authority signals.

## Priority 3 — The 200-page programmatic plan (CRITICAL)

This is the single biggest SEO risk on the roadmap. Google's March 2024 spam update specifically targets "scaled content abuse" with **site-wide signals** — bad programmatic pages drag down the 5 quality marketing pages too.

21. **Verify search demand per slug before building.** Pull GSC + Ahrefs/SEMrush. Don't generate combinatorial cells with zero searches.
22. **Per-page template requirements** (full blueprint in `brutus-seo-content.md` §12):
    - Unique H1 matching the actual query
    - 150-word unique intro specific to *this* objection
    - Unique 3-5 turn example dialog
    - Unique psychology / counter-frames / common-mistakes / when-to-walk-away sections
    - Brutus-specific section (ties to product, isn't the whole page)
    - Related-objections internal links (3-5 siblings)
    - Author byline with `Person` schema
    - Total ~1200-1500 words, ≥70% unique
23. **Programmatic uniqueness gate.** Before publishing, compute pairwise similarity (TF-IDF cosine or embedding distance) across all generated pages. **Reject any pair >70% similar.** This is the single most important automated guardrail.
24. **Hub-and-spoke structure.** `/objections/` hub linking to all live spokes; each spoke links back + to 3-5 siblings.
25. **Vary CTAs and FAQs per page.** Identical closing CTAs across 200 pages = doorway-page signal.
26. **Phased indexing.** Launch 20 best, wait 60 days, monitor GSC. Only expand in batches of 30 if those rank cleanly with no Helpful Content suppression.
27. **Cap at real demand, not 200.** Likely 80-150 objections actually have search volume. Don't force the count.
28. **Per-launch:** GSC URL Inspection → Request Indexing for each new page (rate-limited ~10/day, so spread launches).

## Priority 4 — Ongoing monitoring

29. **Weekly GSC checks:**
    - **Pages report:** any growth in "Crawled - currently not indexed"? Diagnose thin content.
    - **Performance:** track impressions, clicks, average position, INP per page over time (16-month rolling history).
    - **Core Web Vitals report:** 75th percentile per metric per device.
    - **Manual Actions:** must always be empty. Any "Scaled content abuse" = pause expansion immediately.
    - **Crawl Stats** (Settings → Crawl Stats): if avg response time creeps over ~300ms, GH Pages is the bottleneck — Cloudflare fixes it.
30. **After every Google core update,** check GSC traffic for 30 days. A 30%+ drop tied to an update = remove or improve weakest pages.

## Hard "do not" list

- ❌ Don't add `HowTo` schema (deprecated Sep 2023)
- ❌ Don't add `noindex` to robots.txt (unsupported since 2019)
- ❌ Don't combine `Disallow` + `noindex` on same URL (Google can't see noindex if blocked)
- ❌ Don't use `rel="canonical"` to a noindexed page or to a redirect
- ❌ Don't lazy-load the LCP image
- ❌ Don't fake `aggregateRating` (manual action)
- ❌ Don't use Indexing API for non-JobPosting/livestream content (TOS violation)
- ❌ Don't write to a target word count (Google has explicitly debunked)
- ❌ Don't trust llms.txt for ranking (not a Google signal)
- ❌ Don't disavow links preventively — only after a manual action

## Folklore to ignore (Google has explicitly debunked)

- "LSI keywords" · "Bounce rate as ranking signal" · "Domain age helps ranking" · "Toolbar PageRank" · "Keyword density" · "Word count minimums" · "Pinging search engines" · "Exact-match anchor text"

## What's not relevant for brutusai.coach

AMP · News sitemaps · Video sitemaps · Indexing API · Change of Address tool · hreflang (until internationalizing) · Merchant/Shopping/Discover reports · Crawl-delay tuning · URL Parameters tool (retired anyway) · Recipe/Course/JobPosting/LocalBusiness schemas

## Detailed references

- **`brutus-seo-technical.md`** — Crawling, indexing, sitemaps, redirects, mobile, Core Web Vitals, JS SEO, performance, GSC reports, site moves, spam policies, technical mistakes
- **`brutus-seo-content.md`** — Helpful Content System, E-E-A-T, Quality Rater Guidelines, content guidelines, AI/scaled content rules, structured data schemas, rich results, featured snippets, AI Overviews, internal linking, programmatic content rules
