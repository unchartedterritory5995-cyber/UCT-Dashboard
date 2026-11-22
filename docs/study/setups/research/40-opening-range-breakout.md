# Setup 40: Opening Range Breakout and Breakdown (long and short)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
PDF or file named next to it and is 40 words or fewer. A script checked every quoted string in this file (262) word for
word against the downloaded pages, PDFs, posts and repo files (whitespace ignored). The only ones not found verbatim are
titles and terms, one JavaScript string that the source splits across two lines, and one PDF word broken by a
line-break hyphen ("combin-ing"). Nothing here is a ruling. Where I could not read a source, I say so and give no wording
from it.

**Cold check (2026-11-09, a second reader).** Every web source, PDF and Substack post named below was downloaded again and
every quoted string was re-checked by a second, independent script (204 quoted segments found verbatim, whitespace and
curly quotes ignored; the only misses were titles, the term "Open-Drive" and the hyphen-broken word above). Every
publish date, page number, journal issue, table figure and KB number was checked against its page or file; the detector
code, the scan wiring in `api/main.py`, the registry, the router, the Model Book card, the playbooks, the journal tags
and the rulebook rule numbers were read against the text here; the own count in section 4.8 was re-run on the same
database and reproduced every figure. The corrections made are listed in section 12, "Removed in checking".

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named author's own
words; **[UCT]** the owner's verdict log or UCT's published posts; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change;
**[measured]** a number from a study or from my own count.

Words used here. **OR**: the opening range, the high and low of the first minutes of the regular session. **ORH / ORL**:
the opening range high / low. **ORB**: opening range breakout (a trade through the ORH); **ORB breakdown**: a trade
through the ORL. **LOD / HOD**: low / high of the day so far. **R**: the risk on the trade (entry minus stop).
**Kicker day**: the gap day the owner calls "DAY 1" (some app files call it day 2).

**Read this first (the short version).**
1. **For us the ORB is an entry trigger, not a stand-alone setup.** The owner uses it to time the buy on a daily setup
   that is already on the list: the Kicker (his ruling: "on day 1 kciker ORB on the 30 minute"), and in UCT's public
   posts on earnings gappers, IPO highs, base breakouts and leveraged ETFs. Bracco uses its mirror (the opening-range
   low) to time parabolic shorts. Our rulebook is a swing book (C35), so the ORB here opens a swing trade; the
   originator's tests closed the trade at the end of the same day.
2. **The window is not settled anywhere.** Toby Crabel, who first published the method (Stocks & Commodities, 1988-89;
   book 1990), used "the range of prices that occur in first 30 seconds to 5 minutes of trading". Others use 5, 15, 30 or
   60 minutes, or the first hour. A 30-minute window **is** published: MarketGauge's Geoff Bysshe defines the OR as "the
   first 30 minutes of the trading day", Trade-Ideas sells a 30-minute ORB alert, and Qullamaggie's "60-minute candle"
   is in his own words "only 30 minutes, 9.30-10 AM". The repo's earlier notes, "Nothing published names a 30-minute
   opening range" (`docs/study/levels/dossiers/kicker.md`) and "Nothing found that names a 30-minute opening range"
   (`docs/study/levels/external_research.md`), are out of date.
3. **A bare ORB has little or no edge; the context carries it.** The best modern test (Zarattini, Barbon and Aziz, 7,000+
   US stocks, 2016-2023) found the plain 5-minute ORB on all stocks earned 3.2% a year (Sharpe 0.48, below the S&P 500's
   0.78). Limited to the 20 "Stocks in Play" with the highest opening relative volume it earned 41.6% a year (Sharpe
   2.81). Their **30-minute** version on the same Stocks in Play made only 21% in eight years (Sharpe 0.21). My own count
   on 999 liquid US stocks (59 sessions, Aug-Nov 2026) found no edge in an unfiltered 30-minute ORB long: the average
   first break closed the day at -0.05R and was positive after 5 sessions only 26% of the time. All of these are day
   trades or short holds, not our swing use; none tests the ORB as an entry on a selected setup.
4. **Stops are tight on normal days and wide on gap days.** The natural stop (a few cents under the day's low, usually the
   30-minute low) was a median 1.6% from the entry in my count, within the 3% norm (A13) on 85% of days. On days that
   gapped up 3% or more (Kicker and earnings days) the median was 3.3% and only 42% fit inside 3%. On the owner's
   picture-perfect Kicker (JBI, 2023-12-14) the 30-minute range was 3.4% wide; his previous-day-high entry cost 2.3%.
5. **The app's scanner and its text need work.** `opening_range_breakout.py` and `opening_range_breakdown.py` need a
   5-minute **close** beyond the range, on 1.5 times the average volume of the six opening bars, inside a 0.3% to 2.5%
   width gate, with a target of twice the range. No source I read gives any of those four numbers. On real 5-minute bars
   the volume test removed 78% of early closes above the range and the width gate rejected 73% of 3%-plus gap-up days
   (it would reject JBI). The scan runs hourly but only looks at the last three 5-minute bars. The detectors' narrative
   text attributes statistics and quotes to Crabel and to Lance Breitstein that I could not find anywhere (section 5.5);
   some are certainly wrong (Crabel did not use a 30-minute window or Weinstein stages; Breitstein's firm was Trillium).
6. **UCT's own published ORB rule is short and clear.** The owner, on TMDX (The Rest of the Week, 2026-02-24): "1.
   Relative volume in the first 15 min", "2. Breaking opening highs", "3. Over $150 at least.", "Stop LOD.", and if you
   cannot take the ORB, "Look for a retest or an undercut and hold of VWAP mid morning."
7. **Rulebook friction:** C30 (no time-of-day rule) sits oddly with a trigger defined by the clock; C29 (skip a long more
   than 10% above the 10-day) blocks many earnings-gap ORBs; A13 (stop within about 3%) fails on most big gap days; D39
   (plan written before the open) cannot know the ORH, so the plan has to be written as a rule.

---

## 1. What it is

**In two sentences.** The first minutes of the session set a high and a low, the opening range. An opening range
breakout buys when price trades above that high (or, for the short, sells when it trades below that low), on the bet
that whichever side wins the opening fight keeps control for the rest of the day or longer.

**Why it works (the psychology).** These are the sources' reasoning, not measured facts.
- The open is when overnight news gets priced. Bysshe: "This makes the opening period emotionally charged and
  informationally rich." and "I like to think of the Opening Range as the day's "price discovery" period."
  ([Trading the 10 O'clock Bulls, MarketGauge](https://www.marketgauge.com/TradingThe10OclockBulls.pdf), ch. 2)
- A break shows urgency. Crabel, on a big move in the first minutes: "the type of price action that takes place on early
  entry shows that participants are urgent about entering the market."
  ([S&C V.6:10, Oct 1988, abstract](https://store.traders.com/-v06-c10-openran-pdf.html))
- The early imbalance tends to persist. Zarattini, Barbon and Aziz: "The opening range is often thought to provide some
  useful insight about the institutional supply and demand imbalance that will prevail throughout the day."
  ([SSRN 4729284](https://www.alexandria.unisg.ch/server/api/core/bitstreams/3c2989c4-688d-4d78-8a71-f02690990d51/content))
- Trend days start from balance and trap one side. Raschke: "Either longs or shorts will be “trapped” on the wrong side
  and eventually forced to cover, aggravating the existing supply/demand imbalance."
  ([Capturing Trend Days, TradersLog](https://www.traderslog.com/?p=823))
- A real break needs participation. Steenbarger: "A valid breakout should give us increased participation as we see
  higher or lower prices." ([TraderFeed, 20 Mar 2007](https://traderfeed.blogspot.com/2007/03/trading-opening-range-breakouts.html))

**Who is trapped, who is buying (long side).** Trapped: anyone who shorted or sold into the opening high, expecting the
range to hold; anyone who sold the open on the overnight news. Buying: participants still reacting to news; funds
working orders that could not fill in the first minutes; breakout traders whose buy-stops sit over the ORH; shorts
covering. On a failed break the trap reverses: breakout buyers above the ORH are trapped and their stops feed the fall.
Bysshe: "This pattern of a big-volume reversal at the top of the OR usually leads to a failed breakout and a selloff."

**Why it can fail.** The opening range is set by the noisiest minutes of the day. Crabel observed that most days rotate:
"Most days (70% to 80%), prices exhibit rotation or choppy action and the first five to 10 minutes of trading are
sluggish and directionless" (S&C V.6:10). On such days a break of the range is noise. Steenbarger (2007) added that, on
the broad index futures of his time, "you'll often find that the odds are in your favor by *fading* such breakouts".

---

## 2. Origin and naming

- **Toby Crabel (originator of the published method).** Eight articles in *Technical Analysis of Stocks & Commodities*,
  Sept 1988 to July 1989, all read as the publisher's store abstracts (the full PDFs are paid; I did not buy them):
  Part 1 "Playing the opening range breakout" (V.6:9, Sept 1988, pp. 337-339); Part 2 "early entry" (V.6:10, Oct 1988,
  pp. 366-368); Part 3 doji lines (V.6:12, Dec 1988, pp. 462-465); Part 4 inside days (V.7:2, Feb 1989, pp. 47-49);
  Part 5 NR4 (V.7:4, Apr 1989, pp. 119-120); Part 6 ID/NR4 (V.7:5, May 1989, pp. 161-163); Part 7 bear hook (V.7:6,
  June 1989, pp. 188-189); Part 8 bull hook (V.7:7, July 1989, pp. 208-210). The book followed: *Day Trading with Short
  Term Price Patterns and Opening Range Breakout* (Traders Press, 1990; publisher per Wikipedia, year also per
  StockCharts), out of print per StockCharts.
  Steenbarger: "The first extensive presentation of this idea came in Toby Crabel's book". **I did not read the book.**
- **Precursor: range expansion off the open.** Raschke credits Larry Williams with popularising entries a set amount
  above or below the open: "Though Toby Crabel also described this concept in his book, it was really popularized by
  Larry Williams." I did not read Williams in his own words; the percentages people quote for his rule are from
  third-party sites and are not used here.
- **Market Profile's "initial balance" (Chicago Board of Trade, 1985).** J. Peter Steidlmayer's Market Profile treats the
  first hour as the day's opening range: "A key element is the Initial Balance, the range and price location of the
  first hour of trading." ([Wikipedia, Market profile](https://en.wikipedia.org/wiki/Market_profile); low reliability,
  it cites the CBOT manuals I did not read.) James Dalton's *Mind Over Markets* names open types such as the
  "Open-Drive"; I only found secondary summaries, so none is quoted.
- **Mark Fisher, ACD method.** *The Logical Trader* (Wiley, 2002). Publisher text: "The "ACD Method" offers price points
  at which to buy and sell determined by the opening range of virtually any stock or commodity."
  ([Wiley-VCH](https://www.wiley-vch.de/en/areas-interest/finance-economics-law/the-logical-trader-978-0-471-21551-6))
  **I did not read the book.** Its window lengths and "A" values reach me only through forums, which disagree.
- **Geoff Bysshe, MarketGauge: the 30-minute OR for stocks.** *Trading the 10 O'clock Bulls* (free PDF, MarketGauge,
  © 2009; the text says it was written about 14 years after he started in 1990). He learned it on the floor: "I was
  convinced that it had merit by one of the floor's greatest traders - Mark Fisher."
- **Linda Raschke.** "Breakout of the Early-morning Trading Range" (first 45 to 120 minutes, most often the first hour)
  in "Capturing Trend Days". With Larry Connors she also published "Momentum Pinball" in *Street Smarts* (1995), which
  per Zarattini et al. combines "a 60-minute ORB with a 3-day Relative Strength Index (RSI) of a 1-day rate of change"
  (their wording; I did not read *Street Smarts*).
- **Kristjan Kullamägi (Qullamaggie).** "Enter on the opening range highs" for breakouts and episodic pivots, short "on
  the opening range lows" for parabolic shorts (qullamaggie.com, 2021).
- **Academic and practitioner tests.** Holmberg, Lönnbark and Lundström (Finance Research Letters, 2013, crude oil);
  Tsai et al. (IEEE Access, 2019, index futures; not read); Zarattini and Aziz (QQQ, SSRN 2023); Zarattini, Barbon and
  Aziz (US stocks, SSRN 2024). Thomas Bulkowski's *Swing and Day Trading: Evolution of a Trader* (Wiley, 2013) has a
  chapter 11 "Opening Range Breakout" with sections "What Is Best Range Time?", "The ORB Setup" and "Does the ORB Setup
  Work?" (table of contents, [Kinokuniya](https://www.kinokuniya.co.jp/f/dsg-12-EY00088793)). **I could not read it**;
  it may hold the best measured stock data. Worth buying.
- **Other names:** ORB; opening range break; OR breakout; breaking opening highs (UCT); ORB highs (Bracco); opening
  range highs / lows (ORH / ORL); 5-minute, 15-minute, 30-minute or 60-minute ORB; initial balance breakout (Market
  Profile, first hour); first-hour breakout; early-morning range breakout (Raschke); Opening Range Breakout Preference,
  ORBP (Crabel, one side only); "A up" / "A down" (Fisher); Quick Opening Range Breakdown (Bracco's name for a short).
  **Related but different:** volatility breakout or range expansion off the open (a distance from the open price, not a
  range); the 30-minute pivot (a consolidation under the first half-hour high, then a break; our setup 41); the opening
  drive (a strong move straight from the open; our setup 44).
- **In our app:** journal tags "Opening Range Breakout" and "Opening Range Breakdown" (Intraday group,
  `app/src/constants/setupGroups.js`); Model Book card "ORB (Opening Range Break)", family Intraday, direction both
  (`app/src/pages/modelbook/setupCatalog.js`); detectors `opening_range_breakout` and `opening_range_breakdown`
  (`api/services/pattern_engine/detectors/uct/`); Study skill `setup.intraday.orb`, unit SET.32, lesson "Reading the
  Open: ORB and the 30-Minute Pivot" (`docs/study/skill_map.json`, `docs/study/UNITS-method.md`). The breakdown has no
  Study unit.

---

## 3. Every definition I could find, source by source

### 3.1 Toby Crabel, S&C series (1988-89), the originator (publisher abstracts, read in full)
- **What it is:** "An opening range breakout (ORB) is a trade taken at a predetermined amount above or below the opening
  range." (Part 1)
- **The window:** "(the range of prices that occur in first 30 seconds to 5 minutes of trading)" (Parts 7 and 8). Part
  2 adds: "The open should act as one extreme of this range."
- **The trigger distance, "the stretch":** "The stretch is determined by looking at the previous 10 days and averaging
  the differences between the open for each day and the closest extreme to the open on each day." (Part 1) "I've set
  this predetermined amount (the "stretch") through observation." (Part 4)
- **Order and stop:** a buy stop one stretch above the OR high and a sell stop one stretch below the OR low. "The first
  stop that is traded is the position and the other stop is a protective stop." (Part 1)
- **One-sided version (ORBP):** "In a market with a strong bias in one direction or just after a clear supply or demand
  indication, a trade in only one direction is taken." The cancel rule: "If the market trades to the stretch in the
  opposite direction first, the preference is nullified and the resting order is cancelled." (Part 1)
- **Context:** the setup days before the ORB are contractions. Part 4: "My hypothesis is that inside days precede trend
  day activity and, consequently, successful opening range breakouts." Parts 5 and 6: NR4 and ID/NR4 "have proven to
  be reliable predecessors of trending action that can be profitably traded with an opening range breakout (ORB)
  system." Parts 3, 7 and 8 test doji lines and hook days. Part 8 warns: "However, as you will see from the tests I
  ran, this is not always the case."
- **Early entry (Part 2):** "Early entry is defined as a large price movement in one direction within the first five
  minutes after the open of the daily session." Rare: "It should be noted that directional moves of this nature are
  relatively rare and may occur only 10% of the time."
- **Exit in his tests:** "Trades were entered on a stop at the indicated level with an exit on the same day's close."
  (Part 5)
- **Prior trend, volume, moving averages, range width, target:** none stated in any abstract.

### 3.2 Crabel's book (1990), through reproductions only (not checked against the book)
Sources: the Time Price Research blog ([Definition of Price Patterns | Toby Crabel](https://time-price-research-astrofin.blogspot.com/2012/04/toby-crabel-definition-of-patterns.html)),
an anonymous blog whose page has been rewritten as an essay; and StockCharts ChartSchool
([Narrow Range Day NR7](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7)).
Where the blog's quotes overlap the S&C abstracts, they match. The rest is unverified.
- Window: the blog says "The glossary defines the opening range as the first thirty seconds of trading." StockCharts
  says "The opening range breakout (ORB) is based on the price range in the first five minutes of trading".
- Tests used a fixed distance from the open, quoted as Crabel's words: "In later testing you will notice that I use a
  constant value off the open rather than the stretch point. Experience has shown this to be a better method."
- Bias: "Whichever side of the Stretch is traded first will indicate bias in that direction for the next two to three
  hours of the session." (blog, quoted as the book)
- Context: "One should be looking to go with a forceful move off the open after a contraction and not willing to do so
  after an expansion." (blog, quoted as the book)
- Exit: the blog: "The tests specify no price target; the measured exit is the close." StockCharts: "Crabel took profits
  quite quickly, usually at the close of the first trading day or on the first profitable close."
- The blog also paraphrases (no quote marks) a breakeven move within about an hour, retracement re-entries, and smaller
  size later in the day. I give these no weight.

### 3.3 Linda Bradford Raschke, "Capturing Trend Days" (her article, reposted on TradersLog, page dated 2025-02-11)
- **Window:** "The morning range is defined by the high and low made in the first 45-120 minutes. Different time
  parameters can be used, but the most popular one is the first hour’s range."
- **Order and stop:** a buy stop above the morning high and a sell stop below the low. "A protective stop-and-reverse
  should always be left in place at the opposite end of he range once entry has been established." (sic)
- **Context (conditions before a trend day):** NR7 (credited to Crabel), "a cluster of 2 or 3 small daily ranges", the
  point of a wedge, a hook day, low volatility readings, large opening gaps, runaway momentum.
- **Early entry, her account of Crabel:** "Early Entry. Toby Crabel defined this as a large price movement in one
  direction within the first 15 minutes of the opening." (Crabel's own abstract says five minutes.)
- **Exits:** market on close, the next morning's open, the prior day's high or low, or an ATR target. "Most breakout
  strategies actually test out better for trades held overnight because the next opening will so often gap in a
  favorable direction." (Her claim; no numbers given.)
- **Trade-offs:** "The good news is that breakout strategies have a high win/loss ratio. The bad news is that whipsaws
  can be brutal!" and "In general when testing volatility breakout systems, the wider the initial money-management stop,
  the higher the win/loss ratio."
- **Prior trend, volume, moving averages, width:** not stated.

### 3.4 Geoff Bysshe, *Trading the 10 O'clock Bulls* (MarketGauge, free PDF, read in full for chapters 2, 4, 5)
- **Window:** "In this book I define the Opening Range as the first 30 minutes of the trading day." He also uses the
  first 5 minutes for some strategies. "the 30-minute OR is defined as the stock's high and low for the day at 10:00 AM.
  The OR is not the opening price."
- **Shape:** look for "well-defined" support or resistance at the OR high or low; the best case is a tight consolidation
  or orderly flag at the top of the OR, ideally at the OR high itself. "If the OR is sloppy, that is, if there isn't any
  well-defined support or resistance, don't waste your time watching it."
- **Volume:** "A bullish bias pattern in the OR may give you a hint, but your best clue is volume." He wants unusually
  high volume during the OR and high relative volume at the break.
- **Context:** "The daily trend should be positive. Both the 20-day and the 50-day moving averages are positively sloped
  and the stock is trading above the 20-day moving average." and "The stock is trading above the prior day's high." An
  OR high at or just above the prior day's high makes the break "even more significant".
- **Trigger and three tactics:** "1. Buy the initial breakout when the conditions are right", "2. Buy the retracement to
  the breakout when you need confirmation", "3. Buy the second breakout when you need more confirmation".
- **Clean-break test:** "A good rule of thumb is that it should trade above the OR for a period of time equal to half
  the time period of the OR." (15 minutes for a 30-minute OR.)
- **Stop:** "your maximum risk point for an OR breakout is the low of the OR." He prefers a tighter stop under the last
  swing low or the low of a consolidation; "If I can't find a good stop or risk point then I generally pass on the
  trade." He wants at least 2:1 reward to risk.
- **Swing use:** "First identify a list of candidates based on your swing trade criteria, and then use the OR to time
  your entry." and "By using the OR to time your entry for a day trade or a swing trade you will find that you can avoid
  getting caught chasing strong openings that fail immediately."
- **Chasing:** "The result is you buy a stock that has already moved too far from your optimal entry point."
- **Short side:** "the same concepts can be applied to shorting" (stated, not developed).

### 3.5 Mark Fisher, ACD (book not read)
Only the publisher's description is verified (section 2). The window length, the "A" and "C" offsets and the time
confirmation rules are reported differently by forum posts; I quote none of them.

### 3.6 Kristjan Kullamägi, qullamaggie.com, "3 TIMELESS setups that have made me TENS OF MILLIONS!" (8 Jan 2021, updated 28 Apr 2021)
- **Breakouts:** "Enter on the opening range highs." and "The opening range highs can be the highs of the first 1-minute
  candle, the 5-minute candle or the 60-minute candle (on the 60-minute timeframe the first candle is always only 30
  minutes, 9.30-10 AM)." He allows skipping intraday charts: "You don’t even have to use any intraday chart, just look
  at the daily chart and enter when the stock is starting to break out."
- **Stop:** "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock".
- **Episodic pivots:** "Enter opening range highs. ORH can be the highs of the first 1-, 5-, or 60-minute candle. The
  stop is at the lows of the day." Volume: "Many times the best ones have traded their average daily volume in the first
  15-30 minutes after the open."
- **Parabolic short:** "you can short on the opening range lows (1-minute, 5-minute candles)." with the stop at the
  high of the day. Parabolic long: "Entry is opening range highs or the first green 5-minute candle".
- **Management:** "You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop to break even." The
  rest trails on the 10- or 20-day average.
- **Context:** the ORB is only the entry; the setup (breakout, EP, parabolic) is defined on the daily chart.

### 3.7 Zarattini, Barbon and Aziz, "A Profitable Day Trading Strategy For The U.S. Equity Market" (SSRN, 16 Feb 2024)
A test definition, not a teacher's rule. Universe filters: open above $5, 14-day average volume at least 1,000,000
shares, 14-day ATR above $0.50. Direction: long only if the first 5-minute candle closed up, short only if it closed
down, none on a doji. Entry: a stop order at the 5-minute high (or low). Stop: 10% of the 14-day ATR from the entry.
Exit: the close. Risk 1% of capital a trade, leverage capped at 4x, commission $0.0035 a share. The "Stocks in Play"
version adds relative volume of the first 5 minutes at least 100% of its 14-day average and keeps the top 20.

### 3.8 Trade-Ideas, ORU30 / ORD30 alert pages (vendor definition)
"The 30-minute opening range is the high and low of the first 30 minute candle of the day. An opening range breakout is
the first time price trades above that high." Windows: "You can choose between 1, 2, 5, 10, 15, 30 and 60 minute
candles. 15 is the most popular choice, but they are all valid." (Their claim, unsourced.) The trigger is a trade, not
a close, and it fires once a day.
([ORU30](https://trade-ideas.com/help/alert/ORU30/), [ORD30](https://www.trade-ideas.com/help/alert/ORD30/))

### 3.9 Brett Steenbarger, TraderFeed (20 Mar 2007), educator commentary
For index futures he takes the whole overnight session as the range, wants every major average and the NYSE TICK to
confirm, and wants rising volume. He likes the first pullback after a valid break: "This makes the first pullback after
the breakout move a nice high-probability entry once you start to see resumed buying." On durability: "It takes more
conceptual integration of market data to separate valid ORB trades from false breakouts now than when Crabel wrote his
book."

### 3.10 Bear Bull Traders, "Strategy: 5-Min Open Range Breakout" (slides by Carlos Moreta; low weight)
A day-trading school's member slides: mid to large float, high premarket and opening volume, gap stocks, an opening range
smaller than the ATR, entry on the break, stop usually on the loss of VWAP, targets at nearby levels, valid for about
the first hour. "Same strategy can be used for a 15-, 30- or 60-min Opening Range."
([PDF](https://members.bearbulltraders.com/wp-content/uploads/2023/04/Strategy-12-5-Min-ORB.pdf))

### 3.11 UCT (full quotes in section 6)
The owner's Kicker ruling: the day-1 ORB on the 30-minute chart, stop under the Kicker's low or 3.5% under the entry if
closer. His public ORB checklist (TMDX): relative volume in the first 15 minutes, breaking opening highs, over a named
level, stop LOD, else a VWAP retest or undercut-and-hold mid morning. Bracco: buys "through the opening range highs" and
"on the ORB highs"; for parabolic shorts he waits for a break of VWAP, the opening range low or the low of the day.

### 3.12 Read, but not used as a definition, or not readable
- Investopedia: the "openingrange.asp" URL I tried returned a not-found page (402 on the cold check). The Study bank
  already quotes an Investopedia definition (first 15 minutes) from a different URL, `.../terms/o/opening-range.asp`
  (`docs/study/research/definitions.json`); I did not re-check it.
- Edgeful's "opening range breakout report" page: product marketing, no numbers.
- MarketGauge, "Timing Swing Trade Entries with The O.R." (23 Feb 2015): a video; I did not watch it.
- Not found in my searches, so no quote: an ORB post on Pradeep Bonde's Stockbee blog; Brian Shannon in his own words on
  the ORB; Oliver Kell on the ORB; a Bulkowski web page on the ORB. My web-search budget ran out before a second
  Stockbee search, so "not found" there is weak.
- Lance Breitstein: the Chat With Traders listing (episode 228, 9 Feb 2022, read via Everand) says he "was a Senior
  Trader at proprietary trading firm Trillium and Manager of the Chicago office." I found no Breitstein ORB rule or
  statistic in his own words. Bracco cites one real Breitstein idea, the "Right Side of the V" (section 6.4).

### 3.13 Comparison table

| Source | Market, era | Window | Context needed | Range shape / width | Volume | Trigger | Order | Stop | Exit / target | Hold |
|---|---|---|---|---|---|---|---|---|---|---|
| Crabel, S&C 1988-89 | futures, 1980s | 30 s to 5 min | best after contraction (ID, NR4, NR7, doji, hook); one side only with clear bias | none | none | a "stretch" beyond the OR | resting stops both sides | the opposite stop | none; tests exit at the close | intraday |
| Crabel book via blog / StockCharts | same | 30 s (blog) or 5 min (StockCharts) | contraction | none | none | stretch; tests used a fixed distance off the open | stops | opposite stop | the close, or first profitable close | intraday to 1-2 days |
| Raschke | futures (S&P) | 45-120 min; most popular first hour | NR7, small ranges, wedge, hook, low volatility, big gaps, runaway momentum | none | none | buy stop over the morning high | stop orders | stop-and-reverse at the other end | close, next open, prior day H/L, ATR | intraday or overnight |
| Bysshe | US stocks, 1990s-2000s | 30 min (also 5) | 20 and 50-day rising, above the 20-day, above prior day's high | well-defined S/R; tight base at the OR high | high OR volume; high relative volume at the break | break of the ORH (or of a flag above it) | not stated | max OR low; better a swing low | at least 2:1 | day or swing |
| Fisher ACD | futures, stocks | not verified | not verified | not verified | not verified | "A" beyond the OR | not verified | not verified | not verified | not verified |
| Qullamaggie | US momentum stocks | 1, 5 or 60-min candle (first 60-min candle = 9:30-10:00) | a daily setup (breakout, EP, parabolic) | not stated; stop no wider than ATR/ADR | EP: heavy premarket or opening volume | ORH | not stated | LOD | 1/3 to 1/2 after 3-5 days, stop to breakeven, trail 10/20-day | swing |
| Zarattini et al. | US stocks 2016-23 | 5 min (also 15, 30, 60 tested) | $5+, 1M shares, ATR > $0.50; first candle's direction; top-20 relative volume | none | OR relative volume ≥100% | trade through ORH/ORL | stop order | 10% of ATR | the close | intraday |
| Trade-Ideas | US stocks | 30 min (1 to 60 selectable) | none | none | none | first trade beyond the OR | alert | not stated | not stated | n/a |
| Steenbarger | index futures | the overnight range | all averages and TICK agree | n/s | rising volume | break, or first pullback | n/s | n/s | n/s | intraday |
| App scanner | 5-min bars | 6 bars (30 min) | only in the score | 0.3% to 2.5% of price | break bar ≥1.5x OR-bar average | a 5-min **close** beyond the OR | entry printed at ORH +0.1% | ORL -0.2% | 2x the OR height | not stated |
| UCT (owner, Bracco) | US stocks, ETFs | 30 min on the Kicker (ruled); 15-min (owner, TMDX volume); 15-min (Bracco, ASTS, KB); 2 or 5-min ORL (Bracco, parabolic) | a daily setup on the focus list | not stated | relative volume early; heavy premarket and open | "Breaking opening highs"; a named level | market order (E57) | LOD; Kicker low capped at 3.5% | house: 1/3 at 3R, 1/3 at 5R, trail 10/21-day | swing |

### 3.14 Where they disagree
1. **Window length.** 30 seconds to 5 minutes (Crabel); 5 minutes (Zarattini's best; StockCharts' reading of Crabel);
   15 (Trade-Ideas' "most popular"); 30 (Bysshe; the owner's Kicker ruling; Trade-Ideas ORU30; Qullamaggie's first
   60-minute candle); 45 to 120 or the first hour (Raschke; Market Profile's initial balance). Nobody has shown one
   window is best for a swing entry. As a day trade, Zarattini found the 5-minute window far better than 30 (section 4).
2. **Where the trigger sits.** At the range edge (Bysshe, Qullamaggie, Trade-Ideas, Zarattini, UCT) versus a "stretch"
   beyond it (Crabel), a fixed distance off the open (Crabel's tests; Williams via Raschke), or Fisher's "A".
3. **Trade-through or close.** Every source I read acts on the trade through the level (stop orders, alerts). Only our
   scanner waits for a 5-minute close.
4. **The stop.** The opposite side of the range (Crabel, Raschke's stop-and-reverse, Bysshe's maximum, the app); the low
   of the day (Qullamaggie, the owner); the last swing low (Bysshe's preference); 10% of ATR (Zarattini); a loss of VWAP
   (Bear Bull slides). On a first break after 10:00 the day's low is usually the OR low, so the first two often agree.
5. **How long to hold.** Same day (Crabel's tests, Zarattini); overnight or next open (Raschke's preference); days to
   weeks (Qullamaggie, Bysshe for swings, the owner).
6. **Picking a side.** Both sides with stop orders (Crabel ORB, Raschke); one side only on a clear bias (Crabel ORBP);
   the first 5-minute candle's direction (Zarattini); the daily setup decides (Bysshe, Qullamaggie, UCT).
7. **Volume.** None (Crabel, Raschke); the opening range's volume against its own average (Zarattini, owner, Bysshe,
   Qullamaggie for EPs); the break bar against the opening bars (the app only).
8. **Range width.** No source I read sets a width band. Qullamaggie caps the stop at the ATR/ADR; Bysshe passes when no
   good risk point exists; our house caps the stop near 3% (A13). The app's 0.3% to 2.5% band has no source.
9. **What Crabel used.** His abstracts define an intraday range of 30 seconds to 5 minutes. Zarattini et al. write that
   in Crabel's model "The strategy did not use any intraday data information to define the opening range." Both can be
   partly true (his tests used a fixed distance off the open), but the abstracts show he did define an intraday range.
10. **Early entry.** Crabel's abstract: the first five minutes. Raschke's account: the first 15 minutes.
11. **Does it still work?** Steenbarger (2007): index ORBs were often better faded in that era. Zarattini (2024): weak
    unfiltered, strong on stocks in play. My count (2026): no edge unfiltered.

---

## 4. Measured evidence

### 4.1 Crabel's own tests (futures, 1980s; through the blog reproduction, not the book)
- "An average of all percentages under the column labelled NR7 was 64%, NR4 64%, Control 57%, WS4 54% and WS7 52%."
- "Profits were seven times larger for ORB trades after contractions than after expansions."
- **Who and how:** Crabel; the same ORB taken after each pattern and on any day (the control); entry at fixed
  distances from the open; exit at the same day's close (Part 5 abstract). As I read it, the percentages are how often
  the trade followed through to the close.
- **Limits:** futures (the abstracts name Treasury bonds, the S&P, soybeans and cattle), the 1980s, no costs stated, a fixed distance off
  the open rather than our range, same-day trades, and I could not check the tables in the book.
- His observation (not a test) from Part 2: early entry days "may occur only 10% of the time"; 70% to 80% of days rotate.

### 4.2 Zarattini, Barbon and Aziz (2024): 5-minute ORB on US stocks, 2016-2023
Source: the paper's PDF (University of St. Gallen repository; SSRN 4729284; Swiss Finance Institute Research Paper
24-98, a number that appears on the RePEc listing, source 42, not in the PDF text itself).
| Version | Total return | Annual | Sharpe | Hit ratio | Max drawdown |
|---|---:|---:|---:|---:|---:|
| 5-min ORB, all eligible stocks | 29% | 3.2% | 0.48 | 41.4% | 13% |
| 5-min ORB, top 20 Stocks in Play | 1,637% | 41.6% | 2.81 | 48.4% | 12% |
| 15-min ORB, Stocks in Play | 272% | 17.4% | 1.43 | 44.7% | 11% |
| **30-min ORB, Stocks in Play** | **21%** | **2.3%** | **0.21** | **42.4%** | **35%** |
| 60-min ORB, Stocks in Play | 39% | 4.1% | 0.40 | 42.3% | 21% |
| S&P 500 buy and hold | 198% | 14.2% | 0.78 | 54.9% | 34% |
- Relative volume matters: "when the Relative Volume was below 100%, the average PnL of 5-minute ORB trades was notably
  low at -0.02R." It was 0.08R above 100% and 0.38R above 30 times normal (their Figure 4 text).
- The best single stocks by cumulative R show win rates of about 17% to 40%: the money is in a few large winners.
- On why 5 minutes beat 30: "The reason for the 5-minute ORB's superior performance is unclear and warrants further
  investigation."
- **Limits:** a same-day trade with a 10%-of-ATR stop and an exit at the close, not our swing trade; leverage up to 4x;
  one data vendor (IQFeed intraday); a working paper, not peer reviewed as far as I could see; the authors work for a
  research firm and day-trading firms (Concretum Research; Peak Capital Trading and Bear Bull Traders), which sell
  related education. The 30-minute result is the closest to the owner's window and it was weak.

### 4.3 Zarattini and Aziz (2023): 5-minute ORB on QQQ and TQQQ, 2016-2023
From the authors' page ([Concretum](https://concretumgroup.com/can-day-trading-really-be-profitable/)): a 5-minute ORB
on TQQQ returned 1,484% versus 169% for holding QQQ; an annualised alpha of 33% net of commissions on QQQ. I did not
read the paper (SSRN 4416622). Same limits as 4.2, plus leverage through a 3x ETF.

### 4.4 Holmberg, Lönnbark and Lundström (2013): crude oil futures
Finance Research Letters 10(1), 27-33. Abstract: "An investor that trades on the ORB strategy seeks to identify large
intraday price movements and trades only when the price moves beyond some predetermined threshold." They report returns
"significantly higher returns than zero" and a success rate above a fair game. Zarattini et al. summarise that the
profit came mostly from 2000 to 2011. Limits: one futures market; a statistical threshold, not a chart range; abstract
only (paywalled).

### 4.5 Gao, Han, Li and Zhou (2018): the first half hour predicts the last half hour
Journal of Financial Economics 129(2), 394-414, abstract: "the first half-hour return on the market as measured from the
previous day’s market close predicts the last half-hour return." The effect "is stronger on more volatile days, on higher
volume days, on recession days, and on major macroeconomic news release days." Limits: the S&P 500 ETF and "ten other
most actively traded domestic and international ETFs", 1993-2013; a return-sign effect, not a range break. It supports the idea that the first 30 minutes carry
information; it does not test an ORB.

### 4.6 Bysshe's statistic
"My research on individual stocks shows that the high for the day occurs in the first 30 minutes about 35% of the time!"
(and the same for the low), against about 8% if time were random. No sample, period or method is given.

### 4.7 Second-hand only
Through Zarattini et al.: Tsai et al. (2018/2019) found "the most significant profits occur when the opening range
length is within 5 minutes from the open" on index futures; Lundström (2017) found ORB profitability grows with
volatility. I did not read either paper.

### 4.8 My own count: the 30-minute opening range on 999 liquid US stocks (not a test of any UCT setup)
**Data:** a shared scratch database of Yahoo 5-minute bars (regular hours, unadjusted) for the most liquid names
in the sandbox universe (price ≥ $10 and ≥ $20M a day, B23; 999 tickers with 5-minute bars), 59 sessions from
2026-08-17 to 2026-11-06, 56,302 complete stock-days; daily closes for the 50/200-day filters built from the same source's 60-minute bars back to 2023-12.
**Method:** OR = the six 5-minute bars from 9:30 to 9:55. Long: the first bar after 10:00 whose high trades a cent over
the ORH; entry a cent over the ORH (or the bar's open if it opened above); stop two cents under the day's low so far
(house F62). Short mirrored. Same day: whether the stop or +1R / +2R came first, bar by bar (a bar touching both counts
as the stop). Five sessions: the stop stays; a later open below the stop exits at that open; otherwise the close of the
fifth session. No slippage, no commissions. The script sits in my research scratch folder, not in the repo. (Cold
check: re-run on the same database on 2026-11-09; every figure below reproduced exactly. 54.9% of the first long breaks
came by 10:30.)

| Measure | All stock-days | Long, prior close above 50 and 200-day | Long, gap up ≥ 3% | Short, prior close below 200-day | Short, gap down ≥ 3% |
|---|---:|---:|---:|---:|---:|
| Stock-days | 56,302 | 19,548 | 1,675 | 24,512 | 2,059 |
| A first break happened | 53.6% (long), 58.1% (short) | 53.2% | 53.0% | 59.4% | 59.5% |
| Median stop distance | 1.59% | 1.65% | 3.33% | 1.58% | 3.64% |
| Stop within 3% (A13) | 85.2% | 84.8% | 41.9% | 84.5% | 36.0% |
| Same day: stop hit | 19.3% | 18.8% | 13.1% | 19.5% | 8.7% |
| Same day: +1R before any stop | 17.7% | 15.3% | 15.2% | 18.6% | 27.8% |
| Same day: +2R before any stop | 3.0% | 2.9% | 3.0% | 3.4% | 5.0% |
| Same-day close, mean (in R) | -0.05R | -0.07R | +0.02R | -0.02R | +0.24R |
| Closed beyond the entry | 47.2% | 46.2% | 52.0% | 49.4% | 63.3% |
| Five sessions, mean (in R) | -0.14R | -0.20R | -0.20R | -0.07R | +0.48R |
| Five sessions, positive | 26.2% | 25.6% | 26.8% | 28.1% | 34.8% |
| Median trigger time | 10:20 | 10:20 | 10:30 | 10:15 | 10:20 |

Other counts from the same data:
- 30-minute range width (ORH to ORL as % of ORH): 10th percentile 0.69%, quartiles 1.05% / 1.59% / 2.43%, 90th
  percentile 3.58%. Within 3%: 84.2% of days; within 3.5%: 89.4%. On gap-up ≥ 3% days: median 3.48%, within 3%: 39.2%,
  within 3.5%: 50.5%.
- The day's high was set in the first 30 minutes on 45.8% of days, the day's low on 41.3%, one or the other on 80.2%.
  Bysshe's 35% (his era) is lower; both are far above the time share of one half hour (about 8%).
- The app's width gate (0.3% to 2.5% of the sixth bar's close) passed 72.5% of all days but only 27.2% of gap-up ≥ 3%
  days.
- The app's full long rule (width gate, a 5-minute close above the ORH in the 10:00, 10:05 or 10:10 bar, that bar's
  volume ≥ 1.5x the opening bars' average) fired on 2.72% of stock-days (1,531 events); the short rule on 3.19% (1,798).
  A close above the ORH in those three bars happened on 15.9% of days, and only 21.7% of those closes passed the volume
  test.

**What it says.** An unfiltered 30-minute ORB is close to a coin flip on the day and loses over five sessions with a
day-low stop; most first breaks never reach +1R the same day, and +2R (about the app's "2x range" target) came first
only about 3% of the time. A 50/200-day trend filter did not help in this window. The only positive cell was the short
side on big gap-down days, a small sample in one period. **The edge, if any, must come from the setup the ORB is timing
and from the volume, which this count does not select.**
**Limits.** One 59-session window in one market regime; stocks chosen by recent liquidity (survivorship); overlapping
trades (not independent); 5-minute bars hide the order of moves inside a bar; no costs; the 5-session exit is my
stand-in, not the house plan (no 3R/5R trims, no 10-day trail, no B20 30-minute rule).

### 4.9 Worked house example: JBI, 2023-12-14 (the owner's picture-perfect Kicker)
Data: `docs/study/workbench/walkthrough/data/JBI_2023-12-14_30m.json` (30-minute bars from the site's own bars route).
- Red day (12-13) high: 11.04. Kicker day first 30-minute bar: open 10.94, high 11.20, low 10.82, close 11.09, volume
  2,508,870. The 10:00 bar traded to 11.22, so the 30-minute ORB triggered between 10:00 and 10:30. The day's low stayed
  10.82; the regular close was 11.62.
- His previous-day-high entry: 11.05 (his ruling), stop two cents under 10.82 = 10.80, risk 0.25 (2.3%). It triggered
  inside the first 30 minutes, before the ORB.
- The 30-minute ORB entry: 11.21, same stop, risk 0.41 (3.7%), past A13's 3% and his 3.5% Kicker cap; with the cap the
  stop is 11.21 × 0.965 = 10.82, the Kicker low itself.
- At the close: the previous-day-high entry was up about 2.3R, the ORB entry about 1.0R.
- The app's ORB detector would have rejected this day: the 30-minute range was 3.4% of the sixth-bar close, over its
  2.5% limit.
- Lesson: when the open is below the previous day's high, the previous-day-high trigger comes first and is cheaper; the
  ORB is the confirmation entry. When a stock opens above the previous day's high, that order fills at the open and the
  ORB becomes the patient alternative.

### 4.10 Claims with no numbers behind them
- Raschke: breakout strategies "test out better for trades held overnight" (no test shown).
- Trade-Ideas: 15 minutes is "the most popular choice" (no survey shown).
- Every statistic in the app's ORB narratives (section 5.5).

### 4.11 Not measured anywhere I found
The ORB as an entry on a selected swing setup (Kicker, EP, PEG, base breakout) held for days or weeks; the 30-minute
window against the previous-day-high entry; any width band; the breakout bar's volume against the opening bars' volume;
the house management (3R / 5R trims, 10/21-day trail) after an ORB entry. Bulkowski's 2013 chapter may hold stock data;
I could not read it.

---

## 5. Our app: what the code and the cards actually say

### 5.1 The detectors
`api/services/pattern_engine/detectors/uct/opening_range_breakout.py` (pattern `opening_range_breakout`, direction
bullish) and `opening_range_breakdown.py` (`opening_range_breakdown`, bearish, a mirror). Both are listed as category
"uct" in `api/routers/patterns.py`. As coded:
1. **Opening range:** the first 6 bars of whatever list it is given (`_OR_BARS = 6`); 30 minutes only if the caller
   passes 5-minute bars that start at 9:30.
2. **Width gate:** (OR high − OR low) / close of the sixth bar between 0.3% and 2.5% (`_MIN_RANGE_PCT`,
   `_MAX_RANGE_PCT`).
3. **Trigger:** among the **last three bars** of the list (`search_start = max(6, last_idx - 2)`), the earliest bar
   that **closes** above the OR high (below the OR low for the breakdown) with volume ≥ 1.5x the average volume of the
   six opening bars. The docstring says "Within next 1-3 bars after range", but the code checks the last three bars at
   scan time, at any hour.
4. **Levels:** entry = OR high × 1.001; stop = OR low × 0.998; target = entry + 2 × the OR height (mirrored for the
   breakdown). R:R is reported, not required.
5. **Score:** 40% geometry (width sweet spot 0.5% to 1.5%; how far the close cleared the level), 25% volume ratio, 20%
   context (adds points for Stage 2, stacked averages, rising RS, accumulation; the breakdown adds points for Stage 3/4
   and only subtracts 5 for Stage 2), 15% a fixed 50 for history. Fires at confidence ≥ 50.

### 5.2 How the live scan calls them (`api/main.py`)
- `_run_patterns_leaders_scan` runs on an `IntervalTrigger(hours=1)`, so once an hour, not on the clock. Its intraday
  pass runs only Monday to Friday 9:30 to 16:00 ET, only for the leader universe (`api/data/leader_universe.json`), only
  from 5-minute bars already in the local SQLite store (no fetch), and slices today's session (a gap of more than 4
  hours starts a new session). It needs at least 9 bars (10:15) and at least 30 daily bars for context. The pass has a
  kill switch, `PATTERNS_INTRADAY_SCAN_ENABLED` (default on). A comment in `main.py` records that the whole pass was
  deleted on 2026-05-21 and restored on 2026-07-23, so no intraday detections were stored for two months.
- Because the trigger must be in the last three 5-minute bars, a break is seen only if the hourly run lands within
  15 minutes after it. Most breaks will never be stored.
- Study notes say intraday bars exist for about 7% of symbols (`docs/study/UNITS-foundations.md`).
- The daily scan (`_scan_patterns_daily`) runs every registered detector on 200 daily bars. The registry's comment says these two still fire on daily bars in the daily pass, and the registry only hides them on daily charts
  (`DISPLAY_INTRADAY_ONLY`, `detectors/registry.py`). On daily bars the "opening range" is the first six days of the
  window, which means nothing. I did not check whether such rows exist in production.
- The test fixtures are synthetic (`tests/fixtures/opening_range_breakout/_generate.py`), not real charts.

### 5.3 Where the code disagrees with the sources or the house
1. **Close, not trade-through.** Every source acts on a trade through the level; the owner market-orders (E57) and buys
   "a cent over". The printed entry (ORH +0.1%) is not where a close-based trigger would fill.
2. **The volume test has no source.** Sources compare the opening range's volume with its own history (Zarattini,
   Bysshe, the owner's "Relative volume in the first 15 min"). The app compares the break bar with the opening bars,
   which are usually the heaviest of the day. On real bars it removed 78% of early closes above the range.
3. **The width gate has no source and excludes our best cases.** It rejected 73% of 3%-plus gap-up days in my count,
   the days the owner uses the ORB on (Kicker day 1, earnings gaps), including JBI.
4. **The target (2x the range) has no source.** Crabel's tests exited at the close with no target; the house trims at
   3R and 5R. In my count +2R came first the same day on about 3% of first breaks.
5. **Stop:** OR low −0.2% versus the house "a few cents under the day's low" (A3, F62). Usually the same level; they
   differ when price dipped below the OR low after 10:00.
6. **No house filters.** Nothing stops a long below the 200-day (B26), with RS under 80 (C31), under $10 or $20M a day
   (B23), or more than 10% above the 10-day (C29). The breakdown can fire in a Stage 2 uptrend (minus 5 points only) and
   above the 200-day.
7. **Not a first break.** The rule fires on any late close beyond the range in the last three bars, not the first break.
8. **Timing:** the hourly schedule and the 15-minute look-back make the live scanner close to dormant.

### 5.4 The Model Book, playbooks and journal tags
- **Card** (`setupCatalog.js`): "ORB (Opening Range Break)", Intraday, both directions. Its essence line, in two parts:
  "The first candles define the opening range" and "breaking it with momentum puts the day’s trend behind the trade."
  It names no window, no volume test and no stop. Its sibling card "30-Minute Pivot": "The first half-hour’s high
  becomes the trigger" and "consolidate under it, then break with volume." The two overlap when the ORB window is 30
  minutes; the owner should say how they differ (question 3).
- **Playbook** (`setupPlaybooks.js`): no ORB entry; the card shows the "being authored" placeholder.
- **The Episodic Pivot playbook** uses the ORB: "Qullamaggie’s version waits 30 minutes, then enters on the break above
  the 30-minute high with stop below the 30-minute low, holding overnight only if the close is in the top 25% of the
  range." His page does not say this (section 3.6: 1, 5 or 60-minute candle, stop at the low of the day). The EP
  dossier flagged the same. Its mistake line "Chasing when the opening-range high does not break" is a fair summary of
  Bysshe and Qullamaggie.
- **The 20 EMA Pullback playbook** names an exit "into the 15-minute opening-range-breakout buyers who step in near the
  highs" (no source given).
- **Journal tags** (`setupGroups.js`): "Opening Range Breakout" and "Opening Range Breakdown" in the Intraday group, with
  "30min Pivot", "Red to Green (Intraday)", "Green to Red", "Mean Reversion L/S".

### 5.5 The detectors' narrative text: claims I could not verify or that are wrong
The narratives are shown to members with each detection. None of these appear in any source I read.

| Claim in the code | What I found |
|---|---|
| Crabel's framework uses "the first 30 minutes" | Crabel: "first 30 seconds to 5 minutes" (S&C abstracts); blog: first 30 seconds. **Wrong.** |
| "Crabel filters out ranges below 0.3% as noise and above 2.5% as news-bar exhaustion" | No width filter in any Crabel text I read. **Unsupported.** |
| "target = entry + opening_range_height * 2 (Crabel's measured move)" | His tests exited at the close; the blog: "The tests specify no price target". **Unsupported.** |
| Follow-through "roughly 60-70% of the time when the opening range is clean" (Crabel) | His reproduced averages are 64% after NR7/NR4 and 57% on any day, futures, no volume filter. The volume and "clean range" conditions are not his. **Misattributed.** |
| "Crabel's threshold for an actionable ORB is R:R >= 2.0" | Not found. Bysshe (not Crabel) wants 2:1. |
| The "kiss-goodbye" retest "that Crabel teaches" | Not found. |
| "Crabel's published failure-rate statistics by stage: ORBs in Stage 2 uptrends fail roughly 30-35%" (then Stage 1 about 40%, Stage 4 about 55-60%) | Crabel did not use Weinstein's stages in anything I read. **Almost certainly fabricated.** |
| Breitstein: "the opening drive into 10:30 follow-through is the highest-edge intraday setup" | No page found with this wording. **Unverified quote.** |
| "Breitstein's published statistical work at SMB shows that ORBs with breakout-bar volume >=1.5x OR-bar average produce continuation roughly 65-70% of the time" (and about 40% below 1.0x) | No such publication found. His firm was Trillium (Chat With Traders). **Unverified.** |
| Breitstein's "never take more than 3 ORB trades per session" and his timing tiers (the long text: "the first 10-30 minutes after the range closes"; the short text: "9:45-10:30 ET"; then "11:00-14:00" mid-edge and "after 14:00" lower-edge) | Not found. |
| "Lance Breitstein (SMB Capital)" | Chat With Traders: Senior Trader at Trillium. An SMB role is claimed only by summary sites I did not trust. |
| Stockbee "treats the ORB as the cash-equity analogue of the futures Episodic Pivot" | Not found; the EP is Bonde's stock catalyst setup. |
| ORB "does NOT extend to overnight holds" (Crabel) | His tests closed at the end of the day, which is not the same as a finding. Raschke says the opposite for breakout systems. |

Recommendation for the code owners (not part of the course): replace both narratives with sourced text, or remove the
attributions. The same unverified Breitstein language is in `lance_opening_drive.py` (setup 44).

### 5.6 Other Study texts
- `docs/study/TRADE_PLANS.md`: the Kicker's entry includes "the day-1 30-minute opening-range break" (his ruling).
- `docs/study/levels/external_research.md` and the Kicker levels dossier: "Nothing found that names a 30-minute opening
  range." Superseded by Bysshe, Trade-Ideas and Qullamaggie's own 60-minute note (section 3).
- The EP research dossier writes Qullamaggie's windows as "1, 5 or 30-minute"; his words are 1, 5 or 60-minute, with
  the first 60-minute candle lasting 30 minutes.
- `docs/study/UNITS-method.md` SET.32 aims to teach "Say whether a swing entry fits the ORB timer and name the chase."
  That matches the trigger reading in this dossier.

---

## 6. UCT's own words

**Who wrote what.** Sunday Scans carry signed sections: "Bracco’s Breakdown & Top Ideas" and "TSDR’s Weekly Outlook &
Watchlist". TSDR is the owner. "The Rest of the Week" posts carry named sections ("TSDR TRADING", "Bracco", "Manrav"
and others). The "Charts Covered" list follows TSDR's section and is not signed separately; I label it so. Links are the
post URLs; dates are the publish date (US Eastern).

### 6.1 The owner's rulings (verdict log, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`)
- 2026-11-02 (line 318): "In terms of entry, on a kicker you can buy the opening range break (ORB), or the break of
  previous day high."
- 2026-11-02 (line 323): "Should be over previous day high or on day 1 kciker ORB on the 30 minute."
- 2026-11-02 (line 344): "the entry should 11.05 over THE previous day high." and "or on DAY 1 of the kciker candle on a
  30 min ORB"
- 2026-11-02 (line 340), the stop for both Kicker entries: "Under the kicker candle low or entry with a 3.5% stop but we
  should get these with smaller than 3.5% stop usually"
- 2026-11-09 (line 549), the gap rule B20: "20, gap against stop use 30 minute rules (let first 30 minute low of gap down
  day define new stop."
- Related rulebook answers: C30 "30, no" (no time-of-day rule); E57 "57, No i market order everything."; C35 "35, yes."
  (we swing trade).

### 6.2 The owner in public (TSDR's sections, "TSDR TRADING", "TSDR WATCHLIST")
- His ORB checklist, TMDX gapping up on earnings ([The Rest of the Week, 2026-02-24](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24);
  the post's subtitle says February 24th, 2025, but it was published in 2026), under "TSDR TRADING":
  "I will be interested to see how the first 15 min trade tomorrow morning." Then: "1. Relative volume in the first 15
  min", "2. Breaking opening highs", "3. Over $150 at least.", "Stop LOD." and "If unable or unwilling to try ORB at
  open. Look for a retest or an undercut and hold of VWAP mid morning."
- GRRR, an earnings gap ([Market Update and Watchlist, 2025-06-19](https://unchartedterritoryy.substack.com/p/market-update-and-watchlist),
  "TSDR WATCHLIST"): "This has strong potential if we open higher, break the opening range. Can enter there and place a
  stop at LOD and see how far it goes." Volume: "Look for relatively high volume in the first 1-2-3 minutes of the
  session." and "If it trades it’s average daily volume (2 million shares) in the first 5 minutes then press the gas and
  look for 30s to trade on it."
- The market as a whole ([Sunday Scans, 2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)): "If
  we see buying activity and opening ranges being taken out or strong hourly candles forming after the first 30 min then
  we can execute on our focus list."
- His gap-down sell plan, the source of B20 (same post): "I always use the first 30 min to let play out and establish the
  range. Then if it is not showing any signs of reversing I will execute my sell orders." and "Letting the first 30 min
  candle define your new stop is only applicable if you can afford the slight additional risk."
- Again ([Sunday Scans, 2025-11-02](https://unchartedterritoryy.substack.com/p/sunday-scans-b99)): hard stops "The only
  times these will be adjusted are on a gap down and will be replaced at the 15/30 min low and when moving my stop to
  breakeven".
- ALAB ([Sunday Scans, 2025-06-08](https://unchartedterritoryy.substack.com/p/sunday-scans)): "Anything in the $87-$90
  range and reclaim of red to green spot, previous day’s low, or opening range and I am a buyer."
- JOBY, a possible Kicker ([The Rest of the Week, 2025-10-28](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757)):
  "If it holds this and breaks it opening range tomorrow this is actionable with a stop at LOD."
- APPS on earnings ([The Rest of the Week, 2025-11-04](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9)):
  "I will be looking for an Opening Range Break or a “VWAP undercut and rally”." (APPS was $7.11 then; B23 now rules out
  stocks under $10.)
- AMD the day after its analyst day ([The Rest of the Week, 2025-11-11](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045)):
  "Look for entry on a pullback at open or a break of the opening range."
- A fill ([Sunday Scans, 2025-11-16](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a)): "SOXL from Friday’s
  opening range."

### 6.3 The "Charts Covered" list (inside TSDR's section, not signed separately)
- CRCL ([2025-06-15](https://unchartedterritoryy.substack.com/p/sunday-scans-744)): "The opening range break on Friday and
  taking out $120 sent this significantly higher."
- NBIS ([2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)): "Ideal on gap down, hold, and break
  opening range."
- DAVE before earnings ([2025-11-02](https://unchartedterritoryy.substack.com/p/sunday-scans-b99)): "But if this breaks
  out of this base I will be slapping that gap up and ORB."

### 6.4 Bracco (signed sections, his "Trade Updates" post, "The Parabolic Short")
- TEM, his Discord note reproduced in the first Sunday Scans ([2025-06-08](https://unchartedterritoryy.substack.com/p/sunday-scans)):
  "Bought this through the opening range highs on Friday." and "Current stop below Friday’s low."
- TEM again ([Trade Updates, 2025-06-09](https://unchartedterritoryy.substack.com/p/trade-updates)): "Gave plenty of
  opportunities to get involved today wether out of the intraday base, the red to green spot, the opening range highs,
  or through $65."
- USAR ([2025-10-05](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef)): "Got aggressive through the opening
  range highs and added through $19. Caught a massive day 1 breakout and trimmed 1/3 after hours" (the add is his; our
  rule A5 buys once, no adds).
- XNDU ([2026-05-03](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc)): "Bought this on the ORB highs on
  Friday as a pure momentum play."
- Short entries ([2025-12-28](https://unchartedterritoryy.substack.com/p/sunday-scans-249)): "I wait for signs of
  weakness such as a breakdown through VWAP, opening range lows, and/or lows of the day. I will always short weakness
  over strength."
- The Parabolic Short ([2025-06-13](https://unchartedterritoryy.substack.com/p/the-parabolic-short)):
  - the Quick Opening Range Breakdown "occurs at market open when the day's high is set on the first 5-minute candle,
    with an entry triggered by a breakdown below the 2- or 5-minute opening range." He warns "it often appears on day 1
    or 2 of the Parabolic Burst", too early, with limited follow-through and short traps, and says he is "not
    particularly fond" of it.
  - his preferred "U-Turn": "It begins with a gap-up and an opening range breakout, driving an upward trend at the
    open", then he shorts the VWAP break and the break of the day's low.
  - after a doji or hanging man top: "Usually any opening range breakdown and failure to fill the gap begins the backside
    of the move and can be traded back to the daily 9EMA."
  - the one real Breitstein link in UCT's writing: "The execution is where the “Right Side of the V” comes into play, a
    concept I picked up from Lance Breitstein."

### 6.5 Unsigned introduction (a caution, not a rule)
[Sunday Scans, 2026-03-08](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf), in a list of regrets a trader
should not have: "I wish I pushed the lever and took that 5-minute opening range break on the QQQ after a 2.1% range in
the overnight session only to open up trading flat or down 0.3%." The point of the passage is not to abandon the
swing plan to chase intraday trades.

### 6.6 Desk logs and Discord (paraphrased, not quoted)
These are messages from the paid Discord, summarised in `docs/study/levels/brain_kb_rules_2026-11-06.json` and
`brain_kb_cycle_2026-11-06.json`. The repo is public and Discord text must not be copied into it, so I give
paraphrases with the KB number. None was re-checked against Discord. The knowledge base mis-dates some Substack items
(it files the SOXL line, KB 5060 and 6021, under 2026-02-21; the post is 2025-11-16).
- **The owner (TSDR):**
  - KB 10111 (2025-06-09, CEP): his order of events for a possible Kicker: gap over a level, break of the opening range,
    then of the previous day's high; heavy premarket and opening volume wanted.
  - KB 9992 (2025-01-21, ASAN): a break of the prior session's opening high triggering a Kicker.
  - KB 10088 (2025-05-12, OSCR): the opening range high could trigger a PEG breakout that day, but ideally the stock
    would stay inside the range and set up for the next day.
  - KB 11596 (2025-07-24): on a strong news gap, the textbook entries are a 1, 2 or 5-minute ORB, or the VWAP
    undercut-and-reclaim that often comes 10 to 40 minutes in, with a stop at the low of the day or under the undercut.
  - KB 12544 (2026-04-29, RVMD): his plan for every path: buy the ORB, stop out if it breaks the lows, buy again on a
    retake of the day's high.
  - KB 12545 (2026-04-30): intraday entry options on an EP: the ORB, a gap undercut and hold, a VWAP remount, a VWAP
    retest.
  - KB 12555 (2026-05-01): day-1 earnings gappers had lately been failing the ORB, dipping to the lows and then
    remounting (or moving 2 to 3 days later); he planned to buy the undercut of the ORB low or the VWAP remount instead.
  - KB 10831 (2024-12-20, QQQ): a 15-minute opening range on a gap down, an undercut of its low, then a reclaim and break
    of its high.
  - KB 12294 (desk log dated 2026-01-23, covering 01-23 to 01-28; RDW): a Kicker that held its gap and ran from the
    opening range on 01-27.
- **Bracco:** KB 11270 (2024-07-27): bought ASTS on the **15-minute** ORB of its EP day (2024-05-16) and trailed the
  20-day EMA. KB 12242 (2026-01-08): an opening range breakout is a pattern, not an indicator. KB 10975 and 11232
  (2024-11, 2025-02): on a parabolic climax day, short the opening range low or a VWAP failure, and cover toward the
  daily 9 EMA.
- **Other UCT writers:** AtTheAsk, KB 11144 (2025-01-03): an ORB on CRNC would have made about 30%, with a stop at the low
  of the day because the opening candle was not too large. AtTheAsk, KB 11005 (2024-07-18): IWM failing back under its
  opening range from below was a short entry (analysis only). Manrav, KB 15695 (2026-09-03): best reward-to-risk spots
  include oops reversals, retests and 30-minute pivots.
- **Outside voices in the knowledge base (not verified, not sources):** an X post by AmeetRai (KB 16457: after an oops
  reversal, wait for the ORB); X posts by SteveDJacobs (KB 18800: swing traders buy after the ORB and avoid the first 15
  to 30 minutes); a TraderLion note (KB 19319: a day-1 ORB only if you were watching before the open); a Qullamaggie
  stream summary (KB 2499: ENVB bought as an opening range shot on huge early volume).

### 6.7 Examples on record (for the example hunt; plans and fills, not checked against bars)
| Date | Ticker | Who | Kind | Source |
|---|---|---|---|---|
| 2023-12-14 | JBI | owner | Kicker day-1, PDH 11.05 and 30-min ORB 11.21 | verdict log; section 4.9 |
| 2024-05-16 | ASTS | Bracco | EP day, 15-min ORB | KB 11270 |
| 2025-01-03 | CRNC | AtTheAsk | gap ORB, stop LOD | KB 11144 |
| 2025-06-06 | TEM | Bracco | bought through the ORH, stop under the day's low | Sunday Scans 2025-06-08 |
| 2025-06-13 | CRCL | Charts Covered | ORB and $120 near IPO highs | Sunday Scans 2025-06-15 |
| 2025-06-20 (plan) | GRRR | owner | earnings gap ORB, stop LOD | Market Update 2025-06-19 |
| 2025-10-02 | USAR | Bracco | ORH on an all-time-high base breakout | Sunday Scans 2025-10-05 |
| 2025-10-29 (plan) | JOBY | owner | Kicker ORB, stop LOD | Rest of the Week 2025-10-28 |
| 2025-11-12 (plan) | AMD | owner | day after the analyst day: pullback at the open or ORB | Rest of the Week 2025-11-11 |
| 2025-11-14 | SOXL | owner | ORB fill (leveraged ETF) | Sunday Scans 2025-11-16 |
| 2026-01-27 | RDW | owner | Kicker ran from the opening range | KB 12294 |
| 2026-02-25 (plan) | TMDX | owner | earnings gap, the three-point checklist | Rest of the Week 2026-02-24 |
| 2026-05-01 | XNDU | Bracco | ORB highs on a high tight flag | Sunday Scans 2026-05-03 |
Dates for "Friday" and "Thursday" are worked out from the post date. APPS (2025-11-05 plan) is left out: under $10.

### 6.8 What UCT has not written
No public UCT post fixes the window outside the Kicker ruling, gives a volume number, a time limit, a range-width limit
or a target for an ORB, or teaches the ORB as a stand-alone day trade. The opening range low is used for shorts only in
the parabolic setting.

---

## 7. How it fits the account rulebook (section 9)

| Rule | How it applies to an ORB | Conflict? |
|---|---|---|
| A3 / F62 stop a few cents under the day's low | The natural ORB stop. At a first break it is usually the 30-minute low. | No. |
| A4 the stop only moves up | Fits. | No. |
| A5 one price, one stop, no adds | The ORB is the single entry. Bracco's "added through $19" and Bysshe's second-breakout tactic are adds; not ours. | Teach the ORB as one entry. |
| A13 stop usually within about 3% | Fits 85% of ordinary days; fails on most 3%+ gap days (42% fit; JBI 3.7%). | **Yes, on gap days.** Question 5. |
| A7 position cap 40% | A 1.6% stop at 1% risk gives a 62% position; the cap binds often on tight ORBs. | No, but the cap matters. |
| B18 / F65 market filter | Green full, Yellow smaller, Orange A+ only, Red mostly cash and shorts. | No. |
| B19, E51, E52 trims and trail | Breakeven at 2R to 5R; a third at 3R and at 5R; trail the 10-day (fast) or 21-day; sell on a close below. | No. The app's 2x range target is not ours. |
| B20 a gap through the stop | First 30-minute low of the gap-down day is the new stop; out past 2R. The same 30-minute idea, used for exits. | No. |
| B21 re-entry after a stop-out | His RVMD plan (stop out, buy the retake of the day's high) is a new trigger with a new stop. | No; see E56. |
| B22 earnings | No new buys in the 3 days before a report. An ORB on the day after the report (TMDX, APPS, GRRR) is allowed. | No. |
| B23 $10 and $20M a day | Applies. APPS ($7.11) would now be out. | No. |
| B26 the 200-day, hard rule | ORB longs only above the 200-day; ORB breakdown shorts only below it, except parabolic shorts (Bracco's ORL). | No. |
| C28 no chasing past 4% | The buy point is the ORH; a fill more than 4% above it is a chase. Rare at a trade-through; real after a fast spike. | No. |
| C29 skip a long more than 10% above the 10-day | Many earnings and EP gap days open more than 10% above the 10-day (the owner's GRRR post: "Gapping up 15% in after hours following their earnings report."). | **Yes.** Question 9. |
| C30 no time-of-day rule | The ORB is defined by the clock (the first 30 minutes). | **Yes, in spirit.** Read C30 as no rule about when you may trade; the 30 minutes is part of the trigger's definition. Question 2. |
| C31 RS 80+ (shorts RS 20 or less) | Applies; the ORB is not a mean-reversion trade. | No. |
| C33 time stop: under 1R after 10 days | Applies. | No. |
| C35 swing trade | The ORB opens a swing trade; Crabel's and Zarattini's same-day exits are not ours. | **Yes, against the originator.** Taught as a deliberate change. |
| D39 entry, stop and size written before the open | The ORH and the stop are unknown until 10:00. | **Partly.** Write the plan as a rule: *buy a cent over the 30-minute high; stop a few cents under the day's low; size from that; skip if the stop is over 3%.* |
| D41 a real stop order | Place it as soon as the order fills. | No. |
| D42 at most 1% of the day's volume | Applies. | No. |
| D47 / D48 shorts mirrored; skip hard-to-borrow | The breakdown is the mirror; borrow checked before the open. | No. |
| E56 at most 3 tries a week, 6 a month | Repeated ORB attempts on the same stock count. | No. |
| E57 market orders | Market order when it trades through the ORH. A resting buy-stop becomes a market order when hit; the owner should say if that is allowed. | Question 4. |
| E58 regular hours only | The ORB is regular-hours by definition; premarket highs are not the OR. | No. |
| F63 a gap past a trim level | Applies to later days. | No. |

---

## 8. Proposed rules for our course

### 8.1 What it is
1. **Role:** the ORB is an entry trigger for a daily setup that is already on the focus list (Kicker, EP / PEG, base or
   IPO-high breakout, pullback setups). It is not traded alone. [UCT] [originator: Bysshe, Qullamaggie] [my proposal]
2. **The opening range:** the high and low of the first 30 minutes of regular trading, 9:30 to 10:00 ET (the first
   30-minute candle). [UCT: Kicker ruling] [originator: Bysshe; Qullamaggie's first 60-minute candle] Other windows
   (5 or 15 minutes) only if the owner approves them (question 1).
3. **Prior trend:** whatever the parent setup requires, and at least: the prior close above the 200-day [house rule
   B26]; RS 80 or more [house rule C31]. Also above the 50-day [my proposal; the nearest source is Bysshe, who wants
   the 20 and 50-day rising and the stock above the 20-day].
4. **Structure:** none of its own. Grade higher when the ORH is well defined (tested more than once, or a tight
   consolidation just under it). [originator: Bysshe]
5. **Length:** 30 minutes [UCT: the Kicker ruling]. The trigger stays valid for the rest of that session [my proposal;
   house rule C30 sets no time-of-day rule, and no UCT text names a cut-off]. Later triggers are graded lower
   (section 9). [my proposal]
6. **Depth (risk):** the distance from the trigger to a few cents under the day's low must be 3% or less [house rule
   A13]; on a Kicker, up to 3.5% under the entry [UCT]. If it is wider, skip the ORB (or, if the owner allows, use the
   previous-day-high trigger or a tighter intraday swing low; question 5). [my proposal; Bysshe]
7. **Volume:** the first 15 or 30 minutes must trade clearly more than normal for that window. [UCT: "Relative volume in
   the first 15 min"] [measured: Zarattini, below 100% relative volume the ORB lost] Proposed number: first-30-minute
   volume at least 1.5 times its 20-day average for the same window. [my proposal; the number needs the owner, question 6]
8. **Location versus the averages:** above the 200-day [house rule B26]; above the 50-day [my proposal; Bysshe asks
   for the 20-day, with the 20 and 50-day rising]; not more than 10% above the 10-day at the trigger [house rule C29],
   unless the owner exempts gap-day EPs (question 9). The 21-day matters only
   for the trail.
9. **Liquidity:** $10 or more and $20 million a day [house rule B23]; the position at most 1% of the day's volume
   [house rule D42].

### 8.2 The buy
1. **Trigger:** price trades at least one cent above the 30-minute high after 10:00 ET. Not a close. [source consensus:
   Crabel's stops, Raschke's stops, Trade-Ideas, Qullamaggie, Zarattini] [UCT: the JBI ruling, 11.05 over an 11.04
   high; "Breaking opening highs"]
2. **Order:** a market order the moment it trades through (E57). [house rule]
3. **Chasing:** no fill more than 4% above the 30-minute high [house rule C28]. If you missed it, wait for a pullback to
   the ORH that holds, or the owner's alternative, a VWAP retest or undercut-and-hold mid morning. [UCT] [originator:
   Bysshe's tactic 2; Steenbarger's first pullback]
4. **Order of triggers on a Kicker:** if the stock opens below the previous day's high, the previous-day-high order comes
   first and is cheaper; the ORB is the confirmation entry. If it opens above the previous day's high, the ORB is the
   patient entry. [UCT] [measured: JBI]
5. **Plan before the open:** write the rule, not the price: *buy a cent over the 30-minute high, stop a few cents under
   the day's low, size from that distance, skip if over 3%.* [house rule D39] [my proposal]

### 8.3 The stop
1. A few cents under the low of the day at the moment of the fill, normally the 30-minute low. [house rule A3, F62]
   [originator: Qullamaggie] [UCT: "Stop LOD."]
2. 3% or less from the fill; 3.5% maximum on a Kicker (the Kicker low or 3.5% under the entry, whichever is closer).
   [house rule A13] [UCT]
3. A real stop order, placed at once; it only moves up. [house rule D41, A4]
4. A gap below the stop on a later day: the first 30-minute low becomes the stop; out if that is past 2R. [house rule B20]

### 8.4 Trims and trail (house defaults; no ORB-specific rule exists)
1. Stop to breakeven between 2R and 5R. [house rule B19]
2. Sell a third at 3R, a third at 5R; if a later day opens above a trim level, trim at the open. [house rule B19, E51, F63]
3. Trail the last third under the 10-day (fast movers) or the 21-day (steadier), selling on a close below. [house rule E52]
4. Time stop: under 1R after 10 trading days, sell. [house rule C33]
5. Not ours: the app's target of twice the range; Crabel's exit at the close; Qullamaggie's 1/3 to 1/2 after 3 to 5 days
   (taught only when the question names him). [my proposal]

### 8.5 What invalidates it
1. **Before the fill:** if the 30-minute low breaks before the 30-minute high, the plain ORB long is off for the day.
   [originator: Crabel's ORBP cancel rule] [my proposal] A reclaim after that undercut is a different entry (oops, red to
   green, VWAP remount) with its own rules. [UCT: KB 12555, TMDX alternative]
2. The parent setup is broken (for a Kicker, a trade under the red day's low before the open).
3. The market reading is Red. [house rule B18, F65]
4. The stop distance is over 3% (3.5% on a Kicker). [house rule A13] [UCT]
5. **After the fill:** the stop decides. A big-volume reversal back into the range is the classic failure (Bysshe);
   it is a warning to watch, not a second exit rule ("my stop is my stop", the owner, sizing_rule.md section 6). [UCT]

### 8.6 The short mirror (opening range breakdown)
1. A trade at least one cent below the 30-minute low, market order. [house rule D47, E57]
2. Only below the 200-day, RS 20 or less, in a weak group, borrow available at a normal fee. [house rule B26, C31, D48]
3. Stop a few cents above the day's high at the fill; 3% or less. [house rule D47, A13]
4. Trims and trail mirrored (cover a third at 3R and 5R, trail above the 10 or 21-day). [house rule D47]
5. **Parabolic exception:** on a parabolic climax above the 200-day, Bracco's rules apply: prefer the U-Turn (gap up and
   ORB, then the VWAP break and the day's-low break); treat the Quick Opening Range Breakdown with caution, especially
   on day 1 or 2 of the burst; stop above the day's high; target the 9-day average. [UCT: Bracco] [house rule B26, D47]
6. Measured note: in my count the breakdown on 3%+ gap-down days was the only positive cell (+0.24R same day, +0.48R over
   five sessions, 1,052 cases in one period). Promising, not proof. [measured]

### 8.7 Best market conditions
1. A Green market reading; Yellow at smaller size; Orange only A+; Red, shorts only. [house rule B18, F65]
2. The indexes themselves taking out their opening ranges: "If we see buying activity and opening ranges being taken out
   or strong hourly candles forming after the first 30 min then we can execute on our focus list." [UCT]
3. A stock "in play": a catalyst and heavy opening volume. [measured: Zarattini] [UCT] [originator: Qullamaggie]
4. After contraction: an inside day, an NR4/NR7 day, or a tight base the day before. [originator: Crabel, Raschke]
5. An ORH that sits at or above the prior day's high or a key daily level. [originator: Bysshe] [UCT: "Over $150 at
   least."; KB 10111]

### 8.8 Common mistakes
1. Trading the ORB without a daily setup (the bare ORB had no edge in my count). [measured]
2. Buying a break on ordinary volume. [measured: Zarattini] [UCT] [originator: Bysshe]
3. Taking an ORB whose stop is over 3% because the stock gapped. [house rule A13] [measured]
4. Chasing a spike far above the ORH. [house rule C28] [originator: Bysshe]
5. Buying a sloppy range with no clear high. [originator: Bysshe]
6. Waiting for a 5-minute close (late fills, wider risk). [source consensus]
7. Treating the opening minutes as the trade: buying before 10:00 because it is running. The ORB waits for the range.
   [my proposal; the owner's Kicker ruling names the 30-minute ORB, and his gap-down rule lets "the first 30 min"
   play out] (`docs/study/bank/course.f8.json` drills the same discipline: "Wait for the opening range to form".)
8. Ignoring the daily chart (Bysshe's NTES versus SOHU example: same news, different daily trends, different results).
   [originator: Bysshe]
9. Taking the ORB after an expansion day. [originator: Crabel]
10. Repeating failed ORBs on the same stock past the limit. [house rule E56]
11. Day-1 earnings gappers that fail the ORB: switch to the ORB-low undercut or the VWAP remount, as the owner noted.
    [UCT: KB 12555]

---

## 9. Grading: what makes an A+ versus a B-

The owner rules grading discretionary (E50: "It is discretionary and hard to define."). These are observable features
from the sources, offered as a guide, not a checklist.

| Grade | What you can see |
|---|---|
| **A+** | A real daily setup in a leader (RS 80+, top group), above a rising 50-day and the 200-day [house; Bysshe]. A catalyst or clear news, with the first 15 to 30 minutes on several times normal volume; the best trade their average daily volume in the first 15 to 30 minutes [UCT; Qullamaggie; Zarattini]. A tight, well-defined range with the price holding near the ORH [Bysshe]. The ORH at or above the prior day's high and a key daily level [Bysshe; UCT]. Stop 2% or less [my proposal; A13 caps it near 3%]. A quick, clean break that holds above the ORH for about 15 minutes [Bysshe's half-the-range-time rule]. Green market, indexes also taking out their opening ranges [UCT]. Contraction the day before (inside day, NR7, tight base) [Crabel; Raschke]. Early trigger, by about 10:30 [my proposal; measured: 55% of first long breaks in my count came by 10:30]. |
| **A** | Most of the above; volume clearly above normal but not exceptional; stop up to 3%. |
| **B** | A good daily setup but an average-volume open; a range that is wide or loose; the ORH below the prior day's high or into nearby resistance; a trigger late in the day; Yellow market. |
| **B-** | Any of: stop over 3% (skip under A13 unless the owner approves an exception); range low broken first; a sloppy range with no clear high; below-normal opening volume [Zarattini: negative]; an expansion day before [Crabel]; a counter-trend break; a big-volume reversal at the ORH already printed [Bysshe]. |

Under D38 and E49: A+ sized up (1% to 1.5% risk), A and B normal (0.5% to 1%), B- small (0.25% to 0.5%) or skipped.

---

## 10. Questions for the owner

1. **The window.** (a) 30 minutes always (your Kicker ruling); (b) 30 minutes by default, 5 or 15 minutes allowed on big
   catalyst days (Bracco's ASTS 15-minute ORB; Zarattini found 5 minutes best as a day trade); (c) let the member choose.
   I recommend (a) for teaching: one window, matching your ruling and B20.
2. **C30 and the clock.** Is the 30-minute window part of the trigger's definition (so C30 still holds), and is the
   trigger valid all day or only until a time (10:30, 11:00, noon)? Most first breaks in my count came by 10:20.
   I recommend: valid all session, later triggers graded lower.
3. **ORB versus the 30-Minute Pivot.** The Model Book has both. Is the 30-minute pivot a later consolidation under the
   first half-hour high (patient), and the ORB the first trade through it (aggressive)? Or are they one setup?
4. **The order.** (a) watch and market-order on the trade through (E57 as written); (b) a resting buy-stop a cent over the
   ORH, which becomes a market order when hit. I recommend allowing (b): it is how every source executes and it removes
   the chase.
5. **Wide ranges on gap days.** When the stop would be over 3% (most 3%+ gap days): (a) skip; (b) use 3.5% as on the
   Kicker; (c) use a tighter intraday swing low (Bysshe); (d) prefer the previous-day-high trigger. I recommend (a) or
   (d), because A13 is settled and (b) and (c) put the stop inside the day's noise.
6. **Volume.** Set a number for "Relative volume in the first 15 min" (or the first 30 minutes): (a) none, judgment; (b) at least 1.5x
   the 20-day average for that window; (c) at least 2x; (d) Qullamaggie's "average daily volume in the first 15-30
   minutes" as the A+ mark. I recommend (b) as the gate and (d) as the A+ mark.
7. **Must the ORH clear the prior day's high?** (a) required; (b) graded higher; (c) ignored. I recommend (b) (Bysshe; your
   CEP and TMDX plans).
8. **Range low broken first.** Is the long ORB off for the day once the 30-minute low trades first (my proposal), or can
   you still buy a later ORH break the same day?
9. **C29 on gap days.** Do earnings or EP gap-day ORBs (often more than 10% above the 10-day) need an exemption from C29,
   like parabolic trades are exempt from B26?
10. **Shorts.** Teach the opening range breakdown as a short below the 200-day (D47 mirror), only Bracco's parabolic
    versions, or both?
11. **Re-entry the same day.** Your RVMD plan (stopped out, then buy the retake of the day's high): allowed under B21 and
    counted against E56?
12. **The scanner.** (a) rewrite it (trade-through trigger, opening-range relative volume, house filters, no 2.5% cap, run
    on the clock at 10:00 and every 5 minutes after); (b) retire it and teach the ORB as a manual trigger; (c) leave it.
    And: remove the unverified Crabel and Breitstein claims from the member-facing text now? I recommend removing the
    text now and (a) later.
13. **Day numbering.** Keep your "DAY 1" for the Kicker gap day everywhere in the course (some app files say day 2)?

---

## 11. Sources

All read 2026-11-09 unless noted. "Read" means the page or PDF text was downloaded and searched; quotes were checked by
script against that text.

| # | Source | Publisher / author | URL or location | Reliability note |
|---|---|---|---|---|
| 1 | "Playing the opening range breakout Part 1", S&C V.6:9 (Sept 1988), abstract | Technical Analysis of Stocks & Commodities; Toby Crabel | https://store.traders.com/-v06-c09-playing-pdf.html | Originator, primary (publisher's abstract; full article not bought) |
| 2 | "Opening range breakout: early entry Part 2", V.6:10 (Oct 1988), abstract | S&C; Toby Crabel | https://store.traders.com/-v06-c10-openran-pdf.html | Originator, primary (abstract) |
| 3 | "Opening Range Breakout Part 3", V.6:12 (Dec 1988), abstract | S&C; Toby Crabel | https://store.traders.com/-v06-c12-opening-pdf.html | Originator, primary (abstract) |
| 4 | "Opening range breakout Part 4", V.7:2 (Feb 1989), abstract | S&C; Toby Crabel | https://store.traders.com/-v07-c02-orb-pdf.html | Originator, primary (abstract) |
| 5 | "Opening range breakout Part 5", V.7:4 (Apr 1989), abstract | S&C; Toby A. Crabel | https://store.traders.com/-v07-c04-orb-pdf.html | Originator, primary (abstract) |
| 6 | "Opening Range Breakout Part 6", V.7:5 (May 1989), abstract | S&C; Toby Crabel | https://store.traders.com/-v07-c05-orb-pdf.html | Originator, primary (abstract) |
| 7 | "Opening Range Breakout Part 7", V.7:6 (June 1989), abstract | S&C; Toby Crabel | https://store.traders.com/-v07-c06-orb-pdf.html | Originator, primary (abstract) |
| 8 | "Opening Range Breakout Part 8", V.7:7 (July 1989), abstract | S&C; Toby Crabel | https://store.traders.com/-v07-c07-orb-pdf.html | Originator, primary (abstract) |
| 9 | Crabel 8-article package page | S&C store | https://store.traders.com/tocroprabrpa.html | Confirms the series has eight parts |
| 10 | Definition of Price Patterns, Toby Crabel (page title) | Time Price Research blog (anonymous) | https://time-price-research-astrofin.blogspot.com/2012/04/toby-crabel-definition-of-patterns.html | Low to medium: anonymous blog, rewritten as an essay (possibly AI-assisted); book quotes match S&C where they overlap; the rest unverified |
| 11 | Narrow Range Day (NR7) | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7 | Established educator; secondary on Crabel |
| 12 | "Trading Opening Range Breakouts", 20 Mar 2007 | TraderFeed; Brett Steenbarger | https://traderfeed.blogspot.com/2007/03/trading-opening-range-breakouts.html | Established educator; opinion and examples, no statistics |
| 13 | "Toby Crabel And The Epistemology Of Trading Expertise", Mar 2007 | TraderFeed; Brett Steenbarger | https://traderfeed.blogspot.com/2007/03/toby-crabel-and-epistemology-of-trading.html | Context only |
| 14 | "Toby Crabel" | Wikipedia | https://en.wikipedia.org/wiki/Toby_Crabel | Low; used only for the book's year (agrees with StockCharts) |
| 15 | "Capturing Trend Days" | TradersLog (repost dated 2025-02-11); Linda Bradford Raschke | https://www.traderslog.com/?p=823 | Originator-level practitioner; original publication date not shown |
| 16 | *Trading the 10 O'clock Bulls*, First Edition 1.06, © 2009 | MarketGauge; Geoff Bysshe | https://www.marketgauge.com/TradingThe10OclockBulls.pdf | Established practitioner and vendor; full PDF read (ch. 2, 4, 5); his 35% statistic has no method |
| 17 | *The Opening Range Handbook, Part 1*, © 2009 | MarketGauge; Geoff Bysshe | https://marketgauge.com/or-ebook/TheOpeningRangeHandbook-Part1.pdf | Same content as 16, chapters 1-4 |
| 18 | "Timing Swing Trade Entries with The O.R.", 23 Feb 2015 | MarketGauge; Geoff Bysshe | https://marketgauge.com/resources/littlebigview-trades-tutorials/timing-swing-trade-entries-with-the-o-r/ | Video only; not watched |
| 19 | *The Logical Trader* (2002), publisher description | Wiley-VCH; Mark B. Fisher | https://www.wiley-vch.de/en/areas-interest/finance-economics-law/the-logical-trader-978-0-471-21551-6 | Publisher text only; book not read |
| 20 | "3 TIMELESS setups that have made me TENS OF MILLIONS!", 8 Jan 2021, updated 28 Apr 2021 | qullamaggie.com; Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Originator (his own page) |
| 21 | "A Profitable Day Trading Strategy For The U.S. Equity Market", 16 Feb 2024 | Zarattini, Barbon, Aziz; SSRN 4729284 / SFI 24-98 | https://www.alexandria.unisg.ch/server/api/core/bitstreams/3c2989c4-688d-4d78-8a71-f02690990d51/content | Measured, full PDF read; working paper; authors linked to trading-education firms |
| 22 | "Can Day Trading Really Be Profitable?" summary page | Concretum Group; Zarattini, Aziz | https://concretumgroup.com/can-day-trading-really-be-profitable/ | Authors' summary only; paper (SSRN 4416622) not read |
| 23 | "Assessing the profitability of intraday opening range breakout strategies", FRL 10(1) 2013 | Holmberg, Lönnbark, Lundström | https://econpapers.repec.org/RePEc:eee:finlet:v:10:y:2013:i:1:p:27-33 (and https://swopec.hhs.se/umnees/abs/umnees0845.htm) | Peer-reviewed; abstract only |
| 24 | "Market intraday momentum", JFE 129(2) 2018 | Gao, Han, Li, Zhou | https://econpapers.repec.org/RePEc:eee:jfinec:v:129:y:2018:i:2:p:394-414 | Peer-reviewed; abstract only; related, not an ORB test |
| 25 | "Assessing the Profitability of Timely Opening Range Breakout on Index Futures Markets", IEEE Access 2019 | Tsai et al. (Crossref metadata) | https://doi.org/10.1109/ACCESS.2019.2899177 | Not read; finding known only through source 21 |
| 26 | *Swing and Day Trading: Evolution of a Trader* (Wiley, 2013), table of contents | Kinokuniya listing; Thomas Bulkowski | https://www.kinokuniya.co.jp/f/dsg-12-EY00088793 | Contents only; chapter 11 not read |
| 27 | 30 Minute Opening Range Breakout / Breakdown alerts (ORU30, ORD30) | Trade-Ideas | https://trade-ideas.com/help/alert/ORU30/ ; https://www.trade-ideas.com/help/alert/ORD30/ | Data vendor definition |
| 28 | "Strategy: 5-Min Open Range Breakout" slides | Bear Bull Traders; Carlos Moreta | https://members.bearbulltraders.com/wp-content/uploads/2023/04/Strategy-12-5-Min-ORB.pdf | Low: school's member slides |
| 29 | "Market profile" | Wikipedia | https://en.wikipedia.org/wiki/Market_profile | Low; initial balance definition only |
| 30 | Chat With Traders ep. 228, Lance Breitstein, The Ultimate Day Trader, Pt. 1 (title punctuation simplified), 9 Feb 2022 | Everand listing | https://www.everand.com/podcast/557839622/228-Lance-Breitstein-The-Ultimate-Day-Trader-Pt-1-Lance-Breitstein-was-a-senior-trader-at-Trillium-and-manager-of-the-Chicago-office-He-set-the | Page text downloaded; quote checked; used for his firm |
| 31 | "opening range breakout report" | Edgeful blog | https://www.edgeful.com/blog/posts/opening-range-breakout-report | Vendor marketing; no numbers; not used |
| 32 | Investopedia "openingrange.asp" | Investopedia | https://www.investopedia.com/terms/o/openingrange.asp | Returned not found; not used |
| 33 | UCT Substack, all 103 posts in the sitemap (102 public), downloaded through the site's post API | Uncharted Territory (the owner as TSDR, Bracco, others) | https://unchartedterritoryy.substack.com/sitemap.xml ; posts linked in section 6 | House, primary; every UCT quote checked by script |
| 34 | Owner verdict log | UCT, repo | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | House, primary (his words) |
| 35 | Account rulebook; trade plans | UCT, repo | `docs/study/sizing_rule.md` section 9; `docs/study/TRADE_PLANS.md` | House, primary |
| 36 | Detectors, scan wiring, registry, router, fixtures | UCT, repo | `api/services/pattern_engine/detectors/uct/opening_range_breakout.py`, `opening_range_breakdown.py`, `lance_opening_drive.py`; `api/main.py`; `api/services/pattern_engine/detectors/registry.py`; `api/routers/patterns.py`; `tests/fixtures/opening_range_breakout/_generate.py` | House code |
| 37 | Model Book card, playbooks, journal tags | UCT, repo | `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`; `app/src/constants/setupGroups.js` | House |
| 38 | Study plan files and bank | UCT, repo | `docs/study/skill_map.json`, `UNITS-method.md`, `UNITS-foundations.md`, `levels/external_research.md`, `levels/dossiers/kicker.md`, `bank/*.json`, `research/definitions.json`, `setups/research/20-episodic-pivot.md` | House; several claims corrected above |
| 39 | Discord knowledge-base extracts | UCT, repo | `docs/study/levels/brain_kb_rules_2026-11-06.json`, `brain_kb_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json` | House summaries of private messages; paraphrased only; some dates wrong |
| 40 | JBI 30-minute bars, 2023-12-13 to 12-14 | UCT, repo | `docs/study/workbench/walkthrough/data/JBI_2023-12-14_30m.json` | House data (site's bars route) |
| 41 | Shared intraday scratch database (Yahoo 5-minute and 60-minute bars) | built in this session's research scratch area | not in the repo | Third-party data, used for aggregate counts only (section 4.8) |
| 42 | Swiss Finance Institute Research Paper Series 24-98 (RePEc listing of source 21) | RePEc / EconPapers | https://econpapers.repec.org/RePEc:chf:rpseri:rp2498 | Added in the cold check; confirms the SFI paper number, which the PDF text does not carry |
| 43 | Crossref record for source 25 (DOI 10.1109/ACCESS.2019.2899177) | Crossref API | https://api.crossref.org/works/10.1109/ACCESS.2019.2899177 | Added in the cold check; confirms IEEE Access, 2019, authors Tsai, Wu, Syu, Lei, Wu, Ho |

---

## 12. Removed in checking (cold check, 2026-11-09)

Checked and **confirmed without change**: all 8 S&C volume, issue and page citations; every quote from Crabel's
abstracts, the Time Price Research blog, StockCharts, Steenbarger (page dated Tuesday, March 20, 2007), Raschke
(TradersLog `datePublished` 2025-02-11), Bysshe (First Edition 1.06, © 2009, "Now, 14 years", the 35% and 8%
figures, 2:1, the NTES-versus-SOHU charts of 6 Oct 2003 in Figure 5-8), Qullamaggie (published 2021-01-08, modified
2021-04-28), Zarattini et al. (dated February 16, 2024; every figure in the 4.2 table, the universe filters, the 1% /
4x / $0.0035 settings, the -0.02R / 0.08R / 0.38R relative-volume figures, the "unclear and warrants" sentence),
Concretum (1,484% versus 169%, 33% alpha, SSRN 4416622), Holmberg et al. (FRL 10(1), 27-33), Gao et al. (JFE 129(2),
394-414), Bulkowski's chapter 11 contents, Trade-Ideas, the Wiley text (1st edition August 2002), Wikipedia (Market
Profile, 1985, Steidlmayer; Crabel's book 1990, Traders Press), the Everand listing (Feb 9, 2022; the Trillium
sentence) and the Bear Bull slides. Every Substack quote in section 6 is on its page, under the section the dossier
names (the NBIS and CRCL lines sit under an inline "Charts Covered" label inside TSDR's section; Trade Updates opens
"Bracco here"; the Parabolic Short's subtitle is "Bracco (@braczyy on X)"); every publish date matches the post's
`datePublished` in US Eastern time; the TMDX post's subtitle does read "February 24th, 2025" while the post is dated
2026-02-25 UTC. All 22 KB numbers in section 6.6 exist in the three KB files and their paraphrases match the stored
summaries; KB 5060 and 6021 are indeed filed under "sunday_scans_2026-02-21". The verdict-log line numbers (318, 323,
340, 344, 549) and all 34 rulebook rule numbers cited in section 7 match `sizing_rule.md` section 9 (71 rules). The
detector constants, the search window (`max(_OR_BARS, last_idx - 2)`), the levels, the score weights, the Stage 2
penalty of 5 in the breakdown, the hourly `IntervalTrigger`, the 4-hour session split, the 9-bar minimum, the
`DISPLAY_INTRADAY_ONLY` registry comment, the router category "uct", the Model Book essence lines, the playbook texts
and the journal tags all read as the dossier says. Every narrative claim in the 5.5 table is in the detector code word
for word. The JBI arithmetic in 4.9 reproduces from the bars file. The own count in 4.8 re-ran and matched exactly.

Changed:
1. Section 2, Crabel's book: removed "Greenville". Only the anonymous blog gives the city; Wikipedia gives the publisher
   (Traders Press) and StockCharts the year.
2. Section 4.1 limits: "bonds, S&P, grains, cattle" became "Treasury bonds, the S&P, soybeans and cattle", the markets
   the abstracts actually name (Parts 4 and 7).
3. Section 4.5 limits: "the market ETF (SPY)" became the abstract's own wording (the S&P 500 ETF and "ten other most
   actively traded domestic and international ETFs"); the abstract does not say "SPY".
4. Sections "Read this first" 3 and 4.8: "1,000 liquid US stocks" became 999, the number of tickers with 5-minute bars
   in the script's output.
5. Section 4.2: the SFI paper number 24-98 is not in the PDF text; it is confirmed by the RePEc listing, now source 42.
6. Section 5.5: the Breitstein timing tiers are now quoted as the code states them (the long text says the first 10-30
   minutes after the range closes; the short text says 9:45-10:30 ET), instead of a rounded "10:30".
7. Section 5.2: added the leader-universe file, the 30-daily-bar minimum, the `PATTERNS_INTRADAY_SCAN_ENABLED` kill
   switch and the code comment recording the pass's two-month deletion in 2026 (all from `api/main.py`).
8. Section 6.6, KB 12294: the desk log is dated 2026-01-23 (covering 01-23 to 01-28); the RDW run from the opening
   range was 01-27. The dossier had given the event date as the KB date.
9. Section 7, C29 row: "GRRR gapped 15%" is now the owner's own sentence from the post ("Gapping up 15% in after
   hours"), because the 15% is his after-hours figure, not a measured open.
10. Section 8 basis tags corrected where they overstated a source: 8.1.3 and 8.1.8 (the 50-day is my proposal; B26 is
    the 200-day only; Bysshe asks for the 20-day with the 20 and 50-day rising); 8.1.5 (an all-session trigger is my
    proposal, C30 only says there is no time-of-day rule; no UCT text names a cut-off); 8.2.1 (the UCT basis is the
    JBI ruling and "Breaking opening highs", not a quoted phrase "a cent over"; Raschke added to the consensus); 8.8.7
    (tagged my proposal with the UCT texts that imply it, and the course.f8 item quoted); section 9 A+ "early trigger"
    now carries its tag and the measured 55%.
11. Section 3.12: added the 402 status of the cold-check fetch and the bank's actual Investopedia URL.

Not independently re-checked (kept as the writer's statements): the "102 public" of 103 sitemap posts (the sitemap
count of 103 was confirmed); that the writer's web-search budget ran out before a second Stockbee search; and that the
Trade-Ideas trigger "fires once a day" (the page says "the first time price trades above that high", which implies it).
James Dalton's "Open-Drive" is confirmed only by secondary summaries of *Mind Over Markets* (the dossier already says
so); no Dalton text was read.

## 13. Examples (from our data)

**Scanned 2026-11-09 on intraday bars.** The ORB is an intraday trigger, so the scan ran on the sandbox's 5-minute bars:
the 1,000 most-traded names (>= $10, >= $20M a day), 2026-08-17 to 2026-11-06 (59 sessions; all 1,000 names scanned in
120 s). Scripts: `_study-resume/scratchpad/setups/40-opening-range-breakout/orb_scan2.py` (the scan, every hit in
`final/hits.json`) and `final_orb.py` (the picks, the charts on 30-minute bars, the three sheets). The charts
(`final/01_FFIV_2026-09-15.png` ... `10_PEG_2026-09-14.png`, sheets `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`)
show 30-minute candles with the 9:30-10:00 range boxed, the session VWAP, the OR high (or low), the stop, 3R and 5R.

**The rule the scan used (section 8 + the house rules), in one paragraph.** Daily context through the prior close:
price >= $10 and 50-day average dollar volume >= $20M (B23); a long needs the prior close above the 50-day and the
200-day SMA (B26, 8.1.3), a short below both (8.6.2); RS 80 or more for a long, 20 or less for a short (C31), where RS
is a proxy (IBD-style weighted 3/6/9/12-month price change, ranked 1-99 within the 1,000 scanned names on that day,
not IBD's rating); the long's fill not more than 10% above the 10-day SMA (C29). The opening range is the high, low
and volume of 9:30-10:00 ET (six 5-minute bars). Opening volume at least 1.5x the mean of the prior 10-20 sessions'
9:30-10:00 volume (8.1.7). As the "parent setup" proxy (8.1.1, 8.7.5): the OR high at or above the prior day's high
(long) or the OR low at or below the prior day's low (short). Trigger: the first 5-minute bar after 10:00 that trades a
cent above the OR high before any bar trades under the OR low (8.2.1, 8.5.1), mirrored for the short; market order
(E57): the fill is the OR high + $0.01, or the bar's open if the bar opened above it; no fill more than 4% past the OR
high (C28). Stop: 5 cents under the day's low at the fill (A3), 3% or less of the fill (A13); mirrored above the day's
high for the short. Outcome: the 5-minute bars after the trigger bar for up to 20 sessions, a fixed stop, no
breakeven move, no trims; "best R" is the high-water mark before the stop (or the end of the 20 sessions).

**Base rate (fixed stop, no trims, 20 sessions, 5-minute bars, ETFs removed).**
- Every hit that passed the trend, volume, trigger, chase and stop rules, before the RS and prior-day-extreme filters:
  **1,703 hits; 23.2% reached 3R and 13.0% reached 5R** before the stop; 79.8% traded back to the stop within 20
  sessions. (1,871 with the 168 ETF and leveraged-fund hits left in: 23.3% and 13.4%.)
- The full section-8 rule (RS 80+/20-, OR edge at or beyond the prior day's extreme): **284 hits (99 long, 185 short);
  26.1% reached 3R and 12.7% reached 5R**; 86.3% eventually traded back to the stop within 20 sessions and 20.1% were
  stopped the same day. Longs 24.2% / 13.1% (n 99), shorts 27.0% / 12.4% (n 185). Median risk 1.9% of the fill, median
  range width 1.7%, median opening volume 1.9x normal.
- Splits worth the owner's eye (small samples, one 12-week window): triggers by 10:30 ET, 200 hits, 22.5% / 10.0%;
  triggers after 10:30, 84 hits, 34.5% / 19.0%; so in this window the later trigger did better, the opposite of the
  section 9 grading, which rests on Zarattini's 55% first-10-minute figure. Opening volume 2x or more, 124 hits, 21.0%
  / 7.3%, no better than 1.5x. Earnings-reaction days: only 3 of the 284 strict hits (none of the 10 examples); the
  filters leave almost no earnings gappers because a gap usually puts the stop over 3% or the fill over the 10-day limit.
- Caveats: the 30-minute range needs 5-minute bars, which the sandbox holds only for 2026-08-17 to 2026-11-06, so every
  example and every rate comes from one 12-week window (no different years are possible; the hourly bars since 2023-12
  cannot form a 30-minute range). The count is a fixed stop with no trims, so a trade that reached 5R and then came back
  to the stop counts as "stopped": 4 of the 10 examples below did exactly that within 20 sessions. The trims at 3R and
  5R and the trail (B19, E51, E52) are what keep the result. 168 of the 1,871 hits (9%, against about 32 on an average
  day) fell on 2026-09-18, the September quarterly expiration (third Friday): index-rebalance volume reads as "opening
  volume 1.5x" and is not a catalyst, so the volume rule needs a calendar check (question for the owner). Intraday
  volume sums to about 80-90% of the daily print, which does not matter here because the ratio compares the same window
  day to day. "RS" is the proxy rank above, not IBD's rating. Nobody checked the 10 examples for a named parent setup
  (Kicker, EP, base) by hand; the proxy was RS 80+ (20-) and the OR edge beyond the prior day's extreme.

**The 10 examples** (all from `final/examples.json`; fill = market order at the trigger; "3R after" is in sessions
from the trigger, 78 five-minute bars to a session).

| # | Ticker | Date | Side | Trigger (ET) | 30-min range (high / low, width) | Opening vol | Gap | Prior-day extreme | RS | Fill | Stop (risk) | Best R | 3R after | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | FFIV | 2026-09-15 | long | 10:00 | 418.45 / 412.06, 1.53% | 2.67x | +0.1% | high 415.99 (ORH above) | 81 | 418.46 | 412.01 (1.54%) | 10.05R, 5R yes | 2.0 | Flat open, heavy first half hour, breaks the range on the very first bar after 10:00 and never looks back; +24% over the 200-day, 2% over the 50-day, $234M a day. The cleanest long in the window. |
| 2 | ANF | 2026-10-12 | long | 10:00 | 146.90 / 143.91, 2.03% | 1.68x | +1.0% | high 143.39 (ORH above) | 90 | 146.91 | 143.86 (2.07%) | 8.24R, 5R yes | 3.2 | A 2% range that sits wholly above the prior day's high, broken at 10:00; a staircase of higher session VWAPs to 5R in five sessions. +40% over the 200-day. |
| 3 | EXEL | 2026-10-14 | long | 10:00 | 60.91 / 59.56, 2.22% | 1.99x | +0.7% | high 60.00 (ORH above) | 81 | 60.92 | 59.51 (2.31%) | 9.06R, 5R yes | 6.0 | Opens on 2x volume after a two-day dip to the range low, reclaims and breaks the OR high at 10:00; a slow, orderly climb, every session's VWAP rising. Shows a 3R that takes six sessions. |
| 4 | OVV | 2026-10-09 | long | 10:30 | 64.42 / 63.26, 1.80% | 1.62x | +0.1% | high 63.80 (ORH above) | 86 | 64.43 | 63.21 (1.89%) | 7.53R, 5R yes | 5.2 | A trigger at 10:30 after a tight hold just under the OR high; +15% over the 200-day, only 1% over the 50-day, so no chase. 5R in session 7, then back to the fixed stop in session 18: the trims matter. |
| 5 | QLYS | 2026-10-22 | long | 10:50 | 202.00 / 197.06, 2.45% | 1.58x | +0.2% | high 200.67 (ORH above) | 94 | 202.01 | 197.01 (2.48%) | 6.6R, 5R yes | 1.2 | A late-morning trigger (10:50) on a leader (RS 94, +50% over the 200-day); 3R the next day, 5R in three sessions, then a full round trip to the stop by session 10. |
| 6 | SNX | 2026-09-21 | long | 10:05 | 274.03 / 270.72, 1.21% | 2.42x | +2.3% | high 269.00 (ORH above) | 88 | 274.04 | 270.67 (1.23%) | 7.34R, 5R yes | 1.9 | A 2.3% gap above the prior day's high, a tight 1.2% range, 2.4x opening volume, broken at 10:05; 5R in two sessions. Then the earnings report of 2026-09-24 (before the open, on file) gapped it through the stop: the lesson is the third sold at 3R and 5R and no earnings hold without a plan. |
| 7 | POOL | 2026-09-10 | short | 10:00 | 177.95 / 175.06, 1.62% | 1.76x | -0.2% | low 175.45 (ORL below) | 8 | 175.05 | 178.00 (1.68%) | 7.58R, 5R yes | 3.8 | Opening-range breakdown on the first bar after 10:00 in a stock 17% under its 200-day and 9% under its 50-day; a stair-step lower for two weeks (3R in session 3, 5R in session 15). The mirror of example 1. |
| 8 | CRH | 2026-08-31 | short | 10:15 | 95.29 / 94.17, 1.18% | 1.86x | -1.0% | low 94.81 (ORL below) | 9 | 94.16 | 95.34 (1.25%) | 10.16R, 5R yes | 1.9 | A 1% gap down, a narrow 1.2% range under the prior day's low, broken at 10:15; the best short in the window (3R in two sessions, 5R in seven, 10R within the 20 sessions), 14% under the 200-day. |
| 9 | TJX | 2026-09-08 | short | 10:00 | 132.00 / 130.53, 1.11% | 1.64x | -0.6% | low 131.78 (ORL below) | 10 | 130.52 | 132.05 (1.17%) | 5.06R, 5R yes | 1.5 | A very liquid name ($934M a day) 12% under its 50-day; the OR low sits under the prior day's low and the break at 10:00 runs 3R by the next session, 5R in session 6. Then it recovers to the fixed stop in session 10: the one example where only the trims pay. |
| 10 | PEG | 2026-09-14 | short | 10:00 | 72.72 / 72.04, 0.94% | 2.63x | -0.1% | low 72.14 (ORL below) | 17 | 72.03 | 72.77 (1.03%) | 7.95R, 5R yes | 4.9 | The tightest range of the ten (0.94%) on 2.6x opening volume in a utility 9% under its 200-day; a 1% risk that paid 5R in seven sessions and 8R within the window, and did not trade back up to the OR low for 17 sessions. |

No example is an earnings-reaction day (checked against the earnings file; SNX's report came three sessions after the
trade). No example is an ETF. Dates: 2026-08-31 to 2026-10-22, all within the one window the data allows.

**Notable failures (strict rule, in words).**
- **CMCSA, 2026-09-18, short at 10:00.** Opening volume 5.2x normal, gap -1.1%, RS 17, risk 1.85%: the break of the OR
  low ran 0.24R and reversed back into the range the same morning, stopped the same day. The date is the September
  quarterly expiration: the "opening volume" was rebalance volume, not a seller. The 09-18 cluster (168 hits) is the
  single biggest source of false volume signals in the window.
- **DE, 2026-11-02, long at 10:00.** Opening volume 3.7x, RS 81, risk 2.05%, but the stock had gapped down 0.9% and
  the OR high was only a fraction above the prior day's high; the break reached 0.15R and failed within the hour,
  stopped the same day. A break on a red open with no gap of its own is the "bare ORB" of 8.8.1.
- **LII, 2026-10-27, short at 10:00.** Opening volume 3.4x, gap +0.4% (an up-open in a weak stock, RS 6), risk 2.2%:
  0.26R and stopped the same day. The short worked best in this window when the stock opened down and under the prior
  day's low; an up-open breakdown was the weak cell.
- And the quiet failure the base rate hides: OVV, QLYS, SNX and TJX among the examples, and FORM (12.3R, not charted),
  all reached 5R and then traded back to the original stop within 20 sessions. The count says "stopped"; the rulebook's trims and trail (B19,
  E51, E52, breakeven by 2R-5R) say otherwise. Teach the exit as part of the setup.

## 14. Failures and near-misses (from our data)

**Built 2026-11-10 from the same scan (`final/hits.json`) and a one-gate-relaxed rerun (`near_scan.py`, `final/near_hits.json`); charts by `fail_near_orb.py`, the winners' renderer: 30-minute candles, the 9:30 to 10:00 range boxed, the session VWAP, the OR high or low, the stop, 3R and 5R.** Sheets: `final/fail_1-4.png` (the four failures), `final/near_1-4.png` (the four near-misses), `final/pair_41-30-minute-pivot.png` (an ORB above a 30-minute pivot). All from the one 12-week window the 5-minute bars allow (2026-08-17 to 2026-11-06), so "different years" was not possible; the four failures come from four different weeks. Fill = market order at the trigger; stop = 5 cents past the day's extreme at the fill. Every number is read off the bars.

**Four valid setups that lost (the strict rule passed, stopped before 3R).**

| # | Ticker | Date | Side | Fill | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|
| 1 | CMCSA | 2026-09-18 | short at 10:00 | 22.46 | 22.88 (1.85%) | 10:50 the same day | Opening volume 5.2x normal, gap -1.1%, RS 17, the OR low under the prior day's low. The break ran 0.24R, turned back up through the OR low inside the hour and took the stop; the day closed inside the range at 22.72. The date is the September quarterly expiration: the volume was rebalance volume, not a seller (168 hits fired that day). | orb.opening_volume (the volume rule needs a calendar check) |
| 2 | DE | 2026-11-02 | long at 10:00 | 677.21 | 663.33 (2.05%) | 12:00 the same day | Opening volume 3.7x, RS 81, but the stock had gapped down 0.9% and the OR high sat only a fraction over the prior day's high. The break reached 0.15R, slid back into the range and hit the stop two hours later; closed inside the range at 667.62. A break on a red open with no gap of its own is the bare ORB of 8.8.1. | orb.parent_setup |
| 3 | LII | 2026-10-27 | short at 10:00 | 359.68 | 367.54 (2.19%) | 13:35 the same day | Opening volume 3.4x, RS 6, the OR low under the prior day's low, but an up-open (gap +0.4%). The breakdown ran 0.26R, reclaimed the OR low by 10:30 and the afternoon squeeze took the stop; the day closed above the whole range at 372.77. The up-open breakdown was the weak cell of the window. | orb.short_context |
| 4 | APA | 2026-09-14 | long at 10:00 | 46.37 | 45.51 (1.85%) | 12:45 the same day | A 2.3% gap above the prior day's high on 1.7x opening volume, RS 90, +32% over the 200-day. The break ran 0.26R, fell back through the OR high by 10:30, lost VWAP and took the stop at 12:45; the day closed under the range at 45.05. The classic shape of the card's failure mode: the break prints, the reversal back into the range follows, the day's low is the exit. | orb.reversal_warning |

**Four near-misses (each fails exactly one gate; the chart looks like the setup).**

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | IQV | 2026-09-15 | orb.opening_volume | opening volume 1.03x the 20-day mean for 9:30 to 10:00; the rule is 1.5x or more | A quiet range break at 10:00 (OR high 269.23, RS 89, gap -0.9%) with no opening interest behind it: an ordinary day, not an ORB. It reached 1.29R and was stopped on 2026-09-28. |
| 2 | GKOS | 2026-10-27 | orb.stop_width | 30-minute range 4.55% wide; stop 176.63 is 4.58% under the fill 185.11; the rule is 3% or less | A wide-range morning (2.7x opening volume, RS 92) whose range is too wide for the stop to fit: skip, or size down by the stop. It reached 0.33R and was stopped on 2026-10-28. |
| 3 | MANH | 2026-09-14 | orb.inv_range_low_first | the OR low (206.18) traded at 10:00, before the OR high (207.88) traded at 10:30 | An undercut of the range low and a reclaim, then the break: the plain ORB long is off for the day; a reclaim after an undercut is an Oops, red-to-green or VWAP remount entry with its own rules. It reached 1.71R and was stopped on 2026-09-15. |
| 4 | DHR | 2026-09-24 | orb.leader | RS 64; the rule is 80 or more | A clean 10:00 break (2.1x opening volume, range 2.63% wide, the OR high over the prior day's high) in a name that is not a leader: no parent setup, no trade. It reached 0.58R and was stopped on 2026-09-29. |

**What the failures have in common.** All four were stopped in the same session, within four hours of the fill, and none ran past 0.26R: the break printed, the stock traded straight back into the range and the day's extreme at the fill, the stop, was hit. Three of the four closed inside the range or on the wrong side of it. Heavy opening volume did not save any of them (5.2x, 3.7x, 3.4x, 1.7x): in CMCSA it was expiration volume, in DE and LII the open ran against the trade's direction (a gap down for a long, a gap up for a short), and APA's gap over the prior day's high was sold from the first bar after 10:00. The lesson for the course: the trigger alone is a coin flip (section 4.8); the parent setup, the direction of the open and the calendar are what the four losses were missing, and the stop under the day's low is what kept each loss at 1R.
