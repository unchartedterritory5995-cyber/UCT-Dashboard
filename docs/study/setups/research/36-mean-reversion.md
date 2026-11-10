# Setup 36: Mean Reversion (long and short)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote was
copied from the page, post, PDF or file named next to it and then checked word for word, by script, against a saved copy
of that source, except the few marked "read through WebFetch" (those sites block plain downloads, so I could not save a
copy; the wording is as the fetch tool returned it). Two small exceptions to the script check, verified by hand: the
Jegadeesh abstract uses a Unicode hyphen and an en dash that I typed as plain hyphens, and the backtest template's
description is one Python string split over two lines. Quotes keep the writer's own spelling and are 40 words or fewer.
Where I could not read a source, I say so and give no wording from it.

**Cold check, 2026-11-09.** A second reader re-fetched every source named below (all 103 Substack posts through the public
post API, the nine Alvarez posts through the site's API, the Raschke PDFs, the Kell archive copies, the NBER, Crossref,
French and StockCharts pages, the Bollinger rules, the TradingView script page, the Yahoo copy of the IBD article, the
Bulkowski pages through WebFetch), re-ran the quote match (the draft's 314 quoted spans; every one found, the two Unicode-hyphen
cases above included), re-mapped each Substack quote to its section header, re-derived the French period table from
the downloaded file (every number agrees), re-read the detector and app code named in section 5, and compared the
measurement script with its log (every number in the section 4.4 table agrees). What changed is listed in section 12.

**What this setup is in our app today.** "Mean Reversion L/S" is a journal tag only (`setupGroups.js`, in the
"Intraday" group). There is no Model Book card, no detector named for it, no trade plan, and no Study unit
(`docs/study/UNITS-method.md` lists it among names with "no unit; owner may add later"). The owner has used the term once
in the rulebook: C31 exempts "parabolic or mean reversion" trades from the RS 80 rule.

**Related dossiers.** Mean reversion is a family, not one chart shape. Several members have their own dossier in this
series: 34 Capitulation (the flush low; the app's `uct_capitulation` detector), 39 Parabolic Short and 38 Parabolic Long
(Bracco's post; see dossier 18, Part A, for Kullamägi's version), 18 Part B (Kell's Reversal and Exhaustion Extensions),
29 Undercut and Rally and 13 MA Reclaim (the "MAU&R" that Bracco calls a rubber band long), 30 Oops Reversal and 28 2B
(failed-low turns). This dossier covers the family as a whole: what makes a trade "mean reversion", how UCT uses the word,
how it differs from the parabolic setups, and the swing rules that would turn the journal tag into a teachable setup.
Where it overlaps a sibling, the owner should rule once for both.

**Who is who in UCT quotes.** The owner is Patrick (TSDR). He writes "TSDR's Weekly Outlook & Watchlist" (from
2026-11-01, "Patrick (TSDR)'s Weekly Outlook & Watchlist") and the "TSDR Trading" sections. Bracco writes "Bracco's
Breakdown & Top Ideas" and "The Parabolic Short". The intros, "Index & ETF" sections and "Thoughts on the Market" are not
signed; I mark them "unsigned". Contributors (Manrav, ChartMaster, Jersace and others) sign their own sections in "The
Rest of the Week". Section authorship was checked by script: each quote was located in the post and matched to the
nearest section header above it. Dates are the Substack post dates (UTC). "The Rest of the Week" posts go out in the US
evening, so their UTC date is the day after the trading day they describe. A few quotes come from the brain KB extracts
already in this repo (`docs/study/levels/brain_kb_*.json`); they are cited by KB id. Those rows are mostly summaries; I
quote only the parts the file marks as the trader's own words and paraphrase the rest, saying so.

**Tags used in section 8.** **[source consensus]** several outside sources agree; **[originator]** the named trader's
own words; **[UCT]** the owner, Bracco or a signed UCT contributor; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

**Limits of this research.** I did not read any book. Connors and Alvarez's *Short Term Trading Strategies That Work*
(2008) is known to me only through StockCharts and through Alvarez's own blog. Raschke is read from interviews she posts
on her own site, not from *Street Smarts*. Kell is read from his TraderLion articles (archived copies; TraderLion's live
pages refuse automated reads). Lance Breitstein's own words were not available in text (the Chat With Traders page has
show notes only), so his "Right Side of the V" is given as Bracco describes it. Investor's Business Daily, Bulkowski and
TradingView pages were read through WebFetch only. My own measurement (section 4.4) uses the local sandbox bar database,
which holds today's listed tickers only, so it has survivorship bias.

---

## 1. What it is

**In two sentences.** A mean-reversion trade bets that a price that has moved unusually far from its own average in a
short time will snap part of the way back toward that average. The long buys a sharp, stretched drop (an oversold
snapback); the short sells a sharp, stretched rise; both aim at the average (the 5, 9, 10 or 20-day) rather than at a new
trend.

**How it differs from our other setups.** Almost every other UCT setup is a trend trade: buy strength out of a base, hold
for a trend, trim at 3R and 5R, trail the 10 or 21-day. Mean reversion goes against the short-term move, targets the
average, and lasts days, not weeks. Bracco: "These are short lived trades and not meant to be held longer than 1-3 days."
([Sunday Scans, 2025-10-19](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc))

**How it differs from the parabolic setups.** In UCT's own words the parabolic short is one kind of mean-reversion trade:
"There are various types of mean reversion trades, but today I’m focusing on my 5-star Parabolic Short setup and how to
trade it effectively." (Bracco, [The Parabolic Short, 2025-06-13](https://unchartedterritoryy.substack.com/p/the-parabolic-short))
The differences, as the sources draw them:

| | Parabolic short (and long) | Mean reversion in general |
|---|---|---|
| What must happen first | A "parabolic burst": a 3-5 day final leg with straight up days, gaps, range and volume expansion (Bracco); a stock up 50-100%+ (large cap) or 300-1000%+ (small cap) in days or weeks (Kullamägi) | Any unusual stretch from an average, measured in ATRs, percent, an oscillator (RSI(2)) or a band; no burst required |
| Shape | Exponential, accelerating curve; Bracco separates it from a "linear" curve of "steady, consistent price movement over time" | Any shape; often a pullback inside an uptrend (Connors) or a fast drop in a leader (Bracco) |
| Frequency | "You’re lucky to get a couple 5-star candidates a year." (Bracco) | Common: thousands of signals a year in a broad universe (section 4.4) |
| Target | The 9-day EMA (Bracco); the 10 and 20-day (Kullamägi) | The 5-day SMA (Connors), the 20 EMA (Kell), the mean the stretch was measured from |
| House rule B26 | The named exception: parabolic longs below the 200-day, parabolic shorts above it | No exception: a mean-reversion long must be above the 200-day and a short below it, unless it is also a parabolic |

So every parabolic trade is a mean-reversion trade, but most mean-reversion trades are not parabolic. That line matters
for the house rules (section 7).

**The market psychology.** These points are reasoning drawn from the sources, not measured facts unless marked.
- **The rubber band.** Kullamägi: "Think of stocks as rubber bands, if they get really stretched short term, they can
  have powerful snapbacks." ([qullamaggie.com, 2021](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/))
  Bracco, the same image: "Picture a rubber band: the more you stretch it, the harder it snaps back." (2025-06-13)
- **Who is selling at the low.** Forced and frightened sellers. Kell: "Heavy volume at the lows indicates fear has set
  in, and traders are capitulating their positions." ([TraderLion, 2024-06-11, archived](https://web.archive.org/web/20250820211726/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/))
  Late breakout buyers are flushed: of SNDK, Bracco wrote "Shook out any late breakout chasers from Monday/Tuesday."
  ([Sunday Scans, 2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1))
- **Who is trapped after the low.** Late shorts. Bracco on the rare-earth names after a 40-50% fall: "they can often see
  vicious rallies back up off the lows and shorts cover up and dip buyers step in." (2025-10-19)
- **Who is paid for buying.** The academic reading: the mean-reversion buyer supplies liquidity to people who must sell
  now, and is paid most when few others will. Nagel: "The returns of short-term reversal strategies in equity markets can
  be interpreted as a proxy for the returns from liquidity provision." ([NBER w17653, 2011](https://www.nber.org/papers/w17653))
  This is measured (section 4.1), and it fits Bracco's habit of waiting for a VIX spike.
- **Overreaction.** De Bondt and Thaler tested whether people "overreact" to dramatic news and found the evidence
  "consistent with the overreaction hypothesis" (Journal of Finance, 1985). Theirs is a multi-year effect, not a swing
  trade; I cite it for the idea, not the holding period.
- **Why it can fail.** A trend can keep going. John Bollinger: "Closes outside the Bollinger Bands are initially
  continuation signals, not reversal signals." ([bollingerbands.com](https://www.bollingerbands.com/bollinger-band-rules))
  StockCharts on RSI(2): "the RSI(2) strategy can be early because the existing moves often continue after the signal."

---

## 2. Origin and naming

- **No single originator.** "Mean reversion" is a statistical idea (a series that drifts back to its average), not a
  chart pattern anyone named. The trading uses below each have their own originator.
- **The academic root.** Short-term reversal in stock returns was documented in 1990 by Narasimhan Jegadeesh (*Journal
  of Finance* 45(3), 881-898: "The negative first-order serial correlation in monthly stock returns is highly
  significant.") and by Bruce Lehmann (NBER working paper w2533, March 1988, on one-week "winners" and "losers";
  published in the *Quarterly Journal of Economics* 105(1), 1-28, February 1990, per the NBER page's published-version
  note; the journal text itself was not read). De Bondt and Thaler (1985)
  documented long-horizon overreaction.
- **The swing-trading systems.** Larry Connors is credited with the best known one. StockCharts: "Larry Connors developed
  the 2-period RSI strategy, a fairly simple mean-reversion trading strategy designed to buy or sell securities after a
  corrective period." ([ChartSchool, RSI(2)](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2))
  The book usually cited is Connors and Cesar Alvarez, *Short Term Trading Strategies That Work* (TradingMarkets, 2008;
  bookseller listings date the first printing to November 2008 and some copies carry a 2009 copyright); I did not read
  it. Alvarez's own bio page names him "the primary researcher and co-author" of it. Pradeep Bonde (Stockbee) wrote in January 2010 that a 2-period RSI book "came out just when mean reversion had
  become most popular strategy" (he does not name the author; section 3.2). Earlier, Connors and Linda Raschke's
  *Street Smarts* (M. Gordon Publishing, 1995, per the earlier internal file
  `docs/superpowers/research/bases/11-raschke-connors-crabel-shortterm.md`) collected short-term patterns, some of them
  counter-trend; I did not read it either.
- **Rubber band.** The image is common property. Kullamägi uses it for his parabolic setup (2021); Bracco uses it for
  both parabolic shorts and "Rubber band longs" (Sunday Scans, 2025-10-19); Cesar Alvarez calls it "A common way to
  describe a mean reversion trade" ([2016-06-17](https://alvarezquanttrading.com/blog/mean-reversion-and-the-broken-rubber-band/)).
- **Kell's names.** Oliver Kell calls the oversold extreme a "Reversal Extension" and the overbought extreme an
  "Exhaustion Extension" (TraderLion articles bylined Oliver Kell, 2024). Dossier 18 covers his cycle.
- **UCT's own names, from the Substack and KB.** "Mean reversion" (long or short), "Rubber band longs", "ATR mean-reversion
  long setup" and "classic mean reversion setup" (Bracco, FIGR, January 2026), "oversold bounce", "snap back" or
  "snapback" trade, "bounce back trade", "capitulation long", "MAU&R" (moving-average undercut and rally) used as a
  rubber-band long (Bracco, 2025-10-26), "parabolic/mean reversion longs" (Bracco, 2025-10-19), and the owner's "Snap back
  long" (KB 10707, 2024-04-26). The journal tag is "Mean Reversion L/S".
- **Other names elsewhere.** Oversold bounce, dead-cat bounce (a failed one, Bulkowski), counter-trend trade, fade,
  buy the dip (Stockbee's "BTFD"), short-term reversal (academic), liquidity provision (academic).

---

## 3. Definitions, source by source

### 3.1 Kristjan Kullamägi (Qullamaggie): the parabolic short and the parabolic long

Source: "3 TIMELESS setups that have made me TENS OF MILLIONS!", qullamaggie.com, posted 2021-01-08, updated 2021-04-28,
[link](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/). His only mean-reversion setup.
- **Prior move (short):** "A stock up 50-100%+ in a few days or weeks (if larger cap) or 300-1000%+ (if smaller cap)."
- **Length:** "The stock should be up 3-5+ days in a row."
- **Trigger and entry (short):** opening range lows on 1 or 5-minute candles, the first red 5-minute candle, or a failed
  bounce into VWAP. **Stop:** "The stop is highs of the day or if VWAP fail, a reclaim of the VWAP."
- **Target:** "The target area is the 10- and 20-day moving averages, that’s where these stocks usually bounce."
- **Patience:** "Don’t be too early. WAIT for the right setup. Let the amateur shorts get run over, that’s where your
  edge comes in."
- **The long:** "any time a successful parabolic short goes down 50-60%+ in a few days, that’s the premise for the long
  setup." Entry: "Entry is opening range highs or the first green 5-minute candle or any range break to the upside if the
  stock doesn’t rally out of the gate, which they usually do." Size of the bounce: "These things can bounce 50-100% in a
  few days." His example is GBTC in 2017.
- **Payoff:** "This setup is more like 5-10x risk reward, but if you wait for the perfect setups your win rate is probably
  going to be higher." No statistics are given.
- **Volume, moving-average location:** not stated beyond the 10 and 20-day target.

### 3.2 Pradeep Bonde (Stockbee): mean reversion as a "big idea", traded only inside a trend

Bonde does not trade it as his own setup, but he names it and sets its limits.
- **Definition:** "Extreme strength or weakness tends to mean revert in short time frames." ("Big ideas around which you
  can develop trading setups", [2018-08-10](https://stockbee.blogspot.com/2018/08/big-ideas-around-which-you-can-develop.html);
  the same line in the [2019-04-30](https://stockbee.blogspot.com/2019/04/big-ideas-around-which-you-can-build.html) post.)
  His examples: "BTFD Country in trouble RSI2 are some examples of mean reversion setups"
- **The trend comes first:** "A trend has to be in existent before mean reversion can kick in." And on RSI(2): "The 2RSI
  entry is meaningless if there is no trend." ("7 concepts that can make you a better trader",
  [2010-01-07](https://stockbee.blogspot.com/2010/01/7-concepts-that-can-make-you-better.html))
- **The stretch he measures:** distance from an average. "ETF which are the farthest from their 40 day moving average are
  prime candidates for bounce." ("How to play the bounce", [2008-10-12](https://stockbee.blogspot.com/2008/10/how-to-play-bounce.html))
- **Timing:** "In the meanwhile after 3 to 4 days of negative action a bounce is likely outcome." ([2012-10-24](https://stockbee.blogspot.com/2012/10/mean-reversion-methods-indicate-bounce.html))
  And from breadth: "Historically such low levels lead to tradable bounce in next 1 to 6 weeks time frame."
  ([2011-08-08](https://stockbee.blogspot.com/2011/08/how-to-use-market-breadth-to-avoid.html))
- **His own use:** "Personally I do not trade these systems but keep a close eye on them and track their performance and
  signals to get good idea on short term market direction." ([2006-07-17](https://stockbee.blogspot.com/2006/07/mean-reversion-time.html))
- **His warning:** "Mean reversion kind of systems have had poor performance as per most followers of mean reversion in
  recent periods." (2010-01-07). He also says moves last "3 to 5 days" in general: "In most cases the momentum dies down
  in 3 to 5 days." ([2014-01](https://stockbee.blogspot.com/2014/01/swing-trading-using-momentum-bursts.html)) That is
  about his momentum bursts, but it is the same clock a snapback runs on.
- **Entry, stop, target:** not given for mean reversion.

### 3.3 Larry Connors (as restated by StockCharts ChartSchool): RSI(2)

Source: [ChartSchool, "RSI(2)"](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2).
An educator's restatement; I did not read Connors' book.
- **Prior trend:** "Traders should look for buying opportunities when above the 200-day SMA and short-selling
  opportunities when below the 200-day SMA."
- **Stretch:** 2-period RSI under 10, or under 5 for the stronger signal. "He found that returns were higher when buying
  on an RSI dip below 5 than on one below 10." For shorts, above 90 or 95. (Earlier internal research,
  `docs/superpowers/research/setups/setup_criteria.json`, notes it could not find the short-side 90/95 in the book text
  and attributes them to StockCharts. I could not check the book.)
- **Entry:** "Connors advocates the before-the-close approach." The alternative is the next open.
- **Exit:** "Connors advocates exiting long positions on a move above the 5-day SMA and short positions on a move below
  the 5-day SMA."
- **Stop:** "Connors does not advocate using stops." StockCharts adds that in his tests stops "hurt" performance, warns
  that "not using stops can result in outsized losses and large drawdowns", suggests "setting a trailing stop or
  employing the Parabolic SAR", and leaves the choice open: "Chartists need to decide for themselves."

- **Philosophy:** "Connors states that traders should buy pullbacks, not breakouts."
- **Known flaw:** "As noted above, the RSI(2) strategy can be early because the existing moves often continue after the
  signal." StockCharts' fix: wait for a sign of a turn, for example RSI(2) back above 50.
- **Volume, shape, length:** none.

### 3.4 Cesar Alvarez (Connors' co-author; alvarezquanttrading.com): tested variants

Alvarez co-wrote the 2008 book. His bio page ([alvarezquanttrading.com/bio](https://alvarezquanttrading.com/bio/)) says
he "spent nine years as a professional market researcher for Connors Research and TradingMarkets.com" and was "the
primary researcher and co-author" of the book; an earlier internal file
(`docs/superpowers/research/bases/11-raschke-connors-crabel-shortterm.md`) calls him Connors' former Director of
Research, a title his bio page does not use. His own words: "One of the first strategies I tested for Larry Connors in
2003" ([2024-01-24](https://alvarezquanttrading.com/blog/mean-reversion-vs-trend-following-through-the-years/)). His
blog publishes the rules of each test.
- **Typical setup he tests:** liquid stocks, 2-period RSI crossing under 1 to 5, often a 100 or 200-day trend filter,
  entry at the next open or on a limit below the close, exit when RSI(2) rises over 30 or 70, or on a close above
  the 5-day average.
- **The 200-day:** "I typically only trade mean reversion when the stock is above its 200-day moving average." ([2019-03-13](https://alvarezquanttrading.com/blog/how-is-mean-reversion-doing-dead-shrinking-or-doing-just-fine/))
  Three years later: "For my mean reversion strategy, I do not use a 200-day moving average." ([2022-10-24](https://alvarezquanttrading.com/blog/mean-reversion-check-up-2022/))
- **Stops:** "I have tested adding max loss stops to a mean reversion strategy, with no success." ([2016-03-16](https://alvarezquanttrading.com/blog/adding-stops-and-scaling-out-to-a-mean-reversion-strategy/))
  But, in the 2015 post those words point back to: "I want to be clear that I am not saying one should trade mean
  reversion without stops." His best combination in that test: "The best results occur using a a two times ATR10 maximum
  stop loss and a three times ATR10 profit target."
  ([2015-09-30](https://alvarezquanttrading.com/blog/stop-losses-and-profit-targets-plus-happy-birthday-excel/))
- **Entry:** in one 2007-2021 test, a limit order 1-4% below the close beat entry at the next open: "The CAR improved by
  21%, Exposure dropped 33%, MDD dropped and the avg % p/l doubled." Waiting for confirmation (a buy stop above the close)
  was worst, except in 2021: "This is showing that this year is different in that waiting for confirmation is what works
  best." ([2021-08-25](https://alvarezquanttrading.com/blog/mean-reversion-entry-at-open-vs-intraday-pullback-vs-confirmation/))
- **Volume:** in his test, quiet setups did better: "Surprisingly it is a low volume that gives the edge." ([2022-12-07](https://alvarezquanttrading.com/blog/volume-and-mean-reversion/))
- **Earnings:** avoiding earnings made his test worse: "Given these results, I will continue to trade my mean reversion
  strategies through earnings releases." ([2019-04-24](https://alvarezquanttrading.com/blog/avoiding-trades-before-earnings/))

### 3.5 Linda Bradford Raschke: when not to fade, and the climactic retest

Source: interviews she posts on her own site, [lindaraschke.net/articles](https://lindaraschke.net/articles/).
- **A counter-trend pattern exists in her library:** "Another pattern might be looking for a retest of a previous price
  level that was climactic and looking for a trend reversal" (Stocks & Commodities V.11:9, interview by Thom Hartle,
  recorded 1993-06-18).
- **Her filter against fading strong trends:** "I will not try to trade against a market where the ADX is above 32 and
  rising." And: "I have to see that the market has twice failed at a certain point before I will go against it." Also:
  "if there is a trend, don't fade the trend until you have one or two divergences." (same interview)
- **Location:** "The worst thing you can do in terms of market timing is to buy in the middle of a trading range." (AIQ
  Opening Bell, August 1997)
- **After a volatility spike:** "So, shorting the reaction after a V-spike reversal is a sucker’s play." (Active Trader,
  February 2004)
- **Orders:** "I use market orders most of the time." (1993; it matches house rule E57)
- **Her horizon:** "Even though I'm on a short-term timeframe, two to three days, I try to look for something where I
  can see a couple points' move" (1993). This is the source of the "two to three days" in the table below.

### 3.6 Oliver Kell: the Reversal Extension and the Exhaustion Extension

Sources: TraderLion articles bylined Oliver Kell: "Reversal Extension: How Stocks Bottom" (2024-06-11,
[archived](https://web.archive.org/web/20250820211726/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/))
and "Exhaustion Extension" (2024-08-11, [archived](https://web.archive.org/web/20250122070523/https://traderlion.com/technical-analysis/chart-patterns/exhaustion-extension-sell-into-strength/)).
- **Shape (long):** "A Reversal Extension is formed when the price pulls away from the moving averages, then snaps back up
  and is accompanied by heavy volume."
- **Stretch:** "When the price is extended well below the 10-day moving average, and the moving averages are extended away
  from each other, begin to look that snap back." No number is given; each stock's "character" decides.
- **Location:** support on a higher time frame: "Extensions on a daily chart should see support on a weekly chart".
- **Volume:** heavy at the low (capitulation).
- **Stop and target:** "Stops are placed just below the low of the Reversal Extension bar. Be quick to take profits and
  raise stops with the first profit target at the retest of the 20 EMA."
- **His caution:** "Often, trading the daily Reversal Extension is best avoided." And: "The Reversal Extension is not
  necessarily a playable setup but more of a change in mindset." He prefers the later Wedge Pop or EMA Crossback.
- **The overbought side:** "The Exhaustion Extension is a euphoric blowoff price movement well above the 10-day moving
  average, a sign that the stock may need time to form a new base." He uses it to sell longs into strength, not as a short:
  "Start to get defensive when there is “air” between the low of the day and the 10EMA."

### 3.7 John Bollinger: what a band touch does and does not mean

Source: the rules page on [bollingerbands.com](https://www.bollingerbands.com/bollinger-band-rules). The originator
of the bands that UCT and the app use as a stretch gauge.
- "Bollinger Bands provide a relative definition of high and low."
- "Tags of the bands are just that, tags not signals."
- "Closes outside the Bollinger Bands are initially continuation signals, not reversal signals."
- "In trending markets price can, and does, walk up the upper Bollinger Band and down the lower Bollinger Band."

### 3.8 Lance Breitstein: the "Right Side of the V" (entry timing)

His own text was not available: the Chat With Traders episode 236 page ([chatwithtraders.com/236](https://chatwithtraders.com/236))
has show notes only, which list "The Right Side of the V" among his core concepts. Bracco, who credits him, describes it:
"This strategy refers to entering a trade after a stock's price reverses from a sharp incline or decline (forming a
V-shape), aligning with the new intraday trend for higher-probability, lower-risk entries." (The Parabolic Short,
2025-06-13). For the reversal trades that means: wait for the turn, do not buy the falling price.

### 3.9 How far is "too far": IBD and the ATR% multiple

- **IBD (O'Neil's paper) on the upside stretch.** An IBD article syndicated on Yahoo Finance, "The 200-Day Line Can Serve
  As The Last Line Of Defense" (2014-04-17, no byline shown), read through WebFetch: "the stock price rises 70% to 100%
  above the 200-day line, it might be time to lock in profits." A sell rule for longs, not a short signal. A TradingView
  summary in my search results attributes the rule to O'Neil's *How to Make Money in Stocks*; I did not verify that in
  the book.
- **The ATR% multiple from the 50-day.** A TradingView script "ATR% multiple from 50-MA" by user jfsrev (2023-06-27),
  read through WebFetch, defines ATR% as ATR divided by price, and the multiple as the percent gain from the 50-day SMA
  divided by ATR%. Its own words: "A = ATR% = $ ATR / $ Last Done Price B = % Gain From 50-MA B / A = ATR% multiple from
  50-MA". It suggests profit-taking can start at "7-10 times the ATR% from the 50-SMA." The author says the script was
  built "on my behalf" by "TradingView User Fred6724", and the page is tagged "jeffsun", "jeffsuntrading" and "jfsrevg".
  Bracco writes of "an indicator inspired by @jfsrevg and @RealSimpleAriel on X" (2025-06-13) and an unsigned Sunday
  Scans calls it "the ATR extension metrics from Jeff Sun" (2025-10-19). The page's tags support the Jeff Sun credit; I
  did not confirm it on a page of Jeff Sun's own.

### 3.10 Bulkowski: the dead-cat bounce (the failed mean-reversion long)

[thepatternsite.com/dcb.html](https://thepatternsite.com/dcb.html), read through WebFetch (the site blocks plain
downloads). **The site states a notice against AI use:** "This website, in whole or in part, shall not be used to train
artificial intelligence (AI) systems". I read it only to cite it here, with the link and short quotes. Definition: "Price
usually gaps downward, closing 15% to 70% lower than the prior day." The pattern is a bounce that fails: "Once the bounce
completes, price resumes declining". His statistics are in section 4.3.

### 3.11 UCT (Bracco and the owner)

Full quotes are in section 6. The rules they imply:
- **Two UCT long variants.**
  1. **The ATR mean-reversion long in a leader** (Bracco, FIGR and SNDK, January 2026): a leading stock fresh out of a
     base sells off in a one-way intraday cascade, a move of 2 to 2.44 daily ATRs ("-200% ATR" and "-244% ATR"; my reading of his
     figure, whose formula he does not give), on heavy volume, into major support (the prior all-time high, a round number, a pivot, the 5-day SMA). Entry intraday after
     the washout; stop just under the low (FIGR: entry 49.81, stop 49); partials on the first bounce; trail the 20 EMA if
     it trends again.
  2. **The rubber-band long after a burst down** (Bracco, UAMY, USAR, ABAT, October 2025): after a parabolic run and
     blow-off, a stock falls 40-50% in 3-4 straight down days; buy the turn, often after a gap down; hold 1-3 days.
- **The index version** (Bracco, March 2026; the owner, March 2026): the Nasdaq or semis stretched down with range and
  volume expansion, the VIX near 30 or higher, breadth oversold; traded with TQQQ, SOXL or futures.
- **The short side** (Bracco): the parabolic short (its own setup), and "mean reversion short" ideas on a stretched
  leveraged ETF (SOXL, 2026-04-26), stated as short-lived. His Silver idea (December 2025) was a parabolic short.
- **What disqualifies it** (Bracco): no range or volume expansion, a slow controlled decline ("not nearly stretched down
  enough"), the first or second down day, the first break of support.

### 3.12 Our own app's older brain template (reported, not verified)

The earlier research file `docs/superpowers/research/setups/setup_criteria.json` (2026-08-09) reports that the Trading
Brain's "Mean Reversion" template (one of 48 in a separate database that is not in this repo) says "Stock >3 ATR from
20-day mean, enter on reversal candle", a maximum stop of 5.0%, and a target of the 20-day average. I could not open that
database, so I cannot confirm the wording or who wrote it. The name "Mean Reversion" is in the coach's list of the 48
templates (`api/services/uct_agent/coach/setups.py`).

### 3.13 Comparison table

"n/s" = not stated by that source.

| Criterion | Kullamägi (parabolic long) | Stockbee | Connors (StockCharts) | Alvarez (tests) | Raschke | Kell (Reversal Ext.) | Bracco (UCT) |
|---|---|---|---|---|---|---|---|
| Prior trend | A prior parabolic run that has already crashed | "A trend has to be in existent" | Above the 200-day for longs | Above the 100 or 200-day, or none (2022) | Do not fade ADX > 32 and rising | A downtrend that ends in capitulation | A leader fresh out of a base, or a crowded index |
| Stretch measure | Down 50-60%+ in a few days | Distance from the 40-day; 3-4 down days | RSI(2) under 10, ideally under 5 | RSI(2) under 1 to 5 | Climactic level; V-spike | "extended well below the 10-day" | 2-2.44 ATR intraday drop; 3-4 down days; 40-50% drawdown; outside the lower band |
| Length | A few days | 3-4 days | n/s | n/s | n/s | n/s | 3-5 day burst; "4th down day" |
| Volume | n/s | n/s | n/s | Lower volume did better | n/s | Heavy at the low | Rising on each leg lower; often record |
| Location | n/s | n/s | n/s | n/s | Retest of a climactic level; not mid-range | Higher-time-frame support | Major support: prior ATH, round number, pivot, 50-day, gap, HVE |
| Trigger | Opening range high; first green 5-min candle | n/s | The close (or next open) | Next open, or a limit below the close | n/s | Volume snap back | Intraday turn ("Right Side of the V"); ideally after a gap down |
| Stop | n/s for the long (short: day's high) | n/s | None | None helped; 2 ATR best in one test | n/s | Just below the bar's low | Just under the washout low |
| Target | 50-100% bounce | n/s | Close above the 5-day SMA | RSI(2) over 30-80; 5-day | n/s | Retest of the 20 EMA | Partials on the first bounce; the 9 EMA for parabolics; trail the 20 EMA if it trends |
| Hold | "a few days" | 3-5 days | Days | 1-6 days | "two to three days" (1993) | Quick | 1-3 days |

### 3.14 Where the sources disagree

1. **Trend filter.** Connors and Stockbee say trade only with the long-term trend (longs above the 200-day). Kullamägi's
   parabolic long and Bracco's index and rubber-band longs often happen below it. Alvarez dropped the filter in his own
   trading. House rule B26 sides with Connors except for parabolic longs.
2. **Stops.** Connors uses none and Alvarez found stops did not help his systems; Kell, Bracco and Kullamägi use a tight
   stop at the low or high of the day. House rules A3 and D41 require a real stop.
3. **Volume.** Kell and Bracco want heavy, expanding volume at the low; Alvarez's test found low-volume setups did better.
   The two are measuring different things: a capitulation day versus a quiet three-day dip in an uptrend.
4. **Entry.** Connors buys the close of the oversold day; Alvarez prefers a limit below the close; Kullamägi, Bracco and
   Breitstein wait for the turn. StockCharts notes the signal is often early.
5. **Target.** The 5-day SMA (Connors), the 9-day EMA (Bracco, parabolics), the 10 and 20-day (Kullamägi), the 20 EMA
   (Kell). None of them uses R multiples.
6. **Is it a trade at all?** Kell: "Often, trading the daily Reversal Extension is best avoided." Bracco: most traders
   should buy the later wedge pop (KB 12095). Stockbee watches but does not trade it. Bracco and Kullamägi trade it.
7. **Bands.** Bracco reads a close outside the band as a coming snapback; Bollinger says closes outside the bands are at
   first continuation signals.
8. **Shorts above the 200-day.** Kullamägi and Bracco short stretched stocks in uptrends (that is the parabolic short);
   Connors shorts only below the 200-day. B26 allows the first only for parabolics.

---

## 4. Measured evidence

### 4.1 Peer-reviewed and data-library evidence (stock universe, not setups)

- **Jegadeesh (1990), *Journal of Finance* 45(3) 881-898.** Abstract (via Crossref): "The negative first-order serial
  correlation in monthly stock returns is highly significant." A strategy built from one-month reversal plus longer-lag
  continuation: "The difference between the abnormal returns on the extreme decile portfolios over the period 1934-1987
  is 2.49 percent per month." Limits: monthly, before costs, a long-short of the extreme deciles, and it mixes the
  one-month reversal with a twelve-month continuation effect.
- **Lehmann, NBER w2533 (March 1988; published in the *Quarterly Journal of Economics* 105(1), February 1990, per the NBER page).** "This study finds sharp
  evidence of market inefficiency in the form of systematic tendencies for current 'winners' and 'losers' in one week to
  experience sizeable return reversals over the subsequent week". He reports the profits survive his corrections for
  bid-ask spreads and "plausible levels of transactions costs". Limits: 1960s-1980s data.
- **Nagel, NBER w17653 (December 2011; published in the *Review of Financial Studies* 25(7), 2012, per the NBER page's published-version note).** Reversal returns are "strongly
  time-varying and highly predictable with the VIX index", and "Expected returns and conditional Sharpe Ratios increase
  enormously along with the VIX during times of financial market turmoil, such as the financial crisis 2007-09." This is
  the best outside support for waiting for fear before buying a flush. Limits: portfolio-level reversal, not single-stock
  chart setups.
- **Kenneth French Data Library, Short-Term Reversal Factor (ST_Rev),** downloaded 2026-11-09 (file built from the
  202609 CRSP database), [link](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html). The factor buys
  last month's losers and sells last month's winners (30th and 70th NYSE percentiles, value-weighted, monthly). **My own
  arithmetic on his published monthly returns** (not his statistic):

  | Period | Months | Average per month | t-statistic | Months positive |
  |---|---|---|---|---|
  | 1926-02 to 2026-09 | 1,208 | +0.63% | +6.3 | 58% |
  | 1926-1949 | 287 | +1.19% | +4.3 | 59% |
  | 1950-1969 | 240 | +0.68% | +5.8 | 67% |
  | 1970-1989 | 240 | +0.81% | +4.6 | 60% |
  | 1990-1999 | 120 | +0.11% | +0.5 | 53% |
  | 2000-2009 | 120 | +0.35% | +0.8 | 55% |
  | 2010-2019 | 120 | +0.31% | +1.3 | 51% |
  | 2020-2026-09 | 81 | -0.43% | -1.0 | 44% |

  Reading: the naive effect (buy last month's losers) was strong for 60 years and has been statistically flat since
  1990, and negative since 2020, before costs. It is not our trade (monthly, whole market, no stretch filter, no stop),
  but it says plainly that a fall alone no longer predicts a bounce. The selection (trend,
  stretch, capitulation, support, the turn) has to carry the edge.

### 4.2 Practitioner tests (Cesar Alvarez, alvarezquanttrading.com)

All are his own backtests, with rules published in each post; his results tables are images I could not read, so I give
only the numbers in his text.
- **2001-2018, Russell 3000, RSI(2) crossing under 1, over $2, entry next open, exit when RSI(2) crosses above 70.**
  "The total is 88,750." "The average % profit/loss over the entire time period is .52%. The last two years the average
  has been .33%." 2003-2007 averaged .89% against .52% in 2010-2018. "The % winning trades has stayed very consistent
  around 65%." Verdict: "Current verdict: slowly shrinking." ([2019-03-13](https://alvarezquanttrading.com/blog/how-is-mean-reversion-doing-dead-shrinking-or-doing-just-fine/))
- **2000-2022 check-up, the same kind of rules.** "These tests confirmed what I see in my trading, that the edges are
  continuing to get smaller but are still there." Above the 200-day: "In the current bear market and the one in 2020, the
  returns are negative." ([2022-10-24](https://alvarezquanttrading.com/blog/mean-reversion-check-up-2022/))
- **Volume.** Same setup above the 200-day (2007-2022, RSI(2) under 1, exit over 70): average .54% per trade; setups in
  the lower 0-39 volume percent-rank averaged .64% ("18% above the average"), but "that is only 18% of trades". Below
  the 200-day the average was .15%. ([2022-12-07](https://alvarezquanttrading.com/blog/volume-and-mean-reversion/))
- **Stops.** Percent stops "hurts your compounded returns" without improving the maximum drawdown, though they cut the
  worst 50 trades; a 2 x ATR(10) stop with a 3 x ATR(10) target was his best combination in that test (16.46% CAR, 33%
  better than his base). ([2015-09-30](https://alvarezquanttrading.com/blog/stop-losses-and-profit-targets-plus-happy-birthday-excel/))
- **The broken rubber band.** Shorting S&P 500 stocks after 10-20 straight closes under the 5-day average (2006-2016):
  "Rubber bands don’t seem to break when a stock sells off." Only 1 of the top 5 of 66 variants made money.
  ([2016-06-17](https://alvarezquanttrading.com/blog/mean-reversion-and-the-broken-rubber-band/))
- **Index, 1957-2023.** On the S&P 500 index the one-day behaviour after RSI(2) extremes flipped around 1995; buying
  oversold has beaten the market over five days since about 1983. His own caution: "An important thing to remember is
  these results on the index do not necessarily translate to stocks." ([2024-01-24](https://alvarezquanttrading.com/blog/mean-reversion-vs-trend-following-through-the-years/))

Limits of all of these: no commissions or slippage in most; mechanical rules, no chart judgement; mostly large, liquid
stocks; one tester. They measure the Connors type of mean reversion (a dip in an uptrend), not Bracco's capitulation flush.

### 4.3 Bulkowski: the dead-cat bounce (read through WebFetch; the site has an anti-AI notice)

On stocks that gap down hard (15% to 70% in a day; average event decline 31%): "Forty-six percent make a lower low the
next day", the event low comes on average 7 days later, "The average bounce height from event low to bounce high is 28%
and takes 23 days", then "price resumes declining, averaging 30% from the bounce high to post-bounce low in 49 days."
Bigger falls bounced more: "Event losses (from the close the day before the event to the trend low) above the median 28%
decline had bounces averaging 35% in 25 days." Limits: the page gives no sample size or study dates ("based on hundreds of
_perfect_ trades"); these are news-driven single-day collapses, the kind Bracco's capitulation longs avoid when the news is
fundamental. The lesson for us: the first day after a crash usually is not the low.

### 4.4 My own check on the local bar database (not a published statistic)

**What I did.** Script `tools/measure_mr3.py` in my scratch folder (not committed). The sandbox daily bars (today's listed
tickers only, so survivorship bias flatters longs), 2010-01-01 to 2026-08-01, only days with a close of $10 or more and a
50-day average of $20 million or more traded (B23). Each signal is bought (or shorted) at the next open, as a market
order (E57), and traded three ways from the same entry: **HOUSE** (stop 3 cents under the signal day's low, or over its
high for shorts: A3, F62), **NOSTOP** (Connors), and **ATR2** (a stop 2 x ATR(14) from the entry, Alvarez's best size).
All three exit at the first close back through the 5-day SMA (Connors' exit), else at the tenth session's close (C33),
else at the stop. The six mechanical signals and the control were fixed before the first run (the first version of the
script); the two UCT stand-ins (LF and RB) were added in the third version, after the first results had been seen, so
they are exploratory, not pre-registered. No costs, no slippage.

The signals: **L_RSI2_UP** close over the 200-day SMA and RSI(2) under 5 (Connors' long); **L_RSI2_DN** the same under
the 200-day; **L_ATR3_UP / DN** a close 3 ATR(14) or more under the 20-day SMA, over or under the 200-day (the old brain
template's number); **S_RSI2_DN** short, under the 200-day and RSI(2) over 95; **S_ATR3_UP** short, 3 ATR or more over
the 20-day while over the 200-day (a stretch short that B26 bars); **LF** a daily stand-in for Bracco's leader flush (up
25%+ in the prior 20 sessions, over the 50 and 200-day the day before, a low 2 ATR or more under the prior close, volume
1.5x its 50-day), bought at the flush close (LF_close) or the next open (LF_open); **RB** a daily stand-in for the
rubber band after a burst down (3+ straight lower closes and a close 40%+ under the prior 10 sessions' high, any trend);
**BASE** a 3% random sample of liquid days over the 200-day, traded the same way, as the control.

| Signal | n | Next open already under the house stop | NOSTOP: avg / median / win | ATR2: avg / win | HOUSE: avg / median / win / stopped | House stop distance: median (share within 3%) | Reached 3R before the house stop (10 sessions) | Touched the 20-day SMA (10 sessions) |
|---|---|---|---|---|---|---|---|---|
| L_RSI2_UP | 123,630 | 18.7% | +0.40% / +0.90% / 67.5% | +0.34% / 66.1% | +0.09% / -0.35% / 34.4% / 63.6% | 1.01% (89%) | 21.1% | 64.1% |
| L_RSI2_DN | 185,163 | 21.0% | +0.41% / +1.02% / 65.9% | +0.41% / 64.4% | +0.09% / -0.44% / 32.0% / 66.0% | 1.16% (86%) | 20.7% | 52.5% |
| L_ATR3_UP | 22,432 | 18.5% | +0.69% / +0.95% / 69.2% | +0.54% / 67.6% | +0.16% / -0.30% / 37.4% / 59.1% | 1.17% (86%) | 21.4% | 41.1% |
| L_ATR3_DN | 126,678 | 18.9% | +0.25% / +0.95% / 65.4% | +0.31% / 63.7% | +0.08% / -0.42% / 35.2% / 60.8% | 1.41% (79%) | 20.0% | 39.0% |
| S_RSI2_DN (short) | 90,405 | 20.2% | +0.29% / +0.88% / 64.8% | +0.30% / 63.6% | +0.14% / -0.38% / 31.3% / 66.7% | 0.98% (88%) | 20.7% | 59.4% |
| S_ATR3_UP (short) | 188,355 | 19.6% | +0.06% / +0.55% / 63.0% | +0.06% / 61.2% | -0.01% / -0.31% / 31.1% / 64.8% | 0.85% (90%) | 19.1% | 39.5% |
| LF_close | 1,691 | 0% (bought at the close) | +0.66% / +1.84% / 59.2% | +0.56% / 58.5% | +0.58% / -1.07% / 32.3% / 62.7% | 3.04% (50%) | 22.8% | 88.3% |
| LF_open | 1,691 | 15.3% | +0.14% / +1.04% / 57.3% | -0.08% / 56.6% | -0.39% / -1.38% / 35.2% / 56.0% | 4.51% (33%) | 15.5% | 88.3% |
| RB_open | 2,081 | 19.8% | +2.81% / +3.82% / 63.3% | +2.99% / 63.1% | +1.82% / -1.59% / 34.0% / 64.1% | 4.68% (34%) | 24.1% | 30.3% |
| BASE (control) | 89,984 | 11.3% | +0.09% / +0.35% / 61.6% | +0.06% / 60.9% | +0.00% / -0.18% / 41.4% / 43.3% | 1.24% (86%) | 19.1% | 92.8% |

Average holding time with the 5-day exit was about 4 sessions for every signal (2.5 for the control).

**What it says (my reading; treat it as a first look, not a backtest of our setup):**
1. **There is a small, real edge in buying stretched dips, and it matches Alvarez's size.** Oversold longs averaged
   +0.25% to +0.69% a trade with no stop, against +0.09% for a random liquid day with the same exit. That is close to
   Alvarez's .33% to .52%. Year by year it was negative in 2011, 2018 and 2022 for L_RSI2_UP and badly negative in 2020
   for the below-200 versions (L_RSI2_DN -1.61%, L_ATR3_DN -4.37% that year): the below-200 versions carry the crash risk
   B26 is there to avoid.
2. **The house default stop does not suit this setup.** Under the signal day's low, the stop is about 1% away, and about
   one next open in five is already under it (B20 territory). The same entries made +0.09% a trade with that stop, against
   +0.40% with no stop and +0.34% with a 2-ATR stop. The trade needs a stop under the turn's low, or a wider structural
   stop sized down, not the flush day's low bought a day late.
3. **3R is a long way for a snapback.** Only 20-24% of signals reached 3R before the house stop within 10 sessions,
   about the same as the random-day control (19.1%). With no stop, the 20-day average was touched far more often (39-64%,
   88% for the leader flush). This supports trimming at the average (section 8.5).
4. **Stretch shorts in uptrends did nothing.** S_ATR3_UP (3 ATR over the 20-day, over the 200-day) averaged +0.06% a
   trade, no better than chance. That is the trade B26 bars, and the data agrees with the rule. Shorts below the 200-day
   (S_RSI2_DN) did better, +0.29%.
5. **The UCT-style variants are bigger but thin and noisy.** The leader flush bought at the flush close made +0.66% a
   trade (median +1.84%); bought a day later at the open it made +0.14%, which is the cost of waiting a whole day instead
   of buying the intraday turn. The rubber band after a 40% fall made +2.81% a trade, but 591 of its 2,081 cases are from
   2020, and survivorship bias is worst here: stocks that kept falling and were delisted are missing from the database.
   Do not quote the rubber-band number as an edge.

**Limits.** Survivorship bias (today's tickers only); no commissions, slippage or borrow costs; daily bars only (UCT's
real triggers are intraday); overlapping signals on the same stock are counted separately; the stand-ins for Bracco's
setups are my approximations; one data source; 2010-2026 only. Script and full log are in my scratch folder, not in the
repo.

---

## 5. Our app

### 5.1 What exists

| Place | What it says or does | File |
|---|---|---|
| Journal tag | "Mean Reversion L/S", in the **Intraday** group (with ORB, Red to Green, 30min Pivot) | `app/src/constants/setupGroups.js` |
| Model Book | **No "Mean Reversion" card.** Related cards: "Parabolic Short" and "Parabolic Long" (family "Reversals & Reclaims") | `app/src/pages/modelbook/setupCatalog.js` |
| Study units | Not taught: listed among names with "no unit; owner may add later" | `docs/study/UNITS-method.md` line 189 |
| Trade plans | None | `docs/study/TRADE_PLANS.md` |
| Vocabulary | "no vocabulary entry in v1" | `docs/wisdom/vocabulary/setup-vocabulary-v1.json` |
| Coach | "Mean Reversion" is one of the Trading Brain's 48 template names | `api/services/uct_agent/coach/setups.py`, `app/src/agent/coach/brain.js` |
| Archive search | the words "oversold" and "mean reversion" map to the `capitulation_long` family | `api/services/wisdom/archive/ask_setup.py` line 105 |
| Detector | `uct_capitulation`: the closest scanner (a flush long), **internal**, shown to members only as a "Capitulation" tag | `api/services/pattern_engine/detectors/uct/uct_capitulation.py` |
| Chart IQ tag | "Climax / exhaustion" (id `parabolic_short`), drawing the 9 EMA as the "mean-reversion target" | `api/services/chart_iq/engine/v2_setups.py` |
| Backtester | "RSI Mean Reversion" strategy template | `api/services/strategy_templates.py` |
| Voice KB / recall bank | Regime note rp-005: "Mean reversion works; breakouts fail." in a chop regime | `api/data/voice_kb/trading_principles.json`; `docs/study/bank/recall.principles.json` |

### 5.2 What the code tests, faithfully

**`uct_capitulation` (long only).** It fires on day i when all of these hold (constants in the file):
- **C1:** the close is more than 1 ATR(14) below the lower Bollinger band (20, 2) (`c < bbl - 1.0 * a`);
- **C2:** the day's range is at least 2 ATR, or the low is at least 2 ATR under the prior close (`CAP_RANGE_ATR = 2.0`);
- **cascade:** the three sessions before fell at least 1.5 ATR (`CAP_CASCADE_ATR = 1.5`);
- **and one of:** three down closes, each bigger than the last; record volume (the most in up to 252 prior sessions, with
  at least 190 sessions of history); or 2x the 50-day volume rising across three down days;
- **vetoed** by a decline on falling volume (5-bar slope) unless the volume is a record (the veto is applied to the
  setup-day variant only);
- **a second variant, `gap_below`:** the day after such a setup day opens under its low.
- **Entry:** the close of the flush. **Stop:** the session low. **Targets:** 2R and 3R (`make_levels`). A 0-5 star count
  tallies the extremes. Labels only: a 3-day 15% drop from above the 50-day (the constant is `CAP_JERSACE_DROP = 0.85`; Jersace is a
  UCT contributor, and the file does not say more about the name), a loose stretch, open down-gaps, and the extension
  from the 50-day in ATRs.
- **Liquidity:** the shared `liquidity_floor`: price $2 and a 20-day average of $10,000 traded (`primitives/liquidity.py`).
- **Member gate:** in `INTERNAL_PATTERN_IDS` (admin only), but in `SETUP_TAG_TEAM_SET`, so members see a "Capitulation"
  tag defined as "A wide-range flush that closes far below the lower Bollinger Band after a multi-day slide." The tag
  must also pass a textbook check (`tag_textbook.capitulation_r2`): the prior close at least 10% under the highest close
  of the 14 sessions before it, with 5 of the 8 prior sessions down; a red day with a range of 2 ATR and 2x average
  volume; a close more than 2 standard deviations under the 20-day average; and the prior close at least 15% under the
  highest close of the prior 25 sessions, set at least 5 sessions earlier. Blind round-2 judging scored it
  2.89 (the header of `tag_textbook.py`, not of the detector file).

**Chart IQ "Climax / exhaustion" (short).** Fires when the close is at least 5 ATR above the 50-day SMA (`ext50 >= 5`),
at least 12% above the 9 EMA, up at least 25% from the 20-day low, with at least 2 straight up closes; grade A if 7 ATR or
more above the 50-day. It draws the 9 EMA as "9 EMA (mean-reversion target)".

**"RSI Mean Reversion" backtest template.** "Buys when RSI crosses above 30 (oversold reversal) and sells when RSI
crosses above 70 (overbought)." Default RSI period 14, long only, no stop, no trend filter.

### 5.3 Where the app disagrees with the sources or looks wrong

1. **The tag is filed as Intraday.** UCT's own mean-reversion trades are swing trades held 1-3 days (Bracco), or longer
   when they become trends (FIGR, the plan was to trail the 20 EMA). Their trigger is often intraday, which may be why the
   tag sits there. Owner question 2.
2. **No card and no plan.** A member can journal a "Mean Reversion L/S" trade with no definition anywhere in the app.
3. **The Model Book "Parabolic Long" card contradicts the owner's ruling.** The card: "Riding the steepening curve of a
   runaway move", "managed bar by bar as the angle goes vertical", with ten rising candles. The owner ruled (B26) that the
   parabolic long is the mirror of Bracco's burst, a burst **down** ("1, yes."), which is also Kullamägi's meaning ("any
   time a successful parabolic short goes down 50-60%+"). The card describes a momentum long riding a parabola, the
   opposite trade. Owner question 12.
4. **The capitulation detector buys the close; the sources wait for the turn.** Kullamägi (first green 5-minute candle,
   opening range high), Bracco and Breitstein ("Right Side of the V"), StockCharts (RSI(2) back over 50) all wait. The
   detector's own narrative says so: "Traders who play this usually wait for the turn rather than catching the bar".
   Bulkowski's dead-cat numbers (46% make a lower low the next day) say the same.
5. **Its stretch gate relies on the band; Bollinger says a close outside the band is first a continuation signal.** The
   detector adds range, cascade and volume conditions, which is why it is defensible; the band alone would not be.
6. **Its liquidity floor ($2, $10,000 a day) is far below B23 ($10, $20 million a day).**
7. **Its targets are 2R and 3R; the house first trim is 3R (B19), and every source targets an average instead** (5-day,
   9 EMA, 10/20-day). In my check (section 4.4), only 20-24% of oversold signals reached 3R before the house stop within
   10 sessions, about the same as a random day (19%), while with no stop 39-64% touched the 20-day average within 10
   sessions (88% for the leader flush). The two figures use different stop assumptions, so it is a rough comparison.
8. **The Chart IQ "ATR over the 50" is not Jeff Sun's ATR% multiple.** The app computes (close - SMA50) / ATR. The
   TradingView definition is the percent gain from the 50-day divided by ATR%, which equals the app's number times
   close / SMA50. On a stock 100% above its 50-day the published multiple is twice the app's. A "7x" quoted from Jeff Sun
   or Bracco is not the app's 7.
9. **The backtest "RSI Mean Reversion" is not Connors' RSI(2).** Period 14, a cross back above 30, no 200-day filter, no
   5-day exit. Fine as a generic demo, but it should not be presented as the Connors method.
10. **An unsourced number is being taught.** rp-005 says "Win rate drops 15-20% in chop vs trend." The voice KB file
    describes itself as a "Curated trading-wisdom corpus" with no author or source, and the recall bank serves the line
    as a quote (`docs/study/bank/recall.principles.json`, item si_14d136d3503c). I found no source for 15-20%. Owner
    question 14.
11. **The old brain template's ">3 ATR from 20-day mean"** (section 3.12) is unverified and, in my check, a 3-ATR stretch
    above the 200-day is rare while below it is common (section 4.4).

---

## 6. UCT's own words

Every quote below was found in the saved post and its section author checked by script. Links are to the public posts.

### 6.1 The owner (Patrick, TSDR)

- **The account rule that names the setup** (owner verdict log, 2026-11-09, C31): "31, yes unless parabolic or mean
  reversion."
- **The edge exists** ([Sunday Scans, 2026-03-29](https://unchartedterritoryy.substack.com/p/sunday-scans-352), META):
  "Probably stupid, but there is an edge in significant asymmetric mean reversions. Bracco is skilled at them."
- **His index setup that week** (same post): "This week I will be dialed in on TQQQ oversold bounce/mean reversion." On
  the TQQQ chart: "Extended below 5SMA, 9EMA, 20EMA, 50SMA. Outside completely lower Bollinger band. Not bottom calling,
  but stretched and a very viable reversion trade opportunity here." And: "Think we really have to keep a 2-3 day outlook
  until proven otherwise."
- **The 200-day, in the same post:** "Generally, below the 200SMA no participation is best." And later
  ([Sunday Scans, 2026-11-08](https://unchartedterritoryy.substack.com/p/sunday-scans-70f)): "Some of the best traders I
  know often suggest 0 activity below the 200SMA." and "This avoids all the damage that occurs under the 200SMA, always."
- **A stretched short:** "Ugly, but stretched. Careful maintaining short, bounce could be 1 day or 20 but the opportunity
  is there." (MAGS, 2026-03-29)
- **Pullbacks in leaders as defined-risk spots** ([Sunday Scans, 2025-10-26](https://unchartedterritoryy.substack.com/p/sunday-scans-13e)):
  "Riding the waves of winners and picking those winners up at spots where the risk is so incredibly defined and the wall
  of worry has been built in the near term." And: "You can easily capture 10-15-20% moves in stocks off these spots.
  Again, such as NBIS off the 50SMA, HVE level at $95.72, down 8 days in a row."
- **After the July 2026 semis flush** ([Sunday Scans, 2026-08-02](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2)):
  "I thought the reversion trade on Memory, Korea, and Semis was a really good opportunity and probably still is honestly."
- **The TQQQ trade, the week after** ([Sunday Scans, 2026-04-05](https://unchartedterritoryy.substack.com/p/sunday-scans-356)):
  "Came into the week pretty adamant (Read Last Week’s SS) that we were likely to get a snapback rally. Was able to get
  positioned in TQQQ with this insane entry price." The entry: "Tuesday’s gap up gave a very good opportunity on the
  intraday pullback and was a textbook Brian Shannon Gap Up against intermediate trend."
- **A bounce he would not buy** ([Sunday Scans, 2026-07-19](https://unchartedterritoryy.substack.com/p/sunday-scans-a52),
  SNDK): "Ideally at a dead cat bounce spot here. Lot of excitement on the oversold bounce attempt on Friday only to
  close weak and fade".
- **KB 10707** (2024-04-26, his chat words as the KB records them): in a list of possible edges he wrote "Snap back long".

### 6.2 Bracco

- **His specialty:** "My style favors special, outlier moves, such as mean reversions, parabolics, 5-star breakouts,
  breaking news, etc." ([The Rest of the Week, 2025-10-22](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481))
  And: "specializing in mean reversions and parabolic trades" ([Sunday Scans, 2025-09-21](https://unchartedterritoryy.substack.com/p/sunday-scans-88a)).
- **The family:** "There are various types of mean reversion trades, but today I’m focusing on my 5-star Parabolic Short
  setup and how to trade it effectively." ([The Parabolic Short, 2025-06-13](https://unchartedterritoryy.substack.com/p/the-parabolic-short))
  "To clarify, the parabolic short is an extraordinarily high-probability mean reversion opportunity, that can sometimes
  lead to secular tops, but not always." ([Sunday Scans, 2026-05-10](https://unchartedterritoryy.substack.com/p/sunday-scans-68a))
- **The target and the band (parabolic short post):** "My target for a Parabolic Short is consistently the 9-day
  exponential moving average (9EMA), which my studies show acts as a magnet for mean reversion" and "A price breach above
  the upper Bollinger Band or below the lower band is typically short-lived, often foreshadowing a counter-trend snap back
  move".
- **The ATR mean-reversion long, defined** ([Sunday Scans, 2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1)):
  "This is the ATR mean-reversion long setup I use to get exposure to powerful, trending leaders". His FIGR checklist "At
  the lows of the day": "A Cascading sell off (parabolic curve)", "Increasing volume on each leg lower", "Extreme 244% ATR
  move", "600% above avg 5-minute volume", "Retesting the prior all-time high", "$50 psychological level". The trade:
  "Entry around 49.81, stop at 49." "Scaled out a few partials on the initial bounce and held a core piece to swing,
  planning to add if the daily tightened up for another leg." "My original plan was to trail the 20EMA and look for
  re-add spots." The trigger, in his words: "I initiated after it washed out the $50 psych level and previous ATH peak
  on the highest volume of the day." The cause: "An overreactive sell off into a huge area of support on a leading IPO."
  The setting: "a sharp -16% late-day drop on Monday wiped out the late chasers and shook out the weak hands."
- **SNDK, the same setup two days earlier** (same post): "It sold off right at the open, no green 10-minute candles all the
  way down until lows of the day." "It hit over -200% ATR move at the lows of the day and held right at S3 (support
  pivot)." "SNDK was the lesson, FIGR was the exam."
- **FIGR, as posted the next evening** ([The Rest of the Week, 2026-01-14](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305)):
  "Got long at 49.81 yesterday on the classic mean reversion setup. Cascading sell off with volume increasing on each
  intraday leg lower."
- **Rubber-band longs after a blow-off** ([Sunday Scans, 2025-10-19](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc)):
  "In some cases, stocks that set up for a parabolic short and blow off at the highs can actually turn into
  parabolic/mean reversion longs in just a couple of days." "USAR ABAT UAMY interest me after weak closes on Friday on
  their 4th down day after 40-50% drawdowns." "These are short lived trades and not meant to be held longer than 1-3 days."
- **The MAU&R as a rubber band** ([Sunday Scans, 2025-10-26](https://unchartedterritoryy.substack.com/p/sunday-scans-13e)):
  "rubber band / mean reversion longs on some short term oversold momentum leaders" and "These all staged MAU&R’s
  (moving average undercut and rallies) with most closing strong on Friday."
- **A leader pulling into its 20 EMA** ([The Rest of the Week, 2025-10-01](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week),
  IONQ after "+80% move in 9 days"): "Now down 5 days in a row with volume declining last 4 days." "Looking for a short
  term mean reversion bounce trade that has potential to turn into a bigger move." "For that reason I will be aggressive in
  taking profits if we do get that reversal." "In a perfect world this undercuts the 20EMA and reclaims."
- **What he looks for at an index low** ([Sunday Scans, 2026-03-22](https://unchartedterritoryy.substack.com/p/sunday-scans-cab)):
  "Whenever I am looking for a potential mean reversion turning point out of a downtrend, I really try to focus on a few
  characteristics. First will be range and volume expansion." "The most ideal scenario would be a significant gap down
  over the weekend, ideally 1 full ATR or more on the indexes." "My main trading vehicle is always the TQQQ, SOXL, or
  Index futures." "After all, most market crashes occur below the 200-day moving average." "Religiously sticking to my
  stop loss is the only reason I am able to successfully trade this setup time and time again."
- **The VIX, and a market not stretched far enough** ([Sunday Scans, 2026-03-08](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf)):
  "Anytime we get a fast move up into 30 it is usually a good time to start paying attention for a mean reversion
  opportunity." "The S&P just lost its weekly uptrend and not nearly stretched down enough for a high quality reversal
  trade."
- **When he passes** ([Sunday Scans, 2026-11-01](https://unchartedterritoryy.substack.com/p/sunday-scans-669)): "I
  personally did not view Friday as a good opportunity to try bounce/mean reversion long plays. Was only second day down
  in a row as well as first day breaking down below a 3-month support level."
- **A precedent** ([Sunday Scans, 2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8)), February
  2022: "we had a downside trending market, a very elevated VIX in the 30’s, Nasdaq -20% off highs, and 5 down days in a
  row leading into the attack. Perfect setup for a capitulatory event and mean reversion trade opportunity."
- **Breadth** ([Sunday Scans, 2025-10-12](https://unchartedterritoryy.substack.com/p/sunday-scans-296)): "With parabolic
  mean reversions being my specialty, this was a 5-star trade opportunity, specifically on ETH." "Mean reversion back
  higher is likely right around the corner." "Many shorter term breadth indicators such as MMTW (% of stocks above 20ma)
  and S5FD (% of stocks above 5ma) have already hit oversold territory and near the bottom of their ranges, which usually
  precedes a snap back higher."
- **Semis, June 2026** ([Sunday Scans, 2026-06-07](https://unchartedterritoryy.substack.com/p/sunday-scans-d16)): "SOXL
  down -36% in just 2 days and worth watching for a mean reversion long next week." "Ideal situation is a gap down or
  further weakness before the turn." Two weeks later ([2026-06-21](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0))
  he reported SOXL +77% and KORU +85% from the June lows.
- **Execution is hard** ([Sunday Scans, 2026-08-02](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2)):
  "Turns out the thesis was on point, but the timing and execution was not." "That was hands down one of the most
  difficult mean reversion turns i've traded from a technical perspective".
- **A mean-reversion short above the 200-day** ([Sunday Scans, 2026-04-26](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d),
  SOXL "completely outside the upper Bollinger band with 3 days of range expansion and a large open gap"): "I think this
  could easily be in play for a mean reversion short, but probably not something I would overstay my welcome in as I
  would imagine the first big dip on this gets bought aggressively."
- **The ATR stretch on SLV** ([Sunday Scans, 2025-12-28](https://unchartedterritoryy.substack.com/p/sunday-scans-249)):
  "The Silver ETF (SLV) is the most extended it’s ever been from its 50-week moving average, using an ATR multiple".
- **Software, a capitulation long idea** ([The Rest of the Week, 2026-02-04](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732)):
  "IGV traded it highest volume in its 26-year history today on its 6th consecutive down day and 4th consecutive down
  weak." "We have range and volume expansion as the ETF nears a huge 2+ year support area."
- **What a capitulation bottom looks like to him** ([Sunday Scans, 2025-11-16](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a)):
  "Many of the names that blew off top in October and lead this correction lower feel very close to some sort of
  capitulation bottom. They are very oversold from short term MA’s, down multiple weeks/days in a row and are seeing an
  increase in daily volume."
- **"Capitulation long" as his own name for it** ([The Rest of the Week, 2025-11-05](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9),
  ETHA/ETHU after "ETH -15% & BTC -7%" at the lows, ETHU on "its highest volume ever"): "Think potential rubber band /
  capitulation long setup here for a short term trade opportunity."
- **A mean-reversion short he would not front-run** ([Sunday Scans, 2026-04-05](https://unchartedterritoryy.substack.com/p/sunday-scans-356),
  USO "completely outside the upper Bollinger Band"): "Another day or two of straight vertical price action and this may
  set up a really clean mean reversion opportunity. Not something I am going to front run".
- **The index version, two more times** ([Sunday Scans, 2026-06-14](https://unchartedterritoryy.substack.com/p/sunday-scans-e95)):
  "The Nasdaq corrected almost -9% in just 5-days while still remaining above a sharply rising 50-day moving average."
  "Only regret was not being willing to try the SOXL idea on the intraday turn Tuesday". And
  ([2026-07-05](https://unchartedterritoryy.substack.com/p/sunday-scans-dec)): "SOXL on another mean reversion to the
  long side. We saw SOXX SMH fall over -15% in just two days".
- **One that gave only a day** ([Sunday Scans, 2026-10-25](https://unchartedterritoryy.substack.com/p/sunday-scans-36e),
  NCLD): "Was very interested in mean reversion trade on neoclouds into the 10/15 gap down and only got one day of glory
  before pushing back towards lows." "Clear capitulatory action on this wave down imo but may be a tough trade."
- **The overreaction reading** (2025-10-12, same post as the breadth quotes): "To me this represents an overreaction due
  to excessive leverage and overconfidence among market participants."
- **His "Monday Effect"** (2026-03-22): "where through my studies notable capitulations and turns have occurred on a
  Monday, especially when you get consecutive down days into the end of the week." He lists four dates; three were
  Mondays (2020-03-23, 2024-08-05, 2025-04-07), but his "Monday, March 24 2022" fell on a Thursday (the March 2022 low
  was Monday the 14th). An observation, not a measurement.
- **KB 12095** (2025-12-01, his chat words): "i think most traders are not as good at that and woudl rather buy the wedge
  pop into a new uptrend versus the oversold bounce." **KB 11061** (2025-02-25) is a summary, not his words: it says he
  finds mean-reversion bounces work best when the indexes are also stretched down and aligned, and that he takes them at
  size only on a 5-star capitulation event.

### 6.3 Unsigned sections and other contributors

- Unsigned "Index & ETF", 2025-10-19: "This is a great study of the ATR extension metrics from Jeff Sun." (GLD)
- Unsigned "Index & ETF", 2026-03-15: "Remember, the VIX is mean reverting by nature."
- Unsigned "Index & ETF", 2026-02-08: "5* mean reversion opportunity late last week on high volume." (BTC)
- Unsigned intro, 2025-12-28: "Everyone says SLV is a mean reversion short and also everyone says that it will fail
  because everyone is watching it."
- Unsigned "Thoughts on the Market", [2026-04-01](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-13b):
  "Snap back expected, was trickier to trade than preferred given the overnight move but easy when you know what to look
  for and it did the classic Gap Reversal Against Intermediate Trend from Brian Shannon."
- Manrav, CRWV, [2025-11-26](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a): "Bottom fishing/Snap
  back trade idea." with "Trade Idea: Long with 65 stop".

### 6.4 Examples to model (named by UCT or by the sources)

These are the cases the writers themselves named. I have not re-drawn them; each needs a chart check before it becomes a
lesson. Dates are the trading days the posts describe.

| # | Ticker | Date (trading day) | Side | Who | What happened, in their words | Fits B26? |
|---|---|---|---|---|---|---|
| 1 | FIGR | 2026-01-12 | Long | Bracco | Cascade into the $50 level and prior ATH, -244% ATR; long 49.81, stop 49; "rip over 50% in the next 4 days" | Needs a chart check (an IPO; the 200-day may not exist) |
| 2 | SNDK | 2026-01-08 | Long | Bracco | +30% out of a base, then "-200% ATR move", held S3 and undercut the 5-day | Likely above (a leader); check |
| 3 | UAMY, USAR, ABAT | 2025-10-17 (Friday) | Long | Bracco | 4th down day after 40-50% drawdowns, after a blow-off | Mixed; check each |
| 4 | IONQ | 2025-09-30 | Long | Bracco | +80% in 9 days, then 5 down days into the rising 20 EMA | Likely above (a leader); check |
| 5 | IREN, CIFR, NBIS, LEU, BE, HOOD | week of 2025-10-20 | Long | Bracco; the owner on NBIS | MAU&R off the 10-week; NBIS at the 50-day and the $95.72 HVE level, down 8 days | Likely above (leaders); check |
| 6 | ETH (ETHU) | 2025-10-10 (after hours) | Long | Bracco | Liquidation; "5-star trade opportunity" | Crypto; not a stock |
| 7 | IGV | 2026-02-03 | Long | Bracco | Record volume, 6th down day, 2+ year support | Check |
| 8 | TQQQ | week of 2026-03-30 | Long | The owner | Extended below every short average, outside the lower band | Check; the owner wrote it was a "2-3 day" trade |
| 9 | SOXL, KORU | 2026-06-05 flush; June lows | Long | Bracco | SOXL -36% in 2 days, then +77% from the lows | Check |
| 10 | SOXL | 2026-04-24 | Short | Bracco | Outside the upper band, 3 days of range expansion, gap | Likely not (a short in an uptrend; it would need the parabolic burst checklist); check |
| 11 | GBTC | 2017 | Long | Kullamägi | His parabolic long example | n/a (his) |
| 12 | Nasdaq | 2022-02-24 | Long | Bracco | VIX in the 30s, -20% off highs, 5 down days, war headline | Likely below the 200-day (Nasdaq -20% off highs); an index; check |

---

## 7. How it fits the account rulebook (section 9)

| Rule | What it says | Fit with mean reversion |
|---|---|---|
| **C31** | Leaders with RS 80+, "except parabolic and mean-reversion trades" | **Explicitly exempt.** But Bracco's best stock version is in leaders (FIGR, SNDK, IONQ). Question 15. |
| **B26** (hard) | No longs below the 200-day unless a parabolic long; shorts only below it unless a parabolic short | **The main conflict.** Connors' version obeys it. Bracco's rubber-band longs after a crash, the index capitulation buys (he: "most market crashes occur below the 200-day moving average") and his mean-reversion short on a stretched uptrend (SOXL, April 2026) do not, unless they also qualify as a parabolic burst. Question 3. |
| **D46 / F65** | Red market: mostly cash plus shorts below the 200-day | Index and leader flushes happen in Orange and Red markets. A mean-reversion long there breaks D46 unless it is ruled an exception. Question 11. |
| **A3, F62** | Stop a few cents under the day's low or the prior day's low | Fits the sources that use a stop (Kell, Bracco, Kullamägi). **But in my check about one in five (15-21%) of next-day opens were already under the signal day's low**: buying the next open with a prior-day-low stop is often impossible (B20 applies). |
| **A13** | Stops usually within about 3% | Bracco's FIGR stop was 1.6% (49.81 to 49). In my check the house stop (under the signal day's low) was a median 1.0-1.4% away on the oversold signals, but 3.0% on the leader flush bought at its close and 4.5-4.7% on next-open entries after a flush or a 40% fall, where only a third fit within 3%. A flush day's range can be wide; the detector's narrative warns the stop is "wide in dollars". |
| **A4, A5** | The stop only moves up; full size at one price, no adding | Bracco planned "to add if the daily tightened up" and "re-add spots". Under A5 a re-entry is a new trade (B21). |
| **B19, E51** | First third at 3R, second at 5R; breakeven at 2-5R | **Conflict with every source's target.** Each source exits at an average (5-day, 9 EMA, 10/20-day, 20 EMA) or after 1-3 days. In my check 3R came before the house stop in only 20-24% of signals within 10 sessions. Question 4. |
| **E52** | Trail the 10-day (fast) or 21-day (steady) | Fits the leftover piece once a snapback turns into a trend (Bracco's FIGR plan: "trail the 20EMA"). |
| **C33** | Under 1R after 10 trading days: sell | Sources hold 1-3 days (Bracco) or until the 5-day is regained (Connors). A 10-day clock is long for this setup. Question 5. |
| **C28, C29** | No chasing past 4%; skip a long more than 10% over its 10-day | C29 cannot bite on a long bought below its averages. C28 needs a defined buy point (question 7). |
| **B20** | A gap through the stop: the first 30-minute low is the new stop, out past 2R | Applies often: flush lows are gapped through (my check: about one next open in five was already under the signal day's low; Bulkowski: 46% of his dead-cat-bounce events make a lower low the next day). |
| **B22** | No new buys in the 3 days before earnings | Applies. Alvarez found avoiding earnings hurt his mean-reversion tests; the house rule stands. |
| **B23, D42** | $10+, $20M+ a day; never more than 1% of daily volume | Applies; the capitulation detector's floor is far lower (section 5.3). |
| **D47** | Shorts are the long setups reversed | The mirror (an overbought bear-market rally, shorted below the 200-day) is Connors' short side. |
| **D48** | Skip hard-to-borrow shorts | Matters most here: stretched small caps are often hard to borrow. |
| **E54** | Leveraged ETFs preferred | Fits Bracco's index version (TQQQ, SOXL). |
| **E56** | At most 3 tries a week, 6 a month on one stock | Fits; Bracco was "in and out of SOXL KORU SNDK multiple times on Wednesday" (2026-08-02). |
| **E57** | Market orders | Fits Raschke ("market orders most of the time"); Alvarez found limit orders below the close did better in his tests. |
| **D38, E49** | Size by grade | Per the KB 11061 summary, Bracco takes them at full size only on a 5-star event. |

---

## 8. Proposed rules for our course

Each line is measurable. Where sources disagree I give the options and recommend one. Nothing here is a ruling.

### 8.1 What it is

- **Definition.** A swing trade against a short, unusually fast move, aimed at a return to a short average, held about 1-5
  sessions. **[source consensus]**
- **Two long forms, one short mirror.** (A) the **leader flush**: a leading stock that sells off hard into support; (B)
  the **index or group flush**: an index, sector ETF or leveraged ETF stretched down in a fear spike. (S) the short
  mirror: a stretched rally in a stock below its 200-day. The parabolic short and parabolic long stay separate setups
  with Bracco's burst rules. **[UCT; my proposal]**

### 8.2 The setup (long)

- **Prior trend (form A):** the stock is a leader: above its 200-day SMA (B26) and its 50-day the day before the flush,
  and up at least 25% in the prior 1-3 months (Bracco's FIGR and SNDK were fresh breakouts; IONQ +80% in 9 days).
  **[UCT; house rule B26; the 25% is my proposal]**
- **Prior trend (form B):** the index or ETF is in a correction; no 200-day requirement only if the owner rules it an
  exception (question 3). **[UCT; open]**
- **Stretch, at least two of:** (1) an intraday or daily drop of 2 ATR(14) or more from the prior close (Bracco's "-200%
  ATR"); (2) a close under the lower Bollinger band (20, 2) (Bracco, the app's detector); (3) RSI(2) under 5 (Connors);
  (4) 3 or more straight down closes (Stockbee's 3-4 days; Bracco's "4th down day"); (5) a drawdown of 40% or more in 10
  sessions for a post-blow-off name (Bracco, Kullamägi). Recommend counting them like Bracco's stars, not requiring one.
  **[source consensus on "stretched"; the count is my proposal]**
- **Not stretched enough (skip):** a slow, controlled decline without range or volume expansion (Bracco, 2026-03-08), or
  only the first or second down day (Bracco, 2026-11-01). **[UCT]**
- **Volume:** the flush day's volume at least 1.5x its 50-day average, ideally rising on each leg lower (Bracco's FIGR) or the
  highest on record (IGV, the most in its 26-year history). Note: Alvarez found the opposite for quiet RSI(2) dips; this rule is for the flush form
  only. **[UCT; 1.5x is my proposal]**
- **Location:** into a level a buyer can lean on: the prior breakout level or all-time high, a round number, the rising
  20 or 50-day, an open gap, an HVE level, a long-term support (Bracco; Kell's higher-time-frame support; the owner's NBIS).
  Not in the middle of a range (Raschke). **[source consensus]**
- **Liquidity:** close at least $10 and at least $20 million traded a day (B23); never more than 1% of daily volume (D42).
  **[house rule]**
- **Market:** best with fear: the VIX up fast toward 30 (Bracco), short-term breadth oversold (Bracco; Stockbee), the
  index also stretched down (KB 11061 summary). Nagel's measurement supports buying when the VIX is high. **[UCT; source
  consensus]**

### 8.3 The buy

- **Trigger: the turn, not the falling price.** Options: (a) intraday, after the washout, the first higher low and a
  reclaim of VWAP or of the prior day's low (Bracco's FIGR; Breitstein's "Right Side of the V"); (b) the next session's
  opening-range high or first green 5-minute candle (Kullamägi); (c) the close of the oversold day (Connors; the app's
  detector). **Recommend (a) or (b).** Bulkowski's dead-cat-bounce data (46% make a lower low the next day) and StockCharts' "can
  be early" both argue against buying the close blind. **[source consensus; my recommendation]**
- **Order:** market order (E57). **[house rule]**
- **Chase limit:** no more than 4% above the trigger price (C28). **[house rule]**

### 8.4 The stop

- **Where:** a few cents under the flush low, the low of the turn day (A3, F62; Kell; Bracco). **[house rule;
  originator]**
- **If the honest stop is more than about 3% away** (A13), size down so the dollar risk stays within the grade's percent
  (A5), or skip; never tighten it into the noise (A3). **[house rule]**
- **Gap through the stop:** B20 (the first 30-minute low is the new stop; out past 2R). **[house rule]**
- **Not recommended:** Connors' no-stop practice. It conflicts with A3 and D41. **[house rule]**

### 8.5 Trims, trail and time

- **Option 1 (house defaults):** a third at 3R, a third at 5R, trail the rest under the 10 or 21-day (B19, E51, E52).
- **Option 2 (the setup's own target):** sell at least a third at the first test of the target average (the 20-day SMA
  or 20 EMA for longs, as Kell and the detector narrative say; the 9 EMA for the parabolic short, Bracco), then breakeven
  stop, then trail the rest (E52) if it turns into a trend.
- **Recommend Option 2 for this setup only**, because every source targets an average and the bounce is short.
  In my check (section 4.4), with no stop the 20-day was touched within 10 sessions in 39-64% of oversold signals
  (88% for the leader flush); with the house stop, 3R came first in only 20-24%. A rough comparison: the two use
  different stop assumptions.
  **[source consensus; my proposal; owner question 4]**
- **Time stop:** if there is no close back above the flush day's high within 3 sessions, sell (Bracco's 1-3 days;
  Stockbee's 3-5 days). C33's 10 days stays as the outer limit. **[UCT; my proposal; question 5]**

### 8.6 What invalidates it

- A trade below the flush low (the stop). **[source consensus]**
- A second flush to a new low on heavier volume (the detector's narrative; Bulkowski's continued decline). **[house
  material; Bulkowski; my reading]**
- The bounce stalls and closes weak on day one or two (the detector's narrative "early warning"). **[my proposal]**
- The news behind the drop is a real change in the business (a guidance cut, fraud): Bulkowski's dead-cat bounce is the
  likely path. **[Bulkowski, a single source; my reading]**

### 8.7 The short mirror

- **Setup:** a stock below its 200-day SMA (B26, D47; Connors' short side) rallies hard into its declining 20 or 50-day:
  3+ straight up days, RSI(2) over 95 or a close 3 ATR or more above its 20-day, on a gap or range expansion.
  **[source consensus; house rule]**
- **Trigger:** the turn down (opening-range low, a VWAP failure: Kullamägi's short mechanics). Stop a few cents over the
  day's high (D47). Target the 5 or 10-day. Hard-to-borrow: skip (D48). **[originator; house rule]**
- **Above the 200-day:** only as a parabolic short with Bracco's burst checklist (B26). Bracco's own SOXL "mean reversion
  short" (2026-04-26) would not qualify unless it met that checklist. **[house rule; question 9]**

### 8.8 Best market conditions

- Longs: a fear spike in a market that was healthy (Bracco's "overreaction" in October 2025, with indexes just off highs);
  the VIX rising fast toward 30 (Bracco); breadth oversold (MMTW and S5FD: Bracco; T2108 is the posts' own breadth
  gauge; Stockbee's breadth); a Monday after a weak Friday (Bracco's "Monday Effect", an observation from four dated
  examples, one of them not a Monday; not measured). **[UCT]**
- Measured support: reversal returns rise with the VIX (Nagel, one study; portfolio-level, not chart setups). **[study, single source]**
- Worse: bear markets. Alvarez found returns negative in the 2020 and 2022 bear markets even for stocks above their
  200-day; in my check the below-200 versions lost heavily in 2020 (section 4.4); and the owner's own view is
  "below the 200SMA no participation is best". **[source consensus; UCT]**

### 8.9 Common mistakes (from the sources)

1. Buying the falling price instead of the turn (Bracco's "Right Side of the V"; StockCharts "can be early").
2. Buying the first or second down day (Bracco, 2026-11-01).
3. Calling a slow grind a capitulation: no range or volume expansion (Bracco, 2026-03-08; the detector's falling-volume
   veto).
4. Treating a band tag as a signal (Bollinger).
5. Fading a strong trend (Raschke: ADX over 32 and rising; two failures at a level first).
6. Holding a snapback as if it were a trend, or trimming it at 3R that never comes (Bracco 1-3 days; section 4.4).
7. Averaging down or re-buying the next red day (the detector narrative; A5; E56).
8. Getting whipped in and out on the same day (Bracco, 2026-08-02; E56).
9. Trading it in illiquid or hard-to-borrow names (B23, D48).
10. Mistaking a business-changing collapse for a stretch (Bulkowski's dead-cat bounce).

---

## 9. Grading (A+ versus B-)

Owner rule E50: grading is discretionary and no fixed checklist is taught as ours. These are the observable things the
sources reward, to guide judgement.

| Feature | A+ | B- |
|---|---|---|
| The stock | A leader fresh out of a base, the strongest group (Bracco: FIGR, SNDK) | A laggard or a broken stock below a falling 200-day |
| Stretch | Several extremes at once: 2+ ATR intraday drop, outside the lower band, 3-4 down days, RSI(2) under 5 (Bracco's 5 stars; the detector's 0-5 count) | One extreme only ("a single extreme on its own is just a bad day", detector narrative) |
| Speed | A cascade: no green 10-minute candles to the low (SNDK) | A slow, orderly decline (Bracco: "not nearly stretched down enough") |
| Volume | Rising on each leg lower; the most in months or years (FIGR, IGV) | Falling volume (the detector's veto) |
| Location | Major support: prior all-time high, round number, pivot, rising 20 or 50-day | Mid-range (Raschke) or no level |
| Market | VIX spiking toward 30, breadth oversold, index stretched too (Bracco; Nagel) | Index calm or in a steady bear market below the 200-day (Alvarez 2020, 2022) |
| Count | 4th down day or later (Bracco) | 1st or 2nd down day (Bracco, 2026-11-01) |
| Turn | A clear intraday reversal, VWAP reclaimed, a gap down that turns (Bracco; Kullamägi) | No turn yet; buying the close of the flush |
| Cause | Forced selling, deleveraging, an overreaction (Bracco, Nagel) | A business-changing collapse (Bulkowski's dead-cat bounce) |
| Positioning | Shorts crowded and loud (Bracco on IGV and ABAT) | Nobody short; dip buyers already crowded |

---

## 10. Questions for the owner

1. **One setup or a family?** (a) one "Mean Reversion" setup with forms A (leader flush), B (index flush) and the short
   mirror, beside separate Capitulation (34) and Parabolic setups; (b) fold it into Capitulation (34) and the parabolics
   and drop the tag; (c) keep only the journal tag. I recommend (a).
2. **Swing or intraday?** The tag sits in the Intraday group. (a) move it to Swing; (b) keep it Intraday; (c) both, with
   an intraday trigger and a 1-5 day hold. I recommend (c), filed under Swing.
3. **B26 and mean-reversion longs below the 200-day.** (a) not allowed, except a parabolic long (a burst down by Bracco's
   checklist mirrored); (b) allowed for indexes and leveraged index ETFs only; (c) allowed for any stock with a stretch
   score of 4 or 5. Your own words: "Generally, below the 200SMA no participation is best." I recommend (a) for stocks
   and (b) for indexes, if you want the TQQQ and SOXL trades taught.
4. **Trims.** (a) house defaults, a third at 3R and 5R; (b) at least a third at the first test of the target average
   (the 20-day for longs), then breakeven, then trail; (c) all out at the average. I recommend (b): every source
   targets an average, and in my check 3R came before the stop in only about one oversold signal in five.
5. **Time stop.** (a) C33's 10 days; (b) 3 sessions without a close above the flush day's high; (c) 5 sessions. I
   recommend (b).
6. **The stretch measure.** Which numbers do we teach? Options: the % ATR move from the prior close (Bracco's 200%);
   RSI(2) under 5 (Connors); a close under the lower band; distance from the 20-day in ATRs (the old template's 3 ATR);
   the ATR% multiple from the 50-day (Jeff Sun). I recommend a star count of the first three plus the down-day count.
7. **The entry.** (a) the intraday turn (VWAP reclaim, first higher low); (b) the next session's opening-range high; (c)
   the flush close (the detector). I recommend (a) or (b), with (b) as the version the course can show on daily charts.
8. **Stops wider than 3%.** (a) size down and take it; (b) skip; (c) use the 2-ATR stop Alvarez found best. I recommend
   (a), per A5 and A3.
9. **Mean-reversion shorts above the 200-day.** (a) only parabolic shorts (B26 as written); (b) also stretched
   leveraged ETFs like Bracco's SOXL idea (2026-04-26). I recommend (a).
10. **Volume.** Require expansion on the flush (Bracco, Kell) or not (Alvarez's quiet dips)? I recommend require it for
    form A and B.
11. **Red and Orange markets.** D46 says a Red market is cash plus shorts. Is a mean-reversion long allowed there? (a)
    no; (b) yes, A+ only and at reduced size; (c) yes for the index form only. Your call; Bracco's index examples (March
    and June 2026) came in weak markets.
12. **The Model Book "Parabolic Long" card** describes riding a parabola up, not a burst down. Change it to match your
    B26 ruling?
13. **The capitulation detector's liquidity floor** ($2, $10,000 a day) is below B23. Raise it to $10 and $20 million?
14. **The voice KB line "Win rate drops 15-20% in chop vs trend"** has no source and is in the recall bank. Remove the
    number, or keep it with a source?
15. **RS for the stock form.** C31 exempts mean reversion. Bracco's stock version is in leaders. (a) no RS rule; (b) a
    leader requirement (RS 80+ before the flush). I recommend (b) for form A.

---

## 11. Sources

All read on 2026-11-09. Reliability: **originator** = the person who named or teaches the method; **educator** = an
established educator or data provider; **study** = peer-reviewed research or a research data library; **practitioner
test** = a named trader's published backtest; **house** = UCT's own material.

**UCT (house)**
- Account rulebook, `docs/study/sizing_rule.md` section 9; trade plans, `docs/study/TRADE_PLANS.md`; owner verdict log,
  `docs/study/audits/2026-10-24/owner_verdicts.jsonl` line 568 (C31) and the 2026-11-09 rulings at the end. House, primary.
- UCT Substack, https://unchartedterritoryy.substack.com: all 103 posts in the sitemap, fetched through Substack's public
  post API on 2026-11-09 and searched by script; posts quoted are linked in sections 1, 3 and 6. House, primary.
- Bracco, "The Parabolic Short", 2025-06-13, https://unchartedterritoryy.substack.com/p/the-parabolic-short. House.
- Brain KB extracts, `docs/study/levels/brain_kb_2026-11-06.json` (row 11061), `brain_kb_cycle_2026-11-06.json` (rows
  10707, 12095). House; mostly summaries, with the trader's own words where the file marks them.
- Code: `api/services/pattern_engine/detectors/uct/uct_capitulation.py`, `uct_setups_common.py`, `parabolic_short.py`;
  `api/services/pattern_engine/detectors/registry.py`; `api/services/setup_tags.py`;
  `api/services/pattern_engine/tag_textbook.py`; `api/services/pattern_engine/primitives/liquidity.py`;
  `api/services/chart_iq/engine/v2_setups.py`; `api/services/strategy_templates.py`;
  `api/services/wisdom/archive/ask_setup.py`; `api/services/uct_agent/coach/setups.py`;
  `api/data/voice_kb/trading_principles.json`. House.
- App: `app/src/constants/setupGroups.js`, `app/src/pages/modelbook/setupCatalog.js`. Docs: `docs/study/UNITS-method.md`,
  `docs/study/bank/recall.principles.json`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`,
  `docs/superpowers/research/setups/setup_criteria.json` (reports the brain template; not verified by me). House.

**Originators**
- Kristjan Kullamägi, "3 TIMELESS setups that have made me TENS OF MILLIONS!", qullamaggie.com, 2021-01-08 (updated
  2021-04-28), https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/. Originator; read in full.
- Pradeep Bonde, Stockbee blog: https://stockbee.blogspot.com/2010/01/7-concepts-that-can-make-you-better.html
  (2010-01-07); .../2018/08/big-ideas-around-which-you-can-develop.html (2018-08-10); .../2019/04/big-ideas-around-which-you-can-build.html
  (2019-04-30); .../2008/10/how-to-play-bounce.html (2008-10-12); .../2011/08/how-to-use-market-breadth-to-avoid.html
  (2011-08-08); .../2006/07/mean-reversion-time.html (2006-07-17); .../2012/10/mean-reversion-methods-indicate-bounce.html
  (2012-10-24); .../2014/01/swing-trading-using-momentum-bursts.html (2014-01). Originator of his own methods; a
  commentator on mean reversion.
- Oliver Kell, "Reversal Extension: How Stocks Bottom", TraderLion, 2024-06-11, archived 2025-08-20,
  https://web.archive.org/web/20250820211726/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/ ;
  "Exhaustion Extension", 2024-08-11, archived 2025-01-22,
  https://web.archive.org/web/20250122070523/https://traderlion.com/technical-analysis/chart-patterns/exhaustion-extension-sell-into-strength/ ;
  "Cycle of Price Action", 2024-09-10, archived 2025-06-23,
  https://web.archive.org/web/20250623154156/https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/ .
  Bylined Oliver Kell; originator.
- Linda Bradford Raschke, interviews posted on https://lindaraschke.net/articles/ : "The Discerning Trader" (Stocks &
  Commodities V.11:9, Thom Hartle, recorded 1993-06-18), https://lindaraschke.net/wp-content/uploads/2026/01/Discerning-trader.pdf ;
  AIQ Opening Bell, August 1997 (David Vomund), .../august1997.pdf ; Active Trader, February 2004, .../raschke0204.pdf .
  Originator, in interview form.
- John Bollinger, "Bollinger Bands Explained. Rules to use Bollinger Bands successfully",
  https://www.bollingerbands.com/bollinger-band-rules . Originator of the bands.
- Lance Breitstein, Chat With Traders episode 236 show notes, https://chatwithtraders.com/236 . Show notes only; his words
  not available in text.

**Educators and data sources**
- StockCharts ChartSchool, "RSI(2)",
  https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2 . Educator;
  restates Connors; read in full.
- Investor's Business Daily, "The 200-Day Line Can Serve As The Last Line Of Defense", 2014-04-17, via Yahoo Finance,
  https://sg.finance.yahoo.com/news/200-day-line-serve-last-220100598.html . Read through WebFetch only (plain download
  refused); no byline shown.
- jfsrev, "ATR% multiple from 50-MA", TradingView, 2023-06-27, https://in.tradingview.com/script/oimVgV7e-ATR-multiple-from-50-MA .
  Read through WebFetch only. Bracco credits the method to Jeff Sun (@jfsrevg); not confirmed on Jeff Sun's own page.
- Thomas Bulkowski, "Dead-Cat Bounce", https://thepatternsite.com/dcb.html , and "Inverted Dead-Cat Bounce",
  https://thepatternsite.com/idcb.html . Read through WebFetch only. **The site prohibits use to train AI systems**; read
  and cited here with links and short quotes only. Measured statistics, no sample size given.

**Studies and practitioner tests**
- N. Jegadeesh, "Evidence of Predictable Behavior of Security Returns", *Journal of Finance* 45(3), July 1990, 881-898,
  doi:10.1111/j.1540-6261.1990.tb05110.x ; abstract read through the Crossref API (Wiley's page refused the download).
  Study.
- W. De Bondt and R. Thaler, "Does the Stock Market Overreact?", *Journal of Finance* 40(3), July 1985, 793-805,
  doi:10.1111/j.1540-6261.1985.tb05004.x ; abstract via Crossref. Study.
- B. Lehmann, "Fads, Martingales, and Market Efficiency", NBER Working Paper 2533, March 1988,
  https://www.nber.org/papers/w2533 ; abstract read. Study (published in the *Quarterly Journal of Economics* 105(1),
  1-28, February 1990, per the NBER page; not read there).
- S. Nagel, "Evaporating Liquidity", NBER Working Paper 17653, December 2011, https://www.nber.org/papers/w17653 ;
  abstract read. Study (published 2012 in the *Review of Financial Studies*).
- Kenneth R. French Data Library, "Short-Term Reversal Factor (ST_Rev)", monthly file built from the 202609 CRSP
  database, https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_ST_Reversal_Factor_CSV.zip , and its detail
  page https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_st_rev_factor.html . Research data;
  the period averages in section 4.1 are my arithmetic.
- Cesar Alvarez, alvarezquanttrading.com (read through the site's public post API):
  .../blog/how-is-mean-reversion-doing-dead-shrinking-or-doing-just-fine/ (2019-03-13);
  .../blog/mean-reversion-check-up-2022/ (2022-10-24); .../blog/volume-and-mean-reversion/ (2022-12-07);
  .../blog/stop-losses-and-profit-targets-plus-happy-birthday-excel/ (2015-09-30);
  .../blog/adding-stops-and-scaling-out-to-a-mean-reversion-strategy/ (2016-03-16);
  .../blog/mean-reversion-and-the-broken-rubber-band/ (2016-06-17);
  .../blog/mean-reversion-entry-at-open-vs-intraday-pullback-vs-confirmation/ (2021-08-25);
  .../blog/avoiding-trades-before-earnings/ (2019-04-24);
  .../blog/mean-reversion-vs-trend-following-through-the-years/ (2024-01-24); bio page https://alvarezquanttrading.com/bio/ .
  Practitioner tests by the co-author of the Connors book; rules published, results tables are images I could not read.

**My own check**
- `tools/measure_mr3.py` and its log in my scratch folder, on the local sandbox daily bars (survivorship-biased; not
  committed). Section 4.4.

**Not used**
- Forum posts, AI-written strategy pages and indicator marketplaces that surfaced in searches (for example skill
  marketplaces and strategy blogs restating RSI(2)). A pirated PDF of *Street Smarts* linked from an older internal file
  was not opened.

---

## 12. Cold check (2026-11-09): what was confirmed, fixed and removed

**Confirmed.** All of the draft's 314 quoted spans were found word for word in freshly fetched copies of their sources (the two
Unicode-hyphen cases in the Crossref abstracts as disclosed at the top). Every Substack quote sits under the section the
dossier credits it to (Bracco's sections, the owner's "TSDR's Weekly Outlook & Watchlist" / "Patrick (TSDR)'s Weekly
Outlook & Watchlist", the unsigned "Index & ETF" and intro passages, "Thoughts on the Market", "Manrav - SMTC CRWV").
The post dates, the weekday claims (FIGR Monday 2026-01-12; SNDK "Thursday, January 8th"; UAMY/USAR/ABAT Friday
2025-10-17; ETH Friday 2025-10-10 after hours; SOXL Friday 2026-06-05; IGV Tuesday 2026-02-03) and the "evening post,
next-day UTC date" rule all hold. The French ST_Rev period table was recomputed from the downloaded file and every
number agrees. The section 4.4 table was compared line by line with the script's log and agrees. The detector summary in
section 5.2 matches `uct_capitulation.py`, `tag_textbook.py`, `liquidity.py` and `registry.py`; the Chart IQ, backtest
template, journal tag, Model Book card, vocabulary, coach list, archive mapping and voice-KB claims match the files
named. The Bulkowski statistics and the anti-AI notice were re-read through WebFetch and match. Bracco's parabolic-burst
checklist, his credit to Lance Breitstein and the "@jfsrevg and @RealSimpleAriel" credit are in the post as described.
The three KB rows (10707, 11061, 12095) say what the dossier says they say.

**Fixed (wording that did not match its source).**
1. StockCharts does not "recommend readers build a stop anyway"; it warns about outsized losses, suggests a trailing
   stop or Parabolic SAR, and says "Chartists need to decide for themselves" (section 3.3).
2. "Connors' director of research" came only from an older internal file; Alvarez's own bio says "professional market
   researcher for Connors Research and TradingMarkets.com" and "primary researcher and co-author" of the book
   (section 3.4). The 2003 quote is now tied to its post (2024-01-24).
3. "I want to be clear that I am not saying one should trade mean reversion without stops" is from the 2015-09-30 post,
   not the 2016-03-16 post it followed (section 3.4).
4. Alvarez's exits in the posts read are RSI(2) over 30 or 70 (and the 5-day average); "80" appears only as his
   overbought threshold in the 2024 index study, so it was dropped from the exit list (section 3.4).
5. The "2-3 days" given for Raschke's horizon had no source in the dossier; it is now quoted from the 1993 interview
   ("short-term timeframe, two to three days") (sections 3.5, 3.13).
6. The blind-judging score 2.89 is in the header of `tag_textbook.py`, not of the detector file (section 5.2). The
   falling-volume veto applies to the setup-day variant only; the `gap_below` variant has no veto (section 5.2).
7. "The signals were fixed before the first run" was true of the six mechanical signals and the control only; the LF
   and RB stand-ins were added in the script's third version, after results had been seen (section 4.4).
8. "Bracco rejects 'linear' stair-step moves": his post contrasts a parabolic curve with a "linear" one of "steady,
   consistent price movement"; "stair-step" was the writer's word (section 1 table).
9. Lehmann's and Nagel's published versions are named on the NBER pages themselves (QJE 105(1), February 1990; RFS
   25(7), 2012), so "not checked" and "per its RePEc listing" were replaced (sections 2, 4.1, 11).
10. The TradingView page carries the formula and the tags "jeffsun", "jeffsuntrading", "jfsrevg", which support
    Bracco's Jeff Sun credit; the dossier's doubt was narrowed to "not confirmed on a page of Jeff Sun's own" (section 3.9).
11. T2108 is the posts' standing breadth gauge, not a Bracco attribution; MMTW and S5FD are his (section 8.8). One of
    the four "Monday Effect" dates (March 24, 2022) was a Thursday (sections 6.2, 8.8).
12. The Connors book's year is given with its hedge (first printing November 2008; some copies carry a 2009 copyright).
13. Three basis tags in section 8 read "[source consensus]" on one outside source (a second flush on heavier volume;
    a business-changing collapse; Nagel's VIX finding); each now names its single source. The "Related dossiers" note
    now points to dossiers 38 and 39 for the parabolic long and short.

**Added.** Bracco's own description of a capitulation bottom (2025-11-16), his "rubber band / capitulation long" on
ETHA/ETHU (2025-11-05), the USO mean-reversion short he would not front-run (2026-04-05), two more index versions
(2026-06-14, 2026-07-05), the NCLD trade that "only got one day of glory" (2026-10-25), his "overreaction" reading
(2025-10-12), the FIGR trigger in his words, and the owner's TQQQ follow-through and SNDK "dead cat bounce" passages
(2026-04-05, 2026-07-19). Alvarez's bio page was added to the sources.

**Removed in checking.** No quote had to be removed: every quoted span was found on its page. The statements removed as
unsupported were the "recommends readers build a stop anyway" reading of StockCharts (item 1), the exit threshold "80"
(item 4), "director of research" stated as fact (item 2), "stair-step" (item 8), and the unqualified "signals were fixed
before the first run" (item 7); each is replaced by the sourced wording above.

---

## 13. Examples (from our data)

Numbered 13 because section 12 of this dossier is already the cold check. Scan, hits and charts:
`_study-resume/scratchpad/setups/36-mean-reversion/` (`scan_mr.py`, `final/hits.json`, `chart_mr.py`, `final/01..10_*.png`,
`final/sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`). Daily bars only; no intraday turn, VWAP, VIX or breadth
filter was available to the scan, so it is a daily-bar proxy of section 8, not the full rule.

**The scan's rule (one paragraph).** Universe: the 2,630 names that ever met the liquidity rule (B23), each hit requiring a
close of $10 or more and a 50-day average of $20 million traded; window 2000-01-05 to 2026-11-06, one hit per name per
5 sessions. *Long (the leader flush):* the day before the slide began the stock closed above its 50-day and 200-day SMA
and was up at least 25% from its 63-day low; the flush day F closed down, above the 200-day, on volume at least 1.5x its
50-day average, with at least two of the five stretch marks from section 8.2 (a 2 ATR(14) drop from the prior close to
the day's low; a close under the lower Bollinger band 20,2; RSI(2) under 5, computed with simple averages, Cutler's form;
3 or more straight down closes; a close 40% or more under the 10-session high). *The turn:* the next session trades above
the flush close while still above the 200-day; the entry is that session's open if it gapped above the flush close,
otherwise the flush close plus a cent (a market order at the reclaim, E57), skipped if the entry is more than 4% above
the flush close (C28). *Stop:* five cents under the lower of the flush low and the turn-day low (A13, F62), skipped if
wider than 7%. *Short (the mirror, D47, B26):* the pop day closed up, below the 200-day, with the 50-day under the 200-day,
volume 1.5x, at least two of the mirrored marks (a 2 ATR pop, a close over the upper band, RSI(2) over 95, 3+ straight up
closes, a close 3 ATR over the 20-day), and the day's high at or above 98% of the lower of the 20 and 50-day (a loose
"into the declining average"); the turn is the next session trading under the pop close, entry at the open if it gapped
under, otherwise the pop close less a cent; stop five cents over the higher of the pop high and the turn-day high.
*Outcome:* from the day after entry, the first of the stop, 3R and 5R within 20 sessions; a day that touches both the
stop and a target counts as stopped.

**Base rate.** 28,741 hits (11,227 long, 17,514 short) over 2,630 of 2,630 liquid names, 2000-2026: **29.8% reached 3R
and 17.9% reached 5R before the stop** (long 29.8 / 18.0; short 29.7 / 17.9); 75-77% were stopped within the 20
sessions. This is a fixed stop with no trims, no breakeven move, no time stop and no 20-day target, so it understates the
setup as section 8.5 would trade it (Option 2 sells into the first test of the average) and overstates the stop rate for
a trader who exits on the 3-session time stop. Three things the numbers say: (1) a tighter honest stop helped, with the
3R rate 37.3% long and 34.4% short when the stop was 3% or less (A13); (2) the stretch count did NOT separate winners on
daily bars (long: 2 marks 30.2%, 3 marks 28.9%, 4 marks 28.5%, 5 marks 3 of 4), so on this proxy the count describes the
stretch but does not predict the bounce; (3) by year the long 3R rate ran 21% (2008) to 46% (2000), with 2018, 2022 and
2023 in the low 20s, which fits section 8.8's warning about bear markets. Section 4.4 measured 20-24% to 3R with a
different stop and signal set; the two are not comparable line by line.

**The 10 examples.** Six leader flushes, four short mirrors, one per name, ten different years. Each chart shows the box
from the day before the slide (or rally) to the flush (or pop) day, the "flush/pop" and "turn" marks, the buy or short
line, the stop, 3R and 5R, the 10 and 20-day EMA and the 50 and 200-day SMA. "Best R" is the best excursion within 20
sessions before the stop; the report dates come from `earnings_reaction_days` (complete from about 2005).

| # | Ticker, turn day | Side | Structure | Buy / stop (R) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|
| 1 | GRMN 2006-06-14 | Long | after +26% in 3 months, 4 down days, -13.3% slide to 9.8% under the 50-day, flush 2.2 ATR on 2.5x volume, RSI(2) 0, 4/5 marks | 41.78 / 40.26 (3.7%) | 8.5 | The flush day's low undercuts the rising 50-day and the next day reclaims it; back at the 20-day in two sessions and the trend resumes. The stop is a little over 3%: size down (A13). No report found in the window (the report dates are thin before 2005). |
| 2 | EQT 2011-08-09 | Long | after +32%, 5 down days, -25.2% slide in the August 2011 market sell-off, flush 2.2 ATR on 2.0x volume, RSI(2) 0, 4/5 marks | 26.76 / 26.00 (2.8%) | 9.3 | Form A inside a fear spike (section 8.8): a leader loses a quarter of its value in five sessions and the flush day closes on the rising 200-day (close 26.21, the average 26.20, low 26.05); the turn day closes near its high and 3R prints the next day. No report found in the window. |
| 3 | LITE 2016-11-01 | Long | after +46%, 5 down days, -20.5% slide to 15.7% under the 50-day, flush 2.5 ATR on 3.5x volume, RSI(2) 0, 4/5 marks | 33.61 / 32.85 (2.3%) | 11.7 | A fresh leader's post-report slide (report 2016-10-27, two sessions before the flush) ends in a volume climax at the 50-day's neighbourhood; the turn day's follow-through pays 3R the next session, the bounce then chops under the 20-day for a week, and the stock runs to new highs inside 20 sessions (11.7R). Shows why Option 2 takes a third into the first average. |
| 4 | ACMR 2020-09-09 | Long | after +79%, 3 down days, -38.6% slide, 39% under the 10-session high, flush 3.5 ATR on 3.5x volume, RSI(2) 0, 5/5 marks | 20.00 / 19.29 (3.5%) | 8.1 | The post-blow-off form (mark 5): a parabolic run breaks and loses 39% in three sessions on the heaviest volume of the chart, then bounces to the 20-day. The later chart is sideways: this is a 1-5 session trade, not a trend. No report found in the window. |
| 5 | KRYS 2023-08-08 | Long | after +59%, 4 down days, -17.9% slide to 12.6% under the 50-day, flush 3.3 ATR on 4.0x volume, RSI(2) 0, 4/5 marks | 109.13 / 106.88 (2.1%) | 9.2 | An earnings flush (report 2023-08-07, the flush day, which closed near its low at 108.51): the turn day opens above the flush close, runs through the flush day's open and closes at 3R; 5R prints two sessions later. A clean "overreaction" 13% under the rising 50-day in a stock still 20% above its 200-day. |
| 6 | JXN 2024-08-06 | Long | after +29%, 3 down days, -24.5% slide, flush 2.5 ATR on 2.6x volume, RSI(2) 0, 4/5 marks | 69.43 / 66.48 (4.3%) | 7.0 | The 2024-08-05 market-wide flush: the whole slide is three sessions, the low undercuts the 50-day by 14% but stays far above the rising 200-day, and the stock is back above its 10 and 20-day in three sessions and near its prior high in two weeks. The honest stop is 4.3%: size down or skip (A13). No report found in the window. |
| 7 | UA 2017-04-28 | Short | 26.8% under the 200-day, 50-day under the 200-day; 4 up days, +14.1% rally, pop 3.7 ATR on 3.9x volume into the declining 50-day, RSI(2) 100, 5/5 marks | 19.70 / 20.05 (1.8%) | 7.1 | The mirror: a broken stock pops on its report (2017-04-27) into its falling 50-day, fails the next day and bleeds back to the 10-day and lower. Stop over the pop high; 3R in two sessions. |
| 8 | NUS 2019-05-02 | Short | 3.7% under the 200-day; 7 up days, +34.0% rally, pop 6.6 ATR on 4.9x volume to the declining 50-day, RSI(2) 100, 5/5 marks | 64.31 / 64.95 (1.0%) | 29.2 | The best stretch in the set: a seven-day, 34% rally that ends with a post-report gap (report 2019-04-30 after the close) straight into the declining 50 and 200-day; the next day's reversal never looks back. A 1% stop is why the R count is so high. |
| 9 | IOT 2025-09-08 | Short | 2.2% under the 200-day; 3 up days, +20.8% rally, pop 4.1 ATR on 4.2x volume to the declining 200-day, RSI(2) 100, 5/5 marks | 42.08 / 42.92 (2.0%) | 7.5 | A report gap (2025-09-04 after the close) that tags the declining 200-day on 4x volume; the turn is the next session's break of the pop close, 3R in one day, and the stock drifts back to its 20-day over the following weeks. |
| 10 | FMC 2026-09-03 | Short | 1.3% under the 200-day; 4 up days, +26.3% rally, pop 2.8 ATR on 1.6x volume straight into the declining 200-day, RSI(2) 100, 5/5 marks | 13.30 / 13.51 (1.6%) | 23.7 | Four straight up days into the 200-day, rejected the next day; the stock then loses more than half its value over the next six weeks. Volume on the pop was the lightest in the set (1.6x), near the rule's floor. No report found in the window. The price ($13) still clears B23's $10. |

Five of the ten extremes (LITE, KRYS, UA, NUS, IOT) were earnings reactions and five were not; the dossier's rules do not
distinguish them, and this set does not show that one kind bounces better. The owner may want a ruling (section 10).

**Notable failures (from the same hits; charts in `final/fails/`).**

- **ELF 2024-04-04, long, 0R.** Eight straight down closes (-21% after a +58% run) ended with a 2.2 ATR flush on 3x
  volume under the 50-day, RSI(2) 0: four marks. The turn day reclaimed the flush close and closed red; the stop
  (2.2%) was hit the next session. The stock did bounce for two weeks after that, but the trade was a full loss. Lesson: an eight-day slide through the 50-day
  on a stock that had just made a parabolic top is a broken leader, not a stretched one (section 8.9, mistakes 3 and 10).
  No report in the window.
- **NFLX 2022-07-21, short, 0R.** A post-report gap (report 2022-07-19 after the close) up 24% in four days on 4.9x
  volume, 47% under the 200-day, RSI(2) 100: four marks. The next day traded under the pop close, the short triggered,
  and the stock never came back; it climbed for the next month. Lesson: a report gap that changes the story is an
  earnings gap (dossier 21), not a stretched rally in a dead stock; the honest stop was also 4.9%, over A13.
- **IONQ 2026-04-16, short, 0R.** A 54% rally in four days on 4.2x volume to 7% under the 200-day, 5/5 marks. The turn
  day dipped under the pop close, the short triggered with a 5.2% stop, the stop was hit the next session, and the stock traded
  above $60 within five weeks. Lesson: section 8.9, mistake 5, fading a strong momentum burst; a four-day 54% move is the
  parabolic family (dossier 38), not the mean-reversion short.
- **DASH 2024-05-03, long, 0.2R.** A report flush (2024-05-01 after the close) of 3.2 ATR on 6x volume, 17.5% in three
  days after a +27% run, four marks; the turn day reclaimed and failed. Lesson: the honest stop was 6.4%, double A13's
  guide, and a report-driven drop in a name still well under its high had no level to lean on (section 8.2, location).

---

## 14. Failures and near-misses (from our data)

Built 2026-11-10 from the same `final/hits.json` as section 13 (`charts.py`, `near_scan.py` in the scratch folder
`_study-resume/scratchpad/setups/36-mean-reversion/`). The failures are hits that passed every gate of the criteria
card (stop 3% or under, no report inside the slide, the turn the next session) and were stopped before 3R; three leader
flushes and one short mirror, four different years. The near-misses come from `near_scan.py`, which re-runs the long
rule of section 13 with one gate relaxed at a time (stretch marks, volume, prior trend, the 200-day) and keeps only the
hits the strict rule rejects for that one criterion. Charts: `final/fail_1.png` to `fail_4.png` (sheet `fail_1-4.png`),
`final/near_1.png` to `near_4.png` (sheet `near_1-4.png`), and the confusable pair `final/pair_34-capitulation.png`
(JXN 2024-08-06 above ALGM 2023-04-28 from the capitulation set). Buy or short, stop, 3R and 5R are drawn exactly as
on the winners. All numbers are read off the daily bars.

**Failures (every gate passed, stopped before 3R).**

| # | Ticker, turn day | Side | Buy or short | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | ELF 2024-04-04 | Long | 165.90 | 162.24 (2.2%) | day 1, 2024-04-05, low 160.61 | eight down days, -21.2% after a +58% run, a 2.2 ATR flush on 3.0x volume, 4/5 marks. The turn day traded above the flush close but closed 162.53 in the bottom 3% of its range, under the flush close (163.77); the next session took the stop. | mr.inv_stall |
| 2 | ILMN 2018-10-08 | Long | 320.55 | 311.69 (2.8%) | day 2, 2018-10-10, low 296.28 | five down days, -11.2% after +34%, a 2.4 ATR flush on 2.2x volume, 4/5 marks. The second session after the turn was the 2018-10-10 market break: a new low under the flush low on heavier volume than the flush day. 278.35 inside 20 sessions. | mr.inv_second_flush |
| 3 | SBUX 2025-03-07 | Long | 105.48 | 103.39 (2.0%) | day 1, 2025-03-10, low 99.80 | four down days, -9.4% after +34%, a 2.6 ATR flush on 1.6x volume, 4/5 marks, the low just above the rising 50-day. Day 1 closed 101.13 in its lower quarter while the index made a new low and closed under its 200-day (SPY 560.58 against 571.99); 81.30 inside 20 sessions. | mr.inv_stall, mr.bear_market |
| 4 | AAL 2016-07-13 | Short | 34.65 | 35.34 (2.0%) | day 1, 2016-07-14, high 36.19 | the mirror: 10.7% under the 200-day, four up days, +23.1%, a 2.4 ATR pop on 2.2x volume, 5/5 marks. But the 50-day (31.17) was 10% under the price and rising: the stock had been climbing off its late-June low, not a dead stock popping into a declining average. 36.74 inside 20 sessions. | mr.short_setup |

**Near-misses (one gate fails, everything else passes).**

| # | Ticker, turn day | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| 1 | META 2024-07-15 | mr.stretch_count | 1 of 5 marks (RSI(2) 0 only; the drop 1.2 ATR, 2 down days); the rule needs 2 | a two-day dip of 7.6% to the 50-day on 1.6x volume in a leader up 29%: an ordinary moving-average pullback (12-ma-pullbacks), not a flush. Stopped the next day. |
| 2 | AMZN 2024-04-22 | mr.volume | flush-day volume 1.4x the 50-day average; the rule needs 1.5x | six down days drifting 8.3% through the rising 50-day on light volume, 3/5 marks (band, RSI(2), 3 down closes): the moving-average pullback family, without the volume climax a flush needs. Stopped on day 3. |
| 3 | META 2021-09-21 | mr.prior_trend_a | up 15% from the 63-day low before the slide; the rule needs 25% | four down days, a 2.1 ATR flush on 1.5x volume, 4/5 marks, above both averages, but no leader's run behind it: a stock rolling over from a top (317.37 inside 20 sessions, 11% under the buy). Stopped the next day. |
| 4 | LLY 2025-03-11 | mr.prior_trend_b (B26) | the flush closed 3.0% under the 200-day SMA (855.47) | a leader up 28% that slid 11.2% in three days to just under its 200-day, 2/5 marks: a below-200 flush that is not a parabolic long (no burst, no 40% fall), so B26 says watch only. Stopped on day 2. |

**What the failures have in common.** Three of the four were stopped on the first session after the turn and the
fourth on the second; in every long case the entry session or the next one closed weak (ELF in the bottom 3% of its
range, SBUX in its lower quarter) or the market itself broke (ILMN into 2018-10-10, SBUX into the March 2025 correction
with the index under its 200-day). The flush-day numbers were not the problem: all three longs had 4 of 5 marks and a
2.2 to 2.6 ATR drop. What was missing was the turn holding: section 8.3's time stop (no close back above the flush
day's high within 3 sessions, sell) would have taken all three out for less than the stop. The short failed for the
opposite reason, a rising 50-day under the price, the sign that the rally was a new uptrend and not a dead stock
bouncing into a declining average.
