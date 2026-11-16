# Setup 23: News Failure (asked for as a short; the house uses it in both directions, mostly long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
file or transcript named next to it, and kept to 40 words or fewer. Nothing here is a ruling. Where I could not read a
source, I say so and give no wording from it. Numbers marked [my proposal] are mine, for the owner to accept or change.
Numbers marked [my computation] come from my own scripts run on the app's daily bar store (method and limits in 4.4).

Tags used in sections 8 and 9: **[originator]** Jason Shapiro's own words; **[source consensus]** at least two outside
sources agree (named next to the tag); **[one outside source]** a single outside source, named; **[UCT]** UCT's own
writers or the owner; **[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my
recommendation; **[my computation]** my own scripts on the bar store.

Checked cold on 2026-11-09 by a second agent who re-opened every quoted page, re-read the app code and re-ran the bar
numbers with an independent script. Corrections made in that pass are listed at the end, under "Removed or corrected in
checking". Checked cold a second time later the same day by a third agent, who fetched every web page again (all 323
Crowded Market Report posts and all 103 UCT posts through Substack's public post API, plus every other cited page),
matched all 283 distinct quoted strings against those fresh copies, re-read the code and the repo files, and rewrote
the bar study from scratch (4,284 tickers). Every quote and every bar number held; the small wording fixes it made
are listed in "Second cold check" at the very end.

**The short version.**
- "News Failure" comes from Jason Shapiro's method (he names it as half of his process, and the owner credits it to
  him; I could not confirm who first coined it). Shapiro is a contrarian futures trader (Crowded Market Report) and one of the traders
  in Jack Schwager's *Unknown Market Wizards*. The owner himself paired "Jason Shapiro" with "News Failure" when he listed
  famous traders and their signature setups (Discord, 2024-11-23, archived in the repo's brain file).
- Shapiro's definition works in both directions: news that should push a market up, and by the close the market has
  closed down; or bad news, and it closes up. For him it is never the setup on its own. It is the **confirmation** he
  waits for after positioning data (COT) shows a crowded market.
- The task framed this tag as "a failed news or earnings gap, shorted". The house record does not support that as the
  main meaning. In UCT's public writing the term appears 10 times: 6 in Bracco's signed section, 1 in the owner's signed
  section, and 3 in the newsletter's **unsigned** "Index & ETF" section (no author is named there; in one post the owner
  calls that section's notes his own, so those 3 are probably his, but the posts do not say so; see section 6). Six of
  the 10 uses are the **bullish** read (bad news fails, look for a low). Four are a **bearish market** read on three
  events (good news sold, the market "needs more time"). None is a written single-stock short trade.
- In the app there is **no scanner**. The tag sits in the journal's Swing list with no direction. The Model Book has a
  "News Failure" card only among the **Bottoms** signposts, and it is bullish. A dormant Chart IQ label called
  `news_failure` treats it as a **short** (mainly a gap up of 5% or more on double volume that closes under the prior
  close; two "climax" gap-and-fade marks also feed it, see 5.2). Members never see that label. So the app's two
  meanings point opposite ways.
- No one has published statistics for "news failure" by that name. Nearby measured work exists (Bulkowski's event
  patterns, key reversals and gaps). My own run on the app's bars, 1996 to 2026, found **no mechanical edge in either
  direction** for single stocks with the natural stop, and found that index "good news failures" were followed by
  **higher** prices more often than an average day. That supports Shapiro's own use: a timing trigger after a crowded
  setup, not a stand-alone pattern.
- Two hard collisions with the rulebook: **B26** (the good-news failures that leaned bearish in my data were the ones
  above the 200-day, where we do not short; 61% of bad-news failures, and the house's market-bottom examples, sit below
  it, where we do not buy) and **A13** (the natural stop beyond
  the news day's extreme sat a median 12% away at the close; none of 3,456 events had it within 3%, which the 4% gap
  filter guarantees by construction: the day's extreme is at least 4% from the prior close and further from the close).

---

## 1. What it is, and the psychology

**In two sentences.** A News Failure is a session where important news should have moved a stock or the market one
way, and by the close price has gone the other way: good news and it closes down, or bad news and it closes up. The
short version sells a stock (or index) after good news gaps it up and the day closes red, with the stop above the news
day's high; the long version mirrors it.

**Shapiro's own one-line test** (Wealthion interview transcript, see 3.1): "But by the end of the day it fails and closes
down in the absence of any other kind of bearish news." His newsletter's formula (3.2): "Sugar News Failure = Bearish
News + Bullish Price Action (market closes green)". In his written trades the entry is at that close and the stop is the
failure day's extreme, hit only by a close beyond it (3.2).

**Why it can work (the psychology).** These points are reasoning from the sources, not measured facts.
- The news was already in the price. Shapiro's whole method says positioning, not news, decides the move: his site says
  he combines "Commitments of Traders (COT) data with news failure analysis", and "Trader positioning is the ultimate
  discounting mechanism." If everyone who would buy on good news already owns it, the good news finds no new buyers.
  The UCT newsletter's unsigned index section used the same two parts in November 2025: "positioning metrics" reaching
  "contrarian bullish levels", "combined with a potential “news failure” on the China/US meeting reaction" (section 6).
- Trapped buyers. Everyone who bought the gap up at the open now holds a loss by the close. Their selling, as they get
  out near even, is overhead supply. The mirror: shorts who sold the bad-news gap down are trapped when it closes green.
- The old tape-reading idea. Wyckoff (1910): "Considerable light is thrown on the technical strength or weakness of the
  market and special stocks by their action in the face of important news." Lefèvre's *Reminiscences* (1923): "in bull
  markets bear items are ignored and bull news exaggerated, and vice versa."
- Exhaustion. At the end of a long run, a news gap can be the last burst of buying (an exhaustion gap). StockCharts:
  "Exhaustion gaps are quickly filled as prices reverse their trend." Pradeep Bonde: "once the IBD crowd and others get
  very excited, there are exhaustion gaps or island reversals."

**Why it often fails (also reasoning, and see the measured results in section 4).**
- News usually wins. Pradeep Bonde on earnings gaps: "A new set of information was complete surprise and that indicates
  the move will proceed in that direction." A one-day fade inside a real repricing is often just the first pullback.
- The shape alone is a coin toss. Bulkowski's test of the bearish-looking key reversal found "51% actually continue
  higher".
- The read can come at the end of a pullback, not the start of one. The house's own bearish index examples (QQQ on
  2025-11-20 and 2025-07-31) were higher 20 sessions later (4.5).

---

## 2. Origin and naming

**The name.** The term comes from **Jason Shapiro**, as far as I can trace it. I could not confirm whether he coined it
or only made it known (I did not read the Schwager chapter). Evidence, from the strongest:
- His own website bio (read 2026-11-09): "By combining Commitments of Traders (COT) data with news failure analysis, I
  identify low-risk, high-reward opportunities." (https://www.crowdedmarketreport.com/)
- His newsletter's own written definition (2024-01-01, "Published by The CMR Team on behalf of Jason Shapiro";
  https://crowdedmarketreport.substack.com/p/weekly-cmr-cot-charts-review-_-equities): "So when a market reaches max
  crowdedness (Speculators are crowded long or short) you wait for a news event where price does not react as expected
  (aka news failure)." Full quotes in 3.2. (Found in the checking pass; the first draft had missed it.)
- His own Substack post titled "MARKET NEWS FAILURE" (2024-07-21), subtitle "What do you think the news failure will be
  tomorrow on the Biden news?" (https://crowdedmarketreport.substack.com/p/market-news-failure). The body is a video; I
  read only the title and subtitle.
- His posts "Why I Don't Chase Trades" (2024-08-07) and "Anatomy of a CMR Trade" (2024-09-11) use "news failure event"
  and "news/correlation failure" as the trade trigger (quoted in 3.2).
- The owner's own mapping in the Discord (2024-11-23; repo file `docs/study/levels/brain_kb_cycle_2026-11-06.json`, ref
  `trader_archive:t0774`): a list of traders and their signature setups that pairs Jason Shapiro with News Failure, the
  same way it pairs Minervini with the VCP and Pradeep with the Episodic Pivot. (Paraphrased: member-only Discord
  material; I do not copy its wording.)
- The UCT newsletter names him in a public post (2026-09-20, the unsigned "Index & ETFs" section, IWM): "Watching for
  that Jason Shapiro crowded COT positioning + news failure of sorts to play out potentially." The owner, in his signed
  section (2026-11-08), repeats "Jason Shapiro’s phrase he has embedded into me".

**Who Shapiro is.** Wealthion's interview page (published 2025-11-20) calls him "creator of the ‘Crowded Market Report’"
and "a featured Commodity Trading Advisor in Jack Schwager’s ‘Unknown Market Wizards.’" I did **not** read the book
chapter (a third-party course summary of the book, https://elearnmarkets.com/school/units/unknown-market-wizards, lists
it as "Jason Shapiro: The Contrarian"); nothing here is quoted from it. He
calls himself "a seasoned futures trader" (CMR home page), and every worked trade of his that I read is a futures or
index market (stock indexes, currencies, gasoline, cotton). I found no single-stock trade of his; that is an absence in what I
read, not a statement of his. Using the idea on single-stock earnings gaps is UCT's (and other traders') extension.

**Where the idea is older than the name.**
- Richard Wyckoff, writing as Rollo Tape, *Studies in Tape Reading* (1910), chapter I: the market's "action in the face
  of important news" shows its strength or weakness. Chapter VI ("Market Technique"): "A stock generally shows the Tape
  Reader what it proposes to do by its action under pressure or stimulation." His worked example is U.S. Steel: the
  news came out on Friday, February 19, 1909, and on the next session's tape (February 20) Steel did not rally when he
  reasoned it should have.
- Edwin Lefèvre, *Reminiscences of a Stock Operator* (1923), chapter X, the narrator widely read as Jesse Livermore:
  "The trend has been established before the news is published, and in bull markets bear items are ignored and bull news
  exaggerated, and vice versa."

**Other names for the same or a nearby idea.**
| Name | Who uses it | How it relates |
|---|---|---|
| News failure | Shapiro; Bracco; the owner | the term itself, both directions |
| News/correlation failure | Shapiro (AUD trade, 2024) | a market closes against the news or against its usual partners |
| News failure to the upside (paraphrase of a member-only summary) | Manrav, UCT Discord (2024-10-29, KB summary) | the bullish version (BA) |
| "Bad news failed" | the live course F7.04 | the bullish version, market-level |
| "Sell the news" | Bracco on CIFR (2025-09-28); common market slang | the bearish version on the news day |
| Gap & fade / Gap & fade (climax) | the app's Chart IQ engine (`v3_levels.py`) | the bearish shape on daily bars |
| Inverted dead-cat bounce | Bulkowski (event pattern) | a 5%+ jump on an event, then a slower decline |
| Exhaustion gap | ChartSchool, Bulkowski, Pradeep | a gap at the end of a long move that is soon filled |
| Key reversal (uptrend) | Bulkowski | the one-day shape: open above the prior close, close under the prior low |
| Bearish Oops | the house Oops detector's docstring (not fired) | gap over the prior close, trade over the prior high, close back under the prior close |
| News Failure (Bottoms signpost 4) | the Model Book (`bottomsCatalog.js`) | the bullish, market-level version at bear-market lows |

Not the same thing: the house **Bear Gap off the Highs** (a gap down that holds) and the owner's "earnings breakdown"
(a gap down that keeps going). In both, the news worked.

---

## 3. Every definition I could find, source by source

### 3.1 Jason Shapiro, Wealthion interview (originator; transcript)
"Winning Wall Street: Jason Shapiro's Trading Triumphs", host James Connor, page dated 2025-11-20, transcript on the page
(https://wealthion.com/news/winning-wall-street-jason-shapiros-trading-triumphs). The conversation refers to "right now
in 2024", so it was recorded in 2024. The transcript reads like machine transcription; small word errors are kept as
written.
- **Prior condition (the setup):** crowded positioning first. "sometimes I have markets that are showing very crowded and
  I don’t get that confirmation for weeks or even months".
- **The news:** "I need news to come out that supports the bullish thesis." His examples: "Great earnings from one of these
  big names or let’s call it a lower CPI this Thursday."
- **The trigger (short):** "But by the end of the day it fails and closes down in the absence of any other kind of bearish
  news." Then: "That’s the confirmation to make when the market no longer goes up on news that you’d be making it go up."
- **Entry timing:** "That for me is the confirmation that I need before I will put on a trade". And: "I need market
  confirmation before I do that."
- **Stop (said of a long):** "if we make a new low, then by definition, I didn’t pick the market turn because it’s at a new
  low. So that’s where I get stopped." The short mirror is a new high above the turn.
- **Risk:** "I’m risking about 70 basis points of my portfolio for each trade."
- **Exit and holding time:** about two to three months, and "when the data shows that they are no longer short, that’s
  when I will take profit".
- **Win rate (self-reported):** "I don’t have to have anything better than a 40% win rate to make good returns over time."

### 3.2 Jason Shapiro, Crowded Market Report Substack (originator; his own posts)
All 323 posts in the newsletter's sitemap (2023-12-24 to 2026-11-09; 298 public, 25 for paid subscribers, which return
little more than a title) were pulled through Substack's public post API on 2026-11-09 and searched for "news failure";
22 public posts use it (21 in the body text; the 2024-07-21 post only in its title and subtitle). Every one carries the
byline Jason Shapiro; five posts from January 2024 (2024-01-01, 01-08, 01-15, 01-22 and 01-29), among them the two
quoted next, end with "Published by The CMR Team on behalf of Jason Shapiro". The ones that define or apply a rule:
- **The definition** ("Weekly CMR COT Charts Review _ Equities", 2024-01-01,
  https://crowdedmarketreport.substack.com/p/weekly-cmr-cot-charts-review-_-equities): "trader positioning is not enough
  to execute the trade; you also need market confirmation." "So when a market reaches max crowdedness (Speculators are
  crowded long or short) you wait for a news event where price does not react as expected (aka news failure)." And: "For
  example if Speculators were crowded long and bullish news comes out for the specific commodity, and price action is
  bearish where the market closes red for the day, that is considered a news failure".
- **Entry at the close, stop at the failure day's high** ("Weekly CMR COT Charts Review _ Equities (Continued)",
  2024-01-08, https://crowdedmarketreport.substack.com/p/weekly-cmr-cot-charts-review-_-equities-829): "IT ALSO NEEDS A
  NEWS FAILURE EVENT. Crowded positioning alone is not enough to enter the trade." On a possible CPI day: "Nasdaq ends the
  day red, which would be considered a news failure. The high of that day would become the stop level if a short trade
  is entered at the close." Also: "This process has a ~40% win rate historically". The same post reads a run of days as
  one failure: from 12/28/2023, "which was a news failure day, through last Friday, where bullish news was coming out and
  the Nasdaq closed down each day."
- **A worked trade, with a close-based stop** ("1st Big Winning Trade of the Year - Cotton", 2024-04-24,
  https://crowdedmarketreport.substack.com/p/1st-big-winning-trade-of-the-year): "The second, and equally important, part
  of the CMR process is to wait for market confirmation, which I refer to as a news failure event." The WASDE report
  "was bullish Cotton, essentially saying that demand will be higher than supply, but Cotton ended the day down." "A
  classic CMR news failure event and confirmation that shorting Cotton can be executed on the close." The report came out
  at noon, so "the stop was set at the post-WADE high of the day. In other words, if Cotton closed higher than that stop
  level, then the trade would be stopped out." The exit: "positioning turned neutral, which is defined as one of the
  trader types reaching an indexed score of around 50".
- **A one-line formula** ("Pour Some Sugar On Me!", 2026-02-09,
  https://crowdedmarketreport.substack.com/p/pour-some-sugar-on-me): "Sugar News Failure = Bearish News + Bullish Price
  Action (market closes green)". Copper (2024-05-06): "The key now is waiting for Copper to fail on bullish news, or what
  I refer to as a news failure event."
- **His current trade** ("The Nasdaq Short! Best Trade of The Year.", 2026-11-09,
  https://crowdedmarketreport.substack.com/p/the-nasdaq-short): "the Nasdaq short trade was executed after a the news
  failure on 10/22/2026", and it survived "the 10/28/2026 test of the stop level". On the app's bars QQQ that day opened
  1.6% lower and closed 2.9% lower on 1.9x volume (my check), so his failure there was not a gap-up fade on the cash ETF,
  and QQQ closed above that day's high on 10/28 while his trade stayed on: he trades Nasdaq futures, and the post does
  not give his stop level. A daily ETF chart cannot fully reproduce his calls.
- A member's checklist he published as "a great summary of how we try to view markets at CMR" (2025-01-23; the member's
  words, not his): "A notable event/data print should occur that would cause the asset to move against the direction you
  wish to trade. But then it should close in your favor." And: "It should be weird, and without any real explanation."
- "Anatomy of a CMR Trade - a Winner & a Loser" (2024-09-11,
  https://crowdedmarketreport.substack.com/p/anatomy-of-a-cmr-trade-a-winner-and).
  - Setup: "Speculators reached max crowded levels in mid July when they finally turned net-long after being net-short
    the entire year."
  - Trigger, short Australian dollar: "the AUD closed red on a day when the US Dollar also closed red and other Currencies
    closed green, which I consider a news/correlation failure and the trade was entered."
  - Exit: "The exit came when the positioning turned neutral and there was no longer a positioning edge."
  - Stop, long gasoline (RBOB): it was bought on "the Monday when everything was down a lot and RBOB finished the day
    green", and "RBOB closed below that Monday low and the trade was stopped out." So the stop is a **close** beyond the
    entry day's extreme. (The post does not call that Monday a news failure; it is the same pattern as his AUD
    trigger: everything else down, this one closed green.)
- "Why I Don't Chase Trades" (2024-08-07, https://crowdedmarketreport.substack.com/p/why-i-dont-chase-trades): "I either
  misread the news failure event, or in fact that event never happened but the market goes the way the crowded COT would
  indicate anyway." On chasing: "how would I size it?" and "I miss a trade, I miss it."
- Titles of his public video posts (text bodies are a line or two; I did not watch the videos): "MARKET NEWS FAILURE"
  (2024-07-21); "BULLISH NVIDA EARNIGNS - BEARISH STOCK MARKET REACTION" (2024-05-23); "STOCKS UP ON BEARISH NEWS. Is it
  Time to Cover Yen Shorts?" (2024-05-02); "STOCK MARKET RALLIES ON BAD NEWS—IS THIS THE STRONGEST SIGNAL YET?"
  (2025-06-02); "CPI BEAT… BUT STOCKS FELL?" (2025-06-11); "FED SHOCKER: WHY THE MARKET RALLIED ON HAWKISH NEWS"
  (2025-08-20); "NVIDIA FAILED", subtitle "WHY YOU DON’T CHASE THE NEWS IN TRADING!" (2025-11-20); "NVIDIA Closes Down &
  The Nasdaq Close Up!" (2026-05-21); "Bullish News No Longer Enough?" (2026-07-15). (Titles checked 2026-11-09 via the
  Substack post API.)
- His site bio (https://www.crowdedmarketreport.com/): his strategy is "going against the grain", then "shorting during
  bullish euphoria and going long amid bearish despair."

### 3.3 UCT (house; full quotes in section 6)
- The owner (2026-02-22): "I want to see strong positive reactions to news or news failure on negative headlines." That is
  the bullish read, used as a market filter.
- Bracco (his signed section) uses it both ways. Bullish: RIVN (2025-12-14), SPCX (2026-08-16), SOXX (2026-09-20).
  Bearish market read: META and MSFT earnings gap ups (2025-08-03), NVDA earnings (2025-11-23).
- The unsigned "Index & ETF" section (probably the owner's, see section 6) uses it both ways too. Bullish: IWM
  (2026-09-20). Bearish market read: the QQQ after the META and MSFT gap ups (2025-08-03), the China/US meeting
  (2025-11-02).
- What the house examples add to Shapiro: the failure may take **a few sessions** (SOXX "closing back above the the close
  from 9/11"; SPCX recovered its pre-news close two sessions later), and it is mostly used to time **longs** or to judge
  the market.

### 3.4 Thomas Bulkowski, event patterns (measured; **his site states a notice against use for AI training**)
Read through a fetch tool; direct requests were refused (HTTP 406). Quotes are as the tool returned them.
- **Inverted dead-cat bounce** (https://thepatternsite.com/idcb.html): "Price makes a dramatic rise, from 5% to 20% or more,
  before declining at a more leisurely rate." Guidelines: "Look for an event that causes price to jump at least 5% but it
  can be 20%, 50%, or even higher." "Avoid those stocks with takeover rumors as they tend to stay high or move even
  higher." "Price typically moves higher the day following the event." "After that, price tends to decline." Tactic for a
  10% rise: "Sell the day after the initial rise. Price trends lower thereafter." Note: this is about an event jump that
  **holds on the day** and fades later, not a same-day failure.
- **Earnings surprise, good** (https://thepatternsite.com/earnsgood.html): "Wait for price to confirm the pattern because
  traders may push price down instead." "Failure rates are high. Almost half (48%) rise just 10% before tumbling and that
  occurs in less than 2 weeks." Confirmation there means a close above the announcement day's high.
- **Earnings surprise, bad** (https://thepatternsite.com/earnsbad.html): "Nevertheless, in a bear market 61% have upward
  breakouts!" and "In a bull market, 43% breakout upward." "Almost half the time price bottoms in less than a week and then
  rebounds." Both earnings pages also say "select announcements that occur within a third of the yearly low"; the bad
  one defines a breakout as a close "below the lowest low posted on the announcement day".
- **Dead-cat bounce** (https://thepatternsite.com/dcb.html): "Price usually gaps downward, closing 15% to 70% lower than the
  prior day." After the bounce, price resumes down, "This places price an average of 18% below the event low 67% of the
  time." A warning for the long version: a bounce after a crash-size event is usually not the low.
- **Key reversal, uptrend** (https://thepatternsite.com/KRU.html): "look for an open above the prior close, a close below the
  prior low, and a high above the prior day's high." Tested on "1,189 stocks, starting from January 1990 to March 2013",
  and "testing shows that 51% actually continue higher."
- **Gaps** (https://thepatternsite.com/gaps.html): exhaustion gap "Happens at the end of a trend on high volume." Upward
  exhaustion gaps closing within a week, in his bull-market table: "Exhaustion gaps: 60%".

### 3.5 Kristjan Kullamägi (Qullamaggie), qullamaggie.com (originator of his own setups; neighbor to this one)
- "3 TIMELESS setups that have made me TENS OF MILLIONS!" (2021-01-08,
  https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/), on an earnings gap that failed:
  "Now the middle red arrow, the stock gapped up slightly but sold off. This is not an EP." And: "The earnings were big,
  the analyst beat was big but this didn’t matter." On a stock that ran before the news: "If the stock has already made a
  big, multi month move into the gap-up, is it really a surprise to the market?"
- Same page, his parabolic short mechanics (the nearest stock-level short that uses a failed gap day): "you can short on
  the opening range lows (1-minute, 5-minute candles)". "The stop is highs of the day or if VWAP fail, a reclaim of the
  VWAP." "The target area is the 10- and 20-day moving averages, that’s where these stocks usually bounce." "Let the
  amateur shorts get run over, that’s where your edge comes in."
- "How to master a setup: Episodic Pivots" (2021-11-02, https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/):
  "Many times you get EP on stocks that have already made a big move from a previous EP and these can work but the failure
  rate is higher".
- He does not use the words "news failure". He treats a failed news gap as "not an EP" (a reason not to buy), not as a
  named short.

### 3.6 Pradeep Bonde (Stockbee), "Gaps and traps" (2006-11-22; his answers in the thread)
https://stockbee.blogspot.com/2006/11/gaps-and-traps.html
- "Gaps of certain magnitude indicate information mismatch." "A new set of information was complete surprise and that
  indicates the move will proceed in that direction."
- "Exhaustion gaps are easy to find if you know how much % a equity has moved in a year." His HANS example ends: "so when
  the grandma in Timbuktu gets excited about it, it is exhaustion gap."
- He gives no entry or stop for shorting a failed gap there.

### 3.7 StockCharts ChartSchool, "Gaps and Gap Analysis" (educator; no author shown; "Last updated 2 years ago" when read; the page's stored timestamp is 2024-09-25)
https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis
- "Exhaustion gaps happen near the end of a good up or downtrend." "They're identified by high volume and a large price
  difference between the previous day's close and the new opening price." "Exhaustion gaps are quickly filled as prices
  reverse their trend."

### 3.8 Bracco's "The Parabolic Short" (UCT; the owner's chosen definition of "parabolic" for B26)
https://unchartedterritoryy.substack.com/p/the-parabolic-short (2025-06-13)
- The failing news is one of his named catalysts: "In a Parabolic Short setup, this could be a disappointing earnings
  report, short report, negative news/catalyst, or heavy selling pressure."
- His favorite top: "A parabolic burst into a final gap up on climax day, where it opens higher, and closes lower."
- Entry: "I will never take an entry until the stock at least breaks below the intraday VWAP (Volume Weighted Average
  Price)." Stop "at the day’s high"; target "the 9-day exponential moving average (9EMA)".
- He used a news fade this way on 2025-09-28 (section 6): among his parabolic short candidates, "The only standout setup
  was CIFR", which turned into a "sell the news" reaction.

### 3.9 The app's own rule (Chart IQ v3; details in 5.2)
Mainly a gap up of 5% or more on 2x the prior 50-day average volume that closes below the prior close ("Gap & fade"),
on the last or the prior bar, while the latest close is under 4 ATRs above the 50-day average. Two "climax" marks also
feed the label (a big gap closing near its low, or a 3%+ gap up today closing in the bottom 20% of the range); they do
not require a close below the prior close. No news is checked.

### 3.10 Comparison table

| Item | Shapiro (originator) | UCT usage | Bulkowski | Qullamaggie | Pradeep / ChartSchool | App (Chart IQ v3) |
|---|---|---|---|---|---|---|
| Direction | both | mostly long; bearish as a market read | event-specific (both) | failed gap = "not an EP"; short only if parabolic | exhaustion gaps (both) | short only |
| What it is for | confirmation after a crowded setup | market filter; timing a contrarian long | trade the event | avoid; or the parabolic short | read the gap type | a chart label |
| Prior condition | max crowded COT positioning | sentiment, positioning, a correction | trend into the event; within a third of the yearly low for some | a run of 3-5+ up days (parabolic) | a huge yearly move (exhaustion) | none (and under 4 ATR above the 50-day) |
| The news | major release (earnings of a big name, CPI, a crop report) | earnings, conferences, lockups, macro | earnings, rating changes, offerings and other listed events | earnings and guidance | earnings, other catalysts | not checked |
| Gap size | not part of his written definition (only the close against the news) | not stated | jump of 5%+ (inverted DCB) | EP needs 10%+ (so a failure is below EP grade) | 20%+ moves investigated | 5%+ for the plain mark; the "climax" marks take 8%+ on 3x, or 3%+ closing at the low |
| Volume | not stated | "tons of volume" (SPCX) | above the 30-day average (earnings) | big volume | 1M+ shares (2006) | 2x the prior 50-day average (plain mark); 3x or none for the climax marks |
| Trigger | the day closes against the news (red on bullish news, green on bearish) | close against the news, same day or within days | a close beyond the event day's range | opening-range low, first red 5-min candle, VWAP fail | none given | close below the prior close (plain mark only) |
| Entry | at the close of the failure day (2024-01-08 post; Cotton, 2024-04-24) | not stated as a rule | after a close beyond the announcement day's range; inverted DCB: "Sell the day after the initial rise" | intraday | none | none (label only) |
| Stop | the failure day's high for a short (the post-news high if the news came mid-session), hit only by a close beyond it (Cotton; RBOB on the long side) | not stated (parabolic: the day's high) | not stated as a level | high of the day, or a VWAP reclaim | none | none |
| Exit | positioning turns neutral, about 2-3 months | not stated (parabolic: the 9EMA) | weeks 1-4 | the 10 and 20-day averages | none | none |

### 3.11 Where the sources disagree
1. **Direction.** Shapiro, both. The Model Book, long only (and market-level). Chart IQ, short only. The task, short. UCT's
   own writing, mostly long.
2. **Stand-alone or confirmation.** Shapiro says confirmation of a crowded setup, never alone; he even misses trades
   because "that event never happened". Chart IQ and the task treat it as a stand-alone pattern.
3. **When the failure is judged.** Shapiro: mostly the same day's close, though in January 2024 he read a run of days
   (from 12/28/2023 "through last Friday", the Nasdaq closing down on bullish news "each day"). Bracco: up to a few
   sessions (SOXX, SPCX). The Model Book: "price refuses to make a new low", which can be a retest weeks later.
4. **Entry.** Shapiro: at the failing close (his written rule). The app: no entry, a label. Bulkowski: wait for a close
   beyond the event day's range. Qullamaggie and Bracco (parabolic): intraday, at the opening-range break or the VWAP
   fail.
5. **Stop.** Shapiro: the failure day's high for a short (low for a long), stopped only by a **close** beyond it (Cotton,
   RBOB). Qullamaggie and Bracco: the day's
   high (intraday). The house default (A3, F62) is a few cents beyond the day's extreme.
6. **Exit.** Shapiro holds two to three months until positioning normalizes. Bracco's parabolic target is the 9EMA, and
   Qullamaggie's is the 10 and 20-day averages. Bulkowski's event tactics run one to four weeks.
7. **Markets.** Shapiro's worked trades are futures (stock indexes, currencies, commodities). UCT applies it to single
   stocks and to sector ETFs.

---

## 4. Measured evidence

### 4.1 Published statistics for "news failure" itself
None found. I found no study, book table or vendor test that measures "news failure" by that name. My web searching ran
out after one query in this session (a shared search budget), so I worked from known pages and the links on them. The
checking pass ran further searches and read all of Shapiro's public Substack posts; it found no measured statistic for
the term either (his own figure is a self-reported win rate, 4.2). A study I could not find is not proof that none
exists.

### 4.2 The originator's own numbers (self-reported, not audited)
- Shapiro: "I don’t have to have anything better than a 40% win rate to make good returns over time." Risk "about 70 basis
  points" a trade; average hold "about two to three months" (Wealthion transcript).
- His newsletter, 2024-01-08: "This process has a ~40% win rate historically". Same figure, in writing.
- His AUD short: "a win to loss ratio of over 5" (his post, 2024-09-11); his Cotton short "returned over six times the
  risk" (2024-04-24). Single trades, chosen by him to show.
- Wealthion's page says "23 years of consecutive profits". That is the publisher's claim; I did not verify it.

### 4.3 Nearby published statistics (Bulkowski; **AI-training notice on his site**)
| Pattern | His numbers | How measured | Limits |
|---|---|---|---|
| Earnings surprise, good | break-even failure rate 29%; average rise 24%; 48% rise only 10% "before tumbling", in under two weeks | "hundreds of perfect trades" | no dates or sample size shown; "perfect trades" is his term, and the page sends readers to a glossary I could not find it in, so how the trades were chosen and measured is not stated |
| Earnings surprise, bad | 43% of bull-market cases and 61% of bear-market cases break out **upward** | same | same; "breakout" is his close beyond the announcement day's range |
| Dead-cat bounce | event drop averages 31%; 67% of the time the post-bounce low is 18% below the event low | same | crash-size events only (15% to 70% drops) |
| Key reversal, uptrend | 51% continue higher; bull-market up breakouts fail 45% (move under 5%) | 1,189 stocks, Jan 1990 to Mar 2013, price $5+ | the shape only; no news filter |
| Exhaustion gaps | 60% of upward and 66% of downward exhaustion gaps close within a week (his bull-market table) | over 1,100 gap samples in all, all types combined | an exhaustion gap is only known after the fact ("usually not followed by new highs") |

### 4.4 My computation on the app's bar store (**[my computation]**, not a published statistic)
**Method.** Read-only scan of the app's daily bar store (a local copy of `bars.db`: 3,897 tickers, 1984 to 2026-11-06).
Scripts are in my scratch folder, not in the repo.
- Liquidity filter, house rule B23: prior close $10 or more and a prior 20-day average dollar volume of $20 million or
  more.
- **Good-news failure (the short):** the open gaps up 4% or more over the prior close, volume 2x or more the prior 50-day
  average, and the day **closes below the prior close** (Shapiro's "closes down").
- **Bad-news failure (the long):** the open gaps down 4% or more, the same volume, and the day closes **above** the prior
  close.
- Forward returns are from the event day's close, over 20 sessions, raw and minus SPY over the same days.
- Trade test: entry at the event close; stop $0.03 beyond the event day's high (short) or low (long); 20 sessions; a
  session that touches both the stop and the target counts as the stop; a gap past the stop fills at that open.
- "E" is the average result in R if you take everything at 2R when reached first, otherwise the stop or the day-20 mark.
- Checked cold (2026-11-09, a second, independently written script by the dossier's checker on the same store, which
  had grown to 4,284 tickers by then): good-news failures 1,880 events, median 20-day -0.6%, vs SPY -1.7%, 52% lower,
  stop median 11.9%, 17% reached 2R first, E -0.01R; above the 200-day 909 events, -1.8%, 56% lower, E +0.04R; below it
  971, +1.0%, E -0.05R. Bad-news failures 1,727 events, -0.2%, 49% higher, stop median 10.6%, E +0.01R; above the
  200-day 669, -2.2%, 43% higher, E -0.09R; below it 1,058, +1.5%, 53% higher, E +0.08R. The counts differ only because
  the store gained tickers; every conclusion below holds on the re-run. A third script, written from scratch for the
  second cold check on the same 4,284-ticker store, returned these same numbers to the digit (counts, medians, shares,
  E), the same index table, the same earnings-day rows (442 and 354 events), the same 80% / 74% figures in 5.1 and the
  same 8.9 lists.
- The "Stopped" column counts every stop-out inside the 20 sessions, including trades that had already reached 2R, so
  "Reached 2R first" and "Stopped" can overlap. E counts a trade that reached 2R first as +2R.

**Results, single stocks (1996 to 2026).**
| Group | Events | 20-day return (median) | vs SPY (median) | Share that went the right way | Stop distance (median) | Reached 2R first | Stopped | E |
|---|---|---|---|---|---|---|---|---|
| Good-news failure, all | 1,798 (1,013 stocks, about 1,100 dates) | -0.7% | -1.9% | 52% lower | 11.9% | 17% | 48% | 0.00R |
| ... above the 200-day (B26 says no short) | 874 | -1.9% | -2.8% | 56% lower | 11.9% | 15% | 42% | +0.04R |
| ... below the 200-day (B26 allows) | 924 | +0.9% | -0.7% | 48% lower | 12.0% | 19% | 53% | -0.04R |
| ... after a 60-day run of +100% or more | 184 | -9.0% | -9.5% | 61% lower | 18.4% | 19% | 48% | +0.07R |
| ... 3 straight up closes and 2 gap ups (climax-like; trade columns use the next-day entry) | 241 | -3.5% | -4.1% | 59% lower | 18.5% | 15% | 38% | +0.09R |
| ... earnings day (tickers with dates on file) | 442 | +0.9% | -0.2% | 45% lower | 10.5% | 11% | 39% | -0.07R |
| ... the app's plain "Gap & fade" rule only (Chart IQ, 5.2: gap 5%+, 2x, close under the prior close, not 8%+ on 3x, under 4 ATR over the 50-day; the two "climax" marks are not included) | 905 | -0.7% | -1.8% | 52% lower | 12.5% | 15% | 44% | 0.00R |
| Gap up that held (close at or above the open), for contrast | 12,035 | -0.1% | -1.2% | 50% lower | n/a | n/a | n/a | n/a |
| Bad-news failure, all | 1,658 (965 stocks, about 845 dates) | -0.3% | -1.8% | 49% higher | 10.6% | 19% | 51% | +0.01R |
| ... above the 200-day (B26 allows the long) | 640 | -2.3% | -2.7% | 43% higher | 10.3% | 15% | 52% | -0.11R |
| ... below the 200-day (B26 says no long) | 1,018 | +1.4% | -1.3% | 53% higher | 10.9% | 21% | 50% | +0.08R |
| ... earnings day | 354 | +1.1% | +0.5% | 53% higher | 9.8% | 12% | 35% | +0.10R |
| ... after a 60-day fall of 25% or more | 500 | +2.4% | -1.8% | 53% higher | 12.6% | 26% | 54% | +0.10R |

More checks [my computation]:
- Dropping market-wide days (dates with 5 or more events, such as 2025-04-08 with 56 good-news failures, 2020-03-13 with
  27 and 2020-11-09 with 21): good-news failures, median -1.5% over 20 days and 54% lower (1,402 events); above the
  200-day -1.9% (746); below it -0.6% (656). Bad-news failures: -1.2% and 47% higher (1,082).
- Shapiro's own stop (checking pass, on the 1,880 / 1,727 re-run events): entry at the failure-day close, out only when
  a later session **closes** beyond the failure day's high (short) or low (long), exit at that close; 2R touched
  intraday counts as the win. Good-news failures: 19% reached 2R first, 39% closed past the stop, median loss when
  stopped 1.24R, E -0.03R (above the 200-day +0.03R, below it -0.09R). Bad-news failures: 21%, 41%, 1.18R, E +0.01R
  (above the 200-day -0.10R, below it +0.09R). The close stop changes nothing: still no edge without the crowding filter.
- A confirmation entry (Bulkowski's idea): short only if the next session trades under the failure day's low. It
  triggered 64% of the time; the stop was then a median 15.6% away; 10% reached 2R first; E -0.06R. For the long (next
  session over the failure day's high): triggered 63%; E -0.05R; above the 200-day, -0.13R. (The second cold check's
  script, which fills at the level or at the open when the open gaps through it, got 64% / 15.5% / 10% / -0.05R and
  63% / -0.03R / -0.10R: the same picture, within a few hundredths of an R.)
- Even entering at the prior close intraday (the earliest "green to red" or "red to green" moment), the stop beyond the
  day's extreme sat a median 7.4% away for the short and 7.1% for the long. Not one event had it within 3%, but that is
  built into the test, not found by it: a 4% gap puts the open, and so the day's extreme, at least 4% from the prior
  close. The medians are the informative numbers.

**Results, index and sector ETFs (SPY, QQQ, IWM, DIA, SMH, SOXX, XLK, XLF, XLE; 1995 to 2026).** Gap of 1% or more, volume
1.2x or more the prior 50-day average.
| Group | Events (distinct dates) | 5-day median, share up | 20-day median, share up |
|---|---|---|---|
| All days, for contrast | 60,933 | n/a | +1.3%, 60% up |
| Good-news failure (gap up, closed below the prior close) | 367 (225) | +2.2%, 67% up | +2.8%, 65% up |
| ... stricter: gap 1.5%+, volume 1.5x+ | 98 (55) | +3.4%, 78% up | +3.9%, 73% up |
| Bad-news failure (gap down, closed above the prior close) | 352 (184) | +0.4%, 55% up | +2.2%, 62% up |
| ... stricter | 123 (58) | +0.1%, 52% up | +2.6%, 62% up |

**What this says, plainly.**
1. As a mechanical single-stock pattern judged on daily bars, News Failure showed **no edge** in either direction. The
   short side leaned slightly bearish, about 1 to 2 points under SPY over 20 sessions, but the natural stop is so wide
   that the trade results sit at zero.
2. The bearish tilt is strongest where **B26 forbids the short**: above the 200-day, and after big runs (the exhaustion
   or climax case). Many of those look like Bracco's parabolic short with a news trigger; I did not test his full checklist on them.
3. The long version's B26-legal half (above the 200-day) was the **worst** group: median -2.3% over 20 sessions.
4. At the **index** level, a good-news failure was followed by **higher** prices more often than an average day. The
   bearish market read, used alone, has been a poor sell signal. Many of these days came inside pullbacks that ended
   soon after (2025-04-08, 2025-11-20, 2024-08-07).
5. This fits Shapiro's own rule: the failure is only the **timing** after a crowded positioning extreme. My sample had
   no crowding filter (there is no COT data for single stocks, and I did not add one for the ETFs), so it tests his
   trigger without his setup.

**Limits of my computation.**
- No news column: a 4% gap on double volume stands in for "news". Earnings tags cover only the 992 tickers in
  `docs/study/setups/earnings_dates_cache.json`.
- Daily bars only: premarket failures are invisible (CIFR on 2025-09-25 shows as a gap **down** in regular hours, see
  4.5), and intraday entries and stops cannot be tested.
- The bar store may lean toward surviving tickers; delisted collapses may be missing, which would understate short
  results.
- Events cluster on market-wide days, so they are not independent; the ETF events overlap across the nine funds.
- No commissions, borrow fees or slippage; shorts assume shares are available (D48).
- One horizon (20 sessions) and one threshold set, chosen by me. A few alternatives were checked (above); the picture did
  not change.
- My code is not peer-reviewed. Treat these numbers as a check on the idea, not as a published result.

### 4.5 The house's own named examples, checked on the bar store (**[my computation]**)
| Example | Who, when | Meant as | Bars on the day | Next 20 sessions |
|---|---|---|---|---|
| NVDA 2025-11-20 | Bracco 2025-11-23; Shapiro's "NVIDIA FAILED" 2025-11-20 | bearish (market read) | gap +5.1%, closed -3.2% in the bottom 5% of the range, 1.9x volume; high 196.00 vs close 180.64 (8.5% stop); 18.5% above the 200-day | +0.2%; lowest -6.1%, highest +4.1%; a short would not reach 2R and not be stopped |
| QQQ 2025-11-20 | same | bearish | gap +2.0%, closed -2.4% at the low, 2.0x volume | +5.4%; the low was the next day |
| QQQ 2025-07-31 | the 2025-08-03 newsletter: the unsigned index section on QQQ, and Bracco on the Nasdaq (MSFT and META gap ups) | bearish | gap +1.1%, closed -0.5% near the low, 1.4x | +2.1%; lowest -2.4% |
| MSFT 2025-07-31 | same | bearish | gap +8.2%, **closed +3.9%** but near the low (dcr 7%), 2.8x | -4.5%; not a close-down failure by Shapiro's test |
| META 2025-07-31 | same | bearish | gap +11.5%, closed +11.3%, 3.4x | -2.9%; no failure on the day |
| CIFR 2025-09-25 | Bracco 2025-09-28 ("sell the news") | bearish (overheated tape) | regular hours: gap **-3.9%**, closed -17.5%, 4.8x; the 30% premarket surge is not in the daily bar | +48%; a short would have been stopped |
| TSLA 2025-04-02 | Bracco, Discord KB summary | bullish | gap -5.2%, closed +5.3% (top 7% of the range), 2.1x; 1.8% **below** the 200-day | lowest -24.2% in the April crash; a long would have been stopped |
| BA 2024-10-29 | Manrav, Discord KB summary (a failure to the upside, paraphrased) | bullish | gap -1.9%, closed +1.5%, 7.7x; 14.7% below the 200-day | -1.5%; lowest -10.4%, stopped |
| SPY 2022-10-13 | Model Book Bottoms; course F7.04 | bullish (bottom) | gap -2.1%, closed +2.6% (top 8%), 1.8x; 12% below the 200-day | +7.8%; low held |
| RIVN 2025-12-11/12 | Bracco 2025-12-14 | bullish | 12/11 -6.1% on 2.1x after the conference; 12/12 +12.1% on 2.2x; 21% above the 200-day | from 12/12: +2.3%, highest +23.2% |
| SOXX 2026-09-14 to 09-18 | Bracco 2026-09-20 | bullish (multi-day) | 9/14 gap -5.7%, closed -5.6% (no same-day failure); 9/18 closed 177.69, back over the 9/11 close 175.69 | from 9/14: +9.5%; from 9/18: -7.4% |
| SPCX 2026-08-05 to 08-07 | Bracco 2026-08-09 and 08-16 | bullish (multi-day) | 8/5 gap -10.3%, closed -13.6% (1.9x); 8/6 +6.1%; 8/7 +15.8% to 133.11, over the pre-news close 125.33; too young for a 200-day | from 8/7: +11.1% |
| LOVE 2025-12-11 | Bracco, Discord KB summary of 2025-12-18 (it names "earnings", not a date; 12/11 is my match on the bars) | bullish (noted as a reason it might differ) | gap -14.6% on earnings, closed -7.8% but in the top 30% of the range, 3.2x; 27% below the 200-day | +26.8% |
| UPST 2025-07-14 | the owner's desk log of 2025-07-15 (KB; paraphrased: bought off bad news and the 20-day EMA; the log names no date for the news, 7/14 is my match on the bars) | bullish | gap -5.6%, closed -0.8% at the high, 1.2x; 29% above the 200-day | -15.4%; the day's low was taken out |

Four lessons from this table: the bearish index reads did not lead to declines; three of the bullish single-stock reads
(TSLA, BA, UPST) were stopped within weeks; a failure can be invisible on daily bars (CIFR premarket) or take several sessions (SOXX,
SPCX); and several of the house examples sit on the wrong side of the 200-day for B26.

---

## 5. Our app: what exists, and what looks wrong

### 5.1 There is no News Failure scanner
`api/services/pattern_engine/detectors/` has no news-failure detector (listing read 2026-11-09). The nearest pieces:
- `api/services/pattern_engine/detectors/uct/uct_oops_reversal.py` fires only the bullish Oops. Its docstring records the
  choice: "The bearish mirror (gap above the prior close, trade over the prior high, close back under the prior close) is
  NOT fired: the blind review measured only the long side." That bearish mirror is the daily shape of most good-news
  failures: in the checking pass's re-run, 1,510 of 1,880 (80%) traded over the prior day's high before closing under
  the prior close, and 1,392 (74%) opened above it [my computation]. NVDA 2025-11-20 fits it exactly.
- The Bear Gap finder (`scripts/study/find_bear_gap_examples.py`, per `TRADE_PLANS.md`) measures gaps down that **hold**,
  the opposite case.
- `app/src/components/chart/engine/ast/starterScans.json` explains why no starter scan exists: "News Failure is a headline
  that does not hold. It needs the headline, and the table declares no `news` column".

### 5.2 A dormant short label in Chart IQ
`api/services/chart_iq/engine/v3.py` (vendored; "do not hand-edit") adds `news_failure` when a mark named "Gap & fade" or
"Gap & fade (climax)" sits on the last or the prior bar **and** the close is under 4 ATRs above the 50-day average. It is
listed with the **shorts** (`double_top`, `bear_flag`, `breakdown`, `failed_breakout`, `wedge_drop`, `news_failure`). When
the call is "pass", the read adds the line `'Short side: %s; a close under %.2f confirms it.'`, where the price is the
most recent swing low of the last 15 bars (or the day's low).

The marks come from `api/services/chart_iq/engine/v3_levels.py`:
- **Gap & fade:** open 5% or more over the prior close, volume 2x or more the prior 50-day average, close under the prior
  close, and not a "big" gap.
- **Gap & fade (climax):** a "big" gap (gap 8%+ on 3x, or a close 10%+ up on 3x) on one of the last two bars that closes in
  the bottom 35% of its range when 4+ ATRs above the 50-day, or in the bottom 20% regardless; or a 3%+ gap up today
  closing in the bottom 20% (this last branch has no volume test).
- "ATR" here is the 14-day simple average of the true range, and "4 ATRs above the 50-day" is (close − 50-day SMA) ÷ ATR
  (`v2_setups.py`, `ext50`); "2x volume" is the bar's volume over the average of the 50 bars before it.

What members see: nothing. `api/services/chart_iq/pipeline.py` returns the drawn objects, card, thesis and context, but
not v3's `labels` or `read`; v3's raw marks go out only to admins (`api/routers/chart_iq.py`, "admin debugging"). `api/services/chart_iq/engine/v4_compose.py` also drops every "Gap & fade" candle mark
(about line 207).

Where it disagrees with the sources or looks wrong:
1. **No news check.** A gap on volume is assumed to be news.
2. **Short only.** The house uses the term mostly for longs.
3. **The biggest failures are routed away.** "Gap & fade (climax)" also maps to `parabolic_short` (the `EVENT_SETUP`
   table), and the `ext < 4` test removes the extended cases from `news_failure`. In my data the extended and big-run
   cases had the clearest bearish tilt (4.4; the first writer's run found closes 4+ ATR over the 50-day at -4.4% median
   over 20 sessions, 61% lower, 137 events).
4. **It matches Shapiro on one point, for the plain mark only:** "Gap & fade" requires a close **below the prior
   close**, his "closes down". The two "climax" marks do not: a 10% gap that closes up 3% but near its low, or a 3%
   gap up whose whole day stays over the prior close, can still fire `news_failure`.
5. It looks only at the last two bars, so a multi-day failure (SOXX, SPCX) cannot fire.

### 5.3 The journal tag
- `app/src/constants/setupGroups.js` (the setup list behind the Model Book's "Add Setup" picker and the journal's tags):
  "News Failure" in the **Swing** list, next to "Oops Reversal" and "Remount". No direction is stored (the same list
  also holds shorts such as "Parabolic Short" and "Wedge Drop").
- `app/src/pages/journal-2-0/lib/setupTagMap.js`: `TAXONOMY_ONLY_FAMILY['News Failure'] = 'Reversals & Reclaims'`, the same
  family as Wick Play and Red to Green (long-leaning reversal tags).
- `docs/wisdom/vocabulary/setup-vocabulary-v1.json`: no vocabulary entry ("the authors did not name it").

### 5.4 The Model Book
- `app/src/pages/modelbook/setupCatalog.js` has **no** News Failure card. Its "News/Earnings Gapper" card is the
  opposite case: "A headline-driven gap that holds its range", traded off the first pullback and reclaim.
- `app/src/pages/modelbook/bottomsCatalog.js`, signpost 4, "News Failure", phase "Turn": "Awful headlines hit", "and price
  refuses to make a new low." The detail says the market "gaps down, reverses, and closes green", "or simply holds above
  the prior low." Eight of its nine historical bottoms carry a News Failure date (2009 has none).
- An earlier audit already flagged two of those dates as not fitting the card's own definition (2020-03-23 made the new
  low; 2018-12-26 has no bad news recorded), plus date doubts on 2016-02-11, 2002-10-09 and 1987-12-04
  (`docs/study/audits/2026-10-21/auditB_summary.md`, `auditB_build.py`).
- The live course already teaches the bullish market version: F7.04 asks about SPY on 2022-10-13 and answers "Bad news
  failed. A clue, not proof" (`docs/study/courses/F7/F7.04.json`).

### 5.5 Other house files that are now out of date
- `docs/superpowers/research/setups/setup_criteria.json` (News Failure): "News Failure appears to be firm vernacular; the
  sweep found nothing outside the firm's own KB." Shapiro is the outside source.
- `docs/study/research/definitions.json` (the "News Failure (signpost 4)" entry): "House concept; no external
  definition." `docs/study/research/README.md` lists News Failure among the "Terms with only a nearest-standard stand-in
  (house name, 1 source)". Same correction.
- `docs/study/UNITS-method.md`: News Failure has "no unit; owner may add later".
- `docs/study/setups/research/05-ipo-base.md` (line 733 as of 2026-11-09, under "Failures worth showing beside the
  winners") lists SPCX's "news failure after lockup exp & earnings" among
  the IPO **failures**. Bracco used it as a bullish read (his 2026-08-09 post calls SPCX "a potential contrarian trade",
  and the stock rose 30% from the 8/5 close within 20 sessions on the bar store). That line looks misread.

---

## 6. UCT's own words

All quoted posts are public ("everyone") editions on https://unchartedterritoryy.substack.com. I searched all 103 posts in
the sitemap; one (2026-10-18) is paywalled after a short preview. Section owners come from each post's headings:
"TSDR's Weekly Outlook & Watchlist" is the owner (the 2025-11-23 post: "Bracco and I, Patrick (TSDR Trading)"); "Bracco's
Breakdown & Top Ideas" is Bracco. "Bracco's Market Health Tracker" is only a label on breadth charts inside "Market
Breadth Data". The section "Index & ETF action, hourly levels, and insights for the week ahead" (later "Index & ETFs")
names **no author**. One clue: in the 2025-10-12 post the owner writes, in his own section, "Notes and comments within the
ETF section encapsulates a lot of my approach this week" and "Was able to get the ETFs posted" (that week at least, the
ETF section was his). I list its quotes separately below rather than guess.

**The owner (Patrick, TSDR).**
- 2026-02-22, Weekly Outlook (https://unchartedterritoryy.substack.com/p/sunday-scans-04c): "I want to see strong positive
  reactions to news or news failure on negative headlines." Next: "I do not like the 1-2 days up then give the whole thing
  back like we are seeing in a few places." [bullish, as a market filter]
- 2026-11-08, Weekly Outlook (https://unchartedterritoryy.substack.com/p/sunday-scans-70f): "But I want to repeat Jason
  Shapiro’s phrase he has embedded into me." The phrase is "BE WRONG, MAKE MONEY". [shows Shapiro's influence on him]
- Discord, 2024-11-23 (repo brain file, ref `trader_archive:t0774`): he paired Jason Shapiro with News Failure in a list of
  traders and their setups. [paraphrased; member-only material]
- Desk log, 2025-07-15 (repo brain file `brain_kb_rules_2026-11-06.json`, under the Kicker and High Volume Edge
  passages): he noted buying UPST off bad news and the 20-day EMA. [paraphrased; member-only material]

**Bracco (his signed "Breakdown & Top Ideas" section).**
- 2025-08-03, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-726): the Nasdaq gave back July
  "following a news failure event on the euphoric earnings gap ups in MSFT and META". [bearish, market]
- 2025-09-14, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-461), before a Fed meeting: "I will be
  mindful of a potential classic “sell the news” move on rate cuts. I don’t think that should be taken as very bearish
  considering the broader picture of the market structure right now." [a scenario, not a sell signal]
- 2025-09-28, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-9a2), CIFR after a contract headline (it
  "surged over 30% in premarket Thursday"; he calls it "The only standout setup" among his parabolic short candidates):
  "The move quickly turned into a “sell the news” reaction, with CIFR fading nearly 37% off its highs by the close." And:
  "We saw a similar pattern in names like CRWV and NVDA, both of which sold off despite positive news", "often a sign of an
  overheated tape that’s ready for a pullback." [bearish, market; he does not call it a news failure]
- 2025-11-23, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-56d): "The major news failure on NVDA’s
  earnings was all I needed to see to know this market needs some more time." [bearish, market]
- 2025-12-14, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-f2f), RIVN: "Huge shakeout / news failure
  on Thursday following the conference and displaying characteristics that you typically see at the turning point of a
  stage 1 base." [bullish, stock]
- 2026-06-28, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-ae1): "the market failing to follow through
  and getting sold into on good news such as the Peace Deal and Microns blowout earnings report." Paired with rising
  bullish sentiment: "That is a perfect recipe for the market to continue to consolidate or even correct lower." [bearish,
  market; the idea without the name]
- 2026-08-09, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-1ad), SPCX: "Knew how negative the sentiment
  and positioning was into the large lockup expiry following earnings. Created a perfect storm for a potential contrarian
  trade." Same post on SOXX: "When the group that lead the market down fails to follow through lower despite negative
  sentiment and headlines, you pay attention." [bullish]
- 2026-08-16, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-da5), SPCX: "Tons of volume off the lows
  with recent news failure after lockup exp & earnings." [bullish]
- 2026-09-20, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-bc2), SOXX: "With the SOXX closing back
  above the the close from 9/11 I am considering last week a classic news failure and a potential bottom for the group."
  And: "Biggest regret I have last week was not paying more attention to the potential news failure setting up in
  semiconductors." He adds that he "was looking at SOXL for a long trade on Monday" but did not take it. [bullish]
- 2026-10-11, Breakdown (https://unchartedterritoryy.substack.com/p/sunday-scans-31b), IWM with crowded shorts: "Last two
  times large speculators were this short were July 2024 and August 2025, which resulted in vicious short-term moves higher
  as this positioning unwound." "I was aggressively long IWM call options on both of those occasions". And: "Typically see
  catalysts responsible for igniting moves like this." [the Shapiro setup without the name]
- 2025-06-13, "The Parabolic Short" (quoted in 3.8): the failing news as one possible trigger of a parabolic top.

**The unsigned "Index & ETF" section (no author named; probably the owner, see the note above).**
- 2025-08-03 (https://unchartedterritoryy.substack.com/p/sunday-scans-726), QQQ: "Major news failure and distribution took
  place on Thursday Gap up following META and MSFT earnings reactions. This lead to quick downside and a 4.0% pullback
  from the open on Thursday." [bearish, market]
- 2025-11-02 (https://unchartedterritoryy.substack.com/p/sunday-scans-b99), QQQ: "We have positioning metrics and reading
  that are reaching contrarian bullish levels. That is combined with a potential “news failure” on the China/US meeting
  reaction." [bearish caution, Shapiro's two-part logic; the same paragraph says the week "does bring me some mindfulness"]
- 2026-09-20 (https://unchartedterritoryy.substack.com/p/sunday-scans-bc2), IWM: "Watching for that Jason Shapiro crowded
  COT positioning + news failure of sorts to play out potentially." [bullish]
- 2025-07-13 (https://unchartedterritoryy.substack.com/p/sunday-scans-6a6): "Our group originally drew interest to Ethereum
  after a post a few weeks back from Jason Shapiro (Crowded_Mkt_Rpt) on X." [Shapiro as a source]

**Unsigned intro.** 2026-06-07 (https://unchartedterritoryy.substack.com/p/sunday-scans-d16): "This was the first sign, not
the extension per se but that combined with the bearish oops and sell off on the gap up to start the day." (QQQ; no news
named.)

**Other UCT voices (repo brain files; paraphrased because they are member-only Discord summaries).**
- Manrav, 2024-10-29: an Oops reversal teaching thread that also calls BA's day a news failure to the upside (bullish).
- Bracco, 2025-04-02: TSLA was set up by a news failure plus a red-to-green push before a headline added fuel (bullish).
- Bracco, 2025-12-18: on a member's LOVE idea, he noted the stock had a news failure on earnings (bullish, a reason it
  might act differently this time).
- Bracco, 2026-07-07: among his red flags for a possible short, a selloff on good news (bearish).

What the house record adds up to: the owner and Bracco use News Failure as Shapiro does, a **read** of how price answers
the news, mostly to find **lows** and to judge the **market**. No UCT post I found gives an entry, stop or target for a
News Failure trade.

---

## 7. How it fits the owner's account rulebook (section 9)

| Rule | What it says | Fit with News Failure |
|---|---|---|
| **B26** (hard rule) | no longs below the 200-day, no shorts above it, except parabolic | **Major conflict.** Good-news failures in my scan split 874 above / 924 below the 200-day; the bearish tilt lived in the above-200 half, which B26 forbids unless the move is parabolic. For the long, the B26-legal half (above the 200-day) was the worst group. Most bullish market-bottom failures (SPY 2022-10-13, TSLA 2025-04-02, BA 2024-10-29) were below the 200-day. |
| **A13**, A3, F62 | stop a few cents beyond the day's extreme; usually within about 3%; skip if the honest stop does not fit | **Major conflict.** The day's-extreme stop sat a median 11.9% (short) and 10.6% (long) from the close, and 7.4% / 7.1% even from an intraday entry at the prior close. None of 3,456 events was within 3% (the 4% gap filter guarantees that, so the medians are the real evidence). |
| **E57** | market orders | fits: enter at market on the trigger |
| **C28** | no chasing more than 4% past the buy point | fits as a mirror: no shorting more than 4% under the trigger (the prior close) |
| **C29** | skip a long more than 10% over its 10-day | probably rare (a stock that just gapped down on bad news is seldom 10% over its 10-day); not measured |
| **C31** | leaders with RS 80+; shorts the weakest (RS 20 or less); except parabolic and mean reversion | **Conflict for the short, where the tilt was.** About half the good-news failures in the scan sat above the 200-day (874 of 1,798), and those, the ones that leaned bearish, are the stronger stocks C31 does not short; the ones below the 200-day are closer to C31's weak stocks but showed no tilt. RS itself was not measured. It only fits if the owner counts it as mean reversion. |
| **D47** | shorts are our long setups reversed | fits naturally: the two directions are mirrors |
| **D46**, F65 | Red market: mostly cash and shorts below the 200-day; Orange: A+ only | the short version belongs in Orange and Red markets |
| **B18** | the app's market reading decides when the account trades | fits; the newsletter (Bracco's section and the unsigned index section) uses the market version as part of this read |
| **C32** | no news-day rule; Fed and CPI days are traded like any other | no conflict: C32 is about not avoiding news days; this setup reads the reaction after one |
| **B22** | no new buys in the 3 days before earnings | fits: the trade starts on or after the report |
| **B20** | a gap through the stop: the first 30-minute low (or high, short) is the new stop; out past 2R | applies |
| **B19**, E51, E52 | breakeven at 2R to 5R; a third at 3R, a third at 5R; trail the 10-day or 21-day | applies; with stops near 10%, 3R is a 30% move, so the trims will rarely be reached |
| **C33** | time stop: under 1R after 10 sessions | applies; with stops near 10%, most trades will still be under 1R after 10 sessions (my inference from 4.4, not separately measured) |
| **D48** | skip hard-to-borrow shorts | applies; check the borrow before shorting a smaller name |
| **B23** | $10+ and $20M a day | applied in my scan |
| **E56** | 3 tries a week, 6 a month on one stock | applies |
| **E54** | leveraged ETFs preferred | fits the index version (SOXL, which Bracco looked at for the 2026-09 semiconductor news failure but did not take; for crowded IWM shorts he used call options, B25) |

---

## 8. Proposed rules for our course

### 8.0 The recommendation in one paragraph
Teach News Failure first as **a read**, the way its originator and the house use it: when big news meets the opposite
reaction by the close, it confirms another setup or a market turn. Teach the **trade** only as an add-on to a house setup
the read confirms (Oops Reversal, Red to Green, U&R, Kicker for longs; their mirrors and the parabolic short for shorts),
with that setup's entry and stop. Reason: Shapiro never trades it alone, the house never wrote it up as a trade, and my
data found no stand-alone edge with the natural stop. If the owner wants a stand-alone setup anyway, 8.1 to 8.7 give a
measurable version for each direction.

### 8.1 What it is (both directions)
| Line | News Failure, long (bad news fails) | News Failure, short (good news fails) | Basis |
|---|---|---|---|
| The news | a dated catalyst: earnings or guidance (the report day if before the open, the next day if after the close), a product or conference event, an offering or lockup, an analyst action; for an index, a macro release | the same | [originator] (earnings, CPI) + [UCT] (conference, lockup, an earnings report, a weekend story) + [my proposal] (offerings, analyst actions, the before/after-the-open dating) |
| Scanner stand-in (no news column) | open 4% or more under the prior close on 2x or more the prior 50-day volume (stocks); 1% or more on 1.2x (index ETFs) | open 4% or more over the prior close, same volume | [my proposal] (the app's Chart IQ uses 5%) |
| The failure | closes **above the prior close** that day; or closes back above the pre-news close within 3 sessions | closes **below the prior close** that day | [originator] (same day) + [UCT] (Bracco's SOXX and SPCX, multi-day; the "3" is [my proposal]) |
| Grade-up shape | closes in the top 25% of the range; the low undercut the prior low (an Oops) | closes in the bottom 25%; closes under the prior day's low (bearish Oops, key reversal) | [my proposal], from Bulkowski's key reversal and the house Oops |
| Prior trend / crowding | a fall of 25% or more over 60 sessions, or crowded shorts (index COT, Bracco's IWM) | a run of 50% or more over 60 sessions, or 4+ ATRs over the 50-day, or crowded longs | [originator] (crowded positioning) + [my proposal] for the numbers, guided by [my computation] (the tilt grew with the prior run: 60-day runs of +50% to +100% and of +100% or more, and closes 4+ ATR over the 50-day, all leaned lower; the -25% fall is a tested bucket). The price numbers are measurable; "crowded" is not yet: none of the sources read gives a numeric COT threshold for "max crowded" (Shapiro's posts name only the neutral exit, "an indexed score of around 50"). Question 7. |
| Location (B26) | above the 200-day, unless it is a parabolic long | below the 200-day, unless it is a parabolic short by Bracco's checklist | [house rule] |
| Liquidity | $10+ and $20M a day | same | [house rule] B23 |
| Strength | RS 80+ for a stock long (C31) | RS 20 or less (C31 mirror), unless the owner rules it mean reversion | [house rule], question 4 |

### 8.2 The entry
- Long: a market order when price trades back **over the prior close** (red to green) on the news day, or at the close if
  you wait for Shapiro's close confirmation. [house rule] E57 (market orders) + [originator] for the close version only
  (his written rule: the trade "is entered at the close", 2024-01-08; Cotton "can be executed on the close"); the
  intraday version is [my proposal], borrowed from the house's Red to Green tag.
- Short: a market order when price trades back **under the prior close** (green to red), or at the close. Same basis as
  the long. Bracco's parabolic short waits for a break under the intraday VWAP instead (3.8). [house rule] E57 +
  [originator] (close) + [my proposal] (intraday)
- If the stock already moved more than 4% past the trigger, skip it. [house rule] C28, mirrored for the short.
- Multi-day version (long only): buy the first close back over the pre-news close within 3 sessions. [UCT] + [my proposal]

### 8.3 The stop
- Default: a few cents beyond the news day's extreme so far (under the low for a long, over the high for a short).
  [house rule] F62 + [source consensus] (Qullamaggie and Bracco both put the parabolic short's stop at the day's high)
- Expect it to be wide: a median of about 7% from the intraday trigger and 11% to 12% from the close (4.4). By A3 and A13,
  if that does not fit the risk budget, **skip** or size down; do not tighten it into the noise. [house rule]
- The originator's version: the stop level is the failure day's high (short) or low (long), the post-news extreme if the
  news came mid-session, and it is hit only when a session **closes** beyond it. [originator] (2024-01-08 post; Cotton,
  2024-04-24; RBOB, 2024-09-11). It differs from F62's stop order with the broker (D41); my test of it found no edge
  either (4.4). Question 3.
- The owner may choose a tighter intraday stop instead (a VWAP reclaim, per Qullamaggie), but I have no data on it.
  [my proposal], question 3.

### 8.4 Trims and trail (house defaults)
- Breakeven at 2R to 5R; a third at 3R; a third at 5R; trail the last third with a close beyond the 10-day (fast) or
  21-day (steadier). [house rule] B19, E51, E52
- Gap through the stop: the first 30-minute extreme is the new stop; out past 2R. [house rule] B20
- Under 1R after 10 sessions: out. [house rule] C33
- If the short qualifies as a parabolic short, use Bracco's 9EMA target instead. [UCT] + [house rule] D47

### 8.5 What invalidates it
- Price takes out the news day's extreme (the stop). [originator] (a new extreme means the turn was not picked; in his
  written trades it is a close beyond that extreme)
- The next session closes back on the news side of the prior close (the failure itself failed). [my proposal]
- No crowding: the stock or market was not stretched or crowded before the news. Shapiro would not trade it. [originator]
- The news was a takeover or a takeover rumor (for the short). Bulkowski, on event jumps: "Avoid those stocks with
  takeover rumors as they tend to stay high or move even higher." [one outside source, Bulkowski; not consensus] +
  [my proposal]

### 8.6 The short mirror
Built in: the two columns in 8.1 are mirrors (D47). The house uses the long column far more; the short column collides
with B26 and C31 (section 7).

### 8.7 Best market conditions
- Long: after a correction, near washed-out breadth (the Model Book's Bottoms signposts), crowded shorts; a market reading
  turning back toward Green. [UCT]
- Short: an Orange or Red reading (F65, D46); good news being sold across the market (Bracco, 2026-06-28); crowded longs
  and rising bullish sentiment. [UCT] + [originator]

### 8.8 Common mistakes
1. Treating one failure as proof. The course already says "A clue, not proof" (F7.04). [UCT]
2. Trading it with no crowding behind it. Shapiro waits "weeks or even months" for both parts. [originator]
3. Shorting the first red hour of a real Episodic Pivot in a leader. Qullamaggie calls a gap that "gapped up slightly
   but sold off" "not an EP", a reason not to buy it; he does not call it a short, and a 10%+ EP gap that dips intraday
   has not yet closed red. [one outside source, Qullamaggie] + [my proposal]
4. Reading the bearish index version as a sell signal. In my data it was followed by higher prices more often than an
   average day (4.4). [my computation]
5. Missing that the failure happened in premarket (CIFR) or across several sessions (SOXX, SPCX). [UCT]
6. Tightening the stop to make the size work. Skip instead. [house rule] A3
7. Calling an earnings breakdown a news failure. If the gap down keeps going, the news worked (the owner's Bear Gap
   rulings). [UCT]
8. Chasing a missed one. Shapiro: "I miss a trade, I miss it." [originator]

### 8.9 Examples to model (candidates, not yet shown to the owner)
**From the house record** (bar facts in 4.5): SOXX 2026-09-14/18 and SPCX 2026-08-05/07 (multi-day bullish); RIVN
2025-12-11/12 (bullish, two-day); SPY 2022-10-13 (bullish bottom, below the 200-day); TSLA 2025-04-02 and BA 2024-10-29
(bullish shapes that failed, below the 200-day); NVDA and QQQ 2025-11-20, QQQ 2025-07-31 (bearish reads that did not lead
to declines); CIFR 2025-09-25 (premarket failure); MSFT 2025-07-31 (a fade that still closed up).

**From my scan, every 2026 event that passes the rule** (liquidity, B26 and a strong shape; outcomes over 20 sessions;
[my computation]). The first draft called its lists "picked by rule, not by outcome" but left out 6 events that passed
the same rule in its own event file (RDDT, ITGR; KORU, ESTA, MRAM, CMPS), and all 4 omitted longs were stop-outs. The
checking pass restored the full list, re-run on the current store (which has since gained LEVI). Percentages are the
price change over 20 sessions, so for a short a negative number is the good direction. "Open" means neither the stop
nor 2R was hit. Stop: $0.03 beyond the day's extreme, touched intraday.
- Short (below the 200-day; gap 5%+, volume 3x+, closed under the prior close in the bottom 25% of the range; fewer than
  5 such events that day), 14 events: AMSC 2026-02-05 (stopped), ELF 2026-02-05 (stopped), HIMS 2026-02-05 (2R reached),
  RDDT 2026-02-06 (open, -1%), SPSC 2026-02-13 (open, -4%), ITGR 2026-02-19 (open, +2%), AVAV 2026-03-02 (open, -15%;
  45% stop), RYTM 2026-03-20 (open, flat), BYND 2026-04-21 (open, -28%), TNDM 2026-05-08 (stopped), LAZ 2026-06-08
  (open, -11%), ALNY 2026-07-09 (open, -31%), PL 2026-09-04 (open, -4%), VERA 2026-09-15 (2R reached on day 20).
  Tally: 2 reached 2R, 3 stopped, 9 open. (BE 2026-07-29 also passes the shape but fell on a day with 5 such events;
  it was stopped the next day.)
- Long (above the 200-day; gap down 5%+, volume 3x+, closed over the prior close in the top 25% of the range; fewer than
  5 such events that day), 15 events: LEVI 2026-01-29 (open, +8%), RXO 2026-02-06 (stopped), NEO 2026-02-17 (stopped),
  VICR 2026-02-20 (open, -3%), LIVN 2026-02-25 (stopped), KORU 2026-03-09 (stopped; a leveraged ETF), DOCN 2026-03-25
  (stopped), CAR 2026-04-14 (2R by day 4; -63% by day 20), ESTA 2026-05-06 (stopped), MRAM 2026-05-12 (stopped), ATRO
  2026-05-13 (open, +18%), CMPS 2026-07-07 (stopped), CALM 2026-07-22 (stopped), KSS 2026-08-26 (open, -4%), HPE
  2026-09-03 (open, +27%). Tally: 1 reached 2R, 9 stopped, 5 open.

These lists show what the averages say: a mix, with wide stops, and for the B26-legal long a poor one. They are for
chart review, not proof.

---

## 9. Grading (cues, not a checklist; E50 says grading is his judgment)

**A+ (the sources' strongest cues)**
- Crowded the other way before the news: max positioning (index COT) [originator], or a parabolic run for a stock
  (Bracco's checklist, B26) [UCT].
- Big, clear news that "should" move it: a major earnings beat or miss, a CPI print, a market-moving event. [originator]
- A full reversal on the day: the gap is erased and the close is beyond the prior close, near the far end of the range,
  ideally beyond the prior day's extreme (key reversal or Oops). [originator] for the close beyond the prior close;
  the rest is [my proposal], drawn from Bulkowski's key-reversal shape and the house Oops. Note that Bulkowski's own test
  of that shape found "51% actually continue higher", so the shape alone is not an edge.
- Heavy volume. [source consensus]: Bulkowski's good-earnings-surprise page ("heavy announcement day volume, above the
  30-day average"), and his gaps page and ChartSchool (exhaustion gaps come on "high volume"). The 2x figure is the app's Chart IQ
  threshold and my scan's, not a number from those sources. [UCT] (the app's Chart IQ) + [my proposal]
- It confirms a house setup in the same direction (an Oops, a Red to Green, a U&R or a reclaim for longs; a parabolic
  short for shorts). [UCT]
- The market agrees: a washed-out market for the long; an Orange or Red reading for the short. [UCT]
- On the right side of the 200-day for B26, and a stop that fits the risk budget. [house rule]

**B- (still a read, weak as a trade)**
- Small or unclear news; volume barely above normal.
- A partial fade: off the high but still closing on the news side (MSFT 2025-07-31 closed +3.9%).
- No crowding before the news.
- Against the market's trend; or a stock whose past setups of the same kind mostly failed (Bracco's LOVE note, in
  paraphrase: most of that stock's crossbacks had failed quickly, so ask what is different this time; he named the
  earnings news failure as one difference).
- A stop far wider than 3%.

---

## 10. Questions for the owner

1. **Which direction is our "News Failure"?** (a) the long, bad news fails (how you and Bracco use it); (b) the short, good
   news fails (how the task and the Chart IQ label frame it); (c) both, named "News Failure (long)" and "News Failure
   (short)". I recommend (c), with the long taught first.
2. **A setup or a read?** (a) a stand-alone setup with its own plan; (b) a read that confirms other setups and the market,
   the way Shapiro uses it. I recommend (b), because neither Shapiro nor the house trades it alone and my data found no
   stand-alone edge.
3. **The stop.** The news day's extreme is usually 7% to 12% away, far past your usual 3%. (a) keep it and skip trades
   that do not fit (A3); (b) use an intraday stop (VWAP reclaim, the first 30-minute extreme); (c) Shapiro's own
   close-based stop at the failure day's extreme (his written rule, 3.2; it conflicts with D41's real stop order and
   tested no better, 4.4). I recommend (a) unless you want to test (b).
4. **B26 and C31 for the short.** (a) keep the hard rule: short only below the 200-day, or as a parabolic short; (b) treat a
   News Failure short above the 200-day as a mean-reversion exception; (c) above the 200-day, use it only to sell longs or
   reduce exposure. I recommend (a) plus (c): the above-200 cases with the clearest tilt
   were the stretched ones (big prior runs, climax-like days), which is ground the parabolic short already covers.
5. **Same day or a few days?** (a) the same day's close only (Shapiro's usual test); (b) up to 3 sessions to recover the
   pre-news close (Bracco's SOXX and SPCX; Shapiro also read a run of days once, in January 2024). I recommend (a) for
   shorts and (b) for longs.
6. **Does the news have to be real news?** (a) a confirmed catalyst only; (b) a gap of 4% (or the app's 5%) on 2x volume
   is enough for the scanner. I recommend (a) for teaching, (b) for scanning.
7. **Crowding.** Should a lesson require crowding first (index COT for ETFs; a big prior run or fall for stocks)? Shapiro
   requires it.
8. **The index version.** Allow trading leveraged ETFs (E54) on an index or sector news failure, as Bracco considered with
   SOXL in September 2026? If yes, which gap and volume thresholds (my scan used 1% and 1.2x)?
9. **Two cards, one name.** The Bottoms signpost and the swing tag share the name. Keep both, or rename the signpost
   "Bad news fails"?
10. **The dormant Chart IQ label.** Leave it, remove it, or change it to fire both directions with a news check? (It is
    vendored code; a change goes through the lab's build script.)
11. **Your own trades.** Which journal trades did you tag News Failure, and were they longs or shorts? Three to five would
    let the course model your version.

---

## 11. Sources (all read on 2026-11-09)

| # | Source | Publisher / author | Published | Reliability note |
|---|---|---|---|---|
| 1 | "Winning Wall Street: Jason Shapiro's Trading Triumphs", https://wealthion.com/news/winning-wall-street-jason-shapiros-trading-triumphs | Wealthion Team; host James Connor; guest Jason Shapiro | page 2025-11-20 (recorded in 2024) | Originator's spoken words; machine-style transcript with small errors. Performance claims are the publisher's. |
| 2 | Crowded Market Report home page, https://www.crowdedmarketreport.com/ | Jason Shapiro / CMR | current page | Originator; marketing page. Bio sentences quoted. |
| 3 | Crowded Market Report Substack, all 323 posts in https://crowdedmarketreport.substack.com/sitemap.xml (via the public post API; 298 public); quoted: weekly-cmr-cot-charts-review-_-equities, weekly-cmr-cot-charts-review-_-equities-829, 1st-big-winning-trade-of-the-year, pour-some-sugar-on-me, cmr-chart-of-the-week-copper, the-nasdaq-short, real-feedback-on-trading-from-a-cmr, anatomy-of-a-cmr-trade-a-winner-and, why-i-dont-chase-trades, market-news-failure; titles also from nvidia-failed, bullish-nvida-earnigns-bearish-stock, stock-market-rallies-on-bad-newsis, stocks-up-on-bearish-news-is-it-time, cpi-beat-but-stocks-fell, fed-shocker-why-the-market-rallied, nvidia-closes-down-and-the-nasdaq, bullish-news-no-longer-enough (all at https://crowdedmarketreport.substack.com/p/...) | Jason Shapiro (byline on every post; five January 2024 posts end "Published by The CMR Team on behalf of Jason Shapiro") | 2023-12-24 to 2026-11-09 | Originator, primary. Many posts are videos with a line of text; I read text and titles only, not the videos. The 2025-01-23 checklist is a member's words that he republished. |
| 4 | Chat With Traders ep. 286 page, https://chatwithtraders.com/episode/286-jason-shapiro-overcrowded-trades-what-everyone-else-is-not-seeing | Chat With Traders | 2024-08-28 | Show notes only; no transcript; nothing quoted. |
| 5 | Stansberry Investor Hour ep. 480 page, https://stansberryresearch.com/stansberry-investor-hour/episode-480-jason-shapiro-most-traders-are-focused-on-the-wrong-thing | Stansberry Research | 2026-09-01 | "The transcript is coming soon."; nothing quoted. Its guest bio repeats the CMR line (he "combines Commitment of Traders data with news failure analysis"); publisher text. |
| 6 | The Wall Street Coach ep. 76, https://thewallstreetcoach.com/blog/the-contrarian-trading-style-of-unknown-market-wizard-jason-shapiro/ | Kim Ann Curtin | 2023-04-21 | Audio only; nothing quoted. |
| 7 | AlphaMind podcast #72, https://www.thealphamindpodcast.com/72-jason-shapiro-through-trader-hell-and-back-to-market-wizard/ and FXStreet repost, https://www.fxstreet.com/amp/education/through-trader-hell-and-back-to-market-wizard-202107190943 | The AlphaMind Project | 2021-06-29 / 2021-07-19 | Show notes only; nothing quoted. |
| 8 | UCT Substack, all 103 posts in https://unchartedterritoryy.substack.com/sitemap.xml (via the public post API); quoted: sunday-scans-04c, -70f, -726, -9a2, -461, -296, -b99, -56d, -f2f, -ae1, -1ad, -da5, -bc2, -31b, -6a6, -d16, the-parabolic-short | Uncharted Territory (Patrick, TSDR Trading; Bracco; the "Index & ETF" section is unsigned) | 2025-06-13 to 2026-11-08 for the quoted posts | House source, quoted exactly; all quoted posts are public editions. Authorship taken from section headings only. |
| 9 | Thomas Bulkowski, https://thepatternsite.com/ pages idcb.html, earnsgood.html, earnsbad.html, dcb.html, KRU.html, gaps.html, eventpatterns.html, chartpatterns.html | Thomas N. Bulkowski | pages current; KRU tested 1990 to 2013 | Measured, but "hundreds of perfect trades" with few dates. **The site states it "shall not be used to train artificial intelligence (AI) systems".** Read through a fetch tool (direct requests refused, HTTP 406); short quotes only. |
| 10 | "3 TIMELESS setups that have made me TENS OF MILLIONS!", https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Kristjan Kullamägi | 2021-01-08 (updated 2021-04-28) | Originator of his own setups; primary. |
| 11 | "How to master a setup: Episodic Pivots", https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/ | Kristjan Kullamägi | 2021-11-02 | Primary. |
| 12 | "Gaps and traps", https://stockbee.blogspot.com/2006/11/gaps-and-traps.html | Pradeep Bonde (Stockbee) | 2006-11-22 | Primary (his answers in the thread). Old; general, not a rule set. |
| 13 | "Earnings and Bulkowski", https://stockbee.blogspot.com/2007/04/earnings-and-bulkowski.html | Pradeep Bonde | 2007-04-04 | Read for context; not quoted. |
| 14 | "Gaps and Gap Analysis", https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis | StockCharts ChartSchool | no date shown on the page; its stored timestamp is 2024-09-25 ("Last updated 2 years ago") | Established educator; no author shown. |
| 15 | Edwin Lefèvre, *Reminiscences of a Stock Operator* (1923), Project Gutenberg eBook #60979, https://www.gutenberg.org/ebooks/60979 (found through https://en.wikipedia.org/wiki/Reminiscences_of_a_Stock_Operator) | Edwin Lefèvre | 1923 | Public domain; a novel narrated by a character widely read as Jesse Livermore. Chapter X quoted. |
| 16 | Richard Wyckoff (as Rollo Tape), *Studies in Tape Reading* (1910), Internet Archive text, https://archive.org/details/studiesintapere00wyckgoog (linked from https://en.wikipedia.org/wiki/Richard_Wyckoff) | Richard D. Wyckoff | 1910 | Public domain; OCR text with scanning errors; quotes corrected only for obvious OCR characters ("Considerable" was scanned with a stray symbol). |
| 17 | Linda Raschke article PDFs listed at https://lindaraschke.net/articles/ (11 files) | Linda Bradford Raschke | 1997 to 2006 | Searched for news-reaction rules; none found; nothing quoted. Three files are scans with no text layer. |
| 18 | IDEAS/RePEc record for Wesley S. Chan, "Stock price reaction to news and no-news: drift and reversal after headlines", *Journal of Financial Economics* 70(2), 2003, pp. 223-260, https://ideas.repec.org/a/eee/jfinec/v70y2003i2p223-260.html | RePEc | 2003 | Bibliographic record only ("No abstract is available"); the paper itself was paywalled (HTTP 403). Not used for any claim. |
| 19 | The app's daily bar store (local read-only copy of `bars.db`) and `docs/study/setups/earnings_dates_cache.json` | this app | bars to 2026-11-06 | Used for every [my computation] number; method and limits in 4.4. The checking pass re-ran the main numbers with its own script on the same store (by then 4,284 tickers) and capped bars at 2026-11-06. |
| 20 | Repo files: `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `app/src/pages/modelbook/setupCatalog.js`, `app/src/pages/modelbook/bottomsCatalog.js`, `app/src/components/chart/engine/ast/starterScans.json`, `api/services/chart_iq/engine/v3.py`, `api/services/chart_iq/engine/v3_levels.py`, `api/services/chart_iq/engine/v2_setups.py`, `api/services/chart_iq/engine/v4_compose.py`, `api/services/chart_iq/pipeline.py`, `api/routers/chart_iq.py` (the member fields; the raw marks are admin-only), `api/services/pattern_engine/detectors/uct/uct_oops_reversal.py`, `docs/study/TRADE_PLANS.md`, `docs/study/sizing_rule.md`, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`, `docs/study/audits/2026-10-21/auditB_summary.md`, `docs/study/courses/F7/F7.04.json`, `docs/study/UNITS-method.md`, `docs/study/research/definitions.json`, `docs/study/research/README.md`, `docs/superpowers/research/setups/setup_criteria.json`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`, `docs/study/levels/brain_kb_cycle_2026-11-06.json`, `docs/study/levels/brain_kb_rules_2026-11-06.json`, `docs/study/setups/research/05-ipo-base.md` | this repo, branch feat/study-content | as of 2026-11-09 | Read directly. The brain files hold member-only Discord material: paraphrased here, wording not copied. |

**Not read, and why.**
- Jack Schwager, *Unknown Market Wizards* (2020), the Shapiro chapter (a third-party course summary lists it as "Jason
  Shapiro: The Contrarian"): no copy in this session. Nothing is quoted from it.
- TraderLion, "Jason Shapiro's 30+ Years of Contrarian Trading Secrets"
  (https://traderlion.com/investing-champions/jason-shapiro-trading-secrets/): refused (HTTP 403) both by direct request
  and by the fetch tool. Not used.
- Chat With Traders ep. 245 ("The Mind of a Tape Reading Contrarian Trader w/ Jason Shapiro"): the search-result link
  redirected to the site's home page. Not used.
- Shapiro's videos (Substack, YouTube) and his podcasts: no transcripts were available except Wealthion's.
- Linda Raschke and Larry Connors, *Street Smarts* (1995), and other books that may discuss reactions to news (O'Neil,
  Minervini, Morales and Kacher): no copies here; I do not cite them.
- IBD / investors.com articles on earnings gaps that fail: I had no exact links and no search budget left.
- A search-result summary mentioned a 2025 WTFinance episode with a chapter titled "Bad news, no reaction". I did not open
  the page, so it is not used as a source.

---

## Removed or corrected in checking (cold check, 2026-11-09)

Every quote in this file was re-opened at its source (web pages fetched again; Bulkowski's pages through a fetch tool,
since direct requests return HTTP 406), every code claim was re-read in the repo, and the bar numbers were re-run with a
separately written script. What changed:

**Wrong or unsupported, now fixed**
1. **Authorship of four UCT quotes.** The 2025-08-03 QQQ line ("Major news failure and distribution..."), the
   2025-11-02 China/US line, the 2026-09-20 IWM/Shapiro line and the 2025-07-13 Ethereum/Shapiro line were credited to
   "Bracco, Market Health Tracker". All four sit in the newsletter's "Index & ETF" section, which names no author;
   "Bracco's Market Health Tracker" is only a label on breadth charts in another section. The count "Bracco 9, the owner
   1" became 6 in Bracco's signed section, 1 in the owner's, 3 unsigned. A clue that the unsigned section is the owner's
   (2025-10-12) is now quoted, and no author is asserted.
2. **The Chart IQ rule.** 3.9 and the short version described only the plain "Gap & fade" mark; two "climax" marks also
   feed `news_failure`, and they do not need a close below the prior close, so 5.2's "it requires a close below the
   prior close" holds for the plain mark only. The 4.4 row "the app's own rule" tested only the plain mark and is now
   labelled so.
3. **"None of 3,456 events had it within 3%"** was presented as a finding. A 4% gap filter makes it true by construction
   (the day's extreme is at least 4% from the prior close); it is now flagged in the short version, 4.4 and section 7.
4. **8.9's 2026 example lists**, described as "picked by rule, not by outcome", left out 6 events that met the same rule
   in the first draft's own event file (RDDT, ITGR; KORU, ESTA, MRAM, CMPS), and all 4 omitted longs were stop-outs. The
   full lists are restored, with tallies.
5. **Basis tags.** "[source consensus]" was on four lines backed by one source or none: the takeover line (only
   Bulkowski, and he wrote "takeover rumors"); "a true EP that dips is still an EP" (not in Qullamaggie's text, removed);
   the A+ "full reversal ... key reversal or Oops" (now [originator] for the close, [my proposal] for the rest, with
   Bulkowski's 51% caveat); "Heavy volume, 2x or more" (heavy volume has two sources; the 2x does not). In 8.1 "a run of
   50% or more" was tagged [my computation] though no test used 50% as a rule; retagged [my proposal]. In 9 "a parabolic
   run for a stock" was tagged [originator]; it is UCT's (Bracco's checklist). A tag [one outside source] was added.
6. **Bulkowski.** "'perfect trades' are hand-picked" is not stated on his pages (they point to a glossary where I could
   not find the term); removed. The exhaustion-gap figures are from his bull-market table (now said). The comparison
   table's "Entry: next day after the breakout" is not on his pages; replaced with what they say.
7. **"He trades futures and indexes ..., not single stocks"** stated something about Shapiro no source states; replaced
   by what he says ("a seasoned futures trader") and what the read trades show.
8. **Shapiro's post titles.** "STOCK MARKET RALLIES ON BAD NEWS—IS THIS THE STRONGEST SIGNAL YET?" is one title (it was
   split in two); "STOCKS UP ON BEARISH NEWS. Is it Time to Cover Yen Shorts?" was cut short. Both now exact.
9. **SOXL / TQQQ "as Bracco used".** Bracco wrote that he was looking at SOXL and did not take it; TQQQ is not in his
   section. Section 7 (E54) and question 8 corrected.
10. **Section 7, C31:** "A good-news failure usually hits a strong stock" was not measured and the scan shows about half
    were below the 200-day; reworded.
11. **Smaller fixes:** `05-ipo-base.md`'s SPCX line is now at line 733, not 640; the owner's UPST desk log sits under the
    Kicker and High Volume Edge passages of `brain_kb_rules_2026-11-06.json`, not "Gap Support"; "House concept; no
    external definition." is in `definitions.json` only, not `README.md`; ChartSchool's page does show "Last updated 2
    years ago"; Wyckoff's Steel news came out on February 19, 1909 and the tape he reads is the next session; the RBOB
    post does not call its entry day a news failure; the "Stopped" column also counts stop-outs after 2R was reached
    (now said); the LOVE and UPST bar dates are the first draft's matches, not dates in the KB text (now said);
    "a news failure 'to the upside'" lost its quote marks (member-only wording).

**Added (missed by the first draft)**
- Shapiro's own written definition and trade rules from his newsletter: 2024-01-01 (the definition), 2024-01-08 (entry
  at the close, stop at that day's high, "~40% win rate", a multi-day reading), 2024-04-24 Cotton (a classic case;
  close-based stop at the post-report high; exit at an index score near 50), 2026-02-09 Sugar (the one-line formula),
  2024-05-06 Copper, 2026-11-09 his current Nasdaq short (with a bar check that shows a daily ETF chart cannot replay
  it), and a member checklist he republished (labelled as the member's words). These change 3.10, 3.11, 8.2, 8.3, 8.5
  and question 3.
- A test of Shapiro's close-based stop on the re-run events (4.4): still no edge.
- UCT: Bracco's 2025-09-14 "sell the news" scenario ("I don't think that should be taken as very bearish"), his VWAP
  entry rule from "The Parabolic Short", CIFR as his "only standout" parabolic short candidate, his IWM call options in
  the crowded-short episodes, and the two newest Shapiro video titles.

**Confirmed unchanged:** every Wealthion quote, the CMR home-page bio, the Anatomy and Why I Don't Chase quotes,
every remaining Bulkowski, Qullamaggie, Stockbee, ChartSchool, Lefèvre and Wyckoff quote, every remaining UCT Substack
quote (word for word, in context), the starterScans, Oops docstring, Model Book, Bottoms, F7.04, audit and vocabulary
quotes, the brain-file t0774 pairing of Jason Shapiro with News Failure, all 14 house examples' bar facts in 4.5, the
index table in 4.4 (reproduced exactly), and the single-stock table (on the grown store the main rows came back within half a point; the small 60-day-run
subgroups within about 2 points, same direction).

## Second cold check (2026-11-09, later the same day, by a third agent)

**Method.** Every web page cited above was fetched again on 2026-11-09 (all 323 Crowded Market Report posts and all 103 UCT
posts through Substack's public post API, both sitemaps, the Wealthion transcript, the CMR home page, both Qullamaggie
pages, the Stockbee thread, the ChartSchool page, the Gutenberg Lefèvre text, the Internet Archive Wyckoff OCR, the
elearnmarkets, Stansberry, Chat With Traders, Wall Street Coach and AlphaMind pages; Bulkowski's six pages through a
fetch tool, since direct requests still return HTTP 406, and TraderLion still returns 403). All 283 distinct quoted
strings in this file were matched by script against those fresh copies and against the repo files named, then the
misses were read by hand. The Chart IQ code (`v3.py`, `v3_levels.py`, `v2_setups.py`, `v4_compose.py`, `pipeline.py`,
`routers/chart_iq.py`), the Oops detector, the setup lists, the Model Book catalogs, the rulebook rules cited in section
7 and every other repo file in the sources table were re-read. The bar study was rewritten from scratch (no code shared
with either earlier script) and run on the same read-only store, 4,284 tickers, bars capped at 2026-11-06.

**Confirmed, nothing to change.** Every quote (Shapiro's transcript and posts, UCT's posts, Bulkowski, Qullamaggie,
Stockbee, ChartSchool, Lefèvre chapter X, Wyckoff chapters I and VI with the U.S. Steel example of Friday, February 19,
1909 and the tape of February 20) is on its page word for word, in context, and says what this file says it says. Every
post date, section heading and byline in sections 2, 3 and 6 is right; the 10 UCT uses split 1 (owner) / 6 (Bracco) / 3
(unsigned "Index & ETF" section, the 2026-09-20 one under that section's "QQQ SPY IWM SMH IGV MAGS" sub-heading); the
one paywalled UCT post is 2026-10-18. The 14 house examples in 4.5, the QQQ bars of 2026-10-22 and 10-28, and the SPCX
sessions of 2026-08-04 to 08-07 reproduce exactly. The 4.4 re-run numbers, the index table, the earnings-day rows, the
Shapiro close-stop test, the 80% / 74% figures in 5.1 and both 8.9 lists came back identical from the new script; the
confirmation-entry and intraday-stop figures came back within rounding (noted in 4.4). The 5.2 description of the Chart
IQ rule, including the two "climax" branches and the admin-only `raw` field, matches the code line by line. The brain-file
paraphrases carry the right authors and dates (Manrav 2024-10-29, Bracco 2025-04-02 / 2025-12-18 / 2026-07-07, the
owner's desk log of 2025-07-15, whose UPST line does say he bought it off bad news and the 20-day EMA, and the owner's
2024-11-23 mapping; all paraphrased, as elsewhere in this file, because they are member-only Discord summaries).

**Corrected (wording, no finding changed).**
1. 3.2 and the sources table said "the two January 2024 posts" carry "Published by The CMR Team on behalf of Jason
   Shapiro". Five January 2024 posts do (01-01, 01-08, 01-15, 01-22, 01-29); the two quoted here are among them.
2. 3.2's "22 public posts use it" is now exact: 21 in the body text, plus the 2024-07-21 post whose title and subtitle
   alone carry the term.
3. 3.7 and the sources table now give ChartSchool's stored page timestamp (2024-09-25) behind "Last updated 2 years ago".
4. 8.1's crowding line now says that its price numbers are measurable but "crowded" is not: no source read gives a
   numeric COT threshold (Shapiro names only the neutral exit near an indexed score of 50). It was already question 7.

**Removed in checking:** nothing. No quote, attribution, statistic or criterion failed the second check.

---

## 12. Examples (from our data)

**The scan's rule (the proposed stand-alone version of 8.1 to 8.3 plus the house rules), in one paragraph.** On the
sandbox's daily bars (2,630 names that ever met B23, scanned in full; events from 2000 on), a **long** News Failure is a
day that opens 4% or more under the prior close on 2x or more the prior 50-day average volume and then **closes above
the prior close**, with the close above the 200-day SMA (B26), the prior close $10 or more and the prior 50-day dollar
volume $20M or more (B23). The entry is a market order as price trades back over the prior close (prior close + $0.01,
E57); the stop is $0.03 under the news day's low (F62, 8.3); 3R and 5R are measured from that entry and stop. The
**short** is the mirror (gap up 4%+ on 2x, close under the prior close, close under the 200-day, entry prior close -
$0.01, stop $0.03 over the day's high). The prior-trend line of 8.1 (a 25%+ fall or a 50%+ run over 60 sessions) and the
strong-close grade-up (top or bottom quarter of the range) were recorded, not required, and are reported as sub-groups.
Each event is classed as "earnings" when `earnings_reaction_days` has a report for that day, "news" when the name has
report dates on file and none that day, and "unknown" when the name has no report dates at all. Scripts and the hit
file: `_study-resume/scratchpad/setups/23-news-failure/` (`scan_nf.py`, `pick_nf.py`, `final/hits.json`). [my computation]

**Base rate (fixed stop, no trims, no breakeven move, 60 sessions forward; the first touch of the stop ends the trade):**
1,534 events; **33.4% reached 3R and 17.9% reached 5R** before the stop; 2,630 of 2,630 liquid names scanned (the 420s
budget was not needed). By side: long 603 events, 32.0% to 3R, 18.1% to 5R, 66.8% stopped, median stop 6.8%; short 931
events, 34.4% to 3R, 17.7% to 5R, 68.7% stopped, median stop 7.3%. Sub-groups: longs after a 25%+ 60-session fall, 74
events, 43% to 3R, 22% to 5R; shorts after a 50%+ 60-session run, 111 events, 32% to 3R, 15% to 5R; longs closing in the
top quarter of the range, 500 events, 31% to 3R; shorts closing in the bottom quarter, 751 events, 32% to 3R. Earnings
versus news: long earnings gaps 248 events, 30.6% / 15.3%; long news gaps 275, 37.5% / 22.5%; short earnings gaps 311,
27.7% / 11.3%; short news gaps 423, 38.3% / 21.0% (the rest are "unknown"). Caveats: the stop is fixed at the day's
extreme and about two-thirds of events hit it, so the house's trims and trail (B19, E51, E52) would change the realised
R; a market order at the prior close assumes a fill there; no news column exists, so the volume-and-gap stand-in may
count ordinary volatile days. These numbers are better than section 4's test of the natural stop over a wider shape,
and still mean about two losses for every 3R winner. [my computation]

**The ten examples** (one per ticker; seven longs, three shorts, matching the house's lean; 2025 and 2026 appear twice
each because the best shorts and the two strongest longs fall there). "Structure" = gap, volume multiple, close as a
position in the day's range (1.00 = the high), and the 60-session fall (long) or run (short) into the news day. Charts:
`final/01_AAOI_2026-04-02.png` to `final/10_OKLO_2026-04-24.png` and the sheets `sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png` in the folder above.

| # | Ticker | Date | Side | News class | Structure | Buy (trigger) | Stop | Stop % | Best R (days to 3R) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | AAOI | 2026-04-02 | long | news (no report that day) | gap -5.5%, 2.1x vol, closed at 0.93 of range, +20.3% over the prior close; 60-day fall -33% | 86.36 | 81.48 | 5.7% | 30.2R (1) | A 33% shakeout inside a leader's run, a gap under the 50-day bought back to a close 20% up; the low undercut the prior day's low (an Oops shape), and the stock then doubled. |
| 2 | SEDG | 2025-11-05 | long | earnings 2025-11-05 | gap -4.1%, 3.8x vol, 0.95 of range, +28.9%; fall -24% | 31.83 | 30.23 | 5.0% | 10.5R (1) | An earnings gap down into the 50-day, reversed to a 29% up-close in the top 5% of the range; 3R the next day. The 24% fall before it is the 8.1 prior-trend line almost exactly. |
| 3 | HIMS | 2025-05-06 | long | earnings 2025-05-05 (after the close) | gap -8.5%, 5.2x vol, 0.91 of range, +18.1%; fall -43% | 41.89 | 38.18 | 8.9% | 7.7R (2) | The best example of "crowded shorts meet bad news": a 43% fall, an 8.5% gap down, then a close 18% up. The 8.9% stop shows 8.3's warning: wide, so size down or skip (A3). |
| 4 | CELH | 2024-02-29 | long | earnings 2024-02-29 | gap -5.7%, 7.4x vol, 0.94 of range, +20.4%; fall -1% | 67.78 | 63.62 | 6.1% | 7.7R (1) | No prior fall: a leader above all its averages gaps down on earnings, is bought on 7x volume and closes 20% up. Shows the shape without the crowding; 5R within two weeks. |
| 5 | ZS | 2023-11-28 | long | earnings 2023-11-27 (after the close) | gap -4.3%, 6.5x vol, 0.98 of range, +1.0%; fall -2% | 191.92 | 182.57 | 4.9% | 7.2R (12) | The quiet version: the failure is only a 1% up-close, but in the top 2% of the range on 6.5x volume in a clean uptrend; a steady trend trade, 3R in 12 sessions. |
| 6 | KSS | 2017-11-09 | long | earnings 2017-11-09 | gap -6.2%, 6.6x vol, 0.86 of range, +0.9%; fall -14% | 40.80 | 37.94 | 7.0% | 9.9R (14) | A 6% earnings gap under the 200-day bought back to a close above both the prior close and the 200-day; the stock then ran about 60% in two months. Slow (3R in 14 days). |
| 7 | COF | 2009-07-24 | long | earnings 2009-07-23 (after the close) | gap -4.6%, 2.0x vol, 0.88 of range, +8.0%; fall -12.5% | 27.84 | 26.37 | 5.3% | 8.1R (9) | The 2009 recovery version: a bank gaps down on earnings just above a flattening 200-day and closes 8% up; volume only 2x (the rule's floor). Did not undercut the prior low. |
| 8 | STNG | 2020-05-06 | short | unknown (no report dates on file for STNG) | gap +5.6%, 2.6x vol, closed at 0.01 of range, -10.4% under the prior close; 60-day run +72% | 21.24 | 22.47 | 5.8% | 7.5R (4) | The mirror: a 72% run into good news, a 5.6% gap up sold to a close 10% down at the low of the day, under the 200-day, 50-day and 21-day. Whether the news was the Q1 report cannot be confirmed from our data. |
| 9 | SKIN | 2022-08-09 | short | earnings 2022-08-09 | gap +4.8%, 3.7x vol, 0.01 of range, -16.2%; run +54% | 15.26 | 16.05 | 5.2% | 6.6R (6) | An earnings gap up after a 54% run, sold to a close 16% down at the day's low, under the 200-day; a key-reversal bar (the high took out the prior high). |
| 10 | OKLO | 2026-04-24 | short | news (no report that day) | gap +6.3%, 2.4x vol, 0.01 of range, -7.1%; run +70% | 76.45 | 81.53 | 6.6% | 7.3R (16) | A 70% bounce into the falling 200-day meets a 6% news gap up that closes 7% down at the low; the mean-reversion short of 8.1 ("RS 20 or less unless the owner rules it mean reversion"), slower (3R in 16 days). |

Rejected after viewing: DDD 2021-01-11 (a 28R hit, but the news day is a small bar inside a near-vertical run, hard to
read), AIG 2008-09-24 (reverse-split adjustment puts the 2008 bars on a 1,000-point scale; the chart is unreadable),
LVS 2006-02-15 (clean but 34 sessions to 3R). ETFs (SVXY, ZSL, NAIL, KORU, SOXL, UVXY) were excluded by hand.

**Notable failures (strong shape, stopped at under 1R).** [my computation from `final/hits.json`]
- **MRVL 2026-06-04, long:** a 6.2% gap down on 2.7x volume closed in the top 12% of the range above the 200-day, with
  no report that day; the stop (8% away) was hit before any gain. A strong-looking failure after only a 7% pullback: no
  crowding behind it, the 8.5 and 8.8 warning.
- **NBIS 2026-10-15, long:** a 5.7% gap down closed in the top 4% of the range after a 34% fall, the crowded case the
  rule likes, yet the 12.2% stop was taken with nothing gained. Even the best shape loses often; the stop size alone
  (far above the A13 norm) should have made it a skip or a small size. (NBIS has no report dates on file, so the gap
  cannot be classed.)
- **AMAT and DAL 2025-04-08, shorts:** both gapped up 4.2% on 2.2x and closed in the bottom 11% of the range under the
  200-day, the day before the 2025-04-09 market rally; both stops were hit the next day with 0R. A reminder of 8.7 and
  8.8 item 4: the bearish read in a washed-out market is a poor sell signal, and a same-day cluster (many names showing
  one shape on one day) means the "news" was the market, not the stock.
- **ZTS 2025-08-05, short (earnings):** gap up 5.4%, closed in the bottom 10% of the range, reached 0.9R and then
  reversed through the day's high. The "failure itself failed" case in 8.5.

**Limits of this data for this setup.** There is no news feed, so a gap-and-volume stand-in defines "news"; the
earnings file tells an earnings gap from a non-earnings gap only from about 2005 and only for names with report dates
(STNG and NBIS have none). Entries and stops are tested on daily bars (a touch of the low ends the trade; the house's
30-minute gap rule B20 is not modelled). Intraday bars exist only for the last 60 trading days (5-minute) or since
2023-12 (hourly) for 1,000 names, so the intraday red-to-green entry of 8.2 could not be back-tested across the ten; the
examples' triggers are the daily prior close. The full 2,630-name universe was scanned, so no coverage caveat applies.

## 13. Failures and near-misses (from our data)

Added 2026-11-10 from the same scan as section 12 (`scan_nf.py`, `final/hits.json`) and a near-miss scan
(`near_scan.py`, `final/near_hits.json`): the section-12 stand-in run again over the 2,630 liquid names with one gate
relaxed at a time, keeping only the days that fail exactly one of nf.scan_standin (an open only 2% to 4% under the prior
close, or volume only 1.2x to 2x), nf.failure_close (the day trades back over the prior close but closes under it, in the
top 60% of its range), nf.above_200 (the long closes under the 200-day) or nf.short_below_200 (the short closes above
it) and pass every other gate. Charts (scratch folder, not in the repo): `final/fail_1-4.png`, `final/near_1-4.png` and
`final/pair_22-news-gapper.png` (a News Failure short above a News Gapper, the card's first look-alike, each with its
tell). Script `fail_near.py`; every number below is in `final/fail_near.json`. Outcome as in section 12: a fixed stop
$0.03 beyond the news day's extreme, no trims, 60 sessions. [my computation]

**Four valid News Failures that lost.** Every gate of the stand-in passed; the stop was hit; one per name, four years,
two longs and two shorts.

| # | Ticker | Date, side (class) | Gap / volume / close vs prior close / range / 60-day trend | Buy (trigger) | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|
| 1 | MRVL | 2026-06-04, long (news, no report that day) | -6.2% / 2.7x / +4.9% / top 12% / fall 7% | 301.66 (the prior close plus a cent) | 277.53 (8.0%) | 2026-06-05, day 1, best 0.0R | A strong-looking failure after only a 7% pullback: no crowding behind it (8.5, 8.8); the 8% stop went the next session. | nf.crowding |
| 2 | ZTS | 2025-08-05, short (earnings 2025-08-05) | +5.4% / 2.3x / -3.7% / bottom 10% / run 5% | 151.80 (the prior close less a cent) | 160.08 (5.5%) | 2025-08-20, day 11, best 0.91R | Reached 0.9R, then reversed up through the news day's high: the failure itself failed. Only a 5% run before the news, so no crowded longs to unwind. | nf.inv_failure_failed |
| 3 | TTD | 2022-02-16, long (earnings 2022-02-16) | -4.6% / 3.5x / +0.5% / top 8% / fall 27% | 80.53 | 71.02 (11.8%) | 2022-02-24, day 5, best 0.33R | The crowded case the rule likes (down 27% in 60 sessions) with an 11.8% stop: a skip or a small size by A13 and 8.3; gone in five sessions at 0.33R. | nf.stop_width |
| 4 | UAL | 2020-05-19, short (news, no report that day) | +6.2% / 2.2x / -1.9% / bottom 15% / run 36% | 24.12 | 25.70 (6.6%) | 2020-05-21, day 2, best 0.0R | A short in a Green market (May 2020): good news sold to the low of the day, then the market carried the stock back up through the high in two sessions. | nf.market_short |

**Four near-misses.** Each looks like a News Failure and fails exactly one gate; the would-be entry is the section-12
one (the prior close plus or minus a cent) so the levels can be compared with the winners. No trade is implied.

| # | Ticker | Date, side (class) | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | STX | 2026-10-28, long (earnings 2026-10-27) | nf.scan_standin | the open was only 3.1% under the prior close; the stand-in needs a 4% gap on 2x volume (2.5x volume, closed +4.5% in the top 1% of the range after a 34% fall) | The shape and the crowding of a News Failure without the gap: a Red to Green day (setup 43) on an earnings report, taught as the house trigger, not as this setup. Would-be buy 667.86, best 1.09R so far (the data ends 2026-11-06). |
| 2 | HAL | 2010-01-25, long (earnings 2010-01-25) | nf.failure_close | traded back over the prior close 31.15 during the day but closed at 31.07, 0.3% under it; the rule is a close above the prior close (-4.7% gap on 2.3x, closed in the top 22% of the range) | The failure did not confirm: Shapiro's end-of-day test fails, so no trade at the close; an intraday red-to-green buy at 31.16 would have made 0.2R and been stopped. |
| 3 | TSLA | 2025-04-02, long (earnings 2025-04-02 per the report file) | nf.above_200 | closed at 282.76, under the 200-day (288.05); the long needs a close above the 200-day (-5.2% gap on 2.1x, closed +5.3% in the top 7% of the range after a 39% fall) | A bear-phase reversal under the 200-day: the crowded shape, the wrong side of the average (B26); at most the mean-reversion read of 8.1, which is the owner's call. Would-be buy 268.47 reached 0.45R and was stopped. |
| 4 | UNH | 2026-10-13, short (earnings 2026-10-13) | nf.short_below_200 | closed at 377.76, above the 200-day (358.04); the short needs a close below it (+5.0% gap on 2.7x, closed -0.2% in the bottom 18% of the range) | Above the 200-day the read is used only to sell longs or cut exposure, never as a short (8.1). The would-be short at 378.51 was stopped, 0.0R. |

**What the failures have in common.** The stops were wide, 5.5% to 11.8%, because the stop is the news day's extreme,
and three of the four were hit within two sessions (ZTS took eleven after reaching 0.9R). In three of the four the
crowding the rule wants was missing: MRVL after a 7% pullback, ZTS after a 5% run, UAL in a market that was being
bought, not sold; the one crowded case (TTD) lost on stop size. None reached 1R, so each loss was about 1R, but at an 8%
to 12% stop that 1R is a large position risk for the account (A13, 8.3), which is why most of these are skips. The
near-miss scan adds this about the gates: the 4,491 near-misses reached 3R 37.5% of the time against 33.4% for the
strict rule, and by gate, a long on a 2% to 4% gap 45.1% (1,618 hits), a long that closed under the 200-day 39.6%
(1,025), a short that closed above the 200-day 30.1% (816, against 34.4% for the strict short), 1.2x to 2x volume 33.7%
(795) and a day that traded back over the prior close but closed under it 13.9% (237). The close is the gate that
matters, by far: the failure that does not close on the right side of the prior close is a different animal. The 4% gap
stand-in looks too strict in this sample (a smaller gap reversed did better, with a tighter stop), which belongs in
section 10 next to the stand-in question. [my computation]
