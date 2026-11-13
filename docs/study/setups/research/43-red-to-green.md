# Setup 43: Red to Green (long) and Green to Red (short)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page named next to it.
- **Checked word for word against a saved copy** (downloaded today and searched by a script): UCT's Substack (all 103
  posts in https://unchartedterritoryy.substack.com/sitemap.xml, read through the public post API), Investors
  Underground (two 2017 posts), StocksToTrade (two posts by Tim Bohen), the Bear Bull Traders forum thread, QuantRocket,
  StockCharts ChartSchool (two pages), Larry Williams' own site and the Wiley excerpt of his book, two Linda Raschke
  interviews posted on her own site, qullamaggie.com, two journal abstracts through Crossref, and our own code and docs.
- **Cold check, 2026-11-09 (a second session, working from fresh downloads of every source above).** Every quote in this
  file was searched for in the fresh copies by script; the Bulkowski sentences were confirmed one by one through the
  fetch tool; the owner's rulings, the rulebook numbers and every code line and line number were re-read in the repo
  (commit 3556ebf263); the test tables were re-derived from the writer's saved data where the saved summaries did not
  show a number (the failed-reclaim rule, Table 4, the section 4.8 candidates, the AEHR row). The one source that could
  not be re-read is Investopedia (HTTP 402 to a plain download, and the fetch tool refuses the domain); its two quotes
  were dropped and replaced with StockCharts' definitions of the same terms.
- **Second cold check, 2026-11-09 (a third session).** Everything was downloaded again (all 103 Substack posts through
  the post API, the 23 outside pages and PDFs, both journal records through Crossref, Bulkowski through the fetch tool),
  118 quoted passages were matched word for word by script against those copies and the repo files, every UCT quote
  was traced to the newsletter section it sits in, every code line was re-read at commit 3556ebf263, and the numbers in
  Tables 1 to 5, the failed-reclaim rule, the section 4.7 rows (AEHR included, from the daily bars) and the section 4.8
  candidates were re-derived from the saved trade tables. Every quote and every number held. What changed is one
  misattribution and a few wordings, listed under **"Removed in checking"** at the end (the earlier check pointed to
  that section but had not written it).
- **Read only through a fetch tool** (plain downloads refused with HTTP 406): Thomas Bulkowski's two opening gap pages.
  I read each page twice with different prompts and the two reads agreed. **His site states a notice against AI use:**
  "This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems, technologies,"
  I cite it with links and short quotes only.
- **Could not read:** Andrew Aziz's book itself (only members quoting it on his firm's forum), Warrior Trading (HTTP
  403), SMB Capital (no page found), the *Stocks & Commodities* archive (HTTP 403), Bullish Bears (HTTP 403), TraderLion,
  UCT's private Discord and members' videos.
- **My web search allowance ran out after one search** (the session-wide limit). Everything else came from pages I
  already knew, links on those pages, or the sites' own sitemaps. Section 11 lists the gaps. A fuller search may find
  more educators who use the term; I doubt it would find an originator, because none of the pages I read names one.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the person who named a
rule (there is no single originator for this setup, so this tag marks the named educator whose rule it is);
**[UCT]** the owner, Bracco or the Substack; **[house rule]** the account rulebook, `docs/study/sizing_rule.md`
section 9; **[measured]** our own tests in section 4; **[my proposal]** my recommendation, for the owner to accept or
change.

Terms. **c1**: the prior day's official closing price (the "prior close"). **o, h, l, c**: the day's open, high, low and
close. **Red**: the stock is trading below c1, so quote screens show a negative change. **Green**: trading above c1.
**R2G**: red to green, the first trade back above c1 after trading below it. **G2R**: green to red, the mirror.
**Gap down**: the day opens below c1. **Partial gap**: opens below c1 but inside the prior day's range. **Full gap**:
opens below the prior day's low. **LOD / HOD**: low or high of the day. **R**: the risk on the trade (entry minus stop).
**DCR**: where a day closed in its range (0 = at the low, 1 = at the high). **RS**: relative strength rating (1 to 99).

---

## 1. What it is, and the psychology behind it

**In two plain sentences.** A stock that is trading below yesterday's close (red on every quote screen) trades back
above that close (green), and the buy is that cross, with the stop under the day's low. Green to red is the mirror: a
stock trading above yesterday's close falls back through it, and the short is that cross, with the stop over the day's
high.

**Why the line matters.** The prior close is the one price every quote screen, broker app and scanner measures from.
Investors Underground puts it this way: "When a stock goes from red to green, the share price moves from below the
previous close to above the previous close." Everyone sees the color change at the same moment, so the line
collects orders and attention.

**Who is trapped, who is buying (long side).**
- The sellers who hit the open. A gap down usually comes from orders that piled up overnight. QuantRocket describes the
  textbook reasoning: "The selling pressure immediately exhausts itself, however, leading the stock to recover through
  the remainder of the session." If price climbs back over the prior close, everyone who sold the open, and anyone who
  shorted the weak open, now sits on a loss.
- The buyers who were scared out. The owner's version adds a dip into support (a rising 20-day average, a breakout
  level). The dip shakes out weak holders; the cross back over the prior close shows that real buyers absorbed it. The
  owner's words: a gap down and red to green gives "clear risk area and presence of buyers" (Sunday Scans, 2025-12-28).
- The risk is defined by the day itself. The low of the dip is a price the stock just rejected, so a stop a few cents
  under it is tight and logical.
- The supply that can stop it. Tim Bohen (StocksToTrade) points at the people who bought high the day before: if the
  prior day faded hard, they wait for breakeven and sell into the cross. His words: "Because when it closes near its
  highs, it doesn't create bag holders and give traders regret."

**Who is trapped (short side, green to red).** A stock opens above the prior close and the opening buyers pay up. When
price falls back under the prior close, those buyers are underwater and the move has failed. Bracco describes the same
crowd on a gap down the day after a climax: "The gap down the following day is key, as longs from the previous close
are underwater and short sellers take advantage." Academic work finds that overnight gains tend to reverse during the
trading day that follows, mostly in stocks that retail investors are watching (Berkman and others, 2012, abstract).

**What it is not.** It is not an edge on its own. In our tests (section 4.6) buying every red to green cross, or every
day that closed red to green, made about the same as buying a random moment with the same kind of stop. The owner uses
it as the **trigger** inside a setup he already likes (a leader pulling back to its 20-day average, a post-earnings
flag, an inside day). Bohen uses it the same way, as confirmation in a stock he is already watching; the 2017
Investors Underground posts and Aziz's book treat it as a day trade.

## 2. Origin and naming

**Short answer: no single person named it.** "Red to green" is day-trading-room slang taken from quote-screen colors.
None of the pages I read names an originator or a first date, and I could not search further (search allowance spent).
The earliest dated, attributable uses I could read are from 2017. The idea itself (a gap that fills, an open that
fails) is much older and has other names.

| Name | Who | Where and when (verified) | What it covers |
|---|---|---|---|
| **Red/Green Moves** | Investors Underground, byline "InvestorsLive" (a reader comment addresses the author as "Nate"; I did not verify the person behind the handle) | "5 Day Trading Strategies & Ideal Chart Setups", 23 Mar 2017, and "7 Actionable Trading Strategies and Lessons from Textbook Trading", 2 May 2017 (investorsunderground.com) | The cross of the prior close in either direction, as an intraday trade |
| **Red-to-Green move / Green-to-Red move** | Andrew Aziz, *How to Day Trade for a Living* | **Not read.** Members of his firm's forum (Bear Bull Traders) quote the book's chapter in posts dated April and December 2018 (section 3.2). The passage existed by April 2018; I did not confirm the book's year or chapter from the book or its publisher | The cross of the prior close by gapped "Stocks in Play" |
| **Weak open red-to-green** | Tim Bohen, Lead Trainer, StocksToTrade | Posts of 20 Dec 2022 and 29 Jan 2024 (stockstotrade.com) | Intraday cross after a weak open, in runners and "real stocks" |
| **R2G / G2R** | Forum shorthand | Bear Bull Traders forum, 29 Dec 2018 | Same |
| **Gap down red to green; gap down reversal; red to green spot; reclaim of red to green** | UCT: the owner (TSDR), Bracco | Substack from 2025-06-08 (section 6) | The cross of the prior close after a gap down, used as the entry trigger in a swing setup |
| **r2g** | VIOTTI (UCT contributor; the post's CONTRIBUTORS section, under "VIOTTI - BKSY") | Substack, 2026-03-25 | Same, as an add point |
| **Red to Green / Red to Green (Intraday) / Green to Red** | UCT app journal tags | `app/src/constants/setupGroups.js` lines 16 and 23 | Labels for trades |

**Older relatives with their own names** (not the same rule, named so the course can tell them apart):
- **Oops!** (Larry Williams): his site's timeline lists "NUMEROUS TRADING PATTERNS- 1981. OOPS! Fakeout, Delayed and
  Hidden OOPS!, Pinch and Paunch, etc." (ireallytrade.com/innovation). The Williams Oops opens under the prior day's
  LOW and trades back to it, a full-gap version with a different line. UCT's Oops Reversal includes red to green as one
  of its steps (dossier 30).
- **Gap fill / closing the gap** (StockCharts, Investopedia, Bulkowski): price returning to the prior close after an
  opening gap. A same-day gap fill on a gap down is a red to green touch.
- **Three-Day Unfilled Gap Reversal** (Linda Raschke; the rules are printed in her August 1997 AIQ interview, whose
  first question names her book *Street Smarts* and says "you give several strategies for short term traders"; whether
  this pattern is in the book was not confirmed, because the book was not read and the interview does not say so): the
  opposite idea, a gap down that does NOT fill, bought later above the gap day's high (section 3.5).
- **Opening Gap Trading Setup, long and short** (Bulkowski, updated 2016): fades of large opening gaps (section 3.6).
- **U-Turn** (Bracco, "The Parabolic Short", 2025): a gap-up climax day that fails; a cousin of green to red (section
  3.8).

**Name collisions to avoid:**
- **First Green Day** (Timothy Sykes and StocksToTrade, sitemaps list several posts): the first day that closes up after
  a run of down days. A multi-day pattern, not the intraday cross.
- **Red Dog Reversal** (Scott Redler, T3 Live; read in checking at https://www.t3live.com/blog/?p=28329): our repo
  already notes it "is NOT Red-to-Green" (`docs/superpowers/research/setups/setup_criteria.json`), but that file calls it
  "SMB's published named reversal", which is wrong: the page is Redler's own lesson. His line is the prior day's LOW,
  not the prior close: the "stock is a short-term pull back often for 2+ days and trades below a prior day low", then
  reclaims it. That is a prior-low reclaim (our Oops / undercut-and-rally family), not a red to green.
- **Red or green CANDLE** (close versus the day's OPEN). Some traders mean the candle color, not the prior close. A
  TradingView user post (2021) builds its version on "the daily open line". The app's hourly Go Signal finder also uses
  close versus open (section 5). The owner's 2026-11-01 ruling names the prior close (section 6). This is the biggest
  naming trap in this setup and needs one answer from the owner (section 10, question 2).

## 3. Every definition I could find, source by source

### 3.1 Investors Underground (2017; established day-trading educator; read today)

Two posts by "InvestorsLive".
- 23 Mar 2017, "5 Day Trading Strategies & Ideal Chart Setups", section "Red/Green Moves (Long Trades)":
  - The line: "When a stock goes from red to green, the share price moves from below the previous close to above the previous
    close."
  - Why: "This represents a significant shift in momentum that can be used to plan a trade with set risk around the
    previous closing price."
  - What follows: "Often times, the stock will become more volatile during this momentum shift, providing for great
    intraday trading setups."
- 2 May 2017, "7 Actionable Trading Strategies and Lessons from Textbook Trading", section "Red/Green Moves":
  - "This represents a shift in momentum that is often greeted with more buyers (meaning the price will increased at a
    faster rate)."
  - The entry idea: "Your goal should be to anticipate this" red to green move, and "You can do this by looking for
    gearing/perking action and waiting for a stock to set higher intraday lows."
- Criteria given: the line (prior close) and the idea of anticipating it with higher intraday lows. No gap rule, no
  trend rule, no stop beyond "set risk around the previous closing price", no target, no volume number. Intraday only.

### 3.2 Andrew Aziz, *How to Day Trade for a Living* (book NOT read; quoted by members of his firm's forum)

The Bear Bull Traders forum thread "stuck on Red to Green..." (https://forums.bearbulltraders.com/topic/283-stuck-on-red-to-green/)
has members quoting "Andrew's chapter". I could not check these against the book. As quoted there:
- Red to green (posted 16 Apr 2018 by the member DougT, "from Andrew's book"): "if the price is lower than the previous
  day close (for stocks that gapped down), the market is moving from a Red day to a Green day"
- Green to red (posted 28 Dec 2018 by the member sandstorm, "the excerpt from Andrew's book"): "If the current price of
  the stock is higher than the previous day close (for Stocks in Play that gapped up), the market is moving from a Green
  day to a Red day"
- Members found the wording confusing. A member (Robert H, 29 Dec 2018) endorsed another member's rewrite ("@Dima
  summed it up nicely"): "Price is currently red and moving towards previous day close => R2G". That is a member's
  reading, not the book.
- Criteria given (as quoted): a gapped stock, the prior close as the line, the direction of travel toward it. Stop,
  target, volume and trend are not in the quoted lines. Reliability: secondhand; treat it as what the book appears to say.

### 3.3 Tim Bohen, StocksToTrade (educator; read today)

- 20 Dec 2022, "The key component of the red-to-green pattern": he said NO to a "weak open red to green" in a stock that
  ramped and then pulled back hard into the prior close. The rule: "A key component of the weak open red-to-green move
  is for the stock to close at or around the high." (the PRIOR day). Reason: a prior day that fades leaves buyers who
  will sell at breakeven into the cross. Criteria: weak open; prior day closed at or near its high; a price level ($5 in
  his example) the stock must clear.
- 29 Jan 2024, "The only time a gap down is a good thing": in larger, multi-day movers he waits for a pullback, "Then
  I can look for confirmation of more potential upside when it goes from red to green" and "That proves that buyers are
  still in control." His example "consolidated along VWAP most of the day and went from red to green in the afternoon."
  He adds: "The red-to-green pattern is one of my favorite patterns to look for in real stocks this time of year." And:
  "And my standard approach to these real stocks is to wait for confirmation before entering a trade."
- Criteria given: a weak or red open, a prior day that closed strong, VWAP holding, the cross as confirmation. No stop or
  target is stated in these two posts. The site's footer lists an "AI Use Disclosure". Both posts carry Tim Bohen's byline and a
  date; I cannot tell whether or how the site's AI use touched them.

### 3.4 Larry Williams (originator of the Oops, the nearest named relative; read today)

- His site dates the Oops to 1981 (quote in section 2). His book chapter on the Oops was not read (dossier 30 has the
  details and the page numbers).
- His general view of the open, from the Wiley excerpt of *Long-Term Secrets to Short-Term Trading* (2nd ed., 2011,
  Chapter 1): "The opening price, as you will see later on, is the most important price of the day."
- How it differs: the Williams Oops needs an open below the prior day's LOW and a rally back to that low. Red to green
  needs only a trade below the prior CLOSE and a rally back over it. Every Williams Oops that keeps going up through the
  prior close is also a red to green; most red to greens are not Williams Oops.

### 3.5 Linda Raschke (originator-level trader; two interviews on her own site; read today)

- AIQ *Opening Bell*, August 1997 (an interview that introduces her as the author of *Street Smarts* and says "Many of
  the patterns discussed in Street Smarts actually have a mechanical entry or trigger"), her "Three-Day Unfilled Gap
  Reversals" rules, quoted in part: "Today the security gaps lower and does not fill the gap." Then "Over the next
  three trading sessions, have in place a buy stop one tick above the high of the gap-down day." and "If filled, place
  a protective sell stop at the low of the gap-down day." On her sell examples: "the pattern on the sell side is simply
  a reverse of the buy side." This is the OPPOSITE of red to green: it wants the gap left open and buys the reversal
  days later. It shares the stop: under the gap day's low.
- *Active Trader*, February 2004, interview by Mark Etzkorn. On gaps: "A large gap means one side is caught off
  balance." A pull quote in the same article: "In a down-trending market, an early gap up is a short 95 percent of the
  time." That is her claim in an interview mostly about her S&P futures trading, with no sample or method given. It is not a measured
  statistic (section 4.5). On a momentum buy setup, the caption says that had the market opened flat or gapped down "it
  would have been an immediate buy": a weak open in a buy setup is the entry, the same idea as UCT's.

### 3.6 Thomas Bulkowski, ThePatternSite (measured statistics; read through a fetch tool; AI notice)

- "Bulkowski's Opening Gap Trading Setup -- Long Side" (https://www.thepatternsite.com/gapsetupl.html, updated
  12/25/16): "The opening gap trading setup relies on a large downward price gap when the market opens for the day". The
  trigger is not the prior close: "When the candle color changes from black to white and price fails to make a new
  low," then "place an order to buy a penny or two above the candle's high" on the 5-minute chart. Stop: "Place a stop a
  penny or two below the candle's low". Target: "For profit potential, measure from the prior day's high to the trend low
  today then take half of it".
- "Bulkowski's Opening Gap Trading Setup -- Short Side" (https://www.thepatternsite.com/gapsetups.html, updated
  12/25/16): the mirror on large up gaps, short "a penny or two below the candle's low", stop "a penny or two above the candle's high".
- Why it is here: these are intraday fades of opening gaps, and his pages carry the best published numbers on how often
  a gap closes back to the prior close (section 4.1). His trigger (the first 5-minute candle that turns) comes EARLIER
  than a red to green, and his target is half the distance from today's low back up to the prior day's high, not the
  prior close.

### 3.7 Kristjan Kullamagi (originator of his three setups; read today)

He does not use the words red to green in the page I read. His intraday-entry stop rule is the clearest originator rule
for the stop this setup uses, so it is listed for the stop column only. From "3 TIMELESS setups that have made me TENS OF MILLIONS!"
(qullamaggie.com): "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock". His
entry is the opening range high, not the prior close.

### 3.8 Bracco, "The Parabolic Short" (UCT, 2025-06-13; read today)

The green to red cousin on climax days. His "U-Turn": the day "begins with a gap-up and an opening range breakout", then
sellers appear "typically 10 to 60 minutes after the market opens". Entries: "The first entry is triggered by a
breakdown below VWAP, followed by a second short opportunity when the stock breaches the day's lows." Stop: "setting my
initial stop at the day's high". He credits Lance Breitstein for the "Right Side of the V": "For a parabolic short, I am
always waiting until the intraday trend flips to the downside. I will never take an entry until the stock at least
breaks below the intraday VWAP". His trigger line is VWAP and the day's low, not the prior close. He does not use the
words green to red.

### 3.9 QuantRocket (Brian Stanley, 2 Sep 2020; a software vendor's backtest; read today)

"Should You Buy or Sell Stocks that Gap Down?" Universe: common stocks in the top 10% by dollar volume that closed above
their 20-day average; gaps that open at least one standard deviation below the prior day's LOW (a full gap). Buying one
minute after the open and holding to the close lost; shorting instead won (section 4.2). His conclusion: "Stocks tend to
recover after small down gaps and keep dropping after large down gaps." And the reason he gives: "A small down gap
leaves the uptrend intact; thus the gap is a buying opportunity." Not a red to green rule (no prior-close trigger), but
the best evidence I found on WHICH gap downs get bought.

### 3.10 StockCharts ChartSchool, two pages (educator; read today and re-read in checking)

- "Gaps and Gap Analysis": a gap getting filled "means that the price action at a later time (a few days to a few
  weeks) usually retraces, at the least, to the last day before the gap." Common gaps "usually get filled fairly
  quickly". A vocabulary source; no trade rule.
- "Gap Trading Strategies" (https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/gap-trading-strategies):
  "A Partial Gap Down occurs when the opening price is below yesterday's close, but not below yesterday's low." "A
  Partial Gap Up occurs when today's opening price is higher than yesterday's close, but not higher than yesterday's
  high." And: "A full gap down occurs when the price is below not only the previous day's close but the low of the day
  before as well." Its own gap trades wait for the first hour and use its high or low, so they are not red to green
  rules. Most red to green days start with a partial gap (section 4.6, Table 1). (The first draft of this dossier took
  these two definitions from Investopedia's "Gap" page; that page could not be re-read in checking and its quotes
  were removed.)

### 3.11 UCT's house definitions (details and every quote in section 6)

- The owner uses it as an entry trigger: "There is nothing I like more than a gap down reversal to give me signal"
  (2025-06-22), with a number: "a gap down of 0.7% or more that gets bought up".
- Where: a leader in a strong trend, pulling back into the 9 or 20-day average, the 50 or 200-day, a gap support or a
  high-volume level, often after an inside day or a flag.
- What it proves: "presence of buyers" and a "clear area to risk against" (2025-08-10).
- When: early in the week and early in the day ("quick red to green move"); for his hourly Go Signal, "in the first or
  second hourly candle" (ruling 2026-11-01).
- Stop: Bracco after a red to green: "I have moved my stops up to todays low." The owner after one: "Still in with a stop
  at Thursday's low." (the red to green day).

### 3.12 Pages read and NOT used as sources

- "Red to Green Move" on therighttrader.com ("By The Right Trader", updated 2026-10-13): no human author, a template-like
  page that itself says the phrase's "first published source is not well documented". Treated as AI-written; not cited
  for any rule.
- TradingView idea "THE RED TO GREEN AND GREEN TO RED ENTRY STRATEGY" (user TheTrad1ngGame, 8 Sep 2021): anonymous user
  content. Used only in section 2 to show that some traders mean the open, not the prior close.
- usethinkscript.com thread "Red to Green Previous Day Price Close": a forum. Not used.
- The Bear Bull forum members' own interpretations: a forum. Used only where they quote the book, and marked.

### 3.13 Comparison table

| Criterion | Investors Underground 2017 | Aziz (as quoted on his forum) | Bohen 2022/2024 | Bulkowski gap setups 2016 | QuantRocket 2020 | Raschke 1997 | UCT (owner, Bracco) |
|---|---|---|---|---|---|---|---|
| The line | prior close | prior close | prior close (implied by "red/green") | none; a 5-min candle color change | none | the gap day's high, later | **prior close** ("take out previous day close", 2026-11-01) |
| Must open below it? | no ("trading below") | gapped stocks | "weak open" | large gap down | open >= 1 std below prior LOW | gap that does not fill | "gap down of 0.7% or more"; Bracco also uses a dip after a flat open |
| Prior trend | not stated | "Stocks in Play" | multi-day movers, "real stocks" | not stated | closed above the 20-day | not stated | strong trend, leader, above key averages |
| Location | not stated | not stated | VWAP hold; key price level | not stated | gap size decides | not stated | 9/20-day EMA, 50 or 200-day, gap support, HVC, inside day low |
| Prior day | not stated | not stated | **closed at or near its high** | not stated | not stated | not stated | often red days into support; an inside day or higher low |
| Volume | "greeted with more buyers" | not stated | not stated | not stated | not stated | not stated | "would love for volume to increase" (CRS, 2025-12-28) |
| Trigger time | intraday | after the open | morning or afternoon | 5-min chart, after the open | 1 minute after the open (test) | next 3 sessions | early in the day and week; Go Signal: first or second hourly candle |
| Entry | anticipate, on higher intraday lows | the cross | "wait for confirmation" | a penny over the turning candle's high | at the open + 1 min | buy stop over the gap day's high | the cross (market order, E57); "immediate full size" on a Go Signal |
| Stop | "set risk around the previous closing price" | not quoted | not stated | a penny under the turning candle's low | none (close) | under the gap day's low | **the day's low** (Bracco; owner's ALAB) |
| Target | not stated | not stated | not stated | half of (prior day high minus today's low) | the close | trailing stop | house trims (B19, E51), trail 10 or 21-day (E52) |
| Holding period | intraday | intraday | intraday to days | intraday | intraday | days | swing: "minimum 3-7 day burst" (owner, 2026-11-01) |
| Short mirror | yes (G2R implied by "Red/Green") | yes (green to red) | not stated | yes (short side page) | short the large down gap | "simply a reverse" | Index notes only; parabolic U-Turn (Bracco) |

### 3.14 Where the sources disagree

1. **Which line.** Prior close (IU, Aziz as quoted, the owner's 2026-11-01 ruling) versus the day's open (a TradingView
   user; the app's hourly Go Signal finder). Most named sources use the prior close.
2. **Must it gap down?** IU and Bracco's TEM example accept any trade below the prior close, even after a flat or green
   open. The owner names a gap down of at least 0.7% as his ideal. Bohen wants a "weak open".
3. **Anticipate or confirm.** IU says "anticipate", buying higher intraday lows under the line. Bohen waits "for
   confirmation". The firm's brain template (a machine summary of his posts, section 5.6) lists entering before the
   reclaim as a mistake. Bulkowski enters even earlier, on the first 5-minute candle that turns.
4. **What the prior day should look like.** Bohen wants a prior close near the high (no trapped buyers). The owner
   usually wants a pullback (red days, an inside day) into support. Our data (section 4.6) did not show Bohen's filter
   helping in either period tested.
5. **Gap size.** QuantRocket finds small down gaps recover and large ones keep falling. Bulkowski finds big gaps (3% or
   more) close the same day only about a quarter of the time now. The owner gives a floor (0.7%) but no ceiling, and he
   praised a 9% gap-down reversal in AEHR (2026-04-05).
6. **Stop.** The day's low (Bracco, owner, Kullamagi's general rule) versus the prior day's low (the firm's one logged
   trigger, `docs/superpowers/research/setups/SETUP_NOTES.md` line 137) versus the key moving average (the brain
   template). Bulkowski uses the turning candle's low (tighter).
7. **Time frame.** IU, Aziz and Bulkowski trade it intraday. UCT holds it as a swing.

## 4. Measured evidence

No source I found publishes a win rate for "red to green" as such. What exists is measured on gap fills and gap fades.
Our own tests are new for this dossier.

### 4.1 Bulkowski: how often a 3% or larger gap closes (520 stocks; ThePatternSite, updated 12/25/16)

| Period | Down gaps of 3%+: full closure | half closure | Up gaps of 3%+: full closure | half closure |
|---|---|---|---|---|
| 1990s | 50% | 72% | 48% | 69% |
| 2000s | 40% | 68% | 35% | 63% |
| 2010s | 23% | 56% | 23% | 51% |

- Method as stated: "Using a 3% gap size or larger, I tested the three decades for the gap closure rate for full and half
  gaps." And: "I used data form 520 stocks, but not all stocks covered the various periods." The short-side page says the
  closures happened "sometime during the same trading day". The long-side page does not restate that. A half gap "is half
  the distance from the prior day's close to today's opening price", so a full closure is a touch of the prior close: a
  red to green touch on a gap down.
- Over all gap sizes (the short-side page only; the long-side page has no 84% figure): "Research shows that at least
  half the gap fills 84% of the time, but that is for all gap sizes (as small as a penny)".
- Limits: 520 stocks of unknown liquidity, data to 2016, a touch is not a close above, no trade results. The "2010s" row
  covers 2010 to 2016. AI notice on the site.
- Our check (section 4.6, Table 1): on liquid US stocks, 3%+ gap downs touched the prior close the same day 32% of the
  time in 2000-2009 and 18% in 2010-2016 (his 40% and 23%). Same direction, a little lower; we require a trade a cent
  above the close and use a different stock list.

### 4.2 QuantRocket (Brian Stanley, 2020): buying versus selling the gap down

- Test: top 10% of stocks by dollar volume, closed above their 20-day average, opened at least one standard deviation
  below the prior day's low; buy one minute after the open, sell at the close.
- Result: buying lost money. Shorting instead: "From 2014-2020, the Sharpe ratio is 1.30 and the annual return is 10%".
  Also: "Entering positions 5-10 minutes after the open works better than entering immediately after the open."
- Revised buy test, with the gap small enough that the open stayed above the 20-day average: "This produces a positive
  equity curve" (no number given).
- Limits: one vendor backtest; he notes he found it while "Experimenting with parameters", so it is optimistic; costs
  and borrow are not discussed in the text; the trade is open-to-close, not a prior-close trigger.

### 4.3 Academic work on overnight gaps reversing during the day (abstracts only, through Crossref)

- Berkman, Koch, Tuttle and Zhang, "Paying Attention: Overnight Returns and the Hidden Cost of Buying at the Open",
  *Journal of Financial and Quantitative Analysis* 47(4), 715-741 (2012), doi 10.1017/S0022109012000270: "We find a
  strong tendency for positive returns during the overnight period followed by reversals during the trading day." And:
  "It is concentrated among stocks that have recently attracted the attention of retail investors". This supports the
  green to red idea in attention stocks (buyers at the open pay up and the day gives it back). It does not test a
  prior-close trigger.
- Heston, Korajczyk and Sadka, "Intraday Patterns in the Cross-section of Stock Returns", *Journal of Finance* 65(4),
  1369-1407 (2010), doi 10.1111/j.1540-6261.2010.01573.x: the abstract says short-term reversals come from temporary
  liquidity imbalances that last less than an hour. That fits the idea that the opening flush is a liquidity event. I
  paraphrase because the abstract text uses a special hyphen my checker cannot match.
- Limits: I read the abstracts only; these are portfolio-level effects, not trades with stops.

### 4.4 The firm's own logged triggers

`docs/superpowers/research/setups/SETUP_NOTES.md` (line 137) counts the firm's published pre-market triggers: "Red to
Green" has one, risk 3.00%, entry `prev_day_close_reclaim`, stop `prev_day_low`, outcome a win. One trade says nothing
about the setup.

### 4.5 Claims that are not measurements

- Raschke's "an early gap up is a short 95 percent of the time" (2004, section 3.5): an interview pull quote with no
  sample or method, in an interview mostly about S&P futures. Not to be taught as a statistic.
- Some app code comments state percentages for other intraday patterns without a source (for example the Lance opening
  drive detector's "65-70%"). None concern red to green, and none are used here.

### 4.6 Our own tests (new, for this dossier)

**What I did.** Four tests on the app's own bar data, read-only, in the session scratch folder (scripts:
`setups/43-red-to-green/tools/t1_daily.py`, `t2_intraday.py`, `t3_hourly.py`, `t4_eod_daily.py`, and the `*_analyze.py`
and `t2_more.py` files; outputs in `setups/43-red-to-green/out/`). Every event passed the house liquidity rule B23
(prior close $10 or more; 50-day average of $20 million a day or more). The house plan: one full position; stop two
cents under the low (A3, F62); a third off at 3R and a third at 5R (an open past a level fills at the open, F63); the
stop moves to breakeven once 3R is reached (B19 allows 2R to 5R); the last third trails a close under the 10-day average
(E52); out at the close after 10 sessions if under 1R (C33); a gap through the stop fills at the open (B20's 30-minute
rule cannot be modelled on daily bars); at most 20 sessions. When a target and the stop fall in the same bar, the stop
counts first.

**Limits, read these first.**
- The stock lists are today's names (survivors). No costs, no slippage, no borrow fees.
- None of the tests can see the things the owner adds by eye: the theme, the group, the catalyst, how orderly the
  pullback is, the market reading (B18). Treat every number as a rough guide for his decisions, not a lesson fact.
- The 5-minute test covers one short period, 2026-08-17 to 2026-11-06 (entries to 2026-10-08 for the plan results). In
  that period QQQ rose to a peak on 2026-10-06 and then fell 14.8% to 2026-11-05; IWM fell 10.3% from its 2026-08-14
  close (the close before the window) to 2026-11-06, and its highest close in the window was the first day's. A
  falling market flatters shorts and hurts longs.
- Same-day trades are many and correlated, so I report standard errors clustered by day (38 trading days in the 5-minute
  plan sample). They are wide.
- Very tight stops (under 0.5%) make R multiples swing wildly; I show results with stops of 0.5% to 3% or 5% beside the
  full set.
- Daily bars cannot show the order of prices inside a day; that is why the trade test uses 5-minute bars. In the
  5-minute test the stop is the low so far through the entry bar, and part of that bar's low may come after the cross,
  which makes some stops a little too low.

**Table 1. How often it happens, daily bars, liquid US stocks, 2000 to 2026-10-22** (2.74 million gap-down days and 3.12
million gap-up days; 2,816 names)

| Opening gap | Gap-down days | Traded back above c1 (R2G) | Of those, closed above c1 | Gap-up days | Traded back below c1 (G2R) | Of those, closed below c1 |
|---|---|---|---|---|---|---|
| under 0.7% | 1,726,177 | 79.3% | 50.7% | 1,995,513 | 78.1% | 49.9% |
| 0.7% to 2% | 766,518 | 51.8% | 49.4% | 868,729 | 52.0% | 49.4% |
| 2% to 3% | 132,345 | 35.4% | 50.6% | 135,438 | 36.4% | 49.6% |
| 3% to 4% | 52,756 | 29.5% | 51.0% | 52,774 | 30.6% | 50.0% |
| 4% to 8% | 52,148 | 23.3% | 48.7% | 53,479 | 23.5% | 48.2% |
| 8% or more | 13,325 | 10.6% | 42.7% | 12,895 | 12.2% | 46.4% |
| **all** | 2,743,269 | **67.2%** | **50.4%** | 3,118,840 | **67.0%** | **49.8%** |

What it says: the cross is common, not rare. Two of three gap-down days trade back above the prior close. And once they
do, the close is a coin flip: about half finish back under it, at every gap size. The median distance from the prior
close to the day's low on R2G days was 1.22%; 87% were within 3%. The day's low was taken out again within 5 sessions on
68% of R2G days and within 10 sessions on 77%.

Other cuts (daily, all R2G crosses): when the day also traded under the prior day's low (at any time; daily bars cannot
show whether before or after the cross; the Oops overlap), only 39.3% closed above the prior close; without an
undercut, 63.8%. The 5-minute test (Table 3), which does see the order, agrees in direction. When the prior day closed in its top 30% (Bohen's
filter), 50.6% held; bottom 30%, 50.4%. Above or below the 200-day: 50.6% and 50.2%.

**Table 2. The intraday trade, 5-minute bars, 988 of the most-traded names, 2026-08-17 to 2026-11-06.** Entry: a cent
over the prior close the first time price trades there (or that bar's open if it opened above); stop two cents under the
low so far. Baseline: buy the close of the 10:30 bar on every day with the same kind of stop. 27,878 gap-down days, of
which 61.7% crossed; 30,103 gap-up days, of which 64.2% crossed.

| | R2G long | Baseline long | G2R short | Baseline short |
|---|---|---|---|---|
| Trades | 17,201 | 58,059 | 19,333 | 58,059 |
| Median stop | 0.99% | 0.78% | 1.03% | 0.86% |
| Stop within 3% (A13) | 93.6% | 93.7% | 93.6% | 92.1% |
| Closed beyond the prior close that day | 45.7% | 48.0% | 51.8% | 51.5% |
| Stopped out the same day | 49.4% | 46.3% | 42.2% | 43.4% |
| Reached +1R / +2R / +3R before the stop | 46% / 32% / 25% | 49% / 33% / 25% | 52% / 38% / 30% | 47% / 33% / 25% |
| House plan, mean R (entries to 2026-10-08) | **-0.03** (day-clustered se 0.09) | -0.13 (0.08) | **+0.48** (0.12) | +0.18 (0.08) |
| ...only stops of 0.5% to 3% | -0.20 (0.09) | -0.16 (0.08) | +0.21 (0.09) | +0.13 (0.08) |
| Winning trades (plan) | 24% | 24% | 33% | 29% |

What it says: in this period the red to green trigger alone did not make money with the house plan and did not clearly
beat a random 10:30 entry. The green to red short did better than a random short, in a falling market.

**Table 3. What changed the R2G result** (5-minute test; plan mean R for entries to 2026-10-08, with the count; the
standard errors here are plain, not clustered, and the true uncertainty is larger)

| Cut | Better group | Worse group |
|---|---|---|
| Opening gap | 2% to 4%: +0.21 (433) | 0.7% to 2%: -0.13 (3,038); under 0.7%: 0.00 (7,978) |
| Entry time (5-min bar) | 9:30 bar: +0.03 (6,605), but 67% stopped the same day; after 12:00: +0.01 (884) | 9:35 to 11:55: -0.10 to -0.19 |
| RS proxy (C31) | 80 or more: +0.03 (2,227); 27% winners | 20 to 50: -0.10 (3,494) |
| Undercut of the prior low first (Oops overlap) | no undercut: +0.05 (6,110) | undercut: -0.11 (5,374) |
| Where the prior day closed (Bohen) | bottom 30%: +0.03 (4,143) | top 30%: -0.10 (3,133) |
| Extension (C29) | within 10% of the 10-day: -0.02 (11,222) | more than 10% over it: -0.27 (262) |
| Low tagged the 9/20-day EMA or 50-day (within 1%) | no tag: -0.02 (7,234) | tag: -0.05 (4,250); no real difference |
| First-30-minute volume vs its 20-day average | no clear pattern | |
| The day's close (known only at the close) | closed above c1: +0.88 (5,082) | closed back under: -0.74 (6,402) |

The house-filtered set (above the 200-day, rising 20-day EMA, RS proxy 80+, gap 0.7%+, within 10% of the 10-day, no
earnings within 3 sessions): 644 plan trades, mean -0.01R (day-clustered se 0.14), 27% winners. Adding the moving-average
tag: 251 trades, -0.07R. Not enough to say the filters help or hurt in this short window.

**The failed-reclaim rule.** On 1,969 trades that closed back under the prior close but were not stopped that day,
selling at that close averaged -0.34R; holding with the stop and the plan averaged -0.47R (median -1R). Adding a sell at
the close when it closes back under the prior close moved the whole plan from -0.03R to -0.01R. A small help, one period.
For the G2R short the same rule hurt (covering at that close -0.31R versus holding +0.01R).

**Table 4. Timing, hourly bars, about 970 of the most-traded names, 2023-12-12 to 2026-11-06** (305,608 gap-down days)

| Opening gap | Crossed the same day | Crossed in the first hour (9:30-10:30) | Crossed by 11:30 |
|---|---|---|---|
| under 0.7% | 80.2% | 71.6% | 75.1% |
| 0.7% to 2% | 51.9% | 37.0% | 42.6% |
| 2% to 4% | 32.4% | 19.1% | 23.8% |
| 4% or more | 15.7% | 9.0% | 11.3% |

84% of all crosses happened in the first hour. The close held above the prior close on 50.2% of first-hour crosses and
50.1% of later ones: the hour of the cross did not change the hold rate. (Hourly trade results are not shown: inside an
hour the order of prices is unknown, which biases the stop.)

**Table 5. The daily footprint, 2000 to 2026-10-08: buy the CLOSE of a day that opened under the prior close and closed
over it, stop two cents under that day's low.** Baseline: a 1-in-10 sample of other up days, same entry and stop. Stops
of 0.5% to 5% only.

| Set | Trades | Median stop | Mean R (day-clustered se) | Winners | Reached 3R |
|---|---|---|---|---|---|
| All R2G days | 821,462 | 1.80% | +0.05 (0.01) | 31.6% | 24.8% |
| Baseline up days | 178,103 | 1.48% | +0.04 (0.01) | 30.0% | 25.6% |
| R2G in an uptrend (above 200-day, 20-day EMA rising) | 380,827 | 1.65% | +0.01 (0.01) | 31.2% | 23.8% |
| ...plus a gap of 0.7%+, the low within 1% of the 20-day EMA, within 10% of the 10-day | 17,840 | 2.32% | +0.06 (0.02) | 34.9% | 22.9% |
| ...and closed in the top 30% of its range | 14,925 | 2.42% | +0.05 (0.02) | 35.6% | 22.1% |

By period, all R2G days: 2000-07 +0.03R, 2008-13 +0.02R, 2014-19 +0.09R, 2020-26 +0.04R; the baseline +0.04R, +0.02R,
+0.05R, +0.04R. In the 5-minute window the same end-of-day entry gave -0.01R (se 0.11; 5,082 trades; median stop 2.07%;
73% within 3%).

**What all four tests say, in one paragraph.** The red to green cross is frequent and the close after it is a coin flip.
Mechanically, buying it (at the cross or at the close) earned about what a random entry with the same stop earned, over
26 years and in the recent window. The obvious filters (trend, the 20-day EMA tag, gap size, a strong close) moved the
result only slightly. So the setup's value, if it has one in the owner's hands, comes from what he chooses to watch
(leaders, themes, orderly pullbacks, a good market) and from the tight, logical stop it gives, not from the cross
itself. That is consistent with how he uses it: as the trigger inside setups he already likes.

### 4.7 The owner's and Bracco's examples, checked against the bars

Daily bars from our data. "c1" is the prior close. Low broken is the first later session that traded under the
red-to-green day's low.

| Stock, day | Who said what | Open vs c1 | Low vs c1 | Close vs c1 | Where the low was | Next 5 sessions from c1 | Low broken |
|---|---|---|---|---|---|---|---|
| QQQ 2025-06-02 | unsigned Index section: "a red to green move on Monday" | -0.36% | -0.60% | +0.79% | on the 9-day EMA | +2.2% | not in 10 |
| TEM 2025-06-10 | Bracco: "the red to green spot" | +0.09% (opened green, dipped red) | -1.22% | +3.65% | well above the 20-day; 10.7% over the 10-day | +4.7% | day 8 |
| NBIS 2025-08-15 | owner: "actionable signal Friday on red to green move" | -0.23% | -1.68% | +4.62% | 2.4% over the 9-day EMA | +0.8% | day 2 |
| TWLO 2025-11-14 | owner: "red to green upside reversal attempt" | -2.58% | -2.82% | +1.10% | 1.4% under the 20-day EMA; undercut the prior low | -2.8% | day 1 |
| Q 2026-01-14 | owner: "the red to green off the 20EMA" | -1.36% | -4.46% | +0.23% | 0.6% under the 20-day EMA; a young listing, no 200-day yet | +10.1% | not in 10 |
| GLXY 2026-01-23 | owner: "Gap down and red to green higher low on Friday" | -1.91% | -4.04% | +3.17% | 1.5% under the 9-day EMA; no 200-day yet (our data starts 2025-05-16) | -8.6% | day 4 |
| AEHR 2026-04-02 | owner: "from -9% to up 12% on the day" (described, not traded) | -8.51% | -9.97% | +11.92% | 2.1% under the 20-day EMA | +77.9% | not in 10 |
| ALAB 2026-08-13 | owner: "Bought Thursday red to green" | -1.80% | -2.76% | +1.25% | under a falling 20-day EMA and 13% under the 50-day | -8.9% | day 3 |
| NOW 2026-09-25 | owner: "went red to green but the market had other plans" | -0.38% | -1.58% | -1.57% (failed) | on the 20-day EMA; traded over the prior close in the first 5-minute bar, and its 5-minute closes flipped across that line 6 times during the day | -2.5% | day 1 |
| CRM 2026-10-28 | owner: "oops reversal and red to green move at the 20EMA", then "a 4% loss on the gap down" | -1.40% | -1.61% | +0.51% | 1.3% under the 20-day EMA, on the 50-day | -5.7% (gapped down 4.9% the next day) | day 1 |
| SMH 2026-07-15 (G2R) | Index section: "big green to red move to lose the 50SMA" | +1.09% | low -4.43% | -1.59% | lost the 50-day | -2.2% (10 sessions: -16.0%) | |

What the examples show: his red to greens are mostly small gap downs (0.2% to 2.6%) into the 9 or 20-day average, in
leaders. They work and fail like the statistics say: QQQ, Q and AEHR ran; TWLO, NOW, ALAB and CRM broke the day's low
within 1 to 3 sessions. Two of his examples (Q, GLXY) were young listings without a 200-day average (section 7).

### 4.8 Candidate model examples for the owner's review (from the 5-minute test; not yet seen by him)

Chosen by rule, not by eye: above the 200-day, rising 20-day EMA, RS proxy 80+, gap 0.7%+, the low before the cross
within 1% of the 9/20-day EMA or 50-day, within 10% of the 10-day, no earnings within 3 sessions, the cross by 10:25,
closed above the prior close, reached 3R before the stop, stop 0.8% to 3%. A few dozen qualified (53 in the writer's
run; 36 when the checker re-coded the same filters from the saved trade table, the difference being how the earnings
and support-tag filters are written); the ten below passed both runs, and every number in the table was re-derived in
checking:

| # | Stock | Day | Gap | Cross (bar) | Stop | RS proxy | Low vs 20-day EMA | Plan result |
|---|---|---|---|---|---|---|---|---|
| 1 | CRWD | 2026-09-21 | -1.7% | 9:35 | 2.9% | 95 | +4.4% (on the 9-day EMA) | +3.9R |
| 2 | PANW | 2026-09-28 | -1.2% | 9:30 | 2.0% | 94 | +0.1% | +4.0R |
| 3 | FTNT | 2026-09-28 | -1.4% | 9:35 | 2.3% | 94 | +0.6% | +3.8R |
| 4 | TWLO | 2026-09-15 | -0.8% | 9:35 | 2.2% | 94 | -0.9% | +5.9R |
| 5 | HALO | 2026-09-17 | -1.0% | 9:35 | 1.5% | 93 | +1.0% | +3.3R |
| 6 | NTAP | 2026-09-24 | -1.7% | 9:30 | 1.7% | 92 | +0.6% | +5.2R |
| 7 | DINO | 2026-08-26 | -1.3% | 9:30 | 2.0% | 92 | +0.6% | +5.5R |
| 8 | ANF | 2026-10-08 | -1.2% | 9:50 | 1.3% | 90 | +0.8% | +6.1R |
| 9 | ELF | 2026-10-08 | -1.0% | 10:25 | 1.4% | 85 | +2.1% (on the 9-day EMA) | +4.4R |
| 10 | IQV | 2026-09-15 | -0.9% | 9:35 | 1.0% | 89 | +2.4% (on the 9-day EMA) | +1.8R |

Failures under the same filters, for the lesson that it does not always work: MU 2026-10-08 (stopped the same day; closed
at 7% of its range), OKTA 2026-10-14 (stopped the same day), LITE 2026-09-24 (stopped the same day), DELL 2026-08-18
(gap -2.7%, stopped the same day).

Green to red short candidates under the mirror filters (below the 200-day, RS proxy 20 or less, gap up 0.7%+, the high
before the cross within 1.5% of the 20-day EMA, cross by 10:25, closed below the prior close, reached 3R): WING
2026-09-22, TTD 2026-09-18, APTV 2026-09-11, PODD 2026-08-24, BLDR 2026-08-25, KTOS 2026-09-22, CPNG 2026-09-03, MTZ
2026-10-09, DY 2026-10-09, MLM 2026-09-03.

These need the owner's eye on the chart (examples must be "good spots on good stocks", his universe rule). The longer
UCT list in section 6 gives older examples he named himself.

## 5. Our app

**There is no red to green scanner and no Model Book card.** Instead the idea appears in at least six places with five
different definitions.

### 5.1 The screener's bar labels: `api/services/screener/bar_character.py`

- "Red to Green" (tier 3, line 441): `o < pc and c > pc`: "Opened below yesterday's close and finished above it."
- "Green to Red" (tier 3, line 445): `o > pc and c < pc`.
- Higher tier gap labels catch the bigger versions first: "Gap Down → Closed Green" (line 326, a gap of 2% or half an
  ATR, `GAP_PCT = 0.02`, `GAP_ATR = 0.5`, lines 49-50) described as "a red-to-green day with a gap in it"; "Gap Down,
  Filled" (line 321: traded up to the prior close, closed under it; a failed red to green); and the gap-up mirrors.
- This is a daily, end-of-day label. It only knows the result, not the cross.

### 5.2 The chart reader: `api/services/chart_iq/engine/v3.py` line 207

`o <= prior close * 0.98 and close > prior close and close > open and rvol >= 1.2`, read as "Red to green: opened under
yesterday's close, closed over it." So here a red to green needs a gap of 2% or more and 1.2x volume. `v44_read.py`
(lines 310 and 663) names "a red-to-green move" as one of the triggers in its plan sentences.

### 5.3 The Go Signal detector (daily footprint): `api/services/pattern_engine/detectors/uct/uct_go_signal.py`

- Fires on a weak open (`o < c1`, line 72), a sweep of support, a strong close, and location. The variant
  `red_to_green` is `c > c1` (line 91); "Entry: the prior close when it traded that session (red to green), else the
  close. Stop: the session low." (`"trigger": c1 if o < c1 <= h else c`, line 106). The plan targets come from the shared
  `make_levels` at 2R and 3R (`docs/study/TRADE_PLANS.md`).
- This is the closest thing the app has to a red to green trade plan, and it matches the owner's daily usage: the line
  is the prior close, the stop is the day's low.

### 5.4 The Go Signal hourly finder: `scripts/study/find_go_signal_hourly.py` line 91

`red_to_green = first["c"] > first["o"] and first["c"] > fl`: the first HOUR closes over its own OPEN and over the flag
low. That is the candle-color meaning, not the prior close. The owner rejected drafts found this way on 2026-11-01 and
named the prior close as the key (section 6.4). The owner_verdicts log records "finder redo of find_go_signal_hourly.py
pending". **This file still uses the old meaning.**

### 5.5 The Oops Reversal detector: `uct_oops_reversal.py`

Entry "the prior close (the reclaim level, traded intraday by construction)", stop the day's low. Its label
`no_undercut_v3` (line 68: open under the prior close, close over it, prior day down, NO undercut of the prior low) is
the plain daily red to green after a red day. The docstring says it was "dropped as a trigger by the blind review".

### 5.6 Journal tags, course docs, vocabularies and research files

- Journal tags: `app/src/constants/setupGroups.js` lists `'Red to Green'` under Swing (line 16) and
  `'Red to Green (Intraday)'` and `'Green to Red'` under Intraday (line 23). `app/src/pages/journal-2-0/lib/setupTagMap.js`
  (lines 45-48) puts the swing tag in "Reversals & Reclaims" and the other two in "Intraday".
- Model Book: `app/src/pages/modelbook/setupCatalog.js` has no card for it (the 26 cards end with ORB, 30-Minute Pivot
  and Go Signal).
- Course plans: `docs/study/UNITS-method.md` line 189 says the three journal names are "entry triggers, taught in SET.06,
  not setups". `docs/study/UNITS-foundations.md` F2b.09 lists RED TO GREEN as one of "the firm's four entry triggers" (with
  BASE BREAKOUT, PREV DAY HIGH BREAK, PREV LOW RECLAIM); `docs/study/bank/walk.method.json` teaches the same four as "The
  four entry triggers".
- `docs/study/research/definitions.json` (line 1514): "an entry trigger in the method, not a setup", with only an
  Investopedia gap quote as its source.
- `docs/superpowers/research/setups/setup_criteria.json` (lines 541-592): "Red to Green" from the firm's brain template
  (structure, location near the 9 or 20-day EMA, stop the prior day's low or the key MA, "family max 8.0%");
  "Red to Green (Intraday)" (the same statement intraday; "Any published numeric definition" not pinned down); and
  "Green to Red", marked "ZERO SOURCES" and called "the least-evidenced setup in the taxonomy". This dossier now
  gives the green to red side outside sources (Aziz as quoted, IU, Bulkowski's short side, Berkman and others) and UCT usage.
- The firm's brain template "Red to Green" (`docs/study/levels/brain_kb_2026-11-06.json`, under "Oops Reversal",
  `templates[1]`): a machine-written summary of his posts, not his words. It lists the stop as the day's low "(the gap
  down low)" or "the key daily MA (20EMA or 200SMA)", a max of 8%, a 20-day EMA trail, and invalidation if the stock
  "reverses back below prior close after triggering".
- The coach vocabulary (`api/services/uct_agent/coach/setups.py` lines 17 and 26; `app/src/agent/coach/brain.js` lines 29
  and 40) knows "Red to Green" with the alias "red-to-green move".

### 5.7 Where the app disagrees with the sources, the owner, or itself

1. **Five definitions.** Bar label (any open under, close over), chart reader (2% gap and 1.2x volume), Go Signal daily
   (prior close traded, the entry), Go Signal hourly (close over the hour's open), Oops label (no undercut, prior day
   down). A member who sees "Red to Green" in two places can get two answers. Recommend one shared definition (the prior
   close) with named variants.
2. **The hourly Go Signal finder uses the wrong line** for the owner (section 5.4). It should test the prior close.
3. **Daily labels cannot see the trade.** The bar label, the chart reader and the screener only know the close. A real
   red to green buyer is in at the cross; half of crosses fail by the close (Table 1). Any lesson built from the daily
   labels will show only the ones that held (look-ahead).
4. **Course docs call the Kicker "the cleanest RED TO GREEN entry"** (`docs/study/UNITS-method.md` M9.L5;
   `docs/curriculum/uct_method_course.json`). A Kicker gaps up: it opens ABOVE the prior close (the app's Kicker detector requires
   it, dossier 26), so it is not red at the open. Under the prior-close definition that sentence is wrong (section 10,
   question 12).
5. **The vocabulary file's locator is partly wrong.** `docs/wisdom/vocabulary/setup-vocabulary-v1.json` (line 558)
   cites `sunday-scans-d40` and `sunday-scans-fcd` for verbatim usage. `fcd` has it (TWLO, 2026-09-06); `d40` does not
   contain "red to green" (checked today).
6. **Stop disagreement inside the firm's own files.** `setup_criteria.json` gives `prev_day_low` as the firm's published
   stop; the brain template and the owner's own trades use the day's low.
7. **No trade plan row.** `docs/study/TRADE_PLANS.md` has no Red to Green row; the Go Signal row carries the only plan.

## 6. UCT's own words

All quotes are from https://unchartedterritoryy.substack.com, read today through the post API, and attributed by the
section they sit in. "Owner" means the "TSDR's Weekly Outlook & Watchlist" or "TSDR TRADING" sections (TSDR is the
owner's trading name; one post titles it "Patrick (TSDR)'s Weekly Outlook & Watchlist"). Quotes keep the writers'
spelling. I found 35 mentions of red to green, green to red or r2g in 27 posts, 2025-06-08 to 2026-11-01; all are here
except near-duplicates.

### 6.1 What he wants (definition by use)

- 2025-06-22 ([sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2), owner): "Ideal scenario
  for next week is a gap down of 0.7% or more that gets bought up. There is nothing I like more than a gap down reversal
  to give me signal." Next sentence: "Especially in a strong trend that is pulling back to a key area or moving average."
  And: "If we get the gap down and GO SIGNAL then I will likely be aggressive Monday morning."
- 2025-08-10 ([sunday-scans-f6f](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f), owner, on the market): "I
  would love a gap down and red to green move on Tuesday or even Wednesday. This would be an extremely actionable day for
  me." On APLD: "Preferably get a gap down red to green move to show presence of buyers and clear area to risk against."
- 2025-12-21 ([sunday-scans-34b](https://unchartedterritoryy.substack.com/p/sunday-scans-34b), owner, CSIQ): "Ideal
  situation is a gap down slightly and quick red to green move tomorrow. Would give us an area to risk against and a
  presence of buyers to signal potential momentum."
- 2025-12-28 ([sunday-scans-249](https://unchartedterritoryy.substack.com/p/sunday-scans-249), owner, CRS): "I would love
  for volume to increase as well as the intraday range on an expansion day. Preferably a gap down and red to green to
  give clear risk area and presence of buyers."
- 2026-03-01 ([sunday-scans-6a8](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8), owner, BE): "possibly a
  really good spot against the 20EMA here. Will be watching the hourly for entry signal." Then: "A gap down red to green
  Monday would be an A+ setup in my book."
- 2026-09-06 ([sunday-scans-fcd](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd), owner, TWLO): "Now we have
  an inside day and a higher low at a rising 20EMA? I mean come on this is worthy of attention imo! Give me a gap down
  and red to green and I am ready!"
- 2025-06-08 ([sunday-scans](https://unchartedterritoryy.substack.com/p/sunday-scans), owner, ALAB): "This is pretty much
  my bread and butter. Setting up off the 20ema here. Any sort of GO SIGNAL would allow me entry with immediate full
  size." Then: "Anything in the $87-$90 range and reclaim of red to green spot, previous day's low, or opening range and I
  am a buyer."
- 2025-10-15 ([the-rest-of-the-week-39d](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d), owner,
  FIG): "Any sort of red to green GO SIGNAL and I will be getting pretty heavy in this via shares."
- 2026-01-14 ([the-rest-of-the-week-305](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305), owner): "We
  get some drift down in a channel and hold a key area or moving average. Then break previous day's high or hammer red to
  green on some weakness and lower wick."

### 6.2 Where (location), and red to green as one of several triggers

- 2025-06-22 (0d2, SAIL): "A hammer candle or gap down and red to green move below $22 would be actionable imo."
- 2025-07-13 ([sunday-scans-6a6](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6), GOOGL): "Wish I was in
  this off the 200SMA hold." And: "Would love a weak open on money and an inside day or red to green to get involved."
- 2025-08-17 ([sunday-scans-644](https://unchartedterritoryy.substack.com/p/sunday-scans-644), ZETA): "Holding the 200SMA
  and 9EMA following a 30% ER gap up." And: "Technically trigger on Friday, so ideally we get an inside day or red to
  green move to get involved."
- 2025-08-24 ([sunday-scans-ffa](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa), U): "An inside day or red
  to green move to start the week would be actionable. Ideal spot was Thursday against the 20EMA." Same post, closing
  comments: "If not look for red to green moves on Monday or inside days to take action."
- 2025-11-16 ([sunday-scans-d6a](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a), DDOG): "Simple post
  earnings look holding $180 and gap up low support, consolidating below $200. Look to the hourly for entry on a red to
  green early in the week."
- 2026-01-04 ([sunday-scans-153](https://unchartedterritoryy.substack.com/p/sunday-scans-153), INCY): "Now I want an
  inside day or red to green on a gap down. I will be watching the hourly very closely for a position." BTU: "Ideally we
  see an inside day tomorrow or a red to green move."
- 2026-02-08 ([sunday-scans-29e](https://unchartedterritoryy.substack.com/p/sunday-scans-29e), TXN): "Flagging out and
  holdings it's ER close and ATH. Would love a red to green move and Oops Reversal off the 9EMA."
- 2026-03-08 ([sunday-scans-dcf](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf), RELY): "I am looking for
  some gap down and red to green move and hold of the 200SMA and 9EMA. $17.14 is the HVC that we want to see this
  maintain above after entry."
- 2026-03-15 ([sunday-scans-af4](https://unchartedterritoryy.substack.com/p/sunday-scans-af4), TE): "Potential higher low
  against $7.50 and the MAs all stacked here." And: "Ideally get a gap down and red to green." (TE closed at $7.62 on
  2026-03-13 in our data, under the house $10 floor, B23.)
- 2026-03-29 ([sunday-scans-352](https://unchartedterritoryy.substack.com/p/sunday-scans-352), SOLS): "Ideally gives us a
  gap down red to green or an inside day to trade against."
- 2026-05-17 ([sunday-scans-679](https://unchartedterritoryy.substack.com/p/sunday-scans-679), SOLS): "This could be
  actionable as soon as Monday on a gap down and red to green or a gap up and take out Friday's high."
- 2026-08-16 ([sunday-scans-da5](https://unchartedterritoryy.substack.com/p/sunday-scans-da5), INTC): "Tuesday's oops at
  the gap support off that $95 area was attractive now looking for the stock to give it's next signal. Lower wick and red
  to green ideal."
- 2025-06-08 (sunday-scans, SHOP): "I consider Friday at Day 1, maybe Day 2 off the 20 ema hold on Thursday. Depending
  on Monday morning outlook can also look for Red to Green move."

### 6.3 Trades and outcomes he reported

- 2025-08-17 (644, NBIS): "Building nicely and gave actionable signal Friday on red to green move."
- 2025-11-16 (d6a, current positions): "TWLO from Friday's red to green upside reversal attempt."
- 2026-01-27 ([the-rest-of-the-week-aaa](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-aaa), GLXY): "Gap
  down and red to green higher low on Friday, inside day Monday, Continuation Tuesday."
- 2026-02-22 ([sunday-scans-04c](https://unchartedterritoryy.substack.com/p/sunday-scans-04c), Q): "Idealy entry was 1/14
  on the red to green off the 20EMA or 2/6, 2/7 on the breakout to highs."
- 2026-04-05 ([sunday-scans-356](https://unchartedterritoryy.substack.com/p/sunday-scans-356), AEHR, described, he had
  been stopped out earlier): "Then Thursday it got bought up extremely hard on the gap down going from -9% to up 12% on
  the day putting in it's highest weekly close since Sept 2023."
- 2026-08-16 (da5, ALAB): "Bought Thursday red to green and thought I had this and ARM nailed. Still in with a stop at
  Thursday's low."
- 2026-09-27 ([sunday-scans-09b](https://unchartedterritoryy.substack.com/p/sunday-scans-09b), NOW): "Thought it had a
  chance on Friday when it went red to green but the market had other plans. I actually like the weak close and think
  that sets it up better into the early part of this week."
- 2026-11-01 ([sunday-scans-669](https://unchartedterritoryy.substack.com/p/sunday-scans-669), owner): "This week I took
  CRM on the oops reversal and red to green move at the 20EMA and took a 4% loss on the gap down when ServiceNow dumped."
  Same post: "I look for minimum 3-7 day burst swing trades that could potentially turn into strong positions."

### 6.4 His review rulings that use the words (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

All about the Go Signal, his hourly cousin of this setup:
- 2026-10-27: "GO SIGNALS are supposed to be notable hourly flags that undercut a slight range and quickly go red to
  green in the first hour"
- VST scanner pick (an undated line in the same Go Signal review): "Ya possibly but would need full chart but also might just be an oops vs a real like
  GO SIGNAL"
- 2026-11-01 (VST, hourly close-up): "None of these are really go signals, the first hourly candle should go green to red
  and take out previous day close, for the most part"
- 2026-11-01 (AAPL and SNOW close-ups): "And I need a go signal to go red to green in the first or second hourly candle
  essentially."

Read together: his "green to red" and "red to green" are measured against the **previous day's close**, and in the Go
Signal the green to red through the prior close is the shakeout that sets up the long. That is a second use of green to
red in his method, and it is bullish, not a short.

### 6.5 Bracco, the Index section and contributors

- **Bracco**, 2025-06-10 ([trade-updates](https://unchartedterritoryy.substack.com/p/trade-updates), TEM; the post opens
  "Bracco here"): "Gave plenty of opportunities to get involved today wether out of the intraday base, the red to green
  spot, the opening range highs, or through $65. I have moved my stops up to todays low." (TEM opened 0.09% green, dipped
  1.2% red, closed +3.65%: his red to green spot came after a flat open.)
- **Bracco**, "The Parabolic Short" (2025-06-13): the U-Turn and the right side of the V (section 3.8). He does not use
  the words green to red.
- **Index section (unsigned)**, 2025-06-08 (sunday-scans): "Strong week of action on the Nasdaq starting with a red to
  green move on Monday and continuation over previous week's high on Tuesday and Wednesday."
- **Index section (unsigned)**, 2026-07-19 ([sunday-scans-a52](https://unchartedterritoryy.substack.com/p/sunday-scans-a52),
  SMH): "But highlighted the week was Wednesday's gap up and big green to red move to lose the 50SMA on the most important
  group in the market." (A warning on the group, not a short trade.)
- **Index section (unsigned)**, 2026-11-01 (669, QQQ): "This lead to two heavy gap downs that did not get bought up even
  a little bit." (The failure case, for contrast.)
- **VIOTTI** (contributor; the post's CONTRIBUTORS section, entry "VIOTTI - BKSY"), 2026-03-25
  ([the-rest-of-the-week-ecf](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-ecf)):
  "Would probably try a starter on a wick into there and then add on a r2g move." (A starter and an add conflict with the
  house rule A5, one full position; section 7.) The first draft credited this line to Jersace; the fresh copy of the post
  puts it under VIOTTI's name.

### 6.6 UCT material I did not quote

- In-house notes derived from the private Discord sit in the repo's brain files (`docs/study/levels/brain_kb_*.json`).
  One, filed as TSDR 2024-06-03, records him calling a red to green entry one of his favorite setups and rating it five
  stars, with a 2-minute chart; another (TSDR, 2025-05-22) works through a red to green entry through a high-volume close
  with the stop a few cents under that day's low. I paraphrase and do not quote them, because the Discord is private.
  Whether these can be quoted in the course is his call (section 10, question 10).
- The Sunday Scans of 2026-10-18 was subscriber-only (noted in dossier 30) and was not checked past its preview.

## 7. How it fits the owner's account rulebook (`docs/study/sizing_rule.md` section 9)

**Rules that apply as they stand.**
- **B23** price $10+ and $20 million a day: every test above used it. Note his TE idea (about $7.60) would fail it.
- **B26** (hard rule): longs only above the 200-day SMA; shorts only below it. His red to greens are almost all on
  leaders above it. The green to red short side must sit below the 200-day.
- **C31** RS 80+ for longs, 20 or less for shorts. In the 5-minute test RS 80+ was among the better R2G groups.
- **C29** skip a long more than 10% above its 10-day average: the extended group was the worst in the 5-minute test
  (-0.27R, small sample).
- **C28** no chasing more than 4% over the buy point: here the buy point is the prior close. A stock that is already 4%
  green when you look is a chase.
- **A3 and F62** stop a few cents under the day's low: this setup's natural stop.
- **A13** stops usually within about 3%: 94% of intraday R2G stops in our test were within 3% (median 1.0%). End-of-day
  entries are wider (median 2.1%; 73% within 3%).
- **E57** market orders: send a market order as price trades through the prior close (a stop-market order a cent over
  the line does the same job).
- **A5** one full position at one price: the owner's "immediate full size" on a Go Signal fits; VIOTTI's starter-then-add
  plan and the brain template's add-on rules do not.
- **B19, E51, E52** a third at 3R, a third at 5R, breakeven at 2R to 5R, trail the 10 or 21-day: no reason to change.
- **B20** a gap through the stop: the first 30-minute low is the new stop, out past 2R. His CRM loss (a 4.9% gap down the
  morning after a red to green day) is exactly this case.
- **B22** no new buys in the 3 days before earnings: the R2G often appears in post-earnings flags (ZETA, DDOG, RELY,
  TXN); those are after the report, which is fine.
- **C33** time stop: out if under 1R after 10 sessions.
- **E56** at most 3 tries in a week and 6 in a month on one stock: red to green attempts repeat on the same name (NOW,
  CRM crossed on several days in a row), so this rule bites here.
- **B18, F65** the market reading: his best calls are when the market itself gaps down and gets bought (2025-08-10).

**Conflicts and gaps.**
1. **C30 (no time-of-day rule) versus his timing words.** He wants a "quick" red to green and, for the Go Signal, one "in
   the first or second hourly candle". A hard time cutoff would break C30. Proposal: timing is a grading factor, not a
   rule (section 9), unless he wants an exception.
2. **B26 and young listings.** Q and GLXY (his examples) had no 200-day average in our data. E53 says no IPO rule. The
   course needs one sentence: what to do when there is no 200-day yet (section 10, question 11).
3. **Struck rule 15 ("my stop is my stop") versus the failed-reclaim exit.** The brain template invalidates the trade if
   it closes back under the prior close. That is an exit before the stop, which he declined as a general rule. Our test
   shows only a small gain from it (section 4.6). His call (question 6).
4. **C35 swing trading versus the intraday tag.** The journal has "Red to Green (Intraday)". The rulebook is for swing
   trades. Either the intraday tag is a label only, or it needs its own exit rule (question 9).
5. **The 8% maximum stop** in the brain template conflicts with A13's "about 3%". The template is a machine summary,
   not his rule; A13 wins.
6. **D47 shorts are the long setup reversed:** fine for green to red below the 200-day. But his Go Signal uses green to
   red through the prior close as a BULLISH shakeout in a leader. The course must not teach green to red as a short
   without the 200-day and RS filters.

## 8. Proposed rules for our course

Each line is measurable. Where sources disagree I give the options and a recommendation.

**What it is**
- **Name and line.** Red to green: after trading below the prior day's official close, the stock trades at least one
  cent above it during regular hours. The line is the prior close, never the day's open or VWAP. [source consensus]
  [UCT: "take out previous day close", 2026-11-01] Options: (a) prior close (recommended); (b) the day's open (candle
  color). Reason: every named source and his own ruling use the prior close.
- **It is a trigger that rides on a setup.** Teach it as the entry for a stock that already qualifies (a leader pulling
  back to support, a post-earnings flag, an inside day, a gap support). On its own it showed no edge (Tables 2 and 5).
  [measured] [UCT: "There is nothing I like more than a gap down reversal to give me signal"]
- **The open.** The A version opens at least 0.7% below the prior close. [UCT: "a gap down of 0.7% or more that gets
  bought up"] A smaller gap down, or a flat or green open that dips red (Bracco's TEM), is a lesser version. [UCT for the
  example] [my proposal for calling it lesser]
  Options: (a) 0.7% floor for the A version, smaller allowed as B (recommended, his number); (b) any open below; (c)
  any trade below. Note: our data did not show bigger gaps doing better in the 5-minute window, so the floor rests on his
  words, not on a test.
- **Gap ceiling.** About 4% for the normal version; a bigger gap is a news event and belongs to the gap setups (Bear Gap,
  News Failure, Episodic Pivot) unless he says otherwise. [my proposal] Basis: big gaps rarely fill the same day (Table 1:
  23% for 4-8%, 11% for 8%+; Bulkowski 23% for 3%+ in the 2010s) and QuantRocket's "large down gaps" keep falling.
  [source consensus] His AEHR -9% reversal is the rare exception.

**Prior trend and location (longs)**
- **Above the 200-day SMA**, prior close. [house rule B26, hard]
- **Rising 20-day EMA** (today's value above the value 5 sessions ago). [UCT: "strong trend that is pulling back";
  "a rising 20EMA"] [my proposal for the number]
- **RS 80 or more.** [house rule C31]
- **Within 10% of the 10-day average** at the prior close. [house rule C29] [measured: the extended group was worst]
- **The dip tags support:** the low before the cross is within 1% of the prior day's 9-day EMA, 20-day EMA, 50-day or
  200-day SMA, or a level he marks (gap support, HVC, inside day low, breakout level). [UCT: 20EMA, 9EMA, 200SMA, HVC,
  gap support quotes] [my proposal for the 1%]
- **Structure before:** an orderly pullback, flag, inside day or higher low in the last 1 to 5 sessions. [UCT: "inside
  day and a higher low at a rising 20EMA"; "Flagging out"] Not measurable from one bar; graded (section 9).
- **Liquidity:** $10+, $20 million a day; own no more than 1% of the stock's daily volume. [house rules B23, D42]
- **No earnings in the next 3 sessions.** [house rule B22]

**Volume**
- No hard volume rule. Higher volume on the reclaim and a wider range are a plus, graded. [UCT: "would love for volume to
  increase"; IU: "greeted with more buyers"] [measured: first-30-minute relative volume did not separate winners in the
  5-minute test]

**The buy**
- **Trigger:** the first trade at least one cent over the prior close after the stock traded below it. [source
  consensus] Do not buy under the line in anticipation. [brain template mistake list; Bohen: "wait for confirmation"]
  Options: (a) the first trade through (recommended; he buys the cross, "Bought Thursday red to green"); (b) a 5-minute
  close over the line (fewer whipsaws, worse price); (c) the day's close over the line (the daily footprint; Table 5:
  no better). IU's "anticipate" is the aggressive day-trader variant; not recommended for the course.
- **Order:** a market order as price trades through (a stop-market order a cent over the prior close is the same).
  [house rule E57]
- **No chase:** skip if the price is more than 4% above the prior close when you act. [house rule C28]
- **Full size at one price.** No starter, no add. [house rule A5] [UCT: "immediate full size"]

**The stop**
- **A few cents under the day's low at the time of the buy** (the low of the dip). [house rules A3, F62] [UCT: Bracco
  "moved my stops up to todays low"; owner "a stop at Thursday's low"] [originator for intraday entries: Kullamagi "Stop
  is always lows of the day"]
- **Width:** within about 3% of the entry. If the honest stop is wider, skip or size down by the stop. [house rules A3,
  A13] [measured: 94% of intraday R2G stops were within 3%]
- Options he could choose instead: the prior day's low (the firm's one logged trigger); the key moving average (brain
  template). Recommendation: the day's low, because it is what he and Bracco used, it is the tightest honest stop, and
  the rulebook defaults to it.

**Trims and trail** (house defaults; nothing in the sources argues for different ones)
- Breakeven at 2R to 5R. A third at 3R, a third at 5R; if the stock opens past a level, take that trim at the open. [house
  rules B19, E51, F63]
- Trail the last third: a close under the 10-day average for fast movers, the 21-day for steadier ones. [house rule E52]
  [brain template: 20-day EMA trail, consistent]
- Time stop: under 1R after 10 sessions, sell. [house rule C33] [UCT: "minimum 3-7 day burst swing trades"]
- A gap through the stop: the first 30-minute low is the new stop; out past 2R. [house rule B20]

**What invalidates it**
- A trade below the stop. [house rule A4]
- **Option, his call:** a close back under the prior close on the entry day = sell at the close. [brain template]
  [measured: a small help, -0.34R versus -0.47R on those trades, one period] Recommendation: teach it as a warning sign,
  not a rule, unless he adopts it (his "my stop is my stop").
- Do not take it if: the stock is below the 200-day, more than 10% over its 10-day, has earnings within 3 sessions, the
  gap is over about 4% on news, or the market reading is Red. [house rules B26, C29, B22, B18, D46]
- Third failed attempt in a week on the same stock: stop trying. [house rule E56]

**The short mirror: green to red**
- After trading above the prior close, the stock trades at least one cent under it; short with a market order. [source
  consensus: Aziz as quoted, IU] [house rules D47, E57]
- **Only below the 200-day SMA**, RS 20 or less, a falling 20-day EMA, the gap up at least 0.7% into resistance (the
  20-day EMA, 50-day, a breakdown level), not hard to borrow. [house rules B26, C31, D48] [my proposal for the EMA and
  the 0.7%]
- Stop a few cents over the day's high at the time of the short; within about 3%. Trims, trail and time stop mirrored.
  [house rules A3, A13, D47]
- A parabolic climax day is Bracco's separate setup (first entry under VWAP, second under the day's low, stop the day's
  high, target the 9-day EMA). Do not mix the two. [UCT: Bracco]
- **Never short a green to red in a leader above the 200-day:** in his Go Signal that move is the shakeout before the
  long. [UCT: 2026-11-01 ruling] [house rule B26]
- [measured] The 5-minute test: green to red shorts +0.48R versus +0.18R for a random short, in a falling market; below
  or above the 200-day made little difference in that window.

**Best market conditions**
- A Green market reading, ideally the index itself gapping down and getting bought the same morning. [house rule B18,
  F65] [UCT: "I would love a gap down and red to green move on Tuesday or even Wednesday"]
- Shorts: a Red market with the stock below its 200-day. [house rule D46]

**Common mistakes** (each from a source or our data)
1. Buying under the line in anticipation. [brain template; Bohen]
2. Treating every red to green as a signal: two of three gap-down days cross, half fail by the close. [measured]
3. A whippy first-minute cross on a tiny gap: in the first 5-minute bar, 67% were stopped the same day. [measured]
4. Buying the cross in a stock that faded hard the day before, into trapped buyers. [Bohen] (Our data did not confirm
   this one; teach it as his reasoning, not a law.)
5. Buying a big news gap down because it ticked green. [QuantRocket; Table 1]
6. Ignoring the market: "the market had other plans" (NOW, 2026-09-27). [UCT]
7. A stop wider than the dip's low, set to give it room. [house rule A4; brain template]
8. Forgetting that a gap can jump the stop: CRM's 4% loss came on the next morning's gap, after a peer's report
   ("when ServiceNow dumped"). [UCT] [house rule B20]
9. Calling a green candle (close over the open) a red to green while the stock is still under the prior close. [section 2]
10. Starting small and adding on the cross. [house rule A5]

## 9. Grading: what makes an A+ and what makes a B-

His ruling E50: grading is discretionary and hard to define; no checklist is taught as ours. The lines below are what the
sources and his own quotes point to, for him to accept, edit or drop. Each is observable on the chart.

**A+ (size up, D38; risk 1% to 1.5%, E49)**
- A true leader: RS 90+, in a strong group, above a rising 20-day, 50-day and 200-day. [UCT: leaders] [house rule C31:
  80+] [my proposal: 90+ for an A+]
- An orderly pullback of a few days on lighter volume into the rising 20-day EMA (or 9-day EMA, 50-day, gap support, HVC),
  ideally after an inside day or a higher low. [UCT: TWLO 2026-09-06, BE 2026-03-01 "A+ setup in my book"]
- A gap down of 0.7% to about 3% that tags the level. [UCT: 0.7%] [my proposal for the 3%]
- A quick cross, inside the first hour, that does not chop back and forth across the line. [UCT: "quick red to green";
  "first or second hourly candle"] [his examples: NOW and CRM chopped back and forth across the line and failed]
- The market gapped down too and got bought. [UCT]
- The day closes above the prior close in the top third of its range, and the next day holds the red to green day's low
  (known only after the buy: use it to grade examples and to judge the hold). [measured: closing above c1 was the
  single biggest difference, +0.88R versus -0.74R]
- Stop 1% to 2.5% under entry. [house rule A13: about 3%] [my proposal for the range]

**A / B (normal size)**
- Same, with one thing missing: the level is less clean, the cross comes later in the morning, the gap is under 0.7%, or
  the market is only Yellow.

**B- (size down, D38; risk 0.25% to 0.5%, E49) or skip**
- Not at a level (in the middle of nowhere); the 20-day EMA flat or falling (his ALAB 2026-08-13 sat under a falling
  20-day EMA and 13% under its 50-day, and failed). [measured on his example]
- A tiny gap (under 0.7%) crossed in the first minutes, or many crosses back and forth. [measured: gaps under 0.7% were
  stopped the same day 59% of the time; crosses in the first 5-minute bar, 67%]
- A slow, grinding cross long after the open. [UCT: he wants it "quick"] [measured, mixed: in the 5-minute test crosses
  between 9:35 and 11:55 did worst (-0.10R to -0.19R) while first-bar and afternoon crosses were about flat; in the
  hourly data the hour of the cross did not change how often the close held]
- RS under 80, a stock more than 10% over its 10-day, earnings within 3 sessions, a stop over 3%. [house rules C31, C29,
  B22, A13]
- A big news gap down. [QuantRocket; Table 1]
- Skip outright: below the 200-day, a Red market, under $10 or $20 million a day. [house rules B26, B18, B23]

## 10. Questions for the owner

1. **Setup or trigger?** The course plans call Red to Green an entry trigger, not a setup; the journal lists it as a
   swing setup and an intraday setup. Options: (a) a trigger only, taught inside other setups; (b) its own setup unit;
   (c) both: a trigger lesson, plus one named setup, *gap down red to green at the 20-day EMA*. I recommend (c).
2. **Which line?** (a) the prior close (your 2026-11-01 words); (b) the day's open (candle color). The app's hourly Go
   Signal finder uses (b) today. I recommend (a) everywhere and fixing the finder.
3. **How big a gap down?** (a) 0.7% or more for the A version (your 2025-06-22 words), smaller as a lesser version; (b)
   any open below the close; (c) any dip below, even after a green open (Bracco's TEM). And a ceiling: (a) about 4%; (b)
   none; (c) another number.
4. **Entry:** (a) the first trade through the prior close, market order; (b) a 5-minute close over it; (c) the day's
   close over it. I recommend (a).
5. **Stop:** (a) a few cents under the day's low at entry; (b) under the prior day's low; (c) under the 20-day EMA. And
   if (a) is more than 3% away: skip, or take it at a smaller size?
6. **Failed reclaim:** if it closes back under the prior close the same day, (a) sell at the close; (b) keep the stop
   ("my stop is my stop"); (c) teach it only as a warning.
7. **Time of day:** (a) no time rule (C30 as it stands); (b) the cross must come in the first or second hourly candle,
   as you said for the Go Signal; (c) a grading factor only. I recommend (c).
8. **Green to Red:** (a) a short setup only, below the 200-day, as our long reversed (D47); (b) also teach it as the
   bullish shakeout inside your Go Signal; (c) both, clearly separated. I recommend (c).
9. **Intraday tag:** keep "Red to Green (Intraday)" and "Green to Red" as day-trade labels with their own exit (for
   example, flat by the close), or fold them into the swing rules?
10. **Private notes:** may the course quote your Discord posts that are already summarized in the repo's brain files
    (for example the 2024 note rating red to green five stars), or only the public Substack?
11. **Young stocks:** for a stock with no 200-day average yet (Q, GLXY in your examples), is a long allowed, and under
    what rule (for example above the 50-day, or above the IPO-day low)?
12. **The Kicker line:** the course docs call the Kicker "the cleanest RED TO GREEN entry". A Kicker opens above the
    prior close, so it is not red at the open. Fix it (for example, call it the mirror of a red to green), or remove it?
13. **Examples:** do the ten candidates in section 4.8 and your named examples in section 4.7 look like ones you would
    teach? Which to cut?

## 11. Sources

Read 2026-11-09 unless noted. "Saved" means a copy was downloaded and quotes were checked against it by script.

| # | Source | Publisher, author, date | URL or path | Reliability note |
|---|---|---|---|---|
| 1 | UCT Substack, all 103 posts in the sitemap (27 mention red to green, green to red or r2g; 35 mentions in all, re-counted in checking) | Uncharted Territory: the owner (TSDR), Bracco, the contributor VIOTTI, unsigned Index sections; posts dated 2025-06-01 to 2026-11-08 | https://unchartedterritoryy.substack.com/sitemap.xml and the post links in section 6 | House source; saved through the public post API; quotes checked by script; section authors checked by the post's own headings |
| 2 | "The Parabolic Short" | UCT, Bracco, 2025-06-13 | https://unchartedterritoryy.substack.com/p/the-parabolic-short | House source; saved |
| 3 | Owner rulings | the owner, 2026-10-27 and 2026-11-01 | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (lines 228-308) | His own words, logged by the review sessions |
| 4 | Account rulebook | the owner, 2026-11-09 | `docs/study/sizing_rule.md` section 9 | House rules |
| 5 | "5 Day Trading Strategies & Ideal Chart Setups" | Investors Underground, byline InvestorsLive, 2017-03-23 | https://www.investorsunderground.com/day-trading-strategies-chart-setups/ | Established day-trading educator; saved |
| 6 | "7 Actionable Trading Strategies and Lessons from Textbook Trading" | Investors Underground, byline InvestorsLive, 2017-05-02 | https://www.investorsunderground.com/profitable-day-trading-strategies/ | Same; saved |
| 7 | "stuck on Red to Green..." forum thread, quoting Aziz's *How to Day Trade for a Living* | Bear Bull Traders Forums, posts of 2018-04-16 to 2022-01-18 | https://forums.bearbulltraders.com/topic/283-stuck-on-red-to-green/ | A forum; used only for members' quotes of the book, which I could not check against the book; saved |
| 8 | Bear Bull Traders books page | Bear Bull Traders | https://bearbulltraders.com/books/ | Confirms the firm lists the book; no content read |
| 9 | "The key component of the red-to-green pattern" | StocksToTrade, Tim Bohen, 2022-12-20 | https://stockstotrade.com/the-key-component-of-the-red-to-green-pattern/ | Educator, promotional tone; saved; site lists an AI Use Disclosure |
| 10 | "The only time a gap down is a good thing" | StocksToTrade, Tim Bohen, 2024-01-29 | https://stockstotrade.com/the-only-time-a-gap-down-is-a-good-thing/ | Same |
| 11 | StocksToTrade and Timothy Sykes sitemaps (to find the posts above and the "First Green Day" pages) | stockstotrade.com, timothysykes.com | https://stockstotrade.com/sitemap.xml, https://timothysykes.com/sitemap.xml | Index only |
| 12 | Trading Innovation timeline | Larry Williams | https://www.ireallytrade.com/innovation/ | Originator's own site; saved |
| 13 | *Long-Term Secrets to Short-Term Trading*, 2nd ed., Chapter 1 excerpt | John Wiley & Sons, Larry Williams, 2011 | https://catalogimages.wiley.com/images/db/pdf/9780470915738.excerpt.pdf | Originator's words; Chapter 1 only; saved |
| 14 | AIQ *Opening Bell* interview (Three-Day Unfilled Gap Reversals) | Linda Raschke, August 1997, on her site | https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf | Originator-level trader; her own rules; saved; two-column PDF, so I quoted single lines only |
| 15 | *Active Trader* interview "We spend a day with Linda Raschke" | Mark Etzkorn, February 2004, on her site | https://lindaraschke.net/wp-content/uploads/2026/01/raschke0204.pdf | Interview; the "95 percent" line is a claim, not a study; saved |
| 16 | Linda Raschke articles page | lindaraschke.net | https://lindaraschke.net/articles/ | Index; nine other PDFs checked, nothing on red to green |
| 17 | "Bulkowski's Opening Gap Trading Setup -- Long Side" | ThePatternSite, Thomas Bulkowski, updated 2016-12-25 | https://www.thepatternsite.com/gapsetupl.html | Measured statistics; read twice through a fetch tool (HTTP 406 to plain downloads); **AI-training notice on the site** |
| 18 | "Bulkowski's Opening Gap Trading Setup -- Short Side" | same | https://www.thepatternsite.com/gapsetups.html | Same; **AI notice** |
| 19 | "3 TIMELESS setups that have made me TENS OF MILLIONS!" | Kristjan Kullamagi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Originator of his setups; used for the stop rule only; saved |
| 20 | "Should You Buy or Sell Stocks that Gap Down?" | QuantRocket, Brian Stanley, 2020-09-02 | https://www.quantrocket.com/blog/buy-or-sell-down-gaps/ | Vendor backtest; parameter search makes it optimistic; saved |
| 21 | "Gaps and Gap Analysis" | StockCharts ChartSchool, no author or date shown | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis.md | Established educator; vocabulary only; saved |
| 22 | "Gap" | Investopedia (the writer's copy said "updated 2026-07-17"; not re-read) | https://www.investopedia.com/terms/g/gap.asp | Reference; vocabulary only; the writer saved a copy, but both checks got HTTP 402 to a plain download and the fetch tool refuses the domain, so its two quotes were replaced by StockCharts' (section 3.10) and nothing here rests on it |
| 23 | Berkman, Koch, Tuttle, Zhang, "Paying Attention: Overnight Returns and the Hidden Cost of Buying at the Open", JFQA 47(4) 715-741, 2012 | Cambridge University Press | doi 10.1017/S0022109012000270 (abstract through https://api.crossref.org) | Peer-reviewed; abstract only |
| 24 | Heston, Korajczyk, Sadka, "Intraday Patterns in the Cross-section of Stock Returns", Journal of Finance 65(4) 1369-1407, 2010 | Wiley | doi 10.1111/j.1540-6261.2010.01573.x (abstract through Crossref) | Peer-reviewed; abstract only; paraphrased |
| 25 | "Red to Green Move" | therighttrader.com, "By The Right Trader", updated 2026-10-13 | https://therighttrader.com/learn/trading-strategies/red-to-green-move | **Not used:** no author; reads as AI-written |
| 26 | "THE RED TO GREEN AND GREEN TO RED ENTRY STRATEGY" | TradingView user TheTrad1ngGame, 2021-09-08 | https://in.tradingview.com/chart/FB/9IGcurr7-THE-RED-TO-GREEN-AND-GREEN-TO-RED-ENTRY-STRATEGY | **Not used for rules:** anonymous user idea; only to show the open-line reading exists |
| 27 | "Red to Green Previous Day Price Close" | usethinkscript.com forum | https://usethinkscript.com/threads/red-to-green-previous-day-price-close.7173 | **Not used:** forum (the second check got HTTP 403 from the site's bot wall, so even the title is the writer's reading) |
| 28 | "Gaps and traps" | Stockbee, Pradeep Bonde, 2006-11-22 | https://stockbee.blogspot.com/2006/11/gaps-and-traps.html | Read; nothing on intraday reversal of a gap; not used |
| 29 | Not read: Warrior Trading pages (HTTP 403), SMB Capital's "Red Dog Reversal" (no page found), technical.traders.com (HTTP 403), bullishbears.com (HTTP 403), TraderLion, Aziz's book itself | | | Gaps in this dossier |
| 30 | App code and docs | this repo, read 2026-11-09 at commit 9b5e51efba | `api/services/screener/bar_character.py`; `api/services/chart_iq/engine/v3.py`, `v44_read.py`; `api/services/pattern_engine/detectors/uct/uct_go_signal.py`, `uct_oops_reversal.py`; `scripts/study/find_go_signal_hourly.py`; `app/src/constants/setupGroups.js`; `app/src/pages/journal-2-0/lib/setupTagMap.js`; `app/src/pages/modelbook/setupCatalog.js`; `api/services/uct_agent/coach/setups.py`; `app/src/agent/coach/brain.js`; `docs/study/TRADE_PLANS.md`; `docs/study/UNITS-method.md`; `docs/study/UNITS-foundations.md`; `docs/study/bank/walk.method.json`; `docs/curriculum/uct_method_course.json`; `docs/study/research/definitions.json`; `docs/wisdom/vocabulary/setup-vocabulary-v1.json`; `docs/superpowers/research/setups/setup_criteria.json`, `SETUP_NOTES.md`; `docs/study/levels/brain_kb_2026-11-06.json`, `docs/study/levels/dossiers/oops.md`; `docs/study/setups/research/30-oops-reversal.md` | What the app does today |
| 31 | Price data | the app's sandbox daily `bars.db` (read-only; 3,874 names; to 2026-11-06), the session's intraday store (5-minute bars 2026-08-17 to 2026-11-06 for 1,000 names; hourly 2023-12-12 to 2026-11-06), Yahoo earnings dates | session scratch folder, not in the repo | Survivorship bias (current names); no costs; see section 4.6 |

## Removed in checking

Two checking passes, both on 2026-11-09. Nothing below changes a rule; the proposed rules in section 8 and the grades
in section 9 stand on quotes and numbers that were confirmed.

**Second cold check (third session), 2026-11-09**
1. **Attribution fixed: the "r2g" quote (2026-03-25) is VIOTTI's, not Jersace's.** The fresh copy of
   `the-rest-of-the-week-ecf` puts "Would probably try a starter on a wick into there and then add on a r2g move" in the
   CONTRIBUTORS section under the entry "VIOTTI - BKSY". Corrected in the section 2 table, section 6.5, section 7 (A5)
   and the Sources table. The quote itself is exact.
2. **Claim removed: that the Three-Day Unfilled Gap Reversal is "one of the patterns of her book *Street Smarts*".** The
   August 1997 interview prints the pattern's rules and discusses the book, but does not say the pattern is in it, and
   the book was not read. Sections 2 and 3.5 now say only what the interview says.
3. **Wording fixed, IWM:** "fell 10.3% over the window" is the move from the 2026-08-14 close (the close before the first
   test day) to 2026-11-06; close to close inside the window it is 10.0%. The sentence now says which.
4. **Wording fixed, NOW 2026-09-25:** "crossed back 6 times" now reads as what was measured: the 5-minute closes flipped
   across the prior close 6 times (12 bars straddled the line).
5. **Wording fixed, section 5.6:** only `UNITS-foundations.md` uses the words "the firm's four entry triggers";
   `walk.method.json` calls them "The four entry triggers".
6. **Sources table:** row 1 now gives the posts' real date span (2025-06-01 to 2026-11-08) and names VIOTTI; row 22
   (Investopedia) says that neither check could re-read it (HTTP 402) and that nothing rests on it; row 27
   (usethinkscript) says the second check got HTTP 403, so its title is the writer's reading.
7. **Checked and kept, for the record:** all 35 mentions in 27 posts (re-counted: 35 and 27); `sunday-scans-d40` has no
   mention; every "owner" quote sits under "TSDR's Weekly Outlook & Watchlist" (or "TSDR TRADING") and none under
   "Bracco's Breakdown"; the QQQ, SMH and 2026-11-01 QQQ lines sit in the Index sections; the Bear Bull Traders posts are
   dated 16 Apr 2018 (DougT), 28 Dec 2018 (sandstorm) and 29 Dec 2018 (Robert H); the two brain-KB notes paraphrased in
   section 6.6 exist (`brain_kb_2026-11-06.json` id 10727, "TSDR 2024-06-03", "5 Star", "2 min chart";
   `brain_kb_rules_2026-11-06.json`, "TSDR desk log — 2025-05-22", an r/g entry through a $10.45 HVC with the stop at
   $9.80 under a $9.83 low); Bulkowski's two pages were read again through the fetch tool and every figure in section
   4.1 matched; Kullamagi's page and Bracco's "The Parabolic Short" contain no "red to green" or "green to red".

**First cold check (second session), 2026-11-09**
8. **Investopedia's two "Gap" definitions (partial and full gap) were removed** and replaced by StockCharts' "Gap
   Trading Strategies" definitions of the same terms (section 3.10), because the page could not be re-read.

## 12. Examples (from our data)

**The scan's rule (section 8 plus the house rules), run on hourly bars.** Red to green is an intraday trigger, so the
scan ran on the sandbox's hourly bars (Yahoo, regular hours, bars start 9:30; 2023-12-12 to 2026-11-06; the 963 names
that have hourly bars and ever met the liquidity rule, ETFs excluded from the examples). A session is a hit when: the
prior close is above the 200-day SMA (B26); the 20-day EMA is above its value 5 sessions ago (rising); the RS proxy
rank is 80 or more (C31; the proxy is the percentile, among the scanned names on that day, of the IBD-style weighted
3/6/9/12-month return, not the app's RS rating); the prior close is within 10% of the 10-day SMA (C29); $10+ and $20
million a day (B23); the day OPENS 0.7% to 4% below the prior close and is not an earnings reaction day (an earnings gap
is another setup); the low of the session up to the cross is within 1% of the prior day's 9-day EMA, 20-day EMA, 50-day
SMA, 200-day SMA or the prior day's low; the first hourly bar whose high trades above the prior close, by bar 3 (12:30),
is the trigger; the buy is a market order one cent over the prior close (E57), never more than 4% above it (C28); the stop
is 3 cents under the day's low so far and must be within 3% (A13); no earnings in the next 3 sessions (B22). The outcome
walks the rest of the session on hourly bars, then the daily bars for 60 sessions: the first of the stop, 3R or 5R, a
FIXED stop with no trims, no breakeven move and no trail. Script: `scratchpad/setups/43-red-to-green/final/scan_r2g.py`;
every hit and its outcome in `final/hits.json` (3,897 hits over 679,518 sessions, 111,152 of them gap-down days in the
0.7% to 4% band).

**Base rate (hourly, 2023-12-12 to 2026-11-06, all 963 names scanned, budget not exceeded).** 3,897 hits; 30.8% reached
3R and 21.4% reached 5R before the stop; 26.1% were stopped the same day; 91.5% hit the fixed stop at some point within
60 sessions (a fixed stop with no trims and no trail, so the number says how far the move went, not what the house exit
would have made). What separated the groups: the day's close. Hits that closed back above the prior close (2,037)
reached 3R 47.7% of the time and 5R 33.0%; those that closed red (1,860) reached 3R 12.3% and 5R 8.7%, which matches
section 4 (closing above c1 was the biggest single difference) and section 9's grading line. The hour of the cross
changed little in how far the trade went (bar 1: 31.1% to 3R, bar 2: 28.7%, bar 3: 30.4%) but a lot in how often it was
stopped the same day (bar 1: 29.1%, bar 2: 11.8%, bar 3: 7.9%): a first-hour cross is the fast one and the whippy one.
The level made no difference (9-day EMA 31.5% to 3R, 20-day EMA 30.8%, 50-day 30.6%, prior day's low 30.3%; the 200-day
had 5 hits, none worked). The gap size made no difference inside the band (0.7-1.5%: 30.3%; 1.5-2.5%: 33.0%; 2.5-4%:
28.6%, only 42 hits). By year: 2024 32.2% to 3R, 2025 30.7%, 2026 29.9%.

**Companion base rate, the daily footprint over 25 years** (`final/scan_daily.py`, `final/hits_daily.json`; all 2,630
liquid names, 2001-01-01 to 2026-11-06, budget not exceeded): the same filters where daily bars allow them (the open
0.7% to 4% below the prior close, the day's high above it, the day's low within 1% of a level, above the 200-day and
50-day, rising 20-day EMA, a positive 63-day return in place of the RS rank, entry one cent over the prior close, stop 3
cents under the day's low). 71,620 hits; 31.2% reached 3R and 21.3% reached 5R; the ones that closed green (38,040):
43.0% and 29.7%. Caveat: daily bars cannot see a same-day stop-out (the stop sits under the day's own low), so this
companion rate is optimistic by about the 26% same-day stop rate the hourly scan measured; it is here only to show that
the hourly window's numbers are not a three-year accident (every year from 2001 to 2026 sits between 21% and 39% to 3R).

**The 10 examples** (one per ticker, 2024 to 2026, which is as far as the hourly bars reach; all closed green on the
day; all crossed in the first hourly bar, the owner's "first or second hourly candle"; each PNG shows the daily context
with the buy line, stop, 3R and 5R, and the hourly cross below it; sheets `final/sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png`). "Best R" is the fixed-stop high-water mark within 60 sessions, not a house-exit result.

| # | Ticker | Date | Level | Open vs prior close | Dip low | Buy | Stop (risk) | Day close | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | HOOD | 2024-11-04 | 50-day SMA | 23.75 vs 23.97 (-0.9%) | 23.54 | 23.98 | 23.51 (2.0%) | green, DCR 0.76 | 62.8R | A leader (RS 97) pulling back to a rising 50-day after a 5-day flag; opens red, tags the line, crosses in hour one, closes in the top quarter; 3R in 2 days |
| 2 | TWLO | 2024-11-20 | 9-day EMA | 95.38 vs 96.35 (-1.0%) | 94.70 | 96.36 | 94.67 (1.8%) | green, DCR 0.91 | 32.9R | Post-earnings runner (RS 93) with a 4-day pullback to the 9-day EMA; opens red into it, reclaims in hour one, volume 1.1x; 3R the next day |
| 3 | DAL | 2024-10-29 | 9-day EMA | 54.70 vs 55.38 (-1.2%) | 54.60 | 55.39 | 54.57 (1.5%) | green, DCR 0.99 | 17.8R | Steady uptrend over a rising 9/20 EMA; a 3-day dip, gap down to the 9-day EMA, first-hour reclaim, closes at the high; 3R the next day |
| 4 | CEG | 2025-10-01 | 20-day EMA | 325.97 vs 329.07 (-0.9%) | 323.88 | 329.08 | 323.85 (1.6%) | green, DCR 0.95 | 16.0R | Two-week drift down to the 20-day EMA, a gap down that tags it, a wide green first hour on 1.2x volume; 3R the next day |
| 5 | CDE | 2025-08-22 | 9-day EMA | 11.50 vs 11.67 (-1.5%) | 11.50 | 11.68 | 11.47 (1.8%) | green, DCR 0.71 | 56.9R | A metals leader (RS 97) after a 4-day flag on the 9-day EMA; opens at the low, never trades lower, crosses in hour one; the market gapped down and was bought the same morning |
| 6 | TSEM | 2025-09-17 | 9-day EMA | 65.06 vs 65.71 (-1.0%) | 64.83 | 65.72 | 64.80 (1.4%) | green, DCR 0.77 | 69.4R | Straight-line leader (RS 93) with a 3-day inside pause; a small gap down to the 9-day EMA, the first hour engulfs the prior day, volume 1.4x; 3R the next day |
| 7 | TPR | 2025-12-04 | 50-day SMA | 110.91 vs 111.92 (-0.9%) | 110.78 | 111.93 | 110.75 (1.1%) | green, DCR 0.88 | 42.4R | A three-week correction ends with a higher low at the 50-day; gap down to the line, reclaimed in hour one, the tightest stop of the ten; 3R the next day |
| 8 | PANW | 2026-06-11 | 20-day EMA | 260.99 vs 263.22 (-0.8%) | 258.10 | 263.23 | 258.07 (2.0%) | green, DCR 0.98 | 26.3R | Five-day pullback to a rising 20-day EMA in a breakout run; opens red, first-hour reclaim, closes at the high; 3R the next day |
| 9 | ANF | 2026-10-08 | 20-day EMA | 137.72 vs 139.44 (-1.2%) | 137.72 | 139.45 | 137.69 (1.3%) | green, DCR 0.67 | 18.5R | Post-earnings flag resting on the 20-day EMA; opens AT the low and crosses at 9:50 (checked on 5-minute bars: the low came before the cross); light volume (0.6x) is its one blemish; 3R in 2 days |
| 10 | APA | 2026-08-07 | 20-day EMA | 35.98 vs 36.53 (-1.5%) | 35.70 | 36.54 | 35.67 (2.4%) | green, DCR 0.88 | 18.9R | A V-recovery back over the 20-day, a 3-day dip, gap down to the line and a first-hour reclaim; the widest stop of the ten, still inside 3%; 3R the next day |

**Notable failures (from the same scan).**
- **The first-hour cross hides the order of the low and the cross.** TXG 2026-09-08 (9-day EMA, RS 100, closed green,
  best 37R on hourly bars) was my ninth example until the 5-minute bars showed the first 5-minute bar already ticking
  over the prior close at 9:30 with a low of 61.68, and the day's low of 61.61 printing at 9:45, AFTER that first cross.
  A "first trade through" buy with the stop under the low so far (61.65) was stopped out 15 minutes later; the stock
  then crossed again and ran. I replaced it with ANF. Of the 40 best in-window candidates checked on 5-minute bars, 5
  (one in eight) had this shape. Hourly bars cannot show it, so for the nine examples before 2026-08-17 the honest
  statement is: the day's low sat under the first hour's cross, and whether the low printed before or after the first
  tick through the line cannot be seen in our data. This is section 8's "whippy first-minute cross" (common mistake 3)
  measured a second way, and it argues for his 5-minute-close or hourly-close trigger option in a first-hour cross.
- **Same-day stop-outs are the main cost, even in leaders at a level.** Among the 992 bar-1 hits with RS 90+ at an EMA
  or 50-day level, 292 (29%) were stopped before the close. The biggest names on the list: TSLA 2025-01-22 (9-day EMA,
  gap -1.7%, crossed in hour one, closed at 4% of its range), MU 2026-10-08, AMD 2024-03-14 and 2025-11-11 and
  2025-11-17 (20-day EMA, all closed in the bottom third), PLTR 2025-04-21 (50-day). Each crossed the line and then
  spent the day under it: the "close back under the prior close" warning sign in section 8 would have had them out at
  the close instead of at the stop only when the stop was wider than the day's fade, which it rarely was.
- **A green close is not a free pass.** 102 of the 540 RS-90+ level hits that closed green were still stopped within a
  few sessions without reaching 1R: NVDA 2025-08-14 (9-day EMA, closed at 72% of its range, best 0.63R, stopped two
  sessions later on the next gap down), META 2024-04-10 (20-day EMA, DCR 0.84, best 0.63R), COHR 2026-06-30 (20-day
  EMA, best 0R). The house rules answer this one: the fixed stop never moved, and the time stop (C33, 10 sessions under
  1R) and the breakeven move at 2R did not get a chance to apply.
- **His own names in the window.** TWLO 2026-09-02 met every rule at the 20-day EMA, crossed in hour one and was stopped
  the same day (best 0.6R); the retry on 2026-09-15, same level, ran 14.8R. CRM 2026-10-19 and 2026-10-20 crossed at the
  20-day EMA and faded (best 0.6R and 1.5R before the stop); CRM 2026-10-27 was stopped the same day. His ALAB
  2026-08-13, NOW 2026-09 and BE 2026-03 trades did not pass the scan's filters (ALAB under a falling 20-day EMA, as
  section 9 says).

**Limits.** The RS filter is a proxy rank, not the app's rating. The hourly bars begin 2023-12-12, so the examples span
three years, not decades; the 25-year daily footprint is the only longer check and it is blind to same-day stop-outs.
Hourly bars start 9:30 (bar 1 ends 10:30), so "first hourly candle" here is the first hour, not the 10:00 candle of a
clock-aligned chart. Nothing here was trimmed, trailed or moved to breakeven; the R figures are high-water marks against
the original stop. No example is an earnings reaction day (checked against the report dates); the gaps are ordinary
pullback gaps, not news gaps, as far as the report dates can tell.


## 13. Failures and near-misses (from our data)

**Built 2026-11-10 from the same hourly scan (`final/hits.json`) and a one-gate-relaxed rerun (`final/near_scan_r2g.py`, `final/near_hits.json`, 2024 on); charts by `final/fail_near_r2g.py`, the winners' renderer: the daily context with the 5-session box, the prior close as the buy line, the stop, 3R and 5R, and the hourly cross below it.** Sheets: `final/fail_1-4.png` (the four failures), `final/near_1-4.png` (the four near-misses), `final/pair_30-oops-reversal.png` (a red to green above an Oops reversal). The failures span 2024, 2025 and 2026 (the hourly bars begin 2023-12-12). Buy = a cent over the prior close; stop = 3 cents under the day's low at the buy. Every number is read off the bars.

**Four valid setups that lost (every gate passed, stopped before 3R).**

| # | Ticker | Date | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | AMD | 2024-03-14 | 194.80 | 190.33 (2.29%) | 12:30 the same day | Opened -1.0% (192.92 against 194.79), dipped to 190.36 at the 20-day EMA (191.72) and crossed the prior close in the first hour, RS 96, volume 1.06x. Best 0.06R; the second hour closed back under the line and the 12:30 bar took the stop; the day closed red at 23% of its range. The first-hour cross is the fast one and the whippy one: bar-1 crosses were stopped the same day 29% of the time. | rg.timing |
| 2 | TSLA | 2025-01-22 | 424.08 | 416.07 (1.89%) | 15:30 the same day | Opened -1.7% (416.72 against 424.07) onto the 9-day EMA (415.02), crossed in hour one, RS 97. Best 0.03R; it spent the whole day under the line and closed at 4% of its range, the stop going in the last hour. The close back under the prior close is the card's warning sign; here it came with the stop. | rg.inv_close_back_under |
| 3 | NVDA | 2025-08-14 | 181.60 | 179.43 (1.19%) | 2025-08-15, the next session | Opened -1.0% (179.79 against 181.59) onto the 9-day EMA (180.36), crossed in hour one, closed green at 72% of its range, best 0.63R. The next morning's first hour traded down through the stop. A green close is not a free pass: the fixed stop was still 1.2% under the buy and one red open took it. | rg.stop_gap |
| 4 | CRM | 2026-10-27 | 247.62 | 241.49 (2.48%) | 10:30 the same day | Opened -1.0% (245.20 against 247.61), dipped to 241.52 at the 20-day EMA (239.97), crossed in hour one, RS 82, volume 0.62x. 0.00R: the cross was the high and the second hour took the stop; the day closed at 3% of its range. The third stab in seven sessions after the 10-19 and 10-20 crosses faded (0.6R and 1.5R before their stops). | rg.tries |

**Four near-misses (each fails exactly one gate; the chart looks like the setup).**

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | PLTR | 2026-09-24 | rg.support_tag | the dip low 188.24 is 2.9% above the nearest level (the prior day's low, 182.94); the rule is within 1% | A gap down (-1.4%) and a first-hour cross with nothing under the dip: a trigger with no setup under it (rg.role). Bought 191.80, stop 188.21, closed green, 0.8R, stopped on 2026-09-28. |
| 2 | APP | 2025-10-17 | rg.ema20_rising | 20-day EMA 612.33 is under its value 5 sessions earlier (624.73); the rule is rising | A cross in a stock rolling over under a falling 20-day: a bounce in a correction, not a pullback in a trend. Bought 605.69, stop 598.97 (1.11%), 0.00R, stopped the same day. |
| 3 | WWD | 2024-07-24 | rg.earnings_window | a report on 2024-07-29, inside the next 3 sessions; the rule is no report in the next 3 sessions | A red to green at the 50-day SMA three sessions before earnings: B22 says no new buy. Bought 183.84, stop 181.46 (1.29%), 0.00R, stopped the same day. |
| 4 | DELL | 2026-07-07 | rg.stop_width | the stop 397.66 is 3.44% under the buy 411.81; the rule is within about 3% | A 3.4% gap down to the 20-day EMA whose dip is too deep for the stop: the edge of the gap setups, skip or size down by the stop. 0.00R, stopped the same day even so. |

**What the failures have in common.** All four crossed in the first hour, which is the fast cross and the whippy one. None ran past 0.63R. Three were stopped before the close and closed in the bottom quarter of the day's range (AMD 23%, TSLA 4%, CRM 3%); NVDA closed green and was taken out in the next morning's first hour. The reclaim came on light volume in every one (1.06x, 0.64x, 0.75x, 0.62x of the 50-day average): the line was crossed and nobody followed. The two warnings the card names were both present, a close back under the prior close and a repeat try on the same name, and the fixed stop under the dip's low, 1.2% to 2.5% away, kept each loss at 1R.
