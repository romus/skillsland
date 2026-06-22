# Report format — the candidates JSON contract

This is the **stable contract** between the analysis (Steps 3–5 of `SKILL.md`) and the
renderer (`scripts/render-report.mjs`). The agent emits *semantics*; the script owns all
*markup* (HTML+SVG or text+ASCII). Keep this file, `render-report.mjs`, and `SKILL.md` in
lock-step — changing a field here means changing the validator there.

A future downstream skill may consume the saved `<date>.json`, so treat the shape as an API:
bump `schemaVersion` on a breaking change.

## Top-level object

```jsonc
{
  "schemaVersion": 1,                     // REQUIRED int. Renderer rejects anything != 1.
  "repo": "skillsland",                   // REQUIRED string (repo basename).
  "generatedAt": "2026-06-22T14:30:00Z",  // REQUIRED ISO-8601 string (pass the run timestamp).
  "scope": "whole repo",                  // REQUIRED string ("whole repo" or a path).
  "tooling": {                            // OPTIONAL — how fan-in / usages were resolved.
    "deepStudy": "lsp",                   //   "lsp" | "ide-mcp" | "grep" | "none"
    "gitAvailable": true
  },
  "context": {                            // REQUIRED object (may be empty). Comes from collect-context.mjs.
    "docsRead": ["CLAUDE.md", "README.md"],
    "signals": {                          // each sub-array OPTIONAL; renderer omits an empty panel.
      "churnHotspots":     [{ "path": "src/app.ts", "commits": 42 }],
      "coChangeClusters":  [{ "files": ["a.ts", "b.ts"], "together": 11 }],
      "largestFiles":      [{ "path": "src/big.ts", "loc": 1200, "bytes": 48000 }],
      "languages":         [{ "ext": ".ts", "files": 40, "bytes": 120000 }],
      "topDirs":           [{ "path": "src", "files": 80, "bytes": 250000 }]
    }
  },
  "candidates": [ /* see below — MAY be empty (empty-state report) */ ],
  "dropped": [                            // REQUIRED array (may be empty). NO silent truncation.
    { "title": "Rename logging facade", "reason": "local fix, not high-leverage", "lenses": ["..."] }
  ],
  "warnings": ["..."]                     // OPTIONAL string[]; shown in a muted footer / Notes block.
}
```

You can copy `context`, `tooling.gitAvailable`, and `warnings` straight from the
`collect-context.mjs` output (its `gitAvailable`, `docsRead`, `signals`, `warnings` map 1:1).

## Candidate object

```jsonc
{
  "id": "cand-1",                         // REQUIRED stable string (anchors / dedupe).
  "title": "Collapse the 3-layer config pass-through",  // REQUIRED.
  "strength": "Strong",                   // REQUIRED enum: "Strong" | "Worth exploring" | "Speculative".
  "files": ["src/config/loader.ts"],      // REQUIRED string[], length >= 1.
  "problem": "...",                        // REQUIRED (plain text, may be multi-sentence).
  "solution": "...",                       // REQUIRED.
  "lenses": ["pass-through-and-layers"],   // OPTIONAL — provenance, shown as small tags.
  "principle": "Deep vs shallow modules",  // OPTIONAL — the APoSD principle invoked.
  "alternativeConsidered": "...",          // OPTIONAL — "design it twice"; label hidden if absent.
  "benefits": {                            // OPTIONAL object; each field OPTIONAL.
    "locality": "...",                     //   keep complexity near where it's used
    "leverage": "...",                     //   how much complexity removed / how many sites
    "tests": "..."                         //   how deepening narrows the interface and improves tests
  },
  "estimate": {                            // OPTIONAL — drives ranking + the strength rubric.
    "leverage": 5, "reach": 4, "confidence": 0.9, "risk": 2
  },
  "diagram": { "before": { /* depth-spec */ }, "after": { /* depth-spec */ } },  // OPTIONAL
  "diagramSvg": { "before": "<svg…>", "after": "<svg…>" }  // OPTIONAL raw override (HTML only; sanitized)
}
```

## Depth-spec (the Before/After diagram) — mode-agnostic

The diagram encodes Ousterhout's depth metaphor numerically. The renderer draws it as SVG
(HTML mode) or ASCII (text mode) from the same spec, so the agent never writes coordinates.

```jsonc
{
  "interface": 9,   // 1–10, default 5 — size of the public interface (API surface). Bigger = wider box.
  "depth": 2,       // 1–10, default 5 — amount of functionality hidden behind it. Bigger = taller box.
  "callers": 7,     // 0–10, default 0 — dependents reaching in (drawn as arrows into the top edge).
  "leaks": 3,       // 0–5,  default 0 — implementation details crossing the boundary (side arrows).
  "label": "Config layer"  // optional, truncated to 18 chars.
}
```

- **Shallow** module = **wide** interface + **thin** body (often + leaks + many callers): `interface` high, `depth` low.
- **Deep** module = **narrow** interface + **thick** body, clean sides: `interface` low, `depth` high, `leaks` 0.
- Make `before` and `after` genuinely differ — if they're identical the renderer emits a warning and the diagram says nothing. The typical move: `after` lowers `interface`, raises `depth`, and drops `leaks` to 0.
- Prefer `diagram` (the spec). Only use `diagramSvg` for a bespoke picture the box metaphor can't express; it is sanitized (scripts/handlers/external refs stripped) and ignored in text mode.

## Renderer degradation rules (enforced by `render-report.mjs`)

- Missing `schemaVersion` / value `!= 1`, or any missing REQUIRED top-level field → **exit non-zero, output nothing.**
- A candidate missing a REQUIRED field (`title`/`problem`/`solution`/non-empty `files`) → **skip that card**, add a `warnings` entry, render the rest.
- Unknown `strength` → coerced to `Speculative` + a warning (the card still renders).
- No `diagram` and no `diagramSvg` → card renders without a diagram block.
- `diagram` present with missing depth-spec fields → filled from the defaults above (never NaN / negative sizes).
- Every injected string is HTML-escaped in HTML mode; `diagramSvg` is sanitized.

## How the renderer is invoked (from `SKILL.md` Step 6)

```bash
# HTML mode — writes a file (path must be inside .skillsland/deepen-architecture/)
node render-report.mjs --format html <input.json> .skillsland/deepen-architecture/<date>.html
# -> validates, writes <date>.html (+ latest.html copy), prints the filename on stdout.

# Text mode — prints to stdout, writes nothing
node render-report.mjs --format text <input.json>   # or pipe the JSON on stdin
```

## Chat summary block (HTML mode, Step 7) — the compact recap printed after writing the file

```
[<n>] <strength> · <file, file …> (<k> files)
    Problem:  <one line>
    Solution: <one line>
    Leverage: <one line — locality/leverage + the test win>
```

Followed by `Dropped (lower leverage): …` (if any), the `Report:` path (+ `latest.html`), and
`<N> candidates — scope: <scope>`. No markdown tables (renders in terminals too). Translate the
labels into the user's language; keep file paths and identifiers verbatim. In **text mode** you
instead relay the full `render-report.mjs --format text` output, which already ends with that
count line.
