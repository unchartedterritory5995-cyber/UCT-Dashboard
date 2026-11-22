# Engine HL: `ta.highest` / `ta.lowest` over a source with `na` holes

Branch `fix/pine-engine-highest-holes`, on `origin/master` `f58532c59d` (engine 54). Engines 55-58, the
calc_bars/format engine and a peer screener fix are in flight; this branch says `SCRIPT_ENGINE_VERSION = 55`
(master + 1) and takes whatever number is next when it merges (the history line says so). Rule: never serve
wrong numbers; exact where witnessed; otherwise withhold by name.

## The witness (S10, 2026-11-15)
Probes written in this repo (`tools/visual_conformance/probes/vw-cs2-holed-highest-{v5,v6,stoch-v6}.pine`),
`x = bar_index % 50 == 30 ? na : close`, `ta.highest(x, 10)` / `ta.lowest(x, 10)`, captured on NYSE:RDDT
(666 bars) and AMEX:SPY (8,507 bars) 1D from the listing (`history.startsAtBar0` true), v5 and v6, alone and
beside a `ta.stoch`. Committed by PR #1316: `tests/fixtures/vendor/harness/vw-cs2-holed-highest-*-2026-11-15.json`.

- TradingView reads the LAST n FINITE values, reaching back past every `na`, and answers on the `na` bar
  itself (RDDT bar 30 keeps 47.7 / 40.88); `na` before bar n-1.
- That rule reproduces all 12 columns (H01 / H02 of six captures) with 0 mismatches. The RESTART rule this
  engine held since 2026-09-08 misses 70 / 68 bars on RDDT and 824 / 1,034 on SPY.
- Engine 57's builder found the same rule (its `s10.py`; S1's `vw-cs1-stoch-p2` P04 column).

## What changed
- **`NA.FINITE`** (`interpret.js`: `NA`, `rolling` -> `rollingFinite`, `FINITE_WINDOW.highest/lowest`;
  `runtime/vm.js` policy `finite`; `api/services/ast_interpret.py`: `NA_FINITE`, `_rolling_finite`,
  `WINDOW_NA`). The last n finite values, FEWER while fewer exist, `na` before bar n-1 and before the first
  finite value, an answer on the `na` bar. One forward pass with a dense buffer of the last n finite values
  (O(N*n) whatever the gaps). The VM keeps a right-aligned ring like a dynamic `skip` window, so a per-bar
  (`series int`) length works too. It differs from SKIP (`sma` & co.) only where fewer than n finite values
  exist: SKIP answers `na`, FINITE the window it has, which is what RESTART already answered over a
  leading warm-up (`ta.highest(ta.sma(close, 20), 10)` from bar 19). On the listing that case is therefore
  unchanged; it is not separately captured for `ta.highest` (S6's Stoch RSI pins it for `ta.stoch`'s
  internal window, engine 57), and no capture in either store moved on it.
- **`window-extreme:left-edge`** (`windowHoleMask` / `window_hole_mask`, off the listing only): from bar n-1,
  a `highest` / `lowest` window of fewer than n finite values reaches bars before this chart's first one,
  where TradingView has values, so it is withheld by name (spread to every root bar within the tree's
  reach; to the end under a call that carries state; masked where a `tf` / `sym` / `ltf` child is
  evaluated). The runtime lane does not decline on it: its own off-listing curtain
  (`runtimeColumns.js::computeOffListing`) withholds start-dependent bars.
- **`highestbars` / `lowestbars` keep RESTART with `naCurrent: 0`** (PART Z). Their only hole witness is the
  same 2026-09-08 probe whose `highest` / `lowest` readings S10 refuted, and no later capture holds a holed
  `highestbars` (S1 / S10's tie probes have no `na`). So the bars where RESTART and a last-n-finite reading
  could name different bars are **withheld by name, `arg-extreme:holed-window`** (`argExtremeHoled` /
  `_arg_extreme_holed`): from bar n-1, a window holding an `na` where this bar is the `na`, or a finite value
  lies before the window's newest `na`, or the chart is off the listing. A clean window, and (from the
  listing) a window whose `na` are a leading warm-up, read the same bars under both rules and are served.
  The runtime lane declines a column carrying the code (`RuntimeRefusal`, the `runtime:chart-clock` pattern)
  and the VM stops by name on its first such window (`vm.js`, restart branch; `winObsN` counts the finite
  values a restart site was handed; `program.windowsFromListing` from `lowerIr.js`).
- **The other `NA.RESTART` users**: none. `grep` finds RESTART only on these four members; `stochPine`'s
  "restarts the window" (house `ta.stoch` kernel, master) and `bindShipped`/`finiteTailStart` (`donchian*`,
  `williamsR`, `cci`, `mfi`) are not `NA.RESTART` and are not Pine `ta.highest` (engine 57 re-points
  `ta.stoch` to `stochPine` with last-n-finite rings).
- **Engine 57's helper**: engine 57 (PR #1294) has no separable last-n-finite helper; its rings live inline in
  `stochPineScan`, `stochPineStep` and `_stoch_pine_scan`, and its per-site withholding is
  `builtinWitnessMask`. Neither is on master, so this branch cannot import them. `rollingFinite` /
  `_rolling_finite` (and `finiteWindowCount`) are the one implementation of the rule here, and
  `windowHoleMask` has `builtinWitnessMask`'s shape (and its carried-calls set, `HOLE_CARRIED_CALLS`, is the
  same list as `WITNESS_CARRIED_CALLS`) so whichever merges second folds the two (open note 1).

## The 2026-09-08 RESTART witness, retired
`tests/fixtures/vendor/divergences.json`: new row **`highest-lowest-restart-after-a-hole`** (status
`corrected`, `measured` naming the six captures, `retires`, `decision`, `correctedIn`), and on
`finite-window-propagates-na-instead-of-skipping-it` a `_highest_lowest_refuted_2026_11_15` note on its
"highest/lowest RESTART" sentence. Both 2026-09-08 fixtures
(`runtime/finite-window-na-policy-by-member-spy-1d-2026-09-08`, `runtime/recurrent-composites-and-window-closure-spy-1d-2026-09-08`)
carry `_refuted_2026_11_15` at the top. Reason: no later capture reproduces its numbers, and the S10
captures (two symbols, two versions, alone and beside a stoch, 0 mismatches) govern by the coordinator's
ruling. Why the 2026-09-08 reading came out RESTART is NOT established; candidates, untested: the 400-bar
study window with its 100-row pre-history offset that probe's provenance records, and the eight other window
calls sharing its script. Its `highestbars` / `lowestbars` readings are kept (not re-measured) and withheld
where they matter (above). `closedTable.json::_functions` note `highestbars_lowestbars_na_and_tie_resolution`
and `pine.js`'s `ta.cmo` comment now say so.

## Blast radius (measured 2026-11-15)
`(?<![\w.])(?:ta\.)?(highest|lowest)\s*\(` over the held capture store (`runs/*/captures`, 16 sessions):
**124 of 565** unique sources, **163 captures**, **439 call sites**; repo `.pine` files: **169 of 865**.
(The brief's 93 / 439 / 121 / 329 / 161 / 839 predate S11 and S12.)

## Vendor harness, both lanes
BEFORE = this tree with `origin/master`'s product files swapped in (`interpret.js`, `pine.js`,
`pineRuntimeFrontend.js`, `closedTable.json`, `vm.js`, `lowerIr.js`, `scriptEngineVersion.js`), restored from
saved copies afterwards (sha256 equal, `git status` clean). Committed fixtures (`tests/fixtures/vendor`, 579
captures) and the licence-held store (all 16 sessions under `runs/*/captures`, 775 captures; verdicts only).
M/D/I per capture id.

| set | lane | before M/D/I | after M/D/I | moves |
|---|---|---|---|---|
| fixtures | production (`RUNTIME_ON=0`) | 159/81/339 | 163/77/339 | `vw-cs2-holed-highest-v5/v6` RDDT + SPY D -> M |
| fixtures | runtime-on (`=1`) | 189/82/308 | 193/78/308 | the same four |
| held store | production | 142/136/497 | 146/132/497 | the same four |
| held store | runtime-on | 159/143/473 | 163/139/473 | the same four |

**0 MATCH -> DIVERGE, 0 new DIVERGE, in every set and lane.** Plot moves (all D -> M, every set and lane):
the 12 holed columns (H01 / H02 of all six S10 captures) and `vw-cs1-stoch-p2` P04 (`ta.highest(x, 10)`
over the same holed source). The two `vw-cs2-holed-highest-stoch-v6` captures stay DIVERGE on H03 only
(`ta.stoch`, engine 57's lane). Value level (bars `na`/value mismatched, summed over plots): the four
v5/v6 captures 138 / 1,858 -> 0, the stoch-v6 pair 769 -> 631 and 10,339 -> 8,481 (the H03 remainder),
`vw-cs1-stoch-p2` 1,343 -> 1,273 (P04 70 -> 0). No other capture moved at value level.

## Census (the four doors and one bind, NYSE:RDDT 1D listing bars, on and off the listing)
Scoped to every source that calls `highest`, `lowest`, `highestbars` or `lowestbars` in any spelling: **288
unique** (repo `.pine` 164, licence-held sample 76, held captures 47, committed fixture 1). Each through the
screen translation, the pane (`strict`), `buildRuntimeIr` (from the listing) and `memberPaneDefinition`,
and the member door's served columns computed on and off the listing; per plot a digest of every value.
- Guard changes at the four doors: **0**. Translations changed: **0**.
- On the listing: **7 plots in 4 sources changed**, all probe plots over the holed source (each now draws
  the 13 hole bars, 644 -> 657, TradingView's values). Every other served column is bit-identical. No code
  named on the listing anywhere.
- Off the listing: **19 sources** name `window-extreme:left-edge`; in **14** of them **21 plots** lose drawn bars
  (1,238 bars in all, 418,530 -> 417,292 drawn; in the other 5 the withheld bars were already blank); every
  other served value is unchanged. Typical source:
  `ta.lowest(ta.rsi(close, 14), 3)` (the RSI's own off-listing warm-up) inside a screen condition; the spread
  is the tree-sum reach (`barIndexMask`'s conservative rule), which carries a flagged bar of a 3-bar window
  as far as the longest window elsewhere in the tree (open note 3).
- `arg-extreme:holed-window`: named by **no** census source, on or off the listing.
- Plots newly empty: 0 (217 -> 217). Dark plots (the listing drawing less than the off-listing replay): 5 -> 5.

## Follow-up: `ta.highestbars` / `ta.lowestbars` over holes (S17, 2026-11-15)
**Witness.** S17 captured the probe `tools/visual_conformance/probes/vw-cs2-holed-highestbars.pine`
(ours, `UCTPROBE_VW_CS2_HOLED_HIGHESTBARS`) on NYSE:RDDT 1D from the listing (666 bars,
`history.startsAtBar0` true); committed here as
`tests/fixtures/vendor/harness/vw-cs2-holed-highestbars-rddt-1d-2026-11-15.json` (byte-equal to the copy on
`data/pine-captures-s13-s14` `7f82fba3f1`). Same source, `x = bar_index % 50 == 30 ? na : close`;
`ta.highestbars(x, 10)` / `ta.lowestbars(x, 10)` plus the same two over `close` (no hole) and the
`highest` / `lowest` controls.

- TradingView uses the LAST 10 FINITE values (the same window as `highest` / `lowest`), ties to the older
  bar, and counts the offset in **BARS**: on the hole bar 30 it answers -1 / -10 (bars 20..29), and an
  offset reaches -10 inside a 10-value window that spans 11 bars (bar 31 lowestbars -10, bar 37 -10).
- That rule reproduces all four offset columns with 0 mismatches. 130 of the 666 bars hold the hole in their
  window: #1332 withheld every one of them (`arg-extreme:holed-window`), master answered 0 on the hole bar and
  a restarted window after it.

**Change.** `FINITE_WINDOW.highestbars/lowestbars` are `na: NA.FINITE, arg: true` (both lanes, the VM,
Python `WINDOW_NA` + `WINDOW_ARG`). `rollingFinite` / `_rolling_finite` keep each kept value's bar beside it
and, for an `arg` member, turn `windowArgExtreme`'s dense distance into `i - bar`; the VM's `finite` ring is
`2 * span` cells for an `arg` member (values, then their bars), one array so resume / rollback / the state
encoder carry both halves. With no member left on it, `NA.RESTART`, `naCurrent` / `WINDOW_NA_CURRENT`,
`argExtremeHoled` / `_arg_extreme_holed`, `ARG_EXTREME_HOLED`, its sentence, the runtime refusal and the VM's
stop (and `program.windowsFromListing`) are deleted. `windowHoleMask` now asks one question of all four
members: off the listing, a window of fewer than n finite values is `window-extreme:left-edge` (its sentence
names the four functions); from the listing it returns null.

**Rails.** `engineHlHoles.test.js` (new block): the capture is what it says (plots, the signature values,
130 holed bars); the rule over its bars, 0 mismatches on all four columns; the host lane draws all eight
plots exactly with nothing withheld; the runtime lane draws the four offset columns exactly; all four doors
admit the probe and the member door serves the columns; synthetic offsets in bars past a hole and the tie;
off the listing a short `highestbars` window withheld by name and the later bars equal the listing's; the
code gone from every export. `runtime/__tests__/finiteWindow.test.js`: the VM's `arg` ring over a gappy
series, with a non-vacuity check that an offset reaches past the span. `tests/test_engine_hl_holes.py`: the
Python lane against the capture (4 columns, 0 mismatches), the synthetic offsets, the removed names.
Re-pinned: `finiteWindowNa.test.js` (four policies; an offset, not 0, on the `na` bar),
`test_ast_bounded_state.py` (`highestbars` and `highest` blank on the same bars again),
`test_ast_period_anchor_parity.py` (the code list). `divergences.json`: new row
`highestbars-lowestbars-restart-and-zero-on-the-na-bar` (`corrected`); the S10 row's and both 2026-09-08
fixtures' notes and `closedTable.json`'s resolution say so.

**Mutants (S17 follow-up).** Copy aside, mutate, the focused rails, restore from the copy, byte-equal checked: 7 of 7 killed. JS: the `arg` answer as the dense distance (columnar `rollingFinite`), the same in the VM, the VM's bar ring not shifted, `highestbars` dropped from `windowHoleMask`'s calls. Python: the `arg` answer as the dense distance, the bar list not popped, `highestbars` dropped from `_HOLE_WINDOW_CALLS`.

**Tests run (S17 follow-up).** vitest `engineHlHoles` (23), `finiteWindowNa`, runtime `finiteWindow` (55), `w4SeriesLength`, `pureWindowInFunction`, `honestySweep`, `dynamicHistoryOffset` (231 in all), `vendorTruth`, `periodAnchorParity`, `interpret.test` (252); pytest `test_engine_hl_holes`, `test_ast_bounded_state`, `test_ast_period_anchor_parity` (187), `test_vendor_truth` (161), the AST conformance rails. Gate section 8 locally: 535 passed, 1 failed, `test_pine_runtime_service_smoke::test_committed_fixture_is_whole...` (`service_smoke.json` records engine 54, this branch says 55): the re-record and the host-parity digests (`tools/pine_runtime_host_parity.mjs --check` is RED on every case for the same number) belong to the merge, at the number the coordinator assigns.

## Rails
- `app/src/components/chart/engine/ast/engineHlHoles.test.js`: the six committed captures (the rule over
  their bars, 0 mismatches, RESTART not); the host lane, the runtime lane and the member door each draw all
  12 columns exactly with nothing withheld; the four doors admit the probes; synthetic shapes (past a hole,
  on the hole, fewer while fewer exist, the n-1 gate, a clean source unchanged); off the listing a short
  window withheld by name and the later bars equal the listing's; `argExtremeHoled` bar by bar (on and off
  the listing); a holed `highestbars` withheld by name on the host lane and at the member door, the runtime
  door and run declining by the same code, a clean one drawn equal on both lanes; a warm-up `lowestbars`
  served equal on both lanes; a comparison over a holed `highestbars` withheld, not a confident 1.
- `tests/test_engine_hl_holes.py`: the Python twin (the 12 columns, the mask, the codes).
- Pins updated, each with its reason: `__tests__/finiteWindowNa.test.js` (five policies; FINITE shapes;
  `highest` on the hole bar), `runtime/__tests__/finiteWindow.test.js` (the VM's FINITE window),
  `tests/test_ast_bounded_state.py` (the raw table keeps PART Z's asymmetry; the served columns withhold the
  head by name), `tests/test_ast_period_anchor_parity.py` and `ast/periodAnchorParity.test.js` (the new codes
  are exercised by this engine's rails), `__tests__/vendorHarness/ourSide.js` (the note names "a window over
  `na` gaps", not `time(<timeframe>)`).

## Mutants
PENDING (heavy lock held for engine 55; see the report).

## Tests run
PENDING beyond the focused set: `engineHlHoles` + `finiteWindowNa` + runtime `finiteWindow` + `vendorTruth`
(119 tests green), and every `tests/test_ast_*.py` plus `test_engine_hl_holes`, `test_vendor_truth`,
`test_atr_pine_parity`, `test_vendor_parity_*`, `test_language_coverage`, `test_call_expansions_parity`
green, one file at a time. These fail on `origin/master` too and are not this engine's:
`test_single_authority_rails` (2: `api/flow_exposure_history.py` moving average, RS lookbacks),
`test_c45_withheld_doors` (2), `test_indicator_golden` (1).

## Evidence ledger
PENDING (`python -m tools.vendor_harness.evidence_engine regrade`, local measurement only; the ledger file is
not committed, coordinator rule 2026-11-15).

## Open notes
1. **Merge with engine 57.** `windowHoleMask` and engine 57's `builtinWitnessMask` are one shape (per-site
   codes, the same reach rule, the same carried-calls set); whichever merges second folds them into one
   walk, and engine 57's `stochPine` rings could call `rollingFinite`'s rule. Engine 56 also edits
   `withheldReadMask`, `ourSide.js` and `divergences.json` (the arg-extreme tie row this branch does not touch);
   its per-bar harness grading (`withheldBarsReport`, INCONCLUSIVE with a count) would grade a bar this
   engine withholds as "not compared" rather than as a value; on master a partly withheld plot is graded on
   its values, and the measurement above shows no capture reaching either code.
2. **Numbering.** `SCRIPT_ENGINE_VERSION = 55` here; at the merge take master + 1, rewrite the history line's
   number, regenerate the host-parity digests (`node tools/pine_runtime_host_parity.mjs --write`) and regrade.
3. **Reach.** The withholding spreads by `maxLookback(tree) - maxLookback(site)` (the rule `barIndexMask`,
   `historyReadMask` and engine 57 use). It is an upper bound: a flagged bar of `ta.lowest(rsi, 3)` withholds
   up to ~200 later bars of a screen condition whose OTHER branch reads `ta.sma(close, 200)`. A path-sum
   reach would withhold fewer; not changed here.
4. **Not captured.** The short-window (warm-up) case of `ta.highest` from the listing (served as before, the
   same values RESTART drew); a probe (`ta.highest(ta.sma(close, 20), 10)` from the listing) settles it.
   (`ta.highestbars` / `ta.lowestbars` over a holed source: S17 settled them, the follow-up above.)
