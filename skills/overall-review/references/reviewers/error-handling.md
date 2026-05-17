# Reviewer: error-handling

Review the change for error handling completeness and quality.

## Focus

1. Swallowed errors - except/catch blocks that pass, log only, or hide failures.
2. Missing error handling around fallible calls (I/O, network, parsing, subprocess).
3. Wrong exception types - catching too broad (bare except, catch Throwable) or too narrow.
4. Lost context - errors re-raised without preserving the original cause/stack.
5. Logging gaps - errors that should be logged at warn/error are logged at debug or not at all;
   or sensitive data leaked in error messages.
6. Retry logic - retries without backoff, retries on non-retryable errors, infinite retries.
7. Cleanup on failure - resources (files, connections, locks, transactions) not released
   on the error path.
8. User-facing errors - opaque messages that don't help the user; or internal details exposed.
9. Edge cases - empty inputs, nulls, timeouts, partial reads, EOF on streams.

## What to Report

For each issue:
- Location: exact file path and line number
- Issue: what error path is broken or missing
- Impact: what happens at runtime when the error occurs
- Fix: specific suggestion

Report problems only - no positive observations.
