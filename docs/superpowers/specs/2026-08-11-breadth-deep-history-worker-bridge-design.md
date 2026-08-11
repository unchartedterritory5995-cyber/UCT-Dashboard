# Deep Breadth History — Worker-Pod Compute + R2 Bridge (design)

**Date:** 2026-08-11
**Status:** proposed
**Owner context:** finishes the breadth-history project. 2024→today is already
live & accurate on all 44 charts; this extends it back to ~2008 (and later ~2003)
**without** the web-pod crash that blocked it overnight.

---

## 1. Problem

The close-basis recompute engine is validated accurate (2020 COVID low = 2.0%
above 50MA; rally = 77.3%). Running it for **2024→today** shipped fine. Running
it for **pre-2024** crash-restarts the single web pod every time — proven three
ways, including after rewriting the frame loader to stream into preallocated
numpy (~285MB → ~20MB peak). The last bounded test caught a **502 mid-sweep**;
coverage never moved.

Root cause is not memory alone — it's that the web pod is **one uvicorn process =
one event loop** shared by ~200 users. A multi-minute CPU-bound recompute starves
the health-check long enough for Railway to recycle the pod, which also wipes the
in-memory sweep state. No amount of memory tuning fixes a compute that must not
run on the request-serving process at all.

## 2. Goal

Run the heavy recompute on the **worker pod** (where `bars_prewarm`,
`deep_history_warm`, and the Massive WS already live — no user event loop to
starve), then **propagate the resulting rows to the web pod** so the charts serve
them. The worker has a **separate `/data` volume**, so a propagation channel is
required. We mirror the proven bars-cache **R2 bridge**, but in a much leaner form
because this store is tiny and write-once.

---

## 3. Why this bridge is far simpler than the bars bridge

The bars R2 bridge (`data_sync.py`) is elaborate because bars are a **continuous,
high-volume, newest-wins stream**. Breadth history is the opposite on every axis:

| Dimension | Bars store | `breadth_daily_ohlc` store |
|---|---|---|
| Size | ~GB, millions of rows | **~40 metrics × ~250 days/yr × ~20 yr ≈ 200k rows, single-digit MB** |
| Write pattern | Continuous, every minute | **One-time backfill** (occasional re-runs) |
| What "wins" | **Newer `ts`** wins | **Any date the web lacks** wins (backfill adds OLDER dates) |
| Install method | `shutil.move` replace → needs inode-epoch refresh | **In-place `INSERT` merge → no epoch mechanism** |
| Delta machinery | Yes (windowed) | **No — ship the whole tiny DB** |

Three consequences, each a simplification:

1. **No delta rail, no online-backup-vs-tar subtlety needed for correctness** — the
   DB is small enough to ship whole. (We *do* still use SQLite's backup API for a
   consistent copy; it's cheap and avoids WAL-sidecar torn reads.)
2. **No `bump_db_epoch()` equivalent.** `breadth_daily_ohlc._conn()` opens a fresh
   connection per call (no thread-local caching), and the web merge writes **in
   place** via `INSERT` (no file swap). The single most error-prone part of the
   bars bridge (stale FDs after `shutil.move`) does not exist here.
3. **⚠️ The bars merge rule is WRONG for this store — do NOT copy it.** Bars use
   `WHERE l.mx IS NULL OR s.ts > local MAX(ts)` (only adopt rows *newer* than the
   newest local bar). Breadth backfill adds **older** dates, so that clause would
   **reject every backfilled row**. See §6.

---

## 4. Architecture

```
WORKER POD (heavy compute, own /data)          R2 bucket (existing)         WEB POD (serves charts, own /data)
────────────────────────────────────          ───────────────────         ──────────────────────────────────
breadth backfill thread                        breadth_ohlc/latest.txt     slow puller (BREADTH_OHLC_REMOTE=1)
  reads floor marker                    ──▶    breadth_ohlc/<ts>.tar.gz    reads latest.txt; skip if unchanged
  backfill_tick(chunk) → sweep_history         (holds whole breadth        else download + gap-fill merge
  writes worker breadth_daily_ohlc.db           _daily_ohlc.db)              INSERT OR IGNORE into web DB
  on chunk success → upload()          ──▶                          ──▶    build_breadth_bars serves it
  sleep, next chunk, until floor                                            (no restart, no epoch swap)
```

- **Compute** stays entirely on the worker. The web pod only ever does a cheap
  R2 GET of `latest.txt` and, when it changes, one download + one `INSERT OR
  IGNORE` of a few thousand rows. That is nowhere near the event-loop-starving
  profile that crashed it.
- **Reuse existing R2 creds** (`DATA_SYNC_*`) with a **new key prefix**
  `breadth_ohlc/` — exactly the precedent the Compass Brain Pack set (same bucket,
  `brain/` prefix).

---

## 5. Components

### A. Worker backfill thread — `worker_main._start_breadth_backfill()`

A daemon thread (sibling to `_start_uploader`), gated by
`BREADTH_HISTORY_BACKFILL_ENABLED=1` on the **worker** service only.

```
loop:
  floor = breadth_history_recon.get_backfill_floor()   # worker DATA_DIR/breadth_history_floor.txt
  if not floor: sleep(300); continue                   # disarmed → idle
  cov_first = breadth_daily_ohlc.stats()["first"]
  if cov_first <= floor: set_backfill_floor(None); continue   # done
  res = breadth_history_recon.backfill_tick(chunk_days=CHUNK)  # ONE chunk (heavy)
  gc.collect()
  if res.wrote > 0:
      breadth_ohlc_sync.upload(force=True)             # ship the updated tiny DB
  sleep(BREADTH_BACKFILL_PAUSE_SECS)                   # let memory settle
```

- `backfill_tick` and the floor marker **already exist** and are restart-resilient
  (durable marker; resumes from current coverage on the next tick). We are moving
  their execution from a web APScheduler job to a worker thread — no new compute
  logic.
- **Chunk size is the memory throttle.** Start `CHUNK=365` (one year/frame); the
  streaming-numpy loader keeps a 1-yr frame well within the worker's headroom.
  The pause between chunks (default 90s) lets the allocator return memory.
- **Pre-flight (one-time, manual):** confirm the worker's `bars_cache_deep`
  actually holds since-inception daily bars for the universe (the
  `deep-history-warm` pass reported 0 fails). `_lean_deep_daily` falls back to
  `massive.get_agg_bars` per missing ticker, so gaps self-heal but cost API calls
  — worth confirming depth before the full grind so we're computing from cache.

### B. The bridge module — `api/services/breadth_ohlc_sync.py` (new)

~120 lines, modeled on `data_sync.py` but stripped to the essentials.

**Shared R2 client** (reuse `DATA_SYNC_*`):
```python
_PREFIX = "breadth_ohlc/"
_LATEST = _PREFIX + "latest.txt"
def _client(): ...   # identical boto3 construction as data_sync._client()
def _bucket(): return os.environ.get("DATA_SYNC_BUCKET")
def credentials_ok(): return bool(_client() and _bucket())
```

**Producer — `upload(force=False) -> str|None`** (worker):
1. `_snap = backup(breadth_daily_ohlc._db_path())` via SQLite online backup API.
2. Gate: `PRAGMA integrity_check == "ok"` AND `COUNT(*) >= 1` (row floor stops a
   blank DB from clobbering nothing — here it just prevents shipping an empty file).
3. tar.gz as `breadth_daily_ohlc.db` → `put_object(breadth_ohlc/<ts>.tar.gz)` →
   `put_object(breadth_ohlc/latest.txt, <ts>)`. Prune to newest 5.
4. Cheap skip-if-unchanged fingerprint (stat mtime+size) unless `force`.

**Consumer — `sync_if_new() -> str|None`** (web):
1. GET `latest.txt`; if `== _read_last_synced_marker()`, return None (the common,
   near-free case — one small GET).
2. Else download `<ts>.tar.gz`, extract to tmp, `PRAGMA integrity_check`.
3. **Gap-fill merge** (see §6), all inside `breadth_daily_ohlc._WRITE_LOCK`.
4. Write `<DATA_DIR>/.breadth_ohlc_last_sync` = ts.

No epoch bump needed (in-place `INSERT`; `_conn()` opens fresh each call).

### C. Web puller wiring — `api/main.py`

Gated by `BREADTH_OHLC_REMOTE=1` on the **web** service:
- **Boot pull:** one `breadth_ohlc_sync.sync_if_new()` in the lifespan (after DB
  init), best-effort.
- **Slow loop:** daemon thread `breadth_ohlc_pull`, `sleep(600)` then
  `sync_if_new()`. At steady state this is one tiny GET of `latest.txt` every 10
  min that short-circuits — negligible. It only does real work in the window while
  a backfill is actively uploading new chunks.
- Optional **admin trigger:** `POST /api/breadth-monitor/history/pull-now`
  (PUSH_SECRET) to force an immediate pull after a backfill completes, instead of
  waiting for the loop.

---

## 6. The merge rule (the one thing that must be right)

Backfill adds dates the web **does not have**. The primary key is `(date, metric)`.
So the correct, safe, and simplest rule is **pure gap-fill**:

```sql
ATTACH DATABASE ? AS snap;
INSERT OR IGNORE INTO breadth_daily_ohlc(date,metric,o,h,l,c,source,updated_at)
SELECT date,metric,o,h,l,c,source,updated_at
FROM snap.breadth_daily_ohlc
WHERE source IN ('live','close_recon');   -- never propagate the junk 'reconstruct' source
```

Why this is correct and safe:
- `INSERT OR IGNORE` on PK `(date,metric)` inserts **only pairs the web lacks** and
  leaves **every existing web row untouched** — including the 209 real `live`
  intraday wick rows and the 20,800 existing `close_recon` rows. The bridge can
  only ever *add* history, never regress a fresher/better local row. Same safety
  property as the bars newer-wins merge, achieved more simply.
- The `source IN (...)` filter enforces the store's existing trust model
  (`_TRUSTED_SOURCES`) at the bridge boundary too.
- **Do NOT add the bars `s.ts > MAX(ts)` clause** — it would reject all older
  backfilled dates. This is the single copy-paste trap and is called out in tests.

**Future re-runs (Phase 2 point-in-time universe):** gap-fill won't *replace* an
existing `close_recon` date with an improved one. When we want that, the refresh
path first `DELETE`s the target `close_recon` date-range on web, then pulls — an
explicit, admin-gated "force refresh" op, out of scope here. Noted so nobody
"fixes" gap-fill into a silent overwrite.

---

## 7. Environment variables

**Worker service:**
- `BREADTH_HISTORY_BACKFILL_ENABLED=1` — start the backfill thread
- `DATA_SYNC_*` — already set (shared R2 creds)
- optional `BREADTH_BACKFILL_CHUNK_DAYS=365`, `BREADTH_BACKFILL_PAUSE_SECS=90`

**Web service:**
- `BREADTH_OHLC_REMOTE=1` — start the puller + boot pull
- `DATA_SYNC_*` — already set

Both default OFF → shipping the code is dark; the feature turns on by env only.
Rollback = unset the two flags (no deploy needed to stop new work; the worker
thread idles when the floor marker is cleared).

---

## 8. Rollout plan (staged, each step reversible)

1. **Ship dark.** Merge the module + both wirings with flags OFF. Backend tests
   green (merge-rule test is the key one).
2. **Bridge smoke test** (no heavy compute): on the worker, `upload()` the current
   tiny DB (it already holds 2024→now); flip `BREADTH_OHLC_REMOTE=1` on web; confirm
   web pulls + gap-fill is a no-op (web already has those rows) and the site stays
   200. Proves the channel end-to-end with zero risk.
3. **One bounded chunk on the worker.** Set worker floor to e.g. `2023-01-01`,
   `BREADTH_HISTORY_BACKFILL_ENABLED=1`. Watch: worker computes one 2023 chunk,
   uploads; web coverage `first` moves `2024-01-02 → ~2023-01`; **web stays 200
   throughout** (the whole point). Validate a known 2023 value.
4. **Full grind.** Set worker floor to `2008-01-01`. The thread chunks down
   overnight, uploading after each; web coverage deepens as chunks land. No web
   restart risk because web only ever merges.
5. **Validate** against known extremes (§9) as depth accrues.
6. **Phase 2 later:** point-in-time universe for survivorship-accurate pre-~2020
   (§10).

## 9. Validation harness

Reuse/extend `breadth_history_recon.validate_recent` + `diff_members`:
- **Extreme spot-checks:** 2020-03-23 UCTA50 ≈ 2 (COVID washout), 2020-11-09 ≈ 77,
  2018-12-24 and 2022-10 selloff troughs, 2021 highs. Assert within tolerance.
- **Coverage monotonicity:** after each pull, web `stats()["first"]` only moves
  earlier or stays; `live_rows` count never drops (proves gap-fill didn't clobber).
- **MA-family cross-check:** `% above 50MA` reconciles to the collector within ~1pt
  on overlapping recent dates (already true for 2024→now).

## 10. Known limitations (surface these, don't hide them)

- **Survivorship (pre-~2020):** the recompute uses **today's** cap-universe, so
  older years are survivorship-biased — the **shape is accurate and the MA family
  is near-exact**, but absolute levels read slightly strong in old years (dead
  names that would have dragged breadth down are absent). Phase 2 (point-in-time
  universe from Massive `/v3/reference/tickers` active+delisted) fixes the absolute
  level; it's a separate, larger effort and NOT required to ship deep bodies.
- **Wicks stay forward-only.** This bridge ships **bodies** (close-basis
  history). Real historical high/low wicks need full-universe intraday recompute
  (Phase 3) — unchanged by this work. Charts already fall back to bodies for days
  without a wick row.
- **A/D-line (UCTAD) chunk seam:** `adv_decline_cum` rebaselines per chunk; a
  cumulative line needs a one-time join/rebase across seams (flagged, small).

## 11. Task breakdown

1. `api/services/breadth_ohlc_sync.py` — client, `upload`, `sync_if_new`, gap-fill
   merge. **Test the merge rule** (older dates adopted; existing live/close_recon
   rows never touched; `reconstruct` filtered).
2. `worker_main._start_breadth_backfill()` + flag + wire into `main()`.
3. `api/main.py` — web boot pull + `breadth_ohlc_pull` loop + flag; optional
   `pull-now` admin endpoint.
4. Validation additions to `breadth_history_recon` + a `tests/` extreme-check.
5. Rollout per §8; then Phase 2 (survivorship) as a follow-up spec.

---

### Files to reference while building
- Bridge pattern to mirror (leaner): `api/services/data_sync.py`
  (`_client`, `merge_snapshot`, `sync_if_newer_merge`, `_make_tarball`,
  `_backup_sqlite_db`, `_assert_shippable_db`).
- Worker thread pattern: `api/worker_main.py::_start_uploader` (lines ~127-197).
- Web puller pattern: `api/main.py::_s3_pull_loop` (gated by `USE_REMOTE_BARS`).
- The store being synced: `api/services/breadth_daily_ohlc.py`
  (PK `(date,metric)`, `_WRITE_LOCK`, `write_bulk`, `history`, `stats`).
- The compute being moved: `api/services/breadth_history_recon.py`
  (`backfill_tick`, `sweep_history`, `load_deep_frame`, `get/set_backfill_floor`).
