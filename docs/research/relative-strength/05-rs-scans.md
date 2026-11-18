# Relative Strength knowledge base — 05. RS scans and screens: what the field publishes, what the evidence supports, how products present them

Research date 2026-11-13. **Verification key.** [V] = read in the primary source (the author's or vendor's own page, a paper or its abstract page, a help doc; verbatim republications such as IBD articles on Yahoo or X threads on Thread Reader count). [S] = secondary source only, or a search snippet of a page that did not open. [U] = widely repeated, could not verify. Everything not marked [V] must be re-checked before it goes member-facing.

Files 00 to 04 of this knowledge base (synthesis, methodologies, products and UX, evidence, how RS is taught) live on branch `docs/uct-rs-indicator` under `docs/research/relative-strength/`.
This file adds the scan-specific research: Part A practitioner screens, Part B evidence on conditions, Part C product UX, Part D one day of live readings from our own Screener.

"(snippet)" means the vendor page blocked direct fetch and its text was seen only as quoted by the search engine.

---

# Part A. Practitioner screens: published criteria

Most numeric criteria that could be verified come from Stockbee, Qullamaggie, Jeff Sun and Deepvue's Leaders presets. IBD's list filters and Deepvue's RS preset settings are not published in readable form, and the Minervini books could not be opened.

**Access limits.** Pages were read through a fetch tool that extracts text, so re-check quotes before printing them as verbatim. investors.com, inkl.com (IBD syndication), traderlion.com, chartmill.com and usethinkscript.com refused the fetch. Deepvue's share links (`app.deepvue.com/share-item/...`) render only in the app, so their filter values could not be read.

## A1. Minervini Trend Template

Neither book could be opened, so every line here is [S]. Rules 1 to 7 are as transcribed at https://www.prorealcode.com/prorealtime-market-screeners/trend-template-mark-minervini/ [S]:

1. "The current stock price is above both the 150-day (30-week) and the 200-day (40-week) moving average price lines."
2. "The 150-day moving average is above the 200-day moving average."
3. "The 200-day moving average line is trending up for at least 1 month (preferably 4–5 months minimum in most cases)."
4. "The 50-day (10-week) moving average is above both the 150-day and 200-day moving averages."
5. "The current stock price is trading above the 50-day moving average."
6. "The current stock price is at least 30 percent above its 52-week low."
7. "The current stock price is within at least 25 percent of its 52-week high (the closer to a new high the better)."
8. The RS ranking (as reported in Investor's Business Daily) "is no less than 70, and preferably in the 80s or 90s, which will generally be the case with the better selections." Search snippet of a forum transcription at https://scan.stockcharts.com/discussion/comment/3971 [S]; the page itself did not load.

- **Version conflict:** rule 6 is 25% in "Think & Trade Like a Champion" and 30% in the earlier book, per https://www.mql5.com/en/articles/22790 [S]. Many implementations use 25%.
- **Deepvue's own article misstates the template:** it swaps in "accumulation" and "leading sector" for two rules. Do not use it as the reference. https://deepvue.com/screener/minervini-trend-template/ [V for Deepvue, wrong on Minervini]
- **Practitioner coding of rule 3:** Bonde codes it `avgc200>avgc200.25`, "the 200 day average is rising for last 25 days". https://stockbee.blogspot.com/2018/11/how-to-setup-minervini-trend-template.html [V, his comment reply; post body did not load]
- **His MarketSmith variants:** three templates (5-month, 5-month wide, 1-month). The wide one drops RS > 70 and the above-50-day rule, allowing roughly 8 to 10% below the 50-day. Result counts were 862 names (5-month) against 8 (1-month); 95 to 98% of his trades meet the 5-month version. From an AI summary of the 2021 IBD Live session, so low confidence. https://readray.ai/en/notes/notebooklm-20251211/minervini-screens-hot-stocks [S]

## A2. IBD / MarketSurge / William O'Neil

- **RS Line Blue Dot (MarketSurge):** finds charts whose RS line reached a 52-week high, and the stock "must also be building a base or breaking out of a base and hitting a proper buy point to trigger the blue dot". No rating, price or volume floor found. https://www.inkl.com/news/marketsurge-blue-dot-pattern-recognition-among-its-cool-tools [S, snippet]
- **Growth 250:** "leading stocks selected from 30 other screens"; it is the base universe for Near Pivot. Same URL [S, snippet].
- **"Relative Strength At New High" (IBD stock list):** it exists under Stock Lists and qualifies on an RS line 52-week high. Its filters (RS Rating, price, volume) and sort are NOT published anywhere that could be reached. https://www.inkl.com/news/use-relative-strength-to-find-breakout-stocks-and-watchlist-candidates [S, snippet]
- **"Stocks With Rising Relative Strength" column:** the trigger is a stock's RS Rating crossing 80. "History reveals that the best-performing stocks often have an 80 or higher RS Rating in the early stages of their moves." https://www.nasdaq.com/articles/stocks-rising-relative-price-strength-dollar-tree-2017-10-05 [S, snippet]
- **RS Rating guidance, IBD's own words:**
  - "look for stock with at least an 85 RS"; the average before big runs is 87; after long bases expect it "even down in the 50s to 70s". https://finance.yahoo.com/news/good-relative-price-strength-precedes-224100448.html [V]
  - "from 1950 through 2008, the average RS Rating of the best-performing stocks just prior to their winning runs was 87"; ideal is "a high RS Rating (say, 90 or better)" built "while basing". https://finance.yahoo.com/news/relative-strength-rating-pinpoints-stocks-214500318.html [V]
- **Industry groups:** "IBD has divvied up publicly traded companies into 197 different groups", ranked on six-month relative price performance. "IBD has long advised looking at the top 20 industries, or maybe the top 40"; avoid the bottom 20. https://finance.yahoo.com/news/industry-group-rankings-help-pick-204300919.html [V]
- **Only IBD screen found with full criteria ("perfect stocks"):** industry group rank 1 to 20, Composite 99, EPS Rating 80+, RS Rating 80+, SMR A or B, price $12+. https://www.inkl.com/news/coinbase-and-5-other-newer-ipos-lead-21-perfect-stocks [S, snippet]
- **IBD Big Cap 20:** built from "profit growth, IBD Composite Rating and relative price strength over the last 12 months"; IBD looks for ATR of 5% or less. https://www.inkl.com/news/looking-for-less-volatile-winning-growth-stocks-look-to-the-ibd-big-cap-20 [S, snippet]
- **Composite Rating:** "IBD does not publish the exact formula or weightings". https://www.capforceetf.com/insights/leadership-in-one-number-making-sense-of-ibd-composite-rankings [S]
- **Not found:** exact rules for IBD 50 ranking, Sector Leaders ("most stringent" is all that is public), Stock Spotlight, Rising Profit Estimates, and any MarketSurge "Bases Forming" screen. No published Sector Leaders rule set was found, so treat any seen elsewhere as [U].

## A3. Deepvue and TraderLion

**RS Rating and AS Rating** (https://docs.deepvue.com/articles/performance-ratings [V]):
- "Deepvue offers RS Ratings for 1, 3, 6, or 12-month timeframes." No 1-week RS Rating is documented.
- "RS Rating 1-month is non-weighed, 3-month is equal weighted", and 6 and 12-month "weigh more recent price performance more heavily".
- The AS (Absolute Strength) Rating covers the same four windows with "equal weight to each time period".

**Group ranks:** scored from the AS scores of stocks "that meet price and liquidity thresholds", over 1 day, 1 week and 1/3/6/9/12 months. The threshold values are not published. https://docs.deepvue.com/categories/data-points-and-ratings [V]. A search snippet says industries rank 1 to 75 [S].

**RS presets** (names verified, filter values not readable):
- "Relative Strength New Highs over 1 month, 3 months and 6 months", plus "Ben Bennett's Down Day RS" and Oliver Kell's screen. https://deepvue.com/screener/stock-screener-by-indicator/relative-strength-stock-screener/ [V]
- RS Line at New Highs, with lookback "1, 3, 6, 9, or 12 months".
- RS Line New High Before Price, "ranging from 1 to 12 months".
- RS Days over 60%.
- Up on Down Days; the distribution-day variant is "high DCR and … less than 1% down".
- Gap-up with daily closing range (DCR) "over 45%".
- All four from https://deepvue.com/screener/screeners-for-stock-market-corrections/ [V]

**RS Days:** "When the close of on RS Candlestick is higher than the previous day's close, we count that as one RS Day"; "Stocks with >60% RS days during a correction are potential new leaders". Counted from the start of the correction, with no fixed lookback. https://deepvue.com/indicators/relative-strength-days/ [V]

**RS Phase:** RS line above its 21-day EMA; "when the RS Line drops below its 21-day EMA and the RS Phase ends, it's time to get defensive". https://deepvue.com/indicators/relative-strength-stocks/ [V]

**Presets with published numbers** (https://deepvue.com/screener/find-leading-stocks-quickly/ [V]):
- **Deepvue Leaders:** price over $12.50, market cap over $1B, average dollar volume $20M, ADR 2%. Then OR-groups: 1-week/1-month/3-month performance, fundamentals or AS Rating over 93, and long uptrend, young IPO or AS over 95.
- **Liquid Leaders:** price over $20, average dollar volume over $100M, and 3-month AS over 87 or 1-month AS over 93.
- **Stage Analysis Leaders:** top 25 industry ranks on 3 or 6 months.

**Kell base criteria (per Deepvue):** price above $20, average volume over 500,000, market cap $2B to $25B, EPS and sales growth over 30%. https://deepvue.com/screener/oliver-kell-screens/ [S for Kell]

**TraderLion, "How To Find Market Leaders During Corrections" (2021):**
- "If the RS line is increasing when the market is declining and pulling back, the stock is showing clear relative strength."
- Start the RS list from stocks with an inside week and a strong weekly close; refresh daily; repeat appearances matter most.
- The list becomes the buy list once an uptrend is confirmed.
- https://threadreaderapp.com/thread/1444352482419871751.html [V]

**TraderLion, "next Market Leaders" thread:** RS line new high before price is "a key Leadership Blueprint"; base depth under 40%; "A weekly closing range of > 40% during a corrective period is an indication of institutional support." https://threadreaderapp.com/thread/1397997544526041088.html [V]

**Not found:** numeric screens from Richard Moglen or Nick Schmidt, a TraderLion Power Trend screen, and Launch Pad criteria.

## A4. Qullamaggie, Stockbee, Jeff Sun and others

**Qullamaggie**
- "Scan for the 1 or 2% of stocks that are up the most over these 3 timeframes" (1, 3 and 6 months); run "Weekly". https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ [V]
- Stream transcript (auto-generated), https://sozai.app/transcript/qullamaggie-swing-trading-school/ [S]:
  - Gains are measured from the low of the past 22, 67 and 126 trading days.
  - Rank "top 7%", later "90 plus 95% plus".
  - ADR: "most of you you should put it at 5 6%".
  - Dollar volume slid from $80M down to $5M in the demo, or "20 times 30 times your account size".
  - Wants "like 50 results"; more than 50 means "tighten the criteria". No price floor stated.

**Stockbee**
- 2009 scan: `C / AVGC126` (six-month) and `C / AVGC42` (two-month), "Rank >97", "Common Stocks", "Price per share>3", `MINV3.1 > 1000`. A commenter reads the volume rule as 100,000 shares, which matches Telechart's hundreds-of-shares units. https://stockbee.blogspot.com/2009/09/how-to-find-stocks-with-momentum.html [V]
- Ranking columns: `c/c21`, `c/c10`, `c/c5`, `c/c252`, `c/avgc126` (MDT), `avgc7/avgc65` (TI65), `c/minl252` (DT). Absolute signals: TI65 `>=1.05`, MDT `>=1.19`, DT `>=1.80`. https://stockbee.blogspot.com/2018/08/momentum-scans-to-make-money.html [V]
- Young TI65: `avgc7/avgc65>=1.05and AVGC7.25 / AVGC65.25 <= 1.05`. https://stockbee.blogspot.com/2018/03/how-to-setup-trend-intensity-scans-and.html [V]
- 4% breakout: `c/c1>=1.04 and v>v1 and v>=100000`, with "Stock should not be up 3 days in a row prior to breakout day". https://stockbee.blogspot.com/2015/11/how-to-use-4-breakout-scan-to-make-money.html [V]

**Jeff Sun**
- Strong-mover scans as Finviz URL codes. Base: `cap_smallover`, `sh_avgvol_o300`, `sh_curvol_o100`. Pairs: 1-week >20% with weekly volatility >4%; 1-month >30% or >50%, 3-month >50%, 6-month >100%, each with monthly volatility >5%. Sorted by market cap. The decoding of the base codes (market cap $300M+, average volume 300K+, current volume 100K+) is from the researcher's memory, not checked. https://qullamaggie.net/jeff-suns-method-and-flow/ [S]
- "a good precise strong mover scan should yield less than 60 results"; switch 30% to 50% "if there are too many results appearing". Same URL [S].
- Growth screen: "Market Cap: > $150M USD", "60-Day Average Volume: > 800K", "ADR: > 3%", "10-EMA above 20-SMA", "1-week change between -5% and +5%", "200-MA Below Price". https://threadreaderapp.com/user/jfsrev [V]
- Hard rules: no entry if "ATR% extension from the 50-MA exceeds 4x"; "Relative Strength First, Setup Second". https://jfsrev.substack.com/my-trading-tools-process-routine [V]
- Not found: any VARS thresholds or an "RS new high on down days" screen.

**Others**
- Leif Soreide HTF: community transcription of his StockCharts scan is "8 week price change is greater than 90%" (close > 1.9 x close 40 bars ago). https://usethinkscript.com/threads/high-tight-flag-scanner-leif-soreide-for-thinkorswim.6966/ [S, snippet]. The "+100% in 8 weeks, 25% pullback, 3-5 weeks" form is [U] as his.
- TC2000 PCF for "RS new high before price": none found. A Finviz half-year-performance community scan was not researched.

## A5. Liquidity and tradability floors

| Source | Floor | Tag |
|---|---|---|
| Deepvue Leaders | $12.50, $1B cap, $20M average dollar volume, ADR 2% | [V] |
| Deepvue Liquid Leaders | $20, $100M average dollar volume | [V] |
| Kell (per Deepvue) | $20, 500K shares, $2B to $25B cap | [S] |
| IBD "perfect stocks" | $12 | [S] |
| Stockbee | $3, common stocks only, 3-day minimum volume | [V] |
| Qullamaggie | ADR 5 to 6%, dollar volume $5M to $80M scaled to account | [S] |
| Jeff Sun | $150M to $300M cap, 300K to 800K shares, ADR above 3% | [V]/[S] |

URLs are in sections A2 to A4.

- **Exclusions:** only Stockbee's "Common Stocks" universe is explicit. No published ETF, SPAC, biotech or ADR exclusion from IBD or Deepvue was found.
- **Short history / IPOs:** neither IBD nor Deepvue publishes a method. Deepvue says only that 1-month and 3-month RS suit "newly listed IPOs" (https://deepvue.com/ratings/deepvue-rs-rating/ [V]). IBD shows RS Ratings on weeks-old IPOs, method unpublished [S].

## A6. Regime changes

- **Deepvue, in corrections:** "Avoid purchasing stocks"; "Create multiple screeners and routinely update your watchlist with stocks that display Relative Strength". Switch to RS line new highs, RS-before-price, RS Days over 60%, up on down days. https://deepvue.com/screener/screeners-for-stock-market-corrections/ [V]
- **TraderLion:** build the RS list during the correction, then make it "the go-to tool once the market confirms a new uptrend". URL in section A3 [V].
- **MarketSmith practitioner (2013):** "I'm looking for stocks that show a RS Rating of at least 70 and the RS line is in new highs before price". Use "pilot buys"; "If the breakout attempts quickly fail it is a clear signal that the market is not ready." https://www.seeitmarket.com/market-masters-using-relative-strength-during-market-corrections-13418/ [V]
- **IBD:** build watchlists with the RS line during corrections; after a follow-through day, wait for names showing relative strength, not the crushed ones. https://inkl.com/news/how-to-prepare-for-a-new-stock-market-rally-5-top-stocks-with-strong-rs-lines [S, snippet]
- **Not found:** an explicit "holding above the 50-day while the index breaks it" rule.

## A7. Ranking and list size

- **Deepvue:** add the "Relative Strength Rating (1 Day)" column and sort by it. https://deepvue.com/screener/5-ways-to-screen-for-relative-strength/ [V]
- **Qullamaggie:** about 50 names, reviewed alphabetically [S].
- **Jeff Sun:** under 60, sorted by market cap [S].
- **Stockbee:** top 3% by rank, then sort by 5-day change for pullbacks under 5% [V].
- **IBD:** fixed-size lists (50, 20); the ranking formula is proprietary [S].
- **Trend Template pass counts:** 483 US stocks on one vendor (Oct 2026). A strict RS 80 plus VCP version is "often empty". https://vcpscanner.com/screens/minervini-trend-template and https://www.marketinout.com/stock-screener/minervini-buy-signal [S, snippets]

## A8. Failure modes

- **Extended names:** high-RS stocks "will often be extended, with no real buy point in sight"; a high rating "alone is not a buy signal" (IBD 2012 [V]). Jeff Sun's 4x ATR cap from the 50-MA is the one numeric fix found [V].
- **Late signal:** RS can sit in the "50s to 70s" out of long bases, so an 80+ gate misses early turns (IBD 2014 [V]). Minervini's wide template drops RS for this reason [S].
- **Price only:** the RS Rating "measures only price action, not volume changes" (IBD 2014 [V]).
- **Up on down days is unproven:** S&P 500 stocks up on most index down days "beat the SPX the next month just 47% of the time", against 51% for those that fell. https://schaeffersresearch.com/content/analysis/2021/03/17/testing-a-theory-stocks-rising-during-a-broad-market-selloff [V]
- **Takeover spikes:** "a single takeover-driven jump ranks the same as a year of steady buying". https://pro.stockalarm.io/blog/relative-strength-complete-guide [S, snippet]
- **Not found:** any published buyout-pin filter, or a named practitioner complaint about biotech spikes or defensive names leading in corrections. A buyout filter would be our own invention. ADR% and dollar-volume floors are the de facto junk filters.

## A9. Summary table

| Screen | Criteria | Sort | Source | Tag |
|---|---|---|---|---|
| Minervini Trend Template | 8 rules above; RS at least 70 | none stated | prorealcode.com, stockcharts forum | [S] |
| MarketSurge RS Line Blue Dot | RS line 52-week high, in base or at buy point | unpublished | inkl.com (IBD) | [S] |
| IBD RS At New High | RS line 52-week high; rest unpublished | unpublished | inkl.com (IBD) | [S] |
| IBD "perfect stocks" | Group rank 1-20, Composite 99, EPS 80+, RS 80+, SMR A/B, $12+ | unknown | inkl.com (IBD) | [S] |
| IBD group rule | Top 20-40 of 197, avoid bottom 20 | 6-month performance | Yahoo (IBD) | [V] |
| Deepvue Leaders | $12.50, $1B, $20M, ADR 2%, OR-groups | RS Rating 1-day | deepvue.com | [V] |
| Deepvue Liquid Leaders | $20, $100M, AS 3M >87 or 1M >93 | none stated | deepvue.com | [V] |
| Deepvue RS Days | RS Days over 60% during correction | none stated | deepvue.com | [V] |
| Qullamaggie | Top 1-2% on 1/3/6 months; ADR 5-6% | alphabetical, ~50 | qullamaggie.com, transcript | [V]/[S] |
| Stockbee momentum | C/AVGC126 or C/AVGC42 rank >97, $3 | 5-day change | stockbee.blogspot.com | [V] |
| Stockbee TI65 | avgc7/avgc65 >= 1.05 | ratio | stockbee.blogspot.com | [V] |
| Jeff Sun strong movers | 1M >30/50%, 3M >50%, 6M >100%, volatility >5% | market cap, <60 | qullamaggie.net | [S] |
| Soreide HTF | 8-week change >90% | unknown | usethinkscript.com | [S] |

## A10. What the best screens have in common

- A strength rank near the top of the universe (RS 80 to 90+, or top 1 to 7% by return), measured over several windows.
- An explicit tradability floor, most often dollar volume plus a range measure (ADR%).
- RS line new highs, especially before price, as the leading signal; these are screens for building a watchlist, never buy signals.
- A list short enough to review by eye (about 20 to 60) and tightened when it overflows.
- A separate correction mode.

## A11. Where they disagree

- **Rank against the universe or return against an index:** IBD and Deepvue rank; Qullamaggie, Stockbee and Jeff Sun use raw returns.
- **Trend gate:** Minervini requires the moving-average stack; Qullamaggie ignores it.
- **Volatility:** IBD Big Cap 20 wants low ATR; Qullamaggie wants high ADR.
- **Liquidity floor:** from $3 and 100K shares (Stockbee) to $100M a day (Liquid Leaders).
- **RS threshold:** 70 (Minervini) against 85 (IBD), and whether to relax it for early turns.
- **Fundamentals:** required by IBD and Kell; "ignore all fundamentals" for Qullamaggie.
- **Up-on-down-days:** used by Deepvue and TraderLion; contradicted by Schaeffer's test.

---

# Part B. Evidence on conditions that improve or hurt a long-only RS screen

In this part: [V] = the researcher opened the paper, abstract page or primary document. [S] = secondary summary, or abstract text relayed by a search result that was not opened. Numbers are long-short and gross of costs unless stated.

Three things could not be done: open the S&P methodology PDF (the site refused the fetch), open Alpha Architect's FIP page (same), and confirm the authorship of "Fresh Momentum".

## B1. 52-week-high proximity

- **George & Hwang 2004, J. Finance** [V] (https://www.bauer.uh.edu/tgeorge/papers/gh4-paper.pdf). US stocks, Jul 1963 to Dec 2001, top/bottom 30%, 6-month hold.
  - Winner minus loser per month: past-return momentum 0.48%, industry momentum 0.45%, 52-week-high 0.45%.
  - Excluding January: 1.07%, 0.50%, 1.23%.
  - Nested sorts: inside past-return winners, sorting on nearness to the high still earns 0.46%/month (1.11% ex-January). Inside 52-week-high groups, past return adds 0.22% (0.29% ex-January) or less, not significant.
  - Returns forecast by the 52-week high do not reverse in the long run.
- **Replications are mixed.**
  - Liu, Liu & Ma 2011, JIMF [S]: profitable in 18 of 20 markets, significant in 10, mostly not significant after costs (https://econpapers.repec.org/RePEc:eee:jimfin:v:30:y:2011:i:1:p:180-204).
  - Gupta, Locke & Scrimgeour 2010 [S]: across 51 countries it did not beat conventional momentum (https://ijbesar.ihu.gr/docs/volume16_issue1/16_01_07.pdf).
  - Bhootra & Hur 2013, JBF [S]: stocks with a recent 52-week high beat those with a distant one by about 0.70%/month (https://econpapers.repec.org/RePEc:eee:jbfina:v:37:y:2013:i:10:p:3773-3782).
  - Goyal, Jegadeesh & Subrahmanyam 2022 [V, abstract]: in an international horse race the frog-in-the-pan proxy, not the 52-week-high anchor, "consistently wins" (https://ssrn.com/abstract=4012902).
- **Design implication:** make "% off 52-week high" a core rank input alongside past return, and add "days since the 52-week high".

## B2. Industry / group momentum

- **Moskowitz & Grinblatt 1999, J. Finance** [S, abstract]: industry momentum "accounts for much of" stock momentum, and stock momentum is significantly less profitable once industry is controlled for (https://econpapers.repec.org/RePEc:bla:jfinan:v:54:y:1999:i:4:p:1249-1290).
- **Size of the industry share** [V, George & Hwang Table II]: ex-January, the industry strategy earns 0.50%/month against 1.07% for stock momentum, so roughly half, not all.
- **Contested:** Grundy & Martin 2001 and Lewellen 2002 find industry effects do not explain stock momentum [S] (https://www.efmaefm.org/0EFMAMEETINGS/EFMA%20ANNUAL%20MEETINGS/2007-Austria/papers/0468.pdf).
- **Lookback:** industry predictability is strongest at one month and lasts up to a year [S] (https://rodneywhitecenter.wharton.upenn.edu/wp-content/uploads/2018/03/Juhani.pdf). Unlike stocks, industries do not reverse at one month.
- **Industry 52-week high:** Hong, Jordan & Liu 2015, Pacific-Basin FJ [S]: an industry-level 52-week-high strategy beats the stock-level one (https://econpapers.repec.org/RePEc:eee:pacfin:v:32:y:2015:i:c:p:111-130).
- **Not found:** a published number for "winners inside winning industries" versus winners alone.
- **Design implication:** add a group-strength component that includes the latest month (1-month plus 6-month group return, no skip) and group nearness to its high, as a score input and not a gate.

## B3. Residual / idiosyncratic momentum

- **Blitz, Huij & Martens 2011, J. Empirical Finance** [V, abstract] (https://repub.eur.nl/pub/22252): ranking on residual returns gives risk-adjusted profits "about twice as large", more consistent over time and less concentrated in extreme stocks.
  - Secondary figures [S], 1926 to 2009: Sharpe 0.90 against 0.45, volatility 12.5% against 22.7% (https://www.cxoadvisory.com/?p=23858).
- **Blitz, Hanauer & Vidojevic 2020, IREF** [S]: a distinct effect not explained by conventional momentum, much less sensitive to bull/bear state and to rebound losses. A secondary source gives Sharpe 0.48 against 0.25 for 1925 to 2015; the units could not be verified (https://econpapers.repec.org/RePEc:eee:reveco:v:69:y:2020:i:c:p:932-957, https://www.cxoadvisory.com/momentum-investing/idiosyncratic-pure-or-residual-momentum-as-a-stock-return-predictor).
- **Supportive follow-ups** [S]: Huij & Lansdorp replicate it out of sample; Hanauer & Windmüller find it cuts drawdowns more than volatility scaling (https://quantpedia.com/Screener/Details/136, https://quantpedia.com/three-methods-to-fix-momentum-crashes/).
- **Caveat:** the gain is mostly lower volatility, not higher return, and all tests are long-short. No failed replication was found.
- **Design implication:** rank on benchmark-adjusted, ideally beta-adjusted, strength (the RS line) instead of raw price change.

## B4. Path smoothness ("frog in the pan")

- **Da, Gurun & Warachka 2014, RFS** [V] (https://academicweb.nd.edu/~zda/Frog.pdf).
  - Formula: `ID = sgn(PRET) x [%neg - %pos]`, where PRET is the 12-month return skipping the latest month and %neg/%pos are the shares of down and up days. Low ID means smooth.
  - Six-month momentum profit falls monotonically from 5.94% (smooth) to -2.07% (gappy).
  - Smooth momentum persists eight months and does not reverse; gappy momentum is insignificant after two months.
  - Sample ends 2007; start dates run from 1927 to 1992 depending on the panel.
- **Replication:** Goyal, Jegadeesh & Subrahmanyam 2022 [V, abstract]: FIP wins internationally. Galvani 2024, Finance Research Letters [S]: the relation holds only in up markets (https://ideas.repec.org/a/eee/finlet/v63y2024ics1544612324004045.html). No published failed replication was found, so the earlier "disputed" label in file 03 looks too strong.
- **Consistent winners:** Chen, Chou & Hsieh 2015 [S], 1980 to 2011: winners in two consecutive 6-month windows earn 1.25%/month against 1.06% conventional (https://www.cxoadvisory.com/momentum-investing/stock-momentum-based-on-persistent-winners-and-losers/).
- **Clenow slope x R-squared:** no peer-reviewed test was found. Treat it as an untested cousin of ID.
- **Design implication:** add a smoothness score (share of up days over the lookback) and demote winners whose gain came from a few gap days.

## B5. Volatility, risk-adjusted ranks, lottery names

- **Bali, Cakici & Whitelaw 2011, JFE** [S, abstract]: stocks with the highest maximum daily return last month underperform the lowest by more than 1%/month, robust to momentum and reversal controls (https://econpapers.repec.org/RePEc:eee:jfinec:v:99:y:2011:i:2:p:427-446).
- **Rachev, Jasic, Stoyanov & Fabozzi 2007, JBF** [S]: 517 S&P 500 stocks, 1996 to 2003. Reward-risk ranks gave better risk-adjusted results and lower tail risk; raw-return ranks earned more in raw terms (https://ideas.repec.org/a/eee/jbfina/v31y2007i8p2325-2346.html).
- **Index practice:** MSCI [V] and S&P [S] both divide momentum by volatility (section B13).
- **Contrary:** Arena, Haggard & Yan 2008, Financial Review [S]: momentum is larger in high-idiosyncratic-volatility stocks but reverses faster and harder, and is concentrated in losers (https://econpapers.repec.org/RePEc:bla:finrev:v:43:y:2008:i:2:p:159-190).
- **Design implication:** rank on return divided by volatility and flag names with an extreme one-day spike in the last month; do not hard-exclude volatile stocks.

## B6. Acceleration, recent versus intermediate strength, pullbacks

- **Novy-Marx 2012, JFE** [S, abstract]: momentum is driven mainly by months 12 to 7 (https://econpapers.repec.org/RePEc:eee:jfinec:v:103:y:2012:i:3:p:429-453).
- **Contested:** Goyal & Wahal 2015, JFQA [S, abstract]: no such echo in 37 other countries; the US result is largely a carryover of reversal from month -2 (https://www.cambridge.org/core/journals/journal-of-financial-and-quantitative-analysis/article/abs/is-momentum-an-echo/5E4B893AFD2F110B7347F8F483D28ED3).
- **Acceleration:** Chen & Yu 2013 working paper [S], US 1962 to 2011: convex winners minus concave losers 1.32%/month against 0.83% plain; concave winners minus convex losers 0.47%. Gross and exposed to data snooping (https://www.cxoadvisory.com/momentum-investing/stock-price-acceleration-as-a-momentum-investing-enhancement/). Ardila, Forro & Sornette 2021, Physica A [S] report a similar "Gamma" effect (https://ideas.repec.org/a/eee/phsmap/v569y2021ics0378437120307196.html).
- **Short-term reversal:** Jegadeesh 1990 [S]: 2.49%/month spread on one-month reversal, 1934 to 1987 (https://econpapers.repec.org/RePEc:bla:jfinan:v:45:y:1990:i:3:p:881-98). Lehmann 1990 [S]: weekly reversal (https://www.nber.org/papers/w2533).
- **Reversal is conditional:**
  - Medhat & Schmeling 2022, RFS [V], US Jul 1963 to Dec 2018: buying last month's winners returns -16.92%/yr in the lowest-turnover decile, -3.39% across all stocks and +16.44% in the highest-turnover decile. Continuation is strongest in the largest, most liquid stocks (https://openaccess.city.ac.uk/id/eprint/31278/).
  - Chen, Stivers & Sun 2024, J. Empirical Finance [V, abstract]: reversal weakens as turnover and price-to-52-week-high rise, and becomes momentum when both are high (https://ideas.repec.org/a/eee/empfin/v79y2024ics0927539824000902.html).
  - Zhu & Yung 2016, JPM [S, abstract]: momentum works best among short-term winners; winners with good recent performance keep outperforming (https://sf.cufe.edu.cn/info/1198/6521.htm).
- **Pullbacks:** no rigorous study was found showing that leaders bought on a pullback beat leaders bought near highs. At the one-month horizon the evidence leans the other way for liquid stocks near highs. The reversal edge sits in illiquid stocks far from highs.
- **Design implication:** do not penalise liquid leaders for strength in the latest month; treat "pullback" as an entry tag, not a ranking factor.

## B7. Market-state conditioning

- **Cooper, Gutierrez & Hameed 2004, J. Finance** [S, abstract], 1929 to 1995: momentum earns 0.93%/month after a non-negative 3-year market return and -0.37% after a negative one (https://doi.org/10.1111/j.1540-6261.2004.00665.x).
- **Wang & Xu 2015, J. Empirical Finance** [S]: high market volatility forecasts low momentum payoffs, centred on losers (https://econpapers.repec.org/RePEc:eee:empfin:v:30:y:2015:i:c:p:79-91).
- **Goyal, Jegadeesh & Subrahmanyam 2022** [V, abstract]: internationally, momentum is stronger in up markets and in calmer markets.
- **A published simple rule** [V]: MSCI re-ranks ad hoc, using 6-month momentum only, when the monthly change in the parent index's 3-month volatility exceeds its historical 95th percentile (https://www.msci.com/eqb/methodology/meth_docs/MSCI_Momentum_Indexes_Methodology_Aug2021.pdf).
- **Design implication:** show a regime badge (trailing multi-year index return positive, volatility not spiking) and shorten the lookback after a volatility spike.

## B8. Earnings momentum

- **Chan, Jegadeesh & Lakonishok 1996, J. Finance** [V, abstract]: past returns and past earnings surprises each predict large drifts after controlling for the other, with little later reversal (https://econpapers.repec.org/RePEc:nbr:nberwo:5375). A review [S] puts about 41% of the first six months' price-momentum premium around earnings dates.
- **Novy-Marx 2015, NBER WP 20984** [S, abstract]: earnings surprises "largely subsume" past performance; controlling for price momentum inside an earnings-momentum strategy removes its crashes without cutting return (https://mysimon.rochester.edu/novy-marx/research/FMFM.pdf). Contested: it conflicts with the 1996 paper on whether price adds anything, and a journal version could not be confirmed.
- **Design implication:** add an earnings-surprise or post-earnings-gap flag as a co-equal input; both studies agree it adds.

## B9. Volume, liquidity, size

- **Lee & Swaminathan 2000, J. Finance** [S, abstract]: high-turnover stocks earn lower future returns; high-volume winners reverse faster; low-volume winners beat high-volume winners only beyond 12 months (https://ideas.repec.org/a/bla/jfinan/v55y2000i5p2017-2069.html). Spread sizes could not be verified.
  - Contested: "Momentum life cycle, revisited", JBF 2021 [S], calls the framework a spurious product of two known effects (https://aminer.org/pub/609a6df0e4510cd7c89012e7/momentum-life-cycle-revisited).
- **Hong, Lim & Stein 2000, J. Finance** [S]: momentum declines sharply with size outside the tiniest stocks, and is stronger with low analyst coverage, mainly among losers (https://www.nber.org/papers/w6553).
- **Gervais, Kaniel & Mingelgrin 2001, J. Finance** [S, abstract]: unusually high volume over a day or week precedes appreciation over the next month (https://econpapers.repec.org/RePEc:bla:jfinan:v:56:y:2001:i:3:p:877-919).
- **Up/down volume and accumulation ratings:** no rigorous evidence was found.
- **Design implication:** flag recent abnormal volume as a short-horizon positive and chronic very high turnover as a long-horizon caution.

## B10. Holding up on market down days

- **Ang, Chen & Xing 2006, RFS** [S]: stocks that fall hardest with the market earn about 6%/yr more. This is the opposite of the practitioner belief (https://econpapers.repec.org/RePEc:oup:rfinst:v:19:y:2006:i:4:p:1191-1239).
- **That premium failed replication:**
  - Atilgan, Bali, Demirtas & Gunaydin 2018, JPM [S]: no relation internationally (https://research.sabanciuniv.edu/id/eprint/37241/).
  - Same authors 2020, European Financial Management [S]: the US result vanishes with value weighting or controls (https://doi.org/10.1111/eufm.12258).
  - Levi & Welch 2020, RFS [S]: down-betas are useful "for neither hedging nor risk-pricing" (https://ideas.repec.org/a/oup/rfinst/v33y2020i6p2772-2795..html).
- **Verdict:** no rigorous support that "RS on red days" predicts outperformance. The original evidence is contrary and the later evidence is null. No direct test of the practitioner signal itself was found (see also Schaeffer's test in A8).
- **Design implication:** show it as a descriptive column only, with no weight in the rank.

## B11. First leaders out of a correction

- No academic or independent test was found. IBD states it as doctrine [S, practitioner assertion] (https://www.inkl.com/news/this-bullish-chart-pattern-led-to-nvidia-s-43-surge).
- The only independent work nearby is Hanna 2008 (Quantifiable Edges) [S]: 55% of 65 follow-through days succeeded (https://quantifiableedges.blogspot.com/2008/02/are-ibd-follow-through-days-after-day.html).
- The crash literature already held in file 03 points the other way for 12-month winners in rebounds.
- **Design implication:** label a "first new RS highs after a correction" list as practitioner lore and log its outcomes to build our own evidence.

## B12. Turnover and decay of a leaderboard

- **Churn:** 47% of 6-month winners leave the top decile the next month [S, Chen, Chou & Hsieh]. MSCI USA Momentum factsheets show turnover of 112.67%, 117.74% and 135.60% in 2026 [S] (https://www.msci.com/documents/10199/255599/msci-usa-momentum-index-usd-net.pdf).
- **Decay:** Arnott, Kalesnik, Kose & Wu 2017 [S]: profits "accrue for months, not years"; fresh momentum beats stale; a tertiary source cites a half-life of about three months (https://quantpedia.com/can-momentum-investing-be-saved).
- **"Fresh Momentum" working paper** [S, unofficial copy, authorship unverified]: fresh-only winners and losers earn 10.2%/yr four-factor alpha (https://www.scribd.com/document/358244890/3-Fresh-Momentum).
- **Reconciling with section B4:** consistency inside the past year helps; a multi-year run hurts.
- **Design implication:** flag "new to the leaderboard" and separately flag "multi-year winner, extended".

## B13. Composite score versus sequential filters

- **MSCI Momentum score** [V] (URL in section B7):
  - `6m = P(T-1)/P(T-7) - 1 - rf` and `12m = P(T-1)/P(T-13) - 1 - rf`.
  - Each is divided by sigma, the annualised standard deviation of weekly returns over 3 years.
  - Each is z-scored; `C = 0.5 x Z6 + 0.5 x Z12`; C is re-standardised to Z and winsorised at +/-3.
  - `Score = 1 + Z` if Z > 0, `1/(1 - Z)` if Z < 0.
  - Weight = score x market-cap weight. Fixed count, 50% buffer, semi-annual (May and November).
- **S&P Momentum score** [S, search snippets of the methodology; PDF not opened] (https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-momentum-indices.pdf):
  - Momentum value = 12-month price change excluding the latest month (prices at M-2 and M-14).
  - Divided by the standard deviation of daily returns over the same window; z-scored; winsorised at +/-3.
  - The `1 + Z` / `1/(1 - Z)` score form was confirmed only on a sibling S&P index.
  - Top quintile, weight = float cap x score, rebalanced March and September.
- **Composite versus cut-offs** [S]: Bender & Wang 2016 favour integrated scoring; Leippold & Rueegg 2018 find no significant difference (https://link.springer.com/article/10.1057/s41260-020-00188-9). The strongest conditional results above (sections B1 and B4) come from sequential sorts: momentum first, quality second.
- **Design implication:** use one composite of volatility-adjusted 6- and 12-month z-scores for the rank, then apply smoothness and nearness-to-high as second-stage sorters.

## B14. Ranked conclusions

**Strongest evidence for improving a long-only RS selection**
1. Nearness to, and recency of, the 52-week high (B1).
2. Smooth path (B4); it also survived the international horse race.
3. Benchmark- or factor-adjusted strength instead of raw return (B3); the gain is mainly risk.
4. Earnings surprise or post-earnings drift alongside price (B8).
5. Volatility-adjusted ranking and a one-day-spike flag (B5).
6. Market state: up and calm (B7).
7. Group strength including the latest month (B2); the size of the industry share is contested.
8. Freshness (B12); weaker sourcing.

**Practitioner beliefs with weak or contrary evidence**
1. "RS on red days marks leaders" (B10): contrary, then null.
2. "Buy leaders on pullbacks" (B6): unsupported for liquid stocks near highs.
3. "First leaders out of a correction" (B11): untested.
4. Up/down-volume accumulation (B9): no rigorous evidence.
5. "High volume confirms a winner" (B9): chronic high turnover predicts faster reversal.
6. The months 12-to-7 "echo" (B6): not robust outside the US.

## B15. Five caveats on applying this to a daily swing-trading screen

1. **Long-short versus long-only.** Much of the measured profit, and nearly all the crash and market-state effects, come from the loser leg. Long-only gains will be smaller and dominated by market beta.
2. **Horizon mismatch.** The results use monthly formation and 1- to 6-month holds. Daily and weekly horizons sit in the reversal and microstructure zone, where signs can flip with liquidity (B6).
3. **Costs and churn.** Returns are gross; about half the top decile turns over monthly, and several effects lose significance after costs (B1 and B12).
4. **Universe and weighting.** Many results are equal-weighted and strongest in small, illiquid, low-coverage stocks. Verified exceptions: short-term momentum and the Novy-Marx result are strongest in large, liquid stocks.
5. **Decay and overlap.** Samples mostly end between 2001 and 2018, and several papers are unpublished working papers. The signals also overlap (smoothness, low volatility, nearness to high), so stacking them double-counts; test them on our own universe before fixing weights.

---

# Part C. How leading screeners present a signature RS list

**Not verified:** MarketSurge desktop list panel (paywalled; investors.com and the Scribd guide blocked), IBD Screen of the Day, ChartMill and Barchart pages (snippets only), TraderLion (403). Reddit/X searches returned almost no first-hand threads, so user feedback rests on app-store reviews and review blogs, several written by competitors.

## C1. Product findings

### MarketSurge (IBD), paywalled
- **Reach:** named lists; the app advertises "Exclusive lists including Breaking Out Today, Near Pivot and RS Line Blue Dot" [V] https://apps.apple.com/app/id433822602. Exact click path [U].
- **Blue Dot rule:** RS line at a 52-week high while the stock is forming or breaking out of a base [S, IBD article via snippet] https://www.inkl.com/news/marketsurge-blue-dot-pattern-recognition-among-its-cool-tools
- **Growth 250:** "uses 30 different screens" [V] same App Store page.
- **Row columns:** not verifiable [U]. "Over 70 key technical and fundamental stock data points" and IBD ratings exist [V] same page.
- **Groups:** industry group top/bottom performers [V] same page; no consolidated theme dashboard [S, competitor] https://deepvue.com/?p=14546
- **Change tracking, export, list-entry alerts:** nothing found [U]. Alerts are for buy zones and sell signals [V] App Store page.
- **Trust:** release 6.5 (Apr 25, year not shown) says it is "modernizing the calculations behind our IBD ratings" [V] same page. Formula proprietary.
- **Phone:** native iOS/Android [V]. One review: "List layouts are fantastic!"; another: lists "many don't populate" when scrolling [S, user reviews on that page]. Crashes reported [S] https://www.wallstreetzen.com/blog/ibd-marketsurge-review/
- **Complaints:** price ($149.99/mo [V]); "poor explanation of acronyms and indicators"; static charts [S] wallstreetzen link above.

### Deepvue
- **Reach:** Screener, My Screens dropdown, Screener Presets tab, folders plus keyword search [V] https://docs.deepvue.com/articles/screener-presets. "More than 100 preset screens" with named traders [V] https://deepvue.com/?p=14393. RS presets: "Deepvue Leaders", "Oliver Kell's RS on Down Day" [V] https://deepvue.com/?p=10389
- **RS screens by shared link:** RS Line New Highs, RS New High Before Price, RS Days over 60% ("Add This Screener to Your Deepvue Account") [V] https://deepvue.com/?p=6928
- **Columns:** user-built sets; a "Relative Strength Finder" set (% change today, DCR/WCR, 1D/1W strength rating, % from open/low) [V] ?p=10389. RS Rating 1 to 99 on 1/3/6/12 months [V] https://docs.deepvue.com/categories/data-points-and-ratings
- **Views:** results beside a chart, optional mini-charts, heatmap and bubble panels [S] https://daytradereview.com/deepvue-review
- **Leadership:** Theme Tracker with curated themes ("not at all related to the GICS…"), Today/Week/Month/YTD, click a theme for its top stocks, real-time [V] https://docs.deepvue.com/articles/theme-tracker-app
- **Change tracking:** none found. Reviewer: missing "the ability to set an alert for if a stock enters or leaves one of your scans" [S] daytradereview link.
- **Trust:** rating described, weights not published; "independently calculated", not IBD's [V] https://deepvue.com/?p=14383
- **Customise:** duplicate a preset, then edit [V] screener-presets doc. Bookmarks, Share and Export icons [V, snippet] https://deepvue.com/?p=11173
- **Phone:** App Store listing names real-time screener, watchlists and alerts [V, snippet] https://apps.apple.com/us/app/deepvue/id6470937111. Deepvue's own comparison page says mobile is "in development" [V] ?p=14546. These conflict.
- **Complaints:** crowded on small monitors; premade scans carry "upwards of 10 filters"; no trial [S] daytradereview.

### TraderLion
No own screener found; its RS education points to Deepvue's RS Rating and RS line [S, snippet; page 403] https://traderlion.com/markets-essentials/relative-strength-essentials/. Treat as Deepvue [U].

### TC2000
- **Reach:** build it yourself. One click on a column header sorts, with a Re-sort button to refresh [V] https://help.tc2000.com/m/69401/l/326935-how-to-sort-a-watchlist-by-a-column
- **RS:** EasyScan can "rank order and filter results by their performance to the market" [S, Reddit] https://redlib.hackliberty.org/r/RealDayTrading/comments/10xa8lx/rsrw_scan_tc2000. No native RS rating [S, competitor] https://chartinglens.com/blog/best-marketsurge-alternatives
- **Extras (article titles only):** column sets, Slide Show Mode, Share an EasyScan, condition alerts, copy to Excel, mobile heatmap [V] https://help.tc2000.com/m/69401

### TradingView
- **Reach:** "Popular screens" presets such as "Strong performance small caps" [V] https://www.tradingview.com/chart/DUOL/p9b1eIKe-Find-great-stocks-to-trade-with-our-Stock-Screener-2-0/. No native RS rating [S] chartinglens link above.
- **Views:** column-set tabs; Chart view "displays the data as a grid of charts instead of rows"; CSV export; refresh every 10 s or 1 min; send results to a watchlist [V] https://www.tradingview.com/support/solutions/43000718885-tradingview-screeners-walkthrough/. Grid up to 4x4 [V, snippet] https://www.tradingview.com/support/solutions/43000728343
- **Explanation:** a question icon beside each filter links to a help article [V] https://www.tradingview.com/blog/en/new-screeners-stock-crypto-coins-etf-42346
- **Pine Screener (beta):** one indicator per screen, last 500 bars only [V] https://www.tradingview.com/support/solutions/43000742436
- Enter/leave alerts: none found [U].

### Finviz
- **Reach:** Signal dropdown (Top Gainers, New High, Unusual Volume…); no RS signal; views include Performance and Technical; presets saved [V] https://finviz.com/help/screener.ashx
- **Elite:** "Screener notifications when new stocks match your filters", CSV export, refresh 10 s vs 3 min free [V] https://finviz.com/elite.ashx
- **Complaints:** no RS percentile, so users approximate with 3/6/12-month performance columns [S, competitor] https://easyswing.pages.dev/blog/easyswing-vs-finviz. No native app [S] ?p=14393.

### StockCharts
- **Reach:** SCTR Reports from Member Tools or the Market Analysis menu [V] https://help.stockcharts.com/charts-and-tools/research-tools/stockcharts-technical-rank-sctr-reports
- **Row, in order:** Symbol, Name, Sector, Industry, SCTR, Chg, Last, Volume, Market Cap; "Hover over symbol to see a mini chart" / "Tap symbol for mini chart"; "all data is delayed by 15 minutes" [V] https://stockcharts.com/freecharts/sctr.html
- **Change:** dashboard Top Ten tabs (highest, lowest, most improved, least improved) with CandleGlance or RRG links; Intraday/End-of-Day/One Week; members' scores "updated every 2-3 minutes" [V] help link above.
- **Market-health view:** Predefined Scan Results show a count per scan by index and sector; a bar turns green or red against the previous day; results open as table, SharpCharts or CandleGlance; CSV; "Edit Scan Criteria" [V] https://help.stockcharts.com/charts-and-tools/symbol-reports/predefined-scan-results
- **Trust:** SCTR recipe published (six measures, three timeframes) [V, snippet] https://help.stockcharts.com/scanning-and-alerts/writing-scans/scanning-for-sctrs. Its own article warns 90+ names "may be overbought and due for a pullback" [V] https://articles.stockcharts.com/article/stockcharts-insider-the-sctr-fast-track-to-buy-the-dips-breakouts/

### ChartMill (snippets; pages 403)
- **Reach:** named "Trading Ideas" presets, e.g. Minervini Trend Template with RS at least 70 [V] https://www.chartmill.com/trading-ideas/645-Mark-Minervinis-Trend-Template-TTP
- **RS:** percentile slider plus filters for RS at 13/52-week highs [V] https://chartmill.com/news/default/Chartmill-7504-Finding-the-strongest-stocks-using-Relative-Strength
- **Grades:** Technical Rating and Setup Quality, both 0 to 10; the analyzer explains why each applies [V] https://www.chartmill.com/getting-started/chartmill-overview
- **AI builder:** "shows you exactly which technical filters it has configured" [V] https://chartmill.substack.com/p/finding-stocks-has-never-been-easier
- Export and historical-date screens cost credits [S] https://www.liberatedstocktrader.com/chartmill-review/

### Barchart Top 100 (snippets; fetch returned empty)
One-click page ranked by Weighted Alpha; shows previous day's rank, where "N/A" means new today; Premier end-of-day email of newly ranked stocks; historical reports from 03/06/2020 with flipcharts and download; list updates every 10 minutes [V] https://www.barchart.com/stocks/top-100-stocks

### Stock Rover, Koyfin, Trade Ideas
- **Stock Rover:** the "Relative Strength" screener must be imported from the Library; each of seven filters shows as a column; thresholds published; a ticker passing 5 of 7 scores 71% [V] https://stockrover.com/blog/screening-by-relative-strength/?id=9
- **Koyfin:** templates; criteria become columns [V] https://www.koyfin.com/help/my-screens. No RS rating [S] ?p=14546.
- **Trade Ideas:** 40+ one-click channels, none named for relative strength (closest are "Trending" and "Stocks Surging") [V] https://www.trade-ideas.com/education/channel-bar-descriptions/. Mobile "a bit of a letdown" [S, weak source] https://tooliverse.ai/tools/trade-ideas

### Community dashboards and AI
- **thetrading.tools:** cards for "Published leaders 84", "New entrants 15 — Since Nov 12, 2026", "Change in list size +5"; rank arrows and a "New" tag; "Daily close snapshot · Nov 13, 2026"; "Copy screen link"; eligibility rules stated [V] https://www.thetrading.tools/momentum-scanner
- **iArpanK RS Screener:** publishes "RS Score = 40% * P3 + 20% * P6 + 20% * P9 + 20% * P12"; separate label for "RS New High Before Price" [V] https://iarpank.github.io/RS-Screener
- **Stockbee Market Monitor:** counts of 4% movers as a breadth gauge [V, snippet] https://stockbee.blogspot.com/2018/08/market-monitor-scans.html
- **Deepvue AI:** plain English becomes visible filters [S] https://beginnersinai.org/deepvue-ai-terminal-review/. FinChat: nothing notable found [U].

## C2. What users praise and complain about

- **Praise:** MarketSurge list layouts and cross-device sync [S] App Store reviews; Deepvue's presets and "flexible dashboard" [V testimonial] ?p=14393; Finviz for being fast, free and simple [S] easyswing link.
- **Complaints:** price (MarketSurge); jargon without explanation (MarketSurge); too many filters per preset (Deepvue); no alert on entering or leaving a scan (Deepvue); no real RS ranking (Finviz, TradingView); RS ratings differ by vendor, with community clones reporting "+/- 3 to 5 points" from IBD [S] https://www.tradingview.com/script/pziQwiT2/; unreliable phone lists (MarketSurge, Deepvue) [S] app reviews.
- "Too many results" and "extended names": no first-hand evidence found; only StockCharts' own overbought warning [U].

## C3. Feature matrix

Y = yes, P = partial, N = no, ? = unknown. MS = MarketSurge, DV = Deepvue, TV = TradingView, SC = StockCharts, CM = ChartMill, BC = Barchart, SR = Stock Rover.

| Feature | MS | DV | TC2000 | TV | Finviz | SC | CM | BC | SR |
|---|---|---|---|---|---|---|---|---|---|
| One-click named RS list | Y | P | N | N | N | Y | Y | Y | P |
| Native RS percentile | Y | Y | N | N | N | Y | Y | P | N |
| RS-line new-high flag/list | Y | Y | N | N | N | P | P | N | N |
| Mini chart / chart grid | ? | Y | P | Y | ? | Y | ? | Y | ? |
| Group/theme leadership view | P | Y | ? | ? | ? | P | ? | ? | P |
| New-on-list / rank change | ? | ? | ? | ? | N | P | ? | Y | ? |
| Historical snapshots / count trend | ? | ? | ? | ? | N | P | P | Y | ? |
| Criteria or formula disclosed | N | P | Y (own) | Y | Y | Y | Y | Y | Y |
| Clone/edit built-in | ? | Y | Y | Y | Y | P | Y | P | Y |
| New-entrant alert | ? | N | P | ? | Y | ? | ? | Y | ? |
| CSV export | ? | P | P | Y | Y | Y | Y | Y | ? |
| Share link | ? | Y | Y | ? | ? | ? | Y | ? | ? |
| Native phone app with lists | Y | Y | Y | P | N | ? | ? | ? | ? |
| Freshness label | ? | ? | ? | P | P | Y | ? | Y | ? |

## C4. Synthesis

**Table stakes**
- A named preset, not a blank filter form (MarketSurge, Deepvue, ChartMill, Barchart, StockCharts).
- A sortable table with user-chosen columns and saved column sets.
- A fast path from row to chart: hover chart, chart grid or flipcharts.
- Clone-and-edit, save, CSV export, push to watchlist.

**Best-in-class moves**
- **Barchart:** previous rank, "N/A" new marker, new-entrant email, dated history.
- **StockCharts:** count per scan by sector with an up/down bar versus yesterday; SCTR "most improved" tab; stated data delay.
- **Deepvue:** curated Theme Tracker with drill-in; shareable screen links; trader-named presets.
- **MarketSurge:** RS Line Blue Dot, a single-idea list tied to base structure.
- **TradingView:** table-to-chart-grid toggle; help link beside every filter.
- **Stock Rover:** each criterion as its own column plus a "passes N of M" score.
- **ChartMill:** a second "setup quality" grade beside strength.
- **thetrading.tools:** header cards for list size, new entrants and change in size, with snapshot date.

**Nobody does this yet (in what could be seen)**
- A per-row "why it's here" sentence on a signature RS list.
- Days-on-list, plus a "dropped off today" tab.
- List count over time presented as a market-health gauge inside a major product.
- Hit-rate or backtest stats shown on the screen itself.
- A "strictness" control on a built-in screen; everyone makes you clone and edit.
- An "extended" versus "near a buy area" split in the default RS list.
- A statement of how the RS rating differs from IBD's.

## C5. Ten UX recommendations

1. Make the RS scan a one-click named list with a one-line rule, as MarketSurge does with Blue Dot.
2. Open with header cards for list size, new entrants, dropped names and change versus yesterday, as thetrading.tools does.
3. Show rank, previous rank and a "New" tag on each row, as Barchart does.
4. Add days-on-list and a "dropped off" tab, since no product surveyed shows them.
5. Give a table-to-chart-grid toggle and tap-for-mini-chart on phone, following TradingView and StockCharts.
6. Group results by theme with counts and drill-in, taking Deepvue's Theme Tracker further.
7. Show each criterion as a pass/fail chip with an "N of M" score and a plain-words tooltip, combining Stock Rover and TradingView.
8. Publish the RS formula and state that it will differ from IBD's by a few points, because clones report 3 to 5 point gaps.
9. Separate "extended" names from actionable ones with a second grade, as ChartMill's Setup Quality and StockCharts' overbought warning suggest.
10. Offer alerts when a stock enters or leaves the list, a visible data timestamp, and a phone list that loads reliably, which are the gaps reviewers named for Deepvue and MarketSurge.

---

# Part D. Live snapshot facts, uctintelligence.com Screener, read 2026-11-13 after the close (snapshot_date 2026-11-13)

These are one day's readings from the member API (`POST /api/screener/scan`, read through the owner's signed-in browser), not a backtest. They describe what the columns held on that snapshot and nothing about what happens next.

**Universe**
- 3,488 rows at price ≥ $5 and $10M+ traded (30-day dollar volume): 1,084 ETFs, 2,264 stocks, 140 ADRs.
- 2,404 stocks plus ADRs. All counts below are on these unless a tighter floor is stated.

**RS readings (2,404 stocks and ADRs)**
- RS rating ≥ 80 / 90 / 95: 738 / 331 / 146.
- RS line new high today: 11. Within 5 / 10 / 20 sessions: 237 / 289 / 323.
- RS new high before price today: 0. RS new high on a red day today: 0.
- RS line above its 21 EMA: 1,333.
- `green_on_red_20` distribution: 0: 320, 1: 733, 2: 640, 3: 448, 4: 196, 5: 23.
- `rs_exit_last` is null on all 2,404 (the exit-warning columns were not filled).
- `theme` is null on 832; `industry` is null on 10.

**Funnel at price ≥ $10 and $20M+ traded**
- Liquid: 1,931. With ADR ≥ 3: 1,258. With ADR ≥ 4: 765.
- RS ≥ 85: 435.
- Plus above the 50-day and 200-day with the 200-day rising: 295.
- Plus within 25% of the 52-week high: 288.
- Plus RS line above its 21 EMA: 260.
- Plus RS line new high within 20 sessions: 175.
- That last set with ADR ≥ 3: 111. With ADR ≥ 4: 62.

**Built-in `rank` spec test**
- A 7-criteria weighted rank (top 40 of 202 passing rows) put over-extended names near the top: XERS (8.27 ATR above its 50-day), GDYN 6.28, CROX 6.23, PGNY 6.62.

**Prototype gate and setup labels**
- Gate: price ≥ $10, $20M+ traded, ADR ≥ 3, RS ≥ 80, above a rising 200-day, within 25% of the 52-week high. 310 names pass.
- Setup labels on those 310: Extended 26, Trending 116, Pullback 48, Tight 24, At pivot 17, Below 50-day 79.

**Where the strength sat**
- Share of liquid names (price ≥ $10, $20M+) with RS ≥ 85, by sector: Healthcare 47%, Technology 32%, Energy 23%, Consumer Cyclical 22%, Communication 22%, Consumer Defensive 16%, Financials 14%, Industrials 13%, Real Estate 10%, Basic Materials 6%, Utilities 3%.
- 118 industries and 94 themes have ≥ 5 liquid members (price ≥ $5, $10M+).
- Examples (members / median RS / share at 80+ / RS new highs in 10 sessions): Diagnostics & Research 28 / 90 / 86% / 12; Medical Care Facilities 31 / 86 / 68% / 14; theme GLP-1 Supply Chain 16 / 90 / 94% / 10.
- Bottom of the industry list by median RS: Uranium 16, Solar 26.

**Market context on the same snapshot**
- SPY: 1.36% below its 50-day, 3.11% above its 200-day, 3.48% off its 52-week high.
- QQQ: 5.39% below its 50-day, 0.3% below its 200-day, 10.88% off its 52-week high.

**ADR band check** (RS ≥ 80, price ≥ $10, $20M+, above the 200-day, within 25% of the high)
- ADR ≥ 4: 197 names.
- ADR 3 to 4: 147 names (LLY, TMO, SPOT, REGN, DAL, NUE and others).
- ADR under 3: 177 names (AAPL, V, JNJ, KO and others).
