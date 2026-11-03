# Pine parity programme: lane assignments (written ONLY by the laptop coordinator)

Protocol: docs/pine/parity-programme/DESKTOP-PROMPT.md section 2 (branch docs/pine-parity-programme).
Production / master at writing: f014e73506 · SCRIPT_ENGINE_VERSION 5. Engine numbers in merge order: W4-T4 -> 6 (bumped on its branch, LANDING); W4-T3 -> 7; W3 -> 8;
later engine merges take the next number, assigned here.
Plan: DESKTOP-PROMPT.md v2.1 at 7809e3399b (states name the tip they judge: @sha10).

## Desktop lanes
| lane | state | notes |
|---|---|---|
| W4-T2 `simple` folding | BUILDING (desktop) | Opus. T9 waits on it. |
| W5-T1 server bundle | BUILDING (desktop) | Sonnet. |
| W4-T7 fn-body series | BUILDING (desktop) | Sonnet. Merge before T8. |
| W4-T11 runtime text | BUILDING (desktop) | Sonnet. |
| W5-T6 supervisor/protocol/auth | QUEUED | Opus, after W5-T1 READY. |
| W4-T17 probes + T13 spike | BUILDING (desktop) | Sonnet, docs/probes only. |
| W5-T2 host-neutral closure | QUEUED | Opus, after W5-T1. |
| W4-T12 paint typing | BUILDING (desktop) | Sonnet; W3 overlap check per plan. |

## Laptop lanes (for visibility; desktop does not touch these)
| lane | state |
|---|---|
| Language scoreboard (docs/pine-language-coverage) | LANDING |
| W4-T1 classifier honesty (feat/pine-w4-t1-wall-report) | LANDING (review GO) |
| W4-T4 conditional arms (feat/pine-w4-t4-conditional-arms) | LANDING @311fb46c7a (review GO; engine 6) |
| W4-T3 text constants | FIX r1 (review GO + must-fix M1 tuple-shadow) - engine 7 at merge |
| W4-T0 / W0 census peel + attribution | BUILDING |
| W2 arming packet | BUILDING (round 2) |
| W3 drawings S1 | BUILDING (round 2) - engine 8 at merge |
| W5-T3 codec | FIX round in progress |
| E evidence-engine lows | BUILDING |
| W4 docs breakdown | MERGED f014e73506 (#749) |
| Editor status panel | PARKED |

## Notes from the coordinator
- 2026-11-03 ruling: desktop builder cap is 6 (max 2 Opus) while free RAM >= 8 GB; 4 below that. Heavy jobs stay one at a time through the lock.
- Merge timing: promotion is frozen weekdays 15:30-16:15 ET and Wed 09:00-11:00 ET (deploy-freeze); the laptop avoids merging into those windows.
- Follow-ups found by the W4-T3 review (pre-existing on master; future lanes, not assigned yet):
  F1 the `env` path accepts a tuple/`:=` shadow of a non-var text constant (same flaw T3 fixes for `var`);
  F2 the runtime lane ignores `indicator(timeframe=...)` (timeframe.period reads the chart's); reuse pine.js::declarationTimeframe.
