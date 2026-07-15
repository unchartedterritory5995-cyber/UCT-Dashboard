# Flow `/recent` — Hybrid SQL Pre-Filter + `classify()` Factor-Out

**Date:** 2026-07-15
**Author:** (agent) — design for Manrav's review before build
**Owner-coordination:** touches `api/live_massive_router.py` (`_row_to_alert`, `_compute_recent`) — Manrav-owned. Ships AFTER his auto-push-gate change lands on master.
**Flag:** `FLOW_RECENT_SQL_CLASSIFY` (default 0 → dark). Dual-run + parity before flip.

## Problem

Post-P5-cutover, the OPRA consumer and the heavy `/recent` reader share one process on the
flow-worker pod. `/recent` (curated) `fetchall()`s up to **80–100K rows** and runs `_row_to_alert`
(tier/grade/direction/conviction, ~39-key dict) over **every** row, then drops most (unclassified /
low-grade / off-tier) and trims to `limit`. That per-row Python pass is a ~1.5–2 s GIL-holding grind
that **starves the consumer thread** → the tape stops advancing → the `flow_watchdog` force-exits on
a 300 s freeze (`os._exit(43)`) → `restartPolicy=ALWAYS` restarts → 7–16 min tape gap. (Peaked ~3–4.6 GB
on a 32 GB ceiling, so this is the watchdog/GIL path, **not** a memory-limit OOM. Memory can't be
bumped — already at plan max.)

## Why NOT write-time classification (the tempting "permanent fix")

Freezing tier/grade into columns at insert is **wrong** here — classification legitimately changes
*after* write, from three independent sources (per Manrav):

1. **Thresholds change intra-day.** The admin tuning panel is used to retune mid-session (current
   values already off-default: `min_signals` 2, `stack.vOI` 1, `grade` D, `etf_enabled` true; a
   `stack.vOI` tighten was pending). A frozen grade/tier would be stale the moment he retunes.
2. **OI is enriched after insert.** The on-demand fetch + the 5:30 ET Schwab snapshot `UPDATE` OI on
   existing rows; `V/OI` and `is_fresh_strike` drive the Alpha/LEAPS/Size gates → **tier can change
   hours after write**.
3. **Color and Side are rewritten.** `rebuild-color` rewrites `Color` post-gap-fill; `backfill-from-
   patches` writes `Side` onto blank-side rows — both feed `direction` and `tier`.

So the read path must keep reading **live** columns. The fix is a **hybrid**: push only the
**write-time-stable, high-selectivity** predicates into SQL to shrink the row set, and keep the
**tunable / drift-prone** refinement in Python over the smaller set.

## The split

| Predicate | Stable? | Where |
|---|---|---|
| `source`, `CreatedDate` | stable | SQL (already) |
| `Color IN ('MAGENTA','YELLOW')` | live-read (rewrites OK — SQL reads current value) | SQL (already) |
| WHITE promotion pre-conditions: `Premium >= min_premium` **and** sweep/block Type | **stable** (Type is write-time-fixed; Premium immutable) | **SQL (new)** |
| `override.enabled`, `require_sweep_or_block`, `min_premium` | tunable **config** (read at query time, bound as params — NOT frozen) | SQL params, sourced from `_load_thresholds()` per request |
| Grade vs `min_grade` | tunable | **Python** (unchanged) |
| Tier (depends on V/OI, `is_fresh_strike`, side) | drifts (OI enrichment, Side backfill) | **Python** (unchanged) |
| Direction (Side) | rewritten | **Python** (unchanged) |

Key point: MAGENTA/YELLOW rows are the actual signal and **always** flow to Python refinement — the
SQL pre-filter does **not** touch them. The reduction comes entirely from **narrowing the WHITE
fetch** to only rows that could ever be promoted, instead of pulling every WHITE ≥ $500K and
discarding the ones Python never promotes.

## SQL change (`_compute_recent`, ~:1616)

WHITE branch today: `(Color='WHITE' AND CAST(Premium AS INTEGER) >= 500000)` — over-fetches.

New WHITE branch — replicate `_row_to_alert`'s promotion gate exactly (:878–888):

```sql
OR (Color = 'WHITE'
    AND :override_enabled = 1
    AND CAST(Premium AS INTEGER) >= :min_premium
    AND (:require_sb = 0 OR (
         UPPER(Type) LIKE '%SWEEP%'
      OR UPPER(Type) LIKE '%ISO%'
      OR UPPER(Type) LIKE '%BLOCK%'
      OR UPPER(TRIM(TRIM(Type), '/')) IN ('BLK','B','BL','BT','S','SW','IS')
    )))
```

- Params bound per-request from `_load_thresholds().premium_override`: `enabled` (default 1),
  `min_premium` (1_000_000), `require_sweep_or_block` (1). **Read at query time so live retunes apply.**
- The `TRIM(TRIM(Type),'/')` mirrors Python `type_.upper().strip().strip('/')`. The substring `LIKE`s
  mirror the `"SWEEP"/"ISO"/"BLOCK" in type_up` checks; the `IN` set mirrors the abbreviation branch.
- **Gotcha (Manrav):** `Premium` is stored TEXT, so `CAST(Premium AS INTEGER)` can't seek an index.
  Still a net win — SQLite evaluating the CAST over the `idx_flow_classified(source,CreatedDate,Color,id)`-
  narrowed set is far cheaper than building tens of thousands of Python dicts. No index/migration work
  (index already covers WHERE + `ORDER BY id DESC`).
- The tonight-shipped floor derivation (`override_sql_floor = min_premium`) is the FIRST half of this;
  the sweep/block clause is the second half, added here under the flag with parity.

## `classify()` factor-out (`_row_to_alert`)

Extract the pure classification core out of `_row_to_alert(:1120–1334)`:

```python
def classify(row: dict, thresholds: dict) -> dict | None:
    """Pure: row + resolved thresholds -> {tier, tierPriority, grade, conviction,
    direction, promoted, alertName, ...derived} or None (drop). No I/O, no globals —
    thresholds passed in so it's testable and identical across read paths."""
```

- `_row_to_alert` becomes: `c = classify(row, thr); if c is None: return None; return {**c, ...formatting}`.
  Same output, byte-for-byte — this is a **refactor, not a behavior change** (the parity harness proves it).
- `classify()` takes `thresholds` as an arg (resolved once per request via `_load_thresholds()`),
  removing the repeated `_load_thresholds()` calls inside the per-row cascade (a side perf win).
- Enables: the dual-run parity harness, reuse across day-stats/by-contract later, and unit tests on the
  gate logic in isolation.
- **The memory/GIL win is the SQL pre-filter, not this** — `classify()` still runs in Python, just over
  the smaller narrowed set. The factor-out is the safety + reuse enabler.

## Dual-run + parity (`FLOW_RECENT_SQL_CLASSIFY`)

Phase 1 (dark, flag=0): ship the SQL sweep/block clause + `classify()` refactor, but `/recent` still
runs the OLD wide fetch. In the same request, ALSO run the new narrowed fetch and compare the resulting
alert-ID sets; log any divergence (`missing`/`extra` IDs, counts) to a `parity` logger + a counter. No
user-visible change. Run for a few live sessions (esp. across a mid-session retune + an OI enrichment)
until divergence is provably zero.

Phase 2 (flag=1): `/recent` serves from the narrowed fetch; the old path stays as the dark comparator
for one more window, then is removed. Roll back = flag to 0 (instant, no deploy needed if we keep the
comparator; else a redeploy).

Parity assertion: `set(old_alert_ids) == set(new_alert_ids)` per (day, tier, curated, min_grade, sort)
key. The ONLY legitimate difference is WHITE 500K–1M / non-sweep-block rows never appearing in the
output either way (they're dropped in Python today) — so the *output* must be identical; only the
*fetched row count* shrinks.

## Scope / non-goals

- **`/recent` only.** `day-stats` (:1916) and `by-contract` (:2290) keep the $500K floor — they
  **aggregate** premium/volume/OI totals, so dropping the $500K–$1M WHITE band would understate day
  totals + accumulation grades. Different correctness requirement from `/recent`'s top-N. (Manrav concurs.)
- Not touching the write path, the consumer, or the schema. No new columns, no index, no backfill.
- Not the ultimate capacity fix (readers still share the consumer process). If the hybrid + floor don't
  fully clear the freeze, the follow-ups are: reduce scan concurrency (fewer cache-key combos /
  serialize heavy scans), or move the readers off the consumer process (Postgres / reader replica —
  the 07-07 Option E end-state). Tracked separately.

## Test plan

- Unit: `classify()` on fixtured rows across every tier/grade/promotion branch — output identical to
  pre-refactor `_row_to_alert` (golden set captured from current code before the refactor).
- Unit: the SQL sweep/block matcher vs `is_sweep_or_block` — property test over generated Type strings
  (SWEEP, ISO, BLOCK, BLK, B, BL, BT, S, SW, IS, `SWEEP/ISO`, whitespace/slash variants, junk) asserting
  SQL-clause result == Python `is_sweep_or_block`. This is the highest-risk surface.
- Integration: dual-run parity over a seeded flow.db slice (a real curated day) — zero divergence.
- Live: parity logger clean across ≥3 sessions incl. a mid-session threshold retune before flag flip.

## Rollout / deploy

- Manual `railway up -s flow-worker`, after close (restarts the consumer → brief tape gap; zero data
  loss with the tape static). GitHub trigger is SKIPPED for flow-worker (watch-path config) — CLI only.
- Ships dark (flag 0). Flag flip is a config change (`railway variables --set` + redeploy, after close).
