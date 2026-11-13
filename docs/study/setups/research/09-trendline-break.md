# Setup 09: Trendline Break (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling.

**How the quotes were checked.** Quotes from UCT's Substack and from the three TraderLion pages were checked word for
word against saved copies of those pages. Every other web quote was confirmed by a second exact-match check of the live
page on 2026-11-09. Where I could not read a source, I say so and give no wording from it. Numbers marked "my replay"
are my own computation on the app's judged charts (section 4.7), not a published statistic.

**Cold check (2026-11-09, a second reader).** Every quote below was opened again at its source and matched word for
word: the 30 Substack passages in fresh downloads of each post (and the section each sits in), the StockCharts, CMT,
Brandt, TraderLion, 7 Circles and Qullamaggie pages by plain download, Bulkowski's pages by a page reader (his site
refuses plain downloads), and the Edwards and Magee and Murphy quotes in the Internet Archive OCR texts of the books
(the same scans the house note used; OCR, so check a print copy before a quote ships to members). The app's code,
the rulebook and the verdict log were read directly, and the replay in 4.7 was re-run independently. What changed is
marked "(corrected in checking)"; what could not be confirmed is gone and listed under "Removed in checking" at the end.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's own
words or his publisher's description of his method; **[UCT]** UCT's own writers or the owner's verdict log; **[house
rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner
to accept or change.

Terms: **ATR** = average true range over 14 sessions, the stock's typical daily move. **Swing high** = a daily high
with lower highs on both sides. **Anchor** = a swing high the line is drawn through. **The line's value** = where the
line sits on a given day. **R** = the risk on the trade (entry minus stop).

---

## 1. What it is

A stock that has been pulling back or resting makes a series of lower highs, and a straight line drawn across those
highs slopes down. The trendline break is the day price pushes up through that line and closes above it: the first sign
that the sellers who capped every bounce have stopped selling at lower and lower prices.

**The psychology (reasoning, not measured fact).**
- Each lower high is a rally that someone sold into. The falling line is a picture of supply arriving a little lower
  each time. A strong close through the line says that supply was absorbed. Our own scanner's narrative says the same:
  "Each rally into a falling line of lower highs was sold; a decisive close through it says that supply has been
  absorbed." (`uct_trendline_break.py`, `_narrative`)
- Who is trapped: traders who shorted each touch of the line, and holders who sold the pullback. Who buys: traders who
  were waiting for the line to go, and funds adding to a leader once the pullback is over. The line is visible to
  everyone, which is why the break can bring a burst of orders.
- Why it often fails: a trendline is drawn by hand, so several lines are possible on one chart, and a break of one only
  says the pullback has paused. The StockCharts ChartSchool calls a break a warning, the CMT Association's tutorial says a
  broken uptrend turns "neutral", and in Victor Sperandeo's method the break is only step 1 of 3 (section 3).
- Where it lives in practice: most traders use it as the **entry trigger that ends another pattern**: the upper line of
  a flag, the handle of a cup, the drift of a wedge, the pullback before a "wedge pop". An IBD headline calls it
  an early trendline entry, Oliver Kell's publisher calls the same moment a pivot break, and UCT's own lesson plan already teaches the
  Bull Flag "entered on the break of the flag's upper trendline" (`docs/curriculum/uct_method_chapters.json`). This
  matters for question 1 in section 10.

---

## 2. Origin and naming

- **No single originator.** Trendlines are among the oldest chart tools. Edwards and Magee's *Technical Analysis of
  Stock Trends* (first edition 1948) has a chapter "Trendlines and Channels" (chapter 14 of the 11th edition, 2018,
  followed by chapter 15, "Major Trendlines"; checked in the Internet Archive OCR). John Murphy's *Technical Analysis of
  the Financial Markets* (1999, a revision of his 1986 futures book) covers them in chapter 4, "Basic Concepts of Trend"
  (checked in the Internet Archive OCR).
- **Victor Sperandeo**, *Trader Vic: Methods of a Wall Street Master* (Wiley, 1991, with T. Sullivan Brown; year and
  publisher confirmed in library catalogue records), made the trendline break step 1 of his "1-2-3" trend change rule.
  I did not read the book; his rule is cited below through Thomas Bulkowski, who credits it to him.
- **Tom DeMark** is credited, in secondary descriptions only, with drawing lines objectively from recent swing points
  ("TD Lines") and with "qualifiers" for a valid break. His book (*The New Science of Technical Analysis*, Wiley 1994,
  per Open Library) was not read, and the secondary descriptions disagree with each other, so nothing of his is used
  here.
- **Thomas Bulkowski** (thepatternsite.com) published a down-sloping trendline tutorial (released 2020-02-06) and
  measured statistics for down-sloping and up-sloping trendlines (revised May 2021).
- **Oliver Kell** (2020 US Investing Championship) made the break of a short-term pivot near the 10 and 20-day averages
  the "Wedge Pop" of his Cycle of Price Action; his publisher TraderLion also titles one of his trade reviews "COIN +110%
  Trendline Breakout" (2024).
- **IBD** headlines present trendline entries as early buy points (Dominic Gessel, 2025, "Early Trendline Entries In
  Stock Charts Could Double Your Profit; Here's How"; older IBD titles listed in section 11). Only the first two
  sentences of the 2025 article could be read; the rest is paywalled (corrected in checking: "inside a base" came from
  unverified search excerpts and is removed).
- **UCT**: the app's scanner is "UCT Trendline Break"; the team playbook export (the brain's `setup_knowledge` rows)
  has a setup row with the id `trendline_break`, which `docs/agent/knowledge/N15-UNRESOLVED-SETUP-IDS.md` lists among
  "ledger setups without an engine template" (corrected in checking: the note does not say it is the owner's own trade
  ledger); the Sunday Scans say "break of trendline", "downtrend line", "take out this downtrend line", "breaking a
  downtrend".
- **Other names**: downtrend line break, trendline breakout, TL break, breaking the downtrend, falling wedge breakout
  (when the lower line also falls and the two converge), flag breakout (when the line is the top of a flag), early
  entry (IBD), TD Line break (DeMark), 1-2-3 step 1 (Sperandeo), wedge pop (Kell; related, but keyed to the moving
  averages, see 3.9).

---

## 3. Every definition I could find, source by source

### 3.1 Edwards and Magee, *Technical Analysis of Stock Trends* (classic; checked in the Internet Archive OCR of the 11th edition)

- **Read this first: their tests were written for UP trendlines.** Chapter 14 builds every test on up lines in a bull
  market and says so: "In all of the foregoing discussion of trends and trendlines, we have concentrated on uptrends"
  (ch. 14, "Intermediate Downtrends"). On down lines they add that "Intermediate (Bear Market) Downtrends are far less
  regular and uniform in their development than Bull Market Advances", are steeper, tend to curve down away from a line
  drawn across the first two rally tops, and often turn up only after prices "thrash around for some time, making a
  base" (ch. 14). Applying the touch, slope and 3% tests to a falling line, as this dossier does, is a reasonable
  mirror, not their text (added in checking).
- **Drawing.** Two points fix a line ("two established Top Reversal points to fix a Down Trendline", ch. 14); a third
  test confirms it. A fourth bottom on the line and its value "is very considerably enhanced" (ch. 14).
- **Spacing.** Anchors "less than a week apart" make a line that "is subject to error; it may be too steep or (more
  often) too flat." (ch. 14)
- **Slope.** "The flatter, more nearly horizontal the trendline, the more important it is technically" (ch. 14)
- **Touches beat length.** "Greater weight should be given to the number of Bottoms that have formed on a trendline
  (Test 1) than to its length alone (Test 2)." (ch. 14)
- **What counts as a break (the 3% rule).** "To be decisive, prices must not only push through the line but also close
  beyond it by a margin equal to about 3% of the stock’s price." (ch. 14). Peter Brandt quotes the same rule on his own
  blog (3.8), with one word different: his copy reads "but close beyond it", without "also". "The 3% penetration may
  come as a result of two or three days of gradual decline." (ch. 14)
- **Volume.** "an increase in volume may be regarded as confirmation of a decisive penetration" (ch. 14). It can stand
  in for part of the margin: with a 2% close on "conspicuously expanding turnover", "the lesser margin plus the volume
  action may be construed as decisive." (ch. 14)
- **Indexes.** "2% is ample in the Averages to give a dependable break signal" (ch. 15, where the 3% is asked of "an
  individual stock of medium range").
- **A break may only mean "sideways".** The 11th edition's editor, W.H.C. Bassetti (not Edwards and Magee), adds in an
  editor's note at the end of ch. 15: "the breaking of a trendline is as much a warning as a signal to act."
- **False moves.** "Both false moves and premature breakouts, in the sense in which we employ these terms, are
  indistinguishable at the time they occur from genuine breakouts." (corrected in checking: this is ch. 9, said of
  Rectangle and Triangle breakouts, not of trendlines)
- Entry, stop, target: none specific to trendlines.

### 3.2 John J. Murphy (book: checked in the Internet Archive OCR; StockCharts page: checked)

- **Drawing.** "Trendlines on bar charts should be drawn over or under the entire day's price range." (ch. 4). So the
  line goes over the wicks, not the closes.
- **Touches.** "two points are needed to draw the trendline, and a third point to make it a valid trendline." (ch. 4;
  his Figure 4.6b shows a downtrend, "but the rules are the same"). On StockCharts, in his own "10 Laws": "A valid
  trend line should be touched at least three times." ([StockCharts ChartSchool, John Murphy's 10 Laws](https://chartschool.stockcharts.com/table-of-contents/overview/john-murphys-10-laws-of-technical-trading))
- **Significance.** "The longer a trend line has been in effect and the more times it has been tested, the more critical
  it becomes." and "The breaking of trend lines usually signals a change in trend." (same StockCharts page)
- **Slope.** "most important up trendlines tend to approximate an average slope of 45 degrees" (ch. 4). He says this
  of up lines only, and an angle on a chart depends on how the chart is scaled.
- **Close, not intraday.** "As a general rule, a close beyond the trendline is more significant than just an intraday
  penetration." (ch. 4; added in checking)
- **Price filter.** The 3% filter is used mainly for longer-term lines and "requires that the trendline be broken, on a
  closing basis, by at least 3%." For shorter-term trading: "Perhaps a 1% criterion would
  serve better in such cases." (ch. 4)
- **The cost of a filter** (added in checking): "If the filter is too small, it won't be very useful in reducing the
  impact of whipsaws. If it's too big, then much of the initial move will be missed before a valid signal is given."
  (ch. 4)
- **Time filter.** "A common time filter is the two day rule." To have a valid break, "prices must close beyond the
  trendline for two successive days." (ch. 4)
- **Target.** "once a trendline is broken, prices will usually move a distance beyond the trendline equal to the
  vertical distance that prices achieved on the other side of the line, prior to the trend reversal" (ch. 4)
- **Role reversal.** His Figure 4.10b caption: "Very often a down trendline will become a support line once it's been
  broken on the upside." (ch. 4; added in checking). On StockCharts, for support and resistance in general: "After a
  resistance peak has been broken, it will usually provide support on subsequent pullbacks." (Law 3)
- **Caveat.** Murphy's book is futures-first (his 3% rule carries a futures carve-out) and gives no measured rate for
  any of these filters (corrected in checking: the dossier said he claims his filters work "sometimes"; the word
  "sometimes" in the text is about a closing penetration not always being enough).

### 3.3 StockCharts ChartSchool, "Trend Lines" (established educator; no author shown)

URL: https://chartschool.stockcharts.com/table-of-contents/chart-analysis/trend-lines
- "A downtrend line has a negative slope formed by connecting two or more high points."
- "A general trendline rule: It takes two points to draw a trend line, and the third one confirms the validity."
- "As the steepness of a trend line increases, the validity of the support or resistance level decreases."
- "A break above the downtrend line indicates that the net-supply is decreasing and that a trend change could be
  imminent."
- "Trend line breaks should not be the final arbiter, but should serve merely as a warning that a change in trend may be
  imminent." and "To validate trend line breaks, other tools, such as horizontal support and resistance levels or
  peak-and-trough analysis, should be employed."
- Scale: "High and low points appear to line up better for trend lines when prices are displayed using a semi-log
  scale." Fitting: "Sometimes, the lows or highs don't match up, and it is best not to force the issue."
- No filter, no volume rule, no entry, stop or target.

### 3.4 StockCharts Insider, "John Murphy’s Law #5 - Draw the Line (Trendlines)" (Karl Montevirgen, 2025-11-21)

URL: https://articles.stockcharts.com/article/stockcharts-insider-john-murphys-law-5-draw-the-line-trendlines/
- "Connect at least two lower highs to start the trendline. Again, three touches make the trendline valid."
- "If the points of contact between price and trendlines are too close, the move might be nothing more than noise."
- "When a trendline breaks, treat it as a heads-up, not a trading signal."
- "A trendline break with volume matters more than a break without."

### 3.5 CMT Association, "Trendlines & Channels Tutorial: Part 1" (Stewart Taylor, CMT, 2022-09-26)

URL: https://cmtassociation.org/?p=64056 (mostly about uptrend lines; he says "the principles are roughly the same for
both uptrends and downtrends except that downtrends often develop more quickly")
- "proper trendlines are drawn between intervening lows of roughly equal magnitudes and should never be forced."
- Three kinds of line (added in checking). Shallow "Type (1)" lines: "They are more useful for defining the trend than
  for trading." Steep "Type (2)" lines: "These trendlines are very useful as entry triggers and become important as
  existing type 1 trendlines and channels are tested."
- "Trendlines evolve. Initial projected trendlines are consistently inconsistent."
- "A break of an uptrend does not change the underlying trend from up to down but to neutral."
- "Most specifically, TLs don’t offer reliable sell signals when they are broken."
- "What trendlines don’t offer, at least in my approach, are standalone trading opportunities."

### 3.6 Thomas Bulkowski, thepatternsite.com (measured statistics; site forbids AI training, see below)

Tutorial, released 2020-02-06: https://www.thepatternsite.com/QTL.html
- "down-sloping trendlines are drawn above the peaks, not below the valleys."
- "I drew it along the peaks, not cutting through price, but at the top of the peaks."
- "lines with more touches are more important than trendlines with fewer touches." "longer trendlines are more
  significant than short ones."

Down-sloping trendlines, revised 2021-05-13: https://thepatternsite.com/trenddown.html
- **The break**: "That's the first place where price closes above the trendline." (his breakout is the first close
  above the line, not an intraday poke)
- **Scale**: "Price will signal a trend change sooner on the log scale than on the arithmetic scale."
- **Slope**: shallow lines did better (section 4.1). Separately, a flat price trend BEFORE the line starts did better
  (his "Shallow Inbound Trend", section 4.1).
- **Target**: "If you use the start (top) of the trendline, price reaches it 77% of the time." His measure rule
  (corrected in checking, the window was missing): "From the breakout, find the prior minor high trendline touch",
  measure the widest vertical distance between those two points, multiply it by 56% ("because that's how often this
  method works when a full height is used"), and add it to the breakout price, "the point where price pierces the
  trendline".
- **Throwback**: "After price breaks out upward from a trendline, 59% of the time, a throwback will occur."
- **Stop**: the page gives no stop rule.

**Notice.** Bulkowski's pages carry this notice: "This website, in whole or in part, shall not be used to train
artificial intelligence (AI) systems". This dossier cites the pages with links and short quotes for the owner's review
only. The flag is kept here so nobody pastes his text into a model or a training file.

### 3.7 Victor Sperandeo's 1-2-3 trend change, as described by Bulkowski (originator's method, secondary text)

URL: https://thepatternsite.com/123tc.html (Bulkowski credits *Trader Vic: Methods of a Wall Street Master*)
- **The line**: "Draw a trendline from the highest high (Point C in the figure) to the lowest low (A) on the chart", so
  that price does not cross it until after the lowest low (Bulkowski's wording, paraphrased for the second half).
- **Step 1**: "Find where price closes above the down-sloping trendline."
- **Step 2**: price tests the recent low. "Point 2 can be below point A but it must be clear that price is moving up, not
  continuing down."
- **Step 3**: "Price closes above a recent high." His figure note defines it: "3 is a close above the high between
  points 1 and 2." Only then is the trend change complete.
- So in Sperandeo's frame, **a trendline break alone is a first warning**, confirmed by a higher low and a close above
  the last bounce high. Results in 4.3.

### 3.8 Peter Brandt, "Gold Trendline – Bogus or Bullish?" (peterlbrandt.com, 2017-06-12)

URL: https://www.peterlbrandt.com/?p=12076 (classical chartist, Factor Trading; mostly futures)
- "I have found that patterns with horizontal (or nearly horizontal) boundaries are far more reliable"
- "The most unreliable diagonal chart construction is the trendline, followed closely by the symmetrical triangle."
- "The violation of a trendline does not carry with it a price target"
- "Thus, on its face the penetration of a trendline does not convert a bear market into a bull market or visa-versa."
- He quotes Edwards and Magee's 3% close rule, judges gold's break by it, and on volume answers "Volume actually
  contracted." He adds that for commodities and forex a 1% to 2% margin might be more appropriate (paraphrase).
- His experience figure is in 4.5.

### 3.9 Oliver Kell, via his publisher TraderLion (originator's method; pages published by TraderLion under his byline; the COIN review speaks of him in the third person, so it was likely written by TraderLion staff)

The live site blocks automated readers (HTTP 403), so I read the Internet Archive copies (capture dates in section 11).

"Wedge Pop: The Money Pattern" (published 2024-09-11):
- "The Wedge Pop occurs at the first pivot point to break, signaling that the stock has changed character and is ready
  to begin its uptrend."
- "Many traders mistakenly believe the Wedge Pop is simply about crossing the moving averages. Instead, focus on price
  bars and volume."
- "Enter on a strong price bar with increased volume when the stock breaks through the pivot."
- "If we take out the pivot, we should go higher. We shouldn’t own the stock if we fail here and can’t go higher."
- "It is best to avoid a downtrend when the moving averages act as resistance, guiding the stock lower."
- "As the index forms a Wedge Pop, the strongest stocks will break out from their bases and make new highs."

"Cycle Of Price Action" (published 2024-09-10):
- "When price and moving averages tighten, a pivot forms. A break above short-term resistance and a reclaiming of the
  moving averages offers a clear entry point with well-defined risk." The averages named are the 10 and 20-day EMAs and
  the 50 and 200-day SMAs.

"Anatomy Of A Trade: COIN +110% Trendline Breakout" (published 2024-09-11; the entry is dated 2023-10-31 on the page):
- Context: "COIN began to show some signs of accumulation off a flattening bottom while the 200-day simple moving average
  began to support the price."
- Entry: "Oliver entered through a bull flag trendline and above all the converge moving averages." and "Oliver entered
  COIN on strength through a trendline after the price found support at the moving averages and formed a rounded
  bottom."
- Exit: "The trade was ultimately stopped when it cut through the 10-day exponential moving average."
- On steep lines late in a run: "When the price came through the steepest trendline, it quickly cut through the next."

So Kell buys **on strength through the line**, after a tight range forms against the averages, with volume, above the
converging averages and with the 200-day supporting. (Corrected in checking: the pages do not say whether he buys during
the session or at the close; "on strength through" suggests during the session, but that is a reading, not his words.)
Kell's own book (*Victory in Stock Trading*, 2021 per Open Library) was not read.

### 3.10 IBD, "Early Trendline Entries In Stock Charts Could Double Your Profit; Here's How" (Dominic Gessel, 2025-05-28)

Only the introduction was readable (Yahoo syndication): https://hk.finance.yahoo.com/m/cf7b95fc-f47f-3252-a3c6-4e3b3c6ff4ba/early-trendline-entries-in.html
- "Hindsight is 20/20. IBD's research shows that the optimal buy point is at new highs, not new lows."
- "Trendlines are used to identify price paths in stock charts, commonly over a series of highs or lows."

The rest of the article is behind IBD's paywall (the Yahoo copy stops after these two sentences; the inkl copy answers
HTTP 403). Three more sentences that appeared only in search-result excerpts could not be found on any readable page
and were removed in checking (see the end). Nothing else of IBD's rules is used here; someone with an IBD login should
read the article before IBD is cited on touches, volume or where the line starts.

### 3.11 Stan Weinstein, as summarised by Mike Rawson, 7 Circles (secondary; book not read)

URL: https://the7circles.uk/stan-weinsteins-stage-system-3-selling-shorting/ (2017-05-25, updated 2020-06-18)
- "A trendline is one that connects at least three lows." "When the trendline is broken, sell at least some of your
  position (say half)."
- In this reading, Weinstein uses trendlines **to manage and exit** positions, not as a buy signal. The companion page on
  buying (Stage System 1) mentions "Trendline" only as a glossary word.

### 3.12 Checked and found nothing, or not read

- **Kristjan Kullamägi (Qullamaggie)**, "3 TIMELESS setups that have made me TENS OF MILLIONS!" (qullamaggie.com, 2021-01-08): his post text does not
  mention trendlines (checked in full; the only mention on the page is a reader's comment from 2022, not his). His
  breakout entry is "Enter on the opening range highs." and "Stop is always lows of the day".
- **Pradeep Bonde (Stockbee)**: no trendline material found in one search.
- **Dan Zanger** (chartpattern.com): his "10 Golden Rules" page shows no rule text without a login. Secondary pages
  attribute trendline breakout rules to him; not used.
- **Tom DeMark**: book not read; secondary descriptions of his breakout qualifiers conflict. Not used.
- **Al Brooks**: his books were not read (the O'Reilly excerpt answered HTTP 403), so nothing of his is used
  (corrected in checking: a one-line summary of his method, given without a source, was removed).
- **Investopedia**: blocked (HTTP 402) this session.
- **Wyckoff school**: nothing specific to a trendline break found.

### 3.13 Comparison table

| Source | Prior trend | Line drawn on | Touches | Length / spacing | Slope | Volume | Trigger | Entry | Stop | Target |
|---|---|---|---|---|---|---|---|---|---|---|
| Edwards & Magee (book, ch. 14-15) | written for up lines in a bull market; down lines "far less regular" | tops for a down line | 2 draw, 3 confirm, 4 better | anchors not under a week apart; touches over length | flatter = more important | rising volume confirms; can replace part of the 3% | close ~3% past line, may take 2-3 days; 2% for indexes | none stated | none stated | none for trendlines |
| Murphy (book ch. 4 + StockCharts) | any | entire day's range | 3 to be valid | longer = more critical | ~45 degrees for up lines (scale dependent) | Law 10: volume confirms trend | a close beats an intraday poke; 3% close (long-term), 1% short-term, or 2 closes | none stated | none stated | distance on the other side of the line |
| ChartSchool | any | highs | 2 draw, 3 confirm | n/a | steeper = less valid | not addressed | a break is a warning | none | none | none |
| StockCharts Insider (2025) | any | lower highs | 3 valid | touches too close = noise | n/a | break with volume matters more | "heads-up, not a trading signal" | none | none | none |
| CMT, Taylor (2022) | any | roughly equal pivots, never forced | 2+ | lines evolve | shallow lines define the trend; steep lines are "entry triggers" | n/a | break = neutral, not reversal | not standalone | n/a | n/a |
| Bulkowski (stats) | bull market sample; flat price trend before the line is better | peaks, not cutting through price (log scale signals sooner) | more = more important (tutorial) | longer = better (small effect) | shallow better (56% vs 46%) | falling volume slightly better | first close above line | not stated (measures from the breakout) | none given | start of line (77%), 56% measure |
| Sperandeo 1-2-3 (via Bulkowski) | a downtrend (reversal) | from the highest high, uncrossed until after the lowest low | n/a | n/a | n/a | n/a | step 1 of 3 | after step 3 (close over the high between points 1 and 2) | not given on page | not given |
| Brandt (2017) | any | n/a | n/a | his figure is for weeklies | diagonal = least reliable | wants expansion | 3% close (E&M) | n/a | n/a | none: a break "does not carry with it a price target" |
| Kell / TraderLion (2024) | after a bottom; 200-day supporting; avoid when MAs are resistance | short-term resistance in a tight range | n/a | tight range against the MAs | n/a | strong bar, increased volume | trades through the pivot | intraday, on strength | not stated on these pages; exit under the 10-day EMA in COIN | none; trail |
| IBD, Gessel (2025; only the first two sentences readable) | not read | "over a series of highs or lows" | not read | not read | not read | not read | not read | an early entry (per the headline) | not read | not read |
| Weinstein (via 7 Circles) | n/a | lows (for exits) | 3 | n/a | n/a | n/a | a break = sell some | n/a | trail on the line | n/a |
| UCT owner (Sunday Scans) | leaders, flags, double bottoms, after a correction | "from highs" | n/a | daily and weekly | n/a | n/a | "break of trendline", "needs a close over" | "buyer on strength through" a level | swing low ("invalidated under") | n/a |
| App scanner | none | learned top-1 line through 2 swing highs | 2 anchors | anchors 3-120 bars apart | not limited | not required | close crosses line, green, over prior high, first in 10 sessions, at most 1.5 ATR past | the close | session low | 2R, 3R |

### 3.14 Where the sources disagree

1. **Is the break a buy signal?** ChartSchool, the StockCharts Insider, the CMT tutorial, Brandt and Weinstein's reader
   all say no: it is a warning that the trend may be changing, or a reason to sell an existing position. Bulkowski
   measures it as a buy, Kell buys it (when price is tight against the averages), IBD calls it an early entry, and UCT
   writers trade it. **Reconciliation:** the break is a buy only inside a structure that already says "buy" (a leader's
   pullback, flag or base above the 200-day); on its own it is a warning. The CMT tutorial says the same thing in its
   own terms: steep lines "are very useful as entry triggers" while the larger lines are being tested, but trendlines
   are not "standalone trading opportunities".
2. **How is the break confirmed?** "On strength through" (Kell; the owner's own style in 6.1); the first close
   above (Bulkowski; our scanner); a close about 3% past the line (Edwards and Magee, Murphy for long-term lines, Brandt);
   1% for short-term trading (Murphy); two closes (Murphy); a later close above the last bounce high (Sperandeo). Murphy
   states the trade-off himself: a big filter means "much of the initial move will be missed". A 3% close filter uses
   up most of the house's 4% chase limit (C28) and widens the stop, so it does not fit our account rules for a daily
   swing trade.
3. **How many touches?** Two to draw it, three to call it valid (Murphy, ChartSchool, the Insider, Edwards and Magee).
   Our scanner accepts two anchors. The app's own textbook line layer (section 5.4) demands three.
4. **Slope.** Flatter is better (Edwards and Magee, ChartSchool, Bulkowski's data, my replay). Murphy's roughly 45
   degrees for important up lines depends on how the chart is scaled, so it cannot be measured. The CMT tutorial is
   the exception: steep short lines are its "entry triggers", shallow lines define the trend. Kell's COIN review uses
   steep lines late in a run for exits, not entries.
5. **Volume.** Most say a break needs volume (Edwards and Magee, the Insider, Kell, Manrav in 6.6, Brandt). Bulkowski
   found the volume trend inside the pattern made almost no difference (52% falling versus 50% rising). Edwards and
   Magee let volume stand in for part of the 3% margin.
6. **Drawing.** Over the whole day's range (Murphy, Bulkowski) versus "should never be forced" and "Trendlines evolve" (CMT). Log scale
   (ChartSchool: points line up better; Bulkowski: a break signals sooner) versus arithmetic (our scanner's drawer uses
   raw prices).
7. **Prior trend.** Sperandeo's rule and Bulkowski's trend-change study are reversals out of a downtrend. Kell wants
   the bottom already in and the averages turning; IBD wants a proper base; UCT's examples are mostly pullbacks in
   leaders. The house rule B26 settles it for us: no long below the 200-day.
8. **Target.** Murphy's measuring rule, Bulkowski's 56% rule and the start of the line, against Brandt's view that a break
   "does not carry with it a price target". Our house manages by R, not by pattern targets.
9. **Which time frame.** Brandt's figure is for weekly charts; the owner and Jersace mark weekly and monthly lines (6.1,
   6.4).
10. **Flags.** UCT's lesson plan enters bull flags on the trendline break, but Bulkowski's newer research says high and
    tight flags "fail too often when using a flag trendline break" (4.4).

---

## 4. Measured evidence

No published study measures a trendline-break entry with a stop and an exit the way we trade. Everything below has
limits, listed with each item.

### 4.1 Bulkowski, down-sloping trendlines (the long side)

Source: https://thepatternsite.com/trenddown.html (revised 2021-05-13; read 2026-11-09).
- **Sample.** "Those numbers come in a bull market from 3,274 trendlines taken from 645 stocks, with data from February
  1991 to April 2021." Each stock was above $5 a share.
- **How measured.** From the breakout (the first close above the line) until "the ultimate high (peaked and dropped by
  at least 20%)."
- **Results.** "The average rise is 51% with a median rise of 30%." Failure table (share of lines whose rise never
  exceeded the amount): 5%: 13%; 10%: 24%; 15%: 32%; 20%: 39%; 25%: 45%; 30%: 50%.
- **What mattered.** The line's slope: shallow lines averaged 56% versus 46% for steep ones (median slope 0.05, "not
  degrees"). Line length (longer than the median 48 days), touch spacing (wider than the median 13 days) and a falling
  volume trend each made a small difference (52% versus 50%).
- **The trend before the line** (corrected in checking: the dossier had put these numbers under the line's slope). His
  "Shallow Inbound Trend" section: "The first rule of better performance is to look at the slope of price before the
  start of the trendline." If the price trend from where the trend starts to where the line starts is flat (his range
  "between -.007 to .05", computed from closing prices per day), "Trendlines within that range showed gains averaging
  56%. Outside of that range and the gain dropped to 47%." In plain words: a line that starts after a quiet, sideways
  stretch did better than one that starts after a steep run. His slope is in price per day, so the range depends on
  the stock's price and cannot be copied as a rule.
- **After the break.** A throwback to the line came 59% of the time (an average 5% rise over 9 days, then back,
  finishing in 14 days); after the throwback, price rose 81% of the time. Price reached the start (top) of the line 77%
  of the time.
- **Limits.** No stop is used, and the exit is the perfect one (the eventual top), so these are best-case moves, not
  trade results. Bull market only. The page does not say how the lines were found (corrected in checking: the dossier
  said "by hand", which the page does not state). Any stock above $5, not leaders. Per the
  failure table, about 1 in 4 breaks (24%) rose no more than 10% before topping out; with a real stop, some of the
  others would also have been stopped out before their rise (my reading, not his number).

### 4.2 Bulkowski, up-sloping trendlines (the short mirror)

Source: https://thepatternsite.com/uptrendlines.html (revised 2021-05-14).
- 3,172 bull-market lines (of 3,720 logged) from 699 stocks above $5, March 1991 to April 2021.
- **After the downward break.** The average drop to the ultimate low was 13% in uptrends versus 14% in downtrends.
  "Half (52%) will drop no more than 10%." "the 5% failure rate is 30%". Steep lines saw a slightly bigger drop than
  shallow ones (13.5% versus 12.8%).
- **A long trade riding the line** (corrected in checking: the dossier put two of these quotes under the break). In his
  "Up-Sloping Trendlines: Trading" section he bought at the open after the third touch and sold on the first close
  below the line ("all tests which follow use the first close as a sell signal"): "on 3,172 trades, you'd make an
  average of 0.7% or lose a median of 0.9%", and "The win/loss ratio was 37%." In that test "Shallow trendlines made more money than
  steep ones." This is a test of holding a long along a rising line, not of shorting its break.
- **Reading.** Breaks of rising lines produced much smaller moves than breaks of falling lines (13 to 14% average versus
  51%). The two are not strictly comparable (a drop cannot exceed 100%, a rise can), but half the breaks falling no
  more than 10% is weak support for making the short mirror a featured trade.

### 4.3 Bulkowski, the 1-2-3 trend change (Sperandeo)

Source: https://thepatternsite.com/123tc.html (undated page).
- Downtrends: "73% (74 of 101 samples) of the time price climbed at least 20% from the low (A), confirming a trend
  change."
- Uptrends: in 67 samples, "29 or 43% showed declines of at least 20% below the high at A, representing a trend change."
- **Limits.** Small samples, no dates or markets given, measured from the low (point A), not from an entry, and no stop.
  It tests the full three-step method, not the break alone.

### 4.4 Bulkowski on flags

Source: https://thepatternsite.com/htf.html (statistics updated 2020-08-26). "New research says high and tight flags fail
too often when using a flag trendline break." He says to buy above the pattern's highest high instead ("Only buy when
price closes above the highest peak in the chart pattern (including the flagpole)."). The page gives no numbers for the
comparison. The same page says "Flags with a down-sloping top trendline tend to outperform", so the falling line marks
a good flag; his objection is to using its break as the entry on this one pattern.

### 4.5 Brandt's experience figure (not a study)

"My experience is that 30% of trendline violations on longer-term charts (weeklies) produce a meaningful move" and
"70% of trendline violations completely fail or produce moves that fizzle out quickly." (peterlbrandt.com, 2017-06-12).
An expert's estimate for weekly charts, mostly futures. No sample or method.

### 4.6 Our own lab and blind judging (house records)

- **Recognition, not profit.** The scanner's rule was tuned on the team's own called examples and checked blind: two
  packets read 16 yes / 1 no and 17 yes / 4 no, pooled 86.8% of decided (33 of 38; Wilson 95% interval 73 to 94%). The
  judges were asked whether the marked bar breaks the exact line the rule drew, not whether it is a good trade.
  (`uct_trendline_break.py` docstring)
- **Recall is weak**: DEV 11.9%, TEST 32.4% of the team's calls were found. **It fires a lot**: about 8% of ticker-days
  (docstring).
- **Textbook judging failed.** In recertification C (2026-10-24), two blind judges per packet scored the member tag on a
  strict textbook rubric. Trendline break scored 1.12, then 1.86, then 2.40 with one half under 2.3, against a pass bar of
  pooled 2.4, 70% of cases at 2 or more, and both halves at 2.3 or more. It failed and is **withheld from members**
  (`api/services/pattern_engine/detectors/registry.py`, `SETUP_TAG_MEMBER_WITHHELD`).
- **Forward edge: not in this repo.** The outcome record of the scanner's fires lives outside this public repo, and I
  could not read it. See question 12.
- **No measured edge badge.** `api/services/measured_edge.py` lists one type only (price channel); trendline break has
  no measured edge.

### 4.7 My replay of the 23 judged charts (my computation; tiny sample; re-run independently in checking, every number below reproduced)

The judged fixture `tests/golden_judged/fixtures_labels/setup_tags.json.gz` stores, with the symbols removed and the
prices exact, the bars of 23 charts the judges scored as trendline breaks (two judges, 0 to 3, a placement score, not an
outcome). I re-ran the scanner's own `evaluate()` on each (script kept in my scratch folder, not in the repo).
- Pooled mean score 2.2; 38 of the 46 single scores were 2 or more.
- **Stop width.** Entry at the close, stop at the session low: median 3.13% (range 1.0% to 12.3%); 14 of 23 over 3%.
  If the entry were at the line's value instead, the same stop was a median 0.88% away. Checker's addition: 8 of the 23
  opened above the line, so a fill at the line was impossible there. With the entry at the highest of the line, the
  prior day's high and the day's open (the trigger proposed in 8.2), the stop was a median 1.11% away and 2 of 23 were
  over 3%. This uses the whole day's low; on a real intraday entry the low may still be printing.
- **200-day.** 7 of 23 closed below the 200-day SMA (one 34.8% below). 14 of 23 had a rising 200-day.
- **Other house limits.** 4 of 23 closed more than 4% above the line (C28); 2 of 23 were more than 10% above the 10-day
  average (C29); 6 of 23 broke on volume below the 50-day average.
- **What the better-judged charts had.** Mean score 2.5 or more (11 charts) versus under 2 (5 charts), medians: span
  between anchors 65 versus 22 sessions; slope 0.065 versus 0.209 ATR per session; break-day volume 1.58 versus 0.94
  times the 50-day average; close 0.99 versus 0.43 ATR past the line. This agrees with Bulkowski (shallow, longer) and
  with the volume camp.
- **A quick filter test.** Charts meeting a draft filter (above the 200-day, 15+ sessions since the first anchor, slope
  no steeper than 0.15 ATR per session, volume 1.2x or more): 9 charts, mean score 2.56; the other 14: mean 1.96.
  Illustration only: 23 charts, judged for placement, not profit.
- In the last 120 sessions of these 23 charts, 240 of 2,760 sessions fired the raw rule (8.7%), close to the docstring's
  8%, on a sample that is biased toward charts that fire.

### 4.8 What is missing

- No study of a trendline-break entry with a day's-low stop and R-based exits in leading stocks.
- No peer-reviewed test of diagonal trendline breaks found; academic "trading range break-out" studies test horizontal
  levels, which is a different rule.
- Edwards and Magee and Murphy publish no measured rates (house note).
- The outcome record of the scanner's fires (4.6) is the closest thing to a real test of our rule, and its numbers are
  not in this repo.

---

## 5. Our app

### 5.1 What the scanner actually tests (`api/services/pattern_engine/detectors/uct/uct_trendline_break.py`)

Status: **INTERNAL, admin-only.** A port of the offline lab rule `trendline_break_v3` (the round-2 rule frozen at
"first 10, ext 1.5, trend None").

**The line.** Drawn as of the session before the break (so it exists before the bar that breaks it) by a frozen,
vendored copy of the lab's learned line drawer:
- Swing highs are found in the last 120 sessions with a "strength" of at least 1 (a high above at least one bar on each
  side; the newest bar of the window also counts if its high tops the 3 bars before it; at most the 40 strongest are
  kept). Every pair of swing highs 3 to 120 sessions apart, with the second LOWER than the first, is a candidate line
  through the two highs.
- Each candidate is scored by a fitted logistic model on 14 features: span, slope, touches (highs within 0.25 ATR of the
  line, anchors excluded), closes above the line inside and after the span (a close more than 0.1 ATR above counts),
  whether it is broken now, distance to the close, age of the second anchor, the two anchors' strengths, extension
  ratio, and whether the first anchor is the window's highest high.
- Near-duplicates (within 0.5 ATR) are suppressed and the **top-1** line is taken. Touch count, slope and earlier
  violations only change the score; none is a hard requirement. Prices are arithmetic (no log scale).

**The fire, at session i.** All of these:
- at least 65 sessions of history, ATR above zero, a 50-day SMA exists;
- the close crosses the line on this bar: close above the line's value today, and yesterday's close at or below
  yesterday's value;
- a green bar (close above the open) and a close above the prior session's high;
- the close no more than 1.5 ATR above the line;
- no close above the line in the 10 sessions before (looking back only as far as just after the first anchor).

**Not tested:** no 200-day or 50-day gate ("trend None"), no volume gate (relative volume feeds only the confidence
score, which cannot refuse a fire, see below), no minimum touches, no slope cap, no RS, no earnings check, no distance
from the 10-day average.

**Wrapper.** Liquidity floor: price at least $2 and average dollar volume at least $10,000 over 20 bars. The newest of
the last 3 sessions that qualifies is reported, and only while no later bar traded under its stop. A confidence floor of
50 exists, but the lowest possible confidence is 0.40 x 70 + 0.25 x 40 + 0.20 x 40 + 0.15 x 50 = 53.5, so **the floor
never refuses a fire**.

### 5.2 Levels and narrative

- Entry = the break session's close; stop = the session's low (no "few cents under"); targets 2R and 3R
  (`uct_setups_common.make_levels`); pivot = the line's value that day.
- Narrative: "Follow-through that holds above the line ... ideally on expanding volume." Failure: "A close back under the
  line undoes the break; a trade below [the stop] is the stop."
- The member tag text (`api/services/setup_tags.py`): "A green session that closes up through a falling trendline drawn
  across prior swing highs." (withheld from members, 4.6)

### 5.3 Model Book, journal tags, Study plans

- **Model Book** (`app/src/pages/modelbook/setupCatalog.js`): **no Trendline Break card.** The Bull Flag card draws a
  diagonal dashed trendline across the flag's highs (`trend: { from: 3, to: 8, side: 'h' }`). The Wedge Pop card is
  keyed to the averages ("the pop reclaims them").
- **Journal tags** (`app/src/constants/setupGroups.js`): **no Trendline Break tag.** The team playbook export does have
  a setup row with the id `trendline_break`, which the N15 note lists among "ledger setups without an engine template", so the
  team's own setup list and the app's journal disagree.
- **TRADE_PLANS.md**: no trendline-break plan.
- **Study lesson plan**: the Bull Flag lesson is titled "Bull Flag: The Flagpole, the Quiet Drift, and the Trendline
  Break" and enters "on the break of the flag's upper trendline" (`docs/curriculum/uct_method_chapters.json`;
  `docs/study/UNITS-method.md` SET.08). Study course V.02 already teaches "A trendline break is a warning, not the final
  word." (from ChartSchool).

### 5.4 The app's own textbook line, for comparison (`api/services/pattern_engine/sr_levels.py`, round r7)

The chart's support/resistance layer, which passed a strict Edwards and Magee / Bulkowski blind recertification (pooled
2.45), draws at most one falling line over swing highs with: at least 3 swing pivots within 0.15 ATR of the line, at
least 10 bars apart; at least 40 sessions from first to last touch; the line moving at least 1.5 ATR over that span;
slope no more than 0.5 ATR per bar; no bar through it by more than 0.25 ATR up to the last touch; no 3% close through
it; last touch within 60 sessions. That is a much stricter, judge-approved definition of "a real trendline" than the
scanner's learned top-1 line. Separately, the owner withdrew the learned drawer's lines from members on 2026-10-23
"until the layer is rebuilt to textbook support/resistance rules and passes blind judging" (`docs/feature_flags.json`).
The scanner still uses a frozen copy of that learned drawer.

### 5.5 Where the app disagrees with the sources or the house, or looks wrong

1. **No 200-day gate.** B26 is a hard rule; in my replay 7 of 23 judged fires were below the 200-day.
2. **The line is not a textbook line.** Two anchors 3 sessions apart can make a line; touches and slope only change a
   score. The sources want 3 touches, anchors not under a week apart, and shallow slopes; the app's own r7 layer
   requires all of that. The judges' main complaint was "near-flat lines, very short spans, and lines already closed
   through inside their own span" (docstring).
3. **"First break" is only 10 sessions deep.** A line closed above 11 or more sessions ago can fire again. Bulkowski's
   break is "the first place where price closes above the trendline".
4. **No volume requirement**, while most sources and UCT's writers want volume (6 of 23 judged fires were on
   below-average volume).
5. **Entry at the close makes the day's-low stop wide**: median 3.1% in my replay, 14 of 23 over 3% (A13). Entering as
   price crosses the line gave a median 0.9%.
6. **Targets 2R and 3R** are the old app plan; the house now trims a third at 3R and a third at 5R (B19, E51).
7. **Stop exactly at the low**, not a few cents under (F62).
8. **Liquidity floor $2 and $10,000 a day**, against the house's $10 and $20 million (B23).
9. **The 1.5 ATR cap** can exceed the house 4% chase limit on volatile names (C28): 4 of 23 closed over 4% past the line.
10. **Arithmetic prices**, where Bulkowski and ChartSchool prefer log scale.
11. **No RS, earnings or 10-day-stretch checks** (C31, B22, C29).
12. **Fires too often to be a teaching filter** (about 8% of ticker-days).
13. **The confidence floor is dead code** for this detector (minimum 53.5 against a floor of 50).

None of this is a bug in the narrow sense: the rule does what its lab proved (it recognises a break of the line it drew).
It is not yet a definition of our setup.

---

## 6. UCT's own words

All quotes copied from the saved Substack pages. Dates are the dates the posts show. The page shows the UTC date, so the
"Rest of the Week" posts, which go out in the evening US time, carry the next day's date: for a chart example, the
writer's day is the day before (added in checking). The owner writes the "TSDR's Weekly Outlook & Watchlist" section
(the 2026-11-08 issue, sunday-scans-70f, titles it "Patrick (TSDR)’s Weekly Outlook & Watchlist"). (Corrected in
checking: the dossier said `sizing_rule.md` quotes this section; it quotes the Sunday Scans of 2026-06-14 and
2026-07-19 as "the owner's own published rules", and its 3% quote comes from that June issue's INTRO, not this section.)

### 6.1 The owner (TSDR section, Sunday Scans)

- **BROS, weekly** (2026-01-11, https://unchartedterritoryy.substack.com/p/sunday-scans-0b3): "Now a double bottom on
  weekly and looking to confirm a weekly higher low and break of trendline. Long signals over $64 and the near term chart
  for a swing is invalidated under $61.50 or $58.65"
- **TWLO, weekly** (2025-12-14, https://unchartedterritoryy.substack.com/p/sunday-scans-f2f): "Set to breakout of this
  trendline from 2025 highs. Really needs a close over %125 to set a move to $160 imo." (typo as printed)
- **ASTS** (2025-06-08, https://unchartedterritoryy.substack.com/p/sunday-scans): "Attractive strength last week, but
  needs some sideways here and tightness below this trendline from highs."
- **MDB** (2025-11-16, https://unchartedterritoryy.substack.com/p/sunday-scans-d6a): "$338 holding is ideal then tighten
  up below the trendline."
- **SANM** (2025-11-30, https://unchartedterritoryy.substack.com/p/sunday-scans-422): "Still tracking looking for a break
  of this trendline."
- **ALAB** (2025-12-28, https://unchartedterritoryy.substack.com/p/sunday-scans-249): "Forming a bit of a flag here out of
  the trendline and below a key level."
- **SERV** (2025-09-01, https://unchartedterritoryy.substack.com/p/sunday-scans-4d1): "SERV boosted 14% on Wednesday to
  remount all MAs. Trying to build above this trend line and launchpad."
- **RELY** (2026-03-08, https://unchartedterritoryy.substack.com/p/sunday-scans-dcf): "Earnings gap up on 2/26 over the
  200SMA and breaking a downtrend."
- **APPN** (2025-11-23, https://unchartedterritoryy.substack.com/p/sunday-scans-56d; added in checking): "Broke out of a
  major weekly downtrend/base on solid earnings. Now showing RS and flagging out. Weekly could use a tad more build out
  but we also see these ignite."
- How he buys a pivot (a wedge pop, not a trendline, but the same entry style), **INCY** (2025-12-28, sunday-scans-249):
  "I am a buyer on strength through $100.5 looking for a close above $103.50 to show good presence of buyers."
- What he does not want, **CRWV** (2025-09-21, https://unchartedterritoryy.substack.com/p/sunday-scans-88a): "Price over
  the past 5-6 days has a wee bit of wedging up action. It would be very actionable to see a shakeout down towards the
  MAs and $115 zone before making a easy uptrend move."
- Where he wants entries (2026-02-08, https://unchartedterritoryy.substack.com/p/sunday-scans-29e): "I want to see some
  stories and stocks get tight and offer good entries against the 20EMA via wedge pop or crossback."

### 6.2 Bracco (Bracco's Breakdown & Top Ideas)

- **FJET** (2026-05-31, https://unchartedterritoryy.substack.com/p/sunday-scans-6d8): "Broke the downtrend line and
  putting in a crossback."
- **HUT** (2026-09-20, https://unchartedterritoryy.substack.com/p/sunday-scans-bc2): "Defended 200sma and now trying to
  take out this downtrend line from highs. Very orderly correction and consolidation since highs in June."
- **ETH analog** (2025-09-21, sunday-scans-88a): "This analog suggests another 1-2 weeks of shakeout and tightening below
  this trendline and it could be ready."
- On counter-trend turns (an index, not a trendline; for question 11; added in checking), 2026-03-22,
  https://unchartedterritoryy.substack.com/p/sunday-scans-cab: "Whenever I am looking for a potential mean reversion
  turning point out of a downtrend, I really try to focus on a few characteristics. First will be range and volume
  expansion."
- Bracco's "The Parabolic Short" post does not mention trendlines.

### 6.3 Sunday Scans, Index & ETF section (no byline)

- **SPX** (2026-07-12, https://unchartedterritoryy.substack.com/p/sunday-scans-898): "Clean action last week and taking
  out the downtrend line now."
- **SPX** (2026-07-05, https://unchartedterritoryy.substack.com/p/sunday-scans-dec): "For now struggling at this upper
  trendline and $7,500 area."
- **ARKQ** (2025-12-21, https://unchartedterritoryy.substack.com/p/sunday-scans-34b): "Robotics and Autonomy ETF getting
  tight below trendline and looking for a breakout."
- **XLC** (same issue): "Tight flag coming out of downtrend break. Looks like a breakout coming soon."

### 6.4 "The Rest of the Week" contributors

- **Manrav, CRWV** (2025-11-26, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a): "Bottom fishing/Snap
  back trade idea. Tight range candles for 10 days now with above average volume. Still acting weak but like the lower
  wicks. A break above the trendline and this can see 85 quick." Then: "Trade Idea: Long with 65 stop"
- **Manrav, ON** (2025-12-10, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b3f): "A launch pad and a
  cross back and has the cup and handle look on daily. Long above the tight inside day or the trendline."
- **ChartMaster, EME** (2025-10-01, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week): "Can look for an
  entry thru the top of the flag or back up off defined support of the trendline."
- **TINY TRADES, LOAR weekly** (same post; added in checking): "Weekly chart broke downtrend and consolidating here with
  4 tight weeks."
- **ChartMaster, CAT** (2025-11-26, the-rest-of-the-week-22a): "putting in hammer today testing trend line resistance."
- **Alex Jones Industrial Average, CIFR** (2026-01-14, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305):
  "Starting to breakout of this consolidation/trend line here."
- **Alex Jones Industrial Average, OXY weekly** (2026-02-04, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732):
  "Teasing this massive downtrend line here with a clear rotation happening in the markets."
- **Alex Jones Industrial Average, CEG (short side)** (2025-11-05, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9):
  "Sitting at a precarious uptrend line and looking vulnerable before."
- **Jersace, ARM** (2025-10-08, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208): "it is on the verge
  of a very large weekly / monthly down trendline breakout. A trigger above 164 supply level would be considered the
  pivot for new highs."

### 6.5 The owner's verdict log

On an Oops Reversal example (LQDA, chart dated 2023-06-15; `owner_verdicts.jsonl` line 20), about where a good long sits:
"I want it in a flag or as a like double bottom, or wedging down, or at the end of a downtrend. Location matters big
time on these". There is no ruling on the trendline break itself.

### 6.6 House knowledge base (summaries, NOT anyone's verbatim words)

These lines are machine-written summaries in `docs/study/levels/brain_kb_*.json` of posts in the team's Discord archive.
They are paraphrases, so they must not be quoted to members as anyone's words.
- Manrav, archive t7275 (QQQ, May 2024): on 5/6 QQQ "pushed above resistance/wedge on anemic volume: low-volume trendline
  breakouts tend to fail" (summary).
- Manrav, archive t10750 (GEV notes, 2024-10-06): annotated "inside day and trendline break add with a 50 SMA stop"
  (summary). He used the break to ADD, which our A5 rule does not allow.
- Bracco, archive t10646 (2024-10-12, HOOD 65-minute): after a pullback on volume dry-up and an undercut-and-rally at
  the earnings AVWAP, "a trendline break led to +16% in 3 days and +22% in 6" (summary).
- Bracco, archive t9770 (2024-08-28): NVDA "with a failed trendline breakout and weekly bearish engulfing" (summary).
- Manrav, archive t9337 (2025-10-03): don't chase; wait for "a good R/R spot (near a pivot, MAs, launch pad, trendline
  break)" (summary).
- The UCT team playbook row "Wedge pop / EMA crossback" (`setup_knowledge:sk_wedge_pop`, house text with no author):
  "The team prefers the crossback (first pullback holding the 10/20 EMAs) or the break of the short trendline over
  chasing the pop itself. Stop: Just below the EMAs or the low of day".

### 6.7 What UCT's words add up to

1. The line runs **"from highs"**, often on the **weekly** chart for bigger moves (BROS, TWLO, OXY, ARM).
2. UCT wants price **tight below the line** before it breaks ("tightness below this trendline", "tighten up below the
   trendline", "getting tight below trendline"), not "wedging up" into it.
3. The break is usually **one part of a bigger structure**: a double bottom with a weekly higher low (BROS), a flag (ALAB,
   XLC, EME), a launchpad or inside day (SERV, ON), an earnings gap or earnings breakout (RELY, APPN), the 200-day
   defended (HUT), the averages reclaimed and a crossback (FJET), tight weeks after the break (LOAR). APPN and XLC also
   show the follow-up the owner watches for: a flag after the line breaks.
4. The buy is **on strength through a level**, with a **close** above it wanted as proof (INCY, TWLO).
5. The stop/invalidation is a **swing low or a level under the structure** (BROS "invalidated under $61.50 or $58.65";
   Manrav's 65 stop on CRWV), sometimes a moving average (the playbook).
6. Volume matters (Manrav's "anemic volume" note, CRWV's "above average volume").
7. One UCT example (Manrav's CRWV, "bottom fishing") is a counter-trend idea; under B26 it would need to be above the
   200-day.

---

## 7. How it fits the account rulebook (`sizing_rule.md` section 9)

| Rule | How it applies to a trendline break | Conflict or note |
|---|---|---|
| B26, the 200-day (hard) | Long only above the 200-day SMA | Classic reversal breaks (Sperandeo, Bulkowski's trend change, "bottom fishing") often happen below it. Those are not our trade. 7 of 23 judged fires were below. |
| C31, RS 80+ | Leaders only | The exception "mean reversion" could be argued for a bottoming break, but B26 still blocks it below the 200-day. |
| A3, F62, A13: stop | A few cents under the break day's low (or the prior day's low) | From a close entry the day's-low stop is often over 3% (median 3.1%, 14 of 23 in my replay). An entry at the line keeps it near 1%. |
| A4, the stop only moves up | The stop is the exit | A "close back under the line" exit would be an extra rule; see question 8. |
| A5, one entry, no adds | Buy the full position once | UCT writers (Manrav, Kell) use breaks to ADD; in our course a break is only a first entry. |
| C28, no more than 4% past the buy point | The buy point is the line's value that day | Edwards and Magee's 3% close filter would use most of it. The scanner's 1.5 ATR cap can exceed it. |
| C29, not more than 10% over the 10-day | Check on the trigger day | Rarely binding (2 of 23). |
| E57, market orders | Market order when the trigger prints | Fits the "on strength through" entry. |
| B19, E51, E52, F63 | Breakeven 2R to 5R; a third at 3R, a third at 5R; trail the rest under the 10-day (fast) or 21-day (steady) | Replaces the app's 2R/3R targets. |
| B20, gap through the stop | First 30-minute low is the new stop; out past 2R | No change. |
| B21, after a stop-out | Only a new trigger | Do not redraw the same line to get back in. |
| B22, earnings | No new buy in the 3 days before a report | The scanner does not check it. |
| B23, D42, liquidity | $10+, $20M+ a day | The scanner's floor is $2 and $10,000. |
| C33, time stop | Under 1R after 10 sessions: sell | Fits; failed breaks often go sideways. |
| D47, shorts mirrored | Break down through a rising line under lows, below the 200-day | Allowed by the rules; the evidence is weaker (4.2). |
| B18, F65, market reading | Green: full; Yellow: smaller, fewer; Orange: A+ only; Red: mostly cash | Kell ties the best breaks to an index wedge pop. |
| E56 | At most 3 tries a week, 6 a month on one stock | Trendline breaks invite repeated tries; this caps them. |

---

## 8. Proposed rules for our course

### 8.1 What it is (all must be true unless marked as a grade item)

1. **Trend location.** The trigger day closes above the 200-day SMA. [house rule B26] The 200-day is flat or rising
   (higher than 20 sessions earlier). [my proposal; question 2]
2. **Leader.** RS rating 80 or more, in one of the strongest groups. [house rule C31]
3. **Liquidity.** Price $10 or more; at least $20 million traded a day. [house rule B23]
4. **The line.** Drawn over the daily highs (wicks included) of the pullback or base, starting at its highest high (the
   left-side high), on a log chart. [source consensus for the highs and wicks: Murphy, Bulkowski, ChartSchool; for
   starting at the highest high: Sperandeo's line via Bulkowski and UCT's "trendline from highs"; for log scale:
   ChartSchool and Bulkowski (corrected in checking: the IBD excerpt this cited could not be confirmed and is removed)]
5. **Touches.** At least 2 swing highs on the line to draw it; 3 or more for an A grade. A touch is a swing high within
   about 0.25 ATR of the line. [source consensus for 2 and 3; the 0.25 ATR tolerance is the scanner's own, my proposal
   to reuse it]
6. **A clean, first break.** No daily close above the line between the first anchor and the trigger day (a wick through
   is allowed). [Bulkowski "not cutting through price" and "the first place where price closes above"; the strict zero
   is my proposal; the scanner allows a close 11+ sessions earlier]
7. **Spacing and length.** Anchors at least 5 sessions apart; the trigger day at least 15 sessions after the first
   anchor; best between about 20 and 120 sessions. [Edwards and Magee "less than a week apart" is unreliable; the
   numbers are my proposal, supported by my replay (better-judged spans were longer)]
8. **Slope.** The line falls no faster than 0.15 ATR per session (A grade: 0.10 or less). [direction: source consensus;
   numbers: my proposal from my replay]
9. **Depth.** The lowest low under the line is no more than 35% below the first anchor high. [my proposal; question 5]
10. **Tight under the line.** In the 5 sessions before the trigger, the closes sit within about 5% under the line and the
    average daily range is smaller than the 20-session average. Not "wedging up" (rising lows into the line on shrinking
    volume). [UCT for the idea; Kell for "tighten"; numbers my proposal]
11. **Averages.** The trigger day closes above the 10-day and 21-day EMAs (reclaimed or held). Above the 50-day SMA is
    a grade item. [originator: Kell "reclaiming of the moving averages", COIN "above all the converge moving averages"]
12. **Volume.** Trigger-day volume at least 1.2 times its 50-day average (A grade: 1.5 times or more). [source
    consensus for "increased volume"; numbers my proposal; my replay: better-judged breaks had a median 1.58x]
13. **Not stretched.** Not more than 10% above the 10-day average. [house rule C29]
14. **Earnings.** No report due in the next 3 sessions. [house rule B22]

### 8.2 The buy

- **Trigger (recommended).** During regular hours, price trades above the line's value for the day AND above the prior
  day's high, with volume running on pace for at least 1.2x. Buy the full position with a market order. [originator:
  Kell "on strength through a trendline"; UCT: the owner's "buyer on strength through"; the prior-day-high condition
  is the scanner's lab rule; house rules E57, A5]
- **Alternative (for members who cannot watch the open).** Buy at the close of the first day that closes above the line
  and above the prior day's high, in the upper part of its range. [Bulkowski's breakout definition; the scanner]
  Trade-off: a later, higher price and a wider stop (my replay: median 3.1% versus 0.9%).
- **Recommendation: the intraday trigger.** It matches how the owner buys ("a buyer on strength through") and Kell's
  "on strength through a trendline", keeps the stop near the house's 3% habit (checker's replay: median 1.11%, 2 of 23
  over 3%, section 4.7), and keeps the buy inside the 4% chase limit. The cost is more false starts that never close
  above the line (Murphy: "a close beyond the trendline is more significant than just an intraday penetration"); the
  day's-low stop keeps that cost small.
- **Chase limit.** Do not buy more than 4% above the line's value that day, or more than 1.5 ATR above it, whichever is
  smaller. [house rule C28; the 1.5 ATR is the scanner's]
- **Gaps.** A gap open more than 4% above the line is no trade. [house rule C28]
- **Not a 3% close filter.** Do not wait for a close 3% past the line. That rule is for long-term lines (Murphy) and
  would break C28 and the 3% stop habit; Murphy himself warns that a big filter means "much of the initial move will be
  missed". [my proposal]

### 8.3 The stop

- A few cents under the trigger day's low as it stands at entry; the prior day's low is the wider choice. [house rule
  A3, F62]
- Size from the stop; if the honest stop does not fit the risk, take the smaller size the formula gives or skip. Never
  tighten it. [house rule A3, A5]
- The stop sits with the broker (D41) and only moves up (A4). A gap through it: the 30-minute rule (B20).
- Structural alternative, for the owner to choose: under the lowest low under the line (the low Bulkowski's 1-2-3 page
  calls point A or point 1; corrected in checking: the dossier said point 2, which is the retest that forms AFTER the
  break). Wider, so smaller size. [question 7]

### 8.4 Trims and trail (house defaults)

- Breakeven at 2R to 5R; a third off at 3R, a third at 5R; trail the last third under the 10-day (fast movers) or 21-day
  (steadier), selling on a close below it. A gap over a trim level: trim at the open. [house rules B19, E51, E52, F63]
- Time stop: still under 1R after 10 sessions, sell. [house rule C33]
- A climax burst on the way up: sell a big part into it. [house rule C34]
- Context, not a rule: the first anchor high is overhead supply; Bulkowski found price reached the start of the line 77%
  of the time. No pattern target replaces the R-based trims (Brandt: a break "does not carry with it a price target").

### 8.5 What invalidates it

Before entry:
- the line was already closed through earlier (not a first break); the line is too steep or too short (8.1 items 7, 8);
- the stock is below the 200-day or under falling averages acting as resistance (Kell: "avoid a downtrend when the
  moving averages act as resistance");
- price is wedging up into the line on fading volume (UCT; Kell);
- a gap of more than 4% over the line, or a stretched stock (C28, C29);
- earnings within 3 sessions (B22); a Red market (F65).

After entry:
- the stop trades (A4); the time stop (C33).
- A close back under the line: in the sources this "undoes the break" (our scanner's own text) and Kell says "We
  shouldn’t own the stock if we fail here". Our rulebook makes the stop the exit, so this is question 8.

### 8.6 The short mirror

- **Mirror (if the owner keeps it):** a close down through a rising trendline drawn under at least 2 swing lows, below
  the 200-day SMA, RS 20 or less in a weak group, borrow available; sell short on weakness through the line and under
  the prior day's low; stop a few cents over the trigger day's high; the same trims. [house rules D47, B26, C31 mirror,
  D48] Asking for a FALLING 200-day as well is my proposal, not B26 (corrected in checking: the tag implied B26 said
  "falling").
- **Evidence is weaker:** Bulkowski's up-sloping breaks averaged a 13 to 14% drop and half fell no more than 10%; the
  1-2-3 worked 43% of the time in uptrends versus 73% in downtrends (4.2, 4.3). UCT's one written short-side example is
  CEG "Sitting at a precarious uptrend line and looking vulnerable" (6.4).
- **Recommendation:** teach it as a recognised mirror, graded no higher than B, and not as a featured short. [my
  proposal; question 10]

### 8.7 Best market conditions

- Green market reading (B18, F65). [house rule]
- The index itself breaking its own downtrend line or making a wedge pop: Kell says "As the index forms a Wedge Pop, the
  strongest stocks will break out from their bases and make new highs." UCT tracked the S&P 500 "taking out the
  downtrend line" in July 2026. [originator; UCT]
- Bulkowski's numbers are all from bull markets. [study]

### 8.8 Common mistakes

1. Forcing a line through the "right" points. [CMT: "should never be forced"; ChartSchool "best not to force the issue"]
2. Buying breaks of steep lines. [ChartSchool; Edwards and Magee; Bulkowski; my replay]
3. Two touches a few days apart. [Edwards and Magee; StockCharts Insider "nothing more than noise"]
4. Treating any break as a reversal. [ChartSchool; CMT; Brandt; Sperandeo's step 1 of 3]
5. Buying a low-volume break. [Insider; Kell; Manrav's QQQ note]
6. Buying a beaten-down stock's first break below the 200-day. [house rule B26]
7. Chasing a gap far over the line. [house rules C28, C29]
8. Redrawing the line after it fails to get back in. [CMT "lines evolve"; house rule B21]
9. Buying a wedge up into the line instead of a tight drift down. [UCT; Kell]
10. Ignoring the overhead: the old high where the line starts, or "a key level" just above (ALAB). [UCT; Bulkowski]
11. Using the flag's trendline break on a high tight flag. [Bulkowski, 4.4]
12. Using a break to add to a position. [house rule A5]

---

## 9. Grading (observable cues; E50 says grading is the owner's judgment, so this is a guide, not a checklist)

| Grade | What you see |
|---|---|
| **A+** | A leader (RS 90+) in a leading group, above a rising 50 and 200-day, in a Green market. A long (40+ sessions), shallow line (0.10 ATR per session or less) with 3+ clean touches spaced out. Price tight under the line for several days on drying volume, the 10 and 21-day EMAs converging under it. The break comes on 1.5x volume or more, closes in the top of its range, and the stop is 3% or less. Room to the first anchor high. Ideally also a weekly structure (a weekly higher low, BROS) or a market wedge pop. |
| **A** | As above with one soft spot: two good touches plus a near touch, or volume 1.2 to 1.5x, or the 50-day flat. |
| **B** | A valid line but short (15 to 25 sessions) or steeper (0.10 to 0.15 ATR); volume about average; a Yellow market; or the stop 3 to 5% away. |
| **B-** | Two touches only; below the 50-day; a wide stop; a "key level" just above (ALAB's "below a key level"); a short-side mirror; or an Orange market (F65 says A+ only there, so a B- is a pass). |
| **No trade** | Below the 200-day; line already broken; gap more than 4% over the line; earnings within 3 days; Red market. |

Basis: Bulkowski (shallow and longer did better), Edwards and Magee and ChartSchool (flatter, more touches, longer),
Kell and the Insider (volume), UCT's "tightness below this trendline", the house rules, and my replay (better-judged
charts had longer, shallower lines and more volume). Size by grade per D38 and E49.

---

## 10. Questions for the owner

1. **Standalone or trigger?** (a) A standalone setup with its own Model Book card and journal tag; (b) an entry trigger
   taught inside the flag, wedge pop, double bottom, cup-handle and launchpad lessons; (c) both. My lean: (c), with the
   card saying "it is the trigger, the structure is the setup". The team playbook already has a `trendline_break` setup
   row; the app's journal does not.
2. **The 200-day.** B26 requires price above it. Should the 200-day also be rising, or is flat enough?
3. **The trigger.** (a) intraday through the line and over the prior day's high (my recommendation); (b) the close above
   the line; (c) the day after, over the break day's high.
4. **Touches.** (a) 2 is enough; (b) 3 required; (c) 2 to trade, 3 for an A.
5. **Numbers.** Minimum line age (I propose 15 sessions), maximum slope (0.15 ATR a session), maximum depth (35%), volume
   (1.2x). Accept, change, or drop each?
6. **Daily and weekly.** Teach weekly lines too (your BROS and TWLO posts), or daily only?
7. **The stop.** (a) under the break day's low (house default); (b) under the lowest low under the line (structure);
   and if the day's low is more than 3% away, skip or take the smaller size?
8. **A close back under the line.** (a) not an exit: the stop is the stop (A4); (b) an exit at the close or the next
   open. Your "my stop is my stop most of the time" suggests (a).
9. **Throwback entries.** Bulkowski says 59% of breaks come back to the line, and Murphy writes "Very often a down
   trendline will become a support line once it's been broken on the upside." If the first break is missed or too
   extended, is a hold of the line on the throwback a valid entry, or is that a different setup (a pullback)?
10. **The short mirror.** Teach it (graded B at most), or leave shorts to the bear-gap and parabolic setups?
11. **Bottom-fishing breaks.** Manrav's CRWV idea was a break while "still acting weak". Under B26 it only qualifies
    above the 200-day. Is that the line you want, or is it a mean-reversion trade with its own rules?
12. **Your own records.** The team playbook has a `trendline_break` setup row, and the brain keeps an outcome record of
    the scanner's fires. Neither is in this public repo. Can you share your trendline-break playbook notes and the
    outcome summary for this setup? That would be the only real outcome evidence we have.
13. **The scanner.** Before it feeds Study examples, should it get the 200-day gate, a 3-touch / shallow-slope line
    (like the app's own judged r7 line), a volume gate, a strict first-break rule, the house liquidity floor and the
    3R/5R plan? Any change needs a new blind check, as its docstring says.

**Leads for the 10 examples (not yet checked against these rules or for outcome):** COIN 2023-10-31 (Kell, TraderLion);
TWLO weekly line from the 2025 highs (owner, 2025-12-14); BROS weekly double bottom (owner, 2026-01-11); SANM (owner,
2025-11-30); ALAB flag out of the trendline (owner, 2025-12-28); RELY earnings gap breaking a downtrend (owner,
2026-03-08); HUT (Bracco, 2026-09-20); FJET (Bracco, 2026-05-31); ON (Manrav, 2025-12-10); EME (ChartMaster, 2025-10-01);
CIFR (Alex Jones Industrial Average, 2026-01-14); ARM weekly / monthly (Jersace, 2025-10-08); S&P 500 (Sunday Scans,
2026-07-12) as a market example; added in checking: APPN weekly downtrend broken on earnings, then a flag (owner,
2025-11-23) and LOAR weekly (TINY TRADES, post dated 2025-10-01). The 23 judged charts in the app's fixtures carry no
symbols, so they cannot be named. Every example must also pass the rule the verdict log records for all setups after
the owner cut a failed Oops example (PRKS, 2022-02-24; his words: "Dude idk why you are choosing crappy ones that fail
a few days later and enter downtrends"): "HARD RULE for every setup: the example must WORK after the trigger." (the
log's wording, not his). The "Rest of the Week" dates
above are the page's UTC dates; the writer's trading day is the day before.

---

## 11. Sources (read 2026-11-09 unless marked)

**Originators and their publishers**
- Bulkowski, T. "1-2-3 Trend Change Method" (credits Sperandeo). https://thepatternsite.com/123tc.html. Undated page.
  Reliability: originator's method in a careful researcher's words; small samples. Site forbids AI training.
- Sperandeo, V., with T. S. Brown, *Trader Vic: Methods of a Wall Street Master*, Wiley, 1991. NOT read; year and
  publisher from library records (https://openlibrary.org/books/OL1867505M; https://libcat.library.tamu.edu/Record/in00001626468).
- TraderLion, "Wedge Pop: The Money Pattern" (Oliver Kell byline), published 2024-09-11. Live page
  https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/ returns 403; read via
  http://web.archive.org/web/20241006111805/https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/.
  Reliability: publisher's description of the originator's method.
- TraderLion, "Cycle Of Price Action" (Oliver Kell byline), published 2024-09-10. Read via
  http://web.archive.org/web/20250119115745/https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/.
  Same reliability.
- TraderLion, "Anatomy Of A Trade: COIN +110% Trendline Breakout" (Oliver Kell byline), published 2024-09-11. Read via
  http://web.archive.org/web/20250211104800/https://traderlion.com/profile/oliver-kell/coin-trendline-breakout/. One
  trade review, not a rule set.
- Brandt, P. "Gold Trendline – Bogus or Bullish?", 2017-06-12. https://www.peterlbrandt.com/?p=12076. Reliability:
  veteran classical chartist; experience figures, not a study; futures focus.
- Murphy, J. "John Murphy's 10 Laws of Technical Trading", StockCharts ChartSchool. https://chartschool.stockcharts.com/table-of-contents/overview/john-murphys-10-laws-of-technical-trading.
  Undated. Reliability: the author's own summary.
- Kullamägi, K. "3 TIMELESS setups that have made me TENS OF MILLIONS!" (the page headline; corrected in checking), 2021-01-08 (updated 2021-04-28).
  https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/. Checked for trendlines: none in his
  text (one reader comment only).
- Kell, O. *Victory in Stock Trading*, 2021 (Open Library). NOT read.

**Books (checked in the Internet Archive OCR texts in checking)**
- Edwards, R. D., Magee, J., Bassetti, W. H. C. *Technical Analysis of Stock Trends*, 11th ed., CRC Press 2018 (first ed.
  1948). OCR text: https://archive.org/download/robert-d.-edwards-john-magee-w.-h.-c.-bassetti-technical-analysis-of-stock-trend/Robert%20D.%20Edwards_%20John%20Magee_%20W.H.C.%20Bassetti%20-%20Technical%20Analysis%20of%20Stock%20Trends%2C%20Eleventh%20Edition-CRC%20Press%20%282018%29_djvu.txt
  (chapters 9, 14 and 15 used).
- Murphy, J. *Technical Analysis of the Financial Markets*, NYIF 1999. OCR text:
  https://archive.org/stream/JohnJ.MurphyTechnicalAnalysisOfTheFinancialMarkets/John_J._Murphy_-_Technical_Analysis_Of_The_Financial_Markets_djvu.txt
  (chapter 4 used).
- The same scans are the source of the house note `docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md`.
  Reliability: primary texts, but OCR; check a print copy before any quote ships to members.
- Sperandeo and Kell books: see above; DeMark, T. R. *The New Science of Technical Analysis*, Wiley 1994 (Open Library
  record; NOT read).

**Measured statistics**
- Bulkowski, T. "Bulkowski on Down-Sloping Trendlines" (the page heading; revised 2021-05-13). https://thepatternsite.com/trenddown.html.
- Bulkowski, T. "Bulkowski on Up-Sloping Trendlines" (revised 2021-05-14). https://thepatternsite.com/uptrendlines.html.
- Bulkowski, T. "Bulkowski's Down-Sloping Trendline Tutorial" (released 2020-02-06). https://www.thepatternsite.com/QTL.html.
- Bulkowski, T. "High and Tight Flag" (statistics updated 2020-08-26). https://thepatternsite.com/htf.html.
- Reliability for all four: the largest published hand-collected samples; best-case exits, no stops; the site states it
  "shall not be used to train artificial intelligence (AI) systems" (flagged in 3.6).
- Bulkowski, T. "The Truth About Trendlines", *Stocks & Commodities* V.20:10 (Oct 2002), pp. 40-43. Abstract only
  (https://store.traders.com/v2040trutabt.html); article NOT read.

**Established educators**
- StockCharts ChartSchool, "Trend Lines" (no author shown). https://chartschool.stockcharts.com/table-of-contents/chart-analysis/trend-lines.
- Montevirgen, K. "StockCharts Insider: John Murphy's Law #5 - Draw the Line (Trendlines)", StockCharts, 2025-11-21.
  https://articles.stockcharts.com/article/stockcharts-insider-john-murphys-law-5-draw-the-line-trendlines/.
- Taylor, S. (CMT). "Trendlines & Channels Tutorial: Part 1", CMT Association, 2022-09-26. https://cmtassociation.org/?p=64056.
- Gessel, D. "Early Trendline Entries In Stock Charts Could Double Your Profit; Here's How", Investor's Business Daily,
  2025-05-28. Introduction read via https://hk.finance.yahoo.com/m/cf7b95fc-f47f-3252-a3c6-4e3b3c6ff4ba/early-trendline-entries-in.html;
  full article paywalled, NOT read (the inkl copy answers HTTP 403).
- Rawson, M. "Stan Weinstein's Stage System 3 – Selling and Shorting", 7 Circles, 2017-05-25 (updated 2020-06-18).
  https://the7circles.uk/stan-weinsteins-stage-system-3-selling-shorting/. Secondary reading of Weinstein's 1988 book.
- Rawson, M. "Stan Weinstein's Stage System 1 – Charts and Buying", 7 Circles, 2017-03-23 (updated 2020-06-18).
  https://the7circles.uk/stan-weinsteins-stage-system-1-charts-buying/. No trendline rule found.

**UCT (unchartedterritoryy.substack.com; post list from https://unchartedterritoryy.substack.com/sitemap.xml, 103 posts
saved and searched)**
- Sunday Scans: sunday-scans (2025-06-08), -4d1 (2025-09-01), -88a (2025-09-21), -d6a (2025-11-16), -56d (2025-11-23,
  added in checking), -422 (2025-11-30), -f2f (2025-12-14), -34b (2025-12-21), -249 (2025-12-28), -0b3 (2026-01-11),
  -29e (2026-02-08), -dcf (2026-03-08), -cab (2026-03-22, added in checking), -6d8 (2026-05-31), -e95 (2026-06-14,
  searched; nothing quoted; it holds the "3%" intro that `sizing_rule.md` quotes), -dec (2026-07-05), -898 (2026-07-12),
  -bc2 (2026-09-20), -70f (2026-11-08, for the section title).
- The Rest of the Week: the-rest-of-the-week (2025-10-01), -208 (2025-10-08), -9c9 (2025-11-05), -22a (2025-11-26), -b3f
  (2025-12-10), -305 (2026-01-14), -732 (2026-02-04). Page dates are UTC; each went out the evening before, US time.
- "The Parabolic Short" (Bracco): checked, no trendline content.
- Reliability: UCT's own writers; what they wrote, not rulings, except the owner's own section.

**House material (this repo unless marked)**
- `api/services/pattern_engine/detectors/uct/uct_trendline_break.py`; `uct_setups_common.py`;
  `api/services/pattern_engine/primitives/liquidity.py`; `api/services/pattern_engine/detectors/registry.py`;
  `api/services/setup_tags.py`; `api/services/pattern_engine/tag_textbook.py`; `api/services/pattern_engine/sr_levels.py`;
  `api/services/measured_edge.py`; `docs/feature_flags.json`; `docs/patterns/JUDGED_GATE.md`.
- `app/src/pages/modelbook/setupCatalog.js`; `app/src/constants/setupGroups.js`; `docs/study/TRADE_PLANS.md`;
  `docs/study/sizing_rule.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl`; `docs/curriculum/uct_method_chapters.json`;
  `docs/study/UNITS-method.md`; `docs/study/courses/V/V.02.json`.
- `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json`, `brain_kb_rules_2026-11-06.json`
  (summaries of the team's archive; paraphrase, not quotes).
- `docs/agent/knowledge/N15-UNRESOLVED-SETUP-IDS.md`; `tests/golden_judged/fixtures_labels/setup_tags.json.gz` (the 23
  judged charts used in 4.7).
- Material from the private sibling repos was read for context only and is not cited here (public repo rule in
  `CLAUDE.md`).

**Looked for, not read**
- IBD articles behind the paywall (titles as the writer found them; the articles were not opened and the exact titles
  were not re-checked): "How To Draw Trendlines And Find Lower Buy Points In
  Stock Charts"; "Why A Trend Line Drawn Across Handle May Pinpoint An Early Buy Point"; "Trend Line Offers Aggressive
  Investors Lower Entry"; "Sell Rules: Growth Stocks Break Uptrend Line"; "Carefully Drawn Trend Line Can Help You
  Decide Right Time To Sell A Winner". Not read; nothing from them is used.
- TraderLion "Trendlines for Trade Management" (https://traderlion.com/?p=418903): 403, no archive copy; title not
  re-checked.
- Dan Zanger's rules (chartpattern.com, login); Tom DeMark's book; Al Brooks's books (O'Reilly excerpt, HTTP 403); Oliver
  Kell's book; Stan Weinstein's book; Investopedia (402); Stockbee (nothing found).

---

## Removed in checking (2026-11-09)

Each item below was in the dossier and could not be confirmed at its source, so it was taken out. Nothing here may be
quoted or used until someone reads the source.

1. **Three IBD sentences** (Gessel, 2025-05-28), seen only as search-result excerpts and paraphrased here so their
   wording is not reused: trendline entries work best in stocks already forming proper bases; the line needs at least
   three points, often starting at the base's left-side high; a cross above the line on volume is the buy signal. The
   readable Yahoo copy stops after the article's first two sentences; the inkl copy answers HTTP 403; investors.com is
   paywalled. Removed with them: the IBD entries they fed in the comparison table (inside a base,
   left-side high, 3 touches, "with volume"), the IBD citations in 3.14 items 3 and 5, and the IBD basis for the
   left-side high in 8.1 item 4.
2. **Al Brooks's method summary** (a trendline break followed by a test of the extreme starts a reversal): given without
   a source; his books could not be opened.
3. **"The lines were drawn by Bulkowski by hand"** (4.1): the page does not say how the lines were found.

**Corrected in checking (kept, but changed):** the measure rule's window (3.6); the 56% vs 47% "range", which is the
price trend before the line, not the line's slope (3.13, 4.1); two up-sloping quotes that belong to a long trade test,
not to the break (4.2); the "false moves" quote is Edwards and Magee's chapter 9 on Rectangles and Triangles (3.1);
Murphy's "sometimes" (3.2); `sizing_rule.md` does not quote the TSDR section (6); the `trendline_break` id is a team
playbook row, not proven to be the owner's own trade ledger (2, 5.3, 10); Sperandeo's point 2 is the retest after the
break, so the structural stop sits under point A / point 1 (8.3); B26 does not require a falling 200-day for shorts
(8.6); Kell's pages do not say "intraday" (3.9); Brandt's copy of the 3% rule omits "also" (3.1); Bulkowski's table
entries for log scale and entry (3.13); page titles (the Insider uses a dash, Qullamaggie's headline, Bulkowski's
down-sloping heading); and four phrases that sat in quote marks without being the source's exact words (Brandt's
price target, Murphy's 45 degrees, CMT's "should never be forced", IBD's headline).

**Added in checking:** Edwards and Magee's own warning that their trendline tests were written for uptrends, and what
they say about down lines (3.1); their volume-confirms line (3.1); Murphy on closes beating intraday pokes, on the cost
of a filter, and on a broken down line becoming support (3.2); the CMT tutorial's Type 1 / Type 2 lines (3.5, 3.14);
Bulkowski's long-trade test on rising lines (4.2) and his flag note (4.4); a realistic-entry stop check on the 23
judged charts (4.7, 8.2); the owner's APPN post, Bracco on mean-reversion turns, and TINY TRADES' LOAR (6); the verdict
log's rule that examples must work after the trigger, and the UTC date note (6, 10).

## 12. Examples (from our data)

**The scan's rule (daily bars, 2000-01-03 to 2026-11-04, the 2,630 names that ever met the house liquidity rule, all
scanned).** A falling line on a log chart over the daily highs of a pullback: anchor 1 is the pullback's highest high
(a swing high that no later high exceeds before the break); anchor 2 is the later swing high, at least 5 sessions on,
that gives the steepest line still clearing every high in between (so no close, and no wick, crosses the line before
the trigger: a first, clean break). Span 15 to 120 sessions; slope no steeper than 0.15 ATR a session; the lowest low
under the line no more than 35% below anchor 1; at least 2 swing highs within 0.25 ATR of the line; the 5 closes before
the trigger within 5% under the line with a smaller average range than the prior 20 sessions. The trigger day trades
above the line's value for that day AND the prior day's high, closes above the line, in the upper half of its range,
above the 10- and 21-day EMAs, above a 200-day SMA that is higher than 20 sessions earlier, on at least 1.2 times the
50-day average volume, not more than 10% above the 10-day average (C29), $10 or more with $20 million a day traded
(B23), no earnings report in the next 3 sessions (B22). Entry is a market order at the higher of the line and the
prior day's high (the open on a gap), within 4% or 1.5 ATR of the line (C28); the stop is 5 cents under the trigger
day's low (A3), stops over 5% skipped; one trigger per name per 20 sessions. RS rating (C31) and the market reading
(F65) are NOT in the scan: the sandbox has no RS data, so section 8.1 item 2 is unchecked here.

**Base rate (fixed stop, no trims, no breakeven, 60-session window).** 9,961 triggers; 54.2% reached 3R and 41.5%
reached 5R before the stop; 78.8% were eventually stopped inside the window (the fixed stop never moves, so most
winners are stopped later too); median best excursion 3.6R. Caveats: (1) the stop is tiny (median 1.17% of the entry),
so 3R is often a 3 to 4% move; the 4,171 triggers with a stop under 1% reached 3R 67.7% of the time and the 5,790
with a stop of 1% or more only 44.4% (5R: 30.2%), which is the more honest figure for a member who buys during the
day; (2) 2,306 of the triggers were gap opens above the trigger (allowed by the 4% limit) and those read 70% to 3R,
again helped by tiny stops; (3) splits: lines with 3 or more touches (4,507) did 54.6% / 42.3% versus 53.8% / 40.8% for
2 touches; slope 0.10 ATR or less 53.7% / 41.0% versus 56.4% / 43.9% for steeper; volume 1.5x or more 57.2% / 44.8%;
spans of 40 sessions or more 53.5% / 40.5% versus 54.7% / 42.3% for shorter; so in this data the extra "quality"
filters in 8.1 (touches, slope, span) add little to the hit rate, while volume and a wider honest stop matter more.
Prices below are split-adjusted as the sandbox holds them.

Scratch work: `C:/Users/pgosz/uct-worktrees/_study-resume/scratchpad/setups/09-trendline-break/` (tl_scan.py, tl_chart.py,
final/hits.json, final/examples.json, the 10 charts and the three one-column sheets sheet_1-4.png, sheet_5-7.png,
sheet_8-10.png in final/). Every chart was looked at; rejected on sight: flat (slope 0.00) lines that are really a
horizontal resistance break (CAT 2006-01-06, HRI 2012-11-28, EPC 2011-07-15), short 21 to 35 session lines (NFLX
2017-12-28, BX 2017-12-21, FRT 2015-03-16, SITE 2026-01-05), and SOHU 2014-02-27 (a textbook break that ran to 16R and
then collapsed inside the chart window, confusing for a learner).

| # | Ticker | Trigger day | Line: touches / span / slope (ATR per day) / depth | Anchor-1 high | Line at trigger | Buy | Stop (%) | Volume | Best R (sessions to 3R) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | COST | 2001-05-31 | 6 / 69 / 0.066 / 25% | 44.25 | 37.97 | 37.98 | 36.70 (3.4%) | 2.8x | 5.3R (12) | Long falling line after a 25% pullback, break back over the 200-day and the 50-day in one day on 2.8x volume; the widest stop of the ten (only COST and HLF are over 3%) |
| 2 | BDX | 2003-11-21 | 5 / 120 / 0.028 / 16% | 31.29 | 29.39 | 29.40 | 28.99 (1.4%) | 1.9x | 21.8R (2) | The longest line allowed (120 sessions), five touches, a tight drift under the line into the break, then a steady trend up the 10-day |
| 3 | NUE | 2006-10-05 | 8 / 106 / 0.044 / 26% | 60.30 | 50.47 | 50.48 | 49.20 (2.5%) | 1.8x | 13.3R (6) | Eight touches over five months: the clearest line of the set; the break came off a higher low above the 200-day and the stock never looked back |
| 4 | HLF | 2008-02-19 | 6 / 87 / 0.052 / 23% | 11.44 | 10.25 | 10.26 | 9.91 (3.4%) | 2.3x | 7.2R (11) | A clean six-touch line broken on 2.3x volume while the general market was weak (early 2008); passes the $10 rule only in split-adjusted prices, so a note for the owner |
| 5 | MSFT | 2012-01-04 | 6 / 112 / 0.024 / 16% | 28.15 | 26.89 | 26.97 | 26.73 (0.9%) | 1.6x | 24.9R (1) | A mega-cap drifting tightly under a five-month line; 3R came the next day; shows how small the honest stop can be when the break is bought during the day |
| 6 | BHC | 2013-12-16 | 4 / 39 / 0.070 / 11% | 115.40 | 109.22 | 109.23 | 106.79 (2.2%) | 1.9x | 18.0R (9) | A shorter (39 session) line in a leader riding its 50-day; shallow 11% pullback, the break over the line and the prior day's high together, then a 30% run |
| 7 | NEM | 2019-12-03 | 4 / 67 / 0.049 / 12% | 41.23 | 39.25 | 39.26 | 38.84 (1.1%) | 1.6x | 28.8R (6) | The line breaks the same day price reclaims the 50-day; a quiet, shallow 12% pullback above a rising 200-day (gold leader of the time) |
| 8 | COR | 2022-10-21 | 4 / 46 / 0.052 / 12% | 153.35 | 144.70 | 144.71 | 142.42 (1.6%) | 1.6x | 13.1R (2) | A bear-market (2022) example: the stock had held its rising 200-day while the market fell, four touches, and the break came with the 50-day reclaim |
| 9 | EHC | 2024-01-05 | 5 / 87 / 0.047 / 20% | 71.83 | 67.68 | 67.69 | 66.82 (1.3%) | 1.7x | 18.4R (6) | A 20% pullback that bottomed in a V, then eight weeks of higher lows rising UNDER the line before the break; a good "patience" chart |
| 10 | MCK | 2025-02-25 | 5 / 61 / 0.024 / 12% | 632.59 | 609.83 | 609.84 | 601.40 (1.4%) | 1.7x | 14.4R (3) | A high-priced leader: a shallow, slow line (0.024 ATR a day) with five touches; the break ran straight to new highs; shows the R maths does not care about the share price |

Eight of the ten were never stopped inside the 60-session window; COST and HLF were, after reaching 5R and 7R, which is
what a fixed stop without trims does and why the house trims a third at 3R and 5R and trails the rest.

**Notable failures (from the same scan; charts in the scratch folder's fails/).**
- LBTYA 2014-09-19: the best-looking line of the failures, 8 touches over 83 sessions, slope 0.022, but the break came
  on only 1.25x volume and closed just 0.39% above the line; the next day closed back under it and the stop (1.35%)
  traded on day 4. Lesson: a weak-volume break that barely clears the line is Murphy's "intraday penetration" dressed
  as a close.
- TMUS 2014-03-21: 6 touches over 51 sessions, closed a full 2% above the line, then three flat closes and a drop
  through the 0.9% stop on day 4 without ever making a higher high. Lesson: no follow-through within 3 sessions is
  itself the signal; the time stop (C33) exists for this.
- IFF 2020-08-10: 5 touches, 62 sessions, slope 0.077, a 1.4% close over the line on 1.36x volume; one more up day,
  then a reversal to the stop (1.7%) on day 2 and a further 4% slide. Lesson: the overhead supply at anchor 1 and the
  50-day just above the break are the places a learner should expect a fight (8.8 item 10).

What this section cannot settle: RS 80+ and the market reading were not tested; the scan uses the close-above-the-line
version of the trigger (the dossier's "alternative" in 8.2) to pick textbook days, with the entry priced at the
intraday trigger, so the base rate counts only days that also closed above the line, and the real intraday trigger
would add false starts that never closed above it (section 8.2's trade-off).

## 13. Failures and near-misses (from our data)

The same scan and the same trade as section 12 (the entry at the higher of the line and the prior day's high, stop
5 cents under the trigger day's low, 60 sessions forward, fixed stop). Four valid breaks that stopped before 3R, one
per ticker, four different years, and four breaks that look like the setup but fail exactly one gate criterion of the
card (`criteria/09-trendline-break.json`). Charts: `scratchpad/setups/09-trendline-break/final/fail_1-4.png`,
`near_1-4.png`, and the confusable pair against the Bull Flag in `pair_02-bull-flag.png`. Code: `near_scan.py` (the
scan with each gate relaxed to a band just outside the rule, keeping the breaks that fail one gate only; it covered
2,126 of the 2,630 liquid names before its 540-second budget ran out, enough to pick examples from, not a base rate)
and `fail_near.py`.

One correction to section 12: the IFF 2020-08-10 failure named there has an earnings reaction day on 2020-08-11, the
session after the entry (the report came after the close on the 10th). By the card it is a tl.earnings_window
violation, not a valid break that failed, so it is not used here. TMUS 2014-03-21 is valid but shares its year with
LBTYA, so the table below takes LBTYA.

**Failures: valid by every gate, stopped by the rules.**

| ticker | trigger day | buy | stop (%) | where it stopped | what happened | criterion |
|---|---|---|---|---|---|---|
| LBTYA | 2014-09-19 | 18.79 | 18.53 (1.35%) | day 1, 2014-09-22, low 18.39 | the best-looking line of the four (8 touches over 83 sessions, slope 0.022 ATR a session), but the break came on 1.25x volume and closed 0.39% over the line (18.85 against 18.78); the next day closed back under it at 18.58 and the stop traded. Low within 10 sessions 17.88. | tl.volume |
| EL | 2018-12-03 | 145.75 | 144.17 (1.08%) | day 1, 2018-12-04, low 144.06 | 4 touches over 110 sessions; a +7.0% trigger bar on 2.33x volume closing 4.74% over the line, with the entry at the line and the stop under the bar's low. The next session opened at 152.00 and fell to 144.06; low within 10 sessions 129.67. One bar was the whole break. | tl.stop_broker (the stop is the exit) |
| SCHW | 2020-02-20 | 48.12 | 47.25 (1.80%) | day 1, 2020-02-21, low 45.93 | 3 touches over 46 sessions, a clean break on 1.81x volume closing 0.98% over the line; the next session was the first day of the February 2020 market break and the stock fell to 34.45 within 10 sessions. | tl.market_reading |
| DHR | 2021-01-05 | 200.06 | 197.41 (1.33%) | day 1, 2021-01-06, low 197.22 | 3 touches over 33 sessions, closed 2.03% over the line on 1.44x volume; the next session's low was 19 cents under the stop and the close 209.53 (6% over the stop); the stock reached 217 within a week without us. The trigger-day stop sat inside the noise; the structural stop under the low under the line would have held. | tl.stop_structure (pending the owner) |

**Near-misses: one gate fails, everything else passes.**

| ticker | trigger day | the one criterion that fails | the number | what it really is |
|---|---|---|---|---|
| GOOGL | 2025-06-06 | tl.volume | 0.86x the 50-day average volume; the rule is 1.2x or more | a clean line (3 touches, 85 sessions) traded through on a quiet day: a watch, not a buy. It stopped, then the real move came later |
| DIS | 2021-06-14 | tl.slope | the line falls 0.198 ATR a session; the rule is 0.15 or less | a steep three-week drop with two lower highs; a drop, not the tight drift down the setup wants. Stopped the next session |
| AMGN | 2005-11-03 | tl.line_age | the trigger day is 11 sessions after the first anchor; the rule needs 15 or more | three highs in two weeks: too young a line to mean anything. It went to 7.2R, which is the stock's trend, not the line's |
| CAT | 2021-10-28 | tl.above_200 | the trigger day closes 4.9% under the 200-day SMA; the rule needs a close above it | a good-looking line (4 touches, 102 sessions, 1.32x volume) under a flat 200-day: bottom fishing (tl.bottom_fishing), not this setup |

**What the failures have in common.** All four stopped on the first session after the entry, and none ever traded
above the trigger day's high before the stop (best R 0.0 in every case). The stops were tiny, 1.1% to 1.8%, which is
the setup's habit (median 1.17% in section 12) and its weakness: a stop under the trigger day's low sits inside one
normal day's range, so a flat day (LBTYA), a reversal bar (EL), a market break (SCHW) or a 19-cent dip (DHR) all end
the trade. Two of the four (DHR within a week, EL two months later) went on to the move the line promised. The lines
themselves were fine; what failed was volume on the break (LBTYA), the market (SCHW), and the size of the stop (EL,
DHR). That is why the card leaves tl.stop_structure to the owner, and why section 12's cut shows the under-1% stops
reaching 3R more often only because 3R is then a 3% move.
