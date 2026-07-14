---
name: sl-arxiv-digest
description: This skill should be used when the user asks to "make an arxiv digest", "digest of recent arXiv papers", "top cited arXiv papers this month", "most cited new papers on arXiv", "what came out on arxiv about <topic> lately", «сделай дайджест arxiv», «самые цитируемые статьи arxiv за месяц», «подборка свежих статей arxiv по <теме>», or invokes "/sl-arxiv-digest" (optionally with topics and/or a window, e.g. "/sl-arxiv-digest llm agents --days 14"). Builds a MULTI-paper digest — fetches every arXiv paper in the requested window (default the last day; default categories cs.AI + cs.LG when no topics are given), ranks them by Semantic Scholar citation count (disclosed newest-first fallback when citation data is unavailable), and describes each of the top N (default 10) in 2–4 plain-language sentences in the user's language, keeping original English titles. Chat-only output, no files written. NOT for explaining a single given paper or arXiv URL/ID in depth — this skill ranks and summarizes many papers.
version: 0.1.0
targets:
  - claude-code
  - codex
allowed-tools:
  - Bash
  - Read
tags: [research, arxiv, papers, digest, citations]
---

# arXiv Digest — most-cited recent papers, explained simply

You build a digest of the arXiv papers **submitted in a requested time window**, ranked by
**citation count** (Semantic Scholar), and explain each of the top N in plain language. All the
mechanical work — the window scan, citation lookup, ranking — is done by the bundled script; your
job is to parse the request, build the query, run the script once, and write the digest.

**Hard rules for the entire run:**
- Write the digest in the language of the user's request (unless they name another language).
  Paper **titles stay in their original English, verbatim — never translate them.**
- **No markdown tables anywhere in the output.** Codex renders raw text, so tables collapse into
  pipe-noise — use the per-paper blocks of Step 4 only.
- **arXiv etiquette.** The script already sleeps 3s between its API requests. Run it **once** per
  digest (again only with changed parameters), never in parallel, and never add your own arXiv
  calls (WebFetch/curl) alongside — the script output already contains every title and abstract
  you need.
- **Read-only.** Write no files unless the user explicitly asks to save the digest.
- **Honest disclosure is mandatory.** Truncation, ranking fallback, low citation coverage, and
  empty windows are stated in the digest header — never silently ignored.
- **Never fabricate** papers, citation counts, or rankings. If the script fails, report its error
  and stop; do not invent a digest.

---

## Step 1 — Parse the request

- **Topics** (optional): free-text subjects ("llm agents", "diffusion") and/or arXiv category
  codes (`cs.CL`, `quant-ph`, `stat.ML`). May be entirely absent — that is a supported mode.
- **Window**: default **the last day** (`--days 1`). Map natural language — "this week" /
  «за неделю» → `--days 7`; "this month" / «за месяц» → `--days 30`; "June 2026" →
  `--from 2026-06-01 --to 2026-06-30`.
- **Top N**: default 10, cap 50.
- **Output language**: the language the user's message is written in, unless they name one
  explicitly ("in English", «на русском»).

## Step 2 — Build the arXiv query

Mapping rules (produce a single `search_query` string, **without any date clause** — the script
appends `submittedDate:[…]` itself):

- A token that looks like an arXiv category (`cs.AI`, `stat.ML`, `math.OC`, `quant-ph`,
  `hep-th`, …) → a `cat:` term; normalize casing (`cs.ai` → `cs.AI`).
- A free-text topic → `all:"<phrase>"` (keep multi-word phrases quoted).
- Multiple categories are OR'd; multiple free-text topics are OR'd; when both kinds are present,
  AND the two groups: `(cat:…) AND (all:"…")`.
- **No topics at all** → use the defaults: `cat:cs.AI OR cat:cs.LG`. The digest header must then
  say the defaults were used and that passing topics or categories overrides them.

Examples:
- `quant-ph` → `cat:quant-ph`
- `llm agents` → `all:"llm agents"`
- `cs.CL llm agents` → `(cat:cs.CL) AND (all:"llm agents")`
- `diffusion robotics` (two subjects) → `all:"diffusion" OR all:"robotics"`

## Step 3 — Run the bundled script and inspect its JSON

```bash
node "${SKILL_DIR:-$(dirname "$0")}/scripts/fetch-papers.mjs" \
  --query 'cat:cs.AI OR cat:cs.LG' --days 1 --top 10
```

Flags: `--days N` **or** `--from YYYY-MM-DD [--to YYYY-MM-DD]`; `--top N`; `--max N` (scan cap,
default 6000). The 1-day default finishes in seconds; long windows on broad categories scan
thousands of papers politely (3s per page) — **raise the Bash timeout to ~5 minutes** for
`--days 30`-style runs. An optional `SEMANTIC_SCHOLAR_API_KEY` env var lifts the citation-lookup
rate limit; never pass a key as a CLI argument.

Stdout is one JSON object: `query`, `from`, `to`, `totalAvailable`, `scanned`,
`ranking` (`"citations"` | `"submitted-date"`), `citationCoverage {resolved, scanned,
failedBatches}`, `papers [{id, title, url, published, category, citations, abstract}]`
(abstracts only for the top N), `warnings []`.

Handle **before** writing anything:
- Exit code 1 / an `error` field → report the error to the user and stop.
- `ranking` is `"submitted-date"` → the citation service was unavailable: the header must say the
  list is ordered newest-first and citation counts are unknown.
- `scanned < totalAvailable` → the header must say only the **oldest** `scanned` of
  `totalAvailable` papers were ranked (`--max` cap; the scan is oldest-first on purpose, so the
  dropped newest tail is the least-cited) — suggest narrowing topics/window or raising `--max`.
- `papers` is empty → no digest; a 1-day window can simply predate today's announcement cycle
  (arXiv announces Mon–Fri) — say so and suggest widening the window.
- Every entry in `warnings` → surfaced as one line each under the header.

## Step 4 — Write the digest

Exact shape (translate the labels into the target language; keep titles, URLs, ids, categories,
dates, and numbers verbatim):

```
arXiv digest — <from> … <to> · <topics, or "cs.AI + cs.LG (defaults — pass topics to override)">
Ranked by citation count (Semantic Scholar) · scanned <scanned> of <totalAvailable> papers
Note: papers this fresh have had little time to be cited — counts are low and lag reality.

[1] <Original English Title>
    https://arxiv.org/abs/<id> · <category> · <published> · citations: <n>
    <2–4 sentences in the target language, plain style: the problem, what the authors
    did, why it matters. No jargon; explain any unavoidable term inline.>

[2] …
```

- The freshness note is mandatory for any window up to ~a month — with the 1-day default nearly
  all counts are 0 and the order is mostly newest-first with occasional standouts.
- `citations` of `null` → print `n/a`.
- Descriptions are explanations "as to a friend" — problem → approach → why it matters. Never a
  literal translation of the abstract, never hype. 2–4 sentences per paper.

## Step 5 — Close

One short line offering follow-ups only: a deeper dive into any paper by its number, or a rerun
with a different window / topics / N. Then stop — no file writes, no auto-continuation.

---

## Cross-runtime notes

- Behavior is identical in Claude Code and Codex: every parameter has a default, so no
  interactive tools are needed; the script needs only Node 20+ (guaranteed for `npx skills`
  consumers).
- If Node is somehow unavailable, degrade to a **recency-only** digest and disclose that citation
  ranking was skipped: fetch the newest N entries directly and read the Atom XML —

  ```bash
  curl -s "https://export.arxiv.org/api/query?search_query=%28cat:cs.AI+OR+cat:cs.LG%29+AND+submittedDate:%5B202607130000+TO+202607142359%5D&sortBy=submittedDate&sortOrder=descending&max_results=10"
  ```

## Bundled resources

- `scripts/fetch-papers.mjs` — pages the arXiv API oldest-first across the window (polite 3s
  delays), ranks via Semantic Scholar `/paper/batch`, prints digest-ready JSON. Full CLI and
  output contract in the script header and in this skill's README.
