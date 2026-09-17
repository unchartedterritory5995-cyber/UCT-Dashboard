# R61 — the Friday flow-worker window, written down before it opens

**Branch:** `r61-oi-daily-cache` @ `8be968cfb` (pushed, NOT merged).
**Window:** weekday **06:00–08:30 ET**, and the acceptance must be finished before **09:00 ET**.
⛔ **Never 08:30–16:20 ET.** A flow-worker restart drops the Massive OPRA socket and Massive does
not replay: the gap is permanent until the T+1 flat file.

⭐ **This exists because the window is short and a window spent deciding things is a window
wasted.** Every decision below is already made; Friday is execution and reading.

## Why this push bounces flow-worker at all

`api/massive_oi_snapshots.py` is **reachable from flow-worker and NOT on its watch list**, so
R61 on its own would ship **inert**: the fix on master, the worker still walking 41 pages per
request, every test green, nothing reporting a problem.
`tools/flow_worker_watch_coverage.py` named it; commit `8be968cfb` is the prescribed
`api/flow_worker_main.py` header trigger. **The bounce is the point, not a side effect.**

## Preconditions — ALL of them, read not assumed

| # | precondition | how to read it |
|---|---|---|
| 1 | the previous session's **T+1 flat file is loaded** | read it **in-process on the worker**, not from a log line that says a job started |
| 2 | **nothing else is deploying**, repo-wide | `python tools/pre_push_guard.py` exits 0 |
| 3 | the **OPRA socket state is captured BEFORE** | record it; it is the only baseline the "after" can be compared against |
| 4 | the **last SUCCESS deploy id for flow-worker is read and written down BEFORE starting** | ⛔ this is the rollback target, and it is unreadable once a failed deploy is on top |
| 5 | it is a **weekday inside 06:00–08:30 ET** | not "roughly morning" |

## The run

```sh
python tools/pre_push_guard.py                      # must exit 0 - no lever
python tools/flow_worker_watch_coverage.py          # expect: 1 stranded file rides along
python -m pytest tests/test_massive_oi_daily_cache.py tests/test_massive_oi_cp_normalization.py \
                 tests/test_flow_worker_watch_coverage.py -q
git push origin r61-oi-daily-cache:master
```

Then wait for **flow-worker** (not web) to reach SUCCESS, and web too — this push touches
`api/**`, so both services rebuild.

## Acceptance, before 09:00 ET

1. **The socket reconnected.** Compare against the state captured in precondition 3. ⛔ A socket
   that is "connected" without a before-reading is not evidence of anything.
2. **R61 is actually doing its job**, read from the worker's own log:
   - the first SPY request of the session logs `walk=complete` or `walk=truncated` with
     `cached_for_the_day=True`;
   - **every subsequent SPY request logs nothing at INFO** — a cache hit is `debug`. ⭐ That
     absence IS the acceptance: the old behaviour emitted `41 pages` per request, so one line
     per session instead of one per request is the whole measurement.
3. **Truncation is now visible.** If SPY still hits the 40-page cap, a `⛔ TRUNCATED` WARNING
   appears. ⚠️ **That is a finding to record, not a failure of R61** — the same truncation was
   being served silently before. It decides whether `MASSIVE_OI_MAX_PAGES` needs raising, which
   is a separate change with its own window.
4. **`price+oi` now has a number.** `[massive-oi] price+oi SPY: N pages, M strikes, X ms` is new
   instrumentation on the second, deliberately-uncached walk. Record X. ⛔ Do not cache that one
   on the strength of R61's numbers — it carries the live mark, and its remedy is a short TTL.

## If the socket is not connected by 08:50 ET

**Roll back first, diagnose second** (H15). `railway` rollback to the SUCCESS deploy id recorded
in precondition 4, verify the socket from the worker, and **defer**. Do not spend the window
investigating: the tape gap is being paid for in real time and is permanent.

## What this window is NOT for

⛔ **OI-13 step 6 is a separate item at ~08:23 ET and must not overlap this deploy.** Two things
touching the worker in one window makes both unreadable, which is the same lesson as the
2026-09-17 in-flight push, one service over.
