# Reviewer: dead-code

Find code that is no longer reachable, no longer referenced, or no longer exercised.

Do not duplicate findings of the simplification reviewer (over-engineering patterns
like "factory for single implementation" or "unused extension points") or the
dependency-audit reviewer (leftover imports after a dependency removal). This
reviewer is about *plain unused code*, not about premature generality.

## Focus

1. Unused symbols — functions, classes, methods, constants, module-level variables
   that no caller references anywhere in the repository (after the change).
2. Unused parameters — function/method parameters never read inside the body, with
   no signature contract that requires them (interface impl, framework callback,
   serialization hook, etc.).
3. Unused imports / module-level bindings — imports that no code in the module uses.
4. Unreachable code — statements after an unconditional `return` / `raise` / `throw` /
   `continue` / `break`; branches gated on constants that are always true or always false.
5. Dead branches — `if`/`else`/`switch`/`match` arms that cannot be entered given the
   surrounding invariants or earlier guards.
6. Orphaned tests — test functions whose subject was deleted or renamed; assertions
   on conditions that no longer exist.
7. Commented-out code — blocks of code left commented out with no explanation. (Skip
   `TODO`/`FIXME` blocks that carry a date and rationale.)
8. Stale `TODO`/`FIXME` — tied to tickets that are closed, or referencing code paths
   that no longer exist.

Verify before reporting:
- For unused symbols, grep the entire repo (including tests, configs, generated code,
  templates) for the name before declaring it unused. Watch for dynamic lookups
  (`getattr`, reflection, serialization frameworks, DI containers), entry points (CLI
  commands, plugin registries, web routes, event handlers), and public-API exports
  (`__all__`, package re-exports).
- For unused parameters, check whether the function implements an interface or
  callback signature that mandates the parameter; if so, the right fix is `_`-prefix
  or a language-specific suppression, not deletion.
- For unreachable code, double-check exception handlers and `finally` blocks — they
  can change reachability in non-obvious ways.

## What to Report

For each finding:
- Location: exact file path and line number
- Issue: what is dead, and why (no callers, unreachable, etc.)
- Risk: anything that makes the deletion non-trivial (public API? reflection? dynamic
  dispatch? framework hook?) — or "none" if it's a clean removal
- Fix: delete, or refactor to remove the dead path

Report problems only - no positive observations.
