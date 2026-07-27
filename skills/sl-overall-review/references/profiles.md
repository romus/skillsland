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
| `performance` | performance, algorithm-efficiency, quality, testing, dead-code             |
| `security`    | security-audit, quality, testing, error-handling, dead-code                |
| `migration`   | migration-safety, quality, testing, dependency-audit, dead-code            |
| `algorithm`   | algorithm-efficiency                                                       |
| `messaging`   | messaging-patterns                                                         |
| `skill`       | prompt-overconstraint, prompt-context-economy, prompt-interface-design, prompt-portability, skill-discovery, skill-catalogue-integrity |
| `docs`        | documentation                                                              |

Reviewer prompts live in `reviewers/<name>.md`, one file per reviewer.

The `skill` profile reviews **prompt artifacts** rather than application code — a `SKILL.md`
and its bundle, subagent and slash-command definitions, `CLAUDE.md` / `AGENTS.md`, Codex
prompts. Its reviewers share `prompt-principles.md`, which carries the context-engineering
principles they grade against; pass that file to each of them alongside the reviewer prompt
(Step 5 of `SKILL.md`).

## Explicit argument — synonyms

If the user passes a profile name to `/sl-overall-review`, match it case-insensitively. Synonyms:

- `bug`, `fix`, `bugfix` → `bug-fix`
- `perf` → `performance`
- `sec` → `security`
- `doc`, `docs` → `docs`
- `feat` → `feature`
- `mig` → `migration`
- `ref` → `refactor`
- `res` → `research`
- `algo`, `alg`, `algorithms` → `algorithm`
- `mq`, `kafka`, `rabbit`, `rabbitmq`, `artemis`, `jms`, `messaging` → `messaging`
- `sk`, `skills`, `agent-skill`, `agent-skills`, `prompt`, `prompts`, `prompting` → `skill`
- `uni`, `all` → `universal`

Anything that doesn't match a profile name or synonym: ignore the argument and fall through to auto-detect.

## Auto-detect from diff

When no explicit argument is given, run `git diff --stat <base>...HEAD` and inspect the changed paths + a quick sample of the diff. Pick the **first** profile whose trigger matches as the **base profile** (order matters — check top to bottom), then layer on any matching add-on reviewers (see "Add-on reviewers"):

1. **`migration`** — the diff is *dominated* by migration artifacts: all or nearly all changed files are migration files (Alembic `versions/`, Flyway, Liquibase changelogs, Prisma `migrations/`, a `migrations/` or `db/migrate/` directory) or standalone schema-DDL `*.sql` files (`CREATE`/`ALTER`/`DROP TABLE`, `ADD`/`DROP COLUMN`), with no substantial application-logic change alongside. If schema/migration files are only *part* of a larger change, do **not** pick `migration` here — fall through, detect the base profile from the rest of the diff, and attach the `migration-safety` add-on (see "Add-on reviewers").
2. **`security`** — files in auth/authn/authz/crypto/secrets/session paths; new uses of credentials, tokens, hashing, signing; changes to permission checks or middleware.
3. **`security`** (dependency-only variant) — only dependency manifests changed (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements*.txt`, lockfiles) and no other code. You may also manually add the `dependency-audit` reviewer on top.
4. **`performance`** — hot loops, caches, async/await boundaries, N+1 patterns, batching, large data processing, query optimization.
5. **`skill`** — the diff is *dominated* by prompt artifacts: all or nearly all changed files are prompt artifacts, with no substantial application-logic change alongside. A prompt artifact is any of:
   - any `SKILL.md`, plus its sibling bundle in the same skill directory (`references/**`, `scripts/**`, that skill's own `README.md`)
   - `.claude/skills/**`, `.agents/skills/**`
   - `.claude/agents/*.md` (subagent definitions), `.claude/commands/*.md` (slash commands)
   - `.codex/prompts/*.md`
   - `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/**`, `.github/copilot-instructions.md`
   - any other `*.md` whose YAML frontmatter carries both `name:` and `description:`
   - the catalogue surface a skill change drags along in lock-step: a skills registry (`manifest.json` or equivalent) and the README tables that mirror it. These ride along by convention rather than being prompts themselves, so count them as prompt artifacts for dominance — otherwise the two files every skill edit must touch would sink the rule they exist to serve. `skill-catalogue-integrity` is the reviewer that reads them.

   This rule sits **above `docs` deliberately**: prompt artifacts are mostly `*.md`, so rule 6 would otherwise swallow every SKILL.md-only diff and review it with a reviewer that only asks whether the README was updated. If prompt artifacts are only *part* of a larger change, do **not** pick `skill` here — fall through, detect the base profile from the rest of the diff, and attach the `prompt-overconstraint` add-on (see "Add-on reviewers").
6. **`docs`** — only `*.md` / `docs/` changed.
7. **`research`** — only research notes / design docs / ADRs / RFC drafts.
8. **`bug-fix`** — small, focused diff in existing files AND commit messages mention "fix", "bug", "regression", "crash", a ticket id, etc.
9. **`feature`** — new files implementing a new capability, or new public API surface.
10. **`refactor`** — mostly renames / file moves / function extractions with no behavioural deltas.
11. **`universal`** — mixed or ambiguous (default fallback).

Known ordering wart, left as-is: `research` (rule 7) is also `*.md`-shaped and therefore unreachable by auto-detect, because `docs` (rule 6) matches first. Invoke it explicitly (`/sl-overall-review research`) until that is fixed.

`algorithm` has no auto-detect trigger — invoke it explicitly (`/sl-overall-review algorithm`) when you want only the algorithm/network-efficiency lens. The `algorithm-efficiency` reviewer otherwise runs automatically inside the `performance` profile (rule 4).

`messaging` likewise has no auto-detect trigger — invoke it explicitly (`/sl-overall-review messaging`) when you want only the message-broker reliability lens. The `messaging-patterns` reviewer otherwise attaches automatically as an add-on whenever the diff touches broker code (see "Add-on reviewers").

## Add-on reviewers

Some signals don't justify switching the whole profile but add a single lens on top of the base profile (explicit or auto-detected). Append the add-on's reviewer to the base profile's reviewer list — never drop a base reviewer. Announce and summarise as `<base> + <add-on>` (e.g. `feature + migration-safety`). Add-ons stack.

- **`migration-safety`** — add when the diff touches schema/migration artifacts (schema-DDL `*.sql`, ORM model column add/drop/type changes, migration directories) but is **not** migration-dominated (rule 1 above). This keeps the general review and layers the production-safety lens on top, instead of replacing the general review with the `migration` profile.
- **`dependency-audit`** — add when dependency manifests change alongside other code. (The dependency-*only* case stays a full profile via auto-detect rule 3.)
- **`prompt-overconstraint`** — add when the diff touches any prompt artifact (see rule 5 for the list) but is **not** prompt-artifact-dominated: a `CLAUDE.md` tweak or a SKILL.md edit riding along with real code. Of the six `skill` reviewers this is the one worth spending on a stray prompt edit, because a rule added next to a code change is the likeliest to contradict what another layer already says — and a contradiction costs every later run, not just this one.
- **`messaging-patterns`** — add when the diff touches message-broker code: Spring messaging annotations (`@KafkaListener`, `@KafkaHandler`, `@RabbitListener`, `@JmsListener`), `KafkaStreams`/`StreamsBuilder` topologies, Kafka/AMQP/JMS client imports, or broker config (Kafka consumer/producer properties, `rabbitmq`/`amqp`, `artemis`/`activemq`, related `application.yml`/`.properties` blocks). Layers the broker-reliability lens on top of the base profile, since message-loss bugs ride along with feature/bug-fix/refactor diffs.
