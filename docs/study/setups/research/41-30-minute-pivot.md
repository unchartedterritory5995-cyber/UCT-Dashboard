# Setup 41: 30-Minute Pivot (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
post or file named next to it and kept to 40 words or fewer. Nothing here is a ruling. Where I could not read a source,
I say so and give no wording from it.

**Cold check, 2026-11-09 (a second agent).** Every quote below was re-opened at its source (the eight X posts through the
FxTwitter API, every cited Substack post through the public post API plus a sweep of all 103 posts on the sitemap, the
Pivot Party, TradingView, Qullamaggie, ChartSchool and Investopedia pages, the Raschke PDF, the three YouTube watch pages,
the two chart images), the knowledge-base note ids were pulled from the files, the scanner summary was read against the
code, and the five named examples and the replay table were recomputed from the shared bars and the saved event files.
What changed is listed under "Removed in checking" at the end; corrections in the body are marked **[checked]**.

Tags used in section 8: **[source consensus]** several sources agree; **[originator]** the trader who named the setup,
in his own words; **[UCT]** UCT's own writers, the owner's verdict log or UCT's own code; **[house rule]** the account
rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Words used below. **30-minute candle**: one bar of a 30-minute chart (9:30, 10:00, ... 15:30 ET). **Red string**: two or
more red 30-minute candles in a row (close under open). **Pivot candle**: the first green 30-minute candle after the
red string. **Trigger**: a later candle trades above the pivot candle's high. **R**: the risk on the trade (entry minus
stop). **LOD**: low of the day. **TSDR**: the owner, Patrick (his own Substack sections). **1ChartMaster**: the X handle
of the trader who calls himself "Elite Swing Traders" and who joined UCT as a trader, coach and admin in 2025.

**The short version.**
- **The setup has a named originator, and he is part of UCT.** 1ChartMaster (Elite Swing Traders on X) wrote on
  2025-04-09: "I developed this strategy on my own and I am damn proud of it." His earliest post I found that names it is
  2025-03-11. UCT interviewed him on 2025-07-11 and announced on 2025-08-03 that he had joined "as a trader, coach, and
  admin". Two UCT workshop videos are devoted to it and three more carry it in their house summaries (section 5.6)
  **[checked]**. Neither the writer nor the checker found an earlier use of the name (section 2); the earliest
  third-party uses are TradingView scripts from 2025-07-29 on, and one of them (2026-10) credits "@1ChartMaster (Elite
  Swing Trading)" by name (section 3.5). The mechanics are older.
- **What it is, in his words and in the owner's trades, is a turn on the 30-minute chart at support, not the first
  half hour's high.** A leader pulls back in a "string of red 30-minute candles"; the trader waits for the "pivot", the
  point where the 30-minute chart turns back up, near support such as a short-term moving average; the stop goes "just
  below the recent 30 minute low". On HOOD (2026-08-31) his chart shows the stop 4 cents under the low of the first green
  30-minute candle and his entry ("My price 102.99") just over that candle's high.
- **The owner trades it exactly that way.** His public examples are all turns at the daily 20-day EMA or a key
  level, for example: DELL "at 527 and a 520 stop" (2026-10-01), LITE "at the 20EMA shake and 30 Minute Pivot at $895" (2026-09-28 by
  my reading), TEAM "Clean $30 min pivot at $172", GLW "the 30 min pivot off the 20EMA". I checked DELL on real bars: the
  stop sat 18 cents under the low of the 10:00 candle, which made the day's low after an undercut of the 20-day EMA, and
  the trade was 5R by the next morning, as he wrote.
- **Our app teaches a different thing under the same name.** The Model Book card, the course script, the chart-builder
  note and `definitions.json` all define the 30-Minute Pivot as the first half hour's high, with price consolidating under
  it. That is a 30-minute opening-range break (setup 40), not 1ChartMaster's pivot, and it does not match a single one of
  the owner's or the originator's examples. On DELL the first half hour's high was 543.15; the owner bought at 527.
- **No published statistics exist for the pivot.** My own replay on 49 sessions of real 30-minute bars (section 4.4) found
  that a purely mechanical version (red string, first green candle, break of its high) has no clear edge on its own, and
  my simple near-a-daily-average filter did not add one. A longer red string did help, and the card's first-half-hour
  version lost money. So the value, if any, sits in
  the judgment UCT's people describe (leaders, real levels, a shake), which only a labelled set of the owner's own trades
  can measure.
- **It fits the house rules well.** Stops are tight (1.2% to 2.1% on the named examples), so A13 is easy, and the house
  trims at 3R and 5R come quickly. The tight stop makes the position cap (A7, 40%) the real limit on size.

---

## 1. What it is

**In two sentences.** A strong stock (a leader in an uptrend) pulls back on the 30-minute chart with a run of red
candles into a level that matters on the daily chart, usually a rising short-term moving average; the first green
30-minute candle there is the pivot. You buy when a later candle takes out that pivot candle's high, with the stop just
under its low, which gives a tight, defined risk for a swing trade.

**Why it works (the psychology).**
- **The buyer is waiting for the dip.** A leader that is "holding up better than the broad market" (1ChartMaster's
  words) has buyers who missed it. A pullback into the 10 or 20-day average is where many of them want in. The red
  string is short-term holders taking profits; the green candle at the level is the first evidence that the waiting
  buyers are absorbing that selling.
- **The trigger is proof, not hope.** 1ChartMaster: "Rather than buying as the stock is falling, the trader waits for a
  "pivot"". Buying the break of the green candle's high means someone was willing to pay more than the turn candle's high
  after the sellers had their chance.
- **Who is trapped.** Traders who sold or shorted the red string into support, and short-term traders stopped out on an
  undercut of the daily average (the owner's "20EMA shake"). When the stock turns back up through the pivot high, they
  have to buy back. The owner's own words for the shape he likes: "the 20EMA shake and 30 Minute Pivot".
- **The 30-minute chart is a magnifying glass on one daily candle.** The daily chart shows only a lower wick at the
  average. The 30-minute chart shows where inside that day the selling stopped, which is what makes the stop tight. The
  owner wrote (2025-06-29) that he uses intraday charts "for spotting key pivots and levels that the daily chart might
  mask" (hourly/65-minute in that post).
- **Why 30 minutes and not 5.** 1ChartMaster says he built it for volatile markets: "during periods of volatility it can
  pretty hard to hold a position." A 30-minute candle filters the noise of 1 and 5-minute bars while still giving a stop
  far tighter than the daily low. (This is his stated reason; no one has tested 30 against other bar lengths for this
  setup.)

---

## 2. Origin and naming

**Who named it.** 1ChartMaster, the X account "Elite Swing Traders" (@1ChartMaster; profile: "Just a fisherman that can
read charts pretty good", South Florida; account opened 2021-05-20). His own claims:
- 2025-03-11: "I find during periods of volatility it can pretty hard to hold a position. That's why I developed my 30
  min pivot strategy." ([post](https://x.com/1ChartMaster/status/1899546078191710598))
- 2025-04-09: "My 30 min pivot Strategy has been showing out this week. I developed this strategy on my own and I am damn
  proud of it." ([post](https://x.com/1ChartMaster/status/1910119670524367149))

I found no use of the phrase "30 minute pivot" as a setup name before March 2025. My web search for this setup was cut
short (the session's shared search budget ran out after three searches), so an earlier use could exist that I did not
see. I make no claim that he was first in the world, only that he says he developed it and I found no one earlier.
**[checked]** The checker's own web search (2026-11-09) also found no earlier use as a setup name: every hit was a
TradingView script published after his posts (2025-07-29, 2025-09-10, 2026-10-11; section 3.5), a floor-trader pivot
system on 30-minute bars (the homonym, section 3.8) or a forex system. The 2026-10-11 script credits him by name.

**How it reached UCT (dates from UCT's public Substack and YouTube page data).**
- 2025-07-11: Substack post "Interview with @1ChartMaster", subtitle "Discussion with Elite Swing Traders". The embedded
  YouTube interview (UCT's channel, 50 minutes) has an auto-chapter "The 30-minute pivot strategy" at 13:33. I could not
  read a transcript (YouTube refused the caption request), so I give nothing from what he said there.
- 2025-08-03, Sunday Scans intro (unsigned): "“EliteSwingTrader”, “1ChartMaster” joined our group as a trader, coach,
  and admin."
- 2025-09-11 and 2025-09-17: two member workshop videos, "Q & A With 1ChartMaster" and "30 Minute Pivot Workshop with
  1ChartMaster" (in the Desk video library, `api/services/education_seed.py`). No transcript was available to me.
  **[checked]** Three later workshops with him carry the pivot in their library summaries: "ETF Scanning, Groups and
  Lists" (2026-01-26), "Relative Strength and Weakness" (2026-02-09) and "Range Trading" (2026-02-26); section 5.6.
- 2025-09-14, Sunday Scans intro (unsigned), a caption under a member's results: "The 30 Min Pivot doing wonders".
- From 2026-06 the owner uses the name in his own Substack sections for his own trades (section 6).

**The mechanics are older than the name.** Buying the break of a bar's high after a pullback touches a rising average,
with the stop at the new swing low, is Linda Raschke's Holy Grail entry (section 3.7; her examples are daily charts). Kristjan
Kullamägi's entry for a parabolic long includes "the first green 5-minute candle". What 1ChartMaster added is the
package: the 30-minute bar, the "string of red", the leader filter and the name.

**Other names it goes by.**
- "30 min pivot", "30-min pivot", "30 Minute Pivot" (his posts and the owner's).
- "30min Pivot" (the app's journal tag) and "30-Minute Pivot" (the Model Book card).
- "pivot strategy" (the owner's desk log, 2025-08-04, about a member's pivot strategy on APLD; summary in the repo's
  knowledge base, KB 10154).
- "30-Min Pivot Party" (an unrelated third-party site that describes the same rule, section 3.4).
- "Elite 30 Min Pivot" (a TradingView script by TenAM Trader, 2025) and "30 Min Pivot Pullback Strategy" (a TradingView
  script that credits 1ChartMaster, 2026), section 3.5 **[checked]**.
- **Not the same thing:** floor-trader "pivot points" (a formula from the prior period's high, low and close; section
  3.8), the CANSLIM/Minervini "pivot point" (a base's buy point, setups 1 to 6) and the Episodic Pivot (setup 20). The
  word "pivot" in "30-minute pivot" means a turning point on the 30-minute chart.

---

## 3. Every definition I could find, source by source

### 3.1 1ChartMaster (originator; his own posts on X)

X blocks the fetch tool (HTTP 402), so I read his posts through the public FxTwitter API (api.fxtwitter.com), which
returns the post text exactly as posted. The links below are the posts themselves. Dates are UTC.

- **The long description, 2026-05-10** ([post](https://x.com/1ChartMaster/status/2053625926181593509)). It is written in
  the third person ("used by Elite Swing Traders (@1ChartMaster)") with headings like "Core Components" and "Key
  Takeaway". It reads like a generated summary that he posted on his own account. I treat it as his endorsed description,
  but the owner should know it may not be his own typing.
  - Purpose: "a tactical entry method designed to help traders buy high momentum stocks at defined support levels while
    minimizing the risk of "chasing" a move."
  - Leaders: "The strategy focuses on "RS names" stocks that are holding up better than the broad market."
  - Prior trend and pullback: "A key signal for this entry is seeing a string of red 30-minute candles in a stock that is
    otherwise in a strong uptrend."
  - Trigger: "Rather than buying as the stock is falling, the trader waits for a "pivot" a specific point where the
    downward momentum on the 30minute chart shifts back to the upside."
  - Stop: "By entering at the 30 minute pivot, you have a defined spot for a stop loss, usually just below the recent 30
    minute low."
  - Location: "It seeks to buy the "dip" in a leading stock, often near short term support levels like the 8 EMA or the
    8 wee EMA" (his typo; the 8-week EMA).
  - Best candidates: "When a High Tight Flag (HTF) or a high momentum name pulls back, the 30minute pivot often provides
    a low risk entry into the next explosive leg higher."
  - Who it suits: "It is particularly effective for traders prone to FOMO (Fear Of Missing Out)."
- **Holding period, 2025-03-11**: "Keeping the trades relatively short but sweet due to the volatility."
  ([post](https://x.com/1ChartMaster/status/1899546078191710598))
- **Patience, 2025-04-21**: "My 30 min pivot strategy continues to be my goto trade in this volatility. Patience is key
  waiting for the right time to strike. Learn to be a sniper." ([post](https://x.com/1ChartMaster/status/1914422562051834358))
- **No guarantee, 2025-05-30**: "Nothing is a 💯 guaranteed but I find it pretty damn useful in my trading these days."
  ([post](https://x.com/1ChartMaster/status/1928599320082649126))
- **A worked trade, HOOD, 2026-09-03**: "I buy weakness after strength and use the 30 min pivot to make it happen. Here's
  another example with the trade now over 10R. My price 102.99" ([post](https://x.com/1ChartMaster/status/2095562525752406106)).
  His attached 30-minute chart (I viewed it) marks an entry line at 102.94, a stop line at 101.16, a risk label of
  "-1.78 (-1.73%)" and a gain label of "20.30 (19.73%)" (the checker viewed the image again: all four labels are
  there, and the chart's own day low reads 100.68). On the real bars (section 4.3): HOOD fell from its 2026-08-27 high
  through a run of mostly red 30-minute candles on 2026-08-28 **[checked: 08-27 itself was mixed]**; on 2026-08-31 the
  9:30 and 10:00 candles were red (low 100.69), the 10:30
  candle was the first green one (high 102.67, low 101.20), and the 11:00 candle took out its high. His stop, 101.16, is
  4 cents under that green candle's low, **not** under the day's low (100.69). The daily 20-day EMA (about 101.4) and
  50-day SMA (about 101.3) were right there.
- **His go-to, 2026-09-27**: "30-min pivot is my goto for tight risk in leading names."
  ([post](https://x.com/1ChartMaster/status/2104186021789499588))
- **HNGE, 2025-08-06**: "$HNGE 30 min pivot to the house. New ATHs" ([post](https://x.com/1ChartMaster/status/1953110205866164700)).
  His attached 30-minute chart (I viewed it) shows a pullback of red candles on 2025-08-05 into rising short moving
  averages, green candles turning up off the low, then a gap and run to new highs on 2025-08-06. I have no bars to check
  the levels. **[checked]** The chart also carries TradingView's "E" (earnings) marker at the 2025-08-05 close, so the
  08-06 gap looks like an earnings gap; the pivot itself formed the afternoon before the report.
- **Not verified, so not quoted.** A search-engine summary attributed to a 2025-09-05 $TEM post a step-by-step rule
  (wait for the first green 30-minute candle; the trigger is the next candle taking out its high; the stop under that
  green candle's low). I could not open that post and do not have its link, so I give no wording from it. It agrees with
  the HOOD chart. A 2026-09-30 post of his about risk is behind a subscription and I could not read it.

**What he leaves open.** No minimum number of red candles, no volume rule, no exact distance to the moving average, no
rule for which session the trigger must come in, no profit target beyond "short but sweet" (2025) and "over 10R" (2026).

### 3.2 The owner, TSDR (his Substack sections and his verdict log)

All quotes are from "TSDR’s Weekly Outlook & Watchlist" sections of the Sunday Scans, which he signs.
- **GLW, 2026-06-28** ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1)): "I highlighted the trade
  opportunity last week Tuesday at the 30 min pivot off the 20EMA but for some god forsaken reason I did not execute."
  Location: the 20-day EMA.
- **TQQQ, 2026-08-30** ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-d40)): "Got TQQQ Monday on the
  30 min pivot." (Monday 2026-08-24.)
- **DELL, 2026-10-04** ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6)): "Then on this 30 min pivot
  on Thursday I was able to load it back with bigger size at 527 and a 520 stop. Currently up 35 points on that or 5-1
  RR." Entry, stop and result are given; they check out on the bars (section 4.3).
- **LITE, 2026-10-11** ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-31b)): "Main entry day at the
  20EMA shake and 30 Minute Pivot at $895. A top tier example of the strategy." He calls it "the strategy": a named
  method, not a one-off.
- **TEAM, 2026-10-11** (same post): "Pulls into and undercuts this range slightly closing with a strong lower wick.
  Remounts MAs and breaks highs. Retest of $200-$195 buyable. Clean $30 min pivot at $172 is the ideal buy."
- **The verdict log** (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`, the hourly Go Signal sitting): on MSFT
  2022-07-14 he cut the item with "Eh so this is more of a pivot vs go signal btw". The recorder's note beside it (not his
  words) reads: a first hour that undercuts the flag low and does not go red to green, then works higher, "is a PIVOT,
  not a Go Signal". So in his vocabulary the pivot is a turn without the red-to-green reclaim of the prior close that
  defines the Go Signal.
- **Related, but different, 30-minute rules of his.** (a) The Kicker's day-1 entry is "a 30 min ORB" (verdict log
  2026-11-02; `TRADE_PLANS.md`): an opening-range break, not a pivot. (b) His gap rule B20: "let first 30 minute low of
  gap down day define new stop" (2026-11-09), which he also wrote up on 2025-06-22: "I always use the first 30 min to let
  play out and establish the range." These use the first half hour as a range; the pivot does not.

### 3.3 Other UCT voices (member-only Discord; substance only)

The repo's knowledge-base files (`docs/study/levels/brain_kb_*.json`) hold machine-written summaries of the team's
Discord posts. The Discord is for members and this repo is public, so I give only the substance and the note id, not
wording. These are summaries, so they are not anyone's verbatim words.
- **TSDR, 2026-05-18 (KB 12595):** use the 30-minute pivot only when there is a pullback to a key spot or moving average.
- **AtTheAsk, 2026-09-09 to 09-16 (KB 12968):** a teaching thread. It works best on stocks you already want (leaders
  pulling back in an orderly way) and when the pivot forms at an area of interest such as an EMA pullback or gap support.
  His ideal: a pullback to the 10 EMA, a gap fill and a retest of a marked zone, with an AVWAP from the big candle. After
  buying, he moved his stop to breakeven.
- **TSDR, 2026-10-05 (KB 12976):** on waiting for VWAP before buying: it is confirmation against risk/reward; what
  matters is the presence of buyers, with the stop at the low of day or below the pivot candle.
- **TSDR, 2025-10-30 (KB 11957):** NBIS the week before at about 95.70 was a great example of the 30-minute pivot (NBIS at the 50
  SMA and the HVC after 8 down days); TSLA at the 20 EMA was the same idea.
- **TSDR, 2025-09-30 desk log (KB 10201):** a good 30-minute pivot example on ALAB, aligned with a good level.
- **TSDR, 2025-08-04 desk log (KB 10154):** a good example on the 30-minute chart of a member's pivot strategy on APLD.
- **TSDR, 2025-08-22 (KB 11707):** he sorts a scanner watchlist by a check-mark column to see what is triggering 30-minute
  pivots (a TC2000-style condition column).
- **Manrav, 2026-04-30 (KB 12527):** one member's chart was not a 30-minute pivot; BABA that morning was a good example,
  and TSLA, trying the 50 SMA, was another.
- **Manrav, 2026-09-03 (KB 15695):** buying weakness gives the best risk/reward spots: oops reversals, breakout retests,
  moving-average retests, 30-minute pivots.
- **TSDR, 2026-04-27 (KB 13442):** members should watch for hammers, reclaims, undercuts, 30-minute pivots, oops,
  red-to-green and hourly higher lows themselves, and define stop and size.

### 3.4 30-Min Pivot Party (third-party site, read 2026-11-09)

[30minpivotparty.com](https://30minpivotparty.com/) is a small site whose footer names two private individuals I could
not identify as known traders, marked "PERSONAL RESEARCH TOOL — NOT FINANCIAL ADVICE". It does not credit 1ChartMaster,
but its rule matches his HOOD trade almost word for word. Low reliability as a source; useful only to show how others
read the name.
- "Strong uptrend. A pullback. Two red 30-minute candles in a row. Then the first green candle prints right at the daily
  8, 21, or 50 EMA — buyers stepping back in."
- "Enter on a break of that green candle's high. Stop at its low. Target 3x the risk."
- "Two or more consecutive red 30-minute candles confirm sellers are in control, for now."

### 3.5 TradingView community scripts (read 2026-11-09; community code, low reliability)

Three public scripts carry the name. They matter only as evidence of how the trading public reads it and of who it is
credited to. None is a source for a rule.

- **"30 Min Pivot Enhanced"**, by the user aniketsangwan5, published 2025-09-10 **[checked: date added]**
  ([page](https://www.tradingview.com/script/cAuyXk3o-30-Min-Pivot-Enhanced/)). Its description: it "detects pivot
  reversals and potential buy/sell signals on the 30-minute timeframe" and "pivots form after consecutive same-color
  candles". The bullish case comes "after a red streak". It does not credit anyone.
- **"Elite 30 Min Pivot - by TenAM Trader"**, published 2025-07-29 **[checked: found and read by the checker]**
  ([page](https://www.tradingview.com/script/fhvOnhag-Elite-30-Min-Pivot-by-TenAM-Trader/)). Its rule: "A trend is defined
  when a configurable number (default: 3) of same-colored candles (green or red) appear in a row. The pivot is marked by
  the first opposite-color candle after the trend." Then: "A BUY signal is triggered when price breaks/closes above a
  pivot high from a downtrend", within "the next few candles (default: 2)", and "Stop Loss Line – opposite side of the
  pivot candle." It does not credit anyone; "Elite" is not explained on the page. Our repo's earlier sweep
  (`docs/superpowers/research/setups/setup_criteria.json`, `p30.provenance`) summarised this script as "the risk is
  defined by the pivot candle"; that is a paraphrase, not wording from the page.
- **"30 Min Pivot"** (described as "The 30 Min Pivot Pullback Strategy"), published 2026-10-11, updated 2026-10-16
  **[checked: new]** ([page](https://www.tradingview.com/script/refbFy4d-30-Min-Pivot/)). Its rule: "Tracks constructive
  pullbacks touching Daily 8 & 21 EMA support levels"; "BUY: Placed at the trigger bar's high."; "SL: Anchored to the
  structural low of the trigger bar"; "T1 (+2R)". Its credits: "Special acknowledgment to the momentum trading frameworks
  shared by Sean ( SrxTrades ) and @1ChartMaster (Elite Swing Trading), whose tactical moving average pullback setups
  and execution clarity inspired this Pine Script implementation." The only outside attribution of the method to him
  that either agent found. (Its benchmark is India's CNX500; the author trades Indian stocks.)

### 3.6 The other reading: the first half hour's range (what our Model Book card describes)

- **Kristjan Kullamägi (qullamaggie.com, "3 TIMELESS setups", 2021, read 2026-11-09).** For his breakouts: "Enter on the
  opening range highs. The opening range highs can be the highs of the first 1-minute candle, the 5-minute candle or the
  60-minute candle (on the 60-minute timeframe the first candle is always only 30 minutes, 9.30-10 AM)." Stop: "Stop is
  always lows of the day". ([page](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/))
  One of his three choices, the first 60-minute candle, is in fact the first half hour. This is an opening-range break
  on a breakout day, not a pullback pivot.
- **Investopedia, "Opening Range"** ([page](https://www.investopedia.com/terms/o/opening-range.asp), re-read by the
  checker 2026-11-09; "Updated May 19, 2026"). "The opening range refers to a security's high and low prices during the
  first 15 minutes of trading." Our `docs/study/research/definitions.json` quote (read 2026-10-17) is on the page word
  for word. **[checked: the writer got HTTP 402; the checker got the page]**
- **The app's ORB detector** (`opening_range_breakout.py`) uses a 30-minute opening range (six 5-minute bars). Section 5.
- Full treatment of the opening-range break, including Crabel and the Zarattini studies, belongs to setup 40.

### 3.7 The mechanical ancestor: Raschke's Holy Grail entry (originator, primary source)

"Linda Bradford Raschke on Short Term Trading Strategies", interview by David Vomund, *AIQ Opening Bell Monthly*, August
1997, on her own site ([PDF](https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf), read 2026-11-09). Her
rule box, "Buy rules (sells are reversed)":
- "3. When the price touches the 20 period moving average, put a buy stop above the high of the previous bar."
- "4. Once filled, enter a protective sell stop at the newly formed swing low. Trail stops as profits grow."
- Why: "any pullback from a new momentum high can be bought."

Her rule is written in bars and her examples are daily charts; she does not say whether it applies to 30-minute bars.
Put on 30-minute bars at a daily average, it is close to the 30-minute pivot: touch the level, buy over the turning
bar's high, stop at the new swing low. The differences: she requires ADX over 30 (a
strong trend filter) and does not require the bar to be green. Dossier 17 covers her setup in full.

Kullamägi's parabolic long (same 2021 page): "Entry is opening range highs or the first green 5-minute candle or any
range break to the upside". The "first green candle" idea, on a 5-minute chart and a different setup.

### 3.8 The homonym: floor-trader pivot points (StockCharts ChartSchool)

[ChartSchool, "Pivot Points"](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/pivot-points)
(read 2026-11-09): "Pivot Points use the prior period's high, low, and close to estimate future support and resistance
levels." And: "Pivot Points for 30-, 60-, and 120-minute charts use the prior week's high, low, and close." So in
ChartSchool's language a "30-minute pivot" would be a level computed from last week's prices. That is not this setup,
and a member who searches the term will find it. The course should say so in one line.

### 3.9 Not read, so no wording or rule from them

- The two UCT workshop videos and the 2025-07-11 interview: no transcript (YouTube refused the caption request; the app's
  own transcript endpoint needs a server secret, which I did not use). The repo holds house summaries of them (section 5.6).
- Zarattini, Barbon and Aziz (2024), the 30-minute opening-range numbers: SSRN answered HTTP 403 to the writer and again
  to the checker (two clients). Section 4.2 reports them only as our repo recorded them.
- The 1ChartMaster $TEM post (2025-09-05) and his risk post (2026-09-30), section 3.1. The checker's search did not
  surface the $TEM post either.
- **[checked]** Investopedia and the TenAM Trader script were on this list; both were read by the checker (sections 3.5
  and 3.6).

### 3.10 Comparison table

"n/s" = not stated.

| Source | Prior trend | Pullback | Location | Pivot candle | Trigger | Stop | Target / hold | Volume |
|---|---|---|---|---|---|---|---|---|
| 1ChartMaster (X, 2025-2026) | "strong uptrend"; "RS names", HTFs, momentum names | "a string of red 30-minute candles" | "often near" the 8 EMA or 8-week EMA | the point where the 30-min chart "shifts back to the upside"; HOOD chart: first green candle | HOOD: just over the green candle's high | "usually just below the recent 30 minute low"; HOOD: 4c under the green candle's low | "short but sweet" (2025); HOOD "over 10R" (2026) | n/s |
| Owner (Substack trades) | leaders in uptrends (DELL, LITE, TEAM, GLW, TQQQ) | pullback / "shake" | 20-day EMA (GLW, LITE, DELL); a range undercut (TEAM) | n/s in words; DELL bars: the 10:00 candle that made the low | n/s; DELL fill (527) was under the candle's high (530.43) | DELL: 520, under the turn candle's low 520.18 | DELL held; "5-1 RR" next day | n/s |
| UCT Discord (summaries) | leaders pulling back orderly | n/s | required: a key spot or MA, gap support, HVC | a pivot candle | n/s | the day's low or under the pivot candle (KB 12976) | breakeven after buying (AtTheAsk) | n/s |
| 30-Min Pivot Party | "Strong uptrend" | "Two or more consecutive red" 30-min candles | "right at the daily 8, 21, or 50 EMA" | first green 30-min candle | break of its high | "at its low" | "3x the risk" | n/s |
| TradingView scripts (3) | "Stage 2 market leaders" (Pullback Strategy) | "a red streak" (Enhanced); 3 same-colour candles by default (TenAM) | n/s; "Daily 8 & 21 EMA" (Pullback Strategy) | the first opposite-colour candle (TenAM); optional "flush" candle (Enhanced) | break or close over the pivot high within 2 candles (TenAM); "the trigger bar's high" (Pullback Strategy) | "opposite side of the pivot candle" (TenAM); "the structural low of the trigger bar" (Pullback Strategy) | "T1 (+2R)" (Pullback Strategy) | n/s |
| Raschke 1997 (ancestor) | ADX(14) over 30 and rising | retrace to the 20 EMA | 20-period EMA | the bar that touches | "buy stop above the high of the previous bar" | "newly formed swing low" | trail | n/s |
| Model Book card (UCT app) | n/s | "consolidate under" the first half hour's high | n/s | the first 30-min bar | break of that bar's high | n/s | n/s | "with volume" |
| Kullamägi ORH (other reading) | breakout setups | n/s | the breakout level | the first 1, 5 or 60-min bar (first 60-min bar = 9:30-10:00) | its high | "lows of the day" | 1/3 to 1/2 after 3-5 days, trail 10/20-day | n/s |

### 3.11 Where the sources disagree

1. **What the "pivot" is.** Everyone who trades it (1ChartMaster, the owner, the Discord teachers, the Pivot Party site,
   the TradingView script) means a turn candle after a pullback. Our own app (card, course script, chart-builder note,
   `definitions.json`) means the first half hour's high. These are two different setups.
2. **Must it be at a level?** UCT says yes (TSDR's 2026-05-18 note; AtTheAsk; the workshop summary's "real pivot points,
   not random candles"). 1ChartMaster's post says "often near" support. The Pivot Party requires the daily 8, 21 or 50
   EMA.
3. **Which levels.** 8 EMA or 8-week EMA (1ChartMaster); daily 8, 21, 50 EMA (Pivot Party); 10 EMA, 20 EMA, 50 SMA, gap
   support, HVC, a range low (UCT).
4. **How many red candles.** "A string" (1ChartMaster); "two or more" (Pivot Party); a streak length setting, default 3
   (TenAM Trader) or configurable (Enhanced) on TradingView.
5. **Where the stop goes.** Under the pivot candle's low (HOOD chart, Pivot Party, both TradingView rules); "just below
   the recent 30 minute low" (1ChartMaster's post, which could mean either); the day's low or under the pivot candle
   (TSDR, Discord, KB 12976); the house default A3 is under the day's low. **[checked]** The two differ on four of the
   five named examples, not one: HOOD (pivot low 101.20, day low 100.69), LITE (883.43 against 881.23, the 11:00 red
   candle's low), TEAM (168.73 against the 13:00 flush low 168.05) and TQQQ (68.31 against 67.93). Only on DELL did the
   pivot candle make the day's low (520.18). The gap is 0.25% to 0.55% of price in those four cases.
6. **The entry price.** Over the pivot candle's high (HOOD, Pivot Party). The owner's DELL fill at 527 was below the
   turn candle's high (530.43), as if he bought the reclaim of the first candle's low (527.16) inside the turn.
7. **How long to hold.** "Short but sweet" (1ChartMaster 2025) and "3x the risk" (Pivot Party) against swing holds to
   5R and beyond (the owner's DELL and LITE, 1ChartMaster's HOOD at "over 10R").
8. **Volume.** Only our card asks for a break "with volume", and it gives no number. No one who trades the pivot states a
   volume rule.

---

## 4. Measured evidence

### 4.1 Published statistics on the 30-minute pivot

None found. I found no study, no backtest and no win rate from the originator, UCT or anyone else. 1ChartMaster's own
words are the only performance claims: "showing out this week" (2025-04-09), "Nothing is a 💯 guaranteed" (2025-05-30),
HOOD "over 10R" (2026-09-03). Limit: my search was cut short by the shared search budget (section 2).

### 4.2 The 30-minute opening range (relevant only to the card's reading; not re-read by me)

Our repo's earlier sweep (`docs/superpowers/research/setups/setup_sources.json` and `setup_criteria.json`, entries
`zarattini_orb_stocks` and `p30.measured`) records that Carlo Zarattini, Andrea Barbon and Andrew Aziz, "A Profitable Day
Trading Strategy For The U.S. Equity Market" (SSRN 4729284, 2024), tested opening-range breaks on US stocks with 5, 15, 30
and 60-minute ranges, with a relative-volume filter, and that the 30-minute range did worst (Sharpe 0.21 against 2.81 for
5 minutes). SSRN refused my download (HTTP 403), and refused the checker's two attempts the same way, so neither of us
has checked these numbers. Even if exact, they measure a
different trade: a day trade on the first half hour's range, closed by the end of the day. They say nothing about a
pullback pivot held as a swing.

### 4.3 The named examples on real bars (my computation)

Data: Yahoo 5-minute bars (built into 30-minute bars) and 60-minute bars for daily context, in the shared research
database, 2026-08-17 to 2026-11-06. Daily averages are computed from those bars, so they can differ by cents from a
charting service. "First touch" walks forward bar by bar; a bar that touches the stop counts as stopped first.

| Case | Who | Entry / stop | Risk | Daily level | Reached | Notes |
|---|---|---|---|---|---|---|
| DELL 2026-10-01 | owner | 527 / 520 (his numbers) | 1.33% | 20-day EMA about 534.8; the day's low 520.18 undercut it, close 541.70 | 2R and 3R at 13:00 that day; 5R in the first half hour next morning | Matches his "up 35 points ... 5-1 RR". Stop touched 2026-10-14 (after 9.7R best) |
| LITE 2026-09-28 | owner | 895 (his) / 883.41 (my reading: 2c under the 11:30 green candle's low) | 1.29% | 20-day EMA about 913.6; low 881.23, close 921.66 | 2R same day; 3R and 5R in the first half hour next morning; 21.4R best within 10 sessions | The day is my reading: his 2026-09-27 post asks "DO we look for the $900 shake n bake?" The pivot candle's low (883.43) sat 2.20 above the day's low (881.23, the 11:00 red candle) **[checked]** |
| HOOD 2026-08-31 | 1ChartMaster | 102.99 / 101.16 (his) | 1.78% | 20-day EMA about 101.4, 50-day SMA about 101.3 | 2R next day; 3R and 5R on 2026-09-03 | 12.1R best; matches "over 10R" |
| TQQQ 2026-08-24 | owner (levels mine) | 69.10 / 68.29 | 1.17% | under its 20 and 50-day, over its 200-day; undercut the 2026-08-20 low | 2R next day; 5R 2026-08-27 | Stop touched 2026-09-01 after 6.3R best |
| TEAM 2026-09-29 | owner (levels mine) | 172.38 / 168.71 (the 13:30 green candle, low 168.73, after a 13:00 flush to 168.05; the stop is under the pivot candle, not the day's low) | 2.13% | under its 20-day EMA (about 183); the low undercut the base's low (174.21, 2026-09-09) and the day closed at 175.96, as he wrote ("undercuts this range slightly closing with a strong lower wick"); it broke 200 on 2026-10-08 | 2R and 3R next day; 5R 2026-10-01 | 11.6R best |

**[checked]** The checker re-ran the five cases on the same bars: every entry, stop, level and R figure above reproduced
(DELL stop touched 2026-10-14 after 9.7R; LITE 21.4R; HOOD 12.1R; TQQQ stopped 2026-09-01 after 6.3R; TEAM 11.6R), and
the first half hour's highs quoted in section 5.5 (DELL 543.15, HOOD 104.17, LITE 950.50) are the 9:30 candles' highs.

All five reached 5R. **This proves nothing about the odds.** These are trades the authors chose to post afterwards; a
losing pivot is rarely written up. They do show what the setup looks like when it works: a leader, a pullback that
undercuts or touches a daily average, a turn candle that holds, a stop 1.2% to 2.1% away.

### 4.4 My replay of a mechanical version (my computation, not a published statistic)

**What I ran.** Scripts in my scratch folder (`replay.py`, `replay2.py`, not committed). Universe: the about 1,000 most
liquid US names and ETFs in the shared database, bond and cash ETFs removed, names with a one-day move over 45% removed
(split guard). Window: entries from 2026-08-17 to 2026-10-23 (49 sessions), each followed for 10 sessions, data to 2026-11-06.
The rule, coded as literally as the originator's words allow:
- daily context (prior day): close over the 50-day SMA, 50-day over the 200-day, 20-day EMA over the 50-day, price $10
  or more, $20 million a day or more;
- a red string of 2 or more 30-minute candles, then the first green candle (the pivot);
- at an average: the pivot candle's low within 1% above, or under, the prior day's 10-day EMA, 20-day EMA or 50-day
  SMA, and its close above it;
- trigger: a later candle the same day trades over the pivot high before any candle trades under the pivot low; entry a
  cent over the high, stop 2 cents under the low;
- outcomes: whether 2R, 3R, 5R came before the stop; and a house-style managed result (breakeven once 2R is touched, a
  third sold at 3R, a third at 5R, the rest out at the stop or at the close 10 sessions later).
Counted once per stock per day (the first trigger), so repeated stabs do not inflate the count.

| Version | Trades | 2R before stop | 3R | 5R | Managed, mean R per trade (95% interval) |
|---|---|---|---|---|---|
| Pivot at a daily average | 3,647 | 33.9% | 24.2% | 15.1% | +0.02 (-0.05 to +0.09) |
| Same, pivot **not** near an average | 5,031 | 33.6% | 25.6% | 17.3% | +0.09 (+0.03 to +0.16) |
| At an average, red string of 3 or more | 1,954 | 35.6% | 26.6% | 17.0% | +0.12 (+0.03 to +0.22) |
| At an average, 3+ reds, RS proxy top 20% | 819 | 33.3% | 25.9% | 17.5% | +0.13 (-0.03 to +0.29) |
| At an average, red string of 5 or more (all triggers) | 523 | 35.2% | 28.3% | 20.3% | +0.26 (+0.06 to +0.48) |
| Strict: undercut and reclaim of the average, pivot = the day's low, 3+ reds, RS top 20%, risk 0.75% to 3% (all triggers) | 121 | 28.1% | 22.3% | 17.4% | +0.08 (-0.29 to +0.46) |
| **The card's version**: first 30-minute bar's high, stop under its low (all days) | 5,367 | 29.9% | 20.3% | 9.8% | **-0.11 (-0.16 to -0.07)** |

**[checked]** The checker recomputed this table from the saved event files (`replay2/pivot_events.csv`,
`card_events.csv`; 13,591 pivot events, 82.7% matured) with its own once-per-stock-per-day pick (the first trigger of
the day) and its own 2,000-draw bootstrap. The "not near an average" row (5,031; 33.6 / 25.6 / 17.3; +0.09, +0.03 to
+0.16), the "5 or more" row, the strict row and the card row reproduced exactly. The "at an average" rows came out with
3% to 4% fewer trades and the same rates (3,499 trades, 33.9 / 24.3 / 15.0, +0.02, -0.05 to +0.09; "3 or more": 1,904,
35.8 / 26.6 / 17.0, +0.13, +0.04 to +0.23; with the RS proxy: 798, +0.14, -0.01 to +0.30), the difference being which
of a day's repeated stabs counts as "the" trade. No conclusion below changes.

The RS proxy is the stock's 63-day return ranked across this universe, not the app's RS rating. Managed trades that ended
above zero were about a fifth to a quarter in every version: few winners, some of them large. The intervals are simple
bootstrap intervals that treat trades as independent. Many trades share a day and the market moves them together, so the
true uncertainty is wider than shown.

**What it says, and what it does not.**
1. **The bare mechanics at an average have no clear edge.** Red candles, first green candle, buy its high, at a daily
   average, came out at about zero after house management, and its interval straddles zero.
2. **My at-an-average test did not help**: pivots away from any average did a little better (+0.09R). Either my 1% test
   is not what the owner and the originator mean by a level (they also use gap support, HVCs, range lows and judgment),
   or the level matters less than they believe. The owner's own examples were deeper shakes than my filter selects
   (DELL, LITE, TEAM all undercut the 20-day or a range and closed back over it).
3. **A longer red string helped.** Three or more red candles did better than two (+0.12R), and five or more better still
   (+0.26R on all triggers, +0.32R counting one per stock per day). I tested about twenty cuts, so some of this can be
   chance; it is a lead to check, not a rule.
4. **The card's version lost money.** Buying over the first half hour's high, with the stop under its low, came out at
   -0.11R per trade with the whole interval below zero, and its stops were about three times wider (median 1.6% against
   0.6%).
5. **Stops were very tight** (median about 0.6% of price), so most trades are stopped at some point within 10 sessions
   (82% to 92%), often after reaching a target. A plan that does not take the 3R and 5R trims gives most of it back.

**Limits.** One 12-week window in a single market phase; Yahoo bars (not audited); today's liquid names only
(survivorship); no commissions or slippage, which matter with stops this tight; a bar that touches both the stop and a
target counts as a stop (cautious); my averages come from 60-minute bars and can differ by cents from a charting
service; no earnings filter. This is a check of the skeleton, not a test of the setup as UCT trades it.

**The last 16 of the 121 strict trades (2026-10-15 to 10-23), in date order, winners and losers both, for the owner to
look at** **[checked: the writer's list is this tail, not the whole strict set; the 16 lines reproduce exactly from the
event file]**. Entry / stop; the best reach before the original stop; the house-managed result.
DT 2026-10-15 (62.48 / 61.79; 3.7R; 0R, back to breakeven first) · NTNX 2026-10-15 (68.43 / 67.18; 2.4R; 0R) ·
SN 2026-10-16 (187.60 / 186.11; 16.0R; +7.2R) · CLF 2026-10-16 (12.14 / 11.96; 14.0R; +6.7R) · NOW 2026-10-16 (141.34 /
139.92; 12.8R; +2.7R) · W 2026-10-16 (107.36 / 105.49; 7.3R; +4.2R) · IQV 2026-10-20 (267.81 / 263.26; 3.7R; +1.0R) ·
EQNR 2026-10-20 (45.16 / 44.67; 8.0R; +2.7R) · RVTY 2026-10-20 (155.69 / 152.17; 3.8R; +1.0R) · SM 2026-10-20 (38.16 /
37.64; 2.2R; 0R) · TEVA 2026-10-21 (40.56 / 39.48; 0.5R; -1R) · SHOP 2026-10-22 (171.12 / 168.96; 0.1R; -1R) · APA
2026-10-22 (48.45 / 47.81; 7.1R; +2.7R) · VRSN 2026-10-22 (302.81 / 296.93; 0.3R; -1R) · FROG 2026-10-22 (93.76 /
92.00; 0.5R; -1R) · OSCR 2026-10-23 (31.88 / 31.60; 0.1R; -1R). Found by code, not judged by eye: some will not pass
the owner's eye (the 15:00 and 15:30 pivots, for example).

### 4.5 What is missing

- A measured win rate for the setup as UCT trades it (with the discretionary grading). Only a hand-labelled set of the
  owner's own examples can give that.
- Any test outside one 12-week window in late 2026.
- The originator's own rules from his workshops (no transcript).

---

## 5. Our app: what the code and the cards actually say

### 5.1 Scanners

**No scanner tests the 30-minute pivot.** There is no detector for it under `api/services/pattern_engine/detectors/`.
`app/src/components/chart/engine/ast/starterScans.json` refuses it: `"30min Pivot is defined against the first
half-hour's high, which exists only on an intraday timeframe. Blocked on cadence (design section 8.5)."`

**The nearest code is the ORB detector**, `api/services/pattern_engine/detectors/uct/opening_range_breakout.py`, which
the live intraday scan in `api/main.py` runs on 5-minute bars. What it tests: the opening range is the first six 5-minute
bars (the first 30 minutes); the range must be 0.3% to 2.5% of price; within the next 1 to 3 bars a bar must close above
the range high on at least 1.5 times the range bars' average volume. Levels: entry at the range high × 1.001, stop at the
range low × 0.998, target at entry plus twice the range height. This is exactly the card's "first half-hour's high"
reading. It is not the pivot. Its docstring also makes claims I could not source: that the opening range break produces
"continuation 60-70% of the time", and a Lance Breitstein quote. Setup 40 should check those.

### 5.2 The Model Book card (`app/src/pages/modelbook/setupCatalog.js`)

- `name: '30-Minute Pivot'`, `family: 'Intraday'`, `direction: 'long'`.
- `essence: 'The first half-hour’s high becomes the trigger — consolidate under it, then break with volume.'`
- The glyph: one big first candle, seven small candles drifting under its high, then two breakout candles; the dashed
  trigger line is drawn at the first candle's high (`pivot: { idx: 0, side: 'h' }`).
- There is no playbook write-up for it in `setupPlaybooks.js` (the card shows the "being authored" placeholder). The
  Bull Flag playbook mentions "a U&R or a 30-minute pivot near the base of the range" as an aggressive early entry,
  which fits the originator's meaning better than the card does.

### 5.3 Journal tags

- `app/src/constants/setupGroups.js`: `'30min Pivot'` sits in the **Intraday** group with Opening Range Breakout and
  Breakdown, Red to Green (Intraday), Green to Red and Mean Reversion L/S.
- `app/src/pages/journal-2-0/lib/setupTagMap.js`: `'30min Pivot': '30-Minute Pivot'` (the journal tag maps to the card).
- `api/services/desk_session_insights.py` lists "30-Minute Pivot" among the setup names its model may tag in Desk videos.

### 5.4 Study and course text

- `docs/study/UNITS-method.md`, SET.33: "The patient sibling: consolidate under the first half-hour high, break with
  volume." Lesson M11.L1 "Reading the Open: ORB and the 30-Minute Pivot — Two Range-Break Timers".
- `docs/curriculum/uct_method_scripts.json`, the M11.L1 script: "Mark the high of the first half-hour — that's the
  pivot." Its worked example is SMCI on 2024-01-19 (a gap day, the first half hour's high, a coil under it, the break).
  That is an opening-range example, and its numbers were drafted, not checked by me.
- `docs/study/UNITS-foundations.md`, F11.02: "ORB, 30-minute pivot, Go Signal for the day", which files it as a day
  trade.
- `docs/study/research/definitions.json`: `"house_name": true`, nearest standard "Opening range breakout with a 30-minute
  range", and `"conflicts": "No external source names a '30-minute pivot'."`
- `docs/wisdom/vocabulary/setup-vocabulary-v1.json`: status "candidate", `"coined_by": null`, "little evidence (one
  passing use)".
- **[checked]** `docs/superpowers/research/setups/setup_criteria.json`, the "30min Pivot" entry, already disagrees with
  the card in two places: `p30.provenance` records that the setup "traces to @1ChartMaster on X and a TradingView script
  (TenAM Trader)" with "NO VOLUME-CONFIRMATION NUMBER FOUND anywhere", and `p30.measured` records the Zarattini 30-minute
  figures (Sharpe 0.21; 5-minute 2.81, 15-minute 1.43, 60-minute 0.40) with the note that they "cut against the setup's
  existence" as the card defines it. Its `p30.firm_30min_close` row keeps a house KB summary of Gil Morales's reason for
  waiting 30 minutes (retail order flow in the first half hour); that is a rationale for the opening-range reading, not
  for the pivot.

### 5.5 What looks wrong or disagrees with the sources

1. **The card, the course script, SET.33, the chart-builder note and `definitions.json` describe the wrong setup.** They
   describe a 30-minute opening-range break. The originator, the owner's five public examples and every UCT teacher in
   the Discord notes describe a turn candle at support after a red string. On the owner's DELL trade the first half
   hour's high was 543.15 and he bought at 527; on HOOD the first half hour's high was 104.17 and 1ChartMaster bought at
   102.99; on LITE the first half hour's high was 950.50 and the owner's pivot was 895. Not one example fits the card.
2. **The glyph draws the wrong picture**: a big first candle and a coil under its high. The originator's picture is a
   run of red candles into an average, then a green candle and a break of its high.
3. **"Intraday" family and "for the day".** Both the originator (HOOD "over 10R" over days) and the owner (DELL, LITE held
   as swings) use it as an **entry timer for a swing trade**. F11.02's "for the day" files it as a day trade.
4. **`definitions.json` is out of date**: a named source does exist (1ChartMaster, from 2025-03-11), and the
   vocabulary file's `coined_by: null` should read 1ChartMaster (his own claim, section 2).
5. **"With volume"** has no source. No one who trades it states a volume rule.
6. **The ORB detector's unsourced statistics** (section 5.1) should not be taught for either setup until sourced.

### 5.6 House summaries of the UCT workshop videos (not his words)

`api/services/education_seed.py` (generated from the firm's workshop sheet) describes "30 Minute Pivot Workshop with
1ChartMaster" (YouTube JChA7ErhE48, 1:01:46) as emphasising "trading strategies based on real pivot points, not random
candles, by layering probabilities such as support/resistance, moving averages, and trend lines." It adds that
"Successful pivots often occur at key support or resistance levels" and mentions "the 15-minute rule to handle gaps".
"Q & A With 1ChartMaster" (iOD-jIcX46A, 1:39:43) "Highlighted the effectiveness of the 30-minute pivot strategy for
low-risk entries and high rewards." (The checker confirmed both videos' titles, dates and lengths on their YouTube
pages: 2025-09-17 on the TSDR TRADING channel and 2025-09-11 on the Uncharted Territory channel.)

**[checked] Three more library summaries in the same file carry the pivot; the writer missed them.** They are house
summaries of workshops, not his words, but two of them state the rule more plainly than anything else in the repo:
- "Relative Strength and Weakness Workshop With 1ChartMaster and TSDR" (mfswYu5UlX8, 2026-02-09, 1:08:36): "Using the
  30‑minute pivot (buy the first strong 30‑min green candle after a pullback; stop at its low)."
- "Range Trading Workshop with 1ChartMaster and TSDR" (xYWEDyTRPuc, 2026-02-26, 1:04:53): "support buys
  (8‑day/21‑day/30‑min pivots) offer tighter, safer risk." and "30‑minute pivots are the cleanest entries: red → green
  at a key level with tiny risk."
- "ETF Scanning, Groups and Lists Workshop With TSDR and 1ChartMaster" (_xK_MuRCvhg, 2026-01-26, 1:01:43): "intraday
  tactics like the 30‑minute pivot".
Both rule-like summaries agree with the originator's HOOD chart (first green candle; stop at its low) and with the
level requirement in TSDR's and AtTheAsk's notes. The curriculum file `docs/curriculum/curriculum_final_v2.json` adds chapter notes
(written by our curriculum pipeline; I did not check them against the videos) for three library videos: "29:00 - invalidation rules & the one-candle selectivity rule (A+ setups only)"
(video 52), "5:48 – 30-minute pivot entry/stop/R:R mechanics (QQQ example)" (video 135) and "18:07 - the 30-minute pivot
reversal bonus" (video 83). These are summaries, and I do not know who presents video 52. The owner should watch those minutes before the rules
are final, because the "invalidation rules" and the "one-candle selectivity rule" those notes name are there and
nowhere else I could reach.

---

## 6. UCT's own words

### 6.1 The owner (TSDR), public Substack, quoted exactly

- 2026-06-28, GLW: "I highlighted the trade opportunity last week Tuesday at the 30 min pivot off the 20EMA but for some
  god forsaken reason I did not execute." ([sunday-scans-ae1](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1))
- 2026-08-30: "Got TQQQ Monday on the 30 min pivot." ([sunday-scans-d40](https://unchartedterritoryy.substack.com/p/sunday-scans-d40))
- 2026-10-04, DELL (he had come into the week long from 533): "Was forced to sell that just above
  breakeven. Then on this 30 min pivot on Thursday I was able to load it back with bigger size at 527 and a 520 stop."
  ([sunday-scans-4c6](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6)) Note "bigger size": a re-entry after
  a breakeven exit, on a new trigger (compare rule B21).
- 2026-10-11, LITE: "Main entry day at the 20EMA shake and 30 Minute Pivot at $895. A top tier example of the strategy.
  Now flagging at highs." ([sunday-scans-31b](https://unchartedterritoryy.substack.com/p/sunday-scans-31b))
- 2026-10-11, TEAM: "Clean $30 min pivot at $172 is the ideal buy." (same post)
- 2026-09-27, LITE before the trade: "Do we just wait for the $1000 break? DO we look for the $900 shake n bake?"
  ([sunday-scans-09b](https://unchartedterritoryy.substack.com/p/sunday-scans-09b))
- The hourly cousin, 2026-03-15, YOU: "What I like to see is a hold, slight push higher, then hourly higher low to give a
  clear area to risk against and a presence of buyers." ([sunday-scans-af4](https://unchartedterritoryy.substack.com/p/sunday-scans-af4))
- Why intraday charts, 2025-06-29: he uses hourly/65-minute charts "for spotting key pivots and levels that the daily
  chart might mask." ([sunday-scans-d70](https://unchartedterritoryy.substack.com/p/sunday-scans-d70))
- His first-30-minutes rules that are not the pivot, 2025-06-22: "If we see buying activity and opening ranges being taken
  out or strong hourly candles forming after the first 30 min then we can execute on our focus list." And the gap-down
  rule: "I always use the first 30 min to let play out and establish the range."
  ([sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)); 2025-11-02: hard stops are moved only
  "on a gap down and will be replaced at the 15/30 min low" ([sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99)).

### 6.2 Unsigned UCT posts

- 2025-07-11: "Thank you to Elite Swing Traders (1chartmaster) on X/Twitter for dedicating his time to the Uncharted
  Territory community for an interview." ([interview-with-1chartmaster](https://unchartedterritoryy.substack.com/p/interview-with-1chartmaster))
- 2025-08-03: "Awesome new addition to the Uncharted Territory Crew! “EliteSwingTrader”, “1ChartMaster” joined our group
  as a trader, coach, and admin." ([sunday-scans-726](https://unchartedterritoryy.substack.com/p/sunday-scans-726))
- 2025-09-14: "The 30 Min Pivot doing wonders" (a caption under a member's results).
  ([sunday-scans-461](https://unchartedterritoryy.substack.com/p/sunday-scans-461))

### 6.3 Bracco and ChartMaster's own Substack sections

- **Bracco:** I found no mention of the 30-minute pivot in his Substack sections or in "The Parabolic Short".
- **ChartMaster's "The Rest of the Week" sections** (2025-10 to 2026-04) give daily trigger levels ("Needs to clear
  519-520 to trigger the trade", MSFT, [the-rest-of-the-week](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week),
  2025-10-01 **[checked: link added; the quote is in his "ChartMaster - MSFT EME" section]**) but never use the words
  "30 min pivot" (the checker's sweep of all 103 posts found the phrase only in the five posts quoted in 3.2 and 6.2).
  One is close in spirit: PATH
  "pulled back in to the 8ema. This looks like a tight risk spot. Want to see it hold the pivot here on any retest and buy
  on the way back up." ([the-rest-of-the-week-39d](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d),
  2025-10-15)

### 6.4 The owner's verdict log

- 2026-10-31, hourly Go Signal sitting, MSFT 2022-07-14: "Eh so this is more of a pivot vs go signal btw". A turn that
  never goes red to green is a pivot, not a Go Signal (section 3.2).

### 6.5 Candidate examples for the course (to check by eye before any lesson)

The owner asked for about ten examples per setup. Checked on bars (section 4.3): 1 to 5. From posts, not checked on bars:
6 to 12.

1. **DELL 2026-10-01**, owner: 30-minute pivot at the 20-day EMA after a 20EMA undercut; entry 527, stop 520.
2. **LITE 2026-09-28**, owner (the day is my reading): the "$900 shake n bake" under the 20-day EMA, pivot at 895.
3. **HOOD 2026-08-31**, 1ChartMaster: red string from 08-27, first green candle at 10:30 at the 20-day EMA and 50-day
   SMA, entry 102.99, stop 101.16.
4. **TEAM 2026-09-29**, owner (levels mine): a flush at 13:00 to 168.05, a green 13:30 candle, trigger over 172.37.
5. **TQQQ 2026-08-24**, owner (levels mine): an undercut of the prior swing low, first green candle at 10:30, trigger over
   69.09.
6. **GLW 2026-06-23**, owner: the gap-down day into the 20-day EMA (only hourly bars here; the hourly low 186.60 sat on my
   20-day EMA of about 186.55).
7. **HNGE 2025-08-05**, 1ChartMaster's chart (no bars to check; his chart shows an earnings marker at that day's close,
   so the 08-06 run was an earnings gap, section 3.1).
8. **NBIS, the week of 2025-10-20, about 95.70**, at the 50-day SMA and an HVC after 8 down days (Discord note KB 11957).
9. **ALAB 2025-09-30** (Discord desk log, KB 10201).
10. **APLD 2025-08-04** (Discord desk log, KB 10154).
11. **TSLA and BABA 2026-04-30**, TSLA at the 50-day SMA (Manrav, KB 12527).
12. **MSFT 2022-07-14**, hourly, the owner's "more of a pivot" (verdict log); not yet looked at on 30-minute bars.

Plus the replay's strict-cut list (section 4.4), which includes losers on purpose.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| House rule | What the setup does | Conflict? |
|---|---|---|
| A3 / F62 stop a few cents under the day's low or prior day's low | The originator's stop is a few cents under the **pivot candle's** low. **[checked]** On the five named examples that was the day's low only on DELL; on HOOD, LITE, TEAM and TQQQ the pivot candle's low sat 0.25% to 0.55% above the day's low (section 3.11, item 5). | Real, not small: the two stops differ on most examples. Decide which (question 2). |
| A13 stop usually within about 3% | Named examples 1.2% to 2.1%; my replay's median 0.6% (section 4.4). | None. A risk over 3% is a sign the pivot candle is too wide. |
| A5 / A7 size from the stop, capped at 40% | Very tight stops make the risk-based size huge (at 1% account risk and a 0.6% stop the formula asks for 167% of the account). The 40% cap binds on almost every pivot. | Not a conflict, but the course must show the cap working, and A7's warning applies: "a gap can jump the stop". |
| E57 market orders; D41 real stop with the broker | Buy at market when a candle takes out the pivot high (or a buy-stop a cent over it). | None. |
| C28 no chase more than 4% past the buy point | The buy point is the pivot high; a fill far above it is rare. | None. |
| C29 skip a long more than 10% above its 10-day | The setup lives at the 10/20-day average. | None. |
| B26 no longs under the 200-day | All named examples were above the 200-day. | None, if taught as a long in an uptrend. |
| C31 leaders, RS 80+ | The originator: "RS names", "leading names". | None. |
| B23 $10 and $20M a day; D42 | Leaders. Thin names make 30-minute candles noisy. | None. |
| B19 / E51 / E52 trims and trail | With a tight stop, 3R and 5R come fast: DELL 3R the same afternoon, 5R the next morning; LITE 5R the next morning. Trail the last third under the 10-day (fast) or 21-day. | None. The originator's 2025 "short but sweet" is an option, not a conflict. |
| F63 a gap past a trim level: trim at the open | Common here (DELL, LITE, HOOD all gapped through 3R or 5R). | None. |
| B20 gap against the stop: first 30-minute low is the new stop | A different 30-minute rule; on a pivot the stop is usually close, so a gap down through it is likely. | None, but the course must not mix the two. |
| B21 re-entry only on a new trigger; E56 at most 3 tries a week, 6 a month | Pivots fail and re-form; the owner's DELL re-entry was a new pivot after a breakeven exit. TSDR's Discord note on INTC (KB 12976) expects a few stabs. | None. E56 caps the stabs. |
| B22 no new buys in the 3 days before earnings | Applies. | None. |
| C30 no time-of-day rule; E58 regular hours only | The pivot can form at any 30-minute bar. Only regular-hours bars count. | None. |
| C33 time stop (under 1R after 10 days) | A pivot that has not worked in 10 days is dead. | None. |
| D47 shorts are our longs reversed | A bear pivot is the mirror (section 8.6). No UCT example found. | None. |

---

## 8. Proposed rules for our course

Each line is measurable. Where the sources disagree, the options and my recommendation follow.

### 8.1 What it is

- **Not a stand-alone setup: an entry timer on the 30-minute chart for a daily long setup at a level** (EMA pullback,
  gap support, remount, undercut and rally, flag base). [UCT: TSDR KB 12595; AtTheAsk KB 12968] [originator: "a tactical entry
  method"] Keep the card, rename its family or note "entry timer".
- **Prior trend:** prior day's close above the 50-day SMA, the 50-day above the 200-day, and the 20-day EMA rising.
  [source consensus: "strong uptrend"] [house rule B26] [my proposal for the exact test]
- **Leader:** RS rating 80 or more. [originator: "RS names"] [house rule C31]
- **Location (daily):** the pivot candle's low is at or under a daily level and its close is back above it. Levels: the
  rising 10 or 20-day EMA (the 8, 9 and 21 are fine), the 50-day SMA, gap support, an HVC or a prior breakout level.
  "At" = the low within 1% above the level, or undercutting it. [UCT] [originator: "often near ... the 8 EMA"] [my
  proposal for the 1%]
- **Structure (30-minute):** at least 2 red 30-minute candles in a row (the red string), which may start the day before.
  [originator: "a string of red"; Pivot Party: "two or more"; TenAM Trader script: 3 by default] [my proposal: 2 minimum;
  3 or more grades higher, section 9; my replay favoured 3 or more, section 4.4]
- **The pivot candle:** the first green 30-minute candle after the red string, at the level. Best when its low is the low
  of the pullback and it closes in the upper half of its range. [originator; HOOD chart] [my proposal for "upper half"]
- **Depth and length:** no fixed depth; the daily pullback is usually 1 to 5 days into the average. [UCT examples] [my
  proposal: no number taught]
- **Volume:** no rule. A quieter red string and a pivot or trigger candle with rising volume are grading cues only.
  [no source gives a number] [my proposal]
- **Liquidity:** price $10 or more, $20 million a day or more. [house rule B23]
- **Extension:** not more than 10% above the 10-day (automatic at the average). [house rule C29]

### 8.2 The buy

- **Trigger:** a later 30-minute candle trades a cent above the pivot candle's high, in the same session. [originator,
  HOOD] [Pivot Party] [my proposal for "same session"; question 5]
- **Order:** market order when it trades, or a buy-stop a cent over the high that becomes a market order. [house rule
  E57] Regular hours only. [house rule E58]
- **Not before the green candle closes.** No buying while the red string is still falling. [originator: "Rather than
  buying as the stock is falling"]
- **No chase:** skip if the fill would be more than 4% over the trigger. [house rule C28]
- **Options for the owner (question 6):** (a) strict: over the pivot candle's high (originator, HOOD); (b) early: the
  reclaim of an intraday level inside the turn (the owner's DELL fill at 527). **Recommend (a)** for the course: it is
  measurable and it is what the originator shows. (b) can be named as an advanced variant if the owner uses it.

### 8.3 The stop

- **Default:** a few cents under the pivot candle's low. [originator: HOOD 4c under; "just below the recent 30 minute
  low"] [house rule F62]
- **Option:** under the day's low when that is lower. [UCT: TSDR, day's low or under the pivot candle, KB 12976] [house rule A3]
- **Recommend:** under the pivot candle's low (the originator's way; the Pivot Party and both TradingView rules agree).
  **[checked]** This is not a corner case: on four of the five named examples (HOOD, LITE, TEAM, TQQQ) the pivot candle's
  low sat above the day's low, so the two rules give different stops most of the time; only DELL's pivot candle made the
  day's low. The owner must pick (question 2). The pivot-candle stop is tighter by 0.25% to 0.55% of price on those four.
- **Skip** if the stop is more than 3% away or wider than the stock's average daily range. [house rule A13] [my proposal
  for the ADR test, after Kullamägi's "should not be wider than the ATR or ADR"]
- The stop only moves up. [house rule A4]

### 8.4 Trims and trail (house defaults)

- Breakeven at 2R to 5R. A third at 3R, a third at 5R, trail the last third under the 10-day (fast movers) or the
  21-day (steadier), selling on a close below it. [house rules B19, E51, E52]
- If the stock opens over a trim level, trim at the open. [house rule F63]
- Time stop: under 1R after 10 trading days, sell. [house rule C33]

### 8.5 What invalidates it

- Before the trigger: any 30-minute candle trades under the pivot candle's low. Wait for a new red string and a new
  pivot. [my proposal; follows from the stop]
- No trigger by the close: the setup resets; tomorrow needs a new pivot. [my proposal; question 5]
- The daily context breaks: a close under the level the pivot was meant to hold (for example under the 50-day SMA when
  the pivot was at the 50). [my proposal]
- Earnings within 3 trading days. [house rule B22] Red market. [house rule D46]
- More than 3 tries in a week or 6 in a month on the same stock. [house rule E56]

### 8.6 The short mirror (the bear pivot)

- A stock under its 200-day SMA, falling 10/20-day EMAs, RS 20 or less. A string of at least 2 green 30-minute candles
  rallies into a falling daily average or a broken level. The first red 30-minute candle there is the pivot. Short a cent
  under its low; stop a few cents over its high; same trims. [house rules D47, B26, C31 mirror] [my proposal]
- No UCT example of a bear 30-minute pivot found. The owner quizzed members on MU's 30-minute chart into a declining 20
  EMA (KB 13501), which is the idea, but no trade. **Recommend:** teach it as one mirror card, no drills, until the owner
  shows an example.

### 8.7 Best market conditions

- Green: full use. Yellow: fewer, A and B grades. Orange: A+ only. Red: none (mostly cash and shorts). [house rules B18,
  F65, D46]
- The originator built it for volatile tapes, when holding a daily-stop position is hard. [originator 2025-03-11]

### 8.8 Common mistakes

1. Calling any green candle a pivot. No level, no setup. [UCT: "real pivot points, not random candles" (workshop
   summary); TSDR KB 12595]
2. Buying the falling red string before the green candle closes. [originator]
3. Confusing it with the first half hour's high (the opening-range break). [section 5.5]
4. Using it on laggards. [originator: "RS names"; house rule C31]
5. Sizing up because the stop is tight. The 40% cap still applies, and a gap can jump a 1% stop. [house rule A7]
6. Moving the stop down to "give it room" after the pivot low breaks. [house rule A4]
7. Endless stabs at the same name. [house rule E56]
8. Treating it as a day trade and selling the whole position at 1-2R. The owner's and originator's winners ran 5R to 20R
   over days. [UCT examples; house rule B19]

---

## 9. Grading (observable cues, not a checklist; rule E50 says grading is his judgment)

**A+ (cues from the sources):**
- A true leader (RS 90+), in a leading group; the first or second pullback after a breakout, an EP or an HVE.
  [originator: "a High Tight Flag (HTF) or a high momentum name"; owner: LITE "the optics/photonics leader"]
- The pivot sits on a rising 10 or 20-day EMA or the 50-day SMA, ideally with confluence (a gap fill, an AVWAP, a prior
  breakout level). [AtTheAsk KB 12968; owner GLW, LITE, DELL]
- A shake: the low undercuts the average (or a prior low) and the candle closes back above it. [owner: "20EMA shake";
  TEAM "undercuts this range slightly closing with a strong lower wick"]
- A clean red string of 3 or more into the level, then a green candle that is the low of the pullback and closes near
  its high. [originator; my proposal for "3 or more" and "near its high"]
- Risk 1% to 2%. The trigger comes within one or two candles. Market Green.

**B- (sized down, rule D38):**
- The pivot floats in mid-range with no daily level under it. [TSDR KB 12595]
- A flat or falling average, or the stock under the 50-day. RS under 80.
- A tiny midday doji after two small red candles (noise, a stop of a few tenths of a percent).
- Risk near 3%, or a pivot candle wider than the stock's average daily range.
- The trigger comes late in the day, earnings are close, or it is the fourth or later pullback to the same average.
- The market is Yellow or Orange.

---

## 10. Questions for the owner

1. **Which setup is "30-Minute Pivot" in our course?** (a) 1ChartMaster's turn candle at support (his posts, your five
   public examples); (b) the first half hour's high (our card, course script, chart-builder note); (c) both, under two names.
   **Recommend (a)**, and rewrite the card's essence and glyph; the first-half-hour version belongs to setup 40 (ORB).
2. **The stop:** (a) a few cents under the pivot candle's low (the originator; tighter); (b) under the day's low (A3).
   They differ whenever the pivot candle is not the day's low, which on the bars was four of your five public examples
   (HOOD, LITE, TEAM, TQQQ; only DELL's pivot candle made the low) **[checked]**. Your own Discord note allows both
   ("stop at LOD or below the pivot candle", KB 12976).
3. **Must the pivot be at a daily level?** Your 2026-05-18 note says yes. If yes, which levels count: the 10/20-day
   EMA, the 50-day SMA, gap support, an HVC, a prior breakout level, a range low? Any others (AVWAP, the 8-week EMA)?
4. **The red string:** at least 2 red 30-minute candles, or 3? Or no count, just "a pullback on the 30-minute chart"?
   (My replay did better with 3 or more, section 4.4.)
5. **The trigger window:** same session only, or may the next morning's break of the pivot high count?
6. **The entry:** strictly over the pivot candle's high, or may members buy the reclaim inside the turn as you did on
   DELL (527 against a pivot high of 530.43)?
7. **What is it in the course: a setup or an entry timer** for the daily setups (EMA pullback, gap support, remount)?
   And is the Model Book family "Intraday" right for a swing entry?
8. **Is the hourly higher low the same setup** on a slower clock, or its own thing?
9. **Volume:** drop "with volume" from the card (no source gives a rule), or define one?
10. **The short mirror:** teach it (D47 says shorts are our longs reversed) or leave it out until you have an example?
11. **The originator's own rules:** he is on the UCT team, so may we ask 1ChartMaster to confirm the course's wording? Or
    should you watch minutes 0:00 and 29:00 (video 52) and 5:48 (video 135) and rule from those? The "one-candle
    selectivity rule" and "invalidation rules" named in our chapter notes are only in those videos.

---

## 11. Sources (all read on 2026-11-09 unless marked)

| # | Source | Publisher / author | Date | Reliability note |
|---|---|---|---|---|
| 1 | [x.com/1ChartMaster/status/1899546078191710598](https://x.com/1ChartMaster/status/1899546078191710598) | 1ChartMaster (Elite Swing Traders) | 2025-03-11 | Originator, primary. Read via api.fxtwitter.com (x.com blocks the fetch tool). |
| 2 | [x.com/1ChartMaster/status/1910119670524367149](https://x.com/1ChartMaster/status/1910119670524367149) | 1ChartMaster | 2025-04-09 | Originator, primary; his claim to have developed it. Same route. |
| 3 | [x.com/1ChartMaster/status/1914422562051834358](https://x.com/1ChartMaster/status/1914422562051834358) | 1ChartMaster | 2025-04-21 | Originator. Same route. |
| 4 | [x.com/1ChartMaster/status/1928599320082649126](https://x.com/1ChartMaster/status/1928599320082649126) | 1ChartMaster | 2025-05-30 | Originator. Same route. |
| 5 | [x.com/1ChartMaster/status/1953110205866164700](https://x.com/1ChartMaster/status/1953110205866164700) | 1ChartMaster | 2025-08-06 | Originator; chart image viewed. Same route. |
| 6 | [x.com/1ChartMaster/status/2053625926181593509](https://x.com/1ChartMaster/status/2053625926181593509) | 1ChartMaster | 2026-05-10 | Originator's account; reads like a generated third-person summary. Same route. |
| 7 | [x.com/1ChartMaster/status/2095562525752406106](https://x.com/1ChartMaster/status/2095562525752406106) | 1ChartMaster | 2026-09-03 | Originator; HOOD chart with entry and stop viewed and checked on bars. Same route. |
| 8 | [x.com/1ChartMaster/status/2104186021789499588](https://x.com/1ChartMaster/status/2104186021789499588) | 1ChartMaster | 2026-09-27 | Originator. Same route. |
| 9 | 1ChartMaster's X profile (api.fxtwitter.com/1ChartMaster) | 1ChartMaster | read 2026-11-09 | Bio, location, join date. |
| 10 | [UCT Substack sitemap](https://unchartedterritoryy.substack.com/sitemap.xml) and all 103 posts (via the Substack post API) | Uncharted Territory | 2025-06-01 to 2026-11-08 | House, public. One post is subscriber-only (sunday-scans-bf1) and was read only as far as the API returns. The checker repeated the sweep: 103 posts on the sitemap, the phrase "30 min(ute) pivot" in exactly five of them (sections 3.2 and 6.2), none from Bracco, none in "The Parabolic Short". |
| 11 | [sunday-scans-ae1](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1) (GLW) | TSDR | 2026-06-28 | House, the owner's own section. |
| 12 | [sunday-scans-d40](https://unchartedterritoryy.substack.com/p/sunday-scans-d40) (TQQQ) | TSDR | 2026-08-30 | House, owner. |
| 13 | [sunday-scans-4c6](https://unchartedterritoryy.substack.com/p/sunday-scans-4c6) (DELL) | TSDR | 2026-10-04 | House, owner; numbers verified on bars. |
| 14 | [sunday-scans-31b](https://unchartedterritoryy.substack.com/p/sunday-scans-31b) (LITE, TEAM) | TSDR | 2026-10-11 | House, owner. |
| 15 | [sunday-scans-09b](https://unchartedterritoryy.substack.com/p/sunday-scans-09b) | TSDR | 2026-09-27 | House, owner. |
| 16 | [sunday-scans-af4](https://unchartedterritoryy.substack.com/p/sunday-scans-af4), [sunday-scans-d70](https://unchartedterritoryy.substack.com/p/sunday-scans-d70), [sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2), [sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99) | TSDR | 2026-03-15, 2025-06-29, 2025-06-22, 2025-11-02 | House, owner; related intraday rules. |
| 17 | [interview-with-1chartmaster](https://unchartedterritoryy.substack.com/p/interview-with-1chartmaster), [sunday-scans-726](https://unchartedterritoryy.substack.com/p/sunday-scans-726), [sunday-scans-461](https://unchartedterritoryy.substack.com/p/sunday-scans-461) | Uncharted Territory (unsigned) | 2025-07-11, 2025-08-03, 2025-09-14 | House; dates of the interview and of his joining. |
| 18 | [the-rest-of-the-week-39d](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d) | ChartMaster section | 2025-10-15 | House. |
| 19 | YouTube watch-page data for 9VbYA61sY0k (interview; auto-chapters), JChA7ErhE48 and iOD-jIcX46A (workshops) | Uncharted Territory / TSDR TRADING channels | 2025-07-11, 2025-09-17, 2025-09-11 | Titles, dates, lengths and chapters only; no transcript available to me. The checker re-read all three pages: "Interview w/ Elite Swing Traders (@1ChartMaster)", 50:13, chapter "The 30-minute pivot strategy" at 13:33; "1ChartMaster", 1:01:46; "1ChartMaster Workshop", 1:39:43. |
| 19a | YouTube watch-page data for _xK_MuRCvhg, mfswYu5UlX8, xYWEDyTRPuc (the three later workshops in section 5.6) | Stef / Uncharted Territory channels | 2026-01-26, 2026-02-09, 2026-02-26 | Titles, dates and lengths only (1:01:43, 1:08:36, 1:04:53); read by the checker. Their summaries are from `education_seed.py`. |
| 18a | [the-rest-of-the-week](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week) | ChartMaster section | 2025-10-01 | House; the MSFT "519-520" line (section 6.3). Added by the checker. |
| 20 | [30minpivotparty.com](https://30minpivotparty.com/) | two private individuals (footer) | undated (© 2026) | Low: a personal research site; corroborates the reading only. |
| 21 | [TradingView "30 Min Pivot Enhanced"](https://www.tradingview.com/script/cAuyXk3o-30-Min-Pivot-Enhanced/) | aniketsangwan5 | 2025-09-10 (date read by the checker) | Low: community script. |
| 21a | [TradingView "Elite 30 Min Pivot - by TenAM Trader"](https://www.tradingview.com/script/fhvOnhag-Elite-30-Min-Pivot-by-TenAM-Trader/) | TenAM_Trader | 2025-07-29, updated 2026-10-06 | Low: community script; read by the checker. Credits no one. |
| 21b | [TradingView "30 Min Pivot" (Pullback Strategy)](https://www.tradingview.com/script/refbFy4d-30-Min-Pivot/) | anonymous TradingView user | 2026-10-11, updated 2026-10-16 | Low: community script; read by the checker. Credits "@1ChartMaster (Elite Swing Trading)" and "Sean ( SrxTrades )". |
| 22 | [qullamaggie.com, "3 TIMELESS setups"](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/) | Kristjan Kullamägi | 2021 | Originator of his setups; primary. |
| 23 | ["Linda Bradford Raschke on Short Term Trading Strategies"](https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf), *AIQ Opening Bell Monthly* | David Vomund (interview), on Raschke's site | 1997-08 | Originator of the Holy Grail; primary. |
| 24 | [ChartSchool, "Pivot Points"](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/pivot-points) | StockCharts | undated | Established educator; used only to separate the homonym. |
| 25 | Zarattini, Barbon, Aziz, "A Profitable Day Trading Strategy For The U.S. Equity Market", SSRN 4729284 | as recorded in `docs/superpowers/research/setups/setup_sources.json` | 2024 | **Not read by me** (HTTP 403). Numbers unverified. |
| 26 | [Investopedia, "Opening Range"](https://www.investopedia.com/terms/o/opening-range.asp) | Investopedia (Tim Smith; reviewed by Gordon Scott, CMT) | page "Updated May 19, 2026"; read by the checker 2026-11-09 | Established educator; the `definitions.json` quote is on the page word for word. (The writer got HTTP 402.) |
| 27 | Repo: `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`, `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `app/src/components/chart/engine/ast/starterScans.json`, `api/services/pattern_engine/detectors/uct/opening_range_breakout.py`, `api/main.py`, `api/services/desk_session_insights.py`, `api/services/education_seed.py` | UCT | current branch | House code and house summaries. |
| 28 | Repo: `docs/study/sizing_rule.md` §9, `docs/study/TRADE_PLANS.md`, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`, `docs/study/UNITS-method.md`, `docs/study/UNITS-foundations.md`, `docs/curriculum/uct_method_scripts.json`, `docs/curriculum/curriculum_final_v2.json`, `docs/study/research/definitions.json`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`, `docs/superpowers/research/setups/setup_criteria.json` | UCT | current branch | House rules, rulings and drafts. |
| 29 | Repo: `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json`, `brain_kb_rules_2026-11-06.json` | UCT knowledge base (machine summaries of Discord posts) | 2024-2026 posts | House, member-only origin: substance only, no wording copied. |
| 30 | Shared research bars: Yahoo Finance 5 and 60-minute bars via yfinance, 2026-08-17 to 2026-11-06 (5-minute) | Yahoo | fetched 2026-11-09 | Unadjusted, regular hours; good enough for levels to the cent on liquid names, not audited. |

---

## 12. Examples (from our data)

**The scan (my computation, 2026-11-09; scripts `scan41.py` and `final41.py` in my scratch folder, not committed).** An
intraday setup, so it was run on the sandbox's 30-minute bars (Yahoo 5-minute bars built into 30-minute bars), which exist
only for the 1,000 most-traded names and only from 2026-08-17 to 2026-11-06; 988 of them had enough daily history, and the
whole set was scanned (no time-out). The rule, section 8 plus the house rules: on the prior day's close, price over the
50-day SMA, the 50-day over the 200-day, the 20-day EMA rising (over its value 5 sessions earlier), price $10 or more,
50-day average dollar volume $20 million or more, close not more than 10% over the 10-day SMA (C29), no earnings reaction
day within 3 sessions either side (B22), and an RS stand-in of the top 20% of the 1,000 names by 126-session return (the
app's RS rating is not in the sandbox; C31). On the 30-minute chart: a run of at least 2 red candles (close under open; the
run may start the day before), then the first green candle is the pivot; its low within 1% above, or under, the prior
day's 10-day EMA, 21-day EMA or 50-day SMA, and its close back over that level. Trigger: a later candle the same session
trades a cent over the pivot candle's high before any candle trades under its low; entry a cent over the high (or the
candle's open if it gapped over), skipped if that is more than 4% over the high (C28). Stop 3 cents under the pivot
candle's low (the originator's stop, section 8.3); skipped if the risk is over 3% (A13). One trade per stock per session,
the first trigger. Outcome walked forward on 30-minute bars for up to 20 sessions: the first of the stop, 3R and 5R.

**Base rate: 1,477 trades on 306 names, 2026-08-17 to 2026-11-06; 27.1% reached 3R and 19.7% reached 5R before the
stop.** A fixed stop with no trims and no breakeven move, so these are not the house-managed result: 90% of the trades
touched the stop at some point in the 20 sessions (the median stop was 0.84% of price), usually after the targets; 69 were
still open when the data ended. Cuts, for what they are worth (one 12-week window, one market phase): a red string of 5 or
more did best (221 trades, 32.1% to 3R, 24.0% to 5R) against 2 reds (695 trades, 25.5% and 17.6%), which repeats section
4.4's lead; the three levels came out alike (10-day EMA 27.0% to 3R, 21-day 27.6%, 50-day 26.8%); a pivot that was the
day's low did no better than one that was not (26.7% against 27.4%); the 9:30 candle as the pivot after an overnight red
string (169 trades) was the weakest and widest-stopped cut (24.9% to 3R, median risk 1.86%). The busiest days were
2026-10-08 (52 trades), 09-28 (45) and 09-29 (39): the setup fires in clusters on market pullback days, so the trades are
not independent and the true uncertainty is wider than the counts suggest. Same limits as section 4.4: Yahoo bars, no
slippage or commissions (which matter with stops this tight), today's liquid names only, the RS stand-in.

**The 10 examples (one per name; all within the 12-week window, so "different years" was not possible; charts in my
scratch folder `final/01_..10_*.png` and `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`, read by eye).** Prices in
dollars; "level" is the prior day's value; "best R" is the best reach within 20 sessions before the stop; a pivot candle's
low "under" a level means the pivot undercut it and closed back over it. None of the ten had an earnings report within 3
sessions (checked against the report dates).

| # | Ticker, pivot day | Red string, level, pivot candle | Buy (trigger) | Stop (risk) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|
| 1 | DK 2026-08-24 | 6 reds from the 08-24 open (9:30 to 12:00) into the 10-day EMA 66.48; pivot 12:30, low 66.08, closed at its high | 66.83 (13:00) | 66.05 (1.17%) | 19.8 | A 6-candle morning sell-off after the 08-21 thrust lands exactly on the rising 10-day; the pivot closes on its high and 3R comes in 6 bars |
| 2 | PSX 2026-08-27 | 5 reds into the 10-day EMA 236.78; pivot 11:00, the day's low 237.12 | 238.91 (11:30) | 237.09 (0.76%) | 21.1 | A refiner leader (RS stand-in 92): a quiet pullback onto the 10-day, the pivot is the day's low, the trigger is the next candle; 3R the next session, 5R two sessions on |
| 3 | GRAL 2026-09-14 | 2 reds into the 50-day SMA 73.27; pivot 11:00, the day's low 73.46 | 75.30 (12:00) | 73.43 (2.48%) | 48.8 | The 50-day version: a 2-week drift down to the 50 after a run, a wide pivot candle, the trigger two bars later; 3R on 09-18, then a 09-21 gap (not a report date in our data: reports 08-05 and 11-04, so a news gap) ran it to 48R. The minimum red string, so a B grade on structure |
| 4 | HALO 2026-09-16 | 4 reds into the 21-day EMA 105.22; pivot 10:00, low 105.77 | 106.65 (10:30) | 105.74 (0.85%) | 12.3 | A tight sideways base on the 21-day; the first green candle at 10:00 after the open flush; 3R in 6 bars, 5R in 2 sessions. Clean and small |
| 5 | FTNT 2026-09-18 | 4 reds (the 09-17 15:30 candle and the 09-18 open) into the 10-day EMA 165.75; pivot 11:00, low 166.95 | 168.28 (11:30) | 166.92 (0.81%) | 21.2 | A one-day shake inside a fresh advance; the pivot holds just above the 10-day; the trigger is the very next candle and the stock trends for 4 sessions |
| 6 | MRVL 2026-09-28 | 11 reds from 09-25 12:30 into the 10-day EMA 249.71; pivot 11:30, low 249.89 | 252.04 (12:00) | 249.86 (0.86%) | 22.6 | The longest red string of the ten (a day and a half of selling) ending on the 10-day in a leader (RS stand-in 98); 3R in 8 bars, 5R next day, then the 10-06 breakout. Stopped on the fixed stop long after |
| 7 | DOCU 2026-10-06 | 5 reds into the 21-day EMA 67.53; pivot 14:00 undercut it (low 66.83) and closed at its high | 68.08 (14:30) | 66.80 (1.88%) | 13.9 | The undercut-and-reclaim shape the owner's DELL and LITE trades had: a 5-candle flush through the 21-day, the pivot closes on its high; slower (3R on 10-09), 5R on 10-14 |
| 8 | VEEV 2026-10-08 | 5 reds into the 10-day EMA 278.99; pivot 10:00, the day's low 279.02 | 282.18 (10:30) | 278.99 (1.13%) | 13.7 | The pivot low sits 3 cents off the 10-day, closes near its high; the trigger is the next candle; 3R in 2 sessions, 5R in 3 |
| 9 | NOW 2026-10-16 | 6 reds from 10-15 15:30 into the 10-day EMA 140.35; pivot 12:00, the day's low 139.94 | 141.34 (12:30) | 139.91 (1.01%) | 12.7 | A hard 2-session give-back of a thrust straight to the 10-day; the pivot is the day's low; 3R by 10-20, 5R on 10-21. Stopped on the fixed stop after 12R |
| 10 | SN 2026-10-27 | 4 reds into the 10-day EMA 193.97; pivot 14:00, the day's low 193.80, closed at its high | 196.05 (14:30) | 193.77 (1.16%) | 13.0 | An afternoon pivot on the 10-day in a 2-week flat range; 3R the next afternoon, 5R on 10-30 |

Three were pivots at the 21-day or 50-day, seven at the 10-day; the stops ran 0.76% to 2.48% of price; nine of the ten
triggered on the very next candle (the DELL and HOOD way), GRAL two candles later.

**Notable failures (from the same scan, in words).** (1) **The 15:00 pivot.** AAPL 2026-10-16 (5 reds into the 10-day,
pivot 15:00, bought 343.15 at 15:30, stop 341.10) and AAPL 2026-10-26 (pivot 15:00, bought 344.07) both went nowhere and
were stopped: a pivot in the last hour has no session left to work, and 156 of the 1,477 trades were such late triggers.
(2) **The big-cap half-percent stop.** MSFT 2026-09-01 (4 reds into the 10-day, bought 501.07, stop 498.97, 0.42% risk)
reached 0.5R and was stopped; NVDA 2026-10-09 (2 reds into the 21-day, bought 230.03, stop 229.08, 0.42%) was stopped
at once; MSFT's 10-14, 10-21 and 10-22 pivots all failed the same way. On a slow mega-cap a 2-dollar stop is inside the
noise, and the setup's tight stop becomes a coin flip; the originator built it for volatile names. (3) **A broken daily
context.** INTC 2026-09-29, 10-06 and 10-07 (pivots at the 10 and 21-day, risk 0.8% to 2.8%) all stopped with no
follow-through: three stabs in six sessions on a name that had stopped trending, which rule E56 would have cut off after
the third try in a week. In every one the entry rule and the stop rule were met; the daily picture and the clock were the
difference, which is why section 9 grades those rather than the candle count.

---

## 13. Removed in checking (cold check, 2026-11-09)

Nothing had to be struck as unsourced: every quotation (about 53 from outside sources: 17 from the 8 X posts and the
profile, 20 Substack lines, 3 Pivot Party, 3 TradingView, 4 Qullamaggie, 4 Raschke, 2 ChartSchool; plus the card,
starter-scan, script, seed, curriculum, definitions, vocabulary, rulebook and verdict-log texts quoted from the repo)
was found word for word at its source, every knowledge-base note id resolved to the
note described, the scanner summary matches `opening_range_breakout.py` and `api/main.py`, and the five examples and
the replay table reproduced from the bars and event files. The following statements were wrong or incomplete and were
corrected in place (each is marked **[checked]** above):

1. "often the day's low (DELL, LITE, TEAM)" and "the usual case: DELL, LITE, TEAM" (sections 7 and 8.3): on the bars the
   pivot candle's low is the day's low only on DELL. On LITE (883.43 against 881.23), TEAM (168.73 against 168.05), HOOD
   and TQQQ it sits above the day's low, so the originator's stop and house rule A3 differ on four of the five named
   examples. Sections 3.11, 7, 8.3 and question 2 were rewritten.
2. "The strict list, in date order" (section 4.4) was the last 16 of 121 strict trades (2026-10-15 to 10-23), not the
   whole list. Reframed; the 16 lines themselves were correct.
3. "I could not find or read that script" and the TenAM Trader script's "only rule is 'the risk is defined by the pivot
   candle'" (section 3.5): the script was found and read; the quoted phrase is our `setup_criteria.json` paraphrase, not
   the page's wording. Replaced with the page's own rule text (default 3 same-colour candles; first opposite-colour
   candle; break or close over its high within 2 candles; stop on the opposite side of the pivot candle).
4. "Two UCT workshop videos cover it" (short version): two are devoted to it; three later workshops carry it in their
   library summaries, one of which states the rule ("buy the first strong 30‑min green candle after a pullback; stop at
   its low"). Added to section 5.6.
5. "HOOD fell through a string of red 30-minute candles from 2026-08-27": 08-27's 30-minute candles were mixed; the red
   run is 08-28 and the open of 08-31. Reworded.
6. Investopedia "HTTP 402, could not re-check": the checker read the page; the quote is exact. Updated in 3.6, 3.9 and
   the sources.
7. "TradingView ... not dated by me": published 2025-09-10. Dated.
8. The MSFT "519-520" quote (section 6.3) had no link and sat under a sentence about a different post; it is in the
   2025-10-01 "The Rest of the Week" (slug `the-rest-of-the-week`), ChartMaster's section. Link added.

Added by the checker (not corrections): the 2026-10-11 TradingView "30 Min Pivot Pullback Strategy", which credits
"@1ChartMaster (Elite Swing Trading)" (sections 2 and 3.5); the earnings marker on the HNGE chart (3.1, 6.5); the
`setup_criteria.json` provenance and Zarattini rows (5.4); the checker's web search for earlier uses (2); the
recomputation notes (4.3, 4.4). Still unverified by either agent: the Zarattini numbers (SSRN 403 twice), the $TEM post,
the 2026-09-30 risk post, the two workshop transcripts, and which library videos the curriculum's ids 52, 83 and 135 are
(the ids are Desk database ids, not positions in `education_seed.py`; the checker tried that mapping and it does not
hold).

## 14. Failures and near-misses (from our data)

**Built 2026-11-10 from the same scan (`final/hits.json`) and a one-gate-relaxed rerun (`near_scan41.py`, `final/near_hits.json`); charts by `fail_near41.py`, the winners' renderer: 30-minute candles, the red string boxed, the prior day's level, the buy, the stop, 3R and 5R.** Sheets: `final/fail_1-4.png` (the four failures), `final/near_1-4.png` (the four near-misses), `final/pair_40-opening-range-breakout.png` (a pivot above an ORB). All from the one 12-week window the 30-minute bars allow (2026-08-17 to 2026-11-06), so "different years" was not possible; the four failures come from four different weeks. Buy = a cent over the pivot candle's high; stop = 3 cents under the pivot candle's low. Every number is read off the bars.

**Four valid setups that lost (every gate passed, stopped before 3R).**

| # | Ticker | Date | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | AAPL | 2026-10-16 | 343.15 at 15:30 | 341.10 (0.60%) | the next session's first candle (10-19 09:30) | 5 reds into the 10-day EMA (339.05), pivot candle 15:00, low 341.13, closed near its high; the trigger was the last candle of the day. It never ticked above the buy (0.00R); the next morning's first candle took the stop. A pivot in the last hour has no session left to work; 156 of the 1,477 trades were such late triggers. | pvt.trigger |
| 2 | MSFT | 2026-09-01 | 501.07 at 13:00 | 498.97 (0.42%) | the next session's first candle (09-02 09:30) | 4 reds into the 10-day EMA (497.14), pivot 12:30, low 499.00. Reached 0.48R the same afternoon, faded into the close, and the next morning's first candle took the stop. A 2-dollar stop on a slow mega-cap sits inside the noise; the originator built the timer for volatile names. | pvt.stop_width |
| 3 | INTC | 2026-10-06 | 114.94 at 14:00 | 112.96 (1.72%) | 15:30 the same day | 3 reds into the 21-day EMA (112.63), pivot 12:30, low 112.99; the trigger came three candles later. 0.00R; the pivot low broke in the last hour. The second of three stabs in six sessions (09-29, 10-06, 10-07) on a name whose daily trend had already turned; E56 cuts the third try. | pvt.inv_context (pvt.tries) |
| 4 | AXON | 2026-08-24 | 601.49 at 13:30 | 595.08 (1.07%) | the next session's first candle (08-25 09:30) | 6 reds into the 21-day EMA (589.90), pivot 13:00, the day's low 595.11, closed in its upper half: the A+ shape. Reached 0.35R, drifted, and the next morning's first candle traded through the pivot low. Nothing in the rules was missing; a pivot low breaks about as often as it holds, and the stop is the exit. | pvt.stop |

**Four near-misses (each fails exactly one gate; the chart looks like the setup).**

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | URI | 2026-11-03 | pvt.level | pivot low 1167.55 is 2.4% above the prior day's 10-day EMA (1139.86); the rule is within 1% | A green candle floating in mid-range after 4 reds, with no daily level under it: just a green candle. Bought 1179.05 at 11:00, 0.28R, stopped the next morning. |
| 2 | CRWD | 2026-09-10 | pvt.red_string | 1 red candle before the pivot; the rule is 2 or more | A one-candle dip to the 10-day EMA (210.39), not a pullback string. Bought 211.78 at 11:00, 1.42R, stopped at 13:30 the same day. |
| 3 | MRNA | 2026-09-15 | pvt.inv_pivot_low | the 11:30 candle traded under the pivot candle's low (142.41) before the trigger at 12:00 | A void pivot: once the pivot low trades, the setup resets and needs a new red string and a new pivot. Bought 143.81, 0.00R, stopped on the trigger candle. |
| 4 | IQV | 2026-10-14 | pvt.ema20_rising | 20-day EMA 262.69 under its value 5 sessions earlier (264.36); the rule is rising | 3 reds into the 10-day EMA (261.94) in a stock whose 20-day has turned down: no daily setup under the timer. Bought 262.72 at 12:30, stop 261.60 (0.43%), 0.00R, stopped at 13:00. |

**What the failures have in common.** All four met the candle rules: a red string of 3 to 6 into a rising average, a pivot candle closing near its high, the trigger a cent over it. None ran past 0.48R. Two were stopped before the close and two on the next morning's first candle, so the overnight gap, not the 30-minute chart, took half of them; the stops sat 0.42% to 1.72% under the buy. What separated them from the ten winners was not on the 30-minute chart: the clock (AAPL's 15:00 pivot), a stop inside the stock's noise (MSFT), a daily trend that had already broken (INTC) and the plain fact that a pivot low breaks (AXON). Section 9 grades the clock, the daily picture and the stock's character ahead of the candle count for this reason, and the house exit, the fixed stop that only moves up, is what kept each loss at 1R.
