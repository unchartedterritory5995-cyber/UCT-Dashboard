# W34-I4 v1-v3 self-referencing state residue (`pine:state` on the run) - evidence (desktop)

**NEXT STEP: final-tip ran; ready-check FAILED only on py rc=1 from the baseline `test_vendor_batch_capture` passed as an extra file. Waiting for the coordinator: re-run final-tip without that file, or rule it accepted. Earlier text:** WAITING FOR THE COORDINATOR'S GO for the heavy jobs, in this order: (1) mutation batch
(`muts.json`, lock `heavy-mut-w34-i4.lock`), (2) measure-pair runtime 0 and 1 (shared base lock
`heavy-mp2.lock`/`heavy-mp3.lock`), (3) merge origin/master again, final-tip FULL, ready-check.**
Light work is done (code, rail, red-on-master, Python parity pytest). Review NO-GO @862ee67295 (B1) FIXED, see below;
needs the small re-review before the heavy steps.

## B1 fix (review `dsk/reviews/W34-I4.md`)
- `guardedSelfRef` accepts ONLY the one-argument `nz(x[k])` (closing `)`). Its bar 0 is 0 under either seed rule.
  The fill form `nz(x[k], fill)` (bar 0 = `fill` if the seed is `na`, 0 if it is 0: unstated, row W34-I4-S1) is no
  longer rewritten and keeps MASTER's answer: a never-forgetting fill form refuses `pine:state` by name (new rail,
  `x = nz(x[1], close) + volume`); a contracting one is master's host `accum`, whose bar 0 stays withheld (`na`) and
  never serves the guessed fill (new rail). Not turned into a new refusal: that would take a served-on-master shape away.
- Seed rail moved to the v4 spelling (`float x = na` / `x := 0.5*close + 0.5*nz(x[1], close)`), where bar-0 `na` is
  stated. Probe R07 relabelled "NOT a control"; row W34-I4-S1 now names the fill form under "unblocks".
- Rail: **16 passed** (`tip-rail-b1.log`). Hand M9 (re-admit the `,` branch): **3 failed | 13 passed**, killed by the
  two fill-form rails and the identity rail (`hand-m9.log`). Hand M1 (slot seed 0) re-run: **1 failed | 15 passed**,
  killed by the v4 seed rail (`hand-m1-b1.log`). Both files restored byte-exact (`cmp` OK).

Branch `feat/pine-w34-i4-state`. Tested-on-master `bde38b0d69` (engine 20). Engine bump needed: **yes**
(served values change on the runtime lane, see "What changed").

## The named shapes
| script (cited by name and sha256 only) | shape | verdict |
|---|---|---|
| `coral-trend-indicator-lazybear__836` (v1, sole blocker; sha256 `d59d2d527b50…e468`) | runtime `pine:state` on `i2`/`i4`/`i6` (lines 19/21/23): a fixed-coefficient one-pole recurrence whose driving input is ANOTHER self-referencing recurrence, every self read `nz(x[1])`. The run handed v1/v2 self-reference to the host Resolver, which folds it to a re-seeded `accum`; its convergence gate (`pine.js::forgetsItsSeed`) counts the nested accumulator's `self` as the outer one's and answers NO | **SERVED** on the runtime lane. `nz` states bar 0 (the history operator's `na` replaced by 0), so it is the reference's arithmetic; no capture owed |
| `thelark-lma-v2-laguerre__1029` (v1; sha256 `b9e87a0145a3…1220`) | runtime `pine:state` on `col` (line 43): a BARE `col[1]` read in a comparison (`col[1] == 1`) | **REFUSED BY NAME** (the host `pine:state` sentence, unchanged). Whether a v1/v2 self-reference starts at `na` or 0, and how `na == 1` reads below v4, is not stated: capture row **W34-I4-S1** (`docs/pine/capture-queue-2026-11-06-w34-i4.md`, probe `tools/visual_conformance/probes/vw-w34-i4-v2-selfref-seed.pine`, `AMEX:SPY 1D` from the listing). Its first runtime wall is still W7 `runtime:request-with-state` (line 41) |

Local spike (licence-held sources read from `$UCT_RESUME/pine-sample`, never committed): on the tip, `probeRuntimeProgram`
on coral is `ok`, 4 outputs, `naTests` 0; laguerre still declines `runtime:request-with-state`.

A first approach (an opt-in `nestedRecurrenceIsInput` on `forgetsItsSeed`) was tried and ABANDONED before commit: it
passed the gate but the re-seeded `accum` then refused coral `budget:lookback` (6 nested x 250 = 1500 > 960), drew a
3 x 250-bar curtain, and its listing pass returned all-`na` for a nested chain. The run has slots, so the shape is
lowered as one.

## What changed (paths under app/src/components/chart/engine/)
- `ast/pineRuntimeFrontend.js`: new exported `v2SelfReferenceStatements(stmts, version)`, called once right after
  `blockStatements` and **not at the C18 object door** (`atObjectDoor`). A top-level single-line `x = E` in a v1 (no
  pragma) or v2 script, where `x` is declared once and never reassigned and EVERY read of `x` in `E` is `nz(x[k])` or
  `nz(x[k], fill)` (`k` a whole literal >= 1, fill free of `x`), is rewritten to `x = na` + `x := E`: the slot form
  the lane already runs for v4. Values are exact from bar 0; off the listing the existing per-run warm-up curtain
  (`runtimeColumns.js::computeOffListing`) decides what is drawn. Anything else returns the SAME array (no change).
- No change to `ast/pine.js`, `ast/interpret.js` (no CARRIED row touched) or `api/services/ast_interpret.py`.
- **Served-value change (engine bump yes):** on the runtime lane every v1/v2 nz-guarded self-reference is now a slot.
  Single recurrences that the host `accum` already admitted were served there with a 250-bar re-seeded window
  (NaN prefix); they now carry values from bar 0, and running totals by hand (`x = nz(x[1]) + volume`) build on the
  pane (drawn from the listing, curtained/refused off it by the existing R-W rule). The host lane, the screen and the
  C18 object door are byte-identical.

## Rails
New `runtime/__tests__/w34I4SelfReference.test.js` (14 tests). Tip: **14 passed** (`tip-rail.log`, 13 at the first
commit; the 14th was added after).
Red on master (`redbase.log`: `pineRuntimeFrontend.js` set to master `bde38b0d69` bytes, rail run, tip bytes restored
byte-exact, `cmp` OK): **9 failed | 4 passed** (13-test version). Red: builds on the runtime lane; the 5,000-bar
differential (off and on the listing); v2 pragma; running total; seed rail `nz(x[1], close)` (master: NaN on bar 0);
the four scope rails (export absent). Green on both (controls): bare read in a comparison and in arithmetic refuse
`pine:state` naming the variable; mixed guarded/bare refuses; the C18 object door refuses `pine:state` on `s2`.
- Differential: a synthetic six-stage cascade (constants of its own, no licence-held text) vs the hand-unrolled
  recurrence over 5,000 bars: max abs diff <= 1e-9 on two outputs, off and on the listing; bar 0 is a value.
- Python parity: `pytest tests/test_ast_self_lag_parity.py tests/test_ast_interpret.py` -> **115 passed**
  (`pytest-parity.log`). No Python file touched.
- Neighbours: `w1BareConditionalHistory` + `w4ClassifierHonesty` -> 28 passed.

## Hand self-check (light, coordinator request, before the batch)
M1 applied by hand (`vm.js` READ_HIST_SLOT before bar 0 answers 0 instead of `na`), rail file run, `vm.js` restored
byte-exact (`cmp` OK, tree clean): **1 failed | 13 passed**, killed by `nz(x[1], fill) takes the fill on bar 0` (pre-B1 wording; see the B1 fix for the v4 rail)
(`hand-m1.log`). The Laguerre refusal is reached by a rail: `a bare self read in a comparison refuses pine:state
naming the variable` (the synthetic `col`-shaped read) passes on the tip and on master.

## Mutation batch (RUN @719fe9275f, heavy-mut.lock, mutate.py copy at --maxWorkers=1 with a <4 GB stop, `mut1.log`)
M0 no-op control SURVIVED. KILLED: M1 (v4 seed rail), M1b (rewrite-shape rail; not equivalent after all), M3, M4,
M5, M6, M7, M8, M9 (3 rails). **M2 (bare read admitted) SURVIVED**: no rail had a bare read followed by `)`. Fixed
with a new rail (`a bare self read closed by a parenthesis ...`, rail now 17 passed); M2 + M0 re-run: M2 KILLED,
M0 SURVIVED (`mut2.log`). 10/10 killed, control survives.

## Mutations (planned table) `docs/pine/evidence/2026-11-05-w34-i4/muts.json`
Command (from app/, under `lock_run LOCK_MUT`): `python $S/mutate.py ../docs/pine/evidence/2026-11-05-w34-i4/muts.json
src/components/chart/engine/runtime/__tests__/w34I4SelfReference.test.js`
| mutation | expected killer |
|---|---|
| M0 no-op control (comment whitespace) | must SURVIVE |
| M1 seed 0 instead of `na` at the history authority (`vm.js` READ_HIST_SLOT before bar 0) | v4 seed rail (hand-run: killed) |
| M1b seed 0 in the rewrite's initialiser (`x = 0` for `x = na`) | expected EQUIVALENT: `x[1]` reads history, never the initialiser (to confirm) |
| M2 bare read admitted (no `nz(` check) | bare-read refusal rails |
| M3 version gate off | v3/v4 rail |
| M4 rewrite at the object door | object-door rail |
| M5 declared-twice admitted / M6 reassigned admitted | scope rail |
| M7 offset 0 admitted | offset-0 rail |
| M9 fill form re-admitted (`,` branch) | fill-form rails + identity rail (hand-run: killed, 3 red) |
| M8 no self read required | identity rail |

## measure-pair (RUN, heavy-mp2.lock, base pine-dsk-mpbase2 = bde38b0d69; `== side tip 274ec257da` / `== side base bde38b0d69`; `mp.log`, `mp-rt0/`, `mp-rt1/`)
| lane | C18 out | C18 probe | harness TOTAL (tip = base) | verdicts.json | census diffs |
|---|---|---|---|---|---|
| 0 | IDENTICAL | IDENTICAL | 336: 93 / 103 / 140 | identical | 6 / 967 |
| 1 | IDENTICAL | IDENTICAL | 336: 111 / 107 / 118 | identical | 3 / 967 |
- Lane 0: all 6 are v5/v6 scripts (the rewrite returns early above v2) whose differing steps carry `pine:timeout`:
  wall-clock peel noise, no I4 code path (ai-supertrend-x-pivot, multi-timeframe-trend-indicator, volatility-coil-edge,
  halftrend-longshort, luxy-momentum, mirage-liquidity-sweep).
- Lane 1: `multi-timeframe-trend-indicator` (v6) timeout noise. `coral-trend-indicator-lazybear`: INTENDED, moves off
  `pine:state`; its NEXT wall is `runtime:withheld-all` (the `Trend` plot's colour changes bar to bar), so it does not
  attach yet. **`earnings-sr-levels-lazybear` (v1): UNINTENDED REGRESSION** - base attached on the runtime lane
  ("Drawn bar by bar", 1 plot); tip declines `runtime:na-test` (2 conditions). Its `x = (c ? a : nz(x[1]))` self-refs
  are now slots, so the two v1 `?:` conditions are lowered to the VM and counted by `naTestsOf`, where the host fold
  had kept them inside a pure column. **LANE STOPPED here pending a coordinator decision (not merged, no final-tip).**

## Regression fix (after measure-pair)
- Cause: `ehl2_mode1` / `ehl2_mode2` (lines 8-9) are `x = (nz(earnings[1]) ? A : nz(x[1]))`: one-argument nz, so the
  rewrite caught them. As slots, their v1 `?:` tests were lowered to the VM `SELECT`; `lowerIr.js::naTestsOf` counts a
  below-v4 `?:` whose test is not a comparison (`nz(...)` is numeric), so the fallback declined `runtime:na-test`.
- Master's value did NOT rest on the unknown seed: the only self read is `nz(x[1])` (0 on bar 0 under either rule) and
  the test is `nz(...)` (never `na`). So the decline was not honest; the matcher is narrowed.
- Fix: `v2SelfReferenceStatements` skips a definition whose right side has a `?` or `iff` (`hasConditional`): the
  statement array is returned unchanged, so such scripts build byte-identically to master. Coral has no conditional in
  `i1`..`i6` and stays rewritten (spike: `ok`, 4 outputs, `naTests` 0).
- Rail: `a self-reference with a ?: or iff is untouched and still builds with no na-test` (synthetic earnings shape,
  both spellings); rail 18 passed. Hand mutants (`muts-cond.json`): M10 conditional rewritten KILLED, M11 `iff`
  rewritten KILLED. Measure-pair must be re-run (coordinator schedules).

## Review N1 closed (delta review @b8d0d09c7f GO-WITH-NOTES)
A `?:` inside a CALLED script function is out of the token scan's sight. Chosen fix (simpler of the two offered): a
definition whose right side calls a function this script defines (`f(...) =>`) is not rewritten (`callsScriptFn`), so
it builds exactly as on master. Rail `a self-reference calling a script function is untouched` (19 passed); hand
mutant M12 (remove the check) KILLED (`muts-fn.json`). The first measure-pair re-run was cancelled while still queued
(never started) and re-queued on the new tip.

## measure-pair RE-RUN on the fixed tip (heavy-mp3.lock, base pine-dsk-mpbase3 = 9a75786663; `== side tip 9d6aca609b`; `mp3.log`, `mp3-rt0/`, `mp3-rt1/`)
| lane | C18 out | C18 probe | harness TOTAL tip / base | census diffs |
|---|---|---|---|---|
| 0 | IDENTICAL | IDENTICAL | 93/103/140 = 93/103/140, verdicts identical | 5 / 967 |
| 1 | IDENTICAL | IDENTICAL | 112/107/117 vs 111/107/118 | 2 / 967 |
- Lane 0: the 5 are v5/v6 `pine:timeout` peel noise (multi-timeframe-trend-indicator, volatility-coil-edge, halftrend-
  longshort, luxy-momentum, mirage-liquidity-sweep); the rewrite returns early above v2.
- Lane 1 census: `coral-trend-indicator-lazybear` INTENDED (`pine:state` -> `runtime:withheld-all`);
  `multi-timeframe-trend-indicator` (v6) timeout noise. **`earnings-sr-levels-lazybear`: no diff (byte-identical to master).**
- Lane 1 harness: `delta-rsi-oscillator-strategy-rddt-1d` INCONCLUSIVE -> MATCH ("computeFor returned no column" on base,
  636 bars agree on tip). NOT I4: the script is `//@version=4`, where `v2SelfReferenceStatements` returns its input
  unchanged; its SPY twin stays INCONCLUSIVE on both sides, and the previous run's tip (`mp-rt1`) had it INCONCLUSIVE.
  Classified as the known delta-rsi wall-clock flake (common brief). 0 unintended.

## final-tip (heavy-final3.lock, FULL, 1 shard, FINAL_TIP_WORKERS=1; out `runs/w34-i4-final/`)
`TIP fe0074144e done`, integrity=ok, totals=ok, errors=0. gate 0, hygiene 0.
- vitest: **Test Files 6 failed | 1376 passed | 28 skipped (1410); Tests 6 failed | 23632 passed | 122 skipped (23760)**.
  All 6 files are on ready-check's baseline allowlist: controlDoorCensus, enumerationSites, vendorHarness,
  settingsScope.rail, pollingSites.rail, usePreferences.additionsOnly (a journal `TodayHome.jsx` setPref site).
- pytest (extra files `test_vendor_batch_capture.py test_ast_self_lag_parity.py test_ast_interpret.py`): 1 failed |
  136 passed. The failure is `test_vendor_batch_capture::test_the_committed_manifest_matches_the_corpus_and_skips_what_is_captured`,
  the common brief's named baseline. Including it made py rc=1.
- **ready-check: `READY-CHECK FAIL: py rc=1`**, solely because that baseline pytest was passed as an extra file
  (ready-check accepts py rc 0/NA only). A re-run without it, or a coordinator ruling, closes it.

## Coral's next wall (not this lane's)
`runtime:withheld-all`: the `Trend` plot's `color = tc` changes per bar (`bfr > nz(bfr[1]) ? green : ...`), and
`memberPaneDefinition.js::runtimeRowColour` withholds a per-bar colour below v4 ("the colour rules of a v1 script have
no capture here": v1-v3 named colours are not witnessed). The values are served; only the colour is withheld. Not
fixable here without guessing the v1 palette. Owner: the RT6/C37 colour lane, after a capture of the v1-v3 colour
constants (`green`/`red`/`blue`/`gray`) on a per-bar `plot(color=)`.

## final-tip: NOT YET RUN
Expected classification: runtime-on census - `coral-trend-indicator-lazybear` moves off `pine:state` (INTENDED); other
v1/v2 scripts with nz-guarded self-references may change runtime walls/values (INTENDED, list them); C18 out/probe
IDENTICAL on both lanes; production lane unchanged except the runtime-probe field.

## Capture queue
`docs/pine/capture-queue-2026-11-06-w34-i4.md` row W34-I4-S1 parses (`evidence_engine.py queue --out` to the run
dir: target `vw-w34-i4-v2-selfref-seed@AMEX:SPY@D`). The committed snapshot
`docs/pine/vendor-harness/capture-queue.json` was ALREADY stale on master (`queue --check` FAIL before this lane), so it
is not regenerated here, to avoid a conflict with other lanes: regenerate once at landing.

Logs: `C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\runs\w34-i4\` (`tip-rail.log`, `redbase.log`,
`pytest-parity.log`, `queue.log`, `abandoned-convergence-opt.diff`).
