# sl-arxiv-digest

A multi-paper digest of recent arXiv submissions, **ranked by citation count** (Semantic
Scholar), with each top paper explained in 2–4 plain-language sentences **in your language**
(original English titles kept). Chat-only output — nothing is written to disk.

Not to be confused with a single-paper explainer: this skill scans *everything* submitted in a
time window, ranks it, and summarizes the top N.

## Usage

```text
/sl-arxiv-digest                          # last day, default categories cs.AI + cs.LG, top 10
/sl-arxiv-digest llm agents --days 14     # free-text topic, two-week window
/sl-arxiv-digest cs.CL quant-ph --days 30 # explicit categories, monthly digest
сделай дайджест arxiv за месяц            # natural language works too — output will be in Russian
```

- **Topics are optional.** Free-text subjects map to `all:"…"` full-text terms, category-looking
  tokens (`cs.CL`, `stat.ML`, `quant-ph`) map to `cat:` filters; both together are AND-ed. With
  no topics the digest covers `cs.AI + cs.LG` (and says so).
- **Window** defaults to the last day; ask for a week, a month, or an explicit date range.
- **Output language** defaults to the language you asked in.

## How it works

Two stages inside one bundled zero-dependency Node script (`scripts/fetch-papers.mjs`, Node 20+):

1. **arXiv API scan** — pages `https://export.arxiv.org/api/query` across the whole window,
   **oldest-first**, 3 s between requests (arXiv etiquette). Oldest-first matters: if the scan
   cap (`--max`, default 6000) truncates the window, only the *newest* — least-cited — tail is
   dropped, so "top by citations" stays honest. Truncation is always disclosed.
2. **Citation ranking** — Semantic Scholar `POST /graph/v1/paper/batch` (500 ids per call,
   backoff on 429/5xx). Papers S2 doesn't know yet rank as 0. If the service is entirely down,
   the digest falls back to newest-first ordering — and says so.

## Script CLI

```bash
node scripts/fetch-papers.mjs --query 'cat:cs.AI OR cat:cs.LG' --days 1 --top 10
```

| Flag | Meaning |
|---|---|
| `--query` | arXiv `search_query` (no date clause — the script appends it). Required. |
| `--days N` | Window ending now (default 1). Mutually exclusive with `--from/--to`. |
| `--from` / `--to` | Explicit UTC date window, `YYYY-MM-DD`; `--to` defaults to now. |
| `--top N` | Papers to emit with abstracts (default 10, max 50). |
| `--max N` | Scan cap across the window (default 6000, hard API cap 30000). |

Output: one JSON object — `query`, `from`, `to`, `totalAvailable`, `scanned`, `ranking`
(`citations` \| `submitted-date`), `citationCoverage`, `papers` (top N with abstracts),
`warnings`. Exit codes: `0` success (warnings included), `1` fatal with `{"error"}` still on
stdout, `2` CLI usage error.

## Rate limits & API key

Unauthenticated Semantic Scholar requests share a global pool (5000 req / 5 min for everyone),
so occasional 429 storms are normal — the script retries with backoff and degrades gracefully.
For reliable citation data, get a free key at
[semanticscholar.org/product/api](https://www.semanticscholar.org/product/api) and export it:

```bash
export SEMANTIC_SCHOLAR_API_KEY=...   # sent as x-api-key; never passed as an argument
```

## Limitations

- **Fresh papers have few citations.** Citation counts need weeks–months to accumulate; on a
  1-day window nearly everything is 0 and the order is effectively newest-first with occasional
  standouts. The digest header always sets this expectation.
- **arXiv announces Mon–Fri** — a 1-day window on a weekend can legitimately be empty.
- Broad categories over a month can exceed the default scan cap (`--max 6000`); the digest then
  says which share of the window was ranked.
- `totalResults` from arXiv is advisory and occasionally flaky; the script guards with a retry.
