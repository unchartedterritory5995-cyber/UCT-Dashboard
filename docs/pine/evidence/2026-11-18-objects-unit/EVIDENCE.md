# Parity unit 1 (`objects`): the attached-dirty rows asked of the runtime lane, and the run half that draws what the host program lost (2026-11-18)

Branch `feat/parity-objects` (PR #1824), on master `f428ec1dc5` (`SCRIPT_ENGINE_VERSION = 75`). The unit is U-OBJ of
the measured roadmap (`docs/pine/PARITY-ROADMAP-2026-11-18.md`, PR #1766, section 5 and build order step 1): 45 sole
scripts and the `known-lists` unit's 10. The roadmap's own warning: 44 servable is an UPPER BOUND, because the census
never offered the runtime lane to an `attached-dirty` row. This document measures that first (sections 1-2), then
builds the change the measurement ranks first (sections 3-4), under the coordinator's two conditions (section 5).

Scripts are named by corpus key only. Licence-held sources and captures stay on the PC; nothing here quotes a source
line.

## Answer first

- **The real size of the unit is small, and the drawing calls are not what stops it.** Once the runtime lane builds a
  script it makes its drawings; it builds 14 of the 55 (`objects` + `known-lists`). The other 41 stop on the value
  lane first: `request.*` of another context 17, built-ins 8, dynamic history 5, conditional history 4, statement
  shapes 3, five single walls (section 2). 33 of the 55 also need a capability the registry does not admit
  (`request-other` 24).
- **Built: the run half draws what the host program lost** (section 3). Engine 53's run half already ran these
  scripts beside the host's plots, but engine 54's object rail refused every drawing made at a call the host program
  lost unless a per-script evidence record admitted it, and none exists: so the lost drawings, the ones the run half
  exists for, were never drawn (10 run halves minted, 10 refused at the bind). Now, when the host document draws an
  object program of its own, a drawing the run makes at a call that program lost is drawn, on the run half's own
  gates (the same ones a runtime document's drawings answer to); every site the host draws is still compared object
  for object, the plots never leave the host lane, and a host with no object program (a lost removal) is unchanged.
- **Both conditions hold by construction** (sections 4 and 5). The saved document stays the HOST document
  (`compute.kind: 'ast'`, its formula half byte for byte the pane-off member's), so alerts, scans, backtests and
  `specialize` read the host formula as before. Every plot column the pane draws is the host's, on every bar, on and
  off the listing: 0 host-drawn bars blank on every plot of every committed capture. The first cut (this PR's first
  push, a RUNTIME document) is withdrawn: it would have given its server lanes to the dark
  `PINE_RUNTIME_SERVER_STAGE`, and off the listing its run left 256 of SPY's 1,800 host-drawn bars blank on both of
  `atr-support-and-resistance`'s plots.
- **Served at the bind 0 -> 4** with every script graded (`atr-support-and-resistance` 20 boxes + 20 lines,
  `auto-trendlines-by-pivots` 52 labels + 16 lines, `intraday-power-3-visual`, `support-resistance-fibonacci-
  retracement`); **0 -> 2 with production's lists** (the last two wait on `request-other`, section 11).
- **Graded** (section 6): both lanes byte-identical before and after on all 915 committed + 58 licence-held captures
  (the runtime-on lane already grades every run half's drawings, which is the evidence: the four scripts' 7 captures
  all MATCH there).
- **Census** (section 8): served **275 -> 277** of 679; runtime-on 285 -> 289; host-only 220 unchanged; production
  census rows unchanged at step 0; coverage ratchet runtime-on 91 -> 92.
- **Q-OBJ1-3 withdrawn** (0 of 6 capturable) and ruled never-serve (`other-feeds`) by name on the roadmap (section
  10). **Engine number**: 77 (#1824, the engine 77 train); its ledger line was rewritten for this form (the translation is unchanged; section 9).

## 1. The probe: the attached-dirty rows asked of the runtime lane

`builder/memberPane/objectsUnitProbe.measure.test.js` (opt-in; `OBJECTS_PROBE_IN` / `OBJECTS_PROBE_OUT`) asks the
member door, per script, with the flags production runs (objects-only pane armed, runtime pane on for the member),
twice: with the test grant (every script graded: the runtime lane's own answer) and with production's lists (the
committed kill list and graded allowlist latched, capability admission on, the server's verdict for THIS source
latched under the hash of the text as the door reads it; the first cut latched the input's universal-newline hash, so
11 CRLF reference sources found no verdict). Each answer is the door's document, its object loss and its run half
(engine 53, `hostPartialRunHalf`: minted, or declined by code), and the run half BOUND once, as the binder binds it
(`registry.computeFor`), on the census's own reference bars (the RDDT 1D capture from the listing, a closed newest
bar), by master's object rail and by this unit's. The door is master's in both columns (this unit does not change
it); the drawing build alone is `probeRuntimeProgram(source, {objectsInRun: true})`.

| unit | script | admission (committed registry) | host object program | the door (unchanged) | bind, master's rail | bind, the lost-drawings rule | production (lists + admission), the rule | the drawing build alone |
|---|---|---|---|---|---|---|---|---|
| objects | `builtin:multi-time-period-charts` | not: enum, method-def, request-other | partial, 35 of 36 ops lost | host; run half declined `runtime:call-undeclared-builtin-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:call-undeclared-builtin-state` line 101 `timeframe.change` |
| objects | `committed:atr-support-and-resistance` | admitted | partial, 24 of 27 ops lost | run half minted | `refused` `run-half:no-comparable-objects` | **served** (20 box, 20 line) | **served** (20 box, 20 line) | builds (9 drawing ops) |
| objects | `committed:atr-trailing-stop-by-ceyhun` | admitted (closed bars) | partial, 2 of 4 ops lost | run half minted | `refused` `run-half:no-comparable-objects` | `refused` `run-half:no-comparable-objects` | `refused` `run-half:no-comparable-objects` | builds (3 drawing ops) |
| objects | `committed:auto-trendline-dojiemoji` | admitted | removes, 4 of 10 ops lost | host; run half declined `runtime:statement` | - | - | not minted: `runtime:statement` | `runtime:statement` line 106 `ta.pivothigh` |
| objects | `committed:dual-view-htf-candlestick-patterns-theultimator5` | not: request-other | removes, 68 of 94 ops lost | host; run half declined `run-half:size` | - | - | not minted: `runtime:not-yet-graded` | builds (27 drawing ops) |
| objects | `committed:ict-killzone-index-version` | admitted | partial, 12 of 36 ops lost | host; run half declined `runtime:conditional-history` | - | - | not minted: `runtime:conditional-history` | `runtime:conditional-history` line 65 `[` |
| objects | `committed:liquidity-heatmap-nephew-sam` | not: request-other | partial, 14 of 16 ops lost | host; run half declined `runtime:request` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request` line 132 `request.security` |
| objects | `committed:multi-timeframe-supply-demand-zones` | not: request-other | partial, 4 of 13 ops lost | host; run half declined `runtime:request` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request` line 240 `request.security` |
| objects | `committed:multicator-table` | not: obj:polyline | removes, 50 of 290 ops lost | host; run half declined `pine:function` | - | - | not minted: `runtime:not-yet-graded` | `pine:function` line 310 `ta.dmi` |
| objects | `committed:sector-rotation` | not: request-other | partial, 6 of 7 ops lost | host; run half declined `pine:request` | - | - | not minted: `runtime:not-yet-graded` | `pine:request` line 26 `request.security` |
| objects | `committed:supertrend-explorer` (never-serve: other-feeds, ruled by name) | not: request-other | partial, 1 of 2 ops lost | host; run half declined `runtime:request-with-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request-with-state` line 118 `security` |
| objects | `committed:trend-lines-supports-and-resistances` | not: method-def | partial, 0 of 6 ops lost | host; run half declined `pine:builtin` | - | - | not minted: `runtime:not-yet-graded` | `pine:builtin` line 79 `alert.freq_once_per_bar` |
| objects | `committed:vdubus-pattern-gen-v2-restored-refined` | not: obj:linefill | partial, 1 of 151 ops lost | host; run half declined `run-half:size` | - | - | not minted: `runtime:not-yet-graded` | builds (17 drawing ops) |
| objects | `committed:volume-profile` | admitted (closed bars) | partial, 14 of 17 ops lost | run half minted | `refused` `runtime:limit` | `refused` `runtime:limit` | `refused` `runtime:limit` | builds (7 drawing ops) |
| objects | `reference:auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr` | admitted (closed bars) | partial, 8 of 10 ops lost | run half minted | `refused` `run-half:uncompared-site` | **served** (52 label, 16 line) | **served** (52 label, 16 line) | builds (4 drawing ops) |
| objects | `reference:cobra039s-crypto-market-visualizer` | not: method-def, request-other | partial, 5 of 8 ops lost | host; run half declined `runtime:request-with-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request-with-state` line 100 `request.security` |
| objects | `reference:crypto-correlation-matrix` | not: request-other | partial, 7 of 11 ops lost | host; run half declined `runtime:request-with-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request-with-state` line 81 `request.security` |
| objects | `reference:cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new` | not: request-other | partial, 16 of 26 ops lost | host; run half declined `lower-tf:lookahead` | - | - | not minted: `runtime:not-yet-graded` | `lower-tf:lookahead` line 133 `request.security` |
| objects | `reference:custom-screener-with-alerts` (never-serve: other-feeds, ruled by name) | not: collections:matrix, request-other | partial, 1 of 9 ops lost | host; run half declined `runtime:request` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request` line 230 `request.security` |
| objects | `reference:dot-dynamics` | admitted | clean, 0 of 0 ops lost, 1 paint(s) withheld | host; run half not asked (no loss) | - | - | - | `pine:window` line 120 `ma1` |
| objects | `reference:dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt` | admitted (closed bars) | partial, 1 of 21 ops lost | host; run half declined `pine:function` | - | - | not minted: `pine:function` | `pine:function` line 148 `ta.dmi` |
| objects | `reference:dynamic-higher-timeframe-fibonacci-pivot-points` | not: request-other | partial, 8 of 24 ops lost | host; run half declined `pine:request` | - | - | not minted: `runtime:not-yet-graded` | `pine:request` line 42 `security` |
| objects | `reference:dynamic-linear-regression-channels` | not: obj:linefill | partial, 11 of 16 ops lost | host; run half declined `runtime:history-dynamic-offset` | - | - | not minted: `runtime:not-yet-graded` | `runtime:history-dynamic-offset` line 34 `calcSlope` |
| objects | `reference:fabio-style-order-flow-lvn-volumeprofile-fvgob-liquiditygrabs-dashboar` | admitted (closed bars) | removes, 30 of 32 ops lost | run half minted | `refused` `runtime:objects-stopped` | `refused` `runtime:objects-stopped` | `refused` `runtime:objects-stopped` | builds (9 drawing ops) |
| objects | `reference:fibonacci-extention-retracment-pivot-points-by-dgt` | admitted (closed bars) | partial, 1534 of 1580 ops lost | host; run half declined `runtime:history-dynamic-offset` | - | - | not minted: `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 169 `pivots` |
| objects | `reference:fourier-extrapolator-of-price-w-projection-forecast-loxx` | admitted (closed bars) | partial, 6 of 20 ops lost | run half minted | `refused` `runtime:limit` | `refused` `runtime:limit` | `refused` `runtime:limit` | builds (7 drawing ops) |
| objects | `reference:intraday-power-3-visual` | not: request-other | partial, 5 of 14 ops lost | run half minted | `refused` `run-half:no-comparable-objects` | **served** (no drawing on these bars) | not minted: `runtime:not-yet-graded` | builds (9 drawing ops) |
| objects | `reference:linear-regression-channel-curve-slope-by-dgt` | admitted (closed bars) | partial, 126 of 184 ops lost | host; run half declined `runtime:history-dynamic-offset` | - | - | not minted: `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 133 `f_calcSlope` |
| objects | `reference:liquidity-heatmap-swiftedge` | admitted | partial, 10 of 14 ops lost | run half minted | `refused` `run-half:no-comparable-objects` | `refused` `run-half:no-comparable-objects` | `refused` `run-half:no-comparable-objects` | builds (7 drawing ops) |
| objects | `reference:liquidity-sniper-pro` | not: request-other | partial, 25 of 33 ops lost | host; run half declined `runtime:conditional-history` | - | - | not minted: `runtime:not-yet-graded` | `runtime:conditional-history` line 42 `and` |
| objects | `reference:liquidity-swings-luxalgo` | not: request-other | partial, 30 of 32 ops lost | host; run half declined `runtime:request-with-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request-with-state` line 41 `request.security_lower_tf` |
| objects | `reference:machine-learning-random-forest-strategy-gainzalgo` | not: collections:matrix, method-def | partial, 28 of 47 ops lost | host; run half declined `pine:function` | - | - | not minted: `runtime:not-yet-graded` | `pine:function` line 294 `ta.dmi` |
| objects | `reference:market-trend-levels-detector-bigbeluga` | admitted (closed bars) | partial, 19 of 19 ops lost | run half minted | `refused` `runtime:failed` | `refused` `runtime:failed` | `refused` `runtime:failed` | builds (9 drawing ops) |
| objects | `reference:onchart-wavetrend-divergence-with-pivots` | not: request-other | partial, 2 of 2 ops lost | host; run half declined `runtime:request-with-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request-with-state` line 280 `security` |
| objects | `reference:range-filter-x-hull-suite` | not: request-other | partial, 6 of 17 ops lost, 2 paint(s) withheld | host; run half declined `runtime:request` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request` line 97 `request.security` |
| objects | `reference:relative-strength-index-divergences-libertus` | admitted | clean, 0 of 6 ops lost, 2 paint(s) withheld | host; run half not asked (no loss) | - | - | - | `runtime:object-op` line 74 `label.new` |
| objects | `reference:rsi-support-resistance-by-dgt` | not: obj:linefill | removes, 6 of 55 ops lost | host; run half declined `runtime:conditional-history` | - | - | not minted: `runtime:not-yet-graded` | `runtime:conditional-history` line 133 `crossover_overbought` |
| objects | `reference:screener-for-40-instruments` (never-serve: other-feeds, ruled by name) | not: request-other | partial, 3 of 7 ops lost | host; run half declined `pine:request` | - | - | not minted: `runtime:not-yet-graded` | `pine:request` line 115 `request.security` |
| objects | `reference:smart-money-concepts-probability-expo` | not: collections:matrix, obj:linefill | partial, 20 of 37 ops lost | host; run half declined `pine:builtin` | - | - | not minted: `runtime:not-yet-graded` | `pine:builtin` line 39 `chart.bg_color` |
| objects | `reference:support-and-resistance-step-4` | admitted | partial, 26 of 30 ops lost | host; run half declined `runtime:statement` | - | - | not minted: `runtime:statement` | `runtime:statement` line 151 `label` |
| objects | `reference:support-and-resistance` | not: varip | partial, 70 of 94 ops lost | host; run half declined `runtime:history-dynamic-offset` | - | - | not minted: `runtime:not-yet-graded` | `runtime:history-dynamic-offset` line 81 `Covariance` |
| objects | `reference:support-resistance-fibonacci-retracement` | not: request-other | partial, 7 of 15 ops lost | run half minted | `refused` `run-half:uncompared-site` | **served** (7 label, 7 line) | not minted: `runtime:not-yet-graded` | builds (8 drawing ops) |
| objects | `reference:trend-channels-with-liquidity-breaks-chartprime` | not: obj:linefill | partial, 54 of 132 ops lost | host; run half declined `runtime:statement` | - | - | not minted: `runtime:not-yet-graded` | `runtime:statement` line 155 `and` |
| objects | `reference:trend-direction-helper` | admitted | partial, 10 of 18 ops lost | host; run half declined `runtime:history-dynamic-offset` | - | - | not minted: `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 84 `wpr` |
| objects | `reference:zig-zag-channels-luxalgo` | admitted (closed bars) | partial, 9 of 11 ops lost | host; run half declined `runtime:history-expression` | - | - | not minted: `runtime:history-expression` | `runtime:history-expression` line 103 `[` |
| known-lists | `committed:artemis-oscillator-pro` | not: request-other | partial, 5 of 38 ops lost | host; run half declined `runtime:call-windowed-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:call-windowed-state` line 281 `ta.percentile_linear_interpolation` |
| known-lists | `committed:average-day-range-adr-pivots` | not: request-other | partial, 7 of 123 ops lost | host; run half declined `runtime:request` | - | - | not minted: `runtime:not-yet-graded` | `runtime:request` line 153 `request.security` |
| known-lists | `committed:contraction-box-doji-lines` | killed | clean, 0 of 2 ops lost | host; run half not asked (no loss) | - | - | - | builds (2 drawing ops) |
| known-lists | `committed:ema-ribbon-trend-filter-strixedge` | not: request-other | partial, 11 of 49 ops lost | host; run half declined `lower-tf:store-unmeasured` | - | - | not minted: `runtime:not-yet-graded` | `lower-tf:store-unmeasured` line 156 `request.security` |
| known-lists | `committed:heat-map-seasons` | killed | clean, 0 of 7 ops lost, 1 paint(s) withheld | host; run half not asked (no loss) | - | - | - | `runtime:call-undeclared-builtin-state` line 30 `ta.correlation` |
| known-lists | `committed:htf-candle-footprint-cartel-console` | killed | partial, 17 of 26 ops lost | host; run half declined `runtime:killed` | - | - | not minted: `runtime:killed` | `pine:function` line 126 `color` |
| known-lists | `committed:htf-liquidity-dashboard-tfo` | not: request-other | partial, 147 of 215 ops lost | host; run half declined `pine:request` | - | - | not minted: `runtime:not-yet-graded` | `pine:request` line 199 `request.security` |
| known-lists | `committed:momentum-based-zigzag` | killed | partial, 2 of 2 ops lost | refused `pine:timeout` | - | - | - | `runtime:conditional-history` line 89 `?` |
| known-lists | `committed:position-size-calc` | not: request-other | partial, 1 of 11 ops lost | host; run half declined `runtime:request` | - | - | not minted: `runtime:not-yet-graded` | builds (2 drawing ops) |
| known-lists | `committed:vold-market-breadth` | not: request-other | partial, 2 of 3 ops lost | host; run half declined `runtime:input-state` | - | - | not minted: `runtime:not-yet-graded` | `runtime:input-state` line 7 `input` |

**What it says.**

- **Before (master's rail), the run half serves nothing in this unit.** 10 scripts mint a run half under the grant;
  every one is refused at the bind: `run-half:no-comparable-objects` 4, `run-half:uncompared-site` 2,
  `runtime:limit` 2, `runtime:objects-stopped` 1, `runtime:failed` 1. A member gets the host's partial picture,
  with its "N of M drawing elements" disclosure.
- **After (the lost-drawings rule), 4 of the 10 are served** under the grant, each with the drawings its host lost:
  `atr-support-and-resistance` (20 boxes, 20 lines), `auto-trendlines-by-pivots` (52 labels, 16 lines: the
  "16 lines from a lost call" engine 54's review refused), `support-resistance-fibonacci-retracement` (7 labels, 7
  lines) and `intraday-power-3-visual` (served; it draws on an intraday chart, none on this daily reference). With
  production's lists the first two are served and the last two are not minted (`runtime:not-yet-graded`: not
  admitted, `request-other`). The other 6 keep the host picture by name: the run stops at its per-bar step limit
  (`runtime:limit`: `volume-profile`, `fourier-extrapolator`), the host carries NO object program
  (`run-half:no-comparable-objects`: `atr-trailing-stop-by-ceyhun` and `liquidity-heatmap-swiftedge` lost every
  drawing; the rule leaves such a host on the evidence hook), `runtime:objects-stopped` (`fabio-style`, a `removes`
  host) and `runtime:failed` (`market-trend-levels-detector`).
- **Admission is the larger wall.** 18 of the 55 are admitted (all `objects` scripts). 33 use a capability the
  registry does not admit (`request-other` 24, `obj:linefill` 5, `method-def` 4, `collections:matrix` 3, `enum`,
  `obj:polyline`, `varip` 1 each; a script can need several) and 4 are on the runtime kill list (all `known-lists`).
- The probe's production column now latches each source's verdict under the hash of its text as the door reads it;
  the first cut's 11 CRLF reference sources that found no verdict are answered.

## 2. The real size of the unit: grouped by the missing behaviour

Each script under its FIRST wall on the runtime lane (the probe's grant column), with what it also needs to be
admitted. (A script freed of its first wall may hold another behind it; the census peel is the full list.)

| missing behaviour | first wall (runtime lane) | scripts | admitted | they also need |
|---|---|---:|---:|---|
| **nothing: the run half draws the drawings the host lost** | (served by section 3) | 4 | 2 | `request-other` 2 |
| the run stops at its per-bar step limit | `runtime:limit` (205,101 steps on the last bar against 200,000, `volume-profile`) | 2 | 2 | none |
| the host lost EVERY drawing, so it carries no object program | `run-half:no-comparable-objects` (the Part 2 evidence hook) | 2 | 2 | none |
| the run fails / stops its drawings | `runtime:failed` 1, `runtime:objects-stopped` 1 (a `removes` host) | 2 | 2 | none |
| the document with its run half is over the store's 64 KiB | `run-half:size` | 2 | 0 | `obj:linefill` 1, `request-other` 1 |
| `request.*` of another symbol or timeframe | `runtime:request` 6, `runtime:request-with-state` 5, `pine:request` 4, `lower-tf:*` 2 | 17 | 0 | `request-other` (all 17); 4 are never-serve (other feeds: `cobra039s-crypto-market-visualizer`, and the three ruled by name in section 10) |
| history of a window sized while the bar runs | `runtime:history-dynamic-offset` | 5 | 3 | `obj:linefill` 1, `varip` 1 |
| built-ins the grammar does not declare | `pine:function` 4 (`ta.dmi` 3, `color` 1), `pine:builtin` 2 (`alert.freq_once_per_bar`, `chart.bg_color`), `runtime:call-undeclared-builtin-state` 2 (`timeframe.change`, `ta.correlation`) | 8 | 1 | `request-other`, `method-def`, `matrix`, `polyline`, `linefill`, `enum`; two killed |
| history of a value computed only on some bars | `runtime:conditional-history` | 4 | 1 | `request-other` 1, `obj:linefill` 1; one killed |
| statement shapes the front end does not read | `runtime:statement` (`ta.pivothigh` with a non-literal `rightbars`; a call statement with no binding; a wrapped `and`) | 3 | 2 | `obj:linefill` 1 |
| a drawing call inside one arm of `?:` | `runtime:object-op` | 1 | 1 | none |
| history over an expression holding a mutable value | `runtime:history-expression` | 1 | 1 | none |
| a window length that is not a whole number (`99 / 2`) | `pine:window` | 1 | 1 | none |
| a stateful built-in over a window / an input read as state | `runtime:call-windowed-state` 1, `runtime:input-state` 1 | 2 | 0 | `request-other` |
| killed, its host program clean | `runtime:killed` (`contraction-box-doji-lines`) | 1 | 0 | its kill entry's `liftWhen` |

**The real size.** Of the roadmap's servable sole scripts (44, 41 after the section 10 ruling), 2 are served by this
change alone (`atr-support-and-resistance`, `auto-trendlines-by-pivots`), 2 more by admission alone (`request-other`:
`intraday-power-3-visual`, `support-resistance-fibonacci-retracement`), 2 wait on the run's step limit
(`volume-profile`, `fourier-extrapolator`), 2 on a door-side discriminator or per-script evidence for a host that lost
every drawing (`atr-trailing-stop-by-ceyhun`, `liquidity-heatmap-swiftedge`), and the rest need an engine unit the
roadmap already ranks elsewhere, most of them behind `request-other` as well. The unit is not 44 scripts of
drawing-object work: the runtime lane draws the drawing objects of every script it builds; what stops the rest is the
value lane in front of them.

## 3. What was built: the run half draws what the host program lost

**TradingView's behaviour, from the reference.** Every drawing call a script makes on a bar creates its object:
`line.new`: "Creates new line object."; `label.new`: "Creates new label object."; `box.new`: "Creates a new box
object."; `table.cell`: "The function defines a cell in the table and sets its attributes." The newest objects are
kept up to a count (`indicator(max_lines_count)`: "The system automatically deletes the oldest line objects when the
number of lines exceeds the limit."; the same sentence for labels and boxes). The host (formula) lane cannot always
follow that: its object program is a columnar reading of the drawing calls, and a call whose value it cannot read is
dropped by name (`object op dropped: <op> <- <guard>`, `objectLoss.js`). The per-bar run executes every drawing
call, in source order, on every bar: TradingView's own model.

**What the run half already was (engine 53 / 54).** A host document that lost drawings carries its run half
(`compute.runtimeObjects`: the script's source, its outputs paired to the host's plots, the host's create sites by
source call). On a chart whose runtime pane is on, the bind runs the script and draws the RUN's drawings beside the
HOST's plots, behind every gate a runtime document answers to (the runtime pane permitted, the kill list, the script
graded or admitted by capability, a forming bar refused for a closed-bar admission, the script's own
`runtime.error`), the column rail (every mapped run column equals the host's on every bar the run serves) and the
object rail (`runHalfObjectRail.js`: at every create site the host draws, the run's objects ARE the host's: count,
order, bar, the drawn row to the price tolerance). Engine 54 then refused every drawing made at a call the host
program LOST (`run-half:uncompared-site`), and a run half with nothing comparable (`run-half:no-comparable-objects`),
unless a per-script record of two objects-v2 MATCH captures admitted it (`run_half_evidence`, the Part 2 hook). No
attached-dirty script has such a record, so the lost drawings, exactly the ones the run half exists to draw, were
never drawn.

**The change** (`engine/runHalfObjectRail.js::runHalfObjectVerdict`, the lost-drawings rule). When the host document
DRAWS an object program of its own (`definition.objects` with a create site: the verdict `partial`, the program
carried with the calls it could read), a drawing the run makes at a call that program lost, or in a family the host
withholds whole on these bars, is the run's to draw (`admittedBy: 'lost-drawings'`). It is admitted on the run half's
own gates, which are the gates a runtime document's drawings answer to, so a lost drawing is held to exactly the rule
the runtime lane's drawings are held to (capability admission: `obj:line`, `obj:label`, `obj:box`, `obj:table` are
admitted on their own evidence; `obj:linefill`, `obj:polyline` are not). Everything else is unchanged:

- every site the host DOES draw is still compared, object for object: a run that withholds one
  (`run-half:host-object-withheld`) or makes it differently (`run-half:object-rail`) keeps the host picture;
- the plots never leave the host lane: the pane draws the host's formula columns, the run only its drawings, and the
  column rail still refuses a run whose mapped columns differ from the host's;
- a run drawing that names no call (`site` absent) is never admitted this way;
- a host document with NO object program (`definition.objects` absent) is not admitted this way. That is a host
  whose object gate withholds the whole drawing by name (a lost removal, `removes`: owner ruling 2026-09-27 option
  b) or one that lost every drawing; the document does not tell the two apart, and the first is measured to go
  silently empty when the run draws it (`fabio-style ... rddt 1d 2026-11-15`: the run kept 0 of TradingView's 52
  objects and said nothing). Both stay on the Part 2 evidence hook, as before;
- the Part 2 hook still admits first, and names itself (`admittedBy: 'evidence'`).

The door is not changed: `memberPaneDefinition.js` mints the same run half, byte for byte, on master and here. The
translation is unchanged; only the bind answers differently.

## 4. Chart-pane only (the coordinator's condition 1): the server lanes keep the host document

"A member who has an alert or a scan on one of these scripts today (served by the host document on the server) must
keep it." The unit's first cut (this PR's first push, `db741a3fdb`) moved such a script to a RUNTIME document
(`compute.kind: 'runtime'`); saved, that document would have been read by the server lanes as a runtime document,
which they run only at `PINE_RUNTIME_SERVER_STAGE` (dark): a new alert or scan on it withheld by name where the host
document's ran. It is withdrawn. In the run-half form the document a member saves is the HOST document:

- `compute.kind` stays `'ast'`. Every server lane decides a document's lane by one reader,
  `runtime_definitions.is_runtime` (`compute.kind == 'runtime'`): the alert lane (`alert_user_series.
  is_runtime_document`, `_gate_lane`), the scan lane (`scan_evaluator._scannable_handle`, `scan_run`,
  `scan_runtime`), the backtest and definition paths (`user_definitions`), and `param_inputs.specialize` works on the
  formula's own literals. So they read its formula half exactly as before;
- its formula half is byte for byte the document a member with the runtime pane OFF saves (the run half, its source
  stamp and its drawing-note sentence taken out: `memberPaneDefinition.js::withoutRunHalf`);
- on the chart, every plot column the pane draws is the host's, bar for bar, whatever the run half answers.

Rails: `builder/memberPane/runHalfLostDrawings.test.js` (the door saves the host document; its formula half is the
pane-off document byte for byte; on `atr-support-and-resistance`'s two committed captures every plot column the pane
draws is the host's, and from the listing the run half is served with its 20 boxes and 20 lines; not admitted keeps
the host picture), `tests/test_run_half_server_lanes.py` (a run-half document is not a runtime document; the alert
lane admits it as a formula without asking the runtime server lane and computes the same column as the document
without the run half; `specialize` keeps it a host document with its run half; the scan lane files it under the
formula's own hash). Mutants in section 9.

## 5. Off the listing (the coordinator's condition 2): the warm-up gap, per script

"Measure, per moved script, on the committed off-listing captures, which plot bars the host draws that the run leaves
blank. If any plot loses bars, apply the `takesAway` rule ... the move is taken only when the run draws every plot bar
the host draws, or the member keeps the host."

`builder/memberPane/offListingWarmup.measure.test.js` (opt-in), every committed capture of every script this unit or
its first cut draws differently. Per visible plot: the bars the HOST document draws; of those, the bars the chart PANE
leaves blank with the run half bound (this unit); and the bars the RUN leaves blank (what the first cut's runtime
document drew). The run is told it starts at the listing (`runtimeHistory: 'listing'`); off the listing it withholds
its warm-up bars (`runtimeWarmupOf`) where the host formula draws its bounded window.

| script | capture | from the listing? | the run half on it | per visible plot: bars the host draws / of them blank in the PANE (this unit) / blank in the RUN (the first cut's runtime document) |
|---|---|---|---|---|
| `committed:atr-support-and-resistance` | rddt 1d 2026-09-28 | yes | **served** (20 box, 20 line) | `out5` 632 / 0 / 0; `out6` 632 / 0 / 0 |
| | **spy 1d 2026-10-03** | **no** (1,800 bars) | refused `runtime:history-start` | `out5` 1,800 / **0** / **256** (bars 0-255); `out6` 1,800 / **0** / **256** (bars 0-255) |
| `committed:atr-trailing-stop-by-ceyhun` | rddt 1d 2026-10-02 | yes | refused `run-half:no-comparable-objects` | `out2` 627 / 0 / 0; `out3` 636 / 0 / 0; `out4` 636 / 0 / 0 |
| | **spy 1d 2026-10-02** | **no** (1,800 bars) | refused `run-half:column-rail` | `out2` 712 / **0** / **265** (bars 139-403); `out3` 709 / **0** / **264**; `out4` 709 / **0** / **264** |
| `committed:volume-profile` | rddt 1d 2026-09-28; spy 1d 2026-10-03 (**off**) | yes / no | refused `runtime:limit` (205,101 steps on the last bar, the limit 200,000) | no visible plot (drawings only) |
| `committed:vdubus-pattern-gen-v2-restored-refined` | rddt 1d 2026-09-28; spy 1d 2026-10-03 (**off**) | yes / no | none (`run-half:size`) | no visible plot (drawings only) |
| `probe:vw-w3n-draw-block-history-a`, `-b`, `-c` | rddt + spy 1d 2026-11-15 | yes (both) | refused `run-half:column-rail` | `out2` 666 / 0 / 0 (rddt); 8,507 / 0 / 0 (spy) |

**What it says.** The committed off-listing captures are the four SPY 1D captures of 2026-10-02 / 10-03 (their history
starts in 2019, not at the 1993 listing). On two of them the RUN leaves host-drawn plot bars blank: the warm-up the
run withholds when it does not start at the listing. `atr-support-and-resistance` SPY: 256 of 1,800 bars on both
plots; the first cut MOVED that script, so on that chart it took 256 bars of each plot away from the member: under
the `takesAway` rule the first cut's move was not admissible there. `atr-trailing-stop-by-ceyhun` SPY: 264-265 of
~710 on its three plots; the first cut kept it (its fill), and the run half is refused (`run-half:column-rail`). In
the run-half form the PANE leaves **0** host-drawn bars blank on every plot of every capture, on and off the listing,
because the plots are the host's columns; off the listing the run's drawings are refused too
(`runtime:history-start`: "where the drawings land depends on where the chart begins"), so the member keeps the
whole host picture there. (`volume-profile` and `vdubus` draw no plot; the `vw-w3n` probes' captures both start at
the listing.)

**The `takesAway` rule.** No `takesAway` helper is on master or any pushed branch yet (every remote branch searched,
2026-11-18). In the run-half form the rule holds by construction rather than by a check at the door: the pane never
draws a run plot (the plots are the host's columns on every bar), and a drawing the host draws that the run does not
make refuses the run half (`run-half:host-object-withheld`), so the member keeps the host picture. When the strategy
agent's rule lands at `memberPaneDefinition`, this unit has nothing to route through it (the door is unchanged); a
uniform door predicate can be added then.

## 6. The vendor harness, both lanes (every committed capture, and the unit's 58 licence-held captures)

Run on this tree under the heavy lock, BEFORE (master's `runHalfObjectRail.js` swapped in, restored from the saved copy,
`git hash-object` byte-equal) and AFTER, each lane in its own hold: the committed corpus (`VENDOR_HARNESS_DIR=
../tests/fixtures/vendor`, 915 captures) and the 58 ledger captures of the 55 scripts (staged from the local capture
store, never committed).

| lane | captures | before (MATCH / DIVERGE / INCONCLUSIVE / MATCH_SUBSTITUTED) | after | records that changed |
|---|---:|---|---|---:|
| production, committed | 915 | 207 / 81 / 627 / 0 | 207 / 81 / 627 / 0 | **0** |
| production, ledger | 58 | 8 / 29 / 21 / 0 | 8 / 29 / 21 / 0 | **0** |
| runtime-on, committed | 915 | 312 / 79 / 504 / 20 | 312 / 79 / 504 / 20 | **0** |
| runtime-on, ledger | 58 | 13 / 27 / 18 / 0 | 13 / 27 / 18 / 0 | **0** |

**Byte-identical on both lanes, and why that is the expected answer, not an empty one.** The production lane runs
with the runtime pane dark, so no run half is minted and the rail is never asked. The runtime-on lane ALREADY admits
every run half's drawings (`runHalfRailSeam.__admitEveryRunHalfForTests`, RS rating L8: "its evidence is this lane's
grade of the run's drawings"), so it has always graded exactly the picture this change now serves. Those grades are
the evidence for the four scripts it serves: `atr-support-and-resistance` rddt + spy MATCH (objects v1 MATCH, 20
boxes + 20 lines paired; v2 INCONCLUSIVE, no x table), and on the ledger `auto-trendlines-by-pivots` rddt,
`intraday-power-3-visual` rddt + spy (objects v2 MATCH) and `support-resistance-fibonacci-retracement` rddt + spy
MATCH. On the production lane the same captures are INCONCLUSIVE (the host withholds the lost drawings by name) for
the first two scripts, and DIVERGE for `support-resistance-fibonacci-retracement`: a member with the runtime pane on
moves from that DIVERGE to the runtime-on MATCH once the script is admitted. No capture moved MATCH -> DIVERGE; the
committed runtime-on snapshot and the reach report are unchanged (master's files).

## 7. Admission: no row added; what each blocked script still needs

The change adds no capability and no allowlist row: a run half answers to the runtime lane's admission exactly as a
runtime document does (the starter allowlist, or capability admission of every capability the script uses). Of the
four it now draws:

| script | admitted? | evidence today (runtime-on, this tree) |
|---|---|---|
| `committed:atr-support-and-resistance` | yes | rddt 1d 2026-09-28, spy 1d 2026-10-03: MATCH (all items; objects v1 MATCH, 20 boxes + 20 lines paired; v2 INCONCLUSIVE, no x table) |
| `reference:auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr` | yes (closed bars: served only while the newest bar is known closed) | rddt 1d 2026-11-15 (ledger): MATCH |
| `reference:intraday-power-3-visual` | no: `request-other` | rddt + spy (ledger): MATCH, objects v2 MATCH |
| `reference:support-resistance-fibonacci-retracement` | no: `request-other` | rddt + spy (ledger): MATCH |

**What the two blocked ones still need.** `request-other` (the roadmap's evidence unit, step 7, in front of 130
scripts). Their 4 runtime-drawn MATCH captures from 2 community scripts are the row's count, but they are LEDGER_ONLY:
they count only once re-graded and filed at the engine this ships at (`evidence_engine regrade`), and the row's
admission is the coordinator's call over the whole `request-other` population (Q-REQ-OTHER-1). What each one's
request reads is in section 11.

## 8. The member-facing census, both lanes, before and after

The coverage census (`run_census.py`, both lanes, the 679-script sample plus TradingView's 288 whole-script examples:
967 rows) and the map and roadmap tools over it (`coverage_map.py`, `parity_roadmap.py facts` + `build`), BEFORE
(master's rail) and AFTER, on this tree, each lane in its own hold.

**The census instrument.** A run half answers at the BIND, so the static census could not see one: an attached-dirty
row was not clean and had no runtime reading. `coverageMapDoorCensus.measure.test.js` now records, per step, `runHalf`
(minted / declined by code) and, at step 0 (the bound check), `runHalfBound`: the door's document bound on the
reference bars as the binder binds it (`runHalfBoundOf`, the in-process run registered for that bind only, so no
other bound reading changes). A row is `cleanByRunHalf` when its step 0 is the host document, clean in every respect
but its object program's loss (an attached step's `pine:objects-only` is that loss's consequence, DRAW-1's own rule),
and its run half is served; `coverage_map.runtime_on_transfers` (the ratchet's predicate too) counts it, with the kill
list and the host known-divergence list applied as for a runtime attach and a clean host row.

| | before | after |
|---|---:|---:|
| **member-facing: served (runtime-on lane, the server's admission applied)** | **275 / 679 (40.5%)** | **277 / 679 (40.8%)** |
| runtime-on lane, the census granting every script | 285 | 289 |
| host-only lane | 220 | 220 |
| admitted by capability / declined by admission | 54 / 10 | 56 / 12 |
| `objects` unit, sole scripts (servable), on this census | 45 (41) | 41 (37) |
| production-lane census rows that changed | | 0 at step 0 (2 rows differ in peel steps 3-4: the host translator's drop counts on two licence-held scripts, which flap between identical runs; they differed between the first cut's before and after too) |
| runtime-on census rows that changed | | 5 of 967 (`runHalfBound` refused -> served: the 4 scripts above and one TradingView example, `label.get_text`) |
| coverage ratchet (corpus/committed), runtime-on / production | 91 / 59 | **92** / 59 (snapshot written: + `atr-support-and-resistance`) |

The 2 newly served: `atr-support-and-resistance` and `auto-trendlines-by-pivots` (their captures MATCH). The 2 more
the run half draws wait on admission (section 7). The first cut counted 280 because it also counted
`volume-profile` and `fourier-extrapolator` (drawn as runtime documents whose run stops at its step limit, by name)
and `liquidity-heatmap-swiftedge` (a host with no object program); the run-half form keeps the host picture for all
three.

## 9. Rails and mutation proofs

| rail | what it holds |
|---|---|
| `engine/runHalfObjectRail.js` via `builder/memberPane/runHalfObjectRail.test.jsx` (33) | the lost-drawings rule, pure and at the bind: lines from a lost call beside compared labels are drawn (`admittedBy: 'lost-drawings'`), recorded evidence still names itself first; a compared site still holds (a withheld host drawing, a moved anchor, one more at a compared site refuse); a run drawing that names no call is never admitted as lost; a host with NO object program (or an empty one) is admitted only by evidence (one capture is not evidence); a family the host withholds whole is the run's to draw when the host draws a program, not when it draws none; the gates decide first (killed, not graded refuse before the rail) |
| `builder/memberPane/runHalfLostDrawings.test.js` (5) | chart-pane only: the door saves the HOST document (`compute.kind: 'ast'`, the run half beside it), its formula half byte for byte the pane-off member's; on `atr-support-and-resistance`'s two committed captures every plot column the pane draws is the host's, bar for bar (from the listing the run half is served with its 20 boxes and 20 lines); capability admission admits, a refused verdict keeps the host picture |
| `tests/test_run_half_server_lanes.py` (5) | the server half: a run-half document is not a runtime document (`runtime_definitions.is_runtime`, `alert_user_series.is_runtime_document`); the alert lane admits it as a formula without asking the runtime server lane, and computes the same column as the document without its run half; `param_inputs.specialize` keeps it a host document with its run half; the scan lane files it under the formula's own hash, never as a runtime scan |
| `tests/test_pine_coverage_ratchet.py` (+1) | `cleanByRunHalf` transfers on the runtime-on lane only; the kill list and the host known-divergence list stop it; the ratchet's wall names the run half's answer |
| `tests/test_pine_parity_roadmap.py` (+1) | the by-name ruling (section 10) |
| the run-half rails (`runHalf.test.jsx`, `runHalfDisclosure.test.jsx`, `runHalf.pairing.rail.test.js`, `runtimeRequestSupply.test.js`) | master's files, unchanged, green: they set evidence for their fixtures, which still admits first |

Mutants (each on this tree, its rail run, the file restored from a saved copy, `git hash-object` equal after every
one; controls unmutated green, vitest and pytest):

| mutant | caught by |
|---|---|
| M1 the lost-drawings rule off (master's rail) | 10 red (runHalfObjectRail, runHalfLostDrawings) |
| M2 a run drawing that names no call admitted as lost | 1 red |
| M3 a host with NO object program admitted as lost (the removes carve-out dropped) | 3 red |
| M4 a compared site the run withholds excused when lost drawings are admitted | 2 red |
| M5 the pane takes the RUN's plot columns | 1 red (atr-support-and-resistance SPY: the run's 256 warm-up bars) |
| M6 the door saves a runtime-kind document when it mints a run half | 5 red |
| M7 the alert lane reads a run-half document as a runtime document | 2 red |
| M8 the store's reader (`is_runtime`) calls a run-half document a runtime document | 4 red |
| M9 the runtime-on predicate ignores `cleanByRunHalf` | 1 red |
| M10 the run-half transfer ignores the kill list | 1 red |
| M11 the by-name never-serve ruling not applied | 1 red |

**11 of 11 red.** (A first M5, the run's columns copied into the pane only once the run half is served, was GREEN, and
is equivalent: a served run half's mapped columns equal the host's on every bar by the column rail, and a run half is
served only from the listing, where the run withholds no warm-up. The fault that matters, the pane taking the run's
columns at all, is M5 as listed.)

**Engine number.** 77 (#1824, the engine 77 train; `scriptEngineVersion.js`), its line rewritten for this form: the translation is unchanged
(the door mints the same run half, byte for byte), so the number marks a bind-time change; a bump re-translates saved
scripts once, which mints a run half on a pane-on member's document saved without one. The change reaches every
document that already carries a run half with no re-translation. **Ruled (coordinator, 2026-11-18): it gets a number**,
because it changes what members SEE (drawings at lost calls), so its evidence must be graded at the engine that draws
it, and the once-per-bump re-translation is how a change reaches saved documents. It rides train e77; the train
numbers the line.

**Wider suites**: section 12.

## 10. The capture queue: Q-OBJ1-3 withdrawn, ruled never-serve by name

The unit's three sole scripts with no capture anywhere (the roadmap's evidence queue, `none`) were sent as one batch
(Q-OBJ1 `committed:supertrend-explorer`, Q-OBJ2 `reference:custom-screener-with-alerts`, Q-OBJ3
`reference:screener-for-40-instruments`; NYSE:RDDT 1D + AMEX:SPY 1D). **0 of 6 were capturable**: TradingView itself
refuses every row at the script's defaults with "Invalid symbol" (`supertrend-explorer` reads `BINANCE:EOSBTC` and
eight more crypto pairs as symbol input defaults; both screeners default to 40 crypto pairs, at least one of which no
longer resolves). The 2026-11-15 attempt answered the same (capture run objunit-2026-11-18, packet
`582f2cf1e50b7fbb1939bf9d4fd38017981ac9d4c5aeb290f3add37703ccf596`, records only the refusals).

**Ruling (coordinator, 2026-11-18): all three are removed as capture targets and recorded on the parity roadmap in
the never-serve class `other-feeds`** (crypto other-symbol reads; we hold no crypto data). The roadmap's detectors
could not class them: the facts hold no venue for a v4 `input('BINANCE:...', title=input.symbol)` nor for a bare
`XRPUSDT`-style pair. So the ruling is recorded BY NAME, with its witness: `tools/pine_coverage/parity_roadmap.py::
RULED_NEVER_SERVE`, read by `build` into `neverServe[other-feeds]` (`ruledByName`: the reason and the run, per
script); `docs/pine/parity-roadmap.json` is rebuilt from the committed map with it (never-serve 9 -> 12 scripts,
`objects` sole servable 44 -> 41, the three gone from its evidence queue) and `PARITY-ROADMAP-2026-11-18.md` records
the ruling beside its never-serve table. Rail: `tests/test_pine_parity_roadmap.py::
test_a_ruling_by_name_is_a_never_serve_script_with_its_witness` (each ruled script is a census script, not served,
in its class with its witness, in no unit's evidence queue; and, the control, without the ruling the detectors alone
leave all three servable and queued). `docs/pine/capture-queue-2026-11-18-objects-unit.md` is deleted. Their probe
rows (section 1) say so by name.

## 11. The request-other candidates, for the admissions ruling

The admissions agent ruled that an identity-only request (the chart's own symbol and timeframe) does not bind. The
two `request-other` scripts the run half now draws on the grant (section 1), and what each request reads:

Both are licence-held reference sources, so they are described by identifier, never quoted.

| script | its requests | another symbol? | another timeframe? |
|---|---|---|---|
| `reference:intraday-power-3-visual` | four `request.security` calls (the high, low, open and close), each on the chart's own `syminfo.tickerid`, at a timeframe read from an `input.timeframe` whose default is daily (`D`) with the options daily and weekly (`W`); no `lookahead` argument | no: always `syminfo.tickerid` | **yes, except on a daily chart at its default.** Its default is the chart's own timeframe only on a 1D chart. The script is written for intraday charts (it draws its levels under `timeframe.isintraday` on the last bar), where its daily default is a timeframe the chart does not hold, and its weekly option is one on any daily chart |
| `reference:support-resistance-fibonacci-retracement` | two `request.security` calls (`ta.highest` of the high and `ta.lowest` of the low over a look-back), each on the chart's own `syminfo.tickerid`, at an `input.timeframe` whose default is empty, which the script resolves to `timeframe.period` | no: always `syminfo.tickerid` | **no at its default, on every chart**: the empty default is the chart's own timeframe. Only a member who sets its Timeframe input reads another one |

So: `support-resistance-fibonacci-retracement` is identity-only at its defaults on every chart (its captures, RDDT +
SPY 1D, MATCH on the runtime-on lane, ledger); `intraday-power-3-visual` is identity-only only on a daily chart at its
default, and its intended use (an intraday chart) and its weekly option read a timeframe the chart does not hold (its
two captures are 1D, so they witness only the identity case).

**Ruled (coordinator, 2026-11-18):** both are identity-only at their defaults on daily charts, so they do not bind for
admission (they do not count toward Q-REQ-OTHER-1). `intraday-power-3-visual` on an INTRADAY chart (its `D` and `W`
reads from a 5-minute chart) would be a real binding capture: it is on the request unit's backlog as **Q-DAILY-2**
(`PARITY-ROADMAP-2026-11-18.md`, section 7's probe rows), for when lower-timeframe charts are in scope.

## 12. Wider suites

GitHub runners (`tools/remote_tests.py`, on `8509a6bc2d`):

- **vitest**: `src/components/chart`, `src/hooks` and `components/screener/reachable.test.js`, 6 shards. Green except
  ONE test this branch does not touch: `src/hooks/usePreferences.additionsOnly.test.js` ("NO NEW opaque-key call
  site": `pages/screener/focus/board/useScanBoard.js`). That file came in with master `0bb48a7f5a`; master has since
  fixed the rail (`0e79f46eb0`, `3aea780dc9`), after this branch's base. It goes green when master is merged in at
  the train cut. Per the coordinator, master is not merged before then.
- **pytest**: green. The files: `test_run_half_server_lanes`, `test_pine_capability_admission`,
  `test_pine_allowlist_measured_verdicts`, `test_pine_capabilities`, `test_pine_run_half_evidence`,
  `test_pine_coverage_ratchet`, `test_pine_host_known_divergence`, `test_runtime_definitions`, `test_ci_pine_heavy`,
  `test_pine_parity_roadmap`, `test_engine53_stamp_served_ast`, `test_run_half_source_binding`,
  `test_runtime_objects_schema_parity`, `test_alert_runtime_lane`, `test_alert_lookback_window`,
  `test_script_engine_version_gate`, `test_saved_script_prebump`, `test_definition_load_budget`.

## 13. Rulings on this evidence (coordinator, 2026-11-18) and where each open item lives

- **Accepted**: the run-half form meets both conditions by construction; the rails prove it.
- **Engine number**: yes, train e77 (section 9).
- **request-other candidates**: identity-only at their defaults on daily charts, so they do not bind for admission;
  Q-DAILY-2 is on the request unit's backlog (section 11).
- **Open items, on the roadmap with their measurements** (`PARITY-ROADMAP-2026-11-18.md`, U-OBJ):
  - the hosts that lost EVERY drawing (`atr-trailing-stop-by-ceyhun`, `liquidity-heatmap-swiftedge`) need a door-side
    discriminator, a stored-document change, so a later unit;
  - `volume-profile` and `fourier-extrapolator` stop at 205,101 steps against the 200,000 per-bar limit. The per-chart
    CPU cost of the last bar at 250,000 is to be measured before anyone proposes raising it.
- **Master** is not merged in (the coordinator's master hold). The usePreferences rail (section 12) clears at the
  train's master merge.
