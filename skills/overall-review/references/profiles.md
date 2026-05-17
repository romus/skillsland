# Review profiles

Each profile is a fixed list of reviewers. The skill picks one profile per run (Step 4 of `SKILL.md`).

## Profile → reviewers

| Profile       | Reviewers                                                                  |
|---------------|----------------------------------------------------------------------------|
| `universal`   | quality, implementation, testing, simplification, documentation, dead-code |
| `bug-fix`     | quality, regression, scope-creep, testing, error-handling, dead-code       |
| `feature`     | quality, implementation, testing, documentation, api-contract, dead-code   |
| `refactor`    | quality, simplification, scope-creep, testing, dead-code                   |
| `research`    | research-completeness, evidence-quality, documentation                     |
| `performance` | performance, quality, testing, dead-code                                   |
| `security`    | security-audit, quality, testing, error-handling, dead-code                |
| `migration`   | migration-safety, quality, testing, dependency-audit, dead-code            |
| `docs`        | documentation                                                              |

Reviewer prompts live in `reviewers/<name>.md`, one file per reviewer.

## Explicit argument — synonyms

If the user passes a profile name to `/overall-review`, match it case-insensitively. Synonyms:

- `bug`, `fix`, `bugfix` → `bug-fix`
- `perf` → `performance`
- `sec` → `security`
- `doc`, `docs` → `docs`
- `feat` → `feature`
- `mig` → `migration`
- `ref` → `refactor`
- `res` → `research`
- `uni`, `all` → `universal`

Anything that doesn't match a profile name or synonym: ignore the argument and fall through to auto-detect.

## Auto-detect from diff

When no explicit argument is given, run `git diff --stat <base>...HEAD` and inspect the changed paths + a quick sample of the diff. Pick the **first** profile whose trigger matches (order matters — check top to bottom):

1. **`migration`** — files matching `*migration*`, `*.sql`, schema/model files with column add/drop/type changes, Alembic/Liquibase/Flyway/Prisma migration directories.
2. **`security`** — files in auth/authn/authz/crypto/secrets/session paths; new uses of credentials, tokens, hashing, signing; changes to permission checks or middleware.
3. **`security`** (dependency-only variant) — only dependency manifests changed (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements*.txt`, lockfiles) and no other code. You may also manually add the `dependency-audit` reviewer on top.
4. **`performance`** — hot loops, caches, async/await boundaries, N+1 patterns, batching, large data processing, query optimization.
5. **`docs`** — only `*.md` / `docs/` changed.
6. **`research`** — only research notes / design docs / ADRs / RFC drafts.
7. **`bug-fix`** — small, focused diff in existing files AND commit messages mention "fix", "bug", "regression", "crash", a ticket id, etc.
8. **`feature`** — new files implementing a new capability, or new public API surface.
9. **`refactor`** — mostly renames / file moves / function extractions with no behavioural deltas.
10. **`universal`** — mixed or ambiguous (default fallback).
