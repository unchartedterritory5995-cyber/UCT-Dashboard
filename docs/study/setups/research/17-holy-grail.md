# Setup 17: Holy Grail (Linda Raschke), long and short

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote was
copied from the page, PDF or file named next to it and then checked word for word, by script, against a saved copy of
that source. Two exceptions are marked where they occur: one magazine is a scanned image (I typed its quotes from the
page image and checked them by eye), and one site blocks plain downloads (its quotes come from two separate reads with
the web tool, which agreed). Quotes keep the writer's own spelling. Where I could not read a source, I say so and give no
wording from it.

**Cold check, 2026-11-09.** A second reader re-downloaded every source named here, re-read the scanned magazine page by
page, re-ran the scanner check and re-searched all 103 UCT posts. Every quote was found word for word. What was wrong,
overstated or missing was fixed in place; the list is at the end, under "Removed in checking".

**Who is who in UCT quotes.** The owner is Patrick (TSDR). He writes the "TSDR's Weekly Outlook & Watchlist" and "TSDR
Trading" sections of UCT's Substack. Bracco writes "Bracco's Breakdown & Top Ideas". The intros and the "Index & ETF"
sections are not signed; I mark them *unsigned*. Contributors (ChartMaster, Viotti and others) have their own signed
sections in "The Rest of the Week". Dates are the Substack post dates.

**Tags used in section 8.** **[originator]** Raschke's own words; **[source consensus]** several outside sources agree;
**[UCT]** the owner, Bracco or a signed UCT contributor; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change;
**[book, unverified]** a rule other people say is in *Street Smarts*, which I could not read; **[Woods]** one outside
educator (section 3.7), not a consensus. No line in section 8 carries [source consensus]: on the points that matter the
outside sources either repeat Raschke or disagree with her.

**Related dossiers.** `11-ema20-pullback.md` (the owner's own 20 EMA pullback) and `12-ma-pullbacks.md` (the 10, 50 and
200-day lines). The Holy Grail is the 20 EMA pullback with one extra filter (a strong-trend reading on the ADX) and a
*first pullback after a momentum burst* timing rule. Where this dossier and dossier 11 overlap (the line, the trigger,
the stop), one ruling from the owner should settle both. Section 10, question 1 asks whether the Holy Grail should be its
own setup at all.

**The short answer.**
1. The rules are Raschke's and they are short: the 14-period ADX "must initially be greater than 30 and rising"; price
   pulls back to the 20-period exponential moving average; when it touches, a buy stop goes above the high of the
   previous bar; the stop is the "newly formed swing low"; trail as it works; "sells are reversed". (Section 3.1.)
2. Nobody has published a measured win rate for it that I could find. The 60-65% win rate our scanner's text gives
   "Raschke's published data" has no source I could find. (Sections 4 and 5.)
3. UCT's people never use the name. The owner trades the same picture without the ADX: the first pullback to a rising
   20 EMA in a leader, stop at the day's low. (Section 6.)
4. Our scanner (`holy_grail.py`) tests something close but not the same, uses a home-made ADX that read 29.9 (a hair
   under its own gate of 30) on a choppy test chart where the app's own textbook ADX reads 17.7, adds a volume rule and an ATR-wide stop Raschke never used, and has no short side.
   It is not in the Model Book, the journal tags or Study's trade plans. (Section 5.)

---

## 1. What it is

A stock (or any market) is in a strong, young trend, strong enough that the 14-day ADX has pushed above 30. It makes its
first pullback to the rising 20-day exponential moving average; when it turns back up through the prior bar's high you
buy, with a stop under the low the pullback just made.

**The market psychology.** These points are reasoning drawn from Raschke's own words, not measured facts.
- **A new momentum high tends to get retested.** Raschke: "This pattern takes advantage of the fact that the odds are
  very high that when a security makes a new momentum high and pulls back, it will retest its recent high." ([AIQ
  Opening Bell, Aug 1997](https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf)) And, in 1998: "So anytime
  you have a new high or new low, you would want to be looking to buy the pullback to at least see if there’s a test, if
  not another leg." (Omega Research Magazine, Spring 1998, scanned page)
- **Two outcomes, both tradeable.** A test of the high (a small win) or a new leg (a big one). Her 2004 exit, "look to
  exit on a push to new highs", plays for the first; trailing the stop plays for the second. ([Active Trader, Mar
  2004](https://lindaraschke.net/wp-content/uploads/2026/03/raschke_pt2_0304.pdf))
- **The 20-period average is where value sits in a trend.** Raschke: "I like looking at a 20-period moving average
  because that represents to me a value area or a mean or a regression-to-the-mean type of thing." And: "I look at that
  as a basic support/resistance level in a trending market. It means nothing in a sideways market, but in a trending
  market, I use it as my support/resistance level." (Omega Research Magazine, Spring 1998, scanned page) Buyers who
  missed the run wait for it; holders who are up defend it.
- **Why the ADX filter.** The ADX measures how strong a trend is, not its direction. Raschke: "This pattern uses Welles
  Wilders ADX (Average Directional Index), which measures the strength of a trend over a period of time." (1997; the
  apostrophe is missing in the PDF's text.) A strong reading says the move is a real trend, so the pullback is a pause,
  not a top. In 1993 she gave what she called "something of a golden rule" against fighting such a trend: "I will not
  try to trade against a market where the ADX is above 32 and rising." ([S&C V.11:9, 1993](https://lindaraschke.net/wp-content/uploads/2026/01/Discerning-trader.pdf))
- **Who is trapped.** Traders who sold or shorted the pullback expecting a top are wrong-footed when price takes out the
  prior bar's high; their buying back adds fuel. Raschke on her side of that: "Most people hesitate to buy pullbacks
  because a top may be in place." (1997) On trapped traders in general: "the market will definitely let you know when it
  has trapped one side of the market’s participants." (Omega, 1998, scanned page)
- **When it fails, the trap flips.** Buyers at the line are the ones trapped. Raschke: "First, if a grail buy trade
  fails, I know I'm not going to look to buy pullbacks in that market." and "Therefore, I'm going to look to trade from
  the short side." ([Active Trader, Aug 2000](https://lindaraschke.net/wp-content/uploads/2026/01/rituals.pdf))
- **The caution.** The ADX is slow. StockCharts: "ADX also has a fair amount of lag because of all the smoothing
  techniques." ([ChartSchool, ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx))
  By the time it reads above 30 the trend is often well along, and a very high reading can mark a run that is
  overdone (Galen Woods, section 3.7).

---

## 2. Origin and naming

**Who named it.** Laurence A. Connors and Linda Bradford Raschke, in *Street Smarts: High Probability Short-Term Trading
Strategies* (M. Gordon Publishing Group). The 1997 AIQ interviewer, David Vomund, introduces it as "One of the easiest
patterns to find that is listed in your book is the Holy Grail" and Raschke then explains it; a 2000 Active Trader
interview calls it the "holy grail" pattern "described in her book" (the editor's words, in parentheses inside her answer).
- **The book's year.** Records differ. Open Library gives "January 1, 1996" and the Library of Congress class number
  "HG4527 .C66 1995" ([Open Library](https://openlibrary.org/isbn/0965046109)). Wikipedia's text says 1996 and its
  bibliography says 1995 ([Wikipedia](https://en.wikipedia.org/wiki/Linda_Bradford_Raschke)). Say 1995 or 1996.
- **I did not read the book.** No legitimate copy was reachable: both Internet Archive records for it are withdrawn (`is_dark`
  in the archive's own metadata), Google Books' API returned a quota error, and the copies I found online are unofficial. So no
  wording from the book appears here as the book's. Where other people report a book rule, I tag it [book, unverified].
- **Why "Holy Grail".** I could not verify the book's own explanation. Galen Woods (Trading Setups Review) writes:
  "The Holy Grail is, of course, not the Holy Grail. Linda Bradford Raschke and Larry Connors named it so for its
  simplicity." ([TSR](https://tradingsetupsreview.com/the-holy-grail-trading-setup/)) The earlier internal file named in
  section 3.6 reports that the book itself calls the title a joke; that comes from an unofficial copy and is not
  checked here [book, unverified]. Treat the name as a label, not a promise.

**What came before the name.** Raschke traded the same idea years earlier. In a telephone interview with S&C's Thom
Hartle (the PDF says "on June 18, 1993"): "If there is a trend, I'll try to always look for buying a pullback to a
moving average (Figure 3). I personally use a 20-period exponential moving average on all my markets."
([S&C V.11:9](https://lindaraschke.net/wp-content/uploads/2026/01/Discerning-trader.pdf)) The figure caption: "When the
three-minus-10 day oscillator made a new high, the trend had turned up. Look to buy the first pullback in the market."

**The ADX is not hers.** J. Welles Wilder Jr. published the Directional Movement System, including the ADX, in his 1978
book (StockCharts: "Wilder features the Directional Movement indicators in his 1978 book"). Raschke used it as a filter.

**Other names for it.**
- "Grail", "grail buy trade", "Grail buy setup": Raschke's own shorthand (Active Trader 2000 and 2004).
- *ADX pullback*, *Raschke Holy Grail*, *Holy Grail setup*: common web names.
- "Holy Grail (Raschke)": our app's scanner name (`api/routers/patterns.py`, `holy_grail.py`).

**Name collisions (not this setup).** Other writers use "Holy Grail" for other things. Minervini calls volatility
contraction his "Holy Grail" (quoted in our `06-vcp.md`). Our own source list (`docs/superpowers/research/setups/setup_sources.json`)
records a day-trading paper titled "VWAP: The Holy Grail for Day Trading Systems" (Zarattini and Aziz, SSRN 4631351).
SSRN itself was not opened; the first author's firm lists the paper as "Volume Weighted Average Price (VWAP) The Holy
Grail for Day Trading Systems" ([Concretum](https://concretumgroup.com/volume-weighted-average-price-vwap-the-holy-grail-for-day-trading-systems/)).
When a member searches the name, they will meet these.

**UCT's names.** None. "Holy Grail" appears nowhere in UCT's 103 public Substack posts, the Model Book catalog
(`app/src/pages/modelbook/setupCatalog.js`) or the journal tags (`app/src/constants/setupGroups.js`). The owner's closest
words are "first pullback to the 20EMA", "First tap of 20EMA held" and "A classic drift and hold at the 20EMA. This is my
main go to setup" (section 6).

---

## 3. Every definition I could find, source by source

### 3.1 Linda Bradford Raschke, 1997: the Holy Grail rules (originator, primary)

Source: "Linda Bradford Raschke on Short Term Trading Strategies", interview by David Vomund, *AIQ Opening Bell
Monthly*, Vol. 6 Issue 8, August 1997, AIQ Systems; hosted on Raschke's own site
([PDF](https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf)). The rules sit in a box headed "Holy Grail
Pattern" and "Buy rules (sells are reversed)" on the interview's second page; the interviewer points to it as the pattern
"listed in your book" ("(preceding page)"). The box is unsigned and carries a note about AIQ's own software, so AIQ's
editors set it, presumably from the book; it is printed beside her interview and her spoken answers match it. This is
the only full rule set I found published with her name on the page.
- **Prior trend (filter):** "1. The 14-period ADX must initially be greater than 30 and rising." The box adds a line about where
  to read the value in AIQ's own software (TradingExpert); it is a software note, not a trading rule.
- **The pullback:** "2. Look for a retracement in price to the 20 period exponential moving average. This will usually
  be accompanied by a turndown in the ADX."
- **Trigger and order:** "3. When the price touches the 20 period moving average, put a buy stop above the high of the
  previous bar."
- **Stop and management:** "4. Once filled, enter a protective sell stop at the newly formed swing low. Trail stops as
  profits grow." (The PDF's columns split this sentence; the words are as printed.)
- **Short side:** "Buy rules (sells are reversed)".
- **What it is for:** "Therefore, any pullback from a new momentum high can be bought."
- **Her odds (a judgment, not a test):** "With this pattern, the odds that a top is in place is probably only 5% to
  10%."
- **Where to look:** stocks that took part in the market's advance of the previous two or three months (her words:
  "stocks that have participated in the markets advance"): "the majority of them have had Holy Grail patterns." She says
  "participated", not "led".
- **The line as support:** "The 20 period exponential moving average often acts as support for stocks." Her example:
  Chevron (CHV), named as "a good example" with no dates given.
- **Management in general (not Grail-specific):** "The best patterns give you instant feedback."
- **The sequence, in her words (one sentence split by a page break):** "we want the stock to fall back to a 20 day
  moving" ... "average after its ADX indicator has moved to a value above 30."
- **Not stated:** volume, price or liquidity floors, how deep or how long the pullback is, a fixed profit target.

Her published examples (the dates are 1997; the charts are in the PDF):
- **Cincinnati Milacron (CMZ), June 23 and 24:** "CMZ touched the moving average and then continued to rally to a new
  high."
- **American Express (AXP):** "AXP touched the moving average on July 1, rose the next day, and then jumped 7 points the
  following day."
- **Eaton (ETN), a failure:** "The stock had a huge thrust up and pulled back nicely to the 20 period moving average. The
  ADX indicator was quite high." Then five quiet days: "This is a case where there is no reason to be in this trade."
  Her lesson: "When you research this pattern, you should also look at cases when it fails."

### 3.2 Raschke, 2004: the Holy Grail on intraday charts (originator, interview)

Source: Active Trader, March 2004, pp. 76-79, interview by Mark Etzkorn
([PDF](https://lindaraschke.net/wp-content/uploads/2026/03/raschke_pt2_0304.pdf)). The magazine's own description (the
writer's words, not hers): "The strategy is designed to catch corrections in markets that have shown evidence of
increased momentum, with the average directional movement index (ADX) and a 20-day exponential moving average (EMA)
providing the setup."
- **Which pullback and the exit:** "On the 30-minute time frame, the ADX rose above 30, so we'll buy the first
  retracement to the 20-period EMA and look to exit on a push to new highs."
- **The filter belongs to each time frame:** "But each retracement has to be preceded by a 14-bar ADX reading above 30
  on that time frame,"
- **Grading:** "The best setups will have confirming factors like the 3-10 oscillator making new momentum highs." (Her
  3-10 oscillator is the 3-period simple average minus the 10-period simple average, with a 16-period average of that
  line, per the same issue's indicator box.)
- **What comes first:** "When the market breaks out of an extended trading range and makes new momentum highs, there is
  a sequence that typically unfolds," The pullback shows up on the 15-minute chart first, then 30, 60 and 120-minute;
  "By then you should be looking for a top."
- **Her example:** the S&P 500 after a two-week sideways range in early December 2003. The ADX "jumped way up" on Dec.
  18 and 19; the setup was the 30-minute pullback to the 20-bar EMA (the figure marks Dec. 19 as the entry); "another Grail buy setup occurred on the hourly
  chart on Dec. 23, and then another formed on the 120-minute chart on Jan. 2."

### 3.3 Raschke, 2000: when the Grail fails (originator, interview)

Source: "Linda Bradford Raschke: The rituals of trading", Active Trader, August 2000, p. 56, interview by Mark Etzkorn
([PDF](https://lindaraschke.net/wp-content/uploads/2026/01/rituals.pdf)).
- **What it is, in her words:** "buying a pullback to a moving average, looking for a move back up."
- **The failure, defined:** "So let's say I make a system based on a failed holy grail buy trade -- one that fails to
  hold the moving average."
- **What a failure means:** "First, if a grail buy trade fails, I know I'm not going to look to buy pullbacks in that
  market." Then she looks short: "Therefore, I'm going to look to trade from the short side."
- **Orders:** "in a trending market -- for Pete's sake, use market orders." In a choppy range she prices her orders
  instead.
- **Taking profits (general, not Grail-specific):** "if the market reaches a price objective and you're really not sure
  if it's going to continue, you have to at least take half the position off."
- **Her shift toward this kind of trade:** "I started looking for more trades that constituted pullbacks within trends
  rather than trying to guess when a market had gone too far."

### 3.4 Raschke, 1993: the idea before the name (originator, interview)

Source: "The Discerning Trader: Linda Bradford Raschke" by Thom Hartle, *Technical Analysis of Stocks & Commodities*
V.11:9, pp. 360-366, interview held June 18, 1993
([PDF](https://lindaraschke.net/wp-content/uploads/2026/01/Discerning-trader.pdf)).
- **The line:** "I personally use a 20-period exponential moving average on all my markets." And: "But what you'll find
  is that there really is no right or wrong parameter for a moving average."
- **The timing:** momentum first, then the pullback: "wait for the market to tip its hand and have that short-term
  momentum indicate what the market's going to do, and then wait for the first two- to three-day retracement to enter
  the market."
- **The ADX rules of thumb:** "I avoid the markets where the ADX falls below 20 and is declining, because there's just
  not enough movement between the swings for me." And the one quoted in section 1 (no fading an ADX above 32 and rising).
- **Orders:** "I use market orders most of the time."

### 3.5 Raschke, 1998 and 2004: the line and the stock (originator, interviews)

- *Omega Research Magazine*, Spring 1998, "TraderTalk" Q&A (page numbers 19 to 23 are printed on the scans), PDF hosted on her site
  ([PDF](https://lindaraschke.net/wp-content/uploads/2026/01/Omega.pdf)). **The PDF is a scanned image with no text
  layer; I typed these quotes from the page images and checked them by eye.** On the line: the "value area" and
  "support/resistance level in a trending market" quotes in section 1. Her core tools: "So, the 3-10 oscillator, the
  two-period ROC, and a 20-period exponential moving average," On stocks: "It’s very easy to see a pullback on the weekly
  chart on the stocks,"
- Active Trader, February 2004, p. 66, "Linda Raschke keeps up the pace", by Mark Etzkorn
  ([PDF](https://lindaraschke.net/wp-content/uploads/2026/01/raschke0204.pdf)). On which stocks: "One way to find good
  potential long-side stock candidates, for example, is to identify the up-trending stocks with the best relative
  strength at the beginning of a quarter." And: "In other words, I want to see only shallow retracements." On the first
  pullback after strength: "But if the S&Ps run up 10 points in that same scenario, I definitely want to buy the first
  pullback." On stops and levels: "I'm always looking at the swing highs or the swing lows."

### 3.6 *Street Smarts* itself (not read)

What I can say without the book: its authors, publisher and year (section 2); that the 1997 interviewer took the
pattern from it; and that Galen Woods says the book "explains how to re-enter a trade and to look for a second
retracement." Two further rules are widely repeated as the book's, and an earlier internal file in this repo
(`docs/superpowers/research/bases/11-raschke-connors-crabel-shortterm.md`) quotes them from an unofficial online copy
of the book: (a) after a stop-out, re-enter with a buy stop at the original entry price; (b) after a successful trade,
the ADX must turn up above 30 again before the next retracement can be traded. The same file also reports (c) an exit
after trailing, at the most recent swing high, and (d) a definition in the book as the first pullback in a strong trend.
**I could not check any of these against a legitimate copy, so all are tagged [book, unverified].** Rule (b) agrees with
what Raschke said in her own name in 2004 ("each retracement has to be preceded by a 14-bar ADX reading above 30"), and
(c) with her 2004 "look to exit on a push to new highs". Note for the owner: that internal file links
to the unofficial copy, and this repo is public.

### 3.7 Galen Woods, Trading Setups Review (educator, secondary)

Source: "The Holy Grail Trading Setup", Trading Setups Review, by Galen Woods, no date shown on the page (its metadata
gives 2012-06-01) ([page](https://tradingsetupsreview.com/the-holy-grail-trading-setup/)). A German translation on kagels-trading.de says
it reproduces this article.
- **Trend filter:** "14-period ADX is initially above 30 and rising"
- **Line:** "Prices retrace down to 20-period simple moving average (SMA)" (an SMA, not Raschke's EMA).
- **Entry:** "Place buy order at the high of the bar that touches 20-period SMA" (the touch bar's high, not the prior
  bar's).
- **Short:** "Place sell order at the low of the bar that touches 20-period SMA"
- **His two cautions on the ADX:** "First, a high ADX can mean that the trend is overdone and may reverse soon." and
  "Second, gradual and protracted trends may unfold entirely without the ADX ever crossing above 30."
- **Stop, target:** not stated as rules. His losing example: "the market hit our stop two days later."
- Reliability: a long-running education site by a named author; it gives no source page for the rules.

### 3.8 Capital.com (broker education, secondary)

Source: "Holy grail trading setup: How ADX works", Capital.com, no author or date shown
([page](https://capital.com/en-int/learn/trading-strategies/holy-grail-trading-strategy)).
- **Line:** "typically the 20-period simple moving average (SMA), though some descriptions use a 20-day exponential
  moving average (EMA)." This is the reverse of the originator.
- **Filter:** "holy grail rules themselves typically look for ADX above 30 and rising."
- **Entry:** "A buy order may be placed above the high of that bar." (the bar that touches the average)
- Optional add-ons it lists (RSI above 50, volume, candles) are its own, not Raschke's.
- Reliability: low. A broker's marketing page, unsigned, no source for the rules. Used here only to show how the rules
  drift in retelling.

### 3.9 StockCharts ChartSchool: the ADX itself (educator, for the indicator only)

Source: "Average Directional Index (ADX)", StockCharts ChartSchool
([page](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
Not a Holy Grail page; it defines the filter.
- **Wilder's levels:** "Wilder suggests that a strong trend is present when ADX is above 25 and no trend is present when
  ADX is below 20." Raschke's 30 is stricter than Wilder's 25.
- **History needed:** "it can take around 150 periods of data to get true ADX values." This matters for any scanner
  that computes the ADX on a short window (section 5).
- **On using it as a gate:** "Setting an ADX requirement will reduce signals, but this uber-smoothed indicator tends to
  filter as many good signals as bad." Context: the signals in that paragraph are +DI/-DI crossovers, not pullbacks; it
  is an opinion with no test shown.

### 3.10 Comparison table

| Source | Trend filter | Line | Which pullback | Touch | Volume | Trigger / entry | Stop | Exit | Short | Time frame |
|---|---|---|---|---|---|---|---|---|---|---|
| Raschke 1997 (AIQ) | ADX(14) "initially" over 30 and rising | 20 EMA | any pullback from a new momentum high | "touches" | none | buy stop over the previous bar's high | newly formed swing low | trail | "sells are reversed" | daily stocks |
| Raschke 2004 (AT) | ADX(14) over 30 on the same time frame, before each retracement | 20 EMA | "the first retracement" | pulls back to | none | not restated | not restated | "a push to new highs" | not discussed | 15 to 120-min, S&P |
| Raschke 2000 (AT) | not restated | "a moving average" | not stated | must hold the line | none | market orders in trends | a failed grail = no more pullback buys | half off at an objective (general) | a failed grail can be a short | intraday and daily |
| Raschke 1993 (S&C) | avoid ADX under 20 and falling | 20 EMA | first 2-3 day retracement after a momentum burst | not stated | none | market orders | not stated | not stated | not stated | daily, futures |
| *Street Smarts* | reported as above | reported as above | re-entry and second-retracement rules reported | | | | | | | not read |
| Woods (TSR) | ADX(14) initially over 30 and rising | **20 SMA** | not stated | the touch bar | none | **order at the touch bar's high** | not stated | not stated | mirror | daily examples |
| Capital.com | ADX over 30 and rising | **"typically" 20 SMA** | "early pullback" | towards the line | optional | above the touch bar's high | not stated | not stated | mirror | any |
| ChartSchool (ADX only) | Wilder: over 25 trend, under 20 none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Our scanner** | home-made ADX over 30 **at the last bar**, +DI over -DI | 20 EMA, rising | any bar in the last 3 | low at or under the line +1.5% | **last 3 bars' average under the prior 10's** | **close over the pullback bar's high +0.1%** | **pullback low minus 1 ATR** | 30-bar high + 1 ATR | **none** | daily |
| The owner (no ADX) | a leader in a strong trend | 20 EMA | "First tap", "first pullback" valued | holds the line | low volume liked | intraday turn or Go Signal | the day's low | house trims | declining-MA fades (unsigned, contributor) | daily |

### 3.11 Where the sources disagree

1. **EMA or SMA.** Raschke names the exponential average in 1993, 1997 (rule 2), 1998 and 2004; elsewhere in the same
   texts she just says "moving average". Nowhere does she say simple. Woods and Capital.com say simple. Go with the
   originator.
2. **Which bar's high.** Raschke: "a buy stop above the high of the previous bar" once the price touches. Read literally,
   on the day price touches the line the stop sits over the day before's high; from the next day on, it sits over the
   touch day's high. Woods and Capital.com use the touch bar's high. Our scanner waits for a close over the pullback
   bar's high. The owner buys the intraday turn on the touch day (dossier 11, 8.2 A).
3. **When the ADX must read over 30.** Raschke: "initially" (before the pullback; it usually turns down during it). Our
   scanner requires it at the last bar, after the pullback, and never checks that it was rising.
4. **Which pullback.** 1997: "any pullback from a new momentum high". 2004: "the first retracement", and each one must
   be preceded by a new ADX reading over 30. These fit together: one trade per momentum burst. Our scanner takes any
   touch in the last 3 bars.
5. **The exit.** Trail (1997); a push to new highs (2004); half off at an objective (2000, general). The house trims at
   3R and 5R (B19, E51). The scanner targets the 30-bar high plus 1 ATR.
6. **The stop.** Raschke: the newly formed swing low. The house: a few cents under the day's or prior day's low (A3,
   F62); these usually coincide. The scanner: the pullback low minus a full ATR.
7. **Volume.** No source requires it. Only our scanner does.
8. **Direction.** Raschke takes direction from price ("sells are reversed"). Our scanner adds +DI over -DI. Capital.com
   and ChartSchool both stress the ADX gives strength, not direction.
9. **Threshold.** Raschke 30 (and 32 in her 1993 rule of thumb); Wilder 25. Nobody tested which is better for this
   pullback that I could find.
10. **Time frame.** Raschke shows Grail setups on daily stock charts (1997) and on 15-minute (even 5-minute) to
    120-minute charts (2004). She never ties the Grail itself to weekly bars: her 1997 "These patterns also work with
    weekly data" comes in her Wolfe Wave answer, and her 1998 "It’s very easy to see a pullback on the weekly chart on
    the stocks," is about pullbacks in general. We swing trade on daily bars (C35).
11. **What a "new momentum high" is.** Raschke reads momentum on an oscillator, mainly her 3-10 oscillator, not on price
    alone. 1993 caption: "When the three-minus-10 day oscillator made a new high, the trend had turned up." 2004 caption:
    on Dec. 18 the ADX pushed over 30 after the 3-10 oscillator had shown "a new momentum high earlier in the day". 2000:
    "The best things indicators do is tell you when there are either new momentum highs or lows, which signals
    continuation." Any price-only test (such as a new 20-day closing high, section 8.1) is a stand-in for hers, not her
    rule.

---

## 4. Measured evidence

**No published statistic for the Holy Grail itself.** I read every article with a text layer on Raschke's own site and
searched StockCharts, Bulkowski's thepatternsite.com (no page for it turned up), Oxford Capital Strategies (its ADX filter
test, below, but no Holy Grail test), Quantified Strategies, Trading Setups Review, broker education pages and the open
web for backtests. None gave a win rate, average gain or failure rate for the Holy Grail with a stated sample. I did not
search paid databases, and I could not read *Street Smarts* itself. An earlier internal file (section 3.6) lists the book's
appendix as Moore Research studies, Oops reports and WR7 tables, and says the Holy Grail chapter gives no win rate; I
could not check either.

**What Raschke herself offered (judgments, not tests).**
- "With this pattern, the odds that a top is in place is probably only 5% to 10%." (1997) She says "probably"; no
  sample, market or period is given. It must never be taught as a measured hit rate.
- Prevalence: among stocks that led the 1997 advance, "the majority of them have had Holy Grail patterns." That says
  the pattern is common in leaders, not that it pays.
- Her method of testing is "counting": "The things I test mostly consist of basic "counting" or modeling market
  tendencies," (Active Trader, Mar 2004). Her one counted example there is about S&P daily bars that close in the top
  20% of their range, not the Holy Grail.
- In 2000 she says of a system that "works, say 70 to 80 percent of the time": that is a hypothetical in a sentence
  about failed signals, not a Holy Grail number.

**Evidence about the ADX filter (indirect).**
- Oxford Capital Strategies tested an ADX(14) filter (thresholds 0 to 60) on a Donchian channel breakout system: "42
  futures markets; 34 years (1980/01/01−2014/9/30)." Conclusion: "The Average Directional Index (ADX) does not add value to
  the base case trend-following model (Figure 1-2)." ([Oxford](https://oxfordstrat.com/trading-strategies/adx/); read
  with the web tool twice, the site blocks plain downloads.) Limits: futures, a breakout system, not a pullback, not
  stocks. It is a warning that the ADX gate is not proven, not a test of the Holy Grail.
- StockCharts' view (an opinion, no sample, written about +DI/-DI crossover signals): the ADX gate "tends to filter as
  many good signals as bad."

**Evidence that trends persist (background only).** Moskowitz, Ooi and Pedersen, "Time Series Momentum", *Journal of
Financial Economics*, 2012: "We find that the past 12-month excess return of each instrument is a positive predictor of
its future return." ([AQR](https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum)) Limits: futures
and forwards, a 12-month look-back and roughly monthly holding, not a 20-day pullback. It supports trading with strong
trends in general; it does not test this entry.

**Our own app's numbers.**
- The blind drawing review (`api/services/pattern_engine/detectors/registry.py`, 2026-10-17): the Holy Grail scanner
  scored 1.80 out of 3 "as drawn" and stays "experimental", drawn for admins only. That measured whether the chart's
  drawing looked right, not whether the trade made money.
- **My check of the scanner's ADX (2026-11-09, scratch script, not committed).** The scanner computes its own
  "approximated ADX" with plain 14-bar sums. The app already has a textbook Wilder ADX (`compute_adx_raw` in
  `api/services/indicator_compute.py`, which the repo's parity report matched against TradingView). On the scanner's own
  15 test charts (`tests/fixtures/holy_grail/`), the two agree within about 2 points in the strong trends but not in
  chop:

| Test chart | Scanner's ADX | App's Wilder ADX |
|---|---|---|
| no_trend_chop (meant not to fire) | 29.9 | 17.7 |
| flat_ema (meant not to fire) | 15.7 | 11.2 |
| weak_trend (meant not to fire) | 18.5 | 20.3 |
| clean_textbook (meant to fire) | 84.7 | 86.2 |
| tight_pullback (meant to fire) | 88.5 | 87.9 |

  On the chop chart the scanner's ADX sits 0.1 under its own gate of 30 while the Wilder ADX is 17.7: under the 20 that
  Raschke's 1993 rule of thumb names (she avoids an ADX "below 20 and is declining"; here it fell from 20.4 to 16.7 over
  the last ten bars, then edged back to 17.7). Limits: synthetic charts of only 80 to 100 bars (short of ChartSchool's
  "around 150 periods", so even the Wilder values are not fully settled); ADX readings of 80 to 100 in the charts meant
  to fire are far above what real stocks show. It shows the formula is fragile, not how often it errs on real stocks.
  (Re-run in the cold check: same numbers to one decimal.)
- The same check, run with the context the live scan computes instead of the hand-written test context: all 7 charts
  meant to fire still fire and all 8 meant not to fire still do not. Unlike the 21, 50 and 200-day pullback scanners
  (dossier 12, section 4), this scanner uses the context only for its score, not as a gate.

**What would settle the owner's questions:** a replay on real daily bars of the proposed rules in section 8 (Wilder
ADX over 30 and rising before the touch, first touch only, trigger over the touch day's high, stop under the new swing
low, house trims), against the same rules with no ADX filter (dossier 11's setup), split by market reading. That one
comparison answers whether the ADX gate earns its place for us. None of the sources did it.

---

## 5. Our app: what the scanner actually tests

### 5.1 The scanner (`api/services/pattern_engine/detectors/uct/holy_grail.py`)

Added 2026-05-14 (commit 6b6ca5b630, Phase 8 Batch 1), from a plan that listed the conditions without a source page
(`docs/superpowers/plans/2026-05-13-pattern-recognition-phase-8-elite-framework-detectors.md`). Direction: long only. It
emits at most one detection, judged on the last bar.

What must all be true (hard gates):
1. At least 56 daily bars.
2. Its own ADX(14) over 30 **on the last bar**. The ADX is "approximated": +DI and -DI from plain 14-bar sums, DX per
   14-bar window, ADX as the plain average of the last 14 DX values. Its docstring calls this "Sufficient for
   trend-classification purposes".
3. Its +DI over its -DI on the last bar.
4. A "touch" in the last 3 bars: a bar whose low is at or under **today's** 20 EMA × 1.015. So a low up to 1.5% above
   the line counts, and so does a low any distance below it. The most recent such bar is "the pullback bar".
5. The 20 EMA rising: today's 20 EMA above the 20 EMA of 10 bars ago.
6. Volume "contracting": the average volume of the last 3 bars under the average of the 10 bars before them.
7. A confidence of 50 or more: 0.40 × geometry (ADX level, DI spread, closeness of the touch, EMA slope, plus a bonus
   for a higher low and for a rising MA near the low) + 0.25 × volume + 0.20 × context (stage 2, MA stack, the stock's
   own 20-day trend, closing-range pattern, a CAN SLIM grade) + 0.15 × a fixed 50.

What it does not test (all in Raschke's rules or implied by them): that the ADX was over 30 **and rising before** the
pullback; that price made a new momentum high first; that this is the first pullback; that the bar actually reached the
line; that price is above the 200-day (B26); the short side. A constant `_MIN_PULLBACK_BARS = 2` ("at least 2 declining
bars before touch") is defined and never used.

Levels it publishes:
- **Entry:** `close > {entry:.2f} (pullback bar high + 0.1%)` (the code's own condition string). A close-based trigger. Raschke uses a resting buy stop; the
  house buys at market when the trigger trades (E57).
- **Stop:** "pullback_low_minus_1_ATR" (the code's own label). The risk from the entry is the pullback bar's whole range,
  plus 0.1%, plus one 14-bar ATR (a plain average of 14 true ranges). For a stock whose ATR is 4% of its price, the ATR
  part alone puts the stop about 4% under the pullback low, so the risk from the entry is over 4% before the bar's own
  range is added: past the house's "about 3%" (A13). It is not Raschke's stop either.
- **Target:** the highest high of the last 30 bars plus 1 ATR. It does not call the shared `make_levels` (2R, 3R) that
  `TRADE_PLANS.md` describes for UCT scanners, and it is not the house trims (B19, E51).

### 5.2 Where else it shows up

- `api/routers/patterns.py`: the catalog entry says "ADX > 30 strong trend + pullback to rising 20EMA + close above
  EMA." The code has no "close above EMA" test.
- `api/services/pattern_engine/display.py`: draws the 20 EMA over the pullback window for this pattern.
- `registry.py`: tier "experimental", drawn only for admins; not in the member set.
- Not in Study: `api/services/study_trade.py` defines trade plans for Kicker, Oops, Slingshot, Launchpad, HVE and Gap
  Support only. No Study unit, lesson or game mentions the Holy Grail.
- **Model Book card:** none. The catalog (26 cards today; its header comment still says "24 swing setups") has no Holy
  Grail card; its "20 EMA Pullback" card is the nearest:
  "A bullish trend pulls back to the rising 20 EMA; a candle holds it, and the remount of the 9 EMA is the buy."
- **Journal tags:** none. `setupGroups.js` has no Holy Grail tag; the nearest is "Classic Flag/Pullback".

### 5.3 What looks wrong

1. **The home-made ADX.** It can pass chop as trend (section 4). The file's own docstring says the ADX is computed
   inline "since the engine doesn't carry an ADX primitive elsewhere"; that is out of date: the app already has a
   parity-checked Wilder ADX (`compute_adx_raw`). The scanner should use it, with enough history (ChartSchool: about 150
   periods). The code comment `# Thresholds - sourced from Raschke & Connors "Street Smarts" (1995)` covers only the 14
   and the 30; the 3-bar window, the 1.5% tolerance and the volume test are not from her.
2. **The ADX is read at the wrong moment.** Raschke wants it over 30 and rising before the pullback and expects it to
   turn down during it. Requiring 30 at the touch drops cases that fit her rule (over 30 before, back under 30 at the
   touch) and keeps cases she would not count (an ADX that is still high but has been falling for weeks).
3. **"Touch" is one-sided and loose.** Up to 1.5% above the line counts; any depth below counts; older bars are compared
   with today's EMA value.
4. **No "first pullback" and no "new momentum high".** Both are in Raschke's words (1997, 2004).
5. **Rules she never had:** the volume gate, the +DI over -DI gate, the 1-ATR stop buffer.
6. **Levels do not match the house:** close-based entry, ATR-wide stop, its own target (5.1).
7. **No short side,** though Raschke's box says "sells are reversed" and the owner's rulebook keeps shorts below the
   200-day (B26, D47).
8. **The narrative text makes claims I could not find in any source.** These are in the `narrative` field every
   detection carries, so any page that shows a detection can show them:
   - "Raschke's published data from the 'Street Smarts' methodology showed the Holy Grail setup historically produced
     60-65% win rates on US stocks and futures when applied with discipline to the ADX > 30 filter." No source found.
   - "Raschke explicitly looks for the volume to RE-EXPAND on the trigger bar" No source found; none of her texts I read
     mentions volume for this pattern.
   - "Raschke's specific guidance: if ADX falls below 25 while the trade is open, take whatever profit (or small loss)
     is available" No source found. The nearest thing I found is her 1993 rule of thumb for which markets to avoid (an ADX
     "below 20 and is declining"), which is not an exit rule.
   - "(b) trail the stop up to the 20-EMA as price advances; (c) take partial profits at the prior swing high" Not her
     words. Hers: "Trail stops as profits grow" (1997) and "look to exit on a push to new highs" (2004).
   - "The Holy Grail typically resolves within 5-15 bars on clean setups." No source found.
   - "the 20-EMA is the institutional swing-trade reference" and "limit orders cluster at the rising 20-EMA" No source
     found.
   - "The four non-negotiable conditions" lists five, three of which (+DI over -DI, rising EMA, volume contraction)
     are not in her rules.
   - "(anything below 30 is considered range-bound chop and disqualifies the setup)", given as part of "Raschke's
     strong-trend threshold". Not her words; the chop level she named was 20 (1993).
   - The reason for the name ("Raschke gave the setup the 'Holy Grail' name not because it works every time ... but
     because it combines all the elements of a high-probability entry"). No source found (section 2).
   - Under "Raschke's specific execution rules", (a) "take the trade only if all 5 conditions hold (no discretionary
     overrides)", (b) trail to the 20-EMA, and (c) partial profits at the prior swing high with the rest riding "to the
     1-ATR projection" (the scanner's own target). None is hers, and (a) runs against her own words: "I have found that I
     do better using discretion as opposed to trading a system." (1997)
   - "Raschke and Connors's discipline in 'Street Smarts': ... always honor the ADX < 25 trend-failure exit." No source
     found (the book was not read; nothing in her interviews says it).
   These texts should be rewritten before any member surface or lesson uses them. [my proposal]

---

## 6. UCT's own words

**Searched:** all 103 posts in UCT's public Substack sitemap (https://unchartedterritoryy.substack.com/sitemap.xml),
read 2026-11-09, for "holy grail", "grail", "Raschke", "ADX", "DMI", "first pullback", "first touch", "first test" and
20 EMA phrases. **Results: "Holy Grail" 0, "ADX" 0, "DMI" 0** (re-run in the cold check: same). Four posts carry under
2,000 characters of text (a "Coming soon" page, two interview posts and one Sunday Scans), so the count covers the
written text only, not audio or video. UCT has never written about this setup by name. What
follows is what UCT's people wrote about the same picture: the first pullback to a rising 20 EMA in a strong trend, and
its mirror.

**The one Raschke mention.** Bracco, Sunday Scans 2026-10-04 ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6)):
"There is a great quote that we commonly reference in the discord. I believe it is from market wizard Linda Raschke."
The quote he gives is about markets in general, not this setup, and he hedges the attribution himself.

**The owner (TSDR), on the 20 EMA as his core setup.**
- "Bought today at $147.30 with a stop at today’s low. A classic drift and hold at the 20EMA. This is my main go to setup
  for the most part." (DELL, The Rest of the Week, 2025-10-22, [post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481))
- "This is pretty much my bread and butter. Setting up off the 20ema here. Any sort of GO SIGNAL would allow me entry
  with immediate full size." (ALAB, Sunday Scans, 2025-06-08, [post](https://unchartedterritoryy.substack.com/p/sunday-scans))
- "For me, its holds of the 20EMA such as 6/23. That was the spot to be aggressive and in the first 2-3 days off that
  spot." (Sunday Scans, 2025-07-06, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-df6))
- "I am mostly a 20EMA kind of guy." And: "My ideal stocks and broad setups are seeing that exact style of upside
  reversal on individual names at the 20EMA. It is my GO SIGNAL." (Sunday Scans, 2025-11-09, TSDR's section,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-720)) Added in the cold check.
- On a quiet pullback: "I really appreciate the low volume of this six day pullback into the 20EMA." (Sunday Scans,
  2025-07-13, TSDR's section, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6)) Added in the cold
  check: it is the source for "low volume liked" in the comparison table (3.10).

**The owner, on the first pullback in a leader (the Holy Grail's timing).**
- "Tuesday gave the first pullback to the 20EMA and a $19 advance from there." (DELL, Sunday Scans, 2026-04-05,
  [post](https://unchartedterritoryy.substack.com/p/sunday-scans-356)) The same paragraph calls DELL "trending, leading,
  and massive RS".
- "RS Leader for some time along with FSLY and AKAM in the group. First tap of 20EMA held and a strong response today."
  (DOCN, The Rest of the Week, 2026-04-01, [post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-13b))
- "The ones that pulled into the 20EMA I will be watching to see if they can hit new highs quickly." (Sunday Scans,
  2025-11-09, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-720)) The same idea as Raschke's "retest
  its recent high".

**The owner, on the trigger.** "There is nothing I like more than a gap down reversal to give me signal. Especially in a
strong trend that is pulling back to a key area or moving average." (Sunday Scans, 2025-06-22,
[post](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)) His trigger is an intraday turn, not Raschke's buy
stop over the prior bar.

**Others at UCT.**
- Bracco, on the first pullback after an extension: "Usually will see some pretty intense back and forth volatility on
  the first pullback after an extension," (Sunday Scans, 2026-05-17, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-679))
- ChartMaster (contributor): "you buy the first pullback after a new ATH." (MSFT, The Rest of the Week, 2025-10-01,
  [post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week))
- Unsigned: "First test of 20EMA following a +125% move in 15 days." (HIMS, Week Ahead, 2025-06-02,
  [post](https://unchartedterritoryy.substack.com/p/week-ahead))

**The short mirror, in UCT's words.**
- Unsigned (Index & ETFs): "Classic bounce and fade into declining 20EMA, if that chart is flipped upside down, I am long
  AF." (SMH, Sunday Scans, 2026-11-01, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-669)) This is a
  Holy Grail sell in all but name, and says in plain words that the short is the long reversed (D47).
- Unsigned (Index & ETF): "wedging up into a declining 20EMA here I would view as negative and look for rejections."
  (ARKK, Sunday Scans, 2025-08-03, [post](https://unchartedterritoryy.substack.com/p/sunday-scans-726))
- Viotti (contributor): "Moves into declining MA's are my favorite short setup" (NCLH, The Rest of the Week,
  2026-04-14, [post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-c4d))

**The owner's verdict log.** No ruling mentions the Holy Grail, Raschke or the ADX
(`docs/study/audits/2026-10-24/owner_verdicts.jsonl`, searched 2026-11-09).

**What this means.** UCT already trades the Holy Grail's picture and timing (the first pullback to a rising 20 EMA in a
leader, stop at the day's low) and its short mirror (a bounce into a declining 20 EMA). What UCT has never used is the ADX
filter. Whether to add it is the owner's call (section 10, questions 1 and 2).

---

## 7. How it fits the owner's account rulebook (section 9)

| Rule | What it means for the Holy Grail | Conflict? |
|---|---|---|
| A3, F62 stop a few cents under the day's or prior day's low | The natural stop is Raschke's "newly formed swing low", which is usually the touch day's low or the trigger day's low. | None with Raschke. **Conflicts with our scanner's 1-ATR buffer.** |
| A13 stop usually within about 3% | The setup selects strong trenders (ADX over 30). The distance from the trigger (over the prior bar's high) to the swing low is at least that bar's whole range, and in volatile leaders one day's range can be more than 3%. I did not measure how often. | **Likely at times.** Size from the stop (A5) or skip (A3); the owner should say which (question 5). |
| A4 the stop only moves up | Matches "Trail stops as profits grow". | None. |
| E57 market orders | Raschke rests a buy stop, which becomes a market order when hit; she says she uses "market orders most of the time" and "in a trending market ... use market orders". | None in practice: buy at market when the trigger trades. |
| C28 no chasing more than 4% past the buy point | The buy point is the trigger (a few cents over the prior bar's high). A gap over it by more than 4% is skipped. | None. |
| C29 skip a long more than 10% above its 10-day average | A stock at its 20 EMA is rarely 10% over its 10-day. | Rare. |
| B26 no longs below the 200-day SMA, shorts only below it | Holy Grail longs almost always sit above a rising 200-day. A sharp V off a bear low can push the ADX over 30 while price is still under the 200-day: the house skips that. Holy Grail shorts must be below the 200-day. | Rare for longs; a real filter for shorts. |
| C31 RS 80+ (shorts RS 20 or less) | Raschke picks "the up-trending stocks with the best relative strength" (2004) and notes that most stocks that took part in the 1997 advance "have had Holy Grail patterns". | None; same idea. |
| B23 $10 and $20M a day; D42 | Raschke gives no liquidity rule. | None; house adds it. |
| B19, E51, E52 trims at 3R and 5R, trail the 10 or 21-day | Raschke trails, or exits on a push to new highs. The prior high is often under 3R away. | **Real difference** (question 6). |
| C33 time stop: under 1R after 10 days | Raschke's ETN: five quiet days and "no reason to be in this trade". One example, not a stated rule. | **Hers is faster** (question 7). |
| B21 re-buy only if the setup triggers again | Matches the reported book re-entry rule only if the re-entry is a fresh trigger with its own stop. | None if taught as B21. |
| E56 at most 3 tries a week | Caps the re-entry rule. | None. |
| B22 no new buys within 3 days of earnings | Applies as is. | None. |
| B20 gap through the stop | Applies as is. | None. |
| D47 shorts are the longs reversed | Raschke: "sells are reversed". | None. |
| D48 skip hard-to-borrow shorts | Applies to the sell side. | None. |
| B18, F65 market filter | Raschke: buy pullbacks in trending markets; in a choppy range she uses priced (limit) orders instead of market orders. | None; use the house reading. |
| C35 we swing trade | Raschke also used it intraday (15 to 120-minute). | Teach daily only. |
| E50 grading is discretionary | Section 9 is a guide, not a checklist. | None. |

---

## 8. Proposed rules for our course

Every line is measurable on daily bars. ADX = Wilder's 14-day ADX computed on at least 150 sessions of history (the
app's `compute_adx_raw`). EMA = the 20-day exponential moving average of closes. ATR = 14-day average true range.

### 8.1 What it is (the setup, before any trigger)

- **One line.** A leader in a strong, young trend (the ADX has pushed over 30 and is rising) makes its first pullback to
  the rising 20-day EMA; you buy when it trades back over the prior day's high, with the stop under the low the
  pullback just made. [originator; "leader" is house rule C31; "first" is her 2004 wording]
- **The trend-strength gate.** On at least one session in the 10 sessions before the touch, the ADX was above 30 and
  higher than the session before. [originator: "must initially be greater than 30 and rising"; the 10-session window is my
  proposal] The ADX may fall during the pullback. [originator: "usually be accompanied by a turndown in the ADX"]
- **Direction comes from price, not the ADX.** On that ADX session the close was above the EMA, and the EMA is higher
  than 10 sessions earlier. [my proposal; Raschke's "sells are reversed" implies direction from the trend] Do not use
  +DI over -DI as a gate; it is not in her rules. [my proposal]
- **A new momentum high first.** The highest close of the last 20 sessions was made within the 10 sessions before the
  touch. [originator idea: "when a security makes a new momentum high and pulls back"; the 20 and 10-session numbers are
  my proposal] Raschke reads "momentum high" on her 3-10 oscillator (3.11, item 11), so this price test is a
  stand-in. Option for the owner, closer to her: the 3-10 oscillator (3-day SMA minus 10-day SMA of closes) made its
  highest reading of the last 20 sessions within the 10 sessions before the touch. [originator 1993, 2004 for the
  oscillator; the numbers are my proposal]
- **The first pullback.** No earlier session touched the EMA since the ADX session above. After a completed trade, the
  ADX must again rise above 30 before the next pullback counts. [originator 2004: "the first retracement", "each
  retracement has to be preceded by a 14-bar ADX reading above 30"; book, unverified, for the re-arm rule]
- **The touch.** A session whose range reaches the line: low at or below that day's EMA and high at or above it.
  [originator: "touches"; the exact test is my proposal] Option for the owner: also count a low within 0.25 ATR above
  the line (question 4).
- **Length.** 2 to 10 sessions from the momentum high to the touch. [my proposal; Raschke's 1993 "first two- to
  three-day retracement" sits inside it]
- **Depth.** No rule beyond the line itself. The touch session's low holds above the 50-day SMA; if it does not, it is a
  50-day pullback (dossier 12), not a Holy Grail. [my proposal]
- **Volume.** Not a gate. No source requires it. Lighter volume on the pullback is a grade plus (section 9). [my proposal]
- **Location.** Close above the 200-day SMA. [house rule B26] Not more than 10% above the 10-day average at entry.
  [house rule C29]
- **Leadership and liquidity.** RS rating 80 or more, in one of the strongest groups. [house rule C31; originator: "best
  relative strength"] C31 sets no cut-off for "strongest groups"; until the owner names one (for example a top-fifth
  group rank), only the RS 80 part is measurable. Price $10 or more and $20 million or more a day; the position no more than 1% of average daily volume.
  [house rule B23, D42]
- **Earnings.** No new buy in the 3 days before a report. [house rule B22]

### 8.2 The buy (trigger and order)

- **Daily trigger (the Holy Grail's own).** Once price has touched the line, buy at market the moment it trades a few
  cents above the high of the most recent completed session; on the touch session itself that is the prior day's high.
  [originator: "When the price touches the 20 period moving average, put a buy stop above the high of the previous
  bar"; house rule E57] If a session makes a lower low and does not trigger, the next trigger is that session's high,
  while the setup is still alive. [originator wording read literally; my proposal]
- **The owner's intraday version (option).** On the touch session itself, buy the intraday turn (red to green, or a
  reclaim of the prior day's low) as in dossier 11, 8.2 A. [UCT] It is not Raschke's rule: hers needs price to clear the prior
  bar's high, while the owner's turn fires lower (at the prior close or the prior day's low), which gives a tighter stop. The owner
  should pick one default for both setups (question 3).
- **The setup is void if:** a close below the 50-day SMA before the trigger; or 5 sessions after the first touch with
  no trigger. [my proposal]
- **No chasing.** Skip if the fill would be more than 4% above the trigger (a gap through it). [house rule C28]
- **One price, one stop, full size.** [house rule A5]

### 8.3 The stop

- **A few cents under the newly formed swing low:** the lowest low from the touch session through the trigger session.
  [originator: "newly formed swing low"; house rule A3, F62; the touch-to-trigger window is my proposal, since she does
  not define the swing]
- **Size from the stop.** If it is more than about 3% under the entry, the share count shrinks so the account risk is
  unchanged; if even that does not fit, skip. Never raise the stop to make it fit. [house rule A3, A5, A13]
- **Not** the pullback low minus 1 ATR (our scanner). [my proposal: not Raschke's, not the house's]
- **A gap through the stop:** the first 30-minute bar's low becomes the stop; out if the loss passes 2R. [house rule B20]

### 8.4 Trims and trail

- **House default:** a third at 3R, a third at 5R; stop to breakeven between 2R and 5R; the last third trailed and sold
  on a close below the 10-day average. [house rule B19, E51, E52] The 10-day, not the 21-day: a stock that has just pushed its
  ADX over 30 is usually moving fast. [my proposal]
- **Raschke's own exits, for the owner to weigh.** She trails (1997) or exits "on a push to new highs" (2004). The prior
  high is where she expects the retest ("it will retest its recent high"). Option: keep the house trims, and treat a sharp rejection at the prior high (a
  close back in the lower half of the day's range on the test) as the moment to raise the stop to breakeven, if 2R is
  already reached. [my proposal; question 6]
- **A gap up past a trim level:** trim at the open. [house rule F63]
- **Time stop:** house C33 (under 1R after 10 sessions, sell). Raschke's faster version: no progress in 5 sessions, out
  ("no reason to be in this trade"); measured as still under +1R at the close of the 5th session after entry [my
  proposal for the test]. [house rule C33; originator example (ETN, five days, 1997), not a rule she stated;
  question 7]

### 8.5 What invalidates it

- A trade below the stop: out. [house rule A4]
- **A failed Grail.** If a Holy Grail long in a stock stops out, or price closes back under the EMA and then under the
  touch low, no more pullback buys in that stock until it makes a new momentum high and the ADX rises above 30 again.
  [originator: "if a grail buy trade fails, I know I'm not going to look to buy pullbacks in that market"; the re-arm
  condition is my proposal] Re-buying the same setup after a stop-out is allowed only as a fresh trigger with its own
  stop. [house rule B21, E56]
- **No ADX reading above 30 before the pullback:** not a Holy Grail. It may still be the owner's 20 EMA pullback
  (dossier 11). [originator]
- **A second touch with no new ADX push:** not a Holy Grail. [originator 2004; book, unverified]
- **Stalling** after entry (see the time stop). [originator]

### 8.6 The short mirror

Raschke's box says "sells are reversed", and the house says shorts are the longs reversed (D47). The mirror:
- ADX above 30 and rising on a session in the 10 before the touch, with the close below a falling EMA. [originator; my
  proposal for the window]
- The lowest close of the last 20 sessions within the 10 sessions before the touch (a new momentum low). [my proposal]
- Below the 200-day SMA. [house rule B26] RS rating 20 or less, weak group. [house rule C31] Borrowable, fee not high.
  [house rule D48]
- The first rally whose high reaches the falling EMA. [originator, reversed]
- Sell short at market when price trades a few cents under the low of the most recent completed session. [originator,
  reversed; house rule E57]
- Stop a few cents above the newly formed swing high. [originator, reversed; house rule A3, F62]
- Trims and time stop mirrored from 8.4. [house rule D47]
- UCT already says it this way: "Classic bounce and fade into declining 20EMA, if that chart is flipped upside down, I am
  long AF." (unsigned Index & ETFs section, 2026-11-01) [UCT, unsigned: not the owner's or a named writer's words]
- Parabolic shorts are a different setup (Bracco's post, B26); a Holy Grail short is a trend continuation, not a
  climax fade. [my proposal]

### 8.7 Best market conditions

- A trending market: Raschke found the pattern in "the majority" of stocks that had taken part in the advance of the
  previous two or three months (1997), and her 2004 example came right after a breakout from a two-week range.
  [originator]
- The house reading Green (full risk per grade) or Yellow (smaller, fewer). Orange: only A+ setups. Red: mostly cash,
  plus shorts below the 200-day. [house rule F65, D46]
- Avoid markets and stocks where the ADX is under 20 and falling. [originator 1993]

### 8.8 Common mistakes (each from a source)

1. **Buying the touch instead of the trigger.** The rule is a buy stop over the prior bar's high, so a pullback that
   keeps falling never fills. [originator]
2. **Reading the ADX as direction.** It measures strength; a strong downtrend also has a high ADX. [originator: "measures
   the strength of a trend"; ChartSchool]
3. **Treating the ADX turning down in the pullback as a sell.** She expects it. [originator]
4. **Buying the second and third pullbacks** without a new momentum push. [originator 2004]
5. **Holding a trade that does nothing.** The ETN lesson. [originator]
6. **Buying pullbacks again after a failed Grail.** [originator 2000]
7. **Using it in chop.** [originator 1993] And the reverse caution: a smooth, slow trend can run without the ADX ever
   reaching 30, so the filter will miss good trends. [Woods]
8. **Using a 20 SMA because a web page said so.** [originator: the exponential average in 1993, 1997, 1998 and 2004]
9. **Buying a Holy Grail right after a climax run.** A very high ADX can mean overdone. [Woods; my proposal to check
   Bracco's parabolic signs before buying]
10. **Setting the stop a full ATR under the low.** The house stop is a few cents under the low, not an ATR away.
    [house rule A3, F62; not Raschke's either]
11. **Chasing a gap over the trigger by more than 4%.** [house rule C28]

### 8.9 Where the sources disagree: options and the recommendation

| Question | Options | Recommend | Why |
|---|---|---|---|
| Line | 20 EMA (Raschke, owner); 20 SMA (Woods, Capital.com); 21 EMA (our other scanners) | 20 EMA | The originator and the owner agree. |
| ADX threshold | 30 (Raschke); 25 (Wilder); none (the owner's own 20 EMA pullback) | 30, if the setup is kept separate | It is what makes this setup different from dossier 11; untested for us (section 4). |
| When the ADX is checked | before the pullback, rising (Raschke); at the touch (scanner) | before, rising | Her words: "initially". |
| Trigger | prior bar's high (Raschke); touch bar's high (Woods); close over the high (scanner); intraday turn (owner) | the owner's call; same as dossier 11 | One default for both 20 EMA setups. |
| Stop | new swing low (Raschke); day's low (house); low minus 1 ATR (scanner) | new swing low, a few cents under | Raschke and the house agree. |
| Exit | trail; push to new highs; house 3R/5R | house trims | His rulebook is closed; Raschke's prior-high exit becomes a stop-raising cue at most. |
| Which pullback | first (2004); any after a new momentum high (1997); any (scanner) | first after each ADX push | Fits both of her texts. |
| Volume | none (all sources); contraction gate (scanner) | not a gate; a grade plus | No source requires it. |

---

## 9. Grading: what makes it an A+ versus a B-

The owner grades by judgment (E50); this is a guide built from the sources.

**A+ (all or nearly all):**
- The ADX rose above 30 out of a breakout from a sideways range. [originator 2004 example: "a long consolidation
  period", about two weeks on her 30-minute chart]
- The first pullback since that breakout. [originator; UCT: "First tap of 20EMA held"]
- A new momentum high before the pullback, confirmed by her 3-10 oscillator making a new high. [originator 2004: "The
  best setups will have confirming factors like the 3-10 oscillator making new momentum highs."]
- A shallow, orderly pullback of 2 to 5 sessions on lighter volume. [my proposal for the 2 to 5 sessions (her 1993
  "first two- to three-day retracement" sits inside it) and for the volume; UCT: "I really appreciate the low volume of
  this six day pullback into the 20EMA." Her "I want to see only shallow retracements" (2004) is about how she picks
  stocks (steady bids over two weeks), not a Grail rule.]
- The touch session shows buyers (closes in its upper half, or the intraday turn the owner looks for). [UCT]
- A leader: RS 90 or more, top group. [my proposal for the 90, above house rule C31's 80; originator: "best relative
  strength"]
- Stop within about 3%. [house rule A13]
- Green market, leaders acting well. [house rule F65; originator]

**A or B:** most of the above, with one or two softer points: RS 80 to 89; a 6 to 10 session pullback; a stop of 3% to
5%; a Yellow market. [my proposal]

**B- (size down, D38, E49):**
- A second or later touch, or the ADX only just touched 30 and has been falling for a while. [originator 2004; my
  proposal]
- A deep or sloppy pullback (big red days), or a stop over 5%. [my proposal]
- Right after a climax run (several of Bracco's parabolic boxes ticked). [Woods; UCT]
- The EMA flattening; the stock lagging its group. [my proposal]

**The market reading, not a grade:** Orange takes only A+ setups; Red is mostly cash, plus shorts below the 200-day.
[house rule F65, D46]

**Not a Holy Grail at all:** no ADX reading over 30 before the pullback; the touch breaks the 50-day (my proposal);
below the 200-day (longs, B26); in the 3 days before earnings (B22).

---

## 10. Questions for the owner

1. **Is the Holy Grail its own setup in our course?**
   (a) Its own card and lessons, with the ADX gate. (b) A named variant inside the 20 EMA Pullback (setup 11): *the
   Holy Grail is a 20 EMA pullback where the ADX first pushed over 30*. (c) Drop it; teach only your 20 EMA pullback.
   It is not in the Model Book or the journal tags today. I lean to (b): you trade the picture, not the ADX, and (b)
   teaches members the name they will meet elsewhere without a second set of rules.
2. **The ADX gate.** Keep Raschke's 30, use Wilder's 25, or none? Untested for us; a replay (section 4) would answer it.
3. **The trigger.** For both 20 EMA setups: a few cents over the prior day's high (Raschke's daily rule), or your
   intraday turn on the touch day, with the other as the fallback?
4. **The touch.** Must the day's range actually reach the line, or does a low within 0.25 ATR above it count?
5. **Wide stops.** When the honest stop (the new swing low) is more than about 3% away, as it can be in the fastest
   stocks: size down to keep the risk (A5), or skip because it breaks the "about 3%" habit (A13)?
6. **The exit.** House trims (3R, 5R, trail the 10-day) as is, or add Raschke's prior-high test as a cue to raise the
   stop?
7. **Time stop.** House C33 (under 1R after 10 sessions), or Raschke's 5 quiet sessions for this setup?
8. **First pullback only?** Or allow a second pullback after a new ADX push?
9. **The short side.** Teach the mirror (below the 200-day, RS 20 or less, borrowable)? UCT's posts already describe it.
10. **The scanner.** May I propose a fix: the app's Wilder ADX, over 30 and rising before the touch, first touch
    only, a real touch, no volume gate, stop a few cents under the swing low, house trims, the short side, and a
    rewritten narrative without the unsourced claims?
11. **The 1993 and 2004 intraday uses.** Leave them out of the course (we swing trade, C35), or mention them once as
    background?

---

## 11. Sources

All read on 2026-11-09. "Saved" means a copy was saved in the scratch folder and the quotes were checked against it by
script.

| Source | Publisher | Author | URL or file | Reliability note |
|---|---|---|---|---|
| "Linda Bradford Raschke on Short Term Trading Strategies", *AIQ Opening Bell Monthly* Vol. 6 Issue 8, Aug 1997 | AIQ Systems; hosted by Raschke | David Vomund (interview) | https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf | Originator, primary. The only full rule set in her name. Saved. |
| "Linda Raschke" interview part 2, *Active Trader*, Mar 2004, pp. 76-79 | Active Trader; hosted by Raschke | Mark Etzkorn | https://lindaraschke.net/wp-content/uploads/2026/03/raschke_pt2_0304.pdf | Originator, interview. Saved. |
| "Linda Raschke keeps up the pace", *Active Trader*, Feb 2004, p. 66 | Active Trader; hosted by Raschke | Mark Etzkorn | https://lindaraschke.net/wp-content/uploads/2026/01/raschke0204.pdf | Originator, interview; stock selection. Saved. |
| "Linda Bradford Raschke: The rituals of trading", *Active Trader*, Aug 2000, p. 56 | Active Trader; hosted by Raschke | Mark Etzkorn | https://lindaraschke.net/wp-content/uploads/2026/01/rituals.pdf | Originator, interview; the failed Grail. Saved. |
| "The Discerning Trader: Linda Bradford Raschke", *S&C* V.11:9, pp. 360-366 (interview June 18, 1993) | Technical Analysis Inc.; hosted by Raschke | Thom Hartle | https://lindaraschke.net/wp-content/uploads/2026/01/Discerning-trader.pdf | Originator, interview; the idea before the name. Saved. |
| "TraderTalk" Q&A, *Omega Research Magazine*, Spring 1998 (printed pages 19-23) | Omega Research; hosted by Raschke | not named ("ORM") | https://lindaraschke.net/wp-content/uploads/2026/01/Omega.pdf | Originator, interview. **Scanned image; quotes typed from the page images and checked by eye.** |
| *Financial Trader*, Sept 1997 cover story "They Want it All" | Miller Freeman; hosted by Raschke | Andy Webb | https://lindaraschke.net/wp-content/uploads/2026/01/ftrader.pdf | Scanned; a profile on multi-market trading. The writer read the first two pages; the cold check read all five (printed pages 28-30 and 32): no Holy Grail, ADX or pullback rule. Nothing used. |
| Other PDFs on her articles page (SFO 2003, SFO 2004, "Everything you ever wanted to know about electronic trading" 2004, "upstairs") | various; hosted by Raschke | Raschke and others | https://lindaraschke.net/articles/ | Searched (text layers) for Grail, ADX, pullback; nothing on this setup. "upstairs" is a scan, not read. |
| Linda Raschke's site pages (articles, interviews, bio, Trading Sardines, site search) | Raschke | Raschke | https://lindaraschke.net/ | No Holy Grail page; the interviews page lists YouTube videos, not watched. |
| *Street Smarts: High Probability Short-Term Trading Strategies* | M. Gordon Publishing Group, 1995 or 1996 | Laurence A. Connors, Linda Bradford Raschke | Open Library record https://openlibrary.org/isbn/0965046109 | **Book not read.** No legitimate copy reachable; Internet Archive records withdrawn. |
| "The Holy Grail Trading Setup" (page metadata 2012-06-01) | Trading Setups Review | Galen Woods | https://tradingsetupsreview.com/the-holy-grail-trading-setup/ | Named educator; no source page for the rules; uses an SMA. Saved. |
| "Das Holy Grail Trading Setup von Linda Raschke und Larry Connors" | kagels-trading.de | Galen Woods, translated by Karsten Kagels and Gaby Boutaud | https://www.kagels-trading.de/?p=14194 | A translation of the above; read with the web tool; nothing new. |
| "Holy grail trading setup: How ADX works" | Capital.com | not named | https://capital.com/en-int/learn/trading-strategies/holy-grail-trading-strategy | Broker marketing; low. Used only to show drift. Saved. |
| "Average Directional Index (ADX)" | StockCharts ChartSchool | StockCharts | https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx | Established educator; the indicator only. Saved. |
| "ADX Filter" strategy test | Oxford Capital Strategies | not named | https://oxfordstrat.com/trading-strategies/adx/ | Independent backtest of an ADX filter on futures breakouts; indirect. Blocks plain downloads; read twice with the web tool. |
| "Time Series Momentum", *Journal of Financial Economics*, 2012 | AQR (abstract page) | Moskowitz, Ooi, Pedersen | https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum | Peer-reviewed; background on trend persistence only. Saved. |
| Linda Bradford Raschke | Wikipedia | various | https://en.wikipedia.org/wiki/Linda_Bradford_Raschke | Encyclopedia; used only for the book's year. Saved. |
| "Volume Weighted Average Price (VWAP) The Holy Grail for Day Trading Systems" (paper page) | Concretum Group | Carlo Zarattini, Andrew Aziz | https://concretumgroup.com/volume-weighted-average-price-vwap-the-holy-grail-for-day-trading-systems/ | Used only to confirm the title of a name collision (section 2). Added in the cold check. |
| Internet Archive metadata for the two *Street Smarts* records | Internet Archive | n/a | https://archive.org/metadata/streetsmartshigh00rasc and https://archive.org/metadata/streetsmarts00rasc | Both return `"is_dark":true` (re-checked in the cold check). |
| UCT Substack, all 103 posts in the sitemap | Uncharted Territory | the owner, Bracco, contributors, unsigned | https://unchartedterritoryy.substack.com/sitemap.xml | House source. Saved; every UCT quote checked by script. |
| The scanner and its tests | this repo | UCT | `api/services/pattern_engine/detectors/uct/holy_grail.py`, `tests/fixtures/holy_grail/`, `tests/pattern_engine/detectors/test_holy_grail.py` | What the app actually does. |
| The app's Wilder ADX and its parity report | this repo | UCT | `api/services/indicator_compute.py` (`compute_adx_raw`), `docs/superpowers/specs/universal-indicator-ecosystem/VENDOR_PARITY_TRANCHE_2_LANE_A_ADX_REPORT.md` | Used as the reference ADX in my check. |
| Catalog, display, registry, Study trade plans | this repo | UCT | `api/routers/patterns.py`, `api/services/pattern_engine/display.py`, `api/services/pattern_engine/detectors/registry.py`, `api/services/study_trade.py` | Where the scanner shows up. |
| Model Book catalog, journal tags | this repo | UCT | `app/src/pages/modelbook/setupCatalog.js`, `app/src/constants/setupGroups.js` | No Holy Grail entry in either. |
| Account rulebook, trade plans, verdict log | this repo | the owner | `docs/study/sizing_rule.md` section 9, `docs/study/TRADE_PLANS.md`, `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | House rules. |
| Phase 8 plan | this repo | UCT | `docs/superpowers/plans/2026-05-13-pattern-recognition-phase-8-elite-framework-detectors.md` | Where the scanner's rules came from; no source cited. |
| Earlier internal research | this repo | UCT research pass | `docs/superpowers/research/bases/11-raschke-connors-crabel-shortterm.md` | Quotes the book from an unofficial copy; not relied on here. |
| Read and not used | web | various | tradersmastermind.com, investingpaths.com, swingfolio.com, therighttrader.com, ebc.com, medium.com (mudrex), sobrief.com, gate.com, TradingView user scripts | Unsigned or unsourced restatements, some likely machine-written; forums and scripts are not sources. None quoted. |
| Checked and not relevant (cold check) | Quantified Strategies | not recorded | https://www.quantifiedstrategies.com/holy-grail-trading/ | Its "Holy Grail" page is about a portfolio of strategies, not Raschke's setup; no Holy Grail backtest found on the site. |

No source cited here carries a notice against AI use or training (checked on the pages of Woods, Capital.com,
ChartSchool, Oxford Capital Strategies, AQR and Wikipedia).

---

## Removed in checking (cold check, 2026-11-09)

**How it was checked.** Every Raschke PDF was downloaded again from her site and its text extracted; the scanned *Omega
Research Magazine* interview (printed pages 19-23) and the scanned *Financial Trader* profile were read page by page
from the page images. The web pages (Woods, Capital.com, ChartSchool, AQR, Wikipedia, Open Library, the Internet Archive
metadata, the kagels-trading.de translation, Oxford Capital Strategies, Concretum) were read again; Oxford and kagels
with the web tool. All 103 posts in UCT's Substack sitemap were downloaded and searched again. The scanner, its 15
test charts, the app's Wilder ADX, the registry, the catalog entry, the Model Book catalog, the journal tags, Study's
trade plans, the account rulebook (section 9) and the owner's verdict log were read in the repo. A script then matched
every quoted string in this file against the saved sources: 196 matched word for word. The rest were checked by hand
(a sentence split across PDF columns; pages read with the web tool or from page images) or are this file's own
cross-references, including the old wording listed below. No quote was found to be invented or misworded.

**Corrected (the claim was wrong or stronger than its source):**
1. The short answer said the scanner's ADX "can read 30 when the app's own textbook ADX reads 18". The measured numbers
   are 29.9 and 17.7; reworded with the exact values.
2. Raschke's 1997 remark was about stocks that "participated in" the market's advance; the dossier said "led" (3.1,
   7, 8.7). Fixed in all three places.
3. The 1997 rule box was called her rule set "in her own name". The box is unsigned and carries an AIQ software note;
   now described as set by AIQ's editors beside her interview.
4. 3.11 said Raschke uses the Grail "from 15-minute to weekly charts". Nothing ties the Grail to weekly bars (the 1997
   weekly remark is in her Wolfe Wave answer; the 1998 one is about pullbacks in general). Corrected.
5. ChartSchool's "filter as many good signals as bad" was used as a verdict on ADX gates in general; it was written
   about +DI/-DI crossover signals. Context added (3.9 and 4).
6. Section 4 said the chop chart's Wilder ADX of 17.7 was "a reading Raschke says to avoid". Her rule is "below 20 and
   is declining"; on that chart it was under 20 and had fallen, but was flat to slightly up on the last bars. Reworded;
   added that the test charts have only 80 to 100 bars.
7. The scanner's stop paragraph (5.1) was muddled about what the 1-ATR buffer adds; rewritten as entry risk = the
   pullback bar's range + 0.1% + one ATR.
8. "The 24-setup catalog": the Model Book catalog holds 26 cards today (its header comment still says 24).
9. 5.3 said the narrative presents the scanner's own stop as "Raschke's specific execution rules". The stop is not
   labelled hers there; the target ("the 1-ATR projection"), the trail to the 20-EMA and "no discretionary overrides"
   are. Corrected, and three more unsourced narrative claims were listed (the "below 30 is chop" line, the reason for
   the name, the "ADX < 25 trend-failure exit" attributed to *Street Smarts*).
10. 8.1 "No entry within 3 trading days before a report": B22 says "the 3 days". Fixed.
11. 8.2 said the daily trigger starts "from the session after the touch". Her rule puts the buy stop in when price
    touches the line, so on the touch session the trigger is the prior day's high. Fixed.
12. The ETN five-day stall was tagged as an originator rule (7, 8.4). It is one example; the tag now says so.
13. 8.7 and 9 said "Red: longs off, shorts only" and "Red market: no longs", and listed "Orange market" as a B- trait.
    D46 and F65 say Red is "mostly cash, plus shorts below the 200-day" and Orange takes only A+ setups. Moved out of
    the grade list and reworded.
14. 8.8 item 10 cited A4 (the stop never moves wider) against an ATR-wide stop set at entry; A4 is about moving a stop.
    Now cites A3 and F62.
15. Section 9: "RS 90 or more" was tagged house rule C31 (C31 says 80); now my proposal. Her "I want to see only shallow
    retracements" was used as a pullback-depth rule; it is about how she picks stocks; retagged. "A long sideways base"
    is now her "long consolidation period" (about two weeks on a 30-minute chart).
16. 8.6 tagged an unsigned Index & ETFs line [UCT], which this file defines as the owner, Bracco or a signed
    contributor. Retagged as unsigned.
17. Section 1 called the 1993 ADX line her "rule of thumb"; she called it "something of a golden rule". Fixed.
18. Two proposed-rule lines were not measurable: "in a strong group" (8.1; C31 names no cut-off, now said so) and "no
    progress in 5 sessions" (8.4; now "still under +1R at the close of the 5th session", tagged as my proposal).

**Removed:**
- The tag [originator: "only shallow retracements"] on the B- "deep or sloppy pullback" line (not what that quote is
  about).
- The phrase "with leaders taking part" as a reading of her 1997 words (8.7).
- "I could not open SSRN to recheck that title" (section 2): the title is now confirmed on the authors' firm's page,
  though SSRN itself still was not opened.

**Added (missed by the writer):**
- What Raschke means by a "new momentum high": a new high on her 3-10 oscillator, not price alone (3.11 item 11), with
  an oscillator-based option beside the price proxy in 8.1.
- From the 1997 interview: the 20 EMA "often acts as support for stocks", the Chevron example, and "The best patterns
  give you instant feedback." (3.1)
- Two owner quotes from TSDR's sections: "I am mostly a 20EMA kind of guy." / "It is my GO SIGNAL." (2025-11-09) and the
  low-volume six-day pullback (2025-07-13), which now sources the "low volume liked" cell in 3.10.
- Two more book rules reported by the earlier internal file (an exit at the most recent swing high; the first pullback
  in a strong trend) and its report that the book calls the title a joke, all tagged [book, unverified].
- The scanner's own docstring is out of date ("the engine doesn't carry an ADX primitive elsewhere") and its
  "sourced from ... Street Smarts" comment covers only the 14 and the 30 (5.3).
- A caveat that four UCT posts are nearly text-free, so "0 mentions" covers written text only.
- Sources: Concretum (paper title), the Internet Archive metadata, a Quantified Strategies page checked and set aside,
  and a note that no cited page carries an AI-use notice.

**Still unverified (said so where they appear):** everything attributed to *Street Smarts* itself; the SSRN page; the
book's own reason for the name.

---

## 12. Examples (from our data)

**The scan's rule, in one paragraph.** Daily bars, long side only (the short mirror of 8.6 was not scanned). Wilder's
14-day ADX (seeded with a 14-bar mean, then Wilder smoothing) had to be above 30 *and higher than the day before* on
at least one session in the 10 sessions before the touch, with that session's close above the 20-day EMA and the EMA
above its level 10 sessions earlier (8.1, the gate and the direction test). The highest close of the last 20 sessions
had to fall inside the same 10-session window (8.1, the momentum high), 2 to 10 sessions before the touch. The touch is
a session whose range reaches the 20-day EMA (low at or below it, high at or above it) with the low above the 50-day SMA
and the close above the 200-day SMA (8.1; house rule B26), and no other touch in the 10 sessions before it (the first
pullback). From the touch session on, the buy is a market order the moment price trades 2 cents over the high of the
most recent completed session (8.2; E57); a gap that opens more than 4% over that trigger is skipped (C28); the setup
is void after a close under the 50-day SMA or 5 sessions with no trigger (8.2). The house gates at entry: close $10 or
more, 50-day average dollar volume $20 million or more (B23), entry no more than 10% above the 10-day SMA (C29). The
stop is 5 cents under the lowest low from the touch session through the trigger session (8.3); hits whose stop was
more than 8% under the entry were dropped. After a hit the name is quiet for 20 sessions, a stand-in for "the ADX
must rise over 30 again" (8.1, 8.5). Not measured, because the sandbox cannot: the RS-80 and group tests (C31), the
earnings blackout (B22), the 1%-of-volume size cap (D42). The 10 examples below were checked against our earnings
dates by hand; none has a report in the 3 sessions after the buy (one candidate, BIIB 2007-07-24, was dropped because
its buy day was its report day, and FSLR 2020-07-31 was set aside because its report came 4 sessions later). The scan
and chart code live in the scratch folder `_study-resume/scratchpad/setups/17-holy-grail/` (`hg_rule.py`, `pick.py`;
not in the repo).

**Base rate.** 26,173 hits across 2,630 of 2,630 liquid names (the full universe; 217 seconds), 1999-01 to 2026-11
(hits before 2002 are few because the liquidity gate was rarely met). 27.2% reached 3R and 17.2% reached 5R before the
stop; 82.3% were stopped at some point in the 60-session window (many after a trim level). This is a fixed stop with no
trims, no breakeven move and no trail, so it is a floor for the house exits (B19, E51, E52), not an estimate of them.
What moved the needle inside the scan: the stop's width (0-1% stops: 42.5% to 3R; 1-2%: 30.4%; 2-3%: 26.8%; 3-5%:
24.8%; 5-8%: 23.5%; a tight stop makes 3R a smaller move, so the R numbers flatter it), while the ADX level above 30
did not (30-40: 27.4%; 40-50: 26.8%; over 50: 27.4%), a quiet pullback did not (pullback volume under 0.8x the prior
20 days: 27.6%; 1.0x or more: 26.7%), and a trigger on the touch day itself did slightly worse than one a day or two
later (23.4% against 27.9%). The ADX result supports the dossier's doubt (section 4): the gate separates trends from
chop, but a higher reading is not a better trade. The rule fires about 10 times a year per name on average, far too
often to be "the" setup; the owner's RS-80 and group filters, which the sandbox cannot apply, are what would thin it.

**The 10 examples** (charts and three phone sheets in the scratch folder's `final/`; "ADX" is the gate session's
reading, "deep" is the pullback from the momentum-high close to the swing low; buy = trigger = fill, since none gapped
over the trigger):

| # | Ticker | Buy date | Momentum high / touch | ADX at gate | Pullback | 20 EMA at touch | Buy | Stop (under) | Best R (sessions to 3R) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | CI | 2000-10-26 | 10-16 / 10-25 | 48.4 | 7 days, 6.1% | 36.38 | 36.72 | 36.03 (1.9%) | 12.9R (2) | A strong October thrust off the 50-day, seven quiet red days into the line, triggered the morning after the touch and never looked back. |
| 2 | JBLU | 2003-07-21 | 07-14 / 07-18 | 53.4 | 4 days, 6.2% | 18.53 | 18.91 | 18.31 (3.2%) | 20.9R (5) | A young IPO leader stair-stepping along the 10 and 20 EMAs; the first real touch of the 20 after a 50+ ADX push, volume drying to 0.74x. |
| 3 | AON | 2005-08-29 | 08-17 / 08-29 | 54.2 | 8 days, 4.2% | 28.87 | 29.35 | 28.76 (2.0%) | 13.2R (5) | A gap-and-go in early August, then an eight-day drift on half the volume; the touch day itself cleared the prior high (Raschke's purest form). |
| 4 | EXPD | 2006-03-09 | 03-03 / 03-08 | 57.6 | 3 days, 3.6% | 38.39 | 38.93 | 38.14 (2.0%) | 19.7R (3) | Her 1993 "first two- to three-day retracement": three days, 3.6% deep, 2% stop, 3R in three sessions. |
| 5 | CE | 2007-01-11 | 2006-12-29 / 01-10 | 53.4 | 6 days, 5.3% | 24.64 | 24.94 | 24.45 (2.0%) | 14.8R (14) | A six-day flag that kissed the line once; slow to pay (14 sessions to 3R) but orderly the whole way, a lesson in the time stop (C33) nearly firing on a winner. |
| 6 | MA | 2009-08-20 | 08-07 / 08-19 | 45.3 | 8 days, 4.4% | 19.54 | 19.84 | 19.48 (1.8%) | 12.4R (2) | The post-earnings-gap leader of August 2009, pullback on 0.54x volume, the whole stop under the touch low at 1.8%. |
| 7 | AMBA | 2016-06-28 | 06-20 / 06-27 | 46.1 | 5 days, 7.8% | 49.12 | 50.27 | 48.75 (3.0%) | 15.0R (8) | A trend so young the 200-day was only just reclaimed; the deepest pullback of the ten (7.8%) yet the line held to the cent. |
| 8 | HLT | 2017-11-10 | 11-06 / 11-09 | 51.0 | 3 days, 2.4% | 71.76 | 72.78 | 71.58 (1.6%) | 12.8R (11) | The shallowest (2.4%) and tightest (1.6% stop): a steady ADX-50 trend that barely dipped to the line, then kept its slope. |
| 9 | AAP | 2018-06-29 | 06-21 / 06-28 | 42.8 | 5 days, 4.4% | 133.72 | 136.20 | 133.27 (2.2%) | 12.0R (15) | A turnaround name just over its 200-day with a first touch after the ADX crossed 40; the slowest to 3R (15 sessions), then a 20%+ run. |
| 10 | LITE | 2025-07-10 | 06-30 / 07-10 | 44.9 | 7 days, 6.4% | 89.17 | 91.78 | 88.88 (3.2%) | 29.9R (5) | The current-cycle leader: touch and trigger on the same day, 3R in five sessions, then the parabolic leg that Bracco's post warns about began. |

All ten fills were within 2.5% of the 10-day SMA (C29 never close to binding) and every stop was under 3.3% (A13).
None gapped over the trigger. Eight of ten triggered the session after the touch; AON and LITE triggered on the touch
day itself.

**Notable failures, in words** (all stopped for a full 1R with the best excursion under 0.5R):

- **NVDA, 2024-04-03.** Every box ticked: ADX 53 and rising, a 5-day pullback to the 20 EMA, a 2.8% stop at 87.57
  against a 90.11 buy. It was the third month of a near-vertical run, and the first touch of the line after that run
  was the start of April's correction, not a resting point. Woods' caution (8.8, mistake 9): a very high ADX after
  a climb like that can mean the trend is overdone. Bracco's parabolic signs belong in the pre-trade check.
- **LULU, 2024-01-12.** ADX 51 after the December surge, a 4-day pullback, but the trigger did not come until the
  fifth session after the touch (the last one allowed) at 488.08 with the stop at 478.08. The late trigger was the
  tell: a stock that needs five days to clear a prior high is no longer in the thrust the ADX measured. It stopped out
  and the stock did not recover that level in the rest of our data for the year.
- **CELH, 2024-04-01.** ADX 49.5, a 10-day pullback (the longest the rule allows) and a 3.4% stop at 81.37 against an
  84.24 buy. Ten days is a flag that has already lost its urgency; the setup is Raschke's only when the pullback is
  short. It stopped out within the 60-session window with no excursion past 0.5R.

The pattern across the failures: a gate reading near 50 after a long, steep run, and a pullback that was either long
(CELH) or slow to trigger (LULU). The winners above all triggered within a day of the touch after pullbacks of 3 to 8
sessions, with the ADX in the 40s to high 50s but the run itself only a few weeks old.

**Data limits.** Daily bars only; the RS rating, group rank and the earnings blackout were not applied in the scan
(the 10 picks were checked by hand against the earnings dates). The scan covered the whole liquid universe within the
time budget, so the base rate is for the complete set, not a sample. Shorts were not scanned.


## 13. Failures and near-misses (from our data)

Built 2026-11-10 from the same scan as section 12 (`final/hits.json`), for the spot, discriminate and grade questions
and the method plan's rule that every setup unit ships with a correctly traded loss. The charts are in the scratch
folder's `final/`: `fail_1-4.png` (one column, four charts), `near_1-4.png`, and the confusable pair
`pair_11-ema20-pullback.png` (the CI 2000-10-26 winner above the 20 EMA Pullback's ILMN 2013-12-05 winner, each
captioned with the card's tell: check the ADX). Every number below is read off the bars; "stopped" is the first session
whose low traded at or under the stop, with the best excursion before it. Each failure passed every gate of the card
(ADX push, momentum high, first pullback, touch above the 50-day, close above the 200-day, trigger within 5 sessions,
stop under the swing low within 3.3%, no fill more than 4% over the trigger) and was checked against the earnings
table: no report reaction day from the session before the buy to 3 sessions after it.

**Four failures, traded by the rules** (one per name, four different years):

| Ticker | Buy date | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| NVDA | 2024-04-03 | 90.11 | 87.57 (2.8%) | day 1, 2024-04-04, best +0.0R | Up 86.4% in the 60 sessions before the touch; the first touch of the line after that run was the start of the April correction: 8 of the next 10 closes under the 20 EMA, the low 20 sessions later 16.1% under the buy. The 3R level printed 36 sessions later. | hg.not_climax |
| MELI | 2014-09-17 | 113.96 | 111.34 (2.3%) | day 1, 2014-09-18, best +0.0R | Stopped the morning after the buy and never traded above the fill; 9 of the next 10 closes under the 20 EMA and a 10.1% drop to the 50-day. The 3R level printed 32 sessions later, after a new momentum high; the re-buy rule wants that new high first. | none (hg.failed_grail for the re-buy) |
| MRVL | 2021-07-09 | 56.66 | 54.95 (3.0%) | day 5, 2021-07-16, best +0.54R | Reached +0.54R, then five sessions of drift took out the stop; only 2 closes under the 20 EMA after that and the 3R level printed 18 sessions after the buy without us. A stop-out is not a signal to chase; a re-buy needs its own fresh trigger. | none (hg.failed_grail for the re-buy) |
| BAC | 2006-05-16 | 49.79 | 48.55 (2.5%) | day 1, 2006-05-17, best +0.0R | Up only 10.9% in the 60 sessions before the touch; stopped the next session, 8 of the next 10 closes under the 20 EMA, the low 20 sessions later 7.9% under the buy, no 3R in 60 sessions. | none (hg.after_entry_stop) |

**Four near-misses, each failing exactly one gate** (the scan re-run with that one gate relaxed; everything else held):

| Ticker | Buy date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| BOX | 2024-11-21 | hg.adx_gate | highest ADX(14) in the 10 sessions before the touch 26.1; the rule wants above 30 and rising | The plain 20 EMA pullback (setup 11): a 4-day, 5.6% dip to a rising 20 EMA with no ADX push behind it. It reached 2.9R, which is the point: the picture alone cannot tell the two apart, only the ADX can. |
| RIG | 2012-03-07 | hg.above_200 | touch close 51.44 under the 200-day SMA 52.79 | A pullback in a stock still under a falling 200-day (a bear-market rally). It ran to 5.4R, and the rule still says no: the 200-day gate is a location rule, not a prediction. |
| CRM | 2018-02-12 | hg.depth | touch low 106.26 under the 50-day SMA 107.16 | A 50-day pullback (setup 12): the touch session went through the 20 EMA and under the 50-day before closing back above it. Stopped at 0R. |
| COST | 2009-10-29 | hg.setup_void | trigger 6 sessions after the touch; the rule voids it after 5 | A stale setup: a 2-day dip to the line, then six sessions before price cleared the prior high. The rule voids the setup after 5 sessions without a trigger; it reached 4.4R anyway, which is why the owner may want to weigh the 5-session limit (section 10). |

Not charted: the `hg.length` near-miss (a 1-session dip, 291 hits in 1,038 names) and the `hg.first_pullback` near-miss
(a second touch inside the same ADX push, 11,642 hits in 1,418 names, most of them a touch one or two sessions after
the first); both exist in `near/` for a later pass. A pullback longer than 10 sessions fails `hg.length` and
`hg.momentum_high` together, so it is not a one-criterion near-miss.

**What the failures have in common.** Three of the four were stopped the very next session and never traded above
the fill: the touch did not hold, the line was lost (8 or 9 of the next 10 closes under the 20 EMA) and price went to
the 50-day. The ADX was high in all four (44 to 53), which repeats section 12's finding that the ADX level above 30
does not sort winners from losers; what differed was the run that produced it (NVDA's 86% in 60 sessions against
BAC's 11%). Three of the four (NVDA, MELI, MRVL) printed the 3R level 18 to 36 sessions after the buy, from a new momentum
high: the lesson for the course is `hg.failed_grail`, a re-buy only on a fresh trigger with its own stop, never a
chase of the move that left without us. The stop width was 2.3% to 3.0% in all four, inside the 3% rule, so the loss
was 1R each time; nothing in the four argues for a wider stop.
