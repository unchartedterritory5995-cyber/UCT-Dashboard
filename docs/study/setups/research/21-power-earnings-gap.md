# Setup 21: Power Earnings Gap (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page named next to it.
- **Checked word for word against a saved copy** (downloaded today and searched by a script): UCT's Substack (the live
  post pages), artoftrading.net, theowltrader.com, the Wiley publisher preview of *In the Trading Cockpit with the O'Neil
  Disciples*, stockbee.blogspot.com, qullamaggie.com, morpheustrading.com, tramondo.ch, tradingsim.com, nber.org,
  ideas.repec.org, and our own code and docs. In the book preview, words split by a line-end hyphen were joined.
- **Read through a page-reading tool** (the site refused a plain download): Bulkowski's thepatternsite.com. For his
  earnings pages I also checked the wording against a copy saved earlier today by the Episodic Pivot research run. His
  site carries an AI notice (section 11). Check these against the live page before a quote goes into a lesson.
- My web search allowance ran out partway through. I could not run wider searches for older uses of the name, for IBD's
  own breakaway-gap columns, or for TraderLion's earnings-gap course. Section 11 lists what I could not open.
- **Cold check, 2026-11-09 (a second reader).** Every outside source was downloaded again (Bulkowski's pages, which refuse
  a plain download, were read through the page-reading tool), all 103 Substack posts were downloaded from the sitemap,
  and every quote was searched by script in the page it is credited to; who wrote each Substack quote was checked against
  the post's section headings. The scanner summary was checked against the code, Tables A, B and C and the baseline were
  recomputed from the saved events and bars, and the example rows in 6.7 were recomputed from the bars. What changed is
  listed at the end, under "Removed in checking".

Tags used in section 8: **[source consensus]** at least two outside sources agree; **[originator]** the people who named
or codified it (here: Trader Stewie for the name, Gil Morales and Chris Kacher for the buyable gap-up, Pradeep Bonde for
the earnings episodic pivot, Kristjan Kullamägi for his own episodic-pivot rules); **[source]** an outside educator or
data source who is not an originator; **[UCT]** the owner, Bracco or the Substack; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[measured]** our own test in section 4.3; **[my proposal]** my
recommendation, for the owner to accept or change.

Terms. **Gap day**: the first regular session after the report (the same day for a report before the open, the next day
for a report after the close). **Gap**: the open above the prior close, in percent. **Gap-day low**: the lowest price of
the gap day. **Gap fill**: price trades back to the prior day's close. **DCR**: where the day closed inside its range
(0 = at the low, 1 = at the high). **ORH**: opening range high, the high of the first 1, 5, 30 or 60 minutes. **R**: the
risk on the trade (entry minus stop). **RVOL**: the day's volume divided by the 50-day average volume. **ADR / ATR**:
average daily range / average true range. **BGU**: buyable gap-up. **EP**: episodic pivot.

---

## 1. What it is

A Power Earnings Gap is a stock that gaps up on a strong earnings report, trades heavy volume, and closes strong near
the day's high. The trade is buying that stock, on the gap day or on its first orderly pause, with the stop under the
gap day's low or under the pause.

**Why it works (the psychology).** Each point names its source. None of it is a measured fact; section 4 has the
measurements.
- **New information forces a repricing.** Stockbee: "Gaps of certain magnitude indicate information mismatch."
  (Bonde's own comment under [Gaps and traps, stockbee.blogspot.com, 2006](https://stockbee.blogspot.com/2006/11/gaps-and-traps.html)). Qullamaggie calls it news
  "that catches the market off guard and forces a revaluation of the stock" ([qullamaggie.com, 2021](https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/)).
- **Big buyers cannot fill in one day, so they keep buying.** Qullamaggie: "when institutions buy, they don't buy in one
  day. It can take many months for them to get to their desired allocation." (same post). Trader Stewie, who named the
  setup, says the volume shows "institutions are piling into the name" ([artoftrading.net, 2021](https://www.artoftrading.net/post/what-is-a-power-earnings-gap-how-to-trade-it)).
- **The crowd is afraid to buy something already up a lot.** Morales and Kacher: buyable gap-ups "tend to work most
  likely because the crowd sees such moves as too high and thus is too timid to buy into them." ([Wiley preview, 2013](https://api.pageplace.de/preview/DT0400.9781118287293_A23567645/preview-9781118287293_A23567645.pdf))
- **Who is trapped.** My reasoning, not a source: shorts and sellers who sold before the report are on the wrong side
  above a level they cannot buy back cheaply; holders who sold on the open are tempted to buy back higher. The strong
  close matters because it shows the selling into the open was absorbed. Stewie: "The way the stock closes is equally,
  if not more important than the actual initial gap open!"
- **The academic version is post-earnings drift**, and it has weakened. Chan, Jegadeesh and Lakonishok (NBER, 1995):
  "Past return and past earnings surprise each predict large drifts in future returns after controlling for the other."
  But Martineau (2022): "For large stocks, PEAD have been non-existent since 2006 but has only disappeared recently for
  microcap stocks." See section 4.2. The trader version (buy the price reaction, not the surprise number) was not what
  either paper tested.

## 2. Origin and naming

**Short answer: the name "Power Earnings Gap" (PEG) traces to the trader known as Trader Stewie, not to Morales and
Kacher and not to Stockbee.** The setup itself is older and goes by other names.

| Name | Who | Where and when | What it covers |
|---|---|---|---|
| **Power Earnings Gap (PEG)** | Trader Stewie (@TraderStewie, Art of Trading) | Earliest dated use found: a market recap of 9 Dec 2018 that mentions "my PEG(Power Earnings Gap) list" ([theimpatienttrader.blogspot.com](http://theimpatienttrader.blogspot.com/2018/12/how-we-traded-this-weeks-market.html)); the definition post 19 Feb 2019 ([theimpatienttrader.blogspot.com](http://theimpatienttrader.blogspot.com/2019/02/what-is-power-earnings-gap-and-how-to.html)); reposted 24 Sep 2021, updated 1 Oct 2023 ([artoftrading.net](https://www.artoftrading.net/post/what-is-a-power-earnings-gap-how-to-trade-it)); sub-strategies 26 Feb 2023; a "BEARISH Power Earnings Gap" short variant, 23 Sep 2019 ([theimpatienttrader.blogspot.com](http://theimpatienttrader.blogspot.com/2019/09/bearish-rising-wedge-pattern-for.html)) | An earnings gap up that closes strong; used as a watchlist, then traded off flags, red-to-green or gap-and-go |
| **Buyable gap-up (BGU)** | Gil Morales and Dr. Chris Kacher | Noticed "During the mid-2000s"; the book says the pocket pivot and buyable gap-up were "concepts created by Chris Kacher (a.k.a Dr K) in 2005"; "first revealed" in *Trade Like an O'Neil Disciple* (Wiley, 2010); expanded in *In the Trading Cockpit with the O'Neil Disciples* (Wiley, copyright 2013) and Morales's glossary ([theowltrader.com](https://theowltrader.com/glossary-trading-methods/)); also an Active Trader article, Dec 2010 (per Bulkowski) | Any big gap-up on heavy volume in a leading stock, earnings or not |
| **Episodic pivot (EP), earnings EP, earnings breakout** | Pradeep Bonde (Stockbee) | "How to trade earnings", 30 Mar 2007; "What are Episodic Pivots", 12 Feb 2010; process flow 30 Jul 2014 ([stockbee.blogspot.com](https://stockbee.blogspot.com/2010/02/what-are-episodic-pivots-and-how-to.html)); on 8 Jul 2014 he names "Earnings based Episodic Pivots" as the method that "has made me the most money in absolute dollar terms in shortest period of time" | A surprise catalyst gap, best in a neglected stock; earnings is the main type |
| **Episodic pivot (Qullamaggie's version)** | Kristjan Kullamägi | 8 Jan 2021 and 2 Nov 2021 ([qullamaggie.com](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)); "a setup I learned from Pradeep Bonde (Stockbee)" | A 10%+ gap on surprise news; earnings EPs are his main type |
| **Earnings flag** / **good earnings surprise** | Thomas Bulkowski | Event patterns; the earnings flag "Discovered by Thomas Bulkowski in the late 1990s" ([thepatternsite.com](https://thepatternsite.com/earnflag.html)) | The earnings jump, then a flag, then the breakout |
| **Breakaway gap** (on earnings) | Deron Wagner and Morpheus Trading; IBD | Morpheus 2018 and 2022 ([morpheustrading.com](https://morpheustrading.com/blog/gap-trading-strategy/)); IBD columns I could not open | A gap out of a base of at least 4 to 5 weeks on 3x volume |
| **Post Earnings Gap (PEG)**, **ER gapper**, **earnings gapper**, **PEG list** | UCT | Sunday Scans and The Rest of the Week, 2025 to 2026 (section 6) | UCT expands "PEG" both ways |

Who credits whom, as written:
- Stewie on himself: "A few years ago, I "developed" this strategy for generating HIGH QUALITY stock ideas" and he
  created the hashtag #PowerEarningsGap ([artoftrading.net](https://www.artoftrading.net/post/what-is-a-power-earnings-gap-how-to-trade-it); the same lines are in the 2019 blog post).
- Tramondo Investment Partners (a Swiss manager), 11 Aug 2021: "our favorite setup is the "Power Earnings Gap" – in short
  we call it "PEG", which was originally created by @traderstewie." ([tramondo.ch](https://www.tramondo.ch/en/power-earnings-gap/))
- TradingSim, 18 Nov 2021: "Or you've seen @traderstewie refer to his Power Earnings Gap (PEG) plays." and Morales and
  Kacher "simply call them "Buyable Gap Ups."" ([tradingsim.com](https://www.tradingsim.com/blog/episodic-pivot-power-earnings-gap-buyable-gap-up-explained))

**What I could not find.** I read the Cockpit preview's whole Buyable Gap-Ups section and Morales's glossary: neither uses
"power earnings gap". Stockbee's blog search for "power earnings gap" returned posts that use the words separately; none
of the result text I read has the phrase. So the workflow's premise ("Gil Morales and Chris Kacher's term; also
Stockbee") is not supported by anything I read; their terms are BGU and EP. An older use of "Power Earnings Gap" may
exist; my search allowance ran out before I could look wider. Stewie's 2019 post says he developed it "a few years ago",
so the term may predate 2019. (Cold check: it does. A date-sorted search of Stewie's own Blogspot blog found a 9 Dec 2018
post, "How We Traded This Week's Market", that already says "many stocks on my PEG(Power Earnings Gap) list are flat or
green". A general web search for the phrase in 2016 to 2018 found nothing. Twitter, where he says he created the
#PowerEarningsGap hashtag, was not searched.)

**Our app's attributions are wrong.** `power_earnings_gap.py` says the PEG was "codified by Pradeep Bonde of Stockbee"
(and the scanner list in `api/routers/patterns.py` calls it "Bonde's signature post-earnings continuation setup");
the Compass test answer in `api/services/compass_eval/golden_set.json` (R2-09) calls it "PEG (Minervini)". Neither is
supported (section 5).

Other names found but not verified: a TradingView script by Amphibiantrading (15 Dec 2024) defines "PEG", "Monster Gap"
and "Monster Peg" and says it is "Based on research conducted by John Pocorobba and Jason Thompson"; I could not find
that research.

## 3. Every definition, source by source

### 3.1 Trader Stewie, Art of Trading (the name)

Sources: [2021 post](https://www.artoftrading.net/post/what-is-a-power-earnings-gap-how-to-trade-it) (same text as the
[2019 post](http://theimpatienttrader.blogspot.com/2019/02/what-is-power-earnings-gap-and-how-to.html)) and
[3 Trading Strategies for Power Earnings Gaps](https://www.artoftrading.net/post/3-trading-strategies-for-power-earnings-gaps), 26 Feb 2023.
- **Definition**: "A stock that gaps up after reporting strong earnings and closes the day by printing a very strong candle."
- **Close**: "A candle that closes at or near HIGHS of the session is THE MOST ideal and perfect 'Power Earnings Gap'
  candidate!" and "A stock that gaps up on strong earnings only to reverse and close in the red is NOT what I want to
  see in a PEG candidate."
- **Gap size**: none given ("a big nice GAP UP").
- **Volume**: none given; he assumes it ("Volume will be automatically HUGE").
- **Prior trend, base, moving averages**: none given.
- **Extra filter**: short interest. "+10% or higher is most ideal!"
- **Entries** (2023): (1) swing: bull flags, pennants, mini wedges, coiling patterns, inside days; "Usually it takes about
  5 - 7 trading days for these technical patterns to develop." (2) "PEG R2G": "The PEG R2G strategy is meant for the day
  after the Power Earnings Gap event"; "What you want to see if the PEG stock open red and then quickly go green."; size
  "3/4 - 1/2 half your regular size!" (3) Gap-and-Go: "It usually starts in the after hour session shortly after the first
  reaction from the earnings report."; "Limit orders are absolutely necessary."; "1/2 half your regular size!" but "Think
  1/4 your usual sizing to start", with "increasing your position size by another 1/4" if, the next morning, the stock
  breaks the opening-range high; and the next morning "you want to see the PEG candidate gap up and hold the gap."
- **Stop, targets**: no stop level and no target. For the two day trades he says only "Size these trades with tighter stop
  losses". He advises not holding through the report: "No need to take the big stressful risk and hold a stock thru
  earnings!"
- **Short mirror** (cold check; the 2019 to 2023 posts above do not cover it): in "Bearish Rising Wedge Pattern For
  Shorting", 23 Sep 2019, he pairs a short pattern with a "BEARISH Power Earnings Gap": "a stock that gaps down and sells
  off after reporting poor earnings", then "a weak multi-day, low volume bounce".

### 3.2 Tramondo Investment Partners (a manager that trades it)

Source: [market note, 11 Aug 2021](https://www.tramondo.ch/en/power-earnings-gap/). Credits @traderstewie. Adds:
- "Preferably, the stock makes new all-time-highs or 52-week highs and breaks out from at least a month's range"
- "Volume needs to be huge -> at least 3-5x daily average, we want to see other institutions next to us piling into the name"
- Warns the aggressive day-one trades are for "very experienced investors". No stop or target.
- Our course F5.07 already quotes this page (as "This manager"), `docs/study/courses/F5/F5.07.json`.

### 3.3 Gil Morales and Chris Kacher: the buyable gap-up

Sources: Wiley publisher preview of *In the Trading Cockpit with the O'Neil Disciples* (Introduction, "Buyable Gap-Ups"
and "The Seven-Week Rule"); Morales's glossary at [theowltrader.com](https://theowltrader.com/glossary-trading-methods/)
(gilmoreport.com now redirects there; its About page is signed by Gil Morales); Bulkowski's reading of their Dec 2010
Active Trader article ([thepatternsite.com/KacherMorales.html](https://www.thepatternsite.com/KacherMorales.html)).
- **What the preview holds** (cold check): the Introduction's "Buyable Gap-Ups" and "The Seven-Week Rule" sections. The
  book's own BGU chapter ("Buyable Gap-Up Exercises") and the FAQ's BGU answers are listed in the contents but are not in
  the preview, so nothing here comes from them.
- **Origin**: "the pocket pivot and buyable gap-up concepts were born, concepts created by Chris Kacher (a.k.a Dr K) in 2005".
  Their example of trading it "before we even really understood the phenomenon" is an earnings gap: "the purchase of Apple
  (AAPL) in October 2004 as it gapped-up on earnings".
- **Name**: "we call it a buyable gap-up." It is "the point at which the bulls have decisively won the argument over the bears".
- **Gap size**: they "previously used a calculation that required the gap-up to be at least 0.75 times the 40-day average
  true range", but "in practice it is enough to be able to "eyeball" a gap-up move that appears to be of sufficient
  magnitude on a standard arithmetic daily chart." Glossary: "Small gap-ups are not what we are looking for here."
- **Volume**: "at least 1.5 times, or 150 percent of the 50-day moving average of daily trading volume" (book); glossary:
  "at least 1.5 times the average daily trading volume."
- **Prior trend**: "Buyable gap-ups should occur within an uptrend or constructive consolidation, not while a stock is in
  a downtrend." Not only from bases: "buyable gap-ups can also occur within uptrends that are well formed and coherent."
  Exception: the "bottom-fishing" BGU, out of "a low base consolidation" after a longer decline (glossary).
- **Stock quality**: "Buyable gap-ups should occur in fundamentally sound and leading stocks, or there should be a
  compelling thematic basis for consideration." Earnings are not required.
- **Entry**: "one could buy the stock on the gap-up day or the day after since the stock was still in range." (Said of the
  AAPL 2004 example, which never traded under its gap-day low; it is not stated as a general window.)
- **Stop**: "it comes with a built-in selling guide, which is the intraday low of the gap-up day". Glossary: "A buyable
  gap-up should hold above the intraday low of the gap-up day, and one can therefore use the intraday low of the gap-up
  day as a selling guide." Allow porosity: "it
  can be prudent to use the intraday low plus 2–3 percent more on the downside". In Bulkowski's reading: "Sell if price
  closes below the low posted on the day price gaps up." The earlier house research (`docs/study/levels/external_research.md`)
  cited a TraderPlanet article for a rule allowing a 1% to 2.5% undercut of the low only in the first five days; that
  page returned an error today, so I do not use it.
- **Sells (the Seven-Week Rule)**: if the stock holds its 10-day average for at least seven weeks after the buy, the
  10-day is the selling guide; if it violates the 10-day sooner, use the 50-day. A violation is a close below the average
  followed by a move below the low of that first close-below day.
- **Short mirror**: "A shortable gap-down (SGD) can be thought of as the reverse of a buyable gap-up (BGU)." It "becomes
  actionable as close to the intraday high of the gap-down day as possible." (glossary)

### 3.4 Pradeep Bonde (Stockbee): the earnings episodic pivot

Sources: [How to trade earnings, 30 Mar 2007](https://stockbee.blogspot.com/2007/03/how-to-trade-earnings.html);
[Earnings and Bulkowski, 4 Apr 2007](https://stockbee.blogspot.com/2007/04/earnings-and-bulkowski.html);
[Gaps and traps, 22 Nov 2006](https://stockbee.blogspot.com/2006/11/gaps-and-traps.html) (his comments);
[What are Episodic Pivots, 12 Feb 2010](https://stockbee.blogspot.com/2010/02/what-are-episodic-pivots-and-how-to.html);
[My process flow for EP, 30 Jul 2014](https://stockbee.blogspot.com/2014/07/my-process-flow-for-episodic-pivots-ep.html);
[Find the young Episodic Pivots, 1 Sep 2025](https://stockbee.blogspot.com/2025/09/find-young-episodic-pivots.html).
- **Fundamentals (2007)**: "I only track companies whose earnings are up 100% or more quarter over quarter and the
  earnings should be at least 5 cents. Sales/revenue should be up 5% or more."
- **Prior trend**: the opposite of a leader filter. "I am looking for stocks which have not rallied in anticipation of
  earnings." He prefers neglected stocks, low float (2010: "Float below 25 million is ideal"), and warns "Earnings
  breakout on companies with significant analyst coverage do not do as well as the first kinds." Late gaps after a huge
  run are exhaustion gaps: "when the grandma in Timbuktu gets excited about it, it is exhaustion gap." (2006)
- **Gap and volume (his scans)**: 2010 (Telechart, close to close, not the open):
  `((C - C1) >= 5 AND V > 10000 AND C >= 62.50 AND V > V1) OR ((( 100 * (C - C1) / C1) >= 8 AND V > 3000 AND (100 * V / AVGV100) >= 300) AND C > 1)`.
  That is: up $5 for stocks at $62.50 or more on rising volume, or up 8% on 3x the 100-day average volume. 2014: "Run EP
  scan c/c1>1.04 and v>3*avgv50.1 and v>=300000 multiple times" (up 4% close over close, not a 4% opening gap, on 3x
  the 50-day average). Big winners "will
  have huge volume surge, typically of 10 times or more compared to average volume." He adds, in a reply under the 2010
  post (22 Feb 2010): "I buy less than 1% stocks from that scan." Earliest numbers, his own comments under the 2006 post:
  "So I always investigate 20% plus gaps on both side to see opportunities." and "I look at 20% plus 1 million volume."
- **Entry**: on the day. "So if you don't enter on the earnings day you will be just a observer." (2007); "If I find a
  good EP I buy immediately in pre or post market." (2014). The bull flag later is a second way: the good surprises "are
  best bought on the earnings day. Buying after the bull flag is formed is another way to play the earnings." (2007)
  And "delayed reactions EP" (2025).
- **Adding**: "Most of the time I will enter in the morning and add to position later if the volume climbs above average
  volume." (2007)
- **Stop**: "I put stops 1 dollar below the gap low if it is gap up or at 2 days low and trail with stop." (2007); "the
  stop is the low of last 2 days before entry" (his reply of 30 Sep 2010 under the 2010 post, for trades entered "in pre
  market or at open"); "Yes. It is normally low of the EP day." (his reply of 31 Jan 2017 under the 2014 post).
- **Exits**: "The exits are in 4 parts with profit target of 20% plus." (the same 30 Sep 2010 reply). He moves stops quickly after a 20%
  move (2007).
- **Watchlist**: "I maintain a watch list of stocks which respond with a high breakout on earnings day of 4% plus for
  next one year." (2007) This is the same idea as UCT's "PEG list".

### 3.5 Kristjan Kullamägi (Qullamaggie): the episodic pivot

Sources: [3 TIMELESS setups, 8 Jan 2021](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/);
[How to master a setup: Episodic Pivots, 2 Nov 2021](https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/).
- **Gap and volume**: "An EP needs to be a gap of 10%+ and big volume should be there, if not in pre-market then the
  first 5-10 minutes after the open." Ideally the stock trades its average daily volume in the first 15 to 20 minutes.
- **Fade = not an EP**: "Now the middle red arrow, the stock gapped up slightly but sold off. This is not an EP."
- **Fundamentals**: triple-digit or mid/high double-digit growth, "a big analyst beat ... and a big guidance higher.
  Volume is the #1 thing to focus on."
- **Prior trend**: "It's best if the stock has not rallied over the past 3-6 months." and "The best EPs are on stocks ones
  that have gone sideways for 3-6 months or more." A second EP after a big move "can work but the failure rate is higher".
- **Entry**: "Enter opening range highs. ORH can be the highs of the first 1-, 5-, or 60-minute candle. The stop is at the
  lows of the day."
- **Stop width**: "Make sure your stop is no more than 1x, or maximum 1.5x the average daily range or the average true range."
- **Trail**: "Trail your stop with the 10- or 20-day moving average once they surpass your initial stop." Also: "Create
  your own sell rules. You can trail these with the 20- or 50-day moving average".

### 3.6 Deron Wagner and Morpheus Trading: the breakaway gap on earnings

Sources: Wagner, [How To Trade Breakaway Gaps, 6 Sep 2018](https://morpheustrading.com/blog/breakaways-gaps/); Morpheus
(byline "Rick"), [Gap Trading Strategy: 5 Top Ways to Buy Stocks Gapping Up from Earnings, 27 Oct 2022](https://morpheustrading.com/blog/gap-trading-strategy/).
- **Base**: "Breakaway gaps should occur following a valid basing pattern of at least four to five weeks in length." 2022:
  "The price should have at least just broken out from a base one to two weeks prior." And: "We are not looking to buy
  a gap up in the middle of a strong, existing uptrend (take a pass)".
- **Volume**: "On the day of the gap, volume should be at least three times greater than the 50-day volume average."
- **Size and fill**: "The stock should be up more than 5%, and as much as 20-25%, by the end of day. Any stock that fills
  the opening gap should be avoided."
- **Fundamentals**: strong earnings or sales growth, 20% or more (2022).
- **Entries**: aggressive day-one buy after the first minute or two, "You could enter half the position on strength, as
  the stock moves higher intraday, and place a stop 5-10% below the entry."; over a 5-minute opening high (2022); "Wait
  for a tight-ranged inside day on lighter volume to print within a few days of the gap."; over a two-day high; the first
  test of the 10-day; a reversal at the 20-day EMA; near the 50-day "as long as the gap was not filled" (all 2018). 2022
  adds a buy over the gap day's high, which "sometimes requires a wide stop down to the low of the gap up day".
- **Stop in their worked example**: "below the low of the gap" (BOOT, 2018).
- **Exits**: no rule; the 2022 post's SNAP example "could have been easily sold for a 20-30% gain just a few weeks after
  entry".

### 3.7 Thomas Bulkowski: the earnings flag and the good earnings surprise

Sources: [Earnings Flag](https://thepatternsite.com/earnflag.html); [Good Earnings Surprise](https://thepatternsite.com/earnsgood.html)
(ThePatternSite; *Encyclopedia of Chart Patterns* 2nd ed., pages 893 to 907 and 868 to 879).
- **Earnings flag**: "The earnings flag is an event pattern that occurs after a company announces earnings. Price makes a
  large upward move, consolidates, and then resumes the uptrend." Trend: performs best in an upward trend. Flagpole: a
  near-vertical run, "preferably lasting several days". Flag: "The best performers are tight congestion patterns".
  Buy: "Buy when price pierces a flag or pennant trendline ... or rises above the event pattern's high (A), but not before."
  Odd note: "The best performers occur in a price uptrend but they are within a third of the yearly low." Sell: "If price
  shows weakness in the first week, consider selling."
- **Good earnings surprise**: trend "Upward leading to the announcement for the best performance"; a tall intraday swing
  of 2 or 3 times the month's average range; "Select patterns with heavy announcement day volume, above the 30-day
  average." Buy: "A breakout occurs when price closes above the high posted on the announcement day." Also prefers
  announcements "within a third of the yearly low".

### 3.8 Secondary pages (read, low weight)

- **TradingSim** (John McDowell, reviewed by Al Hill, published 18 Nov 2021, page shows "Updated Mar 31, 2026"): mixes EP,
  PEG and BGU. It says "According to
  Qullamaggie and Bonde, the gap needs to be considerable: 8-10% or more", which does not match either source (Qullamaggie
  10%+; Bonde 8% close to close in 2010, 4% in 2014). It says "Gil Morales teaches that if a stock retests the gap, give it
  a good 3-4% on the downside"; the book I read says 2 to 3 percent. Treat its numbers as unreliable.
- **Amphibiantrading, TradingView "Earnings Gap Ups"** (15 Dec 2024): PEG = "Price gain of 10% or more", "Volume is
  greater than 200% above the 50-day average", "EPS surprise of at least 20%". Cites research I could not find.

### 3.9 Comparison table

| Criterion | Stewie (PEG) | Tramondo | Morales/Kacher (BGU) | Bonde (earnings EP) | Qullamaggie (EP) | Wagner/Morpheus | Bulkowski |
|---|---|---|---|---|---|---|---|
| Catalyst | strong earnings | strong earnings | any; earnings common | earnings (100%+ QoQ EPS) or ~20 catalyst types | surprise news; earnings main | earnings or news | earnings report |
| Prior trend | none stated | new 52-week or all-time high | uptrend or constructive base; not a downtrend (bottom-fishing exception) | not rallied; neglected | not rallied 3-6 months | base 4-5+ weeks; not mid-uptrend (2022) | upward trend; near yearly low best |
| Base | none | breaks a range of at least a month | base or orderly uptrend | none required | sideways 3-6 months best | 4-5 weeks (2018) | none |
| Gap size | "big" | none | 0.75 x ATR(40) or eyeball | 8% close/close (2010); 4% (2014) | 10%+ | up 5% to 25% by the close | "large upward move" |
| Volume | "automatically HUGE" | 3-5x average | 1.5x the 50-day | 3x the 100-day (2010) or 50-day (2014); 10x in big winners | big; ADV in 15-20 min | 3x the 50-day | above the 30-day |
| Close | at or near the high; red = no | strong, near highs | not stated | not stated | a fade is not an EP | must not fill the gap | not stated |
| Entry | flag/pattern; day-2 red-to-green; gap-and-go (after hours, limit orders) | not stated | gap day or the day after (AAPL example) | earnings day, pre-market or open; flag later | ORH (1, 5, 60 min) | day 1 (after the first minute or two, or over the 5-min high); inside day; 2-day high; gap-day high (2022); 10-day; 20-EMA; 50-day if the gap holds | flag breakout (earnings flag); close over announcement high (surprise) |
| Stop | no level; "tighter stop losses" for the day trades | not stated | gap-day low, plus 2-3% porosity | $1 under gap low, or 2-day low; "low of the EP day" (2017 reply) | low of the day; max 1-1.5x ADR | 5-10% (day 1); below the gap low | not stated |
| Exits | not stated | not stated | 10-day or 50-day (7-week rule) | 4 parts, 20%+ target | 10/20-day trail; or 20/50-day | no rule (SNAP example: 20-30%) | measure rule; sell weak first week |
| Short mirror | "BEARISH Power Earnings Gap" (2019) | none | shortable gap-down | (earnings gap downs exist) | parabolic short is separate | none | bad earnings surprise |

### 3.10 Where they disagree

1. **Leader or neglected?** Morales/Kacher, Tramondo and our house brain want a leader in an uptrend at new highs. Bonde
   and Qullamaggie want a neglected stock that has not rallied. Morpheus (2022) even passes on gaps in the middle of a
   strong uptrend. This is the biggest split, and it is the line between "PEG" (UCT, Stewie) and "EP".
2. **Gap size.** From "eyeball" (Morales) and none (Stewie) to 4%, 5%, 8% and 10%+.
3. **Volume.** 1.5x the 50-day (Morales), 3x (Bonde, Wagner), 3-5x (Tramondo), 10x in the big winners (Bonde).
4. **Close.** Stewie and Tramondo make the strong close the core; Morales, Bonde and Bulkowski do not require it;
   Qullamaggie rejects a fade.
5. **When to buy.** Day one (Bonde, Qullamaggie, Morales's gap day) versus the first pause (Stewie's main swing method,
   Bulkowski's earnings flag, Wagner's inside day). Bonde says the flag often comes too late; Bulkowski's measured best
   pattern is the flag.
6. **Stop.** Gap-day low exactly (Qullamaggie; Bonde's 2017 reply), with 2-3% slack (Morales), $1 under or the 2-day low
   (Bonde 2007), or a fixed 5-10% (Wagner day one).
7. **Near highs or near lows?** Bulkowski's data favour announcements within a third of the yearly low; Tramondo and the
   leader school want new highs.
8. **Earnings required?** Stewie and Tramondo yes; Morales no; our owner treated a news gap (INTC, Sept 2025) "like a
   classic PEG" (section 6).
9. **Adding.** Bonde (2007) adds when volume comes in and Stewie adds a quarter position on the gap-and-go; Morales and
   Kacher's Seven-Week Rule passage speaks of building and pyramiding a position. The house allows no adding (A5).

## 4. Measured evidence

### 4.1 Bulkowski (ThePatternSite)

His method, from his glossary: "average rise" runs "from the opening price the day after the breakout to the ultimate
high"; the ultimate high is "The highest peak before price declines by at least 20%"; the break-even failure rate is the
share of patterns "that fail to rise ... by at least 5%". His pattern pages say the numbers "are based on hundreds of
perfect trades". So they measure the best possible exit, not a trading plan, and give no exact sample or date range.

| Pattern (bull market, upward breakouts) | Performance rank (of 6 event patterns) | Break-even failure | Average rise | Throwback | Meets measure-rule target |
|---|---|---|---|---|---|
| Earnings flag | 1 | 10% | 34% | 63% | 86% |
| Good earnings surprise | 5 | 29% | 24% | 41% | 76% |

On the good surprise he warns: "Almost half (48%) rise just 10% before tumbling and that occurs in less than 2 weeks."

**Gaps in general** ([gaps.html](https://www.thepatternsite.com/gaps.html), updated 8 Aug 2025, "over 1,100 samples", bull
market): upward breakaway gaps close within a week 1% of the time (area gaps 85%, exhaustion gaps 60%); the median time to
close an upward breakaway gap is 89 days. "Gaps are places of weak support or resistance, but you can use them for a stop
location." "Place a stop a few cents below the gap (upward breakouts)". On candlestick windows
([Gauging Gaps](https://www.thepatternsite.com/GaugingGaps.html), read from a saved copy): "Gaps in an uptrend (rising
windows) show underlying support 20% of the time in a bull market and 16% of the time in a bear market."

**His test of the Kacher-Morales rules** ([KacherMorales.html](https://www.thepatternsite.com/KacherMorales.html)): 557
stocks, 12 Mar 2001 to 1 Oct 2010, 16 variants; buy on qualifying gaps (0.75 x ATR(40), 1.5x the 50-day volume, uptrend
or consolidation breakout), sell on a close below the gap-day low or by the 7-week rule. "Average gain ranges between 1.2%
and 3.1%"; "Win/loss ratio ranges between 28% and 32%"; "Average drawdown: 5.5% to 8.9%"; "Hold time: 29 to 43 days".
His verdict: "I don't recommend this setup, but test it for yourself and make up your own mind." Limits: not earnings
only; his own reading of the rules; one stock (Insteel) inflated the best variant; the authors published no results to
compare.

### 4.2 Academic

- Chan, Jegadeesh and Lakonishok, "Momentum Strategies", NBER Working Paper 5375, Dec 1995
  ([nber.org](https://www.nber.org/papers/w5375)): past returns and past earnings surprises each predict drift; "The
  results suggest a market that responds only gradually to new information." Limits: older data; portfolio sorts, not
  gap trades.
- Martineau, "Rest in Peace Post-Earnings Announcement Drift", Critical Finance Review, 2022 (abstract on
  [ideas.repec.org](https://ideas.repec.org/a/now/jnlcfr/104.00000122.html)): prices now "fully reflect earnings
  surprises on the announcement date"; drift gone for large stocks since 2006. Limits: it tests the earnings-surprise
  number, not the price reaction or chart setups.
- Ball and Brown (1968) and Bernard and Thomas (1989) are cited by Stockbee and by our earlier research; both pages were
  blocked to me, so I quote nothing from them.
- A reader's comment under Stockbee's 2010 post reports a private backtest; it is not evidence and I do not use it.

### 4.3 Our own test (new, for this dossier)

**What I did.** Daily bars (Yahoo Finance via yfinance, saved by the Inside Day research run in this session's scratch
folder) for 151 US stocks, 2010 to 6 Nov 2026, with report dates from `docs/study/setups/earnings_dates_cache.json`. An
event is an earnings-linked gap-up: the open at least 3% over the prior close, with a cached report date on the gap day
or the day before. 2,468 events. Scripts: scratch `setups/21-power-earnings-gap/tools/measure_peg.py`, `analyze_peg.py`,
`baseline_peg.py`, `run_detector.py`.

**Limits, read these first.** The 151 names are today's well-known large and mid caps, so survivors are over-represented
(even random days did well, see the baseline). Daily bars cannot see the opening range or the order of prices inside a
day, so the "stop" is the gap-day low and a stop and a target in the same bar count as a stop. The report-date cache's
source and timing are not documented. One test, no out-of-sample check, no costs or slippage. Treat every number as a
rough guide for the owner's decisions, not a lesson fact.

**Table A. Entry at the gap-day close, stop one cent under the gap-day low.** "Held 10" = no later low under the gap-day
low for 10 sessions. "Filled 20" = traded back to the prior close within 20 sessions. "P(3R)" = reached entry + 3R before
the stop, within 60 sessions. Rows 2 to 13 also require the house liquidity rule (price $10+, $20M+ a day, B23).

| Definition tested | Events | Median gap | Median stop width | Stop within 3% | Held 10 | Filled 20 | P(3R) |
|---|---|---|---|---|---|---|---|
| All earnings gap-ups 3%+ | 2,468 | 5.9% | 2.5% | 57% | 38% | 46% | 32% |
| BASE: gap 4%+, volume 1.5x+ | 1,606 | 7.0% | 2.7% | 55% | 39% | 40% | 32% |
| Morales/Kacher BGU (0.75 ATR, 1.5x, 50-day over 200-day, price over 50-day) | 814 | 5.8% | 2.3% | 62% | 39% | 42% | 30% |
| Stewie PEG (gap 4%+, green, close in top 25%) | 459 | 6.9% | 5.7% | 12% | 57% | 27% | 29% |
| Qullamaggie EP (gap 10%+, 2x, 65-day move within 20%) | 228 | 13.2% | 3.5% | 43% | 46% | 18% | 39% |
| Our scanner's gap-bar gates (gap 8-100%, 3x the 20-day) | 508 | 12.5% | 3.8% | 39% | 44% | 26% | 34% |
| "Leader PEG" (BASE, uptrend, rising 200-day, top 25% close) | 165 | 6.9% | 6.1% | 15% | 61% | 21% | 28% |
| BASE, prior close under the 200-day | 609 | 7.1% | 2.8% | 52% | 39% | 42% | 34% |
| BASE, close in the bottom half | 789 | 6.9% | 1.2% | 88% | 25% | 52% | 32% |
| BASE, close in the top 25% | 462 | 7.0% | 5.6% | 13% | 57% | 27% | 30% |
| BASE, up 30%+ in the 65 days before | 205 | 9.3% | 3.6% | 42% | 37% | 49% | 31% |
| BASE, within 10% of flat over 65 days | 640 | 6.4% | 2.2% | 63% | 40% | 38% | 34% |
| BASE, closes at a new 52-week high | 465 | 7.8% | 3.3% | 47% | 46% | 27% | 30% |

Baseline: 26,738 random green days in the same stocks (every 7th day, liquid, stop 1% to 8%): P(3R) 30%. By period, BASE
P(3R) was 34%, 31%, 29% and 33% in 2010-14, 2015-19, 2020-22 and 2023-26. By gap size the median stop widened from 2.2%
(gaps of 4-6%) to 4.6% (gaps of 15%+).

**Table B. The house plan** (one full position at the gap-day close; a third off at 3R, a third at 5R, F63 open fills;
stop to breakeven after 3R; after 3R, whatever is still held (two thirds before 5R, one third after) is sold on a close
under the 10-day; C33 time stop, checked from the 10th session on; out before the next report unless the trade has
reached 5R, B22). Only events whose stop was 1% to 8% wide (tiny stops make R meaningless). (Cold check: every row of
Tables A, B and C, the period split, the stop-by-gap-size line and the baseline were recomputed from the saved events and
bars and match. The 1% to 8% filter is not in the saved `analyze_peg.py`; applying it reproduces every Table B row.)

| Definition | Events | P(3R) | Mean R (standard error) | Median R | Winners |
|---|---|---|---|---|---|
| Baseline random green days | 26,738 | 30% | +0.16 (0.01) | -1.00 | 35% |
| BASE | 1,151 | 33% | +0.28 (0.06) | -1.00 | 41% |
| Morales/Kacher BGU | 569 | 32% | +0.25 (0.09) | -1.00 | 42% |
| Stewie PEG | 342 | 29% | +0.12 (0.09) | -0.27 | 46% |
| Qullamaggie EP | 157 | 41% | +0.67 (0.19) | -0.27 | 48% |
| Our scanner's gap-bar gates | 361 | 36% | +0.35 (0.12) | -1.00 | 44% |
| "Leader PEG" | 116 | 28% | -0.00 (0.14) | -0.19 | 47% |
| Prior close under the 200-day | 444 | 35% | +0.36 (0.10) | -1.00 | 42% |

What it suggests (tentative): earnings gap-ups beat random days modestly in this sample; the big-gap, not-extended EP
version did best; the strong-close "leader" version held its low far more often but did not pay more per unit of risk,
because its gap-day-low stop is wide; most single trades lose 1R and the edge comes from a minority of big winners.

**Table C. How often a gap-day buy breaks a house rule** (share of events):

| Definition | More than 10% over the 10-day at the close (C29) | Open more than 4% over the prior 50-day high (C28, if the base high is the buy point) | Prior close under the 200-day (B26) | Gap-day-low stop wider than 3% (A13) |
|---|---|---|---|---|
| BASE | 33% | 26% | 38% (13% of all events closed back above it that day) | 45% |
| Stewie PEG | 55% | 25% | 37% | 88% |
| Qullamaggie EP | 69% | 53% | 43% | 57% |
| Our scanner's gates | 68% | 54% | 35% | 61% |
| "Leader PEG" | 64% | 43% | 0% | 85% |

**Our scanner, run as written.** I imported `detect_power_earnings_gap` from the repo and called it 3 to 10 sessions after
each qualifying gap, with no context. It fired 407 times. (Cold check: this run used all 204 local bar files, and 30 of
those stocks have no report dates in the cache, so their 89 fires could only count as "not earnings-linked". On the 318
fires in stocks that do have report dates, 258 (81%) were earnings-linked and 60 (19%) were not. The first version of
this paragraph said 63% and 149, counting the 89 unknowns as non-earnings.)
Its stop (1.5% under the gap-day low) sat a median 12.6% under its entry (middle half 9.0% to 17.1%); none were within
3% and 18% within 8%. With a buy stop at its entry, 264 filled; P(2R) 52%, P(3R) 33%, P(5R) 10% before the stop.

**The short mirror, measured.** Earnings gap-downs of 4%+ on 1.5x volume, liquid: 1,238. 59% started above the 200-day
and 39% still closed above it on the gap day (B26 forbids shorting those). The median return 20 sessions later was +0.8%,
so this sample gives no support for shorting the mirror. (Cold check: no script for this count was saved. An
independent recount with the same rules (open 4%+ under the prior close, report on the day or the day before, 1.5x the
50-day volume, $10 and $20M a day, from 2010) found 1,272 events, with the same 59%, 39% and +0.8%.)

## 5. Our app

### 5.1 The scanner: `api/services/pattern_engine/detectors/uct/power_earnings_gap.py`

What the code actually tests, in order (`_try_extract`):
1. Liquidity: `liquidity_floor` (`primitives/liquidity.py`): last close $2+ and a 20-bar average of $10,000+ a day.
2. A gap bar in the last 30 bars with at least 3 bars after it: open at least 8% over the prior close, and not over 100%
   (a split artifact).
3. Gap-bar volume at least 3x the average of the 20 bars before it.
4. 3 to 10 bars after the gap bar, ending on the last bar.
5. "Continuation gate": every low after the gap stays above 99% of the gap-day OPEN (not the gap-day low).
6. "Tightness gate": the average range of the last 3 bars is under 70% of the gap bar's range.
7. "Pending breakout": the last close is not more than 0.5% over the earlier post-gap high.
8. Context: rejects only when all three of Stage 4, stacked-bearish averages and falling RS are true. Stage 1 to 3 pass.

Scoring: 40% geometry (gap size, tightness, holding margin, number of bars), 25% volume (3x = 50 points, 5x+ = 100), 20%
context (stage, averages, RS, DCR accumulation, CAN SLIM grade), 15% a fixed 50; a 50 floor.

Levels (`_build_detection`): **entry** 0.1% over the post-gap high, with the condition "close > entry on volume >= 1.5x
20-bar avg"; **stop** 1.5% under the gap-day low (`gap_bar_low_minus_1.5pct`); **target** the gap close plus the gap
height, where the code's "gap height" is the gap-day close minus the prior close (the whole day's move, not just the
opening gap). Because of gate 4, only the bars 3 to 10 sessions back can be the gap bar (the 30-bar window is wider than
it needs to be); if more than one qualifies, it keeps the highest-scoring one. The earnings link is not checked: `days_to_earnings` is not supplied in production, so every narrative says the
earnings half is "UNVERIFIED".

### 5.2 Where the scanner disagrees with the sources or looks wrong

1. **Wrong origin.** It calls the PEG "codified by Pradeep Bonde of Stockbee" and the setup "Bonde's" in several
   sentences. The name is Stewie's (section 2); Bonde's term is the EP.
2. **A quote that is not in its source.** The docstring quotes Bonde's 2010 post as defining "a price move of 5+ points OR
   8%+ gain". That phrase is not in the post. The post's scan measures the CLOSE against the prior close (not the open),
   uses 3x the 100-DAY average volume (not 20 bars), and the $5 branch applies only to stocks at $62.50 or more. (To its
   credit, the same docstring says the 2010 post "describes Bonde's Episodic Pivot setup, not a
   Power-Earnings-Gap-specific writeup" and that the 8% is borrowed from it.)
3. **Unsourced teaching in the narrative.** "Bonde teaches that you can also enter on a tight 1-2 bar pullback ... but
   never chase more than 3-5% above the pivot", "a 'filling the gap' event in Bonde's terminology", "strong PEGs
   frequently 2-3x this initial projection" and "the profile Bonde teaches as the highest-conviction post-earnings
   setup": I found none of these in any source.
4. **The stop is far too wide for the house.** Median 12.6% from its entry, never within 3% (section 4.3). The house
   default is a few cents under the day's low or the prior day's low, usually within about 3% (A3, A13, F62).
5. **It fires on non-earnings gaps.** In our test, on stocks whose report dates we have, 19% of its fires (60 of 318)
   had no report near the gap (section 4.3).
6. **No strong-close test.** The originator's core rule (close near the high, never red) is absent.
7. **No trend or 200-day gate.** Stage 3 and most Stage 4 charts pass; B26 forbids longs under the 200-day.
8. **Liquidity far below the house.** $2 and $10,000 a day versus B23's $10 and $20 million.
9. **The hold test uses the gap-day open, minus 1%.** Morales's line is the gap-day LOW with 2-3% slack; the owner's Gap
   Support ruling uses the gap-up low, held or "slightly breached". A strong PEG that dips into its gap-day range in the
   first days is rejected.
10. **Its 8% floor is inconsistent with the app's EP detector,** which moved to 4% on the owner's decision of 2026-09-04
    (`episodic_pivot.py`). The router's description (`api/routers/patterns.py`) still says ">=4%".
11. **The target (gap close + gap height) has no source.** Bulkowski's earnings-flag measure rule is different (height
    from the pattern high to the announcement-day low, times 86%, added to the flag low).

### 5.3 The Model Book card, the journal tags and other app surfaces

- **Model Book** (`app/src/pages/modelbook/setupCatalog.js`): family "Gaps & Catalysts", long. Essence: "Blowout numbers
  gap the stock above its base on huge volume — institutions repricing in real time." Its glyph draws an 11% candle with
  no gap (the candle array `[11, 1, 0.4]` has no gap value, so `buildCandles` opens it at the prior close). A Power
  Earnings Gap card that shows no gap. A separate card, "News/Earnings Gapper", says "A headline-driven gap that holds its
  range — traded off the first pullback and reclaim." The two overlap.
- **Journal tags** (`app/src/constants/setupGroups.js`): "Power Earnings Gap" and "News Gappers" both, plus "Episodic
  Pivot", "Kicker Candle", "HVC", "Slingshot", "Go Signal". `api/services/pattern_vision/eval.py` maps both "Power
  Earnings Gap" and "News Gappers" to the PEG detector.
- **Chart starter scan "Power Earnings Gap"** (`app/src/components/chart/engine/ast/starterScans.json`):
  `days_to_earnings >= 0 && days_to_earnings <= 7 && rs_rank >= 70`. The column is defined as "the number of days until
  the next earnings report" (`closedTable.json`). So this scan lists strong stocks BEFORE a report, with no gap and no
  volume test. It is a pre-earnings list under the PEG name; a buy from it in the last 3 days before the report breaks
  B22.
- **Voice knowledge base** (`api/data/voice_kb/trading_principles.json`, sd-009): "gaps up 5%+ on 3x+ average volume",
  "The gap holds for the first hour", buy pullbacks to VWAP. No source given; different numbers from the scanner.
- **Compass test answer** (`api/services/compass_eval/golden_set.json`, R2-09): "PEG (Minervini)" and "Both gap 10%+ on
  a catalyst". Unsupported; it would grade Compass up for repeating it.
- **Catalyst grades** (`api/services/catalyst/brain_grades.py`): an earnings gap-up of 3%+ (env default) is labelled
  "Power Earnings Gap", and the EP label is prohibited on earnings gappers. Consistent with the owner's split (section 6).
- **Study bank** (members see these): glossary (`recall.glossary.json`): "a report so strong that the stock gaps above its
  whole base on huge volume" and "An EP wakes up a neglected stock; a PEG launches from a base already built."; vocab
  (`vocab.chart.json`): a gap that "holds its opening range and keeps going on heavy volume"; course F5.07: Tramondo's
  definition; the HVE lesson: "not a PEG (an earnings gap on big but ordinary volume)"; the Slingshot lesson: "it is
  mostly the way into a power earnings gap after its first pause". These fit each other, but none sets a number.
- **House brain template** (`docs/study/levels/brain_kb_2026-11-06.json`, "PEG"; machine-distilled, not the owner's
  words): primary entry "Buy the gap and hold on the day of the earnings gap"; secondary "Delayed reaction entry";
  volume "2x+ average minimum ... 5x+ is ideal"; max stop 8%; "should start small (baby position) and add on strength".
  The adds break A5 (one price, one stop, no adding) and the 8% cap is far over A13.
- **Trade plans** (`docs/study/TRADE_PLANS.md`): no PEG row. `study_trade.py` does not read the PEG detector.

## 6. UCT's own words

All quotes from UCT's public Substack (https://unchartedterritoryy.substack.com), checked word for word against the live
pages today, or from the owner's verdict log. I searched all 103 posts (2025-06-01 to 2026-11-08) for "PEG", "power
earnings", "earnings gap", "ER gapper", "earnings gapper", "day 1", "delayed reaction" and similar: 23 matches for "PEG" or "power earnings"
and 80 for "earnings gapper", "ER gapper" or "ER movers" (counting repeats). In Sunday Scans, "TSDR's Weekly Outlook & Watchlist" with its "Current Positions" and
"Charts Covered" lists is the owner's section (the 2026-11-08 issue heads it "Patrick (TSDR)'s Weekly Outlook &
Watchlist"); the opening and the earnings-calendar section carry no byline. Quotes keep the writers' spelling.

### 6.1 The owner's rulings (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

His words first; the reviewer's notes are marked as such.
- **PEG vs Gap Support.** On the AAPL gap bar: "Just a PEG". On mega-cap fixtures: "A lot of the are more PEGs but also gap
  support". On NVDA (2023): "Never really tested gap support". The reviewer's note (2026-10-26) records the split: the
  PEG is the post-earnings gap bar itself; Gap Support is a later bar that tests the gap-up low and holds it.
- **PEG vs HVE.** On HVE candidates: ASML 2024-01-24 "Again, just a PEG"; ORCL 2025-06-12 "Just a peg but it is an HVC";
  RL 2024-02-08 "Just a PEG and HVC. Not a real HVE"; DUOL 2023-11-09 "PEG"; GM 2025-10-21 "PEG/HVC". But FSLY 2026-02-12,
  an earnings day on 27x volume, "This. This is 100% A+" as an HVE. The bank's HVE lesson reads this as "not a PEG (an
  earnings gap on big but ordinary volume)".
- **PEG vs Kicker.** "This one is good but again, would just classify it as an earnings gapper vs a kicker candle.
  Sometimes earnings gappers can be kickers but mostly they are just earnings gappers." (TSN 2022-02-07); "Yeah no this is
  not one, this is plainly just an earnings gapper" (GRMN 2024-05-01); "I want them to be rarely earnings though because
  those are mostly just earnings gappers".
- **The Slingshot is the way in.** "Meant to be used to enter PEGS mostly but not", then "Not exclusively to PEGs but still
  good, I don't want to keep this" (COIN). NVDA 2024-03-01 Slingshot, kept: "This one is very good yes" (the reviewer:
  "earnings-gap drive, tight 4-day pullback").
- **A PEG with a later gap test.** META, the 2023-02-24 Gap Support fixture: "Such a great setup on this PEG there".
- **Gap preferences** (Gap Support rulings that apply to how a PEG ages): "I want the gap up low to hold or be slightly
  breached instead of the gap fill spot btw"; "Prefer holding open gap vs filling gap btw".
- **Earnings in the rulebook.** B22: "22 change it to 3 days and only hold if up 5R." D40: "40 yes." (as the verdict log
  records it; `sizing_rule.md` prints it "40, yes."; prefer growing sales and earnings, the chart first).

### 6.2 The owner in Sunday Scans (TSDR section)

What a PEG is, and how it sets up:
- TWLO, [2026-05-24](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb): "Classic PEG set up. Makes a 4 to 5
  day move following a notable earnings gap up. Pulls back, consolidates, holds the moving averages and actually it held
  the earnings day close perfectly." Then: "A little bit of basing here and this is in play and actionable at any point
  this week."
- TWLO, [2026-05-17](https://unchartedterritoryy.substack.com/p/sunday-scans-679): "Really awesome earnings gap up and
  build out. This is just a classic peg setup and I think it deserves a spot on your watchlist." And "Even if it get's
  one more contraction into the 20EMA, that would be awesome." Same issue, NVT: "Just a nice classic PEG setup in a very
  strong stock."
- OKTA, [2026-10-11](https://unchartedterritoryy.substack.com/p/sunday-scans-31b): "Classic and repeatable. ER gapper to
  highs, first of it's group already showing major strength." Then: "Alerted to the group at $162 post earnings and
  never invalidated that low. If still in, trim and trail and enjoy the ride." TEAM, same issue: "Earnings gapper,
  rallies to $200 and then bases. Pulls into and undercuts this range slightly closing with a strong lower wick. Remounts
  MAs and breaks highs."
- MXL, 2026-05-17: "Exhibit A: Why earnings gappers are so important. This MXL from the day three undercut of earnings
  day low at $50 has gone on to double".
- TEAM, [2026-08-23](https://unchartedterritoryy.substack.com/p/sunday-scans-807): "PEG (Power Earnings Gap) setup.
  Little long in the tooth near term and more observing."
- INTC (a news gap, not earnings), [2025-09-21](https://unchartedterritoryy.substack.com/p/sunday-scans-88a): "Can treat
  this also like a classic PEG (Power Earnings Gap). Any signal early next week is actionable."
- RMBS, [2025-08-03](https://unchartedterritoryy.substack.com/p/sunday-scans-726): "Earnings gapper on Tuesday. Would
  prefer higher volume on Day 1 move." and "Over $76.30 is an 18 month ATH breakout. Would prefer entry close to $70
  flat for RR." [2025-08-10](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f): "PEG watch looking for tap of
  $70 and buy signal there or break of $73.15 and ATH of $76.30".
- Added in the cold check (TSDR section, not quoted in the first version):
  - ANET, [2025-08-24](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa): "Classic post earnings gap setup and
    building around previous ATH. Held the 20EMA last week and remounted. Inside day would be awesome to avoid wedging up
    behavior."
  - TMDX, [2025-08-17](https://unchartedterritoryy.substack.com/p/sunday-scans-644): "Building a great range post earnings
    gap up and move after CEO purchased significant shares. Any buying signal near $125 via hammer candle, gap down and
    R/G move is actionable."
  - DOCN, then TWLO, AKAM and ONDS, [2026-05-31](https://unchartedterritoryy.substack.com/p/sunday-scans-6d8): "Next three
    charts are clean software flags and post earnings gap setups I will be tracking."
  - [2026-06-14](https://unchartedterritoryy.substack.com/p/sunday-scans-e95), after the VSXY chart and before CBRL: "A
    couple standard kick ass PEGs to end it here this fine Sunday."

When he buys:
- TWLO, [2026-05-17](https://unchartedterritoryy.substack.com/p/sunday-scans-679), the lines just before the "classic peg"
  note (cold check): "Highlighted this really awesome flag and pullback into the $190 spot and the 9EMA on Thursday. Gave
  a really nice opportunity on the undercut of the previous day and reclaim."
- [2025-08-10](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f): "I personally prefer letting the earnings
  gappers build out for a few days or weeks, so it may take time to get full margin again." And: "I don't mind buying
  day 1 and should quite frankly be more comfortable doing it. On certain stocks that I know the story and the company
  well then I have no issue with that."
- CRS, [2025-11-09](https://unchartedterritoryy.substack.com/p/sunday-scans-720) (Current Positions): "I have a baby
  position in CRS from the PEG (Post Earnings Gap) setup." And: "A classic PEG that I should and will take 10/10 times
  on a “Buy Day” like Friday." On trailing: "I am mostly a 20EMA kind of guy."
- FSLY, [2026-03-22](https://unchartedterritoryy.substack.com/p/sunday-scans-cab) (Current Positions): "A strong name then
  as an earnings gapper pulled into the HVC and the MAs. Bought with tight risk and let the trade play out." And: "I
  still have 60% of my position and am trailing the 20EMA for now while the 50SMA catches up."
- ESTC, [2026-08-30](https://unchartedterritoryy.substack.com/p/sunday-scans-d40): "Nice ER gapper that I will track.
  Faded off day 1 into $100 psyche level." Then: "In play for delayed reaction."
- DELL, [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "Dell had incredible earnings and a very
  positive day on Friday up 22%. This is a high ranking on my PEG list for this quarter".

The PEG list and why it matters:
- [2026-01-25](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb) (calendar section, no byline): "Making and
  tracking a “PEG list” is critical to keeping organized the notable earnings gappers for the quarter. It is without
  question that new high quality winners will establish themselves and start as earnings gappers."
- [2026-07-12](https://unchartedterritoryy.substack.com/p/sunday-scans-898): "Make sure to track ER GAPPERS for the
  quarter and make your PEG list! It will come in handy in finding the next winners of the market."
- [2025-08-03](https://unchartedterritoryy.substack.com/p/sunday-scans-726): "This week these setups were clear outliers
  and their tape traded drastically different than the rest of the market." and "Very often these ER gappers are the
  best performers for the quarter to come. Be ready for them!"
- [2026-05-10](https://unchartedterritoryy.substack.com/p/sunday-scans-68a): "Looking forward, I want to be focused on PEG
  setups, ER Gappers, RS stocks pulling back, and potential emerging groups with quality setups."
- [2026-11-08](https://unchartedterritoryy.substack.com/p/sunday-scans-70f): "Earnings gappers continue to be the main
  thing that stands out for now. Remember, the main winners from April were also big ER gappers."

Market timing:
- [2025-11-23](https://unchartedterritoryy.substack.com/p/sunday-scans-56d) (calendar section): "often coming out of
  corrections it is the recent ER gappers that have stellar performance on the other side."
- [2026-03-08](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf) (Current Positions): "If ya can't tell I am
  watching a lot of earnings gappers that put in exceptional volume and are now building out ranges." And: "Market
  corrections and earnings gappers during have a high tendency to go on to be big winners when the market finds it's
  footings." The same issue's opening: "Earnings gappers are always in play any time of day."
- Below the 200-day, [2026-05-24](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb) (Index & ETFs, on IGV):
  "Cannot justify stocks below 200SMA with so many other things acting properly right now at highs."

### 6.3 The unbylined openings and calendar sections

- [2025-11-09](https://unchartedterritoryy.substack.com/p/sunday-scans-720), opening, first person: "I love trading
  earnings gappers on day one." and "It is well within my strategy to look for these and position into a few of them
  each quarter."
- [2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1): "Remember to pay attention to not only the
  headline names but neglected stocks that report surprises and gap up."
- [2025-11-02](https://unchartedterritoryy.substack.com/p/sunday-scans-b99): "Now that we are passed that we can really
  dive in and get ready for some actionable ER movers and PEG setups."
- Added in the cold check (calendar sections, no byline): [2025-08-17](https://unchartedterritoryy.substack.com/p/sunday-scans-644):
  "Now we watch the Post Earnings Gappers setup for trades." [2026-02-16](https://unchartedterritoryy.substack.com/p/sunday-scans-ccf),
  after a beaten-down former IPO that "put in a perfect gap up on earnings and closed the week up 113%": "These and other
  non headline names can be very opportune for traders who like post
  earnings gappers."

### 6.4 Bracco

- [2026-04-26](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d): "You had huge power earnings gaps and EP's on
  some semiconductor names that have been dormant for years".
- [2025-08-03](https://unchartedterritoryy.substack.com/p/sunday-scans-726), on a failed one: "following a news failure
  event on the euphoric earnings gap ups in MSFT and META." (On our bars MSFT gapped 8.2% on 2025-07-31 and closed up
  3.9% near its low, DCR 0.07.)
- His "The Parabolic Short" post (the source of B26's parabolic exception) does not discuss PEGs.

### 6.5 Other UCT writers ("The Rest of the Week")

- Alex Jones Industrial Average, CAT, [2025-11-12](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045):
  "Really clean PEG (Post Earnings Gap) sequence happening in this name. Bull flagging right into the 9EMA. Ran Monday's
  low today and reversed." And [2025-11-26](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a):
  "Flagging in a Post Earnings Gap (PEG) setup and consolidating nicely."
- Manrav, TDC, [2025-11-19](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c): "Massive base and got a
  power earnings gap with a strong close and now flagging on daily. Watch for a push above 27.5 to get long."
- JERSACE, VRT, [2026-02-25](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24): "This structure is
  bullish and can looked at as a PEG setup." (a five-week rally, not a single earnings gap; a loose use of the word)
- The house brain files (`docs/study/levels/brain_kb_*.json`) also hold desk-log notes on day-one earnings gappers and
  delayed entries (for example passage 12555). They come from the Discord, so I do not quote them here; the owner can say
  whether any should become course text.

### 6.6 What UCT's usage adds up to

- "PEG" is expanded both as "Power Earnings Gap" and "Post Earnings Gap". "ER gapper" and "PEG" are used almost as one
  word ("track ER GAPPERS ... and make your PEG list!").
- The owner's "classic PEG" is a SEQUENCE: an earnings gap, a few days of follow-through, then a pullback or flag that
  holds the gap (the gap-day close or low) and the short averages; the buy is a signal out of that pause (on TWLO, "the
  undercut of the previous day and reclaim"; on TMDX, "hammer candle, gap down and R/G move"). This matches Stewie's swing
  method and Bulkowski's earnings flag more than the day-one EP.
- He also buys day one sometimes, and he keeps faded day-ones on watch as "delayed reaction" candidates.
- His trail is the 20-day EMA; he names the HVC (the gap day's close) as a level.

### 6.7 Candidate model examples (for his review; bar facts, not rulings)

The owner asked for examples to model. These are charts UCT itself called a PEG (or a near-PEG), with facts from the
app's own bars (`docs/study/setups/setup_examples.json`, marked *) or from the local yfinance bars (section 4.3). RVOL is
volume over the 50-day average. "Stop" is the gap-day close to the gap-day low. None is graded yet.

| # | Chart | Who called it | Gap | Day | RVOL | DCR | Trend | Stop | What happened next (local bars) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ASML 2024-01-24 | owner, "Again, just a PEG" | 6.2%* | +8.9%* | 7.6x* | 0.55* | over 50 and 200* | 2.5% | low held 20 sessions; reached 3R |
| 2 | ORCL 2025-06-12 | owner, "Just a peg but it is an HVC" | 7.7%* | +13.3%* | 5.3x* | 0.81* | over 50 and 200* | 5.5% | held 20 sessions; reached 3R (local bars; ORCL has no cached report dates, so it is not in the measured events) |
| 3 | RL 2024-02-08 | owner, "Just a PEG and HVC" | 11.2%* | +16.8%* | 5.2x* | 0.83* | over 50 and 200* | n/a | not in the local set |
| 4 | DUOL 2023-11-09 | owner, "PEG" | 10.6%* | +21.4%* | 5.4x* | 0.97* | over 50 and 200* | n/a | not in the local set |
| 5 | GM 2025-10-21 | owner, "PEG/HVC" | 9.9%* | +14.9%* | 5.4x* | 0.82* | over 200, under 50* | 6.4% | held 20 sessions; reached 3R |
| 6 | TSN 2022-02-07 | owner, "would just classify it as an earnings gapper" (chart "good") | 10.3%* | +12.2%* | 4.9x* | 0.89* | over 50 and 200* | n/a | not in the local set |
| 7 | META 2023-02-02 | owner, "Such a great setup on this PEG there" | 19.8% | +23.3% | 5.1x | 0.51 | 50-day under 200-day | 4.6% | low broke on day 5; +28.8% at 60 sessions |
| 8 | NVDA 2024-02-22 | owner, Slingshot after it, "very good yes" | 11.2% | +16.4% | 1.9x | 0.99 | over 50 and 200 | 5.5% | held 20; reached 3R |
| 9 | TWLO 2026-05-01 | owner, "Classic PEG set up" | 20.1% | +23.8% | 3.5x | 0.94 | over 50 and 200 | 6.7% | held 20; reached 3R |
| 10 | DELL 2026-02-27 | owner, "high ranking on my PEG list" | 13.1% | +21.9% | 4.8x | 0.94 | prior close under 200, closed over it | 8.1% | held 20; +106% at 60 sessions |
| 11 | OKTA 2026-08-27 | owner, "Classic and repeatable" | 23.6% | +28.6% | 5.3x | 0.89 | over 200, under 50 | 9.5% | held 20; reached 3R |
| 12 | CAT 2025-10-29 | AJIA, "Really clean PEG" | 6.4% | +11.6% | 2.4x | 0.72 | over 50 and 200 | 4.7% | low broke on day 4 |
| 13 | ANET 2025-08-06 (added in the cold check) | owner, 2025-08-24, "Classic post earnings gap setup" | 13.3% | +17.5% | 2.7x | 0.87 | over 50 and 200 | 3.8% | low broke on day 6 (he notes it "Held the 20EMA"); +14.2% at 60 sessions |
| fail | MSFT 2025-07-31 | Bracco, "news failure event" | 8.2% | +3.9% | 2.8x | 0.07 | over 50 and 200 | 0.3% | low broke; -4.5% at 20 sessions |

(Cold check: every local-bar fact in rows 1, 2, 5 and 7 to 13 and the MSFT row was recomputed from the bars and matches;
every starred fact matches `setup_examples.json`, whose RVOL is volume over the 50-day average.)

Named by the owner as PEGs but not in the local bars: CRS (Nov 2025), NVT (May 2026), TEAM (Aug 2026), MXL (2026),
FSLY (Feb 2026, ruled an HVE), RMBS (Aug 2025), TMDX (Aug 2025), DOCN (May 2026). Note how many of his own picks have a gap-day-low stop over 3% and a
close more than 10% over the 10-day (sections 4.3 and 7).

## 7. How it fits the owner's account rulebook (section 9)

| Rule | What it means for a PEG | Conflict? |
|---|---|---|
| A3, F62 stop a few cents under the day's low or prior day's low | Day one: under the gap-day low. First pause: under the trigger day's (or prior day's) low | No conflict with the sources' gap-day-low stop; conflicts with Morales's 2-3% porosity and with our scanner (1.5% under the gap low) |
| A4 the stop only moves up | Morales's porosity widens the line below the low | **Yes**, if porosity is taught; no if the stop is the low |
| A5 one price, one stop, no adding | Stockbee adds when volume comes in; Stewie starts small on gap-and-go; the house brain says "baby position ... add on strength" | **Yes** with those sources; the house rule wins |
| A13 stop usually within about 3% | Gap-day-low stops were wider than 3% in 45% of the BASE earnings gaps (gap 4%+, 1.5x volume, liquid), 85-88% of the strong-close ones; our scanner's own stop 100% | **Yes, often.** The setup's natural stop is wide. A5 shrinks the size; or buy the pause |
| B19, E51, F63 trims at 3R and 5R, breakeven at 2R-5R | Fine; the measured edge comes from the few big runs, so do not trim too early | No |
| B20 gap against the stop | A gap down through the gap-day low after a failed PEG: the first 30-minute low, out past 2R | No |
| B22 no buys 3 days before a report; hold through only if up 5R | The PEG buy is after the report: allowed. The next report (about a quarter later) forces an exit unless up 5R. The app's "Power Earnings Gap" starter scan lists stocks before a report | **Yes for the starter scan**, not for the setup |
| B23 $10 and $20M a day | Our scanner's floor is $2 and $10,000 | **Yes for the scanner** |
| B26 no longs under the 200-day | 38% of the BASE earnings gaps started under the 200-day; about a third of those closed back over it on the gap day (DELL 2026-02-27, PLTR 2026-08-04) | **Open question**: is a gap that closes over the 200-day allowed? |
| C28 no buying more than 4% over the buy point | On day one the buy point must be the opening range high or the prior high, not the base pivot (the open was 4%+ over the prior 50-day high in 26-54% of gaps) | Only if the buy point is the base pivot |
| C29 skip a long more than 10% over its 10-day | At the gap-day close, 33% of earnings gaps, 55% of strong-close ones, 64% of "leader PEGs" and 68-69% of 8%+ or 10%+ gaps are over that line. Every owner example in 6.7 from TWLO to OKTA was | **Yes, the biggest conflict.** Day-one buys of big PEGs are mostly forbidden; the pause buy is usually allowed |
| C31 RS 80+ leaders (except parabolic and mean reversion) | Fits the leader PEG; a neglected EP may have a low RS before the gap and a high one after | Open: measure RS before or after the gap? |
| C33 time stop: under 1R after 10 sessions | A day-one buy that bases for 2-3 weeks gets sold; the owner prefers letting them "build out for a few days or weeks" | Some; another reason to buy the pause |
| D40 growing sales and earnings, chart first | The earnings beat is the catalyst | No |
| D47 shorts are the long setups reversed | Morales's shortable gap-down; but 59% of earnings gap-downs start above the 200-day (B26) and our sample's median 20-day return after them was +0.8% | See 8.8 |
| E52 trail the 10-day (fast) or 21-day (steadier) | Qullamaggie 10/20-day; Morales 10-day after seven weeks else 50-day; the owner trails the 20-EMA | Choice, not conflict |
| E57 market orders | Day-one ORH buys and pause triggers as market orders | No for the proposed entries; **yes** with Stewie's gap-and-go ("Limit orders are absolutely necessary") |
| E58 no new buys outside regular trading hours (added in the cold check) | Bonde: "If I find a good EP I buy immediately in pre or post market."; Stewie's gap-and-go "usually starts in the after hour session" | **Yes** with those two entries; a house day-one buy waits for the open (the ORH buy in 8.2 already does) |
| F65 market reading | Bulkowski: bull markets; the owner: ER gappers coming out of corrections | No |

## 8. Proposed rules for our course

Each line is measurable. "PEG day" = the gap day.

### 8.1 What it is

1. **Catalyst**: a quarterly earnings report (with or without guidance); the PEG day is the first regular session after
   it. [source consensus: Stewie, Tramondo, Bonde, Bulkowski; UCT] A gap on other news is an EP or a News Gapper unless
   the owner rules otherwise (the INTC note). [my proposal; owner question 2]
2. **Gap**: the PEG day opens at least 4% over the prior close AND at least 0.75 x the 40-day ATR over it. [my proposal,
   combining Bonde's 4% (his 2014 scan is 4% close over close and his 2007 watchlist a "breakout on earnings day of 4%
   plus", neither an opening-gap rule) and Morales/Kacher (0.75 ATR)] Options: 4% (keeps every example in 6.7, including
   ASML 6.2% and CAT 6.4%; the ten PEG examples with local bars gapped 2.9 (CAT) to 6.6 (META) times their 40-day ATR, so
   the ATR floor never binds on them [measured]); 8% (the scanner;
   drops ASML, ORCL, CAT); 10% (Qullamaggie's EP had the best measured P(3R), 41% in Table B [measured], but this floor
   drops ASML, ORCL, GM and CAT from the examples in 6.7). Recommend 4% + 0.75 ATR, with 10%+ as an A-grade cue.
3. **Volume**: PEG-day volume at least 1.5x the 50-day average [originator: Morales/Kacher]; 3x or more for an A
   [source consensus: Bonde, Wagner, Tramondo]. Where it meets the HVE: the owner's HVE is volume that dwarfs everything
   before it, often on a lesser-known name (FSLY, 27x, "100% A+"); an earnings spike on an established name stays a PEG
   even at a one-year volume record (ASML 2024-01-24, 7.6x the 50-day average and 2.7x its biggest volume day of the prior
   year, "Again, just a PEG"). [UCT: the owner's rulings; facts from `setup_examples.json`; owner question 4]
4. **Close**: the PEG day closes green (close at or over the open), over the prior day's high (the gap still open), and in
   the top half of its range (DCR 0.5+); A grade in the top quarter. [originator: Stewie (a close "at or near HIGHS" is
   ideal; to "reverse and close in the red is NOT" a PEG; he does not say whether red means under the open or under the
   prior close); Qullamaggie (a fade "is not an EP"); source: Tramondo ("best is a close near highs"), Wagner (no gap
   fill); UCT: Manrav "strong close". The green-over-the-open test, the prior-high test and the 0.5 and 0.75 cut-offs are
   my proposal; no source gives a number.] A faded PEG day is not a PEG; it can become a "delayed reaction" watch [UCT:
   ESTC].
5. **Location**: the PEG-day close is over the 200-day SMA [house rule B26; owner question 9 on gaps that start under it];
   preferred over a rising 50-day [my reading of the originators Morales/Kacher, "uptrend or constructive consolidation";
   they name no average]. Not up more than
   30% in the 65 sessions before the gap, for an A [my proposal from Bonde, Qullamaggie and the measured hint in 4.3].
6. **Liquidity**: price $10+ and $20M+ a day before the gap. [house rule B23]
7. **Fundamentals**: growing sales and earnings, a beat, and ideally a raise; a grade cue, not a gate (we cannot check it
   in the app). [house rule D40; Qullamaggie; Bonde]

### 8.2 The buy

Two entries, named separately. [my proposal; the owner chooses, question 6]
- **A. The pause buy (default).** After the PEG day, wait 2 to 10 sessions for an orderly pause: a flag, inside day,
  tight range or pullback to the 9-EMA/10-day that holds the PEG-day low (A grade: holds the PEG-day close). Buy at
  market when price trades over the pause high, or on the Slingshot trigger (the first close back over the 4-day EMA of
  the highs). [UCT: owner's TWLO, TMDX and CRS notes, "Meant to be used to enter PEGS mostly"; originator: Stewie 5-7
  days; source: Bulkowski's earnings flag, Wagner's inside day] Why default: a day-one buy at the gap-day close breaks C29 in a third
  to two thirds of cases and A13 in about half to nine tenths [measured, Table C]; a pause entry sits closer to its own
  low and to the 10-day (I did not measure the pause entry itself); and it is how the owner describes his "classic PEG".
- **B. The day-one buy (A+ only).** Buy at market over the 5-minute or 30-minute opening range high on the PEG day.
  [originator: Qullamaggie's ORH (his are the 1-, 5- or 60-minute highs), Bonde (buys on the day); source: Morpheus
  5-minute high; the 30-minute option is house usage (the Kicker plan's day-1 30-minute range break, B20's 30-minute
  bar), not an outside source; UCT: "I love trading earnings gappers on day one"] Only when the day's low gives a stop
  within about 3% and the price is not more than 10% over the 10-day at the buy. [house rules A13, C29] Never before the
  open: no pre-market or after-hours buys (E58), unlike Bonde and Stewie's gap-and-go. [house rule]
- **Order and chase**: market order (E57); not more than 4% over the trigger (C28). [house rule]

### 8.3 The stop

- Pause buy: a few cents under the low of the trigger day or the pause, whichever the trade plan names; never wider than
  under the PEG-day low. [house rules A3, F62; UCT Slingshot dossier; originator: Bonde 2-day low]
- Day-one buy: a few cents under the PEG day's low so far. [originator: Qullamaggie, Bonde's 2017 reply; house rule F62]
- If that stop is more than about 3% from the buy, size down by the formula (A5) or skip; no porosity, no widening. [house
  rules A4, A5, A13] Not Morales's 2-3% slack. Not the scanner's gap-low-minus-1.5%.

### 8.4 Trims and trail

- House defaults: a third at 3R, a third at 5R (at the open if it gaps past, F63), breakeven by 2R to 5R, trail the rest
  under the 10-day (most PEGs are fast movers) or the 21-day. [house rules B19, E51, E52] The owner's own habit is the
  20-EMA; the course can name it as his. [UCT]
- Sell before the next earnings report unless the trade is up 5R. [house rule B22]
- Time stop: under 1R after 10 sessions, sell. [house rule C33]

### 8.5 What invalidates it

- Before a buy: the gap fills (a trade at or under the prior close) [Wagner; Bulkowski: breakaway gaps almost never fill in a
  week]; or a daily close under the PEG-day low [Bulkowski's reading of Morales/Kacher; UCT: OKTA "never invalidated that
  low"]; or the pause turns into a drift of lower highs and lower lows for 5+ sessions [my proposal].
- A slight undercut of the PEG-day low that closes back over it is not an invalidation; it is the owner's Gap Support
  setup. [UCT: Gap Support rulings; MXL "day three undercut"]

### 8.6 Best market conditions

- A Green or Yellow market reading (F65), especially the first earnings season after a correction. [house rule; UCT:
  "coming out of corrections it is the recent ER gappers that have stellar performance"; Bulkowski: bull markets]
- Earnings season itself: the setup comes in four windows a year. Keep a PEG list each quarter. [UCT; Bonde 2007 watchlist]

### 8.7 Common mistakes

1. Calling any earnings pop a PEG: a fade into the close, a red close, or light volume is not one (MSFT 2025-07-31).
   [Stewie; Qullamaggie; UCT: Bracco]
2. Chasing day one far over the 10-day or the opening range (C28, C29), with a stop too wide for the size.
3. Holding through the next report (B22), or buying in the 3 days before a report (B22; the app's starter scan lists
   names up to 7 days before one).
4. Treating an exhaustion gap after a huge run as a PEG [Bonde: "it is exhaustion gap"; Qullamaggie: later EPs fail more].
5. Buying a gap in a downtrend under the 200-day (B26).
6. Adding to it (A5), or widening the stop to the gap low after buying the pause (A4).
7. Mixing it up with the Kicker (rarely earnings), the HVE (record volume) and Gap Support (the later test). [UCT rulings]

### 8.8 The short mirror

**Recommend: no PEG short taught for now.** [my proposal] Reasons: the owner calls a one-day earnings collapse off the top
"just an earnings breakdown", not his Bear Gap setup (verdict log, bear-gap pass 1); 59% of earnings gap-downs start above
the 200-day, where B26 forbids shorts [measured]; and our sample's median 20-day return after them was +0.8%
[measured]. Option: a "power
earnings gap down" short only below the 200-day, mirrored stop over the gap-day high (Morales's shortable gap-down), if
the owner wants it (question 13). (Cold check: the name's originator does use a mirror. Stewie's "BEARISH Power Earnings
Gap" (2019, section 3.1) is a gap down after poor earnings that he shorts after "a weak multi-day, low volume bounce",
not on the gap day itself.)

## 9. Grading

The owner rules that grading is discretionary (E50), so these are cues, not a checklist. Each cue names its source.

**A+ looks like:**
- Blowout numbers: triple-digit or high double-digit growth, a big beat and a raise. [Qullamaggie, Bonde]
- Gap 10%+ that holds all day; volume 3-5x or more, most of it early. [Qullamaggie, Tramondo, Bonde]
- Close at or near the high (DCR 0.75+), over the prior high, a new 52-week or all-time high, out of a base of a month or
  more. [Stewie, Tramondo, Wagner]
- Not extended into the report (flat or quiet for 3-6 months, or a first gap after a base). [Qullamaggie, Bonde]
- First of its group to move; a leading or emerging theme. [Morales "leading stocks"; UCT: OKTA "first of it's group"]
- A tight pause on lighter volume that holds the PEG-day close; a buy with a stop within about 3%. [Bulkowski "tight
  congestion"; Wagner inside day on lighter volume; UCT: TWLO "held the earnings day close perfectly"; house A13]
- A Green market. [F65]

**B- looks like:**
- Gap 4-6% on 1.5-2x volume; close mid-range; a mega-cap with many analysts. [Bonde: covered stocks "do not do as well"]
- A late gap after a 30%+ run, or a second or third gap in a row. [Qullamaggie; Bonde exhaustion gaps]
- Loose, deep pause that undercuts the PEG-day low; stop wide, size small. [Bulkowski; house A5]
- Under a falling 50-day or near the 200-day; a Yellow or Orange market. [Morales; house B26, F65]

## 10. Questions for the owner

1. **One setup or two?** Are "PEG", "earnings gapper" and "ER gapper" the same setup? (a) Yes, one setup named Power
   Earnings Gap; (b) PEG = the strong-close, high-volume subset of earnings gappers; (c) keep the Model Book's separate
   "News/Earnings Gapper" card for non-earnings news gaps. Also: "Power" or "Post" Earnings Gap?
2. **News gaps.** You treated INTC's news gap "like a classic PEG". (a) Earnings only; (b) earnings or major company news;
   (c) news gaps go to EP / News Gapper.
3. **Gap floor.** (a) 4% + 0.75 ATR (recommended); (b) 8% (the scanner today); (c) 10% (Qullamaggie); (d) no number, "eyeball".
4. **Volume floor.** (a) 1.5x the 50-day (recommended, with 3x for an A); (b) 2x; (c) 3x. And where does a PEG become an HVE?
5. **The close.** (a) top half and over the prior high (recommended); (b) top quarter; (c) green only; (d) none. Is a
   faded day one a "delayed reaction" setup of its own?
6. **The house entry.** (a) the pause buy as default plus day-one for A+ only (recommended); (b) pause only (Slingshot,
   flag, inside day); (c) day one only (ORH); (d) all named variants, member's choice. Which pause trigger: the pause high,
   the Slingshot close, or the 30-minute opening range the next day?
7. **C29 on the PEG day.** A close more than 10% over the 10-day happens on most big PEGs (TWLO, DELL, OKTA, META). (a)
   C29 applies: no day-one buy then (recommended); (b) PEG day exempt, like parabolic trades; (c) measure C29 against the
   10-day before the gap.
8. **The stop.** The PEG-day-low stop is wider than 3% in about half of earnings gaps. (a) size down by A5, skip if the
   position gets too small (recommended); (b) skip any PEG with a stop over 3%; (c) allow Morales's 2-3% slack under the
   low (breaks A4).
9. **Gaps that start under the 200-day.** DELL 2026-02-27 and PLTR 2026-08 started under it and closed over it. (a)
   allowed if the PEG day closes over the 200-day; (b) only if the prior close was over it; (c) only over a rising 200-day.
10. **RS 80+ (C31).** Measured (a) on the PEG day's close; (b) before the gap; (c) not required for PEGs.
11. **Next report.** Confirm B22 for PEGs: sell before the next report unless up 5R.
12. **The trail.** (a) 10-day for fast PEGs, 21-day otherwise (E52); (b) your 20-EMA; (c) Morales's 7-week rule.
13. **Short mirror.** (a) none (recommended); (b) an earnings gap-down short below the 200-day only; (c) Stewie's version:
    short the weak, low-volume bounce after a bearish earnings gap, below the 200-day only.
14. **Fix the app?** (a) scanner: house stop, earnings check, close test, 200-day and B23 gates, correct attribution; (b)
   the "Power Earnings Gap" starter scan (it lists stocks before a report); (c) the Model Book glyph (no gap drawn); (d)
   the Compass test answer that credits Minervini; (e) the voice-KB definition. Which, and in what order?
15. **Model examples.** Which of the 13 charts in 6.7 go in the gallery, and which ones of CRS, NVT, TEAM, MXL, RMBS,
    TMDX, DOCN should be added from the app's bars?

## 11. Sources

Read 2026-11-09 unless noted. "Saved" = downloaded and checked by script; "tool" = read through the page-reading tool.

**Originators**
| Source | Publisher, author, date | Reliability |
|---|---|---|
| [What is a "Power Earnings Gap?" & How to Trade it!](https://www.artoftrading.net/post/what-is-a-power-earnings-gap-how-to-trade-it) | Art of Trading, Trader Stewie, 24 Sep 2021 (updated 1 Oct 2023); saved | Originator of the name; a paid-service blog; no numbers, no stop |
| [Same post, 2019](http://theimpatienttrader.blogspot.com/2019/02/what-is-power-earnings-gap-and-how-to.html) | Art Of Trading blog (Blogspot), Stewie, 19 Feb 2019; tool, saved in the cold check | Earliest definition post found |
| [How We Traded This Week's Market](http://theimpatienttrader.blogspot.com/2018/12/how-we-traded-this-weeks-market.html) | Art Of Trading blog, Stewie, 9 Dec 2018; saved (cold check) | Earliest dated use of the name found ("my PEG(Power Earnings Gap) list") |
| [Bearish Rising Wedge Pattern For Shorting](http://theimpatienttrader.blogspot.com/2019/09/bearish-rising-wedge-pattern-for.html) | Art Of Trading blog, Stewie, 23 Sep 2019; saved (cold check) | Originator's short mirror, the "BEARISH Power Earnings Gap" |
| [3 Trading Strategies for Power Earnings Gaps!](https://www.artoftrading.net/post/3-trading-strategies-for-power-earnings-gaps) | Art of Trading, Trader Stewie, 26 Feb 2023; saved | Originator; entries only |
| [In the Trading Cockpit with the O'Neil Disciples, publisher preview](https://api.pageplace.de/preview/DT0400.9781118287293_A23567645/preview-9781118287293_A23567645.pdf) | John Wiley & Sons, Gil Morales and Chris Kacher, copyright 2013; saved | Originator of the BGU; strong |
| [Glossary & Trading Methods](https://theowltrader.com/glossary-trading-methods/) and [About](https://theowltrader.com/about/) | TheOWLTrader.com, Gil Morales; saved | Originator; current |
| Stockbee posts: [2006](https://stockbee.blogspot.com/2006/11/gaps-and-traps.html), [2007 earnings](https://stockbee.blogspot.com/2007/03/how-to-trade-earnings.html), [2007 Bulkowski](https://stockbee.blogspot.com/2007/04/earnings-and-bulkowski.html), [2010 EP](https://stockbee.blogspot.com/2010/02/what-are-episodic-pivots-and-how-to.html), [2014 process](https://stockbee.blogspot.com/2014/07/my-process-flow-for-episodic-pivots-ep.html), [2014 earnings trades](https://stockbee.blogspot.com/2014/07/few-good-earnings-trade-can-change-your.html), [2025 young EPs](https://stockbee.blogspot.com/2025/09/find-young-episodic-pivots.html) | Stockbee, Pradeep Bonde; saved | Originator of the earnings EP; some rules are in his comment replies |
| [3 TIMELESS setups](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/) (8 Jan 2021); [How to master a setup: Episodic Pivots](https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/) (2 Nov 2021) | qullamaggie.com, Kristjan Kullamägi; saved | Originator of his EP version; strong |

**Educators, managers, data**
| Source | Publisher, author, date | Reliability |
|---|---|---|
| [Power Earnings Gap (PEG)](https://www.tramondo.ch/en/power-earnings-gap/) | Tramondo Investment Partners AG, market note, 11 Aug 2021; saved | A regulated manager's own rules; credits Stewie |
| [How To Trade Breakaway Gaps](https://morpheustrading.com/blog/breakaways-gaps/) | Morpheus Trading Group, Deron Wagner, 6 Sep 2018; saved | Established educator |
| [Gap Trading Strategy: 5 Top Ways](https://morpheustrading.com/blog/gap-trading-strategy/) | Morpheus Trading Group, byline "Rick", 27 Oct 2022; saved | Established educator; marketing tone |
| [Earnings Flag](https://thepatternsite.com/earnflag.html), [Good Earnings Surprise](https://thepatternsite.com/earnsgood.html), [Gaps](https://www.thepatternsite.com/gaps.html), [Gauging Gaps](https://www.thepatternsite.com/GaugingGaps.html), [Kacher-Morales Setup](https://www.thepatternsite.com/KacherMorales.html), [Glossary](https://thepatternsite.com/glossary.html) | ThePatternSite, Thomas Bulkowski; tool, plus saved copies from the Episodic Pivot run | Measured statistics, idealized "perfect trades". **The site states: "This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems".** Cited with links and short quotes only |
| [Episodic Pivot / Power Earnings Gap / Buyable Gap Up Explained](https://www.tradingsim.com/blog/episodic-pivot-power-earnings-gap-buyable-gap-up-explained) | TradingSim, John McDowell (reviewed by Al Hill), 18 Nov 2021, page updated 31 Mar 2026; saved | Secondary; two of its numbers do not match the originals |
| [Earnings Gap Ups](https://www.tradingview.com/script/KWTJ9jeC-Earnings-Gap-Ups/) | TradingView, Amphibiantrading, 15 Dec 2024; tool | Script description; cites research I could not find |

**Studies**
| Source | Publisher, author, date | Reliability |
|---|---|---|
| [Momentum Strategies, w5375](https://www.nber.org/papers/w5375) | NBER, Chan, Jegadeesh, Lakonishok, Dec 1995; saved abstract | Academic; older data |
| [Rest in Peace Post-Earnings Announcement Drift](https://ideas.repec.org/a/now/jnlcfr/104.00000122.html) | Critical Finance Review (RePEc listing), Charles Martineau, 2022; saved abstract | Peer-reviewed; tests the surprise number, not chart setups |
| Our test, section 4.3 | This dossier; yfinance bars and the repo's earnings-date cache | Survivor-biased universe, daily bars only |

**UCT and house**
| Source | Reliability |
|---|---|
| UCT Substack, 26 posts read live and all 103 searched: sunday-scans-ffb, -679, -31b, -807, -88a, -726, -f6f, -720, -cab, -d40, -6a8, -7fb, -898, -68a, -70f, -56d, -dcf, -2a1, -b99, -f2d, -e95, -da5; the-rest-of-the-week-045, -22a, -72c, -b24. Cold check: all 103 downloaded again, the counts in section 6 confirmed (23 and 80), and sunday-scans-ffa, -644, -6d8 and -ccf added | UCT's own public words; the owner's section identified by heading. The four Rest of the Week dates above are the UTC dates of Substack's timestamps; in New York each post went out the evening before (-045 is stamped 00:26 UTC on 12 Nov 2025, which was 11 Nov in New York; -72c, -22a and -b24 likewise 18 Nov, 25 Nov and 24 Feb) |
| `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | The owner's words (owner_words); the reviewer's notes are not his words |
| `docs/study/sizing_rule.md` section 9; `docs/study/TRADE_PLANS.md` | House rules (closed 2026-11-09) |
| `api/services/pattern_engine/detectors/uct/power_earnings_gap.py`, `episodic_pivot.py`, `uct_ep_v2.py`, `primitives/liquidity.py`, `api/routers/patterns.py` | Our code, read in full where cited |
| `app/src/pages/modelbook/setupCatalog.js`, `app/src/pages/modelbook/SetupsView.jsx`, `app/src/constants/setupGroups.js`, `app/src/components/chart/engine/ast/starterScans.json`, `closedTable.json` | Our app |
| `api/data/voice_kb/trading_principles.json`, `api/services/compass_eval/golden_set.json`, `api/services/catalyst/brain_grades.py`, `api/services/pattern_vision/rubrics.py`, `eval.py` | Our app; unsourced definitions flagged |
| `docs/study/levels/brain_kb_2026-11-06.json`, `docs/study/levels/dossiers/slingshot.md`, `gap_support.md`, `hve.md`, `docs/study/levels/external_research.md` | House research; the brain template is machine-distilled |
| `docs/study/bank/*.json`, `docs/study/courses/F5/F5.07.json`, `docs/study/setups/setup_examples.json`, `earnings_dates_cache.json` | Member-facing text and the app's bar facts |

**Could not open (nothing quoted from them):** the TraderPlanet buyable gap-up article (HTTP 500); the O'Reilly copy of the
Cockpit book's chapter 6 (403); IBD's breakaway-gap column via inkl (403); JSTOR pages for Ball and Brown (1968) and
Bernard and Thomas (1989) (blocked); TraderLion pages and sitemap (403). In the cold check, TraderLion's "Trade
Opportunity Case Study of the Week: CRS Earnings Gap Day 1 Entries" (Oct 2025, found by search) and the IBD breakaway-gap
repost on inkl both still returned 403 to a plain download and to the page-reading tool; a search-engine summary of the
IBD piece was not used. The research the TradingView script credits (John Pocorobba and Jason Thompson) was searched for
again and not found. *Trade Like an O'Neil Disciple* (2010) itself
was not read; only the later book's account of it. Mark Minervini's books were not read; I found no source tying him to
the PEG.

## Removed in checking

Cold check of 2026-11-09. What was confirmed: every outside quote (Stewie, Tramondo, TradingSim, the Cockpit preview,
Morales's glossary, Stockbee, Qullamaggie, Morpheus, Bulkowski, the TradingView script, NBER, Martineau) is on the page
credited, word for word, and says what the dossier says it says; every UCT Substack quote is on the post named, in the
section named (TSDR's, Bracco's, an unsigned opening or calendar section, or the named Rest of the Week writer); every
owner quote is in `owner_verdicts.jsonl` with the ticker, date and setup given; the scanner summary matches
`power_earnings_gap.py`, `liquidity.py`, `episodic_pivot.py` and `patterns.py`; the Model Book, journal-tag, vision-map,
starter-scan, voice-KB, Compass, catalyst-grade, bank and brain-template quotes are in those files; the rule numbers in
sections 7 to 9 say what `sizing_rule.md` section 9 says; Tables A, B and C, the period split and the baseline reproduce.

**Removed** (wrong, or not supported by its source):
1. "37% of its fires in our test had no report near the gap" (5.2) and "Only 258 (63%) were earnings-linked by the
   cache; 149 were not" (4.3). 89 of the 149 were on 30 stocks with no report dates in the cache. Replaced with 60 of 318
   (19%) on stocks with known dates.
2. "Stewie's 19 Feb 2019 post is the earliest dated use I found" (section 11) and "Short mirror: none" for Stewie (3.9).
   His own blog uses the name on 9 Dec 2018 and describes a "BEARISH Power Earnings Gap" on 23 Sep 2019.
3. "(2014 reply)" for "Yes. It is normally low of the EP day." The reply is dated 31 Jan 2017 (3.4, 3.9, 3.10, 8.3).
4. D40 quoted as "40, yes." from the verdict log: the log has "40 yes."; the comma version is `sizing_rule.md`'s.
5. ORCL 2025-06-12 "not in the local set" (6.7): its bars are there (it has no cached report dates). Row filled in.
6. "every example measured in 6.7 gapped 2.9 to 6.8 times its 40-day ATR" (8.1.2): 6.8 is the failed MSFT example; the
   PEG examples run 2.9 to 6.6. Also "keeps all his own examples, including ... CAT" (CAT is AJIA's call, not his).
7. "Bonde 2014 (4%)" as the source of an opening-gap floor (8.1.2): his 4% is a close-over-close scan.
8. "the last third trails a close under the 10-day" (Table B): the test sells everything still held on that close once
   3R is reached.
9. Originator tags on outside sources that are not originators: Bulkowski and Wagner (8.2 A), Morpheus and a 30-minute
   opening range credited to Qullamaggie and Stockbee (8.2 B; his ranges are 1, 5 and 60 minutes), Wagner (8.1.4),
   Morales/Kacher for a "rising 50-day" they do not name (8.1.5). Re-tagged.
10. "buying from it breaks B22" (5.3) and "buying the week before a report" (8.7): B22 covers the 3 days before a report;
    the starter scan's window is 7 days.
11. "swing 20-30%" as Morpheus's exit rule (3.9): it is one SNAP example, not a rule.
12. "he calls his best method" (section 2): replaced with Bonde's own words.

**Added** (missed by the first pass): the book says Kacher created the buyable gap-up in 2005, and its example of trading
one before they had rules is AAPL's October 2004 earnings gap (3.3); which parts of the book the preview holds (3.3);
Morales's glossary hold rule (3.3); Bonde's 2006 "20% plus" gap and volume numbers and his 2007
adding rule (3.4); Stewie's after-hours limit-order gap-and-go and his short mirror (3.1); house rule E58 and E57 conflicts
(section 7, 8.2); the router's "Bonde's signature" wording (section 2); the scanner's own admission that its 8% comes from
the EP post, and what its "gap height" is (5.1, 5.2); five more UCT lines (ANET, TMDX, DOCN, VSXY/CBRL, two calendar
notes) and the owner's TWLO "undercut of the previous day and reclaim" buy (6.2, 6.3, 6.6); ANET as example 13 (6.7).

**Still unverified** (kept, flagged): the gap-down count of 1,238 (no saved script; a recount found 1,272 with the same
percentages); the "machine-distilled" description of the brain template (not traced in this check);
the TradingView script's credited research; anything on Twitter, TraderLion, IBD and in the 2010 book.

## 12. Examples (from our data)

Added 2026-11-09 from the local sandbox's daily bars (3,897 names, 1984-2026) and its report-date cache (Yahoo plus SEC
8-K Item 2.02, complete from about 2005). Scan script: `_study-resume/scratchpad/setups/21-power-earnings-gap/peg_scan.py`
(scratch, not in the repo); charts and the full hit list in its `final/` folder.

**The rule scanned** (section 8 plus the house rules, in one paragraph). A PEG day is the first regular session after a
quarterly report (the cache's reaction day; a gap on a day with no report in the cache is not counted, so the scan starts
2005-01-01 and the 467 liquid names with no cached report dates yield nothing), whose open is at least 4% over the prior
close and at least 0.75 x the 40-day ATR over it, on volume at least 1.5x the 50-day average, closing green (close at or
over the open), over the prior day's high and in the top half of its range, over the 200-day SMA, on a stock that was $10+
and traded $20M+ a day before the gap (B23). The buy is the **pause buy** (8.2 A): a pause of at least 2 sessions after
the PEG day that holds the PEG-day low and never trades back to the prior close (no gap fill), then a market order the
first day price trades over the pause high (if it opens above it, the open), within the 4% chase limit (C28), not more
than 10% over the 10-day SMA (C29), over the 200-day (B26), trigger within 11 sessions of the gap. The stop is 5 cents
under the lower of the trigger day's and prior day's lows (the trigger day's low alone if that is wider than 3%), and the
trade is skipped if the stop is wider than 3% (A13). The day-one buy (8.2 B) cannot be seen on daily bars, so it is proxied
by the PEG-day close when a stop under the PEG-day low is within 3% and the close is within 10% of the 10-day; these are
counted separately below and none of the ten examples uses it.

**Base rate.** 2,630 of 2,630 liquid names scanned (full coverage; 270 seconds). 1,516 hits from 2005 to 2026: **31.0%
reached 3R and 20.0% reached 5R before the stop**; 80.7% were stopped within the 60-session window (the rest ended the
window open), and the median best excursion was 1.1R. By entry: pause buys 1,086 hits, 30.9% to 3R, 20.7% to 5R; day-one
proxies 430 hits, 31.2% to 3R, 18.1% to 5R. The grading cues the course proposes, on this sample: gaps of 10%+ (122 hits)
34.4% / 23.0%; volume 3x+ (899) 30.7% / 19.9%; not up more than 30% in the prior 65 sessions (1,446) 31.3% / 20.2%. So the
volume and run-up cues did not move the rate here and the gap size moved it a little. The median winner took 10
sessions to reach 3R. **Caveats:** a fixed stop with no trims, no breakeven move, no trail and no time stop, scored over
60 sessions from the day after the buy, with a same-day stop-and-target tie going to the stop; the window can run into
the next report, which house rule B22 would sell before (Genpact 2024-08-15, cut below, took its "15R" from the next
earnings gap on day 60); the stop is the plan's default, not a sized one; and the report-date cache's time of day can be
wrong (the cache puts PANW's 2020-11-16 report "before the open", which would make the market-wide gap of 16 Nov its PEG
day; PANW's own reaction bar is 17 Nov, so that hit was dropped from the examples, and the report time should be checked
before any gap is called a PEG). Prices are split-adjusted, so the dollar levels below are on today's share basis
(AMZN 2017 at $56).

**The ten examples** (all pause buys; all earnings gaps per the cache, report time as cached; "pause" = sessions between
the PEG day and the trigger; "best" = the best excursion before the stop, in R, inside the 60-session window).

| # | Ticker | Report (time) | PEG day | Buy day | Gap | ATR40 | Vol | Close in range | Pause | Buy over | Stop | Stop % | Best | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | BIDU | 2010-02-09 (after close) | 2010-02-10 | 2010-02-16 | +8.5% | 2.6x | 3.0x | 0.95 | 2 days, 0.3% deep | 48.93 | 48.20 | 2.1% | 27.7R | Four-month flat shelf, the gap clears it, two tight days, then a 10-week run up the 10-day EMA. |
| 2 | ILMN | 2013-04-22 (after close) | 2013-04-23 | 2013-04-29 | +8.9% | 4.4x | 6.5x | 0.64 | 3 days, 3.2% deep | 61.35 | 60.21 | 1.9% | 17.0R | 6.5x volume out of a tight uptrend; the three-day pause holds the PEG-day close; 3R in 5 sessions. |
| 3 | BURL | 2016-05-26 (before open) | 2016-05-26 | 2016-06-01 | +7.1% | 2.3x | 3.5x | 0.75 | 2 days, 1.1% deep | 61.01 | 59.70 | 2.2% | 17.0R | Gap off a pullback to the 50-day, two-day pause, then a stair-step up the 10-day; shows a pre-open report (PEG day = report day). |
| 4 | AMZN | 2017-10-26 (after close) | 2017-10-27 | 2017-11-06 | +8.8% | 6.0x | 5.5x | 0.92 | 5 days, 1.7% deep | 56.14 | 55.39 | 1.4% | 24.7R | The classic: a 6-ATR gap on 5.5x volume out of a five-month base, five flat days, breakout, 3R in 13 sessions, then a trend. |
| 5 | LULU | 2018-03-27 (after close) | 2018-03-28 | 2018-04-05 | +7.0% | 2.3x | 6.2x | 0.59 | 4 days, 1.9% deep | 90.25 | 88.19 | 2.3% | 19.1R | 6.2x volume out of a 10-week flat base; a four-day pause above the gap; the close at 0.59 of range is the weakest of the ten (a B cue). |
| 6 | GM | 2020-11-05 (before open) | 2020-11-05 | 2020-11-10 | +4.7% | 1.4x | 2.4x | 0.94 | 2 days, 0.6% deep | 39.72 | 38.58 | 2.9% | 14.8R | The smallest gap of the ten (4.7%, just over the floor) with a 0.94 close; shows a stop near the 3% limit and a 34% prior run (over the 30% A-grade cue, so a B). |
| 7 | DOCU | 2021-06-03 (after close) | 2021-06-04 | 2021-06-11 | +7.8% | 1.9x | 7.7x | 0.93 | 4 days, 1.8% deep | 246.80 | 242.43 | 1.8% | 15.5R | 7.7x volume, a 20% PEG day through the 50-day out of a four-month correction; four-day pause; 3R the day after the buy. |
| 8 | LOGI | 2023-10-23 (after close) | 2023-10-24 | 2023-10-31 | +10.4% | 5.2x | 5.4x | 0.95 | 4 days, 2.4% deep | 78.20 | 77.34 | 1.2% | 18.9R | A 10%+ A-grade gap closing at 0.95 of range, four quiet days, then a two-month trend; the least liquid of the ten ($30M a day). |
| 9 | GLW | 2025-07-29 (before open) | 2025-07-29 | 2025-08-05 | +6.2% | 3.7x | 3.8x | 0.80 | 4 days, 2.4% deep | 63.91 | 62.60 | 2.1% | 21.2R | Gap out of a tight three-month channel, four-day flag holding the PEG-day close, then a steady run that never lost the 10-day. |
| 10 | COCO | 2026-04-29 (before open) | 2026-04-29 | 2026-05-08 | +17.4% | 3.3x | 4.0x | 0.98 | 6 days, 5.1% deep | 69.58 | 68.27 | 1.9% | 12.3R | The biggest gap (a 30% day closing at 0.98), six-day flag, 5R in two weeks; the late-June shakeout under the buy point shows why the rest trails under the 10-day after 5R. |

Years 2010, 2013, 2016, 2017, 2018, 2020, 2021, 2023, 2025, 2026; one per ticker; all ten are stocks, none an ETF. Three
were cut after looking at the charts: VSAT 2019-02-13 (the gap launched from under a falling 200-day, the owner's open
question 9), G 2024-08-15 (the window's best came from the next earnings gap, and the trade sat under 3R for weeks) and
PANW 2020-11-23 (the report-time doubt above). Sheets: `final/sheet_1-4.png`, `final/sheet_5-7.png`, `final/sheet_8-10.png`.

**Notable failures** (hits that met every rule and were stopped):
- **NVDA 2024-03-04** (PEG day 2024-02-22, +11.2% gap, 1.9x volume, close at 0.99 of range, up 36% in the prior 65
  sessions): bought over the pause high at 84.13 on a gap-open with a stop only 0.5% away; the stock stalled and the stop
  went that week, 0.0R best. The lesson is the stop, not the gap: a 0.5% stop under the trigger day's low on a stock that
  moves 3% a day is not a stop, and a 36% run before the gap is past the A-grade cue.
- **CELH 2023-05-18** (PEG day 2023-05-10, +10.6% gap, 7.5x volume, close at 0.61): a seven-day pause, buy over 45.07 with a
  2.9% stop, straight down to the stop, 0.0R. A big-volume gap that closed only just inside the top half and then needed
  seven days to trigger; the pause was already a drift by the time it broke out.
- **ELF 2023-06-06** (PEG day 2023-05-25, +10.7% gap, 4.6x volume, close at 0.98, up 18% in 65 sessions): bought the
  eighth-day break at 107.16, stop 2.6% away, stopped without reaching 1R. Textbook gap, textbook pause, still lost: the
  base rate above (about seven in ten stopped at a fixed stop) is why the plan sizes by the stop (A5), not a sign the rule
  is wrong.
- Also stopped: AAPL 2018-08-06 and 2022-02-02, MSFT 2015-04-29, NFLX 2023-01-25, ZM 2025-12-02. Mega-caps gapping 4-5% on
  2-3x volume gave the thinnest follow-through in the sample.

## 13. Failures and near-misses (from our data)

Added 2026-11-10 from the same scan as section 12 (`peg_scan.py`, `final/hits.json`) and a near-miss scan
(`near_scan.py`, `final/near_hits.json`): the section-12 rule run again over the 2,630 liquid names with one gate relaxed
at a time, keeping only the gaps that fail exactly one of peg.catalyst (the same shape on a day that is not a report
reaction day, no report within 3 sessions), peg.gap_floor (an open 2% to 4% over the prior close), peg.volume (1.0x to
1.5x), peg.close (a close in the lower half with the gap still open), peg.above_200 or peg.entry_pause (the first trigger
on session 12 to 20) and pass every other gate. Charts (scratch folder, not in the repo): `final/fail_1-4.png`,
`final/near_1-4.png` and `final/pair_20-episodic-pivot.png` (a PEG above an Episodic Pivot, the card's first look-alike,
each with its tell). Script `fail_near.py`; every number below is in `final/fail_near.json`. Outcome as in section 12: a
fixed stop, no trims, 60 sessions. [my computation]

**Four valid PEGs that lost.** Every gate of the card passed; the house stop was hit; one per name, four years.

| # | Ticker | Report (time), PEG day | Gap (ATR40) / volume / close in range / run65 | Buy (trigger) | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|
| 1 | NVDA | 2024-02-21 (after close), 2024-02-22 | +11.2% (3.8x) / 1.9x / 0.99 / +36% | 84.13 on 2024-03-04, a gap open 2.1% over the pause high 82.39 (6-session pause) | 83.67 (0.5%) | 2024-03-05, day 1, best 0.0R | A 0.5% stop under the trigger day's low on a stock that moves 3% a day is not a stop; and the 36% run into the report is past the 30% cue (peg.not_extended). | peg.stop_pause |
| 2 | CELH | 2023-05-09 (after close), 2023-05-10 | +10.6% (3.3x) / 7.5x / 0.61 / +8% | 45.07 on 2023-05-18 over 45.06 (5-session pause, triggered on day 7) | 43.78 (2.9%) | 2023-05-19, day 1, best 0.0R | A big-volume gap that closed only just inside the top half, then a pause that was already a drift when it broke out; straight down to the stop. | peg.inv_drift |
| 3 | AAPL | 2018-07-31 (after close), 2018-08-01 | +4.6% (3.3x) / 3.1x / 0.94 / +15% | 52.20 on 2018-08-06 over 52.19 (2-session pause) | 51.32 (1.7%) | 2018-08-08, day 2, best 0.2R | A gap near the 4% floor on a mega-cap everyone covers: the thin follow-through case of section 12 (AAPL twice, MSFT, NFLX, ZM). | peg.gap_floor |
| 4 | MSFT | 2015-04-23 (after close), 2015-04-24 | +5.4% (3.2x) / 3.8x / 0.89 / -6% | 49.22 on 2015-04-29 over 49.21 (2-session pause) | 48.45 (1.6%) | 2015-05-01, day 2, best 0.42R | The shortest pause the rule allows, bought at the first break; it fell back into the PEG bar in two sessions. No gate fails here: this is the base rate (seven in ten stop). | peg.entry_pause |

**Four near-misses.** Each looks like a PEG and fails exactly one gate; the would-be buy follows the section-12 entry so
the levels can be compared with the winners. No trade is implied.

| # | Ticker | Gap day (report) | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | BA | 2025-12-02 (no report that day; the last report reaction day was 2025-10-29) | peg.catalyst | +6.3% (2.4x ATR40) on 2.7x, close at 0.96, down 20% over 65 sessions: every other gate passes | A News Gapper (setup 22), taught there. The would-be pause buy at 205.86 on 2025-12-08 was stopped, 0.0R. |
| 2 | AAPL | 2023-05-05 (report 2023-05-04, after close) | peg.gap_floor | the open was 3.1% over the prior close; the rule is 4% or more (1.9x volume, close at 0.79, up 14% over 65 sessions) | An ordinary earnings up-day, not a gap setup. The would-be day-one close buy at 173.57 reached 0.36R and was stopped. |
| 3 | AMD | 2022-02-02 (report 2022-02-01, after close) | peg.close | closed at 0.23 of the day's range; the rule is the top half. The gap held (low 120.64 above the prior close 116.78) and the day was +11.2% at the open | A faded PEG day (peg.faded_day): a delayed-reaction watch, not a buy. The would-be close buy at 122.76 was stopped, 0.0R. |
| 4 | META | 2022-04-28 (report 2022-04-27, after close) | peg.above_200 | the PEG-day close 205.73 was under the 200-day (302.98); the rule is a close over the 200-day (+16.0% gap on 3.1x, close at 0.82, down 42% over 65 sessions) | A bear-market relief gap under a falling 200-day: no long setup (B26). The would-be pause buy at 212.49 was stopped, 0.0R. |

**What the failures have in common.** All four were stopped within two sessions of the buy and none reached 1R (the
best was 0.42R), so each loss was about 1R. Two of the four (AAPL, MSFT) were the shortest pause the rule allows (two
sessions, triggered on day 4); the other two paused longer (NVDA six sessions, CELH five) and drifted. In every case the
pause held inside the PEG day's range and the stop sat a few cents under the trigger day's low, above the PEG-day high
in three of the four (NVDA, AAPL, MSFT), so a one-session reversal of the breakout was enough to hit it, long before any
test of the PEG-day low.
Two of the four (NVDA, AAPL) were widely covered mega-caps and two (NVDA +36%, AAPL +15%) were already up into the
report. The near-miss scan adds this about the gates: the 5,621 near-misses reached 3R 29.6% of the time against 31.0%
for the strict rule, and by gate, a lower-half close 28.3% (2,565 hits), a gap of 2% to 4% 31.3% (1,676), the same shape
on a non-report day 27.2% (905), a close under the 200-day 38.7% (323), a trigger on session 12 to 20 24.8% (109) and
1.0x to 1.5x volume 34.9% (43). The close and the pause window are the gates that matter in this sample; the 4% floor,
the 200-day and the volume floor did not separate, which belongs in section 10 next to the owner's question on the
200-day. [my computation]
