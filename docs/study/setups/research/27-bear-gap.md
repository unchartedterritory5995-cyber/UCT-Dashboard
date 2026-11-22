# Setup 27: Bear gap (short), the app's "Bear Gap off the Highs"

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
file or post named next to it and kept to 40 words or fewer; the UCT and outside quotes were checked word for word by a
script against the saved page text. Cold-checked the same day by a second reader against fresh copies of every source
(each Substack post through its public post API, the outside pages by plain download or, for Bulkowski, the fetch
tool), the repo files and the bars; what changed is listed under "Removed in checking" at the end. A second cold check
later the same day repeated all of that from scratch (fresh API copies of all 103 posts, fresh downloads of the outside
pages, Bulkowski through the fetch tool, every bar fact recomputed from the sandbox `bars.db`, the test tables re-derived
from the saved event files); its findings are the last subsection of "Removed in checking". Nothing here is a
ruling. Where I could not read a source, I say so and give no wording from it. Numbers marked [my proposal] are mine,
for the owner to accept or change.

Tags used in section 8: **[originator]** the author of a named neighbouring setup in his own words (Fleckenstein's
gap-down short, Qullamaggie's parabolic short; nobody originated "bear gap off the highs"); **[source consensus]** at
least two outside sources agree; **[one source]** a single outside source, named; **[UCT]** UCT's own writers or the
owner; **[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my
recommendation; **[measured]** my own test in section 4.3.

Two flags before reading:
- Thomas Bulkowski's site (thepatternsite.com) states that it "shall not be used to train artificial intelligence (AI)
  systems". I read and cite it here for research, with links and short quotes only. His quotes came through a fetch tool
  (his server refuses plain requests), so they are as that tool returned them.
- `docs/wisdom/vocabulary/setup-vocabulary-v1.json` keeps Sunday Scans text out of the public repo because "many Sunday
  Scans excerpts are golden-set text". This dossier quotes short Sunday Scans excerpts because the task asked for UCT's
  words quoted exactly. Question 13 asks whether that is acceptable.

**The short version.**
- In UCT's own writing, a "bear gap" is mainly a **level**: an open gap down left above price that acts as resistance
  until it is filled. The vocabulary file files "Bear Gap" as kind "level" with the alias "bear gap resistance". The
  owner uses "bear gap off highs" mostly as a warning on stocks he owns or wants to buy (BE, MRNA, SNDK), not as a short
  signal.
- No outside source defines a setup called "bear gap off the highs". The nearest named setups are Loren Fleckenstein's
  "gap-down short" (TradingMarkets, 2000), the "bearish breakaway gap" (StockCharts ChartSchool), Bulkowski's event
  patterns (bad earnings surprise, dead-cat bounce), Pradeep Bonde's "earning torpedo" short (Stockbee, 2007), Oliver
  Kell's "gap down Wedge Drop" (TraderLion pages under his byline, 2024), and Bracco's "day 2 gap down" variant of the
  parabolic short (UCT).
- The app's rule (a true gap down of 5%+ on 2x volume that closes 6%+ down, the first since a recent 250-day closing
  top) is a first draft. The owner saw 8 of its 39 charts on 2026-10-31: 1 kept (MPWR, "Good"), 7 cut, three as "more
  of just an earnings breakdown" and the founding NFLX chart with "Okay this is stupid". The phrase "the first gap down
  from a top" and the NFLX example came from the reviewer's notes, not from him. The definition is still open.
- The app's gates also miss most of the bear gaps off highs UCT itself named: BE, GLW, MRNA, TSLA and both of SNDK's
  were not full daily gaps, several had under 2x volume, GLD's was under 5% (section 6.7).
- **Is it a short setup? Not proven.** On 988 liquid US stocks, 2005 to 2026, daily bars, managed by the house rules
  mirrored for a short, the app's rule earned about zero per trade (-0.02R; random shorts with a 4.2% stop: -0.09R).
  One slice did better: earnings collapses straight off a fresh high, shorted at the gap day's close with the stop over
  the gap day's high (+0.36R, 95% range +0.11R to +0.62R). That is the slice the owner cut as "earnings breakdown", most
  of it sits above the 200-day (B26), and it was one of about 40 slices tested. The owner's own short tactic (a bounce
  into the 20-day or 50-day, rejected) and the Fleckenstein entry also came out near zero in this crude daily test.
- House rules bite hard: 61% of the app's events close above the 200-day on the gap day (B26 forbids those shorts unless
  parabolic); the natural stop over the gap day's high has a median of 4.2% (A13 says about 3%); 43% of gap-day closes
  are more than 10% under the 10-day average (the C29 mirror would skip them).
- Recommendation: teach the bear gap first as a **level lesson** (what the gap zone is, why it is resistance, what
  filling it means). Teach it as a short only in two house-consistent forms, both pending his own charts: **Version R**,
  the retest short below the 200-day (his own words: "a decent pop back up and rejection coinciding with the 50SMA or
  20EMA"), and **Version P**, Bracco's day-2 gap-down parabolic variant at smaller size (the B26 parabolic exception,
  if he rules that it covers this variant; question 5).
- Three things in our app look wrong or inconsistent (section 5.6): the course text and the chart overlay emphasise
  different lines; the levels evidence replay counts the gap day's own low as profit on close entries; the finder's
  hard gates do not match UCT usage.

---

## 1. What it is, and the psychology

**In two sentences.** A bear gap is a stock opening below the prior day's range (or at least well below the prior
close) and leaving an unfilled gap above it; "off the highs" means it happens at or near a recent top, often on news,
so the gap marks the first serious break of an uptrend. As a level, the gap zone (from the gap day's high up to the
prior day's low) becomes resistance; as a short, the trade bets that the gap stays open and the stock keeps falling or
fails on its first bounce back into the gap.

**Who is trapped, and why it can work.** These points are my reasoning from the sources, not measured facts.
- Every buyer from the prior days is under water at the open. Near a top that is a crowd: breakout buyers, late chasers
  and funds that added near the highs. Bracco (UCT) on the day-2 variant: "The gap down the following day is key, as
  longs from the previous close are underwater and short sellers take advantage."
- Those holders sell into bounces back toward their cost. That is why the gap acts as resistance. Schaeffer's: "The same
  phenomenon can occur with bear gaps, as the underlying equity becomes unable to hurdle through the gap zone."
  ChartSchool on breakaway gaps: the breakout point "becomes the new support (if it's an upside breakout) or resistance
  (if it's a downside breakout)". Fleckenstein calls these holders "weak holders" under "overhead supply".
- Big holders cannot sell in one day. When the news is real (an earnings miss, a guidance cut), institutions keep
  selling for days or weeks. Academic studies find drift after news-driven drops: Chan (2003): "I find evidence of
  post-news drift, which supports the idea that investors underreact to information.  This is strongest after bad news."
- Stockbee names the best case: "If you find it on high growth stocks, which has been bid up a lot and is the darling of
  big funds, you get one smooth ride short."

**Why it often fails (also reasoning, plus the house's own experience).**
- Dip buyers step in. In Bulkowski's dead-cat bounce sample (one-day drops of 15% to 70%) the average bounce was 28%
  over 23 days (section 4.1); Larry Connors reports that buying large one-day drops, as a whole, does not work (section
  3.12), so the two do not agree on how reliable the bounce is. The owner himself has a long setup built on the
  opposite read: "Prime example of the PLTR May 2025 3 day gap down earnings reversal on a leading stock." And: "This
  is one earnings setup I use on leading names early on in a market recovery." (Sunday Scans, 2026-05-03)
- No-news shocks reverse. Savor (2012): "price events accompanied by information are followed by drift, while
  no-information ones result in reversals."
- Shorting after a big fall is shorting into the hole, and it is hard to sit in. The owner, on the selling of early
  November 2026: "Often hard to not feel like you are shorting the hole when we get big massive moves like this to the
  downside and barely anything on the one day pops." (2026-11-08; in that week the pops were small, so the quote is
  about how it feels, not about squeezes.)
- The natural stop is far away. A gap-down day has a wide range, so the stop over its high sat a median 4.2% over the
  close in my test, and up to 25% (VRNS 2025-10-29: 25.0%, the high 40.41 over the close 32.34, checked on the bars).
  TRADE_PLANS.md uses VRNS as the reason no trade was defined.

---

## 2. Origin and naming

**No originator for "bear gap off the highs".** I found no book, newsletter or post that defines a setup by that name.
It is the owner's phrase from one review note: "Don’t want to do downtrend gaps but will do bear gaps off the highs"
(2026-10-27, `owner_verdicts.jsonl` lines 212 and 216, said while cutting NFLX 2022-02-07 from Gap Support).

**"Bear gap" as a term.**
- General market slang for a gap down. Schaeffer's Investment Research titles a lesson "Bull Gaps and Bear Gaps" and
  treats bear gaps as resistance (section 3.9). The page shows no author or date (footer: 2021).
- In UCT's writing, "bear gap", "bearish gap", "open bearish gap", "bear gap resistance" and "bear gap off highs" appear
  46 times in 33 of the 103 posts listed in the Substack sitemap (one of the 103 is subscriber-only). Almost all are
  levels on index or stock charts (section 6).

**The textbook names for the same event.**
- **Bearish breakaway gap.** StockCharts ChartSchool, "TA 101, Part 15" (Chip Anderson, ChartWatchers, 2009-11-07): "A
  bearish breakaway gap forms when a security gaps down after an extended advance, an extended top or a consolidation
  period." ChartSchool's strategy page notes the four classic gap types are what "most technical analysis manuals
  define". I did not trace the classification to an original book.
- **Falling window.** The Japanese candlestick name for a gap down (Bulkowski: "Find a pattern in which yesterday's low is
  above today's high."). It is usually credited to Steve Nison's candlestick books; I did not read them, and Bulkowski's
  page credits no one, so treat that credit as unverified.
- **Island top.** A gap up, a short "island", then a gap down at the same prices (Bulkowski; UCT's Index & ETF section
  warned of one on the QQQ in November 2025).
- **Event patterns.** Bulkowski's "Bad Earnings Surprise" and "Dead-Cat Bounce" pages measure what large one-day drops
  do next.

**Named short setups that use a gap down.**
- **"Gap-down short"**, Loren Fleckenstein, TradingMarkets, 2000-10-14 (section 3.1). The clearest published rule set.
  It wants a stock already in a downtrend, which is the opposite of "off the highs".
- **"Earning torpedo"**, Pradeep Bonde, Stockbee, 2007-02-28 (section 3.5). A growth darling that misses. The term is
  older than his post: the post itself points to an "Earnings Torpedo Warning list" at the University of Michigan's Ross
  School of Business, and the phrase is in the title of Skinner and Sloan's paper (SSRN 1999, journal 2002; section
  3.12).
- **"Day 2 gap down"** variant of the parabolic short, Bracco, UCT, 2025 (sections 3.7 and 6.2). The only UCT-named short
  that starts with a gap down off a high.
- **"Gap down Wedge Drop"** (Oliver Kell, TraderLion pages under his byline, 2024; section 3.11). His Wedge Drop is a
  break back under the moving averages after a run; two of his examples start with a gap down from highs (DECK 2021,
  TMDX 2023). Read through archive copies (the live pages refuse plain requests).

**Names in our app.** "Bear Gap off the Highs" (finder, overlay, owner log), "Bear gap" (course, Hard mode), skill id
`setup.family3.bear_gap`. No Model Book card, no journal tag (section 5.4).

---

## 3. Every definition I could find, source by source

### 3.1 Loren Fleckenstein, "Shorting Down Gaps", TradingMarkets, 2000-10-14 (named setup; read in full)

URL: https://tradingmarkets.com/?p=667535. The most complete rule set found. Quotes:
- Context: "Candidates for the setup are stocks already in major declines before gapping down on negative fundamental
  news." And: "You short after the gap-down once you detect evidence that the gap-down move, rather than exhausting the
  decline, is turning still more shareholders into sellers."
- Size: "The gap-down move should represent a severe price decline relative to the stock’s daily trading behavior." (No
  formula: "A eyeball judgment will do.")
- Prior trend: "The stock should already be in a downtrend just before the gap-down session or struggling in trading
  range after coming well off its lows."
- Averages: "The stock should close below its 50- and 200-day simple moving averages." (Before or on the gap day.)
- Catalyst: "The gap-down move should occur in response to negative fundamental news."
- Volume: "On the day of the gap-down move, trading activity should swell to at minimum double that of the stock’s
  average daily volume." And: "I use volume averaged over the past 50 sessions."
- Close: "The stock should close in the lower half of the day’s trading range."
- Support: "The gap-down move should break through past support."
- Market: the stock's major index "should should be in a downtrend" (sic).
- Entry: "The short seller should wait for the bounce to occur and exhaust itself, then short after the stock resumes its
  decline." If the decline resumes next day: "If it does, the pivot point is 1/8 point below the intraday low of the
  gap-down session." A slower bounce still qualifies "provided the gains are meager relative to gap-down loss and come on
  declining volume relative to the volume of the gap-down session."
- Stop: "In a perfect world, I would set my stop a tick above the intraday low of the session before the gap-down day or a
  defined support level that was broken by the gap-down move". He warns: "because of the possibility of short-covering
  rallies, you must be prepared to give short sales much more room." His sizing illustration (a hypothetical XYZ, not
  one of his examples) uses a 20% stop with a smaller position: "The greater the risk, the smaller the position." If the
  gap is too big for the structural stop, he moves the stop down to "a credible volatility envelope" or skips.
- Targets: none given.
- Examples: INTC 2000-09-22 (down 22%, 7x volume), AAPL 2000-09-29 (down 52%), PCLN 2000-09-27.

### 3.2 StockCharts ChartSchool: "TA 101, Part 15" (Chip Anderson, 2009-11-07) and "Gaps and Gap Analysis" (read)

- Definition of a down gap: "A down gap is the opposite of an up gap; the high price after the market closes must be lower
  than the low price of the previous day."
- Volume: "Up and down gaps can form on daily, weekly, or monthly charts and are considered significant when accompanied
  by above average volume."
- The bearish breakaway gap: "A bearish breakaway gap forms when a security gaps down after an extended advance, an
  extended top or a consolidation period."
- Resistance: the breakout point "becomes the new support (if it's an upside breakout) or resistance (if it's a downside
  breakout)." And: "Avoid falling into the trap of thinking this type of gap, if associated with good volume, will be
  filled soon."
- Exhaustion gaps are the opposite case: "Exhaustion gaps are quickly filled as prices reverse their trend."
- A caution in TA 101: "However, gaps have little to no influence on price action weeks or months after forming."
- No entry, stop or target. The gaps page shows no author or date.

### 3.3 StockCharts ChartSchool, "Gap Trading Strategies" (read; no author or date shown)

- "Full Gap Down: Short": "If a stock's opening price is less than yesterday's low, revisit the 1-minute chart after 10:30
  AM and set a short stop equal to two ticks below the low achieved in the first hour of trading."
- Exit: "Once a position is entered, you calculate and set an 8% trailing stop to exit a long position, and a 4% trailing
  stop to exit a short position."
- End of day: "Similarly, a short position would be signaled by a stock whose gap down fails support levels."
- It is an intraday method with a one-hour opening range and no trend filter (it only advises checking the longer-term
  chart for support and resistance). Its one volume rule belongs to the "Modified Trading Method" variant: "the stock
  should be trading on at least twice the average volume for the last five days" (added in the second check; this is
  the "2x for one variant" in the table).
- Added in checking: the same page defines the weaker kind of gap that most of UCT's named bear gaps are (section 6.7):
  "A Partial Gap Down occurs when the opening price is below yesterday's close, but not below yesterday's low." Its
  "Full Gap Down" is an open under the prior day's low, a looser test than the gaps page's down gap (the whole day's
  high under the prior low).

### 3.4 Thomas Bulkowski, thepatternsite.com (measured patterns; read through a fetch tool; AI notice applies)

- **"Bulkowski on Price Gaps"** (updated 8/8/25): breakaway gap: "Starts a new trend and the gap often occurs on leaving a
  consolidation area, usually on high volume on the gap day, which can continue for several days." On levels: "Gaps are
  places of weak support or resistance, but you can use them for a stop location." Stop: "Place a stop a few cents below
  the gap (upward breakouts) or above the gap (downward breakouts)." Statistics in section 4.1.
- **"Falling Window"**: "Two." candles; trend "Downward."; "Find a pattern in which yesterday's low is above today's
  high." Statistics in 4.1. Note his trend rule is a downtrend into the window, not a top.
- **"Island Reversals"** (statistics updated 8/26/2020): tops have "price trending upward to the island"; "Two gaps must
  share some or all of the same price."; volume "High on the day price makes the second gap."
- **"Bad Earnings Surprise"**: trend: "Downward leading to the announcement for the best performance." Swing: a large
  intraday swing, "2 or 3 times the average daily intraday price range" "over the last month." Location: "For best
  performance, select announcements that occur within a third of the yearly low." Trigger: "A breakout occurs when price
  closes below the lowest low posted on the announcement day." Shorting: "For aggressive traders: In a bear market, wait
  for the downward breakout and then short the stock." Note: best near the yearly low, which is the opposite of "off the
  highs".
- **"Dead-Cat Bounce"** (updated 7/29/25): "Price usually gaps downward, closing 15% to 70% lower than the prior day."
  Tactics: "For experienced traders, short the stock at the top of the bounce and ride price lower." And: "Expect price to
  drop to at least the event trend low."
- **"Opening Gap Trading Setup -- Short Side"** (updated 12/25/16): an intraday fade of an UP gap. Not this setup; listed
  only so it is not confused with it.

### 3.5 Pradeep Bonde (Stockbee), "How to find high probability shorts", 2007-02-28 (read)

URL: https://stockbee.blogspot.com/2007/02/how-to-find-high-probability-shorts.html
- Priority: "Unless there are no compelling longs I don't look at shorts."
- The idea: "Essentially you must find a earning torpedo." And: "If you find it on high growth stocks, which has been bid up
  a lot and is the darling of big funds, you get one smooth ride short."
- Catalyst: "Catalyst is extremely critical on short side, otherwise usual corrections are quickly bought." But: "A mere
  miss on earnings may not be best short strategy." He wants a run of strong quarters, then a collapse in growth.
- Lists: "Episodic Pivots: Here you are again primarily looking for earnings miss or regulatory trouble." For his
  "Trouble after Double" list (stocks that doubled): "On this list I look for 4% down moves for entry."
- Float (for borrow, which he calls "availability"): "So most of the time by choice I concentrate my shorting efforts
  on 100 million plus float stock."
- Where the idea comes from, in his words: "The central concept behind most of my short ideas is based on the post I
  made some time ago - Earnings expectations and Cinderella Strategy." He also names an "Earnings Torpedo Warning
  list" maintained by the Ross School of Business at the University of Michigan (section 3.12 for the earlier paper
  with the term in its title).
- No stop or target in this post. I found no Stockbee post in his own words defining a "negative EP" short; secondary
  sites describe one, and I do not use them.

### 3.6 Kristjan Kullamägi (Qullamaggie), "3 TIMELESS setups...", qullamaggie.com, 2021-01-08 (read)

Not a gap-down setup. It is the parabolic short, cited here only for short mechanics:
- Entry: "When you think you have identified a candidate you can short on the opening range lows (1-minute, 5-minute
  candles)."
- Stop: "The stop is highs of the day or if VWAP fail, a reclaim of the VWAP."
- Target: "The target area is the 10- and 20-day moving averages, that’s where these stocks usually bounce."
- Timing: "Don’t be too early. WAIT for the right setup. Let the amateur shorts get run over, that’s where your edge comes
  in."

### 3.7 Bracco (UCT), the "day 2 gap down" variant of the parabolic short (house; details and links in 6.2)

- Shape: a parabolic burst; on the climax day the stock sells off intraday but closes "near the middle or high of the
  day’s range" (a "hanging man" or "Doji" at the high). "Then the stock gaps down the next day, and that is usually the
  nail in the coffin."
- Entry: "Usually any opening range breakdown and failure to fill the gap begins the backside of the move and can be
  traded back to the daily 9EMA."
- Stop: not stated for this variant. For his main parabolic short he sets the initial stop at the day's high ("setting
  my initial stop at the day’s high") and then trails the previous 5-minute bar's high.
- Size: "Any other variation may be taken with smaller size." (2025-12-28)
- What the variant lacks (added in checking): his main setup requires a gap up on the climax day ("I won’t short
  without that gap-up."), and his burst checklist ends with that gap up. In the day-2 variant the climax day does not gap
  up and close under its open; it sells off intraday instead. Of this variant he writes: "I do not typically engage in
  this setup for reasons stated above".
- His examples (climax dates): DJT 10/29/2024, FUTU 10/7/2024, TASR (now AXON) 4/19/2004, TSLA 2/4/2020, CGC 2/10/2021,
  UVXY 8/5/2024.

### 3.8 QuantRocket, "Should You Buy or Sell Stocks that Gap Down?", Brian Stanley, 2020-09-02 (read)

- An intraday backtest. Screen: common stocks, top 10% by dollar volume, closed above the 20-day average; then an open at
  least one standard deviation below the prior low. Hold from 1 minute after the open: "I buy the stocks 1 minute after
  the open and hold until the close".
- Shorting instead: "I reverse the rules and indeed find a profitable strategy. From 2014-2020, the Sharpe ratio is 1.30
  and the annual return is 10%:"
- Conclusion: "Stocks tend to recover after small down gaps and keep dropping after large down gaps." And: "The strategy
  works better on large-cap stocks than on small-cap stocks."
- A same-day trade, not a swing. Results in 4.1.

### 3.9 Schaeffer's Investment Research, "Learn Technical Trade Drivers: Bull Gaps and Bear Gaps" (read; no date)

- "The same phenomenon can occur with bear gaps, as the underlying equity becomes unable to hurdle through the gap zone."
- A level, not a trade. No rules.

### 3.10 IBD / William O'Neil (not readable; search excerpts only)

- investors.com refused my reader and its syndicated copy (inkl) showed a bot check. Search-engine excerpts of an IBD
  article ("This Trading Rule Helped Investors Avoid Big Declines In Netflix, Super Micro, Tesla"; inkl's listing names
  Scott Lehtonen as the writer, not confirmed on investors.com) describe O'Neil's sell rule: after an extended advance,
  the stock's biggest one-day drop since the move began, used with other signals; their example is Netflix in July 2023.
  I did not read the article, so I quote nothing from it. On our split-adjusted bars the Netflix day is 2023-07-20: it
  opened 6.4% lower and closed 8.4% lower, its largest one-day percentage drop since 2022-12-15 (which fell 8.6%; by
  points, the largest since 2022-04-20), and it is a true gap down that the app's bear gap rule fires on (top one session
  earlier, 3.3x volume, above the 200-day). It is a sell rule for longs, not a short rule.
- Not read (O'Reilly refused the request; only catalogue listings were seen): William J. O'Neil with Gil Morales, "How
  to Make Money Selling Stocks Short" (Wiley; retail listings give December 2004 and January 2005); Gil Morales and
  Chris Kacher, "Trade Like an O'Neil Disciple" (Wiley, 2010; the catalogue listings reached in the second check show
  six chapters, the last "Riding the Bear Wave", and no section called "The Golden Rules of Short-Selling", which the
  first check had reported from a listing, so that title is unconfirmed); and their "Short-Selling with the O'Neil
  Disciples" (Wiley, 2015). No rules from them are used.
- Not read either: Stan Weinstein, "Secrets for Profiting in Bull and Bear Markets" (1988). Added in the second check
  as a lead, not a source: the owner's "Stage 3 topping action" and "stage 4 downtrend" (6.1) and the Index & ETF
  section's "stage 3 ish failed base" (6.3) are Weinstein's stage vocabulary, and his short-selling chapter is the
  natural outside reference for Version R (a short below a falling long-term average). Nothing from it is used.

### 3.11 Oliver Kell, Wedge Drop (TraderLion, under Kell's byline; read through archive copies)

The live TraderLion pages refuse plain requests (HTTP 403); the Internet Archive copies read fine. The pages carry Kell's
byline (page metadata: author Oliver Kell, published 2024-07-11 and 2024-08-11) but are written in the third person
(the Wedge Drop page: "Oliver Kell sees the Wedge Drop as a key signal that an uptrend is over."), so they are
TraderLion's account of his method. The second check could not reach the archive (it refused the requests as bot
traffic) or the live site, so the quotes below were re-checked against the first check's saved archive copies.
- "Wedge Drop: How to Sell Short" (2024-07-11): "The Wedge Drop happens when the market trades back below the moving
  averages after a strong rally, known as an Exhaustion Extension." Short mechanics: "As the price breaks below moving
  averages with increased selling pressure, you can enter a short position with a stop just above the recent high."
- "Downside Base n’ Break: A Guide to Short Selling" (2024-08-11), the gap-down examples: "A gap down from highs,
  followed by a Wedge Drop marked the 2021 top for DECK." And: "TMDX chopped around near highs through most of 2023
  until a gap down Wedge Drop confirmed a downtrend." The page gives no dates for those gap days.
- The same page: "When a stock is below the declining moving averages it is best avoided as finding the bottom can be
  very costly." (About buying such a stock, not about shorting it.)
- What it adds for us: the nearest outside wording to "bear gap off the highs" ("a gap down from highs"), and it ties
  the gap to the stock losing its moving averages, the sign that the uptrend is over. No size, volume or gap
  definition is given.

### 3.12 Academic studies (abstracts only), and one practitioner note

- Wesley Chan, "Stock Price Reaction to News and No-News: Drift and Reversal after Headlines" (SSRN 2001; Journal of
  Financial Economics 70, 2003). Abstract: "I find evidence of post-news drift, which supports the idea that investors
  underreact to information.  This is strongest after bad news." Limits, also in the abstract: "They appear, however, to
  apply mainly to smaller stocks." And: "I also find evidence that trading frictions, such as short-sale constraints, may
  play a role in the post-bad-news drift pattern."
- Pavel Savor, "Stock returns after major price shocks: The impact of information" (Journal of Financial Economics 106,
  2012). Abstract: "Using analyst reports as a proxy, I find that price events accompanied by information are followed by
  drift, while no-information ones result in reversals."
- Bernard and Thomas, "Post-Earnings-Announcement Drift: Delayed Price Response or Risk Premium?" (Journal of
  Accounting Research 27, 1989): title and journal confirmed only; abstract not read.
- Added in checking, an earlier use of the "earnings torpedo" term Stockbee uses: Douglas Skinner and Richard Sloan,
  "Earnings Surprises, Growth Expectations, and Stock Returns or Don't Let an Earnings Torpedo Sink Your Portfolio"
  (Review of Accounting Studies 7, 2002; SSRN 1999). Abstract (SSRN): "We show that this phenomenon is explained by a
  large and asymmetric response to negative earnings surprises for growth stocks." ("This phenomenon" is the low
  realized return of growth stocks.) It supports Stockbee's best case, a crowded growth stock that misses.
- Added in checking, a practitioner note on the same question: Larry Connors, "Connors Research Traders Journal
  (Volume 24): Beware of Large One-Day Drops" (TradingMarkets, 2018-07-31). On buying large one-day drops: "As a
  whole, they don’t work." And: "you may have a better chance making money actually shorting those stocks for
  short-term trades". He cites Caporale, Gil-Alana and Plastun (Computational Economics, 2018) but gives no numbers
  in the post, so it is an opinion with a citation, not a statistic.

### 3.13 Our app's rule (for the table; details in section 5)

A true gap down (gap day's high under the prior day's low), open 5%+ under the prior close, volume 2x the prior 50-day
average, close 6%+ down, a 250-session closing top within the prior 80 sessions, the prior close within 30% of that top,
and no earlier 3%+ gap down since the top. No entry, stop or target.

### 3.14 Comparison table

| | Fleckenstein 2000 | ChartSchool (TA 101, gaps) | ChartSchool strategies | Bulkowski (bad earnings / DCB / window) | Stockbee 2007 | Bracco day-2 (UCT) | QuantRocket 2020 | Our app (first draft) |
|---|---|---|---|---|---|---|---|---|
| Prior trend | already in a downtrend, or a range "well off its lows" | "extended advance", "extended top" or consolidation | none | downtrend into the event works best | a growth darling "bid up a lot" | a parabolic burst | above the 20-day average | a 250-day closing top within 80 sessions; prior close within 30% of it |
| Location | below the 50 and 200-day by the gap close | off a top or range | none | near the yearly low is best (bad earnings) | near highs (implied) | at the high | uptrend | near the highs |
| Gap definition | a "severe" gap, by eye | high under the prior low | open under the prior low (full gap) | DCB: closes 15% to 70% lower | not stated | gaps down "the next day" | open 1 std under the prior low | high under the prior low, open -5% or more |
| Volume | 2x the 50-day average | "above average" | not stated (2x for one variant) | high on breakaway gaps | not stated | not stated (burst has rising volume) | not used | 2x the 50-day average |
| Close | lower half of the range | not stated | not stated | not stated | not stated | not stated | n/a (same day) | down 6% or more; close position scored, not required |
| Catalyst | negative fundamental news | not required | not required | earnings (that page) | an earnings collapse | not required | not required | not required (earnings flagged) |
| First gap? | not stated | breakaway = the first move out of the top (implied) | no | no | no | yes, day 2 of the top | no | yes, no 3% gap since the top |
| Entry | after the bounce, under the gap-day low (or later bounce low) | none | 2 ticks under the first-hour low | a close under the event-day low, or the top of the bounce | 4% down moves (one list) | opening range breakdown, gap not filled | 1 minute after the open | none ("measured, not traded") |
| Stop | over the prior day's low or broken support; "much more room" | none | 4% trailing | "a few cents" above the gap | not stated | not stated (day's high style) | none (out at the close) | none |
| Target / exit | none | none | 4% trailing stop | event trend low; measure rule | not stated | the daily 9 EMA | the close | none |
| Market | index in a downtrend | none | none | bear market (bad earnings) | none | none stated | none | not used |

### 3.15 Where the sources disagree

1. **Top or downtrend?** ChartSchool's bearish breakaway gap comes after "an extended advance, an extended top". Fleckenstein
   wants stocks "already in major declines" and below both averages. Bulkowski's bad-earnings page does best near the
   yearly low. Kell's examples start from the top ("A gap down from highs, followed by a Wedge Drop"). The owner wants
   "off the highs" and not "downtrend gaps".
2. **Short the gap or the bounce?** ChartSchool's intraday method and Bracco's day-2 variant short the gap day.
   Fleckenstein says wait "for the bounce to occur and exhaust itself"; Bulkowski says short "at the top of the bounce";
   the owner's own short tactic waits for "a decent pop back up and rejection".
3. **Where is the stop?** Over the gap day's high (Qullamaggie-style, our evidence tables), over the prior day's low or
   broken support (Fleckenstein), a few cents above the gap (Bulkowski), or a fixed 4% trailing stop (ChartSchool).
4. **News or no news?** Fleckenstein and Stockbee require a fundamental catalyst; Savor and Chan find drift after news
   and reversal after no-news shocks (Chan: "some evidence" of the reversal). Our owner rejected the earnings collapses
   he saw.
5. **Gap size.** By eye (Fleckenstein), any full gap (ChartSchool), 1 standard deviation (QuantRocket), 15% or more
   (Bulkowski's dead-cat bounce), 5% (our app).
6. **What a gap means later.** ChartSchool's breakaway section says do not expect a fill soon; its TA 101 says gaps have
   "little to no influence" weeks or months later; Bulkowski calls gaps "places of weak support or resistance". UCT treats
   bear gaps as real resistance for weeks to months (GLD's held about seven weeks, QQQ's about three months).
7. **Market condition.** Fleckenstein wants a falling index; Bulkowski's bad-earnings short is for bear markets; my test
   found the app's events did worse when SPY was under its 200-day (section 4.3).

---

## 4. Measured evidence

### 4.1 Published statistics

**Bulkowski, gaps** ("Bulkowski on Price Gaps", as returned by the fetch tool). Downward gaps closing within a week:
area 90%, breakaway 1%, continuation 15%, exhaustion 66%. Median days to close for downward gaps: breakaway 84,
continuation 25, exhaustion 5. "The above numbers, combined, are based on over 1,100 samples." Bull-market results; no
date range stated. Limits: his own classification of gap types after the fact; one researcher; no trade rules.

**Bulkowski, falling window.** Bearish continuation "67% of the time"; overall performance rank 7; "Stopped in gap: 25%",
explained as: "In other words, a gap showed overhead resistance 25% of the time." Average time to close the gap 55 days,
median 9 days. "The above numbers are based on hundreds of perfect trades." Limits: "perfect trades" is his idealised
measure; no date range; his trend rule is a downtrend into the window.

**Bulkowski, island top** (bull market, statistics updated 8/26/2020): break-even failure rate 34%, average decline 13%,
pullback rate 55%, 62% meet the price target, rank 31 of 36. "The above numbers are based on 2,000+ perfect trades."

**Bulkowski, bad earnings surprise** (bull market): break-even failure rate 31%, average decline 13%, pullback rate 41%,
69% meet the target. "Nevertheless, in a bear market 61% have upward breakouts!" "For those with downward breakouts,
almost half (47%) bottom in one week, and 60% bottom in less than two weeks." Limits: "based on hundreds of perfect
trades"; no sample size or dates; best results come near the yearly low, not near the highs.

**Bulkowski, dead-cat bounce** (event drops of 15% to 70%). "The average event decline from prior close to trend low is
31%." "From the event day to the trend low averages 7 days." "The average bounce height from event low to bounce high is
28% and takes 23 days." "Twenty-two percent will close the gap during the bounce phase, 38% will close it in 3 months,"
"and 58% will close the gap in 6 months." Then: "Once the bounce completes, price resumes declining, averaging 30% from
the bounce high to post-bounce low in 49 days." Limits: hundreds of "perfect" trades; no dates; very large drops only.
What it means for us: shorting the gap day of a 15%+ drop runs straight into a bounce that averaged 28%; shorting the
top of the bounce is his recommendation.

**QuantRocket (Brian Stanley, 2020).** A same-day short of large down gaps in liquid stocks above their 20-day average:
Sharpe 1.30, 10% a year, 2014 to 2020. Limits: one backtest by a software vendor, intraday only, costs and borrow not
discussed in the text I read, and the post says it was found while "Experimenting with parameters", so the result is
optimistic.

**Chan (2003) and Savor (2012).** Drift after news-driven big moves, reversal after no-news moves (abstracts only). Chan
notes the effect is mainly in smaller stocks and that short-sale limits play a role. Limits: academic portfolio returns
(Chan compares stocks with similar monthly returns; Savor uses analyst reports as the proxy for news), not a trade with
a stop; I did not read the papers' tables.

**For "bear gap off the highs" as such: no published statistics found.**

### 4.2 The house evidence already in the repo, and a flaw in it

- `docs/study/levels/evidence.md` replays four entry and stop pairs on the 39 bank drafts (the first-draft set; he saw
  8, kept 1 and cut 7, and 31 are unshown). Short at the close with the stop over the gap day's high: risk 9.0%, stop
  hit 67%, 2R 33%.
- `docs/study/levels/evidence_atlas.md` replays the same pairs on 800 deep-scan instances since 1995: risk 4.4%, stop hit
  76%, 1R 66%, 2R 44%, 3R 31%.
- `docs/study/bank_v2/ATLAS.md`: 1,836 first-draft instances in the top 1,000 stocks by dollar volume, 1995 to 2026; 1,044
  "clean"; median culmination -6.7%; its "low broke within 60" column (for this short: a close back over the gap day's
  high within 60 sessions) reads 68%. By market: uptrend 1,171, mixed 578, downtrend 87. The bear gap fired on the same
  bar as the High Volume Edge 770 times.
- **The flaw.** `measure_rules.py` `replay()` starts at the fill bar and counts that bar's low (short) or high (long) as
  favourable movement. For "short the gap day's close" the fill bar is the gap day, so the gap day's own low, which
  happened before the close, is counted as profit. A gap day closing in the middle of its range reaches 1R before the
  trade exists. This likely explains part of why the atlas shows 1R 66% and 2R 44% where my test (which starts the day
  after a close entry) shows 48% and 31%; the samples also differ. The same applies to every close-entry row in those
  files for the other setups. See question 12.

### 4.3 My own test (2026-11-09; daily bars; read-only)

**Data.** The sandbox copy of the app's `bars.db` (split-adjusted daily bars to 2026-11-06), opened read-only. Universe:
the 992 symbols in `docs/study/setups/earnings_dates_cache.json` (988 had enough history). Events dated 2005-01-04 to
2026-08-15, so each has 60 sessions after it. Scripts and outputs are in my scratch folder, not the repo.

**Events.** Every true gap down with the open 5%+ under the prior close, the close 6%+ down, volume 2x the prior 50-day
average, price $10+ and 50-day average dollar volume $20M+ (B23), at least 20 sessions apart per stock: 5,664 events.
Of those, 1,733 also meet the app's rule (off a recent top, first gap since it). My code matches the bank: of the 21
bank drafts inside this universe, it finds 19; the other 2 (SNAP 2024-02-07, CRDO 2023-02-15) have too little local
history. Earnings day = an earnings date on the gap day or the day before.

**Facts about the app's events (1,733).** Earnings days: 66% (where known). Closed above the 200-day on the gap day: 61%;
above it the day before: 90%. Median gap -8.1%, median day -10.1%, median volume 4.6x, median close position 32% of the
range. Median distance of the close under the 10-day average: 9.2%; 43% were more than 10% under it.

**Trades (all shorts; R = the distance to the stop).**
- **T1**: short the gap day's close; stop a few cents over the gap day's high.
- **T1c**: the same, but the stop is the closer of that and 3.5% over the entry (the mirror of the owner's Kicker stop).
- **T2**: short a break of the gap day's low within 5 sessions (Fleckenstein's pivot); stop over the highest high since
  the gap day. Skipped if a close fills the gap first.
- **T3**: the owner's tactic in daily form: the first day 2 to 25 sessions later whose high reaches the prior day's 20-day
  EMA and closes back under it; short a break of that day's low the next day; stop over that day's high. Skipped if a
  close fills the gap first. **T3b**: the same at the 50-day SMA.

**Management (the house rules mirrored for a short).** Stop to breakeven at 2R (B19); cover a third at 3R and a third at
5R (E51; a gap through a level fills at the open, F63); the rest on a close over the 10-day average after the first
cover (E52); time stop after 10 sessions if never 1R (C33); a gap over the stop exits at the open (B20 approximated:
daily bars cannot see the 30-minute low); 60-session cap. Same-day conflicts count against the trade. On intraday fills,
a fill day whose high reached the stop counts as a loss.

**Results** (mean R per trade, with a 95% range from a bootstrap that resamples whole trading days):

| Group | Trade | n | Median risk | Stop hit | 2R | 3R | Mean R | 95% range |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Random shorts on liquid days (baseline) | 4.2% stop | 5,928 | 4.2% | 81% | 30% | 21% | -0.09 | -0.13 to -0.05 |
| App rule, all | T1 | 1,733 | 4.2% | 76% | 31% | 21% | -0.02 | -0.15 to +0.11 |
| App rule, all | T1c | 1,733 | 3.5% | 85% | 34% | 26% | -0.04 | -0.19 to +0.10 |
| App rule, all | T2 | 1,098 | 7.4% | 65% | 26% | 14% | -0.08 | -0.18 to +0.02 |
| App rule, all | T3 | 571 | 3.1% | 85% | 32% | 22% | -0.02 | -0.17 to +0.12 |
| App rule, all | T3b | 280 | 3.4% | 85% | 29% | 23% | -0.09 | -0.28 to +0.13 |
| Earnings day | T1 | 1,114 | 4.3% | 72% | 33% | 23% | +0.15 | +0.04 to +0.27 |
| Not earnings | T1 | 579 | 4.1% | 84% | 27% | 17% | -0.35 | -0.70 to -0.08 |
| Close under the 200-day (B26-compatible) | T1 | 679 | 4.4% | 74% | 30% | 19% | -0.16 | -0.48 to +0.05 |
| Close under the 200-day | T3 | 198 | 2.8% | 89% | 29% | 19% | -0.11 | -0.35 to +0.15 |
| Close over the 200-day | T1 | 1,054 | 4.1% | 77% | 32% | 23% | +0.08 | -0.05 to +0.21 |
| SPY under its 200-day | T1 | 249 | 4.6% | 86% | 29% | 19% | -0.44 | -1.19 to +0.14 |
| Off a top but NOT the first gap | T1 | 680 | 5.1% | 85% | 30% | 20% | -0.22 | -0.36 to -0.05 |
| Earnings, top 3 or fewer sessions earlier | T1 | 268 | 4.4% | 71% | 39% | 25% | +0.36 | +0.11 to +0.62 |
| Earnings, close over the 200-day | T1 | 670 | 4.1% | 74% | 36% | 26% | +0.23 | +0.08 to +0.39 |
| Earnings, close under the 200-day | T1 | 444 | 4.5% | 71% | 29% | 20% | +0.03 | -0.11 to +0.17 |
| Top 20+ sessions earlier, prior close within 5% of it (a range near the highs) | T1 | 154 | 3.5% | 71% | 32% | 22% | +0.09 | -0.18 to +0.38 |
| Comparison: big gap downs NOT off a top | T1 | 3,931 | 5.0% | 80% | 30% | 21% | -0.09 | -0.16 to 0.00 |

**What the test says.**
- As defined in the app, the bear gap is not a proven short: about zero per trade under house management, a little better
  than shorting random days, with a range that includes zero.
- The first-gap condition matters: later gaps off the same top did worse than random (-0.22R).
- The only clearly positive slices are earnings collapses, especially straight off a fresh high, and mostly above the
  200-day. Those are the charts the owner cut, and B26 forbids most of them.
- The B26-compatible version (gap day closing under the 200-day) showed no edge with any entry tested.
- Shorting these when the whole market was under its 200-day did worse, not better.
- Win rates are low (about 20% to 40%); the results depend on a few big winners.

**Limits.**
- Daily bars only. The owner's and Bracco's entries are intraday (30-minute rule, opening range, VWAP); I could not test
  them. My T3 is a crude daily stand-in for the owner's "pop back up and rejection".
- Survivorship: only stocks that still trade are in the database. Companies that collapsed and delisted after a gap down
  are missing, which biases the results against the short.
- No borrow fees, no hard-to-borrow skips (D48), no slippage.
- About 40 group-and-trade cells were tested. At a 95% level, about 2 could look positive by chance. The +0.36R slice
  needs a fresh, out-of-sample check before anyone relies on it.
- The universe (stocks with cached earnings dates) is not the same as the deep-scan universe in 4.2.

### 4.4 Bracco's day-2 variant, a loose daily test

Burst: the climax close 50%+ above the lowest close of the prior 20 sessions, three up closes before it, a new 20-session
high on the climax day. Day 2: opens 2%+ under the climax close and never trades back up to it ("failure to fill the
gap"). Short day 2's close; stop over day 2's high; Bracco's target, the daily 9 EMA.
- 306 events. Median risk 4.0%. Reached the 9 EMA before the stop: 58%.
- Mean R, covering at the 9 EMA: +0.87 (95% range -0.06 to +1.76). House management: +0.49 (-0.57 to +1.42).
- But 173 of the 306 came from 2008-2009 and 2020, and 136 of those 173 were under the 200-day: rebound bursts off crash
  lows, not blow-off tops. Without those years: 0.00R at the 9 EMA (-0.26 to +0.29) and -0.40R with house management.
  Above the 200-day only: +0.02R at the 9 EMA.
- Conclusion: inconclusive. My daily proxy cannot see the opening range breakdown Bracco uses, and my burst filter is
  looser than his checklist.
- Second check: the 306 events, 4.0%, 58%, +0.87, +0.49, 173 and 136, 0.00R and -0.40R, and +0.02R all re-derive from the
  saved event file; the bootstrap ranges re-derive within a few hundredths (a different random seed gives -0.04 to
  +1.83 and -0.55 to +1.50 for the two headline numbers).

---

## 5. Our app: what exists, and what looks wrong

### 5.1 The rule the app fires on: `api/services/study_hard.py`, `bear_gap_fires`

There is no pattern-engine detector for the bear gap. Hard mode's sweep uses this function, which reads the finder's hard
conditions mechanically. For the gap bar `i` and prior bar `p`, it fires when all hold:
- `true_gap`: the gap day's high is under the prior day's low.
- The open is at least 5% under the prior close (`BEAR_MIN_GAP_PCT = 5.0`).
- Volume is at least 2x the prior day's 50-day average volume (`BEAR_MIN_RVOL = 2.0`).
- The close is at least 6% under the prior close (`BEAR_MIN_DAY_PCT = 6.0`).
- The highest close of the prior 250 sessions (`BEAR_HIGH_LOOKBACK`, or fewer if the history is shorter) came within the
  prior 80 sessions (`BEAR_TOP_WITHIN`), and the prior close is within 30% of it (`BEAR_MAX_FROM_HIGH_PCT`).
- No earlier gap down since that top whose open was under 98% of the prior low and 3%+ under the prior close.
- It returns the gap %, the day %, and the top's index. No entry, stop or target.

### 5.2 The finder: `scripts/study/find_bear_gap_examples.py`

The same hard conditions, plus:
- 260+ sessions before the gap (400+ bars in all); liquidity: the gap day's close $10+ and 120-day average dollar volume
  $20M+; a "clean window" (from 2019, no split-sized jumps, no freak bars).
- A score of 8 or more (gap size, volume, distance from the top, above the 50 and 200-day before the gap, size of the day,
  close position, a close under the 50-day, the 50-day slope, the day's range in ATR, and the after-window outcome).
- An after-window label using the next 20 sessions: `gap_held`, `gap_entered` or `gap_filled` (the gap-fill level is the
  prior day's low). The ranking prefers `gap_held`, so the bank's examples were chosen partly by what happened next.
- One pick per stock, up to 120, plus the seed NFLX 2022-01-21. Earnings dates flagged from FMP.
- Its docstring calls itself "the FIRST DRAFT of that rule".

### 5.3 The bank, the chart, the lesson text, Hard mode, the course

- `docs/study/bank/spot.bear_gaps.json`: 39 drafts (skill `setup.family3.bear_gap`). Lesson text: "Bear Gap off the
  Highs: the first true gap down since a recent top, marked on the gap day itself. It is not Gap Support (a gap up that is
  later tested) and not a gap inside a downtrend." 34 of 39 are flagged as earnings days; 38 of 39 were above both the
  50 and 200-day before the gap; 37 of 39 kept the gap open for the next 20 sessions (the ranking favoured that).
  None is approved in the bank file (all 39 are "draft"), and `docs/study/RESUME-PROMPT.md` records the challenge pool
  as "empty (Bear gap: 0)", so Hard mode has nothing to play for it.
- `app/src/pages/study/bearGapOverlay.js`: draws two rays from the gap day: the gap-fill level (the prior day's low) in
  gold with a price label, and the gap day's high, fainter.
- `app/src/pages/study/studyPlainRules.js`: `approved: false`; steps "A stock makes a recent top.", "It gaps down for the
  first time since that top.", "Mark it on the gap day itself."
- `app/src/pages/study/challenges/hardMode.js`: `SHORT_SETUPS = ['Bear gap']`; the "culmination" window ends at the
  first close over the gap day's high.
- `docs/study/TRADE_PLANS.md`: "no trade is defined in the app | the lesson shows the line a close must stay under: the
  gap day's high | the fall is measured, not traded". Its VRNS example (stop 25% over the close) checks out on the bars:
  25.0% (high 40.41, close 32.34; the close sat 1% off the day's low of 32.02, so its "closed at the low" is near
  enough).
- `docs/study/courses/V/V.05.json` teaches: "Bear gap: the line is the gap day's high." and marks "Our app defines a full
  short trade for the Bear gap: entry, stop and targets." as False. A wrong-answer note says: "A gap down off the highs is
  the Bear gap lesson, and that one is measured, not traded."

### 5.4 Model Book, journal tags, vocabulary, other code

- Model Book (`app/src/pages/modelbook/setupCatalog.js`): no Bear gap card. Short cards: Wedge Drop, Parabolic Short;
  Launchpad, EMA Crossback, 2B Reversal and ORB are "both".
- Journal tags (`app/src/constants/setupGroups.js`): no Bear gap tag. The nearest: 'News Failure' (family 'Reversals &
  Reclaims' in `setupTagMap.js`), 'Wedge Drop', 'Parabolic Short', 'Opening Range Breakdown' and 'Green to Red'
  (Intraday).
- Vocabulary (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`): "Bear Gap", kind "level", status approved ("verbatim
  Sunday Scans usage"), alias "bear gap resistance". So the house's own name authority files it as a level, not a setup.
- `api/services/pattern_engine/sr_levels.py`, `_gap_cands`: an unfilled gap down (the gap day's high at least 1 ATR
  under the prior day's low, so a full window) becomes a "Resistance" level at its edge (the pre-gap bar's low) once
  price later comes back into a band around that edge and reacts there; a significant close back through the edge (the
  file's `_thr` test) removes it. This is the bear gap as a level, already in the app.
- `api/services/pattern_engine/detectors/uct/parabolic_short.py`: only the gap-up climax version (a 3%+ gap up that
  closes under its open, after a 100%+ gain in 30 bars, on a range over 3 ATR, a close in the bottom 30% of the range
  and 3x volume); its docstring credits Kullamägi's framework, not Bracco's. Bracco's day-2 gap-down variant is not
  detected.
- `docs/study/UNITS-method.md`: no unit; the bank put the drafts under SET.22 (Gap Support).
- `docs/study/levels/dossiers/bear_gap.md`: the earlier levels dossier, which summarises entries from the brain's
  knowledge base (distilled from members-only material; not repeated here) and lists entry and stop candidates.

### 5.5 The owner's rulings on the 8 charts he saw (2026-10-31)

| Stock | Gap day | Ruling (his words) | Top, sessions earlier | Prior close vs top | Gap | Day | Earnings | Close under 50 / 200 | Next 20 sessions |
|---|---|---|---:|---:|---:|---:|---|---|---:|
| MPWR | 2024-10-31 | "Good" | 50 | -2.9% | -10.2% | -17.5% | yes | yes / yes | -25.2% |
| PRIM | 2026-05-06 | "This is more of just an earnings breakdown" | 1 | 0.0% | -36.7% | -50.1% | yes | yes / yes | +26.1% |
| CXM | 2023-12-07 | "Same more of just an earnings breakdown" | 2 | -0.2% | -28.2% | -33.5% | yes | yes / yes | +9.7% |
| MTZ | 2023-08-04 | "More of just an earnings breakdown" | 2 | -0.9% | -13.3% | -17.7% | yes | yes / no | -0.1% |
| NFLX | 2022-01-21 | "Okay this is stupid" | 44 | -26.5% | -21.2% | -21.8% | yes | yes / yes (already under both before) | -1.6% |
| GKOS | 2025-02-21 | "Cut" | 20 | -2.4% | -10.2% | -20.0% | yes | yes / yes | -18.8% |
| WWD | 2024-07-30 | "Cut" | 10 | -2.2% | -16.4% | -17.2% | yes | yes / no | +9.5% |
| F | 2024-07-25 | "Cut" | 5 | -6.0% | -13.7% | -18.4% | yes | yes / yes | -2.2% |

(Facts from the bank file; "next 20 sessions" is the stock's move, a minus is good for a short.) All eight were earnings
days, including the one he kept, so "no earnings" alone does not explain his rulings. MPWR is the only one whose top came
50 sessions earlier while the prior close still sat within 3% of it (a range near the highs); its gap was moderate (-10%)
and it closed under both averages. That fits ChartSchool's bearish breakaway gap after "an extended top or a
consolidation period" better than a one-day collapse from a fresh high, but one kept chart is not a rule. The log
then says to stop and "ask the owner for one or two charts of what he means".

Added in checking: the log also records (line 292) that when NFLX, GKOS, WWD and F were first sent, the owner was not
sure which lesson he was looking at ("Okay I’m not exactly sure what we’re looking at. A few minutes ago we were doing
go signal and now idk what this is"), and the reviewer's note there says those four stay ungraded. The next lines
(293 to 296) and the pause note (297) record all four as cut. So "Okay this is stupid" on NFLX may be partly about that
mix-up, not only about the chart; the log does not say.

### 5.6 What disagrees with the sources, or looks wrong

1. **The definition is not his.** The phrase "the first gap down from a top" and "e.g. NFLX Jan 2022 on the day" are in the
   reviewer's notes on line 216, not in his words. He later answered that very chart with "Okay this is stupid" (but see
   the mix-up note under 5.5). The finder was built on it.
2. **The gates miss UCT's own bear gaps.** The true-gap, 5% and 2x-volume gates exclude most charts UCT writers called a
   bear gap off highs or a gap down off highs (section 6.7): BE, GLW, MRNA, TSLA and both of SNDK's were not full daily
   gaps; BE, GLW and SNDK had under 2x volume; GLD's was 4.1%. UCT's "bear gap" reads like an overnight gap seen on the
   hourly chart, from the prior close down to the next day's high, not a daily window: SNDK's two gaps still open on
   2026-07-10 (2026-06-26 and 2026-07-01) were both of that kind, while its two full windows in that stretch (2026-06-23
   and 2026-07-07) had both been filled by then (closes back over the prior day's low on 2026-06-25 and 2026-07-08). That
   is my reading of those examples; question 6.
3. **Two different "lines".** The course says the line is the gap day's high; the overlay's emphasised (gold, labelled)
   line is the prior day's low, the gap-fill level. Sources and UCT treat the gap zone (both edges) as resistance, and a
   close above the prior day's low fills it.
4. **Close-entry replay flaw** in `docs/study/levels/measure_rules.py` (section 4.2).
5. **Outcome-chosen examples.** The finder ranks `gap_held` first, so the drafts over-represent gaps that worked. Fine for
   showing what the level looks like, but a lesson must not imply that bear gaps usually hold.
6. **Wrong home.** The drafts sit in unit SET.22 (Gap Support), a long setup. If it becomes a lesson it needs its own unit.
7. **Stated as short, built as level.** Hard mode treats it as a short (`SHORT_SETUPS`) while the plan says no trade.
   Consistent with "measured, not traded", but the "culmination" window lasts until a close over the gap day's high,
   which on VRNS sat 25% over the close, so the measured fall ignores a drawdown no house stop would allow.
8. **History check differs.** `study_hard` looks back up to 250 sessions or whatever exists; the finder needs 260. A stock
   with a short history (a recent IPO) can count as a bear gap in Hard mode's sweep but would never be found by the
   finder.

---

## 6. UCT's own words

All from the public Substack (https://unchartedterritoryy.substack.com, 103 posts in the sitemap, read 2026-11-09). One
post is for subscribers and was read as a preview only. Sections: "TSDR's Weekly Outlook & Watchlist" (the owner, headed
"Patrick (TSDR)" in later issues), "Bracco's Breakdown & Top Ideas", the unsigned "Index & ETF" section, unsigned intros,
and named contributors in "The Rest of the Week". Quotes keep the writers' spelling.

### 6.1 The owner (TSDR)

On how he shorts (the most important quotes for this setup):
- GEV, [2026-11-01](https://unchartedterritoryy.substack.com/p/sunday-scans-669): "With shorts, I am extremely picky and
  try to get 1-2 per cycle when they are presented." Then: "I want them below the 200SMA for sure and often on a decent
  pop back up and rejection coinciding with the 50SMA or 20EMA." And: "Something with a clear invalidation spot and
  likely sellers. Essentially the same tactics I use for longs but just incredibly more selective."
- Same post: "The next trade is either reshort into resistance or bounce on notable gap down extension."
- [2026-03-29](https://unchartedterritoryy.substack.com/p/sunday-scans-352): "I do not ride the short bus too often much
  anymore" and "Usually I try to get 1-2 shorts during a down cycle that allows comfort in the open swing trades that are
  showing RS."
- [2026-03-08](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf): "Back to the overtrading and shorts
  conversation, really don’t think it is something trader’s NEED."
- [2026-11-08](https://unchartedterritoryy.substack.com/p/sunday-scans-70f): "Often hard to not feel like you are shorting
  the hole when we get big massive moves like this to the downside and barely anything on the one day pops." And: "They
  cant even reach the 9EMA before rolling back over harshly." And: "Some of the best traders I know often suggest 0
  activity below the 200SMA."
- CVNA, [2025-11-23](https://unchartedterritoryy.substack.com/p/sunday-scans-56d): "Not particularly interested in shorts
  but this looks more and more vulnerable by the day." Next: "Stage 3 topping action and if the 200SMA is lost and
  sustains then stage 4 downtrend potential." (The short waits for the 200-day to go, as in B26.)
- CAR, [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43): "Mechanical short squeeze. Very
  extended. Possible gap down and short similar to RGTI 10/15." (A gap-down short idea after a squeeze: the parabolic
  context.)

On bear gaps off highs, as warnings on longs:
- MRNA, [2026-08-30](https://unchartedterritoryy.substack.com/p/sunday-scans-d40): "Don’t love the big bear gap off highs
  on day two but a proper signal down here would be worthy of the tight risk imo." (He was looking to buy.)
- BE, [2026-05-17](https://unchartedterritoryy.substack.com/p/sunday-scans-679): "Gross bear gap off highs. Would like to
  see some supportive action early in the week." He held it, "with my cost basis at 167".
- GLW, same post: "Another one with a gnarly gap down off highs on Friday closing right at the daily 9EMA."
- SNDK, [2026-07-12](https://unchartedterritoryy.substack.com/p/sunday-scans-898): "Still has an open bear gap off highs,
  two of them actually."
- SKHY, [2026-09-13](https://unchartedterritoryy.substack.com/p/sunday-scans-2f5): "don’t love the gap down after making
  new highs."

On bear gaps as resistance:
- CRWV, [2026-04-26](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d): "The bear gap to the left just around
  $120 is acting as resistance."
- BE, [2025-12-07](https://unchartedterritoryy.substack.com/p/sunday-scans-088): "Bear gaps above at $124 and $136 and
  looking forward to seeing how, if, and where sellers step in for some battleground."

On buying gap downs in leaders (the opposite trade):
- CLS, [2026-05-03](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc): "Prime example of the PLTR May 2025 3
  day gap down earnings reversal on a leading stock." And: "This is one earnings setup I use on leading names early on in
  a market recovery."
- [2026-08-30](https://unchartedterritoryy.substack.com/p/sunday-scans-d40): "Always interesting that folks are willing to
  buy an ER gap down (RBRK) and less willing to buy a gap up. When statistically the gap ups are significantly more
  favorable catalysts for continuation."
- CRWD, [2026-06-14](https://unchartedterritoryy.substack.com/p/sunday-scans-e95): "Not concerned about ER gap down it was
  extended."

On a gap down against your own position (the same practice that B20 writes down; B20 itself is his 2026-11-09 ruling):
- [2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2): "If you find yourself in a position that is
  gapping down well below your planned stop, it is important to have a system and plan of action." And: "I always use the
  first 30 min to let play out and establish the range."
- [2025-11-02](https://unchartedterritoryy.substack.com/p/sunday-scans-b99): "The only times these will be adjusted are on a
  gap down and will be replaced at the 15/30 min low"
- CRM, [2026-11-01](https://unchartedterritoryy.substack.com/p/sunday-scans-669): he "took a 4% loss on the gap down when
  ServiceNow dumped".

### 6.2 Bracco

The day-2 gap-down variant, ["The Parabolic Short"](https://unchartedterritoryy.substack.com/p/the-parabolic-short)
(2025-06-13; subtitle "Bracco (@braczyy on X) - June 13th , 2025", signed "- Bracco" at the end):
- "Sellers lack the strength to push it lower, and it closes near the middle or high of the day’s range."
- "Then the stock gaps down the next day, and that is usually the nail in the coffin."
- "This puts in candlestick’s that are commonly known as the “hanging man” or “Doji” at the high."
- "The gap down the following day is key, as longs from the previous close are underwater and short sellers take
  advantage."
- "Usually any opening range breakdown and failure to fill the gap begins the backside of the move and can be traded back
  to the daily 9EMA."
- "I do not typically engage in this setup for reasons stated above, but the backside of the move can still be captured
  using this setup."

Later posts:
- IREN, [2025-10-08](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208): "What you typically see
  following this candle, if going to follow through to the downside, is a gap down and failure to follow through back
  higher on any bounces." And: "Any longs from previous day are now trapped underwater and early shorts were likely shook
  out before the close."
- Silver, [2025-12-28](https://unchartedterritoryy.substack.com/p/sunday-scans-249): "There are other variations of the
  parabolic short such as the “day 2 gap down” setup, but for a full sized trade I am really only interested in a gap up,
  climax short setup." And: "Any other variation may be taken with smaller size."
- AGQ, [2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1): "Had very high conviction in this when it
  sold off late day Wednesday and setup the day 2 gap down variant of the parabolic short." And: "I shorted AGQ shares as
  my vehicle which resulted in 3 failed attempts over 2 sessions."
- MSTR, [2025-06-10](https://unchartedterritoryy.substack.com/p/trade-updates) (a long): "now MSTR attacking this bearish
  gap with ease".
- [2025-09-21](https://unchartedterritoryy.substack.com/p/sunday-scans-88a): "it will always be more worth it to be long
  into a parabolic move, than to catch the short side of it."
- [2025-11-16](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a): "pressing shorts immediately after an unwind
  like feels dangerous from a risk‑reward standpoint."
- [2026-08-02](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2): "I will say from experience that it is
  extremely dangerous and detrimental to just begin shorting stuff too late in the down cycle."
- [2026-09-20](https://unchartedterritoryy.substack.com/p/sunday-scans-bc2): "I also really struggle buying those type of
  gap downs…" (About buying a gap down for a long, in SOXL, not about shorting one.)

### 6.3 The unsigned Index & ETF section

No byline. (In the 2026-03-29 issue this section and the owner's section describe the same SMH short, a hint that the
owner writes it; not stated.)
- GLD, [2025-11-16](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a): "It is my view that GLD had a near term
  blow off top and that massive bearish gap above will act as resistance for the foreseeable future. Thursday was a
  reasonable short opportunity if you share the same views." (With SLV below, one of the two places a bear gap off a top
  is tied to a short.)
- GLD, [2025-12-07](https://unchartedterritoryy.substack.com/p/sunday-scans-088): "Continues to reject the bear gap from
  the blow off top."
- GLD, [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43): "Can’t fill prominent bear gaps and I
  think might be susceptible to lead lower."
- SLV, [2026-02-08](https://unchartedterritoryy.substack.com/p/sunday-scans-29e): "Could be shortable on stage 3 ish failed
  base on a tap of $90-$95 zone at the bear gap but a tricky one imo." (A short on the retest of the gap.)
- IWM, [2026-06-07](https://unchartedterritoryy.substack.com/p/sunday-scans-d16): "Bear gap off highs with plenty of
  support levels below."
- SMH, [2025-09-01](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1): "Failure to close the bear gap from
  Friday and continued distribution above a potential flattening out 50 day moving average could open the door for a
  breakdown through 280/285."
- QQQ, [2025-08-10](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f): "a major sign of strength to fill bear
  gaps quickly".
- QQQ, [2025-07-13](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6): "Bulls are still filling bear gaps, but
  increasingly, we have seen bears closing bull gaps quickly on overnight strength."
- QQQ, [2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1): "Still struggling with the bearish gap
  above as we have for over two months now, almost three months really."
- QQQ, [2026-07-12](https://unchartedterritoryy.substack.com/p/sunday-scans-898): "Hourly battle between $715 bull gap
  support and $730 bear gap resistance."
- SPY, [2026-05-03](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc): "only took two sessions to negate
  Tuesday’s bear gap".
- QQQ, [2025-11-02](https://unchartedterritoryy.substack.com/p/sunday-scans-b99): "A worst case scenario would be if this
  $624.50-$636 cluster is met by a gap down and creates an Island Top Patten." (sic)
- QQQ, [2026-08-02](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2): "From the re short on the loss of the
  50SMA, and again at the bearish cross back at the 20EMA and then the extension and strong bounce."

### 6.4 Unsigned intros

- [2026-04-19](https://unchartedterritoryy.substack.com/p/sunday-scans-33a): "My recommendation is to ELIMINATE vs ADD."
  The list of simple starter rules that follows includes "No Shorting" (next to "No stocks below the 200SMA"). The
  writer says "Bracco and I will highlight our thoughts and areas of focus.", so it is not Bracco; it is likely the
  owner, but the post does not say.
- [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43): "-Do not ever be eager to short. Ever.
  Especially after a large decline and subsequent massive push higher."

### 6.5 Contributors ("The Rest of the Week")

- Manrav, INOD, [2026-01-07](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0) (a long): "watch for any
  signs for consolidation or a flag at the bearish gap which will get the 50 SMA curling up to get long."
- Viotti, NCLH (short), [2026-04-14](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-c4d): "Moves into
  declining MA's are my favorite short setup"

### 6.6 In-house Discord notes

The levels dossier (`docs/study/levels/dossiers/bear_gap.md`, section 3) already summarises entries from the brain's
knowledge base, which is distilled from members-only material (the #tsdr and #bracco video lessons and the archive):
Manrav reads a bear gap as resistance until reclaimed; TSDR uses a bear gap overhead as a first trim spot on longs; no
in-house trader shorts this setup. I did not re-quote that private material.

### 6.7 UCT-named examples, checked against the bars

From the local bars (split-adjusted). Where the post gave no date, the gap day is my identification from the bars: the
gap down off the recent top that was still unfilled on the post's date.

| Named by | Stock | Gap day (from bars) | Gap | Day | True daily gap? | Volume | Vs 200-day at close | App rule fires? |
|---|---|---|---:|---:|---|---:|---|---|
| Index & ETF (GLD short note) | GLD | 2025-10-21 | -4.1% | -6.4% | yes | 3.5x | above | no (gap under 5%) |
| Index & ETF (SLV, "a tap of $90-$95 zone at the bear gap") | SLV | 2026-01-30 | -15.4% | -28.5% | yes | 5.7x | above | yes |
| Owner (BE, "Gross bear gap off highs") | BE | 2026-05-15 | -5.5% | -9.1% | no | 1.0x | above | no |
| Owner (GLW, "gap down off highs") | GLW | 2026-05-15 | -4.9% | -7.9% | no | 1.3x | above | no |
| Owner (SNDK, "two of them") | SNDK | 2026-06-26 and 2026-07-01 (the two still open on 2026-07-10) | -7.1%, -8.3% | -10.5%, -10.6% | no, no | 1.3x, 0.9x | above | no |
| Owner (MRNA, "on day two") | MRNA | 2026-08-20 | -13.9% | -23.5% | no | 8.9x | above | no |
| Index & ETF (QQQ "bearish gap from 11/4") | QQQ | 2025-11-04 | -1.4% | -2.0% | yes | 1.2x | above | no |
| Bracco (day-2 list) | FUTU | 2024-10-08 | -18.6% | -13.1% | yes | 4.9x | above | yes |
| Bracco (day-2 list) | CGC | 2021-02-11 | -8.5% | -22.1% | yes | 4.4x | above | yes |
| Bracco (day-2 list) | TSLA | 2020-02-05 | -7.2% | -17.2% | no | 3.1x | above | no |
| Bracco (day-2 list) | DJT | 2024-10-30 | -7.7% | -22.3% | no | 4.3x | above | no (not a full gap; top too old) |
| Bracco (day-2 list) | TASR (AXON) | 2004-04-20 | -10.6% | -28.9% | no (by 9 cents) | 4.0x | above | no |
| Bracco (day-2 list) | UVXY | 2024-08-06 | -16.8% | -28.4% | no | 1.7x | above | no |
| Owner ruling "Good" | MPWR | 2024-10-31 | -10.2% | -17.5% | yes | 5.9x | below | yes |

Bracco's dated examples are the climax days; in every case the bars show the gap down on the next session, which matches
his description. Every UCT example closed above the 200-day except MPWR.

---

## 7. How it fits the account rulebook (section 9)

| Rule | What it says | Fit for the bear gap |
|---|---|---|
| **B26** (hard) | Shorts only below the 200-day SMA, unless parabolic | The main conflict. 61% of the app's events close above the 200-day on the gap day, and 90% were above it the day before. Every UCT example in 6.7 except MPWR closed above it. Only the parabolic day-2 variant may short above it. Version R lives below it. |
| **D47** | Shorts are our long setups reversed | The long mirror of a bear gap off the highs is a gap up off a base (PEG, Gap Support). Version R mirrors the owner's own long tactic (a pullback into a rising average that holds), which he calls "the same tactics I use for longs". |
| **A3, F62** | Stop a few cents beyond the day's extreme | Mirror: a few cents over the trigger day's high. On the gap day itself that is often far away. |
| **A13** | Stops usually within about 3% | Gap-day close entries: median stop 4.2%, only 32% within 3%. The retest entry (T3) has a median of 3.1%. Wider structural stops (Fleckenstein's prior-day low) are far outside it. |
| **E57** | Market orders | Applies: short at market when price trades under the trigger. |
| **C28** | No chasing more than 4% past the buy point | Mirror: do not short more than 4% under the trigger. Gap opens often already sit far under any trigger. |
| **C29** | Skip a long more than 10% above its 10-day | Mirror: skip a short more than 10% under its 10-day. 43% of the app's gap-day closes are past that line. It argues for waiting for the bounce. |
| **C31** | Leaders RS 80+; shorts the mirror, RS 20 or less, weakest groups | A stock gapping down off its highs is usually still strong on RS. Exempt only if counted as "parabolic or mean reversion" (question 5). |
| **B23, D42** | $10+ and $20M+ a day; under 1% of volume | Applies. |
| **D48** | Skip hard-to-borrow or high-fee shorts | Applies; popular collapses are often expensive to borrow. Not testable on our data. |
| **B22** | No new buys within 3 days before earnings; hold through only if up 5R | Mirror for shorts. Most bear gaps are earnings reactions, so the next report is far off; a short taken later must still check the date. |
| **B19, E51, E52, F63** | Breakeven at 2R to 5R; a third at 3R, a third at 5R; trail the 10-day or 21-day | Mirror applies. Bracco's and Qullamaggie's targets (the 9 EMA, the 10 and 20-day) arrive sooner; see question 8. |
| **B20** | Gap through the stop: the first 30-minute extreme is the new stop; out past 2R | Mirror applies (a gap UP over a short's stop). The owner described the same gap-down practice in Sunday Scans in 2025 (6.1). |
| **C33** | Under 1R after 10 days: exit | Applies. |
| **D46, F65, B18** | Red market: mostly cash plus shorts below the 200-day | Fits Version R. My test found the app's events did worse when SPY was under its 200-day, so a Red market is not by itself an edge. |
| **D38, E49, E50** | Grade sets size; grading is his call | Applies. Bracco: other variations "with smaller size". |
| **C37** | New traders start at 0.25% risk | Applies, and the intro list "No Shorting" suggests new members should not short at all (question 11). |

---

## 8. Proposed rules for our course

### 8.0 Which versions

- **Version L, the level lesson (recommended first).** What a bear gap is, where its zone is, why it is resistance, what a
  fill means. No trade. This matches the vocabulary file, `sr_levels.py`, the course's "measured, not traded", and how
  UCT's writers use the term. [UCT] [source consensus]
- **Version R, the bear gap retest short (recommended if he wants a short).** Below the 200-day, short the failure of the
  first bounce back into the gap zone or the declining 20-day / 50-day. It is the owner's own short tactic and fits every
  house rule. My crude daily test showed no edge, so it waits for his charts. [UCT] [house rule] [my proposal]
- **Version P, the day-2 gap down (Bracco).** The only form that could be allowed above the 200-day (B26 parabolic
  exception), smaller size. [UCT] Caution added in checking: Bracco calls it a variant of the parabolic short, but it
  lacks the climax-day gap up that his main setup requires ("I won’t short without that gap-up."), so whether B26's
  exception covers it is the owner's call (question 5).
- **Not recommended unless he rules otherwise: Version E**, shorting the close of an earnings collapse straight off a fresh
  high. It is the only slice with a positive number in my test, but it is what he cut as "earnings breakdown", it is
  mostly above the 200-day, and the number needs an out-of-sample check. [measured]

### 8.1 What it is (all versions)

| Item | Rule | Basis |
|---|---|---|
| Prior trend | A 250-session closing high (the top) set within the prior 80 sessions, and the close before the gap within 15% of it | "off the highs" [UCT, the owner's phrase]; 250/80 from the app; 15% [my proposal] (the app's 30% let in NFLX, already 26% down, which he rejected) |
| Structure before the gap | Option A: any top. Option B: a range near the highs, the top 15+ sessions earlier and the prior close within 5% of it (MPWR-like; the slice tested in 4.3 used 20+ sessions) | breakaway gaps leave a top or a range: ChartSchool TA 101 "an extended top or a consolidation period", Bulkowski "on leaving a consolidation area", Schaeffer's on gaps that "upset a trading range" [source consensus]; MPWR [UCT ruling]; question 3 |
| The gap | The open is under the prior close by at least 1 ATR(14) or 4%, whichever is smaller, and the gap is not filled that day (the day's high stays under the prior close) | UCT's examples are overnight gaps, not always daily windows (6.7) [UCT]; ChartSchool's "Partial Gap Down" is a published name for that kind [one source]; numbers [my proposal] (the 1 ATR in `sr_levels.py` measures a full window, not the open); question 6 |
| Full window (stricter option) | The gap day's high under the prior day's low | ChartSchool's down gap and Bulkowski's falling window ("yesterday's low is above today's high") [source consensus]; the app's current rule |
| First crack | No earlier gap of this kind since the top | the app [UCT draft]; measured: later gaps did worse (-0.22R) [measured] |
| Volume | At least 1.5x the 50-day average on the gap day (2x for an A grade) | Fleckenstein 2x [originator]; ChartSchool "above average" and Bulkowski "usually on high volume on the gap day" [source consensus]; 1.5x [my proposal]: SNDK's 1.3x and 0.9x show UCT does not require 2x |
| The day | Closes down at least 5% and in the lower half of its range | Fleckenstein "lower half" [originator, gap-down short]; the app 6% [UCT draft]; 5% [my proposal] |
| Gap zone | For a full window, from the gap day's high (bottom edge) up to the prior day's low (top edge); for an overnight gap that is not a full window, up to the prior close | full window: ChartSchool, Bulkowski [source consensus]; the prior-close edge [my proposal, from UCT's examples]; the overlay should draw both edges as one zone [my proposal] |
| Liquidity | $10+, $20M+ a day, position under 1% of volume | B23, D42 [house rule] |

### 8.2 Version L, the level lesson

- Mark the zone on the gap day. Under it, the zone is resistance: the first rally into it is where trapped buyers sell.
  [source consensus] [UCT: "acting as resistance"]
- A close above the top edge fills the gap; a quick fill is strength. "a major sign of strength to fill bear gaps quickly"
  [UCT]
- For a long: do not buy right under an open bear gap; wait for it to fill or for a base under it. The owner on MRNA:
  "a proper signal down here would be worthy of the tight risk". [UCT]
- For a holder: a bear gap off highs on your stock is a warning; manage by your trail and the gap rule (B20). [house rule]

### 8.3 Version R, the bear gap retest short

| Item | Rule | Basis |
|---|---|---|
| Location | The stock closes under its 200-day SMA on the setup day, and the 200-day is flat or falling | B26 [house rule]; the owner: "below the 200SMA for sure" [UCT]; flat or falling [my proposal] |
| Bounce | Within 25 sessions of the gap, price rallies into the gap zone, or to the declining 20-day EMA or 50-day SMA, without a close above the zone's top edge | "a decent pop back up and rejection coinciding with the 50SMA or 20EMA" [UCT]; waiting for the bounce: Fleckenstein "wait for the bounce" and Bulkowski "short the stock at the top of the bounce" [source consensus]; Kell's stop "just above the recent high" [one source]; 25 sessions [my proposal] |
| Light bounce | Bounce days average less volume than the gap day, ideally under the 50-day average | Fleckenstein "declining volume relative to the volume of the gap-down session" [originator] |
| Rejection candle | A day that touches the level and closes back under it, in the lower half of its range | [UCT] ("rejection"); lower half [my proposal] |
| Trigger | Price trades under the rejection candle's low (a few cents under) | the mirror of his long trigger over a prior high (D47) [house rule]; Fleckenstein's pivot under a low [originator] |
| Order | Market order when the trigger trades | E57 [house rule] |
| Not too late | Skip if already more than 4% under the trigger, or more than 10% under the 10-day average | C28, C29 mirrored [house rule] |
| Relative strength | RS rating 20 or less, or a weak group | C31 mirror [house rule]; question 5 |
| Earnings | No new short within 3 days of a report | B22 mirror [house rule] |
| Borrow | Skip if hard to borrow or the fee is high | D48 [house rule] |

### 8.4 Version P, the day-2 gap down (parabolic exception)

| Item | Rule | Basis |
|---|---|---|
| Burst | Bracco's parabolic burst checklist (three straight up days, two overnight gap ups, range and volume expansion; the more boxes, the better). The checklist's last box, a gap up on the climax day, is missing by definition in this variant | B26's definition of parabolic [house rule]; Bracco [UCT]; whether B26 covers a burst without the climax gap up is open (question 5) |
| Climax day | Sells off intraday but closes near the middle or high: a "hanging man" or "Doji" at the high | [UCT] (Bracco) |
| Day 2 | Gaps down and does not fill the gap | "The gap down the following day is key" [UCT] |
| Trigger | Opening range breakdown (the 2 or 5-minute low, as in Bracco's main post; the 30-minute low as a slower option [my proposal]), market order | "any opening range breakdown and failure to fill the gap" [UCT]; Qullamaggie "opening range lows" [originator, parabolic short] |
| Stop | A few cents over the day's high | Qullamaggie "highs of the day" [originator]; Bracco's main setup, "setting my initial stop at the day’s high" [UCT]; D47 and F62 [house rule] |
| Target | The daily 9 EMA (cover there, or a third there) | Bracco [UCT]; D47 "its target is the 9-day average" [house rule]; Qullamaggie's 10 and 20-day [originator] |
| Size | Smaller than a normal trade (B- risk, 0.25% to 0.5%) | "Any other variation may be taken with smaller size." [UCT]; E49 [house rule]; the B- band [my proposal] |

### 8.5 The stop (all short versions)

| Item | Rule | Basis |
|---|---|---|
| Default | A few cents over the trigger candle's high (Version R: the rejection candle; Version P: the day's high) | A3, F62 mirrored [house rule] |
| Maximum | If that is more than 3% over the entry, skip, or take it at the next lower grade's size | A13 [house rule]; question 7 |
| Never | Moved higher (wider) after entry | A4 [house rule] |
| Gap against it | A gap up over the stop: the first 30-minute high is the new stop; out if past 2R | B20 mirrored [house rule] |
| Not used | Over the gap day's high on a gap-day close entry: median 4.2%, up to 25% (VRNS) | [measured]; TRADE_PLANS.md |

### 8.6 Trims and trail (house defaults, mirrored)

- Cover a third at 3R (hard rule), a third at 5R; stop to breakeven between 2R and 5R; cover the rest on a close above the
  10-day average (fast movers) or 21-day; cover at the open if it gaps past a cover level. [house rule: B19, E51, E52, F63]
- Version P: cover at least a third at the daily 9 EMA even if under 3R. [UCT] (Bracco's target) [my proposal]
- Time stop: under 1R after 10 sessions, cover. [house rule: C33]

### 8.7 What invalidates it

- A close above the gap zone's top edge (the gap is filled). [UCT: "fill bear gaps quickly", "negate Tuesday’s bear
  gap"] [source consensus: ChartSchool, Schaeffer's on filling]
- For Version R: a close back above the 200-day, or above the 50-day that the bounce was rejected from. [house rule B26]
  [UCT]
- A strong, high-volume bounce into the zone (buyers in control). Fleckenstein's opposite case. [originator]
- The market reading turns Green with breadth thrusting [my proposal]; the intro: "Do not ever be eager to short" after a
  big push higher. [UCT]

### 8.8 The mirrors

- **The long mirror** of a bear gap off the highs is a gap up out of a base: our Gap Support and the PEG. D47 says shorts
  are our longs reversed; Version R is the reverse of his pullback-to-a-rising-average buy. [house rule] [UCT]
- **The opposite trade** on the same chart: the owner's "3 day gap down earnings reversal" buy in a leader, early in a
  recovery (CLS, PLTR). A course should show both, so members learn that a gap down in a leader is not automatically a
  short. [UCT]

### 8.9 Best market conditions

- Version R: a Red or Orange reading, the stock below its 200-day, the stock's group weak. D46: "mostly cash, plus shorts
  below the 200-day". [house rule]
- Not after a big flush: Bracco, "pressing shorts immediately after an unwind like feels dangerous". The unsigned intro:
  "Do not ever be eager to short." [UCT]
- Version P: any market, but best when the stock's burst is far from its averages (Bracco's extension metrics). [UCT]
- Caution from the test: the app's events shorted at the close did worse when SPY was under its 200-day. [measured]

### 8.10 Common mistakes

1. Shorting the gap day's close by reflex. The stop is wide, the stock is stretched far under its 10-day, and in
   Bulkowski's dead-cat bounce sample the big drops bounced 28% on average. [one source: Bulkowski] [measured]
2. Shorting a leader above a rising 200-day (B26), where the owner himself buys gap-down reversals. [house rule] [UCT]
3. Shorting too late in the down cycle (Bracco), after several gaps (later gaps did worse in my test). [UCT] [measured]
4. Treating every big earnings drop as a bear gap off the highs (he called those "earnings breakdown"). [UCT]
5. Ignoring the fill: holding a short after a close back above the gap zone. [source consensus]
6. Chasing: shorting far under the trigger (C28 mirror). [house rule]
7. Hard-to-borrow names and squeezes (D48; "Mechanical short squeeze"). [house rule] [UCT]
8. Sizing a variant like a main setup (Bracco: "smaller size"). [UCT]

### 8.11 Example candidates (from UCT's own posts; checked on the bars, not yet ruled)

The owner asked for 10 examples per setup. These are the ones UCT's writers named; the facts are in 6.7. None is a ruled
example. MPWR is the only chart he has called "Good".

| # | Stock | Gap day | Which version it would teach | Why |
|---|---|---|---|---|
| 1 | MPWR | 2024-10-31 | the definition (his "Good") | first gap down out of a range near the highs, closed under both averages |
| 2 | GLD | 2025-10-21 | L, and the retest short ("Thursday was a reasonable short opportunity") | blow-off top; that Thursday (2025-11-13) the high reached 388.18, just under the gap day's high (388.89), and closed lower; no close back over the prior day's low until 2025-12-12, about seven weeks |
| 3 | SLV | 2026-01-30 | L and R ("a tap of $90-$95 zone at the bear gap") | blow-off top, true gap 15% on 5.7x volume |
| 4 | QQQ | 2025-11-04 | L | small gap that capped the index for about three months |
| 5 | BE | 2026-05-15 | L (a warning on a long) | "Gross bear gap off highs" |
| 6 | SNDK | 2026-06-26 and 07-01 | L | "two of them" (both overnight gaps, not full windows) |
| 7 | MRNA | 2026-08-20 | L | "big bear gap off highs on day two": the day after an 84% news gap up on 2026-08-19 (on the bars), so it is also shaped like Bracco's day 2 |
| 8 | FUTU | 2024-10-08 | P | Bracco's day-2 list; the app's rule also fires |
| 9 | CGC | 2021-02-11 | P | Bracco's day-2 list; the app's rule also fires |
| 10 | TSLA | 2020-02-05 | P | Bracco's day-2 list |
| 11 | DJT | 2024-10-30 | P | Bracco's day-2 list |
| 12 | AGQ / silver | 2026-01-15 (day 2, from the bars: opened 9.3% under Wednesday's close) | P (and its failure: "3 failed attempts over 2 sessions") | a loss example; the next session it fell further, then on 2026-01-20 it opened over the day-2 high |

---

## 9. Grading: A+ versus B-

House rule E50: grading is his judgment and no fixed checklist is taught as ours. These are observable cues from the
sources, for him to accept, change or drop.

**A+ (Version R)**
- The first gap down off a clear top or a range near the highs, on 2x+ volume, closing in the lower part of its range
  and through support (the range low, the 50-day). [Fleckenstein, ChartSchool, Bulkowski "high volume on the gap day"]
- A real reason: a guidance cut or earnings collapse in a crowded growth name. [Stockbee "earning torpedo"; Chan, Savor]
- Below a flat or falling 200-day, weak group, weak market reading. [house rule]
- A light-volume bounce into the gap zone and a declining 20-day or 50-day at the same price, then a clean rejection
  candle. [the owner; Fleckenstein]
- A stop within 3%, at least 5R of room to the gap-day low or the next support. [house rule; my proposal]
- The gap never filled. [UCT]

**B- (or pass)**
- A second or third gap off the same top. [measured]
- A bounce on heavy volume that pokes into the zone and closes near its high. [Fleckenstein]
- Still above the 200-day (not allowed unless Version P). [house rule]
- The market just flushed and breadth is washed out. [UCT: Bracco, the intro]
- A stop wider than 3%, an earnings report within 3 days, hard to borrow. [house rule]
- A no-news drop (more likely to reverse). [Savor]

**Version P:** A+ when most of Bracco's burst boxes are checked, the climax day is a clear hanging man or doji on the
highest volume of the run, and day 2 gaps down and never fills. B- when the burst is a rebound from a crash low rather
than a run to new highs (my test: those drove almost all of the positive result).

---

## 10. Questions for the owner

1. **What do you mean by "bear gaps off the highs"?** The log still waits on "one or two charts of what he means". Two or
   three of your own examples would settle most of this file. Is MPWR 2024-10-31 the model?
2. **Is it a short at all?** Options: (a) a level lesson only (Version L; matches the vocabulary, the course and how UCT
   writes about it); (b) a short setup; (c) both, level first. I recommend (c), with the short taught only as Version R
   and Version P.
3. **Off the highs: a top, or a range near the highs?** (a) any recent top (the app now); (b) a range near the highs, like
   MPWR; (c) your call per chart. And how far from the top may the prior close be: 30% (the app, which let in NFLX), 15%,
   or 10%?
4. **Earnings.** Your cuts were three "earnings breakdown" charts. Do you exclude earnings collapses, or only the one-day
   collapses straight off a fresh high? Note: in my test the earnings slice was the only positive one (section 4.3).
5. **The 200-day and RS.** B26 forbids shorts above the 200-day except parabolic. Most bear gaps off highs close above it
   (61%). Options: (a) Version R only below the 200-day plus Version P above it (my recommendation); (b) allow a bear gap
   short above the 200-day as a new exception; (c) no short at all. And is the bear gap a "mean reversion" trade exempt
   from the C31 RS mirror? Also: does B26's parabolic exception cover Bracco's day-2 variant at all, given that it has
   no climax-day gap up, the box Bracco himself will not short without?
6. **What counts as a gap?** (a) a full daily window (high under the prior low; the app now); (b) any open under the prior
   close that is not filled that day (your BE, GLW, MRNA examples); (c) a minimum size: 5% (the app), 1 ATR, or 4%. And
   volume: 2x (the app), 1.5x, or none (your SNDK gaps had 1.3x and 0.9x).
7. **The stop.** (a) over the trigger candle's high within 3% (A13); (b) over the gap day's high (median 4.2% in my test,
   25% on VRNS); (c) over the gap-fill level (Fleckenstein; median 9.4% on the deep scan, 26.8% on the 39 drafts). I
   recommend (a) and skipping wider ones.
8. **The first cover for shorts.** House 3R and 5R, or Bracco's daily 9 EMA (Version P), or the 10/20-day (Qullamaggie)?
9. **Which line does the chart emphasise?** The course says the gap day's high; the overlay labels the prior day's low.
   Options: (a) draw the zone between them as one band (my recommendation); (b) the gap day's high only; (c) the prior
   day's low only.
10. **Name and home.** "Bear gap", "Bear gap off the highs", or "Bear gap retest"? Its own unit (not SET.22 Gap Support)?
    A Model Book card and a journal tag?
11. **Should members be taught to short at all?** The Sunday Scans intro lists "No Shorting" as a starter rule; C37 starts
    new traders at 0.25%. Options: shorts only after 50 journaled trades, or only as a reading skill.
12. **Fix the evidence replay?** `measure_rules.py` counts the fill day's own low (short) or high (long) on close entries
    (section 4.2). Should it be fixed and the evidence files regenerated for all setups?
13. **Public quotes.** The vocabulary file keeps Sunday Scans text out of the public repo (golden set). Is it fine for this
    dossier to quote short excerpts, or should they move to a private file?

---

## 11. Sources (all read on 2026-11-09)

| # | Source | Publisher / author | Published | Reliability note |
|---|---|---|---|---|
| 1 | "Shorting Down Gaps", https://tradingmarkets.com/?p=667535 | TradingMarkets, Loren Fleckenstein | 2000-10-14 | Originator of the named "gap-down short". Read in full. Old (fractions, 2000 examples); a commercial site now. |
| 2 | "How to find high probability shorts", https://stockbee.blogspot.com/2007/02/how-to-find-high-probability-shorts.html | Stockbee, Pradeep Bonde | 2007-02-28 | His own blog, his own short method. Read in full. No stop or target. The "earnings torpedo" term is older (row 25). |
| 3 | "3 TIMELESS setups that have made me TENS OF MILLIONS!", https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Kristjan Kullamägi | 2021-01-08 | Originator, parabolic short only. Read in full. |
| 4 | "Gaps and Gap Analysis", https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis (read as .md) | StockCharts ChartSchool | not shown | Established educator. No author shown. |
| 5 | "TA 101, Part 15", https://chartschool.stockcharts.com/table-of-contents/overview/technical-analysis-101/ta-101-part-15 and https://articles.stockcharts.com/article/articles-chartwatchers-2009-11-technical-analysis-101-part-15/ | StockCharts, Chip Anderson | 2009-11-07 | Established educator. |
| 6 | "Gap Trading Strategies", https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/gap-trading-strategies (read as .md) | StockCharts ChartSchool | not shown | Educator; intraday rules; no evidence given. |
| 7 | "Bulkowski on Price Gaps", https://www.thepatternsite.com/gaps.html | Thomas Bulkowski | updated 2025-08-08 | Measured statistics. **AI-training notice.** Read through a fetch tool (plain requests refused, HTTP 406). |
| 8 | "Falling Window", https://www.thepatternsite.com/FallingWindow.html | Thomas Bulkowski | no page date shown (the "As of" date is the site's daily market box) | Measured. **AI notice.** Fetch tool. |
| 9 | "Island Reversals", https://thepatternsite.com/islandrev.html | Thomas Bulkowski | statistics updated 2020-08-26 | Measured. **AI notice.** Fetch tool. |
| 10 | "Bad Earnings Surprise", https://www.thepatternsite.com/earnsbad.html | Thomas Bulkowski | no page date shown (the "As of" date is the site's daily market box) | Measured. **AI notice.** Fetch tool. |
| 11 | "Dead-Cat Bounce", https://www.thepatternsite.com/dcb.html | Thomas Bulkowski | updated 2025-07-29 | Measured. **AI notice.** Fetch tool. |
| 12 | "Opening Gap Trading Setup -- Short Side", https://www.thepatternsite.com/gapsetups.html | Thomas Bulkowski | updated 2016-12-25 | Measured; a different setup (fades up gaps). **AI notice.** |
| 13 | "Bulkowski on the Kacher-Morales Setup", https://www.thepatternsite.com/KacherMorales.html | Thomas Bulkowski | not noted | Read by the writer; a long gap-up test, not relevant; nothing from it is used, so not re-checked. **AI notice.** |
| 14 | "Should You Buy or Sell Stocks that Gap Down?", https://www.quantrocket.com/blog/buy-or-sell-down-gaps/ | QuantRocket, Brian Stanley | 2020-09-02 | Vendor backtest; intraday; optimistic (parameter search). |
| 15 | "Learn Technical Trade Drivers: Bull Gaps and Bear Gaps", https://www.schaeffersresearch.com/education/expectational-analysis/technical-analysis/gaps | Schaeffer's Investment Research | not shown (footer 2021) | Established educator; level only. |
| 16 | Chan, "Stock Price Reaction to News and No-News: Drift and Reversal after Headlines", abstract via Crossref (SSRN, doi 10.2139/ssrn.262452); JFE 70: 223-260, 2003, doi 10.1016/S0304-405X(03)00146-6 | Wesley S. Chan | 2001 (SSRN), 2003 | Peer-reviewed; abstract only. |
| 17 | Savor, "Stock returns after major price shocks: The impact of information", abstract at https://repository.upenn.edu/fnce_papers/387; JFE 106(3): 635-659, 2012, doi 10.1016/j.jfineco.2012.06.011 | Pavel Savor | 2012 | Peer-reviewed; abstract only. The UPenn page refused the second check (403); the quote was re-checked on the first check's saved copy, and the journal citation on Crossref. |
| 18 | Bernard and Thomas, "Post-Earnings-Announcement Drift: Delayed Price Response or Risk Premium?", Journal of Accounting Research 27, 1989, doi 10.2307/2491062 | Crossref metadata | 1989 | Title only; not read. |
| 19 | IBD, "This Trading Rule Helped Investors Avoid Big Declines In Netflix, Super Micro, Tesla" (inkl copy) | Investor's Business Daily (inkl's listing names Scott Lehtonen; not confirmed on investors.com) | not confirmed | **Not read** (403 and a bot check, again in both checks); described from search excerpts only; nothing quoted. The Netflix day was checked on our bars (3.10). |
| 20 | TraderLion, "Wedge Drop: How to Sell Short" (https://web.archive.org/web/20250122064336/https://traderlion.com/technical-analysis/chart-patterns/wedge-drop-how-to-sell-short/) and "Downside Base n’ Break: A Guide to Short Selling" (https://web.archive.org/web/20250623153346/https://traderlion.com/technical-analysis/chart-patterns/downside-base-n-break-how-to-sell-short/) | TraderLion, Oliver Kell byline (third-person text) | 2024-07-11 and 2024-08-11 | Read in checking through Internet Archive copies (live pages refuse plain requests, 403). Quoted in 3.11. The second check could reach neither the archive nor the live site; it re-checked the quotes, byline and dates on the first check's saved archive copies (stamps 20250122064336 and 20250623153346). |
| 21 | O'Neil with Morales, "How to Make Money Selling Stocks Short" (Wiley; listings give December 2004 and January 2005); Morales and Kacher, "Trade Like an O'Neil Disciple" (Wiley, 2010; a "Golden Rules of Short-Selling" section reported by the first check is unconfirmed, see 3.10) and "Short-Selling with the O'Neil Disciples" (Wiley, 2015) | Wiley / O'Reilly | 2004-05, 2010, 2015 | **Not read** (O'Reilly 403; catalogue listings only). |
| 27 | Stan Weinstein, "Secrets for Profiting in Bull and Bear Markets" (1988) | Weinstein | 1988 | **Not read.** A lead added in the second check (3.10): the source of the "Stage 3 / Stage 4" vocabulary UCT's writers use when they talk about shorts. Nothing from it is used. |
| 22 | UCT Substack, all 103 posts listed in https://unchartedterritoryy.substack.com/sitemap.xml (read through the public post API); quoted posts linked in section 6 | Uncharted Territory: the owner (TSDR), Bracco, Manrav, Viotti, unsigned sections | 2025-06-01 to 2026-11-08 | House source. Quotes checked by script, then re-checked in checking against fresh API copies of each linked post, including which writer's section each quote sits in. One subscriber-only post (sunday-scans-bf1) read as preview only. Post dates are the API's publish dates (UTC). |
| 23 | Repo files: `api/services/study_hard.py`, `scripts/study/find_bear_gap_examples.py`, `docs/study/bank/spot.bear_gaps.json`, `app/src/pages/study/bearGapOverlay.js`, `app/src/pages/study/studyPlainRules.js`, `app/src/pages/study/challenges/hardMode.js`, `docs/study/TRADE_PLANS.md`, `docs/study/courses/V/V.05.json`, `app/src/pages/modelbook/setupCatalog.js`, `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`, `api/services/pattern_engine/sr_levels.py`, `api/services/pattern_engine/detectors/uct/parabolic_short.py`, `docs/study/levels/dossiers/bear_gap.md`, `docs/study/levels/external_research.md`, `docs/study/levels/evidence.md`, `docs/study/levels/evidence_atlas.md`, `docs/study/levels/measure_rules.py`, `docs/study/bank_v2/ATLAS.md`, `scripts/study/bank_v2/scan_history.py`, `docs/study/UNITS-method.md`, `docs/study/RESUME-PROMPT.md`, `docs/study/audits/2026-11-08/retire_ruled_cuts.json`, `docs/study/sizing_rule.md`, `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | this repo, branch feat/study-content | as of 2026-11-09 | Read directly. |
| 24 | Price data: the sandbox `bars.db` (opened read-only) and `docs/study/setups/earnings_dates_cache.json` | the app's own data | bars to 2026-11-06 | Split-adjusted daily bars; survivorship bias (current names only). |
| 25 | Skinner and Sloan, "Earnings Surprises, Growth Expectations, and Stock Returns or Don't Let an Earnings Torpedo Sink Your Portfolio", Review of Accounting Studies 7: 289-312, 2002, doi 10.1023/A:1020294523516; SSRN abstract via Crossref, doi 10.2139/ssrn.172060 | Douglas J. Skinner, Richard G. Sloan | 1999 (SSRN), 2002 | Peer-reviewed; abstract only. Added in checking: an earlier use of the "earnings torpedo" term. |
| 26 | "Connors Research Traders Journal (Volume 24): Beware of Large One-Day Drops", https://tradingmarkets.com/?p=1594205 | TradingMarkets, Larry Connors | 2018-07-31 | Established educator; opinion with one academic citation, no numbers. Added in checking. |

**Not used.** Secondary "negative EP" pages (therighttrader.com, tradezella.com, retail Substack summaries), TradingView
scripts, MarketBeat lists, forum posts, and AI-written explainer sites that appeared in searches. Al Brooks's "bear gap"
usage (only forum posts were found; removed in checking). Steve Nison's books (not available).

---

## Removed in checking

Cold check, 2026-11-09. Every quote in this file was re-found word for word in a fresh copy of its source (33 Substack
posts through the public post API, all 103 for the counts; the outside pages by plain download; Bulkowski's pages through
the fetch tool; the repo files; `owner_verdicts.jsonl`), and each UCT quote was checked to sit in the section of the
writer it is credited to. The code summaries were checked against `study_hard.py`, `find_bear_gap_examples.py`,
`bearGapOverlay.js`, `studyPlainRules.js`, `hardMode.js`, `sr_levels.py`, `measure_rules.py`, `scan_history.py`,
`setupCatalog.js`, `setupGroups.js` and the vocabulary file. The bar facts in 5.5, 6.7 and 8.11 were recomputed from
the sandbox `bars.db`; the 4.3 and 4.4 numbers were recomputed from the writer's saved event files and the 10-day
figures (9.2%, 43%) recomputed independently. All of those matched. What changed:

**Removed**
- The Al Brooks bullet in section 2 ("bear gap" in a broader sense). Its only basis was forum posts about his course,
  which are not sources; his own glossary could not be read.
- "Signed 'Bracco (@braczyy on X)'": that text is the post's subtitle; the post is signed "- Bracco".
- The quoted word "elimination" (6.4): the post says "ELIMINATE vs ADD" and "ELIMATION RULES"; replaced by an exact quote.
- "Bear gaps 'filled' or 'negated'" (8.7): neither word appears in that form; replaced by the exact phrases.
- The IBD byline (3.10, row 19): it came from search excerpts only; now marked unconfirmed.

**Fixed**
- Oliver Kell (sections 2 and 3.11, row 20): was "not readable, search excerpts only". Archive copies of the TraderLion
  pages were read; the gap-down Wedge Drop wording (DECK 2021, TMDX 2023) is now quoted from the page.
- Section 1: the owner's "shorting the hole" quote was introduced as "Shorts get squeezed in strong markets"; the quote
  is about shorting after a big fall when the pops are small, not about squeezes.
- Section 1 and 8.10: "big one-day drops usually bounce hard" and its [source consensus] tag rested on Bulkowski's
  dead-cat bounce sample alone; now stated as his sample's average (28% over 23 days), tagged as one source, next to
  Connors's opposite view.
- 3.1: Fleckenstein's 20% stop is a hypothetical sizing illustration, not a worked example.
- 3.5: the "100 million plus float" line is about float and borrow ("availability"), not liquidity.
- 3.7: Bracco's main parabolic short sets the initial stop at the day's high, then trails the previous 5-minute bar's
  high; it does not "trail from the day's high".
- 3.10: Netflix 2023-07-20 opened 6.4% lower and closed 8.4% lower (bars), not "gapping down more than 8%". The book
  list mixed a 2010 chapter with a 2015 book; both titles are now named, with the O'Neil and Morales book's listed date
  (December 2004, not 2005).
- 3.12 and row 18: Bernard and Thomas's full title.
- 3.15 (4): Chan and Savor find drift after news, not "only" after news.
- 4.2: the 39 drafts are not "the set the owner rejected"; he saw 8 (1 kept, 7 cut) and 31 are unshown.
- 5.4: the Model Book has four "both" cards, not three (Launchpad was missing). The `sr_levels.py` gap is a full window
  of at least 1 ATR (high under the prior low), and a "significant" close through the edge removes it. The levels
  dossier summarises the brain's knowledge base, not Discord notes as such.
- 5.6 (2): SNDK had two full windows in that stretch (2026-06-23 and 2026-07-07), both filled by 2026-07-10, not one.
- 6.1 and 7 (B20): the 2025 posts describe the same practice as B20; B20 itself is his 2026-11-09 ruling, so "the
  origin of B20" was an inference.
- 8.1: the "1 ATR is the app's level rule" basis measured something else (the window, not the open); [source
  consensus] tags that rested on one source now name two or are retagged [one source]; the prior-close edge of the gap
  zone is marked as a proposal. The [originator] tag is redefined: no one originated "bear gap off the highs", so it now
  marks the authors of named neighbouring setups.
- Rows 8 and 10: the "As of" dates are the site's daily market box, not page dates; row 10's title is the page's
  ("Bad Earnings Surprise").

**Added**
- 3.3: ChartSchool's "Partial Gap Down", the published name for the non-window gaps most UCT examples are.
- 3.5 and 3.12: the "earnings torpedo" term is older than Bonde's post: it is in the title of Skinner and Sloan's
  paper (SSRN 1999, journal 2002), whose abstract is quoted, and his own post points to a Michigan "Earnings Torpedo
  Warning list".
- 3.7, 8.0, 8.4 and question 5: Bracco will not short his main setup without a climax-day gap up, which the day-2
  variant lacks by definition, so B26's parabolic exception for Version P is the owner's call, not settled.
- 3.12: Larry Connors (2018) on large one-day drops.
- 5.5: the log's line 292, where the owner was unsure which lesson he was seeing when NFLX, GKOS, WWD and F were sent.
- 8.11: the GLD retest day (2025-11-13 reached 388.18, just under the gap day's high), the GLD fill date (2025-12-12),
  MRNA's gap coming the day after an 84% news gap up, and AGQ's day-2 date (2026-01-15).

**Checked and left as written, with limits**
- Bulkowski's quotes came through a fetch tool both times (his server refuses plain requests, HTTP 406), so they are as
  that tool returned them; the AI-use notice stands.
- The IBD article and the O'Neil, Morales and Kacher books stay unread; nothing is quoted from them.
- The 4.3 and 4.4 trade results were re-derived from the writer's saved event files, not from a fresh run of the
  trade simulator; the event rule and the management code were read and match their descriptions.

### Second cold check (2026-11-09, later the same day)

**What was checked.** All 289 quoted strings in the file were matched word for word against fresh copies: the 33 linked
Substack posts (and all 103 for the term count) through the public post API, with each UCT quote placed in the section of
the writer it is credited to and its post date read from the API (all 59 placed quotes sit under the right writer's
heading and carry the right date; "Trade Updates" opens "Bracco here", so the MSTR line is his); fresh downloads of the
Fleckenstein, Connors, Stockbee, Qullamaggie, ChartSchool, QuantRocket and Schaeffer's pages (authors, dates, example
dates and numbers confirmed: INTC Sept. 22 down 22% on "seven times" average volume, AAPL Sept. 29 down 52%, PCLN Sept.
27; QuantRocket "Wed Sep 02 2020 by Brian Stanley"); the six Bulkowski pages through the fetch tool (every number and
quote in 3.4 and 4.1 returned as written); Crossref records for the five papers (journals, volumes, pages, years, and the
Chan and Skinner-Sloan abstracts); the owner log (lines 212, 216, 288-297); and the repo files named in row 23 against
the code (`bear_gap_fires` thresholds and the first-crack loop, the finder's 400-bar and 260-session floors, its
120-day liquidity window, its score terms and the 8 cut-off, `_gap_cands`'s 1-ATR window and prior-low edge,
`replay()`'s fill-bar flaw, the hard-mode culmination rule, the four "both" Model Book cards, the 39 drafts all
`review_status: draft`, 34 earnings days, 38 above both averages, 37 `gap_held`). Every bar fact in 1, 3.10, 5.3, 5.5,
5.6, 6.7 and 8.11 was recomputed from the sandbox `bars.db` (all agree except the two fixed below), and the 4.3 counts
and medians (5,664 and 1,733 events, 19 of 21 bank drafts found, 66% earnings, 61% above the 200-day, 90% above it the
day before, medians -8.1%, -10.1%, 4.6x, 32%) and the 4.4 slices were re-derived from the saved event files.

**Fixed**
- 3.10 and row 19: Netflix 2023-07-20 was called "its largest one-day point drop since October 2022"; on our bars it is
  the largest one-day percentage drop since 2022-12-15 (which fell 8.6%), and by split-adjusted points the largest since
  2022-04-20. The IBD writer's name as shown on inkl is now given, still marked unconfirmed.
- 1 and 5.3: the VRNS stop over the gap day's high is 25.0% of the close (40.41 over 32.34), not 25.1%; the close sat 1%
  off the low.
- 3.10 and row 21: the "Golden Rules of Short-Selling" section attributed to the 2010 Morales and Kacher book could not be
  found in any catalogue listing reached (six chapters, the last "Riding the Bear Wave"); marked unconfirmed. The O'Neil
  and Morales book's date is given as the listings give it (December 2004 and January 2005).
- 3.11 and row 20: the TraderLion byline and dates now come from the archive copies' page metadata, and the third-person
  example is quoted exactly; the second check's inability to refresh those copies (archive and live site both refused)
  is stated.
- Row 17: the UPenn abstract page refused the second check; the Savor quote stands on the saved copy and Crossref.

**Added**
- 3.3: ChartSchool's one volume rule ("at least twice the average volume for the last five days", Modified Trading
  Method), which the comparison table had summarised as "2x for one variant".
- 3.10 and row 27: Stan Weinstein's 1988 book as an unread lead for Version R, because UCT's own short notes use his
  stage vocabulary.
- 4.4: the re-derived bootstrap ranges.

**Checked and left as written**
- Every proposed rule in section 8 is stated in measurable terms (a session count, a percent, an ATR multiple, a close
  relative to a line), and every [source consensus] tag names at least two agreeing sources that were re-read (8.7's
  rests on ChartSchool and Schaeffer's, which does say gaps may resist being "filled"); the [one source] and
  [originator] tags are honest as redefined.
- The two "gap" definitions in 5.6 (2) and 8.1 (an overnight gap from the prior close versus a full daily window) match
  the bars for SNDK: the 2026-06-26 gap closed back over the prior day's low on 2026-06-30 but never over the prior
  close by 2026-07-10, which is why the owner could still call it open.
- Nothing was removed in the second check.


## 12. Examples (from our data)

**The scan's rule (Version R of section 8, the bear gap retest short, plus the house rules).** Gap day: the stock's
250-session closing high (the top) was set within the prior 80 sessions and the close before the gap was within 15% of
it; the open was at least min(1 ATR14, 4%) under the prior close and the day's high stayed under the prior close (the
gap was not filled that day); no earlier gap of this kind since the top (first crack); volume at least 1.5x the 50-day
average; the day closed down at least 5% and in the lower half of its range; $10+ and $20M+ a day (B23). Gap zone: the
gap day's high up to the prior close (the prior low marked too when it is a full window). Rejection day, within 25
sessions: the high reached the zone, or the declining 20-day EMA or 50-day SMA, and the close was back under that level
and in the lower half of the range; no close above the zone's top edge since the gap (a fill ends the setup); the close
under the 200-day SMA (B26, hard); the bounce days averaged less volume than the gap day. Trigger, within 5 sessions:
price traded two cents under the rejection day's low, market order (E57; the open if it gapped past the trigger), no
chase more than 4% past the trigger (C28) nor more than 10% under the 10-day average (C29); stop two cents over the
rejection day's high, up to 5% of the entry (the median stop was 2.7%; section 8.5 allows a wider one at the lower
grade). Outcome: fixed stop, first of stop / 3R / 5R over the next 60 sessions, no trims and no trail. The scan covered
all 2,630 names that ever met the liquidity rule, 1984-2026, in 159 seconds; scripts in
`_study-resume/scratchpad/setups/27-bear-gap/` (scratch, not in the repo).

**Base rate.** 359 hits (first trigger 1997-02-27, last 2026-10-19): **25.3% reached 3R** and **14.2% reached 5R**
before the stop. Over the 60 sessions 311 were stopped at some point (262 before ever reaching 3R, 49 after reaching 3R,
14 of those after reaching 5R), 42 had reached 3R and were still unstopped when the window ended (37 of them past 5R),
and 6 ended the window under 3R without being stopped (311 + 42 + 6 = 359) (corrected 2026-11-10 against the bars) from the scan's hits.json: the
earlier text set the 311 stopped and the 51 that reached 5R beside each other as if they were separate groups, but 14 hits
are in both. Caveats: a fixed stop with no trims, no
breakeven move and no trail; a survivorship-tilted universe (delisted names are thin in the sandbox); the earnings rule
(B22 mirror, no new short within 3 days of a report), the RS filter (C31 mirror), the borrow rule (D48) and the market
reading (8.9) were not applied by the scan. Slices worth his eye (small samples, not conclusions): the top set 15+
sessions before the gap (a range, his MPWR shape) reached 3R 69/256 = 27% against 22/103 = 21% when the gap came
straight off the top (the "earnings breakdown" shape he cut); a stop of 3% or less 61/216 = 28% against 30/143 = 21%
wider; a falling 200-day 29/109 = 27% against 62/250 = 25% still rising; rejection at the 20-day EMA 61/244 = 25%, at
the gap zone itself 26/106 = 25%, at the 50-day SMA 4/9. Earnings gaps (236 hits, 62 reached 3R = 26%) and news gaps
(91 hits, 26 = 29%) did about the same; 32 gaps before 2005 or on names without report dates could not be classed.
Against section 4's test (shorting the gap day's close: no edge), waiting for the bounce and the rejection is where the
structure of a tradable short appears, though a 25% hit rate at 3R needs the trims and the trail to pay.

**The ten examples** (one per ticker, ten different years; every chart looked at; the gap classed by the report dates in
`earnings.db`, "news" = no report in the reaction window). Short = the entry (the rejection day's low less two cents,
or the open when it gapped through); best R = the best price before the stop, within 60 sessions. None of the ten was
triggered within 3 days of a report.

| # | Stock | Gap (kind), short | Structure | Short | Stop | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|
| 1 | VRSN | 2008-07-07 (news), 2008-07-14 | top 2008-06-04, 22 sessions before, prior close 13% off; open -3.4%, day -9.5%, 6.1x vol, full window; zone 35.52-36.74; rejected at the zone's bottom edge on 2008-07-11, +4 sessions | 35.11 | 36.24 (3.2%) | 13.1R (5R) | the fastest form: a four-day pop back to the gap, a red rejection candle, then eight weeks down; 200-day still rising, price under it |
| 2 | LDOS | 2010-03-31 (earnings), 2010-04-28 | top 2010-02-26, 23 sessions before, 3.7% off; open -5.9%, day -6.7%, 4.9x, full window; zone 44.69-46.86; rejected in the zone on 2010-04-27, +18 sessions | 44.40 | 44.98 (1.3%) | 6.9R (5R) | a range near the highs, the gap out of it, a 20-day grind back into the zone under a flat 200-day, and a 1.3% stop |
| 3 | OI | 2011-06-15 (news), 2011-07-08 | top 2011-05-12, 23 sessions before, 10.5% off; open -7.9%, day -13.5%, 6.7x, full window; zone 27.45-29.54; rejected at the 20-day EMA (26.82) on 2011-07-07, +15 sessions | 26.39 | 27.09 (2.7%) | 17.7R (5R) | the bounce stalled under the declining 20-day and the zone, the trigger came the next day, and the stock lost a third in six weeks |
| 4 | GRFS | 2014-07-31 (earnings), 2014-09-05 | top 2014-06-09, 37 sessions before, 9.1% off; open -9.1%, day -13.1%, 5.0x, full window; zone 19.18-21.11; rejected at the 50-day SMA (19.93) on 2014-09-04, +24 sessions | 19.50 | 20.04 (2.8%) | 9.0R (5R) | the 50-day version of the owner's "pop back up and rejection coinciding with the 50SMA or 20EMA": the bounce reached the zone and the 50-day together, a hair under the 200-day |
| 5 | HWM | 2018-02-05 (earnings), 2018-03-14 | top 2018-01-12, 15 sessions before, 5.6% off; open -5.9%, day -8.9%, 3.3x, full window; zone 21.25-22.32; rejected at the 20-day EMA (19.28) on 2018-03-12, +24 sessions | 18.94 | 19.38 (2.3%) | 14.0R (5R) | a five-week shelf under the gap with the 20-day and 200-day both overhead, then a second gap down and a 25% fall |
| 6 | DLTR | 2019-11-26 (earnings), 2020-01-03 | top 2019-10-22, 25 sessions before, 5.1% off; open -14.8%, day -15.2%, 15.1x, full window; zone 98.98-112.39; rejected at the 20-day EMA (94.25) on 2020-01-02, +24 sessions | 93.01 | 94.71 (1.8%) | 19.3R (5R) | the cleanest chart: a 15% gap on 15x volume, a flat five-week bounce to the 20-day under the 200-day, a 1.8% stop; the tail of the move was the 2020 market's |
| 7 | MDT | 2021-10-18 (news), 2021-10-28 | top 2021-09-08, 28 sessions before, 5.5% off; open -3.7%, day -5.5%, 2.6x, full window; zone 123.26-127.75; rejected at the zone's bottom edge on 2021-10-27, +7 sessions | 122.03 | 124.71 (2.2%) | 8.8R (5R) | a small gap in a large-cap: the bounce tested the zone's bottom edge on quiet volume and failed, with the 200-day about 1% overhead |
| 8 | EEFT | 2023-07-26 (earnings), 2023-08-31 | top 2023-05-22, 44 sessions before, 3.3% off; open -7.6%, day -20.0%, 12.3x, full window; zone 108.00-116.88; rejected at the 20-day EMA (88.04) on 2023-08-30, +25 sessions | 87.63 | 89.13 (1.7%) | 9.2R (5R) | a nine-week range at the highs, a 20% gap day, a slow 25-session bounce on light volume to the 20-day far under the 200-day |
| 9 | ACGL | 2024-10-31 (earnings), 2024-12-03 | top 2024-10-04, 19 sessions before, 8.5% off; open -2.9%, day -6.3%, 2.2x, full window; zone 103.21-105.14; rejected at the 20-day EMA (100.41) on 2024-12-02, +21 sessions | 99.24 | 100.95 (1.7%) | 6.9R (5R) | the smallest gap of the ten (just over 1 ATR); the lesson is the rejection right under the 200-day and the 1.7% stop; the stock rolled 10% lower |
| 10 | LPX | 2025-02-19 (earnings), 2025-03-27 | top 2024-12-06, 48 sessions before, 6.1% off; open -6.2%, day -10.1%, 3.9x, full window; zone 108.41-112.94; rejected at the 20-day EMA (95.52) on 2025-03-26, +25 sessions | 93.81 | 96.42 (2.8%) | 5.7R (5R) | a double top, the gap under the 200-day, the 25-session bounce capped by the 20-day; the move ran to 5R in two weeks and then reversed, the case for the trims |

Charts: `_study-resume/scratchpad/setups/27-bear-gap/final/01_VRSN_2008-07-14.png` to `10_LPX_2025-03-27.png`, the
sheets `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`, and `examples.json` with every number. Each chart draws the
gap zone as a box from the gap day to the rejection day, and the short, the stop, 3R and 5R as lines.

**Notable failures (in words).**

- **DIS, 2015-08-05 gap (earnings), shorted 2015-09-10.** The gap came one session off the top on 10x volume, the kind
  the owner cut as "just an earnings breakdown"; the bounce to the 20-day was rejected, but the trigger day was the low
  of the move and the stock reversed up through the stop at once (best 0.0R). An earnings collapse straight off a top is
  a different animal from a gap out of a range, and the first rejection after it is often a shakeout.
- **BMRN, 2020-08-19 gap (news, a 35% day on 27x volume), shorted 2020-09-24.** The gap was textbook, the 20-day
  rejection came after 24 sessions, the trade reached 1.3R, then the stock rallied through the stop. After a drop that
  large the 20-day sits far under the gap zone and the short is into a stock already 40% off its high: the dossier's
  warning about shorting late (8.10, item 3) and about big drops bouncing (Bulkowski's dead-cat sample).
- **CIEN, 2017-08-31 gap (earnings), shorted 2017-09-29, and CHKP, 2017-11-01 gap (earnings), shorted 2017-12-07.**
  Both rejected at the 20-day after 19 to 23 sessions with tight stops (1.3% and 2.4%), both stopped at once (best 0.0R)
  while the general market was in a strong uptrend. The stock under its own 200-day satisfies B26, but section 8.9's
  market condition (a Red or Orange reading) was not met; the scan did not check the market, and the course should
  probably say that a bear gap short needs the market's help.

Limits: the earnings database is complete only from about 2005, so VRSN (2008) and OI (2011) are classed as news gaps
on the absence of a report in the reaction window; any pre-2005 hit would be a guess and none was picked. None of the
ten is an ETF; none shows a split or a reused ticker in the bars. The ten are the scan's winners chosen for clarity and
spread, not a random sample: the base rate above is the honest number.


## 13. Failures and near-misses (from our data)

(Charts 2026-11-10, same scan and same render as section 12, in `_study-resume/scratchpad/setups/27-bear-gap/final/`:
`fail_1-4.png`, `near_1-4.png`, `pair_23-news-failure.png`. The near-misses come from `near_scan.py`, the Version R
rule re-run with the gap-day and rejection-day gates turned into flags, keeping the candidates that fail exactly one
gate (`final/near_hits.json`, 2,630 of 2,630 names). Short = the rejection day's low less two cents (or the open if it
gapped through); stop two cents over the rejection day's high; "where it stopped" is the first session whose high
reached the stop. QQQ against its 50-day is read off the bars; the market reading itself is not in the scan.)

**Four valid bear gap retest shorts that lost (every scan gate passed, traded by the rules).**

| # | Ticker, date | The gap and the rejection | Short | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | DIS 2015-09-10 | gap 2015-08-05 (earnings; -8.9% open, -9.2% day, 10.1x volume), the top set 1 session before the gap; rejected at the 20-day EMA on 2015-09-09, 24 sessions after the gap | 101.66 | 104.97 (3.3%) | day 5, 2015-09-17, high 105.95 | 0R: the trigger day was the low of the move. 20 sessions later the close was 104.61, 2.9% above the entry. QQQ was 3.1% under its 50-day, so the market was not the problem. | bg.earnings_breakdown (an earnings collapse straight off a fresh high, the shape he cut); bg.stop_width (3.3%, over the 3% line) |
| 2 | CIEN 2017-09-29 | gap 2017-08-31 (earnings; -8.7%, -11.0%, 11.0x), the top 63 sessions before; rejected at the 20-day EMA on 2017-09-28, 19 sessions after the gap | 21.96 | 22.25 (1.3%) | day 1, 2017-10-02, high 22.57 | 0R, stopped the next session. QQQ closed 1.0% above its 50-day that day: no Red or Orange reading. The stock was 4.7% lower 20 sessions later, but the stop had already gone. | bg.market |
| 3 | BMRN 2020-09-24 | gap 2020-08-19 (news; -27.6%, -35.3%, 26.6x), the top 22 sessions before; rejected at the 20-day EMA on 2020-09-23, 24 sessions after the gap | 77.40 | 80.26 (3.7%) | day 12, 2020-10-12, high 80.46 | 1.26R at best, -0.77R at the close of day 10, then through the stop. The short came 40.9% off the top, with the 20-day far under the zone. | bg.not_late; bg.time_stop (under 1R after 10 sessions: cover); bg.stop_width |
| 4 | NFLX 2021-05-04 | gap 2021-04-21 (earnings; -7.6%, -7.4%, 6.2x), the top 63 sessions before; rejected at the gap zone on 2021-05-03, 8 sessions after the gap | 50.50 | 51.92 (2.8%) | day 36, 2021-06-24, high 52.10 | 1.86R by day 11 and never 3R. The close went back over the 20-day EMA on day 12 (2021-05-20) and the stop finally went on the close back over the 200-day. | bg.trail (the close over the average is the cover); bg.inv_200 |

**Four near-misses (the chart looks like a bear gap retest short; exactly one gate fails).**

| # | Ticker, date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| 1 | TSLA 2014-10-30 | bg.below_200 | the rejection day closed 5.9% above the 200-day SMA (rule: under it) | a gap in a stock still above its 200-day: a pullback in a leader, the owner's mean-reversion buy side, not a short. Stopped at 0R |
| 2 | CMCSA 2015-09-04 | bg.gap_day | the gap day (2015-08-24) opened -6.0% but closed down only 4.2%, at 70% of its range (rule: down 5% or more, in the lower half) | a gap bought back the same day: the news failing, closer to a News Failure (23) than a bear gap. Stopped at 0R |
| 3 | CDNS 2024-08-12 | bg.rejection_candle | the rejection day (2024-08-09) closed at 82% of its range (rule: the lower half) | a strong bounce into the 20-day with buyers in control (bg.inv_strong_bounce). Stopped at 0R |
| 4 | VZ 2026-07-20 | bg.gap | the open was 2.1% (0.89 ATR) under the prior close (rule: at least 1 ATR or 4%) | an ordinary down day with no gap zone to defend. 0.2R, then stopped |

**What the four losses have in common.** In all four the gap itself was textbook (6x to 27x volume, 7% to 35% days,
a clean rejection candle). The loss came from what surrounded the gap: a top only one session old (DIS), a strong
general market (CIEN), a short taken 41% off the top with the zone far overhead (BMRN), and a slow trade that needed
the trail rather than the fixed stop (NFLX). Three of the four were stopped at 0R within five sessions; the fourth was
a management lesson. For the member: the gap is the level, and the bounce, the market and the distance from the top
decide the trade.
