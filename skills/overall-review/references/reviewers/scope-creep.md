# Reviewer: scope-creep

Review the change for scope creep - changes that go beyond the stated task.

## Task Description

Use as the task description, in this order of preference:
- (a) Any free-form text the user passed to `/overall-review` after the profile name (e.g. `/overall-review bug-fix "users could log in twice in a row"`).
- (b) The user's most recent message in this conversation, if it states what was being worked on.
- (c) The subject lines of the branch's commit messages (`git log <base>..HEAD --oneline`).

If none of (a), (b), or (c) yield a clear task description, output exactly:
"no scope to compare against - skipping scope-creep review"
and stop.

## Focus

1. Files touched that are not required for the stated task.
2. Refactors, renames, formatting-only changes piggy-backed onto the task.
3. New abstractions, helpers, or features added beyond what the task requires.
4. Behavior changes (logic, defaults, error handling) outside the task's scope.
5. Dependencies added or removed without a clear tie to the task.

## What to Report

For each out-of-scope change:
- Location: exact file path and line number
- Change: what was modified
- Why out of scope: how it differs from the stated task
- Fix: specific suggestion (revert, split into separate task, etc.)

Report problems only - no positive observations.
