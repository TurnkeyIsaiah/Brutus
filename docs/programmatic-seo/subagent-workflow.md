# Sub-Agent Workflow For Programmatic SEO

This workflow exists to make sub-agents useful without letting them mass-produce near-duplicate pages.

## Principle

Do not ask a sub-agent to "write an article."

Ask it to draft one page from a locked brief.

## Mandatory skill

Every drafting sub-agent and every review sub-agent must invoke the `article-writing` skill before producing any output. This is non-optional.

- Skill location: `~/.claude/skills/article-writing/SKILL.md`
- The skill enforces: concrete-first openings, no filler transitions ("Moreover", "Furthermore"), no hype phrases ("game-changer", "cutting-edge"), no generic landscape intros, no fabricated stats or biographical claims.
- House style sits on top of the skill: no em dashes mid-sentence, no emojis.
- Drafts that read templated, hype-y, or generic are rejected on first review even if the brief was followed.

The main agent must include the skill invocation in the sub-agent prompt. Do not assume the sub-agent will pick it up on its own.

## Mandatory SEO playbook reference

Every drafting and review sub-agent must also read the Brutus SEO playbook at `docs/seo/playbook.md` before producing any output. The playbook governs:

- per-page programmatic-content requirements (uniqueness, word range, sibling links, byline, schemas)
- the ≥70% similarity rejection bar
- the hard "do not" list (no `HowTo` schema, no fake `aggregateRating`, no LCP lazy-load, no writing to a word count target, etc.)
- title format conventions and meta-description targets
- the technical reference at `docs/seo/technical.md` and the content reference at `docs/seo/content.md`

Drafts that violate the playbook (e.g., near-duplicate intros across the batch, deprecated schema types, missing canonical, missing sibling links) are rejected at review.

## Mandatory voice reference

The skill calls for voice examples. Ours live at `voice-references/brutus-voice.md`. Every draft must mirror that voice. The reference covers:

- the all-lowercase headings convention (including H1)
- the signature setup-then-payoff fragment pattern
- the negation-framing move
- the callout-list move
- the sting-then-promise closer
- a banned-phrases list specific to Brutus

Drafts that ignore the voice reference are rejected even if the article-writing skill's generic banned-pattern check passes. The two checks stack.

## Main agent responsibilities

The main agent owns:

- slug selection
- demand validation
- page brief creation
- template enforcement
- related-link plan
- similarity checks
- publish approval

Sub-agents are drafting workers, not the editorial system.

## Recommended pipeline

1. Main agent validates demand for a candidate slug.
2. Main agent creates a page brief with:
   - target query
   - objection phrase
   - unique angle
   - required psychology angle
   - required example-dialog context
   - required Brutus tie-in
   - sibling links
   - CTA variant
   - FAQ constraints
3. Draft worker writes the page payload to the JSON schema.
4. Review worker checks:
   - objection specificity
   - generic filler
   - repetitive framing
   - CTA sameness
   - FAQ sameness
   - whether the page is useful without Brutus
   - whether the draft forces a fixed-count explanation when the objection actually has more or fewer real meanings
   - whether the correction section explains what to do instead, not just what not to do
5. Main agent runs similarity checks against the batch.
6. Only approved pages get rendered to HTML.

## Draft brief requirements

Every brief should include:

- the exact target query
- the exact objection wording
- what makes this page different from the closest sibling
- one required example scenario
- a required meaning map that lists every real interpretation the objection has on the page, with no forced count
- one required "when to walk away" condition
- one Brutus-specific coaching moment
- 3-5 related pages it should link to

## Rejection rules

Reject the draft if any of these are true:

- intro could fit 10 other objection pages
- example dialog is generic and not tied to the objection
- psychology section says nothing specific
- counter-frames sound interchangeable with other pages
- CTA is copy-pasted from another page
- FAQ questions are recycled boilerplate
- the page reads like a product ad more than a help page
- the draft uses a fixed 3-part structure even though the objection clearly has a different number of real meanings
- the draft contains any banned pattern from the article-writing skill (generic landscape openings, filler transitions, hype phrases, unsourced biographical claims)
- the draft contains em dashes mid-sentence
- the draft contains emojis
- the rendered article has not been checked for mobile readability, spacing, tap targets, CTA placement, and card stacking

## Similarity gate

Before publish:

- compare each draft to the rest of the batch
- reject any pair above the agreed similarity threshold
- force rewrite of the intro, dialog, psychology, and mistakes sections first

## Rollout rule

- batch 1: 10-20 pages
- wait for indexation and GSC signals
- only then expand
