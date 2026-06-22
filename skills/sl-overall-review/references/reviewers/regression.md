# Reviewer: regression

Review the change for regression risk - especially when fixing a bug.

## Focus

1. Did the fix re-introduce a bug previously fixed in this area? Look at git log for the
   touched files; if a prior commit shows a fix near the modified lines, verify it still holds.
2. Does the fix handle the original failing case AND the surrounding edge cases that share
   the same code path (empty inputs, nulls, boundary values, concurrent access)?
3. Are there callers or peer code paths that depend on the modified behavior and may now break?
   List them and check each.
4. Does the change cover only the symptom or the root cause? A symptom-only fix often regresses.
5. Is there a test that would have caught the original bug? If not, is one added now?

## What to Report

For each issue:
- Location: exact file path and line number
- Issue: what could regress
- Why: what prior behavior or peer path is affected
- Fix: specific suggestion

Report problems only - no positive observations.
