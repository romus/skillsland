# overall-review

End-to-end code review of the changes on your current branch against a base branch you pick. The skill runs a fixed set of independent reviewers in parallel (one per concern), consolidates and de-duplicates the findings, and prints them as plain-text per-finding blocks that read well in both Claude Code and Codex CLI.

It does **not** modify code, run tests, commit, or offer to apply fixes — review and report only.

## When to use

Trigger phrases the host agent recognises:

- "review my changes" / "do an overall review" / "review this branch" / "code review against main"
- The slash command `/overall-review`, optionally with a profile argument: `/overall-review security`, `/overall-review performance`, `/overall-review bug-fix`, …

The skill prompts for the base branch interactively (offers `main`/`master`, current upstream, recent branches, plus a manual entry).

## Workflow at a glance

1. **Collect base-branch candidates** via `scripts/list-base-branches.sh`.
2. **Ask the user** which base to diff against.
3. **Compute** `git merge-base`, `git diff`, and `git log <base>..HEAD` as shared context.
4. **Pick a profile** — explicit argument wins; otherwise auto-detect from the diff (paths, file types, commit messages). Then layer on any matching add-on reviewers (e.g. `migration-safety` when a schema change rides along with app code).
5. **Run the profile's reviewers (plus any add-ons) in parallel** — one sub-agent per reviewer in Claude Code; same prompt in Codex with a push to split into parallel sub-agents (or sequentially with a clean lens-switch as fallback).
6. **Consolidate**: re-read each cited location, discard false positives, deduplicate, assign severity (`critical`/`major`/`minor`/`nit`).
7. **Output** per-finding blocks + one summary line. That's the entire reply.

## Profiles

Each profile is a fixed list of reviewers. Pick a profile by explicit argument (case-insensitive, with synonyms) or let the skill auto-detect from the diff. See [`references/profiles.md`](references/profiles.md) for full selection rules and synonyms.

| Profile       | Reviewers                                                                  | Use when                                                |
|---------------|----------------------------------------------------------------------------|---------------------------------------------------------|
| `universal`   | quality, implementation, architecture, testing, simplification, documentation, dead-code | Mixed or ambiguous diffs (the default fallback)         |
| `bug-fix`     | quality, regression, scope-creep, testing, error-handling, dead-code       | Focused fix; commit messages say "fix"/"bug"/"crash"    |
| `feature`     | quality, implementation, architecture, testing, documentation, api-contract, dead-code   | New capability or new public API surface                |
| `refactor`    | quality, simplification, architecture, scope-creep, testing, dead-code                   | Renames, extractions, no behavioural deltas             |
| `research`    | research-completeness, evidence-quality, documentation                     | Design docs, ADRs, RFC drafts                           |
| `performance` | performance, quality, testing, dead-code                                   | Hot loops, caches, async boundaries, N+1, large data    |
| `security`    | security-audit, quality, testing, error-handling, dead-code                | Auth/crypto/secrets/session changes; dependency-only    |
| `migration`   | migration-safety, quality, testing, dependency-audit, dead-code            | Migration-dominated diffs (only schema/migration files) |
| `docs`        | documentation                                                              | Only `*.md` / `docs/` changed                           |

Synonyms accepted on the command line: `bug`/`fix` → `bug-fix`, `perf` → `performance`, `sec` → `security`, `doc` → `docs`, `feat` → `feature`, `mig` → `migration`, `ref` → `refactor`, `res` → `research`, `uni`/`all` → `universal`.

### Add-on reviewers

Some signals add a single lens on top of the base profile instead of switching the whole profile. The add-on reviewer is appended to the base profile's reviewer list (no base reviewer is dropped), and the run is announced as `<base> + <add-on>` (e.g. `feature + migration-safety`):

- **`migration-safety`** — added when a diff touches schema/migration artifacts (schema-DDL `*.sql`, ORM column add/drop/type changes, migration directories) but is *not* migration-dominated. This is why a stray `.sql` inside a feature diff no longer collapses the whole review into the `migration` profile — you keep the general review and gain the safety lens.
- **`dependency-audit`** — added when dependency manifests change alongside other code (the dependency-only case stays a full `security` variant).

## Reviewers

Each reviewer is a narrow lens with its own prompt in [`references/reviewers/<name>.md`](references/reviewers/). Below is the short version — full focus lists, dedup rules, and report-shape conventions live in the reviewer files.

### quality

Correctness, security basics, and simplicity in one pass. When `security-audit` or `performance` also run, this reviewer drops their concerns to avoid duplicates.

- Logic errors — off-by-one, wrong operators, broken conditionals
- Edge cases — empty/null inputs, boundaries, concurrent access
- Error handling completeness; no silent failures
- Resource management — leaks, missing cleanup
- Race conditions in async/concurrent code
- Basic input validation and injection vulnerabilities
- Hardcoded secrets or credentials in code
- Over-abstraction / premature optimisation

### implementation

Does the code actually achieve the goal it claims? Style is out of scope.

- Requirement coverage — every stated aspect addressed
- Correctness of approach — right problem being solved
- Wiring and integration — components actually connected
- Completeness — no missing pieces that block the feature
- Logic flow from input to output
- Edge cases at boundaries

### architecture

Structural soundness. Distinct from `simplification` (which owns "too much structure" — redundant layers) and `implementation` (does it work / is it wired); `architecture` owns "wrong or inconsistent structure". Cites the existing pattern before flagging a divergence.

- Detects the codebase's established architecture (layering, module boundaries, dependency direction) before judging
- Conformance — code in the wrong layer/module, dependency-direction violations, parallel abstractions reinventing existing ones
- Best practices for new services/features with no precedent — separation of concerns, coupling/cohesion, no cycles
- Clear boundaries & ownership; well-defined transaction/consistency boundaries
- Leaky abstractions crossing a boundary (DB rows, HTTP shapes, vendor SDK types)
- Patterns used because they earn their keep, not cargo-culted

### testing

Test coverage and test quality. Catches fake tests as well as missing ones.

- Missing tests for new code paths
- Untested error paths
- Tests verify behaviour, not implementation details
- Both success and error paths covered
- Fake-test detection — always-pass, hardcoded outputs, ignored errors
- Tests are independent (any order, no shared state)

### simplification

Detect over-engineering. Reports the simpler alternative for every flagged pattern.

- Wrapper/factory layers that add nothing
- Generic solutions for specific problems
- Pass-through indirection
- Future-proofing for hypothetical needs
- Unnecessary fallbacks that never trigger
- DTO/mapper overkill, layer cake anti-pattern

### dead-code

Plain unused code — distinct from `simplification` (over-abstraction) and `dependency-audit` (leftover imports after dep removal). Verifies before reporting (greps repo, checks interface/reflection/entry-point usage).

- Unused symbols with no callers anywhere
- Unused parameters with no contract requiring them
- Unused imports / module bindings
- Unreachable code after `return`/`raise`/`throw`
- Dead `if`/`switch` branches gated on constants
- Orphaned tests whose subject was deleted/renamed
- Commented-out code blocks; stale TODO/FIXME

### documentation

Catches missing user-facing docs (README) and AI-agent docs (CLAUDE.md). Skips internal refactors and bug fixes that restore documented behaviour.

- README updates for new features, CLI flags, APIs, config options
- Behaviour changes affecting users; breaking changes
- CLAUDE.md updates for new architectural patterns or conventions
- New build/test commands; project structure changes

### regression

Specifically for bug fixes: did the fix re-introduce a previously-fixed bug, miss adjacent edge cases, or treat the symptom instead of the root cause?

- Prior fixes in the same area still hold
- Original failing case + surrounding edge cases on the same code path
- Callers and peer paths depending on the modified behaviour
- Symptom vs root cause analysis
- A test that would have caught the original bug

### scope-creep

Compares the diff against the stated task (free-form text, recent user message, or commit messages). Skips itself if no task description is available.

- Files touched that aren't required for the task
- Refactors, renames, or formatting piggy-backed on
- New abstractions or helpers beyond what the task needs
- Behaviour changes outside the task's scope
- Dependencies added/removed without a clear tie

### error-handling

The failure-paths reviewer. Goes beyond `quality` to enumerate every category of error mishandling.

- Swallowed errors (bare `except: pass`, log-and-ignore)
- Missing handling around fallible calls (I/O, network, parsing, subprocess)
- Wrong exception types — too broad or too narrow
- Lost context — re-raised without preserving cause/stack
- Logging gaps — wrong levels, sensitive data in error messages
- Retry logic — no backoff, retries on non-retryable errors, infinite retries
- Cleanup on failure — files, connections, locks, transactions
- User-facing errors — opaque messages or leaked internals

### security-audit

Security-only review. Does **not** duplicate `quality`'s correctness findings.

- Input validation at trust boundaries
- Injection — SQL, command, LDAP, XSS, path traversal, template
- Authentication — credential handling, session management, MFA bypasses
- Authorization — missing checks, IDOR, privilege escalation
- Secrets — hardcoded creds/keys/tokens; leaks via logs or errors
- Cryptography — weak algorithms, hardcoded IVs, insecure RNG
- Information disclosure — stack traces, internal IDs leaked to users
- CSRF/SSRF, unsafe deserialization

### performance

Real, measurable performance issues. Explicitly skips micro-optimisations on cold paths.

- N+1 queries — looped queries that should be batched or joined
- Quadratic or worse complexity on inputs that grow
- Per-iteration allocations in hot paths
- Synchronous I/O in async code (or vice versa)
- Missing caching where the same expensive call recurs in a loop
- Missing pagination/streaming on large result sets
- Lock contention — too-broad critical sections, wrong granularity
- Memory growth — unbounded collections, missing TTLs, leaks

### migration-safety

Production-safety review for schema and infrastructure migrations. Reports outage risk, data loss, and rollback impossibility.

- NOT NULL columns added without server-side default or backfill plan
- Column/table drops without a deprecation/grace period
- Type changes that may truncate or fail on existing data
- Index ops on large tables without `CONCURRENTLY` or equivalent
- Backfill scripts — batched, idempotent, resumable, lock-bounded
- Rollback path; data still recoverable after forward migration
- Application/migration ordering during rollout (expand/contract)
- Replication impact on large migrations

### api-contract

Public-contract impact. Flags everything that consumers will have to adapt to.

- Public function signatures — added/removed/reordered parameters, type changes
- Removed or renamed module exports
- Network/IPC contracts — request/response schemas, status codes, headers
- CLI surface — removed/renamed flags, changed defaults
- Configuration — removed/renamed keys, changed semantics
- Database schema — column drops, type changes, NOT NULL adds
- Semver implications and whether the version bump is correct

### dependency-audit

Dependency-level concerns — versions, licences, supply chain. Code-level vulnerabilities are `security-audit`'s job.

- Version pinning per project policy
- Major version bumps and required migrations
- Licence compatibility
- Supply chain — reputable source, not typosquat, maintained
- Transitive dependencies introduced
- Removed deps — leftover imports, configuration, generated files
- Lockfile consistency

### research-completeness

Runs against research artefacts (notes, design docs, ADRs), not implementation code.

- Question coverage — original task fully addressed, not partially
- Alternatives — credible alternative approaches mentioned and compared
- Trade-offs stated for each option, not just one
- Known constraints (budget, time, compatibility) factored in
- Open questions called out explicitly
- Clear recommendation, not a neutral punt
- Scope drift from the original question, explained when present

### evidence-quality

Also for research artefacts — flags unsupported claims and hand-wavy reasoning.

- Codebase claims tied to file paths and line numbers
- External-system claims linked to docs, RFCs, source
- Numbers and benchmarks — methodology described, data reproducible
- Comparisons — "better than" comes with explicit criterion
- Confidence calibration — distinguishes "verified" from "assumed"
- Citations for specific behaviour (commit SHA, doc URL, code line)
- No outdated references to deleted code or removed APIs

## Output format

The skill replies with one block per finding plus a summary line. Example:

```
[1] critical · security-audit · auth/login.py:42
    Issue: SQL injection in the WHERE clause via unescaped user.name
    Fix:   Use parameterized query (cursor.execute("... WHERE name = ?", (name,)))

[2] major · quality, error-handling · api/users.py:88
    Issue: Missing null check on user.name; raises AttributeError on anonymous
    Fix:   Add guard before .name access (if not user or not user.name: return)

2 issues across 3 reviewers — profile: security
```

Sort order: `critical` → `major` → `minor` → `nit`. Within a severity bucket, alphabetic by reviewer name, then by file path. Numbering follows the final sorted order. If two reviewers flag the same `file:line` + issue, they're merged into one block (both names comma-separated in the header).

Severity scale:

- `critical` — production data loss, security breach, hard crash on common input, broken shipped contract
- `major` — wrong behaviour in plausible cases, missing tests on a risky change, regression risk, performance cliff under realistic load
- `minor` — code smell with limited impact, missing-but-not-critical docs/log/metric
- `nit` — cosmetic, naming, light polish

## Bundled resources

- [`SKILL.md`](SKILL.md) — the prompt the host agent loads
- [`scripts/list-base-branches.sh`](scripts/list-base-branches.sh) — emits JSON of candidate base branches (Step 1)
- [`references/profiles.md`](references/profiles.md) — full profile-to-reviewer mapping, auto-detect rules, synonyms (Step 4)
- [`references/reviewers/<name>.md`](references/reviewers/) — 17 reviewer prompts, one per file (Step 5)
