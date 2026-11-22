# Local dev backend

`run-local.ps1` starts the FastAPI backend on `:8000` and Vite on `:5173`. This page covers
the one switch that keeps that backend usable on a desktop during market hours.

## `LOCAL_LIGHT_MODE=1`

The web process boots the same way production does: dozens of warmers, seeds, integrity
scans, self-heal loops and ~200 APScheduler jobs that exist to keep **production** caches and
data hot. On a developer PC that held ~15 of 24 cores for minutes after every start and
`/api/health` took 10-22 s, even with the per-feature kill switches set.

`LOCAL_LIGHT_MODE=1` turns all of that off in one place:

- every boot warm / seed / integrity scan / preload / self-heal / re-warm loop is not started
  (each start site in `api/main.py` is guarded by `_light_skip("<name>")`);
- APScheduler is started **paused**: every job is still registered (same boot path), none fires;
- import-time warm loops whose module sits in flow-worker's import closure are turned off by
  defaulting their own kill switch (`FLOW_CONVICTION_WARMER=0`) before the routers import.

Everything a request asks for is still served on demand: login/session, preferences and
workspace layouts, chart bars (fetched when a chart asks), quotes, chart markers, header
snapshot/fundamentals, watchlists and lists, user definitions (formula builder, converse,
indicator vision), watchlist alerts (CRUD; the 60 s evaluators do not run), Journal trades,
the indicator library.

At startup the process prints one line naming what it skipped:

```
[local-light] ON — skipping N background jobs: thread-burst-watch, boot-probe, ...
```

Measured 2026-11-16 (market hours, test instance on :8017, with the per-feature switches
above also set): 60 jobs skipped, 146 APScheduler jobs held paused; at 3 min uptime the
process used 0.000 cores over 5 s with 7 threads, and `/api/health` answered in 2-4 ms
(was: ~15 cores, ~98 threads, 10-22 s).

### Use it

```powershell
$env:LOCAL_LIGHT_MODE = '1'
.\.venv\Scripts\python.exe -m uvicorn api.main:app --port 8000
```

or add `` `$env:LOCAL_LIGHT_MODE='1' `` to the backend block in `run-local.ps1`.

### What you give up

- Caches start cold: the first view of a chart, the dashboard tiles, the calendar, etc. is
  computed on request (as it would be on a fresh pod before its warmers ran).
- Nothing scheduled runs: no nightly builds, digests, alert sweeps, breadth samples,
  screener tiers, Discord posts, backups. Use the admin "run now" endpoints if you need one.
- `/api/rs-rankings` (the full list) still kicks its single background rebuild on a cold cache;
  the per-symbol badge `/api/rs-rankings/{sym}` used by `/charts` never computes.

### Production

Production never sets `LOCAL_LIGHT_MODE`. With it unset every guard returns False before
doing anything and the boot is unchanged; `tests/test_local_light_mode.py` executes each
guard both ways.
