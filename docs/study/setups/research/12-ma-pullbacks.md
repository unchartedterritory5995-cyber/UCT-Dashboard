# Setup 12: Pullbacks to the 10-day, 21-day, 50-day and 200-day (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the
page named next to it and checked word for word against a saved copy of that page. Nothing here is a ruling. Where I
could not read a source, I say so and give no wording from it.

**Cold check (2026-11-09, a second agent).** Every quote was re-opened at its source and matched word for word; every
scanner claim was re-read in the code and the fixture test re-run. What was wrong is fixed in place; what could not be
confirmed is taken out and listed in section 12, "Removed in checking", with the main corrections.

Tags used in section 8: **[source consensus]** at least two sources agree (named in the tag); **[one source]** a single
outside source, named; **[originator]** the named trader's own words; **[UCT]** UCT's own writers or the owner's verdict
log; **[UCT lab]** UCT's internal rule `uct_pullback_ma_v5`, fitted to the traders' scored calls (section 4);
**[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for
the owner to accept or change.

---

## 1. What it is

A stock that is already trending up drifts back to a rising moving average (the 10-day, the 20 or 21-day, the 50-day,
rarely the 200-day), holds it, and turns back up. You buy the turn, with a stop just under the pullback low, so the risk
is small and sits at a level everyone can see.

**Why it works (the psychology).** These points are reasoning, not measured facts.
- The rising average is roughly the average price of recent buyers. When a leader comes back to it, those buyers are
  near breakeven and many add or defend it. Pradeep Bonde puts it this way for large stocks: "These are large mature
  businesses that have large fund holding and everytime they dip below a certain level buyers step in."
  ([Stockbee, 2010](https://stockbee.blogspot.com/2010/11/how-to-develop-pullback-method.html))
- People who missed the breakout get a second chance at a defined risk. They are the late buyers who step in at the line.
- Sellers on a quiet, orderly pullback are mostly short-term profit takers, not funds leaving. Light volume on the way
  down says supply is thin. A heavy-volume break of the line says the opposite.
- Who is trapped: traders who sold the dip or shorted the "breakdown" under the line. When price reclaims the line
  (the undercut and rally), they buy back, which adds fuel.
- Why a widely watched line can work at all: ChartSchool on the 200-day: "The 200-day moving average may offer support
  or resistance because it's widely used. It is almost like a self-fulfilling prophecy."
- The caution: a moving average is not a wall. StockCharts: "Do not expect exact support and resistance levels from
  moving averages, especially longer moving averages." and "Instead of exact levels, moving averages can be used to
  identify support or resistance zones."
  ([ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential))
  TSDR says the same thing in trader words: "it is important to wait for signs and signals of strength instead of
  hoping we bounce at this random moving average" (TSDR's section, Sunday Scans 2025-06-22, quoted in section 6).

---

## 2. Origin and naming

**No single originator.** Buying a pullback to a rising moving average is old, shared trend-following practice. Bonde
lists the 50-day version among "the most commonly used" pullback approaches (quote below). What exists is a set of
named variants, each tied to one trader and one line:

| Name | Line | Who | Where | Status of my check |
|---|---|---|---|---|
| Holy Grail | 20-period EMA, with ADX(14) over 30 | Linda Bradford Raschke and Laurence A. Connors | *Street Smarts: High Probability Short-Term Trading Strategies* (M. Gordon Publishing Group; Library of Congress call number HG4527 .C66 1995); the 1997 AIQ interview names it as "listed in your book" | Interview read (hosted on Raschke's own site). Co-author confirmed on her own bio page (lindaraschke.net/bio-linda). Year from the Open Library record for ISBN 0965046109 (its LC call number). Book not read. |
| First pullback / pullback to the 50-day | 50-day ("50 ma becomes 20 MA or 39 MA") | Described (not claimed) by Pradeep Bonde | Stockbee, 4 Nov 2010 | Read. |
| EMA Crossback | 10 and 20-day EMAs | Oliver Kell (cycle of price action) | Kell's teaching; described by Deepvue (page last updated 2025-03-21) | Deepvue read. Nothing in Kell's own words read. |
| 10-week line / 50-day line | 10-week (about 50-day) line | William O'Neil / Investor's Business Daily | IBD articles; *How to Make Money in Stocks* | **Not read in full.** investors.com answers a plain request but shows only an article's opening lines before the paywall; IBD's syndicated copies on inkl.com returned 403 to the first writer. No IBD buy rule is given here. |
| Pocket pivot (and the "continuation" pocket pivot off the 10-day) | 10-day, 50-day | Chris Kacher and Gil Morales (former O'Neil portfolio managers) | *Trade Like an O'Neil Disciple: How We Made Over 18,000% in the Stock Market in 7 Years* (Wiley, August 2010, ISBN 9780470616536) | **Contents only.** Wiley's own free excerpt of the table of contents lists "2002 to Present--Choppy, Sideways Markets and the Birth of the Pocket Pivot" (chapter 2), "Definition of a Pocket Pivot Buy Point" (p. 132), "Continuation Pocket Pivots: Using the 10-Day Moving Average" and "Selling Techniques Using the 10-Day and 50-Day Moving Averages" (chapter 5). The rules themselves not read. |
| Undercut and Rally | prior lows (EdgeRater's template; it names no moving average as the line) | Gil Morales | A workshop talk, per EdgeRater | Secondary only (EdgeRater). |
| 30-week moving average, Stage 2 | 30-week | Stan Weinstein | *Stan Weinstein's Secrets For Profiting in Bull and Bear Markets* (the copy I could see listed is a McGraw-Hill paperback; the often-quoted 1988 first-edition year is not confirmed in this pass) | **Not read.** I found no readable source for his own wording on buying pullbacks. |

**Other names for the same picture:** MA pullback, MA tap, "20EMA tap" (UCT), "tap of the 9EMA" (UCT), first pullback,
"UnR" (UCT, for an undercut and rally), moving average undercut and rally ("MAU&R", UCT's Bracco), "squat" (UCT: a
failed breakout that sinks into the averages, then goes), Holy Grail, EMA crossback, 10-week line bounce.

**Related but separate setups in our library:** Remount (a leader loses its line and retakes it; Study unit SET.28 says
"loss and reclaim of the line, not a pullback"), Launchpad (the averages bunch together and price comes up through
them; on GOOGL 2024-12-10 the owner cut a candidate he wanted to "look more like MSTR", and the reviewer's note calls a
stock "already riding on top of the bundle in an uptrend" a "pullback breakout, not a launchpad"), Gap Support,
Slingshot, Go Signal.

---

## 3. Every definition I could find, source by source

### 3.1 Linda Bradford Raschke: the Holy Grail (originator, primary)
Source: interview by David Vomund in *AIQ Opening Bell*, Vol. 6 Issue 8, August 1997, hosted at
https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf. The numbered rules are in a sidebar headed Holy
Grail Pattern, "Buy rules (sells are reversed)", printed with the interview. That sidebar was written or adapted by the
newsletter (rule 1 points the reader to the ADX/R indicator in AIQ's own TradingExpert software), so the rules are hers but the sidebar wording
may be AIQ's. The lines marked "her words" are from the interview itself.
- Trend filter: "1. The 14-period ADX must initially be greater than 30 and rising."
- Line and pullback: "2. Look for a retracement in price to the 20 period exponential moving average. This will
  usually be accompanied by a turndown in the ADX."
- Trigger and entry: "3. When the price touches the 20 period moving average, put a buy stop above the high of the
  previous bar."
- Stop and exit (rule 4): "Once filled, enter a protective sell stop at the newly formed swing low. Trail stops as
  profits grow."
- Her words, the setup: "With the Holy Grail pattern, we want the stock to fall back to a 20 day moving average after
  its ADX indicator has moved to a value above 30."
- Her words, why it works and where it goes: "the odds are very high that when a security makes a new momentum high
  and pulls back, it will retest its recent high." (So the implied first objective is the recent high; no fixed target.)
- Her words, on a stalled trade (her Eaton example): "This is a case where there is no reason to be in this trade."
- Her words, timing principle: "The worst thing you can do in terms of market timing is to buy in the middle of a
  trading range."
- Not stated: volume, prior-advance size, a fixed profit target, a maximum depth. Her "odds that a top is in place is
  probably only 5% to 10%" is an estimate; the interview gives no data for it (section 4).

### 3.2 Kristjan Kullamägi (Qullamaggie): the breakout setup (originator, primary)
Source: "3 TIMELESS setups that have made me TENS OF MILLIONS!", qullamaggie.com, published 2021-01-08,
https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
- He does **not** buy the touch of the average. The averages are where the consolidation lives; he buys the breakout
  out of it: "During the consolidation the stock price “surfs” the rising 10- and 20-day. and sometimes toe 50-day
  moving average." (typos are his)
- Prior move (step 1 of his breakout setup): "A big move higher sometime in the past 1-3 months. This move can be
  anywhere from 30-100%+ and usually lasts a few days to a few weeks."
- Shape: "An orderly pullback and consolidation with higher lows and tightening range in the consolidation phase."
- Length: "The consolidation phase is usually 2 weeks to 2 months."
- Entry: "Enter on the opening range highs." (of the breakout day)
- Stop: "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock"
- Trim and trail: "You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop to break even."
  Then: "The rest of the position should be trailed with the 10- or the 20-day moving average. Depends on how fast the
  stock is. If a beginner stick to the 10-day. You wait for the first CLOSE below the 10- day."
- For the short side of parabolics he uses the same lines as targets: "The target area is the 10- and 20-day moving
  averages, that’s where these stocks usually bounce."

### 3.3 Pradeep Bonde (Stockbee): "How to develop pullback method" (primary; he describes common methods, not his own)
Source: Stockbee blog, 4 November 2010, https://stockbee.blogspot.com/2010/11/how-to-develop-pullback-method.html
- Two entries in his list of "The most commonly used approach to developing pullback methods": "Buy first pullback
  after a major breakout." and "Buy first pullback to 50 day moving average. This is like most commonly used swing
  trading method."
- What counts as a major breakout, in his words: "a multi month trend line , or breakout above channel, or breakout
  above 200 day moving average or a breakout of 25% or more from a 52 week low" (spacing his).
- On the line length: "50 ma becomes 20 MA or 39 MA or some other MA."
- Where it works: on large, fund-held stocks ("These are large mature businesses that have large fund holding and
  everytime they dip below a certain level buyers step in."), and "They also tend to do well in range bound markets
  and may not do well in bull markets or highly trending markets."
- Where it does not: "Some stocks like momentum stocks or growth stocks are best traded using breakout methods."
- His own warning: "if you are primarily a pullback trader you will miss out on some of the best opportunities in the
  market." and "For me breakouts work and I spend my time and energy on breakouts."
- Not stated: a trigger, a stop, a volume rule. **He does not present the 10-EMA first pullback as his setup.** This
  matters for section 5: our scanner's text says he does.

### 3.4 Oliver Kell: the EMA Crossback (educator description; nothing in Kell's own words read)
Source: Deepvue, "Oliver Kell: 5 Screens to Find Stocks Like a Champion", page marked "Last Updated: March 21, 2025", no
author named, https://deepvue.com/screener/oliver-kell-screens/
- Lines: "At its core, the cycle of price revolves around the 10 and 20-day exponential moving averages."
- Context and order: "After a Wedge Pop, the stock tests its moving averages, forming an EMA Crossback." So it is a
  test of the averages after a new up-cycle starts (the page says "tests", not "first test").
- Use: "Price consolidates into the moving averages, allowing traders to add to or start a new position." (Adding is
  not allowed by our rule A5.)
- Short mirror: "The EMA Crossback to the downside occurs when the price tries to rally into declining moving averages
  but faces strong resistance."
- Not stated on that page: an exact trigger, stop, or volume rule. TraderLion's Kell articles (search listings:
  traderlion.com/technical-analysis/chart-patterns/ema-crossback/) returned a bot check to my plain request, so I
  give no wording from them.

### 3.5 Mark Minervini: the trend template (educator description; book not read)
Source: Deepvue, "The Mark Minervini Trend Template: How to Find Winning Stocks", page marked "Last Updated: November 20,
2023", no author named, https://deepvue.com/screener/minervini-trend-template/ (I could not reach any page on
minervini.com that states the template.)
- Minervini is a filter for **which** stocks, not a pullback setup. Deepvue: "Minervini doesn’t just buy anytime when
  the stock is in an uptrend." His entries are VCP pivots.
- Trend filter lines: "The 200-day SMA must have been rising for at least one month." and "The stock’s price must be
  within 25% of its 52-week high."
- Strength: "Minervini often looks for RS ratings of 70 or higher". (Our 21-day scanner text says "top quartile". I
  could not check the book's exact number.)
- Volume: "Key signals include increased volume on breakouts, low volume during pullbacks, and sustained high-volume
  up days".
- The often-quoted rule of at least 30% above the 52-week low was not on the page I read. Treat it as unverified.

### 3.6 StockCharts ChartSchool: moving averages (established educator)
Source: "Moving Averages: Simple and Exponential",
https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential
- "A short-term uptrend might find support near the 20-day simple moving average, also used in Bollinger Bands."
- "A long-term uptrend might find support near the 200-day simple moving average, the most popular long-term moving
  average."
- "Exponential moving averages will turn before simple moving averages."
- "Do not expect exact support and resistance levels from moving averages, especially longer moving averages."

### 3.7 David Keller, CMT (StockCharts): the 21-day EMA as the first line (established educator)
Source: "Pullback or Pitfall? Let the 21-Day EMA Be Your Guide", StockCharts, 2025-09-05,
https://articles.stockcharts.com/article/stock-market-pullback-or-pitfall-21-day-moving-average-guide/
- "As long as the price remains above the 21-day EMA, any short-term movements can be considered noise, rather than a
  clear signal of a change in trend."
- "I think of the 21-day EMA as the first line of defense, an initial stop within an uptrend phase."
- "After a bounce off the 50-day moving average, a push back above the 21-day EMA is often a great sign that the
  primary uptrend has resumed."
- Entries: "With a stock in a primary uptrend, the 21-day can be used to identify short-term drops and potential entry
  points within the bullish phase."
- He also calls price over the 21-day EMA, over the 50-day, over the 200-day the "proper order" for an uptrend.
- When the 21-day fails: "if the 21-day does not hold, and then turns lower, I’m relying on the 50-day moving average
  to provide the necessary support to reverse the downside pressure." If the 50-day also fails, he reads it as a change
  of trend (his NVDA example).

### 3.8 O'Neil / IBD: 10-week and 50-day line (not read; no IBD buy rule given)
investors.com shows only an article's opening lines to a plain request. The one I opened, Scott Stoddard, "Moving
Averages Help You Assess A Stock's Health" (IBD, updated 2016-01-29,
https://www.investors.com/how-to-invest/investors-corner/moving-averages-a-key-reference-for-investors/), names "the
50-day and 10-week moving average lines" as IBD's guideposts and is cut off after "A rising line identifies strength".
I give no IBD rule for buying the line.
The loss rule our 50-day scanner cites is confirmed second-hand by two former O'Neil portfolio managers: "O'Neil
advises a 7 to 8 percent automatic stop-loss policy on all stock purchases" (Morales and Kacher, *Trade Like an O'Neil
Disciple*, chapter 1, p. 5, in Wiley's free excerpt,
https://media.wiley.com/product_data/excerpt/39/04706165/0470616539.pdf). The scanner's own quoted wording, "Cut your
losses at 7-8%", is not confirmed as O'Neil's words.

### 3.9 Morales and Kacher: pocket pivots and Undercut and Rally (secondary only)
- EdgeRater: "Gil Morales gave a presentation explaining one of his 'Ugly Duckling' setups called 'Undercut and Rally'."
  (https://edgerater.com/tradingtemplates/gm_undercutandrally). EdgeRater's template looks for stocks "that have
  undercut prior lows"; it names no moving average as the line. My guess, not stated by any UCT source, is that this is
  the root of UCT's "UnR" and "MAU&R" words. I could not read Morales' own rules.
- Pocket pivots, including a "continuation" pocket pivot off the 10-day, are Kacher and Morales' (the book's contents,
  section 2 table). I could not read the rules. No wording is given.

### 3.10 Stan Weinstein (not read)
The 30-week average and Stage 2 are commonly credited to him, and TSDR credits him too: a stock "just surfing the
30wkMA (Stan Weinstein)" (Sunday Scans 2025-11-30). I found no readable copy of his own words on buying a pullback to
the 30-week line. Our 200-day scanner puts words in quotation marks and calls them his (section 5). I could not confirm
any of them.

### 3.11 UCT's writers
See section 6. In short: TSDR's core line is the 20-day EMA, the 9-day EMA for fast names, and the 50-day SMA for
leaders after a deeper pullback; his stated management is a stop at the low of the day, a trim of a quarter to a third
on a 3-6 day push, and a trail under the 9 and 20; Bracco uses the 9/20 EMAs and the 50-day, and the "MAU&R" (which he
framed as mean-reversion longs on oversold leaders); another writer (Beebe) uses the 10-day EMA and the 200-day for
mega caps.

### 3.12 Comparison table

| Source | Line(s) | Prior trend | Touch / depth | Volume | Trigger | Stop | Exit |
|---|---|---|---|---|---|---|---|
| Raschke 1997 | 20 EMA | ADX(14) over 30 and rising | retraces to the 20 EMA | not stated | buy stop over the prior bar's high once price touches the line | new swing low | trail as profits grow |
| Kullamaggie 2021 | rising 10 and 20-day, sometimes 50-day | a 30-100%+ move in the past 1-3 months | orderly pullback, higher lows, 2 weeks to 2 months | (breakout volume, not the pullback) | opening-range high of the **breakout** | low of the day, no wider than ADR/ATR | 1/3 to 1/2 after 3-5 days, stop to breakeven, trail 10 or 20-day (beginners: first close under the 10-day) |
| Bonde 2010 | 50-day (or 20, 39) | after a major breakout (e.g. 25%+ off a 52-week low, over the 200-day) | first pullback | not stated | not stated | not stated | not stated |
| Kell (Deepvue) | 10 and 20-day EMA | after a wedge pop (new up-cycle) | price tests and consolidates into the averages | not stated | not stated | not stated | not stated |
| Minervini TT (Deepvue) | 50, 150, 200-day SMA (filter) | 200-day rising 1 month+, within 25% of the high | n/a (buys VCP pivots) | low on pullbacks | VCP pivot | n/a here | n/a here |
| ChartSchool | 20-day, 200-day SMA | uptrend | support zone, not exact | not stated | not stated | not stated | not stated |
| Keller 2025 | 21 EMA, then 50-day | MAs in "proper order" | 21 EMA first, 50-day second | not stated | none stated; a push back over the 21 EMA after a 50-day bounce is "a great sign" | 21 EMA as "an initial stop" | 21 EMA failing and turning down hands the job to the 50-day; a 50-day failure reads as a trend change |
| IBD (unread) | 10-week / 50-day | (unread) | (unread) | (unread) | (unread) | 7 to 8% (per Morales and Kacher, section 3.8) | (unread) |
| UCT TSDR | 20 EMA core, 9 EMA, 50 SMA | leader, strong group, after a move or earnings gap | orderly multi-day pullback, undercut allowed | low volume wanted | GO SIGNAL / red to green / oops / inside day / prior high | "My stops are always LOD" (low of day); "50SMA as a stop" once | trim 1/4 to 1/3 on a 3-6 day push, trail under the 9 and 20 (or the 50 SMA) |
| Our scanners | 10 EMA, 21 EMA, 50 SMA, 200 SMA | "Stage 2" + full stack | low within 1 to 3% above the line, any depth below | reject heavy volume | close over the pullback bar's high +0.1% | line or low minus 0.5 to 1 ATR | swing high + ATR, 3R, or 40-50% of the prior advance |

### 3.13 Where the sources disagree
1. **Which line.** 20 EMA (Raschke, ChartSchool's 20-day SMA, TSDR), 21 EMA (Keller, our scanner),
   10 and 20 together (Kell, Kullamaggie), 50-day (Bonde, IBD, TSDR for leaders). The firm's own Study stack is
   9 EMA, 20 EMA, 50 SMA, 200 SMA (unit SET.02), while rule E52 trails the "10-day" and "21-day" (type not stated).
2. **Is buying the touch an edge for momentum leaders at all?** Bonde: mostly no ("momentum stocks or growth stocks
   are best traded using breakout methods"); pullbacks suit big, fund-held stocks and range-bound markets. Kullamaggie:
   the averages are where the base forms, but the buy is the breakout. Kell, Raschke and TSDR: yes, buy at the line with
   a trigger. TSDR also warns against always waiting for the touch (MRVL, 2026-10-04: a video "about when to try things
   above the 20EMA instead of fully waiting for that 20EMA tap").
3. **Trigger.** Touch plus a buy stop over the prior bar (Raschke); a breakout out of the consolidation (Kullamaggie);
   a reversal, oops or red-to-green off the line, or an inside-day break (TSDR); a 9-EMA remount (our Model Book card);
   a close over the pullback bar's high (our scanners).
4. **Stop.** New swing low (Raschke); low of the day capped at ADR/ATR (Kullamaggie); low of the day (TSDR's stated
   rule), once the line itself (TSDR's "50SMA as a stop" on RDDT); Keller's 21 EMA as "an initial stop"; the line minus
   an ATR cushion (our scanners).
5. **Trend filter.** ADX (Raschke only); MA stack (Minervini via Deepvue, Keller); 52-week range (Minervini via
   Deepvue); a prior move: Kullamaggie's 30-100%+ in the past 1-3 months (for his breakout setup), Bonde's "25% or
   more from a 52 week low" as one kind of major breakout. Our 50 and 200-day scanners' 30% and 40% over 120 and 200
   bars match no source exactly.
6. **The 200-day.** ChartSchool calls it long-term support; Beebe (UCT) buys mega caps there; our rulebook forbids
   longs below it (B26); our own lab found 200-day tags were 0 of 7 in a blind review (section 4).

---

## 4. Measured evidence

**Outside sources: I found no published, verifiable statistic for buying a pullback to the 10, 21, 50 or 200-day in
growth or momentum stocks.**
- Brock, Lakonishok and LeBaron, "Simple Technical Trading Rules and the Stochastic Properties of Stock Returns",
  *Journal of Finance* 47(5), 1992, pp. 1731-1764. The abstract (RePEc,
  https://ideas.repec.org/a/bla/jfinan/v47y1992i5p1731-64.html, readable on the check pass) says it tests "moving
  average and trading range break" rules "by utilizing the Dow Jones Index from 1897 to 1986", and that "Buy signals
  consistently generate higher returns than sell signals". It tests index signals, not pullbacks in single stocks, so it
  says nothing direct about this setup. The paper itself was not read; no numbers from it.
- Bonde (2010) says pullback systems that "have shown to be performing well in backtest" mostly use the S&P 500 or
  Nasdaq 100 as their universe. He gives no figures.
- Raschke (1997) estimates "the odds that a top is in place is probably only 5% to 10%" for a Holy Grail pullback. The
  interview gives no data, sample or period behind it, so it is her estimate, not a measurement.
- Bulkowski (thepatternsite.com) returned 406 to a plain request on both passes. I found no Bulkowski statistics on
  moving-average pullbacks. The task brief notes his site carries a notice against AI use; if a later pass reads it,
  cite it with a link and flag that notice.

**In-house measurements (UCT's own lab, read from the code; the lab report itself is not in this repository):**
`api/services/pattern_engine/detectors/uct/uct_pullback_ma_v5.py`, docstring, 2026-10-16/17:
- Against the traders' scored calls, test half: the new rule's recall was 20.1%; the four production pullback
  scanners together had 19.4%. Fire rate on random ticker-days: 5.36% versus 10.04%. Lift 3.74 versus 1.94, with
  "almost disjoint hits (5 shared of 123)".
- Blind review of 25 fires on random days: 19 yes, 1 no, 5 ambiguous. Decoys: 8 no, 1 ambiguous, 1 yes.
- Second blind packet: 21-day EMA tags 43 yes, 1 no (97.7%); 50 and 200-day tags 46%; 200-day tags "0 yes of 7".
- "The same report found no measured forward-return edge, and the tag-bar-low stop is hit at the same rate as a random
  stop at that ATR distance, so it is a drawn level, not a tested risk anchor."
- Limits: "yes" means the chart looked like the setup to a reviewer, not that it made money. Samples are small. The
  report is not in the repo, so I could not check the method.

`api/services/pattern_engine/detectors/registry.py` (comment on the blind drawing review, lab report REPORT_TIERS_V2,
2026-10-17, a 0-3 placement rubric): the 10-EMA pullback scored 1.90 "as drawn" and is shown only as "experimental";
the Holy Grail scanner scored 1.80.

**My own check of our scanners (2026-11-09, scratch script, not committed; re-run on the cold check with the same
result).** Each of the four scanners has five "positive" test charts in `tests/fixtures/<pattern_id>/`. Each test
chart carries a hand-written context (`"ma_alignment": "stacked_bullish"`, `"trend_stage": 2`). The live scan does not
use that: it computes the context with `build_context` over the last 200 bars (`api/main.py` line 556). I ran the same
test charts with the computed context (whole chart and last 200 bars give the same answer):

| Scanner | Fires with the hand-written context | Fires with the context the scan computes |
|---|---|---|
| pullback_to_10ema | 5 of 5 | 5 of 5 |
| pullback_to_21ema | 5 of 5 | **0 of 5** (alignment computed as "mixed"; rs_trend computed as "down" or "flat", never the "up" it requires) |
| pullback_to_50sma | 5 of 5 | **0 of 5** ("mixed") |
| pullback_to_200sma | 5 of 5 | **0 of 5** ("mixed"; trend stage computed as **4**) |

Limit: these are synthetic charts, not real stocks, and no real-bar count of live fires was available to me. But they
are the scanners' own textbook cases: the 10-day tests would pass either way, while the 21, 50 and 200-day tests pass
only because of the hand-written context. Section 5 explains why.

**UCT's own observation (not a measured study):** Bracco, Sunday Scans 2025-06-15
(https://unchartedterritoryy.substack.com/p/sunday-scans-744): "whenever the Nasdaq reaches a 7x ATR extension above
its 50-day moving average, a pullback of at least three days has consistently followed." No sample size or dates were
given in the post.

**What is missing and would settle the owner's questions:** a replay on real bars of the proposed rules in section 8
(each line: 10, 20, 50 and 200-day), with the house stop and trims, split by market reading, on the kept examples
only. None of the sources above did this.

---

## 5. Our app: what the scanners actually test

### 5.1 The four scanners (`api/services/pattern_engine/detectors/uct/`)

| | `pullback_to_10ema.py` | `pullback_to_21ema.py` | `pullback_to_50sma.py` | `pullback_to_200sma.py` |
|---|---|---|---|---|
| Line | 10 EMA | 21 EMA | 50 SMA | 200 SMA |
| Hard gates (context) | stage 2, "stacked_bullish" | stage 2, "stacked_bullish", rs_trend "up" | stage 2, "stacked_bullish" | stage 2, "stacked_bullish" |
| Line rising | EMA now vs 10 bars ago, at least 0.05%/bar | same, at least 0.04%/bar | SMA now above SMA 20 bars ago | same |
| Prior advance | none | none | (max high minus min low) / min low over 120 bars, at least 30% | same over 200 bars, at least 40% |
| Touch window | low in last 3 bars at or under line +1% | body and low in last 3 bars at or under line +1.5% | low in last 5 bars at or under line +2% | low in last 8 bars at or under line +3% |
| Reclaim | close over the line same or next bar | within 2 bars | within 3 bars | within 5 bars |
| Volume | touch bar at most 1.5x the prior 20-bar average | touch bar under 1.1x | touch at most 1.3x, reclaim at least 0.9x | touch at most 1.5x, reclaim at least 0.9x |
| Entry | close over the touch bar's high +0.1% | same | same | same |
| Stop | touch low minus 0.5 ATR | 21 EMA minus 1 ATR | 50 SMA minus 0.5 ATR | 200 SMA minus 1 ATR |
| Target | 30-bar high + 1 ATR | entry + 3R | entry + 40% of the prior advance's dollar height | entry + 50% of the prior advance's dollar height |

ATR in all four is a simple 14-bar average of the true range; every "line" value is today's value (item 4 below).

Shared context (`api/services/pattern_engine/primitives/context.py`):
- "stacked_bullish" means, on the **last** bar: close > SMA10 > SMA20 > SMA50 > SMA200 (simple averages, not EMAs).
- "Stage 2" (with 200 or more bars, as in the live scan) means the close is above the 150-day SMA and more than 2% above
  the close 49 sessions earlier (the first close of the last 50). It does not test the slope of the 30-week average,
  although its docstring says so.
- "rs_trend" is not relative strength against the market. It is the stock's own last-20-bar return minus its previous
  20-bar return, "up" above +3 points ("Simplified to absolute trend (no SPY comparison in Phase 0)").

### 5.2 What looks wrong
1. **The 21, 50 and 200-day scanners can rarely fire in the live scan (my reasoning plus the synthetic test; not
   counted on real bars).** A stock touching its 21, 50 or 200-day within the last few bars will rarely have close >
   SMA10 > SMA20 > SMA50 (> SMA200) on the last bar. The 200-day version needs all five numbers bunched within a few
   percent, which is a Launchpad shape, not a pullback. The tests hide this by injecting the context (section 4 table).
2. **The 21-day scanner requires "rs_trend up", which a pullback usually fails**, because the pullback itself lowers the
   last 20 bars' return. On its own five textbook charts the computed value was "down" or "flat" every time.
3. **The touch test is one-sided.** The test (low at or under the line plus 1 to 3%) lets a low any distance **under** the line
   count as a touch, as long as a close gets back above it in time.
4. **Older bars are compared with today's line value**, not the line's value on that bar.
5. **"Prior advance" ignores order.** (max high minus min low) over 120 or 200 bars is the same number for a 40% rise
   and a 40% fall.
6. **Levels do not match the house.** Entry is a close over the pullback high, not a market order when the trigger
   trades (E57). Stops are the line or the low minus 0.5 to 1 ATR, not a few cents under the day's low (A3, F62), and
   often wider than about 3% (A13). Targets are not the house trims (B19, E51). `docs/study/TRADE_PLANS.md` says every
   UCT detector's targets come from the shared `make_levels` at 2R and 3R; these four build their own levels and do not
   call it.
7. **The narratives contain claims I could not find in any source, and some are contradicted.**
   - 10-EMA: it calls itself "Raschke fast-pullback + Bonde first-pullback". Raschke's published Holy Grail uses the
     **20**-period EMA (3.1). Bonde writes that he trades breakouts and names the **50**-day first pullback (3.3). The
     line "Pradeep Bonde's Stockbee backtests ... deliver positive expectancy at hit rates in the 65-75% range" has no
     source I could find. "Raschke uses a trailing 10-EMA stop on these setups" is also unsourced.
   - 21-EMA: "Minervini's SEPA backtests ... hit rates in the 65-75% range", the "natural stop" of "21-EMA - 1 ATR",
     "FIRST profit at 2R (50% of position)", a 3% hard stop and "220-month live track record of 33,500%+" are all
     unsourced. The 21-EMA is not shown as Minervini's "primary support" in anything I read; Deepvue says his entries
     are VCP pivots. "Pocket pivot" is Kacher and Morales' term, not Minervini's.
   - 50-SMA: it attributes "pocket pivot" to O'Neil (it is Kacher and Morales', section 2). It does already admit that
     O'Neil publishes no hit rate and that the 40% target is "this detector's own measurement rule", yet the same
     sentence still calls it "O'Neil's measurement". It also calls the 30% prior advance "O'Neil's 30% minimum
     threshold" (no source found) and puts "Cut your losses at 7-8%" in quotation marks as O'Neil's (the rule is
     confirmed second-hand, section 3.8; that wording is not).
   - 200-SMA: it puts words in quotation marks as Weinstein's ("A break of the 30-week MA on rising volume is THE signal
     to exit") and calls a "50% of the prior advance" target "Weinstein's measurement". I found no source for either.
   These texts are the `narrative` field every detection carries, so any page or tool that shows a detection can
   show them. The four scanners are public (not in `INTERNAL_PATTERN_IDS`). The texts should be rewritten before any
   lesson or member surface uses them.
8. **Holy Grail scanner** (`holy_grail.py`) adds a volume-contraction rule (last 3 bars' volume under the prior 10
   bars') and a stop of "pullback low - 1 ATR" that Raschke's rules do not have (hers: the new swing low). It also does
   not check that the ADX is rising (her rule 1 says "greater than 30 and rising"), and it enters on a close over the
   pullback bar's high, not a buy stop over the prior bar's high.
9. **The newer internal rule `uct_pullback_ma_v5.py`** is closer to the sources: a rising 21 EMA (over its value 10
   sessions earlier) above a rising 50 SMA; the close above a 200 SMA that is not falling by more than 0.1 ATR over 20
   sessions (it does not require the 50 SMA over the 200); the close at least 1 ATR under the highest high of the last 11
   sessions (its docstring says "10-session high"); a tag of the 21 EMA, 50 SMA or 200 SMA on the last or prior bar,
   the tag bar's low within 1 ATR under to 0.25 ATR over the line and its close no more than 0.5 ATR under it; today's
   close within 1 ATR above the line; stop at the tag bar's low; targets at 2R and 3R from the shared `make_levels`. It
   only reports 21-EMA tags because of the blind-review numbers in section 4. It is internal: it is left out of the
   scan lists, and the code says the only path that serves it to a member is the chart drawing set
   (`DISPLAY_MEMBER_SET` in `registry.py`), behind the `AUTO_STRUCTURES_ENABLED` and `AUTO_STRUCTURES_MEMBERS_ENABLED`
   flags (`api/routers/patterns.py`; their live state not checked here). It excludes leveraged ETFs, which conflicts with E54 ("they are preferred actually") if the course
   ever uses it for ETFs.

### 5.3 Model Book card, journal tags, Study units
- Model Book (`app/src/pages/modelbook/setupCatalog.js`): "20 EMA Pullback": "A bullish trend pulls back to the rising
  20 EMA; a candle holds it, and the remount of the 9 EMA is the buy." Drawn with the 9 and 20 EMAs. There is no card
  for the 10-day, 50-day or 200-day versions. A separate card, "EMA Crossback", is Kell's.
- Journal tags (`app/src/constants/setupGroups.js`, which calls itself the list for the Model Book "Add Setup" dropdown
  and any future setup pickers): no moving-average pullback tag. The nearest are "Classic Flag/Pullback", "Remount" and
  "Classic U&R". Members who take this trade have no exact tag to journal it under.
- Study: SET.14 "20 EMA Pullback" (`docs/study/UNITS-method.md`) already notes "The detector is 21-period; the firm's
  line is the 20 (C20 tag)". SET.02 names the firm's four lines: 9 EMA, 20 EMA, 50 SMA, 200 SMA. F4.08 covers
  pullbacks to the averages. The setup vocabulary (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`) has "20EMA Tap"
  and notes "engine uses the 21 EMA; the authors say 20".

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com). I read all 103 posts listed in its sitemap
on 2026-11-09 (the cold check re-downloaded all 103 and matched every quote below). The writer is named only where the
post's own section heading names them. Index and ETF sections and "Closing Comments" do not name a writer, so I do not
assign one. Dates are the post date as Substack stores it (UTC); the "Rest of the Week" posts and the 2025-06-20 post
went out in the US evening of the day before.

**Who TSDR is.** Since 2026-10-25 the section is headed "Patrick (TSDR)’s Weekly Outlook & Watchlist" (posts of
2026-10-25, 2026-11-01 and 2026-11-08). If TSDR is the owner, every TSDR line below is the owner's own public writing
and outranks every other source here. The owner should confirm.

**TSDR (section "TSDR’s Weekly Outlook & Watchlist" or "TSDR Trading")**
- "I am mostly a 20EMA kind of guy." and "My ideal stocks and broad setups are seeing that exact style of upside
  reversal on individual names at the 20EMA. It is my GO SIGNAL."
  (2025-11-09, https://unchartedterritoryy.substack.com/p/sunday-scans-720)
- His management, in one line: "My stops are always LOD until I can raise them to breakeven, trim 1/4 - 1/3 on a 3-6
  day push, then trail the rest with a stop below the 9 and 20 period moving averages." (2025-06-22,
  https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)
- His menu of triggers: "Here is my approach. Give me an oops. Give me some sideways and a tap of the 20EMA. Give me an
  inside day. Give me a clean retest or remount after and undercut." (2026-09-06,
  https://unchartedterritoryy.substack.com/p/sunday-scans-fcd)
- "This is pretty much my bread and butter. Setting up off the 20ema here. Any sort of GO SIGNAL would allow me entry
  with immediate full size." (2025-06-08, https://unchartedterritoryy.substack.com/p/sunday-scans)
- "The pullback to the 50SMA is a “must buy” on a leading stock of this nature." and "There, I would look to peel of a
  partial position and trail the remaining up the 9ema and 20ema on the daily." (ALAB, 2025-10-08,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208)
- "There is nothing I like more than a gap down reversal to give me signal. Especially in a strong trend that is
  pulling back to a key area or moving average." and "But it is important to wait for signs and signals of strength
  instead of hoping we bounce at this random moving average, although that would be ideal and a great sign of
  strength." (2025-06-22, https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)
- "I really appreciate the low volume of this six day pullback into the 20EMA." (RDDT, 2025-07-13,
  https://unchartedterritoryy.substack.com/p/sunday-scans-6a6)
- "would be super okay if it rested more as the stock is nearly 50% away from 50SMA. 20 ema tap would be 100% actionable
  imo." (NBIS, section "TSDR WATCHLIST", 2025-06-20, https://unchartedterritoryy.substack.com/p/market-update-and-watchlist)
- "You can easily capture 10-15-20% moves in stocks off these spots. Again, such as NBIS off the 50SMA, HVE level at
  $95.72, down 8 days in a row." (2025-10-26, https://unchartedterritoryy.substack.com/p/sunday-scans-13e)
- "Looking for this to firm up and build a bit more of a base vs just sharp pullback to 20EMA." (SEI, same post)
- "ideally we use the 50SMA as a stop." (RDDT, after it "remounted all MAs" and rested above the 50SMA; 2025-11-30,
  https://unchartedterritoryy.substack.com/p/sunday-scans-422)
- "Really want this to shakeout into the 20EMA, that would be ideal to grab it on the squat." and, on the same stock,
  "Idealy entry was 1/14 on the red to green off the 20EMA" (Q, a fresh IPO; 2026-02-22,
  https://unchartedterritoryy.substack.com/p/sunday-scans-04c)
- "A strong name then as an earnings gapper pulled into the HVC and the MAs. Bought with tight risk and let the trade
  play out." and "I still have 60% of my position and am trailing the 20EMA for now while the 50SMA catches up." (FSLY,
  2026-03-22, https://unchartedterritoryy.substack.com/p/sunday-scans-cab)
- "Only one little tap of the 50SMA, that is major RS. Big Bullish engulfing candle on Thursday. Thursday’s low is risk
  area." (GLW, 2026-04-05, https://unchartedterritoryy.substack.com/p/sunday-scans-356)
- "Loving the hammer at the 20EMA a whole hell of a lot." and "It has been a buy on pullbacks not strength." (CRWV,
  2025-10-19, https://unchartedterritoryy.substack.com/p/sunday-scans-6cc)
- "An inside day or red to green move to start the week would be actionable. Ideal spot was Thursday against the 20EMA."
  (U, after "the oops reversal off the 20EMA on Thursday"; 2025-08-24,
  https://unchartedterritoryy.substack.com/p/sunday-scans-ffa)
- "Staying focused on things HERE vs as they are up 6 days in a row is how you get positioned in big legs." (ARM,
  2026-07-12, https://unchartedterritoryy.substack.com/p/sunday-scans-898)
- "Classic flag and 20EMA pullback." (2026-06-21, https://unchartedterritoryy.substack.com/p/sunday-scans-bc0)
- Trails: "PL has rewarded my 50SMA trailing stop and hit $40 this week from my $12.40 entry. FSLY has punished my 9EMA
  weekly trailing stop and pulled back heavily." (2026-04-19, https://unchartedterritoryy.substack.com/p/sunday-scans-33a);
  "MU planning on actually only trailing the 9EMA here. Given the speed of the move and group I want to trail the
  shorter term." (2026-05-17, https://unchartedterritoryy.substack.com/p/sunday-scans-679); "I don’t switch to trade
  management on the weekly timeframe until I am well into profit and can trail the weekly 9ema as my stop."
  (2025-09-07, https://unchartedterritoryy.substack.com/p/sunday-scans-52e)

**Bracco (section "Bracco’s Breakdown & Top Ideas" or "Bracco - ...")**
- "These all staged MAU&R’s (moving average undercut and rallies) with most closing strong on Friday." (2025-10-26,
  https://unchartedterritoryy.substack.com/p/sunday-scans-13e). Context: the sentence before calls these trades "some
  rubber band / mean reversion longs on some short term oversold momentum leaders such as IREN CIFR NBIS LEU BE HOOD
  etc.", and the next says they gave "hammer candles off the 10 week moving averages". So his MAU&R here is a
  mean-reversion long, which C31 exempts from the RS 80 rule.
- IONQ: "Low of today was rising 20EMA support." and "In a perfect world this undercuts the 20EMA and reclaims."
  (2025-10-01, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week). Context: he calls it "a short term
  mean reversion bounce trade" after a "+80% move in 9 days", with "volume declining last 4 days".
- "Usually will see some pretty intense back and forth volatility on the first pullback after an extension" (2026-05-17,
  https://unchartedterritoryy.substack.com/p/sunday-scans-679)
- "IWM trading +6% higher from original entry off the 20ema on 8/21." (2025-09-07,
  https://unchartedterritoryy.substack.com/p/sunday-scans-52e)
- "Wouldn’t even mind some dips and shakeout below 20ema and remount." (NBIS, CRWV; 2026-04-26,
  https://unchartedterritoryy.substack.com/p/sunday-scans-f2d; the sub-heading "The Watchlist:" sits inside Bracco's
  section)

**Other UCT writers ("The Rest of the Week" posts)**
- Beebe, CAT: "Can risk just below the 10 EMA which is about 2% for a potential break out to new all time highs."
  (2025-11-12, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045)
- Beebe, AMZN, after "the successful defense of the 200 SMA": "I think buying mega caps off major moving averages during
  bull markets is a solid long term strategy." (2025-11-26, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a)
- ChartMaster, MSFT: "you buy the first pullback after a new ATH. Clustered MA’s." Then: "Needs to clear 519-520 to
  trigger the trade." (a pennant breakout, not a touch of the line; 2025-10-01,
  https://unchartedterritoryy.substack.com/p/the-rest-of-the-week)

**Index and ETF sections and closing comments (writer not named in the post)**
- "20EMA pullbacks are very normal and natural, anything notably more and we can discuss an alternative approach."
  (QQQ, 2025-06-22, https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)
- "The squat is the best by the way. Failed breakout into an undercut of the breakout spot and tap into the moving
  averages then go." (IWM, 2025-08-24, https://unchartedterritoryy.substack.com/p/sunday-scans-ffa)
- "When we are above these spots, we take action, when we are below them we stay patient and stalk stocks with relative
  strength." (QQQ 9 and 20 EMA, 2025-08-03, https://unchartedterritoryy.substack.com/p/sunday-scans-726)
- "Approach is still simply that we are riding a rising 20EMA and continue to respect it." (2025-07-06,
  https://unchartedterritoryy.substack.com/p/sunday-scans-df6)
- "Pullbacks to the MAs during a strong market are natural and provide opportunity." (2025-07-20,
  https://unchartedterritoryy.substack.com/p/sunday-scans-c82)

**The owner's own words in the verdict log** (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)
- On Go Signal fixtures (NVDA 2022-07-25): "Gonna need to see the hourly but there are all most likely good 20EMA
  APULLBSCKS or UNR setups". His Go Signal definition: "GO SIGNALS are supposed to be notable hourly flags that undercut
  a slight range and quickly go red to green in the first hour". So for him the 20-day pullback is the **daily context**
  and the Go Signal is one **trigger** inside it.
- On an Oops example (WSM 2024-12-20): "Good, a little sharp of a pullback into that spot but this is great still". The
  reviewer's note: "a sharp two-day pullback is acceptable but less ideal than a multi-day drift".
- On a Launchpad candidate (GOOGL 2024-12-10) he wanted it to "look more like MSTR"; the reviewer's note calls the
  GOOGL picture "a pullback breakout, not a launchpad".

**Example candidates named in UCT posts** (to check on real bars before any lesson; I did not verify these charts):
1. ALAB, 50-day SMA, Oct 2025 (TSDR "I bought the 50SMA at $190 then again at $200").
2. NBIS, 50-day SMA plus HVE level $95.72, Oct 2025 (TSDR).
3. IWM, "six orderly days of pullback into the 20EMA" (index section, 2025-08-24, "A classic “SQUAT”"), entry
   2025-08-21 (Bracco: "original entry off the 20ema on 8/21").
4. IONQ, rising 20 EMA after "+80% move in 9 days", 2025-09-30 (Bracco; he framed it as a mean-reversion bounce).
5. RDDT, six-day low-volume pullback to the 20 EMA, July 2025 (TSDR).
6. RKLB, "Pulled into 20 ema and found support. Ignited again off the 20 ema", June 2025 (TSDR, 2025-06-08).
7. COIN, "first pullback is behaving properly" after "its breakout on 6/18", "Maybe the 9EMA pull is all it offers",
   July 2025 (TSDR, 2025-07-06).
8. CAT, 10 EMA hold, risk about 2%, Nov 2025 (Beebe).
9. ARM, "first pullback to the weekly MAs and the Daily 50SMA", July 2026 (TSDR, 2026-07-12).
10. DOCN, "First tap of 20EMA held", 2026-03-31 (TSDR; post dated 2026-04-01 UTC).
11. AMZN, 200-day defense, Nov 2025 (Beebe; mega cap, see question 2).
12. QQQ, "the 50SMA tap on the QQQ on 9/2" (2025-09-02, named in the 2025-09-14 closing comments; an index, not a stock).
13. U, "the oops reversal off the 20EMA on Thursday" (2025-08-21), TSDR, 2025-08-24.
14. CRWV, "hammer at the 20EMA", TSDR, 2025-10-19.
15. GLW, a single tap of the 50 SMA and a bullish engulfing candle, risk under its low, TSDR, 2026-04-05.
16. FSLY, an earnings gapper "pulled into the HVC and the MAs", bought from $16.97, TSDR, 2026-03-22.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | What it means here | Conflict? |
|---|---|---|
| A3, F62 stop a few cents under the day's or prior day's low | Natural fit: the pullback (touch) day's low. Matches Raschke's swing low, Kullamaggie's low of the day and TSDR's "My stops are always LOD". | Our scanners use the line or low minus 0.5-1 ATR. Change them. |
| A13 stop usually within about 3% | Fine for 10 and 20-day pullbacks in normal names (Beebe's CAT: "about 2%"). | 50-day pullbacks in fast names, and any undercut, often need more than 3%. Size down by A5 or skip (A3). |
| A4 stop only moves up; A5 one price, one stop, no adds | Buy once at the trigger. | TSDR's ALAB "bought the 50SMA at $190 then again at $200" is an add; the rulebook says no adds. The course should teach the single entry. |
| B19, E51, E52 trims and trail | 1/3 at 3R, 1/3 at 5R, trail the rest under the 10-day (fast) or 21-day (steady), sell on a close below. Breakeven at 2R to 5R. | Kullamaggie trims 1/3 to 1/2 after 3-5 days; TSDR trails 9/20 EMA or the 50 SMA. House rule wins; mention theirs as named variants only. |
| B20 gap through the stop | Applies as written. | None. |
| B22 earnings | No new buy in the 3 days before a report; hold through one only if the trade is up 5R. Earnings gaps often start the trend, so check the date. | None. |
| B23, D42 liquidity | $10+, $20M+ a day, at most 1% of average daily volume. | None. |
| B26 200-day hard rule | Every 10, 20 and 50-day pullback in a leader is above the 200-day. **A 200-day pullback can only be bought once price is back above the 200-day SMA**, and the stop then sits under it. | The 200-day version lives at the edge of B26. A low that undercuts the 200 is fine only if the entry is above it. |
| C28 no chasing past 4% | If the trigger day runs more than 4% past the buy point, skip. | None. |
| C29 not more than 10% above the 10-day | Near the line this is automatic. | None. |
| C31 RS 80+ in a leading group, except parabolic and mean-reversion trades | Leaders only. | A pullback lowers RS; a 50 or 200-day pullback may drop RS under 80. Bracco framed his MAU&Rs and IONQ as mean-reversion longs, which C31 exempts; the course must say which this setup is. Owner questions 5 and 7. |
| C33 time stop | Under 1R after 10 trading days: sell. Matches Raschke's "no reason to be in this trade". | None. |
| D47 shorts mirror longs | Rally into a falling 20 EMA or 50 SMA, below a falling 200-day. | None (needs B26 and D48). |
| E50 grading is discretionary | Section 9 gives observable cues, not a checklist. | None. |
| E57 market orders | Market order when the trigger trades. | Our scanners enter on a close over the pullback bar's high plus 0.1%. |
| F65 market reading | Green: full. Yellow: smaller. Orange: A+ only. Red: none (cash and shorts). | None. |

---

## 8. Proposed rules for our course

Each line is measurable on daily bars unless it says hourly. ATR is the 14-day average true range.

### 8.1 What it is
- **Name.** One setup, "Pullback to the moving averages", with three lines: the 10-day (fast leaders), the 20-day
  (the core), and the 50-day (deeper, leaders only). The 200-day is taught as context, not as a buy (see 8.7 and
  question 2). [my proposal; UCT for the 20-day as the core: "I am mostly a 20EMA kind of guy."]
- **Which numbers.** Options: A) the firm's Study stack (SET.02): 9 EMA, 20 EMA, 50 SMA, with the 10-day for fast
  leaders; B) the scanners' 10 EMA, 21 EMA, 50 SMA (rule E52's trail names a "10-day" and a "21-day" average and does
  not say which kind). Recommend **A with 20 EMA and 50 SMA** because UCT's writers say "20EMA" and "50SMA" almost
  every time and SET.02 already teaches those lines; the 20 versus 21 difference is tiny on a chart. [my proposal;
  owner question 1]
- **Prior trend.** Price within 25% of its 52-week high [one source: Deepvue's summary of Minervini, not his own
  words]; 200-day SMA rising for at least 21 sessions [one source: the same page says "at least one month"; 21 sessions
  is my translation]; 20 EMA above 50 SMA above 200 SMA [source consensus: Keller's "proper order" (with the 21 EMA);
  Deepvue's Minervini template (50-day above the 150 and 200-day); v5 has the 21 EMA over the 50 SMA and price over the
  200]; and a breakout, earnings gap or new up-cycle within the last 3 months [source consensus that it follows a
  breakout: Bonde "Buy first pullback after a major breakout", Kell via Deepvue "After a Wedge Pop", TSDR's
  earnings-gap examples; the 3-month window from Kullamaggie's "past 1-3 months" for his breakout setup].
- **The line must be rising.** 20 EMA above its value 10 sessions ago; 50 SMA above its value 10 sessions ago.
  [UCT lab: v5 uses the same 10-session test, on the 21 EMA]
- **Which touch.** The first touch of that line since the breakout or gap is the best; a second touch can still be an A
  or B; a third or later touch is lower grade. [source consensus for the first touch: Bonde "first pullback", Kell via
  Deepvue (a test after the wedge pop), TSDR "First tap of 20EMA held"; the second and third-touch grades are my
  proposal]
- **Depth.** The close at least 1 ATR under the highest high of the last 11 sessions. [UCT lab, v5]
- **Touch.** The pullback low is within 1 ATR under to 0.25 ATR over the line. [UCT lab, v5] An undercut below the line
  is allowed only if the same day or the next day closes back above it (the MAU&R). [UCT for the undercut: Bracco "In a
  perfect world this undercuts the 20EMA and reclaims" and "shakeout below 20ema and remount"; TSDR's "remount after
  and undercut"; the same-or-next-day limit is my proposal, and v5 allows a tag-bar close at most 0.5 ATR under the
  line]
- **Length.** 2 to 8 sessions of pullback. [my proposal, from UCT examples: "six day pullback" (TSDR), "six orderly
  days" (index note), "down 8 days in a row" (TSDR); the owner's WSM note prefers a multi-day drift to a sharp 2-day
  drop]
- **Shape.** Orderly: no single down day larger than 2 ATR in the pullback. [my proposal, from the owner's Oops ruling
  against "a random big red day" (ULTA verdict; the reviewer's note there suggests a prior-day range under about 2x
  ATR), to be confirmed for this setup]
- **Volume.** Average volume over the pullback days below the 50-day average volume; the touch day not above 1.5x the
  50-day average. [source consensus on quiet volume: TSDR "low volume of this six day pullback", Bracco's IONQ "volume
  declining last 4 days", Deepvue on Minervini "low volume during pullbacks"; the 1.5x number is my proposal, borrowed
  from our 10-day scanner, which measures against the prior 20 bars]
- **Liquidity.** Price $10 or more and at least $20 million traded a day; position no more than 1% of average daily
  volume. [house rule B23, D42]
- **Leadership.** RS rating 80 or more, in a strong group. [house rule C31]

### 8.2 The buy
- **Trigger.** After a hold day (a close at or above the line), buy when price trades above that day's high. [originator:
  Raschke "put a buy stop above the high of the previous bar" (her trigger needs only a touch; the hold-day close is my
  proposal); same style as the owner's Kicker ruling "OVER previous day high"; TSDR "Break inside day high" on RDDT]
- **Order.** Market order the moment the trigger trades. [house rule E57]
- **Alternatives to teach as named variants, not the default:** an hourly Go Signal or red-to-green off the line
  [UCT: TSDR "red to green off the 20EMA", owner's Go Signal ruling]; a 9-EMA remount [UCT: Model Book card]; a
  reversal candle (hammer, oops, bullish engulfing) at the line [UCT: TSDR "hammer at the 20EMA", "the oops reversal off
  the 20EMA", GLW's "Big Bullish engulfing candle"]. Recommend the prior-high break as the one drawn on charts because it
  is the only one fully visible on daily bars. [my proposal; owner question 3]
- **No chasing.** Skip if the fill would be more than 4% above the trigger price. [house rule C28]
- **Earnings.** No new buy in the 3 days before a report. [house rule B22]

### 8.3 The stop
- A few cents under the low of the pullback, taking the lower of the hold day's low and the trigger day's low.
  [house rule A3, F62; originator: Raschke "newly formed swing low", Kullamaggie "lows of the day"; UCT: TSDR "My stops
  are always LOD", GLW "Thursday’s low is risk area"]
- If that stop is more than about 3% under the entry, the size comes down so the account risk is unchanged (A5), or the
  trade is skipped if even that does not fit (A3). Never move the stop up to make it fit. [house rule A3, A5, A13]
- A gap through the stop: the first 30-minute low is the new stop; out past 2R. [house rule B20]

### 8.4 Trims and trail
- House default: a third at 3R, a third at 5R, trail the rest under the 10-day (fast movers) or 21-day (steadier)
  average, sold on a close below it; stop to breakeven between 2R and 5R; a gap up past a trim level is trimmed at the
  open. [house rule B19, E51, E52, F63]
- Time stop: still under 1R after 10 trading days, sell. [house rule C33; Raschke's "no reason to be in this trade"]
- Named variants (taught only as theirs): Kullamaggie sells 1/3 to 1/2 after 3-5 days; TSDR's stated rule trims a
  quarter to a third "on a 3-6 day push" and trails under the 9 and 20, and in practice he has also trailed the 20 EMA
  (FSLY), the 50 SMA (PL) and the weekly 9 EMA. [originator, UCT]

### 8.5 What invalidates it (before or after entry)
- A trade through the stop: out, by the real stop order with the broker. [house rule A3, A4, D41]
- Before entry: the touch day closes under the line on more than 1.5x the 50-day volume (distribution, not a pullback).
  [my proposal; the scanners reject a touch bar over 1.1x to 1.5x the prior 20 bars' volume; source consensus on quiet
  pullback volume, 8.1]
- Before entry: the line stops rising (20 EMA under its value 10 sessions ago), or 20 EMA crosses under the 50 SMA.
  [source consensus: Keller "proper order" and his 21-day "turns lower", v5 rising-21 EMA rule]
- Before entry: a third close under the line in the same pullback. [my proposal; the idea is Study SET.14's "skip the
  name that keeps slicing the line"]
- Before entry: the index loses its 20-day (UCT index note on the QQQ 9 and 20 EMA: "when we are below them we stay
  patient"). [UCT]

### 8.6 The short mirror
Shorts are our long setups reversed. [house rule D47] A stock below a falling 200-day SMA [B26], RS 20 or less in a weak
group [C31 mirror], rallies 2 to 8 sessions on light volume into a falling 20 EMA or 50 SMA, fails there, and is shorted
when it trades under the rally day's low; stop a few cents over the rally high; skip if hard to borrow [D48]. Source:
Kell's downside EMA Crossback (Deepvue). [originator via educator] Bracco floated a short of this kind on OPEN in
Sunday Scans 2025-10-05: "Potential short idea if we flush through 20ema"
(https://unchartedterritoryy.substack.com/p/sunday-scans-6ef). [UCT] In the same note he describes "a near +2,000% move
in 2 months", so OPEN was far above its 200-day; by my reading that idea was a failed-momentum short, not this mirror; B26 still requires the short to be
below the 200-day unless it is a parabolic short.

### 8.7 The 200-day
Recommend: do **not** teach a stand-alone long at the 200-day for single stocks. Reasons: B26 forbids buying under it;
leaders that fall to their 200-day usually lose RS 80 (C31); our lab's blind review found 200-day tags 0 yes of 7; Bonde
says such pullbacks suit large fund-held stocks. Teach it as the line where longs stop, and as a possible exception for
mega caps and index ETFs once price closes back above it (Beebe's AMZN). [my proposal; owner question 2]

### 8.8 Best conditions
- Market reading Green, or Yellow at smaller size. [house rule F65]
- The index itself is above a rising 20-day. [UCT index notes]
- A strong trend in which the leader "surfs" the rising 10 and 20-day (Kullamaggie's word, said of his breakout bases).
  [originator: Kullamaggie]
- Note the tension: Bonde says pullback methods do well in range-bound markets and on big stocks and "may not do well
  in bull markets or highly trending markets", while UCT's writers use them most in strong up-trends ("Pullbacks to the
  MAs during a strong market are natural and provide opportunity", closing comments 2025-07-20). [Bonde vs UCT]

### 8.9 Common mistakes
1. Buying the touch because it is the line, with no sign of buyers ("hoping we bounce at this random moving average").
2. Buying a stock that is slicing back and forth through the line.
3. Buying a pullback in a flat or falling line, or after the 20 EMA crossed under the 50 SMA.
4. Buying a heavy-volume break of the line as if it were a pullback.
5. Treating a broken leader's first touch of the 50 or 200-day as a pullback (it is a correction).
6. Setting the stop under the line minus a cushion, so the stop is far wider than 3%, then keeping full size.
7. Adding a second buy lower (A5 forbids it).
8. Buying the day before earnings.
9. Chasing the bounce day more than 4% past the trigger.
10. Picking a line after the fact: decide before the trade which line this stock respects.

---

## 9. Grading (observable cues, not a checklist; E50 says grading is his judgment)

**A+**
- First touch of a rising 20 EMA (or 10 EMA in a fast leader) after a breakout or earnings gap, inside a confirmed
  up-trend (20 > 50 > 200, all rising). [source consensus: as in 8.1, "Which touch" and "Prior trend"]
- Leadership: RS 90 or more, a leading group, other names in the group setting up too. [house rule C31 sets 80; 90 for
  A+ is my proposal; UCT examples such as GLW's "Whole group"]
- Pullback on drying volume (pullback days at or under about 0.7x the 50-day average) over 3 to 8 orderly sessions.
  [UCT "low volume of this six day pullback"; the 0.7x number is my proposal]
- Confluence: the line sits on another level (an HVE or HVC level, a gap top, a prior breakout pivot). [UCT: "NBIS off
  the 50SMA, HVE level at $95.72"; FSLY "pulled into the HVC and the MAs"]
- A tight reversal at the line (hammer, inside day, undercut and reclaim) so the stop is 3% or less. [UCT; house A13]
- Market reading Green, index above its rising 20-day. [house F65; UCT]

**B- or lower**
- Third or later touch of the line; or a 50-day touch in a name that has lost RS 80.
- The line flattening; 20 EMA close to crossing under the 50.
- A sharp 1 to 2 day drop into the line, or one outsized red day. [owner's WSM and ULTA notes]
- Volume rising on the pullback.
- A wide stop (over 3%) that forces a much smaller size.
- Yellow or Orange market; laggard group; earnings within about 2 weeks.

---

## 10. Questions for the owner

1. **The lines.** Teach (A) 9 EMA, 20 EMA, 50 SMA (Study stack SET.02, with the 10-day for fast leaders), or (B) 10
   EMA, 21 EMA, 50 SMA (the scanners; E52 names a 10-day and a 21-day trail)? And should E52's trail say "20-day" to
   match, and EMA or SMA? Recommend A with the 20 EMA.
2. **The 200-day.** (A) not a long setup, context only; (B) allowed for mega caps and index ETFs once price closes back
   over it; (C) a full setup like the others. Recommend A or B.
3. **The trigger.** (A) a trade over the hold day's high (Raschke style, like your Kicker ruling); (B) a reversal close
   back over the line; (C) the hourly Go Signal or red to green; (D) the 9 EMA remount (the Model Book card). Recommend A
   as the default, C as the advanced version.
4. **The stop.** (A) a few cents under the pullback low (house default); (B) under the line; (C) the line minus a
   cushion (scanners). And when it is over 3%: size down, or skip? Recommend A, size down to 3% or skip if the size
   would be too small to matter.
5. **RS 80 on a pullback.** Is RS 80 checked on the entry day, or before the pullback began? A 50-day pullback can
   push a real leader under 80.
6. **Which touches count.** First and second only, or any touch while the line rises?
7. **Undercuts.** Is the MA undercut and rally part of this setup or its own setup? If part of it, how deep (0.5 ATR,
   1 ATR) and must it close back above the same day? Bracco framed his MAU&Rs as mean-reversion longs on oversold
   leaders; if it is mean reversion, C31's RS 80 rule does not apply to it.
8. **The scanners.** (A) fix the four (context gates, touch test, levels, and the narratives with unsourced claims);
   (B) retire them and move the course to the v5 rule, adding 10 and 50-day tags; (C) leave them, teach from hand-picked
   examples only. The narratives need rewriting in every option.
9. **The name.** "Pullback to the moving averages", "20 EMA Pullback" (Model Book), "MA Tap", or one setup per line?
   And a journal tag for it (none exists today)?
10. **Weekly version.** Include the weekly 10-week or 9/20-week pullback (TSDR trails "the weekly 9ema")?
11. **The short mirror.** Teach the rally into a falling 20 EMA or 50 SMA as a short?
12. **Adds.** TSDR bought ALAB at the 50-day "at $190 then again at $200", and on COIN suggested "looking to add back
    partials trimmed into strength". Rule A5 says no adds. Confirm the course teaches one entry only.
13. **TSDR.** Recent posts head his section "Patrick (TSDR)". Is TSDR you? If so, his lines in section 6 are your own
    words and the course can quote them as ours.

---

## 11. Sources (all read on 2026-11-09 unless marked not read)

| Source | Publisher / author | URL | Reliability |
|---|---|---|---|
| Interview by David Vomund, *AIQ Opening Bell* Vol. 6 Issue 8 (Aug 1997), Holy Grail rules | AIQ; Linda Bradford Raschke (interviewee); hosted on her site | https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf | High: originator, in print. The numbered rules are an AIQ sidebar (section 3.1). PDF text extraction drops some apostrophes; quotes avoid those spots. |
| Raschke's bio page (co-author of *Street Smarts* "with Laurence A. Connors") | lindaraschke.net | https://lindaraschke.net/bio-linda/ | High for the co-author. |
| Open Library record, *Street Smarts*, ISBN 0965046109 | Open Library | https://openlibrary.org/isbn/0965046109.json | Bibliographic only: publisher M. Gordon Publishing Group, LC call number HG4527 .C66 1995. |
| "3 TIMELESS setups that have made me TENS OF MILLIONS!" (2021-01-08, updated 2021-04-28) | qullamaggie.com; Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | High: originator, primary. |
| "How to develop pullback method" (2010-11-04) | Stockbee blog; Pradeep Bonde | https://stockbee.blogspot.com/2010/11/how-to-develop-pullback-method.html | High: primary; describes common methods, not his own setup. |
| "Oliver Kell: 5 Screens to Find Stocks Like a Champion" (last updated 2025-03-21) | Deepvue (no author named) | https://deepvue.com/screener/oliver-kell-screens/ | Medium: vendor education about Kell, not Kell's own words. |
| "The Mark Minervini Trend Template: How to Find Winning Stocks" (last updated 2023-11-20) | Deepvue (no author named) | https://deepvue.com/screener/minervini-trend-template/ | Medium: vendor summary of Minervini's template, not his own words. |
| "Moving Averages: Simple and Exponential" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential | High: established educator; general, not a setup. |
| "Pullback or Pitfall? Let the 21-Day EMA Be Your Guide" (2025-09-05) | StockCharts; David Keller, CMT | https://articles.stockcharts.com/article/stock-market-pullback-or-pitfall-21-day-moving-average-guide/ | Medium-high: established educator's opinion. |
| "Gil Morales: Undercut and Rally" | EdgeRater | https://edgerater.com/tradingtemplates/gm_undercutandrally | Low-medium: a platform's template page, secondary. |
| *Trade Like an O'Neil Disciple* (Wiley, 2010): publisher's free excerpts (contents; chapter 1) | Wiley; Gil Morales and Chris Kacher | https://media.wiley.com/product_data/excerpt/39/04706165/0470616539-1.pdf (contents), https://media.wiley.com/product_data/excerpt/39/04706165/0470616539.pdf (chapter 1) | Medium-high: former O'Neil portfolio managers; used only for the pocket-pivot chapter titles and the 7 to 8 percent stop. |
| "Moving Averages Help You Assess A Stock's Health" (updated 2016-01-29) | Investor's Business Daily; Scott Stoddard | https://www.investors.com/how-to-invest/investors-corner/moving-averages-a-key-reference-for-investors/ | Opening lines only (paywall); no rule taken from it. |
| UCT Substack, all 103 posts in the sitemap (2025-06-01 to 2026-11-08) | Uncharted Territory; TSDR, Bracco, Beebe, ChartMaster and others | https://unchartedterritoryy.substack.com/sitemap.xml | House source; quotes exact; writer named only where the post names one. |
| Owner verdict log | UCT (owner) | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | House, highest for "how we trade it". |
| Account rulebook | UCT (owner) | `docs/study/sizing_rule.md` section 9 | House rules, settled 2026-11-09. |
| Scanners and context | UCT app code | `api/services/pattern_engine/detectors/uct/pullback_to_10ema.py`, `pullback_to_21ema.py`, `pullback_to_50sma.py`, `pullback_to_200sma.py`, `uct_pullback_ma_v5.py`, `holy_grail.py`; `primitives/context.py`; `detectors/registry.py`; `api/routers/patterns.py` | Read in full for rules; narrative claims checked against sources (section 5.2). |
| Model Book, journal tags, Study units, vocabulary | UCT app and docs | `app/src/pages/modelbook/setupCatalog.js`, `app/src/constants/setupGroups.js`, `docs/study/UNITS-method.md`, `docs/study/UNITS-foundations.md`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json` | House. |
| IBD / investors.com articles on the 10-week and 50-day lines | Investor's Business Daily | (not read beyond the paywall; inkl.com copies returned 403 to the first writer) | Not used for any rule. |
| TraderLion articles on Kell's EMA Crossback | TraderLion | traderlion.com/technical-analysis/chart-patterns/ema-crossback/ (not read: 403 bot check on both passes, by curl and by the fetch tool) | Not used. |
| *Trade Like an O'Neil Disciple*, pocket pivot sections (chapter 5) | Wiley; Kacher and Morales | (not read: the O'Reilly copy refused access; only the contents excerpt above was seen) | Not used for rules. |
| Brock, Lakonishok, LeBaron (1992), *Journal of Finance* 47(5):1731-1764 | Journal of Finance | https://ideas.repec.org/a/bla/jfinan/v47y1992i5p1731-64.html (abstract read on the cold check) | Abstract only; index signals, not this setup. |
| Bulkowski, thepatternsite.com | Thomas Bulkowski | (not read: 406 on both passes) | Not used. The brief says his site carries an AI-use notice; flag it if cited later. |
| Weinstein, *Stan Weinstein's Secrets For Profiting in Bull and Bear Markets* | Stan Weinstein | (book not read; first-edition year not confirmed) | Not used for wording. |

---

## 12. Removed in checking (cold check, 2026-11-09)

**Removed because no source could confirm them:**
1. The "reported" IBD rules (a 10-week line buy on the first or second pullback after a base breakout, a buy zone up
   to 5% above the line). They came from search-engine summaries, not from IBD text. Removed from 3.8, the comparison
   table and the "second-chance buy" alias in section 2.
2. "IBD research favours the first or second bounce off the 10-week line" (section 4). Same reason.
3. "IBD as reported" as a basis for the "Which touch" rule (8.1). The first-touch preference stands on Bonde, Kell via
   Deepvue and TSDR; the second-touch grade is now marked as my proposal.
4. "Kell's own book not read": nothing I could open confirms which book of Kell's is meant, so the dossier now says
   only that nothing in Kell's own words was read.
5. "Bracco at times" using the 21 EMA (3.13): no Bracco section in the 103 posts mentions a 21 EMA.
6. The undercut "averages" in the Undercut and Rally row: EdgeRater's template is about prior lows.
7. "The 30-week average and Stage 2 are his" as a flat statement: kept only as "commonly credited", with TSDR's own
   credit to Weinstein quoted; his book's 1988 year is marked unconfirmed.

**Corrected (the source said something different):**
1. "shakeout below 20ema and remount" was tagged as TSDR's in 8.1; it is Bracco's (section 6 already had it right).
2. The undercut, "first pullback" and other UCT lines now carry the writer's ticker and context where it changes the
   meaning: Bracco's MAU&Rs and IONQ were mean-reversion longs; ChartMaster's MSFT "first pullback" was a pennant
   breakout trigger; TSDR's "50SMA as a stop" was on a remount, not a 50-day pullback.
3. The Raschke rules are an AIQ sidebar printed with the interview, not her spoken words; her own spoken definition and
   target ("it will retest its recent high") were added, and "no profit target" was corrected to "no fixed target".
4. The co-author (Laurence A. Connors) is now confirmed on Raschke's bio page and the 1995 year from the book's Library
   of Congress call number; "the Holy Grail chapter" was dropped (the book was not read).
5. Pocket pivots: the chapter titles now come from Wiley's own contents excerpt; the O'Neil 7 to 8 percent stop is
   confirmed second-hand from the same book's chapter 1.
6. Brock, Lakonishok and LeBaron: the abstract page opened on the check (it had returned 406); its scope is quoted.
7. Deepvue dates are "last updated" dates (Kell 2025-03-21; Minervini 2023-11-20), not publication dates.
8. Tags: "[originator: Minervini via Deepvue]" is now "[one source]"; "[UCT scanner rule]" for the 1.5x volume
   invalidation, "Length" and "third close" are now "[my proposal]" with the source of the idea named; the "[source
   consensus]" for 20 > 50 > 200 now names Keller and Deepvue-Minervini (v5 does not require the 50 over the 200).
9. "A close under the pullback low: the stop" (8.5) contradicted the house stop, which is a real stop order a few cents
   under the low (A3, A4, D41).
10. House-rule wording: B22 is "the 3 days before a report" (not "3 trading days") and holds through a report only at
    5R; E52 names a "10-day" and "21-day" trail without saying EMA, and has no 50 SMA; SET.02's fast line is the 9 EMA.
11. Scanner summary: the v5 rule is not admin-only everywhere (its drawing can reach members behind two flags); it
    measures depth from the close to the highest high of 11 sessions; it requires price over the 200, not the 50 over
    the 200. The volume gates are "at most" 1.5x and 1.3x. "Stage 2" compares with the close 49 sessions earlier.
    The fixture test was re-run: the 10-day tests do not need the hand-written context; the other three do, and the
    21-day one also fails its rs_trend gate. "Almost cannot fire" is now marked as reasoning, not a live count.
12. "UCT's own index notes" for the "random moving average" quote: it is TSDR's section.
13. "surfing" was put in Kullamaggie's mouth; his word is "surfs".
14. Bonde's section was headed "originator": he describes common methods, and calls breakouts his own.
15. Added sources and definitions the first pass missed: Kullamaggie's 30-100%+ prior move and his beginner trail
    (first close under the 10-day); Bonde's definition of a major breakout and his "momentum stocks or growth stocks are
    best traded using breakout methods"; Keller's entry and 50-day fallback; ChartSchool's "zones" and
    "self-fulfilling prophecy"; TSDR's own stop-trim-trail rule and trigger menu; that TSDR's section is now headed
    "Patrick (TSDR)" (question 13).

---

## 13. Examples (from our data)

(Numbered 13 because this file already has a section 12. Produced 2026-11-09 from the local sandbox's daily bars, 1984 to
2026, scanned over the 2,630 names that ever met the house liquidity rule. Scan script: scratchpad
`setups/12-ma-pullbacks/scan12.py`; the charts and the three phone sheets are in `setups/12-ma-pullbacks/final/`.)

**The rule the scan used (section 8 plus the house rules, long side only).** Liquidity: close at least $10 and at
least $20 million traded a day over 50 days (B23). Trend: close within 25% of the 52-week high; 20 EMA above the 50 SMA
above the 200 SMA and price above the 200 (B26); the 200 SMA higher than 21 sessions ago; the 20 EMA and the 50 SMA
each higher than 10 sessions ago; the swing high the stock pulls back from is (within 3%) a 3-month high, standing in
for "after a breakout or gap". Pullback: 2 to 8 sessions from that swing high; the touch day closes at least 1 ATR
under the highest high of the last 11 sessions; no red day in the last 8 sessions with a range over 2 ATR; the 5-day
average volume below the 50-day average and the touch day at most 1.5x the 50-day average. Touch: the day's low within
1 ATR under to 0.25 ATR over the line, for each of three lines scanned separately: 10 EMA, 20 EMA, 50 SMA (the 200-day
is not a buy, 8.7). Hold day: the touch day closes at or above the line, or (undercut and reclaim) the next day does.
Trigger: the first day after the hold day that trades above the hold day's high; market-order entry at that price, or at
the open if it gapped over it, skipped if the fill would be more than 4% past the trigger (C28). Stop: 5 cents under the
lowest low of the touch, hold and trigger days; skipped if wider than 6% (the house default is about 3%, A13; the extra
room let the scan record what a wider stop does, see below). RS rating, group strength and the market reading (C31,
F65) are not in the sandbox and were NOT tested. One hit per 10 sessions per ticker. The outcome walks 60 trading days
forward from the day after entry with a FIXED stop, no trims, no breakeven move and no trail: it reports whether 3R
and 5R traded before the stop did.

**Base rate (2,630 of 2,630 liquid names scanned, 1984-2026).** 60,464 hits; 27.7% reached 3R before the stop; 17.5%
reached 5R; 84.1% eventually traded through the stop within the 60 days (a fixed stop with no trims, so most winners
also end in that count). By line: 10 EMA 33,323 hits, 27.1% / 17.1%; 20 EMA 20,048, 28.4% / 18.2%; 50 SMA 7,093, 28.4% /
17.2%. Cuts that mattered a little: a stop within 3% did better than a wider one (28.3% / 18.2% against 25.8% / 15.3%);
a clean hold beat an undercut-and-reclaim at 5R (18.1% against 15.7%); pullbacks of 4 to 8 days edged 2 to 3 day ones
(17.8% against 17.0% at 5R). Touch-day volume under 0.7x against over 1.0x made almost no difference (18.0% against 16.5%
at 5R), nor did the era (since 2020: 26.7% / 16.9%). Caveats: this is a mechanical rule with no RS, group or market
filter, no judgment of the chart, and a fixed stop; the house trade trims a third at 3R and 5R and trails the rest, so
its expectancy is not this number. The 60-day "best R" figures below are the high-water mark with that fixed stop and
say nothing about what a trailed exit would have kept.

**The ten examples (one per ticker; all ten were clean holds, none an undercut; all reached 5R).**

| # | Ticker | Trigger | Line | Pullback | Touch vol | Buy | Stop | Stop % | 3R on | 5R on | Best R (60d) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | QCOM | 1999-10-04 | 20 EMA | 6 days, 1.17 ATR deep, 6.1% off the high | 0.52x | 23.62 | 22.79 | 3.5% | 10-08 | 10-11 | 71 | Every line stacked and rising for months; a quiet six-day drift onto the 20 EMA; the first touch after a new high; no earnings in the window. The 71R is the late-1999 run and is not the point; the entry is. |
| 2 | CME | 2004-09-17 | 20 EMA | 5 days, 1.72 ATR, 5.1% off | 0.57x | 28.38 | 27.93 | 1.6% | 09-20 | 09-22 | 38 | A young, orderly uptrend (the stock was 2 years public); five quiet days into the line, a one-day hold, 3R the next session. Earnings came 10-26, well after 5R. |
| 3 | ISRG | 2007-06-27 | 50 SMA | 7 days, 2.28 ATR, 7.2% off | 0.80x | 15.34 | 14.95 | 2.5% | 07-10 | 07-20 | 27 | The deeper variant: seven days down to a rising 50 SMA with the 200 far below. 3R came on 07-10 on its own; the 5R day (07-20) is the earnings reaction day, so the trade would have met B22 (hold through a report only past 5R) only barely. Prices are split-adjusted (3-for-1 in 2017, 3-for-1 in 2021). |
| 4 | YELP | 2013-06-26 | 10 EMA | 4 days, 1.42 ATR, 5.7% off | 0.60x | 31.80 | 30.67 | 3.6% | 06-27 | 07-09 | 35 | The fast-leader variant: a stock that had ridden its 10 EMA since February; four quiet days to the line and 3R the next day. Earnings 08-01, after 5R. The stop is the widest of the ten and above the house 3%, so size would come down (A5). |
| 5 | TRGP | 2014-03-28 | 20 EMA | 4 days, 1.50 ATR, 2.3% off | 0.52x | 97.99 | 96.51 | 1.5% | 04-01 | 04-04 | 43 | Within 3% of the high, four days of small bars on half the normal volume, the 10 and 20 EMA still rising; the 50 and 200 ruler-straight beneath. Earnings 05-01, after 5R. |
| 6 | MOH | 2018-06-08 | 10 EMA | 6 days, 1.01 ATR, 7.8% off | 0.40x | 86.93 | 85.82 | 1.3% | 06-11 | 06-12 | 49 | Six days sideways on the lowest volume on the chart (0.4x), the line rising underneath; 3R in one session. It is the shallowest of the ten (1.01 ATR), right at the rule's edge, and shows why the depth rule is 1 ATR and not more. Earnings 08-01. |
| 7 | BFAM | 2019-04-23 | 50 SMA | 3 days, 2.24 ATR, 2.8% off | 0.73x | 125.87 | 124.84 | 0.8% | 04-30 | 05-01 | 29 | A three-day drop onto the rising 50 SMA in a steady grinder; a sub-1% stop. 3R came 04-30; 5R (05-01) is the earnings reaction day, the same B22 note as ISRG. |
| 8 | NVDA | 2023-05-05 | 20 EMA | 3 days, 1.75 ATR, 5.1% off | 0.70x | 27.87 | 27.19 | 2.4% | 05-17 | 05-18 | 30 | A leader two months into a stage-2 run; three red days to the 20 EMA on falling volume. 3R and 5R were both reached BEFORE the 05-25 earnings gap (which then added the rest of the 30R). Split-adjusted (10-for-1, 2024). |
| 9 | WING | 2024-01-09 | 20 EMA | 7 days, 2.76 ATR, 5.2% off | 0.65x | 249.06 | 245.51 | 1.4% | 01-11 | 01-16 | 37 | The owner's preferred shape: a multi-day drift (seven days) rather than a sharp drop, onto a 20 EMA that had been respected since November; 3R in two days. Earnings 02-21, after 5R. The deepest of the ten (2.76 ATR). |
| 10 | CAT | 2025-09-03 | 50 SMA | 6 days, 2.36 ATR, 5.7% off | 0.79x | 418.13 | 410.47 | 1.8% | 09-17 | 09-18 | 23 | A mega cap's first test of the rising 50 SMA after a 4-month run; six days down on sub-average volume, a tight hold, then a two-week grind to 3R (the slowest of the ten, 10 sessions). Earnings 10-29. |

Also qualifying and clean, not charted (one example per ticker was the rule): META 2024-01-04 (20 EMA, 36R), IDCC
2025-08-22 (20 EMA, 50R), FIX 2024-01-10 (50 SMA, 0.3x touch volume, 24R), TRGP 2024-05-28 (50 SMA, 26R), ERIC
1999-10-20 (50 SMA, 45R).

**Rejected after looking at the chart** (the scan passed them; a learner should not model them): SRPT 2012-09-27, where
the "win" was a drug-data gap the week after entry, not the pullback; MSTR 2024-02-26, 15% off its high and already
parabolic; TGT 2020-07-22 and HPE 2026-04-16, where price had only just reclaimed a flat 200-day (a recovery, not a
leader's pullback); TEAM 2021-07-02, a flat shelf rather than a pullback, with the 5R delivered by an earnings gap; CINF
2019-04-10, where 3R arrived only on the earnings reaction day. The scan also returned ETFs (TLT, IEF, LQD, IVV, SPY)
with sub-0.5% stops and inflated R multiples; they were excluded because the setup is taught on single stocks.

**Notable failures (in words, from the scan).**
- NVDA 2024-04-03 (20 EMA): a five-day pullback on 0.8x volume, 8% off the high, stacked and rising averages, a 2.8%
  stop: by the rule, as good as example 8. It triggered on 04-03, rolled over the next day and was stopped out for the
  full 1R; the stock then fell to its 50 SMA (about 76) before the next leg. The lesson is that the rule cannot see the
  market: the index was topping into a multi-week correction that started the same week. This is why F65 (market
  reading) sits above the setup.
- TSLA 2024-01-08 (50 SMA): the rule passed it because the 50 SMA was still (barely) above the 200 and the stock was
  within 25% of its high; but it was 20.6% off that high, the 50 SMA was flat, the 200 was rising into it, and the
  pullback was 3.6 ATR deep. It triggered, failed the same week and went from 240 to 170 in two months. A broken
  leader's first touch of the 50 is a correction, not a pullback (common mistake 5, 8.9); the 25%-off-high allowance is
  too loose on its own, and the owner may want to tighten it to 10 or 15% for this setup (question for him).
- MU 2026-10-07 (20 EMA): a seven-day drift onto a rising 20 EMA with the 50 and 200 far below, but 16.7% off its high
  and with a 5.9% stop (above the house 3%). The pullback failed on day two and the stock lost its 50 SMA within the
  week. Both numbers were warnings the rule allowed; under A13 the trade would have been skipped or sized down.
- The aggregate failure pattern: 84% of all hits eventually traded through a fixed stop within 60 days, and most of
  the 3R winners did too, which is what the trims and the breakeven move (B19, E51) are for; the setup's edge in this
  data is the roughly one-in-four chance of 3R and one-in-six chance of 5R, not a high hit rate.

**Data limits.** Daily bars only; the hourly Go Signal and red-to-green variants (8.2) were not scanned. No RS rating,
group rank or market reading in the sandbox, so C31 and F65 were not applied. Earnings dates were used only to read the
ten examples (the earnings database is complete from about 2005; QCOM 1999 shows none for that reason). Prices are
split-adjusted as the sandbox holds them. The scan is a mechanical stand-in for the owner's judgment, not a backtest
of his trade.

## 14. Failures and near-misses (from our data)

Built 2026-11-10 from the same scan as section 13 (`final/hits.json`, the buy over the hold day's high, the stop 5 cents under the lowest low of the touch, hold and trigger days). Scripts in the review scratchpad folder `setups/12-ma-pullbacks/`: `charts12.py` (both sets) and `near_scan12.py` (the near-misses: the scan's gates turned into flags, keeping only the candidates that fail exactly one gate criterion of the card, with the 200-day added as a fourth line so the wrong-line case can show; the 700 most liquid names of today's universe, 2005 on). Sheets in `final/`: `fail_1-4.png`, `near_1-4.png`, and `pair_11-ema20-pullback.png` (YELP 2013-06-26, the 10-day form, above GE 2024-01-05 from setup 11). Every chart carries the winners' levels: buy, stop, 3R, 5R, the pullback box and the touch mark. All numbers are read off the daily bars.

**Four failures (every gate passed, traded by the rules, stopped before 3R).**

| # | Ticker | Trigger | Line | Buy | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|
| 1 | NVDA | 2024-04-03 | 20 EMA | 90.10 | 87.57 | 04-04, day 1, low 85.88 | Closed 85.91 under the 20 EMA; 20 sessions later (05-01) it closed at 83.04, 2.89 under the 50-day; it reached the 3R level (97.69) on 05-23 without us. Section 13: the index topped the same week. | map.market_reading |
| 2 | GILD | 2014-11-10 | 50 SMA | 109.07 | 106.28 | 11-12, day 2, low 105.70 | The low broke the 50-day the same day; 20 sessions later (12-09) it closed at 105.91 and it never reached 3R inside the 60-session window. | none failed; map.after_entry_stop |
| 3 | AAPL | 2018-10-09 | 20 EMA | 56.21 | 55.00 | 10-10, day 1, low 54.01 | Closed 54.09, under the 20 EMA and the 50-day the same day; 20 sessions later (11-06) it closed at 50.94, 4.20 under the 50-day; never 3R. | none failed; map.after_entry_stop |
| 4 | PLTR | 2025-05-20 | 10 EMA | 127.78 | 124.27 | 05-21, day 1, low 119.41 | Closed 120.58 and did not close under the 20 EMA in the next 10 sessions; it reached 3R (138.31) on 06-11 and 5R (145.33) on 06-25 without us. A one-day shakeout. | none failed; map.tries |

TSLA 2024-01-08 and MU 2026-10-07 (section 13) stay in the card's list; TSLA shares a year with NVDA and MU's 5.9% stop fails map.stop_width, so they were not charted here.

**Four near-misses (the chart looks like the setup; exactly one gate criterion fails).**

| # | Ticker | Hold / would-be buy | The one criterion | The number | What it really is |
|---|---|---|---|---|---|
| 1 | IBM | 2010-08-16 / 08-17 | map.not_200_long | the line the low tagged is the 200-day SMA (122.14); 4 sessions, 2.41 ATR deep, 4.8% off the high | Which average: the 200-day is context, not a buy (map.one_setup names the 10-day, 20 EMA and 50-day). It stopped (best 0.71R). |
| 2 | ADI | 2023-04-17 / 04-18 | map.inv_third_close | 3 closes under the 20 EMA in the 8-session pullback (rule: a third close is a skip) | How many closes under: a line sliced, not held. Fewer than 5 closes, so not a Remount either; nothing to buy. Stopped at 0R. |
| 3 | META | 2026-10-08 / 10-09 | map.length | 10 sessions from the swing high to the touch day (rule: 2 to 8) | Longer than this card allows; on the 20 EMA a 10-session drift sits inside the 20 EMA Pullback card's 2 to 15 window, so judge it there. It reached 3R (best 3.01R) and was then stopped. |
| 4 | AMD | 2019-02-11 / 02-12 | map.near_high | 32.7% under the 52-week high 34.14 (rule: within 25%) | A recovering stock's 10-day, not a leader's pullback (common mistake 5). Stopped at 0R. |

Also found but not charted: TSM 2025-02-05 (a close under the 50-day on 4.5x the 50-day volume, map.inv_heavy_close) and WMT 2025-09-30 (2.1x).

**What the failures have in common.** All four were stopped within two sessions with a best excursion of 0R. Two (GILD, AAPL) lost the 50-day on the stop day and never recovered inside the window; two (NVDA, PLTR) were shakeouts that reached 3R and 5R within four to seven weeks without us. Three of the four touch days ran on 0.7x to 0.9x volume and every pullback was 1 to 3 ATR deep, so nothing in the pattern itself told them apart from the ten winners; the rule cannot see the market (NVDA) or the news, which is why F65 sits above the setup and why a failed hold is answered with a new trigger, not a re-buy (map.tries).
