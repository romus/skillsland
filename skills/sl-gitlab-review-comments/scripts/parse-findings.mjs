#!/usr/bin/env node
// parse-findings.mjs — turn the sl-overall-review report (v0.8+) into JSON.
// No deps. Reads the report text on stdin, emits a normalized document on stdout.
// See SKILL.md Step 1 and references/gitlab-api.md for the contract.
//
// Input (stdin): the report printed by /sl-overall-review, e.g.
//   CODE REVIEW · feat/login → main · 3 files · +40 −2 · profile: security
//   ...
//   BUGS
//
//     Reviewer: security-audit
//
//     B1  blocker     auth/login.py:42
//         intended  Look the user up by the name they typed.
//         actually  The name is pasted into the SQL string unescaped.
//         example   Name ' OR 1=1 -- → the query matches every row →
//                   logged in as the first user, usually the admin.
//         fix       Use a parameterized query.
//
// Parsing goes by indentation, not by words, so translated labels still parse:
//   finding header  indent 0-3  <B|I><n>  <severity label>  <file>:<line>
//   reviewer line   indent 1-3  <label>: <name>[, <name>]
//   field row       indent 4-8  <label>  <text>   (2+ spaces between them)
//   continuation    indent 9+   appended to the current field
//   any other line at column 0 (a section/category heading, the hint) ends the finding.
// Known labels (English, Russian) are matched by name; any other label is read by
// position (intended, actual, example, fix) with a warning.
//
// Output (stdout):
//   {
//     "findings": [
//       {"id":"B1","category":"bug","severity":"blocker","severity_label":"blocker",
//        "reviewers":["security-audit"],"file":"auth/login.py","line":42,
//        "intended":"...","actual":"...","example":"...","fix":"..."}
//     ],
//     "summary": {"count":1,"profile":"security"},
//     "warnings": ["..."]
//   }
// severity is "blocker" | "should" | "optional", or null when the label is unknown.
// Exit: 0 always (no findings -> warning); 2 if stdin is unreadable.

import { readFileSync } from "node:fs";

const HEADER = /^ {0,3}([BI])(\d+) {2,}(\S.*?) {2,}(\S.*?):(\d+)$/;
const HEADER_NO_LINE = /^ {0,3}[BI]\d+ {2,}\S/;
const REVIEWER = /^ {1,3}([^\s:][^:]*?):\s+(\S.*)$/;
const FIELD_ROW = /^(\S.*?) {2,}(\S.*)$/; // applied to the trimmed line
const PROFILE = /·\s*[^·:]+:\s*([^·]+?)$/;

const FIELDS = ["intended", "actual", "example", "fix"];
const FIELD_LABELS = {
  intended: ["intended", "хотели"],
  actual: ["actually", "actual", "на деле"],
  example: ["example", "пример"],
  fix: ["fix", "поправить"],
};
const SEVERITY_LABELS = {
  blocker: ["blocker", "blocking", "блокирует", "блокер"],
  should: ["should fix", "should-fix", "should", "желательно"],
  optional: ["optional", "nice to have", "по желанию"],
};
const CATEGORY = { B: "bug", I: "improvement" };

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const lookup = (table, label) => {
  const key = norm(label);
  for (const [canon, names] of Object.entries(table)) if (names.includes(key)) return canon;
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
let profile = null;
let firstLine = true;
let reviewers = [];
let current = null;

function append(key, text) {
  current[key] = current[key] ? `${current[key]} ${text}` : text;
}

function closeCurrent() {
  if (!current) return;
  for (const key of FIELDS) {
    if (!current[key]) warnings.push(`finding ${current.id}: no ${key} text found`);
  }
  delete current._rows;
  delete current._last;
  findings.push(current);
  current = null;
}

for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.replace(/\t/g, "    ").replace(/\s+$/, "");
  if (/^\s*```/.test(line)) continue; // tolerate the fence the report is printed in
  if (!line) continue;

  if (firstLine) {
    firstLine = false;
    const p = line.match(PROFILE);
    if (p) profile = p[1];
  }

  const indent = line.length - line.trimStart().length;

  const h = line.match(HEADER);
  if (h) {
    closeCurrent();
    const id = `${h[1]}${h[2]}`;
    if (seen.has(id)) warnings.push(`finding ${id}: duplicate ID`);
    seen.add(id);
    const severity = lookup(SEVERITY_LABELS, h[3]);
    if (!severity) warnings.push(`finding ${id}: severity label "${h[3]}" not recognized; severity set to null`);
    if (!reviewers.length) warnings.push(`finding ${id}: no reviewer line above it`);
    current = {
      id,
      category: CATEGORY[h[1]],
      severity,
      severity_label: h[3],
      reviewers: [...reviewers],
      file: h[4],
      line: Number(h[5]),
      intended: "",
      actual: "",
      example: "",
      fix: "",
      _rows: 0,
      _last: null,
    };
    continue;
  }

  if (indent <= 3 && HEADER_NO_LINE.test(line)) {
    closeCurrent();
    warnings.push(`finding header without file:line, skipped: "${line.trim()}"`);
    continue;
  }

  if (indent === 0) {
    // section or category heading, or the final hint line
    closeCurrent();
    reviewers = [];
    continue;
  }

  if (indent <= 3) {
    const r = line.match(REVIEWER);
    if (r) {
      closeCurrent();
      reviewers = r[2].split(",").map((s) => s.trim()).filter(Boolean);
    }
    continue;
  }

  if (!current) continue; // prose in sections 01 / 03, glossary, verdict buckets
  const text = line.trim();

  if (indent >= 9) {
    if (current._last) append(current._last, text);
    else warnings.push(`finding ${current.id}: continuation line before any field, ignored`);
    continue;
  }

  // indent 4-8: a field row
  const f = text.match(FIELD_ROW);
  if (!f) {
    if (current._last) append(current._last, text);
    else warnings.push(`finding ${current.id}: unlabeled line "${text}", ignored`);
    continue;
  }
  let key = lookup(FIELD_LABELS, f[1]);
  if (!key) {
    key = FIELDS[current._rows];
    if (!key) {
      append(current._last, text);
      warnings.push(`finding ${current.id}: extra row "${f[1]}" appended to ${current._last}`);
      continue;
    }
    warnings.push(`finding ${current.id}: label "${f[1]}" not recognized; read as ${key} by position (translated label?)`);
  }
  current._rows += 1;
  append(key, f[2]);
  current._last = key;
}
closeCurrent();

if (findings.length === 0) {
  warnings.push("no finding blocks matched the expected format");
}

const summary = { count: findings.length, profile };
process.stdout.write(JSON.stringify({ findings, summary, warnings }, null, 2) + "\n");
process.exit(0);
