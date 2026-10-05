# Wave 19 wall map - what remains between the corpus and the member door

Measured on `integrate/wave18-2026-10-04` tip `e67b4287e1` (branch `pine/p1-w18-wall-map`, docs only). Wave 18 merged RT11-RT17, H9, H10, F9, W17R, A1.
Instrument: `memberDoorCensus.measure.test.js` (off / on / runtime, `VENDOR_BATCH_CENSUS_RUNTIME=1`) with the 50-library store loaded (`PINE_LIBRARY_STORE`, L1 loader, the store RT10 / RT16 ran with), `--maxWorkers=1`; then a scratch substitution probe through `enterMemberDoor` in the runtime state for every unattached script (never committed; method below).

## 1. Census - wave 18 against wave 17

| state | wave 17 (`rt10-census-w17.json`) | wave 18 tip | change |
|---|---|---|---|
| off | 56 / 266 | **65 / 266** | +9 (lost 0) |
| on | 82 / 266 | **91 / 266** | +9 (lost 0) |
| runtime | 101 / 266 | **120 / 266** | +19 (lost 0) |

Runtime-state attaches by lane: host 91, runtime 29. 0 scripts lost an attach in any state.

- **gained, off** (9): `atr-trailing-stoploss-strategy`, `camarilla-screener`, `highlow-channel-swing`, `ict-killzones-pivots-tfo`, `mtf-key-levels-support-and-resistance`, `pivot-high-low-points`, `relative-volume`, `support-and-resistance__1505`, `vwap-fibo-dev-extensions-strategy`
- **gained, on** (9): `atr-trailing-stoploss-strategy`, `camarilla-screener`, `highlow-channel-swing`, `ict-killzone-index-version`, `mtf-key-levels-support-and-resistance`, `pivot-high-low-points`, `relative-volume`, `support-and-resistance__1505`, `vwap-fibo-dev-extensions-strategy`
- **gained, runtime** (19): `atr-trailing-stoploss-strategy` (host), `blackflag-fts` (runtime), `camarilla-screener` (host), `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated` (runtime), `highlow-channel-swing` (host), `ict-killzone-index-version` (host), `kalman-psar-backquant` (runtime), `kernel-channel-backquant` (runtime), `linear-regression-channel-breakout-strategy` (runtime), `mtf-key-levels-support-and-resistance` (host), `nonlinear-regression-zero-lag-moving-average-loxx` (runtime), `order-block-finder` (runtime), `pivot-high-low-points` (host), `range-filter-bs-signals` (runtime), `relative-volume` (host), `support-and-resistance__1505` (host), `volatility-trend-score-backquant` (runtime), `volume-profile-auto-line-v2` (runtime), `vwap-fibo-dev-extensions-strategy` (host)

- **attached in the runtime state, host lane** (91): `all-chart-patterns-theeccentrictrader`, `artemis-oscillator-pro`, `atr-bands`, `atr-support-and-resistance`, `atr-trailing-stop-by-ceyhun`, `atr-trailing-stoploss-strategy`, `atr-trailing-stoploss`, `auto-trendline-dojiemoji`, `average-day-range-adr-pivots`, `black-scholes-option-pricing-model-w-greeks-loxx`, `btc-charlie-trader-xo-macro-trend-scanner`, `camarilla-screener`, `candlestick-patterns-identified-update-1-17-26`, `cdc-btc-rainbow-road`, `contraction-box-doji-lines`, `cpr-with-mas-super-trend-vwap-by-guruprasadmeduri`, `cumulative-volume-delta__K07lTKE3tP`, `donchian-channels`, `dual-view-htf-candlestick-patterns-theultimator5`, `elliott-wave-3-finder-v2`, `ema-ribbon-trend-filter-strixedge`, `engulfingcandle`, `extrapolated-pivot-connector`, `fib-retracement`, `fibonacci-pivot-points-cc`, `heat-map-seasons`, `high-low-open-mid-ranges`, `highlow-channel-swing`, `htf-candle-footprint-cartel-console`, `htf-liquidity-dashboard-tfo`, `ict-ipda-look-back`, `ict-killzone-index-version`, `ict-killzones-pivots-tfo`, `implied-volatility-suite`, `institutional-smc-order-flow-matrix-pro`, `k-clustering`, `keltner-center-of-gravity-channel`, `keltner-channels-bands`, `linear-regression-channel-tradingfinder-existing-trend-lines`, `liquidation-levels`, `liquidity-engulfing-candles-upslidedown`, `liquidity-heatmap-nephew-sam`, `liquidity-pools`, `macd-shortlong-strategy-for-tradingview-input-optimizer`, `madrid-moving-average-ribbon`, `makuchaku039s-trade-tools-fair-value-gaps`, `market-structure-by-leviathan`, `mcclellan-indicators`, `momentum-volatility-scanner`, `mtf-key-levels-support-and-resistance`, `multi-timeframe-supply-demand-zones`, `multicator-table`, `opening-range-initial-balance-opening-price`, `optimized-keltner-channels-sltp-strategy-for-btc`, `options-max-pain-calculator-backquant`, `pa-zigzag-fibonacci-fan`, `pivot-high-low-points`, `pivot-point-supertrend`, `pmax-explorer`, `poor-man039s-volume-profile`, `position-size-calc`, `position-size-calculator`, `price-action-as-in-book-fibonacci-supportresistant-trendline`, `pro-trading-art-double-top-bottom-with-alert`, `qqe-signals`, `relative-volume`, `reverse-stochastic-momentum-index-on-chart`, `rsi-horizontal-resistance-levels`, `rsi-swing-indicator`, `rvol`, `sector-rotation`, `smt-divergence-ict-01-tradingfinder-smart-money-technique`, `sonarlab-order-blocks`, `supertrend-explorer`, `supertrend-strategy`, `support-and-resistance-multi-time-frame`, `support-and-resistance__1505`, `support-and-resistance__UgNPprOr8h`, `swing-highlow-zigzag-chartprime`, `tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto`, `tradingview-alerts-to-mt4-mt5-strategy-example`, `trend-duration-forecast-chartprime`, `trend-lines-supports-and-resistances`, `trendlines`, `twin-range-filter`, `ultimate-pivot-points`, `vdubus-pattern-gen-v2-restored-refined`, `vold-market-breadth`, `volume-profile`, `vwap-fibo-dev-extensions-strategy`, `zero-lag-ma-trend-levels-chartprime`
- **attached in the runtime state, runtime lane** (29): `adx-and-di-for-v4`, `atr-stepped-pdf-ma-loxx`, `blackflag-fts`, `cc-yata`, `deadband-hysteresis-filter-backquant`, `delta-rsi-oscillator-strategy`, `fibonacci-dolphintradebot`, `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated`, `fvg-trend`, `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat`, `kalman-price-filter-backquant`, `kalman-psar-backquant`, `kernel-channel-backquant`, `linear-regression-channel-breakout-strategy`, `linear-regression-channel`, `nadaraya-watson-rational-quadratic-kernel-non-repainting`, `nonlinear-regression-zero-lag-moving-average-loxx`, `order-block-finder`, `order-blocks`, `parabolic-sar`, `range-filter-bs-signals`, `renko-candles-overlay`, `rolling-vwap`, `trend-targets-algoalpha`, `trendline-pivots-quantvue`, `volatility-trend-score-backquant`, `volume-divergence-by-mm`, `volume-profile-auto-line-v2`, `wyckoff-accumulation-distribution`

Lane attribution of the runtime gains (from the lane sections of `objects-triage-2026-09-28.md`): RT11 highlow-channel-swing, relative-volume (host), order-block-finder (runtime); RT12 atr-trailing-stoploss-strategy (host), nonlinear-regression-zero-lag-moving-average-loxx, range-filter-bs-signals (runtime); RT13/H9 mtf-key-levels-support-and-resistance, vwap-fibo-dev-extensions-strategy, pivot-high-low-points (host); RT14 blackflag-fts, fvg-detector-tradingfinder, kalman-psar-backquant (runtime); support-and-resistance `__1505` (RT14 measured it attaching on the runtime lane; at the wave-18 tip it attaches on the HOST lane in all three states, the base drift RT16 / H9 recorded); RT15 kernel-channel-backquant, volatility-trend-score-backquant, linear-regression-channel-breakout-strategy (runtime); RT16 ict-killzone-index-version (host), volume-profile-auto-line-v2 (runtime); base drift recorded in RT16 / H9: camarilla-screener, ict-killzones-pivots-tfo (off). Every gain is ungraded unless its queue item (Q-RT11f, Q-RT12c-e, Q-RT13a/b/e, Q-RT14d-g, Q-RT15a1-3, Q-RT16g/h) is captured.

## 2. Method - the wall chain, and what it is not

For each of the **146** scripts the runtime state does not attach, the probe repeats: `enterMemberDoor(source)` in the runtime state (both build flags stubbed, every script graded, libraries loaded); if it attaches, stop; otherwise take the refusal's LINE from the runtime lane's own build (`probeRuntimeProgram`, plain and objects-in-run) or from the host translation, record `{guard, construct}`, and neutralise that line - a binding keeps its NAME with a typed stand-in (an `input.*` its default literal, a boolean `close > open`, a string `""`, else `close`), a block header takes its block with it. Two strategies (runtime line first / host line first), up to 15 peels each; the shorter chain wins. Repeated hits of one construct collapse to one wall; consecutive walls are then grouped into FAMILIES (`classify.py`, scratch).

- It is an ESTIMATE in the sense `peelToBuilding.js` documents: a stand-in can create or hide a wall. `pine:undefined` / `pine:arity` hits that follow a peeled tuple are dropped as cascade; `A-TIMEOUT` (the host translator's time budget) appears only after peels and is flagged for re-measure.
- A chain that ends in `cap` / `no-line` / `unpeelable` is OPEN: its named walls are real, but there are more. 56 of 146 are open; they are listed, not ranked.
- "Attach" is the census metric, not a MATCH: a script attached on the host lane with an intrabar request still has those columns withheld at run time (R-LTF), and every new attach needs a capture before the GT allowlist draws it.
- Chains mix lanes: a script is done when EITHER lane builds, so the chain shown is the shorter lane's. The runtime-lane alternative is in `peel-all.json` (scratch) for every script.

Classes: **(a)** engine work; **(b)** blocked on a TradingView capture (queue item named); **(c)** blocked on an owner decision - R-LTF (lower-timeframe data source), strategy broker values, data we do not hold, libraries outside the store; **(d)** correct-by-design refusal.

## 3. Counts

Unattached in the runtime state: **146**. Chain reached an attach: **90** (44 through engine walls alone, 46 with at least one b / c / d wall); chain open: **56**.

| class | scripts with >= 1 wall of the class | scripts whose FIRST wall is of the class |
|---|---|---|
| (a) engine | 127 | 98 |
| (b) capture-blocked | 25 | 19 |
| (c) owner decision | 43 | 24 |
| (d) correct by design | 15 | 5 |

Closed chains by what blocks them (beyond engine walls): a only: 44, c: 28, b: 15, d: 3.

Wall families (scripts on whose chain each family appears, all 146):

| family | class | scripts | what it is | queue |
|---|---|---|---|---|
| A-STATEMENTS | a | 64 | statement shapes: `:=` / `var` state the host refuses, `switch`/`if` values, tuples, comma statements, cycles | - |
| A-USERFN | a | 37 | user functions: call frames, globals read in a function, tuple returns, functions called for effect | - |
| A-HISTORY | a | 27 | history and windows over runtime state: `x[n]` with a computed n, `(expr)[1]`, history under a condition, `ta.hma`/`ta.vwap` over state, `max_bars_back` | - |
| A-COLLECTIONS | a | 21 | arrays / matrix / map ops (`array.fill/insert/sort/binary_search/percentrank/standardize`, matrices, maps, `for ... in`) | - |
| A-DRAW-OPS | a | 21 | drawings on the runtime lane: getters (`line.get_y1`, `box.get_top`), setters / `delete` as statements, `label.all`, creates inside functions | - |
| A-BUILTINS | a | 19 | missing builtins (`ta.nvi/pvi/dmi/barssince/percentile_nearest_rank/pivot_point_levels`, `acos`, `barstate.isnew`, `weekofyear`, `syminfo.type`, `ticker.heikinashi`, `int()` over state ...) | - |
| A-TEXT | a | 19 | text values: string inputs with options, `str.*` over state, `tostring` formats | - |
| A-UDT | a | 18 | user-defined types: field reads / writes on records, methods, arrays of records | - |
| A-LIB-CALL | a | 7 | library functions called from the host lane / runtime lane | - |
| A-TFSECONDS | a | 7 | `timeframe.in_seconds` / `timeframe.change` over timeframe text | - |
| A-PRESENTATION | a | 6 | presentation on the runtime lane: fill targets, `barcolor` from a function, `color.new(na, na)`, a paint offset from a variable | - |
| A-REQ-VARTF | a | 5 | request of the chart symbol at an input / parameter timeframe: fold the default (R-LTF applies if it is below the chart) | - |
| A-INPUT-TIME | a | 5 | `input.time(timestamp(...))` default | - |
| A-TIMEOUT | a | 4 | host translator time budget exceeded (re-measure: may be a peel artefact) | - |
| A-INPUT-TF | a | 3 | `input.timeframe` (default "" / "D") read as a value | - |
| A-SESSION-INPUT | a | 2 | `input.session` carrier (its default literal) | - |
| B-SESSION | b | 11 | `time(tf, session)`: wrapping / whole-day / parameter-held sessions | Q-RT16a |
| B-LOOKAHEAD | b | 8 | `lookahead = barmerge.lookahead_on` (realtime half unmeasured) | none queued (M1) |
| B-VARIP | b | 3 | `varip` (equal to `var` on closed bars?) | Q-RT14b |
| B-ASIN-TONUMBER | b | 2 | `asin` / `str.tonumber` | Q-RT11e |
| B-SESSION-BARSTATE | b | 1 | `session.isfirstbar` / `islastbar` | Q-RT16d |
| B-TIMECLOSE | b | 1 | `time_close(tf, bars_back)` | Q-RT16c |
| B-EMPTY-SYMBOL | b | 1 | `""` as the request SYMBOL | Q-RT13c |
| B-FROMSECONDS | b | 1 | `timeframe.from_seconds` | Q-RT16f |
| B-FILL-GRADIENT | b | 1 | gradient `fill(p1, p2, top_value, ...)` | Q-RT15d |
| C-LTF | c | 18 | lower-timeframe data (R-LTF): intrabar requests, intraday codes on a daily chart, `time(<lower tf>)` | - |
| C-DATA | c | 13 | another symbol / dataset we do not hold (USI breadth, INDEX sector breadth, BINANCE OI/crypto, NSE, user-typed symbols) | - |
| C-STRAT | c | 9 | strategy broker values (`strategy.position_size`, equity, opentrades ...) | - |
| C-LIB | c | 4 | a library not in the 50-library store | - |
| D-NOTHING-DRAWN | d | 8 | nothing drawable at defaults once the earlier walls are peeled (all rows hidden / withheld / strategy-only) | - |
| D-VIEWPORT | d | 6 | visible-range reads (`chart.left_visible_bar_time`, VisibleChart library): no fixed answer without a viewport contract | - |
| D-BUDGET | d | 1 | lookback budget 960 (a real cost; H9 kept it refused) | - |

## 4. Engine walls ranked by scripts COMPLETED

44 scripts attach with engine walls alone. Distance (distinct wall families): 1: 28, 2: 14, 3: 1, 4: 1.

| family | completes ALONE | on a completable chain |
|---|---|---|
| A-STATEMENTS | 11 | 21 |
| A-TEXT | 4 | 8 |
| A-HISTORY | 4 | 7 |
| A-BUILTINS | 2 | 6 |
| A-COLLECTIONS | 1 | 4 |
| A-UDT | 3 | 4 |
| A-TIMEOUT | 0 | 3 |
| A-USERFN | 1 | 3 |
| A-INPUT-TIME | 1 | 2 |
| A-DRAW-OPS | 1 | 2 |
| A-REQ-VARTF | 0 | 1 |
| A-LIB-CALL | 0 | 1 |
| A-TFSECONDS | 0 | 1 |

⛔ The completers are not the biggest rows. `A-STATEMENTS` appears on 64 chains of 146 but completes 11 alone; `A-USERFN` appears on 37 and completes 1. Most of the large families sit on OPEN chains (section 7) - building them moves no script until the rest of those chains is built.

## 5. Lane briefs (wave 19)

Ranked by scripts completed. File ownership: H1 owns `pine.js` statement code; H2 and T touch `pine.js` only in append-only tables (merge after H1); R1 owns `pineRuntimeFrontend.js` history / frames; R2 adds frontend dispatch rows only (merge after R1). No two briefs own the same region.

| lane | walls | completes alone | + with another lane | primary files |
|---|---|---|---|---|
| H1 | Host-lane state, `:=` and statement shapes | 14 | 6 | `ast/pine.js` (statements), `ast/bind.js` |
| R2 | Runtime-lane collections, records (UDT) and drawing getters / setters | 6 | 3 | `runtime/collections.js`, `runtime/records.js`, `runtime/objectStore.js`, `runtime/handles.js` |
| H2 | Host-lane builtins and windows | 5 | 5 | `ast/interpret.js`, `ast_interpret.py`, `ast/pcf.js`, `ast/budget.js` |
| T | Text values and inputs (both lanes) | 5 | 6 | `runtime/text.js`, `builder/memberPane/builderInputs.js` |
| R1 | Runtime-lane history, windows and user frames | 4 | 3 | `ast/pineRuntimeFrontend.js` (history, frames), `runtime/lowerIr.js`, `runtime/vm.js` |

All five together complete the 44 engine-only scripts (34 alone, 10 needing two or more lanes). The next completers after them are owner decisions (section 6): R-LTF alone gates 12 more with engine walls built, data we do not hold 7, strategy broker values 5, libraries outside the store 4.

### H1 - Host-lane state, `:=` and statement shapes

**Completes alone (14):** `delta-imbalance-map-joat`, `smart-money-breakouts-chartprime`, `smt-divergence-ict-killzones`, `moving-averages-as-support-resistance-mtf`, `one-sided-gaussian-support-resistance-rate-loxx`, `deviation-scaled-moving-average-w-dsl-loxx`, `std-filtered-adaptive-exponential-hull-moving-average-loxx`, `market-structure-trend-targets-chartprime`, `machine-learning-rsi-bullvision`, `volume-suite-by-leviathan`, `volatility-stop-mtf`, `atr-trend-bands-misu`, `smoothed-gaussian-trend-filter-algoalpha`, `volatility-coil-edge-bullbyte`.
**With another lane (6):** `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` (H1+H2), `smart-money-volume-activity-algoalpha` (H1+H2), `machine-learning-knn-based-strategy` (T+H1), `advanced-custom-multi-ma-signals-emasmavwmavwap` (H1+H2 (request at a parameter timeframe)), `multiple-mtf-moving-average-xdecow` (T+R1+H1), `machine-learning-moving-average-backquant` (H1+R2+R1+T).

**Walls (host lane, `pine:reassign` / `pine:tuple` / `pine:state` / `pine:cycle` / `pine:block`):**
1. `x := <expr>` inside an `if` / `for` block (delta-imbalance-map-joat `newBullZone := bullGap`; smart-money-breakouts-chartprime `TradeisON := true`; smt-divergence-ict-killzones `alert_bear := true`; moving-averages-as-support-resistance-mtf `min_higher := array.get(ma_array, x)` in a `for`). The largest single completer: 4 scripts on one wall.
2. Tuple destructuring from a user function, a library or a tuple builtin (market-structure-trend-targets-chartprime `[color, trend_line, trend] = market_structure()`; machine-learning-rsi-bullvision 5-tuple from `knnEnhance`; volume-suite-by-leviathan `[vwap, sdU, sdL] = ta.vwap(hlc3, anchor, k)`; volatility-stop-mtf `TradingView/ta/12 vStop`; deviation-scaled-moving-average-w-dsl-loxx `loxxmas.super`).
3. `var` state and self-referencing recurrences the host refuses (`pine:state`, `pine:cycle`: std-filtered-adaptive-exponential-hull-moving-average, atr-trend-bands-misu `lastState := nz(lastState[1])`, smoothed-gaussian-trend-filter-algoalpha, volatility-coil-edge-bullbyte).
4. `for` / `switch` blocks as values (one-sided-gaussian-support-resistance-rate-loxx `for i = 0 to matrix.rows(g) - 1`; std-filtered `float src = switch srcoption`).

**Files likely touched:** `app/src/components/chart/engine/ast/pine.js` (statement / reassign / tuple translation), `ast/bind.js`, `ast/interpret.js` + `api/services/ast_interpret.py` only if a new node kind is needed. **Owns `pine.js`'s statement region; H2 and T append to `pine.js` tables only and merge after H1.**

**Evidence:** no committed capture of any completer (byte or name) - the lane must queue one per completer (RDDT 1D from the listing + SPY 1D), as RT12-RT16 did. Three completers (atr-trend-bands-misu, smoothed-gaussian-trend-filter-algoalpha, volatility-coil-edge-bullbyte) reach `A-TIMEOUT` after their peels: re-measure the translator time budget first; they may be 1-wall scripts or may need a budget ruling. delta-imbalance-map-joat and volume-suite-by-leviathan attach on the host lane with their `request.security_lower_tf` columns withheld (R-LTF) - an attach, not a full picture.

### H2 - Host-lane builtins and windows

**Completes alone (5):** `smart-money-interest-index-algoalpha`, `smart-money-volume-index-algoalpha`, `camarilla`, `trend-levels-chartprime`, `atr-stop-loss-indicator`.
**With another lane (5):** `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` (H1+H2), `smart-money-volume-activity-algoalpha` (H1+H2), `previous-day-high-and-low-separators-dailyweekly` (H2+R1), `smarter-snr` (H2+T), `advanced-custom-multi-ma-signals-emasmavwmavwap` (H1+H2 (request at a parameter timeframe)).

**Walls (host lane builtins and windows):**
1. `ta.nvi` / `ta.pvi` (smart-money-interest-index-algoalpha, smart-money-volume-index-algoalpha: `ta.nvi - ta.ema(ta.nvi, 255)`) - Pine reference definitions, cumulative from the listing (withhold off the listing as `ta.obv` / `cum` do, H6's `cum:window`).
2. v4 `rsi(x, y)` two-series form (camarilla: `mfi = rsi(upper_s, lower_s)` = `100 - 100 / (1 + x / y)`), refused as `pine:window`.
3. `ta.highest(n)` / `ta.lowest(n)` with a per-bar length (trend-levels-chartprime `h1 := ta.highest(bars)`; also smarter-snr `ta.highest(high[Period], bar_pl1)`).
4. `syminfo.type` and a library call through ZenLibrary/9 (atr-stop-loss-indicator).
5. Pairs: `ta.barssince(...)[1]` (heikin-ashi-true-strength-index, with H1), `barstate.isnew` (smart-money-volume-activity-algoalpha, with H1), `ta.pivot_point_levels` + `dayofweek(time + offset)` (previous-day-high-and-low-separators, with R1).

**Files likely touched:** `ast/interpret.js`, `api/services/ast_interpret.py`, `ast/pcf.js`, `ast/budget.js` + `api/services/ast_budget.py` (variable window), builtin TABLE rows in `ast/pine.js` (`BUILTIN_CALL_TREE`, append-only; merge after H1).

**Evidence:** none captured. `ta.nvi` / `ta.pvi` / v4 two-argument `rsi` need a probe capture each before they are served (manual text + a `vw-` probe; nothing queued yet). The variable-length window has C-era captures for fixed lengths only.

### R1 - Runtime-lane history, windows and user frames

**Completes alone (4):** `market-structure-break-order-block`, `zigzag-multi-time-frame-with-fibonacci-retracement`, `momentum-based-zigzag`, `optimized-trend-tracker`.
**With another lane (3):** `previous-day-high-and-low-separators-dailyweekly` (H2+R1), `multiple-mtf-moving-average-xdecow` (T+R1+H1), `machine-learning-moving-average-backquant` (H1+R2+R1+T).

**Walls (runtime lane):**
1. `runtime:history-dynamic-offset` - a window or offset whose length is computed per bar (market-structure-break-order-block `ta.lowest(nz(since > 0 ? since : 1, 1))`; zigzag-multi-time-frame-with-fibonacci-retracement `highestbars(high, nz(len, 1))`; also the runtime path of trend-levels-chartprime). Family total 27 chains / 7 completable; 11 scripts share the `na`-guarded length form.
2. A windowed builtin (`ta.hma`, `ta.vwma`, `ta.vwap`) over a user function's PARAMETER series (`runtime:call-windowed-state`: momentum-based-zigzag `moving_average(_series, _length, _smoothing)`).
3. A user function the host declares but cannot call (optimized-trend-tracker `Var_Func(src, length)`; host lane) - the R1 path is the runtime frame.

**Files likely touched:** `ast/pineRuntimeFrontend.js` (history planning, windowed calls in frames), `runtime/lowerIr.js`, `runtime/vm.js`, `runtime/limits.js`. **Owns the frontend's history / call-frame region; R2 adds dispatch rows only and merges after R1.**

**Evidence:** none captured for the completers. RT10's `pivotAt` and frame-local committed series (Q-RT10a/c) and RT12's series window length (Q-RT12a) are the nearest probes; a dynamic-length window needs its own probe rows (what TradingView answers on the bars where the length is `na` / 0).

### R2 - Runtime-lane collections, records (UDT) and drawing getters / setters

**Completes alone (6):** `bollinger-band-width-percentile`, `candelacharts-equal-highslows-eqheql`, `pivot-trendlines-with-breaks-hg`, `rsi-trendlines-with-breakouts-hg`, `elliot-wave-detector-pro`, `trendlinesample`.
**With another lane (3):** `range-filter-dw` (R2+T), `support-and-resistance-logistic-regression-flux-charts` (R2+T), `machine-learning-moving-average-backquant` (H1+R2+R1+T).

**Walls (runtime lane collections, records, drawings):**
1. `array.binary_search_rightmost` / `array.fill` / `array.sort` / `matrix.*` (bollinger-band-width-percentile; range-filter-dw `array.fill`; one-sided-gaussian's runtime path `matrix.new`).
2. UDT fields read where a plot / alert reads them (candelacharts-equal-highslows-eqheql `alertcondition(bull_alert.ehl, ...)`; elliot-wave-detector-pro `lastP.idx`, `array.push(primaryPivots, Pivot.new(...))`).
3. A library's UDT with nested drawing fields and their getters (pivot-trendlines-with-breaks-hg, rsi-trendlines-with-breakouts-hg: `plData.lines.startline.get_y2()` from `HoanGhetti/SimpleTrendlines`).
4. Drawing getters / setters as statements (trendlinesample `line.get_price(sup, bar_index)`; support-and-resistance-logistic-regression-flux-charts `label.set_x`, `line.set_x2`, with T for its label text).

**Files likely touched:** `runtime/collections.js`, `runtime/records.js`, `runtime/objectStore.js`, `runtime/handles.js`, `runtime/runtimeObjects.js`; dispatch rows in `ast/pineRuntimeFrontend.js` (merge after R1).

**Evidence:** none captured for the completers; C48 / RT10 (`for ... in`) and RT14 (array-typed UDT fields, Q-RT14f/g) are the nearest measured behaviour. `line.get_price` needs the extend / x-interpolation rule measured (one probe row per `extend`).

### T - Text values and inputs (both lanes)

**Completes alone (5):** `macd-with-filter-visual-backtest-module-sample`, `williams-fractal-trailing-stops`, `scalping-strategy-with-williams-r-macd-and-sma-1-minute-only`, `fibonacci-retracement-mtflog`, `session-hilo`.
**With another lane (6):** `machine-learning-knn-based-strategy` (T+H1), `range-filter-dw` (R2+T), `smarter-snr` (H2+T), `support-and-resistance-logistic-regression-flux-charts` (R2+T), `multiple-mtf-moving-average-xdecow` (T+R1+H1), `machine-learning-moving-average-backquant` (H1+R2+R1+T).

**Walls (text values and inputs):**
1. A string `input(...)` / `input.string` with `options` read in a comparison (`pine:text-value`: macd-with-filter-visual-backtest-module-sample `mafilt_type`; williams-fractal-trailing-stops `inputWilliamsFlipInput`; range-filter-dw `rng_scale`, with R2). The text is an input at its default - foldable at bind time like `input.timeframe` at its default.
2. `str.tostring(timeframe.period) == "1"` (scalping-strategy-with-williams-r-macd-and-sma-1-minute) - the chart's own timeframe text; Q-RT11a measures `str.tostring` of text.
3. `str.format_time(t, "dd.MM.yyyy - HH:mm")` in a label (fibonacci-retracement-mtflog; its next wall `ta.max(x)` is a peel cascade).
4. `input.time(timestamp("..."))` as a default (session-hilo; machine-learning-knn-based-strategy with H1's `ta.cci` role order).

**Files likely touched:** `runtime/text.js`, `app/src/components/chart/builder/memberPane/builderInputs.js` (input defaults), the `pine:text-value` guard and `input.time` default reader in `ast/pine.js` (narrow; merge after H1 and H2).

**Evidence:** C48 measured `input.timeframe("")` printing the empty string; `str.format_time` has no capture (needs one probe: three formats on SPY 1D and 60). Q-RT11a (queued) covers `str.tostring` of text.
## 6. Blocked walls - capture queue, owner decisions, by design

### (b) blocked on a TradingView capture

| wall | queue item | scripts on whose chain it stands | the only non-engine wall for |
|---|---|---|---|
| B-SESSION: `time(tf, session)`: wrapping / whole-day / parameter-held sessions | Q-RT16a | 11 | 4 (ict-turtle-soup-flux-charts, session-highs-and-lows-indicator-smc-sessions-dst-safe, sessions, volume-profile-v054beta) |
| B-LOOKAHEAD: `lookahead = barmerge.lookahead_on` (realtime half unmeasured) | none queued (M1) | 8 | 5 (cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels, delta-volume-v21-by-kernel-phi, multi-timeframe-fvg-tfo, previous-n-daysweeksmonths-high-low, tehthomas-aligned-timeframe-fair-value-gaps) |
| B-VARIP: `varip` (equal to `var` on closed bars?) | Q-RT14b | 3 | 3 (bolingger-bands-inside-bar-boxes, ema-92150-vwap-macd-rsi-pro-v6, inside-bar-boxes) |
| B-ASIN-TONUMBER: `asin` / `str.tonumber` | Q-RT11e | 2 | 0 |
| B-SESSION-BARSTATE: `session.isfirstbar` / `islastbar` | Q-RT16d | 1 | 0 |
| B-TIMECLOSE: `time_close(tf, bars_back)` | Q-RT16c | 1 | 0 |
| B-EMPTY-SYMBOL: `""` as the request SYMBOL | Q-RT13c | 1 | 1 (machine-learning-logistic-regression-v3) |
| B-FROMSECONDS: `timeframe.from_seconds` | Q-RT16f | 1 | 0 |
| B-FILL-GRADIENT: gradient `fill(p1, p2, top_value, ...)` | Q-RT15d | 1 | 1 (volume-delta-hapharmonic) |

### (c) blocked on an owner decision

| decision | scripts on whose chain it stands | it is the only non-engine wall for (scripts it would unlock, with the engine walls also built) |
|---|---|---|
| C-LTF: lower-timeframe data (R-LTF): intrabar requests, intraday codes on a daily chart, `time(<lower tf>)` | 18 | 12: 3-level-zigzag-semafor, ai-supertrend-x-pivot-percentile-strategy-presenttrading, delta-volume-candles-lucf, fair-value-gap, liquidity-engulfing-displacement-msf, liquidity-levels-sonarlab, mtf-dashboard-pro-rsi-fib-sr-volume-strixedge, multi-timeframe-rsi-buy-sell-strategy-tradedots, multi-timeframe-trend-indicator, smart-money-breakout-channels-algoalpha, volume-profile-bar-magnified-order-blocks-jacobmagleby, zigzag-ma-pattern-recognition |
| C-DATA: another symbol / dataset we do not hold (USI breadth, INDEX sector breadth, BINANCE OI/crypto, NSE, user-typed symbols) | 13 | 7: 4c-nyse-market-breadth-ratio, ad-line-of-sp-sectors, banknifty-mcclellan-oscillator, cumulative-volume-delta, open-interest-suite-aggregated-by-leviathan, sub, volume-spikes-growing-volume-signals-with-alerts-scanner |
| C-STRAT: strategy broker values (`strategy.position_size`, equity, opentrades ...) | 9 | 5: 72s-strategy-adaptive-hull-moving-average-pt1, atr-god-strategy-by-tradesmart, heikin-ashi-supertrend, inside-bar-strategy-w-sl, trailing-take-profit-trailing-stop-loss |
| C-LIB: a library not in the 50-library store | 4 | 4: fx-market-sessions, machine-learning-lorentzian-classification, rate-of-change, smc-structures-and-multi-timeframe-fvg-ma-py |

### (d) correct-by-design refusals

| refusal | scripts | only non-engine wall for |
|---|---|---|
| D-NOTHING-DRAWN: nothing drawable at defaults once the earlier walls are peeled (all rows hidden / withheld / strategy-only) | 8 | 0 |
| D-VIEWPORT: visible-range reads (`chart.left_visible_bar_time`, VisibleChart library): no fixed answer without a viewport contract | 6 | 2: chart-vwap, cvd-cumulative-volume-delta-chart |
| D-BUDGET: lookback budget 960 (a real cost; H9 kept it refused) | 1 | 1: rsi-vwap-indicator |

## 7. Open chains (peel did not reach an attach)

These 56 scripts are long programs (SMC suites, multi-timeframe dashboards, ML scripts). The walls named are real and first; the count is a lower bound. None is a wave-19 target; they are where the large families (`A-USERFN`, `A-COLLECTIONS`, `A-UDT`, `A-DRAW-OPS`) live.

## 8. The 266 scripts

State: the census states the script attaches in (lane in the runtime state). First wall: the runtime state's refusal (the runtime lane's decline code when the fallback was asked, else the host stage). Chain: the wall families in peel order (`family (construct, queue item)`). Class: the classes on the chain; `(open)` = chain not closed; `[lane]` = the wave-19 brief that completes it.

| script | state | first wall (runtime state) | wall chain | class | capture |
|---|---|---|---|---|---|
| `3-level-zigzag-semafor` | refused | `lower-tf:lookahead` lower-tf:lookahead — look-ahead on (or a `lookahead` spelling this door cannot read) at `5`, below this chart' | C-LTF (`time(<timeframe>)`) | c | - |
| `4c-nyse-market-breadth-ratio` | refused | `runtime:request` 12 `request.security` read another symbol or timeframe, and this pane holds only the chart's own bars, so it i | C-DATA (`sym`) | c | - |
| `72s-strategy-adaptive-hull-moving-average-pt1` | refused | `pine:statement` this Pine line is not a shape the translator reads | A-STATEMENTS (`xhma`) -> A-USERFN (`xhma`) -> A-BUILTINS (`acos`) -> C-STRAT (`strategy.*`) | a+c | - |
| `ad-line-of-sp-sectors` | refused | `runtime:history-expression` history over an EXPRESSION containing a mutable value — `(a + b)[1]` needs its own committed series, and distr | A-HISTORY (`(a + b)[1]`) -> A-USERFN (`runtime:function`) -> C-DATA (`symbol literal`) | a+c | - |
| `adaptive-trend-following-suite-alpha-extract` | refused | `pine:role-order` this table states what kind each argument is and never what role it plays, so several price series cannot be m | A-STATEMENTS (`for`) -> A-TIMEOUT (`relativeVol`) -> A-USERFN (`runtime:function`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `advanced-custom-multi-ma-signals-emasmavwmavwap` | refused | `runtime:history-expression` history over an EXPRESSION containing a mutable value — `(a + b)[1]` needs its own committed series, and distr | A-STATEMENTS (`_ma`) -> A-REQ-VARTF (`sym`) | a [H1+H2 (request at a parameter timeframe)] | - |
| `adx-and-di-for-v4` | runtime (runtime) | - | - | attached | yes |
| `ai-supertrend-x-pivot-percentile-strategy-presenttrading` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | A-REQ-VARTF (`sym`) -> C-LTF (`input.timeframe`) -> A-COLLECTIONS (`for … in`) -> A-BUILTINS (`ta.percentile_nearest_rank`) | a+c | - |
| `all-chart-patterns-theeccentrictrader` | on/runtime (host) | - | - | attached | yes |
| `anchored-vwap-pinch-handoff-intervals-and-signals` | refused | `runtime:call-windowed-state` a WINDOWED builtin fed by a mutable variable — this one needs the series bridge — `ta.vwap` | A-HISTORY (`ta.vwap`) -> A-USERFN (`avwap`) -> A-PRESENTATION (`fill()`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `artemis-oscillator-pro` | off/on/runtime (host) | - | - | attached | yes |
| `asianrange-and-killzones` | refused | `runtime:statement` a statement shape this front end does not recognise — the session clock reads the timeframe the bars are ON, s | B-SESSION (`timeframe.period`, Q-RT16a) -> A-SESSION-INPUT (`input.session`) -> A-DRAW-OPS (`box`) -> A-USERFN (`runtime:function`) -> ... (cap: chain longer than the peel reached) | a+b (open) | - |
| `atr-bands` | off/on/runtime (host) | - | - | attached | yes |
| `atr-god-strategy-by-tradesmart` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | A-STATEMENTS (`switch_ma`) -> C-STRAT (`strategy.*`) | a+c | - |
| `atr-stepped-pdf-ma-loxx` | runtime (runtime) | - | - | attached | yes |
| `atr-stop-loss-indicator` | refused | `pine:builtin` `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker` | A-BUILTINS (`syminfo.type`) -> A-LIB-CALL (`zen.toWhole`) | a [H2] | - |
| `atr-support-and-resistance` | off/on/runtime (host) | - | - | attached | yes |
| `atr-trailing-stop-by-ceyhun` | off/on/runtime (host) | - | - | attached | yes |
| `atr-trailing-stoploss-strategy` | off/on/runtime (host) | - | - | attached | - |
| `atr-trailing-stoploss` | off/on/runtime (host) | - | - | attached | yes |
| `atr-trend-bands-misu` | refused | `runtime:colour-nz` `nz()` of a colour with no replacement — what Pine answers for an `na` colour there is witnessed by no capture | A-TIMEOUT (`midb`) -> A-STATEMENTS (`lastState`) | a [H1] | - |
| `auto-harmonic-patterns-open-source` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `size.small` | A-DRAW-OPS (`line.get_y2`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `auto-trendline-dojiemoji` | off/on/runtime (host) | - | - | attached | yes |
| `auto-trendlines-tradingfinder-support-resistance-signal-alerts` | refused | `runtime:library` a Pine library import — this lane compiles the script it is given, not a library graph — `import TFlab/AlertSe | A-LIB-CALL (` — the library `) -> A-HISTORY (`(a + b)[1]`) -> A-COLLECTIONS (`array.insert`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `average-day-range-adr-pivots` | off/on/runtime (host) | - | - | attached | yes |
| `banknifty-mcclellan-oscillator` | refused | `runtime:history-expression` history over an EXPRESSION containing a mutable value — `(a + b)[1]` needs its own committed series, and distr | A-HISTORY (`(a + b)[1]`) -> A-USERFN (`Close`) -> C-DATA (`symbol literal`) | a+c | - |
| `bigbeluga-smart-money-concepts` | refused | `builder` member door refused: this script declares nothing a chart can draw | A-DRAW-OPS (`obj.delete()`) -> A-UDT (`lc.start`) -> A-STATEMENTS (`pine:block`) -> A-USERFN (`runtime:function`) -> A-COLLECTIONS (`array.fnOB`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `black-scholes-option-pricing-model-w-greeks-loxx` | on/runtime (host) | - | - | attached | yes |
| `blackflag-fts` | runtime (runtime) | - | - | attached | - |
| `bolingger-bands-inside-bar-boxes` | refused | `runtime:varip` varip — intrabar persistence, which a closed-bar runtime cannot reproduce | B-VARIP (`runtime:varip`, Q-RT14b) | b | - |
| `bollinger-band-width-percentile` | refused | `runtime:statement` a statement shape this front end does not recognise — `input.string` needs a text default that is fixed when t | A-COLLECTIONS (`array.binary_search_rightmost`) | a [R2] | - |
| `boom-hunter-entry-point-screener-alerts` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | C-DATA (`security`) -> A-TEXT (`pine:text-value`) -> ... (cap: chain longer than the peel reached) | a+c (open) | - |
| `breaks-and-retests-hg` | refused | `runtime:expression-statement` an expression evaluated for effect — nothing in this runtime has an effect yet — `drawBox.set_extend()` | A-DRAW-OPS (`drawBox.set_extend()`) -> A-STATEMENTS (`pine:statement`) -> A-USERFN (`ph`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `btc-charlie-trader-xo-macro-trend-scanner` | off/on/runtime (host) | - | - | attached | yes |
| `bull-vs-bear-market-intraday-sessions-kioseff-trading` | refused | `runtime:udt-method` a Pine 6 `method` declared on a user type — a method is a user FUNCTION whose receiver is argument 0, and this | A-UDT (`method`) -> A-COLLECTIONS (`matrix.new`) -> A-USERFN (`data.timeVolMat.add_col()`) -> A-STATEMENTS (`pine:statement`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `buy-monday-exit-tuesday` | refused | `pine:strategy-call` a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders | C-STRAT (`strategy.*`) -> D-NOTHING-DRAWN (`runtime:no-output`) -> ... (no-line: chain longer than the peel reached) | c+d (open) | - |
| `camarilla-screener` | off/on/runtime (host) | - | - | attached | - |
| `camarilla` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | A-HISTORY (`rsi`) | a [H2] | - |
| `candelacharts-equal-highslows-eqheql` | refused | `runtime:expression-statement` an expression evaluated for effect — nothing in this runtime has an effect yet — `obj.delete()` | A-UDT (`bull_alert.ehl`) | a [R2] | - |
| `candlestick-patterns-identified-update-1-17-26` | off/on/runtime (host) | - | - | attached | yes |
| `candlestick-patterns-on-backtest` | refused | `pine:input-kind` this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15  | A-INPUT-TIME (`input.time`) -> A-STATEMENTS (`pine:statement`) -> A-COLLECTIONS (`matrix.new`) -> A-USERFN (`runtime:function`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `cc-yata` | runtime (runtime) | - | - | attached | yes |
| `cdc-btc-rainbow-road` | off/on/runtime (host) | - | - | attached | yes |
| `chart-champions-part-1-npoc-levels-vwaps` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | B-SESSION (`time(<timeframe>, <session>)`, Q-RT16a) -> C-LTF (`time`) -> ... (cap: chain longer than the peel reached) | b+c (open) | - |
| `chart-vwap` | refused | `pine:statement` this Pine line is not a shape the translator reads | A-STATEMENTS (`chartVwap`) -> D-VIEWPORT (`chart.left_visible_bar_time`) | a+d | - |
| `contraction-box-doji-lines` | on/runtime (host) | - | - | attached | yes |
| `correlation-matrix` | refused | `runtime:function` a user-defined function — the runtime has no call frames yet — `function_label` ends in a drawing, which the o | A-USERFN (`function_label`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | B-LOOKAHEAD (`sym`, none queued (M1)) | b | - |
| `cpr-with-mas-super-trend-vwap-by-guruprasadmeduri` | off/on/runtime (host) | - | - | attached | yes |
| `cumulative-volume-delta__K07lTKE3tP` | off/on/runtime (host) | - | - | attached | yes |
| `cumulative-volume-delta__c772250751` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | C-DATA (`sym`) | c | - |
| `cvd-cumulative-volume-delta-candles` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `timeframe.from_seconds` — in the import | C-LTF (`timeframe.from_seconds`) -> A-STATEMENTS (`pine:statement`) -> A-UDT (`upVolumes.sum`) -> ... (cap: chain longer than the peel reached) | a+c (open) | - |
| `cvd-cumulative-volume-delta-chart` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `chart.left_visible_bar_time` — in the i | A-UDT (`upVolumes.sum`) -> A-STATEMENTS (`reset`) -> D-VIEWPORT (`chart.left_visible_bar_time`) | a+d | - |
| `deadband-hysteresis-filter-backquant` | runtime (runtime) | - | - | attached | yes |
| `delta-imbalance-map-joat` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | A-STATEMENTS (`newBullZone`) | a [H1] | - |
| `delta-rsi-oscillator-strategy` | runtime (runtime) | - | - | attached | yes |
| `delta-volume-candles-lucf` | refused | `pine:builtin` `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker` | C-LTF (`syminfo.type`) -> A-COLLECTIONS (`ltfVolumesUp`) -> A-BUILTINS (`int`) -> A-LIB-CALL (`LucfTa.zeroOne`) | a+c | - |
| `delta-volume-v21-by-kernel-phi` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | B-LOOKAHEAD (`security`, none queued (M1)) -> A-STATEMENTS (`var`) | a+b | - |
| `deviation-scaled-moving-average-w-dsl-loxx` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `ticker.heikinashi` | A-STATEMENTS (`var`) | a [H1] | - |
| `donchian-channels` | off/on/runtime (host) | - | - | attached | yes |
| `double-topbottom-ultimate-os` | refused | `runtime:directive` a compiler directive — `max_bars_back()` | A-COLLECTIONS (`zigzagvalues`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `dual-view-htf-candlestick-patterns-theultimator5` | off/on/runtime (host) | - | - | attached | yes |
| `elliot-wave-detector-pro` | refused | `pine:builtin` `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker` | A-COLLECTIONS (`primaryPivots`) -> A-UDT (`lastP.idx`) | a [R2] | - |
| `elliott-wave-3-finder-v2` | off/on/runtime (host) | - | - | attached | yes |
| `ema-92150-vwap-macd-rsi-pro-v6` | refused | `runtime:varip` varip — intrabar persistence, which a closed-bar runtime cannot reproduce | B-VARIP (`runtime:varip`, Q-RT14b) | b | - |
| `ema-ribbon-trend-filter-strixedge` | off/on/runtime (host) | - | - | attached | yes |
| `engulfingcandle` | off/on/runtime (host) | - | - | attached | yes |
| `extrapolated-pivot-connector` | off/on/runtime (host) | - | - | attached | yes |
| `fair-value-gap` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | C-LTF (`time`) -> A-INPUT-TF (`input.timeframe`) | a+c | - |
| `fib-retracement` | on/runtime (host) | - | - | attached | yes |
| `fibonacci-dolphintradebot` | runtime (runtime) | - | - | attached | yes |
| `fibonacci-pivot-points-cc` | off/on/runtime (host) | - | - | attached | yes |
| `fibonacci-retracement-mtflog` | refused | `runtime:call-text-state` a TEXT builtin applied to a mutable value — text is a value-model change, not a series one — `str.format_time` | A-TEXT (`str.format_time`) | a [T] | - |
| `fibonacci-retracement-statistics-by-volprofex` | refused | `runtime:call-conversion-state` a numeric CONVERSION applied to a mutable value — a cast, not a series — `int` | A-BUILTINS (`int`) -> A-USERFN (`runtime:function`) -> A-REQ-VARTF (`sym`) -> A-DRAW-OPS (`box.all`) -> A-STATEMENTS (`pine:statement`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `flawless-victory-strategy` | refused | `builder` member door refused: this script declares nothing a chart can draw | D-NOTHING-DRAWN (`door`) -> ... (no-line: chain longer than the peel reached) | d (open) | - |
| `footprint-iq-pro-tradingiq` | refused | `pine:statement` this Pine line is not a shape the translator reads | A-STATEMENTS (`pine:statement`) -> ... (unpeelable: chain longer than the peel reached) | a (open) | - |
| `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated` | runtime (runtime) | - | - | attached | - |
| `fvg-trend` | runtime (runtime) | - | - | attached | yes |
| `fx-market-sessions` | refused | `runtime:library` a Pine library import — this lane compiles the script it is given, not a library graph — `import boitoki/Aweso | C-LIB (`boitoki/AwesomeColor/9`) -> A-UDT (`data.session`) | a+c | - |
| `heat-map-seasons` | off/on/runtime (host) | - | - | attached | yes |
| `heikin-ashi-supertrend` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `ticker.heikinashi` | A-BUILTINS (`ticker.heikinashi`) -> C-STRAT (`strategy.*`) -> A-LIB-CALL (`bot.getPairOverrides`) -> A-TEXT (`str.format`) | a+c | - |
| `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` | refused | `runtime:function-global-state` a function body reading a mutable GLOBAL — a frame has no address for one yet — `RSIhk_Cl` | A-STATEMENTS (`ma1`) -> A-BUILTINS (`ta.barssince`) | a [H1+H2] | - |
| `high-low-open-mid-ranges` | on/runtime (host) | - | - | attached | yes |
| `higher-time-frame-fair-value-gap-zeroherotrading` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `session.isfirstbar` | B-SESSION-BARSTATE (`session.isfirstbar`, Q-RT16d) -> B-TIMECLOSE (`time_close(<timeframe>)`, Q-RT16c) -> B-LOOKAHEAD (`request.security`, none queued (M1)) -> A-USERFN (`runtime:function`) -> A-UDT (`htfBar.consistentUpdates`) -> A-STATEMENTS (`else`) -> ... (cap: chain longer than the peel reached) | a+b (open) | - |
| `highlow-channel-swing` | off/on/runtime (host) | - | - | attached | - |
| `htf-candle-footprint-cartel-console` | on/runtime (host) | - | - | attached | yes |
| `htf-liquidity-dashboard-tfo` | on/runtime (host) | - | - | attached | yes |
| `ict-institutional-order-flow-fadi` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-HISTORY (`na`) -> A-UDT (`Trend_Settings.displacement_show`) -> A-STATEMENTS (`else`) -> A-USERFN (`f_highlightDisplacement`) -> A-PRESENTATION (`barcolor()`) -> A-DRAW-OPS (`.isbullish`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `ict-ipda-look-back` | on/runtime (host) | - | - | attached | yes |
| `ict-killzone-index-version` | on/runtime (host) | - | - | attached | - |
| `ict-killzones-pivots-tfo` | off/on/runtime (host) | - | - | attached | yes |
| `ict-turtle-soup-flux-charts` | refused | `pine:window` a Pine length has to reach the engine as a plain whole number — argument 2 of `ta.highest` — `3600 / 60 / (864 | A-HISTORY (`ta.highest`) -> A-USERFN (`log.info()`) -> B-SESSION (`time(<timeframe>, <session>)`, Q-RT16a) | a+b | - |
| `implied-volatility-suite` | off/on/runtime (host) | - | - | attached | yes |
| `initial-balance-ib-and-previous-day-week-high-low-close` | refused | `runtime:statement` a statement shape this front end does not recognise — the session clock reads the timeframe the bars are ON, s | B-SESSION (`timeframe.period`, Q-RT16a) -> A-USERFN (`timeinrange`) -> B-LOOKAHEAD (`sym`, none queued (M1)) | a+b | - |
| `inside-bar-boxes` | refused | `runtime:varip` varip — intrabar persistence, which a closed-bar runtime cannot reproduce | B-VARIP (`runtime:varip`, Q-RT14b) | b | - |
| `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat` | runtime (runtime) | - | - | attached | yes |
| `inside-bar-strategy-w-sl` | refused | `pine:collection` an array, a matrix or a map is outside the expression grammar this engine runs | A-STATEMENTS (`insideBar`) -> C-STRAT (`strategy.*`) | a+c | - |
| `institutional-smc-order-flow-matrix-pro` | off/on/runtime (host) | - | - | attached | yes |
| `ipda-standard-deviations-dexterlab-x-tfo-x-toodegrees` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | A-BUILTINS (`deviations.size`) -> A-UDT (`method`) -> A-TFSECONDS (`timeframe.in_seconds`) -> A-USERFN (`runtime:function`) -> A-STATEMENTS (`else`) -> D-VIEWPORT (`chart.point.from_time`) -> A-TEXT (`pine:text-value`) -> ... (cap: chain longer than the peel reached) | a+d (open) | - |
| `k-clustering` | on/runtime (host) | - | - | attached | yes |
| `kalman-price-filter-backquant` | runtime (runtime) | - | - | attached | yes |
| `kalman-psar-backquant` | runtime (runtime) | - | - | attached | - |
| `keltner-center-of-gravity-channel` | off/on/runtime (host) | - | - | attached | yes |
| `keltner-channels-bands` | off/on/runtime (host) | - | - | attached | yes |
| `kernel-channel-backquant` | runtime (runtime) | - | - | attached | - |
| `linear-regression-channel-200` | refused | `runtime:directive` a compiler directive — `max_bars_back()` | A-STATEMENTS (`price1`) -> A-DRAW-OPS (`midLine.delete()`) -> D-NOTHING-DRAWN (`door`) -> ... (no-line: chain longer than the peel reached) | a+d (open) | - |
| `linear-regression-channel-breakout-strategy` | runtime (runtime) | - | - | attached | - |
| `linear-regression-channel-tradingfinder-existing-trend-lines` | on/runtime (host) | - | - | attached | yes |
| `linear-regression-channel` | runtime (runtime) | - | - | attached | - |
| `liquidation-levels` | off/on/runtime (host) | - | - | attached | yes |
| `liquidity-engulfing-candles-upslidedown` | off/on/runtime (host) | - | - | attached | yes |
| `liquidity-engulfing-displacement-msf` | refused | `lower-tf:store-unmeasured` lower-tf:store-unmeasured — `60` is below this chart's timeframe, so it reads intraday bars — and our intraday | A-BUILTINS (`barstate.isnew`) -> C-LTF (`sym`) | a+c | - |
| `liquidity-heatmap-nephew-sam` | on/runtime (host) | - | - | attached | yes |
| `liquidity-levels-sonarlab` | refused | `runtime:statement` a statement shape this front end does not recognise — `pivothigh` returns its value `rightbars` after the pivo | A-DRAW-OPS (`line.get_y1`) -> A-HISTORY (`pivothigh`) -> A-TFSECONDS (`timeframe.in_seconds`) -> C-LTF (`input.timeframe`) | a+c | - |
| `liquidity-pools` | off/on/runtime (host) | - | - | attached | yes |
| `macd-shortlong-strategy-for-tradingview-input-optimizer` | off/on/runtime (host) | - | - | attached | yes |
| `macd-with-filter-visual-backtest-module-sample` | refused | `pine:text-value` this script uses a text feature our chart does not render yet. This lane stops at the first one, so none of th | A-TEXT (`pine:text-value`) | a [T] | - |
| `machine-learning-knn-based-strategy` | refused | `pine:input-kind` this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15  | A-INPUT-TIME (`input.time`) -> A-STATEMENTS (`ta.cci`) | a [T+H1] | - |
| `machine-learning-logistic-regression-v3` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | B-EMPTY-SYMBOL (`sym`, Q-RT13c) -> A-TEXT (`str.tostring`) -> A-HISTORY (`dot`) | a+b | - |
| `machine-learning-lorentzian-classification__21f5ec5277` | refused | `runtime:library` a Pine library import — this lane compiles the script it is given, not a library graph — `import jdehorty/MLEx | C-LIB (`jdehorty/MLExtensions/2`) -> A-STATEMENTS (`prediction`) -> A-UDT (`filter.volatility`) -> A-LIB-CALL (`kernels.rationalQuadratic`) | a+c | - |
| `machine-learning-lorentzian-classification__5c7960db26` | refused | `runtime:call-windowed-state` a WINDOWED builtin fed by a mutable variable — this one needs the series bridge — `ta.rsi` — in the imported l | A-STATEMENTS (`prediction`) -> A-UDT (`filter.volatility`) -> C-STRAT (`strategy.*`) -> A-LIB-CALL (`kernels.rationalQuadratic`) -> A-INPUT-TIME (`input.time`) -> ... (cap: chain longer than the peel reached) | a+c (open) | - |
| `machine-learning-moving-average-backquant` | refused | `pine:role-order` this table states what kind each argument is and never what role it plays, so several price series cannot be m | A-STATEMENTS (`ta.cci`) -> A-COLLECTIONS (`array.sort`) -> A-HISTORY (`ta.change`) -> A-TEXT (`str.tostring`) | a [H1+R2+R1+T] | - |
| `machine-learning-rsi-bullvision` | refused | `pine:block` a Pine block spans several statements and this engine stores a single expression | A-STATEMENTS (`knnRsi`) | a [H1] | - |
| `madrid-moving-average-ribbon` | off/on/runtime (host) | - | - | attached | yes |
| `makuchaku039s-trade-tools-fair-value-gaps` | on/runtime (host) | - | - | attached | yes |
| `market-profile-with-tpo` | refused | `pine:builtin` `syminfo.type` is a Pine built-in this engine holds no VALUE for, though it holds its sibling `syminfo.ticker` | A-BUILTINS (`syminfo.type`) -> A-STATEMENTS (`else`) -> B-SESSION (`timeframe.period`, Q-RT16a) -> A-USERFN (`runtime:function`) -> ... (cap: chain longer than the peel reached) | a+b (open) | - |
| `market-sessions-and-volume-profile-by-leviathan` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | C-LTF (`sym`) -> A-HISTORY (`na`) -> B-SESSION (`runtime:statement`, Q-RT16a) -> A-BUILTINS (`weekofyear`) -> A-COLLECTIONS (`array.fill`) -> ... (cap: chain longer than the peel reached) | a+b+c (open) | - |
| `market-structure-break-order-block` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-HISTORY (`na`) | a [R1] | - |
| `market-structure-by-leviathan` | on/runtime (host) | - | - | attached | yes |
| `market-structure-inducements-ict-tradinfinder-choch-bos-sweeps` | refused | `runtime:history-expression` history over an EXPRESSION containing a mutable value — `(a + b)[1]` needs its own committed series, and distr | A-HISTORY (`(a + b)[1]`) -> A-DRAW-OPS (`line.get_y1`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `market-structure-trend-targets-chartprime` | refused | `pine:function` this Pine function maps to nothing the engine grammar declares — `line`. This table declares abs, accum, adx,  | A-STATEMENTS (`trend`) | a [H1] | - |
| `mcclellan-indicators` | off/on/runtime (host) | - | - | attached | yes |
| `mgi-levels-suite` | refused | `runtime:function` a user-defined function — the runtime has no call frames yet — a parameter this front end cannot read (`=`) —  | A-USERFN (`=`) -> C-LTF (`request.security_lower_tf`) -> B-LOOKAHEAD (`lookahead`, none queued (M1)) -> ... (cap: chain longer than the peel reached) | a+b+c (open) | - |
| `momentum-based-zigzag` | refused | `runtime:call-windowed-state` a WINDOWED builtin fed by a mutable variable — this one needs the series bridge — `ta.hma` | A-HISTORY (`ta.hma`) -> A-USERFN (`runtime:function`) | a [R1] | - |
| `momentum-volatility-scanner` | off/on/runtime (host) | - | - | attached | yes |
| `moving-averages-as-support-resistance-mtf` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | A-STATEMENTS (`min_higher`) | a [H1] | - |
| `mtf-dashboard-pro-rsi-fib-sr-volume-strixedge` | refused | `lower-tf:store-unmeasured` lower-tf:store-unmeasured — `15` is below this chart's timeframe, so it reads intraday bars — and our intraday | C-LTF (`sym`) | c | - |
| `mtf-key-levels-support-and-resistance` | off/on/runtime (host) | - | - | attached | - |
| `mtf-watchlist-charts-anan` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | C-DATA (`security`) -> A-STATEMENTS (`runtime:tuple`) -> A-USERFN (`cutLastDigit`) -> ... (cap: chain longer than the peel reached) | a+c (open) | - |
| `multi-timeframe-fvg-tfo` | refused | `lower-tf:lookahead` lower-tf:lookahead — look-ahead on (or a `lookahead` spelling this door cannot read) at `5`, below this chart' | B-LOOKAHEAD (`lookahead`, none queued (M1)) -> A-DRAW-OPS (`.get_bottom`) | a+b | - |
| `multi-timeframe-rsi-buy-sell-strategy-tradedots` | refused | `lower-tf:store-unmeasured` lower-tf:store-unmeasured — `5` is below this chart's timeframe, so it reads intraday bars — and our intraday  | C-LTF (`sym`) | c | - |
| `multi-timeframe-supply-demand-zones` | on/runtime (host) | - | - | attached | yes |
| `multi-timeframe-trend-indicator` | refused | `runtime:request` runtime:request — the timeframe of a request has to be fixed when the script is written — it decides which bar | C-LTF (`runtime:request`) -> A-DRAW-OPS (`table.new`) -> A-USERFN (`makeTable`) -> A-TEXT (`input.string`) -> A-HISTORY (`ta.hma`) | a+c | - |
| `multicator-table` | off/on/runtime (host) | - | - | attached | yes |
| `multiple-mtf-moving-average-xdecow` | refused | `runtime:request-with-state` a data request whose argument is a mutable value — `request.security` | A-TFSECONDS (`timeframe.in_seconds`) -> A-USERFN (`f_showInCurrentTimeframe`) -> A-STATEMENTS (`switch`) | a [T+R1+H1] | - |
| `nadaraya-watson-rational-quadratic-kernel-non-repainting` | runtime (runtime) | - | - | attached | yes |
| `neural-network-buy-and-sell-signals` | refused | `runtime:history-expression` history over an EXPRESSION containing a mutable value — `(a + b)[1]` needs its own committed series, and distr | A-STATEMENTS (`var`) -> A-USERFN (`f_shouldShowGrade`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `nonlinear-regression-zero-lag-moving-average-loxx` | runtime (runtime) | - | - | attached | - |
| `nubia-auto-midas-anchored-vwap-xdecow` | refused | `runtime:tuple` a tuple — the runtime has no multiple-value form yet — a bracket list outside a destructuring | A-STATEMENTS (`runtime:tuple`) -> A-HISTORY (`na`) -> A-PRESENTATION (`fill()`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num` | refused | `runtime:function` a user-defined function — the runtime has no call frames yet — a parameter this front end cannot read (`=`) —  | A-USERFN (`=`) -> D-NOTHING-DRAWN (`runtime:no-output`) -> ... (no-line: chain longer than the peel reached) | a+d (open) | - |
| `one-sided-gaussian-support-resistance-rate-loxx` | refused | `runtime:array` an array or collection operation — the runtime has no collections yet — `matrix.new` | A-STATEMENTS (`for`) | a [H1] | - |
| `open-interest-profile-fixed-range-by-leviathan` | refused | `pine:input-kind` this Pine input carries a default the engine grammar cannot hold — `input.time` — 20 uses across 11 files. 15  | A-INPUT-TIME (`input.time`) -> D-VIEWPORT (`chart.right_visible_bar_time`) -> A-HISTORY (`na`) -> C-DATA (`string`) -> A-USERFN (`runtime:function`) -> A-COLLECTIONS (`array.fill`) -> ... (cap: chain longer than the peel reached) | a+c+d (open) | - |
| `open-interest-suite-aggregated-by-leviathan` | refused | `pine:function` this Pine function maps to nothing the engine grammar declares — `string`. This table declares abs, accum, adx | C-DATA (`sym`) | c | - |
| `opening-range-initial-balance-opening-price` | off/on/runtime (host) | - | - | attached | yes |
| `optimized-keltner-channels-sltp-strategy-for-btc` | off/on/runtime (host) | - | - | attached | yes |
| `optimized-trend-tracker` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-USERFN (`Var_Func`) | a [R1] | - |
| `options-max-pain-calculator-backquant` | on/runtime (host) | - | - | attached | yes |
| `order-block-finder` | runtime (runtime) | - | - | attached | - |
| `order-blocks` | runtime (runtime) | - | - | attached | - |
| `pa-zigzag-fibonacci-fan` | off/on/runtime (host) | - | - | attached | yes |
| `parabolic-sar` | runtime (runtime) | - | - | attached | yes |
| `pivot-high-low-points` | off/on/runtime (host) | - | - | attached | - |
| `pivot-point-supertrend` | off/on/runtime (host) | - | - | attached | yes |
| `pivot-trendlines-with-breaks-hg` | refused | `pine:undefined` this Pine name was never given a value in the pasted script — `l1` — in the imported library `HoanGhetti/Simpl | A-UDT (`plData.lines.startline.get_y2`) | a [R2] | - |
| `pmax-explorer` | off/on/runtime (host) | - | - | attached | yes |
| `poor-man039s-volume-profile` | on/runtime (host) | - | - | attached | yes |
| `position-size-calc` | on/runtime (host) | - | - | attached | yes |
| `position-size-calculator` | off/on/runtime (host) | - | - | attached | yes |
| `power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `str.tonumber` | B-ASIN-TONUMBER (`str.tonumber`, Q-RT11e) -> B-SESSION (`time(<timeframe>, <session>)`, Q-RT16a) -> A-HISTORY (`runtime:conditional-history`) -> ... (no-line: chain longer than the peel reached) | a+b (open) | - |
| `previous-day-high-and-low-separators-dailyweekly` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | A-BUILTINS (`ta.pivot_point_levels`) -> A-STATEMENTS (`dayofweek(…)`) | a [H2+R1] | - |
| `previous-n-daysweeksmonths-high-low` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | B-LOOKAHEAD (`sym`, none queued (M1)) | b | - |
| `price-action-as-in-book-fibonacci-supportresistant-trendline` | off/on/runtime (host) | - | - | attached | yes |
| `pro-trading-art-double-top-bottom-with-alert` | on/runtime (host) | - | - | attached | yes |
| `qqe-signals` | off/on/runtime (host) | - | - | attached | yes |
| `range-filter-bs-signals` | runtime (runtime) | - | - | attached | - |
| `range-filter-dw` | refused | `runtime:array` an array or collection operation — the runtime has no collections yet — `array.fill` | A-COLLECTIONS (`array.fill`) -> A-TEXT (`pine:text-value`) | a [R2+T] | - |
| `rate-of-change` | refused | `runtime:library` a Pine library import — this lane compiles the script it is given, not a library graph — `import ClassicScott/ | C-LIB (`ClassicScott/MyMovingAveragesLibrary`) -> A-LIB-CALL (`mymas.ema`) -> A-STATEMENTS (`basis`) | a+c | - |
| `relative-volume-at-time` | refused | `runtime:input-state` an input whose DEFAULT or BOUNDS read a mutable variable — an input is settled once, before bar 0, so both hav | A-TEXT (`input`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `relative-volume` | off/on/runtime (host) | - | - | attached | - |
| `renderingnature-smc-reversal-engine-v71` | refused | `pine:input-kind` this Pine input carries a default the engine grammar cannot hold — `input.timeframe` — 158 uses across 61 file | A-TEXT (`pine:text-value`) -> A-PRESENTATION (`pine:plot-offset`) -> A-STATEMENTS (`pine:statement`) -> ... (unpeelable: chain longer than the peel reached) | a (open) | - |
| `renko-candles-overlay` | runtime (runtime) | - | - | attached | yes |
| `reverse-stochastic-momentum-index-on-chart` | off/on/runtime (host) | - | - | attached | yes |
| `rolling-vwap` | runtime (runtime) | - | - | attached | yes |
| `rsi-horizontal-resistance-levels` | on/runtime (host) | - | - | attached | yes |
| `rsi-swing-indicator` | on/runtime (host) | - | - | attached | yes |
| `rsi-trendlines-with-breakouts-hg` | refused | `pine:undefined` this Pine name was never given a value in the pasted script — `l1` — in the imported library `HoanGhetti/Simpl | A-UDT (`plData.lines.startline.get_y1`) | a [R2] | - |
| `rsi-vwap-indicator` | refused | `budget:lookback` exceeds the lookback budget — this formula measures 976 and the cap is 960. `vwapOf()` reaches back one whole  | D-BUDGET (`vwapOf()`) | d | - |
| `rvol` | off/on/runtime (host) | - | - | attached | yes |
| `scalping-strategy-with-williams-r-macd-and-sma-1-minute-only` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `str.tostring` | A-TEXT (`str.tostring`) | a [T] | - |
| `screener-mean-reversion-channel` | refused | `pine:function` this Pine function maps to nothing the engine grammar declares — `asin` — did you mean `sin`?. This table decl | B-ASIN-TONUMBER (`asin`, Q-RT11e) -> A-TEXT (`pine:text-value`) -> C-DATA (`security`) -> ... (cap: chain longer than the peel reached) | a+b+c (open) | - |
| `sector-rotation` | off/on/runtime (host) | - | - | attached | yes |
| `session-highs-and-lows-indicator-smc-sessions-dst-safe` | refused | `runtime:statement` a statement shape this front end does not recognise — the session clock reads the timeframe the bars are ON, s | B-SESSION (`timeframe.period`, Q-RT16a) -> A-SESSION-INPUT (`input.session`) | a+b | - |
| `session-hilo` | refused | `runtime:statement` a statement shape this front end does not recognise — a session has to reach the engine as a literal like `"09 | A-INPUT-TIME (`input.time`) | a [T] | - |
| `session-tpo-profile` | refused | `runtime:statement` a statement shape this front end does not recognise — a session has to reach the engine as a literal like `"09 | B-SESSION (`"0930-1600"`, Q-RT16a) -> A-USERFN (`inSession`) -> A-TEXT (`str.substring`) -> A-COLLECTIONS (`array.insert`) -> A-BUILTINS (`pine:builtin`) -> ... (no-line: chain longer than the peel reached) | a+b (open) | - |
| `sessions` | refused | `runtime:statement` a statement shape this front end does not recognise — the session clock reads the timeframe the bars are ON, s | B-SESSION (`time(<timeframe>, <session>)`, Q-RT16a) -> A-USERFN (`is_session`) | a+b | - |
| `smart-money-breakout-channels-algoalpha` | refused | `runtime:call-undeclared-builtin-state` a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — this one is blocked on the bu | A-BUILTINS (`ta.barssince`) -> A-STATEMENTS (`for`) -> A-DRAW-OPS (`boxes.size`) -> C-LTF (`lower tf`) | a+c | - |
| `smart-money-breakouts-chartprime` | refused | `runtime:expression-statement` an expression evaluated for effect — nothing in this runtime has an effect yet — `Volume.SCR.push()` | A-STATEMENTS (`TradeisON`) | a [H1] | - |
| `smart-money-concept-tradingfinder-major-minor-ob-fvg-smc` | refused | `runtime:array` an array or collection operation — the runtime has no collections yet — `array.insert` | A-COLLECTIONS (`array.insert`) -> A-HISTORY (`(a + b)[1]`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `smart-money-concepts-by-welotrades` | refused | `pine:input-kind` this Pine input carries a default the engine grammar cannot hold — `input.timeframe` — 158 uses across 61 file | A-COLLECTIONS (`bullishOrderBlocksList`) -> A-STATEMENTS (`bullishOBTouched`) -> A-TFSECONDS (`timeframe.in_seconds`) -> A-DRAW-OPS (`highBoxArrayHTF`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `smart-money-interest-index-algoalpha` | refused | `pine:function` this Pine function maps to nothing the engine grammar declares — `ta.nvi`, and this table has RULED on that na | A-BUILTINS (`ta.nvi`) | a [H2] | - |
| `smart-money-volume-activity-algoalpha` | refused | `pine:builtin` `barstate.isnew` is a Pine built-in this engine holds no COLUMN for, though it holds its siblings: requires pe | A-STATEMENTS (`retailBullBar`) -> A-BUILTINS (`barstate.isnew`) | a [H1+H2] | - |
| `smart-money-volume-index-algoalpha` | refused | `pine:function` this Pine function maps to nothing the engine grammar declares — `ta.nvi`, and this table has RULED on that na | A-BUILTINS (`ta.nvi`) | a [H2] | - |
| `smarter-snr` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `str.length` | A-TEXT (`str.length`) -> A-HISTORY (`ta.highest`) | a [H2+T] | - |
| `smc-structures-and-multi-timeframe-fvg-ma-py` | refused | `pine:input-kind` this Pine input carries a default the engine grammar cannot hold — `input.timeframe` — 158 uses across 61 file | A-STATEMENTS (`var`) -> A-USERFN (`get_structure_highest_bar`) -> A-REQ-VARTF (`sym`) -> C-LIB (`TradingView/ZigZag/7`) | a+c | - |
| `smoothed-gaussian-trend-filter-algoalpha` | refused | `runtime:fill-gradient` the gradient form of `fill` — `fill(plot1, plot2, top_value, bottom_value, top_color, bottom_color)` shades ve | A-STATEMENTS (`var`) -> A-TIMEOUT (`trend1`) | a [H1] | - |
| `smt-divergence-ict-01-tradingfinder-smart-money-technique` | off/on/runtime (host) | - | - | attached | yes |
| `smt-divergence-ict-killzones` | refused | `runtime:statement` a statement shape this front end does not recognise — a session has to reach the engine as a literal like `"09 | A-STATEMENTS (`alert_bear`) | a [H1] | - |
| `sonarlab-order-blocks` | on/runtime (host) | - | - | attached | yes |
| `std-filtered-adaptive-exponential-hull-moving-average-loxx` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `ticker.heikinashi` | A-STATEMENTS (`for`) | a [H1] | - |
| `stop-loss-and-take-profit-in-example` | refused | `pine:strategy-call` a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders | C-STRAT (`strategy.*`) -> A-USERFN (`runtime:function`) -> A-PRESENTATION (`fill()`) -> D-NOTHING-DRAWN (`runtime:no-output`) -> ... (no-line: chain longer than the peel reached) | a+c+d (open) | - |
| `stop-loss-clustering-breakouts-kioseff-trading` | refused | `pine:statement` this Pine line is not a shape the translator reads | A-STATEMENTS (`pine:statement`) -> ... (unpeelable: chain longer than the peel reached) | a (open) | - |
| `strength-of-divergence-across-multiple-indicators` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-HISTORY (`na`) -> A-UDT (`d`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `strong-start-rvol-dashboard` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-HISTORY (`runtime:history-dynamic-offset`) -> ... (no-line: chain longer than the peel reached) | a (open) | - |
| `sub` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | C-DATA (`sym`) | c | - |
| `supertrend-explorer` | off/on/runtime (host) | - | - | attached | - |
| `supertrend-relative-volume-kernel-optimized-flux-charts` | refused | `runtime:array` an array or collection operation — the runtime has no collections yet — `array.standardize` | A-COLLECTIONS (`array.standardize`) -> A-BUILTINS (`math.e`) -> A-USERFN (`gaussian`) -> A-STATEMENTS (`var`) -> ... (unpeelable: chain longer than the peel reached) | a (open) | - |
| `supertrend-strategy` | off/on/runtime (host) | - | - | attached | yes |
| `supply-demand-mtf-flux-charts` | refused | `pine:input-kind` this Pine input carries a default the engine grammar cannot hold — `input.timeframe` — 158 uses across 61 file | A-INPUT-TF (`input.timeframe`) -> A-COLLECTIONS (`map.new`) -> A-TFSECONDS (`timeframe.in_seconds`) -> A-USERFN (`runtime:function`) -> A-STATEMENTS (`runtime:tuple`) -> A-UDT (`timeframeInfo1.isEnabled`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `support-and-resistance-logistic-regression-flux-charts` | refused | `runtime:expression-statement` an expression evaluated for effect — nothing in this runtime has an effect yet — `sr.predictionLabel.set_x()` | A-DRAW-OPS (`sr.predictionLabel.set_x()`) -> A-TEXT (`str.tostring`) | a [R2+T] | - |
| `support-and-resistance-multi-time-frame` | off/on/runtime (host) | - | - | attached | yes |
| `support-and-resistance__1505` | off/on/runtime (host) | - | - | attached | - |
| `support-and-resistance__UgNPprOr8h` | off/on/runtime (host) | - | - | attached | yes |
| `support-and-resistance__c4792aabd0` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-HISTORY (`na`) -> A-STATEMENTS (`runtime:statement`) -> ... (unpeelable: chain longer than the peel reached) | a (open) | - |
| `support-resistance-mtf-flux-charts` | refused | `runtime:array` an array or collection operation — the runtime has no collections yet — `map.new` | A-COLLECTIONS (`map.new`) -> A-USERFN (`alerts.put()`) -> A-REQ-VARTF (`runtime:request`) -> A-UDT (`tfSRInfoList.size`) -> A-INPUT-TF (`input.timeframe`) -> B-FROMSECONDS (`timeframe.from_seconds`, Q-RT16f) -> A-TFSECONDS (`timeframe.in_seconds`) -> A-STATEMENTS (`runtime:statement`) -> ... (cap: chain longer than the peel reached) | a+b (open) | - |
| `swing-highlow-zigzag-chartprime` | on/runtime (host) | - | - | attached | yes |
| `swing-points-and-liquidity-by-leviathan` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | C-DATA (`sym`) -> A-DRAW-OPS (`box.new`) -> A-STATEMENTS (`runtime:statement`) -> ... (unpeelable: chain longer than the peel reached) | a+c (open) | - |
| `take-profit-multi-timeframe` | refused | `pine:strategy-call` a strategy order or `strategy.*` value comes from the simulated broker TradingView runs for a strategy (orders | C-LTF (`sym`) -> C-STRAT (`strategy.*`) -> D-NOTHING-DRAWN (`pine:hidden-only`) -> ... (cap: chain longer than the peel reached) | c+d (open) | - |
| `tehthomas-aligned-timeframe-fair-value-gaps` | refused | `runtime:request` runtime:request — `lookahead` — the realtime half of this alignment is not measured yet, and a guess here read | B-LOOKAHEAD (`lookahead`, none queued (M1)) -> A-DRAW-OPS (`box.new`) | a+b | - |
| `tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto` | off/on/runtime (host) | - | - | attached | yes |
| `tradingview-alerts-to-mt4-mt5-strategy-example` | off/on/runtime (host) | - | - | attached | yes |
| `trailing-take-profit-trailing-stop-loss` | refused | `pine:statement` this Pine line is not a shape the translator reads — in the imported library `jason5480/chrono_utils/7`, line  | A-STATEMENTS (`longStopLossPrice`) -> C-STRAT (`strategy.*`) | a+c | - |
| `trend-duration-forecast-chartprime` | off/on/runtime (host) | - | - | attached | yes |
| `trend-levels-chartprime` | refused | `pine:function` this Pine function maps to nothing the engine grammar declares — `label`. This table declares abs, accum, adx, | A-HISTORY (`ta.highest`) | a [H2] | - |
| `trend-line-harrybot` | refused | `pine:block` a Pine block spans several statements and this engine stores a single expression | A-STATEMENTS (`pine:block`) -> A-USERFN (`draw`) -> A-DRAW-OPS (`line.get_x1`) -> D-NOTHING-DRAWN (`draw`) -> ... (no-line: chain longer than the peel reached) | a+d (open) | - |
| `trend-lines-supports-and-resistances` | off/on/runtime (host) | - | - | attached | yes |
| `trend-targets-algoalpha` | runtime (runtime) | - | - | attached | yes |
| `trendline-pivots-quantvue` | runtime (runtime) | - | - | attached | - |
| `trendlines` | off/on/runtime (host) | - | - | attached | yes |
| `trendlinesample` | refused | `runtime:conditional-history` runtime:conditional-history — `sup[…]` inside a block or function that does not run on every bar — Pine keeps  | A-DRAW-OPS (`line.new`) | a [R2] | - |
| `twin-range-filter` | off/on/runtime (host) | - | - | attached | yes |
| `ultimate-pivot-points` | off/on/runtime (host) | - | - | attached | yes |
| `vdubus-pattern-gen-v2-restored-refined` | on/runtime (host) | - | - | attached | yes |
| `visualizing-displacement-tfo` | refused | `runtime:withheld-all` every output it draws is withheld (`barcolor`: an `offset` that is not a whole-number literal on `barcolor` ha | D-NOTHING-DRAWN (`runtime:withheld-all`) -> ... (no-line: chain longer than the peel reached) | d (open) | - |
| `volatility-coil-edge-bullbyte` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-STATEMENTS (`isContracted`) -> A-TIMEOUT (`pine:timeout`) | a [H1] | - |
| `volatility-stop-mtf` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `timeframe.from_seconds` | A-STATEMENTS (`var`) | a [H1] | - |
| `volatility-trend-score-backquant` | runtime (runtime) | - | - | attached | - |
| `vold-market-breadth` | on/runtime (host) | - | - | attached | yes |
| `volume-delta-hapharmonic` | refused | `runtime:call-text-state` a TEXT builtin applied to a mutable value — text is a value-model change, not a series one — `str.tostring` wi | A-TEXT (`str.tostring`) -> A-USERFN (`S`) -> A-DRAW-OPS (`label.new`) -> A-STATEMENTS (`runtime:statement`) -> A-PRESENTATION (`color.new`) -> B-FILL-GRADIENT (`fill()`, Q-RT15d) | a+b | - |
| `volume-delta-oi-delta-kioseff-trading` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | C-LTF (`sym`) -> A-STATEMENTS (`runtime:tuple`) -> A-TEXT (`font.family_default`) -> A-COLLECTIONS (`m`) -> A-DRAW-OPS (`label.all`) -> ... (cap: chain longer than the peel reached) | a+c (open) | - |
| `volume-divergence-by-mm` | runtime (runtime) | - | - | attached | - |
| `volume-footprint-measuring-classical-indicators-by-math-geometry-intro` | refused | `pine:statement` this Pine line is not a shape the translator reads | A-STATEMENTS (`pine:statement`) -> ... (unpeelable: chain longer than the peel reached) | a (open) | - |
| `volume-open-interest-footprint-by-leviathan` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `chart.left_visible_bar_time` | D-VIEWPORT (`chart.left_visible_bar_time`) -> A-HISTORY (`na`) -> A-STATEMENTS (`runtime:statement`) -> A-COLLECTIONS (`array.fill`) -> C-DATA (`symbol literal`) -> ... (cap: chain longer than the peel reached) | a+c+d (open) | - |
| `volume-profile-auto-line-v2` | runtime (runtime) | - | - | attached | - |
| `volume-profile-bar-magnified-order-blocks-jacobmagleby` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | C-LTF (`sym`) -> A-DRAW-OPS (`line.new`) | a+c | - |
| `volume-profile-plus` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `chart.left_visible_bar_time` | D-VIEWPORT (`chart.left_visible_bar_time`) -> A-STATEMENTS (`START_TIME = switch …`) -> ... (unpeelable: chain longer than the peel reached) | a+d (open) | - |
| `volume-profile-v054beta` | refused | `runtime:statement` a statement shape this front end does not recognise — a session has to reach the engine as a literal like `"09 | B-SESSION (`"0930-1600"`, Q-RT16a) -> A-HISTORY (`max_bars_back()`) | a+b | - |
| `volume-profile` | on/runtime (host) | - | - | attached | yes |
| `volume-spikes-growing-volume-signals-with-alerts-scanner` | refused | `pine:function` this Pine function maps to nothing the engine grammar declares — `ta.dmi`. This table declares abs, accum, adx | A-BUILTINS (`ta.dmi`) -> A-STATEMENTS (`downSpike`) -> C-DATA (`symbol literal`) | a+c | - |
| `volume-suite-by-leviathan` | refused | `pine:request` this request could not be resolved to one symbol and one servable timeframe. The engine reads another symbol a | A-STATEMENTS (`vwap`) | a [H1] | - |
| `volumized-order-blocks-flux-charts` | refused | `pine:builtin` this Pine built-in names something the engine grammar does not hold — `top.y` | A-UDT (`top.y`) -> A-TFSECONDS (`timeframe.in_seconds`) -> A-USERFN (`runtime:function`) -> ... (cap: chain longer than the peel reached) | a (open) | - |
| `vwap-fibo-dev-extensions-strategy` | off/on/runtime (host) | - | - | attached | - |
| `williams-fractal-trailing-stops` | refused | `pine:text-value` this script uses a text feature our chart does not render yet. This lane stops at the first one, so none of th | A-TEXT (`pine:text-value`) | a [T] | - |
| `wyckoff-accumulation-distribution` | runtime (runtime) | - | - | attached | yes |
| `zero-lag-ma-trend-levels-chartprime` | off/on/runtime (host) | - | - | attached | yes |
| `zigzag-ma-pattern-recognition` | refused | `pine:function` `time(<timeframe>)` is the OPENING TIMESTAMP of the enclosing period — the anchor Pine scripts compare with `> | C-LTF (`time(<timeframe>)`) | c | - |
| `zigzag-multi-time-frame-with-fibonacci-retracement` | refused | `runtime:history-dynamic-offset` a ring width that is only known while the bar is running — the depth it may reach cannot be bounded before exe | A-HISTORY (`na`) | a [R1] | - |

## 9. Reproduce

- Census: `cd app && PINE_LIBRARY_STORE=<50-library store> VENDOR_BATCH_CENSUS=1 VENDOR_BATCH_CENSUS_RUNTIME=1 VENDOR_BATCH_CENSUS_OUT=<file> node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/components/chart/engine/__tests__/vendorHarness/memberDoorCensus.measure.test.js` - prints `off 65/266, on 91/266 attach, +VITE_PINE_RUNTIME_PANE_ENABLED 120/266`. Wave 17's file is `rt10-census-w17.json` (RT10's run, same store).
- Wall chains: a throwaway vitest file beside the census (never committed) that, for each runtime-state refusal, calls `enterDoorState('runtime')` then `enterMemberDoor`, reads the refusal line from `probeRuntimeProgram(source)` (plain, then `{ objectsInRun: true }`) or from `built.translation.refusals` / `outputs[].refusal`, and neutralises that line as section 2 describes; cap 15 peels per strategy; ~17 min for the 146 scripts at `--maxWorkers=1`. The families are a grouping of `{guard, first backticked construct}` pairs; the grouping rules and the six script-level overrides (symbols in source we do not hold; `ta.requestUpAndDownVolume` is an intrabar request) are stated in section 3's table.
- Not measured here: any grade. No capture names a wave-19 completer (byte-identical source or slug), so every lane owes its own capture queue.
