# Setup 44: Opening Drive (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote was
copied from the page, post, paper or repo file named next to it and then checked word for word, by script, against a
saved copy of that source. Quotes keep the writer's own spelling (including typos) and are 40 words or fewer. Where I
could not read a source, I say so and give no wording from it. The app's scanner calls this setup "Lance Opening
Drive"; section 2 explains why that name does not hold up.

**Cold check (2026-11-09, second reader).** A second reader re-opened every web source below live (plain curl, not the
writer's saved copies) and tested 127 quoted strings word for word: 118 matched exactly; the other nine were spaces
left by stripped formatting tags, an auto-transcript's spelling ("dr. s"), or an edited reprint, each now noted in
place. The scanner summary (section 5) was re-read against the code, the measurement summaries behind section 4.5 were
re-read, the ten model examples (8.9) were re-derived from the same bar database, and the Zarattini PDF was matched
byte for byte (SHA-256) against the University of St. Gallen's open-access copy. One quote whose page could not be
re-opened and one wrong publisher were removed or fixed; they are listed under "Removed in checking" at the end.

**Who is who in UCT quotes.** The owner is Patrick (TSDR). He writes "TSDR's Weekly Outlook & Watchlist" in the Sunday
Scans, the "TSDR Trading" part of "The Rest of the Week", the "TSDR WATCHLIST" part of the mid-week updates, and
intros he signs "-Patrick". Bracco writes "Bracco's Breakdown & Top Ideas", "Bracco's Market Health Tracker" and "The
Parabolic Short" (the rulebook, B26, names him as its author). Dates are Substack post dates (UTC); SMB dates are the
dates the blog prints (US), whose page metadata runs up to a day later in UTC. The Substack byline
is always "Uncharted Territory", so I tell the authors apart by the signed section a passage sits in. A few owner
quotes come from the brain KB extract already in this repo (`docs/study/levels/brain_kb_cycle_2026-11-06.json`,
`docs/study/levels/brain_kb_rules_2026-11-06.json`); I quote only the parts that the file marks as the trader's own
words, and cite them by KB id.

**Tags used in section 8.** **[source consensus]** several outside sources agree; **[originator]** the named trader or
desk's own words; **[UCT]** the owner or Bracco; **[house rule]** the account rulebook, `docs/study/sizing_rule.md`
section 9; **[my proposal]** my recommendation, for the owner to accept or change.

**Limits of this research.** The session's shared web-search budget ran out after three searches in this run. After
that I could only read pages whose addresses I already had or could take from pages I had read, plus the sites' own
search features (the SMB Capital blog's and Lance Breitstein's blog's own post search, the Stockbee blog's own search
box, and the same for Alphatrends and TraderLion). So: I did not read James Dalton's *Mind Over Markets*, Mike
Bellafiore's books *One Good Trade* and *The PlayBook*, Toby Crabel's 1990 book, Connors and Raschke's *Street Smarts*,
or any of Lance Breitstein's X posts or videos about the open. A 2014 Benzinga interview with Bellafiore returned 403
and a 2013 SlideShare deck of *The PlayBook* returned 410. The academic paper "Market intraday momentum" (Gao, Han, Li
and Zhou, *Journal of Financial Economics* 129(2), 2018) exists (I confirmed the title and journal through Crossref),
but its page returned 403, so I report nothing from it. Where this matters, the section says so.

**Related dossiers.** 40 (Opening Range Breakout) and 41 (30-Minute Pivot) cover the opening-range break itself; this
dossier covers the drive that comes before or with it. 26 (Kicker), 20 (Episodic Pivot), 21 (Power Earnings Gap) and
22 (News Gapper) are the daily setups whose day-1 entry is often an opening drive. 39 (Parabolic Short) covers Bracco's
"U-Turn", which is a failed opening drive on a climax day. 42 (Go Signal) and 43 (Red to Green) are the opposite open:
weak first, then a turn. Where this dossier overlaps a sibling, the owner should rule once for both.

---

## 1. What it is, and why it works

**In two sentences.** An opening drive is a stock that gaps up on news or a breakout and then moves straight up from
the opening bell, on heavy early volume, without trading back to its opening price. You buy the first break of the
early high (or the first small pause that holds), with a stop a few cents under the low of the day, which in a true
drive is set in the first minutes.

**The psychology.**
- **Big buyers cannot finish in five minutes.** SMB Capital's desk explains early heavy volume as institutions leaving
  a "footprint": a fund that wants a large position after news has to keep buying for hours or days. In one of its
  videos the trader says the volume "in the first five minutes right on the open in FedEx or ten times relative to how
  it normally trades" was the signal (SMB, 2019-12-20). The same idea drives the academic "stocks in play" filter in
  section 3.5: the first minutes show the day's supply and demand imbalance, and an unusual imbalance tends to persist.
- **Who is trapped.** Sellers and shorts who expected the gap to fade. Each minute the stock holds above its open,
  they are under water and their buying to cover adds fuel. Bellafiore's shorthand for a gap that will not trade
  lower: "IT IS NOT GOING DOWN" (SMB, 2013-01-13).
- **Who is buying.** The institutions repricing the news, plus traders who watched the stock before the open
  (Bellafiore and Kullamägi both stress the pre-market watchlist and alerts), plus traders who chase the move once it
  shows on scanners. The last group is why a drive can also end badly: Bracco's "U-Turn" is a gap-up drive that "lures
  in chasers" and then reverses on a parabolic climax day (section 6.2), and Lance Breitstein's own best-known short is
  an exhaustion gap with "a euphoric opening drive" (section 3.3).
- **Why it is not a trend yet.** SMB is blunt: "Stocks do not trend in the first 30 minutes. This is a period of price
  discovery" (Bellafiore, 2012-07-25). The Market Profile school reads the same event as information about the rest
  of the day: a market that drives one way from the open is showing "the high confidence level of other timeframe
  traders" (marketcalls, 2015). So the drive tells you who is in control; it does not by itself promise a multi-day
  trend. For a swing trader, it is the day-1 entry signal on a stock whose daily chart already says "buy".

---

## 2. Origin and naming

- **"Opening drive" is a floor and day-trading term, older than any one trader.** The earliest uses I could read are
  SMB Capital blog posts. Steve Spencer, 2009-04-12, titled "The Opening Drive": "A stock gaps up or down on earnings
  and drives strongly in one direction during the first few minutes of the Open." Mike Bellafiore, 2009-11-02, titled
  "Opening Drive (HGSI)": "The Opening Drive is a play that momentum traders crush". SMB calls its version "The Opening
  Drive Play" and teaches it as a named strategy: "It is one of ten specific trades that we teach in The Winning
  Trader" (SMB blog, 2017-10-23). Bellafiore's *The PlayBook* (FT Press, published 2013-07-09, copyright 2014; not
  Wiley, as an earlier draft said) has a chapter 9 titled "Iceman: No Guts,No Glory" in the publisher's table of
  contents (InformIT), and SMB's own page for the book says it "covers support plays, bull-and-bear flags, opening
  drives, important intraday levels" among its setups. I did not read the book.
- **The Market Profile name is "Open-Drive".** James Dalton, Eric Jones and Robert Dalton, *Mind Over Markets*
  (second edition, Traders Press, 1999, per the review below; I did not confirm the first edition's year) classify
  four kinds of open. Brenda Jubin's review lists them as "the open-drive, open-test-drive, open-rejection-reverse, and
  open-auction" (Reading the Markets, 2009-10-16). I did not read the book, so I give no wording of Dalton's own.
- **Lance Breitstein did not name a three-bar "Opening Drive" setup in anything I could read.** He is a former
  Trillium prop trader ("I am a verified 8-figure trader who was Trillium’s Top Trader in 2020 and 2021", his origin
  page, whose metadata dates it 2024-07-18) who has been "serving as an Advisor to Trader Education at SMB Capital"
  since 2022. In the 96 posts on his
  site (blog posts and monthly newsletters, read through the site's own post index), "opening drive" appears twice: as
  one stage of the day's rhythm ("Opening drive", "Midday consolidation", "Afternoon continuation", 2026-02-02), and
  as the last day of his exhaustion-gap short ("A grand finale capitulatory exhaustion gap-up day with a euphoric
  opening drive", 2025-03-31). So the best-supported
  credit is: SMB Capital named and taught the "Opening Drive Play"; the Market Profile school named the "Open-Drive";
  Breitstein, an SMB adviser, uses the term and teaches how to tell a steady drive (do not fade it) from a euphoric one
  (a short candidate). The app's name "Lance Opening Drive" and its claim that Breitstein is an "SMB Capital prop
  trader" are not supported (section 5.5).
- **Other names for the same or nearby things.** "Gap and Go" (SMB, 2019-12-23 and earlier); "Gap, Battle and Go" (a
  gap that holds a contested level, then drives; SMB, 2011-05-09); "Opening Drive continuation" (buy the first
  pullback after the drive; SMB, 2021-04-26); the "Dr. S" pattern (heavy volume and a strong directional drive in the
  first minutes; SMB, 2019; the auto-transcripts spell it "dr. s" and "doctor s", so the capitalised form is mine); "Spencer Special" (a drive, then a tight horizontal consolidation, then continuation;
  SMB, 2012-01-22); "opening range highs" or "ORH" entries (Kullamägi, 2021); "Order Flow Off the Open" (Breitstein,
  2025). UCT's own people say "ORB", "opening range break", "opening range highs" or "ORB highs" (section 6); none of
  them, in anything I read, calls it an "opening drive". The repo's vocabulary file agrees: for
  `lance_opening_drive` it says "no vocabulary entry in v1 (the authors did not name it in the Session 0 samples)".
- **Toby Crabel's opening range breakout (1990)** is the usual ancestor named for opening-range trading. I did not read
  it. Zarattini, Barbon and Aziz describe it this way: "The strategy did not use any intraday data information to define
  the opening range." So Crabel's model is a volatility stretch from the open, not a first-minutes drive.

---

## 3. Every definition I found, source by source

### 3.1 SMB Capital (Mike Bellafiore, Steve Spencer and their traders): the Opening Drive Play (originator of the equity-desk name)

Sources: the SMB Capital blog, smbtraining.com/blog. Its own post search for "opening drive" returned 147 posts
(2009-2026); I saved all 147 and read the ones below in full (the 147 count is the writer's record; the checker
re-opened every cited post live but could not re-run the blog search, whose WordPress search API answers 404). Author names come from the blog's own author records
("Bella" is Bellafiore, "sspencer" is Spencer). Several 2019-2021 posts are auto-transcripts of desk videos; their
wording is spoken and unedited.

- **What it is.** "Let’s define what we mean by an Opening Drive Play. This is a momentum trade right on the open, right
  after 9:30AM." Then: "You enter, with a tight stop, and play the momentum of that stock. When the stock slows on the
  tape you exit." (Bellafiore, 2013-01-13, https://www.smbtraining.com/blog/each-of-these-trades-is-different)
- **The setting: a stock in play on fresh news.** "A stock gaps up or down on earnings and drives strongly in one
  direction during the first few minutes of the Open." And: "This stock should be In Play for the rest of the day."
  (Spencer, 2009-04-12, https://www.smbtraining.com/blog/the-opening-drive). A later desk version adds a size: "a stock
  gaps up ideally at least three percent on a positive news catalyst" (desk video transcript, 2019-12-23,
  https://www.smbtraining.com/blog/using-unusual-trading-volume-to-find-a-profitable-gap-and-go-and-pullback-trade).
- **Timing.** "Generally when there is going to be a good opening drive it happens right away." And "It is unusual for
  there to be a delay of 5-6 minutes." (Bellafiore, 2012-07-25, https://www.smbtraining.com/blog/the-opening-drive-play-ua;
  a lightly edited reprint ran on MoneyShow on 2012-07-27 as "Trade Example: Handling an Unusual Open"; it reads
  "It is unusual for there to be a delay of five to six minutes.").
- **Volume.** "You should see a price surge and elevated volume right after the opening bell rings." (Bellafiore,
  2018-09-04, https://www.smbtraining.com/blog/how-to-buy-a-stock-you-think-will-trade-higher). A desk transcript
  defines the term the same way: "by strong opening drive we mean a nice move in terms of price to the upside and volume
  as well" (2020-01-24, https://www.smbtraining.com/blog/how-to-use-a-key-piece-of-information-institutional-ownership-when-stock-trading).
  In the "Dr. S" review a desk trader reports, from a handful of his own examples, "over a half of an ATR move in
  those first seven eight minutes in each of the examples" (2019-12-23, same URL as above). That is an observation on a
  few trades, not a statistic.
- **The trigger.** A held level on the open. "If I see a stock like INFY not trading below a price right on the open, I
  may enter, set my stop below this area, and try and hold for the opening drive." (Bellafiore, 2013-01-13). The HGSI
  example: "Above 25.25 you get long, strap on your seat belt, and play the upside momentum." (Bellafiore, 2009-11-02,
  https://www.smbtraining.com/blog/opening-drive-hgsi). The "Gap, Battle and Go": "When a stock has gapped up, has room
  to run on our longer term technicals, battles at a level and then seems to hold this level, this is an excellent
  risk/reward trade." (Bellafiore, 2011-05-09, https://www.smbtraining.com/blog/gap-battle-and-go-syy)
- **The stop.** Tight, under the level that held: "You can catch points with as little as ten cents of risk."
  (Bellafiore, 2011-05-28, https://www.smbtraining.com/blog/traders-ask-why-cant-i-trade-the-open-better). And "With an
  Opening Drive Play we do not let the stock trade back down against us." (2012-07-25)
- **The exit.** Two different trades, chosen before entry: "You are either in a Scalp Opening Drive Play with all its
  specific exits or a Trade2Hold Opening Drive Play." (Bellafiore, 2011-11-08,
  https://www.smbtraining.com/blog/traders-ask-did-i-trade-this-correctly). The scalp exits "if it slows, there is a
  rebid"; in the HGSI example he sold two thirds when the tape changed: "I lighted up to 1/3 of a position." Spencer's
  BBBY example kept a long bias all day: "BBBY should finish close to the high of the day."
- **It is not yet a trend.** "On the open we trade the momentum. We do not trust trends in the first 30 minutes. The
best
  play on the open is the Opening Drive." (2011-05-28). And: "you almost never want to start a Trade2Hold on the open
  because stocks do not trend on the open" (2011-11-08). A 2011 reply warns: "Be careful about confusing an opening
  drive for a stock trending" (https://www.smbtraining.com/blog/traders-ask-was-this-one-good-trade-dv).
- **The second entry: the first pullback.** "A bread and butter play on our desk is getting long stocks that have strong
  opening drives once they have had a chance to pull back and consolidate." (Spencer, 2009-11-19,
  https://www.smbtraining.com/blog/pamela-anderson-could-make-this-trade). "After a strong Opening Drive, we want to see
  a pull in on light volume, and a hold above VWAP." (Bellafiore, 2018-09-04). Spencer's favourite setup in 2012:
  "These are stocks that have had an Opening Drive and then have a tight horizontal consolidation before a continuation
  of their trend." (https://www.smbtraining.com/blog/smb-radar-play-acom). Stop for the pullback: "use the
  retracement high/low as a price to place your stop" (Spencer, 2011-03-09,
  https://www.smbtraining.com/blog/traders-ask-how-do-you-use-the-retracement-highlow). A 2011 post by an SMB writer
  named only "Adam" calls one sequence repeatable: "strong opening drive on good volume (even better if there’s a gap
  opening), pullback less than half the day’s range (ideally in two legs)" (2011-01-18,
  https://www.smbtraining.com/blog/aapl-a-case-for-mechanical-trailing-stops).
- **It can be held for days.** In the FedEx short review the desk says the stock "should trend in the direction of the
  opening drive this is a trade to hold for a longer intraday or potentially multi-day move" (2019-12-20,
  https://www.smbtraining.com/blog/trading-signals-you-can-spot-right-on-the-open-to-catch-huge-stock-market-trades).
- **Both directions.** SMB trades the drive down as often as up (CTSH 2011-05-03, "The play is now to short and play for
  the opening drive, a bigger momentum downmove"; JAZZ 2011-03-08; BIDU 2011-07-05).
- **Not for everyone.** "The Opening Drive Play is a trade that yes! trades quickly, too quickly for some." (Bellafiore,
  2016-05-09, https://www.smbtraining.com/blog/the-opening-drive-trade-is-it-for-you). In 2013 he wrote: "It is unusual
  with algorithmic trading programs to be able to trade these setups consistently profitably."
  (https://www.smbtraining.com/blog/let-rodney-be-rodney)
- **Not given:** any prior-trend, base, moving-average or relative-strength test; any fixed gap size before the 2019
  "ideally at least three percent"; any measured win rate.

### 3.2 The Market Profile school (Dalton, Jones and Dalton): the Open-Drive (originator of that name; read second-hand)

Sources: Brenda Jubin's review of *Mind Over Markets* (Reading the Markets blog, 2009-10-16,
https://readingthemarkets.blogspot.com/2009/10/dalton-jones-mind-over-markets.html), which quotes the book with page
numbers; and Rajandran R's tutorial "Market Profile Open Type and Confidence" (marketcalls.in, 2015-08-01,
https://www.marketcalls.in/market-profile/market-profile-open-type-and-confidence.html), an Indian trading educator's
restatement. Neither is Dalton's own wording on the open-drive, so treat both as second-hand.
- **The idea.** Jubin quotes the book (p. 63): "In other words, the market’s open often foreshadows the day’s outcome."
- **Definition (marketcalls).** "When the price opens above/below the value area and outside yesterday’s trading range
  auctions(moves) one-sided right from the beginning towards the opening direction." And: "It shows the high
  confidence level of other timeframe traders(OTF) with strong directional commitment."
- **What it predicts (marketcalls).** "Typically the low made in the first 30 min will not be breached during the
  intraday session." No data is given for "typically".
- **The neighbours.** An open-test-drive first probes the other way and then drives: "This type of market open type
  shows less confidence than Open Drive." An open-rejection-reverse drives and then fails back the other way.
- **Not given:** volume thresholds, entries, stops or targets. Market Profile uses the open type as context for the day
  (do not fight it), not as a stand-alone entry.

### 3.3 Lance Breitstein: what he actually wrote about the drive (the trader the app credits)

Sources: his own site, theonelanceb.com (origin page; 96 posts, blog and newsletter, read through the site's own post
index, dated 2025-03-10 to 2026-11-06; the checker re-opened the twelve posts cited here live and confirmed the two
"opening drive" hits in the saved index, but did not re-crawl the index); Chat With Traders episodes 228, 229 and 236
(show notes only; all three name Breitstein as the guest, 2022). I found no
Breitstein text that defines a three-bar opening drive, a 1% gap rule, a 2x volume rule, a 3x first-bar target or a
success rate.
- **The day has a rhythm.** In "How to Avoid False Breakouts in Trading" (2026-02-02,
  https://theonelanceb.com/blog/how-to-avoid-false-breakouts-in-trading/) he writes "There are rhythms to the trading
  day." and lists a common pattern: "Opening drive", "Midday consolidation", "Afternoon continuation". Then: "Midday
  breakouts often struggle due to lower volume and trader skepticism."
- **A steady drive is not to be faded.** "Steady Strong vs. Capitulatory Price Action" (2025-09-11,
  https://theonelanceb.com/blog/steady-strong-vs-capitulatory-price-action/): on AVGO's May 26, 2023 open, "AVGO gaps up
  and starts climbing right out of the open." His tests: "The slope is consistent, about a 1:1 angle upward"; "Candle
  size actually contracts over time"; "The price hugs the moving average"; "Virtually no time spent outside the upper
  Bollinger Band". Verdict: "There was no logical short setup, and losses from fighting this trend were entirely
  avoidable."
- **A euphoric drive is a reversal warning.** Same post, May 30, 2023: "AVGO opens strong again, but this time the
  behavior is radically different." When the slope steepens and the candles grow: "That’s euphoria". His
  exhaustion-gap short ends with "A grand finale capitulatory exhaustion gap-up day with a euphoric opening drive."
  ("Mastering Easy Money Trades", 2025-03-31, https://theonelanceb.com/blog/mastering-easy-money-trades/)
- **Holding a steady move.** "There’s no price target that will make me sell if we are steadily and sustainably
  increasing." ("The Rate Of Change Is Everything", 2025-11-25)
- **Order flow off the open.** One of his two "easy money" trades is "Order Flow Off the Open", for example "Identifying
  stocks that suddenly move out of sync with the market despite no news catalyst." (2025-03-31)
- **Trend rules he uses intraday.** "Never be long a stock steadily holding below VWAP unless it capitulates" (rule
  developed with Kenny at SMB); trailing: "Prior bars: Holding or breaking prior bar highs/lows is one of the most
  effective trailing stop mechanisms in strong trends." ("Day Trading Basics - How to Define a Trend", 2026-01-29,
  https://theonelanceb.com/blog/day-trading-basics-how-to-define-a-trend/). Stops: "Breaks of prior bar lows in
  uptrends" ("How Do You Choose the Right Stop in Trading?", 2026-01-27).
- **Do not wait for bars to close.** "here’s why I don’t wait for bar closes. Not for entries. Not for exits."
  (2025-09-30, https://theonelanceb.com/blog/do-you-wait-before-you-enter-or-exit-a-trade/). This is the opposite of the app's rule,
  which waits for three bars to close and then for a fourth close above the third.
- **The best trades work at once.** "The best trades immediately go in your favor." ("The Best Trades Don’t Look Back",
  2026-02-16). And from his trade history: "My best trades worked immediately." (2026-01-29)
- **Stock selection first.** In-play stocks; "news alone isn’t enough. The stock also needs to show meaningful volume
  and price movement." ("Why I Trade In-Play Stocks", 2026-08-14)
- **His bar size.** "People often ask me why I use 2-minute bars on my intraday chart" (2025-11-27).
- **What his work adds.** Breitstein's contribution to this setup is the *quality* test (steady versus euphoric) and
  the *context* test (in play, with the trend, not on day 3-5 of a parabolic burst), not a mechanical trigger.

### 3.4 Kristjan Kullamägi: the swing trader's use of the open (originator of his entries)

Source: "3 TIMELESS setups that have made me TENS OF MILLIONS!" (qullamaggie.com, 2021-01-08,
https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/).
- **Breakouts.** "Enter on the opening range highs. The opening range highs can be the highs of the first 1-minute
  candle, the 5-minute candle or the 60-minute candle". He adds that you can skip intraday charts and just enter
  "when the stock is starting to break out."
- **Episodic pivots.** "Big volume. If the volume is not there in premarket, it needs to come in at the open. Many times
  the best ones have traded their average daily volume in the first 15-30 minutes after the open." Entry and stop:
  "ORH can be the highs of the first 1-, 5-, or 60-minute candle. The stop is at the lows of the day."
- **Exits.** Trail with the 10- or 20-day average (EPs) or the 20- or 50-day (breakouts).
- **Note.** He never says "opening drive". His rule is the swing version of it: a stock already set up on the daily
  chart, a gap or breakout day, heavy early volume, buy the break of the opening range high, stop at the day's low.

### 3.5 Zarattini, Barbon and Aziz (2024): the opening range break in the direction of the first candle, on stocks in play (a measurable proxy)

Source: "A Profitable Day Trading Strategy For The U.S. Equity Market", Concretum Research, University of St. Gallen
and Peak Capital Trading / Bear Bull Traders, 2024-02-16, https://ssrn.com/abstract=4729284 (I read a copy of the PDF
saved in this session; it carries that SSRN address on every page; the checker found it byte-identical, by SHA-256, to
the open-access copy in the University of St. Gallen repository,
https://www.alexandria.unisg.ch/entities/publication/ab50f49b-4d5c-4aa8-aaa1-af7a4c131008, and re-checked every
quote and number below in that copy). A working paper, not peer reviewed in what I saw.
- **The direction comes from the first five minutes.** "If the first 5-minute candlestick was bearish (meaning it closed
  below its opening price), our system would only take a short position." The mirror holds for a green first candle.
  That is an opening-drive filter in all but name.
- **Stocks in play.** Opening price over $5, average volume over 1,000,000 shares, 14-day ATR over $0.50, first-5-minute
  relative volume of at least 100%, and only the top 20 stocks by that relative volume each day.
- **Entry, stop, exit.** A stop order at the 5-minute high (long) or low (short); a stop loss 10% of the 14-day ATR from
  the entry; otherwise out at the 4:00 pm close.
- **Why.** "This strategy aims to identify assets that exhibit an abnormal imbalance between demand and supply in the
  first few minutes of the trading session."
- **Not given:** any daily-chart filter (trend, base, 200-day, relative strength). Results in section 4.1.

### 3.6 Geoff Bysshe (MarketGauge): the 30-minute opening range as price discovery

Source: *Trading the 10 O'clock Bulls*, MarketGauge, first edition 2009 (PDF; I read a copy saved in this session by a
sibling research task; the PDF names www.marketgauge.com). A vendor's book.
- He uses the first 30 minutes (and also the first 5) and calls the opening range the day's price discovery period.
  He says he picked the idea up as a floor trader and was convinced of it by Mark Fisher (I did not read Fisher).
- His statistic is in section 4.2.

### 3.7 Not read: Crabel, Connors and Raschke, Fisher, Dalton's book, Bellafiore's books

- Crabel (1990): see section 2 for the one-line description from Zarattini et al.
- Connors and Raschke, *Street Smarts* (1995): Zarattini et al. say it introduced "Momentum Pinball", "combining a
  60-minute ORB with a 3-day Relative Strength Index (RSI) of a 1-day rate of change", tested on futures. I did not
  read it.
- Mark Fisher, *The Logical Trader* (ACD method): not read.
- Dalton's and Bellafiore's books: not read (sections 3.1, 3.2 use their blog and secondary material).
- Brian Shannon: his site's own search (alphatrends.net) returned no post with "opening drive".
- Pradeep Bonde (Stockbee): the blog's own search for "opening drive" returned one 2019 post whose text does not
  contain the phrase. I found nothing from Stockbee on this setup.

### 3.8 Comparison table

| Criterion | SMB Opening Drive Play | Market Profile Open-Drive | Breitstein | Kullamägi (ORH) | Zarattini et al. | App scanner |
|---|---|---|---|---|---|---|
| Prior trend / daily setup | not required; "In Play" stock; later posts like a daily chart setup | not required | in-play stock; with the trend; avoid day 3-5 euphoria | required (breakout from a 2-week to 2-month consolidation, or an EP) | none | none (only a "hostile context" veto) |
| Catalyst | earnings or fresh news | none | news or technical; "news alone isn't enough" | EP: earnings or news; breakout: none | none | none |
| Gap | gap up or down; 2019: "ideally at least three percent" | opens outside yesterday's range or value | not set | EP: 10%+; breakout: none | none | 1% or more |
| What the drive looks like | sharp move right on the open; does not trade back | one-sided auction from the open; first-30-minute low holds | steady slope, shrinking candles, hugs the average | stock "starting to break out" | first 5-minute candle closes above its open | three bars: first closes in top 30% of its range, next two close higher, third closes in top 40% and makes the session high |
| Time window | first minutes ("right away") | first 30 minutes | first 30-60 minutes most active | first 1, 5 or 60 minutes | first 5 minutes (also 15, 30, 60 tested) | first 3 bars of 5, 15 or 30 minutes (15 to 90 minutes) |
| Volume | elevated right at the bell; "Dr. S": unusual volume in first minutes | none | in play; RVOL on the break | EP: ADV traded in 15-30 minutes | first-5-minute RVOL 100%+, top 20 | first-3-bar volume 2x its 20-session average |
| Moving averages | VWAP (hold above for the pullback) | none | VWAP; trend rule | 10/20-day as trail | none | none |
| Trigger | break of a held level on the open | not an entry | not stated as a trigger | break of the opening range high | stop order at the 5-minute high | a close above the third bar's close plus 0.1% |
| Order | at the offer, fast | n/a | does not wait for bar closes | buy the break | stop order | not stated |
| Stop | tight, under the held level; pullback: under the retracement low | n/a | prior-bar lows; where the trend stops | low of the day | 10% of ATR | lower of first-bar low minus 0.2% or the three-bar low |
| Target / exit | scalp: when the tape slows; Trade2Hold: until a reason to sell | n/a | no target while steady; sell into capitulation | trail 10/20-day | the close | entry + 3x the first bar's range |
| Measured stats | none | none | none | none | yes (section 4.1) | none (narrative claims are unsourced) |

### 3.9 Where the sources disagree

1. **Is it a trade or a reading of the day?** SMB trades it. Market Profile mainly reads it as context (do not fade).
   Breitstein uses it both ways: a steady drive is a do-not-fade signal; a euphoric drive on an exhaustion gap is his
   short. Kullamägi uses the open only to time a swing entry.
2. **How long the drive takes.** SMB: "right away", in the first minutes. Market Profile: the first 30 minutes.
   Zarattini et al.: the first 5 minutes worked far better than 15, 30 or 60 (section 4.1). The app: three full bars,
   which on 30-minute bars is 9:30 to 11:00, long after SMB's drive is over.
3. **Gap size.** None (Zarattini; Market Profile asks only for an open "outside yesterday’s trading range"), 1%
   (app), "ideally at least three percent" (SMB 2019), 10% for an EP (Kullamägi).
4. **The stop.** Ten cents under a held level (SMB), the low of the day (Kullamägi), 10% of ATR (Zarattini), the
   first bar's low minus 0.2% (app). On the same chart these can sit far apart.
5. **The exit.** When the tape slows (SMB scalp) versus at the close (Zarattini) versus trail the 10/20-day for weeks
   (Kullamägi) versus a fixed 3x-first-bar target (app, unsourced).
6. **Does a drive mean a trend?** SMB says no ("Stocks do not trend in the first 30 minutes"). Market Profile and
   Breitstein's "steady strong" say a true drive often defines the day. Both can be true: most early moves are noise,
   a few are real drives, and the volume and the hold of the open are how you tell.
7. **Wait for a candle close?** The app waits for closes. Breitstein does not ("Not for entries. Not for exits.").
   Zarattini and Kullamägi use a resting stop order or a buy on the break.

---

## 4. Measured evidence

### 4.1 Zarattini, Barbon and Aziz (2024): the only published test I could read

- **Data and method.** About 7,000 US stocks, 2016-2023, survivorship-bias-free (CRSP), intraday bars from IQFeed.
  Trade only in the direction of the first 5-minute candle, enter on a stop at the 5-minute high or low, stop loss 10%
  of ATR, exit at the close, 1% of capital at risk per trade, leverage capped at 4x, commission $0.0035 a share.
- **All liquid stocks.** Total net return 29% over 8 years, Sharpe 0.48, hit ratio 41.4% (S&P 500: 198%, Sharpe 0.78).
- **Volume is the whole story.** Average result per trade by first-5-minute relative volume: -0.02R below 100%, +0.08R
  above 100%, and 0.38R above 30 times normal (their Figure 4 and text).
- **Stocks in play (relative volume 100%+, top 20 a day).** Total net return 1,637%, annual 41.6%, Sharpe 2.81, hit
  ratio 48.4%, maximum drawdown 12%, alpha 36% a year, beta near zero.
- **Longer opening ranges did much worse** (same filters): 15-minute 272% (Sharpe 1.43), 30-minute 21% (Sharpe 0.21),
  60-minute 39% (Sharpe 0.40). The authors: "The reason for the 5-minute ORB's superior performance is unclear and
  warrants further investigation."
- **Limits.** A backtest by people who sell trading research and education (Concretum; Bear Bull Traders), not peer
  reviewed in what I read; fills at the stop price with no slippage beyond commission; very tight stops (10% of ATR)
  that real fills would often slip through; a day trade closed at 4:00 pm, so it says nothing about multi-day holds;
  long and short results are pooled. It measures a 5-minute opening range break with a first-candle direction filter,
  which is close to, but not the same as, a drive.

### 4.2 Bysshe (MarketGauge): how often the day's high or low is set in the first 30 minutes

- "My research on individual stocks shows that the high for the day occurs in the first 30 minutes about 35% of the
  time!" He says the same holds for the low, against about 8% if prices were random (the first 30 minutes are under 8%
  of the session).
- **Limits.** A vendor's claim; no sample, period or method given. It supports the idea that the opening range matters;
  it does not measure drives.

### 4.3 Claims without data

- marketcalls: "Typically the low made in the first 30 min will not be breached during the intraday session." No data.
- SMB's desk trader: "over a half of an ATR move in those first seven eight minutes in each of the examples". A few
  of his own trades.
- No source I read gives a win rate for an opening drive.

### 4.4 The app's own evidence

- `docs/superpowers/phase-reports/2026-05-18-phase-7-verification.md`: 16 of 16 synthetic fixtures pass, and the
  false-positive sweep on 2,000 synthetic bars found 0 detections. That proves the code does what it says; it says
  nothing about outcomes.
- I found no outcome study of `lance_opening_drive` in the repo.

### 4.5 My own exploratory checks (not published statistics)

Data: the shared read-only Yahoo Finance intraday database built in this session (scratchpad `setups/data/intraday.db`):
the 1,000 most liquid US names (price $10+ and $20 million+ a day since 2026-08-15), regular hours only, unadjusted;
5-minute bars 2026-08-17 to 2026-11-06 (59 sessions) and 60-minute bars 2023-12-12 to 2026-11-06. Daily bars were
built from the 60-minute bars. The **RS proxy** is my own IBD-style 12-month weighted return ranked 1-99 inside this
universe; it is not the app's RS rating. "R" is the distance from entry to stop.

**Check A: the app's detector, unchanged, on 5-, 15- and 30-minute bars** (12 weeks; 7,576 gap-ups of 1%+ that had 20
prior sessions). Buy when price trades over the app's entry, the app's stop and target, then (a) out at the close or
(b) held for days with the stop live.
- **It almost never fires:** 52 times on 5-minute bars (0.7% of gap-ups), 68 on 15-minute, 90 on 30-minute. 14 of the
  52 came on one day (2026-11-04) and 7 on another (2026-09-22), so the cases are not independent.
- **5-minute, same day (50 filled):** target hit 2 times (4%), stop 7 (14%), the rest closed out. Average +0.02R,
  median +0.06R, 52% winners. The best price reached on the day had a median of 0.41R; no trade reached 2R. The app's
  own reward-to-risk to its target had a median of 1.79, not 3.
- **Stop distance:** median 3.5% (5-minute), 5.1% (15-minute), 5.0% (30-minute); only 38%, 26% and 21% fit within 3%.
- **5-minute, held as a swing with the stop live:** by day 5 (31 with data) 55% stopped, average -0.27R; by day 10
  (27) 67% stopped, average +0.07R, median -1R.
- **House filters:** 45% of the 5-minute fires were below the 200-day SMA, only 25% had an RS proxy of 80+, 27% were
  more than 10% above the 10-day average. Only 2 of 52 passed the 200-day, RS 80+, stop within 3% and not-stretched
  tests together.
- **What it missed.** On 2026-09-18 LRCX gapped 1.4%, set its low in the first 5-minute bar and closed at 97% of its
  range (section 8.9). The app did not fire because the first bar closed at 63% of its range, under the 70% rule. The
  same test excluded CRWD and OKTA on 2026-09-14. The first-bar close rule throws out drives that dip in the first
  minutes and then never look back.

**Check B: an hourly drive over two years** (60-minute bars; tests from late 2024 to 2026-11-06 after 200 sessions
of history). Gap up 1%+, price $10+, $20M+ a day. Drive = the first hour (9:30-10:30) closes above its open and in the
top 30% of its range, on at least 2x its 20-day average first-hour volume. Entry at the 10:30 close (a market order),
stop 2 cents under the first hour's low, held with the stop live.
- All gap-up days: 72,838. Hourly drives: 3,588 (904 tickers).
- Stop distance for drives: median 3.4%; 42% within 3%.
- Drives, held: stopped by day 5 in 52%, by day 10 in 62%, by day 20 in 72%. Average R +0.08 at day 5, +0.11 at day
  10, +0.17 at day 20 (medians -1R). Reached 3R before any stop within 20 days in 23%, 5R in 12%.
- **Drives that also pass the house filters** (above the 200-day, RS proxy 80+, entry not more than 10% over the
  10-day): 333. Average R +0.21 at day 10 and +0.39 at day 20; 3R reached in 27% and 5R in 16% within 20 days.
- **The same, with the stop within 3%:** 156. Average R +0.58 at day 20; 3R in 31%, 5R in 20%.
- **Drives below the 200-day:** 1,437. Average R -0.03 at day 20. This supports house rule B26.
- **Caution.** Every group's median at day 10 and day 20 is -1R: most trades are stopped, and the average depends on
  a minority of big winners. The drive filter by itself did not beat simpler gap-up groups on average R in this data
  (their stops were tighter, so the R units are not directly comparable).

**Check C: the rule I propose in section 8, on 5-minute bars** (12 weeks; gap up 1%+, green first 5-minute bar, first
5-minute volume 2x its 20-day average, above the 200-day, RS proxy 80+, not more than 10% over the 10-day; buy the
break of the first 5-minute high; stop 2 cents under the day's low at entry).
- 54 cases (46 tickers, 26 days). Stop distance median 2.4%; 72% within 3%.
- Same day: average -0.06R. Held with the stop live: by day 10 (34 with data) 76% stopped, average +0.27R, median -1R.
  Within 10 days, 41% reached 2R, 24% reached 3R and 6% reached 5R before any stop.
- With the stop within 3% (39 cases; 26 with 10 days of data): average +0.56R at day 10; 31% reached 3R.

**Limits of all three checks, and they are large.** The universe was picked in 2026 by current liquidity, so it leans
to survivors and winners. Prices are unadjusted, so a split distorts that stock's averages. 5-minute data covers only
12 weeks in one market regime. Hourly and daily bars cannot show the order of prices inside a bar; when a stop and a
high fell in the same bar I counted the stop. No costs or slippage. The RS proxy is not the app's rating. No check
looked at catalysts, bases or groups, which every practitioner says is where the edge lives. Treat these numbers as
reasons to ask questions, not as rules.

### 4.6 What I looked for and did not find

The app's narrative states, as Breitstein's or SMB's findings, that a qualifying drive "resolves in continuation
65-70% of the time", that drives under 2x volume are "roughly 50/50", that a full retrace "happens roughly 8-12% of the
time", and that the 3x first-bar target is hit "roughly 2/3 of the time". I found none of these numbers, or anything
like them, in Breitstein's 96 site posts, SMB's 147 opening-drive posts, SMB's posts on Breitstein, the Chat With
Traders
notes, or any other source I read. My checks above disagree with them (target hit 4% of the time on 5-minute bars).

---

## 5. Our app

### 5.1 What the scanner tests (`api/services/pattern_engine/detectors/uct/lance_opening_drive.py`)

The detector takes a series of intraday bars, splits it into sessions wherever two bars are more than 4 hours apart,
and looks only at the first three bars of the last session. It fires when all of these hold:
1. At least 20 earlier sessions with 3+ bars, and at least 60 earlier bars.
2. **Gap:** the first bar opens at least 1% above the last bar's close of the previous session.
3. **Bar 1:** closes in the top 30% of its own range (the code calls this DCR, "daily close in range", even on 5-minute
   bars).
4. **Bars 2 and 3:** each closes higher than the bar before.
5. **Bar 3:** closes in the top 40% of its range, and its high is the session high.
6. **Volume:** bars 1-3 together trade at least 2x the average of the same three bars over the last 20 sessions.
7. **Not hostile:** it refuses only when the context says Stage 4 and stacked bearish averages and falling RS, all at
   once. There is no 200-day, RS, liquidity, price or earnings gate.
8. **Confidence** = 0.40 geometry + 0.25 volume + 0.20 context + 0.15 x a fixed 50. A floor of 50 removes only the
   weakest combinations (for example Stage 4 with a distribution signature). Bigger gaps (3%+ scores best), higher
   first and third bar closes, 4x+ volume, Stage 2, stacked bullish averages, rising RS and a CAN SLIM "A" raise it.
   The bonus for a prior day that closed in its upper third reads `prev_session_high` and `prev_session_low` from the
   context, which nothing in the pattern engine supplies, so live it is always the neutral 0.5.

### 5.2 Levels and narrative

- **Entry:** the third bar's close plus 0.1%, with the condition `close > entry`; the narrative's watch-for text says
  "Entry trigger is a daily close above" that price, which is wrong for an intraday setup.
- **Stop:** the lower of (bar 1's low minus 0.2%) and the three-bar low. When bar 2 or 3 makes the lower low, the stop
  sits exactly on that low with no buffer.
- **Target:** entry plus 3 times bar 1's range, called "Lance's 3x measured move".
- **Narrative:** long texts that credit Breitstein with specific rules and numbers (section 5.5).

### 5.3 How it runs live (`api/main.py`)

- Inside `_run_patterns_leaders_scan`, an APScheduler job on a one-hour interval, during regular hours only, behind
  `PATTERNS_INTRADAY_SCAN_ENABLED`. So a drive whose third 5-minute bar closes at 9:45 can be seen up to an hour
  later, by which time price may be well past the entry it prints.
- It scans only the leader universe in `api/data/leader_universe.json`: 84 tickers, which the file calls a "Default
  seed list" to be replaced by a generated list.
- It feeds the detector up to 5,000 five-minute bars per ticker from the local bar store (so the 15- and 30-minute
  versions in the docstring do not run live) and stores the detection with `tf = "5"`.
- `detectors/registry.py` lists it in `DISPLAY_INTRADAY_ONLY`, so the chart overlay never draws it on daily, weekly or monthly
  charts. (On daily bars it cannot fire anyway: every daily bar is more than 4 hours from the next, so each is its own
  one-bar "session".)
- Worth an engineering check, not verified by me: if the 5-minute store ever holds pre-market bars, the 4-hour session
  split would make the first three pre-market bars "bars 1-3".

### 5.4 Model Book card and journal tags

- **Model Book** (`app/src/pages/modelbook/setupCatalog.js`): no "Opening Drive" card. The Intraday family has "ORB
  (Opening Range Break)", "30-Minute Pivot" and "Go Signal". The ORB card's essence begins "The first candles define the
  opening range" and ends "breaking it with momentum puts the day’s trend behind the trade." It is a direction "both"
  card with no rules beyond that line.
- **Journal tags** (`app/src/constants/setupGroups.js`): no "Opening Drive" tag. The intraday tags are "Opening Range
  Breakout", "Opening Range Breakdown", "Red to Green (Intraday)", "Green to Red", "30min Pivot" and "Mean Reversion
  L/S".
- **Trade plans** (`docs/study/TRADE_PLANS.md`): no plan for this setup.

### 5.5 Where the app disagrees with the sources or looks wrong

1. **False attribution.** The docstring calls Breitstein an "SMB Capital prop trader". His own site says he traded at
   Trillium from 2011 to 2022 and since 2022 has served "as an Advisor to Trader Education at SMB Capital". Chat With
   Traders calls him a "Senior Trader at proprietary trading firm Trillium".
2. **An unsourced quote put in Breitstein's mouth.** The docstring quotes him: "the opening drive is the single
   highest-edge intraday pattern"; `api/routers/patterns.py` calls it "Lance's specific claim: 'the single highest-edge
   intraday pattern in liquid US equities.'" I found no such sentence in anything he or SMB published that I read.
   The sibling `opening_range_breakout.py` has a similar unsourced quote
   ("the opening drive into 10:30 follow-through is the highest-edge intraday setup"). The repo already removed a
   "wholly fabricated" Breitstein attribution from the episodic-pivot detector
   (`tests/pattern_engine/detectors/test_group1_narrative_truthfulness.py`); this detector was not part of that sweep.
3. **Unsourced statistics** (section 4.6): 65-70% continuation, 50/50 under 2x volume, 8-12% full retrace, "roughly
   2/3" target hits. Also unsourced: "Breitstein filters gaps below 1%", "take half off at +1× first-bar range", a
   "5-min lower-low rule until 14:00 ET", a limit of two Opening Drive trades per session, "NEVER fade an
   Opening Drive in the first hour", and the prior-day-close filter as "Breitstein's specific" rule. The last one
   contradicts him: his best-known short fades a euphoric opening drive.
4. **Unsupported lineage.** "Stockbee community archives" (Stockbee's blog has nothing on it) and "extends Toby
Crabel's"
   opening range (Crabel's model did not use the intraday opening range, per Zarattini et al.).
5. **Waits too long.** Three closed bars plus a fourth close, found by an hourly job: on 5-minute bars the entry
   comes at 9:45 or later; on 30-minute bars at 11:00 or later, when SMB says the drive is over and Zarattini et al.
   found the 30-minute version
   nearly flat. Breitstein does not wait for closes, and the house enters with market orders (E57).
6. **The first-bar 70% close rule** misses drives that dip in the first minutes and then never look back (LRCX, CRWD,
   OKTA in section 4.5).
7. **No daily-chart gates.** No 200-day (B26), RS (C31), price and liquidity (B23), stretch (C29) or earnings (B22)
   test. In my check 45% of fires were below the 200-day.
8. **The 3x first-bar target** is unsourced, has a median reward-to-risk of 1.8, and was hit 4% of the time in my
   check. The house trims at 3R and 5R instead (B19, E51).
9. **The stop** has no buffer when bar 2 or 3 sets the low (house F62 says a few cents under), and is often wider than
   3% (A13).
10. **Wording errors.** "daily close above" for an intraday trigger; DCR glossed as daily close in range on 5-minute
bars.

---

## 6. UCT's own words

I searched all 103 posts on the UCT Substack (from its sitemap) for opening drive, drive, opening range, ORB, ORH,
first 5, 15 or 30 minutes, at the open, off the open, and relative volume. No post uses "opening drive". What
UCT does say about trading the open:

### 6.1 The owner (TSDR)

- **The day-1 entry on a gap is the opening range break, with a stop at the low of the day.** "This has strong
  potential if we open higher, break the opening range. Can enter there and place a stop at LOD and see how far it
  goes." (TSDR WATCHLIST, 2025-06-20, https://unchartedterritoryy.substack.com/p/market-update-and-watchlist)
- **Volume in the first minutes decides size.** Same post: "If it trades it’s average daily volume (2 million shares) in
  the first 5 minutes then press the gas". On an earnings gap: "1. Relative volume in the first 15 min" is the first
  "Key things to look for" (TSDR Trading, 2026-02-25, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24).
- **The slower alternative.** "If unable or unwilling to try ORB at open. Look for a retest or an undercut and hold of
  VWAP mid morning." (2026-02-25). And "I will be looking for an Opening Range Break" or a VWAP undercut and rally
  (TSDR Trading, 2025-11-05, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9).
- **Kickers and news gaps.** "If it holds this and breaks it opening range tomorrow this is actionable with a stop at
  LOD." (TSDR Trading, 2025-10-29, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757). "if this breaks
  out of this base I will be slapping that gap up and ORB." (TSDR's Weekly Outlook, 2025-11-02,
  https://unchartedterritoryy.substack.com/p/sunday-scans-b99)
- **Trades named this way.** "The opening range break on Friday and taking out $120 sent this significantly higher."
  (CRCL, 2025-06-15, https://unchartedterritoryy.substack.com/p/sunday-scans-744). "SOXL from Friday’s opening range."
  (2025-11-16, https://unchartedterritoryy.substack.com/p/sunday-scans-d6a)
- **The market decides whether to play it.** In his 2026-03-08 intro (signed "-Patrick") he lists, as a regret to
  avoid in a weak market, "I wish I pushed the lever and took that 5-minute opening range break on the QQQ" and ends
  "Or will you simply wish you waited for your WHEN." (https://unchartedterritoryy.substack.com/p/sunday-scans-dcf)
- **The first 30 minutes also set his gap-down stop.** "I always use the first 30 min to let play out and establish
  the range." (2025-06-22, https://unchartedterritoryy.substack.com/p/sunday-scans-0d2). This is rulebook B20.
- **From the brain KB (his words as the file records them).** On day-1 earnings gaps in spring 2026: "Lately i have
  noticed that Day 1 earnings gappers have been failing ORB coming into lows and then remounting and going." (KB 12555,
  2026-05-01). A plan for every path: "Buys ORB, comes below lows, stop out, then retake HOD and get back in. Was my
  plan." (KB 12544, 2026-04-29). A kicker idea: "If it gaps up over $40 and breaks opening range then previous days high
  at $41.75 this could be a big mover of 20%+ tomorrow." (KB 10111, 2025-06-09). Patience on the open: "Opening range
  highs COULD trigger this today, ideally just inside and wait for tomorrow" (KB 10088, 2025-05-12).
- **His ruling in this repo.** For the Kicker he set two entries, one of them the drive day itself: "or on DAY 1 of the
  kciker candle on a 30 min ORB" (`owner_verdicts.jsonl`, 2026-11-02); earlier the same day: "on a kicker you can buy
  the opening range break (ORB), or the break of previous day high."

### 6.2 Bracco

- **Buying the drive.** "Got aggressive through the opening range highs and added through $19." (USAR, 2025-10-05,
  https://unchartedterritoryy.substack.com/p/sunday-scans-6ef). "Bought this on the ORB highs on Friday as a pure
  momentum play." (2026-05-03, https://unchartedterritoryy.substack.com/p/sunday-scans-bcc). "Bought this through the
  opening range highs on Friday." (2025-06-08, https://unchartedterritoryy.substack.com/p/sunday-scans). "Got long this
  name on Thursday at $28 off the open." (YSS, 2026-04-12, https://unchartedterritoryy.substack.com/p/sunday-scans-a43)
- **The index version.** "the market got bought at the open and didn’t look back the entire day." Then: "It was the type
  of action that leads to immediate follow through momentum." (2026-08-09,
  https://unchartedterritoryy.substack.com/p/sunday-scans-1ad)
- **The failed drive is his favourite short ("U-Turn", The Parabolic Short, 2025-06-13,
  https://unchartedterritoryy.substack.com/p/the-parabolic-short).** "It begins with a gap-up and an opening range
  breakout, driving an upward trend at the open". Then: "typically 10 to 60 minutes after the market opens, sellers
  emerge, and the stock starts to reverse." Entries: "The first entry is triggered by a breakdown below VWAP, followed
  by a second short opportunity when the stock breaches the day’s lows". This is a climax-day short, after a 3-5 day
  parabolic burst.
- **Opening volume as a gauge.** "I closely monitor the volume on the opening 5- or 15-minute candles." On a parabolic
  run, "the climax day almost invariably showing the highest opening volume of the entire run". (same post)
- **From Breitstein, by name.** The "Right Side of the V" is "a concept I picked up from Lance Breitstein", and the
  prior-bar trail is "another technique I adopted from Lance Breitstein" (same post).
- **The short-side trigger.** "I wait for signs of weakness such as a breakdown through VWAP, opening range lows,
  and/or lows of the day." (2025-12-28, https://unchartedterritoryy.substack.com/p/sunday-scans-249)

### 6.3 What UCT does not say

Nobody at UCT, in anything I read, gives a gap minimum, a three-bar test, a 2x three-bar volume rule or a 3x
first-bar target. Those exist only in the scanner.

---

## 7. How it fits the account rulebook (section 9)

**Fits well:**
- **E57 market orders** and Breitstein's no-waiting: buy the break of the opening range high at market.
- **A3 / F62 stop a few cents under the day's low:** in a true drive the day's low is set in the first minutes, so the
  natural stop is the house stop. Kullamägi uses the same stop.
- **B23 liquidity, D42 1% of volume:** drives need stocks in play; every source trades liquid names.
- **B18 / F65 market filter:** the owner's own "WHEN" post (2026-03-08) says not to force opening-range trades in a
  bad market.
- **B20 gap through the stop:** applies if a drive entry is held overnight and gaps down (in check B, SNX's hourly
  drive of 2026-09-21 opened below its stop on 2026-09-24).
- **B21 re-entry only on a new trigger, E56 at most 3 tries a week:** relevant when a drive fails and then re-triggers
  (TSEM, section 8.9; the owner's KB 12544 plan).

**Tensions to settle:**
- **C35 "We swing trade".** SMB's Opening Drive Play is a day trade, often a scalp. In a swing account the drive is a
  day-1 entry for a daily setup, held under the house trim and trail rules. The course should say so plainly.
- **A13 stop within about 3%.** The stop under the day's low was within 3% in 72% of cases with a 5-minute trigger
  (check C), but in only 42% with a first-hour trigger (check B) and 38% for the app's three-bar version (check A).
  Bigger gaps mean wider first ranges. Options: size down by A5 (the honest stop sets the shares), use the 5-minute
  trigger, or skip.
- **B26 the 200-day.** The app has no gate; 45% of its fires were below the 200-day. Gap-up drives below the 200-day
  did worse in check B. B26 should apply, with its parabolic exception (which here means a long after a burst down,
  section 8.6).
- **C31 RS 80+.** The app has no RS gate. Only 25% of its fires had an RS proxy of 80+.
- **C29 not more than 10% above the 10-day.** A gap on top of a run can be stretched before it opens; 27% of the app's
  fires were. Skip those.
- **C28 no chase over 4% above the buy point.** If the first 5 minutes run more than 4% past the ORH before you act, the
  buy point has passed; wait for the first pullback entry instead.
- **B22 earnings.** A drive on the earnings gap day is after the report, so B22 does not block it. A drive in the 3 days
  before a report is blocked.
- **B19 / E51 / E52 trims and trail.** SMB scalps when the tape slows; the house sells a third at 3R and 5R and trails
  the rest. In check B, 27% of house-filtered drives reached 3R and 16% reached 5R within 20 days; in check C, 24% and
  6% within 10 days. The house rules can stay; most drives will be stopped before the first trim.
- **C30 no time-of-day rule.** No conflict: C30 forbids banning times, and this setup simply happens at the open.

---

## 8. Proposed rules for our course

These treat the opening drive as **the day-1 entry signal for a stock that already has a daily setup**, which is how
the owner and Bracco use the open (section 6) and how Kullamägi uses ORH entries. A stand-alone day-trade version is in
question 2 of section 10.

### 8.1 What it is (measurable)

- **Daily setup first.** The stock is on the focus list with a named daily setup: a base breakout, Kicker, EP, Power
  Earnings Gap, news gap or a 20-day reclaim. [UCT: every owner ORB entry I read sits on a named daily setup (Kicker,
  earnings gap, base breakout); source consensus: Kullamägi, and the SMB trader Rodney, whose opening-drive plays
  "have a daily chart setup as well" and who wants his midday trades "preferably with a daily chart set" (Bellafiore,
  "Let Rodney Be Rodney", 2013-11-19)]
- **Prior trend and location.** Price above a rising 200-day SMA (B26) [house rule]; RS 80+ in a strong group (C31)
  [house rule]; not more than 10% above the 10-day average at the buy (C29) [house rule]. Not on day 3-5 of a
  parabolic burst (Bracco's five boxes, B26) [UCT; originator: Breitstein's euphoric drive].
- **Liquidity.** Price $10+, $20 million+ a day (B23) [house rule].
- **The gap.** Opens at least 1% above the prior close [the app's floor]. A+ when it opens above the prior day's high
  [Market Profile: "outside yesterday's trading range"] and on fresh news or earnings [SMB].
- **The drive (the first 5 minutes).** The first 5-minute bar closes above its open, and price does not trade back to
  the open before the entry. Do not require the first bar to close in its top 30%: a drive may dip in the first minute
  (LRCX, CRWD, OKTA). [my proposal, from SMB's "we do not let the stock trade back down against us",
  marketcalls and check A]
- **Volume.** First 5-minute volume at least 2x its 20-day average for that bar [my proposal; Zarattini et al. found
  the edge only above 1x and rising with volume; the app uses 2x for three bars]. A+ when the stock trades its average
  daily volume within the first 15-30 minutes [originator: Kullamägi on EPs; UCT: TSDR's "average daily volume (2
  million shares) in the first 5 minutes then press the gas"].
- **Length and depth.** It is over in minutes. The day's low is the open or within the first 5-minute bar. [source
  consensus: SMB "right away"; Market Profile; my proposal on the exact window]

### 8.2 The buy

- **Trigger:** price trades above the first 5-minute bar's high (the 5-minute ORH). [originator: Kullamägi ORH; source:
  Zarattini et al. stop order at the 5-minute high; UCT: "break the opening range"]
- **Order:** market order the moment it trades through (E57) [house rule]; no waiting for the bar to close [originator:
  Breitstein].
- **No chase:** not more than 4% above the ORH (C28) [house rule]. If missed, use the second entry.
- **Second entry (the first pullback):** after the drive, the first pullback on lighter volume that holds above VWAP
  and above the opening range high or the open; buy the break back over the pullback's high. [originator: SMB, "pull in
  on light volume, and a hold above VWAP"; UCT: TSDR's "undercut and hold of VWAP mid morning"]
- **Slow version:** the 30-minute ORB (the owner's Kicker rule). [UCT]
- **Options to settle (section 10, Q3):** 1-minute (fastest, most noise), 2-minute (Breitstein's bar), 5-minute
  (Zarattini, Bracco, SMB), 30-minute (the owner's Kicker rule). Recommendation: 5-minute ORH, with the 30-minute ORB as
  the slow version, because Zarattini et al. measured the 5-minute version as by far the best and the owner already
  uses the 30-minute ORB.

### 8.3 The stop

- A few cents under the low of the day at the moment of entry, which in a true drive is the low of the first 5-minute
  bar or the open (A3, F62) [house rule; originator: Kullamägi "The stop is at the lows of the day"].
- If that is more than about 3% below the buy (A13), size down so the risk stays the same (A5); if the honest stop does
  not fit the risk, skip (A3) [house rule].
- For the pullback entry: a few cents under the pullback's low [originator: SMB "retracement high/low"].
- After entry the stop only rises (A4); a gap through it next day follows B20 [house rule].

### 8.4 Trims and trail

- House defaults: breakeven at 2R to 5R; a third at 3R; a third at 5R; trail the rest under the 10-day (fast movers) or
  21-day, sold on a close below (B19, E51, E52) [house rule]. If the stock opens above a trim level, trim at the open
  (F63) [house rule].
- **Day-1 close check** [my proposal]: if the drive day closes below its open or in the bottom third of its range, the
  drive has failed (EAT, DAVE, ONON in 8.9); sell the rest at the close or next morning rather than wait for the stop.
  Sources: Spencer expected his BBBY drive to "finish close to the high of the day"; Bracco's U-Turn is exactly this
  failure. This adds an exit the rulebook does not have, so it needs the owner (Q6).
- Time stop: under 1R after 10 days, sell (C33) [house rule].

### 8.5 What invalidates it

- Trades back below the open or the first 5-minute low before the entry: no trade; it is an open-test or a rejection.
  [source consensus: SMB, Market Profile]
- After entry, the low of the day breaks: out (the stop) [house rule].
- Loses VWAP and holds under it [originator: Breitstein's VWAP rule; UCT: Bracco's U-Turn trigger].
- First 5-minute volume under its average: not a drive [source: Zarattini et al. -0.02R below 100%].
- Below the 200-day, RS under 80, more than 10% over the 10-day, or earnings within 3 days: not ours [house rules].
- A Red market, or Orange unless A+ (F65) [house rule].

### 8.6 The short mirror

- **Opening drive down:** gap down 1%+ on bad news, first 5-minute bar red, no trade back to the open, first 5-minute
  volume 2x+, below the 200-day, RS 20 or lower, weakest groups (B26, C31, D47); short the break of the first 5-minute
  low; stop a few cents above the high of the day. [originator: SMB trades the drive down (CTSH, JAZZ, BIDU); house
  rules D47, D48 borrow]
- **The failed up-drive (U-Turn)** is a different setup: a parabolic climax-day short, allowed above the 200-day only
  because it is parabolic (B26). It belongs to dossier 39. [UCT: Bracco]
- **The parabolic long exception:** a gap up that drives on the day after a burst down (B26's parabolic long) can be
  taken below the 200-day; that is dossier 38's entry. [house rule]

### 8.7 Best market conditions

- A Green market reading [house B18]; the Nasdaq trending above its rising 10- and 20-day averages, the first of the
  four "WHEN" tests in the owner's 2026-03-08 intro: "The simple one made notorious by Quallamaggie is a market that
  the Nasdaq is trending higher above a rising 10 and 20 period moving average." (his spelling; the other three are
  the watchlist, the groups and the past 20 trades) [UCT].
- Earnings season and big news days, when many stocks are in play [originator: SMB "during earnings season"].
- Strong groups gapping together (CRWD, OKTA and FTNT, all software, on 2026-09-14) [my proposal, from the check B
  data and section 8.9].
- A broad gap-up with strong breadth at the open helps: Bracco, 2026-09-20: "At the open we saw the highest Nasdaq
  advance decline print since the gap up (ceasefire day) on April 8th earlier this year."
  (https://unchartedterritoryy.substack.com/p/sunday-scans-bc2) [UCT].

### 8.8 Common mistakes

1. Buying a gap with no daily setup because it "looks strong" for five minutes [source consensus].
2. Waiting for three closed bars, then chasing [originator: Breitstein; app's own rule shows it].
3. Chasing more than 4% past the ORH (C28) [house rule].
4. Mistaking a drive for a trend and adding size in the first 30 minutes ("Stocks do not trend in the first 30
   minutes") [originator: SMB].
5. Buying a euphoric drive on day 3-5 of a parabolic run: that is the short setup [originator: Breitstein; UCT: Bracco].
6. Fading a steady drive [originator: Breitstein, "losses from fighting this trend were entirely avoidable"].
7. Low first-minute volume [source: Zarattini et al.].
8. Switching plans mid-trade, from a hold to a scalp or back [originator: SMB 2011-11-08].
9. Trading it below the 200-day [house rule; check B].
10. Ignoring the day-1 close: a drive that closes at the low has failed [UCT: Bracco's U-Turn; my proposal].

### 8.9 Ten model examples to study (for the owner to approve)

Facts from the Yahoo bars in section 4.5 (prices unadjusted; "range" = the day's high-low). I did not check the news
behind any gap; that, and the daily chart, need the owner's eye before any of these is used. The checker re-derived
every figure below from the same database and all hold (for CRWD the stop under the first bar's low sits 3.2% under a
5-minute ORH entry and 6.8% under the first-hour close; OKTA's gap was 3.8% and opened inside the prior day's range).

**Models**
1. **LRCX 2026-09-18.** Gap +1.4% (open 273.24). Low of the day 272.80 in the first 5-minute bar; up to 279.66 by
   9:45; closed 287.80, 97% of the range. Next 10 sessions: best close +20.7% over the drive-day close; the drive low
   held. Passed check C (RS proxy 83, 5-minute volume 5.7x, stop 1.6%). The app's detector missed it (first-bar rule).
2. **ARKG 2026-08-19.** Gap +4.5% over the prior day's high; low of the day was the open (45.17); closed at 47.68, 99%
   of the range. Next 10 sessions: best close +5.1%; the low held. An ETF drive.
3. **CRWD 2026-09-14.** Gap +6.0% over the prior high; low of the day 216.17 in the first 5-minute bar; closed 235.44,
   83% of the range. Next 10 sessions: best close +11.5%; the low held. Teaches the A13 problem: the stop under the
   first bar's low was about 3% from a 5-minute ORH entry and 6.8% from the first-hour close.
4. **OKTA 2026-09-14.** Same day, same group (software). Low of the day in the first bar; closed at 83% of the range;
   next 10 sessions best close +10.8%.
5. **SITM 2026-09-17.** Gap +5.7% over the prior high; small first bar, then a drive to 607.97 in the 9:50 bar; low
   of the day 572.87 in the first bar; closed 598.75 (74% of range). Next 10 sessions: best close +13.5%; the low
   held. The app's
   detector fired on it.
6. **TER 2026-07-30.** Gap +9.0% (open inside a wide prior day); first hour green and strong on 2.2x first-hour volume;
   closed at 87% of the range; next 10 sessions best close +12.2%; the low held. (Hourly bars only.)

**Counter-examples**
7. **EAT 2026-09-22.** Gap +3.0% over the prior high; drove to 213.47 by 9:45 (high of the day in the 9:50 bar), then
   faded to close 206.89, 24% of the range; the drive-day low broke the next day. The app fired. A drive that failed:
   the day-1
   close check (8.4) gets you out.
8. **ONON 2026-09-22.** Gap +10.2% on very heavy early volume, but 30% below its 200-day with an RS proxy of 2. High of
   the day in the 9:40 bar; closed at the low. The app fired. B26 would have kept us out.
9. **TSEM 2026-09-17.** Drove from 215.02 to 221.27 by 9:50, then fell through its open to 212.01 in the 10:10 bar,
   hitting the app's stop (213.85). It then recovered to close 219.11 and made a best close 10% higher within 10
   sessions.
   Teaches B21: a stop-out is not a re-entry; only a new trigger is.
10. **DAVE 2026-09-15.** Gap +2.9% over the prior high; a drive to the high of the day in the 10:15 bar, then a close at
    23% of the range; the low broke the next day.

---

## 9. Grading: A+ versus B-

The owner ruled that grading is discretionary (E50), so this is evidence for his judgment, not a checklist.

**A+ (size up, D38, E49):**
- A clean daily setup (base breakout, Kicker, EP) in a leader with RS 90+ in a leading group [house C31; Kullamägi].
- Fresh news or earnings, and the stock opens above the prior day's high [SMB; Market Profile].
- First 5-minute volume 4x+ its average, or the average daily volume traded in the first 15-30 minutes [Zarattini et
  al. 0.38R above 30x; Kullamägi; UCT TSDR].
- The open is the low of the day and is never revisited; a steady slope with candles that shrink, not grow [SMB;
  Breitstein's steady strong].
- Holds above VWAP all morning [SMB; Breitstein].
- Stop within 3% (A13) and not stretched over the 10-day (C29) [house rules].
- Green market, broad gap with strong breadth, group moving together [UCT; house F65].

**A or B (normal size):** a daily setup, a gap of 1-4%, volume 2-4x, one small dip near the open that holds, stop near
3%.

**B- or lower (size down or skip):**
- No daily setup, no news [SMB; Kullamägi].
- Gap of 1-2% inside the prior day's range on average volume [Zarattini et al.; Market Profile].
- The first minutes chop back to the open [SMB: no trading back down against you].
- Day 3-5 of a parabolic burst; growing candles outside the upper Bollinger Band [Breitstein; Bracco].
- Stretched more than 10% over the 10-day, or a stop that must be wider than 5% [house C29, A13].
- Yellow or Orange market [house F65].

---

## 10. Questions for the owner

1. **The name.** (a) "Opening Drive", crediting SMB Capital and Market Profile; (b) fold it into the ORB lesson as the
   ORB on a drive day; (c) keep "Lance Opening Drive". Recommendation: (a) or (b). Nothing I could read from Breitstein
   publishes this setup under his name, and the app's quotes from him could not be found.
2. **Stand-alone day trade or day-1 entry for a daily setup?** (a) entry tactic only (fits C35); (b) also a day trade
   with SMB's scalp exits; (c) both, taught separately. Recommendation: (a).
3. **Trigger bar.** (a) 1-minute; (b) 2-minute (Breitstein); (c) 5-minute ORH; (d) 30-minute ORB (your Kicker rule).
   Recommendation: (c), with (d) as the slow version.
4. **Gap minimum.** (a) 1% (app); (b) 3% (SMB "ideally"); (c) open above the prior day's high; (d) none. Recommendation:
   (a) as the floor, (c) as an A+ mark.
5. **Volume rule.** (a) first 5 minutes 2x average; (b) first-3-bar 2x (app); (c) average daily volume in 15-30 minutes
   (Kullamägi); (d) your rule, the average daily volume in the first 5 minutes. Recommendation: (a) as the floor, (c)
   or (d) as A+.
6. **The day-1 close check.** If the drive day closes below its open or in its bottom third, sell before the stop? (a)
   yes; (b) no, the stop is the only exit (A4). Recommendation: (a) for the course, because the failed drive (U-Turn)
   is a known pattern; but it is a new exit rule.
7. **Stops wider than 3%.** (a) size down by A5; (b) skip; (c) use the pullback entry instead. Recommendation: (a), with
   (c) when the first range is wide.
8. **The scanner.** (a) delete the unsourced quotes, numbers and the SMB claim now; (b) rename it; (c) add 200-day, RS,
   price and liquidity gates; (d) drop the first-bar 70% close rule in favour of a no-trade-back-to-the-open test; (e)
   enter on the break of the first 5-minute high, not on a fourth close; (f) replace the 3x target with the house trims.
   Recommendation: (a) at once (same as the earlier episodic-pivot clean-up), the rest with your rule choices.
9. **The short mirror.** (a) teach the opening drive down below the 200-day; (b) leave shorts to the parabolic short
   (U-Turn) only. Recommendation: (a), since D47 says shorts are our longs reversed.
10. **A Model Book card and a journal tag.** Add "Opening Drive" to both, or keep "Opening Range Breakout" as the only
    tag? Recommendation: a card, but one shared journal tag with ORB, so the journal stats are not split.

---

## 11. Sources

All read on 2026-11-09 unless stated. Reliability: A = originator's own words; B = established educator or research
paper; C = secondary or vendor; R = repo file.

| # | Source | Publisher / author | Date | Reliability and notes |
|---|---|---|---|---|
| 1 | https://www.smbtraining.com/blog/the-opening-drive | SMB Capital; Steve Spencer | 2009-04-12 | A. Earliest "Opening Drive" post I found |
| 2 | https://www.smbtraining.com/blog/opening-drive-hgsi | SMB; Mike Bellafiore | 2009-11-02 | A |
| 3 | https://www.smbtraining.com/blog/pamela-anderson-could-make-this-trade | SMB; Spencer | 2009-11-19 | A |
| 4 | https://www.smbtraining.com/blog/foreshadowing-on-the-tape | SMB; Bellafiore | 2009-12-09 | A |
| 5 | https://www.smbtraining.com/blog/aapl-a-case-for-mechanical-trailing-stops | SMB; author "Adam" | 2011-01-18 | A (desk writer; surname not shown) |
| 6 | https://www.smbtraining.com/blog/traders-ask-how-do-you-use-the-retracement-highlow | SMB; Spencer | 2011-03-09 | A |
| 7 | https://www.smbtraining.com/blog/opening-drive-play-ctsh | SMB; Bellafiore | 2011-05-03 | A (short side) |
| 8 | https://www.smbtraining.com/blog/gap-battle-and-go-syy | SMB; Bellafiore | 2011-05-09 | A |
| 9 | https://www.smbtraining.com/blog/traders-ask-why-cant-i-trade-the-open-better | SMB; Bellafiore | 2011-05-28 | A |
| 10 | https://www.smbtraining.com/blog/traders-ask-was-this-one-good-trade-dv | SMB; Bellafiore | 2011-06-03 | A |
| 11 | https://www.smbtraining.com/blog/traders-ask-do-you-wait-for-a-stock-to-open | SMB; Bellafiore | 2011-08-10 | A |
| 12 | https://www.smbtraining.com/blog/traders-ask-did-i-trade-this-correctly | SMB; Bellafiore | 2011-11-08 | A |
| 13 | https://www.smbtraining.com/blog/smb-radar-play-acom | SMB; Spencer | 2012-01-22 | A |
| 14 | https://www.smbtraining.com/blog/the-opening-drive-play-ua | SMB; Bellafiore | 2012-07-25 | A; same text on MoneyShow, https://www.moneyshow.com/articles/daytraders-28691/ (2012-07-27) |
| 15 | https://www.smbtraining.com/blog/each-of-these-trades-is-different | SMB; Bellafiore | 2013-01-13 | A. The clearest definition |
| 16 | https://www.smbtraining.com/blog/let-rodney-be-rodney | SMB; Bellafiore and a trader | 2013-11-19 | A |
| 17 | https://www.smbtraining.com/blog/the-opening-drive-trade-is-it-for-you | SMB; Bellafiore | 2016-05-09 | A |
| 18 | https://www.smbtraining.com/blog/should-you-trade-the-first-30-minutes | SMB; Andrew Falde | 2017-10-23 | A |
| 19 | https://www.smbtraining.com/blog/how-to-buy-a-stock-you-think-will-trade-higher | SMB; Bellafiore | 2018-09-04 | A |
| 20 | https://www.smbtraining.com/blog/trading-signals-you-can-spot-right-on-the-open-to-catch-huge-stock-market-trades | SMB desk video transcript | 2019-12-20 | A/C: auto-transcript |
| 21 | https://www.smbtraining.com/blog/using-unusual-trading-volume-to-find-a-profitable-gap-and-go-and-pullback-trade | SMB desk video transcript | 2019-12-23 | A/C: auto-transcript |
| 22 | https://www.smbtraining.com/blog/how-to-use-a-key-piece-of-information-institutional-ownership-when-stock-trading | SMB desk video transcript | 2020-01-24 | A/C: auto-transcript |
| 23 | https://www.smbtraining.com/blog/prop-trader-details-a-stock-trade-you-can-make-right-on-the-open | SMB trader video transcript | 2021-04-26 | A/C: auto-transcript |
| 24 | SMB blog post search for "opening drive" (147 posts) and for "Breitstein" (4 posts), smbtraining.com/blog | SMB | 2009-2026 | Used to find and save the posts above (writer's record; not re-run by the checker) |
| 25 | https://www.smbtraining.com/blog/wall-streets-top-trader-invites-me-to-his-penthouse-show-notes | SMB | 2022-12-06 | C: show notes of an interview with Breitstein; nothing on the open |
| 26 | https://theonelanceb.com/story/ | Lance Breitstein | page metadata 2024-07-18, read 2026-11-09 | A: career facts |
| 27 | https://theonelanceb.com/blog/mastering-easy-money-trades/ | Breitstein | 2025-03-31 | A |
| 28 | https://theonelanceb.com/blog/steady-strong-vs-capitulatory-price-action/ | Breitstein | 2025-09-11 | A. The best Breitstein text on drives |
| 29 | https://theonelanceb.com/blog/do-you-wait-before-you-enter-or-exit-a-trade/ | Breitstein | 2025-09-30 | A |
| 30 | https://theonelanceb.com/blog/the-rate-of-change-is-everything-when-trading-stocks/ | Breitstein | 2025-11-25 | A |
| 31 | https://theonelanceb.com/blog/what-minute-bars-should-i-use-in-trading/ | Breitstein | 2025-11-27 | A |
| 32 | https://theonelanceb.com/blog/how-do-you-choose-the-right-stop-in-trading/ | Breitstein | 2026-01-27 | A |
| 33 | https://theonelanceb.com/blog/day-trading-basics-how-to-define-a-trend/ | Breitstein | 2026-01-29 | A |
| 34 | https://theonelanceb.com/blog/how-to-avoid-false-breakouts-in-trading/ | Breitstein | 2026-02-02 | A |
| 35 | https://theonelanceb.com/blog/the-best-trades-dont-look-back/ | Breitstein | 2026-02-16 | A |
| 36 | https://theonelanceb.com/blog/why-i-trade-in-play-stocks/ | Breitstein | 2026-08-14 | A |
| 37 | All 96 posts (blog and monthly newsletter) listed by theonelanceb.com's own post index (2025-03-10 to 2026-11-06) | Breitstein | various | A: searched for "drive", "open", "opening range" |
| 38 | https://chatwithtraders.com/228 , /229 , /236 | Chat With Traders; guest Breitstein | 2022 | C: show notes only; episodes not heard |
| 39 | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Kristjan Kullamägi | 2021-01-08 | A |
| 40 | https://ssrn.com/abstract=4729284 , "A Profitable Day Trading Strategy For The U.S. Equity Market" | Carlo Zarattini, Andrea Barbon, Andrew Aziz | 2024-02-16 | B: working paper by authors who sell research and education; copy of the PDF saved in this session |
| 41 | *Trading the 10 O'clock Bulls*, MarketGauge (PDF) | Geoff Bysshe | 2009 | C: vendor book; copy saved in this session by a sibling task, not downloaded by me |
| 42 | https://www.marketcalls.in/market-profile/market-profile-open-type-and-confidence.html | marketcalls; Rajandran R | 2015-08-01 | C: educator's restatement of Dalton's open types |
| 43 | https://readingthemarkets.blogspot.com/2009/10/dalton-jones-mind-over-markets.html | Reading the Markets; Brenda Jubin | 2009-10-16 | C: book review quoting *Mind Over Markets* |
| 44 | https://traderlion.com/trading-books/the-playbook-summary/ | TraderLion | 2025-07-23 | C: summary of *The PlayBook*; the checker could not re-open it (403 live, no archived copy), so its quote was removed (section 13) and rows 59-60 replace it |
| 45 | https://stockbee.blogspot.com/search?q=%22opening+drive%22 | Stockbee; Pradeep Bonde | read 2026-11-09 | Nothing on this setup |
| 46 | alphatrends.net post search for "opening drive" | Brian Shannon | read 2026-11-09 | No results |
| 47 | Crossref record for doi 10.1016/j.jfineco.2018.05.009 | Gao, Han, Li, Zhou, "Market intraday momentum", JFE 129(2) | 2018 | Title only; the paper (403) was not read |
| 48 | https://unchartedterritoryy.substack.com/p/the-parabolic-short | UCT; Bracco | 2025-06-13 | UCT |
| 49 | https://unchartedterritoryy.substack.com/p/market-update-and-watchlist | UCT; TSDR WATCHLIST | 2025-06-20 | UCT |
| 50 | https://unchartedterritoryy.substack.com/p/sunday-scans , -744 , -0d2 , -ae1 , -6ef , -b99 , -d6a , -249 , -dcf , -a43 , -bcc , -1ad , -bc2 | UCT Sunday Scans; owner and Bracco sections as marked | 2025-06-08 to 2026-09-20 | UCT. All 103 posts in the sitemap were searched (the checker counted 103 /p/ entries in the live sitemap and confirmed each quote sits in the signed section it is credited to) |
| 51 | https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757 , -9c9 , -b24 | UCT; TSDR Trading | 2025-10-29 to 2026-02-25 | UCT |
| 52 | `docs/study/levels/brain_kb_cycle_2026-11-06.json` (KB 12544, 12555), `brain_kb_rules_2026-11-06.json` (KB 10088, 10111) | repo | extracted 2026-11-06 | R: the owner's words as the file records them |
| 53 | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | repo; the owner | 2026-11-02 to 2026-11-09 | R |
| 54 | `docs/study/sizing_rule.md` section 9; `docs/study/TRADE_PLANS.md` | repo | 2026-11-09 | R: house rules |
| 55 | `api/services/pattern_engine/detectors/uct/lance_opening_drive.py`; `opening_range_breakout.py`; `registry.py`; `api/routers/patterns.py`; `api/main.py`; `api/data/leader_universe.json` | repo | current branch | R: the scanner |
| 56 | `app/src/pages/modelbook/setupCatalog.js`; `app/src/constants/setupGroups.js`; `docs/wisdom/vocabulary/setup-vocabulary-v1.json` | repo | current branch | R |
| 57 | `tests/pattern_engine/detectors/test_group1_narrative_truthfulness.py`; `docs/superpowers/phase-reports/2026-05-18-phase-7-verification.md` | repo | 2026-09-03; 2026-05-18 | R |
| 58 | Yahoo Finance intraday bars (5-minute and 60-minute) in the shared scratchpad database | Yahoo, via yfinance | downloaded 2026-11-09 | Data for section 4.5 and 8.9; unadjusted, regular hours |
| 59 | https://www.informit.com/store/playbook-an-inside-look-at-how-to-think-like-a-professional-9780132937641 | Pearson (InformIT), publisher's listing of *The PlayBook* | published 2013-07-09, read 2026-11-09 by the checker | B: publisher FT Press, ISBN 978-0-13-293764-1, table of contents (chapter 9 "Iceman: No Guts,No Glory") |
| 60 | https://www.smbtraining.com/blog/the-playbook | SMB Capital | read 2026-11-09 by the checker | A: SMB's own page for the book ("opening drives" among the setups it covers) |
| 61 | https://www.alexandria.unisg.ch/entities/publication/ab50f49b-4d5c-4aa8-aaa1-af7a4c131008 | University of St. Gallen repository; open-access PDF of source 40 | record dated 2024-11-26, read 2026-11-09 by the checker | B: byte-identical (SHA-256) to the saved PDF |

Not read (tried or known, see the opening limits): Dalton, Jones and Dalton, *Mind Over Markets*; Bellafiore, *One
Good Trade* (2010) and *The PlayBook* (2013); Crabel (1990); Connors and Raschke, *Street Smarts* (1995); Fisher, *The
Logical Trader*; the Benzinga interview with Bellafiore (2014, 403); the SlideShare *PlayBook* deck (2013, 410);
Breitstein's X posts, videos and paid course; the Gao et al. paper; the "Market Wizards" book a 2026-06-28 Sunday Scans
giveaway describes as "Featuring chapters from Quallamaggie, Lance Breitstein, and TheShortBear"
(https://unchartedterritoryy.substack.com/p/sunday-scans-ae1).

---

## 12. Examples (from our data)

Run 2026-11-09 (night) on the sandbox's 5-minute bars: the 1,000 most-traded names (price $10+, $20 million+ a day),
regular hours, 2026-08-17 to 2026-11-06 (59 sessions). An opening drive lives in the first five minutes, so daily bars
cannot show it and the hourly bars (2023-12 on) blur it into the first hour; this is the only window we have at the
right resolution. Scripts: scratchpad `setups/44-opening-drive/scan44.py` (the scan, writes `final/hits.json`) and
`final44.py` (the picking and the charts). Charts: `final/01_LRCX_2026-09-18.png` to `final/10_RPRX_2026-10-20.png`
and the three phone sheets `final/sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`. The RS figure is the same proxy
as section 4.5 (IBD-style weighted 12-month return, ranked 1-99 inside the 1,000 names on that day), not the app's RS
rating.

**The rule the scan used (section 8 + the house rules).** Daily context through the prior day: close $10+, 50-day
average dollar volume $20 million+ (B23); prior close above the 200-day SMA for a long, below it for the short mirror
(B26). The 9:30 bar opens at least 1% above the prior close (8.1); the first 5-minute bar closes above its open. First
5-minute volume is measured against the mean first-bar volume of the prior 10-20 sessions. Trigger: the first later bar
that trades a cent above the first bar's high (the 5-minute ORH, 8.2), provided no bar has traded under the open
before it (8.5). Market order (E57): the fill is the ORH plus a cent, or the trigger bar's open if it gapped over; no
fill more than 4% above the ORH (C28) or more than 10% above the 10-day SMA (C29). Stop: 5 cents under the day's low at
the fill (8.3). Outcome: the 5-minute bars after the trigger bar for up to 20 sessions; stopped when a bar's low touches
the stop, best R from the highs. Fixed stop, no trims, no breakeven move, no day-1 close exit. The scan recorded every
such trade from 1x first-bar volume and up to a 5% stop, then counted the dossier's **strict** rule on top: first-bar
volume 2x+, RS 80+, trigger by 10:00 ET, stop within 3% (A13). The short mirror (gap down 1%+, red first bar, break of
the first bar's low before any trade over the open, below the 200-day, RS 20 or less) was recorded the same way.

**Base rate.** 1,000 of 1,000 names scanned in 106 seconds (complete). Across the 59 sessions the strict long rule
fired **41 times** on 21 different days (ETFs included: UCO, ARKG twice and CIBR are ETFs): **17.1% reached 3R and 9.8% reached 5R** before the
stop; 87.8% were stopped within 20 sessions and 41.5% were stopped on the drive day itself. The strict short mirror
fired 57 times: 15.8% reached 3R, 3.5% reached 5R, 91.2% stopped. These are fixed-stop figures with no trims, no
breakeven move and no day-1 close exit, so they understate what the house plan (a third at 3R, a third at 5R, B19)
would have kept and overstate what the day-1 close check (8.4) would have lost. One autumn of data is one market
regime; the numbers are a floor to argue from, not a statistic.

How the thresholds moved the rate (longs, trigger by 10:00, stop within 3%, 20-session fixed stop):

| first-bar volume | any RS | RS 70+ | RS 80+ |
|---|---|---|---|
| 1x+ | n 572, 3R 20.8%, 5R 13.1% | n 320, 22.8%, 16.2% | n 210, 25.2%, 18.1% |
| 1.5x+ | n 277, 17.7%, 9.7% | n 151, 19.9%, 12.6% | n 91, 23.1%, 14.3% |
| 2x+ (the proposal) | n 136, 18.4%, 8.8% | n 68, 16.2%, 10.3% | n 41, 17.1%, 9.8% |
| 3x+ | n 52, 21.2%, 13.5% | n 23, 21.7%, 13.0% | n 18, 27.8%, 16.7% |

Three readings for the owner. (1) RS 80+ helped at every volume level (C31 earns its place). (2) The 2x first-bar
volume floor, which section 8.1 marks as my proposal, did not raise the hit rate in this window: 1x-2x drives on RS
80+ names did as well as 2x+ drives. The floor should be settled by the owner, not by this data. (3) The A+ mark for
"opens above the prior day's high" (8.1) ran the wrong way here: among the 151 longs at 1.5x volume and RS 70+, the
108 that opened above the prior high reached 3R 13.9% of the time, the 43 that opened inside the prior day's range
34.9%. A gap over the prior high is also, in the same bars, further from the 10-day average; this is one autumn and
small cells, but it argues against grading the gap size up without the daily setup behind it. Two more figures are
true but circular, so they are not evidence: drives whose day-1 close sat in the top third of the day's range reached
3R 36% of the time against 2% for the bottom third (the stop sits just under the first bar's low, so a close in the
bottom third usually means the stop was already hit), and the same holds for "the low of the day stayed in the first
bar" (41% against 2%). What they do say is that the day-1 close check in 8.4 costs almost nothing: by the time a drive
closes in the bottom third it has nearly always failed.

**The ten examples.** Only 7 of the 41 strict trades reached 3R, and three of those did not deserve a learner's eye
(RGEN 10-02 faded the same day; RPRX 10-15 stalled at the first bar's high all day and closed near its low; VTRS 10-15
took eleven sessions to reach 3R; ARKG is an ETF). So 3 of the 10 below are strict (LRCX, SANM, CNC) and 7 pass every
rule except one of the "my proposal" lines: first-bar volume 1.5-2x instead of 2x+ (SITM, STX, NET, CROX, MXL, RPRX),
RS 77 instead of 80+ (CROX), or a stop a shade over 3% (CRWD 3.2%, MXL 3.2%; the dossier's own 8.9 already flags
CRWD). Every example is a US stock above a rising 200-day SMA, inside the 10-day limit (MXL at +9.8% is the closest),
triggered at 9:35 ET (the second 5-minute bar), with the day's low set in the first 5-minute bar. None is an earnings
reaction day in our tables (Yahoo + SEC 8-K); the news behind each gap was NOT checked and needs the owner's eye. All
ten come from one autumn because that is the only window with 5-minute bars; one per ticker, but not different years.

| # | Ticker, date | The drive (first 5-min bar) | Buy (ORH + 1c) | Stop | 3R / 5R | Best R, when | Why it is textbook |
|---|---|---|---|---|---|---|---|
| 1 | LRCX 2026-09-18 | gap +1.5% (not over the prior high); bar 272.80-277.23, closed 63% of its range on 5.7x volume; RS 82, +1% vs 200-day | 277.24 at 9:35 | 272.75 (1.6%) | 290.71 / 299.69 | 16.8R; 3R at the next session's open (09-21 9:30), 5R at 11:40 that day | The dossier's own model 1, confirmed: low of day in bar 1, closed at 97% of the range, gapped again next day. The first bar dipped first (63% close), which the app's 70% rule would have thrown out. |
| 2 | SITM 2026-09-17 | gap +5.7% over the prior high; bar 572.87-581.56, closed 88%, 1.7x volume; RS 85, +7% vs 200-day | 581.57 at 9:35 | 572.82 (1.5%) | 607.82 / 625.32 | 17.1R; 3R at 9:50 the same day, 5R at the open two sessions later (09-21) | Model 5 of 8.9: the fastest drive in the set, 3R inside 20 minutes, then two sessions holding above its VWAP before the next leg. Volume 1.7x, under the 2x floor. |
| 3 | CRWD 2026-09-14 | gap +5.9% over the prior high; bar 216.17-223.34 (3.3% wide), closed 63%, 3.2x volume; RS 91, +43% vs 200-day | 223.35 at 9:35 | 216.12 (3.2%) | 245.04 / 259.50 | 8.8R; 3R on 09-16 at 11:25, 5R on 09-23; never stopped in 20 sessions | Model 3 of 8.9: a wide first bar makes the honest stop 3.2% (A13 means size down, A5). The drive ran to 236 by 11:00 and 239 by 2 pm; the day closed at 83% of its range. |
| 4 | SANM 2026-09-11 | gap +1.2%; bar 205.71-207.99, closed 42% (a dip then recovery), 2.3x volume; RS 81, +10% vs 200-day | 208.00 at 9:35 | 205.66 (1.1%) | 215.02 / 219.70 | 4.75R; 3R at 10:35 the same day; 5R never | Strict. A tight first bar gives a 1.1% stop and 3R by 10:35. Then the lesson: a gap down through the stop on 09-14 (B20: the first 30-minute low is the new stop, out past 2R); the trims at 3R already banked a third. |
| 5 | CNC 2026-11-04 | gap +4.7% over the prior high; bar 70.21-71.99, closed 54%, 5.3x volume; RS 90, +22% vs 200-day | 72.00 at 9:35 | 70.16 (2.6%) | 77.52 / 81.20 | 3.3R; 3R at 9:35 the next day; stopped 11-06 at 10:40 | Strict. The heaviest first-bar volume in the set; the drive ran all day (closed 85% of range), topped at 3R next morning, then round-tripped to the stop two days later: trim a third at 3R or keep nothing. |
| 6 | STX 2026-09-18 | gap +1.4%; bar 807.31-827.97, closed 96%, 1.9x volume; RS 97, +30% vs 200-day | 827.98 at 9:35 | 807.26 (2.5%) | 890.14 / 931.58 | 5.7R; 3R at the next session's open (09-21), 5R on 09-22 at 9:50 | A first bar that closed at its high on a leader (RS 97); a steady all-day drive closing at 79% of the range, with the group (LRCX the same day). Volume 1.9x. |
| 7 | NET 2026-09-14 | gap +2.1%; bar 309.00-316.14, closed 92%, 1.6x volume; RS 87, +36% vs 200-day | 316.15 at 9:35 | 308.95 (2.3%) | 337.75 / 352.15 | 7.5R; 3R at the open four sessions later (09-18), 5R on 09-21; never stopped | Same day and group as CRWD (software, 2026-09-14, section 8.7): the drive ran to 327 by 11:00 and 334.6 by 2:40 pm, and the stock trended for four sessions without a retest of the open. Volume 1.6x. |
| 8 | CROX 2026-09-17 | gap +2.2% over the prior high; bar 117.95-119.29, closed 90%, 1.9x volume; RS 77, +10% vs 200-day | 119.34 at 9:35 | 117.90 (1.2%) | 123.66 / 126.54 | 5.8R; 3R at 10:40 the same day, 5R at the open three sessions later (09-22); stopped 09-30 | The cleanest intraday shape: a one-bar drive, 3R inside 65 minutes, a close at 66% of the range, a fade the next day, 5R on the third session. RS 77 (under C31's 80); a learner should see why the rule is 80. |
| 9 | MXL 2026-10-02 | gap +2.5%; bar 93.93-96.96 (3.2% wide), closed 90%, 1.7x volume; RS 98, +73% vs 200-day | 96.97 at 9:35 | 93.88 (3.2%) | 106.24 / 112.42 | 5.2R; 3R at 3:55 the same day, 5R on 10-07 at 10:40 | The biggest day-1 move in the set: from 97 to 103 by 11:00 and 106 at the close (95% of the range) on a stock 73% above its 200-day and 9.8% over its 10-day (C29's edge). The stop is 3.2% because the first bar was wide. |
| 10 | RPRX 2026-10-20 | gap +1.1%; bar 60.81-61.40, closed 85%, 1.6x volume; RS 86, +16% vs 200-day | 61.41 at 9:35 | 60.76 (1.1%) | 63.36 / 64.66 | 13.0R; 3R on 10-22 at 10:15, 5R on 10-26; never stopped | A quiet, low-beta drive: a 1% first bar, a tight 1.1% stop, and a steady grind all day (closed 89% of range) into a gap-up on the third session. Shows that R, not percent, measures the trade. |

**Notable failures (all strict-rule trades, so the rule did not keep us out).**

- **EAT 2026-09-22** (the dossier's counter-example 7, confirmed): gap +3.2% over the prior high on 2.5x volume, RS 84,
  bought 211.21 at 9:40 with the stop at 204.95 (3.0%). Best 0.37R; stopped the same day; the day closed at 24% of its
  range. The 8.4 day-1 close check would not have helped (the stop came first); only the pattern of "high of the day
  in the first 20 minutes, then a lower high" would.
- **PAYC 2026-10-01**: gap +3.7% on 5.0x first-bar volume (the second-heaviest in the strict set), RS 90, bought 229.02
  at 9:35. The fill was the high of the day: the stock never ticked higher, slid for an hour and hit the stop (224.09)
  at 10:35, then recovered to close at 78% of its range. B21 says a stop-out is not a re-entry without a new trigger;
  the honest reading is that a drive whose first push fails in minute six is usually not a drive.
- **RVTY 2026-10-06**: gap +2.7%, 2.9x volume, RS 91, 48% above its 200-day. Bought 165.00 at 9:35, best 0.21R, stopped
  the same day, closed at 13% of the range. One of four strict fires on 2026-10-06 (with NVT, ARKG, CIBR), all stopped:
  the drives were real for five minutes and the market was not (8.7, the market reading comes first).
- **TSEM 2026-09-17** (counter-example 9, confirmed): a 6.3% gap on 2.5x volume, bought 216.48, reached 2.1R by 9:50,
  then fell through its open and the stop (214.23) within the hour before recovering; the stop under the first bar's
  low was 1.0% away. A tight stop is not a free stop.
- **GMAB 2026-10-05** (rejected as an example): the first bar closed at 94% of its range on 2.8x volume, but the
  trigger came only at 9:50 and the stock then sat flat near 36 for four hours; the 42.9R on its record comes from a
  surge to 40.17 at 3:05 pm and a gap the next morning (news not checked), not from the open. A best-R number without
  the chart is not a textbook example.

---

## 13. Removed in checking

The cold check (2026-11-09, second reader) changed the following. Everything else in the dossier was confirmed against
its source as described in the opening note.

1. **Removed:** the TraderLion quote that chapter 9 of *The PlayBook* features "Iceman's Opening Drive trade" (section
   2). TraderLion's page answers 403 to a plain fetch and has no archived copy, so the quote could not be confirmed.
   Replaced by the publisher's own table of contents (chapter 9 "Iceman: No Guts,No Glory", source 59) and SMB's own
   page saying the book covers "opening drives" (source 60). Whether the Iceman chapter reviews an opening drive is
   therefore not claimed here.
2. **Fixed:** *The PlayBook*'s publisher. The draft said Wiley; the publisher is FT Press (Pearson), published
   2013-07-09, copyright 2014 (source 59). Bellafiore's earlier *One Good Trade* (2010) is the Wiley title.
3. **Fixed:** "footprints" (section 1) to the transcript's singular "footprint".
4. **Fixed:** the MoneyShow reprint of the 2012-07-25 UA answer is lightly edited ("five to six minutes"), not the
   same text (section 3.1).
5. **Fixed:** the 8.7 Kullamägi credit now quotes the owner's sentence exactly, with his spelling "Quallamaggie", and
   the 8.7 Bracco breadth note now carries its quote and URL (sunday-scans-bc2, 2026-09-20).
6. **Fixed:** the 8.1 "preferably with a daily chart set" line is now attributed to the trader Rodney in Bellafiore's
   2013-11-19 post, with its URL in the sources; the "algorithmic trading programs" sentence in that post is
   Bellafiore's, as the dossier had it.
7. **Noted, not changed:** the "Dr. S" name is the auto-transcript's "dr. s" / "doctor s", capitalised here; the
   Breitstein stop and trailing quotes in section 3.3 carry a stray space before a colon or full stop on the live page
   where a bold tag ends ("Prior bars : Holding...", "...bar closes . Not for entries."), which is formatting, not
   wording; the 147-post and 4-post SMB search counts and the 96-post Breitstein index are the writer's records and
   were not re-run (the cited posts themselves were all re-opened live).
8. **Checked and kept:** every PROPOSED RULE line in section 8 is measurable (a bar, a percentage, a moving average, a
   count of days, a market reading) and every [source consensus] tag rests on at least two named sources; the [my
   proposal] tags mark the lines that are the writer's own (the 5-minute window, the 2x first-bar volume floor, the
   day-1 close check, the group test).

## 14. Failures and near-misses (from our data)

**Built 2026-11-10 from the same scan (`final/hits.json`) and a one-gate-relaxed rerun (`near_scan44.py`, `final/near_hits.json`); charts by `fail_near44.py`, the winners' renderer: 5-minute candles, the first bar boxed, the session VWAP, the first 5-minute high, the stop, 3R and 5R.** Sheets: `final/fail_1-4.png` (the four failures), `final/near_1-4.png` (the four near-misses), `final/pair_40-opening-range-breakout.png` (a drive above an ORB). All from the one 12-week window the 5-minute bars allow (2026-08-17 to 2026-11-06), so "different years" was not possible; the four failures come from four different weeks. The strict rule gave 41 long hits in the window, 30 of them stopped before 3R; the four below are the ones section 12 already describes in words, now charted. Fill = market order over the first bar's high; stop = 5 cents under the day's low at the fill. Every number is read off the bars.

**Four valid setups that lost (the strict rule passed, stopped before 3R).**

| # | Ticker | Date | Fill | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | TSEM | 2026-09-17 | 216.48 at 9:35 | 214.23 (1.04%) | 10:05 the same day | A 6.3% gap over the prior day's high on 2.47x first-bar volume, RS 92; the first bar closed at 75% of its range. Reached 2.13R by 9:50, then fell through its open (215.02) and the stop within the half hour; the day still closed at 77% of its range and the stock was 10% higher within 10 sessions. A tight stop is not a free stop, and a stop-out is not a re-entry without a new trigger (B21). | od.stop |
| 2 | EAT | 2026-09-22 | 211.21 at 9:40 | 204.95 (2.96%) | 14:20 the same day | A 3.2% gap over the prior high on 2.52x volume, RS 84; the first bar closed at 87% of its range. The high of the day printed at 9:45 (0.37R), a lower high followed, the first close under VWAP came at 9:55 and the slide reached the stop at 14:20; the day closed at 24% of its range. The day-1 close check describes it; the stop came first. | od.day1_close_check |
| 3 | PAYC | 2026-10-01 | 229.02 at 9:35 | 224.09 (2.15%) | 10:35 the same day | A 3.6% gap over the prior high on 4.98x volume (the second-heaviest in the strict set), RS 90. The fill was the high of the day: the stock never ticked higher (0.00R), slid for an hour and took the stop at 10:35, then recovered to close at 78% of its range. A push that fails in minute six is not a drive. | od.trigger |
| 4 | RVTY | 2026-10-06 | 165.00 at 9:35 | 161.45 (2.15%) | 9:50 the same day | A 2.7% gap over the prior high on 2.94x volume, RS 91, 48% over its 200-day. 0.21R in the first minutes, then straight back through the open to the stop by 9:50; the day closed at 13% of its range. One of four strict drives that fired that morning (NVT, ARKG, CIBR were the others); all four were stopped. | od.market_reading |

**Four near-misses (each fails exactly one gate; the chart looks like the setup).**

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | TEAM | 2026-10-09 | od.gap_floor | opened +0.43% (204.45 against the prior close); the rule is a gap of 1% or more | An opening push with no gap behind it, on 3.91x first-bar volume and a first bar that closed at 99% of its range: a plain 5-minute range break, not a drive. Bought 207.03 at 9:35, 0.00R, stopped at 9:40. |
| 2 | NVT | 2026-10-02 | od.inv_back_to_open | price traded back under the open (169.59) at 9:35, before the first bar's high was taken at 9:40 | An open-test, not a drive: the first bar's low was lost before the trigger, so the rule says no trade. Bought 171.44 at 9:40 would have been 0.2R and stopped at 9:55. |
| 3 | KEYS | 2026-09-25 | od.first_bar_volume | first 5-minute volume 1.10x its 20-day average; the rule is 2x or more | A 1.2% gap over the prior high with no crowd behind it: a quiet gap, not a drive. Bought 363.86 at 9:35, 0.42R, stopped at 10:15. |
| 4 | WDC | 2026-10-05 | od.stop_width | the stop 429.88 is 3.53% under the fill 445.63 (the first bar was 3.6% tall); the rule is about 3% or less | A real drive (3.5% gap over the prior high, 3.51x volume, RS 92) whose first bar is too tall for the stop: size down by the stop or skip. 0.13R, stopped on the next morning's gap down. |

**What the failures have in common.** All four were stopped on the drive day, three of them by 10:35. In every one the high of the day came inside the first 20 minutes and the stock then traded back through its open, which is the card's failure mode in one sentence. Heavy first-bar volume did not save any of them (2.47x to 4.98x), and the gap over the prior day's high, the A+ mark, was present in all four; in this window that mark ran the wrong way (33 strict hits with it, 6.1% to 3R). The stop under the first bar's low, 1.0% to 3.0% away, is the whole plan: a drive that keeps going pays in minutes, and one that does not is over by 10:00, so the loss is small and quick. Sample caveat: 41 strict trades on 21 days, one autumn; these four are the shape of the loss, not a rate.
