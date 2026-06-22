# Design principles — the lens every candidate is judged against

This is the shared vocabulary for `deepen-architecture`. Every analysis lens
(`references/lenses/*.md`) reads this file so candidates speak one language and the
strength badge means the same thing across the report. It is grounded in John
Ousterhout's *A Philosophy of Software Design* (APoSD).

## The thing we are optimizing: complexity

Complexity is anything about the structure that makes the system hard to understand or
change. It shows up as three symptoms — name the one(s) a candidate attacks:

- **Change amplification** — a single conceptual change forces edits in many places.
- **Cognitive load** — a developer must hold a lot in their head to do something safely
  (how many things must you know, and read, to change this correctly?).
- **Unknown unknowns** — it is not even obvious *what* must change, or that a change here
  breaks something over there. The worst kind; obscurity and non-locality cause it.

Complexity is incremental — it accretes from many small, individually-reasonable choices.
High-leverage moves remove a *disproportionate* amount of it relative to the change size.

## Deep vs. shallow modules (the core idea)

A module is **deep** when it offers a **simple interface over substantial functionality** —
the interface is much smaller than the implementation it hides. A module is **shallow** when
its interface is nearly as complex as its implementation (or there is barely any
implementation behind it). Shallow modules don't pay for the cognitive cost of their own
existence: you must understand the interface *and* still know what's behind it.

The best modules provide **information hiding**: a design decision (a format, a protocol, a
schema, an algorithm, an ordering) is captured inside one module and nobody else needs to
know it. **Information leakage** is the opposite — the same knowledge is encoded in two or
more places, so they must change together. Leakage is the root of most change amplification.

## Locality & leverage (how to frame Benefits)

Every candidate's benefit is explained in two currencies:

- **Locality** — after the change, the knowledge needed to understand or modify a behavior
  lives in *one* place. You stop tracing across files; the boundary hides what's behind it.
  "To change retry behavior you now edit one module, not six call sites."
- **Leverage** — the change removes complexity *out of proportion* to its size: it deletes
  interfaces, collapses pass-throughs, erases a class of bug, or shrinks the blast radius of
  future changes. Quantify it: interfaces removed, call sites simplified, files that stop
  co-changing, special cases eliminated.

## How deepening improves tests (always include in Benefits.tests)

A narrow, deep interface is easier to test *behaviorally* than a wide, shallow one:

- Fewer public methods → fewer entry points to test, exercised through one stable surface.
- Hidden collaborators → fewer mocks. A leaky/shallow design forces tests to stub the
  internals every caller already knows about; deepening lets one behavioral test cover what
  several mock-heavy unit tests stubbed. Quantify ("removes ~12 mock setups", "one
  integration test replaces 3 brittle suites").
- Defined-out errors and removed special cases → fewer edge-case tests that only existed to
  pin down accidental complexity.

## Red flags the lenses hunt for

- **Shallow module / classes that are too small** — interface ≈ implementation; getters and
  setters with no logic; a class that only forwards.
- **Pass-through methods** — a method whose body just calls another method with the same
  signature. Each adds interface, hides nothing.
- **Information leakage** — the same design decision (format, schema, order, protocol)
  appears in multiple modules; changing one means changing the others.
- **Temporal decomposition** — structure mirrors *execution order* (read → parse → execute)
  instead of *knowledge*, so one piece of knowledge is smeared across stages.
- **Conjoined methods / non-local code** — to understand A you must read B (and back). They
  should be one unit or properly separated.
- **Special-case creep** — a thicket of `if`s for cases that could be **defined out of
  existence** (e.g. make the empty case behave like the normal case) or pulled into one place.
- **Over-exposed configuration / pulling complexity upward** — every caller assembles the
  same setup before calling in, instead of the module owning a sensible default downward.

## Two complementary heuristics

- **Design it twice** — for each kept candidate, sketch a second design and say why the
  proposed one wins. A candidate without a considered alternative cannot be *Strong*.
- **Pull complexity downward** — it is better for the module to absorb complexity than to
  push it onto every caller. Prefer solutions that make the hard part the module's job.

## Strength rubric (testable — derive from `estimate`)

`estimate = { leverage 1–5, reach 1–5, confidence 0.0–1.0, risk 1–5 }`. Rank candidates by
`score = leverage * reach * confidence - 0.5 * risk`; keep the top ≤4, drop the rest (with a
one-line reason — never silently). Then assign the badge:

- **Strong** — `confidence ≥ 0.8` AND `leverage ≥ 4` AND `reach ≥ 3` AND `risk ≤ 3`, with
  **≥2 concrete files re-read and verified** and an `alternativeConsidered` recorded.
  *"I can point at the code, I'm confident, it helps many places, and it won't blow up."*
- **Worth exploring** — `confidence ≥ 0.6` AND `leverage ≥ 3`, but missing one Strong
  criterion (reach is narrow, risk is high, or evidence is partial). *"Real and useful, but
  localized, riskier, or needs human judgment before committing."*
- **Speculative** — `confidence < 0.6`, OR signal-only (a churn/co-change hotspot whose
  structural problem you could **not** confirm by re-reading), OR the solution is a
  hypothesis. *"Worth a look, but I couldn't fully verify the problem or the fix."*

**Hard rule:** a candidate whose cited code could not be re-read and verified **cannot be
Strong** — cap it at Speculative. Never invent a problem to look thorough, and never pad to a
quota; a short, honest report beats a padded one.

## Out of scope (do NOT raise these as candidates)

This skill proposes **high-leverage structural restructurings of the resting codebase**. The
following are deliberately excluded — note them only if they're incidental to a real
structural candidate:

- **Naming, comments, formatting, obscurity** — local fixes, not structural leverage.
- **Diff-relative concerns** — scope-creep, "did this PR over-engineer" — there is no diff
  here; that's `overall-review`'s job. Over-abstraction in the *resting* code is in scope, but
  as the inverse of deep modules (folded into `shallow-modules` / `pass-through-and-layers`),
  not as a separate lens.
- **Bugs, security, performance** — `overall-review` owns those. Mention only if a structural
  change is the natural fix and the structure is the real point.
