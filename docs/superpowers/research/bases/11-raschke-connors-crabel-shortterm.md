# The Short-Term Structural School — Raschke / Connors / Crabel

Scope: multi-bar structure and volatility-contraction mechanics. Individual candlestick names
(hammer, doji, engulfing, etc.) are out of scope and covered elsewhere.

## Sources actually fetched

**Primary (author's own text):**

1. **Laurence A. Connors & Linda Bradford Raschke, _Street Smarts: High Probability Short Term
   Trading Strategies_ (M. Gordon Publishing Group, 1995)** — full book text retrieved and
   text-extracted (`pdftotext -layout`) from
   <https://dl.fxf1.com/books/english/Street%20Smarts%20(Laurence%20Connors).pdf>.
   All Street Smarts quotes below are from this extraction. **Caveat:** the Appendix
   (Moore Research statistical studies, Historical Oops Buy/Sell Reports, WR7 tables —
   listed in the book's own contents at pp. 203–239) is **NOT present** in this extraction;
   the text ends at p. 140. So the book's own statistical tables could not be read.
2. **Linda Bradford Raschke, interviewed by David Vomund, "Linda Bradford Raschke on Short Term
   Trading Strategies," _AIQ Opening Bell Monthly_, Vol. 6 Issue 8, August 1997** — hosted on
   Raschke's own site, <https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf>
   (retrieved and text-extracted). Reproduces the Holy Grail and Three-Day Unfilled Gap Reversal
   rule sets and Wolfe Wave construction in boxed form.
3. **Linda Bradford Raschke — articles index**, <https://lindaraschke.net/articles/> (fetched).
4. **Toby Crabel, _Day Trading with Short Term Price Patterns and Opening Range Breakout_
   (Traders Press, 1990)** — book **excerpts** (not the full text) at
   <https://pdfcoffee.com/crabel-toby-day-trading-with-short-terms-patterns-pdf-free.html>.
   Quotes marked "Crabel, excerpt" below come from this. The full text and its statistical
   tables could not be retrieved; scribd / pdfroom / dokumen.pub / pdfcoffee download endpoints
   and archive.org all failed to return book text.

**Secondary (explicitly labelled as such at each point of use):**

5. Time-Price-Research (astrofin) blog, "Definition of Price Patterns | Toby Crabel," Apr 2012 —
   <https://time-price-research-astrofin.blogspot.com/2012/04/toby-crabel-definition-of-patterns.html>
   — a **software-vendor-style restatement** of Crabel's pattern set (NR/NR4/NR5/NR7, WS/WS4/WS7,
   ID, OD, hooks, 2BNR/3BNR/4BNR/8BNR, Stretch, ORB). Not Crabel's own words.
6. Time-Price-Research (astrofin), "From Contraction to Breakout to Expansion," Dec 2018 —
   <https://time-price-research-astrofin.blogspot.com/2018/12/contraction-breakout-expansion-toby.html>
   — confirmed on fetch to contain **no verbatim Crabel quotes**, paraphrase only.
7. Oxford Capital Strategies — independent futures-portfolio backtests, with stated universe and
   date range: NR7 <https://oxfordstrat.com/trading-strategies/nr7/>;
   Turtle Soup Plus 1 <https://oxfordstrat.com/trading-strategies/turtle-soup-plus-1/>;
   Crabel 2-Bar NR <https://oxfordstrat.com/trading-strategies/toby-crabel-narrow-range-1/>.
8. Easycators, "Double 7s Trading Strategy … from _Short Term Trading Strategies That Work_" —
   <https://easycators.com/thinkscript/connors-alvarez-double-7s-trading-strategy-for-thinkorswim-from-short-term-trading-strategies-that-work/>
   — quotes the book's own results table verbatim.
9. Easycators, "3 Day High Low Trading Strategy" —
   <https://easycators.com/thinkscript/3-day-high-low-trading-strategy/> — rules and results are
   **images only**; no machine-readable numbers.
10. Cesar Alvarez (Connors' former Director of Research), "Double 7's Strategy" —
    <https://alvarezquanttrading.com/blog/double-7s-strategy/> — states the book's rules; his
    numbers are his own re-tests, not the book's.
11. The Robust Trader, "Larry Connors' Double Seven Strategy" —
    <https://therobusttrader.com/larry-connors-double-seven-strategy/>.
12. RoboForex blog, "Larry Connors' Double 7 Trading Strategy" —
    <https://roboforex.com/blog/blog/2023/02/24/larry-connors-double-7-trading-strategy/>.
13. LuxAlgo Library, "Turtle Soup" — <https://www.luxalgo.com/library/concept/turtle-soup/>.
14. Easycators strategy index — <https://easycators.com/?s=connors>.
15. PDFRoom / PDFCoffee / Scribd / dokumen.pub Crabel landing pages (fetched; returned metadata
    only — recorded here as *attempted and failed*, so the gap in Crabel primary sourcing is
    explicit rather than silent).

**Read this first — a global caveat on "measured_performance":** _Street Smarts_ is explicitly
**not** a book of backtests. The authors say so directly: *"Like every other strategy presented in
this manual, this is not a mechanical system."* Nearly every number in it is an **assertion** or a
**single illustrated chart**, not a measured statistic over a stated sample. The one genuinely
quantified body of work in this file is Larry Connors' **later** Connors Research output
(Double 7's), and even there the number reached me through a secondary source quoting the book's
table. Where a source publishes a win rate with no benchmark, that is flagged in the entry.

---

## Turtle Soup

- **origin / source_name**: Laurence A. Connors & Linda Bradford Raschke, _Street Smarts_,
  Chapter 4 (pp. 12–21). The strategy is Connors'; the name came from friends —
  *"Some friends humorously called this pattern Turtle Soup, and the name has stuck."*
- **definition**: A failed-breakout reversal. The Turtles' system bought/sold 20-day channel
  breakouts; Turtle Soup fades the breakouts that fail. *"Our method is to identify those times
  when a breakout is false and to climb aboard for the reversal."* Entry is a stop back **inside**
  the prior 20-day extreme, on the **same day** the new extreme is made.
- **criteria**:
  - new 20-day extreme today — 20 days — *"Today must make a new 20-day low-the lower the better."* — confidence: high
  - age of the PRIOR 20-day extreme — **at least 4 trading sessions** — *"The previous 20-day low must have occurred at least four trading sessions earlier. This is very important."* — confidence: high
  - entry trigger (futures) — **5–10 ticks** above the previous 20-day low — *"After the market falls below the prior 20-day low, place an entry buy stop 5-10 ticks above the previous 20-day low. This buy stop is good for today only."* — confidence: high
  - entry trigger (equities) — **1/8 point** — *"Please note for equities-we enter a Turtle Soup set-up approximately 1/8 of a point below or above the 20-period high or low."* — confidence: high. Note: 1/8 point is a **pre-decimalisation** tick; there is no published decimal-era equivalent. `missing: a decimalised or ATR-normalised offset for post-2001 equities.`
  - order life — **today only** — *"This buy stop is good for today only."* — confidence: high
  - initial stop — **1 tick** under today's low — *"immediately place an initial good-till-cancelled sell stoploss one tick under today's low."* — confidence: high
  - re-entry — **days 1 and 2 only**, at the original entry price — *"If you are stopped out on either day one or day two of the trade, you may re-enter on a buy Stop at your original entry price level (day one and day two only)."* — confidence: high
  - exit — value: null — *"As the position becomes profitable, use a trailing stop to prevent giving back profits. Some of these trades will last two to three hours and some will last a few days."* — confidence: high that no rule exists. `missing: a trailing-stop formula. The book publishes none; the exit is explicitly discretionary.`
- **measured_performance**: **None published.** The book gives a **frequency** assertion, not a
  performance one: *"On average, though, about 15-20 trades across 30 futures markets will occur
  per month."* No win rate, no average gain, no sample, no period. Every chart in the chapter is a
  single illustrated instance (including one deliberate loser, Exhibit 4.1 point 5, *"a loss of
  1.05 points"*). **Secondary, with a stated universe and period:** Oxford Capital Strategies
  backtested the Turtle Soup family over *"42 US futures markets"*, **1980-01-01 to 2011-12-31
  (32 years)**, and assigned it a **"D"** rating; they publish sensitivity surfaces but no scalar
  win rate in text. **No base rate is published anywhere for how often a 20-day breakout fails**,
  which is the denominator this setup's edge lives in.
- **invalidation**: The prior 20-day extreme being **less than 4 sessions old** disqualifies the
  setup outright. Being stopped a third time (past day two) ends the re-entry right. The named
  failure mode is the trend simply continuing: *"One of the drawbacks of this pattern though, is
  that you will have periods where you can get a large number of 20day highs/lows that do not
  reverse."* Connors also flags parabolic follow-through as a reason to abandon the plan, not
  celebrate it: after a 12-point adverse gap, *"It would be imprudent to allow such a large profit
  to dissipate."*
- **detection_notes**: Computable from daily OHLCV. Primitives: rolling 20-bar min(low)/max(high);
  `argmin`/`argmax` position within that window to test the ≥4-session age rule (this is the part
  screeners drop — you need the *index* of the prior extreme, not just its value); a tick/price
  offset; today's low/high for the stop. The **same-day** intraday reversal through the prior
  extreme is **not** verifiable from daily bars — a daily bar can only tell you today made a new
  20-day low and closed back above the prior low; it cannot tell you a resting buy stop 5–10 ticks
  above that level was actually filled *and in what sequence*. **Flag: entry fill and stop-out
  sequencing require intraday bars.** A daily-only screener should treat this as an *alert*
  (setup present) not a *trade*.
- **relevance_to_bases**: Mostly a standalone short-term trade, but the **undercut-and-reclaim**
  shape is exactly the shakeout that ends a multi-week base — a failed break of the base's lower
  boundary that reclaims it is the classic base-completion tell. As a **precursor** it is
  legitimate at the *low* end of a base; as a fade of a new 20-day *high* it is the opposite of a
  base breakout and should never be wired to a long-side base scanner.
- **conflicts**:
  - **vs. LuxAlgo (secondary):** LuxAlgo correctly states the 4-session rule for Turtle Soup —
    *"the previous 20-day low is at least four sessions old"* — but describes Turtle Soup Plus One
    only as *"allows the reclaim to happen one session later,"* silently carrying the 4-session
    requirement forward. **The book drops it to three for Plus One.** Record both: Connors/Raschke
    = 4 (TS) / 3 (TS+1); LuxAlgo = 4 / 4-implied.
  - **vs. the Turtles / Donchian:** direct opposition on the same event. Donchian and the Turtles
    **buy** the 20-day breakout; Turtle Soup **sells** it. The book concedes the trend-following
    side works *"if traded on a large basket of markets"* — so the two are not contradictory
    claims about one instrument, they are different bets on the tails of the same distribution.

---

## Turtle Soup Plus One

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 5 (pp. 22–30).
  Trademarked in the book's contents as "TURTLE SOUP PLUS ONE ™".
- **definition**: *"The Turtle Soup Plus One setup is almost identical to the Turtle Soup setup,
  except it occurs one day later."* The market makes the new 20-day extreme **and closes beyond
  it**; the reversal entry is taken the **next** day. Connors' stated rationale:
  *"I can only guess that the second day gets the last of the momentum players in."*
- **criteria**:
  - new 20-day extreme on day one — 20 days — *"The market makes a new 20-day low."* — confidence: high
  - age of the PRIOR 20-day extreme — **at least 3 trading sessions** (NOT four) — *"The previous 20-bar low must have been made at least three trading sessions earlier."* — confidence: high
  - close confirmation on day one — close ≤ prior 20-bar low — *"The close of the new low (day one) must be at or below the previous 20-bar low"* — confidence: high
  - entry — day two, a stop **at** the earlier 20-day low (no tick offset on daily) — *"An entry buy stop is placed the next day (day two) at the earlier 20 day low."* — confidence: high
  - order life — **day two only** — *"If you are not filled on day two, the trade is cancelled."* — confidence: high
  - initial stop — 1 tick under **the lower of day-one low or day-two low** — *"place a protective sell stop one tick under the lower of the day-one low or the day-two low."* — confidence: high
  - profit-taking window — **2 to 6 bars** — *"Take partial profits within two to six bars and trail a stop on the balance of your position."* — confidence: high
  - intraday variant offset — **1 tick** — *"When we trade the strategies intraday, we enter at the previous 20-bar high(low) minus(plus) one tick."* — confidence: high
- **measured_performance**: **None published in the book.** As with Turtle Soup, only illustrated
  single instances. **Secondary, with a stated universe and period:** Oxford Capital Strategies,
  *"42 US futures markets"* across commodities, currencies, interest rates and equity indexes,
  **1980-01-01 to 2011-12-31**, rating **"D"**; two versions (zero cost, and $100 round-turn),
  no scalar win rate given in text. **No base rate published.**
- **invalidation**: Prior extreme <3 sessions old; day-one close **inside** the prior 20-bar
  extreme (this kills it — a new intraday extreme that closes back inside is a Turtle Soup, not a
  Plus One); no fill on day two.
- **detection_notes**: **Fully computable from daily OHLCV, and the cleanest of the family for a
  daily screener.** Primitives: rolling 20-bar extreme + `argmin`/`argmax` index for the 3-session
  age test; a close-vs-level comparison; next-day high/low to test whether the entry level was
  touched. Because entry is a level **inside** yesterday's range and the trigger day is a single
  named day, `low[t] <= prior20low <= high[t]` is a sound daily-bar fill proxy — far safer than
  Turtle Soup's same-day sequencing. The authors themselves flag it as the pre-computable one:
  *"With Turtle Soup Plus One you know the evening before if a setup exists."* No intraday data
  required for detection.
- **relevance_to_bases**: Same as Turtle Soup — a **precursor/trigger** for a base's final
  shakeout when it fires at the low end. Its "close beyond the extreme" requirement makes it a
  better undercut-and-reclaim proxy than plain Turtle Soup, because a *closing* violation of a
  base's floor followed by a reclaim is the higher-conviction shakeout.
- **conflicts**:
  - **The 3-vs-4 session split is the most misquoted number in this entire literature.** Turtle
    Soup = ≥4 sessions; Turtle Soup Plus One = ≥3 sessions. Both figures are verbatim above and
    both are in the same book, 10 pages apart. Oxford Strat's independent implementation
    corroborates the 3: *"The previous breakout has been made at least 3 bars earlier."*
    LuxAlgo's write-up does not carry the distinction.
  - **vs. plain Turtle Soup on the same bar:** the two setups can both be *pending* on the same
    instrument at the same time and give **opposite** entry days. They are not variants to be
    merged into one screener rule; the book tests them as separate strategies.

---

## The 80-20's

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 6 (pp. 31–35).
  Explicitly built on **George Douglass Taylor's** _The Taylor Trading Technique_ and on research
  by **Steve Moore** at the **Moore Research Center**; the open-in-the-opposite-end
  prequalification is credited to **Derek Gipson**.
- **definition**: A day-trade fade of a day that opened at one extreme of its range and closed at
  the other. Day-session data only: *"night data are ignored. The range should be created from
  day-session data only."*
- **criteria**:
  - setup bar open — top **20 percent** of the daily range (for buys) — *"Yesterday the market opened in the top 20 percent of its daily range and closed in the lower 20 percent of its daily range."* — confidence: high
  - setup bar close — lower **20 percent** of the daily range (for buys) — same quote as above — confidence: high
  - provenance of the "80" — the closing filter was **loosened from 90% to 80%** — *"we dropped the closing range function down from 90 percent to 80 percent. This did not affect the overall profitability."* — confidence: high
  - trigger — today trades **5–15 ticks** beyond yesterday's extreme — *"Today the market must trade at least 5-15 ticks below yesterday's low This is a guideline. The exact amount is left to your discretion."* — confidence: high (the book explicitly marks this as discretionary, not a fixed value)
  - entry — a stop **at yesterday's low** — *"An entry buy stop is then placed at yesterday's low."* — confidence: high
  - initial stop — value: null — *"Upon being filled, place an initial protective stop near the low extreme of today."* — confidence: med. `missing: "near" is not a number. No tick offset is published for the 80-20 stop, unlike Turtle Soup's explicit "one tick".`
  - holding period — **day trade only** — *"This trade is a day trade only."* — confidence: high
  - optional filter — value: null — *"Another filter one may wish to look at is the size of the setup bar."* / *"I especially like to look for reversals after bars that have a larger than normal daily range."* — confidence: high that it is unquantified. `missing: a threshold for "larger than normal daily range" — e.g. a multiple of ATR. None is published.`
- **measured_performance**: The **only real statistic in Street Smarts**, and it is Steve Moore's,
  not Connors/Raschke's, and it describes the **base phenomenon**, not the trade:
  *"His research showed that when a market closed in the top/bottom 10 percent of its range, it
  had a 80-90 percent chance of follow-through the next morning but actually closed higher/lower
  only 50 percent of the time."* Note carefully: this is the **10 percent** variant (the original
  profile), not the 20 percent used in the rules, and it says nothing about the 80-20 *entry*'s win
  rate. **The 80–90% figure is published with no base rate** — no denominator is given for how
  often *any* day exceeds the prior day's extreme, so 80–90% cannot be read as an edge on its own.
  The paired 50% closing figure is the closest thing to a benchmark and is what the trade actually
  exploits (*"This implies that there is a good chance of a midday reversal."*). The book points to
  *"Tables … in the Appendix that show all of Steve Moore's original research"* — **that appendix
  is absent from the copy retrieved**, so the underlying sample size, markets and period are
  unknown to this document. Expectancy is explicitly small: *"Large profits from 80-20's are the
  exception, not the rule."*
- **invalidation**: The setup bar failing either the open-extreme or close-extreme test; today not
  penetrating yesterday's extreme by the 5–15 tick guideline; the close (this is a day trade — an
  unclosed position at the bell is a rule violation, not a swing).
- **detection_notes**: **Setup detection is fully computable from daily OHLCV** — you need the
  **open**, which many OHLC feeds carry but some screeners quietly drop. Primitives:
  `(open - low) / (high - low) >= 0.8` and `(close - low) / (high - low) <= 0.2` (sell setup), and
  the mirror for buys. Guard `high == low` (zero-range bars → division by zero). **Flag: the
  *trade* is intraday-only.** The trigger (penetrating yesterday's extreme by 5–15 ticks and then
  reversing back through it) and the "near the low extreme of today" stop both require intraday
  bars; a daily bar tells you the level was touched but not the order of touches. Additional hard
  constraint: the book requires **day-session-only ranges**, so a 24-hour futures feed or an
  equity feed including pre/post-market prints will compute a **different** open and range and
  silently produce different signals.
- **relevance_to_bases**: **Standalone short-term trade.** The authors say so:
  *"This pattern does not necessarily have any long-term implications."* Its base value is
  indirect — an 80-20 bar marks a one-to-two-day exhaustion, which inside a base is noise, not
  structure.
- **conflicts**:
  - **Internal ambiguity in the book's own prose vs. its rules.** The narrative says a sell setup
    is *"If the market opened in the lower 20 percent of its daily range and closed in the upper
    80 percent of its daily range"* while the numbered rule says the buy setup is *"opened in the
    top 20 percent … and closed in the lower 20 percent."* These are consistent only if "closed in
    the upper 80 percent" means *above the 80th percentile of the range* (i.e. the top 20%). Many
    third-party implementations read "upper 80 percent" literally as `close > low + 0.8*range`…
    which is the same thing… but others read it as "anywhere in the upper 80% of the range,"
    which is a **vastly** looser filter. Record both readings; the numbered rule is authoritative.
  - **vs. Taylor:** the book positions this as a mechanisation of Taylor's buy-day/sell-day
    rhythm, but Taylor's own book has no percent-of-range test. The 20% thresholds are
    Moore/Gipson/Connors, not Taylor.

---

## Momentum Pinball

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 7 (pp. 36–41).
  Trademarked in the contents as "MOMENTUM PINBALL ™". The indicator is Raschke's — the book names
  it *"an LBR/RSI."*
- **definition**: A one-to-two-day flip driven by a **3-period RSI of the 1-period rate of change**
  (i.e. RSI applied to daily net change, not to price), triggered by a first-hour range breakout.
  *"As with the 80-20's pattern, there is no long-term directional significance to this
  indicator. However for short-term (one- to two day) flips, it can't be beat."*
- **criteria**:
  - indicator construction — **3-period RSI** of a **1-period** ROC — *"Plot a three-period RSI of a one-period rate of change (the daily net change). We refer to this as an LBR/RSI."* — confidence: high
  - ROC definition — today's close minus yesterday's close — *"This is simply, the difference between today's close and yesterday's close."* — confidence: high
  - buy setup threshold — LBR/RSI **< 30** on day one — *"Day one is determined by an LBR/RSI value of less than 30."* — confidence: high
  - sell setup threshold — LBR/RSI **> 70** on day one — *"Day one is determined by an RSI value greater than 70."* — confidence: high
  - entry — day two, stop above the **high of the first hour's** range — *"On day two, place a buy stop above the HIGH of the first hour's trading range."* — confidence: high
  - initial stop — the **low of the first hour's** range — *"place a resting sell stop at the low of the first hour's range to protect your trade. The market should not come back to this point."* — confidence: high
  - re-entry — allowed, at the original price — *"If the trade does get stopped out, it can be re-entered on a buy stop at the original price. It is rare that this situation occurs, but when it does it is profitable to reenter the trade."* — confidence: high
  - overnight rule — carry only if the trade closes profitable — *"If the trade closes with a profit, carry it overnight."* — confidence: high
  - exit — by the close of **day three** — *"Be sure to exit this trade by the close of the next day."* — confidence: high
  - instrument filter — value: null — *"It is important to select markets with a good average daily range."* — confidence: high that it is unquantified. `missing: a minimum average daily range or ATR threshold. None published.`
- **measured_performance**: **None published.** The chapter is entirely illustrative. The only
  quantitative-sounding claim is a probability assertion with no sample: *"if a trade closes in our
  favor, we should hold it overnight. The probabilities favor a bit more follow through the next
  day."* No base rate.
- **invalidation**: The first-hour range never being penetrated in the signalled direction — the
  book shows this explicitly as a **no-trade**, not a loss: *"the market never traded below its
  first hour's range. Consequently, our sell stop was not hit and no trade was taken."* Also: a
  flat/negative close on day two kills the overnight carry. The authors add a regime filter in the
  next chapter — the family *"works best in nice choppy markets or after a runaway move has already
  occurred"* and is unsuitable when ADX < 16 or ADX > 30 and rising.
- **detection_notes**: **The setup is computable from daily OHLCV; the trade is not.** The LBR/RSI
  needs only daily closes: `roc = close.diff(1)`, then Wilder RSI(3) **over that series** — note
  that RSI-of-a-difference is not the same as RSI-of-price and a screener that wires RSI(3) to
  price is computing a different indicator entirely. **Flag: the entry, the stop, and therefore
  every fill require INTRADAY bars — specifically the first 60 minutes' high and low.** This is
  the hardest intraday dependency in the Street Smarts set: unlike the 80-20 (where a daily bar at
  least brackets the level), the first-hour range is *unrecoverable* from a daily bar. A
  daily-only system can screen the day-one condition and nothing else.
- **relevance_to_bases**: **Standalone short-term trade.** Explicitly disclaimed as having no
  longer-term meaning. Not a base component.
- **conflicts**:
  - **vs. the 80-20's, in the authors' own words.** Connors notes the overlap and insists they are
    separate: *"there's some overlap between this setup and the 80-20's bars, yet they both test out
    independently and have different entry techniques."* Do not merge them into one signal.
  - **vs. common third-party implementations:** many published "Momentum Pinball" scripts use
    RSI(3) of *price* rather than of the 1-period ROC. That is a different indicator with a
    different distribution and will not reproduce the book's thresholds of 30/70.

---

## 2-Period ROC (short-term pivot)

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 8 (pp. 42–47).
  Presented as *"Pinball-Part 2!"* and framed as a mechanisation of Taylor's day-labelling.
- **definition**: A close-only pivot that flags which side of Taylor's two-to-three-day rhythm you
  should be on into the close. *"We want to be long by the close if the price is trading above this
  pivot point and short by the close if the price is below this pivot point."*
- **criteria**:
  - ROC period — **2** — *"close (day one) - close (day three) equals the 2-period rate of change."* — confidence: high
  - pivot construction — add the 2-period ROC to **yesterday's** close — *"Add this number to yesterday's closing price (day two). This will be our short-term pivot number."* — confidence: high
  - long flip — was on a sell signal and price closes **above** the pivot — *"We want to go home long if we have been on a sell signal and the price then closes above this pivot number."* — confidence: high
  - short flip — ROC flips and price closes **below** the pivot — *"We will look to short if the 2-period rate of change flips from a buy to a sell and the price is going to close below the short-term pivot number."* — confidence: high
  - exit — the **next** close — *"If you had entered on the close of a fresh 'flip' and exited on the close the following day…"* — confidence: high
  - regime exclusion (quiet) — ADX **< 16** — *"it is prone to whipsaw action at times in flat quiet markets (for example, when the ADX is less than 16)."* — confidence: high (note the book hedges with "for example")
  - regime exclusion (trending) — ADX **> 30 and still rising** — *"It is also not an appropriate tool in a strong-trending market (for example, when the ADX is greater than 30 and still rising.)"* — confidence: high
- **measured_performance**: **None published as a backtest.** The one number in the chapter is a
  count off a **single chart** and must not be read as a statistic: *"you would have been
  profitable on 8 out of 11 trades"* — that is Exhibit 8.1, S&P December 1994, one contract, one
  quarter, chosen for illustration. The authors immediately disclaim mechanical use:
  *"Although we do not recommend trading this way on a mechanical basis…"*. The book asserts,
  without producing the study, that *"The studies presented in the Appendix show that this
  indicator provides a statistically significant edge"* — **that appendix is absent from the copy
  retrieved.** No base rate.
- **invalidation**: ADX outside the 16–30 band. Raschke also disqualifies it for inexperienced
  users outright: *"I would not recommend that beginning traders pay too much attention to it
  because it gives many false signals in quiet markets."*
- **detection_notes**: **Fully computable from daily OHLCV — closes only.** Primitives:
  `roc2 = close[t] - close[t-2]`; `pivot[t+1] = close[t-1] + roc2` (read the book's indexing
  carefully — the ROC is added to the close of the *middle* day, not the current one; the worked
  example confirms it: the 11-01/10-30 difference of 1.55 is added to the **10-31** close);
  a sign-change detector for the "fresh flip"; ADX(14) for the regime gate. No intraday data
  required. **Warning:** the pivot's own indexing is the single easiest thing to get wrong here,
  and getting it wrong produces a plausible-looking series that is off by one day.
- **relevance_to_bases**: **Standalone**, and a *timing* tool rather than a setup. Its only base
  relevance is negative: it tells you when *not* to fade a move.
- **conflicts**: None recorded against another named house. Internally, the chapter contradicts a
  mechanical reading of itself — it presents an 8-of-11 chart result and then says not to trade it
  mechanically. Record the disclaimer alongside any use of the number.

---

## The "Anti"

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 9 (pp. 48–57).
  Raschke's pattern; she describes deriving it from her own pre-1986 tooling (*"a 3-10 moving-average
  oscillator with a simple 16-period moving average of itself"*). Rendered "THE 'ANTY'" in the
  chapter heading of the extracted text — an OCR artefact; the book's contents page reads
  "THE 'ANTI'".
- **definition**: A pullback entry defined **in oscillator space rather than price space**.
  *"The basic principle is that a short-term trend will tend to resolve itself in the direction of
  the longer-term trend. Two different time frames or cycles moving in the same direction create a
  condition called 'positive feedback.'"* Crucially: *"The trade may not always be apparent on the
  bar charts alone!"* — trend is the **slope of the slow %D**, not the slope of price.
- **criteria**:
  - fast line — **7-period %K**, smoothing **4** — *"Use a seven-period %K stochastic (the 'fast' line). If your program allows for an adjustment of the smoothing of this parameter, default to four."* — confidence: high
  - slow line — **10-period %D** — *"Use a 10-period %D stochastic (the 'slow' line)."* — confidence: high
  - trend condition — value: null — *"The slow line … has established a definite upward trend."* — confidence: med. `missing: "definite upward trend" is unquantified. No slope threshold, no lookback for the slope, no minimum %D level is published. This is the single largest hole in the Anti's computability.`
  - retracement condition — value: null — *"A consolidation or retracement in price causes the fast line to pull towards the slow line."* — confidence: med. `missing: no minimum distance, duration, or convergence threshold for "pull towards".`
  - preferred retracement length — **2 to 3 bars** — *"The best trades occur when the %K corrects back at least two to three bars."* — confidence: high (stated as a preference, not a rule)
  - entry — the fast line hooks back toward the slow line — *"Enter when the price action causes the fast line to turn up once again in the direction of the slow line (forming a hook)."* — confidence: high
  - anticipatory trigger — opposing slopes for **at least 3 days**, buy stop **1 tick** above the previous day's bar, trailed down daily — *"When the %K and %D have formed opposing slopes for at least three days, creating a tension between them, place a buy stop one tick above the previous day's bar. … If the buy stop is not hit, keep on trailing it down to the high of each previous day's bar."* — confidence: high
  - initial stop — just below the entry bar / the retracement extreme — *"The initial stop should be placed just below the bar of entry."* — confidence: high
  - holding period — **3 to 4 days** average; **2 to 4 bars** to exit — *"the average holding time is three to four days. If you get in after the hook has already formed, be prepared to exit within two days."* — confidence: high
- **measured_performance**: **None published.** No win rate, no sample, no period. The only
  quantified statements are holding-time expectations, which are not performance. No base rate.
- **invalidation**: Entering late — the book caps the tolerance explicitly (*"be prepared to exit
  within two days"*). The pattern is also disqualified by its own premise if %D's slope is
  ambiguous. The exit is time-based as much as price-based: *"The market has met its time objective
  of two to four bars and there is no guaranty of continuation."*
- **detection_notes**: Computable from daily OHLCV **only after you supply the missing
  definitions.** Primitives: stochastic %K(7) with 4-period smoothing and %D(10) — note this is a
  **non-standard** parameterisation (the common default is 14/3/3, which will *not* reproduce the
  book's hooks); a slope estimator for %D over N bars (N unpublished — you must choose it and
  document that you chose it); a hook detector (%K slope sign change toward %D); the 3-day
  opposing-slope counter. **The "definite trend" and "hook" tests are where every implementation
  silently differs**, so any screener output should be treated as a candidate list for eyeballing,
  not a signal. No intraday data required for the daily-chart version; the book also applies it to
  5-minute S&P charts, which obviously would.
- **relevance_to_bases**: **Genuine precursor.** This is one of the few in the set the authors
  themselves position as a base/consolidation *breakout* tool rather than a scalp:
  *"it does a great job of identifying breakouts from consolidation patterns"* and *"this pattern
  is best used to capture breakouts from congestion areas that last two to four days."* It fires on
  short (2–4 day) congestions, so as a component inside a multi-week base it is a **trigger for the
  final leg out**, not a descriptor of the base itself.
- **conflicts**:
  - **vs. mainstream stochastic usage**, called out by both authors. Most practitioners read
    stochastics as overbought/oversold; the Anti reads the **slope of %D as trend** and enters
    *with* it. Raschke: *"That is also one of the easiest ways to get in trouble if you ignore a
    strongly trending market."* Record both readings — they generate opposite trades on the same
    oscillator reading.

---

## The Holy Grail

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 10 (pp. 58–62), and
  restated by Raschke in the boxed rules of the AIQ Opening Bell interview, August 1997, p. 2.
  Named tongue-in-cheek: *"just kidding about the title!"* Built on **Welles Wilder's ADX**.
- **definition**: The first pullback to the 20-period EMA in a strongly trending market.
  *"When prices make new highs(lows) in a strong trend, you should always buy(sell) the first
  pullback."* Two outcomes are anticipated: *"The retest will either fail at the previous high/low
  in which case a small profit can usually be made. In the second scenario, a whole new
  continuation leg begins."*
- **criteria**:
  - trend filter — **14-period ADX**, **> 30 and rising** — *"A 14-period ADX must initially be greater than 30 and rising. This will identify a strongly trending market."* — confidence: high (identical wording in the 1997 AIQ box: *"The 14-period ADX must initially be greater than 30 and rising."*)
  - the moving average — **20-period EXPONENTIAL** — *"Look for a retracement in price to the 20-period exponential moving average."* — confidence: high. The AIQ interview repeats it twice independently: *"The 20 period exponential moving average often acts as support for stocks."*
  - touch condition — price **touches** the 20 EMA — *"When the price touches the 20-period exponential moving average, put a buy stop above the high of the previous bar."* — confidence: high
  - entry — a stop **above the high of the previous bar** — same quote — confidence: high
  - initial stop — the newly formed swing low — *"Once filled, enter a protective sell stop at the newly formed swing low."* — confidence: high
  - target — the most recent swing high — *"Trail the stop as profits accrue and look to exit at the most recent swing high."* — confidence: high
  - re-entry — at the original entry price — *"If stopped out, re-enter this trade by placing a new buy stop at the original entry price."* — confidence: high
  - **one-shot-per-ADX-cycle rule** — ADX must re-cross above 30 before the next trade — *"After a successful trade, the ADX must once again turn up above 30 before another retracement to the moving average can be traded."* — confidence: high
  - ADX behaviour note (not a criterion, a correction) — a turndown in ADX is expected, not disqualifying — *"Many traders have the misconception that a turndown in the ADX indicates a trend reversal. This is rarely true. Usually, the ADX initially peaks as a price consolidation begins."* — confidence: high
- **measured_performance**: **None measured.** The book publishes no win rate, sample or period.
  Raschke makes a **probability assertion** in the 1997 interview which is frequently requoted as
  if it were a backtest: *"the odds that a top is in place is probably only 5% to 10%."* Note the
  word **"probably"**, and note there is **no sample, no market, no period, and no base rate** —
  this is a judgement, not a measurement, and should never be presented as a hit rate. She also
  makes an unquantified prevalence claim: *"If you look at stocks that have participated in the
  markets advance in the last two or three months, youll see the majority of them have had Holy
  Grail patterns."* — which, if anything, argues the pattern's **base rate is high**, i.e. it is
  common, which cuts against reading a high hit rate as an edge.
- **invalidation**: ADX ≤ 30 or falling from the outset. A second retracement without an
  intervening ADX re-cross above 30 (rule 6 — the most commonly dropped rule in third-party
  versions). Raschke's own named failure mode from the interview is **stall, not loss**: on Eaton
  Corp, *"in the last five days (July 1 to July 8) there was little movement in the stock… You
  havent lost any money but you havent made any money either… This is a case where there is no
  reason to be in this trade. Dont give it the benefit of the doubt."*
- **detection_notes**: **Fully computable from daily OHLCV.** Primitives: Wilder ADX(14) plus a
  rising test (ADX[t] > ADX[t-1], or a slope over N — the book says "rising" without a lookback,
  so document your choice); EMA(20) of close; a touch test (`low <= ema20 <= high`); previous bar's
  high for the stop-entry; swing-low/swing-high detection (pivot with a chosen left/right width —
  **unpublished**, `missing: the swing pivot width`); and a **stateful** ADX-cycle latch to
  implement rule 6, which is *not* expressible as a per-bar boolean and is why most screeners omit
  it. No intraday data required. Note ADX has a long warm-up (Wilder smoothing over 14 needs
  ~28–40 bars to stabilise); a screener over short histories will produce wrong ADX values silently.
- **relevance_to_bases**: **Precursor / continuation trigger, and the most base-relevant entry in
  the Raschke set.** A first pullback to a rising 20 EMA after a thrust is the shape of a *high
  tight flag* or a shallow continuation base; the ADX>30 gate is a formal way of saying "the prior
  leg was a real leg." Inside a longer multi-week base this fires at the **breakout-and-throwback**
  moment rather than during the base's dull middle.
- **conflicts**:
  - **EMA vs SMA — the most misquoted parameter in this file.** The book and Raschke's own 1997
    boxed rules both say **20-period EXPONENTIAL** moving average. Multiple widely-circulated
    third-party summaries (including a TradingView-derived description surfaced in this research)
    render it as *"retracement down to 20-period simple moving average (SMA)"*. Record both:
    Raschke/Connors = **20 EMA**; the popular restatement = 20 SMA. These diverge materially on
    the touch test, which is the entire trigger.
  - **Internal wobble in the book itself:** the AIQ 1997 box drops "exponential" in its rule 3
    (*"When the price touches the 20 period moving average"*) while rule 2 of the same box and the
    surrounding prose both say exponential. The 1995 book says exponential in both places.
    Treat exponential as authoritative.
  - **vs. the general ADX convention:** the common reading is that a falling ADX signals trend
    death. Raschke explicitly rejects that for this setup (quote above). Both readings exist;
    they give opposite instructions on the same bar.

---

## ADX Gapper

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 11 (pp. 63–70).
  Connors' filtered descendant of **Larry Williams' "Oops!"** trade (see the Whoops/Oops entry).
- **definition**: A gap-reversal taken only in the direction of an already-strong trend.
  *"We want to use the ADX to identify periods where the trend is strong, to wait for days that gap
  in the opposite direction of the trend, and then to climb aboard if the market resumes its
  original trend."*
- **criteria**:
  - ADX period — **12** (NOT 14 — different from the Holy Grail in the adjacent chapter) — *"We will use a 12-period ADX and a 28-period +DI/-DI. (Night sessions are omitted.)"* — confidence: high
  - DI period — **28** — same quote — confidence: high
  - ADX threshold — **> 30** — *"The ADX must be greater than 30."* — confidence: high
  - direction filter — +DI > -DI for buys — *"For buys, the +DI must be greater than the -DI; for sells, the -DI must be greater than the +DI."* — confidence: high
  - gap condition — today's **open** gaps **below yesterday's low** (for buys) — *"Today's open must gap below yesterday's low."* — confidence: high
  - entry — a buy stop **in the area of** yesterday's low — *"A buy stop is placed in the area of yesterday's low."* — confidence: med. `missing: "in the area of" is not a number. One worked example uses "one tick above the previous day's low" (Exhibit 11.4); another uses the low itself. No offset is published as a rule.`
  - initial stop — today's low — *"If filled, a protective sell stop is placed at today's low."* — confidence: high
  - exit — discretionary, with an overnight-carry preference — *"either exit the position before the close or carry it into the following day if it closes strongly."* — confidence: high
  - session — **day-session only** — *"(Night sessions are omitted.)"* — confidence: high
- **measured_performance**: **None published as a number.** Two unquantified claims: a **frequency**
  assertion — *"If you follow all the active markets like I do, you will get between two to four
  trades per week"* — and a directional claim about the overnight hold — *"Back testing of this
  strategy shows profit improvement holding these trades into the next morning."* No sample, no
  period, no universe, no base rate. The book's contents list *"Exhibit A.14 Historical Oops (ADX
  Capper) Buy Report"* and *"Exhibit A.15 Historical Oops (ADX Capper) Sell Report"* in the
  appendix — **absent from the copy retrieved**, so the actual tables were not read.
- **invalidation**: ADX ≤ 30; DI on the wrong side; no gap (the gap must clear yesterday's
  *extreme*, not merely yesterday's close); the gap never being recovered back to yesterday's low.
- **detection_notes**: **Setup computable from daily OHLCV; fill is not.** Primitives: Wilder
  ADX(12) and +DI/-DI(28) — note the mismatched periods, which most DMI implementations do **not**
  allow you to set independently; `open[t] < low[t-1]` for the gap; `high[t] >= low[t-1]` as a
  daily-bar proxy for the entry level being touched. **Flag: whether the buy stop filled *before*
  the day's low was made — i.e. whether the stop at today's low would have been hit first —
  cannot be resolved from a daily bar. Requires intraday.** Also flag the **day-session-only**
  requirement: on a 24-hour futures feed, "the open" and therefore the gap itself will be a
  different number.
- **relevance_to_bases**: **Standalone short-term trade**, though the "gap against a strong trend
  that gets bought" shape is a legitimate *shakeout inside a continuation base*. Its dependence on
  ADX > 30 means it cannot fire during a base's quiet middle by construction.
- **conflicts**:
  - **vs. Larry Williams' unfiltered Oops!** — the same trade without the trend filter. Connors
    states his reason for diverging: *"I traded the Oops strategy for awhile and made money with
    it, but I found that most of my profits were coming from a small handful of trades."*
    Record both: Williams = trade all gap reversals; Connors = trade only those aligned with an
    ADX>30 trend, accepting far fewer signals.
  - **ADX(12)/DI(28) here vs. ADX(14) in the Holy Grail** — two different ADX parameterisations
    within the same book, two chapters apart. Do not unify them into one indicator instance.

---

## Whoops / Oops

- **origin / source_name**: **Larry Williams**, not Connors or Raschke. _Street Smarts_ names it
  but does **not** publish its rules. The only substantive mention is Connors crediting it:
  *"Larry William's proved that trading gap reversals is a statistically correct strategy (see
  Appendix). He called these reversals 'Oops trades.'"*
- **definition**: (As characterised in _Street Smarts_ only.) A gap-reversal trade: a gap beyond
  the prior day's extreme that then reverses back through it. The book treats it as the
  **unfiltered parent** of its own ADX Gapper.
- **criteria**:
  - rule set — value: null — *Street Smarts publishes no rules for the Oops trade.* — confidence: high. `missing: the entire rule set. To make this computable one must go to Larry Williams' own publications (e.g. "How I Made One Million Dollars ... Last Year ... Trading Commodities"), which were NOT fetched for this file. Do not synthesise rules for it from the ADX Gapper — the ADX Gapper is explicitly a modified derivative.`
  - relationship to ADX Gapper — the ADX filter **reduces** signal count — *"The ADX filter reduces the number of gap reversal trades."* — confidence: high
- **measured_performance**: **None readable.** _Street Smarts_ asserts Williams *"proved"* it is
  *"a statistically correct strategy"* and points to *"Exhibit A.12 Historical Oops Buy Report"*
  and *"Exhibit A.13 Historical Oops Sell Report"* in its appendix — **those pages are absent from
  the copy retrieved.** So the file records the claim and explicitly records that the supporting
  table was not read. No base rate available. **Do not substitute the ADX Gapper's or any other
  source's numbers here.**
- **invalidation**: Not determinable without the rule set.
- **detection_notes**: Not implementable from this research. If it is wanted, the minimum
  primitives would be a gap test against the prior day's extreme plus a reversal-through-that-level
  test — but the thresholds, offsets and exits are unpublished here. **Flag: like all gap
  reversals, the fill/stop sequencing is intraday-only.**
- **relevance_to_bases**: Standalone short-term trade.
- **conflicts**: The naming itself. Larry Williams' term is **"Oops!"**. **"Whoops"** appears in
  circulation as a corruption of it and is not the author's word; _Street Smarts_ uses "Oops"
  exclusively. Record both spellings as one pattern under Williams' name — and record that
  attributing it to Connors/Raschke is itself an error this literature commonly makes.

---

## Whiplash

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 12 (pp. 71–73).
- **definition**: A market-on-close entry after a gap that reverses intraday, **without requiring
  the gap to be filled**. *"It is also unique in that the gap does not need to be filled. … We must
  wait until the close to enter as we want confirmation that the market has truly failed."*
- **criteria**:
  - gap condition — open gaps **lower than the previous day's low** (for buys) — *"The market must gap lower than the previous day's low. (Night sessions are omitted)"* — confidence: high
  - reversal condition (a) — close **> open** — *"The close must be higher than the opening"* — confidence: high
  - reversal condition (b) — close in the **top 50 percent** of the day's range — *"and also in the top 50 percent of the day's trading range."* — confidence: high
  - entry — **market on close** — *"If rules 1 and 2 are met, buy MOC."* — confidence: high
  - hard exit rule — exit immediately if tomorrow opens against you — *"If tomorrow opens below today's close (indicating a loss on the position), sell immediately! Take the loss!"* — confidence: high
  - exit if profitable — trail — *"If tomorrow opens with a profit, trail a stop to protect profits."* — confidence: high
- **measured_performance**: **No sample published.** Two unsourced claims: *"Back testing indicates
  a good win/loss percentage in the overnight gap action"* (no number) and Raschke's
  *"When a setup gives you an almost 60 percent headstart, as this one does, the chance to make
  money is very good."* — **the 60 percent figure carries no sample size, no period, no universe,
  and no base rate.** Read strictly it appears to describe the probability of a favourable next
  open, which without the unconditional base rate for a favourable open is uninterpretable. Also
  asserted without measurement: *"There also seems to be a slight sell-side bias to this
  strategy"* / *"Yes, the testing confirms this also."*
- **invalidation**: An adverse next open — and note this is an **immediate, unconditional exit**,
  not a stop level. The setup is void if the gap does not clear the prior day's extreme, or if the
  close is in the bottom half of the range.
- **detection_notes**: **Setup fully computable from daily OHLCV** — this is one of the cleanest in
  the set. Primitives: `open[t] < low[t-1]`; `close[t] > open[t]`;
  `(close[t] - low[t]) / (high[t] - low[t]) >= 0.5` (guard zero range). The **entry** is MOC, which
  a daily bar gives you exactly (the close). The **exit** is the next open, which a daily bar also
  gives you exactly. **This setup requires NO intraday bars at all** — unusual for this chapter of
  the book, and worth exploiting. Only the *trailing* stop on winners needs intraday. Caveat:
  **day-session-only** ranges again, so a 24h futures feed changes both the gap test and the
  range-position test.
- **relevance_to_bases**: **Standalone**, one-to-few-day trade. The authors describe the mechanism
  as short-term exhaustion: *"days which reverse from market extremes tend to have follow-through
  the next morning."* Not a base component.
- **conflicts**:
  - **vs. Three-Day Unfilled Gap Reversals (next chapter):** the two are near-mirror images on the
    same event and can both trigger on the same gap in **opposite** directions. Whiplash buys a
    gap-down that closes strong, *without* the gap being filled; Three-Day Unfilled Gap Reversals
    buys a gap-down only when the gap **starts to fill** within three sessions, entering above the
    gap day's high. The book presents them as separate strategies in adjacent chapters and never
    reconciles them. Record both.

---

## Three-Day Unfilled Gap Reversals

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 13 (pp. 74–79); rule set
  reproduced verbatim in a boxed insert in the AIQ Opening Bell interview, August 1997, p. 5.
- **definition**: Buy an unfilled gap-down only once the market begins to close the gap, within a
  strict three-session window. *"the market must begin to close an unfilled gap within three days."*
- **criteria**:
  - gap condition — gap lower and **not filled** that day — *"Today the market must gap lower and not fill the gap."* — confidence: high
  - window — **3 trading sessions** — *"Over the next three trading sessions, have in place a buy stop one tick above the high of the gap-down day."* — confidence: high
  - entry offset — **1 tick** above the gap-down day's high — same quote — confidence: high
  - initial stop — the **low of the gap-down day** — *"If filled, place a protective sell stop at the low of the gap-down day."* — confidence: high
  - order expiry — cancel after 3 sessions — *"If not filled after three trading sessions, cancel the initial buy stop."* — confidence: high
  - money-management override — value: null — *"Because the low of 7-19 is 6 1/2 points below our entry, our protective sell stop must be placed at a higher level. Our recommendation is to risk in the range of two to three points with this trade."* — confidence: med. `missing: the 2-3 point figure is instrument-specific to that Motorola example, not a general rule. No general risk cap (% of price, ATR multiple) is published.`
  - session — day session only — *"(As with even. other strategy in this book, night sessions are omitted.)"* — confidence: high
- **measured_performance**: **None published.** No win rate, sample or period. The chapter's own
  first worked example is a **loser** (*"We are stopped out for a six cents loss plus slippage and
  commission"*), which the authors use to set expectations: *"you go through periods of small gains
  and small losses, and then you participate when the reversal is significant."* No base rate.
- **invalidation**: The gap filling on the gap day itself (disqualifies the setup at birth); no
  fill within three sessions (order cancelled); a stop that would be too wide relative to the
  trade's risk budget — the book advises *reducing* the stop distance rather than skipping,
  which materially changes the trade's characteristics.
- **detection_notes**: **Fully computable from daily OHLCV.** Primitives: gap test
  (`open[t] < low[t-1]` for a gap-down); an "unfilled" test on the same bar (`high[t] < low[t-1]`
  — the gap-day high never reaches the prior low); then a 3-bar forward scan for
  `high[t+k] > high[t]`, k ∈ {1,2,3}. **The "unfilled" test is where implementations diverge:**
  the book says "gaps lower and does not fill the gap," which on a daily bar means the gap-day
  high stays below the prior day's low. Some implementations test only that the *close* did not
  fill it. Record which you use. No intraday required for detection; fill-vs-stop ordering on the
  entry day is again intraday-only.
- **relevance_to_bases**: **Standalone**, though Connors notes it concentrates in high-beta names:
  *"the strategy seems to work best in momentum stocks. The more volatile the stock, the more
  significant this pattern is."* In base terms an unfilled gap that gets reclaimed within three
  days is a **failed breakdown** — useful as a *base-still-intact* signal rather than as a base
  component.
- **conflicts**: See Whiplash — the two chapters take opposite entries on the same gap. Also note
  the book's own worked example (Exhibit 13.4, Soybean Meal) fires a Three-Day Unfilled Gap
  Reversal one day **after** a Turtle Soup Plus One sell signal on the same instrument
  (*"In case you missed the Turtle Soup Plus One sell signal the previous day!"*) — the setups
  overlap by design and are not mutually exclusive.

---

## Morning News Reversals

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 17 (pp. 99–103).
  Preceded by Chapter 16 ("News"), which frames the philosophy: *"instead of trying to show the
  market how smart you are, take a step back and let it talk to you!"*
- **definition**: Fade the first reaction to a scheduled 8:30 EST economic release when it
  overshoots the prior day's extreme. *"Economic news reports in the morning are notorious for
  causing erratic price behavior upon their release."*
- **criteria**:
  - event time — **8:30 EST** scheduled economic release — *"Wait for an economic news event to be released at 8:30 EST. The report can be the unemployment numbers, the consumer price index, producer price index, GDP report, etc."* — confidence: high
  - event significance — value: null — *"The more significant the report, the better the trading opportunity."* — confidence: high that it is unranked. `missing: a ranking or list of which releases qualify.`
  - reference level — previous day's high and low of the **bond** market — *"Identify the previous day's high and low for the bond market."* — confidence: high
  - overshoot threshold (bonds) — **at least 4 ticks** beyond the prior day's extreme — *"If the report immediately lifts the bond market at least four ticks above the previous day's high…"* — confidence: high
  - entry offset (bonds) — **1 to 3 ticks** on the other side of the prior day's extreme — *"…place a sell-stop one to three ticks underneath the previous day's high."* — confidence: high
  - initial stop — **1 tick** beyond today's extreme, then breakeven — *"place an initial protective stop one tick above today's high … As the position becomes profitable, immediately move the stop to breakeven."* — confidence: high
  - currencies variant — overshoot **10–20 ticks**, entry **5–10 ticks** the other side — *"If they trade 10-20 ticks beyond the previous day's extreme, place a stop 5-10 ticks on the other side of the previous day's extreme."* — confidence: high
  - re-entry — permitted at the original point — *"Yes, I have found some of my best gains come from reentering the position."* — confidence: high (stated in interview, not as a numbered rule)
- **measured_performance**: **None published.** No win rate, sample, period or base rate.
- **invalidation**: The overshoot never reaching the 4-tick (bonds) / 10–20-tick (currencies)
  threshold; the reversal never returning through the prior day's extreme. The dominant
  psychological invalidation named by the authors is that the trade is always taken *against* the
  consensus read of the release: *"You can't use logic to trade this strategy."*
- **detection_notes**: **NOT computable from daily OHLCV. This is the hardest intraday dependency
  in the file.** It requires: (a) an **economic-calendar feed** with release timestamps, (b)
  **minute or tick bars around 08:30 ET**, and (c) the prior day's high/low. A daily bar cannot
  see a 4-tick overshoot that lasted ninety seconds. Primitives if intraday data exists: prior-day
  high/low; first post-release extreme within a chosen window (window length **unpublished** —
  `missing: how long after 8:30 the overshoot must occur`); reversal-through-level detection.
  Also note the setup is **instrument-specific** as written (bonds and currencies); the book gives
  no equity variant.
- **relevance_to_bases**: **Standalone intraday scalp.** No base relevance.
- **conflicts**: None recorded against another named house. Note the internal tension with the
  Big Picture News Reversal in the very next chapter: the same news philosophy produces a
  **minutes-long** trade here and a **months-long** trade there, on opposite ends of the same
  reaction.

---

## Big Picture News Reversals

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 18 (pp. 104–108).
- **definition**: After an extraordinary event drives a market sharply lower, buy it back at the
  **pre-event closing price** if it recovers there. *"If the market can digest the radical event and
  come back to this closing price level, we want to participate in the reversing move."*
- **criteria**:
  - trigger — an extraordinary event causing a dramatic move — value: null — *"We are looking for an extraordinary event to occur which causes a market to move dramatically."* — confidence: high that it is unquantified. `missing: no percentage move, no volume threshold, no time window defines "extraordinary" or "dramatically". The book supplies only exemplars (Intel Pentium bug −10%+ over eight days; MBIA/Orange County −~10%; Motorola cellular-cancer −15% in a few days).`
  - reference level — the **last close before the event** — *"Identify the market's last closing price before the event occurred that caused it to have the sharp move."* — confidence: high
  - entry — a resting stop **at that pre-event close** — *"Place a resting stop order to enter the market at this previous closing price level."* — confidence: high
  - stop — the **post-event low** — *"Risk with a stop up to the lowest level the stock reached after the sell off. For example, if a stock was trading at 20 before the event and it then sold off to 17, we will buy the stock if it comes back to 20 and risk, down to 17."* — confidence: high
  - stop discipline (equities) — looser than the rest of the book — *"Because I may be holding this position for weeks and even months, I give my stops some breathing room."* — confidence: high
  - holding period — **weeks to months** — *"often lead to a trade that you can hold for many weeks."* — confidence: high
- **measured_performance**: **None published.** Only four narrated single instances, all winners
  (INTC *"over 80 percent"* in 6½ months; MBIA *"nearly 20 percent over the next two months and
  nearly 40 percent over the next half of a year"*; MOT *"over 60 percent"* over 10 months). These
  are **selected illustrations with no sample, no period, no universe, and no losers shown** —
  they must not be treated as performance. Connors concedes rarity: *"It does and I wish it
  happened more often."* No base rate.
- **invalidation**: The market never recovering to the pre-event close (the order simply never
  fills — the book sets no expiry, which is itself a gap); a new low below the post-event low after
  entry.
- **detection_notes**: **Computable from daily OHLCV only if you supply the event definition.**
  Primitives: an anomaly detector for the event day (e.g. an N-sigma or N×ATR down move, or a
  gap threshold — **you must choose it; the book does not**), the close of the bar *before* it, the
  running post-event minimum low, and a level-touch test for the recovery. Because the trigger is
  undefined, this is best driven by a **news/event feed** joined to prices rather than by price
  alone. No intraday data required. Practical warning: with no order expiry published, a naive
  backtest will hold resting orders indefinitely and manufacture spurious entries years later —
  choose and document a window.
- **relevance_to_bases**: **This is the one entry in the Raschke/Connors set that is genuinely a
  multi-week/multi-month structure.** The pattern — a violent break, a stabilising base at the
  lows, then a recovery through the pre-event level — is functionally a **shakeout base** whose
  breakout level is defined by an event rather than by prior resistance. Legitimate as a
  base-completion trigger, and the only one here with a holding period that matches base timeframes.
- **conflicts**: None recorded against another named house. Note the direct methodological
  contradiction with the rest of the book, which Raschke flags herself: *"I can't believe you trade
  a strategy that lasts more than a few days."*

---

## Range Contraction — ID/NR4

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 19 (pp. 109–114).
  The **patterns** are Toby Crabel's; the **trade** is Connors/Raschke's and deliberately differs
  from Crabel's: *"Crabel's initial approach suggested a day-trading strategy following this setup.
  However, our research suggests that the trade should be held longer than one day."*
- **definition**: Trade the volatility expansion out of a bar that is simultaneously an inside day
  and the narrowest range of the last four. *"In the breakout mode we can't predict the direction
  in which we are going to enter the trade. All we can do is predict that there should be an
  expansion in volatility."*
- **criteria**:
  - NR4 definition (as restated by Raschke/Connors) — narrowest range of the **last four days** (today inclusive) — *"An NR4 is a trading day with the narrowest daily range of the last four days."* — confidence: high
  - inside-day definition — *"An inside day has a higher low than the previous day's low and a lower high than the previous day's high."* — confidence: high
  - combination — both conditions on the same bar — *"Combining the two conditions sets up an ID/NR4 day."* — confidence: high
  - bracket orders — **1 tick** either side, **next day only** — *"The next day only, place a buy-stop one tick above and a sell-stop one tick below the ID/NR4 bar."* — confidence: high
  - stop-and-reverse — on entry day only, double the opposite stop — *"On entry day only, if we are filled on the buy side, enter an additional sell-stop one tick below the ID/NR4 bar. This means that if the trade is a loser, not only will we get stopped out with a loss, we will reverse and go short."* — confidence: high
  - time stop — **2 days** — *"If the position is not profitable within two days and you have not been stopped out, exit the trade MOC (market on close.) Our experience has taught us that when the setup works, it is usually profitable immediately."* — confidence: high
  - NR7 as a regime filter (Raschke's separate use) — narrowest range of the **last seven days** — *"One of the simplest concepts which I use regularly is Toby's NR7. This represents the narrowest range of the last seven days. I automatically use this as a filter to switch to a breakout mode the day following an NR7."* — confidence: high
- **measured_performance**: **None published.** The chapter's own worked examples include an
  explicit loser: *"The loss from the March 20,1995 setup is approximately 2.25 points plus slippage
  and commission."* The authors characterise the distribution qualitatively rather than
  numerically: *"This strategy gives you small gains and small losses, eventually producing a setup
  such as this one"* / *"the losses are small, and occasionally a big winner will fall into your
  lap."* **No win rate, no sample, no period, no base rate.** For the underlying NR7 pattern,
  the one **secondary** source with a stated universe and period is Oxford Capital Strategies:
  *"42 futures markets from four major market sectors"*, **1980-01-01 to 2016-01-31 (36 years)**,
  whose stated conclusion is negative — *"Once the cost of trading is applied … the pattern is not
  currently tradeable without some additional rules."* No scalar win rate given in text.
- **invalidation**: Not being filled at all (the bar's range is never exceeded next day). Being
  filled and then reversed (by design — the loss and the reversal are the same event). Two days
  without profit → MOC exit regardless. The authors add a **regime** invalidation for everything
  else: *"never try to trade against moves exploding out of these points."*
- **detection_notes**: **Fully computable from daily OHLCV — the single best-suited setup in this
  file for a daily screener.** Primitives:
  `range = high - low`; NR4 = `range[t] < range[t-1] and range[t] < range[t-2] and range[t] < range[t-3]`
  (equivalently `range[t] == min(range[t-3:t+1])` **with strict inequality** — ties must be
  excluded or you will over-count on low-priced/low-tick names);
  ID = `high[t] < high[t-1] and low[t] < ... ` — precisely: `high[t] < high[t-1] and low[t] > low[t-1]`.
  The bracket is `high[t-1] + tick` / `low[t-1] - tick`. **Flag: which side filled first, and
  whether the stop-and-reverse triggered on the same day, cannot be determined from a daily bar
  when the next day's range engulfs both levels — that case requires intraday.** A daily-only
  implementation must either skip engulfing days or adopt (and document) a convention, e.g.
  gap-direction-first. The 2-day time stop is daily-computable.
- **relevance_to_bases**: **The strongest precursor in this entire file.** An ID/NR4 is a
  one-bar-resolution volatility contraction — the same phenomenon a multi-week base expresses over
  weeks. Inside a longer base, a terminal ID/NR4 or NR7 near the top of the range is a
  classic *tightening-before-breakout* tell, and Raschke uses NR7 exactly as a **regime switch**
  rather than as a trade: it tells you to stop fading and start following. For a base screener the
  right use is as a **stage-2 confirmation** on an already-identified base, not as a standalone
  signal — the Oxford Strat result above is the direct evidence that standalone NR7 does not pay.
- **conflicts**:
  - **vs. Crabel on holding period.** Crabel's original is a **day trade**; Connors/Raschke
    explicitly extend it (*"our research suggests that the trade should be held longer than one
    day"*), then add a 2-day time stop. Record both.
  - **The NR4 off-by-one, which is the most common definitional error in the narrow-range
    literature.** "Narrowest range of the last four days" means today's range is less than each of
    the **previous three**. A widely circulated restatement encountered in this research renders it
    as *"a day whose range is narrower than each of the previous four … sessions"* — that is
    **NR5**, not NR4. The difference between NR4 and NR7 is *only* the window, so an off-by-one
    silently converts one named pattern into another. Crabel's own convention is unambiguous:
    NR4 → previous **3** bars; NR7 → previous **6** bars.

---

## Historical Volatility Meets Toby Crabel

- **origin / source_name**: Connors & Raschke, _Street Smarts_, Chapter 20 (pp. 115–121).
  Connors/Raschke's combination of a historical-volatility ratio with Crabel's NR4 / inside day.
- **definition**: Require **both** a mathematical volatility contraction and a pattern contraction
  on the same bar, then trade the expansion. *"We are mathematically identifying periods of
  historically low volatility and at the same time we are also identifying these same periods with
  pattern recognition."*
- **criteria**:
  - volatility ratio — **6-day HV / 100-day HV < 50 percent** — *"we will compare the six-day historical volatility reading to the 100-day historical volatility reading. We are looking for the 6/100 reading to be under 50 percent (in other words, for the six-day historical volatility reading to be less than one-half the 100 day historical volatility reading)."* — confidence: high
  - pattern condition — day one must be an **inside day OR an NR4** (either, not both) — *"If rule one is met, today (day one) must be either an inside day or an NR4 day."* — confidence: high
  - bracket orders — **1 tick** either side of the day-one bar, on day two — *"On day two, place a buy-stop one tick above the day-one high and a sell-stop one tick below the day-one low."* — confidence: high
  - stop-and-reverse — entry day only, expires at that day's close — *"This additional sell-stop is done on the entry day only, and expires on the close of this day."* — confidence: high
  - why 6/100 rather than 10/100 — horizon — *"The 6/100 day period helps identify short-term moves better than the 10100 day period, which is more appropriate for intermediate-term moves."* — confidence: high (note: the 10/100 ratio is from Connors' **earlier** book, per Raschke's question in the text)
  - HV formula — value: null — *"The actual formula is provided in the Appendix, but it is also included as a study in many market software programs."* — confidence: high. `missing: the appendix containing the historical-volatility calculation is ABSENT from the copy retrieved. The standard close-to-close annualised stdev of log returns is the near-universal convention, but the book's exact convention (log vs simple returns, annualisation factor, sample vs population stdev) was NOT read and must not be assumed.`
- **measured_performance**: **None published.** Six illustrated instances, all winners, no sample,
  no period, no universe, no base rate. The strongest claim is a single-instance superlative:
  *"The Historical Volatility Meets Toby Crabel setup pattern identifies to the day the biggest
  weekly rally bonds have had in six years."* That is an anecdote, not a statistic.
- **invalidation**: Ratio ≥ 50%; neither an inside day nor an NR4; no fill on day two.
- **detection_notes**: **Fully computable from daily OHLCV** once you fix the HV convention.
  Primitives: log returns; rolling stdev over 6 and over 100 bars; the ratio test; NR4 and
  inside-day tests as above; the 1-tick bracket. **Two traps:** (1) the **100-bar warm-up** means
  the signal is undefined for the first ~100 bars of any series and a screener that fills
  those with partial windows will emit false positives on newly listed names; (2) the ratio is
  **scale-free**, so unlike price-based filters it needs no normalisation — but it is very
  sensitive to whether you annualise both legs (the annualisation factor cancels in the ratio, so
  it does not matter — but a mismatched window length does). No intraday required for detection;
  same engulfing-day fill ambiguity as ID/NR4.
- **relevance_to_bases**: **Precursor, and the most directly transferable idea in this file to
  base work.** A 6/100 HV ratio under 0.5 is a formal, scale-free definition of "the volatility has
  contracted a lot relative to its own recent normal" — precisely the quantity a multi-week base
  is a chart-shaped proxy for. It is usable as a **base-tightness metric in its own right**,
  independent of the one-bar pattern, and unlike range-of-N-bars it is comparable across
  instruments and price levels.
- **conflicts**:
  - **vs. Connors' own earlier book** on the ratio's numerator: **6/100** here, **10/100**
    previously. Raschke asks about the change directly and Connors gives the horizon reason
    (quoted above). Record both; neither is retracted.
  - **vs. Chapter 19** on the pattern requirement: Chapter 19's ID/NR4 requires the bar to be
    **both** inside **and** NR4; this chapter requires **either**. Same book, adjacent chapters,
    different conjunctions. Do not unify.

---

## Crabel — the Contraction/Expansion Principle

- **origin / source_name**: Toby Crabel, _Day Trading with Short Term Price Patterns and Opening
  Range Breakout_ (Traders Press, 1990). Quoted from the book excerpt (see source 4).
  Restated in _Street Smarts_ Ch. 19 with attribution.
- **definition**: The organising premise under every narrow-range pattern.
  **Crabel, excerpt:** *"The Contraction/Expansion Principle states that the market is constantly
  changing from a period of movement to a period of rest and back to a period of movement."*
  Raschke/Connors' restatement, with attribution: *"the market experiences a constant ebb and flow
  of range contraction/range expansion. Toby Crabel elaborates on this principle in his book …
  He states that after the market has had a period of rest or range contraction, a trend day will
  often follow."*
- **criteria**:
  - the principle itself — value: null — Crabel quote above — confidence: high. `missing: the principle is a premise, not a testable criterion. It becomes computable only through a specific pattern (NR4, NR7, 2BNR, ID) or a volatility ratio.`
  - the consequence claimed — a **trend day** often follows contraction — *"after the market has had a period of rest or range contraction, a trend day will often follow."* (Raschke/Connors paraphrasing Crabel) — confidence: high that this is the claim; **low** that "often" is quantified anywhere retrievable. `missing: a published probability that a trend day follows an NR4/NR7, with its base rate (the unconditional frequency of trend days). Without the base rate the claim is untestable.`
  - trend-day definition (Raschke/Connors) — *"A trend day is one in which the market opens at one extreme of its range and closes at the other extreme. It covers a lot of distance with very few retracements."* — confidence: high (note: still unquantified — "one extreme" has no percentile threshold)
- **measured_performance**: **Not retrieved.** Crabel's book contains extensive tables — the
  excerpt confirms test periods including **T-Bonds 1978–1987, Soybeans 1970–1988, Cattle
  1970–1988, S&P 500 1982–1988**, plus Gold, D-Mark, Swiss Franc, Japanese Yen, Eurodollars, Crude
  Oil, Wheat, Corn and Live Hogs — but **the tables themselves could not be read** from any source
  fetched. Record the periods; do **not** attach numbers to them from elsewhere. One fragmentary
  probability statement did surface in the excerpt and is recorded here with an explicit warning
  that its full context (market, years, exact condition) was not readable:
  *"67% chance of closing beyond that point"* (S&P data, regarding a two-tick move back into the
  previous day's range). **Do not use this number without recovering its context.**
- **invalidation**: n/a — this is a premise, not a trade.
- **detection_notes**: Implement as a **family of measurable contraction detectors**, not as one
  rule. Daily-OHLCV primitives: range-rank over N bars (NR4/NR7/NRn), multi-bar range over a
  lookback (2BNR/3BNR), inside-day, and volatility ratios (the 6/100 HV above). A trend-day
  detector from daily bars is `(close - open) / (high - low)` near ±1 combined with
  open/close near the extremes — computable, but note **it needs the open**, and the threshold is
  yours to pick because none is published.
- **relevance_to_bases**: **This principle is the theoretical bridge between one-bar patterns and
  multi-week bases.** A base *is* a contraction; a breakout *is* the expansion. Crabel's
  contribution is the observation that the mechanism is scale-invariant, which is what licenses
  using NR7/ID/NR4 as *inner* signals within an outer base structure.
- **conflicts**: None recorded. Note the asymmetry worth flagging: the principle is universally
  cited and almost never accompanied by its base rate, which is why NR7 backtests (e.g. Oxford
  Strat's, above) so often come back negative after costs while the principle itself remains sound.

---

## Crabel — NR4 (Narrow Range 4)

- **origin / source_name**: Toby Crabel, _Day Trading with Short Term Price Patterns and Opening
  Range Breakout_ (1990). Crabel's own phrasing in the retrieved excerpt is for the **combined**
  pattern; the standalone NR4 definition below comes from a **secondary** restatement (source 5)
  corroborated by _Street Smarts_.
- **definition**: The bar with the narrowest high-low range of the last four bars, today inclusive.
- **criteria**:
  - lookback window — today's range **< each of the previous 3** bars' ranges — *"Price bar's Range is less than the previous 3 bars' ranges (measured independently)."* (**secondary** restatement) — confidence: high
  - corroboration from _Street Smarts_ (primary, Raschke/Connors quoting Crabel) — *"An NR4 is a trading day with the narrowest daily range of the last four days."* — confidence: high
  - Crabel's own phrasing (combined form) — *"Inside days with the narrowest range in four days (IDnr4)"* — confidence: high
  - range definition — high minus low — implied by all sources; no source retrieved defines it as anything else — confidence: high
  - strictness of the comparison — value: null — none of the retrieved sources states whether ties count. `missing: an explicit tie rule. "less than" implies strict, and the secondary restatement uses "less than", but Crabel's own text on ties was not read.`
- **measured_performance**: **Not retrieved** — see the Contraction/Expansion entry for the test
  periods Crabel used. No win rate, no base rate available. Note that **the base rate here is
  computable and should be computed**: under an i.i.d. assumption the unconditional probability
  that a bar is the narrowest of the last 4 is 1/4 = 25%, and for NR7 it is 1/7 ≈ 14.3%. Any
  claimed edge must be measured against that, and against the empirical (non-i.i.d.) frequency —
  volatility clustering makes narrow ranges cluster, so the empirical rate will differ.
- **invalidation**: A wider range than any of the prior three bars.
- **detection_notes**: **Trivially computable from daily OHLCV.**
  `range[t] < range[t-1] and range[t] < range[t-2] and range[t] < range[t-3]`. Prefer the explicit
  three comparisons over `range[t] == rolling_min(range, 4)[t]`, because the rolling-min form
  admits ties and will over-count on instruments with coarse tick sizes or many low-range days.
  No intraday data required. Caveat for equities: a **halted** or very-low-volume day produces a
  spurious NR4; screen on dollar volume as well.
- **relevance_to_bases**: **Precursor.** A cluster of NR4s near the top of a multi-week base is a
  tightening signature. On its own it is far too common (~25% base rate) to be a signal.
- **conflicts**: The off-by-one described under ID/NR4 above — NR4 = previous **3** bars, not
  previous 4. Multiple third-party summaries encountered in this research get this wrong in both
  directions.

---

## Crabel — NR7 (Narrow Range 7)

- **origin / source_name**: Toby Crabel, _Day Trading with Short Term Price Patterns and Opening
  Range Breakout_ (1990).
- **definition**: The bar with the narrowest high-low range of the last seven bars, today inclusive.
- **criteria**:
  - lookback window — today's range **< each of the previous 6** bars' ranges — **Crabel, excerpt:** *"any day that has a daily range less than the previous six days (NR7) whether an inside day or not."* — confidence: high (this is Crabel's own wording and settles the window unambiguously)
  - inside-day independence — an NR7 **need not** be an inside day — same quote, *"whether an inside day or not"* — confidence: high
  - corroboration from _Street Smarts_ (Raschke, primary) — *"Toby's NR7. This represents the narrowest range of the last seven days."* — confidence: high
  - independent implementation corroboration (**secondary**, Oxford Strat) — *"The current daily range is narrower than the previous six days' daily ranges compared individually"* — confidence: high
  - Raschke's use as a regime switch, not a trade — *"I automatically use this as a filter to switch to a breakout mode the day following an NR7. This means that I will not try to countertrend trade."* — confidence: high
  - frequency (**secondary**, unattributed to Crabel) — *"A typical instrument will produce dozens of NR7 days in a twelve month period"* — confidence: low; treat as a rough prior only
- **measured_performance**: **Crabel's own numbers not retrieved.** The one **secondary** test with
  a fully stated universe and period is Oxford Capital Strategies: *"42 futures markets from four
  major market sectors (commodities, currencies, interest rates, and equity indexes)"*,
  **1980-01-01 to 2016-01-31**, i.e. *"36 years since 1980"*. Their stated conclusion:
  *"Once the cost of trading is applied … the pattern is not currently tradeable without some
  additional rules."* They publish sensitivity surfaces (profit factor, Sharpe, CAGR, max DD,
  percent profitable) but **no scalar win rate in text**, so no number is recorded here.
  **Base rate:** ~1/7 ≈ 14.3% of bars under i.i.d.; the empirical rate will be higher in clustered
  regimes. Any NR7 win-rate claim without this denominator is uninterpretable.
- **invalidation**: A range wider than any of the prior six bars.
- **detection_notes**: **Trivially computable from daily OHLCV.** Six strict comparisons, or
  `range[t] == min(range[t-6..t])` with a separate tie guard. No intraday required. Same
  halted-day / illiquidity caveat as NR4. Note NR7 ⊄ NR4 in general is false — every NR7 **is**
  an NR4 (a narrower-than-6 bar is necessarily narrower-than-3), so the two flags are nested and
  must not be treated as independent evidence.
- **relevance_to_bases**: **Precursor, and the single most useful one-bar contraction flag for base
  work** — because Raschke uses it exactly as a *mode switch*: after an NR7 you stop fading and
  start following. Inside a base near its highs, that is precisely the posture change a breakout
  demands. The Oxford Strat result is the standing warning that it is a **filter, not a system**.
- **conflicts**:
  - **The window off-by-one again**: NR7 = previous **6** bars. Crabel's own wording ("less than
    the previous six days") is decisive; restatements as "narrower than each of the previous seven"
    describe NR8.
  - **Crabel vs. Raschke on usage**: Crabel frames NR7 as a day-trade setup (ORB the next day);
    Raschke frames it as a regime filter she applies without necessarily trading it. Both are in
    print; record both.

---

## Crabel — Inside Day (ID) and the ID/NR4 combination

- **origin / source_name**: Toby Crabel (1990). Standalone ID definition below from a **secondary**
  restatement (source 5); the ID/NR4 combination in Crabel's own words from the excerpt; the
  combination's trade rules from _Street Smarts_ Ch. 19 (primary — but note those are
  Connors/Raschke's rules, not Crabel's).
- **definition**: A bar wholly contained inside the prior bar's range. The ID/NR4 requires both
  containment and the narrowest-of-4 range.
- **criteria**:
  - inside day — high < prior high **and** low > prior low — *"High of current day is lower than the high of previous day AND low of current day is higher than the low of previous day."* (**secondary**) — confidence: high
  - corroboration (primary, _Street Smarts_) — *"An inside day has a higher low than the previous day's low and a lower high than the previous day's high."* — confidence: high
  - ID/NR4 — Crabel's own naming — *"Inside days with the narrowest range in four days (IDnr4)"* — confidence: high
  - Crabel's own trading instruction for inside days — *"On any inside day the ORBP should be taken."* (**Crabel, excerpt**) — confidence: high. Note this ties the inside day to the **directional** ORB variant (ORBP), not the two-sided ORB.
  - strictness on equal highs/lows — value: null — `missing: no retrieved source states whether high[t] == high[t-1] (an "equal-high inside day") qualifies. The wording implies strict inequality on both sides.`
- **measured_performance**: **Crabel's tables not retrieved.** _Street Smarts_ publishes none.
  Base rate not published anywhere retrieved; it is directly computable and should be, since
  inside days are common (typically ~15–25% of bars in liquid equities) and any conditional
  statistic needs that denominator.
- **invalidation**: Either extreme exceeding the prior bar's.
- **detection_notes**: **Trivially computable from daily OHLCV**, and one of the very few patterns
  in this entire file with **zero** ambiguity and **zero** intraday dependency:
  `high[t] < high[t-1] and low[t] > low[t-1]`. The ID/NR4 conjunction adds the three NR4
  comparisons. Note that an inside day is **not** implied by NR4 and NR4 is **not** implied by an
  inside day — an inside bar can still be wider than the bar three days ago. The conjunction is
  strictly rarer than either.
- **relevance_to_bases**: **Precursor.** Inside days at the apex of a base or a flag are the
  textbook final-coil bar. Because they are common, they earn their keep only in conjunction —
  with NR4/NR7, with position near the base high, or with the 6/100 HV ratio.
- **conflicts**:
  - **Crabel vs. Connors/Raschke on how to trade it.** Crabel: *"On any inside day the ORBP should
    be taken"* — a **directional** opening-range breakout, same session. Connors/Raschke: a
    **two-sided** bracket the next day, held up to two days, with stop-and-reverse. These are
    materially different trades from the same pattern. Record both.
  - **vs. the "inside day = narrow range" conflation.** One retrieved excerpt-summary rendered
    inside days as *"days with 'a smaller daily range than the previous four or five days'"* —
    that conflates ID with NR. They are orthogonal definitions: ID is about *containment*,
    NR is about *rank of range*. Keep them separate.

---

## Crabel — WS4 / WS7 (Wide Spread) and multi-bar narrow ranges (2BNR / 3BNR / 4BNR / 8BNR)

- **origin / source_name**: Toby Crabel (1990). All definitions in this entry are from a
  **secondary** restatement (source 5), corroborated for 2BNR by an independent implementation
  (Oxford Strat). Crabel's own words for these were **not** retrieved.
- **definition**: WS4/WS7 are the mirror images of NR4/NR7 — expansion rather than contraction.
  The multi-bar NRs measure contraction over a *window of bars* against a *longer lookback*, which
  is structurally closer to a base than the one-bar NRs are.
- **criteria**:
  - WS (wide spread) — range **> previous bar's** range — *"Price bar's Range is wider than the previous bar's range."* (**secondary**) — confidence: med
  - WS4 — range **> each of previous 3** bars — *"Price bar's Range is wider than the previous 3 bars' ranges (measured independently)."* (**secondary**) — confidence: med
  - WS7 — range **> each of previous 6** bars — *"Price bar's Range is wider than the previous 6 bars' ranges (measured independently)."* (**secondary**) — confidence: med
  - NR (plain) — range **< previous bar's** range — *"Price bar's Range is less than the previous bar's range."* (**secondary**) — confidence: med
  - NR5 — range **< each of previous 4** bars — *"Price bar's Range is less than the previous 4 bars' ranges (measured independently)."* (**secondary**) — confidence: med
  - **2BNR** — 2-day range is the narrowest 2-day range in the last **20** sessions — *"2-day-range (higher of 2 highs less lower of 2 lows) is narrowest 2-day-range in last 20 trading sessions."* (**secondary**) — confidence: high (independently corroborated by Oxford Strat: *"The narrowest range from high to low of any two day period relative to any two day period within the previous 20 market days."*)
  - **3BNR** — 3-day range narrowest in last **20** sessions — *"3-day-range (higher of 3 highs less lower of 3 lows) is narrowest 3-day-range in last 20 trading sessions."* (**secondary**) — confidence: med
  - **4BNR** — 4-day range narrowest in last **30** sessions — *"4-day-range (higher of 4 highs less lower of 4 lows) is narrowest 4-day-range in last 30 trading sessions."* (**secondary**) — confidence: med
  - **8BNR** — 8-day range narrowest in last **40** sessions — *"8-day-range (higher of 8 highs less lower of 8 lows) is narrowest 8-day-range in last 40 trading sessions."* (**secondary**) — confidence: med
  - Crabel's own use of 2BNR/3BNR — as an early-entry qualifier — **Crabel, excerpt:** *"Entry on open minus 50 point level should be reserved for special situations such as Early Entry or an initial move out of a 2 to 3 day congestion area (2 Bar NR - 3 Bar NR)."* (Cattle, 1970-1988) — confidence: high, but note the "50 point" figure is **Cattle-specific** and not a general parameter
  - bull hook — *"NR with Open greater than previous bar's High AND Close less than previous bar's Close."* (**secondary**) — confidence: med
  - bear hook — *"NR with Open less than previous bar's Low AND Close greater than previous bar's Close."* (**secondary**) — confidence: med
- **measured_performance**: **Crabel's tables not retrieved.** The one **secondary** test with a
  stated universe and period is Oxford Capital Strategies on the **2-Bar NR**: *"42 futures
  markets"*, **1980-01-01 to 2013-02-28 (33 years)**, rating **"C"**, tested both with zero cost
  and with **$50 round-turn** commission+slippage; **no scalar performance numbers are given in
  text**. Note the ratings across the three Oxford tests recorded in this file — 2-Bar NR "C",
  Turtle Soup Plus 1 "D" — are the closest thing to a comparative measured statement available,
  and they are that source's own grading scheme, not a standard metric.
- **invalidation**: Failure of the respective inequality. For the multi-bar NRs, note that the
  lookback windows are **asymmetric and non-obvious** (20 / 20 / 30 / 40) — they are not derived
  from a formula and must be taken as given.
- **detection_notes**: **All computable from daily OHLCV.** Multi-bar range primitive:
  `mbr(n)[t] = max(high[t-n+1..t]) - min(low[t-n+1..t])`, then rank that series against its own
  trailing window. **Trap:** the trailing window is over the *multi-bar range series*, which is
  itself overlapping — consecutive 2-day ranges share a bar. A naive `rolling_min` over 20 will
  therefore compare heavily correlated values; this is what Crabel specified, so implement it as
  written, but do not treat the resulting flag as 20 independent observations. No intraday
  required. The **hook** patterns require the **open**, and require it to be a genuine session
  open (day-session only).
- **relevance_to_bases**: **2BNR/3BNR/4BNR/8BNR are the most base-like patterns in Crabel's set** —
  an 8-day range that is the narrowest in 40 sessions *is* a two-week tight consolidation measured
  against two months of context, which is a base by any reasonable definition. These deserve
  first-class treatment in a base screener, ahead of the one-bar NR4/NR7 flags. WS4/WS7, by
  contrast, mark the **expansion** — useful as a *breakout confirmation* on the bar that leaves the
  base.
- **conflicts**:
  - **Sourcing conflict, flagged plainly:** these definitions come from a secondary restatement,
    not Crabel's own text, and the specific lookback windows (20/20/30/40) could not be verified
    against the book. They are internally consistent and one of them (2BNR/20) is independently
    corroborated, but the 3BNR/4BNR/8BNR windows rest on a single source. Treat with
    confidence: med and re-verify against the book before relying on them.

---

## Crabel — Opening Range Breakout (ORB), ORBP, and the Stretch

- **origin / source_name**: Toby Crabel (1990). The definitions below are **Crabel's own words**
  from the retrieved excerpt, with a **secondary** restatement recorded alongside because the two
  **materially disagree** (see conflicts).
- **definition**: A trade taken a fixed distance off the opening, sized by a 10-day measure of how
  far the market typically travels from its open before reversing.
- **criteria**:
  - the Stretch — a **10-day** average — **Crabel, excerpt:** *"The Stretch is determined by looking at the previous ten days and averaging the sum of the differences between the open for each day and the closest extreme to the open on each day."* — confidence: high
  - ORB, two-sided — **Crabel, excerpt:** *"An Opening Range Breakout (hereafter called ORB) is a trade taken at a predetermined amount above or below the opening range. When the predetermined amount (the stretch) is computed, a buy stop is placed that amount above the high of the opening range and a sell stop is placed the same amount below the low of the opening range."* — confidence: high
  - ORBP, one-sided (preference) — **Crabel, excerpt:** *"Usually this is done in a market with a strong bias in one direction or just after a clear supply or demand indication. The procedure is similar to the ORB but the only order entered is the stop in the direction of the entry."* — confidence: high
  - stop mechanics — the untriggered order becomes the protective stop — *"The first stop triggered enters the trader into the trade and the other stop becomes the protective stop."* (**secondary**) — confidence: med
  - length of the **opening range** itself — value: null — the retrieved Crabel text says *"the high of the opening range"* but never defines the range's duration. A widely repeated **secondary** claim is *"the price range in the first five minutes of trading"*. `missing: Crabel's own definition of the opening range interval. This is THE parameter of the strategy and it was not recovered. Do not assume five minutes.`
  - ORBP trigger condition — inside days — **Crabel, excerpt:** *"On any inside day the ORBP should be taken."* — confidence: high
  - early-entry variant offset — value: null — the excerpt's only concrete number, *"open minus 50 point level"*, is **Cattle-specific** (1970-1988) and is not a general parameter. `missing: a general early-entry offset rule.`
- **measured_performance**: **Not retrieved.** Crabel's tables cover T-Bonds 1978–1987,
  Soybeans 1970–1988, Cattle 1970–1988, S&P 500 1982–1988, plus Gold, D-Mark, Swiss Franc,
  Japanese Yen, Eurodollars, Crude Oil, Wheat, Corn and Live Hogs; per the excerpt the tables carry
  *"percentage-profitable figures, average winning/losing trade sizes, and gross profits"* — but
  **the numbers themselves were not readable**. No base rate. Two qualitative observations from the
  excerpt that are *not* statistics: *"Within that run inside days a thru e all resulted in
  successful ORB'S with the open on or near the low of the session in each case"* and *"Note the
  tendency for the open to act as the low of the day in each case."*
- **invalidation**: Neither stop being triggered (no trade). For ORBP, the market moving against
  the chosen bias.
- **detection_notes**: **THIS IS THE HARD INTRADAY CONSTRAINT OF THE ENTIRE FILE.** The ORB is
  **not computable from daily OHLCV** under any approximation, for three separate reasons:
  1. The **opening range** is an intraday construct whose duration is not even defined in the
     material retrieved. A daily bar has no opening range.
  2. The **Stretch** needs, per day, `min(high - open, open - low)` — this *is* computable from
     daily OHLCV (10-day mean of the smaller of the two open-to-extreme distances), so the Stretch
     alone can be precomputed daily. But it sizes an entry you cannot place.
  3. **Fill sequencing** — which of the two stops triggered first — is unrecoverable from a daily
     bar whenever the day's range spans both.
  Practical consequence for a daily screener: you can compute and publish the **Stretch** as a
  daily volatility measure, and you can flag the **setup conditions** (inside day, NR4, NR7) that
  Crabel says should be followed by an ORB the next session, but you **cannot** evaluate or
  backtest the ORB itself. Say so explicitly rather than substituting an open-to-close proxy.
- **relevance_to_bases**: **Standalone intraday trade.** Its relevance to bases is one step
  removed: the ORB is Crabel's *execution mechanism* for the expansion that follows a contraction,
  so a base screener's job stops at flagging the contraction and hands off. The **Stretch** itself,
  however, is a reusable per-instrument volatility unit and is worth computing regardless.
- **conflicts**:
  - **A direct, load-bearing disagreement about where the stop goes.** **Crabel's own words:**
    *"a buy stop is placed that amount above **the high of the opening range**."* The widely
    circulated **secondary** restatement: *"Buy stop just above **the Open price** plus the
    Stretch."* These are the same only if the opening range is a single instant. For any opening
    range of non-zero duration they differ by the height of that range — which, on an active open,
    is large. **Record both; Crabel's own wording is authoritative.** This is probably the most
    consequential misquote in the Crabel literature, because nearly every retail "Crabel ORB"
    implementation uses open ± stretch.
  - **The opening-range duration.** The oft-repeated *"first five minutes"* is a secondary claim
    and could not be traced to Crabel's own text in this research. Do not present it as his.
  - **The Stretch formula, stated two ways.** Crabel: *"averaging the sum of the differences
    between the open for each day and the closest extreme to the open on each day"* (10 days).
    Secondary: *"10 day Simple Moving Average (SMA) of the absolute difference between the Open and
    either the High or Low, whichever difference is smaller."* These appear to describe the same
    quantity, and the secondary form is the implementable one — but note Crabel's phrase
    *"averaging the sum"* is loose, and no source retrieved settles whether the divisor is 10.

---

## Three-Bar Triangle (the "3-day equilibrium")

- **origin / source_name**: **Linda Bradford Raschke**, from her LBRGroup daily tradesheet key
  (lindaraschke.net/tradesheet-key/) — **not from _Street Smarts_.** Confirmed absent from the
  1995 book: the word "equilibrium" does not appear in the full text, and there is no three-bar
  triangle chapter.
  **Sourcing caveat, stated plainly:** the tradesheet-key page **404'd on direct fetch** during
  this research; its wording below is preserved from a search-result excerpt of that page and
  could not be re-verified at source. Treat as **med** confidence pending re-verification.
- **definition**: A three-bar coil — the current bar contained within the *two*-day range, i.e. a
  contraction measured against two prior bars rather than one. It is the two-bar generalisation of
  the inside day.
- **criteria**:
  - structure — high below the **2-day high** and low above the **2-day low** — *"The three bar triangle is when the current bar's high is lower than the 2 day high and the low is higher than the two day low."* (from Raschke's tradesheet key, via a search excerpt; **not re-verified at source**) — confidence: med
  - tradesheet encoding — *"A '1' in the BO column represents that the market has formed a three bar triangle."* (same caveat) — confidence: med
  - consequence claimed — range expansion, needing volume — *"Three bar triangle breakout formation often leads to range expansion. Will need to see an increase in volume."* (attributed to Raschke's own X/Twitter post, 22 Apr 2019; the post itself was not fetched) — confidence: med
  - comparative claim vs NR7 — value: null — *"Breakouts from this formation have better odds of follow through than breakouts from a one bar NR7."* (attributed to Raschke; not fetched at source) — confidence: low. `missing: "better odds" is comparative with no numbers on either side. To make this computable/testable one would need a published follow-through rate for the three-bar triangle AND for the one-bar NR7, over the same universe and period. Neither is published anywhere retrieved.`
  - entry / stop — value: null — no rule set was retrieved from a Raschke source. Third-party implementations use a bracket at the triangle's high/low with the stop on the opposite side, but **that is not sourced to Raschke.** `missing: Raschke's own entry, stop and exit rules for this pattern.`
- **measured_performance**: **None published.** The only performance-adjacent statement is the
  unquantified comparative claim above, which carries **no base rate for either pattern**. Note
  the base rate matters especially here: the three-bar triangle is a *looser* condition than an
  inside day (it allows the current bar to exceed the immediately prior bar's extreme as long as it
  stays inside the two-bar envelope), so it fires **more** often, and a higher raw follow-through
  rate on a more common pattern is not automatically an edge.
- **invalidation**: The current bar's high exceeding the two-day high, or its low undercutting the
  two-day low.
- **detection_notes**: **Fully computable from daily OHLCV**, and cheap:
  `high[t] < max(high[t-1], high[t-2]) and low[t] > min(low[t-1], low[t-2])`.
  **Note it is strictly weaker than an inside day** — every inside day satisfies it, but not
  conversely (a bar can exceed yesterday's high while staying under the high from two days ago).
  Do not treat the two as interchangeable, and do not double-count them as independent signals.
  The volume condition Raschke attaches to the *breakout* (not the setup) requires a volume series;
  no threshold is published. No intraday required.
- **relevance_to_bases**: **Precursor.** A three-bar triangle is a micro-base; its value inside a
  multi-week base is as a *terminal coil* marker, and Raschke's own framing — a breakout that
  *"often leads to range expansion"* with *"an increase in volume"* — is exactly the volume-dry-up-
  then-expansion signature base work looks for. Its looseness relative to ID/NR4 makes it a better
  *recall* filter and a worse *precision* filter.
- **conflicts**:
  - **Attribution.** Some circulating accounts credit the three-bar triangle to **Richard Dennis**
    via Raschke ("Linda Raschke mentioned picking it up from Richard Dennis of the Turtle method").
    Raschke's tradesheet key presents it as her own column. Record both; neither was verifiable at
    source in this research.
  - **Naming.** "3-day equilibrium" and "3-bar triangle" are used interchangeably in circulation.
    Only "three bar triangle" was found in Raschke-attributed text; **"3-day equilibrium" could not
    be sourced to Raschke at all** and may be a third-party coinage. Do not present it as her term.
  - **vs. the inside day.** Because the three-bar triangle is the weaker condition, sources that
    describe it as "a three-day inside pattern" are wrong — that would be a stricter, different
    pattern (three consecutive inside days).

---

## Double 7's

- **origin / source_name**: **Larry Connors & Cesar Alvarez, Connors Research** —
  _Short Term Trading Strategies That Work: A Quantified Guide to Trading Stocks and ETFs_ (2008;
  a later edition is dated 2010 by some sources). This is Connors' **quantified** period, and it is
  the only setup in this file for which a real backtest with a stated universe, period and sample
  size was recovered. All rule and result quotes below are from **secondary** sources quoting the
  book (the book itself was not retrieved); one of those sources is **Cesar Alvarez himself**,
  Connors' former Director of Research and the book's co-author.
- **definition**: A mean-reversion structural setup: buy a 7-day closing low in an uptrend, sell a
  7-day closing high. The "structure" is a rank-of-closes over a 7-bar window, with a long-term
  trend gate.
- **criteria**:
  - trend gate — close **above the 200-day moving average** — *"Close is above 200-day moving average"* (Alvarez, quoting the book's rules) — confidence: high; independently corroborated: *"The price must close above the 200-day moving average"* (The Robust Trader) and *"The price chart should be above the 200-day moving average, indicating an uptrend"* (RoboForex)
  - entry condition — close is a **7-day low of CLOSES** (not of lows) — *"Close is a 7 day low of closes"* (Alvarez) — confidence: high; corroborated: *"The close must be at a seven-day low"* (The Robust Trader); *"We must wait for the day to close at the low of the last 7 days"* (RoboForex)
  - entry timing — **buy on the close** — *"Buy on Close"* (Alvarez) — confidence: high
  - exit condition — close is a **7-day high of closes** — *"Close is a 7 day high of closes"* (Alvarez) — confidence: high; corroborated: *"Sell when the close is at a seven-day high (sell at the close)"* (The Robust Trader)
  - exit timing — **sell on the close** — *"Sell on close"* (Alvarez) — confidence: high
  - stop loss — **none** — The Robust Trader states the strategy *"uses no stops and operates as a mean-reversion system"* — confidence: med (this is the secondary source's characterisation, not a book quote)
  - moving-average type — value: null — sources say "200-day moving average" without specifying simple vs exponential. `missing: SMA vs EMA for the 200-day gate. Convention and the wider Connors literature strongly imply SMA, but no retrieved source states it.`
  - the window — **7** — appears in the strategy's name and in every quoted rule — confidence: high
- **measured_performance**: **A real backtest with a stated instrument and start date.** Quoted
  verbatim from a source reproducing the book's own results table:
  > *"Instrument: SPY / Test dates: 1/29/93 – publication date / Win Rate: **80.4%** / # Trades: 153 / Avg. P&L: .85% / Net points: 122.36 / Strategy locked in more than all of the gains the SPY made during the test period, while only being exposed to the market less than 25% of the time."*

  And for other instruments: *"The QQQs, FXI, and EWZ each boasted 79.4%, 76.9%, and 81% win rates,
  respectively, and the book further details their results."*

  **Read these with three explicit caveats.**
  (a) *"publication date"* is not a date — the end of the test period is **unstated** in the source;
  the book is 2008/2010, so the window is approximately 1993-01-29 to 2007/2009. `missing: the exact
  end date.`
  (b) **The 80.4% win rate is published without a base rate.** For a mean-reversion strategy on a
  rising index during a period when SPY rose, a high win rate is partly structural: any strategy
  that exits on strength and holds through weakness without a stop will show a high hit rate and a
  fat left tail. The relevant benchmarks — the unconditional probability that SPY is higher N days
  after any given day over the same window, and the drawdown profile — are **not** given alongside.
  (c) The *"locked in more than all of the gains"* claim is a return comparison at **<25%
  exposure**, which is a real and meaningful statement about risk-adjusted return, but it is not a
  win-rate benchmark.

  **Independent re-tests, recorded separately and NOT merged with the book's numbers:**
  - **Cesar Alvarez** (the co-author, re-testing later): SPY & QQQ **2000–2007** *"beat buy and hold
    with only ~26% exposure and substantially better drawdown"*, but CAR figures *"are not 'go open
    up a fund' numbers"*; SPY & QQQ **2008–2015** — both CAR figures *"now are less than buy and
    hold"*; SPX and NDX members **2000–2015** — returns *"only a little better than buy and hold"*
    with drawdowns about one third better. **No scalar numbers published.**
  - **The Robust Trader** (SPY, 1993 inception to their test date): **154 trades, 82.5% win rate,
    1.18% average gain, profit factor 2.58, CAGR 6.3%** — against a stated **base rate**:
    *"SPY buy-and-hold achieved 10.1% CAGR (with dividends reinvested) and 55% maximum drawdown,
    compared to the strategy's 33% drawdown but lower returns due to only 26% market exposure."*
    This is the **only** entry in this entire file where a win rate arrives with a benchmark
    attached, and the benchmark says the strategy **underperformed buy-and-hold on return** while
    beating it on drawdown and exposure.
  - **RoboForex**, attributing to the authors: *"it showed steady positive performance in the stock
    market between 1995 and 2007. Since 2008, its performance level has declined significantly."*
    Note this source says **1995**, while the book's own table says the SPY test starts **1/29/93**.
    Record both; the 1/29/93 figure is the one attached to a quoted results table.
- **invalidation**: Price below the 200-day MA (no entry). No stop means the trade is invalidated
  only by the exit condition — which is the strategy's central risk and the reason its high win
  rate must not be read as low risk. All three independent re-tests agree performance **decayed
  after 2007/2008**.
- **detection_notes**: **Fully computable from daily OHLCV — closes only, plus a 200-bar history.**
  Primitives: `SMA(close, 200)`; `close[t] == min(close[t-6..t])` for the 7-day closing low (note
  again: **closes, not lows** — using `low` is the single most common implementation error here and
  produces a materially different, rarer signal); `close[t] == max(close[t-6..t])` for the exit.
  Entry and exit are both **on the close**, so a daily backtest is exact — no intraday data
  required, and no fill-sequencing ambiguity. **This is the only setup in the file that a daily
  bar can backtest without approximation.** Watch the 200-bar warm-up.
- **relevance_to_bases**: **Standalone short-term mean-reversion trade, not a base pattern.** It is
  included here because it is Connors' own later, genuinely quantified treatment of a *structural*
  (rank-of-closes) setup, and because it is the reference point for what a published number in this
  literature actually looks like. Its one base-adjacent property: the 200-day gate is a
  stage/trend filter of the same family a base screener uses.
- **conflicts**:
  - **Start date:** book table = **1/29/93** (SPY); RoboForex's summary of the authors = **1995**.
    Record both.
  - **Trade count and win rate:** book = **153 trades / 80.4%**; The Robust Trader's independent
    re-test = **154 trades / 82.5%** over a longer window. Close, but not the same numbers — do not
    quote them interchangeably.
  - **7-day low of *closes* vs 7-day low of *lows*.** Alvarez (co-author) is explicit: *"Close is a
    7 day low of closes."* Many circulating implementations use the intraday low. These are
    different strategies with different signal counts.
  - **vs. the rest of this file:** the Double 7's is the only entry here whose author supplies a
    sample size. Every _Street Smarts_ and Crabel figure recorded above should be read against that
    contrast — Connors' 1995 work asserts, his 2008 work measures.

---

## 3 Day High/Low Method

- **origin / source_name**: **Larry Connors & Cesar Alvarez, Connors Research** —
  _High Probability ETF Trading_ (2009). **Note this is a different book** from _Short Term Trading
  Strategies That Work_; sources routinely conflate the two.
- **definition**: A pullback-in-uptrend method built on consecutive lower highs and lower lows —
  i.e. a short multi-bar *structural* pullback rather than an oscillator reading. Characterised by
  the retrieved source as taking *"advantage of known market tendencies and structures (buys
  pullbacks in uptrends, where risk is lowest)"*.
- **criteria**:
  - trend filter — value: null — the source confirms *"moving average filters helping confirm the
    trend direction"* but the **rules are published only as images** on the page retrieved and no
    machine-readable text was available. `missing: the moving-average period(s) and whether the
    filter is one MA or two. Do NOT import the 200-day gate from the Double 7's — that is a
    different strategy in a different book.`
  - pullback structure — value: null — the source confirms the method *"incorporate[s] multi-day
    high/low analysis"* and the strategy's name implies **3** consecutive lower highs and lower
    lows, but no retrieved source states this in quotable form. `missing: the exact count and
    whether it requires lower highs AND lower lows, or either.`
  - entry — value: null — `missing: entry timing (on close vs on stop) and price.`
  - exit — value: null — `missing: the exit rule.`
  - variants — the source names **"standard"** and **"aggressive"** long and short versions —
    confidence: med. `missing: what distinguishes aggressive from standard.`
- **measured_performance**: **Not retrieved.** The source states results exist for four variants
  (long, aggressive long, short, aggressive short) and references *"performance data from SPY
  testing conducted in July 2017"* — but that is the **vendor's** 2017 re-test, not the book's
  numbers, and in either case the figures are **images and a downloadable CSV**, neither of which
  yielded readable values. **No number is recorded for this setup.** Per the rules of this
  document, no figure from the Double 7's or any other Connors strategy is substituted here.
  No base rate.
- **invalidation**: Not determinable without the rule set.
- **detection_notes**: **Would be fully computable from daily OHLCV** — consecutive lower highs and
  lower lows is a trivial daily primitive
  (`high[t] < high[t-1] < high[t-2]` and `low[t] < low[t-1] < low[t-2]` for the 3-bar case), as is
  any MA filter, and Connors' ETF strategies are uniformly close-to-close. **No intraday data would
  be required.** But it is **not implementable from this research** because the thresholds were not
  recovered. Flagged as a known gap rather than filled by inference.
- **relevance_to_bases**: **Precursor / trigger.** A three-bar pullback with lower highs and lower
  lows inside an uptrend is the micro-structure of a flag or a shallow continuation base; it is the
  closest thing in Connors' quantified work to a base-entry trigger. Its short window (3 bars)
  means it sits *inside* a base, not as a description of one.
- **conflicts**:
  - **Book attribution.** _High Probability ETF Trading_ (2009), **not** _Short Term Trading
    Strategies That Work_ (2008). Sources conflate these; the retrieved source is explicit that the
    3 Day High/Low pack is from the ETF book, alongside RSI 10-6/90-94, RSI 25-75, R3, Multi Day
    Up/Down, Bollinger %B and TPS.
  - **Rules-in-images.** The published rules being non-textual is itself the reason most circulating
    versions of this strategy differ from each other. Any implementation should cite which image
    it transcribed.

---

## Appendix — what could NOT be verified, stated explicitly

Recorded so that these gaps are visible rather than silently filled:

1. **The _Street Smarts_ Appendix (pp. 203–239) was not in the retrieved copy.** That appendix
   contains the only real statistical tables the 1995 book claims: Moore Research Center studies
   (upper/lower 90%/80%/10%/20% statistics, WR7 and higher/lower close statistics) and the
   Historical Oops Buy/Sell and Oops (ADX Gapper) Buy/Sell reports. Every "measured_performance:
   none published" above should be read as *"none published in the 140 pages retrieved"*.
2. **Crabel's book text was retrieved only as excerpts.** His statistical tables — with test
   periods T-Bonds 1978–1987, Soybeans 1970–1988, Cattle 1970–1988, S&P 500 1982–1988 and others —
   were confirmed to exist but not read. Scribd, PDFRoom, PDFCoffee's download endpoint,
   dokumen.pub and archive.org all failed to yield text.
3. **The definition of Crabel's opening range interval was never recovered.** The commonly repeated
   "first five minutes" is secondary and untraced.
4. **Raschke's tradesheet key page 404'd**, so the three-bar triangle definition rests on a search
   excerpt of that page rather than the page itself.
5. **The 3 Day High/Low rules are published as images** and were not transcribed.
6. **One orphaned Crabel statistic was found and deliberately not used:** *"67% chance of closing
   beyond that point"* (S&P, re: a two-tick move back into the previous day's range). Its full
   condition, market-years and sample are unreadable in the excerpt. Recovering its context before
   any use is required.
