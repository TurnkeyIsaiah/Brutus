# Brutus Article SEO System

This folder is the working spec for Brutus article SEO.

Objection handling is the first content lane, not the whole content strategy. The public library hub is now `/articles/`, with objection pages as one topic inside that broader article system.

The operating rule is simple:

- templates are allowed
- template fills are not

## What this system is for

Brutus should publish focused articles that answer real search queries from sales reps, with enough per-page originality that each page stands on its own.

Initial lane:

- objection handling

Future lanes:

- discovery and qualification
- live-call coaching
- follow-up and next steps
- Brutus feature articles
- tips and sales rep habits

This system is intentionally designed for:

- slow rollout
- high editorial control
- measurable uniqueness
- demand validation before publishing

It is not designed for "generate 200 pages and hope."

## Publish order

1. Keep the site-wide trust layer live:
   - Organization schema
   - policy/contact pages
   - stronger about page
2. Build one gold-standard article page manually.
3. Draft the first batch from the candidate slug file.
4. Run a uniqueness gate before publishing anything.
5. Publish 10-20 pages max in wave 1.
6. Watch GSC for 60 days before expanding.

## Files in this folder

- `page-schema.json`:
  the structured content shape each objection-handling page must satisfy
- `first-batch-candidates.json`:
  20 candidate slugs to validate against real demand before drafting
- `subagent-workflow.md`:
  how to safely use sub-agents for drafting and review
- `briefs/`:
  locked wave-1 briefs and status tracking
- `pages/`:
  JSON page payloads that satisfy `page-schema.json`
- `voice-references/`:
  Brutus voice source-of-truth extracted from the live marketing site

## Public hub

- Canonical article hub: `/articles/`
- Current live article URL pattern for objection pages: `/objections/{slug}.html`
- Legacy `/objections/` hub redirects to `/articles/`

## Hard rules

- Every page must target a real query with real demand.
- Every page must contain a unique intro, unique dialog, unique psychology section, unique counter-frames, and a unique "when to walk away" section.
- Do not publish any page pair above the similarity threshold.
- Do not publish in one massive batch.
- Do not let the CTA, FAQ, or conclusion become identical across the set.
- Every rendered article must include a Sales Rep DNA Test CTA as a lead-magnet path in the middle of the article.
- The bottom CTA should remain the article-specific direct Brutus signup CTA.
- Every article must be designed and reviewed mobile-first. Most discovery will happen on phones, so mobile readability, spacing, tap targets, CTA placement, and card stacking are approval requirements.
- **Every page must be written using the `article-writing` skill.** This applies to the main agent, every drafting sub-agent, and every review sub-agent. The skill is installed at `~/.claude/skills/article-writing/SKILL.md` and enforces concrete-first openings, banned filler patterns, and operator voice. Drafts written without the skill are rejected at review.
- House style overrides where the two conflict: no em dashes mid-sentence, no emojis. Both rules apply on top of the skill.

## Quality bar before publish

- useful even if Brutus disappeared from the page
- specific to its article topic, not generic sales advice
- written like a rep would bookmark it
- tied back to Brutus without turning into a landing-page ad
- clean on mobile before it is considered done
