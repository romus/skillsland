# deepen-architecture

Study the **resting state** of a codebase and propose up to **3–4 high-leverage architecture
improvements** — grounded in John Ousterhout's *A Philosophy of Software Design* (deep vs.
shallow modules, locality & leverage, defining errors out of existence). It's an up-front
**proposal document** you generate *before* an architecture effort. It is **read-only on code**:
it proposes and documents, it never edits, refactors, or commits.

```
/deepen-architecture                 # whole repo, ask which output mode
/deepen-architecture text            # print the proposal here, with ASCII diagrams (zero writes)
/deepen-architecture html src/api    # scope to src/api, save an HTML report
```

## Two output modes

| Mode | Where it lands | Diagrams | Writes to disk? |
|---|---|---|---|
| **HTML** | `.skillsland/deepen-architecture/<date>.html` (+ `latest.html`) | inline SVG | yes — only inside `.skillsland/` (self-ignored) |
| **Text** | printed in the chat | ASCII | **no** — fully read-only |

The same analysis drives both. The agent emits a structured **candidates JSON**; the bundled
`render-report.mjs` owns all markup, drawing the Before/After "shallow → deep" diagrams
deterministically from one numeric depth-spec (box width = interface size, height =
functionality) — so SVG and ASCII stay consistent.

## What each candidate card contains

- **Files** — the modules involved.
- **Problem** — the structural friction (which APoSD red flag, with evidence).
- **Solution** — plain-English description of the deepening, plus the alternative considered.
- **Benefits** — framed as **locality** (knowledge in one place) and **leverage** (complexity
  removed out of proportion to the change), and how the narrower interface **improves tests**.
- **Before / After diagram** — a shallow wide-thin module with leaks/callers becoming a deep
  narrow-thick one.
- **Recommendation strength** — `Strong` · `Worth exploring` · `Speculative`, by a testable
  rubric (`confidence × leverage × reach`, penalized by risk; signal-only findings can't be
  Strong).

## How it works (7 steps)

1. Resolve output mode + scope; run `collect-context.mjs` for repo signals (churn hotspots,
   co-change clusters, largest files, languages) and discover/read context docs (CLAUDE.md,
   ARCHITECTURE.md, ADRs).
2. Optionally use **LSP** or a **JetBrains/IDE MCP** (detected by scanning tool names; falls back
   to Grep) to resolve fan-in / usages for candidate areas.
3. Run six analysis **lenses** in parallel (one sub-agent each in Claude Code): `shallow-modules`,
   `pass-through-and-layers`, `information-leakage`, `change-amplification`, `special-case-creep`,
   `temporal-decomposition`. Each has a boundary statement so they don't overlap.
4. Re-read the cited code to verify, dedup, rank, keep the top ≤4 (drop the rest, listed — no
   silent truncation), "design it twice" per candidate.
5. Build the candidates JSON.
6. Render: HTML to `.skillsland/` (via `Bash` + the script — there is intentionally no `Write`
   tool), or text to stdout.
7. Deliver the proposal in the user's language.

## Relationship to `overall-review`

| | `overall-review` | `deepen-architecture` |
|---|---|---|
| Looks at | the **diff** vs a base branch | the **resting codebase** |
| Produces | findings (bugs/quality), chat-only | architecture **proposals**, durable report |
| Question | "is this change correct?" | "where would deepening pay off most?" |

Use `overall-review` to vet a change; use `deepen-architecture` to plan where to invest in
structure next.

## The saved `<date>.json` is a contract

In HTML mode the candidates JSON is kept next to the report. Its shape (`schemaVersion: 1`, see
[`references/report-format.md`](references/report-format.md)) is a **stable contract** — a future
downstream skill (e.g. "apply one candidate" or "track proposal status") can consume it, the way
`gitlab-review-comments` consumes `overall-review` output.

## Bundled resources

- `scripts/collect-context.mjs` — repo-context + signals JSON (no deps, Node 20+, shells to git).
- `scripts/render-report.mjs` — candidates JSON → HTML+SVG or text+ASCII (no deps).
- `references/design-principles.md` — APoSD vocabulary + strength rubric + scope exclusions.
- `references/report-format.md` — the candidates-JSON contract + depth-spec + block formats.
- `references/lenses/*.md` — the six lens prompts.
