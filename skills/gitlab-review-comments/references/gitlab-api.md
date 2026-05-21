# GitLab MR comment mechanics

Reference for the `gitlab-review-comments` skill. The REST path is implemented
in `scripts/post-comment.mjs`; the glab and MCP paths replicate the same rules
agent-side. Sources: <https://docs.gitlab.com/api/discussions/>,
<https://docs.gitlab.com/api/merge_requests/>, <https://docs.gitlab.com/cli/api/>.

## Endpoints

| Purpose | Call |
|---|---|
| Diff-positioned thread (inline comment) | `POST /projects/:id/merge_requests/:iid/discussions` |
| General MR thread (fallback) | same endpoint, only `body` |
| Diff refs (the three SHAs) | `GET /projects/:id/merge_requests/:iid` → `diff_refs` |
| Per-file diffs (to classify lines) | `GET /projects/:id/merge_requests/:iid/diffs` |
| Existing threads (for dedupe) | `GET /projects/:id/merge_requests/:iid/discussions` |
| Find the MR from a branch | `GET /projects/:id/merge_requests?source_branch=<b>&state=opened` |

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

## Position parameters (inline comment)

Send all of: `body`, `position[position_type]=text`, `position[base_sha]`,
`position[start_sha]`, `position[head_sha]`, `position[new_path]`,
`position[old_path]`. Then, by line kind:

- **Added line** (`+`): send `position[new_line]` only.
- **Removed line** (`-`): send `position[old_line]` only.
- **Unchanged / context line** (` `): send **both** `position[new_line]` and `position[old_line]`.

`old_path` == `new_path` unless the file was renamed. The three SHAs MUST come
from the live MR's `diff_refs` (not computed locally), or GitLab returns 400.

overall-review cites `file:line` in **new-file** coordinates, so we look up by
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
glab api --method POST "projects/:fullpath/merge_requests/<iid>/discussions" \
  --form "body=<body>" \
  --form "position[position_type]=text" \
  --form "position[base_sha]=<base>" \
  --form "position[start_sha]=<start>" \
  --form "position[head_sha]=<head>" \
  --form "position[new_path]=<path>" \
  --form "position[old_path]=<path>" \
  --form "position[new_line]=<n>"          # + position[old_line] for context lines
```

Use `--form`, **not** `-f`/`-F`: those JSON-encode and coerce types, mangling
the bracketed keys and the SHA strings. glab has no first-class subcommand for
inline diff comments (`glab mr note` posts a *general* note only), so `glab api`
is required for positioned comments. Read diff_refs/diffs/discussions with
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

Each posted body is prefixed with a hidden marker
`<!-- overall-review:gitlab-review-comments fp=<sha8(file|line|issue)> -->`
(an HTML comment — invisible in the UI, present in the raw `body`). On re-run the
poster matches existing notes by that `fp`, falling back to a
`new_path + new_line + old_line + normalized-body` signature, and **skips**
anything already present.

## Script contracts

- `scripts/parse-findings.mjs` — finding-block text on **stdin** →
  `{findings:[{n,severity,reviewers,file,line,issue,fix}], summary, warnings}` on
  stdout. Exit 0 always (empty → warning), 2 if stdin unreadable.
- `scripts/post-comment.mjs` — job JSON on **stdin**, `GITLAB_TOKEN` (+ optional
  `GITLAB_HOST`) in **env** → `{results, summary}` on stdout. Comments carry
  `{fp, file, line, body, force_general?}`; the poster fetches diff_refs/diffs/
  discussions (or uses an injected `mr` block for offline/tests), classifies,
  dedupes, and posts. Exit 0 (ok/skipped/dry-run), 1 (any failed), 2 (fatal).
