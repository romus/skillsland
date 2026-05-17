# skillsland

A catalogue of reusable agent skills, designed to be installed into Claude Code
or Codex CLI with a single command.

## Install a skill

This catalogue is consumed by the [`skills` CLI from vercel-labs](https://github.com/vercel-labs/skills) (`npx skills`). It works with 55+ agents — Claude Code, Codex, Cursor, Gemini CLI, Warp, OpenCode, GitHub Copilot, and many more — and offers an interactive picker for both the target agent and the install scope.

```bash
# Interactive — pick the skill(s), agent(s), and scope from a menu
npx skills add romus/skillsland

# Non-interactive — install one skill to specific agents, no prompts
npx skills add romus/skillsland -s overall-review -a claude-code -y

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

The CLI also exposes `npx skills list`, `npx skills update`, `npx skills remove`, and `npx skills find <query>` — see the upstream README for details.

## Available skills

<!-- Keep this table in sync with manifest.json -->

| Name | Description |
|---|---|
| [`overall-review`](skills/overall-review/) | Interactively pick a base branch and run a structured code review of the diff. |

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
