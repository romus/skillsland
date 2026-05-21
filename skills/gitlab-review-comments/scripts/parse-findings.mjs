#!/usr/bin/env node
// parse-findings.mjs — turn overall-review per-finding blocks into JSON.
// No deps. Reads the finding text on stdin, emits a normalized document on stdout.
// See SKILL.md Step 1 and references/gitlab-api.md for the contract.
//
// Input (stdin): the per-finding blocks printed by /overall-review, e.g.
//   [1] critical · security-audit · auth/login.py:42
//       Issue: SQL injection in the WHERE clause
//       Fix:   Use a parameterized query
//
//   1 issues across 3 reviewers — profile: security
//
// Output (stdout):
//   {
//     "findings": [
//       {"n":1,"severity":"critical","reviewers":["security-audit"],
//        "file":"auth/login.py","line":42,"issue":"...","fix":"..."}
//     ],
//     "summary": {"count":1,"reviewers":3,"profile":"security"} | null,
//     "warnings": ["..."]
//   }
// Exit: 0 always (empty findings -> warning); 2 if stdin is unreadable.

import { readFileSync } from "node:fs";

// header: [n] severity · reviewer(s) · file:line   (· is U+00B7, — below is U+2014)
const HEADER = /^\[(\d+)\]\s+(critical|major|minor|nit)\s*·\s*(.+?)\s*·\s*(.+):(\d+)\s*$/i;
const ISSUE = /^\s{2,}Issue:\s*(.*)$/i;
const FIX = /^\s{2,}Fix:\s*(.*)$/i;
const INDENTED = /^\s{2,}(\S.*)$/;
const SUMMARY = /^\s*(\d+)\s+issues?\s+across\s+(\d+)\s+reviewers?\s*(?:—|--)\s*profile:\s*(.+?)\s*$/i;
const NO_ISSUES = /^\s*No issues found\s*(?:—|--)\s*profile:\s*(.+?)\s*$/i;

let raw;
try {
  raw = readFileSync(0, "utf8");
} catch (e) {
  process.stdout.write(JSON.stringify({ error: `cannot read stdin: ${e.message}` }) + "\n");
  process.exit(2);
}

const findings = [];
const warnings = [];
let summary = null;
let current = null;

function closeCurrent() {
  if (!current) return;
  const extra = current._extra;
  // Tolerate translated labels: fill missing Issue/Fix from leftover indented lines.
  if (!current.issue && extra.length) {
    current.issue = extra.shift();
    warnings.push(`finding [${current.n}]: Issue label not matched; used an indented line (translated label?)`);
  }
  if (!current.fix && extra.length) {
    current.fix = extra.shift();
    warnings.push(`finding [${current.n}]: Fix label not matched; used an indented line (translated label?)`);
  }
  if (!current.issue) warnings.push(`finding [${current.n}]: no Issue text found`);
  delete current._extra;
  findings.push(current);
  current = null;
}

for (const line of raw.split(/\r?\n/)) {
  if (/^\s*```/.test(line)) continue; // tolerate a code fence pasted around the block

  const h = line.match(HEADER);
  if (h) {
    closeCurrent();
    current = {
      n: Number(h[1]),
      severity: h[2].toLowerCase(),
      reviewers: h[3].split(",").map((s) => s.trim()).filter(Boolean),
      file: h[4].trim(),
      line: Number(h[5]),
      issue: "",
      fix: "",
      _extra: [],
    };
    continue;
  }

  if (current) {
    const iss = line.match(ISSUE);
    if (iss) { current.issue = iss[1].trim(); continue; }
    const fx = line.match(FIX);
    if (fx) { current.fix = fx[1].trim(); continue; }
    const ind = line.match(INDENTED);
    if (ind) { current._extra.push(ind[1].trim()); continue; }
  }

  const ni = line.match(NO_ISSUES);
  if (ni) { summary = { count: 0, reviewers: 0, profile: ni[1].trim() }; continue; }
  const s = line.match(SUMMARY);
  if (s) { summary = { count: Number(s[1]), reviewers: Number(s[2]), profile: s[3].trim() }; continue; }
}
closeCurrent();

if (findings.length === 0) {
  warnings.push("no finding blocks matched the expected format");
}

process.stdout.write(JSON.stringify({ findings, summary, warnings }, null, 2) + "\n");
process.exit(0);
