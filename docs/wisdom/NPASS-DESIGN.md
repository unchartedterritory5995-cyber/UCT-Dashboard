---
id: WISDOM-NPASS-DESIGN
title: N-pass extraction in the production chain — design (R53, 2026-09-15)
status: DESIGN ONLY. Not built. Every claim below is cited to code that exists today.
---

# N-pass in the production chain

> **The gap in one sentence.** The chain produces DB rows and **no per-run record set**; the
> PC-side gate tool produces a per-run record set and **no DB rows**; and `reconcile.score_silently`
> sits on the chain consuming the *tool's* output. So stability has never been computed from
> anything the chain itself produced.

⛔ **This document is a design, not a build.** It is written so the next session can execute it
without re-deriving the mechanism, and so the parts that are already solved are not rebuilt.

---

## What R56 already fixed, and why nothing could work before it

`reconcile.gate_runs_root()` now resolves to `<DATA_DIR>/wisdom/gate-runs` — the Railway **volume**.
Before R56 it was a bare CWD-relative literal resolving to `/app/data/wisdom/gate-runs` on the pod:
an **ephemeral image layer**, destroyed on every redeploy.

⭐ That was not a cosmetic bug. `floor.MIN_RUNS = 3` requires three passes to **coexist**, so an
N-pass writing to the old root would have accumulated nothing, forever, while every chain step
reported `ok`. **R56 is the precondition; this design is only buildable after it.**

## The doors that already exist (do not build these)

| need | what exists today | cite |
|---|---|---|
| re-send a segment that already has a request row | `submit_pending(segment_rows=...)` | `batch.py:384-386` |
| make pass 2 a distinct request | `custom_id_for(..., salt=...)` | `batch.py:120-129` |
| a worked example of both | `audit.run_audit` salts by ISO week | `audit.py:69-70` |
| write a run in the R12 layout | `gate_records.persist_phase` | `gate_records.py:152` |
| discover runs and score them | `reconcile.discover` / `score_silently` | `reconcile.py:492`, `:477` |
| per-night ceiling | `budget.daily_budget_usd()`, default 25.0 | `budget.py` (R53) |
| spend gate honoured under force | `batch.spend_allowed()` | `batch.py` (R52) |

⛔⛔ **THE SALT IS NOT OPTIONAL.** `pending_segments` excludes any segment with **any**
`wisdom_extract_requests` row for `(extractor_version, purpose='extract')` (`batch.py:227-229`),
and `submit_items` counts a duplicate `custom_id` as `skipped_not_retryable` (`batch.py:335-337`).
**Without a per-pass salt, pass 2 is silently a no-op** — the chain reports success and one pass
exists. This is the single most likely way to build this wrong and not notice.

## The design

**Nightly selection.** Up to `DAILY_SEGMENT_LIMIT // N` segments (`batch.py:48`, 400). At N=3 that
is **133 segments → 399 requests**. ⭐ The throttle bounds **requests**, not segments — which is
also why the nightly bill is flat in N (~$23.41 at the measured mean) while coverage per night is
not.

**Per pass.** `pass_index` 1..N, identical `extractor_version`, model and effort. Each pass salts
its `custom_id` with `f"pass{pass_index}"` and passes the same `segment_rows`, so every pass is a
distinct request over the same segments.

**Persistence.** Each completed pass is written in the R12 layout under
`reconcile.gate_runs_root()` — `<root>/<run_id>/records.jsonl` plus a manifest. ⭐ Discovery needs
**nothing new**: `reconcile.discover` requires only a directory whose name sorts as a UTC stamp and
which contains `records.jsonl` (`reconcile.py:433`), and `manifest.json` is optional
(`reconcile.py:111-113`). So a chain pass and a gate pass are indistinguishable to the reconciler
**by construction**, which is the property to preserve.

**Required row keys**, all already produced by `writer.validate_output`: `phase: "gate"`,
`extractor_version` (identical across every row of every run), `segment_id` (the SET must match
across runs), `record_type`, `record_key`, `principle_key` on PRINCIPLE,
`market_signal_key` + `fields.market_signal.name` on MARKET_SIGNAL, and `record_id`.
⛔ The MARKET_SIGNAL name is load-bearing: without it `_name_tokens` returns empty, no pair merges,
and `MS_IDENTITY="MERGED_J05"` silently degrades to `KEY` — measured, and it made four tests
vacuous once already (`tests/test_wisdom_extract_reconcile.py:40-43`).

**Ingest exactly once.** `write_output` runs for the **first completed pass only**; passes 2..N are
persisted but not ingested. ⛔ Ingesting all N would mint N identical `record_id`s
(`writer.record_id_for(segment_id, extractor_version, record_hash)` is deterministic) and the
reconciler would then score a record against copies of itself.

**Ordering.** Passes → `reconcile_stability` → `publication_floor`. The order is already correct in
`chain.DAILY` and is load-bearing: the floor READS the stability the reconciler WRITES.

**A partial night.** Fewer than N completed passes → **UNRECONCILED**: nothing scored, the segments
re-queued for the next night. `score_silently` already refuses below `MIN_RUNS`
(`reconcile.py:446-448`) and returns a `skipped` reason, so the failure mode is a clean no-op —
but the re-queue is new work.

**Budget.** `daily_budget_usd()` checked against the R36 reservation before each batch and against
actuals after; the programme total (`WISDOM_EXTRACT_BUDGET_USD`, default 120.0) and the PC-side
ledger cap remain outer ceilings. Absent/unusable → extract refuses with a reason (R53).

## What has to be threaded, in call order

`chain.py:233` calls every step as `fn(ctx)` and nothing else, so `N` and the run id ride on
`ctx` or come from the registry. Then:
`extract/__init__.py:15` → `batch.run_daily:432` → `submit_pending:384` → `_build_items:257` →
`custom_id_for:120` → `submit_items:309` → `_record_batch:370`.

⛔ **The reap is a different job with a different `ctx`** (`extract/jobs.py:22`), minutes to hours
later. Anything a RESULT must know has to be a **column**, not an argument — so `pass_index` and
the run id belong on `wisdom_extract_requests` (additive migration, `extract/schema.py:21-63`).

## The tests that must exist (and the two that are easy to get wrong)

N passes persisted with identical version under the R56 root · throttle arithmetic · partial night
re-queues and never scores · budget absent / present / exceeded · reservation-then-actuals ·
discovery unchanged · **ingest-first-pass-only** · R50 rail still passes · R52 force rules hold.

⭐ **Two with a specific mutation each, because they fail silently otherwise:**
1. **drop the salt** → pass 2 must become a no-op and a test must go RED. Without this test the
   build looks finished and produces one pass a night.
2. **CWD-relative root** → a redeploy simulation (new CWD, same `DATA_DIR`) must still find
   yesterday's passes. This is the R56 regression, and `tests/test_wisdom_gate_runs_root.py`
   already covers the resolution half.

## Status

**NOT BUILT.** R56 (the root), R53 (the budget knob) and R52 (the force guard) are the three
preconditions and all three are committed. What remains is the pass loop, the two new columns, and
the tests above. ⚠️ It is not on the critical path for lighting INGEST: EXTRACT stays dark, and
with EXTRACT dark this code never runs.
