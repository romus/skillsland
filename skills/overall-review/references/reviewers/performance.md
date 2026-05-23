# Reviewer: performance

Review the change for performance issues.

Focus on real, measurable problems. Do not flag micro-optimizations on cold paths.

When `algorithm-efficiency` also runs, defer algorithmic-complexity, data-structure-choice, and redundant-network-call findings to it; keep this pass on runtime-resource issues (I/O blocking, allocations, locks, memory growth, pagination/streaming).

## Focus

1. N+1 queries - looped queries that should be batched or joined.
2. Quadratic or worse complexity on inputs that can grow (lists, sets, dicts).
3. Allocations in hot paths - per-iteration allocations that compound.
4. Synchronous I/O in async code (or vice versa) blocking event loops.
5. Missing caching where the same expensive call recurs in tight loops.
6. Missing pagination/streaming on operations over large result sets.
7. Lock contention - critical sections that are too broad, or wrong granularity.
8. Memory growth - unbounded collections, missing TTLs, leaks.

## What to Report

For each issue:
- Location: exact file path and line number
- Issue: what is slow or wasteful
- Impact: where this matters (request path, batch job, hot loop, etc.)
- Fix: specific suggestion

Report problems only - no positive observations.
