# Runbook — auth.db → Postgres migration trigger

**One question this page answers:** *when do we stop scaling SQLite and move `auth.db` to Postgres?*

SQLite (WAL) on the single web pod is the right call today — it is fast, zero-ops,
and the whole product fits in one file. It has ONE ceiling: **concurrent writers
serialize.** WAL gives lock-free reads and one writer at a time; past some write
concurrency the writer queue (and the anyio threadpool behind it) is what breaks —
that is the 2026-07-01 524 class. Migrate to Postgres when the measurements below
cross their thresholds — **not before** (a premature migration adds ops burden and
a network hop to every request for no user-visible gain).

## Migrate NOW if ANY of these is sustained (not a one-off spike)

| Signal | Where to read it | Trigger threshold |
|---|---|---|
| **`SQLITE_BUSY` rate on auth.db** | app logs — `database is locked` / `OperationalError` on `auth_db.get_connection()` writes | **> ~1% of auth writes** busy-retry, OR any user-visible 5xx traced to a lock, sustained over a peak session. This is the PRIMARY trigger — it is the thing SQLite can't scale past. |
| **Concurrent journal (write-active) users** | active sessions × write cadence; broker-sync + trade/position writes are the auth.db writers | **> ~150–200 concurrent write-active users** at peak. Below that, WAL + the poller collapse (≤4 recurring reads/user) keeps the writer queue shallow. |
| **Today surface p95 latency at peak** | request timing on the Today endpoints (`/coach/overview`, `/positions`, `/options`, `/discipline/state`) | **p95 > 800 ms sustained at peak** after cache warm. If p95 climbs while CPU is idle, the tell is lock/threadpool wait → SQLite write contention, not compute. |
| **auth.db backup size / duration** | `authdb_backup` log line: `uploaded … (<bytes>, <secs>)` | **backup > ~60 s OR the gzipped copy > ~500 MB.** A backup that takes minutes signals the DB has grown past comfortable single-file territory; long backups also lengthen the online-backup read window. |

If **none** of these is crossing, do **not** migrate — keep tuning (poller collapse,
read caching, write throttles) instead.

## What migrates — and what explicitly does NOT

- **First and ONLY: `auth.db`.** Users, sessions, subscriptions, all of Journal 2.0
  (`j2_*`), broker links, watchlists, preferences. It is the single write-contended,
  crown-jewel DB on the universal request path. Everything above is about it.
- **`bars.db` does NOT migrate.** It is **worker-local**, write-owned by the prewarmer
  on a separate pod, and reaches the web pod as a read-only newer-wins R2 merge. The web
  pod only ever *reads* it (WAL, lock-free). There is no write contention to relieve —
  moving it to Postgres would add cost and latency for zero benefit.
- **`cot.db`, `breadth_monitor.db`, `catalysts.db`, `tweets.db`, `modelbook.db`, etc. do
  NOT migrate.** Low write rate, mostly scheduler-written, not on the hot per-request
  write path. Leave them as SQLite.

## Architectural note — schedulers CANNOT move to the worker pod

A scaling suggestion sometimes raised is *"evict the schedulers off the web pod to
relieve it."* **That is architecturally impossible and would break correctness:**

- The web pod's scheduled jobs (`session_cleanup`, broker sync, the dark `authdb_backup`,
  Compass EOD/weekly, etc.) operate on **`auth.db`, which is web-local.** The worker pod
  has a *separate* `/data` volume with `bars.db` and no `auth.db`. A scheduler on the
  worker would have nothing to act on.
- These jobs already run **off-peak / low-frequency** (nightly cleanups, 6h/2:55am
  backup, 20-min broker sync that self-gates to market hours). They are not the peak-load
  problem; the **per-request write path** is. Evicting them relieves nothing measurable.
- The correct relief valve when the triggers above fire is **Postgres for `auth.db`** (so
  writes stop serializing on one file), NOT relocating cron jobs.

## When a trigger fires — the move (sketch, not this task's scope)

1. Stand up managed Postgres (Railway plugin). Keep `auth.db` as the fallback until cutover.
2. Port `auth_db.get_connection()` + the `j2_*`/auth schema to Postgres (psycopg); the
   query surface is plain SQL, so it's a driver + DSN swap, not a rewrite.
3. Backfill from the latest `authdb_backup` R2 snapshot (`authdb/backup/<ts>.db.gz`) — the
   dark backup is also the migration seed.
4. Multi-worker the web pod becomes possible **only after** this move (today the single
   process is mandatory because live-price SSE state is in-process — see the 524 runbook).

**Cross-references:** the 524 single-process law (`incident_524_single_process_overload_2026_07_01`),
the launch-load hardening pass (this deliverable), and `data_sync.py` for the R2 rail the
`authdb_backup` snapshots ride.
