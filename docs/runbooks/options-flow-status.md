# Options Flow — completeness ledger

**As of 2026-09-13 (Saturday), master at `81b1fe46a` or later.** One row per thread
from the original Options Flow list plus everything found this weekend.

Status vocabulary: **DONE-VERIFIED** (shipped and measured in production) ·
**DONE-UNMEASURED** (shipped, verified only on a quiet tape) · **WAITING-MONDAY**
(needs a live tape) · **OPEN-DECISION** (needs Patrick) · **PARKED** (deliberately
not being worked).

| # | Item | Status | Evidence | What moves it to done | Owner |
|---|---|---|---|---|---|
| 1 | CSV materialization (~19.9 s claim) | **DONE-VERIFIED** | Figure retired; decomposition sums to ~2.89 s CSV build inside a ~6.2 s roll | — closed | Claude Code |
| 2 | `FLOW_FAST_DATE_SCAN` loose index scan | **DONE-UNMEASURED** | Merged in the weekend bundle; flag armed on flow-worker | First live rolls under a rolling version | Claude Code |
| 3 | 6a parts-guard fix | **DONE-VERIFIED** | Prod: parts cache 2→10, `build_failures` 885→0, remainder-warmed line appears | — closed | Claude Code |
| 4 | 6b lock-holder attribution (instrumentation) | **DONE-UNMEASURED** | `_INFLIGHT_HOLDER` / `_VERSION_BLOCKED_BY` shipped | Handoff distribution over ≥60 live rolls | Claude Code |
| 5 | 6b handoff FIX | **WAITING-MONDAY** | No fix proposed — needs the attribution data first | Monday item 12 names the residual | Claude Code |
| 6 | `ORDER BY CreatedDate, id` | **DONE-UNMEASURED** | Merged; row-order table proved planner dependence (94,923/94,931 positions differ) | Live-tape confirmation | Claude Code |
| 7 | flow-worker watch paths + coverage rail | **DONE-VERIFIED** | `tools/flow_worker_watch_coverage.py` + CI; SKIPPED on 14/14 pushes, and on every push this weekend | — closed | Claude Code |
| 8 | Deploy rule (files, not clock) | **DONE-VERIFIED** | `docs/runbooks/deploy-windows.md` | — closed | Patrick (ruled) |
| 9 | **Dockerfile VITE build args** | **DONE-VERIFIED** | `705ee710d`. First paint 5,514,328 B → **169,721 B (165.7 KB gz)**, 32×; entry-chunk hash moves when inputs move | — closed | Claude Code |
| 10 | COMING_SOON state | **DONE-VERIFIED** | `a404392cd`. Option B; both halves `1`; holding page + all 6 funnel routes redirect; member-smoke still reaches Options Flow | — closed | Patrick (ruled) |
| 11 | `VITE_LAUNCH_DATE` | **OPEN-DECISION** | Unset; page counts down to the code fallback `2026-10-16T09:00:00-04:00` | Confirm Oct 16 = **no action**; a different date = set + rebuild | **Patrick** |
| 12 | `VITE_REALTIME_BARS` | **OPEN-DECISION** | Held at `0`; `flip_precondition` recorded in the ledger | Patrick schedules the test named in the precondition | **Patrick** |
| 13 | `VITE_MASSIVE_STREAM` | **OPEN-DECISION** | Held at `0`; precondition recorded | Same | **Patrick** |
| 14 | `VITE_DESK_BG_AUDIO_ENABLED` | **OPEN-DECISION** | Held at `0`; precondition recorded (needs a REAL touch device) | Same | **Patrick** |
| 15 | Synthetic member account + cold-paint rig | **DONE-VERIFIED** | `member-smoke@uctintelligence.internal`; rig with two paths, swap/cold-pod guard, login pacing | — closed | Claude Code |
| 16 | **GEX tab crash** (`fmtGex is not defined`) | **DONE-VERIFIED** | `67566d999`. Live since `9dff9dae0` (09-07); both accounts verified, 0 console errors | — closed | Claude Code |
| 17 | GEX crosshair lag | **DONE-VERIFIED (negative)** | `ee9c96fa1`. Headless 16.70 ms / 0 dropped / 0 LoAF over 5 runs; positive control detects injected lag; headed control **worse without** GEX lines (54 vs 15–17) | Patrick's real-pointer check (row 23) | Claude Code |
| 18 | **TOP 10 / request storm** | **DONE-VERIFIED (not a defect)** | `81b1fe46a`. Warm: 8/8 clean, 0 storms, picks 8/8, no remount. Cold pod (39 s): storm reproduces. Cause named: `PREHYDRATE_FALLBACK_MS = 3000` | Optional: raise/adapt the threshold — **not recommended** | Claude Code |
| 19 | Decision (a) | **OPEN-DECISION** | Cold-paint numbers now exist for both paths (quiet tape) | Patrick rules drop/reopen | **Patrick** |
| 20 | Decision (b) | **OPEN-DECISION** | Would need the reconcile path in `OptionsFlow.jsx` | Patrick rules; needs the Manrav waiver or his ack | **Patrick** / Manrav |
| 21 | Head-name Search / MU derive | **WAITING-MONDAY** | Never measured | Monday item 14 under a busy tape | Claude Code |
| 22 | 110 s boot-time cold prepare | **PARKED** | One contrary data point: `prepare.last_ms = 9,493` on a Saturday boot | Monday item 6: any steady-state roll >30 s | Claude Code |
| 23 | Patrick's GEX real-pointer check | **OPEN-DECISION** | The one check the rig cannot make | Real pointer on his own display; reopen only if it fails | **Patrick** |
| 24 | `feature_flags.json` VITE `last_changed` unknowns | **PARKED** | 4 flow flags recorded as `unknown - the CLI exposes no variable history` | Not recoverable; would need Railway audit-log access | Claude Code |
| 25 | Worktree cruft | **DONE-VERIFIED** | 164 → 153 worktrees; 12 → 1 `agent-*`; one kept for unpushed WIP | — closed | Claude Code |
| 26 | Rig instrument traps | **DONE-VERIFIED** | Below-the-fold chart, no `pointermove` in Event Timing, canvas-only render, role-locator miss, `add_init_script` observer throw — all recorded | — closed | Claude Code |

## The short version

**Nothing member-facing is known-broken.** The two real defects found this weekend —
every `VITE_*` dark since 09-08, and the GEX tab crashing since 09-07 — are both fixed
and verified in production. The crosshair lag and the TOP 10 storm both turned out not
to be defects on a warm pod, each closed on a measurement with a validated instrument
rather than on a fix.

**What is genuinely left:** six owner decisions (rows 11–14, 19–20, 23) and three
measurements that require a live tape (rows 5, 21, and confirming 2/6 under a rolling
version).
