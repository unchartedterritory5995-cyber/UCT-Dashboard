VERDICT: GO-WITH-NOTES @1eb3ba53e5

Train `origin/integ/pine-train-2026-11-05`, base master 646dca8cbf, tip 1eb3ba53e5 (305 commits).
Reviewer: independent desktop Opus, read-only, 2026-11-05. Detached worktree at the tip, removed afterwards.
Scope: only what the train added (conflict resolutions, train fixes, engine bumps, the W5-T19 squash).

## Blocking
None.

## Checks and results
1. Lane tips. All 40 merged tips in MERGES.md pass `git merge-base --is-ancestor <tip> 1eb3ba53e5`.
   Each merge's ^2 equals the listed tip. W5-T19 (squash) is checked by content in item 5.
2. Conflicted merges (`git show --cc`), each against both parents:
   - 8e89189562 / e8998b069f objectDoorGate.test.js: these are SHAPES appends only. T4, T3 and T2 entries are
     byte-identical to the lanes, and none is changed or dropped. 3d36201d7c also auto-merged T10's t10_* rows
     there.
   - 3d36201d7c rt7PivotRightbars.test.js: T10's `ok === true` is kept for both cases. T7's not-PLAIN check is
     kept on case 1 and is implied by `ok` on case 2. The control is unchanged. Value probe (not a rail): on
     the merged tree, `f(src) => ta.pivotlow(src,3,2)` and `f(src,int len) => ta.pivothigh(src,len,len)` match
     the root-level ta.pivot* bar for bar at two call sites each.
   - 23a49bccef pineRuntimeFrontend.js (T7 x T12): T12's helpers are kept and T7's lowerBlockValue wrapper is
     kept (T12's tally calls land inside lowerBlockValueIn). Both result sites use T7's
     lowerFrameResult(node, fnScope, sink) on T12's single parse, plus T12's resultColour. There is no second
     parse and no dropped line.
   - 3d111836c7 (T12 x T14): mk.paint and mk.falseFallback are independent properties, and both are kept.
   - 1ae355b7a6 (T12 x T15): T12's resultColour declaration plus T15's inlineLines head, then T12's switch colour
     line plus T15's `!loopEndServed`. T15's loop-end path in lowerBlockValueIn lowers the loop body through
     lowerBlockValue with the SAME sink (:9981 and :10062), so T12's paint tally sees the loop's leaves.
     Probe: a block whose else-arm loop yields color.red or na is typed as a colour; one yielding `i * 1.0` is
     not, and its `color =` is withheld by name.
   - a2694d0d2a server.mjs (T7b x T9): metrics.answered(profile, sealed.results) then send sealed.results.
     This is identical to W5-INT server.mjs:209-210. T9's metrics route and canary are intact.
   - e065f82555 serverBundle.rail imports: both import sets are kept.
   Focused run on Node 20.20.2, 12 files: objectDoorGate, rt7, w4FrameHoist, w4FunctionForms,
   w4PaintTyping(+Pane), w4StateKernels, w4V6Bool, p3WsaReviewFixes, runtimeStatementShapes,
   coverageMapDoorCensus.measure, editorStatus. Result: 395 passed, 2 skipped.
   Mutations of the resolved lines (copy, mutate, run, restore by copy): 8 of 10 were killed by the lane rails
   (frame result on the last line, both resultColour sites, loopEndServed, inlineLines, block-sink withdrawal,
   mk.paint, falseFallback). 2 survived; see N1 and N2.
3. Train fixes. All are minimal and each is tied to a real red:
   - 36ea8ec530: census fixture log.info -> ticker.new. T15 serves log.*, as intended. The assertions are
     unchanged and green.
   - be0d43ec5e: timeframes.js is in WATCH_PATTERNS, railway.json and the dockerfile rail. closure --check gives
     70/70 and 0 findings. The tool file is LF. The VITE rail is weaker (N3).
   - b2378df370: L1_ALLOWLIST is emptied, which is strictly tighter. The matcher is proved on a synthetic entry.
     Sandbox: 9/9.
   - ec156578b7: the auth stub takes column_for and warmup_bars. It passes in the 5-file python run below.
   - 65c8ed4128: the door rail now holds only fill/hline (N4).
   - 1eb3ba53e5: gate step 6 adds result_integrity and service_smoke. Both run offline. result_integrity skips
     only when there is no T11 client, and T11 is on the train. The live-smoke exclusion is narrowed to
     tools/pine_runtime_service_smoke.py. The runbook lists timeframes.js. Run: deploy_gate, engine_identity,
     service_smoke, dockerfile, screener_backtest_auth = 81 passed.
   - 1b8b4616d8 capture-queue regen: it was made after 3e2f4ea4e2 added the T15/T17 queue doc (17 references in
     the json). No queue doc lands after it.
4. Engine numbers. 5 -> 17 in merge order: T4 6 (on its branch), T3 7, W3 8, T7 9, T2 10, T9 11, T8 12, T10 13,
   T11 14, T12 15, T13 16, T15 17. Each bump is a 1-line number change plus a doc line, directly after its
   merge. `export const SCRIPT_ENGINE_VERSION = 17` is on one line (scriptEngineVersion.js:102) and is the only
   declaration.
   Lanes with no bump that touch engine files:
   - W4-T1: names a refusal only. The refused set is unchanged.
   - W4-T14: the gate is shut. V6_BOOL_UNMATCHED_CAPTURED = false (:9093). Its test-only opt is set by no product
     caller. All 6 runtimeColumns sites and objectLane build literal opts, and the W5 serverEntry goes through
     runtimeColumns. The no-bump decision is correct; bump when the constant flips.
   - W5-T1/T3/T6/T7/T7b/INT: server entry and digest only.
   - W5-T2: a gate cut, measure-pair neutral per its review.
   - W5-T17: server consumer policy.
   - EDITOR-E2/T18: UI.
   Rails: hostParity expected-digests and service_smoke.json are both at 17. HP-6 compares against
   read_script_engine_version (green). The other script_engine literals in the rails are synthetic identities.
   Separability check, closing the "not separable" caveat in FIXES.md ada54c2a3e: I set the train code's engine
   to 5 (copy/restore) and ran `pine_runtime_host_parity.mjs --host node --out`. 164/166 digests equal master's
   committed engine-5 digests. The 2 that differ are transcendental@forming and transcendental@listing, the
   known report-only V8 cases on Node 20. So no corpus column moved across the whole train, and the 5 -> 17
   regen is identity only.
5. W5-T19 squash. `git merge-tree --write-tree ff346edaac^ f69dc52757` is clean. Its tree differs from
   ff346edaac ONLY by the 2 .gitignore lines (app/dist-server/). There are 0 files under app/dist-server/ at
   the tip and no commit in 646dca8cbf..tip touches that path. git check-ignore confirms the rule.

## Notes (non-blocking)
- N1 1ae355b7a6/23a49bccef pineRuntimeFrontend.js, inline `=>` result
  (`result = lowerFrameResult(inlineNode, ...)`): no rail covers it. Reverting it to lowerResult leaves
  w4FrameHoist green, because every T7 rail uses an indented body. The merge is correct, and the mutant fails
  CLOSED: `hma(x) => ta.wma(2*ta.wma(x,8)-ta.wma(x,16),4)` refuses runtime:history-expression instead of
  serving. Add a one-line-body twin of the hull rail.
- N2 pineRuntimeFrontend.js, the C47 switch-arm colour line (`if (armToks) resultColour = holdsColour(...)`):
  deleting it leaves w4PaintTyping(+Pane) green. This is a T12 lane gap, not a resolution error. The likely
  effect is that a colour chosen by a C47 switch inside a function stays untyped (withheld, fail-closed).
  Add a rail.
- N3 be0d43ec5e serverBundle.rail.test.js (~:124): after `expect(names).toEqual([])`, the line
  `for (const n of names) expect(SERVER_BUNDLE_VITE_NAMES).toContain(n)` cannot run. The old exact-equality
  check against the allowlist is gone, so a stale SERVER_BUNDLE_VITE_NAMES entry is no longer caught. The
  follow-up is recorded: empty the bake-list or rail it.
- N4 65c8ed4128 editorStatus.test.js:797: the door rail dropped plotcandle/plotbar but does not assert their
  ABSENCE from RUNTIME_UNDRAWN_KINDS. editorStatus.js keeps its own 'candles'/'bars' phrases for old documents,
  which is a second copy now that the door no longer holds them. Pin them or derive them (the E2 review N1 is
  still open).
- N5 rt7PivotRightbars.test.js header (lines 13-15) still says "A pivot over values this lane computes is still
  not served ... each case below stops BY NAME". After T10 that is false. The comment is inherited from both
  parents.
- N6 Provenance: no per-lane review for SCORE, W4-T1 or W4-T4 is in dsk/reviews (NEXT-STAGE calls them
  "reviewed GO, held since 11-03"). W4-T13S is W4-T13-SPIKE.md, W2 is W2-R3.md and W3 is W3-S1R2.md, and their
  tips match.
