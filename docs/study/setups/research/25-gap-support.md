# Setup 25: Gap Support (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
PDF, post or file named next to it and kept to 40 words or fewer. Where a page could only be read through a fetch tool
that returns excerpts, it says so next to the quote, and the quote is the tool's copy: check it by eye before it ships.
Nothing here is a ruling. Where I could not read a source, I say so and give no wording from it.

**Cold check (2026-11-09, a second reader).** Every quote below was re-opened at its source and found word for word:
the Morales glossary, 16 Kacher-Morales FAQ answers, the 2013 book's preview (re-downloaded from the publisher's preview
link and its text re-extracted), the Bulkowski pages (fetch tool), ChartSchool, Bowley, the four Morpheus articles,
Qullamaggie, Stockbee, Trader Stewie, Tradingsim, Grimes, the app's code and files, the verdict log and 52 passages in
UCT's Substack (every post re-downloaded from the sitemap; each quote's section header re-checked). The scanner summary
was re-read against the code; my own re-run of the real scanner matched section 4.8 on all 23 rows and the fire file of
section 4.7 on five tickers (355 of 355 fires), and an independent replay of the house-managed R matched 300 of 300
sampled trades. What was wrong is fixed in place and listed under "Removed or corrected in checking" at the end.
**Second check (2026-11-09, later the same day, a third reader).** The 16 FAQ answers were downloaded again as plain
pages and every FAQ quote matched word for word; the 2013 preview was re-extracted with a different tool (the first
check's saved text held none of the book passages) and all six book quotes were found on pages xxi to xxiv; the five
Bulkowski pages, the Tradingsim page and the Wiley contents page were re-read; the scanner, finder, Study files, verdict
log and rulebook were re-read against every claim; the 4.7 main row, every split and the side figures, the 4.8 table
(the real scanner, 26 charts) and the Substack counts were re-computed and matched. Three rows of section 4.9 were
corrected (NOW, BE, HUT); the count of 20 of 25 stands. Items 24 to 27 at the end.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's own
words; **[UCT]** UCT's own writers, the owner's verdict log or UCT's own code; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Words used throughout. **Gap-up day** (or gap day): the session that opened above the prior day's high. **Gap-up low**:
that session's low, the line the owner ruled the setup is about. **Gap-fill spot**: the prior day's high; a trade down to
it closes ("fills") the gap. **Test day**: the later session that pulls back to the gap and is defended. **R**: the
risk on a trade, entry minus stop. **Post-gap high**: the highest price traded from the gap day up to the test.

**The short version.**
- **What it is** (his definition, as the bank lesson words it from his rulings of 2026-10-26/27): a stock not in a downtrend gaps up
  at least 4% on twice its normal volume and holds; days or weeks later it pulls back to the **gap-up day's low** and
  buyers defend it. Holding the low (an open gap) is best, a slight breach that closes back above it is still good, a
  fill to the gap-fill spot that reclaims is a lesser example, and a breach that does not reclaim is a failed gap. The
  line, the ranking and "no downtrend gaps" are his rulings; the 4% and the 2x are the scanner's numbers carried into
  the bank's wording (he has not stated a number, and his own posts call smaller gaps "gap support" too, section 4.9).
- **No one outside UCT owns the name.** The closest published rule set is Gil Morales and Chris Kacher's **buyable
  gap-up**: the gap-up day's intraday low is "a built-in selling guide", with 1-2% of "porosity" (their FAQ, 2010 and
  2013) or 2-3% (their 2013 book; their FAQ, 2025), and a pullback "close to the low of the gap up day" named as an entry
  (FAQ, 2019). Deron Wagner (Morpheus) buys later pullbacks after breakaway gaps "as long as the gap was not filled".
  Tom Bowley (StockCharts, 2015) uses the words "gap support" for the same idea.
- **UCT uses the idea constantly.** "Gap support" appears 41 times in 22 public Substack posts, 30 of them in the
  owner's own section (the first count said 42 and 31; this is the checker's recount of the post bodies). I checked 25
  prices UCT named as gap support or a gap up low (22 in the owner's section) against daily bars: **20 sit within 1.5%
  of a gap-up day's low** (17 of his 22). His public writing and his rulings agree on the line. Five of those 20 gaps
  were small (2.2% to 3.0%), and a sixth (NOW) sits nearer a 3.7% gap on ordinary volume than the big gap behind it,
  so the word is used more widely than the 4% rule.
- **Measured evidence is thin and not flattering.** Bulkowski: gaps in an uptrend "show underlying support 20% of the
  time in a bull market". His test of the Kacher-Morales rules (557 stocks, 2001-2010) had a win/loss ratio of 28% to
  32% and an average gain of 1.2% to 3.1%: "I don't recommend this setup". My own replay of our scanner with his
  filters on 3,228 stocks from 2010 (section 4.7) finds a small edge, not a strong one: +0.09R a trade under house
  management, against +0.02R for a generic pullback day. It finds no difference between the "held", "slight breach" and
  "failed" tests he separates by eye; the close of the test day and the gap's volume mattered more (the 200-day only on
  one entry and stop, section 4.7).
- **Our scanner has real problems** (section 5): it calls the prior day's high the "gap top" (it is the bottom of the
  gap), it fires on tests that close back inside the gap (the owner's failed gap: 39% of all its fires), it scores a
  touch of the gap-fill spot as a plus, it has no trend or 200-day filter, and its stop at the gap-fill spot sits a
  median 6% away (rule A13 says about 3%). Its tag is already withheld from members after failing a blind review.
- **The house fit is good once the stop moves to the test day's low** (median risk 2.0%, 69% within 3%). The open
  conflicts are the 200-day (one of his "great" examples, DOCS, tested below it), and the trim at the post-gap high
  (the detector's plan wording, which Trade Story now stops at with his OK), which sits **under** the 3R hard trim in
  about 41% of trades.

---

## 1. What it is

**In two sentences.** A stock gaps up on heavy volume (usually on earnings) and holds the gap; days or weeks later it
pulls back to the low of that gap-up day and buyers step in there. You buy as the low is defended, with a stop a few
cents under the test day's low, betting that the repricing that caused the gap is still in force.

**What it is not** (his rulings, section 6.5): the gap day itself is a PEG (post-earnings gap), not Gap Support ("Just a
PEG"); a gap that is never revisited is nothing ("Never really tested gap support"); a gap inside a downtrend is out
("Don't want to do downtrend gaps"); a bear gap off the highs is its own lesson; a gap at the end of a parabolic burst is
Bracco's exhaustion pattern (section 6.3), not support.

**Why it works (the psychology).** These points are the sources' reasoning, not measured facts.
- **Who is buying.** The gap marks a repricing. Kacher and Morales: "A buyable gap-up is the point at which the bulls
  have decisively won the argument over the bears" (*In the Trading Cockpit with the O'Neil Disciples*, 2013,
  Introduction). Buyers who missed the gap day, and funds still building a position, get a second, lower-risk chance on
  the pullback. Bowley: "These tend to be very powerful bullish signals and buying during a pullback or consolidation
  makes solid technical sense." (StockCharts, 2015)
- **Who is trapped.** Sellers and shorts who were positioned against the news, and the crowd that thinks the gap is
  "too high". Kacher and Morales: "they tend to work most likely because the crowd sees such moves as too high and thus
  is too timid to buy into them." (2013) Gap-fill traders are a second group: ChartSchool warns, "Avoid falling into the
  trap of thinking this type of gap, if associated with good volume, will be filled soon."
- **Why the gap-up low.** Everyone who bought anywhere on the gap day is above water while that low holds. The owner, on
  open gaps: "We want to see bull gaps stay open because it shows who is in control of the strength." (2025-11-02)
- **Why it often fails.** A gap is a weak floor. Bulkowski: "Gaps are places of weak support or resistance, but you can
  use them for a stop location." (thepatternsite.com, fetch tool) ChartSchool goes further: "However, gaps have little to
  no influence on price action weeks or months after forming." (TA 101, in a paragraph about the belief that gaps must
  fill; the sentence before it: "Instances where gaps close within a few days of forming can be significant.") Read
  as a statement about support, it cuts against a weeks-later retest; section 4 measures it.

---

## 2. Origin and naming

- **The name "Gap Support"** is generic chart language, not one trader's coinage. I could not find who first wrote it
  and do not attribute it. Tom Bowley used it in a StockCharts article in 2015 (section 3.4). Inside UCT it is the
  owner's everyday term (41 uses in the Substack, 30 in his section, section 6), the app's setup name
  (`uct_gap_support`), and the brain template's "Open Bull Gap Support".
- **Other names it goes by.**
  - UCT: "bull gap support", "bullish open gap", "gap up low", "earnings gap support", "ER gap up low", and "gap hold"
    (all in the owner's posts, section 6.1). The Wiz, a UCT contributor, calls one version the "gap gotcha hammer"
    (section 6.4).
  - Kacher and Morales: the **buyable gap-up (BGU)**, first set out in *Trade Like an O'Neil Disciple* (Wiley, 2010;
    Chapter 5, *Tricks of the Trade*, section *Dr. K's Laboratory: Buying Gap-Ups in Leading Stocks*, per the
    publisher's table of contents; I did not read the chapter). Their FAQ quotes that book's page 171 (section 3.1).
    Their article "Trading gaps with the most potential" ran in *Active Trader*, December 2010 (per Bulkowski; not read).
  - Candlestick charting: a gap up is a **rising window**. The idea that windows act as support is credited to Japanese
    candle practice and Steve Nison's books; I did not read Nison, so I quote no wording from him. Bulkowski tests the
    claim (section 4.1).
  - Classical charting: the **breakaway gap** (ChartSchool, Bulkowski). Edwards and Magee are the classic source; not
    read.
  - The gap day itself goes by **episodic pivot** (Pradeep Bonde, Kristjan Kullamägi), **power earnings gap** (PEG,
    TraderStewie) and **buyable gap-up**. Those are entries on or near the gap day; Gap Support is the later test.
  - Morales' glossary also names a **bottom-fishing buyable gap-up** (BFBGU), where "the gap can occur coming out of a
    low base consolidation as a stock is trying to round out the lows" after a longer decline: the originators' own
    exception to "not in a downtrend", and the shape the owner grades down (QBTS "Eh B-", FTAI "okay").
- **A naming trap inside our own code.** `uct_gap_support.py` calls the prior day's high the **"gap top"**. For a gap
  up, the prior day's high is the *bottom* edge of the gap; the gap-up low is the top edge. The lesson overlay, the trade
  plan and course V.05 inherit the word ("the gap top or the day's low, whichever is lower"). A member will read "gap
  top" as the upper line. Section 5.2.

---

## 3. Every definition I could find, source by source

### 3.1 Gil Morales and Chris Kacher: the buyable gap-up (originators of the closest rule set)

Read: the Introduction of *In the Trading Cockpit with the O'Neil Disciples* (Wiley, 2013), pages xxi to xxiv, through
the free 43-page preview of the ebook (the PDF's creator field says Rakuten Kobo; served from
https://api.pageplace.de/preview/DT0400.9781118287293_A23567645/preview-9781118287293_A23567645.pdf, re-downloaded in
checking); Morales' glossary on his current site TheOWLTrader.com; and 16 of the 69 answers in the "Pocket Pivot Review /
Buyable Gap Ups" section of their site's FAQ (virtueofselfishinvesting.com; the writer says 22 were read, the 16 quoted
here are listed in section 11, and the second check matched every quote against a fresh plain download of each page).
These are their own words.

- **Prior trend.** "Buyable gap-ups should occur within an uptrend or constructive consolidation, not while a stock is
  in a downtrend." (glossary) Also: "buyable gap-ups can also occur within uptrends that are well formed and coherent."
  (2013 book) A gap after a long run is less buyable: "the LVS gap up strikes us as extended because it occurred after a
  nearly 4-month uptrend in the stock." (FAQ, 2010-10-31) And: "A stock should normally have doubled before a BGU to make
  the BGU more likely to succeed." (FAQ, 2013-08-01) The exception is the bottom-fishing BGU (glossary): "the gap can
  occur coming out of a low base consolidation as a stock is trying to round out the lows".
- **Gap size.** The gap "should be at least 0.75 times the stock’s 40-day Average True Range" (glossary); the book says
  that calculation was used before and that eyeballing is now enough. "Small gap-ups are not what we are looking for
  here." (glossary)
- **Volume.** "A buyable gap-up move should occur on volume that is at least 1.5 times the average daily trading
  volume." (glossary) The book names the base: "which should be at least 1.5 times, or 150 percent of the 50-day" moving
  average of volume.
- **Quality.** Leading stocks with strong fundamentals, "or there should be a compelling thematic basis for
  consideration" (glossary; FAQ 2010-10-21).
- **The line.** "A buyable gap-up should hold above the intraday low of the gap-up day, and one can therefore use the
  intraday low of the gap-up day as a selling guide." (glossary) And: "it comes with a built-in selling guide, which is
  the intraday low of the gap-up day" (2013 book).
- **How much undercut ("porosity").** Four answers over 15 years:
  - The 2010 book, page 171, Rule #2, as their FAQ quotes it: "In the days following the gap-up, sell if the stock
    trades below the intraday low of the gap-up day." Then: "One can allow the stock to close first before deciding
    whether to sell on an intraday move below the gap-up day's intraday low." And: "Also watch for pullbacks just under
    the intraday low of the gap-up day that are close to and hence might find support at the 10-day, 50-day, or 200-day
    moving averages." The FAQ adds: "A 1-2% undercut can be permitted in some cases." (FAQ, 2010-10-24)
  - Their general sell-stop answer (FAQ, 2010-10-03; added in the second check): "Generally, after buying the gap up,
    if the stock trades under the low of the gap up day over subsequent trading days, we will sell at least half the
    position." A half, not all, on the first trade under the line.
  - The **6-day rule**: after five days, porosity "should be minimal to zero". "Normally, porosity for a stock that has
    gapped up is 1-2%, though contextual to the volatility of the stock." (FAQ, 2013-05-13)
  - The 2013 book: "allowing for some porosity to occur around the intraday low." And: "it can be prudent to use the
    intraday low plus 2–3 percent more on the downside to allow for a little bit of a fudge factor" (Introduction,
    page xxiii; their AAPL January 2012 example dipped "just a hair below" the gap-day low and kept going).
  - 2025: "You would use the low of each gap up day as your sell stop, giving perhaps a 2-3% undercut of the low of the
    gap day as wiggle room, depending on the volatility of the stock." (FAQ, 2025-07-03)
- **Entry, including the later pullback (the Gap Support entry).** "buying at the open or later in the day or waiting
  for a constructive retracement close to the low of the gap up day in subsequent days are all potential entry points."
  (FAQ, 2019-07-31) "Often, it may pull back in the days that follow, allowing for a second entry point." (FAQ,
  2012-07-25, updated 2025-02-11) "one may choose to buy on any constructive weakness in the days ahead which would reduce
  risk." (FAQ, 2017-08-10) In the book: "one could buy the stock on the gap-up day or the day after since the stock was
  still in range."
- **Invalidation.** "it is generally best to sell since buyable gap ups do not close their gaps." (FAQ, 2012/2025) "If a
  stock closes below the prior day's close, it usually invalidates the PP or BGU." (FAQ, 2018-11-08; this is about the
  gap day itself.)
- **Maximum risk.** "If your maximum risk is 7-8%, then you adhere to that rule first, and perhaps not buy that gap up
  because it is beyond your risk level." (FAQ, 2010-10-21; the same answer allows raising it to 9-10% for "a
  fundamentally and technically strong leader".)
- **Trail.** The Seven-Week Rule: "a stock must have not violated its 10dma for a minimum of 7 weeks to use the 10dma as
  your sell guide." (FAQ, 2010-09-19) Otherwise the 50-day. The clock "would be reset for a buyable gap up." (FAQ,
  2012-01-31) Their "violation" is not a single close: "A violation occurs when the stock closes below the 10dma, then in
  subsequent days, trades below the low of that day." (FAQ, 2010-10-03)
- **Trims.** Kacher, on using the Seven-Week Rule: "one can then sell perhaps at least half their position, booking
  profits" into an upside run, keeping a core position on the rule. (FAQ, 2014-09-06) No R multiple is given.
- **The short mirror.** The shortable gap-down: "The intraday high then becomes a covering guide." And: "This is the
  reverse of a BGU where the intraday low of the gap-up price range becomes your selling guide." (glossary)
- **Related: the undercut and rally.** "Once the stock undercuts a prior low in the pattern and rallies back above it, a
  long entry is generated at the prior low which is then used as a selling guide." (glossary) This is the owner's
  slight breach that closes back above (the bank lesson's wording of his ruling: "a slight breach that closes back above
  it is still good"; his own words were "slightly breached"), applied to the gap-up low.
- **Market.** "Performance is highly dependent on the health of the general market." (FAQ, 2014-02-25)

**Secondary report, not their words.** Tradingsim (John McDowell, 2021-11-18, updated 2026-03-31): "Gil Morales teaches
that if a stock retests the gap, give it a good 3-4% on the downside as a way to manage risk buying the pullback to the
low." That is wider than anything I found in their own text (1-2% or 2-3%). The repo's earlier research also cites a
TraderPlanet page (2013) with a 1% to 2.5% undercut inside five days; that page returned HTTP 500 today, so I could not
re-read it and give no wording from it.

### 3.2 Thomas Bulkowski, thepatternsite.com (measured statistics)

Read through a fetch tool (plain requests got HTTP 406; the same again in checking, and every quote below was re-read
through the fetch tool on 2026-11-09). **The site states it "shall not be used to train artificial intelligence (AI)
systems"**; it is cited here for research with links and short quotes only.
- **Gaps in general** (his gaps page, updated 2025-08-08): "Gaps are places of weak
  support or resistance, but you can use them for a stop location." Breakaway gap: "Starts a new trend and the gap often
  occurs on leaving a consolidation area". Trading: "Look for a high volume gap and trade in the direction of the
  trend." Stop: "Place a stop a few cents below the gap (upward breakouts) or above the gap (downward breakouts)."
- **Gauging Gaps** (no update date shown): gaps "don't work very well as support or resistance zones despite what candle
  lovers claim." The numbers are in section 4.1.
- **Rising window** (the candle name for a gap up): "Find a pattern in which yesterday's high is below today's low." No
  volume or size rule.
- **His reading of Kacher and Morales** (page *Kacher-Morales Setup*): gaps "at least 75% of the 40-day average true range
  (ATR)"; volume "at least 1.5 times the 50-day average"; "The up gap should occur in a constructive, fundamentally
  sound, leading stock." Stop: "Sell if price closes below the low posted on the day price gaps up." (A close, not an
  intraday trade, and no porosity.) Trail: the 10-day after seven weeks, else the 50-day (the 50-day always for
  semiconductor, retail and commodity stocks and those over $5 billion in market value). The page does not state the
  entry price. His source is their Active Trader article, not their books.

### 3.3 StockCharts ChartSchool (established educator)

- "Gaps and Gap Analysis" (no author or date shown; read 2026-11-09): on breakaway gaps, "The point of the breakout now
  becomes the new support (if it's an upside breakout) or resistance (if it's a downside breakout)." And: "Avoid falling
  into the trap of thinking this type of gap, if associated with good volume, will be filled soon." And: "Waiting for
  breakout or runaway gaps to be filled can devastate your portfolio." On volume: "It's better if the increase in volume
  happens after the gap occurs."
- *TA 101, Part 15*: "Up and down gaps can form on daily, weekly or monthly charts and are considered significant when
  accompanied with higher than average volume." Then the counterpoint: "Many investors mistakenly believe that gaps
  influence future prices to the point of eventually filling the gap." And: "However, gaps have little to no influence
  on price action weeks or months after forming."
- "Gap Trading Strategies" covers trading the gap day (full and partial gaps, first-hour ranges, 8% trailing stops). It
  says nothing about a later test; I list it only to show it was read. Its definition of a **partial gap up** ("today's
  opening price is higher than yesterday's close, but not higher than yesterday's high") matters in section 4.9: one of
  the owner's named "gap up lows" (INOD) is the low of a partial gap.

### 3.4 Tom Bowley, StockCharts *Trading Places*, 2015-05-27 (established educator; uses the words "gap support")

"Gap Trading: A Case Study" (VDSI, 2014). "For me, it's not about THE GAP.  It's about WHY did it gap and what happens
AFTER the gap?" On the breakaway gap: "These tend to be very powerful bullish signals and buying during a pullback or
consolidation makes solid technical sense." On a later continuation gap: "We've seen three successful tests of gap
support, which suggests this to be an excellent area to consider entry." He gives no stop, size or volume number. His
gap-fill reasoning (market makers shorting into gaps) is his opinion, not evidence. Note that his VDSI gap came out of a
three-year downtrend, a context the owner grades down (his QBTS ruling: "Eh B-").

### 3.5 Deron Wagner and Morpheus Trading (established educator)

Four articles read in full.
- **"How To Trade Breakaway Gaps For Huge Stock Gains"** (Deron Wagner, 2018-09-06). Base: "Breakaway gaps should occur
  following a valid basing pattern of at least four to five weeks in length." Volume: "On the day of the gap, volume
  should be at least three times greater than the 50-day volume average." Size: up more than 5% (and up to 20-25%) by
  the close. Filter: "Any stock that fills the opening gap should be avoided." Later entries: an inside day within a few
  days of the gap; "You could buy over the high of the day that tests and holds at support of the 10-day MA."; a two-day
  high; a reversal bar at the 20-day EMA; and, last, the 50-day, "as long as the gap was not filled." Stop in his BOOT
  example: "we followed our trade plan and stuck to the original stop price (below the low of the gap)." Caution: "Not
  all breakaway gaps hold or follow through to big gains".
- **"How To Score Monster Gains From Trading Breakaway Gaps"** (Wagner, 2019-12-30). Open "at least 4-5%" above the
  prior close; "However, an opening gap of more than 30% is a bit too much and could lead to a few months of chop, rather
  than immediate upside follow-through." Close above or near the open. Support: "Strong stocks that follow through to the
  upside often find support at the closing price of the original gap up." Trim: "We sold roughly one-third of our
  position into strength for a +29% gain on December 3."
- ***3 Proper Buy Entry Points to Score Big Gains from Breakaway Gaps*** (byline Rick, 2021-11-07).
  Volume: "Volume on the gap day should be at least 100
  to 200% greater than average (based on 50-day average volume)." Base: "A proper breakaway gap should jump out as the
  first, clear gap above a solid base of consolidation of at least four to five weeks." And: "Avoid buying a breakaway gap
  if the stock had already gapped up multiple times within the past few months." Third entry: "If you miss the first two
  entries above, the third potential entry point is a pullback to the high of the gap-up day." Their NVDA example used
  that third entry: a buy limit at $253 on the pullback to the gap day's high (not its low).
- ***Gap Trading Strategy: 5 Top Ways to Buy Stocks Gapping Up from Earnings*** (byline Rick, 2022-10-27).
  On the first pullback to the 10-day: "This is
  especially true when that touch occurs above the close of the gap up day, typically a strong area of support in a
  high-quality gap up." On the 20-day: "The 20-day EMA should be above the low of the initial gap up day (as it was in
  $SNAP)." On buying over the gap-day high: "This entry technique sometimes requires a wide stop down to the low of the
  gap up day".

Note the levels Morpheus calls support: the gap day's **close**, its **high**, and its **low** as the last line. That is
three different lines from one firm. None of the four articles names a moving average to trail with; they say only to
"trail them higher" (2019, 2021).

### 3.6 Kristjan Kullamägi (Qullamaggie), episodic pivot (originator; the gap day, not the test)

*3 TIMELESS setups that have made me TENS OF MILLIONS!* (qullamaggie.com, 2021-01-08, updated 2021-04-28):
"An EP needs to be a gap of 10%+ and big
volume should be there, if not in pre-market then the first 5-10 minutes after the open." Entry and stop: "Enter opening
range highs. ORH can be the highs of the first 1-, 5-, or 60-minute candle. The stop is at the lows of the day." Trail:
"Trail your stop with the 10- or 20-day moving average once they surpass your initial stop." (Earlier in the same EP
section: "Create your own sell rules. You can trail these with the 20- or 50-day moving average".) He gives no rule for
a later retest. Relevance: the gap day's low is his stop line, the same line the owner's setup defends later.

### 3.7 Pradeep Bonde (Stockbee), episodic pivot (originator; the gap day)

- Stop (his reply under "My process flow for Episodic Pivots (EP)", reply dated 2017-01-31): "Yes. It is normally low of
  the EP day."
- Gap size ("Gaps in 50% plus moves", 2024-09-27): "But if the gaps are more than 20%, the stocks pull back most of the
  time. Smaller gaps are better." This is his observation from his daily study, not a published statistic.

### 3.8 TraderStewie, power earnings gap (the best-known source of the PEG name; the gap day)

Whether he coined the name was not verified; he writes that "A few years ago, I "developed" this strategy".
*What is a Power Earnings Gap? & How to Trade it!* (2021-09-24, updated 2023-10-01):
a PEG is "A stock that gaps up after reporting strong
earnings and closes the day by printing a very strong candle." And: "The way the stock closes is equally, if not more
important than the actual initial gap open!" Entries come later, on flags, pennants and inside days: "Usually it takes
about 5 - 7 trading days for these technical patterns to develop." ("3 Trading Strategies for Power Earnings Gaps!",
2023-02-26) He gives no gap-low rule. Relevance: the owner calls the gap day a PEG, and Gap Support is one way to enter
a PEG later.

### 3.9 Other sources read

- **Adam Grimes**, "Gap Study (3/3)" (SMB Training blog, 2010-10-02): same-day gap closure statistics (section 4.4).
- **Bulkowski, "Good Earnings Surprise"** (event pattern; section 4.3).
- **StockCharts, "How to Profit from Strong Earnings Reports While Reducing Risk"** (John Hopkins, EarningsBeats.com,
  ChartWatchers, 2021-09-03): buying the knee-jerk dip after a report. Nothing about the gap-up low. Read, not used.

### 3.10 Searched for and not read

Steve Nison (windows as support; no copy); Edwards and Magee (no copy); the IBD article "The Breakaway Gap: How To Buy
Strength While Managing Your Risk" (only its first paragraph is public; the fetch tool was refused); Kacher and
Morales' 2011 Traders Expo handout on buyable gap-ups (the download host did not resolve) and their 2013 boot-camp video
on buyable gap-ups (no transcript could be fetched); TraderPlanet's 2013 buyable gap-up page (HTTP 500); Bulkowski's
book *Trading Basics*, the section on gaps showing support and resistance (O'Reilly, HTTP 403). In checking
(2026-11-09) the IBD page again gave only its first paragraph, the Traders Expo handout's host again did not answer, and
TraderPlanet again returned HTTP 500. Also searched in checking: TraderLion, Brian Shannon and Mark Minervini on a later
test of the gap-up low (no primary page found; the search turned up only secondary and script pages, not used), and a
*Technical Analysis of Stocks & Commodities* page on buyable gap-ups (technical.traders.com, `art=7236`; HTTP 403, so
its author, date and wording are unknown). In the second check a search for Brian Shannon's own anchored-VWAP writing
turned up one alphatrends.net address ("Anchoring the VWAP for better timing"), which returned HTTP 404, so nothing of
his is quoted. Nothing from any of these is quoted or used as a rule.

### 3.11 Comparison table

| Criterion | Kacher and Morales (BGU) | Bulkowski's reading of K-M | Wagner / Morpheus | ChartSchool | Bowley | Qullamaggie / Stockbee (gap day) | UCT owner (rulings + posts) | UCT scanner (`uct_gap_support.py`) |
|---|---|---|---|---|---|---|---|---|
| Prior trend | uptrend or constructive base, not a downtrend (bottom-fishing BGU the exception); ideally doubled before | trend up (tested by regression) | base of 4-5+ weeks (a gap over a 2-3 week pause is a "continuation gap", not what they look for) | breakaway: out of a base or after a decline | any; his example left a 3-year downtrend | neglected stock best (QM) | not in a downtrend (the log's note: above or reclaiming the 50-day) | none |
| Gap size | 0.75 x 40-day ATR, or eyeball | 75% of 40-day ATR | open 4-5%+; up >5% by close; >30% too much | not set | not set | 10%+ (QM) | no number stated by him; the bank's wording carries the scanner's 4% | open 4%+ over prior close, and a true gap (low over prior high) |
| Gap volume | 1.5x average | 1.5x 50-day | 3x (2018, 2019); 2-3x (2021) | above average | heavy | big, early (QM) | no number stated by him; the bank's wording carries the scanner's 2x | 2x 50-day |
| Gap-day close | above prior close | not set | above or near the open; never filled | not set | near the high | not set | "holds the gap" (bank wording) | above the prior day's high |
| Time to the test | any later day; porosity tightens after day 5 | n/a | days to weeks | not set (TA 101: gaps matter little weeks later) | not set | n/a | "days or weeks later" (bank wording) | 2 to 60 sessions |
| The line | gap-up day's intraday low | gap-up day's low, on a close | the gap day's close, high, low; the MAs | the breakout point | the gap zone | gap day's low | the gap-up day's low | prior high, gap-up low, or the midpoint |
| Undercut allowed | 1-2% (2010, 2013); 2-3% (2013 book, 2025) | none (a close under it sells) | none stated | n/a | n/a | n/a | "slightly breached" (his great and good examples went 0.7-7.5% under, section 4.8) | low may go anywhere if the close is over the level touched |
| Entry | at the open, later that day, or a retracement near the gap-up low | not stated | over the test day's high; over an inside day; 2-day high | n/a | on tests | opening range high (QM) | intraday reclaim, red-to-green, or an hourly signal | the close |
| Stop | the gap-up low less porosity; 7-8% max (9-10% for a strong leader) | close under gap-up low | below the low of the gap | n/a | n/a | low of the day | the test day's low ("risk to low of day") | the lower of the prior high and the test low |
| Trims | at least half into an upside run (Kacher, FAQ 2014) | none | a third into strength | n/a | n/a | none stated for EPs (QM) | house 3R/5R (B19, E51); Trade Story also stops at the post-gap high (his OK, 2026-11-09) | 2R, 3R; post-gap high (plan note) |
| Trail | 10-day if held 7 weeks, else 50-day | same | "trail them higher" (no average named) | n/a | n/a | 10- or 20-day | house: 10-day or 21-day (E52) | only "a tighter stop just under the gap top" if it drifts sideways (narrative and plan) |
| Invalidation | the gap closes; a break of the low after day 5 | close under gap low | the gap fills | n/a | n/a | n/a | a breach that does not reclaim | a close at or under the prior day's high |

### 3.12 Where the sources disagree

1. **Which line.** Kacher-Morales, Qullamaggie, Stockbee and the owner use the **gap-up day's low**. Morpheus also names
   the gap day's **close** (2019, 2022) and **high** (2021). Our scanner accepts the **prior day's high** (the fill spot)
   and the **midpoint**. The owner ruled for the gap-up low (2026-10-26), and his public levels match it (section 4.9).
2. **How much undercut.** None on a closing basis (Bulkowski's reading); 1-2% (K-M 2010, 2013); 2-3% (K-M 2013 book,
   2025); "3-4%" (Tradingsim's report of Morales); up to 5% (our finder's "slight breach"); his own good and great
   examples went 0.7% to 7.5% under on the test day (section 4.8).
3. **Close or intraday.** Bulkowski tests a close under the gap-up low; K-M let the stock "close first"; the owner's
   rule is about the reclaim; UCT posts use the intraday low of the test day as the stop.
4. **Time.** K-M tighten porosity to near zero after day five; the bank's wording of his definition says "days or weeks
   later"; our scanner allows 2 to 60 sessions; ChartSchool says gaps have "little to no influence" weeks or months later.
5. **Volume.** 1.5x (K-M), 2x (scanner, carried into the bank's wording), 2-3x (Morpheus 2021), 3x (Morpheus 2018 and
   2019). The owner has named no multiple, and several gaps he called support were on ordinary volume (section 4.9).
6. **Gap size.** Small gaps rejected by K-M; 4-5% minimum (Morpheus; 4% in our scanner and the bank's wording); 10%
   (Qullamaggie); big gaps (over 20-30%) pull back or chop (Stockbee, Wagner). My data agrees that over-30% gaps did
   worse (section 4.7).
7. **Entry.** The close (scanner), over the test day's high (Model Book card, Wagner at the 10-day), a reclaim during the
   day (UCT posts), a retracement near the gap-day low (K-M), or a buy limit on a pullback to the gap day's high (Rick's
   NVDA example, Morpheus 2021).
8. **Is it real support at all?** Bulkowski and ChartSchool are skeptical (20%; "little to no influence"). K-M, Wagner,
   Bowley and the owner trade it as support. The measured evidence (section 4) sides with the skeptics on average, which
   makes selection (leaders, market, the close of the test day) and a tight stop the whole game.

---

## 4. Measured evidence

### 4.1 Bulkowski: do gaps act as support? (thepatternsite.com; fetch tool; site notice against AI training)

- **Gauging Gaps:** "Gaps in an uptrend (rising windows) show underlying support 20% of the time in a bull market", and
  16% in a bear market. His explanation (re-read through the fetch tool in checking): "In other words, when price drops and
  stumbles upon a gap that happened in a prior up trend, price will reverse at or within the gap 20% of the time." For
  gaps down, overhead resistance held 25% (bull market) and 33% (bear market).
- **Rising window:** "Stopped in gap: 20%", defined as "the percentage of time that a minor low appeared within the gap
  before price closed the gap." Median time to close the gap: 11 days; average 79 days. Sample: "hundreds of perfect
  trades". No date range, volume filter or gap-size filter is stated.
- **Gaps page:** up breakaway gaps closed within a week 1% of the time (area gaps 85%, continuation 8%, exhaustion 60%);
  median time to close an up breakaway gap 89 days; "over 1,100 samples" combined, bull market.
- **Limits.** "Support" here means price turning *inside* the gap before filling it, a looser test than holding the
  gap-up low. Windows include every gap, with no volume or size filter. Gap types are labelled after the fact (my
  reading: an exhaustion gap, for example, is defined by later closing; ChartSchool's TA 101 also says one "should
  reverse soon after the gap and close the gap" to count). No costs, no dates.

### 4.2 Bulkowski's test of the Kacher-Morales rules (fetch tool)

557 stocks, daily data 2001-03-12 to 2010-10-01, 16 rule variants, selling on a close under the gap-up day's low or on a
moving-average violation. Results as printed: average gain 1.2% to 3.1%; "Win/loss ratio" 28% to 32%; average drawdown
5.5% to 8.9%; holds of 29 to 43 days. His words: "I don't like that you're losing two out of every three trades and the
3.1% gain includes stocks priced below $5." And: "I don't recommend this setup, but test it for yourself and make up your
own mind." He notes: "Since the authors didn't provide test results, I had nothing to compare against."
**Limits.** It tests buying the gap (the page does not say which day or price), not a later test of the gap-up low. It
skipped the fundamental filter and the breakout-from-consolidation step ("I did not test the breakout from consolidation
areas as outlined in step 3."); the trend was a linear regression over 5 to 40 days before the gap. It uses closes. One
stock (Insteel) lifted the best result: without it the best average gain drops from 3.1% to 2.6%.

### 4.3 Bulkowski, "Good Earnings Surprise" event pattern (fetch tool)

A large up move on earnings, bought on a close above the announcement-day high. Bull market: "Break even failure rate:
29%", "Average rise: 24%", "Throwback rate: 41%". "Failure rates are high. Almost half (48%) rise just 10% before
tumbling and that occurs in less than 2 weeks." **Limits.** A breakout entry above the earnings-day high, not a pullback
to its low. It is useful only as context: after an earnings pop, a return toward the gap is common.

### 4.4 Adam Grimes, same-day gap closure (SMB Training, 2010)

S&P 500 stocks, two years to 2010-10-01 (N = 125,811 stock-days): "Using all gaps, we see gap closure on 76% of all gap
days." But: "Large gaps (>5% or <-5%) close only 9.6% of the time. (N=279)" **Limits.** Closure within the gap day only;
large caps; no volume filter; up and down gaps pooled. It supports one point: a gap of more than 5% usually does not
close the same day, so a big gap is not the case where gaps reliably fill. (Grimes' cut is 5%; he gives nothing for
4% to 5%.)

### 4.5 What the originators say about their own results

Chris Kacher (FAQ, 2014-09-06): "William O'Neils, David Ryan (in the 80s), Gil's, and my success rates were typically
50% at best." That is a remark about all their trading, not a measured BGU statistic.

### 4.6 UCT's own earlier measurement (house, not published)

`docs/study/levels/evidence.md` and `evidence_kept.md` replayed the owner's own examples (40, then the 16 he kept). With
entry at the test day's close and the stop at the test day's low: median risk 4.4%, 2R reached on 95% (all 40) and 100%
(the 16 kept). **Limits** (stated there): chosen charts that were required to work after the test day, so the numbers are
high partly by construction. They describe his examples, not the setup's odds.

### 4.7 My measurement for this dossier (new; reproducible; not published, not peer reviewed)

**Method.** I re-implemented the scanner's rule (`uct_gap_support.evaluate`) in numpy and checked it against the real
function on six tickers: 388 of 388 fires identical, no extras either way (the checker repeated this on five other
tickers with the real function: 355 of 355). I ran it on every ticker in the app's local daily-bar store (3,897 tickers
at the time; read-only; the store held 4,284 when checked later the same day), for test days from 2010-01-01 with at
least 60 later sessions. Then I added
the owner's rules as the finder codes them (`scripts/study/find_gap_support_examples.py`): the test kind judged on the
gap-up low (held: low within 0.5%; slight breach: low up to 5% under it with the close back above; fill and reclaim:
low near the fill spot with the close above the gap-up low; otherwise failed) and "not in a downtrend" (the gap day
closed above a flat-or-rising 50-day). House filters: B23 (close at least $10, 20-day average dollar volume at least $20
million) and B26 (close above the 200-day). I kept the **first** fire for each gap. Trades risking under 0.5% of the price
were dropped as not executable. Two outcomes: (a) first-hit facts within 60 sessions (a session that reaches both the
stop and a target counts as the stop); (b) a **house-managed R**: a third off at 3R, a third at 5R, stop to breakeven
after 3R, the rest sold on a close under the 10-day after the first trim, a time stop (no trim and under 1R at the 10th
session's close, rule C33), and a stop gapped through filled at the open; capped at 250 sessions. No commissions or slippage.
(Checked: an independent re-implementation of this management on 300 random owner-version trades gave the same R on
all 300, and the main row and every split below re-aggregate exactly from the fire file. Breakeven at 3R sits inside
B19's "2R to 5R"; the trail uses the 10-day simple average.)

**Counts.** 117,477 fires on 19,717 distinct gaps in 3,228 tickers. Of all fires, **39% are "failed" by his definition**
(the test day closed back inside the gap, under the gap-up low), 37% held, 22% slight breach, 1% fill and reclaim,
1% a deeper breach that reclaimed. First fire per gap, liquid, above the 200-day, not in a downtrend: 5,618; with his
three kept kinds: **4,145 (the owner version)**; 3,727 of them after dropping stops closer than 0.5%.

**Results** (owner version; stop hit = the stop traded at some point within 60 sessions, even after a gain; 2R, 3R,
5R and "post-gap high" = reached before the stop; "house R" = the managed trade described above, clipped to -5R..+20R
per trade before averaging; "se" = its standard error):

| Entry | Stop | n | Median risk | Risk within 3% | Stop hit | 2R | 3R | 5R | Post-gap high | House R mean (se) | Winners |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| test day's close | a few cents under the test day's low | 3,727 | 2.0% | 69% | 86% | 36% | 28% | 20% | 28% | +0.09 (0.04) | 31% |
| test day's close | the scanner's: the lower of the fill spot and the low | 4,135 | 6.0% | 12% | 67% | 32% | 20% | 10% | 46% | +0.08 (0.02) | 43% |
| test day's close | 2% under the gap-up low (only where the test low stayed above it) | 3,749 | 3.4% | 36% | 79% | 37% | 28% | 16% | 38% | +0.11 (0.03) | 37% |
| next session's open | under the test day's low | 3,433 | 2.4% | 62% | 85% | 34% | 27% | 18% | 30% | +0.09 (0.04) | 30% |
| next session, a cent over the test day's high (2,036 of 4,145 triggered) | under the test day's low | 2,036 | 3.5% | 40% | 80% | 35% | 27% | 16% | 42% | +0.07 (0.04) | 34% |
| **Baseline 1:** a random liquid session above the 200-day (up to 40 sampled per ticker), its close | under that session's low | 87,014 | 1.6% | 77% | 91% | 33% | 26% | 17% | n/a | -0.03 (0.01) | 28% |
| **Baseline 2:** a generic pullback session (prior close 1 ATR under the 20-day high, an up day closing in the upper half, liquid, above the 200-day; up to 40 sampled per ticker), its close | under that session's low | 61,023 | 2.2% | 67% | 88% | 35% | 26% | 17% | n/a | +0.02 (0.01) | 29% |

**Splits** (owner version, entry at the close, stop under the test-day low; house R mean with its standard error):

| Split | n | Post-gap high reached | 3R | House R (se) | Winners |
|---|---:|---:|---:|---:|---:|
| Test kind: held (low no more than 0.5% under the gap-up low) | 2,346 | 26% | 28% | +0.08 (0.05) | 30% |
| Test kind: slight breach (low up to 5% under, close back above) | 1,324 | 33% | 28% | +0.10 (0.06) | 32% |
| Test kind: fill and reclaim (median risk 10.8%) | 57 | 37% | 23% | +0.07 (0.18) | 46% |
| *Excluded by him:* "failed" (closed under the gap-up low) | 1,215 | 20% | 29% | +0.09 (0.07) | 30% |
| Same kinds, but the test day **below** the 200-day (first fire, liquid; **no** 50-day trend filter) | 1,827 | 24% | 26% | -0.01 (0.05) | 28% |
| Same, below the 200-day **with** the 50-day filter (added in checking) | 535 | 22% | 24% | -0.07 (0.09) | 26% |
| Same kinds, above the 200-day, but the gap day in a 50-day downtrend | 572 | 27% | 26% | +0.07 (0.09) | 29% |
| Sessions since the gap: 2-5 | 1,856 | 35% | 28% | +0.11 (0.05) | 32% |
| 6-10 | 671 | 26% | 27% | +0.04 (0.08) | 31% |
| 11-20 | 520 | 22% | 26% | -0.12 (0.09) | 26% |
| 21-40 | 433 | 17% | 29% | +0.12 (0.10) | 32% |
| 41-60 | 247 | 17% | 33% | +0.41 (0.16) | 38% |
| Gap at the open: 4-8% | 1,982 | 30% | 28% | +0.09 (0.05) | 31% |
| 8-15% | 1,176 | 28% | 30% | +0.14 (0.06) | 33% |
| 15-30% | 448 | 25% | 27% | +0.00 (0.11) | 29% |
| over 30% | 121 | 17% | 24% | -0.14 (0.19) | 26% |
| Gap-day volume: 2-3x the 50-day | 1,218 | 31% | 28% | +0.13 (0.07) | 31% |
| 3-5x | 1,426 | 32% | 31% | +0.19 (0.06) | 34% |
| 5-10x | 828 | 24% | 26% | -0.07 (0.07) | 29% |
| 10x or more | 255 | 14% | 20% | -0.21 (0.13) | 23% |
| Test-day close in the lower half of its range | 1,356 | 15% | 28% | +0.01 (0.07) | 28% |
| in the 50-75% band | 1,053 | 28% | 28% | +0.13 (0.07) | 31% |
| in the top quarter | 1,318 | 42% | 29% | +0.13 (0.05) | 35% |
| The test low within 0.5 ATR of the 20-day EMA or 50-day SMA | 1,197 | 26% | 27% | +0.02 (0.06) | 29% |
| No moving average at the test low | 2,530 | 30% | 29% | +0.12 (0.04) | 32% |
| Later tests of the same gap (2nd and later fires) | 16,089 | 24% | 28% | +0.10 (0.02) | 31% |

Two more checks on the main row. **An early exit** when the next session neither hits the stop nor trades above the test
day's high (sell at that session's close) did not help: +0.06R (se 0.03) against +0.09R. **Speed of failure:** 34% of
trades hit the stop the very next session and 60% within five; 11% lost more than 1.05R because the stop was gapped
through (worst -16R, a gap far below the stop).

**The post-gap high as the first trim.** With the close entry and the test-day-low stop, the post-gap high sat a median
**3.7R** above the entry (25th percentile 2.0R, 75th 7.2R; median 7.5% above the close). It was **under 3R in 41%** of
trades and under 2R in 26%. It was reached before the stop in 28% of trades, as often as 3R (28%), both in a median of 4
sessions.

**What this shows.**
- **A small edge, not a strong one.** The owner version made +0.09R a trade (se 0.04) under house management, against
  +0.02R for a generic pullback day and -0.03R for a random day, before costs. That is about two standard errors over
  the pullback baseline: suggestive, not proof. Bulkowski's 20% "support" figure and his Kacher-Morales test point the
  same way.
- **Most trades lose, fast.** 31% winners, median -1R, the stop hit within 60 sessions on 86%, a third of them the next
  session. The result comes from the minority that run (20% reach 5R before the stop). Rule B19's trims and E52's trail
  are what turn that minority into the average.
- **His held / slight breach / failed split made no difference on the bars** (+0.08R, +0.10R, and +0.09R for the tests
  he would exclude). A daily-bar rule cannot see what his eye sees (the intraday reclaim, the hourly signal, the tape),
  so this does not show his ranking is wrong; it shows the ranking alone is not the edge.
- **What did separate results:** where the test day closes in its range (top quarter: the post-gap high reached 42% of
  the time against 15% for a lower-half close, and +0.13R against +0.01R); gap volume (3-5x best, 10x or more worst);
  gap size (8-15% best, over 30% worst). The 200-day only partly: on this entry and stop, +0.09R above it against
  -0.01R below (-0.07R, n = 535, with the 50-day filter), but with the other four entries and stops the below-200
  tests made +0.05R to +0.08R, close to the above-200 versions (the writer's summary file); so the 200-day split is not
  robust, and B26 rests on the house rule, not on this data. Moving-average confluence did **not** help on average,
  despite the UCT posts that like it.
- **The test-day-low stop fits the house** (2.0% median risk) and did as well per R as the wider stops. The scanner's
  fill-spot stop wins more often (43%) only because it is three times wider; it breaks A13.
- **No entry beat another.** Close, next open and over-the-high all landed within +0.07R to +0.11R of each other, inside
  their errors. The next-day trigger is informative (close entries whose next session took out the test high averaged
  +0.74R; those whose next session did not, -0.64R), but buying higher costs that edge back.
- **Time since the gap did not decay the result.** Tests 41-60 sessions later did best (small sample, wide error). That
  does not support a strict five-day window (K-M) or ChartSchool's "little to no influence on price action weeks or months after
  forming"; it
  does not prove the reverse either.

**Limits.** The bar store holds today's listed tickers, so delisted failures are missing (survivorship bias flatters
every row equally). Daily bars cannot see the intraday reclaim or the hourly signals the owner uses. The same-session
rule (stop before target) is conservative. The test kinds are the finder's numeric version of his words, not his eye, and
his own kept examples do not all pass them (section 4.8). Fires overlap in time (market-wide gaps cluster). The scanner
picks the most recent qualifying gap, which may not be the gap a trader would mark. Nothing here includes his RS, group
or fundamental filters (C31, D40), which may be where his edge lives.

### 4.8 His own ruled examples, measured on the bars

The ruled charts I could load, with the gap the scanner picks (or, for MSFT 2023-02-17, none found). "Low" and
"close" are the test day's, against the gap-up low; "fill" is the test low against the gap-fill spot. (Checked: the
real scanner re-run on the same bars reproduces every row; FTAI and VECO, missing at first, were in the store when
checked and are added at the end.)

| Example | His grade | Gap | Test low vs gap-up low | Test close vs gap-up low | Low vs fill spot | Sessions after gap | Above 200-day |
|---|---|---|---:|---:|---:|---:|---|
| META 2023-02-24 | great | 2023-02-02, +19.8% | -6.9% | -5.4% | +9.2% | 15 | yes |
| NVDA 2023-03-02 | great | 2023-02-23, +12.9% | -2.6% | +1.3% | +6.3% | 5 | yes |
| MU 2024-01-02 | great | 2023-12-21, +8.0% | -1.6% | -0.9% | +0.2% | 6 | yes |
| AFRM 2024-09-10 | great | 2024-08-29, +23.8% | -4.8% | -0.7% | +9.9% | 7 | yes |
| DOCS 2023-01-06 | great | 2022-11-11, +17.0% | -1.1% | +7.0% | +4.2% | 37 | **no** |
| AAPL 2024-05-08 | good | 2024-05-03, +7.9% | -0.7% | +0.0% | +4.6% | 3 | yes |
| EDU 2023-01-30 | good | 2023-01-19, +4.5% | -3.2% | -0.7% | -1.3% | 7 | n/a |
| KKR 2024-08-05 | good | 2024-06-10, +7.3% | -5.5% | +2.1% | -1.7% | 38 | yes |
| TWLO 2025-11-21 | good | 2025-10-31, +12.4% | -7.5% | -2.8% | 0.0% | 15 | yes |
| TER 2025-11-21 | good | 2025-10-29, +17.8% | -6.6% | -2.0% | +2.6% | 17 | n/a |
| ARGX 2024-11-19 | okay | 2024-10-31, +6.9% | -1.5% | +1.4% | +0.4% | 13 | n/a |
| CLS 2025-08-20 | okay | 2025-07-29, +7.6% | -5.4% | -0.1% | -0.3% | 16 | yes |
| KYMR 2026-01-20 | okay | 2025-12-08, +33.8% | -23.6% | -21.3% | -1.2% | 28 | yes |
| CAVA 2026-03-27 | okay | 2026-02-25, +15.9% | -5.9% | -2.3% | +4.5% | 22 | yes |
| UBER 2022-10-11 | okay | 2022-08-02, +15.8% | -15.4% | -9.0% | -6.8% | 49 | no |
| QBTS 2026-04-29 | okay ("Eh B-") | 2026-04-15, +9.2% | -3.7% | +2.8% | +0.1% | 10 | no |
| UAL 2024-02-06 | okay | 2024-01-23, +6.7% | -0.2% | +3.7% | +0.6% | 10 | no |
| TTD 2023-03-13 | cut | 2023-02-15, +16.4% | -11.8% | -4.9% | -0.8% | 17 | yes |
| AXP 2023-03-10 | cut | 2023-01-27, +7.0% | -0.4% | +0.1% | +4.2% | 29 | yes |
| LYFT 2021-11-15 | cut | 2021-11-05, +4.1% | -0.3% | +1.0% | +0.7% | 6 | no |
| BABA 2023-04-20 | cut | 2023-03-28, +10.7% | -2.2% | -1.4% | +2.1% | 16 | no |
| TTD 2022-01-04 | cut | 2021-11-08, +23.0% | +1.2% | +5.8% | +11.9% | 39 | yes |
| FMS 2024-03-14 | cut | 2024-03-05, +9.5% | -4.1% | -3.5% | +3.4% | 7 | n/a |
| FTAI 2026-05-19 (added in checking) | okay | 2026-04-30, +9.3% | -5.5% | -1.5% | -1.2% | 13 | n/a |
| VECO 2026-05-19 (added in checking) | okay | 2026-05-06, +25.7% | -8.8% | -4.0% | -0.4% | 9 | n/a |

"n/a": the local store holds fewer than 200 sessions before the test. FTAI and VECO reached the local store after the
first pass; on these bars both closed under the gap-up low on the test day, while the log's notes say they closed back
above it (the scanner may pick a different gap than the one on his chart, as for several rows above).

**What this shows.**
- His **great and good** examples undercut the gap-up low by 0.7% to 7.5% on the test day, and six of the ten measured
  ones **closed under it** that day (by 0.7% to 5.4%). So in practice "slightly breached" has meant up to about 7%
  intraday, and the reclaim has sometimes come the next session (AFRM closed 7.2% above the gap-up low the next day).
  The finder's numeric rule (close back above the gap-up low the same day) would call META, MU, AFRM, EDU, TWLO and TER
  failed. That is the biggest open definition question (section 10, Q1 and Q2).
- **TWLO 2025-11-21:** on these bars the test low (114.72) is one cent under the gap-fill spot (114.73). The log's note
  says it "never reached the gap-fill spot"; the bars say it tagged it. That matches his words on that chart: "That’s
  good but I want the gap up low to hold or be slightly breached instead of the gap fill spot btw".
- Several **cuts** are not about the line. AXP, LYFT and TTD 2022 held the gap-up low almost exactly and were still cut,
  for context (the log's note on AXP: "a test that is still falling on the cutoff bar"; LYFT: rolling over at the 50-day;
  TTD: the forward strip broke down). So the line alone does not make the grade.
- **DOCS (great) tested below the 200-day.** Rule B26 would forbid that trade. QBTS, UAL and UBER (okay) also tested below
  it.

### 4.9 Which line UCT means by "gap support" (UCT's named levels against the bars)

For 25 named prices, I listed every up-gap in the 90 sessions before the post (an open above the prior day's high, at
least 2% over the prior close, no volume test) and found the gap line nearest the named price. (Corrected in checking:
this said "every 3%+ up-gap on 1.5x+ volume", which is not the method used; five of the matches below fail that test.
Every price, date and post below was re-checked against the bars and the posts. In DDOG, BE, CRDO and GLW the named
price is a round level written next to the gap, e.g. "Watching $200 psyche and the gap support", so the match is
looser there.)

| Post (writer) | Words | Named | Nearest line on the bars |
|---|---|---:|---|
| ULTA 2025-12-14 (owner) | "gap support at $575" | 575 | gap-up low 575.00 (2025-12-05) |
| DDOG 2025-11-16 (owner) | "gap up low support" | 180 | gap-up low 177.57 (2025-11-06), 1.4% |
| DOCN 2025-11-23 (owner) | "right around the gap up low" | 42 | gap-up low 42.50 (2025-11-05), 1.2% |
| AAON 2026-05-24 (owner) | "the gap up low at $127" | 127 | gap-up low 125.23 (2026-05-07), 1.4% |
| CRCL 2026-05-24 (owner) | "gap support range" | 105-107 | gap-up lows 106.90 (2026-05-04) and 105.36 (2026-05-11) |
| FROG 2026-05-17 (owner) | "gap support at $62.50" | 62.50 | gap-up low 62.51 (2026-05-08) |
| AEHR 2026-05-17 (owner) | "the $80 gap support" | 80 | gap-up low 80.61 (2026-04-16) |
| QCOM 2026-05-17 (owner) | "bull gap support" | 190 | gap-up low 188.22 (2026-05-06); fill spot 187.22 |
| NOW 2026-09-13 (owner) | "$130 bull gap support" | 130 | gap-up low 130.25 (2026-08-27, a 3.7% gap on 1.3x volume), 0.2%; the 2026-06-01 gap (9.2%, 2.6x) has its low at 131.61, 1.2% (corrected in the second check: the first table gave only the June line) |
| SERV 2025-09-01 (owner) | "$10.50 bullish open gap" | 10.50 | gap-up low 10.51 (2025-08-27) |
| CGNX 2026-02-22 (owner) | "earnings gap up low" | 55 | gap-up low 55.00 (2026-02-12) |
| BE 2026-04-19 (owner) | "the gap support" | 200 | gap-up low 197.40 (2026-04-14, a 14.8% gap on 2.3x), 1.3%; a nearer line, 200.23 (0.1%), is the low of 2026-04-17, a session that opened 2.7% up above the prior high and closed back under it the same day (added in the second check) |
| CRDO 2026-04-19 (owner) | "gap support" | 150 | gap-up low 149.00 (2026-04-14) |
| MRVL 2026-06-14 (owner) | "$250 bull gap" | 250 | gap-up low 252.43 (2026-06-02) |
| MU 2026-04-26 (owner) | "$458 gap up lows" | 458 | gap-up low 458.56 (2026-04-22) |
| SMH 2025-08-17 (Index & ETF) | "$288.60 bull gap" | 288.60 | gap-up low 288.62 (2025-08-07) |
| SMH 2025-09-28 (Index & ETF) | "above $313" | 313 | gap-up low 312.60 (2025-09-18) |
| ARKK 2025-06-22 (Index & ETF) | "gap up low from Monday" | 63.70 | gap-up low 63.72 (2025-06-16) |
| TSLA 2025-12-21 (owner) | "a bullish open gap at $472.50 and $467.50" | 467.50 | gap-up low 467.66 (2025-12-15) |
| DELL 2026-04-05 (owner) | "gap support at $140" | 140 | gap-up low 136.11 (2026-02-27), 2.9% |
| TE 2026-05-24 (owner) | "$7 at that gap support" | 7 | gap-day close 7.00 (2026-05-18), or fill spot 6.97 (2026-05-20) |
| GLW 2026-05-17 (owner) | "previous highs and bull gap" | 180 | gap-day close 181.57 (2026-05-06); also the prior highs |
| HUT 2026-06-28 (owner) | "$107 bull gap support" | 107 | no open gap's low near it: the nearest gap-day low is 107.32 (0.3%) from 2026-06-09, a session that opened 2.8% up above the prior high and closed back under it the same day (not an open bull gap); the 2026-05-26 fill spot is 108.53 (corrected in the second check: this said "no gap-up low near it") |
| VELO 2026-05-24 (owner) | "gap support just below $16" | 16 | inside the 2026-05-13 gap (fill 14.72, gap-up low 16.61) |
| INOD 2025-06-22 (owner) | "$41 is the gap up low from Monday" | 41 | low 40.80 of Monday 2025-06-16, a **partial** gap (open 4.6% over the prior close but under the prior day's high of 41.82), 0.5% (corrected in checking: this said "no gap on that Monday") |

**20 of 25** named prices (17 of the owner's 22) sit within 1.5% of a gap-up day's low, counting INOD's partial gap;
one more (DELL) within 3%. The rest are a gap-day close (TE, GLW), inside the gap (VELO), or a fill spot (HUT; it would
be a 21st match if the low of a gap that failed the same day counted, which it should not). The
bars are the app's vendor data; his chart may differ by cents.

**The gaps behind those 20 matches** (checked on the bars, volume against the 50 sessions before the gap): 13 are big
gaps, 4.6% to 45.5% at the open, on 1.9x to 8.6x volume (all 2x or more except CRCL's 106.90 gap at 1.9x). Five are
small: MU 458.56 (3.0%, 1.1x), TSLA 467.66 (2.3%, 1.4x), SMH 288.62 (2.2%, 1.0x), SMH 312.60 (2.7%, 2.2x) and ARKK 63.72
(2.8%, 1.0x); NOW's $130 is nearer a 3.7% gap on 1.3x (130.25) than the 9.2% gap on 2.6x behind it (131.61), so it is
either; INOD's was 4.6% on 1.7x but not a true gap. So in his everyday writing "gap support" and "gap up low"
also cover small gaps on ordinary volume, which the scanner's 4% and 2x would never mark. Whether the lesson should
(section 10, Q13) is his call.

---

## 5. Our app: what the code actually does

### 5.1 `api/services/pattern_engine/detectors/uct/uct_gap_support.py` (pattern `uct_gap_support`; internal, admin-only)

Status: in `INTERNAL_PATTERN_IDS` (registry comment, shared by four setups added together, launch pad, gap support,
capitulation and go signal: "Lab-measured and independently blind-adjudicated" and "(86-92% precision)"; no figure for
Gap Support alone). Its member tag is **withheld** (`SETUP_TAG_MEMBER_WITHHELD` in `registry.py`): on the blind
recertification of 2026-10-24 it scored 0.92, then 2.27, then 2.14 against a pass mark of a pooled 2.4 (the registry
comment), and `tag_textbook.py` records that the recertification found "a "gap support" whose gap was already filled". Hard mode uses its `evaluate()` as the gate for this skill
(`api/services/study_hard.py`), and the bank's finder uses it too.

The rule, on session i (I checked my reading by re-implementing it; section 4.7):
- **The gap**, searched from i-2 back to i-60 (most recent first): the gap day's low above the prior day's high (a "true
  gap"); the open at least 4% over the prior close; volume at least 2x the 50-day average (ending the day before); the
  gap day closing above the prior day's high.
- **T1:** the prior close at least 1 ATR under the highest high since the gap (ATR = the 14-session simple average of
  true range, including session i).
- **Unfilled:** no close at or under the prior day's high since the gap day. (Closes inside the gap are allowed.)
- **T2:** the session's low comes within 0.25 ATR above one of three levels, the prior day's high ("top"), the gap-up
  low ("glow") or the midpoint between them, and closes above that level. A touch of only the gap day's open does not
  count: "Touching ONLY the gap-day open is a label, not a test".
- **T3:** the close is above the prior day's high.
- **Entry** the close; **stop** the lower of the prior day's high and the session's low; targets 2R and 3R
  (`make_levels`). The live scan looks at the last 3 sessions, newest first (`MAX_TRIGGER_AGE = 3`: today or up to two
  sessions back), and reports a trigger only if no later session traded through the stop.
- **Score:** geometry 70, plus 10 for a first test, 10 for a low within 0.5 ATR of the 9 or 20-day EMA or the 50 or
  200-day SMA, 5 for a gap of 8% or more, 5 if the "top" (the fill spot) was touched. Confidence = 0.40 geometry + 0.25
  volume + 0.20 context + 0.15 x 50, with a floor of 50.
- **Liquidity:** `liquidity_floor` ($2 price, $10,000 average dollar volume over 20 bars).

### 5.2 What looks wrong (for the owner and the next code change)

1. **"Gap top" is the bottom of the gap.** The code, the narrative, `study_trade.PLANS`, TRADE_PLANS.md and course V.05
   all say "gap top" for the prior day's high. The owner's level is the other line. Rename it "gap-fill spot" (his word)
   and call the gap-up low by name.
2. **It fires on the owner's failed gaps.** T2 and T3 only need a close over the level touched and over the prior
   day's high, so a test that closes inside the gap, under the gap-up low, fires. That is 39% of all fires (section 4.7).
   The bank's wording of his 2026-10-27 ruling: "a breach that does not reclaim is a failed gap".
3. **It rewards the fill.** A touch of the prior day's high adds 5 points; the owner ranks the fill last ("Prefer holding
   open gap vs filling gap btw").
4. **The midpoint counts as a test.** The owner never named the midpoint.
5. **No trend filter.** Nothing checks the 50-day or the 200-day. The owner's universe rule (not in a downtrend) lives
   only in the finder, and B26 (above the 200-day) nowhere: the finder only adds a point for it.
6. **Liquidity is far below B23** ($2 and $10,000 a day versus $10 and $20 million a day).
7. **The stop sits at the fill spot when the low held.** If the test low is above the prior day's high, the stop is the
   prior day's high: a median 6.0% away on the owner version, only 12% within 3% (A13).
8. **The confidence floor never binds.** The lowest possible score is 0.40 x 70 + 0.25 x 40 + 0.20 x 40 + 0.15 x 50 =
   53.5, over the floor of 50.
9. **The narrative's failure text is backwards.** It says "a full fill of the gap down to the gap day's low". A fill goes
   down to the prior day's high; the gap day's low is the first line, not the fill.
10. **The narrative's trail is a no-op in the common case.** "a tighter stop just under the gap top" is where the stop
    already is whenever the test low held above the prior day's high.
11. **The member tag text overstates it.** `setup_tags.py` defines the tag as "A pullback that tests an unfilled,
    high-volume gap up and closes back above the gap." The code only needs a close above the prior day's high, which can
    be inside the gap.
12. **The confidence rewards heavy volume on the test day** (found in checking). The volume part of the confidence is
    `volume_score(rvol50)`, the test day's own volume against its 50-day average (1x = 40, 3x or more = 100). So a test
    on heavy selling scores higher, while the narrative says "a quiet pullback into the gap followed by a firm close is
    the version traders like best" and warns about "heavy, rising selling volume". (It changes only the reported
    confidence, since the floor never binds, item 8.)

### 5.3 The bank finder: `scripts/study/find_gap_support_examples.py`

It uses the scanner as the gate and then codes his rulings: the test judged on the gap-up low ("held" if the low is
within 0.5%; `slight_breach` if within 5% and the close is back above; `fill_reclaim` if the low reaches within 2% of
the fill spot and the close is above the gap-up low; `breach_reclaim`, a deeper breach that still closes back above, is
labelled but not kept; anything else `failed`; only the first three are kept), `not_downtrend` (gap day above
a flat-or-rising 50-day), a "must work" forward check for teaching examples (and no close back under the fill spot in
the next 20 sessions), liquidity $10 and $20 million a day over 120 sessions, and a score
that ranks held over slight breach over fill. It matches his words; section 4.8 shows his own great examples would
partly fail its "close back above" condition.

### 5.4 The lesson overlay, the trade plan, Trade Story and the courses

- `app/src/pages/study/gapSupportOverlay.js` draws the gap-up low in gold with its price (his level) and the fill spot
  faint. Correct after his 2026-10-26 ruling.
- TRADE_PLANS.md (from `study_trade.PLANS`): entry "the close, as the gap holds"; stop "the gap top or the day's low,
  whichever is lower"; trim "2R, 3R; the post-gap high is the first place to take some off"; trail "if it drifts sideways
  at the gap, a tighter stop just under the gap top". Only the Kicker's plan is in the owner's own words; this row is the
  detector's.
- Trade Story (`app/src/pages/study/challenges/games/tradeStory.js`) stops at the post-gap high and the plan takes some
  off there. His OK of 2026-11-09 ("yes add those stops too, keep going") answered a question about adding the plans'
  named trim spots as replay stops; the trim note itself ("the post-gap high is the first place to take some off") is
  the detector's plan wording, not his.
- Course V.05 teaches "Our Gap Support buys the close as the gap holds; the stop is the gap top or the day's low,
  whichever is lower." and "If a Gap Support trade drifts sideways at the gap, the stop tightens to just under the gap
  top." Both carry the "gap top" naming problem, and the unit's "trim at 2R and 3R" is what rule B19 now replaces.
- `app/src/pages/study/studyPlainRules.js` has the plain card for this skill, not approved yet (`approved: false`), in
  the bank lesson's wording of his rulings.

### 5.5 The Model Book card and the journal tags

- **Card** (`app/src/pages/modelbook/setupCatalog.js`, family "Gaps & Catalysts", long): "The first controlled pullback
  into a prior up-gap" and "a candle holds the gap zone, proving it as support; entry over its high." The glyph draws the
  dashed trigger line at the gap bar's low (pivot index 5, side "l"), which is his line. Disagreements: the card says
  **first** pullback (the scanner allows any test, his rulings never say "first", and his kept DOCS and KKR tests came
  37 and 38 sessions after the gap); the card's entry is **over the test candle's high** (the scanner and the plan buy
  the close). The gap bar in the glyph has no gap value (the fourth number), so the drawing may show no gap at all; I did
  not render it.
- **Journal tags** (`app/src/constants/setupGroups.js`): there is **no "Gap Support" tag**. The nearest are "Power
  Earnings Gap", "News Gappers", "Episodic Pivot" and "HVC". A member who takes this trade cannot journal it by name.
- The Model Book playbook file (`setupPlaybooks.js`) has no Gap Support entry; its "20 EMA Pullback" playbook (an
  intraday entry) names "the gap fill" as a reference spot, the line the owner ranks last for this setup.

### 5.6 The brain's template "Open Bull Gap Support" (as stored in `docs/study/levels/brain_kb_2026-11-06.json`)

Entry: a dip into the gap zone with a quick reclaim, or a crossback confirmed by a hold candle the next day, or an inside
day just above the gap. Stop: "Low of day (LOD) on the entry candle, or below the bottom of the open bullish gap zone."
Max stop 8%. Trail the 20-EMA on growth names, the 50-SMA on larger ones. Invalidation: the gap closes on a closing
basis. Its 8% maximum stop conflicts with A13.

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com), read 2026-11-09: the sitemap lists 103 post
URLs plus the archive and about pages; 101 posts were readable in full; `sunday-scans-bf1` (2026-10-18) is
subscriber-only and `coming-soon` is a placeholder. Dates are Substack's publish dates. Writers are named by section, as
the earlier dossiers did: "TSDR’s Weekly Outlook & Watchlist" (with its "Current Positions" and "Charts Covered" parts),
"TSDR WATCHLIST" and "TSDR Trading" are the owner; "Bracco’s Breakdown & Top Ideas" is Bracco; "The Rest of the Week"
posts name each contributor in the section header; "Index & ETF" sections and "Thoughts on the Market" are unsigned.

**My counts** (every match in the readable posts, by section; recounted in checking from a fresh download of every
post body): "gap support" 41 times in 22 posts (owner 30, Index & ETF 10, Jersace 1; the first count said 42 and 31);
"bull gap", "bullish gap" or "bullish open gap" 94 times in 57 posts (Index & ETF 46, owner 39; the first count said 40
and named only "bull gap" or "bullish gap", which alone give 69); "gap up low" or "gap low" or "earnings day low" 16 times in 12 posts (owner 13). "Gap fill"
or "gap filled" appears 4 times and never in the owner's section.

### 6.1 The owner (Patrick, TSDR)

**The idea, in his words**
- "We want to see bull gaps stay open because it shows who is in control of the strength. Gaps act as support and
  resistance not as open price spots that need to be retraced. Know this." (TSLA, 2025-11-02,
  https://unchartedterritoryy.substack.com/p/sunday-scans-b99)
- "Study this Friday candle. The dip into bullish gap support and quick reclaim. This is a GO SIGNAL." (META, 2025-09-14,
  https://unchartedterritoryy.substack.com/p/sunday-scans-461)
- "I prefer key levels of support, 20EMA or 50SMA, notable bull gap holds or weekly levels, undercut and reclaims."
  (2026-07-05, https://unchartedterritoryy.substack.com/p/sunday-scans-dec) The same paragraph: "Buying supports getting
  that follow through and then moving stop to breakeven are some really good steps."
- "We know that recent ER gappers are some of the best opportunities when the market comes out of a correction so I am
  really dialed on those and prepared to take action." (DOCN, 2025-11-23,
  https://unchartedterritoryy.substack.com/p/sunday-scans-56d)
- "Exhibit A: Why earnings gappers are so important. This MXL from the day three undercut of earnings day low at $50 has
  gone on to double" (2026-05-17, https://unchartedterritoryy.substack.com/p/sunday-scans-679)

**The line is the gap-up low**
- "Simple post earnings look holding $180 and gap up low support, consolidating below $200." (DDOG, 2025-11-16,
  https://unchartedterritoryy.substack.com/p/sunday-scans-d6a)
- "Holding it’s earnings gap up low and consolidating on low volume." (CGNX, 2026-02-22,
  https://unchartedterritoryy.substack.com/p/sunday-scans-04c)
- "At a minimum hold $458 gap up lows." (MU, 2026-04-26, https://unchartedterritoryy.substack.com/p/sunday-scans-f2d)
- "Want range highs at $612 and gap support at $575." (ULTA, 2025-12-14,
  https://unchartedterritoryy.substack.com/p/sunday-scans-f2f)

**The undercut and reclaim (his "slight breach")**
- "Wednesday it undercut the ER gap up low and quickly got bought up then rest on Thursday followed by a bullish
  engulfing on Friday." (NBIS, 2025-08-24, https://unchartedterritoryy.substack.com/p/sunday-scans-ffa)
- "Clean pullback early in the week on Tuesday to undercut the earnings gap low and into the 20EMA now, just building out
  a nice flag and base here over $200." (NBIS, 2026-05-24, https://unchartedterritoryy.substack.com/p/sunday-scans-ffb)
- "HUT, gave a really awesome opportunity on that undercut below the gap up on Tuesday and a nice lower wick at the
  20EMA." (2026-05-24, same post)
- "Some nice undercuts and holds of the gap support after their 30%+ earnings gap up." (SNOW and its group, 2026-06-28,
  https://unchartedterritoryy.substack.com/p/sunday-scans-ae1)
- "The scenarios I am interested in next week early on are either a shakeout below 20EMA into the bullish gap that acts
  as an undercut." (OPEN, 2025-10-05, https://unchartedterritoryy.substack.com/p/sunday-scans-6ef)

**The entry and the stop**
- "Nice little lower wick on Friday and strong close. I think Friday was actionable with the risk to low of day and I
  think you can still take that trade." (AAON, above "the gap up low at $127", 2026-05-24, sunday-scans-ffb)
- "Look to the hourly for entry on a red to green early in the week." (DDOG, 2025-11-16, sunday-scans-d6a)
- "Tuesday’s oops at the gap support off that $95 area was attractive now looking for the stock to give it’s next
  signal. Lower wick and red to green ideal." (INTC, 2026-08-16, https://unchartedterritoryy.substack.com/p/sunday-scans-da5)
- "With the HVE (Highest Volume Ever), gap support, and the 20EMA with a strong hammer close this is worth of risk to
  Thursday’s low imo." (UMAC, 2026-06-21, https://unchartedterritoryy.substack.com/p/sunday-scans-bc0)
- "It gapped up 20% on earnings and has bulled back to the open gap and the 9EMA. Again, looking for an hourly higher low
  to build and trade against in the near term." (TWLO, 2025-11-09,
  https://unchartedterritoryy.substack.com/p/sunday-scans-720)
- "Massive ER Gapper. Took a loss on Friday, will look to buy gap support or a flag buildout." (TWLO, 2026-05-03,
  https://unchartedterritoryy.substack.com/p/sunday-scans-bcc)
- "Got long on the remount of the 50SMA, added on the gap hold of $200." (BE, 2026-04-26, sunday-scans-f2d) Note: an
  add, which rule A5 (no adding) now forbids.
- "I think if this comes down into the $190 zone, I think we can take a stab at that bull gap support, depending on how
  orderly and tight it is." (QCOM, 2026-05-17, sunday-scans-679)

**Confluence with the averages**
- "Classic beautiful pattern of a breakout on ER and consolidation into the MAs and gap support." (JAZZ, 2025-12-14,
  sunday-scans-f2f)
- "A healthy ema crossback into the bull gap support last week on Monday and confirmed with the hold on Wednesday."
  (HOOD, 2025-12-07, https://unchartedterritoryy.substack.com/p/sunday-scans-088)
- "Offered an awesome ads spot on Tuesday against the bull gap support, the previous ATH, and the 20 EMA." (GLW,
  2026-05-24, sunday-scans-ffb; "ads" as printed, read as "add")
- "Earnings gap up and consolidation into the rising moving averages and holding the gap." (CAVA, 2026-03-08,
  https://unchartedterritoryy.substack.com/p/sunday-scans-dcf)
- "Has been featured in SS since it’s earnings gap up and HVC (high volume close) at $148. Following that it pulled into
  the gap support at $140 and held." (DELL, 2026-04-05, https://unchartedterritoryy.substack.com/p/sunday-scans-356)

**The best and the warning cases**
- "Followed by four days of pullback into the 20 EMA and that gap support just below $16. Gave two absolutely perfect
  lower wicks at that support level, followed by a 3 day move of over 50%." (VELO, 2026-05-24, sunday-scans-ffb)
- "If this is strong and holds this $16 bullish open gap from earnings and the recent bull gap from being included in the
  midcap ETF then I want to be involved in a big way." (PATH, 2025-12-28,
  https://unchartedterritoryy.substack.com/p/sunday-scans-249)
- "Selling stalled at bull gap support but plenty of work remains." (MU, 2026-07-19,
  https://unchartedterritoryy.substack.com/p/sunday-scans-a52) The same post on MRVL: "Light volume selling. Selling
  stalled at bull gap support. In no man’s land." A gap that only stalls the selling is not yet a buy.
- On a gap against your stop (the same idea as rule B20): "I always use the first 30 min to let play out and establish
  the range." (2025-06-22, https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)

### 6.2 Index & ETF sections (writer not named)

- "Friday was a reasonable day to engage around $61 and LOD stop if you were looking to buy the gap down." (ARKK,
  2025-06-15, https://unchartedterritoryy.substack.com/p/sunday-scans-744; the sentence before it: "I continue to expect
  that open bullish gap from last Friday to remain open")
- "The “Gap Never to be Filled Again” was never a joke." (ARKK, 2025-09-14, sunday-scans-461)
- "Solid two lower wicks at gap support and a rising 200SMA and 50SMA. clear risk spot of 2% imo" (GDX, 2026-09-27,
  https://unchartedterritoryy.substack.com/p/sunday-scans-09b)
- "Pullbacks, gap support higher lows continue to provide an edge." (QQQ, 2026-10-11,
  https://unchartedterritoryy.substack.com/p/sunday-scans-31b)
- "An undercut and hold near the 20EMA and $288.60 bull gap would be awesome." (SMH, 2025-08-17,
  https://unchartedterritoryy.substack.com/p/sunday-scans-644)

### 6.3 Bracco

- "The great part about these setups was the Nasdaq contracting and building higher lows as these names hit oversold
  territory and subtle support levels such as open gaps, HVC’s, 50ma, etc." (2025-10-26,
  https://unchartedterritoryy.substack.com/p/sunday-scans-13e)
- "Had an alert set at the earnings gap fill but it held just above." (NBIS, 2026-09-06,
  https://unchartedterritoryy.substack.com/p/sunday-scans-fcd)
- "Defended the 5/4 bull gap and $100 level." (CRCL, 2026-05-31, https://unchartedterritoryy.substack.com/p/sunday-scans-6d8)
- The boundary: in a parabolic burst, unfilled gaps are a sign of a top, not support. "Two consecutive overnight gap
  ups. This can include the exhaustion gap on the climax day. Unfilled gaps left behind is a bonus." ("The Parabolic
  Short", 2025-06-13, https://unchartedterritoryy.substack.com/p/the-parabolic-short)

### 6.4 Other contributors ("The Rest of the Week")

- **The Wiz** calls his favorite setup the gap gotcha hammer: "Gap up, followed by an UnR of that gap candle low and
  closing back inside the bar with a hammer." Then: "Stop being the low of the day." That is the owner's slight breach
  and reclaim, seen within days of the gap.
  (2026-01-07, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0)
- **Camden:** "This is exactly what you want to see after a strong earnings gap: expansion, digestion, and a controlled
  retest of the breakout spot." (FROG, 2025-11-19, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c)
- **ChartMaster:** "After a beat and raise this one is holding the bullish gap after making the pivot today." (NXT,
  2025-11-05, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9)
- **Jersace:** "Just a nice technical chart as it flags back into gap support & MA’s." (SEI, 2026-03-25,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-ecf)
- **Alex Jones Industrial Average** (a contributor's section name; corrected in checking, this was given as Jersace):
  on BABA, "holding gap up support from the candle back in September", with "a stop below today LOD" (2025-12-17,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-4fe).
- **Manrav:** "Ideally would like to see it reclaim the launch pad (8,21 and 50 SMA) to initiate a long for managing the
  risk or watch for the bullish gap from 11/10 to hold." (OPEN, 2025-11-19, the-rest-of-the-week-72c)
- **Thoughts on the Market (unsigned):** "Monday gap up low my line in the sand." (2025-11-26,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a)

### 6.5 The owner's rulings in the verdict log (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

- The line (2026-10-26): "That’s good but I want the gap up low to hold or be slightly breached instead of the gap fill
  spot btw"
- The test, not the gap day (2026-10-26): "Never really tested gap support" and "Just a PEG".
- The universe (2026-10-27): "Don’t want to do downtrend gaps but will do bear gaps off the highs"
- The ranking (2026-10-27): "Prefer holding open gap vs filling gap btw". The log records the ranking: gap-up low held,
  then a slight breach, then a fill that reclaims; a fill that does not reclaim is out.
- Context grades: "Eh B-" (QBTS, out of a long downtrend, under the 50-day); KKR "Yeah this is good because it’s a little
  subtle"; ARGX "It’s correct but think there are better examples" (it never came back to the gap).
- Bank v2 (2026-11-06): "I do not want to fire the failed events" (setups that fired and then failed are not shown as
  lessons; the 532 Gap Support drafts of that kind were removed).
- The replay stops (2026-11-09): "yes add those stops too, keep going", answering whether Trade Story should also
  stop at the plans' named trim spots (Gap Support's post-gap high, the High Volume Edge's return to the high-volume
  close). It approves the game stop; it is not a ruling that the post-gap high replaces the 3R trim of B19.
- The levels dossier (`docs/study/levels/dossiers/gap_support.md`) quotes in-house Discord passages (KB numbers) that
  agree: "Every in-house example uses the low of the test day." I did not re-read the private knowledge base. In the
  public posts the same holds wherever a stop is named at gap support: the AAON and UMAC posts (owner), ARKK (Index &
  ETF), The Wiz and BABA (contributors).
- Not his words: the 4% and 2x in the bank's definition (the scanner's numbers, set 2026-10-16, before these rulings),
  "days or weeks later", "holds the gap", and the log's notes (the `nuance` lines, written by whoever recorded the
  sitting). His own words are the `owner_words` quoted above; many grades were menu picks with no words.

### 6.6 Example candidates for his 10 examples

From UCT posts; the line was checked on bars in section 4.9; the outcomes were not checked.

ULTA 2025-12-05 gap (575.00), DDOG 2025-11-06 (177.57), DOCN 2025-11-05 (42.50), FROG 2026-05-08 (62.51), AEHR
2026-04-16 (80.61), CGNX 2026-02-12 (55.00), CRDO 2026-04-14 (149.00), MRVL 2026-06-02 (252.43), AAON 2026-05-07
(125.23), CRCL 2026-05-04 (106.90), MU 2026-04-22 (458.56; a 3.0% gap on 1.1x volume, so it would fail a 4%/2x rule),
NOW 2026-06-01 (131.61; or its 2026-08-27 gap, 130.25, a 3.7% gap on ordinary volume), BE 2026-04-14 (197.40), and
the NBIS 2025 and 2026 undercuts. From his own ruled set (section
4.8): NVDA 2023-03-02 and AAPL 2024-05-08 are the cleanest by his grades (great and good, both menu picks; held or barely
breached, closed back above, above the 200-day); AFRM, MU and META are "great" but closed under the line on the test day.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | What it says | Fit for Gap Support |
|---|---|---|
| A3, F62 | Stop a few cents under the day's low or the prior day's low | Fits: the test day's low is the natural stop, and every stop UCT names at gap support is that low (section 6.5). |
| A13 | Stops usually within about 3% | Fits with the test-low stop (median risk 2.0%, 69% within 3%). Fails with the scanner's stop (median 6.0%, 12% within 3%) and with the brain template's 8% maximum. |
| A5 | Full size at one price; no adding | The owner's own BE post describes an add at the gap hold. Under A5, a gap test is a new trade, not an add. |
| E57 | Market orders | Close entry = a market order near the close; next-day entry = a market order at the open or a buy-stop. Both fit. |
| C28 | Never more than 4% past the buy point | The buy point must be named: the test day's close, or its high (section 8.2). |
| C29 | Skip a long more than 10% over its 10-day | Rarely binds at a test (median 0.7% over the 10-day), but 7% of owner-version tests are over 10% (fast stocks a few days after a big gap). |
| B23 | $10 and $20 million a day | Not in the scanner; in the finder. |
| B26 (hard) | No longs below the 200-day SMA | Conflict: his "great" DOCS test was below it, and QBTS, UAL, UBER (okay) too. In my data the below-200 tests did worse on the main entry and stop only; on the other four they were close (section 4.7). |
| C31 | Leaders, RS 80+ | Fits the sources (K-M "leading stocks"; Morpheus limits these trades to stocks with "strong earnings and revenue growth"). Not in the scanner. |
| B19, E51 | A third at 3R (hard), a third at 5R; breakeven 2R to 5R | Conflict with the plan's trim note at the post-gap high (a Trade Story stop since 2026-11-09), which is under 3R in 41% of trades (section 4.7). |
| E52 | Trail the 10-day (fast) or 21-day | Fits. K-M's Seven-Week Rule (10-day, else 50-day) is the originators' version. |
| B20 | A gap through the stop: first 30-minute low | Applies; a test near earnings season can gap. |
| B22 | No new buys in the 3 days before earnings | Matters for late tests: 60 sessions after an earnings gap is about the next report. |
| C33 | Under 1R after 10 trading days: sell | Applies; included in my house-managed R. |
| D47 | Shorts are the longs reversed | A mirror exists in principle (section 8.6); the app has none. |
| E50 | Grading is discretionary | Section 9 gives cues, not a checklist. |

---

## 8. Proposed rules for our course

Every line is measurable from daily bars unless it says otherwise.

### 8.1 What it is

- **The gap.** An up-gap day: the open at least 4% over the prior close, the whole day above the prior day's high (a
  true gap), volume at least 2x the 50-day average, and the close above the prior day's high. [UCT] (the scanner's
  numbers and true-gap test, carried into the bank's wording of his definition; he has not stated a number himself)
  Sources differ on volume (1.5x to 3x). [source consensus on heavy volume: K-M 1.5x, Wagner 3x, Morpheus 2021 2-3x]
  His own posts also call 2-3% gaps on ordinary volume "gap support" (section 4.9): whether the lesson keeps 4% and 2x
  is a question for him (section 10, Q13).
- **Gap size.** 4% minimum [UCT scanner]. Treat a gap over 30% as a lower grade, not a rule. [source consensus: Wagner
  (over 30% "a bit too much"), Stockbee (over 20% "pull back most of the time"); my data, section 4.7]
- **Catalyst.** Earnings or major news preferred, not required. [UCT] (his PEG framing; "recent ER gappers are some of
  the best opportunities")
- **Prior trend.** The gap day closes above a flat-or-rising 50-day SMA. [UCT] (his words: "Don't want to do downtrend
  gaps", 2026-10-27; the 50-day test is the finder's way of measuring it, and the log's note says "above or reclaiming
  the 50 SMA"; K-M "not while a stock is in a downtrend") And the test day closes above the 200-day SMA. [house rule B26]
- **The pullback.** At least 1 ATR off the post-gap high. [UCT scanner]
- **Timing.** The test comes 2 to 60 sessions after the gap day. [UCT scanner; the bank's "days or weeks later"] Recommend:
  allow the whole window, and grade a first test inside about 4 weeks above later ones. [my proposal] (K-M tighten after
  day 5; his DOCS and KKR tests came about seven to eight weeks later and he rated them great and good.)
- **The gap is still open.** No close at or under the gap-fill spot (the prior day's high) since the gap day. [source
  consensus: K-M "do not close their gaps"; Wagner "as long as the gap was not filled"; the scanner]
- **The test day.** The low reaches the gap-up low (within 0.25 ATR above it) or undercuts it by up to 5%, and the close
  is back at or above the gap-up low, or within 1% under it. [UCT] (his ruling; the finder's numbers; the 1% is my
  proposal, from his AFRM, MU and EDU examples) The owner must settle how much under and whether a close just under it
  counts (section 10, Q1 and Q2): his own great and good examples went up to about 7% under and six closed under.
- **The test day closes in the upper half of its range** (a lower wick or a hammer). [my proposal] (his words "lower
  wick", "strong hammer close", "quick reclaim"; my data: tests closing in the top quarter of the range reached the
  post-gap high about three times as often as tests closing in the bottom half)
- **A fill to the gap-fill spot that reclaims the gap-up low** is allowed but graded B- at best. [UCT]
- **Liquidity.** Close at least $10 and at least $20 million traded a day. [house rule B23]
- **Leaders.** RS rating 80 or more, in a strong group. [house rule C31] (K-M "leading stocks")

### 8.2 The buy

Options, with the evidence:
- **A. The test day's close** (market order in the last minutes, once the close is clearly back over the gap-up low).
  The scanner's entry; the tightest stop. [UCT scanner]
- **B. The next session's open** (market order). [my proposal]
- **C. A buy-stop a cent over the test day's high, next session only.** The Model Book card and Wagner. [UCT] (the
  Model Book card; one outside source agrees, Wagner 2018 at the 10-day: "buy over the high of the day that tests and
  holds at support", so this is not a two-source consensus)
- **D. Intraday on the test day** (the undercut and reclaim of the gap-up low, a red-to-green, an hourly higher low).
  What UCT's posts describe. Not measurable from daily bars. [UCT]

**Recommendation: A, the test day's close, as the course default.** [my proposal] It keeps the stop tightest (median
2.0%, 69% within 3%, rule A13), it is what the scanner and the plan already use, it is a market order (E57), and no
other entry did better in section 4.7 (all five variants landed between +0.07R and +0.11R, within each other's error).
Take it only when the close is back at or above the gap-up low (or within 1% under it, section 8.1) and in the upper
half of the day's range. The buy point
for rule C28 is the test day's close. **If the owner prefers a trigger over a high** (as in his Kicker ruling), C is
the alternative: it costs about 1.5 points of extra risk (median 3.5%, only 40% within 3%), half the setups never
trigger, and the result per R was no better. Its C28 buy point is the test day's high. D stays what the owner does
live; the course can teach it as the discretionary version of A, with the same stop.

### 8.3 The stop

- **A few cents under the test day's low.** [house rule A3, F62] [UCT] (every stop UCT names at gap support: "risk to
  low of day" (owner), "LOD stop" (Index & ETF), "Stop being the low of the day" (The Wiz)) [source consensus on the
  entry day's low as the stop] (Qullamaggie and Stockbee, though for them the entry day is the gap day itself)
- **Not** under the gap-fill spot: a median 6% away, which breaks A13 and wins less often per R. [my proposal]
- **Not** a fixed porosity under the gap-up low (K-M's 1-2% or 2-3%): his slight breaches are often deeper than that,
  so the stop would sit above the test day's low. [my proposal]
- If the honest stop is more than about 3% away, size down (A5) or skip it (A3). [house rule]

### 8.4 Trims and trail

- **First trim.** The house rule is a third at 3R (B19). The detector's plan names the post-gap high as "the first place
  to take some off", and since 2026-11-09 Trade Story stops there with his OK (section 6.5); he has not ruled it a trim
  rule over B19. They agree when the post-gap high is 3R or more away (59% of trades) and conflict otherwise.
  Options for him in section 10 (Q5). My recommendation: a third at the post-gap high **or** 3R, whichever is
  **higher**, so the 3R hard rule always holds and the post-gap high is honored when it sits above 3R. [my proposal]
- **Second third** at 5R. [house rule E51]
- **Breakeven** somewhere from 2R to 5R ("19 breakeven stop at 2-5R ideally"). [house rule B19] (The replay in
  section 4.7 moved it at 3R, with the first trim.)
- **Trail** the rest under the 10-day (fast movers) or the 21-day (steadier), sold on a close below it. [house rule E52]
  K-M's version: the 10-day only after seven weeks without a violation, else the 50-day. [originator]
- **Time stop:** under 1R after 10 trading days, sell. [house rule C33]

### 8.5 What invalidates it

- Before entry: a close at or under the gap-fill spot (the gap filled) ends the setup. [source consensus] A close under
  the gap-up low that is not reclaimed (by the same close, or the next one if the owner allows it) is a failed gap.
  [UCT]
- Before entry: the test day is still falling into the close (no hold, no reclaim). [UCT] (AXP cut: "a test that is still
  falling on the cutoff bar (no hold, no reclaim) is not the setup", the log's note)
- Before entry: the test day closes under the 200-day. [house rule B26]
- After entry: the stop trades (or the open gaps through it: rule B20). [house rule]
- Heavy-volume selling into the line is a warning, not a rule. [my proposal] (his MRVL "Light volume selling. Selling
  stalled at bull gap support." is the healthy version)

### 8.6 The short mirror ("gap resistance")

A stock below its 200-day gaps **down** at least 4% on 2x volume and closes below the prior day's low; days or weeks
later it rallies back up to the gap-down day's **high** and fails there; short with a stop a few cents over the test
day's high. [house rule D47, B26] [my proposal] K-M define the gap-day version:
"The intraday high then becomes a covering guide."
[originator] The owner's Bear gap lesson marks the gap day, not the retest, and he said "Don't want to do downtrend gaps"
for this setup's longs. Whether to build the retest short is his call (section 10, Q9). There is no detector for it.

### 8.7 Best market conditions

- A Green market reading (B18, F65). [house rule] "Performance is highly dependent on the health of the general market."
  [originator, K-M FAQ]
- Earnings season and the weeks after a correction, when earnings gappers lead. [UCT] ("recent ER gappers are some of
  the best opportunities when the market comes out of a correction")
- The group's ETF holding its own gap or 50-day (the brain template's regime rule). [UCT, brain template]

### 8.8 Common mistakes

1. Buying the gap day and calling it Gap Support. [UCT] ("Just a PEG")
2. Buying a gap that was never tested. [UCT] ("Never really tested gap support")
3. Using the gap-fill spot as the line, or putting the stop under it. [UCT] (TWLO ruling) [my proposal] (median 6% risk)
4. Buying a test that is still falling into the close. [UCT]
5. Buying gaps in a downtrend or under the 200-day. [UCT] [house rule]
6. Expecting every gap to fill and waiting for the fill. [source consensus: ChartSchool
   "Waiting for breakout or runaway gaps to be filled can devastate your portfolio."; K-M "buyable gap ups do not close
   their gaps"]
7. Treating any gap as strong support. [source consensus: Bulkowski 20%; ChartSchool "little to no influence"]
8. Very large gaps (over 30%) and blow-off gaps at the end of a parabolic run. [source consensus: Wagner, Stockbee,
   Bracco]
9. Adding at the gap hold. [house rule A5]
10. Re-buying the same failed line again and again. [house rule E56: 3 tries a week, 6 a month]

---

## 9. Grading (observable cues from the sources and his rulings; rule E50 says grading is his judgment)

**A+ cues**
- A leader (RS 80+, strong group) with an earnings gap of roughly 8% to 15% on about 3x to 5x volume, closing near the
  high, out of a base or a constructive uptrend. (K-M "leading stocks"; Wagner's base and 3x minimum; Stewie's strong
  close; in section 4.7, 8-15% gaps and 3-5x volume did best, while 10x volume or more and gaps over 30% did worst)
- The first test, days to a few weeks later, on a quiet pullback (lighter volume), above a rising 50-day and 200-day.
  (Wagner "lighter volume"; his CGNX "consolidating on low volume")
- The gap-up low holds to the tick, or a small undercut, and the day closes back above it near its high with a lower wick
  or hammer. (the log's notes on his AFRM, NVDA and DOCS ratings; his UMAC post, "strong hammer close")
- The 20-day EMA or 50-day arriving at the same line (the log's note on DOCS; his JAZZ, HOOD and CAVA
  posts). My data did not show
  this helping on average, so it is a tiebreak, not a requirement.
- Tight risk (under 3%) in a Green market.

**B- cues**
- The gap came out of a downtrend or under the 50-day (his QBTS "Eh B-", FTAI "okay").
- A fill to the gap-fill spot that reclaims (UBER "okay", "Prefer holding open gap vs filling gap btw").
- Weeks of chop sitting on the line before the test (TTD 2023, cut; the log's note: "a month of sideways chop ON the gap
  top before the test"). A long drift back *to* the line is not a minus by itself: DOCS (great) came 37 sessions after
  its gap.
- A very large gap (over 30%), a later test of an already-tested line, or heavy selling volume into the line.
- A close in the lower part of the test day's range.

---

## 10. Questions for the owner

1. **How much breach is "slight"?** Options: (a) up to 2% (K-M's porosity); (b) up to 3%; (c) up to 5% (the finder);
   (d) up to about 7.5% (your own great and good examples: META 6.9%, TWLO 7.5%). Recommend (c) for the lesson, with
   your META and TWLO cases noted as the outer edge.
2. **Must the test day close back above the gap-up low?** Your great AFRM (-0.7%) and MU (-0.9%) closed just under it,
   and META (-5.4%), TWLO (-2.8%) and TER (-2.0%) further under. Options: (a) yes, the same day; (b) within 1% is fine;
   (c) a reclaim by the next session's close counts. Recommend (b): it keeps your AFRM, MU and EDU examples, and on the
   bars the tests that closed under the line did no worse than the ones that held (section 4.7). Deeper closes under the
   line (META, TWLO, TER) would then count only after a reclaim, as lesser examples.
3. **The entry.** (a) the test day's close; (b) the next open; (c) a buy-stop over the test day's high; (d) intraday
   reclaim. Section 8.2 gives the numbers. Your Kicker ruling chose a trigger over a high.
4. **The stop.** (a) under the test day's low (recommended: every in-house example, A13); (b) under the gap-up low less
   1-3% (K-M); (c) under the gap-fill spot (the scanner today).
5. **The first trim.** (a) a third at 3R always (B19 hard rule), the post-gap high only as a note; (b) a third at the
   post-gap high or 3R, whichever is higher (recommended); (c) a third at the post-gap high even when it is under 3R
   (this changes B19 for this setup).
6. **The 200-day.** DOCS 2023-01-06, one of your five "great" examples, tested below the 200-day. Keep it as a great
   example with a note that the account would not take it (B26), or replace it?
7. **Later tests.** Allow second and third tests of the same gap, or first test only (the Model Book card says first)?
8. **Earnings only?** Should non-earnings gaps (news, index adds, PATH's midcap inclusion) count?
9. **The short mirror.** Build a "gap resistance" short (a failed rally back to a gap-down day's high, below the
   200-day), or leave shorts to the Bear gap lesson?
10. **The scanner** (a code change needs your OK): rename "gap top" to "gap-fill spot"; stop firing on tests that close
    under the gap-up low; stop scoring a fill as a plus; drop the midpoint test; add the 50-day, 200-day and B23 filters;
    move the stop to the test day's low; fix the narrative's fill sentence; stop the confidence rewarding heavy volume on
    the test day (section 5.2, item 12).
11. **The journal.** Add a "Gap Support" tag so members can log the trade by name?
12. **The time window.** Keep 2 to 60 sessions, or cap it (K-M tighten after day 5; your DOCS and KKR tests came 37 and
    38 sessions later)?
13. **How big a gap?** (added in checking) The 4% and 2x in the lesson are the scanner's numbers, not yours. In your
    posts, MU's $458 "gap up lows" was a 3.0% gap on 1.1x volume and TSLA's $467.50 "bullish open gap" a 2.3% gap on
    1.4x (section 4.9). Options: (a) keep 4% and 2x for the lesson; (b) any true gap the stock holds, graded higher when
    it is big and heavy; (c) another number.

---

## 11. Sources (all read on 2026-11-09 unless marked)

**Outside sources**

| # | Source | Publisher / author | URL or location | Reliability note |
|---|---|---|---|---|
| 1 | *In the Trading Cockpit with the O'Neil Disciples* (2013), Introduction, "Buyable Gap-Ups" (pages xxi to xxiv) | John Wiley & Sons; Gil Morales and Chris Kacher | Free 43-page preview of the ebook (PDF creator field: Rakuten Kobo): https://api.pageplace.de/preview/DT0400.9781118287293_A23567645/preview-9781118287293_A23567645.pdf (re-downloaded and re-extracted in checking; re-extracted again with pdftotext in the second check, which is where the six quoted passages were confirmed) | High: the originators' own book. |
| 2 | "Glossary & Trading Methods" and "About" | TheOWLTrader.com; Gil Morales | https://theowltrader.com/glossary-trading-methods/ ; https://theowltrader.com/about/ | High: the originator's own site (the about page is signed "Gil Morales"). Undated. |
| 3 | FAQ, "Pocket Pivot Review / Buyable Gap Ups" (16 answers cited, dated 2010-09-19 to 2025-07-03; the writer read 22; the category page lists 69) | Virtue of Selfish Investing (MoKa Investors, LLC); Kacher and Morales | https://www.virtueofselfishinvesting.com/faqs/category/pocket-pivot-review-buyable-gap-ups ; answers under https://www.virtueofselfishinvesting.com/faqs/answer/ : `how-best-to-handle-a-bgu`, `stocks-that-undercut-the-low-of-the-gap-up`, `what-is-the-6-day-sell-rule-for-bgus`, `what-if-a-stock-gaps-up-then-some-days-later-gaps-up-again`, `should-i-buy-a-buyable-gap-up-at-the-open-or-wait-until-later-in-the-trading-day-what-about-buying-in-subsequent-days-on-pullbacks-stop-loss`, `when-a-stock-has-the-wild-action-nvta-is-having-today-11-8-18-should-it-be-dropped-from-our-buy-watch-list-or-should-it-be-kept-for-a-new-pp-or-bgu-signal-much-later-obviously`, `should-a-stock-that-has-a-buyable-gap-up-have-at-least-doubled-in-price-from-its-lows-to-its-highs-before-the-bgu-day-for-the-bgu-to-work`, `when-applying-the-7-week-rule-do-you-start-counting-the-weeks-only-after-the-stock-has-broken-out-of-a-base-or-is-it-from-the-first-time-it-closes-above-the-moving-average`, `under-which-scenarios-would-the-7-week-clock-be-reset-for-a-stock-would-it-be-reset-on-each-continuation-pocket-pivot-or-buy-able-gap-up`, `do-you-have-performance-results-over-the-years-of-the-pocket-pivot-review-and-the-buyable-gap-ups`, `did-you-use-the-7-week-rule-or-something-similar-during-your-period-of-super-performance-when-you-were-profiled-in-the-best`, `if-you-buy-a-stock-on-a-gap-up-day-and-the-low-of-the-day-is-greater-than-7-8-from-where-you-bought-it-do-you-still-set-your-stop-at-the-gap-up-days-low`, `when-should-i-buy-a-stock-that-gaps-higher-lite-mho-and-rng-gapped-higher-then-fell-8-10-17`, `could-you-briefly-explain-for-the-sake-of-education-if-there-is-a-significant-difference-in-the-gap-up-of-ffiv-and-the-gap-up-of-lvs-as-of-october-28-2010`, `how-do-you-determine-if-a-stock-gapping-up-is-buyable-if-it-is-buyable-how-do-you-time-your-entry` | High: the originators answering members; each answer dated on the page. The 2010-10-24 answer quotes page 171 of their 2010 book. Added in checking: `how-do-you-set-your-sell-stops` (2010-10-03, the 10-day "violation"). The 2014-09-06 answer is addressed to "Dr. K" (Kacher). |
| 4 | *Trade Like an O'Neil Disciple* (2010), table of contents | Wiley-VCH product page | https://wiley-vch.de/en/areas-interest/finance-economics-law/trade-like-an-o-39-neil-disciple-978-0-470-61653-6 | Used only to locate the chapter; the chapter itself was not read. |
| 5 | *Kacher-Morales Setup* (re-read 2026-11-09) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/KacherMorales.html | Medium-high: a stated test (557 stocks, 2001-2010). Fetch tool only (plain requests got HTTP 406). **The site states it "shall not be used to train artificial intelligence (AI) systems"**; cited with a link and short quotes for research. |
| 6 | His page on price gaps (updated 2025-08-08; re-read 2026-11-09) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/gaps.html | Medium-high: his own counts. Fetch tool. Same AI notice. |
| 7 | "Rising Window" (re-read 2026-11-09) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/RisingWindow.html | Medium-high. Fetch tool. Same AI notice. |
| 8 | "Gauging Gaps" (re-read 2026-11-09; every quote confirmed through the fetch tool) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/GaugingGaps.html | Medium-high. Fetch tool plus that copy. Same AI notice. |
| 9 | "Good Earnings Surprise" event pattern (re-read 2026-11-09) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/earnsgood.html | Medium-high; a different entry, used as context only. Same AI notice. |
| 10 | "Gaps and Gap Analysis" | StockCharts ChartSchool (no author or date shown) | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis.md | High: established educator. |
| 11 | "TA 101 - Part 15" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/overview/technical-analysis-101/ta-101-part-15.md | High. |
| 12 | "Gap Trading Strategies" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/gap-trading-strategies.md | High; about the gap day only, read and not used. |
| 13 | "Gap Trading: A Case Study", 2015-05-27 | StockCharts *Trading Places*; Tom Bowley (EarningsBeats.com) | https://articles.stockcharts.com/article/articles-tradingplaces-2015-05-gap-trading--a-case-study/ | Medium: one worked example; uses the words "gap support". |
| 14 | "How To Trade Breakaway Gaps For Huge Stock Gains", 2018-09-06 | Morpheus Trading; Deron Wagner | https://morpheustrading.com/blog/breakaways-gaps/ | Medium-high: established educator, specific rules. |
| 15 | "How To Score Monster Gains From Trading Breakaway Gaps", 2019-12-30 | Morpheus Trading; Deron Wagner | https://morpheustrading.com/blog/breakaway-gaps/ | Medium-high. |
| 16 | "3 Proper Buy Entry Points to Score Big Gains from Breakaway Gaps", 2021-11-07 | Morpheus Trading; byline "Rick" | https://morpheustrading.com/blog/breakaway-gap-entries/ | Medium. |
| 17 | "Gap Trading Strategy: 5 Top Ways to Buy Stocks Gapping Up from Earnings", 2022-10-27 | Morpheus Trading; byline "Rick" | https://morpheustrading.com/blog/gap-trading-strategy/ | Medium. |
| 18 | "3 TIMELESS setups that have made me TENS OF MILLIONS!", 2021-01-08 (updated 2021-04-28) | qullamaggie.com; Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | High for the gap day; no rule for the later test. |
| 19 | "My process flow for Episodic Pivots (EP)", 2014-07-30, with his reply dated 2017-01-31 | Stockbee blog; Pradeep Bonde | https://stockbee.blogspot.com/2014/07/my-process-flow-for-episodic-pivots-ep.html | High: originator's own reply; one line. |
| 20 | "Gaps in 50% plus moves", 2024-09-27 | Stockbee blog; Pradeep Bonde | https://stockbee.blogspot.com/2024/09/gaps-in-50-plus-moves.html | Medium: his observation, not a published count. |
| 21 | "Episodic Pivots Delayed Entry", 2023-05-03 | Stockbee blog; Pradeep Bonde | https://stockbee.blogspot.com/2023/05/episodic-pivots-delayed-entry.html | The post's text is only its title (the content is media); read, nothing used. |
| 22 | *What is a Power Earnings Gap? & How to Trade it!* (title as shown, inner quotes dropped), 2021-09-24 (updated 2023-10-01) | The Art of Trading; Trader Stewie | https://www.artoftrading.net/post/what-is-a-power-earnings-gap-how-to-trade-it | High for the PEG name and the gap day; no gap-low rule. |
| 23 | "3 Trading Strategies for Power Earnings Gaps!", 2023-02-26 | The Art of Trading; Trader Stewie | https://www.artoftrading.net/post/3-trading-strategies-for-power-earnings-gaps | Medium-high. |
| 24 | "Episodic Pivot / Power Earnings Gap / Buyable Gap Up Explained", 2021-11-18 (updated 2026-03-31) | Tradingsim; John McDowell (reviewed by Al Hill) | https://www.tradingsim.com/blog/episodic-pivot-power-earnings-gap-buyable-gap-up-explained | Low-medium: a secondary summary; its "3-4%" for Morales does not match his own text. |
| 25 | "Gap Study (3/3)", 2010-10-02 | SMB Training blog; Adam Grimes | https://www.smbtraining.com/blog/?p=7421 | Medium: a stated sample; same-day closure only. |
| 26 | "How to Profit from Strong Earnings Reports While Reducing Risk" (ChartWatchers, 2021-09-03) | StockCharts; John Hopkins (EarningsBeats.com) | https://articles.stockcharts.com/article/articles-chartwatchers-2021-09-how-to-profit-from-strong-earn-50/ | Read; not about the gap-up low; not used. |
| 27 | The Breakaway Gap: How To Buy Strength While Managing Your Risk | Investor's Business Daily | https://www.investors.com/how-to-invest/investors-corner/breakaway-gap-how-to-buy-strength-manage-risk/ | **Not read** beyond its first paragraph (paywall; the fetch tool was refused). Nothing used. |
| 28 | TraderPlanet buyable gap-up page (2013) | TraderPlanet | https://www.traderplanet.com/?p=19625 | **Not readable** (HTTP 500 on 2026-11-09). The repo's earlier research (`docs/study/levels/external_research.md`, S13) read it on 2026-11-06; nothing from it is quoted here. |
| 29 | Kacher and Morales, 2011 Traders Expo handout on buyable gap-ups; 2013 boot-camp video "Buyable Gap-ups" (YouTube j9cEvu_xOgA, channel "Chris Kacher") | MoKa / VoSI | http://media.virtueofselfishinvesting.com/download/Traders-Expo-Las-Vegas-Intensive-Workshop-November-2011-Buyable-GapUps.pdf ; https://www.youtube.com/watch?v=j9cEvu_xOgA | **Not read**: the PDF host did not resolve; only the video's title and description were read (no transcript). |
| 30 | Bulkowski, *Trading Basics* (Wiley 2012), the section on gaps showing support and resistance | O'Reilly | https://www.oreilly.com/library/view/trading-basics-evolution/9781118488386/OEBPS/c04-9.htm | **Not read** (HTTP 403). |
| 30a | A *Technical Analysis of Stocks & Commodities* page on buyable gap-ups (found by search in checking) | technical.traders.com | https://technical.traders.com/tradersonline/display.asp?art=7236 | **Not read** (HTTP 403); author, date and wording unknown. |

**House sources**

| # | Source | Location | Note |
|---|---|---|---|
| 31 | UCT Substack, every post in the sitemap (2025-06-01 to 2026-11-08) and the about page | https://unchartedterritoryy.substack.com/sitemap.xml | House; quotes exact; writer named by section header (each of the 52 quotes' headers re-checked; one fixed, the BABA line). 101 posts readable in full; `sunday-scans-bf1` (2026-10-18) subscriber-only. "The Parabolic Short" carries the house byline; the owner's rulebook (B26) calls it Bracco's. |
| 32 | Owner verdict log | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (Gap Support lines 182-227; rulings 458, 534) | House; his words outrank everything here. |
| 33 | Account rulebook | `docs/study/sizing_rule.md` section 9 | House rules, closed 2026-11-09. |
| 34 | Trade plans | `docs/study/TRADE_PLANS.md`; `api/services/study_trade.py` | House; this row is the detector's words, not his. |
| 35 | The scanner and its helpers | `api/services/pattern_engine/detectors/uct/uct_gap_support.py`, `uct_setups_common.py`, `api/services/pattern_engine/primitives/liquidity.py`, `api/services/pattern_engine/detectors/registry.py`, `api/services/setup_tags.py`, `api/services/pattern_engine/tag_textbook.py`, `api/services/study_hard.py` | Read in full; my re-implementation matched `evaluate()` on 388 of 388 fires. |
| 36 | The bank finder | `scripts/study/find_gap_support_examples.py` | Read in full. |
| 37 | Study app files | `app/src/pages/study/gapSupportOverlay.js`, `app/src/pages/study/studyPlainRules.js`, `app/src/pages/study/challenges/games/tradeStory.js`, `docs/study/courses/V/V.05.json` | Read for this setup's lines. |
| 38 | Model Book card, playbooks, journal tags | `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`; `app/src/constants/setupGroups.js` | Read. |
| 39 | The brain template and the levels dossier | `docs/study/levels/brain_kb_2026-11-06.json` ("Open Bull Gap Support"); `docs/study/levels/dossiers/gap_support.md`; `docs/study/levels/evidence.md`, `evidence_kept.md`, `external_research.md`; `docs/patterns/JUDGED_GATE.md` | House, as stored in this repo; the private knowledge base was not re-read. |
| 40 | The app's local daily-bar store (read-only) and my measurement scripts | the bar store of the local test data directory; scripts and outputs in my scratch folder (not in the repo) | Vendor data; survivorship-biased (today's tickers only); the store was being updated during the run, so a first pass missed 41 tickers and was re-run in full (3,897 tickers then, 4,284 when checked). The checker's scripts are in a separate scratch folder (`setups/25-gap-support-check/`). |

**Searched for and not found or not read:** see section 3.10. My web-search budget for this session ran out partway
through; pages I could reach by a known address were still read. The checker ran the searches that were missing
(section 3.10).

---

## Removed or corrected in checking (2026-11-09)

Nothing below was a made-up quote: all 52 Substack quotes, 16 FAQ answers, the glossary, the 2013 book and every
outside page quote were found word for word. What was wrong was attribution, method description and a few claims.

**Removed (not supported by the source):**
1. "Gap types are labelled after the fact (ChartSchool says the same of gap classifications)": neither ChartSchool page
   read says that. Kept as my reading, with the TA 101 exhaustion-gap sentence that implies it.
2. Morpheus "Trail: the 10-day or 20-day": none of the four articles names an average to trail with.
3. "his words: 4%, 2x" and "2x is his number": the verdict log has no number from him on gap size or volume; 4% and 2x
   are the scanner's (2026-10-16) carried into the bank's wording.
4. "The owner has also ruled the post-gap high a scored first trim": his 2026-11-09 words approved adding the post-gap
   high as a Trade Story stop; the trim note is the detector's plan wording.
5. B- cue "a long drift ... (CLS 'okay')": the log gives no reason for CLS's grade and DOCS (great) was a long drift.

**Corrected:**
6. Attributions to the owner that are the bank's wording: "a breach that does not reclaim is a failed gap", "a slight
   breach that closes back above it is still good", "days or weeks later", "holds the gap".
7. "LOD stop" given as the owner's: it is from an Index & ETF section; his is "risk to low of day".
8. The BABA "holding gap up support" lines are from the "Alex Jones Industrial Average" section, not Jersace.
9. The ChartWatchers author is John Hopkins (the page shows the full name), 2021-09-03.
10. Grimes's large-gap figure is for gaps over 5%, not "4%+".
11. Section 4.9's method was not "3%+ on 1.5x+ volume": five matched gaps (MU, TSLA, two SMH, ARKK) were 2.2% to 3.0%,
    mostly on ordinary volume. INOD was "not found" only because a partial gap was excluded; its Monday low (40.80) is
    0.5% from his $41, so the count is 20 of 25 (17 of 22), not 19 (16).
12. Substack counts: "gap support" 41 (owner 30), not 42 (31); the 94 "bull gap" count includes "bullish open gap";
    owner 39, not 40.
13. The below-200-day row (1,827) had no 50-day filter, unlike the rows it is compared with; with the filter it is 535
    trades at -0.07R. The 200-day split is not robust across the other four entries and stops.
14. Rick's NVDA example was a buy limit at the gap day's **high**, not "a limit near the low".
15. The scanner reports a trigger from the last 3 sessions (today or up to two back), not "up to 3 sessions old".
16. The registry's "(86-92% precision)" is one comment for four setups together, not Gap Support's own figure.
17. Bulkowski skipped the breakout-from-consolidation step, not "part of the trend rule" (his trend test was a 5-40 day
    regression).
18. B19 says breakeven "at 2-5R ideally", not "once the first trim is done".
19. Entry C was tagged [source consensus] on one outside source (Wagner) plus our own card; retagged [UCT].
20. A+ cue "3x or more volume" contradicted section 4.7 (10x or more did worst): now about 3x to 5x.
21. K-M "Trims: not set": Kacher's 2014 answer sells "at least half" into an upside run.
22. Trader Stewie as "originator of the PEG name": not verified; softened to the best-known source, with his own words.
23. The 2013 book: the preview's store link is now recorded and the "unknown character" note dropped (the re-extracted
    text shows an ordinary dash). FTAI and VECO are now in the bar store and added to section 4.8.

**Added:** K-M's bottom-fishing buyable gap-up, their 10-day "violation" definition (FAQ 2010-10-03), the 9-10% risk
exception, Bulkowski's 50-day exception and Insteel figure, ChartSchool's partial-gap definition, the scanner's
confidence rewarding test-day volume (section 5.2, item 12), question 13 (gap size), and the searches in section 3.10.

**Second check (2026-11-09, later the same day).** Re-verified without change: every FAQ quote (16 pages downloaded
as plain HTML and matched word for word, dates as printed), the five Bulkowski pages, the Tradingsim "3-4%" sentence,
the Wiley contents page (Chapter 5, "Dr. K's Laboratory: Buying Gap-Ups in Leading Stocks"), Bulkowski's Active
Trader title and his Insteel sentence ("the average gain drops from 3.1% to 2.6%"), all 52 Substack quotes and their
section headers (the SEI line sits under a plain "Jersace - SEI INTC ARM" label, so Jersace is right), the Substack
counts (41/22/30; 94/57; 16/12; 4), the verdict-log words, the rulebook text, the scanner summary (section 5.1, every
constant and formula), the finder's thresholds, the 4.7 main row, all 24 splits and the side figures (34% next-session
stops, 60% within five, 11% past -1.05R, worst -16R, post-gap high median 3.7R, 41% under 3R, C29 median 0.7% and
7%), and the 4.8 table (the real scanner on 26 charts). Corrected or added:
24. Section 4.9, NOW: the nearest gap-up low to his $130 is 130.25 (2026-08-27, a 3.7% gap on 1.3x), 0.2%, not the
    June line alone; the 2026-06-01 gap's low 131.61 is 1.2% away. BE: a nearer line (200.23) is the low of a session
    that gapped up and closed back under the prior high the same day. HUT: the same shape exists at 107.32 (2026-06-09);
    "no gap-up low near it" was too strong, though the count stays 20 of 25 because a same-day-failed gap is not an open
    gap. The "gaps behind the matches" count reads 13 big and five small, with NOW either.
25. The first check's saved text of the 2013 preview contained none of the six book passages (an extraction fault,
    not a missing source); re-extracted with pdftotext, all six are on pages xxi to xxiv as cited.
26. Section 3.1 said 22 FAQ answers were read; 16 are cited and listed, and that is what both checks verified.
27. Added K-M's general sell-stop answer on gap-ups (FAQ 2010-10-03): sell at least half on a trade under the gap-up
    day's low. Nothing was removed in the second check.

---

## 12. Examples (from our data)

**The scan's rule (daily bars, 2026-11-09).** A gap day: the open at least 4% over the prior close, the whole day above
the prior day's high (a true gap), volume at least 2x the 50-day average, the close above the prior day's high and
above a flat-or-rising 50-day SMA (not below its value ten sessions earlier), the gap 30% or less close to close, the
stock $10 or more and $20 million or more traded a day. The gap-up low is the line and the prior day's high is the
gap-fill spot. The test day is the first session 2 to 60 sessions later whose low reaches the gap-up low (within 0.25
ATR above it) or undercuts it by up to 5%, closes at or above it (or within 1% under), closes in the upper half of its
range, sits at least 1 ATR below the post-gap high, and closes above the 200-day SMA (house rule B26); any close at
or under the gap-fill spot, any trade through it, a deeper undercut, or a close more than 1% under the line ends the
setup instead. Entry is a market order at the test day's close (section 8.2, option A; the buy point is the close, so
the chase limit C28 cannot be breached); the stop is a few cents (0.1% of the price, at least 3 cents) under the test
day's low, and a stop more than 5% away is skipped (A13). One test per gap. The outcome is walked forward 60 sessions
from the next day: the first of the stop, 3R or 5R. RS rating (C31) was not available to the scan and is not tested.

**Base rate.** 2,630 of 2,630 liquid names scanned (the whole universe that ever met rule B23), tests from 1996-06-04
to 2026-11-09: **2,783 hits; 28.9% reached 3R and 20.4% reached 5R** before the stop; 2,377 (85%) eventually traded
the stop within the 60-day window (a fixed stop with no trims, no breakeven move and no trail, so this is the raw
hold-or-stop rate, not the account's trade). The median stop was 2.1% away and 76% of stops were within 3%. Timing did
not change the rate much: tests 2 to 5 sessions after the gap reached 3R 28% of the time (1,589 hits), 6 to 20 sessions
30% (779), 21 to 60 sessions 29% (415); tests on the second session alone, 27% (810). Gap size mattered a little: gaps
opening under 8% reached 3R 30% of the time (1,749), gaps of 15% or more 26% (218). Tests closing in the top quarter of
their range reached 3R 29.7% of the time against 28.1% for the third quarter. 21% of all hits reached 3R within ten
sessions. Files: `_study-resume/scratchpad/setups/25-gap-support/final/hits.json` (every hit and its outcome),
`examples.json`, `ex_01..10_*.png`, `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` (local scratch, not in the repo).

**The 10 examples** (all reached 5R; one per ticker, ten different years; "earnings gap" means the gap day is an
earnings reaction day in our Yahoo/SEC dates, "news gap" means it is not). Buy = the test day's close; stop = a few
cents under the test day's low; best R = the furthest the trade went in 60 sessions before the stop traded.

| # | Ticker | Gap day → test day | Structure | Buy | Stop | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|
| 1 | ADSK | earnings gap 2004-02-27 → test 2004-03-17 | +10.1% open on 11.9x volume; test 13 sessions later, 2.0 ATR off the 14.72 post-gap high; low 0.3% above the gap-up low 13.88; close at 90% of the range | 14.23 | 13.90 (2.4%) | 16.7R | A steady uptrend above all its averages, a two-week sideways drift back to the gap-up low, a hammer close, then a straight run |
| 2 | AKAM | earnings gap 2006-02-09 → test 2006-02-14 | +13.6% open on 7.1x volume; test 3 sessions later, 2.5 ATR off the 27.59 high; low 0.1% under the gap-up low 24.76; close at 61% of the range | 25.10 | 24.71 (1.6%) | 30.4R | The quick test: two down days after a big earnings gap in a rising stock touch the line and hold, 1.6% risk |
| 3 | MA | earnings gap 2009-07-30 → test 2009-08-19 | +9.2% open on 2.9x volume; test 14 sessions later, 3.1 ATR off the 20.93 high; low 0.8% above the gap-up low 19.39; close at 68% of the range | 19.73 | 19.50 (1.1%) | 19.8R | A large cap gapping out of a 2009 base above a rising 50-day; the pullback stops where the gap opened, 1.1% risk |
| 4 | ILMN | earnings gap 2010-10-27 → test 2010-11-02 | +5.6% open on 3.6x volume; test 4 sessions later, 1.9 ATR off the 55.63 high; low 1.1% under the gap-up low 53.03; close at 94% of the range | 53.27 | 52.40 (1.6%) | 18.6R | The slight undercut that reclaims: the low breaks the line by 1% and the day closes near its high |
| 5 | GPN | earnings gap 2013-10-02 → test 2013-10-09 | +7.0% open on 11.5x volume; test 5 sessions later, 2.5 ATR off the 28.71 high; low 0.3% under the gap-up low 27.00; close at 62% of the range | 27.15 | 26.89 (0.9%) | 24.9R | A quiet stock whose gap came on 11x volume; the first touch of the line a week later is the whole pullback, 0.9% risk |
| 6 | XYZ (Square, then SQ) | earnings gap 2017-02-23 → test 2017-03-22 | +10.8% open on 10.3x volume; test 19 sessions later, 5.1 ATR off the 18.17 high; low 1.3% under the gap-up low 16.32; close at 66% of the range | 16.41 | 16.08 (2.0%) | 25.9R | Four weeks of sideways digestion inside the gap day's range, a one-day undercut and reclaim, then the trend resumes |
| 7 | ONC (BeiGene, then BGNE) | news gap 2020-07-13 (not an earnings date in our data) → test 2020-07-30 | +4.8% open on 4.1x volume; test 13 sessions later, 3.8 ATR off the 256.01 high; low 0.5% under the gap-up low 205.26; close at 71% of the range | 207.34 | 203.96 (1.6%) | 34.2R | A gap near the 4% minimum but on 4x volume in a strong uptrend; a deep pullback from the post-gap high ends at the gap-up low |
| 8 | LLY | news gap 2021-06-24 (not an earnings date in our data) → test 2021-07-01 | +8.2% open on 3.6x volume; test 5 sessions later, 2.1 ATR off the 239.37 high; low 0.8% under the gap-up low 230.42; close at 87% of the range | 231.13 | 228.43 (1.2%) | 16.6R | A mega cap news gap; the first dip a week later tags the line with a hammer close, 1.2% risk |
| 9 | AXON | earnings gap 2022-11-09 → test 2022-12-30 | +8.0% open on 3.6x volume; test 35 sessions later, 6.4 ATR off the 193.85 high; low 0.4% above the gap-up low 161.70; close at 82% of the range | 165.93 | 162.22 (2.2%) | 16.2R | The late test (seven weeks, like his DOCS and KKR examples): a 15% slide from the post-gap high stops on the gap-up low with a hammer |
| 10 | VIAV | earnings gap 2025-10-30 → test 2025-11-21 | +13.4% open on 6.8x volume; test 16 sessions later, 4.2 ATR off the 18.46 high; low 1.8% under the gap-up low 15.80; close at 87% of the range | 15.96 | 15.48 (3.0%) | 25.4R | A recent small cap: an undercut of 1.8% and a strong close back over the line, the stop right at the 3% limit (A13) |

Tickers 6 and 7 are shown under their current symbols because that is how the sandbox stores them; the history is the
same company's. None of the ten is an ETF, and none shows a split or ticker-reuse fault in the bars. The two news gaps
are called that only because the gap day is not an earnings reaction day in our data; the catalyst itself was not
researched here.

**Notable failures (same rule, in words).**
- **MSFT, test 2025-08-04.** An 8.2% earnings gap on 2.8x volume (2025-07-31); the test came only two sessions later,
  the low 0.7% under the gap-up low, the close at 74% of the range, 1.5% risk. The stop traded before the trade ever
  showed a gain (0.0R). Second-session tests are the largest group of hits (810) and the weakest (27% to 3R).
- **AVGO, test 2025-09-24.** A 16.2% earnings gap on 4.3x volume (2025-09-05), tested 13 sessions later with a near
  perfect hold (low 0.7% above the line, close at 88% of the range, 1.7% risk), yet the stop traded without any gain
  (0.0R). A clean test day is not enough when the gap was very large: gaps of 15% or more reached 3R 26% of the time
  against 30% for gaps under 8%.
- **AMD, test 2020-09-17.** An 11.7% earnings gap on 2.2x volume (2020-07-29) tested 35 sessions later with a close at
  97% of the range and 3.2% risk; the stop traded with no gain (0.0R). The stock had already fallen hard from its
  post-gap high and the broad market was in its September 2020 pullback: the scan ignores the market reading (section
  8.7), which is the missing filter here.
- Also AMZN (2018-05-01 and 2023-08-08), GOOGL (2025-11-03), AAPL (2019-05-06) and NVDA (2026-08-31): second- or
  third-session tests of large earnings gaps in mega caps that stopped at once.

**Limits.** The scan ran to completion within its budget (2,630 of 2,630 names; no coverage caveat). It does not test
RS rating, group strength or the market reading, so the base rate is for the chart pattern alone. It takes only the
first qualifying test per gap and only daily bars, so the owner's intraday entries (section 8.2, option D) are not
measured, and the 5% undercut allowance plus the 1% close allowance mean some hits are looser than his "slight
breach". Earnings classification uses the sandbox's Yahoo and SEC 8-K dates, complete from about 2005; the 2004 ADSK
gap matched a date in that set, but an unmatched gap before 2005 would be unclassifiable rather than "news".

## 13. Failures and near-misses (from our data)

Added 2026-11-10 from the section 12 scan (`scan_gs.py`, `final/hits.json`) and a one-gate-relaxed copy
(`near_scan.py`, `final/near_hits.json`: gap days loosened to a 2% open gap on 1.2x volume, the first session that
reaches the gap-up low evaluated with every gate recorded; kept when exactly one gate fails). Charts in
`_study-resume/scratchpad/setups/25-gap-support/final/`: `fail_1..4_*.png` and `fail_1-4.png`, `near_1..4_*.png` and
`near_1-4.png`, and the confusable pair `pair_21-power-earnings-gap.png` (GPN above LULU, the tell from the card). Buy
= the test day's close; stop = a few cents under the test day's low; "where it stopped" counts sessions after the test
day. All four gap days are earnings reaction days in the sandbox's dates.

**Failures: valid by every gate, stopped before 3R.** AVGO and AMD are the dossier's own named failures (section 12).

| # | Ticker | Gap day, test day | Buy | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | AVGO | gap 2025-09-05 (+16.2% open, 4.3x), test 2025-09-24, 13 sessions later | 339.31 | 333.47 (1.7%) | the next session (2025-09-25, low 327.30), 0.0R | A near perfect test (low 0.7% above the line 331.42, close at 0.88 of the range, 2.6 ATR off the high) that traded the stop the next morning. The gap never filled (no close under 308.78) and the stock made 414.61 by 12-10. Gaps of 15% or more reached 3R 26% of the time in the scan. | gs.gap_not_huge |
| 2 | AEHR | gap 2023-07-14 (+7.5% open, 6.6x), test 2023-08-14, 21 sessions later | 45.77 | 44.45 (2.9%) | the next session (2023-08-15), 0.0R | A hammer close at 0.93 of the range on the line (44.42), then straight down: a close under the gap-fill spot (41.76) two sessions later (08-17) and 21.57 by 10-30. The true failure mode: the gap filled and the stock halved. | gs.inv_fill |
| 3 | DKS | gap 2021-05-26 (+10.5% open, 8.1x), test 2021-06-16, 14 sessions later | 93.62 | 91.84 (1.9%) | the next session (2021-06-17, low 89.21), 0.0R | A 2.4% undercut of the line that closed back on it (91.46), then a run to 147.39 by 09-07. The stop was right by the rules and wrong in hindsight; a re-entry needs a new trigger (B21). | gs.after_entry_stop |
| 4 | AMD | gap 2020-07-29 (+11.7% open, 2.2x), test 2020-09-17, 35 sessions later | 76.55 | 74.12 (3.2%) | the next session (2020-09-18, low 73.85, 27 cents under), 0.0R | A close at 0.97 of the range on the line (73.90), 4.4 ATR off the post-gap high, in the September 2020 market pullback; the stop traded by 27 cents and the stock chopped between 73.76 and 96.37 for the next 60 sessions. The scan does not read the market; the rulebook does. | gs.market_reading |

**Near-misses: look like Gap Support, fail exactly one gate.**

| # | Ticker | Gap day, test day | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | AMD | gap 2023-05-25 (+8.3% open), test 2023-06-01, 4 sessions later | gs.gap_volume | gap-day volume 1.6x the 50-day average; the rule needs 2x. The test itself passes (low 0.7% above the line 115.80, close 0.61, 2.6 ATR off the high). | A gap on ordinary volume (the 2023-05-25 sympathy day, not an earnings day). Taken anyway: 0.73R, then the stop. |
| 2 | DE | gap 2026-02-19 (+6.8% open, 4.4x), test 2026-02-25, 4 sessions later | gs.test_close_position | the test day closed at 0.01 of its range (623.61, 0.8% under the line 628.72); the rule needs the upper half. | A test still falling into the close (gs.inv_still_falling). No hold, nothing to buy; the stop under it would have traded at 0.0R. |
| 3 | DOCU | gap 2025-03-14 (+9.1% open, 5.4x), test 2025-03-31, 11 sessions later | gs.not_downtrend | the gap day closed 2.6% under the 50-day SMA, and the 50-day was 3.2% lower than 10 sessions earlier; the rule needs a close above a flat or rising 50-day. The test (close 0.75, 0.8% undercut) passes. | An earnings gap inside a downtrend: a bounce, not Gap Support. Taken: 0.0R and a slide to 72. |
| 4 | EVR | gap 2019-01-30 (+11.3% open, 4.1x), test 2019-02-07, 6 sessions later | gs.above_200 | the test day closed 6.9% under the 200-day SMA; the rule needs a close above it (gs.inv_under_200). The gap, the 50-day and the test all pass. | A downtrend bounce under the 200-day; the stop traded at 0.0R. |

**What the failures have in common.** All four traded the stop on the very next session with no gain: the stop under
the test day's low is 1.7% to 3.2% away and the session after the test decides. Three of the four (AVGO, DKS, AMD) then
went up, two of them far, so the loss came from the stop's tightness, not from a wrong line; only AEHR failed the way
the card describes, with the gap filling and the stock halving. The test days themselves were as clean as the winners
(closes 0.68 to 0.97 of the range, undercuts of 0.2% to 0.7%), so the chart gives no warning; what separates them is
context the scan does not read: a very large gap (AVGO), a market pullback (AMD), and the plain base rate (85% of hits
touch the stop inside 60 sessions).
