# Review profiles

Each profile is a fixed list of reviewers. The skill picks one profile per run (Step 4 of `SKILL.md`).

## Profile → reviewers

| Profile       | Reviewers                                                                  |
|---------------|----------------------------------------------------------------------------|
| `universal`   | quality, implementation, architecture, testing, simplification, documentation, dead-code |
| `bug-fix`     | quality, regression, scope-creep, testing, error-handling, dead-code       |
| `feature`     | quality, implementation, architecture, testing, documentation, api-contract, dead-code   |
| `refactor`    | quality, simplification, architecture, scope-creep, testing, dead-code     |
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

When no explicit argument is given, run `git diff --stat <base>...HEAD` and inspect the changed paths + a quick sample of the diff. Pick the **first** profile whose trigger matches as the **base profile** (order matters — check top to bottom), then layer on any matching add-on reviewers (see "Add-on reviewers"):

1. **`migration`** — the diff is *dominated* by migration artifacts: all or nearly all changed files are migration files (Alembic `versions/`, Flyway, Liquibase changelogs, Prisma `migrations/`, a `migrations/` or `db/migrate/` directory) or standalone schema-DDL `*.sql` files (`CREATE`/`ALTER`/`DROP TABLE`, `ADD`/`DROP COLUMN`), with no substantial application-logic change alongside. If schema/migration files are only *part* of a larger change, do **not** pick `migration` here — fall through, detect the base profile from the rest of the diff, and attach the `migration-safety` add-on (see "Add-on reviewers").
2. **`security`** — files in auth/authn/authz/crypto/secrets/session paths; new uses of credentials, tokens, hashing, signing; changes to permission checks or middleware.
3. **`security`** (dependency-only variant) — only dependency manifests changed (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements*.txt`, lockfiles) and no other code. You may also manually add the `dependency-audit` reviewer on top.
4. **`performance`** — hot loops, caches, async/await boundaries, N+1 patterns, batching, large data processing, query optimization.
5. **`docs`** — only `*.md` / `docs/` changed.
6. **`research`** — only research notes / design docs / ADRs / RFC drafts.
7. **`bug-fix`** — small, focused diff in existing files AND commit messages mention "fix", "bug", "regression", "crash", a ticket id, etc.
8. **`feature`** — new files implementing a new capability, or new public API surface.
9. **`refactor`** — mostly renames / file moves / function extractions with no behavioural deltas.
10. **`universal`** — mixed or ambiguous (default fallback).

## Add-on reviewers

Some signals don't justify switching the whole profile but add a single lens on top of the base profile (explicit or auto-detected). Append the add-on's reviewer to the base profile's reviewer list — never drop a base reviewer. Announce and summarise as `<base> + <add-on>` (e.g. `feature + migration-safety`). Add-ons stack.

- **`migration-safety`** — add when the diff touches schema/migration artifacts (schema-DDL `*.sql`, ORM model column add/drop/type changes, migration directories) but is **not** migration-dominated (rule 1 above). This keeps the general review and layers the production-safety lens on top, instead of replacing the general review with the `migration` profile.
- **`dependency-audit`** — add when dependency manifests change alongside other code. (The dependency-*only* case stays a full profile via auto-detect rule 3.)
