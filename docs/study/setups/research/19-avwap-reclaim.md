# Setup 19: Anchored VWAP reclaim (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
transcript or repo file named next to it and kept to 40 words or fewer. Spelling and typos inside quotes are the
source's own. Nothing here is a ruling. Where I could not read a source, I say so and give no wording from it.

Tags used in section 8: **[source consensus]** at least two outside sources agree; **[originator]** Brian Shannon's own
words (his site, his podcast transcript, his 2017 slides) or the MIDAS school that invented the tool; **[UCT]** UCT's own
writers, the owner's recorded rulings or UCT's own code (said which); **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

**Scope note.** The session's web-search allowance ran out partway through this research. Everything quoted here was
read in full. Sources I meant to check but could not reach are listed in section 11 under "Not read". I found no AVWAP
material from IBD/MarketSmith or Bulkowski, but I could not search those sites properly, so "none found" there means
not searched, not that it does not exist. (TraderLion: see the checker's note in section 11.)

**Cold check, 2026-11-09.** A second reader re-opened every source named here, re-read every quote against the page
(all Substack quotes against the posts fetched through Substack's public post API; Shannon's pages, the CMT transcript,
ChartSchool, TradingView, TrendSpider, Trade Ideas, Wikipedia and Barnes & Noble directly) and re-read the scanner and
drawing code. Every quote in this file is on its page word for word. Fixes made in checking are marked
"*(checked: ...)*" where they change a claim; two Shannon originator sources the first draft missed (his 2017 CMT slide
deck and his 2017 "How To Use The Anchored VWAP" post) are added in 3.1b and 3.1c; anything removed is listed under
"Removed in checking" at the end.

**The short version.**
- **What it is.** A stock that has been closing *under* the volume-weighted average price measured from a meaningful
  event (a big high, an earnings gap, the IPO day) closes back *over* it. The average buyer since that event has gone
  from losing to winning, so control has changed hands. Shannon's own words for it: "the buyers had regained control
  as the price surged above the flat AVWAP." (That worked example on his AVWAP page is anchored to a **December low**;
  his 2017 CMT slides show the same thing from a high: "Once the VWAP from the prior peak was breached, buyers were in
  control again." See 3.1 and 3.1b.)
- **Who owns it.** The anchored VWAP was invented by the physicist Paul Levine (MIDAS, 1995 to 1997) and popularised by
  Brian Shannon, CMT, who calls himself "the adopted father of it". Shannon's book is *Maximum Trading Gains With
  Anchored VWAP* (Alphatrends Publishing, 2023), **not Wiley** as our scanner says.
- **No one publishes a fixed "AVWAP reclaim" rule set.** Shannon treats every AVWAP as a place to look for evidence,
  "not a mechanical signal". His tagline is "Don't Buy the Dip, Buy Strength After the Dip". The daily alerts his
  Trade Ideas partner channel names are the "AVWAP pinch" and the "Pullback to AVWAP", not a reclaim. The nearest thing
  to a rule from him is in his 2017 slides: "A move above a DECLINING VWAP will often fail" and "The steeper the angle
  of VWAP, the greater the likelihood of a move above or below to fail." (3.1b)
- **UCT.** Anchored VWAPs appear in 32 of the 103 Substack posts in the sitemap (55 times: 22 in the owner's sections,
  21 in Bracco's). UCT uses them as **levels and confluence** (earnings, IPO, all-time-high, swing-low and
  Fed/follow-through anchors), and the owner uses the **intraday** VWAP undercut-and-remount as an entry tactic. No UCT
  text defines a daily AVWAP reclaim as its own setup. There is no Model Book card and no journal tag for it. The owner
  has never ruled on a reclaim. *(checked: his one AVWAP ruling is not in the verdict log but in
  `docs/study/RESUME.md`, 2026-10-25: on High Volume Edge charts, "slap a horizontal ray on the close of the HVC candle
  and also put an AVWAP on it from the HVC candle day." That is an AVWAP as a level, built into
  `app/src/pages/study/hveOverlay.js`.)*
- **The app has two different rules.** The member drawing (`setup_draw_r3.py`, blind-judged) is a strict, Shannon-like
  first clean reclaim of the AVWAP from the 150-day high. The scanner (`avwap_reclaim.py`) is loose, mislabels its
  anchors, and its text claims things about Shannon I could not find anywhere (a 60-65% continuation rate, a
  "kiss-goodbye" pattern, a 0.5 ATR "anti-whipsaw" stop, an R:R 2.0 threshold). Treat those as invented.
- **Measured evidence: none.** I found no published, method-described statistic for AVWAP reclaims. The app's own
  outcome memory had zero resolved AVWAP reclaims as of 2026-08-23.
- **Biggest house conflict: B26.** A reclaim of the AVWAP from a big high can easily happen under the 200-day after a
  deep fall (reasoning; not measured). Those are not our longs. Our version is the pullback or base inside an uptrend,
  above the 200-day.

---

## 1. What it is

**In two sentences.** The anchored VWAP (AVWAP) is the average price paid, weighted by volume, by everyone who traded a
stock since a chosen event; an AVWAP reclaim is the first decisive close back above that line after the stock spent a
stretch of time below it. It marks the moment the average holder since the event goes from a loss to a profit, which
Shannon reads as buyers taking back control.

**The psychology (from the sources; reasoning, not measured fact).**
- **The line is everyone's average cost since the event.** Shannon: "If it’s above, well, we know that the average
  buyer is feeling good, the average short is feeling bad." (CMT Association, Fill the Gap ep. 61, 2026-02-27.)
- **Under a falling AVWAP from a high, the holders since the high are trapped.** They sell into rallies near their
  breakeven, so the line acts as a ceiling. Shannon: "Are rallies up going to get rejected at that anchor from the
  high?" He describes institutions with large positions selling in small pieces when price rallies up to it (same
  transcript). His 2017 post gives the general reason, written about broken horizontal support: "When price breaks a
  major level of support, the “trapped longs” will have a propensity to look to get out at “breakeven” the supply from
  these participants helps to form resistance." (alphatrends.net, "How To Use The Anchored VWAP (AVWAP)", 2017-12-18.)
- **The reclaim means that supply has been absorbed.** Shannon, on his own site: "The AVWAP tells me whether the
  average participant from a prior high is winning or losing. When they move back into a winning position, buyers are
  in control, and that’s when I get interested." (alphatrends.net, "Don't Buy the Dip, Buy Strength After the Dip".)
- **Who is trapped after the reclaim.** Shorts who sold under the line and anyone who sold at breakeven on the way up.
  Shannon's "the average short is feeling bad" is the short side of the same arithmetic.
- **Why big money cares about VWAP at all.** VWAP began as the yardstick for how well a broker filled an institution's
  order. Shannon explains that after an earnings gap an institution building a position will try to buy "as close to
  VWAP from that event as possible because that was the catalyst." (Fill the Gap ep. 61.)
- **Why it is not magic.** Shannon calls an AVWAP, a moving average or a prior support band "levels of interest, not a
  place to do business." The edge is in the evidence of control changing, not in the line itself.

---

## 2. Origin and naming

**VWAP, the benchmark (1988).** Shannon's own page: "The VWAP was first introduced to the trading community in the
March 1988 Journal of Finance article, “The Total Cost of Transactions on the NYSE” by Stephen Berkowitz, Dennis Logue,
Eugene Noser Jr." (https://alphatrends.net/anchored-vwap/). I did not read the paper itself (the publisher's page
returned an access error). In the podcast Shannon gives 1984 once and 1988 later; his written page says 1988.

**Anchoring, the MIDAS school (1995 to 1997).** TradingView's help page: "The anchored VWAP tool was developed by the late
physicist and technical analyst, Paul Levine, while working on the Market Interpretation/Data Analysis system (MIDAS)
between the years 1995 and 1997." It adds: "Levine developed the methodology of professional trader, Kevin Haggerty,
who used volume-weighted average price curves to determine the direction of a position in the 80s."
(https://www.tradingview.com/support/solutions/43000669764/). Wikipedia's MIDAS article says the approach was
"initiated in 1995" and that Levine's lectures were first published on the *Windows on Wall Street* website; a footnote
there dates his death to 2001. MIDAS was extended by Andrew Coles, PhD, and David Hawkins in *Technical Analysis of
Stocks & Commodities* articles (2008 to 2010) and the book *MIDAS Technical Analysis: A VWAP Approach to Trading and
Investing in Today's Markets* (2011; Wikipedia cites John Wiley & Sons, Hoboken, ISBN 978-1-57660-372-7; Open
Library's record for that ISBN lists "Wiley", "Bloomberg Press" and "John Wiley & Sons"). I did not read the book.
*(checked: "catalogs list Bloomberg Press" narrowed to the one catalog actually read.)* A guess, not a finding: this
Wiley book may be where our scanner's "Wiley" came from.

**Popularised by Brian Shannon, CMT.** In his own words: "I am the adopted father of it, but the actual founding goes to
Dr. Paul Levine." And: "And then it wasn’t probably till about ’96, I believe, when Paul Levine brought it as an
anchor." (Fill the Gap ep. 61, transcript, https://cmtassociation.org/podcast/fill-the-gap-episode-sixty-one-anchored-vwap-legend-brian-shannon-cmt/.)
Shannon founded Alphatrends in 2006 and earned the CMT in 2013 (Wikipedia; it cites the founding year to a 2011
interview, a 2005 SFO Magazine article and Barron's of 2006-10-23, and the CMT year to his own 2013 tweet).
His books: *Technical Analysis Using Multiple Timeframes* (LifeVest Publishing, 2008) and *Maximum Trading Gains With
Anchored VWAP: The Perfect Combination of Price, Time & Volume* (Alphatrends Publishing LLC; Barnes & Noble lists the
e-book as 2023-01-20; Wikipedia gives AlphaTrends.Net Publishing LLC, 2023-01-01, ISBN 979-8986868004). I did not read
the book; I read only his public pages, his podcast transcript and partner pages that describe it.

**Other names.**
- The tool: Anchored VWAP, AVWAP, "Alphatrends Anchored VWAP" (TrendSpider's indicator name), MIDAS support and
  resistance curves (Levine's original, computed slightly differently).
- The event: "reclaim", "regained control" (Shannon's page), "Reclaimed key levels" (Shannon's buy-strength page),
  "remount" (UCT's word: "Remounted the AVWAPs from swing low and from ATHs"), "getting above the IPO AVWAP" (the owner),
  "crossing the AVWAP" (a UCT contributor).
- Close relatives, not the same setup: the **AVWAP pinch** (price squeezed between two AVWAPs) and the **Pullback to
  AVWAP** (the two daily alerts Trade Ideas' Alphatrends add-on names; it also scans IPO setups); the **undercut and
  rally at an AVWAP** (Bracco's BTC note, section 6); the intraday **VWAP undercut and rally** (the owner's entry
  tactic, section 6).

---

## 3. Every definition I could find, source by source

### 3.1 Brian Shannon, "Anchored VWAP" page on alphatrends.net (originator; signed "By Brian Shannon")
URL: https://alphatrends.net/anchored-vwap/ (read 2026-11-09).
- **Who is in control.** "When a stock is above an advancing AVWAP, buyers are in control for that timeframe, as the
  average price is increasing." And: "When prices are below a declining AVWAP, sellers are in control because the
  average price is declining."
- **Indecision.** "When prices oscillate above and below the AVWAP it indicates indecision for that timeframe."
- **The reclaim itself, described on a daily chart.** "As the AVWAP became a battlefield in October (4), the buyers were
  slowly regaining control as the AVWAP flattened out. At (5) the buyers had regained control as the price surged above
  the flat AVWAP." This is the closest any originator text comes to defining the setup: a falling line that flattens,
  then a surge above it. *(checked: the line in this example is the **AVWAP from the December low**. The caption just
  before it says the sellers took control "after the AVWAP from the December low was broken". So Shannon's own worked
  reclaim is of an AVWAP anchored to a low that price later fell far under, not to a high.)*
- **The checklist he asks** (listed in his intraday section, under "The first things we want to be aware of
  include:"). "What is the direction of AVWAP?", "What is the slope of the AVWAP?", "Has price crossed above or below
  AVWAP?" and "Does price break AVWAP support, which then turns to resistance, or vice versa?"
- **Trend bias.** "When prices are above a rising AVWAP the trend is “innocent until proven guilty”." (The page pairs it
  with "guilty until proven innocent" for prices under a declining AVWAP.)
- **Anchor.** In the Q&A: meaningful pivots, "major highs/lows, big news, or strong reversals".
- **Not a signal.** The Q&A calls the AVWAP "a place to look for evidence, not a mechanical signal."
- **When the line breaks.** "Don’t hold and hope."
- **Volume.** "Volume is the fuel that causes the price to change." No volume number is given for a reclaim.
- **Accuracy.** "Always use as short a timeframe as possible to get the most accurate measure of VWAP/AVWAP." (Our app
  computes it from daily bars; see section 5.)
- **Not given:** prior trend, length under the line, depth, a trigger price, a stop, a target.

### 3.1b Brian Shannon, "Anchored VWAP: The Perfect Combination of Price, Volume & Time" (originator; slides, 2017-09-27)
*(added in checking.)* URL: https://cmtassociation.org/wp-content/uploads/2017/09/0927-shannon.pdf (30 slides, title
slide "Brian Shannon, CMT", dated 9/27/17; the deck for the CMT Association webcast listed in section 11). Slide text,
read 2026-11-09:
- **Direction decides whether a cross holds.** "A move above a DECLINING VWAP will often fail" and "The steeper the
  angle of VWAP, the greater the likelihood of a move above or below to fail." His "Dominant Moving Average (VWAP)"
  slide: "Rallies with a declining VWAP are treated as bounces which are likely to fail". This is the originator's
  basis for wanting the line to have **flattened** before a reclaim (8.1 rule 11). No angle or number is given.
- **One or two closes are not the point.** "Be more aware of the direction of the VWAP than whether it closes above or
  below it for a session or two". This weighs against treating a single close back under the line as an exit (section
  10, question 6), and against a one-close trigger with no regard to slope.
- **Repeated tests.** "Like any support or resistance level, the more times they are tested, the more likely they are
  to fail". (A slide is titled "The More Times The VWAP is Tested, The More Likely it is to Fail".)
- **The reclaim from a high, in a worked case (the Nasdaq Biotech ETF, IBB).** "After breaking the YTD VWAP, buyers
  regained control at the VWAP from the election", then "Once the VWAP from the prior peak was breached, buyers were in
  control again", then "New momentum should come into the Biotech's once they clear the VWAP from the September high".
  Spelling as printed.
- **The IPO anchor.** "VWAP allows us to see control shift from Sellers to buyers in a fresh IPO" and, on BABA from its
  IPO, "VWAP allows a clear view of where buyers regained and maintained control of the trend".
- **Anchors he lists.** "Breakouts/ Breakdowns", "Open of trading Day", "Federal Reserve Announcements", "Earnings",
  "FDA Reports", "Year to Date", "Where short sellers will feel pain", "Gaps".
- **Not given:** a trigger price, a stop, a target, a volume number, a statistic. "Will often fail" is a judgment, not
  a measured rate.

### 3.1c Brian Shannon, "How To Use The Anchored VWAP (AVWAP)" (originator; alphatrends.net, 2017-12-18)
*(added in checking.)* URL: https://alphatrends.net/archives/2017/12/use-anchored-vwap-avwap/ (signed "By Brian Shannon,
CMT", read 2026-11-09).
- **What an anchor event is.** "I consider a significant event to be any date from which price movement began or
  reversed." His list: "earnings dates, week to date, month to date, year to date, FDA announcements, Fed announcements
  or just simple swing highs and lows."
- **Winning or losing since the event.** "If prices remain above the VWAP from the election, the average participant
  from that date is assumed to be in a winning position from that point."
- **A gap over a cluster of AVWAPs from highs counts as control changing.** On about a month of SPY trading: "The gap
  above these AVWAPs put buyers back in control and now that cluster of AVWAPs will likely become support on
  pullbacks." This bears on the app drawing's rule that a reclaim may not gap over the line (5.2): that rule is UCT's
  design choice, not Shannon's.
- **Older lines move less.** "Notice that the longer the anchor point is on the chart, the less sensitive to current
  price action it will become."

### 3.2 Brian Shannon, "Don't Buy the Dip, Buy Strength After the Dip™" (originator)
URL: https://alphatrends.net/dont-buy-the-dip-buy-strength-after-the-dip/ (read 2026-11-09).
- **The question he asks.** "Instead of “how low can I buy,” I ask “has price proven that buyers are back in control.”"
- **His three signals:** "Higher highs and higher lows", "Reclaimed key levels", "Anchored VWAP from key pivots".
- **The anchor that defines the reclaim.** "The AVWAP tells me whether the average participant from a prior high is
  winning or losing. When they move back into a winning position, buyers are in control, and that’s when I get
  interested." So the reclaim he means **on this page** is of the AVWAP **from a prior high**. *(checked: his AVWAP
  page's worked example is anchored to a low (3.1), and his 2017 slides show a prior-peak reclaim beside the election
  AVWAP acting as support (3.1b); "from a prior high" is one of his anchors, not his only one.)*
- **Cost of waiting, accepted.** "I would rather miss a bounce than get trapped in a downtrend with my capital tied up
  and my losses growing."

### 3.3 Brian Shannon, CMT Association "Fill the Gap" episode 61 (originator; published transcript, 2026-02-27; the page says "Recorded February 4, 2026")
URL: https://cmtassociation.org/podcast/fill-the-gap-episode-sixty-one-anchored-vwap-legend-brian-shannon-cmt/ (read
2026-11-09). The transcript has transcription errors ("anchor view app" for "anchored VWAP"); quotes are as printed.
- **Anchors.** Time-based (day, week, month, year to date), event-based ("So time-based, event-based, so earnings
  reports, from that earnings report where the stock gapped up, you might see three or four days of choppy action
  around it."), IPOs, Fed and FDA days, and "price-based, so it could be, you know, the recent swing low or the
  year-to-date high".
- **The line is not the buy.** "I always call A VWAP, a moving average, a prior band of support or resistance is levels
  of interest, not a place to do business." Then: "So I say, don’t buy the dip, buy strength after."
- **Evidence on a shorter timeframe.** "look to the shorter term timeframe for actual evidence the buyers are gaining
  control. If it’s still below today’s VWAP, it’s just not a smart purchase at a perceived level of support or
  resistance."
- **Confluence.** On a level where the 50-day, a prior resistance level and "that anchor from the November flush" (an
  AVWAP from a low) met: "So it’s more likely when we have that confluence." He goes straight on to say the shorter
  timeframe showed "zero evidence the buyers are gaining control", so confluence alone was not a buy.
- **His entries.** Weekly, daily, 65, 15 and 5-minute charts, and a 1 or 2-minute chart "in the first half hour of the
  day" for precision.
- **His stops (general practice, not AVWAP-specific).** "I’m not looking at a 5% stop. I’m looking at a 1.8% stop based
  on that prior high or low. If that’s violated, that’s my stop."
- **His first trim (general practice).** "So the odds say if it hits daily R2, that it’s probably a good time to start
  thinking about hitting, taking that first third off." (R2 is a floor-trader pivot level. He cites "statistics" that a
  stock's day stays inside S2 to R2 about 86% of the time; he names no source, so I treat that number as unverified.)
  *(checked: the context is narrower than "a third at R2". It is what he does "on day one, if the stock runs quickly",
  after getting in heavy on an A-list idea, and he adds: "I take a third off, not necessarily at daily R2". It is a
  day-one momentum trim, not a fixed first target.)*
- **His trail.** "I’ll trail my stops up underneath the higher lows that occur on a 15-minute time frame, for instance,
  as long as we’re above a rising five-day moving average." Later in a trade, higher lows "above a rising 10 or 20 day
  moving average".
- **Holding period.** "And then a typical trade for me seems to be three to six days." Up to "about five to six weeks";
  in a strong trend, later in the same answer: "Maybe I can hold this one, six, eight weeks."
- **Do not chase.** On the stocks people ask him to look at: "75% of the time, it’s a stock that went 10% in the last
  three to four days." *(checked: this describes what students bring him, not a rule of his; the context was added.)*
  After a 7% rally in three or four days into a breakout he would take "maybe a half of a risk unit".
- **Relative strength.** "So relative strength charts mean nothing to me." (He is bottom-up; see section 7, C31.)
- **The short-side test.** After anchoring to a high: "Does it run into supply right there and then get rejected, make a
  lower high, and then break down to the lower low?"

### 3.4 Alphatrends partner and news pages (originator's company)
- **Trade Ideas, "Alphatrends AVWAP" add-on** (https://www.trade-ideas.com/features/ti-avwap/, undated, © 2024): the
  channel gives "real-time chart setups and alerts, including the “AVWAP pinch” or “Pullback to AVWAP” daily alerts."
  It also scans "AVWAP IPO setups just like the strategies in the book". **No reclaim setup is named.** Shannon is quoted:
  "The AVWAP represents the absolute truth of the relationship between a stock's supply and demand, and is 100%
  objective."
- **Alphatrends news post, 2026-06-08** (https://alphatrends.net/archives/podcast/brian-shannon-featured-in-discussion-on-anchored-vwap-and-market-structure/,
  written in the third person by his team): "neither tool should be viewed as a buy or sell signal on its own."
- **Alphatrends lesson "Anchored VWAP on Thinkorswim", 2025-06-06**
  (https://alphatrends.net/archives/podcast/anchored-vwap-on-thinkorswim/): "Like all tools, it works best when combined
  with structure and trend."
- **The book page** (https://alphatrends.net/anchored-vwap-book/) promises "specific, repeatable strategies for entries,
  exits, and stops" for "IPOs, breakouts, pullbacks, gaps, and short squeezes, on both the long and short side." I did
  not read those strategies; they are in the book.

### 3.5 MIDAS (Paul Levine; Coles and Hawkins), through Wikipedia (secondary; I did not read Levine's lectures or the book)
URL: https://en.wikipedia.org/wiki/MIDAS_technical_analysis (read 2026-11-09; the article carries an "Orphan" tag).
- **Anchor at a trend change.** Tenet 4: "it's essential to focus on price and volume data subsequent to a reversal in
  trend and thus to a major change in asset market sentiment."
- **The undercut problem has a name.** Two known drawbacks: "The former refers to a shallow penetration of a MIDAS curve
  by asset prices. The latter refers to a premature turning of asset prices prior to reaching a MIDAS curve." ("price
  porosity" and "price suspension"). A shallow undercut that snaps back above the curve is, in MIDAS terms, porosity: a
  known timing problem, not a signal in itself.
- **Not given:** any trade rule for a reclaim.

### 3.6 StockCharts ChartSchool, "Anchored VWAP" and "VWAP" (established educator)
URLs: https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/anchored-vwap
and .../volume-weighted-average-price-vwap (read 2026-11-09).
- **Anchor.** "This can be a significant high or low, an earnings announcement, a gap, or any point of interest."
- **What it shows.** It makes it "easy to see whether the bulls or bears have been in charge since a very specific time."
- **Confluence.** "Where multiple Anchored VWAP lines converge, that can indicate an especially strong area of support or
  resistance."
- **Caution.** "As with all technical indicators, traders should use the Anchored VWAP overlay with other indicators and
  analysis techniques."
- **Formula (the one our app uses).** "Compute the typical price for the intraday period. This is the average of the
  high, low, and close: (H+L+C)/3)". Then running totals of typical price times volume, divided by running volume.
- **Not given:** a reclaim rule, a trigger, a stop.

### 3.7 TradingView Help Center, "Anchored VWAP drawing tool" (platform documentation)
URL: https://www.tradingview.com/support/solutions/43000669764/ (read 2026-11-09). History only (quoted in section 2)
and how to draw it. No trading rule.

### 3.8 TrendSpider, "Alphatrends Anchored VWAP" help page and Learning Center (vendor educator)
URLs: https://help.trendspider.com/kb/indicators/alphatrends-anchored-vwap and
https://trendspider.com/learning-center/anchored-vwap/ (read 2026-11-09).
- **Calls a cross a signal** (help page). "For example, a trader may look for a breakout above the Anchored VWAP as a
  signal to enter a long position, or a breakdown below the Anchored VWAP as a signal to exit a short position." (This
  contradicts Shannon's "not a mechanical signal". The second half reads oddly, "exit a short", and is quoted as
  printed.) The same page: "Multiple Anchored VWAPs can also be used to confirm each other, creating stronger signals."
- **Weaknesses it lists** (Learning Center page). "Subjectivity in anchoring points: The selection of the anchor point
  for calculating the VWAP is subjective and can vary among traders." And: "Vulnerability to market manipulation: In
  markets with low liquidity or susceptible to manipulation, the accuracy of Anchored VWAP can be compromised."

### 3.9 UCT's own definitions (details and links in section 6)
- **The owner (TSDR)** uses AVWAPs as levels: from earnings ("AVWAP from earnings gap up holding"), from the IPO ("Huge
  move after getting above the IPO AVWAP"), from all-time highs, from a swing low, and (his one ruling, RESUME.md
  2026-10-25) from the High Volume Edge candle day. His clearest "reclaim"-shaped lines are AEVA (through the AVWAP
  from its June peak) and HNGE (above the IPO AVWAP); PATH, consolidating "over the previous peak and the AVWAP from
  ATHs", is a third. Intraday, he buys the VWAP undercut and remount with a low-of-day stop (TMDX: "Stop LOD. If unable
  or unwilling to try ORB at open. Look for a retest or an undercut and hold of VWAP mid morning."; and, generally, "My
  stops are always LOD until I can raise them to breakeven", 2025-06-22,
  https://unchartedterritoryy.substack.com/p/sunday-scans-0d2).
- **Bracco** uses ATH, IPO, earnings, swing-low and follow-through-day AVWAPs. Closest to a rule: "I have studied many
  charts in the past that have made big moves off of a low and support on the first pullback to a VWAP anchored to the
  low of the move." (That is a pullback-and-hold, not a reclaim.) And, as a buy condition: "Clean above the IPO
  anchored VWAP now which is big for me to get involved."

### 3.10 Comparison table

| Criterion | Shannon (site + podcast) | ChartSchool | TrendSpider | MIDAS (via Wikipedia) | App scanner `avwap_reclaim.py` | App drawing `setup_draw_r3.py` | UCT writers |
|---|---|---|---|---|---|---|---|
| Anchor | Meaningful highs/lows, earnings, IPO, Fed, time periods; on his buy-strength page the AVWAP **from a prior high**; his AVWAP page's worked reclaim is from a **December low**; his 2017 slides use a prior peak, the election and year-to-date | Significant high/low, earnings, gap, any point of interest | Any significant point; auto anchors | A trend reversal point | Deepest 5-bar low, or oldest 3% gap, or the highest high of bars 5 to 60 back (called "52w high"); all 5 to 60 bars back | The highest high of the last 150 bars, at least 20 bars old | Earnings day, IPO day, ATH, swing low, HVE/HVC day, Fed or follow-through day |
| Prior trend | Not numeric; he trades with the trend on his timeframe | Not given | Not given | Not given | None (a context score only adds points) | A fall of 4+ ATR from the anchor high | Mostly leaders in uptrends; index reads in corrections |
| Time under the line | Not given; the line is "declining" then "flattened out" | Not given | Not given | Not given | 5+ consecutive closes under, just before | 15 consecutive closes under, average 0.2+ ATR under, no high 0.25 ATR over; 7 of the last 10 under | Not given |
| Line slope | Flattening before the surge; "A move above a DECLINING VWAP will often fail" (2017 slides) | Not given | Not given | Not given | Not tested | Not tested directly | Not given |
| Trigger | Price "surged above the flat AVWAP", confirmed on a shorter timeframe | None | A "breakout above" | None | Daily close above the line | First clean close above (0.3 to 1.0 ATR above, open not 0.5 ATR over), within the last 3 bars, held since | "getting above", "through", "clean above" |
| Volume | "the fuel"; no number | Not given | Not given | Volume is in the line | 1.5x the 20-day average on the reclaim day | No volume test | Often noted ("highest volume ever") but not as a rule |
| Entry | Precise intraday entry, multiple timeframes | Not given | Not given | Not given | Close + 0.1% | Not a trade, a drawing | Intraday VWAP remount; or a shake to the line and "a show of buyers" |
| Stop | Tight, under a prior high or low (about 1.8% in his example); "Don’t hold and hope" | Not given | Not given | Not given | AVWAP minus 0.5 ATR | None | Low of day (owner: "My stops are always LOD until I can raise them to breakeven", 2025-06-22) |
| Target / trims | On day one, if it runs fast, a first third, often near daily R2 ("not necessarily at daily R2"); then trail | Not given | Not given | Not given | The 30-day high plus 0.5% | None | House trims (section 7) |
| Trail | 15-minute higher lows above a rising 5-day; later the 10 or 20-day | Not given | Not given | Not given | Narrative only | None | 10/20-day (house) |
| Relative strength | Ignores RS charts | Not given | Not given | Not given | Context score only | None | Leaders (house C31) |
| Calculation | Shortest timeframe available | Typical price × volume | Choice of price source | Modified VWAP | Daily typical price, full anchor day | Daily typical price, full anchor day | Their charting platforms |

### 3.11 Where the sources disagree, and what I recommend

1. **Is the reclaim a signal?** Shannon and his company: no, a place to look for evidence. TrendSpider: a breakout above
   can be an entry signal. Our scanner fires on the daily close. **Recommendation:** teach the reclaim as a setup with a
   *next-session confirmation* trigger (section 8.2), which is Shannon's "buy strength after" put into daily-bar terms.
2. **Which anchor?** Shannon's buy-strength page uses the AVWAP from a prior high, and his 2017 slides show a reclaim
   of the AVWAP "from the prior peak". But his AVWAP page's worked reclaim is of the AVWAP from a December low, after
   price had fallen far under it (3.1). Our scanner gives its top score to a swing low and calls it "Shannon's primary
   anchor" (line 257); I found no Shannon text that ranks anchors at all, so that label has no source. *(checked: the
   first draft said no source supports a reclaim of an AVWAP from a low; Shannon's own worked example is one, so that
   was removed.)* The drawing uses the 150-day high. In the owner's own Substack sections, earnings and IPO anchors are
   the most frequent; across all UCT writers, AVWAPs from highs/ATHs are named most often, then lows (my rough count of
   the 55 mentions in section 6; *checked: the first draft said "UCT uses earnings and IPO anchors most" without the
   split*). **Recommendation [my proposal]:** the core variant is "from the high" (as the drawing; Shannon's
   prior-high reading); earnings-day and IPO-day anchors as named variants; swing-low anchors taught first as support
   and pullback levels. That is a teaching choice for a simpler course, not a source rule: Shannon himself reads a
   reclaim from a low the same way.
3. **How long under the line?** Scanner 5 closes; drawing 15; sources silent. **Recommendation:** 15 for the "from the
   high" variant (it is what passed the blind check, and it makes the trapped-holder story real). The owner to choose
   for the earnings and IPO variants (section 10).
4. **Volume.** Scanner requires 1.5x; drawing none; Shannon gives no number. **Recommendation:** a grade marker, not a
   gate (section 9), because no source sets a number.
5. **Stop.** Scanner: AVWAP minus 0.5 ATR (no source). Shannon: tight, under a short-timeframe prior low. House: a few
   cents under the day's low. **Recommendation:** the house stop (section 8.3); the reclaim day's low normally sits at
   or under the AVWAP, so a stop-out also means the reclaim failed.
6. **Targets.** Scanner: the 30-day high. Shannon: on a fast day one, a first third, often near daily R2 ("not
   necessarily at daily R2"). House: a third at 3R, a third at 5R, trail the rest. **Recommendation:** the house rule;
   Shannon's is his own, faster style.
7. **Relative strength.** Shannon ignores RS charts; house C31 requires RS 80+. **Recommendation:** the house rule.
8. **Calculation.** Shannon wants the shortest timeframe; the app uses daily bars. **Recommendation:** keep daily bars
   for the course (they are what we can draw for every example) and say so in the lesson; the line is approximate.
9. **Reclaim after a long stay under, or a quick undercut and rally?** The drawing and Shannon's chart describe the
   first; Bracco's BTC note ("trying to stage a U&R at the 200ma, April low AVWAP") and the owner's SNOW note ("AVWAP
   from earnings got taken out Friday and can be a spot to trade tightly around"; "taken out" most likely means the
   line broke under, since the same note speaks of "undercuts and holds of the gap support") describe the second.
   **Recommendation:** teach the long-stay reclaim here; the quick undercut of a rising AVWAP belongs with U&R and Gap
   Support, where the owner already has rulings.
10. **One close, or the line's direction?** *(added in checking.)* Both app rules trigger on closes. Shannon's 2017
    slides say "Be more aware of the direction of the VWAP than whether it closes above or below it for a session or
    two" and "A move above a DECLINING VWAP will often fail". **Recommendation:** keep the close-based trigger (it is
    measurable) but require the line to have flattened (8.1 rule 11), and do not make one close back under the line an
    exit by itself (section 10, question 6).
11. **A gap over the line.** *(added in checking.)* The drawing rejects a reclaim day that opened more than 0.5 ATR over
    the line. Shannon's 2017 post reads a gap over a cluster of AVWAPs as "put buyers back in control". **Recommendation:**
    keep the drawing's rule for this lesson (a gap over the line is judged as a gap or Kicker, where the owner has
    rulings), and say in the lesson that this is our split, not Shannon's.
12. **First test or many?** *(added in checking.)* The drawing wants a first reclaim with few earlier pokes. Shannon's
    slides say "the more times they are tested, the more likely they are to fail", which, for a falling line acting as
    a ceiling, means repeated tests make an eventual break more likely, not less (my reading of a general slide). The
    two are compatible (the drawing counts earlier closes above the line and chop, not touches from below), but the
    lesson should not say that a line tested many times is a weaker reclaim.

---

## 4. Measured evidence

**Published statistics: none found.** I found no success rate, average move or failure rate for AVWAP reclaims with a
stated method from Shannon, the MIDAS authors (as summarised), ChartSchool, TradingView, TrendSpider or Trade Ideas.
Shannon's 2017 slides (3.1b) are judgments ("will often fail"), not measured rates. Web searches surfaced vendor pages
quoting win rates with no sample, period or method; I did not use them. I could not search Bulkowski's site or IBD for
this, and TraderLion's pages refused access (scope note above, section 11).

**Numbers I heard but cannot use as evidence.**
- Shannon's pivot-point figure (a stock stays inside daily S2 to R2 "86% of the time"): about daily ranges, not AVWAP,
  and he names no source.
- The CMT podcast's "right 50 to 60% of the time" line was said by the host, Dave Lundgren, not by Shannon, and is about
  trading in general.

**Our own app.**
- `api/services/screener/pattern_join.py` records that on 2026-08-23, 46 of 79 pattern stat rows, `avwap_reclaim`
  among them, had **zero resolved outcomes**; the 0.0 expectancy members could see was synthetic, not measured.
- The member drawing passed two blind packets (judge scores A 2.54 with 92% of charts at 2 or more, B 2.36 with 96%;
  `setup_draw_r3.py` header). That measures whether judges agreed the picture shows the setup, **not** whether the
  trade made money.
- The scanner's own statistics (see section 5.1, item 2) have no source.

**Limits any future test must handle.** The result depends on the anchor rule (different anchors give different
lines); the daily-bar line differs from the intraday line; example lists picked because they worked are biased; and a
reclaim test must say what happens below the 200-day, since our rule book excludes those longs.

---

## 5. Our app

### 5.1 The scanner: `api/services/pattern_engine/detectors/uct/avwap_reclaim.py`
Registered as `avwap_reclaim`, category "uct", bullish (`api/routers/patterns.py` line 688; description "Anchored VWAP
from a key pivot reclaimed on volume after being below. Brian Shannon's AVWAP framework — anchor-aware level
reclaim."). It is not in the member display set (`detectors/registry.py`, `DISPLAY_MEMBER_SET`); members see the
round-3 drawing instead (5.2). The screener's pattern join (`screener/pattern_join.py`) names it in its notes on setups
that never resolved. I did not trace every route that could show its text.

**What it tests (faithful summary).**
- Needs at least 80 daily bars (`_MIN_BARS`).
- **Volume gate:** the last bar's volume is at least 1.5x the average of the 20 bars before it.
- **Anchors** (checked in turn; best score wins), all 5 to 60 bars back:
  - "swing_low": a 5-bar fractal low (lower than the two bars on each side). The docstring says "most recent", but the
    loop keeps the **lowest** one in the window (line 180).
  - "gap_up": an open at least 3% over the prior close. The narrative says "the most recent gap-up day", but the loop
    runs oldest-first and stops at the first hit (line 204), so it takes the **oldest** gap in the window. No volume or
    earnings test.
  - "52w_high": only when there are 252+ bars, but the search range starts at the 60-bar window (line 210), so it is
    really the **highest high of the bars 5 to 60 back**, not the 52-week high.
  - I confirmed all three on a synthetic series: with a deeper low 45 bars back and a shallower one 12 bars back, it
    chose 45; with gaps 50 and 10 bars back, it chose 50; with a 150 high 199 bars back and a 120 high 40 bars back, its
    "52w_high" was the 120.
- **AVWAP:** sum of (high+low+close)/3 × volume from the anchor bar (whole day included) to now, divided by volume.
- **Reclaim:** today's close is above the AVWAP by any amount, and the 5 or more closes right before were all below it
  (counted back up to 20).
- **Levels:** entry = close × 1.001; stop = AVWAP − 0.5 × ATR(14); target = the highest high of the last 30 bars ×
  1.005.
- **Score:** 40% geometry (anchor type: swing low 100, 52w high 90, gap 80; depth by bars below), 25% volume, 20%
  context (from a base of 50, adds points for Stage 1/2/3, stacked or mixed averages, rising or flat RS, accumulation;
  subtracts 8 for distribution), 15% a fixed 50 (`hist_score = 50.0`, line 142). Floor 50. **The floor can never
  reject anything:** the lowest possible score once the gates pass is 60.9 (checked by hand: 0.40 × 68.75 + 0.25 × 70
  + 0.20 × 42 + 0.15 × 50).

**Where it disagrees with the sources or looks wrong.**
1. **Wrong publisher.** "(Wiley, 2023)" (lines 4 and 37; narrative line 437). Shannon's book is from Alphatrends
   Publishing LLC (Barnes & Noble; Wikipedia). Wiley published the Coles and Hawkins MIDAS book.
2. **Claims attributed to Shannon that I found nowhere** (not on his site, not in his podcast transcript, not on his
   partners' pages). Treat as invented until someone shows the page:
   - "Shannon's specific empirical observation is that 5+ bar underwater holds followed by reclaim produce continuation
     roughly 60-65% of the time on liquid leaders" (around line 485) and "60-65% ... 50-55% on mid-caps, and 40-45% on
     small-caps" (around line 566).
   - "Shannon specifically excludes low-volume reclaims" (line 489) and "the volume confirmation Shannon insists on"
     (line 459). He gives no volume number anywhere I read.
   - "Shannon's threshold for an actionable AVWAP reclaim is R:R >= 2.0" (line 494).
   - "the 'kiss-goodbye' confirmation pattern" (lines 499, 514).
   - "the 0.5-ATR buffer below the AVWAP is Shannon's specific anti-whipsaw filter" (line 517).
   - "Shannon's typical execution scales out half at the swing high" (line 521). His own words describe a **third**,
     on a fast first day, often near daily R2 ("not necessarily at daily R2").
   - "roughly 10-15% higher win-rate" with confluence (line 530).
   - "swing-low anchors carry the highest empirical edge" (line 479) and "Shannon's three highest-edge anchor types"
     (line 533). No Shannon text I read ranks anchors by edge; his pages use highs, lows, events and time periods.
   - "Shannon's specific guidance: exit immediately on the close that re-violates the AVWAP" (lines 547 to 549) and
     "Shannon's specific guidance: exit at breakeven on the close back below the AVWAP" with an edge that "dissipates"
     within "5-10 bars" (lines 560 to 564). *(added in checking.)* Not on his pages; his 2017 slides lean the other way:
     "Be more aware of the direction of the VWAP than whether it closes above or below it for a session or two".
   - "Shannon's published failure-rate observations" (line 565): I found no published rates from him.
   - The docstring's "This "reclaim" is one of Shannon's signature swing-trading triggers, extensively documented
     across his AlphaTrends.net daily videos and the 2023 book" (lines 16 to 19): his public pages do not name a
     reclaim as a setup; I did not watch the videos or read the book. *(added in checking.)*
   - Two narrative lines are fair paraphrases of his Q&A ("Focus on meaningful pivots"): "Shannon emphasizes the
     discipline of anchoring only to genuinely meaningful pivots" (lines 503 to 504) and "only anchor to pivots that ARE
     clearly visible on the chart" (lines 577 to 578).
   - "Shannon's execution rule from his 2023 book" (line 511). I did not read the book, so I cannot say it is wrong, but
     the wording matches nothing on his public pages.
   - "since the mid-2010s" (line 439): Alphatrends dates from 2006.
3. **A false sentence on every detection.** The narrative says the setup "clears" an R:R of 2.0 no matter what. On a
   synthetic high-anchored reclaim it reported R:R 0.84 and still printed "which this setup clears". *(checked: the
   sentence is unconditional in the code, lines 494 to 495; a second synthetic series in checking gave R:R 0.22 and the
   same sentence.)*
4. **No trend filter.** Nothing checks the 200-day. It fires below a falling 200-day (house B26 forbids those longs).
5. **No extension cap.** A gap that clears the line by 10% qualifies; the stop distance is unlimited (house A13 about 3%,
   C28 4% chase limit, C29 10% over the 10-day).
6. **No reclaim quality test.** A close one cent over the line counts; repeated crossings (chop) count; it need not be
   the first reclaim. The drawing tests all three.
7. **Swing-low anchors as the "reclaim" anchor** (see 3.11 item 2).
8. **Its target is not the house plan.** It does not use the shared 2R/3R `make_levels` named in `TRADE_PLANS.md`; its
   target is the 30-day high, which can be very close (the cause of the 0.84 R:R above).

### 5.2 The member drawing: `api/services/pattern_engine/setup_draw_r3.py`, `avwap_reclaim()` (around lines 567 to 653)
"Display only: it changes nothing any detector fires on". Released to members in round 3
(`auto_structures.MEMBER_AVWAP_RECLAIM_ROUND = 3`; id `draw:avwap-reclaim` is in `DISPLAY_MEMBER_SET`). The row carries
the AVWAP curve, no narrative. Its rule, read from the code:
- At least 201 bars inside the function (the `detect()` entry also needs the as-of bar at index 220 or later,
  `MIN_ASOF_INDEX`, and passes at most the last 330 bars, `WINDOW`); ATR(14) at least 0.8% of the close; no
  pending-deal price pin (`deal_gate`).
- **Anchor:** the highest high of the as-of bar and the 150 bars before it (the latest bar if tied), at least 20 bars
  old.
- **A real decline:** the high minus the lowest low since is at least 4 ATR.
- **Reclaim bar:** a close above the AVWAP after a close at or under it, within the last 3 bars, at least 12 bars after
  the anchor; every close since then is above the line.
- **First reclaim:** at most 2 closes above the line between 3 bars after the anchor and the reclaim.
- **Time under:** the 15 closes before the reclaim all under the line, on average at least 0.2 ATR under, and none of
  those 15 days' highs more than 0.25 ATR over it. (Also 7 of the last 10 under.)
- **Not chop:** at most 2 crossings in the 30 bars before the reclaim.
- **Clear but not stretched:** today's close 0.3 to 1.0 ATR above the line.
- **Not a gap over:** the reclaim bar did not open more than 0.5 ATR above the line.
- **No volume test.**

This matches Shannon's "average participant from a prior high" and his 2017 "VWAP from the prior peak" slide. It does
not test the line's slope, so it does not check his "flattened" picture (which, on his page, is anchored to a low) or
his "A move above a DECLINING VWAP will often fail". It does not test the 200-day either: it calls `deal_gate` only.
The same file defines a `bull_gate` (close above a 200-day that is higher than 20 sessions earlier) but never calls it;
the round-2 drawings call their copy (`setup_draw_r2.py`, the pennant and the Darvas box).

### 5.3 Model Book, journal tags, trade plans, Study
- **Model Book** (`app/src/pages/modelbook/setupCatalog.js`): **no AVWAP card.** The closest cards are "Remount" (a
  moving average), "U&R" and "Gap Support".
- **Journal tags** (`app/src/constants/setupGroups.js`): **no AVWAP tag.** "Remount" and "Classic U&R" exist.
- **`docs/study/TRADE_PLANS.md`:** no AVWAP row.
- **Study bank:** the High Volume Edge playbook already teaches an AVWAP as a level: "The edge is a level, not a buy
  signal: mark the HVE close with a ray and run an AVWAP from the edge day; trades are taken on the setups that form
  around that level later." (`docs/study/bank/recall.playbooks.json`; the differentiation note
  `docs/study/analysis/2026-10-25-setup-differentiation.md` says the HVE chart "carries a ray from that close and an
  AVWAP from that day".) *(checked: the first draft said "I found no owner quote behind the AVWAP part". There is
  one, recorded in `docs/study/RESUME.md` (2026-10-25, the HVE chart overlay, PR #461): "slap a horizontal ray on the
  close of the HVC candle and also put an AVWAP on it from the HVC candle day." The code is
  `app/src/pages/study/hveOverlay.js`.)*
- **Foundations unit already planned:** `docs/study/UNITS-foundations.md` lists "F2b.08 | Anchored VWAP | Where the
  average buyer since an event sits, anchoring to an earnings day or a low, why it acts as a level". *(added in
  checking; bears on section 10, question 1.)*
- **Voice knowledge base** (`api/data/voice_kb/trading_principles.json`, entry ms-002, also in
  `docs/study/bank/recall.principles.json`): "AVWAP from an earnings event or breakout pivot is even more powerful — it
  marks the price level where smart money started buying." This is curated house text of unknown authorship, not the
  owner's words. Its line "Stocks holding above session VWAP are being accumulated; below VWAP they're being
  distributed" is stronger than any source I read; Shannon speaks of who is "in control", not accumulation.
- **Charts:** members can draw an AVWAP by click and add an AVWAP indicator (session, week, month, quarter, year, swing
  high, swing low; `api/services/indicator_compute.py`, typical price × volume, same formula as the scanner).

### 5.4 The two in-house rules side by side

| | Scanner `avwap_reclaim` | Drawing `draw:avwap-reclaim` |
|---|---|---|
| Who sees it | Team/screener (not the member set) | Members (blind-checked) |
| Anchor | Deepest swing low, oldest 3% gap, or the high of bars 5 to 60 back | 150-day high, 20+ bars old, after a 4 ATR fall |
| Time under | 5 closes | 15 closes, clearly under, no pokes |
| Quality | Any close above | First reclaim, no chop, 0.3 to 1.0 ATR above, no gap over |
| Volume | 1.5x the 20-day average | None |
| Trend filter | None (score only) | None |
| Levels | Entry close +0.1%, stop AVWAP − 0.5 ATR, target 30-day high | None |

**Recommendation [my proposal]:** one definition. Bring the scanner in line with the drawing (plus the 200-day rule),
and remove or source every Shannon claim in its narrative. That is a code change for a later session, when the owner
says so.

---

## 6. UCT's own words

**Method.** I read all 103 URLs in the Substack sitemap through Substack's public post API on 2026-11-09: 101 full
posts, one subscriber-only post (sunday-scans-bf1, 2026-10-18) that returns only its opening lines, and a placeholder.
I searched every paragraph for "AVWAP", "anchored VWAP", "VWAP anchored", "ATH vwap", "earnings candle VWAP", "VWAP
from" and "Shannon", and assigned each paragraph to the section heading above it. **Authorship.** The About page says
"Uncharted Territory is a live trading room on Discord, run by co-founders Patrick (TSDR) and Bracco."
(https://unchartedterritoryy.substack.com/about), and the 2026-10-25, 11-01 and 11-08 posts head the
owner's section "Patrick (TSDR)’s Weekly Outlook & Watchlist". So "TSDR’s Weekly Outlook & Watchlist", its "Charts
Covered" block, "TSDR TRADING" and the TSDR desk logs are **the owner's own words**. "Bracco’s Breakdown & Top Ideas" is
Bracco. "Index & ETF" sections, "Thoughts on the Market" and "Trade Updates" are unsigned. Dates are Substack publish
dates. **Count:** 32 posts, 55 mentions of the anchored-VWAP terms: the owner 22, Bracco 21, unsigned 7, guest
contributors 5. *(checked: a recount found the same 32 posts and 55 mentions, and 5 for the guests; the owner/Bracco/
unsigned split depends on how a few paragraphs are assigned to sections, and my own pass gave about 20 to 22 for the
owner. Shannon's name appears in 4 posts, 3 of them with no AVWAP term.)*

**Private material left out on purpose.** UCT's Discord desk logs and lessons (reachable through the brain
knowledge-base extracts) also discuss anchored VWAPs and the intraday VWAP entry. This repo is public and `CLAUDE.md`
forbids Discord exports and brain-DB content in it, so none of that is quoted or summarised here. The KB ids are in my
hand-off note to the owner, not in this file. Everything below is from the public Substack.

### 6.1 The owner (Patrick, TSDR)

**AVWAPs as levels on the daily chart (Substack)**
- AEVA: "Followed by two inside days above the 200SMA with lower wicks and then explosion again on Friday through the
  highs and the AVWAP from it’s peak in June." (2026-01-11, https://unchartedterritoryy.substack.com/p/sunday-scans-0b3)
  *The clearest reclaim of an AVWAP from a high in his words.*
- HNGE: "Huge move after getting above the IPO AVWAP." (2026-08-23, https://unchartedterritoryy.substack.com/p/sunday-scans-807)
- APPS: "APPS was great off the 20EMA and AVWAP offering an extremely tight risk spot with high probability of success."
  (2026-06-28, https://unchartedterritoryy.substack.com/p/sunday-scans-ae1)
- SNOW: "AVWAP from earnings got taken out Friday and can be a spot to trade tightly around in the coming days." (same
  post; "taken out" most likely means the line broke under, see 3.11 item 9)
- DDOG: "AVWAP from earnings gap up holding." (same post); and "holding AVWAP from earnings." (2026-06-21,
  https://unchartedterritoryy.substack.com/p/sunday-scans-bc0)
- TWLO: "Holding ER close, gap support, 50SMA, inside day just below the 20EMA and AVWAP from earnings." (2026-06-28);
  and "Lower wicks at the 20EMA, $200 psyche, and AVWAP from earnings. Reasonable risk spot, strong stock." (2026-06-14,
  https://unchartedterritoryy.substack.com/p/sunday-scans-e95)
- TEAM: "Strong post earnings move with the AVWAP and 20EMA just below. Give me a shake to $170 and a show of buyers and
  I will give it a whirl." (2026-09-13, https://unchartedterritoryy.substack.com/p/sunday-scans-2f5)
- CRCL, overhead AVWAPs as resistance: "CRCL came into the AVWAP from highs, and from IPO near $130. Sensible spot for it
  to begin consolidation." (2026-03-22, https://unchartedterritoryy.substack.com/p/sunday-scans-cab); "The anchored VWAPs
  from IPO open and IPO high continue to give this a tough time at $130." (2026-05-17,
  https://unchartedterritoryy.substack.com/p/sunday-scans-679); then, weekly: "Holding AVWAP from swing low. Held $100
  level. Daily bullish engulfing Thursday for the signal." (2026-05-31, https://unchartedterritoryy.substack.com/p/sunday-scans-6d8)
- CRWV: "The bear gap to the left just around $120 is acting as resistance. We have a flurry of anchored VWAPS sitting
  at $100 that are very interesting." (2026-04-26, https://unchartedterritoryy.substack.com/p/sunday-scans-f2d)
- POET: "Included the anchored VWAP from the lows and the beginning of the volume surge." (2025-12-07,
  https://unchartedterritoryy.substack.com/p/sunday-scans-088)
- PLTR: "Will watch the ER AVWAP and the MAs down below for some opportunity." CBRS: "Then popped decently after the gap
  down into the IPO AVWAP." (2026-08-16, https://unchartedterritoryy.substack.com/p/sunday-scans-da5)
- SPCX: "Tight inside day below $150 IPO open and sitting right smack on the IPO AVWAP." (2026-09-06,
  https://unchartedterritoryy.substack.com/p/sunday-scans-fcd); "$150 IPO open holding and right at AVWAPs from notable
  spots." (2026-09-13)
- PATH (TSDR TRADING): "Made a strong three day move and beginning to consolidates over the previous peak and the AVWAP
  from ATHs back in 2021 post IPO." (2025-12-10, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b3f)
- INOD (TSDR TRADING): "Pinched between ATH anchored VWAP and YTF anchored VWAP. Next hourly signal will be actionable."
  (2026-01-14, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305) *An "AVWAP pinch" in all but name.*

**The intraday VWAP as his entry tactic (Substack)**
- APPS: "I will be looking for an Opening Range Break or a “VWAP undercut and rally”." (2025-11-05,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9)
- TMDX: "Stop LOD. If unable or unwilling to try ORB at open. Look for a retest or an undercut and hold of VWAP mid
  morning." (2026-02-25, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24)
- His stop, generally: "My stops are always LOD until I can raise them to breakeven" (2025-06-22,
  https://unchartedterritoryy.substack.com/p/sunday-scans-0d2). *(added in checking.)*
- BE: "The VWAP undercut intraday needs to be studied. This is S tier type setup and trade opportunity." (2026-09-27,
  https://unchartedterritoryy.substack.com/p/sunday-scans-09b); and "Thursday’s hold of the VWAP at $157 into the
  afternoon was tight spot where I could risk $1 per share + overnight risk." (2026-04-12,
  https://unchartedterritoryy.substack.com/p/sunday-scans-a43)

**Shannon's other template, which the owner uses by name**
- "was a textbook Brian Shannon Gap Up against intermediate trend." (2026-04-05,
  https://unchartedterritoryy.substack.com/p/sunday-scans-356); and "the Brian Shannon Gap Up vs Intermediate Trend
  template" (2026-08-02, https://unchartedterritoryy.substack.com/p/sunday-scans-cd2). This is a gap template, not the
  AVWAP reclaim, but it shows Shannon is a source the house already trusts.

**What this adds up to for the owner.** He reads anchored VWAPs on the daily chart as levels to trade *around*, in
confluence with the 20 EMA, the 50-day, the earnings close and gap support, and he wants "a show of buyers" there. He
times entries with the intraday VWAP: an undercut and remount, low-of-day stop. He has described a stock moving up
through or over an AVWAP from a high or an IPO at least three times (AEVA, HNGE, PATH) but never named it as a setup.

### 6.2 Bracco ("Bracco’s Breakdown & Top Ideas")
- The closest thing to a rule: "I have studied many charts in the past that have made big moves off of a low and
  support on the first pullback to a VWAP anchored to the low of the move." (SPX, 2026-03-22, sunday-scans-cab; the
  line in question was "the 2025 low anchored VWAP", in a correction, and the next paragraph says "this isn’t the most
  ideal look for a clean mean reversion trade yet", so it is an index mean-reversion read.)
- Above the IPO AVWAP as a condition: "Clean above the IPO anchored VWAP now which is big for me to get involved." (FLY,
  2026-04-12, sunday-scans-a43)
- AVWAPs from highs as resistance on late-stage tops: "Think notable that SNDK is trading above both the all time high
  and July low AVWAP’s right now as many late stage tops break out of ranges and then reject those swing high AVWAP’s."
  (2026-09-06, sunday-scans-fcd)
- Retest of the ATH AVWAP from above: "Shook out at the 20ema and also retested the ATH anchored VWAP = sign of
  strength." (CRWV, 2026-05-03, https://unchartedterritoryy.substack.com/p/sunday-scans-bcc). Same post, MP: "Shook out
  at the base lows at beginning of April and now building out a tight range above the ATH anchored VWAP." And, from
  below, IONQ: "Might need a little more time here as straight up into the ATH anchored VWAP, but this whole group is
  setting up crossbacks." ("Crossbacks" most likely means the EMA crossback, Kell's re-entry on the Model Book's "EMA
  Crossback" card; the post does not say it means the AVWAP.)
- Stalls at AVWAPs from highs: "Stalled right at the 50sma and all time high anchored VWAP on Friday." (CRWV,
  2026-04-12); "Stalled at IPO high AVWAP last week. Worth watching on this crossback." (SPCX, 2026-08-16)
- Earnings AVWAP as support: "Held the earnings gap AVWAP and 20ema on recent pullback." (INTC, 2026-05-24,
  https://unchartedterritoryy.substack.com/p/sunday-scans-ffb); "Rising 20ema and earnings AVWAP just below." (INTC,
  2026-05-31)
- Above the ATH AVWAP while basing: "Getting extremely tight on the daily chart above all these moving averages and ATH
  anchored VWAP." (CRWV, 2026-05-31); "Above all MA’s and ATH vwap." (TSLA, 2026-05-31)
- Market reads: "QQQ attempting to stage a U&R of the $700 level and perfectly held the follow-through day anchored VWAP
  from 4/8 (yellow line)." (2026-06-14); and on QQQ: "have to give benefit of the doubt with recent swing low AVWAP right
  below last weeks lows as well as the open gap from the follow through day. We violate those and I would be pretty
  cautious." (2026-08-23)
- Earlier posts: MSTR "Supported at the April 7th swing low anchored VWAP (Orange Line) and now trying to find a higher
  low spot with some tight action." (2025-06-08, https://unchartedterritoryy.substack.com/p/sunday-scans); ETH "The yellow
  line represents the lifetime anchored VWAP, which this supported at on the shakeout within the handle in April."
  (2025-07-27, https://unchartedterritoryy.substack.com/p/sunday-scans-63b); BTC "Bitcoin is trying to stage a U&R at the
  200ma, April low AVWAP, and 107k support." (2025-10-19, https://unchartedterritoryy.substack.com/p/sunday-scans-6cc);
  RSP "On the chart below we can see it found support at the April low AVWAP and failed to breakdown below this base on
  massive volume." (2025-11-23, https://unchartedterritoryy.substack.com/p/sunday-scans-56d)
- The short-side mirror in his own setup: "For a parabolic short, I am always waiting until the intraday trend flips to
  the downside. I will never take an entry until the stock at least breaks below the intraday VWAP (Volume Weighted
  Average Price)." ("The Parabolic Short", 2025-06-13, https://unchartedterritoryy.substack.com/p/the-parabolic-short)

### 6.3 Unsigned sections ("Index & ETF", "Thoughts on the Market", "Trade Updates")
- "Remounted the AVWAPs from swing low and from ATHs." (QQQ hourly, 2025-12-21,
  https://unchartedterritoryy.substack.com/p/sunday-scans-34b)
- "Anchored VWAP from the lows and from the Follow Through Day marking some spots." (QQQ, 2026-07-19,
  https://unchartedterritoryy.substack.com/p/sunday-scans-a52)
- "It is the FOMC Anchored VWAP, Gap support from last week, and will align with the 20EMA." (QQQ, 2026-09-27,
  https://unchartedterritoryy.substack.com/p/sunday-scans-09b)
- "QQQ Anchored VWAPs from 10/10, 11/20, and 12/17 are up above at today’s high. That is lined up with the 50SMA right
  now." (2026-03-11, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-1b7)
- "it did the classic Gap Reversal Against Intermediate Trend from Brian Shannon. A setup we have used for quite some
  time with great success." (2026-04-01, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-13b)
- MSTR: "Big level I was watching was April low Anchored VWAP, mentioned in last nights post (orange line)." (Trade
  Updates, 2025-06-10, https://unchartedterritoryy.substack.com/p/trade-updates). Unsigned, but the MSTR idea and its
  orange line were in Bracco's section of the 2025-06-08 post, so it is probably his (an inference, not confirmed).

### 6.4 Guest contributors ("The Rest of the Week")
- Dark Oblivion, GCT: "Big run from 11 to 33, crossing the AVWAP from ‘24 peak and basing here for 11 weeks now and
  tightening." (2025-10-29, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757)
- Dark Oblivion, IREN: "AVWAP from HVE (Highest Volume Ever) gap from beginning of run, 30w and 65ema." (2026-01-14,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305)
- AMT, HOND: "A close above it’s HVC (highest volume close) and is now pressing the AVWAP from peak." (2025-10-01,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week)
- Beebe, CAT: "Sitting just below the earnings candle VWAP and holding the 10 EMA on the daily." and "Can risk just below
  the 10 EMA which is about 2% for a potential break out to new all time highs." (2025-11-12,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045)
- Beebe, TEVA: "Earnings candle VWAP is $24.88 and defended the 10 EMA on the daily today well." (2025-11-19,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c)

### 6.5 The owner's rulings
None on a reclaim. `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (614 lines) has no line containing "vwap",
"avwap" or "anchor". *(checked: one AVWAP ruling exists outside that log. `docs/study/RESUME.md`, 2026-10-25, records
his words for the High Volume Edge chart: "slap a horizontal ray on the close of the HVC candle and also put an AVWAP on
it from the HVC candle day." It makes the HVE/HVC day an anchor he chose himself, for a level, not a trade rule.)* The
account rulebook (section 7 below) is the only house law on the trade itself.

### 6.6 Example candidates named in UCT posts (leads for the owner's "10 examples"; I did not check these on bars)
Each needs the bars pulled and the round-3 rule (section 5.2) plus B26 run on it before it can be a lesson.

| # | Stock, date of the post | What the post says | Variant |
|---|---|---|---|
| 1 | AEVA, week ending 2026-01-09 (post 2026-01-11) | through the highs and the AVWAP from its June peak, above the 200-day | From the high |
| 2 | FLY, week ending 2026-04-10 (post 2026-04-12) | "Clean above the IPO anchored VWAP now" | From the IPO |
| 3 | HNGE, before 2026-08-23 | "Huge move after getting above the IPO AVWAP" | From the IPO |
| 4 | GCT, 2025 (post 2025-10-29) | "crossing the AVWAP from ‘24 peak", then an 11-week base | From the high |
| 5 | HOND, late Sept 2025 (post 2025-10-01) | close above its HVC, "pressing the AVWAP from peak" | From the high (not yet reclaimed) |
| 6 | QQQ hourly, week ending 2025-12-19 (post 2025-12-21) | "Remounted the AVWAPs from swing low and from ATHs" | Market read |
| 7 | CRCL weekly, week ending 2026-05-29 (post 2026-05-31) | holding the AVWAP from the swing low, bullish engulfing | Support, not a reclaim |
| 8 | SNOW, week ending 2026-06-26 (post 2026-06-28) | "AVWAP from earnings got taken out Friday" (most likely broke under it; same note: "undercuts and holds of the gap support") | Earnings-gap AVWAP, probably an undercut, not a reclaim |
| 9 | SNDK, early Sept 2026 (Bracco, post 2026-09-06) | bought "as it took out the range"; "trading above both the all time high and July low AVWAP’s" | Above the high's AVWAP after a range breakout; the post does not describe a reclaim |
| 10 | MSTR, early June 2025 (Bracco, 2025-06-08) | supported at the April 7 swing-low AVWAP | Support, not a reclaim |

*(checked: the first draft said rows 1 to 5, 8 and 9 are reclaims; row 5 is marked "not yet reclaimed" and rows 8 and
9 do not describe one.)* Rows 1 to 4 describe a move up through or above an AVWAP from a high or the IPO; row 5 is
pressing the line, not through it; row 9 is a range breakout that happens to sit above two AVWAPs; row 8 is most likely
an undercut. Some may sit under the 200-day. The rest are the support uses of the same tool.

---

## 7. How it fits the owner's account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | What it means for an AVWAP reclaim | Conflict? |
|---|---|---|
| **B26** no longs under the 200-day SMA (hard rule) | The stock must close above the 200-day on the reclaim day. | **Yes.** A reclaim of the AVWAP from a big high can come after a deep fall, sometimes under the 200-day (reasoning, not measured). Those are out. Neither app rule checks the 200-day. No parabolic exception applies (this is not a burst). |
| **C31** RS 80+ in a leading group, except parabolic and mean-reversion trades | Applies. A reclaim is a trend-resumption trade, not a mean-reversion trade (my reading). | Shannon ignores RS charts; the house rule wins. Owner to confirm it is not "mean reversion" (section 10). |
| **A3, F62** stop a few cents under the day's low or the prior day's low | The reclaim day's low normally sits at or under the AVWAP, so it is a natural, meaningful stop. | The scanner's AVWAP − 0.5 ATR stop has no source and is replaced. |
| **A13** stops usually within about 3% | Many reclaim days may be wide bars (reasoning, not measured). | Sometimes. If the honest stop is wider, size from it (A5) or skip (A3). (Not tightening it to fit is my reading of A3's "honest stop", not a rule's words.) |
| **E57** market orders | Enter with a market order once the trigger trades. | No. |
| **C28** no more than 4% past the buy point; **C29** skip if more than 10% over the 10-day | The buy point is the trigger price (section 8.2). | No; the drawing's rule (no more than 1 ATR above the line) is a similar idea. |
| **B23** $10+ and $20M+ a day; **D42** at most 1% of daily volume | Applies. Also protects the AVWAP itself: TrendSpider notes thin stocks distort it. | No. |
| **B22** no new buys within 3 days before earnings | Applies. Earnings-AVWAP variants form after the report, so usually fine. | No. |
| **B19, E51, E52** breakeven at 2R to 5R; a third at 3R, a third at 5R; trail under the 10-day (fast) or 21-day (steady) | House plan, unchanged. | Shannon trims faster (on a fast first day, a third, often near daily R2) and trails tighter (15-minute higher lows above a rising 5-day). Ours is the house plan. |
| **B20** gap through the stop: the first 30-minute low is the new stop, out past 2R | Applies. | No. |
| **C33** under 1R after 10 trading days: sell | Applies; fits Shannon's 3 to 6 day typical trade. | No. |
| **A4** the stop is the exit, only moves up | A close back under the AVWAP is not, by itself, an exit. | Possible. The scanner's text says exit on a close back under the line. Owner to decide (section 10). |
| **D47** shorts are the long setups reversed; **D48** borrow | The mirror is the AVWAP loss (section 8.6). | No. Shorts only under the 200-day (B26). |
| **B18, F65** the market filter | Green: full; Yellow: smaller; Orange: A+ only; Red: none (longs). | No. |
| **E50** grading is discretionary | Section 9 is a guide, not a checklist. | No. |
| **C35** days to a few weeks | Close to Shannon's typical 3 to 6 days, up to 5 to 6 weeks (6 to 8 in a strong trend). | No. |

---

## 8. Proposed rules for our course

Daily bars; "ATR" is the 14-day average true range; "AVWAP" is computed as in section 5 (typical price × volume from the
anchor day). Every line is measurable on a daily chart unless it says otherwise.

### 8.1 What it is (long)
1. **Anchor, core variant *from the high*:** the highest high of the last 150 sessions, at least 20 sessions old.
   [originator] (Shannon: "the average participant from a prior high"; 2017 slides: "Once the VWAP from the prior peak
   was breached, buyers were in control again") [UCT] (the app drawing's anchor and its numbers)
2. **Anchor, variant *from the earnings gap*:** the day of the most recent earnings gap up, using the Gap Support
   lesson's gap definition (a gap of at least 4% on at least twice normal volume; the bank lesson built on his rulings
   of 2026-10-26/27, quoted in `docs/study/levels/dossiers/gap_support.md`). [UCT] (the owner's most frequent anchor in
   his own Substack sections; *checked: the first draft said "most common UCT anchor", which is not true across all
   UCT writers, section 3.11 item 2*) [originator] (Shannon's event-based anchor) [my proposal] (reusing the Gap Support
   numbers)
3. **Anchor, variant *from the IPO*:** the first trading day. [originator] (podcast: "IPOs are great"; 2017 slides:
   "VWAP allows us to see control shift from Sellers to buyers in a fresh IPO") [UCT] (FLY, HNGE)
4. **Not this setup:** swing-low, Fed-day and year-to-date anchors. Teach them as support levels and market reads.
   [my proposal] A teaching choice only: Shannon's own worked reclaim (3.1) is of an AVWAP from a December low, and his
   IBB slides follow the year-to-date, election, prior-peak and September-high AVWAPs in one case. The HVE/HVC-day
   anchor the owner chose for the HVE chart (6.5) is a level too, not a reclaim anchor, unless he says otherwise.
5. **Prior trend:** the close is above the 200-day SMA on the reclaim day. [house rule] (B26). Better: the 200-day is
   higher than 20 sessions ago. [my proposal] [UCT] (the same test as `bull_gate` in `setup_draw_r2.py`, which the
   pennant and Darvas box drawings use)
6. **Leadership:** RS rating 80 or more, in one of the strongest groups. [house rule] (C31)
7. **Liquidity:** price $10 or more, $20 million or more a day; the position at most 1% of daily volume. [house rule]
   (B23, D42)
8. **A real fall (core variant):** the high minus the lowest low since the anchor is at least 4 ATR. [UCT] (drawing)
9. **Time under the line:** the 15 closes before the reclaim day all closed under the AVWAP, on average at least
   0.2 ATR under, and none of those days' highs went more than 0.25 ATR over it. [UCT] (drawing). For the earnings and
   IPO variants, the owner picks between 15 and 5 (the scanner's number) (section 10).
10. **First reclaim, not chop:** at most 2 closes above the line since 3 sessions after the anchor, and at most 2
    crossings of the line in the 30 sessions before the reclaim. [UCT] (drawing) [originator] ("oscillate above and
    below ... indecision")
11. **The line has flattened:** the AVWAP fell less than 0.5 ATR over the 10 sessions before the reclaim.
    [originator] (the idea: "regaining control as the AVWAP flattened out"; 2017 slides: "A move above a DECLINING VWAP
    will often fail" and "The steeper the angle of VWAP, the greater the likelihood of a move above or below to fail")
    [my proposal] (the number; no source gives one; drop it if the owner prefers the drawing as is)
12. **The reclaim day:** the close is 0.3 to 1.0 ATR above the AVWAP, and the day did not open more than 0.5 ATR above
    it (a gap over the line is a gap setup, judged as a Kicker or gap, not this). [UCT] (drawing). Not Shannon's split:
    he reads a gap over AVWAPs as "put buyers back in control" (3.1c).
13. **Volume:** not a gate; a grade marker (section 9). [my proposal] (no source sets a number)
14. **Not stretched:** the close is not more than 10% above the 10-day average. [house rule] (C29)

### 8.2 The buy
- **Trigger (recommended):** the next session, a market order once price trades one cent above the reclaim day's high.
  [my proposal] It puts Shannon's "buy strength after" and "evidence the buyers are gaining control" into daily-bar
  terms, matches the owner's Kicker entry ruling (over the prior day's high: "the entry should 11.05 over THE previous
  day high", 2026-11-02, the red day's high being 11.04 per `TRADE_PLANS.md`), and filters reclaims that fail the next
  day. *(checked: "a cent over" was `TRADE_PLANS.md`'s paraphrase, not his words.)*
  [originator] [UCT] [house rule] (E57 market orders)
- **Option B:** a market order in the last minutes of the reclaim day, once the close is clearly above the line. Earlier
  and a tighter stop, but more failed reclaims (reasoning, not measured). [UCT] (close to the scanner's entry, the
  close + 0.1%)
- **Option C (not drawable on daily bars):** on the reclaim day, once price is above the AVWAP *and* above that day's
  intraday VWAP, after an intraday VWAP undercut and remount. [originator] (Shannon's shorter-timeframe evidence) [UCT]
  (the owner's own entry tactic, low-of-day stop)
- **No chase:** skip if the fill would be more than 4% above the trigger. [house rule] (C28)
- **Earnings:** no new buy within 3 days before a report. [house rule] (B22)
- **Size:** from the stop, grade and market reading. [house rule] (A1, A5, D38, E49, F65)

### 8.3 The stop
- A few cents under the reclaim day's low (with the recommended trigger, that is the prior day's low). [house rule]
  (A3, F62). That low normally sits at or under the AVWAP, so a stop-out also means the reclaim failed. [my proposal]
  (reasoning)
- Usually within about 3%. If the honest stop is wider, size down from it; if it does not fit the risk, skip.
  [house rule] (A3, A5, A13). Never tighten it into the noise to make it fit. [my proposal] (my reading of A3's
  "honest stop"; *checked: the first draft tagged this sentence as a house rule, and no rule says it*)
- Not the scanner's stop (AVWAP minus 0.5 ATR). [my proposal] (no source; the house default exists)
- A gap through the stop: the first 30-minute low is the new stop; out if that is past 2R. [house rule] (B20)

### 8.4 Trims and trail
House defaults; the setup needs nothing special. [house rule]
- Breakeven at 2R to 5R. (B19)
- A third at 3R, a third at 5R; if the stock opens above a trim level, trim at the open. (B19, E51, F63)
- Trail the last third under the 10-day average (fast movers) or the 21-day (steadier), on a close below. (E52)
- Under 1R after 10 trading days: sell. (C33)
- For contrast only, Shannon's own style: on a fast first day a third off, often near the daily R2 pivot ("not
  necessarily at daily R2"), then a trail under 15-minute higher lows above a rising 5-day average, later higher lows
  above a rising 10 or 20-day. [originator] Not ours.

### 8.5 What invalidates it
- **Before the buy:** a close back at or under the AVWAP before the trigger trades: no trade. [UCT] (drawing: every close
  since the reclaim must stay above) [originator] ("Don’t hold and hope.")
- **Not the setup at all:** under the 200-day [house rule] (B26); more than 2 crossings in 30 sessions (chop)
  [UCT] [originator]; a gap open more than 0.5 ATR over the line [UCT]; a close more than 1 ATR over the line
  [UCT] or a fill more than 4% over the trigger [house rule].
- **After the buy:** the stop is the exit. [house rule] (A4). Whether a close back under the AVWAP is also an exit is the
  owner's call (section 10).

### 8.6 The short mirror: the AVWAP loss
A mirror exists. [house rule] (D47) [originator] (Shannon: "Does price break AVWAP support, which then turns to
resistance, or vice versa?"; his rejection test after anchoring to a high) [UCT] (Bracco: late-stage tops "reject those
swing high AVWAP’s").
- Close under the 200-day SMA [house rule] (B26); RS 20 or less, weakest groups [house rule] (C31 mirror).
- Anchor: the lowest low of the last 150 sessions, at least 20 sessions old; a rise of at least 4 ATR from it; the 15
  closes before the loss day all above the AVWAP from that low; at most 2 crossings in 30 sessions; the loss day closes
  0.3 to 1.0 ATR under the line and did not open more than 0.5 ATR under it. [my proposal] (the drawing reversed)
- Enter the next session, a market order one cent under the loss day's low; stop a few cents over the loss day's high;
  house trims and trail reversed. [my proposal] [house rule]
- Skip if hard to borrow or the fee is high. [house rule] (D48)
- Variant: a rally into a falling AVWAP from a high that fails there. [originator] Teach after the long side.
- The app has no code for the mirror.

### 8.7 Best market conditions
- A Green market reading; Yellow smaller and fewer; Orange A+ only; Red no new longs. [house rule] (B18, F65, D46)
- The index (QQQ or SPY) above its AVWAP from the most recent major low or follow-through day. [UCT] (Bracco's and the
  index sections' standing practice) [originator] (Shannon reads the market by its year-to-date and event anchors)
  [my proposal] (as a filter, not just a read)
- Several stocks in the same group reclaiming together. [my proposal] (as a grade marker). UCT's writers watch groups
  move together (the owner on SNOW and its peers: "go figure that the group performance is connected!") [UCT], but no UCT
  text ties that to AVWAP reclaims. *(checked: the first draft cited Bracco's "this whole group is setting up
  crossbacks", which is most likely about EMA crossbacks, 6.2.)*
- After a correction ends, when leaders are first getting back above their AVWAPs from their highs. [my proposal]

### 8.8 Common mistakes
1. **Buying the touch of the line instead of the proof.** [originator] ("levels of interest, not a place to do business";
   "don’t buy the dip, buy strength after")
2. **An arbitrary anchor.** Anchor only to events everyone can see. [originator] ("major highs/lows, big news, or strong
   reversals") [source consensus] (ChartSchool, TrendSpider on subjectivity)
3. **Buying a poke in a chop.** Many crossings mean indecision. [originator] [UCT] (drawing)
4. **Chasing a reclaim that already ran.** [originator] (on the stocks people ask him about: "75% of the time, it’s a
   stock that went 10% in the last three to four days"; after a 7% run he takes "maybe a half of a risk unit") [house
   rule] (C28, C29)
5. **Ignoring the next line up.** Another AVWAP from a higher high, an IPO-high AVWAP or a bear gap just overhead.
   [UCT] (CRCL: "The anchored VWAPs from IPO open and IPO high continue to give this a tough time at $130"; CRWV: "The
   bear gap to the left just around $120 is acting as resistance"; *checked: the first draft also cited CRWV's "flurry
   of anchored VWAPS sitting at $100", which the post does not place overhead*)
   [originator] (Shannon's second question: where will it meet supply)
6. **Taking it under the 200-day.** [house rule] (B26)
7. **Holding and hoping after it slices back under.** [originator] ("Don’t hold and hope.") Our answer is the stop.
   [house rule]
8. **Treating the daily-bar line as exact.** It is an approximation of the intraday line. [originator] ("as short a
   timeframe as possible")
9. **Mixing anchors without saying which.** A reclaim of the AVWAP from a low tells a different story (the buyers since
   the low went underwater) from a reclaim of the AVWAP from a high (the holders since the high are back to even). Name
   the anchor in every example. [my proposal] *(checked: the first draft called a swing-low reclaim a mistake; Shannon's
   own worked reclaim is from a low, 3.1, so it is reworded.)*

---

## 9. Grading: A+ versus B-

The owner ruled that grading is discretionary and no fixed checklist is taught as ours (E50). These are observable
markers to help the eye, drawn from the sources; the grade sets the size (D38, E49).

| Marker | A+ | B- |
|---|---|---|
| Anchor | An event everyone sees: the stock's major high, a big earnings gap, the IPO day [originator] [source consensus] | A minor wiggle or an arbitrary date [originator] |
| Trend | Above a rising 200-day; RS 80+ in a top group [house rule] | Just above a flat 200-day; RS barely 80 |
| Time under | 15+ closes clearly under, no pokes [UCT] (drawing) | Just enough closes, hugging the line |
| The line | Flattened before the reclaim [originator] | Still falling steeply [originator] (2017 slides: "The steeper the angle of VWAP, the greater the likelihood of a move above or below to fail") |
| The reclaim day | First reclaim; closes near its high, 0.3 to 1.0 ATR over the line [UCT] (drawing) [my proposal] (close near the high) | Third close-over in a month, chopping; closes mid-range; just over the line [UCT] (drawing) (not "many touches from below", which Shannon reads the other way, 3.11 item 12) |
| Volume | 1.5x or more of the 20-day average [UCT] (the scanner's number) [my proposal] (as a marker) | Below average [my proposal] (from Shannon's general "Volume is the fuel"; he sets no reclaim volume rule) |
| Confluence | The AVWAP sits at the 50-day, a prior breakout level or another AVWAP [originator] ("more likely when we have that confluence") [source consensus] (ChartSchool: "Where multiple Anchored VWAP lines converge, that can indicate an especially strong area of support or resistance."; TrendSpider: AVWAPs "can also be used to confirm each other") [UCT] (TWLO, APPS, TEAM) | The line alone |
| Overhead | Clear air to the next AVWAP or gap [originator] [UCT] | Another AVWAP or a bear gap within a few percent [UCT] (CRCL's IPO AVWAPs at $130; CRWV's bear gap at $120) |
| Stop | 3% or less [house rule] (A13) | Wider than 3% |
| Market | Green; the index above its AVWAP from the last low [house rule] [UCT] | Yellow or Orange |
| Group | Several group members reclaiming [my proposal] | Alone in a weak group [house rule] (C31: a leader in one of the strongest groups) |

---

## 10. Questions for the owner

1. **Is the AVWAP reclaim its own setup in Study, or a tool lesson?** UCT's own posts use AVWAPs mostly as levels and
   confluence; there is no Model Book card or journal tag. Options: (a) its own setup with a card and tag; (b) a
   Foundations lesson on reading AVWAPs, used inside other setups (HVE, Gap Support, U&R); (c) both. I lean to (c).
   (A Foundations unit, F2b.08 "Anchored VWAP", is already listed in `docs/study/UNITS-foundations.md`.)
2. **Which anchors count?** (a) only the high (as the member drawing); (b) high, earnings gap and IPO as three named
   variants; (c) any meaningful event, lows included (Shannon's own worked reclaim is from a low; you already anchor an
   AVWAP from the HVE/HVC day on HVE charts). I recommend (b) for a first lesson.
3. **How long under the line?** (a) 15 closes (the drawing); (b) 5 (the scanner); (c) different for the earnings and IPO
   variants. I recommend 15 for the high, and your call for the others.
4. **The buy:** (a) next day, a cent over the reclaim day's high (my recommendation, like your Kicker ruling); (b) the
   reclaim day's close; (c) intraday on the reclaim day after a VWAP undercut and remount (your own tactic, not drawable
   on daily bars).
5. **The stop:** (a) a few cents under the reclaim day's low (house default, my recommendation); (b) the scanner's
   AVWAP − 0.5 ATR; (c) a tighter intraday stop.
6. **A close back under the AVWAP after the buy:** (a) the stop is the exit, nothing else (A4); (b) also an exit, before
   the stop. (Shannon's 2017 slides: "Be more aware of the direction of the VWAP than whether it closes above or below
   it for a session or two"; the scanner's "exit immediately" text has no source.)
7. **Volume:** (a) no rule (the drawing); (b) a gate at 1.5x the 20-day average (the scanner); (c) a grade marker only
   (my recommendation).
8. **RS and B26:** confirm the AVWAP reclaim is not a "mean-reversion" trade, so C31 (RS 80+) and B26 (above the 200-day)
   both apply with no exception.
9. **The scanner:** may a later session (a) bring `avwap_reclaim.py` in line with the drawing plus the 200-day rule, and
   (b) remove every claim about Shannon that has no source (the 60-65% rates, "kiss-goodbye", the 0.5 ATR "anti-whipsaw"
   stop, the R:R 2.0 line, the "exit immediately" and "5-10 bars" guidance, "Wiley")? That text is wrong regardless of
   the rules you choose.
10. **The short mirror (AVWAP loss):** teach it now, later, or not at all?
11. **Examples:** shall I pull bars for the leads in section 6.6 and run the drawing rule plus B26 on them for your review?

---

## 11. Sources

All read 2026-11-09 unless marked. "Not read" means I could not open it and quote nothing from it.

### Outside sources read

| Source | Publisher / author | URL | Reliability note |
|---|---|---|---|
| "Anchored VWAP" page, "By Brian Shannon" | Alphatrends / Brian Shannon, CMT | https://alphatrends.net/anchored-vwap/ | Originator's own words. Best source for his reading of control and the reclaim; its worked reclaim is anchored to a December low. |
| "Anchored VWAP: The Perfect Combination of Price, Volume & Time" (slides, 9/27/17) | Brian Shannon, CMT (CMT Association webcast deck) | https://cmtassociation.org/wp-content/uploads/2017/09/0927-shannon.pdf | *(added in checking.)* Originator's own slides; direction rules ("A move above a DECLINING VWAP will often fail"), the IBB prior-peak reclaim, IPO anchors. Slide text only; the talk itself not heard. |
| "How To Use The Anchored VWAP (AVWAP)" (2017-12-18) | Alphatrends, "By Brian Shannon, CMT" | https://alphatrends.net/archives/2017/12/use-anchored-vwap-avwap/ | *(added in checking.)* Originator; what an anchor event is, trapped longs at breakeven, a gap over AVWAPs as control changing. |
| "Don't Buy the Dip, Buy Strength After the Dip™" | Alphatrends / Brian Shannon | https://alphatrends.net/dont-buy-the-dip-buy-strength-after-the-dip/ | Originator, first person. Names the AVWAP "from a prior high". |
| "Anchored VWAP Book" page | Alphatrends | https://alphatrends.net/anchored-vwap-book/ | Publisher's page for the book; describes contents only. |
| Fill the Gap, episode 61, transcript (published 2026-02-27) | CMT Association; hosts Tyler Wood, CMT and Dave Lundgren, CMT, CFA; guest Brian Shannon, CMT | https://cmtassociation.org/podcast/fill-the-gap-episode-sixty-one-anchored-vwap-legend-brian-shannon-cmt/ | Originator in his own words; the transcript has transcription errors. |
| "Brian Shannon Featured in Discussion on Anchored VWAP and Market Structure" (2026-06-08) | Alphatrends (team, third person) | https://alphatrends.net/archives/podcast/brian-shannon-featured-in-discussion-on-anchored-vwap-and-market-structure/ | Originator's company summarising his view. |
| "Anchored VWAP on Thinkorswim" lesson (2025-06-06) | Alphatrends | https://alphatrends.net/archives/podcast/anchored-vwap-on-thinkorswim/ | Originator's company. |
| "Fine Tune Your Entries with Anchored VWAP" (2023-04-13) and the StockCharts Final Bar note (2023-03-30) | Alphatrends | https://alphatrends.net/archives/fine-tune-your-entries-with-avwap-tradeideas-03302023/ and https://alphatrends.net/archives/effectively-using-the-anchoredvwap-julius-dekempenaer-stockcharts-the-final-bar-032823/ | Pages only point to videos; no rules quoted from them. |
| "Alphatrends AVWAP" add-on page and "Using the Anchored VWAP Market Explorer Window" | Trade Ideas, LLC (partner of Alphatrends), undated, © 2024 | https://www.trade-ideas.com/features/ti-avwap/ and https://www.trade-ideas.com/features/avwap-using-the-market-explorer/ | Commercial partner; names the setups the product scans ("AVWAP pinch", "Pullback to AVWAP", IPO). |
| Book listing, *Maximum Trading Gains with Anchored VWAP* | Barnes & Noble | https://www.barnesandnoble.com/w/maximum-trading-gains-with-anchored-vwap-brian-shannon/1143103574 | Retail metadata: publisher "Alphatrends Publishing LLC", e-book date 2023-01-20. |
| "Brian Shannon" | Wikipedia | https://en.wikipedia.org/wiki/Brian_Shannon | Secondary; used only for dates, books, ISBN, CMT year, with its citations. |
| "MIDAS technical analysis" | Wikipedia | https://en.wikipedia.org/wiki/MIDAS_technical_analysis | Secondary, tagged "Orphan"; used for MIDAS history, tenets and the "porosity" term. Cites Coles and Hawkins (2011) and *Technical Analysis of Stocks & Commodities* articles. |
| "Anchored VWAP drawing tool" | TradingView Help Center | https://www.tradingview.com/support/solutions/43000669764/ | Platform documentation; history paragraph (Levine, MIDAS, Haggerty). |
| "Anchored VWAP" and "Volume-Weighted Average Price (VWAP)" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/anchored-vwap and https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/volume-weighted-average-price-vwap | Established educator; definitions and formula; no trade rules. |
| "Alphatrends Anchored VWAP" help page and Learning Center "Anchored VWAP" | TrendSpider | https://help.trendspider.com/kb/indicators/alphatrends-anchored-vwap and https://trendspider.com/learning-center/anchored-vwap/ | Vendor educator; generic; contradicts Shannon on "signal". |
| "TrendSpider User Guide: Exploring the Anchored VWAP With Brian Shannon" (2019-09-09) | TrendSpider blog, Brad Ritter | https://trendspider.com/blog/trendspider-user-guide-exploring-the-anchored-vwap-with-brian-shannon/ | Points to a webinar; no usable rules on the page. |
| "Is The Anchored VWAP The Perfect Indicator?" (webcast of 2017-09-27) | CMT Association | https://cmtassociation.org/video/is-the-anchored-vwap-the-perfect-indicator/ | Video page only; no transcript. The slide deck for it is in the row added above. |
| Open Library record for ISBN 978-1-57660-372-7 | Open Library | https://openlibrary.org/isbn/9781576603727.json | *(added in checking.)* Catalog metadata for the Coles and Hawkins MIDAS book: publishers "Wiley", "Bloomberg Press", "John Wiley & Sons". |

### UCT sources read

| Source | Author | URL / path | Note |
|---|---|---|---|
| All 103 sitemap URLs (101 full posts, 1 subscriber-only, 1 placeholder) | Uncharted Territory: Patrick (TSDR), Bracco, guest contributors | https://unchartedterritoryy.substack.com/sitemap.xml (read through the public post API) | UCT's own words; authorship by section. |
| About page | Uncharted Territory | https://unchartedterritoryy.substack.com/about | Confirms "Patrick (TSDR) and Bracco". |
| "The Parabolic Short" (2025-06-13) | Bracco | https://unchartedterritoryy.substack.com/p/the-parabolic-short | Intraday VWAP rule for the short side. |
| Brain KB extracts (Discord desk logs, lessons, trader archive) | The owner (TSDR), Bracco, other in-house traders | `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json` | Read, but **not quoted or summarised here**: private Discord material, and this repo is public. The full KB lives on the pod and was not reachable. |
| The scanner | UCT code | `api/services/pattern_engine/detectors/uct/avwap_reclaim.py` | Read in full; anchors probed on synthetic bars. |
| The member drawing | UCT code | `api/services/pattern_engine/setup_draw_r3.py` (`avwap_reclaim`, `deal_gate`) | Read in full. |
| Registry, routes, screener, release rounds | UCT code | `api/routers/patterns.py`, `api/services/pattern_engine/detectors/registry.py`, `api/services/auto_structures.py`, `api/services/screener/pattern_join.py` | Who sees what; the "never resolved" note. |
| AVWAP indicator maths | UCT code | `api/services/indicator_compute.py` | Same typical-price formula. |
| Model Book catalog, journal tags | UCT code | `app/src/pages/modelbook/setupCatalog.js`, `app/src/constants/setupGroups.js` | No AVWAP entry in either. |
| Trade plans, account rulebook, owner rulings | UCT docs | `docs/study/TRADE_PLANS.md`, `docs/study/sizing_rule.md` §9, `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | No AVWAP row; no AVWAP ruling in the verdict log. |
| Owner's HVE-overlay ruling, Foundations unit list | UCT docs and code | `docs/study/RESUME.md` (2026-10-25 entry), `app/src/pages/study/hveOverlay.js`, `docs/study/UNITS-foundations.md` (F2b.08) | *(added in checking.)* His one AVWAP ruling (an AVWAP from the HVC/HVE candle day, as a level); the planned Foundations unit. |
| Study bank, voice KB, levels dossiers | UCT docs | `docs/study/bank/recall.playbooks.json`, `docs/study/bank/recall.principles.json`, `api/data/voice_kb/trading_principles.json`, `docs/study/levels/dossiers/gap_support.md`, `docs/study/analysis/2026-10-25-setup-differentiation.md` | House text; authorship noted where it matters. |

### Not read
- Shannon's books (*Maximum Trading Gains With Anchored VWAP*, 2023; *Technical Analysis Using Multiple Timeframes*,
  2008). Not available to me. Anything our scanner says comes from the book is therefore unverified.
- Coles and Hawkins, *MIDAS Technical Analysis* (2011), and Paul Levine's MIDAS lectures (the site named on Wikipedia,
  midasmarketanalysis.com, did not respond).
- Berkowitz, Logue and Noser, "The Total Cost of Transactions on the NYSE", *Journal of Finance*, March 1988: the
  publisher page refused access; cited only as Shannon cites it.
- Shannon's Benzinga article (2022; the search engine lists it as "EXCLUSIVE: Brian Shannon's Favorite Ways To Use The
  Anchored VWAP"): the site refused automated access.
- Yahoo Finance video pages with Shannon: rate-limited (HTTP 429).
- IBD/MarketSmith, Bulkowski (thepatternsite.com): not searched (the search allowance ran out; in checking, the search
  tool refused investors.com, and a site-limited search of thepatternsite.com found nothing on AVWAP).
- TraderLion *(checked)*: a search lists Richard Moglen case studies (for example the NET earnings gap, November 2025)
  that use an intraday "AVWAP reclaim" as an earnings-gap entry tactic. The site answered HTTP 403 to both a plain
  request and the fetch tool, so nothing from it is quoted or relied on here.
- Shannon's Benzinga article: re-tried in checking (plain request and fetch tool), HTTP 403 both times.

---

## Removed in checking

The cold check (2026-11-09) re-opened every source. All quotes were found word for word on their pages. These claims
were removed or corrected because the source did not say them, or said something narrower:

1. **"which no source I read supports"** (a reclaim of an AVWAP anchored to a low, 3.11 item 2). Shannon's own worked
   reclaim on his AVWAP page is of the AVWAP from a December low ("after the AVWAP from the December low was broken").
   Removed; 3.1, 3.2, 3.10, 5.2, 8.1 rule 4 and 8.8 mistake 9 now say so.
2. **"UCT uses earnings and IPO anchors most"** (3.11) and **"most common UCT anchor"** (8.1 rule 2). True of the
   owner's own Substack sections only; across all UCT writers, AVWAPs from highs/ATHs are named most, then lows.
   Corrected.
3. **"I found no owner quote behind the AVWAP part"** (5.3), **"The owner has never ruled on it (no verdict mentions
   VWAP)"** (short version) and **"None."** (6.5). His HVE-chart ruling is recorded in `docs/study/RESUME.md`
   (2026-10-25): "slap a horizontal ray on the close of the HVC candle and also put an AVWAP on it from the HVC candle
   day." Corrected; it is about a level, not a reclaim.
4. **"Only rows 1 to 5, 8 and 9 are reclaims"** (6.6). Row 5 was itself marked "not yet reclaimed"; row 8 (SNOW,
   "taken out") most likely describes the line breaking under; row 9 (SNDK) is a range breakout above two AVWAPs.
   Corrected, and row 8 and 9's labels changed.
5. **"a cent over"** given in quotation marks as the owner's Kicker ruling (8.2). That is `TRADE_PLANS.md`'s
   paraphrase; his words are "the entry should 11.05 over THE previous day high". Replaced.
6. **"Never tighten it into the noise. [house rule] (A3, A13)"** (8.3) and **"never tighten it"** (section 7, A13 row).
   No rule says it. Retagged [my proposal].
7. **"(for example a 'reclaim' figure in the mid-60s percent)"** (section 4). The page was not named, so the number
   cannot be checked. Removed.
8. **Bracco's "this whole group is setting up crossbacks" as support for group AVWAP reclaims** (8.7, section 9).
   "Crossbacks" most likely means EMA crossbacks. Removed as support; the line is now [my proposal].
9. **CRWV's "flurry of anchored VWAPS sitting at $100" as overhead supply** (8.8 mistake 5, section 9). The post puts
   the bear gap at $120 overhead; it does not place the $100 AVWAPs overhead. Removed; the bear gap stays.
10. **"First third at daily R2" / "a third at daily R2"** as Shannon's plan (3.3, 3.10, 3.11, 5.1, section 7, 8.4).
    His words are about a fast first day, and he adds "not necessarily at daily R2". Narrowed everywhere.
11. **"75% of the time, it's a stock that went 10% ..." as a chase rule** (3.3, 8.8). It describes the stocks people ask
    him about. Context added.
12. **"This matches ... his falling-then-flat-then-surge picture closely"** (5.2). The drawing has no slope test, and
    that picture is anchored to a low. Corrected.
13. **"Low of day (owner, everywhere)"** (3.10). Replaced with his words, "My stops are always LOD until I can raise them
    to breakeven" (2025-06-22).
14. **"catalogs list Bloomberg Press"** (section 2). Narrowed to the one catalog read (Open Library, which lists Wiley,
    Bloomberg Press and John Wiley & Sons). "This Wiley book is probably where our scanner's 'Wiley' came from" is now
    labelled a guess.
15. **"Below average [originator] ('Volume is the fuel')"** as a B- grade marker (section 9). Shannon sets no reclaim
    volume rule. Retagged [my proposal].
16. **"His named product setups"** (short version) for the Trade Ideas alerts: they are the partner channel's alerts.
    Reworded.
17. **"really the highest high of the last 60 bars"** (5.1). The window is bars 5 to 60 back. Corrected.
18. **Unmarked reasoning presented as fact:** "often happens under the 200-day" (short version), "Many reclaim days are
    wide bars" (section 7), "more failed reclaims" (8.2 Option B). Now marked as reasoning, not measured.
19. **"Bulkowski ... TraderLion: not searched."** TraderLion was found in checking but refused access (HTTP 403);
    nothing from it is used. Bulkowski: a site-limited search found nothing on VWAP.
20. **"falling" then "flattened"** in quotation marks as Shannon's words (3.10). His page says "declining" and
    "flattened out". Corrected.
21. **"He has twice described a stock moving up through an AVWAP"** (6.1). PATH, consolidating "over the previous peak
    and the AVWAP from ATHs", is a third. Corrected to "at least three times".
22. **SNOW and CRWV quotes without their context** (6.1). SNOW's "taken out" is flagged as most likely a break under;
    CRWV's AVWAP quote now carries the sentence before it, which places the bear gap, not the AVWAPs, overhead.

---

## 12. Examples (from our data)

**The scan's rule (one paragraph).** Daily bars from the local sandbox, 1984 to 2026-11-06, over the 2,630 names that
ever met the house liquidity rule (the scan completed: 2,630 of 2,630 scanned in 258 seconds, nothing cut for time).
It codes the core variant of section 8.1, the anchor *from the high*: on each session the anchor is the highest high of
the previous 150 sessions that is at least 20 sessions old (item 1); the AVWAP is typical price x volume summed from the
anchor day, on daily bars (an approximation of the intraday line, 8.8 item 8); the anchor high minus the lowest low since
the anchor is at least 4 ATR(14) (item 8); the 15 closes before the reclaim day all closed under the line, on average at
least 0.2 ATR under, and none of those days' highs went more than 0.25 ATR over it (item 9); at most 2 closes above the
line since 3 sessions after the anchor and at most 2 crossings in the 30 sessions before (item 10); the line fell less
than 0.5 ATR over the 10 sessions before the reclaim (item 11); the reclaim day closes 0.3 to 1.0 ATR above the line
and did not open more than 0.5 ATR above it (item 12); close above the 200-day SMA (B26), close $10 or more and 50-day
average dollar volume $20 million or more (B23), close not more than 10% above the 10-day average (C29). The buy is
the recommended trigger of 8.2: a market order one cent over the reclaim day's high in one of the next 3 sessions
(the open when it gapped over), abandoned if a close came back at or under the line first (8.5) or the fill was more
than 4% over the trigger (C28). Stop 3 cents under the reclaim day's low (8.3), the trade skipped if that was more
than 5% under the fill (A13 says about 3%; the cut at 3% is reported below). One hit per name per 20 sessions. Not
coded: the RS rating and group (C31; a proxy is given for the 10), the earnings blackout (B22; checked by hand for the
10), the market reading, the trims. Outcome: from the day after the fill, 60 sessions forward, the first of stop / 3R /
5R; both on one day, the stop wins. Volume on the reclaim day is recorded, not gated (item 13). Scripts:
`scratchpad/setups/19-avwap-reclaim/scan19.py` and `chart19.py` (not in the repo).

**Base rate.** 1,128 hits (1,069 on stocks, 59 on ETFs), 1996-08-02 to 2026-11-05. Of the stock hits, **25.7% reached
3R and 15.2% reached 5R before the stop**; 81% were eventually stopped at the original stop inside the 60 sessions
(winners included, since the stop never moves here) and 51% never reached 1R. Among the winners the median time to 3R
was 12 sessions. **Caveat:** this is a fixed stop with no trims, no breakeven move, no trail and no time stop, so it
measures how often the structure delivers 3R and 5R, not what the house trade earns. Cuts (stocks only, same scan):
the stop's size mattered most: stops of 2% or less, 26.5% / 17.5% (3R / 5R); 2-3%, 29.3% / 17.0%; over 3%, 22.5% /
12.3% (A13's "about 3%" earns its place); a fill the very next session (967 hits) did better than a fill on day 2 or 3
(102 hits): 26.2% / 15.5% against 21.6% / 11.8%, which sides with "the next session" over the 3-session grace the scan
allowed; a deeper fall (8 ATR or more, 627 hits) reached 5R more often, 16.7% against 12.9%; the 200-day rising over
20 sessions (877 hits) helped only at 5R, 15.8% against 12.0%. Reclaim-day volume did NOT help: 1.5x the 50-day average
or more (139 hits) 22.3% / 10.8%, under 1.5x 26.2% / 15.8%, and under 1.0x (562 hits) 27.0% / 17.1%. That sides with
item 13 (volume is not a gate) and argues against making it a grade marker for this setup until the owner has looked.
How far the reclaim close sat over the line (0.3-0.5 ATR against 0.5-1.0 ATR) and how long the stock had been under
(30 sessions or fewer against more) made no difference.

**The 10 examples** (all stocks, one per name, ten different years, every one reached 5R; prices split-adjusted as
the database holds them; none of the buys fell inside the 3 sessions before an earnings reaction day (B22), checked
against the earnings table, and none of the anchors is an earnings day, so all ten are the *from the high* variant,
not the earnings-gap variant). Files: `scratchpad/setups/19-avwap-reclaim/final/NN_TICKER_DATE.png` and the phone
sheets `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` (not in the repo). "RS" is the 12-month weighted price-change
proxy of `01-flat-base/rs_proxy.py` on the reclaim day (not IBD's rating). "Under" is the number of closes under the
line between the anchor and the reclaim.

| # | Ticker | Reclaim / buy | Anchor high | Fall | Under | Reclaim close / volume | Buy | Stop (risk) | Best R (3R on day) | RS | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | MAR | 2004-09-14 / 09-16 | 2004-06-09, 24.00 | 13.3 ATR (12.7%) | 66 | +0.70 ATR / 0.38x | 22.93 | 22.68 (1.1%) | 21.5R (10) | 51 | Three months under a flat line, a slow base along the 200-day, then one close over and a tight stop; no trigger on day 1, filled on day 2. The quiet version. |
| 2 | CAT | 2005-05-17 / 05-18 | 2005-03-04, 49.98 | 10.6 ATR (17.4%) | 49 | +0.41 ATR / 0.78x | 46.04 | 45.02 (2.2%) | 9.4R (15) | 68 | An undercut of the 200-day in April, then the reclaim with the 50-day just overhead (8.8 item 5); it paused two weeks under 48 before running. |
| 3 | EPC | 2006-12-27 / 12-28 | 2006-10-26, 59.63 | 15.8 ATR (18.7%) | 42 | +0.86 ATR / 0.89x | 52.67 | 51.99 (1.3%) | 18.9R (6) | 66 | The deepest fall of the ten; the line flattened for a month at 52 before the reclaim; 3R in six sessions. Stop 1.3%. |
| 4 | BX | 2013-09-10 / 09-11 | 2013-07-23, 23.86 | 7.2 ATR (12.4%) | 34 | +0.32 ATR / 0.60x | 22.43 | 21.97 (2.1%) | 14.1R (5) | 83 | The one with RS over 80. A modest close (+0.32 ATR) on light volume, a gap open over the trigger (filled at the open, 22.43 against 22.38); 3R in five sessions. |
| 5 | WMB | 2014-04-16 / 04-17 | 2014-03-07, 42.94 | 4.8 ATR (8.5%) | 27 | +0.54 ATR / 0.42x | 41.37 | 40.74 (1.5%) | 29.1R (9) | 47 | The minimum structure: the smallest fall (4.8 ATR), the shortest time under, the lightest volume, and the biggest result. The later gap in June is unrelated news; the setup itself was at 5R before it. |
| 6 | NOW | 2017-04-19 / 04-20 | 2017-02-15, 18.94 | 7.4 ATR (11.9%) | 40 | +0.31 ATR / 0.92x | 17.70 | 17.50 (1.1%) | 24.5R (5) | 76 | A rising 200-day, a two-month fall, a flat line, a 1.1% stop; 3R in five sessions, with the report reaction day (04-27) landing after the first trim was due. |
| 7 | HLF | 2018-01-19 / 01-22 | 2017-10-09, 39.82 | 12.1 ATR (19.3%) | 66 | +0.76 ATR / 1.19x | 36.61 | 35.76 (2.3%) | 18.7R (3) | 57 | The anchor is a gap-up spike high; the line fell for a month then went flat for two; the reclaim day closed +0.76 ATR and 3R came in three sessions. |
| 8 | AJG | 2021-02-19 / 02-22 | 2020-12-17, 129.12 | 8.0 ATR (12.5%) | 41 | +0.58 ATR / 1.08x | 120.84 | 118.83 (1.7%) | 16.5R (10) | 33 | A steadily rising 200-day; the fall was shallow and the line flat for six weeks. Lowest RS proxy of the ten (33): a reclaim in a lagging name that still worked. |
| 9 | JPM | 2023-11-14 / 11-15 | 2023-07-31, 159.38 | 10.6 ATR (15.2%) | 74 | +0.81 ATR / 1.03x | 149.26 | 146.49 (1.9%) | 10.5R (11) | 62 | Three and a half months under; the October low undercut the 200-day; the reclaim closed +0.81 ATR. The 50-day was overhead and gave way. |
| 10 | MAS | 2024-07-12 / 07-15 | 2024-03-28, 78.94 | 9.2 ATR (19.2%) | 70 | +0.49 ATR / 1.34x | 71.15 | 69.53 (2.3%) | 8.4R (8) | 55 | A long, flat line at 70 after a 19% fall; the reclaim day, the 50-day and the trigger all within one ATR; 3R in eight sessions, the report reaction day (07-25) came after the first trim. |

Replaced in the visual review: CDW 2019-02-05 (a clean 22.4R reclaim, but the buy came two sessions before its
earnings reaction day, 02-07, so B22 forbids it) and TPR 2025-05-05 (18.4R, the April-2025 low reclaimed, but the
report reaction day was 05-08, three sessions after the buy, inside the B22 blackout); both are worth showing as
"what the rule stops you from doing". ENVA 2026-04-13 (17.1R; the trigger took three sessions, the one cut that did
worse in the data) and O 2020-01-16 (reached 5R, then fell from about 80 to under 40 inside the 60-session window in
March 2020: a chart for the trims-and-trail lesson, not for the entry) were set aside. AME 2009-09-09 was rejected
because its anchor is a one-day spike, not a high the eye reads as the top.

**Relative strength (a proxy).** Nine of the ten score under 80 on the proxy (33 to 76); only BX scores 83. That is not
an accident of the picks: the setup requires a fall of at least 4 ATR from a high, which pulls a 12-month rating down.
Applied literally, C31 (RS 80+) would remove most of these trades; the AVWAP reclaim may belong with the parabolic and
mean-reversion exceptions C31 already names, or the owner may want the RS test read on the stock's standing *before*
the fall. This is a question for him (add it to section 10), not a rule I have changed.

**Three notable failures, in words.** (1) AMZN, reclaim 2026-10-09, buy 2026-10-12: the AVWAP from the 2026-08-03 high
reclaimed after a 7.6 ATR fall and 47 closes under, a +0.42 ATR close, stop 2.6%; the stock never traded above the
fill again and was stopped (0.0R). Everything in the picture was right and it still failed: the stop, not the pattern,
is the protection. (2) DIS, reclaim 2021-07-12, buy 07-13: 86 closes under the line from the 2021-03-08 high, the
reclaim on 2.47x volume, the heaviest of any failure here; stop 4.1%; stopped at 0.17R. The loud volume did not help,
which matches the base-rate cut above. (3) TMO, reclaim 2022-03-18, buy 03-22: a +0.78 ATR close on 1.54x volume
after a 9.6 ATR fall, in a year the broad market fell; stopped with 0.0R. A reminder of 8.7: the index's own standing
matters, and the scan did not read it.


## 13. Failures and near-misses (from our data)

Built 2026-11-10 from the section 12 scan (`final/hits.json`), for the spot, discriminate and grade questions and the
method plan's rule that every setup unit ships with a correctly traded loss. Charts in the scratch folder's `final/`:
`fail_1-4.png`, `near_1-4.png`, and the confusable pair `pair_32-remount.png` (the MAR 2004-09-16 reclaim above the
Remount's MAR 2010-03-09 winner, each captioned with the card's tell: name the line). Every number is read off the
bars. Each failure passed every gate (anchor high 20 to 150 sessions old, a fall of 4 ATR or more, 15 closes under,
at most 2 crossings, a flattened line, a close 0.3 to 1.0 ATR over it with no gap over, above the 200-day, a fill the
next session no more than 4% over the trigger, a stop under the reclaim-day low within 3.3%) and the earnings table
shows no report reaction day from the session before the buy to 3 sessions after it. Two candidates the first pass
had picked were dropped for that reason: JNJ 2020-07-15 (its report reacted on 07-16) and INTU 2014-05-20 (the "gap
under the stop" on 05-21 was the earnings reaction); both were `av.earnings_window` violations, not setup failures.
Of section 12's three named failures, DIS 2021-07-13 carried a 4.1% stop (outside `av.stop_width`) and TMO 2022-03-22
was a day-2 fill (outside `av.trigger`'s next session), so only AMZN is kept.

**Four failures, traded by the rules** (one per name, four different years):

| Ticker | Reclaim / buy | Anchor, fall, closes under, reclaim day | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| AMZN | 2026-10-09 / 2026-10-12 | 2026-08-03, fall 7.6 ATR, 47 under, close +0.42 ATR, vol 0.88x | 262.81 | 255.97 (2.6%) | day 2, 2026-10-14, best +0.0R | The first close after the buy was back under the line and 7 of the next 10 stayed under; the low 20 sessions later was 12.7% under the buy. Everything in the picture was right (a 7.6 ATR fall, 47 closes under, a flat line); the reclaim simply failed and the stop said so. | av.after_entry_stop |
| PG | 2017-06-15 / 2017-06-16 | 2017-03-17, fall 8.6 ATR, 61 under, close +0.83 ATR, vol 1.06x | 89.72 | 88.20 (1.7%) | day 9, 2017-06-29, a gap under the stop, best +0.32R | Drifted to +0.32R, closed back under the line on day 7 and gapped through the stop on day 9; all of the next 10 closes stayed under. A slow failure the time stop would have caught a session later. | av.stop_gap |
| LIN | 2019-09-12 / 2019-09-13 | 2019-07-23, fall 8.4 ATR, 35 under, close +0.41 ATR, vol 1.01x | 192.63 | 189.29 (1.7%) | day 1, 2019-09-16, best +0.0R | Stopped the next session, with one close under the line; then it held the line for weeks and the 3R level printed 39 sessions later without us. A one-day shake-out under the reclaim-day low; the rule is still the stop, and a re-entry is a new trigger (av.reentry). | av.after_entry_stop |
| MRK | 2012-12-11 / 2012-12-12 | 2012-10-18, fall 11.2 ATR, 34 under, close +0.68 ATR, vol 1.26x | 43.22 | 42.43 (1.8%) | day 1, 2012-12-13, best +0.0R | Stopped the next session and never traded above the fill; all of the next 10 closes were back under the line and the low 20 sessions later was 11.6% under the buy. A failed reclaim that became the start of a decline. | av.after_entry_stop |

**Four near-misses, each failing exactly one gate** (the scan re-run with that one gate relaxed):

| Ticker | Reclaim / buy | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| ADC | 2019-01-08 / 2019-01-09 | av.real_fall | fall from the anchor high 3.9 ATR; the rule wants 4 or more | Not a real fall: a 3.9 ATR dip from a one-month high, reclaimed after 19 closes under. It reached 6.4R, and the rule still rejects it by a tenth of an ATR; a borderline case worth a grade question, not a spot question. |
| AAPL | 2021-10-18 / 2021-10-19 | av.line_flattened | the AVWAP fell 0.56 ATR over the 10 sessions before; the rule wants under 0.5 | The line had not flattened: the AVWAP was still dropping 0.56 ATR per 10 sessions when price crossed it. It reached 9.3R; the rule is a quality filter, not a prediction, and the owner may want the 0.5 ATR cut read as a grade cue (section 10). |
| CAG | 2019-11-14 / 2019-11-15 | av.reclaim_day_close | reclaim-day close +0.23 ATR over the line; the rule wants 0.3 to 1.0 | A marginal poke: the reclaim day closed 0.23 ATR over the line, inside the noise. The next session filled the trigger and it chopped to 2.7R before the December gap did the real work. |
| AGCO | 2019-09-06 / 2019-09-09 | av.no_gap_over | reclaim-day open +0.91 ATR over the line; the rule allows 0.5 at most | A gap over the line: the reclaim day opened 0.91 ATR above the AVWAP, so the line was never retaken from below in regular hours. Judged as a gap setup, not an AVWAP reclaim; it reached 3.1R. |

Not charted: the `av.time_under` near-miss (5 to 9 closes under a line the stock had held, the U&R lookalike) is rare
in the data: 3 hits in 1,162 names scanned (BRK-B 2001-09-27, AIZ 2010-08-30), because a stock that held its AVWAP
for weeks and dipped under it for a week rarely also passes the fall and the flattened-line gates. The U&R contrast
is better taught from the U&R's own charts (setup 29). The `av.above_200` near-miss exists in `near/` (116 hits) and
was left out for space.

**What the failures have in common.** All four stopped on a close back under the line within days: the reclaim did
not hold, which is exactly what the stop under the reclaim-day low is placed to detect (`av.stop`). Volume on the
reclaim day was ordinary in all four (0.88x to 1.26x), consistent with section 12's finding that volume does not sort
winners from losers here. Two of the four (LIN, PG) were later proved right about the level: LIN printed the 3R level
39 sessions later and PG went on to 2.9R inside the window, after a second, cleaner retake; the lesson is
`av.reentry`, a new trigger with its own stop, not a wider first stop. The two that never came back (AMZN, MRK) fell
11.6% to 12.7% in the next 20 sessions: the stop cost 1R where holding would have cost five.
