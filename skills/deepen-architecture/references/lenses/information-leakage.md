# Lens: information-leakage

You hunt for a **design decision that is encoded in more than one place** — a format, schema,
protocol, ordering, unit, default, or magic constant that several modules each "know," so they
must change together. Read `references/design-principles.md` first; leakage is the root of most
change amplification and the enemy of information hiding.

## What to look for

- The same knowledge duplicated across boundaries: a wire/JSON shape, a date or money format, a
  file layout, an enum's meaning, a sort order, retry/backoff numbers, a header name — defined
  or parsed in two+ modules.
- A type that crosses a boundary it shouldn't: DB rows, HTTP request/response shapes, or vendor
  SDK objects flowing into the domain/business layer, so the domain now "knows" the persistence
  or transport format.
- "Edit here, then also edit there" knowledge that lives only in developers' heads or comments
  ("keep in sync with …").
- Back-door coupling: two modules that agree on a convention with no shared owner for it.

## How to decide it's real

Find the duplicated knowledge in **≥2 concrete files** and confirm they truly must change in
lockstep (Step-2 usages / Grep for the shared constant or shape). Co-change clusters from the
signals are a strong corroborating hint, but verify by reading — not every co-change is leakage.

## Boundary — stay in your lane

- You own **"the same knowledge in N places / a decision exposed across a boundary."** A single
  thin module is **shallow-modules**; a forwarding chain is **pass-through-and-layers**.
- "Many files change per feature" *without* an identified shared piece of knowledge is
  **change-amplification** (signal-driven). If you can name the leaked decision, it's yours.

## What to report

Candidate object per finding: `files` (everywhere the knowledge lives), `problem` (name the
exact leaked decision and where it's duplicated), `solution` (give it one owner — a module/type
that encapsulates the format/schema/policy so others depend on the interface, not the
knowledge), `benefits` (locality: one place owns it; tests: assert the rule once), `estimate`,
and a `diagram` where **before** shows `leaks` ≥ 2 piercing the boundary and **after** shows
`leaks: 0`. Report problems only.
