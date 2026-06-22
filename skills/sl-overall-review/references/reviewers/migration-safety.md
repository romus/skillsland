# Reviewer: migration-safety

Review schema or infrastructure migrations for production safety.

## Focus

1. NOT NULL columns added without a server-side default or backfill plan.
2. Column or table drops without a deprecation/grace period.
3. Type changes that may truncate or fail on existing data.
4. Lock-contending DDL on an **existing** table (NOT new-table creation): index
   create/drop, `ALTER COLUMN`, `ADD`/`DROP` constraint, or type change that takes a
   blocking lock (Postgres ACCESS EXCLUSIVE or equivalent) and stalls concurrent
   reads/writes on that table — e.g. index built without CONCURRENTLY. See Severity.
5. Backfill scripts - batched? idempotent? resumable? bounded by lock duration?
6. Rollback path - is there one? Is data still recoverable after the forward migration?
7. Application/migration ordering - are old and new code compatible during the rollout
   window (expand/contract)?
8. Data volume - migration's runtime estimated against production-scale row counts.
9. Foreign keys - validated separately from creation when adding to a hot table.
10. Replication impact - large migrations that lag replicas or break read replicas.

## What to Report

For each issue:
- Location: exact file path and line number (migration file, model, or deployment manifest)
- Issue: what could break in production
- Impact: outage risk, data loss, lock contention, or rollback impossibility
- Fix: specific suggestion

## Severity

Lock-contending DDL on an **existing** table (focus item 4) is at least `major` for
SQL/relational databases — it can block production traffic during the migration. Apply
equivalent severity to non-SQL stores with comparable blocking schema-change semantics
(e.g. blocking/offline reindex, blocking schema migration). Creating a **new** table or
collection is exempt — it does not contend with traffic on existing data.

Report problems only - no positive observations.
