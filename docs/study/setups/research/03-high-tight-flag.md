# Setup 03: the High Tight Flag (Power Play) (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
file or book passage named next to it, and kept to 40 words or fewer (curly quote marks are printed as straight ones).
Nothing here is a ruling. Where I could not read a source myself, I say so. Numbers marked [my proposal] are mine, for
the owner to accept or change.

**Cold check, 2026-11-09.** A second reader re-opened every source below, compared every quote word for word, re-read
the app code and recounted the repo figures. What was corrected, added or taken out is listed in section 12, "Removed in
checking". One block is still unverified and is marked where it appears: Minervini's 2017 book wording (section 3.4).

Tags used in section 8: **[originator]** the words of the person who named or popularised the setup (O'Neil / IBD,
Minervini, Bulkowski for his own statistics); **[source consensus]** several outside sources agree; **[UCT]** UCT's own
writers (the owner writes as TSDR; Bracco, ChartMaster, Manrav); **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation.

**The short version.**
- The pattern: a stock about doubles in eight weeks or less (the pole), then pauses for one to six weeks a little under
  its high (the flag), on drying volume. The buy is the move above the high of the pattern.
- **Names.** William O'Neil / IBD call it the "high, tight flag"; Bulkowski writes that it "was popularized by William
  O'Neil in his book, How To Make Money In Stocks". Mark Minervini calls it the "Power Play" and says it is the same
  pattern (a reader's notes on his 2013 book; the repo's reading of his 2017 book). Thomas Bulkowski calls it the "high
  and tight flag".
- **Numbers differ by source.** Pole: 90% (Bulkowski) or 100% (IBD, Minervini) in 8 weeks or less; Kuhn (1996): about
  100% to 120% in four to eight weeks, "less in some cases". Flag: 10% to 25% deep (IBD), at most 20% (Minervini, 25% for
  lower-priced stocks), "no more than 10% to 20% of the advance" (Kuhn, measured on the pole, not on price), 3 to 5 weeks
  (IBD) or 3 to 6 weeks (Kuhn, Minervini), as short as 10 to 12 days (Minervini). Buy point: the top of the pattern; IBD
  (2007), Stockbee's O'Neil notes and TraderLion add 10 cents, Bulkowski a penny.
- **The only measured statistics are Bulkowski's, and they got worse over time.** His book (2nd edition) called it the
  best pattern (69% average rise, none of 307 failed). His later automated study of 2,588 patterns (1995 to 2009) found
  a 33% combined failure rate and a 27% average rise, and a stop a penny under the flag low averaged a 26% loss. His
  site now ranks it 30 of 39, 38, or 43 of 56 depending on the page. IBD itself says: "Many fail."
- **UCT uses "HTF" more loosely than the books.** In 47 matching Substack lines (2025-06 to 2026-09), UCT writers call
  tight flags in ETFs that never doubled (TAN, XLV, XHB, IGV) "HTF" or "high tight flag". When a pole is named it ranges
  from 65% to 500%.
- **Our app has five different engines for it, and they disagree** (two of them matched 0 symbols in common in a
  2026-08-31 check of 744 tickers). The main scanner (`high_tight_flag.py`) has a dead "already broken" check,
  unsourced claims in its lesson text, a wide flag-low stop (9% to 14% under the entry for a 100% pole whose flag gives
  back 15% to 25% of it, my arithmetic) and a $2 price floor. The house rulebook's tight stop, $10 floor and 10-day
  stretch rule (C29) all bite on this setup.

---

## 1. What it is, and the market psychology

**In two sentences.** A high tight flag is a stock that rises about 90% to 100% or more in eight weeks or less, then
moves sideways a little under its high for roughly one to six weeks, giving back no more than about a fifth to a quarter
of its price while volume dries up. The trade buys the first move above the top of that pause, betting the second leg
follows the first.

**Why it works, in the sources' own words.**
- A move this fast usually means something changed. Kuhn (1996): the stock "typically spends time in a well-contained
  base formation lasting from many months to many years. Then, some important news event usually emerges to lift the
  stock out of its dormancy". Minervini (by the repo's reading of his 2017 book, unverified, see section 3.4) calls it a
  "velocity pattern" and will buy it "even with a dearth of fundamentals". A reader's notes on his 2013 book put it as:
  the stock "is exhibiting so much strength that it's telling you that something is going on" (section 3.5).
- Holders do not sell. IBD (2014): "Similar to the handle portion for a cup-with-handle base, volume generally dries up.
  Big fund managers are holding the stock."
- The crowd is positioned wrong. IBD (2015) describes the pole: most investors "would look at that and say, 'Well, it's
  over. Too bad I missed it.'" and of the pullback: "Most investors would see that drop as a confirmation that they were
  right to be cautious."
- It is a rest, not a top. Bulkowski: "It usually doesn't look like a flag or pennant, just a pause in the price rise."

**Who is buying and who is trapped** (my reading of the above, not a quote).
- Buying: funds still building positions after a real change (a new product, earnings, a contract), and traders who
  missed the pole and use the pause to get in.
- Trapped on a breakout: anyone who sold the pole early, shorted it as "too far too fast", or waited for a deeper
  pullback. They chase above the old high, which is the fuel.
- Trapped on a failure: buyers near the pole top and breakout buyers. A pattern built on speed can unwind with speed:
  Bulkowski warns "These rockets go up fast and can return to earth just as quickly", and IBD lists NQ Mobile, which "rose
  not quite 30% in the next month, then collapsed 57% in a single week."

---

## 2. Origin and naming

- **William J. O'Neil / Investor's Business Daily.** The "high, tight flag" is one of IBD's named bases. IBD (2015)
  quotes O'Neil's *How to Make Money in Stocks* calling it "the strongest of patterns" and adding "Many stocks can
  skyrocket 200% or more off this pattern." The book was first published by McGraw-Hill in 1988 (Open Library's catalogue
  records); I did not have the book's text and did not check which edition first carried the pattern. Bulkowski (2009,
  section 3.6) credits O'Neil's book: "The high & tight flag was popularized by William O'Neil in his book, How To Make
  Money In Stocks." No source I read says who first named it. IBD's 2007 column (quoted on Stockbee) calls Syntex (1963)
  "a classic example".
- **Greg Kuhn, "The High, Tight Flag"**, *Technical Analysis of Stocks & Commodities* V.14:6, pp. 248-252 (June 1996).
  Paywalled; the publisher's store page shows the article's opening paragraphs, which give its numbers (section 3.3).
- **Thomas Bulkowski, "high and tight flag"**, *Encyclopedia of Chart Patterns*, 2nd edition, pages 350 to 361 (his page
  says so), plus his site and a *Stocks & Commodities* article "Highs & Tight Flags" (V.27:12, December 2009). He treats it
  as a different pattern from an ordinary flag.
- **Mark Minervini, "Power Play".** In *Think & Trade Like a Champion* (2017), Section 7, by the repo's research file. A
  reader's book review shows a Power Play section already in *Trade Like a Stock Market Wizard* (2013) (section 3.5). Our
  app's journal tag "High Tight Flag (Powerplay)" joins the two names.
- **Pradeep Bonde (Stockbee).** Wrote about IBD's version in 2007 and built a scan for it; in 2011 he called it
  "Essentially yet another continuation pattern , Darvas box kind pattern in high momentum stocks." He also uses the
  name for his own very tight "Anticipation" pauses (2019, KOD). I found nothing showing he "refined" the pattern; see section 5.
- **Kristjan Kullamagi (Qullamaggie).** His breakout setup "on the daily it can be called a hight tight flags sometimes"
  (his spelling). His version is broader (a 30% to 100%+ move).
- **Other names:** HTF; high and tight flag; high-tight flag; Power Play / Powerplay; "flag_htf" in our trader archive.
  Not the same thing: a plain bull flag (Bulkowski's ordinary flag needs no doubling), "3 weeks tight", Stockbee's
  "Ants", and Qullamaggie's general breakout.

---

## 3. Every definition, source by source

### 3.1 IBD (O'Neil's house), three columns republished on Yahoo Finance

Checked 2026-11-09: Yahoo refused the command-line client (HTTP 429), so the 2014 and 2015-09 columns were re-read in
full from Internet Archive copies (2018-07-03 and 2021-01-26); every quote below matched. The 2015-03 column has no
archived copy and was checked through a fetch tool only.

**"The Base Watcher's Field Guide: Stalking The High, Tight Flag"**, IBD, 2014-08-15.
https://finance.yahoo.com/news/watchers-field-guide-stalking-high-223700570.html
- Pole: "First, a stock must gain 100% to 120% in a span of four to eight weeks."
- Flag depth and time: "The second element, the flag itself, forms as the stock pulls back, usually 10% to 20% or
  sometimes 25%, in the next three to five weeks."
- Tightness, a surprise: "Price patterns are often wide and loose during these weeks" and "But the action appears tight
  vs. the steep run-up before the base."
- Volume: "Similar to the handle portion for a cup-with-handle base, volume generally dries up. Big fund managers are
  holding the stock."
- Trigger and breakout volume: "Element number three is the breakout, when the stock clears the peak of the flagpole in
  big turnover, meaning daily volume that's at least 40% above average."
- Risk: "High, tight flags are high-risk bases. Many fail." Also: "High-flying, China-based stocks have recently seemed
  especially prone to forming and then faltering out of such patterns."
- Example, JDS Uniphase 1999: "The stock bounced off its 10-week line near mid-October and advanced 136% in six weeks. It
  pulled back 23% in the next three weeks." And: "Weekly trading ranges were a little wild and wooly, but the closes were
  relatively tight."

**"High, Tight Flag Is Rare Pattern That Can Deliver Incredible Gains"**, IBD, 2015-09-17.
https://finance.yahoo.com/news/high-tight-flag-rare-pattern-204600066.html
- "The stock begins by climbing 100% to 120% in four to eight weeks."
- "Next, the stock corrects 10% to 25% in three to five weeks."
- Taser 2003: "In July 2003, Taser broke out and advanced about 98% in four weeks." "The stock corrected 24% in just under
  three weeks". Buy point 27.07; then "The stock triggered the 8% sell rule two weeks after the breakout but regained the
  buy point the same week". Ratings at the breakout: "the stock showed a 98 Composite Rating as well as 81 EPS and 98 RS
  grades." A second flag followed: "After the more than 150% rise, a new 25%-deep flag formed."
- Stop: no stop is named for this base. The "8% sell rule" above is IBD's general loss rule.
- Both rides: "An investor who caught both rides could've bagged a more than 1,300% gain in seven months." (an anecdote)

**"Looking At A Great Chart Base? Make Sure To Count The Weeks"**, IBD, 2015-03-11 (read through a fetch tool, not raw).
https://finance.yahoo.com/news/looking-great-chart-sure-count-203400677.html
- "The flagpole is shaped by a rapid run-up of 100% to 120% in only four to eight weeks."
- "The flag then forms with three to five weeks of tight sideways trading."

**"Rare High Tight Flag Offers Investors Opportunity For High Returns"**, IBD, 2007-07-09, as quoted by Pradeep Bonde.
https://stockbee.blogspot.com/2007/07/rare-high-tight-flag-offers-investors.html
- "The stock will usually surge 100% to 120% in a short period of time, four to eight weeks."
- "It will then correct no more than 10% to 20% in three to five weeks, tracing the flag portion."
- "The ideal buy point is at the peak of the flag plus 10 cents."
- Rarity: "If you're lucky, you'll spot one or two of those in a bull market."

Not read: IBD's own site (investors.com) refused the fetch tool, and I did not use archived copies of its paywalled
pages. IBD has other columns on this base on investors.com; I could not open them, so no title, wording or number from
them is used here.

### 3.2 Pradeep Bonde (Stockbee), his own words and scans

- 2007-07-09, his scan of IBD's rule (his "Telechart interpretation"): first "( 100 * (C - C40) / C40) >= 100", then
  updated to "( 100 * (MAXC40 - C40) / C40) >= 100" (the highest close of the last 40 days at least double the close 40 days ago),
  with a liquidity filter "AVGC20 * AVGV20 >= 2500". He adds: "Rest of the conditions are more guidelines, so making too
  specific scans for them might not serve much purpose."
- Same post, comments: "If you are finding too many high tight flags, there is something wrong with your interpretation
  of that article. It is rare but very profitable pattern." And: "Some of these stocks are two low priced for IBD
  criteria, plus they need liquidity. Plus IBD good EPS ratings."
- 2007-07-09, "Patterns and context" (https://stockbee.blogspot.com/2007/07/patterns-and-context.html): a reader's
  AmiBroker test (doubled in 40 days, down 10% to 20% in the last 15 days, close over $5, 20-day average volume over
  500,000; 24 hits from 2007-01-01 to 2007-07-06, some the same stock on nearby days) found "If
  anything, it's a good short scan. Almost every stock dropped further or at best went sideways after this pattern."
  Bonde's reply: "I am not surprised by the results, if a tight flag appears late in the move, it will break down to
  downside." "One needs to take the earnings rate and whether it is first base." "This thing is like Episodic Pivots, one
  can not trade it as a mechanical system, the interpretation becomes critical." He adds that IBD's examples "Taser and
  Syntex, both are of stocks which had like 500% plus EPS/ sales growth."
- 2007-07-17, "Opportunity Buffet" (https://stockbee.blogspot.com/2007/07/opportunity-buffet.html): "There is another
  scans which I have added in recent weeks to my daily list : The High Tight Flag, about which I wrote few weeks ago."
- 2011-12-13, "William O'Neil Setups" (https://stockbee.blogspot.com/2011/12/william-oneil-setups.html), text he says is
  "Reproduced from the Stockbee members site": "Then it corrects 10% to 20% in three to five weeks. That's the flag." and
  "The ideal buy point is the high of the pattern plus 10 cents." His comment: "Essentially yet another continuation
  pattern , Darvas box kind pattern in high momentum stocks."
- 2013-09-03 (https://stockbee.blogspot.com/2013/09/top-50-stocks-for-swing-traders.html): "High tight flags and bull
  flags are the most common continuation patterns on highly ranked stock by 65 day momentum."
- 2019-12-17, KOD (https://stockbee.blogspot.com/2019/12/how-to-make-money-using-anticipation.html): a 7-day pause near
  the high. "The consolidation was very tight and orderly. It is also called High Tight Flag." Entry at the open with a
  market-on-open order: "Entry was 64 which was the opening price. Stop was 40 cents. Which indicated a risk of .62%." He
  sold 900 of 1,000 shares within 17 minutes. "These kinds of picture perfect High Tight Flags are not very common but when
  they show up they can be very profitable." Note this is a much smaller move than IBD's doubling.

### 3.3 Greg Kuhn (1996), from the publisher's store page only

https://store.traders.com/-v14-c06-thehigh-pdf.html ("V.14:6(248-252) The High, Tight Flag by Greg Kuhn"). The store page
prints the article's opening paragraphs; the rest is paywalled. Quotes below are cut to 40 words or fewer.
- Pole: "The high, tight flag pattern is a rare formation characterized by its occurrence after an advance that takes a
  stock up approximately 100% to 120% in just four to eight weeks, less in some cases."
- Flag: "Following such a run, the stock usually corrects in a tight, sideways pattern lasting anywhere from three to six
  weeks, retracing no more than 10% to 20% of the advance." Note "of the advance": the depth is measured on the pole's
  height, not on price (20% of a 100% pole is 10% of the price).
- After: "Many stocks can rise another 100% or more after the formation."
- Before the pole: "The stock typically spends time in a well-contained base formation lasting from many months to many
  years. Then, some important news event usually emerges to lift the stock out of its dormancy".
- Volume, trigger, stop and target: not in the readable part.

### 3.4 Mark Minervini, *Think & Trade Like a Champion* (2017), Section 7, "The Power Play"

**Source warning: UNVERIFIED.** I did not read the book. These quotes are as recorded in the repo's research file
`docs/superpowers/research/bases/03-minervini-vcp-powerplay.md` (which says it text-extracted a full PDF copy found on a
third-party website, not the publisher's, and cites the book's index as "the power play, 164-167") and in
`api/services/screener/base_catalog.py`. The cold check could not verify them either: no legal copy was available, Google
Books' search was over quota, and ChartMill's page that discusses the book refused the fetch (HTTP 403). The 2013 reader
notes in 3.5 agree with them in substance, not word for word. Do not put these words in a lesson as Minervini's until
someone checks them against a copy of the book.
- Same pattern: "Rounding out our discussion here is the power play, also referred to as the high tight flag."
- Pole: "An explosive price move on huge volume that propels the stock price up 100 percent or more within eight weeks."
- Where it starts: "Stocks that have already made a huge gain coming off a late-stage base usually don't qualify. The
  best power plays are stocks that were quiet in Stage 1 and then suddenly explode."
- Flag depth: "the stock price moves sideways in a relatively tight range, not correcting more than 20 percent (some
  lower-priced stocks can correct as much as 25 percent)". "Lower-priced" is not defined.
- Flag time: "over a period of three to six weeks (some can emerge after only 10 or 12 days)".
- Weekly closes: "With a power play, you should look for tight weekly closes over three to six weeks."
- The 10% waiver: "If the correction in the base, from high to low, does not exceed 10 percent, it is not necessary to see
  price tightening in the form of a volatility contraction, because the price is already tight enough."
- Fundamentals optional: "Therefore, this is the type of situation I will enter even with a dearth of fundamentals." But
  supply must still dry up: "Even the power play must go through a proper digestion of supply and demand."
- Catalyst: the repo file records that he names "a major news development such as an FDA drug approval, litigation
  resolution, a new product or service announcement, or even an earnings report", and that "it can also occur on no
  news at all".
- Trigger, stop, target: not given in the recorded passages for this setup. His general pivot and volume rules apply.

### 3.5 Minervini, *Trade Like a Stock Market Wizard* (2013), through a reader's notes

https://whatheheckaboom.wordpress.com/2014/05/04/book-review-of-trade-like-a-stock-market-wizard-by-mark-minervini/
(a personal blog's book notes, 2014-05-04; may be paraphrase, low reliability)
- "An explosive price move commences on huge volume that shoots the stock price up 100% or more in less than 8 weeks.
  This generally occurs after a period of relative dormancy."
- "not correcting more than 20 to 25% over a period of 3 to 6 weeks (some can emerge after only 12 days)."
- "There is very tight price action that doesn't correct the stock more than 10%, or the stock must display VCP
  characteristics."
- "This is also referred to as a high tight flag."
- "This is the only situation I will enter with a dearth of fundamentals."

### 3.6 Thomas Bulkowski (thepatternsite.com)

**AI notice.** His pages carry: "This website, in whole or in part, shall not be used to train artificial
intelligence (AI) systems, technologies, large language models, or similar systems, including use to create works of a
similar style." I read and cite it here with links and short quotes only. (The notice is on every page I read; the
newest archived copy of HTFStudy.html, 2025-09-05, does not show it, but the live page does, checked through a fetch
tool.) The live site refused the command-line client (HTTP 406), so I read Internet Archive copies (dates in section 11)
and checked the main and study pages live through a fetch tool.

https://thepatternsite.com/htf.html ("Statistics updated on 8/26/2020")
- Pole: "Price must rise at least 90% (shoot for a double) in 2 months or less."
- Shape: "It usually doesn't look like a flag or pennant, just a pause in the price rise."
- Volume: "Recedes for best performance"
- Confirmation: "The pattern confirms as valid when price closes above the highest peak in the pattern, which is usually
  the flagpole top."
- Entry: "New research says high and tight flags fail too often when using a flag trendline break. Instead, place a buy
  stop above the highest high in the chart pattern." The same table cell also says "Only buy when price closes above the
  highest peak in the chart pattern (including the flagpole)." So the page gives both a close and an intraday buy stop.
- Tight beats loose: "Trade tight flags, not loose ones." "A loose flag is one in which price meanders, pokes outside the
  trendline boundary, contains white space, or looks jagged."
- Pole slope: "Price trends of 45 degrees or so in the flagpole mean a better post breakout rise than ones that go nearly
  vertical leading to the flag."
- Flag slope: "Flags with a down-sloping top trendline tend to outperform."
- Target (measure rule): from the start to the end of the pole, "take half of it. Add it to the bottom of the flag (C) to
  get the target (D)."
- Exit on steep moves: "For steep price trends, use a volatility stop and draw a trendline beneath price. If price
  closes below the trendline, then consider selling."

https://thepatternsite.com/HTFExample.html
- "Avoid V-shaped patterns, in which price drops dramatically leading to the start of the high and tight flag."
- "High and tight flags springing from flat bases or rectangles work better."
- "Check other stocks in the same industry. If they are moving up, you stand a better chance of having a good gain."
- "Predict the market direction. If the market is rising, then good. If the market looks about to drop, then avoid the
  trade."
- "A tight flag means lots of overlap between price bars, a horizontal price movement, not one that meanders all over the
  place."
- Length: "You might consider avoiding those with loose looking flags or flags that are too long (over 5 weeks)."
- "Do not use a trendline break of the flag portion as the buy signal because too many of these patterns will show price
  failing to move higher even after a trendline break."
- "After the breakout, be conservative and look at a 50% move up, but be careful. These rockets go up fast and can return
  to earth just as quickly."
- Entry price in his Vertex example: "If you bought at a penny above the top of the flag, that would have put you into the
  trade at 28.67." Before that: "wait for price to close above the top of the pattern."
- The book's figure, with a caution: "Do not expect that your high and tight flag will rise by 69%, either. Use the number
  only as a comparison with other patterns from the book."
- Bear markets: "During the bear market of 2008, I saw dozens of high and tight flags appear after very strong downtrends
  like the one experienced by Vertex." He says the rise after them, if any, was meager.

https://thepatternsite.com/FlagDay.html
- "A high and tight flag is often not a flag at all." "It's just a region where price decided to pause in its move
  upward." "Volume recedes most often in the flag portion of the chart pattern."
- On the pole's size: "Sometimes it will rise by 115% or 130%, but most times you'll see price pause near the doubling
  price."

*Stocks & Commodities* V.27:12 (38-42), December 2009, "Highs & Tight Flags" by Thomas Bulkowski, from the publisher's
store page (https://store.traders.com/stcov273hiti.html), which prints the opening paragraphs only:
- "The high & tight flag was popularized by William O'Neil in his book, How To Make Money In Stocks."
- "We agree that a substantial price rise should occur quickly: a move of at least 90% (nearly a double) within about two
  months." His example pole: "a 103% move in 42 trading days, which is also the maximum time I allow."
- "The flag portion of the high and tight flag (Htf) need not look like a flag at all."
- "New research indicates that this chart pattern may not live up to expectations."

https://thepatternsite.com/Stoplocate.html (stop)
- "Use the bottom of the congestion area formed in the flag phase of the chart pattern as the stop price."

### 3.7 Kristjan Kullamagi (Qullamaggie), the broader breakout

"3 TIMELESS setups that have made me TENS OF MILLIONS!", 2021-01-08.
https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
- Pole: "A big move higher sometime in the past 1-3 months. This move can be anywhere from 30-100%+ and usually lasts a
  few days to a few weeks."
- Flag: "An orderly pullback and consolidation with higher lows and tightening range in the consolidation phase." The
  consolidation "is usually 2 weeks to 2 months"; "During the consolidation the stock price "surfs" the rising 10- and
  20-day."
- Entry: "Enter on the opening range highs." (the high of the first 1-minute, 5-minute or 60-minute bar).
- Stop: "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock"
- Sell: "You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop to break even." "The rest of
  the position should be trailed with the 10- or the 20-day moving average." "If a beginner stick to the 10-day. You
  wait for the first CLOSE below the 10- day."
- Size: "Most of my positions are 10-20% of account size." "My risk on most trades is usually 0.25-1%."
- Name: "on the daily it can be called a hight tight flags sometimes."

### 3.8 Deepvue (a charting vendor), "High Tight Flag: 6 Signs To Identify Stocks About To Double"

https://deepvue.com/screener/high-tight-flag/ (last updated 2023-08-24)
- "A 100% move in under eight weeks: The stock must double its value in a short period."
- "A correction of less than 25% in under five weeks"; the flag "should last between five trading sessions and three
  weeks."
- Volume declines in the flag; a high-volume breakout.
- Offers an early "cheat" entry: "You can enter early by buying the stock when it breaks above the Downward Trend Line
  within the flag." (Bulkowski says this fails too often.)
- Its own example breaks its own depth rule: PTON, "The 27% deep base lasted just under three weeks."
- Independence note: UCT has a Deepvue partnership (Sunday Scans, 2026-03-22: "ALL Uncharted Territory Members will get
  One FREE month of Deepvue Access!"). The same post thanks "the Deepvue and TraderLion team". Weigh both as friendly
  vendors, not neutral sources.

### 3.8a TraderLion (an educator), "What Is The High Tight Flag Chart Pattern?"

https://traderlion.com/technical-analysis/high-tight-flag-pattern/ (byline "TraderLion", published 2020-01-10, modified
2025-02-03; the live site refused the client, HTTP 403, so I read the Internet Archive copy of 2025-05-16)
- "This rare bull pattern forms after a stock gains 100% or more in only 4 to 8 weeks and consolidates while pulling back
  less than 25% over the course of the following 3 to 5 weeks."
- Its checklist: "The base depth is 10-25%"; "Buy point is the high of the flag plus 10 cents".
- "The flags that have a downward slope generally outperform those that don't". No statistic is given for that.
- It calls the pattern "a high probability trade" and gives no number; Bulkowski's measured figures (section 4) say
  otherwise.

### 3.9 Comparison table

| Source | Pole size | Pole time | Flag depth | Flag length | Volume in flag | Tightness | Trigger / entry | Stop | Target |
|---|---|---|---|---|---|---|---|---|---|
| IBD 2014 | 100% to 120% | 4 to 8 weeks | usually 10% to 20%, sometimes 25% | 3 to 5 weeks | dries up | can be "wide and loose"; closes tight | clears the pole peak, volume 40%+ above average | none named (8% rule in 2015 example) | none |
| IBD 2015 | 100% to 120% | 4 to 8 weeks | 10% to 25% | 3 to 5 weeks | not stated | "tight sideways trading" (Mar 2015) | buy point (not defined in text read) | 8% sell rule (example) | none; "200% or more" (O'Neil quote) |
| IBD 2007 (via Stockbee) | 100% to 120% | 4 to 8 weeks | no more than 10% to 20% | 3 to 5 weeks | not in the quoted part | not in the quoted part | flag peak plus 10 cents | none | 200% (claim) |
| Kuhn 1996 (store-page opening) | about 100% to 120%, "less in some cases" | 4 to 8 weeks | no more than 10% to 20% of the advance (pole height) | 3 to 6 weeks | not readable | "tight, sideways" | not readable | not readable | "another 100% or more" (claim) |
| TraderLion (2020, archived 2025) | 100% or more | 4 to 8 weeks | 10% to 25% | 3 to 5 weeks | not stated | down-sloping flags do better | flag high plus 10 cents, above-average volume | not stated | not stated |
| Bulkowski | at least 90%, aim for a double | 2 months or less (42 trading days at most, 2009) | not limited; best 10% to 34% | best 10 to 29 calendar days; avoid over 5 weeks | recedes | tight beats loose | close above the highest peak; buy stop above the highest high (a penny over, Vertex); never a trendline break | bottom of the flag | half the pole added to the flag bottom |
| Minervini 2017 (repo corpus, unverified) | 100% or more, on huge volume | within 8 weeks | 20% max (25% lower-priced) | 3 to 6 weeks, some 10 to 12 days | supply must dry up | tight weekly closes; 10% waiver | pivot (general rule) | general rules | none |
| Minervini 2013 (reader notes) | 100% or more | under 8 weeks | 20% to 25% | 3 to 6 weeks, some 12 days | not stated | 10% or VCP | not stated | not stated | none |
| Bonde scan 2007 | highest close of 40 days at least 2x the close 40 days ago | 40 days | guidelines only | guidelines only | guidelines | not coded | IBD's +10 cents | not stated | none |
| Bonde KOD 2019 ("Ants") | "established momentum" | not stated | tiny (7 tight days) | 7 days | not stated | "very tight and orderly" | market on open | 40 cents (0.62%) | sold 90% in minutes |
| Qullamaggie (broader breakout) | 30% to 100%+ | days to weeks, within 1 to 3 months | not stated | 2 weeks to 2 months | not stated | tightening range, higher lows | opening range high | day's low, no wider than ADR | sell 1/3 to 1/2 after 3 to 5 days; trail 10/20-day |
| Deepvue | 100% | under 8 weeks | under 25% | 5 sessions to 3 weeks | declines | tight, low volatility | break of the high, or a trendline "cheat" | not stated | not stated |

### 3.10 Where the sources disagree

1. **Pole size.** 90% (Bulkowski) against 100% (IBD, Minervini, Deepvue, TraderLion, Bonde's scan). IBD's own Taser
   example was a 98% pole, and Kuhn writes "approximately 100% to 120% ... less in some cases", so neither treats 100% as
   a hard floor.
2. **Pole ceiling.** IBD writes "100% to 120%". Minervini writes "100 percent or more". IBD's own examples (JDSU 136%,
   Taser's second flag after a 150%+ rise) go past 120%, so 120% reads as typical, not a cap.
3. **Flag depth.** 10% to 20% (IBD 2007), 10% to 20% or sometimes 25% (IBD 2014), 10% to 25% (IBD 2015), 20% or 25% for
   lower-priced stocks (Minervini 2017), 20% to 25% (2013 notes), under 25% (Deepvue), 10% to 25% (TraderLion).
   Bulkowski sets no limit and his data favour 10% to 34%. IBD and TraderLion set a 10% minimum; Minervini's 10% waiver
   shows he accepts shallower flags. Kuhn alone measures the depth on the pole ("10% to 20% of the advance"), which is
   what our main scanner does (section 5.1); all the others give a percent of price.
4. **Flag length.** 3 to 5 weeks (IBD) against 3 to 6 weeks (Kuhn, Minervini), 10 to 12 days at the short end
   (Minervini), 5 sessions to 3 weeks (Deepvue), "a few days to several weeks" (Bulkowski's quiz page) and 3 to 4 days
   (TSDR, section 6).
5. **Tight or not.** Bulkowski ("Trade tight flags, not loose ones") and Minervini ask for a tight flag, though Bulkowski
   also says the flag "need not look like a flag at all". IBD (2014) says the flag can be "wide and loose" and only looks
   tight next to the pole, with the weekly closes tight.
6. **Buy point.** IBD 2007, Stockbee's O'Neil notes and TraderLion add 10 cents. IBD 2014 says only "clears the peak of
   the flagpole". Bulkowski uses a buy stop above the highest high (a penny over in his Vertex example), and confirms on
   a close above it. Deepvue allows an earlier trendline break; Bulkowski says that fails too often.
7. **Breakout volume.** IBD: at least 40% above average. Bulkowski: no rule. Our scanner's lesson text: 2x the 20-day
   average (no source).
8. **Fundamentals.** Bonde wants earnings and a first base. IBD's examples are earnings stories (Taser). Minervini will buy
   it without fundamentals.
9. **Stop.** Flag bottom (Bulkowski). The 8% rule (IBD's example). Day's low, no wider than ADR (Qullamaggie). A 40-cent
   stop at the open (Bonde's KOD).
10. **Target.** Half the pole from the flag bottom (Bulkowski) against none (IBD, Minervini). Bulkowski also says "be
    conservative and look at a 50% move up". Kuhn's "Many stocks can rise another 100% or more" and IBD's "200% or more"
    are claims about winners, not targets. Our scanner projects the full pole from the top, with no source.
11. **How good it is.** O'Neil: "the strongest of patterns". Bulkowski, later: middle to poor, failing "more often than it
    works" on his quiz page (section 4).

---

## 4. Measured evidence

Only Thomas Bulkowski has published statistics for this pattern. IBD and Minervini publish winners only. Below, every
number names its source.

**4.1 Bulkowski, main page, bull market** (https://thepatternsite.com/htf.html, "Statistics updated on 8/26/2020")
- Overall performance rank 30 out of 39. Break-even failure rate 15%. Average rise 39%. Throwback rate 67%. Percentage
  meeting the (half-height) price target 82%. "The above numbers are based on 1,028 of perfect trades."
- His glossary (https://thepatternsite.com/glossary.html) defines these terms. Break-even failure: "A measure of the number
  of patterns that fail to rise (upward breakout) or decline (downward breakout) by at least 5%." The average rise
  "measures from the opening price the day after the breakout to the ultimate high or ultimate low." The ultimate high is
  "The highest peak before price declines by at least 20%, measured from the high to the close." A throwback: "Price
  breaks out upward, climbs, and then returns to the breakout price within 30 days."
- **Limits.** The page does not define "perfect trades"; by his glossary the rise runs from the day after the breakout to
  the ultimate high, so (my reading) these are best-case moves, not results of trades with a stop. The page does not say
  how the 1,028 patterns were found. A 67% throwback rate means two out of three came back
  to the breakout price within 30 days, which matters for a tight stop.

**4.2 Bulkowski, the book's older figures** (quoted on https://thepatternsite.com/HTFStudy.html)
- "the high and tight flag has a 69% average rise in a bull market and none of the 307 patterns that I looked at failed
  to rise at least 5% after the breakout." He now says: "It's not nearly as good as the below suggests, ranking 43 out of
  56, where 1 is the best performing." On his example page (HTFExample.html) he adds: "Do not expect that your high and
  tight flag will rise by 69%, either."
- The "85%" figure seen on vendor sites is 100% minus his 15% break-even failure rate. Example: Liberated Stock Trader
  (https://www.liberatedstocktrader.com/bull-flag-pattern/, Internet Archive copy 2025-05-22; the live page refused the
  client) says "The high-tight bull flag has a success rate of 85%" and credits "Tom Bulkowski@The PatternSite.com". A
  break-even failure rate only counts patterns that failed to rise 5%; it is not a win rate with a stop.

**4.3 Bulkowski, automated study** (https://thepatternsite.com/HTFStudy.html)
- Method: "I used 1,018 stocks from January 1, 1995 to May 13, 2009." "552 had high and tight flags, filling a
  spreadsheet with 2,588 non-overlapping patterns." "Price had to rise at least 90% (from lowest low to highest high) and
  do so in less than 42 price bars (2 calendar months)." Lowest low at least $1. "The results were not split into bull
  and bear markets." The average start price was $12.13 and the median $6.11 (his figures).
- The pole: "The median rise was 102% with the average rise being 111% (this is the height of the flagpole)". It took 36
  calendar days on average to climb at least 90% (his figure).
- Outcomes: "14% had price drop below the start of the high and tight flag (meaning they broke out downward)." "In
  searching for the ultimate high, 18% of the patterns closed below the flag low." "61% of the patterns found the
  ultimate high." "The average rise was 27% for those in categories (1) and (2) above."
- Failure: of those that broke out upward, 19% failed to climb 5%. "That gives a combined failure rate of 33%."
- Spread of gains: "22% of the patterns had gains over 45%, but just 6% more than doubled in price after the high and
  tight flag completed."
- The structural stop is wide: "using a penny below the flag low as a stop price meant taking an average 26% loss." The
  next line of the page: "For those 18% of patterns that hit the flag low on their way to the ultimate high, the loss
  averaged 10%." (He does not explain the gap between the two figures.)
- Flag shape: "What this table suggests is that high and tight flags with flags that retrace between 10% and 34% show the
  most promise. Flags that are between 10 and 29 calendar days wide also perform well." The shortest flags were weakest:
  "There were 488 patterns that had a flag width between 0 and 5 days, and they showed post breakout gains averaging
  18%." Flags that dropped only 0% to 5% averaged 17% (105 samples). He warns: "Ignore sample counts below 30 because they
  may be unreliable."
- What came before the pole: "In other words, a flat base (or nearly so) leading to the start of the high and tight flag
  is a good thing." "You should avoid trading high and tight flags with a steep drop or steep rise leading to the start of
  the high and tight flag." The steep-downtrend group averaged 22% (his table).
- **Limits.** One author; automated detection he calls "inferior to manually qualifying each pattern"; no bull/bear split;
  stocks from $1 up, median $6.11, so many are far below our $10 floor (B23); gains are best-later-high, not trades.

**4.4 Bulkowski, by decade** (https://thepatternsite.com/TimePerformance.html, "Statistics from 7/25/2019. Revised
8/25/2020.") Up breakouts, bull market, "Flags, high and tight": average rise 43% (1990s), 37% (2000s), 34% (2010s);
median rise 22%, 27%, 17%; rank 43 of 56 patterns in the 2010s.

**4.5 Bulkowski, opinion** (https://thepatternsite.com/QHTF.html, quiz page). "HTFs are ranked 38 now, where 1 is the
best performing." And: "this chart pattern fails more often than it works and when it works, you'll likely see price
climb 10% to 15% and then die." His *Stocks & Commodities* abstract (2009): "New research indicates that this chart
pattern may not live up to expectations." Note his own pages give three different ranks (30 of 39, 38, 43 of 56). They
come from different tables and dates; the decade page warns: "Because the rank and performance shown in the table only
applies to the associated decade, the results will differ from other pages on this website."

**4.6 IBD.** No statistic. "Many fail." Winners: Taser (two flags, "more than 1,300%" for both rides, an anecdote), JDSU
(+124%). Losers named: JinkoSolar 2010, NQ Mobile 2013 (collapsed 57% in a week), American Dairy 2009 (came within a dime
of the buy point, then dropped 55% in two weeks). All n=1.

**4.7 Stockbee.** A reader's quick 2007 test (January to July 2007, about two dozen hits, stocks over $5) found it "a
good short scan". Tiny, one market period, untested rules. Bonde's answer is that context (earnings, first base, early in
the move) decides.

**4.8 Minervini.** No published statistics for the Power Play found. The repo's research file records one illustration
(Pharmacyclics, 2010), n=1.

**4.9 Our own measurements (in the repo).**
- Rarity: the Minervini Power Play structure in `api/services/screener/base_catalog.py` matched 5 of 3,707 symbols
  (0.13%); its IBD HTF structure lists coverage 0.08%; the pattern engine's `high_tight_flag` fired on 8 symbols over the
  same universe (all from code comments).
- Agreement: over 744 tickers on 2026-08-31, the base catalog's HTF and the pattern engine's HTF agreed on 0 symbols
  (engine-only 2). (Comment in `high_tight_flag.py`.)
- The internal flag rule `uct_flag_htf` (a 40%+ pole, not only HTFs) was judged on two blind packets of 25 fires each:
  19 yes / 4 no and 16 yes / 5 no, pooled 79.5% of decided calls (Wilson 95% interval 65 to 89; its docstring). That
  measures whether reviewers agreed it was a flag, not whether it made money.
- Its outcome replay (2026-10-24, against a matched plain 20-day-high breakout in the same stock, per
  `tests/test_negative_outcome_withheld.py`) was NEGATIVE, and it is withheld from members (`registry.py`,
  `SETUP_TAG_MEMBER_WITHHELD`). I did not find the numbers for that replay in the repo.
- The 86 Study bank drafts named "High tight flag" (`docs/study/bank/chart.bases.json`, all draft) come from breakouts
  that "held over 20 sessions" (`scripts/study/bank_v2/scan_bases.py`), so their outcomes are chosen to work and are not
  evidence. Their shape (recounted in the check from each draft's `reveal_json.facts`): median pole 107% (range 90% to
  234%), median flag 14.1% deep (4.4% to 24.7%; 13.5% if read from the rounded figure in Chart IQ's note), median 11
  sessions (2 to 30); 3 of 86 sat below the 200-day.

**What the evidence says, plainly.** It is rare. When measured honestly it is not the best pattern; the average gain is
moderate and a third fail. The flag-low stop is far away (26% on average in Bulkowski's study). Shallow, very short flags
did worst in his data, and V-shaped poles after a crash and bear markets hurt it. Nothing measured supports the "100%+
in 8 to 12 weeks" promise in our scanner's lesson text.

---

## 5. Our app

### 5.1 `api/services/pattern_engine/detectors/uct/high_tight_flag.py` (pattern id `high_tight_flag`, read by Compass through `pattern_detections`)

What the code tests, in order:
1. Liquidity floor: last price at least $2 and average dollar volume at least $10,000 over 20 bars
   (`primitives/liquidity.py`).
2. Pole top: a swing-high pivot (higher than 3 bars on each side), one of the last 10, between 3 and 25 bars before the
   last bar.
3. Pole base: the lowest swing low in the 40 bars before the top (or the lowest low if none). The pole must be at least
   90% (top over base) and 3 to 40 bars long.
4. Flag: every bar after the top up to the last bar, 3 to 25 bars.
5. Depth: (pole top minus flag low) / pole HEIGHT at most 25%. Flag range (flag high minus flag low) at most 40% of pole
   height.
6. Volume: flag average volume at most 60% of the pole's average.
7. "Already broken" check: drop it if 3 or more closes are above 1.02 x the flag high.
8. Score: 0.40 geometry + 0.25 volume + 0.20 context (Stage 2, stacked averages, RS trend, accumulation, CAN SLIM grade) +
   0.15 x 50; must reach 50.
9. Levels: entry = flag high x 1.001; condition "close > entry on volume > 2x 20-bar avg"; stop = flag low x 0.985; target
   1 = pole top + pole height; target 2 = pole top + 2 x pole height.

Where it disagrees with the sources or looks wrong:
- **The "already broken" check can never fire.** The flag high is the highest high of all bars after the top, so no close
  can be 2% above it. A stock that breaks out keeps being reported as a "ready" HTF, and the pivot moves up with price,
  until the flag range passes 40% of the pole or 25 bars pass. (My reading of lines 210-296.)
- **Depth is measured against the pole's height, not price.** 25% of the height equals 11.8% of price for a 90% pole,
  12.5% for 100%, 15% for 150%, 16.7% for 200% (my arithmetic: 0.25 x g / (1 + g)). That is much stricter than IBD's 25%
  or Minervini's 20%, so flags like Taser's (24%) and JDSU's (23%) are rejected. One source measures this way: Kuhn
  (1996), "no more than 10% to 20% of the advance" (section 3.3); our 25% is looser than his 20%.
- **No minimum depth.** IBD says 10% to 25%; the scanner accepts 0%. Bulkowski's data show the shallowest flags did worst.
- **Flag length 3 to 25 bars** is shorter at the low end than IBD (15 bars) and Minervini (10 to 12 days), and shorter at
  the top than Minervini's 6 weeks.
- **The 60% volume gate and the 2x breakout volume** are ours. IBD's breakout number is 40% above average.
- **Entry on a daily close** conflicts with the house market-order entry (E57). The owner ruled on the Kicker: "The entry
  is supposed to trigger OVER previous day high not at mkt close!"
- **Stop at the flag low minus 1.5%** is 9% to 14% under the entry for a 100% pole whose flag gives back 15% to 25% of the
  pole (my arithmetic; shallower flags give closer stops). The house stop is a few cents under the day's low or the prior
  day's low, usually within about 3% (A3, F62, A13).
- **Targets are unsourced.** Bulkowski's measure rule is half the pole, added to the flag bottom. Our target 1 is the
  full pole added to the top, more than twice as far from the entry.
- **The $2 floor** is far under the house $10 and $20 million a day (B23).
- **No 200-day, market or earnings gate** (B26, B18, B22).
- **The lesson text makes claims I could not source or that the sources contradict:**
  - "popularized by Pradeep Bonde of Stockbee" (the lesson text) and "refined and popularized by Pradeep Bonde" (the
    module docstring): Bonde quoted IBD and built a scan; I found no refinement. Bulkowski credits O'Neil's book with
    popularizing it. Minervini, who named the "Power Play", is not credited.
  - The lesson says the target is the "pole height ... projected from flag high"; the code adds it to the pole top
    (`target_primary = pole_top_price + pole_height`). The two differ when the flag makes a higher high.
  - "the next 8-12 weeks frequently produce 100%+ extensions": Bulkowski's automated study found 6% more than doubled.
  - "the most aggressive HTF practitioners (Bonde) teach a 2x pole projection": not found on Stockbee.
  - Kullamagi "sizes setups like this 5-25% of account (most around 10-15%)": his page says "Most of my positions are
    10-20% of account size" and no more than 30% overnight.
  - "HTFs frequently retest the flag region once before extending": partly supported (Bulkowski's 67% throwback rate).

### 5.2 `api/services/pattern_engine/detectors/uct/uct_flag_htf.py` (pattern id `uct_flag_htf`, admin only)

A general flag rule, ported from the offline lab. At session i:
- Pole high = highest high of the 26 sessions ending at the flag session; at least 2 flag sessions after it.
- Pole low = lowest low of the 40 sessions before the pole high. Gain at least 40%. A gain of 90% or more only adds the
  label "_htf".
- Depth = (pole high minus flag low) / (pole high minus pole low) at most 62%.
- Close at or above a rising 21-day EMA (rising vs 5 sessions back).
- "Breakout": close above the prior 10-day high, no more than 2 ATR past it. "Forming": close within 1 ATR of the 10-day
  high.
- Guard: not when the close is under a falling 200-day SMA; not when a 10%+ opening gap in the last 60 sessions is
  followed by a pinned 10-day range of 3% or less.
- Liquidity floor as above; needs 222 bars.
- Levels: entry = the 10-day high (forming) or the close (breakout); stop = the flag low; targets 2R and 3R.

Notes: it is a flag rule, not an HTF rule (40% pole; depth up to 62% of the pole, about 29% of price for a 90% pole). Its
200-day guard is weaker than house rule B26 (B26 bars any long under the 200-day, falling or not). It is withheld from
members after a negative outcome replay (section 4.9). Targets at 2R and 3R predate the house 3R / 5R trims (B19, E51).

### 5.3 Three more engines that also name it

- `api/services/screener/base_catalog.py`, **"Power Play"** (Minervini's figures): close-to-close gain of 100% from the
  close exactly 40 sessions before the high; consolidation 10 to 30 sessions from the highest high; depth at most 20% of
  price. No volume test. Its comment records the 25% lower-priced allowance as unusable ("lower-priced" is undefined).
- `base_catalog.py`, **"High Tight Flag"** (IBD figures): pole from a confirmed swing low, gain 100% to 120%, 20 to 40
  bars; flag 15 to 25 bars, 10% to 25% deep; flag average volume below the pole's; pivot = the pole high. Two problems:
  the 120% cap rejects IBD's own JDSU (136%) and Taser's second flag; and its comment says the 10-cent buy point "comes
  only from a third-party summary", but IBD's 2007 column says "plus 10 cents" (as quoted by Bonde).
- `api/services/chart_iq/engine/v3_bases.py`, **"High tight flag"**: a pole of 90% or more against the lowest low of the
  40 bars before the base, depth at most 25%, base at most 30 bars. This is the rule the 86 Study bank drafts teach:
  "a pole of 90% or more in the 40 sessions before the base, then a flag no more than 25% deep and no longer than 30
  sessions."
- `api/services/pattern_engine/tag_textbook.py` holds the textbook check for the `uct_flag_htf` tag (`flag`, mapped to
  that tag id): an uptrend; a pole of 20% or more off the low of the 20 bars before its top, the top 5 to 20 bars before
  the marked bar; a pause at most 12% deep and at most half the pole; no close in the pause under the 21-day EMA, which
  must be rising; pause volume under the average of the pole's last 11 bars; the marked bar an up day closing at or
  above the pause's high. A plain flag check, not an HTF rule.

### 5.4 Model Book card, journal tags, plans

- **Model Book** (`app/src/pages/modelbook/setupCatalog.js`): there is **no High Tight Flag card**. The nearest is "Bull
  Flag": "A sharp advance (the flagpole) followed by a brief, orderly pullback on lighter volume, then a breakout that
  resumes the trend." No size is given for the pole.
- **Journal tags** (`app/src/constants/setupGroups.js`): "High Tight Flag (Powerplay)" is the first Swing setup, beside
  "Classic Flag/Pullback". `app/src/pages/journal-2-0/lib/setupTagMap.js` files it under "Bases & Breakouts" and maps the
  `high_tight_flag` scanner to it.
- **Vocabulary** (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`): its row for the journal tag "High Tight Flag
  (Powerplay)" says "no vocabulary entry; a high tight flag is not the authors' Flag". The vocabulary's definitions were
  located in two "Session 0" Sunday Scans samples (its `definition_locator` fields name /p/sunday-scans-d40 and
  /p/sunday-scans-fcd), a small sample; section 6 shows UCT writers use "HTF" often.
- **The coach** (`app/src/agent/coach/brain.js`) has three separate Brain templates named "HTF", "Power Play" and "Tight
  Flag", and treats the words "high tight flag" as ambiguous between "HTF" and "Tight Flag".
- **TRADE_PLANS.md** has no HTF row. There is no HTF levels dossier in `docs/study/levels/dossiers/`.
- **UCT videos** listed in `api/services/education_seed.py`: "Moonlight with Motivational Manrav" (chapter "44:40-
  Recognizing a "high tight flag"") and "Q & A With 1ChartMaster" (HTF among the patterns discussed). I did not watch
  them.

---

## 6. UCT's own words

Read: all 103 posts in https://unchartedterritoryy.substack.com/sitemap.xml (2026-11-09), searched for "high tight flag",
"tight flag", "HTF", "power play" and "powerplay". 47 lines matched (recounted in the check: 47); none defines the
setup. "TSDR" is the owner (the 2026-10-25 and 2026-11-01 posts head his section "Patrick (TSDR)'s Weekly Outlook &
Watchlist"). Bracco's "The Parabolic Short" (2025-06-13) does not discuss flag patterns (the word appears once, as a
verb). Each quote names its post, date and section. The check re-read every post quoted below: every quote matched word
for word, and every name, ticker and date matched its post section.

**TSDR (the owner)**
- CLS, 2025-06-08 (https://unchartedterritoryy.substack.com/p/sunday-scans): "Would prefer 20 ema shakeout but cant deny
  this tight flag, $122.40 trigger."
- AAOI, 2025-06-29 (/p/sunday-scans-d70): "Strong move out of this base on high volume. Made a 65% in 7 sessions. If we
  get a tight flag this is a priority."
- TAN (an ETF), 2025-07-20 (/p/sunday-scans-c82): "High Tight Flag here after reclaiming the 200SMA for the first time in
  a year and really the first sustainable remount since late 2022."
- ENVX, 2025-07-27 (/p/sunday-scans-63b): "This made a 100% move higher and now bulding out a tight flag. Dips under $14
  are being bought."
- WULF, 2025-09-14 (/p/sunday-scans-461): "Held the HVC (High Volume Close) for multiple sessions and build a perfect high
  tight flag." Then: "Nothing to do but let 20EMA guide the position."
- GLXY, 2025-09-21 (/p/sunday-scans-88a): "This is where some clean and clear higher low flags can really work smoothly.
  On watch for HTF (High Tight Flag) until further notice."
- DAVE, 2025-10-29 (/p/the-rest-of-the-week-757, "TSDR Trading"): "If this builds a min of 3-4 days HTF I will get in
  with a high target that I do not want to mention because of it's absurdity."
- APLD, 2025-11-02 (/p/sunday-scans-b99): "HTF, a little wicky up here lately, so need to see if it's going to have a
  strong close soon."
- WGS, 2025-11-05 (/p/the-rest-of-the-week-9c9): "The weekly is also coming out of a 2.5 month high tight flag following
  a 120% move since June."
- PUMP, 2025-11-12 (/p/the-rest-of-the-week-045): "Simple HTF on daily with the HVE (Highest Volume Ever) close at
  $11.08. Over that is a long to $14 and $16."
- CIEN, 2025-11-26 (/p/the-rest-of-the-week-22a): "Incredible move from $95 to $215 and now forming a tight flag following
  a hold of the 50SMA."
- LAC, 2026-01-25 (/p/sunday-scans-7fb): "Tight flag just below the $6.01 High Volume Close." (a sub-$10 stock)
- LXU, 2026-03-22 (/p/sunday-scans-cab): "If this can give a nice tight flag that let's the MAs catch up I will be very
  excited."
- DOCN, 2026-04-01 (/p/the-rest-of-the-week-13b): "Now we have a proper HTF to work with."
- 2026-04-19 (/p/sunday-scans-33a): TER, "considered adding Thursday and Friday on the HTF"; TH, "Very clean and tight high
  tight flag here."; CLS, "Main watch for HTF. I knew I should have chased."
- SEDG, 2026-05-24 (/p/sunday-scans-ffb): "Any nice tight flag I will slap."
- Unsigned post introduction, 2026-03-22 (/p/sunday-scans-cab), on traders "unwilling to trade SNDK high tight flag at
  $230 because it was extended".

**Bracco**
- ETHA, 2025-08-10 (/p/sunday-scans-f6f): "I let fear get in the way of a clean breakout of a high tight flag in a 5-star
  base on one of the hottest assets out there at the moment."
- XLV (an ETF), 2025-11-23 (/p/sunday-scans-56d, "Market Health Tracker"): "This HTF (High Tight Flag) this week is
  momentum and a classic continuation pattern for leaders."
- XNDU, 2026-04-26 (/p/sunday-scans-f2d): "Momentum name that made a 500% move in 5 days trying to form a HTF."
- XNDU, 2026-05-03 (/p/sunday-scans-bcc): "Bought this on the ORB highs on Friday as a pure momentum play. 400% move in 5
  days and built out a perfect high tight flag. Would be willing to sell aggressively into a big multi-day burst."
- PURR, 2026-09-20 (/p/sunday-scans-bc2): "I was able to get PURR out of this classic high tight flag on Thursday".

**ChartMaster and Manrav** (The Rest of the Week, 2025-10-29, /p/the-rest-of-the-week-757)
- ChartMaster, CLPT: "HTF testing resistance. HVE on the gap up and weekly candle. After a 175% move up and a 25%
  corrrection setting up for the next leg higher."
- Manrav, CLPT: "Watch for a push above 27.3 to get long with low of the day as your stop. The weekly is a potential high
  tight flag."
- ChartMaster, AXGN, 2026-02-04 (/p/the-rest-of-the-week-732): "HTF trying to break out of the weekly base. Has the 8
  week support."

**What UCT's words add up to** (my reading):
- UCT uses "HTF" for two things. (a) The textbook pattern after a huge move: ENVX 100%, WGS 120%, CIEN about 126%, CLPT
  175%, XNDU 400% to 500%. (b) Any tight flag near highs in a leader, including ETFs that never doubled (TAN and XLV
  above; also XHB, "Some high tight flag action" (Bracco, 2026-01-11), and IGV, "building out a clean high tight flag
  pattern" (unsigned, 2025-06-02)). The course needs to choose (question 1).
- The trigger is a level: a price ("$122.40 trigger"; "push above 27.3"), an HVC/HVE close, or the opening-range high.
- The stop is the day's low (Manrav, CLPT). The trail is the 20-day EMA (TSDR, WULF). Sell into a burst (Bracco, XNDU).
- The flag is short in practice: "a min of 3-4 days". Tightness and a strong close matter ("a little wicky", "Need that
  strong closing candle", TSDR on APLD).
- Two writers name the risk of chasing ("I knew I should have chased"; "unwilling ... because it was extended"). The
  house rules C28 and C29 decide that question now (section 7).

---

## 7. How it fits the account rulebook (sizing_rule.md section 9)

| Rule | What it means for this setup | Conflict? |
|---|---|---|
| A3, F62 stop a few cents under the day's low or the prior day's low | The default stop is the entry day's low (or the prior day's low), not the flag low. | Yes, with every outside source, whose stop is the flag bottom (Bulkowski) or 8% (IBD). |
| A13 stop usually within about 3% | Fast HTF stocks often have daily ranges wider than 3%. The flag low averaged 26% away in Bulkowski's study. | Yes. Many HTFs fail the 3% norm unless bought near the day's low or the opening range. |
| A4 the stop is the exit | Bulkowski's 67% throwback rate means many winners dip back to the breakout first. A tight stop will be hit often. | Expected cost, not a rule clash. |
| E57 market orders | Buy at market when price trades above the flag high. | Our scanner waits for a close (section 5.1). |
| C28 no chasing more than 4% past the buy point | Applies as written. A gap over the pivot by more than 4% is skipped. | No. |
| C29 skip a long more than 10% above its 10-day average | A short flag after a fast pole can leave the pivot far above the 10-day. Rough example (my arithmetic): a 10-day flag 20% deep, closes averaging 10% under the high, puts the pivot about 11% above the 10-day average. | Yes for short or deep flags. In effect C29 demands a flag long or tight enough for the 10-day to catch up, which matches TSDR's LXU note. |
| B26 no longs below the 200-day (hard) | Most HTFs are far above it. The exception: a doubling off a crash low (a V). Bulkowski says those do worst. | No conflict in spirit; B26 removes the worst kind. An HTF is not a "parabolic long" (that is a burst down, per B26). |
| B23 price $10+ and $20 million a day | Bulkowski's sample median start price was $6.11; Bonde also asks for liquidity. TSDR's LAC (under $6.01) would be excluded today. | Yes for small caps; the rule wins. |
| D42 no more than 1% of average daily volume | Thin, fast names limit size. | Sometimes. |
| C31 RS 80+ | Almost automatic after a doubling (Taser had a 98 RS). | No. |
| D40 growing sales and earnings preferred | Bonde wants earnings and a first base; Minervini does not require them. | Owner choice (question 9). |
| B22 no new buys in the 3 days before earnings | HTFs often follow an earnings gap; the next report can land within the flag or soon after. | Check the date every time. |
| B19, E51 trims a third at 3R and 5R; breakeven at 2R to 5R; F63 trim at the open on a gap past a level | Fits. Bulkowski ("be conservative and look at a 50% move up") and Bracco ("sell aggressively into a big multi-day burst") both favour taking money early. | No. |
| E52 trail the 10-day for fast movers, 21-day for steadier | An HTF is a fast mover by definition: 10-day. TSDR trailed WULF with the 20-day EMA. | Owner choice (question 8). |
| C34 sell a big part into a climax run | Fits; HTF breakouts often go vertical. | No. |
| C33 time stop: under 1R after 10 days, sell | Bulkowski: when it works it often climbs "10% to 15% and then die". | No. |
| B20 gap through the stop: first 30-minute low, out past 2R | Applies as written. These stocks gap. | No. |
| D47 shorts are long setups reversed | No source defines a mirror; see section 8. | Owner choice. |
| Owner principle 7 ("not news-driven" examples) | Many HTF poles come from news: Kuhn, "some important news event usually emerges"; Minervini, per the repo's research file (unverified), lists an FDA approval, a new product or an earnings report, but adds "it can also occur on no news at all". | Yes for the lesson examples; pick known, liquid names. |

---

## 8. Proposed rules for our course

Every line is measurable from daily bars unless it says otherwise. Percents are of price unless noted.

**What it is**
1. **Pole size.** The stock rises at least 90% from the pole's starting low to the pole high. [source consensus that a
   pole just under a double qualifies: Bulkowski's 90% floor, IBD's own 98% Taser pole, Kuhn's "less in some cases";
   IBD and Minervini quote 100%] Recommend: 90% qualifies, 100% or more is the A grade. No upper limit. [source
   consensus: IBD's JDSU (136%) and Taser second flag (150%+), Bulkowski "Sometimes it will rise by 115% or 130%";
   Minervini "100 percent or more" (unverified)]
2. **Pole time.** The rise takes 40 sessions (8 weeks) or less, measured from the lowest low of the 40 sessions ending at
   the pole high. [source consensus: IBD and Kuhn "four to eight weeks"; Bulkowski "2 months or less", lowest low to
   highest high, at most 42 trading days]
3. **Pole start.** Not a V: in the 40 sessions before the pole began, the stock did not fall more than 30% from high to
   low. [my proposal, from Bulkowski's V-shape and steep-downtrend findings, Kuhn's "well-contained base formation" and
   Minervini's "quiet in Stage 1" (unverified)]
4. **Not late.** The pole is the first or second big leg, not a third leg after an already huge run. Measure: the stock
   was not already up more than 200% in the 6 months before the pole began. [my proposal, from Minervini's late-stage
   warning and Bonde's "if a tight flag appears late in the move"]
5. **Flag depth.** From the pattern's highest high to the flag's lowest low: at most 25%. No hard minimum, but 10% to 20%
   is the A-grade zone. [source consensus for 25%: IBD 2014 and 2015, Deepvue, TraderLion; Minervini for 20%. On the
   minimum the sources split: IBD and TraderLion say 10% to 25%, Minervini's 10% waiver accepts shallower flags, and
   Bulkowski's shallowest flags (0% to 5%) did worst. My proposal: allow shallow flags, grade them lower] Measured on
   price, as nearly every source does; Kuhn alone measures on the pole.
6. **Flag length.** 5 to 30 sessions after the pole high. 10 to 25 is ideal. [my proposal: 5 from Deepvue and TSDR's "min
   of 3-4 days"; 30 from Minervini's 6 weeks and Bulkowski's "over 5 weeks"; ideal from IBD, Minervini, Bulkowski's best
   10 to 29 calendar days] Over 30 sessions it is a different base; grade it as that base.
7. **Tightness.** In the last 5 sessions before the trigger, the highest close is no more than 10% above the lowest close.
   [my proposal; the sources agree tight is better but give no number; IBD lets the daily ranges be loose if the closes
   are tight, so the test is on closes]
8. **Volume.** Flag average daily volume is below the pole's average. At most 60% of it for an A grade. [source consensus
   on direction: IBD, Bulkowski, Minervini, Deepvue; 60% is our scanner's number]
9. **Location.** At the trigger, price is above a rising 10-day and a rising 21-day EMA, and no close in the flag was
   below the 21-day EMA. [my proposal, from Qullamaggie's broader breakout ("surfs" the rising 10- and 20-day), our
   `uct_flag_htf` rule (a close at or above a rising 21-day EMA on the flag's last day) and our textbook flag check
   (`tag_textbook.flag`: no close in the pause under a rising 21-day EMA). No outside HTF source asks for this, and TSDR
   once wrote he "Would prefer 20 ema shakeout" (CLS), so the owner may prefer to allow an undercut]
   Above the 200-day SMA. [house rule B26] Above the 50-day SMA. [my proposal] Not more than 10% above the 10-day
   average. [house rule C29]
10. **Liquidity.** Price $10 or more and $20 million a day or more [house rule B23]; the position is no more than 1% of
    average daily volume [house rule D42].
11. **Leadership.** RS rating 80 or more [house rule C31]; prefer growing sales and earnings or a real catalyst [house rule
    D40; Bonde].

**The buy**
12. **Trigger.** Price trades above the highest high of the whole pattern (usually the pole top; if the flag made a higher
    high, that one). Never a break of a trendline drawn inside the flag. [originator: IBD "clears the peak of the
    flagpole"; Bulkowski's buy stop above the highest high and his trendline warning]
13. **Order.** A market order as it trades through, at least a cent over the high (as the owner ruled for the Kicker:
    "11.05 over THE previous day high"). [house rule E57; UCT] A real stop goes in at once. [house rule D41] Skip it if
    price is already more than 4% past the trigger [house rule C28] or more than 10% over the 10-day [C29], or if earnings
    are within 3 days [B22].
14. **Volume.** The breakout day should end with volume at least 40% above its 50-day average. This grades the trade; it
    is not a reason to exit, because the stop is the exit (A4). [originator: IBD "at least 40% above average" (IBD's
    column names no window; the 50-day is my proposal); my proposal to grade, not gate]

**The stop**
15. A few cents under the entry day's low, or under the prior day's low. [house rule A3, F62] Recommend: if that is more
    than one average daily range (ADR%: the 20-day average of high minus low, as a percent of price; the 20-day window
    is my proposal) below the entry, skip the trade. [Qullamaggie, for his broader breakout: stop "should not be wider
    than the ATR or ADR"; house rule A3, "if the honest stop does not fit the risk, skip the trade"]
16. The flag low is the "setup is dead" line, not the stop. [my proposal; Bulkowski's flag-low stop averaged a 26% loss]
17. A gap through the stop: the first 30-minute low is the new stop; out if that is past 2R. [house rule B20]

**Trims and trail** (house defaults; the setup does not need its own)
18. Sell a third at 3R and a third at 5R; take a trim at the open if the stock gaps past one. Stop to breakeven between 2R
    and 5R. [house rules B19, E51, F63]
19. Trail the last third: sell on a close below the 10-day average. [house rule E52; an HTF is a fast mover] Option: the
    20-day EMA for a steadier one. [UCT, TSDR on WULF]
20. Sell a big part into a climax burst. [house rule C34; UCT, Bracco on XNDU]
21. Still under 1R after 10 trading days: sell. [house rule C33]
22. No price target. For reference only: Bulkowski's measure rule (half the pole, added to the flag low) was met by 82% of
    his perfect trades. [originator, as a guide]

**What invalidates it before entry** [source consensus unless marked]
23. The flag goes deeper than 25% [source consensus, rule 5], or runs longer than 30 sessions [my proposal, rule 6].
24. A close below the flag's low. [Bulkowski: the flag bottom is the stop, and a close below the flag low ended his
    study's search; our scanner's failure line]
25. Volume in the flag runs above the pole's average (supply is coming in, not drying up). [IBD's "volume generally
    dries up"; Bulkowski's "Recedes for best performance"; Deepvue; Minervini's "digestion of supply" (unverified)]
26. The pole ended in Bracco's "parabolic burst" (house rule B26's definition: three straight up days, two overnight gap
    ups, range and volume expansion, a gap up on the climax day) and the climax day closed below its open. Treat that as
    a possible parabolic short top, not a flag. [my proposal; the burst checklist is Bracco's, "The Parabolic Short",
    2025-06-13; the close-below-open test is mine]

**The short mirror**
27. None taught for now. [my proposal] No source in this research defines a mirror. A stock cannot fall 100%, so the
    "doubling" has no clean inverse. Shorting a vertical run is already its own setup, Bracco's parabolic short (house
    rule D47), which is not an HTF mirror. If the owner wants one (D47), a draft would be: down 50% or more in 40
    sessions, below a falling 200-day (B26), a 5 to 30 session bear flag retracing at most 25% up, short below the flag
    low with the stop above the day's high. Untested.

**Best market conditions**
28. A Green market (B18, F65), with the stock's group also rising. [house rule; originator: Bulkowski's market and
    industry checks; IBD "one or two of those in a bull market"] Avoid them in a falling market. [Bulkowski on 2008]

**Common mistakes** (each from a source)
29. Buying the break of a trendline inside the flag (Bulkowski). Chasing an extended breakout (C28, C29; TSDR's notes).
    Calling any tight pause an HTF; "If you are finding too many high tight flags, there is something wrong with your
    interpretation" (Bonde). Trading a V-shaped pole off a crash (Bulkowski). Trading a late flag after a long run (Bonde,
    Minervini). Trading thin, cheap stocks (Bonde; B23). Widening the stop to the flag low without cutting size (A3, A5).
    Expecting a double: only 6% doubled in Bulkowski's study.

---

## 9. Grading: what makes an A+ and what makes a B-

The owner rules grading discretionary (E50). These are observable traits from the sources, as a guide, not a checklist.

**A+**
- Pole of 100% or more in 8 weeks or less, off a quiet, flat base (Bulkowski "a flat base (or nearly so)"; Kuhn "a
  well-contained base formation"; Minervini "quiet in Stage 1", unverified), on a real change (earnings, product,
  contract) with heavy volume (Minervini "huge volume", unverified).
- First or second base of the move (Bonde; Minervini's late-stage warning, unverified).
- Flag 10% to 20% deep, 2 to 5 weeks, closes tight week to week, a down-sloping or flat top (Bulkowski "down-sloping top
  trendline"; TraderLion; IBD's JDSU "the closes were relatively tight"; Minervini "tight weekly closes", unverified).
- Flag volume dries up to well under the pole's (60% or less).
- Price riding a rising 10-day and 21-day; not more than about 5% over the 10-day at the pivot (inside C29 with room).
- RS 90+; the group rising; a Green market (Bulkowski; IBD's Taser at 98 RS).
- Breakout volume 40%+ above average (IBD), closing strong (TSDR on APLD: "Need that strong closing candle").
- A stop under the day's low within about 3% (A13).

**B-**
- Pole only 90% to 99%, or a near-vertical spike in a few days (Bulkowski prefers about 45 degrees), or a V off a crash.
- A third flag late in a long run.
- Flag 20% to 25% deep, loose and jagged, or only 3 to 5 sessions (Bulkowski's flags 0 to 5 days wide averaged 18%, 488
  samples, against 29% to 37% for 5 to 14 days), or past 5 weeks.
- Volume not drying up.
- Pivot near the C29 limit (8% to 10% over the 10-day).
- A Yellow market, a weak group, a news-only story with no earnings.
- A breakout on light volume, or a stop under the day's low wider than 3%.

Anything that breaks a rule the rulebook states without exception (B23, B26, C28, C29, B22) is not a B-: it is a skip.

---

## 10. Questions for the owner

1. **What do we call an HTF?** (a) Only the textbook pattern: a 90%+ pole in 8 weeks, then a flag; a tight flag in a
   leader without that pole is taught as "Tight Flag" / "Classic Flag/Pullback". (b) UCT's wider use: any tight flag near
   highs after a strong move, ETFs included. Recommend (a): it keeps the Power Play rare, as every source says it is, and
   it matches the Brain's separate "HTF" and "Tight Flag" templates.
2. **Pole size.** 90% (Bulkowski; our main scanner, the flag rule's HTF label and Chart IQ) or 100% (IBD, Minervini,
   TraderLion; both base-catalog structures)? Recommend 90% to qualify, 100%+ for an A grade.
3. **Shortest flag.** 3 to 4 days (your DAVE note), 5 sessions (Deepvue), 10 sessions (Minervini's 10 to 12 days) or 15
   (IBD's 3 weeks)? Recommend 5, with 10 to 25 as ideal.
4. **Deepest flag.** 20% (Minervini) or 25% (IBD)? Recommend 25% to qualify, 20% for an A.
5. **Entry.** (a) Market order on the trade above the pattern high (default). (b) Also allow an earlier entry inside a
   very tight flag: the opening-range high (Qullamaggie) or the open after a tight day (Bonde's KOD). (c) The 30-minute
   opening-range break, as on the Kicker. Recommend (a), with (b) taught as an advanced option if you use it.
6. **When the day's low is far.** If the stop under the day's low (or the prior day's low, which A3 also allows) is wider
   than 3% or wider than the stock's ADR: (a) skip; (b) take it with a smaller size (A5 already shrinks the shares).
   Recommend (a) above one ADR, (b) between 3% and one ADR.
7. **Breakout volume.** A gate (no buy unless it is on pace for 40%+ above average) or a grade? Recommend a grade.
8. **Trail.** The 10-day (fast mover, E52) or the 20-day EMA (as you did on WULF)? Recommend the 10-day by default.
9. **Fundamentals.** Required (Bonde, IBD) or optional (Minervini)? Recommend preferred, not required (D40).
10. **Short mirror.** None, or the draft in rule 27? Recommend none until it is tested.
11. **Which scanner is ours?** Recommend fixing `high_tight_flag.py` before any lesson uses it: the dead "already broken"
    check, depth on price not pole height (only Kuhn measures on the pole; IBD, Minervini, Bulkowski, Deepvue and
    TraderLion give a percent of price), entry on the trigger not the close, the stop and targets, the $10 / $20 million
    floor, and the lesson text's unsourced claims (section 5.1). Or teach from the Chart IQ rule (the 86 drafts), with
    the house filters added.
12. **Examples.** The 86 Chart IQ drafts lean old (36 are from 1997 to 2005, 18 from the year 2000 alone) and their
    prices are split-adjusted, so the $10 test (B23) needs the price as it traded then. Your principle 7 asks for liquid,
    known, not news-driven stocks, while many HTF poles are news-driven. Keep news-driven poles if the stock is liquid and
    known?

---

## 11. Sources

All read 2026-11-09 unless noted. Reliability: **high** = the originator or the house's own text; **medium** = an
established educator or vendor, or text read second-hand; **low** = personal notes or a page I could only read in part.

**Originators and their houses**
| Source | URL / location | Publisher, author, date | Reliability |
|---|---|---|---|
| "The Base Watcher's Field Guide: Stalking The High, Tight Flag" | https://finance.yahoo.com/news/watchers-field-guide-stalking-high-223700570.html | IBD (on Yahoo Finance), no byline, 2014-08-15 | high (IBD's own column; re-read in the check from the Internet Archive copy of 2018-07-03) |
| "High, Tight Flag Is Rare Pattern That Can Deliver Incredible Gains" | https://finance.yahoo.com/news/high-tight-flag-rare-pattern-204600066.html | IBD (on Yahoo Finance), 2015-09-17 | high (re-read in the check from the Internet Archive copy of 2021-01-26) |
| *How to Make Money in Stocks*, first edition | Open Library catalogue records, e.g. https://openlibrary.org/books/OL2402212M | William J. O'Neil, McGraw-Hill, 1988 | high for the date only (the text was not read) |
| "Looking At A Great Chart Base? Make Sure To Count The Weeks" | https://finance.yahoo.com/news/looking-great-chart-sure-count-203400677.html | IBD (on Yahoo Finance), 2015-03-11 | medium (read through a fetch tool only) |
| IBD 2007 column "Rare High Tight Flag Offers Investors Opportunity For High Returns", quoted | https://stockbee.blogspot.com/2007/07/rare-high-tight-flag-offers-investors.html | Pradeep Bonde, Stockbee, 2007-07-09 | medium (IBD second-hand) / high (Bonde's own scan and comments) |
| "Patterns and context" | https://stockbee.blogspot.com/2007/07/patterns-and-context.html | Bonde, 2007-07-09 | high for Bonde's words; low for the reader's test |
| "Opportunity Buffet" (HTF scan in his daily list) | https://stockbee.blogspot.com/2007/07/opportunity-buffet.html | Bonde, 2007-07-17 | high |
| "William O'Neil Setups" | https://stockbee.blogspot.com/2011/12/william-oneil-setups.html | Bonde, 2011-12-13 | medium (a summary of O'Neil) |
| "Top 50 stocks for swing traders" | https://stockbee.blogspot.com/2013/09/top-50-stocks-for-swing-traders.html | Bonde, 2013-09-03 | high |
| "How to make money using anticipation setup : KOD" | https://stockbee.blogspot.com/2019/12/how-to-make-money-using-anticipation.html | Bonde, 2019-12-17 | high |
| *Think & Trade Like a Champion*, Section 7 "The Power Play" | book (Access Publishing, 2017); quotes from `docs/superpowers/research/bases/03-minervini-vcp-powerplay.md` and `api/services/screener/base_catalog.py` | Mark Minervini | UNVERIFIED (the originator, but neither the writer nor the cold check could open the book; the repo file read a third-party PDF copy) |
| *Trade Like a Stock Market Wizard* (2013), reader's notes | https://whatheheckaboom.wordpress.com/2014/05/04/book-review-of-trade-like-a-stock-market-wizard-by-mark-minervini/ | personal blog, 2014-05-04 | low (may be paraphrase) |
| "3 TIMELESS setups that have made me TENS OF MILLIONS!" | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Kristjan Kullamagi, 2021-01-08 (modified 2021-04-28) | high (his own site; a related, broader setup) |

**Measured statistics (Bulkowski).** All carry his AI notice (section 3.6). Read as Internet Archive copies, snapshot
dates in brackets; the live site refused the command-line client (HTTP 406).
| Page | URL | Snapshot | Reliability |
|---|---|---|---|
| Bulkowski on High and Tight Flags | https://thepatternsite.com/htf.html | 2026-01-21; re-read in the check from 2026-10-18 (numbers also checked live through a fetch tool) | high (the measurer's own figures) |
| Bulkowski's Study of High & Tight Flags | https://thepatternsite.com/HTFStudy.html | 2025-09-05 (the newest archived copy; key sentences and the AI notice also checked live through a fetch tool) | high |
| High & Tight Flag example pages | https://thepatternsite.com/HTFExample.html | 2026-10-18 | high |
| Quiz | https://thepatternsite.com/QHTF.html | 2026-10-18 | medium (captions, opinion) |
| Flags versus High, Tight Flags | https://thepatternsite.com/FlagDay.html | 2026-10-19 | high |
| Stop locations | https://thepatternsite.com/Stoplocate.html | 2026-10-19 | high |
| Performance over decades | https://thepatternsite.com/TimePerformance.html | 2026-10-18 | high |
| Glossary | https://thepatternsite.com/glossary.html | 2026-10-19 | high |
| "Highs & Tight Flags", *Stocks & Commodities* V.27:12 (38-42), December 2009 | https://store.traders.com/stcov273hiti.html | the live store page, which prints the opening paragraphs | medium (opening paragraphs only) |

**Educators and vendors**
| Source | URL | Publisher, author, date | Reliability |
|---|---|---|---|
| "The High, Tight Flag", *Stocks & Commodities* V.14:6 (248-252), June 1996 | https://store.traders.com/-v14-c06-thehigh-pdf.html | Greg Kuhn | medium (the article's opening paragraphs, as printed on the publisher's store page; the rest is paywalled) |
| "High Tight Flag: 6 Signs To Identify Stocks About To Double" | https://deepvue.com/screener/high-tight-flag/ | Deepvue, updated 2023-08-24 | medium (a vendor and a UCT partner; examples are winners) |
| "What Is The High Tight Flag Chart Pattern?" | https://traderlion.com/technical-analysis/high-tight-flag-pattern/ | TraderLion, 2020-01-10 (modified 2025-02-03); Internet Archive copy 2025-05-16 | medium (an educator thanked in UCT's posts; no statistics) |
| "Bull Flag Pattern Trading: Most Fail, But This One Wins 85%" | https://www.liberatedstocktrader.com/bull-flag-pattern/ | Liberated Stock Trader; Internet Archive copy 2025-05-22 | low (cited only to show where the "85%" comes from) |

**UCT's own**
| Source | URL | Reliability |
|---|---|---|
| Uncharted Territory Substack, 103 posts (sitemap) | https://unchartedterritoryy.substack.com/sitemap.xml; posts quoted in section 6 | high (UCT's own words; casual watchlist notes, not definitions) |
| "The Parabolic Short" (Bracco) | https://unchartedterritoryy.substack.com/p/the-parabolic-short | high (for rule 26 and B26) |
| Account rulebook | `docs/study/sizing_rule.md` section 9 | high (the owner's rules) |
| Owner principles | `docs/study/OWNER_PRINCIPLES.md` | high |
| Trade plans | `docs/study/TRADE_PLANS.md` | high (no HTF row) |
| Owner rulings | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (no HTF ruling found) | high |
| App code | `api/services/pattern_engine/detectors/uct/high_tight_flag.py`, `uct_flag_htf.py`, `uct_setups_common.py`, `registry.py`, `tag_textbook.py`; `api/services/pattern_engine/primitives/liquidity.py`, `primitives/pivots.py`; `tests/test_negative_outcome_withheld.py`; `api/services/screener/base_catalog.py`; `api/services/chart_iq/engine/v3_bases.py`; `app/src/pages/modelbook/setupCatalog.js`; `app/src/constants/setupGroups.js`; `app/src/pages/journal-2-0/lib/setupTagMap.js`; `app/src/agent/coach/brain.js`; `docs/wisdom/vocabulary/setup-vocabulary-v1.json`; `docs/study/bank/chart.bases.json`; `scripts/study/bank_v2/scan_bases.py`; `api/services/education_seed.py` | high (what the app does today) |
| Repo research corpus | `docs/superpowers/research/bases/01-bulkowski-classic-patterns.md`, `02-oneil-ibd-base-taxonomy.md`, `03-minervini-vcp-powerplay.md`, `14-base-quantification-crosssource.md` | medium (leads; every quote used here was re-checked except Minervini's) |

**Tried and not read** (no wording from these is used): investors.com (the fetch tool refused it; archived copies of its
paywalled pages were not used); traderlion.com live (HTTP 403; its HTF article was read from an archive copy, above);
chartmill.com, including its Minervini and HTF articles (HTTP 403, again in the check); technical.traders.com and
traders.com articles, including traders.com's documentation page for Bulkowski's 2009 article (HTTP 403 in the check);
Zacks and Nasdaq copies of a Zacks HTF article (bot check, timeout); O'Neil's *How to Make Money in Stocks* and
Minervini's books (no legal copy available here; Google Books search was over quota, again in the check; the Internet
Archive's copy of the 1988 edition is a restricted lending copy and its search-inside service refused the request).
StockCharts ChartSchool has no high tight flag page that I could find. Forums (Motley Fool), TradingView posts and
AI-written pattern sites turned up in searches and were not used.

---

## 12. Removed in checking

The cold check (2026-11-09) re-opened every source: the IBD columns (Internet Archive copies), all six Stockbee posts,
both *Stocks & Commodities* store pages, all eight Bulkowski pages, Qullamaggie, Deepvue, the 2013 reader notes, all 103
UCT Substack posts (47 matching lines recounted, 31 quotes checked word for word with their writer, ticker and date),
the rulebook, the owner rulings, and the app code named in section 5. Everything not listed below matched.

**Removed**
- The claim that the Kuhn store page "limits excerpts to 125 characters", and the statement that his pole size was "not
  readable". The page prints the opening paragraphs, which give the pole, flag and depth; section 3.3 now quotes them.
- Four IBD column titles and "a 2020 Tesla column", listed in 3.1 as existing on investors.com. They could not be opened
  or confirmed, so they are no longer named.
- The word "usually" in "usually 9% to 14% under the entry" (5.1) and "often" in the short version: the 9% to 14% is
  arithmetic for one pole and flag shape, not a measured frequency.
- The tag "[UCT: TSDR's 20-day EMA notes; originator-adjacent ...]" on rule 9, and "[house rule B26]" on its 50-day
  requirement: no UCT post asks that no flag close sit under the 21-day, and B26 names only the 200-day. Now tagged as
  my proposal with its real leads.

**Corrected**
- "Do not expect that your high and tight flag will rise by 69%, either." is on HTFExample.html, not HTFStudy.html (4.2).
- The "85% win rate": now traced to a named page (Liberated Stock Trader, which credits Bulkowski) instead of "appear to
  be" (4.2).
- Bonde's "Essentially yet another continuation pattern" is from his 2011 post, not 2007 (section 2); his 2007 scan was
  a "Telechart interpretation", not "TC2000 code" (3.2); the reader's test used 20-day average volume over 500,000.
- The vocabulary note "the authors did not name it in the Session 0 samples" belongs to other rows, not the HTF row
  (5.4).
- The `tag_textbook.py` flag check is the textbook gate for the `uct_flag_htf` tag, not a check on a plain "Flag" tag,
  and it does require no pause close under the 21-day EMA (5.3).
- The lesson text says "popularized"; "refined and popularized" is in the module docstring (5.1).
- A3 and F62 allow the prior day's low as the default stop too: section 7, rule 15 and question 6 now say so (question
  6's old option "use the prior day's low" was already the default).
- Question 2: two of our five engines (both base-catalog structures) use 100%, not 90%.
- The bank drafts' median flag depth is 14.1% from the depth field (13.5% only from the rounded figures in Chart IQ's
  note).
- Rule 14: IBD's "40% above average" names no averaging window; the 50-day is now marked as my proposal. Rule 15: the
  20-day ADR window is mine, and Qullamaggie's ADR stop is for his broader breakout.
- Rule 26: the climax test now uses Bracco's own burst checklist (as written into B26); the close-below-open part is
  marked as mine.
- Section 4.1: "perfect trades" is not defined on the page; the reading of it is now marked as mine.
- Snapshot dates in section 11 updated to the copies actually re-read.

**Added**
- Kuhn (1996) opening paragraphs (3.3), including his "of the advance" depth measure, the only source that measures the
  flag on the pole as our main scanner does.
- Bulkowski's 2009 *Stocks & Commodities* opening ("popularized by William O'Neil"; 90% in about two months; 42 trading
  days at most); his close-versus-buy-stop wording and trendline exit (htf.html); his penny-over entry (Vertex); his
  "115% or 130%" note (FlagDay); the 10% loss figure beside the 26% (HTFStudy); the decade page's note on ranks.
- TraderLion's HTF article (3.8a); the UCT partnership with Deepvue and the thanks to TraderLion (3.8).
- O'Neil's 1988 first edition (Open Library); Qullamaggie's beginner trail rule; Bonde's "Opportunity Buffet" post and
  his "500% plus EPS/ sales growth" remark; Minervini's "no news at all" (from the repo file, unverified).

**Still unverified (kept, flagged)**
- Every Minervini 2017 quote (3.4, and where they are reused in sections 1, 8 and 9). Kept because the repo's scanners are
  built on them and the 2013 reader notes agree in substance; not to be quoted in a lesson until checked against the
  book.
- The 2015-03-11 IBD column (no archived copy; checked through a fetch tool only).

---

## 13. Examples (from our data)

(Numbered 13 because section 12, "Removed in checking", already existed when this was added on 2026-11-09.)

**The scan's rule, in one paragraph.** Daily bars from the sandbox (3,897 names, 1984 to 2026), scanned over the 2,630
names that ever met the house liquidity rule. A trigger day is one where the high clears the highest high of the prior
30 sessions (the pattern high; rule 12), that high sits 5 to 30 sessions back (the flag; rule 6), and the pole, measured
from the lowest low of the 40 sessions ending at the pattern high, is at least +90% (rules 1 and 2). Before entry the
stock must be above its 50-day and 200-day SMAs (B26 and rule 9), price at least $10 and 50-day dollar volume at least
$20 million (B23). Checks on the structure: the 40 sessions before the pole began fell no more than 30% high to low
(rule 3); the stock was not up more than 200% in the 6 months before the pole began (rule 4); the flag's low is no
more than 25% under the pattern high (rule 5); the five closes before the trigger sit within 10% of each other (rule
7); the flag's average volume is below the pole's (rule 8); the close before the trigger is above a rising 10-day and a
rising 21-day EMA and no flag close sat below the 21-day EMA (rule 9); and the pole top was not a parabolic climax
(gap-up day closing below its open after three up days, rule 26). The buy is a market order a cent over the pattern
high, or the open if the stock gapped over it; skipped if that is more than 4% past the high (C28) or more than 10%
over the 10-day average (C29). The stop is 5 cents under the lower of the entry day's low and the prior day's low; if
that is more than one 20-day average daily range below the entry, the entry day's low alone is used, and if that is
still too wide the trade is skipped (rule 15). One hit per name per 30 sessions. The breakout-day volume is recorded
(rule 14) but does not gate the hit. The outcome walks forward 60 sessions from the day after entry with a FIXED stop
and no trims, no breakeven move and no trail, counting the first of stop, 3R, 5R; a day whose low hits the stop counts
as stopped even if its high reached a target. Code: `_study-resume/scratchpad/setups/03-high-tight-flag/htf_scan.py`
(outside the repo).

**Base rate.** 54 hits in 2,630 of 2,630 liquid names (the scan completed in 119 seconds). 16 of 54 (29.6%) reached 3R
before the stop; 12 of 54 (22.2%) reached 5R. Caveats: this is a fixed stop with no trims, so the house plan (a third at
3R, a third at 5R, breakeven between 2R and 5R, trail the rest) is not what is measured; the stop is tight (most hits
under 4% of entry, several under 1.5%), so one noisy day knocks out a trade that later worked (WDC 2026-05-26 is in the
scan as a 3.1R winner only because it reached 3R before its stop; the stock later ran far higher); 42 of the 54 hits are
from 2020 to 2026, partly because more names pass the $20 million rule recently and partly because the sandbox holds
today's tickers, so delisted names that once flagged are missing (survivorship); one hit (LABU, a leveraged ETF, a
failure) is not a stock; and the rule's 10% close tightness plus the no-close-under-the-21-EMA test reject many flags
that a human would still call an HTF, so the 54 is a strict count, not the number of HTFs in the market. Before 2020 the
rule found only 12 liquid hits in 36 years, which says the pattern is rare at our liquidity floor, as Bonde warns.

**The 10 examples.** One per ticker, all reached at least 5R on the fixed-stop walk. "Pole" is low to high in sessions;
"flag" is sessions from the pattern high to the day before the trigger, and depth is from the pattern high to the flag
low. "Vol" is flag average volume over pole average; "BO vol" is the trigger day's volume over its 50-day average. Charts
and phone sheets: `_study-resume/scratchpad/setups/03-high-tight-flag/final/` (sheet_1-4, sheet_5-7, sheet_8-10). Where an
earnings report sat inside the pole it is named (from the sandbox's Yahoo + SEC dates; SAP has none on file).

| # | Ticker | Trigger | Pole | Flag | Buy | Stop | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|
| 1 | SAP | 2000-01-25 | +98% in 30 d | 7 d, 7.9% deep, vol 0.45x, BO vol 1.08x | 64.56 | 63.83 (1.1%) | 9.3R (3R on day 1) | A dot-com-era double in six weeks, a one-week shallow flag on half the pole's volume, then a clean push. Note the tiny stop; the R is large partly because of it. No earnings date on file for the pole. |
| 2 | SRPT | 2015-06-10 | +129% in 14 d | 14 d, 15.0% deep, vol 0.66x, BO vol 1.16x | 27.50 | 26.59 (3.3%) | 10.9R (3R on day 5) | The cleanest pole in the set: a +60% day on 2015-05-20 (after the 2015-05-07 report) tops a near-vertical two-week run, then a 14-day sideways flag that holds the 21-day EMA, then a breakout that never looks back. |
| 3 | IOVA | 2019-06-28 | +129% in 27 d | 6 d, 11.3% deep, vol 0.71x, BO vol 2.9x | 23.27 | 22.75 (2.2%) | 6.4R (3R on day 1) | A biotech pole off a +36% day (2019-05-16, not an earnings day on file), a one-week flag, and the strongest breakout volume in the set (2.9x). The stop under the prior-day low held. |
| 4 | CVNA | 2019-04-01 | +101% in 25 d | 8 d, 9.0% deep, vol 0.61x, BO vol 0.73x | 11.97 | 11.43 (4.5%) | 6.3R (3R on day 18) | The pole began on the 2019-02-28 report, off a base sitting near the 200-day after a prior decline (it passes rule 3 because the fall was more than 40 sessions earlier). Low breakout volume (0.73x), so a B grade on rule 14; it still ran 23% in two months. |
| 5 | MRNA | 2020-04-15 | +99% in 30 d | 7 d, 13.1% deep, vol 0.33x, BO vol 0.97x | 35.67 | 33.10 (7.2%) | 20.0R (3R on day 2) | The pole included the 2020-02-26 report and a +28% day on 2020-02-25; the pattern high (35.66) matched the February spike high, so the breakout also cleared a two-month resistance. Flag volume a third of the pole's. The stop is 7.2% (within one ADR of a very volatile stock), wide against the house's usual 3%. |
| 6 | CRNC | 2020-12-16 | +96% in 39 d | 11 d, 13.9% deep, vol 0.95x, BO vol 1.44x | 94.93 | 91.15 (4.0%) | 11.7R (3R on day 4) | A steadier eight-week pole (the 2020-11-16 report fell inside it) with an 11-day flag riding the 10-day EMA and a breakout on 1.44x volume, IBD's "at least 40% above average" met. Flag volume barely under the pole's: a B on rule 8. |
| 7 | BIDU | 2021-02-05 | +100% in 36 d | 12 d, 13.2% deep, vol 0.68x, BO vol 0.9x | 264.95 | 255.06 (3.7%) | 9.1R (3R on day 2) | A large-cap double (no report in the pole) with a 12-day flag whose closes sit within 10% (at the limit of rule 7). Went to about 354 within three weeks, then collapsed under the flag low by late March: the 10-day trail (rule 19) is what gets a learner out. |
| 8 | TMDX | 2024-05-14 | +92% in 30 d | 5 d, 7.0% deep, vol 0.75x, BO vol 1.46x | 132.97 | 128.10 (3.7%) | 8.0R (3R on day 23) | An earnings-gap pole (+25% on 2024-05-01), the shortest flag allowed (5 sessions), breakout on 1.46x volume. The slowest of the set to 3R (23 sessions): a lesson that a valid HTF can grind. |
| 9 | SOFI | 2024-11-20 | +91% in 28 d | 7 d, 9.9% deep, vol 0.82x, BO vol 0.86x | 14.65 | 14.24 (2.8%) | 6.2R (3R on day 3) | The pole held the 2024-10-29 report; the stock gapped over the 14.44 pattern high so the fill is the open (1.5% past the high, inside the 4% chase limit). Below-average breakout volume: a B on rule 14. |
| 10 | AMD | 2026-05-22 | +144% in 40 d | 9 d, 16.2% deep, vol 0.79x, BO vol 0.89x | 469.84 | 461.66 (1.7%) | 9.4R (3R on day 1) | The biggest liquid name in the set (about $12 billion a day): an eight-week pole including the 2026-05-06 report, a nine-day flag 16% deep, a gap-over entry, 3R the next session. Shows the pattern works at mega-cap size when the pole is real. |

**Notable failures (from the same scan, in words).**
- SRRK, 2020-12-22: the biggest pole in the scan (+291% in 34 sessions) and a 6-day, 15.5% flag, but flag volume was
  13% of the pole's and the breakout day traded a tenth of its 50-day average. Stopped the next session with 0R. The
  lesson is rule 14: a breakout that nobody buys is not a breakout, even on a perfect geometry.
- NET, 2020-11-27: +113% in 40 sessions, a 14-day flag 18.7% deep, then a trigger on 0.86x volume with a 1.2% stop under
  the prior day's low. Stopped the next session for 0R. A deeper-than-ideal flag plus weak demand plus a stop tighter
  than one ordinary day's range is the usual way an HTF entry dies.
- MRVL, 2026-05-13: +107% in 33 sessions, a tight 5-day flag, breakout volume 1.21x; it reached 2.35R and was then stopped
  at the original stop. Under the house plan the stop would already have been at breakeven (B19, between 2R and 5R), so
  this fixed-stop loss is a scratch in practice; the scan's 29.6% understates the plan for this reason.
- Excluded from the examples: MGA, 2014-02-28, scored 18.5R but the sandbox's MGA series jumps from 2010-05 to 2014-02
  with no bars between, so its "pole" is a data gap, not a move. Any scan result on a name with a history gap should be
  thrown out the same way.

---

## 14. Failures and near-misses (from our data)

(Added 2026-11-10, deliverable 4 of `CRITERIA_PROGRAMME.md`. Every number is read off the sandbox's daily bars with the same scan and the same fixed-stop walk as the examples section above; charts in `_study-resume/scratchpad/setups/03-high-tight-flag/final/` (`fail_1-4.png`, `near_1-4.png`, `pair_02-bull-flag.png`), numbers in `final/failures.json` and `final/near_misses.json`, scripts `near_scan_*.py` and `failnear_*.py` in the setup's scratchpad folder, outside the repo.)

**Four failures.** Valid high tight flag setups by every gate of the card, bought by the rules and stopped before 3R (fixed stop under the day's low, no trims, no breakeven move). Dates are the trigger day; "where it stopped" counts sessions after the trigger.

| Ticker | Date | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| SRRK | 2020-12-22 | 52.01 | 49.95 (4.0%) | day 1 (2020-12-23, low 49.01), best 0.0R | The biggest pole in the scan (291% in 34 sessions) and a 6-day, 15.5% flag, but flag volume was 0.13x the pole's and the breakout day traded 0.10x its 50-day average, closing low in its range at 51.01, under the 52.00 buy point. Stopped the next session (low 49.01). | `htf.breakout_volume` |
| MRVL | 2026-05-13 | 175.81 | 168.86 (4.0%) | day 3 (2026-05-18, low 165.10), best 2.35R | A 107% pole in 33 sessions, a tight 5-day flag 10.1% deep, breakout on 1.21x volume closing high in its range. It reached 2.35R and was stopped on day 3 (low 165.10) at the original stop; under the house plan the stop would already have been at breakeven. | `htf.breakeven` |
| FSLR | 2022-08-26 | 125.50 | 120.92 (3.6%) | day 1 (2022-08-29, low 118.13), best 0.0R | A 101% pole in 40 sessions, a 9-day flag 8.8% deep on 0.74x the pole's volume. The breakout day gapped open at 125.50 over the 121.91 buy point on 1.47x volume, then closed at the low of its range (121.75), back under the buy point; the next session's low (118.13) took the stop. | `htf.strong_close` |
| MDB | 2023-06-28 | 398.90 | 386.96 (3.0%) | day 7 (2023-07-10, low 376.49), best 1.66R | A 101% pole in 39 sessions, a 15-day flag 8.5% deep on 0.92x the pole's volume, breakout on 1.48x volume closing mid-range. It reached 1.66R, stalled, and was stopped on day 7 (low 376.49). A valid flag that simply failed. | `htf.stop` |

**Four near-misses.** Charts that look like a high tight flag but fail exactly one gate of the card. Each came from re-running the setup's scan with that one gate relaxed and keeping only the hits the strict rule rejects for that criterion; everything else passed. The outcome is the same fixed-stop walk, for information only: a near-miss that worked is still not the setup.

| Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| TSLA | 2023-07-14 | `htf.pole_size` | pole +78% in 40 sessions; the rule is 90% or more | A tight 8-day, 6.7% flag on 0.78x volume, but the pole was 78% in 40 sessions. A tight flag in a leader that never doubled is a bull flag (setup 02), however tight. Best 1.88R, stopped. |
| PDD | 2020-12-08 | `htf.flag_volume` | flag volume 1.27x the pole's; the rule is below 1x | A 123% pole and a 16-day, 17.2% flag, but flag volume ran 1.27x the pole's. Supply was coming in during the rest (htf.inv_volume_rising), not drying up. Best 0.0R, stopped. |
| SE | 2019-04-26 | `htf.holds_fast_averages` | 5 flag close(s) under the 21-day EMA; the rule is none | A 99% pole and a 24-day, 12.7% flag on 0.69x volume, but five flag closes sat under the 21-day EMA. A base that lost the fast averages is a flat base or a cup, not a high tight flag. Best 1.65R, stopped. |
| TVTX | 2025-10-24 | `htf.flag_length` | flag of 32 sessions; the rule is 5 to 30 | A 91% pole in 27 sessions and a tight, 23.1%-deep rest that ran 32 sessions. Past 30 sessions it is a different base and is graded as that base (htf.inv_length). It worked (best 18.92R) as the base it was. |

**What the failures have in common.** Two died on the first session after the buy (SRRK, FSLR), and in both the breakout day had closed back under the buy point. The other two reached 1.66R and 2.35R before coming back to the original stop, where the house breakeven move between 2R and 5R would have made MRVL a scratch. Breakout volume told the SRRK story (0.10x) but not the others: FSLR and MDB broke out on 1.47x and 1.48x and still failed, so volume alone does not rescue a weak close. The data are thin: 54 hits in all, 38 stopped before 3R, and the one-gate-relaxed scans found 715 pole near-misses, 20 volume, 12 averages, 10 tightness, 1 length and none for depth (a flag deeper than 25% never passed the 10% close tightness), so the four near-misses are what the data gives.
