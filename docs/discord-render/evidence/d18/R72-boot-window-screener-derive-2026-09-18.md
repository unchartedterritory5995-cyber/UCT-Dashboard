# R72 — boot-window screener derive: the premise corrected before the code was written

## R72's own premise, checked against the actual source (origin/master) before building anything

R72 asked to instrument `_sweep_locked`'s body to find which step is slow at boot, on the
hypothesis that "cold caches — cap_universe, symbol maps, prior snapshots — are the prime
suspects," and to fix it by registering those inputs in R63(c)'s `cold_start_guard` preload
registry so the sweep awaits them before running.

**Read the actual code (`api/services/screener/live_tier.py`, `origin/master`) before building
against that hypothesis, and it does not hold:**

- `_read_anchor_rows()` is ONE SQL `SELECT` over `screener_rows` via `snapshot_db.connect()`.
  No cap_universe, no symbol-map lookup.
- `derive_row()` — the ~3,745-row-times-25-column loop that `cols_recomputed=95996` on the
  110-second episode comes from — is **pure in-memory arithmetic**. Every derived column is
  `_recover_level(p0, anchor_row.get(...))` (back-solving a price level from the NIGHTLY row's
  own already-stored percentage) combined with the LIVE `quote` (already fetched, in memory,
  by R62's now-hoisted-outside-the-lock `full_market_snapshot()` call). `technicals.py` and
  `candle_catalog.py`, the two modules it imports from, have zero further imports beyond
  `dataclasses`/`typing` — confirmed, not assumed.
- `cap_universe` is **never referenced anywhere in `live_tier.py`**, confirmed by grep across
  the whole file. R63(c)'s existing `cold_start_guard` registry (which only carries
  `cap_universe.symbols`/`cap_universe.etf_symbols` today) has nothing to do with this code
  path — registering it here, as R72 originally proposed, would be a no-op fix for a
  misdiagnosed cause.

**So the "register cold inputs in the preload manifest" mechanism is the wrong tool for this
specific slowdown.** Recorded here so nobody re-derives R63(c)'s own name toward this problem a
second time.

## The evidence-supported redirection: SQLite lock contention, not a cold cache

`snapshot_db.connect()` (`snapshot_db.py:407-411`) sets **`PRAGMA busy_timeout=5000`** — 5
seconds. `_sweep_locked` makes at least three separate SQLite touches on `screener.db`
sequentially inside the held lock: the anchor-row `SELECT`, `snapshot_db.upsert_live_rows(...)`,
and `snapshot_db.prune_live_rows(...)`. If `screener.db` has a genuine WRITE CONTENDER during the
boot window — and a freshly-booted pod runs several other background prewarm/seed jobs
concurrently (this repo's own CLAUDE.md documents bars/ticker-logo/industry-map/darkpool
prewarmers all starting on boot) — EACH of those three sequential calls can independently retry
for up to 5 seconds before either succeeding or raising `sqlite3.OperationalError`. Three
sequential 5s-capped waits, or a slower/larger contention pattern than the cap anticipates,
comfortably explains totals in the tens-of-seconds to low-hundreds-of-seconds range that today's
R62-F3-attempt measured (peaks of 80,068ms and 110,402ms) — a mechanism the code's own PRAGMA
value supports, unlike the cold-cache hypothesis, which the code's own import graph refutes.

⚠️ **This is a strong, code-evidenced hypothesis, not a proven cause.** `derive_row`'s pure-math
nature and `_read_anchor_rows`'s single-query shape are both directly confirmed from source; the
SQLite-contention explanation for the MAGNITUDE observed is inference from the busy_timeout value
and this repo's own well-documented pattern of concurrent boot-time DB writers, not a direct
measurement of a contending writer caught in the act.

## What R72 actually needed, and what was and wasn't done tonight

The instrumentation half is genuinely still open, and R63(c)'s own disposition already says why
it belongs to production time, not tonight's code: *"R63(b)/(d)... instrumentation to correlate
real production stalls against these (and future) registered resources, over real elapsed pod
boots — which needs production time to pass, not more code tonight."* The same is true one level
down for THIS specific SQLite path.

**Not built tonight, and specified precisely instead of rushed:** extend `_sweep_locked` with
three named sub-timers (anchor-read, upsert, prune) reported in the receipt (mirroring
`snapshot_ms`'s own precedent from R62 — "a fix that makes a number fall must say where it went"
applies just as much to a number that ISN'T falling yet), and reuse
`api/services/screener/contention_trace_temp.py`'s ALREADY-BUILT active-jobs + WAL-sidecar-state
capture (it already names `screener.db` as its subject, docstring: *"what else is running when a
normally ~1-5ms SQLite read on screener.db expands to 100-500+ms in production"*) on whichever
sub-timer crosses a threshold — rather than inventing a second, parallel diagnostic for the same
database file. That tool's own hooks currently cover the member-facing `/api/screener` scan
endpoint only, not the background sweep job; wiring a fourth call site into
`contention_trace_temp.instrument_scheduler`'s already-existing `_active_jobs` tracking (the
sweep itself IS one of the ~135 APScheduler jobs it can already see) is additive, not a redesign.

**Why not built and merged tonight, stated plainly:** this touches `api/**` (like W3 and R62's own
fix before it), so per R59 it cannot ride this branch and needs its own branch off master, merged
under R58's one-push-discipline — and, more importantly, **the fix cannot be verified without a
real boot to observe**, exactly R63(c)'s own stated constraint. Shipping instrumentation without
a chance to read it against a real episode this session would be motion, not progress.

## Recommended next step, fully specified and ready to build

1. Branch off master (mirrors `fix/oi44-async-sqlite-threadpool`'s pattern): add the three named
   sub-timers to `_sweep_locked`'s receipt, and the `contention_trace_temp` active-jobs/WAL
   snapshot on any receipt whose `held_lock_ms >= 5000` (piggybacking that module's existing
   `SLOW_THRESHOLD_MS`-style pattern, not a new constant).
2. Merge under R58, deploy.
3. Read the NEXT boot-window episode's receipt (there will be one — every deploy costs one, per
   R71's own soon-to-be-installed watch-path change notwithstanding, since flow-worker and web
   both still restart sometimes) and it will finally say, by name, whether the anchor-read, the
   upsert, the prune, or something outside all three, is where the seconds go — and whether
   `_active_jobs_snapshot()` shows a genuine contending writer at that exact moment.
4. Only THEN does a real fix (a longer busy_timeout with a scheduling change to avoid overlap; a
   dedicated connection with a shorter, fail-fast timeout plus a retry-next-cycle instead of a
   long block; moving the sweep's writes off the same file as the 03:00 builder's) get chosen —
   choosing among those now, before knowing which of anchor-read/upsert/prune actually dominates,
   would be exactly the "one candidate is a story, not a finding" trap this whole programme's own
   `oi44_align.py` was built to avoid.

## D-21 — BUILT and MERGED (2026-09-18), the "not built tonight" step from above is now done

Owner directive D-21 corrected the R71 approach (config-as-code, not a login — see R71's own
doc) and explicitly authorized building this step's instrumentation now: *"That needs a boot to
verify, and boots are not scarce — instrument now, read on the next one."*

**What shipped** (`fix/r72-sqlite-instrument` → `master`, api/ commit, landing right after R71's):

- `api/services/screener/live_tier.py::_timed_touch` — the three sub-timers this doc specified,
  built. `sqlite3.Connection.set_busy_handler` — the historically-standard way to split
  "busy-wait" from "statement time" — is **confirmed removed** on this box's Python (3.14 /
  sqlite3 3.50.4; `hasattr(conn, "set_busy_handler")` is `False`), so `_timed_touch` implements
  the retry itself: each of the three touches now runs against a connection opened with
  `busy_timeout_ms=0` (SQLite raises `database is locked` immediately instead of blocking
  internally), and `_timed_touch` retries with a 20ms sleep, accumulating every failed attempt +
  sleep into `busy_wait_ms` while `statement_ms` is ONLY the final successful attempt's own
  elapsed time. Total wait is capped at 5000ms — the same ceiling `busy_timeout=5000` already
  gave every other caller — so a touch that never clears still raises
  `sqlite3.OperationalError` exactly as before (`run_sweep`'s existing `except` clause is
  unchanged).
- Six new receipt fields, declared in `_blank_receipt` (not written only on the path that
  measures it — this file's own standing rule): `sqlite_anchor_read_ms` /
  `sqlite_anchor_read_busy_wait_ms`, `sqlite_upsert_ms` / `sqlite_upsert_busy_wait_ms`,
  `sqlite_prune_ms` / `sqlite_prune_busy_wait_ms`.
- `active_jobs_at_sweep` / `wal_state_at_sweep` — reused verbatim from
  `contention_trace_temp._active_jobs_snapshot()` / `_wal_state()`, per D-21's explicit
  instruction not to reinvent them. This is a FOURTH call site for that module (previously three:
  `api/main.py`, `api/routers/screener.py`, `api/services/screener/query.py`).
- ⚠️ **Deviation from this doc's own "Recommended next step" §1, stated so nobody reads the old
  plan as current**: that section proposed gating the active-jobs/WAL capture on
  `held_lock_ms >= 5000`. D-21 did not repeat that gate, and it was dropped deliberately — both
  captures are cheap (a dict snapshot + four `os.path` stat calls), and capturing on EVERY cycle
  means a slow cycle can be compared against the FAST cycles immediately before and after it in
  the same log, rather than only ever seeing the slow tail in isolation. This also keeps the
  receipt's own "same key set on every cycle" invariant honest without a conditional branch.

**Rail** (`tests/test_r72_sqlite_touch_timing.py`, 4 cases): a write lock held in a SECOND
connection, entirely outside `snapshot_db._WRITE_LOCK`, must show up in `busy_wait_ms` and
nowhere in `statement_ms`. **Mutation-proved**, not merely asserted: `_timed_touch` was
temporarily replaced with a version that sums both into one timer (busy-wait forced to 0.0,
statement = total elapsed) — that mutation reds exactly the two contention-bearing cases
(`test_busy_wait_absorbs_a_held_write_lock_never_the_statement_timer`,
`test_a_touch_that_never_clears_still_raises_database_is_locked`) and correctly leaves the two
no-contention cases green, then was reverted. 89/89 green
(`test_r72_sqlite_touch_timing.py` + the full `test_screener_live_tier.py` suite, confirming no
regression to the live tier this instruments).

**Still open, unchanged from this doc's step 3 — needs a real boot, not more code**: read the
next ≥3 real boot-window receipts once this is live and name, by field, which of anchor-read,
upsert, or prune (or something the three sub-timers don't cover) actually carries the 80-110s
seen in R62-F3-attempt, and whether `active_jobs_at_sweep` names a genuine contending writer at
that instant. No fix is chosen before that reading — picking among the candidate fixes in step 4
above now would be the same "story, not a finding" trap this doc already named.
