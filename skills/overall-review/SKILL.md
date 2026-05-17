---
name: overall-review
description: This skill should be used when the user asks to "review my changes", "do an overall review", "review this branch", or "code review against main". Interactively asks which base branch to compare against (offers candidates from main/master, upstream, and recent local branches) and then performs a structured code review of the diff.
version: 0.1.0
targets:
  - claude-code
  - codex
allowed-tools:
  - Bash
  - Read
  - Grep
tags: [git, review, quality]
---

# Overall Review

Performs an end-to-end code review of the changes on the current branch against
a base branch the user picks. This skill does **not** modify code — it produces
a structured review report.

## Workflow

### 1. Collect base-branch candidates

Run the helper script bundled with this skill to get a JSON list of candidates:

```bash
bash "${SKILL_DIR:-$(dirname "$0")}/scripts/list-base-branches.sh"
```

If the helper is unavailable, derive candidates manually:

- `main` or `master`, if either ref exists locally or on `origin`
- Current upstream: `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null`
- 3–5 most-recently-committed local branches:
  `git for-each-ref --sort=-committerdate --count=5 --format='%(refname:short)' refs/heads/`
- Always include an explicit "enter manually" option.

De-duplicate the list and drop the current branch (you can't diff against
yourself).

### 2. Ask the user which base to use

- **In Claude Code:** call `AskUserQuestion` with the candidates as options.
- **In Codex / plain CLI:** print a numbered list and read the user's choice
  from stdin.

Pick whichever interaction model is available; do not assume one.

### 3. Compute merge-base and diff

```bash
BASE="<chosen-base>"
MERGE_BASE=$(git merge-base "$BASE" HEAD)
git diff --stat "$MERGE_BASE"...HEAD
git diff --name-only "$MERGE_BASE"...HEAD
```

If `git merge-base` fails (unrelated histories), report this and stop — ask the
user how to proceed.

### 4. Read changes and review

Use Read/Grep to open each changed file and inspect the diff. Walk the checklist
at `references/review-checklist.md`:

- Correctness and logic
- Security (OWASP top-10 — injection, auth, secrets in code, unsafe deserialization)
- Tests (do they exist, do they cover the change, are they meaningful)
- Readability, naming, comments
- Performance and edge cases
- Compatibility / migrations / backwards compatibility, if applicable

For large diffs (>30 files), focus on:
1. New files first
2. Files with the most line changes
3. Files matching security-sensitive paths (`auth*`, `*crypto*`, `*secret*`,
   migrations, configs)

### 5. Produce the report

Output exactly these sections, in this order:

```
## Summary
<2–4 sentence overview of what the branch does>

## Blocking issues
<numbered list — bugs, security issues, broken tests. Empty if none.>

## Suggestions
<numbered list — nice-to-have improvements. Empty if none.>

## Questions for the author
<numbered list — points that need clarification before merging.>
```

**Do not** edit files unless the user explicitly asks for fixes afterwards.
**Do not** run tests unless the user asks — this is a review, not a CI run.

## Bundled resources

- `scripts/list-base-branches.sh` — emits JSON of candidate base branches
- `references/review-checklist.md` — full checklist used in step 4
