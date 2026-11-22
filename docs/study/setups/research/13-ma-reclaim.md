# Setup 13: Moving-average reclaim, the "Remount" (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
PDF or file named next to it and kept to 40 words or fewer. Where a page could only be read through a fetch tool that
returns excerpts (it says so next to the quote), the quote is the tool's copy and should be checked by eye before it
ships. Nothing here is a ruling. Where I could not read a source, I say so and give no wording from it.

**Cold check, 2026-11-09.** A second reader re-opened every source named here on the same day: every outside web
page and abstract, the LSE working paper, the two IBD articles and both Bulkowski pages (through a fetch tool, as
before), the Stockbee search (with a control search that does return posts), the Internet Archive records, the two
video pages, the UCT sitemap and all 103 UCT Substack posts (every UCT quote below was matched word for word and its
section and ticker heading re-read), and the repo files (`uct_ma_reclaim.py`, `remount.py`, `setup_draw.py`,
`tag_textbook.py`, `setup_tags.py`, `registry.py`, `auto_structures.py`, the Model Book, journal, Study and
vocabulary files). Every outside and UCT quote checked out. What was wrong or missing is fixed in place: chiefly the
member drawing `draw:remount` was withdrawn on 2026-10-24 (5.4), the Study bank does hold "MA remount" items (5.7),
"MAU&R" is Gil Morales and Chris Kacher's own term with a definition on their site (3.4, now quoted), Bracco's
2026-04-05 note is about 2B reversals near the 200-day rather than a moving-average reclaim (6.3), and the owner's
named examples were checked on daily prices against the rules proposed here (new section 6.8). Everything changed or
dropped is listed under "Removed or corrected in checking" at the end.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's own
words or his authorised partner's; **[UCT]** UCT's own writers, the owner's verdict log or UCT's own code; **[house
rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner
to accept or change.

**The short version.**
- The owner's own word for this setup is **"remount"**. In UCT's public Substack posts it appears 90 times, about 70 of
  them within a few words of a moving average; "reclaim" appears 93 times, about 40 of them near an average (method in
  section 6; re-counted in checking: the totals match exactly, the near-an-average share moves by one or two with the
  exact word list). His focus is the **200-day**: "The remount and hold of the 200day has been a very reliable setup
  and area to risk off recently." (2025-07-13)
- **Setup 32 ("Remount") shares the word.** Our list has a separate setup 32, "Remount" (`32-remount.md`), which covers
  the production `remount` detector and the owner's remounts of price levels and pivots. This dossier covers the 50-day
  and 200-day moving-average version. Whether they are one setup or two is question 1.
- No outside trader owns this setup. The idea (price closing back above a long average it had lost) is the basic
  moving-average buy signal. The closest named original is Gil Morales and Chris Kacher's **Moving Average Undercut &
  Rally (MAU&R)**, defined on their own site: "When a leading stock breaks below its moving average, a move back above
  the moving average can provide a long entry point as the stock moves back up through the line." (2017-07-13). Others:
  Weinstein's Stage 2 entry over a rising 30-week average, IBD's 50-day and 200-day line rules, and Oliver Kell's Wedge
  Pop (for the short 10 and 20-day averages).
- The app has **three different detectors, plus a stricter check on the member tag and a Study "MA remount" event,
  under two names**: `uct_ma_reclaim` (50 or 200-day SMA, internal), the production `remount` detector (20 EMA, 50 SMA
  or an old pivot), the drawing `draw:remount` (a horizontal pivot, not an average at all; withdrawn from members on
  2026-10-24 after failing a stricter blind re-check), and the Study bank's Chart IQ "MA remount" (the 9 and 20-day
  EMAs). The member tag says "MA Reclaim"; the Model Book card, the drawing and the journal tag say "Remount".
- **Biggest house conflict:** `uct_ma_reclaim` and the member "MA Reclaim" tag can fire on a 50-day reclaim while the
  stock is still under a falling 200-day. Hard rule B26 forbids that long. That case is Weinstein's 4B- (setup 10).
- **Measured evidence is thin.** The only clean published test I found is on the S&P 500 index, not single stocks:
  crossing above the 200-day gave 90 signals in 25 years, 20 winners and 70 losers, the winners much bigger (Arthur
  Hill, StockCharts, 2019). Whipsaw is the normal case; the edge is in the few that run.
- **The owner's own examples, checked on prices (section 6.8).** Of the 16 reclaim days behind his named examples, only
  4 pass every rule proposed in section 8.1; the common misses are the 0.5 ATR margin (8), the chop count (6) and the
  volume bar (4); 11 of 16 came while the 200-day was still lower than 20 sessions earlier, and 10 of 16 had a
  reclaim-day low more than 3% under the close.
  The proposed numbers need his ruling before they are taught (question 14).

---

## 1. What it is

A stock that has been closing **below** an important moving average (the 50-day or the 200-day) closes back **above**
it, with buyers in control on that day. You buy the reclaim, with a stop under the reclaim day's low, betting that the
line has turned from a ceiling back into a floor.

**Why it works (the psychology).** These points are reasoning from the sources, not measured facts.
- **Who is trapped.** Traders who sold the break below the line, or shorted it, did so because the break looked like
  the start of a new downtrend. IBD: "Once below that line, institutional investors may use the 50-day line to mark a sell level."
  (IBD, 2015, through a fetch tool, section 3.3.) When price closes back above, that sell level is gone; shorts cover
  and sellers who want back in must pay up. The Wyckoff school calls the same shape a bear trap: "It is an example of a
  bear trap because the drop below support appears to signal resumption of the downtrend." (Bogomazov and Lipsett,
  ChartSchool, about a spring under a trading range, not an average.)
- **Who is buying.** Funds that use the 50-day and 200-day as reference lines. ChartSchool ("Moving Averages - Simple
  and Exponential", section 3.9): "The 200-day moving average is perhaps the most popular." And: "The 200-day moving
  average may offer support or resistance because it's widely used". Many trend rules only allow buying above it
  (Connors, Minervini, our own rule B26), so a reclaim makes the stock buyable again for a whole class of buyers at
  once.
- **Who is faked out.** The originators of the moving-average undercut put the trap in one line: "The stock
  essentially undercuts the moving average, faking out sellers and would-be short-sellers, and then rallies back above
  it." (Morales and Kacher, 2017, section 3.4)
- **Who is in the way.** Holders who bought above the line and are under water want out near breakeven. That is why a
  real reclaim needs force. IBD: "Stocks often need a large boost of buying power to muscle back above their 50-day lines
  after losing that level of support." (2015, fetch tool.) A weak, low-volume drift back above the line is the warning
  case (IBD 2013, section 3.3).
- **Why it often fails.** A moving average is a lagging line, not a wall. Murphy: "However, moving averages do not tell
  you in advance that a trend change is imminent." When the average is flat, price crosses it again and again (Weinstein's
  Stage 1; our own lab's main miss). Section 4: on the index, most crosses of the 200-day were small losers.
- **The owner's version of the psychology** is about the market as a whole: "When you lose the 200SMA you often see
  extreme volatility." (2026-11-08) A remount ends that regime: the stock (or the index) is back where trend traders
  operate.

---

## 2. Origin and naming

**No single originator.** A close back above a moving average is the basic moving-average buy signal of technical
analysis. The named versions:

| Name | Line | Who | Where | Status of my check |
|---|---|---|---|---|
| The 200-day price-cross buy rule | 200-day | Joseph Granville (attributed) | Broker and blog pages credit his books with eight buy and sell rules built on price and the 200-day; they do not agree on the wording or the order of the rules. The Internet Archive lists *Granville's New Key to Stock Market Profits* (1963) and *Granville's New Strategy of Daily Stock Market Timing for Maximum Profit* (Prentice-Hall, 1976). | **Not read.** Both are lending-only copies (checked: `access-restricted-item` true for both records). The pages that print the eight rules are broker and blog pages, not usable. **No Granville wording or rule is given here; the attribution is unverified.** |
| Stage 2 buy: price over a rising 30-week average | 30-week (about 150-day); lately the 50-day too | Stan Weinstein | *Secrets for Profiting in Bull and Bear Markets* (1988); described by Deepvue (his partner) and Bulkowski | Book not read. Deepvue and Bulkowski pages read. |
| "Stage 1B": retaking the 50-day inside a base | 50-day | Weinstein, as described by Deepvue | Deepvue, last updated 2024-07-26 | Read. |
| 4B- ("4B minus"): late Stage 4 stock back over its 50-day | 50-day, under a falling 200-day | Weinstein | Global Trend Alert; see `10-weinstein-4b.md` | Covered in setup 10. Banned as a long by B26 (section 7). |
| Back above the 50-day line / 200-day line | 50-day (10-week), 200-day (40-week) | William O'Neil / Investor's Business Daily | IBD articles | investors.com refuses this tool's crawler. Two IBD articles read through Yahoo Finance syndication (fetch tool). |
| **Moving Average Undercut & Rally (MAU&R)** | "its moving average" (any; no line named) | Gil Morales and Chris Kacher | Their own site, Virtue of Selfish Investing, FAQ first published 2017-07-13 | Read (added in checking). The originators' own definition; the closest outside name for this setup. |
| Failed rally back to the 50-day (the short mirror) | 50-day | Gil Morales and Chris Kacher | TradingMarkets interview, conducted 2000-01-06 | Read. |
| Wedge Pop, "The Money Pattern" | 10 and 20-day EMAs | Oliver Kell (Cycle of Price Action) | Described by Deepvue, 2025-03-21 | Deepvue read. Kell's own book and TraderLion pages not read (403). |
| Bullish price-to-moving-average crossover | any; 50 and 200-day named | StockCharts ChartSchool | "How To Trade Price-to-Moving Average Crossovers" | Read. |
| Law 6, "Follow that Average" | 20, 50, 200-day | John Murphy | ChartSchool "10 Laws"; StockCharts article 2025-11-22 | Read. |
| Remount | 200-day first; also 50-day, 20 EMA, "all MAs", VWAP | UCT (the owner, TSDR) | UCT Substack, 2025-06 onward | Read (section 6). Not found in any outside source (below). |
| MAU&R ("moving average undercut and rallies"), Morales and Kacher's term used by UCT | the 10-week (the "hammer candles" came off it); the 50-day among other supports | Bracco (UCT) | Sunday Scans, 2025-10-26 | Read. Bracco's use: a quick undercut in leaders he called "mean reversion longs", closer to the pullback family (setups 11 and 12). The originators' definition sets no time below the line, so it covers this setup too. |

**Where "remount" comes from.** I found no outside source that uses "remount" as a setup name. The Stockbee blog's own
search (https://stockbee.blogspot.com/search?q=remount) answers "No posts matching the query: remount." The same search
for "reclaim" also returns nothing. (Checked again 2026-11-09, with a control: the same search box returns 20 to 24
posts for "episodic", "momentum burst" and "anticipation", so the search itself works.) Our production `remount`
detector says it is the "Pradeep Bonde / Stockbee swing
system" and "popularized by Pradeep Bonde at Stockbee"; I could not support that (section 5). The repo's setup
vocabulary records "Remount" as "verbatim Sunday Scans usage" with `coined_by: null`
(`docs/wisdom/vocabulary/setup-vocabulary-v1.json`). So, on what I could check, **"remount" is UCT's own word**.

**Other names for the same picture:** MA reclaim, MA remount, 200-day reclaim, back above the 50-day line, regained the
line, bullish price crossover, 200-day breakout, "remounted all MAs" (several averages cleared at once, the owner's
phrase), cross back (Manrav, UCT), Stage 1B (Deepvue), Wedge Pop (Kell, short EMAs), Moving Average Undercut & Rally
or MAU&R (Morales and Kacher; also used by Bracco).

**Related setups in our library, and the line between them:**
- **Remount (setup 32):** the same word in our list. Its dossier covers the production `remount` detector (20 EMA, 50
  SMA or an old breakout pivot) and the owner's remounts of price levels ("remount the $100 level"). This setup is the
  50-day and 200-day moving-average version. Question 1 asks whether they are one setup.
- **Undercut & Rally (setup 29):** a reclaim of a prior low (a price), not an average. Morales and Kacher draw the same
  line: "an MAU&R works on an undercut of and rally back through a moving average, while a straight U&R is simply an
  undercut of a prior low".
- **2B reversal (setup 28):** a failed break of a prior extreme. Bracco's 2026-04-05 note (section 6.3) is a 2B near the
  200-day, not a moving-average reclaim.
- **20 EMA pullback / MA pullbacks (setups 11, 12):** the stock never lost its trend; a dip of a day or a few days under
  a *rising* line and back (U&R, MAU&R) belongs there. This setup is for a line that was *lost*.
- **Weinstein 4B- (setup 10):** a 50-day reclaim under a falling 200-day. Same shape, banned as a long by B26.
- **Launchpad (setup 7):** the averages bunch together and price pops out of the bundle. The owner's ruling there: the
  trigger must put price above all the averages, the 200-day included ("I want it above the MAs", section 6.5).
- **Wedge Pop / EMA Crossback (Kell):** the 10 and 20-day version, after a coil.
- **Golden cross:** the 50-day crossing the 200-day; a slower, line-on-line version.
- **AVWAP reclaim:** the same idea on an anchored VWAP (our `avwap_reclaim` detector, attributed to Brian Shannon; not
  checked in this pass).

---

## 3. Every definition I could find, source by source

### 3.1 Joseph Granville (attributed; not read)
- The 200-day price-cross rules are widely credited to him. I could not read his books (Internet Archive lending-only,
  search inside refused). I give no wording and no rule from him. If the owner wants Granville in the course, the book
  must be read first.

### 3.2 Stan Weinstein, through Deepvue (his partner) and Bulkowski (data source)
Sources: Deepvue, "Stan Weinstein Stage Analysis: Identify The Best Time To Buy And Sell Stocks", last updated
2024-07-26, https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/ ; Thomas Bulkowski's page on the
four stages (title per the fetch tool: "Bulkowski's on Four Stages of Price Movement"),
https://www.thepatternsite.com/Stages.html (read through a fetch tool: the site refuses plain requests with HTTP 406).
**Notice:** Bulkowski's site states "This website, in whole or in part, shall not be used to train artificial
intelligence (AI) systems, technologies," (the sentence continues). Read and cited here for research, with a link and
short quotes.
- **The line.** "Stan Weinstein’s original strategy relied on weekly charts paired with the 30-week moving average which
  roughly correlates with the 150-day simple moving average." (Deepvue)
- **The newer line.** "As the markets have evolved, Stan has more recently noted the importance of using the 50-day moving
  average as a key reference point for any stock." (Deepvue)
- **The reclaim inside a base.** "Once a stock shows signs of breaking out, such as large upward reversals or retaking key
  moving averages like the 50-day MA, it enters Stage 1B, which precedes Stage 2." (Deepvue)
- **Flat average, no trade.** "During this sideways chop, it is best to avoid trading the stock as there is no defined
  trend." And: "The price will whipsaw up and down around the 30-week moving average, eventually leading to a loss of
  momentum." (Deepvue) Bulkowski on Stage 1: "After declining out of stage 4, price moves sideways, sometimes rising above
  the 30-week moving average and sometimes not." (fetch tool)
- **The buy.** "This stage begins with a breakout above resistance on high volume, with the price trending above the
  rising 30-week moving average." (Deepvue) Bulkowski: "The moving average turns up." and "Weinstein says that stage 2 is
  the ideal time to buy." (fetch tool)
- **Never in Stage 4.** "During a Stage 4 Decline there is no reason to be long the stock" (Deepvue)
- **Entry and stop, as Bulkowski codes Weinstein** ("Trading Weinstein",
  https://www.thepatternsite.com/TradingWeinstein.html, fetch tool, same AI notice): a buy stop "a penny above the
  base"; skip if the initial stop is more than 20% away; stops: "Avoid round numbers like 10.00 or 20.00. Place a stop
  below (by 7 cents) the round number." The page also asks for a rising RS line against the S&P 500 and a volume spike or
  build-up on the breakout (tool's summary). Weinstein's own 2005 newsletter mostly set stops at x.99 or x.49, though
  not every stop sat under a round number (setup 10, section 3.1).
- Not stated in what I read: a fixed number of weeks below the line, a volume multiple for the reclaim day.

### 3.3 William O'Neil / Investor's Business Daily (through Yahoo Finance syndication; fetch tool)
investors.com refuses this tool's crawler (the error cites the site owner's crawler settings), so I read IBD only
where Yahoo Finance republished it. Yahoo refused plain requests (HTTP 429); the quotes are the fetch tool's copies.
- "Use The 50-Day Moving Average To Pinpoint Opportunity Or Risk", IBD, 2015-05-14,
  https://finance.yahoo.com/news/50-day-moving-average-pinpoint-212000564.html :
  "Stocks often need a large boost of buying power to muscle back above their 50-day lines after losing that level of
  support." And: "Once below that line, institutional investors may use the 50-day line to mark a sell level." The
  article's O'Reilly example notes the stock regained its 10-week line on light volume, read as a caution.
- "When A Low-Volume Rebound Follows Big Sell-Off, Take Gains", IBD, 2013-10-28,
  https://finance.yahoo.com/news/low-volume-rebound-follows-big-183900666.html : "A high-volume decline to or below the
  50-day moving average followed by a weak low-volume rise is your chance to sell."
- So IBD's line is: a reclaim needs **heavy buying**; a light-volume rise back after a heavy-volume break is a **sell**,
  not a buy. No entry rule for the reclaim itself was in what I read. O'Neil's books were not read.

### 3.4 Gil Morales and Chris Kacher: the MAU&R (long) and the failed rally back to the 50-day (short)
**The long: the Moving Average Undercut & Rally (originators' own site; added in checking).** Source: "What is the
Moving Average Undercut & Rally (MAU&R) pattern?", Virtue of Selfish Investing (MoKa Investors, LLC; the site's "About
us" page names its authors as Chris Kacher and Gil Morales), first published 2017-07-13,
https://www.virtueofselfishinvesting.com/faqs/answer/what-is-the-moving-average-undercut-rally-mau-r-pattern
- The setup: "When a leading stock breaks below its moving average, a move back above the moving average can provide a
  long entry point as the stock moves back up through the line."
- Why it works: "The stock essentially undercuts the moving average, faking out sellers and would-be short-sellers, and
  then rallies back above it."
- Stop and exit: "Once the buy signal is triggered, one then uses the moving average as a selling guide, and can adjust
  their stop to 1-2% below the line depending on risk-preference."
- The line from the U&R: "an MAU&R works on an undercut of and rally back through a moving average, while a straight U&R
  is simply an undercut of a prior low".
- Not stated on the page: which average, how long below, any volume test. It does say **"a leading stock"** (compare
  rule C31, question 7). Bracco's "MAU&R's (moving average undercut and rallies)" (section 6.3) is their term.

**The short: the failed rally back to the 50-day.**
Source: "Gil Morales and Dr. Christian Kacher - Part II", TradingMarkets (TradeHard.com series), interviewer Kevin N.
Marder, conducted 2000-01-06, posted 2000-01-08,
https://tradingmarkets.com/recent/gil_morales_and_dr_christian_kacher__part_ii-669593
- Morales, on a stock that has topped and broken its 50-day: "you’ll get kind of a wedging rally, in other words a rally
  where the volume is declining on the way up, back up to or through the 50-day moving average."
- The short: "Then when that stock goes back through the 50-day moving average on volume, that’s your shorting point."
- The timing, same answer: "Our studies show that the optimal time to be shorting is three to four months after a stock
  has topped."
- So a reclaim on **declining** volume that fails is, to them, the setup on the other side. Their long side is the
  MAU&R above.

### 3.5 Oliver Kell: the Wedge Pop (educator description; Kell's own words not read)
Source: Deepvue, "Oliver Kell: 5 Screens to Find Stocks Like a Champion", last updated 2025-03-21, no author named,
https://deepvue.com/screener/oliver-kell-screens/
- Lines: "At its core, the cycle of price revolves around the 10 and 20-day exponential moving averages."
- The reclaim: "After a Reversal Extension, a Wedge Pop occurs when the stock rallies back through its moving averages."
- The entry: "A breakout above resistance and reclaiming the moving averages signals an early entry point." The setup before
  it: "After the stock rallies off the lows, it often moves sideways forming a consolidation area."
- The mirror: "The EMA Crossback to the downside occurs when the price tries to rally into declining moving averages but
  faces strong resistance."
- Secondary, low weight: Financial Wisdom, "Oliver Kell: US Investing Champion Strategy" (page dated 2021-08-05,
  "Written by Gareth, MBA", the site's founder) says of Kell's trades: "The stop is placed under the support of the 10
  and 20 day moving averages." (https://www.financialwisdomtv.com/post/oliver-kell-us-investing-champion)
- Not read: Kell's book; TraderLion's Kell pages (HTTP 403).

### 3.6 Mark Minervini: the trend template (a filter, through Deepvue)
Source: Deepvue, "The Mark Minervini Trend Template", last updated 2023-11-20,
https://deepvue.com/screener/minervini-trend-template/
- "The stock’s price should be above its 150-day and 200-day simple moving averages (SMAs)."
- "The 200-day SMA must have been rising for at least one month."
- "The stock’s price must be within 25% of its 52-week high."
- So for a Minervini trader a fresh 200-day reclaim is often **not yet buyable**: the 200-day may not have risen for a
  month, and the stock may be more than 25% under its high. (My reading of his template, not his words. On prices, 11
  of the 16 reclaim days in section 6.8 came under a 200-day still lower than 20 sessions earlier.)

### 3.7 Kristjan Kullamägi (qullamaggie.com): the 200-day does not decide much
Source: comments under "3 TIMELESS setups that have made me TENS OF MILLIONS!",
https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ . A reader asked (2021-04-17) why he does
not disqualify stocks below the 200-day "(contrary to O’neil and Minervini)". His reply, the same day: "doesn’t matter
much". He has no reclaim setup that I found. On the same page his averages are the 10 and 20-day (a breakout's
consolidation "surfs" the rising 10- and 20-day, sometimes the 50-day; the trail is the 10 or 20-day).

### 3.8 StockCharts ChartSchool: "How To Trade Price-to-Moving Average Crossovers" (established educator)
https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/how-to-trade-price-to-moving-average-crossovers
(page says "Last updated 2 years ago"; no author named). A six-step procedure:
1. Confirm: "ensure the price has conclusively crossed above the moving average. So, if you’re using candlestick charts,
   you’ll have to wait for a full candle close above the SMA."
2. Context: "If the SMA is rising, then it’s a bullish sign; but if the SMA is falling, you should have a good reason to
   take a bullishly contrarian position."
3. Volume: "A significant increase in volume shows bullish trend strength."
4. Entry: "Some traders prefer entering immediately upon confirmation, while others might wait for a breakout above the
   crossover candle or a retest of the moving average as support."
5. Stop: "Place your stop-loss slightly below the SMA or the most recent swing low."
6. Target: a resistance level, a measured move or a trailing stop.
- Where it fails: "Crossovers work best in trending markets, bullish or bearish. In sideways markets, particularly
  volatile ones, crossover signals are more uncertain and less reliable."
- Lines: "For many traders, the 50-day SMA, in particular, serves as a critical support or resistance level."

### 3.9 ChartSchool, "Moving Averages - Simple and Exponential": reclaims inside the bigger trend
https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential
- "You would look for bullish price crosses only when prices are already above the longer moving average."
- "For example, if price is above the 200-day moving average, chartists would only focus on signals when price moves
  above the 50-day moving average."
- "A cross back above the 50-day moving average would signal an upturn in prices and a continuation of the bigger
  uptrend." The sentence before it frames the dip under the 50-day as "a pullback within a bigger uptrend", so this
  reading sits on the line between this setup and the pullbacks (setups 11, 12).
- Whipsaw filter: "Traders might require the crossover to last three days before acting". (Said of a crossover of two
  averages, the 10-day and 50-day EMAs, not of price crossing one average; borrowed here by analogy.)
- "Do not expect exact support and resistance levels from moving averages, especially longer moving averages."
- This is the clearest outside support for rule B26's shape: **a 50-day reclaim only counts above the 200-day.**

### 3.10 John Murphy (ChartSchool and StockCharts)
- "John Murphy's 10 Laws of Technical Trading", law 6, https://chartschool.stockcharts.com/table-of-contents/overview/john-murphys-10-laws-of-technical-trading :
  "Price moves above or below moving averages provide objective buy and sell signals." And: "However, moving averages
  do not tell you in advance that a trend change is imminent."
- Karl Montevirgen, StockCharts Insider article on "John Murphy’s Law #6" (Follow That Average), 2025-11-22,
  https://articles.stockcharts.com/article/stockcharts-insider-john-murphys-law-6-follow-that-average-moving-averages/ :
  "Moving averages don’t predict. They confirm." His list of readings includes a flat average sliced back and forth as a
  range, consolidation, indecision. On slope: "A falling slope says the opposite, even if price briefly pokes above it."

### 3.11 Larry Connors (through ChartSchool, RSI(2))
https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2 :
"Traders should look for buying opportunities when above the 200-day SMA and short-selling opportunities when below the
200-day SMA." Not a reclaim setup; it is the same two-sided rule as our B26.

### 3.12 The Wyckoff school (ChartSchool tutorial by Roman Bogomazov and Michael Lipsett)
https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial
- About a spring under a trading range (a horizontal level, not an average): "It is an example of a bear trap because the
  drop below support appears to signal resumption of the downtrend."
- What should follow: a sign of strength, "a price advance on increasing spread and relatively higher volume".
- Used here only for the psychology (trapped sellers, volume on the turn). Wyckoff did not use moving averages.

### 3.13 Brian Shannon (not read)
Our production `remount` detector and our `avwap_reclaim` detector both quote ideas from him. I could not read his book
or a post of his on reclaims in this pass. A WOLF Financial video description (2026-08-20) says he discusses "why a close
above the 50-day isn't automatically bullish"; that is the channel's summary, not his words. Not used.

### 3.14 UCT's own definitions (details and links in section 6)
- The owner (TSDR): the 200-day remount "and hold" is a "very reliable setup and area to risk off"; also the 50-day
  and "all MAs"; he likes "big green volume bars", then a higher low, sideways action or an inside day after it; the
  stops he names in these posts are the line itself (the 50-day on RDDT and TMDX, the 20 EMA on ZS) or a price level
  ("$198 should hold" on RDDT). The unsigned index notes add: "A remount and tightening above the 200SMA is actionable
  imo." (A candle-low stop, "the bottom of Tuesday's candle", is Beebe's, section 6.4.)
- The brain's "Remount (TSDR)" template, as quoted in this repo
  (`docs/superpowers/research/setups/setup_criteria.json`): "Primary focus is the 200SMA remount and hold." "Ideal when
  remount follows 8+ weeks of consolidation or a clean base." Confirmation: "break of previous day's high lining up with
  9/20EMA remount". Stop: below the remounted MA, "family max 8.0%" (catalog's paraphrase).
- Bracco: reclaims of the 50 and 200-day as context; MAU&R as a mean-reversion long in leaders.

### 3.15 Comparison table

| Source | Line(s) | Before the reclaim | Line slope | Volume | Trigger | Entry | Stop | Exit |
|---|---|---|---|---|---|---|---|---|
| Granville (unread) | 200-day | (unread) | (unread) | (unread) | (unread) | (unread) | (unread) | (unread) |
| Morales/Kacher MAU&R 2017 | "its moving average" (any) | "a leading stock breaks below" | (not stated) | (not stated) | "a move back above the moving average" | "as the stock moves back up through the line" | "1-2% below the line" | the average as "a selling guide" |
| Weinstein (Deepvue, Bulkowski) | 30-week; 50-day lately | Stage 1 base after a decline; chop around a flat average is no trade | must turn up | breakout "on high volume" | breakout above resistance, price over rising 30-week | buy stop over the base (Bulkowski) | under round numbers; skip if over 20% (Bulkowski) | (not in what I read) |
| IBD (fetch tool) | 50-day, 200-day | a break of the line | (not stated) | "large boost of buying power"; low-volume rise after a heavy break = sell | (not stated) | (not stated) | (not stated) | (not stated) |
| Morales/Kacher 2000 | 50-day | a top, then a heavy-volume break | (not stated) | rally back on declining volume = weak | failure back through the 50-day "on volume" | short | (not stated) | (not stated) |
| Kell (Deepvue) | 10 and 20 EMA | Reversal Extension, then a sideways coil | (not stated) | (not stated) | breakout over resistance plus the reclaim | at the pop | (secondary: under the 10/20 EMA support) | (not stated) |
| Minervini (Deepvue) | 50, 150, 200 SMA | n/a (a filter) | 200-day rising a month or more | (n/a) | (n/a) | (n/a) | (n/a) | (n/a) |
| Kullamaggie | 10, 20-day | 200-day "doesn’t matter much" | n/a | n/a | n/a | n/a | n/a | n/a |
| ChartSchool crossover | any; 50, 200 named | context matters | rising good; falling needs a reason | significant increase | full candle close above | at once, or over the crossover candle, or on a retest | slightly below the SMA or swing low | resistance, measured move or trail |
| ChartSchool MA page | 50-day inside a 200-day uptrend | price already above the 200-day | (implied by the bigger trend) | (not stated) | cross back above the 50-day | (not stated) | (not stated) | (not stated) |
| UCT owner (Substack) | 200-day first; 50-day; 20 EMA; "all MAs" | a base, ideally 8+ weeks (template); beaten-down names too | prefers it flattening and rising ("still curling lower" is a negative) | "big green volume bars" | the remount day; or a higher low, inside day, prior-day-high break after it | often near the reclaim, sometimes on the hourly | the line ("use the 50SMA as a stop"; ZS "give it to the 20EMA for a stop") or a price level ("$198 should hold") | (not stated in these posts; house rules apply) |
| Our `uct_ma_reclaim` | 50 or 200 SMA | 3 of the prior 20 closes under | none | none | close back above, at most 2 ATR over | the reclaim close | the session low | 2R and 3R |
| Our `remount` | 20 EMA, 50 SMA, old pivot | 5 to 30 consecutive closes under | none | 1.2x the 20-day average | close above | the line + 1 ATR | 1.5% under the recent low | prior high + 7.5% |

### 3.16 Where the sources disagree
1. **Which line.** 200-day (UCT owner first, Granville attributed, Connors, ChartSchool); 30-week (Weinstein's original);
   50-day (IBD, Weinstein lately, ChartSchool inside a 200-day uptrend, Bracco); 10 and 20 EMA (Kell). Our scanners: 50
   and 200 SMA (`uct_ma_reclaim`), 20 EMA and 50 SMA (`remount`).
2. **Must the stock already be above the 200-day?** Yes for a 50-day reclaim: ChartSchool, Connors, Minervini, rule B26.
   No: Kullamaggie ("doesn’t matter much"), Weinstein's 4B- (a 50-day reclaim under a falling 200-day is his trade), our
   `uct_ma_reclaim` and `remount` code.
3. **Slope of the reclaimed line.** Weinstein, Minervini and the owner want it flat to rising; ChartSchool says a falling
   line needs "a good reason"; our `uct_ma_reclaim` has no slope test at all.
4. **Volume.** Asked for or favoured by IBD (a reclaim needs "a large boost of buying power"), ChartSchool ("A
   significant increase in volume shows bullish trend strength"), the owner ("like the big green volume bars"), the
   Wyckoff sign of strength and our `remount` (1.2x, a hard gate); not stated by Morales and Kacher's MAU&R page; not
   required by `uct_ma_reclaim` (its lab grid found no need for recognition). On prices, 4 of the 16 named reclaim days
   in section 6.8 came on volume under the 50-day average, CRWD's among them ("Killer move since").
5. **How long below.** From one day (ChartSchool, any cross) to a multi-week base (owner's template "8+ weeks"; Weinstein's
   Stage 1). Our code: 3 of 20 closes (`uct_ma_reclaim`), 5 to 30 consecutive (`remount`, `draw:remount`), 5 consecutive
   (member tag check).
6. **Entry.** The reclaim close (our scanner; ChartSchool's "immediately"); over the reclaim candle's high (ChartSchool's
   second choice; the owner's "break of previous day's high"); after a higher low or inside day (owner); on a retest of
   the line (ChartSchool's third choice).
7. **Stop.** Under the reclaim day's low (our scanner; house default A3); under the line (ChartSchool; the owner's "use the
   50SMA as a stop"; the firm's code, EMA21 - 0.25 x ATR14); 1-2% under the line (Morales and Kacher's MAU&R); 1.5% under
   the recent low (`remount`).
8. **Is it a leader's setup?** Morales and Kacher's MAU&R is for "a leading stock", and rule C31 asks for RS 80 or more.
   The owner's 200-day remounts include beaten-down names ("after being beaten down", "a major laggard"), and on AMD he
   added "Still might be better to focus on ARM ALAB ASML AVGO NVDA etc." Bracco calls the short undercut version "mean
   reversion".

---

## 4. Measured evidence

**For single stocks reclaiming their 50 or 200-day as a swing setup, I found no published, checkable statistic.** What
exists is about the index, about the cross-section, or about recognition (not profit).

**4.1 Arthur Hill, CMT, "Just how Effective is the 200-day Moving Average?", StockCharts, 2019-02-23**
(https://articles.stockcharts.com/article/articles-arthurhill-2019-02-just-how-effective-is-the-200-day-moving-average/)
- Method: S&P 500 index, January 1994 to January 2019; buy when the index crosses above its 200-day SMA, sell when it
  crosses below.
- Results (exact): "There were 90 completed bullish signals during this time period." "Of these signals, there were 20
  winners with an average gain of 13.69% and 70 losers with an average loss of 1.32%."
- Whipsaw filter: using a 5-day average instead of the close, "Adding this simple smoothing technique resulted in just 34
  bullish signals over the last 25 years." And: "the average gain per signal increased and the number of losing signals
  decreased significantly" (no numbers given on that page).
- Other indexes (from his follow-up video show, where he tested "a moving average crossover system for five other major
  indexes"; no numbers on the page): "The Nasdaq 100 tested pretty good, but the Dow Industrials and Russell 2000 did
  not fare well at all."
- My arithmetic from his numbers (not his): 20 x 13.69% = 273.8 points of wins; 70 x 1.32% = 92.4 points of losses; a
  22% win rate with wins about 10 times the losses.
- Limits: an index, not stocks; no costs or dividends stated; a close-only cross with no stop; one 25-year sample. It
  teaches the shape of the payoff (many small whipsaws, a few big trends), not a win rate for our setup.

**4.2 Brock, Lakonishok and LeBaron, "Simple Technical Trading Rules and the Stochastic Properties of Stock Returns",
*Journal of Finance* 47(5), 1992, pp. 1731-1764** (abstract read on RePEc,
https://ideas.repec.org/a/bla/jfinan/v47y1992i5p1731-64.html)
- Method: moving-average and trading-range rules on the Dow Jones index, 1897 to 1986, with bootstrap tests.
- Abstract: "Buy signals consistently generate higher returns than sell signals, and further, the returns following buy
  signals are less volatile than returns following sell signals."
- Limits: index only; I read the abstract, not the tables; and see 4.3.

**4.3 Sullivan, Timmermann and White, "Data-Snooping, Technical Trading Rule Performance, and the Bootstrap",
*Journal of Finance* 54(5), 1999, pp. 1647-1691** (working paper, LSE Financial Markets Group discussion paper 303,
October 1998, read: https://www.fmg.ac.uk/sites/default/files/2020-11/dp303.pdf ; journal abstract on EconPapers)
- They re-tested the 1992 rules, adjusted for data snooping, and added 1987 to 1996.
- Result: the best rules did beat the benchmark from 1897 to 1986, but out of sample, "there is scant evidence that
  technical trading rules were of any economic value during the period" (1987 to 1996, their dates).
- Lesson for the course: a simple average cross is not a reliable edge on its own. The context (base, slope, volume,
  leadership, market) has to carry the trade.

**4.4 Avramov, Kaplanski and Subrahmanyam, "Moving average distance as a predictor of equity returns", *Review of
Financial Economics* 39(2), 2021, pp. 127-145** (abstract on RePEc,
https://ideas.repec.org/a/wly/revfec/v39y2021i2p127-145.html)
- "The distance between short‐ and long‐run moving averages of prices (MAD) predicts future equity returns in the cross
  section." Annualized value-weighted alphas from the hedge portfolios "are around 9%", and the payoffs "are stronger on
  the long side".
- Relevance: single stocks whose short average sits above their long average have done better as a group. A reclaim
  is the moment a stock starts moving into that group. Limits: a portfolio sort, not a reclaim event study; abstract
  only; the exact average lengths are not in the abstract.

**4.5 Thomas Bulkowski (thepatternsite.com; AI-use notice on the site; fetch tool)**
- The four-stages page: his own 440 buys and 444 sells, April 1987 to February 2010, sorted by Weinstein
  stage. "For example, I found that buys occurring in stage 1 made 13.2%." His table rows (tool's copy): stage 1 buys
  13.2%, 127 trades, 69.3% profitable; stage 2 buys 4.1%, 116 trades, 56.9%; stage 3 buys -5.9%, 69 trades, 14.5%;
  stage 4 buys -8.3%, 127 trades, 24.4% profitable. So in his own trades the Stage 1 buys beat the Stage 2 buys that
  Weinstein calls ideal; a reclaim of a flattening line often falls late in Stage 1 (my reading, not his). Limits: one
  trader's own trades, stages assigned after the fact.
- "Trading Weinstein": a coded Stage 2 base breakout with a close above a rising 30-week SMA (tool's summary). Table 1
  (tool's copy): 2000-01-01 to 2011-01-01, average gain 6%, median 6%, win/loss ratio 75%, maximum loss -22%, 448 trades;
  2011-01-01 to 2023-10-24, 5%, 6%, 74%, -20%, 330 trades. A breakout test, not a reclaim test, but it is the nearest
  measured relative: a buy that requires price above a rising long average.

**4.6 UCT's own lab (read from our code; the lab report is not in this repo)**
`api/services/pattern_engine/detectors/uct/uct_ma_reclaim.py`, docstring:
- Recognition against the traders' scored calls, TEST half: "recall 32.8% at a dense random ticker-day fire rate of 3.88%
  (lift 8.46; production `remount`: 23.0% at 7.28%, lift 3.15)".
- Blind check on charts that draw the 200 SMA: "15 yes / 4 no and 19 yes / 3 no: pooled precision of decided 82.9%
  (Wilson 95% CI 69-91)". "The remaining misses are chop around a FLAT average; no flatness gate is part of this rule."
- On levels: the entry (reclaim close) and stop (session low) "Neither was tested as a risk anchor in the lab: they are
  drawn levels."
`api/services/pattern_engine/tag_textbook.py`: the member "MA Reclaim" tag passed blind judging in round 2 with a pooled
mean of 2.61 (bar: a pooled mean of 2.4 or more, 70% of cases at 2 or more, and a mean of 2.3 or more in both
halves). Its round-1 faults were "only one close below / already closed above days earlier / barely above / light
volume".
`api/services/pattern_engine/setup_draw.py`: the horizontal-pivot remount drawing passed round 3 "A 2.48 / 92%   B 2.42 /
92%". It then **failed** the stricter recertification C on 2026-10-24 and was withdrawn from members
(`api/services/auto_structures.py`, `MEMBER_REMOUNT_ROUND = None`): pooled 1.96 as served and 2.14 after a fix round,
against a pass bar of 2.4. The judges' faults, as the code records them: "chop lines, marginal or light-volume reclaims,
brief losses". Those are the same three faults the member tag check (5.2) and the rules in section 8.1 are built to
screen out.
- Limits: every number here says a chart **looks like** the setup to a judge. None measures profit, stop survival or
  forward returns.

**4.7 What is missing.** A replay on real daily bars of the section 8 rules (50-day above the 200-day, and 200-day
reclaims), with the house stop and trims, split by market reading and by slope of the line. Until that exists, the
course should not state a win rate for this setup. (Setup 32's dossier reports its own replay of the `remount.py` rule,
a different line set: 20 EMA, 50 SMA and pivots. It was not re-checked in this pass.) Section 6.8 checks only whether
the owner's named examples pass the proposed rules, not how they paid.

---

## 5. Our app: what the code actually does

### 5.1 `api/services/pattern_engine/detectors/uct/uct_ma_reclaim.py` (internal, admin-only; "MA Reclaim" tag)
The rule at session i, from the code:
- History: at least 66 bars for the 50-day branch; the 200-day branch needs the 200 SMA to exist 23 sessions back
  (`MIN_BARS` 225 for the scan).
- Lines tried in order: the **50-day SMA**, then the **200-day SMA**.
- The cross is on the day itself: the prior close **at or below** the line, this close **above** it (`MR_WITHIN = 0`).
- "Below" count: at least **3** closes strictly under the line in the **20** sessions before (`MR_BELOW = 3`).
- Not extended: (close minus line) / ATR(14) at most **2.0**.
- **No volume test** (`MR_VOL = None`), **no slope test**, **no 200-day test for the 50-day branch**, no RS test.
- Levels (`U.make_levels`): entry = the reclaim **close**; stop = the reclaim session's **low** (exactly, not a few cents
  under); targets **2R and 3R**; the "pivot" is the line.
- Wrapper: liquidity floor (`primitives/liquidity.py`: price $2 or more and a 20-bar average dollar volume of $10,000 or
  more); the newest qualifying session of the last 3; dropped if a later low traded under the stop.
- Score: geometry 70, +5 for the 200-day, +5 for 10 or more closes below, +5 if the line is not lower than **one**
  day earlier. Confidence = 0.40 geometry + 0.25 volume + 0.20 context + 0.15 x 50.
- Narrative: it gives the targets as 2R and 3R "from the session low", and says: "A stock taking back a major average it
  had lost says the selling that pushed it under has been absorbed."

### 5.2 The member tag "MA Reclaim" and its textbook check
- `api/services/setup_tags.py`: "A close back above the 50-day or 200-day moving average after price had been closing
  below it."
- It is in the member tag set (`registry.SETUP_TAG_MEMBER_SET`, not withheld), shown only while
  `AUTO_STRUCTURES_SETUP_TAGS_ENABLED` is on, only with at least 260 bars of history before the session
  (`tag_textbook.MIN_INDEX`), and only if `tag_textbook.ma_reclaim_r2` also passes on that session:
  all **5** closes before the session under the line; close at least **0.5 ATR** above the line; the line not lower than
  its value **10** sessions ago minus 0.5 ATR; a **green** candle (close over open); volume at least the **50-day average**.
- This check is stricter and closer to the sources than the detector. It still has **no 200-day test** for the 50-day
  branch.

### 5.3 `api/services/pattern_engine/detectors/uct/remount.py` (production; not on the internal list)
- Lines: the **20-day EMA**, the **50-day SMA**, or a prior swing-high pivot.
- 5 to 30 **consecutive** closes under the line, then a close above it on at least **1.2x** the 20-day average volume,
  within the last 5 bars; the next bars (up to 3) must not all close back under; the high of the 60 bars before the
  break must be above the line; a candidate more than 8% over the line on most later bars is dropped as extended.
- Hostile-context gate only when Stage 4 **and** stacked bearish **and** RS down all hold. So it can fire under a
  falling 200-day.
- Levels: entry = **line + 1 ATR**; stop = **1.5% under** the lowest low of the last 5 bars of the breakdown; target =
  **prior high + 7.5%**.

### 5.4 `api/services/pattern_engine/setup_draw.py` `remount` (drawing `draw:remount`; withdrawn from members 2026-10-24)
- The line is a **horizontal swing pivot**, not a moving average: 5 to 30 consecutive closes under it, then an up-close
  back above it by 0.25 ATR or more, in the last 3 sessions, on 1.2x the 20-day volume, every close since holding it;
  the level must have held before (10 of the 15 closes before the break), not be a chop line (at most 2 close crossings
  and 3 bodies cut in the 60 bars before), and the break must have left it by 0.5 ATR or more; not more than 2 ATR above
  it now.
- Gate: the close above a **rising 200-day SMA** (above its value 20 sessions earlier), and not deal-pinned. Of the
  detectors and the drawing, this is the only one that respects B26 (the Study bank's Chart IQ event in 5.7 does too).
- **Status:** members no longer get it. `auto_structures.MEMBER_REMOUNT_ROUND = None` since 2026-10-24, after it failed
  recertification C (section 4.6); the team chart keeps it.

### 5.5 Other house artifacts
- The firm's code levels, as summarised in `docs/superpowers/research/setups/setup_criteria.json` (`remount.entry.firm`;
  `SETUP_NOTES.md` has no Remount row in its triggers table): the Remount entry is `ema_reclaim_21` and the stop
  `EMA21 - 0.25 x ATR14`. The catalog
  itself notes: "The firm's CODE uses the 21 EMA while its TEMPLATE prose says 200SMA/50SMA/20EMA."
- `api/services/pattern_engine/detectors/uct/avwap_reclaim.py`: the same idea on an anchored VWAP (not reviewed here).

### 5.6 The in-house rules side by side

| | `uct_ma_reclaim` | member tag check | `remount` | `draw:remount` |
|---|---|---|---|---|
| Line | 50 SMA, then 200 SMA | same | 20 EMA, 50 SMA, pivot | horizontal pivot |
| Time below | 3 of the prior 20 closes | 5 straight closes | 5-30 straight closes | 5-30 straight closes |
| Reclaim size | above, at most 2 ATR over | 0.5 ATR or more over | above | 0.25 ATR or more over, at most 2 ATR |
| Slope | none | not falling more than 0.5 ATR in 10 days | none | (200-day rising, gate) |
| Volume | none | 50-day average or more | 1.2x 20-day | 1.2x 20-day |
| Candle | none | green | none (upper-half close scores) | none |
| 200-day context | none | none | none | close above a rising 200-day |
| Entry / stop / target | close / day low / 2R, 3R | (a tag only) | line + 1 ATR / 1.5% under recent low / prior high + 7.5% | (a drawing only) |

### 5.7 Model Book card, playbook, journal tags, Study, vocabulary
- Model Book card (`app/src/pages/modelbook/setupCatalog.js`): **"Remount"**, family "Reversals & Reclaims", long:
  "A leader slips below its moving average, shakes out weak hands, then remounts it with authority." The glyph draws a
  4-period EMA (`ema: 4`), an illustration only.
- Model Book playbook (`setupPlaybooks.js`): **no Remount entry** ("being authored" placeholder). The Wedge Pop and EMA
  Crossback playbooks cover the 9/20 EMA reclaim. The EMA Crossback lists the mistake "Long: anticipating the reclaim
  before price actually crosses back above the averages."
- Journal tags (`app/src/constants/setupGroups.js`): **"Remount"** exists; also "Wedge Pop", "Classic U&R", "4B Setup
  (Stan Weinstein)". No "MA Reclaim" tag.
- Study: SET.28 "Remount: Shake Out Below the Line, Retake It with Authority" (`docs/study/UNITS-method.md`): "A leader
  slips below its line, flushes weak hands, then remounts with a wide-range candle on volume; loss and reclaim of the
  line, not a pullback." F4.11 "Reversals and reclaims" (`docs/study/UNITS-foundations.md`) lists Remount beside U&R,
  Wyckoff Spring, 2B Reversal, Oops Reversal, Slingshot, Green Line Breakout and Go Signal. `docs/study/TRADE_PLANS.md`
  has **no row** for this setup.
- Study bank (corrected in checking): there are no Remount setup-spotting items in `docs/study/bank/spot.setups.json`,
  but `docs/study/bank/chart.events.json` holds **100 draft Chart IQ "MA remount" items**, defined as "the first close
  back over the 9 and 20-day EMA after 4 of the last 6 closes sat under the 20, over a rising 50-day (and the 200-day)",
  and `docs/study/bank/recall.glossary.json` holds a draft "Remount" glossary item ("The line can be any of the house
  averages: the 9, 20, 50 or 200."). So members may meet a third definition (9/20 EMA, over the 200-day) beside the tag
  (50/200) and the card.
- Vocabulary (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`): "Remount" approved as "verbatim Sunday Scans usage";
  `uct_ma_reclaim` and the archive's `ma_reclaim` both map to it.

### 5.8 What looks wrong or disagrees with the sources
1. **B26 breach.** `uct_ma_reclaim` (50-day branch), the member tag check and `remount` all accept a reclaim while the
   stock is under a falling 200-day. That is a long below the 200-day, a hard-rule breach, and it is Weinstein's 4B-
   (setup 10), not this setup. Only `draw:remount` (now team-only) and the Study bank's Chart IQ "MA remount" event
   require the 200-day.
2. **The docstring's "living under it" is not what the rule tests.** The docstring says price "had been living under
   it", but 3 closes under in 20 lets a 3-day dip under a **rising** 50-day count. That is an undercut-and-rally in an
   uptrend (setups 11, 12). The member check's 5 straight closes is closer to a line that was really lost.
3. **No slope test, and the lab says so.** The lab's own main miss is "chop around a FLAT average". Weinstein (Deepvue),
   Murphy and ChartSchool all name the flat average as the no-trade zone. The geometry score's slope term compares
   the line with **one** day before.
4. **No volume test in the detector.** IBD calls a low-volume rise back after a heavy break a sell; the owner, ChartSchool,
   Wyckoff and our own `remount` want volume. The member check (50-day average) fixes this for tags only.
5. **Liquidity floor far below the house.** $2 and $10,000 a day versus B23's $10 and $20 million a day.
6. **Levels not the house's.** Stop exactly at the session low (F62: "a few cents under"); targets 2R and 3R (B19, E51:
   a third at 3R, a third at 5R, trail the rest).
7. **The confidence floor never binds.** The lowest possible confidence is 0.40 x 70 + 0.25 x 40 + 0.20 x 40 + 0.15 x 50
   = 53.5, above the 50 floor. So every rule hit is reported.
8. **`remount.py` narrative claims I could not support.** "The Remount pattern, popularized by Pradeep Bonde at
   Stockbee" (the Stockbee blog's search finds no post with "remount"); "Bonde teaches that remount breakouts frequently
   outperform original breakouts"; that Shannon calls an AVWAP reclaim "one of the highest-edge swing triggers in the
   entire trend-continuation library"; that Raschke's Turtle Soup is a reclaim "within 1-3 sessions" (not verified in
   this pass); "remount setups in liquid names ($300M+ cap) produce 1.5:1+ RR with high frequency"; "failed remounts often
   decline 10-20% further". None has a source. Its entry (line + 1 ATR, with "institutions typically wait for the
   ATR-buffer confirmation") and stop (1.5% under the low) are not in any source I read and not the house's.
9. **One family, three detectors plus a tag check and a Study event, two names.** Members see "MA Reclaim" (tag, 50 or
   200-day), "Remount" (card, journal) and, in Study drafts, "MA remount" (9 and 20-day EMAs). The drawing's "Remount"
   (a horizontal level, not an average) is team-only since 2026-10-24. A member cannot tell they are related.
10. **The brain template's stop cap ("family max 8.0%")** conflicts with A13 (about 3%), and its code (21 EMA) disagrees
    with its prose (200, 50, 20).
11. **The Study unit SET.28 promises "a wide-range candle on volume"**, which `uct_ma_reclaim` does not test.

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com), read 2026-11-09. The sitemap lists 103 post
URLs (plus the archive and about pages): 101 posts read in full, one subscriber-only post (sunday-scans-bf1,
2026-10-18) read only to its opening lines, and a "coming soon" placeholder. Dates are Substack's publish dates (UTC). Authorship is by section: "TSDR’s Weekly Outlook &
Watchlist", "TSDR WATCHLIST" and "TSDR Trading" are the owner (the About page: "Uncharted Territory is a live trading room
on Discord, run by co-founders Patrick (TSDR) and Bracco."; the 2026-10-25, 2026-11-01 and 2026-11-08 posts head the
section "Patrick (TSDR)’s Weekly Outlook & Watchlist"). The "Charts Covered" block follows the owner's section and the
posts' contents lists name no other writer for it, so I read it as his. "Index & ETF" sections and "Thoughts on the
Market" are unsigned. My count method for the short version at the top: every occurrence of the word in the post text,
and whether an average or level word (MA, SMA, EMA, moving average, 50 or 200-day, VWAP, launch pad) sits within 60
characters of it.

### 6.1 The owner (Patrick, TSDR)
**The 200-day remount is his main version**
- GOOGL: "Wish I was in this off the 200SMA hold. The remount and hold of the 200day has been a very reliable setup and area
  to risk off recently." (2025-07-13, https://unchartedterritoryy.substack.com/p/sunday-scans-6a6)
- AMD: "Remounted 200SMA, like the big green volume bars on it." In between: "Still might be better to focus on ARM ALAB
  ASML AVGO NVDA etc." Then: "But think this can sustain if pattern builds over 200 day here." (TSDR WATCHLIST, under
  "AMD (Daily)", 2025-06-20, https://unchartedterritoryy.substack.com/p/market-update-and-watchlist)
- TAN: "High Tight Flag here after reclaiming the 200SMA for the first time in a year and really the first sustainable
  remount since late 2022." And: "Take this with a grain of salt as the group has been a major laggard and horrible to
  trade." (2025-07-20, https://unchartedterritoryy.substack.com/p/sunday-scans-c82)
- VG: "Should be in on the 200SMA remount near $11.5." In his outlook the same week: "VG Tuesday on the remount of the
  200SMA I thought was another good spot." (2026-03-15, https://unchartedterritoryy.substack.com/p/sunday-scans-af4)
- BFLY: "Remounted the 200SMA on an earnings gap up on Friday with a strong close near highs." (2025-11-02,
  https://unchartedterritoryy.substack.com/p/sunday-scans-b99)
- RDDT, the slope: "The 200SMA remount was attractive out of this mini base here but it is still curling lower." Then: "I
  want this to flag and chop above this zone and a shakeout back into the 200SMA as it begins to flatten out and rise."
  And: "If we get a launchpad to form I will be increasingly more interested in it." (2026-07-12,
  https://unchartedterritoryy.substack.com/p/sunday-scans-898)
- NOW: "Incredible company remounting the 200SMA after being beaten down (unjustifiably imo)." (2026-08-16,
  https://unchartedterritoryy.substack.com/p/sunday-scans-da5)
- NOW again: "Was watching on Wednesday on the 200SMA reclaim and posted to discord but didn't trade it myself."
  (2026-08-23, https://unchartedterritoryy.substack.com/p/sunday-scans-807)
- PLTR, the check-back: "ER gapper got back above the 200SMA and gave a brief and quick little checkback into the
  200SMA." (2026-08-16, sunday-scans-da5)
- DDOG, a remount as a lesser choice: "Honestly probably okay to try as a reversal on the remount but would rather focus
  on pullbacks on stuff like RBRK." (2026-08-16, sunday-scans-da5)
- META: "I want to see it build out against the 200SMA and remount some key spots before going after it again."
  (2026-10-25, https://unchartedterritoryy.substack.com/p/sunday-scans-36e)

**The 50-day and "all MAs"**
- RDDT, with the stop: "On the daily here it notably remounted all MAs and put in two tight rest days above the 50SMA.
  $198 should hold in a worst case scenario but ideally we use the 50SMA as a stop." (2025-11-30,
  https://unchartedterritoryy.substack.com/p/sunday-scans-422)
- BE: "Got long on the remount of the 50SMA, added on the gap hold of $200." (2026-04-26,
  https://unchartedterritoryy.substack.com/p/sunday-scans-f2d) (an add; rule A5 now forbids adds.)
- QS: "Was going to double my size on 50SMA remount but didn’t." (2025-09-14,
  https://unchartedterritoryy.substack.com/p/sunday-scans-461)
- AMD: "Seeing if Th and F are higher lows looking to remount the 50SMA. $165 the pivot for that. Setting up for potential
  wedge pop." (2025-09-14, sunday-scans-461)
- U: "I think U will be added to that list if we can remount the 50SMA and break $42. For entry I will look to the hourly
  for the first higher low/flag to form." (2025-11-09, https://unchartedterritoryy.substack.com/p/sunday-scans-720)
- Under the "GLW (Daily)" heading: "Lost the 50SMA and then went double inside days and remounted. Willing to buy it back
  despite the choppy nature." (2026-06-14, https://unchartedterritoryy.substack.com/p/sunday-scans-e95)
- TMDX: "Set to gap up right around the 50SMA. I am looking for this to push through and use the 50SMA as my stop."
  (2025-08-10, https://unchartedterritoryy.substack.com/p/sunday-scans-f6f)
- GEV: "Strong close on Friday remounting all moving averages. Confirmed higher low following 8 weeks of consolidation
  now." (2025-09-21, https://unchartedterritoryy.substack.com/p/sunday-scans-88a)
- SYM: "Nice push out on Friday to remount all MAs, again looking for some flagging action up here to give us an
  actionable higher low." (2025-09-21, sunday-scans-88a)
- ZS: "Beginning of September it undercut the base on earnings and remounted all MAs." And: "Enough cushion to breathe
  easy and give it to the 20EMA for a stop." (2025-09-28, https://unchartedterritoryy.substack.com/p/sunday-scans-9a2)
- XLV: "It remounted all moving averages after a 6 month base. It is now flagging and looking for a higher low."
  (TSDR Trading, 2025-10-08, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208)
- DOCN: "the quick reclaim of the MAs and the $133 spot (2021 IPO highs) brought me back in." (2026-10-11,
  https://unchartedterritoryy.substack.com/p/sunday-scans-31b)

**How he enters after a remount**
- MU: "Every timeframe looks ideal and the remount of the moving averages in a strong way on Friday I thought was very
  notable. Any sideways action or inside day can be looked at as opportunity." (2025-08-10, sunday-scans-f6f)
- TSLA: "Finally remounting above key moving averages and trying to get out of range. I am looking for a higher low to
  get involved." (2025-08-10, sunday-scans-f6f)
- Under the "NTRA (Daily)" heading: "As soon as this triggers a break of previous day’s high, preferably lining up with a
  remount of the 9/20EMAs then we can smash it." (2026-01-04, https://unchartedterritoryy.substack.com/p/sunday-scans-153)
- Under the "JOBY (Daily)" heading: "However, buying support holds and quick remounts of MAs allow that chop under $16 to
  not matter." (2026-01-18, https://unchartedterritoryy.substack.com/p/sunday-scans-2a1)
- His list of buy spots: "Give me a clean retest or remount after and undercut." (2026-09-06,
  https://unchartedterritoryy.substack.com/p/sunday-scans-fcd)

**The 200-day as the market's line (his outlook, 2026-11-08, https://unchartedterritoryy.substack.com/p/sunday-scans-70f)**
- "Bottom line, we are below the 200SMA on the Nasdaq."
- "Some of the best traders I know often suggest 0 activity below the 200SMA."
- "the only viable long term strategy, aside from buy and hold SPY, is to close out all holdings while below the 200SMA and
  rebuy when you remount the 200SMA." He frames it as "discussions in the discord", not as his own rule.
- The short side: "I will gladly short stage 4 downtrends ap they reject the 200SMA from below. AVGO on 10/8 and GEV on
  11/3 are prime examples of this." ("ap" is his typo, read as "as".)
- "Secondly, all market corrections that ultimately turn back up work through these steps." (He then shows "Webby’s
  Trend Change Checklist", Mike Webster's list, as an image. I could not read the checklist itself; see 6.2.)

### 6.2 Index and ETF sections and market notes (writer not named)
- XHB: "200day breaks and remounts have been a very reliable setup lately." (2025-07-27,
  https://unchartedterritoryy.substack.com/p/sunday-scans-63b)
- XHB: "Will continue to monitor this and wait for a remount off the 200SMA to trade against." And: "A remount and
  tightening above the 200SMA is actionable imo." (2025-08-03, https://unchartedterritoryy.substack.com/p/sunday-scans-726)
- XBI: "Remounted the 200SMA which has been a brick wall." And: "this 200SMA remount and buildout is something to pay
  attention to." (2025-08-17, https://unchartedterritoryy.substack.com/p/sunday-scans-644)
- CRWD: "It was CRWD on the 200SMA remount trigger. Killer move since." (2026-05-17,
  https://unchartedterritoryy.substack.com/p/sunday-scans-679)
- SMH, the order of repair: "We need higher lows above the 20EMA and then to reclaim the 50SMA and then for the 50SMA to
  begin sloping upward. Until that happens or a major washout, it is an avoid imo." (2026-08-30,
  https://unchartedterritoryy.substack.com/p/sunday-scans-d40)
- SMH: "Step 2 is remounting the 50SMA and the 20EMA." (2025-11-23, https://unchartedterritoryy.substack.com/p/sunday-scans-56d)
- QQQ: "However, keep the gun in the holster until 20EMA is remounted and setups are present!" (2026-06-28,
  https://unchartedterritoryy.substack.com/p/sunday-scans-ae1)
- After a correction: "index analysis quickly diminishes while single stock analysis greatly increases as we remount and
  regain key spots." (2025-11-30, sunday-scans-422)
- Webster's checklist steps, as UCT reads them on the index: "Back above the 50SMA and four consecutive lows above the
  20EMA. Next two signals are 3 lows above the 50SMA and also the 20EMA to cross above the 50SMA." (2026-08-09,
  https://unchartedterritoryy.substack.com/p/sunday-scans-1ad)
- Kell's cycle used on the index: "We are above a flattening 9EMA but a declining 20EMA. In terms of the cycle of price
  action, we are pre wedge pop." (2026-08-02, https://unchartedterritoryy.substack.com/p/sunday-scans-cd2)
- A failed one: "First failed attempt at remounting short term levels." (BTC, 2026-03-08,
  https://unchartedterritoryy.substack.com/p/sunday-scans-dcf)
- "Thoughts on the Market" (2025-11-19, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c): "I also
  encourage a simple approach still of WAITING for stocks and the market to remount the 9/20 period moving averages."
- "Below the 200SMA is danger." (2026-11-08, sunday-scans-70f)

### 6.3 Bracco ("Bracco’s Breakdown & Top Ideas")
- TSLA: "Just retested a massive weekly level at $275 and reclaimed the 50 day moving average on Friday." (2025-06-08,
  https://unchartedterritoryy.substack.com/p/sunday-scans)
- The short version, as mean reversion: "These all staged MAU&R’s (moving average undercut and rallies) with most closing
  strong on Friday." He called them "rubber band / mean reversion longs on some short term oversold momentum leaders".
  The next sentence says they left "hammer candles off the 10 week moving averages". (2025-10-26,
  https://unchartedterritoryy.substack.com/p/sunday-scans-13e) "MAU&R" is Morales and Kacher's term (section 3.4).
- Market lows: "HOOD PLTR NFLX SPOT GEV all notable names that put in this exact reversal pattern near their 200-day
  moving averages and went on to lead the market higher." (2026-04-05, https://unchartedterritoryy.substack.com/p/sunday-scans-356)
  Read in context (corrected in checking), "this exact reversal pattern" is the 2B reversal of the sentences before it:
  the RS names "briefly undercut those previous lows and reclaimed as market came off the lows". It is an undercut of
  prior lows **near** the 200-day (setup 28), not a close back over a moving average. What it does support here: the
  leaders turned up first, near their 200-day.
- IGV: "with IGV reclaiming the 200ma would be worth watching these for some continuation in the next few weeks."
  (2026-05-31, https://unchartedterritoryy.substack.com/p/sunday-scans-6d8)
- AEHR: "Almost took AEHR on the $100 reclaim Friday but sat tight." (2026-08-09, sunday-scans-1ad)
- IWM: "Undercut the 10/1 low and shook out dip buyers. Reclaimed 200SMA on Friday." (2026-10-11, sunday-scans-31b)
  On daily prices (section 6.8) IWM did not close under its 200-day that week: Thursday 10/8 traded under it intraday
  and closed back above, so this is an intraday undercut of the 200-day, not a closing reclaim.

### 6.4 Other contributors ("The Rest of the Week" posts)
- Beebe, AMZN: "I bought this Monday after the successful defense of the 200 SMA Friday anticipating it trying to re-take
  and hold the 50 SMA." He then risked "to the bottom of Tuesday’s candle". (2025-11-26,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a)
- Manrav, NN: "Back above the launch pad and now a cross back on daily with a close above 50 and 200 SMA’s. Nice R/R with
  50 or 200 SMA stop or $13 for a wider stop." (2025-12-03, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-bad)
- Manrav, TDOC: "Massive base and now we have an undercut and reclaim of the 200 SMA + a launch pad in the making."
  (2025-10-08, the-rest-of-the-week-208)
- Tiny Trades, CIFR: "undercut 200 day and base then reclaim all MA's on strong push. Launch pad setting up below for
  entry." (2026-04-14, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-c4d)

### 6.5 The owner's rulings in the verdict log (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)
- Launchpad, WSM and ADSK, both cut: "Nah, I want it above" and "I want it above the MAs". The reviewer's note: "the trigger
  must put price ABOVE ALL the moving averages, the 8/21/50 bundle AND the 200-day." This is the closest ruling he has
  made on a reclaim.
- Kicker, SMH 2026-03-31 (kept, C-): "technically it is a gap versus intermediate downtrend instead of a kicker". The note:
  a gap up after a correction into the 200-day is "a different animal".
- Slingshot, TEAM 2022-03-28 and HAS 2023-02-02: "Cut" (notes: bounces under a falling 200-day). Slingshot, HAE
  2026-06-04: "Yes I like this one" (note: trigger still under the 200-day). That keep came before B26 was hardened on
  2026-11-09 ("200SMA is hardened rule yes").
- Gap Support universe: "Don’t want to do downtrend gaps but will do bear gaps off the highs"; the reviewer's note reads
  this as "above or reclaiming the 50 SMA".
- B26: "SHort I will only do if below the 200SMA. No longs below 200SMA (unless parabolic long) no shorts above 200SMA
  unless parabolic short."

### 6.6 The brain's "Remount (TSDR)" template (as quoted in this repo)
From `docs/superpowers/research/setups/setup_criteria.json`, which quotes the firm's brain templates: "Primary focus is
the 200SMA remount and hold."; "Ideal when remount follows 8+ weeks of consolidation or a clean base."; "Reclaim and close
above the key MA (200SMA, 50SMA, or all MAs)"; confirmation "break of previous day's high lining up with 9/20EMA remount";
stop "below the remounted MA; family max 8.0%" (the catalog's wording). These are distilled templates, not his verbatim
posts; they agree with his posts in 6.1.

### 6.7 Example candidates named in UCT posts (the writer did not verify these charts; checked on prices in 6.8)
1. GOOGL, 200-day remount and hold, mid 2025 (owner, 2025-07-13).
2. AMD, "Remounted 200SMA" with big volume bars, June 2025 (owner, 2025-06-20).
3. XHB, 200-day remount and tightening, July to August 2025 (index section, 2025-07-27 and 2025-08-03).
4. XBI, 200-day remount after "a brick wall", August 2025 (index section, 2025-08-17).
5. TAN, first 200-day reclaim in a year, July 2025 (owner, 2025-07-20; a laggard group, his caution).
6. GEV, remounted all moving averages after 8 weeks of consolidation, September 2025 (owner, 2025-09-21).
7. ZS, undercut the base on earnings and remounted all MAs, September 2025 (owner, 2025-09-28).
8. XLV, remounted all averages after a 6-month base, October 2025 (owner, 2025-10-08).
9. RDDT, remounted all MAs, two tight days above the 50-day, stop the 50-day, late November 2025 (owner, 2025-11-30).
10. AMZN, 200-day defense then the 50-day retaken, November 2025 (Beebe, 2025-11-26; a mega cap).
11. VG, 200-day remount near $11.5, March 2026 (owner, 2026-03-15).
12. CRWD, "200SMA remount trigger", spring 2026 (index section, 2026-05-17).
13. NOW, 200-day remount after a beating, August 2026 (owner, 2026-08-16 and 2026-08-23).
14. IWM, 200-day reclaim after an undercut of the 10/1 low, October 2026 (Bracco, 2026-10-11; an index ETF).
15. Short mirror: AVGO 10/8 and GEV 11/3 (2026), stage 4 names rejecting the 200-day from below (owner, 2026-11-08).

### 6.8 The named examples checked on prices (added in checking)
Daily bars from Yahoo Finance (split-adjusted, read with the `yfinance` library on 2026-11-09); simple averages of the
close; ATR = the 14-day simple average true range; volume against the 50-day average of the sessions before. For each
example I took the closing cross of the named line in the weeks before the post (the first cross after a long stay
under it, or the one the post points to), then applied every test of section 8.1 to that session. These are my
computations, not the app's bars; small differences from the app are possible. Nothing here measures how a trade paid.

| Example (post) | Reclaim day | Closes under before | Close over line | Vol vs 50-day | 200-day higher than 20 sessions back? | Day low under close | Passes all 8.1 rules? | Fails on |
|---|---|---|---|---|---|---|---|---|
| GOOGL 200-day (2025-07-13) | 2025-05-27 | 63 | 0.30 ATR | 0.93x | no | 1.7% | no | margin, volume |
| AMD 200-day (2025-06-20) | 2025-06-16 | 155 | 0.45 ATR | 2.32x | no | 6.8% | no | margin, chop (7 crossings before the break) |
| XHB 200-day (2025-08-03) | 2025-07-22 | 7 | 0.57 ATR | 1.83x | no | 3.7% | **yes** | none, yet it was back under the 200-day by 2025-08-01 ("Unable to remount the 200SMA") |
| XBI 200-day (2025-08-17) | 2025-08-13 | 165 | 1.08 ATR | 1.49x | no | 2.5% | **yes** | none |
| TAN 200-day (2025-07-20) | 2025-07-01 | 9 | 0.64 ATR | 1.13x | no | 3.6% | no | chop (3 crossings) |
| GEV 50-day, "all MAs" (2025-09-21) | 2025-09-19 | 1 | 0.33 ATR | 1.47x | yes | 4.4% | no | only 1 close under, margin, chop (4) |
| ZS 50-day (2025-09-28) | 2025-09-11 | 36 | 0.33 ATR | 1.10x | yes | 1.8% | no | margin, lower-half close, 50-day falling |
| XLV 200-day (2025-10-08) | 2025-09-11 | 127 | 0.45 ATR | 1.17x | no | 1.3% | no | margin, chop (9) |
| RDDT 50-day (2025-11-30) | 2025-11-25 | 39 | 0.65 ATR | 1.34x | flat (165.52 vs 165.27) | 10.0% | no | 50-day falling |
| AMZN 50-day (Beebe, 2025-11-26) | 2025-11-25 | 5 | 0.30 ATR | 0.77x | yes | 2.6% | no | margin, volume, chop (6) |
| VG 200-day (2026-03-15) | 2026-03-02 (gap) | 76 | 0.12 ATR | 3.98x | yes | 3.9% | no | margin, lower-half close |
| CRWD 200-day (2026-05-17) | 2026-05-04 | 7 | 0.69 ATR | 0.52x | no | 2.9% | no | volume |
| NOW 200-day (2026-08-23) | 2026-08-07 | 194 | 0.21 ATR | 0.98x | no | 3.1% | no | margin, volume |
| BFLY 200-day (2025-11-02) | 2025-10-31 (earnings gap) | 15 | 1.38 ATR | 3.97x | no | 12.6% | no | price $2.69 and about $16 million a day (B23), chop (3) |
| RDDT 200-day (2026-07-12) | 2026-07-01 | 104 | 1.05 ATR | 1.73x | no | 11.5% | **yes** | none (the owner passed: "still curling lower") |
| PLTR 200-day (2026-08-16) | 2026-08-04 (earnings gap) | 129 | 1.20 ATR | 4.30x | no | 11.9% | **yes** | none |

Not in the table: IWM (Bracco, 2026-10-11) never closed under its 200-day that week (an intraday undercut on 10/8);
DOCN (2026-10-11) crossed its 50-day after a single close under it; VG's "Tuesday" remount (2026-03-10) was an
intraday dip under the 200-day that closed above it, after the 3/2 gap had already cleared it.

What this shows, for the owner's ruling (question 14):
- **The 0.5 ATR margin** (the member tag's number) fails 8 of the 16, mostly his own picks; at 0.25 ATR (the drawing's
  number) only VG and NOW fail.
- **The volume bar** (at least the 50-day average) fails 4 of 16, CRWD's "Killer move since" among them.
- **The 200-day was still lower than 20 sessions earlier on 11 of 16.** The proposed slope test (no lower than 10
  sessions ago minus 0.5 ATR) passes every 200-day example, but the A+ cue "the 200-day above its value 20 sessions
  ago" (section 9) would exclude most of his own 200-day remounts.
- **The stop.** On 10 of 16 the reclaim day's low sat more than 3% under the close, so Entry A would break A13; this
  is why section 8.2 offers Entry B.
- **Chop.** The 60-session crossing count fails AMD, TAN, GEV, XLV, AMZN and BFLY. For the long stays under the line
  (AMD 155 closes, XLV 127) it reads chop from many months before the reclaim, which may not be what the owner means.
- Only XBI, RDDT (2026-07-01), PLTR and XHB pass everything, and XHB failed within two weeks.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | What it means here | Conflict? |
|---|---|---|
| **B26** no longs below the 200-day SMA (hard) | A 200-day reclaim is bought only once price is above the 200-day. A 50-day reclaim counts only if price is already above the 200-day. | **Yes.** Our scanners and the member tag accept a 50-day reclaim under a falling 200-day (that is setup 10's 4B-). Open question: if a 200-day reclaim slips back under the 200-day while still above the stop, does B26 force an exit? |
| A3, F62 stop a few cents under the day's or prior day's low | Natural fit: under the reclaim day's low (the day usually crossed the line, so the low is under it). | Our scanner uses the low exactly; `remount` uses 1.5% under an older low; the owner sometimes uses the line. |
| A13 stop usually within about 3% | Fine on a modest reclaim day. A wide-range reclaim day (2 ATR over the line) in a volatile name puts the low well over 3% away. | Yes, often: on 10 of the 16 named reclaim days the day's low was more than 3% under the close (section 6.8). Size down (A5), wait for a tighter pause above the line (section 8.2), or skip. The brain template's "family max 8.0%" conflicts. |
| A5 one price, one stop, no adds | Buy once. | The owner's BE trade "added on the gap hold"; QS "double my size on 50SMA remount". The course teaches one entry. |
| B19, E51, E52, F63 trims and trail | A third at 3R, a third at 5R, trail the rest under the 10-day (fast) or 21-day (steadier) on a close; breakeven at 2R to 5R. | The scanner's 2R/3R targets and `remount`'s prior high + 7.5% are not house. A fresh 200-day reclaim is usually a steadier, earlier-stage name: 21-day trail. |
| B20 gap through the stop | Applies as written. | None. |
| B22 no new buy within 3 days before earnings | Applies. Many remounts happen **on** an earnings gap (BFLY, ZS); after the report is fine. | None. |
| B23, D42 liquidity | $10 or more, $20 million a day, at most 1% of average daily volume. | Our floor is $2 and $10,000 a day. The owner's BFLY remount (2025-11-02) closed at $2.69 on about $16 million a day (section 6.8): not a house trade. |
| C28 no chasing past 4% | The buy point is the reclaimed line (the detector's "pivot"), or the trigger high in the pause entry. | A reclaim close 2 ATR over the line can already be more than 4% over it. Owner to name the buy point (question 9). |
| C29 not more than 10% over the 10-day | Rarely an issue on a reclaim. | None. |
| **C31** RS 80+ in a leading group, except parabolic and mean reversion | Fits a 50-day reclaim in a leader. | **Yes for many 200-day remounts:** NOW "after being beaten down", TAN "a major laggard", RDDT "one of the first leaders and growth stocks to decline". Owner to rule (question 7). |
| C33 time stop (under 1R after 10 days) | Very useful: reclaims that chop are the main failure. | None. |
| D47 shorts mirror longs | The 200-day rejection from below (section 8.6). | Needs B26 (below the 200-day) and D48 (borrow). |
| E57 market orders | Market order on the reclaim day once it holds, or when the pause high trades. | Our scanner enters at the close; fine as a market-on-close proxy. |
| F65, B18 market reading | Green full; Yellow smaller; Orange A+ only; Red cash and shorts. | The owner's 2026-11-08 note ("0 activity below the 200SMA" for the index) fits Red/Orange. |

---

## 8. Proposed rules for our course

Every line is measurable on daily bars unless it says hourly. ATR = the 14-day average true range. "The line" = the
moving average being reclaimed.

### 8.1 What it is
- **Name.** Remount (the owner's word), described as a moving-average reclaim. Retire MA Reclaim as a separate member
  tag name, or show the tag as **Remount (MA reclaim)**. [UCT; my proposal]
- **The lines.** The **200-day SMA** (the core, as the owner and his template say) and the **50-day SMA** (only above the
  200-day). The 20 EMA and 9/20 EMAs are taught under pullbacks and Wedge Pop, except as part of a "remounted all MAs"
  day. [UCT: "Primary focus is the 200SMA remount and hold." (the brain template) and "The remount and hold of the
  200day has been a very reliable setup" (the owner, GOOGL); source consensus for buying only above the 200-day:
  ChartSchool, Connors, Minervini; the 50-day-inside-a-200-day-uptrend reading itself is ChartSchool's]
- **Lost the line first.** At least **5 consecutive closes** below the line right before the reclaim day. [UCT code: the
  member check, `remount` and `draw:remount` all use 5] Fewer than 5 is an undercut-and-rally of setups 11 and 12, not
  this setup. [my proposal; Morales and Kacher's MAU&R sets no minimum; the owner's GEV "all MAs" example had 1 close
  under its 50-day (section 6.8)]
- **It left the line.** At least one of those closes **0.5 ATR or more** below the line. [UCT code: `draw:remount`
  RM_DEPTH_ATR]
- **Not a chop line.** In the 60 sessions before the break below, the close switched sides of the line no more than
  **2** times. [UCT code: `draw:remount` RM_MAX_CROSS, written for a horizontal level; adapting it to a moving line is
  my proposal]
- **Slope.** The line today is no lower than its value 10 sessions ago minus 0.5 ATR (flat or rising). [UCT code: the
  member check that passed blind judging; source consensus: Weinstein (Deepvue), ChartSchool, Minervini, Murphy's Law 6
  article ("A falling slope says the opposite"), the owner's "still curling lower" and "as it begins to flatten out and
  rise"] For A grades, the 200-day is above its value 20 sessions ago. [UCT code: `draw:remount` gate; but 11 of the 16
  named reclaim days fail it (section 6.8), question 14]
- **Base.** Ideally the stock has built a sideways base of **8 weeks or more** before the reclaim. [UCT: template "8+
  weeks"; owner GEV "8 weeks of consolidation"]
- **Location.** 200-day reclaim: the reclaim close is above the 200-day (true by definition). 50-day reclaim: the close
  is above the 200-day too. [house rule B26; ChartSchool] Best when the reclaim puts price above **all** the averages
  (20, 50, 200). [UCT: Launchpad ruling "I want it above the MAs"; owner's "remounted all MAs"]
- **The reclaim day.** A green candle (close over open), closing at least **0.5 ATR** above the line, in the upper half of
  its range, and no more than **2 ATR** above the line. [UCT code: member check (0.5 ATR, green); lab (2 ATR); `remount`
  scoring (upper half); the recertification judges' "marginal ... reclaims" fault (4.6). Caution: 8 of the 16 named
  reclaim days close less than 0.5 ATR over the line; at the drawing's 0.25 ATR only 2 fail (section 6.8), question 14]
- **Volume.** Reclaim-day volume at least the **50-day average** volume. [UCT code: member check; source consensus: IBD,
  ChartSchool, owner "big green volume bars"; caution: 4 of the 16 named reclaim days, CRWD's among them, came on less
  (section 6.8)] The reason, not an extra test (this line already excludes it): IBD calls "A high-volume decline to or
  below the 50-day moving average followed by a weak low-volume rise" a "chance to sell", and Morales reads a rally back
  on declining volume as the short. [IBD 2013; originator: Morales 2000]
- **Liquidity.** Price $10 or more; $20 million or more traded a day; position at most 1% of average daily volume.
  [house rule B23, D42]
- **Leadership.** RS 80 or more for a 50-day reclaim. For a 200-day remount, see question 7. [house rule C31;
  originator: Morales and Kacher's MAU&R is for "a leading stock"]

### 8.2 The buy
Two entries, one chosen per trade, never both (A5).
- **Entry A, the remount day.** Buy with a market order in the last 30 minutes of the reclaim session while price is
  above the line, or at the close. [UCT: "Should be in on the 200SMA remount", "the 200SMA remount trigger"; house rule
  E57; our scanner enters at the close; originator: MAU&R "as the stock moves back up through the line"; the 30 minutes
  is my proposal]
- **Entry B, the hold.** After the reclaim, wait 1 to 5 sessions that all close above the line, the last of them an
  inside day or a day whose range is under 1 ATR; then buy when price trades over that day's high. [UCT: "Any sideways
  action or inside day can be looked at as opportunity", "A remount and tightening above the 200SMA is actionable imo",
  "break of previous day's high"; ChartSchool "a breakout above the crossover candle or a retest"; the 1 ATR number is my
  proposal]
- **Which one.** Use Entry A when its stop (8.3) is about 3% or less from the entry; otherwise use Entry B, whose pause
  gives a tighter stop. This keeps A13 without moving any stop. [my proposal; on 10 of the 16 named reclaim days Entry A's
  stop would have been more than 3% away (section 6.8)]
- **No chasing.** Skip if the fill is more than 4% above the buy point (the line for Entry A; the prior day's high for
  Entry B). [house rule C28; buy point is my proposal, question 9]
- **Earnings.** No new buy in the 3 days before a report. A remount on the earnings gap itself is allowed. [house rule
  B22; UCT: BFLY, ZS]
- **Hourly option (advanced).** The owner often times the entry on the hourly ("look to the hourly for the first higher
  low/flag"). Teach it as a variant, not the default, because daily drills cannot show it. [UCT]

### 8.3 The stop
- **Entry A:** a few cents under the reclaim day's low. **Entry B:** a few cents under the lowest low of the pause.
  [house rule A3, F62; ChartSchool "slightly below the SMA or the most recent swing low"]
- If that stop is more than about 3% away, size down so the account risk is unchanged (A5), or wait for Entry B, or
  skip. Never tighten the stop to fit. [house rule A3, A5, A13]
- Named variant, not the default: the line itself on a closing basis (the owner's "ideally we use the 50SMA as a stop";
  Manrav's "50 or 200 SMA stop"), or 1-2% under the line (Morales and Kacher's MAU&R). See question 6. [UCT;
  originator]
- A gap through the stop: the first 30-minute low is the new stop; out past 2R. [house rule B20]

### 8.4 Trims and trail
- House defaults: a third at 3R, a third at 5R, the rest trailed under the 21-day for a fresh 200-day remount (an
  earlier-stage, steadier name) or the 10-day for a fast mover, sold on a close below it; stop to breakeven between 2R
  and 5R; a gap up through a trim level is trimmed at the open. [house rule B19, E51, E52, F63]
- Time stop: under 1R after 10 trading days, sell. Chop is this setup's main failure. [house rule C33; UCT lab's miss]

### 8.5 What invalidates it
- Before entry: the session after the reclaim closes back under the line ("rm_lost_level" in our drawing code); the line
  is falling (8.1 slope test fails); the reclaim day is light volume after a heavy-volume break; earnings within 3 days;
  the market reading is Red. [UCT code; IBD; house rules]
- Before entry: price is still under a falling 200-day (it is the 4B-, setup 10). [house rule B26]
- After entry: the stop. [house rule A4] Whether a close back under the line before the stop is also an exit is the
  owner's call (question 6).

### 8.6 The short mirror: the 200-day rejection
Shorts are our long setups reversed (D47), and only below the 200-day (B26). The mirror is a stock **in a Stage 4
decline under a falling 200-day** that rallies back up to the line and fails there.
- **Structure.** At least 5 closes under a falling 200-day SMA; RS 20 or less in a weak group (C31 mirror); a rally of 3
  or more sessions into the 200-day (or the 50-day, when it sits under a falling 200-day) on declining volume, read as
  the rally days' average volume under the 50-day average. [originator: Morales "a rally where the volume is declining
  on the way up, back up to or through the 50-day moving average"; Kell via Deepvue "rally into declining moving
  averages"; house rule C31; the 5 closes, 3 sessions and the volume reading are my proposal]
- **Trigger.** A rejection day that closes back under the line in the lower half of its range, on volume at least the
  50-day average; short when price trades under that day's low, market order. [UCT: "I will gladly short stage 4
  downtrends ap they reject the 200SMA from below"; originator: Morales "goes back through the 50-day moving average on
  volume" (the 50-day-average threshold is my proposal); house rule E57]
- **Timing.** Morales: "the optimal time to be shorting is three to four months after a stock has topped." [originator]
- **Stop.** A few cents over the rejection day's high; about 3% or less. [house rule A3, F62, A13 mirrored]
- **Skip** if hard to borrow or the fee is high. [house rule D48]
- Examples to check: AVGO 2026-10-08 and GEV 2026-11-03 (owner, 2026-11-08). [UCT]

### 8.7 Best market conditions
- Market reading Green, or Yellow at smaller size; Orange only an A+ remount. [house rule F65]
- Best of all: early in a new uptrend after a correction, when the index itself is remounting its 20 and 50-day
  (Webster's checklist steps as UCT reads them) and leaders turn up first. [UCT: "index analysis quickly diminishes while
  single stock analysis greatly increases as we remount and regain key spots"; Bracco on RS names whose 2B reversals
  near their 200-day led the market at the 2026 lows (section 6.3)]
- Worst: the index under its own 200-day. [UCT: "Below the 200SMA is danger."; the owner's "0 activity" note]
- Remember the index test (section 4.1): even on the S&P 500, most 200-day crosses were small losers. Expect whipsaw;
  size and stops carry the trade.

### 8.8 Common mistakes
1. Buying a 50-day reclaim under a falling 200-day (it is the 4B-; B26 forbids it).
2. Buying a reclaim of a flat line that price has crossed back and forth for weeks (the lab's main miss; "whipsaw").
3. Buying before the close is above the line ("anticipating the reclaim", the Model Book's EMA Crossback mistake).
4. Buying a low-volume drift back over the line after a heavy-volume break (IBD: a sell).
5. Calling a 1 to 4 day dip under a rising line a "remount" (it is a pullback, setups 11 and 12).
6. Buying the reclaim of a line that is still "curling lower" (the owner's RDDT note).
7. Chasing a reclaim day that closed 2 ATR or more above the line, or buying more than 4% over the buy point.
8. Setting the stop under the line minus a cushion, far wider than 3%, at full size.
9. Adding on the next reclaim (A5).
10. Buying the 3 days before earnings (B22).
11. Ignoring the market: remounts while the index is under its own 200-day.
12. Treating a laggard group's remount like a leader's (the owner on TAN: "a major laggard and horrible to trade").

---

## 9. Grading (observable cues, not a checklist; rule E50 says grading is his judgment)

**A+**
- A **200-day** remount (or a 50-day reclaim above a rising 200-day) after a sideways base of **8 weeks or more**. [UCT
  template; owner GEV]
- The line flat or rising; the 200-day above its value 20 sessions ago. [source consensus; UCT code; caution: 11 of the
  16 named reclaim days fail the 20-session test (section 6.8), question 14]
- The reclaim clears **all** the averages in one push ("remounted all MAs"). [UCT]
- A wide green reclaim candle closing in the top third, on **1.5x** or more the 50-day volume. [UCT "big green volume
  bars"; the top third and 1.5x are my proposal; our `remount` scores 1.5x its 20-day average as strong]
- Confluence: the line sits on a horizontal level (a prior high, an IPO high, a gap). [UCT: DOCN "the MAs and the $133
  spot"]
- Then a tight pause above the line (an inside day, a higher low) that gives a stop of 3% or less. [UCT; house A13]
- Leadership: the stock or its group remounts **before** the index; RS rising. [UCT: Bracco on leaders turning up near
  their 200-day at the 2026 lows (a 2B, section 6.3); the owner as the brain quotes him in the Study bank's draft "MA
  remount" items: "spotting a market bottom forming: relative basing/sideways action and early remounts ahead of the
  broader market."]
- Market Green, index above or remounting its own 50-day. [house F65; UCT]

**B- or lower**
- The line still falling ("still curling lower"); the 200-day under its value 20 sessions ago. [UCT; source consensus;
  caution: by this cue most of the owner's own named 200-day remounts, XBI and PLTR included, would grade B- or lower
  (section 6.8), question 14]
- The close switched sides of the line 3 or more times in the prior 60 sessions (a chop line). [UCT code; UCT lab's
  miss; Deepvue on Weinstein's whipsaw]
- A small reclaim (under 0.5 ATR over the line), a red or upper-wick candle, or below-average volume. [UCT code: the
  member check's round-1 faults "barely above / light volume"; IBD]
- A reclaim that leaves the 50-day (or other averages) still overhead and falling. [UCT: SMH "then for the 50SMA to begin
  sloping upward"; Launchpad ruling]
- A stop wider than 3% that forces a much smaller size. [house rule A13]
- A laggard group; RS under 70; Yellow or Orange market; earnings within about 2 weeks. [UCT on TAN; house C31, F65; RS
  70 and 2 weeks are my proposal]
- A first attempt after a long decline with no base ("First failed attempt at remounting short term levels"). [UCT]

---

## 10. Questions for the owner

1. **The name.** One name for the tag, card, journal and course: (A) Remount; (B) MA Reclaim; (C) Remount (MA
   reclaim). Recommend C: your word, with a plain description. Also: setup 32 in the review list is called "Remount"
   too. (A) one setup, "Remount", with the 50/200-day version here and the level/pivot version of setup 32 as its two
   forms; (B) two setups, this one renamed "MA Reclaim" (or "200-day Remount"). Recommend A, since you use one word
   for both.
2. **Which lines.** (A) the 200-day and the 50-day (above the 200-day) only; (B) add the 20 EMA and "all MAs"; (C) add the
   weekly 30-week and 10-week lines. Recommend A, with "all MAs" as an A+ cue, and the 20 EMA left to pullbacks.
3. **How long below.** (A) 3 of the prior 20 closes (today's scanner); (B) 5 straight closes (the member tag, `remount`,
   `draw:remount`); (C) a base of 8 weeks or more (your template). Recommend B as the rule and C as an A+ cue.
4. **The 50-day under the 200-day.** Confirm it is not this setup and not a long at all under B26 (it is setup 10's 4B-).
5. **B26 after entry.** If a 200-day remount slips back under the 200-day but stays above the stop: (A) the stop decides,
   hold; (B) B26 forces an exit at the close. Recommend A, because A4 makes the stop the exit, but it is your rule.
6. **The stop.** (A) a few cents under the reclaim day's low or the pause low (house default); (B) a close under the line
   (your RDDT and TMDX notes); (C) the line minus a cushion (scanners, the firm's code, and Morales and Kacher's "1-2%
   below the line"). And is a close back under the line before the stop an extra exit? Recommend A with no extra exit;
   the time stop (C33) handles the chop.
7. **RS 80 on a 200-day remount.** Many of your 200-day remounts were beaten-down names (NOW, TAN, RDDT). (A) apply C31
   strictly; (B) treat a 200-day remount as an exception like mean reversion; (C) a lower bar (RS 60 or 70, or a rising RS
   line). Recommend C, with RS 80 for the 50-day version.
8. **Entry.** (A) the remount day only; (B) the hold (pause then prior-day-high break) only; (C) both, picked by the 3%
   stop test. Recommend C.
9. **C28's buy point.** For this setup: (A) the reclaimed line; (B) the trigger (the reclaim close or the pause high).
   Recommend A for Entry A and the pause high for Entry B.
10. **Volume.** (A) at least the 50-day average (the member tag's bar); (B) 1.2x the 20-day (`remount`); (C) none (the lab).
    Recommend A, with 1.5x as an A+ cue.
11. **The short mirror.** Teach the 200-day rejection (your AVGO and GEV examples) as this setup's short? Recommend yes.
12. **The index rule.** Your 2026-11-08 note ("close out all holdings while below the 200SMA and rebuy when you remount the
    200SMA") reports a discord discussion. Is it a house rule for the course, a guide, or only background?
13. **The scanners.** (A) fix `uct_ma_reclaim` to these rules (B26 gate, 5 closes, slope, volume, house liquidity, a few
    cents under the low, house trims) and rewrite the `remount` narrative's unsourced claims; (B) retire `remount` and keep
    one rule; (C) leave them and teach from hand-picked examples. The narratives need rewriting in every option.
14. **The numbers, against your own examples (section 6.8).** Of the 16 reclaim days behind your named remounts, only 4
    pass every proposed rule. (a) Margin over the line: (A) 0.5 ATR (the member tag; fails 8 of 16); (B) 0.25 ATR (the
    drawing; fails 2); (C) any close above, plus the upper-half close. Recommend B. (b) The 200-day's slope: (A) must be
    higher than 20 sessions ago for an A (fails 11 of 16); (B) only "not falling fast" (the line no lower than 10
    sessions ago minus 0.5 ATR: every 200-day example passes; ZS's and RDDT's falling 50-day fail) with flattening as a
    plus. Recommend B, since most of your 200-day remounts came
    while it was still turning. (c) Volume: keep the 50-day average as the rule (fails 4, CRWD among them) or make it a
    grading cue? Recommend a cue, if CRWD-type light-volume remounts are trades you take. (d) Chop: should the
    crossing count look at the 60 sessions before the break (as proposed) or the 60 before the reclaim?

---

## 11. Sources (all read on 2026-11-09 unless marked)

| # | Source | Publisher / author | URL or path | Reliability note |
|---|---|---|---|---|
| 1 | "How To Trade Price-to-Moving Average Crossovers" | StockCharts ChartSchool (no author named; "Last updated 2 years ago") | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/how-to-trade-price-to-moving-average-crossovers | High: established educator; the most complete outside procedure. |
| 2 | "Moving Averages - Simple and Exponential" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential | High: established educator. |
| 3 | "John Murphy's 10 Laws of Technical Trading" | StockCharts ChartSchool; John Murphy | https://chartschool.stockcharts.com/table-of-contents/overview/john-murphys-10-laws-of-technical-trading | High: a known author's rules. |
| 4 | StockCharts Insider article on "John Murphy’s Law #6" (Follow That Average), 2025-11-22 | StockCharts; Karl Montevirgen | https://articles.stockcharts.com/article/stockcharts-insider-john-murphys-law-6-follow-that-average-moving-averages/ | Medium: educator's commentary on Murphy. |
| 5 | "Just how Effective is the 200-day Moving Average?", 2019-02-23 | StockCharts; Arthur Hill, CMT | https://articles.stockcharts.com/article/articles-arthurhill-2019-02-just-how-effective-is-the-200-day-moving-average/ | Medium-high: a stated test, index only, no costs. |
| 6 | "Arthur Hill on Moving Average Crossovers" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/overview/arthur-hill-on-moving-average-crossovers | High: background on whipsaws; not quoted. |
| 7 | "RSI(2)" (Connors' 200-day filter) | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2 | High: educator describing Connors. |
| 8 | "The Wyckoff Method: A Tutorial" | StockCharts ChartSchool; Roman Bogomazov and Michael Lipsett | https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial | High for Wyckoff; used for psychology only. |
| 9 | "Stan Weinstein Stage Analysis: Identify The Best Time To Buy And Sell Stocks", last updated 2024-07-26 | Deepvue (Weinstein's partner) | https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/ | Medium: vendor education, built with Weinstein; not his own words. |
| 10 | Page on Weinstein's four stages (title per the fetch tool: "Bulkowski's on Four Stages of Price Movement") | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/Stages.html | Medium-high for his data; one trader's trades. Read through a fetch tool (plain requests refused, 406). **The site states it "shall not be used to train artificial intelligence (AI) systems"**; cited for research with short quotes. |
| 11 | "Trading Weinstein" (test data through 2023-10-24) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/TradingWeinstein.html | Medium-high; fetch tool's summary and table copy. Same AI notice. |
| 12 | "Oliver Kell: 5 Screens to Find Stocks Like a Champion", last updated 2025-03-21 | Deepvue (no author named) | https://deepvue.com/screener/oliver-kell-screens/ | Medium: vendor education about Kell, not his words. |
| 13 | "The Mark Minervini Trend Template", last updated 2023-11-20 | Deepvue | https://deepvue.com/screener/minervini-trend-template/ | Medium: vendor summary of his book. |
| 14 | "3 TIMELESS setups that have made me TENS OF MILLIONS!" (comments, reply dated 2021-04-17) | qullamaggie.com; Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | High: originator's own reply; brief. |
| 15 | "Gil Morales and Dr. Christian Kacher - Part II", conducted 2000-01-06 | TradingMarkets (TradeHard.com series); Kevin N. Marder | https://tradingmarkets.com/recent/gil_morales_and_dr_christian_kacher__part_ii-669593 | High: originators' own words, an interview transcript. |
| 16 | "Use The 50-Day Moving Average To Pinpoint Opportunity Or Risk", 2015-05-14 | Investor's Business Daily, via Yahoo Finance | https://finance.yahoo.com/news/50-day-moving-average-pinpoint-212000564.html | Medium: IBD's own article, but read through a fetch tool (Yahoo returned 429 to plain requests); quotes are the tool's copy. investors.com itself refuses this tool's crawler. |
| 17 | "When A Low-Volume Rebound Follows Big Sell-Off, Take Gains", 2013-10-28 | Investor's Business Daily, via Yahoo Finance | https://finance.yahoo.com/news/low-volume-rebound-follows-big-183900666.html | Same as 16. |
| 18 | "Oliver Kell: US Investing Champion Strategy" (page dated 2021-08-05) | Financial Wisdom; "Written by Gareth, MBA" | https://www.financialwisdomtv.com/post/oliver-kell-us-investing-champion | Low: secondary educator; one stop sentence only. |
| 19 | Brock, Lakonishok, LeBaron (1992), *Journal of Finance* 47(5):1731-1764, abstract | RePEc / IDEAS | https://ideas.repec.org/a/bla/jfinan/v47y1992i5p1731-64.html | High (peer reviewed); abstract only. |
| 20 | Sullivan, Timmermann, White, LSE FMG discussion paper 303 (Oct 1998); *Journal of Finance* 54(5), 1999 | LSE Financial Markets Group; EconPapers | https://www.fmg.ac.uk/sites/default/files/2020-11/dp303.pdf ; https://econpapers.repec.org/RePEc:bla:jfinan:v:54:y:1999:i:5:p:1647-1691 | High (peer reviewed); intro and abstract read. |
| 21 | Avramov, Kaplanski, Subrahmanyam (2021), *Review of Financial Economics* 39(2):127-145, abstract | RePEc / IDEAS | https://ideas.repec.org/a/wly/revfec/v39y2021i2p127-145.html | High (peer reviewed); abstract only. |
| 22 | Stockbee blog search for "remount" and "reclaim" | Stockbee (Pradeep Bonde) | https://stockbee.blogspot.com/search?q=remount | Used only to check our code's attribution: "No posts matching the query". Blogger search can miss posts; a strong hint, not proof. |
| 23 | Internet Archive records for Granville's books | Internet Archive | archive.org items granvillesnewkey0000jose, granvillesnewstr0000gran | Lending-only; **not read**. No Granville wording used. |
| 24 | "Use This Trend Change Checklist To Add Exposure After A Market Correction: Mike Webster" (video description, 2025-05-15) | Investor's Business Daily (YouTube) | https://www.youtube.com/watch?v=A-4dyGN7jVQ | Description only; the checklist itself **not read**. |
| 25 | "Anchored VWAP and Moving Averages: Full Breakout Strategy" (video description, 2026-08-20) | WOLF Financial; guest Brian Shannon | https://wolf.videonest.co/videos/2086744/anchored-vwap-and-moving-averages-full-breakout-st-BLF7bPpLuW | The channel's summary, not Shannon's words. Not used for rules. |
| 26 | UCT Substack, all 103 post URLs in the sitemap (2025-06-01 to 2026-11-08) and the About page | Uncharted Territory: Patrick (TSDR), Bracco, contributors | https://unchartedterritoryy.substack.com/sitemap.xml ; https://unchartedterritoryy.substack.com/about | House source; quotes exact (all re-matched in checking); writer named by section. 101 posts read in full; sunday-scans-bf1 (2026-10-18) subscriber-only. |
| 27 | Owner verdict log | UCT (owner) | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | House; the highest authority on how we trade it. |
| 28 | Account rulebook | UCT (owner) | `docs/study/sizing_rule.md` section 9 | House rules, settled 2026-11-09. |
| 29 | Detector and tag code | UCT app | `api/services/pattern_engine/detectors/uct/uct_ma_reclaim.py`, `remount.py`, `avwap_reclaim.py`, `uct_setups_common.py`; `api/services/pattern_engine/tag_textbook.py`, `setup_draw.py`, `detectors/registry.py`, `primitives/liquidity.py`; `api/services/setup_tags.py`; `api/services/auto_structures.py` (the drawing's member status); `tests/pattern_engine/detectors/test_uct_team_setups2_parity.py` | Read in full for the rules in section 5; lab numbers are the code's own docstrings (the lab report is not in this repo). |
| 30 | Model Book, journal tags, Study units, Study bank, vocabulary, setup catalog | UCT app and docs | `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`; `app/src/constants/setupGroups.js`; `docs/study/UNITS-method.md`, `UNITS-foundations.md`, `TRADE_PLANS.md`; `docs/study/bank/chart.events.json`, `recall.glossary.json`, `spot.setups.json`; `docs/wisdom/vocabulary/setup-vocabulary-v1.json`; `docs/superpowers/research/setups/setup_criteria.json`, `SETUP_NOTES.md` | House. The brain template lines are quoted only as this repo already quotes them. |
| 31 | Sibling dossiers | this folder | `10-weinstein-4b.md`, `11-ema20-pullback.md`, `12-ma-pullbacks.md`, `07-launchpad.md`, `28-2b-reversal.md`, `29-undercut-rally.md`, `32-remount.md` | Used for consistency and boundaries between setups. |
| 32 | "What is the Moving Average Undercut & Rally (MAU&R) pattern?", first published 2017-07-13 (added in checking) | Virtue of Selfish Investing (MoKa Investors, LLC); Gil Morales and Chris Kacher | https://www.virtueofselfishinvesting.com/faqs/answer/what-is-the-moving-average-undercut-rally-mau-r-pattern ; authors per https://www.virtueofselfishinvesting.com/about-us | High: the originators' own site. The closest outside definition of this setup. |
| 33 | Daily prices for the examples in section 6.8 (added in checking) | Yahoo Finance, read with the `yfinance` library | split-adjusted daily bars, 2023 to 2026-11-07 | Medium: a free data feed, my own computation; not the app's bars. Used only to check the named examples against the proposed rules. |

**Searched for and not found or not readable:** Granville's own rules (books lending-only); Weinstein's book; O'Neil's
books and investors.com (crawler refused); Kell's book and TraderLion's Kell and Weinstein pages (HTTP 403); Mike
Webster's checklist text; Brian Shannon's own wording on reclaims; Mebane Faber's 10-month average paper (SSRN refused,
HTTP 403); Raschke's Turtle Soup rules (not in her 1997 AIQ interview; no further search was possible after this
session's web-search budget ran out). Nothing from these is quoted or used as a rule. In checking, two more searches
also came up empty: a reliable page with Webster's trend change checklist (only forum notes and community scripts,
not usable), and a post of Shannon's own on reclaiming the 200-day (none found).

---

## Removed or corrected in checking (2026-11-09)

**Removed**
1. **Granville's first rule "a buy when price crosses above a flattening or rising 200-day"** (section 2 table and the
   3.15 comparison row). It came only from unnamed secondary pages; the broker pages found in checking do not agree on
   the wording and none is a usable source. The attribution stays, marked unverified, with no rule content.
2. **"Trims into strength, trails"** as the owner's exit (3.15, UCT owner row). No post quoted here says it. Now "not
   stated in these posts; house rules apply".
3. **The "LOD" style stop** credited to the owner (3.15) and **"the low of a candle"** as his stop variant (3.14). The
   remount posts quoted here give the line or a price level; the candle-low stop is Beebe's.
4. **"Rarely"** in the Minervini reading (3.6): an unmeasured claim, replaced by a softer reading and the measured count
   from section 6.8.

**Corrected**
5. **`draw:remount` is not a member drawing.** It was withdrawn from members on 2026-10-24 after failing recertification
   C (pooled 1.96, fix round 2.14, bar 2.4); `auto_structures.MEMBER_REMOUNT_ROUND = None`. Fixed in the short version,
   4.6, 5.4 and 5.8.
6. **"The Study bank has no Remount items yet."** It holds 100 draft Chart IQ "MA remount" items (9 and 20-day EMAs, over
   a rising 50-day and the 200-day) and a draft "Remount" glossary item. Fixed in 5.7 and 5.8.
7. **MAU&R credited to Bracco.** It is Gil Morales and Chris Kacher's term, defined on their own site (2017-07-13); the
   writer had said their long side was available only second-hand. The originators' definition is now quoted (3.4) and
   used in sections 1, 2, 3.15, 3.16, 8.1 to 8.3. Bracco's MAU&R lines were also overstated: his post names the 10-week
   (and the 50-day among other supports), not a "rising 10-week, 20 EMA".
8. **Bracco's 2026-04-05 note** was read as a reclaim at market lows. In context "this exact reversal pattern" is a 2B
   reversal of prior lows near the 200-day. Fixed in 2 (related setups), 6.3, 8.7 and 9.
9. **IWM 2026-10-11** is not a closing reclaim on daily prices (an intraday undercut of the 200-day); noted in 6.3 and
   6.8.
10. **The firm's code levels** were said to be summarised in `SETUP_NOTES.md`; only `setup_criteria.json` has the
    Remount line. The stop is "EMA21 - 0.25 x ATR14", not the label `ema_21_buffer` (5.5, 3.16).
11. **Weinstein's newsletter "sets stops just under round numbers"**: setup 10's own cold check found that over-general
    (mostly x.99 or x.49, not always). Reworded in 3.2; Bulkowski's "by 7 cents" rule added.
12. **ChartSchool's "three days" whipsaw filter** is said of a crossover of two averages, not of price and one average;
    now marked as borrowed (3.9). The same page frames the dip under the 50-day as "a pullback within a bigger
    uptrend"; added.
13. **Arthur Hill's "Other indexes" sentence** comes from his video follow-up on crossover systems, with no numbers on
    the page; now said (4.1).
14. **The Financial Wisdom page**: its title is "Oliver Kell: US Investing Champion Strategy" and it is "Written by
    Gareth, MBA" (not a narrator credit); the quote was confirmed on a plain read, not only through a fetch tool.
15. **"The sitemap lists 103 URLs"**: it lists 103 post URLs plus the archive and about pages.
16. **The substack word counts**: totals (90 and 93) confirmed; the near-an-average shares are approximate, about 70 and
    about 40, depending on the exact word list.
17. **F4.11's list** left out Green Line Breakout and shortened two names; completed.
18. **Proposed-rule tags**: the "Lines" tag claimed source consensus for the 50-day inside a 200-day uptrend from
    ChartSchool and Connors; Connors supports only the 200-day filter, so the tag now says which part is consensus. The
    volume line's "skip" clause repeated the line above it; it is now given as the reason. Entry A's "late in the
    session" and the short mirror's "declining volume" were not measurable; both now have a stated number, marked
    [my proposal].

**Added**
19. Morales and Kacher's MAU&R definition, stop and boundary with the U&R (3.4); Morales's short-timing line (3.4, 8.6);
    Murphy's Law 6 article on slope (3.10); the owner's RDDT "as it begins to flatten out and rise" and his AMD aside
    (6.1); Bulkowski's full stage-by-stage buy rows (4.5); the drawing's recertification faults (4.6); setup 32, 28 and 29
    boundaries (2); the price check of the named examples and question 14 (6.8, 10).

## 12. Examples (from our data)

**The scan's rule (one paragraph).** Daily bars from the local sandbox (1984 to 2026-11-09), the 2,630 names that ever
met the house liquidity rule, all scanned (nothing was cut for time). "The line" is the 200-day SMA, or the 50-day SMA
only on days when the 50 sits above the 200. A reclaim day satisfies section 8.1: at least 5 consecutive closes under
the line right before it, at least one of them 0.5 ATR(14) or more under the line; in the 60 sessions before that run
began the close switched sides of the line no more than 2 times; the line today no lower than its value 10 sessions ago
minus 0.5 ATR; a green candle closing in the upper half of its range, 0.5 to 2 ATR above the line, above the 200-day
(B26), on volume at or above the 50-day average; close $10 or more and 50-day average dollar volume $20 million or more
(B23). Entry A (section 8.2): a market order at the reclaim day's close, stop 5 cents under that day's low, taken only
when the fill is no more than 4% over the line (C28) and the stop is 3.5% or less away (A13). Otherwise Entry B: 1 to 5
following sessions all closing above the line, the last an inside day or a day with a range under 1 ATR; the fill is the
first trade over that day's high (the open when it gapped over), no more than 4% over it, stop 5 cents under the lowest
low of the pause, 5% or less away. Recorded as cues, not gates: the count of closes under the line, the 60-session range
before the reclaim, whether the close cleared the 20 EMA, 50 and 200 together, whether the 200-day was above its value
20 sessions earlier, and the reclaim-volume multiple. Not coded: RS 80+ (C31), the market reading, the 3-days-before-
earnings rule (B22; the examples were checked by hand against the report dates), the 10%-over-the-10-day limit (C29),
the 8-week base as a gate, and the trims. Outcome: from the day after the entry, 60 sessions forward, the first of stop
/ 3R / 5R; same day, the stop wins.

**Base rate.** 3,895 hits, 1995-12-15 to 2026-11-09 (2,636 are 200-day remounts, 1,259 are 50-day reclaims; 262 are
on ETFs from a hand list of about 90 funds, and those did no differently, 25.2% / 16.4%). **26.5% reached 3R and 16.4%
reached 5R before the stop**; 81.8% were eventually stopped at the original stop inside the 60-session window (winners
included, since the stop never moves here) and 51.7% never reached 1R. Among winners the median time to 3R was 10
sessions. **Caveat:** a fixed stop with no trims, no breakeven move, no trail and no time stop, so it measures how often
the structure delivers 3R and 5R, not what the house trade earns. Cuts worth noting (same scan): Entry A 28.1% / 16.8%
(2,487 hits) against Entry B 23.7% / 15.6% (1,408); 50-day reclaims above the 200-day 28.3% / 18.3% (1,259) against
200-day remounts 25.6% / 15.4% (2,636); the 200-day above its value 20 sessions earlier 27.6% / 17.6% (2,647) against
24.0% / 13.8% when it was not (1,248), the one cue that helped (section 8.1's A-grade slope test); reclaim volume 1.5x
or more the 50-day average did NOT help, 25.5% / 15.6% (1,745) against 27.3% / 16.9% below 1.5x, so the 1.5x in section
9 is a grade cue without support here; 40 or more closes under the line (the template's "8 weeks or more") did NOT help,
24.0% / 14.3% (845) against 26.9% / 16.6% for 5-9 closes and 27.3% / 17.1% for 10-39; clearing all three averages on
the reclaim day made little difference, 26.8% / 16.6% against 25.1% / 15.4%; closing 1-2 ATR over the line against
0.5-1 ATR made none (26.7% against 26.4%); zero side-switches in the 60 sessions before against 1-2 made none (26.4%
against 26.5%). This sides with section 4.1's warning: the structure alone is near a coin flip at 1R, and the slope of
the 200-day is the only measured cue with a visible edge. These are one scan's counts, not a study; the owner's judgment
on volume and base length stands until a better test is run.

**The 10 examples** (all stocks, one per name, ten different years; eight 200-day remounts and two 50-day reclaims
above a rising 200-day; seven Entry A, three Entry B; every one reached 5R; none was bought in the 3 sessions before a
report, checked against the report dates; prices are split-adjusted as the database holds them). Files:
`scratchpad/setups/13-ma-reclaim/final/NN_TICKER_DATE.png` and the phone sheets `sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png` (not in the repo). "Closes under" is the run of closes below the line before the reclaim; "deep" is the
deepest close under the line in ATR(14); "range" is the high-to-low range of the 60 sessions before the reclaim.

| # | Ticker | Reclaim / entry | Line | Structure (closes under / deep / range) | Reclaim day (close over line, vol) | Buy | Stop (risk) | Best R (3R on day) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|
| 1 | UAL | 2024-09-06 (A, same day) | 200-day | 25 / 5.7 ATR / 34% | +0.62 ATR, 1.11x | 46.01 at the close | 44.80 (2.6%) | 45.9R (4) | A flat 200-day that price had held above since mid-April, a 5-week undercut, then a green reclaim that also cleared the 20 and 50; the trend that followed never looked back. |
| 2 | XPO | 2023-04-17 (A, same day) | 200-day | 24 / 3.1 ATR / 36% | +0.52 ATR, 1.02x | 34.07 at the close | 33.07 (2.9%) | 27.7R (3) | A rising 200-day, a 5-week dip under it and a one-day remount at the lowest volume the rule accepts; shows the line, not the volume, carried the trade (the cuts above agree). |
| 3 | MAS | 2020-05-18 (A, same day) | 200-day | 50 / 10.8 ATR / 46% | +1.06 ATR, 1.28x | 44.43 at the close | 43.93 (1.1%) | 28.4R (1) | The 2020 crash recovery: 10 weeks under the line, a V back to it, and a remount day whose low (43.98) stayed above the line (42.91), so the stop was tiny and 3R came the next day. Not an 8-week sideways base; a crash-and-recover remount. |
| 4 | TARS | reclaim 2025-08-07, entry 2025-08-11 (B) | 200-day | 53 / 3.8 ATR / 29% | +0.66 ATR, 2.65x | 48.29 over the pause high 48.28 | 47.16 (2.3%) | 25.2R (2) | The reclaim day was the earnings-reaction day (report 2025-08-06; allowed by 8.2) after 11 weeks under a rising 200-day; one tight session above the line, then the buy over its high: Entry B as written. |
| 5 | NTAP | 2017-09-12 (A, same day) | 200-day | 15 / 2.3 ATR / 17% | +0.54 ATR, 1.31x | 39.93 at the close | 39.11 (2.1%) | 22.2R (8) | A 3-week dip under a rising 200-day inside a quiet 17% range; the reclaim came with the 20 EMA still overhead and the stock cleared it in the following sessions; slow and steady to 5R. |
| 6 | WDC | reclaim 2005-11-17, entry 2005-11-22 (B) | 200-day | 32 / 3.4 ATR / 26% | +1.28 ATR, 2.6x | 10.58 over the pause high 10.57 | 10.20 (3.6%) | 21.3R (18) | A 6-week undercut of a rising 200-day, a wide reclaim candle on 2.6x volume that cleared all three averages, two sessions of pause, then the buy; the slowest of the ten to 3R (18 sessions) and still a 20R move. |
| 7 | INTC | 2007-04-09 (A, same day) | 200-day | 26 / 3.5 ATR / 16% | +0.56 ATR, 1.91x | 20.10 at the close | 19.80 (1.5%) | 15.0R (7) | A flat 200-day with about six months of price above it (since late September 2006), a 5-week sag under, a remount on 1.9x volume above all the averages; the mature-name remount the owner's template describes. |
| 8 | ENPH | reclaim 2021-10-12, entry 2021-10-14 (B) | 200-day | 24 / 2.8 ATR / 29% | +0.57 ATR, 1.37x | 175.92 over the pause high 175.91 | 169.77 (3.5%) | 17.3R (9) | A rising 200-day, a 5-week undercut, a reclaim that cleared all three averages, a one-day pause and the buy over its high; also a lesson in trailing: it topped five weeks later, 52% above the entry, and gave most of it back by late December. |
| 9 | ADSK | 2010-02-16 (A, same day) | 50-day (200 rising) | 16 / 2.6 ATR / 20% | +0.65 ATR, 1.74x | 25.24 at the close | 24.80 (1.7%) | 22.6R (6) | The 50-day variant: 3 weeks under the 50 with the 200-day rising far below, then a reclaim on 1.7x volume above all the averages; a Stage 2 name resuming. |
| 10 | MGM | 2013-12-06 (A, same day) | 50-day (200 rising) | 25 / 3.1 ATR / 20% | +0.82 ATR, 1.31x | 20.17 at the close | 19.77 (2.0%) | 21.0R (6) | The 50-day variant after a 5-week sideways base under the line in a long uptrend; the reclaim cleared all three averages and the stock closed above the base's high (20.98) five sessions later. |

Alternates that passed every check but share a year with one above: QGEN 2025-05-27 (200-day, Entry A, 22.3R) and AMD
2023-11-03 (200-day Entry B after the 2023-11-01 earnings-reaction reclaim, 21.2R). Dropped by hand for rule B22 even
though they were big winners: HUBS 2024-11-05 (report 2024-11-06), MSM 2016-10-31 (report 2016-11-01) and CDW
2015-07-31 (report 2015-08-03).

**Notable failures (in words).**
- **AMZN 2023-04-27** (200-day, Entry A, stopped at 0R). Fifty-seven closes under a 200-day that was still falling (it
  passed the 10-session slope test because the fall had slowed, but it sat below its value 20 sessions earlier: 106.85
  against 107.52), a 2.65x-volume reclaim, and the report came after that very close (reaction day 2023-04-28): the
  stock gapped back under the line the next morning and the stop was hit. Two lessons at once: a "flattening" line is
  not a rising one (mistake 6), and never buy into the report (B22). The stock then rose about 19% over the next two
  months without us.
- **AAPL 2022-09-12** (200-day, Entry A, stopped at 0R). A clean-looking remount of a flat 200-day on 1.49x volume,
  clearing the 20 and 50 as well, with the S&P 500 itself under its 200-day in September 2022; the next session gapped
  down through the stop and the stock fell about 18% to its October low. Mistake 11: remounts while the index is under
  its own 200-day.
- **IWM 2023-12-06** (ETF; 200-day, Entry B, stopped at 0R). Fifty-three closes under the line, a 1.7x-volume reclaim,
  a tight pause, the buy over its high with a 1.6% stop under the pause low; the stop was hit the next session on the
  shakeout and the fund then closed about 9% higher three weeks later. The Entry B stop is tight by design; on a broad
  index fund it was too tight for the noise. Also an ETF when the setup is written for leading stocks.

## 13. Failures and near-misses (from our data)

Built 2026-11-10 from the same scan as section 12 (`final/hits.json`; all four failures are Entry A, the market order at the reclaim close, the stop 5 cents under the reclaim day's low). Scripts in the review scratchpad folder `setups/13-ma-reclaim/`: `charts13.py` (both sets) and `near_scan13.py` (the near-misses: the scan's gates turned into flags, keeping only the candidates that fail exactly one gate criterion of the card, with the 50-day allowed under the 200-day and the 20 EMA added as a third line so the wrong-line and 4B- cases can show; Entry A only; the 900 most liquid names of today's universe, 2005 on). Sheets in `final/`: `fail_1-4.png`, `near_1-4.png`, and `pair_32-remount.png` (UAL 2024-09-06 above NKE 2020-08-07 from setup 32). Every chart carries the winners' levels: buy point, stop, 3R, 5R, the box over the run under the line and the reclaim mark. All numbers are read off the daily bars.

**Four failures (every gate passed, traded by the rules, stopped before 3R).**

| # | Ticker | Reclaim / entry | Line | Buy | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|
| 1 | AAPL | 2022-09-12 (A) | 200-day | 163.43 | 159.25 | 09-13, day 1, gap open 159.90, low 153.37 | Closed 153.84; 20 sessions later (10-10) it closed at 140.42, 17.83 under the 50-day; never 3R. Section 12: the S&P 500 was under its own 200-day. | mar.index_200 |
| 2 | FDX | 2018-07-31 (A) | 200-day | 198.12 | 195.31 | 08-01, day 1, low 193.94 | Closed back at 194.28; the low undercut the 50-day that day; it reached the 3R level (206.55) on 09-13 without us. A shakeout. | none failed; mar.tries |
| 3 | FSLR | 2013-07-15 (A) | 50-day | 50.27 | 48.79 | 07-16, day 1, low 48.69 | Lost the 50-day again on 07-17; 20 sessions later (08-12) it closed at 40.57, 6.30 under the 50-day; never 3R. | none failed; mar.after_entry_stop |
| 4 | RTX | 2017-09-27 (A) | 200-day | 73.74 | 72.22 | 09-29, day 2, low 72.05 | The low undercut the 50-day on 09-28; it reached the 3R level (78.30) on 12-13 without us. A shakeout. | none failed; mar.tries |

AMZN 2023-04-27 and IWM 2023-12-06 (section 12) stay in the card's list; AMZN was bought into its report (mar.earnings_window fails) and IWM is an ETF, so neither counts as a failure with every gate passed.

**Four near-misses (the chart looks like the setup; exactly one gate criterion fails).**

| # | Ticker | Reclaim day | The one criterion | The number | What it really is |
|---|---|---|---|---|---|
| 1 | CAT | 2025-08-20 | mar.lines | the line retaken is the 20 EMA (416.86) after 9 closes under it, 0.99 ATR deep, on 1.42x volume | Which average: a 20 EMA closed back over out of a decline is the Wedge Pop card (setup 15), not a Remount; the 50-day and 200-day were never lost. As a trade it reached 2.01R and was then stopped. |
| 2 | GOOG | 2023-07-13 | mar.lost_line | only 3 closes under the 50-day before the reclaim (rule: 5 to 30) | How many closes under: a pullback's undercut and reclaim (setup 12, map.undercut) or an Undercut and Rally (setup 29). Best 0.64R, stopped. |
| 3 | CRM | 2025-06-06 | mar.above_200 | the reclaim close 274.51 is under the 200-day SMA 295.88, and the 50-day (267.88) is under it too | Weinstein's 4B- (setup 10): a 50-day reclaim under a falling 200-day, a read and not a buy. Stopped at 0R. |
| 4 | MSFT | 2024-11-26 | mar.not_chop | the close switched sides of the 200-day 12 times in the 60 sessions before the break (rule: at most 2) | A chop line; the 7 closes under were one more saw across a flat average. Stopped at 0R. |

**What the failures have in common.** All four were Entry A remounts stopped within two sessions with a best excursion of 0R, and all four reclaim days ran on 1.12x to 1.49x volume, under the 1.5x grade cue. The two inside downtrends (AAPL, FSLR) kept falling and were 6 to 18 points under the 50-day a month later; the two shakeouts (FDX, RTX) undercut the 50-day on the stop day and reached 3R six to eleven weeks later without us. A remount's first test is the next session: the line held or it did not, and the rule's answer to a failed first try is a new reclaim with its own stop (mar.tries), not a lower average-in.
