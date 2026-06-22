---
name: deepen-architecture
description: This skill should be used when the user asks to "improve my architecture", "improve the codebase architecture", "deepen the modules", "reduce complexity", "find shallow modules", "suggest architecture improvements", or invokes "/deepen-architecture" (optionally with a scope path and/or an output mode, e.g. "/deepen-architecture html src/payments" or "/deepen-architecture text"). Studies the resting codebase — reading its context docs (CLAUDE.md, ARCHITECTURE.md, README, ADRs) and, when available, using LSP or a JetBrains/IDE MCP to resolve symbols and usages — then proposes up to 3–4 high-leverage architecture improvements grounded in deep-module design (locality and leverage), ranked by strength. Delivers them either as a self-contained HTML proposal report (cards with Files / Problem / Solution / Benefits / Before-After SVG diagram / strength badge) saved to .skillsland/deepen-architecture/, or as a plain-text proposal printed in the chat with ASCII Before/After diagrams — the user's choice. Read-only on code: it proposes and documents — it does NOT edit, refactor, or commit. Use it before starting an architecture effort, not to perform one.
version: 0.1.0
targets:
  - claude-code
  - codex
allowed-tools:
  - Bash
  - Read
  - Grep
  - Agent
  - AskUserQuestion
  - LSP
tags: [architecture, design, refactoring, quality, report]
---

# Deepen Architecture — propose high-leverage structural improvements for a codebase

You study the **resting state** of a repository and produce an up-front **proposal document**:
up to 3–4 high-leverage architecture improvements, grounded in *A Philosophy of Software
Design* (deep vs. shallow modules; complexity = change-amplification + cognitive-load +
unknown-unknowns; locality & leverage). Follow the seven steps in order.

**Hard rules for the entire run:**
- **Read-only with respect to code.** Do not edit, stage, commit, or run anything that mutates
  the repo. There is no `Write` tool here on purpose. In **HTML mode** the only writes are inside
  `.skillsland/` (a self-ignoring scratch dir): the report, its `latest.html` copy, the
  candidates `<date>.json`, and a `.gitignore`, all created via `Bash` + the render script. In
  **text mode** there are no writes at all.
- **You propose, you do not implement.** This is the plan you save *before* an architecture
  effort. Refactoring is a separate, later, human action. Say so; the report header does too.
- **Target up to 3–4 candidates, ranked. Never pad to a quota.** If fewer real candidates
  survive verification, report only those (the output may even be empty-state). A short honest
  report beats a padded one.
- Final reply respects the chosen output mode (Step 7), in the language of the user's most
  recent message (default English). No markdown tables.

This is the resting-state counterpart to `/overall-review` (which reviews a *diff*). Same DNA —
read-only, parallel lenses, structured JSON → script handoff, no silent truncation — different
time-axis and a durable artifact.

---

## Step 1 — Resolve output mode, scope, and gather context

**Output mode** (HTML vs text). Explicit argument wins: an arg `html` or `text` (in any order
with a scope path) selects it directly. Otherwise ask:
- **Claude Code:** call `AskUserQuestion` — "HTML report saved to `.skillsland/`" vs "Text + ASCII printed here".
- **Codex / plain CLI:** print the two options as a numbered list and read the choice from stdin.
- If unanswered: default to **text** in a plain terminal / Codex, **HTML** in Claude Code.

**Scope.** A path argument (`/deepen-architecture src/payments`) restricts the study to that
subtree; otherwise the whole repo. Run the context collector:

```bash
node "${SKILL_DIR:-$(dirname "$0")}/scripts/collect-context.mjs" [scope]
```

It emits a JSON object (schema in `references/report-format.md`): `gitAvailable`, `repoRoot`,
`scope`, `summary{sourceFiles, topLevelDirs}`, `docsRead`, `signals{churnHotspots,
coChangeClusters, largestFiles, languages, topDirs}`, `warnings`. It degrades gracefully
(non-git → no churn/co-change, analysis still runs). If the script is unavailable, derive the
same signals manually with `git log`/`git ls-files`.

If no scope was given **and** the repo is large (`summary.sourceFiles > ~400` or
`summary.topLevelDirs > ~12`), offer to narrow the scope (same Claude/Codex split as above);
default to whole repo if no answer.

**Read the discovered context docs** (`docsRead`: CLAUDE.md, ARCHITECTURE*, README*, ADRs).
They tell you the *intended* architecture and conventions — infer the existing structure before
proposing changes, and cite it. The collect-context JSON is the **bounded shared context** every
lens receives in Step 3 (there is no diff to bound them).

---

## Step 2 — Optional deep study (LSP / IDE MCP), only when needed

To resolve fan-in / usages / leak points for the areas the Step-1 signals point at, use richer
tooling if it's connected. **Detect by scanning available tool names — do not hardcode:**
- **LSP**: a tool whose name contains `references` / `definition` / `symbol` / `diagnostics`.
- **JetBrains / IDE MCP**: a tool whose name contains `usages` / `find_usages` / `symbol`.

Cascade **LSP → IDE MCP → Grep/Read**. Use it **bounded** to candidate areas, not a full crawl.
It is **quality-gated, not just availability-gated**: if LSP/MCP is present but returns nothing
for a symbol, fall back to Grep rather than reporting "0 callers / unused" (a false
shallow/dead signal). Record which path you used as `tooling.deepStudy`
(`"lsp"`/`"ide-mcp"`/`"grep"`/`"none"`). In Codex or when nothing is connected, Grep/Read is the
fully-functional default.

---

## Step 3 — Analyze through the lenses

Read `references/design-principles.md` (shared vocabulary + strength rubric), then run the six
lenses. Each lens prompt is a file under `references/lenses/`:

`shallow-modules`, `pass-through-and-layers`, `information-leakage`, `change-amplification`,
`special-case-creep`, `temporal-decomposition`.

**Execution mode — pick one based on your runtime:**
- **Claude Code (Agent tool available):** launch **one sub-agent per lens, all in a single
  message, all in parallel** (`subagent_type=general-purpose`). Each sub-agent receives: the
  collect-context JSON, any Step-2 findings, `references/design-principles.md`, and the lens
  prompt verbatim from `references/lenses/<name>.md`; with instruction to Read/Grep **only within
  the candidate areas the signals point to** (budget ≤ ~15 files per lens) and to return
  candidate problems only — no preamble.
- **Codex / plain chat:** split the lenses into parallel sub-agents if available; otherwise run
  them sequentially in this context, switching lens cleanly between each (drop the previous
  lens's concerns entirely before starting the next).

Each lens returns 0..N candidates with: involved `files`, the friction + concrete evidence, and
an `estimate{leverage, reach, confidence, risk}`. Do not mix concerns between lenses — the point
of multi-lens analysis is that each pass is narrow. Honor each lens's boundary statement.

---

## Step 4 — Consolidate, verify, rank, select

1. **Re-read the cited code** for every candidate (20–30 lines of context, plus a couple of call
   sites). Discard misreads and anything already mitigated. **A candidate whose code you could
   not re-read and verify cannot be Strong** — cap it at Speculative.
2. **Dedup across lenses.** If two lenses surfaced the same underlying structure, merge into one
   candidate and list both lens names in `lenses[]`. Use the boundary statements to decide the
   rightful owner.
3. **Rank** by `score = leverage * reach * confidence - 0.5 * risk` (see the rubric). Keep the
   top **≤4**; put the rest in `dropped[]` with a one-line reason each — **never silently drop**.
4. **Design it twice.** For each kept candidate, sketch a second approach and record why the
   proposed one wins → `alternativeConsidered`. (Required for a Strong badge.)
5. Assign each `strength` badge (Strong / Worth exploring / Speculative) per the rubric.

---

## Step 5 — Build the candidates JSON

Assemble one document conforming to `references/report-format.md`. Set `schemaVersion: 1`,
`repo` (basename of `repoRoot`), `generatedAt` (the run timestamp), `scope`, `tooling`, and copy
`context` (`docsRead` + `signals`) and `gitAvailable` straight from the collect-context output.
For each kept candidate fill `id`, `title`, `strength`, `files`, `problem`, `solution`
(+`alternativeConsidered`, `principle`), `benefits{locality, leverage, tests}`, `lenses`,
`estimate`, and the `diagram{before, after}` depth-spec (before = shallow: high `interface`, low
`depth`, with `leaks`/`callers`; after = deep: low `interface`, high `depth`, `leaks: 0`). Put
the dropped ones in `dropped[]`.

---

## Step 6 — Render (branches on output mode)

**HTML mode** (writes go through `Bash`, never the agent):

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
RUN=$(date -u +%Y-%m-%d_%H%M%S)                       # no colons — Windows-safe; BSD & GNU date agree
DIR="$ROOT/.skillsland/deepen-architecture"
mkdir -p "$DIR"
[ -f "$ROOT/.skillsland/.gitignore" ] || printf '*\n' > "$ROOT/.skillsland/.gitignore"   # self-ignore; only if absent
# write the candidates JSON yourself to "$DIR/$RUN.json" (durable, avoids heredoc escaping),
# then render:
node "${SKILL_DIR:-$(dirname "$0")}/scripts/render-report.mjs" --format html "$DIR/$RUN.json" "$DIR/$RUN.html"
```

The render script validates the JSON, refuses any output path outside
`.skillsland/deepen-architecture/`, writes `$RUN.html` atomically (temp → rename), copies it to
`latest.html`, and prints the filename. Announce the target one line before writing. If
validation, path-containment, or the write fails, **stop and report** — do not claim a report
that wasn't written.

**Text mode** (zero writes): pipe the candidates JSON to the renderer on stdin via a **quoted**
heredoc (no shell expansion — safe for code snippets):

```bash
node "${SKILL_DIR:-$(dirname "$0")}/scripts/render-report.mjs" --format text <<'JSON'
{ ...the candidates JSON... }
JSON
```

It prints the full proposal (plain blocks + ASCII Before/After diagrams) to stdout. Nothing
touches the repo.

---

## Step 7 — Deliver (the entire user-facing reply)

**HTML mode** — print a compact recap (block format in `references/report-format.md`), then the
report path:

```
[1] Strong · src/config/loader.ts, src/config/resolver.ts (3 files)
    Problem:  <one line>
    Solution: <one line>
    Leverage: <one line — locality/leverage + the test win>
```

Follow with `Dropped (lower leverage): …` (if any), `Report: .skillsland/deepen-architecture/<date>.html (+ latest.html)`, and `N candidates — scope: <scope>`.

**Text mode** — relay the renderer's full stdout (it already ends with the
`N candidates — scope: <scope>` line). Add nothing after it.

Both modes: translate the labels into the user's language; keep file paths, code identifiers,
and strength names verbatim. If there are zero candidates, say
`No high-leverage restructuring found — scope: <scope>` (HTML mode still points at the report).
Stop after the final line — no offer to apply the changes (that's not this skill's job).

---

## Bundled resources

- `scripts/collect-context.mjs` — emits repo-context + signals JSON (Step 1).
- `scripts/render-report.mjs` — `--format html` (file + SVG) or `--format text` (stdout + ASCII) (Step 6).
- `references/design-principles.md` — APoSD vocabulary, locality/leverage framing, strength rubric, scope exclusions.
- `references/report-format.md` — the candidates-JSON contract, depth-spec, and output block formats.
- `references/lenses/<name>.md` — the six analysis-lens prompts, one per file (Step 3).
