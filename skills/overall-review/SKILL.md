---
name: overall-review
description: This skill should be used when the user asks to "review my changes", "do an overall review", "review this branch", "code review against main", or invokes "/overall-review" (optionally with a profile name like "/overall-review security", "/overall-review performance", "/overall-review bug-fix"). Interactively asks which base branch to compare against, picks a review profile (universal, bug-fix, feature, refactor, research, performance, security, migration, docs) either from an explicit argument or by auto-detecting from the diff, runs the matching reviewers in parallel, and outputs a single table of findings in the user's language. Does NOT modify code, does NOT commit, does NOT propose to apply fixes — review and report only.
version: 0.2.1
targets:
  - claude-code
  - codex
allowed-tools:
  - Bash
  - Read
  - Grep
  - Agent
tags: [git, review, quality]
---

# Overall Review — multi-perspective code review against a chosen base branch

You are running a code review on the changes in the current git branch against a base branch the user picks. Follow the seven steps below in order. Do not deviate, do not shortcut.

**Hard rules for the entire run:**
- Read-only with respect to code. Do not edit files, do not stage, do not commit, do not run formatters/linters/tests that mutate state.
- Report problems only — no positive observations, no "looks good" commentary, no offer to apply fixes.
- Final output is per-finding blocks plus ONE summary line, in the language of the user's most recent request (default English if unclear). Nothing else after the summary line.

---

## Step 1 — Collect base-branch candidates

Run the helper script bundled with this skill to get a JSON list of candidates:

```bash
bash "${SKILL_DIR:-$(dirname "$0")}/scripts/list-base-branches.sh"
```

If the helper is unavailable, derive candidates manually:

- `main` or `master`, if either ref exists locally or on `origin`
- Current upstream: `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null`
- 3–5 most-recently-committed local branches: `git for-each-ref --sort=-committerdate --count=5 --format='%(refname:short)' refs/heads/`
- Always include an explicit "enter manually" option.

De-duplicate the list and drop the current branch (you can't diff against yourself).

---

## Step 2 — Ask the user which base to use

- **In Claude Code:** call `AskUserQuestion` with the candidates as options.
- **In Codex / plain CLI:** print a numbered list and read the user's choice from stdin.

Pick whichever interaction model is available; do not assume one.

---

## Step 3 — Compute merge-base and collect branch context

```bash
BASE="<chosen-base>"
MERGE_BASE=$(git merge-base "$BASE" HEAD)
git diff --stat "$MERGE_BASE"...HEAD
git diff --name-only "$MERGE_BASE"...HEAD
git diff "$MERGE_BASE"...HEAD
git log "$MERGE_BASE"..HEAD --oneline
```

Keep the `--stat`, full diff, name-only list, and oneline log as **shared context** that every reviewer will receive in Step 5.

If `git merge-base` fails (unrelated histories) or the diff is empty, report this and stop — there is nothing to review.

If the full diff is very large, sample it for the reviewer briefings, but make sure every changed file is visible in `--stat` and that reviewers re-read the actual file at the location of each finding (Step 6).

---

## Step 4 — Pick a review profile

A "profile" is a fixed list of reviewers to run. See `references/profiles.md` for the full mapping table, auto-detect rules, and synonyms. Selection rule (hybrid: explicit argument wins, otherwise auto-detect):

1. **If the user passed a profile name as the argument** to `/overall-review` (for example `/overall-review security`, `/overall-review feature`, `/overall-review migration`), use that profile. Profile names are case-insensitive. Common synonyms: `bug`/`fix` → `bug-fix`, `perf` → `performance`, `sec` → `security`, `doc`/`docs` → `docs`. Full list in `references/profiles.md`.

2. **Otherwise, auto-detect from the diff** using the rules in `references/profiles.md` (ordered triggers based on changed paths, file types, and commit messages). Fallback: `universal`.

3. **Announce the chosen profile** before continuing. Print exactly one line in the user's language, e.g. `Profile: security — auth middleware changes detected`. Then proceed to Step 5.

---

## Step 5 — Run the reviewers for the selected profile

Read `references/profiles.md` to get the list of reviewers for the chosen profile. For each reviewer in that list, read `references/reviewers/<reviewer-name>.md` to get its prompt verbatim.

**Execution mode — pick one based on your runtime:**

- **Claude Code (sub-agent / Agent tool available):** launch **one sub-agent per reviewer in the profile, all in a single message, all in parallel** (multiple Agent tool calls in one assistant turn, `subagent_type=general-purpose`). Each sub-agent receives:
  - The shared branch context from Step 3 (full diff, `--stat`, file list, oneline log, chosen base, current branch).
  - The reviewer prompt verbatim from `references/reviewers/<reviewer>.md`.
  - Instruction to re-read changed files at finding locations before reporting (Read/Grep, not just diff).
  - Instruction to return findings only — no preamble, no closing remarks.

- **Codex CLI / plain chat (no sub-agent tool guaranteed):** Split the reviewers list into independent sub-agents and launch them in parallel — one reviewer per sub-agent. Each sub-agent gets one reviewer prompt plus the diff. If parallel sub-agent execution is not available in your runtime, run the reviewers sequentially in this context, switching lens cleanly between each: stop thinking about the previous reviewer's concerns, focus only on the current reviewer's prompt.

Either way: **do not mix concerns between reviewers**. The point of multi-perspective review is that each pass is narrow.

---

## Step 6 — Consolidate and verify

For every finding returned by every reviewer:

1. **Re-read the code at the cited location.** Pull at least 20–30 lines of surrounding context. Verify the issue is real and not a misreading of the diff.
2. **Discard false positives** — issues that don't exist, are already mitigated, or are working as intended.
3. **Deduplicate.** If two reviewers reported the same `file:line` and the same underlying issue, merge into one block. List both reviewer names comma-separated in the block header.
4. **Assign severity**, one of:
   - `critical` — production data loss, security breach, hard crash on common input, broken contract that ships.
   - `major` — wrong behavior in plausible cases, missing tests on a risky change, regression risk, performance cliff under realistic load.
   - `minor` — code smell with limited impact, missing-but-not-critical docs/log/metric, style of error handling.
   - `nit` — cosmetic, naming, light polish.

Pre-existing issues that a reviewer surfaced are still valid; include them. Do not invent issues to look thorough.

---

## Step 7 — Output the findings (this is the entire user-facing reply)

Output **only** the per-finding blocks followed by a single summary line. No preamble, no recap of what you did, no offer to apply fixes — just the blocks and the summary line. This format is intentional: it renders readably in both Markdown viewers (Claude Code) and plain-text terminals (Codex CLI), because markdown tables collapse into unreadable pipe-noise without a renderer.

**Language:** translate the field labels (`Issue`, `Fix`) and the summary line into the language of the user's most recent message. If the user's language is unclear, use English. File paths, code identifiers, severity names, and reviewer names stay verbatim.

**Block format** — one block per finding, blank line between blocks:

```
[<n>] <severity> · <reviewer> · <file:line>
    Issue: <one-line description of the problem>
    Fix:   <one-line description of the fix>
```

- `<n>` — 1-based finding number, sequential across the whole output.
- `<severity>` — one of `critical`, `major`, `minor`, `nit` (lowercase, verbatim).
- `<reviewer>` — reviewer name; if a finding was merged from multiple reviewers via dedup (Step 6), list them comma-separated (e.g. `quality, security-audit`).
- `<file:line>` — exact file path and line number, verbatim.
- Separator between header fields is the middle-dot character `·` (U+00B7), surrounded by single spaces.
- Indent `Issue:` and `Fix:` lines by 4 spaces. Pad `Fix:` with 3 spaces after the colon so the content column visually aligns with `Issue:` content.
- Keep Issue and Fix to one line each — condense long descriptions; do not wrap.

**Sort order:** `critical` → `major` → `minor` → `nit`. Within a severity bucket, sort alphabetically by reviewer name, then by file path. Numbering follows the final sorted order.

**Summary line** (after the last block, separated by a blank line, in the user's language):

> `<N> issues across <M> reviewers — profile: <profile-name>`

If zero issues, skip the blocks entirely and output only:

> `No issues found — profile: <profile-name>`

That's the whole response. Stop after the summary line.

---

## Bundled resources

- `scripts/list-base-branches.sh` — emits JSON of candidate base branches (Step 1)
- `references/profiles.md` — 9 profiles → reviewers mapping, auto-detect rules, synonyms (Step 4)
- `references/reviewers/<name>.md` — 16 reviewer prompts, one per file (Step 5)
