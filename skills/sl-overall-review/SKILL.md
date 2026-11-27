---
name: sl-overall-review
description: This skill should be used when the user asks to "review my changes", "do an overall review", "review this branch", "code review against main", "review this skill", "review my SKILL.md", or invokes "/sl-overall-review" (optionally with a profile name like "/sl-overall-review security", "/sl-overall-review performance", "/sl-overall-review bug-fix", "/sl-overall-review skill"). Interactively asks which base branch to compare against, picks a review profile (universal, bug-fix, feature, refactor, research, performance, security, migration, algorithm, messaging, skill, docs) either from an explicit argument or by auto-detecting from the diff, runs the matching reviewers in parallel, and prints a Markdown report in the user's language — the merge verdict first, a plain-language summary of what changed, an overview table of the findings, then each finding (bug or improvement) as intended / actually / why it matters / fix. The `skill` profile reviews prompt artifacts themselves — SKILL.md and its bundle, subagent and slash-command definitions, CLAUDE.md — against context-engineering principles for Claude 5 generation models. Does NOT modify code or commit — review and report only.
version: 0.9.0
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
- Findings are problems only — no positive observations about individual spots, no "looks good" commentary. The report's "What changed" block describes the change neutrally; its closing sentence may say whether the change achieves its goal at its core. Nothing else describes the change as a whole.
- Never apply fixes in this run. The report's last line is a one-line hint of what the user can reply to get findings fixed — that is the only mention of fixing. If the user later sends that reply, it is a new request outside this run.
- Final output is the report in the Step 7 layout, in the language of the user's most recent request (default English if unclear). Nothing after the final hint line.

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
git diff --shortstat "$MERGE_BASE"...HEAD
git diff --name-only "$MERGE_BASE"...HEAD
git diff "$MERGE_BASE"...HEAD
git log "$MERGE_BASE"..HEAD --oneline
```

Keep the `--stat`, full diff, name-only list, and oneline log as **shared context** that every reviewer will receive in Step 5. Keep the `--shortstat` numbers for the report's stats line (Step 7).

If `git merge-base` fails (unrelated histories) or the diff is empty, report this and stop — there is nothing to review.

If the full diff is very large, sample it for the reviewer briefings, but make sure every changed file is visible in `--stat` and that reviewers re-read the actual file at the location of each finding (Step 6).

**Understand the change before anyone reviews it.** From the commit messages, the branch name and the diff itself, write down for yourself the "What changed" text of the report (Step 7): two or three sentences on how things were before and what is different now — in plain words for someone who has not seen the code.

This understanding is also where every finding's `intended` line comes from (Step 6). Do **not** pass it to the reviewers: it is your interpretation, and handing it over would anchor the lenses that must judge the diff against the stated task on their own (`scope-creep`, `implementation`).

---

## Step 4 — Pick a review profile

A "profile" is a fixed list of reviewers to run. See `references/profiles.md` for the full mapping table, auto-detect rules, and synonyms. Selection rule (hybrid: explicit argument wins, otherwise auto-detect):

1. **If the user passed a profile name as the argument** to `/sl-overall-review` (for example `/sl-overall-review security`, `/sl-overall-review feature`, `/sl-overall-review migration`), use that profile. Profile names are case-insensitive. Common synonyms: `bug`/`fix` → `bug-fix`, `perf` → `performance`, `sec` → `security`, `doc`/`docs` → `docs`. Full list in `references/profiles.md`.

2. **Otherwise, auto-detect from the diff** using the rules in `references/profiles.md` (ordered triggers based on changed paths, file types, and commit messages). Fallback: `universal`.

3. **Apply add-on reviewers.** After the base profile is chosen (whether explicit or auto-detected), consult the **Add-on reviewers** section of `references/profiles.md` and append any matching add-on reviewer(s) to the profile's reviewer list — do not drop any base reviewer. The most common case: a diff that contains a schema/SQL migration but is mostly application code keeps its base profile and gains the `migration-safety` reviewer (so `*.sql` no longer collapses the whole review into the `migration` profile).

4. **Announce the chosen profile** before continuing. Print exactly one line in the user's language, e.g. `Profile: security — auth middleware changes detected`. If add-on reviewers were applied, name them with a `+`, e.g. `Profile: feature + migration-safety — new endpoint with a schema migration`. Then proceed to Step 5.

---

## Step 5 — Run the reviewers for the selected profile

Read `references/profiles.md` to get the list of reviewers for the chosen profile, plus any add-on reviewers selected in Step 4. For each reviewer in that combined list, read `references/reviewers/<reviewer-name>.md` to get its prompt verbatim.

If a reviewer prompt tells the reviewer to read a sibling reference file (the `skill` profile's reviewers all point at `references/prompt-principles.md`), read that file too and pass its content to the sub-agent verbatim alongside the reviewer prompt — the sub-agent may not be able to resolve the path itself.

**Execution mode — pick one based on your runtime:**

- **Claude Code (sub-agent / Agent tool available):** launch **one sub-agent per reviewer in the profile, all in a single message, all in parallel** (multiple Agent tool calls in one assistant turn, `subagent_type=general-purpose`). Each sub-agent receives:
  - The shared branch context from Step 3 (full diff, `--stat`, file list, oneline log, chosen base, current branch).
  - The reviewer prompt verbatim from `references/reviewers/<reviewer>.md`.
  - Instruction to re-read changed files at finding locations before reporting (Read/Grep, not just diff).
  - Instruction to give, for every finding, a concrete triggering scenario — realistic input → steps → the consequence a user or the system sees — in addition to the fields the reviewer prompt asks for.
  - Instruction to return findings only — no preamble, no closing remarks.

- **Codex CLI / plain chat (no sub-agent tool guaranteed):** Split the reviewers list into independent sub-agents and launch them in parallel — one reviewer per sub-agent. Each sub-agent gets one reviewer prompt plus the diff, and the same scenario instruction. If parallel sub-agent execution is not available in your runtime, run the reviewers sequentially in this context, switching lens cleanly between each: stop thinking about the previous reviewer's concerns, focus only on the current reviewer's prompt.

Either way: **do not mix concerns between reviewers**. The point of multi-perspective review is that each pass is narrow.

---

## Step 6 — Consolidate and verify

For every finding returned by every reviewer:

1. **Re-read the code at the cited location.** Pull at least 20–30 lines of surrounding context. Verify the issue is real and not a misreading of the diff.
2. **Discard false positives** — issues that don't exist, are already mitigated, or are working as intended.
3. **Deduplicate.** If two reviewers reported the same `file:line` and the same underlying issue, merge into one finding and keep both reviewer names, comma-separated.
4. **Assign severity**, one of three:
   - `blocker` — the merge must wait: production data loss, security breach, hard crash on common input, broken contract that ships.
   - `should fix` — wrong behavior in plausible cases, missing tests on a risky change, regression risk, performance cliff under realistic load, lock-contending migration DDL on an existing table (index build, `ALTER`, constraint/type change) that can block concurrent traffic — excluding new-table creation.
   - `optional` — code smell with limited impact, missing-but-not-critical docs/log/metric, style of error handling, cosmetic issues, naming, light polish.
5. **Assign a category**, one of two:
   - **bug** — in some realistic scenario the code does something wrong or unsafe: incorrect result, lost or leaked data, crash, broken contract, regression.
   - **improvement** — the code does what it should, but could be better: performance, readability, tests, docs, dead code, simplification.

   Only a bug can be a `blocker` — an "improvement" that would block the merge is really a bug.
6. **Rewrite each finding into what the report shows** (Step 7) — a title, a gist, and four fields of one or two short sentences each:
   - title — the problem in one short phrase, for the finding's heading.
   - gist — the same in three to five words, for the overview table.
   - `intended` — what the change set out to do at this spot, from your Step 3 understanding. For a pre-existing issue, the behavior that is expected here.
   - `actually` — what the code really does, from the reviewer's issue description, corrected by your re-read.
   - `why it matters` — what this leads to, shown on one concrete case built from the reviewer's impact and scenario and your re-read of the code: a realistic input and the consequence a user or the system sees. For an improvement, the realistic situation where it bites (load, a later edit, a regression nobody catches).
   - `fix` — one concrete action that can be carried out right away, not a wish: the reviewer's fix, condensed.

   Write for someone who has not seen the code. Use a code identifier only where it helps, in parentheses after the plain word — "the token we present to the client's server (the `Authorization` header)".

Pre-existing issues that a reviewer surfaced are still valid; include them. Do not invent issues to look thorough.

---

## Step 7 — Output the report (this is the entire user-facing reply)

Output **only** the report below, as standard Markdown and not inside a code fence — the table and the headings have to render, and both Claude Code and Codex CLI render them. No preamble, no recap of what you did, nothing after the final hint line.

**Template** (English labels; translate them — see **Language** below):

```
**<Verdict>.** <how many blockers, and their IDs>

**What changed**

<2–3 sentences in plain language: how it was before and what is different now.>

`<branch> → <base>` · <N> files · +<added> −<deleted>

| ID | Severity | Reviewer | Where | Summary |
|----|----------|----------|-------|---------|
| B1 | blocker | <reviewer> | `<file:line>` | <the gist in 3–5 words> |

---

### <ID> · <Finding title> · <severity>
`<path/to/file:line>` · <reviewer>

- **Intended:** <what the change was trying to do>
- **Actually:** <what really came out>
- **Why it matters:** <what it leads to, on a concrete example>
- **Fix:** <one concrete action>

---

<One sentence: is the task solved at its core, and what stands in the way.>
To fix, reply: `fix <ID>`
```

**Rules:**

1. **The verdict is always the first line:** "Don't merge" or "OK to merge", then the number of blockers and their IDs. With no blockers, say so: "No blockers".
2. **"What changed"** has no jargon and no file names — written so that someone who has not seen the code understands it.
3. **IDs:** bugs are `B1`, `B2`, …; improvements are `I1`, `I2`, …; each type is numbered on its own. The letters `B`/`I` stay Latin in every language.
4. **Severity** is one of three values: `blocker`, `should fix`, `optional` (Step 6). Findings go in that order both in the table and below it; within one severity, bugs before improvements, then by file path. Numbering follows that final order.
5. **The table is an overview only:** at most five words in "Summary", and "Where" is the file name and line without the directory path. Details belong in the finding itself.
6. **A finding always has the four bullets** in the same order: Intended, Actually, Why it matters, Fix. One or two short sentences each.
7. **"Fix"** is an action that can be carried out right away, not a wish.
8. **No emoji, no all-caps, no numbered sections.** Emphasis only with bold and `code`.
9. **File names, versions, commands and the reply phrase** are formatted as `code`.
10. **With no findings,** output only the verdict, the "What changed" block with its stats line, and the closing sentence — no table, no `---` rules, no hint line.

**Details the template leaves open:**

- **Stats line** — branch, base, file count and `+/−` from `--shortstat` (Step 3).
- **Location** — the line under a finding's heading carries the full file path and line number. For a missing test, cite the untested code's `file:line`.
- **Reviewer** — a finding merged from several reviewers (Step 6) lists all their names, comma-separated, in the table and under the heading.
- **Rules** — one `---` after the table and one after the last finding; none between findings.
- **Hint** — the last line lists the blocker IDs (`fix B1 B3`); if there are none, the `should fix` IDs; if there are none either, the remaining IDs.

**Contract.** `sl-gitlab-review-comments` parses the findings by their structure, so keep exactly: the heading `### <ID> · <title> · <severity>`, the location line directly under it, and the four bullets in that order, each opening with a bold label.

**Language.** Translate every label and fixed phrase — the verdict, "What changed", the table header, the severity values, the bullet labels, the hint — into the language of the user's most recent message (English if unclear). File paths, code identifiers, reviewer names (`quality`, `security-audit`) and the IDs stay verbatim.

That's the whole response. Stop after the hint line (or after the closing sentence when there are no findings).

---

## Bundled resources

- `scripts/list-base-branches.sh` — emits JSON of candidate base branches (Step 1)
- `references/profiles.md` — 12 profiles → reviewers mapping, auto-detect rules, synonyms (Step 4)
- `references/reviewers/<name>.md` — 25 reviewer prompts, one per file (Step 5)
- `references/prompt-principles.md` — shared context-engineering principles the `skill` profile's reviewers grade against (Step 5)
