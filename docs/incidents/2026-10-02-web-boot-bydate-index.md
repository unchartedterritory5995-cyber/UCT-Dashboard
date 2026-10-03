# 2026-10-02 — web down 502, boot never completed (missing by-date index)

**Impact:** the web service returned 502 from ~13:37 to 15:24 CT (~1 h 47 min).
Three deploys in a row FAILED their healthcheck.

## Timeline (as observed on the pod)

| When | What |
|---|---|
| ~17:25Z (12:25 CT) | The web pod installed a fresh R2 snapshot as `/data/bars.db` (31 GB). The snapshot did **not** contain `idx_ohlcv_daily_bydate`, the partial covering index `ON ohlcv(ts, ticker, c) WHERE tf='D'`. |
| ~13:37 CT onward | Every boot after that: uvicorn printed `Waiting for application startup` and never `Application startup complete`. PID 1 (uvicorn, `exec`'d, so its main thread is the event loop) sat in **D state** (uninterruptible disk I/O). |
| same boots, +90 s | `_build_bydate_index_bg` (api/main.py lifespan) woke and ran `bars_sqlite.ensure_daily_bydate_index()`: a `CREATE INDEX` scanning all 31 GB at ~40 MB/s on the network volume, holding a write transaction, `busy_timeout` 10 min. |
| each deploy, 600 s | Railway's healthcheck (`healthcheckTimeout: 600`) killed the deploy before the build could commit; the build rolled back; the next deploy started over. 3 FAILED deploys. Logs also showed `bars_reconciliation` "database is locked" throughout (the build held the write lock). |
| restart | An owner restart (no deploy healthcheck) let the build COMMIT after ~13 min, and the app reported startup complete seconds later. |
| 15:24 CT | Service restored. |

## The step that blocked startup

**`api/main.py:6610` (pre-fix line; lifespan, synchronous, on the event-loop thread):**

```python
if register_pattern_vision_jobs(_scheduler):
    print(_pattern_vision_contract_line())
```

`_pattern_vision_contract_line()` (main.py:2705) calls
`_resolve_active_set_for_patterns()` (main.py:2648), which calls
`bars_sqlite.nth_recent_trading_date(PV_STALE_MAX_SESSIONS, 99999999)`
(bars_sqlite.py:815 pre-fix):

```sql
SELECT ts FROM (SELECT DISTINCT ts FROM ohlcv WHERE tf='D' AND ts<? ORDER BY ts DESC LIMIT ?)
ORDER BY ts ASC LIMIT 1
```

That query's plan depends on the missing index (measured, `EXPLAIN QUERY PLAN`,
2 M-row fixture):

| bars.db | plan | VM steps |
|---|---|---|
| with `idx_ohlcv_daily_bydate` | `SEARCH ohlcv USING COVERING INDEX idx_ohlcv_daily_bydate (ts<?)` | ~6,000 |
| **without** it (the snapshot) | `SCAN ohlcv USING COVERING INDEX idx_ohlcv_lookup` + temp b-trees for DISTINCT and ORDER BY | ~10,017,000 |

Without the index the only usable index leads with `ticker`, so SQLite reads the
**whole** `idx_ohlcv_lookup` — every row of every timeframe in the 31 GB store —
on the event-loop thread, before `yield`. That is the D state on PID 1, and it is
why startup could not complete inside 600 s. Production ran this exact step on a
healthy boot: the 2026-09-18 web log shows
`[startup] pattern-vision: on ... active_set_only=on:83[resolved]` printed at
11:34:37, between "Waiting for application startup" (11:34:33.9) and "complete"
(11:34:43.8) — fast then only because the index existed.

The by-date `CREATE INDEX` started 90 s later on its own thread made it worse
(two full scans competing for the same ~40 MB/s volume, and the write lock that
produced the reconciliation "database is locked" lines), and it explains the
restart: both scans read the same pages, so the lifespan's scan finished seconds
after the build committed.

### What was ruled out, by measurement

The first hypothesis was a startup step **waiting on the build's write lock**.
Measured: with another connection holding `BEGIN IMMEDIATE` on bars.db for the
entire boot, the real `lifespan` reaches `yield` in 7.4–8.7 s on a prod-shaped
volume (`USE_REMOTE_BARS=1`, heal flags present). WAL readers do not wait on a
writer, and every bars.db WRITE in the boot had a bounded busy timeout:
`init_db` (main.py:4124, 2 s), the four one-shot heals (main.py:4194/4266/4334/4401,
30/30/60/30 s, flag-gated, already applied in prod), the boot-pull probe
(main.py:4732, 5 s read). With the heal flags absent those waits sum to 174 s
— a real hazard, fixed below, but not this incident. A lock wait also sleeps
(S state), not D state.

The step was found by the new rail, not by reading: the structural assertion
"the lifespan thread never opens bars.db" failed and printed the stack above.

## Fix (branch `lane/bars-boot-index-fix`)

1. **No bars.db I/O on the lifespan thread.**
   - The pattern-vision contract line is printed from a background thread (it is
     a log line, not a gate).
   - `init_db` and the four one-shot heals run, in their original order, on a
     `bars-boot` thread.
   - The "local bars.db already has bars?" boot-pull probe runs first thing inside
     the `initial_snapshot_pull` thread.
2. **The calendar query cannot scan.** `nth_recent_trading_date` runs the
   full-market query only when `idx_ohlcv_daily_bydate` exists; otherwise it
   derives the calendar from SPY/QQQ/IWM/DIA through the lookup index (a SEARCH,
   same answer). This also protects its request-path caller
   (`scan_gainers.py:89`).
3. **No CREATE INDEX on boot.** The 90 s-delayed boot build is gone (the reuse-map
   pre-warm it also did is kept, without the build). The web-side build is a
   fallback with two doors only (`api/services/bars_bydate_index.py`):
   - owner: `POST /api/admin/bars/bydate-index/build` (admin; returns at once,
     builds in the background; status at `GET /api/admin/bars/bydate-index`);
   - scheduled: `BARS_BYDATE_INDEX_BUILD_ENABLED=1` (ledger: **dark**), only
     inside `BARS_BYDATE_INDEX_BUILD_WINDOW_ET` (default 02–05 ET) and never
     within 30 min of process start.
   The build now waits at most 2 s for the write lock (was 10 min) — another
   writer means "busy, retry later" — and a second concurrent call never queues.
   ⚠️ A CREATE INDEX still holds the write transaction while it runs; that is why
   it is confined to those doors.
4. **The snapshot carries the index.** `bars_sqlite.BARS_INDEX_DDL` is now the one
   authority over the indexes a bars.db must have; `data_sync._make_tarball`
   calls `bars_sqlite.ensure_indexes_at(copy)` on the private backup copy before
   the integrity gate and the tar, so no install can arrive short of an index.
   The worker's live DB is not written to. Cost: while the worker's own DB lacks
   the index, each daily base pays one build on the copy (no member traffic, no
   lock contention).

## Rails

- `tests/test_boot_does_not_wait_on_bars_db.py` — runs the real lifespan on its
  own thread with a write transaction held on bars.db for the whole boot, on the
  worst-case volume (no heal flags, no by-date index): must reach `yield` within
  60 s, and the lifespan thread must never open bars.db (a spy on
  `sqlite3.connect` names the opener's stack). Before the fix: 174 s (time box
  red) and, once the heals moved, the contract-line open (structural red).
- `tests/test_bars_snapshot_carries_indexes.py` — `_make_tarball` ships every
  `BARS_INDEX_DDL` index from a source that lacks the by-date one (source left
  untouched); an AST census fails BY NAME on any `CREATE INDEX ... ON ohlcv`
  under `api/` that the registry does not name; the session-calendar query
  never plans `SCAN ohlcv`, with or without the by-date index.
- `tests/test_bars_bydate_index_build.py` — the build steps aside within ~2 s of a
  held lock, completes without one, never queues a second build, the scheduled
  attempt needs flag + grace + window, and `ensure_daily_bydate_index` is called
  only from `bars_bydate_index.py`.

Mutation-proved (edit, red, restore by editor): contract line back inline →
structural red; `_bars_boot_bg()` called inline → time-box red; the
`ensure_indexes_at` call removed → snapshot red; the calendar guard forced to the
full query → calendar red; an unregistered `CREATE INDEX ... ON ohlcv` added →
census red.

## Still open

- `data_sync.download_snapshot` moves a new `bars.db` into place but leaves the
  old `-wal`/`-shm` beside it (deliberate, per its comment). Not this incident;
  worth its own look.
- The worker's own bars.db still lacks the by-date index, so each daily base
  builds it on the copy. Building it once on the worker (off-hours) would make
  that a catalog no-op.
