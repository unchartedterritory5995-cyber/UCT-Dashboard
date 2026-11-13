# Setup 11: 20 EMA Pullback (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote was
copied from the page or PDF named next to it and then checked word for word, by script, against a saved copy of that
source. Quotes keep the writer's own spelling. Where I could not read a source, I say so and give no wording from it.

**Who is who in UCT quotes.** The owner is Patrick (TSDR). He writes the "TSDR's Weekly Outlook & Watchlist" and "TSDR
Trading" sections of UCT's Substack, which say so in their headers. Bracco writes "Bracco's Breakdown & Top Ideas" and
"The Parabolic Short". The intros and the "Index & ETF" sections are not signed; I mark them "unsigned". Contributors
(Manrav, ChartMaster, Dark Oblivion and others) have their own signed sections in "The Rest of the Week". Dates are the
US dates of the posts. Substack's own timestamp is in UTC, and "The Rest of the Week", "Market Update and Watchlist"
and "Week Ahead" went out on US evenings, so their UTC date is one day later than the date the post states in its own
subtitle (for example the post at `/p/the-rest-of-the-week-481` is UTC 2025-10-22 01:00 and is subtitled "October 21st,
2025"). This dossier uses the post's own date; the links are unchanged. (Corrected in checking: the first draft used
the UTC dates, which put "today" in those posts one session late.)

**Tags used in section 8.** **[source consensus]** several outside sources agree; **[originator]** the named trader's
own words; **[UCT]** the owner, Bracco or a signed UCT contributor, or the owner's verdict log; **[house rule]** the
account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or
change. A line built from the app's own lab thresholds is tagged [my proposal] and says so.

**Related dossier.** `12-ma-pullbacks.md` covers pullbacks to the 10, 50 and 200-day lines. This one is only the setup
the owner named "20 EMA Pullback" in the Model Book. The two should agree where they overlap: questions 2, 3, 4, 5, 7
and 10 in section 10 bear on setup 12 too, and the trigger recommended here (8.2) differs from the one recommended there,
so one ruling should settle both.

---

## 1. What it is

A stock that is already in a strong uptrend pulls back to its rising 20-day exponential moving average (EMA). A session
holds that line and turns back up; you buy the turn with a stop just under that session's low, so the risk is small and
sits at a level many traders watch.

**The market psychology.** These points are reasoning drawn from the sources, not measured facts.
- **Trend traders expect the retest.** Linda Raschke built her version on this: "This pattern takes advantage of the
  fact that the odds are very high that when a security makes a new momentum high and pulls back, it will retest its
  recent high." ([AIQ Opening Bell, Aug 1997](https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf))
- **The line is a shared reference.** Raschke: "The 20 period exponential moving average often acts as support for
  stocks." (same source) Buyers who missed the breakout wait for it; holders who are up defend it.
- **Late buyers get shaken out, sellers get trapped.** UCT's writers treat the shakeout under the line as a feature:
  "20 EMA shakeout bar on Thursday to weed out the late chasers" (Bracco, Sunday Scans 2025-06-08), and an unsigned
  market note wants "some shakeout, and some battleground to scare buyers, trap sellers, and set us up for further
  upside." ("Thoughts on the Market", The Rest of the Week 2025-11-25). Traders who sell the break of the prior day's
  low must buy back when the stock reclaims it, which adds fuel to the turn.
- **Light selling means thin supply.** Brian Shannon looks for "volume expanding in the direction of the primary trend
  and contracting during pullbacks." ([AlphaTrends FAQ](https://alphatrends.net/new-visitors/)) A quiet drift to the
  line says holders are not leaving; a heavy-volume break says the opposite.
- **Why a trend keeps going at all.** One peer-reviewed line of evidence: stocks whose 21-day average sits far above
  their 200-day average keep earning higher returns, which the authors explain by anchoring and underreaction (section
  4). That supports buying in strong trends; it does not prove the pullback entry itself.
- **The caution.** A moving average is not a wall. The AlphaTrends FAQ (Shannon's site): "stocks blow right through
  “important” moving averages all the time, leaving traders who acted at those levels with losses." That is why most of
  the sources wait for a sign that buyers have stepped in before buying (Keller and Kullamägi state no entry for the
  touch itself).

---

## 2. Origin and naming

**No single inventor.** Buying a pullback to a rising moving average is old, shared trend-following practice. Pradeep
Bonde calls "Buy first pullback to 50 day moving average" "like most commonly used swing trading method" and says the
courses he studied repackage it with other lines: "Same soda different bottle and different color. 50 ma becomes 20 MA
or 39 MA or some other MA." ([Stockbee, 2010-11-04](https://stockbee.blogspot.com/2010/11/how-to-develop-pullback-method.html))

**The earliest named, rule-based version I could verify is Linda Bradford Raschke's "Holy Grail".**
- In a 1993 *Stocks & Commodities* interview she already describes buying pullbacks to a 20-period EMA: "If there is a
  trend, I'll try to always look for buying a pullback to a moving average (Figure 3). I personally use a 20-period
  exponential moving average on all my markets." ([S&C V.11:9, "The Discerning Trader" by Thom Hartle](https://lindaraschke.net/wp-content/uploads/2026/01/Discerning-trader.pdf);
  the article's own lead says she spoke with Hartle "on June 18, 1993, via telephone". Corrected in checking: the first
  draft said the PDF prints no year.)
- The setup is named and given rules in *Street Smarts: High Probability Short-Term Trading Strategies* by Laurence A.
  Connors and Linda Bradford Raschke (M. Gordon Publishing Group). The book's date: its Library of Congress class number
  carries 1995 and the Open Library edition record says January 1, 1996 ([Open Library](https://openlibrary.org/isbn/0965046109)).
  I did not read the book. The rules quoted in section 3.1 come from a rules box the AIQ newsletter printed beside her
  1997 interview about the book (the box is the publisher's summary, see 3.1), and a 2000 interview (Active Trader, Aug
  2000) introduces the Holy Grail as a pattern "described in her book" *Street Smarts*. The app's own Holy Grail
  description dates the book 1995 (`api/routers/patterns.py`); the Library of Congress number agrees.

**Other names for the same idea.**
- **EMA Crossback** (Oliver Kell): the first pullback to the rising 10 and 20-day EMAs after a "Wedge Pop", part of his
  "Cycle of Price Action" (TraderLion articles credited to Kell, 2024). Kell won the 2020 U.S. Investing Championship
  per TraderLion's author note.
- **"Surfing" the 10 and 20-day** (Kristjan Kullamägi): not a separate setup for him, but the consolidation phase of his
  breakout setup (qullamaggie.com, 2021).
- **The 21-day line / 21-day EMA**: David Keller (StockCharts) uses a 21-day EMA. Mary Ellen McGonagle (StockCharts;
  her author note says she worked for years under William O'Neil) buys pullbacks to a 10- or 21-day **simple** average,
  whichever the stock respects (section 3.4). Both are on public StockCharts pages. I could not read IBD itself
  (investors.com blocks our client), so what IBD or MarketSmith call the "21-day line" is not quoted or assumed here.
  (Corrected in checking: the first draft called the 21-day the IBD and MarketSmith usage without a source.)
- **Holy Grail** (with the ADX trend filter), **MA bounce** (StockCharts' term for the 50 and 200-day version).

**UCT's names.** "20 EMA Pullback" is the name in the owner's own setup list (Model Book catalog, added 2026-06-10 from
"the user-provided v1 list", in the words of commit 63eca6ed7d). In the Substack the owner says "20EMA tap", "hold of the 20EMA", "20EMA shakeout", "squat
to the 20EMA", "drift and hold at the 20EMA", "hammer at the 20EMA", "UnR (Undercut and Reclaim) at the 20EMA" and "20EMA pullback". He calls
it "my bread and butter" and "my main go to setup" (section 6). The app's vocabulary file already notes the naming gap:
"engine uses the 21 EMA; the authors say 20" (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`, entry `20ema_tap`).

**A misattribution in the app.** The app's scanner `pullback_to_21ema.py` is titled "Pullback to 21-EMA (Minervini
SEPA)" and attributes many specific rules and numbers to Mark Minervini. I found no Minervini source that supports them
(section 5.6). Minervini should not be named as this setup's originator in anything members see unless a page of his is
found and quoted.

---

## 3. Every definition I could find, source by source

### 3.1 Linda Bradford Raschke: the Holy Grail (originator, primary)

Source: interview by David Vomund, *AIQ Opening Bell Monthly*, Vol. 6 Issue 8, August 1997, hosted on Raschke's own
site ([PDF](https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf)). The four rules below are a box headed
"Holy Grail Pattern" and "Buy rules (sells are reversed)" printed beside the interview. **The box is the newsletter's
summary, not her words**: rule 1 points readers to the ADX/R indicator in TradingExpert, AIQ's own software (the PDF's
text layer drops apostrophes, so that sentence is not quoted here). Her own words in the interview match it: "we want the stock to fall back to a 20 day moving average after
its ADX indicator has moved to a value above 30." (Corrected in checking: the first draft called the box her own
printed rules.)
- **Prior trend:** "1. The 14-period ADX must initially be greater than 30 and rising."
- **The pullback:** "2. Look for a retracement in price to the 20 period exponential moving average. This will usually
  be accompanied by a turndown in the ADX."
- **Trigger and order:** "3. When the price touches the 20 period moving average, put a buy stop above the high of the
  previous bar."
- **Stop:** "4. Once filled, enter a protective sell stop at the newly formed swing low. Trail stops as profits grow."
  (The PDF's two-column layout splits this sentence across a column; the words are as printed.)
- **Reading rule 3.** "The previous bar" is not defined further. Read literally, at the moment price touches the line
  the previous bar is the bar before the touch, so the buy stop could fill on the touch session itself; read the other
  way, once the touch bar closes it is the previous bar, and the buy is a break of its high on a later session. The
  1997 text does not settle which; section 8.2's option B assumes the second.
- **Failures:** "When you research this pattern, you should also look at cases when it fails." Of Eaton (ETN), which
  "pulled back nicely to the 20 period moving average" and then showed "little movement" for five days (July 1 to 8):
  "This is a case where there is no reason to be in this trade."

Same setup, later interviews (Active Trader, by Mark Etzkorn):
- **First retracement and exit:** "On the 30-minute time frame, the ADX rose above 30, so we'll buy the first
  retracement to the 20-period EMA and look to exit on a push to new highs." ([Mar 2004](https://lindaraschke.net/wp-content/uploads/2026/03/raschke_pt2_0304.pdf))
- **The trend filter is on the same time frame:** "But each retracement has to be preceded by a 14-bar ADX reading
  above 30 on that time frame," (same)
- **Grading:** "The best setups will have confirming factors like the 3-10 oscillator making new momentum highs." (same)
- **Any time frame:** after a breakout to new momentum highs, price first pulls back to the 20-bar EMA on the 15-minute
  chart, "then the same retracement will occur on the 30-minute chart, then the 60-minute chart" (same, Mar 2004).
- **Failed version:** "First, if a grail buy trade fails, I know I'm not going to look to buy pullbacks in that market."
  ([Aug 2000, "The rituals of trading"](https://lindaraschke.net/wp-content/uploads/2026/01/rituals.pdf))
- **Order type (1993):** "I use market orders most of the time." (S&C 1993 interview, above) And in 2000, for a
  trending market: "for Pete's sake, use market orders." In a choppy range she prices her orders with limits instead
  (Aug 2000, same PDF as above).
- **Not in a trendless market (1993):** "I avoid the markets where the ADX falls below 20 and is declining, because
  there's just not enough movement between the swings for me."
- **The period is not sacred (1993):** "But what you'll find is that there really is no right or wrong parameter for a
  moving average."
- Not specified by Raschke in what I read: volume, price or liquidity floors, pullback length or depth beyond "touches".

### 3.2 Oliver Kell: the EMA Crossback (TraderLion pages credited to Kell)

Sources: "How to Buy Stocks on Pullbacks with the EMA Crossback Strategy", TraderLion, 2024-08-20, author Oliver Kell;
"Cycle Of Price Action", TraderLion, 2024-09-10, author Oliver Kell; "Oliver Kell's EMA Crossback Uncovers Low-Risk
Entries", TraderLion, 2025-05-22, author "TraderLion" (staff, not Kell). The live pages blocked our fetch tools (HTTP 403,
and a bot challenge for plain curl), so I read the Internet Archive copies dated 2025-01-22, 2025-06-23 and 2025-07-02 (URLs in section 11). Kell's
own book was not read.
- **Lines and prior trend:** "By focusing on the 10 and 20-day exponential moving averages (EMAs), you can identify key
  moments to buy stocks when the price dips into these levels after a strong rally." (2024-08-20)
- **Which test:** "The EMA Crossback refers to the first time the stock price retests its moving averages after a strong
  upward move, called a “Wedge Pop.”" (2024-08-20) The staff article adds "for the first time" after "a strong rally
  off of the lows" (2025-05-22).
- **What comes before:** "A Wedge Pop occurs when the price reclaims both the 10-day and 20-day EMAs after a sharp drop,
  signaling a shift into a new uptrend." (2025-05-22, staff)
- **Shape:** "The EMA Crossback works best when the price gently moves sideways, allowing the moving averages to rise to
  the price." (2024-08-20) "A slow drift into the EMAs is ideal." (2025-05-22, staff)
- **Confirmation before buying:** "But always wait for confirmation that buyers are stepping in before making your
  trade." (2024-08-20)
- **Volume:** the staff article lists "Volume increasing on up days (accumulation)" among the signs of strength
  (2025-05-22).
- **Stop:** "Place your stop-loss just below the pivot or price bars." (2024-08-20) The staff version: "Place your
  stop-loss just below the most recent swing low or consolidation base." (2025-05-22)
- **Sizing:** the staff article says "You can scale in with strength and add on confirmation." (2025-05-22). This
  conflicts with our rule A5 (one price, one stop, no adding).
- **The trend lines:** "10 and 20-day exponential moving averages guide us through the intermediate-term trend"
  (2024-09-10).
- **The short mirror exists:** "Like an EMA Crossback to the upside, an EMA Crossback to the downside will retest the
  moving averages but is now met with more resistance, pushing the stock lower." (2024-09-10)

### 3.3 Kristjan Kullamägi (Qullamaggie): the 10 and 20-day inside his breakout setup (originator, primary)

Source: "3 TIMELESS setups that have made me TENS OF MILLIONS!", qullamaggie.com, posted 2021-01-08, updated 2021-04-28
([link](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)). This is his breakout setup,
not a pullback buy; it matters here because it describes how a leader behaves around the 10 and 20-day lines.
- **Prior move:** "A big move higher sometime in the past 1-3 months. This move can be anywhere from 30-100%+ and usually
  lasts a few days to a few weeks."
- **Shape:** "An orderly pullback and consolidation with higher lows and tightening range in the consolidation phase."
- **The lines:** "During the consolidation the stock price “surfs” the rising 10- and 20-day. and sometimes toe 50-day
  moving average." (His typo "toe" is in the original.) He does not say EMA or SMA.
- **Stop:** "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock"
- **Exits:** "You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop to break even. The rest
  of the position should be trailed with the 10- or the 20-day moving average." Then: "Depends on how fast the stock
  is. If a beginner stick to the 10-day. You wait for the first CLOSE below the 10- day."
- **The same lines as a short target:** for his parabolic short, "The target area is the 10- and 20-day moving
  averages, that’s where these stocks usually bounce."

### 3.4 David Keller, CMT (StockCharts): the 21-day EMA as the trend-phase line (established educator)

Source: "Pullback or Pitfall? Let the 21-Day EMA Be Your Guide", StockCharts Articles, 2025-09-05. Keller is a former
President of the CMT Association ([link](https://articles.stockcharts.com/article/stock-market-pullback-or-pitfall-21-day-moving-average-guide/)).
- "I use the 21-day exponential moving average (EMA), in particular, to confirm trend phases."
- "As long as the price remains above the 21-day EMA, any short-term movements can be considered noise, rather than a
  clear signal of a change in trend."
- **Stop logic:** "I think of the 21-day EMA as the first line of defense, an initial stop within an uptrend phase." If
  it fails and turns lower, he relies on the 50-day as the second line (paraphrase).
- **Trend order:** "The price is above the 21-day EMA, the 21-day is above the 50-day SMA, and the 50-day is above the
  200-day SMA." He calls this the "proper order".
- No trigger, volume or exit rules; this is a trend-reading article, not a full setup.

### 3.4b Mary Ellen McGonagle (StockCharts): the 10 or 21-day simple average (established educator)

Sources: "Alert Yourself To Pullback Opportunities In Fast-Moving Stocks", StockCharts, 2019-07-05
([link](https://articles.stockcharts.com/article/articles-chartwatchers-2019-07-alert-yourself-to-pullback-opportunities-in-fast-moving-stocks/)),
and "The Art of Uncovering an Ideal Buy Point", StockCharts, 2020-06-02
([link](https://articles.stockcharts.com/article/articles-mcgonagle-2020-06-the-art-of-uncovering-an-ideal-484/)).
Her author note on both pages says she "spent years working under William O’Neill" (their spelling). Added in checking.
- **Which line:** "you’ll want to pay attention to its simple moving average. While you can use either the shorter-term
  10-day or the longer-term 21-day moving average, you’ll want to check the stock’s chart to uncover which one is the
  better indicator." (2019) Each stock "has its own “personality” that determines which moving average it tends to obey."
- **Why wait for the pullback:** "chasing stocks hitting a new high in price can be the surest way to frustration"
  (2019).
- **Trend first:** "you’ll want to make sure that the stock you’re considering purchasing is in an uptrend before viewing
  any pullback as a buying opportunity." (2020)
- No trigger, stop or exit rule in either page. These are the nearest pages to the O'Neil tradition I could read; on
  the 21-day line they say simple, not exponential. What IBD itself uses was not read (3.9).

### 3.5 Brian Shannon, CMT (AlphaTrends): confirm the line with price (established educator)

Sources: "New to Alphatrends?" FAQ page ([link](https://alphatrends.net/new-visitors/), undated, read 2026-11-09) and
"2 Questions You Must Answer Before Entering Any Trade", AlphaTrends, 2026-03-10 (no author name in the page text I
saved, so I credit it to the site, not to Shannon by name). His 2008 book *Technical Analysis Using Multiple Timeframes*
was not read. (Corrected in checking: the first draft called him the originator of the multi-timeframe method, which
no source here says; his site lists the 2008 book and calls him a Chartered Market Technician.)
- "a moving average gives you a reason to study price action closely as it approaches, not a reason to act
  automatically." (FAQ)
- "The choice between simple and exponential matters less than the discipline of confirming the level with price
  action." (FAQ)
- **Volume:** "Brian looks for volume expanding in the direction of the primary trend and contracting during
  pullbacks." (FAQ)
- **Liquidity:** "Anything under roughly 500,000 shares per day on a 20-day average is typically the cutoff." (FAQ)
- **Context:** "When price is above a longer-term reference, such as the 200-day moving average, the larger trend is
  considered innocent until proven guilty." (2026-03-10 post)
- **Trail:** "Once you are in a trade, stops should be raised under higher lows as price advances." (2026-03-10 post)
- **Stop size:** "The official trade ideas typically use suggested stops 2 to 3% from the entry price" (FAQ). Close to
  our A13 (stops usually within about 3%).
- **Do not chase:** "Buying strength after a controlled pullback is very different from chasing price after an extended
  rally." (2026-03-10 post)

### 3.6 StockCharts ChartSchool (established educator)

- **What the 20 EMA is:** "A 20-period EMA applies a 9.52% weighting to the most recent price (2/(20+1) = .0952)."
  ([Moving Averages, Simple and Exponential](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential))
  By the same formula a 21-period EMA weights the latest close 2/22, about 9.09% (my arithmetic).
- **A generic MA-bounce template** (written for the 50 and 200-day, not the 20): identify the uptrend, wait for the
  pullback, look for a bullish price signal at the line, then "You might buy a breakout of the top of the candle that
  had the bounce." ([Finding Support and Resistance in Moving Averages](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/finding-support-and-resistance-in-moving-averages))
  Its stop for the 50-day version is "a few points below the 50-day or the 200-day"; its target options include a
  2:1 reward to risk. It says the short side uses "the same rules as above but in reverse."

### 3.7 Pradeep Bonde (Stockbee): a skeptic's view of pullback buying (originator, primary)

Source: "How to develop pullback method", 2010-11-04 ([link](https://stockbee.blogspot.com/2010/11/how-to-develop-pullback-method.html)).
- "if you are primarily a pullback trader you will miss out on some of the best opportunities in the market."
- "The key to trading pullback again boils down to selecting the right kind of stocks to trade pullbacks on."
- "In most small caps there is one big rally and then they exhaust themselves. Buying such pullbacks on most of them
  would make you a bag holder."
- He lists "Buy first pullback after a major breakout" and "Buy first pullback to 50 day moving average" among the
  common methods, and says pullback methods work best on large, mature stocks with "large fund holding".
- On fast movers: "Some stocks like momentum stocks or growth stocks are best traded using breakout methods." And on the
  market: pullback methods "tend to do well in range bound markets and may not do well in bull markets or highly
  trending markets." (Added in checking. This is the strongest outside caution against the setup; it is his view, not
  a measured result.)

### 3.8 UCT: the Model Book card and playbook (house text)

- **Model Book card** (`app/src/pages/modelbook/setupCatalog.js` lines 97-104, the line itself at 101): "A bullish
  trend pulls back to the rising 20 EMA; a candle holds it, and the remount of the 9 EMA is the buy." The setup's name
  came from the owner's v1 list (commit 63eca6ed7d); this one-line text was rewritten the same day in an AI-assisted
  commit (1391900ba5) whose message begins "Per the provided write-ups". So it summarizes his write-ups; it is not his own sentence.
- **Model Book playbook** (`app/src/pages/modelbook/setupPlaybooks.js` line 235, "Authored ... from the user's
  write-ups", commit ff18bf3fe5, 2026-06-17): an **intraday** version. Context: "a stock in a bullish daily trend, or
  gapping up on a catalyst, pulls back intraday to the 20-EMA". Trigger: "A green candle holds at the 20-EMA; entry is
  taken as the next candle breaks that holding candle’s high and price remounts the 9-EMA." Stop: "Below the lower wick
  / low of the candle that held the 20-EMA." Exits: "Scale into new highs or on reward-to-risk". Mistakes: "Buying the
  pullback before a candle actually holds the 20-EMA." and "Using the setup on a stock whose daily chart is not
  bullish." It calls "pullback to the 20 EMA and remount the 9 EMA" "The community’s phrasing". The file's header says
  its content "comes from the user's playbook" docs, but the entry was written by an AI-assisted commit from those
  write-ups, so treat it as a close summary, not a quotation of the owner.
- **The owner's own practice** is in section 6. In short: daily chart, a rising 20 EMA, a quiet pullback or a shakeout
  into it, and an intraday turn on the day it holds (red to green, a reclaim of the prior day's low, the opening range
  high, an hourly hold), stop at the low of that day.

### 3.9 Sources I could not read (nothing quoted from them)

- **Investor's Business Daily / MarketSmith** (the 21-day line): investors.com refused our client. Nothing from IBD
  is quoted or relied on. The nearest readable stand-in is McGonagle (3.4b).
- **Mark Minervini** (*Trade Like a Stock Market Wizard*, 2013; *Think & Trade Like a Champion*, 2017): books not read;
  minervini.com is now a product page. Search results were flashcards, AI-written notes and indicator scripts, which are
  not sources. Nothing from Minervini is quoted.
- **Gil Morales and Chris Kacher** (*Trade Like an O'Neil Disciple*, Wiley 2010): the only preview found (O'Reilly)
  disallows AI clients in its robots file, so I did not fetch it.
- **Stan Weinstein** (*Secrets for Profiting in Bull and Bear Markets*): not read; I found no ChartSchool page on him.

### 3.10 Comparison table

| Source | Prior trend | Line | Shape and length | Depth | Volume | Trigger and entry | Stop | Exit |
|---|---|---|---|---|---|---|---|---|
| Raschke 1997/2004 | 14-bar ADX over 30 and rising, same time frame | 20 EMA | "retracement"; the first one (2004) | touches the line | not specified | buy stop over the prior bar's high after the touch | newly formed swing low | trail (1997); exit on a push to new highs (2004) |
| Kell 2024 (TraderLion) | after a strong rally / Wedge Pop | 10 and 20 EMA | first retest; sideways or slow drift | dips into the lines | rising on up days (staff 2025) | after buyers show (confirmation) | just below the pivot or price bars | raise stops as it climbs |
| Kullamägi 2021 | 30-100%+ in 1-3 months | 10 and 20-day (sometimes 50) | orderly, higher lows, 2 weeks to 2 months (breakout setup) | rides the lines | not specified | his entry is the breakout, not the touch | low of the day, no wider than ATR | 1/3 to 1/2 after 3-5 days, trail 10 or 20-day close |
| Keller 2025 (StockCharts) | price > 21 EMA > 50 SMA > 200 SMA | 21 EMA | pullbacks "at or around" it | not specified | not specified | not specified | the 21 EMA is "first line of defense" | not specified |
| McGonagle 2019/2020 (StockCharts) | an uptrend; a top performer | 10 or 21-day **simple** average, whichever the stock obeys | wait for the pullback, do not chase highs | to the line | not specified | not specified | not specified | not specified |
| Shannon (AlphaTrends) | above the 200-day | any; confirm with price | not specified | not specified | contracting on pullbacks | after price confirms | under higher lows (trail) | not specified |
| ChartSchool (50/200 template) | 50 over 200, both rising | 50 or 200 SMA | wait for the pullback | at or near | not specified | break of the bounce candle's top, or at once | a few points under the line | 2:1, measured move or resistance |
| Model Book playbook (UCT house text) | bullish daily chart or a catalyst gap | 20 EMA (intraday) | orderly retrace, lower wick tags it | tags it | not specified (it says "diminishing momentum", not volume) | next candle breaks the holding candle's high and remounts the 9 EMA | under the holding candle's low | scale into new highs or on reward to risk |
| Owner and unsigned UCT posts (section 6) | rising 20 EMA; leaders; 9>20>50>200 (unsigned intro) | 20 EMA | quiet drift or shakeout, four to six days in the dated examples, "1-3 weeks of build out" | tap, or undercut and reclaim | low on the pullback | intraday turn on the hold day: red to green, prior-day-low reclaim, ORH, hourly hold, Go Signal | low of that day or that hourly candle | sell partials into 3-5-7 days of strength; trail 9/20/50 as each passes entry |
| App scanner v5 (internal) | 21 EMA > rising 50 SMA; above a non-falling 200 SMA | 21 EMA (reports only 21-EMA tags) | at least 1 ATR off the highest high of the last 11 sessions | low within 1 ATR under to 0.25 ATR over the line | none | the close of the tag session | the tag bar's low | 2R and 3R |
| App scanner pullback_to_21ema (members) | "Stage 2", close > 10 > 20 > 50 > 200 SMA, own momentum rising | 21 EMA | touch within the last 3 bars | body within 1.5% over the line, no lower limit | touch bar under 1.1x its 20-bar average | a close above the touch bar's high plus 0.1% | 21 EMA minus 1 ATR | one target at 3R |

### 3.11 Where the sources disagree

1. **20 or 21, EMA or SMA.** Raschke and the owner say 20 EMA; Kell says 10 and 20 EMA; Keller and the app say 21 EMA;
   McGonagle uses a 10 or 21-day simple average; Kullamägi does not say which kind. Raschke herself says the parameter is not sacred, and Shannon says the kind
   matters less than price confirmation. The real difference is small (section 4.5).
2. **The trend filter.** Raschke uses ADX over 30 and rising. Kell wants a Wedge Pop first. Kullamägi wants a 30-100%
   move in 1-3 months (for his breakout setup). Keller and the owner use moving-average order. The app uses MA order plus
   slopes.
3. **Which touch.** Kell and Raschke (2004) want the first. Keller counts "five pullbacks" in one trend as entries; the
   owner praises "Multiple holds of the 20ema" (ALAB, 2025-06-19) but prizes the first tap.
4. **The trigger.** A buy stop over the prior bar's high (Raschke); a break of the bounce candle's top (ChartSchool,
   Model Book playbook); an intraday turn on the hold day (the owner); the close of the tag day (app v5); 0.1% over the
   touch bar's high, stated as a close above it (app pullback_to_21ema).
5. **The stop.** New swing low (Raschke); below the pivot or price bars (Kell); low of the day (Kullamägi, owner); the
   holding candle's low (Model Book); the tag bar's low (v5); 21 EMA minus 1 ATR (pullback_to_21ema). Only the last is
   far from price.
6. **The exit.** Exit at a push to new highs (Raschke 2004); partials after 3-5 days and trail the 10 or 20-day
   (Kullamägi, owner); 2R/3R (app); our house rule is a third at 3R, a third at 5R, trail the rest (B19, E51, E52).
7. **Scaling in.** TraderLion's staff article says scale in; the owner buys full size at one price (A5).
8. **Is pullback buying even a good idea for momentum stocks?** Bonde says pure pullback traders miss the best movers,
   that small-cap pullbacks fail, and that pullback methods "may not do well in bull markets or highly trending
   markets". The owner trades pullbacks in liquid leaders and says of one: "It has been a buy
   on pullbacks not strength." Our rule B23 ($10, $20 million a day) removes most of Bonde's small-cap worry.
9. **Time frame.** Most sources are daily. The Model Book playbook is intraday. Raschke runs it on any time frame.

---

## 4. Measured evidence

**Bottom line: I found no reliable published statistic (win rate, average gain, failure rate) for the 20 EMA pullback
itself.** Below is what exists, who measured it, and what it does and does not show.

### 4.1 The app's own lab (internal, not published)

From the docstring of `api/services/pattern_engine/detectors/uct/uct_pullback_ma_v5.py` (lines 11-17 and 60-67); the
report files it cites (`REPORT_RECALL_V2`, `out_recall_v2/`) are not in this repo.
- Thresholds were tuned on a DEV half of traders' scored calls and frozen before a TEST half. On TEST: recall 20.1%
  (the four older pullback scanners: 19.4%), fire rate 5.36% of random ticker-days (older: 10.04%).
- A blind review of 25 fires on random days: 19 yes, 1 no, 5 ambiguous. A second blind packet: 21-EMA tags were judged
  right 43 times out of 44 (97.7%); 50 and 200-day tags only 46% (200-day: 0 of 7). That is why the scanner reports only
  21-EMA tags.
- **The key result:** "The same report found no measured forward-return edge, and the tag-bar-low stop is hit at the
  same rate as a random stop at that ATR distance".
- **Limits:** this measures whether the scanner finds what traders call the setup, not whether it makes money. The
  samples are small. It is unreplicated. The "no edge" finding is for the scanner's own entry (the close of the tag
  day) and stop (the tag-bar low), with no market filter, no RS filter and no owner-style intraday trigger.

### 4.2 Moving-average distance (peer-reviewed; supports the trend filter, not the entry)

Doron Avramov, Guy Kaplanski and Avanidhar Subrahmanyam, "Moving average distance as a predictor of equity returns",
*Review of Financial Economics* 39(2), 2021, pages 127-145 ([RePEc abstract](https://ideas.repec.org/a/wly/revfec/v39y2021i2p127-145.html);
earlier working paper [SSRN 3111334 PDF](https://anderson-review.ucla.edu/wp-content/uploads/2021/03/Avramov-Kaplanski-Subra_2018_SSRN-id3111334.pdf)).
- Abstract: "The distance between short‐ and long‐run moving averages of prices (MAD) predicts future equity returns in
  the cross section." and "MAD‐based investment payoffs survive reasonable trading costs faced by institutions, and are
  stronger on the long side relative to the short counterpart." The abstract reports annualized value-weighted alphas
  "around 9%".
- Working paper: "the greater the positive (negative) distance between a short-run (21-day) and a long-run (200-day)
  average, the higher (lower) is the average return." MAD is defined as the 21-day moving average divided by the 200-day
  moving average (Appendix A).
- **How measured:** monthly sorts of U.S. stocks into portfolios by MAD; regressions with controls for momentum, the
  52-week high and other known effects; also tested across countries. The U.S. sample in the working paper runs from
  June 1977 to October 2015.
- **Limits for us:** it supports trading stocks whose short-term average is well above the 200-day, which our trend
  rules already require. It says nothing about buying the pullback to the line, about stops, or about holding periods of
  days to weeks. The working paper also reports that portfolios built on extreme MAD deciles "produce Sharpe ratios
  that are not significantly greater than that of the value-weighted CRSP index" (its Appendix F summary). (Added in
  checking.)

### 4.3 Bulkowski's moving average study (measured, but a different question)

Thomas Bulkowski, "Bulkowski's Moving Average Study", thepatternsite.com ([link](https://www.thepatternsite.com/MovingAvgs.html)).
Read through a fetch tool because the site returned 406 to plain curl. **Notice: the site states that it "shall not be
used to train artificial intelligence (AI) systems"**; the Study module is training material, so I record only what
the study is and use none of its numbers. He logged where 21,696 chart-pattern breakouts (April 1989 to January 2009)
stood relative to 9, 20, 50 and 200-day simple averages. It measures breakouts from chart patterns, not pullbacks to a
moving average, so it does not answer our question.

### 4.4 Statements that sound like statistics but are not

- Raschke (1997): "With this pattern, the odds that a top is in place is probably only 5% to 10%." This is her estimate
  in an interview. No sample, no method. It must not be taught as a measured rate.
- Raschke (2000) speaks of a system that "works, say 70 to 80 percent of the time" while explaining failed signals. It
  is a hypothetical, not a Holy Grail measurement.
- The app's `pullback_to_21ema.py` narrative says Minervini's backtests show "hit rates in the 65-75% range". I found no
  source. It must not be shown (section 5.6).
- Trading blogs report win rates from about 32% to 68% for "20 EMA pullback" strategies with no sample sizes or
  out-of-sample tests. They are not sources and are not used.

### 4.5 20 versus 21: how much does it matter? (my arithmetic, not a published statistic)

For a stock rising at a steady rate, an EMA of length N lags price by (N - 1) / 2 sessions of that rise: 9.5 sessions for
the 20 EMA and 10 for the 21 EMA. So the two lines sit about half a session's move apart. For a leader rising 0.5% a day
that is about 0.25% of the price; for one rising 0.2% a day, about 0.1%. On a daily chart the two lines look the same.
The choice matters only for the wording of the rule and for scanner edge cases.

### 4.6 What would settle it

A test the owner can approve: run the rules in section 8 (RS 80+, $20M, above the 200-day, Green or Yellow market,
first or second tap, the owner-style trigger and day-low stop, the house 3R/5R and trail) over five or more years of
daily bars, and compare with (a) the same stocks bought at random days and (b) the breakout version. Report win rate,
average R, expectancy and the worst run of losses, out of sample.

---

## 5. Our app: what the scanners and pages actually say

### 5.1 `api/services/pattern_engine/detectors/uct/uct_pullback_ma_v5.py` ("UCT MA Pullback v5", internal, admin-only)

Status: computed and stored but hidden from members (`auto_structures.py` keeps `MEMBER_PULLBACK_MA_V5_ROUND = None`).
The rule at a session (ATR is a 14-session simple average of true range; MAs are 21 EMA, 50 SMA, 200 SMA; the EMA is
seeded with the first close):
1. **History:** at least 220 bars (the 200 SMA must exist now and 20 sessions ago); the scan hands it 222.
2. **Power trend:** 21 EMA above the 50 SMA, and the 50 SMA above its value 10 sessions ago.
3. **Rising 21 EMA:** 21 EMA above its value 10 sessions ago.
4. **200-day:** close above the 200 SMA, and the 200 SMA not lower than 20 sessions ago by more than 0.10 ATR.
5. **A real pullback:** the highest high of the last 11 sessions minus the close is at least 1 ATR.
6. **The tag:** in the last 3 bars, a bar's low sits between 1 ATR under and 0.25 ATR over a moving average, with today's
   close at or above that average. Only a 21 EMA, 50 SMA or 200 SMA tag on the marked session or the one before counts
   (8 EMA tags never count).
7. **Depth guards:** the tag bar closes no more than 0.5 ATR under the line; today's close is no more than 1 ATR above it;
   if the prior close was above the 21 EMA or 50 SMA, today's close is no more than 0.5 ATR under them.
8. **Universe:** a hand list of commodity, volatility and leveraged ETFs is excluded.
9. **Wrapper:** price at least $2 and average dollar volume at least $10,000 over 20 bars (`primitives/liquidity.py`);
   the newest of the last 3 sessions that qualifies; an older trigger is dropped once a later bar trades under its stop;
   confidence at least 50; **only 21-EMA tags are reported** (`SURFACED_VARIANTS`).
10. **Levels:** entry = the close of the marked session; stop = the tag bar's low; targets at 2R and 3R
    (`uct_setups_common.make_levels`). The narrative also says to watch "A break of the prior session's high".

### 5.2 `api/services/pattern_engine/detectors/uct/pullback_to_21ema.py` ("Pullback to 21-EMA (Minervini SEPA)", shown to members)

Status: listed in `api/routers/patterns.py` (line 592) as a member-facing pattern, and the journal suggests the tag
"20 EMA Pullback" when it fires (`app/src/pages/journal-2-0/lib/setupTagMap.js` line 99).
1. **History:** at least 84 bars.
2. **Context gates** (from `api/services/pattern_engine/primitives/context.py`):
   - `trend_stage == 2`: close above the 150-day SMA and the close more than 2% above the close 49 sessions earlier
     (the first close of the last 50; a price change, not the average's slope). This is the branch for 200 or more bars,
     which is what the daily scan hands the context;
   - `ma_alignment == "stacked_bullish"`: **close > 10-day SMA > 20-day SMA > 50-day SMA > 200-day SMA**;
   - `rs_trend == "up"`: the stock's last-20-bar return beats its prior-20-bar return by more than 3 points. Despite the
     name, there is no comparison to the market.
3. **Rising 21 EMA:** above its value 10 bars ago, at least 0.04% a bar on average.
4. **Touch:** a bar in the last 3 whose body low and low are at or under the current 21 EMA times 1.015. There is no
   lower limit, and the test uses today's EMA value for all three bars.
5. **Reclaim:** a close above the current 21 EMA on that bar or one of the next two.
6. **Volume:** the touch bar's volume under 1.1 times the average of the 20 bars before it.
7. **Confidence** at least 50 (0.40 geometry, 0.25 volume, 0.20 context, 0.15 fixed).
8. **Levels:** entry = the touch bar's high plus 0.1%, written as `entry_condition` "close > ... (pullback bar high +
   0.1%)"; **stop = 21 EMA minus 1 ATR** (ATR = the plain average of the last 14 true ranges); one target at 3R.
9. **No price or liquidity floor** in the detector itself (it does not call `liquidity_floor`). The nightly run scans the
   app's full `cap_universe` list (`api/main.py`, `_run_patterns_universe_scan`); whether that list has a price or
   dollar-volume floor was not checked.

### 5.3 Other places the app defines this pullback

- **Screener preset** "Momentum pullbacks (20EMA)" (`api/services/screener/saved_screens.py` line 681): "RS 80+ stocks
  3% below to 1% above a rising 20 day EMA, above 50 day, $20M+ traded". This matches house rule C31 and the $20 million
  half of B23 (it reads a 30-day dollar volume); it sets **no price floor**, so B23's $10 minimum is missing.
  (Corrected in checking: the first draft said it already matched B23.)
- **Holy Grail scanner** (`api/services/pattern_engine/detectors/uct/holy_grail.py`): ADX(14) over 30 (not "rising"),
  +DI over -DI, a low within 1.5% over the 20 EMA in the last 3 bars (no lower limit), a rising 20 EMA, the last 3 bars'
  volume under the prior 10; entry 0.1% over the pullback bar's high, stop = pullback low minus 1 ATR, target = recent
  swing high plus 1 ATR. Its member-facing description says "+ close above EMA", but the code does not check the close.
  Raschke's stop is the new swing low, not the low minus 1 ATR.
- **Chart IQ engines** (`api/services/chart_iq/engine/`): `v2_setups.py` line 110 (low within 0.25 ATR over the 21 EMA
  or 50 SMA, close no more than 0.25 ATR under it, close in the top 40% of the range); `v3.py` line 238 (today's or
  yesterday's low within 0.3 ATR over the 21 EMA or 50-day, close no more than 0.1 ATR under it, and a close at least
  1.5 ATR above today's line on one of the nine sessions from 10 to 2 sessions back); `markup.py` lines 510-515 name
  variables `e10` and
  `e21` but compute **simple** averages and test a 0-2% band.
- **Morning Wire "pullback_ma" bucket** (the wire data's candidates, read by `_pull_scanner_setups` in
  `api/services/catalyst/sources.py` and upper-cased), which `api/services/catalyst/brain_grades.py`
  (`_SCANNER_SETUP_MAP`: `PULLBACK_MA` and `PULLBACK`) maps to "20 EMA Pullback": built in the external morning-wire
  repo, which is not checked out here, so its rule was not reviewed.

### 5.4 The Model Book card and playbook

- Card (`setupCatalog.js` lines 97-104): family "Momentum & Trend", long; essence quoted in 3.8; EMAs drawn: 9 and 20;
  the glyph shows a rise, three red candles into the line, a small holding candle, then two strong green candles.
- Playbook (`setupPlaybooks.js` lines 235-284): the intraday version quoted in 3.8.
- **The two disagree with the owner's daily practice** on the time frame and on the 9 EMA: the card makes "the remount of
  the 9 EMA" the buy; the owner's posts mention a 9/20 remount only now and then ("preferably lining up with a remount
  of the 9/20EMAs", 2026-01-04) and usually buy the intraday turn at the 20.

### 5.5 Journal tags

- `app/src/constants/setupGroups.js` (the Model Book "Add Setup" list) has **no "20 EMA Pullback"**. The nearest are
  "Classic Flag/Pullback", "Remount" and "Go Signal". So a member labelling a Model Book trade cannot pick the owner's
  catalog name from that list.
- The journal's canonical tags (`setupTagMap.js`) do include "20 EMA Pullback" (from the catalog), and map
  `pullback_to_21ema` to it but `pullback_to_10ema` and `pullback_to_50sma` to "Classic Flag/Pullback".

### 5.6 What looks wrong (most serious first)

1. **Unsourced claims shown to members.** `pullback_to_21ema.py`'s narrative and its `patterns.py` description attribute
   to Minervini: the 21 EMA as SEPA's "PRIMARY support", a "low-volume contraction" (LVC) signal, a "natural stop" at 21 EMA
   minus 1 ATR, a "3R minimum target", "hit rates in the 65-75% range", a "220-month live track record of 33,500%+",
   research limited to "$300M cap and 200K+ avg daily volume", first profit "at 2R (50% of position)" and 25% more at 3R,
   and a "HARD STOP" at down 3%. I found no Minervini source for any of these. The "220-month" figure looks garbled:
   secondary sources commonly repeat an average of 220% a year (for about 1994-2000), not 220 months; I read no primary
   source for either figure, so neither may be shown.
   The repo is public and members read these texts. **Recommendation: strip every Minervini attribution and every
   number that has no source** (owner question 13).
2. **The context gate fights the setup.** `stacked_bullish` needs today's close above the 10-day SMA. A stock sitting on
   its 21 EMA after a real pullback is usually below its 10-day. So the scanner can mostly fire only after the bounce has
   already happened, or on a bar that closes far off its low. Its entry (the touch bar's high plus 0.1%) may then be
   behind price. **Measured in checking** on the sandbox's daily bars (3,874 tickers; days at $10 or more with a 20-day
   average of $20 million traded, close above the 200-day SMA, 21 EMA rising at least 0.04% a bar): of 268,395 days
   whose low reached the 21 EMA and whose close finished back above it, 35.1% closed above the 10-day SMA and 17.4%
   passed the whole `stacked_bullish` test. With the detector's own looser touch (low and body within 1.5% over the
   line; 675,090 days) the figures are 52.2% and 30.4%. Script:
   `scratchpad/setups/11-ema20-pullback/scripts/stack_gate.py` (not in the repo). This checks the touch day only; the
   detector can also fire up to two sessions later, after a bounce.
3. **The stop is far from the house stop.** 21 EMA minus 1 ATR puts the risk at more than one full ATR whenever the
   touch bar's high is above the line, for example more than 4% on a stock with a 4% ATR. House rule A3 puts the stop a
   few cents under the day's low, usually within about 3% (A13).
4. **No liquidity floor** in `pullback_to_21ema.py` and `holy_grail.py`; v5's floor is $2 and $10,000 a day. House rule
   B23 is $10 and $20 million a day.
5. **Targets.** All scanners use 2R and 3R (or 3R alone). The house plan is a third at 3R, a third at 5R, and a trail.
6. **Entry type.** `pullback_to_21ema` and `holy_grail` put the entry 0.1% over a high but write the condition as a
   close above it (`entry_condition: "close > ..."`), which is neither a resting buy stop nor a market order; v5 enters on
   the close. The house enters with market orders (E57). Teach it as: when it trades there, buy at market.
7. **Names.** The owner says 20 EMA; v5, `pullback_to_21ema` and rule E52 say 21. Pick one word for members (question 3).
8. **v5's own measured result** is "no measured forward-return edge" for its close entry and tag-bar-low stop. The course
   should not present the scanner's levels as a tested plan.
9. **Holy Grail description** promises a close-above-EMA check the code does not make, and its stop and trend filter
   differ from Raschke's printed rules.
10. **Chart IQ `markup.py`** calls simple averages `e10` and `e21`. Harmless for members if the labels say 10-day and
    21-day line, misleading for anyone reading the code.
11. **Model drafts are not sources.** `docs/curriculum/curriculum_final_v2.json` (line 3985; the course drafts that
    `docs/curriculum/HANDOFF.md` calls "unpublished drafts") calls this an "ADD-ON/continuation" play "never to open a
    new trade". That contradicts the owner ("immediate full size") and rule A5
    (no adding). Do not carry that line into Study.
12. **TRADE_PLANS.md** has no plan for this setup yet.

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com). I downloaded all 103 posts in the sitemap
(one, 2026-10-18, is subscriber-only and was not read) and searched every one for 20/21 EMA wording, squat, first tap, first test, first pullback and remount. The
owner writes about this setup in nearly every issue; below is a representative, complete-by-theme selection.
**Checked 2026-11-09 by a second reader** against fresh copies of all 103 posts from Substack's API: every quote below
is on its page word for word, and each "owner", "Bracco", "unsigned" or contributor label was checked against the
section heading the quote sits under. One label was wrong and is fixed (IONQ is Bracco's, now in 6.10); the evening
posts' dates were moved to their own stated dates (see the note at the top).

### 6.1 What it is to him

- "This is pretty much my bread and butter. Setting up off the 20ema here. Any sort of GO SIGNAL would allow me entry
  with immediate full size." (owner, ALAB, [Sunday Scans 2025-06-08](https://unchartedterritoryy.substack.com/p/sunday-scans))
- "Bought today at $147.30 with a stop at today’s low. A classic drift and hold at the 20EMA. This is my main go to setup
  for the most part." (owner, DELL, [The Rest of the Week 2025-10-21](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481))
- "I am mostly a 20EMA kind of guy." and "My ideal stocks and broad setups are seeing that exact style of upside reversal
  on individual names at the 20EMA. It is my GO SIGNAL." (owner, [Sunday Scans 2025-11-09](https://unchartedterritoryy.substack.com/p/sunday-scans-720))
- "I’m a 20EMA loyalist and took my shots on the stocks I wanted." (owner, [Sunday Scans 2026-10-04](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6))
- "Classic flag and 20EMA pullback." (owner, PENG, [Sunday Scans 2026-06-21](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0))
- The owner's Go Signal work ties the two together. On a set of daily Go Signal charts he wrote "Gonna need to see the
  hourly but there are all most likely good 20EMA APULLBSCKS or UNR setups" (NVDA fixture), and the verdict log's note
  on his 2026-10-27 Go Signal definition records the daily footprint as "usually a 20-EMA pullback or a UNR" (the note's
  words, not his; `docs/study/audits/2026-10-24/owner_verdicts.jsonl`). So in his method the 20 EMA pullback is the
  daily location and the Go Signal is one of its hourly triggers.

### 6.2 The context he wants

- **Leaders, liquid, with a level to lean on:** "I prefer key levels of support, 20EMA or 50SMA, notable bull gap holds
  or weekly levels, undercut and reclaims. Anything sensible that I can logically risk against and repeat on RS names and
  liquid leaders." (owner, [2026-07-05](https://unchartedterritoryy.substack.com/p/sunday-scans-dec))
- **A rising line and the right order:** "Now we have an inside day and a higher low at a rising 20EMA?" (owner, TWLO,
  [2026-09-06](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd)); "Next important steps is to get the Moving
  averages stacked with trend structure criteria. 9EMA>20EMA>50SMA>200SMA." (unsigned intro, [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43))
- **After a big move, the first test:** "First test of 20EMA following a +125% move in 15 days." (unsigned, HIMS, [Week
  Ahead 2025-06-01](https://unchartedterritoryy.substack.com/p/week-ahead)); "Major upside reversal at the 20ema and
  holding its previous open bullish gaps following a 190% upside move in 5 weeks. This is the creme of the crop type of
  setup for continuation. Next hourly higher low is actionable." (owner, FLNC, 2025-11-09); "First tap of 20EMA held and
  a strong response today." (owner, DOCN, [The Rest of the Week 2026-03-31](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-13b);
  on the sandbox's daily bars DOCN's low touched the 20 EMA on Mon 2026-03-30 and it rose 9.5% on Tue 3/31)
- **Stretched leaders are worth the wait:** "Long from $34, would be super okay if it rested more as the stock is nearly
  50% away from 50SMA. 20 ema tap would be 100% actionable imo." (owner, NBIS, under "TSDR WATCHLIST" in [Market
  Update and Watchlist 2025-06-19](https://unchartedterritoryy.substack.com/p/market-update-and-watchlist))
- **Not a falling line:** "in between a declining 20EMA and rising 50SMA is no mans land and I must wait for proper
  signal." and "wedging up into a declining 20EMA here I would view as negative and look for rejections." (unsigned
  Index & ETF section, ARKK, [2025-08-03](https://unchartedterritoryy.substack.com/p/sunday-scans-726))
- **Not below the line:** "Not going to be trading this until it gets back above the 20EMA simple as that." (owner,
  ARM, [2026-10-11](https://unchartedterritoryy.substack.com/p/sunday-scans-31b))

### 6.3 The pullback itself

- **Quiet and orderly:** "I really appreciate the low volume of this six day pullback into the 20EMA. Inside day on
  Friday." (owner, RDDT, [2025-07-13](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6)); "the Russell2000
  had six orderly days of pullback into the 20EMA." (unsigned, [2025-08-24](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa))
- **Time to build:** "My ideal situation is that the best stocks get some wiggle and come into the 20EMA with 1-3 weeks
  of build out." (owner, [2026-05-31](https://unchartedterritoryy.substack.com/p/sunday-scans-6d8))
- **Shakeouts and squats are welcome:** "These shallow shakeouts below the 20EMA and tight higher low afterwards are prime
  spots." (unsigned, [2025-08-10](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f)); "The squat is the best by
  the way. Failed breakout into an undercut of the breakout spot and tap into the moving averages then go. Such a great
  risk to reward and very reliable, especially lately." (unsigned, 2025-08-24); "preferably we get a shakeout bar or
  squat to the 20EMA and then find buyers again. This would allow heavy sizing and tight risk." (owner, INTC,
  2025-10-21); "Can’t deny the simple setup of an inside day after a 20EMA shakeout." (owner, SMTC, 2026-06-21);
  "Really want this to shakeout into the 20EMA, that would be ideal to grab it on the squat." (owner, Q, [2026-02-22](https://unchartedterritoryy.substack.com/p/sunday-scans-04c)).
  (The IONQ line "In a perfect world this undercuts the 20EMA and reclaims." that stood here is Bracco's, under "Bracco
  - IONQ"; moved to 6.10 in checking.)
- **He waits for it rather than chase:** "Would prefer 20 ema shakeout but cant deny this tight flag" (owner, CLS,
  2025-06-08); "Was pretty adamant throughout the week that it was best to wait for a shakeout to the 20EMA." (owner, BE,
  [2026-09-27](https://unchartedterritoryy.substack.com/p/sunday-scans-09b))

### 6.4 The trigger

- **The menu, in his words:** "Here is my approach. Give me an oops. Give me some sideways and a tap of the 20EMA. Give me
  an inside day. Give me a clean retest or remount after and undercut." (owner, 2026-09-06)
- **Intraday turns:** "Anything in the $87-$90 range and reclaim of red to green spot, previous day’s low, or opening
  range and I am a buyer." (owner, ALAB, 2025-06-08); "The daily 20EMA and $46.30 the main spots I am watching for entry.
  Ideal on gap down, hold, and break opening range." (owner, NBIS, [2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2));
  "Ideal would be tight entry off 20ema on a gap down and Go Signal." (owner, INTU, 2025-06-22)
- **A full worked trade:** "I traded TSLA against the 20EMA as it undercut previous day’s low, reclaimed, had an hourly
  candle hold and used the low of that candle as my stop." and "Risk was $2.50 per share to that low and I risked 1% of
  my account on the trade." (unsigned intro, written in the first person, [2026-01-11](https://unchartedterritoryy.substack.com/p/sunday-scans-0b3))
- **Others:** "I bought with $117.60 average when we reclaimed the previous day’s low." (owner, XOM, [2025-11-18](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c);
  same paragraph: a flag "that held the 20EMA today");
  "Main entry day at the 20EMA shake and 30 Minute Pivot at $895. A top tier example of the strategy." (owner, LITE,
  2026-10-11); "The 20EMA undercut and reclaim on 8/7 is tight risk plus the RS that it has shown is worthy of my risk!"
  (owner, DELL, [2026-08-16](https://unchartedterritoryy.substack.com/p/sunday-scans-da5)); "A gap down red to green
  Monday would be an A+ setup in my book." (owner, BE, [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8))
- **Candles and patterns he names at the line:** "AFRM I added Friday with Manrav, loved the hammer at the 20EMA."
  (owner, [2025-09-14](https://unchartedterritoryy.substack.com/p/sunday-scans-461)); "I want to see some stories and
  stocks get tight and offer good entries against the 20EMA via wedge pop or crossback." (owner, [2026-02-08](https://unchartedterritoryy.substack.com/p/sunday-scans-29e)),
  which is Kell's vocabulary (section 3.2).
- **The 9/20 remount (the Model Book card's trigger) appears as a preference, not the rule:** "As soon as this triggers a
  break of previous day’s high, preferably lining up with a remount of the 9/20EMAs then we can smash it." (owner,
  [2026-01-04](https://unchartedterritoryy.substack.com/p/sunday-scans-153))
- **Not always waiting for the tap:** he "made a detailed video to the group about when to try things above the 20EMA
  instead of fully waiting for that 20EMA tap." (owner, MRVL, 2026-10-04). That video is in the private group, not read.

### 6.5 The stop and the size

- Day's low: "Thought this was a really good spot to try it on Thursday against the LOD and 20EMA. Got in at $533 mid
  morning with a $3 stop and now up comfortably. Stop is now Friday’s low at $541." (owner, DELL, 2026-09-27). A $3 stop
  on $533 is about 0.6% (my arithmetic).
- An hourly candle's low (TSLA, above). Today's low (DELL 2025-10-21, above; that day's low on the sandbox's daily bars
  is $145.09, so about 1.5% under the $147.30 buy, my arithmetic).
- Sometimes the line itself, for a position already working: "Followed contributors in the group into TWLO on Monday over
  Friday’s high. Stop is 20EMA." (owner, [2025-11-30](https://unchartedterritoryy.substack.com/p/sunday-scans-422))
- Full size at one spot: "Any sort of GO SIGNAL would allow me entry with immediate full size." (2025-06-08)

### 6.6 Managing the trade

- "I like to look for 3-5-7 days of strength following a tight risk entry. I sell partials into that strength." and
  "Then I ride the consolidation and basing using a 9EMA, 20EMA stop as they come through my entry and my trim prices."
  (owner, [2025-10-19](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc))
- "I keep my stop my stop until the 20EMA comes above my entry, then I will move my stop to breakeven and trail the 20EMA
  close. Then when the 50SMA crosses above my entry I will trail the 50SMA." (unsigned intro, first person, [2026-05-10](https://unchartedterritoryy.substack.com/p/sunday-scans-68a))
- "Then trailed the 20EMA as it came through my buy price and first trim, then trailed the 50SMA as it came through my
  buy price and trim price." (owner, PL, [2026-03-22](https://unchartedterritoryy.substack.com/p/sunday-scans-cab))
- "Buy supports and sell into strength, trail your winners along the 9ema/20ema as they advance through levels and
  according to RR metrics and sizing." (unsigned closing comments, [2025-12-07](https://unchartedterritoryy.substack.com/p/sunday-scans-088))
- Earlier he used two closes: "My stops are now trailing at two consecutive closes below the 20ema on these." (owner,
  2025-06-22)
- He offers the trail as a test, not a law: "Sell ONLY and ALL when the stock closes below the Daily 20EMA" is one of four
  exits he suggests members back-test ([2026-06-14](https://unchartedterritoryy.substack.com/p/sunday-scans-e95)).

### 6.7 The market filter

- "As long as we are above the 20 ema on the daily chart (PINK line down there at $514ish) our job is to stay aggressive
  and look for opportunities in stocks." (unsigned, about the QQQ, 2025-06-08)
- "For me, its holds of the 20EMA such as 6/23. That was the spot to be aggressive and in the first 2-3 days off that
  spot." (owner, on defining buy days for the market, [2025-07-06](https://unchartedterritoryy.substack.com/p/sunday-scans-df6))
- "Broadly, 20EMA guides me more than anything when it comes to the indexes." (unsigned Index & ETF, [2025-08-17](https://unchartedterritoryy.substack.com/p/sunday-scans-644));
  "The easiest is the 20EMA and the QQQ." (unsigned intro, [2026-03-08](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf));
  "keep the gun in the holster until 20EMA is remounted and setups are present!" (unsigned Index & ETFs, [2026-06-28](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1))
- "You will always wish you traded less when the indexes are below the 20EMA." (unsigned intro, [2026-04-05](https://unchartedterritoryy.substack.com/p/sunday-scans-356))
- "Something simple like the 50SMA or the 20EMA. No trades when XYZ is below these." (unsigned Index & ETFs, [2026-08-02](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2))
- But not rigidly: "It’s like saying XLU (Utilities ETF) is below the 20EMA so therefore I cannot trade META on the Muse
  news." (unsigned intro, 2026-09-27), and "Upside reversals I do take as signal and I am not necessarily completely sit
  out until 20EMA is reclaimed." (unsigned, [2025-11-23](https://unchartedterritoryy.substack.com/p/sunday-scans-56d))

### 6.8 Shorts (the mirror)

- "With shorts, I am extremely picky and try to get 1-2 per cycle when they are presented." "I want them below the
  200SMA for sure and often on a decent pop back up and rejection coinciding with the 50SMA or 20EMA." "Something with a
  clear invalidation spot and likely sellers." "Essentially the same tactics I use for longs but just incredibly more
  selective." (owner, [2026-11-01](https://unchartedterritoryy.substack.com/p/sunday-scans-669))

### 6.9 Failures and misses he reported

- "This week I took CRM on the oops reversal and red to green move at the 20EMA and took a 4% loss on the gap down when
  ServiceNow dumped." (owner, 2026-11-01). A gap through the stop: house rule B20 covers it.
- "SHOP was nice but closed below the 20EMA ahead of earnings knocking me out." (owner, [2026-11-08](https://unchartedterritoryy.substack.com/p/sunday-scans-70f))
- "My concern is never the stock failing, I will just stop out." (owner, 2026-06-21)
- Missed ones he regrets: "Fairly bummed I don’t have a position in this right now, Has given chances under $60 but I have
  had the visual of one little failed break and squat to the 20EMA for a while now." (owner, MP, 2025-08-03)

### 6.10 Bracco and the contributors

- Bracco: "20 EMA shakeout bar on Thursday to weed out the late chasers" (2025-06-08); "It reclaimed the moving averages
  with authority on Monday and then gave us double inside days right at the 20ema." (ETH, 2025-08-10); "IWM trading +6%
  higher from original entry off the 20ema on 8/21." ([2025-09-07](https://unchartedterritoryy.substack.com/p/sunday-scans-52e));
  "My original plan was to trail the 20EMA and look for re-add spots." ([2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1));
  "Usually will see some pretty intense back and forth volatility on the first pullback after an extension" ([2026-05-17](https://unchartedterritoryy.substack.com/p/sunday-scans-679)).
  On IONQ after "a +80% move in 9 days", "down 5 days in a row with volume declining last 4 days. Low of today was
  rising 20EMA support." and "In a perfect world this undercuts the 20EMA and reclaims." He framed it as "a short term
  mean reversion bounce trade" and would be "aggressive in taking profits" ("Bracco - IONQ", [The Rest of the Week
  2025-09-30](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week); the first draft labelled the last
  sentence the owner's).
  Intraday, for his parabolic shorts: "I shift the remaining stop to trail the 5-minute 20EMA or VWAP, based on the
  setup’s quality and price action characteristics." ([The Parabolic Short](https://unchartedterritoryy.substack.com/p/the-parabolic-short))
- Manrav (TSLA): "Want to see the 21 EMA hold or an undercut and reclaim is even better to get long/add to the position.
  No interest below 21 EMA in the short term (if you are a swing trader)" ([2025-11-04](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9))
- ChartMaster (LMND): "Fake breakout, squated to the 21ema found support and bounced right back to 82 resistance."
  ([2025-12-16](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-4fe))

### 6.11 The owner's verdict log

`docs/study/audits/2026-10-24/owner_verdicts.jsonl` has no ruling on this setup yet. Related entries: his Go Signal
definition (2026-10-27), whose recorded note calls the daily footprint "usually a 20-EMA pullback or a UNR" (the note's
words); and, on a 2022 bear-market bounce into the 20 EMA (NVDA 2022-07-25), his words "Gonna need to see the hourly but
there are all most likely good 20EMA APULLBSCKS or UNR setups". That example was below its 200-day, which rule B26
(2026-11-09) now forbids for longs (question 12). He kept the AAPL 2022-09-01 Go Signal and graded it "good"; the log
describes that chart as a "pullback from the August high into the 20 EMA". **Checked on the sandbox's daily bars:** on
2022-09-01 AAPL closed at $157.96, under its 200-day SMA (about $161.06) and 1.75 ATR under its 20 EMA (about $163.78),
with a falling 20 EMA; NVDA on 2022-07-25 closed at $17.02 (split-adjusted) against a 200-day of about $23.30. So
neither is a long under B26, and AAPL on that date is not a 20 EMA hold by the rules in section 8 (question 12). His
Oops ruling against "a
random big red day prior" (ULTA) and his preference for orderly pullbacks over sharp ones (WSM) are borrowed in 8.1 by
analogy.

### 6.12 A UCT workshop on this exact topic (not watched)

The Desk's video library lists a UCT workshop titled in the app "Playbook Review On Pullback Buys", with the chapter
"13:24- The pullback buy (9 & 20 EMA pullback and gap and go)" (`api/services/education_seed.py`, YouTube id
6hM1efa3YSM). YouTube's own title is "Sharpen Your Trading Skills", channel "Uncharted Territory"; the watch page gives a
publish date of 2024-08-08 and a length of 59 minutes. The page lists an automatic (speech-recognition) caption track,
but the caption request returned nothing to a plain client, so I could not read a transcript, and I did not try to get
around that. Who presents it was not confirmed. It is probably the richest source of the owner's rules for this setup
(question 14). Other chapters: "43:26- Scaling and moving stops", "51:57- V-wap vs EMA weighting", "56:02- PLTR
example of a pullback buy".

### 6.13 Candidate examples from UCT's own posts (leads to chart and grade, not verified on charts)

The owner asked for examples to model. These are dated setups UCT itself named. Each needs a chart check against the
rules in section 8 before it is used.

| # | Stock | Session | What UCT wrote | Flags |
|---|---|---|---|---|
| 1 | ALAB | triggered Wed 2025-06-18 | "bread and butter" (2025-06-08); "ALAB triggered Wednesday afternoon and closed at HOD." (owner, 2025-06-19) | check C31 |
| 2 | RDDT | inside day Fri 2025-07-11 | low-volume six-day pullback into the 20EMA; two scenarios given, inside-day-high break or undercut and reclaim of $141.30 (owner) | check which happened |
| 3 | DELL | Tue 2025-10-21 | "A classic drift and hold at the 20EMA", bought $147.30, stop today's low (owner, posted that evening) | |
| 4 | FLNC | upside reversal, probably Fri 2025-11-07 | "Major upside reversal at the 20ema" after 190% in 5 weeks (owner, 2025-11-09) | day not stated in the post |
| 5 | XOM | Tue 2025-11-18 | flag "held the 20EMA today"; bought the prior-day-low reclaim at $117.60 (owner, posted that evening) | |
| 6 | DELL | Tue 2026-03-31 | "Tuesday gave the first pullback to the 20EMA and a $19 advance from there." (owner) | the QQQ was below its 200-day |
| 6b | DOCN | tap Mon 2026-03-30, response Tue 3/31 | "First tap of 20EMA held and a strong response today." (owner, posted 3/31) | added in checking; ATR about 8% |
| 7 | DELL | Fri 2026-08-07 | "The 20EMA undercut and reclaim on 8/7 is tight risk" (owner) | |
| 8 | DELL | Thu 2026-09-24 | "against the LOD and 20EMA", in at $533 with a $3 stop (owner) | |
| 9 | BE | Thu 2026-09-24 | shakeout to the 20EMA on news into $251; "S tier type setup" (owner) | |
| 10 | LITE | the week before 2026-10-11 | "20EMA shake and 30 Minute Pivot at $895. A top tier example" (owner) | exact day not given |
| 11 | ARM | before 2026-06-14 | "such an obvious buy off $300 and the 20EMA" (owner) | exact day not given |
| 12 | TSLA | not given (post dated 2026-01-11) | undercut of the prior day's low, reclaim, hourly hold; $2.50 risk | unsigned intro; day not given |
| F1 | CRM | week of 2026-10-26 | oops and red to green at the 20EMA; 4% loss on a gap down (owner) | a failure example (B20) |
| F2 | SHOP | before 2026-11-08 | closed below the 20EMA ahead of earnings, stopped (owner) | a failure example (B22) |

**Checker's data notes (sandbox daily bars; ATR = 14-day average true range; 20 EMA of closes).** On the dated hold
sessions (#1-#9 and 6b) every one closed above a rising 200-day SMA, had a rising 20 EMA above the 50-day SMA, traded
far more than $20 million a day and was priced over $10 (FLNC $20.79), and its low sat between 0.36 ATR under and 0.12
ATR over the 20 EMA, inside the touch band proposed in 8.1. But three closed **more than 1 ATR above** the 20 EMA on
that session: ALAB 2025-06-18 (+1.44 ATR), XOM 2025-11-18 (+1.12) and FLNC 2025-11-07 (+1.05), because the owner buys
the intraday turn and the stock kept running into the close. See the note under 8.1's close-distance line.

Excluded from examples by house rules: the owner's 2025 trades under $10 (rule B23): GPRO ($1.55, "bought 20EMA hold"),
CIFR ($5.76, trailed on the 20EMA), WULF ($6.90, later $8.60 average, trailed on the 20EMA) and OPEN ($3.40 and $6.10,
a news move rather than a 20 EMA buy); and bear-market bounces under the 200-day (rule B26).

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | How it applies here | Conflict? |
|---|---|---|
| A3, F62 stop a few cents under the day's low | This setup's natural stop is exactly that: the low of the hold day (or its hourly candle). | None. The scanners' stops (tag-bar low; 21 EMA minus 1 ATR) should yield to it. |
| A13 stop usually within about 3% | The owner's examples are tight (DELL about 0.6%). A hold-day low on a volatile leader can be wider. | If the honest stop is wider than the risk budget allows, size down or skip (A3, A5); never move the stop up to fit. `pullback_to_21ema`'s stop is usually more than 1 ATR, often over 3%. |
| A5 full size at one price, no adding | The owner buys "immediate full size". | TraderLion's "scale in" and the model drafts' add-on-only line conflict; A5 wins. |
| B19, E51 trims 1/3 at 3R, 1/3 at 5R; breakeven 2R-5R | Applies as the house default. | Raschke's exit at new highs and the scanners' 2R/3R are not ours. |
| E52 trail under the 10-day (fast) or 21-day (steadier) on a close below | Applies. The owner's own habit for this setup is the 20 EMA close, then the 50 SMA, starting only once the line passes his entry. | Naming: E52 says 21-day, he says 20EMA. Timing: E52 does not say when the trail starts; for a buy made at the line it must start only after the line rises past the entry (question 10). |
| B20 gap through the stop | CRM was this case. | None. |
| B22 no new buys in the 3 days before earnings; hold through a report only if up 5R | SHOP failed into earnings. | None. |
| B23 $10 and $20 million a day | Removes Bonde's small-cap worry and several of the owner's 2025 trades. | The scanners' floors are far lower; the screener preset has the $20 million but no $10 floor. |
| B26 no longs below the 200-day (hard rule) | A true 20 EMA pullback lives above a rising 200-day. | The owner's 2022 NVDA bounce example was below it; not allowed now. |
| C28 no chasing more than 4% past the buy point | Matters when the trigger day gaps up. | None. |
| C29 skip a long more than 10% above its 10-day | Rarely bites: at the 20 EMA a stock sits near or under its 10-day. | None. |
| C31 RS 80+, strongest groups | Matches the owner ("RS names and liquid leaders") and the app's screener preset. | `pullback_to_21ema`'s "rs_trend" is not RS; it should not stand in for C31. |
| C33 time stop: under 1R after 10 days, sell | Matches Raschke's "no reason to be in this trade". | None. |
| D47 shorts are the longs reversed | The owner shorts the rejection at a declining 20 EMA or 50 SMA below the 200-day; Kell has the downside crossback. | None. |
| E56 at most 3 tries a week, 6 a month | Matters: the owner often tries a name more than once at the line. | None. |
| E57 market orders | Buy at market when the trigger trades, not a resting buy-stop. | AIQ's 1997 rules box uses a buy stop; Raschke herself says "I use market orders most of the time." (1993) and, in a trending market, "for Pete's sake, use market orders." (2000) |
| F65 market reading as a guide | Green full size; Yellow smaller; Orange A+ only; Red none. | His index-20EMA habit is a second filter he states loosely (question 7). |

---

## 8. Proposed rules for our course

Every line is measurable on daily bars unless it says intraday or hourly. ATR = 14-day average true range. The line means
the 20-day EMA of closes.

### 8.1 What it is (the setup, before any trigger)

- **One-line definition.** A leader in a rising trend pulls back to its rising 20 EMA, a session holds the line, and you
  buy the turn back up with a stop under that session's low. [UCT; source consensus]
- **Which line.** The 20-day EMA. [UCT: the owner and the Model Book say 20; originator: Raschke's 20-period EMA] The
  21-day is the same line for teaching purposes (section 4.5); if the owner prefers 21 for consistency with E52 and the
  scanners, change the word everywhere at once. [my proposal; question 3]
- **Prior trend (all required).**
  - Close above the 200-day SMA [house rule B26], and the 200-day SMA not lower than 20 sessions earlier [my proposal,
    from the app's v5 lab rule; Shannon treats a trend above the 200-day as "innocent until proven guilty"].
  - The 20 EMA above the 50-day SMA, and the 50-day SMA higher than 10 sessions earlier. [Keller's "proper order" (one
    outside source); UCT unsigned intro 2026-04-12 "9EMA>20EMA>50SMA>200SMA"; my proposal for the 50-day slope, from
    the app's v5 lab rule] (Tag corrected in checking: one outside source is not a consensus.)
  - The 20 EMA rising: higher than 10 sessions earlier. [source consensus that the line rises: Kullamägi "rising 10- and
    20-day", Kell "allowing the moving averages to rise to the price"; UCT "rising 20EMA"; my proposal for the
    10-session test]
  - A real advance before the pullback. Options: (a) the close was at least 1.5 ATR above the 20 EMA within the prior
    10 sessions (it pulled back to the line rather than drifting along it) [my proposal, from the app's Chart IQ v3 rule];
    (b) a gain of at least 30% within the prior 1-3 months [originator: Kullamägi, for his breakout setup]; (c) a breakout
    or a Wedge Pop shortly before [originator: Kell for the Wedge Pop; the 2-month window is my proposal]. Recommend (a)
    as the measurable gate and (b) or (c) as the grade booster (section 9), because (a) works on every chart and the
    owner's best examples clear (b) easily. [my proposal; question 8]
- **Leadership.** RS rating 80 or more, in one of the strongest groups. [house rule C31]
- **Liquidity.** Price $10 or more; at least $20 million traded a day; the position no more than 1% of average daily
  volume. [house rule B23, D42] Measure the dollar volume as a 30-day average, as the app's screener does. [my proposal;
  B23 names no averaging window]
- **The pullback.**
  - Off the swing high by at least 1 ATR (measured from the highest high of the last 11 sessions). [my proposal, from the
    app's v5 lab rule]
  - Lasting 2 to 15 sessions from the swing high. [my proposal: the owner's examples run four to six days and he likes
    "1-3 weeks of build out"; Kell prefers a slow drift]
  - Orderly: no down day in the pullback larger than 2 ATR, and no down day on more than 1.5 times the 50-day average
    volume. [my proposal, by analogy with the owner's Oops ruling against "a random big red day"; Shannon on volume]
  - Volume: the average volume of the pullback sessions below the 50-day average volume. [UCT: owner "low volume"
    (RDDT 2025-07-13); outside: Shannon "contracting during pullbacks" (one source); my proposal for the 50-day
    yardstick; question 15] (Tag corrected in checking: it said source consensus.)
- **The touch (the hold session).**
  - The session's low comes within 0.25 ATR above to 1 ATR below the 20 EMA. [my proposal, from the app's v5 lab
    thresholds, tuned on traders' calls]
  - The session closes at or above the 20 EMA, or (a one-day shakeout) closes under it by no more than 0.5 ATR and the
    next session closes back above it. [UCT: "shallow shakeouts below the 20EMA", "undercut and reclaim"; my proposal
    for the 0.5 ATR, from v5]
  - The session's low holds above the 50-day SMA. If it does not, it is a 50-day pullback (setup 12). [my proposal]
  - The close is no more than 1 ATR above the 20 EMA (not extended from the line). [my proposal, from v5] **Checker's
    note:** three of the owner's own dated examples fail this on the hold session (ALAB 2025-06-18 +1.44 ATR, XOM
    2025-11-18 +1.12, FLNC 2025-11-07 +1.05; section 6.13), because he buys the intraday turn and the close runs away.
    With trigger A, measure the **entry price**, not the close, against the line (or drop this line); keep it only for
    trigger B, where the buy comes after the close. (question 16)
- **Which tap.** The first or second touch since the breakout or the last base. A third or later touch is allowed but is
  graded lower. [source consensus on "first": Kell, Raschke 2004, and Bonde's "Buy first pullback" methods; owner "First
  tap of 20EMA held", unsigned "First test of 20EMA"; my proposal for allowing the second]
- **Not in the 3 days before an earnings report** (B22 says "3 days"; trading days or calendar days is not stated, so
  ask). [house rule B22]

### 8.2 The buy (trigger and order)

Options found in the sources:
- **A. The owner's way: the intraday turn on the hold session.** Buy at market as one of these happens on the session that
  tags the line: the stock opens under the prior close and trades back above it (red to green; entry = the prior close);
  or it undercuts the prior day's low and trades back above it (entry = the prior day's low); or it breaks the 30-minute
  opening range high; or an hourly candle holds and the next hourly bar takes out its high. [UCT: ALAB, NBIS, XOM, TSLA,
  LITE quotes in 6.4; house rule E57]
- **B. The daily version: a cent over the holding candle's high, on a later session.** Buy at market when price trades
  one cent above the high of the session that held the line. [Raschke's Holy Grail as AIQ printed it, "a buy stop above
  the high of the previous bar", read as the holding bar (the text allows the other reading, 3.1); ChartSchool; Model
  Book playbook; the same style as the owner's Kicker ruling]
- **C. The close of the hold session.** [the app's v5 scanner; its own lab found no forward-return edge for this entry]
- **D. The 9 EMA remount** as the trigger. [UCT: Model Book card; the owner uses it only as a preference]

**Recommendation:** teach **A as the default and B as the fallback.** A is how the owner actually trades it, gives the
tightest honest stop, and two of its forms (red to green, the prior-low reclaim) can be drawn from daily bars exactly as
the Go Signal plan in `TRADE_PLANS.md` already draws "the prior close when it traded that session". B is for members who
cannot watch the open, and for hold sessions with no intraday turn. Show C only as the scanner's mark, never as the
plan. Keep D as a confirming sign in grading, not a gate. [my proposal; question 2]

Order rules for both:
- Market order the moment the trigger trades; no resting buy-stop needed. [house rule E57]
- Skip if the fill would be more than 4% above the trigger price (a gap up through it, for example). [house rule C28]
- Never buy before a session actually holds the line. [UCT: Model Book playbook mistake; originator: Kell "always wait
  for confirmation"; Shannon "not a reason to act automatically"]
- Full size at one price with one stop; no adding. [house rule A5]

### 8.3 The stop

- **A:** a few cents under the low of the hold session; for the hourly form, a few cents under the hourly candle's low.
  [UCT: "stop at today’s low", "used the low of that candle as my stop"; house rule A3, F62]
- **B:** a few cents under the low of the holding candle, or under the trigger session's low if that is lower.
  [UCT: Model Book playbook; Raschke's Holy Grail as AIQ printed it, "newly formed swing low"; house rule F62]
- **Size from the stop.** If the stop is more than about 3% under the entry, the size shrinks so the account risk is
  unchanged (A5); if even that does not fit, skip. Never raise the stop to make it fit. [house rule A3, A5, A13]
- **Not** the 21 EMA minus 1 ATR (wider than one ATR whenever the entry is above the line, 5.6), and not "a close below
  the line" as the initial stop (it cannot sit with the broker as an order, D41, and it is not what the owner uses for
  a new buy). [my proposal; house rule D41] (Reworded in checking: the first draft said both are wider than the day's
  low "on most charts", which was not measured, and a close-below-the-line exit is not always wider.)
- A gap down through the stop: the low of the first 30-minute bar becomes the stop; out if the loss passes 2R. [house
  rule B20]

### 8.4 Trims and trail

- **House default:** a third at 3R, a third at 5R; stop to breakeven between 2R and 5R; the last third trailed under the
  10-day (fast movers) or the 21-day (steadier), sold on a close below it; a gap up past a trim level is trimmed at the
  open. [house rule B19, E51, E52, F63]
- **Setup-specific timing of the trail (recommended):** because the buy is made at the line, keep the initial stop until
  the 20 EMA has risen above the entry; then breakeven and trail the 20 EMA close; once the 50-day SMA passes the entry,
  the trail may move to the 50-day for steadier names. [UCT: the owner's 2025-10-19 and 2026-03-22 words, and the
  unsigned first-person intro of 2026-05-10; question 10]
- **Time stop:** still under 1R after 10 trading days, sell. [house rule C33; originator: Raschke's ETN example]
- **Climax:** a parabolic burst on your own long, sell a big part into it. [house rule C34]

### 8.5 What invalidates it

Before entry (no trade):
- A close under the 20 EMA by more than 0.5 ATR, or two closes in a row under it, during the pullback. [my proposal,
  from v5's depth rule and the owner's "two consecutive closes" trail]
- The 20 EMA flattens or turns down (not higher than 10 sessions earlier), or crosses under the 50-day SMA. [UCT
  unsigned Index & ETF, 2025-08-03: "declining 20EMA ... no mans land"; Keller's "proper order" (one outside source)]
- A down day into the line on more than 1.5 times the 50-day average volume. [my proposal; Shannon on volume]
- The low breaks the 50-day SMA (then it is setup 12, if anything). [my proposal]
- An earnings report within the next 3 days. [house rule B22]
- The market reading turns Red; in Orange only an A+ qualifies. [house rule F65, D46]

After entry:
- A trade under the stop: out. The stop only moves up. [house rule A4]
- Under 1R after 10 trading days: out. [house rule C33]
- A failed hold: no new pullback buys in that name until it sets up again as a new trade; at most 3 tries a week and 6 a
  month. [originator: Raschke "if a grail buy trade fails, I know I'm not going to look to buy pullbacks in that market";
  house rule B21, E56]

### 8.6 The short mirror

Shorts are our long setups reversed. [house rule D47] The short: a stock below its 200-day SMA [house rule B26], with
that 200-day falling [my proposal; B26 asks only that price be below it],
RS 20 or less in one of the weakest groups [house rule C31 mirror], 20 EMA below the 50-day SMA and falling, bounces 2 to
15 sessions on light volume up into the declining 20 EMA, and is rejected there (the session's high within 0.25 ATR
under to 1 ATR over the line, closing back under it). Short at market on the intraday turn down (green to red through
the prior close, or a poke above the prior day's high that falls back under it), or on a later session one cent under
the rejection candle's low; stop a few cents over that session's high; skip if hard to borrow or the fee is high [house rule D48]. [UCT: the
owner's 2026-11-01 short rules; originator: Kell's downside EMA Crossback; AIQ's 1997 Holy Grail box "sells are
reversed"; ChartSchool "the same rules as above but in reverse"] The owner
takes "1-2 per cycle", so the course should present this as rare and for experienced members. [UCT]

### 8.7 Best market conditions

- The market reading Green (full size), Yellow (smaller and fewer). [house rule F65]
- The leading index above a rising 20 EMA, and "flagging action into the 20EMA broadly" across leaders. [UCT; question 7
  on whether this is a gate or a guide]
- Early in a new advance: the first pullbacks after a market bottom or a stock's breakout. [originator: Kell; UCT]
- A trending stock, not a choppy one: AIQ's 1997 Holy Grail box requires a 14-period ADX over 30 and rising, and
  Raschke (2004) a 14-bar ADX above 30 before each retracement; our measurable stand-in is the rising 20 EMA over a
  rising 50-day. [originator; my proposal]

### 8.8 Common mistakes (each from a source)

1. Buying the touch before a session holds. [UCT: Model Book playbook; originator: Kell]
2. Treating the line as a wall; it gets run through. [AlphaTrends FAQ, Shannon's site]
3. Using it on a stock whose daily chart is not bullish, or under the 200-day. [UCT: Model Book playbook; house rule B26]
4. Buying into a flat or falling 20 EMA. [UCT unsigned Index & ETF section, 2025-08-03 (about ARKK)]
5. Chasing the breakout instead of waiting for the tap: "Too many trying to hit the breakout vs position with tight risk
   for it’s potential." [UCT, owner, 2025-10-19]
6. Using a wide moving-average-minus-ATR stop and then sizing as if it were tight. [house rule A3, A5]
7. Trailing under the 20 EMA from day one, so normal noise stops a trade bought at the line. [UCT: the owner keeps the
   initial stop until the line passes the entry]
8. Holding a trade that does nothing. [originator: Raschke; house rule C33]
9. Small, thin stocks: "Buying such pullbacks on most of them would make you a bag holder." [originator: Bonde; house
   rule B23]
10. Holding into earnings when the trade is not up 5R (B22 allows holding through a report only at 5R or more). [UCT:
    SHOP; house rule B22]
11. Forcing trades while the indexes are below their 20 EMA. [UCT unsigned intro, 2026-04-05]
12. Adding to a winner at the next tap. Our rule is one price, one stop. [house rule A5]

### 8.9 Where the sources disagree: options and the recommendation

| Question | Options | Recommend | Why |
|---|---|---|---|
| 20 or 21; EMA or SMA | 20 EMA; 21 EMA; "20/21" | 20 EMA | The owner and the card say it; the difference is half a session's move (4.5). |
| Trend filter | ADX>30 rising; Wedge Pop; 30% move; MA order and slopes | MA order and slopes, plus the 1.5 ATR prior-extension gate | Measurable on any chart; matches the owner and Keller. ADX is in the app's chart indicators but in no house rule and in none of UCT's 103 posts. (Corrected in checking: the first draft said ADX is not in our charts.) |
| Which tap | first only; any | first or second, later ones graded down | Kell and Raschke (2004) say first; the owner trades more than one. |
| Trigger | intraday turn; next-day high break; hold-day close; 9 EMA remount | intraday turn, next-day break as fallback | The owner's own way; tightest stop; drawable on daily bars. |
| Stop | day low; swing low; MA minus ATR; tag-bar low | the hold session's low (or the hourly candle's low) | House rule A3; the owner's practice. |
| Exit | new highs; 2R/3R; 1/3-1/2 after 3-5 days | house 3R/5R and trail, with the trail starting once the line passes entry | House rules; the owner's timing. |
| Time frame | daily; intraday | daily, with the intraday turn as the trigger | The owner's posts are daily-chart setups; the playbook's intraday version could be its own lesson. |

---

## 9. Grading: what makes an A+ versus a B-

Rule E50 says grading is the owner's judgment and no fixed checklist is taught as ours. These are the observable cues the
sources point to, for him to accept, cut or reweight. Grade sets size (D38, E49).

**A+ (the sources' best case)**
- A true leader: RS 90 or higher, in the strongest group, liquid. [my proposal for the 90; house rule C31 sets the floor
  at 80; UCT "RS names and liquid leaders"]
- A big, recent advance first (for example HIMS "+125% move in 15 days" in an unsigned post, and the owner's FLNC "190%
  upside move in 5 weeks") and a stock "nearly 50% away from 50SMA" coming back to the line. [UCT]
- The first tap of a rising 20 EMA, with 9 > 20 > 50 > 200. [Kell and Raschke 2004 for the first tap; Keller and the
  UCT unsigned intro of 2026-04-12 for the order; "all rising" is my proposal]
- A quiet pullback: lower volume each day, small bars, or a sideways drift that lets the line catch up. [UCT; Kell;
  Shannon]
- Confluence at the line: a bull gap, the prior breakout level, an anchored VWAP or a high-volume close. The owner: "That
  sub $12 support,20EMA, and $13 HVE are modal book type action." (2026-04-19); GLW "against the bull gap support, the
  previous ATH, and the 20 EMA" (2026-05-24). [UCT]
- A clear turn: a gap down that goes red to green ("A gap down red to green Monday would be an A+ setup in my book."), a
  hammer, an undercut of the prior day's low and reclaim, or an oops. [UCT]
- A tight stop (well inside 3%). [house rule A13]
- A Green market, with the index above its rising 20 EMA. [house rule F65; UCT]

**A / B**
- The second tap; a still-rising but flatter 20 EMA; a pullback with one or two heavier days; a turn that is a plain
  break of the prior day's high rather than a gap-down reversal; a Yellow market. [my proposal from the sources above]

**B- (size down, or pass)**
- A third or later tap; a 20 EMA that is flattening; a pullback that sliced under the line and closed there; heavy
  selling into the line; no clear turn yet; a wide stop near the 3% limit; an index under its 20 EMA; RS near 80 or a
  lagging group. [my proposal, the mirror of the A+ cues above]

**Not the setup at all:** under the 200-day; a falling 20 EMA; under $10 or under $20 million a day; earnings within 3
days; the 50-day already broken. [house rules B23, B26, B22; UCT]

---

## 10. Questions for the owner

1. **Daily or intraday?** The Model Book playbook describes an intraday pullback to the 20 EMA (exits into 15-minute
   opening-range-breakout buyers; it names no chart time frame). Your Substack posts describe a daily setup with an intraday trigger. Options: (a) daily only;
   (b) intraday only; (c) both, as two lessons with two names.
2. **The trigger.** Options: (a) the intraday turn on the hold day (red to green, prior-day-low reclaim, 30-minute ORH,
   hourly hold), stop at that day's low; (b) the next day, a cent over the holding candle's high; (c) the hold day's
   close (the scanner); (d) the 9 EMA remount, as the Model Book card says. I recommend (a) with (b) as the fallback.
   Should "the remount of the 9 EMA is the buy" stay on the card?
3. **20 or 21?** You write 20EMA; the scanners and rule E52 say 21. Options: 20 everywhere; 21 everywhere; "20/21".
4. **E52's averages.** Are your 10-day and 21-day trails EMAs or simple averages?
5. **How deep may it undercut?** Options: (a) the low within about 1 ATR under the line and the day closes back above
   it; (b) any undercut, if it reclaims the same day; (c) one close under the line is fine if the next day reclaims it.
6. **Which taps count?** First only; first and second; any while the line rises.
7. **The index filter.** Options: (a) only the app's market reading (B18, F65); (b) also require the QQQ (or the stock's
   own index) above a rising 20 EMA; (c) a guide only, as you wrote "It’s like saying XLU ... is below the 20EMA so
   therefore I cannot trade META".
8. **The prior move.** Options: (a) price at least 1.5 ATR above the 20 EMA within the 10 sessions before the pullback;
   (b) at least 30% up in 1-3 months; (c) a breakout or Wedge Pop in the last 2 months; (d) no minimum beyond the trend
   rules.
9. **New trade or add-on?** Model-drafted curriculum text calls this an add-on only. Your posts buy it as a new trade at
   full size, and rule A5 forbids adding. Confirm: a new trade, one price, one stop.
10. **The trail for this setup.** Options: (a) E52 as written (10-day or 21-day close); (b) your own: keep the first stop
    until the 20 EMA passes the entry, then breakeven and the 20 EMA close, then the 50-day once it passes the entry;
    (c) two consecutive closes under the 20 EMA (your June 2025 habit).
11. **Examples under $10.** Your 2025 trades in GPRO (bought at a 20EMA hold), CIFR and WULF (trailed on the 20EMA)
    and OPEN were under $10. Confirm they are excluded from the lesson's examples under B23.
12. **Bear-market bounces.** Your NVDA 2022-07-25 note called bounces into the 20 EMA "most likely good 20EMA" pullbacks,
    but they were under the 200-day. The AAPL 2022-09-01 Go Signal you graded "good" also closed under its 200-day (and
    under a falling 20 EMA) on the sandbox's bars. Under B26 these are not longs. Confirm.
13. **The member-facing scanner text.** May the unsourced Minervini claims in `pullback_to_21ema.py` and its
    `patterns.py` description be removed, and its stop and close-above-10-day gate be fixed? (A code change for a later
    session; nothing was changed here.)
14. **Your workshop "Playbook Review On Pullback Buys"** (YouTube 6hM1efa3YSM, chapter at 13:24). Can its transcript be
    used as a source? It likely holds your rules in your own words.
15. **Volume.** Is a below-average-volume pullback a requirement, or a grade booster only?
16. **How far above the line may you buy?** Three of your dated examples (ALAB 2025-06-18, XOM 2025-11-18, FLNC
    2025-11-07) closed more than 1 ATR above the 20 EMA on the hold day. Options: (a) cap the entry price, not the
    close, at about 1 ATR above the line; (b) no cap beyond C28 (4% past the buy point) and C29; (c) another limit you
    use. (Added in checking.)
17. **Earnings window.** B22 says no new buys in the 3 days before a report. Trading days or calendar days? (Added in
    checking.)

---

## 11. Sources (all read on 2026-11-09 unless marked)

**Originators (primary)**

| Source | Publisher / where | Author | Reliability note |
|---|---|---|---|
| ["LINDA BRADFORD RASCHKE ON SHORT TERM TRADING STRATEGIES"](https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf), AIQ Opening Bell Monthly, Vol. 6 Issue 8, Aug 1997 | AIQ Systems; PDF hosted on Raschke's site | David Vomund (interviewer), Linda Bradford Raschke | High for her interview answers. The four-rule box beside it is AIQ's summary (it cites AIQ's own software), so medium-high for the rules' exact wording. Two-column PDF; sentences checked across columns. |
| ["The Discerning Trader: Linda Bradford Raschke"](https://lindaraschke.net/wp-content/uploads/2026/01/Discerning-trader.pdf), S&C V.11:9, pp. 360-366; interview held June 18, 1993 (stated in the article) | Technical Analysis of Stocks & Commodities; PDF on Raschke's site | Thom Hartle, Linda Bradford Raschke | High: her own words. |
| ["Linda Bradford Raschke: The rituals of trading"](https://lindaraschke.net/wp-content/uploads/2026/01/rituals.pdf), Active Trader, Aug 2000 | Active Trader; PDF on Raschke's site | Mark Etzkorn, Linda Bradford Raschke | High. |
| [Active Trader interview, part 2](https://lindaraschke.net/wp-content/uploads/2026/03/raschke_pt2_0304.pdf), Mar 2004 | Active Trader; PDF on Raschke's site | Mark Etzkorn, Linda Bradford Raschke | High. |
| [Street Smarts edition record](https://openlibrary.org/isbn/0965046109) | Open Library | Connors and Raschke (book) | Bibliographic only; the book itself was not read. |
| ["How to Buy Stocks on Pullbacks with the EMA Crossback Strategy"](https://web.archive.org/web/20250122081846/https://traderlion.com/technical-analysis/chart-patterns/ema-crossback/), 2024-08-20 | TraderLion (Internet Archive copy, 2025-01-22; live page 403) | Oliver Kell (byline) | Medium-high: credited to Kell on an educator site; may be edited by staff. |
| ["Cycle Of Price Action"](https://web.archive.org/web/20250623154156/https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/), 2024-09-10 | TraderLion (archive copy, 2025-06-23) | Oliver Kell (byline) | Medium-high, same note. |
| ["3 TIMELESS setups that have made me TENS OF MILLIONS!"](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/), 2021-01-08, updated 2021-04-28 | qullamaggie.com | Kristjan Kullamägi | High: his own blog. About his breakout setup, not a pullback buy. |
| ["How to develop pullback method"](https://stockbee.blogspot.com/2010/11/how-to-develop-pullback-method.html), 2010-11-04 | Stockbee blog | Pradeep Bonde | High: his own blog. General, not 20 EMA-specific. |
| ["New to Alphatrends?" FAQ](https://alphatrends.net/new-visitors/) (undated) | AlphaTrends | Brian Shannon's site (answers written about "Brian") | Medium-high. |

**Established educators and research**

| Source | Publisher | Author | Reliability note |
|---|---|---|---|
| ["Oliver Kell's EMA Crossback Uncovers Low-Risk Entries"](https://web.archive.org/web/20250702020000/https://traderlion.com/technical-analysis/trading-the-ema-crossback/), 2025-05-22 | TraderLion (archive copy, 2025-07-02) | TraderLion staff | Medium: secondary description of Kell. |
| ["Pullback or Pitfall? Let the 21-Day EMA Be Your Guide"](https://articles.stockcharts.com/article/stock-market-pullback-or-pitfall-21-day-moving-average-guide/), 2025-09-05 | StockCharts | David Keller, CMT | Medium-high: an educator's own method. |
| ["Alert Yourself To Pullback Opportunities In Fast-Moving Stocks"](https://articles.stockcharts.com/article/articles-chartwatchers-2019-07-alert-yourself-to-pullback-opportunities-in-fast-moving-stocks/), 2019-07-05 | StockCharts | Mary Ellen McGonagle | Medium-high: an educator's own method; O'Neil-trained per her author note. Added in checking. |
| ["The Art of Uncovering an Ideal Buy Point"](https://articles.stockcharts.com/article/articles-mcgonagle-2020-06-the-art-of-uncovering-an-ideal-484/), 2020-06-02 | StockCharts | Mary Ellen McGonagle | Medium: short; added in checking. |
| ["2 Questions You Must Answer Before Entering Any Trade"](https://alphatrends.net/archives/2-questions-you-must-answer-before-entering-any-trade/), 2026-03-10 | AlphaTrends | not shown in the saved text | Medium. |
| [Moving Averages: Simple and Exponential](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential) | StockCharts ChartSchool | ChartSchool | High for definitions. |
| [Finding Support and Resistance in Moving Averages](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/finding-support-and-resistance-in-moving-averages) | StockCharts ChartSchool | ChartSchool | Medium: a generic 50/200-day template. |
| [Moving average distance as a predictor of equity returns](https://ideas.repec.org/a/wly/revfec/v39y2021i2p127-145.html), Review of Financial Economics 39(2), 2021 | Wiley (abstract via RePEc) | Avramov, Kaplanski, Subrahmanyam | High: peer-reviewed. Supports the trend filter only. |
| [SSRN 3111334 working paper (PDF)](https://anderson-review.ucla.edu/wp-content/uploads/2021/03/Avramov-Kaplanski-Subra_2018_SSRN-id3111334.pdf) | UCLA Anderson Review (hosted copy) | same authors | High; an earlier version than the published article. |
| [Bulkowski's Moving Average Study](https://www.thepatternsite.com/MovingAvgs.html) | thepatternsite.com | Thomas Bulkowski | Measured, but about chart-pattern breakouts. **Site notice: not to be used to train AI.** Read through a fetch tool (plain curl got 406); no numbers used. |

**UCT's own (public Substack, https://unchartedterritoryy.substack.com)**: all 103 sitemap posts downloaded and searched
(2026-10-18 is subscriber-only, not read). Quoted (52 posts; dates are each post's own US date, see the top): Week
Ahead 2025-06-01; Sunday Scans 2025-06-08; The Parabolic Short 2025-06-13; Market Update and Watchlist 2025-06-19;
Sunday Scans 2025-06-22, 2025-07-06, 2025-07-13, 2025-08-03, 2025-08-10, 2025-08-17, 2025-08-24, 2025-09-07,
2025-09-14; The Rest of the Week 2025-09-30; Sunday Scans 2025-10-19; The Rest of the Week 2025-10-21, 2025-11-04;
Sunday Scans 2025-11-09; The Rest of the Week 2025-11-18; Sunday Scans 2025-11-23; The Rest of the Week 2025-11-25;
Sunday Scans 2025-11-30, 2025-12-07; The Rest of the Week 2025-12-16; Sunday Scans 2026-01-04, 2026-01-11, 2026-01-18,
2026-02-08, 2026-02-22, 2026-03-01, 2026-03-08, 2026-03-22; The Rest of the Week 2026-03-31; Sunday Scans 2026-04-05,
2026-04-12, 2026-04-19, 2026-05-10, 2026-05-17, 2026-05-24, 2026-05-31, 2026-06-14, 2026-06-21, 2026-06-28, 2026-07-05, 2026-08-02, 2026-08-16, 2026-09-06, 2026-09-27,
2026-10-04, 2026-10-11, 2026-11-01, 2026-11-08. Each post's URL is https://unchartedterritoryy.substack.com/p/ plus its
slug; the ones quoted most are linked in section 6. Reliability: the owner's and Bracco's own public words;
highest rank for how UCT trades it. The YouTube workshop 6hM1efa3YSM (channel "Uncharted Territory") was confirmed to
exist via YouTube's oEmbed and watch page (published 2024-08-08); not watched, and its captions could not be read.

**House files read (this repo)**: `docs/study/sizing_rule.md` (section 9), `docs/study/TRADE_PLANS.md`,
`docs/study/audits/2026-10-24/owner_verdicts.jsonl`, `docs/study/levels/dossiers/README.md`,
`api/services/pattern_engine/detectors/uct/uct_pullback_ma_v5.py`, `pullback_to_21ema.py`, `holy_grail.py`,
`uct_setups_common.py`, `api/services/pattern_engine/primitives/context.py`, `primitives/liquidity.py`,
`api/routers/patterns.py`, `api/services/screener/saved_screens.py`, `api/services/chart_iq/engine/v2_setups.py`, `v3.py`,
`markup.py`, `api/services/catalyst/brain_grades.py`, `api/services/education_seed.py`,
`app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`, `app/src/constants/setupGroups.js`,
`app/src/pages/journal-2-0/lib/setupTagMap.js`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`,
`docs/study/bank/vocab.chart.json`, and (as a known non-source) `docs/curriculum/*.json`. Read again in checking:
all of the code files above, plus `api/services/auto_structures.py`, `api/services/pattern_engine/detectors/registry.py`,
`api/services/catalyst/sources.py`, `api/main.py` (the nightly scan), `docs/curriculum/HANDOFF.md`, and the git
history of `setupCatalog.js` and `setupPlaybooks.js` (commits 63eca6ed7d, 1391900ba5, ff18bf3fe5).

**Tried and not read**: investors.com (IBD; refuses our client); O'Reilly preview of *Trade Like an O'Neil Disciple*
(robots file disallows AI clients, so not fetched); minervini.com (product page, no articles); inkl.com republications
of IBD (robots file disallows Claude, so not fetched); the live TraderLion pages (403; archive copies used instead).
The YouTube workshop's caption track (listed on its watch page) returned nothing to a plain request; not pursued further.

---

## 12. Cold check (2026-11-09, a second reader)

**How it was checked.** Fresh copies of every source were fetched again by the checker (not reused from the writer's
folder): the four Raschke PDFs, the Stockbee, Qullamaggie, Keller, ChartSchool, AlphaTrends, RePEc and SSRN pages, the
three TraderLion archive copies, Bulkowski's page (through a fetch tool, for the title and the AI notice only), and all
103 Substack posts through Substack's API. A script looked up every quoted span (about 350) in those copies; the ones it
could not match automatically (PDF column and page breaks, JavaScript string joins, commit messages) were checked by
eye. Each UCT quote's author label was checked against the section heading it sits under. The scanner summaries were
checked line by line against the code. Data checks used the sandbox's daily bars (read-only).

**Corrected in checking**
1. **A UCT quote was given to the wrong person.** "In a perfect world this undercuts the 20EMA and reclaims." (IONQ) is
   Bracco's ("Bracco - IONQ"), not the owner's. Moved to 6.10.
2. **Dates of the evening posts were one day late** (UTC instead of the post's own date): seven issues of The Rest of
   the Week, plus Market Update and Watchlist and Week Ahead. This moved two example sessions: DELL's $147.30 buy was Tue
   2025-10-21 (not Wed 10-22) and XOM's $117.60 buy was Tue 2025-11-18 (not Wed 11-19).
3. **Raschke's 1997 rules box is AIQ's summary, not her words** (it cites AIQ's own software). Labels fixed in 3.1, 7,
   8.2, 8.3, 8.6, 8.7 and the source table. Added: rule 3's "previous bar" can be read two ways.
4. **The 1993 interview's date is printed in the article** (June 18, 1993); the draft said the year was inferred.
5. **Bonde paraphrase**: he did not say "the period hardly matters"; he said courses repackage the 50-day pullback with
   other lines. Added his warning that pullback methods "may not do well in bull markets or highly trending markets".
6. **Shannon** was called "originator of the multi-timeframe method"; no source says so. Now "established educator".
7. **Screener preset**: it does not fully match B23; it has no $10 price floor.
8. **"ADX is not in our charts"** was wrong: the app's chart indicators include ADX. Reworded.
9. **Model Book card and playbook**: their wording was written by AI-assisted commits from the owner's write-ups, so
   they are summaries, not his sentences.
10. **Source-consensus tags** that rested on one outside source were retagged (MA order, volume, the flat or falling
    20 EMA invalidation, and the B- grade list). "A Wedge Pop within the prior 2 months" was tagged as Kell's; the
    2-month window is a proposal.
11. **House-rule wording**: B22 says "3 days", not "3 trading days", and allows holding through earnings at 5R; the
    30-day dollar-volume average is the screener's, not B23's; B26 does not require a falling 200-day for shorts.
12. **Scanner details**: `trend_stage` compares closes 49 sessions apart; v5 measures from the highest high of the last
    11 sessions; v3's prior-extension test spans sessions 10 to 2 back; the member scanners state their entry as a
    close above the level, not a resting buy stop.
13. **The 8.3 claim that the MA-minus-ATR and close-below-line stops are wider "on most charts"** was unmeasured and,
    for the close-below-line exit, not always true. Reworded.
14. **"The 21-day line is the IBD and MarketSmith usage"** had no readable source. Replaced with what McGonagle (O'Neil-
    trained, StockCharts) and Keller actually write.

**Added in checking**: McGonagle's two StockCharts pages (3.4b; the 10 or 21-day simple average); Raschke's
any-time-frame sequence (2004) and "for Pete's sake, use market orders" (2000); AlphaTrends' 2-3% stop note and its
line on chasing; Bonde's warning on trending markets; the MAD paper's sample period and its Sharpe caveat; a measured
check of the `stacked_bullish` gate on touch days (5.6); data notes on the example sessions (6.13), including that
three of the owner's examples close more than 1 ATR above the 20 EMA, which conflicts with a proposed rule in 8.1
(question 16); that the AAPL 2022-09-01 Go Signal the owner graded "good" closed under its 200-day (question 12); the
DOCN first-tap example; questions 16 and 17.

**Removed in checking**
- "the PDF prints the volume and issue, not the year; volume 11 dates it to 1993" (the year is printed).
- "originator of the multi-timeframe method" (Shannon).
- "says the period hardly matters" (Bonde; not what he wrote).
- "This one already matches house rules C31 and B23" (the preset has no $10 floor).
- "ADX is not in our charts".
- "the usage in the IBD and MarketSmith world" for the 21-day line (no readable source).
- "(30-day average)" as part of house rule B23; "falling" as part of B26 for shorts; "trading" days in B22 (each kept
  only as a labelled proposal or a question).
- "5-minute style" for the Model Book playbook (it names no chart time frame).
- "Both are wider than the day's low on most charts" (unmeasured).
- "her own printed Holy Grail rules" and "Year inferred from the volume number" (source table).

**Not settled by the check**: whether IBD or MarketSmith define the 21-day line as an EMA (not readable); what *Street
Smarts* itself prints (not read); the owner's workshop (no transcript); whether the app's `cap_universe` has a price or
dollar-volume floor; the exact day of the FLNC, LITE and ARM examples.

## 13. Examples (from our data)

Numbered 13 because section 12 above is the cold check; this is the "Examples (from our data)" section the review asked for. Scan and charts: 2026-11-09, scripts `scan_ema20.py`, `pick_ema20.py`, `chart_ema20.py` in the review scratchpad folder `setups/11-ema20-pullback/` (sheets in its `final/` folder: `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`). Daily bars from the local sandbox, read-only.

**The rule the scan used (section 8, trigger B, plus the house rules).** On the hold session: close above the 200-day SMA, which is not lower than 20 sessions earlier; 20 EMA above the 50-day SMA, both higher than 10 sessions earlier; close at least $10 and 30-day average dollar volume at least $20 million (B23); a close at least 1.5 ATR above the 20 EMA within the prior 10 sessions (a real advance); the swing high (highest high of the last 16 sessions) 2 to 15 sessions back and at least 1 ATR above the session's low; no close-to-close drop in the pullback larger than 2 ATR; no down day in it on more than 1.5x the 50-day average volume; the pullback's average volume below the 50-day average; no close under the line by more than 0.5 ATR and no two closes in a row under it; the session's low between 1 ATR below and 0.25 ATR above the 20 EMA and above the 50-day SMA; the close at or above the line and no more than 1 ATR above it; this is the first tag of the pullback (one shakeout bar the day before allowed); no report date in the three trading days after the trigger (B22). The buy: the next session trades one cent over the hold candle's high; market order there (E57), or at the open if it gapped over it, skipped if the open is more than 4% above the trigger (C28). Stop: 3 cents under the lower of the hold candle's low and the trigger session's low (A13, F62); skipped if wider than 6%. Not tested: the RS 80+ rule (no RS ratings in the sandbox; the picks below use a 3-month gain of 15% or more as a stand-in), the group rule, the market-reading rule (F65); the B22 check relies on the earnings table, which is complete only from about 2005. Trigger A (the intraday turn) was not scanned: the hold session's low is not known until its close, so it cannot be back-tested honestly on daily bars.

**Base rate.** 19,146 hits across all 2,630 names that ever met the liquidity rule, 2000-01-05 to 2026-11-09 (the scan was complete, 220 seconds). Outcome measured from the day after the entry with a FIXED stop and NO trims, within 60 sessions: 27.2% reached 3R before the stop, 17.7% reached 5R, 85.2% were eventually stopped (many after reaching some gain), 48.6% never got to 1R. Median stop 2.1% under the entry. This is a tight-stop, high-reward pattern: a cent over the hold candle with the stop under its low gives a stop of about 1-3%, so a normal 15-25% swing is 10-40R, and roughly one in four such buys reached 3R. These numbers are for the mechanical rule on every qualifying chart (any tap, any market, any RS); the owner's filters (leaders, first tap, Green market) are not in them.

**The 10 examples.** All reached 5R; one per ticker; ten different years; all common stocks (no ETFs); every chart looked at. "Buy" is the hold candle's high plus one cent (the fill in every case except EL, where the open was a cent higher); "stop" is 3 cents under the lower of the hold candle's low and the trigger day's low; "best R" is the best excursion before the stop within 60 sessions.

| # | Ticker | Buy (trigger day) | Hold session | Pullback | Off the high | Low vs 20 EMA | Pullback vol (x 50-day) | 3-mo gain | Buy | Stop (%) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ILMN | 2013-12-05 | 2013-12-04 | 6 days | 1.8 ATR (4.4%) | +0.23 ATR | 0.82 | +23% | 95.90 | 93.85 (2.1%) | 40.2 | A long steady uptrend, a six-day orderly drift to the line on light volume; 3R in 10 sessions and then a 50% run. |
| 2 | REGN | 2011-03-16 | 2011-03-15 | 4 days | 2.0 ATR (6.0%) | +0.25 ATR | 0.87 | +26% | 38.71 | 37.84 (2.2%) | 38.0 | Four-day pullback to a rising line, stacked 20 EMA > 50 > 200; 3R in 6 sessions. |
| 3 | GE | 2024-01-05 | 2024-01-04 | 4 days | 2.4 ATR (3.9%) | -0.02 ATR | 0.78 | +15% | 100.39 | 99.07 (1.3%) | 36.0 | The low kisses the line to the cent, a 1.3% stop, straight up afterwards; 3R in 5 sessions. |
| 4 | TEAM | 2021-07-02 | 2021-07-01 | 5 days | 2.3 ATR (6.2%) | +0.22 ATR | 0.85 | +16% | 259.86 | 255.32 (1.7%) | 35.3 | First tap after a breakout from a four-month base; 3R in 5 sessions and 5R inside two weeks. The big gap four weeks later is not classed here: our earnings table has no 2021 report date for TEAM, so it cannot be called an earnings gap from our data. |
| 5 | CRM | 2020-06-30 | 2020-06-29 | 4 days | 2.4 ATR (7.3%) | -0.28 ATR | 0.76 | +22% | 183.72 | 179.97 (2.0%) | 26.9 | A shallow undercut of the line and a close back above it; 3R in 2 sessions. |
| 6 | VRTX | 2017-05-09 | 2017-05-08 | 4 days | 2.9 ATR (6.7%) | -0.34 ATR | 0.87 | +32% | 115.66 | 113.78 (1.6%) | 27.8 | First pullback to the line after a gap-and-run; a shakeout under the line, then a hold. |
| 7 | NVDA | 2023-05-15 | 2023-05-12 | 4 days | 1.4 ATR (4.0%) | +0.15 ATR | 0.74 | +33% | 28.79 | 28.02 (2.7%) | 25.1 | The textbook leader: rising line, a light-volume four-day rest, 3R in 3 sessions. Caveat: it stood at 3.9R the day before the 2023-05-24 report, so B22 (hold through a report only at 5R or more) would have had us out before the gap; the 5R here came from the gap itself. |
| 8 | SCCO | 2025-12-19 | 2025-12-18 | 4 days | 2.5 ATR (6.7%) | +0.23 ATR | 0.70 | +30% | 137.20 | 134.18 (2.2%) | 26.4 | A clean MA stack, pullback volume 0.70x, 3R in 9 sessions and a 50% run into February. |
| 9 | TOL | 2004-12-01 | 2004-11-30 | 10 days | 2.1 ATR (5.4%) | +0.14 ATR | 0.69 | +16% | 26.07 | 25.53 (2.1%) | 35.3 | The longer (two-week) flag the owner likes, drifting down to the line on 0.69x volume; 3R in 6 sessions. |
| 10 | EL | 2009-12-01 | 2009-11-30 | 4 days | 2.5 ATR (5.7%) | -0.02 ATR | 0.65 | +31% | 23.57 | 23.18 (1.7%) | 18.8 | An early-recovery leader in 2009; the low lands on the line, pullback volume 0.65x; 3R in 2 sessions. |

Older examples (TOL 2004, EL 2009, REGN 2011) sit before or near the start of the earnings table, so the "no report within 3 days" check was weaker for them; none of the ten had a report date inside its window where a date exists.

**Notable failures (in words, from the same scan).**
- NVDA, buy 2025-08-18 at 181.91, stop 178.01, stopped the next day (low 175.49, close 175.64). A late tap after a four-month run with the 20 EMA already flattening; the stock then went sideways for six weeks. Lesson: the late tap of a tired trend, not the first or second. (The 2025-08-27 report was seven trading days away, so B22 did not block it.)
- CAT, buy 2025-11-17 at 558.32, stop 540.97 (3.1%, already wide), stopped the next day on a gap down to 543.35 and a low of 538.05, then it closed at 546.88 and reached 610 (the 3R level) within a month without us. Lesson: a one-day shakeout through a wider stop; the rule has no re-entry, so the trade was gone. A new hold session would have been the way back in.
- AMZN, buy 2026-05-18 at 264.37, stop 260.86, stopped the next day, and the stock lost its 50-day SMA in June. Lesson: the second tap after a steep April run, with the 20 EMA turning down within a week of the buy; the hold session was a small-bodied candle under the prior highs, a weak hold.

## 14. Failures and near-misses (from our data)

Built 2026-11-10 from the same scan as section 13 (`final/hits.json`, trigger B, the stop 3 cents under the lower of the hold candle's low and the trigger session's low). Scripts in the review scratchpad folder `setups/11-ema20-pullback/`: `fails11.py` (the failures), `near_scan.py` and `near11.py` (the near-misses: the scan's gates turned into flags, keeping only the candidates that fail exactly one gate criterion of the card; the 900 most liquid names of today's universe, 2005 on). Sheets in `final/`: `fail_1-4.png`, `near_1-4.png`, and `pair_12-ma-pullbacks.png` (GE 2024-01-05 above CAT 2025-09-03 from setup 12, the 50-day form). Every chart carries the same levels as the winners: buy, stop, 3R, 5R, the pullback box and the hold mark. All numbers below are read off the daily bars.

**Four failures (every gate passed, traded by the rules, stopped before 3R).**

| # | Ticker | Buy (hold session) | Buy | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | NVDA | 2025-08-18 (08-15) | 181.91 | 178.01 | 08-19, day 1, low 175.49 | Closed 175.64, under the 20 EMA, the same day; the low broke the 50-day on 09-02; 20 sessions later (09-16) it closed at 174.88, still under the 20 EMA. A late tap after a four-month run. | e20.which_tap |
| 2 | AMZN | 2026-05-18 (05-15) | 264.37 | 260.86 | 05-19, day 1, low 255.19 | Closed 259.34 under the line; 20 sessions later (06-16) it closed at 246.00, 10.16 under the 50-day. The second tap after the April run. | e20.which_tap |
| 3 | GILD | 2013-08-08 (08-07) | 60.50 | 59.17 | 08-09, day 1, low 58.57 | Closed back at 59.21 the same day and reached the 3R level (64.49) on 09-18 and 5R (67.15) on 10-17 without us. A one-day shakeout. | none failed; e20.tries (no re-entry without a new hold) |
| 4 | DIS | 2021-01-14 (01-13) | 177.74 | 173.37 | 01-15, day 1, low 170.17 | The low undercut the 50-day on 01-27, then it reached 3R (190.85) on 02-11 and 5R (199.59) on 02-24 without us. A shakeout. | none failed; e20.tries |

CAT 2025-11-17 (section 13) stays in the card's list; it shares a year with NVDA, so GILD and DIS were charted instead.

**Four near-misses (the chart looks like the setup; exactly one gate criterion fails).**

| # | Ticker | Hold / would-be buy | The one criterion | The number | What it really is |
|---|---|---|---|---|---|
| 1 | HD | 2025-02-03 / 02-04 | e20.above_50 | the hold low 401.01 is under the 50-day SMA 408.58 (the 20 EMA sat at 408.60) | Which average: the low reached the 50-day, so it is setup 12's 50-day form, if anything. It stopped (best 0.56R). |
| 2 | AAPL | 2022-01-11 / 01-12 | e20.inv_close_under | 3 closes under the 20 EMA in the five-session pullback, the deepest 0.73 ATR | How many closes under: a line lost, not tapped. Too few closes (under 5) and the wrong line for a Remount. No trade until it sets up again. It stopped (best 0.09R). The scan's first-tag condition (e20.which_tap, not a gate) was relaxed for this criterion, since two closes under the line always mean an earlier tag. |
| 3 | TSLA | 2025-10-31 / 11-03 | e20.prior_advance | the best close of the prior 10 sessions sat 1.2 ATR above the 20 EMA (rule: 1.5) | A stock drifting along its line with nothing to pull back from; the crossback side of the border, not a pullback. Stopped at 0R. |
| 4 | INTC | 2017-11-20 / 11-21 | e20.orderly | a down day in the pullback on 2.3x the 50-day volume (rule: at most 1.5x); the largest down day 1.2 ATR | Distribution into the line (e20.inv_heavy_down is the same fact). Stopped at 0R. |

**What the failures have in common.** All four were stopped on the first session after the buy with a best excursion of 0R; the stops were 1.3% to 2.5% wide, so one ordinary red day took them. The two late taps (NVDA, AMZN) went on to lose the line and, for AMZN, the 50-day, which is the e20.which_tap warning in section 8. The two shakeouts (GILD, DIS) reached 3R and 5R inside five weeks without us; the rule's answer to that is not a re-entry at the old price but a new hold session with its own trigger and stop (e20.tries), and in both the next hold came within days.
