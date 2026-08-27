# SOURCES — pine_community (30 scripts, fetched 2026-08-25)

Every file is the **current published revision** of an open-source TradingView
script, byte-for-byte as served. Fetch path: TradingView's own source endpoint
`https://pine-facade.tradingview.com/pine-facade/get/PUB%3B<id>/last` (the JSON the
script page's source box loads; every one of the 30 answered `scriptAccess:
open_no_auth`). For the 12 pages that additionally embed the source in the page
HTML, the two copies were compared: 11 byte-identical, 1 (#21) differs by one
comment word because the page's chart snapshot predates the author's last edit —
the file holds the current revision, which is what the page's source box shows.
Line endings are preserved as published (22 files CRLF, 8 LF).

**Popularity** = TradingView "boosts" (`agreeCount`) on 2026-08-25, from the
search endpoint the site uses. Buckets: **A** most-used indicators · **B**
swing/momentum setups · **C** `security()` multi-timeframe on the same symbol ·
**X** references another symbol · **D** drawings / arrays / loops.

**Licence recording.** Where the source carries a licence line it is quoted
verbatim below. Where it carries none, the entry says *TV-default MPL-2.0*: the
script is published open-source on TradingView, and TradingView's Terms of Use
§22 "Scripts" (read 2026-08-25) state *"You can publish the script under any
license. If you do not include the license in the comment section of a script,
you agree that your script is licensed under the Mozilla Public License 2.0."*
Nothing here is protected, invite-only, or carries a header forbidding
redistribution (candidates that did — see README — were skipped).

**Version** = Pine version from the `//@version` line (v1 = no line). *TV rev* =
TradingView's revision counter and the date of that revision as returned by the
endpoint (old v1/v2 scripts report no revision date).

---

## 01-squeeze-momentum-lazybear.pine — A
- Title: Squeeze Momentum Indicator [LazyBear] (in-script `Squeeze Momentum Indicator [LazyBear]`, short `SQZMOM_LB`)
- URL: https://www.tradingview.com/script/nqQ1DT5a-Squeeze-Momentum-Indicator-LazyBear/
- Author: LazyBear · boosts 115,429 · published 2014-07-04
- Licence line: none in source (`// @author LazyBear` only) — TV-default MPL-2.0
- Version: Pine v1 (no `//@version`), `study()`, 41 lines · TV rev — · fetched 2026-08-25
- What it does: John Carter's TTM Squeeze rebuilt: Bollinger Bands inside the Keltner Channel = "squeeze on" (cross markers on the zero line), momentum = linear regression of price minus the average of the Donchian midline and SMA, drawn as a four-colour histogram.
- Constructs: input() legacy, plot() histogram/cross styles, bare TA builtins (sma, stdev, atr, tr, linreg, highest, lowest, avg), nz(), history [], ternary, `study(overlay=false)`

## 02-wavetrend-oscillator-lazybear.pine — A
- Title: Indicator: WaveTrend Oscillator [WT] (in-script `WaveTrend [LazyBear]`, short `WT_LB`)
- URL: https://www.tradingview.com/script/2KE8wTuF-Indicator-WaveTrend-Oscillator-WT/
- Author: LazyBear · boosts 60,342 · published 2014-05-27
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v1, `study()`, 33 lines, LF line endings · TV rev — · fetched 2026-08-25
- What it does: WaveTrend oscillator — EMA-normalised deviation of hlc3 (`ci = (ap - esa) / (0.015 * d)`), `wt1 = ema(ci)`, `wt2 = sma(wt1, 4)`, two overbought/oversold level pairs and an area plot of `wt1 - wt2`.
- Constructs: input() legacy, plot() with numeric `style=3`/area/transp, bare TA builtins (ema, sma, abs)

## 03-cm-williams-vix-fix.pine — A
- Title: CM_Williams_Vix_Fix Finds Market Bottoms (in-script `CM_Williams_Vix_Fix`)
- URL: https://www.tradingview.com/script/og7JPrRA-CM-Williams-Vix-Fix-Finds-Market-Bottoms/
- Author: ChrisMoody · boosts 65,068 · published 2014-07-24
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v1, `study()`, 28 lines · TV rev — · fetched 2026-08-25
- What it does: Larry Williams' "VIX Fix" — `(highest(close, pd) - low) / highest(close, pd) * 100` as a histogram, coloured lime when it pierces a Bollinger upper band or a percentile range-high of its own history (optional band and range plots).
- Constructs: input() legacy with minval/maxval, plot() histogram, bare TA builtins (highest, sma, stdev), ternary

## 04-ut-bot-alerts.pine — A
- Title: UT Bot Alerts (in-script `UT Bot Alerts`)
- URL: https://www.tradingview.com/script/n8ss8BID-UT-Bot-Alerts/
- Author: QuantNomad · boosts 56,660 · published 2020-02-08
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v4, `study()`, 42 lines · TV rev 1 (2020-02-08) · fetched 2026-08-25
- What it does: ATR trailing stop (`key value × ATR`) that ratchets with price and flips on a close through it; buy/sell labels on the flip, bar colouring, optional Heikin-Ashi source pulled through `security(heikinashi(syminfo.tickerid), timeframe.period, close)`, two `alertcondition`s.
- Constructs: security() legacy with heikinashi() ticker modifier, lookahead=false, `:=` reassignment, plotshape labelup/labeldown, barcolor, alertcondition, color.*, syminfo.*, timeframe.*, nz(), bare TA builtins (atr, ema, crossover), history [], ternary

## 05-chandelier-exit.pine — A
- Title: Chandelier Exit (in-script `Chandelier Exit`, short `CE`)
- URL: https://www.tradingview.com/script/AqXxNS7j-Chandelier-Exit/
- Author: everget (Alex Orekhov) · boosts 28,594 · published 2019-03-06
- Licence line: `// Copyright (c) 2019-present, Alex Orekhov (everget)` / `// Chandelier Exit script may be freely distributed under the terms of the GPL-3.0 license.`
- Version: Pine v6, `indicator()`, 58 lines · TV rev 8 (2025-07-28) · fetched 2026-08-25
- What it does: Chuck LeBeau's Chandelier Exit — long stop = highest close/high − ATR×mult, short stop = lowest + ATR×mult, both ratcheting; a direction state flips on a close beyond the opposite stop, with buy/sell labels, state fills, three `alertcondition`s and an "await bar confirmation" option.
- Constructs: `const string`, input.int/float/bool with group, ta.atr/ta.highest/ta.lowest, math.max/min, var, `:=`, plot() with plot.style_linebr and display.none, plotshape absolute location, fill() between plots, alertcondition, barstate.isconfirmed, nz(), history [], ternary

## 06-qqe-mod.pine — A
- Title: QQE MOD (in-script `QQE MOD`)
- URL: https://www.tradingview.com/script/TpUW4muw-QQE-MOD/
- Author: Mihkel00 · boosts 13,501 · published 2020-01-20
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v6, `indicator()`, 95 lines · TV rev 2 (2024-12-11) · fetched 2026-08-25
- What it does: Two Quantitative Qualitative Estimation oscillators (smoothed RSI with an ATR-of-RSI trailing band) in one pane — the primary QQE filtered through Bollinger Bands into a coloured histogram, the secondary QQE as a trend line with threshold colouring — plus overbought/oversold alerts.
- Constructs: input.int/float/source with group + tooltip, user function `=>` returning a tuple, ta.rsi/ta.ema/ta.sma/ta.stdev/ta.cross, math.abs, `:=`, `if` blocks, plot() with hline, alertcondition, color.*, max_lines_count, history [], ternary

## 07-hull-suite.pine — A
- Title: Hull Suite (in-script `Hull Suite by InSilico`)
- URL: https://www.tradingview.com/script/hg92pFwS-Hull-Suite/
- Author: InSilico · boosts 21,980 · published 2019-10-18
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v4, `study()`, 52 lines · TV rev 10 (2021-11-09) · fetched 2026-08-25
- What it does: Hull moving average in three flavours (HMA, THMA, EHMA) drawn as a two-line band coloured by slope, with an optional higher-timeframe version via `security(syminfo.ticker, htf, _hull)`, candle colouring and two `alertcondition`s.
- Constructs: security() legacy on same symbol with input.resolution, user functions `=>` (HMA/EHMA/THMA), input() legacy with options, plot() + fill(), barcolor, alertcondition, syminfo.ticker, bare TA builtins (wma, ema, round, sqrt), history [], ternary

## 08-smoothed-heiken-ashi-candles.pine — A
- Title: Smoothed Heiken Ashi Candles v1 (in-script `Smoothed Heiken Ashi Candles`)
- URL: https://www.tradingview.com/script/ROokknI2-Smoothed-Heiken-Ashi-Candles-v1/
- Author: jackvmk · boosts 11,402 · published 2016-02-18
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v2, `study()`, 22 lines · TV rev — · fetched 2026-08-25
- What it does: EMA-smooths open/high/low/close, applies the Heikin-Ashi transform to the smoothed series, EMA-smooths the result again and draws it with `plotcandle`.
- Constructs: input() legacy, plotcandle, nz(), bare TA builtins (ema), history [], ternary

## 09-obv-oscillator-lazybear.pine — A
- Title: Indicator: OBV Oscillator (in-script `On Balance Volume Oscillator [LazyBear]`, short `OBVOSC_LB`)
- URL: https://www.tradingview.com/script/Ox9gyUFA-Indicator-OBV-Oscillator/
- Author: LazyBear · boosts 15,302 · published 2014-03-28
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v1, `study()`, 16 lines, LF line endings · TV rev — · fetched 2026-08-25
- What it does: On-balance volume built with `cum()` of signed volume, minus its EMA, plotted as a coloured line and a grey area around a zero `hline`.
- Constructs: user function `=>` (obv), input() legacy, plot() line + area, hline, bare TA builtins (cum, change, ema), ternary

## 10-ehlers-instantaneous-trend-lazybear.pine — A
- Title: Ehlers Instantaneous Trend [LazyBear] (in-script same, short `EIT_LB`)
- URL: https://www.tradingview.com/script/DaHLcICg-Ehlers-Instantaneous-Trend-LazyBear/
- Author: LazyBear · boosts 9,237 · published 2015-05-22
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v1, `study(overlay=true, precision=3)`, 22 lines · TV rev — · fetched 2026-08-25
- What it does: John Ehlers' Instantaneous Trendline (recursive alpha filter over hl2) with a 2-bar lagged trigger line, a fill between them coloured by trend, and optional bar colouring.
- Constructs: input() legacy with step, recursive series via history [] and nz(), plot() with a hidden "dummy" plot, fill() with transp, barcolor, ternary

## 11-52-week-high-low.pine — B
- Title: 52 Week High/Low (in-script `52 Week High/Low`, short `52W`)
- URL: https://www.tradingview.com/script/kSeWecuE-52-Week-High-Low/
- Author: BacktestRookies · boosts 1,485 · published 2018-01-03
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v3, `study()`, 16 lines · TV rev 1 (2018-01-03) · fetched 2026-08-25
- What it does: Pulls `highest(high, 52)` / `lowest(low, 52)` (or of closes) from the weekly timeframe with `security(tickerid, "W", …, lookahead=barmerge.lookahead_on)` and draws the 52-week high and low as `trackprice` levels on any chart.
- Constructs: security() legacy on same symbol ("W") with lookahead_on, input() with options, plot() with trackprice + `offset=-9999`, bare TA builtins (highest, lowest), ternary

## 12-vcp-tightness-score.pine — B
- Title: VCP Tightness Score (ADR-Adjusted) (in-script `VCP Tightness Score [0-100]`)
- URL: https://www.tradingview.com/script/0zwZeRQL-VCP-Tightness-Score-ADR-Adjusted/
- Author: etfbreakouts · boosts 612 · published 2026-03-15
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v5, `indicator()`, 53 lines, LF line endings · TV rev 1 (2026-03-15) · fetched 2026-08-25
- What it does: Measures the spread of the last N bars' highs/lows, divides by the stock's average daily range % and by a rolling baseline, and emits a 0-100 tightness score for volatility-contraction bases with dashed `hline`s at 10/25/50.
- Constructs: input.int with tooltip, ta.highest/ta.lowest/ta.sma, plot() with plot.style_line, hline with hline.style_*, color.*, ternary

## 13-relative-strength-vs-benchmark-spy.pine — B
- Title: Relative Strength vs Benchmark SPY (in-script `Relative Strength vs Benchmark`)
- URL: https://www.tradingview.com/script/4CoVYBJh-Relative-Strength-vs-Benchmark-SPY/
- Author: josesalvada · boosts 50 · published 2025-11-08
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v5, `indicator()`, 33 lines, LF line endings · TV rev 1 (2025-11-08) · fetched 2026-08-25
- What it does: Relative-strength line `close / benchmark close` where the benchmark is an `input.symbol("SPY")` fetched with `request.security(benchmark, timeframe.period, close)`, an EMA of the RS line, green/red background while RS is above/below its EMA, and cross-over/under `alertcondition`s. (The only bucket-B script that references another symbol.)
- Constructs: request.security on another symbol, input.symbol/int/bool, ta.ema/ta.crossover/ta.crossunder, var + `:=`, plot(), bgcolor with color.new, alertcondition, timeframe.period, nz(), ternary

## 14-earnings-gap-ups.pine — B
- Title: Earnings Gap Ups (in-script `Earnings Gap Ups`)
- URL: https://www.tradingview.com/script/KWTJ9jeC-Earnings-Gap-Ups/
- Author: Amphibiantrading · boosts 607 · published 2024-12-15
- Licence line: `// This Pine Script™ code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © Amphibiantrading`
- Version: Pine v6, `indicator()`, 114 lines · TV rev 1 (2024-12-15) · fetched 2026-08-25
- What it does: Flags earnings-day gap-ups by gap size and volume versus the 50-day average, then draws the high-volume close (HVC) line, an HVC-undercut line, the gap-day high/low and an "alpha window" box for each event; every line style is an `enum` input resolved by a `method`.
- Constructs: `enum` declarations + input.enum, `type` (UDT) + `method` with `switch`, input.color/bool with inline, ta.sma, math.*, var + `:=`, array.*, line.new, box.new, label.new, `for` loop, `if` blocks, syminfo.*, barmerge/lookahead, nz(), history [], ternary

## 15-inside-bar.pine — B
- Title: Inside Bar (in-script `Inside Bar Ind/Alert`)
- URL: https://www.tradingview.com/script/IyIGN1WO-Inside-Bar/
- Author: cma · boosts 3,202 · published 2016-07-27
- Licence line: `// This source code is subject to the terms of the GNU License 2.0 at https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html` / `// © cma`
- Version: Pine v4, `study()`, 30 lines · TV rev 4 (2020-09-09) · fetched 2026-08-25
- What it does: Detects inside bars (high/low within the prior bar's range) through a small user function returning +1/−1, colours them green/red by candle direction, marks them with triangles and fires an `alertcondition`.
- Constructs: user function `=>` with `if`/`else` returning ints, barcolor, plotshape triangleup/down (multi-line call), alertcondition, color.*, history [], ternary

## 16-nr4-nr7.pine — B
- Title: NR4 & NR7 (in-script `NR4 & NR7`)
- URL: https://www.tradingview.com/script/fWURG77G-NR4-NR7/
- Author: FxLowe · boosts 1,010 · published 2016-04-01
- Licence line: none in source (`//FxLowe - NR4 & NR7.`) — TV-default MPL-2.0
- Version: Pine v2, `study()`, 12 lines · TV rev — · fetched 2026-08-25
- What it does: Narrow-range-4 and narrow-range-7 bars from the built-in `tr` series (`tr <= tr[1] … tr[6]`), painted with `barcolor` and marked with `plotshape` arrows carrying `\n` text.
- Constructs: bare `tr` builtin series, history [], barcolor with offset/editable, plotshape with multi-line text, ternary

## 17-pocket-pivot-breakout.pine — B
- Title: Pocket Pivot Breakout (in-script `Pocket Pivot Breakout`)
- URL: https://www.tradingview.com/script/cPBPBvx4-Pocket-Pivot-Breakout/
- Author: simatricks · boosts 1,746 · published 2023-11-22
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v6, `indicator()`, 35 lines · TV rev 3 (2025-03-11) · fetched 2026-08-25
- What it does: Pocket pivot (Morales/Kacher): an up day whose volume exceeds the largest down-day volume of the prior N days — fills an `array.new<float>` with down-day volumes in a `for` loop, compares in a second loop, then plots a triangle, optionally colours gap-up bars and raises two `alertcondition`s.
- Constructs: array.new<float>/array.set/array.get, two `for` loops with nested `if`, `:=`, input() legacy in v6, plotshape, barcolor, alertcondition, color.*, history [], ternary

## 18-minervini-trend-template.pine — B
- Title: Minervini Trend Template (in-script `Minervini Trend Template`)
- URL: https://www.tradingview.com/script/zygjiw4C-Minervini-Trend-Template/
- Author: yogy.frestarahmawan · boosts 3,455 · published 2021-01-04
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © yogy.frestarahmawan`
- Version: Pine v5, `indicator()`, 126 lines · TV rev 10 (2023-03-05) · fetched 2026-08-25
- What it does: Scores Mark Minervini's trend-template criteria (price above the 50/150/200 SMA, 150 > 200, 200 rising, 50 above both, ≥ 30 % off the 52-week low, within 25 % of the 52-week high, RS rating) and reports each as pass/fail in a `table.new` panel, while plotting the MAs and 52-week levels.
- Constructs: table.new + table.cell via helper functions, var, input.bool/string with inline + group and input() legacy, ta.sma/ta.highest/ta.lowest, str.tostring, `if` blocks, plot() with trackprice/offset, barstate.islast, color.*, history [], ternary

## 19-cm-macd-ult-mtf.pine — C
- Title: MacD Custom Indicator-Multiple Time Frame+All Available Options! (in-script `CM_MacD_Ult_MTF`)
- URL: https://www.tradingview.com/script/OQx7vju0-MacD-Custom-Indicator-Multiple-Time-Frame-All-Available-Options/
- Author: ChrisMoody · boosts 81,279 · published 2014-04-16
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v1, `study()`, 54 lines, LF line endings · TV rev — · fetched 2026-08-25
- What it does: MACD line, signal and histogram computed on the chart timeframe or a chosen higher one via `security(tickerid, res, …)`, with a four-colour histogram, line colour change on the signal cross and cross dots.
- Constructs: security() legacy ×3 on same symbol with `type=resolution` input and `useCurrentRes ? period : resCustom`, input() legacy, plot() histogram/circles, hline, bare TA builtins (ema, sma), history [], ternary

## 20-cm-ultimate-ma-mtf.pine — C
- Title: Ultimate Moving Average-Multi-TimeFrame-7 MA Types (in-script `CM_Ultimate_MA_MTF`)
- URL: https://www.tradingview.com/script/OQs2lVvr-Ultimate-Moving-Average-Multi-TimeFrame-7-MA-Types/
- Author: ChrisMoody · boosts 36,269 · published 2014-04-28
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v1, `study(overlay=true)`, 61 lines, LF line endings · TV rev — · fetched 2026-08-25
- What it does: One of seven moving averages (SMA, EMA, WMA, Hull, VWMA, RMA, TEMA — selected by an integer input) on the chart or a custom timeframe via `security(tickerid, res, out)`, coloured by smoothed direction, with an optional second MA and cross dots.
- Constructs: security() legacy ×2 on same symbol with `type=resolution`, chained ternary MA selector, input() legacy, plot() with circles style, bare TA builtins (sma, ema, wma, vwma, rma, sqrt, round, rising, falling, cross), history [], ternary

## 21-ma-cross-alert-mtf-chartart.pine — C
- Title: Moving Average Cross Alert, Multi-Timeframe (MTF) (by ChartArt) (in-script `Moving Average Cross Alert, Multi-Timeframe Option (MTF) (by ChartArt)`)
- URL: https://www.tradingview.com/script/bcWGvngm-Moving-Average-Cross-Alert-Multi-Timeframe-MTF-by-ChartArt/
- Author: ChartArt · boosts 20,188 · published 2015-09-15
- Licence line: none in source — TV-default MPL-2.0. (The page's chart snapshot still shows the author's earlier comment "HL2, HLC3 or HLC4"; the current revision, which the page's source box shows and this file holds, reads "OHLC4" — the only difference.)
- Version: Pine v1, `study(overlay=true)`, 81 lines · TV rev — · fetched 2026-08-25
- What it does: Short and long moving averages (SMA/EMA/WMA/linear regression by integer input) of a price source pulled from the chart or a chosen timeframe via `security(tickerid, res, pricetype)`, filled between, bars coloured by trend, cross markers and up/down "alert" plots.
- Constructs: security() legacy on same symbol with `type=resolution`, user functions `=>` (TrendingUp/Down, Uptrend/Downtrend), input() legacy, plot() linebr + fill(), barcolor, plotshape, bgcolor, bare TA builtins (sma, ema, wma, linreg), history [], ternary

## 22-daily-weekly-monthly-highs-lows.pine — C
- Title: Previous Day Week Highs & Lows (in-script `Daily Weekly Monthly Highs & Lows`, short `DWM HL`)
- URL: https://www.tradingview.com/script/Lw708Lif-Previous-Day-Week-Highs-Lows/
- Author: sbtnc · boosts 5,958 · published 2020-01-12
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © sbtnc`
- Version: Pine v5 written as `// @version=5` (space after `//`), `indicator(max_lines_count=500)`, 137 lines · TV rev 3 (2022-02-09) · fetched 2026-08-25
- What it does: Requests `[time, high, low, barstate.islast]` tuples from the 'D', 'W' and 'M' timeframes of the chart symbol and draws the previous daily/weekly/monthly highs and lows as `line.new` levels with a configurable lookback, optional right-side projections and gradient colouring.
- Constructs: request.security ×3 on same symbol returning tuples with lookahead/barmerge, var-declared inputs (input.int/input with inline + group), array.new_float, line.new + line.set_*, `for` loops, `if` blocks, user functions `=>`, `:=`, syminfo.*, timeframe.*, barstate.*, history [], ternary

## 23-higher-timeframe-ema.pine — C
- Title: Higher Timeframe EMA (in-script `Higher Timeframe EMA (HTF EMA)`, short `EMA+`)
- URL: https://www.tradingview.com/script/Vh3XG9sD-Higher-Timeframe-EMA/
- Author: ZenAndTheArtOfTrading · boosts 1,602 · published 2019-01-05
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © ZenAndTheArtOfTrading | PineScriptMastery`
- Version: Pine v6 written as `// @version=6` (space after `//`), `indicator()`, 18 lines · TV rev 12 (2025-01-10) · fetched 2026-08-25
- What it does: An EMA from a higher timeframe (`input.timeframe`) on the current chart using the non-repainting idiom `request.security(syminfo.tickerid, res, ema[barstate.isrealtime ? 1 : 0])[barstate.isrealtime ? 0 : 1]`, with an optional `gaps=barmerge.gaps_on` smoothed variant and colour by price position.
- Constructs: request.security ×2 on same symbol with gaps=barmerge.gaps_on, input.timeframe/int/bool, ta.ema, barstate.isrealtime, history [] applied to a request.security result, syminfo.tickerid, plot(), color.*, ternary

## 24-multi-timeframe-rsi.pine — C
- Title: Multi Timeframe RSI (in-script `Multi Timeframe RSI`, short `MTF_RSI`)
- URL: https://www.tradingview.com/script/kaIjbbiv-Multi-Timeframe-RSI/
- Author: 20813 · boosts 898 · published 2015-03-11
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v1, `study()`, 29 lines · TV rev — · fetched 2026-08-25
- What it does: RSI of the chart symbol on 5m/15m/30m/1h/2h/4h/1D at once, each via `security(ticker, "<res>", rsi(src, len))`, individually toggleable and plotted together in one pane.
- Constructs: security() legacy ×7 on same symbol (the v1 `ticker` variable), typed input() legacy (`type=integer/source/bool`), plot(), bare TA builtins (rsi), ternary

## 25-spy-expected-move-by-vix.pine — X
- Title: SPY Expected Move by VIX (in-script `S - SPY VIX Pot`)
- URL: https://www.tradingview.com/script/Q3jRR7sN-SPY-Expected-Move-by-VIX/
- Author: QuantXOR · boosts 2,918 · published 2020-04-26
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// Initially created by © LazySprinter - modified by me`
- Version: Pine v6, `indicator(overlay=true)`, 172 lines · TV rev 8 (2024-12-23) · fetched 2026-08-25
- What it does: Reads implied volatility from another symbol — `input.symbol('CBOE:VIX')` via `request.security`, or single-stock VIX indices built with `ticker.new('CBOE', 'VXAPL' …)` — converts it to a one-standard-deviation expected move and draws the ±1σ and 50 % levels from the daily/weekly open, showing each level only while price is near it (loop-based proximity), plus a VWAP.
- Constructs: request.security on other symbols (input.symbol + ticker.new), user functions `=>`, `for` loop, `if` blocks, `switch`, `:=`, input.string/color/symbol/int and input() legacy, time() period detection, math.sqrt/math.abs, plot() styles by switch + fill(), syminfo.*, timeframe.*, barmerge.gaps_on, nz(), bare `vwap` builtin, history [], ternary

## 26-spy-to-es-qqq-to-nq.pine — X
- Title: SPY to ES or QQQ to NQ (in-script `SPY to ES or QQQ to NQ`)
- URL: https://www.tradingview.com/script/X4ejLNjy-SPY-to-ES-or-QQQ-to-NQ/
- Author: kfatkin ("Fatty Trades") · boosts 626 · published 2022-10-20
- Licence line: none in source — TV-default MPL-2.0
- Version: Pine v5, `indicator(overlay=true)`, 117 lines, LF line endings · TV rev 4 (2022-10-23) · fetched 2026-08-25
- What it does: On a futures chart, pulls the ETF (SPY or QQQ) close and VWAP with `request.security(t, timeframe.period, …)`, derives a smoothed ETF-to-futures ratio and converts an entered ETF strike/target into the equivalent ES/NQ price, drawn as a level with a `label.new` and summarised in a `table.new`; table size and position come from `switch` blocks.
- Constructs: request.security on another symbol (string ticker) and on syminfo.ticker, `switch` expressions, input.bool/price/string/source/int with group + tooltip, ta.vwap/ta.sma, var, label.new, table.new + table.cell, str.tostring, `if` blocks, plot(), barstate.islast, color.*, barmerge.gaps_on, ternary

## 27-support-resistance-channels.pine — D
- Title: Support Resistance Channels (in-script `Support Resistance Channels`, short `SRchannel`)
- URL: https://www.tradingview.com/script/Ej53t8Wv-Support-Resistance-Channels/
- Author: LonesomeTheBlue · boosts 45,794 · published 2021-04-08
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © LonesomeTheBlue`
- Version: Pine v6, `indicator(overlay=true, max_bars_back=501)`, 193 lines · TV rev 6 (2025-07-04) · fetched 2026-08-25
- What it does: Collects pivot highs/lows over a loopback window into arrays, loops over them to build the strongest channels no wider than a percentage of the range, keeps the top N as `box.new` support/resistance zones (recoloured when price is inside), optionally shows pivots, broken levels and two MAs, and alerts on breaks.
- Constructs: array.* (new_float/push/get/set/size/unshift/pop), nested `for` loops, `if` blocks, user functions `=>`, var + `:=`, box.new/box.set_*/box.delete, plot() + plotshape, alertcondition, ta.pivothigh/ta.pivotlow/ta.sma/ta.ema/ta.highest/ta.lowest, math.*, input.int/string/color/bool with group + tooltip + inline, nz(), history [], ternary

## 28-support-resistance-dynamic-v2.pine — D
- Title: Support Resistance - Dynamic v2 (in-script `Support Resistance - Dynamic v2`, short `SRv2`)
- URL: https://www.tradingview.com/script/va09eWAp-Support-Resistance-Dynamic-v2/
- Author: LonesomeTheBlue · boosts 28,229 · published 2020-09-11
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © LonesomeTheBlue`
- Version: Pine v5, `indicator(overlay=true)`, 153 lines, LF line endings · TV rev 9 (2024-08-03) · fetched 2026-08-25
- What it does: Stores the last N pivot highs/lows in arrays, clusters them into support/resistance levels by channel width and pivot count ("strength"), draws the top levels as `line.new` lines with `label.new` tags at a chosen offset, redraws on every bar and raises resistance-broken / support-broken alerts.
- Constructs: array.* (new_float/unshift/pop/get/set/size/sort/clear), nested `for` loops, `if` blocks, user functions `=>`, var + `:=`, line.new/line.set_*/line.delete, label.new/label.delete, plotshape, alertcondition, ta.pivothigh/ta.pivotlow/ta.highest/ta.lowest, math.*, str.tostring, input.int/string/color with group + tooltip and input() legacy, history [], ternary

## 29-zigzag-plus-plus.pine — D
- Title: ZigZag++ (in-script `ZigZag++`, short `ZigZag++ [LD]`)
- URL: https://www.tradingview.com/script/lj8djt1n-ZigZag/
- Author: DevLucem (Dev Lucem) · boosts 19,037 · published 2020-02-12
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © Dev Lucem`
- Version: Pine v5, `indicator(…, format.price, max_labels_count=200, max_lines_count=50)`, 87 lines · TV rev 9 (2024-01-11) · fetched 2026-08-25
- What it does: MetaTrader-style ZigZag (depth / deviation / backstep) that tracks the developing swing with `var` state, draws each leg with `line.new` (updating the live leg with `line.set_*`), tags pivots HH/HL/LH/LL with `label.new`, colours the background by direction and fires `alert()` on a direction change.
- Constructs: var + `:=` state machine, line.new/line.set_xy2/line.delete, label.new/label.set_*, `switch` for label size, `if` blocks, plotarrow, bgcolor, alertcondition + alert(), ta.highest/ta.lowest/ta.barssince, input.int/color and input() legacy with group, format.price, color.new, history [], ternary

## 30-pivot-points-high-low-mtf.pine — D
- Title: Pivot Points High Low Multi Time Frame (in-script same)
- URL: https://www.tradingview.com/script/w2cENzrs-Pivot-Points-High-Low-Multi-Time-Frame/
- Author: LonesomeTheBlue · boosts 13,836 · published 2022-05-01
- Licence line: `// This source code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/` / `// © LonesomeTheBlue`
- Version: Pine v5, `indicator(overlay=true, max_lines_count=500, max_labels_count=500)`, 62 lines · TV rev 2 (2022-05-01) · fetched 2026-08-25
- What it does: A user function computing pivot highs/lows and their bar times is evaluated on a higher timeframe through a six-element `request.security` tuple (`input.timeframe`, lookahead on), and each pivot is drawn on the lower-timeframe chart as a `line.new` level (xloc.bar_time) with a `label.new` price tag; an `array.new_int` of times keeps the drawings aligned.
- Constructs: request.security on same symbol returning a 6-tuple from a user function, ta.pivothigh/ta.pivotlow, array.new_int/push/get, var, `if` blocks, line.new with xloc.bar_time, label.new, str.tostring, math.*, input.timeframe/int/color with inline, syminfo.tickerid, lookahead/barmerge, nz(), history [], ternary
