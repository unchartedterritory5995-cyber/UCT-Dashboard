# Options Flow — completeness ledger

**As of 2026-09-13 (Saturday).** Every row is DONE-VERIFIED, WAITING-MONDAY,
OWNER-DECISION or PARKED. No other status.

> **Members today get Options Flow's first paint in 169,721 B (165.7 KB gz) instead of
> the 5,514,328 B whole-day-plus-tape they were served a week ago, a GEX tab that
> renders instead of an error page, and a holding page that matches the backend that
> was already refusing signups. What is still unmeasured is everything that needs a
> rolling version: the 6b handoff residual, the head-name Search / MU derive cost, and
> confirmation that the date-scan and ORDER BY changes hold under load. Patrick still
> owes six decisions — launch day, the launch date, three held flags, and decisions
> (a)/(b) — plus the one GEX check a rig cannot make.**

## Core

| # | Item | Status | Evidence / where |
|---|---|---|---|
| 1 | CSV materialization (~19.9 s) | **DONE-VERIFIED** | Retired; ~2.89 s build in a ~6.2 s roll |
| 2 | `FLOW_FAST_DATE_SCAN` | **WAITING-MONDAY** | Shipped + armed. Monday item 8 |
| 3 | 6a parts-guard fix | **DONE-VERIFIED** | cache 2→10, `build_failures` 885→0 |
| 4 | 6b attribution | **DONE-VERIFIED** | Shipped; fields present |
| 5 | 6b handoff FIX | **WAITING-MONDAY** | Monday item 12 names the residual |
| 6 | `ORDER BY CreatedDate, id` | **WAITING-MONDAY** | Monday item 8 under a rolling version |
| 7 | watch paths + rail | **DONE-VERIFIED** | SKIPPED on every push this weekend |
| 8 | Deploy rule | **DONE-VERIFIED** | `deploy-windows.md` |
| 9 | **Dockerfile VITE args** | **DONE-VERIFIED** | `705ee710d` — 5,514,328 B → **169,721 B**, 32× |
| 10 | COMING_SOON state | **DONE-VERIFIED** | `a404392cd` — both halves `1` |
| 11 | Launch day | **OWNER-DECISION** | `launch-day.md` — one command, checklist, rollback |
| 12 | `VITE_LAUNCH_DATE` | **OWNER-DECISION** | `launch-day.md` — confirming Oct 16 = **no action** |
| 13 | `VITE_REALTIME_BARS` | **OWNER-DECISION** | `held-flags-and-checks.md`; precondition 1 **pre-verified** (9 tests) |
| 14 | `VITE_MASSIVE_STREAM` | **OWNER-DECISION** | `held-flags-and-checks.md`; escape hatch documented |
| 15 | `VITE_DESK_BG_AUDIO_ENABLED` | **OWNER-DECISION** | `held-flags-and-checks.md`; needs a real device |
| 16 | member account + rig | **DONE-VERIFIED** | swap/cold guard, login pacer, two paths |
| 17 | **GEX crash** | **DONE-VERIFIED** | `67566d999` — live since 09-07; both accounts clean |
| 18 | GEX lag | **DONE-VERIFIED (negative)** | `ee9c96fa1` — 60 fps; control worse without lines |
| 19 | **TOP 10 / storm** | **DONE-VERIFIED (not a defect)** | `c1c754636` — `PREHYDRATE_FALLBACK_MS=3000` on a cold pod |
| 20 | Decision (a) | **OWNER-DECISION** | memo below |
| 21 | Decision (b) | **OWNER-DECISION** | memo below; needs the reconcile path in `OptionsFlow.jsx` |
| 22 | Head-name Search / MU | **WAITING-MONDAY** | Monday item 14 |
| 23 | 110 s cold prepare | **WAITING-MONDAY** | Monday item 6; one contrary point (`prepare.last_ms=9,493`) |
| 24 | GEX real-pointer check | **OWNER-DECISION** | `held-flags-and-checks.md`, last section |
| 25 | Flag ledger data quality | **DONE-VERIFIED** | `4d2694a31` — audit reports 0 in all four categories |
| 26 | Worktree cruft | **DONE-VERIFIED** | 164 → 35; 117+11 removed; 32 junctions cleared first |
| 27 | `dataMode` stale comment | **DONE-VERIFIED** | `e143d1df1` — one comment hunk |
| 28 | `feature_flags` VITE `last_changed` | **PARKED** | Not recoverable — the CLI exposes no variable history |
| 29 | D-30 `data_root()` refactor | **PARKED** | 72 env pins across ~68 `api/**` call sites. Out of scope for any UI branch; needs its own session |

## Decision memo — (a) and (b)

**The question.** (a) and (b) were deferred pending a cold-paint number. That number
now exists for both paths on a **quiet tape**; the deciding figure is Monday's **path-B
median and worst** under a live tape, because path B is what a returning member feels
every 60 s.

**The number that decides it:** path-B `shell_ms` and `picks_ms`, median and worst,
from ≥5 guard-accepted runs. _Blank until Monday._

**Outcomes.** *Drop both* — the parts path already delivers first paint in ~166 KB and
neither adds enough to justify the work. *Reopen (a)* — commits to the (a) workstream
only, no partner-owned file. *Reopen (b)* — commits to **the reconcile path inside
`OptionsFlow.jsx`**, i.e. a partner-owned edit needing Manrav's ack or an explicit
waiver. ⚠️ The storm diagnosis did **not** unblock (b): `planDelta` / `_baseFetchedVer`
are not implicated in that mechanism.

## External — other workstreams, and what was not finished

| Item | Status | Finding |
|---|---|---|
| `SMOKE_LOGIN_LINK_ENABLED` | **DONE-VERIFIED** | `4d2694a31`. Declared. ⚠️ **ARMED AND LIVE — set to `1` on web.** Admin-issued single-use login link from `35dca25fd` (another workstream). Declared to record, not to decide; the flip is theirs. |
| `ALPHA_GOLD_EOD_ENABLED` | **DONE-VERIFIED** | `4d2694a31`. Ledger said off, flow-worker had it **set to `0`** — set-and-off is a recorded decision. |
| Retire `api/routers/trades.py` | **DONE-VERIFIED** | **Already retired** by `24ee463bc` (2026-08-09, "retire the /api/trades router past its documented window"). The file is ABSENT, `data/trades.json` is ABSENT, no `api/` module imports it, and `app/src` has zero callers. The only survivors are a comment in `tests/test_earnings_router_stays_unmounted.py:32` citing it as an idiom, and two historical 2026-02-22 plan docs. **No change needed.** |
| Retire `j2_playbook_entries` | **PARKED — DO NOT DROP** | **12 code refs**, and `api/services/journal_two/account_purge.py:40` lists it in the purge set. Dropping it breaks account deletion. Evidence overturns the retirement. |
| Retire `GET /api/tweets/tape` | **PARKED — DO NOT RETIRE** | **It has a live caller.** `app/src/hooks/useTapeFeed.js:11` fetches it. ⚠️ **CLAUDE.md is wrong**: it states `useTapeFeed.js` was DELETED with zero callers. The file exists (507 bytes) and `reachable.test.js:420` tracks it as "in-flight, NOT mine". |
| `bar_quarantine` D/W/M no-op | **PARKED — larger than described** | The module is 123 lines and every entry point takes `bar_time: int`, so the fix is not a comparison tweak: it changes the quarantine KEY SEMANTICS for D/W/M (CLAUDE.md prescribes a YYYYMMDD int on both sides). Call surface measured: `bars_disk_cache.py:236`, `bar_audit_bootstrap.py:145`, `bar_quality_score.py:27,49`, `bar_quarantine_cache.py` (60 s TTL wrapper), `bar_self_heal.py:33`, `admin_chart_health.py:110,119,127`, plus `main.py:3208`. That is a re-keying change across ~8 modules on the bars path, which carries locked invariants ("newest bar wins per (ticker, tf, ts) on EVERY path") and cannot be verified on a quiet tape. **Stopped rather than forced.** |
| Red `gate_shards` rails | **DONE-VERIFIED** | **Already recorded** in `docs/plans/joystick/gate-baseline.json` — no re-derivation needed. 7 failures across 5 files, measured 2026-09-10 at `62a228e5d`, extracted by `gate_shards.py::parse_failures` and **corroborated twice at two different merge-bases**. Table below. |
| 9 pre-existing Python failures | **PARKED — scope measured** | `tests/` holds **1,081 files** and there is no recorded Python baseline. An unscoped run is forbidden (a prior one reached 18 GB and was OOM-killed; `--collect-only` alone reached 6.6 GB, and `-k` cannot contain it because the cost is at collection). Enumerating means ~108 batched invocations at ~25 s each — a session of its own, not a step in one. The only red Python rail found this weekend was `SMOKE_LOGIN_LINK_ENABLED`, now green. |

### Not finished, and why

**All three A5 retirements are resolved without a code change**: the trades router was
already retired in `24ee463bc`, and the other two are DO-NOT-RETIRE on evidence. **No
`api/**` push was needed this weekend at all**, so flow-worker was never restarted.

What remains parked is **`bar_quarantine`** (a re-keying change across ~8 modules on the
bars path, surface measured above) and the **Python failure enumeration** (1,081 files,
no baseline, ~108 batched runs). Both were stopped rather than rushed, per the standing
rule that a characterised open item beats a forced change. Each carries its measured
scope above, so a dedicated session starts with the answer rather than the question.

### The 7 recorded `gate_shards` failures (from `gate-baseline.json`, 2026-09-10)

Measured at `62a228e5d`, extracted by `scripts/gate_shards.py::parse_failures` from a
six-shard run over 1,181 files, and corroborated at two different merge-bases.

| # | file | test |
|---|---|---|
| 1 | `ChartDrawingOverlay.surfaces.test.jsx` | the seven Model Book / surface override props still reach their decisions |
| 2 | `engine/ast/manifestProse.test.js` | every key the product READS survives the strip |
| 3 | `engine/ast/pine.blindCorpus.test.js` | the accepted floor moves one way only |
| 4 | `hooks/pollingSites.rail.test.js` | no NEW bare polling site |
| 5 | `pages/ThemeTrackerPage.chartmount.test.jsx` | passes `stored=null` with no `onStore` |
| 6 | `pages/ThemeTrackerPage.chartmount.test.jsx` | selecting a holding mounts ChartPane with that symbol |
| 7 | `styles/tapFloor.test.js` | the 44px touch floor covers TABLET, not just phone |

⛔ **Three names are LOAD-SENSITIVE and are deliberately NOT baseline entries** —
`flowSearchProduct`, `sharedScreen.route`, and
`ArticlesSection.native > clearing the query brings the full archive back`. Each has
failed a full sharded run and **passed alone**; the baseline records the evidence and
the rule that a timeout is never banked, because banking one leaves a slot a real
failure can occupy unnoticed. Re-run alone before classifying.

## Adjacent jobs, 2026-09-12 (outside the Options Flow ledger)

⚰️ This heading read **2026-09-13** until now, and so does the deploy-trigger comment
in `api/flow_worker_main.py`. Both were written on **Saturday 2026-09-12** (17:13 CDT =
18:13 ET); neither was ever the 13th. A dated record that is wrong about its own date
is the cheapest possible way to mislead the next reader about ordering.

| Job | Status | Evidence |
|---|---|---|
| Python failure baseline | **DONE-VERIFIED** | 71/71 batches, **23,849 tests, 66 failures, 0 errors**, 1 UNRUNNABLE group (10 files, left unrunnable). Never near the 3 GB floor (min free **11.31 GB**), 106.9 min. The **"9 pre-existing failures" figure is NO LONGER TRUE** — it is 66 across 21 files, 39 of them in four single-cause clusters, 3 environment artefacts (net 63). Rail mutation-proved four ways. `docs/test-baseline/python-failures.md` + `.json`. |
| Red `gate_shards` rails | **DONE-VERIFIED** | Already recorded in `gate-baseline.json` (7 failures / 5 files, 2026-09-10, corroborated twice, 3 load-sensitive non-entries). JS suite — does not overlap pytest. |
| Worktree sweep (2nd pass) | **DONE-VERIFIED** | 35 → 33. `terminal-research` removed; `indicator-r0r1` REFUSED (permission denied, file lock) and kept without `--force`; 31 kept for dirty work. No branch deleted, nothing stale to prune, 0 reparse points in the removed tree. |
| **`bar_quarantine` D/W/M** | **DONE-VERIFIED** | `7500777a2`. Was a complete no-op for D/W/M — write raised inside a bare `except` AND read compared ISO to `set[int]`. Key-additive fix; intraday is identity. 19 tests, mutation-proved (3 D/W/M RED, 0 intraday RED). All four services SUCCESS. |
| **`bar_provenance` D/W/M** | **DONE-SHIPPED — verification INERT-ON-DEPLOY** | `0164051dc`. Same bug, same `norm_bar_time` boundary, one call site. 10 tests; mutation-proved twice (restore the cast → 5 RED / **0 intraday**; neuter `norm_bar_time` → 4 RED / **0 intraday**). 104 green across every suite importing either module. Rail flagged `bars_disk_cache.py` stranded → rode along on `api/flow_worker_deploy_marker.txt` bump #5; flow-worker **BUILDING → SUCCESS, not SKIPPED**. Rollback `git revert 0164051dc`. |

⭐ The quarantine push is the first change this weekend to touch `api/**`. Both fixed
files are **flow-worker-REACHABLE but not on its watch list**, so
`tools/flow_worker_watch_coverage.py` correctly FAILED the diff — the rail firing on
its author's own change. Resolved the way the rail prescribes: a watched file moves in
the same commit, so flow-worker actually redeploys instead of running the old code with
every test green. `7500777a2` used a comment-only touch to `api/flow_worker_main.py`;
`0164051dc` used the purpose-built `api/flow_worker_deploy_marker.txt` instead, which is
what that file exists for and does not risk the watch-list mirror it sits beside.

### ⚰️ FINDING — `bar_provenance` has very probably NEVER held a row, since 2026-05-09

**Not a consequence of the fix; the reason the fix could not be verified end-to-end.**

`bar_provenance.py` shipped 2026-05-08 (`2175d0888`); its only live writer shipped the
next day, 2026-05-09, in `65bb406ce` *"record provenance on every clean cache write"* —
already carrying `int(bar.get("t") or 0)`. The chain, traced rather than assumed:

- **One live writer.** An AST walk over all of `api/` finds exactly two callers of
  `bars_disk_cache.put`: `bars_disk_cache_test.py:19` (a test helper) and
  `bars_fetch.py:2645`. Nothing else.
- **That site is D/W/M-only.** It sits in `_run_universe_warm_multi_tf`'s deep branch,
  guarded by `is_deep_tf = tf in ("D","W","M")`; intraday takes `_get_bars_inner`, which
  never calls `put`. So **intraday provenance is not written by this path either** — that
  is not a regression, it has always been so.
- **Its only door is operator-triggered.** `POST /api/admin/warm-universe`, not a
  scheduler job and not any member request path.
- **Every D/W/M bar carries an ISO `t`.** Measured live: `/api/bars/AAPL?tf=D` →
  `t='2026-09-11'` (str); `tf=5` → `t=1789168500` (int).
- **So every write raised** `ValueError` inside the bare `except: pass` — for 126 days.
- **The second writer is unreachable.** `bar_self_heal.py:46` sits behind
  `_fetch_from_alt`, a permanent `return None` placeholder ("Plan 4 will implement").

Measured, not inferred: the **worker** pod has no `bar_provenance` table at all
(`init_schema()` is called from `api/main.py`, the web entry), and production
`/api/provenance/bar` returns **404** for both the daily key `20260911` and a
just-fetched intraday epoch.

⛔ **NOT DIRECTLY MEASURED:** the web pod's own table. A read-only `railway ssh --service
web` probe was written and refused twice by the permission layer. Recorded as an
inference from the trace above, **not** as a measurement — the distinction matters
because one surviving row would falsify the "never" and leave the rest intact.

⭐⭐ **AND THE IRONY IS THE LESSON.** On 2026-08-09 the *plural* `bars_provenance` table
was deleted from `bars_sqlite.py` for exactly this defect — "the table held 0 rows …
nothing in the product ever wrote a row". Its farewell comment points next door:
*"`bar_provenance.py` — SINGULAR — is the live system … That is the affordance this
comment described, already built, next door."* **The survivor had the same disease, and
the note certifying it as working never measured it.** A comment naming a mechanism is
a claim about a run, and nobody made the run.

### Other findings, recorded and NOT fixed (owner decides scheduling)

| # | Finding | Why it was left |
|---|---|---|
| 1 | **`validate_bar` does not parse `t`.** Measured: `t: ""` and `t: "garbage"` both return `(True, [])`, so a bar with an unparseable time passes validation, is cached and is served. Only a *missing* `t` is rejected. | A real defect one layer above this fix, in a different module, with a correctness (not observability) blast radius. `0164051dc` stops such bars corrupting the provenance table — it does not stop them being cached. |
| 2 | **`bar_self_heal.try_heal` can never run.** `_fetch_from_alt` is `return None` by design pending "Plan 4". Its `bar_provenance.record` and `bar_quarantine.remove` calls are dead code today. | Not a defect, an unfinished feature — but it is why "two writers" is really "one". |
| 4 | ⭐⭐ **LIVE PRODUCTION DEFECT, found by the Python sweep, shipped 12:01 today in `553f6b68b` (D1 G1 tranche 1) and on `origin/master` now.** `api/services/ticker_meta.py:145` calls `_log.warning(...)`; every other line in that file uses `_logger` and `_log` is never defined. It sits **inside the `except` handler that commit added to keep** the function's docstring promise *"Never raises"* — the handler meant to preserve the contract is what breaks it. Blast radius traced: `_base_meta` catches it one frame up and falls back to Finnhub, so nothing 500s — but **every FMP profile failure is now logged as `name '_log' is not defined`, destroying the real provider error**. Five of the 66 baseline failures are this one line. | Not this session's to fix (docs-only, and D1 owns it). Recorded so it cannot go quiet — the sweep is the only reason it is visible. |
| 3 | **`api/flow_worker_main.py`'s deploy-trigger comment splits a sentence** in the module docstring, mid-clause, and is dated a day ahead. Introduced by `7500777a2`. | Cosmetic, in the one in-repo mirror of the watch list. Left alone under an explicit "nothing else" scope. |

