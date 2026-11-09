# Setup 37: Wick Play (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
post or file named next to it and is 40 words or fewer. Nothing here is a ruling. Where I could not read a source, I say
so and give no wording from it. Numbers marked [my computation] come from my own script run on the app's daily bar
store (method and limits in 4.3). Bar prices quoted for single examples come from the same store.

Tags used in section 8: **[originator]** Oliver Kell's own words (his posts on X and his Substack); **[source
consensus]** the outside sources agree; **[UCT]** the owner, Bracco or another UCT writer; **[house rule]** the account
rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Day names used here: **day 1** is the candle that leaves the upper wick (it closes off its high). **Day 2** is the next
session, the one that opens or stays "in the wick". **Day 3** is the session after that. **Body top** means the higher
of day 1's open and close.

**Read this first (the short version).**
1. **It is Oliver Kell's term, and it is a continuation setup on the upper wick.** Kell (2020 U.S. Investing Champion)
   used it in public by March 2021: "Everyone ask about wick play....great example today is APPS...open in the
   wick, pulled back some,based intra and now holding in the wick...sign of strength." A strong stock closes off its
   high, leaving an upper wick. The next day opens inside that wick and holds there, never trading back into day 1's
   body. You buy when it breaks out.
2. **There are two published forms.** Deepvue's dictionary (the screener tied to TraderLion, where Kell teaches) defines
   both, with no numbers needed. "Wick Play": day 2's whole range sits inside day 1's upper wick (low above day 1's
   body, high below day 1's high). "In the Wick": day 2 opens below day 1's high and its low never goes under day 1's
   body. A TradingView script credited to Kell's idea adds the trigger: day 3, over the high of the "wick inside day".
   Kell's own APPS example, and the owner's own use, are the second form: open in the wick and push through the top
   of it the same day.
3. **UCT uses it the same way.** The owner (Sunday Scans, 2025-10-05, OPEN): "Or a gap up wick play with immediate
   push." Manrav (The Rest of the Week, 2025-10-21, UMC): "Wick play on weekly. Trading inside the wick from the week
   of 10/10". The owner's desk logs (paraphrased, Discord) use it for FIG, for MXL ("wick play and blast"), and as an
   opening buy beside kicker-like candles; Bracco once for VIX.
4. **Two house files have it wrong.** The Study glossary (`docs/study/research/definitions.json`) calls it buying a
   long **lower** wick (a hammer) and says "No external source names a 'wick play'." Both are wrong. The app's Quote of
   the Day carries a line attributed to Kell ("a candlestick wick at a key support or resistance level ... a precise
   rejection") that I could not find in any Kell source; it describes a rejection at a level, not Kell's hold inside an
   upper wick. Section 5.
5. **No one has published statistics for it.** Nearby measured work: Bulkowski's inside days (the strict form is
   always an inside day) and his shooting star (a long upper wick in an uptrend, a 59% bearish reversal in his tests).
   My own run on the app's bars (4.3): strict wick plays are rare (about 54 a year across 4,208 stocks) and did not
   beat an ordinary inside day in the same leaders. The owner's same-day push did modestly better than an ordinary
   break of the prior day's high, but its natural stop cannot be tested without intraday bars.
6. **Rulebook fit.** The strict form fits the house stop exactly: buy over day 2's high, stop a few cents under day 2's
   low, which is "the prior day's low" (A3, F62). The same-day form needs a stop under the day's low or under day 1's
   body, which can be wider than 3% (A13). The owner's own MXL example was about 41% above its 10-day average, which C29
   now forbids. Two UCT examples (OPEN, UMC) were under $10, which B23 now forbids.
7. **No scanner, no Model Book card, no Study unit.** It is a journal tag only, filed in the "Reversals & Reclaims"
   family, though every source treats it as a continuation in a strong uptrend.

---

## 1. What it is, and the psychology

**In two sentences.** A Wick Play is a leading stock in an uptrend that closes a session off its high (leaving an upper
wick), then trades the next session inside that wick without falling back into the prior candle's body. You buy when
price breaks above that holding range, with a stop just under it.

**The originator's one-line test.** Kell: "open in the wick, pulled back some,based intra and now holding in the
wick...sign of strength." (X, 2021-03-11; section 3.1.)

**Why it can work (reasoning from the sources, not a measured fact).**
- **What the wick says.** StockCharts ChartSchool: "Candlesticks with a long upper shadow and short lower shadow
  indicate that buyers dominated during the session, bidding prices higher, but sellers ultimately forced prices down
  from their highs." So day 1 shows sellers waiting above. Read alone, that is a warning; Bulkowski's shooting star (a
  tall upper shadow after a rise) acted as a bearish reversal 59% of the time in his tests (4.1).
- **What the hold says.** The wick play is the next day's answer to that warning. If price opens up inside the wick and
  sellers cannot push it back into day 1's body, the supply that made the wick is being absorbed. That is Kell's "sign
  of strength", and TaPlot's: "If stock holds in the wick and doesn't trade in the body of yesterdays candle, it is a
  sign of strength."
- **Who is trapped.** Traders who sold the high of day 1, or shorted the wick expecting a reversal, are wrong once price
  holds in the wick; when it takes out the wick's high they become buyers. Holders who sold on the weak close of day 1
  must buy back higher or miss the move.
- **Why the risk is small.** The holding range sits inside a wick, so it is narrow. Kell's thread on his favourite
  setups puts "Inside days, wick play, etc" in the contraction after an explosive move, and describes that phase as
  "volatility contraction (flag, pennant, inside bars, EMA support), tight area to manage risk and then continuation."

**Why it often fails (also reasoning).**
- The plain reading of a long upper wick is bearish (sellers above). The setup only flips that reading when the next
  day holds; when it does not, the warning was right.
- TaPlot's own warning: "It is important to note that this setup should not be traded in isolation. Not every wick play
  is buyable." The context (a true leader, momentum behind it) carries the edge, not the candle.
- Strict wick plays are inside days. Inside days in uptrends showed no edge on their own in our inside-day dossier's
  run (dossier 08, 4.4). In my run (4.3), sitting in the wick did not add one either.

---

## 2. Origin and naming

**Who named it.** Oliver Kell, as far as I can trace. I could not confirm that he coined the phrase; he is the earliest
dated user I found, and every source that names a person ties it to him.
- **Kell on X, 2021-03-11** (verified through X's own oEmbed endpoint, author "Oliver Kell (@OliverKell_)"): "Everyone
  ask about wick play....great example today is APPS...open in the wick, pulled back some,based intra and now holding
  in the wick...sign of strength." (https://x.com/OliverKell_/status/1370036572654071809). "Everyone ask about" means
  he had already used the term before that date.
- **Kell on X, 2021-06-06**, a thread on his favourite setups (same verification; Thread Reader App's copy shows the
  handle @1charts6, and X's oEmbed now gives the author as "Oliver Kell (@OliverKell_)"): "1. Multiple gaps (often on a wedge pop), then a
  short flag/pennant (often forms ema crossback). Inside days, wick play, etc all beneficial"
  (https://x.com/OliverKell_/status/1401517950771867648).
- **Kell's Substack, The Weeklies Watch, 2023-05-13**, "Some Things for Next Week....": "GOOG-Huge breakout this past
  week. Traded a little inside the Thursday body but looks like a wick play to me."
  (https://weeklieswatch.substack.com/p/some-things-for-next-week; byline "Oliver Kell" in the post data). This is
  the only use of "wick" in his 33 Substack posts.
- **TraderLion.** Its paid course "Swing Trading MasterClass with Oliver Kell" lists, under "Advanced Trading
  Techniques", the topics "Wick Play" and "In the Wick" (course outline, read from a Wayback Machine copy of
  https://traderlion.com/courses/swing-trading-masterclass-with-oliver-kell/ dated 2025-02-14 that an earlier step of
  this workflow saved; the live page returns HTTP 403 to my client and the lessons are behind the $797 course). I did
  not read the lessons.
- **TraderLion's 2021 masterclass slides**, "Session 3" (https://traderlion.com/wp-content/uploads/sites/2/2021/11/Oliver-Masterclass-Slides-Session-3-FINAL-Pres-11-13.pdf).
  HTTP 403 to both my fetch tool and curl. **I did not read them.** A web-search result summary said they describe the
  setup and a volume dry-up; that is a search engine's paraphrase, unverified, and I use no wording from it.
- **TaPlot, TradingView script "TAPLOT Wick Play"** (published 2021-12-17): "Wick play is a candle stick long setup
  popularized by 2020 US Investing Champion Oliver Kell" (https://www.tradingview.com/script/TGp7b78L-TAPLOT-Wick-Play/).
- **Kell's ebook**, *Victory in Stock Trading: Strategy and Tactics of the 2020 U.S. Investing Champion* (Goodreads
  lists it as a 2021 ebook; that page was read for dossier 14). **Not read.** I do not know whether it covers the wick play.

**Who Kell is.** TraderLion: "Oliver Kell is a champion trader who achieved an impressive 941% return by winning the
2020 U.S. Investing Championship." (MU trade review, 2024-09-13; read from the Wayback copy saved earlier in this
workflow.) He is also the source of the price cycle (wedge pop, EMA crossback, base n' break) that UCT teaches; UCT's
Index & ETF section credits "Oliver Kell’s cycle of price action" (Sunday Scans, 2025-06-29).

**Other names for the same idea.**

| Name | Who uses it | How it relates |
|---|---|---|
| Wick play | Kell; TaPlot; Deepvue; UCT | the term itself |
| In the Wick | Deepvue; TraderLion course topic | the open-in-the-wick, hold-above-the-body day (may break out the same day) |
| "wick inside day" | TaPlot | the strict day 2: an inside day that sits in the wick |
| "holding in the wick" | Kell | the hold, as seen during the session |
| "sitting inside the wick" | TraderLion's MU review; Manrav ("Trading inside the wick") | price resting in the prior candle's wick |

**What it is not.** Not a lower-wick (hammer) buy at support, which the house's glossary calls it (section 5). Not the
house Go Signal, whose day has a **lower** wick after a sweep of support. Not a kicker (a gap over the prior high after
a weak close), though the owner names the two together as opening buys. A strict wick play is always an **inside day**
(its range sits inside day 1's range), but most inside days are not wick plays: an inside day may sit anywhere in the
prior range, a wick play only above the prior body.

---

## 3. Every definition I could find, source by source

### 3.1 Oliver Kell on X (originator)
- **The hold (2021-03-11, APPS):** "Everyone ask about wick play....great example today is APPS...open in the wick,
  pulled back some,based intra and now holding in the wick...sign of strength."
  - What the bars show (app bar store): day 1, 2021-03-10: open 74.00, high 83.30, low 74.00, close 75.89, so the
    body top was 75.89 and the upper wick ran from 75.89 to 83.30 (80% of the day's range). Day 2, 2021-03-11: open
    80.99 (inside the wick), low 78.60 (never into the body), high 87.08 (through the wick's top), close 86.98. So his
    example is the **same-day** form: open in the wick, hold above the body, break the top of the wick.
  - The stop distance from a buy at the wick top (83.31) to just under the body top (75.88) would have been about 9%.
- **Where it fits (2021-06-06 thread):** "1. Multiple gaps (often on a wedge pop), then a short flag/pennant (often forms
  ema crossback). Inside days, wick play, etc all beneficial". Then: "First two scenarios....major explosion (VoLUME,
  gaps, major bull snort), volatility contraction (flag, pennant, inside bars, EMA support), tight area to manage risk
  and then continuation." And: "To simplify cause KISS....an EXPLOSION, a CONTRACTION, then...a CONTINUATION. Find
  explosions...then execute on the contraction." Also: "Every scenario has volume cause volume=price, cause=effect AND
  best if MONTHLY is set up."
- **What he does not say on X:** no stop, no target, no minimum wick, no volume number.

### 3.2 Oliver Kell, The Weeklies Watch (originator; his Substack)
- 2023-05-13: "GOOG-Huge breakout this past week. Traded a little inside the Thursday body but looks like a wick play to
  me." Then: "Extended but also showing extreme strength and looks like it wants to trend higher."
- What the bars show: Thursday 2023-05-11: open 115.86, high 118.44, low 114.93, close 116.90 (body top 116.90; upper
  wick 44% of the range). Friday 2023-05-12: open 117.00, high 118.26, low 116.55, close 117.92. So Friday opened in the
  wick, stayed under Thursday's high, and dipped 0.35 into the body. His words match the bars exactly: "a little
  inside the Thursday body". **He still called it a wick play.** His own rule is looser than the strict dictionary form.
- Context he gave: a "Huge breakout", "Extended". On Thursday's close GOOG sat 7.8% above its 10-day average.

### 3.3 TraderLion (established educator; Kell's teaching home)
- **Course outline** (read from the Wayback copy described in section 2): topics "Wick Play" and "In the Wick", next to
  "Outside Reversal", "Inside Bars" and "Failures, Traps, Shakeout". Topic names only; no definitions read.
- **"Anatomy Of A Trade: MU +20% Wedge Pop"** (2024-09-13, under Kell's TraderLion profile; read from a Wayback copy
  dated 2025-02-11 saved earlier in this workflow; https://traderlion.com/profile/oliver-kell/mu-wedge-pop/):
  - Day 2 (2024-05-02): "After a failed breakdown, the price is now sitting inside the wick of the previous candle."
  - Entry the next day: "MU gapped up in the form of a Wedge Pop through the moving averages over the previous flag
    formation."
  - Stop: "Initiating a new position, Oliver staggered his stops with the 10 and 20 exponential moving averages under
    the day’s low."
  - What the bars show: 2024-05-01 open 110.52, high 113.73, close 109.70 (a red day; body top 110.52, wick to 113.73).
    2024-05-02 open 111.74, high 112.41, low 109.43, close 112.33: it opened in the wick, dipped under the body top,
    and **closed** in the wick. 2024-05-03 opened 115.03, above both days' highs. So this is a loose use ("sitting
    inside the wick" at the close), bought on the next day's gap.
- **Session 3 slides (2021):** not read (HTTP 403). No wording used.

### 3.4 Deepvue Knowledge Base, "Technicals" dictionary (data source; Kell and TraderLion's screener)
Page: https://docs.deepvue.com/articles/technical (page data: published 2024-09-03, modified 2026-06-19; read
2026-11-09).
- **Wick Play:** "Candlestick pattern formed when the low of the current candle is greater than the larger of the prior
  day’s open or close and the high of the current candle is less than the prior day’s high." And: "The entirety of the
  current day’s price action is contained in the wick of the prior day."
- **In the Wick:** "Candlestick pattern formed when the stock opens below yesterday’s high and today’s low never breaks
  below the the larger of yesterday’s open or close." (The doubled "the" is on the page.)
- These are the only exact, testable definitions I found. They need **no threshold**: no wick size, no volume, no
  trend. They define the candle pair only; Deepvue gives no trigger, stop or target.
- The same page's "Inside Day": "Candlestick chart pattern that is formed when the high and low of today’s candlestick
  are completely contained within the high and low of the previous candlestick." So every Deepvue "Wick Play" is
  also a Deepvue "Inside Day".

### 3.5 TaPlot, "TAPLOT Wick Play" on TradingView (indicator author; secondary, credits Kell)
Page: https://www.tradingview.com/script/TGp7b78L-TAPLOT-Wick-Play/ (published 2021-12-17; author signature "Momentum &
Breakout Trader Since 2006"). The four rules, as written:
- "Strong stock with momentum to the upside closes off the highs of the day in yesterdays session."
- "Today's session opens in the candle \"wick\" of yesterdays bar."
- "If stock holds in the wick and doesn't trade in the body of yesterdays candle, it is a sign of strength."
- "Trigger happens on day 3 when price moves over the high of the wick inside day."
- Context: "It is important to note that this setup should not be traded in isolation. Not every wick play is buyable."
  And: "This is to be used in the context of strong stocks like True Market Leaders and with buying momentum behind
  them."
- **The script has no numbers.** I read its published settings through TradingView's own script service: the only
  inputs are "Bar Color", "Wick Play Indicator Color", "Paint Bar?" and "Show Wick Play?". The code itself is compiled,
  so I could not read the exact test; the description implies Deepvue's strict form plus the day-3 trigger.
- Not given: stop, target, volume.

### 3.6 UCT (house; full quotes in section 6)
- The owner wants it as an **opening** buy: "Or a gap up wick play with immediate push." (OPEN, 2025-10-05.) His desk
  logs (paraphrased) pair "wick plays" with kicker-like candles as reasonable buys at the open, and describe an MXL
  "wick play and blast".
- Manrav applies it to a **weekly** candle, with two triggers: "Watch for the push above 7.66 or a pullback to 21 EMA to
  mange the risk."
- No UCT text gives a stop, a minimum wick or a volume rule for it.

### 3.7 Classical context (established educators and measured work; not wick-play sources)
- **StockCharts ChartSchool**, "Introduction to Candlesticks": the long upper shadow quote in section 1
  (https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/introduction-to-candlesticks).
- **Thomas Bulkowski**, shooting star and inside days (section 4.1). **His site carries a notice against AI use**:
  "This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems," (quoted as the
  fetch tool returned it). I read it to cite it, with links and short quotes only.

### 3.8 Read and not used, and not found
- TraderLion's lesson pages and the 2021 slides: HTTP 403 (and paid). Not used.
- Thread Reader App's copy of Kell's 2021 thread: used only to find the post IDs; every quote was then checked on X's
  own oEmbed endpoint.
- **My web search budget ran out after one search.** I therefore could not look for other writers who use the term,
  for a Kell video on it, or for any study. I found no other originator and no statistics, but that search was not
  exhaustive.

### 3.9 Comparison table

| Item | Kell (X, Substack) | TaPlot | Deepvue "Wick Play" | Deepvue "In the Wick" | TraderLion MU review | UCT (owner, Manrav) |
|---|---|---|---|---|---|---|
| Stock | strong, after an "explosion" (gaps, volume) | "Strong stock with momentum"; "True Market Leaders" | none | none | a leader after an 18% earnings gap | leaders and themes |
| Day 1 | closes off the high (implied) | "closes off the highs" | any candle with room above its body | any | a red day with a wick | not stated |
| Day 2 open | "open in the wick" | "opens in the candle \"wick\"" | implied (whole day in the wick) | below day 1's high, above the body | in the wick | "gap up" (owner) |
| Day 2 low | holds in the wick; "a little" into the body allowed (GOOG) | never into the body | above the body top | never under the body top | dipped under the body top | not stated |
| Day 2 high | may break out the same day (APPS) | stays inside ("wick inside day") | under day 1's high | free | under day 1's high | "immediate push" (owner) |
| Trigger | not stated | day 3, over day 2's high | none | none | next day's gap above both | push over day 1's high (owner); over 7.66, or a pullback to the 21 EMA (Manrav) |
| Stop | not stated | not stated | none | none | "staggered his stops with the 10 and 20" EMAs "under the day’s low" (as worded) | not stated |
| Volume | "Every scenario has volume" | none | none | none | none | none |
| Timeframe | daily | daily (script shown on daily) | daily | daily | daily | daily; weekly (Manrav) |
| Targets | none | none | none | none | managed through the cycle | none |

### 3.10 Where they disagree
1. **Strict or same-day.** Deepvue's "Wick Play" and TaPlot keep day 2 entirely inside the wick and buy day 3. Kell's
   APPS, Deepvue's "In the Wick" and the owner's "gap up wick play with immediate push" allow (or want) day 2 to break
   the top of the wick itself.
2. **Touching the body.** TaPlot and Deepvue: never. Kell (GOOG): "a little" is fine. TraderLion's MU: dipped under
   and closed back in the wick.
3. **Trigger.** Over day 2's high (TaPlot), over day 1's high (the top of the wick; the same-day form), or the next
   day's gap (TraderLion MU). Manrav adds a pullback entry at the 21-day EMA.
4. **Timeframe.** Everyone uses daily candles; Manrav uses a weekly one.
5. **Context.** Deepvue has none; every trader source insists on a strong leader. TaPlot: "Not every wick play is
   buyable."

---

## 4. Measured evidence

No one has published statistics for a "wick play" by that name, as far as I could find (with the search limit in 3.8).
What exists is measured work on its parts.

### 4.1 Bulkowski, ThePatternSite (stocks; read through the fetch tool; AI notice flagged in 3.7)
- **Shooting star** (https://thepatternsite.com/ShootingStar.html): a candle with "little or no lower shadow and a tall
  upper shadow at least twice the height of the body" after an upward trend. "Tested performance: Bearish reversal 59% of
  the time". Overall performance rank 55 (his candle ranking; I did not read how many candles were ranked). What it
  means here: a long upper wick after a rise leans bearish on its own. The wick play is the subset where the next day
  refuses that reading. Limits: as I understand his method (not re-read here), a "reversal" counts which way price closes
  outside the candle first; it is not a trade with a stop. The fetch tool returns extracts.
- **Inside days** (https://thepatternsite.com/InsideDays.html): "I used 1,260 stocks, starting from December 1989 to
  January 2013," and "The pattern acts as a continuation 62% of the time." Bull market, upward breakouts: "Break even
  failure rate*: 32% (up breakouts)", "Average rise*: 10%", "Overall performance rank (1 is best): 10/23". Our inside-day
  dossier (08, section 4.2) has his trading test. Limits: his breakout is a close beyond the range and the entry the
  next open; no trend, leader or wick filter.

### 4.2 Other published numbers
None found. Kell, TaPlot, Deepvue and TraderLion give no success rate, average move or failure rate.

### 4.3 My measurement on the app's bars [my computation]
This is my own check, not a published study and not peer reviewed. The script lives in my scratch folder, not in
the repo.

**Data.** A sandbox copy of the app's daily bar store: 4,208 tickers. **It holds only stocks that still trade** (for
example SIVB, TWTR and CELG are absent), so failed companies are missing and every number below leans optimistic.
Signals from 2000-01-01 to 2026-09-30.

**Context (the house rules as filters), read at day 1's close.** Price $10 or more and a 20-day average of $20 million
traded (B23). Close above the 200-day and the 50-day above the 200-day (B26). Close at most 10% over the 10-day
average (C29). A 126-day return in the top 20% of those liquid stocks that day, as a stand-in for RS 80+ (C31; not
IBD's rating). About 1.09 million stock-days qualify ("leader-days").

**Groups.** Every trade buys at market on the cross of the trigger (E57), skips a fill more than 4% past it (C28), and
puts the stop a cent under the named low.
- **V1, strict wick play** (Deepvue "Wick Play"): buy on day 3 over day 2's high (TaPlot); stop under day 2's low.
- **V1w**, same pattern: buy over day 1's high (the top of the wick) within 3 sessions; stop under day 2's low.
- **V2, in the wick** (Deepvue "In the Wick", known at day 2's close): buy on day 3 over day 2's high; stop under day
  2's low.
- **V3, same-day push**: day 2 opens inside the wick and trades over day 1's high; buy there. Stop a: under day 1's body
  top. Stop b: under day 1's low (the house default, the prior day's low).
- **Controls, same leader-days:** C_ID, an inside day **not** in the wick (same trade as V1); C_ANY, any day (one in
  eight sampled; same trade as V1); C_PDH, a day that opened at or under day 1's body top and then crossed day 1's high
  (one in two sampled; same trade as V3 stop b).

**Exits.** E1: 3R target, the stop, or the close of the 20th session. H, the house plan: stop to breakeven at 2R, a
third at 3R, a third at 5R, the rest on a close under the 10-day average, sold at the 10th session if it never reached
1R (C33), 60 sessions at most. A gap through the stop exits at the open.

**The daily-bar problem.** When the entry day's range covers both the trigger and the stop, daily bars cannot say which
came first. I score those trades two ways: as full losses (conservative) and by leaving them out (optimistic). The
truth is between the two numbers. The controls are scored the same way, so the comparisons are fairer than any single
number.

| Group | Signals | Trades | Median stop | Stop within 3% | P(3R before the stop, 20 sessions), cons. / opt. | House plan, mean R, cons. / opt. (± standard error) |
|---|---:|---:|---:|---:|---|---|
| V1 strict wick play | 1,433 | 929 | 1.97% | 77.8% | 19.6% / 29.5% | -0.22 ± 0.05 / +0.18 ± 0.08 |
| V1w strict, buy over the wick top | 1,433 | 777 | 2.33% | 67.8% | 20.1% / 26.8% | -0.21 ± 0.06 / +0.06 ± 0.07 |
| V2 in the wick | 38,357 | 23,834 | 2.63% | 58.7% | 19.1% / 23.3% | -0.13 ± 0.011 / +0.06 ± 0.013 |
| C_ID inside day, not in the wick | 129,852 | 73,687 | 2.12% | 73.1% | 21.4% / 29.4% | -0.12 ± 0.006 / +0.21 ± 0.008 |
| C_ANY any leader-day | sampled | 67,630 | 2.58% | 60.1% | 19.8% / 24.3% | -0.10 ± 0.006 / +0.10 ± 0.007 |
| V3 stop a (under day 1's body top) | 139,308 | 139,308 | 0.82% | 96.8% | 14.4% / 53.6% | -0.41 ± 0.005 / +1.21 ± 0.016 |
| V3 stop b (under day 1's low) | 139,308 | 139,308 | 2.50% | 62.7% | 21.8% / 25.7% | -0.04 ± 0.004 / +0.13 ± 0.005 |
| C_PDH ordinary prior-day-high break | sampled | 118,780 | 2.44% | 64.3% | 18.6% / 24.8% | -0.18 ± 0.004 / +0.10 ± 0.006 |

Of the 1,433 strict signals, 929 filled; 449 were voided because day 2's low broke before the trigger, 6 were skipped
as a chase, and 49 never reached the trigger on day 3.

**What it says.**
1. **Strict wick plays are rare.** 1,433 in about 1.09 million leader-days (0.13%), about 54 a year across the whole
   store. The looser "in the wick" day is about 27 times as common (3.5% of leader-days).
2. **The strict wick play did not beat an ordinary inside day in the same leaders.** Its range (-0.22R to +0.18R)
   sits inside the plain inside day's (-0.12R to +0.21R), and its sample is small. I cannot show that sitting in the
   wick adds anything over sitting anywhere inside the prior day's range. Buying it over the top of the wick (V1w) was
   no better than over day 2's high.
3. **The "in the wick" day bought on day 3 did a little worse** than any leader-day bought the same way (-0.13 to +0.06
   against -0.10 to +0.10).
4. **The same-day push did better than an ordinary break of the prior day's high, with the same stop** (under day 1's
   low): -0.04 against -0.18 conservative, +0.13 against +0.10 optimistic. Most of the difference is in the
   conservative scoring, so call it a modest plus at best.
5. **The same-day push with a stop under day 1's body top cannot be measured on daily bars.** In 74% of these days the
   price went under the body top at some point, and only intraday bars can say whether that was before the break (no
   trade) or after it (a loss). Leaving them out gives +1.21R; counting them all as losses gives -0.41R. Neither is the
   answer. **This is the form the owner uses, so it is the one to measure with intraday bars.**
6. **Volume on day 2 made no clear difference.** V1 with day 2 under 70% of day 1's volume: -0.20 ± 0.09; day 2
   heavier than day 1: -0.33 ± 0.12 (conservative). V2: -0.14 against -0.13. Kell's slides were described to me as
   wanting a dry-up; I could not read them, and this run does not support a hard volume rule.
7. **Stops.** The strict form's stop is tight (median 1.97%; 78% within 3%), which fits A13. Stops under day 2's low on
   the "in the wick" day and under day 1's low are wider (medians about 2.5% to 2.6%; about 60% within 3%).
8. **It is unstable by decade.** V1, conservative: 2000 to 2009 +0.12 ± 0.14; 2010 to 2019 -0.42 ± 0.07; 2020 to 2026
   -0.17 ± 0.09.
9. **After an "explosion"** (Kell's frame; the definition is mine: a 4% gap over the prior high on 1.5 times the 50-day
   volume, or a close at a new 50-day high on 1.5 times that volume, within the 15 sessions before day 1; about 30% of
   each group qualifies). V1 after one: -0.14 ± 0.10 / +0.23 ± 0.13 (315 trades); without one: -0.26 ± 0.06 / +0.15 ±
   0.09. That is within the noise. V2 and the same-day push did slightly worse after one (V2 -0.15 against -0.13; V3
   stop b -0.06 against -0.04, conservative). I could not confirm Kell's context with this definition.
10. **Wick size made no clear difference.** In V2, a day-1 wick over half of the range did slightly worse (-0.16 ±
    0.02) than one under a quarter (-0.11 ± 0.02), conservative. (Nearly nine in ten strict wick plays had a wick over
    half the range.) So the data give no support for a minimum wick.

**Limits.** Listed stocks only (survivorship). No commissions or slippage. The RS filter is a stand-in. No market
filter (B18) and no earnings filter (B22). Fills at the exact trigger. Gaps through the stop exit at the open; the
30-minute rule (B20) is not modelled. Daily-bar ordering, as above. The house plan's mean R is before costs, and even
the controls are near zero, so this run can rank the variants against each other; it cannot say what a member will
earn.

### 4.4 Checks of the named examples on the bars
These are the uses I could tie to a date and a ticker, checked on the app's bar store. They are illustrations, not
evidence: they were picked by the people who named them.

| Example | Who named it | Form on the bars | What followed | Today's rulebook |
|---|---|---|---|---|
| APPS 2021-03-11 | Kell (X) | day 1 wick 80% of the range; day 2 opened in the wick, held above the body, broke 83.30, closed +14.6% | bought over 83.30: a stop under the body top (8.9% away) or under day 2's low (5.7%) was hit within 4 sessions | A13 fails (stop 5.7% to 8.9%) |
| GOOG 2023-05-12 | Kell (Substack) | opened in the wick, stayed under day 1's high, dipped 0.35 into the body | high of 129.55 within 20 sessions, +9.9% over day 2's close; low 116.48 | fits; 7.8% over the 10-day |
| MU 2024-05-02 | TraderLion, on Kell's trade | opened in the wick, dipped under the body top, closed in the wick; bought on 05-03's gap | high of 133.30 within 20 sessions, +18.7% | fits |
| OPEN 2025-10-06 | the owner's scenario (Sunday Scans) | opened in the wick, 6 cents into the body, broke 8.83, closed +14.4% | bought over 8.83: stopped by 10-10 (any of the three stops) | B23 fails (about $8 to $9) |
| FIG 2025-10-07 | the owner (desk log, paraphrased) | opened in the wick, held above the body, broke 61.75, closed back at 60.84 | with a stop under day 2's low (4.8%): 3R the next day. Under the body top (7.8%) or day 1's low (17.3%): stopped later in October | no 200-day (listed 2025-07-31) |
| FIG 2025-10-08 | (the next day; bars only) | opened in 10-07's wick, held above its body, closed +16.8% | stop under day 2's low (2.6%): 3R the next session; under the body top: stopped 10-10 | 12.5% over the 10-day: C29 fails |
| MXL 2026-04-29 | the owner (KB summary) | opened in the wick, held above the body, broke 56.07, closed +29.8% | 3R within 1 to 2 sessions under any of the three stops; high of 106.28 within 20 sessions | about 41% over the 10-day: C29 fails |
| UMC, weekly, October 2025 | Manrav | the 7.66 trigger is the 2025-10-13 daily high; I could not reproduce "inside the wick" exactly on the store's weekly bars | not checked | B23 fails (about $7.50) |

What the examples teach: in the five same-day cases (APPS, OPEN, FIG twice, MXL) the long wick makes a stop under day
1's body top or low wide: 4.0% to 17.3% from a buy at the top of the wick. A stop under day 2's own low was 2.6% to 9.0%
(within 5% in three of the five), and it assumes the day's low printed before the break, which is Kell's "pulled back
some,based intra" sequence. Daily bars cannot confirm that order.

---

## 5. Our app: what the code and the cards say

### 5.1 Scanners
**None.** No detector in `api/services/pattern_engine/detectors/` tests a wick play (searched for "wick play",
"in_wick", "inside_wick"). The nearest:
- `detectors/uct/uct_inside_day.py` (admin-only): an inside day (high at or under the prior high, low at or over the
  prior low) with close > 8 EMA > 21 EMA > 50 SMA and a range of at most 0.7 ATR; entry over the inside day's high,
  stop at its low. A strict wick play is an inside day, so some strict wick plays fire it, but it does not test where the
  day sits (above the prior body or not), and its 0.7 ATR cap and stack rule are not part of any wick-play source.
- `detectors/candlestick/hammer.py`: a **lower** wick at least twice the body, with a reversal-context gate. Not this
  setup.
- `detectors/uct/uct_go_signal.py`: a day that opens under the prior close, sweeps support, and shows buyers stepping in
  (for example a **lower** wick of 40% of the range, per `docs/study/TRADE_PLANS.md`). Not this setup.

### 5.2 Model Book card and journal tags
- **No Model Book card.** `app/src/pages/modelbook/setupCatalog.js` has no "Wick Play" entry.
- **Journal tag.** `app/src/constants/setupGroups.js` lists 'Wick Play' in the **Swing** group. `app/src/pages/
  journal-2-0/lib/setupTagMap.js` files it under `TAXONOMY_ONLY_FAMILY['Wick Play'] = 'Reversals & Reclaims'`.
  **Disagrees with every source:** Kell, TaPlot and the owner use it as a continuation in a strong uptrend ("Strong
  stock with momentum to the upside"), which belongs with "Momentum & Trend". No direction is stored.
- `docs/wisdom/vocabulary/setup-vocabulary-v1.json`: no vocabulary entry ("the authors did not name it in the Session 0
  samples").
- `docs/study/UNITS-method.md`: no Study unit ("no unit; owner may add later").

### 5.3 Other house texts, and what is wrong in them
- **`docs/study/research/definitions.json` (the Study glossary), entry "Wick Play": wrong twice.** It says "House slang
  for buying off a long lower wick that shows a rejected low" and "No external source names a 'wick play'." Its nearest
  standard is "Long lower shadow / hammer (Bulkowski)". Every source I read (Kell, TaPlot, Deepvue, TraderLion, the
  owner) means the **upper** wick of the prior candle, and four sources outside UCT name it (Kell, TaPlot, Deepvue,
  TraderLion). The hammer statistic quoted there belongs to a different setup. Recommend replacing the entry.
- **`app/src/constants/quotes.json`, a Quote of the Day line attributed to "Oliver Kell", source "UCT Knowledge Base":**
  "The wick play: a candlestick wick at a key support or resistance level is not a failed move", followed (after a
  dash) by "it is a precise rejection with a built-in stop." I found this wording in no Kell post, Substack post,
  TraderLion page or Deepvue page, and nowhere else in the repo. It describes a rejection at a level (closer to a hammer), not Kell's hold inside an
  upper wick. It was added in commit `367bbcf292` (2026-08-22). **Unverified; recommend removing it or replacing it with
  a verified Kell line** (for example the 2021-03-11 post), since members see it as Kell's words.
- **`app/src/components/chart/engine/ast/starterScans.json` and `api/services/starter_library.py`:** the Chart builder
  refuses a Wick Play starter, saying it "is a single-bar discretionary read on where the wick sits relative to the
  range" and that "every threshold this scan could use would be the catalogue author's." **Both points are out of
  date.** It is a two-bar pattern, and Deepvue publishes a definition with no threshold at all. The same file says the
  offset node (`close[1]` and the like) is now legal, so the strict form is sayable as
  `low > max(open[1], close[1]) && high < high[1]` (the max of two prior-bar values may need its own check in the
  grammar). This would need the owner's eye before it ships.
- **`docs/superpowers/research/setups/setup_criteria.json`, "Wick Play":** the closest correct reading in the repo
  (it cites TaPlot's three-bar rule). Two corrections: its formula `low[1] > close[2] && high[1] < high[2] && high >
  high[1]` uses day 1's **close** as the body top, which is wrong when day 1 is red (the body top is then the open; use
  `max(open[2], close[2])`). And its note that "The firm's Wick Play is a LOCATION play (wick at a level), not a
  candle-shape play" does not fit the owner's words, which describe a gap into the prior wick and a push.
- `CLAUDE.md` and `docs/plans/2026-03-28-trade-journal-implementation.md` only list the name.

### 5.4 What the app would need to teach it
A detector for the two Deepvue forms is simple and threshold-free (section 8 gives the measurable lines). The open
choices are the owner's (section 10): which form, which trigger, which stop.

---

## 6. UCT's own words

**Who wrote what.** The Substack sitemap lists 103 posts (2026-11-09). I read 101 in full through Substack's post API;
one is a placeholder page and one (sunday-scans-bf1) is for paid subscribers only, so I could not read it. "Wick"
appears 65 times: lower wick or lower wicks 39 times, upper wick or upper wicks 13 times, and the exact phrase "wick play" twice: once in
TSDR's section (TSDR is the owner, as the earlier dossiers establish) and once in Manrav's. Dates are the post's
publish time in US Eastern.

### 6.1 The owner in public
- OPEN, Sunday Scans of 2025-10-05, under the heading "TSDR’s Weekly Outlook & Watchlist", subheading "Some great
  charts below that I am watching.": "OPEN (Daily) Tried Friday, didn’t get the strong close and follow through I was
  looking for." Then: "The scenarios I am interested in next week early on are either a shakeout below 20EMA into the
  bullish gap that acts as an undercut. Or a gap up wick play with immediate push. Both would be tradable imo."
  ([sunday-scans-6ef](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef))
  - Note: the Kicker dossier labelled this post's "Charts Covered" block as unsigned. In the post's own heading
    structure it sits under TSDR's heading, so I treat it as his.
  - What happened (bars): Friday 2025-10-03: open 8.00, high 8.83, low 7.92, close 8.11 (body top 8.11, an upper wick
    of 79% of the range). Monday 2025-10-06: open 8.30 (inside the wick), low 8.05 (6 cents into the body), high 9.69
    (through the wick's top), close 9.28. So the scenario he named played out on Monday, then the stock fell to 6.23
    within 20 sessions. OPEN traded near $8 to $9, under the $10 floor of B23.

### 6.2 The owner's desk logs (Discord; paraphrased, not quoted)
These are summaries already tracked in this public repo (`docs/study/levels/brain_kb_2026-11-06.json` and
`brain_kb_rules_2026-11-06.json`). The repo's `CLAUDE.md` says Discord content must not be copied in, so I give
paraphrases with the KB number. Read the file for the wording. None was re-checked against Discord.
- KB 10208 (desk log, 2025-10-07, FIG): no position yet; he could have bought the wedge pop the day before; a gap-up
  wick play was possible that day; ideally the stock would build above its curling averages and flag.
  - Bars: 2025-10-06 open 53.46, high 61.75, close 56.96 (body top 56.96). 2025-10-07 open 61.60 (in the wick), low
    58.78 (held above the body), high 64.17 (through 61.75), close 60.84 (back inside the wick). 2025-10-08 then opened
    63.00 inside the 10-07 wick, held above its body (low 62.52) and closed 71.08, up 16.8%. Within 20 sessions FIG
    traded down to 43.80. FIG had listed on 2025-07-31, so it had no 200-day average.
- KB 10213 (desk log, 2025-10-13, the Monday after the 2025-10-10 sell-off): buying some names at the open was reasonable where
  there were kicker-like candles or wick plays; otherwise he was watching hourly charts for tight risk spots.
- KB 12545 (trader archive, 2026-04-29, MXL; the KB's summary, not his words): asked where the entries were on an
  episodic pivot, he listed a day-1 EP (stopped the next day), a day-2 oops reversal, and a "day-4 wick play and
  blast"; he would trail the stop at the previous candle's low.
  - Bars: EP gap on 2026-04-24 (open 54.00 from a 34.25 close). 2026-04-28: open 49.91, high 56.07, close 52.01 (body
    top 52.01). 2026-04-29: open 54.74 (in the wick), low 54.44 (held above the body), high 71.28 (through 56.07), close
    67.52, up 29.8%. Counting 04-24 as day 1, 04-29 is day 4. (On that count day 2 is 04-27, which opened above the
    prior close and fell; it was 04-28 that opened under 04-27's low and closed back above it, an oops reversal. So the
    summary's day numbers may be off by one. The wick play itself fits 04-29.) On 04-28's close MXL sat about 41%
    above its 10-day average, so C29 would now skip it.

### 6.3 Other UCT writers
- **Manrav**, The Rest of the Week, 2025-10-21 (published 21:00 ET; 2025-10-22 UTC), section "Manrav - IOT UMC": "UMC
  (United Microelectronics) Wick play on weekly. Trading inside the wick from the week of 10/10 with a launch pad on
  daily. Watch for the push above 7.66 or a pullback to 21 EMA to mange the risk." Then: "Earnings on 10/29."
  ([the-rest-of-the-week-481](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481))
  - Bars: the week ending 2025-10-10 opened 7.26, reached 7.57 and closed 7.18 (a red week with a wick from 7.26 to
    7.57). The 7.66 trigger is the 2025-10-13 daily high. On the store's daily bars the following weeks did not stay
    strictly inside that wick (the week of 10-13 reached 7.66), so I cannot reproduce his weekly reading exactly; his
    data vendor's weekly bars may differ. UMC traded near $7.50, under B23's $10 floor.
- **Bracco**, KB 12666 (trader archive, 2026-06-10; summary): in a market note he called VIX a wick play (so a bullish
  VIX setup, a bearish market read). No trade rule given.

### 6.4 What UCT has not written
No public UCT post defines the wick play, gives a stop, a minimum wick, a volume rule or a short version. UCT writers
use "lower wick" often (for buyers stepping in at support), which is a different idea; members could confuse the two.

---

## 7. How it fits the account rulebook (section 9)

| Rule | Fit | Note |
|---|---|---|
| A3, F62 stop under the day's low or the prior day's low | **fits the strict form exactly** | buy over day 2's high on day 3; the stop a few cents under day 2's low is "the prior day's low" |
| A3 for the same-day form | fits | the stop under the day's low at the moment of the buy; a break back into day 1's body is the natural line |
| A13 stop usually within about 3% | strict form: usually fits; same-day form: often wider | see 4.3 for the measured stop distances; Kell's APPS stop to the body top was about 9% |
| E57 market orders | fits | a market order when price crosses the trigger |
| C28 no chase past 4% | applies | day 3 can gap; skip if it opens more than 4% over the trigger |
| C29 skip if more than 10% over the 10-day | **conflict** | wick plays often come right after an "explosion" (Kell); the owner's MXL example was about 41% over its 10-day, FIG's 10-08 day about 12.5% |
| B26 no longs under the 200-day | fits | every source wants a strong uptrend; new listings (FIG) have no 200-day and E53 sets no IPO rule |
| B23 $10 and $20M a day | applies | two UCT examples fail it (OPEN about $8, UMC about $7.50) |
| C31 RS 80+ leaders | fits | TaPlot's "True Market Leaders" and Kell's "strong stock" say the same |
| B22 no new buys 3 days before earnings | applies | Manrav's UMC note named earnings eight calendar days out |
| B19, E51, E52 trims and trail | house defaults | no source gives a wick-play exit |
| B20 gap through the stop | applies | first 30-minute low becomes the stop; out past 2R |
| D47 shorts are the longs reversed | no source | no one publishes a bearish wick play; see 8.6 |
| C33 time stop | applies | a trade under 1R after 10 sessions is sold |

---

## 8. Proposed rules for our course

Each line is measurable on daily bars, except the order of events inside day 2 for the same-day form, which needs
intraday bars. Where sources disagree, I give the options and a recommendation.

### 8.1 What it is
- **Stock:** a leader: RS rating 80 or more, in a strong group [house rule C31]; Kell's "strong stock" and TaPlot's
  "True Market Leaders" [originator; source consensus].
- **Trend:** close above the 50-day and the 200-day, with the 50-day above the 200-day [house rule B26; my proposal for
  the 50-day].
- **Prior move:** best within a few weeks of an "explosion": a gap or a big-volume breakout [originator, Kell's thread].
  No source gives a number. [my proposal] Within 15 sessions of a 4% gap on at least 1.5 times the 50-day volume, or
  of a close at a new 50-day high on that volume; a grading plus, not a requirement (section 9), because my run did
  not confirm that it helps (4.3, item 9).
- **Day 1:** closes below its high, leaving an upper wick [originator; TaPlot "closes off the highs"]. No source gives
  a minimum, and my run did not find that bigger wicks did better (4.3, item 10). [my proposal] For teaching, the wick
  (high minus body top) is at least a quarter of day 1's range, so the zone is plain to see on a chart.
- **Day 2, strict form ("Wick Play"):** low above day 1's body top and high below day 1's high [Deepvue; TaPlot].
- **Day 2, same-day form ("In the Wick" and push):** opens above day 1's body top and below day 1's high, and has not
  traded under the body top when it breaks day 1's high [Deepvue "In the Wick"; Kell APPS; UCT owner].
- **Touching the body:** [my proposal] the strict form allows none (Deepvue). Kell allowed "a little" (GOOG: 0.35 on a
  $117 stock, about 0.3%). If the owner wants Kell's tolerance, a measurable version is a dip of at most 0.25 ATR under
  the body top, graded B rather than A.
- **Volume:** no published rule I could read. [my proposal] Day 2 lighter than day 1 is a grading plus, not a
  requirement; my run found no clear difference (4.3, item 6).
- **Location:** within 10% of the 10-day average at day 1's close [house rule C29], and see the conflict in section 7.
- **Liquidity:** $10 or more and $20 million a day [house rule B23]; never more than 1% of average daily volume [D42].
- **Timeframe:** daily candles [source consensus]. Weekly wick plays (Manrav) are a UCT extension [UCT]; owner
  question.

### 8.2 The buy
Two options; the sources split (3.10).
- **Option A, strict (TaPlot):** on day 3, buy at market as soon as price trades a cent over day 2's high [originator
  via TaPlot; house rule E57]. If day 3 opens more than 4% over the trigger, skip [C28].
- **Option B, same-day push (Kell APPS; the owner's "gap up wick play with immediate push"):** on day 2, buy at market
  as soon as price trades over day 1's high, provided day 2 opened inside the wick and has not traded into day 1's
  body [originator; UCT].
- **Recommendation [my proposal]: one setup, two entries, in this order.** Day 2 opens inside day 1's upper wick. If
  it breaks day 1's high while it has held above day 1's body, buy then (Option B): this is how the owner and Kell use
  it, and on the daily bars the same-day push did better than an ordinary break of the prior day's high with the same
  stop (4.3, item 4). If day 2 instead closes still inside the wick without breaking out, it has become a strict wick
  play overnight: buy on day 3 over day 2's high (Option A), with the tight house stop. Reason for the order: Option B
  is the house's own use; Option A is the patient fallback with the stop the rulebook already prescribes. Before
  Option B is built into a scanner or a drill, measure it on intraday bars (4.3, item 5).

### 8.3 The stop
- **Option A:** a few cents under day 2's low, which is the prior day's low at the time of the buy [house rule A3,
  F62; matches the strict form].
- **Option B:** a few cents under the day's low at the moment of the buy [house rule A3], which can be no lower than day
  1's body top if the setup is valid. The body top is the line the setup says must hold [Deepvue; TaPlot].
- **Fit check:** size from the honest stop [house rule A5]. The owner's stops usually sit within about 3% [A13]; a much
  wider stop means a smaller position, and if it does not fit the risk at all, skip [A3]. Never tighten it to fit.
- A gap through the stop: the first 30-minute low is the new stop; out if that is past 2R [house rule B20].

### 8.4 Trims and trail (house defaults; no source gives a wick-play exit)
- Stop to breakeven at 2R to 5R [B19]. A third at 3R, a third at 5R [B19, E51]. Trail the rest under the 10-day for
  fast movers, the 21-day for steadier ones, on a close below it [E52]. A trim level gapped through: take it at the
  open [F63]. Under 1R after 10 sessions: sell [C33].

### 8.5 What invalidates it (before the buy)
- Day 2 trades into day 1's body (strict form) [Deepvue; TaPlot], or more than the tolerance in 8.1 if the owner adopts
  Kell's looser reading.
- Price trades under the planned stop before the trigger [my proposal].
- The trigger day opens more than 4% past the trigger [C28]; earnings within 3 days [B22]; under the 200-day [B26];
  more than 10% over the 10-day [C29].
- The trigger does not come on day 3 (strict form). [my proposal] Re-draw: if day 3 is itself an inside day in the
  same wick, the setup rolls forward one day.
- After the buy, the stop is the exit [A4].

### 8.6 The short mirror
No source defines a bearish wick play. By D47 ("Shorts are the same just reversed for almost all our setupstuff") the
mirror would be [my proposal]: a weak stock under its 200-day (B26) with RS 20 or less (C31's mirror) closes a red day
off its low, leaving a **lower** wick; day 2 stays inside that lower wick (high under day 1's body bottom, low above day
1's low); sell short a cent under day 2's low on day 3; stop a few cents over day 2's high; skip hard-to-borrow names
(D48). Warning for teaching: a lower wick is usually read as **bullish** (hammer), so the mirror reads opposite to the
common lesson; it should be taught only if the owner wants it.

### 8.7 Best market conditions
- A Green market reading [B18, F65]; Orange: A+ only.
- A leading group with fresh explosions (gaps, volume) [originator, Kell's thread]; Kell adds "best if MONTHLY is set up"
  for all his favourite setups [originator].

### 8.8 Common mistakes
- Treating any long wick as a wick play; the house glossary's lower-wick version is a different setup [section 5].
- Buying day 1 itself (the wick day) instead of waiting for the hold [originator: the hold is the signal].
- Buying when day 2 has traded well into the body [Deepvue; TaPlot].
- Buying a laggard: "Not every wick play is buyable." [TaPlot]
- Chasing a day-3 gap far past the trigger [C28]; buying a stock stretched far over its 10-day [C29].
- Moving the stop under day 1's low to give it room [A4, A13].

### 8.9 Example bank to model (candidates for the owner to pick from; checked on the bars)
The strict cases came out of my scan (4.3) among well-known leaders that passed its filters; the same-day cases are the
ones Kell and the owner named. Each line uses the house trade: market order on the cross, stop a cent under day 2's
low, outcome = 3R or the stop first. Winners and losers are both listed on purpose; they are not a random sample.

| # | Stock, day 2 | Form | Entry, stop, risk | Outcome | Teaching point |
|---|---|---|---|---|---|
| 1 | NVDA 2021-10-28 | strict | 25.00 (day 3 opened over the 24.96 trigger), 24.51, 1.95% | 3R on 2021-11-02; 20-session high 19.8R | a leader in the wick, tight stop (split-adjusted prices) |
| 2 | SBUX 2019-03-14 | strict | 70.90, 70.18, 1.02% | 3R on 2019-03-26 | a quiet, tight wick day |
| 3 | APPS 2020-10-05 | strict | 35.98, 34.74, 3.45% | 3R on 2020-10-13 | the stock Kell later used in his 2021 post |
| 4 | MRNA 2020-10-05 | strict | 72.03, 69.04, 4.15% | 3R on 2020-10-13 | works with a wider stop; size down (A5) |
| 5 | XPEV 2025-07-14 | strict | 18.00 (opened 1.5% over the trigger), 17.41, 3.25% | 3R on 2025-08-08 | a small gap over the trigger is still inside C28 |
| 6 | SHOP 2024-02-09 | strict | 91.40, 88.91, 2.72% | gapped through the stop on earnings, 2024-02-13 | why B22 matters: no new buys in the 3 days before a report |
| 7 | AXON 2023-01-31 | strict | 197.16 (opened 0.8% over), 191.79, 2.72% | stopped 2023-02-07, then rose to 4.5R within 20 sessions | a stop is a stop (A4); a re-entry needs a new setup (B21) |
| 8 | APPS 2021-03-11 | same-day (Kell) | 83.31, under day 2's low 78.59, 5.7% | stopped 2021-03-16 | on this stop rule, Kell's own example failed within a week (his post gives no stop) |
| 9 | MXL 2026-04-29 | same-day (owner) | 56.08, 54.43, 2.9% | 3R on 2026-04-30 | the owner's "wick play and blast"; fails C29 today |
| 10 | FIG 2025-10-07 | same-day (owner's desk log) | 61.76, 58.77, 4.8% | 3R on 2025-10-08; then fell to 43.80 within 20 sessions | take the trims (B19); no 200-day yet |
| 11 | GOOG 2023-05-12 | loose (Kell) | not a strict or same-day trigger | high 9.9% over day 2's close within 20 sessions | Kell's tolerance for "a little" inside the body |

For the same-day cases (8 to 10) the stop assumes day 2's low printed before the break; daily bars cannot confirm it.

---

## 9. Grading: what makes it an A+ versus a B-

The owner says grading is his judgment (E50: "It is discretionary and hard to define."). These are observable cues from
the sources, offered as a guide, not a checklist.

| Cue | A+ | B- |
|---|---|---|
| Stock | a true leader, RS 90+, in the strongest group (TaPlot; C31) | RS near 80, group not leading |
| Prior move | a fresh explosion: gaps, big volume, a breakout in the last few weeks (Kell's thread; not confirmed in 4.3) | a slow drift, no recent catalyst |
| Day 2 | entirely inside the wick, a narrow range (Deepvue; TaPlot) | dipped into the body ("a little", Kell GOOG) |
| Wick | a clear upper wick, a quarter of day 1's range or more [my proposal] | a tiny wick |
| Volume | day 2 quieter than day 1 [my proposal; no measured difference in 4.3] | day 2 heavy and red |
| Stop | within 3% (A13) | wider, size cut to fit |
| Stretch | close to the 10-day and 21-day averages | near the C29 limit |
| Market | Green (F65) | Yellow |
| Calendar | no earnings within the hold window | earnings within a couple of weeks |
| Higher timeframe | weekly and monthly charts set up (Kell: "best if MONTHLY is set up") | weekly overhead supply |

---

## 10. Questions for the owner

1. **Which form is ours?** (a) strict: day 2 wholly inside day 1's upper wick, buy day 3 over day 2's high (Deepvue,
   TaPlot); (b) same-day: open in the wick and buy the push over day 1's high (Kell's APPS, your "gap up wick play
   with immediate push"); (c) both, as two entries of one setup. My recommendation is (c), in the order given in 8.2.
2. **The trigger** for the same-day form: over day 1's high, or the 30-minute opening-range break (as you ruled for the
   Kicker)?
3. **The stop:** under day 2's low (strict), under the day's low at the buy, or under day 1's body top?
4. **Touching the body:** none (Deepvue), or "a little" as Kell allowed on GOOG? If a little, how much (for example 0.25
   ATR)?
5. **Minimum wick on day 1:** none, or a quarter of the range (my proposal)?
6. **Volume:** require day 2 quieter than day 1, prefer it, or ignore it?
7. **Weekly wick plays** (Manrav's UMC): part of the setup, or daily only?
8. **C29 conflict:** your MXL "wick play and blast" sat about 41% over its 10-day. Keep C29 as is (skip those), or make an
   exception right after an EP or a gap?
9. **Journal family:** move the tag from "Reversals & Reclaims" to "Momentum & Trend"?
10. **Short mirror:** teach it (8.6) or leave the setup long-only?
11. **House fixes:** replace the glossary entry in `definitions.json`, and remove or replace the unverified Kell line in
    `quotes.json`?
12. **New listings** with no 200-day (FIG): allowed under E53, or wait for a 200-day?
13. **Model examples:** which of the eleven candidates in 8.9 go into the course, and do you have your own wick plays
    (with dates) to add? Keep at least one loser (SHOP or AXON) so members see the stop and the earnings rule at work?
14. **Intraday check:** the same-day form's stop cannot be tested on daily bars (4.3, item 5). Measure it on 30-minute
    bars before it goes into a scanner, a drill or Hard mode, or ship it as a judgment entry with no measured claim?

---

## 11. Sources

All read on 2026-11-09 unless marked. Reliability: **originator** = Kell's own words; **educator/data** = established
educator or data provider; **secondary** = a third party's description; **house** = UCT.

| Source | URL | Publisher, author, date | Read how | Reliability |
|---|---|---|---|---|
| Kell, X post on APPS | https://x.com/OliverKell_/status/1370036572654071809 | X; Oliver Kell; 2021-03-11 | X oEmbed endpoint | originator |
| Kell, X thread on favourite setups (4 posts quoted) | https://x.com/OliverKell_/status/1401517950771867648 (and 1401519363111411713, 1401519844906909700, 1401522073353297921) | X; Oliver Kell; 2021-06-06 | X oEmbed endpoint | originator |
| Thread Reader App copy of the same thread | https://threadreaderapp.com/thread/1401517596751585285.html | Thread Reader App | curl; used only to find post IDs | secondary (not quoted) |
| Kell, "Some Things for Next Week...." | https://weeklieswatch.substack.com/p/some-things-for-next-week | The Weeklies Watch (Substack); Oliver Kell; 2023-05-13 | Substack post API; all 33 posts in the sitemap (all public) checked for "wick"; the about page names Kell as the author | originator |
| TraderLion, Kell masterclass outline | https://traderlion.com/courses/swing-trading-masterclass-with-oliver-kell/ | TraderLion; page as of the 2025-02-14 snapshot | Wayback copy (2025-02-14) saved earlier in this workflow; live page HTTP 403 | educator (topic names only) |
| TraderLion, "Anatomy Of A Trade: MU +20% Wedge Pop" | https://traderlion.com/profile/oliver-kell/mu-wedge-pop/ | TraderLion; under Oliver Kell's profile; 2024-09-13 | Wayback copy (2025-02-11) saved earlier in this workflow | educator |
| TraderLion, Kell masterclass slides, Session 3 | https://traderlion.com/wp-content/uploads/sites/2/2021/11/Oliver-Masterclass-Slides-Session-3-FINAL-Pres-11-13.pdf | TraderLion; Oliver Kell; 2021 | **not read** (HTTP 403) | n/a |
| Deepvue Knowledge Base, "Technicals" | https://docs.deepvue.com/articles/technical | Deepvue; published 2024-09-03, modified 2026-06-19 | curl | data provider (definitions only) |
| TaPlot, "TAPLOT Wick Play" | https://www.tradingview.com/script/TGp7b78L-TAPLOT-Wick-Play/ | TradingView; user TaPlot; 2021-12-17 | curl; script settings through TradingView's script service | secondary (credits Kell) |
| StockCharts ChartSchool, "Introduction to Candlesticks" | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/introduction-to-candlesticks | StockCharts; no author shown | fetch tool and curl | educator |
| Bulkowski, "Shooting Star" | https://thepatternsite.com/ShootingStar.html | ThePatternSite; Thomas Bulkowski | fetch tool (AI notice on the site) | measured statistics |
| Bulkowski, "Inside Days" | https://thepatternsite.com/InsideDays.html | ThePatternSite; Thomas Bulkowski | fetch tool (AI notice on the site) | measured statistics |
| Goodreads, Kell's ebook page | https://www.goodreads.com/book/show/58295305-victory-in-stock-trading | Goodreads | via an earlier dossier's saved copy | listing only; book not read |
| UCT, Sunday Scans (OPEN, TSDR section) | https://unchartedterritoryy.substack.com/p/sunday-scans-6ef | Uncharted Territory; 2025-10-05 | Substack post API; 101 of the 103 sitemap posts read in full and searched (one placeholder, one paid-only) | house |
| UCT, The Rest of the Week (UMC, Manrav) | https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481 | Uncharted Territory; 2025-10-21 ET | Substack post API | house |
| UCT, Sunday Scans (Kell's cycle credit) | https://unchartedterritoryy.substack.com/p/sunday-scans-d70 | Uncharted Territory; 2025-06-29 | Substack post API | house |
| Repo KB extracts (desk logs; paraphrased) | `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json` | UCT brain, snapshot 2026-11-06 | local file | house (summaries, not re-checked in Discord) |
| House code and texts | `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `app/src/pages/modelbook/setupCatalog.js`, `docs/study/research/definitions.json`, `app/src/constants/quotes.json`, `app/src/components/chart/engine/ast/starterScans.json`, `api/services/starter_library.py`, `docs/superpowers/research/setups/setup_criteria.json`, `api/services/pattern_engine/detectors/uct/uct_inside_day.py`, `.../candlestick/hammer.py`, `docs/study/UNITS-method.md` | this repo | local files | house |
| App daily bar store | sandbox copy of `bars.db` (4,208 tickers, daily, 1984 to 2026-11-09) | UCT app data | read-only SQLite | data (survivorship limits in 4.3) |
| Account rulebook | `docs/study/sizing_rule.md` section 9; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | the owner, 2026-11-09 | local files | house rules |
