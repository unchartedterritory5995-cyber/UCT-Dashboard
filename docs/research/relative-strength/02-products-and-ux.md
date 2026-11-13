# Relative Strength knowledge base — 02. How the leading products present RS

Research date 2026-11-05. Everything below was read from the cited page unless marked **[unverified]**. Access failures: investors.com blocks crawlers (MarketSurge's help centre could not be read; IBD articles syndicated on Yahoo Finance and IBD's licensed MarketSmith India/HK sites were used instead); Koyfin's help page returned 503; Worden's forum refused connections; Stockopedia's calculation page returned 403.

Companion files: `01-methodologies.md`, `03-evidence.md`, `04-how-rs-is-taught.md`, `00-synthesis.md`.

---

## 1. Product-by-product findings

### 1.1 MarketSurge / MarketSmith (IBD)

- **Placement.** IBD's own copy: the RS line is "the squiggly blue line found under the stock's price bars", plotting the stock's performance "relative to the S&P 500" ([IBD via Yahoo, 2015](https://finance.yahoo.com/news/relative-strength-line-identify-emerging-210700981.html)). MarketSmith HK (licensed IBD affiliate) says the line is drawn in blue below price "with the latest RS Rating annotated" and that "users can select different benchmarks"; the RS line label shows both the rating and the benchmark code (e.g. "RS90", "000300") ([MarketSmith HK blog](https://www.marketsmith.hk/v2/blog/identifying-market-leaders-understanding-rs-line-and-rs-rating?lang=en), [HK idea list](https://www.marketsmith.hk/v2/blog/william-j-oneil-idea-listrs-line-breaks-to-new-highs?lang=en)). Exact US MarketSurge settings UI: **[unverified]**.
- **Blue dot rules.** MarketSmith India's Blue Dot page: the dot appears when the "Relative Strength line hits 52 weeks high" AND the stock either "builds a base pattern that signals a potential price jump" OR is "breaking out of the base". Event dates carry a "d" (daily) or "w" (weekly) suffix; a qualifying stock stays on the Blue Dot list for 90 days with a count of appearances; the list updates intraday every 15 minutes ([MarketSmith India](https://marketsmithindia.com/mstool/bluedot.jsp)). A TradingView clone author notes MarketSurge "shows only the last" dot, not history ([ChillLax script](https://www.tradingview.com/script/11Di8Fti-ChillLax-Relative-Strength-Line-with-NewHigh-NewLow-Blue-Dot)).
- **RS Rating.** 1–99 percentile of 12-month price performance vs all stocks in IBD's database; "a 99 rating, have outperformed 99% of all stocks tracked by IBD over the past 12 months"; "An RS rating of 90 or better means a stock is already outperforming 90% or more of the market"; historical average of the best winners before their runs was 87; "a high RS Rating doesn't guarantee a winning run; it alone is not a buy signal" ([IBD via Yahoo, 2012](https://finance.yahoo.com/news/relative-strength-rating-pinpoints-stocks-214500318.html)). The recent-quarter overweighting (40/20/20/20) is widely attributed to IBD but IBD's own pages were not readable — **[unverified from primary]**.
- **Weekly vs daily.** Blue dot evaluated on both chart types (d/w tags). HK copy: stocks "whose RS Line hit new highs before the breakout" are "even more promising" — new-high-before-price is in IBD's own teaching.
- **Screens.** MarketSmith has "RS Line New High" screens; the HK list criteria: "RS Line Hits a New High; Stock Price is Within 5% of the Weekly Breakout Price During Pattern Formation" or within four weeks after breakout.

### 1.2 Deepvue

- **RS line.** "DV Relative Strength Line": benchmark defaults to SPY, changeable to "another index (such as QQQ), any stock, or any ETF"; **two moving averages**, each any length, SMA or EMA, defaults **21 SMA and 50 SMA**; colours, icons, thickness editable; features individually toggleable; a **crossover icon** appears along the chart bottom when the RS line crosses its MA ([Deepvue blog](https://deepvue.com/?p=1703)). The docs say the line "will appear in the same pane as the stock's price initially" and recommend moving it to a pane via legend "⋯ → Move To"; Inputs = benchmark + MA prefs, Style = colours/icons ([Deepvue docs](https://docs.deepvue.com/articles/deepvue-custom-indicators-relative-strength-line)).
- **Dots.** "A green dot will appear on the RS line so you can easily tell when the RS line is making a new high"; a **pink dot** appears "when the RS line makes a new high before price". Lookback not published **[unverified]**.
- **RS Rating.** "a weighted rating that compares a stock's performance to that of all other stocks in Deepvue benchmarked to the S&P 500", 1–99, updated daily; **1M non-weighted, 3M equal-weighted, 6M and 12M weigh recent performance more** ([Deepvue docs](https://docs.deepvue.com/articles/performance-ratings)). Shown in the Data Panel and as screener columns per timeframe, not as a chart plot ([RS Rating page](https://deepvue.com/ratings/rs-rating/)). Thresholds in copy: 80+ baseline, 90+ "prior to significant upward trends".
- **Screener / alerts.** Preset screens "Relative Strength New Highs" over 1, 3 and 6 months; filters named RS Line New Highs Before Price, Relative Strength Days (RS on >60% of days), Up On Down Days, Highest Volume in a Year ([5 screens](https://deepvue.com/?p=6928), [screener](https://deepvue.com/screener/relative-strength-stock-screener/)). Alerts are price alerts on watchlisted results, not RS-event alerts. Also ships Mansfield RS, Webby RS Line (RS vs its 21-EMA) and RS Phases & Divergences (blue background = RS rising while SPY falls, red = RS falling while SPY rises) ([Mansfield](https://docs.deepvue.com/articles/deepvue-custom-indicators-mansfield-rs), [Webby](https://docs.deepvue.com/articles/deepvue-custom-indicators-webby-rs-line), [RS Phases](https://docs.deepvue.com/articles/rs-phases-and-divergences-indicator)).

### 1.3 TradingView

**Built-in Compare.** Three display modes: *Same % scale* ("the best option for comparing performance"; both lines start at 0% on the first visible bar and re-base as you scroll), *New price scale*, *New pane*. No ratio option; ratios use a spread symbol (e.g. NVDA/AMD) ([TradingView help](https://www.tradingview.com/support/solutions/43000543053-how-to-use-the-compare-tool/)).

**Generic indicator-settings UX (what members are pre-trained on).** Settings dialog has **Inputs / Style / Visibility** tabs; Visibility lets you choose intervals on which the indicator is displayed ([TV blog](https://www.tradingview.com/blog/en/customizable-indicator-visibility-25782/)); an "Intervals visibility" item in the legend ⋯ menu presets it ([TV help](https://www.tradingview.com/support/solutions/43000686263-how-to-quickly-adjust-visibility-of-a-drawing-or-indicator/)). A **Defaults** dropdown holds "Save as default" and "Reset settings" **[partially unverified]**. **Indicator templates** save a set of indicators with settings; applying one removes current indicators and loses drawings in indicator panes ([TV help](https://www.tradingview.com/support/solutions/43000692404-layouts-charts-drawings-indicators-and-their-interaction/)). "Add this indicator to the entire layout" exists in the context menu. Favourites via the star icon **[unverified in help centre]**.

**Top community scripts.**

- **ChillLax — "Relative Strength Line with NewHigh/NewLow Blue Dot"** (open source, ~2k likes). Default index **SPX**; lookback **50 bars** ("IBD's lookback period is 52 week, here it is default to 50 days, but it is changeable"). **Light blue dot** = RS new high; **bigger/darker blue dot** = RS new high *before* price new high; **orange** = RS new low; **red** = RS new low before price new low. Keeps all historical dots ([script](https://www.tradingview.com/script/11Di8Fti-ChillLax-Relative-Strength-Line-with-NewHigh-NewLow-Blue-Dot)).
- **Fred6724 — "RS Rating"** (open source, ~5.2k likes). "RS Score = 40% * P3 + 20% * P6 + 20% * P9 + 20% * P12"; percentile via `request.seed()` against ~6,600 US stocks; author claims ±3–5 points vs MarketSmith, "biggest deltas are in the 30-60 range". Inputs: comparative ticker (SPX), new-high/low lookback **250 bars** ("to match MarketSmith"), historical new highs on by default, optional new-low dots, optional **21 EMA** on RS line (10 SMA on weekly), second MA, fill between MA and RS, "rating only" mode "for smartphones", historical rating, label size/value. Caveats: "The rating score will only appear on the daily timeframe", "only available for the US market" ([script](https://www.tradingview.com/script/pziQwiT2/)). Derivative "RS Rating Multi-Timeframe" adds bands (90–99 Elite, 80–89 Excellent, 50–79 Average, 30–49 Below, 1–29 Weak), triangle markers at 80/30 crosses, info table, alerts ([script](https://www.tradingview.com/script/lsLzfQqs-RS-Rating-Multi-Timeframe)).
- **NNenov — "IBD Style Relative Strength Rating"** (protected). Default SPY; RS line colour mode Static/Dynamic (green rising, red falling); new highs = 250-day (orange), new lows (red); marker size Tiny/Small/Normal + opacity; table with prior day/week/month values; **alerts: RS New High, RS New Low, rating crosses above 85 / below 70** ([script](https://www.tradingview.com/script/bvUsKJ2E-IBD-Style-Relative-Strength-Rating/)).
- **stageanalysis — "Mansfield Relative Strength (Original Version)"** (open source, ~2.3k). Default S&P 500, MA length **52** (weekly); zero line = flattened 52-week MA of RS; "Original Style" toggles flattened vs unflattened; background green (positive), red (negative), separate **neutral** colour when RS and MA disagree in direction ([script](https://www.tradingview.com/script/NzUBDDtb-Mansfield-Relative-Strength-Original-Version-by-stageanalysis)).
- **RRG.** LuxAlgo "Relative Strength Scatter Plot": X = RS-Ratio, Y = RS-Momentum, inputs Calculation Window, symbols with show/colour, Benchmark, Trail Length, Resolution; quadrants green/yellow/blue/red ([script](https://www.tradingview.com/script/XZPlAujd-Relative-Strength-Scatter-Plot-LuxAlgo)).
- **"Relative Strength Comparative".** NeoButane's "Price Relative / Relative Strength Comparative" plots ratio OHLC as candles ([script](https://www.tradingview.com/script/XhZARPJC-Price-Relative-Relative-Strength-Comparative-NeoButane)).

### 1.4 StockCharts

- **Price Relative** ("Also known as the Relative Strength indicator or Relative Strength Comparative"). Ratio symbol `IBM:$SPX`; macros **`$SECTOR` / `$INDUSTRY`** resolve to the stock's sector/industry ETF ("IBM:$SECTOR" = "IBM:XLK"); `$SYMBOL:$SECTOR` follows the chart symbol; placement **above, below or behind** price ("Behind price makes divergences easier to spot"); example 150-day SMA on the ratio; caveat that levels aren't comparable across securities ([ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/price-relative-relative-strength)).
- **RRG Relative Strength lines** (JdK RS-Ratio "designed to define the trend in relative performance and measure the strength of that trend"; RS-Momentum "measures the momentum (rate-of-change) of RS-Ratio"); defaults Benchmark `$SPX`, Base `$SYMBOL`; needs ≥50 data points ([ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/rrg-relative-strength)). **RRG tool**: Period default **weekly**, Range 1 year, Tail Length slider, Arrow Mode, Animate, quadrant-coloured tails, ≤50 symbols ([Help](https://help.stockcharts.com/charts-and-tools/other-charting-tools/rrg-charts)).
- **SCTR**: rank 0–99.9 within universe; six inputs: 200-EMA distance 30%, 125-day ROC 30%, 50-EMA distance 15%, 20-day ROC 15%, PPO-hist slope 5%, RSI(14) 5%; "SCTR Line" indicator above/below/behind, `RAINBOW` background, `$SECTOR`/`$INDUSTRY` accepted; "crosses above 70" heuristic ([ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/stockcharts-technical-rank-sctr)).

### 1.5 TrendSpider, TC2000, Koyfin, thinkorswim

- **TrendSpider.** "Relative Strength": one input, Benchmark; composite chart (MSFT/SPY), ≥30-min timeframes; upper or lower pane ([KB](https://help.trendspider.com/kb/indicators/relative-strength)). Also **Dorsey RS** = close/index×100 and **Mansfield RS** = ((RSD/SMA(RSD,52))−1)×100 ([blog](https://trendspider.com/blog/new-indicators-added-dorsey-and-mansfield-relative-strength/)).
- **TC2000.** "Relative Strength" = ratio of the active symbol vs the selected symbol; four comparison options: Main Chart Symbol, Option Symbol, Symbol, Color group ([TC2000 help](https://help.tc2000.com/m/69404/l/747853-relative-strength)). Works as a WatchList column and EasyScan condition **[unverified]**.
- **Koyfin.** Relative charts via `A:B`; "relative strength" = price ratio vs "relative spread" = % difference **[unverified; page 503'd]**.
- **thinkorswim.** `RelativeStrength` study: one input `correlation with security`; plots `RS` and `SRatio` (initial level) ([Schwab](https://toslc.thinkorswim.com/center/reference/Tech-Indicators/studies-library/R-S/RelativeStrength)).

### 1.6 Finviz and Stockopedia

- **Finviz** has no RS-vs-benchmark column ([Finviz help](https://finviz.com/help/screener)).
- **Stockopedia** exposes **Relative Strength 1m/3m/6m/1y** as % vs the regional index: 100×(stock ratio / index ratio − 1) ([Stockopedia](https://www.stockopedia.com/learn/our-data/relative-strength-calculations-462863/)) **[partially unverified]**.

---

## 2. (a) Feature matrix

Y = documented; P = partial / workaround; N = not offered; ? = unverified. MS = MarketSurge, DV = Deepvue, TV-C = TradingView Compare, TV-S = best TradingView scripts, SC = StockCharts, TS = TrendSpider, TC = TC2000, KF = Koyfin, TOS = thinkorswim, FV = Finviz, SP = Stockopedia.

| Capability | MS | DV | TV-C | TV-S | SC | TS | TC | KF | TOS | FV | SP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RS line on price pane | Y (blue, under bars) | Y (default pane) | P (% overlay) | Y | Y ("behind price") | Y | Y | N | Y | N | N |
| RS line own scale/pane | ? | Y | Y | Y | Y | Y | Y | Y | Y | N | N |
| MA on RS line | ? | Y (21/50 SMA) | N | Y (21 EMA, 2nd MA) | Y | P (Mansfield) | ? | N | N | N | N |
| New-high dot | Y (52-wk, last only) | Y (green) | N | Y (50/250 bars, history) | N | N | N | N | N | N | N |
| New-high-before-price | P | Y (pink dot, filter) | N | Y (ChillLax dark dot) | N | N | N | N | N | N | N |
| Benchmark choice | Y | Y (any) | Y | Y | Y | Y | Y (4 modes) | Y | Y | — | N |
| Sector/industry benchmark macro | ? | P (manual) | N | N | **Y ($SECTOR/$INDUSTRY)** | P | N | N | N | — | N |
| Rating on chart | Y (label) | N (panel/column) | N | Y (label/table) | Y (SCTR line) | N | N | N | N | N | N |
| Rating components (1/3/6/12M) | N | **Y** | N | P | N | N | N | N | N | N | Y (%) |
| Rating history plot | N | N | N | Y (Fred6724) | Y (SCTR line) | N | N | N | N | N | N |
| Presets/templates | ? | Y (screens) | Y | Y | Y (ChartStyles) | Y | ? | ? | ? | — | Y |
| RS alerts | N | P (price alerts) | N | **Y (NNenov)** | N | ? | ? | N | N | N | N |
| RS scans/screens | Y | **Y** | N | P | P | ? | Y | N | P | N | Y |
| Mobile | Y | ? | Y | P ("rating only") | Y | Y | Y | Y | Y | Y | Y |

## 2. (b) Settings members actually change, ranked by how many products expose them

1. **Benchmark symbol** — every charting product. Default almost always S&P 500; StockCharts adds `$SECTOR`/`$INDUSTRY` macros.
2. **Pane placement** (overlay vs own pane; above/below/behind) — SC, DV, TV, TS, TC.
3. **Moving average(s) on the RS line** (length, SMA/EMA) — DV (21/50), Fred6724 (21 EMA / 10 SMA weekly + 2nd MA), SC, Mansfield (52).
4. **New-high/new-low lookback** — ChillLax 50, Fred6724/NNenov 250, IBD 52 weeks.
5. **Dot toggles and colours** (NH/NL on-off, history, size Tiny/Small/Normal, opacity) — ChillLax, Fred6724, NNenov, DV.
6. **Line colour mode** (static vs green-rising/red-falling) and thickness — NNenov, DV.
7. **Rating thresholds** for alerts/markers (85/70, 80/30) — NNenov, RS Rating MTF.
8. **Table/label position and size**, "rating only" mobile mode — Fred6724, NNenov.
9. **Interval visibility** (daily/weekly only) — TradingView Visibility tab.
10. **Save as default / reset / template** — TradingView; StockCharts ChartStyles.

## 2. (c) Ten UX lessons worth copying

1. **RS line under the price bars by default, in the price pane** (MarketSurge). StockCharts: "behind price makes divergences easier to spot".
2. **Annotate the line with the rating and the benchmark code** (MarketSmith HK: "RS90", "000300").
3. **Two dot intensities, not one** (ChillLax light vs dark; Deepvue green vs pink). Encode the stronger signal with the stronger mark.
4. **Keep dot history** (ChillLax, Fred6724) — MarketSurge's last-dot-only is the complaint that spawned the clones.
5. **Ship benchmark macros** (StockCharts `$SYMBOL:$SECTOR`).
6. **Expose rating components as columns, not chart clutter** (Deepvue 1M/3M/6M/12M).
7. **Name filters in plain English** — "RS Line New Highs Before Price", "Up On Down Days", "Relative Strength Days".
8. **Alerts on RS events with sensible default levels** (NNenov: NH, NL, above 85 / below 70).
9. **A "rating only" compact mode for phones** (Fred6724) and a table of prior day/week/month values (NNenov).
10. **State the method's limits in the description** (Fred6724: daily only, US only, ±3–5 vs IBD; ChartSchool: ratio levels not comparable across securities).

### Five UX mistakes to avoid

1. **Dropping the indicator into the price pane with no scale guidance** (Deepvue docs recommend a manual move).
2. **Un-explained AND/OR rule text** (MarketSmith India Blue Dot page).
3. **Showing only the latest dot** (MarketSurge).
4. **Inconsistent defaults across copy** (Deepvue 21 SMA vs 21 EMA; "benchmarked to the S&P 500" vs "against all other stocks").
5. **Destructive template application** (TradingView removes existing indicators and deletes pane drawings).

## 2. (d) Help/description copy to model

**IBD / MarketSurge:** "the squiggly blue line found under the stock's price bars… plots the stock's performance relative to the S&P 500." Investors like to see the RS line "at or near new highs to confirm the strength of the stock" on a breakout, and it is more bullish "when the RS line reaches a new high before the shares do." "a high RS Rating doesn't guarantee a winning run; it alone is not a buy signal."

**Deepvue:** "The Relative Strength Rating is simply a number within a range of 1 (the worst) to 99 (the best)." "A rating of 90 indicates that the stock is performing better than 90% of all other stocks." "Recent performance is given more weight than older performance to keep the rating current and relevant." "A green dot will appear on the RS line so you can easily tell when the RS line is making a new high." "When the RS line makes a new high before the stock price, it is an extremely bullish signal."

**ChillLax:** "this plots the RS line of the instrument vs an index (default index is SPX)… If the RS hits a New High over the past X bars (default is 50), it shows a Light Blue (user definable) Dot on the RS line, if RS hits New High before the instrument hits New High, it shows a bigger/darker Blue Dot."

**StockCharts:** "The Price Relative rises when a stock shows relative strength and outperforms its benchmark." "IBM:$SECTOR" equals "IBM:XLK".
