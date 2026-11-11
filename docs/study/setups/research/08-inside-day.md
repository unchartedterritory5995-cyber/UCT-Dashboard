# Setup 08: Inside Day (long and short), with ID/NR4 and NR7

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page
named next to it. Quotes are 40 words or fewer. Nothing here is a ruling. Where I could not read a source, I say so and
give no wording from it. Where a page could only be read through a fetch tool that returns extracts (Bulkowski), I say
that too.

**Cold check, 2026-11-09 (a second reader).** Every outside quote was re-opened and found word for word on its page; all
40 UCT Substack quotes were re-downloaded and found word for word, with their writer's section and date; the KB quotes
were found in the repo's KB files; the app summary was re-read against the code; the example table was re-run on Yahoo
bars; the measurement tables were checked against the writer's own output files and the hourly table was recomputed
independently. What was wrong is fixed in place; what could not be confirmed is listed under "Removed in checking" at
the end, with the main fixes.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's own
words; **[UCT]** UCT's own writers, the owner's desk logs or his verdict log; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change;
**[my measurement]** my own test in section 4.4 (preliminary, not a published study).

**Read this first (the short version).**
1. The shape is settled: a day whose high is below the prior day's high and whose low is above the prior day's low.
   Sources split on small things: whether a tie with yesterday's high or low still counts, and whether you buy over the
   inside day's high or over the bigger "mother" bar's high.
2. The originator of the tested version is Toby Crabel (1990). He treated the inside day, NR4 and NR7 as signs that a
   range is about to expand, and traded the next day's opening range breakout: both sides by default, one side only "in
   a market with a strong bias in one direction" (his "ORBP"). Linda Raschke and Larry Connors made "ID/NR4" famous in
   *Street Smarts* (1995). I could read Crabel only through a blog that reproduces his text, and *Street Smarts* only
   through one secondary summary (Lance Beggs).
3. On its own the inside day is close to a coin flip. Bulkowski: the trend leading in is up only 53% of the time, and
   the gain over a benchmark is small in stocks and negative in ETFs. My own daily-bar test on 187 liquid US stocks
   (2012 to 2026) found that a mechanical rule (buy a cent over the inside day's high, stop a cent under its low) in an
   uptrend did **not** beat the same order placed on any other uptrend day, and an hourly check of the next day's order
   of events (Dec 2023 to Oct 2026) confirmed it (a second reader recomputed that check and got the same answer). Tighter inside days did worse, not better (section 4.4).
4. UCT uses the inside day as an **entry tool inside a bigger setup**, not as a setup by itself: a "little cheat" after a
   breakout, after an earnings gap, an HVE, a Kicker or a Go Signal, at the rising 20-day, or just under a breakout
   spot. The owner also trades the **trap side**: the double inside day that is swept and reclaimed (inside day + Oops
   Reversal). His words: "Double inside day, oops reversal. Simple shit nothing new." (trader archive, KB 14619).
5. The app has six different inside-day codes that do not agree with each other (strict vs tie-allowed, ID high vs
   mother high, stop at the ID low vs 1.5% under the mother low). There is no Model Book card, no journal tag and no
   TRADE_PLANS row for it. Several app texts make claims about Crabel and Raschke that I could not verify (section 5).
6. House-rule friction: on the volatile leaders the owner trades, the honest stop under the inside day's low is often
   more than 3% (A13). The member drawing's textbook gate (close at most 6% over the 50-day) would hide most of the
   owner's own published inside-day examples.

---

## 1. What it is

An inside day is a daily bar that trades entirely inside the prior day's range: a lower high and a higher low. In a
stock that is already trending, it is a one-day pause. You buy when price trades back above the inside day's high, with
the stop just under its low, so the risk is the height of one quiet day.

**Why it works (the psychology).** These points are reasoning from the sources, not measured facts.
- A range that stops growing is a market in balance. Linda Raschke: "it is difficult to predict the direction of the
  breakout because buyers and sellers appear to be in perfect balance." ([Raschke, "Capturing Trend Days", TradersLog
  reprint](https://www.traderslog.com/?p=823))
- When the balance breaks, someone is on the wrong side. Raschke again: "Either longs or shorts will be “trapped” on the
  wrong side and eventually forced to cover, aggravating the existing supply/demand imbalance."
  ([same page](https://www.traderslog.com/?p=823))
- In a leader after a strong day, the inside day says holders did not sell (no lower low) and nobody had to chase (no
  higher high). TraderLion: "Inside days take advantage of the fact that there is already momentum in a name, and all
  you're doing is waiting for a slight pause to find your way into the stock."
  ([TraderLion thread, 7 Dec 2024, via Thread Reader](https://threadreaderapp.com/thread/1865382390752854290.html))
- Who is buying on the break: traders who missed the breakout and want a defined risk, plus anyone who sold the pause.
- Who is trapped on a failure: buyers of the high break if the low then breaks, and, in the owner's trap version,
  sellers who sold the break of the inside day's low when price reclaims it. Daniel Chesler named that false break the
  "hikkake", a Japanese word meaning to "trick" or "ensnare" ([Wikipedia, "Hikkake pattern"](https://en.wikipedia.org/wiki/Hikkake_pattern)).
- The caution: an inside day by itself names no side. Stockbsessed: "It is important to realize that an inside day on
  its own is in no way a signal to buy or sell, it is the overall context of an inside day within its trend that may
  provide a trading opportunity." ([Stockbsessed, 25 Mar 2023](https://stockbsessed.substack.com/p/inside-day-trading-strategy))

## 2. Origin and naming

- **The bar itself is old and has no single inventor that I could find.** "Inside day" is a generic bar-chart term.
- **Toby Crabel, *Day Trading with Short Term Price Patterns and Opening Range Breakout* (Traders Press, 1990)** is the
  first systematic test I could trace: inside days (ID), NR4, NR7, ID with NR4 ("IDnr4"), wide days (WS4, WS7), hook
  days and multi-day narrow ranges, each followed by an opening range breakout. StockCharts confirms the book, the year
  and that it is out of print ([ChartSchool, Narrow Range Day NR7](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7)).
  Raschke credits him with the NR7 name: "the narrowest range of the last 7 days (Toby Crabel introduced this term in
  his classic book, Day Trading With Short-term Price Patterns and Opening-range Breakout);"
  ([TradersLog](https://www.traderslog.com/?p=823)). **I did not read the book.** Crabel's wording below comes from a
  blog that reproduces it ([Time Price Research, "Definition of Price Patterns | Toby Crabel"](https://time-price-research-astrofin.blogspot.com/2012/04/toby-crabel-definition-of-patterns.html)).
- **Laurence A. Connors and Linda Bradford Raschke, *Street Smarts: High Probability Short-Term Trading Strategies*
  (M. Gordon Publishing Group)** popularised the ID/NR4 setup. Wikipedia's reference gives 1995 while its own text says
  1996 ([Wikipedia, Linda Bradford Raschke](https://en.wikipedia.org/wiki/Linda_Bradford_Raschke)); 1995 is the year
  most sources use. **I did not read the book.** Lance Beggs names it as where he first met the idea and adds "I believe
  they got it from Tony Crabel." (sic, Toby) ([YourTradingCoach, "The ID-NR4
  Setup"](https://yourtradingcoach.org/the-id-nr4-setup/)).
- **Other names.**
  - *Inside bar*: the same bar on any timeframe (forex and price-action educators). Al Brooks uses **ii** (two inside
    bars in a row), **iii** (three), **ioi** (inside-outside-inside) ([Brooks Trading Course glossary](https://www.brookstradingcourse.com/price-action-trading-terms-glossary/)).
  - *Mother bar*: the bar the inside day sits inside. A price-action label; I did not find it in Crabel or Bulkowski.
  - *Double inside day*, *triple inside days*, *inside week*, *inside month*: UCT's usage (section 6).
  - *ID/NR4*, *IDnr4*, *ID/NR7*: an inside day that is also the narrowest range of 4 (or 7) days.
  - *Harami*: the Japanese two-candle pattern. Not the same thing: the harami is judged on the candle bodies, the inside
    day on the full high-low range. Mish Schneider writes that "Inside day often refers to all versions of the Harami
    candlestick pattern" ([MarketGauge, 25 Jun 2010](https://marketgauge.com/resources/mishs-daily-articles/inside-days-strategies-for-this-powerful-short-term-stock-trading-pattern/)); I treat that as loose usage.
  - *Hikkake* (Daniel L. Chesler, CMT): the false break of an inside day. Some call it an "inside day false breakout"
    ([Wikipedia](https://en.wikipedia.org/wiki/Hikkake_pattern)). His firm's page gives the year: "In 2004, Daniel
    introduced the hikkake trading pattern to the financial community through a series of published articles."
    ([Chesler Analytics, "Who we are"](https://chesler.us/about/whoweare.htm)). I did not read the articles themselves.
  - *Not the same pattern*: Edgeful calls a day that merely **opens** inside yesterday's range an "inside day"
    ([Edgeful blog, 25 Apr 2026](https://www.edgeful.com/blog/posts/inside-day-in-trading-breakout-data)). That is an
    open-location statistic, not this setup.

## 3. Every definition I could find, source by source

### 3.1 Toby Crabel (1990), the originator of the tested version (via a reproduction)
Source: the Time Price Research blog's reproduction of the book (link in section 2). Not checked against the book.
- **Shape (strict):** "an Inside Day's high is less than the previous day's high and the Inside Day's low is greater
  than the previous day's low."
- **Why:** "The hypothesis is that Inside Days precede trend day activity and consequently successful opening range
  breakouts."
- **Size matters:** "The ORB is effective after inside days that have a smaller daily range than the previous four or
  five days and for that matter after any day that has a daily range less than the previous six days (NR7) ..."
- **Contraction vs expansion:** "One should be looking to go with a forceful move off the open after a contraction and
  not willing to do so after an expansion."
- **Trigger and entry:** the next day's opening range breakout (ORB). "An Opening Range Breakout is a trade taken at a
  predetermined amount above or below the opening range." Both sides are entered as stops; "The first stop that is
  traded is the position and the other stop is used as a protective stop."
- **Direction:** two-sided by default. One-sided only with a clear bias: "There are days when a trade in only one
  direction is taken, this is called an Opening Range Breakout Preference (ORBP)." and "Usually this is done in a market
  with a strong bias in one direction or just after a clear supply or demand indication." The blog's own commentary
  (not a Crabel quote) applies this to the inside day: inside a running market it is a springboard in the direction of
  the run.
- **Stop:** the opposite side of the opening range breakout (the other stop order).
- **Exit:** in his tests, the close of the entry day. StockCharts summarises: "Crabel took profits quite quickly,
  usually at the close of the first trading day or on the first profitable close." ([ChartSchool](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7))
- **Prior trend, volume, moving averages:** none required in the definitions I read.
- **NR4 / NR7 / IDnr4:** NR4 is the narrowest range of 4 days, NR7 of 7. The blog's glossary describes IDnr4 as an
  inside day that is also an NR4 (the blog's wording, so I do not quote it as Crabel's).

### 3.2 Linda Bradford Raschke (her own article; *Street Smarts* not read)
- **Role of NR7:** among "Conditions Preceding a Trend Day" she lists NR7, quoted in section 2, and "a cluster of 2 or 3
  small daily ranges" ([TradersLog](https://www.traderslog.com/?p=823)).
- **Execution:** breakout methods that "let the market tip its hand"; for the morning range, a buy stop above and a sell
  stop below, and "A protective stop-and-reverse should always be left in place at the opposite end of he range once
  entry has been established." (sic)
- **Warning:** "The good news is that breakout strategies have a high win/loss ratio. The bad news is that whipsaws can
  be brutal!"
- ***Street Smarts* ID/NR4:** the only secondary summary I could read is Lance Beggs's. The bar is both: "An ID-NR4
  candle meets both the ID and NR4 requirements." The common way to trade it, in his words, is "with a stop entry order
  above the high and another below the low", then "When triggered into a trade, a stop loss is placed at the opposite
  side of the candle." and "The other (unfilled) entry order is often left in place, in order to provide a stop and
  reverse entry," ([YourTradingCoach](https://yourtradingcoach.org/the-id-nr4-setup/)). I could not verify the book's
  tick offset, which day the orders go in, or its exit or holding rule, so I state none.

### 3.3 Thomas Bulkowski, ThePatternSite (measured statistics)
Read through the fetch tool because the site returned "406 Not Acceptable" to a plain request. The quotes and numbers
below are as the fetch tool returned them; I could not save a copy to check them word for word (in checking, separate
fetches returned the same wording and numbers, and a plain request still got "406"). **The site states a
notice against AI use:** "This website, in whole or in part, shall not be used to train artificial intelligence (AI)
systems," I cite it here with links and short quotes only. ([Inside Days](https://thepatternsite.com/InsideDays.html),
updated 9/5/24.)
- **Shape:** "Look for a lower high and higher low on the second day." Also: "The last bar cannot have the high price
  equal to the low price."
- **Prior trend:** "There is no requirement of a price trend leading to the inside day. However, the trend is upward 53%
  of the time."
- **Direction:** "expect the breakout to be in the same direction as the inbound price trend."
- **Which bar sets the levels:** the two days together. He measures from "the breakout price (the first day's high or
  low in the pattern, depending on the breakout direction)." So his trigger and his pattern stop sit at the **mother
  bar's** high and low, not the inside day's.
- **Trigger:** a close, not an intraday break. "A breakout occurs when the stock closes either above the top of the
  pattern or below the bottom of it." Entry: "If price closes above the pattern's high, buy at the open the next day."
- **Stop:** in his trading tips, "If price moves 7% in the direction opposite the breakout, close out the trade for a
  loss."; in his trading test, "a penny below the bottom of the pattern" (the first day's low).
- **Target:** "The measure rule is simply the height of the chart pattern added to the top of the pattern"; in his
  trading tests he doubles the height.
- **Volume, moving averages:** none in the definition.
- **NR7 page** ([nr7.html](https://www.thepatternsite.com/nr7.html), "Fixed errors with hold time: 2/28/25"):
  "The NR7 is based on the high-low price range that is the smallest of the prior six days (seven days total)." His NR7
  pattern spans all seven days: "The top and bottom use the seven days, from start to end, of the NR7." So its breakout
  level is the seven-day high, not the NR7 bar's own high. Same close-based breakout and next-open entry in his trading
  tips; his stock target test instead entered when "the stock climbs above a buy stop placed a penny above the top of
  the 7-bar pattern." Same AI notice.

### 3.4 StockCharts ChartSchool, "Narrow Range Day (NR7)" (established educator; no author shown)
([link](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7))
- **Shape:** "An NR4 pattern would be the narrowest range in four days, while an NR7 would be the narrowest range in
  seven days." Uses the absolute range, as Crabel did.
- **Trigger:** "Buy on move above high of narrow range day high." (sic) Short: "Sell on move below low of narrow range
  day low."
- **Invalidation:** "After a buy signal, a move below the low of the narrow range day would be negative."
- **Speed:** "Because this is a short-term setup, it is important that the trade starts working right away."
- **Trend filter:** recommended, not fixed: "Adding a trend indicator ensures that trades are in the direction of a
  bigger trend." Their scans use Aroon (63 periods) and CCI.
- **Stop and exit:** Parabolic SAR or ATR-based (example: two ATRs, trailed); Crabel's quick exits; or a resistance or
  percent target.
- **Frequency warning:** "A typical stock will produce dozens of NR7 days in a twelve-month period; a daily scan of US
  stocks will often return hundreds of stocks with NR7 days."

### 3.5 TraderLion (established educator), X thread of 7 Dec 2024
([Thread Reader copy](https://threadreaderapp.com/thread/1865382390752854290.html); TraderLion's own site blocked my
reader, so I used the thread copy. Their article "Inside Days: How To Catch True Market Leaders After the Breakout" was
not readable.)
- **Shape and meaning:** "An inside day occurs when today's price is fully within the high & low of yesterday's bar,
  hinting at short term consolidation before price continues in the current direction."
- **Volume:** "It's also best when the inside bar comes on low volume."
- **Context:** names already showing momentum; examples are days after a base breakout.
- **Entries:** "The high of the previous day" or "The high of the inside day". **Exits (stops):** "The low of the
  previous day" or "The low of the inside day".
- **Stop size:** "You should be shooting for a stop loss within ~5% of entry."
- **Example:** NVDA, "Inside Day Setup occurs on January 12, 2024 (4 days after breakout)", "Following Day Entry:
  Through $550", "Stop Loss: Under $543", "Total Risk: ~1.4%". SMCI: three inside days within two weeks after a
  16 Feb 2024 breakout.
- **Liquidity in their scan:** "plus a liquidity filter of avg. $3M Dollar Volume over the past 20 days."
- **Honest caveat** (on their third example, CLSK): "It also goes to show that sometimes the Inside Day setup doesn't
  turn into a move that lasts weeks to months!"

### 3.6 Deron Wagner, Morpheus Trading (established educator), 6 Sep 2018
([How To Trade Breakaway Gaps](https://morpheustrading.com/blog/breakaways-gaps/))
- **Context:** within days of a breakaway gap that cleared a base of at least four to five weeks on at least 3x the
  50-day volume.
- **Trigger and entry:** "Wait for a tight-ranged inside day on lighter volume to print within a few days of the gap.
  Just above the high of the inside day is the buy stop that should enable momentum to follow-through to the upside."
- **Example:** BOOT, "a valid buy signal to enter $BOOT on August 14, after the stock rallied above the high of the
  tight-ranged, light volume day on August 13." **My check:** on Yahoo daily bars, 13 Aug 2018 was not an inside day
  (its high was above 10 Aug's high); it was the narrowest range of 7 days (an NR7). The post adds that they missed
  that entry and bought on 21 Aug, on a buy stop over the 20 Aug high.
- **Stop in that trade:** "the original stop price (below the low of the gap)".

### 3.7 Mish Schneider, MarketGauge (established educator), 25 Jun 2010
([link](https://marketgauge.com/resources/mishs-daily-articles/inside-days-strategies-for-this-powerful-short-term-stock-trading-pattern/))
- **Shape:** "An inside day occurs when the entire daily price range for a given security falls within the price range
  of the previous day."
- **Double:** "2 inside days in a row is an even clearer signal of the indecision by traders as to the next direction of
  the stock."
- **Both directions:** her THOR example is a short: "We shorted THOR as it broke 45.60 and placed our stop above the
  high of the day or about 3/4 of the Average True Range." Half covered at half an ATR, the rest at 1.5 ATR.
- **Long example:** AAPL, 23 Mar 2009, after two inside days; "the ranges of all 3 days prior were broken on a higher
  open, which gave a great signal for a long entry at 107.00." So this entry was over the mother bar's high (all three
  days), while the THOR short sold the break of "the recent low of all those inside days (45.60)". **My check:** AAPL
  was about 17% below its 200-day then (Yahoo bars), so this example breaks our B26.
- **Summary line:** "One or more inside days in a row, regardless of your timeframe, is an indication that that
  particular instrument has paused and compressed offering low risk opportunities."

### 3.8 Stockbsessed (swing-trading educator on Substack), 25 Mar 2023
([Inside Day Trading Strategy](https://stockbsessed.substack.com/p/inside-day-trading-strategy))
- **Context first:** under "What I look for in any trade:" the post lists "Momentum in a given direction", "Respect to
  key moving averages" and "Tightness to get involved at a low-risk spot".
- **Trigger and stop:** "Buying the stock on a break above the high of the day" and "Setting my stop right below the
  low of the day".
- **Wide inside day:** "I may opt to manage risk against an intraday consolidation or quite often against the close of
  the inside day".
- **After earnings gap-ups, sometimes:** "I also occasionally incorporate this into how I handle earnings gap-ups".

### 3.9 Pradeep Bonde, Stockbee (originator of the 4% breakout / momentum burst)
He does not trade the inside day as its own setup. He wants a quiet day **before** his breakout day:
- "Prior to breakout day stock has very narrow range bar or negative bar" and "If stock gaps up with very big gap of
  20% plus, it has high likelihood of pullback or inside day next day and may not be immediate mover"
  ([What is a good swing breakout setup, 25 Jan 2013](https://stockbee.blogspot.com/2013/01/what-is-good-swing-breakout-setup.html)).
- "day before breakout should be narrow range day or negative day" ([How to identify a quality setup, 14 Jan 2014](https://stockbee.blogspot.com/2014/01/how-to-identify-a-quality-setup.html)).
- On NR7 as a system: "Similar things apply to things like NR7 and many volatility based systems. Unless you are going
  to trade short time frames, it can be huge distraction." ([Detours can be costly, 3 May 2007](https://stockbee.blogspot.com/2007/05/detours-can-be-costly.html))

### 3.10 Kristjan Kullamägi (Qullamaggie)
His setups page does not name the inside day. It matters here for the stop: "Stop is always lows of the day and stop
should not be wider than the ATR or ADR of the stock, to prevent the risk/reward mechanics getting out of whack."
([My 3 timeless setups](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/))

### 3.11 Al Brooks (price action; definitions only)
- **Inside bar (ties allowed):** "A bar with a high that is at or below the high of the prior bar and a low that is at
  or above the low of the prior bar."
- **ii:** "Consecutive inside bars, where the second is inside the first. At the end of a leg, it is a breakout mode
  setup and can become a flag or a reversal setup."
- **iii:** "Three inside bars in a row, and a somewhat more reliable pattern than an ii."
  ([Brooks glossary](https://www.brookstradingcourse.com/price-action-trading-terms-glossary/))

### 3.12 Lance Beggs, YourTradingCoach (price-action educator)
Read directly (re-read in checking). The page itself shows garbled apostrophes (a character-encoding fault on the site);
the quotes here use plain apostrophes, the words are exact.
"ID stands for Inside Day. That is a daily candle which has a high below the previous day's high and a low above the
previous day's low." Stop at the opposite side; the other entry order as a stop-and-reverse ([link](https://yourtradingcoach.org/the-id-nr4-setup/)).

### 3.13 Investopedia (not re-read today)
The site refused my reader. The repo's `docs/study/research/definitions.json` holds a quote read on 2026-10-17 by an
earlier pass: "An inside day is a two-day price pattern that occurs when a second day has a range that is completely
inside the first day's price range." Its summary there says Investopedia buys above the two-day high with the stop under
the two-day low. I could not re-check either today.

### 3.14 People I searched for and did not find writing about it
Mark Minervini, William O'Neil / IBD (searches of investors.com returned nothing on "inside day"; a second, general web
search in checking found no IBD article either), Oliver Kell (his Stockbsessed interview does not mention it; re-checked),
Brian Shannon, Larry Williams. I state nothing for them.

### 3.15 Comparison table

| Criterion | Crabel 1990 (repro.) | Raschke / Street Smarts (secondary) | Bulkowski | StockCharts | TraderLion 2024 | Morpheus 2018 | Mish 2010 | Stockbsessed 2023 | UCT (section 6) |
|---|---|---|---|---|---|---|---|---|---|
| Shape | strict inside | inside + NR4 | strict (lower high, higher low) | NR4 / NR7 | inside | inside, tight range | inside | inside | inside; double and triple; weekly and monthly too |
| Ties allowed | no | not stated | no | n/a | not stated | not stated | not stated | not stated | not stated (scanner allows) |
| Prior trend | none; one-sided only with "a strong bias in one direction" | none stated | none (53% come from an uptrend) | add a trend filter | momentum, after a breakout | after a breakaway gap | "phase" bullish | momentum, MAs respected | leaders above rising MAs |
| Size | narrower than prior 4 to 6 days | NR4 | not stated | narrowest of 4 or 7 | not stated | "tight-ranged" | narrow | "tight" | "tight inside day" |
| Volume | not stated | not stated | not stated | not stated | low | lighter | lighter | not stated | not a rule; "great volume pattern" noted |
| Moving averages | none | none | none | Aroon / CCI | not stated | 10-day, 20-day EMA as later entries | adaptive MA | "key moving averages" | 8/9, 20/21 EMA, 50 and 200 SMA |
| Trigger | next day's opening range break | a stop order over the high / under the low (Beggs) | a close above the first (mother) day's high, buy the next open | a move above the high | over ID high or over prior day's high | buy stop just over the ID high | break of the range (THOR: under the inside days' low; AAPL: over all three days) | break of the ID high | over the ID high, or the sweep and reclaim of the ID low |
| Stop | the other side of the ORB | the other side of the bar | 7%, or a penny under the pattern (the first day's low) | ATR or SAR | ID low or prior day's low; within about 5% | under the gap low | over the high or 3/4 ATR | ID low (or the ID close if wide) | day's low (house: a few cents under) |
| Target or exit | close of the day | not verified | height x2 (test), or the measure rule | quick, resistance, or % | not stated | not stated (still holding) | half ATR, then 1.5 ATR | not stated | house trims and trail |
| Direction | both | both | both | both | long | long | both | both | mostly long; short mirror noted |

### 3.16 Where they disagree
1. **Ties.** Crabel and Bulkowski require strictly lower highs and higher lows. Brooks allows "at or below". Our app
   does both (section 5).
2. **Which high to buy over.** The inside day's own high (Crabel's opening range aside, Raschke via Beggs, Morpheus,
   Stockbsessed, UCT) or the mother bar's high (Bulkowski, whose breakout price is "the first day's high or low";
   Mish's AAPL example; TraderLion's second option; Investopedia as summarised in the repo; our classic app detector;
   Study's own glossary says "the break of the two-day high or low").
3. **Intraday break or a close.** Bulkowski waits for a close above, then buys the next open. Everyone else acts on the
   intraday break.
4. **Direction.** Crabel, Raschke, Mish, Brooks and StockCharts treat it as two-sided. TraderLion, Morpheus and UCT
   trade it with the trend. Crabel goes one-sided only "in a market with a strong bias in one direction or just after a
   clear supply or demand indication".
5. **Stop.** Inside-day low (most), mother-bar low (wider; Bulkowski's pattern stop, TraderLion's second option), a
   percent (Bulkowski's 7%), ATR-based (StockCharts, Mish), or the inside day's close (Stockbsessed, when the bar is
   wide).
6. **How long it stays valid.** Crabel trades the next session's opening range (per the reproduction); I could not
   verify a validity rule for *Street Smarts*; our scanner keeps a fire for 3 sessions; Morpheus watches "within a few
   days of the gap".
7. **Exit.** Crabel's same-day exit vs swing holds. UCT and the house rules hold for 3R, 5R and a trail.
8. **Is it a setup at all?** Bonde calls NR7-type systems a "distraction" for longer-term traders and uses the quiet day
   only as a precondition for his breakout. Quantified Strategies calls the inside day alone "a poor trading signal"
   (section 4).

## 4. Measured evidence

### 4.1 Crabel (futures, 1980s; via the reproduction, not the book)
- "An average of all percentages under the column labelled NR7 was 64%, NR4 64%, Control 57%, WS4 54% and WS7 52%."
  The percentages are, as I read the reproduction, how often the opening range breakout followed through to the close.
- "Profits were seven times larger for ORB trades after contractions than after expansions."
- **Who and how:** Crabel, the same opening range trade after each pattern and on any day (the control), held to the
  close. **Limits:** futures, intraday trades, the 1980s, a fixed distance from the open in the tests, and the blog
  notes "No slippage. No commission." Not a swing trade, not stocks. I could not check the table in the book.
- **The inside day itself:** the blog's caption for Crabel's inside-day table names bonds, the S&P, beans and cattle,
  and says (the blog's words, not Crabel's) "In bonds and the S&P; the pattern beats the same trade taken on any day."
  So the inside-day edge was not shown in every market tested.

### 4.2 Bulkowski, ThePatternSite (stocks; read via the fetch tool)
Inside days ([link](https://thepatternsite.com/InsideDays.html)):
- Sample: "I used 1,260 stocks, starting from December 1989 to January 2013," minimum price $5, one in ten samples
  kept, 29,641 samples.
- Bull market, upward breakouts: "Break even failure rate*: 32% (up breakouts)"; "Average rise*: 10%"; "Percentage
  meeting price target*: 80%"; overall performance rank 10 of 23 (1 is best).
- "The pattern acts as a continuation 62% of the time." "the trend is upward 53% of the time."
- "For example, in a bull market after an upward breakout, 32% of inside days fail to see price rise at least 5%."
- Trading test, 497 stocks, target at twice the pattern height, stop a penny under the pattern (his Table 9), inside
  day in an up trend vs a near-random benchmark: 5,890 vs 6,018 trades, $62.43 vs $48.01 average per trade, and 42%
  vs 40% in the column he labels "Win/loss ratio". Down trend: $77.46 vs $68.70. His words: "Based on the average
  profit, the inside day outperforms the benchmark."
- ETFs (94): worse than the benchmark ($27.88 vs $48.84 in up trends). Crypto (38): worse ($156.42 vs $214.65).
- **Limits:** his breakout is a close over the **first (mother) day's** high, his entry the next open, his pattern stop
  under the first day's low: a different, wider trade than buying over the inside day's own high; December 1989 to
  January 2013; one in ten samples; no relative strength or market filter; the benchmark is "picked almost randomly";
  the tables come through a fetch tool (two separate reads returned the same numbers).

NR7 ([link](https://www.thepatternsite.com/nr7.html)): rank 11 of 23; bull market up breakouts fail 46% of the time,
average rise 7%, 43% meet the target; 1,201 stocks, January 1990 to March 2013. In his target-exit test on 492 stocks,
NR7 in an uptrend averaged $115.81 a trade against $138.22 for the benchmark (worse), and in a downtrend $163.84
against $145.03 (better).

### 4.3 Other published numbers
- **Quantified Strategies** (commercial backtest site, byline Oddmund Groette; rules behind a paywall): "There have been 779
  inside days in the S&P 500 since 1993 (by using the ETF SPY), which is about 10% of the time." and "Our backtests
  indicate that an inside day is a poor trading signal and inside day trading strategies don’t work."
  ([link](https://www.quantifiedstrategies.com/inside-day-trading-strategy/)). Limits: one index ETF; the full rules are
  members-only; and the tests shown **buy at the close**, not on a break of the high, so they are not this trade. Their
  third test (today an inside day, yesterday's high below the day before's close, buy the close, sell on a close over
  yesterday's high) "has produced 89 trades since 1993 and an average gain of 0.45% per trade", a mean-reversion use of
  the bar on the S&P 500.
- **Edgeful** (data vendor): a different definition (the open, not the whole day, inside yesterday's range); 81% to 88%
  of such days reach yesterday's high or low, ES, NQ, TSLA, NVDA, six months. Not usable for this setup.
- **Our app's lab** (in the code docstrings; section 5): these measure **recognition** (does the scanner fire where
  experienced traders would call an inside day setup), not profit. `uct_inside_day`: test-half recall 18.1% at a 2.06%
  random-day fire rate; blind packets 19 yes and 2 no, twice; pooled precision 90.5% (Wilson 95% CI 78 to 96).
  `uct_inside_day_id4`: recall 42.8% vs 23.5%. Member drawing: blind scores 2.56 and 2.44 (pass bar 2.3). Textbook
  gate: pooled 2.585.
- **Our screener** (comment in `bar_character.py`): NR7 marks about "21% of the market" on a given day.

### 4.4 My measurement (preliminary; written for this dossier; not peer reviewed)
**What I did.** Yahoo daily bars (split-adjusted), 187 liquid US stocks that still trade today (large and mid caps plus
recent leaders), 2012-01-01 to 2026-10-01. Liquidity per B23 ($10 and $20M a day). Longs only, close above the 200-day
(B26). The trade: a buy stop a cent over the signal day's high, next session only (a 3-session window gave the same
answer); skip if it opens more than 4% over the trigger (C28); stop a cent under the signal day's low. Two exits:
**E1** = 3R target or stop or close after 20 sessions; **E3** = the house plan (breakeven after 3R, a third at 3R, a
third at 5R, the rest on the first close under the 10-day, 60 sessions at most; **E2** is the same with breakeven at 2R).
**Control** = the same order on every other uptrend day (close > 8 EMA > 21 EMA > 50-day) that was not an inside day,
the way Crabel used a control.

**Base rate.** Strict inside days were 12.0% of all liquid stock-days (68,650 of 573,891). For inside days above the
200-day, the next day traded over the high 58% of the time.

**Main result (conservative scoring, see the caveat right below).**

| Group | Trades | Median stop distance | P(3R before stop, 20 days) | E1 mean R | E3 mean R |
|---|---:|---:|---:|---:|---:|
| Control: uptrend day, not inside | 88,211 | 1.96% | 21.4% | +0.03 | 0.00 |
| Inside day, above 200-day | 26,586 | 1.60% | 23.0% | -0.02 | -0.05 (E2) |
| Inside day + 8 > 21 > 50 stack | 13,233 | 1.51% | 22.2% | -0.06 | -0.08 |
| Same, range at most 0.7 ATR (= `uct_inside_day`) | 8,045 | 1.29% | 22.4% | -0.10 | -0.10 (E2) |
| Same as `uct_inside_day_id4` | 14,802 | 1.44% | 22.7% | -0.06 | -0.08 (E2) |
| Stack + ID/NR4 | 8,159 | 1.35% | 22.4% | -0.09 | -0.10 (E2) |
| Stack + ID/NR7 | 5,375 | 1.22% | 22.3% | -0.11 | -0.11 (E2) |
| Stack + double inside | 789 | 1.33% | 23.2% | -0.06 | -0.03 (E2) |
| Stack + close in **upper** half of the inside day | 9,268 | 1.57% | 23.2% | 0.00 | -0.03 (E2) |
| Stack + close in **lower** half of the inside day | 3,963 | 1.39% | 19.8% | -0.20 | -0.21 (E2) |
| Stack + volume below the mother bar | 10,412 | 1.55% | 22.1% | -0.07 | -0.09 (E2) |
| Stack + close at most 6% over the 50-day (the textbook gate) | 5,327 | 1.21% | 23.7% | 0.00 | -0.02 (E2) |
| Stack + close within 1 ATR of the 21 EMA | 3,400 | 1.53% | 24.1% | +0.02 | +0.02 |
| Stack + within 10 sessions after a 4% gap on 2x volume | 916 | 2.24% | 22.9% | +0.01 | +0.03 |
| NR7 that is not inside, stacked | 12,656 | 1.29% | 22.0% | -0.10 | -0.09 (E2) |

Standard errors on E3 are about 0.02R for the big groups and 0.06R to 0.07R for the small ones; trades bunch in time,
so true uncertainty is larger.

**The big caveat: the next day's order of events.** In 25% of inside-day trades (15% of control trades) the entry day
traded through **both** the trigger and the stop. Daily bars cannot tell which came first. I scored all of them as
losses. If the low came first, a trader who cancels the buy when the low breaks never enters. Scoring those as "no
trade" instead, the inside day + stack group earns **+0.26R (E1) and +0.24R (E3)** against **+0.21R and +0.18R** for the
control. The tighter the inside day, the bigger the problem: 47% of trades from inside days under 0.4 ATR were ambiguous.
So the truth sits between the two scorings.

**Settling the order with hourly bars (Dec 2023 to Oct 2026 only, the span Yahoo's hourly data covers; 185 of the 187
names, as Yahoo returned no hourly bars for RDDT and ALAB).** For every ambiguous trade I looked at that day's hourly
bars. Of 694 ambiguous inside-day trades, the high broke first in 251,
both broke inside the same hour in 251, and the low broke first in only 192 (28%). Scoring "high first" and "same hour"
as losses and dropping "low first" (a trader would have cancelled):

| Group, Dec 2023 to Oct 2026 | Trades | E1 mean R | E3 mean R | Generous bound (same-hour dropped too): E1 / E3 |
|---|---:|---:|---:|---:|
| Control: uptrend day, not inside | 17,885 | +0.05 | +0.02 | +0.11 / +0.07 |
| Inside day + stack | 2,526 | -0.09 | -0.11 | +0.01 / -0.01 |
| Same, range at most 0.7 ATR | 1,438 | -0.16 | -0.16 | -0.03 / -0.03 |
| Same, range over 0.7 ATR | 1,088 | 0.00 | -0.03 | +0.05 / +0.02 |
| Same, close within 1 ATR of the 21 EMA | 597 | +0.05 | +0.08 | +0.17 / +0.21 |
| Same, close in the upper half | 1,833 | -0.11 | -0.10 | -0.03 / -0.02 |
| Same, close in the lower half | 693 | -0.04 | -0.12 | +0.13 / +0.03 |

Standard error on E3 is about 0.04R for the main inside-day row and about 0.08R for the small rows.

*Cold check of this section:* the daily table above matches the writer's saved output, to rounding. The hourly table
had no saved output, so it was recomputed independently from the same bars: 711 ambiguous inside-day trades (251 high
first, 251 same hour, 196 low first, 13 where the hourly bars did not reach the daily high or low), and every cell
came out within 0.01R to 0.02R of the table (for example inside day + stack -0.085 / -0.101, generous +0.016 / -0.002;
close within 1 ATR of the 21 EMA +0.050 / +0.081, generous +0.173 / +0.208). The conclusions below stand.

**What I take from it, carefully.**
- A mechanical inside-day breakout in an uptrend is **not** an edge by itself. Even with the next day's order settled
  hour by hour, it trailed the same order placed on ordinary uptrend days. That matches Bulkowski's small edge in
  stocks and none in ETFs, and Quantified Strategies' "poor trading signal".
- **Tighter was worse, not better.** Inside days of 0.7 ATR or less (our scanner's cap) did worse than wider ones in
  both scorings and in the hourly check. The likely reason: a very tight low sits inside normal noise, so the stop is
  hit more often. The scanner's cap is a recognition filter, not a quality filter.
- **Close location did not survive the hourly check.** On daily scoring, lower-half closes looked much worse (E1 -0.20R
  vs 0.00R, 2012 to 2026). Once the next day's order was settled, the gap closed: many lower-half inside days break
  their low first, which daily scoring had wrongly counted as losses. I would not teach it as a measured rule.
- **Lighter volume did not help.** The only context that looked better was the inside day sitting close to the rising
  21 EMA (a pullback), and that sample is small (597 trades; the range of estimates runs from +0.05R to +0.21R).
- The owner's way of using it (as a lower-risk entry inside a stronger setup, and the trap version) was not tested
  here. Nothing here says his trades lack an edge; it says the bar alone does not supply one.
- **Limits:** survivorship (all 187 names still trade); Yahoo data; no costs or slippage; no earnings filter (B22); no
  RS-80 list (a 126-day return rank among these 187 names did not help); conservative same-bar rules.

### 4.5 Owner examples checked against the bars (Yahoo daily data)
I checked each example's date and shape. "Stack" means close > 8 EMA > 21 EMA > 50-day. The stop distance is from the
fill (the trigger, or the next day's open when it gapped over the trigger) to a cent under the inside day's low; from
the trigger itself POET's is 5.8% and HOOD's 3.9%. All rows were re-run on Yahoo bars in checking and match, except
the ZETA row, now corrected.

| Ticker, inside day | Source | Shape on the bars | Range / ATR | Over 50-day / over 10-day | What happened next |
|---|---|---|---|---|---|
| COIN, 17 Jun 2025 | UCT Substack | strict inside, stack | 0.92 | +14% / +1% | 18 Jun: high 299.32, close 295.29 (the post: "closing up $40") |
| POET, 6 Oct 2025 | owner, Sunday Scans | strict inside, stack | 0.67 | +17% / +6% | 7 and 8 Oct: +24% and +17% days; 7 Oct opened at 6.73, over the 6.57 high, so the stop distance from that open is 7.9%; his listed POET cost on 12 Oct is also $6.73 |
| DDOG, 30 Sep 2025 | owner, Rest of the Week | strict inside, stack | 1.16 | +4% / +3% | 1 Oct: +7%, through $150 within days |
| NVDA, 12 Jan 2024 | TraderLion | strict inside, ID/NR7, stack | 0.47 | +13% / +7% | triggered 16 Jan, ran |
| RDDT, 11 Jul 2025 | owner | strict inside, not stacked | 0.70 | +18% / -3% | triggered 14 Jul, low broken 16 Jul (stopped); Go Signal 18 Jul after the "shakeout under $141 into $138" |
| KVYO, 9 and 10 Sep 2024 | owner, trader archive | double inside, not stacked | 0.88, 0.72 | +8% / -3% | 11 Sep swept the inside lows (29.36) and reclaimed; his entry $29.90, stop 29.35 |
| SOUN, 11 and 12 Sep 2025 | owner | double inside, stack | 0.99, 0.59 | +11% / +1% | his buy $14.35 inside the range; 15 Sep triggered, 16 Sep broke the low, then 17 to 19 Sep rallied |
| AAOI, 11 Sep 2025 | owner | strict inside, not stacked | 0.64 | +8% / +10% | 12 Sep undercut the low and reclaimed (his entry $26.85); 15 Sep +9% |
| METC, 3 Sep 2025 | owner, trader archive | strict inside, not stacked | 0.49 | +21% / 0% | 4 Sep opened under the close, undercut the low, closed over the high; 5 Sep +13% |
| ZETA, 29 Aug 2025 | owner ("Tight inside day below breakout spot") | strict inside, stack | 0.72 | +18% / +2% | never triggered; 2 Sep broke the low; 11 Sep was his Go Signal ("got a good GO SIGNAL on Thursday and took out the HVC", 14 Sep 2025); it opened just above the prior low, so not a textbook Oops |
| HOOD, 4 Sep 2026 | owner | strict inside, stack | 0.66 | +19% / **+11%** | triggered 8 Sep and stopped the same day (C29 would have skipped it) |
| CRCL, 4 Sep 2026 | owner | strict inside, stack | 0.76 | +41% / +9.7% (just under C29's 10%) | never triggered; low broken 8 Sep |
| TSLA, 18 and 19 Dec 2025 | owner | double inside, stack | 1.03, 0.89 | +10% / +4% | 22 Dec traded over the high, then drifted |
| ASML, 28 Oct 2025 | Rest of the Week (Alex Jones section) | strict ID/NR7, stack | 0.31 | +16% / +2% | triggered 29 Oct on a small gap, stopped 31 Oct |
| INTC, 21 Oct 2025 | owner | strict ID/NR7, stack | 0.37 | +29% / +3% | 22 Oct broke the low first (his preferred "shakeout"), reclaimed 23 Oct |
| SMTC, 18 Jun 2026 | owner ("inside day after a 20EMA shakeout") | strict inside, not stacked, 5x volume | 0.69 | +21% / -1% | 22 Jun gapped over (2.7%), stopped 26 Jun |
| XLF, 17 Apr 2025 (short side) | owner, trader archive (read as a market-direction tell, not a logged trade) | strict inside, under the 200-day, weak close | 0.39 | -6% / +2% | 21 Apr broke the low (short trigger), 22 Apr traded back over the high |
| ETHA, 5 and 6 Aug 2025 | Bracco | **not** strict inside on ETHA's Yahoo bars (the post may mean Ethereum's own chart) | | | 7 Aug gapped up |

Takeaway: the winners were mostly inside days after a fresh expansion (COIN, POET, DDOG; TraderLion's NVDA) or inside
days that were swept and reclaimed (KVYO, AAOI, METC, INTC). The losers in this list were stretched (HOOD 11% over its
10-day; CRCL 41% over its 50-day), triggered and then lost the low (RDDT, SMTC, ASML), or broke down without triggering
(ZETA). The owner's own words on HOOD and CRCL that weekend called both "tight inside day" setups after an expansion
day (Sunday Scans, 6 Sep 2026). Many of his inside days were wider than 0.7 ATR, stretched more than 6% over the
50-day, or not fully stacked, so our scanners and the member drawing would miss them (section 5).

## 5. Our app: what the code actually tests

### 5.1 `api/services/pattern_engine/detectors/uct/uct_inside_day.py` (admin-only; pattern `uct_inside_day`)
- **Inside test allows ties:** `high <= prior high and low >= prior low` (`_inside`, line 75).
- **Trend gate:** `close > 8 EMA > 21 EMA > 50 SMA` (`ID_TREND = "stack"`). No 200-day test.
- **Tightness:** inside range at most 0.7 x ATR(14) (`ID_TIGHT_ATR = 0.7`); ATR is a 14-day simple average of true range.
- **Variant:** `double_inside` when the prior day was also inside its own prior day.
- **Levels:** entry = the inside day's high; stop = the inside day's low exactly (no few-cents buffer); targets at 2R
  and 3R (`make_levels` in `uct_setups_common.py`); the narrative says "Targets are in R from the inside day's low ...
  (2R) and ... (3R)".
- **Wrapper:** liquidity floor of $2 and $10,000 average dollar volume over 20 days (`primitives/liquidity.py`
  defaults); reports the newest of the last 3 sessions that qualifies (`MAX_TRIGGER_AGE = 3`) while no later session
  traded under the stop. It does not check whether the trigger already fired.
- **Confidence floor never bites:** the lowest possible score is 0.40 x 70 + 0.25 x 40 + 0.20 x 40 + 0.15 x 50 = 53.5,
  above the floor of 50.
- **Lab provenance:** grid point frozen on traders' scored calls; recognition numbers in section 4.3.

### 5.2 `.../uct/uct_inside_day_id4.py` (admin-only; pattern `uct_inside_day_id4`)
- Everything in 5.1, **plus** a second branch when 5.1 does not fire: close above a 21 EMA that is higher than 5
  sessions ago, inside range at most 1.0 ATR, the 50-day higher than 10 sessions ago, and close above the 200-day.
- Note: the 200-day test applies only to the new branch, not to the base branch.

### 5.3 The member drawing: `.../pattern_engine/inside_day_draw.py` plus `textbook_gate.inside_day_fails`
- Recognition is the `id4` rule. The drawing is **withheld** when: the high already triggered; the inside range is under
  0.2 ATR or ATR is under 1% of price; the mother bar closed red in its lower 40%; the mother's upper wick is over half
  its range; the close is below 80% of its 60-session range; the inside range is over 70% of the mother's, or the
  inside high sits within 0.1 ATR of the mother high.
- The textbook gate then also withholds unless: Minervini-style trend template (close over the 200-day, the 200-day
  rising over 20 and 60 sessions and at least 2% over 3 months, the 50-day over the 200-day and not falling, within 15%
  of the 52-week high); inside range at most **60%** of the mother's; close at most **6% over the 50-day**; trigger to
  stop at most 1.0 ATR.
- `docs/patterns/JUDGED_GATE.md` records that all 32 earlier inside-day fixture cases were retired by this gate because
  "every one is more than 6% above its 50-day".

### 5.4 Classic detectors (older, not UCT-specific)
- `.../classical/inside_bar_breakout.py`: requires the mother bar to be an **outside** bar against the bar before it
  (no source I read asks for this); strict inside; inside body under half its range; trigger is a **close** beyond the
  **mother** high; entry 0.1% over the mother high; stop **1.5% under the mother low**; target twice the mother's range.
  Its docstring says "the Stockbee community treats them as the highest-edge single-bar continuation pattern"; I found
  nothing like that from Bonde, who calls NR7-type systems a "distraction" (section 3.9).
- `.../classical/nr7.py`: strict NR7; both directions; target three times the bar's range, called "Crabel's measured
  move" (not found in any source I read). **Bug:** the "NR4 bonus" (`nr4_also_true`, line 82) is always true once the
  NR7 test passes, because the narrowest of 7 days is always the narrowest of the last 4; the +15 geometry bonus is
  therefore always added. Its docstring also says NR4 is "a subset of NR7"; it is the other way round. Its narrative
  makes claims I could not verify anywhere: NR7 "moves of 1.5-2.5x average range on the following bar roughly 65% of
  the time"; "Crabel specifically notes NR4+NR7 confluence as the strongest"; Raschke "noting that NR7 + inside bar
  combinations have particularly clean breakout signatures". The only Crabel number I found is the 64% vs 57% follow-
  through in 4.1, which is a different measure. These texts should be fixed before anything is taught from them.

### 5.5 Screener labels: `api/services/screener/bar_character.py`
"Inside Day" (strict: high below and low above), "2-Bar Inside Run", "3+ Bar Inside Run", "Inside Day (NR7)" and
"Compression Bar (NR7)". Here the NR7 test allows ties (`rng <= min(last7)`). The two run labels read
`inside_bar_run` from `candles.multi_candle`, which **allows ties** (`high <= prior high and low >= prior low`) and
breaks the run on a zero-range or zero-volume day, so the screener's single inside day is strict while its runs are not. The "Inside Day (NR7)" text calls it
"Crabel's double compression"; I did not find that phrase in the Crabel material I read (his combined pattern is IDnr4).

### 5.6 Model Book, journal tags, Study content
- `app/src/pages/modelbook/setupCatalog.js`: **no Inside Day card** (26 cards; none for it).
- `app/src/constants/setupGroups.js`: **no "Inside Day" journal tag**.
- `docs/study/TRADE_PLANS.md`: no Inside Day row.
- Study already teaches the word: `docs/study/terms/chart_words.json` defines it and says "the break of the two-day high
  or low is the next decision" (the mother bar's levels, which differs from the owner's and the scanner's ID high).
  `docs/study/UNITS-foundations.md` F3.08 covers inside day, outside day and the hikkake.

### 5.7 Where the app disagrees with the sources or the house
1. Six definitions: strict (classic detectors, the screener's single "Inside Day", Crabel, Bulkowski) vs ties allowed
   (UCT scanners, the member drawing and textbook gate, the screener's inside-run labels, Brooks).
2. Liquidity floor $2 / $10k vs B23 $10 / $20M a day.
3. No 200-day check in `uct_inside_day` (B26).
4. No stretch check against the 10-day (C29). The drawing's 6%-over-50-day gate is much stricter than C29 and hides
   most of the published examples (COIN +14%, POET +17%, TraderLion's NVDA +13%; DDOG passes at +4%).
5. Stop exactly at the low vs F62's few cents under.
6. Targets 2R and 3R in the narratives vs B19 and E51 (a third at 3R, a third at 5R).
7. Long only. The house says shorts are the long setups reversed (D47).
8. The 0.7 ATR cap and the 8 > 21 > 50 stack miss many owner examples (COIN 0.92 ATR, DDOG 1.16, TSLA 1.03; RDDT,
   KVYO, METC, AAOI, SMTC not stacked). My test found no benefit from the stack or the cap.
9. A 3-session fire window without checking that the trigger already fired invites chasing.
10. The classic detector's stop (1.5% under the mother low) is far wider than any source's.
11. The NR7 detector's bug and its unverified claims (5.4).

## 6. UCT's own words

102 of the 103 Substack posts carry the byline "Uncharted Territory" (one, 13 Jul 2025, shows none). Sections inside a
post are headed, for example, "TSDR’s Weekly Outlook & Watchlist" (the owner; some posts' headings read "Patrick
(TSDR)’s Weekly Outlook & Watchlist"), "Bracco’s Breakdown & Top Ideas", and an "Index & ETF" section that names no
writer. "The Rest of the Week" posts name each section's writer (TSDR Trading, Manrav, ChartMaster, Beebe, Alex Jones
Industrial Average, AMT). The sitemap lists 103 posts; 102 are public and one (`sunday-scans-bf1`) is for paying
subscribers only and could not be read. About two thirds mention inside days, inside bars or inside weeks (66 to 69 in a
recount, depending on how the words are matched). Below are the ones that say how they are used. Rest of the Week
dates are the dates in each post's own subtitle.

### 6.1 The owner (TSDR sections and his desk logs)
**How he thinks about it.**
- "Here is my approach. Give me an oops. Give me some sideways and a tap of the 20EMA. Give me an inside day. Give me a
  clean retest or remount after and undercut." ([Sunday Scans, 6 Sep 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd))
- "Okay, calm down Patrick. We have a shortened holiday week, I would love to see four consecutive inside days on all
  stocks on my watchlist (inside joke within the group)." ([Sunday Scans, 24 May 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb))
- From the Index & ETF section (IWM weekly; the section names no writer, so placing it with the owner is my inference
  from his own inside-day joke above): "LOL at the folks in the chat who know my love for inside days."
  ([Sunday Scans, 7 Dec 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-088))
- "Ideally it gives me a little cheat with an inside day or two here." (AAOI, [3 May 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc))

**The two scenarios: break the high, or sweep and reclaim the low.**
- RDDT: "Inside day on Friday. $141.30 3 day support low. Two scenarios possible, Break inside day high of $147.40 and
  trend towards recent highs or undercut and reclaim $141.30 with a stop at the new established support."
  ([13 Jul 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6)). A week later: "The shakeout under $141
  into $138 held and gave a GO SIGNAL." and, with no position yet, "I would love an inside day tomorrow to allow me to
  better enter the stock." ([20 Jul 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-c82))
- Trader archive (KB 14619, 2024-12-13, a mentoring exchange, `docs/study/levels/brain_kb_rules_2026-11-06.json`):
  "Double inside day, oops reversal. Simple shit nothing new." and "All MAs stacked, swept both inside days. What else
  do you want?"
- Trader archive (KB 13514, 2025-09-06, METC): "Inside day candle, then Thursday gives an OOPS REVERSAL/Gap Down red to
  green. Friday follows through." and "Strong structure, strong group, higher lows, undercut, remount, get tight and go."
- KVYO recap (trader archive, KB 10775, 2024-09-17): "ENTRY at $29.90 on reclaim of double inside day", "Stop at LOD on
  day of entry".
- SNDK: "double inside days and could see failed breakdown and hold of 20EMA and oops reversal to reclaim double inside
  day lows." ([23 Aug 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-807))
- MU: "I should have added more sized on the failed double inside day break when it had a strong close back above the
  9EMA that day." ([16 Aug 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-da5))
- AAOI: "AAOI ($26.85) bought the undercut and reclaim of the inside day following the base breakout attempt."
  ([14 Sep 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-461))
- INTC: "I would be willing to trade this breakout of the inside day, but preferably we get a shakeout bar or squat to
  the 20EMA and then find buyers again." Then: "This would allow heavy sizing and tight risk." ([Rest of the Week, 21 Oct 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481))

**Where he wants it.**
- After a breakout: "Finally broke out on Friday out of this pattern. If not in, look for an inside day or two up here."
  (SHOP, [8 Jun 2025](https://unchartedterritoryy.substack.com/p/sunday-scans)); DDOG: "This is a very nice inside day following
  a break of range on Monday." and "All the moving averages stack and price holding above rising 9ema and 20ema. Today’s
  inside day was a clean retest of that breakout spot." ([Rest of the Week, 30 Sep 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week))
- After a Go Signal or a Kicker: ASML, "GO SIGNAL on Wednesday followed by inside day Thursday." ([6 Jul 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-df6));
  YSS, "Took a little flyer on the kicker candle Thursday after retesting the $30 base. Inside day Friday"
  ([3 May 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc)).
- After an earnings gap or an HVE: "Highest Volume Ever (HVE) on earnings day followed up by inside day on Friday. $5.96
  is HVE trigger for the trade." ([8 Jun 2025](https://unchartedterritoryy.substack.com/p/sunday-scans)); "Double inside
  days after monster ER gap up and very high volume." ([30 Aug 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-d40))
- At the 20-day: "Can’t deny the simple setup of an inside day after a 20EMA shakeout." ([21 Jun 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0));
  "Now we have an inside day and a higher low at a rising 20EMA?" ([6 Sep 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd))
- Under a breakout spot: "Tight inside day below breakout spot. Checks a lot of boxes here." ([1 Sep 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1))
- To stop a wedge: "Inside day would be awesome to avoid wedging up behavior." ([24 Aug 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa))
- Relative strength on a weak day: "Powerful breakout Wednesday and then on Friday while a lot of stocks showed weakness
  this just had an orderly inside day." ([14 Dec 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-f2f))
- Not after a long run: "Staying focused on things HERE vs as they are up 6 days in a row is how you get positioned in
  big legs." ([12 Jul 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-898))
- The close: "really like the strong close with the inside day Friday." (QBTS, [31 May 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-6d8))

**How he enters.**
- Over the high: COIN, "Breaking the inside day high and closing up $40 on the session." and "Then Monday’s strength and
  Tuesday’s inside day makes it a FOCUS." ([19 Jun 2025 post](https://unchartedterritoryy.substack.com/p/market-update-and-watchlist); the section names no writer).
- Desk log (KB 9895, 2024-10-06): "AMSC--Looking for inside day, then buy trigger through 24.30".
- Desk log (KB 10095, 2025-05-20): "HTZ inside day at MAs. Does have a bearish gap above to $6.94. Can take over inside
  day highs and observe how it acts around 7".
- Inside the inside day (anticipation): "SOUN ($14.35) bought the double inside days, usually wait for a GO SIGNAL, but
  wanted a chunk." ([14 Sep 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-461)); $14.35 sits inside
  both inside days' ranges and the post came out before the trigger day. POET is less clear: "POET was awesome, I bought
  the inside day prior to the two big up days." ([12 Oct 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-296)),
  but the same post lists his POET shares at "POET ($6.73)", which is the 7 Oct open, above the inside day's 6.57 high:
  the shares may have been bought on the gap over the trigger (the post also names $8 calls). Ask the owner.
- As an alternative to red-to-green: "Now I want an inside day or red to green on a gap down." (INCY, [4 Jan 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-153));
  "Technically trigger on Friday, so ideally we get an inside day or red to green move to get involved." (ZETA,
  [17 Aug 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-644))

**Market reading.**
- Trader archive (KB 10832, 2024-12-23): "Market is screaming to wait til Thursday to trade imo" and "Lot of inside days
  in the market rn".
- Trader archive (KB 11160, 2025-04-20), the bearish side: "XLF Rejecting 200 day from under with weak inside day." The
  KB's summary says he watched it "as a market-direction tell", not as a logged short.

### 6.2 Bracco
- "It reclaimed the moving averages with authority on Monday and then gave us double inside days right at the 20ema. I
  was ready to add some serious size on this through those double inside days." (Ethereum / ETHA, [10 Aug 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f))
- "Wednesday we got inside bars across the board with weak closes, which made the gap up on Thursday very intriguing as
  I think most participants were expecting immediate lower prices to follow." ([14 Jun 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-e95))
- "We traded an inside bar last week and now have an entire month of consecutive lower highs and higher lows as price
  action gets tight in this consolidation." ([5 Jul 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-dec))
- Trader-archive note (KB 11114, 2024-10-12, HOOD, as summarised in the KB, not his verbatim words): an inside day
  after an earnings gap was a "rest day", and the next day's red-to-green was the entry with a low-of-day stop.

### 6.3 Index & ETF sections (writer not named)
- "Weak inside bar closing near the bottom the range with weekly EMA’s starting to curl down. Looks vulnerable here for
  a move down to test the June lows or 20-week EMA." (QQQ weekly, [5 Jul 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-dec))
- "Failed inside bar breakdown on the weekly timeframe and close near the highs favors upside continuation from here
  imo." ([12 Jul 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-898))
- "Dow Jones ending the week with an inside day after new all time highs the day before." ([14 Sep 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-461))

### 6.4 Other UCT writers
- Manrav: "Ideally would like to see an inside day here before the push up or long above 50 SMA with 21 EMA stop."
  (RKT, [Rest of the Week, 11 Nov 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045)); "Long
  above the tight inside day or the trendline." (ON, [9 Dec 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b3f)).
- Manrav, trader archive (KB 11831, 2025-09-22): "Inside day or double inside days and oops is a repeatable edge. Does
  it mean, it works all the time, NO! But you have a defined RISK."
- Manrav, trader archive (KB 11028, 2024-07-30, KB summary, not verbatim): the Oops works best off inside and double
  inside days; long when it retakes the prior close with the day's low as the stop; short when it falls back under the
  inside day's close with the day's high as the stop.
- ChartMaster: "Daily showing inside day at the pivot. $27.05 trigger." (PGNY, [6 Jan 2026](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0));
  "Triple inside day digesting the earnings move. I'm looking for an entry around the 8 ema." (RCL, [3 Feb 2026](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732)).
- Alex Jones Industrial Average: "Tight inside day today after breaking this $1050 level that acted as resistance for
  most of October." (ASML, [28 Oct 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757)).

### 6.5 What UCT has not written
I found no UCT text that sets a size limit for the inside day, a volume rule, a rule on how many days the trigger stays
valid, or a short-side plan. The owner has no verdict on this setup in `owner_verdicts.jsonl`.

### 6.6 Other house files that use it (added in checking)
- The KB's own cluster: `docs/study/levels/brain_kb_cycle_2026-11-06.json` has an "Inside bar break" group (25 passages
  from TSDR, Bracco, Manrav and others; five of them, KB 10775, 10832, 11028, 11114 and 11160, are quoted above).
- The level dossiers use the inside day as an **entry inside other setups**: `dossiers/hve.md` ("or a tight inside day
  just under it, then the breakout"), `dossiers/gap_support.md` ("or an inside day tightening just above the gap"; and
  tighten the stop "to the latest inside day's low or the 20 EMA"), `dossiers/oops.md` (Manrav: the Oops "Works best off
  inside and double-inside days."). These are the dossiers' own summaries, not the traders' verbatim words.
- A desk note in the KB (`brain_kb_rules_2026-11-06.json`): "RKT- Inside day post earnings, great volume pattern" (the
  source of the "great volume pattern" note in the table in 3.15).

## 7. How it fits the account rulebook (section 9)

| Rule | What it means here | Conflict? |
|---|---|---|
| B26, 200-day (hard) | Longs only above the 200-day SMA; shorts only below it | `uct_inside_day` does not check it. Mish's AAPL 2009 example fails it. |
| D47, shorts mirror | Inside day in a downtrend, sell under the low, stop over the high | App has no short version. |
| A3, F62, stop | A few cents under the inside day's low | App stops exactly at the low. |
| A13, about 3% | The stop usually within about 3% | In my large-cap test the median stop was 1.5% and 88% were within 3%. On the owner's names it is often wider (from the fill): COIN 4.2%, RDDT 4.2%, HOOD 4.2%, POET 7.9%. |
| A5, size from the stop | A wider inside day means fewer shares | Fits. |
| E57, market orders | Buy when it trades through the high | A resting buy-stop becomes a market order when hit; owner to confirm that counts. |
| C28, no chase over 4% | A gap over the high: buy only if the open is within 4% of the trigger | Fits; my test applied it. |
| C29, 10% over the 10-day | Skip stretched inside days | HOOD (11.0% over its 10-day SMA) fails. CRCL is on the line: 9.7% over the 10-day SMA (passes) but 10.2% over a 10-day EMA (fails), so the owner should say which average C29 means. The drawing's 6%-over-50-day gate is a different, stricter test. |
| B19, E51, E52, trims and trail | Breakeven 2R to 5R; a third at 3R and 5R; trail the 10 or 21-day | App narratives say 2R and 3R. |
| B20, gap through the stop | First 30-minute low, out past 2R | Fits. |
| B22, earnings | No new buy in the 3 days before a report | Many owner inside days are after a report, which is fine; one just before a report is not. |
| B23, liquidity | $10 and $20M a day | App floor is $2 and $10k. |
| C31, RS 80+ | Leaders only for longs; RS 20 or less for shorts | Fits his usage. |
| C33, time stop | Under 1R after 10 days, sell | Fits; StockCharts also says it should work "right away". |
| B18, F65, market | Green: full; Yellow: smaller and fewer; Orange: A+ only; Red: mostly cash and shorts | Fits. Index full of inside days: he waits. |
| A4, stop never moves down | No moving the stop down to the mother low after entry | Fits. |
| E56, tries | At most 3 tries a week on one stock | The break-then-sweep pattern can tempt many tries. |

No setup-level conflict with B26 for the long version: it lives above rising averages. The friction is the stop width
on volatile names (A13) and the app's gates.

## 8. Proposed rules for our course

Each line can be checked on a chart. Where sources disagree I give the options and a recommendation.

### 8.1 What it is
1. **Inside day:** today's high is below yesterday's high and today's low is above yesterday's low. [originator]
   Options: strict (Crabel, Bulkowski, our screener's single "Inside Day") or ties allowed (Brooks, our scanners, the
   screener's inside runs). **Recommend strict** for teaching, because it is the originator's. Ties are rare and did not
   do worse in my test (tie-only days: 696 trades against 13,233 strict ones in the stacked group, E2 +0.09R with a
   standard error of 0.08R), so this is a choice for clarity, not for edge. [my proposal]
2. **Mother bar:** the day the inside day sits inside. [my proposal: a common price-action label, used in our app's
   code; none of the sources read here uses the word; Bulkowski calls the two days "the pattern"]
3. **Double inside day:** two inside days in a row, each inside the day before. **Triple:** three. [UCT] (Brooks: ii,
   iii.) Option: count days that stay inside the first mother bar (the owner's "Basically 4 inside days within a decent
   pullback bar on Monday.", META, [Sunday Scans, 4 Oct 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6)).
   Owner to choose.
4. **Prior trend:** close above the 200-day and the 50-day above the 200-day [house rule B26 + my proposal]; the 21-day
   EMA rising and the close above it, or a fresh breakout or gap within 10 sessions [UCT]. Do **not** require the full
   8 > 21 > 50 stack: the owner's examples often lack it and my test found no benefit. [my measurement]
5. **Location (one of three):** (a) 1 to 10 sessions after a breakout, an earnings gap, an HVE, a Kicker or a Go Signal;
   (b) at the rising 10 or 20-day (within about 1 ATR of the 21 EMA); (c) just under a breakout spot. [UCT]
6. **Stretch:** close no more than 10% over the 10-day. [house rule C29]
7. **Size:** the stop distance (trigger to a few cents under the low) at most 1 ATR(14) [Qullamaggie's ATR limit +
   my proposal] and ideally within about 3% [house rule A13]. Do not treat a tiny inside day, an NR4 or an NR7 as
   better: in my test the tightest ones did worse with a swing exit [my measurement]. Crabel found NR4 and NR7 better
   for the next day's opening range breakout held to the close, a different trade [originator].
8. **Close:** prefer a close in the upper half of the inside day's range. [UCT "strong close", "weak inside bar
   closing near the bottom"] A grading cue, not a hard rule: my daily test favoured it, but the hourly check did not
   confirm it (4.4).
9. **Volume:** lighter than the mother bar is preferred, not required. [TraderLion, Morpheus, Mish; my test found no
   effect]
10. **Liquidity and leadership:** price $10+, $20M a day [house rule B23]; RS 80+ in a strong group [house rule C31].
11. **Earnings:** not within 3 days before a report. [house rule B22]

### 8.2 The buy
12. **Trigger:** price trades a cent over the inside day's high. [source consensus: Morpheus, Stockbsessed, TraderLion,
    Beggs, StockCharts; Bulkowski differs, 3.3] For a double inside day, over the most recent inside day's high. [my
    proposal]
13. **Order:** a market order as it trades through (a buy-stop market order resting a cent over the high does the same).
    [house rule E57]
14. **Valid for:** the next 3 sessions, as long as the inside day's low has not traded first. [UCT scanner window + my
    measurement (1 and 3 sessions gave the same result)] Options: next day only (Crabel's next-session opening range,
    per the reproduction).
15. **Gap over the trigger:** buy at the open only if it opens no more than 4% over the trigger. [house rule C28] If
    more, it is a gap trade, not this setup.
16. **Second scenario (the owner's trap):** if price trades under the inside day's low first, the buy-over-the-high is
    cancelled. If it then reclaims the inside day's low (or the prior close) the same day, that is an Oops Reversal off
    the inside day: buy the reclaim, stop a few cents under that day's low. [UCT, owner and Manrav] **Recommend** teaching
    it here as "scenario B" and linking to the Oops lesson. [my proposal]
17. **Anticipation (optional):** buying late on the inside day itself, stop under its low, as he did with SOUN (POET
    may instead have been bought on the gap over the trigger; see 6.1). [UCT] Owner to decide whether we teach it.

### 8.3 The stop
18. A few cents under the inside day's low. [house rule A3, F62; source consensus: Stockbsessed, Beggs, TraderLion]
    Double inside: under the most recent inside day's low (tighter) or the first one's (wider); owner to choose. For
    scenario B: under the reclaim day's low. [UCT]
19. If that stop is more than 1 ATR or well over 3%, size down (A5) or skip (A3). Never use the mother low just to
    give it room. [house rule A3; A4 once in the trade] (Bulkowski's pattern stop does sit under the mother low; that is
    his wider, close-confirmed version of the trade, 3.3.)
20. A gap through the stop: the first 30-minute low is the new stop; out past 2R. [house rule B20]

### 8.4 Trims and trail (house defaults; no setup-specific reason to differ)
21. Stop to breakeven at 2R to 5R [B19]; a third at 3R; a third at 5R [B19, E51]; a gap over a trim level, trim at the
    open [F63]; the rest trailed on a close under the 10-day (fast movers) or 21-day (steadier) [E52]. [house rule]
22. Time stop: under 1R after 10 trading days, sell. [house rule C33]

### 8.5 What invalidates it
23. Before entry: the inside day's low trades first (then watch scenario B); a close under the 21 EMA; an earnings date
    inside 3 days; a Red market. [UCT + house rules]
24. After entry: the stop. Optional early-warning rule for the owner: the entry day closes back under the inside day's
    high. [StockCharts "starts working right away"; my proposal, not tested]

### 8.6 The short mirror
25. Below the 200-day only [house rule B26] (that the 200-day is also falling is my proposal); close under a falling
    21 EMA and 50-day; RS 20 or less [C31]; an inside day after a breakdown or a bounce into the falling 10 or 20-day;
    close in the **lower** half [UCT "weak inside bar closing near the bottom"]; sell short a cent under the low; stop a
    few cents over the high; skip hard-to-borrow names [D48]. [house rule D47 + my proposal] UCT examples, both read as
    bearish tells rather than logged shorts: XLF, 17 Apr 2025 (trader archive) and the QQQ weekly of 5 Jul 2026. On the
    bars, an XLF short under the low would have reversed the next day. I did not measure the short side.

### 8.7 Best market conditions
26. Green or Yellow market [B18, F65]. When the indexes print a cluster of inside days, wait for the break (owner, KB
    10832; Bracco, 14 Jun 2026). Raschke's point: contraction comes before expansion, so be ready for a trend day, in
    either direction. [UCT + originator]

### 8.8 Common mistakes (from the sources and the examples)
27. Buying every inside day. The bar alone is near random (Bulkowski 53%; my test).
28. Buying a stretched one: more than 10% over the 10-day (HOOD, Sep 2026) or after "up 6 days in a row".
29. Reading a weak-close inside day (lower half of its range, under resistance) as bullish (UCT's QQQ and XLF notes).
30. Chasing a gap over the trigger by more than 4%.
31. Using the mother low as the stop because the inside low feels too tight, then sizing as if it were tight.
32. Ignoring the failure: a break of the low first is information, and the reclaim (scenario B) can be the better trade
    (RDDT, KVYO, AAOI, METC, INTC).
33. Buying just before earnings.
34. Calling a harami, a narrow-range day or a day that only opened inside yesterday's range an inside day.
35. Taking the setup in a market full of inside days before it picks a direction.

### 8.9 Example bank to model (checked on the bars in 4.5; owner to pick his 10)
Winners: COIN 17 Jun 2025; POET 6 Oct 2025; DDOG 30 Sep 2025; NVDA 12 Jan 2024 (TraderLion's); METC 3 Sep 2025
(scenario B); KVYO 9 and 10 Sep 2024 (scenario B); AAOI 11 Sep 2025 (scenario B); INTC 21 Oct 2025 (scenario B).
Losers and lessons: HOOD 4 Sep 2026 (stretched, over C29); CRCL 4 Sep 2026 (41% over its 50-day, on the C29 line,
never triggered); ZETA 29 Aug 2025 (broke down first); RDDT 11 Jul 2025 (stopped,
then the Go Signal); SMTC 18 Jun 2026 (gap fill, then stopped); ASML 28 Oct 2025 (ID/NR7 that failed). Short side: XLF
17 Apr 2025 (a bearish tell he wrote about, not a logged short; a short under its low reversed the next day).

## 9. Grading (observable cues, not a checklist; E50 says grading is his judgment)

| Cue | Points toward A+ | Points toward B- |
|---|---|---|
| Stock | RS 90+, a leader in a leading group | RS under 80, laggard group |
| Market | Green, indexes trending | Indexes printing their own inside days, Yellow or worse |
| Where it sits | 1 to 5 days after a breakout or earnings gap on big volume, or the first tag of the rising 10/20-day | middle of a choppy range, under a falling 50-day |
| Close | upper half, near the high | lower half, near the low |
| Size | a normal-sized pause for the stock (about 0.5 to 1 ATR), stop within 1 to 3% | stop over 1 ATR or over 4%; or a sliver under 0.4 ATR whose low sits inside the noise |
| Stretch | 0 to 5% over the 10-day | over 10% over the 10-day, up 5 to 6 days in a row |
| Volume | lighter than the mother bar after a heavy-volume expansion | heavy, wide, red mother bar with a long upper wick |
| Room | clear air to the next level | a bearish gap or old high just overhead (his HTZ note) |
| Calendar | no earnings for 3+ days | earnings within 3 days |

Basis: the owner's and TraderLion's examples (A+ cues) and the house rules. None of these cues had firm measured
support in my test: very tight inside days did worse, and the pullback-to-the-21-EMA location was the only one that
looked mildly better (small sample). The rest is the traders' judgment, which E50 leaves to the owner.

## 10. Questions for the owner

1. **Ties:** does a day that matches yesterday's high or low to the cent count as inside? (a) strict, (b) ties allowed.
2. **Which high:** buy over (a) the inside day's high, or (b) the mother bar's high? Study's glossary currently says the
   two-day high, as do Bulkowski (the first day's high, on a close) and Investopedia as summarised in the repo.
3. **Stop for a double inside day:** under (a) the last inside day's low, or (b) the first one's?
4. **Scenario B:** teach the sweep-and-reclaim of the inside day (inside day + Oops) (a) inside this lesson, (b) only
   in the Oops lesson, (c) both, cross-linked?
5. **Anticipation:** do we teach buying the inside day itself (SOUN), or only the break? And was the POET buy on 6 Oct
   (the inside day) or at the 7 Oct open ($6.73, the cost listed in your 12 Oct post)?
6. **Size limit:** what is the widest inside day you would take: (a) 1 ATR, (b) about 3% stop (A13), (c) no limit, size
   down instead?
7. **Trend gate:** (a) the full 8 > 21 > 50 stack (scanner), (b) close over a rising 21 EMA (id4), (c) just over the 50
   and 200-day plus a location rule (my recommendation)?
8. **Stretch:** keep the member drawing's 6%-over-the-50-day gate, or use only C29 (10% over the 10-day)? The 6% gate
   hides most of your examples. And is C29's "10-day average" the simple or the exponential one? (CRCL on 4 Sep 2026
   passes one and fails the other.)
9. **How long the trigger stays live:** (a) next day only, (b) 3 sessions, (c) until the low breaks.
10. **Close:** make "close in the upper half" a rule, or a grading cue?
11. **Inside weeks and months:** same lesson as a variant, or their own?
12. **Short side:** teach the mirror now? Any short examples you like?
13. **Order type:** does a resting buy-stop (market on trigger) satisfy E57 "market order everything"?
14. **App:** add an Inside Day card to the Model Book and a journal tag? Fix the liquidity floor, add the 200-day gate,
    fix the NR7 bonus bug and remove the unverified Crabel and Raschke claims from the NR7 and inside-bar narratives?
15. **Early exit:** if the entry day closes back under the inside day's high, (a) hold to the stop, (b) cut?
16. **Narrow-range days that are not inside** (Morpheus's BOOT day): same lesson, or not ours?

## 11. Sources (all read on 2026-11-09 unless marked)

| Source | Publisher / author | URL | Reliability note |
|---|---|---|---|
| Definition of Price Patterns, Toby Crabel | Time Price Research blog (reproduces Crabel 1990) | https://time-price-research-astrofin.blogspot.com/2012/04/toby-crabel-definition-of-patterns.html | Third-party blog; quotes presented as Crabel's but not checked against the book |
| Capturing Trend Days | Linda Bradford Raschke, reprinted on TradersLog | https://www.traderslog.com/?p=823 | Originator-level trader's own article; reprint date not shown |
| Narrow Range Day (NR7) | StockCharts ChartSchool (no author shown) | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7 | Established educator |
| Bulkowski on Inside Days | Thomas N. Bulkowski, ThePatternSite | https://thepatternsite.com/InsideDays.html | Measured statistics; read via fetch tool (406 to plain requests); **site states it must not be used to train AI** |
| Bulkowski on the NR7 Chart Pattern | Thomas N. Bulkowski | https://www.thepatternsite.com/nr7.html | Same; same AI notice |
| Inside Days thread, 7 Dec 2024 | TraderLion, via Thread Reader App | https://threadreaderapp.com/thread/1865382390752854290.html | Established educator; mirror of an X thread |
| How To Trade Breakaway Gaps, 6 Sep 2018 | Deron Wagner, Morpheus Trading | https://morpheustrading.com/blog/breakaways-gaps/ | Established educator |
| Inside Days: Strategies..., 25 Jun 2010 | Mish Schneider, MarketGauge | https://marketgauge.com/resources/mishs-daily-articles/inside-days-strategies-for-this-powerful-short-term-stock-trading-pattern/ | Established educator |
| Inside Day Trading Strategy, 25 Mar 2023 | Stockbsessed (Substack) | https://stockbsessed.substack.com/p/inside-day-trading-strategy | Practitioner educator; moderate |
| What is a good swing breakout setup, 25 Jan 2013 | Pradeep Bonde, Stockbee | https://stockbee.blogspot.com/2013/01/what-is-good-swing-breakout-setup.html | Originator's own blog |
| How to identify a quality setup, 14 Jan 2014 | Pradeep Bonde | https://stockbee.blogspot.com/2014/01/how-to-identify-a-quality-setup.html | Originator's own blog |
| Swing trading using momentum bursts, Jan 2014 | Pradeep Bonde | https://stockbee.blogspot.com/2014/01/swing-trading-using-momentum-bursts.html | Originator's own blog; background only, nothing quoted |
| How do stock move on 3 to 5 day time frame, May 2015 | Pradeep Bonde | https://stockbee.blogspot.com/2015/05/how-do-stock-move-on-3-to-5-day-time.html | Originator's own blog; background only, nothing quoted |
| Detours can be costly, 3 May 2007 | Pradeep Bonde | https://stockbee.blogspot.com/2007/05/detours-can-be-costly.html | Originator's own blog |
| My 3 timeless setups | Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Originator's own site (no inside-day content; stop rule only) |
| Price action trading terms glossary | Al Brooks, Brooks Trading Course | https://www.brookstradingcourse.com/price-action-trading-terms-glossary/ | Established educator; definitions |
| Brooks price action abbreviations | Al Brooks | https://www.brookstradingcourse.com/brooks-price-action-abbreviations/ | Same |
| The ID-NR4 Setup | Lance Beggs, YourTradingCoach | https://yourtradingcoach.org/the-id-nr4-setup/ | Price-action educator; read directly in checking; the site garbles its apostrophes, the words are exact |
| Hikkake pattern | Wikipedia | https://en.wikipedia.org/wiki/Hikkake_pattern | Encyclopedia; used only for the name and its origin |
| Who we are | Chesler Analytics (Daniel L. Chesler's firm) | https://chesler.us/about/whoweare.htm | The hikkake originator's own firm page; used only for the year (2004); added in checking |
| Linda Bradford Raschke | Wikipedia | https://en.wikipedia.org/wiki/Linda_Bradford_Raschke | Encyclopedia; used only for the book's publisher and year |
| Inside Day Trading Strategy | Quantified Strategies (byline: Oddmund Groette) | https://www.quantifiedstrategies.com/inside-day-trading-strategy/ | Commercial backtests; rules paywalled; moderate to low |
| Inside day breakout data, 25 Apr 2026 | Edgeful blog | https://www.edgeful.com/blog/posts/inside-day-in-trading-breakout-data | Data vendor; different definition; not used for rules |
| Oliver Kell interview | Stockbsessed | https://stockbsessed.substack.com/p/oliver-kell-interview-the-mind-and | Checked only for absence of inside-day content |
| Inside Day (Investopedia) | Investopedia | https://www.investopedia.com/terms/i/inside_day.asp | **Not read today** (blocked; also refused in checking); quote taken from the repo's definitions.json, read 2026-10-17 |
| TraderLion article "Inside Days: How To Catch True Market Leaders After the Breakout" | TraderLion | https://traderlion.com/trading-strategies/inside-days-how-to-catch-market-leaders/ | **Not read** (blocked; also refused in checking) |
| ID/NR4 article (Technical Analysis of Stocks & Commodities) | Traders.com | https://technical.traders.com/tradersonline/display.asp?art=2666 | **Not read** (refused in checking); found by search as a possible second ID/NR4 summary, nothing from it is used |
| *Day Trading with Short Term Price Patterns and Opening Range Breakout* (1990) | Toby Crabel, Traders Press | n/a | **Not read** (out of print) |
| *Street Smarts* (1995) | Connors and Raschke, M. Gordon Publishing Group | n/a | **Not read** |
| UCT Substack, the 103 posts in the sitemap (102 public; `sunday-scans-bf1` subscribers-only, not read) | Uncharted Territory (sections by TSDR, Bracco, Manrav, ChartMaster, Alex Jones Industrial Average, others) | https://unchartedterritoryy.substack.com/sitemap.xml | House source; quotes exact (all re-checked); post links given in section 6 |
| UCT knowledge base (desk logs and trader archive) | repo files `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json` | in repo | House source; "In X's words" parts are verbatim, the rest are KB summaries |
| Level dossiers | repo files `docs/study/levels/dossiers/hve.md`, `gap_support.md`, `oops.md` | in repo | House summaries; added in checking (6.6) |
| App code | `api/services/pattern_engine/...` (files named in section 5) | in repo | Read in full for the files named |
| Daily and hourly price bars for my checks | Yahoo Finance via the `yfinance` library | n/a | Free data; split-adjusted; occasional bad prints possible |

## Removed in checking (and the main fixes)

A second reader re-checked this dossier on 2026-11-09. Nothing below was invented to fill a gap; each item is either
gone or replaced with what the source actually says.

**Removed, because no source I could read supports it**
1. "Secondary summaries agree" that *Street Smarts* puts the orders "a tick over / under the bar" on "the next day", and
   that the setup is valid "the next day only". Only one summary (Lance Beggs) was readable and it says neither. The
   tick, the day and the validity window are now marked unverified (3.2, 3.15, 3.16 item 6, 8.2 item 14).
2. The "[source consensus]" tag on "mother bar" (8.1 item 2): none of the sources read uses the word.
3. Morpheus "trail" as an exit (3.15): the post states no exit; they were still holding.
4. "Oops entry 11 Sep" for ZETA (4.5): the owner called that day a "GO SIGNAL", and the bar did not open under the prior
   low.
5. "In articles from the early 2000s" and "I could not reach Chesler's own site" (2): replaced by his firm's own page,
   which gives 2004.

**Fixed**
1. Bulkowski's breakout and pattern stop are the **first (mother) day's** high and low, not the inside day's (his words:
   "the first day's high or low in the pattern"). Added to 3.3, 3.15, 3.16, 4.2, section 10; his NR7 pattern spans all
   seven days. His 42% vs 40% column is labelled "Win/loss ratio".
2. C29 (section 7): CRCL at 9.7% over its 10-day SMA does **not** fail C29; it is on the line (10.2% over a 10-day EMA).
   A question for the owner was added (10, item 8).
3. Stop distances in 4.5 and section 7 were measured from the fill (the open when the next day gapped over the
   trigger), not from the trigger as the text said; the text now says so (from the trigger POET is 5.8%, HOOD 3.9%).
4. Rest of the Week dates now follow each post's own subtitle: 11 Nov 2025 (not 12), 9 Dec 2025 (not 10), 6 Jan 2026
   (not 7), 3 Feb 2026 (not 4).
5. "I read all 103 posts": one is subscribers-only; 102 were readable. "68 mention inside days" is a matter of matching;
   a recount gave 66 to 69. "All posts carry the byline": 102 of 103 do.
6. The 4.5 takeaway: RDDT and SMTC triggered first and then lost the low (they did not "break down first"); NVDA is
   TraderLion's example, not the owner's.
7. The POET "anticipation" example: the same post lists his cost at $6.73, the 7 Oct open above the inside day's high,
   so it may not be an anticipation buy (6.1, 8.2 item 17, 10 item 5).
8. XLF is a bearish market tell he wrote about, not a logged short (4.5, 6.1, 8.6, 8.9).
9. Rulebook paraphrases: F65's Red market is "mostly cash and shorts" (section 7); B26 does not say the 200-day must be
   falling for a short (8.6 item 25, now tagged as my proposal).
10. Crabel limits (4.1): the blog states "No slippage. No commission."; its caption says the inside-day edge showed in
    bonds and the S&P, not in every market tested. The "one-sided when the market is running" reading of the inside day
    is the blog's commentary, now labelled as such (Read first item 2, 3.1, 3.15).
11. KB entries that come from the trader archive (not the #tsdr desk log) are now labelled "trader archive".
12. Quantified Strategies' tests buy at the close, not on a break of the high (4.3); their one positive test is a
    mean-reversion use of the bar.
13. The screener's inside-run labels allow ties, unlike its single "Inside Day" label (5.5, 5.7, 8.1 item 1).
14. 8.1 item 1 said my test "showed no difference worth the confusion" between strict and tie-allowed inside days; the
    saved output shows tie-only days are rare and did not do worse, so the measured numbers are now given and the
    strict choice is labelled a choice for clarity.
15. The two "[source consensus]" tags that remain (8.2 item 12, 8.3 item 18) now name their sources.

**Added**
- Bulkowski's own words on which bar sets his levels; his NR7 seven-day span.
- Chesler's firm page for the hikkake year.
- UCT quotes for the inside day after a Go Signal (ASML, RDDT) and after a Kicker (YSS); the Alex Jones ASML note; the
  source link for the owner's "4 inside days within a decent pullback bar" (META, 4 Oct 2026).
- Section 6.6: the KB's "Inside bar break" cluster and the level dossiers that use the inside day as an entry.
- An independent recount of the hourly table (4.4), which reproduced it to within 0.01R to 0.02R.

**Checked and left as written:** every other outside quote (Raschke, StockCharts, the Crabel reproduction, TraderLion,
Morpheus, Mish, Stockbsessed, Stockbee, Qullamaggie, Brooks, Beggs, Wikipedia, Edgeful, Quantified Strategies) was
found word for word in context; the app summary (sections 5.1 to 5.6, including the line numbers, the 53.5 confidence
floor and the NR4 bonus bug) matches the code; the KB quotes match the repo files; the daily measurement table matches
the writer's saved output; the remaining example rows match Yahoo bars.

## 12. Examples (from our data)

**The scan's rule (section 8 + the house rules, long side only), in one paragraph.** On the sandbox's daily bars
(2,630 names that ever met the liquidity rule, trading days from 2000-01-03 to 2026-11-06): a strict inside day (high
under the prior high and low over the prior low, rule 1); close at least $10 and 20-day average dollar volume at least
$20 million (B23); close above the 200-day SMA with the 50-day above the 200-day (B26, rule 4); close above a rising
21-day EMA (rule 4); close no more than 10% over the 10-day SMA (C29, rule 6); location (rule 5) either a 60-day
closing high inside the last 10 sessions or the inside day's low within 1 ATR(14) of the 21 EMA; trigger one cent
over the inside day's high, stop five cents under its low, that distance at most 1 ATR(14) and at most 3.5% of the
trigger (rule 7, A13). The buy is a market order the first time price trades over the trigger in the next 3 sessions
(rules 12 to 14), at the open if it gaps over by 4% or less and skipped if by more (C28, rule 15); if the inside day's
low trades first the buy is cancelled (rule 16's scenario B is not in this scan). A double inside day that triggers
both bars on one day counts once, from the more recent inside day (rule 12). Outcome: a fixed stop, no trims, no
breakeven move, walked forward 60 trading days from the day after entry; "reached 3R" means price traded 3R above the
entry before the stop was touched. Not tested, because the data cannot: RS rating (C31), the earnings blackout (B22;
checked by hand for the 10 examples only), market colour (B18), and the close-in-the-upper-half cue (recorded, not
required). Scripts: `_study-resume/scratchpad/setups/08-inside-day/scan_id.py` and `pick_id.py` (local scratch, not in
the repo); hits in `final/hits.json`.

**Base rate.** 101,129 qualifying buys across all 2,630 names (the scan completed; 121 seconds). 26.7% reached 3R and
18.2% reached 5R before the fixed stop was hit; 88.2% were eventually stopped inside the 60-day window and the median
best excursion was 0.94R. With a fixed stop and no trims that is a loser on average unless the winners are trailed, which
matches the dossier's finding (8.8, mistake 27) that the bar alone is near random: the rule set above is a filter, not an
edge by itself. Caveats: (1) the walk starts the day after entry, so the 24,410 buys whose entry day also traded under
the stop are counted as if they survived day one; dropping them leaves 76,719 buys at 30.7% to 3R and 20.8% to 5R, the
truth sits between the two figures; (2) no earnings blackout and no RS filter; (3) splits of the sample all land within
about 2 points of each other (close in the upper half 26.8% vs lower half 26.7% to 3R; at-the-21-EMA location 28.1% vs
post-breakout 26.0%; lighter volume than the mother bar 26.6% vs heavier 27.1%; stop 2% or tighter 27.1% vs wider
25.9%; before 2015 28.1% vs since 2015 25.9%), so none of the grading cues in 8.1 changes the odds much on daily bars;
the owner's edge has to come from stock selection, market colour and the trail, not from the bar's shape.

**The 10 examples** (one per ticker, 2003 to 2025, all reached 5R; every one is above a rising 50 and 200-day, within
10 sessions of a 60-day closing high, closed in the upper half of its range, had no earnings report inside the 3 days
before the inside day or before the entry (not checkable for JBLU: our dates for it start 2003-10-23), and triggered the very next session; stop = inside low minus $0.05; R =
entry minus stop). Charts: `_study-resume/scratchpad/setups/08-inside-day/final/01_...png` to `10_...png` and the
three phone sheets `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` (M = mother bar, ID = inside day, B = buy day).

| # | Ticker | Inside day | Bought | ID range / mother | Close in range | ID vol / mother | Over 10-day | Buy | Stop (R) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | JBLU | 2003-08-07 | 2003-08-08 | 42% | 100% | 1.01x | +1.0% | 20.71 | 20.47 (1.15%, 0.43 ATR) | 44.7 | A tight inside day closing on its high in a smooth 10/21 EMA uptrend; 3R the next day. |
| 2 | ATI | 2006-01-19 | 2006-01-20 | 41% | 62% | 0.68x | +0.9% | 41.09 | 40.45 (1.56%, 0.49 ATR) | 49.8 | Lighter-volume inside day right after a new high; the break ran about 25% within two weeks. |
| 3 | MPC | 2013-01-14 | 2013-01-15 | 58% | 97% | 0.66x | +0.4% | 31.33 | 30.90 (1.37%, 0.58 ATR) | 35.0 | Inside day closing near its high at the 10-day after a two-week shelf; 3R the next day. |
| 4 | ALGN | 2017-03-14 | 2017-03-15 | 44% | 70% | 0.74x | +2.6% | 107.85 | 106.57 (1.19%, 0.72 ATR) | 36.0 | Quiet inside day in a steady climb above the 21 EMA; the break opened the next leg. |
| 5 | CDNS | 2019-02-05 | 2019-02-06 | 23% | 75% | 0.65x | +5.5% | 50.22 | 49.64 (1.15%, 0.61 ATR) | 35.0 | Very narrow inside day (23% of the mother bar) a week after a breakout over the 200-day. |
| 6 | CVNA | 2020-06-30 | 2020-07-01 | 42% | 58% | 0.91x | -0.7% | 24.28 | 23.68 (2.47%, 0.42 ATR) | 37.9 | Inside day resting on the 10-day EMA after a pullback in a fast 2020 uptrend. |
| 7 | FTNT | 2021-06-11 | 2021-06-14 | 42% | 79% | 0.85x | +3.1% | 45.89 | 45.39 (1.08%, 0.54 ATR) | 37.0 | Inside day at a new high, close in the top fifth, stop barely 1%; 3R in three sessions. |
| 8 | VST | 2023-12-21 | 2023-12-22 | 66% | 52% | 0.67x | +0.7% | 38.00 | 37.53 (1.25%, 0.60 ATR) | 66.5 | A plain inside day at the 10-day in a slow, orderly trend; slow to 3R (10 days) then a 60R run. |
| 9 | NVDA | 2024-01-12 | 2024-01-16 | 36% | 59% | 0.59x | +6.9% | 55.02 | 54.28 (1.34%, 0.51 ATR) | 57.3 | TraderLion's own example (dossier 8.9): small gap over the trigger (0.1%), light volume, 3R in two days. |
| 10 | GOOGL | 2025-08-26 | 2025-08-27 | 41% | 67% | 0.95x | +1.8% | 207.86 | 205.65 (1.06%, 0.50 ATR) | 44.6 | Inside day at a fresh 60-day high after a four-day pause; broke out the next day and ran about 20% in three weeks. |

Prices are the sandbox's split-adjusted bars (NVDA after its 2024 10-for-1 split). "Best R" is the highest excursion
inside 60 trading days with the fixed stop, not a trade result: the house plan trims a third at 3R and 5R and trails the
rest (B19, E51, E52), so the realised R would be far lower.

**Notable failures (from the same scan, checked on the bars).**
- **NVDA, inside day 2024-03-28, bought 2024-04-01 at 91.31, stop 89.14.** It qualified on every rule, but the signal day
  sat under its 10-day: the stock closed above the 10-day SMA from 2024-03-19 to 2024-03-26, then under it on 03-27 and
  03-28 (close 90.36 vs 10-day 91.00), and every close from 03-27 to 04-10 (ten sessions) stayed under it. The stop
  went on 2024-04-02 (low 87.62). It was still over its 21-day EMA (90.36 vs 87.72), so the card's 21-EMA rule
  (id.inv_close_under_21) did not stop it. (corrected 2026-11-10 against the bars): the earlier text said it had been under the 10-day for a week
  and that the break lasted one day. Lesson: an inside day inside a stall under the 10-day is a pause
  in a range, not a continuation; prefer the ones that sit at or over a rising 10-day.
- **TSLA, inside day 2021-01-13, bought 2021-01-14 at 286.83, stop 277.28.** Passed C29 by a hair (9.1% over the
  10-day) but was 17% over the 21 EMA after a vertical January; stopped the next session (low 273.03 on 2021-01-15).
  Lesson: near the 10% line, treat it as stretched (8.8, mistake 28).
- **NVDA, inside day 2025-01-23, bought 2025-01-24 at 148.37 (gap over the 147.24 trigger), stop 143.67.** The inside day
  closed at the top of its range, 6.4% over the 10-day; the entry day reversed to 141.88 and stopped the trade the same
  day, and on 2025-01-27 the stock gapped down to 124.80 (a news gap, not earnings: the next report reacted on
  2025-02-27). Lesson: a perfect-looking bar is still a coin flip; the stop is the plan, and B20 (first 30-minute low)
  is what saves the account when the gap comes through it.

**Data limits for this section.** Daily bars only (the intraday store starts 2026-08-17 and hourly 2023-12-12, so the
30-minute stop rule B20 was not simulated); no RS rating or market-colour history; earnings dates thin before 2005
(nine of the 10 examples were checked against the dates we have; JBLU 2003 predates its first stored date). The short mirror (8.6)
was not scanned: the dossier already says it was not measured, and a short-side scan deserves its own pass with
borrow data.

## 13. Failures and near-misses (from our data)

The same scan and the same trade as section 12 (a cent over the inside day's high within 3 sessions, stop 5 cents under
its low, 60 sessions forward, fixed stop). Four valid inside days that stopped before 3R, one per ticker, four
different years, and four bars that look like the setup but fail exactly one gate criterion of the card
(`criteria/08-inside-day.json`). Charts: `scratchpad/setups/08-inside-day/final/fail_1-4.png`, `near_1-4.png`, and
the confusable pair against the Wick Play in `pair_37-wick-play.png`. Code: `near_scan.py` (the scan with each gate
relaxed to a band just outside the rule, keeping the bars that fail one gate only) and `fail_near.py`.

**Failures: valid by every gate, stopped by the rules.**

| ticker | inside day, bought | buy | stop (%) | where it stopped | what happened | criterion |
|---|---|---|---|---|---|---|
| NVDA | 2024-03-28, bought 2024-04-01 | 91.31 | 89.14 (2.37%) | day 1, 2024-04-02: opened at 88.45, under the stop; low 87.62 | the entry day closed at 90.36, back under the 91.30 inside-day high; the inside day sat 0.7% under a flat 10-day after the March run. The open under the stop is the B20 case (first 30-minute low). Low within 10 sessions 83.02. | id.stop_gap (section 12 files it under id.inv_close_under_21: the stall under the fast average) |
| TSLA | 2021-01-13, bought 2021-01-14 | 286.83 | 277.28 (3.33%) | day 1, 2021-01-15, low 273.03 | the inside day closed 9.1% over the 10-day (inside C29 by a hair) and 17% over the 21 EMA after the January run; the entry day closed at 281.67, under the trigger. | id.not_stretched |
| NFLX | 2018-03-15, bought 2018-03-16 | 32.35 | 31.76 (1.81%) | day 1, 2018-03-19: opened at 31.58, under the stop; low 30.73 | the entry day closed at its low, 31.84, back under the inside day's high (the warning in id.after_entry_stop); the next open was through the stop and the stock fell to 27.50 within 10 sessions. | id.after_entry_stop |
| AMZN | 2017-05-26, bought 2017-05-30 | 49.94 | 49.41 (1.06%) | day 1, 2017-05-31, low 49.11 | six up closes in a row before the inside day; the 1.06% stop sat inside the day's noise and traded the next session. Low within 10 sessions 46.35. | id.run_length |

**Near-misses: one gate fails, everything else passes.**

| ticker | bar, bought | the one criterion that fails | the number | what it really is |
|---|---|---|---|---|
| MSFT | 2024-02-08, bought 2024-02-09 | id.shape | the high is 0.30% above the prior day's high; the low is 1.26% inside | a narrow-range day after a breakout, not an inside day (id.nr_day_not_inside). Bought over its high it went 1.7R, which says nothing about the rule |
| AMZN | 2025-10-15, bought 2025-10-16 | id.trend_21 | the close is 2.9% under the 21-day EMA and the EMA fell 0.9% over 5 sessions | an inside day inside a pullback under the fast averages, 0.6% over the 200-day; closer to a reclaim setup (13) than a continuation. Stopped |
| QCOM | 2020-08-04, bought 2020-08-05 | id.not_stretched | the close is 13.0% over the 10-day SMA (but about 9.7% over the 10-day EMA, which would pass: the answer flips on D-017); the rule is 10% or less (corrected 2026-11-10 against the bars) | an inside day three sessions after the 2020-07-30 earnings gap (92.08 to 102.42 at the open); the pause came too high. Stopped |
| AAPL | 2017-08-01, bought 2017-08-02 | id.gap_over | the next open was 6.0% over the inside day's high; the rule is 4% or less | an earnings gap (report 2017-08-01 after the close): a gap trade (setup 21), not an inside-day buy. The stop under the inside day's low would be 6.95% away |

**What the failures have in common.** Every one was stopped on the first session after the entry, and in all four the
entry day itself closed back under the inside day's high (NVDA 90.36, TSLA 281.67, NFLX 31.84, AMZN 49.84): the break
did not hold into the close. Two of the four opened under the stop the next morning (NVDA, NFLX), so the real loss depends
on B20, not on the stop order. None of the four was at the ideal location: TSLA and AMZN came at the end of a run
(id.not_stretched, id.run_length), NVDA and NFLX were pauses in a stall under or at the 10-day rather than fresh
continuation. The inside day's shape and volume were ordinary in all four (ranges 51% to 85% of the mother bar, closes
in the upper half), which is what section 12 found: the bar alone does not carry the edge, the location does.
