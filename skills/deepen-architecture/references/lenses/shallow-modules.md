# Lens: shallow-modules

You judge a **single module/class/file at a time**: is its interface nearly as complex as the
functionality it provides? Read `references/design-principles.md` first — you are hunting the
core APoSD red flag: a module that doesn't pay for its own existence.

## What to look for

- Interface ≈ implementation: the public surface (methods, params, exported names) is about
  as large and detailed as what's behind it. You learn nothing by treating it as a black box.
- Classes that are *too small* — a type that holds one field and a getter/setter, or wraps a
  value without adding behavior, so callers must understand both it and what it wraps.
- A module whose every public method is one or two lines that mostly destructure inputs and
  delegate, with no real decision or invariant kept inside.
- Wide, optional-heavy signatures (`doThing(a, b, c, opts1, opts2, …)`) where the caller, not
  the module, decides everything — the module hides no decision.
- A façade/wrapper that re-exports its dependency's surface 1:1 (adds an interface, hides
  nothing).

## How to decide it's real

Read the module **and** 2–3 of its call sites. Ask: if I made this a black box, what decision
or knowledge would it hide from callers? If the honest answer is "almost nothing," it's
shallow. Estimate `reach` from how many call sites touch it (use Step-2 fan-in if available).

## Boundary — stay in your lane

- You own **single-module** "interface ≈ implementation / too little hidden." Cross-layer
  chains of forwarding methods belong to **pass-through-and-layers** — if the shallowness is
  really "three layers each forwarding," hand it there.
- "The same knowledge lives in N modules" is **information-leakage**, not shallowness.
- "This module changes every time that one does" (without reading why) is
  **change-amplification**. You diagnose by *reading the interface*, not from churn.

## What to report (one candidate per real finding)

Fill the candidate object (`references/report-format.md`): `files`, `problem` (why the
interface earns nothing — name what it fails to hide), `solution` (deepen it: widen the body
it owns, or fold it into the module it merely wraps), `benefits.tests` (fewer entry points /
fewer mocks), `estimate`, and a `diagram` where **before** has high `interface` + low `depth`
and **after** has low `interface` + high `depth`. Report problems only.
