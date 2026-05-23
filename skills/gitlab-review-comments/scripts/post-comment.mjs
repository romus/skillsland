#!/usr/bin/env node
// post-comment.mjs — post overall-review findings to a GitLab MR.
// REST transport for the gitlab-review-comments skill. No deps (Node 20+ fetch).
//
// By default it creates PENDING DRAFT NOTES (GitLab's "Start a review" flow):
// the notes are not published — the user reviews them in the GitLab UI and
// clicks "Submit review" themselves. This script NEVER publishes/submits drafts.
// Pass "draft": false to post published discussions immediately instead.
//
// Reads a job document on stdin; reads the token from GITLAB_TOKEN in the
// ENVIRONMENT — never from argv, never logged, never echoed. This is the only
// place the token is used: as a PRIVATE-TOKEN header inside fetch().
//
// This script is also the reference implementation of the diff-line
// classification rule (see references/gitlab-api.md). The glab and MCP
// transports replicate the same rule agent-side.
//
// Job (stdin):
//   {
//     "host": "gitlab.com",          // optional; GITLAB_HOST env overrides
//     "project": "group/sub/repo",   // path (URL-encoded here) or numeric id
//     "mr_iid": 42,
//     "draft": true,                 // optional, default true (draft notes)
//     "dry_run": false,
//     "comments": [
//       {"fp":"ab12cd34","file":"src/a.ts","line":18,"body":"...","force_general":false}
//     ],
//     "mr": {                        // optional; inject to skip GETs (tests/offline)
//       "diff_refs": {"base_sha":"..","start_sha":"..","head_sha":".."},
//       "diffs": [{"old_path":"..","new_path":"..","diff":"@@ .."}],
//       "discussions": [ /* raw GitLab discussions */ ],
//       "draft_notes": [ /* raw GitLab draft notes: {note, position} */ ]
//     }
//   }
//
// Output (stdout): {"results":[{fp,file,line,anchor,reason,status,...}],"summary":{...}}
//   anchor ∈ inline-added | inline-context | general
//   status ∈ drafted | posted | skipped | dry-run | failed
// Exit: 0 (all ok/skipped/dry-run), 1 (any failed), 2 (fatal misconfig).

import { readFileSync } from "node:fs";

const MARKER_TAG = "overall-review:gitlab-review-comments";
const MARKER_RE = /<!--\s*overall-review:gitlab-review-comments fp=([0-9a-f]+)\s*-->/i;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const marker = (fp) => `<!-- ${MARKER_TAG} fp=${fp} -->`;

// Resolve the API base from GITLAB_HOST / job.host. Accepts either a bare host
// ("gitlab.example.com", optionally with a port) or a full URL with scheme,
// port, and subpath ("https://example.com:8443/gitlab"). Defaults to gitlab.com.
function resolveBaseUrl(value) {
  let v = String(value || "gitlab.com").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return /\/api\/v\d+$/.test(v) ? v : `${v}/api/v4`;
}

function die(msg, code = 2) {
  process.stdout.write(JSON.stringify({ error: msg }) + "\n");
  process.exit(code);
}

let job;
try {
  job = JSON.parse(readFileSync(0, "utf8"));
} catch (e) {
  die(`cannot parse job JSON on stdin: ${e.message}`);
}

const token = process.env.GITLAB_TOKEN;
if (!token) die("GITLAB_TOKEN not set in environment");
if (!job.project || !job.mr_iid) die("job must include project and mr_iid");

const base = resolveBaseUrl(process.env.GITLAB_HOST || job.host);
const pid = encodeURIComponent(String(job.project));
const iid = job.mr_iid;
const draft = job.draft !== false; // default: create pending draft notes

async function apiGet(path) {
  const res = await fetch(`${base}${path}`, { headers: { "PRIVATE-TOKEN": token } });
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} → HTTP ${res.status}`);
  return res;
}

async function getPaged(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await apiGet(`${path}${sep}per_page=100&page=${page}`);
    out.push(...(await res.json()));
    if (!res.headers.get("x-next-page")) break;
  }
  return out;
}

// --- gather MR context (injectable for offline/tests) ----------------------
let diffRefs = job.mr?.diff_refs;
if (!diffRefs) {
  try {
    diffRefs = (await (await apiGet(`/projects/${pid}/merge_requests/${iid}`)).json()).diff_refs;
  } catch (e) { die(`fetch MR failed: ${e.message}`); }
}
if (!diffRefs?.base_sha || !diffRefs?.start_sha || !diffRefs?.head_sha) {
  die("MR has no usable diff_refs (base_sha/start_sha/head_sha)");
}

let diffs = job.mr?.diffs;
if (!diffs) {
  try { diffs = await getPaged(`/projects/${pid}/merge_requests/${iid}/diffs`); }
  catch (e) { die(`fetch MR diffs failed: ${e.message}`); }
}

let discussions = job.mr?.discussions;
if (!discussions) {
  try { discussions = await getPaged(`/projects/${pid}/merge_requests/${iid}/discussions`); }
  catch (e) { die(`fetch MR discussions failed: ${e.message}`); }
}

// In draft mode, also dedupe against existing pending draft notes (a finding may
// already be drafted from a prior run, or already published as a discussion).
let draftNotes = job.mr?.draft_notes;
if (draft && !draftNotes) {
  try { draftNotes = await getPaged(`/projects/${pid}/merge_requests/${iid}/draft_notes`); }
  catch (e) { die(`fetch MR draft notes failed: ${e.message}`); }
}

// --- classify every new-file line in the diff ------------------------------
// fileMap: new_path -> { old_path, lines: Map<new_line, {old_line, type}> }
const fileMap = new Map();
for (const d of diffs) {
  if (!d.new_path || d.deleted_file) continue;
  const lines = new Map();
  let oldLn = 0, newLn = 0, inHunk = false;
  for (const ln of String(d.diff ?? "").split(/\r?\n/)) {
    const hm = ln.match(HUNK);
    if (hm) { oldLn = Number(hm[1]); newLn = Number(hm[2]); inHunk = true; continue; }
    if (!inHunk) continue;
    const c = ln[0];
    if (c === "+") { lines.set(newLn, { old_line: null, type: "added" }); newLn++; }
    else if (c === "-") { oldLn++; }
    else if (c === "\\") { /* "\ No newline at end of file" — advance nothing */ }
    else { lines.set(newLn, { old_line: oldLn, type: "context" }); oldLn++; newLn++; }
  }
  fileMap.set(d.new_path, { old_path: d.old_path || d.new_path, lines });
}

// --- existing comments, for idempotent re-runs -----------------------------
const normBody = (b) => b.replace(MARKER_RE, "").replace(/\s+/g, " ").trim();
function signature(position, body) {
  const nb = normBody(body);
  if (position && (position.new_line != null || position.old_line != null)) {
    return `${position.new_path}\n${position.new_line ?? ""}\n${position.old_line ?? ""}\n${nb}`;
  }
  return `GENERAL\n${nb}`;
}

const existingFps = new Set();
const existingSigs = new Set();
for (const disc of discussions) {
  for (const note of disc.notes ?? []) {
    const body = note.body ?? "";
    const m = body.match(MARKER_RE);
    if (m) existingFps.add(m[1].toLowerCase());
    existingSigs.add(signature(note.position, body));
  }
}
// Draft notes are a flat list; each carries its body in `note` (not `body`).
for (const dn of draftNotes ?? []) {
  const body = dn.note ?? "";
  const m = body.match(MARKER_RE);
  if (m) existingFps.add(m[1].toLowerCase());
  existingSigs.add(signature(dn.position, body));
}

// --- post (or dry-run) each comment ----------------------------------------
const results = [];
for (const c of job.comments ?? []) {
  const fp = String(c.fp ?? "");
  const body = `${marker(fp)}\n${c.body ?? ""}`;

  let position = null, anchor, reason = null;
  const entry = c.force_general ? null : fileMap.get(c.file);
  const cls = entry ? entry.lines.get(Number(c.line)) : null;
  if (c.force_general) { anchor = "general"; reason = "forced general note"; }
  else if (!entry) { anchor = "general"; reason = "file not in MR diff"; }
  else if (!cls) { anchor = "general"; reason = "line outside MR diff hunks"; }
  else if (cls.type === "added") {
    anchor = "inline-added";
    position = { new_path: c.file, old_path: entry.old_path, new_line: Number(c.line), old_line: null };
  } else {
    anchor = "inline-context";
    position = { new_path: c.file, old_path: entry.old_path, new_line: Number(c.line), old_line: cls.old_line };
  }

  const sig = signature(position, body);
  const base_row = { fp, file: c.file, line: c.line, anchor, reason };

  if ((fp && existingFps.has(fp.toLowerCase())) || existingSigs.has(sig)) {
    results.push({ ...base_row, status: "skipped" });
    continue;
  }
  if (job.dry_run) {
    results.push({ ...base_row, status: "dry-run" });
    continue;
  }

  try {
    const params = new URLSearchParams();
    // Draft notes carry their body in `note`; published discussions use `body`.
    params.set(draft ? "note" : "body", body);
    if (position) {
      params.set("position[position_type]", "text");
      params.set("position[base_sha]", diffRefs.base_sha);
      params.set("position[start_sha]", diffRefs.start_sha);
      params.set("position[head_sha]", diffRefs.head_sha);
      params.set("position[new_path]", position.new_path);
      params.set("position[old_path]", position.old_path);
      if (position.new_line != null) params.set("position[new_line]", String(position.new_line));
      if (position.old_line != null) params.set("position[old_line]", String(position.old_line));
    }
    const endpoint = draft ? "draft_notes" : "discussions";
    const res = await fetch(`${base}/projects/${pid}/merge_requests/${iid}/${endpoint}`, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      results.push({ ...base_row, status: "failed", http_status: res.status, error: text.slice(0, 300) });
      continue;
    }
    const out = await res.json();
    existingFps.add(fp.toLowerCase());
    existingSigs.add(sig);
    // Draft create returns a single draft-note object; discussion create returns
    // a discussion with a notes[] array.
    results.push(draft
      ? { ...base_row, status: "drafted", draft_note_id: out.id }
      : { ...base_row, status: "posted", discussion_id: out.id, note_id: out.notes?.[0]?.id });
  } catch (e) {
    results.push({ ...base_row, status: "failed", error: String(e?.message || e) });
  }
}

const count = (pred) => results.filter(pred).length;
const summary = {
  drafted: count((r) => r.status === "drafted"),
  posted: count((r) => r.status === "posted"),
  skipped: count((r) => r.status === "skipped"),
  failed: count((r) => r.status === "failed"),
  "dry-run": count((r) => r.status === "dry-run"),
  fallback: count((r) => r.anchor === "general" && r.status !== "skipped"),
  draft,
  dry_run: !!job.dry_run,
};

process.stdout.write(JSON.stringify({ results, summary }, null, 2) + "\n");
process.exit(summary.failed > 0 ? 1 : 0);
