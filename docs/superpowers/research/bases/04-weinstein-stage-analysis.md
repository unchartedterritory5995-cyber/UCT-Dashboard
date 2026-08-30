# Stan Weinstein — Stage Analysis (multi-bar base structures)

Scope: multi-bar / multi-week base and trend structures only. Single-, two- and three-bar
candlestick formations are out of scope and are not covered here.

## Sources actually fetched

| # | Title | URL | Type |
|---|---|---|---|
| S1 | *Stan Weinstein's Stage System 1 — Charts and Buying* (7 Circles, chapter-by-chapter reading of the book) | https://the7circles.uk/stan-weinsteins-stage-system-1-charts-buying/ | secondary, book-derived |
| S2 | *Stan Weinstein's Stage System 2 — Refining Buying* (7 Circles) | https://the7circles.uk/stan-weinsteins-stage-system-2-refining-buying/ | secondary, book-derived |
| S3 | *Stan Weinstein's Stage System 3 — Selling and Shorting* (7 Circles) | https://the7circles.uk/stan-weinsteins-stage-system-3-selling-shorting/ | secondary, book-derived |
| S4 | *Stage Analysis Breakout Quality Checklist* (stageanalysis.net) | https://www.stageanalysis.net/blog/4372/stage-analysis-breakout-quality-checklist | primary-adjacent community codification |
| S5 | *Stan Weinstein's Stage Analysis — Definitions of the Stages and Sub-stages* (stageanalysis.net) | https://www.stageanalysis.net/blog/4222/stan-weinsteins-stage-analysis-definitions-of-the-stages-and-sub-stages | Weinstein's own Global Trend Alert sub-stage labels, reproduced |
| S6 | *How to create the Mansfield Relative Performance indicator* (stageanalysis.net) | https://www.stageanalysis.net/blog/4266/how-to-create-the-mansfield-relative-performance-indicator | formula source |
| S7 | Bulkowski, *Four Stages of Price Movement* (thepatternsite.com) | https://www.thepatternsite.com/Stages.html | third-party, with measured trades |
| S8 | Bulkowski, *Trading Weinstein* (thepatternsite.com) | https://thepatternsite.com/TradingWeinstein.html | third-party backtest |
| S9 | Bulkowski, *Weinstein Stops* (thepatternsite.com) | https://thepatternsite.com/WeinsteinStops.html | third-party |
| S10 | *Notes From Recent Interviews With Stan Weinstein* (Next Big Trade, 2022-03-10) | https://www.nextbigtrade.com/2022/03/10/notes-from-recent-interviews-with-stan-weinstein/ | notes on Weinstein's own 2021–22 interview words |
| S11 | *Stage Analysis* (Next Big Trade) | https://www.nextbigtrade.com/stage-analysis/ | secondary |
| S12 | *Stan Weinstein on Super Performance with Sector Selection* (Next Big Trade) | https://www.nextbigtrade.com/2020/11/22/stan-weinstein-on-super-performance-with-sector-selection/ | secondary |
| S13 | Book PDF host — *Stan Weinstein's Secrets For Profiting In Bull And Bear Markets* | https://vdoc.pub/documents/stan-weinsteins-secrets-for-profiting-in-bull-and-bear-markets-66rlu4ttnkh0 | book text (unauthorised host) |
| S14 | Book PDF host (pdfcoffee copy) | https://pdfcoffee.com/secrets-for-profiting-in-bull-and-bear-markets-stan-weinstein-pdf-free.html | book-derived study notes |
| S15 | *Stage 2 breakout (daily proxy): Stan Weinstein's scan* (EdgeStacker) | https://www.edgestacker.com/tools/library/scans/weinstein/stage-2-breakout/ | third-party formalization |
| S16 | *Stan Weinstein Stage Analysis: when to buy* (Deepvue) | https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/ | secondary |
| S17 | *Stan Weinstein's Stage Analysis: The Complete Guide* (tradingmomentum.substack.com) | https://tradingmomentum.substack.com/p/stan-weinsteins-stage-analysis-the | secondary |
| S18 | *Stan Weinstein (Sell Rules)* (financialwisdomtv.com) | https://www.financialwisdomtv.com/post/stan-weinstein-sell-rules | secondary |
| S19 | *Weinstein Stage Analysis vs O'Neil Base Counting* (kasauti.in) | https://kasauti.in/blog/weinstein-stage-analysis-vs-oneil-base-counting/ | secondary, **numerically unreliable — see Conflicts** |
| S20 | *Stage analysis: Weinstein's four stages and the Stage 2 breakout* (Tradecraft) | https://www.tradecraft.academy/learn/stage-analysis | secondary |
| S21 | *Secrets For Profiting in Bull and Bear Markets* (Scribd document copy) | https://www.scribd.com/document/563412658/Secrets-for-Profiting-in-Bull-and-Bear-Markets-Stan-Weinstein | book text host |

Fetch failures (403, content not retrieved): traderlion.com/trading-strategies/stage-analysis/,
traderlion.com/quotes/stan-weinstein-quotes/, chartmill.com Weinstein indicator docs. Anything I
would have taken from those is either omitted or sourced elsewhere and labelled.

**Primary-source caveat that applies to this whole file.** Weinstein's own book,
*Stan Weinstein's Secrets for Profiting in Bull and Bear Markets* (Dow Jones-Irwin, 1988), is not
freely readable in full text online. Everything below that carries a number is traced to the
nearest thing I could reach: (a) verbatim strings recovered from PDF hosts of the book (S13, S14,
S21) and from search-index snippets of those hosts, (b) chapter-by-chapter readings that quote it
(S1–S3), (c) the stageanalysis.net codification (S4–S6), or (d) Weinstein's own recent interview
statements as noted by a third party (S10). Where a number appears ONLY in a codification and not
in the book, I say so in that criterion. Nothing here is inferred, rounded, or averaged.

---

## Stage 1 — The Basing Area

- **origin / source_name**: Stan Weinstein, *Secrets for Profiting in Bull and Bear Markets* (1988),
  the four-stage cycle chapters. Reached via S1, S7, S11, S13. Sub-stage labels (1A / 1 / 1B) are
  Weinstein's own from *Global Trend Alert*, reproduced at S5.
- **definition**: The horizontal trading range that follows a Stage 4 decline. Price stops making
  lower lows and oscillates sideways; the 30-week moving average, having been falling, loses its
  downslope and flattens; price whipsaws across it rather than staying on one side. S7: "Price is
  choppy but usually forming a rectangle or sideways price movement." S11: "The stock forms a long
  horizontal base on the chart. A base is simply a period where the stock moves mostly sideways
  instead of trending higher or lower."
- **criteria**:
  - `MA slope has stopped declining — value: null — "Stock whipsawing around a flattening 30-week MA → basing" (S17, secondary paraphrase; the book's own wording reached at S13 is "the MA must not be declining" for the Stage 2 test, not a published flatness tolerance) — confidence: med`
    - `missing:` a published tolerance for "flat" — e.g. |slope of 30-week SMA over N weeks| < X% — never appears in Weinstein's text. Every screener that implements this invents its own threshold.
  - `base duration — value: null — "It can last from weeks to even years in some cases" (S16); S1 renders the book as "can last months or years" — confidence: high (that no number is published)`
    - `missing:` a minimum number of weeks. Weinstein publishes NO minimum base length anywhere I could reach. The 8-week minimum that circulates ("Stage Analysis includes a base duration filter with an 8-week minimum to block false Stage 2 signals from Stage 4 bounces") is a **screener vendor's filter**, not Weinstein's number.
  - `volume behaviour early in the base — value: null — "Early Stage 1: volume dries up" (S1) — confidence: med`
  - `volume behaviour late in the base — value: null — "Late Stage 1: volume increases without price change" (S1, described there as capitulation/accumulation) — confidence: med`
  - `base size implies move size — value: null — "The bigger the base, the bigger the move." (S2, quoting the book) — confidence: high (as an assertion)`
    - `missing:` any published mapping from base width (weeks) or base height (%) to expected advance. It is stated as a proportionality with no coefficient.
  - `relative strength during the base — value: null — RS "stops falling" (S17); Weinstein's own significance test is the crossover, not a level, see the RS section — confidence: med`
  - `do not buy in Stage 1 — value: n/a — "Avoid Stage 1 positions until breakout occurs" (S11) — confidence: high`
- **measured_performance**: **none published by Weinstein.** Bulkowski (S7) reports his OWN trades
  bucketed by the stage at entry: buying in Stage 1 produced a 13.2% average gain across 127 trades,
  69.3% profitable, drawn from 440 buys and 444 sales spanning April 1987 – February 2010. That is
  Bulkowski's measurement of Bulkowski's trading, not a Weinstein statistic, and S7 publishes no
  benchmark or buy-and-hold base rate beside it — so 69.3% "profitable" cannot be compared to
  anything without knowing the base rate of a random long over 1987–2010.
- **invalidation**: A lower low that breaks the bottom of the range while the 30-week MA is still
  declining returns the name to Stage 4 (S5 explicitly retains a "4B-" label for
  "not yet 'officially' in Stage 1A"). A base is also invalidated as a *buyable* base if the
  30-week MA resumes a downslope.
- **detection_notes**: Requires (1) weekly resampling of daily OHLCV (Weinstein's MA is computed on
  **Friday closes only** per S1 — a same-length daily MA is NOT the same series); (2) a 30-period
  SMA on weekly closes; (3) a slope estimate of that SMA over N weeks — N is *not published*, so it
  is an operator choice; (4) pivot-high / pivot-low detection to bound the range; (5) a weekly
  volume series and a trailing weekly-volume average to see contraction. All computable from daily
  OHLCV. **Not computable from daily OHLCV alone:** nothing in this section, but note the
  "flattening" test has no source-published threshold, so any implementation is a choice, not a
  reproduction.
- **conflicts**: O'Neil/IBD publishes explicit base durations — S19 states O'Neil's base is a
  "Minimum 7 weeks (35 days)" with a "Maximum ~65 weeks", and requires a "Prior uptrend of minimum
  30% before base formation." Weinstein publishes **no** minimum, no maximum, and no prior-uptrend
  requirement. Record both; do not reconcile. O'Neil also imposes base-count sequencing (first base
  best, third base late-cycle) which Weinstein has no analogue for (S19).

---

## The 30-Week Moving Average (the trend referee)

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets* — the single
  central tool of the book. Reached via S1, S9, S13.
- **definition**: A 30-period simple moving average of **weekly closing prices**, plotted on a
  weekly bar chart. S1 is explicit that it is "Based on Friday night closes only (not traditional
  50-day or 150-day MAs)." Weinstein's stage assignment is the relationship of price to this line
  plus the line's slope.
- **criteria**:
  - `MA period — value: 30 weeks — "Draw a 30-week (150-day) simple moving average on charts." (S9) — confidence: high`
  - `MA type — value: simple (not exponential) — "30-week simple moving average" (S9); S1: "Based on Friday night closes only" — confidence: high`
  - `daily-chart equivalent quoted by third parties — value: 150 days — "150-day simple moving average correlates with 30-week MA" (S16); S9 writes it as "30-week (150-day)" — confidence: high that the equivalence is asserted; note S1 explicitly says the Friday-close construction is NOT the same as a 150-day MA`
  - `hard prohibition below the MA — value: n/a — "Stocks trading beneath their 30-week MAs should never be considered for purchase, especially if the MA is declining." (S13, book text) and "Stocks below their 30-week MA should never be bought" (S1) — confidence: high`
  - `mirror prohibition above the MA — value: n/a — "stocks above their 30-week MA should never be shorted" (S1); S3: "Never short above 30-week MA" — confidence: high`
  - `slope requirement for a buy — value: null (a sign test, not a magnitude) — "they must move above their 30-week MA, and the 30-week MA must not be declining." (S2) — confidence: high`
    - `missing:` note the book's buy test is stated as **"must not be declining"** (i.e. flat is acceptable), while the same author's Stage 2 *description* says "rising". These are different thresholds and both are published. See Invalidation.
  - `Weinstein's own later substitution — value: 200-day MA — "Uses the 200dma now more than the 30-week MA and the 50dma" (S10, notes on his 2021–22 interviews) — confidence: med (interview notes, not verbatim transcript)`
  - `secondary MA — value: 10 weeks / 50 days — S4 requires "10-week MA rising" on the weekly chart and "50-day MA above 150-day MA; 50-day MA rising" on the daily; S10: 50dma "used for shorter-term trading" — confidence: high for S4's checklist, med for the book`
- **measured_performance**: none published. Weinstein gives no hit rate for the 30-week MA rule
  itself, and no comparison against a 200-day or any other length.
- **invalidation**: The rule set contains a genuine internal contradiction: S2 renders the buy
  condition as *"the 30-week MA must not be declining"* (flat qualifies) while S4's Stage 2A
  checklist says *"Price above flattening/rising 30-week MA"* (flat qualifies) but Weinstein's
  Stage 2 *narrative* and most secondary renderings say **rising**. A mechanical implementation must
  pick one; picking "rising" is stricter than the book's stated buy test.
- **detection_notes**: Weekly resample of daily bars using the week's last close (Friday, or last
  trading day of the week for holiday weeks — Weinstein does not address holiday weeks). 30-period
  SMA of that series. Slope: `sma[t] - sma[t-N]`, N unpublished. Note that a 150-day SMA of daily
  closes and a 30-week SMA of Friday closes are **different series** and will disagree on stage at
  the margin; S1 flags this and most vendors ignore it. Fully computable from daily OHLCV.
- **conflicts**: Minervini's Trend Template uses **150-day AND 200-day** MAs simultaneously and adds
  an explicit slope duration Weinstein never publishes: "The 200-day moving average line is trending
  up for at least 1 month (preferably 4–5 months minimum in most cases)", plus "The 150-day moving
  average is above the 200-day moving average" and "The 50-day (10-week) moving average is above
  both the 150-day and 200-day moving averages." Weinstein: one MA (30-week), slope test = "must not
  be declining", no minimum slope duration. Record both.

---

## Stage 2 — The Advancing Stage

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets*. Reached via
  S1, S5, S7, S11, S13, S16.
- **definition**: The uptrend. Price has broken up out of the Stage 1 range and thereafter holds
  above the 30-week MA, which has turned up and trails beneath price. S7: "Price breaks out of the
  trading range of stage 1 on impressive volume, which helps power the stock upward, leaving the
  moving average trailing behind." S11: trading "mostly above a rising 30-week moving average."
  S16: "Stage 2: Defined Uptrend above the rising 30-week Moving Average."
- **criteria**:
  - `price structure — value: null — "Higher highs and higher lows" (S17, Stage 2 signature) — confidence: high as an assertion, no count of required swings published`
    - `missing:` how many higher highs / higher lows constitute the structure.
  - `price above the 30-week MA — value: n/a (boolean) — "Price will at all times stay above 30 Week MA" during uptrends (S14) — confidence: med (study-note phrasing of the book; "at all times" is stronger than the book's own tolerance for pullbacks that touch the MA)`
  - `MA slope — value: null — "the 30-week MA must not be declining" (S2) / "a 30-week MA that is rising" (S1) — confidence: high that a sign test is required, low that a magnitude exists`
  - `volume signature within the stage — value: null — "Volume expands during rallies, contracts during pullbacks" (S17) — confidence: med`
  - `relative strength within the stage — value: null — RS line rising / above zero; S4: "Relative performance above zero line (52-week MA); zero line flattening/rising" — confidence: high for the codification, med for the book`
  - `sub-stage labels (Weinstein's own, from Global Trend Alert) — value: n/a — 2A: "Early in uptrend stage. Ideal time to buy aggressively." 2: "Advancing Stage." 2B: "Getting late in uptrend." (S5, verbatim) — confidence: high`
    - `missing:` the boundary between 2A, 2 and 2B is **never given as a computable rule** — no % extension, no week count, no distance-above-MA threshold. S5 publishes the labels and their prose meaning only.
- **measured_performance**: **none published by Weinstein.** Bulkowski (S7) measured his own entries
  in Stage 2 at a 4.1% average gain over 116 trades, 56.9% profitable, from the same 440-buy /
  444-sale April 1987 – February 2010 record — and reports that buying Stage 1 and selling in Stage
  2 was his best combination at 25.9% gain over 62 trades. Note this **inverts** Weinstein's advice
  (Weinstein says buy the Stage 2 breakout, avoid Stage 1). Again: no base rate published beside
  those win rates, so 56.9% is uninterpretable on its own.
- **invalidation**: A close back below the 30-week MA, or the MA rolling over; S10 records Weinstein
  saying "Traders should exit any stock that breaks the 50dma" and that investors should cut back on
  the same event. Loss of higher-highs/higher-lows structure moves the name toward Stage 3.
- **detection_notes**: Weekly close series, 30-week SMA, slope sign, `close > sma`, plus swing
  pivot detection for higher-highs/higher-lows. A relative-strength series against a benchmark is
  required (see the RS section). All computable from daily OHLCV **plus a benchmark series** — the
  benchmark is an extra input, not derivable from the name's own bars. The 2A/2/2B partition is
  **not computable** from any published rule.
- **conflicts**: Minervini's Stage 2 qualification is a hard 8-criterion gate including "current
  stock price is at least 25% above its 52-week low (30% as per his book *Trade Like a Stock Market
  Wizard*)", "within at least 25% of its 52-week high", and "relative strength ranking (as reported
  in Investor's Business Daily) is no less than 70, but preferably in the 90s." Weinstein publishes
  **none** of those three numbers. Record both sets; they are not the same test.

---

## The Stage 2A Breakout — the entry (Investor Method)

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets*, the buying
  chapters. Reached via S2, S4, S13, and search-index snippets of the book PDF hosts (S13/S21).
- **definition**: The buy signal is the move of price up through the top of the Stage 1 resistance
  zone while price is above a non-declining 30-week MA, on expanded volume. Book text via S13:
  the breakout "above the top of the resistance zone and the 30-week MA should occur on impressive
  volume." A search-index snippet of the book defines the breakout itself: *"When the price of a
  stock moves above the top of its resistance zone (12 on the XYZ chart). In this case, the breakout
  would occur at 12½s once the top of the resistance zone is cleared."*
- **criteria**:
  - `price clears the top of the resistance zone — value: the resistance level itself, no buffer beyond the next tick — "the breakout would occur at 12½s once the top of the resistance zone is cleared" (book text via search snippet of S13/S21) — confidence: med (snippet, not a page I rendered in full)`
  - `price above the 30-week MA and MA not declining — value: n/a — "they must move above their 30-week MA, and the 30-week MA must not be declining." (S2) — confidence: high`
  - `breakout must be above the last significant swing high — value: n/a — "Price above last significant swing high (above 30-week MA)" (S4) — confidence: high for S4; this is stageanalysis.net's codification, not book wording`
  - `time under the resistance matters — value: null — "The longer the time spent below the resistance, the more significant is the eventual breakout; and the greater the expansion of volume on the breakout, the more bullish the implications." (book text via search snippet of S13/S21) — confidence: med`
    - `missing:` a minimum number of weeks under resistance. Stated as monotone, never as a threshold.
  - `overhead resistance — value: null in the book; "no overhead resistance from prior 2 years" (S11) and Bulkowski's own codification "Best if none exists for at least four years" (S8) — confidence: low that any of these is Weinstein's published number`
    - `missing:` Weinstein states the principle ("the further back the better") without publishing a lookback in years. The 2-year and 4-year figures come from two different third parties and disagree with each other.
  - `weekly close position — value: n/a — S4 daily-chart line: "Strong close near daily high on breakout day" — confidence: high for S4`
  - `no-chase rule — value: null — "Don't chase a stock that you've missed" (S1) — confidence: high as a rule, no % extension published`
    - `missing:` how far above the breakout is "chasing". No percentage is given.
  - `minimum share price — value: $5 — "$5 per share minimum" (S8, Bulkowski's own codification) — confidence: low as Weinstein's number; high as Bulkowski's`
  - `monthly-chart confirmation — value: price above 30-month MA, breaking to new 12-month highs — S4 monthly lines — confidence: high for S4, absent from the book`
- **measured_performance**: **none published by Weinstein** — no win rate, no average gain, no
  failure rate, no sample. The only measured numbers on a Weinstein-style breakout rule set are
  Bulkowski's (S8), listed in the "Measured tests" section below, and they test *his* codification,
  not Weinstein's text.
- **invalidation**: Breakout on volume that does not expand (see the volume section — this is the
  named cause of false breakouts). Price falling back below the breakout level and then below the
  30-week MA. A breakout in a group that is not itself acting well (see the sector gate).
- **detection_notes**: Needs weekly resampling; pivot-high detection to define the resistance zone
  (Bulkowski's operational form: "I draw a flat (or reasonably so) trendline connecting at least 3
  peaks to locate a base", S8); a breakout test `weekly high > max(pivot highs)` or a buy-stop at
  "a penny above the base (above the most recent peak in the trendline)" (S8); the 30-week SMA and
  its slope; a weekly volume ratio (next section); an overhead-supply scan over an N-year lookback
  where N is unpublished. All computable from daily OHLCV **except** the resistance-zone definition,
  which depends on an unpublished pivot sensitivity, and the overhead-supply lookback, which has no
  published N.
- **conflicts**: O'Neil/IBD's entry is a **pivot point** derived from the pattern (e.g. 10 cents
  above the handle high), with a prior-uptrend requirement of 30% and base depth "10–30% from
  left-side high" (S19). Weinstein has no base-depth limit and no prior-uptrend requirement at all —
  his ideal buy comes out of a Stage 1 base that follows a *decline*, i.e. from a downtrend, which
  is precisely the setup O'Neil's prior-uptrend rule excludes. This is a structural disagreement,
  not a numeric one, and it should be recorded as such.

---

## Breakout volume requirement

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets*; plus his
  own 2021–22 interview statements (S10). Reached via S2, S4, S8, S10, S11, S13.
- **definition**: A Stage 2 breakout is only valid if volume expands. Weinstein publishes the
  requirement as a **multiple of a trailing average**, in two alternative forms (a one-week spike,
  or a multi-week build-up followed by a further increase on the breakout week).
- **criteria**:
  - `form A — one-week volume spike — value: ≥ 2× the average of the previous month — "He wants to see a weekly volume spike that is at least twice the average for the previous month" (S2, reading the book) — confidence: high`
  - `form B — multi-week build-up — value: 3–4 weeks at ≥ 2× the previous average, then a further increase in the breakout week — "A three to four week buildup that is twice the previous average, followed by a further increase on the breakout week." (S2) — confidence: high`
  - `Bulkowski's restatement of the same two forms — value: 2× prior four-week average, OR four-week build-up at 2× the prior three months with breakout volume above the previous week — "Either a one-week spike at least 2x the prior four-week average, or a four-week buildup at least 2x the prior three months with higher breakout volume than the previous week." (S8) — confidence: high as Bulkowski's reading`
  - `stageanalysis.net weekly rule — value: ≥ 2× the four-week average, measured by the END of the breakout week — "Volume at least 2x four-week average by breakout week's end" (S4) — confidence: high for S4`
  - `stageanalysis.net daily rule — value: ≥ 3× the daily average on the breakout day — "Volume at least 3x daily average" (S4) — confidence: high for S4`
  - `stageanalysis.net monthly rule — value: ≥ 2× the four-month average by month end — "Volume at least 2x four-month average by breakout month's end" (S4) — confidence: high for S4`
  - `Weinstein's own current number (interviews) — value: at least 3× normal volume — "Like to see at least 3 times normal volume on the breakout" (S10, notes on his 2021–22 interviews) — confidence: med (paraphrase in notes, and "normal" is not defined by a window)`
    - `missing:` the averaging window behind "normal volume" in the interview statement.
  - `direction of the relationship — value: null (monotone, not a threshold) — "The greater the expansion of volume on the breakout, the more bullish the implications." (S13, book text) — confidence: high`
- **measured_performance**: **none published.** Weinstein gives no measured false-breakout rate with
  and without the volume condition, and no sample. This is the single most consequential gap: the
  volume multiple is the load-bearing filter of the whole method and it has never been published
  with an out-of-sample test by its author.
- **invalidation**: A breakout on flat or contracting volume. S1's paraphrase of the book's logic:
  low-volume breakouts are the false ones. Weinstein's interview form of the same idea is that the
  volume surge is what shows institutional participation (S10, S11).
- **detection_notes**: Weekly volume series (sum of daily volume within the week). Ratio =
  `weekly_volume[breakout week] / mean(weekly_volume[prev 4 weeks])`. For form B you need a build-up
  test: `mean(weekly_volume[last 3..4 weeks]) >= 2 * mean(weekly_volume[the 13 weeks before that])`
  AND `weekly_volume[t] > weekly_volume[t-1]`. All computable from daily OHLCV. **Caveat:** the
  breakout week's volume is only fully known at the week's close, so a "by breakout week's end"
  rule (S4) cannot be evaluated intraweek — a same-week signal is necessarily provisional. The
  daily 3× rule (S4) is computable same-day from daily bars.
- **conflicts**: **This is the sharpest numeric conflict in the file.**
  - Weinstein: **2×** (i.e. +100%) the four-week average on the weekly breakout (S2, S4, S8); **3×**
    normal volume in his own recent interviews (S10).
  - O'Neil: "a day's volume should shoot up at least **40% to 50%** above normal at the pivot point."
  - IBD as an institution: "all breakouts should occur on volume **100% greater** than average daily
    volume although IBD does say that breakouts above **50%** do qualify."
  - S19 asserts both Weinstein AND O'Neil require a "Minimum 50% above 50-day average", differing
    only in whether it is measured on the breakout week or the breakout day. **That is inconsistent
    with every other source for Weinstein**, all of which say 2× (=+100%), not +50%. I record S19's
    claim and flag it as most likely wrong; do not use it.
  - Do not average these. 2× weekly is not the same measurement as +40% daily: different bar
    interval, different baseline window.

---

## Buy on the initial breakout vs. buy on the pullback

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets* — the
  buy-stop / half-position mechanic. Reached via S2, S13, and a search-index snippet of the book.
- **definition**: Weinstein does not choose between the two entries; he **splits the position**. Half
  goes on a resting buy-stop at the breakout price; the other half goes on the pullback toward the
  breakout level, and only if the volume signature confirms — expansion on the break, contraction on
  the pullback.
- **criteria**:
  - `first tranche size — value: half the intended position — "Put in your buy-stop orders for half of your position for those few stocks that meet our buying criteria." (book text via search snippet of S13/S21); S2: "You might place a buy-stop order for half your normal size at the breakout price." — confidence: high`
  - `order type — value: buy-stop, good-'til-canceled — "Use buy-stop orders on a good-'til-canceled (GTC) basis." (book text via search snippet) — confidence: high`
  - `second tranche condition — value: n/a (two-part volume test) — "If volume is favorable on the breakout and contracts on the decline, buy your other half position on a pullback toward the initial breakout." (book text via search snippet); S2: "If the breakout is confirmed by increased volume, buy the other half of your position, ideally on a pullback." — confidence: high`
  - `where the pullback must hold — value: null — "on a pullback toward the initial breakout" (book text via search snippet) — confidence: high that the level is the breakout price; no published tolerance`
    - `missing:` how far below the breakout price a pullback may go and still be a valid add. "Toward" is not a level. Weinstein publishes no % band.
  - `pullback volume — value: null — "Volume should decline on the pullback" (S10, his own interview words) — confidence: med`
    - `missing:` a multiple. "Decline" relative to what window is unstated.
  - `interview-era variant — value: half on the breakout, exit if it fails — "Buy half the position on the breakout, if it doesn't work then sell it" (S10) — confidence: med`
  - `interview-era add-back level — value: the 50-day MA — "Investors can take 25% off when stock is extended, and add more on a dip to the 50dma" (S10); healthy Stage 2 moves "tend to hold the 50dma" (S10) — confidence: med`
  - `position sizing — value: 5% of account — "5% of your account is a good position size to not have a losing position damage the portfolio" (S10) — confidence: med (interview notes)`
  - `portfolio breadth — value: 5–6 stocks under $25K; 10–20 stocks over $100K — "no more than five or six stocks" / "10 to 20 stocks are the most he would invest in at once" (S2) — confidence: high`
- **measured_performance**: **none published.** No comparison of breakout-entry vs pullback-entry
  fill quality, win rate, or slippage appears anywhere in the material I could reach. The 50/50 split
  is asserted as risk management, never measured.
- **invalidation**: If breakout volume is not favorable, the second half is never bought — and by
  S10's interview form, the first half is sold. If the pullback cuts through the breakout level and
  through the 30-week MA, the stop (below the lower of the MA or the minor low) takes the position
  out.
- **detection_notes**: Straightforward from daily OHLCV once the breakout level is known: tranche 1
  triggers on `high >= breakout_level`; tranche 2 needs (a) the breakout week's volume ratio, (b) a
  subsequent retracement to within an unpublished band of `breakout_level`, and (c) declining volume
  on the retracement days. **Not computable without an operator-chosen band** for "toward the initial
  breakout" — that number does not exist in the source.
- **conflicts**: O'Neil/IBD buys at the pivot and treats a pullback below the pivot as damage, with
  a hard "8% below purchase price" sell rule; Weinstein explicitly refuses a percentage stop (see
  the stop section) and treats the pullback as an *adding* opportunity. Record both.

---

## Relative Strength vs. the market (Mansfield Relative Performance)

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets* — RS as one
  of the buy filters; the indicator itself is Mansfield's, which Weinstein used. Formula from S6;
  rules from S1, S2, S4, S13.
- **definition**: The stock's price divided by a benchmark index, normalised by its own long moving
  average and expressed as a percentage oscillator around zero, so it can be screened as
  above/below a zero line. S6 quotes the general definition: "How a given stock (or group) acts in
  relation to the overall market..."
- **criteria**:
  - `formula — value: MRP = ((RP_today / SMA(RP, n)) - 1) * 100, where RP = stock price / index price — "MRP = (( RP(today) / sma(RP(today), n)) - 1 ) * 100" (S6, verbatim) — confidence: high`
  - `parameter, weekly charts — value: n = 52 — "Weekly charts: n = 52" (S6) — confidence: high`
  - `parameter, daily charts — value: n = 200 — "Daily charts: n = 200" (S6) — confidence: high`
  - `benchmark — value: S&P 500 (SPY) — S6/S4 use the S&P 500 as the comparison series; Bulkowski's codification uses "S&P 500" explicitly (S8) — confidence: high`
  - `hard prohibition — value: n/a — "Don't buy stocks where relative strength is negative" (S1) — confidence: high`
  - `mirror prohibition — value: n/a — "Don't short stocks where relative strength is positive" (S1) — confidence: high`
  - `the signal Weinstein weights most — value: the crossover, not the level — "Stan finds the crossover from negative relative strength to positive particularly significant." (S2) — confidence: high`
  - `book statement of the same — value: n/a — the RS line "moves from negative territory (below the zero line) to positive territory" (S13, book text) — confidence: high`
  - `ideal pre-breakout RS shape — value: null — "This indicator should be in negative territory very close to zero till the breakout. During the breakout, it should move from negative to positive area." (S14, book-derived study notes) — confidence: med`
    - `missing:` how close to zero "very close to zero" is. No numeric band is published.
  - `Stage 2A checklist form — value: RP above the zero line, zero line flattening or rising — "Relative performance above zero line (52-week MA); zero line flattening/rising" (S4) — confidence: high for S4`
  - `Stage 2 continuation form — value: RP strongly above zero, zero line rising — "Relative performance strongly above zero line; zero line rising" (S4) — confidence: high for S4; "strongly" is unquantified`
  - `Bulkowski's computable substitute — value: 4-week average price ratio rising week over week — "Stock's 4-week average price divided by S&P 500's same-period price should exceed prior week's ratio." (S8) — confidence: high as Bulkowski's rule, not Weinstein's`
  - `Weinstein's own ranking of RS vs group — value: group agreement outranks RS — RS is "important on breakouts, but 'group agreement on the breakout' is even more critical" (S10) — confidence: med`
- **measured_performance**: none published. No RS-confirmed vs RS-unconfirmed breakout comparison
  with a sample exists in any source I reached.
- **invalidation**: RS still below zero at the breakout, or the zero line (the 52-week MA of the
  ratio) still declining, disqualifies the buy under S4's checklist; under the book's own rule (S1)
  a negative RS is an outright disqualifier.
- **detection_notes**: Requires a **benchmark series aligned to the same bars** — this is the one
  input in the whole method that is NOT derivable from the name's own OHLCV. Build
  `rp[t] = close[t] / benchmark_close[t]` on the weekly series, then
  `mrp[t] = (rp[t] / sma(rp, 52)[t] - 1) * 100`. Note the two published parameterisations (52 weekly
  / 200 daily) do not produce the same series — 200 trading days ≈ 40 weeks, not 52 — so the daily
  and weekly Mansfield lines will disagree on sign near crossovers. That discrepancy is in the
  published parameters themselves, not an implementation error.
- **conflicts**: Minervini/IBD use a **ranked percentile** (RS Rating 1–99, "no less than 70, but
  preferably in the 90s"), which is a cross-sectional rank against the whole universe. Weinstein's
  Mansfield RP is an **absolute** self-normalised ratio with a zero line, which is a within-name
  test. A stock can be Mansfield-positive and IBD-RS-40 at the same time. Record both; they are not
  convertible.

---

## The sector / group gate ("Forest to the Trees")

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets*. Reached via
  S4, S12, S1, S10, and a search-index snippet carrying the book's own comparison.
- **definition**: A three-step top-down funnel: assess the overall market first, then find the
  technically strongest groups, then pick the best charts inside those groups. S4: "Stan Weinstein
  emphasizes three steps: assess market trend (avoid buying in negative trends), identify
  technically strongest sectors ..., and zero in on best individual chart patterns."
- **criteria**:
  - `group effect size — value: 50–75% vs 5–10% — "the favorable chart in the bullish group will often quickly advance 50 to 75 percent while the equally bullish chart in the bearish group may struggle to a 5 to 10 percent gain" (book passage, recovered via search index of the stageanalysis.net rendering, S4) — confidence: med (I could not render the sentence in a fetched page body; it is quoted consistently across sources)`
    - This is an **assertion with no sample size, no period, and no base rate**. It is not a measured statistic. Treat it as rhetoric about magnitude, not as an expectancy.
  - `tie-break rule — value: n/a — "If you're choosing between two breakouts always pick the one in the hot group" (S10, his own interview words) — confidence: med`
  - `group is the dominant factor — value: null — "A few sectors tend to have big returns each year in the markets and often the most important factor for any individual stock is the sector in which they belong." (S12, quoting Weinstein) — confidence: high as a quote, no number attached`
  - `how many names per group — value: top 2–3 stocks per identified sector — "top 2-3 individual Stocks from sectors identified" (S14, book-derived notes) — confidence: med`
  - `diversification constraint — value: null — "You might also recommend that not all your stocks come from a single sector." (S2) — confidence: high; no cap published`
    - `missing:` a maximum % of the portfolio per sector. None is published.
  - `the sector must itself be in Stage 2 — value: n/a — "Sector also in Stage 2" (S11) — confidence: med (secondary codification)`
- **measured_performance**: **none published with a sample.** The 50–75% vs 5–10% figures are the
  closest thing to a performance claim in the entire method, and they are published with **no
  sample size, no date range, and no base rate**. They cannot be validated or compared.
- **invalidation**: The group's own chart failing its Stage 2 test invalidates the individual buy
  regardless of the individual chart's quality — that is the whole point of the funnel.
- **detection_notes**: Requires a **sector/industry classification** and a **sector index series**
  (or an equal-weight composite you build). Then run the identical Stage machinery on the sector
  series. Not computable from a single name's daily OHLCV — needs (a) a group membership map and
  (b) group-level bars. Rank groups by their own Mansfield RP vs the broad index.
- **conflicts**: IBD publishes a group ranking (197 industry groups, "top 40" heuristic) as a
  numbered filter; Weinstein publishes no rank cutoff at all — only "the technically strongest" and
  "the hot group". Record the absence rather than importing IBD's cutoff.

---

## The market gate (weight of evidence / breadth)

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets*, Chapter 8,
  titled (per S4's ecosystem and the stageanalysis.net breadth article) "Using the Best Long Term
  Indicators to Spot Bull and Bear Markets". Reached via search results for
  https://www.stageanalysis.net/blog/17614/timing-the-market-trading-using-breadth-indicators-us-stocks-weight-of-evidence
  (search snippet only — I did not fetch this page body) and S4.
- **definition**: Before any stock decision, judge the market itself by a weight of evidence drawn
  from many breadth indicators, notably the percentage of stocks above their 10-week (50-day) and
  30-week (150-day) moving averages.
- **criteria**:
  - `first step of the funnel — value: n/a — "assess market trend (avoid buying in negative trends)" (S4) — confidence: high`
  - `number of indicators Weinstein used — value: over 50 — "Stan Weinstein was famous for using over 50 different indicators to determine the Weight of Evidence" (stageanalysis.net breadth article, via search snippet) — confidence: low (snippet; and "over 50" is a claim about his practice, not a published list)`
  - `breadth thresholds for investor vs trader buying — value: below 30% for investor buying, above 70% for trader buying — "You want to be doing your investor buying when the percentage is below 30% and then mostly trader buying as it gets overbought near the top over 70%" (stageanalysis.net breadth article, via search snippet) — confidence: low as Weinstein's own numbers; this reads as stageanalysis.net's guidance`
    - `missing:` whether these thresholds are Weinstein's published numbers or the site's. I could not verify against the book.
- **measured_performance**: none published.
- **invalidation**: n/a — this is a gate, not a setup.
- **detection_notes**: Requires a **universe** of names and a per-name 30-week/10-week MA test, then
  a cross-sectional percentage. Not computable from one name's bars. Cheap to compute if you already
  compute the 30-week MA for every name in the universe.
- **conflicts**: none recorded; O'Neil's market gate ("M" in CAN SLIM, follow-through day) is a
  different mechanism entirely and neither publishes a comparable number.

---

## Stage 2 continuation breakout (the "Trader Method" buy point)

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets* — the
  trader's ideal buy; codified as a checklist at S4. Reached via S4, S2, and a search-index snippet
  of the book.
- **definition**: Not the base breakout — a breakout from a *consolidation inside an already
  established Stage 2 uptrend*. Book text via search snippet: *"For a trader, who wants action, the
  ideal time to buy a stock is when it's already above its 30-week MA, when the MA is rising. The
  trader's ideal entry point is after a stock consolidates in a new trading range and pulls back
  close to the moving average, then breaks out again above resistance."*
- **criteria**:
  - `precondition — value: n/a — price already above a rising 30-week MA — "when it's already above its 30-week MA, when the MA is rising" (book text via search snippet) — confidence: high`
  - `the pullback leg — value: null — "pulls back close to the moving average" (book text via search snippet) — confidence: high that the MA is the reference; no distance published`
    - `missing:` how close to the MA. No % band published. S10's interview form substitutes a level: "add more on a dip to the 50dma".`
  - `the trigger — value: n/a — "then breaks out again above resistance" (book text via search snippet) — confidence: high`
  - `MA slope requirement is stronger here than at 2A — value: n/a — S4 continuation checklist: "Strongly rising 30-week MA; 10-week MA rising" (vs 2A's "flattening/rising") — confidence: high for S4`
  - `price must be at new highs — value: n/a — "Price moving to new highs" (S4) — confidence: high for S4`
  - `structure — value: null — "Volatility contraction (ascending triangle, cup-handle)" (S4) — confidence: high for S4; no numeric contraction ratio published`
    - `missing:` a quantified volatility-contraction test (e.g. successive pullback depths). S4 names the shapes only.
  - `volume, weekly — value: ≥ 2× the four-week average, with contraction during the pullbacks and the consolidation — "Volume at least 2x four-week average; contraction during pullbacks and consolidation base" (S4) — confidence: high for S4`
  - `volume, daily — value: ≥ 3× the daily average — "Volume at least 3x daily average" (S4) — confidence: high for S4`
  - `daily MA stack — value: 50-day above 150-day, both rising — "50-day MA above 150-day MA; both rising" (S4) — confidence: high for S4`
  - `RS — value: strongly above zero, zero line rising — "Relative performance strongly above zero line; zero line rising" (S4) — confidence: high for S4; "strongly" unquantified`
  - `risk geometry — value: null — "last swing low close enough for risk/reward" (S4) — confidence: high for S4`
    - `missing:` the R:R ratio required. S4 names the condition and publishes no ratio. Weinstein's book-side constraint is the 15% cap in the stop section.
  - `monthly context — value: price above the 30-month MA, breaking to new multi-year highs — S4 monthly lines — confidence: high for S4`
- **measured_performance**: none published, by Weinstein or by S4. No comparison of the continuation
  entry against the 2A base-breakout entry with a sample exists.
- **invalidation**: Loss of the 50-day MA — S10 records Weinstein saying traders "should exit any
  stock that breaks the 50dma". Failure of the consolidation low. A 30-week MA that stops rising.
- **detection_notes**: Same primitives as the 2A breakout plus: a "pullback to MA" proximity test
  (unpublished band — must be chosen), a "new highs" test over an unpublished lookback, and a
  volatility-contraction measure (S4 names shapes, not numbers, so any implementation is your own).
  All computable from daily OHLCV + a benchmark series. **Not reproducible as published** — this
  setup has more unquantified conditions than the base breakout.
- **conflicts**: Minervini's VCP quantifies exactly what Weinstein leaves as "volatility contraction"
  — successive contractions each roughly half the prior, typically 2–6 of them, with volume drying
  to a specific low. Weinstein publishes **no** contraction count and **no** contraction ratio.
  Record the absence.

---

## Protective stop placement

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets* — the
  selling chapters. Reached via S3, S9, S13, S18.
- **definition**: Stops are placed at **chart structure**, never at an arbitrary percentage. The
  canonical location is beneath the lower of (a) the 30-week MA and (b) the most recent minor
  (reaction) low — and beneath the nearest round number.
- **criteria**:
  - `core placement rule — value: the lower of the 30-week SMA or the minor low — "Keep the stop below the lower of the 30-week simple moving average or the minor low" (S9) — confidence: high`
  - `book statement of the same idea — value: n/a — stops "set right beneath the bottom of the new support level" (S13, book text) — confidence: high`
  - `explicit rejection of percentage stops — value: n/a — "How can 10% or any other percentage be the right level?" (S3, quoting the book) — confidence: high`
  - `but a percentage cap on entry exists — value: 15% — the stop should not be more than 15% below the entry price; a trade whose chart-based stop is further away is not taken (S3) — confidence: med (S3's rendering; I did not see the book's own sentence)`
  - `Bulkowski's harder version of the same cap — value: 20% — "Is the distance from the initial stop location more than 20%? If so, then don't trade it." (S8) — confidence: high as Bulkowski's number, not Weinstein's`
  - `trader's stop — value: just under the closest prior reaction low; backup 4–6% below the breakout point — S3: traders use stops "just under the closest prior reaction low", with a backup rule of 4% to 6% below the breakout point and below the nearest round number — confidence: med (S3's rendering)`
  - `round-number offset — value: place the stop below the whole/half dollar — "Placing the stop below whole dollar amounts, like 10, 11, 12 and half dollars: 0.50." (S9); S9 gives the worked example of moving an 11.03 stop to 10.93 — confidence: high`
  - `Bulkowski's implementation of the offset — value: 7 cents below the round number — "place stops 7 cents below" (S8) — confidence: high as Bulkowski's number`
  - `when to raise — value: only after a correction ends and price approaches (without violating) the 30-week MA and heads to a new high — S3; S9: raise as price climbs toward new highs, never lower — confidence: high`
  - `Stage 3 tightening — value: n/a — "When price goes horizontal in stage 3 and you see the moving average flatten out or trend lower, then tighten up the stop." (S9); S3: in Stage 3 tighten to just below the first considerable retracement rather than the MA — confidence: high`
  - `Bulkowski's trailing rule — value: n/a — "If the SMA flattens out or turns down, raise the stop to the prior minor low" (S8) — confidence: high as Bulkowski's`
  - `corrections to ignore — value: under 7% — S3 says ignore corrections under 7%, and notes the author's own view that 12% is more realistic — confidence: med`
  - `initial stop as an alternative — value: 8% or 10% below purchase (mentioned but not preferred) — "8%, 10% or whatever below the purchase price" (S9), with S9 noting Weinstein prefers chart-based placement — confidence: med`
    - Note the tension: the book rejects percentage stops rhetorically (S3) yet a percentage cap (15%) and a percentage backup (4–6%) both appear. Both are published; both are recorded.
- **measured_performance**: **none published by Weinstein.** No measured stop-out rate, no
  comparison of MA-stop vs minor-low stop vs percentage stop with a sample.
- **invalidation**: n/a — this is the invalidation mechanism.
- **detection_notes**: Needs pivot-low detection to find "the minor low" — the pivot sensitivity is
  unpublished, which is the main source of implementation variance. Needs the 30-week SMA value at
  the time of placement. The round-number offset needs a tick/price-level rule (Weinstein's is
  qualitative; Bulkowski's 7 cents is a concrete substitute). All computable from daily OHLCV.
- **conflicts**: O'Neil's rule is a flat **8% below the purchase price**, applied unconditionally.
  Weinstein explicitly repudiates exactly that form of rule ("How can 10% or any other percentage be
  the right level?", S3) while retaining a 15% cap on the chart-based distance. These are opposite
  philosophies with different numbers: 8% fixed vs "chart structure, capped at 15%". Record both.

---

## Stage 3 — The Top Area

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets*. Reached via
  S5, S7, S9, S11, S16, S17.
- **definition**: The mirror image of Stage 1 at the top. Price goes horizontal, the 30-week MA
  loses its upslope and flattens, and price begins crossing back and forth through it. S11: "The
  stock starts to trend sideways in Stage 3 and lose momentum to the upside. The 30-week moving
  average also loses its upward slope." S7: "Price levels out horizontally while the moving average
  flattens and eventually crosses through it."
- **criteria**:
  - `MA slope — value: null — the 30-week MA "loses its upward slope" / flattens (S11, S7); S16: "The 30-week and 40-week MAs flatten" — confidence: high as a sign test`
    - `missing:` a slope tolerance for "flat".
  - `price behaviour — value: null — price oscillates around the MA rather than holding above it (S17) — confidence: med`
  - `volume — value: null — "Stage 3: usually heavy volume" (S1); S17: "Volume expands on down weeks, shrinks on rallies" — confidence: med`
  - `failed breakouts — value: null — "Breakouts fail or fade quickly" (S17) — confidence: med`
  - `sub-stage labels (Weinstein's own) — value: n/a — 3A: "Looks as if a top is starting to form. Be sure to protect holdings with a close stop." 3: "The Top Area. Start to reduce positions." 3B: "Has become increasingly toppy. Use rallies for at least partial selling." (S5, verbatim) — confidence: high`
  - `action — value: sell half (investor) / all (trader) — S7: "Weinstein says traders should take profits in this stage, but investors can hold on by selling half their position." — confidence: high`
  - `trendline break action — value: sell at least half — when a trendline connecting three or more lows breaks, "sell at least some of your position (say half)" (S3) — confidence: med`
- **measured_performance**: none published.
- **invalidation**: A resumption of higher highs on expanding volume with the 30-week MA turning up
  again returns the name to Stage 2 — Weinstein publishes no rule for how many weeks of flatness
  must elapse before a Stage 3 call is "confirmed", so a Stage 3 label is revocable.
- **detection_notes**: Weekly SMA slope crossing from positive to ~zero; count of weekly closes on
  each side of the MA over a window; comparison of up-week vs down-week volume. All computable from
  daily OHLCV. **The main ambiguity:** Stage 3 and Stage 1 are structurally identical (sideways
  price, flat MA) and are distinguished ONLY by what came before. A stage labeller must carry state.
- **conflicts**: none numeric — neither O'Neil nor Minervini defines a topping stage with published
  thresholds comparable to Weinstein's.

---

## Stage 4 — The Declining Stage (and the breakdown)

- **origin / source_name**: Weinstein, *Secrets for Profiting in Bull and Bear Markets*. Reached via
  S1, S3, S5, S7, S11, S16, S20.
- **definition**: Price breaks down out of the Stage 3 range and thereafter stays below a declining
  30-week MA, which now caps rallies from above. S11: "The stock breaks down below Stage 3 trading
  range and below the 30-week moving average in Stage 4, and continues to decline mostly below the
  30 week moving average." S7: "The moving average usually remains above the stock as price drops."
- **criteria**:
  - `price structure — value: null — "Lower highs and lower lows" (S17) — confidence: high as an assertion`
  - `MA relationship — value: n/a — price below a declining 30-week MA; "Price will at all times stay below the 30 Week MA" during downtrends (S14) — confidence: med (the "at all times" phrasing is study-note, stronger than the book's tolerance for rallies to the MA)`
  - `**volume is NOT required on the breakdown** — value: n/a — "Volume is not the key to this stage because it can be heavy or light as price drops." (S7) and "This is not necessary on the short side." (S3, contrasting with the breakout's volume requirement); S1: "Stage 4: heavy volume not required" — confidence: high`
    - This asymmetry is the single most operationally important Stage 4 rule: **a Stage 2 breakout without volume expansion is disqualified; a Stage 4 breakdown without volume expansion is not.**
  - `hard prohibition — value: n/a — "Never hold a stock that is in a Stage 4 decline as it can lead to major losses" (S11); "take the oath — never hold a stock in Stage 4" (S17) — confidence: high`
  - `never short above the MA — value: n/a — "stocks above their 30-week MA should never be shorted" (S1); S3: "Never short above 30-week MA" — confidence: high`
  - `do not short on RS — value: n/a — "Don't short stocks where relative strength is positive" (S1) — confidence: high`
  - `late entry to a short — value: n/a — if you miss the initial breakdown you can short well into Stage 4, but you need a consolidation pattern and a further breakdown (S3) — confidence: high`
  - `minimum liquidity for a short — value: ~15,000 shares per week — S3 gives a minimum of about 15,000 weekly shares — confidence: med (S3's rendering; the figure reflects 1988 market liquidity and is almost certainly stale)`
  - `things not to short — value: n/a — don't short because of a good run, because the market cap is "too big", or because everyone agrees it must crash ("sucker shorts") (S3) — confidence: high`
  - `sub-stage labels (Weinstein's own) — value: n/a — 4A: "Stock has entered Downtrend Stage. Close out remaining positions." 4: "The Declining Stage. Avoid on the long side." 4B: "Late in downtrend. Much too soon to consider buying." 4B-: "Although not yet 'officially' in Stage 1A, stock has now seen its low for the cycle." (S5, verbatim) — confidence: high`
  - `head-and-shoulders top reliability — value: "around two-thirds of cases" — S3 states the H&S top pattern is confirmed in around two-thirds of cases, and that volume should be lighter on the right shoulder (if heaviest there, the pattern is unreliable) — confidence: med`
    - **This is the only quasi-statistic in Weinstein's material and it is published with NO sample size, NO period, and NO base rate.** Two-thirds of what population, over what years, versus what unconditional decline rate — none of it is given. Do not use it as an expectancy.
- **measured_performance**: **none published** other than the unsourced "two-thirds" above. S17
  cites a Peloton example with a "90% additional collapse" after the Stage 4 breakdown — that is a
  single anecdote from a secondary source, not a statistic, and I record it only to mark it as such.
- **invalidation**: A weekly close back above a 30-week MA that has stopped declining, out of a
  built base, is the Stage 1→2 transition. Weinstein's 4B- label explicitly anticipates a name that
  has bottomed but is not yet officially Stage 1A (S5), i.e. the stage machine deliberately lags the
  actual low.
- **detection_notes**: Weekly close below a declining 30-week SMA, plus a break of the Stage 3
  range low (needs pivot lows). **Do not** apply a volume filter here — the source explicitly says
  volume is not required. All computable from daily OHLCV. The 15,000-shares-per-week liquidity
  floor is computable but should be treated as an obsolete constant, not a rule.
- **conflicts**: The volume asymmetry is a real disagreement with the symmetric treatment most
  modern screeners apply. O'Neil similarly does not require volume on breakdowns but does require it
  on breakouts; Minervini's Trend Template simply excludes Stage 4 names by construction (price
  must be above both the 150- and 200-day MAs and within 25% of the 52-week high), so he publishes
  no Stage 4 criteria to compare.

---

## Measured tests of a codified Weinstein rule set (third-party)

- **origin / source_name**: Thomas Bulkowski, *Trading Weinstein* (S8) and *Four Stages of Price
  Movement* (S7), thepatternsite.com. **This is not Weinstein's data.** Bulkowski wrote his own
  computable version of Weinstein's rules and tested it; and separately bucketed his own real trades
  by entry stage.
- **definition**: Bulkowski's codification: flat trendline through ≥3 peaks to define the base; buy
  stop a penny above the base; 30-week SMA rising with price above it; RS = 4-week average price /
  S&P 500 same-period, rising week over week; volume = one-week spike ≥2× prior four-week average OR
  four-week build-up ≥2× prior three months with breakout volume above the prior week; skip if the
  stop is more than 20% away; minimum $5 share price; no overhead resistance for at least four years.
- **criteria**: (these are Bulkowski's parameter choices, not Weinstein's published numbers — every
  one of them fills a hole where Weinstein published nothing)
  - `base definition — value: ≥3 peaks on a flat trendline — "I draw a flat (or reasonably so) trendline connecting at least 3 peaks to locate a base." (S8) — confidence: high`
  - `entry — value: 1 cent above the base — "Set a buy stop a penny above the base (above the most recent peak in the trendline)." (S8) — confidence: high`
  - `overhead-supply lookback — value: 4 years — "Best if none exists for at least four years." (S8) — confidence: high`
  - `max stop distance — value: 20% — "Is the distance from the initial stop location more than 20%? If so, then don't trade it." (S8) — confidence: high`
  - `min price — value: $5 — (S8) — confidence: high`
- **measured_performance**:
  - **In-sample, 2000-01-01 to 2011-01-01**: average gain **6%**, median gain **6%**, win/loss ratio
    **75%**, maximum loss **−22%**, **448 trades** (S8).
  - **Out-of-sample, 2011-01-01 to 2023-10-24**: average gain **5%**, median gain **6%**, win/loss
    ratio **74%**, maximum loss **−20%**, **330 trades** (S8).
  - Bulkowski's own caveat: "The average gain is low because it's weighed down by trades that made a
    small profit."
  - **Separately**, his live-trade stage buckets (S7): 440 buys and 444 sales, April 1987 – February
    2010; **buy in Stage 1** = 13.2% average gain, 127 trades, 69.3% profitable; **buy in Stage 2** =
    4.1% average gain, 116 trades, 56.9% profitable; **buy Stage 1 + sell Stage 2** = 25.9% gain,
    62 trades.
  - **Base-rate warning:** S8 and S7 publish **no benchmark** beside these — no buy-and-hold return
    over the same window, no random-entry control, no per-trade holding period. A 74–75% win rate
    with a 5–6% average gain and a −20% worst loss is not interpretable without the loss
    distribution and the hold time, neither of which is given. Do not quote the win rate alone.
- **invalidation**: n/a.
- **detection_notes**: This rule set is the closest thing to a directly implementable Weinstein
  screener with a published result. Every parameter is computable from daily OHLCV plus an S&P 500
  series. Note it uses a **daily-bar** RS proxy (4-week average price ratio) rather than the
  Mansfield 52-week weekly oscillator — a different indicator with a different signal timing.
- **conflicts**: Bulkowski's own measurement **contradicts Weinstein's core advice**: Weinstein says
  do not buy in Stage 1, buy the Stage 2 breakout; Bulkowski's trade record shows Stage 1 entries
  outperformed Stage 2 entries 13.2% vs 4.1%. Record both. Bulkowski's sample is his own discretionary
  trading, not a controlled test, so it does not refute Weinstein — but it must not be suppressed.

---

## Operationalizing the four stages

**The bar pipeline.** Everything below assumes daily OHLCV plus (a) a benchmark close series and
(b) a group/sector membership map with group-level bars.

1. **Weekly resample.** Group daily bars by ISO week. `weekly_close` = last close of the week
   (Weinstein's construction is Friday closes, S1 — for holiday-shortened weeks the source is silent,
   so "last trading day of the week" is your choice, not his). `weekly_high` = max daily high,
   `weekly_low` = min daily low, `weekly_volume` = sum of daily volume.
2. **`ma30 = SMA(weekly_close, 30)`.** Do **not** substitute `SMA(daily_close, 150)` and call it the
   same thing — S1 explicitly distinguishes them, and they disagree near stage boundaries. If you
   want a daily-bar view, compute both and expect them to disagree; Weinstein himself moved to the
   **200-day** MA in his later interview practice (S10), which is a *third* series.
3. **`ma30_slope = ma30[t] - ma30[t-N]`.** **N is not published.** This is the first genuine
   ambiguity and it is unavoidable. Common choices are 4 or 5 weeks; none of them is Weinstein's.
4. **Pivots.** Detect swing highs/lows on the weekly series with a fractal/window rule. **The window
   is not published.** This is the second unavoidable choice, and it determines the resistance level,
   the "minor low" for the stop, and the base boundaries.
5. **Volume ratio.** `vol_ratio_w = weekly_volume[t] / mean(weekly_volume[t-4 : t-1])`. Threshold
   **2.0** (S2, S4, S8). Optionally the daily form: `vol_ratio_d = volume[d] / mean(volume[d-50:d-1])`,
   threshold **3.0** (S4) — note S4's 3× daily and 2× weekly are *both* published and are not the
   same test; a breakout can pass one and fail the other.
6. **Relative strength.** `rp = weekly_close / benchmark_weekly_close`;
   `mrp = (rp / SMA(rp, 52) - 1) * 100` (S6). Buy filter: `mrp > 0` and `SMA(rp,52)` not declining.
7. **Group.** Run steps 1–6 on the group index. Require the group to be in Stage 2 (S11) or at least
   prefer the "hot group" on a tie (S10).

**The stage state machine.** Stages 1 and 3 are structurally identical (sideways price, flat MA), as
are the *transitions* out of them. **They can only be told apart by history**, so a stage labeller
must be a state machine, not a per-bar classifier:

```
state = STAGE_4  (or bootstrap from the first 30+52 weeks of data)

STAGE_4 -> STAGE_1  when ma30_slope stops being negative AND price stops making lower lows
                    (no published week count; you must choose one)
STAGE_1 -> STAGE_2  when weekly_close > top-of-range pivot high
                    AND weekly_close > ma30
                    AND ma30_slope >= 0            # book: "must not be declining" (S2)
                    AND vol_ratio_w >= 2.0          # (S2/S4/S8)
                    AND mrp > 0                     # (S1: never buy negative RS)
STAGE_2 -> STAGE_3  when ma30_slope stops being positive AND price goes horizontal
                    (no published tolerance for either)
STAGE_3 -> STAGE_4  when weekly_close < bottom-of-range pivot low AND weekly_close < ma30
                    AND ma30_slope < 0
                    # NO volume condition — S7/S3/S1 are explicit that volume is not required here
STAGE_3 -> STAGE_2  is legal (a failed top); Weinstein publishes no confirmation delay,
                    so the label is revocable
```

Sub-stage refinement (2A vs 2 vs 2B, etc.) is **not implementable from published rules**. S5 gives
Weinstein's own labels and their prose meaning ("Early in uptrend stage. Ideal time to buy
aggressively." / "Getting late in uptrend.") and no computable boundary — no % extension above the
MA, no week count since the breakout, no distance from the 52-week high. The only defensible
mechanical proxy is "2A = the first week of Stage 2" (which is how the stageanalysis.net screener
uses the label), and that is a vendor convention, not Weinstein's definition.

**Where the published rules are genuinely ambiguous — the honest list.**

1. **Slope tolerance.** "Flattening", "rising", "not declining", "strongly rising" (S2, S4) are four
   distinct conditions in the source material with **zero** published thresholds between them. Every
   Weinstein screener in existence invents these.
2. **"Rising" vs "not declining" at the buy.** The book's stated buy test is *"the 30-week MA must
   not be declining"* (S2) — flat qualifies. The Stage 2 *description* everywhere says *rising*.
   These are different gates and both are published.
3. **Base length.** No minimum, no maximum, only "the bigger the base, the bigger the move" (S2)
   with no coefficient. The 8-week minimum in circulation is a vendor filter.
4. **Overhead-supply lookback.** Principle published ("the further back the better"); the number
   is not. Third parties supply 2 years (S11) and 4 years (S8) — they disagree with each other.
5. **"Pullback toward the initial breakout."** No band. You cannot code "toward" without inventing
   a tolerance.
6. **Pivot sensitivity.** The resistance zone, the "minor low" the stop hides under, and the base
   boundaries all depend on a swing-detection window that is never specified.
7. **Weekly 2× vs daily 3×.** Both are published (S4) and they are not equivalent; a name can pass
   the weekly test and fail the daily one on the same breakout.
8. **30-week MA vs 150-day MA vs 200-day MA.** S9 equates the first two; S1 says they are not the
   same construction; S10 says Weinstein now mostly uses the third. All three are "the Weinstein MA"
   depending on which source you read.
9. **Percentage stops.** The book rhetorically rejects them ("How can 10% or any other percentage be
   the right level?", S3) and then publishes a 15% cap and a 4–6% trader backup (S3). Both are real.
10. **Stage 3 vs Stage 1 at a glance.** Identical shape; separable only with state. Any
    per-bar-classifier implementation will mislabel tops as bases.

**What is fully computable from daily OHLCV alone:** the 30-week MA and its slope, price/MA
relationships, pivot highs/lows, base and range boundaries, weekly and daily volume ratios, the
higher-highs/higher-lows structure, and stop levels.

**What is NOT computable from the name's own daily OHLCV:** the relative-strength line (needs a
benchmark series), the sector/group gate (needs a membership map and group-level bars), the market
breadth gate (needs a universe), and — because no rule exists — the 2A/2/2B sub-stage boundaries.
