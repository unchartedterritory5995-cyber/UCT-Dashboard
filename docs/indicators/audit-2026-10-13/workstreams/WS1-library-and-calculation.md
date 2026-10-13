# WS1 — Built-in indicator library and calculation engine (evidence appendix)

Audit worktree `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13` = `origin/master` = production `84164aee3d` (2026-10-13). This was an audit only: no runtime code, tests or config were changed. The scratch harnesses are under `app/src/__audit_scratch__/ws1/` and are not committed: `dump.test.js`, `verify.test.js`, `mtf.test.js`, `avwap.test.js`, `pinevocab.test.js` and `py_parity.py`. All numbers below come from **synthetic** bars produced by a seeded LCG random walk: 600 daily bars, and 900 five-minute bars from 04:00 to 20:00 ET across the 2026-03-08 DST change. No real market values are used or printed.

---

## 0. Summary

| Measure | Result |
|---|---|
| Chart indicator definitions in the registry | **53**: 52 `native` lane + 1 `server` lane (`rsLine`). Adding the canvas `volumeProfile` and the legacy `Volume` pane gives **55 user-facing chart built-ins** |
| Status counts (55) | **1 fully working: 13** · **2 working with limitations: 41** · **3 in UI but partial: 1** (Ichimoku) · **4 in code, not user-accessible: 0** chart indicators (18 dormant Market-Indicator series, §1.4) · **5 documented only: 0** |
| Formula function table (builder and Pine translation) | **79** closed-table functions, plus 8 call expansions, 16 built-in call trees, 138 scalars, 31 clock names, 5 bar series and 15 operators. 19 names are explicitly excluded, each with a reason |
| Independent re-computation (SMA, EMA, RSI, ATR, BB/stdev, MACD, VWAP, Stochastic, OBV) | Matches a textbook implementation to **≤ 1.6e-13** whenever the engine's declared convention is used |
| JS ↔ Python parity, same bars, 19 columns | max abs **≤ 1.05e-11**; NaN/None positions identical |
| Lookahead (prefix-truncation probe): 52 natives × 2 bar sets × 4 cuts, plus 7 AVWAP anchors × 2 sets | Only `ichimoku.chikou` rewrites history, and it declares this (`forward: 26`) |
| MTF projection (daily onto 5m) | **0** lookahead bars. Each 5m bar shows the previous day's value, i.e. completed semantics |
| Determinism | Two full-registry runs are byte-identical |
| Existing tests run | Frontend: 26 files, **1941 passed / 4 skipped / 0 failed**. Python: **401 passed / 5 skipped / 1 failed** (a harness `RecursionError`, §5) |

Most important defects, in suggested priority order:

1. **Ichimoku**: Senkou spans are not displaced forward. The UI describes "a projected cloud". Both lanes compute it this way and it can be alerted on. (P0 candidate / P1)
2. **Anchored VWAP**: the calendar anchors (week/month/quarter/year) silently start at the first *loaded* bar, and the swing anchors depend on how much history is loaded. (P1)
3. **Session VWAP alert vs chart**: an RTH-only chart anchors VWAP at 09:30, while the server alert lane anchors at ET midnight over extended-hours bars. (P1)
4. **Session VWAP and AVWAP are hidden** on 8 intraday timeframes the chart offers (2, 3, 10, 45, 65, 195, 120, 240), even though the library labels them only "Intraday only". (P2)
5. **Slow Stochastic**: the chart defaults new instances to 14/3/3 slow, but the server lane can compute only fast Stochastic. This is disclosed in the UI. (P1/P2)
6. **NaN-hole policy differs by lane**: native MA restarts, formula EMA holds, formula SMA skips. (P3)

---

## 1. Built-in indicator library: inventory

### 1.1 Where built-ins are defined and offered

| Surface | File:line | What it holds |
|---|---|---|
| Native definitions | `app/src/components/chart/engine/nativeRegistry.js:350` (`RAW_DEFS`), compute adapters `:1797` (`NATIVE_COMPUTE`) | 52 natives. The first 19 came from the B-phase migration; 33 are "Tier 1" (2026-10-01), starting at `:1245` |
| Server definition | `nativeRegistry.js:3690` (`RS_LINE_RAW`, `compute.kind: 'server'`); provider `api/routers/signature.py:875-898` → `indicator_compute.compute_rs_line` | `rsLine`, premium tier |
| Carved-out canvas | `nativeRegistry.js:3772` (`CARVED_OUT_INDICATOR_KEYS = {'volumeProfile'}`); drawn by `StockChart.jsx:1972` `drawVolumeProfile` | Visible-range volume profile |
| Legacy built-in rows | `app/src/components/chart/indicatorCatalog.js:130` (`BUILT_IN_ROWS`: `ma`, `volume`) | Legacy MA overlay ("Restore …" row) and the Volume pane |
| Library list assembly | `ChartSettingsIndicators.jsx:756-757`; `discoveryCatalog.js:1248` (`LIBRARY_HIDDEN_IDS = ['dataSeries','ma']`) | `dataSeries` is hidden from the library. Users reach it through symbol and breadth discovery (`discoveryCatalog.js:124`, `createDirectSeries`) |
| Compute maths | `app/src/components/chart/indicators.js` (14 original computes), `technicalStudies.js` (Tier 1), `movingAverages.js` (9 MA types) | — |
| Python twin | `api/services/indicator_compute.py` (`compute_*_raw` and 2–6 dp "delivery" wrappers); `_CASE_COLUMNS` at `:2413` | 15 indicators: rsi, macd, bb, stoch, williams_r, cci, mfi, atr, adx, obv, donchian, ichimoku, sar(+events), avwap, atr_bands, plus vwap and rs_line |
| Alert addresses | `api/services/alert_series.py:177-212` (`SERIES_FUNCS`) | 32 addresses over 14 indicators, plus `price_vs_ma` and `close` |
| Formula vocabulary | `engine/ast/closedTable.json` (`functions`, `scalars`, `clock`, `series`, `operators`), `ast/callExpansions.js:61`, `ast/pine.js:2075` (`BUILTIN_CALL_TREE`) | §1.5 |
| Starter scans | `engine/ast/starterScans.json` (8 starters), validated by `api/services/starter_library.py` | Screener scans, not chart indicators (§1.4) |

The registry was dumped through the live module (`dump.test.js`): `listDefinitions().length === 53`, carved-out set `['volumeProfile']`.

### 1.2 Status rubric

- **1 fully working**: compute traced and re-verified, tests exist, no material limitation on its own surface.
- **2 working with limitations**: correct maths, but it is chart-only (no server twin, so no alerts or screener), timeframe-gated in a surprising way, has a convention or parity caveat, or is premium-gated.
- **3 in UI but partial**: offered to users, but the output deviates from what the name and description promise.
- **4 / 5**: none among chart indicators.

### 1.3 Chart indicator table (53 registry definitions)

Every row is traced to a `NATIVE_COMPUTE` adapter (`nativeRegistry.js:1797-2072`) or to the server provider. Every row was executed through `computeFor` in `verify.test.js` (warm-up census and prefix probe), and every Tier-1 row also has an oracle case in `technicalStudies.oracle.test.js`, which is cross-checked against TA-Lib per its own header.

"Alertable" means the server `SERIES_FUNCS` address exists. Tier 1 is chart-only by design (`nativeRegistry.js:1254-1256`: *"None of these has a server (Python) twin, so none is an alert address yet"*).

| # | id | Name | Category | Lane | Inputs (non-colour) = default [min-max] | Source | Outputs (plot:style) | Placement | TF limits | Alertable (server) | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rsi` | Relative Strength Index | momentum | native | period:int=14[2-100] | close | rsi:line, bands:hlines, midline:hlines (single) | pane fixed 0..100 | any | yes | 1 |
| 2 | `macd` | MACD | momentum | native | fastPeriod:int=12[1-100]; slowPeriod:int=26[1-200]; signalPeriod:int=9[1-50] | close | macd:line, signal:line, histogram:histogram, zero:hlines (multi) | pane | any | yes | 1 |
| 3 | `bb` | Bollinger Bands | volatility | native | period:int=20[2-200]; stdDev:float=2[0.5-5] | close | upper:line, middle:band, lower:line (multi) | overlay | any | yes | 1 |
| 4 | `vwap` | Session VWAP | volume (VWAP) | native | opacity:int=100[5-100]; lineStyle:enum="solid"{solid/dashed/dotted}; lineWidth:int=1[1-4]; bands:enum="off"{off/1/2/3} | OHLCV | vwap:line, upper1..3/lower1..3:line (multi) | overlay | 1,5,15,30,60 | yes | 2 |
| 5 | `stoch` | Stochastic Oscillator | momentum | native | kPeriod:int=14[1-100]; smoothK:int=1[1-20] (new instances get 3 via `createInputs`, `:557`); dPeriod:int=3[1-20] | OHLC | k:line, d:line, overbought/oversold:hlines (multi) | pane fixed 0..100 | any | yes (fast only) | 2 |
| 6 | `atr` | Average True Range | volatility | native | period:int=14[1-100] | OHLC | atr:line (single) | pane | any | yes | 1 |
| 7 | `sar` | Parabolic SAR | trend | native | step:float=0.02[0.001-0.1]; maxStep:float=0.2[0.01-1] | OHLC | sar:markers + 2 event columns | overlay | any | yes | 1 |
| 8 | `ichimoku` | Ichimoku Cloud | trend | native | tenkanPeriod:int=9; kijunPeriod:int=26; senkouBPeriod:int=52 | OHLC | tenkan, kijun, spanA, spanB, chikou: all `line` (multi). **No cloud fill** | overlay | any (calcTimeframe disabled) | yes | **3** |
| 9 | `mfi` | Money Flow Index | volume | native | period:int=14[2-100] | OHLCV | mfi:line, bands:hlines | pane fixed 0..100 | any | yes | 1 |
| 10 | `cci` | Commodity Channel Index | momentum | native | period:int=20[2-200] | OHLC | cci:line, bands, zero | pane | any | yes | 1 |
| 11 | `williamsR` | Williams %R | momentum | native | period:int=14[2-100] | OHLC | williams_r:line, bands | pane fixed -100..0 | any | yes | 1 |
| 12 | `adx` | Average Directional Index | trend | native | period:int=14[2-100] | OHLC | adx, plusDI, minusDI:line; trend:hlines (multi) | pane fixed 0..100 | any | yes | 1 |
| 13 | `obv` | On-Balance Volume | volume | native | — | OHLCV | obv:line | pane | any | yes | 1 |
| 14 | `donchian` | Donchian Channels | volatility | native | period:int=20[2-200] | OHLC | upper:line, middle:band, lower:line | overlay | any | yes | 1 |
| 15 | `avwap` | Anchored VWAP | volume (VWAP) | native | anchor:enum="session"{session/week/month/quarter/year/swingHigh/swingLow}; lineStyle; lineWidth | OHLCV | avwap:line | overlay | 1,5,15,30,60 | no | 2 |
| 16 | `atrBands` | ATR Bands | volatility | native (Python twin exists, no alert address) | period:int=14[2-200]; multiplier:float=2[0.1-10] | OHLC | upper, middle:band, lower | overlay | any | no | 2 |
| 17 | `movingAverage` | Moving Average | trend | native | source="close"; period:int=5[1-500]; maType{sma/ema/wma/vwma/hma/smma/dema/tema/lsma} | selectable source | ma:line | overlay (or the source's pane) | any | partial: only close-SMA/EMA, via `price_vs_ma` | 2 |
| 18 | `dataSeries` | Data Series | data | native (passthrough) | source="close" | selectable source | value:line | pane | any (cannot be recalculated on another TF) | no | 1 (hidden from library, reached via discovery) |
| 19 | `dollarVolume` | Dollar Volume | volume | native | — | OHLCV | dv:histogram | pane | any | no | 2 |
| 20 | `superTrend` | SuperTrend | trend · Tier1 | native | atrPeriod:int=10[1-100]; multiplier:float=3[0.5-10] | OHLC | up:line, down:line (multi) | overlay | any | no | 2 |
| 21 | `aroon` | Aroon | trend · Tier1 | native | period:int=14[1-200] | OHLC | up, down:line; bands:hlines | pane fixed 0..100 | any | no | 2 |
| 22 | `vortex` | Vortex Indicator | trend · Tier1 | native | period:int=14[2-200] | OHLC | plus, minus:line; one:hlines | pane | any | no | 2 |
| 23 | `choppiness` | Choppiness Index | trend · Tier1 | native | period:int=14[2-200] | OHLC | chop:line; bands | pane fixed 0..100 | any | no | 2 |
| 24 | `stochRsi` | Stochastic RSI | momentum · Tier1 | native | source; rsiPeriod=14; stochPeriod=14; kSmooth=3; dSmooth=3 | selectable source | k, d:line; bands | pane fixed 0..100 | any | no | 2 |
| 25 | `ppo` | Percentage Price Oscillator | momentum · Tier1 | native | source; fast=12; slow=26; signal=9 | selectable source | ppo, signal:line; histogram; zero | pane | any | no | 2 |
| 26 | `roc` | Rate of Change | momentum · Tier1 | native | source; period=12[1-500] | selectable source | roc:line; zero | pane | any | no | 2 |
| 27 | `momentum` | Momentum | momentum · Tier1 | native | source; period=10[1-500] | selectable source | mom:line; zero | pane | any | no | 2 |
| 28 | `tsi` | True Strength Index | momentum · Tier1 | native | source; long=25; short=13; signal=13 | selectable source | tsi, signal:line; zero | pane | any | no | 2 |
| 29 | `cmo` | Chande Momentum Oscillator | momentum · Tier1 | native | source; period=14 | selectable source | cmo:line; bands; zero | pane fixed -100..100 | any | no | 2 |
| 30 | `trix` | TRIX | momentum · Tier1 | native | source; period=15; signal=9 | selectable source | trix, signal:line; zero | pane | any | no | 2 |
| 31 | `awesome` | Awesome Oscillator | momentum · Tier1 | native | fast=5; slow=34 | OHLC (hl2) | ao:histogram; rising:line; zero | pane | any | no | 2 |
| 32 | `ultimate` | Ultimate Oscillator | momentum · Tier1 | native | 7/14/28 | OHLC | uo:line; bands | pane fixed 0..100 | any | no | 2 |
| 33 | `balanceOfPower` | Balance of Power | momentum · Tier1 | native | smoothing=14 | OHLC | bop:histogram; zero | pane | any | no | 2 |
| 34 | `bullBearPower` | Bull/Bear Power | momentum · Tier1 | native | period=13 | OHLC | bull, bear:histogram; zero | pane | any | no | 2 |
| 35 | `keltner` | Keltner Channels | volatility · Tier1 | native | period=20; multiplier=2; atrPeriod=10 | OHLC | upper, middle:band, lower | overlay | any | no | 2 |
| 36 | `envelope` | MA Envelope | volatility · Tier1 | native | source; period=20; percent=2.5; maType (9) | selectable source | upper, middle:band, lower | overlay | any | no | 2 |
| 37 | `bbPercentB` | Bollinger %B | volatility · Tier1 | native | period=20; stdDev=2 | close (fixed) | percentB:line; bands; midline | pane | any | no | 2 |
| 38 | `bbWidth` | Bollinger BandWidth | volatility · Tier1 | native | period=20; stdDev=2 | close (fixed) | bandwidth:line | pane | any | no | 2 |
| 39 | `atrPercent` | ATR % | volatility · Tier1 | native | period=14 | OHLC | atrPct:line | pane | any | no | 2 |
| 40 | `adrPercent` | ADR % | volatility · Tier1 | native | period=20 | OHLC | adrPct:line | pane | any | no | 2 |
| 41 | `historicalVolatility` | Historical Volatility | volatility · Tier1 | native | period=20[2-400] | close | hv:line | pane | D,W,M | no | 2 |
| 42 | `squeeze` | Squeeze | volatility · Tier1 | native | period=20; bbMult=2; kcMult=1.5 | OHLC | momentum:histogram; state, on:line | pane | any | no | 2 |
| 43 | `relativeVolume` | Relative Volume | volume · Tier1 | native | period=50 | volume | rvol:histogram; one | pane | any | no | 2 |
| 44 | `accumDist` | Accumulation/Distribution | volume · Tier1 | native | — | OHLCV | ad:line | pane | any | no | 2 |
| 45 | `chaikinMoneyFlow` | Chaikin Money Flow | volume · Tier1 | native | period=20 | OHLCV | cmf:histogram; zero | pane | any | no | 2 |
| 46 | `chaikinOscillator` | Chaikin Oscillator | volume · Tier1 | native | 3/10 | OHLCV | osc:line; zero | pane | any | no | 2 |
| 47 | `forceIndex` | Elder Force Index | volume · Tier1 | native | period=13 | OHLCV | efi:line; zero | pane | any | no | 2 |
| 48 | `pvt` | Price Volume Trend | volume · Tier1 | native | — | OHLCV | pvt:line | pane | any | no | 2 |
| 49 | `upDownVolume` | Up/Down Volume Ratio | volume · Tier1 | native | period=50 | OHLCV | ratio:line; one | pane | any | no | 2 |
| 50 | `percentFromMa` | % From MA | RS · Tier1 | native | source; period=50; maType (9) | selectable source | pct:line; zero | pane | any | no | 2 |
| 51 | `fiftyTwoWeek` | 52-Week High/Low | RS · Tier1 | native | — | OHLC | fromHigh, fromLow:line; zero | pane | D,W,M | no | 2 |
| 52 | `standardDeviation` | Standard Deviation | statistical · Tier1 | native | source; period=20 | selectable source | stdev:line | pane | any | no | 2 |
| 53 | `rsLine` | Relative Strength Line | RS | server (premium) | benchmark{SPY/QQQ/IWM}; lineWidth | close + benchmark close, joined by bar time | rsLine:line | pane | any (no other-TF calc) | no | 2 |

Two built-ins sit outside the registry:

| id | Name | Category | Params | Output / style | Placement | Status | Evidence / note |
|---|---|---|---|---|---|---|---|
| `volume` | Volume | volume | MA overlay in the volume pane | coloured histogram + MA line | pane (singleton) | 1 | `indicatorCatalog.js:156`. Legacy pane, out of WS1 depth |
| `volumeProfile` | Volume Profile (visible range) | volume | enabled, bins=24 (clamped 8–50), color, pocColor | canvas horizontal bins + POC | price pane, right edge | 2 | `StockChart.jsx:1972-2018`. Each bar's **entire** volume goes to the bin of its typical price (hlc3). It does not spread volume across the bar's range, has no up/down split and no value area. No dedicated unit test of the maths; only registry/carve-out rails reference it |

**Counts (55):**
- **Status 1 = 13:** rsi, macd, bb, atr, sar, mfi, cci, williamsR, adx, obv, donchian, dataSeries, Volume.
- **Status 2 = 41:** vwap, stoch, avwap, atrBands, movingAverage, dollarVolume, rsLine, volumeProfile, and the 33 Tier-1 studies.
- **Status 3 = 1:** ichimoku.
- **Status 4 / 5 = 0.**

By category (53 registry definitions): momentum 16 · trend 8 · volatility 12 · volume/VWAP 12 · RS 3 · statistical 1 · data 1 · breadth 0 (breadth is delivered as *data series*, §1.4) · UCT-specific: `adrPercent`, `percentFromMa`, `fiftyTwoWeek`, `dollarVolume`, `relativeVolume` and `rsLine` are the Minervini/IBD-style studies.

### 1.4 Data-series families (charted through `dataSeries` / discovery, not indicator definitions)

| Family | Count | Source of truth | Status | Note |
|---|---|---|---|---|
| UCT breadth symbols | 45 rows (`api/services/breadth_symbols.py` `SYMBOLS`) | server bars route | not individually audited (other WS) | e.g. `UCTA5` = % above 5-day MA |
| Market Indicators registry | 211 series: **193 published**, 18 dormant (`api/services/market_indicators/registry.py` `SERIES`); positioning 174, breadth 6+12 dormant, McClellan 2+5 dormant, volatility 7+1 dormant, sentiment 4 | registry `status` field | published = 2 (not audited here); dormant = **4** (in code, not offered; per the `status` field, not independently traced) | |
| Economic series | 237 rows (`api/services/econ/registry/series.json`) | econ service | not audited here | |
| Fundamental series (`fund:` grammar) | server catalogue (`useFundamentalsCatalog`) | fundamentals PIT | not audited here | |
| Starter scans | 8 (`engine/ast/starterScans.json`) | screener | see D-9 | "Power Earnings Gap" = `days_to_earnings 0..7 && rs_rank>=70`, i.e. a **pre**-earnings filter, not a gap |

### 1.5 Formula function table (`engine/ast/closedTable.json` `functions`, 79 entries)

The closed table is the single vocabulary for the builder. The same table is mirrored in Python by `api/services/ast_table.py` and `ast_interpret.py`. Pine `ta.*` and `math.*` calls are translated into it by stripping the namespace (`pine.js:931` `VALUE_NAMESPACES`), with special trees for `ta.pivothigh/pivotlow/highestbars/lowestbars` (`PINE_NAMESPACED_TREE`). Pine scripts that cannot be translated into an expression run on the separate bar-by-bar runtime VM (`engine/runtime/vm.js`, `compute.kind: 'runtime'`). That VM is not audited in depth here.

| Category | n | Functions (declared lookback) |
|---|---|---|
| Moving averages / smoothing | 5 | `sma`(n) · `ema`(n) · `rma`(n) · `wma`(n) · `hma`(2n) |
| Momentum / oscillators | 11 | `rsi` · `macd`(line only) · `stoch`(%K only) · `cci` · `williamsR` · `mfi` · `mfiPine` · `change` · `aroonUp` · `aroonDown` · `bop` |
| Trend / directional | 8 | `adx`(2n) · `plusDI` · `minusDI` · `ichimokuTenkan/Kijun/SpanA/SpanB` · `ichimokuChikou`(**forward**) |
| Volatility / range | 8 | `atr`(Wilder seed) · `atrPine`(Pine seed) · `stdev`(population) · `dev`(mean abs dev) · `bbw` · `donchianUpper/Middle/Lower` |
| Volume / cumulative / VWAP | 8 | `vwap` · `vwapOf` · `avwap`(session window) · `obvN` · `pvtN` · `cum` · `cumFrom` · `accum` |
| Window statistics / extremes | 10 | `highest` · `lowest` · `highestbars` · `lowestbars` · `sum` · `median` · `percentrank` · `percentileLinearInterpolation` · `pivothigh`/`pivotlow` (**forward = right**) |
| Signals / state | 8 | `crossOver` · `crossUnder` · `rising` · `falling` · `barssince` · `valuewhen` · `valuewhenOccurrence` · `barsAgo` |
| Math / pointwise | 21 | `abs atan ceil cos exp floor idiv ln log10 max min mod pow round sign sin sinh sqrt tan na nz` |

- **Call expansions** (`ast/callExpansions.js:61`, which become exact trees): `roc`, `mom`, `vwma`, `linreg`, `correlation`, `kcMiddle`, `kcUpper`, `kcLower`.
- **Built-in call trees** (`pine.js:2075`): `roc mom tr avg iff vwma linreg correlation kcw cross`, plus 6 calendar readers.
- **Explicitly excluded**, each with a written reason (`_functions_excluded`): `supertrend obv pvt accdist nvi pvi stochWorden sar macdSignal bbUpper bbMiddle bbLower stochD changeN hl2 hlc3 ohlc4 variance cross`. Several can be composed, e.g. a BB upper band as `sma+2*stdev`, and the reasons say how. Formula-to-library parity gap: **27 of the 33 Tier-1 chart studies** have no formula, alert or screener primitive, including SuperTrend, Vortex, Choppiness, TSI, CMO, TRIX, Ultimate, Squeeze, CMF, Chaikin Oscillator, Force Index, HV and ADR%.
- **Scalars**: 138 screener columns (`closedTable.json` `scalars`), e.g. `rs_rank`, `adr_pct`, `dist_52w_high_pct`, plus 67 excluded scalars.
- **Clock**: 31 names (`time … isconfirmed`).
- **Series**: `open high low close volume`.
- **Operators**: `+ - * / > < >= <= == != && || u- ! ?:`.

---

## 2. Calculation verification (independent re-computation)

**Method.** `verify.test.js` implements textbook versions with no engine imports: SMA; EMA seeded with the SMA of the first n values (the Pine `ta.ema` convention); EMA seeded with the first value (the alternative convention); Wilder RSI (gains/losses from bar 1, RMA seeded with the SMA of the first n); ATR with Wilder's seed (TR from bar 1) and ATR with the Pine seed (`ta.tr(true)`, bar 0 = h−l); population and sample stdev; MACD (EMA12−EMA26, signal = SMA-seeded EMA9); VWAP (hlc3, reset on the ET calendar date, or reset at 09:30); Stochastic %K/%D and slow 14/3/3; OBV (sign of change × volume, cumulative from 0). Each is compared with the engine's **native** lane (`computeFor`) and, where a function exists, with the **formula** lane (`parseFormula` → `interpret`).

| Indicator (daily 600 bars unless noted) | Engine lane | vs reference | max abs diff | First finite bar (engine / ref) |
|---|---|---|---|---|
| SMA 20 | native `movingAverage` / formula `sma` | textbook | **0** / **0** | 19 / 19 |
| EMA 20 | native / formula | SMA-seeded | **0** / **0** | 19 / 19 |
| EMA 20 | native | first-value seeded | 0.408 at the seed; **1.2e-4** from bar 100 | — |
| RSI 14 | native / formula | Wilder (RMA, SMA seed) | **2.8e-14** / 2.8e-14 | 14 / 14 |
| ATR 14 | native `atr` / formula `atr` | Wilder seed (TR from bar 1) | **1.3e-15** | 14 / 14 |
| ATR 14 | native | Pine `ta.atr` (TR bar 0 = h−l) | 1.7e-2 overall; **2.9e-5** from bar 100; **1.1e-11** from bar 300 | 14 / 13 |
| ATR 14 | formula `atrPine` | Pine seed | **0** | 13 / 13 |
| BB 20,2 upper | native `bb` | **population** σ | **0** | 19 / 19 |
| BB 20,2 upper | native | sample σ | 0.105 (so BB is population, as in TradingView) | — |
| stdev 20 | native `standardDeviation` / formula `stdev` | population | **0** / **0** | 19 / 19 |
| MACD 12/26/9 line, signal, histogram | native / formula (line) | SMA-seeded EMAs | **0 / 0 / 0** | 25 / 33 / 33 |
| Session VWAP (900 × 5m, ETH) | native / formula `vwap()` | hlc3, ET-midnight anchor | **0** / **0** | 0 / 0 |
| Session VWAP | native | 09:30 RTH anchor | up to 3.39 on a ~100 price, and 330 pre-market bars that only the engine has values for. This is the expected difference when ETH bars are present | — |
| Stochastic 14,3 %K / %D | native / formula `stoch` | textbook | **1.4e-14 / 2.8e-14** | 13 / 15 |
| Slow Stochastic 14/3/3 %K / %D | native (`smoothK: 3`) | SMA3 of fast %K | **9.9e-14 / 1.6e-13** | 15 / 17 |
| OBV | native | cumulative, bar 0 = 0 | **0** | 0 / 0 |

**Python parity** (`py_parity.py`, same bars, `compute_*_raw`):

| Column | max abs diff vs JS |
|---|---|
| rsi, atr, macd, signal, stoch_k, obv, vwap, mfi, williams_r, adx, sar, ichimoku spanA, chikou, donchian upper, atrBands upper, avwap(week) | **0** |
| bb_upper | 1.4e-14 |
| stoch_d | 2.8e-14 |
| cci | 1.05e-11 |

No column has values that exist in only one lane. Delivery wrappers round: RSI to 2 dp (max rounding delta 0.005), price-scale values to 4 dp, `rs_line` to 6 dp.

### 2.1 Convention choices compared with TradingView / TC2000

| Choice | UCT | TradingView (Pine v5/v6) | Classification | Evidence |
|---|---|---|---|---|
| EMA seed | SMA of the first n values | Same (`ta.ema` seeds with `ta.sma`) | match | `movingAverages.js:87`, `indicators.js` `_ema`; harness 0 diff |
| RSI smoothing | Wilder RMA, SMA seed; 100 when avgLoss = 0 | Same | match | `indicators.js:107`; 2.8e-14 |
| ATR seed | TR from bar 1 (Wilder's original); first value at bar n | `ta.tr(true)` counts bar 0 as h−l, so the first value is at bar n−1 | **intentional** (documented in `closedTable._functions_atr_convention`; `atrPine` offers the Pine seed). Converges: 2.9e-5 by bar 100 | `indicators.js:454`; harness |
| Stdev | population (÷n) for BB, `stdev` and Squeeze; **sample** (÷n−1) for HV only | `ta.stdev` biased (population) by default | match (BB); HV is intentional | `technicalStudies.js:97-111`; decision `docs/decisions/2026-10-01-technical-library-tier1.md:42` |
| HV annualisation | √252 (D), √52 (W), √12 (M), sample σ | TV built-in HV uses √365 for daily, population σ | **intentional**. TV reads ≈ 23% higher for the same data | `technicalStudies.js:447-500` |
| VWAP anchor | ET calendar day. With ETH bars shown it starts 04:00; with ETH hidden the chart filters bars to 09:30–16:00 first (`StockChart.jsx:8246-8262`), so it starts 09:30 | Session anchor, which follows the chart's ETH setting | match on the chart; **mismatch on the server alert lane** (D-3) | `indicators.js:317-380` |
| Stochastic flat range | %K = 50 when HH = LL | Pine gives na (division by zero) | intentional, safety branch; the same in Python | `indicators.js:421-450`; `indicator_compute.py` `compute_stoch_raw` |
| Stochastic default | fast for stored instances (`smoothK` default 1), slow 14/3/3 for new instances (`createInputs`) | TV default %K smoothing = 1 | intentional, but the server cannot compute slow (D-5) | `nativeRegistry.js:557`, `instanceControls.js:236-255` |
| OBV origin | 0 at bar 0; cumulative level depends on how much history is loaded | Same class (cumulative from first bar) | match / inherent | `indicators.js:694` |
| Ichimoku spans | **not** displaced forward | spans plotted kijun−1 (25) bars ahead | **defect** (D-1) | `indicators.js:512-522`, `:42-46` |
| Daily `vwap()` in a formula | hlc3 of the bar (each day is its own session) | Same on a daily chart | match | `interpret.js:3273` |
| `pivothigh/pivotlow` | value drawn on the pivot bar once `right` bars exist; badge `preview-repaints`; save requires acknowledgement; the alert lane admits it only with an acknowledgement | TV `ta.pivothigh` returns at bar i+right | intentional, disclosed | `closedTable._functions_pivots`; `api/services/alert_user_series.py:836` |
| `sma`/`stdev` NaN handling (formula) | skip NaN (last n finite values) | Pine v5+ also skips na | match | `interpret.js:2267-2270` |

---

## 3. Engine behaviour findings

| Topic | Finding | Evidence |
|---|---|---|
| Compute paths | Five lanes. (a) `native` → `NATIVE_COMPUTE` adapters over `indicators.js`, `technicalStudies.js`, `movingAverages.js`. (b) `ast` (user formulas) → `ast/interpret.js` (6,872 lines), mirrored by `api/services/ast_interpret.py`. (c) `runtime` (Pine VM, `engine/runtime/vm.js`, 9.5k lines), not deep-audited. (d) `server` (`rsLine`) via `serverCompute.js`. (e) Python `indicator_compute.py` for alerts and the screener | `nativeRegistry.js:3004-3031` |
| Shared maths | The formula lane **reuses** native computes for rsi/atr/stoch/cci/williamsR/mfi (`bindShipped`, `interpret.js:2726-2771`), so chart and formula numbers for these cannot drift | harness: formula = native exactly |
| Warm-up | NaN-padded columns. `hasAnyFinite` decides whether a pane exists. Measured first finite bar: RSI 14, MACD 25/33, BB 19, ATR 14, ADX 27, Stoch 13/15, Ichimoku **51** for every line (tenkan should be 8, kijun 25), TSI 37/49, TRIX 43/51, Squeeze histogram 38, 52-week 260 (needs 52 calendar weeks) | `verify.json` `warmup`; `indicators.js:512` |
| Input domain | `resolveInputs` does not clamp (`nativeRegistry.js:2819`). UI writes are validated (`instanceControls.js:205-224` `coerce`, `defSchema.js:1322` min/max). Called directly, `computeFor`: RSI period −3 → 599 garbage values; RSI 14.5 → plausible non-standard values; Stochastic kPeriod 0 → **throws** `Cannot read properties of undefined (reading 'c')` | `verify.json` `inputDomain` |
| Missing bars / NaN holes | **Policies differ by lane.** After one NaN close at bar 100: native `movingAverage` SMA/EMA **restart** (next value at bar 120); formula `sma`/`stdev` **skip** (value at 100); formula `ema` **holds** (101); native RSI/MACD/ATR **hold** (101–102); BB **propagates** (120); OBV carries. A NaN volume inside a session blanks Session VWAP for **the rest of that session** (0 finite bars until the next day) | `verify.json` `nanPolicy`; `movingAverages.js:72-108`; `interpret.js:1743-1783, 2267`; `indicators.js:365-372` |
| Server bars with missing OHLC | The alert evaluator coerces a NULL o/h/l/c to **0.0** and volume to 0 before computing | `api/services/indicator_alert_evaluator.py:1110-1119` |
| Intraday vs D/W/M | Session indicators are gated by `meta.timeframes` in `eligibility.js:56-64`. VWAP/AVWAP are allowed on `1,5,15,30,60` only; HV and 52-week on `D,W,M` only. The chart menu offers `2,3,10,45,65,195,120,240` and `2D,3D,5D,2W,3M,6M,12M` (`timeframes.js:104-108`) | `mtf.json`: VWAP/AVWAP hidden on 2/3/10/45/65/195/120/240; HV/52wk hidden on 2D/2W/3M/12M |
| Multi-timeframe | `mtfProjection.projectFrameColumns`: a chart bar shows the last higher-TF period that closed **before** the chart bar's period began. The forming bar is never shown unless the server says `newest_bar_is_forming === false`. Staleness → NaN. Joins use ET timestamps, never index | `mtfProjection.js:1-40,150-200`; probe: 1092 bars = previous day, 0 same-day, 0 lookahead, first day NaN |
| Calc-timeframe capability | Refused for server, runtime, passthrough, session-bound, object, marker, displaced, fundamental, economic and volume-sourced plots. Ichimoku and `dollarVolume` declare `calcTimeframe:false` | `calcTimeframeCapability.js`; `nativeRegistry.js:652,1232` |
| Lower-TF reads | Formula LTF reads go through `lowerTf.js` / `FORMULA_LTF_GUARD` and are withheld where not supplied | `nativeRegistry.js:2623-2635`, `interpret.js:4386-4456` |
| Lookahead / repaint | Static linter (`ast/lint.js` `modeFromReach`, `:855`) badges forward reach as `preview-repaints` or `repaints`. **124 of 125** shipped plots are `undecidable-hand-written` (natives cannot be read by the linter); the one decided disagreement is `ichimoku.chikou` (shipped badge `non-repainting`, measured `preview-repaints`). It is surfaced per plot via `repaintVerdict.js` / `catalogRows.measuredRepaint`. A dynamic prefix probe over all 52 natives (and 7 AVWAP anchors) found no other column that rewrites history | lint test output; `verify.json` `prefixProbe`; `avwap.json` |
| Incremental recalculation | **None.** Full recompute per instance whenever the `bars` reference or the input signature changes. Results are memoised by reference (`binder.js:740-760, 1655-1664`). Live VWAP has a last-value fast path (`StockChart.jsx:8236`) | — |
| Determinism | Pure computes; byte-identical across runs. Calendar keys come from `Intl` per instant (DST-safe) | `verify.json` `deterministic: true` |
| Client/server parity | Golden fixtures (`tests/fixtures/indicators/*.json`) are asserted in both lanes (`goldenFixtures.test.js`, `tests/test_indicator_golden.py`). Formula-lane conformance is in `tools/ast_conformance.py` plus a family of `tests/test_ast_*_parity.py`. The harness confirms ≤ 1.05e-11 across 19 columns | §2 |
| Data alignment | `rsLine` joins benchmark by **bar time** (not index) (`indicator_compute.py:2371-2389`). MTF uses ET date keys. VWAP and AVWAP refuse non-instant `t` (`VWAP_MIN_INSTANT`) | — |

---

## 4. Defects and gaps

Each item lists: description · evidence · current · expected · user impact · complexity · dependencies · regression risk.

### D-1 (P0 candidate / P1): Ichimoku Senkou spans are not projected forward; there is no cloud
- **Description:** `spanA`/`spanB` are written to the same bar that produced them. Standard Ichimoku plots them kijun−1 bars ahead. The cloud is two thin lines with no fill. Tenkan and kijun also start at bar 51 instead of bars 8 and 25.
- **Evidence:** `app/src/components/chart/indicators.js:512-522`. The module docstring at `:42-46` calls this a "preserved quirk" awaiting an owner-signed B3 correction. The Python twin is identical (`api/services/indicator_compute.py:873` "PRESERVED QUIRK — NO FORWARD DISPLACEMENT"). The UI description says *"a projected cloud"* (`nativeRegistry.js`, ichimoku `description`). Alert addresses `ichimoku.spanA/spanB` exist (`alert_series.py:204-205`). The formula `ichimokuSpanA/SpanB` functions are the same maths.
- **Current:** cloud at bar i = TradingView's cloud at bar i+25/26. "Price above cloud" readings and alerts compare against the wrong span.
- **Expected:** spans displaced forward (including into future whitespace), a filled cloud, and per-line warm-up.
- **User impact:** every Ichimoku reading and alert disagrees with every other vendor. Silent; looks plausible.
- **Complexity:** M. Needs a forward-displaced plot with future whitespace, a fill primitive, and a `compute.rev` bump with migration in both lanes, plus regenerated golden fixtures.
- **Dependencies:** `compute.rev` migration policy (spec §3.1); the alert replay grid digest (`tools/alert_replay.py`).
- **Regression risk:** M. Golden fixtures, replay digests and parity rails will all move, by design.

### D-2 (P1): Anchored VWAP calendar anchors start at the first loaded bar; swing anchors depend on loaded history
- **Description:** for `week/month/quarter/year`, the first bucket accumulates from whatever bar happens to be first in the loaded window. With `swingHigh/swingLow`, the anchor is "every new running extreme since the first loaded bar", so it moves when more history loads.
- **Evidence:** `indicators.js:1056-1095`. The numeric-instant branch at `:1069-1076` refuses exactly this ("a running total of the bars that came FIRST is a confident wrong number"), but the calendar branch does not. AVWAP is allowed only on 1–60m charts, where the history window is short.
- **Current:** a "Year" or "Quarter" AVWAP on a 5m chart is almost always a partial-period VWAP, shown with full confidence.
- **Expected:** the first partial period is NaN (or flagged) unless the history reaches the anchor. Swing anchors should use confirmed pivots, or be documented as "running extreme since chart start".
- **User impact:** wrong support/resistance level on the most common AVWAP use (YTD/QTD).
- **Complexity:** S for the calendar anchors (withhold the first bucket unless its start ≤ the first bar's time); M for swings.
- **Dependencies:** whether the history window size is knowable per TF.
- **Regression risk:** L–M (AVWAP is chart-only, no alerts).

### D-3 (P1): VWAP alerts disagree with the chart for RTH-only users
- **Description:** when extended hours are hidden, the chart filters bars to 09:30–16:00 before computing (`StockChart.jsx:8246-8262`), so VWAP anchors at 09:30. The server evaluator computes `compute_vwap` over the store's intraday bars, which include extended hours (the store holds 04:00–20:00 per `closedTable._session`), so it anchors at ET midnight / 04:00.
- **Evidence:** `api/services/indicator_alert_evaluator.py:1078-1120` (no session filter); `alert_series.py` `"vwap": _column("compute_vwap")`. Harness: ET-day vs 09:30 anchor differs by up to 3.4 on a ~100 price on synthetic data (`vwap_vs_rthAnchor_0930`).
- **Current:** "price crosses VWAP" fires at a level that is not the drawn line.
- **Expected:** the alert carries the chart's session mode, or the popover states which VWAP is evaluated.
- **User impact:** alerts that look wrong; loss of trust in alerts.
- **Complexity:** S–M (a session param on the address, plus an RTH filter in the series function).
- **Dependencies:** alert params schema; frozen replay grid.
- **Regression risk:** M (replay digests).
- **Confidence:** high from code reading. Not executed end-to-end against the live store.

### D-4 (P2): Session VWAP and AVWAP hidden on 8 offered intraday timeframes
- **Description:** `VWAP_TIMEFRAMES = ['1','5','15','30','60']` (`eligibility.js`; `meta.timeframes` on both definitions). The chart menu offers 2, 3, 10, 45, 65, 195, 120 and 240 minutes, all resampled from intraday bases with real timestamps. HV and 52-week are likewise hidden on 2D/3D/5D/2W/3M/6M/12M.
- **Evidence:** `mtf.json` (eligibility probe); `timeframes.js:104-108`. The library pill reads "Intraday only" (`IndicatorLibraryDialog.jsx:522`), which is not accurate for 2m or 240m.
- **Current:** the indicator disappears with the reason `timeframe`.
- **Expected:** a capability test (intraday with instant timestamps) instead of a hard list.
- **User impact:** a VWAP line on a 2m or 4h chart is standard elsewhere.
- **Complexity:** S. **Regression risk:** L.

### D-5 (P1/P2): Slow Stochastic on the chart vs fast Stochastic in alerts
- **Description:** new Stochastic instances are slow 14/3/3 (`createInputs: {smoothK: 3}`, `nativeRegistry.js:557`). The Python lane has no `smoothK` (`indicator_compute.py:510-590`; `alert_series.py:180,191` take `k_period`/`d_period` only). The popover discloses it: *"a chart's slow 14/3/3 Stochastic arms a 14/3 FAST alert"* (`IndicatorAlertPopover.jsx:534-545`). More generally, alert params are seeded from the server defaults and not from the chart instance, which affects every alertable indicator (e.g. a chart RSI(7) arms RSI(14) unless the user edits it).
- **User impact:** alerts on a different indicator from the one drawn. Disclosed, but surprising.
- **Complexity:** S (add `smooth_k` to the Python lane and the address inputs) plus M (seed alert params from the instance).
- **Regression risk:** M (replay grid).

### D-6 (P2): Server alert bars coerce NULL OHLC to 0.0
- `indicator_alert_evaluator.py:1113-1118`. A NULL price row becomes a zero-price bar, which injects a −100% move into RSI/ATR/etc. The expected behaviour is to drop the bar or carry NaN. **Not verified** whether the store ever contains NULL OHLC. Complexity S; risk L.

### D-7 (P3): NaN-hole policy differs between native and formula lanes
- Native MA restarts, formula EMA holds, formula SMA/stdev skip (`verify.json` `nanPolicy`). A chart "EMA 20" and a formula `ema(close,20)` over a gappy *source* (fundamental, economic or other-symbol series) disagree for roughly n bars after every hole. Expected: one documented policy per function across lanes. Complexity M; risk M (parity fixtures).

### D-8 (P3): Session VWAP blanked for the rest of the session by one NaN volume
- `indicators.js:367-371`: `cumVol` becomes NaN, so `cumVol > 0` is false until the next day. Expected: skip the bar, as AVWAP does (`Number(bar.v) || 0`, `indicators.js:1091`). Complexity S; risk L.

### D-9 (P3): Starter "Power Earnings Gap" is a pre-earnings filter
- `engine/ast/starterScans.json` `starters["Power Earnings Gap"].source = "days_to_earnings >= 0 && days_to_earnings <= 7 && rs_rank >= 70"`. The name implies a post-earnings gap-up. Either rename it or ground it on gap or earnings-reaction fields. Complexity S.

### D-10 (P3): `computeFor` does not defend its own input domain
- Stochastic `kPeriod: 0` throws; negative or fractional periods yield plausible garbage (`verify.json` `inputDomain`). The UI paths validate, so the impact is limited to programmatic writers (agent mutations, migrations). Clamp or refuse in `resolveInputs`. Complexity S.

### D-11 (P3): Volume Profile is approximate and untested
- Each bar's whole volume goes to its hlc3 bin; no range distribution, no up/down split, no value area (`StockChart.jsx:1972-2018`); no unit test of the binning. Complexity M.

### D-12 (P3): RS line 6-dp delivery rounding
- `compute_rs_line` rounds to 6 dp (`indicator_compute.py:2392-2405`). For a $0.20 stock against a ~$600 benchmark (ratio ≈ 3e-4), the resolution is about 0.3% per step, which is visible as stair-stepping. Prefer relative precision or a scaled ratio. Complexity S.

### Gap G-1 (P2, product): Tier-1 library is chart-only
- 33 studies plus `atrBands`, `avwap`, `dollarVolume` and `rsLine` have no alert, screener or formula access (`nativeRegistry.js:1254-1256`; `SERIES_FUNCS`). 27 Tier-1 studies have no formula primitive (§1.5). Competitors allow alerts on any plotted indicator. Complexity L (Python twins plus parity fixtures per study).

---

## 5. Tests run

**Frontend** (`npx vitest run … --reporter=dot`), **26 files: 1941 passed, 4 skipped, 0 failed** (4.75 s):
`indicators.test.js`, `technicalStudies.oracle.test.js`, `technicalStudies.edge.test.js`, `movingAverages.test.js`, `goldenFixtures.test.js`, `indicators.macdAlignment.test.js`, `engine/nativeRegistry.test.js`, `engine/ast/interpret.test.js`, `engine/ast/lint.test.js`, `engine/ast/vendorTruth.test.js`, `engine/ast/trees.parity.test.js`, `engine/ast/bindParity.test.js`, `engine/ast/clockParity.test.js`, `engine/ast/nanLaundering.test.js`, `engine/__tests__/mtfProjection.test.js`, `engine/lowerTf.test.js`, `engine/__tests__/adxObvDonchianFlipParity.test.js`, `…/macdFlipAParity.test.js`, `…/bbFlipAParity.test.js`, `…/mfiCciWilliamsFlipParity.test.js`, `…/everyIndicatorParameterSweep.test.js`, `…/finiteWindowNa.test.js`, `engine/ast/pine.vendorParity.test.js`, `engine/ast/hma.test.js`, `engine/ast/atrPine.vendor.test.js`, `engine/__truth__/p1.core.truth.test.js`.

**Python** (`pytest -q -p no:cacheprovider`), **401 passed, 5 skipped, 1 failed** (19 s):
`tests/test_indicator_compute.py`, `test_indicator_golden.py`, `test_ast_indicators.py`, `test_ast_vwap_parity.py`, `test_atr_pine_parity.py`, `test_ast_lint.py`, `test_ast_math_parity.py`, `test_ast_lookback_parity.py`, `test_ast_conformance.py`.
- **FAILED** `tests/test_ast_conformance.py::test_the_guarded_census_offers_each_case_to_the_DOOR_ITS_CLAIM_IS_ABOUT`: `RecursionError: maximum recursion depth exceeded while encoding a JSON object` in `tools/ast_conformance.py:868 _node_run` (it JSON-dumps a deeply nested escape-case AST to hand to node). This is a test-harness / environment-depth failure, not a calculation defect. It may be pre-existing; it is not in the memory list of known reds. P3: raise the recursion limit locally or send that case's source rather than its tree.

**Scratch harnesses** (this audit): `verify.test.js` (5 tests), `mtf.test.js`, `avwap.test.js`, `dump.test.js`, `pinevocab.test.js`: all pass. `py_parity.py` printed the table in §2.

## 6. Confidence and limitations

- **High:** the inventory (dumped from the live module), the arithmetic of the 9 verified indicators, JS/Python parity, the native lookahead probe, MTF projection, and the eligibility matrix.
- **Medium:** D-3, which is code-traced but not run against the real store; status labels for the data-series families (Market-Indicator `status` field not traced to the UI).
- **Not covered in depth:** the Pine runtime VM (`engine/runtime/`), object/drawing lanes, the economic/fundamental/breadth series maths, Volume pane internals, and the legacy MA overlay system (`maAdoption.js`). The Tier-1 maths was verified through the existing TA-Lib-checked oracle test, not re-derived independently.
- Synthetic data only. The prefix probe used default inputs and 4 cut points. Edge cases such as half-days, holidays and splits were not exercised here.
