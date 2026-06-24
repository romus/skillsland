# sl-gitlab-review-comments

Companion to [`sl-overall-review`](../sl-overall-review/). It takes the per-finding blocks that `/sl-overall-review` printed and adds them to the matching GitLab Merge Request as **pending draft review notes** — **inline on the right `file:line`** wherever the line is part of the MR diff, and as a general MR note otherwise. Each note is phrased in a suggestive register ("this could be a problem; here's how it could be fixed") and written as **Markdown** — code in the issue/fix is wrapped so GitLab highlights it. The note body shows only the severity, not which reviewer found the issue.

The drafts are **not published**: you review them in the GitLab UI and click **Submit review** to publish — a second pair of eyes on the findings, in context. It is read-only on your local code; the only external write is creating draft notes (after an explicit preview-and-confirm gate), and it never submits the review for you.

## When to use

Run `/sl-overall-review` first, then trigger this skill. Phrases the host agent recognises:

- "post the review to GitLab" / "comment on the MR" / "push review comments to GitLab" / "add the findings as inline comments"
- The slash command `/sl-gitlab-review-comments`

## Workflow at a glance

1. **Parse** the in-session `/sl-overall-review` findings into structured JSON (`scripts/parse-findings.mjs`).
2. **Detect transport** — glab CLI → GitLab MCP → REST, first available wins.
3. **Resolve** the project (from the git remote) and the MR (from the current branch as source branch); ask if it can't be detected.
4. **Choose what to post** — every run. Pick specific findings by number (`1,3,5`, `2-4`) and/or a minimum severity, and/or all.
5. **Verify** each finding against the working tree and the MR diff; classify the line (added / context / outside-diff).
6. **Preview** every draft and its anchor as plain-text blocks.
7. **Confirm** (Create draft notes / Dry-run / Cancel) — mandatory before any write.
8. **Create draft notes** via the detected transport, idempotently — never published.
9. **Report** what was drafted inline, drafted as a general note, skipped as a duplicate, or could not be verified — plus the MR URL to go submit the review.

## Transports

Detected at runtime, in this order:

| Transport | Detect | Writes via | Auth |
|---|---|---|---|
| **glab CLI** | `command -v glab` + `glab auth status` | `glab api --method POST .../draft_notes --form ...` | glab's own login |
| **GitLab MCP** | a connected server exposing a draft-note/discussion create tool | the discovered MCP tool (falls back to REST/glab if it has no draft-note tool) | the MCP server |
| **REST** | `GITLAB_TOKEN` in the environment | `scripts/post-comment.mjs` | `GITLAB_TOKEN` env var |

glab has no first-class command for inline draft notes (`glab mr note` posts a *published, general* note only), so the positioned-draft path uses `glab api`. See [`references/gitlab-api.md`](references/gitlab-api.md) for the exact endpoints, position parameters, and the hunk-parsing rule.

## Token security

glab and MCP manage their own auth — the skill never touches a token on those paths. For the REST fallback:

- The token is read **only** from `GITLAB_TOKEN` in the environment, inside `scripts/post-comment.mjs`, and set as a `PRIVATE-TOKEN` header in-process via `fetch()`.
- It never appears on a command line (so it can't leak via `ps` or shell history — unlike `curl -H "PRIVATE-TOKEN: $TOKEN"`, which the shell expands into argv), is never written to disk, never logged, and is never requested in chat.
- Use a least-privilege **project access token** with the `api` scope and a short expiry. Do not paste it into the chat — `export GITLAB_TOKEN=…` in your shell instead.
- The instance URL is auto-derived from your git remote. For self-managed GitLab you can override it with `GITLAB_HOST`, which accepts a bare host (`gitlab.company.com`) or a full URL with scheme/port/subpath (`export GITLAB_HOST=https://gitlab.company.com:8443`). It defaults to `gitlab.com`.

## Idempotency

Each draft body carries a hidden marker (`<!-- sl-overall-review:sl-gitlab-review-comments fp=… -->`, invisible in the UI). On re-run the skill skips any finding whose fingerprint already exists on the MR — as a pending draft *or* an already-published discussion — so running it twice doesn't duplicate comments.

## Output

```
Drafted — NOT yet submitted. Review them in GitLab and click "Submit review" to publish.

Drafted inline (2):
  [1] critical · security-audit · auth/login.py:42 → !87
  [2] minor · testing · src/db.ts:90 (context) → !87

Drafted as general note (1):
  [3] major · regression · src/legacy.ts:12 — line outside MR diff

Skipped, already drafted (1):
  [4] nit · quality · src/db.ts:5

Summary: 2 inline, 1 general note, 1 dup-skipped, 0 unverified — MR !87 (group/sub/repo)
Submit at: https://gitlab.com/group/sub/repo/-/merge_requests/87
```

## Limitations (v0.3.0)

- Creates **draft notes only** — you click "Submit review" in GitLab to publish. The skill never submits for you.
- Single-line comments only — multi-line ranges (`position[line_range]`) are not yet supported.
- Findings cite lines in **new-file** coordinates (what a reviewer reads), so comments anchor on the post-change side of the diff; lines that exist only as deletions fall back to a general note.

## Bundled resources

- [`SKILL.md`](SKILL.md) — the prompt the host agent loads
- [`scripts/parse-findings.mjs`](scripts/parse-findings.mjs) — finding-block text → JSON (Step 1)
- [`scripts/post-comment.mjs`](scripts/post-comment.mjs) — REST poster; classifies, dedupes, creates draft notes (Step 8)
- [`references/gitlab-api.md`](references/gitlab-api.md) — endpoints, position rule, hunk rule, glab form, token notes
