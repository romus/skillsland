#!/usr/bin/env node
// validate-manifest.mjs — cross-check manifest.json against skills/ tree.
// No deps. Exits 0 on success, non-zero on any problem.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "manifest.json");
const SKILLS_DIR = join(ROOT, "skills");
const VALID_TARGETS = new Set(["claude-code", "codex"]);
const REQUIRED_FRONTMATTER = ["name", "description", "version"];

const errors = [];
const fail = (msg) => errors.push(msg);

// --- load manifest ----------------------------------------------------------
if (!existsSync(MANIFEST_PATH)) {
  console.error(`manifest.json not found at ${MANIFEST_PATH}`);
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  console.error(`manifest.json: invalid JSON — ${e.message}`);
  process.exit(2);
}

if (!Array.isArray(manifest.skills)) {
  fail("manifest.json: `skills` must be an array");
}

// --- parse a SKILL.md frontmatter block ------------------------------------
function parseFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return null;
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const block = text.slice(4, end);
  const out = {};
  let currentKey = null;
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    // list item under previous key
    const listMatch = rawLine.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(out[currentKey])) out[currentKey] = [];
      out[currentKey].push(listMatch[1].trim());
      continue;
    }
    const kv = rawLine.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    currentKey = key;
    if (value === "") {
      out[key] = [];
    } else if (value.startsWith("[") && value.endsWith("]")) {
      out[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// --- check each manifest entry ---------------------------------------------
const manifestNames = new Set();
for (const entry of manifest.skills ?? []) {
  const label = `manifest.skills[${entry.name ?? "?"}]`;
  if (!entry.name) {
    fail(`${label}: missing \`name\``);
    continue;
  }
  if (manifestNames.has(entry.name)) {
    fail(`${label}: duplicate name`);
  }
  manifestNames.add(entry.name);

  if (!entry.path) fail(`${label}: missing \`path\``);
  if (!entry.version) fail(`${label}: missing \`version\``);
  if (!entry.description) fail(`${label}: missing \`description\``);

  if (entry.targets) {
    for (const t of entry.targets) {
      if (!VALID_TARGETS.has(t)) {
        fail(`${label}: invalid target "${t}" (must be one of ${[...VALID_TARGETS].join(", ")})`);
      }
    }
  }

  const skillDir = join(ROOT, entry.path ?? "");
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    fail(`${label}: path "${entry.path}" does not exist on disk`);
    continue;
  }

  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    fail(`${label}: SKILL.md missing at ${entry.path}/SKILL.md`);
    continue;
  }

  const fm = parseFrontmatter(readFileSync(skillMdPath, "utf8"));
  if (!fm) {
    fail(`${label}: SKILL.md has no YAML frontmatter`);
    continue;
  }

  for (const k of REQUIRED_FRONTMATTER) {
    if (!fm[k]) fail(`${label}: SKILL.md missing required frontmatter \`${k}\``);
  }

  if (fm.name && fm.name !== entry.name) {
    fail(`${label}: SKILL.md name "${fm.name}" ≠ manifest name "${entry.name}"`);
  }
  if (fm.version && fm.version !== entry.version) {
    fail(`${label}: SKILL.md version "${fm.version}" ≠ manifest version "${entry.version}"`);
  }
}

// --- check skills/ on disk matches manifest --------------------------------
if (existsSync(SKILLS_DIR)) {
  for (const dirent of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    if (!manifestNames.has(dirent.name)) {
      fail(`skills/${dirent.name}/: directory present on disk but not listed in manifest.json`);
    }
  }
}

// --- report ----------------------------------------------------------------
if (errors.length === 0) {
  console.log(`ok — validated ${manifest.skills?.length ?? 0} skill(s)`);
  process.exit(0);
}

for (const e of errors) console.error(`✗ ${e}`);
console.error(`\n${errors.length} problem(s)`);
process.exit(1);
