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

## Re-homed to the desktop (2026-11-03 ~16:45 CT; the laptop coordinator stops at its usage limit)
The coordinator is moving to another machine (LAPTOP-PROMPT.md v5). Keep building. READY lanes wait
for the new coordinator's review. Start these as builder slots free, AFTER your current lanes.
Each branch's newest WIP commit holds the exact next step.

| lane | state | notes |
|---|---|---|
| W5-T3 codec | QUEUED | `feat/pine-w5-t3-codec` @ cd61d6741d. Review r2 fixes are in; run final-tip and write EVIDENCE.md, then READY (for delta review). No engine bump. |
| W4-T0 census peel | QUEUED | `fix/pine-w0-census-peel` @ 75c4c400c2. Run `docs/pine/evidence/2026-11-03-w0-peel/job.sh` (with desktop env), then write coverage-map.json, targets, COVERAGE-MAP-2026-11-03.md and the 7.1 corrigendum. READY. |
| W4-T3 fix round | QUEUED | `feat/pine-w4-t3-session-text` @ f7fbf49425 (or newer). Finish M1/L1 (tuple-shadow refusal, rails, mutations), EVIDENCE.md, final-tip. READY. Engine 7 at merge. |
| W3 S1 round 2 | QUEUED | `feat/pine-w3-drawings` @ 7eaca7777f. Finish the pending checks in its newest commit (measure-pair both lanes, final-tip). READY. Engine 8 at merge. |
| W2 round 3 | QUEUED | `feat/pine-w2-arming` @ 1a8dddb408. Follow round2/WIP-STATE.md + round3-job.sh: classify P11, edit the packet. READY. NEVER arm or touch flags. |
| E evidence-engine lows | QUEUED | `fix/pine-evidence-engine-lows` (if pushed) - offline tooling. |

## Merge queue held for the new coordinator (already reviewed GO + landing checks passed)
Language scoreboard @ 397ecee294 · W4-T1 @ f9b85fb442 · W4-T4 @ 311fb46c7a (engine 6, bumped on its branch).

## Notes from the coordinator
- 2026-11-03 ruling: desktop builder cap is 6 (max 2 Opus) while free RAM >= 8 GB; 4 below that. Heavy jobs stay one at a time through the lock.
- Merge timing: promotion is frozen weekdays 15:30-16:15 ET and Wed 09:00-11:00 ET (deploy-freeze); the laptop avoids merging into those windows.
- Follow-ups found by the W4-T3 review (pre-existing on master; future lanes, not assigned yet):
  F1 the `env` path accepts a tuple/`:=` shadow of a non-var text constant (same flaw T3 fixes for `var`);
  F2 the runtime lane ignores `indicator(timeframe=...)` (timeframe.period reads the chart's); reuse pine.js::declarationTimeframe.
