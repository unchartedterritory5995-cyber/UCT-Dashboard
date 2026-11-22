# Host known-divergence list (2026-11-17, owner decision)

The runtime lane has a committed kill list (`api/data/pine_runtime_killlist.json`). The host lane had none, so a
script whose committed TradingView capture grades DIVERGE on the host (production) lane was still drawn for members.
This unit gives the host lane the same protection: refused BY NAME, `pine:known-divergence`, at every host door.

## The authority

- `app/src/components/chart/engine/hostKnownDivergence.json`: ONE file, imported by the browser bundle
  (`engine/hostKnownDivergence.js`) and read by the server (`api/services/host_known_divergence.py`). Under
  `app/src` because the dev server will not serve a JSON outside the app root; the server reads files there already
  (`scriptEngineVersion.js`).
- GENERATED, never hand-typed: `python tools/vendor_harness/host_divergence.py --write` derives every script, by the
  sha256 of its source, with at least one COMMITTED capture grading DIVERGE in
  `docs/pine/vendor-harness/production/verdicts.json` (the capture's own `source.text`), and writes the queue doc
  `docs/pine/capture-queue-2026-11-17-host-known-divergence.md` (one `engine-gap` row per script, naming the capture
  and the first diverging item). `--check` fails, by script, both ways.
- Each entry: slug, sha256, source path, reason (the capture and what diverges), evidence (every DIVERGE capture with
  `kind` drawn / withheld and its first diverging item; the MATCH and INCONCLUSIVE captures of the same source),
  liftWhen (the engine fix, then a production re-grade leaving none of the named captures DIVERGE).

## The doors

| door | where | how |
|---|---|---|
| member preview | `memberPaneDefinition.js` | refused `pine:known-divergence` before the host lane; the runtime lane is offered it as for any host refusal (its own kill list / allowlist / admission decide) |
| install (served rows) | `nativeRegistry.validateUserDefinitions` | an `ast` row stamped `meta.hostKnownDivergence` by the server is refused with the server's sentence, kept (`killedIds`) |
| served rows | `runtime_definitions.stamp_served` | stamps `meta.hostKnownDivergence` from the row's `host_known_divergence` (derived at read in `user_definitions._row_to_dict` from the stored script); a written-back stamp is dropped |
| save | `user_definitions.save` | `SaveRefused("tree", ..., guard="pine:known-divergence")` before anything is written |
| alerts, sweep, on-demand screens, backtests, scannable stamp | `user_definitions.engine_withheld_reason` | the listed sentence, first; every server lane already asks this one function |

## Instruments

- The measuring suites grade the ENGINE (`src/test-setup.js` turns the list off for every suite but its own rail), so
  the production verdicts keep witnessing the divergence and the list stays derivable (a list that refused its own
  evidence would lift itself).
- The census applies the list in its predicate: `coverage_map.transfers_fully(row, u, src)`,
  `runtime_on_transfers(..., host_listed)`, the ratchet's `transfers` / `wall_of`, `support_loop/remeasure.py`.
  A listed script's runtime ATTACH is still judged by the runtime lane's own kill list.
- REACH (`capability_admission.py report`): a host-drawn DIVERGE of a listed script is reported under
  `refusedByName`, not `hostDiverge`.
- Coverage ratchet, written from the CI census rows of PR #1533's run 44007547152 (`--rows ... --write`): production
  60 -> 59, runtime-on 92 -> 91; both lose `contraction-box-doji-lines` (SPY: 205 lines drawn where TradingView holds 204),
  wall "on the host known-divergence list". `sonarlab-order-blocks` stays (withheld-only, not listed).

## The predicate (coordinator ruling on #1541)

`host_divergence.is_listed`: a script is LISTED when at least one of its committed production DIVERGE captures shows a
DRAWN difference (our side drew something that differs). A capture whose only difference is objects this lane already
withholds BY NAME is incompleteness that is already refused by name, not a wrong drawing, and its plots were not shown
to differ: the script is not listed for it, and its engine-gap queue row stays as work, marked "withheld by name, not
listed". Rail: `test_a_WITHHELD_ONLY_divergence_is_not_listed_and_one_drawn_difference_lists_it` (sonarlab AAPL; the
same capture with one drawn difference lists it).

## What members lose (19 scripts at this number)

`python tools/vendor_harness/host_divergence.py --table` prints all 30 scripts with a production DIVERGE and which are
listed. Listed (19): artemis-oscillator-pro, average-day-range-adr-pivots, contraction-box-doji-lines,
ema-ribbon-trend-filter-strixedge, heat-map-seasons, htf-candle-footprint-cartel-console, htf-liquidity-dashboard-tfo
(RDDT drawn), position-size-calc, rs-rating-fred6724 (NVDA drawn), vold-market-breadth, and the probes
request-realtime-alignment, vw-fmt-tie-readings, vw-int-cast, vw-nvi-pvi, vw-object-gc-a/b/c, vw-other-symbol, vw-time-tf.
Not listed, rows kept as work (11): atr-trailing-stop-by-ceyhun, auto-trendline-dojiemoji,
dual-view-htf-candlestick-patterns-theultimator5, multicator-table, pmax-explorer, sonarlab-order-blocks,
trend-lines-supports-and-resistances, vw-w3n-draw-block-history-a..d.

The member reads: "this script is not drawn: on a captured <symbol> <tf> chart (capture <id>) it draws something that
differs from TradingView: <item>. It is withheld until that is fixed, and comes back once a new comparison against
TradingView matches." The editor status panel files `pine:known-divergence` under its own family, `divergence`
("Differs from TradingView on a captured chart"; spec section 4).

Rails: `tests/test_pine_host_known_divergence.py`, `app/src/components/chart/engine/hostKnownDivergence.test.js`,
`tests/test_queue_dispositions.py` (the doc's 30 engine-gap rows), `editorStatus.families.test.js` (spec = FAMILIES).

## Supply-attributed grade (coordinator ruling on #1541, round 3)

RS Rating was listed on one capture: `rs-rating-fred6724-nvda-1d-2026-11-15`, RS line 1292 of 6997 bars off (up to 1.8%).
Cause, measured: TradingView's RS line is NVDA close / TradingView's own SP:SPX close * 3360 on all 6997 bars (witness
`rs-spx-daily-spy-1d-2026-11-15`), and the SPX our server serves (FMP ^GSPC) differs from TradingView's on exactly 1292
read dates, all before 2023-12-05. The engine is not the cause; the data is.

The grade rule (`tools/vendor_harness/compare.mjs::attributableToSupply`, `vendorHarness/supplyAttribution.js`), only where
the supply symbol has a committed TradingView witness (`requestWitnesses.json` row `witness`): a DIVERGE plot grades
MATCH_SUBSTITUTED when (1) it reads no window (`lookback === 0`), (2) every steady divergence is a value on a date where our
supply differs from the witness, and (3) our side, run again with the witness's values on those dates, agrees on every bar.
The record names the UCT source, the witness and N of M dates. The member-facing grade stays on our supply (L8); the
counterfactual only proves the cause. Rails: `vendorHarness.supplyAttributed.test.js` (the pure rule with its controls; NVDA
real: MATCH_SUBSTITUTED, 1292 bars; control: one mismatch on an agreeing date stays DIVERGE; control: a difference on a
differing date the witness does not explain stays DIVERGE; RDDT: no differing date in its window).

The data itself is a separate data-source decision: `docs/pine/capture-queue-2026-11-17-fmp-gspc-history.md` (1292 sessions,
32 over 0.1% between 1999 and 2008).

## Other-symbol unsettled bars (coordinator ruling on #1541, round 4)

`rs-rating-fred6724-pm-alab-1d-2026-11-16` (22:53:14Z) read SP:SPX 7416.59 on its newest bar (2026-11-16); the committed
witnesses `rs-spx-daily-pm-rddt-1d-2026-11-16` (22:52:03Z) and `rs-spx-daily-pm-alab-1d-2026-11-16` (22:55:39Z) read 7561.67.
TradingView contradicts itself there, so the bar is UNSETTLED: `compare.mjs::unsettledRecord` and the plot loop grade such a
bar INCONCLUSIVE by name (`otherSymbolUnsettled`: symbol, date, every read with its capture and capturedAtUTC) when it is
one of at most 3 value divergences of a zero-lookback plot, our side reproduces the capture's value reading a candidate
value, and another committed witness of that date reads a different value. Rails:
`vendorHarness.otherSymbolUnsettled.test.js`. The timed question is queued NEEDS_LIVE under its own probe
(`rs-spx-afterclose.pine`, `docs/pine/capture-queue-2026-11-17-spx-after-close.md`).

## Push 2: the regenerated verdicts (PR run 44016939154, merged engine-67 tree)

Both lanes regenerated from the PR's own pine-heavy artifacts (production 863 graded, runtime-on 863; master's committed
files held 763: 101 captures committed since were never graded there, one removed). This unit's rules move exactly two
rows: RS Line on `rs-rating-fred6724-nvda-1d-2026-11-15` DIVERGE -> MATCH_SUBSTITUTED (supply-attributed; runtime-on
capture MATCH_SUBSTITUTED, production capture still DIVERGE on its withheld labels) and on
`rs-rating-fred6724-pm-alab-1d-2026-11-16` DIVERGE -> MATCH_SUBSTITUTED (one bar unsettled). Every other moved row is the
merged master tree's own (engine 67), not this unit's rules, which reach only captures with a recorded supply:
production ict-killzone-index-version-rddt, sessions-rddt (INCONCLUSIVE -> MATCH), vw-time-session-spy-1d (x2) INCONCLUSIVE ->
MATCH, vw-time-session-spy-60 ext/rth plot moves; runtime-on the same plus atr-support-and-resistance-spy (MATCH ->
INCONCLUSIVE), inside-bar-boxes-rddt and mtf-key-levels rddt/spy (DIVERGE -> INCONCLUSIVE), volatility-trend-score.

The list re-derived (`host_divergence.py --write`, `--check` AGREES 29/29): rs-rating-fred6724 is off; rs-seed-rsrating
and 19 probes newly graded in the regen are on. Members lose 9 member scripts (artemis-oscillator-pro,
average-day-range-adr-pivots, contraction-box-doji-lines, ema-ribbon-trend-filter-strixedge, heat-map-seasons,
htf-candle-footprint-cartel-console, htf-liquidity-dashboard-tfo, position-size-calc, vold-market-breadth); the other 20
are probes. Ratchet (`--rows` from the same run): production 59, runtime-on 91, both PASS.

## Round 5: re-derived on the engine-68 tree (coordinator, after push 2 went red)

Push 2's verdicts were regenerated on the engine-67 tree (before #1556's box GC). Merged origin/master (engine 68, `60a9774f6a`),
the NUMBER PENDING line resolved onto 68, and everything re-derived on that tree (merge `c7a24b4790`):

- **Verdicts**: pine-heavy dispatched on the merge commit (run 44025598931, `ref` = the SHA, pushed to a refs/remote-tests ref
  so nothing else triggered): production and runtime-on 866 graded each. The licence-held capture CI cannot read
  (`supertrend-kivancozbilgic-rddt-1d-2026-10-02`, licence-held.json) was graded locally on the same tree from the capture
  store (INCONCLUSIVE on both lanes, as on master) and spliced in under its canonical path: 867 per lane. Moves against
  master's committed files: this unit's two RS rows, and master's own (sessions-rddt, vw-time-session-spy x4,
  ict-killzone-index-version-rddt; runtime-on also inside-bar-boxes-rddt and mtf-key-levels rddt/spy DIVERGE -> INCONCLUSIVE,
  volatility-trend-score plot moves). atr-support-and-resistance-spy does NOT move on engine 68.
- **Host list**: `host_divergence --check` AGREES 29/29. **Ratchet** (`--rows` from the same run): production 59, runtime-on 91.
- **The four reds, each decided from the regenerated evidence**:
  - `test_A7_obj_box_is_admitted_with_the_count_at_cap_carve_out`: RAIL CHANGED. On engine 68 the subject
    (inside-bar-boxes-rddt-1d-2026-11-14) is graded "our boxes are withheld by name (objects:count-at-cap ...)", 0 paired;
    "boxes count of boxes held - vendor 52, ours 50" was the engine-66 run that drew 50. The reference no longer supports the
    old reading; the TradingView side (52 records, ids 107..158) and every other assertion stand.
  - `test_DRAW1_every_newly_admitted_object_script_with_a_DIVERGE_capture_is_killed`: RECORD FIXED (kill list). Four
    newly graded probes admitted by obj:table grade DIVERGE (table cells): vw-h5-format-volume (18 vs 34), vw-w3-format-date
    (0 vs 6), vw-w3-loop-helper-text (0 vs 8), vw-w3-str-repeat-length (0 vs 8). Each is killed with its evidence capture.
  - `test_REACH_the_committed_reach_run_is_the_committed_registrys`: RECORD FIXED (reach run). `runs/report.json` re-derived
    by the tool's three steps (input with the cov-e60 cache, `capabilityAdmission.measure.test.js CAPADMIT_MODE=admission`,
    report). The first pass showed three new runtime-lane stops (vw-imp-change-before-reassign 316 bars, vw-w4-series-length
    and its v4 twin, one bar of stdev residue); by the REACH stop rule each is killed, and the re-run's only stop is
    vw-deadband-ticks-brk-a (WITHHELD_WHOLE). 52 runtime-lane MATCH, matchToDiverge empty.
  - `capabilityEvidenceLane.test.js` (supertrend: host): RECORD FIXED (verdicts). The capture was never removed from the
    harness: it is licence-held, so CI's regeneration cannot grade it; it is graded locally and spliced (above).
- **Rails, local on the merged tree with the licence-held store** (one lock hold): test_pine_capability_admission.py 138 passed
  (0 skipped); test_pine_host_known_divergence + test_queue_dispositions 26 passed; capabilityEvidenceLane.test.js 490 passed.
- `pinePresentation.test.js` (RS Rating Inputs tab, red in the dispatched run) is red on master itself (remote-tests run
  44027874723 on refs/heads/master): not this unit.
