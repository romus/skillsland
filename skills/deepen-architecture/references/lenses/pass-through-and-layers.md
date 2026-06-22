# Lens: pass-through-and-layers

You judge **chains across boundaries**: methods that forward to other methods, layers that add
a hop without hiding a decision, and methods so entangled they must be read together. Read
`references/design-principles.md` first.

## What to look for

- **Pass-through methods** — a method whose body just calls another method with essentially
  the same signature, adding interface but not functionality. Look for `return this.inner.foo(
  ...args)` patterns repeated across a class.
- **Redundant layers** — A → B → C where B's only job is to forward A's calls to C (a service
  that wraps a repository that wraps a DAO, each with the same shape). Each layer is a tax on
  every reader and every change.
- **Dispatcher / indirection chains** — call sequences that bounce through several files
  before anything actually happens; the indirection isn't earning a real boundary.
- **Conjoined methods** — two methods (often in different files) that can only be understood
  together: to know what A does you must read B, and B assumes A. They should be one cohesive
  unit (or genuinely separated with a real interface).

## How to decide it's real

Trace one representative call from entry to where work actually happens. Count the hops that
hide **no** decision (no validation, mapping, policy, transaction, or invariant). If removing a
layer loses nothing a caller relies on, it's a real pass-through. Use Step-2 usages to size
how many call paths share the chain (`reach`).

## Boundary — stay in your lane

- You own **multi-hop forwarding / redundant layering / conjoined methods**. A *single* module
  whose own interface is too thin is **shallow-modules** — leave it there.
- If the layers exist because the same knowledge is duplicated at each level, the deeper cause
  is **information-leakage**; coordinate, don't double-report.
- "Stages split by execution order" (parse/validate/execute layers) is **temporal-
  decomposition**.

## What to report

Candidate object per finding: `files` (the chain), `problem` (the hops that hide nothing),
`solution` (collapse the layers / inline the pass-throughs / merge conjoined methods behind one
deep interface), `benefits` (locality: one place to change; leverage: N interfaces and M
forwarding methods removed), `estimate`, and a `diagram` where **before** shows a wide
interface + thin body with several `callers`, **after** a narrow interface + thick body.
Report problems only.
