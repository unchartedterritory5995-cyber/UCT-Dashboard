# Parity unit 1 (`objects`): the attached-dirty rows asked of the runtime lane, and the dirty route (2026-11-18)

Branch `feat/parity-objects`, cut from `origin/master` `158b4918d4` (`SCRIPT_ENGINE_VERSION = 73`). The unit is
U-OBJ of the measured roadmap (`docs/pine/PARITY-ROADMAP-2026-11-18.md`, PR #1766, section 5 and the build order
step 1): 45 sole scripts (44 servable; `reference:cobra039s-crypto-market-visualizer` is never-serve, other
feeds), and the `known-lists` unit's 10 scripts, 8 of which pair with it. The roadmap's own warning: 44 is an
UPPER BOUND, because the census never offered the runtime lane to an `attached-dirty` row. This document
measures that first (sections 1-2), then builds the one change the measurement ranks first (section 3).

Scripts are named by corpus key only. Licence-held sources and captures stay on the PC; nothing here quotes a
source line.

## Answer first

- **The real size of the unit is 5 door-served scripts and 3 more on admission, not 44.** The drawing calls are not
  what stops these scripts: once the runtime lane builds a script it makes its drawings (its store withholds by name a
  family no capture settles). It builds 14 of the 55 (`objects` + `known-lists`): 8 move (section 3), 2 are kept by
  the carve-out (section 4), 2 need a `fill()` the runtime lane does not draw yet, 1 is killed and 1 reads another
  symbol. The other 41 stop on the value lane first: `request.*` of another context 16, built-ins 8, dynamic history 5,
  conditional history 4, statement shapes 3, five single walls (section 2). 33 of the 55 also need a capability the
  registry does not admit (`request-other` 24).
- **The run half (engine 53) serves none of them.** 10 mint one; all 10 are refused at the bind (section 1).
- **Built: the dirty route** (section 3). A host document that drew a partial picture moves to the runtime lane
  when that lane draws everything the host draws plus what it lost. It moves 8 sample scripts (5 admitted) and 9
  reference examples. A carve-out keeps a host that withholds its whole drawing by name (section 4).
- **Graded** (section 5): production byte-identical on all 913 committed + 58 licence-held captures. Runtime-on: no
  MATCH -> DIVERGE; 7 captures move to MATCH (the six vw-w3n probes, vdubus SPY).
- **Census** (section 7): served **275 -> 280** of 679; runtime-on 285 -> 293; host-only 220 unchanged.
- **Admission**: no row added or needed; `request-other` (2 scripts) and `obj:linefill` (1, with negative evidence)
  are what the other 3 wait on (section 6). **Engine number**: NUMBER PENDING line written.

## 1. The probe: the attached-dirty rows asked of the runtime lane

`builder/memberPane/objectsUnitProbe.measure.test.js` (opt-in; `OBJECTS_PROBE_IN` / `OBJECTS_PROBE_OUT`) asks the
member door, per script, with the flags production runs (objects-only pane armed, runtime pane on for the member):

- **master's door** (`routeDirty: false`, the door before this unit): the host document, its object loss, and its
  RUN HALF (engine 53, `hostPartialRunHalf`): minted, or declined by code; a minted run half is BOUND once, as the
  binder binds it (`registry.computeFor`), on the census's own reference bars (the RDDT 1D capture from the
  listing, a closed newest bar);
- **the dirty route** (section 3): moved (the moved document bound the same way: what its run kept), or kept with
  the decline's code;
- **the drawing build alone** (`probeRuntimeProgram(source, {objectsInRun: true})`): its refusal's guard, line and
  token, or its count of drawing operations.

Each door ran twice: with the test grant (every script graded: the runtime lane's own answer) and with
production's lists (the committed kill list and graded allowlist latched, capability admission on, the server's
verdict for the source latched). The admission column is the server's answer from the committed registry
(`pine_capabilities.capabilities_of` against `admitted_capabilities()`, the kill list). ⚠️ For 12 reference sources
stored with CRLF line ends the probe latched the verdict under the LF text's hash, so the door found no verdict and
answered "still being checked"; for those the production answer is the grant answer of an admitted script (the
allowlist and the verdict are the only difference between the two list states, and both run halves' binds use the
production run-half evidence, which is empty for every script here). The table therefore gives the grant column
and the admission column; "production" below is their conjunction.

Run on this branch under the heavy lock (label `objects-probe`, the first cut: before section 4's carve-out), 55 scripts: the 45 `objects` sole scripts and the
10 `known-lists` scripts. ⚠️ The known-lists scripts are measured with the host known-divergence list OFF (as the
census measures the engine, `src/test-setup.js`): at a member's door each is refused by name
(`pine:known-divergence`) before any of this, and its runtime answer is the same run as shown here.

| unit | script | admission (committed registry) | host object program | master's door (run half; one bind, RDDT 1D) | dirty route | the drawing build alone |
|---|---|---|---|---|---|---|
| objects | `builtin:multi-time-period-charts` | not: enum, method-def, request-other | partial, 35 of 36 ops lost | host; run half declined `runtime:call-undeclared-builtin-state` | stays `runtime:call-undeclared-builtin-state` | `runtime:call-undeclared-builtin-state` line 101 `timeframe.change` |
| objects | `committed:atr-support-and-resistance` | admitted | partial, 24 of 27 ops lost | run half minted; bind `refused` `run-half:no-comparable-objects` | **moved** (20 box, 20 line) | builds (9 drawing ops) |
| objects | `committed:atr-trailing-stop-by-ceyhun` | admitted (closed bars) | partial, 2 of 4 ops lost | run half minted; bind `refused` `run-half:no-comparable-objects` | stays `dirty-route:surface` | builds (3 drawing ops) |
| objects | `committed:auto-trendline-dojiemoji` | admitted | removes, 4 of 10 ops lost | host; run half declined `runtime:statement` | stays `runtime:statement` | `runtime:statement` line 106 `ta.pivothigh` |
| objects | `committed:dual-view-htf-candlestick-patterns-theultimator5` | not: request-other | removes, 68 of 94 ops lost | host; run half declined `run-half:size` | **moved** (column errors value:runtime:limit) | builds (27 drawing ops) |
| objects | `committed:ict-killzone-index-version` | admitted | partial, 12 of 36 ops lost | host; run half declined `runtime:conditional-history` | stays `runtime:conditional-history` | `runtime:conditional-history` line 65 `[` |
| objects | `committed:liquidity-heatmap-nephew-sam` | not: request-other | partial, 14 of 16 ops lost | host; run half declined `runtime:request` | stays `runtime:request` | `runtime:request` line 132 `request.security` |
| objects | `committed:multi-timeframe-supply-demand-zones` | not: request-other | partial, 4 of 13 ops lost | host; run half declined `runtime:request` | stays `runtime:request` | `runtime:request` line 240 `request.security` |
| objects | `committed:multicator-table` | not: obj:polyline | removes, 50 of 290 ops lost | host; run half declined `pine:function` | stays `pine:function` | `pine:function` line 310 `ta.dmi` |
| objects | `committed:sector-rotation` | not: request-other | partial, 6 of 7 ops lost | host; run half declined `pine:request` | stays `pine:request` | `pine:request` line 26 `request.security` |
| objects | `committed:supertrend-explorer` | not: request-other | partial, 1 of 2 ops lost | host; run half declined `runtime:request-with-state` | stays `runtime:request-with-state` | `runtime:request-with-state` line 118 `security` |
| objects | `committed:trend-lines-supports-and-resistances` | not: method-def | partial, 0 of 6 ops lost | host; run half declined `pine:builtin` | stays `pine:builtin` | `pine:builtin` line 79 `alert.freq_once_per_bar` |
| objects | `committed:vdubus-pattern-gen-v2-restored-refined` | not: obj:linefill | partial, 1 of 151 ops lost | host; run half declined `run-half:size` | **moved** (5 label, 112 line, 48 linefill) | builds (17 drawing ops) |
| objects | `committed:volume-profile` | admitted (closed bars) | partial, 14 of 17 ops lost | run half minted; bind `refused` `runtime:limit` | **moved** | builds (7 drawing ops) |
| objects | `reference:auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr` | admitted (closed bars) | partial, 8 of 10 ops lost | run half minted; bind `refused` `run-half:uncompared-site` | **moved** (52 label, 16 line) | builds (4 drawing ops) |
| objects | `reference:cobra039s-crypto-market-visualizer` | not: method-def, request-other | partial, 5 of 8 ops lost | host; run half declined `runtime:request-with-state` | stays `runtime:request-with-state` | `runtime:request-with-state` line 100 `request.security` |
| objects | `reference:crypto-correlation-matrix` | not: request-other | partial, 7 of 11 ops lost | host; run half declined `runtime:request-with-state` | stays `runtime:request-with-state` | `runtime:request-with-state` line 81 `request.security` |
| objects | `reference:cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new` | not: request-other | partial, 16 of 26 ops lost | host; run half declined `lower-tf:lookahead` | stays `lower-tf:lookahead` | `lower-tf:lookahead` line 133 `request.security` |
| objects | `reference:custom-screener-with-alerts` | not: collections:matrix, request-other | partial, 1 of 9 ops lost | host; run half declined `runtime:request` | stays `runtime:request` | `runtime:request` line 230 `request.security` |
| objects | `reference:dot-dynamics` | admitted | clean, 0 of 0 ops lost, 1 paint(s) withheld | host; run half not asked (no loss) | stays `pine:window` | `pine:window` line 120 `ma1` |
| objects | `reference:dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt` | admitted (closed bars) | partial, 1 of 21 ops lost | host; run half declined `pine:function` | stays `pine:function` | `pine:function` line 148 `ta.dmi` |
| objects | `reference:dynamic-higher-timeframe-fibonacci-pivot-points` | not: request-other | partial, 8 of 24 ops lost | host; run half declined `pine:request` | stays `pine:request` | `pine:request` line 42 `security` |
| objects | `reference:dynamic-linear-regression-channels` | not: obj:linefill | partial, 11 of 16 ops lost | host; run half declined `runtime:history-dynamic-offset` | stays `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 34 `calcSlope` |
| objects | `reference:fabio-style-order-flow-lvn-volumeprofile-fvgob-liquiditygrabs-dashboar` | admitted (closed bars) | removes, 30 of 32 ops lost | run half minted; bind `refused` `runtime:objects-stopped` | **moved** (no drawing kept on these bars) | builds (9 drawing ops) |
| objects | `reference:fibonacci-extention-retracment-pivot-points-by-dgt` | admitted (closed bars) | partial, 1534 of 1580 ops lost | host; run half declined `runtime:history-dynamic-offset` | stays `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 169 `pivots` |
| objects | `reference:fourier-extrapolator-of-price-w-projection-forecast-loxx` | admitted (closed bars) | partial, 6 of 20 ops lost | run half minted; bind `refused` `runtime:limit` | **moved** | builds (7 drawing ops) |
| objects | `reference:intraday-power-3-visual` | not: request-other | partial, 5 of 14 ops lost | run half minted; bind `refused` `run-half:no-comparable-objects` | **moved** (no drawing kept on these bars) | builds (9 drawing ops) |
| objects | `reference:linear-regression-channel-curve-slope-by-dgt` | admitted (closed bars) | partial, 126 of 184 ops lost | host; run half declined `runtime:history-dynamic-offset` | stays `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 133 `f_calcSlope` |
| objects | `reference:liquidity-heatmap-swiftedge` | admitted | partial, 10 of 14 ops lost | run half minted; bind `refused` `run-half:no-comparable-objects` | **moved** (no drawing kept on these bars) | builds (7 drawing ops) |
| objects | `reference:liquidity-sniper-pro` | not: request-other | partial, 25 of 33 ops lost | host; run half declined `runtime:conditional-history` | stays `runtime:conditional-history` | `runtime:conditional-history` line 42 `and` |
| objects | `reference:liquidity-swings-luxalgo` | not: request-other | partial, 30 of 32 ops lost | host; run half declined `runtime:request-with-state` | stays `runtime:request-with-state` | `runtime:request-with-state` line 41 `request.security_lower_tf` |
| objects | `reference:machine-learning-random-forest-strategy-gainzalgo` | not: collections:matrix, method-def | partial, 28 of 47 ops lost | host; run half declined `pine:function` | stays `pine:function` | `pine:function` line 294 `ta.dmi` |
| objects | `reference:market-trend-levels-detector-bigbeluga` | admitted (closed bars) | partial, 19 of 19 ops lost | run half minted; bind `refused` `runtime:failed` | stays `dirty-route:surface` | builds (9 drawing ops) |
| objects | `reference:onchart-wavetrend-divergence-with-pivots` | not: request-other | partial, 2 of 2 ops lost | host; run half declined `runtime:request-with-state` | stays `runtime:request-with-state` | `runtime:request-with-state` line 280 `security` |
| objects | `reference:range-filter-x-hull-suite` | not: request-other | partial, 6 of 17 ops lost, 2 paint(s) withheld | host; run half declined `runtime:request` | stays `runtime:request` | `runtime:request` line 97 `request.security` |
| objects | `reference:relative-strength-index-divergences-libertus` | admitted | clean, 0 of 6 ops lost, 2 paint(s) withheld | host; run half not asked (no loss) | stays `runtime:object-op` | `runtime:object-op` line 74 `label.new` |
| objects | `reference:rsi-support-resistance-by-dgt` | not: obj:linefill | removes, 6 of 55 ops lost | host; run half declined `runtime:conditional-history` | stays `runtime:conditional-history` | `runtime:conditional-history` line 133 `crossover_overbought` |
| objects | `reference:screener-for-40-instruments` | not: request-other | partial, 3 of 7 ops lost | host; run half declined `pine:request` | stays `pine:request` | `pine:request` line 115 `request.security` |
| objects | `reference:smart-money-concepts-probability-expo` | not: collections:matrix, obj:linefill | partial, 20 of 37 ops lost | host; run half declined `pine:builtin` | stays `pine:builtin` | `pine:builtin` line 39 `chart.bg_color` |
| objects | `reference:support-and-resistance-step-4` | admitted | partial, 26 of 30 ops lost | host; run half declined `runtime:statement` | stays `runtime:statement` | `runtime:statement` line 151 `label` |
| objects | `reference:support-and-resistance` | not: varip | partial, 70 of 94 ops lost | host; run half declined `runtime:history-dynamic-offset` | stays `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 81 `Covariance` |
| objects | `reference:support-resistance-fibonacci-retracement` | not: request-other | partial, 7 of 15 ops lost | run half minted; bind `refused` `run-half:uncompared-site` | **moved** (7 label, 7 line) | builds (8 drawing ops) |
| objects | `reference:trend-channels-with-liquidity-breaks-chartprime` | not: obj:linefill | partial, 54 of 132 ops lost | host; run half declined `runtime:statement` | stays `runtime:statement` | `runtime:statement` line 155 `and` |
| objects | `reference:trend-direction-helper` | admitted | partial, 10 of 18 ops lost | host; run half declined `runtime:history-dynamic-offset` | stays `runtime:history-dynamic-offset` | `runtime:history-dynamic-offset` line 84 `wpr` |
| objects | `reference:zig-zag-channels-luxalgo` | admitted (closed bars) | partial, 9 of 11 ops lost | host; run half declined `runtime:history-expression` | stays `runtime:history-expression` | `runtime:history-expression` line 103 `[` |
| known-lists | `committed:artemis-oscillator-pro` | not: request-other | partial, 5 of 38 ops lost | host; run half declined `runtime:call-windowed-state` | stays `runtime:call-windowed-state` | `runtime:call-windowed-state` line 281 `ta.percentile_linear_interpolation` |
| known-lists | `committed:average-day-range-adr-pivots` | not: request-other | partial, 7 of 123 ops lost | host; run half declined `runtime:request` | stays `runtime:request` | `runtime:request` line 153 `request.security` |
| known-lists | `committed:contraction-box-doji-lines` | killed | clean, 0 of 2 ops lost | host; run half not asked (no loss) | not offered (nothing lost) | builds (2 drawing ops) |
| known-lists | `committed:ema-ribbon-trend-filter-strixedge` | not: request-other | partial, 11 of 49 ops lost | host; run half declined `lower-tf:store-unmeasured` | stays `lower-tf:store-unmeasured` | `lower-tf:store-unmeasured` line 156 `request.security` |
| known-lists | `committed:heat-map-seasons` | killed | clean, 0 of 7 ops lost, 1 paint(s) withheld | host; run half not asked (no loss) | stays `runtime:killed` | `runtime:call-undeclared-builtin-state` line 30 `ta.correlation` |
| known-lists | `committed:htf-candle-footprint-cartel-console` | killed | partial, 17 of 26 ops lost | host; run half declined `runtime:killed` | stays `runtime:killed` | `pine:function` line 126 `color` |
| known-lists | `committed:htf-liquidity-dashboard-tfo` | not: request-other | partial, 147 of 215 ops lost | host; run half declined `pine:request` | stays `pine:request` | `pine:request` line 199 `request.security` |
| known-lists | `committed:momentum-based-zigzag` | killed | partial, 2 of 2 ops lost | refused `pine:timeout` | refused `pine:timeout` | `runtime:conditional-history` line 89 `?` |
| known-lists | `committed:position-size-calc` | not: request-other | partial, 1 of 11 ops lost | host; run half declined `runtime:request` | stays `runtime:request` | builds (2 drawing ops) |
| known-lists | `committed:vold-market-breadth` | not: request-other | partial, 2 of 3 ops lost | host; run half declined `runtime:input-state` | stays `runtime:input-state` | `runtime:input-state` line 7 `input` |


**What it says, before anything is built.**

- **The run half serves nothing in this unit.** 10 scripts mint a run half under the grant; every one is refused at
  the bind: `run-half:no-comparable-objects` 4 (the host draws none of the drawings the run makes, and no script has
  a run-half evidence record), `run-half:uncompared-site` 2, `runtime:limit` 2, `runtime:objects-stopped` 1,
  `runtime:failed` 1. A member gets the host's partial picture, with its "N of M drawing elements" disclosure.
- **The runtime lane builds 14 of the 55 with their drawings.** 10 of them it draws as a document that keeps
  everything the host draws (the dirty route's first cut moved all 10; 2 of them are hosts that withhold their whole
  drawing by name, which the carve-out of section 4 keeps, so the route moves 8); 2 it would draw without their fill (the runtime
  lane draws no fill yet: `atr-trailing-stop-by-ceyhun`, `market-trend-levels-detector-bigbeluga`); 2 are killed or
  never lose a drawing (`contraction-box-doji-lines`, `position-size-calc` stops at `runtime:request`).
- **Admission is the larger wall.** 18 of the 55 are admitted (all `objects` scripts). 33 use a capability the
  registry does not admit (`request-other` 24, `obj:linefill` 5, `method-def` 4, `collections:matrix` 3, `enum`,
  `obj:polyline`, `varip` 1 each; a script can need several) and 4 are on the runtime kill list (all `known-lists`).

## 2. The real size of the unit: grouped by the missing behaviour

Each script under its FIRST wall on the runtime lane (the probe's grant column), with what it also needs to be
admitted. (A script freed of its first wall may hold another behind it; the census peel is the full list.)

| missing behaviour | first wall (runtime lane) | scripts | admitted | they also need |
|---|---|---:|---:|---|
| **nothing: the runtime lane draws everything the host draws, plus what it lost** | (moved by section 3) | 8 | 5 | `request-other` 2, `obj:linefill` 1 |
| the same, but the host withholds its whole drawing by name (a lost removal) | (kept by the carve-out, section 4) | 2 | 1 | `request-other` 1 |
| `request.*` of another symbol or timeframe | `runtime:request` 6, `runtime:request-with-state` 5, `pine:request` 4, `lower-tf:*` 2 | 17 | 0 | `request-other` (all 17); one is never-serve (other feeds) |
| history of a window sized while the bar runs | `runtime:history-dynamic-offset` | 5 | 3 | `obj:linefill` 1, `varip` 1 |
| built-ins the grammar does not declare | `pine:function` 4 (`ta.dmi` 3, `color` 1), `pine:builtin` 2 (`alert.freq_once_per_bar`, `chart.bg_color`), `runtime:call-undeclared-builtin-state` 2 (`timeframe.change`, `ta.correlation`) | 8 | 1 | `request-other`, `method-def`, `matrix`, `polyline`, `linefill`, `enum`; two killed |
| history of a value computed only on some bars | `runtime:conditional-history` | 4 | 1 | `request-other` 1, `obj:linefill` 1; one killed |
| statement shapes the front end does not read | `runtime:statement` (`ta.pivothigh` with a non-literal `rightbars`; a call statement with no binding; a wrapped `and`) | 3 | 2 | `obj:linefill` 1 |
| a `fill()` drawn by the per-bar lane | `dirty-route:surface` (fills 1 against 0) | 2 | 2 | none |
| a drawing call inside one arm of `?:` | `runtime:object-op` | 1 | 1 | none |
| history over an expression holding a mutable value | `runtime:history-expression` | 1 | 1 | none |
| a window length that is not a whole number (`99 / 2`) | `pine:window` | 1 | 1 | none |
| a stateful built-in over a window / an input read as state | `runtime:call-windowed-state` 1, `runtime:input-state` 1 | 2 | 0 | `request-other` |
| killed, its host program clean | `runtime:killed` (`contraction-box-doji-lines`) | 1 | 0 | its kill entry's `liftWhen` |

**The real size.** Of the roadmap's 44 servable sole scripts, 5 are served by a door change alone (section 3), 3
more by admission alone (`request-other` 2, `obj:linefill` 1), 2 more by the run's drawing being shown to MATCH
where the host withholds the whole drawing (section 4), and the other 34 need an engine unit the roadmap
already ranks elsewhere (request 17, built-ins 8, dynamic history 5, conditional history 4, statements 3, fills 2,
and five single walls), most of them behind `request-other` as well. The unit is not 44 scripts of drawing-object
work: the drawing objects themselves are drawn by the runtime lane in every script it builds; what stops the rest
is the value lane in front of them.


## 3. What was built: the dirty route (one change, the measurement's first rank)

**TradingView's behaviour, from the reference.** Every drawing call a script makes on a bar creates its object:
`line.new`: "Creates new line object."; `label.new`: "Creates new label object."; `box.new`: "Creates a new box
object."; `table.cell`: "The function defines a cell in the table and sets its attributes." The newest objects are
kept up to a count (`indicator(max_lines_count)`: "The system automatically deletes the oldest line objects when
the number of lines exceeds the limit."; the same sentence for labels and boxes). The host (formula) lane cannot
always follow that: its object program is a columnar reading of the drawing calls, and a call whose value it
cannot read is dropped by name (`object op dropped: <op> <- <guard>`, `objectLoss.js`). The per-bar run executes
every drawing call, in source order, on every bar: TradingView's own model.

**The change** (`builder/memberPane/dirtyRoute.js`, `memberPaneDefinition.js::routeDirtyHost`). An ATTACHED host
document whose object program lost drawings (`assessObjectLoss` verdict other than `clean`) or that withholds a
paint by name is offered to the runtime lane exactly as a host refusal is (`runtimeLaneDefinition`, `routed:
false`: the kill list, the starter allowlist, the capability verdict, the repaint class, the drawing build, the
request and `na`-test gates, the row pairing), and MOVED only when that lane's document draws:

- the same visible plots (each by the translation output it draws, and its style), fills and horizontal lines as
  the host document (`costRoute.js::drawnSurfaceOf`, the route-by-cost check);
- every row the author hid that the host document carries (`display = display.none`). The reference,
  `display.none`: "Specifies that the values or visuals are not displayed anywhere by default"; the values exist,
  the host document computes them, and the vendor harness grades them. The moved document carries them as hidden
  rows (`runtimeLaneDefinition`'s `carryHidden`, only for the dirty route; every other runtime document is
  unchanged);
- when the host lost drawings, its OWN drawings (`compute.objects`: RT5 / WS-E's store, which withholds by name a
  family whose answer no capture settles), never the host program's partial picture;
- when the host withheld a paint, more paints than the host document draws, and never fewer.

Anything else keeps the host answer a member has today, byte for byte (rail below), including its run half
(`hostPartialRunHalf`), with `dirtyRoute: {moved: false, code, why}` for the census. With the runtime pane off
for a viewer nothing is asked. The moved document says why it is drawn bar by bar ("because drawn as formulas some
of its drawings could not be made") and that its drawings replace the host program's (WS-E's sentence, with the
dropped / attempted counts).

**Why the run half did not already do this.** A run half (engine 53) keeps the host's plots and draws the run's
drawings only where the bind's object rail can compare them with the host's (engine 54): a drawing made at a call
the host program LOST is `run-half:uncompared-site`, admitted only on a per-script record with two objects-v2
MATCH captures (`run_half_evidence`), and no attached-dirty script has one. So in production the member gets the
host's partial picture even where the run half is minted (section 1, the bind column). A moved document is a
runtime document like every other the lane serves, admitted by capability (`obj:line`, `obj:label`, `obj:box`,
`obj:table` are admitted on their own evidence; `obj:linefill`, `obj:polyline` are not).

**Census instrument.** The census door record (`coverageMapDoorCensus.measure.test.js::oneDoor`) now carries, per
step, `dirtyRoute: {moved, code}` and `runHalf` (`minted` / `declined:<code>`). It recorded neither, so an
attached-dirty row had no runtime reading at all. The predicates are unchanged: a moved step's lane is `runtime`,
which `coverage_map.runtime_on_transfers` already counts.

## 4. The carve-out: a host that withholds its whole drawing by name keeps that answer

The first cut moved every attached-dirty document the runtime lane draws. Two of them were hosts whose object
gate withholds the WHOLE drawing by name (a lost removal, `objectLoss` verdict `removes`, owner ruling 2026-09-27
option b): `committed:dual-view-htf-candlestick-patterns-theultimator5` (not admitted, `request-other`) and
`reference:fabio-style-order-flow-lvn-volumeprofile-fvgob-liquiditygrabs-dashboar` (admitted). Graded runtime-on:

| capture | host (master's door) | moved |
|---|---|---|
| fabio-style ... rddt 1d 2026-11-15 (ledger) | DIVERGE: TradingView holds 52 objects, ours withheld by name (`pine:object-removal-lost`) | DIVERGE: the run keeps 0 boxes and 0 labels where TradingView holds 51 and 1, and says nothing |
| dual-view ... rddt 1d 2026-09-28, spy 1d 2026-10-03 | DIVERGE (withheld by name) | INCONCLUSIVE (the run stops at its limit, `runtime:limit`, by name) |

A by-name withholding traded for an unproven run, and for the admitted one a silent empty picture: the route now
leaves such a host alone (`dirtyRoute.js::hostLossOf`, `drawn: objectsGate.draw`). Re-graded on the carve-out tree,
all three records are byte-identical to master's. It is lifted the day a capture shows a moved `removes` host
MATCHing. (fabio-style's capture is licence-held, so the committed kill list, whose rail needs a committed capture
and source, cannot hold it; the carve-out is what keeps it off the runtime lane.)

## 5. The vendor harness, both lanes (every committed capture, and the unit's 58 licence-held captures)

Run on this tree under the heavy lock, BEFORE (master's `memberPaneDefinition.js` swapped in, restored from the
saved copy, `git hash-object` byte-equal) and AFTER, each lane in its own hold: the committed corpus
(`VENDOR_HARNESS_DIR=../tests/fixtures/vendor`, 913 captures, the snapshot's directory) and the 58 ledger captures
of the 55 scripts (staged from the local capture store, never committed).

| lane | captures | before (MATCH / DIVERGE / INCONCLUSIVE / MATCH_SUBSTITUTED) | after, with the carve-out | records that changed |
|---|---:|---|---|---:|
| production, committed | 913 | 207 / 79 / 627 / 0 | 207 / 79 / 627 / 0 | **0** (byte-identical) |
| production, ledger | 58 | 8 / 29 / 21 / 0 | 8 / 29 / 21 / 0 | **0** (byte-identical) |
| runtime-on, committed | 913 | 312 / 77 / 504 / 20 | **319 / 71 / 503 / 20** | 12 |
| runtime-on, ledger | 58 | 13 / 27 / 18 / 0 | 13 / 27 / 18 / 0 | 3 (verdicts unchanged) |

**No capture moved MATCH -> DIVERGE on either lane.** The runtime-on moves, by capture (first cut; the carve-out
returns dual-view and fabio-style to master's records, byte for byte):

| capture | before | after | objects v1 | objects v2 |
|---|---|---|---|---|
| vw-w3n-draw-block-history-a / b / c, rddt + spy (6) | DIVERGE (drawing withheld: `pine:object-ops-refused`) | **MATCH** | DIVERGE -> MATCH (628 / 1002 colour slots paired) | DIVERGE -> INCONCLUSIVE (no x table) |
| vdubus-pattern-gen-v2-restored-refined spy 1d 2026-10-03 | INCONCLUSIVE (lines withheld, `objects:collector`) | **MATCH** | INCONCLUSIVE -> MATCH (504 lines, 129 labels) | INCONCLUSIVE -> **DIVERGE** (linefills held: vendor 500, ours 204) |
| atr-support-and-resistance rddt + spy | MATCH | MATCH | MATCH | INCONCLUSIVE |
| volume-profile rddt + spy | INCONCLUSIVE | INCONCLUSIVE (the run stops at its limit, by name) | INCONCLUSIVE | INCONCLUSIVE |
| vw-w3-loop-helper-text spy (killed) | DIVERGE (0 of 8 cells) | DIVERGE (8 of 8 cells; `text_color` not carried) | | |
| dual-view rddt + spy | DIVERGE | (first cut INCONCLUSIVE; carve-out: DIVERGE, master's record) | | |
| ledger: auto-trendlines-by-pivots, liquidity-heatmap-swiftedge, support-resistance-fibonacci-retracement x2, atr-support rddt | MATCH | MATCH | | |
| ledger: fourier-extrapolator, volume-profile rddt | INCONCLUSIVE | INCONCLUSIVE (the run stops at its limit, by name) | | |
| ledger: fabio-style | DIVERGE | (first cut DIVERGE, see section 4; carve-out: master's record) | | |

The committed runtime-on snapshot (`docs/pine/vendor-harness/runtime-on/verdicts.json`) carries the regraded
records of the 12 captures whose record this change moves (keyed by file, every other row untouched: the snapshot
is older than master's tree and is re-derived by the landing train, not here); the production snapshot is
unchanged. The reach run (`docs/pine/evidence/2026-11-16-draw1-drawing-objects/runs/report.json`) re-pins the 10
admitted captures the door now draws on the runtime lane (`capabilityEvidenceLane.test.js` re-asks each of the door).

⚠️ vdubus SPY's objects v2 DIVERGE is evidence AGAINST admitting `obj:linefill` on this script: the run holds 204
linefills where TradingView holds 500 (its lines and labels pair and agree). vdubus is not admitted (`obj:linefill`),
so no member is served it.

## 6. Admission: no row added; what each blocked script still needs

The route adds no capability: a moved document is a runtime document, and the server admits it by the capability
rows it already has (`obj:line`, `obj:label`, `obj:box`, `obj:table`, `obj:collection`, `obj:delete`, `obj:getter`
and the value capabilities each script uses), exactly as it admits every other runtime-lane script. So no
`api/data/pine_runtime_allowlist.json` row is added. Of the 8 scripts the route moves after the carve-out:

| script | admitted? | evidence today (runtime-on, this tree) |
|---|---|---|
| `committed:atr-support-and-resistance` | yes | rddt 1d 2026-09-28, spy 1d 2026-10-03: MATCH (all 11 items; objects v1 MATCH, 20 boxes + 20 lines paired; v2 INCONCLUSIVE, no x table) |
| `reference:auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr` | yes (closed bars) | rddt 1d 2026-11-15 (ledger): MATCH |
| `reference:liquidity-heatmap-swiftedge` | yes | rddt 1d 2026-11-15 (ledger): MATCH |
| `committed:volume-profile` | yes (closed bars) | rddt, spy: INCONCLUSIVE: the run stops at its limit, by name (TradingView 203 lines) |
| `reference:fourier-extrapolator-of-price-w-projection-forecast-loxx` | yes (closed bars) | rddt (ledger): INCONCLUSIVE: the run stops at its limit, by name (TradingView 398 lines) |
| `reference:intraday-power-3-visual` | no: `request-other` | rddt + spy (ledger): MATCH |
| `reference:support-resistance-fibonacci-retracement` | no: `request-other` | rddt + spy (ledger): MATCH |
| `committed:vdubus-pattern-gen-v2-restored-refined` | no: `obj:linefill` | rddt MATCH; spy MATCH, objects v2 **DIVERGE** (linefills 204 against 500) |

**What is missing for the three blocked ones.** `request-other` (the roadmap's own evidence unit, step 7, in front of
130 scripts): intraday-power-3-visual and support-resistance-fibonacci-retracement give 4 runtime-drawn MATCH
captures from 2 community scripts, which is the row's count, but they are LEDGER_ONLY: they count only once
re-graded and filed at the engine this ships at (the NUMBER PENDING line below; `evidence_engine regrade`), and
the row's admission is the coordinator's call over the whole `request-other` population (Q-REQ-OTHER-1), not this
unit's. `obj:linefill`: vdubus SPY is evidence AGAINST it (objects v2 DIVERGE on the linefills held); it stays out.

## 7. The member-facing census, both lanes, before and after

The coverage census (`run_census.py`, both lanes, the 679-script sample plus TradingView's 288 whole-script examples:
967 rows) and the map and roadmap tools over it (`coverage_map.py`, `parity_roadmap.py facts` + `build`), BEFORE
(master's door) and AFTER (the carve-out tree), on `158b4918d4` + this branch; the merged tree (master at engine 75)
answers the door identically for every moved script and grades their 15 captures byte-identically (checked after the
merge).

| | before | after |
|---|---:|---:|
| **member-facing: served (runtime-on lane, the server's admission applied)** | **275 / 679 (40.5%)** | **280 / 679 (41.2%)** |
| runtime-on lane, the census granting every script | 285 | 293 |
| host-only lane | 220 | 220 |
| runtime-attached (granted census) | 88 | 96 |
| admitted by capability / declined by admission | 54 / 10 | 59 / 13 |
| `objects` unit, sole scripts (servable) | 45 (44) | 37 (36) |
| production-lane census rows that changed | | 0 of 967 |
| runtime-on census rows that changed | | 17 of 967 (8 sample scripts, 9 examples) |
| coverage ratchet (corpus/committed), runtime-on / production | 91 / 59 | **94** / 59 (snapshot written) |

The 5 newly served: atr-support-and-resistance, auto-trendlines-by-pivots, liquidity-heatmap-swiftedge (their captures
MATCH), volume-profile and fourier-extrapolator (their runs stop at the run's limit on the captured charts, by name,
where the host withheld their lines by name too: `objects:not-carried`, `objects:not-computable`). The 3 more the route draws wait on admission (section 6).

**NUMBER PENDING** (`scriptEngineVersion.js`): the route changes what a member's saved script translates to (a host
document becomes a runtime document), so it needs an engine number; the line is written above
`SCRIPT_ENGINE_VERSION = 75` for the coordinator's train (e76+).

## 8. Risks, stated (the route-by-cost precedent's, and one of this route's own)

- **Server lanes.** Alerts, scans and backtests run a runtime document only at `PINE_RUNTIME_SERVER_STAGE` (dark),
  so a moved script's server-side evaluations are withheld by name where its host document's were run by the
  Python lane. Route-by-cost (#1711) accepted the same trade; it reaches only viewers whose runtime pane is on.
- **Off the listing** (an intraday, weekly or monthly chart, a symbol older than the deep history) the runtime
  lane withholds its warm-up bars where the host document drew its bounded window: a moved script draws fewer
  early bars there. No drawn value differs (the moved script's parity rail, section 9).
- **A saved document** of a moved script is re-translated once on the engine bump (`savedScriptUpgrade.js`) and
  written back as a runtime document; a store that refuses runtime documents keeps the old host document drawn
  from today's translation (the `write-failed` path), never a blank pane.
- **The run's own drawings replace the host program's** for a moved script: a family the run's store withholds
  by name (no capture settles it) is named on the chart, never drawn from the host program instead (WS-E's
  owner trade-off, disclosed in the drawing note).

## 9. Rails and mutation proofs

| rail | what it holds |
|---|---|
| `builder/memberPane/dirtyRoute.test.js` (13) | a lost-drawings host the run draws is MOVED (own drawings, the notes say why); pane off: nothing asked; `routeDirty: false` asks nothing; a different picture (a fill) keeps the host AND its run half, byte for byte; a runtime decline keeps the host with the decline's code; not graded keeps the host; production's latched verdict admits and refuses; a clean host is never offered; the carve-out (`removes`) keeps the host; the two predicates; the moved script's plots equal the host's on every bar from the listing, its six author-hidden rows included |
| `runHalf*.test.jsx`, `runHalf.pairing.rail.test.js`, `runtimeRequestSupply.test.js` (L5 d) | the run half's own rails, asked without the route (their fixtures are hosts the route moves) |
| `capabilityEvidenceLane.test.js` (reach lanes) | the 10 re-pinned rows answer `runtime` at the door |
| `tests/test_pine_capability_admission.py` REACH / RT1 / DRAW1 | no runtime-lane DIVERGE under admission and no MATCH -> DIVERGE over the re-pinned report and the updated snapshot (10 passed) |
| `docs/pine/coverage-ratchet.json` | the runtime-on lane's 94 |

Mutants (each on this tree, the rail run, the file restored from a saved copy, `git hash-object` equal after every
one; control unmutated green): M1 the run's own drawings not required, M2 the author-hidden rows not required, M3
the route ignores the runtime pane gate, M4 the moved document does not carry the hidden rows (3 red), M5 a withheld
paint is not a loss, M6 the plot surface not compared, M7 the carve-out dropped (2 red), M8 the door does not pass
the object gate's answer: **8 of 8 red**.

## 10. The capture queue (one batch, for patrick-54)

`docs/pine/capture-queue-2026-11-18-objects-unit.md`: Q-OBJ1..3, the unit's three sole scripts with no capture
anywhere (`committed:supertrend-explorer`, `reference:custom-screener-with-alerts`,
`reference:screener-for-40-instruments`), NYSE:RDDT 1D + AMEX:SPY 1D. All three also need `request-other`.
