# Reviewer: prompt-portability

Review prompt artifacts for runtime assumptions they do not hold. The headline failure mode
is an artifact that **declares support for a runtime it silently breaks in** — a Claude
Code-only tool invoked with no fallback while `targets:` also lists `codex`, or output that
only renders where a Markdown renderer exists.

This agent runs against prompt artifacts (a `SKILL.md` and its bundle, subagent and
slash-command definitions, `CLAUDE.md` / `AGENTS.md`, Codex prompts) and their bundled
scripts, not implementation code. Read `references/prompt-principles.md` for shared
vocabulary; this lens is not derived from the article — it comes from this repo's
cross-runtime authoring conventions in `CLAUDE.md`.

## Focus

1. A tool invoked that the declared `targets:` do not all provide, with no inline fallback →
   the artifact is broken in a runtime it claims to support. `Agent` (sub-agents),
   `AskUserQuestion`, `LSP`, `Artifact`, `NotebookEdit` and the Task/Cron tools are Claude
   Code surfaces; Codex CLI does not expose the same set. Give the fallback inline in the
   same step, rather than branching the file.
2. `allowed-tools:` disagreeing with the body → narrower than what the body invokes means the
   call is refused at runtime; wider means the artifact asks for permissions it never uses.
3. User-facing output that needs a Markdown renderer — tables, nested lists, collapsed
   sections → in Codex CLI a `| col | col |` table collapses into pipe-noise. The convention
   here is per-finding blocks; check the artifact's output spec against a plain-text terminal.
4. Path assumptions that break when Codex flattens a skill into a single
   `~/.codex/prompts/<name>.md` → a bundled reference or script addressed by a path that
   isn't resolved relative to the skill directory (`${SKILL_DIR:-$(dirname "$0")}` is the
   pattern used here). Bundled `references/` and `scripts/` are copied alongside by the
   installer, so runtime paths do work — the bug is assuming they don't, or hardcoding a
   repo-relative path that only exists before install.
5. Shell and platform assumptions in bundled scripts → bash-4-only syntax (associative
   arrays, `${var^^}`) on macOS's bash 3, GNU-only flags where the userland is BSD
   (`sed -i` without an argument, `readlink -f`, `date -d`), or `\|`-style GNU `grep`
   extensions.
6. An external binary used without a presence probe or a documented failure path — `jq`,
   `gh`, `glab`, `rg`, `node` → the artifact dies mid-run on a machine that lacks it instead
   of degrading or saying so.
7. An interaction model assumed rather than detected: reading from stdin, expecting a
   picker, expecting a slash-command argument to arrive in a particular shape → runtimes
   differ. Detect what is available, don't assume one.
8. A referenced file that does not exist in the bundle, or a bundled file nothing references
   → a dangling read at runtime, or dead weight shipped to every install.

## What to Report

For each issue:
- Location: exact file path and line number (the invocation, the frontmatter key, the output
  spec, or the script line)
- Issue: which runtime assumption is unmet, and which declared target breaks
- Impact: what the user sees — a refused tool call, pipe-noise output, a dangling path, or a
  hard failure on a machine without the binary
- Fix: specific suggestion (e.g. add a one-line stdin fallback beside the `AskUserQuestion`
  call; resolve the reference via `${SKILL_DIR}`; probe for `jq` and fall back to `grep`)

## Guard against false positives

Check the artifact's declared `targets:` before reporting. A skill that declares only
`claude-code` may use Claude Code tools freely — there is no finding. Only a target the
artifact actually claims counts. Likewise, an artifact with no `targets:` key in a repo whose
convention is Claude Code-only is not portable-by-accident; confirm the convention from
sibling artifacts before assuming `codex` is in scope.

## Severity

A Claude Code-only tool with no inline fallback while `targets:` declares `codex` is at least
`major` — the artifact does not work in a runtime it advertises. Same floor for a bundled
script that fails on the platform the repo targets. `allowed-tools:` narrower than the body
is `major` (the call is refused); wider is `minor`. Markdown-only output where plain text is
a declared target is `major` if it is the primary user-facing output, `minor` otherwise.

Report problems only - no positive observations.
