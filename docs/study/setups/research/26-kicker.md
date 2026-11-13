# Setup 26: Kicker Candle (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page
or file named next to it and is 40 words or fewer. Nothing here is a ruling. Where I could not read a source, I say so
and give no wording from it. The UCT Substack posts were downloaded whole and every UCT quote was checked word for word
against the page text by script.

**Cold check, 2026-11-09 (a second reader).** Every outside quote was re-read on the page itself, not through a summary:
plain downloads for TA-Lib, Schwab, TradingMarkets, CQG, Working Money, S&C, Kell, Stockbsessed, Qullamaggie, the
Dahlquist and Bauer PDF, Amphibian and The Right Trader; Bulkowski's site and TraderLion refuse plain requests, so their
pages were read from the Internet Archive's copies (Bulkowski: October 2026). All 103 UCT posts were re-downloaded and
every UCT quote re-matched (all exact); each UCT quote's section heading was re-checked. Every repo claim was re-read
in the file or code named. The 16 kept Kickers were re-checked against a second price source (Yahoo daily bars through
`yfinance`); they agree with the stored prices to the cent. Corrections are made in place; anything removed is listed
under "Removed in checking" at the end.

**Third pass (resumed cold check, 2026-11-09, a third reader).** Everything was opened again from scratch rather than
trusting the second reader's notes: every outside page re-downloaded with a plain client (TA-Lib and `ta_global.c` raw
source, Schwab, TradingMarkets, CQG, Working Money, the S&C abstract, Kell's Weeklies Watch, Stockbsessed, Qullamaggie,
the Dahlquist and Bauer and CMT PDFs, the Fidelity-hosted S&C PDF, Amphibian, The Right Trader, StockCharts,
QuantifiedStrategies; Bulkowski and TraderLion again from the Internet Archive, since the live pages answered 406 and a
browser check); 157 outside quotes, dates, bylines and numbers matched word for word (the only misses were the words the
dossier says are absent: no "kicker" on Qullamaggie's or Kell's interview page, no kicking entry at StockCharts). The
Dahlquist and Bauer Table 2 and Table 6 figures were re-read in the PDF text. All 48 UCT quotes re-matched exactly against
the 29 posts, with each quote's section heading and each post's publish date re-read; the sitemap still lists 103 posts.
The 16 kept Kickers were re-pulled from Yahoo (daily bars, unadjusted) and every number in 4.5 and section 9 recomputed:
they agree with the stored bank prices within a cent and with the figures printed here, including the TA-Lib test (none
pass). The detector, the other eight Kicker rules in 5.3, the fixtures, the finders, the replay code, the KB entries, the
verdict-log lines and all 35 rulebook ids cited in section 7 were re-read in the files. Three small corrections were
made (listed at the end); nothing had to be removed.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named author's own
words; **[UCT]** the owner's verdict log, his desk logs, or UCT's published posts; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Day names used here: **the red day** is the weak day before; **the Kicker day** is the gap day. The owner calls the
Kicker day "DAY 1"; several app files call it day 2. Same session.

**Read this first (the short version).**
1. The owner's Kicker is not the textbook candle. The tested Japanese "kicking" pattern (Bulkowski, TA-Lib, Schwab)
   needs two shadowless candles of opposite colour with a price gap between them. None of the 16 Kickers he kept would
   pass that. His version is closer to Stephen Bigalow's looser "Kicker Signal" plus a context filter, and it matches
   UCT's own first public definition (Sunday Scans, 2025-06-08): a red close near the lows into support, then a gap up
   that breaks the prior day's high.
2. His rulings are clear on the trade: buy a cent over the red day's high on the Kicker day, or on the Kicker day's
   30-minute opening-range break; stop under the Kicker's low, or 3.5% under the entry if that is closer. His set-up
   rulings: a real red bar closing weak (an "almost failed breakdown"), a stock already set up, rarely an earnings day.
3. Measured evidence is thin. Bulkowski's strict candle acted as a bullish reversal 53% of the time, which he calls
   "near random"; it is too different to stand for ours. A 2006-2010 study of 20,611 stock gap-ups (Dahlquist and
   Bauer) found the ingredients help a little: a black candle before the gap, a white gap candle, above-average volume,
   bigger gaps, gaps below the 10-day average. The house's own replays look strong on the kept charts but most of those
   were chosen to work; on 150 deep-history instances not filtered for outcome (nor for earnings days) his entry and stop
   reached 3R before the stop 48% of the time.
4. Two things in the kept examples are worth teaching as observable rules: in all 16, the Kicker day never traded back
   to the red day's close (the gap held all day), and in 15 of 16 the natural stop (the Kicker's low) was within 3% of
   the fill, which fits house rule A13.
5. The app's detector (`uct_kicker.py`) is far looser than his definition. It fires on a green prior day, on a gap of a
   fraction of a percent, and does not require the Kicker to close above anything. Two of the app's own six "positive"
   Kicker fixtures (MSFT 2022-07-18, GOOGL 2022-07-18) closed red, below the prior close. The Model Book glyph draws the
   Kicker candle with no gap at all.
6. Rulebook friction: his stop is defined on the finished daily candle, which you do not have when you buy at the
   open; a Kicker that opens more than 4% over the red day's high is a chase under C28; two kept examples (VOD, LHX)
   have a red day that closed under the 200-day, which B26 now forbids; UCT's own canonical public Kicker is an ETF
   (ARKK) while the bank's drafting code excludes ETFs.
7. Accuracy warnings for the house files: the in-house knowledge-base extract mis-dates and mis-attributes several
   Substack passages (section 5.7), and some "rules" in the bank and Model Book text (the 1-5% red body, the 9% red bar
   called too dramatic, "closes above the red day's high") are an assistant's notes, not the owner's words (section 6.1).
8. Two red-day floors the house uses would cut examples he kept (checked on a second price source, section 4.5): a red
   body of at least 1% cuts GS 2026-05-20, which he called "very good" (body 0.48%, though it fell 1.9% on the day), and
   RCUS ("good", 0.78%); a close in the lowest 35% of the red day's range cuts RCUS (49%) and IMAX (41%). His own
   "picture perfect" JBI and "ultimate elite" AMD both had stops over 2%, and AMD's Kicker day was a reaction to AI-chip
   news (TraderLion). The grading traits in section 9 are corrected to fit his own greats.

---

## 1. What it is

A Kicker is a two-day trap. A stock that is already set up closes red and weak near its low, as if it were breaking
down; the next morning it gaps up, trades through that red day's high and closes strong near its own high.

**Why it works (the psychology).** These are reasoning and claims, not measured facts.
- The red day invites sellers. The owner: "Sellers need to be trapped, so there needs to be like an almost failed
  breakdown vs just a little baby red candle." (verdict log, UAL, Kicker pass 3).
- The gap leaves them wrong at the open. The app's own narrative (`uct_kicker.py`): "Everyone who sold or shorted the
  weak close is offside from the first print". Bracco, on a market-wide version: "I viewed Thursday’s broad gap up as a
  potential kicker candle with short term positioning and sentiment caught offsides."
  ([Sunday Scans, 2026-06-14](https://unchartedterritoryy.substack.com/p/sunday-scans-e95))
- The owner frames it as positioning, not news: "kicker is more about short term positioning moreso. But sometimes with
  a catalyst or earnings." (verdict log, earnings batch).
- Bigalow, the most prolific published writer on the "Kicker Signal" that I found, frames it as a sentiment flip,
  usually from news: "The Kicker Signal illustrates a very dramatic change in investor sentiment." and "Usually a
  surprise news item is the cause of this type of move." ([TradingMarkets, 27 Mar 2008](https://tradingmarkets.com/?p=640877))
  Even the owner's "ultimate elite" AMD 2023-12-07 was a news day: TraderLion's write-up of Oliver Kell's AMD trade
  says of that date, "A positive reaction to news involving a new AI chip gaps the price up." (section 3.5)
- Who is trapped: anyone who sold or shorted the weak close, and anyone stopped out under the base low on the red day.
  Who is buying: overnight demand (the gap), shorts covering, the red-day sellers buying back, and breakout buyers once
  the red day's high goes. The owner's red day must look convincing for this to work; a small red candle "traps nobody"
  (Model Book playbook wording, `setupPlaybooks.js`).
- Some measured support for the ingredients, not for the story: in a study of 20,611 gap-ups in Russell 3000 stocks,
  "a black candle on Day -1 followed by a white candle on Day 0 is associated with above market returns."
  ([Dahlquist and Bauer, MTA 2011 Dow Award paper](https://cmtassociation.org/wp-content/uploads/2025/08/2011-dowaward.pdf))
  The effect was small (section 4.2).

---

## 2. Origin and naming

- **The Japanese candle "kicking".** Western candle catalogues list a two-candle "Kicking" pattern: a black marubozu
  (a candle with no shadows), a gap, then a white marubozu, and the mirror for the bear side. It is in Thomas Bulkowski's
  *Encyclopedia of Candlestick Charts* (John Wiley & Sons, 2008, per his own reading list in *Stocks & Commodities*
  V.29:11; his two kicking pages cite its pages 447 to 457), in the TA-Lib library as `CDLKICKING` (its change log, in
  MMDDYY form, dates the function's creation "010705", 7 Jan 2005), and in Schwab's thinkorswim pattern library.
  **I could not verify** who first described it in English, its Japanese name, or whether Steve Nison's books cover it.
  One unsigned candle site (The Right Trader) says Nison, in *Japanese Candlestick Charting Techniques* (1991), "described
  kicking as two opposite-color marubozu candles separated by a gap"; the repo's `docs/study/levels/external_research.md`
  reads that page correctly, but the page names no author and I could not check the book, so the Nison attribution
  stays unverified. The app's `tag_textbook.py` comment "(Nison: two long bodies)" is also unverified. StockCharts'
  ChartSchool candlestick pattern dictionary has no kicking entry (read 2026-11-09).
- **Stephen W. Bigalow's "Kicker Signal".** Bigalow is the most prolific published writer on the looser "Kicker
  Signal" that I found (2007 to 2023); I found nothing that says who coined the name. He calls it the most powerful
  candle signal ("The Kicker Signal is the most powerful signal of all.", TradingMarkets 2008), and the visible teaser of
  his Working Money article "The Candlestick Kicker" (4 Oct 2007) asks "Is it the most powerful candlestick signal?"
  ([Working Money, paywalled](https://premium.working-money.com/wm/display.asp?art=708)); TradingMarkets (27 Mar 2008);
  *Stocks & Commodities* V.41:06, "The Kicker Signal" (June 2023, pp. 32-36,
  [abstract](https://store.traders.com/stcov413kisi.html)); CQG blog (31 May 2023,
  [link](https://news.cqg.com/blogs/commentary/2023/05/kicker-signal-one-most-powerful-candlestick-reversal-signals)).
  He names two variants: the **Trend Kicker** (a Kicker inside an existing trend) and the **Flutter Kicker** (a doji
  between the bearish candle and the bullish one).
- **"Kicker Candle" in swing trading.** Oliver Kell used it as a confirming candle: "NFLX-Wedge Pop on volume via a
  Kicker Candle." ([The Weeklies Watch, 23 Mar 2023](https://weeklieswatch.substack.com/p/push-pull-continues)). UCT's
  first public definition is in the first Sunday Scans, 2025-06-08, on ARKK (quoted in 6.5). UCT also called ARKK's
  Kicker a "Breakaway Gap" (2025-07-13). The breakaway gap is one of the classic gap types; Dahlquist and Bauer's
  literature review (which cites Edwards and Magee's gap discussion; I did not open Edwards and Magee) puts it this way:
  "Breakaway gaps occur when price suddenly breaks through a formation boundary and signal the beginning of a trend."
- **Other names:** kicking, bullish kicking, kicker signal, kicker pattern, bull kicker, bearish kicker (UCT uses this on
  the indexes), trend kicker, flutter kicker; "kickerish type candle" (Sunday Scans, 2026-08-16).
- **In our app:** journal tag "Kicker Candle" (`app/src/constants/setupGroups.js`, Swing list); Model Book family
  "Gaps & Catalysts" (`app/src/pages/modelbook/setupCatalog.js`); detector `uct_kicker`; Study skill
  `setup.family3.kicker`.
- **Its neighbours in our list** (the owner separates them): "Power Earnings Gap" and "News Gappers" (an earnings-day gap
  is "an earnings gapper", his ruling), "Launchpad" (MSTR 2023-10-23: "Not a kicker, but that is a good launchpad"),
  plain breakouts (TSM, CVS, GWW cuts), "Oops Reversal" (the gap-down trap), "Red to Green".

---

## 3. Every definition I could find, source by source

### 3.1 Thomas Bulkowski, ThePatternSite, "Kicking, bullish" (measured statistics)
[https://www.thepatternsite.com/KickingBull.html](https://www.thepatternsite.com/KickingBull.html), read 2026-11-09.
The live site answers a plain request with an error (406) and the fetch tool returns only a summary, so every quote
below was checked on the Internet Archive's copy of the page (its market banner reads "As of 10/16/2026"; that banner
dates the index quotes at the top of the page, not the candle statistics, which carry no date). **Notice on the
site:** "This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems,
technologies," (the sentence continues), and the page carries a `robots` "noai" tag. I read and cite it with a link
and short quotes only; it is flagged here as asked.
- Shape: "Look for a tall black marubozu candle followed by an upward gap then a tall white marubozu candle."
- Prior trend: "None required."
- Length: two candles ("Two.").
- Volume, moving averages, entry, stop, target: not part of the definition. His three tips: "The candle breaks out
  upward most often -- page 457.", "Select tall candles for the best performance -- page 455." and "Breakouts below the
  50-trading day moving average result in the best performance -- page 457."
- Trend: the page notes better results "when price breaks out in the direction of the primary trend", and describes the
  pattern as "a bearish retracement in an upward price trend" in its example.
- His advice on use: "That is almost random, so do not try to guess the breakout direction from this candle pattern."

### 3.2 TA-Lib, `CDLKICKING` (open-source library; the definition most charting code copies)
[ta_CDLKICKING.c](https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLKICKING.c), read 2026-11-09 (raw source).
- Shape, from the code comment: "- first candle: marubozu", "- second candle: opposite color marubozu", "- gap between
  the two candles: upside gap if black then white, downside gap if white then black".
- What the code tests (bull side): the first candle is black, the second white; the second candle's **low is above the
  first candle's high** (a full price gap, a "window"); each body is longer than the average body of the last 10
  candles; each shadow is shorter than 10% of the average range of the last 10 candles (defaults in
  `src/ta_common/ta_global.c`: `TA_BodyLong` 10 bars, factor 1.0; `TA_ShadowVeryShort` 10 bars, factor 0.1).
- No trend, volume, entry, stop or target.

### 3.3 Charles Schwab, thinkorswim Learning Center, "Kicking" (broker platform reference)
[toslc.thinkorswim.com ... /Kicking](https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bearish-and-bullish/Kicking),
read 2026-11-09.
- "Kicking is a trend reversal candlestick pattern consisting of two candles."
- "The first candle is bearish and misses both upper and lower shadows;" then "The second candle is bullish, misses both
  shadows and gaps up from the first candle."
- A shadow counts as missing "If the shadow length of a candle is less than 5% of this average" (the average body).
- No trend test is stated, no volume, entry, stop or target.

### 3.4 Stephen W. Bigalow (the main published writer on the loose "Kicker Signal"; who coined the name is not established)
His author notes name his site, candlestickforum.com (it now redirects to thetradersforum.com; its pages refused plain
and fetch-tool reads, so nothing from it is quoted here).

**TradingMarkets, 27 Mar 2008** ([link](https://tradingmarkets.com/?p=640877)), read 2026-11-09:
- Prior trend: "A bullish kicker is formed after an announcement or some event, a down-trending price alters its
  direction,"
- Gap: "The second candle opens at the same open as the previous day, or gaps open," and "The bodies of the candles are
  opposite colors." (So the reference is the prior **open**, and an equal open counts.)
- Cause: "Usually a surprise news item is the cause of this type of move."
- Location: "Its relevance is magnified when occurring in the overbought or oversold area," yet it "is effective no
  matter where it appears in a price trend."
- Entry: "allows an investor to enter a trade upon seeing a gap up in price," and the sentence goes on: "on an open that
  is above the previous time periods chart formation." That reads stricter than the definition above (an open over the
  whole prior candle, not just its open), so the article is not consistent on the reference price.
- Exit: "If in the next time frame prices gap back the other way, liquidate the trade immediately."
- No body size, volume or stop rule.

**CQG blog, 31 May 2023** ([link](https://news.cqg.com/blogs/commentary/2023/05/kicker-signal-one-most-powerful-candlestick-reversal-signals)),
read 2026-11-09:
- "One of the most powerful candlestick reversal signals is the Kicker Signal."
- Gap: "The price gaps up at or above the previous day's open and moves in the opposite direction"
- Size: "The bigger the body, the stronger the demonstration of a dramatic change in investor sentiment."
- Location: "it does not matter where the signal occurs during a price trend."
- Trend Kicker: "It is a Kicker Signal that occurs during an existing trend." and "a Trend Kicker Signal allows for
  immediate entry with the expectation that the trend will likely continue". He adds: "Witnessing a bearish trading day
  during an uptrend is not necessarily a bearish reversal signal; merely profit-taking is not an uncommon occurrence."
  His example: after a break over the 200-day, "the next day when the price gapped up above the previous day's open and
  traded positively created a bullish Trend Kicker Signal". Of the outside definitions, this is the nearest to the
  owner's Kicker (a red day inside an uptrend, then a gap that reverses it).
- Location: his CALX example is "a Kicker Signal off the 50-day moving average", and of candle buy signals in general
  the article says one "at a significant support level, such as a moving average or trend line, reveals where
  investment decisions are activated."
- Chasing: "the Kicker Signal eliminates the 'chasing' fear factor." (This pulls against house rule C28.)
- Flutter Kicker: "The flutter is the Doji in between a bearish candle and a gap-up indecisive day followed by a bullish
  candle."
- Entry alert: "The initial alert of a Kicker Signal developing is the gap up above the previous day's open."
- Exit: "The position is maintained until there is a candlestick sell signal and a close back below the T line." The
  article does not define the "T line".
- Claim, unmeasured: "There is a very high probability of expected results when visually recognizing the signal."
- No volume and no stop rule.

### 3.5 Oliver Kell (originator of the price cycle; uses the word, publishes no rules for it)
- "NFLX-Wedge Pop on volume via a Kicker Candle." ([The Weeklies Watch, 23 Mar 2023](https://weeklieswatch.substack.com/p/push-pull-continues))
  So for Kell it confirms a wedge pop, on volume. The same line goes on: "NFLX led the January up move and trended down
  during the correction." So his Kicker came off a correction, the case the owner graded down for SMH ("a gap versus
  intermediate downtrend"). Same post, on another name (AMZN): "If lost today’s low no interest in it."
- His general mechanics (interview, not Kicker-specific; [Stockbsessed, 1 Apr 2023](https://stockbsessed.substack.com/p/oliver-kell-interview-the-mind-and)):
  "For a loser, I am often using the breakout pivot or day's low as my stop if buying a breakout."; "I use the 65 Min to
  execute."; "I also do not trade the first 10-15 minutes unless a stock has a catalyst like earnings."; "I might take a
  15% position with a 1-2% stop (risking 15-30bps)." The interview does not mention a kicker.
- TraderLion, "Anatomy Of A Trade: AMD +50% Wedge Pop" (posted under Kell's profile, 13 Sep 2024;
  [link](https://traderlion.com/profile/oliver-kell/amd-wedge-pop/)). The live page shows a browser check; I read the
  Internet Archive's copy. It is TraderLion's account of his trade, not his own post. Three entries matter here:
  - 7 Dec 2023, the owner's "ultimate elite" AMD Kicker day: "A positive reaction to news involving a new AI chip gaps
    the price up." (So that Kicker was a news day.)
  - 20 Dec 2023, "Bear Kicker After Weak Close": "This type of negative action after a bad close gave Oliver reason to
    reduce his position."
  - 21 Dec 2023, "Bull Kicker After Beark Kicker" (sic): "A positive expectation breaker occurs when the price responds
    positively after weak price action. Oliver re-entered his position here at a higher cost."
  No rules, stop or volume test are given for the Kicker itself.

### 3.6 Kristjan Kullamägi (Qullamaggie): the opening-range entry and day-low stop (not a Kicker source)
[qullamaggie.com, 8 Jan 2021, updated 28 Apr 2021](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/),
read 2026-11-09. He never mentions a kicker. His breakout and episodic-pivot mechanics are the nearest published version
of the owner's ORB entry: "The opening range highs can be the highs of the first 1-minute candle, the 5-minute candle
or the 60-minute candle", and the parenthesis that follows names the owner's window: "(on the 60-minute timeframe the
first candle is always only 30 minutes, 9.30-10 AM)". Also: "Stop is always lows of the day"; "stop should not be wider
than the ATR or ADR of the stock"; "You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop
to break even."; "The rest of the position should be trailed with the 10- or the 20-day moving average."

### 3.7 Dahlquist and Bauer, gap study (measured; defines a gap, not a Kicker)
"Analyzing Gaps for Profitable Trading Strategies", Julie R. Dahlquist and Richard J. Bauer Jr., Market Technicians
Association 2011 Charles H. Dow Award winner ([PDF](https://cmtassociation.org/wp-content/uploads/2025/08/2011-dowaward.pdf)),
read 2026-11-09. The CMT Association's own slide deck on the study (section 4.2) says it appeared in the *Journal of
Technical Analysis*, Issue 67.
- Gap: "A gap up occurs when today's low is greater than yesterday's high" (the strict "window").
- Their findings that describe a Kicker-like day are in section 4.2.

### 3.8 UCT's own definition (Sunday Scans, 2025-06-08) and the owner's rulings
Full detail in section 6. In one place:
- UCT, ARKK: "A candlestick pattern that closes the previous day negative, near lows of the day and into a support
  level; in this case the 20 ema. Gap up the following day and break previous days high."
  ([Sunday Scans, 2025-06-08](https://unchartedterritoryy.substack.com/p/sunday-scans)) and "This is a specific entry
  signal, especially within a clean chart pattern."
- The owner (verdict log): red day weak, "an almost failed breakdown"; a "regular gap up" after a mid-range close is not
  one; "rarely earnings"; a gap "versus intermediate downtrend" is technically not one (he still kept SMH as a C-);
  entry "over previous day high or on day 1
  kciker ORB on the 30 minute"; stop "Under the kicker candle low or entry with a 3.5% stop".
- The bank's written definition (`docs/study/bank/spot.setups.json`, all 50 Kicker items, status draft) adds "a real body
  (about 1-5% of price)" and "usually on a volume surge". Neither phrase is in his verbatim words in the verdict log
  (section 6.1).

### 3.9 Read and not used as sources
- Amphibian Trading (Substack, byline "Brandon", 8 Sep 2022): defines the Kicker bar as a gap "above the opening price
  of the 'set up' candle", in a strong stock in a leading group forming "a proper basing structure" (its EQT example
  was a cup with handle whose handle "drifted down on light volume towards the 21ema and 50sma"); the stop at the
  setup bar's close ("a stop loss at the previous days close"). A practitioner blog with no full author name,
  so not relied on.
- The Right Trader ("By The Right Trader", no author): no named author; its useful line is honest: "There is no
  reliable published figure for a bullish kicker win rate that covers every market, timeframe, and exit rule."
- Investopedia "Kicker Pattern": blocked to me (both fetch and plain request). The course bank already quotes it in
  `docs/study/bank/course.v.json`; I could not re-check that quote.
- LuxAlgo, broker academies (TMGM, Angel One, Bajaj, Groww, Strike) and similar pages turned up in searches. They are
  unsigned or look machine-written; not read as sources.
- QuantifiedStrategies, "Bullish Kicker" (byline Oddmund Groette): its backtest section describes a different,
  three-candle pattern under the kicker's name, so it is not used.
- Searched, nothing found on kickers: Stockbee (Pradeep Bonde), Brian Shannon (the owner names his "Gap Up vs
  Intermediate Trend" idea; I found no public write-up to quote), investors.com (a site search found no kicker article),
  StockCharts ChartSchool (its candlestick pattern dictionary has no kicking entry), Minervini, Raschke and Qullamaggie
  (nothing on kickers in searches). TraderLion has the Kell AMD write-up quoted in 3.5.
- Academic tests: searches listed two-day candle studies on Taiwan stocks (Lu, Shiu and Liu, *Review of Financial
  Economics*, 2012) and Thai stocks (Tharavanij et al., *SAGE Open*, 2017). I did not get either paper's text (the SAGE
  page refused the request; I did not reach a full text of the other), so I cannot say whether kicking is among the
  patterns tested; none is used here.

### 3.10 Comparison table

| Source | Prior trend | The red day | The gap | The Kicker day | Volume | Location | Entry | Stop | Exit |
|---|---|---|---|---|---|---|---|---|---|
| Bulkowski (stats) | "None required" | tall black marubozu | an upward gap between the candles | tall white marubozu | not in definition | tip: below the 50-day did best; with the primary trend | none | none | measured as a close above the pattern |
| TA-Lib | none | black marubozu, long body | day-2 low above day-1 high | white marubozu, long body | none | none | none | none | none |
| Schwab | called a reversal | bearish, no shadows | "gaps up from the first candle" | bullish, no shadows | none | none | none | none | none |
| Bigalow 2008 | after a downtrend | opposite colour | open at or above the prior **open** | opposite colour | none | stronger when overbought/oversold | on seeing the gap | none | out if the next bar gaps back |
| Bigalow 2023 | anywhere; the Trend Kicker sits inside an existing trend | bearish | at or above the prior open | bigger body, stronger | none | "does not matter where"; an example off the 50-day | Trend Kicker: immediately | none | candle sell signal plus close under "T line" |
| Kell (usage) | confirms a wedge pop (NFLX, after a correction) | n/a | n/a | n/a | "on volume" | n/a | 65-min execution (general) | day's low (general) | n/a |
| UCT 2025-06-08 | "clean chart pattern" | closes negative, near lows, into support | "Gap up" | breaks the previous day's high | noted (highest since Dec 2023) | 20 EMA support | the break of the prior high; Bracco (TEM) bought "through the opening range highs" | below the Kicker's low (Bracco, TEM, same post) | gap holding = thesis |
| Owner rulings | already set up, uptrend or base, not vs intermediate downtrend | real red bar, weak close near low, "almost failed breakdown" | gaps up (size not ruled) | not in his words; the bank and Model Book text say it closes above the red high, near its own high (all 16 kept did) | "usually" a surge (bank text, not his words) | a base ("two-week base", "flat base with bunched flat averages": assistant notes beside his AMD and JBI verdicts) | red high + $0.01, or 30-min ORB, on the Kicker day | Kicker low, or 3.5% if closer | deferred 2026-11-02; rulebook since 2026-11-09 |
| App detector `uct_kicker` | none | close in lowest 35% (any colour), or red in lowest 60% | open over prior **close** by 0.1 x prior range | high over prior high; close not required | score only | labels only | prior high, or the open if above it | the session's low | 2R, 3R |
| Dahlquist & Bauer (gap study) | any | black candle helped | day low above prior high | white candle helped | above 30-day average helped | below 10-day average helped | next day's open | none | 1 to 20 days |

### 3.11 Where they disagree
1. **What the gap is measured from.** Prior close (the app; the owner's examples: 5 of 16 kept opened inside the red
   body), prior open (Bigalow; the app's "textbook_v5" member-tag test), prior high or a full window (TA-Lib; Dahlquist
   and Bauer; Manrav's scan, section 6.6). Recommendation: from the close, with "above the red day's open" as a
   grade factor, because his "picture perfect" JBI did not open above the red day's open (section 4.5).
2. **Candle shape.** Shadowless bodies (Bulkowski, TA-Lib, Schwab) versus any real body (Bigalow, UCT). Ours is the
   second.
3. **Trend.** None required (Bulkowski, Bigalow 2023), after a downtrend (Bigalow 2008; Kell's NFLX after a
   correction), or inside an uptrend or base (the owner; UCT; Bigalow's Trend Kicker). Bulkowski's own example text
   calls "a bearish retracement in an upward price trend" the preferred setup, which matches the owner.
4. **News.** Bigalow: usually news. The owner: positioning, rarely earnings. UCT's own live examples include headline
   gaps (JOBY on an NVDA partnership; AMD the day after its 2025 analyst day), and his "ultimate elite" AMD 2023-12-07
   was, per TraderLion, "A positive reaction to news involving a new AI chip".
5. **The close.** The bank and Model Book text require a close above the red high, near the Kicker's own high; his
   verbatim words do not state it, UCT's 2025-06-08 definition says only "break previous days high", and every kept
   example did close above it (the finders required it). The candle definitions imply a strong close through the white
   marubozu, and Dahlquist and Bauer found white gap-day candles did better. The app's detector does not require it.
6. **Entry.** On seeing the gap (Bigalow), over the red day's high (owner; UCT 2025-06-08), the opening-range high
   (owner's 30 minutes; Bracco's TEM "through the opening range highs"; Qullamaggie's 1, 5 or 60 minutes, his first
   60-minute candle being 9:30 to 10:00), the close (secondary sites; the owner rejected it: "not at mkt close!"), or a
   later pause (attributed to Kell in an in-house knowledge-base note, KB 1984, and in the brain's template; unverified).
7. **Stop.** The Kicker's low (owner; Bracco; the owner's JOBY note), the red day's low (in-house template), the
   short-term averages (the owner's 2024 desk log; Manrav), the gap or the red close (Amphibian; `UNITS-method.md`).
8. **Exit.** Gap back the next day (Bigalow 2008), a "T line" close (Bigalow 2023), a bearish engulfing candle (UCT,
   ARKK), house trims and trail (rulebook).
9. **Volume.** Absent from every candle definition; stressed by UCT and the owner.

---

## 4. Measured evidence

### 4.1 Bulkowski, kicking (the strict two-marubozu candle)
Checked on the Internet Archive's copy (see 3.1); the site carries the AI notice quoted in 3.1.
- **Bullish kicking:** "Tested performance: Bullish reversal 53% of the time"; "That is what I call "near random.""
  Frequency rank 100 of 103 (rare). Overall performance rank 96 of 103. Best percentage meeting the price target 52%
  (bull market, up breakout). Best average move 10 days after the breakout 2.78% (bull market, up breakout); "I consider
  moves of 6% or more to be good, so this is well short of the mark." Sample: "The above numbers are based on hundreds
  of perfect trades." and "the candle was rare enough that I only included partial statistics in my Encyclopedia of
  Candlestick Charts book."
- **Bearish kicking** ([KickingBear.html](https://www.thepatternsite.com/KickingBear.html)): "Bearish reversal 54% of the
  time"; frequency rank 102; overall performance rank 102; best percentage meeting the price target 51% (bull market,
  down breakout); best average 10-day move 3.90% (bull market, up breakout). Tip: "Volume gives performance clues --
  page 448."
- **How he measures** (his own description of his candle testing, *Stocks & Commodities* V.29:11, Nov 2011, "The Eight
  Best-Performing Candles", [PDF hosted by Fidelity](https://fidelity.com/bin-public/060_www_fidelity_com/documents/EightBestCandles.pdf)):
  "I looked at more than 4.7 million price bars (candle lines) to identify and track 103 candle patterns. A close above
  the top of a candle represents an upward breakout." The database there is "(500 stocks of 10 years' duration)". The
  bearish page counts against the same total: "I uncovered 116 bearish kicking candles out of over 4.7 million candle
  lines." The bullish page gives no count. I did not read the book.
- **Limits.** The candle is much stricter than ours (no shadows, a gap between candles). The bearish sample is 116;
  the bullish sample is not stated beyond the site's boilerplate "hundreds of perfect trades", and neither is dated on
  the page. "Reversal" means the exit direction, not a trade. No stop, no entry rule. The page does not define "price
  target" in its text ("See the glossary for definitions.").
- **Use for us:** none as a win rate. It should not be printed next to our Kicker. Two of his tips (tall candles; the
  best results below the 50-day, inside an upward trend) are consistent with the owner's picture.

### 4.2 Dahlquist and Bauer: gap-ups after a black candle (Russell 3000, 2006-2010)
- **Data and method:** "we consider stocks included in the Russell 3000 between January 1, 2006 and December 31, 2010."
  "20,611 gap ups occurred" (and 17,435 gap downs, over 1,259 trading days). Liquidity: "a stock had to have a trading
  volume of over 1 million shares on the gap day and the four prior trading days". A gap is a full window (the day's
  low above the prior high). Returns start at the next day's open: "We base our return calculations from the open at
  the next day (Day 1) to the close on Day 1 to calculate a 1-day return."
- **Findings in their words:** "The results suggest that when a stock gaps up and closes higher than it opens, this
  upward price trend will continue for the next few trading days"; "However, if the price gaps up, but the close is
  lower than the open, even though the gap remains unfilled, don't expect the upward price movement to continue."
  Conclusion: "Traders should also look for larger percentage gaps, gaps preceded by a black candle, gaps occurring on
  above average volume, and gaps occurring below the 10-day moving average of price". And "Gaps occurring above the
  10-day moving average tend to have a below market return, suggesting that these are exhaustion gaps."
- **Numbers (their Table 2, market-adjusted, black candle then a white gap candle):** +0.123% after 1 day, +0.254%
  after 3, +0.268% after 5, +0.638% after 20. For a white candle then a white gap candle: +0.023%, -0.062%, +0.150%,
  +0.906%. So the black-candle edge showed up over 1 to 5 days and not at 20 days. **Table 6** (white gap candle, by the
  10-day average): below it +0.195%, +0.259%, +0.401%, +1.004%; above it -0.077%, -0.205%, -0.005%, +0.743%.
  I read these from a text extraction of the PDF's tables and checked that each row equals the raw return minus the SPY
  return; still, check the PDF before quoting a figure to members.
- **Limits.** Average returns, not trades: no stop, no target. Entry is the next day's open, not over the red high on
  the gap day. The window gap is stricter than ours (only 5 of the 16 kept Kickers had one). Five years only, including
  2008. No significance tests are reported in the paper. Effects are a fraction of a percent.
- A CMT Association slide deck summarising this study for traders exists
  ([0129-scott-1.pdf](https://cmtassociation.org/wp-content/uploads/2024/01/0129-scott-1.pdf)); I used the paper, not
  the deck.

### 4.3 Claims with no numbers behind them
- Bigalow: "most powerful", "very high probability". No study is given in the pages I read.
- The Right Trader (not a source, but correct on this): no reliable published win rate exists for the loose Kicker.
- The app's narrative: "A kicker that holds its gap tends to resolve quickly". Not measured in the code.

### 4.4 The house's own replays (not published statistics; read the limits)
Generated by `docs/study/levels/measure_rules.py` on the pod's daily bars. Columns as defined in those files: "stop
hit" = the first stop was hit within 60 sessions even after a gain; "2R" = reached twice the risk before any stop;
"+20 sessions" = the median return 20 sessions after the fill **of the trades not stopped** (survivors only, so it
flatters).

| Sample | Entry / stop | n | median risk | stop hit | 1R | 2R | 3R | median best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 16 kept (`evidence_kept.md`) | red high / Kicker low (his ruling) | 16 | 2.1% | 50% | 100% | 100% | 100% | 16.8 | +18.5% |
| 16 kept | red high / red day's low | 16 | 4.5% | 44% | 100% | 94% | 88% | 6.1 | +18.1% |
| 16 kept | Kicker close / Kicker low | 16 | 6.1% | 50% | 88% | 69% | 56% | 3.9 | +15.3% |
| 150 deep-history (`evidence_atlas.md`) | red high / Kicker low (his ruling) | 150 | 2.7% | 74% | 75% | 59% | 48% | 2.7 | +10.6% |
| 150 deep-history | red high / Kicker low, 3.5% cap | 150 | 2.7% | 77% | 77% | 59% | 47% | 2.7 | +10.3% |
| 150 deep-history | red high / red day's low | 150 | 5.1% | 63% | 64% | 49% | 35% | 1.9 | +10.0% |
| 150 deep-history | Kicker close / Kicker low | 150 | 4.9% | 74% | 43% | 32% | 21% | 0.8 | +8.6% |

What it says and does not say:
- The deep-history set is the honest one: "every one the owner's calibrated finders accepted in the top 1,000 stocks by
  dollar volume that day since 1995", "NOT filtered for having worked" (its header), with no other setup firing on the
  same bar. The app's detector must fire first, then the pass-4 Kicker rule (`scripts/study/find_pass4_examples.py`,
  run by `scripts/study/bank_v2/scan_history.py`, which leaves ETFs out). The scan has no earnings filter (that rule is
  applied later, at drafting, in `draft_pass.py`), so the 150 can include earnings-day gaps.
- On it, his entry and stop beat the close entry on every R column, and his Kicker-low stop reached 2R and 3R more often
  than the red-day-low stop.
- Three-quarters of trades hit the first stop at some point within 60 sessions. That is why the trims and trail matter
  (section 8.4).
- Limits: daily bars cannot order the moves inside a day; the files say "the stop is not checked on the fill day", and
  the code counts the fill day's high toward the best R (`replay()` in `measure_rules.py`). Both flatter the numbers.
  Stocks delisted since are missing. No costs or slippage. The 16 kept charts were mostly chosen to work: the 6 pass-4
  charts came from a finder that required the Kicker's low never to break in the next 20 sessions, the 3 pass-3 charts
  from one that required no close under it (both also an 8% gain and higher closes 10 and 20 days on); the 6 pass-2
  charts came from a finder with no forward test (`find_kicker_examples.py`) and were kept by him after seeing the 20
  sessions that followed; RBRK was his own reference. So their 100% figures are largely by construction.

### 4.5 What the 16 kept Kickers look like (my count from the bank files)
Source: `docs/study/bank/levels.kicker.json` (prices) and `docs/study/setups/setup_examples.json` (facts), both built
from the pod's daily bars. Cold check: all 16 red days and Kicker days were pulled again from Yahoo's daily bars
(`yfinance`, unadjusted); opens, highs, lows and closes agree with the stored values within a cent, and the fields the
store lacks are filled from Yahoo below, marked "(Yahoo)". Several ranges below sit on the finders' own floors (gap
1.5%, volume 1.5x, day gain 4%, close in the top 20-30%), so they describe the finder as much as the setup.
- **Gap from the red close:** 1.71% to 6.63% (median 3.0%).
- **Kicker-day volume vs its 50-day average:** 1.51x to 6.94x (median 2.47x).
- **Kicker-day gain:** +4.42% to +15.64% (median +8.8%).
- **Kicker close in its range:** 81% to 100% (median 94.5%).
- **Red day close in its range** (10 with the field): 3% to 31% (HOOD 0.03, BMRN 0.03, LHX 0.06, AMD 0.07, ENS 0.09,
  PSN 0.10, VOD 0.10, SMH 0.14, RBRK 0.20, GS 0.31). The other six (Yahoo): VTRS 0.07, JBI 0.22, JBTM 0.23, ISRG 0.37,
  IMAX 0.41, RCUS 0.49. So across all 16: 3% to 49%. Of the three over 0.35, RCUS ("generally want a bit of a weaker
  close") and ISRG ("I want a weaker close") drew exactly that complaint; IMAX ("not super ideal but good enough") was
  an earnings day.
- **Red day body** (open minus close, % of the close): 7 are stored in `setup_examples.json`; 5 more (JBTM 1.26%, JBI
  5.27%, HOOD 2.85%, PSN 1.52%, VTRS 2.24%) are in the pass-3 measurement note in the verdict log (line 37), and Yahoo
  agrees with all 12. The last four (Yahoo): IMAX 1.01%, RCUS 0.78%, GS 0.48%, ISRG 0.07%. So across all 16: 0.07% (ISRG)
  to 5.27% (JBI). **GS, which he called "very good", had a 0.48% body** but fell 1.86% close to close (it opened below
  the prior close). RCUS ("good") had a 0.78% body and closed 0.79% *up* on the day; VTRS closed flat on the day.
- **Red day volume** (Yahoo): mostly ordinary (0.65x to 2.4x its prior 20-day average), except JBI, his "picture
  perfect" one: 24.0 million shares on the red day, about 28 times its 20-day average and 2.6 times the Kicker day's
  9.3 million. (I did not look up why.)
- **The gap held all day in all 16:** the Kicker day's low stayed above the red day's close, by +0.42% (LHX) to +3.74%
  (JBI).
- **Opened above the red day's high:** 8 of 16. **Full window gap** (Kicker low above the red high): 5 of 16 (JBTM,
  ISRG, PSN, GS, VOD).
- **Opened above the red day's open:** 11 of 16. Not JBI, VTRS, SMH, LHX, ENS. (Confirmed on Yahoo's actual red-day
  opens. JBI: Kicker open 10.94 against a red open of 10.98. AMD is the closest call the other way: 120.79 against
  120.69.)
- **Natural stop** (fill to the Kicker's low): 0.41% to 4.16%, median 2.0%. **15 of 16 within 3%**; only HOOD
  2024-05-17 (4.16%) needed the 3.5% cap.
- **Opened more than 4% above the red high** (a C28 chase at the open): 1 of 16, VOD 2022-01-24 (+4.84%).
- **Earnings day:** 2 of 16 (IMAX 2026-02-26, VTRS 2024-11-07). **Red day closed under the 200-day** (stored
  `above_200` false): VOD 2022-01-24 and LHX 2022-02-24. RBRK has no stored 200-day fact.
- **None would pass the strict candle:** run through TA-Lib's own test on the Yahoo bars (window gap, both bodies longer
  than the 10-candle average body, every shadow under 10% of the 10-candle average range), all 16 fail; the five with a
  window gap each fail on shadows. That supports point 1 of the short version.

### 4.6 Not measured anywhere I found
The 30-minute ORB entry (no intraday bars for these dates in the house replays); the trapped-seller premise itself; the
effect of relative strength (RS) on Kickers; a Kicker-specific trim or trail.

---

## 5. Our app: what the code and the cards actually say

### 5.1 The detector, `api/services/pattern_engine/detectors/uct/uct_kicker.py` (pattern `uct_kicker`, made public by owner ruling 2026-10-15 per `api/routers/patterns.py`)
It fires on session i when all three hold:
- **K1 weak prior close:** the prior day's close sits in the lowest 35% of its range (`KICKER_WEAK_DCR = 0.35`), **any
  colour**; or the prior day was red and closed in the lowest 60% (`KICKER_RED_DCR = 0.60`).
- **K2 gap:** open above the prior **close**, by at least 0.10 x the prior day's range (`KICKER_MIN_GAP_RANGE`).
- **K3:** the day's high is above the prior day's high.
- The composite confidence (0.40 geometry + 0.25 volume + 0.20 context + 0.15 x a fixed 50) must reach
  `CONFIDENCE_FLOOR = 50` (`uct_setups_common.py`). But geometry starts at 70 and the volume and context scores are
  floored at 40, so the lowest possible confidence is 53.5: this gate never removes a Kicker, and volume never gates it.
Labels only, never a reason to fire: K4 (green and close above the prior high), M1 (close back over the 8 and 21 EMA),
M2 (prior close under the 21 EMA and an open over the prior high), V5 "textbook" (prior red, open above the prior
**open**, green day), a 50/200-day "character change", a rising 200-day, support near the 20/21 EMA or 50-day, gap %,
relative volume. Gates: at least 23 bars and the shared liquidity floor (`primitives/liquidity.py`: last close at
least $2, average dollar volume at least $10,000 a day over 20 bars). It reports the newest trigger in the last 3
sessions (`MAX_TRIGGER_AGE = 3`) unless a later low broke the stop. **Entry:** the prior high, or the open if it opened above it. **Stop:** the trigger session's low.
**Targets:** 2R and 3R (`uct_setups_common.make_levels`). The score adds points for K4, an open over the prior high, a
very weak prior close and a strong close.

### 5.2 Where the detector disagrees with the owner and the sources
1. **No close requirement.** The bank's Kicker definition (drafted from his rulings, not his own words) "closes above
   the red day's high and near its own high", and all 16 kept Kickers did. K4 is only a label. The app's own positive
   fixtures (`docs/study/bank/family.fixtures.json`, draft "Which family" items) show the cost: MSFT 2022-07-18 opened 259.75 over a 256.72 prior close, traded over the prior high, and closed 254.25,
   red and under the prior close; GOOGL 2022-07-18 opened 112.64, closed 109.03 under a 111.78 prior close. AAPL
   2022-07-12 closed 145.86 from a 145.76 open, under the prior high of 146.64. Three of six "real trigger" fixtures
   are not Kickers by the house definition. (A separate data fault in the same file: the META 2022-07-15 fixture's
   first five bars, 2022-01-24 to 01-28, sit near $12 and the sixth opens at $300.68, so its chart starts with another
   security's prices.)
2. **The prior day need not be red** (MSFT's prior day was green), and a red day closing at 60% of its range passes.
   He marked ISRG down to a lesser example for a mid-range close.
3. **No body size.** He cut doji-like red days (TSM, CVS, GWW); the pass-3 measurement of his verdicts (an assistant's
   finding in the log, line 37) found the kept ones had a real red body, though GS, kept later as "very good", had a
   0.48% body and a 1.9% drop on the day (4.5).
4. **The gap can be tiny and inside the red body.** 0.1 x the prior range over the close. The bank's finders use 1.5%.
5. **No context gate:** no 50 or 200-day test, no base. He graded a gap against an intermediate downtrend C-, and B26
   forbids longs under the 200-day.
6. **No earnings test.** His rule: rarely earnings.
7. **Liquidity floor $2 and $10,000 a day** versus house rule B23 ($10 and $20 million a day).
8. **Stop on the finished daily low**, exactly on it. At entry time that low does not exist yet, and F62 puts the stop a
   few cents under. No 3.5% cap here (the cap is applied later in `api/services/study_trade.py`,
   `KICKER_MAX_STOP = 0.035`).
9. **Entry at the prior high, not a cent over** (`study_trade.py` adds the cent).
10. **2R and 3R targets and "under each higher low or under the 10-day" trail** (its narrative) versus the rulebook's
    third at 3R, third at 5R, trail the 10 or 21-day on a close (B19, E51, E52).
11. **It keeps firing for 3 sessions.** His entry is on the Kicker day only.
12. **How loose it is:** the pass-2 finder run of 2026-10-24 (`setup_examples.json`, block `kicker_pass2`) logged
    366,660 raw detector hits across 3,453 stocks, of which 1,560 passed the finder's stricter rules.

What it does well: Hard mode (`api/services/study_hard.py`) uses it only to leave out charts where a Kicker might be
arguable ("errs toward leaving a chart out"), which is the right direction for a loose rule.

### 5.3 The other Kicker rules in the app (they do not agree)
| Where | Rule |
|---|---|
| `api/services/setup_tags.py` (member tag) | Kicker tag shown only with label `textbook_v5`: "A down candle followed by an up candle that opens above the prior session's open, so the two bodies do not overlap." |
| `api/services/pattern_engine/tag_textbook.py` | red then green, open at least 0.05 ATR over the red open, both bodies at least 0.5 ATR. Judged mean 2.73 in its blind recertification (a tag-quality score, not a trading result). |
| `scripts/study/find_kicker_examples.py` (pass 2) | prior red; gap at least 1.5% over the prior close; green; close above the prior high; close in the top 30%; day at least +4%; volume at least 1.5x its 50-day average; setup score at least 10; not a downtrend (red close under the 200-day with a falling 50-day); close no more than 30% over the 50-day; price at least $5 and 300,000 shares a day. No forward (must-work) test. |
| `scripts/study/find_pass4_examples.py` (pass 4, used for the deep history) | the pass-2 candle rules tightened: red close in its lowest 35%, red body at least 1% of its close, red range 0.9 to 3.0 ATR, red close at or under the prior 5-day low x 1.01; gap 1.5% to 8%; close in the top 20%; day +4% to +15%; range at most 4 ATR; its own setup score at least 7; price at least $10 and $20 million a day over the window (B23's numbers); and (for examples, not the deep scan) the low never broken in 20 sessions. |
| `api/services/chart_iq/engine/v2_setups.py` | prior close under the 21 EMA; open at least 1% over the prior close; high over the prior high; close over the 9 and 21 EMA and no more than 0.5% under its open; a gap of 8% or more on 3x volume is called an episodic pivot instead. |
| `api/services/chart_iq/engine/v44_read.py` | red body at least 0.5 ATR, open over the red open, open at least 1 ATR over the red close, close in the top 30%, volume at least 1.5x. |
| `api/services/chart_iq/engine/markup.py` | gap at least 3%, the day's low over the prior high, volume at least 1.5x, prior bar down, open over the prior open. |
| `api/services/study_trade.py` | his entry and stop: a cent over the red high; Kicker low or 3.5% under entry, whichever is closer; targets 2R, 3R. |

### 5.4 Model Book card and playbook
- **Card** (`app/src/pages/modelbook/setupCatalog.js`): "A weak red day that looks like a failed breakdown out of a
  base, then a gap up that follows through and closes above that day's high: the sellers are trapped. Rarely
  earnings." This matches his rulings, except that the close above the red day's high is house wording (6.1).
- **Glyph problem:** the Kicker candle is `[9, 1.5, 0.3]` with no fourth value, and `SetupGlyph` (in
  `app/src/pages/modelbook/SetupsView.jsx`) opens a candle at the prior close when the gap value is missing. So the
  picture shows **no gap**. The candles before it are six red days in a row (-1.5 to -3%), which reads as a slide, not
  the base the text describes. No pivot line is drawn at the red high.
- **Playbook** (`app/src/pages/modelbook/setupPlaybooks.js`): entry "The kicker day itself, once it is holding above the
  red day's high"; stop "The low of the kicker day"; exit "Trail under each higher low or the 10-day average". It does
  not state the cent over the high, the 30-minute ORB, the 3.5% cap, or the rulebook trims. Its mistake "a 9 percent red
  bar is too dramatic" is an assistant's note on TH, not the owner's words (6.1).

### 5.5 Journal tags (`app/src/constants/setupGroups.js`)
"Kicker Candle" sits in the Swing list beside "Power Earnings Gap" and "News Gappers", so a member can tag an earnings
gap correctly. (The file's own header calls it the setup list for the Model Book's "Add Setup" dropdown and any future
setup pickers.) The journal's grade list is `['A+', 'A', 'B', 'C', 'F']`; the rulebook grades are A+, A, B, B- (D38,
E49).

### 5.6 Other study texts
- `docs/study/TRADE_PLANS.md` Kicker row: his entry and stop; trim "2R, 3R"; trail "under each higher low, or under the
  10-day average". The rulebook (B19) says it replaces "take some off at 2R and 3R".
- `docs/study/UNITS-method.md` SET.23: "a catalyst gap that closes above that day's high and traps the shorts; the
  cleanest RED TO GREEN entry" and "place the stop under the gap". "Catalyst" and "red to green" pull against his
  "short term positioning" and his separate "Red to Green" tag; "under the gap" is not his stop.
- `docs/study/OWNER_PRINCIPLES.md` rule 8 carries his entry and stop words correctly, except that it silently spells
  "kciker" (his typo, twice in the log) as "kicker" inside the quotation marks.

### 5.7 The in-house levels dossier and knowledge-base extract: accuracy warnings
`docs/study/levels/dossiers/kicker.md` relies on `docs/study/levels/brain_kb_rules_2026-11-06.json`. Checked against the
public posts:
- KB 4415 / 3206 put the RIVN Kicker at "Bracco, Sunday Scans 2026-02-21". The post is dated 2025-12-21 and the passage
  sits in **TSDR's** section.
- KB 5727 / 6700 call CRCL at $134 "Bracco's". The post (2025-10-05) puts it under the unsigned "Charts Covered", and the
  owner's own desk log of 2025-10-09 (KB 10210) says he is still long CRCL from the $134 Kicker alert.
- KB 6007 calls the ARKK bearish-engulfing stop-out Bracco's. In the 2025-09-14 post it is in the unsigned "Index & ETF"
  section.
- KB 5060 swaps tickers. The 2025-11-16 post reads "AMD long from the hourly push on their analyst day and the kicker
  candle gap up the following day"; the KB has "TWLO" there and moves MDB and TWLO around.
- KB 7004 credits the ASML Kicker note (2025-06-29) to TSDR; in the post it sits under the unsigned "Charts Covered".
- Of the Kicker block's 12 Substack-sourced passages, 10 carry the date 2026-02-21, which is not their post date (no
  UCT post is dated 2026-02-21; the nearest Sunday Scans is 2026-02-22). KB 6007 carries its real date (2025-09-14)
  and KB 7725 has no date.
So treat KB summaries as leads, not quotes, and check the post before teaching a name, date or author.

---

## 6. UCT's own words

**Who wrote what.** Sunday Scans carry signed sections: "Bracco’s Breakdown & Top Ideas" and "TSDR’s Weekly Outlook &
Watchlist". TSDR is the owner: the drawdown ladder that `sizing_rule.md` quotes as his own sits in TSDR's section. The
"Index & ETF" and "Charts Covered" sections are not signed; I label them as such. Dates are the post's publish time in
US Eastern.

### 6.1 The owner's rulings (verdict log, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`)
**On what it is:**
- JBI 2023-12-14: "Yes this is the picture perfect example!!!"
- AMD 2023-12-07: "Yes this is like the ultimate elite example. Another great one is RBRK from just a few weeks ago. But
  yeah this AMD is perfect"
- UAL 2025-08-12 (cut): "Sellers need to be trapped, so there needs to be like an almost failed breakdown vs just a
  little baby red candle. But also needs to be setup properly. Hard to explain, but that is not a good example either"
- ISRG 2025-01-15 (kept as lesser): "Decent but I want a weaker close. This looks like just a regular gap up vs a kicker
  candle gap up"
- RCUS 2026-06-22: "Yes but generally want a bit of a weaker close visually the previous day"
- TSM 2026-01-02 (cut): "Eh more of just a breakout, previous day is strongish and this gap up is more just a breakout
  than a kicker". CVS: "Same, more of just a breakout vs a kicker candle". GWW: "Ya, just a breakout, not a kicker".
- SMH 2026-03-31: "technically it is a gap versus intermediate downtrend instead of a kicker but it is okay ish I would
  say C-"
- GRMN 2024-05-01 (cut): "Yeah no this is not one, this is plainly just an earnings gapper". TSN: "Sometimes earnings
  gappers can be kickers but mostly they are just earnings gappers." Eight more cut as a batch: "kicker is more about
  short term positioning moreso. But sometimes with a catalyst or earnings." and "I want them to be rarely earnings
  though because those are mostly just earnings gappers and not kicker candles".
- VTRS 2024-11-07 (kept): "So yes, good example but these are pretty random stocks and I would classify them more as
  earnings moves vs kicker candles however sometimes they are indistinguishable"
- MSTR 2023-10-23: "Not a kicker, but that is a good launchpad". ACI: "Pass did not advance enough to call it kicker".
  HDB: "Nahhh too messy and sloppy". TH: "Eh not worth having it in there. Not bad but not great." LB: "Not bad but I
  think we can find better ones".

**On the trade (2026-11-02):**
- "In terms of entry, on a kicker you can buy the opening range break (ORB), or the break of previous day high."
- "Should be over previous day high or on day 1 kciker ORB on the 30 minute."
- "The entry is supposed to trigger OVER previous day high not at mkt close!"
- "And for the entry man, the entry should 11.05 over THE previous day high. or on DAY 1 of the kciker candle on a 30
  min ORB" (JBI: the red day's high was 11.04).
- "Under the kicker candle low or entry with a 3.5% stop but we should get these with smaller than 3.5% stop usually"
- "We can work on those sell rules later though because its complivated." The rulebook of 2026-11-09 now supplies them.

**What is NOT his wording** (assistant notes stored beside his words, then copied into app text): the 1-5% body and
"Cap the prior body around 5%" (his JBI red body measured 5.27%); "a 9% red bar before the gap is too dramatic" (his TH
words above say only "Not bad but not great."); "Raise the kicker gap floor to ~3%" (he then called GS, a 1.75% gap,
"very good"); "usually on a volume surge" (in the bank's definition text and the Model Book playbook, not in his verdict
words); "closes above the red day's high and near its own high" (bank, card and playbook wording; his words never state
the Kicker day's close, and UCT's 2025-06-08 definition says only "break previous days high"). These may be right, but
they are proposals until he confirms them.

### 6.2 The owner in public (TSDR's sections and his "TSDR TRADING" notes)
- "Could gap up and put in a kicker candle but I would be a little surprised to see that. (Kicker candle is what ARKK
  did on 6/6)." ([Sunday Scans, 2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2))
- Same post, his 30-minute habit (said of the Go Signal, not the Kicker): "If we see buying activity and opening ranges
  being taken out or strong hourly candles forming after the first 30 min then we can execute on our focus list."
- JOBY: "Gapping up on a headline and partnership with NVDA." and "This is looking primed for a potential kicker candle
  gap up. If it holds this and breaks it opening range tomorrow this is actionable with a stop at LOD."
  ([The Rest of the Week, 2025-10-28](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757))
- "AMD long from the hourly push on their analyst day and the kicker candle gap up the following day."
  ([Sunday Scans, 2025-11-16](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a))
- RIVN: "I got SOME Rivian this week at $18.8 but not nearly what I wanted or should have." and "That gap up kicker
  candle on Thursday was just so prime. Then the hourly flagging and breakout"
  ([Sunday Scans, 2025-12-21](https://unchartedterritoryy.substack.com/p/sunday-scans-34b))
- BABA: "BABA closed weak today and I will only look to enter tomorrow if we get some strong Kicker Candle gap up. or a
  tight buildout near $157." ([The Rest of the Week, 2026-01-06](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0))

### 6.3 The owner's desk logs (paraphrased, not quoted)
These are messages from the paid Discord's #tsdr channel. A summary of them is already tracked in
`docs/study/levels/brain_kb_rules_2026-11-06.json`, but this repo is public and its `CLAUDE.md` says Discord content
must not be copied into it, so I give **paraphrases with the KB number** and no verbatim text. Read the file (or the
Discord) for the wording. None of them was re-checked against Discord; the cold check compared each paraphrase with the
KB text (one corrected: KB 9992).
- KB 10110 (2025-06-06, ARKK): live call that ARKK was over the prior day's high, a full Kicker, actionable on the
  breakout. Same entry as his ruling.
- KB 10111 (2025-06-09, CEP): his sequence for a possible Kicker the next day: gap over a level, break of the opening
  range, then the previous day's high; high premarket and opening volume preferred.
- KB 9992 (2025-01-21, a Tuesday after the Monday holiday, ASAN): a break of Friday's opening high triggering the
  Kicker. Friday was the prior session, so this is a prior-day opening-range level, not the Kicker day's own ORB; which
  bar was the red day is not stated.
- KB 10158 (2025-08-08, BBAI): watching a Kicker over yesterday's high, on a stock under $7 (B23 now rules that out).
- KB 9923 (2024-11-06, RSI): a possible Kicker after an earnings gap and a volatile consolidation; with a Kicker you
  could risk to the short-term daily averages. This predates his 2026-11-02 stop ruling, which wins.
- KB 9953 (2024-12-08): a strong Kicker on volume in a stock he noted trades thinly (B23 and D42 now rule that out).
- KB 11901 (2025-10-15): he would consider a member's Kicker but was unsure because of the 200-day (B26 is now a hard
  rule).
- KB 10236 (2025-11-06, XPEV): a very weak close followed by a large gap up, flagged as a potentially powerful Kicker
  that could start a breakout.
- KB 10303 (2026-02-02, DXYZ, on news): relative volume named as the key thing to watch for a Kicker.
- KB 10177 (2025-09-02): QQQ confirming the prior Friday's bearish Kicker with a gap down into the 50-day.

### 6.4 Bracco (signed sections)
- TEM, his Discord message reproduced in the first Sunday Scans: "Bought this through the opening range highs on
  Friday." "20 EMA shakeout bar on Thursday to weed out the late chasers, then kicker candle potential on Friday’s gap
  up." "Next add spot triggers through $65. Current stop below Friday’s low."
  ([Sunday Scans, 2025-06-08](https://unchartedterritoryy.substack.com/p/sunday-scans))
- TSLA and ARKK: "had its first breakout day on the same day that ARKK put in a bullish kicker candle and broke out of
  its base" ([Sunday Scans, 2025-09-14](https://unchartedterritoryy.substack.com/p/sunday-scans-461))
- The market as a Kicker: "Wednesday we got inside bars across the board with weak closes, which made the gap up on
  Thursday very intriguing as I think most participants were expecting immediate lower prices to follow." and "I viewed
  Thursday’s broad gap up as a potential kicker candle with short term positioning and sentiment caught offsides."
  ([2026-06-14](https://unchartedterritoryy.substack.com/p/sunday-scans-e95))
- "after the kicker candle the Nasdaq put in on Friday following a multi-day pullback into support, it might just go."
  ([2026-06-21](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0))
- (Two quotes this section used to credit to "Bracco’s Market Health Tracker", IWM 2026-05-03 and SPY 2026-06-07, sit
  under the unsigned "Index & ETFs / ETFs Covered" heading; "Bracco’s Market Health Tracker" is only an image caption in
  "Market Breadth Data". They are moved to 6.5.)

### 6.5 Unsigned Sunday Scans sections (Index & ETF; Charts Covered; the June 2025 market update)
- **The definition**, ARKK: "A candlestick pattern that closes the previous day negative, near lows of the day and into
  a support level; in this case the 20 ema. Gap up the following day and break previous days high." Then: "This is a
  specific entry signal, especially within a clean chart pattern." "Also note that the volume of the breakout on Friday
  was the highest since December, 2023." "As long as the bullish open gap from Friday holds, I expect ARKK to push
  toward $68-$70." ([2025-06-08](https://unchartedterritoryy.substack.com/p/sunday-scans))
- "I also stand by that the bullish gap from 6/6 is unlikely to be filled for a very long time-Months at least."
  ([Market update, 2025-06-19](https://unchartedterritoryy.substack.com/p/market-update-and-watchlist))
- ASML: "Kicker candle on Monday, Follow through on Tuesday, and resting for three days now above a 8 month base."
  ([2025-06-29](https://unchartedterritoryy.substack.com/p/sunday-scans-d70))
- "ARKK has not closed below the 9EMA since it’s “KICKER CANDLE” Breakaway Gap on June 6th."
  ([2025-07-13](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6)); "This has been as steady as they come
  since 6/6 Kicker Candle gap up." ([2025-07-27](https://unchartedterritoryy.substack.com/p/sunday-scans-63b))
- NBIS: "Started Monday with a big gap up after a weak close on Friday. This is a classic kicker candle." "Add in the
  undercut of the range and 20EMA this makes for an actionable trade on that gap up. Put this in your playbook!"
  ([2025-07-20](https://unchartedterritoryy.substack.com/p/sunday-scans-c82))
- ARKK again: "The “KICKER CANDLE” a weak close into support followed by a strong gap up and push into new highs and
  breakout territory. And yes, I had a position, also yes, the bearish engulfing stopped me out."
  ([2025-09-14](https://unchartedterritoryy.substack.com/p/sunday-scans-461))
- IGV: "Would love to see this get a really notable kicker candle early in the week. That would make this THE primary
  focus personally." CRCL: "Bought the kicker candle on Thursday at $134. Not a huge fan of the close on Friday but
  nothing to take action on especially with my entry price where it is."
  ([2025-10-05](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef))
- Bearish, on the indexes: "We basically have a wedge drop on the daily here along with a bearish kicker candle from
  Friday." and SMH "Nasty kicker candle Friday and a chart worth paying close attention to this week as a general gauge
  for market health." ([2025-09-01](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1)); "Major lower wick at
  the 50SMA after a nasty bearish kicker candle on Thursday." ([2025-11-09](https://unchartedterritoryy.substack.com/p/sunday-scans-720));
  "Essentially looking for an upside reversal or a big kicker gap up." ([2025-12-14](https://unchartedterritoryy.substack.com/p/sunday-scans-f2f))
- 2026: SMH "Kicker candle off the 20ema with trend in tact and leadership prevalent."; TLN "Friday had an impressive
  remount and kicker candle."; AMD "Nice kicker candle gap up on Friday now just need to turn $225 into support."
  ([2026-01-04](https://unchartedterritoryy.substack.com/p/sunday-scans-153)); DIA "Clean clean kicker candle to new
  highs Friday."; IWM "Thursday sell to crack that level and bring some fear followed by a picture perfect kicker
  candle." ([2026-02-08](https://unchartedterritoryy.substack.com/p/sunday-scans-29e)); AEHR "Didn’t rebuy the kicker
  candle on3/31 or the super oops reversal on 4/2."; MRVL "Another example of the post earnings setups during a
  correction becoming major leaders. That kicker candle is modal book worthy."
  ([2026-04-19](https://unchartedterritoryy.substack.com/p/sunday-scans-33a)); CIFR "Imagine a strong hammer candle or a
  strong kicker candle. That is what I want to see." ([2026-04-26](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d));
  IWM (ETFs Covered) "A very buyable kicker candle on Thursday and closed at new highs on Friday." and YSS "Took a little
  flyer on the kicker candle Thursday after retesting the $30 base."
  ([2026-05-03](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc)); SPY (ETFs Covered) "Bearish kicker
  candle following bull trap attempted reversal on Thursday."
  ([2026-06-07](https://unchartedterritoryy.substack.com/p/sunday-scans-d16)); MRAM "We had a gap up on Thursday just
  around that $29 level which we highlighted in the discord as a potential kicker candle entry."
  ([2026-05-24](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb)); TER "Talked about it on Tuesday with that
  kickerish type candle." ([2026-08-16](https://unchartedterritoryy.substack.com/p/sunday-scans-da5)); CRWV "Simple. Only
  interested on a kicker candle that gaps up and takes out $94" ([2026-08-23](https://unchartedterritoryy.substack.com/p/sunday-scans-807));
  HUT "Looking for a kicker candle back through $100 or oops reversal off $94 area."
  ([2026-09-27](https://unchartedterritoryy.substack.com/p/sunday-scans-09b)); SPCX "Really impressive day on Friday with
  the kicker candle into new range highs." ([2026-10-04](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6))

### 6.6 Other UCT writers (Discord, paraphrased from the knowledge-base summaries)
- Manrav, 2025-01-29 (KB 10927), building on Bracco's scan: add a close under the 21-day EMA on the red day, and a gap
  above the previous day's high, which the summary says works better.
- Manrav, 2025-10-13 (KB 15689), UMC: called a textbook Kicker after a red day that sliced through the 8 and 21-day
  EMAs and a gap back above both; the summary gives the 8/21 EMA as his stop.

### 6.7 What UCT has not written
No public UCT post gives a Kicker trim or trail rule, a minimum gap, a volume floor, or a written short version. The
30-minute ORB appears in his verdict words, not in a public post about Kickers; opening-range entries on a Kicker do
appear publicly, with no window stated (Bracco's TEM, "Bought this through the opening range highs on Friday."; the
owner's JOBY, "If it holds this and breaks it opening range tomorrow this is actionable with a stop at LOD.").

---

## 7. How it fits the account rulebook (section 9)

| Rule | How it applies to the Kicker | Conflict or note |
|---|---|---|
| A3, F62 stop a few cents under the day's low | His stop is the Kicker's low; F62 says a few cents under it. | At entry the Kicker's low is the low **so far**. On a fill at the open it is the opening print. See 8.3 and question 1. |
| A13 stops usually within about 3% | 15 of 16 kept natural stops were within 3%. | His cap is 3.5%, not 3%. Question 7. |
| A4 the stop only moves up | Fine with 8.3: start at the cap, raise it to the 30-minute low once known. | None. |
| A5 one price, one stop, no adding | UCT posts add (Bracco: "Next add spot"; the owner's RIVN hourly flag). | Taught: no adds. Question 11 for a second entry by someone who missed day one. |
| E57 market orders | The buy stop a cent over the red high is a stop-market order (it becomes a market order when hit; my reading of E57); a gap over it fills at the open. | None, if he accepts that reading. |
| C28 no more than 4% past the buy point | VOD opened 4.84% over the red high. | Question 3. |
| C29 not over 10% above the 10-day | The red-high entry is usually close to the 10-day; an ORB after a big gap may not be. | Check on the ORB. |
| B26 no longs under the 200-day (hard) | VOD and LHX red days closed under the 200-day (stored facts). His 2025 desk log hesitated on a Kicker near the 200-day. | Question 9. |
| B23 $10 and $20M a day; D42 1% of volume | JBI traded near $11; PSN averaged $21.0M a day; his 2024 desk note on a thinly traded Kicker (KB 9953). | Apply as a hard gate. |
| C31 RS 80+ | Not stored for any kept example. | Measure before teaching. |
| B22 no buys 3 days before earnings | Separate from the "rarely earnings" rule for the Kicker day itself. | Apply both. |
| B19, E51, E52 trims and trail | Replace the 2R/3R and "higher lows" in TRADE_PLANS and the playbook. | Section 8.4. |
| B20 gap through the stop | A next-day gap-down through the Kicker's low: the first 30-minute low is the new stop; out past 2R. | Covers Bigalow's "gap back" case only when it goes through the stop. |
| C33 time stop | Kickers are meant to go quickly; under 1R after 10 days, sell. | None. |
| D47 shorts are our longs reversed | A bearish Kicker short, below the 200-day only. | Section 8.6; question 14. |
| E54 leveraged ETFs preferred | UCT's flagship public Kicker is ARKK; the bank drafts exclude ETFs. | Question 8. |

---

## 8. Proposed rules for our course

### 8.1 What it is
- **Market:** Green or Yellow reading; Orange only for an A+ (F65). [house rule]
- **Liquidity:** price at least $10 and at least $20 million traded a day (B23); never more than 1% of the average daily
  volume (D42). [house rule]
- **Leader:** RS rating 80 or more (C31); growing sales and earnings preferred (D40). [house rule]
- **Prior trend:** the red day's close is above the 200-day SMA (B26) [house rule; applying it to the red day's close
  rather than the entry price is a reading, question 9], and the 50-day SMA is flat or rising over the last 20 sessions
  (the red day's value at least 99.5% of its value 20 sessions earlier). [UCT: SMH "gap versus intermediate downtrend"
  C-; number from the finders, my proposal]
- **Structure:** a base or an orderly pullback before the red day: the last 20 closes span 15% or less (the finders'
  full-score band; every kept example with the field was at 14.6% or less); no wild, overlapping bars (not yet
  measurable: no house file sets a number for "messy"; the HDB note only suggests comparing bar ranges with the ATR).
  [UCT: HDB "too messy and sloppy"; the 15% from the finders' scoring, where it is a score point, not a requirement; my
  proposal]
- **Location:** the red day ends at support: its close within 1.5 ATR of the 21-day EMA or the 50-day SMA, or at or
  under the lowest low of the prior 5 sessions (plus 1%). [UCT: "into a support level; in this case the 20 ema"; owner:
  "almost failed breakdown"; numbers from the finders, my proposal]
- **The red day:** close below open; a real drop: a body of at least 1% of price **or** a close at least 1% below the
  prior close; close in the lowest 35% of its range; range no more than 3 ATR. [owner words for "real" and "weak"; the
  1% body floor is the pass-3 measurement of his verdicts (an assistant's finding, not his words) and alone would cut
  GS ("very good", body 0.48%, down 1.86% on the day), so the "or" is my proposal; even with it, RCUS ("good", body
  0.78%, up 0.79% on the day) and ISRG (lesser) fail; the 35% also fails RCUS (49%), IMAX (41%) and ISRG (37%), which
  matches his "weaker close" complaints on RCUS and ISRG; the 3 ATR cap is the pass-4 finder's and is not his ruling:
  question 5]
- **Not earnings:** neither the red day nor the Kicker day is an earnings report day (within the bank's 3-day window).
  An earnings-day gap is an earnings gapper. [UCT: his ruling is "rarely earnings" (he kept VTRS and IMAX, both
  earnings days); the outright ban is the bank's drafting rule (`build_next_pass.py`, `draft_pass.py`) and my
  proposal]
- **The Kicker day, at the open:** opens at least 1.5% above the red day's close. [my proposal: the kept minimum was
  1.71%, the finders use 1.5%; he called a 1.75% gap "very good", so no 3% floor]
- **The Kicker day, through the day:** trades above the red day's high (that is the trigger); never trades back down to
  the red day's close (the gap holds); closes above the red day's high, in the top 20% of its range. [the trigger is his
  ruling and UCT's 2025-06-08 definition ("break previous days high"); the close above the red high is the bank and
  Model Book wording, not his words, met by all 16 kept; the gap-hold rule held in 16 of 16 kept, my proposal; top 20%
  from the pass-4 finder (kept range 81% to 100%, so all 16 pass)]
- **Volume:** Kicker-day volume at least 1.5 times the 50-day average (judge it by the run rate before the trigger).
  [UCT: his desk logs name relative volume as the key (KB 10303); Dahlquist and Bauer; floor from the finders, my proposal: question 6]
- **Length and depth:** two daily candles on top of the base; the red day's body typically 1% to 5.5% (kept range 0.07%
  to 5.27%; 1.01% (IMAX) to 5.27% without ISRG, GS and RCUS, section 4.5). [measured on the kept examples]

### 8.2 The buy
- **A. Over the red day's high.** A buy-stop (market) one cent over the red day's high, on the Kicker day only. If it
  opens above that price, it fills at the open. [UCT, his ruling; E57 house rule]
- **B. The 30-minute opening-range break.** A buy-stop one cent over the high of the first 30-minute bar (9:30 to 10:00
  ET) of the Kicker day. [UCT, his ruling; the exact window is question 2; Qullamaggie's first 60-minute candle is the
  same 9:30 to 10:00 window, originator, not Kicker-specific]
- **Chase limit:** if the Kicker opens more than 4% above the red day's high, skip A and use B; if B's fill would be more
  than 4% over its own buy point, skip. [house rule C28; my proposal for the switch]
- **Stretch:** skip if the fill would be more than 10% above the 10-day average. [house rule C29]
- **Never on the close** of the Kicker day: "The entry is supposed to trigger OVER previous day high not at mkt close!"
  The deep-history replay agrees (close entries reached 3R before the stop 21% of the time against 48%). [UCT]
- Plan the entry, stop and size before the open; the stop goes in with the broker. [house rule D39, D41]

### 8.3 The stop
- **The rule:** a few cents under the Kicker day's low, or 3.5% under the entry if that is closer. [UCT, his ruling; F62
  house rule for the cents]
- **At entry, the low means the low so far.** With entry B it is the 30-minute bar's low. With entry A after an open
  below the red high, it is the day's low at the moment of the fill. [my proposal, to make his rule usable live]
- **When A fills at the open** (the stock gapped over the red high), there is no low yet. Start with the stop 3.5%
  under the fill; at 10:00 raise it to a few cents under the 30-minute low if that is higher. [my proposal, mirrors B20's
  30-minute logic; question 1]
- **Size from that stop** (A5); if 3.5% does not fit the risk budget, skip. [house rule A3]
- Expect it to be small: 15 of 16 kept were within 3%. If the honest stop is more than 3.5% away, it is not a clean
  Kicker. [UCT data; owner: "we should get these with smaller than 3.5% stop usually"]

### 8.4 Trims and trail (house defaults; no Kicker-specific rule exists anywhere I found)
- Stop to breakeven between 2R and 5R. [house rule B19]
- Sell a third at 3R, a third at 5R; if it opens above a trim level, trim at the open. [house rule B19, E51, F63]
- Trail the last third under the 10-day average, out on a close below it. [house rule E52; that Kickers count as fast
  movers is my proposal (question 16), supported by UCT's ARKK "has not closed below the 9EMA since" its Kicker]
- Into a parabolic burst, sell a big part (C34). Under 1R after 10 trading days, sell (C33). [house rule]
- Why it matters here: in the unfiltered deep history, three in four trades touched the first stop within 60 sessions,
  and about half reached 3R first (section 4.4).

### 8.5 What invalidates it
- **Before entry:** the Kicker day trades back to the red day's close before it triggers (the gap filled), or it never
  trades over the red high. No trade. [my proposal; gap hold seen in 16 of 16 kept; UCT: "As long as the bullish open
  gap from Friday holds"]
- **After entry:** the stop (8.3). The stop is the exit (A4; his words on 2026-11-09: "my stop is my stop most of the
  time", `sizing_rule.md` section 6). [house rule]
- **Warning, not an exit:** a close back under the red day's high on the Kicker day says the trap did not hold
  (Model Book playbook wording). A gap-down the next day (Bigalow: "liquidate the trade immediately"); a bearish
  engulfing candle (UCT ARKK). These are question 10; under the rulebook they are not exits unless they hit the stop.

### 8.6 The short mirror (bearish Kicker)
- **Status:** the rulebook says shorts are our longs reversed (D47). UCT has used "bearish kicker" only as an index
  caution signal, never as a written short plan, and the owner has not ruled on it. Bulkowski's strict bearish candle
  was also near random (54%). Teach it only if he approves. [house rule D47; UCT; my proposal]
- **Mirror:** below the 200-day SMA (B26) with RS 20 or less (C31 mirror), in a downtrend or a base under a falling
  50-day; a green day with a body of at least 1% (or a 1% gain on the day) that closes in the top 35% of its range into
  resistance, measured as the mirror of 8.1's location (within 1.5 ATR under the 21-day EMA or 50-day SMA, or at or over
  the highest high of the prior 5 sessions less 1%) (an almost-failed breakout); the next day opens at least 1.5% under that close, trades under the green day's low and closes under it,
  in the bottom 20% of its range. Short a cent under the green day's low, or under the 30-minute opening-range low; stop
  a few cents over the Kicker's high, or 3.5% over the entry if closer; trims at 3R and 5R; cover the rest on a close
  over the 10-day. Skip hard-to-borrow names (D48). [my proposal from D47]

### 8.7 Best market conditions
- A Green market, after a few days of weakness that made people bearish: Bracco's June 2026 read ("most participants
  were expecting immediate lower prices"). [UCT]
- The stock pulled into its rising 20/21-day or 50-day, or to its base lows, so the gap is from a low spot, not from an
  extended one. Dahlquist and Bauer found gaps below the 10-day average did better than gaps above it. [UCT;
  measured, small effect]
- Leaders and leading groups; leveraged ETFs and index ETFs if he allows them (question 8). [house rule C31, E54]
- Avoid: an index flashing a bearish Kicker (UCT's own caution signal), the days before a report (B22), Red markets
  (D46). [UCT; house rule]

### 8.8 Common mistakes
1. Calling an earnings-day gap a Kicker (GRMN, TSN and eight more cut). [UCT]
2. A baby red candle or a doji before the gap; that is just a breakout (TSM, CVS, GWW, UAL). [UCT]
3. A red day that closes mid-range; that is "a regular gap up" (ISRG). [UCT]
4. A gap against an intermediate downtrend, or any long under the 200-day (SMH C-; B26). [UCT; house rule]
5. A messy base (HDB). [UCT]
6. Buying the close instead of the trigger ("not at mkt close!"). [UCT]
7. Chasing a big opening gap past 4% (C28). [house rule]
8. Setting the stop on the day's final low, exactly on it, after the fact. [house rule F62; my proposal]
9. Adding on the next push; we buy once (A5). [house rule]
10. Thin or cheap stocks (B23, D42). [house rule]
11. Trusting the app's raw detector: it fires on red, gap-filling days. [my finding, section 5.2]
12. Holding on after the gap fills on the Kicker day itself. [my proposal]

---

## 9. Grading: what makes an A+ versus a B-

The rulebook says grading is discretionary and no checklist is taught as ours (E50). These are the observable traits
that separate his "perfect" Kickers from his "okay" ones, for the lesson to show, not a scoring rule.

**A+ (his "picture perfect", "ultimate elite", "perfect", "great")** Ranges are his eight greats (JBI, AMD, RBRK, HOOD,
PSN, GS, JBTM, BMRN), from the bank files and Yahoo (4.5).
- Already set up: a fresh uptrend or a base, above a rising 50-day (all 7 with the field) and the 200-day (all 7 with
  the field); the 8, 21 and 50-day within 1.6% to 8.1% of each other (AMD, his "ultimate elite", was the widest).
- The red day is a real bar (body 1.26% to 5.27%, except GS at 0.48% with a 1.86% drop on the day) that closes in the
  lower third of its range (3% to 31%; HOOD, BMRN, AMD and PSN in the bottom 10%) at the base lows or the 20/21-day:
  it looks like a breakdown.
- The gap is 1.75% to 5.92%; the Kicker closes in the top 15% of its range (86% to 100%) and usually clears the 20-day
  high (6 of the 7 with the field).
- Volume 1.54x to 6.94x the 50-day average (4 of 8 at 2x or more).
- The natural stop (fill to the Kicker's low) is under 3% on 7 of 8 (0.41% to 2.67%; HOOD 4.16% needed the cap); his
  two top-rated ones, JBI (2.08%) and AMD (2.67%), were both over 2%.
- Not an earnings day; a stock he would trade.
- What does **not** separate his greats from his okays in the kept set: gap size and volume (his five okays: gaps 1.71%
  to 6.63%, volume 1.51x to 3.8x). What does: the context (IMAX an earnings day, SMH a gap against a downtrend, VOD under
  the 200-day), a red day that did not close weak (IMAX 41%, ISRG 37%), and for ENS a small gap (1.71%) with the
  weakest Kicker close of the 16 (81% of its range).
- Sources agree on the direction for bodies and gaps, not as thresholds: "The bigger the body, the stronger" (Bigalow);
  "Select tall candles" (Bulkowski); "larger percentage gaps ... above average volume" (Dahlquist and Bauer).

**B- (his "okay ish", "C-", "lesser")**
- An earnings day that also looks like a Kicker (IMAX).
- A red day closing mid-range (ISRG).
- A gap against an intermediate downtrend (SMH, C-) or a red day under the 200-day (VOD, B-).
- A modest gap or modest follow-through (ENS).

**Not a Kicker** (cut): earnings gappers, baby red candles, plain breakouts, a launchpad, no advance after, a messy base.

**The owner's own ten to model** (8 he called great, 2 good, all non-earnings, though AMD's was an AI-chip news day per
TraderLion; numbers from the bank files, the three marked "Y" from Yahoo's bars):

| Stock, Kicker day | His words | Gap | Red day close in range | Kicker close in range | Volume | Natural stop |
|---|---|---:|---:|---:|---:|---:|
| JBI 2023-12-14 | "picture perfect" | 4.89% | 22% (Y) | 95% | 6.94x | 2.08% |
| AMD 2023-12-07 | "ultimate elite" | 3.39% | 7% | 97% | 2.25x | 2.67% |
| RBRK 2026-09-14 | "Another great one" | 4.04% | 20% | 97% | 1.72x | 1.25% |
| HOOD 2024-05-17 | "Perfect" | 5.92% | 3% | 87% | 3.48x | 3.48% (capped) |
| PSN 2023-07-28 | "This is perfect!" | 2.41% | 10% | 86% | 1.62x | 0.41% |
| GS 2026-05-20 | "very good" | 1.75% | 31% | 99% | 1.54x | 0.48% |
| JBTM 2025-12-10 | "looks great!" | 3.04% | 23% (Y) | 94% | 2.89x | 0.42% |
| BMRN 2023-01-04 | "Great example, love it" | 3.06% | 3% | 100% | 1.81x | 1.38% |
| RCUS 2026-06-22 | "Yes but ... a bit of a weaker close" | 2.39% | 49% (Y) | 98% | 3.07x | 1.21% |
| LHX 2022-02-24 | "Yeah that is good" | 1.72% | 6% | 98% | 1.65x | 1.95% |

LHX's red day closed under the 200-day by the stored facts, which B26 now forbids; 2022-02-24 was also the day Russia
invaded Ukraine, a news day for defence stocks. RCUS's red day closed mid-range (49%) and up 0.79% on the day, which is
what his "weaker close" remark is about; it fails the proposed 35% and real-drop rules in 8.1. If he drops LHX or
RCUS, VTRS (good, but an earnings day) or one of the okay ones would be the next in line, or a new search.

---

## 10. Questions for the owner

1. **The stop when you buy at the open.** Your rule is under the Kicker's low, but at 9:30 there is no low yet. Options:
   (a) 3.5% under the fill, raised to a few cents under the 30-minute low at 10:00; (b) always wait for the 30-minute ORB
   when it gaps over the red high; (c) a few cents under the opening print.
2. **Which 30 minutes?** (a) the first regular 30-minute bar, 9:30 to 10:00 ET (what the workbench drew; also
   Qullamaggie's first 60-minute candle); (b) 9:45 to 10:00 (the in-house template).
3. **A gap of more than 4% over the red high** (C28). (a) skip; (b) use the 30-minute ORB as the buy point; (c) the
   Kicker is an exception to C28.
4. **Must the Kicker open above the red day's open** (Bigalow's rule; the member tag's rule)? Your picture-perfect JBI
   opened inside the red body. (a) no, a grade factor only; (b) yes.
5. **The red day's size.** The 1-5% body and the 9%-bar-too-dramatic notes are an assistant's, not yours. A 1% body
   floor would cut your "very good" GS (0.48% body, but down 1.86% on the day) and your "good" RCUS (0.78%, and up on
   the day). (a) a body of at least 1% **or** a 1% drop on the day, no cap; (b) a body of at least 1% only (GS and RCUS
   become lesser examples); (c) also cap the body near 5% and the range at 2.5 or 3 ATR.
6. **Volume.** (a) a hard floor of 1.5x the 50-day average; (b) a grade factor only; (c) another number.
7. **The 3.5% cap** against A13's "about 3%". (a) keep 3.5% for the Kicker; (b) 3% like the rest.
8. **ETFs.** UCT's canonical Kicker is ARKK; you kept SMH as C-; you prefer leveraged ETFs (E54). The bank's drafting
   code excludes ETFs from Kickers, and I found no ruling of yours that says so. (a) allow index and leveraged ETFs;
   (b) stocks only.
9. **The 200-day.** (a) a Kicker whose gap opens back above the 200-day counts (price is above it at entry); (b) the red
   day must already be above it. And VOD and LHX: keep, relabel, or cut?
10. **Early exits.** (a) none, the stop is the stop; (b) Bigalow's: out if the next day gaps back; (c) UCT's ARKK: out on
    a bearish engulfing candle; (d) out if the Kicker day closes back under the red high.
11. **Second chances.** Is a next-day hourly flag breakout (your RIVN) or a tight pause above the Kicker a new entry for
    someone who missed day one (B21), or not taught?
12. **Headline gaps that are not earnings** (JOBY on an NVDA deal, AMD after its 2025 analyst day, DXYZ, LHX, and your
    own "ultimate elite" AMD 2023-12-07, which TraderLion describes as a reaction to AI-chip news): (a) Kickers if the
    chart fits; (b) news gappers.
13. **The day after an earnings gap** (your 2024 RSI note, "kicker candle after earnings gap up"): allowed if the
    Kicker day itself is not the report?
14. **The short mirror.** (a) teach the bearish Kicker as a short below the 200-day (D47); (b) teach it only as an index
    caution signal, as UCT has used it.
15. **App fixes** for engineering, if you agree: require the Kicker to close above the red high; require a red day with
    a real body; draw the gap in the Model Book glyph; move TRADE_PLANS and the playbook to the rulebook trims.
16. **Trail.** (a) the 10-day for all Kickers (fast movers); (b) the 21-day for steadier, larger names.

---

## 11. Sources

All read on 2026-11-09.

**Outside sources**

| Source | Publisher, author | URL | Reliability note |
|---|---|---|---|
| "Kicking, bullish" | ThePatternSite, Thomas N. Bulkowski | https://www.thepatternsite.com/KickingBull.html | Measured, but a strict candle and a small sample. The live site refuses plain requests; quotes checked on the Internet Archive's October 2026 copy. **Site notice against use to train AI** (and a "noai" robots tag): cited with links and short quotes only. |
| "Kicking, bearish" | ThePatternSite, Thomas N. Bulkowski | https://www.thepatternsite.com/KickingBear.html | Same as above; sample 116 candles. |
| "The Eight Best-Performing Candles", S&C V.29:11 (Nov 2011), pp. 24-26 | Technical Analysis Inc., Thomas N. Bulkowski (PDF hosted by Fidelity) | https://fidelity.com/bin-public/060_www_fidelity_com/documents/EightBestCandles.pdf | His own method description; not the kicking data itself; its reading list dates the *Encyclopedia of Candlestick Charts* (Wiley, 2008). |
| `ta_CDLKICKING.c`, `ta_global.c` | TA-Lib project (Mario Fortier and contributors), BSD licence | https://github.com/TA-Lib/ta-lib/blob/main/src/ta_func/ta_CDLKICKING.c | Exact code; a standard, not a study. |
| "Kicking" | Charles Schwab, thinkorswim Learning Center | https://toslc.thinkorswim.com/center/reference/Patterns/candlestick-patterns-library/bearish-and-bullish/Kicking | Platform definition; no author. |
| "The Most Powerful Candlestick Signal - The Kicker Signal" | TradingMarkets, Stephen W. Bigalow, 27 Mar 2008 | https://tradingmarkets.com/?p=640877 | The main published writer on the loose form (not shown to have coined it); claims, no numbers. |
| "The Kicker Signal - One of the Most Powerful Candlestick Reversal Signals" | CQG blog, Stephen W. Bigalow, 31 May 2023 | https://news.cqg.com/blogs/commentary/2023/05/kicker-signal-one-most-powerful-candlestick-reversal-signals | Same author; claims, no numbers; "T line" undefined there; the Trend Kicker is the nearest outside match. |
| "The Kicker Signal", S&C V.41:06, pp. 32-36 | Technical Analysis Inc., Stephen W. Bigalow, June 2023 | https://store.traders.com/stcov413kisi.html | Abstract only read. |
| "The Candlestick Kicker" (4 Oct 2007) | Working Money (Technical Analysis Inc.), Stephen W. Bigalow | https://premium.working-money.com/wm/display.asp?art=708 | Paywalled; teaser line only. |
| "Push Pull Continues" | The Weeklies Watch (Substack), Oliver Kell, 23 Mar 2023 | https://weeklieswatch.substack.com/p/push-pull-continues | Originator; usage only. |
| "Oliver Kell Interview: The Mind & System Behind a +941.10% Year" | Stockbsessed (Substack), 1 Apr 2023 | https://stockbsessed.substack.com/p/oliver-kell-interview-the-mind-and | Originator's words in an interview; not Kicker-specific. |
| "3 TIMELESS setups that have made me TENS OF MILLIONS!" | qullamaggie.com, Kristjan Kullamägi, 8 Jan 2021 (upd. 28 Apr 2021) | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Originator; entry and stop mechanics (including a 9:30-10:00 first 60-minute candle), not Kickers. |
| "Analyzing Gaps for Profitable Trading Strategies" | MTA 2011 Charles H. Dow Award, Julie R. Dahlquist and Richard J. Bauer Jr. | https://cmtassociation.org/wp-content/uploads/2025/08/2011-dowaward.pdf | Peer-recognised study; gap definition stricter than ours; small effects; tables read from text extraction and re-checked row by row (return minus SPY) in the cold check. |
| Gap-strategies slide deck | CMT Association (presenter not shown in the text) | https://cmtassociation.org/wp-content/uploads/2024/01/0129-scott-1.pdf | Secondary summary of the study above; not used for numbers; names the *Journal of Technical Analysis*, Issue 67. |
| "The Bullish Kicker Pattern" | Amphibian Trading (Substack), "Brandon", 8 Sep 2022 | https://amphibiantrading.substack.com/p/the-bullish-kicker-pattern | Practitioner blog, no full name; read, not relied on. |
| "Bullish kicker" | The Right Trader (byline "The Right Trader", updated 25 Sep 2026) | https://therighttrader.com/learn/candlestick-patterns/bullish-kicker | Unsigned; read, not relied on; its Nison attribution is unverified. |
| "Anatomy Of A Trade: AMD +50% Wedge Pop" | TraderLion, under Oliver Kell's profile, 13 Sep 2024 | https://traderlion.com/profile/oliver-kell/amd-wedge-pop/ | Educator's account of the originator's trade; live page behind a browser check, read on the Internet Archive's copy. |
| "Kicker Pattern" | Investopedia | https://www.investopedia.com/terms/k/kickerpattern.asp | Blocked (HTTP 402 to a plain request in the cold check too); not read. |
| Candlestick pattern dictionary | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary | Read: has no kicking entry. |
| Daily bars for the 16 kept Kickers | Yahoo Finance via `yfinance` 1.2.0 (unadjusted) | n/a | Second price source for section 4.5; the house's own `second_source.py` uses Yahoo too, so it is a cross-check, not a separate vendor for every bar. |

**UCT's public Substack** (https://unchartedterritoryy.substack.com; all 103 posts in its sitemap downloaded and searched
for "kicker"; 29 posts mention it; byline "Uncharted Territory", sections signed as noted in section 6). Posts quoted:
/p/sunday-scans (2025-06-08), /p/market-update-and-watchlist (2025-06-19), /p/sunday-scans-0d2 (2025-06-22),
/p/sunday-scans-d70 (2025-06-29), /p/sunday-scans-6a6 (2025-07-13), /p/sunday-scans-c82 (2025-07-20),
/p/sunday-scans-63b (2025-07-27), /p/sunday-scans-4d1 (2025-09-01), /p/sunday-scans-461 (2025-09-14),
/p/sunday-scans-6ef (2025-10-05), /p/the-rest-of-the-week-757 (2025-10-28), /p/sunday-scans-720 (2025-11-09),
/p/sunday-scans-d6a (2025-11-16), /p/sunday-scans-f2f (2025-12-14), /p/sunday-scans-34b (2025-12-21),
/p/sunday-scans-153 (2026-01-04), /p/the-rest-of-the-week-3f0 (2026-01-06), /p/sunday-scans-29e (2026-02-08),
/p/sunday-scans-33a (2026-04-19), /p/sunday-scans-f2d (2026-04-26), /p/sunday-scans-bcc (2026-05-03),
/p/sunday-scans-ffb (2026-05-24), /p/sunday-scans-d16 (2026-06-07), /p/sunday-scans-e95 (2026-06-14),
/p/sunday-scans-bc0 (2026-06-21), /p/sunday-scans-da5 (2026-08-16), /p/sunday-scans-807 (2026-08-23),
/p/sunday-scans-09b (2026-09-27), /p/sunday-scans-4c6 (2026-10-04). Reliability: UCT's own published words; the
highest authority for "how we trade it" after the owner's rulings.

**House files** (this repository, read 2026-11-09): `docs/study/sizing_rule.md` (section 9);
`docs/study/TRADE_PLANS.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (lines 1-10, 32-40, 61-71, 318-345,
458, 490, 515-516 and the 2026-11-09 rulings); `docs/study/levels/dossiers/kicker.md`;
`docs/study/levels/external_research.md`; `docs/study/levels/evidence_kept.md`; `docs/study/levels/evidence_atlas.md`;
`docs/study/levels/brain_kb_rules_2026-11-06.json` (desk logs and summaries; see the warnings in 5.7);
`docs/study/bank/levels.kicker.json`; `docs/study/bank/spot.setups.json`; `docs/study/bank/family.fixtures.json`;
`docs/study/setups/setup_examples.json`; `docs/study/UNITS-method.md`; `docs/study/OWNER_PRINCIPLES.md`;
`api/services/pattern_engine/detectors/uct/uct_kicker.py`; `.../uct/uct_setups_common.py`;
`api/services/pattern_engine/primitives/liquidity.py`; `api/services/setup_tags.py`;
`api/services/pattern_engine/tag_textbook.py`; `api/services/study_trade.py`; `api/services/study_hard.py`;
`api/routers/patterns.py`; `api/services/chart_iq/engine/v2_setups.py`, `v44_read.py`, `markup.py`;
`scripts/study/find_kicker_examples.py`; `scripts/study/find_pass3_examples.py`; `scripts/study/find_pass4_examples.py`;
`scripts/study/bank_v2/scan_history.py`, `choose.py`, `draft_pass.py`; `docs/study/audits/2026-11-05/build_next_pass.py`;
`docs/study/levels/measure_rules.py`; `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`, `SetupsView.jsx`;
`app/src/constants/setupGroups.js`.

**Limits of this dossier.** Searched in the cold check and found nothing on kickers: investors.com, StockCharts
ChartSchool, Minervini, Raschke, Qullamaggie (section 3.9); MarketSmith itself was not searched. Academic tests of
"kicking" were searched but no paper's text was reached. Nison's and Morris's books were not opened, so the pattern's
first English description and Japanese name are still open. The KB desk-log quotes are as stored in the repo file, not
re-read in Discord.

**Removed in checking** (2026-11-09, cold check; each was wrong or could not be confirmed):
1. "One candle site (The Right Trader) credits Nison only with bringing candlesticks to the West, not with this
   pattern" and the claim that `external_research.md` "overstates it": the page does say Nison described kicking.
   Replaced in section 2.
2. "Bigalow made the looser 'Kicker Signal' famous" and "originator of the 'Kicker Signal' name": no source shows who
   coined the name or measures fame. Rephrased in sections 1, 2, 3.4 and 11.
3. Bulkowski "page data 'As of 11/06/2026'": that banner dates the page's index quotes, not the candle statistics.
4. "No source I found names a 30-minute window": Qullamaggie's page does (his first 60-minute candle, 9:30-10:00).
5. "I did not read the book, so I cannot confirm the kicking numbers came from that same database": the bearish page
   counts its 116 candles against the same "over 4.7 million candle lines"; restated in 4.1.
6. "TraderLion's ... was blocked to me" and "TraderLion (only its Oops Reversal article)": the Kell AMD write-up was read
   through the Internet Archive and is now quoted in 3.5.
7. "A search listing places it in the Journal of Technical Analysis, Issue 67; I did not open that page": now sourced to
   the CMT Association's own slide deck.
8. "Bracco's Market Health Tracker section" for the IWM (2026-05-03) and SPY (2026-06-07) quotes: both sit under the
   unsigned "ETFs Covered"; moved to 6.5.
9. "Every Substack passage in that file carries the same date, 2026-02-21": 10 of the Kicker block's 12 do; KB 6007 has
   its real date and KB 7725 none.
10. "The 16 kept charts were chosen to work (the finder demanded the low never broke within 20 sessions)": true only
    of the 6 pass-4 charts; corrected in 4.4.
11. "Red day body (12 with a stored value): 1.26% (JBTM) to 5.27% (JBI)": 7 were stored and 5 came from a log note;
    the full 16 run from 0.07% to 5.27%, with GS (great) at 0.48%. Corrected in 4.5.
12. In 8.1, the tags "measured floors from his pass-3 finding" (an assistant's finding, not his) and "[UCT, his ruling]"
    on an outright earnings ban (his ruling is "rarely earnings"); the close above the red high tagged "owner
    definition" (it is bank and Model Book wording); "a base ... of at least 10 sessions" (no source for the 10).
13. In section 9, the A+ traits "about 1.5% to 5% body", "closes at its low (bottom 10%)", "about 2% to 6%" gap, "top
    10%" close, "Volume at least 2 times average", "natural stop is under 2%" and "averages bunched": each was
    contradicted by one or more of his own greats; replaced with the measured ranges.
14. In 5.2, "He cut ISRG" (he kept it as a lesser example) and "cut ... to C-" for SMH (kept as C-).
15. In 5.3, v2_setups "open at least 1% over it" (the 21 EMA): the code measures the open against the prior close.
16. In 3.10, UCT 2025-06-08 "record volume" (the post says the highest since December 2023) and the owner's location
    "bunched averages (JBI)" (an assistant's note, not his words).
17. Section 6.3, KB 9992 "(an opening-range entry)": the level was the prior session's opening high.
18. "I did not re-check them against a second data source" (4.5) and the old limits line saying IBD, Minervini, Raschke,
    StockCharts and academic tests "were not searched": both now done.
19. In 8.5, the quote "my stop is my stop": it cut his sentence short; his words are "my stop is my stop most of the
    time" (2026-11-09). Restored with its source.

**Corrected in the third pass (2026-11-09; nothing removed):**
20. In 8.1 "Length and depth", the kept red-day body range without ISRG, GS and RCUS read "1.26% to 5.27%"; IMAX's
    body is 1.01%, so the floor is 1.01% (IMAX), not 1.26% (JBTM). The 1.26% figure is right only for his eight greats
    (section 9).
21. In 3.9, Amphibian Trading's EQT example was paraphrased as "drifted to the 21 EMA and 50 SMA"; the page's words are
    a cup with handle whose handle "drifted down on light volume towards the 21ema and 50sma", and its stop is "a stop
    loss at the previous days close". Replaced with the page's wording.
22. In 5.6, `OWNER_PRINCIPLES.md` rule 8 was said to carry his words "correctly"; it quotes them with his typo "kciker"
    silently corrected to "kicker". Noted, since the file presents the text in quotation marks.

**Added in checking:** Bulkowski's third tip and bearish sample size; Bigalow's inconsistent entry line (2008) and his
Trend Kicker, 50-day and chasing lines (2023); Kell's NFLX context; the TraderLion Kell AMD entries (AMD 2023-12-07 was
an AI-chip news day); Qullamaggie's 9:30-10:00 window; the detector's confidence floor (it never removes a Kicker);
the pass-2 and pass-4 finders' liquidity and forward rules; the deep scan's missing earnings filter and survivor-only
"+20 sessions"; the META fixture's bad bars; KB 7004's mis-credit; public opening-range Kicker entries (TEM, JOBY);
the second-source facts on all 16 kept (red-day close position, body, drop, volume; JBI's 24-million-share red day;
none passes TA-Lib); question 5's GS and RCUS conflict.

---

## 12. Examples (from our data)

Scanned 2026-11-09 on the local sandbox's daily bars (3,897 names, 1984 to 2026); the scan covered all 2,630 names that
ever met the house liquidity rule (complete, 163 seconds; a first pass without the full B22 window, 669 hits, is kept as
`final/hits_v1_no_b22.json`). Scripts and every hit: `_study-resume/scratchpad/setups/26-kicker/` (`kicker_scan.py`,
`final_kicker.py`, `final_stats.py`, `final/hits.json`, `final/examples.json`); charts in `final/` (10 PNGs and three
phone sheets `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`; the candidates looked at and not used are in
`final/cands/`). Nothing here is from a book or a web page except the two earnings dates named below; it is our own
replay of the section 8 rules.

**The rule as coded (section 8 plus the house rules).** Red day: close below open; body at least 1% of price *or* a
close at least 1% under the prior close; close in the lowest 35% of its range; range at most 3 ATR(14); close above the
200-day SMA; 50-day SMA at least 99.5% of its value 20 sessions earlier; the last 20 closes span 15% or less; the close
within 1.5 ATR of the 21-day EMA or the 50-day SMA, or at or under the lowest low of the prior 5 sessions (plus 1%);
close at least $10 and 50-day dollar volume at least $20 million. Kicker day: opens at least 1.5% above the red close;
trades above the red high; never trades back down to the red close; closes above the red high in the top 20% of its
range; volume at least 1.5 times the 50-day average. Earnings (B22, the sandbox's Yahoo + SEC dates): neither day is a
report reaction day, and no reaction day falls in the next 4 sessions (a report after the close of day X reacts on X+1,
so this is "no new buys in the 3 days before a report"). Entry (E57, market): one cent over the red high if the open is
at or under it, else the open; skipped if that fill is more than 4% over the red high (C28; those would need the
30-minute entry, which daily bars cannot test) or more than 10% over the 10-day SMA (C29). Stop: a fill at the open has
no low yet, so the rule's own first stop, 3.5% under the fill; a trigger during the day gets 5 cents under the Kicker
day's low or 3.5% under the entry, whichever is closer (that uses the day's *final* low, which a live trader does not
know; flagged). Outcome: fixed stop, no trims, no breakeven, 60 sessions forward, first touch of the stop, 3R or 5R
wins (same day: stop first).

**Not applied (the data cannot):** RS 80+ (C31; the sandbox has no RS rating), the market reading (F65, D46), position
size, the 30-minute-bar stop raise at 10:00 (8.3), and the B20 gap rule. The earnings dates are complete only from about
2005, so 128 of the 530 stock hits (every hit before 2005, plus names with no dates) could not be checked for a report,
and one of them was one: CSCO 1999-11-10, which the first pass had in the table, is Cisco's Q1 fiscal 2000 report
reaction (the release is dated November 9, 1999, after the close: Cisco newsroom,
https://newsroom.cisco.com/c/r/newsroom/en/us/a/y1999/m11/cisco-systems-reports-first-quarter-earnings-11-09-1999-.html).
Treat every pre-2005 hit as unchecked unless its date was verified by hand, as MS 1997 was (below).

**Base rate.** 622 hits in 2,630 names; 48.2% reached 3R and 32.5% reached 5R before the first stop; 77.8% touched the
stop within 60 sessions (most after a win: the median hit reached 3R in 3 sessions). Stocks only (530 hits; 92 were
ETFs, ARKK, GDX, QQQ, SMH, XOP and the spot-bitcoin funds among them): 48.1% to 3R, 32.8% to 5R. By entry type: fill at
the open with the 3.5% stop (237) 40.1% / 24.1%; trigger during the day (293) 54.6% / 39.9%. The in-day group is
flattered by the final-low stop: the 58 stock hits with a stop under 1% reached 3R 86% of the time, the 472 with a stop
of 1% or more 43.4% / 27.3%. Names whose era the earnings dates cover (402) 48.5% / 32.6%; the unchecked 128, 46.9% /
33.6%. Since 2010 (379): 47.5% / 33.0%, the same as the whole. Medians: gap 2.4%, Kicker-day gain 5.8%, volume 1.9x,
stop 3.5% (the cap). Read all of it as a fixed-stop, no-trim, no-RS, no-market-filter number; the 2R-breakeven and
3R/5R trims of the rulebook would change it.

**What moved the number (observations, not rules; stocks only).** The Kicker day's size: a close of +8% or more on the
day (130) reached 3R 72% and 5R 53% of the time, with 4% stopped under 0.5R; under +8% (400), 40% / 26%, 20% stopped
under 0.5R. Volume: 2x or more (213) 55% / 38%; 1.5x to 2x (317) 43% / 30%. The red day's size cuts the other way: a
red day down 5% or more (34) 38% / 24% with 29% stopped under 0.5R, against 12% to 16% for smaller red days, which
supports the owner's "orderly pullback" over a shock bar (the 3 ATR cap does not catch a shock day, because the ATR
inflates with it). The market: the 40 hits in the shock months (August 2011, October 2018, March 2020, October 2025)
reached 3R 15% of the time and half were stopped under 0.5R (D46 in numbers).

**The 10 textbook examples** (one per ticker, ten different years; each chart was looked at; the red day is down on
the day in all ten; no ETFs; every stop is at least 1%, so none leans on a final-low stop). Columns: red day = change
on the day / body / close position in its range; Kicker day = gap over the red close / change on the day / close
position / volume vs 50-day; span = range of the prior 20 closes. Earnings: all nine from 2003 on are 12 or more
sessions after a report and 19 or more before the next (sandbox dates); MS 1997 is four sessions after Morgan Stanley
Dean Witter's June 25, 1997 second-quarter release (the press release in its SEC 8-K,
https://www.sec.gov/Archives/edgar/data/0000895421/000095013097002909/0000950130-97-002909.txt/seq-2).

| # | Ticker | Kicker day | Red day | Kicker day | Span | Buy (how) | Stop | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|
| 1 | MS | 1997-07-01 | -1.3% / -1.9% / 0% | +1.6% / +4.3% / 100% / 1.9x | 11.0% | 22.17 (red high +0.01) | 21.76 (1.8%) | 16.8R, 3R in 2d | Pullback to a rising 21-day EMA, the red day closes on its low at the 5-day low, the Kicker opens over it and closes on its high; the stock never looks back. |
| 2 | UNH | 2003-11-19 | -1.5% / -1.6% / 10% | +1.6% / +5.0% / 91% / 1.9x | 13.0% | 25.02 (red high +0.01) | 24.70 (1.3%) | 17.2R, 3R in 3d | The "almost failed breakdown": the red day undercuts the base lows and the 50-day, the Kicker gaps back above both; the trap holds and the base resolves up. |
| 3 | AXON | 2004-11-04 | -1.1% / -3.7% / 28% | +2.5% / +13.2% / 97% / 2.4x | 14.5% | 21.44 (red high +0.01) | 20.70 (3.5%) | 16.2R, 3R in 1d | Tight 6-week shelf over the 21-day EMA; a real red body, then a 13% Kicker on 2.4x volume that closes near its high; 3R the next day. |
| 4 | BBY | 2013-07-01 | -1.8% / -1.3% / 2% | +2.1% / +8.8% / 92% / 1.9x | 6.2% | 27.97 (red high +0.01) | 27.67 (1.1%) | 37.7R, 3R in 1d | A 6% tight range into the 21-day EMA and the 50-day, red day closes at its low, Kicker closes near its high; the cleanest "two candles on a base" of the set. |
| 5 | SWKS | 2014-06-03 | -0.6% / -1.9% / 9% | +3.7% / +6.0% / 85% / 2.3x | 6.4% | 44.79 (red high +0.01) | 44.20 (1.3%) | 19.1R, 3R in 1d | A flat 6-week base on a rising 50-day; the red day is small on the day (-0.6%) but a full red body closing near its low; the Kicker breaks the base. |
| 6 | BOOT | 2020-12-28 | -0.8% / -1.8% / 24% | +1.6% / +7.0% / 86% / 1.6x | 9.7% | 41.42 (red high +0.01) | 40.67 (1.8%) | 37.0R, 3R in 1d | A 4-week flat shelf under $44; the red day leans on the 21-day EMA; the Kicker opens over the red close and takes the red high; the stock runs 40% in six weeks. |
| 7 | BEN | 2021-03-10 | -1.6% / -1.7% / 2% | +2.6% / +9.8% / 93% / 2.5x | 8.8% | 26.90 (red high +0.01) | 26.51 (1.4%) | 22.8R, 3R in 1d | A pullback that closes right on the 50-day SMA on its low; the Kicker gaps 2.6% and closes +9.8% on 2.5x volume. |
| 8 | AMD | 2023-12-07 | -1.3% / -3.3% / 7% | +3.4% / +9.9% / 97% / 2.2x | 8.4% | 122.84 (red high +0.01) | 119.51 (2.7%) | 27.6R, 3R in 2d | A 3-week flag on the 10-day EMA after the November run; the red day closes near its low at the 5-day low, the Kicker gaps 3.4%, takes the red high and closes at its high (the chart the owner's kept examples look like); a news gap, 25 sessions after the report. |
| 9 | COHR | 2024-01-16 | -1.8% / -2.4% / 19% | +2.6% / +8.2% / 81% / 2.0x | 10.6% | 42.83 (open, 0.2% over the red high) | 41.33 (3.5%) | 16.7R, 3R in 4d | A 6-week shelf on the 21-day EMA after the November run; the Kicker opens just over the red high (fill at the open, 3.5% stop) and closes +8.2% on 2x volume; the base turns into a 50% run. |
| 10 | ATRO | 2026-06-11 | -2.7% / -2.5% / 13% | +3.0% / +15.1% / 99% / 2.5x | 10.9% | 68.80 (red high +0.01) | 67.36 (2.1%) | 13.8R, 3R in 1d | Red day into the 21-day EMA and the 50-day; a 15% Kicker on 2.5x volume closing on its high; 13.8R in two weeks, then it gave most of it back and hit the stop inside 60 sessions: the case for the 3R/5R trims and the 10-day trail. |

Not used on purpose: CSCO 1999-11-10 (the report day, above), SMTC 2024-03-26 (a 29R replay, but its report came two
sessions after the Kicker, reaction day 2024-04-01: B22 forbids the buy; the second pass drops it), FORM 2025-10-29
(ran up 12.5% into its own report after the close; dropped by the second pass), APP 2024-09-11 (a famous Kicker and a
253R replay, but the red day was only -0.09% on the day and the 1.4% stop sits on the day's final low; shown to the
owner as an extra if he wants it), TSLA 2020-11-18 (the red day was a +8% gap-up that faded, so not a pullback red
day), GFI 2005-11-16 (red body 6.8%, outside the typical 1% to 5.5%), HOG 2010-05-10 (a topping pattern, messy), NEM
2005-11-16 and RCL 2010-02-24 (textbook structure, but their 0.4% and 0.8% stops sit on the day's final low, so the
115R and 58R are not honest), and every ETF.

**Notable failures (from the same scan):**
- **AVGO and TSM, both 2025-10-13: a shock-day reversal.** The red day (2025-10-10) fell 5.9% and 6.4%; AVGO opened
  8.7% above the red close (1% over the red high, a fill at the open with the 3.5% stop) and closed +9.9% on 2x
  volume, TSM +7.9% on 1.8x. Both had the next day's low under the stop: 0R. A giant red bar from a one-day market
  shock is not an orderly pullback, and the 3 ATR cap did not catch it.
- **LLY 2020-03-13, EFX and SBAC 2020-03-10, MA 2011-08-09, CSCO and MA 2018-10-12: bounce days in a breaking
  market.** Red days of -7% to -10.6% in the 2020 and 2011 cases, then a textbook-looking Kicker (LLY +10.6% on a 5.5%
  gap) that was stopped at 0R; the two October 2018 names made 0.7R and 1.1R and were stopped within weeks. Under the
  rulebook none is a trade in a Red market (D46); the pattern alone is not enough.
- **GOOGL 2020-02-03 and AVGO 2024-03-07: the report after the Kicker's own close.** The first pass let them through
  (its earnings test only excluded a reaction on the red day or the Kicker day); both gapped down the next morning to
  0R. The second pass excludes any reaction day in the next 4 sessions (B22), which also removed SMTC and FORM above;
  it cut the hit count from 669 to 622 and left the base rate where it was (48.0% to 48.2% at 3R).

## 13. Failures and near-misses (from our data)

Added 2026-11-10 from the section 12 scan (`kicker_scan.py`, `final/hits.json`) and a one-gate-relaxed copy
(`near_scan.py`, `final/near_hits.json`: any down day followed by an up day that closes over its high in the top 20% of
the range on 1.5x volume, with every gate recorded; kept when exactly one gate fails). Charts in
`_study-resume/scratchpad/setups/26-kicker/final/`: `fail_1..4_*.png` and `fail_1-4.png`, `near_1..4_*.png` and
`near_1-4.png`, and the confusable pair `pair_21-power-earnings-gap.png` (BBY above LOGI, the tell from the card). Buy
= one cent over the red high, or the open if it opened above it; stop = 3.5% under an open fill, else 5 cents under the
Kicker day's low or 3.5%, whichever is closer; "where it stopped" counts sessions after the Kicker day.

**Failures: valid by every gate the scan tests, stopped before 3R.** AVGO and LLY are the dossier's own named failures
(section 12); the scan does not read the market or the red day's size against the pullback, so both pass its gates.

| # | Ticker | Kicker day | Buy | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | AVGO | 2025-10-13 | 352.77 (fill at the open, 0.6% over the red high 350.60) | 340.42 (3.5%) | the next session (2025-10-14, low 339.65), 0.0R | The red day (10-10) fell 5.9% with a 6.4% body and closed at 2% of its range; the Kicker gapped 8.7% and closed +9.9% on 2.0x. The next day gave it all back. A shock-day red bar is not an orderly pullback, and the 3 ATR cap did not catch it. The stock later made 414.61 (12-10). | kk.structure |
| 2 | LLY | 2020-03-13 | 136.51 | 131.73 (3.5%) | the next session (2020-03-16, low 128.25), 0.0R | A -10.0% red day closing at 1% of its range, then a 5.5% gap and a +10.6% close on its high (1.6x). Monday opened under the stop; 143.20 the day after, then 117.06 on 03-23. A bounce in the March 2020 crash: no trade in a Red market (D46). | kk.market_reading |
| 3 | CDNS | 2021-12-02 | 181.81 | 177.50 (2.4%) | the next session (2021-12-03, low 175.34), 0.0R | A textbook picture: an 8.1% base, a red day closing on its low, a 1.7% gap and a +5.5% close at 87% of the range on 1.6x. The next day fell to 177.87 through the stop. The Kicker's whole gain was given back in one day; the stock made 192.70 on 12-28 and 133.10 by 02-22. | kk.after_entry_stop |
| 4 | PGR | 2023-03-16 | 141.14 | 137.35 (2.7%) | the next session (2023-03-17, low 135.86), 0.0R | A -4.8% red day at the base lows, a 2.7% gap and a +5.8% close on 2.0x. Day 2 opened 142.16 and closed 136.32, under the red high: the warning the card names, and the stop traded the same day. | kk.close_under_red_high_warning |

**Near-misses: look like a Kicker, fail exactly one gate.**

| # | Ticker | Day | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | LUV | 2026-01-29 | kk.not_earnings | the gap day is the earnings reaction day (report 2026-01-28, after the close). The shape passes: red day -1.2% (body 2.5%, close 13%), gap 6.2%, +18.7% on 3.8x, an 8.2% base. | An earnings gapper: a Power Earnings Gap (setup 21), graded there. It ran 7.7R, which is the PEG's result, not the Kicker's. |
| 2 | CEG | 2024-06-10 | kk.gap_open | opened 0.8% over the red close; the rule needs 1.5% or more. Red day -2.3% (body 2.1%, close 7%), +8.4% on 2.0x. | A plain breakout day with no gap: a strong green bar, not a Kicker. |
| 3 | GWW | 2024-10-11 | kk.red_day_size | the red body is 0.04% of price and the drop 0.4%; the rule needs 1%. Gap 2.2%, +5.8% on 2.5x out of a 4.8% base. | A baby red candle before a breakout (kk.red_day_red); nobody was trapped, so there is no kick. |
| 4 | IDCC | 2011-08-03 | kk.structure | the prior 20 closes span 44.1%; the rule needs 15% or less. Red day -5.8% (close 1%), gap 5.7%, +13.8% on 2.7x. | No base: a stock mid-run after a 60% burst. Taken anyway: stopped the next session at 0.0R. |

**What the failures have in common.** All four traded the stop on the very next session with no gain: the Kicker day's
gain was given back in one day. In three of the four the red day was large (-4.8%, -5.9%, -10.0%) and in two the whole
tape was breaking (October 2025, March 2020), which is the dossier's own reading: a shock bar is not an orderly
pullback, and the pattern alone is not enough in a Red market. The two fills at the 3.5% cap (AVGO, LLY) were the widest
stops and still failed; the two tighter ones (CDNS, PGR) failed on day-2 closes back under the red high, the warning the
card names.
