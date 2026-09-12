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
| Retire `api/routers/trades.py` | **PARKED** | Evidence gathered: **0 callers in `app/src`**, 1 test references it, `include_router` already commented out. Retirable — but it is an `api/**` change needing a batched push, removal of code+test+docs together, and a "route is gone" test. Not attempted today; see "not finished" below. |
| Retire `j2_playbook_entries` | **PARKED — DO NOT DROP** | **12 code refs**, and `api/services/journal_two/account_purge.py:40` lists it in the purge set. Dropping it breaks account deletion. Evidence overturns the retirement. |
| Retire `GET /api/tweets/tape` | **PARKED — DO NOT RETIRE** | **It has a live caller.** `app/src/hooks/useTapeFeed.js:11` fetches it. ⚠️ **CLAUDE.md is wrong**: it states `useTapeFeed.js` was DELETED with zero callers. The file exists (507 bytes) and `reachable.test.js:420` tracks it as "in-flight, NOT mine". |
| `bar_quarantine` D/W/M no-op | **PARKED** | Confirmed present at `api/services/bar_quarantine.py`. An `api/**` change on bars-api needing D/W/M tests mutation-proved three ways. Not attempted today. |
| 9 pre-existing Python failures + red `gate_shards` rails | **PARKED — NOT ENUMERATED** | Not attempted. An unscoped `pytest` is forbidden here (a prior run reached 18 GB and was OOM-killed), so this needs a per-module sharded sweep, which is its own session. The only red rail found incidentally this weekend was `SMOKE_LOGIN_LINK_ENABLED`, now green. |

### Not finished today, and why

**A4, A5 (trades router), A6** were not completed. A5's other two retirements were
*disproven by evidence* and are correctly closed as DO-NOT-RETIRE. What remains — the
trades router, `bar_quarantine`, and the failure enumeration — are each `api/**` or
full-suite work requiring a batched flow-worker-restarting push plus mutation-proved
tests. They were stopped rather than rushed, per the standing rule that a characterised
open item beats a forced change. Each carries its evidence above so a dedicated session
starts with the answer, not the question.
