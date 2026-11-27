---
name: sl-gitlab-review-comments
description: This skill should be used when the user asks to "post the review to GitLab", "comment on the MR", "push review comments to GitLab", "add the findings as inline comments", or invokes "/sl-gitlab-review-comments". Takes the findings from the /sl-overall-review report (B1…/I1… finding blocks with intended / actually / why it matters / fix) and adds them to the matching GitLab Merge Request as pending draft review notes — inline on the diff where possible — phrased in a suggestive register and formatted as Markdown (code is wrapped so GitLab highlights it); you eyeball them in the GitLab UI and click "Submit review" to publish. Mandatory preview-and-confirm gate, per-run selection of which findings to post (explicit finding IDs and/or a severity threshold), idempotent re-runs, and a general-note fallback for lines outside the MR diff. Detects transport (glab CLI, GitLab MCP, then REST). Read-only on local code; the only external write is creating draft notes — it never publishes or submits the review.
version: 0.5.0
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

# GitLab Review Comments — draft sl-overall-review findings onto a Merge Request

You take the findings that `/sl-overall-review` produced in this conversation and add them to the matching GitLab Merge Request as **pending draft review notes** — inline on the right `file:line` where possible. The notes are *not* published: the user reviews them in the GitLab UI and clicks **Submit review** to publish. Follow the steps in order.

**Hard rules for the entire run:**
- **Read-only on local code.** Do not edit, stage, or commit anything. The only external write is creating **draft** MR notes, and only after the Step 7 confirmation gate.
- **Never submit or publish the review.** You create draft notes only. Never call the publish/`bulk_publish` endpoint or any "submit review" action — submission is always a manual user action in the GitLab UI. This second pair of eyes (the user's, in GitLab) is the whole point.
- **Never handle the token in the open.** Do not ask the user to paste a token into the chat, do not echo it, do not log it, do not pass it as a command argument. If a token value ever appears, redact it. Auth flows through glab/MCP, or through `GITLAB_TOKEN` in the environment (read inside the poster script only).
- **No finding is dropped silently.** Every selected finding is either drafted inline, drafted as a general-note fallback, skipped as a duplicate, or reported as unverified — and the final report says which.

---

## Step 0 — Preconditions

Confirm there is an `/sl-overall-review` report to work with **in this conversation** — finding blocks that open with a heading `### <ID> · <title> · <severity>` (IDs `B1`, `B2`, … for bugs and `I1`, `I2`, … for improvements), then a line `` `<file:line>` · <reviewer> ``, then four bullets: intended / actually / why it matters / fix (their labels are in the user's language). If there is none, tell the user to run `/sl-overall-review` first (or paste its output), and stop. Do not invent findings.

---

## Step 1 — Parse the findings

Pipe the report text — whole, exactly as printed (the parser reads it by its Markdown structure, in any language) — into the bundled parser (quoted heredoc so nothing is shell-expanded):

```bash
node "${SKILL_DIR:-$(dirname "$0")}/scripts/parse-findings.mjs" <<'FINDINGS'
**Don't merge.** 1 blocker: B1
...
### B1 · Login query is open to injection · blocker
`auth/login.py:42` · security-audit

- **Intended:** ...
- **Actually:** ...
- **Why it matters:** ...
- **Fix:** ...
...
FINDINGS
```

Parse the JSON: `{findings:[{id,category,severity,severity_label,title,reviewers,file,line,intended,actual,impact,fix}], summary:{count}, warnings}`. `category` is `bug` | `improvement`; `severity` is `blocker` | `should` | `optional`, or `null` when the printed label wasn't recognized; `severity_label` is the label as printed. The four bullets are read by position, so `impact` is the third one ("why it matters"). Surface any `warnings`; for a `null` severity, map `severity_label` to one of the three yourself by its meaning, and say so. If `findings` is empty, report that and stop — and if the report has findings in the older indented layout (`sl-overall-review` before `0.9.0`), say that it needs to be re-run with the current version.

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

Hold the resolved `host · project · !<iid> · "<title>"` and the MR web URL (`https://<host>/<project>/-/merge_requests/<iid>`) for the Step 7 gate and the Step 9 report.

---

## Step 4 — Choose which findings to post (every run)

First print the full list so the user can see what's on offer — one line each: `<ID> <severity_label> · <reviewer> · <file>:<line>`.

Then ask what to post. **Not just categories — explicit IDs too:**

- **Claude Code:** call `AskUserQuestion` with options: "All", "Blocker + should fix", "Only blockers", and "Pick IDs" (option labels in the user's language). For "Pick IDs" the user types via the free-text "Other" field, e.g. `B1,B3,I2` or `B1-B3,I1`.
- **Codex / plain CLI:** print a numbered menu and read one line from stdin. Accept: a list of IDs (`B1,I2`), ranges within one letter (`B1-B3`), `all`, or a severity keyword used as a minimum threshold (`blocker`/`блокер`, `should`/`желательно`, `optional`/`по желанию`).

Resolve the answer to a concrete set of finding IDs: a severity threshold expands to the IDs of all findings at or above it (`blocker` → `should` → `optional`); explicit IDs select exactly those. IDs are case-insensitive (`b1` = `B1`). Everything downstream operates only on the selected findings.

---

## Step 5 — Verify each selected finding (mandatory)

For each selected finding:

1. **Working tree:** open the cited `file` at `line` (Read/Grep) and confirm it exists and is plausibly what the finding describes. If the file or line is gone, mark the finding **unverified — not posted**.
2. **MR diff:** classify the line against the MR diff using the hunk rule in `references/gitlab-api.md` (added → `new_line` only; context → both `new_line` and `old_line`; line not in any hunk, or file not in the MR → **general-note fallback**).
   - On the **REST** path the poster does this classification itself (it fetches `/diffs`); you pass it `{fp, file, line, body}` and read the resulting `anchor`/`reason`.
   - On the **glab/MCP** path, fetch the MR diff yourself (`glab api ".../merge_requests/<iid>/diffs"`) and apply the same rule to build each position.

Compute a stable fingerprint per finding, `fp = sha8(file|line|actual)` (first 8 hex of SHA-256), used for idempotency. Render each comment body as **Markdown** (GitLab renders it) in a **suggestive, collaborative register** — "this could be a problem; here's how it could be fixed" — never a verdict:

```
**<severity_label>**

**<intended label>:** <intended>

**<actually label>:** <actual>

**<why-it-matters label>:** <impact>

**<suggestive fix label>:** <fix>
```

- **Markdown, not plain text.** Separate the header and the four rows with **blank lines** (so they render as distinct paragraphs regardless of the instance's soft-break setting) and **bold** the labels. Wrap any code in the text so GitLab highlights it: short identifiers/expressions in inline `` `backticks` ``; a multi-line snippet in a fenced block ```` ```<lang> … ``` ````, with `<lang>` inferred from the cited file's extension (`.py`→`python`, `.ts`→`ts`, `.js`→`js`, `.go`→`go`, `.rb`→`ruby`, `.java`→`java`, …; bare ```` ``` ```` if unknown). Optional: when the fix is a literal drop-in replacement for the cited line on an inline anchor, the fenced block may be a ```` ```suggestion ```` block.
- **No reviewer attribution in the body.** The header is just the severity label as printed — do **not** print the reviewer name, the `B1`/`I1` ID, or "sl-overall-review". (The reviewer and ID still appear in the Step 4 list, Step 6 preview, and Step 9 report so you can tell findings apart — they are only kept out of what lands on the MR.)
- Use the labels **as the report printed them**, so they match the language of the finding text; only the fix label is rephrased as a suggestion. Examples — EN: `Intended:` / `Actually:` / `Why it matters:` / `Suggested fix:` · RU: `Хотели:` / `Получилось:` / `Чем плохо:` / `Как можно поправить:`.
- **Keep it lean.** The severity header plus those four rows, with the wording **verbatim** from sl-overall-review — only adding Markdown code markup around code, never rewording. Do not add extra commentary, hedging, or prose — short comments are the goal. Do not add a "draft" tag in the text; GitLab already badges pending notes.

---

## Step 6 — Build the preview

For every surviving finding, show exactly what will happen — plain-text blocks, one per line, no tables. Everything is a draft note:

```
B1 blocker · security-audit · auth/login.py:42   → inline draft (added line)
B2 should fix · regression · src/legacy.ts:12     → general draft note (line outside MR diff)
I1 optional · testing · src/db.ts:90             → inline draft (context line)
I2 optional · quality · src/db.ts:5              → skip (already drafted)
```

---

## Step 7 — Confirmation gate (mandatory)

Show the preview together with the resolved target: `host · project · !<iid> · "<title>"` and the MR web URL. Creating draft notes still writes to an external service, so require an explicit choice:

- **Claude Code:** `AskUserQuestion` — "Create draft notes", "Dry-run only", "Cancel".
- **Codex / plain CLI:** numbered stdin prompt with the same three choices.

Make clear these land as **pending draft notes** that the user reviews and submits later in GitLab — this skill never publishes them. Dry-run is always available: it runs the full pipeline (including dedupe) but makes no writes. Do not proceed to Step 8 without an explicit confirmation.

---

## Step 8 — Create the draft notes

Everything below creates **draft notes** (`POST .../draft_notes`, whose body field is `note`) — never published discussions. See `references/gitlab-api.md` for the exact mechanics.

- **glab** — one `glab api --method POST ".../draft_notes" --form "note=..." --form "position[...]=..."` call per comment (full form in `references/gitlab-api.md`; use `--form`, never `-f`/`-F`). General-note fallback: only `--form "note=..."`.
- **MCP** — discover a draft-note creation tool (a tool name containing `draft` together with `note`/`create`) and call it with the structured position fields; for a fallback, omit the position. **If the connected MCP server exposes no draft-note tool, do not silently post a published discussion instead** — fall back to the REST path (if `GITLAB_TOKEN` is set) or glab; if neither is available, tell the user the MCP server can't create drafts and offer Dry-run or Cancel.
- **REST** — pipe a job document into the poster, with `GITLAB_TOKEN` already exported by the user:

  ```bash
  node "${SKILL_DIR:-$(dirname "$0")}/scripts/post-comment.mjs" <<'JOB'
  {
    "host": "<host>", "project": "<group/sub/repo>", "mr_iid": <iid>,
    "draft": true,
    "dry_run": false,
    "comments": [
      {"fp": "<sha8>", "file": "<path>", "line": <n>, "body": "<body>"}
    ]
  }
  JOB
  ```

  The poster fetches diff_refs, classifies lines, dedupes against existing **draft notes and discussions**, and creates draft notes (or, with `"dry_run": true`, reports without writing).

For glab/MCP, fetch the MR's draft notes *and* discussions yourself first and skip any finding whose `fp` already appears, so re-runs stay idempotent.

---

## Step 9 — Report (this is the entire user-facing reply)

Plain-text, terminal-renderable, no tables. These are **drafts** — nothing is published yet. Lead with that, group by outcome, and end with the submit reminder + the MR URL:

```
Drafted — NOT yet submitted. Review them in GitLab and click "Submit review" to publish.

Drafted inline (2):
  B1 blocker · security-audit · auth/login.py:42 → !87
  I1 optional · testing · src/db.ts:90 (context) → !87

Drafted as general note (1):
  B2 should fix · regression · src/legacy.ts:12 — line outside MR diff

Skipped, already drafted (1):
  I2 optional · quality · src/db.ts:5

Could not verify, not drafted (0): —

Summary: 2 inline, 1 general note, 1 dup-skipped, 0 unverified — MR !87 (group/sub/repo)
Submit at: https://<host>/<project>/-/merge_requests/87
```

For a dry-run, use the same layout under a `DRY RUN — nothing drafted:` header.

---

## Bundled resources

- `scripts/parse-findings.mjs` — report text (stdin) → normalized JSON, parsed by Markdown structure (Step 1)
- `scripts/post-comment.mjs` — REST poster; reads `GITLAB_TOKEN` from env, classifies + dedupes, creates draft notes (Step 8)
- `references/gitlab-api.md` — endpoints, position rule, hunk-parsing rule, glab form, token-security notes, script contracts
