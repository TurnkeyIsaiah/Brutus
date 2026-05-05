# Brutus Handoff Protocol

Both Claude and Codex work on this repo. To prevent overlap, lost work, or contradicting changes, every session follows the same logging protocol.

## The rule

**After every completed task, append an entry to today's handoff doc at `docs/handoffs/YYYY-MM-DD.md`.**

Triggers:
- File created, edited, or deleted
- Commit pushed (or explicitly held)
- Decision recorded (e.g., "we are going with X over Y")
- Scaffold created (e.g., "added /articles/ hub")

Skip:
- Trivial conversational answers
- Scans/reads with no resulting change

## On a new day

If today's handoff file does not exist, create it. Use the template below. Do not retroactively split entries across days.

## At the start of every session

1. Read the most recent handoff file in `docs/handoffs/` cover-to-cover.
2. Read any open follow-up items at the bottom.
3. Then start work.

This is non-optional. Both Claude and Codex hit usage limits and the user has had to switch mid-flow more than once. The handoff is how the other agent picks up cleanly.

## File template

```markdown
# Handoff — YYYY-MM-DD

## Open items at end of day
- (filled in at end of session)

## Log

### HH:MM — agent — task title
**Touched:** path/to/file1, path/to/file2
**What happened:** 1–3 sentences.
**Decisions:** any choice that future sessions need to know about.
**Next:** what is queued or unblocked.

### HH:MM — agent — task title
...
```

## Memory vs handoff

These are two different layers:

- **Handoff (`docs/handoffs/YYYY-MM-DD.md`):** chronological. Day-specific. Lives in the repo so both agents read/write the same file. Captures *what happened today*.
- **Memory (Claude's `~/.claude/projects/C--Users-isaia/memory/` and Codex's `.codex/memories/`):** semantic. Topical. Each agent has its own. Captures *durable context* — decisions, architecture, conventions, user preferences.

Log to both at completion time. Don't skip one for the other.

## Naming

- Handoff files: `YYYY-MM-DD.md` (e.g., `2026-05-05.md`)
- One file per calendar day. Multiple agents append to the same file.
- If you cross midnight during a single task, finish the task, log it under the day it completed.

## Agents

- `claude` — Claude Code (Anthropic)
- `codex` — Codex (OpenAI)

Use these exact strings in the agent field.
