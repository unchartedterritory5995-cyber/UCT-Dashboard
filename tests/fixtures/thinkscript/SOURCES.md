# SOURCES

Every `.ts` file here is a real, published thinkScript (thinkorswim) script, copied
verbatim from the source below on **2026-08-25** — original comments, casing,
whitespace, typos and even the en-dashes an author pasted into an expression are kept.
Nothing was reformatted or "fixed". Forum items are the text inside the post's code
block (or, for two scans typed inline, the exact code lines of the post); GitHub items
are byte-copies of the raw file.

## Terms as seen on 2026-08-25

- **usethinkscript.com** — Terms of Use (https://usethinkscript.com/help/terms/): content is
  user-submitted; *"You retain copyright over the Content"* (the poster keeps copyright and
  grants the site a licence); no explicit licence is granted to readers; house rule *"All content
  should be identified with headers intact and sources linked."* Every header line the poster
  left in the code is kept intact and the exact post is linked below. Where a post re-shares a
  script by another author (Mobius, WalkingBallista, Robert Payne …) the in-code header names
  them and the entry records both.
- **github.com/jsherretts/thinkscript-indicators** — MIT License (Copyright (c) 2020 iniguezdj).
- **github.com/seriousbacktester/ThinkOrSwim_Indicator_Library** — MIT License (Copyright (c) 2025).
- **github.com/ivelin/thinkorswim-apps** — Apache License 2.0 (Copyright 2025 ivelin.eth, stated in-file).
- ⛔ **tosindicators.com — NOT used.** Its Terms (https://tosindicators.com/terms) say *"You must
  include our header code, when sharing any of our free indicator files, or any of the code
  contained within"* and *"You may not copy, modify, adapt, reproduce, distribute, reverse
  engineer, decompile, or disassemble any aspect of The Services … All rights reserved."*
- ⛔ **toslc.thinkorswim.com (TOS Learning Center) — consulted, NOT copied.** Pages carry
  *"© 2026 Charles Schwab & Co., Inc. All rights reserved."* with no code licence; the
  reference examples (fold, switch, CompoundValue, AddOrder, GetTime …) were read only to
  confirm construct spellings.
- ⛔ **hahn-tech.com — NOT used.** Search results describe Pete Hahn's code as MPL-2.0 but the
  statement could not be verified on the pages fetched, so nothing was taken.
- ⛔ Code pasted into forum threads under a `# TD Ameritrade IP Company, Inc. (c)` header (the
  platform's own built-in study source) was skipped.

## Bucket A — classic indicator studies (6)

## 01-supertrend-mobius.ts
- Title: SuperTrend ("Chat Room Request")
- URL: https://usethinkscript.com/threads/supertrend-indicator-by-mobius-for-thinkorswim.7/post-12
- Author/handle: Mobius (in-code header); posted by BenTen, 2018-12-17
- Terms: usethinkscript.com Terms of Use (poster retains copyright; no explicit licence) — header intact
- Fetched: 2026-08-25
- What it does: ATR-band trailing stop that flips between HL2 ± mult×ATR on close, paints bars, and drops a bubble at each cross.
- Constructs: input, def, plot, MovingAverage, AverageType.HULL, TrueRange, HL2, recursive self-reference ST[1], if-then-else, AssignValueColor, AssignPriceColor, Color.CURRENT, AddChartBubble, crosses above/below, [1] offset

## 02-macd-lookback-cross-watchlist.ts
- Title: WalkingBallista MACD Lookback Cross
- URL: https://usethinkscript.com/threads/macd-format-triggers-scan-label-watchlist-for-thinkorswim.7745/post-1107
- Author/handle: WalkingBallista (in-code header); posted by BenTen, 2019-06-03
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: MACD value/average from MovingAverage; flags a bullish or bearish signal-line cross within a lookback window as 2/1/0 for a watchlist column.
- Constructs: declare lower, input, def, plot, MovingAverage, AverageType.EXPONENTIAL, crosses above/below, highest(), if-then-else, AssignValueColor, AssignBackgroundColor, Color.*

## 03-adx-dmi-lower.ts
- Title: ADX / DI+ / DI- (reply in "ADX DMI Indicator For ThinkOrSwim")
- URL: https://usethinkscript.com/threads/adx-dmi-indicator-for-thinkorswim.8055/post-73751
- Author/handle: Slippage, 2021-08-22
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Wilder DMI from scratch — +DM/−DM, ATR via TrueRange, DI+ and DI- plots, DX and the ADX smoothing.
- Constructs: declare lower, input, def, plot, quoted identifiers plot "DI+" / "DI-", AverageType.WILDERS, MovingAverage, TrueRange, AbsValue, if-then-else, [1] offset

## 04-rsi-with-rate-of-change.ts
- Title: RSI with RateOfChange
- URL: https://raw.githubusercontent.com/jsherretts/thinkscript-indicators/master/roc/rsi
- Author/repo: "Assembled by BenTen at useThinkScript.com" (in-code header, based on a @diazlaz thread) — github.com/jsherretts/thinkscript-indicators, MIT
- Terms: MIT License (repo LICENSE, Copyright (c) 2020 iniguezdj)
- Fetched: 2026-08-25
- What it does: Wilder-style RSI computed on a Rate-of-Change series with OB/OS lines, optional breakout arrows and value colouring.
- Constructs: declare lower, input, def, plot, assert, AverageType.WILDERS, MovingAverage, AbsValue, crosses above/below, Double.NaN, SetPaintingStrategy (DASHES, ARROW_UP/DOWN), AssignValueColor, DefineColor, .color(), SetHiding, SetDefaultColor, GetColor, Color.UPTICK/DOWNTICK, [n] offset

## 05-bollinger-rsi-buy-arrow.ts
- Title: SB_BB_RSI_Buy_Arrow
- URL: https://raw.githubusercontent.com/seriousbacktester/ThinkOrSwim_Indicator_Library/main/SB_BB_RSI_Buy_Arrow.thinkscript
- Author/repo: seriousbacktester — github.com/seriousbacktester/ThinkOrSwim_Indicator_Library, MIT
- Terms: MIT License (repo LICENSE, Copyright (c) 2025)
- Fetched: 2026-08-25
- What it does: Six-condition buy arrow — reversal bar off the lower Bollinger band with RSI recently oversold and bandwidth above a threshold.
- Constructs: declare upper, input, def, plot, built-in study reference BollingerBands(length=).UpperBand/.LowerBand, RSI(length=), "within 2 bars", boolean plot, setPaintingStrategy BOOLEAN_ARROW_UP, [1] offset

## 06-vwap-rejection.ts
- Title: vwap rejection signals
- URL: https://raw.githubusercontent.com/jsherretts/thinkscript-indicators/master/vwap-rejection.ts
- Author/repo: github.com/jsherretts/thinkscript-indicators, MIT
- Terms: MIT License
- Fetched: 2026-08-25
- What it does: Rebuilds the session/week/month VWAP with deviation from cumulative sums, then plots bull/bear rejection arrows with alerts and a label.
- Constructs: input enum, getAggregationPeriod, AggregationPeriod.WEEK/MONTH, assert, getYyyyMmDd, switch/case, daysFromDate, getDayOfWeek, first(), Floor, roundDown, compoundValue, if/else block assignment, vwap, Sqr, Sqrt, Max, alert + Alert.BAR + Sound.Ding, addlabel, SetPaintingStrategy BOOLEAN_ARROW_UP/DOWN, SetLineWeight, getColor

## Bucket B — momentum / volume / oscillator studies (5)

## 07-ttm-squeeze-watchlist.ts
- Title: TTM Squeeze Watchlist
- URL: https://usethinkscript.com/threads/ttm-squeeze-format-scan-watchlist-label-for-thinkorswim.2751/post-11389
- Author/handle: tomsk ("TSL", 11.13.2019 in-code), posted 2019-12-10
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: Counts consecutive squeeze-on bars from the built-in TTM_Squeeze study and colours the watchlist cell by the histogram's slope.
- Constructs: input, def, plot, built-in study reference TTM_Squeeze(...).SqueezeAlert / .Histogram with positional args, recursive counter, if-then-else, SetDefaultColor, AssignBackgroundColor, [1] offset

## 08-relative-strength-zscore-vs-spy.ts
- Title: RS Z-Score MACD-Style with Z-Line & Signal
- URL: https://usethinkscript.com/threads/relative-strength-z-score-histogram-for-thinkorswim.22106/post-160344
- Author/handle: justAnotherTrader, 2026-02-06
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Ratio of close to a benchmark symbol's close (SPY), z-scored over 126 bars, with a MACD-style fast/slow difference histogram, signal line, thresholds and cloud.
- Constructs: declare lower, input string, close(symbol=), IsNaN, Double.NaN, Average, StDev, ExpAverage, plot, SetDefaultColor, SetLineWeight, SetPaintingStrategy HISTOGRAM, AssignValueColor, AddCloud, SetStyle Curve.SHORT_DASH

## 09-above-average-price-volume.ts
- Title: Above Average Price / Volume (reply)
- URL: https://usethinkscript.com/threads/above-average-price-volume.10623/post-92244
- Author/handle: Svanoy, 2022-03-03
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Buy arrow when the prior close sits above the 20-day SMA of daily highs for three bars and prior volume beats the 50-day SMA of daily volume.
- Constructs: def, plot, AggregationPeriod.DAY, high(period=)/low(period=)/volume(period=) secondary aggregation, SimpleMovingAvg, Double.NaN, SetPaintingStrategy BOOLEAN_ARROW_UP, AssignValueColor, [n] offset

## 10-rsi-laguerre-fractal-energy.ts
- Title: RSI-Laguerre Self Adjusting With Fractal Energy Gaussian Price Filter
- URL: https://usethinkscript.com/threads/rsi-laguerre-with-fractal-energy-for-thinkorswim.116/post-574
- Author/handle: Mobius (V01.12.2016, in-code); "Adjusted for compatability with scanner … 7-14-19 Markos"; posted by markos, 2019-04-17
- Terms: usethinkscript.com Terms of Use — header intact (note: the source contains U+2013 en-dashes inside expressions, e.g. `(1 – alpha)`, kept as posted; the page renders the study name on line 3 in bold via a literal `<b>` tag left by the forum's old import — that is page markup, not code text, so the copied line reads `RSILg_FE_Gssn1` exactly as a reader copying the post gets it)
- Fetched: 2026-08-25
- What it does: Gaussian-filtered OHLC feeds a Laguerre RSI whose gamma is the fractal-energy reading; plots RSI, FE, OB/OS/mid lines, clouds and alerts.
- Constructs: declare lower, input, #hint, Double.Pi, Cos, Power, Sqrt, Log, Sum, Max, Min, Highest, Lowest, forward-declared def/plot then assigned, if/else block assignment, <> operator, IsNaN, Double.NaN, SetDefaultColor, HideBubble, HideTitle, SetStyle Curve.long_dash/short_DASH, AddCloud, Alert + Alert.BAR + Sound.Bell, crosses above/below, [n] offsets, U+2013 en-dash used as a minus sign

## 11-money-flow-index-mobile.ts
- Title: Money Flow Index with Overbought and Oversold Points for Mobile
- URL: https://usethinkscript.com/threads/money-flow-mfi-for-thinkorswim.14672/post-120962
- Author/handle: CoffeeKiller, 2023-01-11
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Typical-price money flow ratio over 14 bars → MFI, coloured by OB/OS, with dots when MFI crosses the bands.
- Constructs: input, def, plot, Sum with nested if-then-else, crosses above/below, Double.NaN, AssignValueColor, SetDefaultColor, SetPaintingStrategy POINTS, SetLineWeight, commented-out AddChartBubble, [1] offset

## Bucket C — Stock Hacker scan / study-filter snippets (5)

## 12-scan-volume-2x-avg-price-up-5pct.ts
- Title: reply in "Scan for stocks increase 2 times of average 50 days volume?"
- URL: https://usethinkscript.com/threads/scan-for-stocks-increase-2-times-of-average-50-days-volume.968/post-7892
- Author/handle: tomsk, 2019-11-02 (code typed inline in the post, not in a code block)
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Single boolean plot — volume above 2× its 50-bar average, above 1.03× the volume two bars back, and close up 5% on the bar.
- Constructs: def, plot, Average, [n] offsets, and, boolean plot

## 13-scan-52-week-high.ts
- Title: reply in "52 week high Scan" ("set it to weekly")
- URL: https://usethinkscript.com/threads/52-week-high-scan.11473/post-99742
- Author/handle: Joshua, 2022-06-03 (code typed inline in the post)
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Close within 2% of the 52-bar highest high (run on a weekly aggregation).
- Constructs: capitalised keywords Def/Plot, Highest, High/Close capitalised built-ins, boolean plot

## 14-scan-inside-bar.ts
- Title: Inside and Outside Bar (scan form)
- URL: https://usethinkscript.com/threads/outside-bars-and-or-inside-bars-candle-combinations-for-thinkorswim.8336/post-43480
- Author/handle: Mobius (8.7.2017, in-code header); posted by BenTen, 2020-12-03
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: Flags an inside bar (high < prior high and low > prior low) occurring within the last bar.
- Constructs: def, plot, [1] offset, and, "within 1 bars"

## 15-scan-premarket-gap-up.ts
- Title: Pre Market Gap Up Scan
- URL: https://usethinkscript.com/threads/premarket-gap-from-previous-close-for-thinkorswim.892/post-13965
- Author/handle: tomsk, 2020-01-16
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: Latches the close at the regular-session end and flags pre-market bars trading 80% above it (1-minute aggregation).
- Constructs: def, plot, getTime, RegularTradingEnd, RegularTradingStart, getYYYYMMDD, crosses (bare), recursive self-reference, boolean plot

## 16-scan-rsi-crosses-30-70.ts
- Title: study-alert condition in "RSI Format, Label, Watchlist, Scan"
- URL: https://usethinkscript.com/threads/rsi-format-label-watchlist-scan-for-thinkorswim.798/post-1461
- Author/handle: theelderwand, 2019-06-25
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Bare condition with no plot — RSI crossing up through 30 or down through 70.
- Constructs: built-in study reference RSI() with no args, crosses above/below, or, expression-only script (no plot/def)

## Bucket D — state and iteration (4)

## 17-compoundvalue-vs-manual-fibonacci.ts
- Title: Using CompoundValue() Function (Fibonacci two ways)
- URL: https://usethinkscript.com/threads/using-compoundvalue-function.2010/post-19028
- Author/handle: korygill, 2020-03-29
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: Generates the Fibonacci sequence with CompoundValue(2, x[1]+x[2], 1) and again with a BarNumber-guarded if/else block, selectable by an enum input.
- Constructs: declare lower, input enum, mode == mode.Value enum comparison, double.NaN, BarNumber, CompoundValue, recursive [1]/[2] offsets, forward-declared def with if/else block assignment, plot, AddChartBubble

## 18-fold-up-down-points-ratio.ts
- Title: UpPoints DownPoints Ratio
- URL: https://usethinkscript.com/threads/coding-help-fold-index-and-while.1509/post-14132
- Author/handle: tomsk, 2020-01-17
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: Two fold loops sum up-bar and down-bar point changes over the last 8 candles and plot their ratio with labels.
- Constructs: declare lower, fold … with … do, GetValue, if-then-else inside fold, AbsValue, plot, AddLabel, Color.Yellow, [1] offset

## 19-consecutive-bars-above-ema-count.ts
- Title: count of consecutive bars with low above a moving average (scan)
- URL: https://usethinkscript.com/threads/scan-for-stocks-above-50-sma-for-the-last-x-days.1317/post-52036
- Author/handle: XeoNoX, 2021-02-08 (second code block of the post)
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: CompoundValue-driven counter of consecutive bars whose low is above the 21 EMA, exposed as a scan plot.
- Constructs: declare lower, def, plot, "is greater than" word operator, built-in study reference with named arg and quoted plot MovAvgExponential("length" = 21)."AvgExp", CompoundValue(1, …, 0), if-then-else, [1] offset

## 20-roc-stdev-lower-switch.ts
- Title: ROC StDev Lower
- URL: https://raw.githubusercontent.com/seriousbacktester/ThinkOrSwim_Indicator_Library/main/SB_ROC_StDev_Lower.thinkscript
- Author/repo: seriousbacktester — github.com/seriousbacktester/ThinkOrSwim_Indicator_Library, MIT
- Terms: MIT License
- Fetched: 2026-08-25
- What it does: Rate of change with a dynamic threshold at −k × its 200-bar standard deviation, plus a zero line.
- Constructs: declare lower, input enum with default, Assert, forward-declared def assigned in switch/case, RateOfChange(price=, length=), StDev(data=, length=), plot, SetDefaultColor, SetLineWeight, SetPaintingStrategy DASHES

## Bucket E — constructs a formula engine will likely refuse (4)

## 21-strategy-ma-crossover-addorder.ts
- Title: moving-average crossover strategy (reply in "Moving Average Crossover Strategy")
- URL: https://usethinkscript.com/threads/moving-average-crossover-strategy.1957/post-132679
- Author/handle: merryDay, 2023-10-13 (derived from the Mobius/BenTen crossover study earlier in the thread)
- Terms: usethinkscript.com Terms of Use
- Fetched: 2026-08-25
- What it does: 9/21 SMA cross with arrows, sound alerts, a cloud between the averages, and backtest orders on each cross.
- Constructs: input, plot, MovingAverage, AverageType.SIMPLE, crosses above/below, SetPaintingStrategy Arrow_UP/DOWN, SetLineWeight, SetDefaultColor, GetColor, Alert + Alert.Bar + Sound.Chimes/Bell, AddCloud, addOrder + OrderType.BUY_To_OPEN / SELL_TO_CLOSE

## 22-average-daily-range-zones.ts
- Title: Average Price Movements
- URL: https://usethinkscript.com/threads/gap-up-gap-down-scanner-for-thinkorswim.380/post-22333
- Author/handle: "Assembled by BenTen at useThinkScript.com", converted from a TradingView script (in-code header); posted by K_O_Trader, 2020-05-05
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: 10- and 5-day average daily range from a daily secondary aggregation, projected as bands around the day's open with clouds.
- Constructs: input aggregationPeriod = AggregationPeriod.DAY, open/high/low(period=) secondary aggregation, def names that shadow the built-ins open/high/low, [n] offsets, plot, addCloud, SetDefaultColor

## 23-previous-day-high-low-mean.ts
- Title: Previous Intradays High, Low, Mean
- URL: https://usethinkscript.com/threads/previous-day-high-and-low-breakout-indicator-for-thinkorswim.154/post-857
- Author/handle: Mobius (V01.12.2017, in-code header); posted by BenTen, 2019-05-11 (second code block of the post)
- Terms: usethinkscript.com Terms of Use — header intact
- Fetched: 2026-08-25
- What it does: Brackets the previous regular session by bar number using RegularTradingStart/End, finds its high/low/mean and extends them as dashed lines with vertical session markers.
- Constructs: barNumber, getTime, RegularTradingStart, RegularTradingEnd, GetYYYYMMDD, crosses above, isNaN, double.nan, addVerticalLine + curve.short_dash, HighestAll, between, future offset c[-1], recursive self-reference, Floor, Round, TickSize, plot, SetStyle Curve.Long_Dash, SetLineWeight, SetDefaultColor, HideTitle

## 24-position-capital-efficiency.ts
- Title: position-capital-efficiency (Invested Capital, Total Profit, Time-Adjusted Return)
- URL: https://raw.githubusercontent.com/ivelin/thinkorswim-apps/main/position-capital-efficiency.ts
- Author/repo: ivelin.eth (c) 2025 — github.com/ivelin/thinkorswim-apps, Apache-2.0 (stated in-file and in repo LICENSE)
- Terms: Apache License 2.0
- Fetched: 2026-08-25
- What it does: Reads the account's position (quantity, average price, open P/L), accumulates realized gains and active-bar capital, and shows a time-adjusted return as plots, a cloud and labels.
- Constructs: declare lower, input enum (colour list with default), GetQuantity, GetAveragePrice, GetOpenPL, IsNaN, BarNumber, recursive self-reference, if-then-else, Double.NaN, plot, hide(), Hide(), SetDefaultColor, SetPaintingStrategy LINE, SetLineWeight, AddCloud, AddLabel, Round, GetColor(enum)
