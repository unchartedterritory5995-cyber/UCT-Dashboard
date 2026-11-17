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
