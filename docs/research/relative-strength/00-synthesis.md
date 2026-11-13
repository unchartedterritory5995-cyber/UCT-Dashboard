# Relative Strength knowledge base — 00. Synthesis: what the field knows, and what UCT should build

Research date 2026-11-05. This file distils the four reports beside it (`01-methodologies`, `02-products-and-ux`, `03-evidence`, `04-how-rs-is-taught`) into the decisions that shape the UCT Relative Strength indicator. Read this first; go to the numbered files for formulas, quotes and sources.

---

## 1. What relative strength is, in one paragraph

Relative strength is one division done every day: the stock's price over a benchmark's price, drawn as a line. Every method in the field is a different way of reading that line. O'Neil reads its new highs and ranks the whole universe on a 12-month weighted return (the 1–99 RS Rating). Weinstein measures the ratio against its own 52-week average so it swings around zero (Mansfield RS). De Kempenaer normalises the ratio's trend and the trend's momentum around 100 and plots every stock in a universe on one rotation graph (RRG). Clenow ranks on the regression slope of log price times R², so steady climbers beat gappers. Dorsey Wright plots the ratio on a point-and-figure grid and keeps only the buy/sell signal. Academics call the same thing momentum, measure it as the 12-month return skipping the last month, and have forty years of evidence that it persists and a well-documented way it crashes. The practitioners members follow (IBD, Minervini, TraderLion, Deepvue, Kell, Qullamaggie, and UCT's own Chartmaster and Manrav) all trade one or two of these readings, mostly O'Neil's RS line and rating plus a moving-average "phase" on the line and the down-day stress test.

## 2. The twelve things the research settles

1. **Three primitives cover every method.** A *ratio line*, a *trend-of-ratio* measure (52-week SMA, 21 EMA, regression slope, JdK RS-Ratio, P&F column) and a *momentum-of-ratio* measure (new highs, zero-line cross, JdK RS-Momentum). An indicator that computes the three primitives and exposes methods as presets over them can offer the whole field without seven indicators. (01 §Design implications)
2. **The evidence is for 6–12-month persistence, not for the blue dot.** Momentum earned about 8.3%/yr long-short 1927–2013 (Sharpe 0.50), positive in 81% of rolling years; DWA's point-in-time RS buy signals returned 13.9%/yr vs 9.3% for the S&P over 1990–2015. No study anywhere publishes a hit rate or forward return for "RS new high before price". The one measured study (Bulkowski, 15,763 patterns) finds RS direction *before* a breakout barely matters and RS rising *after* it matters a lot (+41% vs +22%). (03 §2–4)
3. **Momentum crashes are the signature failure.** All 15 worst months since 1927 came after a negative two-year market return, during rebounds (1932, 2001, 2009). Volatility scaling roughly doubles the Sharpe. Every RS surface we ship needs a regime context beside the signal. (03 §2, §6)
4. **The benchmark changes the answer.** In 2023–24, 78% of S&P 500 stocks lagged the cap-weighted index because seven names carried it; Dorsey Wright benchmarks to the equal-weight S&P for exactly this reason; StockCharts resolves `$SECTOR` and `$INDUSTRY` automatically. The equal-weight and sector benchmarks are not Pro extras, they are first-class. (03 §5; 02 §1.4)
5. **IBD's rating is not reproducible exactly, and nobody claims it is.** The 40/20/20/20 quarter weighting comes from a 1999 column; replicas report ±3–5 points vs MarketSurge, worst in the 30–60 band. Deepvue and MarketInOut both label theirs approximations. We label ours "IBD-style" and publish the deviation. (01 §1; 02 §1.3)
6. **Thresholds are heuristics.** IBD itself says 80, 85 and 90 in different articles, warns that stocks from long bases break out at RS 50–70, and calls the famous "87 average" a figure with no published sample. Minervini's template says 70, "preferably 80s or 90s"; his own trades started at 89+ 90% of the time. We show bands, not a verdict. (03 §1; 04 §3)
7. **Members are pre-trained on three conventions.** The RS line drawn under price in the price pane (IBD), a settings dialog with Inputs / Style / Visibility tabs (TradingView), and two dot intensities for "RS new high" vs "RS new high before price" (ChillLax, Deepvue). Copy them; innovate on explanation, not on chrome. (02 §2c)
8. **The ten settings members actually change** are, in order: benchmark, pane placement, moving average on the line, new-high lookback, dot toggles and colours, line colour mode (static vs rising-green/falling-red), rating thresholds, label position and a "rating only" phone mode, interval visibility, save-as-default. Our Simple mode is the first three plus the dot toggles; everything else is Advanced. (02 §2b)
9. **Dot history matters.** MarketSurge shows only the latest blue dot; the most-liked TradingView clones exist because members wanted the history. Keep every dot, thin them on long charts. (02 §2c)
10. **Templates must not destroy.** TradingView's indicator templates remove existing indicators and silently delete pane drawings. UCT's existing indicator templates are additive by design; the RS presets ride them. (02 §2c; engine `indicatorTemplates.js`)
11. **The RS-vs-RSI confusion is the first thing to defuse.** Every educator leads with it. One tooltip line does the job: "RSI compares a stock to its own recent history; RS compares it to the market." (04 §6)
12. **The best explanations are questions and pictures.** "Is this stock beating the market, or just riding it?" and the beach ball held under water appear across IBD, TraderLion, JC Parets and UCT's own workshops. The three-level explanation (10 / 30 / 100 words) in 04 §b is the help copy. (04 §a–d)

## 3. What this means for the UCT indicator

### 3.1 One indicator, seven ways to read it
Presets, each a named set of inputs over the same three primitives, each with a one-line origin and a one-line caveat:

| Preset | Reads | Origin | Default when |
|---|---|---|---|
| **Classic** | RS line vs benchmark, 52-week new-high dots (two intensities), IBD-style rating label | O'Neil / IBD, MarketSurge | Daily, the default |
| **Phase** | RS line coloured above/below its 21 EMA, cross arrows | Manrav's lesson, TraderLion RS Phase, Deepvue Webby | Members from the curriculum |
| **Trend** | Mansfield oscillator around zero, green/red/neutral shading | Weinstein | Weekly charts |
| **Rotation** | RS-Ratio and RS-Momentum around 100, quadrant label, mini-RRG for the watchlist | de Kempenaer (our own published normalisation, "inspired by") | Sector and theme work |
| **Quality** | Regression slope × R², annualised, gap flag | Clenow | Systematic members |
| **Volatility-adjusted** | ATR-normalised RS vs its 50 MA, four states | OANDA VARS, Daniel–Moskowitz | High-beta names |
| **Stress test** | RS new highs on red market days, green-on-red count, pivot speed | UCT workshops (Chartmaster, Kell, TraderLion "down days") | Correction regimes |

### 3.2 Honesty is a feature
Every marker and number carries three lines: what it is, where the idea comes from, and what the evidence says, including "no published evidence" where that is the truth. From launch the evidence lines are the defensible general statements in 03 §b. From Phase 2 they are our own nightly backtest numbers with sample size and dates (03 §c). Nobody in the field does this; it is the most credible "beyond MarketSurge" we can ship, and it fits a brand that calls itself operator-grade.

### 3.3 Benchmarks
SPY default; **Equal-weight S&P (RSP)** and **Sector (auto)** on the Simple menu; QQQ, IWM, **Industry (auto)**, Custom in the list. The legend always prints the resolved benchmark. A small "benchmark sensitivity" note appears when the stock's RS is falling vs SPY and rising vs RSP (the 2023–24 case).

### 3.4 Regime beside the signal
A regime chip (benchmark vs its 200-day, trailing two-year return sign, realised volatility tercile) sits in the readout. When the Daniel–Moskowitz panic state is on, the indicator says so in one line: "Leadership reverses hardest in rebounds after bear markets (2003, 2009)."

### 3.5 Customization that respects members' time
Simple mode (benchmark, placement, MA, three dot toggles) and Advanced (everything in 02 §2b plus method-specific inputs), using the engine's existing `group`, `tooltip` and `activeWhen` input fields. Style tab for every colour, width, dot size (Tiny / Small / Normal), line colour mode, label position. Visibility tab for per-interval display. Presets apply as additive indicator templates and can be saved as the member's own and re-shared. A "Rating only" compact mode for phones. Nothing destructive, nothing hidden.

### 3.6 Where Chartmaster and Manrav fit
As two of the seven presets (Phase, Stress test), as the voice of the UCT-specific tooltips, and as a validation fixture (his dated Discord posts). Not as the frame. The frame is the field.

## 4. What we still do not know (and how we find out)
- The forward return of every marker on our universe: the nightly backtest (03 §c), Phase 2.
- How much RS rankings reorder across benchmarks: nightly rank correlations, same job.
- Whether the "RS new high before price" convention adds anything over plain RS new highs: same job; publish either answer.
- MarketSurge's exact lookback and whether the US product shows dot history: owner screenshots in the parity set.
- IBD's handling of short-history stocks: unverified; we compute on available data and flag it.
