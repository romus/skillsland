# skillsland

A catalogue of reusable agent skills. A skill is a prompt plus bundled resources
(scripts, reference docs) that teaches your coding agent a repeatable workflow —
like running a multi-perspective code review. Install any of them into Claude Code,
Codex, and 55+ other agents with a single command.

## Available skills

<!-- Keep this table in sync with manifest.json -->

| Name | Description |
|---|---|
| [`sl-overall-review`](skills/sl-overall-review/) | Multi-perspective code review of the current branch against a base you pick. Selects one of 11 profiles (universal / bug-fix / feature / refactor / research / performance / security / migration / algorithm / messaging / docs) and runs the matching reviewers in parallel. Full docs and reviewer breakdown: [skills/sl-overall-review/README.md](skills/sl-overall-review/README.md). |
| [`sl-gitlab-review-comments`](skills/sl-gitlab-review-comments/) | Adds `/sl-overall-review` findings to a GitLab MR as **pending draft review notes** (inline on the diff; you click "Submit review" in GitLab to publish), phrased in a suggestive register, with preview/confirm, per-run selection of findings (by number and/or severity), idempotent re-runs, and a general-note fallback for lines outside the diff. Detects glab CLI / GitLab MCP / REST. Full docs: [skills/sl-gitlab-review-comments/README.md](skills/sl-gitlab-review-comments/README.md). |
| [`sl-deepen-architecture`](skills/sl-deepen-architecture/) | Studies the **resting codebase** and proposes up to 3–4 high-leverage architecture improvements grounded in deep-module design (locality & leverage, _A Philosophy of Software Design_), ranked by strength. Reads context docs (CLAUDE.md / ARCHITECTURE.md / ADRs) and optionally LSP / a JetBrains-IDE MCP; runs six analysis lenses in parallel. Delivers either a self-contained HTML report (cards with Files / Problem / Solution / Benefits / Before-After SVG diagram / strength badge) saved to `.skillsland/deepen-architecture/`, or plain text with ASCII diagrams in the chat. Read-only on code. Full docs: [skills/sl-deepen-architecture/README.md](skills/sl-deepen-architecture/README.md). |

## Install a skill

This catalogue is consumed by the [`skills` CLI from vercel-labs](https://github.com/vercel-labs/skills) (`npx skills`). It works with 55+ agents — Claude Code, Codex, Cursor, Gemini CLI, Warp, OpenCode, GitHub Copilot, and many more — and offers an interactive picker for both the target agent and the install scope.

```bash
# Interactive — pick the skill(s), agent(s), and scope from a menu
npx skills add romus/skillsland

# Non-interactive — install one skill to specific agents, no prompts
npx skills add romus/skillsland -s sl-overall-review -a claude-code -y

# Install every skill from this repo to every detected agent
npx skills add romus/skillsland --all
```

Useful flags (full list at [vercel-labs/skills](https://github.com/vercel-labs/skills)):

| Flag | Meaning |
|---|---|
| `-s, --skill <names...>` | Which skill(s) from this repo to install. Omit to pick interactively. |
| `-a, --agent <agents...>` | Target agent(s) by name (e.g. `claude-code`). Omit to pick from a menu. |
| `-g, --global` | Install globally (e.g. `~/.claude/skills/`) instead of per-project (`.claude/skills/`, the default). |
| `--copy` | Copy files instead of symlinking. |
| `-y, --yes` | Skip confirmation prompts. |
| `--all` | Install all skills to all detected agents, no prompts. |

The CLI also exposes `npx skills find <query>` for discovery and `npx skills list` (alias `ls`) to see what's already installed — see the upstream README for details.

## Update installed skills

`npx skills update` re-fetches skills you've already installed and refreshes them in place. By default it prompts for scope; `-y` skips that prompt — using `-g`/`-p` if given, otherwise auto-detecting (project when run inside a project, else global).

```bash
# Update every installed skill (interactive scope prompt)
npx skills update

# Update one skill by name
npx skills update sl-overall-review

# Update several at once
npx skills update sl-overall-review <other-skill>

# Scope to global installs only, no prompts
npx skills update -g -y
```

| Flag | Meaning |
|---|---|
| `-g, --global` | Update only globally-installed skills. |
| `-p, --project` | Update only project-installed skills. |
| `-y, --yes` | Skip the scope prompt. With `-g`/`-p` it just suppresses the prompt for that scope; on its own it auto-detects (project in a project dir, else global). |

## Remove a skill

`npx skills remove` (alias `rm`) uninstalls skills. By default it targets project scope.

```bash
# Interactive — pick what to remove from the installed list
npx skills remove

# Remove a specific skill
npx skills remove sl-overall-review

# Same, using the alias
npx skills rm sl-overall-review

# Remove from global scope instead of project
npx skills remove sl-overall-review -g

# Remove one skill from a specific agent only
npx skills remove -s sl-overall-review -a claude-code

# Remove all project skills from every agent, no prompts (add -g for global)
npx skills remove --all
```

| Flag | Meaning |
|---|---|
| `-g, --global` | Remove from global scope instead of the default project scope. |
| `-a, --agent <agents...>` | Target specific agents (`'*'` for all). |
| `-s, --skill <names...>` | Skills to remove (`'*'` for all). |
| `-y, --yes` | Skip confirmation prompts. |
| `--all` | Shorthand for `--skill '*' --agent '*' -y`. |

To see what's currently installed first, use `npx skills list` (alias `ls`); add `-g` for global or `-a <agent>` to filter by agent.

## Repo layout

```
manifest.json                # registry — single source of truth
schema/manifest.schema.json  # JSON Schema for manifest.json
skills/<name>/
  SKILL.md                   # YAML frontmatter + body
  scripts/                   # optional bundled scripts
  references/                # optional supporting docs
  assets/                    # optional templates
scripts/validate-manifest.mjs  # CI validator (no deps)
.github/workflows/validate.yml
```

## Authoring a new skill

1. Create `skills/<your-skill>/SKILL.md` with this frontmatter:
   ```yaml
   ---
   name: your-skill
   description: This skill should be used when the user asks to "...". <one-line summary>
   version: 0.1.0
   targets: [claude-code, codex]   # optional, defaults to both
   allowed-tools: [Bash, Read]     # optional, Claude-Code-specific
   tags: [...]                      # optional
   ---
   ```
   The `description` **must include trigger phrases** — that's how the agent
   decides when to load the skill.

2. Add bundled resources alongside SKILL.md as needed
   (`scripts/`, `references/`, `assets/`, `examples/`).

3. Register the skill in `manifest.json`.

4. Run the validator:
   ```bash
   node scripts/validate-manifest.mjs
   ```

## License

MIT — see [LICENSE](LICENSE).
