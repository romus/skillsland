#!/usr/bin/env node
// fetch-papers.mjs — scan an arXiv submission window and rank it by citation count for sl-arxiv-digest.
// No deps. Node 20+ (global fetch, AbortSignal.timeout).
//
// Usage:
//   node fetch-papers.mjs --query '<arxiv search_query, no date clause>' \
//     [--days N | --from YYYY-MM-DD [--to YYYY-MM-DD]] [--top N] [--max N]
//
//   --query   required — e.g. 'cat:cs.AI OR cat:cs.LG' or '(cat:cs.CL) AND (all:"llm agents")'
//   --days    window ending now (default 1); mutually exclusive with --from/--to
//   --from/--to  explicit UTC date window; --to defaults to now; --to alone is an error
//   --top     papers to emit with abstracts (default 10, clamped 1..50)
//   --max     scan cap across the window (default 6000, clamped 1..30000 — the arXiv API hard cap)
//
// Env:
//   SEMANTIC_SCHOLAR_API_KEY  optional — sent as x-api-key (dedicated 1 rps instead of the shared pool)
//   S2_API_URL                optional — Semantic Scholar base-URL override (test hook)
//
// Pipeline: arXiv Atom API paged OLDEST-FIRST over the frozen window (so a --max truncation drops
// the newest, least-cited tail, keeping "top by citations" honest), then Semantic Scholar
// POST /graph/v1/paper/batch for citation counts, then sort citations desc / published desc.
//
// Emits one JSON object on stdout:
//   {
//     "query": "(cat:cs.AI OR cat:cs.LG) AND submittedDate:[202607130000 TO 202607141200]",
//     "from": "2026-07-13", "to": "2026-07-14",
//     "totalAvailable": 312,          // opensearch:totalResults (advisory)
//     "scanned": 312,                 // papers actually fetched and ranked
//     "ranking": "citations",         // or "submitted-date" when every S2 batch failed
//     "citationCoverage": { "resolved": 298, "scanned": 312, "failedBatches": 0 },
//     "papers": [ { "id", "title", "url", "published", "category", "citations", "abstract" } ],
//     "warnings": []
//   }
// Per-paper "citations" is an integer, or null when S2 has no record / its batch failed (ranked as 0).
// Exit: 0 = success (warnings and fallback ranking included); 1 = fatal, {"error","warnings"} on
// stdout so the caller can still parse it; 2 = CLI usage error (usage on stderr).

const ARXIV_API = "https://export.arxiv.org/api/query";
const S2_API = process.env.S2_API_URL || "https://api.semanticscholar.org";
const S2_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || "";
const UA = "skillsland/sl-arxiv-digest (+https://github.com/romus/skillsland)";

const ARXIV_PAGE = 2000; // API max per request
const ARXIV_DELAY_MS = 3000; // arXiv etiquette: one request per 3s
const ARXIV_RETRIES = 2; // extra attempts per page
const ARXIV_RETRY_WAIT_MS = 5000;
const ARXIV_TOTAL_CAP = 30000; // API refuses paging beyond this
const S2_BATCH = 500; // hard limit of /paper/batch
const S2_DELAY_MS = 1000; // matches the 1-rps authenticated limit
const S2_RETRY_WAITS_MS = [2000, 5000, 10000]; // on 429/5xx/network
const FETCH_TIMEOUT_MS = 90000;
const ABSTRACT_CAP = 3000;
const DEF_DAYS = 1;
const DEF_TOP = 10;
const MAX_TOP = 50;
const DEF_MAX = 6000;

const warnings = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    "usage: node fetch-papers.mjs --query '<arxiv search_query>' " +
      "[--days N | --from YYYY-MM-DD [--to YYYY-MM-DD]] [--top N] [--max N]",
  );
  process.exit(2);
}

function fatal(msg) {
  console.log(JSON.stringify({ error: msg, warnings }, null, 2));
  process.exit(1);
}

// --- CLI ---------------------------------------------------------------------
const args = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (!/^--(query|days|from|to|top|max)$/.test(flag)) usage(`unknown flag "${flag}"`);
  const val = args[++i];
  if (val === undefined) usage(`${flag} needs a value`);
  opts[flag.slice(2)] = val;
}

const query = (opts.query || "").trim();
if (!query) usage("--query is required and must be non-empty");
if (opts.days !== undefined && (opts.from || opts.to)) usage("--days is mutually exclusive with --from/--to");
if (opts.to && !opts.from) usage("--to requires --from");

const intArg = (name, def) => {
  if (opts[name] === undefined) return def;
  const n = Number(opts[name]);
  if (!Number.isInteger(n)) usage(`--${name} must be an integer`);
  return n;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const top = clamp(intArg("top", DEF_TOP), 1, MAX_TOP);
const max = clamp(intArg("max", DEF_MAX), 1, ARXIV_TOTAL_CAP);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const now = new Date();
let fromDate, toDate;
if (opts.from) {
  if (!DATE_RE.test(opts.from)) usage("--from must be YYYY-MM-DD");
  if (opts.to && !DATE_RE.test(opts.to)) usage("--to must be YYYY-MM-DD");
  fromDate = new Date(`${opts.from}T00:00:00Z`);
  toDate = opts.to ? new Date(`${opts.to}T23:59:00Z`) : now;
} else {
  const days = intArg("days", DEF_DAYS);
  if (days < 1) usage("--days must be >= 1");
  toDate = now;
  fromDate = new Date(now.getTime() - days * 86400000);
}
if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) usage("invalid date");
if (fromDate.getTime() > toDate.getTime()) usage("--from is after --to");

const stamp = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM (UTC)
const dateOnly = (d) => d.toISOString().slice(0, 10);
const fullQuery = `(${query}) AND submittedDate:[${stamp(fromDate)} TO ${stamp(toDate)}]`;

// --- Atom parsing ------------------------------------------------------------
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
const clean = (s) => decodeEntities(s.replace(/\s+/g, " ").trim());

function field(entry, tag) {
  const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : "";
}

function parseEntries(xml) {
  return xml
    .split(/<entry[>\s]/)
    .slice(1)
    .map((c) => {
      const rawId = field(c, "id").trim();
      return {
        rawId,
        id: rawId.replace(/^.*\/abs\//, "").replace(/v\d+$/, ""), // keep old-form prefix (math/0211159)
        title: clean(field(c, "title")),
        abstract: clean(field(c, "summary")),
        publishedRaw: field(c, "published").trim(),
        category:
          c.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ??
          c.match(/<category[^>]*term="([^"]+)"/)?.[1] ??
          "",
        citations: null,
      };
    });
}

const totalResultsOf = (xml) => {
  const m = xml.match(/<opensearch:totalResults[^>]*>(\d+)</);
  return m ? Number(m[1]) : null;
};

// --- arXiv scan (stage 1) ----------------------------------------------------
async function fetchArxivPage(start, count) {
  const params = new URLSearchParams({
    search_query: fullQuery,
    start: String(start),
    max_results: String(count),
    sortBy: "submittedDate",
    sortOrder: "ascending",
  });
  let lastErr;
  for (let attempt = 0; attempt <= ARXIV_RETRIES; attempt++) {
    if (attempt > 0) await sleep(ARXIV_RETRY_WAIT_MS);
    try {
      const res = await fetch(`${ARXIV_API}?${params}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) break; // client error (e.g. malformed query) — retrying won't help
        continue;
      }
      return await res.text();
    } catch (e) {
      lastErr = e?.message || String(e);
    }
  }
  throw new Error(`arXiv request failed (${lastErr}) at start=${start}`);
}

async function scanArxiv() {
  const papers = new Map(); // id -> paper (dedup across pages/versions)
  let totalAvailable = null;
  let start = 0;
  let stoppedEarly = false;

  while (start < max) {
    const want = Math.min(ARXIV_PAGE, max - start);
    let xml;
    try {
      xml = await fetchArxivPage(start, want);
    } catch (e) {
      if (start === 0) fatal(e.message);
      warnings.push(`arXiv scan stopped early at ${papers.size} papers (${e.message}); ranking what was fetched`);
      stoppedEarly = true;
      break;
    }
    totalAvailable ??= totalResultsOf(xml);
    let entries = parseEntries(xml);

    if (start === 0 && entries.length === 1 && entries[0].rawId.includes("api/errors")) {
      fatal(`arXiv rejected the query: ${entries[0].abstract || entries[0].title || "malformed query"}`);
    }
    if (start === 0 && entries.length === 0) {
      // known transient flake: a first page can come back empty — one guarded retry
      await sleep(ARXIV_RETRY_WAIT_MS);
      xml = await fetchArxivPage(0, want);
      totalAvailable = totalResultsOf(xml) ?? totalAvailable;
      entries = parseEntries(xml);
      if (entries.length === 0) {
        warnings.push("arXiv returned no papers for this query and window");
        break;
      }
    }

    for (const p of entries) if (p.id && !papers.has(p.id)) papers.set(p.id, p);
    start += entries.length;
    if (entries.length < want) break; // window exhausted
    if (totalAvailable !== null && start >= totalAvailable) break;
    if (start < max) await sleep(ARXIV_DELAY_MS);
  }

  if (totalAvailable === null) {
    totalAvailable = papers.size;
    warnings.push("arXiv did not report totalResults; totalAvailable is a lower bound");
  }
  if (!stoppedEarly && totalAvailable > papers.size) {
    warnings.push(
      `scanned only the oldest ${papers.size} of ${totalAvailable} papers in the window (--max ${max}); ` +
        "the newest tail was not ranked — narrow the topics/window or raise --max",
    );
  }
  return { papers, totalAvailable };
}

// --- Semantic Scholar citations (stage 2) ------------------------------------
async function s2Batch(ids) {
  const headers = { "Content-Type": "application/json", "User-Agent": UA };
  if (S2_KEY) headers["x-api-key"] = S2_KEY;
  let lastErr = "unknown";
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await sleep(S2_RETRY_WAITS_MS[attempt - 1]);
    try {
      const res = await fetch(`${S2_API}/graph/v1/paper/batch?fields=citationCount`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ids: ids.map((id) => `ARXIV:${id}`) }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return { rows: data };
        lastErr = "unexpected response shape";
      } else {
        lastErr = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) return { error: lastErr }; // non-retryable
      }
    } catch (e) {
      lastErr = e?.message || String(e); // network / timeout — retry
    }
    if (attempt >= S2_RETRY_WAITS_MS.length) return { error: lastErr };
  }
}

async function rankByCitations(papers) {
  const ids = [...papers.keys()];
  let resolved = 0;
  let failedBatches = 0;
  let okBatches = 0;
  let lastError = "";
  const batches = Math.ceil(ids.length / S2_BATCH);

  for (let i = 0; i < ids.length; i += S2_BATCH) {
    if (i > 0) await sleep(S2_DELAY_MS);
    const chunk = ids.slice(i, i + S2_BATCH);
    const res = await s2Batch(chunk);
    if (res.error) {
      failedBatches++;
      lastError = res.error;
      continue;
    }
    okBatches++;
    res.rows.forEach((row, j) => {
      if (row && typeof row.citationCount === "number") {
        papers.get(chunk[j]).citations = row.citationCount;
        resolved++;
      }
    });
  }

  const ranking = ids.length === 0 || okBatches > 0 ? "citations" : "submitted-date";
  if (ranking === "submitted-date") {
    warnings.push(`Semantic Scholar unavailable (all ${batches} citation batches failed, last error ${lastError}) — falling back to newest-first order, citations unknown`);
  } else if (failedBatches > 0) {
    warnings.push(`citation lookup failed for ${failedBatches} of ${batches} batches (last error ${lastError}) — the affected papers rank as 0 citations`);
  }
  return { ranking, citationCoverage: { resolved, scanned: ids.length, failedBatches } };
}

// --- main ---------------------------------------------------------------------
if (typeof fetch !== "function") fatal("Node 20+ with global fetch is required");

try {
  const { papers, totalAvailable } = await scanArxiv();
  const { ranking, citationCoverage } = await rankByCitations(papers);

  const sorted = [...papers.values()].sort((a, b) =>
    ranking === "citations" && (b.citations ?? 0) !== (a.citations ?? 0)
      ? (b.citations ?? 0) - (a.citations ?? 0)
      : b.publishedRaw.localeCompare(a.publishedRaw),
  );

  const out = {
    query: fullQuery,
    from: dateOnly(fromDate),
    to: dateOnly(toDate),
    totalAvailable,
    scanned: papers.size,
    ranking,
    citationCoverage,
    papers: sorted.slice(0, top).map((p) => ({
      id: p.id,
      title: p.title,
      url: `https://arxiv.org/abs/${p.id}`,
      published: p.publishedRaw.slice(0, 10),
      category: p.category,
      citations: p.citations,
      abstract: p.abstract.length > ABSTRACT_CAP ? `${p.abstract.slice(0, ABSTRACT_CAP)}…` : p.abstract,
    })),
    warnings,
  };
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  fatal(`unexpected failure: ${e?.message || e}`);
}
