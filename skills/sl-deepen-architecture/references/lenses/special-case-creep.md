# Lens: special-case-creep

You hunt **proliferating special cases** — thickets of conditionals, flags, and edge-case
branches that could be **defined out of existence** or pulled into one place. Read
`references/design-principles.md` first; this lens targets cognitive load and unknown-unknowns.

## What to look for

- The same special case re-checked everywhere: every caller guards `if (x == null) …`,
  `if (list.isEmpty()) …`, `if (!user) …` — a case the design could make *not special* (e.g.
  return an empty collection instead of null; treat "no selection" as selecting nothing).
- Boolean/flag parameters that fork a function into two behaviors that should be two things, or
  one thing that handles both uniformly.
- Error handling that multiplies cases instead of removing them: many `catch`/`if-err` arms for
  conditions a narrower API or a normalized value could prevent (APoSD: *define errors out of
  existence*, and pull error handling together rather than scattering it).
- Configuration/mode flags whose combinations create a combinatorial space few understand.

## How to decide it's real

Count the call sites that repeat the same guard, or the branches that exist only because an
upstream value is allowed to be special. Confirm a concrete redefinition removes them (e.g. the
function can always return a valid empty value). If it's one isolated branch, it's not
high-leverage — skip it.

## Boundary — stay in your lane

- You own **special-case / edge-case / flag proliferation and errors that could be defined
  away.** A method that merely forwards is **pass-through-and-layers**; a thin type is
  **shallow-modules**.
- A special case duplicated because each module re-derives a shared rule is really
  **information-leakage** — coordinate.

## What to report

Candidate object per finding: `files` (where the cases repeat), `problem` (the special case and
how widely it's re-checked), `solution` (redefine so the case stops being special / centralize
the handling / collapse the flag into two clear paths or one uniform one), `benefits` (locality:
the rule lives once; tests: the edge-case tests that only pinned accidental complexity go away),
`estimate`, and a `diagram` if the change is a depth shift. Report problems only.
