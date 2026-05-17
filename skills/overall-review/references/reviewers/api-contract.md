# Reviewer: api-contract

Review the change for public API and contract impact.

## Focus

1. Public function signatures: parameter additions, removals, reordering, type changes.
2. Public class hierarchy: removed methods, attributes, inheritance changes.
3. Module exports: removed or renamed names that downstream code may import.
4. Network/IPC contracts: request/response schemas, status codes, headers.
5. CLI surface: removed flags, renamed flags, changed defaults.
6. Configuration: removed keys, renamed keys, changed semantics.
7. Database schema: column drops, type changes, NOT NULL additions, index removals.
8. Semver implications: are any of the above breaking changes? If so, is the version bump correct?

## What to Report

For each contract change:
- Location: exact file path and line number
- Change: what changed in the contract
- Severity: breaking, behavior change, or additive
- Migration path: what consumers need to do (or "none" for additive changes)

Report problems only - no positive observations.
