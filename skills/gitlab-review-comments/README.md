# gitlab-review-comments

Companion to [`overall-review`](../overall-review/). It takes the per-finding blocks that `/overall-review` printed and posts them onto the matching GitLab Merge Request — **inline on the right `file:line`** wherever the line is part of the MR diff, and as a general MR note otherwise.

It is read-only on your local code. The only external write is creating MR comments, and only after an explicit preview-and-confirm gate.

## When to use

Run `/overall-review` first, then trigger this skill. Phrases the host agent recognises:

- "post the review to GitLab" / "comment on the MR" / "push review comments to GitLab" / "add the findings as inline comments"
- The slash command `/gitlab-review-comments`

## Workflow at a glance

1. **Parse** the in-session `/overall-review` findings into structured JSON (`scripts/parse-findings.mjs`).
2. **Detect transport** — glab CLI → GitLab MCP → REST, first available wins.
3. **Resolve** the project (from the git remote) and the MR (from the current branch as source branch); ask if it can't be detected.
4. **Choose what to post** — every run. Pick specific findings by number (`1,3,5`, `2-4`) and/or a minimum severity, and/or all.
5. **Verify** each finding against the working tree and the MR diff; classify the line (added / context / outside-diff).
6. **Preview** every comment and its anchor as plain-text blocks.
7. **Confirm** (Post all / Dry-run / Cancel) — mandatory before any write.
8. **Post** via the detected transport, idempotently.
9. **Report** what was posted inline, fell back to a general note, was skipped as a duplicate, or could not be verified.

## Transports

Detected at runtime, in this order:

| Transport | Detect | Posts via | Auth |
|---|---|---|---|
| **glab CLI** | `command -v glab` + `glab auth status` | `glab api --method POST .../discussions --form ...` | glab's own login |
| **GitLab MCP** | a connected server exposing MR discussion/note tools | the discovered MCP tool | the MCP server |
| **REST** | `GITLAB_TOKEN` in the environment | `scripts/post-comment.mjs` | `GITLAB_TOKEN` env var |

glab has no first-class command for inline diff comments (`glab mr note` posts a *general* note only), so the positioned-comment path uses `glab api`. See [`references/gitlab-api.md`](references/gitlab-api.md) for the exact endpoints, position parameters, and the hunk-parsing rule.

## Token security

glab and MCP manage their own auth — the skill never touches a token on those paths. For the REST fallback:

- The token is read **only** from `GITLAB_TOKEN` in the environment, inside `scripts/post-comment.mjs`, and set as a `PRIVATE-TOKEN` header in-process via `fetch()`.
- It never appears on a command line (so it can't leak via `ps` or shell history — unlike `curl -H "PRIVATE-TOKEN: $TOKEN"`, which the shell expands into argv), is never written to disk, never logged, and is never requested in chat.
- Use a least-privilege **project access token** with the `api` scope and a short expiry. Do not paste it into the chat — `export GITLAB_TOKEN=…` in your shell instead.
- The instance URL is auto-derived from your git remote. For self-managed GitLab you can override it with `GITLAB_HOST`, which accepts a bare host (`gitlab.company.com`) or a full URL with scheme/port/subpath (`export GITLAB_HOST=https://gitlab.company.com:8443`). It defaults to `gitlab.com`.

## Idempotency

Each posted comment body carries a hidden marker (`<!-- overall-review:gitlab-review-comments fp=… -->`, invisible in the UI). On re-run the skill skips any finding whose fingerprint already exists on the MR, so running it twice doesn't duplicate comments.

## Output

```
Posted inline (2):
  [1] critical · security-audit · auth/login.py:42 → !87
  [2] minor · testing · src/db.ts:90 (context) → !87

Fell back to general note (1):
  [3] major · regression · src/legacy.ts:12 — line outside MR diff

Skipped, already posted (1):
  [4] nit · quality · src/db.ts:5

Summary: 2 inline, 1 general note, 1 dup-skipped, 0 unverified — MR !87 (group/sub/repo)
```

## Limitations (v0.1.0)

- Single-line comments only — multi-line ranges (`position[line_range]`) are not yet supported.
- Findings cite lines in **new-file** coordinates (what a reviewer reads), so comments anchor on the post-change side of the diff; lines that exist only as deletions fall back to a general note.

## Bundled resources

- [`SKILL.md`](SKILL.md) — the prompt the host agent loads
- [`scripts/parse-findings.mjs`](scripts/parse-findings.mjs) — finding-block text → JSON (Step 1)
- [`scripts/post-comment.mjs`](scripts/post-comment.mjs) — REST poster; classifies, dedupes, posts (Step 8)
- [`references/gitlab-api.md`](references/gitlab-api.md) — endpoints, position rule, hunk rule, glab form, token notes
