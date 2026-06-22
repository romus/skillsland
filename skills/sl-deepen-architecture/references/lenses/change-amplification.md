# Lens: change-amplification (signal-driven)

You are the **evidence-driven** lens. Start from the repo signals — `churnHotspots` and
`coChangeClusters` in the collect-context JSON — and find structures where **one conceptual
change forces edits across many files**. Read `references/design-principles.md` first.

## What to look for

- **Co-change clusters**: sets of files that repeatedly change together. That pattern is the
  fingerprint of a missing module boundary — the knowledge that ties them is smeared across all
  of them. Open the clustered files and find *what* makes them move together.
- **Churn hotspots**: files edited far more than the rest. High churn isn't automatically bad
  (a real hub will churn), but a hotspot that's also wide/shallow or leaky is a prime target.
- Patterns where "to add one X you must touch N files" — a new enum value, a new event type, a
  new field — that ripple list is change amplification you can sometimes design away.

## How to decide it's real

The signal only points; **you must confirm by reading**. Open the co-changing/churning files
and identify the concrete shared change driver. If you can't find a structural reason they move
together (it's just an active area), do **not** raise a candidate — or raise it as *Speculative*
and say the structural cause is unconfirmed (a signal-only finding cannot be *Strong*).

## Boundary — stay in your lane

- You are the only lens that starts from **churn/co-change signals**. The others start from
  **code shape**. If, on reading, the cause is a *named* duplicated decision, that's really
  **information-leakage** — hand it there rather than double-reporting; if it's execution-order
  layering, that's **temporal-decomposition**.
- Use this lens for amplification you can see in the *history* but whose single structural name
  is "these things should be one module / behind one boundary."

## What to report

Candidate object per finding: `files` (the cluster/hotspot), `problem` (the conceptual change
that fans out, with the co-change/churn evidence — e.g. "files A,B,C changed together 11×; each
new event type touches all three"), `solution` (introduce the boundary that absorbs the change
so it lands in one place), `benefits` (leverage: the ripple shrinks from N files to 1; quantify
from the signal), `estimate` (cite the signal in `confidence`), and a `diagram` if a depth shift
applies. Report problems only.
