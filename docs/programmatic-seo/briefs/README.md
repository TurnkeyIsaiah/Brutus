# Wave 1 Briefs

Locked briefs for the first 5 objection pages. Status tracked here.

## Wave 1

| # | Slug | Angle | Status |
|---|---|---|---|
| 1 | [too-expensive](./too-expensive.md) | "Too expensive" is rarely just about price. Diagnose the real meaning before you respond. | published |
| 2 | [not-interested](./not-interested.md) | A reflex inside the first 15 seconds, not a position. Pattern-interrupt, do not overcome. | published |
| 3 | [send-me-information](./send-me-information.md) | The most-rationalized loss in sales. They didn't say no, but they said no. | published |
| 4 | [need-to-think-about-it](./need-to-think-about-it.md) | Never about thinking. It is price, authority, or trust. Diagnose before responding. | published |
| 5 | [no-budget](./no-budget.md) | In B2B, "no budget" is usually an authority objection in disguise. | published |

## Status values
- `briefed`: brief locked, not yet drafted
- `drafted`: page payload written to JSON schema
- `reviewed`: passed review-worker checks
- `approved`: passed similarity gate, cleared for HTML render
- `published`: live on website

## Style rules for every page
- **The `article-writing` skill is required for every draft.** Skill location: `~/.claude/skills/article-writing/SKILL.md`. Both the main agent (when hand-writing the gold-standard) and every drafting/review sub-agent must invoke the skill before producing output. See `../subagent-workflow.md` for the full rule.
- **Voice reference is required.** All drafts must mirror `../voice-references/brutus-voice.md` (extracted from the live marketing site). Lowercase headings, short fragments, negation framing, sting-then-promise closes. Voice mismatch fails review even if structure is fine.
- **SEO playbook is required.** All drafts must follow `../../seo/playbook.md` for per-page programmatic-content requirements, similarity threshold, schema rules, and the do-not list. The technical and content references at `../../seo/technical.md` and `../../seo/content.md` are authoritative for schema, canonicals, titles, and meta descriptions.
- No em dashes mid-sentence. Use periods or rephrase.
- No emojis anywhere.
- No CTA copy reused across pages. Each page gets its own CTA variant locked in its brief.
- Every rendered article should include the Sales Rep DNA Test CTA as a mid-article lead-magnet path. Keep the bottom CTA as the article-specific Brutus signup CTA.
- Every rendered article must pass mobile-first review. Mobile layout is the primary presentation target.
- Author byline: **Isaiah Rios, founder of Brutus AI**. Rendered as `Person` JSON-LD on every article (with `worksFor` Brutus AI) and as a visible byline below the H1, linking to `/about.html`. Person schema is the primary E-E-A-T signal per `../../seo/playbook.md`.

## Parent hub
All five pages link back to the parent article hub at `/articles/`. Objection handling is one category inside the broader article library, not the whole library.
