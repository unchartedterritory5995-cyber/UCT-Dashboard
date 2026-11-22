# Setup 32: Remount (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
post or file named next to it and kept to 40 words or fewer. Quotes from Bulkowski's site and from Investor's Business
Daily (through Yahoo Finance) were read through a fetch tool that returns excerpts, and are marked so; check them by eye
before they ship. Nothing here is a ruling. Where I could not read a source, I say so and give no wording from it.

**Cold check, 2026-11-09 (two passes).** A second reader re-opened every source on their own: the outside pages live
(plain downloads where the site allows them; the fetch tool only for Bulkowski's site, which refuses plain downloads
with HTTP 406, and for Yahoo, which answered HTTP 429), all 103 UCT posts re-downloaded with every UCT quote re-found
and its section re-read, the app code, the rulebook, the verdict log, and the replay (its numbers re-read from its own
output files, the pause-entry numbers recomputed, and its event rule re-run against the app's own `remount.py`
candidate code: on AAPL, MSFT and NVDA, 2015 to 2026, the replay reproduced 100 of the app's 104 qualifying days and
added none, so it is a near-subset of the app's rule, not an exact match). That first pass ended before it wrote its
log; a third reader then redid the whole check (every outside quote re-found in a fresh live download, every UCT quote
re-found in the re-downloaded posts, every code claim re-read against the code, every replay number re-read from the
output files) and wrote the two closing sections. What changed is listed at the end under "Changed in checking"; what
was taken out, under "Removed in checking".

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's own
words; **outside source** (inside a tag) one outside educator or data source that is not the originator (IBD,
ChartSchool, the Wyckoff tutorial); **[UCT]** UCT's own writers, the owner's verdict log or UCT's own code; **[house
rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner
to accept or change.

Words used below. **The line**: the level the stock lost and then retook (a moving average, a breakout pivot, a price
level). **ATR**: the 14-day average true range. **R**: the risk on a trade (entry minus stop). **Remount day**: the
session that closes back above the line. **TSDR**: the owner, Patrick (his own Substack sections).

**How this dossier relates to setup 13.** `13-ma-reclaim.md` covers the 50-day and 200-day moving-average reclaim (the
"MA Reclaim" tag and the `uct_ma_reclaim` detector) and already lists the owner's 200-day remount posts. This dossier
covers the setup the app calls **Remount**: the production `remount.py` detector (a stay of 5 to 30 sessions under the
20 EMA, the 50 SMA or an old breakout pivot, then a close back above on volume), the level and pivot version the
owner also calls a remount, and the question of whether the two should be one setup. Where 13 already holds the
detail, I point to it rather than repeat it.

**The short version.**
- **"Remount" is not Stockbee's term.** The Stockbee blog's own search answers "No posts matching the query: remount"
  (also for "remounted" and "reclaim"; run on 2026-11-09 by the writer and again in checking). Our code's line "Pradeep
  Bonde / Stockbee swing system" and its "Bonde teaches" claims have no source I could find. The closest Stockbee idea is
  Bonde's 2011 post on a **failed range breakdown**, which he credits to Jesse Livermore. **As a setup name, "Remount"
  was found only at UCT. As a verb, it is not UCT's alone**: Kunal Desai (founder of BullsOnWallStreet) wrote on
  TradingView on 2025-05-30, "Today, it remounted the 9 EMA — a key trigger in my swing strategy for momentum re-entry."
  (found in checking; section 2). Our own Model Book calls "remount the 9 EMA" "the community’s phrasing". Who first
  used the word at UCT cannot be shown; most of UCT's uses are in the owner's sections.
- **What the owner means by it is wider than one moving average.** In UCT's public Substack the word appears in 90
  sentences (my count, re-counted in checking, section 6). About three quarters (67 or 68 of 90, by keyword) name a moving average (the 200-day most of all, then the 50-day,
  the 9/20 EMAs and "all MAs"). At least nine (ten by keyword) name a price level or "spot" instead, for example "remount the $100 level"
  (RBRK), "remount that $245 level" (IWM) and "remount the ATH from Jan" (XBI). One names AVWAPs ("Remounted the
  AVWAPs", QQQ), and one names a failed breakout ("failed breakout squat and remount", PLAB). The shared idea: **a line
  the stock lost is taken back.**
- **Outside, the same move has older names.** Gil Morales and Chris Kacher's **Moving Average Undercut & Rally** and
  **Undercut & Rally** (their own site, 2017); Wyckoff's **spring** and **shakeout** (StockCharts ChartSchool);
  Bulkowski's **busted** downward breakout (with measured numbers); Livermore's failed breakdown (through Bonde); Oliver
  Kell's **Wedge Pop** for the 10 and 20-day EMAs; and the plain bullish price crossover (ChartSchool).
- **Measured evidence.** Bulkowski: about a third to a half of downward breakouts from three patterns "bust" back up,
  and single busts then rise a long way on average (section 4.1; his numbers measure moves, not trades). My own replay
  of our `remount.py` rule on the app's daily bars (89,665 liquid remount days, 2005 to 2026, house stop under the
  remount-day low): 81% touched that original, never-moved stop within 60 sessions (some after a run), 50% reached 1R
  first, 26% reached 3R, 16% reached 5R; a simple house plan made about +0.07R a trade before costs (+0.11R above a
  rising 200-day, +0.01R below the 200-day). That is not clearly better than a plain one-day cross of the same averages
  (+0.075R above a rising 200-day), and 2 to 4 closes under did at least as well as 5 to 30. On daily bars the shape
  alone is a thin edge; picking the stock and the market has to carry it (section 4.4).
- **Our app has five different "remount" rules** (section 5): the production `remount.py`, the member drawing
  `draw:remount` (withdrawn from members on 2026-10-24 after failing a blind re-check), the internal `uct_ma_reclaim`,
  a one-line chart-builder starter scan, and the Study bank's Chart IQ "MA remount" event. They disagree on the line,
  the time below, the volume and the 200-day. Only the drawing and the Chart IQ event respect hard rule B26. The
  production detector's entry (line + 1 ATR), stop (1.5% under an older low) and much of its narrative are not
  sourced.

---

## 1. What it is

A stock that was working **loses a key line** (a moving average or a level that held it up) and lives under it for a
week or more, so the trade looks broken. Then it **closes back above that line** with buyers in control, and you buy
the retake with a stop under the remount day's low, betting the line is a floor again.

**Why it works (the psychology).** These points are reasoning from the sources, not measured facts.
- **Who is trapped: sellers and shorts.** The break below looked like the start of a downtrend. Morales and Kacher: "The
  stock essentially undercuts the moving average, faking out sellers and would-be short-sellers, and then rallies back
  above it." (VoSI FAQ, 2017.) The Wyckoff school calls the same thing a bear trap: "It is an example of a bear trap
  because the drop below support appears to signal resumption of the downtrend." (ChartSchool, about a spring.) When
  price closes back above, shorts cover and sellers who want back in must pay up.
- **Who is buying: people who waited for proof.** Brian Shannon: "Instead of “how low can I buy,” I ask “has price
  proven that buyers are back in control.”" ("Don't Buy the Dip, Buy Strength After the Dip", Alphatrends.) A retake of
  a line is one of the proofs on his list ("Reclaimed key levels"). Many trend rules only allow buying above the
  averages (our own B26 is one), so a remount re-opens the stock to those buyers.
- **Why the stay below matters.** A week or more under the line means the weak holders have had time to sell. The
  owner's version: "Shakeout while the market bottomed and quick remount." (BE, 2026-04-12.) The Wyckoff tutorial:
  shakeouts are "intended to induce retail traders and investors in long positions to sell their shares to large
  operators."
- **Who is in the way: the trapped longs above.** Holders who bought above the line and sat through the drop want out
  near breakeven. So a real remount needs force. IBD: "Stocks often need a large boost of buying power to muscle back
  above their 50-day lines after losing that level of support." (2015, fetch tool.)
- **Why it often fails.** Many lines are crossed back and forth. The stay below can be the start of a real decline,
  and a weak drift back over the line is what sellers use to get out. IBD: "A high-volume decline to or below the 50-day
  moving average followed by a weak low-volume rise is your chance to sell." (2013, fetch tool.) Morales describes the
  same weak rally as his short setup (section 3.2). Section 4 shows how often the mechanical version fails.

---

## 2. Origin and naming

**Who named it.** No outside trader that I could find uses "Remount" as the name of a setup. The verb is wider trader
usage: one outside educator, Kunal Desai of BullsOnWallStreet, calls a remount of the 9 EMA "a key trigger in my swing
strategy" (TradingView, 2025-05-30; row below). In UCT's material most uses are in the owner's (TSDR) sections; I cannot
say whether he coined the setup name or picked the word up from others.

| Check | Result |
|---|---|
| Stockbee blog search, `remount`, `remounted`, `reclaim` (https://stockbee.blogspot.com/search?q=remount), 2026-11-09 | "No posts matching the query: remount" (same for the other two). Blogger search can miss posts, and Bonde also writes on a members' site and on X, which I could not search. A strong hint, not proof. |
| Stockbee blog search, `failed breakdown` | Several posts. The one on point: "Jesse Livermore 3 point range breakdown failure setup" (2011-12-05). No "remount". |
| Web search for "remount" as a trading setup (three queries, 2026-11-09) | Nothing used the word as a setup name. The session's web-search budget then ran out, so no further searches were possible. |
| Web searches in checking (six queries by the first checker, two more by the second, 2026-11-09) | One verified outside use of the verb: Kunal Desai, "HIMS 20SMA Trend Contiuation PULLBACK SETUP" (TradingView, posted 2025-05-30, https://www.tradingview.com/chart/PLTR/VINcnR2j-HIMS-20SMA-Trend-Contiuation-PULLBACK-SETUP/): "Today, it remounted the 9 EMA — a key trigger in my swing strategy for momentum re-entry." and "Entry: Took a position on today’s remount of the 9 EMA." His profile on the page: "Kunal Desai, Founder of BullsOnWallStreet – Trading Education Since 2008". He names the setup a pullback, not a "remount". A lead only, not a source: a 2015 page on an unrelated property blog reproduces part of an unsigned trading post that names BullsOnWallStreet and calls the "breakout-remount" one of two favourite setups; the original post was not found, so nothing from it is used. |
| This repo's setup vocabulary (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`) | "Remount": `status_reason` "verbatim Sunday Scans usage (W1 §3.1)", `coined_by: null`. |
| This repo's setup catalog (`docs/superpowers/research/setups/setup_criteria.json`) | `"brain_template": "Remount (TSDR)"`. |
| UCT's public Substack, 103 posts 2025-06-01 to 2026-11-08 | First use in a post with a named writer: "Remounted 200SMA, like the big green volume bars on it." (TSDR WATCHLIST, 2025-06-20). Added in checking, the two earlier, unsigned uses: "BTC faked down and supported yesterday, trying to remount today." (2025-06-03, https://unchartedterritoryy.substack.com/p/stock-setups, a post under the publication's own byline with no section headings) and "GOOGL for single stock would be focus as it remounts 200 day." (2025-06-08, https://unchartedterritoryy.substack.com/p/sunday-scans, the unsigned index section). The verb was in use at UCT from the first week of the public Substack. |

**Where the Bonde attribution in our code came from: unknown.** `remount.py`'s docstring names the "Pradeep Bonde /
Stockbee swing system". Its narrative says the pattern was "popularized by Pradeep Bonde at Stockbee" and that "Bonde
teaches that remount breakouts frequently outperform original breakouts". The patterns router calls it "Bonde's
failed-breakdown reversal." I found no Bonde text that uses the word, makes that claim, or defines a 5 to 30 bar rule.
The task brief for this dossier also called it "Stockbee's term"; I could not confirm that either.

**What Bonde did write that is close.** "One of the setup Livermore used was a failed range breakdown setup. If a stock
tired to breakdown below long term range and then reversed and went up 3 points or more he would buy the stock."
("tired" is the original spelling.) And: "The same idea applies on short side. A stock breaks out of range and then
fails and goes down 3 point then it is short." (Stockbee, 2011-12-05.) This is a horizontal-level remount, credited to
Livermore. I did not check Livermore's own books.

**Names for the same picture.**

| Name | Line | Who | Where | My check |
|---|---|---|---|---|
| Remount, "remount and hold", "remounted all MAs", "remount the $100 level", "failed breakout squat and remount" | MAs first; also price levels, AVWAPs | The owner (TSDR) and UCT's unsigned index notes | UCT Substack, 2025-06 onward | Read in full (section 6). |
| "remounted the 9 EMA" (a verb inside a pullback setup, not a setup name) | the 9 EMA | Kunal Desai (BullsOnWallStreet) | TradingView post, 2025-05-30 | Read in checking. |
| Moving Average Undercut & Rally (MAU&R) | any moving average | Gil Morales and Chris Kacher | Virtue of Selfish Investing FAQ, first published 2017-07-13 | Read. Originators' own site. |
| Undercut & Rally (U&R) | a prior low in the base | Morales and Kacher | same FAQ | Read. Setup 29 in our list is the short version. |
| Failed range breakdown | the bottom of a long range | Livermore, as described by Pradeep Bonde | Stockbee, 2011-12-05 | Bonde read; Livermore not read. |
| Spring; shakeout; terminal shakeout | the bottom of a trading range | Richard Wyckoff's school | ChartSchool tutorial (Bogomazov and Lipsett) | Read. |
| Busted downward breakout | the bottom (or neckline) of a chart pattern | Thomas Bulkowski | thepatternsite.com | Read through a fetch tool (site blocks plain downloads). |
| Wedge Pop | the 10 and 20-day EMAs | Oliver Kell | Deepvue description; Kell's own TraderLion pages per setup 15 | Deepvue read (and re-read in checking); TraderLion refused this session (HTTP 403) and again in checking (a Cloudflare check page). Kell's own words are quoted and cold-checked in `15-wedge-pop.md`. |
| Bullish price-to-moving-average crossover | any average | StockCharts ChartSchool | "How To Trade Price-to-Moving Average Crossovers" | Read (cached copy from setup 13's session, same day). |
| Bear trap / failed breakdown | any support | general usage; UCT uses it too | e.g. "Shows what a failed breakdown can do." (UCT, 2025-10-05) | n/a |

**Where it sits next to our other setups.**
- **U&R (setup 29) and Oops / 2B (setups 30, 28):** a short undercut, one to a few sessions, of a prior low. The
  Remount is a **longer stay** under the line (the code's 5 to 30 sessions). Our Study audit already flagged that U&R,
  Remount, 2B/Oops and Kicker all read as "a trap or shakeout, then a reclaim" in the course brief
  (`docs/study/audits/2026-10-21/auditA_summary.md`).
- **MA reclaim (setup 13):** the 50-day and 200-day version. In the owner's posts these are the most common remounts.
- **20 EMA pullback and MA pullbacks (setups 11, 12):** the trend never broke; a short dip under a rising line and
  back. The Model Book's 20 EMA card even uses the word: "the remount of the 9 EMA is the buy".
- **Wedge Pop / EMA Crossback (setups 15, 14):** the 10 and 20-day EMAs after a coil.
- **AVWAP reclaim (setup 19):** the same idea on an anchored VWAP.
- **Launchpad (setup 7):** the averages bunch up and price pops out; the owner wants the pop "above the MAs".

---

## 3. Every definition I could find, source by source

### 3.1 Gil Morales and Chris Kacher: MAU&R and U&R (originators, own site)
Source: "What is the Moving Average Undercut & Rally (MAU&R) pattern?", Virtue of Selfish Investing (MoKa Investors,
LLC), first published and last updated 2017-07-13,
https://www.virtueofselfishinvesting.com/faqs/answer/what-is-the-moving-average-undercut-rally-mau-r-pattern
- **Who.** "When a leading stock breaks below its moving average, a move back above the moving average can provide a
  long entry point as the stock moves back up through the line." (A leader, not any stock.)
- **The trap.** "The stock essentially undercuts the moving average, faking out sellers and would-be short-sellers, and
  then rallies back above it."
- **Stop and exit.** "Once the buy signal is triggered, one then uses the moving average as a selling guide, and can
  adjust their stop to 1-2% below the line depending on risk-preference."
- **The level version.** "a straight U&R is simply an undercut of a prior low (price point) in the pattern and a rally
  back above that same low."
- Not stated: which average, how long below, a volume rule, a target.
- Added in checking: the FAQ names no book. Morales and Kacher's books exist (Wiley: *Trade Like an O'Neil Disciple*,
  2010; *In the Trading Cockpit with the O'Neil Disciples*, 2012; *Short-Selling with the O'Neil Disciples*, 2015, per
  Wiley's own listings) but none was read, so whether and how the U&R is defined there is unverified; setup 29's dossier
  says the same of the 2015 book. The FAQ page, re-read live on 2026-11-09, shows "First published: 13 Jul 2017" and
  "Last updated: 13 Jul 2017".

### 3.2 Gil Morales: the failed rally back to the 50-day (the short mirror)
Source: "Gil Morales and Dr. Christian Kacher - Part II" (the page uses a long dash), TradingMarkets Editors, 2000-01-08,
https://tradingmarkets.com/recent/gil_morales_and_dr_christian_kacher__part_ii-669593 (cached copy read the same day
for setup 13).
- After a top and a heavy break of the 50-day: "you’ll get kind of a wedging rally, in other words a rally where the
  volume is declining on the way up, back up to or through the 50-day moving average."
- "Then when that stock goes back through the 50-day moving average on volume, that’s your shorting point."
- So a remount on **declining** volume that fails is, to them, the setup on the other side.

### 3.3 Investor's Business Daily (through Yahoo Finance; fetch tool)
- "Use The 50-Day Moving Average To Pinpoint Opportunity Or Risk", IBD, 2015-05-14,
  https://finance.yahoo.com/news/50-day-moving-average-pinpoint-212000564.html : "Stocks often need a large boost of
  buying power to muscle back above their 50-day lines after losing that level of support." And: "Once below that line,
  institutional investors may use the 50-day line to mark a sell level."
- "When A Low-Volume Rebound Follows Big Sell-Off, Take Gains", IBD, 2013-10-28,
  https://finance.yahoo.com/news/low-volume-rebound-follows-big-183900666.html : "A high-volume decline to or below the
  50-day moving average followed by a weak low-volume rise is your chance to sell."
- IBD's line: the retake needs **heavy** buying; a light retake after a heavy break is a sell. No entry rule for the
  retake itself in what I read. investors.com refuses this tool's crawler; O'Neil's books were not read.

### 3.4 The Wyckoff school: spring, shakeout, test (StockCharts ChartSchool)
Source: "The Wyckoff Method: A Tutorial", ChartSchool, by Roman Bogomazov and Michael Lipsett,
https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial
- **The spring.** "A “spring” takes price below the low of the TR and then reverses to close within the TR;" (TR = the
  trading range.) "It is an example of a bear trap because the drop below support appears to signal resumption of the
  downtrend."
- **The shakeout inside an advance.** "Shakeouts may also occur once a price advance has started, with rapid downward
  movement intended to induce retail traders and investors in long positions to sell their shares to large operators."
- **The test after it.** "A spring is often followed by one or more tests; a successful test (indicating that further
  price increases will follow) typically makes a higher low on lesser volume."
- **Volume on the dip itself (added in checking).** "A low-volume spring (or a low-volume test of a shakeout) indicates
  that the stock is likely to be ready to move up, so this is a good time to initiate at least a partial long position."
  (The quiet volume is on the move below support, not on the advance after it.)
- **The confirmation.** A sign of strength: "a price advance on increasing spread and relatively higher volume".
- **The short mirror.** "Once TR support is broken on a major SOW, this breakdown is often tested with a rally that
  fails at or near support." (SOW = sign of weakness.)
- Wyckoff's spring is usually short and comes at the end of a base; the tutorial gives no number of days. Wyckoff did
  not use moving averages.

### 3.5 Thomas Bulkowski: the busted downward breakout (thepatternsite.com; fetch tool)
Sources: "Busted Rectangles" (updated 2020-12-29), https://www.thepatternsite.com/BustRectangles.html ; "Busted
Descending Triangles" (updated 2020-12-28), https://www.thepatternsite.com/BustDescTriangles.html ; "Busted
Head-and-Shoulders Tops" (updated 2020-12-28), https://www.thepatternsite.com/BustHST.html .
**Notice:** the site states "This website, in whole or in part, shall not be used to train artificial intelligence
(AI) systems, technologies," (the sentence continues). Read and cited here for research, with links and short quotes.
- **The rule.** "When price moves no more than 10%, reverses direction, and closes beyond the side opposite the
  breakout, it busts the chart pattern." For a downward breakout: "price closes above the top of the descending
  triangle". Then "Price continues moving in the new direction by more than 10%."
- **The buy (head-and-shoulders):** "place a buy order a penny above the head (the highest high in the chart
  pattern)."
- **The difference from a Remount.** Bulkowski's bust needs a close above the **top of the whole pattern**, not just
  back above the level that broke. It is a later, stronger signal than our remount day.

### 3.6 Pradeep Bonde (Stockbee): failed range breakdown and stops
- The setup (section 2): a stock that tried to break below a long-term range, reversed and "went up 3 points or more".
  Stockbee, 2011-12-05, https://stockbee.blogspot.com/2011/12/jesse-livermore-3-point-range-breakdown.html . Also: "In
  this range bound market you will find lot of these kind of setups. Because breakouts as well as breakdowns keep
  failing."
- On stops for a line-based entry, "Stops and exit and a setup", 2019-03-14,
  https://stockbee.blogspot.com/2019/03/stops-and-exit-and-setup.html : "Many trend followers use faster trend definition
  to put stop as trade moves in their direction. So if entry is on say break above 50MA , then stop is breakdown below
  50 MA." And, on his own momentum trades: "For momentum burst kind setup stop at low of entry day is logical as any
  revisit to low of the day tells you the momentum burst failed."
- Not stated anywhere I read: a 5 to 30 day stay below, the 20 EMA, a volume multiple, or the word "remount".

### 3.7 Brian Shannon (Alphatrends): buy strength after the dip; regaining the AVWAP
- "Don't Buy the Dip, Buy Strength After the Dip™", https://alphatrends.net/dont-buy-the-dip-buy-strength-after-the-dip/
  : "Instead of “how low can I buy,” I ask “has price proven that buyers are back in control.”" His list of "a few
  objective signals" includes "Higher highs and higher lows", "Reclaimed key levels" and "Anchored VWAP from key
  pivots".
- "Anchored VWAP", https://alphatrends.net/anchored-vwap/ : "When prices oscillate above and below the AVWAP it
  indicates indecision for that timeframe." And on a chart: "At (5) the buyers had regained control as the price surged
  above the flat AVWAP."
- So Shannon supports buying a retake of a level once price has proven itself (his chart example retakes a flat AVWAP).
  Our detector's narrative claims he calls
  the AVWAP reclaim "one of the highest-edge swing triggers in the entire trend-continuation library"; I found no such
  wording (section 5.8).

### 3.8 Oliver Kell: the Wedge Pop (through Deepvue)
Source: "Oliver Kell: 5 Screens to Find Stocks Like a Champion", Deepvue, last updated 2025-03-21,
https://deepvue.com/screener/oliver-kell-screens/ (cached copy from setup 13's session).
- "After a Reversal Extension, a Wedge Pop occurs when the stock rallies back through its moving averages."
- "A breakout above resistance and reclaiming the moving averages signals an early entry point."
- Kell's lines are the 10 and 20-day EMAs. His own words are quoted in `15-wedge-pop.md`.

### 3.9 StockCharts ChartSchool: the bullish price crossover (cached copy from setup 13's session)
"How To Trade Price-to-Moving Average Crossovers",
https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/how-to-trade-price-to-moving-average-crossovers
- Confirm: "ensure the price has conclusively crossed above the moving average. So, if you’re using candlestick charts,
  you’ll have to wait for a full candle close above the SMA."
- Entry: "Some traders prefer entering immediately upon confirmation, while others might wait for a breakout above the
  crossover candle or a retest of the moving average as support."
- Stop: "Place your stop-loss slightly below the SMA or the most recent swing low."
- Where it fails: "In sideways markets, particularly volatile ones, crossover signals are more uncertain and less
  reliable."
- Deepvue on Weinstein's flat-average stage: "During this sideways chop, it is best to avoid trading the stock as there
  is no defined trend." (https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/) The same page, on
  the way out of that stage (added in checking; Deepvue's words, not Weinstein's): "Once a stock shows signs of breaking
  out, such as large upward reversals or retaking key moving averages like the 50-day MA, it enters Stage 1B, which
  precedes Stage 2."
- The ChartSchool, Wyckoff, Hill and Deepvue pages were re-read live in checking; every quote above is on them.

### 3.10 Not read, so no wording or rule from them
- **Linda Raschke's Turtle Soup.** Our detector's narrative describes it; I could not read Raschke's own rules (book
  not available; setup 13's session also failed; no web search left). The narrative's "within 1-3 sessions" is
  unverified. Added in checking, a secondhand account only (John Patrick Lee, TradingMarkets associate editor,
  "Breakout After Failure", 2006-07-25, https://tradingmarkets.com/recent/breakout_after_failure-654653), summarizing
  Connors and Raschke's *Street Smarts* "Turtle Soup Plus One": "The previous 20-bar low must have been made at least
  three trading sessions earlier." and "An entry buy stop is placed the next day (day two) at the earlier 20-day low."
  and "If you are not filled on day two, the trade is cancelled." In that account the retake is a one or two day event
  after a fresh 20-day low, not a 5 to 30 session stay under a line. Raschke's own text is still not read.
- **Mark Minervini's "squat" and shakeouts.** Setup 6 cites his squat warning from the repo; I read no Minervini text in
  this session.
- **Granville's 200-day rules, Livermore's own books, O'Neil's books.** Not read.

### 3.11 UCT's own definitions (details and links in sections 5 and 6)
- **The owner (Substack):** a remount of the 200-day, 50-day, 9/20 EMAs or "all MAs", and of levels ("remount the $100
  level", "remount that $245 level"); he buys it on the remount day or on what follows: "Any sideways action or inside
  day can be looked at as opportunity." "Now I want an inside day or red to green on a gap down."
- **The brain's template "Remount (TSDR)"**, as this repo quotes it: "Reclaim and close above the key MA (200SMA, 50SMA,
  or all MAs)"; "Primary focus is the 200SMA remount and hold." (added in checking); "Ideal when remount follows 8+
  weeks of consolidation or a clean base."; confirmation "break of previous day's high lining up with 9/20EMA remount".
  The same catalog sums up the template's stop, not as a quote, as "below the remounted MA; family max 8.0%" (added in
  checking; `setup_criteria.json`, row `remount.stop`).
- **The production detector:** 5 to 30 closes under the 20 EMA, 50 SMA or a prior pivot; a close back above on 1.2x
  volume (section 5.1).

### 3.12 Comparison table

| Source | Line | Before the retake | Time below | Volume | Trigger | Entry | Stop | Target / exit |
|---|---|---|---|---|---|---|---|---|
| Morales and Kacher (VoSI) | any MA; a prior low (U&R) | a leading stock | not stated | not stated | moves back above the line | as it moves back up through | 1-2% under the line | the line as a "selling guide" |
| Morales 2000 (mirror) | 50-day | a top, then a heavy break | n/a | declining on the rally = weak | failure back through the line | short | not stated | not stated |
| IBD | 50-day (10-week) | a break of the line | not stated | "large boost"; light retake after heavy break = sell | not stated | not stated | not stated | not stated |
| Wyckoff (ChartSchool) | bottom of a trading range | a base (accumulation) | short; not numbered | spring ideally light; the later advance on "relatively higher volume" | close back inside the range | after a test that "makes a higher low on lesser volume" | not stated | the range top, then markup |
| Bulkowski | bottom of a pattern | a rectangle, triangle or H&S top | under 10% of follow-through | not stated | close above the **top** of the pattern | "a penny above the head" (H&S) | not stated | measured moves (section 4) |
| Bonde (Livermore) | bottom of a long range | a long range | not stated | not stated | reversal, "up 3 points or more" | after the 3 points | 50MA example: under the line | not stated |
| Shannon | key levels, AVWAP | a dip; the AVWAP flat | not stated | volume inside AVWAP | price "surged above the flat AVWAP" | after proof | not stated | not stated |
| Kell (Deepvue) | 10 and 20 EMA | a Reversal Extension, then a sideways coil | days | not stated | breakout plus the retake | early entry at the pop | (setup 15) | (setup 15) |
| ChartSchool crossover | any; 50, 200 named | context matters | any | "significant increase" | full candle close above | at once, over the crossover candle, or on a retest | slightly under the SMA or swing low | resistance, measured move, trail |
| UCT owner (Substack) | 200, 50, 9/20, all MAs; levels; AVWAPs | a base, a leader, a "shakeout" | days to weeks | "big green volume bars" | the remount day | the remount day, or the inside day / red to green / hourly higher low after it | in these posts, the line ("use the 50SMA as a stop") or a price level ("$198 should hold"); the house default is under the day's low (A3) | trims into strength, trail the 9/20 EMA |
| Our `remount.py` | 20 EMA, 50 SMA, prior pivot | a prior high above the line in the 60 bars before | 5 to 30 consecutive closes | 1.2x the 20-day | close above | line + 1 ATR | 1.5% under the lowest low of the last 5 breakdown bars | prior high + 7.5% |

### 3.13 Where the sources disagree
1. **Which line.** Any MA (Morales and Kacher, ChartSchool); the 50-day (IBD, Morales 2000); the 10 and 20 EMAs (Kell);
   the bottom of a range or pattern (Wyckoff, Bulkowski, Livermore via Bonde); AVWAP (Shannon); the owner uses all of
   them, the 200-day most.
2. **How long below.** Nobody outside gives a number. Wyckoff's spring and Morales's undercut are short; Bulkowski allows
   a fall of up to 10%; our code demands 5 to 30 consecutive closes.
3. **How strong the retake must be.** Just back above (MAU&R, ChartSchool's first choice, our detector); a close above
   the whole pattern (Bulkowski); "up 3 points" (Livermore via Bonde); with heavy volume (IBD: stocks "often need" it;
   the owner likes it).
4. **Volume.** Wanted by IBD ("often need a large boost of buying power") and liked by the owner ("like the big green
   volume bars"), gated at 1.2x by our code; Wyckoff wants the spring itself quiet and the advance after it heavier;
   Morales and Kacher's MAU&R page says nothing.
5. **Entry.** On the retake (Morales and Kacher, our scanner, ChartSchool's first choice); over the retake candle
   (ChartSchool's second choice; Bulkowski's buy stop); after a test or higher low (Wyckoff, the owner's inside day or
   hourly higher low).
6. **Stop.** 1-2% under the line (Morales and Kacher); slightly under the SMA or the swing low (ChartSchool); under the
   line (Bonde's trend-follower example); the remount day's low (house default A3); 1.5% under an older low (our code).
7. **Who.** A "leading stock" (Morales and Kacher; rule C31) versus any stock (our code); the owner trades both leaders
   and beaten-down names (setup 13, section 6.1).

---

## 4. Measured evidence

**For single stocks retaking a lost line as a swing trade, I found no published, checkable trade statistic.** What
exists measures pattern moves (Bulkowski), an index rule (Hill), or recognition by judges (our own lab). Section 4.4 is
my own replay.

### 4.1 Thomas Bulkowski: busted downward breakouts (fetch tool; AI-use notice on the site)
All three pages give their numbers for **downward breakouts that bust upward**. The rectangle and descending-triangle
pages add "in bull markets" ("This is for rectangle tops with downward breakouts (so they bust upward) in bull
markets."); the head-and-shoulders page names no market ("This is for head-and-shoulders tops with downward breakouts
(so they bust upward)."). Re-read in checking through the fetch tool.

| Pattern | Bust rate | Single busts (of those that bust) | Average rise after a single bust | Sample stated |
|---|---|---|---|---|
| Rectangle tops (BustRectangles.html) | "51% of rectangle tops will bust" | "66% will single bust" | "Single busted patterns will see price rise by 71% on average" | none on the page |
| Descending triangles (BustDescTriangles.html) | "42% of descending triangles will bust" | "71% will single bust" | "Single busted patterns will see price rise by 54% on average" | "276 busted patterns found out of 650" |
| Head-and-shoulders tops (BustHST.html) | "32% of head-and-shoulders will bust" | "67% will single bust" | "Single busted patterns will see price rise by 67% on average" | none on the page |

- How "rise" is measured is not stated on these pages; it is a price move to a later high, **not a trade result** with
  a stop. Single busts are the best case. For all busts together the head-and-shoulders page gives a much smaller
  number: "Busted head-and-shoulders tops (all varieties: single, double, and triple or more busted) see price gain an
  average of 35%." (fetch tool) The rectangle page does the same (added in checking): "Downward breakouts rise an average
  of 49%." followed by "That's for all types of busted rectangles (single, double, triple and more)." (fetch tool)
- The bust needs a close above the **top** of the pattern (section 3.5), which is later and higher than our remount day.
- Use for the course: it supports the idea that a failed breakdown can lead to a big move. It does not give a win rate
  for buying the first close back above the line.

### 4.2 Arthur Hill, CMT: the S&P 500 and its 200-day (StockCharts, 2019-02-23; cached copy from setup 13's session)
https://articles.stockcharts.com/article/articles-arthurhill-2019-02-just-how-effective-is-the-200-day-moving-average/
- "There were 90 completed bullish signals during this time period." "Of these signals, there were 20 winners with an
  average gain of 13.69% and 70 losers with an average loss of 1.32%." (January 1994 to January 2019, index only.)
- A 5-day smoothing "resulted in just 34 bullish signals over the last 25 years."
- Lesson: on a lost-and-retaken line, many small whipsaws and a few big trends is the normal shape. An index, not stocks.

### 4.3 Our own recognition tests (read from our code)
- **The member drawing `draw:remount` was withdrawn on 2026-10-24.** `api/services/auto_structures.py`: it had passed
  two blind packets in round 3 ("A 2.48 / 92%, B 2.42 / 92%"), but "Recertification C re-judged both on the strict
  textbook rubric" and scored "2.04 / 1.96 / 2.02 / 1.80, pooled 1.96 (chop lines, marginal or light-volume reclaims,
  brief losses)". A fix round with a textbook gate scored "2.06 / 2.14 / 2.40 / 1.96, pooled 2.14". The bar: every packet
  mean 2.3 or more, 70% of charts 2 or more, pooled 2.4 or more. So `MEMBER_REMOUNT_ROUND = None`.
- **The production detector against the traders' scored calls.** `uct_ma_reclaim.py`'s docstring reports, on the TEST
  half: "production `remount`: 23.0% at 7.28%, lift 3.15" (recall at a dense random ticker-day fire rate), against 32.8%
  at 3.88% (lift 8.46) for `uct_ma_reclaim`.
- Limits: these numbers say whether a chart **looks like** the setup to a judge or matches a trader's call. None
  measures profit.
- What the failures have in common, in the judges' words: **chop lines, marginal or light-volume retakes, and brief
  losses of the line.** Section 8 keeps tests against them as picture rules (they decide what a judge accepts as the setup), although
  the replay in 4.4 found they do not add return on their own.

### 4.4 My replay of `remount.py` on the app's daily bars (my computation, not a published statistic)
**Method.** Scripts and outputs are in the session scratchpad (`setups/32-remount/scripts/replay.py`, `analyze.py`,
`pause_entry.py`), not in the repo. Data: a local read-only copy of the app's bars database (`bars.db`; the writer
recorded 4,079 daily tickers, a re-count in checking found 4,284 distinct daily tickers with history to 2026-11-09;
2,534 of them produced a qualifying day), split-adjusted prices.
- **Events.** Every day from 2005-01-03 to 2026-08-12 on which `remount.py`'s core rule passes, evaluated on that day's
  close as a scan would see it: the 20 EMA or 50 SMA (value on the day, held flat, as the code does) or a swing-high
  pivot 6 to 80 bars old that price had closed above; the prior close under the line and this close above; 5 to 30
  consecutive closes under; a higher high in the 60 bars before the breakdown; volume at least 1.2x the 20 bars before.
  Not modelled: the hostile-context gate and the score (they need the app's context), follow-through and "already
  extended" (they need later bars). One row per stock per day; a day can qualify on more than one line.
- **Liquidity (B23):** close at least $10 and a 20-day average of at least $20 million traded. Dropped: 28,858 crossing
  days (out of 612,985 of all kinds) whose stop was under 0.5% of price, mostly back-adjusted inverse ETFs priced in the
  thousands, where a 5-cent stop means nothing.
- **Trade A:** market order at the remount-day close; stop 5 cents under the remount-day low (A3, F62). The walk starts
  the next day; on the day the stop is hit, that day's high is not counted. "3R" means the high reached entry + 3R
  before the stop, within 60 sessions.
- **House plan:** a third at 3R (at the open if it opens above, F63), stop to breakeven after it; a third at 5R; the rest
  sold on a close under the 21-day EMA once the 3R trim is done (E52); no trim and under +1R on day 10, out (C33); a gap
  under the stop fills at the open; at most 130 sessions. The stop is checked before the targets on the same day.
- **Limits.** The database holds today's tickers, so stocks that died are missing (results biased upward). No
  commissions or slippage. No RS rank (C31), no earnings dates (B22), no market reading (F65) except SPY's 200-day. No
  limit on repeat tries (E56). It is a mechanical test of the shape, not of the owner's selection.

**Results, entry A** (n = trades; "plan" = mean R of the house plan, with its standard error):

| Group | n | median risk | risk 3% or less | stop hit (60) | 1R | 2R | 3R | 5R | median best R | plan, mean R (se) | plan winners |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| All `remount.py` days | 89,665 | 2.85% | 53% | 81% | 50% | 35% | 26% | 16% | 1.01 | +0.071 (0.007) | 34% |
| Above the 200-day | 54,949 | 2.65% | 57% | 80% | 51% | 36% | 27% | 17% | 1.06 | +0.111 (0.009) | 35% |
| Below the 200-day (B26 forbids) | 34,716 | 3.20% | 46% | 82% | 49% | 34% | 25% | 15% | 0.95 | +0.007 (0.011) | 32% |
| Above a rising 200-day | 44,755 | 2.57% | 59% | 80% | 51% | 36% | 27% | 17% | 1.06 | +0.110 (0.010) | 35% |
| Line: 20 EMA | 40,728 | 3.06% | 49% | 80% | 50% | 35% | 26% | 16% | 1.00 | +0.066 (0.010) | 34% |
| Line: 50 SMA | 28,293 | 3.09% | 48% | 79% | 50% | 35% | 26% | 16% | 1.02 | +0.105 (0.012) | 35% |
| Line: prior pivot | 50,215 | 2.81% | 54% | 80% | 51% | 35% | 27% | 16% | 1.04 | +0.079 (0.009) | 35% |
| SPY above its 200-day | 72,001 | 2.68% | 57% | 81% | 51% | 35% | 27% | 16% | 1.03 | +0.078 (0.008) | 34% |
| SPY below its 200-day | 17,664 | 3.66% | 39% | 80% | 49% | 33% | 25% | 15% | 0.97 | +0.040 (0.015) | 33% |
| **Baseline:** one close under the 20 EMA or 50 SMA, then back over, 1.2x volume, above a rising 200-day (not `remount.py`) | 22,800 | 2.27% | 66% | 82% | 50% | 36% | 27% | 17% | 0.99 | +0.075 (0.014) | 33% |

**Time under the line** (`remount.py` days above a rising 200-day; 3R rate and plan mean R):

| Line | 5-9 closes under | 10-20 | 21-30 |
|---|---|---|---|
| 50 SMA | 5,710: 27%, +0.139 (0.029) | 5,436: 28%, **+0.207 (0.028)** | 2,201: 25%, +0.080 (0.044) |
| 20 EMA | 13,883: 27%, +0.115 (0.017) | 3,552: 26%, +0.110 (0.035) | 30 trades, too few |
| Prior pivot | 15,726: 27%, +0.080 (0.016) | 11,415: 28%, +0.124 (0.019) | 4,810: 27%, +0.159 (0.030) |

For comparison, 2 to 4 closes under (the U&R and pullback zone, not `remount.py`), same filters: 20 EMA 20,399 trades,
28%, +0.165 (0.015); 50 SMA 8,712 trades, 28%, +0.148 (0.023).

**Filters on all `remount.py` days** (plan mean R): volume 1.2-1.5x +0.067, 1.5-2x +0.078, 2x or more +0.070 (median
risk 3.81%); close in the upper half +0.068, lower half +0.090; close 0-0.25 ATR over the line +0.052, 0.25-1 ATR
+0.061, 1-2 ATR +0.113, over 2 ATR +0.094 (median risk 5.49%); the drawing's "textbook" level tests (held 10 of 15
closes before, at most 2 crossings in 60, broke 0.5 ATR under) +0.013 (16,501 trades) against +0.084 without; 50-day
rising +0.081, falling +0.063. Above a rising 200-day: stop 3% or less +0.127 (0.014), over 3% +0.085 (0.013). By
period: 2005-2009 +0.012, 2010-2015 +0.075, 2016-2020 +0.128, 2021-2026 +0.055.

**Stops and entries:**

| Entry / stop | n | median risk | risk 3% or less | stop hit | 3R | 5R | plan, mean R |
|---|---:|---:|---:|---:|---:|---:|---:|
| A: remount close / 5c under the remount-day low | 89,665 | 2.85% | 53% | 81% | 26% | 16% | +0.071 |
| A2: remount close / under the lower of the remount-day and prior-day lows | 89,665 | 4.92% | 21% | 69% | 22% | 10% | (not run) |
| `remount.py`'s stop: 1.5% under the lowest low of the last 5 breakdown bars | 89,665 | 8.30% | 0% | 53% | 11% | 3% | +0.038 |
| B: next day, over the remount-day high / under the remount-day low | 56,533 | 3.82% | 35% | 75% | 25% | 13% | +0.066 |
| P (above a rising 200-day): the first quiet day (range at most 1 ATR, or an inside day) within 5 sessions, all closes above the line; buy over its high the next day; stop under its low | 24,881 of 44,755 triggered | 1.99% | 78% | 84% | 28% | 19% | +0.091 (0.014) |

- Entry P filled a median 3 sessions after the remount day, a median 3.2% above the line (39% of fills more than 4%
  above the line).
- `remount.py`'s own entry (line + 1 ATR) sat a median 0.5 ATR above the remount close; on 22% of days it was already
  under the close.
- C28: the remount close sat a median 1.45% over the line; 16% of closes were more than 4% over it.
- B26: 39% of `remount.py` days closed under the 200-day; 50% were under it or under a falling one.
- C29: 9.4% of `remount.py` days closed more than 10% over the 10-day SMA (their median stop: 7.24%).

**What I read from it (plain words).**
1. The app's rule, traded with the house stop, is a thin edge: about +0.07R a trade before costs, +0.11R above a rising
   200-day. At a 2.85% median stop, 0.1R is about 0.3% of price, so commissions and slippage take a real share.
2. Four trades in five hit the stop within 60 sessions; half never reach 1R; about one in four reaches 3R and one in six
   reaches 5R. The result comes from a few big runners, which is why the trims and the trail matter.
3. The 5 to 30 session stay under the line adds nothing measurable over a one-day cross (27% to 3R either way). The time
   rule tells this setup apart from U&R; it does not make it better.
4. Being above the 200-day helps a little (+0.11R against +0.01R). That supports B26.
5. Volume, candle and the drawing's textbook tests did not improve the mechanical result. They still decide whether a
   chart looks like the setup (section 4.3), so the course can keep them as picture rules, not as edge rules.
6. `remount.py`'s stop is far too wide (median 8.3%; never within 3%) and does worse per R.
7. The owner's way of buying (a pause, then over its high) gives the tightest stop (median 2.0%, 78% within 3%) for about
   the same expectancy. It fits A13 best, at the price of missing 44% of remounts.
8. The best single group was the 50-day after 10 to 20 closes under it, above a rising 200-day (+0.21R). It is one cut
   among many; treat it as a hint, not a rule.

### 4.5 What is missing
- A replay that uses RS rank (C31), earnings dates (B22) and the market reading (F65) as of each date. My replay has
  none of these except SPY's 200-day.
- A check of the owner's own remount trades. The archive maps the `ma_reclaim` setup id to Remount
  (`api/services/wisdom/archive/ask_setup.py`); those rows are private and were not read for this public file.
- Until then the course should not state a win rate for this setup.

---

## 5. Our app: what the code actually does

### 5.1 `api/services/pattern_engine/detectors/uct/remount.py` (production; registered in the pattern engine)
The rule, read from the code (constants at the top of the file):
- **History.** At least 55 bars (`_EMA_PERIOD + _MAX_BREAKDOWN_BARS + 5`). The 20 EMA is seeded with the average of the
  first 20 closes of whatever bars the scan passes in.
- **Hostile-context gate.** Rejects only when all three hold: `trend_stage == 4`, `ma_alignment == "stacked_bearish"`
  and `rs_trend == "down"`. Otherwise a stock under a falling 200-day can fire.
- **Candidates.** Each of the last 5 bars (`_REMOUNT_LOOKBACK = 5`) is tried as the remount bar against three lines:
  the **20 EMA** and the **50 SMA** (each read **at the remount bar**) and every **swing-high pivot** (3 bars each
  side) from the last 80 bars that is older than the remount bar minus 5.
- **The line is held flat.** For a moving average, the code takes its value on the remount bar and counts how many
  closes before it were under **that number**. A falling average is treated as a horizontal level at today's value.
- **The retake.** The remount bar closes above the line; the bar before closes under it.
- **Time below.** 5 to 30 **consecutive** closes under the line right before the remount bar
  (`_MIN_BREAKDOWN_BARS = 5`, `_MAX_BREAKDOWN_BARS = 30`).
- **Pivot only:** at least one close above the pivot between the pivot and the breakdown.
- **Something to remount to.** The highest high in the 60 bars before the breakdown must be above the line.
- **Follow-through.** Up to 3 later bars are read; the candidate is dropped only if **every** one of them closes under
  the line. A remount bar that is the newest bar passes with no follow-through.
- **Volume.** Remount-bar volume at least **1.2x** the average of the 20 bars before it.
- **Already extended.** Dropped if, with 3 or more bars since, 4 or more of them closed over 8% above the line and they
  are 70% or more of the bars since.
- **Score.** Confidence = 0.40 geometry + 0.25 volume + 0.20 context + 0.15 x 50. Geometry rewards 10 to 20 sessions
  below, a close in the upper half of the bar, and follow-through. Volume: 1.2x scores 50, 1.5x 75, 2x or more 100.
  Context adds for Stage 2, stacked-bullish averages, rising RS and accumulation. The floor is 50; by my arithmetic the
  lowest reachable score is about 42.4, so the floor rarely binds. It keeps the best candidate.
- **Levels.** Entry = **line + 1.0 ATR(14)**; stop = **1.5% under the lowest low of the last 5 bars of the breakdown**;
  target = **prior high x 1.075**. (The ATR is a simple 14-bar average of true range.)
- **No liquidity floor** in the detector itself; the scanning universe decides.

### 5.2 `api/services/pattern_engine/setup_draw.py`, `remount` (the drawing `draw:remount`, round 3)
- The line is a **horizontal swing pivot** (a high or a low, up to 120 bars before the remount bar), never an average.
- 5 to 30 consecutive closes under it; the remount close above it within the last 3 bars, on an up close, on at least
  **1.2x** the 20-bar volume; every close since holds it.
- **The level held before it broke:** at least 10 of the 15 closes before the breakdown at or above it.
- **Not a chop line:** at most 2 close crossings and at most 3 candle bodies cut in the 60 bars before the breakdown.
- **The break left it:** a close at least **0.5 ATR** under it. **A real retake:** the remount close and the latest
  close at least **0.25 ATR** over it, and the latest close at most **2 ATR** over it.
- **Gate:** the close above a **rising 200-day SMA** (above its value 20 sessions earlier) and no pending-deal price pin.
- Status: **withdrawn from members** (section 4.3); the team chart still shows it.

### 5.3 `uct_ma_reclaim.py` (internal, the "MA Reclaim" tag)
The 50-day or 200-day; at least 3 of the prior 20 closes under it; close above, at most 2 ATR over; no volume, slope or
200-day test; entry the close, stop the day's low, targets 2R and 3R. Full detail in `13-ma-reclaim.md`, section 5.1.

### 5.4 The chart-builder starter scan "Remount"
`app/src/components/chart/engine/ast/starterScans.json`: `"source": "(close < sma(close, 50))[1] && above_50sma"`. In
words: yesterday closed under the 50-day, today closes above it. One day under counts. No volume, no 200-day, no slope.
The repo's setup catalog (`setup_criteria.json`) notes the firm's own entry kind for this setup is `ema_reclaim_21` with
a stop of `EMA21 - 0.25 x ATR14`, and: "The firm's CODE uses the 21 EMA while its TEMPLATE prose says
200SMA/50SMA/20EMA."

### 5.5 The Study bank's Chart IQ event "MA remount" (`api/services/chart_iq/engine/v44_read.py`)
Fires when 4 of the last 6 closes were under the 20 EMA, the close is back over the 9 and 20 EMA, the close sits at
least 30% up the day's range, the close is over a 50-day SMA that is higher than 10 sessions ago, and over the 200-day
SMA (the 200-day test is skipped when the chart has no 200-day value yet; `not s200 or x['c'] > s200`). Its text: "first close back over the 9 and 20 EMA (4 of the last 6 closes were under the 20), holding the 50SMA".
This is the owner's "remount of the 9/20EMAs" inside an uptrend, and it is the only rule in the app with both a rising
50-day and a 200-day test. It is a pullback trigger more than a lost-line setup.

### 5.6 The morning candidates scan (not in this repo)
The Morning Wire's candidate buckets include `remount` ("Remount (up to 10)" in the course notes; `engine.py`'s
`candidates`). The finviz family docstring says these scanner setups "run only on the PC". The rule lives in a private
repository and is not reproduced in this public file; its criteria should be checked against section 8 before the
course points members at that list.

### 5.7 Model Book card, journal tags, Study, course notes, vocabulary
- **Model Book card** (`app/src/pages/modelbook/setupCatalog.js`): "Remount", family "Reversals & Reclaims", long: "A
  leader slips below its moving average, shakes out weak hands, then remounts it with authority." The glyph draws a
  4-period EMA (an illustration).
- **Model Book playbook** (`setupPlaybooks.js`): no Remount entry. The EMA Crossback playbook uses the word: "price
  tightens and then remounts both".
- **Journal tags** (`app/src/constants/setupGroups.js`): "Remount" (Swing). Also "Classic U&R", "Wedge Pop", "Failed
  H&S/Rounded Top". No "MA Reclaim" or level-remount tag.
- **Study unit SET.28** (`docs/study/UNITS-method.md`): "A leader slips below its line, flushes weak hands, then remounts
  with a wide-range candle on volume; loss and reclaim of the line, not a pullback." The course chapter
  (`docs/curriculum/uct_method_chapters.json`) promises "'With authority,' in numbers": "the range and volume
  thresholds it must clear". **No such numbers exist yet**; section 8 proposes them.
- **Course mapping** (`docs/curriculum/curriculum_final_v2.json`): "a Remount or U&R fires as PREV LOW RECLAIM".
- **Vision rubric** (`api/services/pattern_vision/rubrics.py`): "Price reclaims a key moving average / breakout level
  from below." Must-haves include "The reclaim looks decisive, not a marginal poke".
- **Vocabulary**: approved as "verbatim Sunday Scans usage", `coined_by: null`.

### 5.8 What looks wrong or disagrees with the sources
1. **Unsourced attributions in `remount.py`.** "Pradeep Bonde / Stockbee swing system"; "popularized by Pradeep Bonde at
   Stockbee"; "Bonde teaches that remount breakouts frequently outperform original breakouts"; Shannon calling the AVWAP
   reclaim "one of the highest-edge swing triggers in the entire trend-continuation library"; Raschke's Turtle Soup as a
   reclaim "within 1-3 sessions"; "remount setups in liquid names ($300M+ cap) produce 1.5:1+ RR with high frequency";
   "failed remounts often decline 10-20% further before stabilizing"; "strong remounts frequently extend 15-30% above
   the prior high over 4-12 weeks". I found a source for none of them. The patterns router's "Bonde's failed-breakdown
   reversal" has the same problem. My replay (section 4.4) does not support the "outperform" claim: on daily bars a 5 to
   30 session remount did no better than a one-day cross.
2. **B26 breach.** The hostile gate needs Stage 4 **and** stacked-bearish **and** falling RS, so a remount under a
   falling 200-day fires. In my replay 39% of the days that pass its core rule closed under the 200-day.
3. **The line is frozen at today's value.** Counting closes under today's 20 EMA value is not the same as counting
   closes under the 20 EMA. On a falling average, earlier closes that were above the line on their own day can count as
   "below". The drawing avoids this by using horizontal pivots only.
4. **No chop-line, depth or margin tests.** The judges' main failures were "chop lines, marginal or light-volume
   reclaims, brief losses". `remount.py` has none of the drawing's held-before, crossings, depth or margin gates.
5. **Entry not the house's.** Line + 1 ATR is in no source. In my replay it sat a median 0.5 ATR above the remount
   close, and on 22% of days it was already under the close, so it is neither the close nor a clean trigger. The house
   buys with a market order on the trigger (E57).
6. **Stop not the house's.** 1.5% under the lowest low of the last 5 breakdown bars is in no source and is often far
   wider than A13's ~3%. In my replay its median distance was 8.3% of price, never within 3%, and it reached 3R on 11%
   of trades against 26% for a stop under the remount-day low.
7. **Target not the house's.** Prior high + 7.5% versus the house trims (a third at 3R, a third at 5R, trail the rest).
8. **Five rules, one name.** The production detector, the withdrawn drawing, the internal MA reclaim, the one-line
   starter scan and the Chart IQ event all give a different answer to whether a chart is a remount. A member who sees
   the word in two places cannot tell they are related.
9. **The Study unit promises "a wide-range candle on volume"** that no remount rule tests (only `remount.py` tests
   volume, at 1.2x; none tests range).

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com), read 2026-11-09. The sitemap lists 103 posts
(2025-06-01 to 2026-11-08); I used the full-text copies saved the same day for setup 13 (101 posts read in full, one
subscriber-only, one placeholder) and re-checked the sitemap: no new posts. Authorship is by section, as in setup 13:
"TSDR’s Weekly Outlook & Watchlist", "TSDR WATCHLIST", "TSDR Trading" and "Patrick (TSDR)’s Weekly Outlook" are the
owner; the "Charts Covered" lists and "Some great charts below that I am watching" follow his section and I read them as
his; "Index & ETF" sections and "Thoughts on the Market" are unsigned.

**My count.** "remount" (any form) appears in 90 sentences: 46 in the owner's sections, 33 in the unsigned index
sections, 4 in "Thoughts on the Market", 2 in Bracco's, 5 elsewhere. About 67 name a moving average; at least 9 name a
price level, "spot" or old high; 1 names AVWAPs; the rest name nothing. (Method: every sentence with the word; the
object read by a keyword match and then checked by hand for the level cases.) **Re-count in checking** (all 103 posts
re-downloaded, sections assigned from the headings, the "Charts Covered" and "Some great charts" lists counted with
the owner's section they follow): 90 sentences again; 50 owner, 33 index, 4 Thoughts on the Market, 2 Bracco, 1 in the
heading-less 2025-06-03 post. By keyword, 68 name a moving average, 10 a level, 1 AVWAPs, 11 nothing. The 46/50 gap is
four sentences under lists after his section; the hand-checked level cases above are unchanged.

### 6.1 Remounts of a level, a pivot or a "spot" (the part setup 13 does not cover)
- RBRK: "Looks goo against the 50SMA, want to see a higher low and remount the $100 level." ("goo" is the original.)
  Then: "Getting back through $100 soon is ideal." (2026-09-06,
  https://unchartedterritoryy.substack.com/p/sunday-scans-fcd)
- IWM, the plan and the result: "Upside reversal on IWM next week and remount that $245 level and could be playable."
  (unsigned index section, 2026-03-29, https://unchartedterritoryy.substack.com/p/sunday-scans-352) Two weeks later: "How
  many times have we mentioned $245 and the 2021 and 2024 highs! Look how well this held, remounted, and acted as a
  launching spot." (2026-04-12, https://unchartedterritoryy.substack.com/p/sunday-scans-a43)
- XBI: "Want to see it remount the ATH from Jan." (2026-05-03,
  https://unchartedterritoryy.substack.com/p/sunday-scans-bcc)
- INCY: "Love the remount and taking out $100 psych level again. Friday was an entry opportunity. Now I want an inside
  day or red to green on a gap down." (2026-01-04, https://unchartedterritoryy.substack.com/p/sunday-scans-153)
- ALAB: "Right now it is potentially putting in a mini base, remount, and higher low here against $210." Then: "There, I
  would look to peel of a partial position and trail the remaining up the 9ema and 20ema on the daily." (TSDR Trading,
  2025-10-08, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208)
- PLAB, the failed-breakout version: "Daily shows a failed breakout squat and remount. A little hourly tightness and
  higher low would allow for clean entry and risk management for a breakout over $38.50 and $40." (2026-02-08,
  https://unchartedterritoryy.substack.com/p/sunday-scans-29e)
- HPE: "Some call it the failed breakout-squat setup. I think if that happens you buy with 10 toes down." (2026-09-27,
  https://unchartedterritoryy.substack.com/p/sunday-scans-09b)
- QQQ (hourly, unsigned index section): "Remounted the AVWAPs from swing low and from ATHs." (2025-12-21,
  https://unchartedterritoryy.substack.com/p/sunday-scans-34b)
- META: "I want to see it build out against the 200SMA and remount some key spots before going after it again."
  (2026-10-25, https://unchartedterritoryy.substack.com/p/sunday-scans-36e)
- The market: "Would we remount or overshoot some spots and base and chop again?" (owner's outlook, 2026-11-01,
  https://unchartedterritoryy.substack.com/p/sunday-scans-669)
- BTC (unsigned): "First failed attempt at remounting short term levels." (2026-03-08,
  https://unchartedterritoryy.substack.com/p/sunday-scans-dcf)

### 6.2 Shakeouts, failed breakdowns and the retake (his framing of why it works)
- BE: "Possibly a truly immaculate base here. Did nothing wrong while market corrected. Shakeout while the market
  bottomed and quick remount." (2026-04-12, sunday-scans-a43)
- Under the "TEAM (Daily)" heading (the PANW heading just above it has no text): "Pulls into and undercuts this range
  slightly closing with a strong lower wick. Remounts MAs and breaks highs." (2026-10-11,
  https://unchartedterritoryy.substack.com/p/sunday-scans-31b)
- GLW: "Lost the 50SMA and then went double inside days and remounted. Willing to buy it back despite the choppy
  nature." (2026-06-14, https://unchartedterritoryy.substack.com/p/sunday-scans-e95)
- LLY: "Remount of MAs after an 8 day drift following the $1T market cap and $1000 mark." (2025-12-14,
  https://unchartedterritoryy.substack.com/p/sunday-scans-f2f) Later: "Held the 50SMA and quick remount. Now getting
  tight and putting in higher low and holding the top of the base and 9EMA." (2026-08-23,
  https://unchartedterritoryy.substack.com/p/sunday-scans-807)
- His list of buy spots: "Give me a clean retest or remount after and undercut." (2026-09-06, sunday-scans-fcd)
- "Buying those shakeouts is the optimal RR." (2025-10-26, https://unchartedterritoryy.substack.com/p/sunday-scans-13e)
- Unsigned index notes: "Shows what a failed breakdown can do." (2025-10-05,
  https://unchartedterritoryy.substack.com/p/sunday-scans-6ef); "the best way to trade a head and shoulders top is to buy
  the failed breakdown of it." (2025-09-01, https://unchartedterritoryy.substack.com/p/sunday-scans-4d1); SPY weekly:
  "Just like that, failed breakdown and back above all weekly MAs." (2026-04-12, sunday-scans-a43)
- Panic and quick remounts (unsigned): "The sell bars have been eaten up so quickly, like most of the market when the
  panic sets in and selling accelerates just leads to quick remounts." (2025-12-21, sunday-scans-34b)

### 6.3 Moving-average remounts (short list; the full 200-day list is in setup 13, section 6)
- "The remount and hold of the 200day has been a very reliable setup and area to risk off recently." (GOOGL, 2025-07-13,
  https://unchartedterritoryy.substack.com/p/sunday-scans-6a6)
- "Remounted 200SMA, like the big green volume bars on it." (AMD, TSDR WATCHLIST, 2025-06-20,
  https://unchartedterritoryy.substack.com/p/market-update-and-watchlist)
- "Every timeframe looks ideal and the remount of the moving averages in a strong way on Friday I thought was very
  notable. Any sideways action or inside day can be looked at as opportunity." (MU, 2025-08-10,
  https://unchartedterritoryy.substack.com/p/sunday-scans-f6f)
- "Strong close on Friday remounting all moving averages. Confirmed higher low following 8 weeks of consolidation now."
  (GEV, 2025-09-21, https://unchartedterritoryy.substack.com/p/sunday-scans-88a)
- "On the daily here it notably remounted all MAs and put in two tight rest days above the 50SMA. $198 should hold in a
  worst case scenario but ideally we use the 50SMA as a stop." (RDDT, 2025-11-30,
  https://unchartedterritoryy.substack.com/p/sunday-scans-422)
- "As soon as this triggers a break of previous day’s high, preferably lining up with a remount of the 9/20EMAs then we
  can smash it." (NTRA, 2026-01-04, sunday-scans-153)
- "Friday had an impressive remount and kicker candle. The weekly has remounted all MAs." (TLN, 2026-01-04,
  sunday-scans-153)
- "The 200SMA remount was attractive out of this mini base here but it is still curling lower." (RDDT, 2026-07-12,
  https://unchartedterritoryy.substack.com/p/sunday-scans-898)
- "Honestly probably okay to try as a reversal on the remount but would rather focus on pullbacks on stuff like RBRK."
  (DDOG, 2026-08-16, https://unchartedterritoryy.substack.com/p/sunday-scans-da5) He ranks a remount below a pullback in
  a leader.
- A missed one, in his own reflection: "Maybe DELL here on this remount. Only to see them fail and would have resulted
  in stops." (2026-08-02, https://unchartedterritoryy.substack.com/p/sunday-scans-cd2)
- The market: "WAITING for stocks and the market to remount the 9/20 period moving averages." and "Wait for a remount of
  MAs, and wait for leaders to show leadership, get tight with good setups and relative strength." (Thoughts on the
  Market, 2025-11-19, https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c)

### 6.4 Bracco
- "Clearly the strongest of the memory names and worth watching if that group turns back up again and can remount the
  50sma." (2026-08-09, https://unchartedterritoryy.substack.com/p/sunday-scans-1ad)
- "Wouldn’t even mind some dips and shakeout below 20ema and remount." (2026-04-26,
  https://unchartedterritoryy.substack.com/p/sunday-scans-f2d)
- His "MAU&R’s (moving average undercut and rallies)" note (2025-10-26) is quoted in setup 13, section 6.3; he names
  Morales and Kacher's term directly.

### 6.5 The owner's rulings in the verdict log (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)
No ruling names Remount. The closest:
- Kicker, UAL 2025-08-12, cut: "Sellers need to be trapped, so there needs to be like an almost failed breakdown vs just
  a little baby red candle." The trap is the point.
- Launchpad, ADSK 2023-05-31, cut: "I want it above the MAs". The reviewer's note: the trigger must put price above all
  the averages, the 200-day included.
- Go Signal, definition: "GO SIGNAL is similar to the oops reversal or the UNR but is an hourly GO SIGNAL btw" (the
  undercut-and-reclaim family on the hourly).
- B26 (hard): "No longs below 200SMA (unless parabolic long)".

### 6.6 Example candidates named in UCT posts (to check on real bars before any lesson; I did not chart them)
1. RBRK, the $100 level, holding near its 50-day, September 2026 (owner, 2026-09-06).
2. IWM, the $245 level (2021 and 2024 highs), planned 2026-03-29, "held, remounted" by 2026-04-12 (unsigned).
3. XBI, the January all-time high, May 2026 (owner, 2026-05-03).
4. INCY, the $100 round number, around the turn of the year (owner, 2026-01-04: "Friday was an entry opportunity.").
5. ALAB, a mini base and remount against $210, October 2025 (owner, 2025-10-08).
6. PLAB, failed breakout squat and remount, February 2026 (owner, 2026-02-08).
7. BE, shakeout and quick remount at the April 2026 market low (owner, 2026-04-12).
8. GLW, lost the 50-day, double inside days, remounted, June 2026 (owner, 2026-06-14).
9. LLY, remount of the MAs after an 8-day drift, December 2025 (owner, 2025-12-14).
10. TEAM (heading), undercut of the range and remount of the MAs, October 2026 (owner, 2026-10-11).
11. GEV, all MAs after 8 weeks of consolidation, September 2025 (owner, 2025-09-21).
12. RDDT, all MAs, two tight days over the 50-day, stop the 50-day, November 2025 (owner, 2025-11-30).
13. A failure to show: DELL, "this remount", in the weeks before the post, "would have resulted in stops" (owner,
    2026-08-02).

### 6.7 Candidates from my replay (section 4.4; found by code, not judged by eye; check before any lesson)
All passed `remount.py`'s core rule and also closed above a rising 200-day, on 1.5x or more the 20-day volume, green,
in the upper half of the range, 0.25 to 2 ATR over the line. "Best" is the largest gain before the stop within 60
sessions, with a stop 5 cents under the remount-day low. Dates are remount days.

| Stock | Remount day | Line | Closes under | Volume vs 20-day | Stop distance | What followed |
|---|---|---|---:|---:|---:|---|
| VRT | 2023-04-27 | 50 SMA | 17 | 1.52x | 5.6% | best 15.4R; no stop in 60 sessions |
| UBER | 2023-05-01 | 20 EMA | 6 | 2.64x | 3.1% | best 14.9R; no stop |
| TSM | 2023-05-17 | 50 SMA | 18 | 2.50x | 3.2% | best 6.9R; no stop |
| NOW | 2023-05-17 | prior pivot | 23 | 1.90x | 3.2% | best 7.6R; no stop |
| DELL | 2023-12-14 | 20 EMA | 8 | 1.53x | 2.2% | best 36.9R; no stop |
| CAVA | 2024-08-09 | 50 SMA | 22 | 2.01x | 5.1% | best 11.2R; no stop |
| SPOT | 2024-09-19 | prior pivot | 20 | 2.34x | 3.1% | best 12.9R; no stop |
| COST | 2024-11-06 | 50 SMA | 8 | 1.59x | 1.4% | best 11.0R; no stop |
| SNOW (failure) | 2023-03-31 | 50 SMA | 21 | 1.66x | 8.1% | best 0.3R; stopped on the 4th session |
| AXON (failure) | 2023-11-08 | prior pivot | 14 | 3.82x | 4.6% | stopped the next session |
| MSFT (failure) | 2024-03-14 | prior pivot | 8 | 1.69x | 1.7% | stopped the next session |
| PLTR (failure) | 2024-05-06 | 50 SMA | 26 | 5.30x | 4.9% | gapped through the stop the next session |
| NOW (failure) | 2024-07-25 | prior pivot | 13 | 5.02x | 5.6% | best 0.4R; stopped on the 6th session |

The failures look as clean as the winners on these numbers; several had the biggest volume. That is section 4.4's point
in pictures: the rule finds the shape, and the shape alone does not sort winners from losers.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | What it means here | Conflict? |
|---|---|---|
| **B26** no longs below the 200-day SMA (hard) | Only remounts that close above the 200-day are longs for us. | **Yes for our detector**: it fires below the 200-day. In my replay 39% of its days closed under the 200-day, and those averaged +0.01R against +0.11R above it. |
| A3, F62 stop a few cents under the day's or prior day's low | Under the remount day's low. The remount day crossed the line, so its low is usually under the line. | `remount.py` uses 1.5% under an older low; the owner sometimes uses the line itself. |
| A13 stop usually within about 3% | A stop under the remount-day low was 3% or less on 53% of `remount.py` days (median 2.85%); the pause entry got 78% within 3% (section 4.4). | Yes on wide remount days. Wait for the pause (section 8.2), size down, or skip. |
| A5 one price, one stop, no adds | Buy once. | The owner sometimes adds on a later hold (setup 13, 6.1); the course teaches one entry. |
| B19, E51, E52, F63 trims and trail | A third at 3R, a third at 5R, the rest under the 21-day (steadier) or 10-day (fast) on a close; breakeven at 2R to 5R. | `remount.py`'s prior high + 7.5% target is not house. |
| B20 gap through the stop | First 30-minute low is the new stop; out past 2R. | None. |
| B22 no new buy within 3 days of earnings | Applies. A remount on the earnings gap itself is after the report and allowed. | None. |
| B23, D42 liquidity | $10 and $20 million a day; at most 1% of average daily volume. | `remount.py` has no floor of its own. |
| C28 no chasing past 4% | Buy point = the line (a level or average). In my replay the remount close sat a median 1.45% over the line; 16% were more than 4% over it. | Yes on big remount days. Owner to name the buy point (question 7). |
| C29 not more than 10% over the 10-day | Rare on a remount (price has just come back from under its lines). 9.4% of `remount.py` days closed more than 10% over the 10-day SMA. | Rarely. |
| C31 RS 80+ in a leading group | Morales and Kacher's MAU&R is for "a leading stock". | The owner also remounts beaten-down names (setup 13). Owner to rule (question 6). |
| C33 time stop | Under 1R after 10 days, sell. Chop is this setup's main failure. | None. |
| D47 shorts mirror longs | The failed retake from below, under a falling 200-day (section 8.6). | Needs B26 and D48. |
| E57 market orders | Market order on the remount close, or as price trades over the pause high. | `remount.py`'s line + 1 ATR is not a market-order trigger. |
| F65, B18 market reading | Green full; Yellow smaller; Orange A+ only; Red cash and shorts. | In my replay, with SPY under its 200-day the stops were wider (median 3.66%) and the plan made +0.04R against +0.08R. |

---

## 8. Proposed rules for our course

Every line is measurable on daily bars unless it says hourly. "The line" is the level the stock lost. ATR = the 14-day
average true range. Where I propose a number, section 4.4 says what the replay showed about it; a rule that defines the
picture is not the same as a rule that adds edge, and I say which is which.

### 8.1 What it is
- **Name.** Remount, the owner's word. One setup with two kinds of line, shown on the card: **MA remount** (the 50-day
  or 200-day, setup 13's detail) and **level remount** (a price level the stock had held). See question 1. [UCT; my
  proposal]
- **The line, one of:**
  - the **50-day SMA** or the **200-day SMA** [UCT: the owner's most common remounts; source consensus: IBD, MAU&R,
    ChartSchool];
  - a **horizontal level that held the stock up**: a breakout pivot, the low of a base, an old high, or a round number
    the stock had respected [UCT: "remount the $100 level", "remount that $245 level", "remount the ATH from Jan";
    originator: Morales and Kacher's U&R "prior low (price point)"; Wyckoff's range low; Livermore via Bonde];
  - the **20 EMA** only when the same close is also above a rising 50-day ("Holding the 50SMA and remounted the
    9/20EMA", WOLF, 2026-06-21) [UCT; UCT code: the Chart IQ event]. A 20 EMA remount with the 50-day lost too is an MA
    remount of the 50-day. [my proposal]
- **It lost the line for real.** At least **5 consecutive closes** under it right before the remount day, and at most
  **30**. Fewer than 5 is a U&R, Oops or pullback (setups 29, 30, 11, 12); more than 30 is a new base, taught under the
  base setups. [UCT code: `remount.py`, `draw:remount`; my proposal for the reason] The replay found no edge difference
  between 1 and 30 closes; this rule tells the setups apart, it does not add return.
- **The break left the line.** At least one of those closes **0.5 ATR or more** under it. [UCT code: `draw:remount`;
  judges' failure "brief losses"]
- **A level must be a real level (level remounts only).** It held before it broke: at least **10 of the 15 closes**
  before the break at or above it; and it is not a chop line: the close crossed it **2 times or fewer** in the 60
  sessions before the break. [UCT code: `draw:remount`; judges' failure "chop lines"; ChartSchool on sideways markets]
- **Location (hard).** The remount close is above the **200-day SMA**, and the 200-day is higher than it was 20
  sessions ago (the drawing's gate, `setup_gate`: a flat or falling 200-day is rejected). A 200-day remount is the cross itself; then the 200-day must be flat or rising. [house rule B26; UCT
  code: the drawing's gate; replay: +0.11R above against +0.01R below]
- **The remount day.** Closes above the line by **0.25 ATR or more** (not "a marginal poke") and **2 ATR or less** (not a
  chase); a green candle; the close in the **upper half** of the day's range. [UCT code: `draw:remount`, the vision
  rubric; owner: "a strong close"; my proposal for the candle] Replay: these define a clean picture; they did not change
  the mechanical result.
- **Volume.** Remount-day volume at least **1.2x** the 20-day average (the code); **1.5x or more** is an A-grade cue.
  Skip it when the break came on heavy volume and the remount on light volume. [UCT code; UCT: "big green volume bars";
  originator: IBD "your chance to sell"; Morales 2000] Replay: volume did not change the mechanical result; the rule is
  kept because every source that names volume wants it.
- **Liquidity.** $10 or more; $20 million or more traded a day; a position at most 1% of average daily volume. [house
  rule B23, D42]
- **Leadership.** RS 80 or more in a strong group by default. [house rule C31; originator: MAU&R "When a leading stock
  breaks below its moving average"] The owner also remounts beaten-down names; question 6.

### 8.2 The buy
One entry per trade (A5). Market orders (E57).
- **Entry B, the pause (the default).** After the remount day, wait up to **5 sessions**, every one closing above the
  line. The first **quiet day** (an inside day, or a range of 1 ATR or less) arms the buy: buy as price trades over that
  day's high the next session. [UCT: "Any sideways action or inside day can be looked at as opportunity.", "Now I want
  an inside day or red to green on a gap down.", "A little hourly tightness and higher low would allow for clean entry";
  originator: Wyckoff's test "makes a higher low on lesser volume"; ChartSchool "a breakout above the crossover candle";
  replay: median stop 2.0%, 78% within 3%, +0.09R]
- **Entry A, the remount day.** A market order late in the remount session, when the close will clearly be above the
  line. Use it only when its stop (8.3) is about 3% or less. [UCT: "Friday was an entry opportunity.", "Should be in on
  the 200SMA remount near $11.5." (setup 13); originator: MAU&R "a move back above the moving average can provide a long
  entry point"; replay: 53% of remount days had a stop within 3%]
- **Red to green (variant).** On a gap down after the remount that stays above the line, buy as price turns positive on
  the day; stop under that day's low. [UCT: INCY quote above; the house "Red to Green" setup]
- **Hourly (advanced).** The owner often times it on the hourly (a higher low or flag). Taught as a variant because daily
  drills cannot show it. [UCT: U, PLAB]
- **No chasing.** Skip a fill more than **4%** above the buy point: the line for Entry A, the quiet day's high for Entry
  B. [house rule C28; buy point is my proposal, question 7] Also skip a stock more than 10% over its 10-day average.
  [house rule C29]
- **Earnings.** No new buy in the 3 days before a report; a remount on the earnings gap itself is after the report.
  [house rule B22; UCT: BFLY in setup 13]

### 8.3 The stop
- **Entry B:** a few cents under the quiet day's low. **Entry A:** a few cents under the remount-day low. [house rule A3,
  F62; originator: Bonde "stop at low of entry day" for his momentum entries]
- **If that stop is more than about 3% away:** use Entry B, or size down so the account risk is unchanged, or skip. Never
  tighten a stop to fit. [house rule A3, A5, A13]
- **Not** the code's 1.5% under an older low: median 8.3% away in the replay, and worse per R.
- **Named variant, not the default:** the line itself, on a close (the owner's "ideally we use the 50SMA as a stop";
  MAU&R's "1-2% below the line"). See question 5. [UCT; originator]
- **Gap through the stop:** the first 30-minute low is the new stop; out past 2R. [house rule B20]

### 8.4 Trims and trail
- House defaults: a third at **3R**, a third at **5R**, the rest trailed and sold on a close under the **21-day** (an
  MA remount, steadier) or the **10-day** (a fast mover); stop to breakeven between 2R and 5R; take a trim at the open if
  it gaps past the level. [house rule B19, E51, E52, F63] The owner on ALAB: "peel of a partial position and trail the
  remaining up the 9ema and 20ema on the daily." [UCT]
- **Time stop:** still under 1R after 10 trading days, sell. [house rule C33] In the replay half the trades never reached
  1R; this rule frees the money.
- Expect most trades to lose: about 4 in 5 hit the first stop within 60 sessions in the replay. The few runners pay for
  them, so do not cut the runner early. [replay]

### 8.5 What invalidates it
- **Before the buy:** a close back under the line before the trigger (the drawing's `rm_lost_level`); the 200-day still
  falling or above price; light remount volume after a heavy break; a report within 3 days; a Red market. [UCT code;
  originator: IBD; house rules B22, B26, F65]
- **A failed first try:** the owner's DELL note ("Only to see them fail and would have resulted in stops") and the BTC
  note ("First failed attempt at remounting short term levels"). A second try is a new trade with its own trigger and
  stop (B21), at most 3 tries a week and 6 a month on one stock (E56). [UCT; house rules]
- **After the buy:** the stop. Whether a close back under the line before the stop is also an exit is the owner's call
  (question 5). [house rule A4]

### 8.6 The short mirror: the failed breakout back under a lost line
Shorts are our long setups reversed (D47) and only under the 200-day (B26). The mirror: a stock under a **falling
200-day** that had **gotten back above** a key line (the 50-day, or a breakdown level) for 5 to 30 closes, then **closes
back under it** on volume, in the lower half of its range. Short as price trades under that day's low (or under a quiet
day's low after it); stop a few cents over the day's high, about 3% or less; skip if hard to borrow (D48). [house rules D47, B26, D48; the 5 to 30 closes and the candle are my
proposal, mirroring 8.1]
- Sources: Livermore via Bonde, "A stock breaks out of range and then fails and goes down 3 point then it is short.";
  Morales, the 50-day failure "on volume, that’s your shorting point"; the Wyckoff tutorial, a breakdown "often tested
  with a rally that fails at or near support". [originator; source consensus]
- UCT: "I will gladly short stage 4 downtrends ap they reject the 200SMA from below." (owner, 2026-11-08; "ap" read as
  "as"). [UCT]
- Not replayed. Teach only if the owner wants shorts in this unit (question 10).

### 8.7 Best market conditions
- Market reading Green, or Yellow at smaller size; Orange only an A+ remount. [house rule F65]
- Best: after a correction, as the indexes remount their own lines and leaders remount first. UCT: "Wait for a remount of
  MAs, and wait for leaders to show leadership, get tight with good setups and relative strength." (Thoughts on the
  Market, 2025-11-19) Panics that end fast are fertile: "the panic sets in and selling accelerates just leads to quick
  remounts." [UCT]
- Weak: the index under its own 200-day ("Below the 200SMA is danger.", 2026-11-08). In the replay, remounts taken with
  SPY under its 200-day had wider stops (median 3.66%) and half the result (+0.04R against +0.08R). [UCT; replay]

### 8.8 Common mistakes
1. Buying a remount under a falling 200-day (B26; the replay's weakest group).
2. Calling a 1 to 4 day dip under the line a remount (it is a U&R or a pullback).
3. Buying before the close is above the line, or on a marginal poke a few cents over it.
4. Buying a "level" the stock chopped through for weeks (the judges' "chop lines").
5. Buying a light-volume drift back over a line the stock lost on heavy volume (IBD: a sell).
6. Using the code's stop under an older low (median 8.3%) at full size.
7. Chasing a remount day that closed far above the line (over 2 ATR, or more than 4% over the buy point).
8. Treating the first remount after a long fall as safe; first tries can fail (the DELL and BTC notes).
9. Cutting the runner early. Most trades lose small; the few big ones carry the setup.
10. Re-buying every failed remount the same week (E56: at most 3 tries a week).
11. Ignoring the market: remounts while the index is under its own 200-day.

---

## 9. Grading (observable cues, not a checklist; rule E50 says grading is his judgment)

The replay (section 4.4) found that none of the picture cues below changed the mechanical result on its own. They are
what the owner, the sources and our judges reward, and they are how the owner sizes (D38, E49). Treat them as his eye,
not as a proven edge.

**A+**
- A **leader** (RS 80 or more, a strong group) that lost the line during a market shakeout and remounted **before** the
  index did. [UCT: BE "Did nothing wrong while market corrected. Shakeout while the market bottomed and quick remount.";
  originator: MAU&R "a leading stock"; house C31]
- The line matters to many people: the **50-day or 200-day**, or a level the owner would name (a round number, an old
  high, a base low), and best when an average and a level sit together. [UCT: INCY "$100 psych level"; RBRK "the 50SMA"
  and "$100"; setup 13's DOCN note]
- The remount clears **all** the averages at once ("remounted all MAs"), above a **rising** 200-day. [UCT; house B26]
- A clear stay under the line (about 10 to 20 sessions) and a clean break away from it (0.5 ATR or more), on a line that
  held well before (no chop). [UCT code; the replay's best cut was the 50-day after 10 to 20 closes under]
- A wide green remount candle closing in the top third on **1.5x or more** the 20-day volume. [UCT: "big green volume
  bars", "Strong close on Friday"; IBD "a large boost of buying power"]
- Then a **quiet day** above the line (inside day or narrow range) that gives a stop of 3% or less. [UCT; house A13]
- Market Green, index above or remounting its own lines. [house F65; UCT]

**B- or lower**
- A remount under a falling 200-day, or of a line still "curling lower". [house B26; UCT: RDDT note in setup 13]
- A level the stock chopped through (3 or more crossings in 60 sessions), or a stay under the line of only a day or two.
  [UCT code; judges' failures "chop lines", "brief losses"]
- A marginal close (under 0.25 ATR over the line), a red or upper-wick candle, or volume under the 20-day average.
  [UCT code; judges' failure "marginal or light-volume reclaims"; IBD]
- A remount that leaves other lines overhead and falling (for example over the 20 EMA but still under a falling 50-day).
  [UCT: Launchpad ruling "I want it above the MAs"]
- A laggard group or a beaten-down name with no RS. [house C31; UCT: TAN "a major laggard" in setup 13]
- A stop wider than 3% that forces a much smaller size; a report within about two weeks. [house A13; two weeks is my
  proposal]
- A first attempt after a long decline ("First failed attempt at remounting short term levels"). [UCT]

---

## 10. Questions for the owner

1. **One setup or two?** (A) one "Remount" with two kinds of line, MA remount (setup 13's 50/200-day) and level remount;
   (B) keep "MA Reclaim" (setup 13) and "Remount" separate; (C) "Remount" for moving averages only, and the level version
   taught as a U&R variant. Recommend A: it is how you use the word (90 sentences on the Substack mix both kinds), and
   one name stops members meeting the same move under two names.
2. **Which lines count?** (A) 50-day, 200-day and levels, plus the 20 EMA only above a rising 50-day (section 8.1); (B)
   add the 20 EMA on its own (as `remount.py` does); (C) add AVWAPs (setup 19 covers them). Recommend A.
3. **How long under the line?** (A) 5 to 30 straight closes (`remount.py`, the drawing); (B) any number (the starter
   scan's one day); (C) 3 of the last 20 (`uct_ma_reclaim`). Recommend A. The replay found no edge difference; A is the
   cleanest border with U&R, Oops and the pullbacks.
4. **The entry.** (A) the remount-day close; (B) the pause, then over the quiet day's high; (C) B by default and A only
   when its stop is 3% or less. Recommend C. In the replay B gave the tightest stop for the same result, but it missed
   44% of remounts.
5. **The stop.** (A) a few cents under the day's low (remount day or quiet day; house default); (B) a close under the
   line (your RDDT and TMDX notes; MAU&R's 1-2% under the line); (C) the code's 1.5% under an older low. And is a close
   back under the line, above the stop, an extra exit? Recommend A, no extra exit (C33 handles the chop). C did worst in
   the replay.
6. **RS 80 (C31) for remounts.** (A) strict; (B) waived like mean reversion; (C) a lower bar (RS 70 or a rising RS line)
   for 200-day remounts only. Recommend A for the course, with C as your call for 200-day remounts of beaten-down names.
7. **C28's buy point.** (A) the line; (B) the trigger (the remount close, or the quiet day's high). Recommend the line
   for Entry A and the quiet day's high for Entry B. With the line as the buy point, 39% of pause entries in the replay
   filled more than 4% over it.
8. **Volume.** (A) 1.2x the 20-day (code); (B) the 50-day average (setup 13's tag check); (C) no rule. Recommend A as the
   floor and 1.5x as an A+ cue. The replay found volume neutral; the sources all want it.
9. **The code.** Recommend: rewrite `remount.py`'s narrative and docstring (drop the Bonde, Shannon and Raschke claims
   and the unsourced numbers), add the B26 gate, use the house entry and stop, and pick ONE remount rule to show members
   (today there are five). Options: (A) make `remount.py` follow section 8; (B) retire it and keep the drawing's rule
   (after a passed blind round); (C) leave the code and teach from hand-picked charts. The narratives need rewriting in
   every option.
10. **The short mirror.** Teach the failed breakout back under a lost line (section 8.6) in this unit? (A) yes; (B)
    later, with the other shorts. Recommend B: it is not replayed, and the Bear gap dossier records that you and Manrav
    warn newer traders off shorts.
11. **The morning REMOUNT list.** The Morning Wire's private scanner feeds "Remount" candidates. Should it be brought in
    line with whatever you rule here? Recommend yes; its rule is not reviewed in this public file.
12. **The word elsewhere.** The 20 EMA Pullback card says "the remount of the 9 EMA is the buy" and the EMA Crossback
    playbook says price "remounts both". (A) keep the word there as a plain verb; (B) reserve "Remount" for this setup.
    Recommend A, with the glossary defining the verb as *take back a lost line*, and this setup's name meaning a line
    lost for at least 5 sessions.

---

## 11. Sources (all read on 2026-11-09 unless marked)

| # | Source | Publisher / author | URL or path | Reliability note |
|---|---|---|---|---|
| 1 | "What is the Moving Average Undercut & Rally (MAU&R) pattern?", first published 2017-07-13 | Virtue of Selfish Investing (MoKa Investors, LLC); Gil Morales and Chris Kacher | https://www.virtueofselfishinvesting.com/faqs/answer/what-is-the-moving-average-undercut-rally-mau-r-pattern | High: the originators' own site. The closest outside definition of this setup. |
| 2 | "Gil Morales and Dr. Christian Kacher - Part II" (the page uses a long dash), 2000-01-08 | TradingMarkets Editors | https://tradingmarkets.com/recent/gil_morales_and_dr_christian_kacher__part_ii-669593 | High: originators' own words in an interview. Cached copy saved the same day (setup 13's session). |
| 3 | "Use The 50-Day Moving Average To Pinpoint Opportunity Or Risk", 2015-05-14 | Investor's Business Daily, via Yahoo Finance | https://finance.yahoo.com/news/50-day-moving-average-pinpoint-212000564.html | Medium: IBD's own article, read through a fetch tool (Yahoo refuses plain requests); quotes are the tool's copy. |
| 4 | "When A Low-Volume Rebound Follows Big Sell-Off, Take Gains", 2013-10-28 | Investor's Business Daily, via Yahoo Finance | https://finance.yahoo.com/news/low-volume-rebound-follows-big-183900666.html | Same as 3. |
| 5 | "The Wyckoff Method: A Tutorial" | StockCharts ChartSchool; Roman Bogomazov and Michael Lipsett | https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial | High for the Wyckoff school. Cached copy (setup 13's session, same day). |
| 6 | "Busted Rectangles" (updated 2020-12-29) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/BustRectangles.html | Medium-high for his data; fetch tool only (the site blocks plain downloads). **The site states it "shall not be used to train artificial intelligence (AI) systems"**; cited for research with short quotes. No sample size on the page. |
| 7 | "Busted Descending Triangles" (updated 2020-12-28) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/BustDescTriangles.html | As 6; sample "276 busted patterns found out of 650". Same AI notice. |
| 8 | "Busted Head-and-Shoulders Tops" (updated 2020-12-28) | thepatternsite.com; Thomas Bulkowski | https://www.thepatternsite.com/BustHST.html | As 6; no sample size on the page. Same AI notice. |
| 9 | "Jesse Livermore 3 point range breakdown failure setup", 2011-12-05 | Stockbee; Pradeep Bonde | https://stockbee.blogspot.com/2011/12/jesse-livermore-3-point-range-breakdown.html | High for Bonde's view; his account of Livermore, not Livermore's words. |
| 10 | "Stops and exit and a setup", 2019-03-14 | Stockbee; Pradeep Bonde | https://stockbee.blogspot.com/2019/03/stops-and-exit-and-setup.html | High: originator, on stops. |
| 11 | Stockbee blog searches: remount, remounted, reclaim, failed breakdown, undercut | Stockbee (Blogger) | https://stockbee.blogspot.com/search?q=remount (and the others) | Used to check our code's attribution. "No posts matching the query" for the first three. Blogger search can miss posts. |
| 12 | "Don't Buy the Dip, Buy Strength After the Dip™" | Alphatrends; Brian Shannon | https://alphatrends.net/dont-buy-the-dip-buy-strength-after-the-dip/ | High: originator, first person. Undated page. |
| 13 | "Anchored VWAP" | Alphatrends; Brian Shannon | https://alphatrends.net/anchored-vwap/ | High: originator. Undated page. |
| 14 | "Oliver Kell: 5 Screens to Find Stocks Like a Champion", last updated 2025-03-21 | Deepvue (no author named) | https://deepvue.com/screener/oliver-kell-screens/ | Medium: vendor education about Kell. Cached copy (setup 13's session). Kell's TraderLion pages refused this session (HTTP 403). |
| 15 | "How To Trade Price-to-Moving Average Crossovers" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/how-to-trade-price-to-moving-average-crossovers | High: established educator. Cached copy (setup 13's session). |
| 16 | "Stan Weinstein Stage Analysis: Identify The Best Time To Buy And Sell Stocks", last updated 2024-07-26 | Deepvue | https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/ | Medium: vendor education built with Weinstein. One quote. |
| 17 | "Just how Effective is the 200-day Moving Average?", 2019-02-23 | StockCharts; Arthur Hill, CMT | https://articles.stockcharts.com/article/articles-arthurhill-2019-02-just-how-effective-is-the-200-day-moving-average/ | Medium-high: a stated test, index only, no costs. Cached copy (setup 13's session). |
| 18 | Web searches for "remount" as a setup name (3 queries) | search engine | n/a | Found no outside use. The session's search budget then ran out; no further searches. |
| 19 | UCT Substack: all 103 posts in the sitemap (2025-06-01 to 2026-11-08), the sitemap re-read today | Uncharted Territory: Patrick (TSDR), Bracco, unsigned index notes | https://unchartedterritoryy.substack.com/sitemap.xml | House source. Full-text copies saved the same day for setup 13; quotes checked against them. One post subscriber-only. |
| 20 | Owner verdict log | UCT (owner) | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | House; the highest authority on how we trade it. No Remount ruling yet. |
| 21 | Account rulebook | UCT (owner) | `docs/study/sizing_rule.md` section 9 | House rules, settled 2026-11-09. |
| 22 | Detector, drawing and scan code | UCT app | `api/services/pattern_engine/detectors/uct/remount.py`, `uct_ma_reclaim.py`, `__init__.py`; `api/services/pattern_engine/setup_draw.py`; `api/services/pattern_engine/primitives/pivots.py`; `api/services/auto_structures.py` (release status); `api/routers/patterns.py`; `api/services/chart_iq/engine/v44_read.py`; `app/src/components/chart/engine/ast/starterScans.json`; `api/services/wisdom/capture/families/finviz.py`; `api/services/engine.py` | Read for section 5. Lab numbers are the code's own docstrings and comments. |
| 23 | Model Book, journal tags, Study, curriculum, vocabulary, rubric | UCT app and docs | `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`; `app/src/constants/setupGroups.js`; `docs/study/UNITS-method.md`, `UNITS-foundations.md`, `TRADE_PLANS.md`; `docs/curriculum/uct_method_chapters.json`, `curriculum_final_v2.json`; `docs/wisdom/vocabulary/setup-vocabulary-v1.json`; `docs/superpowers/research/setups/setup_criteria.json`; `api/services/pattern_vision/rubrics.py`; `docs/study/audits/2026-10-21/auditA_summary.md` | House. The brain template lines are quoted only as this repo already quotes them. |
| 24 | My replay | this dossier | scratchpad `setups/32-remount/scripts/replay.py`, `analyze.py`, `pause_entry.py`; workbench `bars.db` (read-only) | My computation, not a published statistic. Survivorship bias; no costs; limits in section 4.4. |
| 25 | Sibling dossiers | this folder | `13-ma-reclaim.md`, `15-wedge-pop.md`, `11-ema20-pullback.md`, `12-ma-pullbacks.md`, `07-launchpad.md`; `docs/study/levels/dossiers/bear_gap.md` | Used for boundaries and for quotes they already checked (named where used). |

**Searched for and not found or not readable:** any outside use of "remount" as a setup name; any Bonde text using the
word; Linda Raschke's Turtle Soup rules; Mark Minervini's own text on squats; Livermore's, Granville's and O'Neil's
books; Morales and Kacher's three Wiley books (not read; see 3.1); Kell's own TraderLion pages (HTTP 403);
Bulkowski's sample sizes for busted rectangles and head-and-shoulders tops. Nothing from these is quoted or used as a
rule.

---

## Changed in checking (2026-11-09)

Every quote in this file was re-found word for word at its source on 2026-11-09: the 14 outside pages in fresh live
downloads (VoSI, TradingMarkets twice, ChartSchool twice, Deepvue twice, Arthur Hill, Alphatrends twice, Stockbee's
two posts and its "remount" search, TradingView; the "remounted" and "reclaim" searches in the first pass's saved
copies of the same day), Bulkowski's three pages and the two IBD articles through the
fetch tool, all 44 UCT sentences in the re-downloaded Substack posts with the ticker heading above each one confirmed,
the four verdict-log rulings in `owner_verdicts.jsonl` (rows 39, 107, 228 and 555), and the house rules against
`sizing_rule.md` section 9. The code summary in section 5 was re-read line by line against `remount.py`,
`setup_draw.py` (including `setup_gate` and `_avg_vol`), `uct_ma_reclaim.py`'s docstring, `auto_structures.py`,
`patterns.py`, `starterScans.json`, `v44_read.py`, `setupCatalog.js`, `setupPlaybooks.js`, `setupGroups.js`,
`UNITS-method.md`, `uct_method_chapters.json`, `curriculum_final_v2.json`, `rubrics.py`, `setup_criteria.json`,
`setup-vocabulary-v1.json`, `ask_setup.py`, `finviz.py` and `engine.py`. Every replay number in section 4.4 and 6.7
was re-read from `analysis.txt` and recomputed from `pause.json`. What changed:

1. **Section 4.4, the data line.** "4,079 daily tickers" became a re-count: 4,284 distinct daily tickers in the local
   copy, 2,534 of which produced a qualifying day. "The workbench copy" became "a local read-only copy" (the file sits
   in a local data directory, not the Study workbench).
2. **The cold-check note at the top.** "Matched day for day against the app's own `remount.py` code" was an
   overstatement. Re-running the app's own `_enumerate_candidates` on AAPL, MSFT and NVDA for 2015 to 2026 gave 104
   qualifying days; the replay held 100 of them and none the app lacked. The replay is a near-subset of the app's
   rule; at 89,665 trades the four misses change no table.
3. **Section 2.** Added the two earlier uses of the word on the public Substack, both unsigned: 2025-06-03 ("BTC faked
   down and supported yesterday, trying to remount today.", the `stock-setups` post, published under the publication's
   byline with no section headings) and 2025-06-08 (GOOGL "as it remounts 200 day", the index section). The "first use
   in a post with a named writer" (2025-06-20) stands.
4. **Section 6, the count.** The writer's 90 sentences were re-counted at 90. By section, 50 (not 46) fall under the
   owner's headings when the "Charts Covered" lists after his section are counted as his, as the writer's own rule
   says; 1 (not 5) falls elsewhere. By keyword, 68 name a moving average (the writer wrote "about 67"), 10 a level (the
   writer wrote "at least 9"), 1 AVWAPs, 11 nothing. Both counts are heuristics over headings and keywords; the
   hand-checked level quotes in 6.1 are unchanged.
5. **Section 3.1.** Added that the VoSI FAQ names no book, that Morales and Kacher's three Wiley books (2010, 2012,
   2015) exist but were not read, and the page's own "First published / Last updated: 13 Jul 2017" lines.
6. **Section 5.5.** The Chart IQ "MA remount" event's 200-day test is skipped when the chart has no 200-day value yet
   (`not s200 or x['c'] > s200`); the summary now says so.
7. **Section 8.1, Location.** "Not lower than it was 20 sessions ago" became "higher than it was 20 sessions ago", which
   is what the drawing's `setup_gate` tests (`s <= s0` is rejected as `falling_200d`).
8. **Section 11.** Morales and Kacher's books added to the "not read" list; the web-search row in section 2 notes the
   second checker's two further searches (they found the same TradingView post and nothing else using the word as a
   setup name).

Confirmed without change, for the record: Bulkowski's percentages (51/66/71 and "49%" for rectangles; 42/71/54 and
"276 busted patterns found out of 650" for descending triangles; 32/67/67 and "35%" for head-and-shoulders tops), his
update dates (12/29/2020; 12/28/2020 twice), the single-bust rule's four points, the AI-use notice; IBD's two sentences
and dates (2015-05-14, 2013-10-28); the Kunal Desai post (2025-05-30, titled "HIMS 20SMA Trend Contiuation PULLBACK
SETUP for NASDAQ:PLTR by kunal00"); the Stockbee blog's "No posts matching the query" for all three words; every
`remount.py` constant, gate, score weight and level formula in 5.1 (the lowest reachable confidence is 42.4, as the
writer computed); every `draw:remount` constant in 5.2 and the round-3 and recertification numbers in 4.3; the
`uct_ma_reclaim` lab numbers; the 13 candidate rows in 6.7; the pause-entry numbers (24,881 of 44,755; median risk
1.99%; 78% within 3%; +0.091 R, se 0.014; median fill 3 sessions after the remount day and 3.2% over the line, 39% more
than 4% over it).

## Removed in checking

Nothing. Every quote, number, date and attribution in the file was found at its source. The two statements that were
wrong (the ticker count and the "day for day" claim) were corrected in place and are listed above, not removed.

## 12. Examples (from our data)

Scanned 2026-11-09 on the local read-only copy of the daily bars (2,630 names that ever met the house liquidity rule,
2000 to 2026, every name covered; the scan took under 5 minutes). Scripts: `scan_remount.py` and `chart_remount.py` in
the setup's scratch folder; hits in `final/hits.json`, the 10 charts and the three phone sheets in `final/`.

**The rule, as scanned (section 8's MA remount plus the house rules).** The line is the 50-day or the 200-day SMA. The
stock closed under the line for 5 to 30 consecutive sessions, and at least one of those closes was 0.5 ATR(14) or more
under it. The remount day closes above the line by 0.25 to 2 ATR, is a green candle closing in the upper half of its
range, on volume at least 1.2x the prior 20-day average; the stock is above a 200-day that is higher than 20 sessions
ago (a 200-day remount: flat or rising), closes at $10 or more, and has traded $20 million or more a day over 50 days.
**Entry B (the default):** within the next 5 sessions, every one closing above the line, the first quiet day (an inside
day, or a range of 1 ATR or less) arms the buy; the trade is a market order the next session as price trades over that
day's high (fill = the higher of the quiet day's high plus a cent and the open), skipped if the fill is more than 4%
over the quiet day's high (C28) or more than 10% over the 10-day average (C29). Stop: 5 cents under the quiet day's
low, up to 4% away (the rule's "about 3%", with a little room). **Entry A (recorded for comparison only):** the
remount-day close, stop 5 cents under the remount-day low, only when that stop is 3% or less. One remount per 10
sessions per line; the forward walk is 60 sessions, a fixed stop, no trims, no trail, no breakeven, and the first of
stop / 3R / 5R wins (both on one day counts as the stop). Not scanned: level remounts, 20 EMA remounts, the hourly and
red-to-green variants, the short mirror, RS 80+, the market reading, and the earnings blackout (B22); all of those are
in section 8 but need data the daily scan does not have, or were left out to keep the picture simple.

**Base rate (fixed stop, no trims, 60 sessions).**

| entry | hits | reached 3R | reached 5R | stopped within 60 sessions | median best R |
|---|---|---|---|---|---|
| B, the pause (default) | 3,869 | 29.6% | 21.1% | 81.9% | 1.06 |
| A, the remount day | 4,821 | 29.8% | 19.7% | 79.9% | 1.08 |
| both, 50-day line | 6,162 | 30.3% | 21.0% | 80.7% | 1.09 |
| both, 200-day line | 2,528 | 28.3% | 18.6% | 80.9% | 0.98 |
| all | 8,690 | 29.7% | 20.3% | 80.8% | 1.06 |

Caveats. It is a fixed stop with no trims, so "stopped" includes trades that ran to 2R and came back; with the house
trims (a third at 3R, a third at 5R, breakeven at 2R to 5R) the picture is better than the stopped share suggests.
About half of Entry B trades (49%) never reached 1R, which is the dossier's case for the 10-day time stop (C33). Among
the sub-rules, none moved the mechanical result much: remount volume 1.5x+ against under 1.5x gave 30.1% against 29.4%
to 3R; an inside quiet day against a 1-ATR quiet day gave 22.0% against 20.7% to 5R; stops of 2% or less reached 5R a
little more often (21.9% against 18.5%) because the R unit is smaller. 439 remount days qualified under both lines at
once (the stock remounted the 50 and the 200 on the same day) and are counted under each. Prices are split-adjusted, so
the $10 rule is approximate for older years (SLAB 2021 and NKE 2020 are unadjusted-era names; NFLX-type names show as
tenths of their then-quoted price). ETFs are in the universe and in the base rate (IAU and ITB were among the top hits by
R) but were excluded from the examples. These are my computations on one data copy, not a published statistic.

**The 10 examples** (all Entry B, all 5R or better, one per ticker, 2010 to 2025; "run" = consecutive closes under the
line before the remount day, "depth" = the deepest close under the line in ATR, "vol" = remount-day volume against the
20-day average; best R is the highest high within 60 sessions against the fixed stop).

| # | ticker | remount day | buy day | line | run | depth | vol | buy point | entry | stop | stop % | best R | why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | MAR | 2010-03-05 | 2010-03-09 | 50 | 27 | 3.0 ATR | 1.35x | 26.35 | 26.36 | 25.93 | 1.6% | 22.3 | A long, shallow loss of the 50-day under a rising 200-day; the remount, an inside quiet day, the buy over it, then a straight run to new highs. |
| 2 | MGM | 2013-12-06 | 2013-12-13 | 50 | 25 | 3.1 ATR | 1.53x | 20.94 | 20.95 | 20.55 | 1.9% | 19.5 | 25 closes under the 50 in an uptrend, then a green remount on 1.5x volume; five sessions of holding above before an inside day gave the trigger; 3R in 2 days. |
| 3 | STLD | 2016-10-19 | 2016-10-26 | 50 | 14 | 1.9 ATR | 2.34x | 26.49 | 26.56 | 25.91 | 2.4% | 20.9 | High-volume (2.3x) remount; the quiet day is 2016-10-25, which our earnings table lists as a report date, so the buy came after the report (B22 as written). The post-election steel run did the rest. |
| 4 | WB | 2017-04-20 | 2017-04-25 | 50 | 11 | 1.1 ATR | 1.69x | 54.30 | 54.31 | 53.37 | 1.7% | 29.8 | A leader's clean remount; 3R in 2 days before its May earnings gap added the rest. Our earnings table has no dates for WB, so the report timing is not confirmed from our data. |
| 5 | NKE | 2020-08-05 | 2020-08-07 | 50 | 7 | 1.0 ATR | 1.37x | 101.18 | 101.19 | 99.98 | 1.2% | 25.0 | A 7-day dip under the 50 after the 2020 recovery; a strong remount close (+1.3 ATR), an inside day, the buy, 3R the next day. The cleanest small-stop example. |
| 6 | UTHR | 2020-10-13 | 2020-10-15 | 200 | 5 | 0.7 ATR | 1.54x | 110.66 | 110.67 | 108.11 | 2.3% | 23.6 | A 200-day remount at the minimum 5 closes below; the 200-day flat-to-rising, the 50-day above the 200; quiet day, buy, 3R in 3 days. |
| 7 | SLAB | 2021-10-19 | 2021-10-21 | 50 | 30 | 4.2 ATR | 1.32x | 150.50 | 150.51 | 149.08 | 1.0% | 43.0 | The maximum 30 closes below and the deepest break in the set (4.2 ATR); the remount close is the smallest allowed (+0.27 ATR) and the stop 1.0%, which is why the R count is so high; 3R came in 3 days, before the 2021-10-27 report (our table) gapped it further. |
| 8 | AMD | 2023-11-01 | 2023-11-03 | 50 | 11 | 2.4 ATR | 2.60x | 109.41 | 109.42 | 105.86 | 3.3% | 21.2 | The remount day is the earnings reaction day (report 2023-10-31 after the close in our table): a 2.6x-volume remount of the 50 after 11 closes below, under a rising 200; the stop is the widest of the ten at 3.3%. |
| 9 | SCCO | 2024-03-07 | 2024-03-11 | 50 | 9 | 1.8 ATR | 1.72x | 80.07 | 80.08 | 78.49 | 2.0% | 25.2 | A copper leader: 9 closes under the 50, a +1.1 ATR remount close on 1.7x volume, a 1-ATR quiet day, the buy, 3R in 2 days and a 60-session trend. |
| 10 | BABA | 2025-01-17 | 2025-01-24 | 200 | 6 | 2.2 ATR | 1.80x | 86.20 | 86.71 | 84.91 | 2.1% | 34.3 | A 200-day remount after 6 closes below; the quiet day was 2025-01-23 and the fill 0.6% over its high; 3R in 2 days; the move ended in April, which the 21-day trail (E52) would have caught. |

Earnings check (the earnings table, Yahoo plus SEC 8-K): MAR, MGM, NKE, UTHR, SCCO and BABA had no report between the
remount day and the day 3R was reached; STLD, SLAB and AMD are noted in the table; WB has no dates on file. CAVA
2024-08-13 (50-day, 17 closes below, 2.0x volume, best 20.8R), ASML 2020-11-06, ETSY 2018-02-16, LULU 2010-03-04 and
ILMN 2020-12-03 (a 200-day remount after 26 closes below) were drawn and are as good; they were left out for one
example per year where possible.

**Notable failures (Entry B, stopped at 0R).**
- **AMZN, remount 2021-10-15, buy 2021-10-20.** A textbook-looking remount of both the 50 and the 200 on the same day on
  1.8x volume after 14 closes below, stop 1.0% under a tight quiet day. Stopped within days with nothing gained, and the
  stock rolled over into its 2022 decline. The picture was right; the market and the group were not (the dossier's
  "ignoring the market" mistake), and a 1% stop on a mega-cap leaves no room.
- **PYPL, remount 2018-10-19, buy 2018-10-23.** A 200-day remount on 2.98x volume (the earnings reaction, 2018-10-18
  after the close in our table) in the middle of the October 2018 correction, stop 3.2%. Stopped at once as the index
  made new lows; the stock chopped around its 200-day for months. The heavy-volume remount did not help with the index
  under its own 200-day (section 8.7).
- **BA, remount 2019-06-18, buy 2019-06-21.** 29 closes under the 200-day after the 737 MAX gap, then a 2.7x-volume
  remount day. Stopped in a week; the line was retaken and lost again twice more that summer. A 200-day that is flat
  (it just passed the "not lower than 20 sessions ago" test) after a news-driven break is the weakest version of the
  setup.
Other names in the same list: DIS 2020-02-05 (200-day remount two weeks before the 2020 crash), MSFT and NVDA both
on 2020-11-06 (a 5-day dip and remount that failed in the sector rotation), DOCU 2024-03-14 (24 closes below, 2.0x
volume, stopped).

## 13. Failures and near-misses (from our data)

Built 2026-11-10 from the section 12 scan (`final/hits.json`, Entry B only), for the spot, discriminate and grade
questions and the method plan's rule that every setup unit ships with a correctly traded loss. Charts in the scratch
folder's `final/`: `fail_1-4.png`, `near_1-4.png`, and the confusable pair `pair_29-undercut-rally.png` (the MAR
2010-03-09 winner above the U&R's NTAP 2004-10-27 winner, each captioned with the card's tell: count the closes under
the line). Every number is read off the bars. Each failure passed every gate of the card (5 to 30 closes under the
50-day or 200-day, a break of 0.5 ATR or more, a green remount day closing in its upper half 0.25 to 2 ATR over the
line on 1.2x volume or more, above a 200-day not lower than 20 sessions ago, a quiet day within 5 sessions, a fill no
more than 4% over its high, a stop under the quiet day's low within 3.3%) and the earnings table shows no report
reaction day from the session before the buy to 3 sessions after it. The four are the dossier's own named failures
(AMZN, PYPL, BA) plus DOCU from its list.

**Four failures, traded by the rules** (one per name, four different years):

| Ticker | Remount / buy | Line and break | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| AMZN | 2021-10-15 / 2021-10-20 | 50-day, 14 closes under, break 3.08 ATR, close +0.95 ATR, vol 1.77x | 172.74 | 171.05 (1.0%) | day 1, 2021-10-21, a gap under the stop, best +0.0R | A remount of the 50-day and the 200-day on the same day on 1.77x volume after 14 closes under; the quiet day was so tight that the stop sat 1.0% under the buy, and the next session gapped under it. SPY was above its 200-day. Only 4 of the next 20 closes went back under the line and the 3R level printed 12 sessions later without us. | none (a 1.0% stop on a mega-cap left no room; rm.stop_width sets a ceiling, not a floor) |
| PYPL | 2018-10-19 / 2018-10-23 | 200-day, 9 closes under, break 2.02 ATR, close +0.71 ATR, vol 2.98x | 86.24 | 83.52 (3.2%) | day 1, 2018-10-24, best +0.0R | A 200-day remount on 2.98x volume (the earnings reaction) in the October 2018 correction, with SPY under its own 200-day on the buy day; stopped the next session and never traded above the fill, the low 20 sessions later 12.5% under the buy. The 3.2% stop is at the edge of the 'about 3%' rule. | rm.index_remounting |
| BA | 2019-06-18 / 2019-06-21 | 200-day, 29 closes under, break 3.12 ATR, close +1.21 ATR, vol 2.69x | 375.80 | 368.91 (1.8%) | day 2, 2019-06-25, best +0.0R | 29 closes under the 200-day after the 737 MAX gap, then a 2.69x-volume remount; stopped on day 2 and 13 of the next 20 closes were back under the 200-day. The 200-day had just passed the 'not lower than 20 sessions ago' test; a flat line after a news break is the weakest version. | rm.ma200_rising (passed, barely) |
| DOCU | 2024-03-11 / 2024-03-14 | 50-day, 24 closes under, break 3.74 ATR, close +0.97 ATR, vol 2.0x | 59.54 | 58.44 (1.8%) | day 1, 2024-03-15, a gap under the stop, best +0.0R | A textbook picture: 24 closes under the 50-day, a 3.74 ATR break, a 2.0x-volume remount day, an inside quiet day; then a gap under the stop the morning after the buy. It held the 50-day for the next 20 sessions (0 closes under) and traded up to 61.47 (+1.75R) inside the window without reaching 3R. The level was right; the trigger did not run. | none (rm.after_entry_stop) |

**Four near-misses, each failing exactly one gate** (the scan re-run with that one gate relaxed):

| Ticker | Remount / buy | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| ENOV | 2019-10-11 / 2019-10-15 | rm.time_under | 3 closes under the 50-day before the remount day; the rule wants 5 to 30 | A three-day dip under the 50-day and straight back: a pullback or a U&R (setup 29), not a Remount; the line was never really lost. It reached 20.7R, which is the trend, and the point of the gate is to name the setup correctly, not to skip the trade. |
| EOG | 2011-07-21 / 2011-07-25 | rm.volume | remount-day volume 0.81x the 20-day average; the rule wants 1.2x or more | The line was taken back on 0.81x volume after 28 closes under: a remount nobody showed up for. Stopped at 0R, and the slide that followed is on the chart. |
| ESS | 2014-10-14 / 2014-10-22 | rm.remount_day_margin | remount-day close +0.08 ATR over the line; the rule wants 0.25 to 2 | A marginal poke: the remount day closed 0.08 ATR over the 50-day, inside the noise, so the close could not be called a remount that evening. The next sessions remounted it clearly and it reached 14.9R; the lesson is to wait for the clear close. |
| EHC | 2019-09-06 / 2019-09-10 | rm.ma200_rising | the 200-day SMA 0.83 lower than 20 sessions ago; the rule wants it higher | A 50-day remount under a falling 200-day (0.83 lower than 20 sessions ago): the drawing rejects it. It reached 0.9R and stopped. |

Also in `near/` and not charted: `rm.break_left_line` (the deepest close under the line under 0.5 ATR, 9 hits in 900
names: a shallow loss of the line that the rule reads as a pullback) and `rm.remount_day_candle`.

**What the failures have in common.** All four were stopped within two sessions of the buy, two of them by a gap
under the stop at the open: the pause entry's stop is tight (1.0% to 3.2%) because the quiet day is tight, and a
tight stop is taken by ordinary noise. Three of the four later held or retook the line (AMZN printed the 3R level 12
sessions on, DOCU held the 50-day for the next 20 sessions, BA chopped around the 200-day); only PYPL, bought with the
index under its own 200-day, kept falling. Heavy remount volume did not help (2.0x to 2.98x in three of the four),
which repeats section 12's cut. The picture the four give the course is the dossier's expected-losses rule
(`rm.expect_losses`): about four in five remounts hit the first stop, the stop is the whole cost, and a second try
after a failed first try is a new trade with its own trigger and stop (`rm.failed_first_try`).
