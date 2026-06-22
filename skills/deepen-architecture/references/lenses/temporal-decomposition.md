# Lens: temporal-decomposition

You look for structure organized by **execution order** (the sequence of operations) rather than
by **knowledge** (information hiding). Read `references/design-principles.md` first — this is one
of APoSD's classic causes of shallow modules and leakage.

## What to look for

- Modules/classes named and split by *phases*: `Reader` → `Parser` → `Validator` → `Executor`,
  or `init/configure/run/teardown` split into separate units, where each stage handles a slice
  of the **same** piece of knowledge.
- A format/schema that is read in one stage, interpreted in another, and written in a third — so
  the knowledge of that format is smeared across the pipeline and a change touches every stage.
- Pipelines where the boundaries fall between "what happens first/next" instead of between
  "different things the system knows." The tell: adding one concept means editing each stage.

## How to decide it's real

Pick one piece of knowledge (a record format, a protocol, a rule) and trace how many stage-
modules must understand it. If several stages each encode part of the same knowledge, the
decomposition is temporal. Confirm that a knowledge-based regrouping (a module that owns that
format end-to-end) would localize it. Co-change across the stage files corroborates.

## Boundary — stay in your lane

- You own **"structure follows execution order, splitting one piece of knowledge across
  stages."** If the duplicated knowledge is the whole story and there's no stage structure,
  that's **information-leakage**. If it's a forwarding chain with no real stages, that's
  **pass-through-and-layers**.
- History-only "these change together" without an identified execution-order split is
  **change-amplification**.

## What to report

Candidate object per finding: `files` (the stage modules), `problem` (the knowledge that's
smeared across stages and why phase-based boundaries cause it), `solution` (regroup by
information — a deep module that owns that knowledge end-to-end, with stages as private steps),
`benefits` (locality: the format lives in one module; leverage: a change touches 1 unit not N
stages), `estimate`, and a `diagram` contrasting the smeared shallow stages with the deep
knowledge-owning module. Report problems only.
