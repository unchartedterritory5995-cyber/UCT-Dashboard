# Setup 37: Wick Play (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09; cold-checked the same day by a second
agent, and cold-checked a second time the same evening by a third agent (every quote re-opened at its source, every
bar number re-read from the store, the measurement script re-run; corrections from both checks are listed in
"Removed in checking" at the end, the second check's under 12.B). Every quote below was copied from the page,
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
   described it in public by December 2020, in a reply on X: "When price opens up inside the wick of the previous
   days bar. If it can hold positive, staying in the wick, its a sign of strength." (2020-12-11.) And in March 2021:
   "Everyone ask about wick play....great example today is APPS...open in the wick, pulled back some,based intra and
   now holding in the wick...sign of strength." A strong stock closes off its high, leaving an upper wick. The next
   day opens inside that wick and holds there, never trading back into day 1's body. You buy when it breaks out.
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
   My own run on the app's bars (4.3): strict wick plays are rare (about 54 a year across some 4,200 stocks) and did not
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

**The originator's one-line test.** Kell: "If it can hold positive, staying in the wick, its a sign of strength." (X,
2020-12-11.) And: "open in the wick, pulled back some,based intra and now holding in the wick...sign of strength." (X,
2021-03-11; section 3.1.)

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
- **Kell on X, 2020-12-11** (found in checking; verified through X's own oEmbed endpoint, author "Oliver Kell
  (@OliverKell_)"): "When price opens up inside the wick of the previous days bar. If it can hold positive, staying in
  the wick, its a sign of strength." (https://x.com/OliverKell_/status/1337196991051337728). It is a reply to another
  user; the reply itself does not contain the words "wick play", so the question it answers (which I could not read)
  presumably named it. This is the earliest dated description of the setup in his own words that I found.
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
  this workflow saved, and re-read from the Wayback Machine in checking; the live page returns HTTP 403 to my client
  and the lessons are behind the $797 course). I did not read the lessons. In checking, a web search surfaced the two
  lesson pages by title, "The Wick Play | Trading Lesson" (https://traderlion.com/?p=418838) and "In the Wick | Trading
  Lesson" (https://traderlion.com/?p=418840), and the Wayback Machine lists a capture of
  https://traderlion.com/lesson/wick-play/ dated 2025-08-27. Both live pages return HTTP 403, and the lesson is paid
  course content, so the checker did not read the archived copy either. A search engine's summary of the lesson said it
  describes an inside bar trading within the wick on low volume, a breakout over the wick high as the trigger, and a
  bearish mirror (a downside wick, then an inside bar, then a break of the wick low). **That is a search engine's
  paraphrase, unverified; no wording from it is used here.** If the owner wants it, the lesson is the thing to buy and read.
- **TraderLion's 2021 masterclass slides**, "Session 3" (https://traderlion.com/wp-content/uploads/sites/2/2021/11/Oliver-Masterclass-Slides-Session-3-FINAL-Pres-11-13.pdf).
  HTTP 403 to both my fetch tool and curl. **I did not read them.** A web-search result summary said they describe the
  setup and a volume dry-up; that is a search engine's paraphrase, unverified, and I use no wording from it.
- **TaPlot, TradingView script "TAPLOT Wick Play"** (published 2021-12-17): "Wick play is a candle stick long setup
  popularized by 2020 US Investing Champion Oliver Kell" (https://www.tradingview.com/script/TGp7b78L-TAPLOT-Wick-Play/).
- **Kell's ebook**, *Victory in Stock Trading: Strategy and Tactics of the 2020 U.S. Investing Champion* (Goodreads,
  re-read in checking: "80 pages, ebook", "Published January 1, 2021", author Oliver Kell). **Not read.** A web search
  in checking returned an unofficial PDF upload of the book whose search summary says it describes the wick play; the
  checker did not open that copy (it is not the publisher's), so whether and how the book covers the setup stays
  unverified. If the owner wants the book's wording, buy the ebook.

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
- **The definition (2020-12-11, a reply):** "When price opens up inside the wick of the previous days bar. If it can
  hold positive, staying in the wick, its a sign of strength." Two conditions: the open is inside the prior day's
  wick, and the day holds "positive" (which reads as up on the day) while "staying in the wick". No trigger, no stop.
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
- **What he does not say on X:** no stop, no target, no minimum wick, no volume number, and (in these posts) no
  "strong stock" wording: the leader context comes from his explosion-contraction-continuation frame and from TaPlot.

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
  dated 2025-02-11 saved earlier in this workflow and re-read from the Wayback Machine in checking;
  https://traderlion.com/profile/oliver-kell/mu-wedge-pop/). The page's author field reads "Oliver Kell", but the text
  speaks of him in the third person ("Oliver staggered his stops"), so I treat the wording as TraderLion's write-up of
  his trade, not his own words. The page does not use the word "leader"; its context sentences are "MU made Oliver
  Kell’s focus after it gapped up 18% in reaction to its first positive earnings report in over a year." and "This
  strong action pushed MU into new all-time highs." (second check):
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
  inputs are "Bar Color", "Wick Play Indicator Color", "Paint Bar?" and "Show Wick Play?". The page labels it an
  "OPEN-SOURCE SCRIPT", so its Pine source is viewable on TradingView's "Source code" tab; the script service returned
  only the compiled form and the fetch tools do not render that tab, so the exact test was not read here (second
  check: the earlier wording "the code itself is compiled" was corrected). The description implies Deepvue's strict
  form plus the day-3 trigger.
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
- The writer's web search budget ran out after one search. **The checker ran three more** ("wick play" with Kell's
  name; Kell with "wick play" or "in the wick"; TraderLion with "wick play"). They surfaced Kell's 2020-12-11 reply
  (section 3.1, verified on X), the titles and URLs of TraderLion's two lesson pages and the 2021 slides (section 2;
  HTTP 403, not read), and an unofficial copy of Kell's ebook (not opened). No other originator, no other trader's
  definition and no statistics turned up. Still not exhaustive: no video search was done.

### 3.9 Comparison table

| Item | Kell (X, Substack) | TaPlot | Deepvue "Wick Play" | Deepvue "In the Wick" | TraderLion MU review | UCT (owner, Manrav) |
|---|---|---|---|---|---|---|
| Stock | after an "explosion" (gaps, volume), on the contraction (his thread; he does not say "strong stock") | "Strong stock with momentum"; "True Market Leaders" | none | none | "strong action" into "new all-time highs" after an 18% earnings gap (the page does not say "leader") | leaders and themes |
| Day 1 | closes off the high (implied) | "closes off the highs" | any candle with room above its body | any | a red day with a wick | not stated |
| Day 2 open | "opens up inside the wick of the previous days bar" (2020); "open in the wick" (2021) | "opens in the candle \"wick\"" | implied (whole day in the wick) | below day 1's high, above the body | in the wick | "gap up" (owner) |
| Day 2 low | "hold positive, staying in the wick"; "a little" into the body allowed (GOOG) | never into the body | above the body top | never under the body top | dipped under the body top | not stated |
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
  the time". "Overall performance rank: 55", and the page says "All ranks are out of 103 candlestick patterns with the
  top performer ranking 1." (checked). What it
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

**Data.** A sandbox copy of the app's daily bar store: 4,208 tickers when the writer ran the script (the loop's own
count). **It holds only stocks that still trade** (for example SIVB, TWTR and CELG are absent), so failed companies are
missing and every number below leans optimistic. Signals from 2000-01-01 to 2026-09-30. Second check (the same
evening): the store then held 4,284 tickers with daily bars (3,944 with the 300 bars the script needs), so the store
grew between the runs; the first checker's re-run log stops at ticker 4,000 and left no output file, so that re-run
did not finish. The second checker started a fresh run on the 4,284-ticker store (scratch folder
`setups/37-wick-play/check2/`); it had reached ticker 3,400 when the check closed, so no re-run figures exist yet.
The table below is the writer's run, and every number in it and in items 1 to 10 was re-derived by the second checker
from the writer's own output files (`out/analysis.txt`, `out/explosion.txt`): all matched, including the optimistic
column, which is the trade-weighted combination of the "amb dropped" rows.

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
| MU 2024-05-02 | TraderLion, on Kell's trade | opened in the wick, dipped under the body top, closed in the wick; bought on 05-03's gap | high of 133.30 within 20 sessions, +18.7% over day 2's close (+15.9% over the 05-03 open of 115.03) | fits |
| OPEN 2025-10-06 | the owner's scenario (Sunday Scans) | opened in the wick, 6 cents into the body, broke 8.83, closed +14.4% | bought over 8.83: stopped by 10-10 (any of the three stops) | B23 fails (about $8 to $9) |
| FIG 2025-10-07 | the owner (desk log, paraphrased) | opened in the wick, held above the body, broke 61.75, closed back at 60.84 | with a stop under day 2's low (4.8%): 3R the next day. Under the body top (7.8%) or day 1's low (17.3%): stopped later in October | no 200-day (listed 2025-07-31) |
| FIG 2025-10-08 | (the next day; bars only) | opened in 10-07's wick, held above its body, closed +16.8% | stop under day 2's low (2.6%): 3R the next session; under the body top: stopped 10-10 | 12.5% over the 10-day: C29 fails |
| MXL 2026-04-29 | the owner (KB summary) | opened in the wick, held above the body, broke 56.07, closed +29.8% | on daily bars 3R printed on the entry day itself with a stop under day 2's low (2.9%) or under the body top (7.3%), and on 05-01 with a stop under day 1's low (11.6%); high of 106.28 within 20 sessions | about 41% over the 10-day: C29 fails |
| UMC, weekly, October 2025 | Manrav | the 7.66 trigger is the 2025-10-13 daily high; on weekly bars built from the store's daily bars (the store holds no weekly UMC bars) I could not reproduce "inside the wick" exactly | not checked | B23 fails (about $7.50) |

What the examples teach: in the five same-day cases (APPS, OPEN, FIG twice, MXL) the long wick makes a stop under day
1's body top or low wide: 4.0% to 17.3% from a buy at the top of the wick (second check, re-read from the bars:
body-top stops 4.0% (FIG 10-08, whose day 1 was red, so the body top is the 61.60 open), 7.3%, 7.8%, 8.4% and 8.9%;
day-1-low stops 8.4% to 17.3%). A stop under day 2's own low was 2.6% to 9.0%
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
  **Disagrees with every source:** Kell, TaPlot and the owner use it as a continuation in a strong uptrend (TaPlot:
  "Strong stock with momentum to the upside"; Kell: "an EXPLOSION, a CONTRACTION, then...a CONTINUATION"), which belongs
  with "Momentum & Trend". No direction is stored.
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
  dash) by "it is a precise rejection with a built-in stop. That tight stop enables oversized position size." I found
  this wording in no Kell post, Substack post, TraderLion page or Deepvue page, and nowhere else in the repo's source
  files (only the built bundle under `app/dist/` repeats it). It describes a rejection at a level (closer to a hammer),
  not Kell's hold inside an upper wick. It was added in commit `367bbcf292` (2026-08-22; checked in `git log`). **Unverified; recommend removing it or replacing it with
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
one is a placeholder page and one (sunday-scans-bf1, 2026-10-18) is marked subscribers-only, with a 370-character
preview as its only public text, so I could not read it. "Wick"
appears 65 times: lower wick or lower wicks 39 times, upper wick or upper wicks 13 times, and the exact phrase "wick play" twice: once in
TSDR's section (TSDR is the owner, as the earlier dossiers establish) and once in Manrav's. Dates are the post's
publish time in US Eastern.

### 6.1 The owner in public
- OPEN, Sunday Scans of 2025-10-05, under the heading "TSDR’s Weekly Outlook & Watchlist", then "Some great charts
  below that I am watching.", then the subheading "Charts Covered - CRWV POET AAOI CRCL OPEN SLDP SNOW" (the heading
  order as the post's own HTML has it, checked): "OPEN (Daily) Tried Friday, didn’t get the strong close and follow through I was
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
  - Bars (weekly bars built from the store's daily bars; the store holds no weekly UMC bars): the week ending
    2025-10-10 opened 7.26, reached 7.57 and closed 7.18 (a red week with a wick from 7.26 to 7.57). The 7.66 trigger
    is the 2025-10-13 daily high. The following weeks did not stay strictly inside that wick (the week of 10-13
    reached 7.66; the week of 10-20 reached 7.61), so I cannot reproduce his weekly reading exactly; his data
    vendor's weekly bars may differ. UMC traded near $7.50, under B23's $10 floor.
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
| C31 RS 80+ leaders | fits | TaPlot's "Strong stock with momentum" and "True Market Leaders", and Kell's "Find explosions...then execute on the contraction", point the same way |
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
- **Stock:** a leader: RS rating 80 or more, in a strong group [house rule C31]. The strong-stock context is TaPlot's
  ("Strong stock with momentum to the upside"; "True Market Leaders"), TraderLion's MU review ("This strong action
  pushed MU into new all-time highs." after an 18% earnings gap; the page does not use the word "leader") and Kell's
  own frame, an "explosion" first [source consensus on a strong stock in an uptrend: TaPlot, TraderLion, Kell's
  thread; the word "leader" is TaPlot's alone]. The RS 80 number is the house's, not any source's.
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
- **Option A, strict (TaPlot):** on day 3, buy at market as soon as price trades a cent over day 2's high [TaPlot, who
  credits Kell but whose day-3 trigger is his own wording; house rule E57]. If day 3 opens more than 4% over the
  trigger, skip [C28].
- **Option B, same-day push (Kell APPS; Kell 2020: "hold positive, staying in the wick"; the owner's "gap up wick play
  with immediate push"):** on day 2, buy at market as soon as price trades over day 1's high, provided day 2 opened
  inside the wick and has not traded into day 1's body [originator; UCT]. The trigger (day 1's high) is the owner's
  "push" and the bars of Kell's APPS example; Kell did not state a trigger in words.
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
No source I could read defines a bearish wick play. (A search engine's summary of TraderLion's paid Wick Play lesson
says the pattern "also works in reverse"; the lesson itself is HTTP 403 and was not read, so that stays unverified;
section 2.) By D47 ("Shorts are the same just reversed for almost all our setupstuff") the
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
| 1 | NVDA 2021-10-28 | strict | 25.00 (day 3 opened over the 24.96 trigger), 24.51, 1.96% | 3R on 2021-11-02; 20-session high 34.65, about 19.6R | a leader in the wick, tight stop (split-adjusted prices) |
| 2 | SBUX 2019-03-14 | strict | 70.90, 70.18, 1.02% | 3R on 2019-03-26 | a quiet, tight wick day |
| 3 | APPS 2020-10-05 | strict | 35.98, 34.74, 3.45% | 3R on 2020-10-13 | the stock Kell later used in his 2021 post |
| 4 | MRNA 2020-10-05 | strict | 72.03, 69.04, 4.15% | 3R on 2020-10-13 | works with a wider stop; size down (A5) |
| 5 | XPEV 2025-07-14 | strict | 18.00 (opened 1.5% over the 17.74 trigger), 17.41, 3.3% | 3R on 2025-08-08 | a small gap over the trigger is still inside C28 |
| 6 | SHOP 2024-02-09 | strict | 91.40, 88.91, 2.72% | gapped through the stop on earnings, 2024-02-13 | why B22 matters: no new buys in the 3 days before a report |
| 7 | AXON 2023-01-31 | strict | 197.16 (opened 0.8% over), 191.79, 2.72% | stopped 2023-02-07, then rose to 4.5R within 20 sessions | a stop is a stop (A4); a re-entry needs a new setup (B21) |
| 8 | APPS 2021-03-11 | same-day (Kell) | 83.31, under day 2's low 78.59, 5.7% | stopped 2021-03-16 | on this stop rule, Kell's own example failed within a week (his post gives no stop) |
| 9 | MXL 2026-04-29 | same-day (owner) | 56.08, 54.43, 2.9% | 3R on 2026-04-29 itself (the day's high was 71.28; daily bars cannot order the low and the break) | the owner's "wick play and blast"; fails C29 today |
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
| Kell, X reply defining the hold (added in checking) | https://x.com/OliverKell_/status/1337196991051337728 | X; Oliver Kell; 2020-12-11 | X oEmbed endpoint | originator |
| Kell, X post on APPS | https://x.com/OliverKell_/status/1370036572654071809 | X; Oliver Kell; 2021-03-11 | X oEmbed endpoint | originator |
| Kell, X thread on favourite setups (4 posts quoted) | https://x.com/OliverKell_/status/1401517950771867648 (and 1401519363111411713, 1401519844906909700, 1401522073353297921) | X; Oliver Kell; 2021-06-06 | X oEmbed endpoint | originator |
| Thread Reader App copy of the same thread | https://threadreaderapp.com/thread/1401517596751585285.html | Thread Reader App | curl; used only to find post IDs | secondary (not quoted) |
| Kell, "Some Things for Next Week...." | https://weeklieswatch.substack.com/p/some-things-for-next-week | The Weeklies Watch (Substack); Oliver Kell; 2023-05-13 | Substack post API; all 33 posts in the sitemap (all public) checked for "wick", by the writer and again by the checker (one hit, this one); the post's byline and the about page name Kell as the author | originator |
| TraderLion, Kell masterclass outline | https://traderlion.com/courses/swing-trading-masterclass-with-oliver-kell/ | TraderLion; page as of the 2025-02-14 snapshot | Wayback copy (2025-02-14) saved earlier in this workflow; live page HTTP 403 | educator (topic names only) |
| TraderLion, "Anatomy Of A Trade: MU +20% Wedge Pop" | https://traderlion.com/profile/oliver-kell/mu-wedge-pop/ | TraderLion; under Oliver Kell's profile; 2024-09-13 | Wayback copy (2025-02-11) saved earlier in this workflow | educator |
| TraderLion, Kell masterclass slides, Session 3 | https://traderlion.com/wp-content/uploads/sites/2/2021/11/Oliver-Masterclass-Slides-Session-3-FINAL-Pres-11-13.pdf | TraderLion; Oliver Kell; 2021 | **not read** (HTTP 403; no Wayback capture) | n/a |
| TraderLion, "The Wick Play" and "In the Wick" lesson pages (found in checking) | https://traderlion.com/?p=418838 ; https://traderlion.com/?p=418840 ; https://traderlion.com/lesson/wick-play/ | TraderLion; paid course lessons | **not read** (HTTP 403; the 2025-08-27 Wayback capture of the lesson is paid content and was left unread); titles only, from search results. The Wayback-capture claims here and for the slides are the first checker's; the second checker's tools were not permitted to query the archive index, so they were not re-checked | n/a |
| Deepvue Knowledge Base, "Technicals" | https://docs.deepvue.com/articles/technical | Deepvue; published 2024-09-03, modified 2026-06-19 | curl | data provider (definitions only) |
| TaPlot, "TAPLOT Wick Play" | https://www.tradingview.com/script/TGp7b78L-TAPLOT-Wick-Play/ | TradingView; user TaPlot; 2021-12-17 | curl; script settings through TradingView's script service (an open-source script; its Pine source was not rendered by the tools, so not read) | secondary (credits Kell) |
| StockCharts ChartSchool, "Introduction to Candlesticks" | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/introduction-to-candlesticks | StockCharts; no author shown | fetch tool and curl | educator |
| Bulkowski, "Shooting Star" | https://thepatternsite.com/ShootingStar.html | ThePatternSite; Thomas Bulkowski | fetch tool (AI notice on the site) | measured statistics |
| Bulkowski, "Inside Days" | https://thepatternsite.com/InsideDays.html | ThePatternSite; Thomas Bulkowski | fetch tool (AI notice on the site) | measured statistics |
| Goodreads, Kell's ebook page | https://www.goodreads.com/book/show/58295305-victory-in-stock-trading | Goodreads | via an earlier dossier's saved copy; re-read live in checking ("80 pages, ebook", "Published January 1, 2021") | listing only; book not read |
| UCT, Sunday Scans (OPEN, TSDR section) | https://unchartedterritoryy.substack.com/p/sunday-scans-6ef | Uncharted Territory; 2025-10-05 | Substack post API; 101 of the 103 sitemap posts read in full and searched (one placeholder, one paid-only) | house |
| UCT, The Rest of the Week (UMC, Manrav) | https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481 | Uncharted Territory; 2025-10-21 ET | Substack post API | house |
| UCT, Sunday Scans (Kell's cycle credit) | https://unchartedterritoryy.substack.com/p/sunday-scans-d70 | Uncharted Territory; 2025-06-29 | Substack post API | house |
| Repo KB extracts (desk logs; paraphrased) | `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json` | UCT brain, snapshot 2026-11-06 | local file | house (summaries, not re-checked in Discord) |
| House code and texts | `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `app/src/pages/modelbook/setupCatalog.js`, `docs/study/research/definitions.json`, `app/src/constants/quotes.json`, `app/src/components/chart/engine/ast/starterScans.json`, `api/services/starter_library.py`, `docs/superpowers/research/setups/setup_criteria.json`, `api/services/pattern_engine/detectors/uct/uct_inside_day.py`, `.../candlestick/hammer.py`, `docs/study/UNITS-method.md` | this repo | local files | house |
| App daily bar store | sandbox copy of `bars.db` (4,208 tickers at the writer's run, 4,284 at the second check; daily, 1984 to 2026-11-09) | UCT app data | read-only SQLite | data (survivorship limits in 4.3) |
| Account rulebook | `docs/study/sizing_rule.md` section 9; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | the owner, 2026-11-09 | local files | house rules |

---

## 12. Removed in checking

Cold check, 2026-11-09, by a second agent. Method: every quote re-opened at its source (X's oEmbed endpoint for the
six Kell posts; Substack's post API for Kell's 33 posts and UCT's 103; curl for Deepvue, TradingView, StockCharts,
Bulkowski, Goodreads; the Wayback Machine for the two TraderLion pages); every bar number re-read from the sandbox
store; the measurement script re-run from scratch into a separate folder; every rulebook ID read in
`sizing_rule.md` section 9; every house file opened. Nothing was removed outright; these were corrected or added:

1. **Added the originator's earliest definition.** Kell's X reply of 2020-12-11 ("When price opens up inside the wick of
   the previous days bar. If it can hold positive, staying in the wick, its a sign of strength."). The dossier had
   dated his first public use to March 2021.
2. **Misattribution fixed.** "Strong stock" was credited to Kell in 3.9, 7 and 8.1. It is TaPlot's wording; Kell's posts
   say "explosion", "contraction", "continuation", "sign of strength". The [source consensus] tag on the leader rule now
   rests on TaPlot and TraderLion's MU review, with Kell by implication.
3. **Basis tag fixed.** 8.2 Option A carried "[originator via TaPlot]". The day-3 trigger is TaPlot's wording, not Kell's;
   the tag now reads [TaPlot; house rule E57].
4. **Bulkowski's rank denominator added.** "Overall performance rank: 55" is out of 103 candlestick patterns, which the
   page states; the dossier said the writer had not read it.
5. **Bar-number corrections.** MXL 2026-04-29: 3R printed on the entry day on daily bars (not 2026-04-30; and under the
   day-1-low stop on 05-01, not "within 1 to 2 sessions"). NVDA: stop 1.96% and about 19.6R (not 1.95% and 19.8R).
   XPEV: 3.3% (not 3.25%). Same-day cases: the wide stops ran 5.2% to 17.3%, not 4.0% to 17.3% **(this one was itself
   wrong; the second check restored the writer's 4.0%, see 12.B item 1)**. UMC: the store holds no
   weekly UMC bars; the weekly figures are built from its daily bars (said so now).
6. **Heading order fixed** for the OPEN quote (6.1): it sits under "Charts Covered - CRWV POET AAOI CRCL OPEN SLDP
   SNOW", below "Some great charts below that I am watching.", under TSDR's heading.
7. **The quotes.json line** is quoted in full now (a third sentence, "That tight stop enables oversized position size.",
   was left off), and "nowhere else in the repo" narrowed to the source files (the built bundle repeats it).
8. **Search gap closed in part** (3.8): the writer's single search is now three; they found the 2020 post, the titles of
   TraderLion's two lesson pages, and an unofficial copy of Kell's ebook (not opened). The lessons are still unread.
9. **Measurement run** (4.3): see the note added there on the re-run and the ticker count.

Verified unchanged (a sample of what was checked): all five 2021 Kell posts word for word; Kell's GOOG line and that it
is the only "wick" in his 33 posts; both Deepvue definitions and the page dates; TaPlot's four rules, context lines,
date (2021-12-17), signature and the four input names; StockCharts' shadow sentence; Bulkowski's shooting-star and
inside-day figures and his AI notice; the TraderLion course topics, the MU review quotes and the 941% line; the three
UCT quotes and their dates; the UCT counts (103 posts, one paid, 65 "wick", 39 lower, 13 upper, 2 "wick play"); the
KB summaries 10208, 10213, 12545 and 12666; the APPS, GOOG, MU, OPEN, FIG and MXL bars; the seven strict examples in
8.9 (all strict on the bars, entries, stops and outcomes as stated); the rulebook IDs A3, A4, A5, A13, B18 to B23,
B26, C28, C29, C31, C33, D42, D47, D48, E50 to E53, E57, F62, F63, F65; `uct_inside_day.py` (stack rule, 0.7 ATR,
entry high, stop low, admin-only), `hammer.py` (lower wick at least twice the body, reversal gate), `uct_go_signal.py`
(open under the prior close, sweep, 40% lower wick), `setupGroups.js`, `setupTagMap.js`, `definitions.json`,
`quotes.json` and its commit, `starterScans.json`, `starter_library.py`, `setup_criteria.json`, `UNITS-method.md`,
`setup-vocabulary-v1.json`.

### 12.B Second cold check (2026-11-09, evening, a third agent)

Method: every quote re-opened at its source by this checker's own tools (X's oEmbed endpoint for the six Kell posts;
Substack's post API for Kell's GOOG post and for the three UCT posts; curl for Deepvue (page text and its
`datePublished` / `dateModified` metadata), TradingView, the two Wayback copies of TraderLion's course page and MU
review, and the Thread Reader copy; the fetch tool for StockCharts, both Bulkowski pages and Goodreads); every bar
number in sections 3, 4.4, 6 and 8.9 re-read from the sandbox store with a fresh script; every rulebook ID re-read in
`sizing_rule.md` section 9; the owner-verdict file searched (no wick ruling in it); every house file and detector
re-opened; the KB entries 10208, 10213, 12545 and 12666 re-read. Corrected:

1. **The first check's stop-range "correction" was wrong.** 4.4 said the same-day cases' wide stops ran "5.2% to 17.3%"
   and the body-top stops "5.2% to 8.9%". On the bars the FIG 2025-10-08 case's day 1 (10-07) was a red candle, so its
   body top is the 61.60 open, the stop 61.59 and the distance from a 64.18 buy 4.0%; the 5.2% used the 60.84 close
   instead, the very error 5.3 flags in `setup_criteria.json`. Restored to 4.0% to 17.3% (body-top stops 4.0%, 7.3%,
   7.8%, 8.4%, 8.9%).
2. **TaPlot's script is open-source, not "compiled".** TradingView labels it "OPEN-SOURCE SCRIPT"; what the script
   service returned to the writer was the compiled form. The source is viewable on TradingView's "Source code" tab,
   which these tools do not render, so the exact test is still unread. Wording fixed in 3.5 and the sources table.
3. **TraderLion's MU review never says "leader".** Its context lines are "MU made Oliver Kell’s focus after it gapped
   up 18% ..." and "This strong action pushed MU into new all-time highs." The [source consensus] tag on the 8.1 Stock
   rule now rests on "a strong stock in an uptrend" (TaPlot, TraderLion, Kell's thread) and says the word "leader" is
   TaPlot's alone; 3.3 and 3.9 carry the exact lines.
4. **MU's "+18.7%"** is over day 2's close (112.33); over the 05-03 open it is +15.9%. Said so in 4.4.
5. **Ticker count.** The store held 4,284 tickers with daily bars at this check (3,944 with the 300 bars the script
   needs); 4,208 was the writer's count. The first checker's "re-run" log stops at ticker 4,000 with no output file,
   so the header's "measurement script re-run" was not substantiated; this checker's own run was still in progress
   (ticker 3,400 of 4,284) when the step closed. Noted in 4.3 and the sources table.
6. **sunday-scans-bf1** is marked `only_subscribers` with a 370-character public preview (post date 2026-10-18); 6 said
   "paid subscribers only". Reworded.

Verified unchanged by this checker: all six Kell posts word for word, with author "Oliver Kell (@OliverKell_)" and
dates 2020-12-11, 2021-03-11 and 2021-06-06; the 2020 reply has no "wick play" in it; Thread Reader's copy shows
@1charts6; Kell's GOOG line, the post date 2023-05-13, the "Oliver Kell" byline, the about page's "from the 2020 US
Investing Champion", the 33-post sitemap, and one "wick" across the 33 posts (counted on the first checker's cached
copies; the live refetch of all 33 was rate-limited); Deepvue's three definitions including the doubled "the", and
the page metadata 2024-09-03 / 2026-06-19; TaPlot's four rules, both context lines, "Dec 17, 2021", the signature and
the four input names; StockCharts' shadow sentence (no author named); Bulkowski's shooting-star configuration line,
"Bearish reversal 59% of the time", "Overall performance rank: 55", "out of 103 candlestick patterns", the inside-day
figures (1,260 stocks, December 1989 to January 2013, 62%, 32%, 10%, 10/23) and the AI notice on both pages;
Goodreads ("80 pages, ebook", "Published January 1, 2021"); TraderLion's course topics in order, the $797 price, the
MU quotes, "September 13, 2024", the author field "Oliver Kell" and the 941% line; the three UCT quotes (OPEN,
UMC with "mange", Kell's cycle credit), their heading order and dates (2025-10-05 16:51 ET; 2025-10-21 21:00 ET;
2025-06-29); the UCT counts 103 / 65 / 39 / 13 / 2 on the writer's 103 cached API copies (a live refetch reached 58
posts before Substack rate-limited it; the two "wick play" posts were re-read live); the KB entries and their dates;
the APPS, GOOG, MU, OPEN, FIG (both days), MXL and UMC bars and every derived figure (wick shares 80%, 44%, 79%,
45%, 48%, 63%; stretches 7.8%, 12.5%, 40.9%; the 20-session highs and lows; the stop hits and dates); the seven strict
examples in 8.9 (all strict on the bars; entries, stops, risks and outcomes as stated; SHOP's 02-13 open 77.80 under
the 88.91 stop); the measurement table and items 1 to 10 against the writer's output files; the rulebook IDs A3 to
A5, A13, B18 to B23, B26, C28, C29, C31, C33, D42, D47, D48, E50 to E53, E57, F62, F63, F65 and their quoted owner
words; `uct_inside_day.py`, `hammer.py`, `uct_go_signal.py`, `setupGroups.js` (Swing group), `setupTagMap.js`,
`definitions.json` (both quoted sentences and the hammer source), `quotes.json` and commit `367bbcf292` (2026-08-22;
the phrase appears elsewhere only in `app/dist/`), `starterScans.json`, `starter_library.py`, `setup_criteria.json`
(formula and the "LOCATION play" note), `UNITS-method.md`, `setup-vocabulary-v1.json`, `TRADE_PLANS.md` (Go
Signal's 40% lower wick). Not re-checked: the Wayback capture dates for TraderLion's lesson and slides (archive
index queries were not permitted to this checker). Two further web searches found no new primary source: the
Stockbsessed Kell interview (2023-04-01, a write-up) does not mention the wick.

---

## 13. Examples (from our data)

(Numbered 13 because section 12, "Removed in checking", already existed when this was added on 2026-11-09.)

**The scan's rule, in one paragraph.** Daily bars from the sandbox (3,897 names, 1984 to 2026), scanned over the 2,630
names that ever met the house liquidity rule, strict form only (8.2 Option A; the same-day push of Option B needs
intraday bars and was not scanned). Day 1 closes off its high with an upper wick (high minus the body top) of at least a
quarter of its range (8.1, my teaching minimum); at day 1's close the stock is $10 or more with 50-day dollar volume of
$20 million or more (B23), above its 50-day and 200-day SMAs with the 50-day above the 200-day (B26 and the 8.1
proposal), and no more than 10% over its 10-day average (C29). Day 2 sits wholly inside day 1's upper wick: its low above
day 1's body top and its high below day 1's high (Deepvue; TaPlot). Day 3 trades over day 2's high: the buy is a market
order a cent over that high (E57), or the open if the stock gapped over it, and the hit is skipped if that open is more
than 4% past the trigger (C28) or already under the planned stop. The stop is 3 cents under day 2's low (A3, F62), and
a stop wider than 8% of entry is skipped. The outcome walks forward 60 sessions from the day after entry with a FIXED
stop and no trims, no breakeven move and no trail, counting the first of stop, 3R, 5R; a day whose low hits the stop
counts as stopped even if its high reached a target, except on the entry day itself, where daily bars cannot order the
trigger and the low, so the scan records that case ("day-3 low under the stop") rather than deciding it. Recorded for
grading but not gating: the wick fraction, day 2's range and volume against day 1's, an "explosion" in the prior 15
sessions (a 4% gap or a 50-day-high close on 1.5x the 50-day volume), distance from the 52-week high, and the 126-day
return. No earnings filter was applied (B22 is checked by hand on the examples below). Code:
`_study-resume/scratchpad/setups/37-wick-play/scan_wick.py` (outside the repo).

**Base rate.** 1,755 hits in 2,630 of 2,630 liquid names (the scan completed in 242 seconds). 468 of 1,755 (26.7%)
reached 3R before the stop; 311 (17.7%) reached 5R. In 511 hits (29.1%) the entry day's own low printed under the stop;
counting every one of those as a loss gives the floor: 391 (22.3%) to 3R and 261 (14.9%) to 5R. Caveats: a fixed stop
with no trims, so the house plan (a third at 3R, a third at 5R, breakeven between 2R and 5R, then the 10- or 21-day
trail) is not what is measured, and two of the ten examples below (NVDA, LHX) hit the original stop inside the 60
sessions after their best R; the stops are tight (1,563 of 1,755 at 3% of entry or less), so one noisy day ends a trade that
later worked; the sandbox holds today's tickers, so delisted names are missing (survivorship), and 1,219 of the hits
fall in 2013 to 2026, partly because more names pass the $20 million rule recently; the "wholly inside the wick" test is
strict, so this counts textbook wick plays, not every wick that held. What the splits say, with the same caution as 4.3
(none is a large edge): a fill at the trigger did better than a gap-over fill (3R 28.7% against 22.8%, 1,142 against
613 hits); an "explosion" in the prior 15 sessions did not help on these bars (24.5% against 28.0%); day 2 lighter than
day 1 made little difference (26.9% against 25.8%); a stop under 3% (26.9%) and over 3% (25.0%) were alike; wicks of
25 to 50% of the range (31.4%, 223 hits) did as well as or better than bigger wicks (26.0%); names more than 5% under
their 52-week high did slightly better (28.5%) than those within 5% (25.5%).

**The 10 examples.** One per ticker, all reached at least 5R on the fixed-stop walk, none an ETF, each checked on the
chart. "Day 1" is open / high / low / close; "wick" is the upper wick as a share of day 1's range; "day 2" gives its high
and low, its range as a share of day 1's, and its volume against day 1's. Buy = the fill (the trigger a cent over day 2's
high, or the open when it gapped over); stop = 3 cents under day 2's low. "Best R" is the highest high in the 60
sessions after entry before the stop. Earnings dates are from the sandbox's Yahoo + SEC table. Charts and phone sheets:
`_study-resume/scratchpad/setups/37-wick-play/final/` (sheet_1-4, sheet_5-7, sheet_8-10).

| # | Ticker | Buy (day 3) | Day 1 | Day 2 | Buy | Stop | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|
| 1 | GOOGL | 2007-09-14 | 09-12: 13.03 / 13.21 / 12.99 / 13.08, wick 59% | 13.19 / 13.09, 44% of day 1, vol 0.63x | 13.20 | 13.06 (1.06%) | 39.3R (3R day 3, 5R day 4) | A mega-cap just back over its 50-day after a two-month base, a small day-1 bar with most of its range in the wick, a quiet inside day, then eight weeks up. The report (2007-10-18, after the close) came after 5R. Prices are the sandbox's split-adjusted series. |
| 2 | SWKS | 2014-02-10 | 02-06: 30.11 / 30.73 / 30.00 / 30.26, wick 64% | 30.69 / 30.35, 47%, vol 0.63x | 30.70 | 30.32 (1.24%) | 31.0R (3R day 2, 5R day 7) | Kell's frame exactly: an explosion first (the 2014-01-17 earnings gap, +10.2% at the open on 5x volume, 14 sessions earlier), then a wick day resting on the 10-day EMA, day 2 inside it on lighter volume, and a push. |
| 3 | WB | 2016-06-30 | 06-28: 26.90 / 27.71 / 26.20 / 26.88, wick 54% | 27.63 / 27.01, 41%, vol 0.43x | 27.64 | 26.98 (2.39%) | 37.4R (3R day 2, 5R day 4) | A leader 44% over its 200-day (+35% in six months) whose wick day closed two cents under its open; day 2 held the whole body on less than half the volume; day 3 closed near its high. No report on file inside the window. |
| 4 | MELI | 2017-02-06 | 02-02: 188.58 / 191.77 / 187.25 / 188.62, wick 70% | 190.70 / 189.04, 37%, vol 0.44x | 190.71 | 189.01 (0.89%) | 27.6R (3R day 5, 5R day 7) | The tightest stop in the set under a day 2 that barely moved; a steady leader riding its 10-day EMA. The report (2017-02-23, after the close) came after 5R, so B22 did not block the buy. |
| 5 | LHX | 2020-01-17 | 01-15: 212.40 / 215.67 / 211.85 / 213.16, wick 66% | 214.99 / 213.20, 47%, vol 0.99x | 215.30 (opened 0.14% over the 215.00 trigger) | 213.17 (0.99%) | 7.4R (3R day 2, 5R day 11) | A 1% stop under a two-day hold after the early-January gap; day 3 closed at its high on 1.5x volume. The fixed-stop walk then loses it in the late-February 2020 selloff: the 3R and 5R trims and the trail (B19, E52) are what bank a wick play. |
| 6 | NVDA | 2021-10-29 | 10-27: 24.47 / 25.09 / 24.28 / 24.45, wick 76% | 24.95 / 24.52, 53%, vol 0.95x | 25.00 (opened 0.16% over 24.96) | 24.49 (2.03%) | 18.9R (3R day 2, 5R day 4) | The dossier's own example 1 (8.9), re-found by the scan: an explosion on 2021-10-26 (+6.7% on 1.8x volume), a wick day, a hold, a push, 7.3% over the 10-day (inside C29). The report (11-17) came after 5R. The 60-session walk ends at the original stop in January 2022, after the trims would long have been taken. |
| 7 | GLNG | 2022-03-18 | 03-16: 18.38 / 19.23 / 18.17 / 18.39, wick 79% | 19.05 / 18.64, 39%, vol 0.54x | 19.10 (opened 0.21% over 19.06) | 18.61 (2.57%) | 17.2R (3R day 1, 5R day 3) | A 2022 energy leader (+58% in six months) at the liquidity floor ($20 million a day); the biggest wick in the set, a half-volume inside day, then day 3 itself closed +10% on 3.8x volume, 3R on the first session. No report on file in the window. |
| 8 | SPOT | 2024-09-23 | 09-19: 350.00 / 368.29 / 348.96 / 360.22, wick 42% | 366.79 / 362.00, 25%, vol 0.51x | 367.00 (opened 0.05% over 366.80) | 361.97 (1.37%) | 27.7R (3R day 1, 5R day 26) | A large day 1 on 1.5x volume, a tiny day 2 (a quarter of day 1's range), 3R on the first session, then a slow grind: 5R took 26 sessions. A lesson that the first trim is fast and the rest can be patient. No report on file in the window. |
| 9 | TTMI | 2025-06-09 | 06-05: 32.46 / 34.00 / 31.83 / 32.11, wick 71% | 33.36 / 32.57, 36%, vol 0.65x | 33.64 (opened 0.81% over 33.37) | 32.54 (3.27%) | 15.9R (3R day 2, 5R day 11) | An explosion two days before day 1 (06-03, +8.5% on 3.1x volume), a red wick day whose body top (the open, 32.46) held, then a +6% day 3 on 2.4x volume. The stop, 3.27%, is a touch over A13's "about 3%", so size down (A5). 33% over its 50-day: extended, a grading minus. |
| 10 | AIR | 2026-01-12 | 01-08: 93.00 / 97.67 / 92.21 / 94.73, wick 54% | 97.33 / 95.44, 35%, vol 0.92x | 97.50 (opened 0.16% over 97.34) | 95.41 (2.14%) | 12.9R (3R day 3, 5R day 12) | The report (2026-01-06, after the close) gapped it +6.1% on 01-07; day 1 is the next session, a 2.1x-volume bar that closed off its high; day 2 held the body top; day 3 pushed. An explosion, then a wick play, in one week. 8.9% over the 10-day: close to the C29 limit. |

**Notable failures (from the same scan, in words).**
- AMZN, 2018-09-04: a 60% wick on 2018-08-30, a clean inside day, a fill at 101.33 with a 1.1% stop (100.21), 1.1%
  under the 52-week high. The next session's low was 99.49: stopped for 0R, and the stock never traded above 102.53 in
  the following 20 sessions (its September 2018 top). A perfect-looking wick play at the end of a run is still a 1%-stop
  bet on one more push; the rule did not fail, the run was over.
- DDOG, 2020-10-06: the wick day (10-02, wick 65%) sat 9.6% over its 10-day, almost at the C29 line, and day 2's low
  left a 4.1% stop. Day 3 opened at 106.89, traded through the 108.11 trigger to 109.60 and down to 102.14, under the
  stop, the same day (daily bars cannot order the two); it was in any case stopped on 10-08 (low 101.81), then ran to
  118.13 (2.3R) within a week. A stretched name with a wide stop: skip, or take the stop and wait for a new setup
  (A4, B21).
- SHOP, 2024-02-12: the dossier's example 6 (8.9), re-found by the scan. A 55% wick on 02-08, a clean inside day, a fill
  at 91.40 with a 2.75% stop (88.89); on 02-13 it opened at 77.80, 15% lower, far through the stop. Section 8.9 states the
  02-13 gap was the earnings reaction; the sandbox's earnings table holds no SHOP date for it, so that classing rests on
  8.9, not on the table. B22 (no new buys within 3 days of a report) is the lesson either way.
- ANET, 2025-08-13: day 1 (08-11) carried an 84% wick three sessions after the 08-06 earnings reaction, 8% over the
  10-day; day 3 opened at 141.27, printed 141.99 (through the 141.46 trigger) and closed at 138.01 with a low of 136.01,
  3.9% under the entry: stopped on the entry day on any ordering of the bars. The stock then reached 156.32 (4.5R) within
  20 sessions. Two warnings in one: a stretched name's first push can fail inside the day, and a stop is a stop (A4).

## 14. Failures and near-misses (from our data)

The same scan and the same trade as section 13 (strict form: day 2 wholly inside day 1's upper wick, bought a cent over
day 2's high on day 3, stop 3 cents under day 2's low, 60 sessions forward, fixed stop). Four valid wick plays that
stopped before 3R, one per ticker, four different years, and four two-day patterns that look like the setup but fail
exactly one gate criterion of the card (`criteria/37-wick-play.json`). Charts:
`scratchpad/setups/37-wick-play/final/fail_1-4.png`, `near_1-4.png`, and the confusable pair against the Inside Day in
`pair_08-inside-day.png`. Code: `near_scan.py` (the scan with each gate relaxed to a band just outside the rule,
keeping the patterns that fail one gate only; 2,630 of 2,630 names) and `fail_near.py`.

**Failures: valid by every gate, stopped by the rules.**

| ticker | day 1, bought | buy | stop (%) | where it stopped | what happened | criterion |
|---|---|---|---|---|---|---|
| AMZN | 2018-08-30, bought 2018-09-04 | 101.33 | 100.21 (1.1%) | day 1, 2018-09-05, low 99.49 | a 60% wick, a clean inside day, 1.1% under the 52-week high; the next session traded through the 1.1% stop and the stock fell to 94.37 within 10 sessions. The run was over. | wk.stop_width |
| V | 2019-10-11, bought 2019-10-15 | 178.42 | 177.08 (0.75%) | day 1, 2019-10-16, low 176.27 | a 91% wick and a tight day 2, but no explosion in the prior 15 sessions and 5.3% under the 52-week high; a 0.75% stop inside the noise; low within 10 sessions 170.18. | wk.explosion (the grading cue) |
| SHOP | 2024-02-08, bought 2024-02-12 | 91.40 | 88.89 (2.75%) | day 1, 2024-02-13: opened at 77.80, 15% lower | a 55% wick, a clean inside day, the entry day closed at 89.12 under the trigger; the next open was far through the stop. The sandbox earnings file has no date here; section 13 files it under B22. | wk.earnings_window |
| ANET | 2025-08-11, bought 2025-08-13 | 141.46 | 138.17 (2.33%) | the entry day: low 136.01, close 138.01 | an 84% wick three sessions after the 08-06 earnings reaction, 8% over the 10-day; day 3 printed 141.99 over the trigger and closed 3.9% under the entry, stopped on any ordering of the bars; the next session opened under the stop (low 132.45). The stock reached 156.32 (4.5R) within 20 sessions without us. | wk.stop_broker |

**Near-misses: one gate fails, everything else passes.**

| ticker | day 1, bought | the one criterion that fails | the number | what it really is |
|---|---|---|---|---|
| AMZN | 2020-08-24, bought 2020-08-26 | wk.day2_strict | day 2's low 163.35 dips 1.3% (0.54 ATR) under day 1's body top 165.51; the strict form allows none, the B grade at most 0.25 ATR | an inside day that touched the body: an ordinary inside day (setup 08), not a wick play |
| TSLA | 2018-06-07, bought 2018-06-11 | wk.trend | the close is 2.2% under the 200-day and the 50-day is 10.2% under the 200-day; the rule needs close > 50 > 200 | a reclaim attempt under a falling 200-day; it ran 6R, which is the reclaim's edge, not this setup's |
| PBR | 2019-01-07, bought 2019-01-09 | wk.not_stretched | day 1 closed 12.3% over the 10-day SMA; the rule is 10% or less | a wick play too far from the averages after a sharp two-week run; stopped |
| REGN | 2013-05-01, bought 2013-05-03 | wk.stop_width | the honest stop under day 2's low is 8.12% from the entry (the open was 3.64% over the trigger); the rule wants about 3% | a wick play after a wide, big-volume day 1 whose day 2 was too wide to stop under; size down or skip |

**What the failures have in common.** All four were out within one session of the entry, and three of the four never
traded above the entry day's high (best R 0.0). The two-day shape was textbook in every case (wicks of 55% to 91%, day
2 wholly inside) and the shape is not what failed: AMZN and V came at the end of a move with stops of about 1%, inside
one day's noise; SHOP and ANET came within the earnings window, one on the report, one three sessions after a reaction
with the stock 8% over its 10-day. Section 13 measured that the strict form did not beat an ordinary inside day; these
four are the picture of why. The location (an explosion within 15 sessions, not the end of a run), the earnings
window and the honest stop width carry the trade, and the stop did its job each time: four losses of 1R, none worse,
with B20 deciding the real size of the SHOP and ANET gaps.
