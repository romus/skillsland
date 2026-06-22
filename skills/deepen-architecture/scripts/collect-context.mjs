#!/usr/bin/env node
// collect-context.mjs — gather resting-state architecture signals for deepen-architecture.
// No deps. Node 20+. Shells out to `git` via child_process (portable; no bash needed).
//
// Usage:
//   node collect-context.mjs [scopePath]
//
// Emits a single JSON object on stdout (see references/report-format.md, "context" block):
//   {
//     "gitAvailable": true,
//     "repoRoot": "/abs/path",
//     "scope": "whole repo" | "src/payments",
//     "summary": { "sourceFiles": 123, "topLevelDirs": 7 },
//     "docsRead": ["CLAUDE.md", "README.md", "docs/architecture.md"],
//     "signals": {
//       "languages":        [{ "ext": ".ts", "files": 40, "bytes": 120000 }],
//       "topDirs":          [{ "path": "src", "files": 80, "bytes": 250000 }],
//       "churnHotspots":    [{ "path": "src/app.ts", "commits": 42 }],
//       "coChangeClusters": [{ "files": ["a.ts","b.ts"], "together": 11 }],
//       "largestFiles":     [{ "path": "src/big.ts", "loc": 1200, "bytes": 48000 }]
//     },
//     "warnings": ["..."]
//   }
// Exit: 0 on success (even for non-git — degrades gracefully); 2 only if cwd is unreadable.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";

const MAX_BUFFER = 256 * 1024 * 1024; // git output for large repos
const MAX_WALK_FILES = 60000; // backstop for non-git filesystem walks
const SINCE = "12 months ago";
const CHURN_TOP = 25;
const COCHANGE_TOP = 15;
const COCHANGE_MIN = 2; // a pair must co-change at least this many times
const COMMIT_FILE_CAP = 25; // ignore commits touching more files (merges / mass reformats)
const LARGEST_TOP = 20;
const TOPDIRS_TOP = 15;
const LANGS_TOP = 15;

// Directories never worth scanning. A path is excluded if any segment matches.
const EXCLUDED_DIRS = new Set([
  ".git", ".skillsland", "node_modules", "bower_components", "vendor",
  "dist", "build", "out", "target", "bin", "obj", ".next", ".nuxt",
  ".output", ".svelte-kit", "coverage", ".venv", "venv", "env",
  "__pycache__", ".mypy_cache", ".pytest_cache", ".tox", ".gradle",
  ".idea", ".vscode", ".cache", "tmp", ".terraform",
]);

// Source-code extensions used for the language histogram and co-change filtering.
const SOURCE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".rb", ".go",
  ".rs", ".java", ".kt", ".kts", ".scala", ".c", ".h", ".cc", ".cpp",
  ".hpp", ".cxx", ".cs", ".php", ".swift", ".m", ".mm", ".sh", ".bash",
  ".sql", ".vue", ".svelte", ".ex", ".exs", ".clj", ".cljs", ".erl",
  ".hs", ".lua", ".pl", ".r", ".dart", ".gradle", ".proto", ".graphql",
]);

const warnings = [];
const scopeArg = process.argv[2] && process.argv[2].trim() ? process.argv[2].trim() : null;

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function extOf(p) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
}

function isExcluded(relPath) {
  const parts = relPath.split(/[/\\]/);
  return parts.some((seg) => EXCLUDED_DIRS.has(seg));
}

function inScope(relPath) {
  if (!scopeArg) return true;
  const norm = scopeArg.replace(/\\/g, "/").replace(/\/+$/, "");
  return relPath === norm || relPath.startsWith(norm + "/");
}

// --- discover repo root + the working file list -----------------------------

const root = git(["rev-parse", "--show-toplevel"]);
const gitAvailable = root !== null;
const repoRoot = gitAvailable ? root.trim() : process.cwd();

/** Returns array of repo-relative POSIX-ish paths, excluded/scope filtered. */
function listFiles() {
  if (gitAvailable) {
    const out = git(["ls-files", "-z"]);
    if (out !== null) {
      return out
        .split("\0")
        .filter(Boolean)
        .map((p) => p.replace(/\\/g, "/"))
        .filter((p) => !isExcluded(p) && inScope(p));
    }
    warnings.push("git ls-files failed; falling back to a filesystem walk");
  }
  // Non-git (or ls-files failure): walk the filesystem from the scope root.
  const startRel = scopeArg ? scopeArg.replace(/\\/g, "/").replace(/\/+$/, "") : "";
  const startAbs = startRel ? join(repoRoot, startRel) : repoRoot;
  const found = [];
  const stack = [startAbs];
  while (stack.length && found.length < MAX_WALK_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const abs = join(dir, ent.name);
      const rel = relative(repoRoot, abs).split(sep).join("/");
      if (isExcluded(rel)) continue;
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) found.push(rel);
    }
  }
  if (found.length >= MAX_WALK_FILES) {
    warnings.push(`filesystem walk hit the ${MAX_WALK_FILES}-file cap; signals are partial`);
  }
  return found;
}

let files;
try {
  files = listFiles();
} catch (e) {
  process.stdout.write(JSON.stringify({ error: `cannot read working directory: ${e.message}` }) + "\n");
  process.exit(2);
}

function sizeOf(relPath) {
  try {
    return statSync(join(repoRoot, relPath)).size;
  } catch {
    return 0;
  }
}

// --- context docs -------------------------------------------------------------
// Docs describe the whole project, so search the full file list (scope-independent
// would miss a root CLAUDE.md when scoped) — we search `files` but also re-list the
// root-level docs even when a scope is set.

function listAllForDocs() {
  if (!scopeArg) return files;
  // when scoped, additionally pull root + docs/adr paths so we still find CLAUDE.md etc.
  if (gitAvailable) {
    const out = git(["ls-files", "-z"]);
    if (out !== null) {
      return out.split("\0").filter(Boolean).map((p) => p.replace(/\\/g, "/")).filter((p) => !isExcluded(p));
    }
  }
  return files;
}

function discoverDocs() {
  const all = listAllForDocs();
  const hits = [];
  for (const p of all) {
    const b = basename(p);
    const depth = p.split("/").length;
    const isMd = /\.(md|mdx|rst|adoc|txt)$/i.test(b);
    const rooted = depth <= 2;
    if (/^(CLAUDE|AGENTS|CONTRIBUTING|GEMINI)\.md$/i.test(b) && rooted) hits.push(p);
    else if (/^ARCHITECTURE/i.test(b) && isMd && rooted) hits.push(p);
    else if (/^README/i.test(b) && isMd && rooted) hits.push(p);
    else if (/^DESIGN/i.test(b) && isMd && rooted) hits.push(p);
    else if (/(^|\/)docs\//i.test(p) && isMd) hits.push(p);
    else if (/(^|\/)(adr|adrs|decisions|rfcs?)\//i.test(p) && isMd) hits.push(p);
  }
  // de-dup, prefer shallower paths, cap.
  const uniq = [...new Set(hits)].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  return uniq.slice(0, 30);
}

// --- size-based signals -------------------------------------------------------

function languageHistogram() {
  const m = new Map();
  for (const p of files) {
    const ext = extOf(p);
    if (!SOURCE_EXTS.has(ext)) continue;
    const cur = m.get(ext) || { ext, files: 0, bytes: 0 };
    cur.files += 1;
    cur.bytes += sizeOf(p);
    m.set(ext, cur);
  }
  return [...m.values()].sort((a, b) => b.files - a.files).slice(0, LANGS_TOP);
}

function topDirs() {
  const m = new Map();
  for (const p of files) {
    const top = p.includes("/") ? p.slice(0, p.indexOf("/")) : ".";
    const cur = m.get(top) || { path: top, files: 0, bytes: 0 };
    cur.files += 1;
    cur.bytes += sizeOf(p);
    m.set(top, cur);
  }
  return [...m.values()].sort((a, b) => b.files - a.files).slice(0, TOPDIRS_TOP);
}

function largestFiles() {
  const sized = files
    .filter((p) => SOURCE_EXTS.has(extOf(p)))
    .map((p) => ({ path: p, bytes: sizeOf(p) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, LARGEST_TOP);
  // read only this bounded set to count lines
  for (const f of sized) {
    try {
      const txt = readFileSync(join(repoRoot, f.path), "utf8");
      f.loc = txt.length ? txt.split("\n").length : 0;
    } catch {
      f.loc = null;
    }
  }
  return sized;
}

// --- git history signals ------------------------------------------------------

function churnHotspots() {
  if (!gitAvailable) return [];
  const scopePathspec = scopeArg ? ["--", scopeArg] : ["--", "."];
  const out = git([
    "log", `--since=${SINCE}`, "--no-merges", "--format=", "--name-only",
    ...scopePathspec, ":(exclude)*.lock", ":(exclude)*-lock.json",
    ":(exclude).skillsland/**", ":(exclude)**/node_modules/**",
  ]);
  if (out === null) return [];
  const counts = new Map();
  for (const line of out.split(/\r?\n/)) {
    const p = line.trim().replace(/\\/g, "/");
    if (!p || isExcluded(p)) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([path, commits]) => ({ path, commits }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, CHURN_TOP);
}

function coChangeClusters() {
  if (!gitAvailable) return [];
  const scopePathspec = scopeArg ? ["--", scopeArg] : ["--", "."];
  const out = git([
    "log", `--since=${SINCE}`, "--no-merges", "--format=%x01", "--name-only",
    ...scopePathspec, ":(exclude)*.lock", ":(exclude)*-lock.json",
    ":(exclude).skillsland/**", ":(exclude)**/node_modules/**",
  ]);
  if (out === null) return [];
  const pairs = new Map();
  const bump = (a, b) => {
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  };
  // commits are delimited by a \x01 marker line
  for (const chunk of out.split("\x01")) {
    const commitFiles = chunk
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\\/g, "/"))
      .filter((p) => p && !isExcluded(p) && SOURCE_EXTS.has(extOf(p)));
    const uniq = [...new Set(commitFiles)];
    if (uniq.length < 2 || uniq.length > COMMIT_FILE_CAP) continue;
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++) bump(uniq[i], uniq[j]);
  }
  return [...pairs.entries()]
    .filter(([, n]) => n >= COCHANGE_MIN)
    .map(([key, together]) => ({ files: key.split(" "), together }))
    .sort((a, b) => b.together - a.together)
    .slice(0, COCHANGE_TOP);
}

// --- assemble -----------------------------------------------------------------

if (!gitAvailable) {
  warnings.push("not a git repository — churn and co-change signals unavailable");
}
if (scopeArg && files.length === 0) {
  warnings.push(`scope "${scopeArg}" matched no files`);
}

const topLevelDirs = new Set(files.map((p) => (p.includes("/") ? p.slice(0, p.indexOf("/")) : "."))).size;

const result = {
  gitAvailable,
  repoRoot,
  scope: scopeArg || "whole repo",
  summary: { sourceFiles: files.filter((p) => SOURCE_EXTS.has(extOf(p))).length, topLevelDirs },
  docsRead: discoverDocs(),
  signals: {
    languages: languageHistogram(),
    topDirs: topDirs(),
    churnHotspots: churnHotspots(),
    coChangeClusters: coChangeClusters(),
    largestFiles: largestFiles(),
  },
  warnings,
};

process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exit(0);
