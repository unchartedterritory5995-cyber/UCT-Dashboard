# Setup 29: Undercut & Rally (U&R) and Undercut & Reclaim (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page or file named next to it.
- **Checked word for word against a saved copy** (downloaded today and searched by a script): The OWL Trader (Gil
  Morales), Virtue of Selfish Investing (Morales and Kacher), EdgeRater, StockCharts ChartSchool and StockCharts
  articles, Wyckoff Analytics, Deepvue, the New York Fed staff reports (Osler), Stockbsessed (Oliver Kell), Brian
  Shannon's Alphatrends pages, all 103 posts of UCT's Substack, and our own code and docs. Curly and straight quote
  marks are treated as the same character.
- **Read through a page-reading tool** (the site refused a plain download or rate-limited it): IBD's columns as
  syndicated on Yahoo Finance, and Bulkowski's thepatternsite.com. For Bulkowski's numbers I read the page twice and the
  numbers matched. His site carries an AI notice (section 11). Check these against the live page before a quote goes
  into a lesson.
- My web search allowance for this session was already used up when I started, so I could not search. I read only pages
  whose addresses I already had (from our repo, from earlier dossiers, or from the pages themselves). Section 3.12 and
  section 11 list what I could not open. The biggest gap: Morales says the U&R "is described in detail in the book,
  Short-Selling with the O'Neil Disciples", and I could not read that book.
- **Cold check (2026-11-09, a second reader, finished the same evening).** Every quote was re-checked by script
  against the saved copies and, for the "page tool" sources, against the live page again (Yahoo's two IBD columns,
  Bulkowski, the EdgeRater replay page, both TradingMarkets articles, Wyckoff Analytics, the OWL glossary); every
  Substack quote against its own post's date and the section heading above it; the scanner summaries against the code
  line by line; the measurement tables against the scripts' output files; and the 13 example sessions re-derived from
  the local bars. Web searches were run this time. What changed is listed in section 12.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the people who named or
codified it (here: Gil Morales and Chris Kacher for the name "Undercut & Rally" and "MAU&R"; Richard Wyckoff's school
for the spring, its root); **[UCT]** the owner, Bracco or the Substack; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[measured]** our own test in section 4.3; **[my proposal]** my recommendation,
for the owner to accept or change.

Terms. **Level (L)**: the price being undercut (a prior low, a base low, a moving average, a prior high). **Undercut**:
the low trades under L. **Reclaim**: price trades (or closes) back above L. **Undercut low**: the lowest low while price
was under L. **DCR**: where the day closed inside its range (0 = at the low, 1 = at the high). **R**: the risk on the
trade (entry minus stop). **RVOL**: the day's volume divided by the 50-day average volume. **ATR**: average true range.
**MAU&R**: moving average undercut and rally. **UnR**: UCT's own spelling of U&R.

---

## 1. What it is

An Undercut & Rally is a stock that dips just below an obvious low (or another level everyone is watching) and then
climbs straight back above it. The trade is to buy as the level is taken back, with the stop a few cents under the low
of the dip.

"Undercut & Reclaim" is the same move under another name. UCT uses both words for the same thing ("UnR (Undercut and
Rally)" and "UnR (Undercut and Reclaim)", section 6). In our app the name "Undercut & Reclaim" belongs to the one-day
version: a session that trades under the level and closes back above it (section 5.2).

**Why it works (the psychology).** Each point names its source. None of it is a measured fact; section 4 has the
measurements.
- **The obvious break fools the crowd.** Morales: the U&R "indicates a technical condition where a stock is in a decline
  and moves below a prior low in the pattern." At that point "natural sellers will be washed out and short sellers will
  swarm the stock." Then: "This ends up fooling the crowd, and the stock will then rally back to the upside."
  ([theowltrader.com glossary](https://theowltrader.com/glossary-trading-methods/))
- **It is a bear trap, used by big buyers to collect shares.** The Wyckoff school calls the root pattern a spring: "It is
  an example of a bear trap because the drop below support appears to signal resumption of the downtrend." The spring
  "allows large interests to mislead the public about the future trend direction and to acquire additional shares at
  bargain prices." ([StockCharts ChartSchool, Wyckoff tutorial by Roman Bogomazov and Michael Lipsett](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial))
- **Weak holders hand their shares to strong ones.** IBD, on the shakeout inside a handle: "Most successful handles also
  feature a shakeout, where prior lows in the handle are undercut." And: "In an effective shakeout, weak holders transfer
  stock to strong holders" ([IBD via Yahoo, 2015-02-25](https://finance.yahoo.com/news/why-look-proper-handle-often-220600578.html)).
- **Stop orders really do sit just under obvious levels.** This is the one part with hard data, from currency markets,
  not stocks. Carol Osler (New York Fed) studied a dealing bank's order book: "stop-loss sell orders tend to cluster at
  rates just below 00 and 50". In a second paper she found stop orders "propagate trends and are sometimes triggered in
  waves", but "Most results are statistically significant for hours, although not for days."
  ([NY Fed Staff Report 125, 2001](https://www.newyorkfed.org/research/staff_reports/sr125.html);
  [Staff Report 150, 2002](https://www.newyorkfed.org/research/staff_reports/sr150.html)) So a dip under an obvious
  level can be pushed by a burst of stop selling that is short-lived. That is the U&R's fuel. (The step from currencies
  to stocks is mine.)
- **The trade sits on the other side of failed breakouts.** Connors and Raschke's Turtle Soup, as StockCharts summarises
  it: "The Turtle soup strategy tries to take the opposite side of these false breakouts."
  ([StockCharts, Julius de Kempenaer, 2018-06-02](https://articles.stockcharts.com/article/articles-rrg-2018-06-combining-relative-rotation-graphs-and-the-turtle-soup-setup/))
- **Who is trapped, in UCT's words.** The owner, on a related setup: "Sellers need to be trapped, so there needs to be
  like an almost failed breakdown vs just a little baby red candle." (`owner_verdicts.jsonl`, Kicker ruling). Bracco: the
  market "typically like to undercut big support areas before reclaiming (if they do). The max pain scenario."
  ([Sunday Scans 2026-03-22](https://unchartedterritoryy.substack.com/p/sunday-scans-cab))
- **Why traders like it: the risk is small and clear.** The owner: "Buying those shakeouts is the optimal RR."
  ([Sunday Scans 2025-10-26](https://unchartedterritoryy.substack.com/p/sunday-scans-13e)) My reasoning, not a source:
  the undercut low is a price the market has just tested and rejected, so a stop a few cents under it is both close and
  logical. If price goes back under that low, the trap story is simply wrong.

## 2. Origin and naming

**Short answer: the name "Undercut & Rally (U&R)" is Gil Morales's (with Dr. Chris Kacher), the O'Neil disciples.
Morales calls it one of his own set-ups, they define it on their own sites, and they say it is based on Wyckoff's
spring. I found no earlier use of the name, but I could not search, so I cannot rule one out. Our scanner's claim that
Brian Shannon "refined and popularized" it is not supported by anything I could read (section 3.10).**
(Cold check: a web search on 2026-11-09 also found no earlier use and nothing from Shannon; no source says in so many
words who coined the name. EdgeRater dates Morales's workshop talk on it to April 2019.)

| Name | Who | Where and when | What it covers |
|---|---|---|---|
| **Undercut & Rally (U&R)** | Gil Morales (and Chris Kacher) | The OWL Trader glossary (site (c)2023), which says the setup "is described in detail in the book, Short-Selling with the O'Neil Disciples" (Wiley, 2015, per library and retail listings; I could not read it); VoSI FAQ, first published 13 Jul 2017; a workshop talk reported by EdgeRater ("Here's Gil Morales' presentation from the PNW Trading Workshop in April 2019.", [replay page](https://edgerater.com/WebinarReplay/undercutandrallytemplate)) | An undercut of a prior low in the pattern, then a rally back above it |
| **Moving Average Undercut & Rally (MAU&R)** | Morales and Kacher | VoSI FAQ, 13 Jul 2017; the OWL glossary calls it the U&R's "corollary" | The same move through a moving average |
| **"Ugly Duckling" set-ups** | Morales | OWL glossary | His family name for U&R, MAU&R and the Wyckoffian retest |
| **Spring / springboard / shakeout / terminal shakeout** | Richard D. Wyckoff and the Wyckoff school | ChartSchool tutorial (Bogomazov and Lipsett); Wyckoff Analytics; Morales says Wyckoff's writings call it a "springboard" | A move below the support of a trading range that quickly comes back inside |
| **Shakeout-Plus-Three** | Jesse Livermore, per Morales; then IBD | Morales: "Chapter 5" of Livermore's *How to Trade in Stocks* (I did not read it); IBD column 2015-04-16 | An undercut of a prior low, then a buy a fixed number of points above that low |
| **Turtle Soup** and **Turtle Soup Plus One** | Laurence Connors and Linda Raschke | *Street Smarts* (M. Gordon Publishing; StockCharts gives 1996, other listings 1995; not checked against the book), via StockCharts 2018 and TradingMarkets 2006 (book not read) | A new 20-day low that comes back above the prior 20-day low: the same day (Turtle Soup) or the next day (Plus One) |
| **Bullish Reversal Bar / Upside Reversal** | Deepvue (a scanner vendor) | Deepvue knowledge base | The one-day version: under the prior day's low, then a strong close |
| **UnR, U&R, "undercut and reclaim", MAU&R** (and, loosely, "shake n bake") | UCT (the owner, Bracco, others) | Sunday Scans and The Rest of the Week, 2025 to 2026 (section 6) | UCT uses "UnR" for both "Undercut and Rally" and "Undercut and Reclaim". "Shake n bake" is used more loosely, for any shakeout that recovers (e.g. "A shake n bake at $180 would be awesome.", 2026-09-27); it is never defined |
| **Classic U&R** | UCT's journal tag list | `app/src/constants/setupGroups.js` | The journal tag; the Model Book card is "U&R (Undercut & Rally)" |
| **UCT Undercut & Reclaim** | Our app | `uct_undercut_reclaim.py` (internal, 2026-10-16) | The one-session version (section 5.2) |

**Close relatives that are separate setups in our list** (each has its own dossier; named here so the lessons do not
blur them): the **2B Reversal** (Victor Sperandeo's failed break of a prior extreme; our card: "Price breaks a prior
extreme, fails to follow through, and snaps back"), the **Oops Reversal** (Larry Williams; a gap open under the prior
day's low that comes back), the **Go Signal** (the owner's hourly version, section 6.1), the **Remount** (a reclaim
after a longer stay under a line), the **Wyckoff Spring** (setup 35) and **Gap Support** (a test of a gap-up day's low).

**Who credits whom, as written.**
- Morales on the root: "The undercut & rally, or U&R, is based on Wyckoff's spring formation, and replaces the arbitrary
  and imprecise Shakeout + N nonsense." ([OWL glossary](https://theowltrader.com/glossary-trading-methods/))
- Morales on the ancestor: Livermore's rule needed "1) a move by a stock below a prior low but not more than three points
  lower, and 2) a rally by the stock back to the upside that carried at least three points above the prior low." (same
  page)
- Morales on IBD's version: "In most cases N is usually equal to approximately 5-10% of the stock's current price as
  IBD cites it, although I find this to be far too imprecise for my purposes." (same page)
- EdgeRater (a software vendor): "Gil Morales gave a presentation explaining one of his 'Ugly Duckling' setups called
  'Undercut and Rally'." ([edgerater.com](https://edgerater.com/tradingtemplates/gm_undercutandrally))
- Our code: `u_and_r.py` line 3, "Refined and popularized by Brian Shannon (alphatrends.net," and
  `api/routers/patterns.py` calls it "Brian Shannon's bear-trap reversal setup." I found no Shannon text that uses the
  name (section 3.10).
- An earlier repo research file (`docs/superpowers/research/setups/setup_criteria.json`, "Classic U&R") reached the
  same answer: Morales and Kacher, "NOT an IBD house term." I re-read the pages myself; I did not rely on that file.

**The variants this dossier covers** (my grouping, from the sources):
1. **Classic U&R**: an undercut of a prior low in a base or pattern, reclaimed within a few sessions (Morales, VoSI).
2. **One-day Undercut & Reclaim**: the low trades under the level and the same session closes back above it (Turtle
   Soup, Deepvue's bars, our internal scanner, most of the owner's "UnR" notes).
3. **MAU&R**: the level is a moving average (VoSI; Bracco; the owner's "20EMA undercut and reclaim").
4. **U&R of another obvious level**: a prior high or breakout level, a round number, a gap-up low, VWAP or an anchored
   VWAP, a high-volume close (UCT, section 6).
5. **Market-turn or mean-reversion U&R**: a washout under a big support in an oversold leader or index, often at the
   200-day (Morales's "Ugly Duckling" turn; Bracco's "Mean reversion play").
6. **Weekly U&R**: the same shape on the weekly chart (Morales's ROKU example; the owner's BIDU).
The hourly version is the **Go Signal**, which the owner has ruled is its own setup (section 6.1).

## 3. Every definition I could find, source by source

### 3.1 Gil Morales, The OWL Trader glossary (originator of the name)

Page: [theowltrader.com/glossary-trading-methods](https://theowltrader.com/glossary-trading-methods/), read 2026-11-09,
site footer (c)2023. The OWL Trader is Morales's own service; the About page is signed "Gil Morales" and says he is a
former "Chief Market Strategist, Vice President, and internal Portfolio Manager for William O'Neil + Company, Inc."
([about](https://theowltrader.com/about/)).

- **Shape.** A stock "in a decline" that "moves below a prior low in the pattern" (full sentence and the psychology in
  section 1).
- **The entry and the stop.** "Once the stock undercuts a prior low in the pattern and rallies back above it, a long
  entry is generated at the prior low which is then used as a selling guide."
- **No depth rule, on purpose.** He calls point rules "arbitrary and imprecise" (section 2).
- **Volume and the market.** "Volume is generally not a factor, and often the best U&R set-ups in individual stocks
  occur in conjunction with a market turn to the upside after a period of correcting."
- **Time frame.** It can also form on the weekly chart; his example is ROKU in 2018-2019.
- **Family.** He files it under "Ugly Duckling" set-ups: leading stocks turning up from their lows at the market's
  "maximum ugliness", which he finds better than buying standard base breakouts.
- **It is also his short cover point.** When short, he often covers and takes profits at an undercut of a prior low in
  the pattern.
- **The contrast pattern.** His "Wyckoffian Retest" pulls back toward the low "without undercutting that low" as volume
  dries up.
- **It is a pivot.** His pivot points include "undercut & rally moves".

Not stated on the page: the prior trend, the depth, how long price may stay under, a volume number, targets.

### 3.2 Morales and Kacher, Virtue of Selfish Investing FAQ (2017)

Page: [VoSI FAQ, "What is the Moving Average Undercut & Rally (MAU&R) pattern?"](https://www.virtueofselfishinvesting.com/faqs/answer/what-is-the-moving-average-undercut-rally-mau-r-pattern),
first published and last updated 13 Jul 2017. Copyright MoKa Investors, LLC (Morales and Kacher).

- **The U&R, in their own short definition.** A move "where a stock undercuts a prior low in the pattern, usually along
  the lows of a potential new base, and then rallies back above that low, triggering a buy signal based on the U&R."
- **The difference from the MAU&R.** A straight U&R uses a prior low (a price point); the MAU&R uses a moving average.
- **MAU&R.** "When a leading stock breaks below its moving average, a move back above the moving average can provide a
  long entry point as the stock moves back up through the line." The stock "essentially undercuts the moving average,
  faking out sellers and would-be short-sellers, and then rallies back above it."
- **MAU&R stop.** "Once the buy signal is triggered, one then uses the moving average as a selling guide, and can adjust
  their stop to 1-2% below the line depending on risk-preference."

Two details matter for us. The MAU&R is for "a leading stock". And the classic U&R happens "along the lows of a
potential new base", so near the bottom of a base, not in the middle of a trend leg.

### 3.3 EdgeRater, a scanning template built from Morales's talk (secondary)

Page: [edgerater.com/tradingtemplates/gm_undercutandrally](https://edgerater.com/tradingtemplates/gm_undercutandrally),
read 2026-11-09, undated. A software vendor's description, not Morales's words.
- "Gil Morales gave a presentation explaining one of his 'Ugly Duckling' setups called 'Undercut and Rally'."
- How it finds a "prior low": "Category 1 is a low that has seen a subsequent move up greater than 1%, Category 2 a
  subsequent 5% move and Category 3 a subsequent 10% move."
- It does not require an uptrend: "The report also gives information regarding the 50 SMA so that it is possible to sort
  and filter stocks in uptrends or downtrends."
- The date of the talk (added in checking), from EdgeRater's
  [replay page](https://edgerater.com/WebinarReplay/undercutandrallytemplate): "Here's Gil Morales' presentation from the
  PNW Trading Workshop in April 2019." It calls the setup "one of his favorite strategies". (I did not watch the recording.)
This is useful as a measurable way to say which prior low counts: a low that the stock bounced off by a given amount.
Note that the template only finds stocks "that have undercut prior lows"; the 1%, 5% and 10% categories are
EdgeRater's, not numbers Morales is quoted as giving.

### 3.4 Livermore and IBD: Shakeout-Plus-Three (the ancestor)

- Morales's summary of Livermore (quoted in section 2): under a prior low by "not more than three points", then a rally
  of "at least three points above the prior low."
- IBD, a column on the double bottom and the shakeout-plus-three, as syndicated on Yahoo, 16 Apr 2015
  ([link](https://finance.yahoo.com/news/spot-early-buy-point-double-195200041.html), read through a page tool):
  "As with a double bottom, the shakeout-plus-three pattern has two lows, with the second low undercutting the first."
  "Add three points to the price of the first low." "If the stock rushes past this price on huge volume, it is breaking
  out, and you can consider buying shares." "When the stock is higher-priced, say 80 to 100 a share, add at least six
  points to the first low." And: "The shakeout-plus-three is rare."
- So IBD's version is not a buy at the reclaim. It is a buy a fixed distance above the old low, on "huge volume". That is
  a later, higher entry than Morales's.

### 3.5 IBD on the handle shakeout

[IBD via Yahoo, 25 Feb 2015](https://finance.yahoo.com/news/why-look-proper-handle-often-220600578.html) (page tool):
"Most successful handles also feature a shakeout, where prior lows in the handle are undercut." "A wedging handle with no
shakeouts is a sign to steer clear." And: "After a significant correction and undercut, a new first-stage
cup-with-proper-handle set the stage for another big advance." IBD treats the undercut as a quality sign inside a base,
not as a stand-alone buy.

### 3.6 The Wyckoff spring (the root, per Morales)

[ChartSchool tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial)
by Roman Bogomazov and Michael Lipsett (schematics edited by the late Dr. Henry O. Pruden); most of the same text is on
[wyckoffanalytics.com/wyckoff-method](https://www.wyckoffanalytics.com/wyckoff-method/) (checked live 2026-11-09:
the spring, bear-trap, "late within a TR" and "spring on steroids" sentences are there word for word; that page's
upthrust sentence reads "a UT or UTAD is the opposite of a spring", and it carries no author credit).
- **Shape.** A spring "takes price below the low of the TR and then reverses to close within the TR". (TR = trading
  range.) Later: "a spring is a price move below the support level of the TR (established in Phases A and B) that
  quickly reverses and moves back into the TR."
- **Where.** "Springs or shakeouts usually occur late within a TR". Also: "Shakeouts may also occur once a price advance
  has started, with rapid downward movement intended to induce retail traders and investors in long positions to sell
  their shares to large operators."
- **Volume.** "A low-volume spring (or a low-volume test of a shakeout) indicates that the stock is likely to be ready to
  move up, so this is a good time to initiate at least a partial long position."
- **Confirmation.** "A spring is often followed by one or more tests; a successful test (indicating that further price
  increases will follow) typically makes a higher low on lesser volume." And a "sign of strength" (SOS) is "a price
  advance on increasing spread and relatively higher volume."
- **Not required.** "However, springs and terminal shakeouts are not required elements". "A terminal shakeout at the
  end of an accumulation TR is like a spring on steroids."
So Wyckoff wants light volume on the undercut and heavier volume on the rise that follows. The spring sits at the end of
a range that formed after a decline (accumulation). Setup 35 has the full Wyckoff dossier.

### 3.7 Connors and Raschke, Turtle Soup (a mechanical cousin)

I could not read *Street Smarts*. The rules below are StockCharts' summary, which credits Connors and Raschke
([de Kempenaer, 2018-06-02](https://articles.stockcharts.com/article/articles-rrg-2018-06-combining-relative-rotation-graphs-and-the-turtle-soup-setup/)):
- Today makes a new 20-day low ("the lower the better"), and the previous 20-day low is at least four sessions old.
- "After the market falls below the prior 20-day low, place an entry buy-stop slightly above the previous 20-day low.
  This entry stop is good for today only."
- "If the buy-stop is filled, immediately place an initial (Good Till Cancelled) stop just below today's low."
- "According to the authors, some trades last a few hours while others last a few days."
It has no trend filter and no volume rule, and the entry is the same day. Our scanner says Turtle Soup is a reclaim "on
the next session" (section 5.4); the version I could read says the order is "good for today only".

**Added in checking: Turtle Soup Plus One, the next-day version.** TradingMarkets (John Patrick Lee, 25 Jul 2006,
[link](https://tradingmarkets.com/recent/breakout_after_failure-654653), read through a page tool) says that in "Street
Smarts," Connors and Raschke "outline a trading pattern which they named Turtle Soup Plus One". Its rules, as that page
gives them: "The close of the new low (day one) must be at or below the previous 20-bar low." "An entry buy stop is
placed the next day (day two) at the earlier 20-day low." "If you are not filled on day two, the trade is cancelled."
"If filled, place a protective sell stop one tick under the lower of the day-one low or the day-two low." (All four
sentences re-read on the live page in checking; it also says the prior 20-bar low "must have been made at least three
trading sessions earlier", where StockCharts' Turtle Soup rule says four.) So the same book has a same-day and a
next-day version; our scanner's "next session" wording matches Plus One, not Turtle Soup itself. (Corrected in
checking: an earlier TradingMarkets note, [Marc Dupee, 13 Jun 2001](https://tradingmarkets.com/?p=645410), describes
the **Plus One** buy, not Turtle Soup itself: "The entry signal is at the prior 20-day low and the stop goes at the
previous day's low." That is the Plus One stop in other words; it does not contradict StockCharts' same-day rule.)

### 3.8 Deepvue's bar definitions (the one-day version)

[deepvue.com/knowledge-base/technical](https://deepvue.com/knowledge-base/technical/), read 2026-11-09:
- Bullish Reversal Bar: "Candlestick pattern formed when the price undercuts below the previous day's low, but then
  closes above the previous day's close."
- Upside Reversal: "Candlestick pattern where today's low undercuts the previous day's low and closes in the upper half
  of the daily range."
These are scanner bar types, not trades. Our internal scanner's prior-day-low variant is close to the second one.

### 3.9 Oliver Kell (usage only)

Stockbsessed interview, 1 Apr 2023 ([link](https://stockbsessed.substack.com/p/oliver-kell-interview-the-mind-and)).
On a TSLA 65-minute chart: "Then I got it long after we undercut and rallied." He adds that if it works he "will ride the 20EMA higher". That
is all I found from Kell. He uses the words; he does not define a setup. (An earlier dossier quotes a TraderLion page on
Kell buying back at the 20 EMA; TraderLion refused my download, so I quote nothing from it.)

### 3.10 Brian Shannon (checked because our scanner credits him)

I read six Alphatrends pages, including the book page for *Maximum Trading Gains With Anchored VWAP*
([alphatrends.net/anchored-vwap-book](https://alphatrends.net/anchored-vwap-book/)). None uses "undercut and rally" or
"bear trap". The book page lists its strategies as "IPOs, breakouts, pullbacks, gaps, and short squeezes". I did not read
the book itself. Shannon does teach reclaims of anchored VWAPs (setup 19), which is related, but I found no basis for
"refined and popularized by Brian Shannon" or for the quote our scanner gives him (section 5.4).

### 3.11 Secondary pages already in our repo (read, low weight)

- `docs/study/research/definitions.json` cites the same VoSI FAQ for "U&R (Undercut & Rally)".
- `api/data/voice_kb/trading_principles.json` entry sd-008 (an AI-written "curated" note from 2026-05-11, no source):
  "Stock undercuts a key recent low (1-3% below) intraday, then closes back above it." and "Buy the next day's open or on
  a close above the undercut bar's high." The 1-3% has no source. It is already in the Study bank as a recall principle.

### 3.12 Not found or not read

- **Morales and Kacher's books.** *Short-Selling with the O'Neil Disciples* (the "detail" source per Morales) was not
  readable. The Wiley preview of *In the Trading Cockpit with the O'Neil Disciples* (2013) has no U&R text in its
  preview pages; its table of contents covers pocket pivots and buyable gap-ups.
- **Linda Raschke.** I read the articles page of her site and the 11 article PDFs it links: none mentions Turtle Soup
  or a failed breakdown, so section 3.7 rests on the StockCharts summary.
- **William O'Neil's own books, Mark Minervini, Larry Williams, Victor Sperandeo, John Carter, Lance Breitstein, Toby
  Crabel, Stan Weinstein:** nothing read for this setup (no search budget; none of their pages I had mention it).
- **Qullamaggie.** I read his "3 timeless setups" and FAQ pages: no "undercut". UCT's knowledge base says Bracco
  "Shared Qullamaggie's breakout recipe: big move up, pullback, undercut, reclaim, surf, get" (a summary, in
  `docs/study/levels/brain_kb_2026-11-06.json`); I could not confirm that wording on Qullamaggie's own pages.
- **TraderLion** refused downloads (HTTP 403). **Bulkowski** has no U&R or spring page that I could find (his glossary
  has no "shakeout", "undercut" or "spring" entry; section 4.1).
- **A Zoom lesson.** Our vocabulary file places the U&R's definition in a recorded live Zoom session
  (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`: "edu_videos:355@[00:36:06]"). It does not say who is speaking. The transcript is not in the repo and
  I did not hear it. It may be the best source for "how we trade it".

### 3.13 The criteria side by side

| Source | Prior trend | Level undercut | Depth | Time under | Volume | Entry | Stop | Targets / exit |
|---|---|---|---|---|---|---|---|---|
| Morales, OWL glossary | "in a decline"; best at a market turn up after a correction | "a prior low in the pattern" | no rule (calls point rules "arbitrary") | not stated | "generally not a factor" | at the prior low, as it rallies back above | the prior low is the "selling guide" | not stated |
| Morales and Kacher, VoSI | MAU&R: "a leading stock" | prior low "along the lows of a potential new base"; or a moving average | not stated | not stated | not stated | the rally back above | MAU&R: "1-2% below the line" | not stated |
| EdgeRater (Morales talk) | uptrend or downtrend (sortable) | a low with a later 1%, 5% or 10% bounce | not stated | not stated | not stated | not stated | not stated | not stated |
| Livermore via Morales | a stock in decline | a prior low | not more than 3 points | not stated | not stated | 3 points over the prior low | not stated | not stated |
| IBD, shakeout-plus-three | inside a base (double bottom) | the first low of the W | not stated | not stated | "huge volume" on the buy | first low + 3 points (6+ for 80-100 stocks) | not stated | not stated |
| Wyckoff (ChartSchool) | end of a range after a decline; also early in an advance | the range's support | not stated | "quickly reverses" | light on the spring, heavier on the rise | partial long on a low-volume spring or test | not stated here | point-and-figure count |
| Turtle Soup (via StockCharts) | none | a new 20-day low, prior 20-day low 4+ sessions old | "the lower the better" | same day | none | buy-stop just over the prior 20-day low, today only | "just below today's low" | trailing stop; hours to days |
| Deepvue bars | none | prior day's low | any | same day | none | (a bar type) | (none) | (none) |
| Our journal plan template | "a healthy uptrend" | a prior swing low or the 50-day | not stated | "a day or two" | reclaim "on rising volume" | the reclaim, "same day or next" | "just under the undercut low" | first piece "into the prior high or resistance" |
| UCT owner (section 6) | leaders above the averages; not under declining MAs | any obvious level: prior low, base low, 20 EMA, 50-day, prior high, round number, gap low, VWAP | "slightly"; "quick shakeout" | usually the same day or the next | not a stated rule | intraday reclaim, opening range, 30-minute pivot, hourly | "Stop at LOD" | house trims (section 7) |

### 3.14 Where they disagree

1. **Trend.** Morales's U&R starts with a stock "in a decline" and works best at a market turn after a correction. Our
   journal template and scanners say "uptrend". The owner trades it in leaders above their averages and passes on it
   under declining averages, but says he wants to add the "under the MAs" kind (section 6.2). Turtle Soup ignores trend.
2. **Which level.** A prior low in the pattern (Morales, VoSI), the support of a trading range (Wyckoff), a moving
   average (MAU&R), a 20-day low (Turtle Soup), the prior day's low (Deepvue, our internal scanner), or any obvious level
   (UCT).
3. **Depth.** Livermore: no more than 3 points. IBD: about 5-10% of price per Morales. Morales: no number at all. Our
   scanner: 0.5% to 4%. Our drawing: 0.5% to 6%. The voice note: 1-3% (no source). Turtle Soup: the lower the better.
4. **Speed.** Same day (Turtle Soup, Deepvue, our internal scanner), "a day or two" (journal template), up to 3 bars (our
   public scanner), 5 sessions at most (the agent's criteria file, taken from UCT's private knowledge base;
   section 5.3).
5. **Volume.** "Generally not a factor" (Morales). Light on the undercut, heavier on the rise (Wyckoff). "Huge volume" on
   the buy (IBD shakeout-plus-three). "Rising volume" on the reclaim (journal template). Our public scanner needs at least
   0.7x the undercut bar's volume.
6. **Entry.** At the old low as it is reclaimed (Morales). Three or more points higher (Livermore, IBD). A buy-stop the
   same day (Turtle Soup). The close (our internal scanner). Over the prior consolidation's high, later (our public
   scanner). Intraday (the owner).
7. **Stop.** The old low (Morales). 1-2% under the moving average (VoSI, MAU&R). Under the day's low (Turtle Soup, the
   owner, our internal scanner). 1.5% under the undercut low (our public scanner).
8. **Where it lives.** Morales and Wyckoff put it near the lows of a base, at the end of a correction. IBD puts the
   undercut inside a handle or a W. UCT uses it everywhere: in bases, at the 20-day, after earnings gaps, at prior highs.

## 4. Measured evidence

### 4.1 Published statistics

**No one I could read has published a success rate for the U&R itself.** What exists is near it:

- **IBD says it is uncommon.** "The shakeout-plus-three is rare." (IBD via Yahoo, 2015-04-16; no count given.)
- **The mechanism is measured, in currency markets.** Osler (NY Fed Staff Report 125, 2001; published in the *Journal
  of Finance* 58(5), 2003) used one dealing bank's order book: stop-loss sell orders "tend to cluster at rates just below
  00 and 50". Staff Report 150 (2002; *Journal of International Money and Finance* 24(2), 2005): stop orders "propagate
  trends", and "Most results are statistically significant for hours, although not for days." Limits: currencies, not
  stocks; one bank; round numbers, not chart lows. It supports the story (a burst of stop selling under a level, short
  lived), not the trade.
- **Bulkowski, "busted" patterns** ([thepatternsite.com/Busted.html](https://thepatternsite.com/Busted.html), revised
  12/29/2020; read twice through a page tool; his site forbids use to train AI, section 11). A downward breakout is
  busted when "Price continues no more than 10% in the breakout direction" and then "closes above the top of the
  pattern". "Research using triple tops shows that single busts happen 19% of the time." "The average rise from 145
  failed triple tops in bull markets, is 42%." **This is not a U&R**: the bust needs a close above the whole pattern's
  top, not just back over the old low, and it is measured on one bearish pattern. I list it only as the nearest
  published number.
- I found no Bulkowski page for the spring or the shakeout, no academic test of the U&R, and no test of Turtle Soup that
  I could open.

### 4.2 UCT's own measurements already in the repo

- **The internal one-day scanner** (`uct_undercut_reclaim.py` docstring, lab rule from 2026-10-16): "On the test half it
  lifted recall 11.7% -> 22.9% while" "the fire rate on random ticker-days FELL 13.3% -> 9.5%; a blind review of its"
  "fires on random days judged 14 yes / 3 no / 8 ambiguous, and 0 of 10 decoys yes." These measure **whether it finds
  what UCT traders called a setup**, not whether the trade makes money. The records it was built on are named in the
  code (`t12516`, `t14711`, `t18279`, `t4922`).
- **The public scanner's chart line was judged and pulled.** `api/services/pattern_engine/detectors/registry.py` lists
  `u_and_r` under `DISPLAY_HIDDEN` with the note "# round 1 (2026-10-16): noise". Its separate drawing for members
  (`setup_draw.py`, round 2) first passed two blind packets (2.56 and 2.50 on a 3-point scale), then failed a stricter
  re-check and was withdrawn on 2026-10-24: "u_and_r round 2: 1.96 / 2.06 / 1.92 / 1.76, pooled 1.93 (marginal reclaims,
  lower-high" downtrends) (`api/services/auto_structures.py`). The bar was a pooled 2.4.
- **The Study plan** (`docs/study/UNITS-method.md`, SET.26) marks the U&R's statistics "expected, measure": no number has
  been measured for members yet.
- An earlier research file (`docs/superpowers/research/setups/setup_sources.json`) points at a private
  `setup_performance` table and calls its numbers "A CLAIM, NOT A CRITERION". I did not read it and quote no number from
  it.

### 4.3 New measurement for this dossier (local daily bars, read-only)

**What I did.** The workbench copy of the app's daily bars (`bars.db`, split-adjusted; another process was adding
tickers to it during my runs, so the two runs used 1,263 and 1,284 tickers). Every third ticker alphabetically with at
least 300 sessions; 980 tickers produced events, 1988 to Nov 2026. Every event had to pass the house liquidity rule on
the entry day: price $10 or more and $20 million or more traded a day on a 20-day average (B23). Events with a stop
closer than 0.5% were dropped (a few cents of risk is not a real plan and produced absurd R numbers on gaps). Scripts
and raw output are in my scratch folder (`setups/29-undercut-rally/tools/measure_ur.py`, `analyze_ur.py`, `se_ur.py`,
`measure_e1i.py`, `analyze_e1i.py`, `examples_ur.py`).

The events:
- **E1, the classic U&R.** A swing low (a low under the 3 lows before it and not above the 3 after it) that the stock
  bounced at least 5% off (EdgeRater's middle category); the first later session, 5 to 60 sessions after that low, whose
  low trades under it; then the first close back above it, that session or within the next 3. Entry: the reclaim day's
  close. Stop: 5 cents under the lowest low while it was under (F62).
- **E2, our internal one-day rule, exactly.** I called `uct_undercut_reclaim.evaluate` from the repo on every session.
  Entry: the close. Stop: 5 cents under the session low.
- **Baselines.** B1: every 10th liquid session above the 50-day, entry at the close, stop 5 cents under the lower of the
  last 2 lows. B0: every 10th liquid session above the 50-day that closed in the top half of its range, stop 5 cents
  under the day low. A baseline answers "is this better than buying an ordinary day with the same kind of stop?"
- **The house plan replay** (copied from the High Volume Edge dossier; a simplified section 9): a third off at 3R and a
  third at 5R (at the open if it gaps past, F63), the stop to breakeven once 2R trades (B19), the rest sold on a close
  under the 10-day EMA after the first trim (E52), sold at the 10th close if still under +1R (C33), 120 sessions at
  most. A gap open under the stop exits at the open (B20's 30-minute rule cannot be replayed on daily bars).

**Limits, read these first.** Daily bars only: the order of moves inside a day is unknown, and the owner mostly enters
intraday. Survivors only (today's listed tickers). No costs or slippage. No RS rating (C31) and no group strength,
because I had no causal RS series. No earnings filter (B22). "Above a rising 200-day" in the tables is stricter than
B26, which asks only "above". Events on the same day are not independent, so for the key rows I give a date-weighted
mean (each day counts once) and its standard error. Treat every number as a guide for the owner's decisions, not a
lesson fact.

**Table A. E1, the classic U&R** (entry at the reclaim day's close). "Reached 3R" = traded to entry + 3R before the
stop, within 60 sessions. "House plan" = the replay above, in R. "Follow-through" = a close above the reclaim day's high
within 5 sessions.

| Group | Events | Median stop | Stop within 3% | Reached 1R | Reached 3R | Reached 5R | House plan, mean R | House plan > 0 | Follow-through |
|---|---|---|---|---|---|---|---|---|---|
| E1, all | 57,225 | 2.6% | 57% | 49% | 26% | 17% | +0.06 | 30% | 60% |
| E1, above a rising 200-day | 25,310 | 2.6% | 58% | 50% | 26% | 17% | +0.07 | 31% | 60% |
| E1, below the 200-day | 29,535 | 2.6% | 57% | 48% | 26% | 16% | +0.04 | 30% | 59% |
| above a rising 200-day, stop within 3% | 14,716 | 1.7% | 100% | 49% | 29% | 20% | +0.09 | 28% | 57% |
| ... reclaimed the same day (wick) | 16,389 | 2.0% | 70% | 49% | 27% | 18% | +0.06 | 28% | 55% |
| ... reclaimed 1 session later | 5,317 | 3.2% | 46% | 51% | 27% | 16% | +0.08 | 32% | 68% |
| ... reclaimed 2-3 sessions later | 3,604 | 4.6% | 23% | 52% | 24% | 13% | +0.08 | 38% | 68% |
| ... undercut 0-1% deep | 13,040 | 1.6% | 82% | 49% | 28% | 19% | +0.08 | 28% | 57% |
| ... undercut 1-3% deep | 8,482 | 3.1% | 47% | 51% | 27% | 16% | +0.08 | 32% | 63% |
| ... undercut 3-6% deep | 2,861 | 5.8% | 0% | 51% | 22% | 11% | +0.01 | 35% | 66% |
| ... undercut 6% or deeper | 927 | 10.6% | 0% | 44% | 16% | 6% | -0.09 | 36% | 63% |
| ... reclaim volume at or above the undercut days' | 2,776 | 3.8% | 35% | 52% | 26% | 14% | +0.11 | 35% | 66% |
| ... reclaim volume below the undercut days' | 6,145 | 3.6% | 37% | 51% | 26% | 14% | +0.06 | 34% | 69% |
| ... reclaim day RVOL 1.5 or more | 7,072 | 3.1% | 49% | 48% | 24% | 14% | +0.01 | 32% | 52% |
| ... reclaim day RVOL under 1.0 | 9,651 | 2.3% | 64% | 50% | 27% | 17% | +0.07 | 29% | 65% |
| ... reclaim day closed in the top half | 17,407 | 3.2% | 46% | 52% | 26% | 16% | +0.08 | 32% | 68% |
| ... reclaim day closed in the bottom half | 7,903 | 1.4% | 86% | 45% | 27% | 18% | +0.03 | 26% | 43% |
| ... SPY fell 8%+ from its high in the last 20 sessions | 5,902 | 3.1% | 47% | 50% | 27% | 16% | +0.07 | 32% | 63% |
| ... SPY within 8% of its high | 19,408 | 2.4% | 61% | 49% | 26% | 17% | +0.06 | 30% | 59% |
| ... SPY below its 50-day | 10,555 | 2.7% | 56% | 50% | 27% | 17% | +0.10 | 31% | 62% |
| ... SPY above its 50-day | 14,755 | 2.5% | 60% | 50% | 26% | 16% | +0.04 | 30% | 58% |
| B1 baseline, all | 100,027 | 2.0% | 71% | 49% | 26% | 17% | +0.03 | 30% | 62% |
| B1 baseline, above a rising 200-day | 67,772 | 1.9% | 74% | 49% | 26% | 17% | +0.03 | 30% | 62% |

Date-weighted means with one standard error: E1 above a rising 200-day +0.04 +/- 0.02; B1 above a rising 200-day
+0.06 +/- 0.02; top-half reclaim close +0.05 +/- 0.02; bottom-half +0.02 +/- 0.03; 6%+ undercuts -0.06 +/- 0.05; SPY
below its 50-day +0.06 +/- 0.03.

**Table B. E2, our internal one-day rule** (entry at the close, stop under the session low).

| Group | Events | Median stop | Stop within 3% | Reached 1R | Reached 3R | Reached 5R | House plan, mean R | House plan > 0 | Follow-through |
|---|---|---|---|---|---|---|---|---|---|
| E2, all | 216,034 | 1.8% | 78% | 50% | 27% | 18% | +0.03 | 27% | 68% |
| E2, above a rising 200-day | 145,386 | 1.7% | 81% | 50% | 27% | 18% | +0.03 | 27% | 68% |
| ... level: prior day's low | 78,055 | 1.6% | 84% | 50% | 26% | 18% | +0.00 | 26% | 68% |
| ... level: 10-session range low | 10,706 | 1.9% | 75% | 53% | 29% | 19% | +0.13 | 30% | 70% |
| ... level: a held 21 EMA | 33,110 | 1.8% | 80% | 51% | 27% | 18% | +0.06 | 28% | 68% |
| ... level: a held 50-day | 23,515 | 1.9% | 76% | 50% | 27% | 17% | +0.05 | 28% | 67% |
| ... opened above the level (wick only) | 111,850 | 1.7% | 83% | 50% | 27% | 18% | +0.03 | 27% | 68% |
| ... opened below the level | 33,536 | 1.9% | 75% | 51% | 27% | 18% | +0.06 | 29% | 69% |
| ... closed in the top quarter (DCR 0.75+) | 85,130 | 2.0% | 75% | 51% | 27% | 17% | +0.03 | 29% | 72% |
| ... RVOL 1.5 or more | 14,135 | 2.5% | 59% | 51% | 26% | 16% | +0.05 | 32% | 63% |
| ... 2 or more levels reclaimed at once | 43,254 | 2.0% | 75% | 51% | 27% | 18% | +0.06 | 29% | 68% |
| B0 baseline, above a rising 200-day | 42,712 | 1.6% | 83% | 50% | 27% | 18% | +0.02 | 27% | 69% |

Date-weighted: E2 above a rising 200-day +0.03 +/- 0.01; its 10-session-range-low version +0.09 +/- 0.03; B0 +0.04
+/- 0.02. The rule fired on about 34% of the sessions where it could fire (a close over the 50-day in the top half of
the range).

**Table C. E1 with an intraday entry at the level** (a buy a cent over the old low on the reclaim day, or the open if it
opened above; same stop). **This is a best case and it is biased upward**: daily bars cannot show whether the low came
before the reclaim, and I kept only days that closed back above the level, which drops intraday reclaims that failed
by the close. Read it as an upper bound.

| Group | Events | Median stop | Stop within 3% | Reached 1R | Reached 3R | Reached 5R | House plan, mean R (date-weighted) | House plan > 0 |
|---|---|---|---|---|---|---|---|---|
| E1i, above a rising 200-day | 27,946 | 2.6% | 58% | 53% | 31% | 21% | +0.30 (+0.20 +/- 0.02) | 33% |
| ... stop within 3% | 16,092 | 1.8% | 100% | 60% | 39% | 28% | +0.60 (+0.47 +/- 0.03) | 37% |
| ... reclaimed the same day | 18,242 | 2.6% | 58% | 44% | 27% | 18% | +0.12 (+0.00 +/- 0.02) | 28% |
| ... reclaimed 1-3 sessions later (a buy-stop over the level) | 9,704 | 2.7% | 58% | 68% | 40% | 26% | +0.62 (+0.62 +/- 0.03) | 42% |
| ... reclaim day closed in the top half | 18,638 | 2.4% | 63% | 65% | 39% | 26% | +0.65 (+0.56 +/- 0.03) | 41% |
| E1i, below the 200-day | 32,257 | 2.8% | 55% | 51% | 31% | 21% | +0.28 (+0.17 +/- 0.02) | 32% |

**Other counts.** Of the first undercuts of a bounced swing low, 71% closed back above it within 3 sessions (77% when
above the 200-day). Only 20 of the 25,310 E1 events above a rising 200-day were more than 10% over the 10-day average
(C29 almost never binds on this setup). In every group but one the median house result was -1R (the exception is the
6%-or-deeper undercuts, median -0.24R, because their wide stops were often not reached): most trades are stopped, and
the mean comes from about one trade in ten that makes 3R or more.

**What the numbers say, plainly.**
1. **A mechanical undercut-and-reclaim, bought at the close, is not an edge by itself.** E1 (+0.07R) and E2 (+0.03R)
   did no better than buying an ordinary liquid day above the 50-day with a similar stop (+0.02R to +0.03R;
   date-weighted +0.04R to +0.06R). The rates of reaching 1R, 3R and 5R match the baselines. Whatever edge the owner's
   U&Rs have must come from what the mechanical rule leaves out: the leader, the base, the level's importance, the
   market, and the intraday entry.
2. **The entry price matters more than the pattern.** Buying near the level (Table C) shrinks the risk and lifts every
   R number. Part of that lift is the bias described above, so I cannot say how much is real. The cleanest row is the
   multi-day reclaim bought with a buy-stop over the level (+0.62R): that order is real, but it still keeps only days
   that closed above the level. This explains why the owner buys the intraday reclaim with a tight stop instead of the
   close, and it says this setup needs intraday data to test properly.
3. **A strong reclaim close helps; a deep undercut hurts.** Top-half closes followed through 68% of the time against
   43% for bottom-half closes. Undercuts 6% or deeper had the worst results and stops over 10%.
4. **Volume did not help.** High-RVOL reclaims did slightly worse; a reclaim on more volume than the undercut was only a
   hair better. This matches Morales ("Volume is generally not a factor") more than the journal template's "rising
   volume".
5. **The undercut of a real range low beat the undercut of yesterday's low.** In E2, the 10-session range low version
   (+0.13R) was the only clear step up from the baseline; the prior-day-low version (+0.00R), which is most of the
   fires, was flat. A U&R needs a level that matters.
6. **Market and 200-day: small or no differences.** Below the 200-day did about as well as above it. A weak market
   (SPY under its 50-day) did slightly better, in line with Morales's "market turn", but within about one standard error
   on a date-weighted basis.

## 5. Our app

### 5.1 The public scanner: `api/services/pattern_engine/detectors/uct/u_and_r.py` (id `u_and_r`)

What the code actually tests, in order:
1. **History.** At least 66 bars.
2. **Hostile gate.** It refuses only when all three hold at once: Stage 4, stacked bearish averages and a falling RS
   trend. There is no other trend rule.
3. **Candidate levels.** (a) the 50-day SMA, computed on the **last** bar, not on the undercut bar; (b) swing lows
   (3-bar pivots) from the last 40 bars that come before the consolidation and sit outside its price range; (c) the low
   of the prior consolidation (step 4).
4. **Prior consolidation (hard gate).** A window of 8 to 40 bars ending 1 to 5 bars before the undercut, with
   (high - low) / mid under 10%. It prefers the longest window at 6% or tighter, then the longest; ties go to the most
   recent.
5. **The undercut.** A block of 1 or 2 bars starting in the last 8 bars and ending before the last bar. At least one
   bar in the block must close red, and the block's lowest close and lowest low must both be under the level. The level
   used is the qualifying one nearest the undercut low.
6. **Depth.** (level - undercut low) / level between 0.5% and 4%.
7. **The rally.** Within 3 bars after the block, a close above the level plus 25% of the undercut depth.
8. **Volume (hard gate).** The rally bar's volume is at least 0.7 times the block's average volume.
9. **Already gone.** It drops the candidate if 3 or more closes since the rally are over the consolidation high + 1%.
10. **Score.** 40% geometry (best depth 0.8% to 2.5%; one bar beats two; a rally close 2% over the level gets full
    marks), 25% volume (rally / undercut volume: 1x = 50, 2x = 100), 20% context (Stage 2, stacked averages, rising RS,
    accumulation closes), 15% a fixed 50. Floor 50. It reports the single best candidate, with status "ready".
11. **Levels.** Entry = the prior consolidation's **high** + 0.1%. Stop = the undercut low minus 1.5%. Target = the
    consolidation high + 2 x (consolidation high - undercut low).

### 5.2 The internal scanner: `api/services/pattern_engine/detectors/uct/uct_undercut_reclaim.py` (id `uct_undercut_reclaim`)

Admin-only (`INTERNAL_PATTERN_IDS` in `registry.py`), added 2026-10-16 as a port of a lab rule. On a session:
1. The close is above the 50-day SMA, and the close is in the top half of the day's range (DCR at least 0.5).
2. A level sits between the day's low and its close, from: the prior session's low; the lowest low of the 10 prior
   sessions; the prior session's 21 EMA or 50-day SMA, but only if the prior session closed above it. "A wick-only
   undercut that closed back above counts; a red close is not required."
3. The last level hit in that order names the variant; every level hit is listed.
4. Entry = the close. Stop = the session low itself. Targets = 2R and 3R (`make_levels` in `uct_setups_common.py`).
5. Wrapper: the shared liquidity floor (`primitives/liquidity.py`: $2 price and $10,000 a day of dollar volume); the
   newest of the last 3 sessions that qualifies; dropped once a later session trades through its stop.
6. Confidence: geometry starts at 70 (+5 per extra level, up to +15; +5 for DCR 0.75 or more; +5 above the 21 EMA),
   RVOL score floored at 40, context floored at 40, a fixed 50 for history, weighted 40/25/20/15. The lowest possible
   confidence is 0.4 x 70 + 0.25 x 40 + 0.2 x 40 + 0.15 x 50 = 53.5, so the floor of 50 never rejects anything
   (checked against `uct_setups_common.py` in the cold check).

### 5.3 Every other place the app defines it

- **Chart drawing for members** (`api/services/pattern_engine/setup_draw.py`, `u_and_r` round 2, withdrawn for members
  2026-10-24, still drawn for the team): the support is a real prior swing low 5 to 60 bars before the undercut, the
  lowest low from 10 bars before it, with a bounce of at least 2 ATR off it; 1 to 5 closes under it; the low 0.5% to 6%
  under; the reclaim close in the last 3 bars, every close since holding it, the reclaim and latest closes at least 25%
  of the depth back over it; not a "chop line" (at most 2 crossings and 3 bodies through it in 60 bars); rally volume at
  least 0.7x the undercut average; the latest close no more than 2 ATR over it; and a gate: a close above a **rising**
  200-day and no pending-deal price pin. This is the most textbook of our rules.
- **Chart IQ** (`api/services/chart_iq/engine/v2_setups.py`, id `undercut_reclaim`): in the last 5 bars the low went
  more than 0.1 ATR under the 21 EMA, the 50-day, the 200-day or a recent shelf low, and the latest bar closed back over
  it, green, with DCR at least 0.6, while the 50-day is rising or price is above it.
- **Screener bar type** (`api/services/screener/bar_character.py`, "Undercut & Reclaim"): a new 20-day low that closes
  above the prior 20-day low and above yesterday's close. No trend rule. The starter screen adds price $5+ and $5M a day.
  This is close to Turtle Soup.
- **Starter scans refuse it** (`app/src/components/chart/engine/ast/starterScans.json`, "Classic U&R"): "which N makes a
  low prominent is still nobody's published number".
- **Vision rubric** (`api/services/pattern_vision/rubrics.py`): "Price undercuts an obvious prior low (shakeout) then
  rallies back above it." Must-haves include "A brief undercut BELOW that level (the shakeout)"; disqualifiers include
  "A sustained breakdown, not a shakeout".
- **Model Book card** (`app/src/pages/modelbook/setupCatalog.js`): "U&R (Undercut & Rally)", family "Reversals &
  Reclaims", long. Essence: "Price briefly undercuts a prominent prior low", stopping out weak holders and luring shorts,
  "then reclaims it." The glyph has a long lower wick on the sixth candle and a pivot line at the fifth candle's low.
- **Journal tags** (`app/src/constants/setupGroups.js`): "Classic U&R". `setupTagMap.js` maps it to the card and maps
  the `u_and_r` detector to the same tag; the whole "Reversals & Reclaims" family opens the `undercut-rally-plan`
  template.
- **The journal's plan template** (`app/src/pages/journal-2-0/lib/notebookTemplates.js`): "Enter when the stock
  reclaims the level, same day or next." Checklist: "The stock was in an uptrend before the undercut", "The undercut is
  brief: a day or two, not a breakdown", "The reclaim comes on rising volume". Management: "Sell a first piece into the
  prior high or resistance", "Raise the stop to the reclaimed level once it holds a day".
- **The Study plan** (`docs/study/UNITS-method.md`, SET.26, written by an AI planning pass): "the tightest stop in the
  book, counter-trend size smallest." It plans winners "from u_and_r detections at confidence 70 or more".
- **The voice note** (`api/data/voice_kb/trading_principles.json`, sd-008), already in the Study bank as a recall
  principle (item `si_35551ea13810`): "Stock undercuts a key recent low (1-3% below) intraday, then closes back above
  it." No source.
- **The agent's criteria** (`docs/agent/knowledge/setup-criteria.json`, "U&R", `"reviewed": false`): a rising 50-day
  ("interpreted"), a reclaim within 5 sessions ("stated"), a stop of at most 8% ("stated"). These come from UCT's private
  knowledge base template (section 6.5).
- **The router description** (`api/routers/patterns.py`): "Brief close below key support followed by immediate rally
  back above + follow-through. Brian Shannon's bear-trap reversal setup."
- **Cousins in code:** `wyckoff_spring.py` calls itself "the STRICT cousin of u_and_r"; `remount.py` is the longer
  version (5 to 30 bars under a line).
- **`docs/study/TRADE_PLANS.md`** has no U&R row yet.

### 5.4 Where the app disagrees with the sources or looks wrong

1. **The wrong originator, in member-facing text.** `u_and_r.py` (docstring and narrative) and `api/routers/patterns.py`
   credit Brian Shannon. The name is Morales and Kacher's (section 2); I found nothing from Shannon on it.
2. **An invented statistic in the narrative.** `u_and_r.py` tells members U&Rs in liquid names "historically deliver
   2:1+ RR in 70%+ of cases" (the same sentence names "($300M+ cap, 500K+ avg volume)"). There is no source, and the
   code tests neither cap nor volume. Our own test found nothing like it (section 4.3). This should not reach a member.
3. **A quote with no source.** The narrative says Shannon teaches that "the failed" "move is often the start of the
   next big move". I could not find it in any Shannon page I read.
4. **Two more unsupported claims.** It says Tom DeMark's TD Sequential treats this as "one of his canonical buy
   triggers", and that Turtle Soup is a reclaim "of that level on the next session". I could not check the DeMark
   claim; the Turtle Soup version I could read is same-day ("good for today only").
5. **The entry is not a U&R entry.** `u_and_r.py` enters over the prior consolidation's **high**, a later breakout.
   Every source buys the reclaim of the undercut level itself (Morales: "a long entry is generated at the prior low").
   With that entry the stop (1.5% under the undercut low) can be the whole consolidation (up to 10%) plus the undercut
   (up to 4%) plus 1.5%. That breaks A13's "about 3%".
6. **Comment and code disagree.** The comment says the rally must close "support + half the undercut depth"; the code
   uses 25% (`* 0.25`). The `entry_condition` text says "on volume > 1.3x 20-bar avg", but no gate enforces it: the
   only 1.3 in the code picks a word for the narrative from the rally-to-undercut volume ratio, which is a different
   number, and the one volume gate is the 0.7x rule in step 8.
7. **A look-ahead mismatch.** The 50-day SMA level is taken at the last bar, not at the undercut bar, so the level an
   older undercut is measured against moves with today's average.
8. **No liquidity floor on the public scanner; a very low one on the internal one.** `u_and_r.py` never calls the
   liquidity floor. `uct_undercut_reclaim.py` uses $2 and $10,000 a day. The house rule is $10 and $20 million (B23).
9. **No 200-day rule in either scanner** (only the drawing has one). The internal scanner fires under the 200-day as
   long as price is over its 50-day. B26 forbids that long.
10. **Stops and targets.** The public scanner's stop is 1.5% under the low; the internal one's is exactly at the low.
    The house stop is a few cents under (F62). Both use 2x-risk targets; the house trims at 3R and 5R (B19, E51).
11. **Sizing advice in the narrative.** "comfortably sized given U&R's tight structural stops support larger size" and
    "because the stops are typically tight (3-5%)". Size is set by the account rules (A5, A7's 40% cap, E49), not by
    the setup, and 3-5% is not tight by the house standard (A13).
12. **The internal rule is too common to be a setup.** It fired on about a third of eligible sessions and its main
    variant (the prior day's low) showed no edge (section 4.3). Only the 10-session range low version stood out.
13. **The public scanner misses the owner's most common form.** It needs a red close under the level, so it cannot see
    a one-day wick reclaim, which is most of the owner's "UnR" notes (section 6.2). That is why the internal scanner was
    added beside it.
14. **The chart line was judged "noise" and the member drawing failed recertification**, yet `u_and_r` still feeds
    journal tag suggestions (`setupTagMap.js`) and is the planned Study example source. Those plans should follow the
    judges.
15. **The journal template asks for "rising volume"; Morales says volume is "generally not a factor"**, and our test
    agrees with Morales. It also trims "into the prior high or resistance", which is not the house trim rule.
16. **"Counter-trend size smallest"** (the Study plan) is not the owner's practice: he trades U&Rs in leaders above
    their averages and once planned "putting 30%+ of my account in" on one (section 6.2). Size comes from E49 by grade.

## 6. UCT's own words

Dates are the post's date as Substack stamps it (UTC). "The Rest of the Week" goes out on US evenings, so its stamp can
be a day later than the US date. Each quote is under the section heading it sits in: "TSDR's Weekly Outlook &
Watchlist" and the "Charts Covered" list after it are the owner's (the Substack's byline says the room is "run by
Patrick (TSDR), Bracco, EliteSwingTraders, & Manrav"); "Bracco's Breakdown" is Bracco's; "Index & ETF action" is
unsigned.

### 6.1 The owner's rulings (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

There is **no ruling on the U&R itself yet**. These rulings touch it:
- **The Go Signal is the hourly U&R** (2026-10-27): "GO SIGNAL is similar to the oops reversal or the UNR but is an
  hourly GO SIGNAL btw". Then: "GO SIGNALS are supposed to be notable hourly flags that undercut a slight range and
  quickly go red to green in the first hour". On a daily chart he said: "Gonna need to see the hourly but there are all
  most likely good 20EMA APULLBSCKS or UNR setups". So on the daily chart, the Go Signal's footprint is a U&R or a
  20 EMA pullback.
- **Sellers must really be trapped** (Kicker ruling): "Sellers need to be trapped, so there needs to be like an almost
  failed breakdown vs just a little baby red candle."
- **A tiny undercut teaches less** (Oops Reversal, TVTX): "That is fine, but a little subtle and hidden". The reviewer's
  note: "prefer visually clear ones".
- **Gap Support allows a slight breach** (2026-10-26): "That's good but I want the gap up low to hold or be slightly
  breached instead of the gap fill spot btw". A slight undercut of the gap-up day's low that closes back above is his
  Gap Support, a U&R of that one level.

### 6.2 The owner (TSDR) in the Substack

**What a UnR is, and the Go Signal link.**
- 2025-06-22, on the market: his ideal was "a gap down of 0.7% or more that gets bought up", a shakeout under the
  20 EMA, then buying once "opening ranges being taken out or strong hourly candles forming after the first 30 min".
  "This would be considered a UnR (undercut and Rally), I call it a GO SIGNAL." And: "it is important to wait for signs
  and signals of strength instead of hoping we bounce at this random moving average"
  ([sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2))
- 2025-06-15, ALAB: "need a UnR (Undercut and Rally) under 20 ema here."
  ([sunday-scans-744](https://unchartedterritoryy.substack.com/p/sunday-scans-744))
- 2025-09-14, AFRM: "Retested $80 pre earnings highs and Solid UnR (Undercut and Reclaim) at the 20EMA and support
  spots. Need the hourly to form some high lows now." ([sunday-scans-461](https://unchartedterritoryy.substack.com/p/sunday-scans-461))
  He spells out "UnR" as "Undercut and Rally" and as "Undercut and Reclaim"; they are the same setup to him.

**The stop, the trim, the trail.**
- 2025-06-22, QBTS: "Looking for an undercut of $15 and recclaim [sic] of last week's low there. Would be actionable for a
  low risk entry spot. Stop at LOD if this triggers." And: "My stops are always LOD until I can raise them to breakeven,
  trim 1/4 - 1/3 on a 3-6 day push, then trail the rest with a stop below the 9 and 20 period moving averages."
  ([sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)) This is from June 2025; the
  rulebook of 2026-11-09 (trims at 3R and 5R) now governs.
- 2025-07-13, RDDT: "Two scenarios possible, Break inside day high of $147.40 and trend towards recent highs or undercut
  and reclaim $141.30 with a stop at the new established support."
  ([sunday-scans-6a6](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6))
- 2026-10-04, ARM: "Tried a few times on Monday with very tight risk and then got my spot on Wednesday. Think if you are
  looking to get in you look for $300 UnR to grab it."
  ([sunday-scans-4c6](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6))

**Where he wants it, and where he does not.**
- 2026-07-05: "I prefer key levels of support, 20EMA or 50SMA, notable bull gap holds or weekly levels, undercut and
  reclaims. Anything sensible that I can logically risk against and repeat on RS names and liquid leaders."
  ([sunday-scans-dec](https://unchartedterritoryy.substack.com/p/sunday-scans-dec))
- 2026-09-06: "Here is my approach. Give me an oops. Give me some sideways and a tap of the 20EMA. Give me an inside day.
  Give me a clean retest or remount after and undercut."
  ([sunday-scans-fcd](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd))
- 2025-08-24, RBRK (a pass): "Have been watching closely for an undercut of $80. We got that but I did not like the
  declining moving averages. Waiting for this to push out and form a higher low to get involved."
  ([sunday-scans-ffa](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa))
- 2025-12-07: "The type of short term undercut on a stock that is below the MAs is just not something I generally do. I
  am working on analysis to add a variety of that setup into my playbook right now."
  ([sunday-scans-088](https://unchartedterritoryy.substack.com/p/sunday-scans-088))
- 2025-10-26: "Buying those shakeouts is the optimal RR." And in the "Closing Comments and Mindset" section (unsigned; it follows his): "As for the higher
  beta/leadership stocks we have to either buy those pullbacks into key UnR and hold spots or wait for further basing
  and build out. Higher lows will guide us." ([sunday-scans-13e](https://unchartedterritoryy.substack.com/p/sunday-scans-13e))
- 2025-06-29 ("Closing Comments and Mindset", unsigned; it follows his section): "undercuts or holds of MAs have been better than classic pivot breakouts."
  ([sunday-scans-d70](https://unchartedterritoryy.substack.com/p/sunday-scans-d70))

**The levels he names** (a sample; each is a real note):
- Prior highs and old breakout levels: PLTR, "ideal spot would've been the UnR at $170"; IREN, "Nice UnR of the previous
  highs from Sept and dip below the $50 spot." (2025-10-26); DOCN, "$133 area is the previous 2021 ATHs. Ideally we see a
  little UnR of that spot here." (2026-09-27, [sunday-scans-09b](https://unchartedterritoryy.substack.com/p/sunday-scans-09b));
  NBIS, "All it did was pull back and undercut that previous high at $141, reclaim it perfectly, get nice and tight
  ahead of earnings, and then blast off." (2026-05-17, [sunday-scans-679](https://unchartedterritoryy.substack.com/p/sunday-scans-679))
- Round numbers and flat levels: MRVL, "Give me $250 UnR." (2026-09-27); AMD, "Would be interested in a $600 UnR and
  20EMA tap."; SPCX, "Watching $160 flat for UnR spot." (2026-10-11, [sunday-scans-31b](https://unchartedterritoryy.substack.com/p/sunday-scans-31b));
  U, "This is a very good UnR of the $40 level, and quick shakeout below the base."
  ([sunday-scans-70f](https://unchartedterritoryy.substack.com/p/sunday-scans-70f))
- The 20-day and the inside day: DELL, "The 20EMA undercut and reclaim on 8/7 is tight risk plus the RS that it has
  shown is worthy of my risk!" (2026-08-16, [sunday-scans-da5](https://unchartedterritoryy.substack.com/p/sunday-scans-da5));
  AAOI, "AAOI ($26.85) bought the undercut and reclaim of the inside day following the base breakout attempt."
  (2025-09-14)
- The earnings day's low: MXL, "This MXL from the day three undercut of earnings day low at $50 has gone on to double and
  is now flagging, showing relative strength into the 9EMA." (2026-05-17)
- A range, then a remount: TEAM, "Pulls into and undercuts this range slightly closing with a strong lower wick.
  Remounts MAs and breaks highs." And: "Clean $30 min pivot at $172 is the ideal buy." (2026-10-11)
- Intraday levels: APPS, he will look "for an Opening Range Break or a" "VWAP undercut and rally" (2025-11-05,
  [the-rest-of-the-week-9c9](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9)); BE, "The VWAP
  undercut intraday needs to be studied. This is S tier type setup and trade opportunity." (2026-09-27)
- The weekly chart: BIDU, "Weekly UnR of late 2024 highs." (2025-12-07)
- Leveraged index ETFs: "I will be looking for a UnR essentially on SPXL this week early on." (2026-06-28,
  [sunday-scans-ae1](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1)); "SOXL and SNDK UnR I thought were
  good opportunities mid week." (2026-07-12, [sunday-scans-898](https://unchartedterritoryy.substack.com/p/sunday-scans-898))

**Rules he states while passing or retrying.**
- U (2026-11-08): "I was pretty interested in it but held off due to earnings." And: "My hard rule, as soon as there is
  buyout stuff I take it off my list."
- NBIS (2026-05-17): "Just got shaken out too many times in the one $150 to $140 zone and it was doing nothing wrong."
- HPE (2026-10-04): "I wanted an undercut and move to $59 ish." "I was looking forward to putting 30%+ of my account in
  if we got a hold around that $59 level."

**Two low-priced examples** that the house liquidity rule (B23, $10+) now excludes: TE, "Just a picture perfect UnR at
the $3.00 spot." (2025-11-30, [sunday-scans-422](https://unchartedterritoryy.substack.com/p/sunday-scans-422)); OPEN,
about $6.50, "Could be the ultimate UnR of our lifetime." (2025-11-09,
[sunday-scans-720](https://unchartedterritoryy.substack.com/p/sunday-scans-720)).

### 6.3 Bracco

- **Market turns.** QQQ: "Perhaps a undercut and rally of that level could mark a tradable bottom."
  (2025-08-03, [sunday-scans-726](https://unchartedterritoryy.substack.com/p/sunday-scans-726)); "Favorite trading
  scenario from here is further weakness into a failed breakdown of the June lows leading to a big undercut and rally."
  (2026-07-05, [sunday-scans-dec](https://unchartedterritoryy.substack.com/p/sunday-scans-dec)); "QQQ attempting to stage
  a U&R of the $700 level and perfectly held the follow-through day anchored VWAP from 4/8 (yellow line)." (2026-06-14,
  [sunday-scans-e95](https://unchartedterritoryy.substack.com/p/sunday-scans-e95)); "Think a undercut and rally of the
  200SMA and the late July lows is very tradable via SOXL." (2026-10-25,
  [sunday-scans-36e](https://unchartedterritoryy.substack.com/p/sunday-scans-36e)).
- **The leaders lead out of the market's low with this shape.** "As the indices broke down and trended significantly
  below previous lows, all the RS names briefly undercut those previous lows and reclaimed as market came off the lows."
  "HOOD PLTR NFLX SPOT GEV all notable names that put in this exact reversal pattern near their 200-day moving averages
  and went on to lead the market higher." He calls two current examples "2B reversals" in the same note. (2026-04-05,
  [sunday-scans-356](https://unchartedterritoryy.substack.com/p/sunday-scans-356)) This is Morales's "market turn" in
  UCT's own words.
- **The max-pain undercut.** The market "typically like to undercut big support areas before reclaiming (if they do).
  The max pain scenario." (2026-03-22, [sunday-scans-cab](https://unchartedterritoryy.substack.com/p/sunday-scans-cab))
- **MAU&R as mean reversion.** "These all staged MAU&R's (moving average undercut and rallies) with most closing strong on
  Friday. This resulted in a plethora of hammer candles off the 10 week moving averages." And: "The great part about
  these setups was the Nasdaq contracting and building higher lows as these names hit oversold territory" (2025-10-26,
  [sunday-scans-13e](https://unchartedterritoryy.substack.com/p/sunday-scans-13e)). UAMY: "UAMY undercut and rally at
  $10 and daily 20ema is also in play. These are short lived trades and not meant to be held longer than 1-3 days. Mean
  reversion play." (2025-10-19, [sunday-scans-6cc](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc))
- **His own trade, with the risk.** FIGR: "Got long at 49.81 yesterday on the classic mean reversion setup." "At lows of
  the day it was a -244% ATR move on the $50 psych level washout. It was also U&R of the previous all time high. Risked
  80 cents and covered some on the bounce." (posted the evening of 13 Jan 2026 US time,
  [the-rest-of-the-week-305](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305))
- **Waiting for it in a leader.** ETHA: "Looking to really load the boat here if this can get tight following that
  undercut and rally." (2025-10-05, [sunday-scans-6ef](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef));
  IONQ: "In a perfect world this undercuts the 20EMA and reclaims." (2025-10-01,
  [the-rest-of-the-week](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week))
- **On the short side.** In his parabolic-short plan: "You will sometimes see a sharp bounce or undercut and rally of the
  9/10 EMA following a sharp reversal off of the highs within a very strong trend." (2025-12-28,
  [sunday-scans-249](https://unchartedterritoryy.substack.com/p/sunday-scans-249)) A U&R is where a short covers, as
  Morales says.

### 6.4 Other UCT writers

- Unsigned "Week Ahead" (2025-06-02): "Watching for U&R's (undercut and rallies) at key pivots like 9EMA and HVC (high
  volume close) from 5/23 ignition day." On IGV: "It staged a 3-year base breakout in Q4 of 2024 and recently put in a
  massive U&R at that same breakout level." ([week-ahead](https://unchartedterritoryy.substack.com/p/week-ahead))
- The Index & ETF writer: "UnR (Undercut & Reclaim or Rally)" (2025-10-26); "Willing to keep eye out for a UnR
  (Undercut and Reclaim) of the flat base we are consolidating below." (2025-09-28,
  [sunday-scans-9a2](https://unchartedterritoryy.substack.com/p/sunday-scans-9a2)); "This is also IBIT at the 200SMA
  with an undercut and rally." (2025-11-09)
- Manrav: "Want to see the 21 EMA hold or an undercut and reclaim is even better to get long/add to the position."
  (2025-11-05, [the-rest-of-the-week-9c9](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9));
  "Massive base and now we have an undercut and reclaim of the 200 SMA + a launch pad in the making." (2025-10-08,
  [the-rest-of-the-week-208](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208))
- The Wiz, his "gap gotcha hammer": "Gap up, followed by an UnR of that gap candle low and closing back inside the bar
  with a hammer." "Preferably undercutting some EMAs, but not always necessary if the stock is strong. Stop being the low
  of the day." (2026-01-07, [the-rest-of-the-week-3f0](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0))
- Jersace: "Also showing strength off the UnR of the 10wk SMA with a relative flag." (2025-12-17,
  [the-rest-of-the-week-4fe](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-4fe))

### 6.5 UCT's private knowledge base, as stored in this repo (an AI summary, not anyone's exact words)

`docs/study/levels/brain_kb_2026-11-06.json` holds an export of UCT's internal knowledge base. It includes a "U&R"
template written by the knowledge base's AI from UCT's archive. It is a summary, not a quote of the owner, and nobody has
reviewed it (the agent's copy is marked `"reviewed": false`). In short it says: buy "the reclaim above the violated
level" of a moving average, a prior base low, a high-volume close or a pivot; a strong close on the reclaim day is the
key confirmation and a close near the lows negates it; the stop goes at the low of the undercut candle (for a moving
average version, at the average); a maximum stop of 8%; a first target of 10-15%; trail under rising averages. Its
listed mistakes include "Buying undercuts when moving averages are declining rather than rising" and entering on the
undercut before the reclaim. The owner's 0.7% gap-down line (section 6.2) appears in its Go Signal template almost word
for word. Use it as a pointer to what the owner may have said, then confirm with him.

### 6.6 What UCT's usage adds up to

1. **UnR is a family word.** UCT uses it for any obvious level taken out and taken back: prior lows, prior highs, base
   lows, round numbers, the 20 EMA, the 50 and 200-day, the 10-week, gap lows, VWAP and anchored VWAPs, weekly levels.
2. **It is mostly a one- or two-day event**, and the owner buys it intraday (opening range, VWAP, 30-minute pivot, the
   hourly, red to green), with the stop at the low of the day.
3. **It is a leader's setup for the owner** ("RS names and liquid leaders"), and he passes when the averages are
   declining or the stock is below them. **For Bracco it is also a market-turn and mean-reversion trade**, short-lived,
   often in index ETFs or washed-out leaders.
4. **He retries** (ARM, NBIS) and he **skips for earnings and buyout news** (U).
5. **Volume is almost never mentioned** as a requirement; strong closes, lower wicks and hammers are.
6. **The Go Signal is its hourly twin** (his ruling), and Gap Support is the same idea at one specific level.

### 6.7 Candidate model examples (for his review; bar facts, not rulings)

Bar facts are from the local daily bars. "Stop" is 5 cents under that day's low as a percent of the close. "Replay" is
the house plan (section 4.3) from that day's close. These are teaching candidates the owner has not graded.

| # | Session | Who named it, and the words | Level | Low / close / DCR | Stop | 200-day | Replay | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | AFRM 2025-09-12 | Owner: "Solid UnR (Undercut and Reclaim) at the 20EMA and support spots" | $80 (pre-earnings highs) | 79.40 / 83.08 / 0.79 | 4.5% | above, rising | 0.0R (reached 2.5R, then breakeven) | Stop over 3% on a close entry |
| 2 | RDDT 2025-07-18 | Owner's plan: "undercut and reclaim $141.30" | $141.30 | 138.11 / 148.24 / 0.92 | 6.9% | above, rising | +5.07R | A first try on 07-16 (low 138.30, close 144.31) was stopped (-1.0R): two tries |
| 3 | AAOI 2025-09-12 | Owner bought at $26.85: "the undercut and reclaim of the inside day" | inside-day low 26.28 | 26.02 / 27.07 / 0.72 | 4.1% (3.3% from his fill) | above, rising | +1.6R | His own trade |
| 4 | ZS 2025-09-03 | Owner: "undercut the base on earnings and remounted all MAs" | base low | 260.40 / 270.58 / 0.72 | 3.8% | above, rising | +0.87R | Earnings reaction day, RVOL 3.4; he bought later, at $288.50 |
| 5 | PLTR 2025-10-22 | Owner: "ideal spot would've been the UnR at $170" | $170 | 169.42 / 175.49 / 0.47 | 3.5% | above, rising | +3.5R | Weak close (DCR under 0.5) still worked |
| 6 | IREN 2025-10-22 | Owner: "Nice UnR of the previous highs from Sept and dip below the $50 spot." | $50, the September highs | 48.20 / 51.83 / 0.38 | 7.1% | above, rising | +2.16R | Prior high as the level; wide stop |
| 7 | FIGR 2026-01-12 | Bracco: "U&R of the previous all time high", long 49.81, "Risked 80 cents" | $50, the prior high | 49.10 / 52.23 / 0.33 | 6.1% (his 80 cents = 1.6% from his fill; 5 cents under the day's low = 1.5%) | none (IPO in 2025) | +3.78R | Mean-reversion framing; B26 cannot be applied without a 200-day |
| 8 | MXL 2026-04-28 | Owner: "day three undercut of earnings day low at $50" | $50 (the owner's level). The earnings day's low in our bars is 53.70, and the 04-28 close of 52.01 did not reclaim it; $50 is what was undercut and reclaimed | 49.60 / 52.01 / 0.37 | 4.7% | above, rising | +8.21R | 40.9% over its 10-day average: C29 would have blocked it |
| 9 | NBIS 2026-04-29 | Owner: "undercut that previous high at $141, reclaim it perfectly" | $141 | 134.22 / 141.19 / 0.74 | 5.0% | above, rising | +5.07R | 04-27 try failed (-1.0R); "shaken out too many times" |
| 10 | DELL 2026-08-07 | Owner: "The 20EMA undercut and reclaim on 8/7 is tight risk" | 20-day EMA, about 423-426 | 416.30 / 453.77 / 0.95 | 8.3% | above, rising | -0.31R | Tight only with an intraday entry near the average |
| 11 | TEAM 2026-09-29 | Owner: "undercuts this range slightly closing with a strong lower wick" | the range low | 168.05 / 175.96 / 0.69 | 4.5% | above, rising | +3.85R | His buy: the 30-minute pivot at $172 |
| 12 | U 2026-11-03 | Owner: "very good UnR of the $40 level" | $40 | 38.30 / 40.48 / 0.92 | 5.5% | above, not rising | +4.45R | He passed: earnings, then buyout news. A valid shape skipped by rule |
| 13 | HOOD 2025-04-07 | Bracco (2026-04-05): RS names "briefly undercut those previous lows and reclaimed" | prior lows near the 200-day | 29.66 / 35.41 / 0.77 | 16.4% | above, rising | +6.55R | A market-turn U&R; the daily stop breaks A13 badly |

(Cold check: every number in this table was re-derived from the local bars on 2026-11-09 and matched. The writer's
note that WULF, named in the same 2025-09-14 post, had no bars is out of date: the bars are there, but the owner's WULF
note is a breakout and an HVC hold, not a U&R, so it is not a candidate.) None of the 13 has a stop within 3% when
bought at the close; the closest are PLTR (3.5%) and ZS (3.8%). They fit A13 only with the owner's kind of entry, intraday and near
the level (FIGR 1.6% from Bracco's fill; AAOI 3.3% from the owner's, just over). That is the strongest practical
lesson of this table. A note on timing: in our test (section 4.3) a reclaim one session later did no worse than a
same-day reclaim, so "same day" is a preference, not a measured edge.

## 7. How it fits the owner's account rulebook (`docs/study/sizing_rule.md` section 9)

| Rule | How it applies to the U&R | Conflict? |
|---|---|---|
| A3, F62: stop a few cents under the day's low or the prior day's low | The natural stop is a few cents under the undercut low, which is that day's low (or the low of the 1-3 days under the level) | Fits. Our scanners do not: 1.5% under (public) and exactly at the low (internal) |
| A13: stops usually within about 3% | On a close entry the median stop was 2.6% (E1) and 1.7% (E2), but 3-6% undercuts had 5.8% stops, and none of the 13 named examples was within 3% from the close (section 6.7) | **Partial conflict.** Fits only with an intraday entry near the level, or with a smaller size (A5) |
| A5, A7, E49: size from the stop, 40% cap, risk by grade | Normal. A wide U&R stop simply means fewer shares | The scanner narrative's "larger size" advice conflicts and should go |
| E57: market orders | Buy with a market order as the level is taken back | Fits |
| C28: no buying more than 4% over the buy point | The buy point is the level | Fits. After a big reclaim day, the close can be well over 4% from the level (DELL, HOOD) |
| C29: skip a long more than 10% over its 10-day average | Rarely binds (20 of 25,310 E1 events) | **Conflict on post-earnings U&Rs**: MXL's owner-praised undercut was 40.9% over its 10-day average |
| B26: no longs under the 200-day SMA (hard) | Most of the owner's U&Rs are above it | **Conflict with the originator's best case**: Morales's best U&Rs come at a market turn, and Bracco's leaders reclaimed "near their 200-day moving averages"; washout U&Rs can sit under it. A recent IPO has no 200-day at all (FIGR) |
| C31: RS 80+, except parabolic and mean-reversion trades | Applies to the owner's leader U&R | **Open**: Bracco calls the washout U&R a "Mean reversion play", which C31 exempts. Which family is the U&R? (question 4) |
| B19, E51, E52, F63: breakeven at 2R-5R, a third at 3R and 5R, trail the 10 or 21-day | House default | Conflicts with the scanners' 2R/3R targets, the journal template's "first piece into the prior high", and Bracco's 1-3 day mean-reversion holds |
| C33: under 1R after 10 sessions, out | Applies | Fits |
| B20: gap through the stop | Applies | Fits |
| B21, E56: re-buy only on a new trigger; 3 tries a week, 6 a month | The owner retries U&Rs (ARM, NBIS) | Fits; teach the limit |
| B22: no new buys within 3 days of earnings | The owner skipped U for this | Fits. An earnings-reaction U&R (ZS) is after the report, so it is allowed |
| B23: $10+ and $20M a day | TE ($3) and OPEN (about $6.50) fail | Fits; drop them as lessons |
| B18, F65: market reading | Green full; Yellow smaller; Orange A+ only; Red mostly cash | Fits |
| D47: shorts are the long setups reversed | The mirror is the upthrust (section 8.6), short only under the 200-day | Fits |
| D41, D39: a real stop order; the plan written before the open | Write the level and the stop before the open; the buy waits for the reclaim | Fits |

## 8. Proposed rules for our course

Each line is measurable and tagged. Where sources disagree I give the options and a recommendation.

### 8.1 What it is (all must hold)

1. **Liquid.** Price $10 or more, at least $20 million traded a day (20-day average), and your position under 1% of
   average daily volume. [house rule] B23, D42
2. **Above the 200-day.** The buy-day close is above the 200-day SMA. [house rule] B26. (The market-turn exception is
   question 3.)
3. **The trend is not falling.** The 50-day SMA today is at or above its value 10 sessions ago, and the buy-day close
   is above the 50-day SMA (a MAU&R of the 50-day reclaims it by definition). [UCT] the owner's RBRK pass ("I did not
   like the declining moving averages") and his note that an undercut "below the MAs is just not something I generally
   do"; [my proposal] the 10-session test and the 50-day as the line (it is also the internal scanner's gate).
4. **A leader.** RS rating 80 or more, in one of the strongest groups. [house rule] C31 (the rule names no number for
   the group; the RS floor is the measurable part). (Unless the owner rules the washout version mean reversion;
   question 4.)
5. **The level (L) is one of these:**
   - a. **A prior low in the pattern:** a swing low (under the 3 lows before it, not above the 3 after it) that price
     then bounced at least 5% off, 5 to 60 sessions before the undercut. [originator] Morales "a prior low in the
     pattern"; EdgeRater's 5% category; [my proposal] the numbers.
   - b. **The low of a base or range:** the lowest low of at least the prior 10 sessions. [originator] VoSI "along the
     lows of a potential new base"; [measured] the 10-session range low was the only variant of our internal rule that
     beat its baseline; [UCT] "$160 flat", "quick shakeout below the base".
   - c. **A rising 20-day EMA or 50-day SMA (the MAU&R)** that the stock closed above the session before. [originator]
     VoSI MAU&R; [UCT] the owner's "20EMA undercut and reclaim", Bracco's MAU&R.
   - d. **A prior high or breakout level, the gap-up day's low, or a round number at one of the above.** [UCT] PLTR
     $170, IREN $50, NBIS $141, MXL; the owner's Gap Support ruling.
   - **Not enough on its own: the prior day's low.** [measured] that variant was flat against its baseline; [UCT] the
     owner on a tiny undercut: "a little subtle and hidden".
6. **A fresh, visible undercut.** The session before the undercut closed above L; the low then trades under L. [source
   consensus] Wyckoff, Morales, Turtle Soup.
7. **Shallow.** The undercut low is no more than 3% under L for an A grade and no more than 6% at all; deeper is not
   this setup. [measured] 6%+ undercuts had the worst results and 10% stops; [my proposal] the 3% and 6% lines.
   (Morales gives no number on purpose; question 5.)
8. **Brief.** Price closes back above L the same session or within the next 3; no more than 3 closes under L. [source
   consensus] Wyckoff "quickly reverses", Turtle Soup (same day) and Turtle Soup Plus One (the next day), Deepvue's
   bars (same day); [UCT] the journal template's "a day or two"; [my proposal] 3 sessions. Longer is a Remount
   (setup 32).
9. **Volume is not required.** [originator] Morales: "Volume is generally not a factor"; [measured] high-volume reclaims
   were not better. Light volume on the undercut is a grade-up (section 9). [originator] Wyckoff.
10. **Not stretched, not chased.** At the buy, price is no more than 4% over L and no more than 10% over its 10-day
    average. [house rule] C28, C29. (The post-earnings conflict is question 9.)
11. **No event risk.** No earnings report in the next 3 sessions and no pending buyout or deal. [house rule] B22; [UCT]
    "My hard rule, as soon as there is buyout stuff I take it off my list."

### 8.2 The buy

- **Option A, the owner's way (recommended for anyone watching the open):** a market order as price trades back above
  L during the session, confirmed by an intraday turn: an opening-range-high break, a VWAP reclaim, a 30-minute pivot,
  or red to green. [UCT] ARM ("very tight risk"), TEAM ("Clean $30 min pivot"), QQQ ("opening ranges being taken
  out"); [house rule] E57.
- **Option B, for someone who cannot watch:** buy near the close of a reclaim day that closes in the top half of its
  range (DCR 0.5 or more). [measured] top-half closes followed through 68% of the time against 43%; [UCT] the
  knowledge-base template's "Strong close on reclaim day".
- **Option C, confirmation (IBD style):** buy only when price clears a set distance over the old low. [originator] IBD
  shakeout-plus-three. A later, higher entry with a wider stop; I do not recommend it as the default.
- **Never buy the undercut itself** before the level is back. [source consensus] Morales ("rallies back above it"),
  Turtle Soup (a buy-stop "slightly above the previous 20-day low"), IBD's shakeout-plus-three (the buy is three points
  over the old low); [UCT] the journal template ("Enter on the reclaim, never on the undercut.") and the knowledge-base
  template. One school differs: Wyckoff's tutorial allows "at least a partial long position" on a low-volume spring
  itself, before any test.
- Write L, the stop and the size before the open. [house rule] D39.

**Recommendation:** teach A as our default and B as the fallback. Our test shows why: entering near the level is what
keeps the stop small (section 4.3, Table C and section 6.7).

### 8.3 The stop

- **A few cents under the undercut low** (the lowest low while price was under L). [house rule] A3, F62; [originator]
  Turtle Soup "just below today's low"; [UCT] "Stop at LOD", "a stop at the new established support".
- **If that is more than about 3% from the entry, size down (A5 does it automatically) or skip. Never move the stop up
  to make it fit.** [house rule] A3, A13.
- **MAU&R option:** VoSI puts the stop "1-2% below the line". I recommend the house default instead (under the undercut
  low): it is the price that proves the trap wrong, and it matches every UCT note. [my proposal]
- A gap through the stop follows B20. [house rule]

### 8.4 Trims and trail (house defaults)

- Stop to breakeven once the trade has made 2R to 5R. [house rule] B19
- A third off at 3R, a third at 5R; at the open if it gaps past. [house rule] B19, E51, F63
- Trail the last third: a close under the 10-day average for fast movers, the 21-day for steadier ones. [house rule] E52
- Under +1R after 10 sessions: out. [house rule] C33
- **Mean-reversion version:** Bracco holds these "1-3 days" and "covered some on the bounce". If the owner wants a
  separate plan for the washout U&R, it needs a ruling (question 7). [UCT]

### 8.5 What invalidates it

- **No close back above L within 3 sessions:** a breakdown, not a U&R. No trade. [source consensus; my proposal for the
  3]
- **A trade under the undercut low after the buy:** the stop. [house rule] A4
- **A close back under L after the buy:** the early warning (the journal template: "It reclaims the level, then closes
  back below it. The trap failed, and the sellers were right."). Options: sell at that close, or hold to the stop.
  **Recommend: hold to the stop** (A4: the stop is the exit) **and do not add.** Question 8.
- **Declining averages, price under its averages, earnings within 3 days, buyout news:** no trade. [UCT; house rule
  B22]
- **A new try only on a new trigger**, at most 3 a week and 6 a month on one stock. [house rule] B21, E56

### 8.6 The short mirror

Shorts are our long setups reversed (D47), so the mirror is the **failed breakout, or upthrust**: price trades above an
obvious high (a prior swing high, a base high, a falling 20-day or 50-day) and closes back under it. Short as it trades
back under the level; stop a few cents over the high of the poke; only below the 200-day SMA (B26), in a weak stock (RS
20 or less, C31) that is easy to borrow (D48). [house rule] D47; [originator] Wyckoff: "a UT is the opposite of a
spring"; Turtle Soup: "SELLs are reversed" (StockCharts). The app already has `wyckoff_upthrust` and the 2B Reversal
works both ways. Teaching note: Morales covers his shorts at undercuts of prior lows, so a short sitting in a stock that
is undercutting an obvious low is exactly who this setup traps. [originator]

### 8.7 Best market conditions

- A Green or Yellow market reading; Orange only for A+; Red mostly cash. [house rule] B18, F65, D46
- Best of all: right after a correction, as the market turns up, and especially when the index itself undercuts and
  reclaims a big support. [originator] Morales ("in conjunction with a market turn to the upside after a period of
  correcting"); [UCT] Bracco (the RS names that "briefly undercut those previous lows and reclaimed" in April 2025; the
  Nasdaq "contracting and building higher lows"). [measured] slightly better when SPY was under its 50-day, but not by
  much more than the noise.

### 8.8 Common mistakes

1. Buying the undercut before the reclaim. [source consensus]
2. Calling every dip under yesterday's low a U&R. [measured] flat; [UCT] "a little subtle and hidden".
3. Buying undercuts under declining averages. [UCT] RBRK
4. Undercuts deeper than about 6%. [measured]
5. Buying the close of a huge reclaim day and thinking the risk is tight (DELL: 8.3% from the close). [examples]
6. Chasing more than 4% over the level. [house rule] C28
7. Ignoring an earnings date or buyout news. [house rule] B22; [UCT] U
8. Endless retries in one zone. [house rule] E56; [UCT] NBIS "shaken out too many times"
9. Cheap or thin stocks. [house rule] B23
10. Waiting for a volume surge that the setup does not need. [originator] Morales; [measured]
11. Mixing it up with its cousins: the **Remount** (a long stay under a line), **Gap Support** (the gap-up low), the
    **Oops** (a gap open under the prior low), the **Go Signal** (hourly), the **2B** (any failed extreme).

## 9. Grading: what makes an A+ versus a B-

The owner ruled grading discretionary (E50), and size follows the grade (D38, E49). This is a guide, from the sources.

| Feature | A+ | A / B | B- |
|---|---|---|---|
| The stock | Leader, RS 90+, top group [my proposal; C31 sets the floor at 80; UCT "RS names"] | RS 80+ | RS 80 borderline, middling group |
| Trend | Above a rising 50-day and 200-day, averages stacked [UCT] | Above both, 50-day flat | 50-day falling or price under its averages (normally a pass) [UCT RBRK] |
| The level | The low of a multi-week base, a prior breakout level or prior high, or a rising 20/50-day that has held before [originator; UCT; measured] | A clear swing low or round number | Only the prior day's low, or a level price has crossed many times [measured; our drawing's "chop line" rule] |
| Undercut | Visible but shallow, 3% or less, back above within 1-2 sessions [measured: depth; UCT "quick shakeout"] | Up to 3%, back above within 3 sessions | 3-6% deep, or a full 3 sessions under |
| Reclaim day | Closes in the top half or better, clearly back over L [measured: follow-through 68%; knowledge-base template] | Closes back over L, mid-range | Bottom half (weak) [measured: follow-through 43%] |
| Volume | Light on the undercut [originator Wyckoff] | Any | Heavy selling that keeps coming |
| Market | Turning up after a correction, or the index doing its own U&R; Green [originator Morales; UCT Bracco] | Green or Yellow | Orange or Red, or the index breaking down |
| Stop | 3% or less from the entry [house rule A13] | About 3% | Over 3% (size down) |
| Events | No report for weeks | No report within 3 days (B22) | A report within a week |

## 10. Questions for the owner

1. **One setup or two?** (a) One "U&R" lesson with the one-day "Undercut & Reclaim" as its most common form; (b) two
   lessons, "U&R" (multi-day, prior low) and "Undercut & Reclaim" (one day, any level); (c) one lesson plus the MAU&R
   as a named variant. I lean to (c): your own notes use "UnR" for both words.
2. **Which levels count?** (a) only prior lows and base lows (Morales); (b) those plus rising moving averages (MAU&R);
   (c) any obvious level, including prior highs, round numbers, gap lows, VWAP (your usage). And should the prior day's
   low alone count? Our test says it is not special.
3. **The 200-day.** The originator's best U&Rs come at market turns, often near the 200-day. Options: (a) B26 as it
   stands (no buy under the 200-day); (b) allow a reclaim that closes back above the 200-day; (c) treat a washout U&R
   under the 200-day as a parabolic long (a "burst down") and allow it under B26's exception.
4. **Leader setup or mean reversion?** C31 exempts mean-reversion trades from RS 80+. Bracco calls his washout U&Rs
   "Mean reversion play". Options: (a) the U&R is a leader setup, RS 80+ always; (b) two kinds: the leader U&R (RS
   80+, house trims) and the washout U&R (no RS rule, quick exit).
5. **How deep and how long?** Morales refuses a number. Options: (a) no number, judgment only; (b) my proposal: 3% for
   an A grade, 6% at most, and back above within 3 sessions; (c) an ATR-based limit (for example 1 ATR).
6. **The entry.** (a) intraday reclaim with an opening-range, VWAP or 30-minute confirmation (your practice); (b) the
   close of a strong reclaim day; (c) both, with (a) as the default. I recommend (c).
7. **Trims.** House defaults (3R and 5R, trail the 10 or 21-day) for all U&Rs, or a quicker exit for the mean-reversion
   kind?
8. **A close back under the level after you buy.** (a) sell at that close; (b) hold to the stop. I recommend (b), per
   A4.
9. **C29 and post-earnings U&Rs.** Your MXL example was 40.9% over its 10-day average, so C29 would have skipped it.
   Options: (a) C29 wins; (b) exempt U&Rs of an earnings-day low in the first week after the gap; (c) measure the
   stretch from the level instead of the 10-day average for this setup.
10. **Volume.** Required on the reclaim (the journal template's "rising volume"), or not (Morales, and our test)?
11. **The scanners.** (a) fix `u_and_r.py`'s text (Shannon, the 70% claim, DeMark, Turtle Soup, sizing advice) and its
    entry, stop and liquidity; (b) retire it and build the lesson finder from the drawing rule and the internal rule's
    10-session-range-low variant; (c) leave the code and fix only the member text. I recommend (a) at minimum for the
    text: any surface that shows this detection's narrative would show the invented statistic.
12. **The Zoom recording.** Our vocabulary file places the U&R's definition in a recorded live Zoom session
    (edu_videos:355, at 00:14:08 and 00:36:06). Is that you, and may we transcribe that part? It may be the best "how we trade it" source we have.
13. **Examples.** Which of the 13 candidates in section 6.7 are good models, and should the sub-$10 ones (TE, OPEN) stay
    out of the lessons?
14. **The short mirror.** Teach the upthrust under the 200-day as "the U&R reversed" in this lesson, or leave it to the
    Wyckoff (setup 35) and 2B (setup 28) lessons?

## 11. Sources

All read 2026-11-09 unless marked. "Saved" = downloaded and checked by script; "page tool" = read through a fetching
tool because the site refused a plain download.

| # | Source | Publisher / author | How read | Reliability |
|---|---|---|---|---|
| 1 | [Glossary & Trading Methods](https://theowltrader.com/glossary-trading-methods/) and [About](https://theowltrader.com/about/) | The OWL Trader, Gil Morales (site (c)2023, undated entries) | Saved | Originator of the name. High for definition; no numbers |
| 2 | [What is the MAU&R pattern?](https://www.virtueofselfishinvesting.com/faqs/answer/what-is-the-moving-average-undercut-rally-mau-r-pattern) | Virtue of Selfish Investing (MoKa Investors: Morales and Kacher), first published 13 Jul 2017 | Saved | Originator. High |
| 3 | [Gil Morales: Undercut and Rally template](https://edgerater.com/tradingtemplates/gm_undercutandrally) and the [webinar replay page](https://edgerater.com/WebinarReplay/undercutandrallytemplate) | EdgeRater (software vendor), undated; the replay page dates the talk to April 2019 | Saved; replay page read live in checking | Secondary report of a Morales talk. Medium |
| 4 | [In the Trading Cockpit with the O'Neil Disciples, publisher preview](https://api.pageplace.de/preview/DT0400.9781118287293_A23567645/preview-9781118287293_A23567645.pdf) | Wiley, Morales and Kacher, 2013 | Saved (preview only) | No U&R text in the preview; table of contents only |
| 5 | [IBD column on the double bottom and the shakeout-plus-three](https://finance.yahoo.com/news/spot-early-buy-point-double-195200041.html) | Investor's Business Daily via Yahoo Finance, 16 Apr 2015 | Page tool | Established educator. High for IBD's rule |
| 6 | [IBD column on the proper handle and its shakeout](https://finance.yahoo.com/news/why-look-proper-handle-often-220600578.html) | Investor's Business Daily via Yahoo Finance, 25 Feb 2015 | Page tool | Established educator. High |
| 7 | [The Wyckoff Method: A Tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial) | StockCharts ChartSchool; Roman Bogomazov and Michael Lipsett | Saved | Established educator of the Wyckoff school. High |
| 8 | [The Wyckoff Method](https://www.wyckoffanalytics.com/wyckoff-method/) | Wyckoff Analytics (Bogomazov) | Saved | Same text as 7. High |
| 9 | [Combining Relative Rotation Graphs and the "Turtle Soup" setup](https://articles.stockcharts.com/article/articles-rrg-2018-06-combining-relative-rotation-graphs-and-the-turtle-soup-setup/) | StockCharts, Julius de Kempenaer, 2 Jun 2018 | Saved | Reputable summary of Connors and Raschke; book not read. Medium-high |
| 10 | [Technicals knowledge base](https://deepvue.com/knowledge-base/technical/) | Deepvue | Saved | Vendor scanner definitions. Medium |
| 11 | [Oliver Kell Interview](https://stockbsessed.substack.com/p/oliver-kell-interview-the-mind-and) | Stockbsessed, 1 Apr 2023 | Saved | Originator's words (usage only). Low weight for this setup |
| 12 | Alphatrends pages: [book](https://alphatrends.net/anchored-vwap-book/), [anchored VWAP](https://alphatrends.net/anchored-vwap/), [buy strength after the dip](https://alphatrends.net/dont-buy-the-dip-buy-strength-after-the-dip/), [new visitors](https://alphatrends.net/new-visitors/), two archive posts | Brian Shannon | Saved | Checked for the scanner's attribution; no U&R found |
| 13 | [Qullamaggie: 3 timeless setups](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/), [FAQ](https://qullamaggie.com/faq/) | Kristjan Kullamagi | Saved | No "undercut" found |
| 14 | [Staff Report 125](https://www.newyorkfed.org/research/staff_reports/sr125.html) (PDF read) | Federal Reserve Bank of New York, Carol L. Osler, Apr 2001 (J. Finance 2003) | Saved | Peer-reviewed. High, but currency markets |
| 15 | [Staff Report 150](https://www.newyorkfed.org/research/staff_reports/sr150.html) (PDF read) | Federal Reserve Bank of New York, C. L. Osler, Jul 2002 (J. Int. Money and Finance 2005) | Saved | Peer-reviewed. High, currency markets |
| 16 | [Support for Resistance](https://www.newyorkfed.org/medialibrary/media/research/epr/00v06n2/0007osle.pdf) | FRBNY Economic Policy Review, Osler, July 2000 | Saved (first page) | Background only; not quoted |
| 17 | [Busted chart patterns](https://thepatternsite.com/Busted.html), [Traps](https://thepatternsite.com/Traps.html), [Glossary](https://thepatternsite.com/glossary.html) | Thomas Bulkowski | Page tool, Busted read twice | Measured statistics, but not of a U&R. **The site states: "This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems"**; cited here with links and short quotes only |
| 18 | [UCT Substack sitemap](https://unchartedterritoryy.substack.com/sitemap.xml) and all 103 posts, 2025-06-01 to 2026-11-08 (each quoted post linked in section 6) | Uncharted Territory: the owner (TSDR), Bracco, Manrav, The Wiz, Jersace, unsigned writers | Saved | House source; outranks outside writers for "how we trade it" |
| 19 | Our code: `u_and_r.py`, `uct_undercut_reclaim.py`, `uct_setups_common.py`, `primitives/liquidity.py`, `setup_draw.py`, `auto_structures.py`, `registry.py`, `chart_iq/engine/v2_setups.py`, `screener/bar_character.py`, `screener/saved_screens.py`, `pattern_vision/rubrics.py`, `wyckoff_spring.py`, `routers/patterns.py`, `voice_kb/trading_principles.json` | repo, branch feat/study-content | Read directly | House material; what members see |
| 20 | Our app text: `setupCatalog.js`, `setupGroups.js`, `setupTagMap.js`, `notebookTemplates.js`, `starterScans.json` | repo | Read directly | House material |
| 21 | Our docs: `sizing_rule.md` section 9, `TRADE_PLANS.md`, `owner_verdicts.jsonl`, `UNITS-method.md`, `skill_map.json`, `docs/study/research/definitions.json`, `docs/agent/knowledge/setup-criteria.json`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`, `docs/superpowers/research/setups/setup_criteria.json` and `setup_sources.json`, the Study bank files | repo | Read directly | House rules (sizing_rule, owner_verdicts) are the owner's; the rest are AI-drafted and lower weight |
| 22 | `docs/study/levels/brain_kb_2026-11-06.json` | UCT knowledge base export (AI summaries of UCT's private archive, in this repo) | Read directly | AI summary, unreviewed. Pointer only |
| 23 | Local daily bars (`bars.db`, workbench copy) and my scripts | this dossier | Run read-only | Our own measurement; limits in section 4.3 |
| 24 | [lindaraschke.net/articles](https://lindaraschke.net/articles/) and its 11 linked article PDFs (interviews and articles; dates not checked) | Linda Bradford Raschke | Saved | Originator's site; nothing on Turtle Soup or this setup |
| 25 | [Breakout After Failure](https://tradingmarkets.com/recent/breakout_after_failure-654653) (John Patrick Lee, 25 Jul 2006) and [What Turtle Soup Can Do For You](https://tradingmarkets.com/?p=645410) (Marc Dupee, 13 Jun 2001) | TradingMarkets (Connors's own publishing site) | Read live in checking, plain download | Second-hand summaries of *Street Smarts*' Turtle Soup Plus One; the book itself not read. Medium |

**Not read (named so nobody assumes they were):** Morales and Kacher, *Short-Selling with the O'Neil Disciples* and
*Trade Like an O'Neil Disciple*; Livermore, *How to Trade in Stocks*; Connors and Raschke, *Street Smarts*; William
O'Neil's books; Mark Minervini; Larry Williams; Victor Sperandeo; TraderLion (HTTP 403); the recorded Zoom session
(edu_videos:355). My web search allowance was used up for the whole session before I started, so no new pages could be
found; every page above came from an address already known. (The cold check ran web searches; they found no page that
changes section 2, see section 12.)

## 12. Cold check (2026-11-09): what was confirmed, fixed and removed

**How it was done.** A script pulled every quoted string from this file and searched for it, with curly and straight
quotes treated alike, in the saved copies (section 11's "Saved" sources, all 103 Substack posts, and the repo files
named in sections 5 and 6): 169 distinct quoted strings of three or more words were found word for word; the only
quoted strings not found are this file's own phrases (section titles, the baseline's question, this section's quotes
of the writer's old wording) and the two EdgeRater replay-page sentences, which were read live instead. The eight
quotes from the two "page tool" sources (IBD via Yahoo) were put to the live page one by one as yes/no questions and
all came back word for word; Bulkowski's three numbers and his revision date and AI notice were re-read live; the OWL glossary, the
EdgeRater replay page and the two TradingMarkets articles were re-read live. Every Substack quote was traced to its
post's Substack timestamp and to the section heading above it (owner, Bracco, Index & ETF, Manrav, The Wiz, Jersace,
unsigned), and every attribution in section 6 held. The scanner summaries in section 5 were checked constant by
constant against `u_and_r.py`, `uct_undercut_reclaim.py`, `uct_setups_common.py`, `primitives/liquidity.py`,
`setup_draw.py`, `auto_structures.py`, `registry.py`, `chart_iq/engine/v2_setups.py`, `screener/bar_character.py`,
`screener/saved_screens.py` and `pattern_vision/rubrics.py`; the app-text and docs claims against `setupCatalog.js`,
`setupGroups.js`, `setupTagMap.js`, `notebookTemplates.js`, `starterScans.json`, `UNITS-method.md`,
`trading_principles.json`, `setup-criteria.json`, `setup-vocabulary-v1.json`, `remount.py` and the two earlier research
files. Tables A, B and C in section 4.3 were compared cell by cell with the scripts' output files (`tables_min05.md`,
`tables_e1i.md`, `se_min05.txt`) and matched; the 13 example sessions in section 6.7 were re-derived from the local
bars with the writer's own script and matched. Web searches: nothing from Brian Shannon uses "undercut and rally";
nothing dates the name before Morales and Kacher (their 13 Jul 2017 FAQ remains the earliest dated use found, and
Wiley lists *Short-Selling with the O'Neil Disciples* as 2015); *Street Smarts* is listed as 1995 by some sellers and
1996 by StockCharts, so that stays unresolved.

**Fixed in checking.**
1. Section 3.7: the 2001 TradingMarkets note by Marc Dupee describes the Turtle Soup **Plus One** buy, not Turtle Soup
   itself, so its "previous day's low" stop is the Plus One stop and does not contradict StockCharts. Rewritten, dated
   (13 Jun 2001) and linked; the Lee article's extra detail (prior low "at least three trading sessions earlier") added.
2. Section 3.6: "the same text is on wyckoffanalytics.com" became "most of the same text": that page's upthrust sentence
   reads "a UT or UTAD is the opposite of a spring" and it carries no author credit.
3. Section 4.3, "Other counts": "In every group the median house result was -1R" was not true of the 6%-or-deeper
   undercuts (median -0.24R). Corrected.
4. Section 6.7, MXL row: the level cell said "earnings-day low (53.70 in our bars)", but the 04-28 close of 52.01 did
   not reclaim 53.70; the owner's $50 is what was undercut and reclaimed. The cell now says so.
5. Section 6.7, FIGR row: "1.6% from his fill" is Bracco's stated 80 cents; a stop 5 cents under the day's low is 1.5%.
   Both now shown.
6. Section 6.7, the note under the table: WULF's bars are in the database (the writer's copy was still filling); the
   owner's WULF note in that post is a breakout and HVC hold, not a U&R, so it is not a candidate either way.
7. Section 5.2: the internal scanner's "+5 per extra level" is capped at +15, and the confidence floor arithmetic now
   shows its terms.
8. Section 5.4 point 6: "nothing checks" the 1.3x volume text was sharpened: the only 1.3 in the code labels the
   rally-to-undercut volume ratio in the narrative; the one volume gate is 0.7x.
9. Section 8.1 rule 3 was not measurable ("price is not under declining averages"); it now tests the 50-day SMA's
   10-session slope and a close above the 50-day. Rule 4 notes that C31's "strongest groups" has no number.
10. Section 8.1 rule 8 and section 8.2's "never buy the undercut": the [source consensus] tags leaned on the journal
    template and the knowledge-base template, which are house material, not outside sources. The outside sources that
    agree are now named (Wyckoff, Turtle Soup and Plus One, Deepvue; Morales, Turtle Soup, IBD), the house items moved
    under [UCT], and Wyckoff's dissent (a partial long on the spring itself) is stated.
11. Section 11: the EdgeRater replay page and the two TradingMarkets articles added as sources (3 and 25).

**Removed in checking.**
- Section 6.7: the sentence "I could not find bars for WULF (not in the local database)." The bars exist; see Fixed 6.
- Section 3.7: the claim that Dupee's note gives a Turtle Soup stop that "differs from StockCharts'" and that "only the
  book can settle it". It was a Plus One stop; see Fixed 1.

**Checked and left as written (so nobody re-checks them).** Morales's glossary sentences, including that the U&R "is
described in detail in the book, Short-Selling with the O'Neil Disciples" and the Livermore "Chapter 5" claim (his
words; the books were not read); the VoSI FAQ's 13 Jul 2017 dates and MoKa copyright; EdgeRater's three categories and
50 SMA note; IBD's two columns (dates 16 Apr 2015 and 25 Feb 2015 confirmed live); the Wyckoff tutorial's author line
and every quoted sentence; StockCharts' Turtle Soup rules and its 1996 date for *Street Smarts*; Deepvue's two bar
definitions; Kell's TSLA 65-minute remark (interview dated Apr 01, 2023); Osler's two abstracts, including "Most
results are statistically significant for hours, although not for days." and "stop-loss orders propagate trends and
are sometimes triggered in waves" (one sentence, not a splice); the Alphatrends pages (no "undercut and rally", no
"bear trap"; the book page's strategy list); Bulkowski's 19%, 145 and 42%; the Substack byline; the owner rulings in
`owner_verdicts.jsonl` (Go Signal, Kicker, Oops TVTX, Gap Support TWLO); the `u_and_r.py` narrative's "70%+", "$300M+
cap, 500K+ avg volume", "3-5%", DeMark and Turtle Soup sentences and its Shannon attribution; the registry's "round 1
(2026-10-16): noise" note and the recertification scores in `auto_structures.py`; the drawing rule's every constant;
the agent criteria file's three conditions and `"reviewed": false`; the vocabulary file's two Zoom locators (00:36:06
is the definition locator, 00:14:08 an evidence locator); the knowledge-base template's 8% stop and 10-15% target.

## 13. Examples (from our data)

(Numbered 13 because section 12 was already taken by the cold check; this is the "Examples (from our data)" section
every dossier carries.) Scan run 2026-11-09 on the sandbox's daily bars (read-only), all 2,630 names that ever met
the house liquidity rule, 1984 to 2026; the scan finished inside its time budget (coverage 2,630 of 2,630). Scripts:
`_study-resume/scratchpad/setups/29-undercut-rally/ur_scan.py` and `final_ur.py`; charts and the three phone sheets
(`sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`) in that folder's `final/` (scratch, not in the repo).

**The rule as scanned (section 8 plus the house rules).** The level L is the lowest low of the prior 10 sessions
(8.1.5b), and not yesterday's low alone (8.1.5 "not enough on its own"); the session before the undercut closed above
L (8.1.6); the day's low trades under L by at most 6% (8.1.7); price closes back above L the same session or within
the next 3 (8.1.8); the buy is a market order as price trades back above L on the reclaim day (8.2 option A: L plus one
cent, or the open if the stock gaps back above L), no more than 4% over L and 10% over the 10-day average (C28, C29);
the stop is 5 cents under the undercut low (8.3); the close must be above the 200-day and the 50-day with the 50-day
no lower than 10 sessions earlier (B26, 8.1.3); price $10 or more and $20 million a day on the 20-day average (B23);
no earnings reaction day from the undercut through 3 sessions after the buy (8.1.11); volume is not required (8.1.9).
Not scanned: the RS 80 floor (C31), because the sandbox has no RS ratings; the 50-day and 200-day tests stand in for
it. One hit per level (a 5-session gap after each reclaim).

**Base rate (rescanned 2026-11-10 with fills at the reclaim; the earlier figures used the open).** 66,020 hits (64,329
since 2000, with about the same rates: 50.2% and 39.3%). Before the stop was touched, **50.2% reached 3R and 39.2%
reached 5R** inside a 60-session window. Was: 62,966 hits, 35.6% to 3R, 24.7% to 5R, 84.4% stopped, median stop 1.73%.
The stop is fixed at the undercut low with no trims, no breakeven move and no trail, so "reached 3R" is a touch of that
price, not a booked result; 84.6% of the hits touched the stop at some point in the 60 sessions, most of them after
already making 1R or more. Median undercut 0.67% (unchanged), median stop 0.88% from the entry (was 1.73%).
**What changed.** The first scan filled a same-day undercut and reclaim at the day's open whenever that open was above
L, but on those days the open came before the undercut, so nobody could have bought there. The fill is now L plus one
cent, the first trade back through the level after the dip. That moved 35,063 of the 62,966 earlier hits (56%): the
fill came down by a median 1.1% and their median stop shrank from 1.73% to 0.51%; as a group they went from 27.9% to
3R to 54.0%. A gap back over L on a later day (a reclaim after one or more days under) is still filled at the open, and
the same-day reclaims that already opened under L were already filled at L plus a cent, so those hits did not move. 400
of the earlier hits dropped out and 3,454 came in (a lower fill passes the caps of 4% over L, 10% over the 10-day
average and a 6% stop more often, and the 5-session gap after each hit shifts). Splits worth teaching (was in
brackets): a reclaim that took 1 to 3 sessions reached 3R 43.2% of the time against 53.8% for a same-day reclaim (was
43.2% against 31.3%), so the earlier "later reclaims do better" result was the open fill and is gone; the median stop
is 0.58% for a same-day reclaim against 1.87% for a later one, so a 3R target on a same-day buy is a small move above
the level; a reclaim day that closed in its top half did far better than one that did not (54.7% against 39.5%; was
42.4% against 17.7%, which still backs 8.2 option B's DCR line); a stop within 3% beat a wider one (51.5% against
37.3%; was 37.6% against 27.1%, which backs A13); an undercut within 3% of L beat a deeper one (51.1% to 3R and 40.5%
to 5R against 37.8% and 22.3%; was 35.5% against 36.9% to 3R and 24.9% against 21.4% to 5R, so the earlier "depth made
no difference to 3R" is gone and a deeper undercut is now a worse sign); the size of the earlier bounce off L still made
no difference (49.7% to 3R under a 5% bounce against 50.8% at 5% or more). The same-day entry at L plus one cent is an
idealised fill: it assumes you were watching and bought the first trade back through the level, which is exactly
option A, and with a median stop of 0.5% on the same-day hits a few cents of slippage is a large share of R. A harder
read of the same scan: of the hits with a stop of 0.5% or more (46,615) 47.1% reached 3R and 33.8% 5R; with a stop of
1% or more (30,040), 43.7% and 29.8%.

**The 10 examples (one per ticker, ten different years, all reached 5R).** "Under" is the undercut low as a percent
below L; "days under" counts sessions from the undercut day to the reclaim day; the stop percent is from the buy.

| # | Ticker, buy day | Level L (its date) | Undercut low, under, days under | Buy | Stop | Best R (3R in) | Why it is textbook |
|---|---|---|---|---|---|---|---|
| 1 | NTAP 2004-10-27 | 23.04 (10-12) | 22.72, 1.39%, 1 | 23.05 | 22.67 (1.65%) | 31.4R (2 days) | Two-week shelf above a rising 50-day; one red day pokes under it on average volume (0.97x), the next day opens under L and closes near the high; earnings came 15 sessions later |
| 2 | OII 2007-05-25 | 23.57 (05-11) | 23.31, 1.12%, 1 | 23.59 | 23.26 (1.38%) | 34.8R (2 days) | A shallow pullback in a steady uptrend; the undercut day's volume was light (0.73x), the Wyckoff grade-up; the reclaim is quiet, not a surge |
| 3 | WHR 2009-08-18 | 55.87 (08-04) | 54.90, 1.74%, 1 | 55.88 | 54.85 (1.84%) | 23.8R (2 days) | Two weeks sideways after a sharp July run; the shakeout day on 0.61x volume, then a reclaim day that closes 3% above L; the 200-day is far below but the 50-day is rising steeply |
| 4 | SWKS 2010-11-17 | 22.51 (11-03) | 22.07, 1.95%, 1 | 22.52 | 22.02 (2.22%) | 30.6R (2 days) | The level is the pre-earnings low; eight sessions after the report the stock undercuts it and reclaims the next day, riding the 21-day EMA |
| 5 | WYNN 2013-11-21 | 159.37 (11-07) | 157.48, 1.19%, 2 | 159.97 | 157.43 (1.59%) | 26.0R (8 days) | Two closes under L, then a gap back above it: the buy is the open, 0.4% over L, still well inside C28; the slowest of the ten to 3R |
| 6 | INCY 2016-11-04 | 84.42 (10-28) | 83.01, 1.67%, 1 | 84.43 | 82.96 (1.74%) | 27.5R (1 day) | A post-earnings pullback (report 11-01) undercuts the pre-report low three sessions later and reclaims it the next day on a strong close; the 11-09 gap that followed was not an earnings reaction |
| 7 | ZS 2019-04-18 | 61.39 (04-04) | 60.02, 2.23%, 0 | 61.40 | 59.97 (2.33%) | 16.9R (2 days) | Same-day U&R: the level is the 04-04 flush low (3.6x volume); the stock opens at 62.27, sells off to 60.02 and closes at 62.73 (DCR 0.97) on 0.93x volume, with the 50-day rising; the buy is L plus a cent as price came back up through the level, not the open; the next report was 05-30 |
| 8 | QCOM 2020-09-21 | 109.62 (09-08) | 108.30, 1.20%, 0 | 109.63 | 108.25 (1.26%) | 37.3R (1 day) | A two-week flat shelf on the 50-day; same-day undercut and reclaim on 0.85x volume, close 2% above L; the cleanest "quick shakeout below the base" of the set |
| 9 | STLD 2022-02-24 | 59.95 (02-11) | 59.04, 1.52%, 0 | 59.96 | 58.99 (1.62%) | 41.7R (1 day) | Undercuts the February low intraday and closes 5.5% higher (DCR 0.95); the day opened at 60.18, 0.4% over L, before the dip, so the buy is L plus a cent as price came back up (the earlier scan filled at that open: 60.18, a 1.98% stop, 33.8R) |
| 10 | AMD 2024-01-04 | 135.37 (12-20) | 133.74, 1.20%, 1 | 135.38 | 133.69 (1.25%) | 54.4R (1 day) | A two-week pause on the 21-day EMA after a run; one-day poke under the pause low, reclaim the next day, then the 2024 leg up; a 1.25% stop |

Every chart was looked at before it was kept. Rescan of 2026-11-10: STLD was re-derived and re-charted at the new fill, and VEEV 2019-03-08 left the hit list (the rescan's own hit on the same stock on 03-04, an undercut that day to the level the 03-08 buy used, sits inside the 5-session gap after a hit), so ZS 2019-04-18 replaces it as example 7; the other eight are unchanged. Charts replaced on sight: MYGN 2008-06-30 (the "undercut" day was a
news-driven gap and reversal that closed 13% higher; the L-plus-a-cent fill is not believable there), AVAV 2018-07-30
(a 0.59% undercut, too subtle to teach, the owner's "a little subtle and hidden"), CAR 2021-09-13, APPN 2020-09-21,
VKTX 2024-01-04 and MSTR 2020-10-30 (valid, but the moves that followed dwarf the structure so the undercut is
unreadable on a daily chart; they are in `hits.json` if wanted), and the leveraged ETFs that top the raw list (SCO,
QID, LABD, TECL). A chart note: the long titles are cut at the right edge in the PNGs; the best-R figure is in the
table above.

**Notable failures (in words, from the same scan).**
- **LULU 2020-02-24.** L 242.17, undercut 2.68% the same day: the day opened at 245.39 (1.3% over L), traded down to
  235.69 and closed at 246.21. The buy is L plus a cent, 242.18, with the stop at 235.64, which is 2.70% from the buy
  (rescanned 2026-11-10 with fills at the reclaim; the earlier figures used the open: a buy at 245.39, a 3.97% stop
  called over the A13 line, and 0.52R). It made 1.26R and was stopped three sessions later (02-27, low 220.21) as the
  market broke down; 20 sessions later the stock was 172. A correct-looking U&R in a stock means nothing when the index
  is breaking (8.7, B18).
- **AMD 2021-09-14.** L 105.52, undercut 2.74%, two closes under, reclaim, buy 105.52, stop 102.58 (2.79%). Reached
  0.42R, stopped four sessions later at 99.51 in the September 2021 pullback, and was back at 105 twenty sessions
  after that. The stop did its job; the lesson is 8.5: a new try needs a new trigger, not a hold through the loss.
- **NVDA 2024-04-05.** L 87.62, undercut 1.99%, one close under, reclaim, buy 87.63, stop 85.83 (2.05%). Reached
  0.67R and was stopped two sessions later at 83.02 as the April 2024 correction began; the shakeout turned into a
  three-week pullback. The reclaim day closed in its top half, so even a reclaim like this one fails to reach 3R about 45% of the
  time by this scan's count (top-half-close reclaims reached 3R 54.7% of the time, rescanned 2026-11-10); the edge is in the R multiple of the winners.

## 14. Failures and near-misses (from our data)

Added 2026-11-10 (deliverable 4 of `CRITERIA_PROGRAMME.md`). Everything below is read off the same scan as section 13
(`final/hits.json`) or off a re-run of `ur_scan.py` with one gate relaxed at a time (`near_scan.py`, a 450-name random
subset of the liquid universe, 150 seconds per gate), never off a chart alone. Charts: `final/fail_1-4.png` (the four
failures, one column), `final/near_1-4.png` (the four near-misses) and `final/pair_28-2b-reversal.png` (a textbook U&R
over a textbook 2B), in `_study-resume/scratchpad/setups/29-undercut-rally/` (scratch, not in the repo). Every chart
carries L, the stop, 3R and 5R and the box from the prior low to the reclaim, so a learner can compare a failure or a
near-miss with the winners of section 13 at a glance. SPY numbers are the sandbox's own bars. LULU 2020-02-24 from
section 13 is not re-charted here: its stop is 2.70% from a buy at L plus a cent (it was 3.97% from the open in the
earlier scan, which is why it was once set aside), so it now passes ur.stop_width; the three failures named there that
pass every gate are kept and one more year is added.

**Failures: valid U&Rs, traded by the rules, stopped before 3R.** All four passed every gate the scan can read (above
the 200-day and the 50-day with the 50-day not falling, a fresh undercut of 1.1% to 2.7% of the 10-session low, a close
back above L within 2 sessions, a stop of 1.6% to 2.8%, $100 million or more a day, no report in the window).

| # | Ticker | Buy day | Level L (its date) | Undercut / closes under / reclaim | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|---|
| 1 | TRIP | 2014-07-09 | 102.17 (06-23) | 1.53% / 1 / next day | 102.18 | 100.56 (1.59%) | 07-10, low 100.44, closed 103.35 | The day after the buy dipped 12 cents through the stop and closed back above the entry; the stock then fell anyway, to 91.78 by 08-01 (94.03 twenty sessions after the buy). SPY made no lower low. The stop is the exit, not a hold: the one that shakes you out and then runs is the price of the ones that keep falling. | ur.after_entry_stop |
| 2 | ADBE | 2018-03-26 | 217.19 (03-09) | 1.11% / 1 / next day | 218.83 (the open, 0.8% over L) | 214.73 (1.87%) | 03-27, open 229.90, low 212.25, close 213.80 | A 5% gap up the next morning sold off all day through the stop; the low of the move came on 04-02 (207.22), the day SPY made a lower low (254.67 under its 257.83 March low). The stock was back at 217.89 twenty sessions on. The index had not turned. | ur.market_turn |
| 3 | AMD | 2021-09-14 | 105.52 (09-08) | 2.74% / 2 / day 2 | 105.52 | 102.58 (2.79%) | 09-20, low 99.51 | Reached 0.42R, then was stopped on day 4 as SPY made a lower low (428.86 under its 436.12 20-session low); back at 105.04 twenty sessions after the buy. The stop did its job; a new try needs a new trigger, at most 3 a week. | ur.retry |
| 4 | NVDA | 2024-04-05 | 87.62 (04-02) | 1.99% / 1 / next day | 87.63 | 85.83 (2.05%) | 04-09, low 83.02 | Reached 0.67R, then was stopped on day 2; the shakeout became a three-week pullback to 75.61 (04-19), the day SPY made its lower low (493.86). 88.79 twenty sessions after the buy, from a lower base. The reclaim day had closed in its top half; a top-half-close reclaim still fails to reach 3R about 45% of the time (54.7% reach it, rescanned 2026-11-10). | ur.after_entry_stop |

**Near-misses: charts that look like a U&R and fail exactly one gate.** Each was found by relaxing that one gate in
the scan and keeping only the hits the strict rule rejects for it; every other gate passed.

| # | Ticker | Date | The one criterion that fails | The number | Level L / closes under / reclaim | What it really is |
|---|---|---|---|---|---|---|
| 1 | MSFT | 2020-03-02 | ur.depth | The undercut went 6.88% under L (163.23 to 152.00); the rule is 6% at most, 3% for an A. The stop that follows is 8.08% from the buy. | 163.23 (02-24) / 2 / day 2 | A deeper break in the first week of the 2020 crash that happened to close back above: not this setup. Made 0.73R and was stopped; the stock fell to 132 within three weeks. |
| 2 | FDX | 2024-05-10 | ur.reclaim_window | 8 closes under L before the first close back above (reclaim on day 8); the rule is 3 at most. | 211.18 (04-18) / 8 / day 8 | A Remount of a level (setup 32), bought on the retake of the line with the stop under the remount day's low. Made 0.98R and was stopped; the June run came from a later base. |
| 3 | SBUX | 2025-03-07 | ur.not_prior_day_low | The 10-session low IS yesterday's low (104.91, set 03-06); the prior day's low alone is not a U&R level. | 104.91 (03-06) / 0 / same day | A one-day dip under yesterday's low and a close back over it: an Oops (setup 30), judged on one candle, not a U&R. Best 0.0R, stopped; the stock lost 20% in the next five weeks. |
| 4 | MSFT | 2026-06-08 | ur.above_200 | The buy-day close was 9.7% under a falling 200-day SMA; the rule is a close above it. | 409.58 (05-27) / 0 / same day | A U&R shape under the 200-day: watch only under B26. Best 0.0R, stopped the next day; the stock fell 12% in two weeks. |

**What the failures have in common.** All four looked right on the day: a fresh, shallow undercut of a level that
had held, a close back above it within two sessions, a stop under 3%, a leader above its averages. None of the four
gave a warning on its own chart, and three of them (ADBE, AMD, NVDA) were stopped while SPY was making a lower low,
the market condition ur.market_turn describes and the scan cannot read. TRIP is the other kind: the stop was touched by
12 cents and the day closed above the entry, which is the moment a learner is tempted to "hold through it"; the stock
then lost 10%. The teaching is the card's own: the stop under the undercut low is the exit, at once; a new try needs a
new trigger; and the best place for the first try is an index that has itself just undercut and reclaimed. The
near-misses show the three numbers a learner must count before calling a U&R: how far under (6% at most, 3% for an
A), how many closes under (none past the third), and whether the level is bigger than yesterday's low, with the
200-day as the fourth, non-negotiable line.
