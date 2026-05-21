---
name: gitlab-review-comments
description: This skill should be used when the user asks to "post the review to GitLab", "comment on the MR", "push review comments to GitLab", "add the findings as inline comments", or invokes "/gitlab-review-comments". Takes the per-finding blocks produced by /overall-review and posts them as inline diff comments (positioned discussions) on the matching GitLab Merge Request, with a mandatory preview-and-confirm gate, a per-run selection of which findings to post (explicit finding numbers and/or a severity threshold), idempotent re-runs, and a general-note fallback for lines outside the MR diff. Detects transport (glab CLI, GitLab MCP, then REST). Read-only on local code; the only external write is creating MR comments after explicit confirmation.
version: 0.1.0
targets:
  - claude-code
  - codex
allowed-tools:
  - Bash
  - Read
  - Grep
  - AskUserQuestion
tags: [git, gitlab, review, merge-request, code-review]
---

# GitLab Review Comments — post overall-review findings onto a Merge Request

You take the findings that `/overall-review` produced in this conversation and post them as comments on the matching GitLab Merge Request — inline on the right `file:line` where possible. Follow the steps in order.

**Hard rules for the entire run:**
- **Read-only on local code.** Do not edit, stage, or commit anything. The only external write is creating MR comments, and only after the Step 7 confirmation gate.
- **Never handle the token in the open.** Do not ask the user to paste a token into the chat, do not echo it, do not log it, do not pass it as a command argument. If a token value ever appears, redact it. Auth flows through glab/MCP, or through `GITLAB_TOKEN` in the environment (read inside the poster script only).
- **No finding is dropped silently.** Every selected finding is either posted inline, posted as a general-note fallback, skipped as a duplicate, or reported as unverified — and the final report says which.

---

## Step 0 — Preconditions

Confirm there are `/overall-review` findings to work with **in this conversation** — the per-finding blocks of the form `[<n>] <severity> · <reviewer> · <file:line>` with `Issue:`/`Fix:` lines. If there are none, tell the user to run `/overall-review` first (or paste its output), and stop. Do not invent findings.

---

## Step 1 — Parse the findings

Pipe the finding-block text into the bundled parser (quoted heredoc so nothing is shell-expanded):

```bash
node "${SKILL_DIR:-$(dirname "$0")}/scripts/parse-findings.mjs" <<'FINDINGS'
[1] critical · security-audit · auth/login.py:42
    Issue: ...
    Fix:   ...
...
FINDINGS
```

Parse the JSON: `{findings:[{n,severity,reviewers,file,line,issue,fix}], summary, warnings}`. Surface any `warnings`. If `findings` is empty, report that and stop.

---

## Step 2 — Detect the transport

Pick the first one that is available; stop at the first hit:

1. **glab CLI** — `command -v glab` succeeds **and** `glab auth status` exits 0.
2. **GitLab MCP** — a connected MCP server exposes merge-request discussion/note creation tools. Discover by scanning available tool names for ones containing `merge_request`/`discussion`/`note` together with `create`/`post`; do not hardcode a name. (MCP tools exist only in Claude Code; in Codex this simply falls through.)
3. **REST** — `GITLAB_TOKEN` is set in the environment.

If none is available, print setup instructions and stop: either `glab auth login`, or connect a GitLab MCP server, or `export GITLAB_TOKEN=<token>` (a least-privilege **project access token** with the `api` scope and a short expiry). For self-managed GitLab also `export GITLAB_HOST=<url-or-host>` — the host is otherwise auto-derived from the git remote; `GITLAB_HOST` accepts a bare host (`gitlab.company.com`) or a full URL with scheme/port/subpath (`https://gitlab.company.com:8443`). Add the explicit warning: **do not paste the token into this chat.**

See `references/gitlab-api.md` for the exact glab and REST mechanics.

---

## Step 3 — Resolve the project and the MR

- **Project path:** parse `git remote get-url origin` (or `git config --get remote.origin.url`). Normalize both SSH (`git@host:group/sub/repo.git`) and HTTPS (`https://host/group/sub/repo.git`) — capture the host, strip the trailing `.git`, keep nested subgroups. URL-encode the path (`/` → `%2F`) for REST.
- **MR IID:** the current branch (`git rev-parse --abbrev-ref HEAD`) is normally the MR source branch.
  - glab: `glab mr list --source-branch "<branch>" --output json`
  - REST: `GET /projects/:id/merge_requests?source_branch=<branch>&state=opened`
  - 0 results → ask the user for the MR IID or URL. >1 result → list them and ask which.
- If the remote is not a GitLab host (e.g. a GitHub `origin`) or detection fails, ask the user for the project path and MR IID directly.

Hold the resolved `host · project · !<iid> · "<title>"` for the Step 7 gate.

---

## Step 4 — Choose which findings to post (every run)

First print the full list so the user can see what's on offer — one line each: `[<n>] <severity> · <reviewer> · <file>:<line>`.

Then ask what to post. **Not just categories — explicit numbers too:**

- **Claude Code:** call `AskUserQuestion` with options: "All", "critical + major", "Only critical", and "Pick numbers". For "Pick numbers" the user types via the free-text "Other" field, e.g. `1,3,5` or `2-4,7`.
- **Codex / plain CLI:** print a numbered menu and read one line from stdin. Accept: a list (`1,3,5`), ranges (`2-4`), `all`, or a severity keyword (`crit`/`major`/`minor`/`nit`) used as a minimum threshold.

Resolve the answer to a concrete set of finding numbers: a severity threshold expands to the numbers of all findings at or above it; explicit numbers select exactly those. Everything downstream operates only on the selected findings.

---

## Step 5 — Verify each selected finding (mandatory)

For each selected finding:

1. **Working tree:** open the cited `file` at `line` (Read/Grep) and confirm it exists and is plausibly what the finding describes. If the file or line is gone, mark the finding **unverified — not posted**.
2. **MR diff:** classify the line against the MR diff using the hunk rule in `references/gitlab-api.md` (added → `new_line` only; context → both `new_line` and `old_line`; line not in any hunk, or file not in the MR → **general-note fallback**).
   - On the **REST** path the poster does this classification itself (it fetches `/diffs`); you pass it `{fp, file, line, body}` and read the resulting `anchor`/`reason`.
   - On the **glab/MCP** path, fetch the MR diff yourself (`glab api ".../merge_requests/<iid>/diffs"`) and apply the same rule to build each position.

Compute a stable fingerprint per finding, `fp = sha8(file|line|issue)` (first 8 hex of SHA-256), used for idempotency. Render each comment body as:

```
**<severity> · <reviewer>** — overall-review
Issue: <issue>
Fix: <fix>
```

---

## Step 6 — Build the preview

For every surviving finding, show exactly what will happen — plain-text blocks, one per line, **no Markdown tables** (they collapse in plain terminals):

```
[1] critical · security-audit · auth/login.py:42  → inline (added line)
[2] minor · testing · src/db.ts:90               → inline (context line)
[3] major · regression · src/legacy.ts:12        → general note (line outside MR diff)
[4] nit · quality · src/db.ts:5                   → skip (already posted)
```

---

## Step 7 — Confirmation gate (mandatory)

Show the preview together with the resolved target: `host · project · !<iid> · "<title>"`. Posting publishes to an external service and is hard to undo, so require an explicit choice:

- **Claude Code:** `AskUserQuestion` — "Post all", "Dry-run only", "Cancel".
- **Codex / plain CLI:** numbered stdin prompt with the same three choices.

Dry-run is always available: it runs the full pipeline (including dedupe) but makes no writes. Do not proceed to Step 8 without an explicit confirmation.

---

## Step 8 — Post

- **glab** — one `glab api --method POST ".../discussions" --form ...` call per comment (full form in `references/gitlab-api.md`; use `--form`, never `-f`/`-F`). General-note fallback: only `--form "body=..."`.
- **MCP** — call the discovered create-discussion tool with the structured position fields; for a fallback, omit the position.
- **REST** — pipe a job document into the poster, with `GITLAB_TOKEN` already exported by the user:

  ```bash
  node "${SKILL_DIR:-$(dirname "$0")}/scripts/post-comment.mjs" <<'JOB'
  {
    "host": "<host>", "project": "<group/sub/repo>", "mr_iid": <iid>,
    "dry_run": false,
    "comments": [
      {"fp": "<sha8>", "file": "<path>", "line": <n>, "body": "<body>"}
    ]
  }
  JOB
  ```

  The poster fetches diff_refs, classifies lines, dedupes against existing discussions, and posts (or, with `"dry_run": true`, reports without writing).

For glab/MCP, fetch the MR discussions yourself first and skip any finding whose `fp` already appears, so re-runs stay idempotent.

---

## Step 9 — Report (this is the entire user-facing reply)

Plain-text, terminal-renderable, no tables. Group by outcome and end with a summary line:

```
Posted inline (2):
  [1] critical · security-audit · auth/login.py:42 → !87
  [2] minor · testing · src/db.ts:90 (context) → !87

Fell back to general note (1):
  [3] major · regression · src/legacy.ts:12 — line outside MR diff

Skipped, already posted (1):
  [4] nit · quality · src/db.ts:5

Could not verify, not posted (0): —

Summary: 2 inline, 1 general note, 1 dup-skipped, 0 unverified — MR !87 (group/sub/repo)
```

For a dry-run, use the same layout under a `DRY RUN — nothing posted:` header.

---

## Bundled resources

- `scripts/parse-findings.mjs` — finding-block text (stdin) → normalized JSON (Step 1)
- `scripts/post-comment.mjs` — REST poster; reads `GITLAB_TOKEN` from env, classifies + dedupes + posts (Step 8)
- `references/gitlab-api.md` — endpoints, position rule, hunk-parsing rule, glab form, token-security notes, script contracts
