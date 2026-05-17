# Review checklist

Use as a mental model while walking the diff. Not every item applies to every
change; skip what's irrelevant, but consider each category at least once.

## 1. Correctness and logic
- Does the change do what its name/PR description claims?
- Off-by-one, null/undefined, empty collections, unexpected types
- Error paths: are exceptions caught at the right layer, swallowed silently,
  or rethrown losing context?
- Race conditions and ordering assumptions in async code

## 2. Security
- Input validation at trust boundaries (HTTP handlers, CLI args, deserialization)
- SQL/command/template injection
- Authentication and authorization checks on protected paths
- Secrets in code, logs, or commit history
- Unsafe deserialization (pickle, YAML.load, eval)
- Dependency additions — pinned, from trusted sources, no known CVEs

## 3. Tests
- New behavior has at least one test covering the happy path
- Edge cases that the change handles also have tests
- Tests assert meaningful behavior (not just "didn't throw")
- No tests deleted/skipped without a comment explaining why
- Mocking: are integration concerns mocked away in a way that hides real bugs?

## 4. Readability
- Names describe intent, not implementation
- Functions do one thing; long functions have natural seams to split
- Comments explain *why*, not *what*
- No dead code, commented-out blocks, debug prints
- Magic numbers/strings extracted to constants when reused

## 5. Performance
- N+1 queries, unnecessary loops over large collections
- Allocations in hot paths
- I/O inside loops that could be batched
- Synchronous calls that should be async (and vice versa)

## 6. Compatibility and migrations
- API/schema changes are backwards-compatible OR have a documented migration
- DB migrations are idempotent and reversible where reasonable
- Feature flags or rollout plan for risky changes
- Public interface (exports, CLI flags, env vars) changes have callers updated

## 7. Documentation
- README / CHANGELOG / inline docs updated when behavior changes
- Public APIs have at least one usage example or doc comment
