# Relative Strength knowledge base — 03. What the evidence says, where it fails, and what a tooltip can honestly claim

Research date 2026-11-05. **Verification key.** [V] = read in the primary source (paper text, IBD article, vendor white paper). [S] = secondary source only. [U] = widely repeated, could not verify. Everything not marked [V] must be re-checked before it goes member-facing.

---

## 1. IBD / O'Neil model-book studies

- **"Average RS Rating of 87."** IBD (June 2014): "The average RS Rating among stocks before they break out to new highs and make marvelous price runs is 87. Remember, that's an average." [V] The article gives **no sample size, period, or methodology**. Secondary sources attribute it to "the 500 top-performing stocks 1953–1985" or "IBD research 1950–2008" [S]; both cannot be the same study, so provenance is [U]. https://finance.yahoo.com/news/good-relative-price-strength-precedes-224100448.html
- **The "80 or higher" rule.** IBD is inconsistent: the 2014 piece says "An 80 is a decent score" and IBD's "20 Rules" ask for "at least an 85 RS"; a 2011 piece says "90 or higher." [V] A heuristic, not a tested breakpoint. IBD also warns that stocks emerging from 10–12-month bases can carry RS Ratings "in the 50s to 70s" (CNQ broke out at RS 71). [V]
- **RS line at a new high before the breakout.** IBD (2015): "Even more bullish is when the RS line jumps to new highs before the stock breaks out... the stock often follows." IBD (2011): "That's a sign of real power, but it's **not a precondition** for the breakout to succeed." [V] **No percentages are published anywhere** for how often winners showed an RS-line new high at or before breakout. https://finance.yahoo.com/news/rising-rs-line-integral-stock-230200207.html

## 2. Academic momentum

- **Jegadeesh & Titman (1993).** Buying 3–12-month winners and selling losers earned **~1% per month** over 3–12-month holding periods, 1965–1989; profits dissipate after about a year. Follow-up (2001): momentum earns **–1.55% in January** [S]. https://econpapers.repec.org/RePEc:bla:jfinan:v:48:y:1993:i:1:p:65-91
- **Carhart (1997).** Top minus bottom decile funds by prior-year return: **~8%/yr** spread, ~4.6 points explained by the stocks' factor exposures [S].
- **Asness, Moskowitz & Pedersen, "Value and Momentum Everywhere" (JF 2013)** [V, Table I]. US stocks 1972–2011: momentum P3–P1 spread **5.4%/yr, Sharpe 0.33**; rank-weighted factor **7.7%/yr, Sharpe 0.45**; value–momentum correlation **–0.53 to –0.65**; 50/50 value+momentum Sharpe **0.86** (US). Japan is the exception (Sharpe 0.09–0.13).
- **Daniel & Moskowitz, "Momentum Crashes"** (JFE 2016) [V]. 1947–2006: winner decile excess **16.0%/yr**, loser **–6.1%**, WML Sharpe **1.08** vs market 0.52. The 15 worst WML months 1927–2013 **all occur when the trailing 2-year market return is negative**, 14 of 15 in months the market rose. Worst: **Aug 1932 –74.4%, Jul 1932 –61.0%, Jan 2001 –49.2%, Apr 2009 –45.5%, Mar 2009 –42.3%**. March–May 2009: market +29%, loser decile **+156–163%**, winners +8%. Mechanism: loser-decile beta rises **above 3** after crashes. A dynamic volatility-scaled strategy roughly **doubles the Sharpe**. https://www.ivey.uwo.ca/media/3775547/momentumcrashes.pdf
- **Barroso & Santa-Clara, "Momentum has its moments" (JFE 2015).** Scaling by trailing 6-month realised vol **raises Sharpe 0.53 → 0.97**, cuts excess kurtosis 18.24 → 2.68 [S].
- **Asness, Frazzini, Israel & Moskowitz, "Fact, Fiction and Momentum Investing" (JPM 2014)** [V]. Ten myths rebutted (too small, short-side only, small caps only, costs, taxes, screen-not-factor, disappearing, too volatile, measure-dependent, no theory). Ken French data **1927–2013**: UMD **8.3%/yr, Sharpe 0.50** vs HML 4.7%/0.39, SMB 2.9%/0.26, market 7.7%/0.41. UMD positive in **81% of rolling 1-year and 88% of rolling 5-year windows**. Long side contributes **73.6%** of market-adjusted UMD. Large-cap UMD 6.8%/yr vs small-cap 9.8%. 2004–2013 decade put UMD in the **7th percentile** of rolling 10-year returns. https://www.chesler.us/resources/academia/Fact,%20Fiction%20and%20Momentum%20Investing.pdf

## 3. Practitioner backtests

- **Clenow, *Stocks on the Move* (2015).** Book-period (1999–2014) figures second-hand: **~12.3%/yr, –24% max DD vs S&P ~5.2%, –55%** [S]. Independent point-in-time re-test (Quanterlab): **2006–2014 12.0% vs SPY 7.7%; 2015–2025 7.5% vs SPY 13.4%; 2006–2025 9.5% vs 10.8%**; max DD –30% vs –55%; excluding 2008 the edge disappears; turnover ~5–10×/yr. [V] https://quanterlab.com/research/clenow-s-stocks-on-the-move-tested-apart-ten-years-after-the-book
- **Faber, "Relative Strength Strategies for Investing" (2010)** [V]. Ten sectors 1928–2009, monthly rotation into top 1/2/3 by 1- to 12-month return: works at **every lookback**, beats buy-and-hold in **~70% of years**, "300–600 bps/yr of outperformance"; drawdowns **70–80%** until a 10-month-SMA cash filter cut them to 40–50%. https://mebfaber.com/wp-content/uploads/2018/12/SSRN-id1585517-Relative-Strength-Strategies-for-Investing.pdf
- **Antonacci, Global Equities Momentum.** 1974–2013 backtest: **17.43%/yr, Sharpe 0.87, max DD 22.7%** [S, gross]. ReSolve (2018) found the specification "regressed to the median out of sample" [S].
- **Dorsey Wright, "Point and Figure Relative Strength Signals" (2016)** [V]. Top-1000 US stocks, point-in-time, **includes delisted names**, 1990–2015, RS on 6.5%×3 P&F, monthly equal-weight baskets: **Buy-in-X 13.89%/yr (Sharpe 0.70); Buy-in-O 10.44%; Sell-in-X 7.40%; Sell-in-O 7.85%; S&P 500 TR 9.28%; equal-weight universe 10.85%.** Buy-in-X beat the S&P in **85% of rolling 3-year windows**. Failure years: **2003 (Sell-in-O +69% vs Buy-in-X +34%) and 2009 (+79% vs +29%)**. DWA's live products benchmark RS to the **S&P 500 Equal Weight**. https://nitrogenwealth.com/wp-content/uploads/2022/12/Pnf_RS_Signals_Whitepaper.pdf
- **Gray/Alpha Architect, Quantitative Momentum.** "Frog in the pan" (Da, Gurun & Warachka 2014): momentum concentrated in stocks whose gains came in many small steps; figures differ across versions [S]; a 2006–2025 S&P 500 re-test did **not** reproduce the ordering [S]. Seasonality: momentum loses in January and is strongest around quarter-ends [S].

## 4. Evidence on the RS *line* specifically

**Little rigorous evidence exists.** Searches for forward-return studies of "RS line new high," "RS new high while price below its high," or RS/price divergence turned up only indicator scripts, vendor explainers and single-stock anecdotes. None publishes a sample size, hit rate or excess return. The one quantitative study found:

- **Bulkowski (thepatternsite.com)** [V]: 1,094 stocks from July 1991, **15,763 chart patterns**, RS = close/S&P 500 smoothed by a 22-day SMA. For upward breakouts, the **slope of RS before the pattern or before the breakout barely matters**: average gain 29–34%, failure rate 16–22% across all four rising/falling combinations. What matters is RS **after** the breakout: rising RS post-breakout **+41%** vs falling **+22%**. Pre-breakout RS direction predicts post-breakout direction only **49%** of the time. No significance tests. https://thepatternsite.com/RelativeStrength.html

Implication: the only measured evidence says "RS leading into the breakout" is weak as a *predictor* and strong as a *confirmation*. It does not support "RS new high before price = leading indicator" as a quantified edge. Our own nightly backtest (§c) is the way to find out on our universe.

## 5. Benchmark sensitivity

- Cap-weighted S&P 500 beat its equal-weight twin by **12.4 points in 2023 and ~12 points in 2024**; **78% of constituents underperformed the index** over those two years [V, Lyrical]. Ten names were **35% of index weight** at Q3 2024 [S]. Any RS line vs SPX sloped down for most stocks in 2023–24 because of seven denominators. https://blog.lyricalam.com/insights/2024-us-value-review-letter
- Responses: Dorsey Wright benchmarks RS to the **S&P 500 Equal Weight** [V]; StockCharts suggests QQQ for large-cap tech [S]; IBD's RS Rating is a **cross-sectional percentile**, immune to the denominator problem, while the RS *line* is vs the S&P 500 only [V]. No study quantifies how much RS *rankings* reorder when the benchmark changes; our nightly job can compute rank correlation of RS vs SPX, RSP, QQQ and sector ETF.

## 6. Failure modes

1. **Momentum crashes**: forecastable in state (post-decline, high vol, then a rebound), not in timing. DWA's laggard basket beat leaders by **35–50 points in 2003 and 2009** [V].
2. **Whipsaw in choppy markets**: Morningstar documents momentum lagging in 2022 and 2023; January 2023 was roughly the **10th-worst WML month since 1927** [S]. Clenow's rules lost to SPY 2015–2025 [V].
3. **Late entries / decay**: profits concentrate in months 3–12 and reverse in years 2–3; information-optimal horizon near 3 months [S].
4. **Survivorship bias**: one example cut a momentum CAGR from **46% to 16.4%** once delisted stocks were added [S]. https://quantifiedstrategies.substack.com/p/survivorship-free-momentum-and-trend
5. **Lookahead from adjusted data**: using today's membership or back-adjusted prices for ranks "as of" past dates.
6. **Defensive RS vs leadership**: IBD: "the RS line will rise even if the stock falls" when the S&P falls more [V]. Practitioners separate the two by requiring the stock near a price high or above a rising 200-day, RS new high *and* price new high within N weeks, checking sector composition of the RS leaderboard, and re-ranking at the first follow-through day. A design rule, not evidence.

## 7. Time horizons

- **3–12-month formation** is where the evidence is. Faber found every lookback from 1 to 12 months worked at the sector level [V]; French's UMD and DWA use ~12 months.
- **Skip the most recent month** at the stock level: Jegadeesh (1990) found ~2%/month short-term reversal [S]; hence MOM2–12.
- **Intermediate horizon**: Novy-Marx (2012) finds months **t–12 to t–7** carry most of the predictive power [S]; disputed by Goyal & Wahal (2015).
- **Industry momentum** is strongest at a 1-month lookback (Moskowitz & Grinblatt 1999) [S].
- **Practical read**: a 6–12-month window weighted to the latest quarter with the last month de-emphasised is defensible for a stock RS score; a 20-day RS line is a confirmation tool, not a ranking tool.

---

## (a) Ten numbers for a member-facing tooltip

| # | Statistic | Source | Caveat |
|---|---|---|---|
| 1 | Winners-minus-losers momentum earned **8.3%/yr, Sharpe 0.50**, 1927–2013 (US) | AFIM 2014 [V] | Long-short, gross; a long-only screen captures ~74% |
| 2 | Momentum positive in **81% of rolling 1-yr** and **88% of rolling 5-yr** windows | AFIM 2014 [V] | ~1 in 5 years it loses |
| 3 | Past 3–12-month winners beat losers by **~1%/month** for the next 3–12 months | Jegadeesh & Titman 1993 [S] | Fades after 12 months, partly reverses |
| 4 | P&F RS buy signal in X's returned **13.9%/yr vs 9.3%** S&P, 1990–2015; beat the index in **85% of rolling 3-yr windows** | DWA 2016 [V] | Simulated, equal-weight monthly, no costs |
| 5 | The 15 worst momentum months **all** came after a negative 2-year market return; 2009's loser decile rose **156–163%** vs winners +8% | Daniel & Moskowitz [V] | RS leadership reverses hardest at bear-market bottoms |
| 6 | Volatility-scaling raised Sharpe **0.53 → 0.97** | Barroso & Santa-Clara [S] | Shows the fix, not a chart signal |
| 7 | Sector RS rotation beat buy-and-hold in **~70% of years** by **3–6 pts/yr**, 1928–2009 | Faber 2010 [V] | Drawdowns 70–80% without a trend filter |
| 8 | IBD: average RS Rating of big winners before their runs was **87** | IBD 2014 [V quote, U provenance] | No sample, period or method published |
| 9 | RS direction *before* a breakout changed gains only **29–34%**; RS rising *after*: **+41% vs +22%** | Bulkowski, 15,763 patterns [V] | Not peer-reviewed; no significance tests |
| 10 | **78% of S&P 500 stocks underperformed the index in 2023–24** | Lyrical 2024 [V] | A falling RS line vs SPX then often reflected seven denominators |

## (b) What we can honestly say on the chart, and what we must not

**Defensible:**
- "Stocks that have outperformed over the past 6–12 months have, on average, kept outperforming for the next 3–12 months across many markets and decades (academic momentum: ~8%/yr long-short premium, positive in ~4 of 5 years)."
- "Relative strength is a tendency, not a guarantee. In backtests it loses roughly one year in five and reverses hardest at bear-market bottoms (2003, 2009)."
- "A rising RS line means the stock is beating the benchmark over this window. It can rise while the stock is falling if the benchmark falls faster."
- "Which benchmark you compare to matters. In 2023–24 most S&P 500 stocks lagged the cap-weighted index; compare to equal-weight or the sector to isolate stock-specific strength."
- "RS confirmed after a breakout has historically been associated with larger follow-through (Bulkowski, +41% vs +22%)."
- Our own measured numbers, once produced by the nightly backtest, with sample size and period shown.

**Must not claim:**
- Any specific win rate or forward return for "RS line new high before price" or "blue dot": none is published.
- That RS ≥ 80 (or 85, 90) is a validated threshold.
- That the "87" comes from a defined study with a known sample.
- That RS "predicts" breakouts or is a "leading indicator of institutional buying".
- Backtest numbers from Clenow/Antonacci/DWA/Faber as if live, net-of-cost, or applicable to individual swing trades.
- Frog-in-the-pan or seasonality edges as settled.

## (c) Nightly backtest design for our own universe

**Goal:** for each RS signal the platform shows, publish median and mean excess return, hit rate and sample size at 20/60/120 sessions, split by market regime, recomputed nightly from point-in-time data.

**Signals to tag (binary events on a stock-day):**
1. RS Rating crosses ≥80, ≥90; and decile buckets.
2. RS line makes a 63-, 126-, 252-day high.
3. RS-line new high **while price is ≥5% below its own 252-day high** ("RS leads price").
4. Price 252-day high with RS line **not** at a high (negative divergence).
5. Post-breakout confirmation: price breakout followed by RS-line new high within 10 sessions.
Run each against **three benchmarks**: SPX cap-weight, equal-weight (RSP), and the stock's sector ETF; store nightly rank correlations between the three rankings.

**What to measure per signal, horizon and regime:** forward excess return (stock minus the signal's benchmark, and vs equal-weight as control); median and mean, 25th/75th percentiles, hit rate, baseline for lift; sample size N and **effective N** after de-overlapping (suppress display when effective N < 100); median max adverse excursion; regime splits by benchmark vs 200-day MA, Daniel–Moskowitz "panic" state (trailing 2-year return negative and top-tercile vol), breadth terciles. Report the 2003/2009-type regime separately.

**Universe and data rules (the pitfalls):**
- **Point-in-time membership**, including delisted names with delisting returns.
- **No lookahead in prices**: signals at day t use closes through t; forward returns begin at t+1 and say which.
- **Benchmark as-of**: index total-return series, not a reconstructed ETF.
- **Overlapping samples**: count only the *first* event in a non-overlapping window for display; block-bootstrap CIs internally.
- **Cross-sectional clustering**: report distinct event dates and a date-bootstrap CI; 5,000 events on 40 dates is 40 observations.
- **Survivorship in the rating itself**: percentiles against the point-in-time universe.
- **Costs and tradability**: gross and net (0.2% round trip), ADV floor.
- **Multiple comparisons**: fix definitions in advance; no new variants until six months out of sample.
- **Shrinkage for display**: blend each bucket toward the baseline with weight N/(N+200).
- **Nightly outputs**: per-signal table (benchmark × horizon × regime → median, mean, hit, N, eff-N, dates, CI), a drift check, a benchmark-sensitivity panel. Publish computation date, window and universe size beside every tooltip number.

## (d) As shipped (2026-11-07) — unit 2b-09, the evidence copy

Where each statement of §(b) lives in the product, and what replaces it.

**The mechanics.** A readout card (`RS_LINE_RAW.readout[].card` in `app/src/components/chart/engine/nativeRegistry.js`) carries a static `evidence` line and, on the five signals the nightly backtest measures, an `evidenceSource` of `scalar:evidence.sentence.<key>` (`READOUT_CARD_FIELDS` admits the field; `defSchema` still refuses any other). The chart's About card prints the sentence at that path verbatim when the server envelope carries one (`readoutSchema.cardEvidenceText`, reading the same scalars the readout rows were built from), else the static line. The provider fills `payload.evidence.sentence.<key>` from the pulled `rs/evidence.json` (unit 2b-03): the measured sentence when `per_signal.<signal>.horizons.63.n` clears `method.display_floor_n` (100) and a hit rate exists, the honesty sentence otherwise. So the static line is read only by a chart with no landed envelope; a chart with an envelope and no artifact reads the provider's honesty sentence, which is the same words (`RS_HONESTY_SENTENCE` in the registry and `rs_evidence_pull.HONESTY_SENTENCE` are pinned equal by `tests/test_rs_columns_provider.py`).

| §(b) statement | Card (readout key) | Static line as shipped (card `evidence`) | Replaced by |
|---|---|---|---|
| Past 6–12-month winners kept outperforming for 3–12 months; ~8%/yr long-short; positive ~4 years in 5 (Jegadeesh & Titman 1993; AFIM 2014) | Rating (`rating`) | "The rating is a rank of past return, not a forecast. The nearest evidence is the academic momentum literature (a 12-month return with the last month skipped): past 6 to 12-month winners kept outperforming for the next 3 to 12 months across many markets and decades, about 8% a year long-short and positive in roughly four years of five (Jegadeesh and Titman 1993; Asness, Frazzini, Israel and Moskowitz 2014), with the crash risk the Regime row describes." | Nothing in the v1 artifact (no rating signal). A rating-threshold signal (§(c) item 1) would add `per_signal.<rating signal>` and an `evidenceSource` on this card. The MarketSurge comparison line this card used to carry is on the methodology page ("not yet measured") until fixture set 2 measures it. |
| A tendency, not a guarantee; loses ~1 year in 5; reverses hardest at bear-market bottoms (Daniel & Moskowitz 2016; DWA 2016) | Regime (`regime`) | "Relative strength is a tendency, not a guarantee: in backtests it loses roughly one year in five and reverses hardest at bear-market bottoms. The fifteen worst momentum months since 1927 all came after a negative two-year market return, during rebounds (1932, 2001, 2009), and in 2003 and 2009 the laggards beat the leaders by 35 to 50 points (Daniel and Moskowitz 2016; Dorsey Wright 2016)." | Nothing in v1; the regime split of §(c) would print the 2003/2009-type regime's own hit rate here. |
| A rising RS line means beating the benchmark over the window; it can rise while the stock falls (IBD) | Benchmark (`benchmark`) | "A rising RS line means the stock is beating this benchmark over the window, nothing more: it can rise while the stock is falling if the benchmark falls faster (IBD). Which benchmark you compare against changes the answer; the Benchmarks row reads the same line against SPY, the equal-weight index and the sector." | Stays: a definition, not a measurement. |
| Which benchmark matters; 2023–24, 78% of S&P 500 stocks lagged the cap-weighted index (Lyrical 2024) | Benchmarks (`sensitivity`) | "In 2023 and 2024, 78% of S&P 500 stocks underperformed the cap-weighted index (Lyrical, 2024), so a line falling against SPY while rising against the equal-weight index or the sector separates stock-specific strength from a few giants carrying the index. The nightly test will print the rank correlation of RS across the three benchmarks here." | The three-benchmark rank correlation (§(c)); not in the v1 artifact. |
| RS after the breakout matters, before it barely does: +41% vs +22% (Bulkowski, 15,763 patterns) | Before price (`beforePrice`) | "Bulkowski measured 15,763 chart patterns: the direction of RS before a breakout barely changed the result, while RS rising after the breakout did (an average gain of 41% against 22%). No published hit rate exists for this signal and UCT has not measured one yet." | `payload.evidence.sentence.beforePrice` ← `per_signal.rs_new_high_before_price.horizons.63` (`n`, `hit_rate`, `median_excess`), e.g. "1,284 RS new highs before price from 2025-11-05 to 2026-11-04; 58.3% closed higher than SPY 63 bars later (median +2.1%). Universe as held, survivorship not yet corrected." |
| No published hit rate for the dots (§4); our own numbers once measured | RS high (`rsHigh`), Red day (`redDay`), RS line (`phase`, the 21 EMA cross), Mansfield (`mansfield`) | the honesty sentence: "No published hit rate exists for this signal and UCT has not measured one yet." | `payload.evidence.sentence.<key>` ← `per_signal.{rs_new_high, rs_new_high_red_day, rs_cross_up_21ema, mansfield_cross_up}.horizons.63`, same sentence form. |
| (the four UCT checks) | Checks (`checks`) | "Counts, not signals: six green-on-red days in twenty is unusual, one in twenty is noise. No published hit rate exists for these checks and UCT has not measured them yet." | Not in the v1 artifact. |

The definition's description gained one sentence: "Once the nightly backtest reports, each card's evidence line carries our own measured number with its sample size and dates."

**The methodology page** (`GET /api/screener/methodology`, `rs_columns.evidence`; `api/services/screener/methodology.py::rs_evidence_section`) publishes the five statements with their sources and the card each sits on; the measured-number rule, with the display floor (100) and the horizon (63 bars) read from `rs_evidence_pull` at call time, never retyped; point-in-time reads; the universe as held, survivorship not yet corrected; and the forward return's base: since owner decision N6 (2026-11-07, `reviews/2026-11-07-delegated-decisions.md`) it is the NEXT session's open, the earliest price a member who sees the dot after the close can get, to the horizon's close (`rs_evidence/measure.py` module header). ⚰️ As first shipped the base was the signal bar's own close, which overstated what was tradeable; this paragraph said so until 2026-11-07. A hit rate still reads as what acting at the next open was worth before costs, not as a trade result. It also carries the sentence form, the honesty sentence and a `not_claimed` list that is the must-not-claim list of §(b).

**Revised 2026-11-07 (Wave V, unit VA3).** The measured sentence now also prints a 95% Wilson interval on the hit rate, computed on the effective sample (the smaller of events and sessions, because events on one day are not independent), in the words "likely between"; and, when any counted names had an unknown split list, "Stock splits not yet checked for N names." A number prints only when the events reach 100 AND span at least 100 sessions whose 63-bar window is complete (`rs_evidence_pull.MIN_EVENT_DATES`). Below that the card says "UCT measured N events on M sessions, too few to print a hit rate: it needs at least 100 events on at least 100 different sessions." rather than the honesty sentence, which would be false once a signal has been measured. The honesty sentence stays for signals with no measurement at all. Example: "1,284 RS new highs before price on 240 sessions, 2025-11-05 to 2026-11-04, daily bars: 58.3% (likely between 52.0% and 64.4%) beat SPY from the next session's open to the close 63 sessions later (about 3 months; median +2.1%), against 50.2% for all bars. Universe as held, survivorship not yet corrected."

**Not done here, by design.** The Rating, Regime, Benchmark and Benchmarks lines stay literature until the artifact grows the signals that would measure them (§(c) items 1, 4 and 5 and the regime split). The survivorship correction is 2b-01's `delisted_registry` count, still "not yet corrected" in the sentence until the job applies it. No browser render was made of the cards; the DOM is pinned by `StockChart.rsReadout.test.jsx` (measured sentence verbatim, honesty sentence, static fallback, no line).

---

### Primary sources read
Daniel & Moskowitz (Momentum Crashes draft) · Asness et al. (Fact, Fiction and Momentum Investing) · Asness, Moskowitz, Pedersen (Value and Momentum Everywhere) · Faber (Relative Strength Strategies for Investing) · Dorsey Wright (P&F RS Signals 2016) · IBD articles via Yahoo Finance · Bulkowski (thepatternsite.com) · Quanterlab Clenow re-test · Lyrical 2024 letter.

### Secondary only
CXO on AFIM and GEM · Barroso & Santa-Clara (SSRN) · Carhart 1997 · Novy-Marx 2012 · Frog in the pan (Da et al.; Alpha Architect) · survivorship example (Quantified Strategies) · Morningstar 2023 momentum · Robeco 2023 · ReSolve on GEM · The Chartist Clenow table.
