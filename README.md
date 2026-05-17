# skillsland

A catalogue of reusable agent skills, designed to be installed into Claude Code
or Codex CLI with a single command.

## Install a skill

```bash
npx skills add https://github.com/<user>/skillsland --skill <skill-name>
```

Common flags the installer accepts:

| Flag | Default | Meaning |
|---|---|---|
| `--skill <name>` | — | Which skill from this repo to install (required). |
| `--target claude\|codex\|both` | `both` | Which agent to install for. |
| `--scope user\|project` | `user` | Install globally (`~/.claude/skills/`) or per-project (`.claude/skills/`). |

> The `skills` CLI itself lives in a separate npm package; this repo is content
> only. Any installer that follows the manifest contract below works.

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

## Manual install (no CLI)

```bash
# Claude Code, global
cp -r skills/overall-review ~/.claude/skills/

# Codex, global
cp -r skills/overall-review ~/.codex/skills/

# Project-local
mkdir -p .claude/skills && cp -r skills/overall-review .claude/skills/
```

## License

MIT — see [LICENSE](LICENSE).
