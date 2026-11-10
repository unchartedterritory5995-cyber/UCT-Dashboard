# Setup 06: VCP, the Volatility Contraction Pattern (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote is
40 words or fewer and was checked word for word against a saved copy of the page named next to it, except where a
quote is marked **[repo, not re-verified]**: those come from the repo's own research file
`docs/superpowers/research/bases/03-minervini-vcp-powerplay.md` (see the warning about that file in section 11).
Where I could not read a source, I say so and give no wording from it.

**Cold check, 2026-11-09 (a second reader).** Every quote below was re-opened in a fresh copy of its source (the
Minervini archive pages, the ChartMill PDF, Deepvue, the TraderLion archive copies, qullamaggie.com, both IBD pages,
ChartSchool, NBER, Crossref and all 103 Substack posts through the Substack post API) and found word for word. The
**[repo, not re-verified]** quotes were found word for word in the repo file, but the book itself still could not be
opened (the Internet Archive's copies of both books are loan-only and their search-inside refused an anonymous client;
Google Books was out of quota). The scanner summaries were re-read against the code. What changed is listed in
"Removed in checking" at the end.

Tags used in section 8: **[originator]** Mark Minervini's own words; **[source consensus]** several outside sources
agree; **[UCT]** UCT's writers or the owner's verdict log; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

---

## 1. What it is

A VCP is a base inside an uptrend where each pullback is smaller than the one before (for example 25%, then 15%, then
8%), while volume dries up, until the stock sits in one small, quiet range near the top of the base. You buy when price
breaks above the top of that last small range (the pivot), with a stop close below it, so the risk is small.

**Why it works (the psychology).** These points are the originator's reasoning and the educators' reasoning. They are
not measured facts.

- The first, deepest pullback is profit-taking and panic. Minervini (his own blog, 2015, an excerpt of his 2013 book):
  *"The volatility, measured from high to low, will be greatest when sellers rush to take profits. When sellers become
  scarcer, the price correction will not be as dramatic, and volatility will decrease."*
- Each later dip meets fewer sellers, so it is shallower, and volume falls. Minervini: *"A common characteristic of
  virtually all constructive price structures (those under accumulation) is a contraction of volatility accompanied by
  specific areas in the base structure where volume contracts significantly."*
- Who is buying: buyers with a longer horizon absorb the supply. ChartMill's guide (2026) puts it this way: *"Once that
  supply has been absorbed by buyers with a longer horizon (often institutions building a position), the price
  recovers."* Nobody can see institutions on a daily chart. This is an inference from price and volume.
- Who is trapped or shaken out: ChartMill's guide says *"Each contraction shakes out the last weak hands"*. The rest of
  this point is my own inference, not a source: holders who sold into the deep first pullback, and anyone who sold the
  last quiet range for being "dead money", have to chase if they want back in when the stock clears the pivot.
- Why the entry is good: the last range is small, so a stop under it is close. Minervini: *"The main role that VCP plays
  is establishing a precise entry point at the line of least resistance."*
- The honest limit: quiet ranges are followed by bigger moves, but quietness alone does not say which way. StockCharts
  ChartSchool on narrow-range days: *"In this regard, the indicator is neutral when it comes to future price
  direction."* TraderLion on tight areas: *"These Tight Areas often precede a large-size move up or down."* The upside
  bias in a VCP comes from where it sits (a stock already in a strong uptrend, near its highs, with strong relative
  strength), not from the tightness alone. That is why the trend filter matters so much (section 8.1).

---

## 2. Origin and naming

- **Who named it.** Mark Minervini, a U.S. stock trader. He won the 1997 U.S. Investing Championship. His own blog
  (2019): *"My final tally was a total return of 155 percent, almost double that of the nearest competitor."* For 2021,
  the contest's own standings page (financial-competitions.com, read in the Internet Archive's copy of 2022-01-26) lists
  "2021 STANDINGS (338 Entrants) Performance through December 31, 2021" and, under "MONEY MANAGER VERIFIED RATINGS ($1
  MILLION+ Accounts) STOCK DIVISION", "Mark Minervini + 334.8%". TraderLion (Craig Celeste, 2024-08-31) rounds it to
  334%. These are account results, not VCP results.
- **Where, and when.** The earliest dated use I could verify is his book *Trade Like a Stock Market Wizard: How to
  Achieve Super Performance in Stocks in Any Market* (McGraw-Hill, first published 2013 per Open Library; ISBN
  9780071807227; the Library of Congress number in that record, 2013005165, also points to 2013). His own blog reprinted
  the VCP section on 2015-02-23 under the line "Excerpt from Trade Like A Stock Market Wizard by Mark Minervini". (One
  other blog excerpt, 2014-06-17, credits the book as "McGraw Hill Publishing -2012"; I go with the 2013 catalogue date.) He expanded it in *Think & Trade Like a Champion* (Access Publishing Group, 2017; ISBN
  9780996307932). From that book, per the repo file: *"I came up with the VCP concept because I saw so many people
  relying on patterns that seemed to trace the general appearance of a constructive price base"* **[repo, not
  re-verified]**.
- **Chapter.** Several third-party pages say the 2013 book covers the VCP in Chapter 10. I could not open a table of
  contents to confirm it, so I give no chapter. I also could not confirm whether he used the name earlier in his private
  newsletters.
- **Trademark.** His 2015 blog page lists "Specific Entry Point Analysis®, SEPA®, Leadership Profile® and Minervini
  Select®" as registered trademarks. VCP is not on that list. I did not search the trademark office's records.
- **Other names and notation.**
  - "VCP", "volatility contraction", "VCP base". Each contraction is a "T": *"I call these contractions Ts."*
    (Minervini, 2015 blog).
  - The "technical footprint": weeks, first (largest) and last contraction, and number of Ts, for example *"6W 32/6 3T"*
    (Mercadolibre, from the 2017 book; the repo file's copy explains it as corrections that "began at 32 percent and
    concluded at 6 percent at the pivot") **[repo, not re-verified]**. ChartMill's guide uses "14W 24/5 3T" as its
    example and reads it as "the deepest pullback was 24%, the last one 5%".
  - Close relatives, not the same thing: O'Neil's "tight areas" and tight weekly closes (TraderLion's tight-areas page);
    the Darvas box and the flat base, which Minervini says are variations *without* real contraction (2015 blog);
    Toby Crabel's narrow-range days NR4 and NR7 (a single quiet day, StockCharts ChartSchool); Kristjan Kullamägi's
    "Breakouts" setup (higher lows and a tightening range, his own post, 2021; he does not call it a VCP); Deepvue's
    "Tight Range" screen built on its RMV indicator.
  - UCT's own words for it: "VCP ish action", "VCP like base", "five star"/"5-star base", "1 tap 2 tap 3 tap tight
    tight tight", "one more contraction" (section 6).

---

## 3. Every definition I could find, source by source

### 3.1 Mark Minervini, his own blog: the VCP section of *Trade Like a Stock Market Wizard* (originator, primary)

Post "How to Time Your Trade with Pinpoint Accuracy - The Volatility Contraction (VCP) Pattern", 2015-02-23, minervini.com
blog, read through the Internet Archive because the blog no longer exists on the live site
(https://web.archive.org/web/20150225145654/http://www.minervini.com:80/blog/index.php/blog/show/how_to_time_your_trade_with_pinpoint_accuracy_the_volatility_contraction_vc).
The page carries a copyright notice that forbids redistribution; I quote short passages only.

- **What it is:** *"If there is any one commonality or Holy Grail that I follow and practice regularly, it is the
  concept of volatility contraction."* And: *"I want to see the stock move from greater volatility on the left side of
  the price base to lesser volatility on the right side."*
- **Number of contractions:** *"During a VCP, you will generally see a succession of anywhere from two to six
  contractions"*; *"Typically, most VCP setups will be formed by two to four contractions, although sometimes there can
  be as many as five or six."*
- **Depth sequence (his example, not a threshold):** *"with the stock coming off initially by, say, 25 percent from its
  absolute high to its low. Then the stock rallies a bit, and then it sells off 15 percent."* Then *"finally it retreats
  8 percent."* A second example on the same page: *"from a 25 percent correction, to a 10 percent, to a 5 percent, and so
  forth, which would be indicative of a classic VCP progression."* (Ratios: 0.60 and 0.53; 0.40 and 0.50.)
- **The halving rule:** *"As a rule of thumb, I like to see each successive contraction contained to about half (plus
  or minus a reasonable amount) of the previous pullback or contraction."* No number is given for "a reasonable amount".
- **Volume:** falls "at particular points": *"The progressive reduction in price volatility, which will be accompanied by
  a reduction in volume at particular points, eventually signifies that the base has been completed."* No ratio given.
- **What is not a VCP:** *"a flat base structure that is four to seven weeks in duration. With this type of base, there
  is no real volatility contraction as it remains a tight and narrow pattern or box"*, *"moving in a sideways range with
  about a 10 to 15 percent correction from high point to low point."*
- **Entry:** *"The main role that VCP plays is establishing a precise entry point at the line of least resistance."*
- **Length:** no rule in this excerpt. His live example: *"The VCP pattern started on 11/06/14 and the breakout occured
  on 2/17/15"*, for the ticker CBPO. That is about 15 weeks.
- **Not in this excerpt:** prior trend, stop, volume at the breakout, targets.

### 3.2 Mark Minervini, his other own posts and interviews (originator, primary)

All on his blog, read through the Internet Archive.

- **The trend filter (Trend Template), from *Trade Like a Stock Market Wizard*, reprinted 2019-04-23:** eight conditions.
  *"The current stock price is above both the 150-day (30-week) and the 200-day (40-week) moving average price lines."*
  The 150-day above the 200-day. *"The 200-day moving average line is trending up for at least 1 month (preferably 4–5
  months minimum in most cases)."* The 50-day above the 150-day and 200-day. Price above the 50-day. *"The current stock
  price is at least 30 percent above its 52-week low."* *"The current stock price is within at least 25 percent of its
  52-week high (the closer to a new high the better)."* *"The relative strength ranking (as reported in Investor's
  Business Daily) is no less than 70."*
- **The base must sit in an uptrend:** *"To time my entry, I look for price consolidations, which are momentary pauses
  or periods of rest within the context of a prior uptrend."* And on late bases: *"If you're too late, you run the risk
  of buying a late-stage base that is obvious to everyone and prone to failure."* (same 2019 post).
- **Long and short:** *"I never go against the long-term trend. I look to go long a stage 2 uptrend and go short a stage
  4 downtrend, plain and simple."* (same post). He does not describe a VCP for shorts there.
- **The VCP is how he enters (interview by Dr. Iqbal K M, posted 2016-04-21):** *"I use the volatility contraction
  pattern (VCP) as an entry mechanism."* His example: *"I first bought Netflix (NFLX) in 2009 when it emerged from a
  well-defined Volatility Contraction Pattern (VCP). The stock advanced more than 500% from that point."*
- **What should happen after the buy (same interview):** *"After a stock emerges from a proper VCP pattern, it should
  not pullback too much and it should rally back to new highs within a number of days up to a few weeks."* He calls
  this "tennis ball action".
- **Volume at the breakout (Q&A, 2013-06-06):** *"Volume on a breakout is a good indication however; I won't always
  abandon the trade if volume doesn't come in on the first day. Often volume comes in a day or two later."* And:
  *"Lack of volume however, does raise a red flag; volume would need to come in soon after. As always, maintain your stop
  regardless."*
- **Stops (several posts):** against widening stops for volatile stocks: *"you should widen your stops on the basis of
  the volatility of the underlying stock. I strongly disagree."* In hard markets: *"Tighten up stop losses. If you
  normally cut losses at 7 to 8 percent, cut them at 5 to 6 percent."* (2015-04-14). A rule of thumb: *"A rule of
  thumb could be to cut your losses at a level of one-half of your average gain."* (2020-06-14). On a gap through the
  stop: *"My advice: get out immediately! Take whatever the next bid price is."* (2014-01-14).
- **Risk per trade (excerpt from the 2017 book, posted 2017-05-31):** *"your maximum risk should be no more than 1.25
  to 2.5 percent of your equity on any one trade."*
- **Building a position (Q&A, 2013):** *"I incrementally commit to positions until I have an indication that conditions
  are right; then I step on the gas."* (This conflicts with the house rule of one full buy, section 7.)
- **New highs (excerpt, posted 2014-06-17):** *"A stock hitting a new high has no overhead supply to contend with."*
- **I found no Minervini post** with a published win rate, a breakout-volume percentage, a chase limit in percent, or a
  measured target for the VCP.

### 3.3 Mark Minervini, *Think & Trade Like a Champion* (2017), as quoted in the repo (originator; not re-verified by me)

The repo's file 03 quotes this book at length. I could not read a licensed copy. For the points that also appear in
the 2013 excerpt (two to six contractions, about half, the Ts) the repo's 2017 wording gives the same numbers in
slightly different words (for example "a sequence of anywhere from two to six price contractions" against the 2013
"a succession of anywhere from two to six contractions", and "I refer to each of these contractions as a 'T.'" against
"I call these contractions Ts."). That is what a rewritten second book would look like, so it neither proves nor
disproves the transcription. Treat every line here as **[repo, not re-verified]**.

- **Prior advance:** *"the VCP is going to happen at higher levels, after the stock has already moved up 30, 40, 50
  percent or even much more, because the VCP is a continuation pattern as part of a much larger upward move."*
- **Depth of the base:** *"Most constructive setups correct between 10 percent and 35 percent, some as much as 40
  percent. Very deep correction patterns, however, are failure prone."* And: *"A stock that has corrected 60 percent or
  more is off my radar, especially because a decline of that magnitude often signals a serious problem."* Against the
  market: *"Under most conditions, stocks that correct more than two and a half or three times the decline of the
  general market should be avoided."*
- **Tightness:** *"Tightness in price from absolute highs to lows and tight closes with little change in price from one
  day to the next and from one week to the next are generally constructive."*
- **Volume on the final contraction:** *"In fact, we want to see volume on the final contraction that is below the
  50-day average, with one or two days when volume is extremely low"*.
- **Right side must quiet down:** *"If the stock's price and volume don't quiet down on the right side of the
  consolidation, supply most likely is still coming to market, making the trade too risky and prone to failure."*
- **Pivot and trigger:** *"A pivot point can occur in connection with a stock breaking into new high territory or below
  the stock's high."* *"Specifically, the point at which you want to buy is when the stock moves above the pivot point
  on expanding volume."*
- **Chase limit:** *"You want to buy as close to the pivot point as possible without chasing the stock up more than a
  few percentage points."* No number.
- **After the breakout:** *"The best trades emerge and rally for several days on increased volume."* Pullbacks are
  normal: *"Often, a stock will emerge through a buy point and then pull back to or slightly below the initial breakout
  level; this will happen 40 to 50 percent of the time."* A failed-looking breakout can recover: *"In some cases, it can
  take up to 10 days for a recovery to occur."*
- **Warning signs after the buy:** *"after a stock breaks out of a proper VCP, if it closes below its 20-day moving
  average shortly thereafter, the probability of it being successful before stopping you out is cut in about half."*
  And: *"Three lower lows on increased volume is a red flag"*.
- **Trend Template in this book:** price *"at least 25 percent above its 52-week low"* (the 2013 text says 30 percent),
  and RS *"no less than 70, but preferably in the 90s"*.
- **The 10% exception (stated for the Power Play, his high tight flag, not for every base):** *"If the correction in the
  base, from high to low, does not exceed 10 percent, it is not necessary to see price tightening in the form of a
  volatility contraction, because the price is already tight enough."*
- **Success odds, in his words:** *"Rarely does a correct pivot point fail coming out of a sound consolidation in a
  healthy market."* and *"On average, over time you will likely be correct on only 50 percent of your purchases."*
- **Per the repo file, the book publishes no minimum length for a VCP**, no breakout-volume percentage, no chase-limit
  percentage, and no numeric tolerance for "about half". The repo file derives a ratio band of about 0.38 to 0.75 from
  his five worked examples (for example MIK 16/8/6/3, VIVO 31/17/8/3, BITA 28/16/6). That band is derived, not stated.

### 3.4 ChartMill: "The Volatility Contraction Pattern, The Complete Guide" (established data provider and educator)

Kristoff De Turck, co-founder of ChartMill, dated October 2026, PDF at
https://www.chartmill.com/images/uploads/The-Complete-ChartMill-VCP-Guide.pdf. It says it summarizes and interprets
Minervini and is "not a replacement for his books". ChartMill sells the screen it describes.

- **Trend:** Minervini's Trend Template; ChartMill's own relative-strength score at least 70, "preferably 80 or
  higher".
- **Prior advance:** *"A prior advance of at least 30% before the base is a reasonable minimum."* (it credits this to
  O'Neil's base rules).
- **Base count:** *"A first or second base after the start of a new uptrend has better odds than a third or fourth."*
- **Contractions:** *"Two contractions is the minimum to speak of a VCP; three to four is the most common picture."*
  Six or more is called less reliable. First pullback: *"The first pullback (T1) is the deepest. In a healthy market it
  typically ranges from 10% to 35%."* Over 50% is "a red flag".
- **Final contraction:** *"The final contraction is the most important one. It has to be tight: ideally under 10%, and
  the closer to 3% to 6%, the better."*
- **Length:** no rule; it says Minervini's examples range "from a few weeks to more than a year", and that bases of 20
  weeks or more read better on the weekly chart.
- **Volume in the base:** falls overall, lowest in the last contraction; *"If you see several down days on heavy volume
  in the right half of the base, there is still distribution going on in the stock and you are too early."*
- **Breakout volume:** *"O'Neil's rule of thumb is at least 40% to 50% above the 50-day average daily volume."*
- **Pivot:** *"The pivot is the top of the final contraction. Not the highest price of the entire base, but the level
  the final tight consolidation keeps running into."*
- **Entry:** a buy stop limit order just above the pivot; buy close to it.
- **Stop:** *"The stop goes just below the final contraction. Not a fixed percentage, but the level at which the
  structure of the pattern breaks."* Typical risk "roughly 4% to 7% from the pivot". *"If the low of the final
  contraction is more than 7% to 8% below the pivot, the contraction is not tight enough and you skip the trade."* And
  against stops that are too tight: *"What you must not do is go below 1 times the ATR."*
- **Risk per trade:** "usually 0.5% to 1%".
- **Failure signs:** contractions that do not shrink ("wide and loose"), distribution in the right half, a late base, a
  breakout without volume, and the market: *"In a negative market environment, even perfect VCPs fail en masse, simply
  because there aren't enough buyers to carry breakouts through."*
- **Targets:** none; it shows an open 8.3R gain on Haemonetics and says management then takes over (raise the stop,
  take partial profits).
- **Flat base versus VCP (its comparison table, added in checking):** a flat base is a "Sideways base 10% to 15% deep,
  usually after an earlier breakout" that *"Can be the final phase of a VCP, but doesn't necessarily have successive
  contractions"*. A cup with handle whose handle meets the shrinking rule *"is also a VCP"*.
- **Cheat entry (added in checking):** *"Minervini describes so-called cheat entries, where you already buy in a tight
  consolidation with the pivot roughly in the middle of the base."* It tells beginners to start with the classic pivot
  entry.

### 3.5 Deepvue: "Mastering the Volatility Contraction Pattern" (established data provider)

https://deepvue.com/screener/volatility-contraction-pattern/, last updated 2024-04-21, no author named. TraderLion's
author note says Nick Schmidt co-founded both TraderLion and Deepvue, and UCT's paid Discord includes a free month of
Deepvue (Sunday Scans, 2026-07-12), so this is a partner's page.

- **Definition:** *"VCPs are characterized by a series of price contractions, where each successive price range becomes
  narrower."* Its example: a 15% pullback, then 5%, then a $92 to $94 range.
- **Volume:** *"Look for a steady decline in volume as the pattern forms, followed by a sharp volume spike when the
  breakout occurs."* No number.
- **Other signs:** higher lows in each contraction; *"Quick recoveries after small pullbacks, a characteristic Mark
  Minervini calls “tennis ball action.”"*; closes near the top of the day's range.
- **Pivot and trigger:** a break above the pivot "on high volume".
- **Its tight-range screen:** *"RMV 15-Day < 10"* and a 5-day change between -4% and +4%.
- **Not given:** stop, target, prior-advance size, length, depth limits.

### 3.6 TraderLion: "Mastering the Volatility Contraction Pattern" (established educator; read from the archive)

Nick Schmidt (co-founder of TraderLion and Deepvue), 2024-10-25. The live site refused my client (HTTP 403), so I read
the Internet Archive copy of 2025-04-25
(https://web.archive.org/web/20250425064732/https://traderlion.com/technical-analysis/volatility-contraction-pattern/).

- **Contractions:** *"A VCP pattern usually forms with 2 to 6 contractions, each smaller than the last"*; example 25%,
  15%, 8%. Elsewhere on the same page: *"A solid VCP pattern usually takes 6 to 12 weeks to form, with 3 to 4 clear
  contractions in price."* (So the page gives two counts: "usually" 2 to 6, and 3 to 4 for a "solid" one.)
- **Trend:** Stage 2 (Weinstein's stages).
- **Stop:** *"By entering near the pivot point and placing a stop-loss just below the last contraction, traders can limit
  their risk to about 5-8%"*, the same sentence going on "while aiming for gains of 15% or more" (no exit rule is
  given).
- **Statistics without a source:** *"Studies show that 60-70% of VCP breakouts lead to solid price rallies when they
  breakout with strong volume."* and "More than 50% of superperforming stocks" show VCPs. No study is named. See
  section 4: these are not usable.
- **Breakout volume:** "a 30-40% volume spike on the breakout day".

TraderLion also has an undated page "Master Finding VCPs: Identify Tight Areas" (archive copy of 2024-06-21,
https://web.archive.org/web/20240621162830/https://traderlion.com/trading-strategies/vcps-identify-tight-areas/):
*"In his analyses of the greatest stocks, William O'Neil constantly highlighted tight weekly action as a winning Technical
Price and Volume Characteristic."* It asks you to mark places where price "goes sideways for at least 2-3 days and
ranges constrict".

### 3.7 Kristjan Kullamägi (Qullamaggie): "Breakouts" (originator of a related setup, primary)

"3 TIMELESS setups that have made me TENS OF MILLIONS!", 2021-01-08 (updated 2021-04-28),
https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/. This is his breakout setup, not a VCP.
The post and its reader comments never use the word "VCP". It is here because it is the closest well-documented modern
cousin and because our scanner's text claims he trades VCPs (section 5.5).

- **Prior move:** *"A big move higher sometime in the past 1-3 months. This move can be anywhere from 30-100%+ and usually
  lasts a few days to a few weeks."*
- **Shape:** *"An orderly pullback and consolidation with higher lows and tightening range in the consolidation phase."*
- **Length and averages:** *"The consolidation phase is usually 2 weeks to 2 months. During the consolidation the stock
  price “surfs” the rising 10- and 20-day."*
- **Entry:** the opening-range high (first 1, 5 or 60-minute candle) on the breakout day.
- **Stop:** *"Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock"*.
- **Trims and trail:** *"You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop to break even.
  The rest of the position should be trailed with the 10- or the 20-day moving average."*

### 3.8 Investor's Business Daily / William O'Neil: breakout rules that VCP educators borrow (related, primary but cut)

investors.com serves only the first paragraph to a non-subscriber. I quote only what it served.

- **40% minimum breakout volume:** Paul Whitfield, IBD, updated 2016-02-19
  (https://www.investors.com/stock-lists/ibd-big-cap-20/breakouts-among-big-cap-stocks-fizzled/): *"However, volume was
  31% above average, below the 40% minimum…"* The 50-day window and the "40% to 50%" range appear in ChartMill's guide and
  in syndicated copies I could not open, not in IBD text I read.
- **Buy point:** Kimberley Koenig and David Saito-Chung, IBD, updated 2026-05-13
  (https://www.investors.com/how-to-invest/investors-corner/everything-you-need-to-know-about-handles-how-to-spot-a-good-one/):
  *"A handle defines the proper entry. The highest price in the handle plus 10 cents…"* (said of the cup with handle).
- **Not read:** the 5% buy zone and the 7% to 8% sell rule. They are widely reported as IBD rules, but every copy I
  could open was a secondary reprint. I give no wording.
- IBD does not, in any page I could reach, define "VCP".

### 3.9 StockCharts ChartSchool: "Narrow Range Day NR7" (established educator; the principle, not the pattern)

https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7.
*"The philosophy behind the pattern is similar to the Bollinger Band Squeeze, that is, a volatility expansion often
follows a volatility contraction."* And: *"In this regard, the indicator is neutral when it comes to future price
direction."* It credits the narrow-range idea to Toby Crabel's 1990 book.

### 3.10 Comparison table

"n/s" means the source does not say. Numbers in quotes are the source's; the rest is my plain summary.

| Criterion | Minervini 2013 (own blog) | Minervini 2017 (repo, not re-verified) | ChartMill 2026 | Deepvue 2024 | TraderLion 2024 | Qullamaggie Breakouts 2021 (related) | IBD/O'Neil (related) |
|---|---|---|---|---|---|---|---|
| Prior trend | Stage 2; all 8 Trend Template lines | Stage 2; Trend Template | Trend Template | "longer-term uptrend" | Stage 2 | strongest 1-2% of stocks over 1, 3, 6 months | n/s in text read |
| Prior advance | 30% above 52-week low (Template) | "30, 40, 50 percent or even much more"; Template 25% above low | 30% minimum | n/s | n/s | 30% to 100%+ in 1-3 months | n/s in text read |
| Number of contractions | 2 to 6, typically 2 to 4 | 2 to 6, typically 2 to 4 | 2 minimum, 3-4 common, 6+ less reliable | "series" | 2 to 6 (and "3 to 4") | n/s ("tightening range") | n/s |
| Each vs previous | "about half (plus or minus a reasonable amount)" | same | "roughly half the previous one, give or take" | narrower | smaller | tightening | n/s |
| First (deepest) pullback | example 25% | 10% to 35%, up to 40%; never 60%+ | 10% to 35%; over 50% a red flag | example 15% | example 25% | n/s | n/s |
| Final contraction | example 8% | examples 3% to 8% | under 10%, ideally 3% to 6% | example 5% | example 8% | n/s | n/s |
| Length | n/s (example about 15 weeks) | no minimum; examples 6 to 40 weeks | weeks to over a year | n/s | 6 to 12 weeks | 2 weeks to 2 months | n/s |
| Volume in base | falls "at particular points" | final T below 50-day average, 1-2 very low days | lowest in final T; no heavy down days on the right | steady decline | drops each T | n/s | n/s |
| Breakout volume | n/s here; 2013 Q&A: welcome, may come a day or two late | "expanding volume" | 40% to 50% above 50-day | "sharp volume spike" | 30% to 40% "spike" | n/s | 40% minimum |
| Moving averages | above 50, 150, 200; stacked; 200 rising | same | same | n/s | n/s | surfs the rising 10 and 20-day | n/s |
| Trigger | the pivot (line of least resistance) | moves above the pivot | top of the final contraction | above the pivot | above the pivot | breakout of the range | handle high plus 10 cents |
| Order / entry | n/s | as close to the pivot as possible | buy stop limit above the pivot | n/s | on the surge | opening-range high | n/s |
| Chase limit | n/s | "a few percentage points" | "close above the pivot" | n/s | n/s | n/s | not read |
| Stop | his own stop; tighten to 5-6% in hard markets | n/s in quotes | just below the final contraction; skip if more than 7-8% | n/s | just below the last contraction, 5-8% | low of the day, no wider than ATR/ADR | not read |
| Targets / exits | n/s in the VCP excerpt; hard markets: take profits at 10 to 12% instead of 15 to 20% (2015 post); "sells into strength" is TraderLion's account of him, not his text | warning signs after the breakout | none; manage with stop and partials | n/s | "aiming for gains of 15% or more" | 1/3 to 1/2 after 3-5 days, then 10 or 20-day trail | n/s |

### 3.11 Where the sources disagree

1. **Minimum number of contractions.** Minervini: two. ChartMill: two is the minimum. TraderLion: two in one place,
   three in another. Two of our own engines need two; Chart IQ's strict check needs three (section 5).
2. **How much smaller each contraction must be.** Minervini: "about half", tolerance unstated. Our engines: under 0.85
   of the previous (System A), 0.35 to 0.75 (System D), under 0.8 (Chart IQ). No outside source gives a number.
3. **52-week-low distance in the Trend Template.** 30% in the 2013 text (verified), 25% in the 2017 text (repo, not
   re-verified).
4. **RS floor.** Minervini 70 (2013), "preferably in the 90s" (2017, repo). ChartMill 70, preferably 80. House rule: 80.
5. **Breakout volume.** Minervini gives no percentage and will wait a day or two for volume. IBD: 40% minimum (50-day
   window per ChartMill). TraderLion: 30-40%. Our scanner's text: 1.5 times the 20-day average.
6. **Where the stop goes.** Minervini (as summarized by educators) and ChartMill/TraderLion: under the final
   contraction. Kullamägi (related setup): the day's low, no wider than ATR. House: a few cents under the day's low or
   prior day's low, usually within about 3%.
7. **Length.** Minervini publishes no minimum (per the repo file). TraderLion says 6 to 12 weeks. Our scanner's text
   says "Minervini's 6-13 week sweet spot", which I could not find in any Minervini text.
8. **Flat base versus VCP.** Minervini says a 4 to 7 week flat base has "no real volatility contraction". The owner
   ruled a chart "more of a VCP or flat base breakout", grouping the two. Our Model Book's Flat Base card describes a
   VCP (section 5.4).
9. **Entry order.** ChartMill: a buy stop limit placed in advance. Kullamägi: the opening-range high. House: market
   orders. Our scanner: a daily close above the pivot.
10. **Building the position.** Minervini adds in steps ("incrementally commit"). House: one full buy, one stop.

---

## 4. Measured evidence

**Bottom line: I found no published, sample-based success rate for the VCP from Minervini, from any educator, or from
any peer-reviewed study.** What exists:

1. **Minervini's own numbers (no sample, no base rate).**
   - His overall hit rate, all trades: *"During my 30 years trading tens of thousands of stocks, I have been correct on
     winning trades only about 50 percent of the time."* (blog, 2020-06-14). The 2017 book says the same about purchases
     **[repo, not re-verified]**.
   - Relative claims from the 2017 book **[repo, not re-verified]**: a close below the 20-day soon after the breakout
     cuts the odds "in about half"; 40 to 50 percent of breakouts pull back to or slightly under the breakout level. No
     sample, no period, no absolute rate. They cannot be turned into percentages to teach.
   - Single examples: NFLX from 2009, "more than 500%" (interview, 2016); CBPO, base 2014-11-06 to 2015-02-17 (blog,
     2015). The repo file lists others (MELI, MIK, NFLX, VIVO, BITA) **[repo, not re-verified]**. These are chosen winners,
     so they carry survivorship bias by design.
   - Account results, not pattern results: 155% in the 1997 championship (his blog); +334.8% in 2021 (the contest's own
     standings, archived copy; TraderLion rounds it to 334%).
2. **Educators.** ChartMill and Deepvue publish no statistics. TraderLion states "Studies show that 60-70% of VCP
   breakouts lead to solid price rallies" and that "More than 50% of superperforming stocks" show VCPs, with no study,
   sample or date named. **Do not teach these.** ChartMill's worked sum of ten trades at a 30% win rate ("Run the
   numbers on ten VCP trades...") is an arithmetic illustration, not a measurement.
3. **Related measured work (not the VCP itself).**
   - **Thomas Bulkowski, NR7 (one narrow-range day), thepatternsite.com/nr7.html.** Sample: 1,201 stocks, January 1990
     to March 2013, minimum price $5, one in every 25 trades kept. Bull market, upward breakouts: "5% failure" (his
     column for breakouts that did not move at least 5%) 46%, average rise 7%; downward breakouts: 5% failure 47%,
     average drop 6%. Measure rule met 43% (up) and 37% (down). (Re-read in checking: same numbers.)
     Limits: one quiet day is not a multi-week VCP; the numbers are from 2013. It supports one point only: a quiet
     range does not pick the direction by itself. **The site states: "This website, in whole or in part, shall not be
     used to train artificial intelligence (AI) systems".** I read it through a fetch tool that summarizes with a
     model, twice, and the numbers matched both times; I did not copy the tables.
   - **Lo, Mamaysky and Wang (2000), "Foundations of Technical Analysis", NBER working paper 7613, published in the
     Journal of Finance 55(4).** Automated pattern recognition on U.S. stocks 1962 to 1996: *"several technical
     indicators do provide incremental information and may have some practical value."* It also warns that chart shapes
     are *"often in the eyes of the beholder"*. It did not test the VCP. Use: a reason to define the VCP in numbers.
   - **George and Hwang (2004), "The 52-Week High and Momentum Investing", Journal of Finance 59(5), 2145-2176**
     (abstract via Crossref): *"Nearness to the 52‐week high dominates and improves upon the forecasting power of past
     returns (both individual and industry returns) for future returns."* It did not test the VCP. Use: support for
     Minervini's "within at least 25 percent of its 52-week high" and for buying near highs.
4. **Our own measurement (house, internal).** `docs/uct-scanner-intelligence/vcp_gold_standard/` holds an 82-case
   blinded review. The reviewers were four model "personas", not people: the rubric says *"Do not convert model
   consensus into human ground truth"*. On the 48 cases with a clear label, our pattern-engine scanner (System A,
   `vcp.py`) scored precision 0.40 (95% interval 0.168 to 0.687) and recall 0.50 (0.215 to 0.785)
   (`data/metrics.json`). The screener's base catalog (System D) scored precision 0.111 before a fix and 0.286 after
   (`data/phase3c_revalidation.json`, as summarized in `docs/uct-scanner-intelligence/tier1_validation/data/vcp_full.json`).
   The two engines agreed on 32 of 82 cases (7 where both fired, 25 where both rejected; `metrics.json`). A separate
   count in the `vcp.py` header (2026-08-31, 744 tickers, counting only symbols either engine named) found 3% agreement,
   and a comment in `api/services/screener/filters.py` records a production count on 2026-10-15: "VCP 386 vs 58, 6 in
   both" (System A against System D). Limits: small sample, model reviewers, no forward returns measured, and the owner has not reviewed
   these labels.

**What this means for the course:** teach the VCP as a way to place a low-risk entry in a stock that is already
strong, not as a pattern with a known win rate. If the owner wants a number, it has to come from our own data
(forward results of owner-approved examples), not from the internet.

---

## 5. Our app: what the scanners test

### 5.1 The pattern-engine scanner: `api/services/pattern_engine/detectors/uct/vcp.py` (System A)

This is the scanner named in the brief. Its detections feed `pattern_detections` (Compass's pattern tools), the
screener column "VCP (Eng)", and the Terminal breakout panel. Last changed 2026-10-16 (`609fc08eb6`). What the code
actually does, step by step:

1. **History:** needs at least 30 daily bars (`_MIN_PATTERN_BARS = 30`).
2. **Trend filter (lines 383-401):** last close above the 150-day and 200-day SMA, and the 150-day above the 200-day.
   That is 2 of Minervini's 8 Trend Template lines. With fewer than 200 bars it **passes automatically** ("fails
   open").
3. **Swing points:** a swing high or low must beat the 3 bars on each side (`detect_pivots(bars, window=3)`).
4. **Contractions (lines 224-333):** start from one of the last 10 swing highs; each contraction is a swing high to the
   next swing low. If no confirmed swing low exists yet, it uses the lowest low since the last high (not the last bar)
   as a provisional low.
   - First contraction: at least 6% and at most 40% deep.
   - Each later contraction: less than 0.85 times the previous (`_TIGHTENING_RATIO_MAX = 0.85`) and at least 2.5% deep.
   - Each new swing high must be within 10% below to 8% above the previous one.
   - At least 2 contractions; final contraction 10% or less.
   - Pattern length from the first high to the last low: **at least 10 bars and at most 90 bars.** (The file's header says
     "Window: 30-90 bars (typically 6-13 weeks)", but the code accepts 10.)
5. **Gates (lines 133-177):** the final contraction's low must be within the last 15 bars; not already broken out
   (3 or more closes more than 1% above the pivot since the pivot bar means "already broken"); a prior advance of at
   least 20% from the lowest low of the 60 bars before the pattern to its first high; the final contraction's average
   volume lower than the first contraction's; rejected only if trend stage 4 AND stacked-bearish averages AND RS trend
   down all hold at once.
6. **Score:** 40% geometry (count of Ts, how fast they shrink, how small the last is, first depth 15-30% scored best),
   25% volume (falling volume, last-versus-first ratio, final contraction versus the 50-bar average), 20% context
   (stage 2, stacked averages, RS trend up, accumulation, a CAN SLIM bonus), 15% a fixed 50. Must reach 50 to show.
7. **Levels (lines 711-715):** pivot = high of the final contraction. **Entry = pivot × 1.001. Stop = final
   contraction low × 0.985 (1.5% under it). Target = pivot + (pivot − the first contraction's low), a measured move.**
   (The member text at lines 809-811 calls this "the height of the first contraction ... projected up from the pivot";
   the code's number equals that height only when the pivot sits exactly at the first contraction's high.)
   The entry condition shown to members is `close > {entry:.2f} on volume > 1.5x 20-bar avg` (line 868).
8. **No liquidity or price floor** in the scanner itself. I did not check how the scanned universe is built.

### 5.2 The screener's base catalog: `api/services/screener/base_catalog.py`, `vcp_state` (System D)

The `vcp.py` header says this engine decides *whether* a base is present and System A decides *where to enter*. Its rules
(lines 2717-2915): 2 to 6 contractions read from confirmed swings only; each contraction 0.35 to 0.75 times the
previous (the code says this band is "OURS, AND THE BOOK SAYS SO"); whole-base depth 10% to 40%, never 60%+; final
contraction's volume below the first's; at least 30% prior advance within 120 bars; the same 2-line trend filter (also
fails open under 200 bars); the last confirmed contraction within 60 bars; and the last close still inside the base.
Each criterion carries its Minervini quote and a confidence tag. It emits no stop or entry price, but it does emit a
`pivot` (read by the screener through `_pivot_of`), and that pivot is the **top of the base**: the high where the
first counted contraction starts (`"pivot": top`, `top = run[0]["high"]`), not the high of the final contraction that
Minervini (2017, per repo) and ChartMill call the pivot. It also has no cap on the final contraction's depth.

### 5.3 A third engine: Chart IQ (`api/services/chart_iq/engine/v3_bases.py`, `v4_compose.py`)

Chart IQ labels the bases used in Study's chart items. `is_vcp` takes the last up to 3 contractions, each no more than
0.8 times the previous, the last no more than 12%, and the last low not below the first low (allowing 0.5%).
`strict_vcp` needs a base of at least 20 bars, at least 3 contractions, the first at least 10%, the last at most 10%,
each no more than 0.8 times the previous, and the final contraction's volume at most 0.9 times the base's average.
A contraction must be at least 2% deep to count (`contractions3`). When the strict check fails, `v4_compose.py`
relabels the base "Flat base" if it is 15% deep or less, otherwise "Consolidation / range", so in Chart IQ a VCP that
is not strict enough becomes a flat base.

### 5.4 Model Book, journal tags, Study plans and other places VCP appears

- **Model Book (`app/src/pages/modelbook/setupCatalog.js`):** there is **no VCP card**. The **Flat Base Breakout** card
  (line 55) says: "A coiling price structure where each pullback is smaller than the last, reflecting drying-up selling
  pressure and compressed volatility before the move through resistance." The code comment calls it "a VCP-style
  contraction glyph". That describes a VCP, while Minervini says a flat base has "no real volatility contraction".
- **Journal tags (`app/src/constants/setupGroups.js`, line 9):** "VCP" and "Flat Base Breakout" are separate Swing tags.
  `app/src/pages/journal-2-0/lib/setupTagMap.js` files VCP under "Bases & Breakouts".
- **Trade plans (`docs/study/TRADE_PLANS.md`):** VCP has no row. `vcp.py` does not use the shared `make_levels` (2R/3R
  targets) in `uct_setups_common.py`; its own target is the measured move. (Checked: 19 of the 43 detector files in
  `detectors/uct/` use `make_levels`, all of them in the `uct_*` family; `vcp.py`, like `flat_base.py`, `cup_handle_uct.py`
  and `high_tight_flag.py`, sets its own levels.)
- **Study curriculum:** `docs/study/UNITS-method.md` SET.12 makes VCP a setup of its own (decision 13.9-6), taught
  through the Flat Base Breakout lesson door, with "The 82-case gold standard is the grade bank".
- **Pattern Vision rubric (`api/services/pattern_vision/rubrics.py`):** must-haves are a prior uptrend, 2+ shrinking
  pullbacks, volume drying into the tightest one, price near the base's highs; disqualifiers are widening contractions,
  a late deep selloff, heavy down-volume, a downtrend. This matches the sources.
- **Compass knowledge base (`api/data/voice_kb/trading_principles.json`, item `sd-002`)** and a **Study bank item**
  (`docs/study/bank/recall.principles.json`, `si_953f5a192e8a`; `review_status: "draft"` in the repo file, and
  `study_store.py` serves members only approved items) both say: "Stock makes a deep base (25-50% from prior
  high)" and "Failure: price falls below the last tight area within 1-2 days."
- **Quotes shown in the app (`app/src/constants/quotes.json`, lines 47 and 51):** two lines credited to "Mark
  Minervini", source "UCT Knowledge Base": "The essence of the VCP: stock makes a series of corrections that get smaller
  and smaller..." and "The VCP doesn't care what the economy is doing...".
- **Study chart items (`docs/study/bank/chart.taps.json`, `chart.bases.json`)** already label VCPs by Chart IQ, for
  example a 15-session base with two contractions (13% then 9%).

### 5.5 Where our app disagrees with the sources or looks wrong

1. **Made-up or unsupported claims in the member-facing text of `vcp.py`.**
   - Lines 778-783: "Kristjan Kullamägi (Qullamaggie) ... runs the VCP pattern as his core setup". His own setups post
     calls it "Breakouts" and never says "VCP". Not supported. (The repo's own audit,
     `tier1_validation/data/vcp_full.json`, already marked this "qualify"; it is still shipped.)
   - Lines 783-787: "Ryan Pierpont's Investor's Business Daily methodology, an offshoot of O'Neil's CAN SLIM lineage,
     treats the VCP as a refinement of the flat-base and ascending-base patterns". **Corrected in checking:** Ryan
     Pierpont is a real trader; the contest's own archived 2021 standings list "Ryan Pierpont + 201%" third in the
     United States Investing Championship stock division. But I found nothing (searches of IBD, MarketSmith and the
     web) that ties him to an IBD "methodology" or to the VCP view the sentence gives him. The person is real; the
     claim about him is unsourced. (The repo's own audit marked this sentence "qualify" too.)
   - Line 797: "Minervini's 6-13 week sweet spot". I found no such range in any Minervini text I read, and the repo file
     lists his examples from 6 to 40 weeks.
2. **Two app quotes credited to Minervini are unverified.** I searched both lines in `quotes.json` and found no source
   for either. They should not be shown as his words until a source is found.
3. **The Compass/Study text "deep base (25-50% from prior high)"** conflicts with Minervini's 10% to 35% (up to 40%), with
   50% only in bear markets **[repo, not re-verified]**, and with ChartMill's 10% to 35%. Its "1-2 days" failure rule has
   no source.
4. **The scanner's stop is always wider than the house's usual 3%.** Entry = pivot × 1.001 and stop = final low × 0.985,
   so the stop distance is 4.1% when the final contraction is 2.5% deep, 6.5% at 5%, 9.5% at 8% and 11.4% at 10%
   (computed from lines 712-713). House rule A13 says the stop usually sits within about 3%.
5. **The scanner's target is a measured move** (pivot plus the first contraction's height). No VCP source uses it, and
   the house trims at 3R and 5R.
6. **The trigger is a daily close on 1.5 times the 20-bar average volume.** No source uses a close-only trigger or a
   20-day window; the house enters with market orders; IBD's floor is 40% over the 50-day.
7. **Looser than the sources:** a prior advance of 20% in 60 bars (sources: 30%); a first contraction as small as 6%
   (sources: 10%); each contraction only needs to be under 0.85 of the last (Minervini: "about half"); a pattern as
   short as 10 bars (two weeks) while the header says 30.
8. **Only 2 of the 8 Trend Template lines**, no RS floor, and the trend check passes automatically on stocks with
   under 200 bars (new issues). House rules B26 (200-day) and C31 (RS 80) are not checked here.
9. **Three engines, three answers.** Systems A and D rarely flag the same stock: 3% of named symbols in one count
   (2026-08-31), 6 shared out of 386 and 58 on production (2026-10-15). (The 39% "agreement" on the 82-case set counts
   25 cases where both said no.) They even place the pivot differently (System A at the final contraction's high,
   System D at the top of the base). Chart IQ is a third rule set. A Study answer key built from one engine can contradict another screen in the same app.
10. **The Model Book has no VCP card, and its Flat Base card describes a VCP** (5.4).
11. **The 82-case "gold standard" was labelled by model reviewers, not people,** yet the Study plan calls it the grade
    bank. Under the Study rule that the owner reviews every item, it cannot be used as answer keys until he does.

---

## 6. UCT's own words

Searched 2026-11-09: all 103 posts listed in the Substack sitemap (2025-06-01 to 2026-11-08), full text through the
Substack post API. 17 mention "VCP" or "volatility contraction". One post (Sunday Scans, 2026-10-18,
`sunday-scans-bf1`) is for paying subscribers only; I read only its free preview. Sunday Scans has sections by
different writers. The 2026-11-08 issue titles the owner's section "Patrick (TSDR)'s Weekly Outlook & Watchlist", so
"TSDR" sections are the owner's own words. Every post's byline is "Uncharted Territory". (Checked: each quote below sits
under the section heading it is filed under. Three of the 17 posts were not quoted by the first writer; they add
nothing new: Bracco on 2025-09-01, that the T2108 and T2107 breadth gauges are "building out some VCP patterns on
smaller timeframes"; an unsigned market note on 2026-01-07 ("SPY all time highs and VCP breakout"); and Bracco on
2026-04-26 ("love the VCP type action setting up on UAMY").)

**The owner (TSDR sections; the two "Intro" items are the unsigned intro, see below):**

- 2025-06-29, KWEB (https://unchartedterritoryy.substack.com/p/sunday-scans-d70): *"Thinking it could be forming a VCP
  (Volatility Contraction Pattern) under $35 here with room to $38 before gaining further momentum. Size is small and
  risk is tight"*.
- 2025-06-29, SE, same post: *"Will keep eyes on the hourly chart for tightening prior to a $160 breakout. Can also look
  for retest on hourly following breakout."* and *"Living under $155 would invalidate."*
- 2025-09-14, UBER (https://unchartedterritoryy.substack.com/p/sunday-scans-461): *"VCP (Volatility Contraction
  Pattern) forming. Textbook basing at highs under $100 Livermore level."*
- 2025-09-28, DAVE (https://unchartedterritoryy.substack.com/p/sunday-scans-9a2): *"I like the contractions in this
  base forming out here."* and *"Over $246 this would look like a perfect advance, base, and second push."*
- 2025-12-14, TSLA (https://unchartedterritoryy.substack.com/p/sunday-scans-f2f): *"I personally would love a shakeout
  back into the $430 range and one last contraction in this base to really set this up as five star."*
- 2026-05-24, INOD (https://unchartedterritoryy.substack.com/p/sunday-scans-ffb): *"One more contraction on this and a
  higher low around that $90 range giving an undercut or hammer candle would be awesome."*
- 2026-07-12, ANET (https://unchartedterritoryy.substack.com/p/sunday-scans-898): *"VCP action in this base and strong
  push higher with Relative Strength. Now trying to flag breifly and give a higher low. If I can get an hourly shakeout
  to $180 early in the week I will be a buyer."*
- 2026-08-30, NTSK (https://unchartedterritoryy.substack.com/p/sunday-scans-d40): *"Want to see it tighten up a tad and
  form VCP ish action here in the %$15-$17 area."*
- 2026-10-04, NVDA weekly (https://unchartedterritoryy.substack.com/p/sunday-scans-4c6): *"2-3 weeks of wiggle here
  around the breakout to fill out this weekly VCP, then a rip to $260+. $220-225 entry is acceptable imo."*
- 2026-02-04, BWXT (https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732): *"Cup and handle forming with
  $220 as the pivot. Offering a mid range cheat entry here mid week."* (Minervini's "cheat" vocabulary.)
- How he enters and stops out: 2025-06-20 (https://unchartedterritoryy.substack.com/p/market-update-and-watchlist):
  *"break the opening range. Can enter there and place a stop at LOD and see how far it goes."* 2025-06-15
  (https://unchartedterritoryy.substack.com/p/sunday-scans-744): *"I will often cut for -2% or less or if a stock breaks
  LOD (low of day) on the day of entry."* 2025-06-22 (https://unchartedterritoryy.substack.com/p/sunday-scans-0d2):
  *"I always take 1-2% losses when trades do not show me positive results from the get go."*
- The two "Intro" items: the INTRO section carries no writer's name. The 2026-06-14 intro speaks in the first person
  about building the UCT Intelligence project ("We have spent a lot of time (and money) building this out"), which
  points to the owner, but that is my inference, not a signature.
- Intro, 2026-06-14 (https://unchartedterritoryy.substack.com/p/sunday-scans-e95): *"Focus on the strongest names that
  are building out higher lows and getting tight. Limit your losses by using tight stops. I almost never take a loss
  greater than 3%."*
- Intro, 2026-04-05 (https://unchartedterritoryy.substack.com/p/sunday-scans-356), on the market after a low: *"This
  leads to basing and volatility contraction prior to a respectful move higher."*
- 2026-05-17, TSDR section (https://unchartedterritoryy.substack.com/p/sunday-scans-679): *"I love these stocks that
  consolidate at or around $100 and give us a nice tight base for us to get involved in."*

**Bracco (Bracco's Breakdown & Top Ideas):**

- 2026-05-03, UUUU (https://unchartedterritoryy.substack.com/p/sunday-scans-bcc): *"potentially building out a huge VCP
  base. A move up into those recent highs and another shallow pullback/contraction would be near 5-star base."* USAR,
  same post: *"Traded this for a huge win in October last year out of a perfect VCP base."* UAMY, same post: *"this has
  just build out a clean VCP base after a 10,000% advance in 2-years."*
- 2025-12-17, TSLA (https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-4fe): *"We are looking at a 5-year
  volatility contraction pattern setting up through the $500 Livermore level"*.
- 2025-11-09 (https://unchartedterritoryy.substack.com/p/sunday-scans-720), on the market: *"The real tell and only way to
  begin getting back involved long for me would be some volatility contraction and higher lows."*
- 2026-07-05, HYPE (https://unchartedterritoryy.substack.com/p/sunday-scans-dec): *"A move up into the top of the range
  and another tight contraction on this and would be willing to trade via BHYP ETF."*

**Index & ETF section (author not named on the page):**

- 2026-01-11, SPY (https://unchartedterritoryy.substack.com/p/sunday-scans-0b3): *"Three contractions that are narrower
  each time and now breaking base to new highs. Looks like expansion coming next week"*.
- 2026-07-12, QQQ (https://unchartedterritoryy.substack.com/p/sunday-scans-898): *"Looks like buyers have a chance to
  push this back to highs with volatility coming down as well as volume drying up following the 3rd contraction in this
  VCP like base."*
- 2025-08-24, ARKK (https://unchartedterritoryy.substack.com/p/sunday-scans-ffa): *"Classic 1 tap 2 tap 3 tap tight tight
  tight and ready to blast setup."*
- 2025-09-07, ARKK (https://unchartedterritoryy.substack.com/p/sunday-scans-52e): *"A close over $78 confirms the pivot
  breakout but I am looking to get exposure prior to that."*
- 2026-01-04, PBW (https://unchartedterritoryy.substack.com/p/sunday-scans-153): *"the ETF looking like a VCP set to
  enter a new uptrend following 3 months of consolidation."*

**Other UCT contributors ("The Rest of the Week"):** ChartMaster, ELF, 2025-10-08
(https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208): *"Weekly Inverted H/S , (VCP) Volatility
Contraction Pattern getting tight on the right side of the base."* Dark Oblivion, SNOW, 2025-10-01
(https://unchartedterritoryy.substack.com/p/the-rest-of-the-week): *"successively holding two higher lows in a post
earnings 3 wave VCP Pattern. Volume is dying down especially sell volume"*.

**The owner's verdict log** (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`, pass 3, Launchpad, TAN 2022-07-27):
*"Eh, it is more of a VCP or flat base breakout so I would say no to launchpad"*. No other ruling names the VCP.

**What UCT's words add to the textbook:**

- He wants **higher lows** and often **one more contraction** or a **shakeout/undercut** into the last contraction before
  calling a base "five star" (TSLA, INOD, ANET; Bracco's UUUU).
- He times the buy on **lower timeframes**: hourly tightening, an hourly shakeout, the opening-range break, with a
  **stop at the day's low**, and he cuts quickly (about 2% or the day's low).
- He uses **weekly VCPs** (NVDA). The **index/ETF VCPs** (SPY, QQQ, PBW) come from the Index & ETF section, whose
  writer is not named, so they are UCT's but not proven to be his.
- UCT sometimes buys **before** the pivot: the owner's "mid range cheat entry" (BWXT, TSDR section), which is
  Minervini's "cheat" idea (ChartMill: buying in a tight consolidation "with the pivot roughly in the middle of the
  base"), and the Index & ETF writer's "looking to get exposure prior to that" (ARKK). Neither is the textbook pivot
  buy.
- Nobody at UCT wrote a full VCP definition, a minimum count, a volume number or a VCP-specific stop. Those are open
  for the owner (section 10).

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| House rule | What it means for a VCP | Conflict? |
|---|---|---|
| B26, no longs below the 200-day SMA (hard) | A VCP by definition sits above the 150 and 200-day. | None. But the scanner's trend check passes automatically under 200 bars; B26 cannot be checked on those stocks either. |
| C31, RS 80+ | Stricter than Minervini's 70. Apply 80. | Minor; house wins. |
| B23 and D42, $10+ and $20M a day; at most 1% of daily volume | Applies as is. A dry-up week can push a thin stock under $20M; measure on the 50-day average (the window is my proposal; B23 names none). | None. |
| A3 and F62, stop a few cents under the day's low or prior day's low | The textbook VCP stop is under the final contraction. With a buy on the pivot break, the breakout day's low is usually higher, so the house stop is tighter. | Yes: two candidate stops (section 8.3). |
| A13, stops usually within about 3% | Final contractions are often 3% to 10% deep. The scanner's stop is 4.1% to 11.4% wide. | **Yes, the main conflict.** The house day-low stop usually fits; the structural stop often does not. |
| A4, the stop only moves up; the stop is the exit | Minervini's post-breakout warnings (20-day close, 3 lower lows, squat) are warnings only. The owner struck "cut at least half if the stock falls back into its base" ("my stop is my stop most of the time"). | None, if taught as warnings. |
| A5 and A7, size from the stop, cap 40% | A tight VCP stop makes big sizes; the 40% cap applies. Example: 1% risk with a 2% stop is 50%, capped to 40%. | None. |
| E57, market orders | Educators use a buy stop placed above the pivot. The owner market-orders on the break or the opening-range high. | Yes, in method: is a resting buy-stop allowed (it becomes a market order when hit)? |
| C28, no chasing past 4% | Stricter than IBD's 5% (not read) and in line with Minervini's "a few percentage points". | None; use 4%. |
| C29, skip if more than 10% above the 10-day | A stock at its pivot after a tight range is rarely 10% above its 10-day. Matters only on a gap through the pivot. | None. |
| B19, E51, E52, F63, trims at 3R and 5R, trail under the 10 or 21-day | The scanner's measured-move target does not match. Kullamägi's 1/3 to 1/2 after 3-5 days, and Minervini selling into strength (TraderLion's account of his 2021 trading, not his own text), are close in spirit. | Scanner target conflicts; use the house plan. |
| B20, gap through the stop: first 30-minute low is the new stop, out past 2R | Applies as is. Minervini: get out at the next bid. | Small difference; house wins. |
| C33, under 1R after 10 trading days, sell | Fits Minervini: a proper VCP breakout should be back at new highs "within a number of days up to a few weeks". | None. |
| B22, no new buys 3 days before earnings | Applies; a pivot that triggers inside the window is skipped. | None. |
| A5 (one full buy, no adds) | Minervini scales in. | Yes; house wins. |
| A1, E49, risk 0.25% to 1.5% by grade, 2% the absolute ceiling | Minervini's 1.25% to 2.5% is higher. | Yes; house wins. |
| D47, shorts are our long setups reversed | No published short VCP (section 8.6). | Open question. |
| F65, market reading | ChartMill: the market is the biggest factor. Minervini sits out or trades small in corrections. | None. |
| D40, growing sales and earnings | Minervini wants fundamentals too (2016 interview: *"Optimally, I want to own companies that deliver strong earnings and sales with the stock price in a long term uptrend."*). | None. |

---

## 8. Proposed rules for our course

Every line is measurable on a daily chart unless it says otherwise. "T" means one contraction: a fall from a swing high
to the next swing low inside the base. "Pivot" means the high of the final T.

### 8.1 What it is (all must hold on the day of the buy)

1. **Trend, Minervini's Trend Template.** Close above the 150-day and 200-day SMA; 150-day above 200-day; 200-day higher
   than 21 sessions ago; 50-day above the 150-day and 200-day; close above the 50-day; close within 25% of the 52-week
   high. **[originator]** (The "21 sessions" reading of "at least 1 month" is **[my proposal]**.)
2. **Distance from the 52-week low:** at least 30% above it. **[originator, 2013]** The 2017 book says 25% **[repo]**.
   Recommend 30%, the figure I verified, until the owner picks.
3. **Relative strength:** RS rating 80 or higher. **[house rule C31]** (Minervini's floor is 70.)
4. **Prior advance:** the base's first high is at least 30% above the lowest low of the 6 months before it.
   **[source consensus: ChartMill (citing O'Neil's base rule); Minervini 2017 per repo, not re-verified; Kullamägi's
   related Breakouts setup also starts at 30%]** The 6-month window is **[my proposal]**; the app uses 60 bars at 20%
   and 120 bars at 30%.
5. **Count:** 2 to 6 Ts. **[originator]** A T must be at least 2% deep to count. **[my proposal]**
6. **Each T smaller:** each T's depth is at most 0.75 times the previous T's depth. **[my proposal]** Basis: Minervini's
   "about half" **[originator]**; his blog examples run 0.40 to 0.60 and the repo's book examples 0.38 to 0.75. Options:
   0.85 (System A, too loose: it lets 20%, 16%, 13% count, which barely shrinks), 0.80 (Chart IQ), 0.75 (System D upper
   bound). Recommend 0.75.
7. **First T depth:** 10% to 40%. **[originator per repo; ChartMill 10% to 35%]** Never a base that fell 60% or more.
   **[originator per repo]**
8. **Final T depth:** 10% or less. **[ChartMill ("Final contraction under 10%, ideally 3% to 6%"); Minervini's own
   examples end at 8% and 5% (2013 blog); our System A and Chart IQ's strict check use the same 10%, but app engines are
   not sources]** Only one outside source states the number, so this is not a consensus tag.
9. **Higher lows:** the final T's low is above the lowest low of the base. **[source consensus: Deepvue ("Higher lows
   during each contraction"); Kullamägi's related Breakouts setup ("higher lows and tightening range"); UCT: the owner
   wants higher lows]**
10. **Length:** from the base's first high to the pivot, at least 15 sessions (3 weeks). **[my proposal]** No upper limit;
    read bases longer than about 20 weeks on the weekly chart. **[ChartMill]** Minervini publishes no minimum **[repo]**;
    his examples run 6 to 40 weeks.
11. **Volume dries up:** the final T's average daily volume is below the first T's **[originator, direction only]** and
    below the 50-day average **[originator per repo]**, with at least one day in the final T at or under half the 50-day
    average **[my proposal for "extremely low"]**.
12. **No selling on the right side:** no down day in the second half of the base on volume of 1.5 times the 50-day
    average or more. **[ChartMill, principle; the 1.5 is my proposal]**
13. **Liquidity:** close $10 or more; 50-day average dollar volume $20 million or more. **[house rule B23; the
    50-day window is my proposal]**
14. **Not stretched:** close no more than 10% above the 10-day average. **[house rule C29]**
15. **Weekly VCPs:** the same rules on the weekly chart, with Ts measured on weekly bars. **[UCT: the owner's NVDA weekly
    VCP; ChartMill]** Owner to confirm (section 10).

### 8.2 The buy

1. **Trigger:** price trades above the pivot. **[originator]** The pivot may sit below the base's left-side high.
   **[originator per repo; ChartMill]**
2. **Order:** a market order the moment price trades above the pivot; if the stock opens above the pivot, a market
   order when it takes out the opening-range high. **[house rule E57; UCT practice]** No buy on a close-only signal
   unless the owner wants the scanner's version (section 10).
3. **Chase limit:** no buy more than 4% above the pivot. **[house rule C28]**
4. **Volume:** recommended as a grade factor, not a gate. **[originator: volume "a good indication", may come "a day or
   two later"]** For an A+: breakout-day volume at least 1.4 times the 50-day average by the close. **[IBD 40% minimum;
   ChartMill]** Options in section 10.
5. **Earnings:** no new buy within 3 trading days before a report. **[house rule B22]**
6. **Market:** Green, normal; Yellow, smaller and fewer; Orange, A+ only; Red, no VCP buys. **[house rule F65; Minervini
   and ChartMill agree on staying out in weak markets]**
7. **One full buy at one price, one stop.** No pilot buys, no adding. **[house rule A5]**

### 8.3 The stop

1. **Default: a few cents under the low of the entry day** (or the prior day's low if the buy comes early and that low
   is tighter and still under the pivot). **[house rule A3, F62; the "if the buy comes early" condition is my
   proposal]**
2. **Structure check:** if the entry day's low is below the final T's low, the base has already broken; no trade.
   **[my proposal]**
3. **Width:** usually within about 3% of the entry. **[house rule A13]** If the honest stop does not fit the risk, skip;
   never tighten it to fit. **[house rule A3]**
4. **The textbook alternative** (for the owner to choose, section 10): a few cents under the final T's low.
   **[ChartMill; TraderLion; the app]** It is wider (4% to 11% in the app's own numbers), so size is smaller.
5. **Gap through the stop:** the first 30-minute low of the gap-down day is the new stop; out if that is past 2R.
   **[house rule B20]**
6. **The stop only moves up.** **[house rule A4]**

### 8.4 Trims and trail (house defaults; the VCP needs nothing of its own)

1. Stop to breakeven between 2R and 5R. **[house rule B19]**
2. Sell a third at 3R; a second third at 5R; if the stock opens above a trim level, trim at the open. **[house rules
   B19, E51, F63]**
3. Trail the last third under the 10-day (fast movers) or the 21-day (steadier), sold on a close below. **[house rule
   E52]** (Kullamägi trails his breakouts with nearly the same lines, the 10 or 20-day.)
4. Time stop: still under 1R after 10 trading days, sell. **[house rule C33]** This is consistent with Minervini's
   "within a number of days up to a few weeks". **[originator]**
5. Warning signs, taught as warnings, not exits: a close below the 20-day soon after the breakout; three lower lows on
   rising volume; a breakout day that closes back in the base (a "squat"), which Minervini says can take up to 10 days to
   recover. **[originator per repo]** The stop stays the exit. **[house rule A4; owner's ruling on rule 15]**
6. Earnings: hold through a report only if up 5R. **[house rule B22]** Climax run: sell a big part into it. **[house rule
   C34]**

### 8.5 What invalidates it

Before the buy:
1. A T as deep as, or deeper than, the one before ("wide and loose"). **[originator; ChartMill]**
2. The first T over 40%, or any fall of 60% or more. **[originator per repo]**
3. A close below the final T's low. The count starts again; a new tight T makes a new pivot. **[ChartMill]**
4. Any Trend Template line fails, or the close goes under the 200-day. **[originator; house rule B26]**
5. A heavy-volume down day in the right half of the base (8.1 line 12). **[ChartMill]**
6. Price already more than 4% above the pivot when you find it. **[house rule C28]**
7. Earnings within 3 trading days. **[house rule B22]**

After the buy: the stop (8.3). Nothing else forces an exit except the time stop and the trail.

### 8.6 The short mirror

- **No originator source.** Minervini says he goes "short a stage 4 downtrend" (2019 post), but I found no Minervini or
  educator text describing a VCP for shorts, and a search for an "inverse" or "bearish" VCP found only indicator pages.
- **If the owner wants one under D47** (shorts are our long setups reversed), the mirror would be **[my proposal]**: a
  Stage 4 stock (close under a falling 150 and 200-day, under the 200-day per B26), RS 20 or lower (C31 mirror), a prior
  fall of 30% or more, 2 to 6 rallies each at most 0.75 times the previous, volume drying up on the rallies, then a
  market-order short when price trades under the low of the final rally; stop a few cents over the entry day's high;
  skip hard-to-borrow names (D48).
- **Recommendation:** do not teach a VCP short until the owner shows two or three of his own examples. It has no outside
  definition to check against.

### 8.7 Best market conditions

- A Green market reading, with leaders setting up and breaking out. **[house rule F65; ChartMill]**
- Early in a new uptrend: the first or second base after a correction or a Stage 1 base. **[ChartMill; Minervini on
  late-stage bases, 2019]**
- After a correction, start with a few positions and add more positions only as the first ones work. **[house rule F68;
  Minervini's 2013 Q&A says the same about waiting for a second wave of setups]**
- Stocks with growing sales and earnings in leading groups. **[house rule D40; Minervini's SEPA]**

### 8.8 Common mistakes (each from a source)

1. Calling any sideways wiggle a VCP: the Ts must shrink. **[originator; ChartMill "wide and loose"]**
2. Buying a base in a downtrend because it "looks tight". **[originator, 2019 post]**
3. Buying during the first deep pullback or in the middle of the base before the pivot breaks. **[ChartMill]** (A
   deliberate "cheat" entry is a different, advanced entry, which ChartMill says Minervini describes and tells
   beginners to leave for later; section 10.)
4. Chasing far above the pivot. **[originator per repo; house rule C28]**
5. Ignoring heavy-volume down days on the right side. **[ChartMill; originator per repo]**
6. Trading VCPs in a weak market. **[ChartMill; Minervini 2013 Q&A]**
7. Widening the stop to give the stock more room. **[originator, 2015: "I strongly disagree"; house rule A4]**
8. Buying a third or fourth base late in a long run. **[originator, 2019; ChartMill]**
9. Treating a flat base as a VCP, or the reverse. **[originator, 2015]**
10. Setting a stop tighter than one day's normal range. **[ChartMill: not below 1 times the ATR]** Note the pull the
    other way: Kullamägi says his stop "should not be wider than the ATR or ADR", and the house day-low stop (A3, F62)
    can be tighter than one ATR. So this is ChartMill's view, not a settled rule; the owner decides (section 10).

Mistake 2, in Minervini's words (2019 post): *"If the long-term trend is not up, the stock simply doesn't qualify as a
candidate for purchase."*

---

## 9. Grading: what makes an A+ versus a B-

The owner ruled that grading is discretionary and that no fixed checklist is taught as ours (E50). So this is a list of
observable signs the sources point to, for the owner to use or discard. It is not a scoring rule.

| Sign | A+ looks like | B- looks like | Source |
|---|---|---|---|
| Trend | all 8 Template lines; 200-day rising for months | only just passing; 200-day flat-ish | Minervini 2013 ("preferably 4–5 months") |
| Relative strength | RS 90+; RS line in an uptrend for 13 weeks or more | RS 80 to 85 | Minervini 2017 per repo ("preferably in the 90s"; RS line up "preferably 13 weeks or more"); house C31 |
| Group | a leading group, other names setting up | lone stock in a weak group | ChartMill's checklist ("The market and the sector are cooperating"); house C31 |
| Base number | first or second base of the trend | third or fourth base | ChartMill; Minervini 2019 |
| Ts | 3 to 4 clean Ts, each about half the last | 2 Ts, or ratios near 0.75 | Minervini 2013 for "about half"; ChartMill: three to four is "the most common picture". Neither says 3 to 4 grades higher than 2; that split is my proposal |
| Final T | 3% to 6%, tight closes day to day | 8% to 10%, loose closes | ChartMill; Minervini 2017 per repo |
| Shakeout | the last T undercuts a nearby low and recovers, then a higher low | no shakeout, or a lower low | UCT: owner's TSLA, INOD, ANET; Bracco's "5-star base" |
| Volume in final T | below the 50-day average with 1-2 very low days | about average | Minervini 2017 per repo |
| Right side | quiet, up days on more volume than down days | some heavy down days | ChartMill |
| Pivot location | at or near a 52-week or all-time high | well below the left-side high (overhead supply) | Minervini 2014 ("no overhead supply"); George and Hwang 2004 |
| Breakout day | volume 1.5 to 2 times the 50-day average, closes near the high | volume near average, closes mid-range | ChartMill ("double the normal volume"); IBD 40% minimum; the close-near-the-high part has no outside source here (it is in our scanner's member text) |
| Stop width | house day-low stop 2% or less | 3% or more | house A13 (the 2% split is my proposal) |
| Market | Green | Yellow | house F65 |
| Fundamentals | growing sales and earnings | none | house D40; Minervini SEPA |

By house rule D38/E49, an A+ is sized up (1% to 1.5% risk), A and B normal (0.5% to 1%), B- or lower smaller (0.25% to
0.5%).

---

## 10. Questions for the owner

1. **Is the VCP its own setup in the course, or a kind of Flat Base Breakout?** You ruled TAN "more of a VCP or flat base
   breakout". Minervini says a flat base has no real contraction. Options: (a) separate setup, as the Study plan has now
   (SET.12); (b) one "Base breakout" setup with VCP and flat base as two named shapes; (c) fold VCP into Flat Base.
   Recommend (a), and rewrite the Model Book Flat Base card so it no longer describes a VCP.
2. **Which stop?** (a) a few cents under the entry day's low (house default, usually within 3%); (b) a few cents under
   the final contraction's low (textbook, often 4% to 10%); (c) the day's low, but skip if the final contraction is deeper
   than some limit. Recommend (a), with the 8.3 structure check.
3. **Is "about 3%" a hard ceiling for VCP stops,** or can an A+ VCP take a 4% to 6% stop with smaller size? And the
   floor: ChartMill says never tighter than 1 ATR, Kullamägi says never wider than the ATR or ADR. Which, if either?
4. **Entry order.** (a) market order when price trades above the pivot; (b) a resting buy-stop above the pivot (it turns
   into a market order when hit); (c) the opening-range high on the breakout day; (d) a daily close above the pivot (the
   scanner's version). Recommend (a) or (c), per E57 and your practice.
5. **Breakout volume.** (a) no volume rule, grade only (Minervini lets it come a day or two late); (b) at least 40% over
   the 50-day average (IBD); (c) 1.5 times the 20-day average (the scanner). Recommend (a) for the rule and (b) for an A+.
6. **Minimum number of contractions:** 2 (Minervini) or 3 (ChartMill's "common picture", Chart IQ's strict check)?
   Recommend 2, with 3 or 4 as an A+ sign.
7. **How much smaller each contraction must be:** 0.85 (System A), 0.80 (Chart IQ), 0.75 (recommended), or 0.35 to 0.75
   (System D, which also forbids very fast shrinking)?
8. **Prior advance:** 20% (System A), 30% (System D, ChartMill, Minervini's "30, 40, 50 percent"), or none beyond the
   Trend Template? Recommend 30%.
9. **Trend filter:** the full 8-line Trend Template with RS 80, or only B26 (200-day) and C31 (RS 80)? Recommend the full
   template. And 30% (2013) or 25% (2017) above the 52-week low?
10. **Minimum length:** none, 3 weeks (recommended), or 6 weeks?
11. **Weekly VCPs and ETF/index VCPs** (your NVDA weekly, SPY, QQQ): in the course or not?
12. **"Cheat" entries** (buying in the middle of the base before the pivot, as in your BWXT note): part of the VCP lesson,
    a separate advanced entry, or left out?
13. **Short mirror:** teach one under D47 (8.6), or not until you show examples?
14. **The 82-case gold standard** was labelled by model reviewers. Do you want to review its 7 cases that both engines
    flagged and the 50 split cases before any of them become Study answer keys?
15. **Fix list for the app (needs your go-ahead, code changes):** remove (or source) the Kullamägi and "Ryan Pierpont"
    sentences (Pierpont is a real 2021 contest finisher, but nothing I found supports what the sentence says about him)
    and the "6-13 week" claim from `vcp.py`; decide where System D's `pivot` should sit (today the top of the base, not
    the top of the final contraction); remove or source the two Minervini lines in `quotes.json`; correct the Compass
    and Study text "deep base (25-50% from prior high)"; replace the scanner's measured-move target with the house 3R/5R
    plan; and choose one VCP rule set for all three engines.
16. **The repo's research file 03** (`docs/superpowers/research/bases/03-minervini-vcp-powerplay.md`, public) says it read
    Minervini's 2017 book from a PDF on a third-party site and prints that link. That copy does not look licensed. Do you
    want the link removed, and do you have your own copy of the book to check the "[repo, not re-verified]" quotes?
17. **Examples to chart for the 10 models:** candidates from the sources are CBPO 2014-15 and NFLX 2009 (Minervini);
    HAE 2026 (ChartMill); SHOP 2016, TSLA 2020, NVDA 2023 (Deepvue); and from UCT: KWEB 2025-06, UBER 2025-09, DAVE
    2025-09, TSLA 2025-12, INOD 2026-05, ANET 2026-07, NVDA weekly 2026-10, USAR 2025-10 (Bracco's win). None is checked
    against our rules yet. Which do you want charted first?

---

## 11. Sources

All read 2026-11-09 unless noted. "Archive" means the Internet Archive's Wayback Machine.

| # | Source | URL | Publisher / author | Reliability note |
|---|---|---|---|---|
| 1 | "How to Time Your Trade with Pinpoint Accuracy - The Volatility Contraction (VCP) Pattern", 2015-02-23 | https://web.archive.org/web/20150225145654/http://www.minervini.com:80/blog/index.php/blog/show/how_to_time_your_trade_with_pinpoint_accuracy_the_volatility_contraction_vc | Mark Minervini, his blog (excerpt of his 2013 book) | Originator, primary. Archive copy; the blog is gone from the live site. Copyright notice forbids redistribution; short quotes only. |
| 2 | "First Things First - How to Increase Your Chances of Owning a Big Winner by Trading with the Trend", 2019-04-23 | https://web.archive.org/web/20190426232311/http://www.minervini.com:80/blog/index.php/blog/show/first_things_first_how_to_chart_stocks_correctly_and_increase_your_chances | Mark Minervini (excerpt of his 2013 book) | Originator, primary. Archive copy. |
| 3 | Interview of Mark Minervini by Dr. Iqbal K M, posted 2016-04-21 | https://web.archive.org/web/20160425105150/http://www.minervini.com:80/blog/index.php/blog/show/dr._iqbal_k_m_interviews_mark_minervini | Mark Minervini's blog | Originator, primary (interview he published). Archive copy. |
| 4 | "Q&A with Mark Minervini", 2013-06-06 | https://web.archive.org/web/20130627101213/http://www.minervini.com:80/blog/index.php/blog/show/qa_with_mark_minervini | Mark Minervini's blog | Originator, primary. Archive copy. |
| 5 | "Not All Ratios Are Created Equal", 2015-04-14 | https://web.archive.org/web/20150419092226/http://www.minervini.com:80/blog/index.php/blog/show/not_all_ratios_are_created_equal | Mark Minervini | Originator, primary. Archive copy. |
| 6 | "Losses Are a Function of Expected Gain", 2020-06-14 | https://web.archive.org/web/20200616005714/http://www.minervini.com:80/blog/index.php/blog/show/losses_are_a_function_of_expected_gain_by_mark_minervini | Mark Minervini (excerpt of his 2013 book) | Originator, primary. Archive copy. |
| 7 | "Position Sizing for Optimal Results", 2017-05-31 | https://web.archive.org/web/20170616223927/http://www.minervini.com:80/blog/index.php/blog/show/optimal_position_sizing_excerpt_from_think_and_trade_like_a_champion_by_mar | Mark Minervini (excerpt of his 2017 book) | Originator, primary. Archive copy. |
| 8 | "Handling Stop-Loss “Slippage”", 2014-01-14 | https://web.archive.org/web/20140119082713/http://www.minervini.com:80/blog/index.php/blog/show/handling_stop_loss_slippage | Mark Minervini | Originator, primary. Archive copy. |
| 9 | "Why Buy a Stock Trading at a New High?", 2014-06-17 | https://web.archive.org/web/20140628093345/http://www.minervini.com:80/blog/index.php/blog/show/why_buy_a_stock_trading_at_a_new_high | Mark Minervini (excerpt of his 2013 book) | Originator, primary. Archive copy. |
| 10 | "My Road to the U.S. Investing Championship - A Story of Discipline", 2019-01-10 | https://web.archive.org/web/20190114161102/http://www.minervini.com:80/blog/index.php/blog/show/my_road_to_the_u.s._investing_championship_a_story_of_discipline | Mark Minervini | Originator, primary, about his own result. Archive copy. |
| 11 | Open Library records for *Trade Like a Stock Market Wizard* and *Think & Trade Like a Champion* | https://openlibrary.org/works/OL17513152W and https://openlibrary.org/works/OL22170236W | Internet Archive's Open Library | Bibliographic data only (publisher, year, ISBN). |
| 12 | `docs/superpowers/research/bases/03-minervini-vcp-powerplay.md` | repo file | UCT repo, earlier research session | Quotes from the 2017 book I could not re-verify. The file says it read a PDF on a third-party site that does not look licensed. Use with care. |
| 13 | "The Volatility Contraction Pattern, The Complete Guide", October 2026 | https://www.chartmill.com/images/uploads/The-Complete-ChartMill-VCP-Guide.pdf | ChartMill, Kristoff De Turck | Established data provider; clear about what is Minervini's and what is its own. Sells the screen it describes. |
| 14 | "Mastering the Volatility Contraction Pattern", updated 2024-04-21 | https://deepvue.com/screener/volatility-contraction-pattern/ | Deepvue (no author named) | Established data provider; UCT partner (conflict of interest). No sources cited. |
| 15 | "Mastering the Volatility Contraction Pattern", 2024-10-25 | https://web.archive.org/web/20250425064732/https://traderlion.com/technical-analysis/volatility-contraction-pattern/ | TraderLion, Nick Schmidt | Established educator; contains unsourced statistics. Live site returned 403 to my client; read from the archive copy, which the owner may prefer to re-check in a browser. |
| 16 | "Mark Minervini's Risk Management Wins The 2021 U.S. Investing Championship With A 334% Return", 2024-08-31 | https://web.archive.org/web/20250122085121/https://traderlion.com/investing-champions/mark-minervinis-risk-management/ | TraderLion, Craig Celeste | Secondary summary of Minervini; read from the archive copy (the live site blocked my client on another page; I did not retry here). The 2021 figure itself is now taken from the contest's own record (source 28). Also the only source here for "Mark will start selling into strength". |
| 17 | "Master Finding VCPs: Identify Tight Areas", undated | https://web.archive.org/web/20240621162830/https://traderlion.com/trading-strategies/vcps-identify-tight-areas/ | TraderLion | Established educator; read from the archive copy. |
| 18 | "3 TIMELESS setups that have made me TENS OF MILLIONS!", 2021-01-08 | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Kristjan Kullamägi | Originator of a related setup, primary. |
| 19 | "Breakouts Among Big-Cap Stocks Mostly Went Nowhere", updated 2016-02-19 | https://www.investors.com/stock-lists/ibd-big-cap-20/breakouts-among-big-cap-stocks-fizzled/ | Investor's Business Daily, Paul Whitfield | Primary IBD; only the free first paragraph read. |
| 20 | "Everything You Need To Know About Handles", updated 2026-05-13 | https://www.investors.com/how-to-invest/investors-corner/everything-you-need-to-know-about-handles-how-to-spot-a-good-one/ | IBD, Kimberley Koenig and David Saito-Chung | Primary IBD; free first paragraph only. |
| 21 | "Narrow Range Day NR7" | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/narrow-range-day-nr7 | StockCharts ChartSchool | Established educator. |
| 22 | "NR7" | https://www.thepatternsite.com/nr7.html | Thomas Bulkowski | Measured statistics; **the site states it "shall not be used to train artificial intelligence (AI) systems"**; it refuses plain curl (HTTP 406), so it was read through a summarizing fetch tool, and the numbers matched on three reads (two by the writer, one in checking). |
| 23 | "Foundations of Technical Analysis", NBER w7613 | https://www.nber.org/papers/w7613 | Lo, Mamaysky, Wang (NBER; Journal of Finance 2000) | Peer-reviewed; abstract read. |
| 24 | "The 52-Week High and Momentum Investing" | https://doi.org/10.1111/j.1540-6261.2004.00695.x (abstract via api.crossref.org) | George and Hwang, Journal of Finance 2004 | Peer-reviewed; abstract read. |
| 25 | Uncharted Territory Substack, 103 posts 2025-06-01 to 2026-11-08 (each quoted post linked in section 6) | https://unchartedterritoryy.substack.com/sitemap.xml | UCT: the owner (TSDR), Bracco, ChartMaster, Dark Oblivion, unnamed Index & ETF writer | House source. One subscriber-only post read as preview only. |
| 26 | App code and data: `vcp.py`, `base_catalog.py`, Chart IQ `v3_bases.py` and `v4_compose.py`, `setupCatalog.js`, `setupGroups.js`, `setupTagMap.js`, `rubrics.py`, `trading_principles.json`, `quotes.json`, Study bank files, `vcp_gold_standard/`, `tier1_validation/data/vcp_full.json` | repo, branch feat/study-content | UCT | House material, read directly. |
| 27 | Owner rulings: `docs/study/sizing_rule.md` section 9; `docs/study/audits/2026-10-24/owner_verdicts.jsonl`; `docs/study/TRADE_PLANS.md` | repo | the owner | House rules. |
| 28 | United States Investing Championship home page with "2021 STANDINGS", archived 2022-01-26 | https://web.archive.org/web/20220126051116/https://financial-competitions.com/ | The contest (Norm Zadeh) | Primary record of the 2021 results (Minervini +334.8%, $1M+ stock division of the Money Manager Verified Ratings; Ryan Pierpont +201%, USIC stock division). Added in checking. The live site now shows only 2025-2026. |
| 29 | Lo, Mamaysky and Wang, Journal of Finance 55(4), 1705-1765 (August 2000) | https://doi.org/10.1111/0022-1082.00265 (record via api.crossref.org) | Journal of Finance | Bibliographic check of source 23's journal version. Added in checking. |

**Tried and not usable:** Minervini's current site (https://www.minervini.com/) has no VCP text. ChartMill's web
article and a Stockopedia interview with Minervini refused my client; I did not use an archived copy of the
Stockopedia page because the live page is access-restricted. investors.com articles past the first paragraph are paywalled. Google Books' API was out of
quota. I found no X/Twitter post by Minervini that I could read directly. Searches for "Ryan Pierpont" with IBD or
MarketSmith returned nothing relevant (he is a real contest finisher, source 28, but no IBD link was found). In
checking: the Internet Archive holds scanned copies of both Minervini books, but they are loan-only and their
search-inside refused an anonymous client, so the 2017 quotes stay unverified; the contest's 2022 press release on
Business Wire refused the client (HTTP 403), so the contest's own archived standings page was used instead.

## 12. Examples (from our data)

Scan of 2026-11-09 over the sandbox's daily bars (2,630 names that ever met the house liquidity rule, 2000-01-03 to
2026-11-04), scripts in `scratchpad/setups/06-vcp/` (`vcp_rule.py`, `chart.py`). **The rule, in one paragraph:** the
base starts at a left-side high (a backward running maximum of the highs over the last 130 sessions, at least 15
sessions before the buy); contraction T1 runs from that high to the lowest low after it, T2 from the highest high after
T1's low to the lowest low after that, and so on; a T counts only if at least 2% deep and 3 bars long; the pivot is the
final T's high and no bar after the final T's low may have traded above it (the buy day is the first through). On the
close before the buy: Minervini's Trend Template (8.1 line 1), at least 30% above the 52-week low, prior advance of at
least 30% (base high against the lowest low of the 126 sessions before it), 2 to 6 Ts, each T at most 0.75 times the
previous, first T 10% to 40%, final T 10% or less, final T's low above the base low, final-T average volume below the
first T's and below the 50-day average with one day at or under half the 50-day average, no down day in the right half
of the base on 1.5 times average volume or more, close at least $10 and 50-day dollar volume at least $20 million (B23),
close no more than 10% above the 10-day average (C29), and a 126-day return above SPY's (the sandbox has no RS ratings,
so this stands in for C31). Buy: a market order the moment price trades through the pivot (pivot + $0.01, or the open
if the stock opens above the pivot; E57), skipped if that is more than 4% above the pivot (C28). Stop: 5 cents under the
lower of the buy day's low and the prior day's low, within 6% of the entry (if wider, the buy day's low alone; A13 says
usually within about 3%, and the median here was 3.4%); no trade if the buy day's low is under the final T's low. One
hit per name per 30 sessions. Outcome: the first of stop, 3R or 5R over the next 80 sessions.

**Base rate (fixed stop, no trims, no breakeven move, no trail):** 2,989 hits; **29.0% reached 3R** and **18.5%
reached 5R** before the stop. 84.6% touched the stop at some point in the 80 sessions, because the stop in this test
never moves (a live trade would have taken thirds at 3R and 5R and moved the stop to breakeven, B19/E51). Breakdowns
worth teaching: hits with 3 contractions did better than hits with 2 (35.5% to 3R against 28.1%; the twelve 4-T hits,
50%, are too few to lean on); breakout-day volume of 1.4 times average or more did better (39.7% to 3R against 27.5%
below that, which supports 8.2 line 4 as a grade factor); and a close above the pivot on the buy day did much better
than a close back inside the base (36.9% against 18.9% to 3R; the "squat" of 8.4 line 5). The ratio gate of 0.75 is
strict: 2,649 of the 2,989 hits had exactly two contractions. These figures are from one scanner's reading of the
rules and are not a trading record.

**The 10 examples** (sheets and PNGs in `scratchpad/setups/06-vcp/final/`; each chart was looked at). "Ts" lists the
contractions deepest to shallowest; "buy" is the pivot (the fill was one cent higher unless noted); R uses that fill.

| # | Ticker | Buy day | Ts (depth) | Base | Prior run | Buy | Stop | Vol | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ON | 2017-08-30 | 19.4%, 7.8%, 5.8%, 3.5% | 11.4 wk | +50% | 16.47 | 15.85 (3.8%) | 1.7x | 9.0 (3R in 20 d) | Four contractions each about half the last, under a rising 50-day; the model footprint. |
| 2 | PHM | 2003-10-01 | 19.5%, 8.7%, 5.0% | 14.8 wk | +60% | 17.37 | 16.59 (4.5%) | 2.0x | 9.3 (3R in 16 d) | Clean three-step tightening over 15 weeks, volume dries into the pivot, 2x volume through it. |
| 3 | RNG | 2020-01-02 | 16.6%, 11.0%, 3.5% | 10.8 wk | +75% | 169.99 | 165.39 (2.7%) | 2.4x | 17.8 (3R in 5 d) | Final T under 4% riding the 10-day; final-T volume 0.46x the average; a 2.4x breakout; 5R in weeks. |
| 4 | JOYY | 2014-01-02 | 18.4%, 10.7%, 3.7% | 6.0 wk | +146% | 51.22 | 49.27 (3.8%) | 1.9x | 20.3 (3R in 1 d) | Short base after a big run; the pivot sits below the left-side high (56.75), exactly as Minervini allows. |
| 5 | REGN | 2012-08-23 | 26.0%, 6.8%, 4.2% | 16.6 wk | +193% | 139.56 | 133.96 (4.0%) | 1.6x | 8.8 (3R in 27 d) | A deep first leg then two tight ones; shows a leader's long base after a near-200% run. |
| 6 | MOG-A | 2026-05-26 | 20.2%, 11.7%, 7.1% | 11.8 wk | +86% | 322.21 | 311.97 (4.0%) | 1.9x | 9.5 (3R in 4 d) | Recent; fill at the open (325.06) because it gapped over the pivot; shows the open-above-pivot fill. |
| 7 | GXO | 2023-05-10 | 22.3%, 9.3%, 5.2% | 13.2 wk | +75% | 54.13 | 52.14 (3.7%) | 1.9x | 6.7 (3R in 9 d) | First base after a Stage 1 turn: the 200-day was still flattening at the base's start, rising by the buy. |
| 8 | NKE | 2018-05-15 | 10.0%, 4.8%, 3.5% | 10.8 wk | +40% | 69.42 | 68.06 (2.0%) | 0.7x | 10.4 (3R in 13 d) | A shallow big-cap VCP: 10% first leg, 2% stop. Breakout volume was light (0.7x), so a B grade on volume that still worked. |
| 9 | TRV | 2000-07-25 | 14.3%, 6.4%, 3.4% | 6.6 wk | +85% | 38.25 | 36.89 (3.6%) | 2.0x | 11.0 (3R in 1 d) | Oldest example; a 2x-volume breakout day that closed well above the pivot and never looked back. |
| 10 | SHOP | 2021-06-14 | 21.2%, 7.7%, 4.3% | 6.4 wk | +49% | 125.22 | 122.75 (2.0%) | 1.1x | 16.0 (3R in 1 d) | Pivot well below the February high: a VCP inside a larger correction; the stop was only 2% because the buy day's range was tight. |

All ten reached 5R. None of the ten pivots was above the base's left-side high (the scanner's `new_high` flag was false
for all ten): in each, the final contraction's high, not the base's high, was the buy point.

**Notable failures (same rules, stopped out):**

- **ALGN, 2007-10-17.** Two contractions (27.5%, 7.1%), 59-session base, 2.3x volume through the 28.64 pivot, but the
  day closed at 28.14, back inside the base (the squat). The next day's low, 27.64, took out the 27.70 stop. Best 0R. The
  lesson is 8.4 line 5: a breakout that closes back in the base is the warning sign with the worst numbers in this scan.
- **CMG, 2020-12-16.** Contractions 14.2% and 4.6%, 2.0x volume, closed above the pivot, so it looked like an A grade;
  it reached only 0.87R and fell to the stop 11 sessions later (2021-01-04). A failure with nothing wrong in the setup:
  the reason the stop, not an opinion, is the exit.
- **META, 2024-07-05.** Contractions 22.0% and 5.7%, 61 sessions, 1.4x volume, closed above the pivot at 539.91 against
  a 522.88 pivot; best 1.18R, then stopped 5 sessions later (2024-07-12, low 494.23). The stop was 3.2% under; the
  breakeven move (B19) would not yet have applied at 1.18R.
- **AXON, 2025-02-18** (a stop-placement lesson rather than a pattern failure). The stock opened above the pivot, so the
  fill was 694.02; the buy day's low was 691.86, so the day-low stop sat 0.3% under the fill. The next day gapped to a
  592.76 low, far through the stop, so B20 (the first 30-minute low becomes the stop; out past 2R) would have governed
  the exit. It is the case ChartMill's ATR floor (8.8 line 10) is aimed at, and a question for the owner (section 10).
- **CRWD, 2021-04-22.** First contraction 31.5%, closed back under the pivot (54.18 against 55.81), 5.1% stop; stopped
  after 5 sessions with a best of 0.34R. A deep first leg plus a squat: two of 8.5's warnings at once.

**Limits of this test.** Daily bars only, so "the moment price trades through the pivot" is modelled as pivot + $0.01 (or
the open) with no intraday confirmation; the RS gate is a 126-day return against SPY, not an RS rating; no earnings
filter (B22) was applied, and no market-condition filter (F65); the stop is fixed for 80 sessions, so the base rate
understates what the house trims and breakeven move would produce and overstates how often a live trade would be stopped
after a win. Splits are adjusted in the sandbox; MOG-A is Moog's class A share, a stock, not an ETF. The scan finished
the whole universe (2,630 of 2,630 names) in 162 seconds.

---

---

## Removed in checking

Cold check of 2026-11-09. All quotes held word for word; the changes below are claims that were wrong, overstated or
mis-attributed. Each was fixed in place where the truth could be found, or removed.

**Removed (not true as written):**
1. "Ryan Pierpont ... Treat it as invented until someone shows a source" (5.5). He is real: third in the 2021 U.S.
   Investing Championship stock division at +201% (the contest's archived standings, source 28). What stays unsourced
   is the scanner's claim about his "Investor's Business Daily methodology".
2. "I did not find the contest's own record of the 2021 result" (section 2). Found: +334.8%, source 28. The section
   now uses the contest's number instead of TraderLion's rounded 334%.
3. Minervini "sells into strength" as a 2013 Minervini criterion (comparison table and section 7). Not in any
   Minervini text read; it is TraderLion's description of his 2021 trading. Re-labelled as TraderLion's.
4. System D "emits no stop or entry" (5.2). It emits a `pivot`, and puts it at the top of the base, not at the final
   contraction's high. Added, with the missing fact that System D has no final-contraction depth cap.
5. "[source consensus: ChartMill, Systems A and D]" on the 10% final-contraction rule (8.1 line 8). System D has no
   such rule, and our own engines are not sources. Re-tagged as ChartMill plus Minervini's examples.
6. Chart IQ as a "source" in the higher-lows consensus tag (8.1 line 9). Replaced by Kullamägi's related setup.
7. The 2017 book's wording "matches" the 2013 blog (3.3). It gives the same numbers in different words; the claim that
   this supports the transcription was dropped.
8. "a live Study item" (5.4). The repo file marks it `review_status: "draft"`, and only approved items are served.

**Corrected (detail was off):**
9. The scanner's target is pivot + (pivot − first contraction's low), not "pivot plus the first contraction's height"
   (5.1).
10. `make_levels` is used by 19 of 43 detectors (the `uct_*` family), not by "the other UCT detectors" generally (5.4).
11. The owner's section heading is "Patrick (TSDR)'s Weekly Outlook & Watchlist" ("&", not "and") (section 6).
12. The two "Intro" quotes were filed as the owner's words; the intro is unsigned. Now marked as such (section 6).
13. "He uses index/ETF VCPs" and "looking to get exposure prior to that" were credited to the owner; both come from
    the Index & ETF section, whose writer is not named (section 6).
14. "Systems A and D agree ... 39% in another": the 39% counts 25 cases where both said no. Replaced with the plain
    counts and a newer production count (386 vs 58, 6 shared, 2026-10-15) (4 and 5.5).
15. "the technical footprint: deepest/last contraction" for Minervini's notation: his repo example explains it as the
    first and last contraction; "deepest" is ChartMill's reading (section 2).
16. ChartMill's "table of ten trades" is a worked sum in the text, not a table (section 4).
17. Bulkowski's "failure rate" is his "5% failure" column; named as such (section 4).
18. "Kullamägi uses the same 10 and 20-day trail": the house uses the 10 and 21-day, he uses the 10 or 20-day (8.4).
19. House rule A1 is 0.25% to 1.5% by grade with a 2% ceiling, not a flat 0.25% to 1.5% (section 7).
20. TraderLion's targets were marked "n/s"; the page says "aiming for gains of 15% or more" (3.6 and the table).
21. The grading table credited "3 to 4 Ts is A+" to Minervini 2013; neither he nor ChartMill ranks 3 to 4 above 2. Now
    marked as a proposal (section 9).
22. The "trapped holders" point in section 1 was presented with the sourced reasoning; it is now split into
    ChartMill's sentence and my inference.
23. Labels added where the writer's own choices were inside a house-rule tag: the 50-day window for B23, and the
    "if the buy comes early" prior-day-low condition (8.1, 8.3, section 7).

**Added in checking:** Minervini's second blog example (25%, 10%, 5%) that the "0.40 to 0.60" ratio range depends on;
the 2014 blog's "2012" credit line for the 2013 book; ChartMill's flat-base row and cheat-entry definition; Chart IQ
relabelling a failed strict VCP as a flat base; the ATR floor-versus-ceiling conflict (8.8 line 10, question 3); the
three VCP-mentioning Substack posts the first pass did not quote; sources 28 and 29.

## 13. Failures and near-misses (from our data)

Charts in `_study-resume/scratchpad/setups/06-vcp/final/`: `fail_1-4.png` (the four failures, one column),
`near_1-4.png` (the four near-misses), `pair_01-flat-base.png` (a VCP above a flat base). Every chart carries the
same buy point, stop, 3R and 5R lines, the base box and the T1..Tn marks the winners carry. Numbers are read off the
daily bars; "N sessions later" counts from the day after the entry day.

**Four failures (every rule in section 12 passed; the stop was hit before 3R).** All four are the ones section 12
names; AXON 2025-02-18 (the 0.3% stop under a gap) was left out as a stop-placement case rather than a pattern failure.

| # | Ticker | Trigger | Buy / stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| 1 | ALGN | 2007-10-17 | 28.65 / 27.70 (3.3%) | 1 session later, 2007-10-18, low 27.64 | Two contractions (27.5%, 7.1%), a 59-session base, 2.3x volume through the 28.64 pivot, but the day closed at 28.14, back inside the base and in the lower third of its range; the next day's low took the stop. Best 0.0R. | vcp.squat (a breakout that closes back in the base) |
| 2 | CMG | 2020-12-16 | 27.60 / 26.32 (4.6%) | 11 sessions later, 2021-01-04, low 26.25 | Contractions 14.2% and 4.6%, 2.0x volume, closed above the pivot mid-range: an A grade on its face. It reached 0.87R and drifted to the stop 11 sessions later. | vcp.after_entry_stop (nothing in the setup was wrong) |
| 3 | CRWD | 2021-04-22 | 55.82 / 52.95 (5.1%) | 5 sessions later, 2021-04-29, low 52.10 | A 31.5% first contraction (inside the 40% ceiling, but deep), 1.2x volume, and a close back under the pivot (54.18 against 55.81); a 5.1% stop, hit five sessions later at a best of 0.34R. | vcp.inv_first_t_deep (a deep first leg plus a squat) |
| 4 | META | 2024-07-05 | 522.89 / 505.97 (3.2%) | 5 sessions later, 2024-07-12, low 494.23 | Contractions 22.0% and 5.7%, 61 sessions, 1.4x volume, closed above the pivot near its high; best 1.18R, then a five-session fade through the 3.2% stop (low 494.23). | vcp.breakeven (B19 would not yet apply at 1.18R) |

**Four near-misses (each looks like a VCP and fails exactly one gate of the card).** Found by re-running the section
12 scan with every gate relaxed and keeping the candidates that fail one and only one gate; the 420-second budget
covered 1,367 of the 2,630 liquid names (a shuffled half), enough for four clean cases. Volume dry-up was the gate
most often missed on its own (1,853 of 3,762 single-gate near-misses), then a heavy-volume down day on the right side
(546) and a first contraction under 10% (412).

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | CAT | 2010-01-11 | vcp.ratio | T2 9.0% is 0.79x T1 11.5%; the rule needs 0.75x or less | Two pullbacks of almost the same size (11.5%, 9.0%): a wide and loose base, not a contraction. Reached 1.26R, then stopped. |
| 2 | BIIB | 2014-05-28 | vcp.final_t | final contraction 11.5%; the rule allows at most 10% | A 24% first leg and a 12% second leg: the final pullback is still too wide to be the tight last T a VCP needs; a loose cup. Best 1.87R. |
| 3 | AMZN | 2020-08-06 | vcp.volume_dry | final-T volume 1.13x the 50-day average, 0.89x the first T's, quietest day 0.81x; the rule needs below 1x, below the first T and a day at 0.5x or under | Two shrinking pullbacks (14%, 4%) but no dry-up: the final leg traded above the 50-day average volume with no quiet day. Stopped at a best of 0.0R. |
| 4 | UNH | 2021-08-04 | vcp.first_t | first contraction 9.1%; the rule needs 10% to 40% | A 9% first leg: a base too shallow to contract from; by Minervini's own waiver it is a flat base, judged by the flat-base rules. Best 0.0R. |

**What the failures have in common.** Two of the four (ALGN, CRWD) closed back under the pivot on the breakout day,
the squat that 8.4 names as the worst sign in the scan, and both were out within five sessions. The other two
(CMG, META) did everything right on the day, closed above the pivot, reached 0.87R and 1.18R, and still came back to
the stop in five to eleven sessions: a VCP's tight stop (3.2% to 5.1% here) sits inside normal noise, which is why
the base rate shows 85% of hits touching the stop at some point. The base itself was not the problem in any of the
four; the first leg was deep on CRWD (31.5%) and the breakout volume light on CRWD (1.2x) and META (1.4x), both grade
cues, not gates. The learner's read: the squat is the one sign to act on the same day; after a good close the stop is
the exit and nothing else, and a loss on a correct VCP is the cost of the next ON or SHOP.
