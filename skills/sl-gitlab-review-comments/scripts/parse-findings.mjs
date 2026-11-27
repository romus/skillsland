#!/usr/bin/env node
// parse-findings.mjs — turn the sl-overall-review report (v0.9+) into JSON.
// No deps. Reads the report text on stdin, emits a normalized document on stdout.
// See SKILL.md Step 1 and references/gitlab-api.md for the contract.
//
// Input (stdin): the Markdown report printed by /sl-overall-review, e.g.
//   **Don't merge.** 1 blocker: B1
//   ...
//   ### B1 · Login query is open to injection · blocker
//   `auth/login.py:42` · quality, security-audit
//
//   - **Intended:** Look the user up by the name they typed.
//   - **Actually:** The name is pasted into the SQL string unescaped.
//   - **Why it matters:** The name `' OR 1=1 --` matches every row, so anyone
//     logs in as the first user, usually the admin.
//   - **Fix:** Pass the name as a query parameter.
//
// Parsing goes by structure, not by words, so a report in any language parses:
//   heading        #{1,6} <B|I><n> · <title> · <severity label>
//   location line  the first non-blank line under the heading:
//                  `<file>:<line>` · <reviewer>[, <reviewer>]   (backticks optional)
//   bullets        "- **<label>:** <text>" — read by position: intended, actual,
//                  impact, fix. The label text itself is never interpreted.
//   continuation   any other line inside a finding is appended to the last bullet
//   end            the next heading, a horizontal rule (---), or end of input.
// Everything outside a finding (verdict, summary, overview table, hint) is ignored.
// Only the severity label is matched by name (English, Russian).
//
// Output (stdout):
//   {
//     "findings": [
//       {"id":"B1","category":"bug","severity":"blocker","severity_label":"blocker",
//        "title":"...","reviewers":["security-audit"],"file":"auth/login.py","line":42,
//        "intended":"...","actual":"...","impact":"...","fix":"..."}
//     ],
//     "summary": {"count":1},
//     "warnings": ["..."]
//   }
// severity is "blocker" | "should" | "optional", or null when the label is unknown.
// Exit: 0 always (no findings -> warning); 2 if stdin is unreadable.

import { readFileSync } from "node:fs";

const HEADING = /^#{1,6}\s+(.*\S)\s*$/;
const FINDING_ID = /^([BI])(\d+)$/i;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const BOLD_LABEL = /^(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*(.*)$/;
const LOCATION = /^(.+):(\d+)$/;

const FIELDS = ["intended", "actual", "impact", "fix"];
const SEVERITY_LABELS = {
  blocker: ["blocker", "blocking", "блокер", "блокирует"],
  should: ["should fix", "should-fix", "should", "желательно"],
  optional: ["optional", "nice to have", "по желанию"],
};
const CATEGORY = { B: "bug", I: "improvement" };

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const unwrap = (s) => s.trim().replace(/^(`+|\*\*|__)([\s\S]*?)\1$/, "$2").trim();
const severityOf = (label) => {
  const key = norm(label);
  for (const [canon, names] of Object.entries(SEVERITY_LABELS)) if (names.includes(key)) return canon;
  return null;
};

let raw;
try {
  raw = readFileSync(0, "utf8");
} catch (e) {
  process.stdout.write(JSON.stringify({ error: `cannot read stdin: ${e.message}` }) + "\n");
  process.exit(2);
}

const findings = [];
const warnings = [];
const seen = new Set();
let current = null;

function append(key, text) {
  if (!text) return;
  current[key] = current[key] ? `${current[key]} ${text}` : text;
}

function closeCurrent() {
  if (!current) return;
  if (!current.file) warnings.push(`finding ${current.id}: no file:line found under the heading`);
  if (!current.reviewers.length) warnings.push(`finding ${current.id}: no reviewer found under the heading`);
  for (const key of FIELDS) {
    if (!current[key]) warnings.push(`finding ${current.id}: no ${key} text found`);
  }
  delete current._bullets;
  delete current._last;
  delete current._located;
  findings.push(current);
  current = null;
}

function openFinding(parts) {
  const id = unwrap(parts[0]).toUpperCase();
  const m = id.match(FINDING_ID);
  if (seen.has(id)) warnings.push(`finding ${id}: duplicate ID`);
  seen.add(id);
  let title = "";
  let severityLabel = "";
  if (parts.length >= 3) {
    severityLabel = unwrap(parts[parts.length - 1]);
    title = parts.slice(1, -1).join(" · ").trim();
  } else {
    title = parts.slice(1).join(" · ").trim();
    warnings.push(`finding ${id}: heading has no severity segment; severity set to null`);
  }
  const severity = severityLabel ? severityOf(severityLabel) : null;
  if (severityLabel && !severity) {
    warnings.push(`finding ${id}: severity label "${severityLabel}" not recognized; severity set to null`);
  }
  current = {
    id,
    category: CATEGORY[m[1].toUpperCase()],
    severity,
    severity_label: severityLabel,
    title,
    reviewers: [],
    file: "",
    line: null,
    intended: "",
    actual: "",
    impact: "",
    fix: "",
    _bullets: 0,
    _last: null,
    _located: false,
  };
}

// `auth/login.py:42` · quality, security-audit
function readLocation(text) {
  const [where, ...rest] = text.split(/\s+·\s+/);
  const loc = unwrap(where).match(LOCATION);
  if (!loc) return false;
  current.file = loc[1].trim();
  current.line = Number(loc[2]);
  current.reviewers = rest
    .join(" · ")
    .split(",")
    .map((s) => unwrap(s))
    .filter(Boolean);
  return true;
}

for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.replace(/\t/g, "    ").replace(/\s+$/, "");
  if (/^\s*```/.test(line)) continue; // tolerate a fence around the pasted report
  if (!line.trim()) continue;

  const h = line.trimStart().match(HEADING);
  if (h) {
    closeCurrent();
    const parts = h[1].split(/\s+·\s+/);
    if (FINDING_ID.test(unwrap(parts[0]))) openFinding(parts);
    continue;
  }

  if (RULE.test(line)) {
    closeCurrent();
    continue;
  }

  if (!current) continue; // verdict, summary, overview table, closing sentence, hint

  const b = line.match(BULLET);
  if (b) {
    const labelled = b[1].match(BOLD_LABEL);
    const text = (labelled ? labelled[2] : b[1]).trim();
    const key = FIELDS[current._bullets];
    if (!key) {
      warnings.push(`finding ${current.id}: extra bullet appended to ${current._last}`);
      append(current._last, text);
      continue;
    }
    if (!labelled) warnings.push(`finding ${current.id}: bullet ${current._bullets + 1} has no bold label; read as ${key} by position`);
    current._bullets += 1;
    current._last = key;
    append(key, text);
    continue;
  }

  const text = line.trim();
  if (!current._located && !current._last) {
    current._located = true;
    if (readLocation(text)) continue;
    warnings.push(`finding ${current.id}: line under the heading is not "<file>:<line> · <reviewer>": "${text}"`);
    continue;
  }
  if (current._last) append(current._last, text);
  else warnings.push(`finding ${current.id}: unexpected line before the first bullet, ignored: "${text}"`);
}
closeCurrent();

if (findings.length === 0) {
  warnings.push("no finding blocks matched the expected format");
}

const summary = { count: findings.length };
process.stdout.write(JSON.stringify({ findings, summary, warnings }, null, 2) + "\n");
process.exit(0);
