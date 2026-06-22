# GitLab MR comment mechanics

Reference for the `sl-gitlab-review-comments` skill. The skill's default write is a
**pending draft note** (GitLab's "Start a review" flow) — it never publishes/submits.
The REST path is implemented in `scripts/post-comment.mjs`; the glab and MCP paths
replicate the same rules agent-side. Sources:
<https://docs.gitlab.com/api/draft_notes/>, <https://docs.gitlab.com/api/discussions/>,
<https://docs.gitlab.com/api/merge_requests/>, <https://docs.gitlab.com/cli/api/>.

## Endpoints

| Purpose | Call |
|---|---|
| Diff-positioned **draft note** (inline, default) | `POST /projects/:id/merge_requests/:iid/draft_notes` |
| General **draft note** (fallback) | same endpoint, only `note` |
| Existing draft notes (for dedupe) | `GET /projects/:id/merge_requests/:iid/draft_notes` |
| Diff-positioned thread (published — only when `draft:false`) | `POST /projects/:id/merge_requests/:iid/discussions` |
| General MR thread (published fallback) | same endpoint, only `body` |
| Existing threads (for dedupe) | `GET /projects/:id/merge_requests/:iid/discussions` |
| Diff refs (the three SHAs) | `GET /projects/:id/merge_requests/:iid` → `diff_refs` |
| Per-file diffs (to classify lines) | `GET /projects/:id/merge_requests/:iid/diffs` |
| Find the MR from a branch | `GET /projects/:id/merge_requests?source_branch=<b>&state=opened` |

The publish endpoints (`PUT .../draft_notes/:id/publish`, `POST .../draft_notes/bulk_publish`)
exist but the skill **never** calls them — submitting the review is a manual user action
in the GitLab UI.

`:id` is the URL-encoded project path (`group%2Fsub%2Frepo`) or numeric id.
`:iid` is the per-project MR number from the URL — **not** the global id.

### Host / base URL (REST)

The API base is resolved from `GITLAB_HOST` (env, wins) → `job.host` (auto-derived
from the git remote) → `gitlab.com`. `post-comment.mjs` accepts either form:

- a **bare host** — `gitlab.example.com` (optionally `host:port`) → `https://gitlab.example.com/api/v4`
- a **full URL** — `https://gitlab.example.com:8443`, or a subpath install
  `https://example.com/gitlab`, or `http://localhost:8080` → `<as given>/api/v4`

A trailing slash is trimmed and `/api/v4` is appended unless the value already ends
in `/api/vN`. So for self-managed GitLab, set e.g. `export GITLAB_HOST=https://gitlab.company.com`.

## Draft notes (the default write path)

`POST /projects/:id/merge_requests/:iid/draft_notes` creates a **pending** note that is
visible to the author but not published until the user clicks **Submit review** in the UI.
It takes the same arguments as a discussion with two differences:

- the body field is **`note`** (not `body`);
- the `position[...]` subfields are **identical** to a discussion (see below) — so the same
  line-classification rule produces the same anchor for both write paths.

Dedupe reads **both** `GET .../draft_notes` (body in the `note` field) and
`GET .../discussions` (body in each note's `body` field): a finding may already be a pending
draft from a prior run, or already published from a submitted review. The skill never calls
`PUT .../draft_notes/:id/publish` or `POST .../draft_notes/bulk_publish` — submission is manual.

## Position parameters (inline comment)

Send all of: `body`, `position[position_type]=text`, `position[base_sha]`,
`position[start_sha]`, `position[head_sha]`, `position[new_path]`,
`position[old_path]`. Then, by line kind:

- **Added line** (`+`): send `position[new_line]` only.
- **Removed line** (`-`): send `position[old_line]` only.
- **Unchanged / context line** (` `): send **both** `position[new_line]` and `position[old_line]`.

`old_path` == `new_path` unless the file was renamed. The three SHAs MUST come
from the live MR's `diff_refs` (not computed locally), or GitLab returns 400.

sl-overall-review cites `file:line` in **new-file** coordinates, so we look up by
`new_line`. A finding whose line isn't found in any hunk → general-note fallback.

## Hunk-parsing rule

Hunk header: `@@ -<oldStart>[,<oldCount>] +<newStart>[,<newCount>] @@` (count
defaults to 1 when absent). Reset `oldLn=oldStart`, `newLn=newStart` at each
header, then walk the body by first character:

| First char | Kind | Record | Advance |
|---|---|---|---|
| `+` | added | `new_line=newLn` | `newLn++` |
| `-` | removed | `old_line=oldLn` | `oldLn++` |
| ` ` (or empty) | context | `new_line=newLn`, `old_line=oldLn` | both++ |
| `\` | "No newline at end of file" | — | nothing |

Build `new_line → {old_line, type}` per `new_path`; classify each finding's line.

## glab transport

Detect: `command -v glab` and `glab auth status`. glab auto-detects the project
and host from the git remote, so `:fullpath` works:

```bash
glab api --method POST "projects/:fullpath/merge_requests/<iid>/draft_notes" \
  --form "note=<body>" \
  --form "position[position_type]=text" \
  --form "position[base_sha]=<base>" \
  --form "position[start_sha]=<start>" \
  --form "position[head_sha]=<head>" \
  --form "position[new_path]=<path>" \
  --form "position[old_path]=<path>" \
  --form "position[new_line]=<n>"          # + position[old_line] for context lines
```

For a general draft note (line outside the diff), send only `--form "note=<body>"`.

Use `--form`, **not** `-f`/`-F`: those JSON-encode and coerce types, mangling
the bracketed keys and the SHA strings. glab has no first-class subcommand for
inline draft notes (`glab mr note` posts a *published, general* note only), so
`glab api` is required. Read diff_refs/diffs/draft_notes/discussions with
`glab api "projects/:fullpath/merge_requests/<iid>/<...>"`.

## Token security (REST only)

glab and MCP manage their own auth — the skill never handles a token on those
paths. For REST, `post-comment.mjs` reads `GITLAB_TOKEN` from its environment and
sets it as a `PRIVATE-TOKEN` header inside `fetch()`. The literal token never
appears on a command line (so it can't leak via `ps`/shell history, unlike
`curl -H "PRIVATE-TOKEN: $TOKEN"` which the shell expands into argv), is never
written to disk, never logged, and is never requested in chat. Use a
least-privilege, short-expiry **project access token** with the `api` scope.

## Idempotency

Each note body is prefixed with a hidden marker
`<!-- sl-overall-review:sl-gitlab-review-comments fp=<sha8(file|line|issue)> -->`
(an HTML comment — invisible in the UI, present in the raw body). On re-run the
poster matches the `fp` against existing **draft notes** (the `note` field) and
**published discussions** (each note's `body`), falling back to a
`new_path + new_line + old_line + normalized-body` signature, and **skips**
anything already present.

## Script contracts

- `scripts/parse-findings.mjs` — finding-block text on **stdin** →
  `{findings:[{n,severity,reviewers,file,line,issue,fix}], summary, warnings}` on
  stdout. Exit 0 always (empty → warning), 2 if stdin unreadable.
- `scripts/post-comment.mjs` — job JSON on **stdin**, `GITLAB_TOKEN` (+ optional
  `GITLAB_HOST`) in **env** → `{results, summary}` on stdout. The job's `draft`
  flag defaults to **true** (create draft notes; `false` posts published
  discussions). Comments carry `{fp, file, line, body, force_general?}`; the poster
  fetches diff_refs/diffs and — for dedupe — draft_notes + discussions (or uses an
  injected `mr` block for offline/tests), classifies, dedupes, and creates draft
  notes. Result `status ∈ drafted | posted | skipped | dry-run | failed`. Exit 0
  (ok/skipped/dry-run), 1 (any failed), 2 (fatal).
