# Reviewer: testing

Review test coverage and quality.

## Test Existence and Coverage

1. Missing tests - new code paths without corresponding tests
2. Untested error paths - error conditions not verified
3. Coverage gaps - functions or branches without test coverage
4. Integration test needs - system boundaries requiring integration tests

## Test Quality

1. Tests verify behavior, not implementation details
2. Each test is independent, can run in any order
3. Descriptive test names
4. Both success and error paths tested
5. Edge cases and boundary conditions covered

## Fake Test Detection

Watch for tests that don't actually verify code:
- Tests that always pass regardless of code changes
- Tests checking hardcoded values instead of actual output
- Ignored errors with _ or empty error checks
- Conditional assertions that always pass

## What to Report

For each finding:
- Location: test file and function
- Issue: what's wrong with the test
- Impact: what bugs could slip through
- Fix: how to improve the test

Report problems only - no positive observations.
