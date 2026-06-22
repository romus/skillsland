#!/usr/bin/env node
// render-report.mjs — render a deepen-architecture candidates document.
// No deps. Node 20+. The agent emits SEMANTICS (a candidates JSON); this script
// owns all MARKUP, in two formats from one numeric depth-spec:
//
//   node render-report.mjs --format html <input.json> <output.html>   # self-contained HTML + inline SVG
//   node render-report.mjs --format text [<input.json>]               # plain text + ASCII (stdin if no path)
//
// Contract + degradation rules: references/report-format.md.
// Exit: 0 on success; 1 on malformed input / failed validation / unsafe output path
//        (writes/prints nothing in HTML mode on failure); 2 if input is unreadable.

import { readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import { resolve, dirname, basename, sep } from "node:path";

const SCHEMA_VERSION = 1;
const STRENGTHS = new Set(["Strong", "Worth exploring", "Speculative"]);

// ---------------------------------------------------------------------------
// argv

const argv = process.argv.slice(2);
let format = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--format") format = argv[++i];
  else if (argv[i].startsWith("--format=")) format = argv[i].slice("--format=".length);
  else positional.push(argv[i]);
}
if (format !== "html" && format !== "text") {
  process.stderr.write("render-report: --format must be 'html' or 'text'\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// read + parse input

let raw;
try {
  if (positional[0]) raw = readFileSync(positional[0], "utf8");
  else if (format === "text") raw = readFileSync(0, "utf8"); // stdin
  else throw new Error("HTML mode requires <input.json> <output.html>");
} catch (e) {
  process.stderr.write(`render-report: cannot read input: ${e.message}\n`);
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(raw);
} catch (e) {
  process.stderr.write(`render-report: input is not valid JSON: ${e.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// validate (fatal vs per-card)

const warnings = Array.isArray(doc.warnings) ? [...doc.warnings] : [];
function fatal(msg) {
  process.stderr.write(`render-report: ${msg}\n`);
  process.exit(1);
}

if (doc.schemaVersion !== SCHEMA_VERSION) {
  fatal(`unsupported schemaVersion ${JSON.stringify(doc.schemaVersion)} (need ${SCHEMA_VERSION})`);
}
for (const k of ["repo", "generatedAt", "scope"]) {
  if (typeof doc[k] !== "string" || !doc[k]) fatal(`missing required string field "${k}"`);
}
if (typeof doc.context !== "object" || doc.context === null) fatal(`missing required object "context"`);
if (!Array.isArray(doc.candidates)) fatal(`missing required array "candidates"`);
if (!Array.isArray(doc.dropped)) fatal(`missing required array "dropped"`);

// keep only renderable candidates; warn (don't fail) on bad ones
const candidates = [];
doc.candidates.forEach((c, idx) => {
  const label = (c && c.id) || `#${idx + 1}`;
  if (!c || typeof c !== "object") return warnings.push(`candidate ${label}: not an object — skipped`);
  for (const k of ["title", "problem", "solution"]) {
    if (typeof c[k] !== "string" || !c[k]) return warnings.push(`candidate ${label}: missing "${k}" — skipped`);
  }
  if (!Array.isArray(c.files) || c.files.length === 0) {
    return warnings.push(`candidate ${label}: "files" must be a non-empty array — skipped`);
  }
  if (!STRENGTHS.has(c.strength)) {
    warnings.push(`candidate ${label}: unknown strength ${JSON.stringify(c.strength)} — treated as Speculative`);
    c.strength = "Speculative";
  }
  candidates.push(c);
});

// ---------------------------------------------------------------------------
// shared helpers

const clampInt = (v, lo, hi, def) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
};
const truncate = (s, n) => {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Normalize a before/after depth-spec to clamped numbers + a short label. */
function normSpec(spec, fallbackLabel) {
  const s = spec && typeof spec === "object" ? spec : {};
  return {
    interface: clampInt(s.interface, 1, 10, 5),
    depth: clampInt(s.depth, 1, 10, 5),
    callers: clampInt(s.callers, 0, 10, 0),
    leaks: clampInt(s.leaks, 0, 5, 0),
    label: truncate(s.label ?? fallbackLabel ?? "", 18),
  };
}

// ===========================================================================
// SVG (HTML mode)

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Strip dangerous bits from an agent-supplied raw SVG override (untrusted). */
function sanitizeSvg(svg) {
  return String(svg)
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"(?:[^"]*)"/gi, "")
    .replace(/\son\w+\s*=\s*'(?:[^']*)'/gi, "")
    .replace(/(href|xlink:href|src)\s*=\s*"(?:\s*(?:javascript:|https?:|\/\/)[^"]*)"/gi, "")
    .replace(/(href|xlink:href|src)\s*=\s*'(?:\s*(?:javascript:|https?:|\/\/)[^']*)'/gi, "");
}

/**
 * Draw the module as a rectangle: width ∝ interface (API surface),
 * height ∝ functionality (depth). Shallow = wide+short; deep = narrow+tall.
 * Bottom-anchored at y=180 so the top edge (the interface) is the comparison line.
 * Caller arrows point down into the top edge; leak arrows pierce the sides.
 */
function depthSvg(spec, role) {
  const W = 40 + spec.interface * 16; // 56..200
  const H = 20 + spec.depth * 14; // 34..160
  const x = Math.round((240 - W) / 2);
  const topY = 180 - H;
  const cx = 120;

  const parts = [];
  // caller arrows (down into the top edge)
  const nDraw = Math.min(spec.callers, 6);
  for (let i = 0; i < nDraw; i++) {
    const ax = nDraw === 1 ? cx : Math.round(x + 12 + (i * (W - 24)) / (nDraw - 1));
    parts.push(
      `<line x1="${ax}" y1="6" x2="${ax}" y2="${topY - 3}" stroke="#57606a" stroke-width="1.5"/>` +
        `<path d="M${ax - 3},${topY - 7} L${ax},${topY - 1} L${ax + 3},${topY - 7} Z" fill="#57606a"/>`
    );
  }
  // module box
  parts.push(
    `<rect x="${x}" y="${topY}" width="${W}" height="${H}" rx="4" fill="#dbe7ff" stroke="#3b5bdb" stroke-width="1.5"/>`
  );
  // emphasize the interface (top edge)
  parts.push(`<line x1="${x}" y1="${topY}" x2="${x + W}" y2="${topY}" stroke="#1e3a8a" stroke-width="4"/>`);
  // leak arrows (pierce alternating sides, pointing outward)
  const nLeak = Math.min(spec.leaks, 5);
  for (let i = 0; i < nLeak; i++) {
    const left = i % 2 === 0;
    const ly = Math.round(topY + 12 + (i * (H - 20)) / Math.max(1, nLeak));
    if (left) {
      parts.push(
        `<line x1="${x}" y1="${ly}" x2="${x - 14}" y2="${ly}" stroke="#c0392b" stroke-width="1.5"/>` +
          `<path d="M${x - 14},${ly - 3} L${x - 20},${ly} L${x - 14},${ly + 3} Z" fill="#c0392b"/>`
      );
    } else {
      parts.push(
        `<line x1="${x + W}" y1="${ly}" x2="${x + W + 14}" y2="${ly}" stroke="#c0392b" stroke-width="1.5"/>` +
          `<path d="M${x + W + 14},${ly - 3} L${x + W + 20},${ly} L${x + W + 14},${ly + 3} Z" fill="#c0392b"/>`
      );
    }
  }
  // label + caption
  const callerTxt = spec.callers > 6 ? `${spec.callers}+ callers` : plural(spec.callers, "caller");
  parts.push(
    `<text x="${cx}" y="14" text-anchor="middle" font-size="11" font-weight="600" fill="#24292f">${esc(spec.label)}</text>`
  );
  parts.push(
    `<text x="${cx}" y="194" text-anchor="middle" font-size="10" fill="#57606a">${esc(callerTxt)} · ${esc(plural(spec.leaks, "leak"))}</text>`
  );

  const title = `${role}: ${spec.label || "module"} — interface ${spec.interface}/10, depth ${spec.depth}/10, ${callerTxt}, ${plural(spec.leaks, "leak")}`;
  return (
    `<svg viewBox="0 0 240 200" role="img" width="240" height="200" font-family="system-ui,sans-serif">` +
    `<title>${esc(title)}</title>` +
    `<desc>${esc(title)}. A ${spec.interface >= 7 ? "wide" : spec.interface <= 4 ? "narrow" : "moderate"} interface over a ${spec.depth >= 7 ? "deep" : spec.depth <= 4 ? "shallow" : "moderate"} body.</desc>` +
    parts.join("") +
    `</svg>`
  );
}

function diagramHtml(c) {
  if (c.diagramSvg && typeof c.diagramSvg === "object" && (c.diagramSvg.before || c.diagramSvg.after)) {
    const b = c.diagramSvg.before ? sanitizeSvg(c.diagramSvg.before) : "";
    const a = c.diagramSvg.after ? sanitizeSvg(c.diagramSvg.after) : "";
    return `<div class="diagram"><figure><figcaption>Before</figcaption>${b}</figure><figure><figcaption>After</figcaption>${a}</figure></div>`;
  }
  if (!c.diagram || typeof c.diagram !== "object") return "";
  const before = normSpec(c.diagram.before, c.diagram.after?.label);
  const after = normSpec(c.diagram.after, c.diagram.before?.label);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    warnings.push(`candidate ${c.id || c.title}: before/after diagram specs are identical — diagram shows no change`);
  }
  return (
    `<div class="diagram">` +
    `<figure><figcaption>Before — shallow</figcaption>${depthSvg(before, "Before")}</figure>` +
    `<figure><figcaption>After — deep</figcaption>${depthSvg(after, "After")}</figure>` +
    `</div>`
  );
}

function benefitsHtml(b) {
  if (!b || typeof b !== "object") return "";
  const rows = [];
  if (b.locality) rows.push(`<li><strong>Locality:</strong> ${esc(b.locality)}</li>`);
  if (b.leverage) rows.push(`<li><strong>Leverage:</strong> ${esc(b.leverage)}</li>`);
  if (b.tests) rows.push(`<li><strong>Tests:</strong> ${esc(b.tests)}</li>`);
  return rows.length ? `<section><h3>Benefits</h3><ul class="benefits">${rows.join("")}</ul></section>` : "";
}

function signalPanels(ctx) {
  const s = (ctx && ctx.signals) || {};
  const panels = [];
  const list = (arr, fn) => `<ul>${arr.map((x) => `<li>${fn(x)}</li>`).join("")}</ul>`;
  if (Array.isArray(s.churnHotspots) && s.churnHotspots.length) {
    panels.push(`<div class="panel"><h4>Churn hotspots</h4>${list(s.churnHotspots.slice(0, 8), (x) => `${esc(x.path)} <span class="dim">· ${x.commits} commits</span>`)}</div>`);
  }
  if (Array.isArray(s.coChangeClusters) && s.coChangeClusters.length) {
    panels.push(`<div class="panel"><h4>Co-change clusters</h4>${list(s.coChangeClusters.slice(0, 8), (x) => `${esc((x.files || []).join(" ↔ "))} <span class="dim">· ${x.together}×</span>`)}</div>`);
  }
  if (Array.isArray(s.largestFiles) && s.largestFiles.length) {
    panels.push(`<div class="panel"><h4>Largest files</h4>${list(s.largestFiles.slice(0, 8), (x) => `${esc(x.path)} <span class="dim">· ${x.loc ?? "?"} loc</span>`)}</div>`);
  }
  if (!panels.length) return "";
  return `<section class="overview"><h2>Complexity map</h2><div class="panels">${panels.join("")}</div></section>`;
}

function cardHtml(c, n) {
  const cls = c.strength === "Strong" ? "s-strong" : c.strength === "Worth exploring" ? "s-worth" : "s-spec";
  const lenses = Array.isArray(c.lenses) && c.lenses.length
    ? `<div class="lenses">${c.lenses.map((l) => `<span class="tag">${esc(l)}</span>`).join("")}</div>` : "";
  const alt = c.alternativeConsidered ? `<p class="alt"><strong>Alternative considered:</strong> ${esc(c.alternativeConsidered)}</p>` : "";
  const principle = c.principle ? `<p class="principle">${esc(c.principle)}</p>` : "";
  return (
    `<article class="card ${cls}">` +
    `<div class="cardhead"><span class="badge ${cls}">${esc(c.strength)}</span><h2>${n}. ${esc(c.title)}</h2></div>` +
    lenses +
    `<p class="files"><strong>Files:</strong> ${c.files.map((f) => `<code>${esc(f)}</code>`).join(", ")}</p>` +
    `<section><h3>Problem</h3><p>${esc(c.problem)}</p></section>` +
    `<section><h3>Solution</h3>${principle}<p>${esc(c.solution)}</p>${alt}</section>` +
    benefitsHtml(c.benefits) +
    diagramHtml(c) +
    `</article>`
  );
}

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#24292f;background:#f6f8fa;margin:0;padding:0 16px 64px}
.wrap{max-width:1000px;margin:0 auto}
header.top{padding:28px 0 8px;border-bottom:1px solid #d0d7de;margin-bottom:24px}
header.top h1{margin:0 0 6px;font-size:24px}
header.top .meta{color:#57606a;font-size:13px}
header.top .note{display:inline-block;margin-top:10px;padding:4px 10px;border-radius:6px;background:#fff8c5;border:1px solid #d4a72c;font-size:13px;font-weight:600;color:#7d4e00}
.overview{margin:0 0 28px}.overview h2{font-size:15px;color:#57606a;text-transform:uppercase;letter-spacing:.04em}
.panels{display:flex;flex-wrap:wrap;gap:16px}
.panel{flex:1 1 260px;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:12px 14px}
.panel h4{margin:0 0 8px;font-size:13px}.panel ul{margin:0;padding-left:16px;font-size:12px}
.panel code,.files code{background:#eff1f3;border-radius:4px;padding:1px 4px;font-size:12px}
.dim{color:#8b949e;font-size:11px}
.card{background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:18px 22px;margin:0 0 22px;border-left-width:6px}
.card.s-strong{border-left-color:#1a7f37}.card.s-worth{border-left-color:#9a6700}.card.s-spec{border-left-color:#57606a}
.cardhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cardhead h2{margin:0;font-size:19px}
.badge{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;color:#fff;white-space:nowrap}
.badge.s-strong{background:#1a7f37}.badge.s-worth{background:#9a6700}.badge.s-spec{background:#57606a}
.lenses{margin:8px 0 0}.tag{display:inline-block;background:#eaeef2;color:#57606a;border-radius:6px;padding:2px 8px;font-size:11px;margin-right:6px}
.card h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#57606a;margin:16px 0 4px}
.card p{margin:4px 0}.alt{color:#57606a;font-size:14px}.principle{color:#3b5bdb;font-style:italic;font-size:13px;margin:0}
.benefits{margin:4px 0;padding-left:18px}.benefits li{margin:3px 0}
.diagram{display:flex;gap:24px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px dashed #d0d7de}
.diagram figure{margin:0;text-align:center}.diagram figcaption{font-size:12px;color:#57606a;margin-bottom:4px;font-weight:600}
.empty{background:#fff;border:1px dashed #d0d7de;border-radius:10px;padding:32px;text-align:center;color:#57606a}
footer.warn{margin-top:32px;font-size:12px;color:#8b949e;border-top:1px solid #d0d7de;padding-top:12px}
footer.warn li{margin:2px 0}
@media print{body{background:#fff}.card,.panel{break-inside:avoid}}
`;

function renderHtml() {
  const ctx = doc.context || {};
  const docsLine = Array.isArray(ctx.docsRead) && ctx.docsRead.length
    ? ` · context: ${ctx.docsRead.map(esc).join(", ")}` : "";
  const tooling = doc.tooling && doc.tooling.deepStudy ? ` · symbols via ${esc(doc.tooling.deepStudy)}` : "";
  const body = candidates.length
    ? candidates.map((c, i) => cardHtml(c, i + 1)).join("")
    : `<div class="empty"><h2>No high-leverage restructuring found</h2><p>The analysis did not surface an architecture change worth proposing for this scope.</p></div>`;
  const dropped = Array.isArray(doc.dropped) && doc.dropped.length
    ? `<section class="overview"><h2>Considered &amp; dropped</h2><ul>${doc.dropped.map((d) => `<li>${esc(d.title || "?")} — <span class="dim">${esc(d.reason || "")}</span></li>`).join("")}</ul></section>`
    : "";
  const warn = warnings.length
    ? `<footer class="warn"><strong>Notes:</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></footer>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Architecture proposal — ${esc(doc.repo)}</title>
<style>${CSS}</style></head>
<body><div class="wrap">
<header class="top">
<h1>Architecture improvement proposal</h1>
<div class="meta">repo: <strong>${esc(doc.repo)}</strong> · scope: ${esc(doc.scope)} · generated ${esc(doc.generatedAt)}${tooling}${docsLine}</div>
<span class="note">This is a proposal — no code was changed.</span>
</header>
${signalPanels(ctx)}
<main>${body}</main>
${dropped}
${warn}
</div></body></html>
`;
}

// ===========================================================================
// ASCII (text mode)

function asciiBox(spec, indent = "  ") {
  const cols = 4 + spec.interface * 2; // 6..24 inner width
  const rows = Math.max(1, Math.round(spec.depth * 0.8)); // 1..8
  const top = "┌" + "─".repeat(cols) + "┐";
  const bot = "└" + "─".repeat(cols) + "┘";
  const mid = "│" + " ".repeat(cols) + "│";
  const callerTxt = spec.callers > 6 ? `${spec.callers}+ callers` : plural(spec.callers, "caller");
  const ticks = "▼".repeat(Math.min(spec.callers, Math.min(cols, 8)));
  const lines = [];
  if (spec.label) lines.push(indent + spec.label);
  if (ticks) lines.push(indent + ticks);
  lines.push(indent + top);
  for (let i = 0; i < rows; i++) lines.push(indent + mid);
  lines.push(indent + bot);
  lines.push(indent + `(${callerTxt} · ${plural(spec.leaks, "leak")})`);
  return lines.join("\n");
}

function diagramText(c) {
  if (!c.diagram || typeof c.diagram !== "object") return "";
  const before = normSpec(c.diagram.before, c.diagram.after?.label);
  const after = normSpec(c.diagram.after, c.diagram.before?.label);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    warnings.push(`candidate ${c.id || c.title}: before/after diagram specs are identical — diagram shows no change`);
  }
  return (
    "  Before (shallow):\n" + asciiBox(before, "    ") + "\n\n" +
    "  After (deep):\n" + asciiBox(after, "    ")
  );
}

function wrapLabeled(label, text, width = 78) {
  // soft-wrap a "Label: text" line, continuation aligned under the text column
  const pad = " ".repeat(label.length);
  const words = String(text).split(/\s+/);
  const out = [];
  let line = label;
  for (const w of words) {
    if (line.length + 1 + w.length > width && line.trim() !== label.trim()) {
      out.push(line);
      line = pad + w;
    } else {
      line += (line.endsWith(" ") || line === label ? "" : " ") + w;
    }
  }
  out.push(line);
  return out.join("\n");
}

function cardText(c, n) {
  const L = [];
  L.push("═".repeat(72));
  L.push(`[${n}] ${c.strength} · ${c.title}`);
  L.push("─".repeat(72));
  L.push(wrapLabeled("Files:    ", c.files.join(", ")));
  if (c.lenses && c.lenses.length) L.push(wrapLabeled("Lenses:   ", c.lenses.join(", ")));
  L.push(wrapLabeled("Problem:  ", c.problem));
  L.push(wrapLabeled("Solution: ", c.solution));
  if (c.alternativeConsidered) L.push(wrapLabeled("  Alt.:   ", c.alternativeConsidered));
  const b = c.benefits || {};
  if (b.locality || b.leverage || b.tests) {
    L.push("Benefits:");
    if (b.locality) L.push(wrapLabeled("  Locality: ", b.locality));
    if (b.leverage) L.push(wrapLabeled("  Leverage: ", b.leverage));
    if (b.tests) L.push(wrapLabeled("  Tests:    ", b.tests));
  }
  const diag = diagramText(c);
  if (diag) {
    L.push("");
    L.push(diag);
  }
  return L.join("\n");
}

function renderText() {
  const L = [];
  L.push("Architecture improvement proposal — no code was changed");
  const tooling = doc.tooling && doc.tooling.deepStudy ? ` · symbols via ${doc.tooling.deepStudy}` : "";
  L.push(`repo: ${doc.repo} · scope: ${doc.scope} · ${doc.generatedAt}${tooling}`);
  const docs = Array.isArray(doc.context?.docsRead) ? doc.context.docsRead : [];
  if (docs.length) L.push(`context read: ${docs.join(", ")}`);
  L.push("");
  if (!candidates.length) {
    L.push(`No high-leverage restructuring found — scope: ${doc.scope}`);
  } else {
    candidates.forEach((c, i) => {
      L.push(cardText(c, i + 1));
      L.push("");
    });
  }
  if (Array.isArray(doc.dropped) && doc.dropped.length) {
    L.push("Dropped (lower leverage): " + doc.dropped.map((d) => d.title || "?").join("; "));
  }
  if (warnings.length) {
    L.push("");
    L.push("Notes:");
    warnings.forEach((w) => L.push("  - " + w));
  }
  L.push("");
  L.push(`${candidates.length} ${candidates.length === 1 ? "candidate" : "candidates"} — scope: ${doc.scope}`);
  return L.join("\n") + "\n";
}

// ===========================================================================
// output

if (format === "text") {
  process.stdout.write(renderText());
  process.exit(0);
}

// HTML: enforce path containment, then validate-render-tmp-rename-copy.
const outArg = positional[1];
if (!outArg) fatal("HTML mode requires an output path: --format html <input.json> <output.html>");
const outAbs = resolve(outArg);
const dir = dirname(outAbs);
const dirTail = dir.split(sep).slice(-2).join("/");
if (dirTail !== ".skillsland/deepen-architecture") {
  fatal(`refusing to write outside .skillsland/deepen-architecture/ (got ${dir})`);
}
if (!outAbs.endsWith(".html")) fatal("output path must end in .html");

// renderHtml() renders cards first (which may push diagram-twin warnings), then the
// warnings footer — so any warning raised during rendering still lands in the report.
const html = renderHtml();

try {
  const tmp = outAbs + ".tmp";
  writeFileSync(tmp, html, "utf8");
  renameSync(tmp, outAbs);
  copyFileSync(outAbs, resolve(dir, "latest.html"));
} catch (e) {
  fatal(`failed to write report: ${e.message}`);
}
process.stdout.write(`${basename(outAbs)}\n`);
process.exit(0);
