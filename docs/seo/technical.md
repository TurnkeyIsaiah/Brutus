---
name: Brutus SEO — Technical Reference
description: Expert reference for technical SEO (crawling, indexing, sitemaps, mobile, Core Web Vitals, JS SEO, GSC reports, migrations, spam) tailored to brutusai.coach
type: reference
originSessionId: 850bd198-1a06-48dc-aeeb-44b9b2e9ee6e
---
# Google Search — Technical SEO Expert Brief

> **Sourcing note:** Synthesized from Google Search Central documentation as of January 2026. Where Google's wording is famous/exact (thresholds, syntax), it's verbatim. Doc-page slugs cited so any line can be re-verified at `developers.google.com/search/docs/{slug}`.

## 1. Crawling

- **robots.txt location:** Must be at the root: `https://brutusai.coach/robots.txt`. One file per origin (scheme + host + port). A robots.txt at `app.brutusai.coach` is a separate file from the apex. (Doc: `crawling-indexing/robots/intro`)
- **File size limit:** Google enforces a **500 KiB** cap. Anything past that is ignored. (Doc: `crawling-indexing/robots/robots_txt`)
- **Caching:** Google caches robots.txt up to **24 hours**, longer if the server can't be reached.
- **Failure handling:** 5xx for robots.txt for >30 days = Google treats site as fully disallowed and may drop it. 4xx (including 404) = Google treats site as **fully allowed**. Connection failures behave like 5xx.
- **Supported directives:** `user-agent`, `allow`, `disallow`, `sitemap`. `crawl-delay` is **NOT supported by Googlebot** (set crawl rate via Search Console only — and that setting was retired in Jan 2024; Google now auto-throttles). `noindex` in robots.txt is **NOT supported** (was deprecated 2019).
- **Wildcards:** `*` (any sequence) and `$` (end of URL) are supported. Path matching is case-sensitive.
- **Most specific rule wins,** not order. `Allow: /folder/page` beats `Disallow: /folder/`.
- **robots.txt does NOT prevent indexing.** A blocked URL can still appear in search results (URL-only listing) if other pages link to it. To deindex, use `noindex` meta or X-Robots-Tag header — and the page must be **crawlable** for Google to see the noindex. (Doc: `crawling-indexing/block-indexing`)
- **Crawl budget** matters only if site has **>1M pages updating weekly** OR **>10k pages updating daily** OR many auto-generated URLs (faceted nav, session IDs). For a 5-page static site this is **N/A**. (Doc: `crawling-indexing/large-site-managing-crawl-budget`)
- **What wastes crawl budget when it does matter:** faceted nav, on-site duplicate content, soft 404s, hacked pages, infinite spaces (calendars), low-quality/spam content, action URLs.
- **Googlebot user-agents:** Mobile-first indexing means the **smartphone Googlebot** is primary. Other bots: `Googlebot-Image`, `Googlebot-Video`, `Googlebot-News`, `AdsBot-Google`, `Mediapartners-Google`, `Google-InspectionTool` (URL Inspection), `GoogleOther` (R&D crawls), `Google-Extended` (controls Gemini/Vertex training opt-out, separate from search). (Doc: `crawling-indexing/overview-google-crawlers`)
- **Verify Googlebot:** Reverse DNS lookup must resolve to `googlebot.com`, `google.com`, or `googleusercontent.com`, and forward DNS must match the original IP. Or check published IP ranges JSON: `https://developers.google.com/static/search/apis/ipranges/googlebot.json`.
- **Render engine:** Googlebot uses an **evergreen Chromium** (updated within weeks of stable Chrome). No version-specific worry needed.

## 2. Indexing

- **Two-phase indexing for JS sites:** initial HTML crawl, then a deferred render pass when resources free up. Render queue can be hours to days. Server-rendered HTML is indexed faster.
- **Removing pages from index:**
  - `<meta name="robots" content="noindex">` — most reliable; page must NOT be blocked in robots.txt.
  - `X-Robots-Tag: noindex` HTTP header — works for non-HTML (PDFs, images).
  - 404/410 — eventually drops; 410 is slightly faster signal.
  - URL Removals tool in GSC — temporary (~6 months), fast.
  - Password protection — most aggressive.
- **`nofollow`:** A *hint* since 2019, not a directive. `rel="sponsored"` for paid links, `rel="ugc"` for user-generated. Use comma-separated for multiple: `rel="nofollow sponsored"`. (Doc: `crawling-indexing/qualify-outbound-links`)
- **Canonical signals (in rough order):** explicit `rel="canonical"`, redirect target, sitemap inclusion, internal linking patterns, HTTPS over HTTP, shorter URL, hreflang grouping. Google picks one — they call this the "Google-selected canonical," visible in URL Inspection. (Doc: `crawling-indexing/canonicalization`)
- **rel=canonical rules:**
  - Use absolute URLs.
  - Self-referencing canonicals are **fine and recommended**.
  - One canonical per page; multiple = all ignored.
  - Canonical must point to a 200 page (not redirect, not noindex).
  - Cross-domain canonicals are honored (e.g., syndicated content).
  - Don't combine `noindex` + `canonical` on the same page — conflicting signals.
- **Indexing API:** Officially **only for `JobPosting` and `BroadcastEvent` (livestream) structured data**. Using it for other content is against TOS and won't reliably index. (Doc: `crawling-indexing/indexing-api/overview`) — **N/A for brutusai.coach.**
- **Soft 404:** Page returns 200 but content looks like "not found" / empty / thin. Google will treat as 404 and drop it. Common with SPA routing or dynamic pages with no content fallback.

## 3. Sitemaps

- **Format options:** XML (preferred), RSS/Atom, plain text (one URL per line). XML is the only format supporting images/video/lastmod metadata.
- **Limits per sitemap:** **50,000 URLs** AND **50 MB uncompressed**. Above either, split into multiple sitemaps + a sitemap index. (Doc: `crawling-indexing/sitemaps/build-sitemap`)
- **Sitemap index file:** Lists up to 50,000 sitemaps. Same limits apply.
- **Submission:**
  1. Reference in robots.txt: `Sitemap: https://brutusai.coach/sitemap.xml` (full URL).
  2. Submit in GSC → Sitemaps report.
  3. Ping `https://www.google.com/ping?sitemap=...` — **deprecated June 2023**, no longer works. Use GSC.
- **`<lastmod>`:** Only include if it reflects the **last meaningful content change** — Google ignores it when it's clearly automated/unreliable. Use ISO 8601 (`2026-05-03` or `2026-05-03T14:00:00+00:00`).
- **`<changefreq>` and `<priority>`:** Google **ignores both**. Don't waste effort on them. (Confirmed publicly by John Mueller and the docs.)
- **Sitemap URLs must:**
  - Be the canonical version (no redirects, no noindex, returns 200).
  - Be on the same host as the sitemap (cross-host sitemaps require GSC verification of both hosts, or hosting at the root with a robots.txt entry).
  - Use HTTPS if the site is HTTPS.
- **Image sitemaps:** Inline `<image:image>` blocks within URL entries — useful when images are loaded by JS or hidden behind interactions and Google can't crawl them naturally.
- **Video sitemaps:** Required for proper video indexing if videos aren't autodetected. **Likely N/A.**
- **News sitemaps:** Only for sites approved for Google News. **N/A.**
- **hreflang in sitemaps:** Alternative to in-HTML hreflang — useful when many language variants. **N/A unless internationalizing.**

## 4. URL structure & redirects

- **Best practices:** descriptive words over IDs, hyphens not underscores, lowercase, ASCII when possible, UTF-8 encoded for non-ASCII. (Doc: `crawling-indexing/url-structure`)
- **Avoid:** session IDs in URLs, infinite parameter combinations, dates that change the URL but not the content.
- **Redirects:**
  - **301 (permanent):** consolidates ranking signals to the target. Use for migrations, HTTPS, www→apex, trailing slash normalization.
  - **302 (temporary):** Google eventually treats as 301 if it persists, but slower. Use only when truly temporary.
  - **307 / 308:** Treated like 302/301 respectively. 308 explicitly preserves method (relevant for non-GET).
  - **Meta refresh / JS redirect:** Followed but slower and weaker signal. Use HTTP redirects.
  - **Redirect chains:** Limit to **<5 hops**; Googlebot follows up to ~10 then gives up. Each hop loses time/signal.
- **hreflang (internationalization):**
  - `<link rel="alternate" hreflang="en-us" href="..." />` in `<head>`, OR HTTP header, OR sitemap entries.
  - **Must be reciprocal** — every alternate must point back, including a self-reference. Non-reciprocal hreflang is ignored.
  - Use `hreflang="x-default"` for the fallback page (typically the language picker or default-language version).
  - Language code is ISO 639-1, region is ISO 3166-1 Alpha 2 (`en-US`, not `en-USA`). (Doc: `specialty/international/localized-versions`)
  - **N/A for brutusai.coach** unless launching localized versions.
- **Pagination:** `rel="next"`/`rel="prev"` was **deprecated by Google in 2019**. Just use clean URLs and good internal linking; Google figures pagination out.
- **URL parameters tool in GSC:** **Retired April 2022.** Don't reference it.

## 5. Mobile

- **Mobile-first indexing is universal as of Oct 2023.** Google indexes the mobile version. If your mobile content is a stripped-down version of desktop, you lose ranking signals from the missing content.
- **Three configurations Google recognizes:**
  1. **Responsive (recommended)** — same HTML, same URL, CSS adapts. Lowest maintenance, lowest error rate. **Use this.**
  2. **Dynamic serving** — same URL, server returns different HTML based on UA. Requires `Vary: User-Agent` header.
  3. **Separate URLs (m.example.com)** — requires bidirectional `rel=alternate`/`rel=canonical` annotations. Highest error surface. **Avoid.**
- **Required for any mobile setup:**
  - `<meta name="viewport" content="width=device-width, initial-scale=1">` in `<head>`.
  - Tap targets ≥48×48 CSS pixels with adequate spacing.
  - Readable font without zoom.
  - No horizontal scroll.
  - **All content visible on mobile** (don't hide text/images mobile-only — they won't be indexed).
- **Mobile Usability report in GSC was retired Dec 2023.** Use Lighthouse / Chrome DevTools mobile emulation + Core Web Vitals report instead.

## 6. Page Experience & Core Web Vitals

**Exact thresholds (Doc: `web.dev/articles/vitals`, also `search/docs/appearance/page-experience`):**

| Metric | Good | Needs Improvement | Poor |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤2.5s | 2.5–4.0s | >4.0s |
| **INP** (Interaction to Next Paint) — replaced FID March 12, 2024 | ≤200ms | 200–500ms | >500ms |
| **CLS** (Cumulative Layout Shift) | ≤0.1 | 0.1–0.25 | >0.25 |

- **75th percentile across all page loads on a URL** (or origin if not enough URL-level data) must meet "Good" to count as Good. Field data only — from CrUX (Chrome User Experience Report).
- **Field vs lab:**
  - **Field data (CrUX) is what Google ranks on.** PSI shows it under "Discover what your real users are experiencing."
  - **Lab data (Lighthouse)** is for debugging — useful but not the ranking signal.
  - You need enough real Chrome users hitting the page to even get field data. Small/new sites often see "no field data" — Google falls back to origin-level CrUX, then to no Page Experience signal.
- **Page Experience as a ranking factor:** Google has explicitly said it's a **tiebreaker / minor signal**. "Great content beats great page experience." But poor CWV on competitive queries can demote you. The standalone "Page Experience report" was retired Nov 2023 — only Core Web Vitals + HTTPS report remain in GSC.
- **Other former Page Experience signals (still required, just no longer surfaced as a single bucket):** HTTPS, no intrusive interstitials, mobile-friendly.
- **AMP:** No longer a Top Stories requirement (since June 2021). **N/A — don't build AMP.**
- **What moves LCP most:**
  - Server response time (TTFB).
  - Render-blocking CSS/JS in `<head>`.
  - Hero image not preloaded or lazy-loaded incorrectly (LCP image must NOT have `loading="lazy"`).
  - Web fonts blocking text render.
- **What moves INP most:**
  - Long JS tasks (>50ms) on the main thread.
  - Heavy event handlers (especially analytics, hydration on click).
  - Large React/Vue re-renders on input.
- **What moves CLS most:**
  - Images/iframes/ads without `width`/`height` attributes.
  - Web fonts swapping (use `font-display: optional` or preload the font).
  - Content injected above existing content (cookie banners, A/B test variants).

## 7. HTTPS / security

- **HTTPS is a ranking signal** (since 2014, lightweight). More importantly, Chrome marks HTTP as "Not Secure."
- **Requirements Google checks:** valid cert, no expired cert, no name mismatch, modern protocol (TLS 1.2+).
- **Mixed content:** HTTPS page loading HTTP subresources. Modern browsers block this; Google treats the page as broken/insecure. Audit with Chrome DevTools → Security tab.
- **HSTS** (`Strict-Transport-Security` header): Recommended. `max-age=31536000; includeSubDomains; preload` is the standard. Once on the HSTS preload list, removal takes months — only enable when you're sure all subdomains are HTTPS.
- **HTTP→HTTPS migration:** 301 every HTTP URL to its HTTPS twin. Update sitemap, internal links, canonicals. Add HTTPS property in GSC (separate from HTTP property).
- **GitHub Pages:** Free TLS via Let's Encrypt; enable "Enforce HTTPS" in repo settings. **brutusai.coach is already on HTTPS** — no action needed.

## 8. JavaScript SEO

- **Three phases:** crawl → render → index. Render queue is shared and can lag. (Doc: `crawling-indexing/javascript/javascript-seo-basics`)
- **What works:**
  - SSR (server-side rendering) — Googlebot sees content immediately.
  - SSG (static generation) — same, even better.
  - Hydration — fine, as long as the rendered HTML contains the content.
- **What breaks:**
  - Content only loaded after user interaction.
  - Content fetched from APIs that block Googlebot (e.g., behind cookies/auth).
  - Routing without proper URL changes (use History API; hash-based routing `#/page` is still problematic — Google ignores fragments).
  - `robots.txt` blocking JS/CSS files — Google can't render the page properly.
- **Dynamic Rendering: officially deprecated** (2022). Google says use SSR, SSG, or hydration instead.
- **Lazy loading:**
  - Use native `loading="lazy"` for below-the-fold images. Above-the-fold images should NOT be lazy-loaded (kills LCP).
  - For JS-driven lazy loading, use IntersectionObserver. Test with the URL Inspection tool's "View tested page" → "Screenshot."
- **Soft 404 risk in SPAs:** When a route doesn't exist, return real 404 status, not a 200 with "page not found." For static SPAs on GitHub Pages, use a 404.html — GitHub serves it with a real 404 status.
- **Test rendering:** GSC URL Inspection → "Test live URL" → "View tested page" shows the rendered HTML and screenshot Googlebot saw. This is the ground truth.

## 9. Performance

- **Image formats:** AVIF > WebP > JPEG > PNG for photos. Google explicitly recommends modern formats. Use `<picture>` with fallbacks. (Doc: `web.dev/learn/performance/image-performance`)
- **Image sizing:** Always set `width` and `height` attributes (prevents CLS). Serve responsive images via `srcset`/`sizes`.
- **Preload critical resources:** `<link rel="preload" as="image" href="hero.webp" fetchpriority="high">` for LCP image. `<link rel="preload" as="font" type="font/woff2" crossorigin>` for above-fold web fonts.
- **Preconnect / dns-prefetch:** `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` for third-party origins you'll hit early.
- **Render-blocking resources:**
  - Inline critical CSS, defer the rest with `media="print" onload="this.media='all'"` trick or proper `<link rel="preload">` + swap.
  - Use `defer` or `async` on `<script>` tags. `defer` preserves order; `async` doesn't.
  - Move third-party scripts (analytics, chat widgets) to `defer` and load after interaction when possible.
- **Compression:** Brotli > gzip. GitHub Pages serves gzip automatically. No Brotli on GitHub Pages — a CDN like Cloudflare in front would add Brotli + edge caching + better TTFB.
- **HTTP/2 / HTTP/3:** GitHub Pages serves HTTP/2 already. HTTP/3 requires a CDN.
- **Caching headers:** GitHub Pages sets `Cache-Control: max-age=600` (10 min) for HTML — fine for marketing pages. Static assets (images/CSS/JS with hashed filenames) get longer cache from GH Pages CDN.

## 10. Search Console — every report explained

(Doc tree: `search/docs/monitor-debug/search-console-start`)

- **URL Inspection tool:** Single most useful tool. Shows: Google's index status, last crawl date, Google-selected canonical, mobile usability, structured data, rendered HTML/screenshot. "Test live URL" forces a fresh crawl. "Request Indexing" submits to crawl queue (rate-limited, ~10/day per property).
- **Pages report (formerly Coverage / Index Coverage):** Shows indexed vs not-indexed URLs. Common findings:
  - *"Crawled - currently not indexed"* — Google decided your page isn't worth indexing (often thin content, near-duplicate of an existing page). **Action:** improve content/uniqueness or accept it.
  - *"Discovered - currently not indexed"* — Google knows about it but hasn't crawled. Common on new sites. **Action:** improve internal linking, server speed; usually resolves with time.
  - *"Duplicate, Google chose different canonical than user"* — your `rel=canonical` was overridden. **Action:** check URL Inspection for what Google chose; usually means the "duplicate" has stronger signals.
  - *"Page with redirect"* — informational, not a problem.
  - *"Excluded by 'noindex' tag"* — verify intentional.
  - *"Blocked by robots.txt"* — verify intentional.
  - *"Soft 404"* — Google thinks the page is empty. Add real content or return 404.
  - *"Not found (404)"* — old URLs being crawled. Fine if intentional; redirect if you have a replacement.
  - *"Server error (5xx)"* — fix immediately, hurts crawl rate.
- **Sitemaps report:** Shows submission status, discovered URLs, errors. Discrepancy between submitted and indexed URLs is normal.
- **Performance report:** Clicks, impressions, CTR, average position. Filter by query/page/country/device/search appearance/date. **16 months max history** (rolling). Average position is averaged across impressions, so 1 impression at #1 + 1 at #100 = avg 50.5.
- **Removals:** Temporarily hide a URL (~6 months). For permanent removal, also noindex / 404 the URL.
- **Core Web Vitals report:** Aggregated CrUX field data, grouped by URL pattern. Shows Good/Needs Improvement/Poor counts per metric per device.
- **HTTPS report:** Lists pages served over HTTP that Google would prefer HTTPS for.
- **Manual Actions:** Penalty notifications. Empty = good.
- **Security Issues:** Hacked content, malware, social engineering. Empty = good.
- **Links report:** Top linked pages, top linking sites, top anchor text. Useful for diagnosing where authority flows.
- **Crawl Stats** (Settings → Crawl Stats): Total crawl requests, download size, avg response time. Spikes/dips warrant investigation. Shows by file type, by purpose (refresh vs discovery), by Googlebot type.
- **Enhancements section:** Per-feature reports for structured data (Sitelinks searchbox, FAQ, HowTo, Product, etc.). Shows valid items, warnings, errors. **Most are content-team's domain.**
- **Shopping / Merchant listings / Video / News / Discover:** Surface-specific reports. **N/A for SaaS.**

## 11. Site moves

- **Change of Address tool (GSC):** For domain changes only (apex to apex). Requires both old and new properties verified. Use after 301s are in place. (Doc: `crawling-indexing/site-move-with-url-changes`)
- **Process for domain move:**
  1. Set up the new site, fully crawlable.
  2. 301 every old URL to its new equivalent (1:1 mapping, not all to homepage).
  3. Update internal links, sitemap, canonicals to new domain.
  4. Submit new sitemap to new property.
  5. File Change of Address in old property.
  6. Keep 301s live for **at least 1 year** (Google recommends indefinitely if possible).
- **HTTPS migration:** Same as above without Change of Address tool (it's same hostname). Just 301 + update everything.
- **Subdomain → subfolder migration** (or vice versa): Treated as a site move. Same playbook minus Change of Address (only works for full domains).
- **Soft launches / staging:** Always block staging with HTTP auth (not just robots.txt — Google can still index URL-only). Once-indexed staging URLs are painful to remove.

## 12. Spam, manual actions, disavow

- **Manual actions** appear in GSC → Security & Manual Actions → Manual Actions. Categories: unnatural links to your site, unnatural links from your site, thin content, cloaking, hidden text, keyword stuffing, user-generated spam, spammy structured data. (Doc: `essentials/spam-policies`)
- **Recovery:** Fix the issue, then **Request Reconsideration** with detailed remediation notes. Can take weeks.
- **Algorithmic demotions** (no manual action notice) — caused by core updates, spam updates, helpful content system. No reconsideration option; recover via content/site improvements and wait for next update.
- **Disavow tool** (`https://search.google.com/search-console/disavow`): Tells Google to ignore specific backlinks. **Use only if you have a manual action for unnatural links, OR you're absolutely sure spammy links are hurting you.** Google's recommendation: most sites should never use it. Format: plain text file, one URL or `domain:example.com` per line.
- **Spam policies — what gets you penalized:**
  - Cloaking (showing different content to users vs Googlebot).
  - Doorway pages (many similar pages funneling to one).
  - Hidden text / links.
  - Keyword stuffing.
  - Link schemes (paid links without `rel="sponsored"`, link exchanges, PBNs).
  - Machine-generated content "primarily to manipulate rankings" (note: AI content is fine if helpful — the March 2024 spam update tightened "scaled content abuse").
  - Expired domain abuse.
  - Site reputation abuse ("parasite SEO" — hosting third-party content on your domain to rank).
  - Sneaky redirects.
  - Affiliate content with no added value.
- **Helpful Content system:** Now part of the core ranking algorithm (since March 2024). Site-wide signal — low-helpfulness pages drag the whole site.

## 13. Common mistakes Google explicitly warns against

- **Blocking CSS/JS in robots.txt** — breaks rendering, breaks mobile-friendliness, breaks layout shift detection. Always allow.
- **Using `noindex` in robots.txt** — unsupported since 2019. Silently ignored.
- **Combining `Disallow` and `noindex`** — Google can't see the noindex if the page is disallowed. Use one or the other.
- **`rel=canonical` to a noindexed page** — conflicting; canonical ignored.
- **`rel=canonical` to a redirect** — canonical resolves to the redirect target, but adds ambiguity. Point to the final URL.
- **Multiple canonicals on one page** — all ignored.
- **Lazy-loading the LCP image** — kills CWV.
- **Missing `width`/`height` on images** — guarantees CLS.
- **`changefreq` and `priority` in sitemaps** — ignored by Google. Don't bother.
- **Fragment URLs (`#section`)** — Google treats as same page; can't index different fragments separately.
- **Hash-based SPA routing (`#/page`)** — same problem.
- **Soft 404s from SPAs** — return real 404 status.
- **Hiding content behind tabs/accordions on mobile** — fully indexed but historically Google gave it slightly less weight; current stance: indexed at full weight if accessible without interaction.
- **Auto-generated, low-value programmatic pages** — risk of "scaled content abuse" penalty if pages are near-duplicate templates with no unique value. **Direct relevance to the planned 200+ programmatic landing pages.**
- **Buying expired domains for link equity** — explicit policy violation since 2024.
- **Asking for indexing via Indexing API** for non-JobPosting/livestream content — TOS violation.
- **Stuffing keywords in URLs / domain** — no longer helps (and looks spammy).

## 14. Recommendations specific to brutusai.coach

Ranked by impact for a 5-page static SaaS on GitHub Pages with 200+ programmatic pages planned.

**Tier 1 — do these this week:**

1. **`robots.txt` audit.** Confirm it does NOT disallow CSS/JS, does NOT block your sitemap, and includes `Sitemap: https://brutusai.coach/sitemap.xml`. The `app.brutusai.coach` subdomain has its own robots.txt — ensure that one is `User-agent: *\nDisallow: /` to keep the authenticated app out of the index entirely (the marketing apex doesn't need to disallow `/signup`, `/login`, `/verify-email` because those live on the app subdomain).
2. **Self-referencing canonicals on every marketing page.** Add `<link rel="canonical" href="https://brutusai.coach/features.html">` etc. to all 5 HTML files. Prevents accidental dup-content fights with `?utm_*` URLs.
3. **`<link rel="canonical">` for the apex / index** — pick one canonical hostname (recommend `brutusai.coach`, not `www.brutusai.coach`) and 301 the other. GitHub Pages handles this if you set the CNAME correctly.
4. **For the 200+ programmatic landing pages: real differentiation per page or you'll trigger scaled-content abuse signals.** Each page must answer a specific objection with unique copy, examples, and ideally one piece of unique content (a quote, screenshot, mini case). Templated body with only a swapped headline = penalty bait. Roll out in waves of 20–30, monitor "Crawled - currently not indexed" rate in GSC.
5. **Add `width` and `height` attributes to every `<img>`** in the 5 HTML files. Free CLS win.
6. **Preload the hero image on `index.html` and `dna.html`.** `<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">` in `<head>`. Direct LCP improvement.

**Tier 2 — within the month:**

7. **Put Cloudflare (free plan) in front of GitHub Pages.** Adds Brotli, HTTP/3, edge caching, better TTFB globally, a real WAF, and DDoS protection. GitHub Pages alone has US-centric caching. Cloudflare also lets you set proper `Cache-Control` headers on HTML and add security headers (CSP, HSTS preload).
8. **HSTS preload** once Cloudflare is in: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` and submit to hstspreload.org.
9. **Convert images to WebP or AVIF.** PNG hero image is the easiest LCP regression. Use `<picture>` with WebP source + JPEG fallback.
10. **Defer non-critical JS** (analytics, any chat widget). Add `defer` to all `<script>` tags except inline critical scripts.
11. **Inline critical CSS** for above-the-fold styles on `index.html` and `dna.html`. Reduces render-blocking.
12. **Sitemap hygiene:** include only canonical, indexable, 200-status URLs. Drop `app.brutusai.coach` references entirely. When programmatic pages launch, segment them into their own sitemap (e.g., `sitemap-objections.xml`) referenced by a sitemap index — makes diagnostic in GSC much cleaner.

**Tier 3 — ongoing monitoring:**

13. **Weekly GSC checks:** Pages report (any new "Crawled - not indexed" growth?), Core Web Vitals (75th percentile per metric), Manual Actions (should always be empty), Performance (track INP and impressions/clicks weekly).
14. **URL Inspection** every newly published programmatic page → "Request Indexing." You get ~10/day, so spread launches accordingly.
15. **CrUX field data** likely won't appear for individual programmatic pages until they get traffic. Track origin-level CWV in GSC instead until then.
16. **Monitor Crawl Stats** (Settings → Crawl Stats). If avg response time creeps over ~300ms, GitHub Pages is the bottleneck — Cloudflare in front fixes it.

**Explicitly N/A for brutusai.coach:**
- AMP, news sitemaps, video sitemaps, Indexing API (none of the content qualifies), Change of Address tool, hreflang, Merchant/Shopping/Discover reports, crawl-delay tuning, log-file crawl analysis (too small to matter), URL Parameters tool (retired anyway).

**Folklore to ignore:**
- Domain age as a ranking factor (Google has explicitly debunked).
- Exact-match anchor text helping (it's neutral to mildly negative now).
- TLD-based ranking (`.com` vs `.coach`): no signal beyond ccTLD geo-targeting (which `.coach` is not).
- Bounce rate as a ranking signal (Google doesn't use GA data).
- Submitting to search engines (other than initial GSC verification) helps — pinging is dead.
- Disavow as a "preventive" tool — only use it after a manual action.

---

**Single biggest risk on the roadmap:** the planned 200+ programmatic objection-handling pages. Google's March 2024 spam update specifically targets "scaled content abuse" and the September 2023 Helpful Content update applies *site-wide signals*. If those pages are templated thin content, they can drag down the rankings of the 5 quality marketing pages too. Build the first 10 by hand, validate they index and rank, then scale only with the same per-page quality bar.
