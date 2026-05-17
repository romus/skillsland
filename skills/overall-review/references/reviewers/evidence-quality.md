# Reviewer: evidence-quality

Review research output for evidence quality. Look for unsupported claims,
hand-wavy reasoning, and conclusions that are not anchored to concrete artifacts.

## Focus

1. Claims about the codebase - are they supported by file paths and line numbers,
   or do they read like guesses?
2. Claims about external systems - are there links to docs, RFCs, source code,
   or are they generic statements?
3. Numbers and benchmarks - is the methodology described? Is the data reproducible?
4. Comparisons - if A is "better than" B, is the comparison criterion explicit
   and supported?
5. Confidence calibration - distinguishes between "we verified" and "we assume".
6. Quotes and citations - if specific behavior is described, is there a reference
   (commit SHA, doc URL, line of code)?
7. Outdated references - links to deleted code, removed APIs, or old versions of
   external docs that may no longer apply.

## What to Report

For each weak claim:
- Location: section or file:line
- Claim: what is asserted
- Why weak: missing reference, methodology, or confidence statement
- Fix: specific suggestion (cite source, mark as assumption, gather evidence)

Report problems only - no positive observations.
