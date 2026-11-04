# W4-T7 evidence: an expression's own series inside function bodies

Branch feat/pine-w4-t7-fn-series. Code tip tested: 066b312f11e1184c3aa58952cb712dbfc30c6b79.
Tested on master (merge-base, measure-pair base): 5d95103c8a426e9c5844f42acef2f2131a96101a.
This EVIDENCE commit changes docs only. Machine: desktop. SCRIPT_ENGINE_VERSION not edited; a bump IS needed
(refusals became served values).

## What changed (app/src/components/chart/engine/ast/pineRuntimeFrontend.js)
- hoistCommittedSeries: the owner !== null refusal is gone. Inside a function body the hoist declares a frame-local
  slot (newSlot owns it by owner). Its ring is fnHistorySlotFor (per function, per call site off historyBase), via one
  helper hoistedHistorySlot used by the offset and ta.change sites. The windowed site already branched on owner.
- A function body's own statement list (lowerStmts with fnHoist) and its result (lowerFrameResult) are hoist sinks.
  defineFunction withdraws the root sink on entry and restores it in a finally.
- Still refused by name: a nested list in a body (T5 H9), including a block VALUE (x = if ..., switch), because
  lowerBlockValue withdraws the sink inside a frame; and a GLOBAL's history through a function
  (runtime:function-global-state, unwitnessed), via the guard: owner !== null, source is a name, outerSlot(name) set.
- Bands of T1, T3, T4, W3, T2, T11 not touched.

## Rails (app/src/components/chart/engine/runtime/__tests__/)
New w4FrameHoist.test.js (12 tests): hull shape, sum(v*w,p), ta.vwma, offset, ta.change, a body-statement hoist, two call
sites with different arguments (separate rings), nested-list / global / block-value refusals. Oracle: the same maths
hand-bound at the ROOT, 5,000 bars, with a finite-count non-vacuity check (a NaN diff counts as unequal).
Superseded pins updated (they asserted the old refusal): historyExpression.test.js (2), history.test.js,
requestHoist.test.js, sourceToRuntime.test.js, rt7PivotRightbars.test.js (2; the next wall is now
runtime:call-windowed-state), objectLaneRuntimeCensus.measure.test.js (its bucket list lacked DREW-NOTHING-KEPT).

Red on master, green on tip (runs/dsk-w4t7c/red-master.log and green-tip.log):
master "Tests 7 failed | 5 passed (12)"; failing: hull shape, sum(v*w), vwma, offset, change, body-statement hoist,
two call sites. Tip: "Test Files 2 passed, Tests 29 passed (29)" (w4FrameHoist + historyExpression).

## Mutation proof (mut.log, tip tree, byte-exact restore)
| mutation | killed by |
|---|---|
| M1 all sites share one ring (historyBase) | TWO CALL SITES ... SEPARATE rings |
| M2 allow hoist in a nested list inside a frame | NESTED LIST of a function still refuses (historyExpression) |
| M3 drop the global-name guard | a name the site cannot resolve still refuses runtime:function-global-state |
| M4 result sink not landed | hull shape |
| M5 body statements get no sink | a hoist inside a body STATEMENT |
| M7 ring from the main program, not the frame | an offset over an expression |
| M9 block value keeps the sink in a frame | an if expression arm ... refuses |
| M6 constant hoist name | SURVIVED: equivalent (slot identity is by index; the name is cosmetic) |
| M8 defineFunction keeps the root sink | SURVIVED: equivalent by construction (every body path re-arms or nulls its own sink); kept as defence in depth, not claimed as proved |

An earlier run showed M4/M6/M8 surviving because the rail compared abs(NaN) > eps (false); fixed to !(<= eps).

## measure-pair
Command: measure-pair.sh OUT tip:pine-dsk-w4t7 base:pine-dsk-mpbase RUNTIME_ON 1, base switched to M inside the same hl job.
Both lanes: "== side tip 066b312f11", "== side base 5d95103c8a"; every step rc=0.

| lane | harness totals (tip = base) | C18 probes | C18 corpus audit | census (967 rows) |
|---|---|---|---|---|
| runtime off (0) | 336: MATCH 93, DIVERGE 103, INCONCLUSIVE 140; 0 per-capture diffs | identical | 2 scripts, first wall moves | 3 rows differ |
| runtime on (1) | 336: MATCH 111, DIVERGE 107, INCONCLUSIVE 118; 0 per-capture diffs | identical | same 2 scripts | 16 rows differ |

Classification (0 unintended):
- C18 audit: machine-learning-logistic-regression-v3 runtime:history-expression -> runtime:conditional-history;
  volume-surge-radar runtime:history-expression -> pine:window (a length that is not a plain whole number). Intended.
- Lane 0 census: volatility-coil-edge-bullbyte and luxy-momentum-trend: object-lane drop-reason buckets re-attribute
  (unattached on both sides, drawsObjects false on both; dropped totals 141 -> 137 and 178 -> 178), intended-neutral.
  halftrend-longshort-signal-engine-bigbeluga: translator pine:timeout text and line differ (10000ms vs "nested past
  400 levels"); a time-budget artefact in pine.js, which this branch does not touch; noise.
- Lane 1 census, 16 rows, attached False -> False on every one, each a first-wall or peel-depth move on a script the
  spec lists: ad-line-of-sp-sectors (history-expression -> request-with-state), bollinger-band-width-percentile (-> array,
  peel 7 -> 3), momentum-based-zigzag (peel 7 -> 4), logistic-regression-v3 (pine:undefined -> runtime:withheld-all),
  obv-macd-indicator (block-value -> conditional-history), range-filter-v1, trend-following-parabolic, and the ta.pivot*
  scripts, which now stop at runtime:call-windowed-state. No attach flips.
- Object-lane runtime census (olc-tip.log vs olc-base.log): DREW 16 = 16, THREW 2 = 2 (identical messages),
  BUILD-REFUSED 248 -> 247, one script BUILD-REFUSED -> DREW-NOTHING-KEPT (builds, emits objects, the renderer keeps
  none, so nothing is drawn). The script is not named in the log.

## final-tip (final-tip.sh pine-dsk-w4t7 ... tests/test_script_engine_version_gate.py, tree = 066b312f11)
- gate pytest: 46 passed; test_script_engine_version_gate.py: 6 passed; hygiene: clean (34665 tracked files).
- full chart+hooks vitest: "Test Files 1 failed | 1334 passed | 27 skipped (1362)", "Tests 1 failed | 22372 passed | 118 skipped".
  The one failure is the known baseline src/hooks/pollingSites.rail.test.js (not ours).
- An earlier final-tip on 9287ec83f2 had 6 failed files; five were superseded pins plus the census bucket list, now fixed.

## Open items and hazards
- Root-list leak, pre-existing and not widened: "x = if c ... ta.sma(k * 2, 5)" hoists above the if at the ROOT and runs
  every bar. That is T5's.
- A global's history through a UDF stays refused (needs a capture).
- ta.pivothigh/low in a UDF now reach runtime:call-windowed-state (T10's wall). "n / 2" window lengths from a simple
  parameter stay history-dynamic-offset (T8 / T17).
- One script moved BUILD-REFUSED -> DREW-NOTHING-KEPT on the object door (above); the C18 door is live, so worth a glance.

Logs: C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\runs\dsk-w4t7c\ (job.out, red-master.log, green-tip.log, mut.log,
mp0*, mp1*, olc-*.log) and ...\runs\dsk-w4t7c-final\ (js.log, gate.log, hyg.log, py.log).

## Addendum: object-door gate (coordinator ruling), code tip 0ac78ae601ad474d159c046c34deb0b1cce1318d
The script that moved BUILD-REFUSED -> DREW-NOTHING-KEPT on the live object door:
`reverse-stochastic-momentum-index-on-chart__lcAyAeNEsA.pine` (found by a per-script run of the object-lane census,
tip vs master; four scripts changed refusal text, only this one changed bucket).
Why: its UDFs (f_reverse_SMI, f_reverse_SMI_cross) take `ta.ema(...)[1]` and `(...)[1]` over expressions of their
parameters, which master refuses (`runtime:history-expression`); with the frame hoist they build, and the script's single
`label.new` (info box at `time_close + offset`, xloc.bar_time) is emitted but the renderer keeps none.
Verdict: NOT PROVABLY CORRECT. TradingView draws that info box, so a blank result is not "TradingView draws nothing too".
Action: the function-body hoist is gated off at the object door (`atObjectDoor && owner !== null` in hoistCommittedSeries),
so the door keeps master's answer exactly. The runtime pane keeps the new behaviour.
Rails (w4FrameHoist.test.js, 15 tests): door refuses `runtime:history-expression`; the pane builds the same source;
the door still serves the root-list hoist master served.
Mutation M10 (gate removed): KILLED by "door (objectDoor: true) refuses runtime:history-expression, as master does".
measure-pair re-run on the gated tip, base `pine-dsk-mpbase2` at M 5d95103c8a (the base header was checked each lane;
a first lane-0 run had its shared base switched by another builder to 6990d63b02 and was discarded, lane 0 re-run):
- lane 0 (mp0b): harness 336 MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140, identical; C18 probes identical; C18 corpus
  audit 0 non-timing diffs; census 1 row differs (`multi-timeframe-trend-indicator` pine:timeout, a time-budget artefact).
- lane 1 (mp1): harness 336 MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118, identical; probes identical; audit 0 non-timing
  diffs (the earlier two first-wall moves were runtime-pane effects and are now gone from the door); census 16 rows differ,
  all runtime-pane first-wall moves with attached False -> False, as before.
final-tip on 0ac78ae601 (heavy-final2): gate pytest 46 passed, engine-version gate 6 passed, hygiene clean;
vitest "Test Files 1 failed | 1334 passed | 27 skipped", "Tests 1 failed | 22375 passed"; the one failure is the known
baseline pollingSites.rail. Logs: runs/dsk-w4t7d/ and runs/dsk-w4t7d-final/.

## Correction: valid measure-pair on the gated tip (supersedes the dsk-w4t7d measure-pair numbers above)
The dsk-w4t7d measure-pair runs used a lock file outside the lane lock directory, so other lanes switched the shared base
under them; those results are INVALID and are withdrawn. Mutation (M10) and final-tip on 0ac78ae601 ran in this worktree
and stand. Re-run: `.../dsk/heavy-mp2.lock`, base pine-dsk-mpbase2 switched to M 5d95103c8a inside the job, HEAD asserted
equal to M before and after each lane plus a 3 s watcher for any mid-run switch (none fired; job printed MP_OK).
Tip measured: 42d7c83698 (code identical to 0ac78ae601; docs-only commits since). Logs: runs/dsk-w4t7e/.
- lane 0: side tip 42d7c83698, side base 5d95103c8a. Harness 336: MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 on both sides, 0 per-capture
  diffs. C18 probes identical. C18 corpus audit: 0 non-timing diffs. Census: 2 rows differ, both noise: `multi-timeframe-trend-indicator`
  (pine:timeout text) and `volatility-coil-edge-bullbyte` (object-lane drop-reason counts 138 on base this run vs 141 on base in an earlier
  run, 137 on tip both times: the base varies run to run).
- lane 1: harness 336: MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118 on both sides, 0 diffs. Probes identical. Audit 0 non-timing diffs.
  Census 17 rows differ (the 16 runtime-pane first-wall / peel-depth moves listed earlier plus the timeout row); none has attached False -> True.
Object-door verdict stands: `reverse-stochastic-momentum-index-on-chart` is gated to master's refusal (see the addendum above).
