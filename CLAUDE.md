# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A catalogue of reusable agent skills (prompts + bundled resources) consumed by the [`skills` CLI from vercel-labs](https://github.com/vercel-labs/skills) (`npx skills add romus/skillsland`). The repo ships **content**, not executable code — there is no application to build, no test suite, no runtime. The only program here is a tiny manifest validator.

The skills are not independent: `sl-gitlab-review-comments` is a **downstream consumer** of `sl-overall-review`. It takes the per-finding blocks `sl-overall-review` emits (see its Step 7 output format) and posts them as GitLab MR draft review notes. So the per-finding block format is a contract shared across both skills — changing it in `sl-overall-review` can break `sl-gitlab-review-comments`. Check both when editing that format.

## Commands

There is exactly one:

```bash
node scripts/validate-manifest.mjs
```

Runs in the GitHub Actions CI on every push to `main` and every PR (`.github/workflows/validate.yml`). Zero dependencies, requires Node 20+. Run it locally after any change to `manifest.json` or any `skills/<name>/SKILL.md`.

## Architecture

`manifest.json` is the single source of truth — every skill in `skills/` must be registered there. The validator (`scripts/validate-manifest.mjs`) enforces a **two-way** cross-check that is the easiest thing to break:

- For every manifest entry: the `path` must exist on disk, contain a `SKILL.md`, and the SKILL.md's YAML frontmatter `name` and `version` **must equal** the manifest entry's `name` and `version`. Bumping a skill version means editing both files in lock-step.
- For every directory under `skills/`: it must appear in `manifest.json`. An orphan directory fails CI.

`schema/manifest.schema.json` describes the manifest shape (referenced via `$schema` for editor hints); the validator itself doesn't use it — it does its own structural checks plus the frontmatter cross-check the schema can't express.

What the validator does **not** check: `README.md`'s **Available skills** tables (near the top — one per thematic group: Development, Architecture, Research) and its **Repo layout** block are maintained by hand. Adding, renaming, or re-describing a skill means updating those tables in lock-step too — there's a `<!-- Keep these tables in sync with manifest.json -->` marker above them, but nothing in CI enforces it, so a stale table ships silently.

## Skill anatomy

A skill is a directory `skills/<name>/` containing:

- **`SKILL.md`** (required) — YAML frontmatter (`name`, `description`, `version`, optional `targets`, `allowed-tools`, `tags`) followed by the prompt body the host agent loads.
- **`README.md`** (optional) — human-readable docs for the skill; `SKILL.md` is for the agent, this is for the developer.
- **`references/`** (optional, by convention) — supporting documents the SKILL.md tells the agent to read at runtime (e.g. `references/profiles.md`, `references/reviewers/*.md` in `sl-overall-review`). Splitting long prompt content into references keeps SKILL.md scannable.
- **`scripts/`** (optional, by convention) — helper scripts the skill invokes at runtime (e.g. shell scripts emitting JSON for the agent to parse). Subdirs aren't enumerated in the manifest; they're discovered via paths inside SKILL.md.

The `description` field in frontmatter is **how the agent decides to load the skill** — it must literally include the trigger phrases users would say (e.g. "review my changes", `/<skill-name>`). Treat it as a discovery key, not a tagline.

## Cross-runtime authoring notes

Skills here target both Claude Code and Codex CLI (declared in `targets:`). Three things bite if you ignore them:

1. **Output format must render in plain terminals.** Codex CLI shows responses as raw text without a Markdown renderer, so `| col | col |` tables collapse to pipe-noise. The convention in this repo is per-finding blocks (see `skills/sl-overall-review/SKILL.md` Step 7 for the format).
2. **Tool availability differs.** Claude Code has `Agent` (sub-agents) and `AskUserQuestion`; Codex doesn't expose the same surface. When a SKILL.md depends on a Claude-only tool, give a Codex fallback inline rather than branching the file.
3. **Codex stores prompts as a single `.md` file** in `~/.codex/prompts/<name>.md`. Bundled `references/` and `scripts/` are copied alongside by `npx skills` so runtime paths still work — don't assume they won't.

## Installer

The README documents installation via `npx skills add ...`. That CLI is published as [`skills` on npm](https://www.npmjs.com/package/skills) and maintained by vercel-labs — **not** by this repo. Don't add an installer here; if the upstream CLI is missing a feature, file it there.
