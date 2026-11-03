# Pine parity programme: lane assignments (written ONLY by the laptop coordinator)

Protocol: docs/pine/parity-programme/DESKTOP-PROMPT.md section 2 (branch docs/pine-parity-programme).
Production / master at writing: f014e73506 · SCRIPT_ENGINE_VERSION 5. Engine numbers in merge order: W4-T4 -> 6 (bumped on its branch, LANDING); W3 -> 7;
later engine merges take the next number, assigned here.
Plan: DESKTOP-PROMPT.md v2.1 at 7809e3399b (states name the tip they judge: @sha10).

## Desktop lanes
| lane | state | notes |
|---|---|---|
| W4-T2 `simple` folding | QUEUED | Opus. T9 waits on it. |
| W5-T1 server bundle | QUEUED | Sonnet. |
| W4-T7 fn-body series | QUEUED | Sonnet. Merge before T8. |
| W4-T11 runtime text | QUEUED | Sonnet. |
| W5-T6 supervisor/protocol/auth | QUEUED | Opus, after W5-T1 READY. |
| W4-T17 probes + T13 spike | QUEUED | Sonnet, docs/probes only. |
| W5-T2 host-neutral closure | QUEUED | Opus, after W5-T1. |
| W4-T12 paint typing | QUEUED | Sonnet; check W3 overlap first. |

## Laptop lanes (for visibility; desktop does not touch these)
| lane | state |
|---|---|
| Language scoreboard (docs/pine-language-coverage) | LANDING |
| W4-T1 classifier honesty (feat/pine-w4-t1-wall-report) | LANDING (review GO) |
| W4-T4 conditional arms (feat/pine-w4-t4-conditional-arms) | LANDING @311fb46c7a (review GO; engine 6) |
| W4-T3 text constants | BUILDING |
| W4-T0 / W0 census peel + attribution | BUILDING |
| W2 arming packet | BUILDING (round 2) |
| W3 drawings S1 | BUILDING (round 2) - engine 7 at merge |
| W5-T3 codec | FIX round in progress |
| E evidence-engine lows | BUILDING |
| W4 docs breakdown | MERGED f014e73506 (#749) |
| Editor status panel | PARKED |

## Notes from the coordinator
- (none yet)
