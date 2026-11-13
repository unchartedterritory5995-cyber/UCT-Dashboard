# Relative Strength knowledge base — 01. Methodologies and formulas

Research date 2026-11-05. Eleven methodology families, each with formula, defaults, timeframe, strengths, weaknesses and sources. Everything below was checked against a live page unless marked **[unverified]**. Several primary pages (investors.com, MarketSurge help, Dorsey Wright Zendesk, Zacks, ChartMill) block automated fetching; where that happened the report relies on search-engine excerpts or republished copies and says so.

---

## 1. IBD / William O'Neil RS Rating (1–99)

**What it is.** A percentile rank of each stock's trailing 12-month price change against every other stock in IBD's database, 99 = top 1%.

**Weighting.** IBD's formula is proprietary. The only published description (a 1999 Motley Fool column citing IBD): "The most recent three months is given a double weighting in a year comprised of four quarters… each of the first three quarters are weighted at 20% apiece and the most recent quarter is weighted at 40%." Third-party reconstructions implement this as

`Score = 0.40·ROC(63d) + 0.20·ROC(126d) + 0.20·ROC(189d) + 0.20·ROC(252d)` then rank the universe and map to 1–99 percentiles. MarketInOut and Deepvue both state their versions are approximations; one replica reports a typical ±3–5 point deviation from IBD.

**Thresholds.** IBD coverage says O'Neil's research found the average RS Rating of the best stocks just before their big runs was 87 (1950–2008) and that O'Neil rarely bought below 80 **[from search excerpts of IBD articles; pages 404/403'd]**. Common guidance: 80+ = top 20%, 90+ = top 10%.

**Short history.** No official rule found **[unverified]**. IBD publishes RS Ratings for IPOs with as little as two quarters of history (e.g., PACS Group rated 95 with "just two quarters"), so the rating is computed on available history; IBD advises waiting for a first base before buying IPOs.

**3-month RS Rating.** MarketSurge adds a 3-month RS Rating; investors.com shows only the 12-month version.

**RS line and Blue Dot.** RS line = stock price / S&P 500, drawn in blue. IBD rules: at the buy point of a proper base the RS line "should be making new highs"; an RS-line new high *before* the price new high is more bullish; the line need not be at an all-time high, only the highest level of the base; a falling RS line with price at highs is bearish divergence. The **Blue Dot** marks "stocks with bullish base and RS line combinations"; MarketSurge introduced an "RS Line Blue Dot" list in 2019. Exact lookback not published; replicas use 52 weeks / 250 bars **[unverified]**.

**Strengths.** Universe-relative, simple to explain, long record with CAN SLIM practitioners. **Weaknesses.** Backward-looking; pure 12-month price momentum (crash-prone, §7); proprietary universe makes it unreproducible exactly; percentile compresses tails.

Sources: [Fool 1999 quoting IBD](https://g.foolcdn.com/EveningNews/foth/1999/foth990204.htm) · [3-month RS Rating (IBD, republished)](https://inkl.com/news/how-to-invest-3-month-relative-strength-rating-reacts-faster-to-stock-moves) · [RS line / Blue Dot (IBD, republished)](https://inkl.com/news/how-this-simple-indicator-revealed-true-strength-in-amazon-stock) · [MarketSurge Blue Dot list](https://x.com/marketsurge/status/1120740631318495232) · [40/20/20/20 reconstruction](https://www.tradingview.com/script/lsLzfQqs-RS-Rating-Multi-Timeframe) · [MarketInOut disclaimer](https://www.marketinout.com/stock-screener/ibd-relative-strength-rating)

---

## 2. Mansfield Relative Strength (Stan Weinstein)

**Weinstein's definition** (book p. 18, quoted by stageanalysis.net): relative strength is "how a given stock (or group) acts in relation to the overall market"; "the price of a stock (or group average) divided by the price of a market average." A stock up 10% while the market is up 20% has "poor relative strength even though the stock has advanced."

**Mansfield formula** (Mansfield chart convention, documented by Stage Analysis):

```
RP  = (stock_close / index_close) × 100
MRS = ((RP / SMA(RP, n)) − 1) × 100        n = 52 weekly, 200 daily
```
The zero line is the flattened 52-week moving average of the ratio; above zero means the stock is outperforming its own one-year relative trend.

**How it is read.** Weekly is the native timeframe. Stage Analysis practitioners require RS "strengthening and above the Mansfield Zero Line" on a Stage 2A breakout; "the vast majority of Stage 2A breakouts occur when the relative performance is above the zero line or on the week it crosses it."

**Strengths.** Oscillator-style normalisation makes extremes comparable across stocks; weekly smoothing suits position trading. **Weaknesses.** 52-week SMA lags badly at turns; benchmark choice matters.

Sources: [Stage Analysis — formula & quotes](https://stageanalysis.net/blog/4266/how-to-create-the-mansfield-relative-performance-indicator) · [Stage Analysis forum — entry rules](https://www.stageanalysis.net/forum/Thread-Stan-Weinstein-s-Stage-Analysis-and-Market-Breadth-Technical-Analysis?pid=2620) · [Original-version script](https://it.tradingview.com/script/NzUBDDtb-Mansfield-Relative-Strength-Original-Version-by-stageanalysis)

---

## 3. Robert Levy (1967)

**Citation.** Levy, R. A., "Relative Strength as a Criterion for Investment Selection," *Journal of Finance* 22(4), 595–610, Dec 1967.

**Method.** Ratio = current week's close / trailing 26-week average price; stocks ranked weekly. 200 NYSE stocks, weekly closes, Oct 1960–Oct 1965.

**Findings.** Top 10% of historical strength rose 9.6% on average over the following 26 weeks versus 2.9% for the bottom 10%; no continuation at a 4-week horizon.

**Critique.** Jensen (1967) and Jensen & Bennington (1970) re-tested and found no profit over buy-and-hold net of costs **[detail unverified from the papers]**.

Sources: [Abstract repost](https://anacominfo.blogspot.com/2015/11/relative-strength-as-criterion-for.html) · [Jensen & Bennington record](https://www.econbiz.de/Record/random-walks-and-technical-theories-some-additional-evidence-jensen-michael/10003072016)

---

## 4. Andreas Clenow — "Stocks on the Move" (2015)

```
slope  = OLS slope of ln(close) over last 90 trading days
annual = (1 + slope)^250 − 1          (250 or 260; sources differ)
score  = annual × R²
```
**Why R².** It penalises erratic paths: a stock that gapped to its gain gets a low R². Clenow: "a stock price that makes large jumps may not move up much more because the news is already priced in."

**Rules.** Universe S&P 500; buy from top 20%; **disqualify any stock with a move >15% in the past 90 days**; sell when price < 100-day MA; new positions only when S&P 500 > 200-day MA; size `shares = equity × 0.001 / ATR(20)`; trade weekly.

**Strengths.** Volatility-aware ranking, explicit regime filter, risk-parity sizing. **Weaknesses.** Long-only momentum; R² penalises legitimate breakouts; the gap filter removes many true leaders early; backtest claims.

Sources: [quant-investing.com](https://quant-investing.com/blog/how-to-find-stocks-on-the-move-with-a-better-momentum-indicator-exponential-regression) · [QuantConnect implementation](https://www.quantconnect.com/forum/discussion/16578/quot-stocks-on-the-move-quot-momentum-strategy-by-cabedovestment/) · [Clenow's comment thread](https://www.followingthetrend.com/stocks-on-the-move/)

---

## 5. Dorsey Wright — Point & Figure RS and the RS Matrix

**Construction.** "We divide a security's price by the price of a benchmark, multiply that number by 100, and plot the resulting value as we would any point and figure chart." DWA's backtest used **6.5% boxes with a three-box reversal**, benchmark S&P 500.

**Signals.** RS buy = a column of X's rises above the prior column of X's; RS sell = a column of O's falls below the prior column of O's. Four states, strongest to weakest: **BX, BO, SX, SO**. RS signals "tend to last roughly 18 to 24 months on average."

**RS Matrix.** Every security charted against every other; ranked by count of RS charts on buy signals.

**Strengths.** Very low turnover, filters noise by construction. **Weaknesses.** Very slow to reverse, box size dominates, binary states only, vendor-only evidence.

Sources: [DWA "Why P&F RS?"](https://nasdaqdorseywright.zendesk.com/hc/en-us/articles/15870158671757-Why-Point-Figure-Relative-Strength) (excerpt) · [Mullooly — signal meaning](https://mullooly.net/what-does-the-signal-of-a-relative-strength-chart-tell-us/) · [DWA 2020 note](https://dorseywright.nasdaq.com/research/bigwire/2020/09/02/09-02-2020/weekly-relative-strength-changes)

---

## 6. Relative Rotation Graphs (Julius de Kempenaer)

**Components.** **JdK RS-Ratio** "is designed to define the trend in relative performance and measure the strength of that trend"; **JdK RS-Momentum** "measures the rate of change of the JdK RS-Ratio line." Both normalised around **100**. Normalisation formula proprietary.

**Quadrants** (x = RS-Ratio, y = RS-Momentum): Leading (+/+), Weakening (ratio >100, momentum <100), Lagging (−/−), Improving (ratio <100, momentum >100). Idealised rotation clockwise.

**Parameters.** ≥50 data points; 12-period tails typical; a relative trend is "three months on a weekly time frame… roughly three weeks" daily.

**Strengths.** Trend and momentum for a whole universe at once. **Weaknesses.** Not a trading system; RS-Momentum crosses 100 often; lags; black-box formula.

Sources: [ChartSchool — RRG Relative Strength](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/rrg-relative-strength) · [ChartSchool — RRG Charts](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-types/relative-rotation-graphs-rrg-charts) · [de Kempenaer on 105](https://articles.stockcharts.com/article/articles-rrg-2015-12-what-does-a-stock-with-an-rs-momentum-value-of-105-equate-to-in-respect-of-time/)

---

## 7. Academic momentum

**Jegadeesh & Titman (1993)**, *JoF* 48(1): buying past winners and selling past losers over 3–12-month windows "generate significant positive returns over three- to twelve-month holding periods"; the 6-month formation produces "about 1% per month"; part of the abnormal return dissipates in the following two years. Standard definition today is **12-1** (months t-12…t-2, skip the most recent month).

**Carhart (1997)** one-year momentum factor: mean monthly premium 0.82% (t = 4.46). Fama-French **Mom (UMD)** built from six size × prior(2-12) portfolios, monthly, one-month skip.

**Daniel & Moskowitz, "Momentum Crashes"**, *JFE* 2016: worst months Jul–Aug 1932 (loser decile +236%, winners +6.5%) and Mar–May 2009 (losers +163%, winners +8%). Crashes occur in "panic" states after market declines with high volatility, on sharp rebounds; 14 of the 15 worst followed a negative two-year market return; the loser portfolio's beta "can jump up to 4.0 or 5.0." Scaling exposure by forecast mean/variance "approximately doubles the alpha and Sharpe ratio."

**Asness, Frazzini, Israel & Moskowitz, "Fact, Fiction and Momentum Investing"** (2014): 1991–2013 gross premiums — momentum 6.3%/yr (Sharpe 0.36), value 3.6% (0.32), size 3.3% (0.29); long side at least as profitable as short; turnover 5–6× value yet "easily survives trading costs"; momentum "may experience deeper crashes (during dramatic market advances)," mitigated by ~60/40 value/momentum blends.

**Documented weaknesses.** Negative skew and crash risk; beta sensitivity (2009 losses beta-driven; residual momentum suffered less); reversal in years 2–3.

Sources: [JT 1993](https://ideas.repec.org/a/bla/jfinan/v48y1993i1p65-91.html) · [French data library — Mom](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_mom_factor.html) · [Momentum Crashes (NBER w20439)](https://www.nber.org/papers/w20439) · [AAII summary](https://www.aaii.com/journal/article/why-momentum-strategies-can-crash) · [AQR PDF](https://www.aqr.com/-/media/AQR/Documents/Journal-Articles/JPM-Fact-Fiction-and-Momentum-Investing.pdf)

---

## 8. Mark Minervini Trend Template; Morales & Kacher

**Trend Template** (2013), eight criteria: (1) price > 150- and 200-day MA; (2) 150 > 200; (3) 200-day rising ≥1 month, preferably 4–5; (4) 50 > 150 > 200; (5) price > 50-day; (6) price ≥30% above 52-week low; (7) within 25% of 52-week high; (8) **"The relative strength ranking (as reported in Investor's Business Daily) is no less than 70, and preferably in the 80s or 90s."** The template is a Stage-2 gate, not a buy signal. Minervini's specific RS-*line* rules were not found on a verifiable page **[unverified]**.

**Morales & Kacher** (2010): the **pocket pivot** — an up-close day whose volume exceeds the largest down-day volume of the prior 10 sessions, near the 10-day MA. No numeric RS threshold of theirs found **[unverified]**.

Sources: [ActionAlerts — criteria](https://actionalerts.substack.com/p/using-mark-minervinis-trend-template) · [Pocket pivot](https://therighttrader.com/learn/volume-and-order-flow/pocket-pivot)

---

## 9. Volatility-, beta- and alpha-adjusted RS; "RS momentum"

**ATR-normalised RS (VARS, OANDA).**
```
ShareChg_t = (C_t − C_{t−1}) / ATR_t ;  IndexChg_t = (I_t − I_{t−1}) / ATR_t(index)
VARS = Σ_lookback ShareChg − Σ_lookback IndexChg
```
ATR 14 or 20; 60-day lookback and 50-day SMA of VARS in case studies. Four states: >0 & >MA strong and gaining; >0 & <MA strong but fading; <0 & <MA weak; <0 & >MA weak but improving. Rationale: "high-volatility shares often appear strong but are prone to sharp reversals."

**R²-adjusted (Clenow)** and **volatility-scaled momentum (Daniel & Moskowitz)** are the two best-documented adjustments. **Residual momentum** (after removing market/factor exposure) was less exposed to the 2009 reversal.

**RS momentum.** Rate of change of the RS line: JdK RS-Momentum is the canonical form; IBD's "RS new high before price" and the slope of Mansfield's zero line are discrete versions.

Sources: [OANDA VARS](https://www.oanda.com/sg-en/skills-and-insights/education/trading-asset-classes/shares/volatility-adjusted-relative-strength-share-cfd/) · [TradingView RS (Volatility Adjusted)](https://www.tradingview.com/script/8J4qsKuC-Relative-Strength-Volatility-Adjusted/) · [Residual momentum / 2009](https://www.cxoadvisory.com/?p=25426)

---

## 10. StockCharts SCTR (model of a composite rank)

Six weighted inputs: **Long-term (60%)** — % above/below 200-day EMA (30%), 125-day ROC (30%); **Medium (30%)** — % above/below 50-day EMA (15%), 20-day ROC (15%); **Short (10%)** — 3-day slope of PPO histogram (5%), RSI(14) (5%). Ranked *within a universe* (Large >$10B, Mid $2–10B, Small $250M–2B, non-leveraged ETFs) into 0.0–99.9. Guidance: 40–60 average, >60 strength, <40 weakness; "buy when the SCTR score crosses above 70."

Source: [ChartSchool — SCTR](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/stockcharts-technical-rank-sctr)

---

## 11. Other widely used variants

- **Stockopedia RS (1m/3m/6m/1y):** `(1 + r_stock)/(1 + r_index) − 1`; they note 3–12-month RS >0 predicts continuation while 1-month is less reliable.
- **Deepvue RS Rating:** weighted 12/6/3/1-month performance, recent weighted more, 1–99 vs all stocks; "not the proprietary ratings of MarketSurge or IBD." Weights unpublished.
- **Zacks Momentum Style Score:** A–F from inputs including one-week price change and monthly estimate revisions **[excerpts]**.
- **TC2000, Fidelity, thinkorswim "Relative Strength Comparison":** price ÷ base-security price, no proprietary rank.
- **Finviz:** no RS-vs-S&P-500 filter.

---

## Comparison table

| Method | Formula sketch | Lookback / timeframe | Output | Best use |
|---|---|---|---|---|
| IBD RS Rating | 40/20/20/20-weighted 12-mo ROC, percentile across universe | 252d; daily | 1–99 | Screening leaders (≥80/90) |
| IBD RS line + Blue Dot | Price / S&P 500; dot when line at new high | ~52-wk (unofficial); daily/weekly | line + event | Breakout confirmation |
| Mansfield RS | ((P/I)/SMA52(P/I) − 1)×100 | 52 wk (200 d); weekly | oscillator around 0 | Stage-2 entries, weekly |
| Levy ratio | P / avg(P, 26 wk), ranked | 26 wk; weekly | rank | Historical baseline |
| Clenow | (1+slope_ln)^250−1 × R², filters | 90 d; daily | annualised % | Systematic ranking |
| Dorsey Wright P&F RS | (P/I)×100 on 6.5%×3 P&F; BX/BO/SX/SO | time-free; multi-year | 4 states | Low-turnover allocation |
| RRG (JdK) | normalised RS-Ratio & RS-Momentum ≈100 | ≥50 bars; weekly or daily | two series, quadrant | Rotation across a universe |
| Academic 12-1 | r(t-12..t-2), decile long-short | 11 mo skip 1; monthly | return spread | Factor research, crash awareness |
| Minervini TT | 8 trend filters incl. IBD RS ≥70 | 50/150/200d, 52-wk; daily | pass/fail | Stage-2 gate |
| ATR-adjusted RS | Σ(ΔP/ATR) − Σ(ΔI/ATR) | 60 d, ATR 14/20; daily | signed score vs MA | Vol-neutral comparison |
| SCTR | 6 weighted trend inputs, ranked in peer group | 200/125/50/20d; daily | 0–99.9 | Composite technical rank |
| Stockopedia RS | (1+r_s)/(1+r_i) − 1 | 1m–1y; daily | % | Simple screen column |

## Design implications for a multi-mode RS indicator

1. **Separate the three primitives** every method combines: a *ratio line* (price/benchmark), a *trend-of-ratio* measure (SMA-52 for Mansfield, regression slope for Clenow, JdK RS-Ratio, P&F signal), and a *momentum-of-ratio* measure (JdK RS-Momentum, RS-line new high, zero-line slope). Modes become parameter presets over these.
2. **Offer both ranked and absolute outputs.** IBD/SCTR/Deepvue are universe percentiles (need a documented universe); Mansfield/VARS/RRG are per-symbol. Publish the universe and rank date.
3. **Default lookbacks cluster at 3, 6 and 12 months** (63/126/189/252 days; 26 and 52 weeks; 90 days for Clenow). Expose quarter weighting and the academic 1-month skip as options.
4. **Build in a volatility/quality adjustment switch**: R², ATR normalisation, or return/σ. Document that it dampens true breakouts.
5. **Crash awareness is the biggest documented weakness** (1932, 2009). Pair any momentum mode with a market-regime filter and warn when the benchmark is far below its highs with high volatility.
6. **Make the benchmark selectable** and show it on the output; results are benchmark- and beta-sensitive.
7. **Weekly vs daily must be explicit**: Mansfield and RRG are weekly-first; IBD/SCTR/Clenow daily. Offer timeframe-appropriate defaults.
8. **Events, not just values**: RS-line new high, zero-line cross, RS-Momentum cross of 100, P&F BX flip. Time-stamp and persist them.
9. **Handle short histories explicitly**: compute on available data but flag the shortfall.
10. **Avoid proprietary mimicry claims**: label IBD-, RRG- and DWA-style modes as "inspired by" with the known deviation (replicas report ±3–5 points vs IBD).
