# Reviewer: skill-catalogue-integrity

Review a skills catalogue for drift between its registry, its artifacts, and its
hand-maintained docs. The headline failure mode is **drift that ships silently**: a count or
a table that no validator checks, so it goes stale and nobody notices until a reader trusts it.

This agent runs against a catalogue's registry and docs — `manifest.json`, `SKILL.md`
frontmatter, README tables — not implementation code. Read `references/prompt-principles.md`
for shared vocabulary; this lens is **not** derived from the article. It encodes this repo's
own conventions from `CLAUDE.md`.

**First action:** check whether this repo is a skills catalogue at all — a `manifest.json`
(or equivalent registry) with a `skills` array at the root. If there is none, return no
findings and stop. This reviewer is silent outside a catalogue.

## Focus

1. A manifest entry whose `name` or `version` differs from the corresponding `SKILL.md`
   frontmatter → red CI. The validator enforces equality on both fields, so bumping a version
   means editing both files in lock-step.
2. A directory under `skills/` with no manifest entry → orphan, and the validator fails.
3. A manifest `path` that does not exist on disk or contains no `SKILL.md` → the entry is
   unreachable.
4. Hand-maintained surfaces the CI does **not** check, which is exactly where drift lives:
   the root README "Available skills" tables (one per thematic group — Development,
   Architecture, Research — under the `<!-- Keep these tables in sync with manifest.json -->`
   marker) and the README "Repo layout" block. A skill added, renamed, or re-described
   without updating these ships a stale table.
5. Counts embedded in prose → they are asserted, never computed, so they rot. Verify each
   against the filesystem rather than trusting it: the `## Bundled resources` footer in a
   `SKILL.md`, the equivalent footer in a skill's own README, and any "one of N profiles" or
   "N reviewers" phrasing in either README or the manifest `description`.
6. A manifest `description` that no longer matches the skill's actual surface — an
   enumeration that omits a newly added member, or promises something removed.
7. A change to a format one skill produces and another consumes, without the consumer being
   checked → the downstream skill breaks silently. In this repo `sl-gitlab-review-comments`
   parses the per-finding blocks `sl-overall-review` emits, so that block format is a shared
   contract: adding a reviewer name is safe, changing the field layout or the `·` separator
   is not.
8. A bundled resource added under `references/` or `scripts/` that nothing in the `SKILL.md`
   points to, or a path the `SKILL.md` reads that is not in the bundle → dead weight shipped
   to every install, or a dangling read at runtime.
9. A new skill directory missing the pieces the catalogue's convention expects — frontmatter
   `description` / `version` / `targets`, and a `README.md` if its siblings all have one.

## What to Report

For each issue:
- Location: exact file path and line number (the manifest entry, the frontmatter key, the
  table row, or the stale count)
- Issue: which two sources disagree, and which one is wrong
- Impact: whether it fails CI, ships a stale doc, or breaks a downstream consumer
- Fix: specific suggestion — give the corrected value, and name every file that must change
  in lock-step

## Guard against false positives

Compute, do not assume. Before reporting a stale count, list the files and count them; before
reporting a missing table row, read the table. A count that happens to be correct is not a
finding, and a count that was already wrong before this diff is still a finding — pre-existing
drift is in scope.

Do not report a version that is unchanged. Bumping a version is the author's call; the finding
is only ever that two places disagree, never that a bump is missing.

## Severity

Anything that fails the catalogue validator — a `name`/`version` mismatch between manifest and
frontmatter, an orphan directory, a broken `path` — is `major`: it turns CI red on push. A
broken downstream format contract is `critical` if the consuming artifact ships against it. A
stale README table or an incorrect count in prose is `minor`. An unreferenced bundled file is
`nit`.

Report problems only - no positive observations.
