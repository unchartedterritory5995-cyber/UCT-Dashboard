# Setup 28: 2B Reversal (Victor Sperandeo), long and short

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote was
checked word for word, by script, against a saved copy of its source (web pages, UCT posts and repo files). Two kinds of
source could not be saved whole, and are marked where they occur: Sperandeo's books (read only through archive.org's
full-text search, which returns short passages; each quote was rebuilt from overlapping passages and checked by script
against the saved search results) and Bulkowski's site (it blocks plain downloads, so its quotes come from separate reads
with the web tool, saved as returned; the numbers were read twice and agree). Quotes keep the writer's own spelling,
typos included. Where I could not read a source, I say so and give no wording from it.

**Cold check (a second reader, 2026-11-09).** Every quote, attribution, statistic and code claim below was re-checked by
someone who did not write it: the four Sperandeo copies were searched again through archive.org's full-text search API
(`be-api.us.archive.org/fts/v1/search`, restricted to each item), Bulkowski's two pages were re-read with the web tool, the
TradingMarkets and ChartSchool pages and all 103 Substack posts were downloaded fresh and matched by script, the repo
files were re-read at the lines cited, the 4.4 and 4.5 tables were recomputed (4.5 from the bars; 4.4 from the writer's
event files, plus an independent re-implementation on 350 random tickers, 4.4), and the ten appendix rows were recomputed
from the bars. What changed is listed under "Removed in checking" at the end. The biggest correction: Sperandeo does give a
time window for the failure (section 3.1); the first draft said he did not.

**Who is who in UCT quotes.** The owner is Patrick (TSDR). He writes the "TSDR’s Weekly Outlook & Watchlist" section of
the Sunday Scans. Bracco writes "Bracco’s Breakdown & Top Ideas". The intros and the "Index & ETF" sections are not
signed; I mark them *unsigned*. Dates are the Substack post dates.

**Tags used in section 8.** **[originator]** Sperandeo's own words; **[source consensus]** several outside sources agree;
**[UCT]** the owner, Bracco or a signed UCT contributor; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

**Related dossiers.** The 2B has close cousins that other dossiers cover: the Undercut & Rally (setup 29), the Oops
Reversal (setup 30, and `docs/study/levels/dossiers/oops.md`), the Wyckoff spring and upthrust (setup 35), and the
Kicker (setup 26, whose red day the owner wants to look like "an almost failed breakdown"). One ruling from the owner on
which level counts, how soon it must be reclaimed and where the stop goes could settle all of them at once (section 10,
question 1).

**The short answer.**
1. The rule is Sperandeo's and it is one sentence. In his first book (1991/1993): "In an uptrend, if a higher high is made but fails
   to carry through, and then prices drop below the previous high, then the trend is apt to reverse". The bottom is the
   mirror. He calls it "my personal favorite". He gives a stop (beyond the new extreme: "use the new high to compute your
   initial stop"), a volume note, and a warning to "admit defeat quickly". He also gives a time window, by the degree
   of the trend: a 2B on a minor extreme "will usually occur within one day or less", an intermediate one "will usually
   break within three to five days", a major one "within seven to ten days" (1993; the 2008 book says "a day or two",
   "three to five days", "up to 10 days"). He gives no fixed lookback, depth or target in the passages I could read.
   (Section 3.1 to 3.3.)
2. The only published statistics are Thomas Bulkowski's (2010-2020, 468 stocks). A second peak a little above the first
   was followed by bigger declines than one at or below it, and a second valley a little below the first by bigger
   rises. But he also found the 2B top "beat the benchmark group ... only 34% of the time", and he presents it mainly as
   an exit tool. His numbers measure moves from the exact extreme to the "ultimate" high or low, not trades with a stop.
   (Section 4.)
3. My own check on the app's local daily bars (2010-2026, liquid stocks, house filters): a plain mechanical 2B bottom
   reached 3R before its stop 27.0% of the time, the same as a random liquid day above the 200-day with a stop under that
   day's low (27.0%). Shallow undercuts, same-day reclaims and quiet break days did a little better. The setup has no
   edge by geometry alone. In the context Bracco describes (strong stocks during a market pullback) it pointed up more
   often than a random day (61% versus 55% higher 20 sessions later), but its stops were wide (median 3.3%), so in R terms
   the edge vanished. (Section 4.)
4. UCT's people use the 2B: Bracco on 2026-04-05: "Both staged 2B reversals as the market put in a low on 3/30. This was
   THE chart theme in the biggest winners coming out of the April lows last year." The owner trades the same idea as an
   "undercut and reclaim" of a prior low with the stop at the low of the day. (Section 6.)
5. The app has no 2B scanner. The only code that tests it is inside Chart IQ (`api/services/chart_iq/engine/v3.py`),
   whose label, as far as I traced, is computed but not returned to anyone. It is long-only and, replayed on the same
   bars, mostly fires on bounce days well under a low that broke earlier:
   only 2.5% of its fires were the first break of the low and only 42% closed back above it. The Model Book card's
   drawing shows a one-day dip under the previous candle's low in a straight decline, with no prior swing low.
   (Section 5.)
6. Two house conflicts: B26 (no longs below the 200-day; about half of all liquid 2B bottoms in my check were below it)
   and A13 (the stop beyond the new extreme is often wider than 3%, especially in the market-wide washouts where UCT
   found its best 2Bs). In an uptrend, UCT buys a failed breakout (the "squat"); it does not short it. So the 2B top
   short only fits below the 200-day. (Sections 6 and 7.)

---

## 1. What it is

**In two sentences.** A stock pushes below a prior swing low (or above a prior swing high), cannot keep going, and
comes back through that level within a few sessions. The trader buys (or shorts) the move back through the level, with
the stop just beyond the new extreme the failed push made.

**Sperandeo's own words for the top.** "In an uptrend, if a higher high is made but fails to carry through, and then
prices drop below the previous high, then the trend is apt to reverse" (*Methods of a Wall Street Master*, section 3.1).
For the bottom, the next sentence in all three books is: "The converse is true for downtrends." (sections 3.1 to 3.3).

**The market psychology (who is trapped, who is buying).**
- *Who sold the break.* A prior low is a level everyone can see. When price trades under it, three groups act: holders
  whose stops sit just under the low are sold out, breakdown traders sell short the new low, and some holders give up.
  If the price then comes back above the old low, every one of those sales is now under water. The shorts must buy to
  cover, and the holders who were stopped out often buy back. That buying is the fuel for the snap-back. UCT's owner
  describes the same thing on AMD: the stock "continues to trap bears below" (2026-09-06, section 6).
- *Who is buying the low.* The Wyckoff school, which calls the range version a "spring", describes the other side: the
  push under the low "allows large interests to mislead the public about the future trend direction and to acquire
  additional shares at bargain prices" (StockCharts ChartSchool, section 3.6). That is the Wyckoff school's reading of
  motive, not a measured fact.
- *Why the failure matters more than the break.* Sperandeo puts the weight on the follow-through: a new extreme that does
  not "carry through" tells you the side that made it has run out of buyers (at a top) or sellers (at a bottom). He adds
  that the failure tends to come on quiet volume and the reversal on heavier volume (section 3.1).
- *Why it can fail.* A break that keeps going is simply a breakdown. Bulkowski's data say many 2Bs are small moves and
  "fake moves are common" (section 4), and Sperandeo's own remedy is speed: "admit defeat quickly".

**How UCT uses it (summary of section 6).** UCT does not use the 2B to pick bottoms in falling stocks. Bracco's
description is the leader that dips under its prior low while the whole market washes out, then reclaims it "as market
came off the lows", near the 200-day. The owner trades the same picture as an undercut and reclaim of a known low, stop
at the day's low.

---

## 2. Origin and naming

**Who named it.** Victor Sperandeo ("Trader Vic"). He calls it the "2B" criterion in *Trader Vic: Methods of a Wall Street
Master* (John Wiley & Sons, with T. Sullivan Brown). In that book he uses both "2B criterion" and a heading "2B Rule"; the later books say "the
2B rule".

**When.** archive.org's catalogue lists an electronic edition with the year 1991 and a printed copy dated 1993, both with
ISBN 0-471-30497-2; Wikipedia lists the book as 1993. I cite it as "1991/1993" and quote from the 1993 printed copy;
the 1991 copy shows the same wording as far as the search passages go.

**Restated twice by Sperandeo.**
- *Trader Vic II: Principles of Professional Speculation* (Wiley, 1994), with a chart captioned "FIGURE 10.4 The 2B
  rule in three periods." The wording changes a little (it adds "immediately", section 3.2).
- *Trader Vic on Commodities* (Wiley, 2008), chapter 4, "2B or Not 2B: A Classic Rule Revisited", pages 23 to 34
  (Crossref record, DOI 10.1002/9781119196792.ch4). He writes that "Chapter 4 gives a refresher course in the 2B rule,
  which I first introduced in my book Methods of" (the sentence continues with the title).

**Why "2B".** I could not verify from the passages I read why he named it "2B". A search-engine summary of an O'Reilly
page for Bulkowski's book *Trading Basics* (which I could not open, HTTP 403) ties it to the second of Sperandeo's three
trend-change steps (his "1-2-3 criterion"). Treat that as unverified. The 1-2-3 criterion itself is in *Methods* (the
index lists it at pages 76-77, 178 and 268); I did not read its wording.

**Other names and near relatives.**
| Name | Who uses it | Same as the 2B? |
|---|---|---|
| "2B criterion", "2B rule" | Sperandeo (1991/1993; 1994, 2008) | The original. |
| "2B top", "2B bottom", "2B pattern" | Bulkowski, thepatternsite.com | Same idea, measured as a double top or bottom whose second extreme overshoots the first by up to 5%. |
| "Turtle Soup", "Turtle Soup Plus One" | Larry Connors and Linda Raschke, *Street Smarts* (book not read; rules via their firm's TradingMarkets articles) | A mechanical cousin: fade a new 20-day low or high that fails; section 3.5. |
| "Spring" and "upthrust" (UT, UTAD) | The Wyckoff school (StockCharts ChartSchool) | The same failure, but at the edge of a trading range; section 3.6 and setup 35. |
| "Oops" | Larry Williams; UCT's own Oops Reversal | The gap-open version against the prior day; setup 30. UCT's draft curriculum calls the Oops "the gap-open variant of the identical mechanics". |
| "undercut and reclaim", "U&R", "UnR", "sweep", "failed breakdown" | UCT (owner, Bracco, contributors) | UCT's everyday words for a 2B bottom; section 6. |
| "Failed breakout", "bull trap", "fake out" | UCT, ChartSchool ("It is also a bull trap") | A 2B top. In UCT's usage a failed breakout in a leader is often a *buy* (the "squat"), not a short; section 6. |

---

## 3. Every definition I could find, source by source

### 3.1 Sperandeo, *Trader Vic: Methods of a Wall Street Master* (1991/1993) (originator, primary)

Read through archive.org full-text search of the 1993 copy (identifier `tradervicmethods0000sper`) and the 1991
electronic copy (`tradervicmethods00vict`), 2026-11-09. Search results are short passages, so I quote only what the
passages cover and say where a sentence was cut off. I stopped searching the books once I had the rule, the stop, the
volume note and the loss rule (a long run of searches can read like copying a book, which I did not want to do).

- **The rule (heading "2B Rule").** "In an uptrend, if a higher high is made but fails to carry through, and then prices
  drop below the previous high, then the trend is apt to reverse"
- **The bottom.** The sentence after the rule: "The converse is true for downtrends." (present in this book too, not
  only in the later ones; the 1993 scan hyphenates it "down- trends" at a line break).
- **Time frames.** "This observation applies in any of the three trends; short-term, intermediate-term, or long-term"
- **How fast it should fail (his time rule, by degree of trend; missed in the first draft, found in checking).** "A
  2B on a minor high or low will usually occur within one day or less of the time the high or low is made." Then:
  "For 2B's on intermediate highs or lows preceding a correction, the new high or low point will usually break within
  three to five days." And: "At major market turning points, long-term 2B's, the new high or low will usually break
  within seven to ten days." (Three sentences, read in overlapping search passages; Bulkowski's page block-quotes the same
  three sentences, section 3.4, and the 2008 book restates them, section 3.3.) "Break" here means the move back through
  the previous extreme, i.e. how soon after the new extreme the failure shows.
- **His view of it.** "my personal favorite, is what I call the “2B” criterion."
- **Where it sits in the book.** The book's own index reads "2B rule, 78-81, 82, 178, 181" and "1-2-3 criterion,
  76-77, 178, 268"; the passage refers to Figures 7.9 to 7.13, so it is in chapter 7. The lead-in: "It has so much
  weight that it almost merits being called a rule: The 2B Rule".
- **Volume.** "In the stock market, after the new high is made, the failure to carry forward usually occurs on low to
  normal volume, and the confirmation of reversal occurs on higher volume." (31 words.)
- **Losses.** "When trading on the 2B criterion, it is essential that you admit defeat quickly if the trade moves against
  you."
- **His example of the exit.** "if you are day-trading and you short the market on a 2B and then the market rallies to
  new highs again, you should immediately close your position when prices break past the new 2B high" (the sentence may
  continue; read only this far).
- **Hit rate, as he states it (a judgment, not a test).** "When day-trading, the 2B criterion may be right only 50% of
  the time, but if you limit losses when you’re wrong and let your profits run when" (the sentence continues; read only
  this far). Just before it: by limiting losses "you’ll “stay at the table” and be able to keep trying."
- **What the passages did not show.** A lookback (how old the prior high must be), a maximum overshoot, an entry order
  type, or a profit target. (The first draft also listed "a time limit for the failure" here and said the fragment
  "will usually break within seven to ten days" had no readable subject; the checker found the full passage, above.)

*Criteria from this source:* prior trend: an uptrend (top) or downtrend (bottom), in any time frame; shape: a new extreme
past "the previous high" (or low); trigger: price back through the previous extreme; time: the failure usually shows
within one day (minor), three to five days (intermediate) or seven to ten days (major); volume: quiet on the failure,
heavier on the reversal; stop: get out if the market makes a new extreme again; target: none given.

### 3.2 Sperandeo, *Trader Vic II: Principles of Professional Speculation* (1994) (originator, primary)

archive.org identifier `traderviciiprinc00vict_0`, full-text search, 2026-11-09.
- **The rule, restated (heading "The 2B Rule").** "In an uptrend, if prices penetrate the previous high, fail to carry
  through, and then immediately drop below the previous high, then the trend is apt to reverse." (28 words.) Note the new
  word **"immediately"**.
- "The converse is true for downtrends."
- The chart caption "FIGURE 10.4 The 2B rule in three periods." (the figure numbering suggests chapter 10).
- Elsewhere he lists "the 1-2-3 criterion, the 2B rule, and the life-expectancy profiles" together as fundamental
  technical measures (passage cut off; quoted only as far as read).
- He shows it on other markets, for example "A great 2B buy signal in January 1993 at 339.0" (the passage does not name
  the market).

### 3.3 Sperandeo, *Trader Vic on Commodities* (2008), ch. 4 "2B or Not 2B: A Classic Rule Revisited" (originator, primary)

archive.org identifier `traderviconcommo0000sper`, full-text search, 2026-11-09. Chapter title and pages from Crossref.
- The rule again, with: "then the trend is apt to reverse. The converse is true for downtrends. This observation
  applies in any of the three trends: short-term, intermediate-term, and long-term"
- **The stop, in his words.** "You would go short the market and use the new high to compute your initial stop or out
  point" (the example continues with a price, 1,353.9).
- **The loss rule.** "The most crucial part of the 2B rule is that you lose properly! If the market trades back above
  the new high, or below the new low, you need to admit defeat immediately and take the loss." (37 words.)
- **Re-entry.** The next words, across the page turn: "You can go ahead and initiate the position again if the market
  once again" (cut there; the condition that follows was not read, so I do not state his re-entry rule).
- **The time rule, restated.** "...or low should fail to follow through within a day or two. In the intermediate term,
  it may take three to five days. And in the long-term, with major 2B signals, it could take up to 10 days." (The
  subject of the first sentence, a short-term 2B, was cut off; the sense is clear from the 1993 wording in 3.1.)
- He applies it to futures spreads too: "The 2B rule works with spreads, too". And he shows buy signals on futures: "A
  powerful 2B buy signal was given in May 2005" (rough rice, per the passage around it).

*What 3.1 to 3.3 settle:* the trigger is a return through the old extreme, and the stop is beyond the new extreme. The
failure should be quick: one day or less for a minor extreme, three to five days for an intermediate one, seven to ten
days for a major one (1993, restated in 2008), and "immediately" (1994). Nothing in what I read sets numbers for how old
the previous extreme must be or how far past it the new one may go.

### 3.4 Thomas Bulkowski, thepatternsite.com, "2B Pattern" (data source, secondary)

https://thepatternsite.com/2B.html. The page says "Page updated and added examples: 6/10/25." Read with the web tool four
times on 2026-11-09 (the site refused a plain download with HTTP 406). **AI notice:** the page states "This website, in
whole or in part, shall not be used to train artificial intelligence (AI) systems," I read it to cite it, with a link
and short quotes, as allowed for this research; I did not copy the page.

- **Credit.** "Victor Sperandeo in his book, Trader Vic--Methods of a Wall Street Master describes the 2B pattern this
  way." He then block-quotes the rule (the first words match the book: "In an uptrend, if a higher high is made but fails
  to carry through,"). His block quote runs on through the time rule and the volume note (the same sentences as 3.1; his
  copy reads "down trends" as two words and "confirmation of a reversal"). His own summary of Sperandeo: "It is less a
  pattern than it is a way for swing traders to take profits, according to Victor Sperandeo."
- **His shape.** "I prefer to think of a 2B top as one in which price begins to form a double top." "In a 2B top, the
  right peak is above the left." "In a 2B bottom, the right valley is below the left."
- **His view of what it is for.** "The 2B top can be valuable to exiting a long position in a timely manner but fake
  moves are common." "In short, the 2B pattern also works for bottoms." And on buying the bottom early: "The 2B bottom can
  get you into a double bottom trade sooner than waiting for confirmation of a double bottom" ... "but the risk of a
  failed trade is much greater."
- He also writes: "The 2B bottom is a failure of price to rise far." (this sentence is on the page; an earlier internal
  file, `docs/study/research/definitions.json`, quotes it too).
- **Entry, stop, target:** none. Asked directly, the web tool reported the page has no section on how to trade it.

*Criteria from this source:* two peaks (or valleys) within 5% of each other, the second past the first; no trend, volume,
entry or stop rule. His measurement is in section 4.

### 3.5 Larry Connors and Linda Raschke, "Turtle Soup" (*Street Smarts*, 1995 or 1996) (originators of a cousin; read only through their firm's articles)

I could not read *Street Smarts*. TradingMarkets is the Connors Group's site (its page footer names "The Connors Group,
Inc."), so its articles are the closest thing to the authors I could read. Both were downloaded and read 2026-11-09.
Sources disagree on the book's year (1995 or 1996); I give no year as fact.
- Marc Dupee, "What Turtle Soup Can Do For You", TradingMarkets, June 13, 2001
  (https://tradingmarkets.com/recent/what_turtle_soup_can_do_for_you-645410): the strategy is to "fade 20-day breakouts,
  levels that the famous Turtles trading group were alleged to key off in initiating trades." The Plus One buy "goes long
  after a market makes a new 20-day low but has not made a low in the prior four sessions. The entry signal is at the prior
  20-day low and the stop goes at the previous day’s low." (The quote is cut to stay under 40 words.) And: "Turtle Soups
  occur in the same day rather than on the following day."
- John Patrick Lee, "Breakout After Failure", TradingMarkets, July 25, 2006
  (https://tradingmarkets.com/recent/breakout_after_failure-654653), the Plus One rules: "The previous 20-bar low must
  have been made at least three trading sessions earlier." "The close of the new low (day one) must be at or below the
  previous 20-bar low." "An entry buy stop is placed the next day (day two) at the earlier 20-day low." "If filled, place a
  protective sell stop one tick under the lower of the day-one low or the day-two low." "Take partial profits within two
  to six bars and trail a stop on the balance of your position." And for shorts: "The rules are exactly the same for short
  sells, except that they are reversed."
- **How it differs from Sperandeo's 2B:** the extreme is mechanical (the 20-day low), the time window is fixed (same day,
  or the next day for Plus One), and the stop and profit-taking are specified. It does not require a prior trend or a
  rally between the two lows. Neither article mentions Sperandeo, and I found no reliable source linking the two, so I do
  not claim one was built on the other.
- **The two articles disagree** on the minimum age of the prior low: "prior four sessions" (2001) versus "at least three
  trading sessions earlier" (2006).

### 3.6 The Wyckoff school: the spring and the upthrust (established educator)

Roman Bogomazov and Michael Lipsett, "The Wyckoff Method: A Tutorial", StockCharts ChartSchool
(https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial),
downloaded and read 2026-11-09. The page says the schematics were "edited by the late Dr. Henry O. (“Hank”) Pruden".
- "A “spring” takes price below the low of the TR and then reverses to close within the TR; this action allows large
  interests to mislead the public about the future trend direction and to acquire additional shares at bargain prices."
  (TR = trading range.)
- "Springs or shakeouts usually occur late within a TR". "springs and terminal shakeouts are not required elements".
- The top: "a UT is the opposite of a spring. It is a price move above TR resistance that quickly reverses and closes in
  the TR." "It is also a bull trap".
- *How it differs:* the level is the edge of a sideways range built over time, the close back inside the range is the
  signal, and it is read inside a whole accumulation or distribution campaign. Setup 35 covers it in full.

### 3.7 Larry Williams' Oops and UCT's Oops Reversal (the gap-open cousin)

Covered by setup 30 and by `docs/study/levels/dossiers/oops.md`. In short: the stock opens under the prior day's low (or,
in the owner's version, under the prior close), trades under the prior low, and comes back. It is a 2B against a
one-day-old low, delivered by a gap. UCT's draft curriculum (`docs/curriculum/uct_method_course.json`, lesson M10.L2)
teaches the two together in one lesson and calls the Oops "the gap-open variant of the identical mechanics". That curriculum is a planning draft, not the owner's
words (section 5.3).

### 3.8 Sources I tried and could not read

- *Technical Analysis of Stocks & Commodities* / Traders.com articles that search results say discuss the 2B (David Penn
  and others: `technical.traders.com/tradersonline/display.asp?art=` 2349, 3212, 958, 2497, 2749, 982, 6993, 3448 and,
  on Turtle Soup, 2414): HTTP 403 to both a plain download and the web tool. Search-engine summaries of them are not
  quoted here.
- The Wiley Online Library page for the 2008 chapter: HTTP 403 (metadata taken from Crossref instead).
- Bulkowski, *Trading Basics: Evolution of a Trader* (Wiley), chapter 5 on O'Reilly: HTTP 403.
- *Working Money* article 677 (titled The Optimized Trader in search results): the server returned error 520.
- IBD articles on the double bottom's undercut and on a shakeout-based early entry (syndicated on inkl.com): HTTP 403;
  investors.com itself refuses our web tools, and a Nasdaq.com reprint timed out. They would matter if, as commonly
  taught, IBD's double bottom wants the second low to undercut the first (which would make it a 2B bottom inside a
  base). I could not open any IBD page to confirm that wording, so it is reported here as an unverified recollection,
  not a sourced criterion.
- *Street Smarts* (Connors and Raschke) itself, and Sperandeo's *New Market Wizards* interview (Schwager): not read.
- Several *Stock Trader's Almanac* editions (Hirsch) quote Sperandeo's rule with "prices dip below the previous high",
  per archive.org search passages. The book says "drop". A small sign that secondary quotes of this rule drift.
- Forum posts, TradingView ideas, broker blogs, Scribd uploads and AI-written "concept" pages: not used as sources.

### 3.9 The criteria compared

| Criterion | Sperandeo 1991/1993 | Sperandeo 1994 | Sperandeo 2008 | Bulkowski | Turtle Soup (TradingMarkets) | Wyckoff (ChartSchool) | UCT (section 6) |
|---|---|---|---|---|---|---|---|
| Prior trend | uptrend for a top, downtrend for a bottom | same | same | none required | none required | a trading range after a trend | leaders in an uptrend, often near the 200-day, during a market low |
| The level | "the previous high" (low) | same | same | the first peak (valley) | the prior 20-day low (high) | the range low (high) | a prior low, a range low, a moving average, a gap, last week's low |
| Age of the level | not given | not given | not given | up to a year; median 10 days (tops), 21 (bottoms) | 3 or 4+ sessions (sources differ) | weeks to months (range) | not fixed |
| How far past | not given | not given | not given | within 5% | any new 20-day low | "below the low of the TR" | "briefly", "slightly" |
| Time to fail | "within one day or less" (minor), "three to five days" (intermediate), "seven to ten days" (major) | "immediately" | "a day or two", "three to five days", "up to 10 days" | none (two peaks) | same day, or next day (Plus One) | "reverses to close within the TR" | same day to a few days |
| Volume | failure on "low to normal", reversal on "higher" | not read | not read | none | none | volume read in context | not stated |
| Trigger | back through the old extreme | same | same | none (exit tool) | buy stop at the old 20-day low | the close back inside | the reclaim; or the next hourly higher low |
| Entry order | not given | not given | not given | none | stop order | not given | market order (house E57) |
| Stop | out if a new extreme prints | not read | the new extreme ("initial stop or out point") | none | one tick beyond the new extreme (day-one or day-two) | not given | the low of the day |
| Target / exit | none | none | none | none | partials in 2 to 6 bars, trail the rest | the next phase of the campaign | house trims (3R, 5R) and trail |
| Short side | yes (it was first stated as a top) | yes | yes | yes | yes, "reversed" | upthrust / UTAD | failed breakouts below the 200-day; in leaders a failed breakout is a buy |

### 3.10 Where the sources disagree

1. **Reversal or exit signal?** Sperandeo: "the trend is apt to reverse". Bulkowski's data: most 2B tops lead to small
   declines; he presents it as a way of "exiting a long position in a timely manner". UCT: a reclaim after a dip in a leader,
   which is a resumption of the uptrend, not a change of trend.
2. **How soon must it fail?** Sperandeo (1993, 2008): about a day for a minor extreme, three to five days for an
   intermediate one, seven to ten days for a major one; "immediately" (1994); same day or next day (Turtle Soup);
   "quickly" (Wyckoff UT). For a swing trade on a daily chart the intermediate figure (three to five days) is the one
   that applies, and it agrees with Turtle Soup and with UCT's "same day to a few days".
3. **Volume.** Sperandeo wants the failure on "low to normal volume". UCT's draft curriculum script says the opposite: "the
   heavy volume on the failed break IS the trapped crowd". My check (section 4) agrees with Sperandeo, weakly.
4. **The level.** Any previous extreme (Sperandeo), the 20-day extreme (Turtle Soup), a range edge (Wyckoff), a peak or
   valley within 5% (Bulkowski), or almost any known level (UCT). This is the biggest open choice for our course.
5. **Age of the prior extreme.** Turtle Soup's own articles disagree (three versus four sessions).
6. **Stop.** All who give one put it beyond the new extreme. Turtle Soup Plus One uses the lower of the two days' lows.
   UCT's owner uses the low of the day he buys.
7. **Long and short.** All outside sources treat the two sides the same. UCT does not: a failed breakout in a leader above
   the 200-day is a long (the "squat"), and the house allows shorts only below the 200-day (B26).

---

## 4. Measured evidence

### 4.1 Bulkowski, 2010-2020 (the only published study I found)

Source: https://thepatternsite.com/2B.html (read 2026-11-09; see the AI notice in 3.4).

**How he measured.** "I programmed my computer to find all peaks in a 10-year period from January 1, 2010 to January 1,
2020." "I used 468 stocks and logged 41,702 samples from stocks priced above $5 a share at the top of the first peak." "I
limited the peak-to-peak price difference to 5% (below or above the first peak)." For bottoms: "I looked for a second
bottom that was within 5% of the first bottom and up to a year in width." and "I found 14,890 examples". Moves are measured
to the "ultimate" low or high; his definition elsewhere: "The ultimate high or low is the highest high or lowest low,
respectively, before price changes trend by at least 20%." (https://www.thepatternsite.com/Time.html). Per the web tool's
reading of the 2B page, top declines are measured "from the high at the second peak to the ultimate low" and bottom gains
"from the second bottom's low to the ultimate high" (one read; not cross-checked).

**Tops (his table, as read twice; the sample counts add up to his stated 41,702).** His rows are a "peak-to-peak
difference" from -4% to more than 4%, under three group labels in this order: "First Peak Below Second", "Equal", "First
Peak Above Second". Reading the labels in order, the negative rows are the 2B tops (the second peak higher). The page has
two rows marked "0%"; from the text I read I cannot tell which group each belongs to, so I show them as they appear.

| His difference | Meaning | Percentage loss | Samples |
|---|---|---|---|
| -4% | second peak about 4% higher | 16% | 199 |
| -3% | about 3% higher | 14% | 322 |
| -2% | about 2% higher | 12% | 685 |
| -1% | about 1% higher | 10% | 1,872 |
| 0% (first of two rows) | about equal | 7% | 6,456 |
| 0% (second row) | about equal | 6% | 74 |
| 1% to 4% | second peak lower | 6% each | 10,982; 8,082; 5,676; 4,144 |
| over 4% | second peak lower | 7% | 3,210 |

His headline sentences: "I checked all peaks and found that price dropped a median (and average) of 10%." "The median drop
for all samples was 7%." "The median time between peaks was 10 days." "I found that the 2B pattern beat the benchmark group
(by seeing price drop farther) only 34% of the time." And, on using it to sell: seeing a second peak form within 5% above
the first "allows you to exit the stock and avoid an above average decline 42% of the time." "The other 58% of the time
you'd see an average decline of 10%."

**Bottoms (as read twice; the counts add up to his stated 14,890).** Same layout ("First Valley Above Second", "Equal",
"First Valley Below Second"); the negative rows are the 2B bottoms (the second valley lower).

| His difference | Meaning | Percentage gain | Samples |
|---|---|---|---|
| -4% | second valley about 4% lower | 43% | 175 |
| -3% | about 3% lower | 40% | 256 |
| -2% | about 2% lower | 40% | 475 |
| -1% | about 1% lower | 37% | 1,018 |
| 0% (first of two rows) | about equal | 34% | 2,275 |
| 0% (second row) | about equal | 21% | 10 |
| 1% | second valley higher | 12% | 6 |
| 2%, 3%, 4%, over 4% | second valley higher | 32%, 30%, 32%, 30% | 3,279; 2,869; 2,439; 2,088 |

His time notes: "The 21 number is the median time between bottoms for all 2B patterns." and "the average gain was 33% for
those less than or equal to 21 days" (the comparison group's number I did not get word for word, so I leave it out). One
more fragment, as read: a 2B bottom beat "the 34% average for all bottoms" only "33% of the time".

**What it means and its limits.**
- A small overshoot (1% to 4%) is followed by a bigger move than a second extreme that falls short. That fits
  Sperandeo's idea that the overshoot traps people.
- But the measure starts at the exact extreme (buying the lowest tick, selling the highest) and ends at the ultimate low or
  high (after the fact). No entry rule, stop, or time limit. These are not trade results, and they cannot be turned into a
  win rate or an R multiple.
- He did not require the reclaim (the move back through the first extreme) that defines Sperandeo's trigger.
- 468 stocks over one decade (2010-2019), a mostly rising market. The bottom table's "1%" row (6 samples, 12%) next to a
  3,279-sample "2%" row looks like a binning quirk on his page; I report it as read.
- The rows with the biggest moves (4% overshoot) are the smallest samples (175 to 199).

### 4.2 Sperandeo's own numbers

Only a judgment: "the 2B criterion may be right only 50% of the time" when day-trading (section 3.1). No sample, market
or period is given. It must never be taught as a measured hit rate.

### 4.3 Turtle Soup and Wyckoff

The two TradingMarkets articles give no statistics ("Although they do not occur frequently", 2001). The ChartSchool
tutorial gives none. I found no published, sourced test of either that meets the source rules.

### 4.4 My check on the app's local daily bars (2026-11-09; scratch scripts, not committed)

**Data.** The local sandbox copy of the app's daily bars (`bars.db`, 4,127 tickers, daily bars to 2026-11-09; the
universe is today's tickers, so it has survivorship bias). Events from 2010-01-01 to 2026-08-01 (so each has 60 sessions
after it).

**My mechanical 2B bottom (long), written to follow Sperandeo as closely as numbers allow.**
- The prior low: a daily low with no lower low in the 5 sessions on each side (a "swing low").
- The break: the first session, 5 to 60 sessions later, that trades under it, after a rally of at least 1 ATR(14) off it.
- The reclaim: a close back above the swing low on the break day or within the next 3 sessions.
- Entry at that close. Stop 5 cents under the lowest low from the break to the reclaim (the new extreme).
- House filters at the entry: price at least $10, 50-day average dollar volume at least $20 million (B23), close above the
  200-day SMA (B26), not more than 10% above the 10-day SMA (C29).
- Outcome: walk forward 60 sessions from the day after entry; did price reach 3R or 5R before the stop (a day that hits
  both counts as stopped).
- Baseline: a 3% random sample of every liquid day above the 200-day, entry at the close, stop 5 cents under that day's low.
- The 2B top (short) is the mirror, with the house filter reversed: the close is below the 200-day.

**Results (all liquid names; "house set" = above the 200-day and C29).**

| Group | Events | Reached 3R before the stop | Reached 5R before the stop | Stopped before 3R | Median stop distance | Stop within 3% |
|---|---|---|---|---|---|---|
| All 2B bottoms (liquid, 2010-2026) | 144,669 | 27.3% | 17.4% | 69.0% | 2.18% | 65% |
| House set | 72,944 | 27.0% | 17.2% | 68.9% | 2.12% | 66% |
| Below the 200-day (house would skip) | 71,669 | 27.6% | 17.7% | 69.1% | 2.25% | 63% |
| House set, reclaimed the same day | 46,582 | 27.5% | 18.6% | 70.3% | 1.66% | 76% |
| House set, reclaimed 1-3 days later | 26,362 | 26.3% | 14.8% | 66.5% | 3.07% | 49% |
| House set, undercut 0-1% | 41,184 | 28.2% | 19.4% | 69.8% | 1.31% | 89% |
| House set, undercut 1-2% | 15,273 | 28.3% | 17.3% | 68.9% | 2.50% | 66% |
| House set, undercut 2-3% | 7,409 | 25.8% | 14.0% | 68.5% | 3.61% | 25% |
| House set, undercut 3-5% | 5,656 | 22.8% | 11.6% | 66.9% | 5.22% | 0% |
| House set, undercut over 5% | 3,422 | 17.0% | 7.2% | 62.6% | 8.96% | 0% |
| House set, break-day volume under 1.0x its 50-day average | 25,853 | 28.4% | 19.0% | 70.0% | 1.68% | 77% |
| House set, break-day volume 1.0x to 1.5x | 24,523 | 28.2% | 18.3% | 69.3% | 2.06% | 69% |
| House set, break-day volume 1.5x or more | 22,568 | 24.3% | 13.9% | 67.4% | 2.96% | 51% |
| House set, prior low 5-20 sessions old | 50,654 | 27.1% | 17.3% | 69.6% | 2.02% | 69% |
| House set, prior low 21-60 sessions old | 22,290 | 26.9% | 16.9% | 67.5% | 2.39% | 61% |
| House set, 2010-2019 | 36,422 | 27.3% | 17.3% | 67.7% | 1.89% | 72% |
| House set, 2020-2026 | 36,522 | 26.8% | 17.1% | 70.1% | 2.41% | 61% |
| **Baseline: random liquid day above the 200-day** | 86,380 | **27.0%** | **19.4%** | 72.7% | 1.02% | 91% |

| Shorts | Events | Reached 3R before the stop | Reached 5R before the stop | Stopped before 3R | Median stop distance | Stop within 3% |
|---|---|---|---|---|---|---|
| 2B tops below the 200-day (house set) | 44,810 | 22.1% | 13.2% | 74.0% | 2.23% | 63% |
| 2B tops above the 200-day (house would not short) | 113,139 | 22.3% | 13.7% | 75.4% | 1.62% | 77% |
| Below the 200-day, same-day failure | 28,040 | 23.3% | 14.9% | 74.7% | 1.67% | 75% |
| Below the 200-day, 1-3 days later | 16,770 | 20.0% | 10.3% | 72.8% | 3.45% | 43% |
| **Baseline: random liquid day below the 200-day, short** | 55,859 | **24.0%** | **16.7%** | 75.6% | 1.27% | 83% |

When 3R was reached in the house set, the median time was 6 sessions.

**Second pass: where UCT says the 2B works (leaders, market lows).** The same longs (house set), now split by a rough
leader proxy (6-month gain of 30% or more, within 25% of the 52-week high, 200-day rising; the app's RS rating was not
available offline) and by the market's state (SPY), each against the random-day baseline with the same filter. I added a
plain return measure: the close 20 sessions later versus the entry.

| Group (longs above the 200-day) | 2B events | 2B: 3R before stop | Baseline: 3R before stop | 2B: median 20-day return | Baseline: median 20-day return | 2B: 20-day return above 0 | Baseline: above 0 | 2B median stop |
|---|---|---|---|---|---|---|---|---|
| All | 72,744 | 27.1% | 27.0% | +0.86% | +0.70% | 55% | 54% | 2.12% |
| Leader proxy | 11,326 | 26.8% | 26.3% | +1.02% | +0.67% | 54% | 53% | 3.07% |
| SPY below its 50-day | 27,319 | 28.9% | 29.3% | +1.90% | +1.44% | 60% | 58% | 2.35% |
| SPY 8% or more off its 52-week high | 8,757 | 26.9% | 27.2% | +1.48% | +0.61% | 56% | 53% | 2.90% |
| Leader proxy and SPY below its 50-day | 3,450 | 30.1% | 29.3% | +3.04% | +1.98% | 61% | 57% | 3.30% |
| Leader proxy and SPY 8% or more off its high | 1,006 | 28.6% | 29.4% | +3.07% | +1.04% | 61% | 55% | 3.33% |
| ...and a same-day reclaim, undercut under 2% | 559 | 29.0% | (29.4%, same baseline) | +2.99% | (+1.04%) | 61% | (55%) | 2.18% |

Shorts (2B tops below the 200-day) against a random short below the 200-day: 20-day return +0.56% versus +0.70% (a short
wants it negative), 46% versus 46% of cases lower after 20 days. No edge on the short side in any market split I tried.

So in the context Bracco describes (strong stocks during a market pullback), the 2B bottom pointed the right way more
often than a random day (61% versus 55% higher after 20 days; median +3.1% versus +1.0%). In R terms that edge
disappears, because the stop beyond a market-washout undercut is wide (median 3.3%). That is the practical case for a
tighter, later entry in those conditions (section 8.2).

**What this says.**
1. **Geometry alone is not an edge.** A mechanical 2B bottom reached 3R before its stop as often as a random liquid day
   with a stop under that day's low (27.0% versus 27.0%), and 5R less often (17.2% versus 19.4%). The 2B top short did a
   little worse than a random short below the 200-day. The 2B is a place to define risk, not a signal that works by itself.
2. **The details Sperandeo stressed point the right way, but only slightly.** Same-day failures beat slower ones (5R
   18.6% versus 14.8%), shallow undercuts beat deep ones (5R 19.4% at 0-1% versus 7.2% over 5%), and quiet break days beat
   loud ones (5R 19.0% under 1.0x volume versus 13.9% at 1.5x or more), which agrees with his "low to normal volume".
3. **The stop fits A13 most of the time, but not when the reclaim is slow or the undercut deep.** Median stop 2.12%;
   two thirds within 3%; under half within 3% when the reclaim took 1 to 3 days.

**Limits of my check.** One definition among many (a 5-bar swing, 1 ATR rally, 3-day window); no RS rating and no group
strength (C31 could not be applied); entry at the close, not by market order when the level is retaken intraday; no
commissions or slippage; events overlap in time (market-wide washouts produce hundreds at once), so they are not
independent; the bars are a sandbox copy with today's tickers only. It tests whether the shape is enough, not whether the
owner's or Bracco's version works.

**Checker's replication (2026-11-09).** A second reader re-implemented the same definition from the text above (own
code, 350 random tickers with 2,500+ daily bars, same house filters and baseline): all liquid 2B bottoms 16,155 events,
27.8% to 3R; house set 7,887, 27.4%; baseline 9,676, 27.7%; same-day reclaims 5R 19.2% versus 15.6% for 1-3 days;
undercuts under 1% 3R 29.3% versus 15.0% for undercuts over 5%; median stop 2.10%, 67% within 3%. The table above was
also recomputed from the writer's event files and transcribes exactly. The conclusions stand.

### 4.5 The 2Bs UCT named, on the same bars

Bracco named HOOD, PLTR, NFLX, SPOT and GEV (the April 2025 lows) and ASTS and RKLB (the 2026-03-30 low) as 2B
reversals (section 6). Checking each against the swing low that its final drop broke (a 5-session swing low, the most
recent one still unbroken before that drop; for ASTS the nearer 2026-03-12 swing low, 83.91, had already been broken and
reclaimed on 2026-03-24, so the table uses the 2026-02-27 low):

| Stock | Prior swing low | First break | Lowest low | How far under | First close back above | Above the 200-day then? |
|---|---|---|---|---|---|---|
| HOOD | 2025-03-10, 35.23 | 2025-04-04 | 29.66 (4/7) | 15.8% | 2025-04-07 (1 session) | yes |
| PLTR | 2025-03-10, 74.57 | 2025-04-04 | 66.12 (4/7) | 11.3% | 2025-04-07 (1 session) | yes |
| NFLX | 2025-03-10, 85.45 (split-adjusted) | 2025-04-04 | 85.39 (4/4) on the first break; 82.11 on a second undercut (4/7) | 0.1%, then 3.9% | 2025-04-04 (same day); the 4/7 dip also closed back above the same day (86.78) | yes |
| SPOT | 2025-03-10, 483.65 | 2025-04-07 | 475.01 | 1.8% | 2025-04-07 (same day) | yes |
| GEV | 2025-03-10, 266.47 | 2025-04-04 | 252.25 | 5.3% | 2025-04-04 (same day) | **no** (close 271.48, 200-day 279.27) |
| ASTS | 2026-02-27, 77.17 | 2026-03-30 | 71.85 | 6.9% | 2026-03-31 (1 session) | yes |
| RKLB | 2026-02-27, 64.10 | 2026-03-27 | 56.13 (3/30) | 12.4% | 2026-03-31 (2 sessions) | yes, barely (close 64.22, 200-day 57.57) |

Two lessons for the course. First, most of UCT's best-known 2Bs undercut their prior low by far more than my mechanical
set's typical undercut (under 1% in more than half of the house set): SPOT 1.8%, GEV 5.3%, ASTS 6.9%, PLTR 11.3%, RKLB
12.4%, HOOD 15.8%; a stop beyond the new extreme would have been roughly that far away, mostly far outside A13's "about
3%". (NFLX is the exception and a wrinkle: its first break on 4/4 was only 0.1% deep and reclaimed the same day; it then
undercut again on 4/7, 3.9% deep, and again closed back above the same day. The first draft's row merged the two.) The
owner's own way around the wide stop is visible in his words: buy a later, tighter spot ("Next higher low on the
hourly is actionable imo", section 6). Second, one of Bracco's seven (GEV) was below its 200-day on the reclaim day, so
B26 would have skipped it.

---

## 5. Our app: what the code actually tests

### 5.1 There is no 2B scanner

No detector in `api/services/pattern_engine/detectors/` is named for the 2B (searched 2026-11-09 for "2b", "two_b",
"Sperandeo", "Turtle"). The pattern engine's nearest relatives are other setups:
- `uct/uct_undercut_reclaim.py` (internal, admin-only): a session that trades under a level (prior day's low, the 10-day
  low, the 21-day EMA or 50-day SMA) and closes back above it, in the upper half of its range, above the 50-day. Entry the
  close, stop the session's low. Long only. This is the closest thing to a same-day 2B bottom, but its levels are
  short-term (prior day, 10-day) and it requires no prior swing low and no rally between.
- `uct/u_and_r.py`: a red close below support (50-day, a swing low, or a consolidation low) for 1-2 bars, then a close
  back above within 1-3 bars, after a tight 8+ bar range. Long only.
- `uct/wyckoff_spring.py` and `uct/wyckoff_upthrust.py`: the range version (setup 35). The upthrust is the only short-side
  failure detector in the engine; its stop is "upthrust_high * 1.015" (1.5% above the high), not "a few cents" (F62).
- `uct/uct_oops_reversal.py`: the one-day gap version (setup 30). Its docstring says the short mirror "is NOT fired".

### 5.2 Where the 2B is named in code

**Chart IQ's read** (`api/services/chart_iq/engine/v3.py`, lines 205-212, a vendored file marked "regenerate, do not
hand-edit"). The Chart IQ route (`api/routers/chart_iq.py`, gated by `CHART_IQ_ENABLED` for admins and
`CHART_IQ_MEMBERS_ENABLED` for members; I did not check which flags are on) runs `pipeline.analyze`, which runs this
file. **As far as I traced, the 2B label is computed but never shown:** the composer copies v3's `labels` and `read` into
its result (`engine/v4_compose.py`, line 682), but `pipeline.analyze` (`api/services/chart_iq/pipeline.py`, lines
142-148) does not include `labels` or `read` in what it returns. So the rule below matters only if someone surfaces it
later. The rule, faithfully:
- swing lows = bars in the window from 25 to 2 sessions before today whose low is the lowest of the 3 bars on each side;
- fire `two_b_reversal` when today's low is under the **most recent** such swing low **and** today's close is above
  **yesterday's high**;
- the read says: "2B reversal: took out the %.2f low, closed over yesterday's high."
What it does not check: that today closes back above the swing low it broke; that today is the first break of it; any
prior trend, volume, liquidity or 200-day position; and there is no 2B top at all.

**I replayed this rule bar by bar on the same local bars** (point in time, liquid names, 2010-2026): 149,226 fires. Only
**2.5%** were the first break of the swing low, and only **42.2%** closed back above it. So in most fires the stock had
already broken that low on an earlier day and today was simply an up day that closed over yesterday's high while still
under the old low. That is a bounce in a decline, not Sperandeo's 2B. Its outcomes (27.8% reached 3R before a stop under
the day's low) were the same as the random baseline.

**Other places the name appears.**
- `app/src/constants/setupGroups.js`, line 11: "2B Reversal" is one of the Swing journal tags.
- `api/services/desk_session_insights.py`, line 420: "2B Reversal" is in the fixed setup list a video's transcript is
  mapped to.
- `api/services/journal_two/coach_prompts.py`, lines 125-126 (the Compass coach's prompt): "**2B Reversal / Failed
  Breakdown / U&R**: failed break of support flipping to long. High-quality reversal setup." It treats the 2B as long-only
  and calls it high-quality without a source; my check (4.4) does not support "high-quality" for the shape alone.
- `app/src/components/chart/engine/ast/starterScans.json`, line 456: a note that a 2B formula "needs `lowest(low, N)` or
  `highest(high, N)`, and no artifact at the firm publishes an N." That is accurate: no house document sets the lookback.

### 5.3 The Model Book card and the course plans

**Model Book card** (`app/src/pages/modelbook/setupCatalog.js`, lines 179-186): family "Reversals & Reclaims", direction
"both", essence: "Price breaks a prior extreme, fails to follow through, and snaps back", ending with "trapping the late
entries." The essence matches Sperandeo. The drawing does not. Rebuilt with the page's own drawing rules (`SetupGlyph` in
`SetupsView.jsx`): six falling candles; the 7th dips under the 6th candle's low (85.44 to 82.31 on the glyph's scale) and
**closes below it** (85.03); the 8th closes back above (88.86). The dashed line marks the 6th candle's low. So the picture
is a one-day undercut of the previous candle in a straight decline: there is no prior swing low, no rally between the two
lows, and no "previous high/low" for anyone to be trapped under. It reads as an Oops or Turtle Soup Plus One, not a 2B.
And it shows only the long side while the card says "both".

**Journal tag:** "2B Reversal" (Swing group). No definition is attached.

**Draft curriculum** (`docs/curriculum/uct_method_*.json`, lesson M10.L2, which teaches the 2B with the Oops as "the
gap-open variant of the identical mechanics"). A planning draft, not the owner's words. Points that clash with the
sources or the house rules:
- "the heavy volume on the failed break IS the trapped crowd": Sperandeo says the failure "usually occurs on low to normal
  volume"; my check agrees with him, weakly (4.4).
- "partials come off at 2-3R": replaced by the house's 3R and 5R (B19, E51).
- "this family's size-smallest doctrine": no such house rule; size comes from the grade (D38, E49).
- Its worked 2B is SPY, August to October 2011 (break of the August 9 low near 110.27, low 107.43 on October 4, close
  112.34; its numbers match the local bars). On that day SPY closed far under its 200-day (128.03 on the local bars), so
  B26 forbids the long. The break day's volume was 1.38x its 50-day average.
- `docs/study/UNITS-method.md` (lines 77 and 177) plans unit SET.24 for the 2B and records no labelled data;
  `docs/study/plan-review.html` (line 383) lists the 2B among "Six of the 26 setups have no labelled data at all".

**Study's trade plans** (`docs/study/TRADE_PLANS.md`): no 2B row.

**Earlier research file** (`docs/study/research/definitions.json`, the "2B Reversal" entry): its Bulkowski quotes are on
the page (checked again 2026-11-09). Its note "Sperandeo's own text was not fetched" is now out of date: sections 3.1 to
3.3 here quote him, and confirm the entry it labelled "(secondary)": the stop goes beyond the new extreme.

### 5.4 What looks wrong (summary)

1. Chart IQ's `two_b_reversal` (computed, not shown today) fires mostly on bounces below an already-broken low (97.5%
   not first breaks; 57.8% never closed back above the low). Before anyone surfaces it, it needs at least: the close back
   above the broken low, and a first break.
2. Chart IQ has no 2B top, though the card says "both".
3. The Model Book drawing lacks the prior swing low that defines a 2B.
4. The coach prompt calls it "High-quality" with no source; the evidence says the shape alone has no edge.
5. Nothing in the house sets the lookback, the depth or the reclaim window (the starterScans note is right).

---

## 6. UCT's own words

**Searched:** all 103 posts in UCT's public Substack sitemap (https://unchartedterritoryy.substack.com/sitemap.xml, read
2026-11-09), for "2B", "Sperandeo", "Trader Vic", "Turtle Soup", "1-2-3", "failed breakdown", "failed breakout",
"bull trap", "bear trap", "trapped", "fake out", "sweep", "undercut", "shakeout" and "spring". Counts: "2B" as the setup
2 posts (other "2B" hits were "$2B" dollar amounts); "Sperandeo", "Trader Vic", "Turtle Soup" 0; "failed breakdown" 24
occurrences in 16 posts; "failed breakout" 14 in 11; "undercut" forms 116 in 65; "shakeout" forms 112 in 47 (the
checker's recount, body text plus title; the first draft had 23 and 13 for the first two). Every quote below was
re-checked against a fresh copy of the post downloaded the same day, and again by the checker from a second fresh
download, including which signed section each sits in.

**The two posts that name the 2B.**
- **Bracco**, Sunday Scans 2026-04-05 ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-356)), on ASTS and
  RKLB: "Both staged 2B reversals as the market put in a low on 3/30. This was THE chart theme in the biggest winners
  coming out of the April lows last year." Then: "As the indices broke down and trended significantly below previous lows,
  all the RS names briefly undercut those previous lows and reclaimed as market came off the lows." And: "HOOD PLTR NFLX
  SPOT GEV all notable names that put in this exact reversal pattern near their 200-day moving averages and went on to
  lead the market higher." This is the clearest statement of UCT's 2B: **relative-strength leaders, a market-wide low, a
  brief undercut of the prior low, the reclaim, near the 200-day.** (Section 4.5 checks these names.)
- **Unsigned** (Index & ETF, QQQ), Sunday Scans 2026-02-22 ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-04c)):
  "This could be a double bottom here, this could be a 2B reversal or undercut this past Tuesday." And, on the risk
  points: "Bottom line is this, Last week’s low and Friday’s low are the Hard Lines in the sand."

**The owner (TSDR), on the same trade under his own words ("undercut and reclaim", "failed breakdown", "sweep").**
- The plan, entry and stop: "Looking for an undercut of $15 and recclaim of last week’s low there. Would be actionable
  for a low risk entry spot. Stop at LOD if this triggers." And, same paragraph: "My stops are always LOD until I can raise
  them to breakeven, trim 1/4 - 1/3 on a 3-6 day push, then trail the rest" (QBTS, 2025-06-22,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)). (His trims there predate the 2026-11-09 rulebook,
  which now sets 3R and 5R.)
- A support low, with the stop under the new low: "Two scenarios possible, Break inside day high of $147.40 and trend
  towards recent highs or undercut and reclaim $141.30 with a stop at the new established support." (RDDT, 2025-07-13,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6))
- A taken trade: "AAOI ($26.85) bought the undercut and reclaim of the inside day following the base breakout attempt."
  (2025-09-14, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-461))
- The entry he prefers after a failed breakdown: "Failed breakdown below $460 with strong candle. Next higher low on the
  hourly is actionable imo." And why it works: "This stock went from $180 to $580 over 2 months and gave nothing back and
  continues to trap bears below." (AMD, 2026-09-06, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd))
- The level and the reclaim, planned ahead: "Ideally see filed break into $52.50 and then reclaim. Could be down to
  $51.50." (HPE, 2026-08-23, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-807)) And on SNDK in the same
  post: "could see failed breakdown and hold of 20EMA and oops reversal to reclaim double inside day lows."
- What he trades: "I prefer key levels of support, 20EMA or 50SMA, notable bull gap holds or weekly levels, undercut and
  reclaims. Anything sensible that I can logically risk against and repeat on RS names and liquid leaders." (2026-07-05,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-dec))
- On a moving average: "The 20EMA undercut and reclaim on 8/7 is tight risk plus the RS that it has shown is worthy of my
  risk!" (DELL, 2026-08-16, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-da5))
- On a range low: "Pulls into and undercuts this range slightly closing with a strong lower wick. Remounts MAs and breaks
  highs." (TEAM, 2026-10-11, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-31b))
- **What he does not usually do (important for B26):** "The type of short term undercut on a stock that is below the MAs
  is just not something I generally do. I am working on analysis to add a variety of that setup into my playbook right
  now." And: "Given a lot of the names I wanted gave this exact setup I really want to expand that into my playbook. One of
  my goals for 2026 actually." (2025-12-07, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-088))
- The character of a name: "It is the character of the stock to have gnarly moves and failed breakdowns." (BE,
  2026-07-12, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-898))
- "Sweep" as a planned entry: "Wanted a sweep of $140 mid week, never got it. Now waiting for a failed breakout and squat
  type trade into the 20EMA." (MRNA, 2026-09-20, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-bc2))

**The owner, on the failed breakout as a buy (why UCT does not short a 2B top in a leader).**
- "Some call it the failed breakout-squat setup. I think if that happens you buy with 10 toes down." (HPE, 2026-09-27,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-09b))
- Unsigned (Index & ETF, IWM): "The squat is the best by the way. Failed breakout into an undercut of the breakout spot and
  tap into the moving averages then go." (2025-08-24, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa))

**Bracco, on failed breakdowns in the market.**
- "Favorite trading scenario from here is further weakness into a failed breakdown of the June lows leading to a big
  undercut and rally." (2026-07-05, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-dec))
- "the Nasdaq’s undercut of its prior low now looks more like a failed breakdown than the start of a new leg lower."
  (2025-11-16, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a))
- "would prefer a double bottom or failed breakdown of the recent June lows to further washout some positioning and
  quickly reset short-term sentiment." (2026-06-28, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1))
- On buying after one: he "knew this market had a chance to take off given the negative sentiment, breadth washout, and
  failed breakdown on a significant catalyst." (2026-09-20, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-bc2))

**Unsigned index notes (the market's own 2Bs).**
- "the best way to trade a head and shoulders top is to buy the failed breakdown of it." (QQQ, 2025-09-01,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1))
- "Thursday’s candle could be viewed as a failed breakdown and snap back into range." (SPY, 2026-09-13,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-2f5))
- "Failed breakdown from 6 months essentially of sideways into a rip to highs. Historic." (SPY weekly, 2026-04-19,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-33a))
- Intro, 2026-04-12: "This was a very aggressive wedge pop in the indexes and really more like a failed breakdown for the
  most part." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-a43))
- Intro, 2026-09-20: "All of this and we closed at weekly highs after sweeping (aggressively) the weekly lows on Fed day."
  And QQQ: "Right now we have a sweep of lows and decent push higher. The potential is there, now it's time for follow
  through or failure." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-bc2))

**The short side (2B tops) in UCT's words.** In the posts I searched, a failed breakout appears only as a read on the
market, never as a short setup on a single stock.
- "Considering Thursday a failed breakout which puts a potential right shoulder in play now." (SMH, unsigned, 2025-09-01,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1)) And: "IWM is the king of fake out breakouts."
- "Turning into a decently nasty failed breakout and correction." (QQQ, unsigned, 2026-10-25,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-36e))
- Bracco: "Unwinding pretty quick here following the failed breakout earlier this month and already -10% off the highs."
  (QQQ, 2026-11-01, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-669))

**The owner's rulings in the repo** (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`, searched 2026-11-09). None names
the 2B. The nearest:
- Kicker (UAL): "Sellers need to be trapped, so there needs to be like an almost failed breakdown vs just a little baby red
  candle."
- Go Signal: "GO SIGNAL is similar to the oops reversal or the UNR but is an hourly GO SIGNAL btw" and "GO SIGNALS are
  supposed to be notable hourly flags that undercut a slight range and quickly go red to green in the first hour". He
  treats the undercut-and-reclaim as one family on different time frames.
- Oops (LQDA): "I want it in a flag or as a like double bottom, or wedging down, or at the end of a downtrend. Location
  matters big time on these". Oops (SIBN): "I want it in good spots on good stocks". Oops (ULTA, FLEX, GTLB): a big red
  candle before it takes the stock off his list. Oops (PRKS): examples must work afterwards.

**What this means.** UCT uses the 2B in one specific way: a strong stock (RS) dips under a known low while the whole
market washes out, then reclaims it; the owner buys the reclaim (or a later, tighter spot) with the stop at the day's low.
UCT reads failed breakouts on the indexes as warnings but, in its leaders, buys them (the squat). Nobody at UCT has written
a 2B short on a stock in the public posts.

---

## 7. How it fits the owner's account rulebook (section 9)

| Rule | What it means for the 2B | Conflict? |
|---|---|---|
| A3, F62 stop a few cents under the day's or prior day's low | Sperandeo's stop is beyond the new extreme. On a same-day reclaim, the new extreme is the day's low, so the two agree. On a 1-3 day reclaim, the extreme may be an earlier day's low. | Small: name which low (question 6). |
| A13 stop usually within about 3% | My check: median 2.1%, two thirds within 3%; under half when the reclaim is slow; none when the undercut is over 3%. Six of UCT's seven named 2Bs undercut by 1.8% to 15.8% (NFLX's first break was 0.1%). | **Real.** Size down (A5), skip (A3), or wait for a tighter spot (question 6). |
| A4 the stop only moves up | Matches Sperandeo's "admit defeat immediately". | None. |
| B26 no longs below the 200-day; shorts only below it | About half of all liquid 2B bottoms in my check were below the 200-day; the house skips them. One of Bracco's seven (GEV) was below it. The curriculum's SPY 2011 example was far below it. The owner wrote he does not generally take undercuts "below the MAs". | **Real filter.** Longs above the 200-day only; shorts (2B tops) only below it. |
| C28 no chasing more than 4% past the buy point | The buy point is the broken low. A gap back more than 4% above it is skipped. | None. |
| C29 skip a long more than 10% above the 10-day | A 2B bottom sits at a low; almost never stretched. | None. |
| C31 RS 80+ except parabolic and mean-reversion | Bracco's version is "RS names". Is a 2B a mean-reversion trade? The house exempts mean reversion from C31. | **Needs a ruling** (question 5). My lean: apply C31. |
| D47 shorts are the longs reversed | The 2B top is the reversed 2B bottom. But UCT buys failed breakouts in leaders (the squat). | Shorts only below the 200-day (B26), RS 20 or less, borrow checked (D48). |
| E57 market orders | Sperandeo and Turtle Soup use a stop order at the old level; the house buys at market when it trades back above. | None in practice. |
| B19, E51, E52 trims at 3R and 5R, trail the 10 or 21-day | My check: when 3R came, it came in a median 6 sessions. Turtle Soup took partial profits in 2 to 6 bars. | None, but note the faster pace. |
| C33 time stop: under 1R after 10 days | Fits: a 2B that has not moved in 10 days has not "carried through" the other way. | None. |
| B22 no new buys in the 3 days before earnings | Applies. | None. |
| B20 a gap through the stop | Applies. | None. |
| B21, E56 re-entry and tries | After a stop-out, a new 2B needs a new trigger (B21); at most 3 tries a week (E56). Sperandeo's own re-entry sentence I could not read. | None. |
| B23 and D42 liquidity | Applies; the owner wants "good spots on good stocks". | None. |
| B18, F65, F68 market filter | Bracco's best 2Bs come as the market makes a low and turns. F68: start with a few positions as the reading turns Green. | None; it fits the house. |
| E50 grading is discretionary | Section 9 is a guide, not a checklist. | None. |

---

## 8. Proposed rules for our course

Every line is measurable on daily bars. ATR = 14-day average true range. "Swing low" = a daily low with no lower low in
the 5 sessions on each side (the definition my check used).

### 8.1 What it is (the setup, before any trigger)

- **One line.** A strong stock breaks a prior swing low, fails to follow through, and closes back above that low within
  one to three sessions. We buy the reclaim; the stop goes a few cents under the new low. [originator] [UCT]
- **Prior trend and location (long).** The close on the reclaim day is above the 200-day SMA. [house rule, B26] Best
  when the 200-day is rising and price is near the 50-day or 200-day, the way Bracco describes it. [UCT]
- **The level.** A swing low made 5 to 60 sessions before the break, with a rally of at least 1 ATR off it before the
  break. [my proposal; Turtle Soup's 3-4 sessions minimum and Bulkowski's median 21 days sit inside this window] Also
  allowed, by the owner's own usage: last week's low, a range low, or the low of a pullback to the 20 EMA or 50 SMA.
  [UCT] A one-day dip under yesterday's low is an Oops (setup 30), not a 2B. [my proposal]
- **First break.** The break is the first session to trade under that low since it formed. [my proposal; Sperandeo's
  "previous" extreme]
- **Depth.** The lowest low of the break is no more than 3% under the prior low (about 1 ATR or less in most leaders), so
  the stop fits A13. [house rule A13; my check: undercuts under 2% did best in R] Deeper undercuts are allowed only with a
  smaller size or a later, tighter entry (8.2). [my proposal]
- **Time.** A close back above the prior low on the break day or within the next 3 sessions. Same day or next day is the
  better grade. [originator: "within one day or less" for a minor extreme, "three to five days" for an intermediate one
  (1993), "immediately" (1994); Turtle Soup's same day or Plus One; my check]
- **Volume.** Quiet on the break (at or under the 50-day average), heavier on the reclaim. A grade booster, not a gate.
  [originator; my check agrees, weakly]
- **Leaders.** RS rating 80 or more, in a strong group. [house rule C31; UCT: "RS names"] (Question 5 asks whether the
  mean-reversion exception applies.)
- **Liquidity.** At least $10 and $20 million a day; never more than 1% of the average daily volume. [house rule B23, D42]
- **Earnings.** No new buy in the 3 sessions before a report. [house rule B22]
- **Clean lead-in.** No outsized red news candle just before the break (the owner's Oops rulings: a "big red candle
  prior" takes the stock off his list). [UCT, by analogy from the Oops rulings]

### 8.2 The buy (trigger and order)

- **Trigger.** Price trades back above the broken swing low after the undercut. [originator]
- **Order.** A market order when it trades back above (intraday), or near the close if the day closes back above.
  [house rule E57] Sperandeo and Turtle Soup use a stop order at the old level; in practice the same price.
- **The tighter alternative (for a deep undercut or a stop over 3%).** Wait for the next hourly higher low after the
  reclaim, or an inside day, and buy its break with the stop under that day's low. [UCT: "Next higher low on the hourly is
  actionable imo"] [my proposal for the 3% condition]
- **No chasing.** Not more than 4% above the broken low. [house rule C28]
- **Never before the reclaim.** Buying the undercut itself is guessing. [source consensus: Sperandeo's trigger is the
  return through the level; Bulkowski: buying the 2B bottom early carries a "much greater" risk of a failed trade]

### 8.3 The stop

- A few cents under the lowest low of the undercut (the new extreme). [originator: "use the new high to compute your
  initial stop"; house rule F62]
- If that is more than about 3% below the entry, size down so the risk stays inside the grade's budget, or use the tighter
  alternative in 8.2. Never move the stop closer to make the size bigger. [house rule A3, A5, A13]
- If price trades under the new low, out at once. [originator: "admit defeat immediately and take the loss"]

### 8.4 Trims and trail

- House defaults: a third at 3R, a third at 5R, trail the rest under the 10-day (fast movers) or 21-day; breakeven at 2R
  to 5R. [house rule B19, E51, E52]
- Take a trim at the open if it gaps over a trim level. [house rule F63]
- Note for the lesson: the first resistance is often the rally high between the two lows; in my check, 3R, when it came,
  came in a median of 6 sessions. [my proposal; my check]
- Time stop: still under 1R after 10 sessions, sell. [house rule C33]

### 8.5 What invalidates it

- A trade under the new low (the stop). [originator]
- No close back above the broken low within 3 sessions: it is a breakdown, not a 2B. [my proposal for the number;
  originator: a minor 2B fails "within one day or less", an intermediate one "within three to five days"]
- After the reclaim, a close back under the broken low within 2 sessions: tighten or exit; the failure has failed.
  [my proposal]
- The reclaim day closes in the bottom half of its range. [my proposal; the house Undercut & Reclaim scanner requires the
  upper half]
- Below the 200-day at entry (long). [house rule B26]

### 8.6 The short mirror (2B top)

- **Only below the 200-day.** A stock below a 200-day SMA rallies above a prior swing high, fails, and closes back under it
  within 1-3 sessions; short the move back under, stop a few cents above the new high. [originator; house rule B26, D47]
- RS rating 20 or less, weak group; skip if hard to borrow. [house rule C31 mirror, D48]
- **Not above the 200-day.** In an uptrend, a failed breakout in a leader is UCT's "squat", a buy: "Some call it the failed
  breakout-squat setup. I think if that happens you buy with 10 toes down." [UCT] My check also found no edge for 2B-top
  shorts above the 200-day (22.3% to 3R).
- Best in a Red market (mostly cash plus shorts below the 200-day). [house rule D46]
- Same depth, time, trims and time stop as the long, reversed. [house rule D47]

### 8.7 Best market conditions

- Long: the indexes are washing out under their own prior lows and reclaiming them ("the market put in a low"), the
  market reading is turning from Orange or Yellow toward Green, and leaders are undercutting their own lows near the 50-day
  or 200-day. [UCT: Bracco 2026-04-05; house rule F65, F68]
- Avoid: a market still making lower lows with no reclaim; isolated stock-specific breakdowns on news. [my proposal]
- Short: a Red market, a stock below a falling 200-day, a weak bounce into a prior swing high. [house rule D46]

### 8.8 Common mistakes (each from a source)

1. Buying the break before the reclaim. [Sperandeo's trigger; Bulkowski's "much greater" risk]
2. Holding when the new low breaks. [Sperandeo: "you lose properly!"]
3. Calling any dip under yesterday's low a 2B (the Model Book drawing does this). [my proposal]
4. Shorting a leader's failed breakout above the 200-day. [UCT squat; house rule B26]
5. Taking a deep undercut at full size: the stop is far wider than it looks. [house rule A13; section 4.5]
6. Trusting a loud break: heavy volume on the break did worse in my check, as Sperandeo would expect. [originator; my
   check]
7. 2Bs below the 200-day, or in names you would not normally trade. [house rule B26; owner's Oops ruling: "good spots on
   good stocks"]
8. Expecting the shape alone to pay: in my check it did no better than a random day. [my check]

### 8.9 Where the sources disagree: options and my recommendation

| Question | Options | My recommendation and why |
|---|---|---|
| Which level? | any swing low (Sperandeo); 20-day low (Turtle Soup); range low (Wyckoff); any known level (UCT) | A 5-session swing low 5-60 sessions old with a 1 ATR rally between, plus the owner's named levels (last week's low, range low). Measurable, and it keeps the 2B distinct from the Oops (one-day) and the U&R (moving averages). |
| How soon must it reclaim? | one day (minor), 3-5 days (intermediate), 7-10 days (major) (Sperandeo 1993, 2008); "immediately" (1994); same day or next day (Turtle Soup) | Within 3 sessions; same day or next day grades higher. Sperandeo's intermediate window (3-5 days) is the one for a daily swing chart; my check: same-day reclaims had tighter stops and more 5R wins. |
| How deep? | not given; within 5% (Bulkowski) | 3% or less for full size, because of A13; deeper only with a smaller size or a later entry. |
| Volume | quiet failure (Sperandeo) vs heavy break (curriculum draft) | Teach Sperandeo's: his words, and my check leans his way. |
| Entry | stop order at the level (Sperandeo, Turtle Soup); market order (house); next hourly higher low (owner) | Market order when it trades back above (E57); the hourly higher low as the tighter alternative. |
| Stop | beyond the new extreme; lower of two days' lows (Plus One); the day's low (owner) | A few cents under the lowest low of the undercut. Same as the day's low on a same-day reclaim. |
| Short side | identical to the long (all outside sources) | Only below the 200-day (B26); in leaders a failed breakout is a buy. |

---

## 9. Grading: what makes it an A+ versus a B-

The owner rules that grading is discretionary (E50). This is a guide built from the sources, not a checklist.

**A+ (all or nearly all of these):**
- An RS leader (80+) in a strong group, above a rising 200-day, undercutting a prior low near its 50-day or 200-day.
  [UCT; house rule C31, B26]
- The market itself is undercutting and reclaiming its lows at the same time; peers in the group do the same. [UCT:
  Bracco's "chart theme"]
- A clear, obvious prior low that many traders can see (a multi-week swing low or last week's low). [originator; UCT]
- A shallow undercut (under about 2%) and a same-day reclaim, closing in the top part of the day's range. [originator
  "immediately"; my check]
- Quiet volume on the break, heavier volume on the reclaim. [originator]
- Stop within 3%. [house rule A13]
- An orderly drift into the low, no big red news candle before it. [UCT: Oops rulings]

**A / B:** most of the above, but one of: the reclaim takes 2-3 sessions; the undercut is 2-3%; the stock is a good name
but not a top leader; the market is still mixed.

**B- (size down or skip):**
- Below the 50-day with a flat or falling 200-day (and never below the 200-day, B26). [house rule]
- A deep undercut (over 3%) bought at the reclaim with the wide stop. [house rule A13; my check: over 5% reached 5R only
  7.2% of the time]
- A loud break (1.5x volume or more) with a weak reclaim. [originator; my check]
- The level is minor (a few days old) or already broken before. [my proposal; Chart IQ's replay shows why]
- Earnings within days; an obscure or thin name. [house rule B22, B23; UCT]

---

## 10. Questions for the owner

1. **One setup or a family?** (a) Keep the 2B as its own setup; (b) teach one "undercut and reclaim" family with four
   costumes: the 2B (a prior swing low), the Oops (yesterday's low, by a gap), the U&R (a moving average or support), and
   the Go Signal (the hourly version); (c) drop the 2B name and use your words ("undercut and reclaim", "failed
   breakdown"). Your Go Signal ruling already calls these one family.
2. **Which lows count?** (a) any swing low 5-60 sessions old with a rally between (my proposal); (b) only multi-week lows
   the whole market can see; (c) also last week's low and range lows, as in your posts.
3. **How fast must the reclaim be?** (a) same day only; (b) same day or next day; (c) within 3 sessions.
4. **The entry.** (a) market order when it trades back above the old low; (b) only on a close above; (c) your AMD way,
   the next hourly higher low; (d) over the reclaim day's high.
5. **RS rule.** Is a 2B a "mean-reversion" trade exempt from C31, or does it need RS 80+ like Bracco's "RS names"?
6. **The stop when the undercut is deep** (Bracco's April 2025 and March 2026 names undercut by up to 15.8%; only SPOT
   and NFLX stayed under 4%): (a) stop under the new low and
   size down; (b) skip it; (c) wait for a tighter spot (hourly higher low, inside day) with its own stop. And on a 1-3 day
   reclaim, is the stop under the lowest low of the undercut, or under the day you buy?
7. **The short side.** (a) teach 2B tops only below the 200-day; (b) do not teach 2B shorts on stocks at all, only as a
   market warning, as the posts do. And confirm: in leaders above the 200-day, a failed breakout is your "squat" buy.
8. **Volume.** Sperandeo says the failure comes on quiet volume; the draft curriculum says heavy volume is the trapped
   crowd. Which do you want taught?
9. **Your 2025-12-07 note** said you were adding "a variety of that setup" (short-term undercuts below the MAs) to your
   playbook. Did that become a rule? B26 now forbids longs below the 200-day; is a 2B below the 50-day but above the
   200-day fine?
10. **The app.** Chart IQ computes a `two_b_reversal` label that, as far as I traced, is not shown today. (a) Fix it
    before it is ever shown (require the close back above the broken low and a first break, add the 2B top below the
    200-day); (b) remove it; (c) leave it. And redraw the Model Book glyph with a visible
    prior swing low, a rally, the undercut and the reclaim?
11. **The curriculum's SPY 2011 example** was a long far below the 200-day. Replace it with a house-legal example (for
    instance one of Bracco's April 2025 names above the 200-day)?
12. **Examples.** Do you want the 10 model examples drawn from Bracco's named April 2025 and March 2026 leaders first, then
    others that pass your Oops rules (good liquid names, orderly drift, no big red candle before, worked afterwards)?

---

## 11. Sources

All read 2026-11-09 unless noted.

| # | Source | Publisher / author | How read | Reliability |
|---|---|---|---|---|
| 1 | *Trader Vic: Methods of a Wall Street Master* (1991; printed copy 1993), https://archive.org/details/tradervicmethods0000sper and https://archive.org/details/tradervicmethods00vict | John Wiley & Sons; Victor Sperandeo with T. Sullivan Brown | archive.org full-text search passages, saved and checked by script; re-searched by the checker through `be-api.us.archive.org/fts/v1/search` | Originator, primary. Partial reading: rule, time rule, volume, loss rule. The book's index places the 2B rule at pages 78-81, 82, 178 and 181 (chapter 7, Figures 7.9-7.13). |
| 2 | *Trader Vic II: Principles of Professional Speculation* (1994), https://archive.org/details/traderviciiprinc00vict_0 | John Wiley & Sons; Victor Sperandeo | same | Originator, primary. Partial. |
| 3 | *Trader Vic on Commodities* (2008), ch. 4 "2B or Not 2B: A Classic Rule Revisited", pp. 23-34, https://archive.org/details/traderviconcommo0000sper | John Wiley & Sons; Victor Sperandeo | same; chapter data from Crossref, https://api.crossref.org/works/10.1002/9781119196792.ch4 | Originator, primary. Partial. |
| 4 | "2B Pattern", https://thepatternsite.com/2B.html (page updated 6/10/25) | Thomas N. Bulkowski | web tool, four reads (plain download blocked, HTTP 406) | Best measured data; carries a notice against AI training (flagged in 3.4). Measures moves, not trades. |
| 5 | "Time" page, https://www.thepatternsite.com/Time.html | Thomas N. Bulkowski | web tool, one read | Definition of "ultimate high/low" only. Same AI notice applies site-wide. |
| 6 | "What Turtle Soup Can Do For You" (June 13, 2001), https://tradingmarkets.com/recent/what_turtle_soup_can_do_for_you-645410 | TradingMarkets (The Connors Group); Marc Dupee | downloaded | The originators' firm, secondary to *Street Smarts*. |
| 7 | "Breakout After Failure" (July 25, 2006), https://tradingmarkets.com/recent/breakout_after_failure-654653 | TradingMarkets; John Patrick Lee | downloaded | Same; disagrees with item 6 on the age of the prior low. |
| 8 | "The Wyckoff Method: A Tutorial", https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial | StockCharts ChartSchool; Roman Bogomazov and Michael Lipsett | downloaded | Established educator for the Wyckoff cousin. |
| 9 | UCT Substack, 103 posts via https://unchartedterritoryy.substack.com/sitemap.xml; quoted posts: sunday-scans-356, -04c, -0d2, -6a6, -461, -fcd, -807, -dec, -da5, -31b, -088, -898, -bc2, -09b, -ffa, -d6a, -ae1, -4d1, -2f5, -33a, -a43, -36e, -669 | Uncharted Territory (owner, Bracco, unsigned sections) | Substack public API, fresh copies | House voice; outranks outside writers on how we trade it. |
| 10 | `docs/study/sizing_rule.md` section 9; `docs/study/TRADE_PLANS.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | this repo | read | The owner's rules and rulings. |
| 11 | `api/services/chart_iq/engine/v3.py`, `engine/v4_compose.py`, `pipeline.py`; `api/routers/chart_iq.py`; `api/services/pattern_engine/detectors/uct/{uct_undercut_reclaim,u_and_r,wyckoff_spring,wyckoff_upthrust,uct_oops_reversal}.py` | this repo | read | What the app actually does. |
| 12 | `app/src/pages/modelbook/setupCatalog.js`, `SetupsView.jsx`; `app/src/constants/setupGroups.js`; `api/services/journal_two/coach_prompts.py`; `api/services/desk_session_insights.py`; `app/src/components/chart/engine/ast/starterScans.json` | this repo | read | House labels and text. |
| 13 | `docs/curriculum/uct_method_{course,chapters,scripts}.json` (M10.L2); `docs/study/UNITS-method.md`; `docs/study/plan-review.html`; `docs/study/research/definitions.json`; `docs/study/levels/dossiers/oops.md` | this repo | read | Planning drafts; not the owner's words. |
| 14 | My checks: mechanical 2B bottoms and tops, a random-day baseline, a replay of Chart IQ's rule, and Bracco's named examples, on the local sandbox daily bars | me | scratch scripts, not committed | Indicative only; limits in 4.4. |
| 15 | *Stock Trader's Almanac* 2015 (Jeffrey A. Hirsch; archive.org item `stocktradersalma0000jeff`, dated 2014) and one more edition, as seen in archive.org full-text search passages | Wiley, per archive.org metadata | search passages only (re-found by the checker) | Secondary; shows a drifted quote ("dip" for "drop"). |
| - | Not read (blocked or unavailable): Traders.com S&C articles (403); Wiley Online Library chapter page (403); O'Reilly, Bulkowski *Trading Basics* ch. 5 (403); *Working Money* 677 (520); IBD reprints on inkl (403); *Street Smarts*; *The New Market Wizards* interview | various | - | No wording from them is used. |

---

## Appendix: ten candidate examples (machine-found, not reviewed or approved)

The owner asked for 10 examples per setup. These are **candidates for his review, not examples he has approved**. Source:
my mechanical 2B bottom (section 4.4) on the local sandbox bars, filtered to well-known liquid names, a same-day or
next-day reclaim, an undercut of 3% or less, a leader proxy (6-month gain of 20% or more, within 25% of the 52-week high,
rising 200-day), a market pullback (SPY at least 5% off its high, or below its 50-day), a stop of about 3.5% or less, a
trade that reached 3R (his PRKS ruling: examples must work), and no earnings report in the 3 sessions after the entry (B22,
checked against the repo's `docs/study/setups/earnings_dates_cache.json`). Prices are as stored in the local bars
(split-adjusted; CRWD's stored prices are about a quarter of the prices I remember for 2020, so check every level on a
charting platform before use). Entry is the reclaim day's close; the stop is 5 cents under the undercut's low.

| # | Stock | Reclaim day | Prior swing low | Undercut | Stop distance | Break-day volume vs 50-day | SPY off its high | 20 sessions later | Sessions to 3R | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | NVDA | 2023-03-13 | 2023-03-02, 22.43 | 0.6% | 3.1% | 0.86x | 16.5% | +18.3% | 3 | March 2023 market stress; quiet break |
| 2 | TSM | 2020-09-24 | 2020-09-08, 77.22 | 1.4% | 2.9% | 0.83x | 9.6% | +12.5% | 9 | September 2020 pullback; quiet break |
| 3 | MSFT | 2020-09-18 | 2020-07-24, 197.51 | 0.6% | 2.1% | 1.57x | 7.6% | +9.6% | 9 | same pullback; a two-month-old low |
| 4 | AMZN | 2020-09-21 | 2020-07-24, 144.40 | 0.6% | 3.1% | 1.23x | 8.6% | +8.3% | 13 | same pullback; slow to pay |
| 5 | CRWD | 2020-07-24 | 2020-07-16, 24.65 | 1.6% | 3.2% | 0.57x | 5.2% | +12.0% | 3 | quiet break; stored prices look adjusted |
| 6 | DELL | 2023-10-26 | 2023-10-05, 64.32 | 0.7% | 1.0% | 0.83x | 9.9% | +15.3% | 2 | the October 2023 market low; tight stop |
| 7 | GOOGL | 2023-08-18 | 2023-08-03, 127.42 | 0.8% | 0.9% | 0.98x | 4.7% | +8.4% | 3 | August 2023 pullback; tight stop |
| 8 | HOOD | 2024-05-01 | 2024-04-17, 16.46 | 0.9% | 2.3% | 0.61x | 4.4% | +31.2% | 2 | quiet break; earnings 5 sessions later (B22 allows it) |
| 9 | META | 2023-10-26 | 2023-09-27, 286.79 | 2.6% | 3.1% | 3.28x | 9.9% | +17.3% | 5 | **the day after its earnings report** (cache: 2023-10-25); a loud break; the owner calls earnings-day Oops examples "meh" |
| 10 | NFLX | 2024-04-22 | 2024-02-13, 54.90 | 1.3% | 2.4% | 2.47x | 4.5% | +15.5% | 10 | **the session after an earnings gap down** (cache: report 2024-04-18); his ELVN ruling calls a reversal after a news gap a "delayed reaction setup" |

**Dropped for the house rules (they teach B22).** AAPL 2014-10-15 (a clean 2B at the October 2014 market low, +14.1%
twenty sessions later) had earnings 3 sessions later (2014-10-20 in the cache). MU 2025-12-17 (+60.9%) was bought on its
earnings day (2025-12-17 in the cache). Both "worked", but B22 forbids both buys.

**Better first candidates: UCT's own.** Bracco's named 2Bs (section 4.5) are the examples with a house voice behind them:
SPOT (April 2025: a 1.8% undercut, same-day reclaim, above the 200-day) fits these rules; NFLX fits on its first break
(0.1%, same-day reclaim) and its second dip (3.9%) is just over the 3% depth line; HOOD, PLTR, ASTS and RKLB fit UCT's
description but undercut about 7% to 16%, so they teach the deep-undercut problem (question 6); GEV was below its
200-day (B26). Chart images of the candidates are in my scratch folder, not in the repo. The checker recomputed all ten
rows from the bars (prior swing low, undercut, stop, break-day volume, 20-session return, sessions to 3R, 200-day) and
the earnings dates named (META 2023-10-25, NFLX 2024-04-18, HOOD 2024-05-08, AAPL 2014-10-20, MU 2025-12-17) against the
cache; all agree. The "SPY off its high" column differs by 0.1 to 0.3 points depending on whether the 52-week high is
taken from closes or highs; treat it as approximate.

---

## Removed in checking

Changes made by the cold check (2026-11-09). Nothing else in the first draft failed verification: every outside quote
was found word for word on its page (Sperandeo through archive.org's full-text search, Bulkowski, TradingMarkets,
ChartSchool), every one of the 36 Substack quotes was found in the named post on the named date and in the section
attributed, every owner ruling quoted is in `owner_verdicts.jsonl`, every repo line cited reads as described, and the
4.4, 4.5 and appendix numbers recompute.

1. **Removed:** the claim (short answer 1, sections 3.1, 3.9, 3.10, 8.9) that Sperandeo gives no time window and that
   "Nobody gives a number of days except Turtle Soup". The 1993 book gives one, by degree of trend: "within one day or
   less" (minor), "within three to five days" (intermediate), "within seven to ten days" (major); the 2008 book repeats it
   ("a day or two", "three to five days", "up to 10 days"). The fragment the writer could not place ("will usually break
   within seven to ten days") is the third of those sentences. Fixed throughout, and the proposed 3-session window in
   8.1 now carries an [originator] basis for its number.
2. **Fixed:** section 1 said the 1994 and 2008 books "add" the sentence "The converse is true for downtrends." It is in
   the 1993 book as well, directly after the rule.
3. **Fixed:** the NFLX row in 4.5 merged two undercuts. The first break of the 85.45 low (2025-04-04) went 0.1% under
   and closed back above the same day; the 3.9% dip to 82.11 was a second undercut on 2025-04-07, also reclaimed the same
   day. The sentences built on that row (4.5, question 6, the appendix) were reworded.
4. **Fixed:** the Substack term counts for "failed breakdown" and "failed breakout" (23 and 13 in the draft; the
   checker's recount is 24 occurrences in 16 posts and 14 in 11; the "undercut" and "shakeout" counts of 116 and 112 were
   confirmed as occurrence counts).
5. **Reworded as unverified:** section 3.8's statement that IBD's double bottom requires the second low to undercut the
   first. No IBD page could be opened by either reader, so it stands as a recollection, not a sourced criterion.
6. **Added (not removed):** the 1993 index entries (2B rule, pp. 78-81, 82, 178, 181; 1-2-3 criterion, pp. 76-77,
   178, 268), the chapter-7 figure references, the rest of the exit sentence ("when prices break past the new 2B high"),
   the rest of the 50% sentence, the "stay at the table" clause, the start of the 2008 re-entry sentence ("initiate the
   position again if the market once again"), Bulkowski's one-line summary of Sperandeo, the Almanac's publisher, and an
   independent replication of the 4.4 test.

---

## 12. Examples (from our data)

**The scan's rule (one paragraph).** Daily bars from the local sandbox, 1984 to 2026-11-06, the 2,630 names that ever
met the house liquidity rule (the scan completed, 2,630 of 2,630, in about 7 minutes; nothing was cut for time; scratch
script `scratchpad/setups/28-2b-reversal/scan_2b.py`, not in the repo). A 2B bottom follows section 8: the level is a
swing low (no lower low in the 5 sessions on each side) made 6 to 60 sessions before the break, with a rally of at least
1 ATR(14) off it; the break day is the FIRST session to trade under that low since it formed; the undercut's lowest low
is 3% or less under the level; the trigger day is the first close back above the level, on the break day or within the
next 3 sessions, and that day closes in the upper half of its range (8.5); close above the 200-day SMA (B26); close $10
or more and 50-day average dollar volume $20 million or more (B23); the market-order fill is the level plus a cent as price trades back up through it, EXCEPT when a LATER session
(not the break day) opens above the level: a gap over it fills at the open. (Rescanned 2026-11-10: the first scan also
filled at the day's open when the break day itself opened above the level, which no trader could have done, because the
undercut and the reclaim come later that day.) No fill more than 4% over the level (C28) or more than 10% over the 10-day SMA (C29); stop 5 cents under the
lowest low of the undercut (8.3). The 2B top (short) is the mirror with the close BELOW the 200-day (B26, D47). Break
volume, reclaim volume, the close position, the age of the level and the rally size are recorded as grade cues, not
gates. Not coded: the RS rating and group (C31), the market reading (8.7), earnings dates (B22; checked by hand for the
10 examples), the "clean lead-in" and the trims. Outcome: from the day after the trigger, 60 sessions forward, the first
of stop / 3R / 5R; a day that touches both counts as stopped.

**Base rate (rescanned 2026-11-10 with fills at the reclaim; the earlier figures used the open).** 74,068 hits (46,377
longs, 27,691 shorts), 1988-07-12 to 2026-11-09 (the bars database was refreshed after the first scan; the
same rule at the open gave 71,881 hits to 2026-11-06), all 2,630 names. Longs: **56.7% reached 3R and 45.1% reached 5R before
the stop**; 80.5% were eventually stopped at the original stop inside the 60 sessions (that includes winners, since the
stop never moves here) and 25.5% never reached 1R; the median stop was 1.08% of price. Shorts (below the 200-day): 52.6%
to 3R, 40.8% to 5R, median stop 1.11%. Among the long winners the median time to 3R was 1 session. *Was (fills at the
open on a same-day reclaim): 71,881 hits (44,919 longs, 26,962 shorts); longs 42.7% to 3R and 30.2% to 5R, 81% stopped,
33.6% never reached 1R, median stop 1.69%, median 3 sessions to 3R; shorts 39.0% / 26.5%.* The rate went UP, not down:
the buy is now the level plus a cent instead of the open, so R (buy to stop) is smaller and 3R is a smaller move; the
change is in the same-day reclaims (28,067 long hits), which now fill at the level (median stop 0.70%, was 1.63%).
**Caveats.** (1) Fixed stop, no trims,
no breakeven move, no trail, no time stop: it measures how often the structure delivers 3R and 5R, not what the house
trade earns. (2) A daily bar cannot order the day. The stop is 5 cents under the undercut's lowest low, and for a
same-day reclaim that low is the day's low, which may have formed AFTER the fill; a live trader's stop would be under the
low so far when the reclaim happened. Each fill therefore uses a stop that is known only at the close, so the same-day
figures are an upper bound. A check on the 406 same-day hits in the sandbox's 5-minute window (2026-08-17 to 2026-11-06,
1,000 names; 5-minute bars cannot order events inside one bar) found 60.3% to 3R with the daily convention and 31.0% when
the stop is the low so far at the fill and a later lower low the same day counts as a stop-out (195 of the 406 made one);
the median stop was 0.64% and 0.37%. Read the same-day number as "between about a third and about two thirds". (3) With a
stop a few cents under a shallow undercut, R is often under 1% of price (23% of long hits have a stop of 0.5% or less), so
3R is a very small move and slippage of a few cents matters more here than in any other setup. Section 4.4, which
entered at the CLOSE of the reclaim day, found 27% to 3R; the gap between 27% and 57% is mostly that difference in fill (a
later, higher fill with the same stop makes R larger and 3R farther away). (4) Survivorship: the universe is today's
tickers. Cuts worth teaching (longs; 3R / 5R; the earlier figures in brackets): a next-day reclaim (12,149 hits) 47.9% /
33.6% [12,143: 47.9% / 33.6%, unchanged: the fill there was already the level or a real gap open], against 64.3% / 54.2%
for a same-day reclaim (28,067 hits) [41.0% / 29.6%] and 39.4% / 26.0% for 2-3 days [39.5% / 26.0%], and the same-day figure is the
one most affected by caveat 2 (the live-stop check there gives 31.0%, under the next-day 47.9%); a quiet break
(volume at or under the 50-day average, 18,364 hits) 57.7% / 46.9% [43.0% / 30.8%] against 56.6% / 43.8% for a loud one
(over 1.5x) [42.3% / 29.3%], so Sperandeo's preference holds, only weakly; an undercut of 1% or less (26,267 hits) 64.7% /
55.0% [44.4% / 32.6%], 1-2% 48.6% / 34.8% [41.4% / 28.7%], 2-3% 41.8% / 26.8% [38.4% / 23.9%], so the shallower the
undercut the better, as 8.1 proposes; stop distance of 1% of price or less (21,826 hits) 67.3% / 58.5% [9,932 hits: 55.5%
/ 43.5%] against 42.3% / 27.6% for stops over 2% [34.7% / 22.0%], but a sub-1% stop is also the one most exposed to
slippage and noise, so teach it as "tight stops pay, when they are real". The age of the level (6-15 sessions against
over 30) made little difference (55.5% against 59.9% to 3R [42.3% against 44.1%]). A gap fill at the open on a later
session (longs and shorts together, 11,430 hits, median stop 1.86%) reached 3R 43.4% and 5R 29.0%.

**The 10 examples** (8 longs above the 200-day, 2 shorts below it; one per name, ten different years; none within 3
sessions of an earnings report before or after the entry, checked against the earnings table; every one reached 5R and
was above 1R by the tenth session, so the time stop C33 would not have cut it; prices are split-adjusted as the
database holds them, so check each level on a charting platform before use, INTC 2026 in particular, whose stored bars
more than double in the following 20 sessions). Files: `scratchpad/setups/28-2b-reversal/final/NN_TICKER_DATE.png` and
the phone sheets `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` (not in the repo). "Level" is the prior swing low
(or high) and its date; "age" is sessions from the level to the break; "undercut" is how far under (over) the level the
break went; "back in" is sessions from the break to the reclaim close; "break vol" is the break day's volume against the
50-day average.

| # | Ticker | Trigger | Side | Level (date, age) | Undercut / back in / break vol | Buy | Stop (risk) | Best R (3R on day) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|
| 1 | GLW | 2008-08-12 | short | 21.55 (2008-07-29, 9) | 0.97% / 1 / 0.92x | 21.54 | 21.81 (1.25%) | 43.5R (1) | The 2B top in a bear market: a bounce under a falling 50- and 200-day poked 1% over the July high on quiet volume, closed back under the next day, and the stock lost a quarter of its value in 20 sessions. Shorts only below the 200-day (B26). |
| 2 | RL | 2009-07-08 | long | 49.57 (2009-06-23, 9) | 0.75% / 1 / 0.73x | 49.58 | 49.15 (0.87%) | 67.4R (1) | The July 2009 market low: a pullback to a flattening 50-day undercut the June low by 0.75% on the lightest volume in weeks, closed back above the next day, 3R the day after, and the lowest low of the next 30 sessions was the level itself. |
| 3 | DINO | 2018-03-01 | long | 42.88 (2018-02-09, 12) | 1.07% / 1 / 1.10x | 42.89 | 42.37 (1.21%) | 64.3R (2) | The February 2018 correction low retested: the second trip under the 50-day went 1% under the first, held, and the reclaim day closed on heavier volume (1.3x) than the break. Price went from the level to new highs in two months. |
| 4 | SHOP | 2019-11-08 | long | 28.61 (2019-09-25, 31) | 1.39% / 1 / 0.92x | 28.62 | 28.16 (1.6%) | 45.4R (1) | Bracco's version of the setup: a leader down near its rising 200-day (6.9% above it at the trigger) undercuts a six-week-old low by 1.4%, closes back above the next day, and does not look back; the level held on every later test (30-session low 29.35). |
| 5 | QCOM | 2020-09-21 | long | 109.62 (2020-09-08, 9) | 1.20% / 0 / 0.85x | 109.63 | 108.25 (1.26%) | 37.3R (1) | The September 2020 pullback (the appendix's TSM, MSFT and AMZN are the same week): an intraday undercut of the September 8 low, reclaimed the same session on quiet volume with a close in the top 6% of the range; 3R the next day. The same-day version of the trade. |
| 6 | U | 2022-04-05 | short | 108.53 (2022-03-01, 24) | 1.35% / 1 / 0.85x | 108.00 | 110.04 (1.89%) | 38.7R (1) | The 2B top in the 2022 bear: a bounce to the falling 50-day pushed 1.4% over the March high, reversed the next day with a close in the bottom 2% of the range, and the stock fell 31% in 20 sessions. Below the 200-day (18.8% under it) as D46/B26 require. |
| 7 | JBL | 2023-08-18 | long | 101.22 (2023-06-27, 37) | 1.03% / 0 / 0.64x | 101.23 | 100.13 (1.09%) | 36.5R (2) | The August 2023 pullback (the appendix's GOOGL is the same day): a seven-week-old low undercut by 1% on the quietest volume of the ten (0.64x), reclaimed the same day under the 50-day. Slower to pay (3R on day 2, +4% after 20 sessions) before the gap to 130: the case for the trims. |
| 8 | MU | 2024-02-20 | long | 80.58 (2024-01-03, 31) | 1.77% / 1 / 1.07x | 80.59 | 79.10 (1.85%) | 33.5R (2) | A six-week shelf on a rising 50-day: the undercut of the January low ran 1.8% deep, the next day closed back above in the top 4% of its range, and the low of the next 30 sessions (79.94) sat 84 cents above the stop. A deeper-than-average undercut that still fit A13. |
| 9 | MKSI | 2025-11-21 | long | 136.95 (2025-11-04, 13) | 1.61% / 0 / 0.67x | 136.96 | 134.69 (1.66%) | 58.6R (1) | A same-day undercut and reclaim: the day opened at 138.24, above the level, fell to 134.74 (1.6% under), and closed back above at 144.00, so the market order fills as price comes back up through the level (136.96), not at the open, with the stop 5 cents under the undercut low. (Rescanned 2026-11-10: the first scan filled at the 138.24 open, 2.57% stop, 37.1R, which no trader could have got. A buy at the level means watching the reclaim intraday.) Still a textbook trigger: 3R the next day. |
| 10 | INTC | 2026-03-31 | long | 41.64 (2026-03-09, 15) | 2.43% / 1 / 0.81x | 41.95 | 40.58 (3.27%) | 72.6R (1) | The deepest undercut (2.4%) and the widest stop (3.3%, just over the A13 line, so half size or the hourly higher-low entry of 8.2): a quiet break of the March low, a next-day reclaim closing in the top 4% of the range, 3R the next day. Verify these stored prices before use. |

Reviewed and dropped in the visual check (none failed the scan): AIG 2010-11-29 (a clean 0.49% undercut and 41.9R, but
the chart that follows, a collapse through the level eight weeks later, distracts from the lesson), MGM 2013-11-21 (a
0.49% undercut with a 0.81% stop, too small to see on a daily chart), VKTX 2024-08-05 (the August 5 2024 washout, but the
stock had fallen from 80 to 48 under its 50-day first, so the "strong stock" condition of 8.1 was not met: a mean
reversion, not a 2B in a leader). Also passed over: the top of the ranked list is full of hits with stops of 0.3-0.5% of
price (BBY 2020-06-15, 137R on a 0.42% stop; MTN 2020-10-02, 128R on a 0.34% stop); they are real by the rule but a
learner should not be shown a 0.4% stop as normal. BB 2007-06-27 fit the picture but had an earnings report within 3
sessions after the entry (B22), so it was excluded.

**Notable failures (in words).** NVDA 2024-04-18: the April 9 low (83.02) was undercut by 0.75% and reclaimed the same
day, the 18th (open 84.97, low 82.40, close 84.67, upper half, stop 82.35); the next day, April 19, the stock opened 83.15 and fell to 75.61, a
9% day through the stop with no warning on the daily chart. The market (and the chip group) was still making lower lows,
the 8.7 condition the scan cannot read. AMD 2024-04-16: the same week, the same group; the February 21 low (161.81) was
undercut 1.9% on April 15, reclaimed on the 16th (close 163.46), and the next day it fell 6% to 154.02, through the
stop at 158.71. TSLA 2023-08-11: the June 26 low (240.70) was undercut 1.1% and reclaimed the same day (close 242.65);
the next session gapped under the level and the stock fell for four more days to 219, a second, deeper break in which
the "failure had failed" (8.5). All three were liquid leaders above the 200-day with quiet breaks; the common thread is
a market still in its decline, which is why 8.7 ("the indexes are washing out ... and reclaiming them") is a gate, not a
footnote, and why the stop is honoured at once (8.3). The scan's own numbers say the same: a quarter of all long hits
never reached 1R (a third in the first scan, which filled at the open).

## 13. Failures and near-misses (from our data)

Added 2026-11-10 (deliverable 4 of `CRITERIA_PROGRAMME.md`). Everything below is read off the same scan as section 12
(`final/hits.json`) or off a re-run of `scan_2b.py` with one gate relaxed at a time (`near_scan.py`, a 450-name
random subset of the liquid universe, 150 seconds per gate), never off a chart alone. Charts: `final/fail_1-4.png`
(the four failures, one column), `final/near_1-4.png` (the four near-misses) and `final/pair_29-undercut-rally.png`
(a textbook 2B over a textbook U&R), in `_study-resume/scratchpad/setups/28-2b-reversal/` (scratch, not in the repo).
Every chart carries the buy point, the stop, 3R and 5R and the prior-low box, so a learner can compare a failure or a
near-miss with the winners of section 12 at a glance. SPY numbers are the sandbox's own bars.

**Failures: valid 2Bs, traded by the rules, stopped before 3R.** All four passed every gate the scan can read (above
the 200-day, a swing low 7 to 33 sessions old with a rally of 2 ATR or more off it, the first break, an undercut of
0.75% to 1.65%, a reclaim close in the upper half on the break day or the next, quiet break volume, $100 million or
more a day), and all four were stopped on the first session after the entry with a best excursion of 0.0R.

| # | Ticker | Trigger | Prior low (date) | Undercut / closes under / reclaim | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|---|
| 1 | PYPL | 2018-03-26 | 76.93 (03-02) | 0.75% / 1 / next day | 77.98 (the open, 1.4% over the level) | 76.30 (2.15%) | 03-27, low 75.65 | The day after the entry opened 79.59 and closed 76.31, through the stop. SPY went on to a lower low on 04-02 (254.67, under its 257.83 March low): the market was still washing out, not reclaiming. | tb.market_washout |
| 2 | MGM | 2017-07-05 | 30.82 (06-12) | 1.65% / 1 / next day | 30.83 | 30.26 (1.85%) | 07-06, low 30.26 (the stop to the cent) | The next day's low touched the stop exactly, the low of the move came the day after (30.20), and the stock was 31.98 twenty sessions later. The stop did its job; a new try needs a new trigger. | tb.after_entry_stop |
| 3 | TSLA | 2023-08-11 | 240.70 (06-26) | 1.11% / 0 / same day | 240.71 (the level plus a cent; was 241.77) | 237.97 (1.14%) | 08-14, low 233.75 | The next session opened 235.70, under the level, and the stock fell to 212.36 by 08-18: the failure failed. It was 273.58 twenty sessions after the entry, from a later, lower base. | tb.reclaim_fails |
| 4 | NVDA | 2024-04-18 | 83.02 (04-09) | 0.75% / 0 / same day | 83.03 (the level plus a cent; was 84.97) | 82.35 (0.82%) | 04-19, low 75.61 | The next day opened 83.15 and fell to 75.61, a 10% day straight through the stop; SPY made a lower low the same day (493.86 under its 499.12 20-session low). (Rescanned 2026-11-10: the undercut and the reclaim were both on 04-18, which opened at 84.97, so the buy is the level plus a cent as price came back up, 83.03, with the stop 0.82% under it; the first scan filled at the 84.97 open, before the undercut, with a 3.08% stop.) | tb.market_washout |

**Near-misses: charts that look like a 2B and fail exactly one gate.** Each was found by relaxing that one gate in the
scan and keeping only the hits the strict rule rejects for it; every other gate passed.

| # | Ticker | Date | The one criterion that fails | The number | Prior low / closes under / reclaim | What it really is |
|---|---|---|---|---|---|---|
| 1 | DELL | 2024-07-22 | tb.depth | The undercut went 4.36% under the 127.59 low (to 122.03); the rule is 3% or less. The stop that follows is 4.83% from the entry. | 127.59 (06-07) / 3 / day 3 | A deeper break that happened to close back above: not a 2B at full size. By the card, a smaller size or the hourly higher-low entry, or no trade. It never traded above the entry and fell to 88 within three weeks. |
| 2 | GS | 2017-01-25 | tb.reclaim_window | 6 closes under the 236.64 low before the first close back above (reclaim on day 6); the rule is within 3 sessions. | 236.64 (12-29) / 6 / day 6 | A Remount of a level (setup 32), bought on the retake of the line with the stop under the remount day's low, not on the reclaim of a low. Made 0.67R and was stopped. |
| 3 | GOOG | 2026-07-20 | tb.reclaim_close | The reclaim day closed at 0.14 of its range (a gap over the level that sold off all day); the rule is a close in the upper half (0.5 or more). | 348.66 (07-09) / 1 / next day | A failed reclaim, not a trigger: the close is back near the low, so the buyers who lifted it at the open were gone by the bell. Best 0.06R, stopped. |
| 4 | META | 2026-01-08 | tb.above_200 | The reclaim-day close was 4.2% under the 200-day SMA; the rule is a close above it. | 638.61 (12-12) / 0 / same day | A 2B shape in a stock below its 200-day: watch only under B26 (the dossier's rule; D-009 is still pending). Rescanned 2026-11-10 with the buy at the level plus a cent (638.62, stop 635.67, 0.46%; was 645.88 and 1.58% from the open): best 5.5R, 3R on day 1, then stopped. It paid here, so the lesson is about odds under B26, not about this chart. |

**What the failures have in common.** None gave a warning on its own chart: each reclaim day closed in the upper half
on quiet volume, three of the four had an undercut under 1.2%, and all four were stopped on the very next session with
a best excursion of 0.0R. Two of them (PYPL in March 2018, NVDA in April 2024) came while SPY was still making lower
lows, the market condition the card's tb.market_washout names and the scan cannot read; TSLA is the "failure that
failed" case (a gap back under the level the next morning); MGM is the plain cost of the setup, a stop touched to the
cent on a shakeout the stock then rallied from. The teaching is the card's own: the stop goes under the undercut low
and is honoured at once, a close back under the level is the warning, and a market still making lower lows is not the
place for the first try. The near-misses show the three numbers a learner must count before calling a 2B: how far
under (3% or less), how many closes under (none past the third session), and where the reclaim day closed (upper
half), with the 200-day as the fourth, non-negotiable line.
