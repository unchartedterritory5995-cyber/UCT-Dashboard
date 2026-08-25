# 07 — Candlestick Reliability Statistics, Base Rates, and a Notability Ranking

Researcher 07 of 10. Empirical brief for the `CANDLE` screener column (~3,700 US tickers, newest daily bar, ONE label).
Compiled 2026-08-24. Every number below was fetched from a live page; URLs per row/section. Vendor marketing claims are labelled as such.

---

## 0. READ THIS FIRST — what the numbers actually mean

Bulkowski publishes **three independent rank systems** over the same 103 patterns and they are constantly confused with each other:

| Rank system | Range | 1 = | What it measures |
|---|---|---|---|
| **Reversal/continuation rate rank** | 1–103 | most reliable | How often the candle behaves as theory says (e.g. bearish engulfing 79% ⇒ rank 5 on *this* list) |
| **Frequency rank** | 1–103 | most common | How often the pattern prints (black spinning top = 1) |
| **Overall performance rank** | 1–103 | best | Size/durability of the move **after a breakout from the pattern's high/low** |

A pattern can be rank 5 on reliability and rank 91 on performance — bearish engulfing is exactly that. Web summaries that say "bearish engulfing ranks 5 of 103" are quoting the *reversal-rate* list, not performance.

Three further traps, all load-bearing for this build:

1. **"Best percentage meeting price target" is not reliability.** Short white candle: 95% meet target, overall performance rank 85. The target is tiny because the candle is short. Ranking by this column would put the least informative candles on top. Do not use it as a ranking input.
2. **Overall performance rank is conditional on a breakout that has not happened yet.** The screener labels *today's* bar. Bulkowski measures from the day price closes above the pattern's high (or below its low). For a newest-bar label, the **tested reversal/continuation rate** is the honest axis; performance rank is secondary.
3. **All of Bulkowski's and CandleScanner's rates assume the pattern's full identification guidelines were met, including the required prior trend.** A hammer shape with no preceding decline is not the pattern these statistics describe. If the screener detects shape-only, none of these numbers transfer.

Also noted: Bulkowski's own [Top 10 Performing Candlesticks](https://thepatternsite.com/CandlePerformers.html) page lists 10 names but **skips falling window** (whose individual page states overall performance rank 7), so positions 7–10 on that page are shifted one relative to the per-pattern pages. The per-pattern pages are the authority; use those.

---

## (a) MASTER TABLE — Bulkowski measured statistics

Source dataset for every row: Thomas Bulkowski, *Encyclopedia of Candlestick Charts* / thepatternsite.com — **~4.7 million candle lines** across hundreds of stocks, data from the 1980s onward (one page cites "approximately 5 million"). Ranks are out of 103; 1 is best/most frequent.

Columns: **Theory** = what the textbooks claim · **Tested** = what Bulkowski measured (this is the direction the bar actually implies) · **Freq** = frequency rank · **Perf** = overall performance rank · **Target** = best % meeting price target (see trap #1) · **10d** = best average move in 10 days · **n** = sample size where he discloses it.

| Pattern | Theory | Tested (measured) | Freq | Perf | Target | 10d | n | URL |
|---|---|---|---|---|---|---|---|---|
| Three line strike, bearish | bearish continuation | **bullish reversal 84%** | 94 | **1** | 80% | −8.81% | **85** | https://thepatternsite.com/ThreeLineStrikeBear.html |
| Three line strike, bullish | bullish continuation | **bearish reversal 65%** | 95 | **2** | 50% | +16.91% | **69** | https://thepatternsite.com/ThreeLineStrikeBull.html |
| Three black crows | bearish reversal | bearish reversal 78% | 60 | **3** | 36% | +13.31% | 2,660 | https://thepatternsite.com/ThreeBlackCrows.html |
| Evening star | bearish reversal | bearish reversal 72% | 71 | **4** | 50% | +8.77% | — | https://thepatternsite.com/EveningStar.html |
| Upside Tasuki gap | bullish continuation | bullish continuation 57% | 74 | **5** | 38% | −9.20% | 704 | https://thepatternsite.com/UpsideTasukiGap.html |
| Hammer, inverted | bullish reversal | **bearish continuation 65%** | 61 | **6** | 68% | +7.74% | — | https://thepatternsite.com/HammerInv.html |
| Window, falling (gap down) | bearish continuation | bearish continuation 67% (25% stall in gap) | 23 | **7** | — | — | — | https://thepatternsite.com/FallingWindow.html |
| Matching low | bullish reversal | **bearish continuation 61%** | 58 | **8** | 69% | +7.15% | — | https://thepatternsite.com/MatchingLow.html |
| Abandoned baby, bullish | bullish reversal | bullish reversal 70% | 92 | **9** | 71% | −10.31% | **293** | https://thepatternsite.com/AbandonBabyBull.html |
| Two black gapping | bearish continuation | bearish continuation 68% | 29 | **10** | 61% | +6.45% | — | https://thepatternsite.com/TwoBlackGapping.html |
| Breakaway, bearish | bearish reversal | bearish reversal 63% | 98 | 11 | 35% | +6.66% | **36** | https://thepatternsite.com/BearBreakaway.html |
| Morning star | bullish reversal | bullish reversal 78% | 66 | 12 | 49% | −8.53% | — | https://thepatternsite.com/MorningStar.html |
| Piercing pattern | bullish reversal | bullish reversal 64% | 40 | 13 | 67% | −6.57% | — | https://thepatternsite.com/Piercing.html |
| Stick sandwich | bullish reversal | **bearish continuation 62%** | 59 | 14 | 67% | +7.43% | — | https://thepatternsite.com/StickSandwich.html |
| Thrusting | bearish continuation | **bullish reversal 57%** | 56 | 15 | 65% | −5.92% | — | https://thepatternsite.com/Thrusting.html |
| Long day, black | continuation | continuation 53% | 9 | 19 | 62% | +6.3% | — | https://thepatternsite.com/LongBlack.html |
| Three inside up | bullish reversal | bullish reversal 65% | 31 | 20 | 60% | −7.00% | — | https://thepatternsite.com/ThreeInsideUp.html |
| Homing pigeon | bullish reversal | **bearish continuation 56%** | 34 | 21 | 68% | +4.76% | — | https://thepatternsite.com/HomingPigeon.html |
| Dark cloud cover | bearish reversal | bearish reversal 60% | 46 | 22 | 62% | +5.36% | — | https://thepatternsite.com/DarkCloudCover.html |
| Downside Tasuki gap | bearish continuation | **bullish reversal 54%** | 68 | 23 | 44% | +4.69% | — | https://thepatternsite.com/DownsideTasukiGap.html |
| Identical three crows | bearish reversal | bearish reversal 79% | 83 | 24 | 63% | +10.03% | **921** | https://thepatternsite.com/Identical3Crows.html |
| Morning doji star | bullish reversal | bullish reversal 76% | 78 | 25 | 49% | −6.25% | **932** | https://thepatternsite.com/MorningDojiStar.html |
| Tri-star, bullish | bullish reversal | bullish reversal 60% | 79 | 28 | 77% | +5.11% | — | https://thepatternsite.com/TriStarBull.html |
| Evening doji star | bearish reversal | bearish reversal 71% | 81 | 30 | 57% | +6.20% | — | https://thepatternsite.com/EveningDojiStar.html |
| Three white soldiers | bullish reversal | bullish reversal 82% | 67 | 32 | 34% | −7.66% | — | https://thepatternsite.com/ThreeWhiteSoldiers.html |
| Three outside up | bullish reversal | bullish reversal 75% | 24 | 34 | 47% | −7.14% | — | https://thepatternsite.com/ThreeOutsideUp.html |
| Rickshaw man | indecision | continuation 51% (random) | 55 | 35 | 71% | +4.22% | — | https://thepatternsite.com/RickshawMan.html |
| Doji, long legged | indecision / random | bullish continuation 51% (random) | 41 | 37 | 68% | +4.62% | — | https://thepatternsite.com/LongLegDoji.html |
| Harami, bullish | bullish reversal | bullish reversal 53% | 25 | 38 | 69% | +4.05% | — | https://thepatternsite.com/HaramiBull.html |
| Three outside down | bearish reversal | bearish reversal 69% | 21 | 39 | 55% | +6.30% | — | https://thepatternsite.com/ThreeOutsideDown.html |
| Ladder bottom | bullish reversal | bullish reversal 56% | 80 | 41 | 27% | −7.07% | **451** | https://thepatternsite.com/LadderBottom.html |
| Window, rising (gap up) | bullish continuation | bullish continuation 75% | 20 | 42 | — | — | — | https://thepatternsite.com/RisingWindow.html |
| Marubozu, closing black | continuation | continuation 52% | 18 | 43 | 76% | +5.82% | — | https://thepatternsite.com/CloseBlkMarubozu.html |
| Tweezers bottom | bullish reversal | **bearish continuation 52%** | 39 | 44 | 71% | +4.95% | — | https://thepatternsite.com/TweezersBottom.html |
| Takuri line | bullish reversal | bullish reversal 66% | 28 | 47 | 82% | −4.45% | — | https://thepatternsite.com/TakuriLine.html |
| Doji star, bullish | bullish reversal | **bearish continuation 64%** | 53 | 49 | 59% | +5.46% | — | https://thepatternsite.com/DojiStarBull.html |
| Harami cross, bullish | bullish reversal | **bearish continuation 55%** | 47 | 50 | 74% | +4.52% | — | https://thepatternsite.com/HaramiCrossBull.html |
| Doji star, bearish | bearish reversal | **bullish continuation 69%** | 43 | 51 | 55% | −5.77% | — | https://thepatternsite.com/DojiStarBear.html |
| Long day, white | reversal | **continuation 58%** | 10 | 53 | 60% | −6.21% | — | https://thepatternsite.com/LongWhiteDay.html |
| Advance block | bearish reversal | **bullish continuation 64%** | 65 | 54 | 53% | −4.76% | — | https://thepatternsite.com/AdvanceBlock.html |
| Shooting star | bearish reversal | bearish reversal 59% | 37 | 55 | 84% | +3.86% | — | https://thepatternsite.com/ShootingStar.html |
| Three inside down | bearish reversal | bearish reversal 60% | 33 | 56 | 58% | +4.93% | — | https://thepatternsite.com/ThreeInsideDown.html |
| Marubozu, black | continuation | continuation 53% | 30 | 57 | 78% | +5.33% | — | https://thepatternsite.com/BlackMarubozu.html |
| Marubozu, opening black | continuation | continuation 52% | **5** | 58 | 75% | +4.63% | — | https://thepatternsite.com/OpenBlkMaru.html |
| Two crows | bearish reversal | bearish reversal 54% | 64 | 61 | 54% | −4.84% | — | https://thepatternsite.com/TwoCrows.html |
| Belt hold, bullish | bullish reversal | bullish reversal 71% | 22 | 62 | 74% | −5.2% | — | https://thepatternsite.com/BeltHoldBull.html |
| Belt hold, bearish | bearish reversal | bearish reversal 68% | 19 | 63 | 75% | +4.58% | — | https://thepatternsite.com/BeltHoldBear.html |
| Abandoned baby, bearish | bearish reversal | bearish reversal 69% | 96 | 64 | 57% | +5.34% | <20 in bear mkt | https://thepatternsite.com/AbandonBaby.html |
| Hammer | bullish reversal | bullish reversal 60% | 36 | 65 | 88% | −4.12% | — | https://thepatternsite.com/Hammer.html |
| Candle, short black | reversal or continuation | reversal 52% (random) | 50 | 66 | 95% | +3.61% | — | https://thepatternsite.com/BlkCandleShort.html |
| High wave | indecision | reversal 51% (random) | 17 | 67 | 77% | −3.38% | — | https://thepatternsite.com/HighWave.html |
| Candle, white | reversal or continuation | continuation 51% (random) | **4** | 68 | 81% | −4.82% | — | https://www.thepatternsite.com/WhiteCandle.html |
| Spinning top, white | indecision | reversal 50% (random) | **2** | 69 | 83% | −3.63% | — | https://thepatternsite.com/SpinTopWhite.html |
| Marubozu, closing white | continuation | continuation 55% | 15 | 70 | 73% | −5.36% | — | https://thepatternsite.com/ClosingWhiteMarubozu.html |
| Marubozu, white | continuation | continuation 56% | 27 | 71 | 79% | −4.79% | — | https://thepatternsite.com/WhiteMarubozu.html |
| Harami, bearish | bearish reversal | **bullish continuation 53%** | 26 | 72 | 64% | −4.01% | — | https://thepatternsite.com/HaramiBear.html |
| Spinning top, black | indecision | reversal 51% (random) | **1** | 73 | 83% | −3.36% | — | https://thepatternsite.com/SpinTopBlack.html |
| Marubozu, opening white | continuation | continuation 54% | **7** | 75 | 71% | −4.37% | — | https://thepatternsite.com/OpenWhiteMarubozu.html |
| Doji, gravestone | indecision→bearish reversal | bearish reversal 51% (random) | 42 | 77 | 79% | +5.09% | — | https://thepatternsite.com/Gravestone.html |
| Doji, southern | bullish reversal | bullish reversal 52% (near random) | **8** | 78 | 90% | +3.51% | — | https://thepatternsite.com/SouthernDoji.html |
| Harami cross, bearish | bearish reversal | **bullish continuation 57%** | 45 | 80 | 69% | −3.13% | — | https://thepatternsite.com/HaramiCrossBear.html |
| Tweezers top | bearish reversal | **bullish continuation 56%** | 35 | 81 | 65% | −3.21% | ~20,000 | https://thepatternsite.com/TweezersTop.html |
| Candle, black | reversal or continuation | continuation 52% (random) | **3** | 82 | 84% | −6% | — | https://thepatternsite.com/BlkCandle.html |
| Doji, northern | bearish reversal | **bullish continuation 51%** (random) | **6** | 83 | 88% | +3.17% | — | https://thepatternsite.com/NorthernDoji.html |
| Engulfing, bullish | bullish reversal | bullish reversal 63% | 12 | 84 | 67% | −6.31% | — | https://thepatternsite.com/BullEngulfing.html |
| Candle, short white | reversal or continuation | reversal 52% (random) | 54 | 85 | **95%** | −2.62% | — | https://thepatternsite.com/ShortWhiteCandle.html |
| Mat hold | bullish continuation | bullish continuation 78% | 93 | 86 | 67% | −7.21% | **52** | https://thepatternsite.com/MatHold.html |
| Hanging man | bearish reversal | **bullish continuation 59%** | 16 | 87 | 86% | −3.60% | — | https://thepatternsite.com/HangingMan.html |
| Falling 3 methods | bearish continuation | bearish continuation 71% | 91 | 89 | 40% | +4.58% | **64** | https://thepatternsite.com/Falling3Methods.html |
| Engulfing, bearish | bearish reversal | bearish reversal 79% | 11 | 91 | 76% | −5.92% | — | https://thepatternsite.com/BearEngulfing.html |
| Doji, gapping up | bullish continuation | **bearish reversal 57%** | 49 | 92 | 93% | +2.35% | — | https://thepatternsite.com/GappingUpDoji.html |
| Deliberation | bearish reversal | **bullish continuation 77%** | 48 | 93 | 36% | −6.72% | — | https://thepatternsite.com/Deliberation.html |
| Rising 3 methods | bullish continuation | bullish continuation 74% | 88 | 94 | 60% | −5.10% | **102** | https://thepatternsite.com/Rising3Methods.html |
| Kicking, bullish | bullish reversal | bullish reversal 53% (near random) | 100 | 96 | 52% | +2.78% | — | https://thepatternsite.com/KickingBull.html |
| Doji, dragonfly | bullish reversal / indecision | reversal 50% (**pure random**) | 44 | 98 | 80% | −5.02% | — | https://thepatternsite.com/Dragonfly.html |
| Three stars in the South | bullish reversal | bullish reversal **86%** | 99 | **103** | 50% | −3.64% | **9** | https://thepatternsite.com/ThreeStarsSouth.html |

**Bold "Tested" cells = the measured direction contradicts the textbook direction.** By my count 20 of the 77 rows above invert. This is the single most under-appreciated fact in the dataset: inverted hammer is a *bearish continuation* 65% of the time, hanging man is a *bullish continuation* 59%, bearish doji star is a *bullish continuation* 69%, matching low and stick sandwich are *bearish continuations*, tweezers top/bottom both fail their textbook direction.

### Bulkowski's own top-10 lists (three different orderings of the same 103)

**Top 10 by reversal rate** — https://www.thepatternsite.com/CandleReverse.html
1. Three stars in the south 86% · 2. Three line strike bearish 84% · 3. Three white soldiers 82% · 4. Identical three crows 79% · 5. Engulfing bearish 79% · 6. Morning star 78% · 7. Three black crows 78% · 8. Morning doji star 76% · 9. Three outside up 75% · 10. Evening star 72%

**Top 10 by continuation rate** — https://thepatternsite.com/CandleContinue.html
1. Mat hold 78% · 2. Deliberation 77% · 3. Concealing baby swallow 75% · 4. Rising 3 methods 74% · 5. Separating lines bullish 72% · 6. Falling 3 methods 71% · 7. Doji star bearish 69% · 8. Last engulfing top 68% · 9. Two black gapping 68% · 10. Side by side white lines bullish 66%

**Top 10 by overall performance** — https://thepatternsite.com/CandlePerformers.html (see the falling-window omission noted in §0)

### Bulkowski's cross-pattern (meta) findings

Source: "What You Don't Know About Candlesticks", Bulkowski, reprinted at https://sacredtraders.com/what-you-dont-know-about-candlesticks-by-thomas-n-bulkowski/ — figures from the >4.7M candle-line study.

- **Reversals beat continuations 59% to 41%** across pattern types.
- **Bear-market patterns outperform bull-market patterns in 96% of pattern types**, regardless of breakout direction.
- **Height is the dominant performance variable: 96% of tall candles outperformed short ones.** (This is the same finding as for chart patterns.)
- Long shadows outperform: **87% (upper shadows) / 88% (lower shadows)** of the time.
- **Of the 103 candle types, 31% "didn't work."** Requiring a ≥60% reversal-or-continuation rate *plus* adequate frequency, only **24% of 412 tested combinations** qualified; at a ≥66% threshold, only **6%**.
- Position in the yearly range matters more than most pattern identity: of the best-performing candles, **84% originated in the lowest third of the yearly price range**, 11% in the middle third, 5% in the highest third. Worked example (bullish belt hold, bear market, down breakout): lowest third −11.21%, middle −9.35%, highest −7.76%. https://thepatternsite.com/CandlestickTip.html

### Bulkowski's shadow study — directly contradicts textbook wick logic

547 stocks, ~5 years. https://thepatternsite.com/Shadows.html

| Shadow condition | Day +1 up/down | 1 month up/down | Textbook says | Measured |
|---|---|---|---|---|
| Tall **upper** shadow | 360 / 181 | 286 / 261 | bearish (rejection of highs) | **price climbed** |
| Tall **lower** shadow | 158 / 381 | 213 / 333 | bullish (rejection of lows) | **price fell** |
| Short upper shadow | 281 / 258 | 470 / 76 | — | price rose |
| Short **lower** shadow | 483 / 61 | 491 / 55 | — | **strongest up signal measured** |

If the screener's hammer/shooting-star logic is "long wick = rejection = reversal," Bulkowski's raw data says the opposite at the 1-day and 1-month horizons on unconditional samples.

### Bulkowski — tall candles at turning points

466 stocks, Nov 1999–Feb 2007. https://thepatternsite.com/MinorHiLow.html
- Tall candle marked a minor high **39%** exactly, **67% ±1 day** (58,676 samples).
- Tall candle marked a minor low **42%** exactly, **72% ±1 day** (53,391 samples).
- At bull-market minor highs the tall candle was ~72% taller than the trailing 5-day average.

**Implication for the column: a "tall bar" / range-expansion flag is a better turning-point marker than most named 1-bar patterns.**

### Bulkowski — which candles precede chart-pattern breakouts

https://thepatternsite.com/CandleCPBkout.html

| Up breakouts (16,306) | n | % | Down breakouts (11,815) | n | % |
|---|---|---|---|---|---|
| Opening white marubozu | 1,494 | 9.2% | Opening black marubozu | 1,268 | 10.7% |
| Long white day | 1,393 | 8.5% | Southern doji | 1,052 | 8.9% |
| Northern doji | 1,386 | 8.5% | Long black day | 990 | 8.4% |
| Closing white marubozu | 1,003 | 6.2% | Black candle | 660 | 5.6% |
| White marubozu | 944 | 5.8% | Black marubozu | 635 | 5.4% |

Note the self-refuting entry: northern doji is 8.5% of pre-up-breakout bars *and* Bulkowski's own page measures it as 51/49 — it appears there because it is the 6th most common candle on the chart, not because it predicts.

---

## (b) ACADEMIC LITERATURE

### NEGATIVE / NULL RESULTS

**Marshall, Young & Rose (2006) — "Candlestick technical trading strategies: Can they create value for investors?"** *Journal of Banking & Finance* 30(8):2303–2323.
Market/period: **DJIA component stocks, 1 Jan 1992 – 31 Dec 2002.** Method: an extension of the bootstrap that generates random open/high/low/close series (not just closes), so the null preserves intraday structure; 14 candlestick patterns tested. Finding: **"candlestick trading strategies do not have value for DJIA stocks"** — consistent with informational efficiency. This is the canonical negative and the paper whose exit rule ("MYR exit", liquidate at prespecified dates) later studies benchmark against.
https://ideas.repec.org/a/eee/jbfina/v30y2006i8p2303-2323.html · https://www.sciencedirect.com/science/article/abs/pii/S0378426605002116
The same authors' companion study on the **Japanese** equity market also finds no profitability: https://www.researchgate.net/publication/5157791

**Horton (2009) — "Stars, crows, and doji: The use of candlesticks in stock selection."** *Quarterly Review of Economics and Finance* 49:283–294.
Market: **349 S&P 500 stocks**, 8 patterns, compared against buy-and-hold. Finding: stars, crows and doji have **no profitability as price predictors**; the author explicitly does not recommend using them for individual stock selection.

**Duvinage, Mazza & Petitjean (2013) — "The intra-day performance of market timing strategies and trading systems based on Japanese candlesticks."** *Quantitative Finance* 13(7):1059–1070.
Market/period: **30 DJIA constituents, 5-minute bars, 1 Apr 2010 – 13 Apr 2011**, 20,550 observations per stock, performance measured 50 minutes after the pattern. **83 candlestick rules**; ~24,232 rules and systems tested per stock on average; data-snooping corrected with the **stepwise SPA (SSPA)** test.
Results: gross, **56% of bullish-pattern trades and 22% of bearish-pattern trades are profitable**; roughly **one third of the 83 rules beat buy-and-hold gross** at a Bonferroni level; **26–27 of 83 survive on gross returns after snooping correction; only 5 of 83 survive net of costs; zero beat buy-and-hold once a 0.05% friction is applied.** Conclusion: candlesticks have *some* intraday predictive power, but it "is not useful for active portfolio management."
https://ideas.repec.org/p/ajf/louvlr/2013001.html · review with the raw counts: https://www.cxoadvisory.com/technical-trading/testing-japanese-candlesticks-intraday-on-liquid-stocks/

**Jönsson (2016) — "The Predictive Power of Candlestick Patterns: An Empirical Test of Technical Indicators on the Swedish Stock Market Using GARCH-M and Bootstrapping."** Lund University.
Market/period: **29 OMXS30 stocks, 2007–2015.** Finding, verbatim: *"the strategy is not profitable in the short term and has no predictive power."*
https://lup.lub.lu.se/student-papers/search/publication/8877738

**Tharavanij, Siraprapasiri & Rajchamaha (2017) — "Profitability of Candlestick Charting Patterns in the Stock Exchange of Thailand."** *SAGE Open* (open access).
Market/period: **SET50 (50 largest-cap Thai stocks), 3 Jul 2006 – 30 Jun 2016.** Patterns: 1-day (7 bullish + 7 bearish), 2-day (5+5), 3-day (4+4). Two exit conventions — **Marshall–Young–Rose** (liquidate at prespecified dates) and **Caginalp–Laurent** (liquidate at average holding-period prices); holds of 1/3/5/10 days; skewness-adjusted t-tests plus binomial tests.
Findings: **"the mean returns of most patterns are not statistically different from zero"**; the best single result was **opening white marubozu, +0.71% over 10 days with an 8.04% standard deviation**; binomial tests indicate patterns **cannot reliably predict direction**; the measured signal direction frequently **does not match the textbook direction**; **filtering by Stochastics, RSI or MFI generally does not increase profitability.** Transaction costs were not explicitly modelled — i.e. the null result is *before* costs.
https://journals.sagepub.com/doi/full/10.1177/2158244017736799

**Deng et al. (2022) — "Can Japanese Candlestick Patterns be Profitable on the Component Stocks of the SSE50 Index?"** *SAGE Open* 12(3).
Market/period: **SSE50 (China), Jan 2000 – Dec 2018**, 10 patterns, conditioned on trend and overbought/oversold state, bootstrap + out-of-sample.
Findings: **Long White and Bullish Gap produce significant positive average returns** over some holding periods; **none of the bearish patterns examined has predictive power**; gravestone doji is profitable only **as a contrary signal** at 10 days; and critically — **once transaction costs are included, the patterns are not profitable against the random bootstrap series.**
https://ideas.repec.org/a/sae/sagope/v12y2022i3p21582440221117803.html

**ML-era caution.** Search surfaced a rigorous evaluation using normalized signal cross-correlation reporting "little evidence of predictive prowess in standard chartist pictograms," and a CNN line of work where accuracy on raw candlestick images peaks around 0.70 and **adding candlestick-pattern features does not improve over the image alone**. I could not open and verify the specific cross-correlation paper — **treat that one as unverified**; the CNN/DQN papers I did open are about learned representations, not the 103 named patterns.

### POSITIVE / MIXED RESULTS

**Caginalp & Laurent (1998) — "The predictive power of price patterns."** *Applied Mathematical Finance* 5(3–4):181–205.
Market/period: **all S&P 500 stocks, daily OHLC, 1992–1996.** Method: essentially non-parametric; uses standard definitions of **three-day** candlestick patterns and **removes magnitude conditions** (the key design choice — it tests the shape's ordering, not its proportions).
Findings: out-of-sample significance at **~36 standard deviations from the null**, and **~1% profit over a two-day holding period.** Billed as the first large-scale scientific evidence in favour of any chart pattern. Note the horizon: **two days.** Nothing in this paper supports a multi-week edge.
https://papers.ssrn.com/sol3/papers.cfm?abstract_id=932984 · https://econpapers.repec.org/article/tafapmtfi/v_3a5_3ay_3a1998_3ai_3a3-4_3ap_3a181-205.htm

**Lu & Shiu (2012) — "Tests for Two-Day Candlestick Patterns in the Emerging Equity Market of Taiwan."** *Emerging Markets Finance and Trade* 48:41–57.
Market/period: **Taiwan Top 50 Tracker Fund component stocks, 29 Oct 2002 – 31 Dec 2008.** Method: a four-digit-number encoding that enumerates *all* two-day patterns rather than testing only the named ones; buy on bullish pattern, hold until a bearish pattern appears; bootstrap + out-of-sample.
Findings: the Taiwanese market is **not efficient**; **two bullish patterns consistently outperform**; **most existing (textbook) patterns are unprofitable**, and the two profitable ones are **newly identified, not from the textbooks.** That last point is the important one for us.
https://ideas.repec.org/a/mes/emfitr/v48y2012i0p41-57.html

**Lu & Shiu (2016) — "Can 1-day candlestick patterns be profitable on the 30 component stocks of the DJIA?"** *Applied Economics* 48(35):3345–3354.
Market/period: **DJIA 30, Jan 1974 – Dec 2009.** Findings: a **noticeable increase in the predictive power of 1-day patterns beginning in 1992**; several patterns may be profitable; bootstrap-validated. (The 1992 break point is worth noting — it is exactly when Marshall/Young/Rose's null sample begins.)
https://ideas.repec.org/a/taf/applec/v48y2016i35p3345-3354.html

**Lu, Chen & Hsu (2015) — "Trend definition or holding strategy: What determines the profitability of candlestick charting?"** *Journal of Banking & Finance* 61:172–183. Keywords include **Step-SPA test**.
Method: DJIA components; **3 trend definitions × 4 holding strategies**, systematically crossed.
Finding: **eight three-day reversal patterns are profitable under a Caginalp–Laurent holding strategy at 0.5% transaction costs after data-snooping correction — and none are profitable under the Marshall–Young–Rose holding strategy.** Robust to lower costs, subsamples and volatile regimes.
**This is the most important methodological result in the whole literature: the exit rule, not the pattern, determines whether candlesticks "work."** The 2006 null and the 1998/2015 positives are largely the same patterns measured with different holding conventions.
https://ideas.repec.org/a/eee/jbfina/v61y2015icp172-183.html

**Heinz, Jamaloodeen, Saxena & Pollacia (2021) — "Bullish and Bearish Engulfing Japanese Candlestick patterns: A statistical analysis on the S&P 500 index."** *Quarterly Review of Economics and Finance* 79:221–244.
Finding: **bearish engulfing has predictive power measured on open and high prices; bullish engulfing has predictive power measured on open and low prices; neither has predictive power measured on closing prices.**
Same warning as Lu/Chen/Hsu, restated at the level of one pattern: **the measurement convention decides the answer.**
https://ideas.repec.org/a/eee/quaeco/v79y2021icp221-244.html

**Lin, Liu, Yang, Wu & Jiang (2021) — "Improving stock trading decisions based on pattern recognition using machine learning technology."** *PLoS ONE*.
Market/period: Chinese market; train Jan 2000 – Dec 2014, test Jan 2015 – Oct 2020. Method: PRML framework over **169 two-day and 2,197 three-day pattern combinations** plus 11 feature families (MA, EMA, ROC, CCI, momentum, AD, OBV, TR, ATR), with logistic regression, kNN, random forest and RBM.
Findings: two-day patterns predicting one day ahead reach **36.73% average annual return, Sharpe 0.81, IR 2.37**; three-day best strategy 8.29%, more stable; profitable net of **0.2% transaction costs.**
**Caveat that must not be lost: this exhausts the full 169/2,197 combinatorial pattern space with ML feature selection. It is not evidence for the ~40 named textbook patterns; it is evidence that *some* OHLC-shape information exists and that the named patterns are a poor hand-picked subset of it.** Lu & Shiu (2012) reached the same conclusion by a different route.
https://pmc.ncbi.nlm.nih.gov/articles/PMC8345893/

### Literature summary in one line

Every study that tests the **named textbook patterns** with a fixed exit and honest cost/snooping correction finds **no exploitable edge** (Marshall 2006, Horton 2009, Duvinage 2013, Jönsson 2016, Tharavanij 2017, Deng 2022 net-of-cost). Every study that finds an edge either (i) uses a **very short horizon** (Caginalp 2 days), (ii) uses a **specific favourable exit rule** (Lu/Chen/Hsu 2015), (iii) measures on **open/high or open/low rather than close** (Heinz 2021), or (iv) **searches the full combinatorial pattern space** rather than the textbook list (Lu/Shiu 2012, Lin 2021). None of that makes a CANDLE label worthless — it makes it a **descriptive/attention label, not a signal**. Rank it accordingly, and do not let product copy call it a prediction.

---

## (c) BASE RATES / FREQUENCY OF OCCURRENCE

### CandleScanner scan-based frequencies — the most directly usable base rates

Dataset: **S&P 500, 502 symbols, daily candles, 1 Jul 1995 – 30 Jun 2015 — 2,236,421 candlesticks, 638,570 total pattern detections.**
IMPORTANT: their "% of all occurrences" denominator is **total pattern detections (638,570)**, not total bars. Divide by 3.5 to convert to a share of bars (638,570 / 2,236,421 ≈ 28.6% of bars carry ≥1 detection under their pattern set). "Avg frequency" = mean number of candles between occurrences on one symbol — **this is the number that tells you how many of 3,700 rows a label will fill.**

| Pattern | Occurrences | % of detections | 1 per N candles | HIGH eff. (10-bar) | FALSE (10-bar) | URL |
|---|---|---|---|---|---|---|
| Rising window | 36,612 | 5.73% | **61.1** | 42.27% | 18.11% | https://www.candlescanner.com/candlestick-patterns/rising-window/ |
| Bearish engulfing | 34,392 | 5.39% | **65.0** | 37.92% | 16.54% | https://www.candlescanner.com/candlestick-patterns/bearish-engulfing/ |
| Bullish harami | 27,862 | 4.36% | **80.3** | 46.06% | ~20% | https://www.candlescanner.com/candlestick-patterns/bullish-harami/ |
| Bullish engulfing | 27,081 | 4.24% | **82.6** | 44.60% | 17.05% | https://www.candlescanner.com/candlestick-patterns/bullish-engulfing/ |
| Hanging man | 20,388 | 3.19% | **109.7** | 40.29% | 12.95% | https://www.candlescanner.com/candlestick-patterns/hanging-man/ |
| Hammer | 9,944 | 1.56% | **224.9** | 44.24% | 20.53% | https://www.candlescanner.com/candlestick-patterns/hammer/ |
| Dark cloud cover | 4,109 | 0.64% | **544.3** | 36.75% | 16.91% | https://www.candlescanner.com/candlestick-patterns/dark-cloud-cover/ |
| Piercing | 3,207 | 0.50% | **697.4** | 45.25% | 19.33% | https://www.candlescanner.com/candlestick-patterns/piercing/ |
| Morning star | 1,861 | 0.29% | **1,201.7** | 47.34% | 19.56% | https://www.candlescanner.com/candlestick-patterns/morning-star/ |
| Evening star | 1,317 | 0.21% | **1,698.1** | 40.99% | 16.94% | https://www.candlescanner.com/candlestick-patterns/evening-star/ |
| Three black crows | 543 | 0.09% | **4,118.6** | 39.23% | 17.31% | https://www.candlescanner.com/candlestick-patterns/three-black-crows/ |
| Three white soldiers | 365 | 0.06% | **6,127.2** | 44.66% | 13.98% | https://www.candlescanner.com/candlestick-patterns/three-white-soldiers/ |
| Matching high | 155 | 0.02% | **14,428.5** | 36.77% | 12.26% | https://www.candlescanner.com/candlestick-patterns/matching-high/ |

**Translation to a 3,700-name daily scan** (rate = 1/avg-frequency × 3,700):
- Rising window ≈ **61 rows/day** · Bearish engulfing ≈ **57** · Bullish harami ≈ **46** · Bullish engulfing ≈ **45** · Hanging man ≈ **34**
- Hammer ≈ **16** · Dark cloud cover ≈ **7** · Piercing ≈ **5**
- Morning star ≈ **3** · Evening star ≈ **2**
- Three black crows ≈ **0.9/day** (~1 every 1.1 days) · Three white soldiers ≈ **0.6/day** · Matching high ≈ **1 every 4 days**
- Bulkowski-only patterns with freq rank ≥ 90 (mat hold, three line strike, breakaway, rising/falling 3 methods, kicking, three stars in the south) will fire **a handful of times a year across the whole universe.** Budget for the column being empty for those labels most weeks.
- Conversely, the single-bar indecision family (black/white spinning top, black/white candle, opening black/white marubozu, northern/southern doji — Bulkowski frequency ranks 1,2,3,4,5,6,7,8) would, unchecked, **fill essentially every row**.

**The `HIGH efficiency` column is the quiet headline.** Across patterns spanning a 236× range in rarity — from rising window to matching high — the 10-bar HIGH-efficiency rate only moves between **36.8% and 47.3%**, and FALSE only between **12.3% and 20.5%**. A near-flat outcome distribution across wildly different patterns is exactly what you would expect if pattern identity carries little information. This is CandleScanner's own data arguing against CandleScanner's premise, and it is consistent with the academic nulls in §(b). Method note: their efficiency metric is a **stop-loss-gated max-favourable-excursion bucket** (FALSE / LOW / MEDIUM / HIGH) with **user-configurable thresholds**, and they warn the thresholds "may have a great impact on the efficiency readings" — so treat these as ordinal, never as probabilities. https://www.candlescanner.com/candlestick-patterns/how-to-measure-the-efficiency-of-a-candlestick-pattern/ · https://www.candlescanner.com/statistics-module/

### Greg Morris / StockCharts — universe-wide pattern density

Dataset: **all common stocks on NYSE, Nasdaq and AMEX, 13 years from late 1991.** https://articles.stockcharts.com/article/articles-dancing-2016-03-candlestick-analysis--statistics-i
- **Total pattern frequency slightly more than 11% ⇒ one candle pattern about every 8.69 trading days** per symbol.
- **Reversal patterns ≈ 74% of all patterns detected**; reversal patterns occurred ~40× more often than continuation patterns; the pattern set was 65 reversal vs 23 continuation definitions.
- **Five patterns account for ~6.7% of all patterns**; **harami alone is 46% of those five and over 3% of all patterns.**
- Morris's own caveat, quoted: *"when a pattern occurs, you must understand that, statistically, the success or failure does not mean much."*

Note the discrepancy with CandleScanner (11% of bars vs 28.6%): different pattern definition sets and different strictness. **Whichever pattern library the screener adopts, re-measure the base rate on our own universe before setting any threshold — do not inherit either number.**

---

## (d) THE "MOST COMMON PATTERNS ARE THE LEAST INFORMATIVE" PROBLEM

This is empirically confirmed, and by the strongest source available. Bulkowski's frequency-rank vs performance-rank pairs for the eight most common candles:

| Pattern | Freq rank | Tested rate | Perf rank | Bulkowski's own words |
|---|---|---|---|---|
| Spinning top, black | **1** | reversal 51% | 73 | "does not amount to much of anything" |
| Spinning top, white | **2** | reversal 50% | 69 | "I really do not see any benefit to this candle" |
| Candle, black | **3** | continuation 52% | 82 | near-random |
| Candle, white | **4** | continuation 51% | 68 | behaves randomly |
| Marubozu, opening black | **5** | continuation 52% | 58 | "little to offer" |
| Doji, northern | **6** | continuation 51% | 83 | fails its theoretical bearish signal |
| Marubozu, opening white | **7** | continuation 54% | 75 | "acts almost randomly" |
| Doji, southern | **8** | reversal 52% | 78 | "near random" |

**Rank correlation is unmistakable: seven of the eight most common candles sit in the bottom half of the performance table, and every one of them is within 4 points of a coin flip.**

The doji family specifically — Bulkowski's measured reversal/continuation rates:
- Dragonfly doji **50%** (perf rank 98 — sixth worst of 103)
- Gravestone doji **51%** (perf rank 77)
- Northern doji **51%** (perf rank 83)
- Long-legged doji **51%** (perf rank 37 — the only doji with a mid-table performance rank, and it still carries zero directional content)
- Southern doji **52%** (perf rank 78)
- Rickshaw man **51%**, High wave **51%** — same story
- **The one exception is the morning doji star at 76% — but its frequency rank is 78 and Bulkowski found only 932 examples.**

Independent corroboration: Deng et al. (2022) found gravestone doji only worked **as a contrary indicator**; Horton (2009) singled out doji by name as having no predictive value; Tharavanij (2017) found measured signal directions frequently disagree with textbook direction. Bulkowski's own pre-breakout study shows northern doji as the **3rd most common bar before an upward breakout (8.5%)** and southern doji as the **2nd most common before a downward breakout (8.9%)** — a doji precedes moves in *both* directions in proportion to how often it prints, which is the textbook definition of an uninformative feature.

**Design consequence, stated plainly: a doji / spinning top / high wave / short candle label must never outrank a named multi-bar pattern, no matter what the performance-rank column says.** If the ranking is purely additive over (reliability, rarity, performance), long-legged doji scores respectably on rarity and performance and will beat real patterns. The ranking below therefore applies an explicit **information gate** that collapses the score of anything within ~3 points of 50/50.

---

## (e) CONFIRMATION — MEASURED EFFECT

Genuinely thin evidence base. What exists:

**Bulkowski, confirmation-method comparison (>4.7M candle lines).** He tested three ways of confirming a candle signal and reports which one gave the best entry:
- **Opening gap confirmation: 82%** — the next bar's *open* is above (bullish) / below (bearish) the prior close.
- **Candle colour confirmation: 13%**
- **Closing price confirmation: 5%**

His stated reason: opening-gap confirmation introduces **no delay**, whereas colour and close confirmation both require another full day to complete, and the move is largely gone by then. Source: https://sacredtraders.com/what-you-dont-know-about-candlesticks-by-thomas-n-bulkowski/ (reprint of Bulkowski's article; the underlying study is the Encyclopedia dataset).
**Caveat: these three numbers are a share-of-best-outcome split across the three methods, not "82% of confirmed signals work." Do not restate it as a win rate.**

**CandleScanner, test-window length as a proxy for waiting.** Extending the evaluation window from 5 bars to 10 bars lifts HIGH efficiency and cuts FALSE for every pattern measured — morning star 38.59%→**47.34%** HIGH, bullish engulfing 34.91%→**44.60%**, piercing 36.86%→**45.25%**, three white soldiers 33.97%→**44.66%**, hammer 35.21%→**44.24%**, hanging man 30.66%→**40.29%** (FALSE 14.16%→**12.95%**). This is *not* confirmation — it is a longer window to hit the same favourable-excursion bucket, so it is mechanically upward-biased. Cite it as "outcomes improve with horizon," never as "confirmation improves accuracy."

**Bulkowski, contextual conditioning (stronger than confirmation, and measured).** Two conditioning variables move performance far more than any pattern choice does:
- **Yearly range position** — 84% of best-performing candles started in the lowest third of the yearly range vs 5% in the highest third; the belt-hold worked example spans −11.21% to −7.76%, a ~45% swing in outcome from position alone.
- **Height** — 96% of tall candles outperformed short ones; long shadows outperform 87–88% of the time.
- **Market regime** — bear-market instances outperform in 96% of pattern types.

**Academic evidence on filters is negative.** Tharavanij (2017) tested Stochastics, RSI and MFI filters on candlestick reversal patterns and found filtering **"generally does not increase profitability."** Deng (2022) conditioned on trend and overbought/oversold state and still found nothing survives transaction costs. Nison's own position is qualitative — he insists on confirmation and on combining candles with Western tools, but I found **no measured percentage attached to that claim anywhere**; treat "Nison says candles are reliable when confirmed" as doctrine, not data.

**Vendor marketing claims found and flagged as such (do NOT use as evidence):**
- RizeTrade: "Candlestick pattern accuracy improves 15 to 20% when combined with volume analysis." Repeated twice on the page with **no dataset, no period, no sample size, no method** — marketing copy. https://rizetrade.com/candlestick-patterns
- A secondary site attributes "pattern accuracy improves by over 10–15% when combined with market context" to Bulkowski; **I could not find that figure on thepatternsite.com.** Do not cite it.

**Practical conclusion for the column:** the only confirmation mechanic with a measured basis is *the next bar's open gapping in the signal direction* — which by construction cannot be evaluated on the newest bar. So the `CANDLE` column cannot be confirmed at all on the day it is computed. If confirmation is wanted, it must be a **separate, T+1 column** ("confirmed" flag set the following morning), never a modifier baked into the same-day label.

---

## (f) RECOMMENDED NOTABILITY RANKING

### The scoring model

For a screener that must pick ONE label when several match, the label should maximise **information delivered to the reader**, which is not the same as "the pattern with the best backtest." Four components:

```
D  directional information = min(1, |tested_rate − 50| / 30)
      how far the measured behaviour is from a coin flip. Uses Bulkowski's
      TESTED rate (his measured direction), never the textbook direction.

R  rarity / surprisal       = min(1, frequency_rank / 85)
      a rarer label carries more information; capped at 85 so ultra-rare
      patterns don't dominate on rarity alone.

P  measured performance     = (104 − overall_performance_rank) / 103
      size/durability of the post-breakout move. Weighted least, because
      the newest bar has not broken out yet.

S  sample reliability       multiplier from Bulkowski's disclosed n:
      1.00  n ≥ ~2,000 or frequency rank ≤ 65
      0.85  frequency rank 66–80
      0.60  n between ~500 and ~1,000 (explicitly disclosed)
      0.30–0.40  n between ~200 and ~500
      0.20  n < 200
      0.05  n < 20

G  information gate         collapses coin-flip labels:
      0.35  if |tested_rate − 50| ≤ 3
      0.60  if |tested_rate − 50| is 4–6
      1.00  otherwise

NOTABILITY = (45·D + 30·R + 25·P) × S × G      → 0…100
```

Weight justification: **D is weighted highest (45)** because the label's job is to tell a reader something about direction, and Bulkowski's own screen — "does it act as claimed at least 60% / 66% of the time" — is a D-threshold. **R at 30** because a label that fires on 60 of 3,700 rows every single day teaches nothing (§d proves the common labels are the random ones), while a label that fires once a week is worth reading. **P at 25** because the performance rank is real measured data but is conditional on a breakout the screener cannot see yet (§0 trap 2). **S** exists because the top of Bulkowski's performance table is *populated by tiny samples* — three line strike (n=85 and n=69) rank 1 and 2; three stars in the south has the best reversal rate of all 103 (86%) off **9 samples** and the worst performance rank (103). Without S, the ranking is a sample-size artifact. **G** exists because §(d) shows an additive model promotes long-legged doji above real patterns.

### The ranking

| # | Pattern | Score | D | R | P | S | G | Why it sits here |
|---|---|---|---|---|---|---|---|---|
| 1 | **Three black crows** | **78.9** | .93 | .71 | .98 | .90 | 1.0 | 78% bearish reversal, perf rank 3, n=2,660 — the only pattern that is simultaneously strong, well-performing and adequately sampled |
| 2 | **Morning star** | **74.5** | .93 | .78 | .89 | .85 | 1.0 | 78% reversal, perf 12; ~3 rows/day on 3,700 names |
| 3 | **Three white soldiers** | **73.2** | 1.0 | .79 | .70 | .85 | 1.0 | 82% reversal — highest adequately-sampled reversal rate |
| 4 | **Evening star** | **70.0** | .73 | .84 | .97 | .85 | 1.0 | 72% reversal, perf rank 4 |
| 5 | **Hammer, inverted** | **67.8** | .50 | .72 | .95 | 1.0 | 1.0 | perf rank 6 — but **label it as the bearish continuation it measures as**, not as a bullish reversal |
| 6 | **Three outside up** | **62.9** | .83 | .28 | .68 | 1.0 | 1.0 | 75% reversal and common enough to be useful (freq 24) |
| 7 | **Stick sandwich** | **60.7** | .40 | .69 | .87 | 1.0 | 1.0 | perf rank 14; measures as a *bearish continuation* 62% |
| 8 | **Matching low** | **60.3** | .37 | .68 | .93 | 1.0 | 1.0 | perf rank 8; also inverts (bearish continuation 61%) |
| 9 | **Two black gapping** | **60.1** | .60 | .34 | .91 | 1.0 | 1.0 | 68% continuation, perf 10, freq 29 — a genuinely under-used label |
| 10 | **Deliberation** | **60.1** | .90 | .57 | .11 | 1.0 | 1.0 | 77% *bullish continuation* (theory says bearish reversal). High information, low name recognition |
| 11 | Rising window (gap up) | 59.6 | .83 | .24 | .60 | 1.0 | 1.0 | 75% continuation; fires ~61×/day — see gating note below |
| 12 | Piercing pattern | 57.2 | .47 | .47 | .88 | 1.0 | 1.0 | 64% reversal, perf 13, ~5 rows/day |
| 13 | Window, falling (gap down) | 57.2 | .57 | .27 | .94 | 1.0 | 1.0 | 67% continuation, perf 7 |
| 14 | Doji star, bearish | 56.6 | .63 | .51 | .52 | 1.0 | 1.0 | 69% *bullish* continuation — inverts hard |
| 15 | Identical three crows | 55.3 | .97 | .98 | .78 | .60 | 1.0 | 79% reversal but n=921; S is doing real work here |
| 16 | Three inside up | 53.9 | .50 | .37 | .82 | 1.0 | 1.0 | 65% reversal, perf 20 |
| 17 | Doji star, bullish | 53.1 | .47 | .62 | .53 | 1.0 | 1.0 | 64% *bearish* continuation — inverts |
| 18 | Thrusting | 51.9 | .23 | .66 | .86 | 1.0 | 1.0 | perf 15; 57% bullish reversal vs textbook bearish continuation |
| 19 | Three outside down | 51.7 | .63 | .25 | .63 | 1.0 | 1.0 | 69% reversal |
| 20 | Morning doji star | 51.4 | .87 | .92 | .77 | .60 | 1.0 | 76% reversal, n=932 |
| 21 | Dark cloud cover | 51.1 | .33 | .54 | .80 | 1.0 | 1.0 | 60% reversal, perf 22, ~7 rows/day |
| 22 | Engulfing, bearish | 50.5 | .97 | .13 | .13 | 1.0 | 1.0 | 79% reversal (5th best of 103) but perf rank 91 and 57 rows/day |
| 23 | Belt hold, bullish | 49.5 | .70 | .26 | .41 | 1.0 | 1.0 | 71% reversal |
| 24 | Takuri line | 47.7 | .53 | .33 | .55 | 1.0 | 1.0 | 66% reversal — a strictly better-measured hammer variant |
| 25 | Advance block | 47.7 | .47 | .77 | .49 | .85 | 1.0 | 64% *bullish continuation* vs textbook bearish reversal |
| 26 | Belt hold, bearish | 43.7 | .60 | .22 | .40 | 1.0 | 1.0 | 68% reversal |
| 27 | Downside Tasuki gap | 42.2 | .13 | .80 | .79 | .85 | .6 | perf 23; inverts to bullish reversal 54% |
| 28 | Homing pigeon | 41.2 | .20 | .40 | .81 | 1.0 | .6 | perf 21 but 56% — near coin flip |
| 29 | Evening doji star | 39.0 | .70 | .95 | .72 | .50 | 1.0 | 71% reversal, freq 81 — rare, thin sample |
| 30 | Shooting star | 38.5 | .30 | .44 | .48 | 1.0 | 1.0 | only 59% — "this candle looks better than it performs" (Bulkowski) |
| 31 | Three inside down | 38.3 | .33 | .39 | .47 | 1.0 | 1.0 | |
| 32 | Hammer | 37.2 | .33 | .42 | .38 | 1.0 | 1.0 | 60% reversal, perf 65. The most famous candle is mid-table on every axis |
| 33 | Harami cross, bullish | 37.2 | .17 | .55 | .52 | 1.0 | .6 | inverts to bearish continuation 55% |
| 34 | Upside Tasuki gap | 36.4 | .23 | .87 | .96 | .60 | 1.0 | perf rank 5 but only 57% and n=704 |
| 35 | Harami cross, bearish | 32.2 | .23 | .53 | .23 | 1.0 | 1.0 | |
| 36 | Gapping up doji | 30.7 | .23 | .58 | .12 | 1.0 | 1.0 | inverts to bearish reversal 57% |
| 37 | Engulfing, bullish | 28.6 | .43 | .14 | .19 | 1.0 | 1.0 | 63% reversal, perf 84, 45 rows/day — famous, weak |
| 38 | Long day, white | 27.9 | .27 | .12 | .50 | 1.0 | 1.0 | |
| 39 | Downside/other two-bar | ~25 | | | | | | Two crows 23.4, Abandoned baby bullish 24.9 (n=293), Hanging man 23.3 |
| 40 | Tweezers bottom / top | 18.8 / 16.1 | | | | | .6 | both fail their textbook direction |
| 41 | Three line strike (either) | 20.0 | 1.0 | 1.0 | 1.0 | **.20** | 1.0 | **perf ranks 1 and 2 off n=85 and n=69.** Raw score 100; S is the whole story |
| 42 | Short black / short white candle | 17.9 / 16.0 | | | | | .6 | 95% "meet target" — meaningless, target is tiny |
| 43 | Mat hold | 15.3 | .93 | 1.0 | .18 | **.20** | 1.0 | 78% continuation off n=52 |
| 44 | Rickshaw man | 13.2 | .03 | .65 | .67 | 1.0 | **.35** | gate collapses it |
| 45 | Ladder bottom | 12.6 | .20 | .94 | .61 | .40 | .6 | n=451 |
| 46 | Doji, long legged | 11.3 | .03 | .48 | .65 | 1.0 | **.35** | **the gate's main target** — would score 32 without it |
| 47 | Harami, bullish | 10.3 | .10 | .29 | .64 | 1.0 | .35 | 53% = coin flip; ~46 rows/day |
| 48 | Long day, black / Black marubozu | 9.9 / 9.3 | | | | | .35 | |
| 49 | Doji, gravestone | 8.0 | .03 | .49 | .26 | 1.0 | .35 | 51% |
| 50 | Harami, bearish | 7.5 | .10 | .31 | .31 | 1.0 | .35 | 53% |
| 51 | Doji, southern | 7.3 | .07 | .09 | .25 | 1.0 | .6 | freq rank 8 |
| 52 | Doji, dragonfly | 6.1 | .00 | .52 | .08 | 1.0 | .35 | **50%** — exactly a coin flip, perf rank 98 |
| 53 | High wave | 5.8 | .03 | .20 | .36 | 1.0 | .35 | |
| 54 | Candle, black / Candle, white | 5.7 / 4.1 | | | | | .35 | freq ranks 3 and 4 |
| 55 | Three stars in the south | 3.8 | 1.0 | 1.0 | .01 | **.05** | 1.0 | **86% reversal off 9 samples, perf rank 103.** The purest sample-size trap in the dataset |
| 56 | Spinning top, black / white | 3.3 / 3.2 | .03/.00 | .01/.02 | .30/.34 | 1.0 | .35 | **freq ranks 1 and 2** — the floor of the ranking, correctly |
| 57 | Doji, northern | 3.1 | .03 | .07 | .20 | 1.0 | .35 | freq rank 6 |
| 58 | Kicking, bullish | 2.6 | .10 | 1.0 | .08 | .20 | .35 | 53% off a "rare enough that I only included partial statistics" sample |

### Structural rules that override the score

The score is the tie-break, not the whole policy. Four hard rules:

1. **Bar count wins on near-ties.** When a 3-bar and a 1-bar pattern both end on today's bar, prefer the 3-bar label — it strictly contains the 1-bar description. "Morning Star" already tells you the last bar is a white candle; "White Candle" does not tell you it is a morning star. Suggested implementation: `+6` to the score per additional bar in the definition, or a hard precedence tier.
2. **Never let an indecision label beat a named pattern.** Doji (all variants), spinning top, high wave, rickshaw man, short candle, plain black/white candle: these are the **fallback tier only**, shown when nothing else matched. This is not a preference; it is what §(d) measures.
3. **Recognition floor for the canonical six.** Bullish/bearish engulfing, hammer, shooting star, doji, harami are what users search for and what every other screener shows. Bullish engulfing scores 28.6 here and would be silently displaced by, say, "Deliberation" (60.1) — a label most users cannot name. Recommend: if a canonical label matches and the winning label scores less than ~15 points above it, **show the canonical name and expose the other in a secondary/tooltip field.** Never make this rule silent — it should be visible in the data model, not buried in a comparator.
4. **Thin-sample labels need a UI caveat, not exclusion.** Three line strike, mat hold, three stars in the south, breakaway, rising/falling 3 methods, kicking: keep them (they are genuinely rare and interesting when they fire) but S already sinks them, and any tooltip quoting a rank must not quote "rank 1 of 103" without "n=85."

### Two better columns than CANDLE, both measured

If the goal is information rather than nomenclature, Bulkowski's own data says the two highest-value derived flags are **not** pattern names:
- **Candle height / range expansion** — 96% of tall candles outperform short ones; a tall candle marks a minor high 67% ±1 day and a minor low 72% ±1 day (58,676 / 53,391 samples). That beats every 1-bar pattern in the table above.
- **Position in the 52-week range** — 84% of best-performing candles originate in the lowest third.

Both are trivially computable alongside the CANDLE label and are better-supported by the data than most of the labels themselves. Recommend shipping them as companion columns.

---

## (g) SOURCES

**Bulkowski / thepatternsite.com (primary — measured, ~4.7M candle lines)**
- Visual index of all 103 patterns: https://www.thepatternsite.com/CandleVisual.html
- Top 10 overall performers: https://thepatternsite.com/CandlePerformers.html
- Top 10 reversals: https://www.thepatternsite.com/CandleReverse.html
- Top 10 continuations: https://thepatternsite.com/CandleContinue.html
- Yearly-range-position tip: https://thepatternsite.com/CandlestickTip.html
- Shadows study: https://thepatternsite.com/Shadows.html
- Tall candles at turning points: https://thepatternsite.com/MinorHiLow.html
- Candles before chart-pattern breakouts: https://thepatternsite.com/CandleCPBkout.html
- Studies index: https://thepatternsite.com/studies.html
- Per-pattern pages: every URL in the master table §(a)
- Bulkowski, *Encyclopedia of Candlestick Charts* (Wiley): https://onlinelibrary.wiley.com/doi/book/10.1002/9781119202288
- "What You Don't Know About Candlesticks" (Bulkowski article reprint — confirmation split, tall-candle and bear-market findings): https://sacredtraders.com/what-you-dont-know-about-candlesticks-by-thomas-n-bulkowski/
- "Investment Candles" (66% threshold framing): https://sacredtraders.com/investment-candles-by-thomas-n-bulkowski/

**CandleScanner (scan-based base rates — S&P 500, 502 symbols, 2,236,421 candles, 1995–2015)**
- Methodology: https://www.candlescanner.com/candlestick-patterns/how-to-measure-the-efficiency-of-a-candlestick-pattern/ · https://www.candlescanner.com/statistics-module/
- Per-pattern pages: every URL in the table in §(c)

**StockCharts / Greg Morris (universe-wide pattern density)**
- https://articles.stockcharts.com/article/articles-dancing-2016-03-candlestick-analysis--statistics-i

**Academic — negative/null**
- Marshall, Young & Rose (2006), *JBF* 30(8):2303–2323: https://ideas.repec.org/a/eee/jbfina/v30y2006i8p2303-2323.html · https://www.sciencedirect.com/science/article/abs/pii/S0378426605002116
- Marshall, Young & Rose, Japanese equity market companion: https://www.researchgate.net/publication/5157791
- Horton (2009), *QREF* 49:283–294: https://www.researchgate.net/publication/223139330
- Duvinage, Mazza & Petitjean (2013), *Quantitative Finance* 13(7):1059–1070: https://ideas.repec.org/p/ajf/louvlr/2013001.html · https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2125889 · review: https://www.cxoadvisory.com/technical-trading/testing-japanese-candlesticks-intraday-on-liquid-stocks/
- Jönsson (2016), Lund University: https://lup.lub.lu.se/student-papers/search/publication/8877738
- Tharavanij, Siraprapasiri & Rajchamaha (2017), *SAGE Open*: https://journals.sagepub.com/doi/full/10.1177/2158244017736799
- Deng et al. (2022), *SAGE Open* 12(3): https://ideas.repec.org/a/sae/sagope/v12y2022i3p21582440221117803.html

**Academic — positive/mixed**
- Caginalp & Laurent (1998), *Applied Mathematical Finance* 5(3–4):181–205: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=932984
- Lu & Shiu (2012), *EMFT* 48:41–57: https://ideas.repec.org/a/mes/emfitr/v48y2012i0p41-57.html
- Lu, Chen & Hsu (2015), *JBF* 61:172–183: https://ideas.repec.org/a/eee/jbfina/v61y2015icp172-183.html
- Lu & Shiu (2016), *Applied Economics* 48(35):3345–3354: https://ideas.repec.org/a/taf/applec/v48y2016i35p3345-3354.html
- Heinz, Jamaloodeen, Saxena & Pollacia (2021), *QREF* 79:221–244: https://ideas.repec.org/a/eee/quaeco/v79y2021icp221-244.html
- Lin, Liu, Yang, Wu & Jiang (2021), *PLoS ONE*: https://pmc.ncbi.nlm.nih.gov/articles/PMC8345893/

**Flagged as marketing, NOT evidence**
- RizeTrade "accuracy improves 15 to 20% with volume analysis" — no dataset, no method: https://rizetrade.com/candlestick-patterns
- Steve Nison's reliability/confirmation doctrine: qualitative only; **no measured percentage located** in any source consulted.

**Could not verify (do not cite without re-checking)**
- A paper reported (via search snippet) as the "first rigorous statistical evaluation of candlestick patterns using normalized signal cross-correlation," concluding "little evidence of predictive prowess in standard chartist pictograms." The arXiv ID surfaced by search resolved to a different paper on Deep Q-Networks.
- The Fidelity-hosted and Technical Analysis of Stocks & Commodities versions of Bulkowski's "Top 10 Candles That Work" (PDF/403 — content not extractable): https://www.fidelity.com/bin-public/060_www_fidelity_com/documents/Top10CandlesWork_620095.pdf · https://traders.com/Documentation/FEEDbk_docs/2011/06/Bulkowski.html
