# Study, Foundations: the unit list

Phase 0 deliverable for the owner's review (spec §4.8, review R6: "what are they about"). Drafted 2026-10-17 against `docs/superpowers/specs/2026-10-17-desk-practice-interactive-education-design.md` §4.3, §4.4, §4.8, §4.8b, §4.9, §4.11, §13.3, §13.5, §13.9 and `docs/curriculum/curriculum_dossier.md` §1, §3. Nothing here is a question yet. Every row is a promise about what a unit teaches and what it needs before a question can be written.

## Preamble

1. **Audience.** Has a brokerage account and has traded a little. Unit 1 of every track still starts from first principles.
2. **Everything is open.** No locks, no gates. Foundations is recommended before the Method, never required.
3. **Test out.** Every unit has one Test-out attempt per day: one pass at the top rung skips the unit and earns its ring.
4. **Placement is optional.** About 15 questions (the dossier's 10 Y/N diagnostic plus chart questions), offered once on the end card of session 1. It suggests a starting node. It forces nothing.
5. **3 levels x 3 rungs.** Learn 1-3, Practise 1-3, Prove 1-3. Rung 1 recognises the idea on a drawing; rung 9 applies it on real bars or real numbers. Gold at rung 9.
6. **Every unit opens with 2-3 unscored walk-throughs** (owner answer §13.9 #1): the mentor walks the chart, the member taps "next". Scoring starts at Learn-2. No reading pages.
7. **Failure cases are required** in every setup-ish unit (F2b triggers, every F3 pair, every F4 unit, F5 earnings, F6 trades, F10 execution): at least one real loss traded correctly, the common trick, and what a stop-out looks like. No such unit ships without an approved loss.
8. **Formats.** Multiple choice, true/false, fill in the blank (chip bank on phones), tap the chart, scenario stories. Match-the-pairs only in the V track.
9. **Diagrams for teaching, real bars for testing.** Idealized glyphs at Learn; stored bars with the ticker hidden at Prove.
10. **Voice is the owner's** (§4.9, §13.9 #8): short sentences, first person in reveals, "the market", "the stock", "your stop", no filler. House words appear only after F1.01 teaches them.

Column key: **rungs** = what Learn / Practise / Prove each test · **drills** = §4.3 numbers (1 recall · 2 spot · 3 size · 4 regime · 6 grade · 7 levels · 8 next · 9 family · 12 autopsy · 13 plan · 14 tap · 15 scenario; V-only: match) · **data note** = thin / computed / frozen snapshot / real bars / authored.

---

## F1 · Market basics (7 units)

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F1.01 | How we talk at the desk | The house words: the dial, the band, heat, the tape, the loop, "risk against", "get involved", "follow through" | Read a Wire paragraph and know what every word means | L: word to meaning / P: fill the word into a real desk sentence / Pr: which word is the desk using here | 1, 15 | 20 quoted sentences from `edu_videos.transcript`, Substack, the toolkit (`study_terms` house-word category) | 24 | none | authored from the owner's prose |
| F1.02 | What a share is, and where it trades | Shares, tickers, exchanges, the index a stock lives in, what "the market" means at the desk (SPY, QQQ, IWM) | Say what SPY is and why we watch it before any stock | L: term / P: match ticker to what it tracks / Pr: scenario, which index moved | 1, 15 | 10 tickers from `cap_universe.json`; index bars | 18 | dossier M1 | real bars |
| F1.03 | Bid, ask and the spread | Bid, ask, last, the spread, why a wide spread costs you, how size on the book works | Read a quote and say what you would pay right now | L: define / P: compute the spread in % / Pr: pick the tradeable name from four quotes | 1, 3 | 12 authored quote cards | 20 | none | authored |
| F1.04 | Volume and liquidity | Shares traded, average volume, dollar volume, why thin names hurt, the firm's liquidity floor | Tell a liquid stock from a thin one from the volume pane | L: define / P: tap the heavy-volume day / Pr: real bars, is this tradeable at size | 1, 14 | 15 real bars (5 thin, 10 liquid), `base_catalog.liquidity_floor` | 20 | dossier M2 | real bars |
| F1.05 | Market hours and extended hours | 9:30 to 4:00 ET, premarket and after hours, why gaps print there, why fills differ | Know when a print counts and when it is a thin print | L: times / P: which session is this bar / Pr: scenario, a print at 7:40 am | 1, 15 | 10 intraday examples (~7% of symbols have intraday bars) | 18 | none | thin (intraday) |
| F1.06 | Float, shares outstanding, market cap | Float vs outstanding, cap buckets (large, mega), why a low float moves fast | Sort four names by cap and say which one gaps hardest | L: define / P: compute cap from price x shares / Pr: scenario, same news, two floats | 1, 3, 15 | 12 names from `cap_universe.json` with frozen float | 20 | none | frozen snapshot |
| F1.07 | Indexes and ETFs | What an ETF holds, sector ETFs (the 11 SPDRs), leveraged ETFs and decay, why the firm trades them at bottoms | Name the ETF for a sector and say what a 3x does in chop | L: define / P: match ETF to group / Pr: leveraged decay arithmetic | 1, 3 | 11 SPDRs + SPY/QQQ/IWM/TQQQ bars; `bottomsCatalog` "Leveraged Index ETFs" | 20 | none | real bars |

---

## F2 · Chart reading, the backbone (11 units)

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F2.01 | One bar is one day of auction | Open, high, low, close, the volume bar under it, where the close sat | Read any single day and say who won it | L: tap O/H/L/C / P: drawn bar, who won / Pr: real bar, hidden ticker | 1, 14 | 30 real bars + 10 idealized glyphs | 28 | dossier M2 "candles, bars and volume" | real bars |
| F2.02 | Timeframes | Daily, weekly, 5/30/60 minute, what one bar means on each, which one the desk reads first | Switch timeframe and know what changed | L: define / P: same stock, which timeframe is this / Pr: tap the weekly bar that holds these five dailies | 1, 14 | 15 stocks x 3 timeframes from stored bars | 24 | dossier M2 | real bars |
| F2.03 | The moving averages | The firm's stack: 9 EMA, 20 EMA, 50 SMA, 200 SMA; what each one is for; the stack in order (C20: numbers tagged by system) | Read a chart with the four lines and say which one price is riding | L: name the line / P: tap the 20 EMA / Pr: is the stack in order on real bars | 1, 14 | 40 real bars (20 stacked, 20 broken) | 32 | dossier M2 "MA stack" (CORRECTIONS: 9/20/50/200) | real bars |
| F2.04 | Trend: higher highs, higher lows | Uptrend, downtrend, range; the stage lens (1-4) on one stock; what a lower high tells you | Mark the last higher low and call the trend | L: define / P: tap the higher low on a drawing / Pr: stage a real chart | 1, 14, 15 | 30 real bars, 10 per stage shape; `base_catalog` Stage/Trend structures | 30 | dossier M2, M3 "four stages" | real bars |
| F2.05 | Volume as a witness | Volume confirming a move: breakout volume vs the 20-day average, up days on more volume than down days (C5 skill 1) | Say whether a move had a witness | L: define / P: tap the confirmed day / Pr: real bars, confirmed or not | 1, 14 | 30 real bars, half confirmed, half not; `vol_acc_ratio` | 26 | dossier M4 "volume confirmation" | computed from bars |
| F2.06 | Quiet volume: accumulation | Volume dry-up in a base, pocket pivots, volume at price nodes, VSA no-supply (C5 skill 2) | Spot a stock being bought quietly | L: define / P: tap the dry-up / Pr: real bars, is this accumulation | 1, 14 | 30 real bars from `volume_profile_nodes` and pocket-pivot detectors | 26 | dossier M6 "volume dry-up" | computed, detector-backed |
| F2.07 | Loud volume: climax and the sell signals | Climax volume, largest volume down day, churning, exhaustion gaps (C5 skill 3) | Recognise the day the crowd bought last | L: define / P: tap the climax day / Pr: real bars, hidden ticker, what came next | 1, 8, 14 | 30 real bars incl. 10 losses; Climax Top structure | 26 | dossier M9 "climax runs", M10 sell rules | computed, detector-backed |
| F2.08 | Gaps | Gap up, gap down, the four types, which ones fill, fill rates by size computed from our bars (C7) | Call a gap's type and quote the firm's fill rate for its size | L: define / P: tap the gap / Pr: given size and type, the fill base rate | 1, 3, 14 | 40 real gaps; fill-rate table from a script over `bars.db`, frozen into items | 30 | dossier M2 "gaps: the four types" | computed |
| F2.09 | Relative strength: the line and the rank | RS line (stock / SPY) vs RS rating (a percentile); RS line new high before price (C6) | Tell the two apart and read a two-series chart | L: two terms / P: tap where the RS line made a new high / Pr: real two-series chart, leader or not | 1, 14 | 30 two-series charts (stock + stock/SPY from stored bars) | 28 | dossier M2, M4 "RS line new highs" | computed |
| F2.10 | The weekly decides, the daily times | Multi-timeframe alignment; a daily setup inside a weekly trend; what a weekly bar closing strong means | Check the weekly before taking a daily signal | L: rule / P: pair the weekly with its daily / Pr: scenario, daily says go, weekly says no | 1, 15 | 20 aligned pairs, 10 conflicting pairs | 24 | dossier M2 "multi-timeframe alignment" | real bars |
| F2.11 | The Winners Gallery | 25 past leaders, no labels, just look; then guess-before-you-check reps (C4) | Have seen what a winner looks like before any rule | L: look, tap next / P: cover the answer, did it go on / Pr: 10 hidden-ticker reps, direction only | 8 | 25 Model Book winners (`/data/modelbook.db`), one ticker ≤10% (C22) | 20 | dossier M2 "Winners Gallery" | real bars, hidden ticker |

---

## F2b · Levels, lines and drawings (10 units)

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F2b.01 | Support and resistance | What a level is, why price remembers it, role reversal (old resistance becomes support) | Point at the level price is reacting to | L: define / P: tap the level on a drawing / Pr: tap it on real bars | 1, 14 | 30 real bars from the support/resistance detector | 28 | dossier M2 "the three lines that matter" | computed, detector-backed |
| F2b.02 | When a level is real | Touches, time, volume at the level, round numbers; the levels that are not worth drawing | Keep a chart to the two or three lines that matter | L: rule / P: which of four lines is real / Pr: real bars, draw only the real one | 1, 14 | 25 real bars with one real and two false levels each | 26 | dossier M2 | computed |
| F2b.03 | Overhead supply | Trapped buyers above, why breakouts fail under supply, how a base clears it | Say whether a breakout has clean air above it | L: define / P: tap the supply zone / Pr: real bars, failure case under supply | 1, 14, 8 | 25 real bars incl. 10 failed breakouts | 26 | dossier M6 "overhead supply" | real bars |
| F2b.04 | Trendlines | Connecting swing lows (or highs), two points draw it, the third proves it, the break | Draw a trendline the desk would accept | L: rule / P: tap the two anchor points / Pr: real bars, draw and call the break | 1, 14 | 25 real bars from the swing-pivot detector | 26 | dossier M2 | computed |
| F2b.05 | Channels | Parallel lines, the midline, trading at the edges, the break out of a channel | Read where in the channel price sits | L: define / P: tap the channel top / Pr: real bars, inside or broken | 1, 14 | 20 real bars | 20 | none | real bars |
| F2b.06 | Swing highs and lows: the higher low | Pivot points, the higher low as the desk's favourite sentence, lower highs as the warning | Mark the swing that matters in one tap | L: define / P: tap the higher low / Pr: real bars, is the last low higher | 1, 14 | 30 real bars (20 higher lows, 10 lower highs) | 28 | dossier M2, M7 | computed, detector-backed |
| F2b.07 | Prior day high and low | Yesterday's high and low as today's two most-watched lines, the inside day, the outside day | Draw yesterday's range before the open | L: define / P: tap yesterday's high / Pr: scenario, price reclaims the prior low | 1, 14, 15 | 25 real bars incl. 10 inside days | 26 | course M6 "premarket routine" | real bars |
| F2b.08 | Anchored VWAP | Where the average buyer since an event sits, anchoring to an earnings day or a low, why it acts as a level | Anchor a VWAP to the right bar | L: define / P: tap the anchor bar / Pr: real bars, is price above the anchored line | 1, 14 | 20 real bars with the chart's own AVWAP tool | 20 | none | computed |
| F2b.09 | The four ways we get in | BASE BREAKOUT, PREV DAY HIGH BREAK, PREV LOW RECLAIM, RED TO GREEN: the firm's four entry triggers (C4) | Name the trigger a chart is offering | L: four names / P: match drawing to trigger / Pr: real bars, which trigger printed, and one that failed | 1, 9, 14 | 40 real bars, 10 per trigger, each with one failure | 32 | Top 5 Picks "Entry Type" field; dossier M7 "entry triggers" | real bars |
| F2b.10 | The area to risk against | The stop is a level, not a number: low of day, prior day low, the pullback low, under the pivot | Pick the honest stop from the chart | L: rule / P: tap the area to risk against / Pr: real bars, stop placement vs the key | 1, 7, 14 | 30 real bars with `levels_json` stops; 10 stop-outs | 30 | dossier M5 "where the stop actually goes" | computed, detector-backed |

---

## F3 · Candlesticks (12 units)

C18 governs every row: names and the auction reading are facts; direction is never a fact. Any "what does it predict" item keys on the measured number and the reveal says "textbook says X; on our tape, measured from the next open, Y". Source grammar: `api/services/screener/candle_catalog.py` (22 shapes in `SHAPES`, 44 pairs and runs in `RELATIONS`, bias field is textbook bias by owner ruling 2026-08-24).

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F3.01 | Reading one candle | Body, wicks, colour, where the close sat in the range, "who won the session" | Describe a candle without naming it | L: tap body / wick / P: drawn candle, who won / Pr: real candle, hidden ticker | 1, 14 | 20 glyphs + 30 real bars | 28 | dossier M2 | real bars |
| F3.02 | Long and short bodies | Long white, long black, short white, short black, white/black candle; body size vs the 15-bar average (`LONG_BODY_MULT`, `SHORT_BODY_MULT`) | Say whether a body is big for this stock | L: name / P: which of four is "long" / Pr: real bars, long body or ordinary | 1, 14 | 30 real bars from the catalog's `classify_shape` | 24 | none | computed |
| F3.03 | The doji family | Doji, long-legged doji, dragonfly, gravestone; what a doji says (nobody won) | Tell the four dojis apart | L: name / P: match glyph to name / Pr: real bars, which doji | 1, 14 | 40 real bars, 10 per shape | 28 | none | computed |
| F3.04 | Umbrellas: hammer, hanging man, shooting star, inverted hammer | Same shape, four names, the name depends on the trend before it; the umbrella and inverted umbrella when trend is unclear | Name the umbrella from the shape and the trend | L: shape / P: given the trend, which name / Pr: real bars, name it, then the measured edge | 1, 14 | 60 real bars, 10 per name + 20 for trend context; the measured-edge study | 36 | none | computed; C18 |
| F3.05 | Marubozu and belt holds | White/black marubozu, bullish/bearish belt hold, shaven ends (`NEAR_ZERO_WICK`) | Spot a session with no fight in it | L: name / P: glyph to name / Pr: real bars | 1, 14 | 40 real bars | 24 | none | computed |
| F3.06 | Spinning tops and high wave | Small body, long wicks; indecision; when it matters (at a level) and when it is noise | Ignore a spinning top in the middle of nowhere | L: name / P: at a level or not / Pr: real bars, does this one matter | 1, 14 | 30 real bars, half at a level | 24 | none | computed |
| F3.07 | Engulfing and harami | Bullish/bearish engulfing, harami, harami cross, last engulfing top/bottom; the pair as one auction | Read a two-bar pair as one story | L: name / P: glyph pair to name / Pr: real bars, name and the measured edge; one failed engulfing | 1, 8, 14 | 60 real pairs incl. 10 failures | 36 | none | computed; C18 (`bullish_engulfing` is not a spot-drill setup) |
| F3.08 | Inside day, outside day, hikkake | Inside bar, outside bar, the inside-day trap (hikkake bull/bear, confirmed), three inside/outside up/down | Recognise the desk's favourite word, "inside day", and the trap behind it | L: define / P: tap the inside day / Pr: real bars, inside day then which way it broke | 1, 8, 14 | 50 real bars incl. 10 false breaks | 32 | none | computed |
| F3.09 | Piercing, dark cloud, tweezers, kicking | Piercing line, dark cloud cover, thrusting, on-neck, tweezer top/bottom, kicking bull/bear, matching low, homing pigeon, separating lines | Name a two-bar pattern from the shape alone | L: name / P: glyph to name / Pr: real bars incl. the Kicker Candle setup | 1, 14 | 70 real pairs, 5+ per name | 36 | Kicker Candle (setup 28) | computed |
| F3.10 | Stars: morning, evening, abandoned baby | Morning/evening star, doji stars, abandoned baby, tri-star; the gap that makes a star | Name a three-bar turn | L: name / P: glyph to name / Pr: real bars, name it and say what the next 5 sessions did | 1, 8, 14 | 50 real triples | 30 | none | computed; C18 |
| F3.11 | Runs and continuations | Three white soldiers, three black crows, identical crows, advance block, deliberation, rising/falling three methods, tasuki gaps, stick sandwich, two crows | Tell a run from a pause | L: name / P: glyph to name / Pr: real bars, continuation or exhaustion | 1, 14 | 70 real sequences | 36 | none | computed |
| F3.12 | What the textbook says vs what our tape measured | The measured-edge study: which names flipped sign at next-open entry, the largest surviving effect (0.79% / 5 sessions), Bulkowski vs classic on 20 of 77; why candles only count at a level | Quote the measured number instead of the textbook direction | L: the rule / P: textbook vs measured, which is which / Pr: real bars at a level, call the measured expectation | 1, 15 | the measured-edge table frozen into facts; 20 real bars at levels | 26 | none | computed; frozen |

---

## F4 · Patterns and bases (12 units)

Source grammar: `api/services/screener/base_catalog.py` (29 structures, every criterion `sourced`, `refused` or `ours`; C19: a numeric key comes only from a `sourced` criterion with the verbatim quote in the reveal). The 28 setups are the catalog of record (§13.9 #6). Supply per setup is §13.4; setups with <10 labelled examples wait on the owner's labelling queue.

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F4.01 | Why a stock rests | Cause and effect, the Darvas box (confirm 3 days, sourced), base length, the shakeout that ends it, late-stage bases | Say whether a stock has built enough cause | L: define / P: tap the base start and end / Pr: real bars, count the weeks | 1, 14 | 30 real bars (Darvas Box structure) | 28 | dossier M6 "anatomy of a base" | computed, detector-backed |
| F4.02 | Flat base and square box | Flat Base (depth criterion, sourced), Square Box, pivot and buy point, the firm's Flat Base Breakout | Draw the pivot and the stop on a flat base | L: define / P: tap the pivot / Pr: real bars, grade it; one that failed under supply | 1, 6, 7, 14 | 30 real bars incl. 8 losses from outcomes | 32 | Flat Base Breakout (setup 28); dossier M6 "flat base" | computed, medium supply |
| F4.03 | Cup with handle, saucer, cheat | Cup with Handle, Saucer, Cheat (3-C) and Low Cheat; handle depth, handle in the upper half (sourced) | Tell a proper handle from a wedging one | L: define / P: tap the handle / Pr: grade on real bars | 1, 6, 14 | 25 real bars; `cup_handle_uct` fires on 2 of 2,890, so supply comes from Model Book + labelling queue | 28 | Cup & Handle (setup 28) | thin, labelling queue |
| F4.04 | Double bottoms | Double Bottom, Ugly Double Bottom, the undercut of the first low (sourced: ≥7 weeks, second low undercuts) | Call the second low and the buy point | L: define / P: tap the undercut / Pr: real bars, is this a double bottom | 1, 14 | 25 real bars | 24 | none | computed |
| F4.05 | Volatility contraction | VCP: contractions getting smaller, volume drying up, the pivot (the sourced contraction sequence); the gold standard's 82 cases | Count the contractions and find the pivot | L: define / P: tap each contraction / Pr: grade a gold-standard case; one that failed | 1, 6, 7, 14 | 40 cases from the VCP gold standard (7 agreed positives, disagreements become grade items) + nightly detections | 36 | VCP (setup 28); dossier M6 "contraction sequence" | computed, best-supplied |
| F4.06 | Flags and tight ranges | Bull Flag, High Tight Flag (sourced: 100%+ in 4-8 weeks), Three Weeks Tight (closes within 1%), Power Play, the pole | Tell a flag from a drift | L: define / P: tap the pole and the flag / Pr: grade on real bars; a flag that rolled over | 1, 6, 14 | 40 real bars incl. 10 losses | 34 | Bull Flag, High Tight Flag (setup 28); dossier M7 | computed, medium supply |
| F4.07 | Wedges and triangles | Rising/falling wedge, ascending/descending/symmetrical triangle, the apex, Wedge Pop and Wedge Drop | Draw the two lines and name the shape | L: define / P: tap the apex / Pr: real bars, pop or drop | 1, 8, 14 | 25 real bars from the classical wedge detectors | 26 | Wedge Pop / Wedge Drop (setup 28) | thin |
| F4.08 | Pullbacks to the moving averages | 20 EMA Pullback (the firm's 20, not the detector's 21: C20), EMA Crossback, Base on Base, Ascending Base, Pocket Pivot, Launchpad (9>20>50>200) | Qualify a pullback: trend intact, volume quiet, RS holding | L: define / P: tap the touch / Pr: grade on real bars; a pullback that broke | 1, 6, 14 | 40 real bars incl. 10 losses | 34 | 20 EMA Pullback, EMA Crossback, Launchpad (setup 28); dossier M7 | computed, MA-drift trap noted |
| F4.09 | Tops and exhaustion | Climax Top, Parabolic Extension, Head and Shoulders, Rounded Top, Failed H&S; what 50-100% in days looks like when it ends | Recognise the top while it is printing | L: define / P: tap the climax bar / Pr: real bars, hidden ticker, top or pause | 1, 8, 14 | 30 real bars; Parabolic Short detector | 28 | Parabolic Long/Short, Failed H&S (setup 28); dossier M9 | computed, medium |
| F4.10 | Gaps as setups | Buyable Gap-Up, Episodic Pivot (10%+ gap on huge volume), Power Earnings Gap, Gap Support, News Gapper | Tell an EP from a gap that will fill | L: define / P: tap the gap day / Pr: grade on real bars; one that faded | 1, 6, 8, 14 | 40 real bars from EP/PEG detectors + `catalysts.db` (owner reviews each) | 34 | Episodic Pivot, Power Earnings Gap, Gap Support, News Gapper (setup 28); dossier M8 | computed, good supply |
| F4.11 | Reversals and reclaims | U&R (Undercut and Rally), Wyckoff Spring, 2B Reversal, Oops Reversal, Slingshot, Remount, Green Line Breakout, Go Signal | Spot the reclaim and know which name it carries | L: define / P: tap the undercut and the reclaim / Pr: grade on real bars; a reclaim that failed | 1, 6, 14 | 45 real bars; 2B has no detector (labelling queue) | 36 | U&R, 2B, Oops, Slingshot, Remount, Go Signal (setup 28) | computed, mixed supply |
| F4.12 | The families and the 28 | The five families, every setup placed in one, primary vs secondary vs exit-side function (C4), the two flagship setups, why nothing is perfect | Name the family first, then the setup; expect the loss | L: family names / P: 20 mixed drawings, name the family / Pr: 20 mixed real charts, family then setup, 5 are losses | 9, 2 | 60 real charts stratified by family, one ticker ≤10% | 36 | dossier M9 "four-family placement drill"; `setupCatalog.js` 5 families | real bars, hidden ticker |

---

## F5 · Fundamentals and earnings (7 units)

Every number comes from a frozen real quarter (`earnings_estimates.get_year_earnings`, FMP `stable/earnings` and `income-statement` snapshots, calendar enrichment rows). Nothing is invented.

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F5.01 | Reading a report | EPS, revenue, margins, year over year, quarter over quarter, what "beat" means | Read the four numbers on a report card | L: define / P: compute YoY from two frozen quarters / Pr: real report, beat or miss | 1, 3 | 20 frozen quarters from 10 names | 22 | course M15 adjacent; Methodology page | frozen snapshot |
| F5.02 | Estimates, surprises and guidance | Consensus, the surprise %, guidance raised or cut, why guidance moves the stock more than the print | Say why a beat gapped down | L: define / P: compute surprise % / Pr: scenario, beat but cut guidance | 1, 3, 15 | 20 frozen reports with guidance text | 22 | none | frozen snapshot |
| F5.03 | Growth numbers the desk screens for | EPS growth, sales growth, accelerating quarters, P/E and why we do not lead with it | Read a growth screen row | L: define / P: rank four names by acceleration / Pr: real frozen rows, which passes | 1, 3 | 15 frozen rows from `setup_grade.py` inputs | 20 | none | frozen snapshot |
| F5.04 | Earnings season and the calendar | BMO vs AMC, the implied move, the 4-quarter beat history, why we check the date before we get involved | Find the date and the implied move for any name | L: define / P: read a calendar card / Pr: scenario, you are long into a print | 1, 15 | 20 frozen enrichment rows (`get_implied_move`, beat history) | 22 | course M6 "earnings risk check" | frozen snapshot |
| F5.05 | Expected vs realised move | Implied move vs the actual gap, who was right, what a 2x move means (C9) | Compare the two numbers and read the surprise | L: define / P: compute realised ÷ implied / Pr: real frozen pairs, bigger or smaller than expected | 1, 3 | 30 frozen pairs | 24 | none | frozen snapshot, computed |
| F5.06 | The Earnings Decision | Hold through, trim, step aside: the firm's three answers, how size and the gain so far decide (C4) | Make the call the night before | L: three answers / P: match the case to the answer / Pr: scenario with real numbers, defend the call | 1, 15 | 20 scenarios from archive calls with a print inside the hold | 24 | course M12 "Earnings Decision" | real, archive |
| F5.07 | Post earnings: the gap and the drift | Power Earnings Gap, gap and go vs gap and fade, the drift after a big beat, where to risk against on day one | Trade the day after, or know why not to | L: define / P: tap the day-one low / Pr: real bars, hidden ticker, what happened next; one that faded | 1, 8, 14 | 30 real bars incl. 10 fades | 26 | Power Earnings Gap (setup 28); dossier M8 | computed, good supply |

---

## F6 · Options, beginner to advanced (18 units)

Full depth by owner decision (§13.9 #7). Order is the trail's recommendation only. Calc sources: `app/src/pages/journal-2-0/lib/optionCalcs.js` and `api/services/journal_two/options.py` (`VALID_STRATEGY_TYPES`: 18 types incl. `custom`; `compute_max_risk`, `compute_net_entry`). Live Greeks and chains are not in the app (CLAUDE.md: "Live options pricing + Greeks = TODO"), so Greek questions use frozen option quotes authored from real past chains.

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F6.01 | Calls and puts: the right, not the obligation | What a call is, what a put is, buyer vs seller, strike, expiry, 100 shares a contract | Say what you own when you buy a call | L: define / P: match the sentence to call or put / Pr: scenario, stock at 50, you own the 55 call | 1, 15 | 15 authored contract cards | 24 | course M15 | authored |
| F6.02 | What you pay: premium | Premium, the x100 multiplier, debit vs credit (`classifyDebitCredit`), what max loss is for a buyer | Compute what a trade costs and what it can lose | L: define / P: net entry = qty x price x 100 / Pr: real Journal-shaped legs, debit or credit and max risk | 1, 3 | 20 leg sets mirroring `computeNetEntry` | 26 | course M15 | computed |
| F6.03 | Intrinsic value and time value | In, at, out of the money; intrinsic = what it is worth now; the rest is time | Split any premium into its two parts | L: define / P: compute intrinsic from strike and price / Pr: frozen quote, how much is time | 1, 3 | 25 frozen quotes | 26 | none | frozen snapshot |
| F6.04 | Delta | How much the option moves per dollar, delta as "shares you control", delta as a rough probability | Pick the delta you want for the trade you mean | L: define / P: compute the option's move from delta / Pr: frozen chain, which strike is ~0.30 delta | 1, 3 | 20 frozen chain slices | 24 | none | frozen snapshot |
| F6.05 | Theta | Time decay, why it speeds up near expiry, what the clock costs a buyer per day | Say how much a position loses on a quiet day | L: define / P: compute a day's decay / Pr: scenario, two weeks of chop | 1, 3, 15 | 20 frozen quotes with theta | 22 | none | frozen snapshot |
| F6.06 | Vega and implied volatility | IV as the market's guess at movement, vega as the price's sensitivity to it, IV crush after earnings | Explain why a call lost money on a gap up | L: define / P: compute the vega hit from an IV drop / Pr: frozen before/after earnings pair | 1, 3 | 20 frozen before/after pairs | 24 | none | frozen snapshot |
| F6.07 | Gamma | How delta changes, why near-expiry at-the-money options move hard, gamma risk for sellers | Know when a position will start moving fast | L: define / P: delta after a move, from gamma / Pr: scenario, a 0DTE straddle into the close | 1, 3, 15 | 15 frozen quotes with gamma | 20 | none | frozen snapshot |
| F6.08 | IV and the expected move | Expected move from the straddle price, 1 standard deviation, the earnings move the market is pricing | Compute the expected move for a print | L: define / P: straddle price → expected move / Pr: frozen earnings row, expected vs realised | 1, 3 | 30 frozen enrichment rows (shares F5.05's data) | 26 | none | frozen snapshot |
| F6.09 | Picking the strike | ITM, ATM, OTM for a directional trade, delta targets, the cost of being far out, the strike as your stop's cousin | Choose a strike for a stated chart view | L: rule / P: match the view to the strike / Pr: frozen chain and a real chart, pick and defend | 1, 15 | 20 frozen chains paired with real bars | 24 | course M15 "strike, expiry and delta rules" | frozen + real bars |
| F6.10 | Picking the expiry | Weeklies vs monthlies, time to be right, theta vs cost, expiring through earnings | Match the expiry to the setup's holding period | L: rule / P: match setup to expiry / Pr: scenario, 20-day swing, which expiry | 1, 15 | 15 scenarios tied to F11 holding periods | 22 | course M15 | authored |
| F6.11 | Directional trades: long calls and long puts | Expressing a swing with a call, a put as the short side, max loss = premium, when it beats shares | Replace a share trade with a defined-risk option trade | L: define / P: compute max loss and breakeven / Pr: real chart, build the call trade with strike and expiry; one loser | 1, 3, 13 | 30 real charts + frozen chains, 10 losers | 30 | course M15 "defined-risk substitute" | frozen + real bars |
| F6.12 | Debit and credit verticals | Four verticals (`vertical_debit_call/put`, `vertical_credit_call/put`), width, max risk = width x 100 x qty ± net | Build a spread and quote its max risk | L: define / P: compute max risk from width / Pr: real chart, pick the spread; one that lost | 1, 3, 13 | 30 leg sets mirroring `computeMaxRisk` | 30 | course M15 | computed |
| F6.13 | Covered calls and cash-secured puts | Selling premium against stock or cash, the obligation, where the cap is, assignment as the plan | Sell a call against a position with eyes open | L: define / P: compute income and cap / Pr: scenario, stock runs through the strike | 1, 3, 15 | 20 scenarios | 24 | course M15 | authored |
| F6.14 | Straddles, strangles, calendars, diagonals | Non-directional and time trades, when each pays, the IV condition they need | Name the structure and its max risk | L: define / P: legs to name / Pr: frozen quotes, compute cost and the move needed | 1, 3 | 25 leg sets | 26 | Journal strategy types | computed |
| F6.15 | Iron condors and butterflies | Iron condor, iron butterfly, call/put butterfly; wings, body, max risk = wider wing x 100 x min qty + net | Build a four-leg trade and quote the risk | L: define / P: legs to name / Pr: compute max risk per `compute_max_risk` | 1, 3 | 25 leg sets | 26 | Journal strategy types | computed |
| F6.16 | Assignment, exercise and expiry | Early assignment, exercise, expiring ITM, the status words the Journal uses (open, closed, expired, assigned, rolled) | Know what happens to a position at the bell on expiry day | L: define / P: match the case to the outcome / Pr: scenario, short put assigned on a Friday | 1, 15 | 20 scenarios | 22 | Journal `VALID_STATUSES` | authored |
| F6.17 | Managing an options position | Taking profit at a target percent, rolling, closing before expiry, the 21-day rule, what a stop looks like for an option | Manage a position instead of hoping | L: rule / P: match the case to the action / Pr: scenario with real numbers, roll or close | 1, 3, 15 | 25 scenarios incl. 8 losers | 26 | course M15 | authored |
| F6.18 | Flow and dealer positioning, last | Unusual activity (size, aggression), flow as confirmation never as signal, gamma exposure and why some levels pin | Read the firm's flow pages as a second opinion | L: define / P: match a print to "unusual or not" / Pr: real flow + real chart, does the flow agree | 1, 15 | 20 frozen flow prints paired with charts; GEX snapshots | 24 | dossier M13; course Options Flow pages | frozen snapshot |

---

## F7 · Market history and macro (7 units)

History is computed from our own data: S&P and Nasdaq bars to 1974, breadth from 2008 (`/data/breadth_daily_ohlc.db`), AAII from 1987 and put/call, CNN, NAAIM (`api/data/breadth_sentiment_history.csv`), `bottomsCatalog.js` (9 bottoms 1974-2022, 6 signposts), `docs/economic-data/readiness/CATALOG.csv` (151 series in 12 categories). Regime drills use the firm's recorded tier word and never a numeric cutoff (§13.1 B2).

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F7.01 | How markets move | Bull, bear, correction, the stage lens on an index, how long each tends to last (computed from our bars) | Place today on the arc | L: define / P: stage a past index chart / Pr: real index chart cut at a date, what stage | 1, 4, 14 | 30 index charts from 1974+ | 26 | dossier M3 "staging SPY, QQQ, IWM" | computed |
| F7.02 | The fast crash: 1987 and 2020 | Drawdown, days to the low, days back to the high, what breadth and AAII did (computed) | Quote the firm's numbers for the two fast crashes | L: dates / P: read the computed table / Pr: chart cut at the low, call the regime word; what happened next | 1, 4, 8 | index bars 1987 and 2020; AAII 1987; breadth 2020; `bottomsCatalog` cases | 24 | dossier M3 "12 historical turns" | computed |
| F7.03 | The long bear: 2000-02 and 2008-09 | Lower highs for years, bear rallies, the generational low, the signposts in order | Tell a bear rally from a bottom | L: dates / P: tap the lower highs / Pr: chart cut inside the bear, is this the bottom | 1, 8, 14 | index bars 2000-03 and 2007-09; AAII; `bottomsCatalog` 2002, 2009 cases | 26 | dossier M3 | computed |
| F7.04 | 2022 and how bottoms form | The rate bear, the six signposts (capitulation, volatility peak, breadth washout, news failure, follow-through day, leadership), 9 real bottoms | Spot a signpost firing in real data | L: six signposts / P: match the signpost to its chart / Pr: real breadth + index cut at a date, which signpost just fired | 1, 4, 14 | 9 `bottomsCatalog` cases; breadth 2008+; 2022 bars | 30 | dossier M3 "follow-through days"; Model Book Bottoms | computed |
| F7.05 | Breadth: the market's X-ray | Advance/decline, % above the 50-day, new highs vs new lows, the 4% up/down days, the firm's exposure score as a tier word | Read a breadth snapshot and call the tier word | L: define / P: match the snapshot to the tier word / Pr: real past snapshot, call the recorded tier | 1, 4 | 60 dated breadth snapshots with the recorded tier (needs B2) | 32 | dossier M4; Breadth page | computed; thin until B2 |
| F7.06 | The Fed, rates and the yield curve | Fed funds, the 2s10s, inversion, what rising rates did to growth stocks in 2022 (computed from the econ catalog + bars) | Read a rate chart next to the Nasdaq | L: define / P: match the series to its name / Pr: frozen series cut at a date, what the curve was doing | 1, 15 | 20 series from CATALOG "Rates & Fed" (UST2Y, UST10Y, UST10Y2Y, USEFFR) | 22 | none | frozen snapshot |
| F7.07 | CPI, jobs and the data calendar | CPI, NFP, unemployment, release days at 8:30 ET, why the market moves on the number vs the estimate | Know which prints matter this week | L: define / P: match the release to its day / Pr: scenario, CPI comes in hot at 8:30 | 1, 15 | 33 Inflation + 24 Employment series; release semantics from CATALOG | 22 | none | frozen snapshot |

---

## F8 · Psychology and discipline (7 units)

Sources: `uct-intelligence/prompts/06_psychology.txt` (S1 Mark Douglas framework, S2 Steenbarger, S3 trader-specific lessons, S4 the four enemies and antidotes, S5 daily mental routine), `api/services/journal_two/interventions.py` (tilt rules: `rapid_fire`, `daily_loss_approach`, `loss_streak`, `cooling_off_active` + portfolio variants), the Journal tag vocabulary (17 mistakes, 15 emotions in `api/services/journal_two/tag_suggest.py`; the brief named `journal_service.py`, which is not in this worktree), 674 cited quotes (`app/src/constants/quotes.json`).

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F8.01 | Map your pattern first | Diagnose before you fix; the Five Leaks; the 17 mistake tags and 15 emotion tags as a vocabulary (C4) | Tag a trade with the right mistake | L: the tags / P: match the story to the tag / Pr: real archived trade, which tag and which rule broke | 1, 12 | 25 trade-log vault entries with a named mistake | 28 | dossier M12 "map your pattern first" | real, archive |
| F8.02 | FOMO and chasing | The fear of missing, late entry, buying extended, how the firm's "want to see a higher low" cures it | Catch yourself chasing before the click | L: define / P: which of four entries is a chase / Pr: scenario story, stock up 8% at the open | 1, 15 | 15 scenarios + 10 real extended entries | 24 | dossier M12 "FOMO and the fear family" | real + authored |
| F8.03 | Fear: freezing, hesitating, cutting winners | Hesitation, early exit, not taking the signal, Douglas's "trade without fear" frame | Tell fear from a real reason to pass | L: define / P: match the story to the subtype / Pr: scenario, the stock hits your trigger and you freeze | 1, 15 | 15 scenarios + 10 archive winners cut early | 22 | dossier M12 | real + authored |
| F8.04 | Tilt and revenge | Five subtypes, the circuit breaker, the Journal's tilt rules (rapid fire, loss streak, daily loss approach, cooling off) | Name the tilt and stop trading | L: subtypes / P: which rule fires on this sequence / Pr: scenario with a real trade sequence, what the circuit breaker says | 1, 15 | 20 sequences shaped like the intervention rules | 26 | dossier M12 "tilt and revenge trading"; Compass intervention surface | computed from rules |
| F8.05 | Euphoria and oversizing after wins | Greed, overconfidence, size creep, the four enemies and their antidotes | Keep size flat after a streak | L: four enemies / P: match the enemy to the antidote / Pr: scenario, three winners in a row | 1, 15 | 15 scenarios | 20 | 06_psychology S4 | authored |
| F8.06 | The mental hand history | Five written steps to dismantle a recurring mistake; the per-emotion template | Write one for your own last mistake | L: five steps in order / P: fill the missing step / Pr: real trade, write the hand history (saved to Notebook, scored on the five fields) | 1, 13 | 10 worked hand histories from the vault | 20 | dossier M12 "mental hand history" | authored |
| F8.07 | The daily mental routine | Before the open, during, after the close; Steenbarger's performance frame; one small improvement a day | Run the routine without a checklist | L: the steps / P: order the day / Pr: scenario, you missed the premarket routine | 1, 15 | 12 scenarios; 20 quotes from `quotes.json` (psychology tags) | 20 | 06_psychology S5 | authored |

---

## F9 · Account and risk basics (7 units)

House rule is §4.11: risk 0.25-2% chosen by quality, 2% hard ceiling, flat-risk is legitimate, stop first, size from the stop, heat ≤10%, 5-10 names, progressive exposure. `houseSizing.json` (ceiling grid by regime word and grade) is mentioned once as a cap layer, not the lesson. Sources: `uct-intelligence/prompts/03_risk_management.txt` (S1 sizing frameworks, S2 portfolio framework, S3 regime for risk, S4 risk math: expectancy, Kelly, size calculator, open heat; S5 ten rules), `portfolio_heat.py`.

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F9.01 | Risk per trade | 0.25% to 2%, chosen by setup quality, recent results and the market; 2% is the ceiling; flat risk every trade as a legitimate alternative | Pick a risk % and say why | L: the range / P: which risk % for this grade and market / Pr: scenario, after three losses | 1, 3, 15 | 20 scenarios | 24 | dossier M5 "the 2% ceiling" | authored per §4.11 |
| F9.02 | Stop first, then size | Position % = risk % ÷ stop distance %; a 1% stop at half size is 0.5% risk; if the honest stop does not fit, skip, never tighten | Size any trade in ten seconds | L: the formula / P: shares from account, risk %, entry, stop / Pr: the reverse, and the skip case | 3 | 60 generated problems (`gen_size.py` under §4.11; toolkit gate regenerated); 10/10 checkpoint set | 40 | dossier M5 "position-size formula, worked five times"; course M5 | computed; P4 100% checkpoint |
| F9.03 | R, expectancy and the marble game | The R-multiple, win rate x avg win vs loss rate x avg loss, casino math of a 45% system, a 6+ loss streak in 20 draws (C4) | Grade a system from its numbers, not its feeling | L: define R / P: compute expectancy / Pr: marble-game sequence, is this system still profitable | 1, 3 | 30 generated sequences; the toolkit R-ledger | 28 | dossier M1 "casino math", M5 "expectancy" | computed |
| F9.04 | Drawdown arithmetic and the protocol | −25% needs +33%; the drawdown protocol (−5% halve size, −10% pilot only, review); progressive re-engagement 1/4 → 1/2 → 3/4 → full (C4) | Know what a 10% drawdown costs and what to do | L: the table / P: compute the recovery % / Pr: scenario at −7%, what size now | 1, 3, 15 | 20 generated problems | 24 | dossier M5 "drawdown arithmetic", M11 "drawdown protocol" | computed |
| F9.05 | Heat and the book | Total open risk as one number, ≤10%, 5-10 names, correlation (five positions that are one trade), progressive exposure: pilot, half, full | Compute heat and say whether you can add | L: define heat / P: compute heat from four positions / Pr: scenario, can you add a sixth name | 1, 3, 15 | 25 generated books mirroring `portfolio_heat.py` | 26 | dossier M11 "portfolio heat"; course M13 | computed |
| F9.06 | Open risk after a partial | R still at risk after selling a third, the breakeven move, the trail (10/20-day for EPs: CORRECTIONS), what moving the stop does to heat (C11) | Recompute risk after every action | L: define / P: R at risk after a partial / Pr: four-step management sequence with real numbers | 3 | 40 generated `manage.math` problems | 30 | dossier M10 "the partials playbook", "breakeven rule" | computed |
| F9.07 | Margin, PDT, settlement, cash | Margin and the call, the pattern day trader rule, T+1 settlement, cash is a position (C4), why going to cash is a trade | Know the account rules before they bite | L: define / P: match the rule to the case / Pr: scenario, four day trades on a 20k account | 1, 15 | 15 scenarios | 22 | dossier M11 "cash is a position" | authored |

---

## F10 · Orders and execution (5 units) and F10b · Shorting mechanics (2 units)

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F10.01 | Market and limit orders | Market fills now at any price, limit fills at your price or not at all, when each is right | Choose the order for a breakout vs a pullback | L: define / P: match the case to the order / Pr: scenario, thin name at the open | 1, 15 | 15 scenarios | 20 | course M6 "from alert to fill" | authored |
| F10.02 | Stop, stop-limit, trailing | The stop order vs the stop in your plan, stop-limit's gap risk, trailing stops by timeframe (10-day fast movers, 20/50-day position holds) | Place the stop order that matches the plan | L: define / P: which order type for this stop / Pr: scenario, gap through a stop-limit | 1, 15 | 15 scenarios + 10 real gap-through-stop bars | 24 | dossier M10 "trailing stops by timeframe" | real + authored |
| F10.03 | Brackets and OCO | Entry + stop + target in one order, one-cancels-other, why a bracket keeps you honest | Build a bracket from a plan | L: define / P: fill the three legs / Pr: scenario, target hit, what happens to the stop | 1, 13 | 12 plans | 18 | none | authored |
| F10.04 | Slippage, partial fills, extended hours | What you lose between the trigger and the fill, partial fills on size, why extended-hours fills are different | Estimate slippage before the order | L: define / P: compute slippage in % (C16) / Pr: scenario, 2,000 shares in a name that trades 300k | 1, 3, 15 | 15 scenarios | 20 | none | authored |
| F10.05 | Scaling in and out | Pilot, half, full; adding only after the last rung paid; a third into strength; ADD vs a new trade (C4) | Build a position in rungs | L: the ladder / P: order the rungs / Pr: scenario with real bars, add or not | 1, 13, 15 | 20 scenarios + 15 real continuation bars | 24 | dossier M7 "adding to winners", M11 "the exposure ladder" | real + authored |
| F10b.01 | Shorting: borrow, locate, cover | Selling what you do not own, the locate, hard-to-borrow fees, buy to cover, the uptick history (C10) | Say what a short costs before the trade | L: define / P: compute the borrow cost / Pr: scenario, HTB name at 40% annual | 1, 3, 15 | 12 scenarios | 20 | dossier M9 "shorting as the mirror" | authored |
| F10b.02 | Short risk: squeezes and the mirror | Unlimited loss, days to cover, short interest, the squeeze, why this side is sized smallest, every long rule inverted | Size a short down and place the buy-stop | L: define / P: compute days to cover / Pr: real bars, hidden ticker, squeeze or not; one short that worked, one that got squeezed | 1, 3, 8 | 20 real bars (Parabolic Short detector) + frozen short-interest rows | 24 | dossier M9 "the short entry", "why this family is sized smallest" | computed, medium |

---

## F11 · Styles (5 units)

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F11.01 | Day, swing, position | Holding periods (hours, days to weeks, months), the time cost of each, what a bar means to each trader | Name your style from how long you held | L: define / P: match the hold to the style / Pr: scenario, which trader is this | 1, 15 | 12 scenarios + archive calls binned by hold length | 20 | dossier; `01_methodology_bible.txt` | real, archive |
| F11.02 | Which setups fit which style | ORB, 30-minute pivot, Go Signal for the day; bases and flags for the swing; stage 2 and the weekly for the position hold | Pick setups that match your clock | L: the map / P: match the setup to the style / Pr: real chart, which style would take this | 1, 9 | 28 setups binned; 20 real charts | 24 | course M11 "Intraday Toolkit" (thin intraday bars) | real; intraday thin |
| F11.03 | The firm's method in each style | Regime first in all three, then scan, setup, size, manage, review; what changes per style and what never does | Run the loop at your own speed | L: the six steps / P: order the loop / Pr: scenario, the regime word changes mid-hold | 1, 4, 15 | 15 scenarios | 20 | dossier M1 "the operating loop" | authored |
| F11.04 | Pick your lane | Personality fit, the specialization contract (one setup, two earnings seasons, 40 logged reps), why jumping between setups fails (C4) | Write your own contract | L: define / P: fill the contract's three numbers / Pr: scenario, you want to switch after six losses | 1, 15 | 10 scenarios | 18 | dossier M14 "specialization contract" | authored |
| F11.05 | Time of day and the week | The open, lunch, the close; early in the week vs Friday; earnings season vs the dead weeks; what "next week" means on a Sunday | Plan the week like the Sunday Scans do | L: define / P: match the hour to the behaviour / Pr: scenario, Friday 3:45, add or wait | 1, 15 | 12 scenarios; 10 Sunday Scans issue intros | 20 | none | authored |

---

## F12 · Process (6 units)

No taxes, by owner decision.

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| F12.01 | The written plan | The five-field card: setup, entry type, entry, stop, target (plus invalidation); a plan before a click | Write a plan the desk would read | L: the fields / P: fill the missing field / Pr: real chart, build the plan (rule-scored) | 1, 13 | 25 real charts with `levels_json` | 28 | dossier M14 "five-field template"; Top 5 Picks fields | computed, detector-backed |
| F12.02 | The daily routine | Premarket (regime, scan, watchlist, levels), midday check, the recap at the close | Run a premarket in 20 minutes | L: the steps / P: order the routine / Pr: scenario, you skipped the recap | 1, 15 | 12 scenarios; Journal day-notes shape (prep, mid-day, recap) | 20 | course M6 "premarket routine"; dossier M12 | authored |
| F12.03 | Journaling with fixed fields | The seven fields, screenshot and file by date, mistake and emotion tags, why free-form fails | Log a trade so it can be reviewed | L: the fields / P: which field holds this / Pr: real trade, fill all seven | 1, 12 | 20 trade-log vault entries | 24 | dossier M12 "fixed-field trade journal" | real, archive |
| F12.04 | Grading on three axes | Idea, execution, preparation; P&L is not a grade; a good trade that lost and a bad trade that won | Grade a winner as a bad trade | L: three axes / P: grade the story on each / Pr: real archive trade with its outcome, grade it | 1, 12 | 25 archive calls with outcomes, 10 winners-that-were-bad | 26 | dossier M12 "grading trades on three axes" | real, archive |
| F12.05 | The weekly and monthly review | Daily tag → weekly setup stats → monthly four pillars; the R-ledger; the 21-mistakes audit on the last 20 trades | Run a review that changes next week | L: the cadence / P: compute a setup's stats from 10 trades / Pr: real 20-trade ledger, which setup to drop | 1, 3 | 15 generated ledgers | 24 | dossier M12 "review cadence", "21-mistakes audit" | computed |
| F12.06 | Your playbook | The PlayBook template (play name, fundamentals, technicals, tape read, management); the best-trade write-up; two setups, written | Write the first page of your own playbook | L: the template / P: fill the missing section / Pr: real archive trade, write it up (saved to Notebook, field-scored) | 1, 13 | 10 worked write-ups from `setupPlaybooks.js` (9 full playbooks) | 20 | dossier M14 "write your playbook entries"; SMB PlayBook | authored |

---

## V · Vocabulary (13 units, one per category)

Built on `study_terms` (§4.8b). Every definition cites its source; every term has one example sentence quoted from the owner's own prose. Question styles: definition → term, term → definition, chip fill-in, match five to five (V only), tap the thing on the chart, "which word is the desk using here". Vocabulary items are first in line for the 3 due slots. Counts below are launch targets; the term bank, not this table, is the authority.

| id | title | teaches | after it the member can | rungs (L / P / Pr) | drills | examples needed (terms) | est. q | covers | data note |
|---|---|---|---|---|---|---|---|---|---|
| V.01 | House words | dial, band, heat, tape, the loop, risk against, get involved, follow through, inside day, higher low, near term, right now (the signature phrases) | Speak the desk's shorthand | L: term → meaning / P: chip fill into a real sentence / Pr: which word is the desk using | 1, match | ~60 terms from `voice_profile.json` signature phrases + wisdom vocabulary (32, with aliases) | 180 | F1.01 | authored from quotes |
| V.02 | Chart words | trend, pullback, extended, tight, coiled, leader, overbought, oversold, heavy volume, gapping, near highs (the 22 concept formulas) | Read a scan description | L / P / Pr as above, plus tap it on a chart | 1, 14, match | 22 `conceptVocabulary.json` + ~80 from the glossary and transcripts | 250 | F2 | computed where a formula exists |
| V.03 | Candle words | the 22 shapes and 44 pairs by name, body, wick, shaven, umbrella, engulf, harami, star | Name any candle the catalog can | L / P / Pr, tap the candle | 1, 14, match | 66 from `candle_catalog.py` + ~20 parts | 260 | F3 | computed |
| V.04 | Pattern and base words | the 29 structures, cause, pivot, handle, contraction, pole, apex, undercut, spring | Name any base the catalog can | L / P / Pr, tap the part | 1, 14, match | 29 from `base_catalog.py` + ~40 parts and the 89 pattern names | 300 | F4 | computed; C19 for any number |
| V.05 | Setup words | the 28 setups and their aliases (VCP, HTF, EP, PEG, U&R, ORB, Launchpad, Go Signal, Remount, Slingshot, Oops) | Read a Scans caption | L / P / Pr | 1, match | 28 + ~60 aliases from `skill_map.json` | 220 | F4.12 | authored |
| V.06 | Risk words | R, expectancy, heat, drawdown, pilot, ceiling, flat risk, structure stop, ATR stop, breakeven, trail | Read the risk section of any plan | L / P / Pr | 1, match | ~70 from 03_risk and §4.11 | 200 | F9 | authored |
| V.07 | Order words | market, limit, stop, stop-limit, trailing, bracket, OCO, fill, slippage, locate, borrow, cover, squeeze | Read a broker screen | L / P / Pr | 1, match | ~50 | 150 | F10, F10b | authored |
| V.08 | Options words | call, put, strike, expiry, premium, intrinsic, time value, the Greeks, IV, expected move, the 18 strategy names, assignment | Read an options chain and a Journal strategy row | L / P / Pr | 1, match | ~90 incl. `VALID_STRATEGY_TYPES` and `prettyStrategyType` labels | 280 | F6 | computed labels |
| V.09 | Fundamentals words | EPS, revenue, margin, guidance, consensus, surprise, YoY, BMO, AMC, implied move, P/E | Read an earnings card | L / P / Pr | 1, match | ~50 | 150 | F5 | authored |
| V.10 | Macro words | Fed funds, CPI, NFP, yield curve, inversion, SOFR, M2, PCE and the 151 series' display names by category | Read the econ calendar | L / P / Pr | 1, match | 151 series from `CATALOG.csv` + ~30 concepts | 350 | F7.06, F7.07 | frozen snapshot |
| V.11 | Breadth words | advance/decline, % above the 50-day, new highs/lows, 4% days, McClellan, distribution day, follow-through day, the tier words | Read the Breadth page | L / P / Pr | 1, match | ~70 breadth metric keys + the six signposts | 220 | F7.04, F7.05 | computed |
| V.12 | Psychology words | the 17 mistake tags, the 15 emotion tags, tilt, FOMO, revenge, hand history, the four enemies | Tag a trade from memory | L / P / Pr | 1, match | 32 tags + ~30 concepts | 180 | F8 | authored |
| V.13 | Process words | plan, routine, recap, playbook, review, R-ledger, the three axes, the seven fields, the loop's six steps | Read the Journal without a key | L / P / Pr | 1, match | ~60 Journal field names + dossier terms | 180 | F12 | authored |

---

## Unit counts

| track | units | est. questions |
|---|---|---|
| F1 Market basics | 7 | 140 |
| F2 Chart reading | 11 | 296 |
| F2b Levels, lines and drawings | 10 | 262 |
| F3 Candlesticks | 12 | 360 |
| F4 Patterns and bases | 12 | 376 |
| F5 Fundamentals and earnings | 7 | 160 |
| F6 Options | 18 | 446 |
| F7 History and macro | 7 | 182 |
| F8 Psychology | 7 | 160 |
| F9 Account and risk | 7 | 194 |
| F10 Orders and execution + F10b Shorting | 5 + 2 | 150 |
| F11 Styles | 5 | 102 |
| F12 Process | 6 | 142 |
| **Foundations F1-F12** | **116** | **≈2,970** |
| V Vocabulary | 13 | ≈2,920 at launch (target 4,000+) |
| **Total** | **129** | |

The four centre-of-gravity tracks (F2, F2b, F3, F4) hold 45 of the 116 Foundations units and about 1,300 of the questions, and every one of their units is example-heavy, as review R3 asked.

---

## Anti-repetition and accuracy rules applied

1. **No two questions test the same fact the same way.** Each unit's question list is diffed against the bank for near-duplicates before review (§4.8); the per-term diff runs in V so one word is never asked three ways in a session.
2. **Candle direction is keyed on the measured edge (C18).** F3 teaches names and the auction reading. Any "what does it predict" item keys on the measured number, and the reveal says "textbook says X; on our tape, measured from the next open, Y". `hammer` and `bullish_engulfing` are never spot-drill setups.
3. **Numbers come only from sourced criteria (C19).** A numeric key in F4 or V.04 comes from a `sourced` criterion in `base_catalog.py` with the verbatim quote in the reveal. `origin="uct"` numbers are asked as "the firm's number". Nothing from `trading_principles.json` is a key until matched to a sourced criterion.
4. **Moving-average numbers are tagged by system (C20).** "The firm's" questions use 9 EMA / 20 EMA / 50 SMA / 200 SMA only. A 10/21/50 or 150/200 number appears only in a question that names the trader. EP trailing is the firm's 10/20-day.
5. **Percent and bar index, never dollars (C16).** `bars.db` is split-adjusted. Prompts and keys carry percent-from-reference and bar index wherever the question allows; every chart item records `adjustment_basis`.
6. **History is computed from our data (F7).** Drawdowns, days to the low, breadth and sentiment readings come from our index bars, `breadth_daily_ohlc.db` and `breadth_sentiment_history.csv`, frozen into item facts by script. Regime calls use the recorded tier word, never a numeric cutoff.
7. **Fundamentals are frozen real quarters (F5).** Every EPS, revenue, estimate and implied move is a real row from the FMP snapshots and the calendar enrichment, frozen with its date. No invented reports.
8. **Hidden tickers for "what happens next" (C21).** At least half of `next` items per skill come from non-famous names with the ticker hidden; mastery counts hidden-ticker items only.
9. **One ticker is at most 10% of a segment (C22)**, and a detector-backed example is used only when the named detector fires.
10. **Every number in a reveal is in the item's facts** (importer check, §4.9).

---

## Gaps for the owner

**Content a swing, day or position trader needs that no unit above covers:**

1. **Sector and theme rotation** (C8). Which group led the last four weeks, is this name in a leading group. The data exists (`themes_taxonomy.json`, 11-SPDR flow, `leading_sectors.json`) but the spec places it in the Scan station, not Foundations. Suggest an F2.12 "Group before stock" if you want it taught before the Method.
2. **Market internals beyond breadth**: VIX and the volatility regime, the put/call ratio, NAAIM, CNN fear/greed as sentiment reads. `03_risk_management.txt` S3 covers VIX; sentiment keys exist in the CSV. Could be F7.08 "Fear gauges" or fold into F7.05.
3. **Intraday mechanics for day traders**: the opening range, VWAP (session, not anchored), the 30-minute pivot, the first-hour reversal. Intraday bars exist for ~7% of symbols, so this is thin by data, not by design. F11.02 names the setups; nothing drills them. Owner answer §13.9 #5 keeps them in the catalog with a hand-labelling queue.
4. **Reading the Sunday Scans and the Wire** as documents: what the five-field card means in a real issue, how a Scans caption maps to a setup. F11.05 touches it. A "Read a Scans issue" unit would be the bridge to drill 5.
5. **Taxes** are excluded by your decision. Wash sales affect position management for anyone trading the same name twice in 30 days; recorded here so it is a conscious omission.
6. **Crypto and futures basics** (BTC, ES/NQ, the COT page). The Breadth page carries COT data for 62 symbols. Not in any track. Probably right for v1.
7. **Selling into strength vs into weakness** is split across F9.06 and F10.05 as math and execution. The dossier's M10 "selling because you were wrong vs right" is a psychology-of-exits lesson with no home. Suggest F12.07 "Two reasons to sell" or an F8 unit.
8. **The Method psychology skill** (C4: per-emotion templates in the Method) is outside Foundations; F8.06 carries the template so the Method can reuse it.

**Units where data is thin, and what would fix each:**

| unit | why thin | fix |
|---|---|---|
| F1.05, F11.02, the ORB / 30-minute pivot / Go Signal setups | intraday bars for ~7% of symbols | owner labelling queue; or author from the Desk video chapters (`ticker_moments`) |
| F4.03 Cup with handle | `cup_handle_uct` fires on 2 of 2,890 symbols | Model Book + labelling queue; Phase 0 measures `modelbook_setup_examples` per setup first |
| F4.07 Wedges | classical wedge detectors only, Wedge Pop/Drop have playbooks but no detector | labelling queue |
| F4.11 2B Reversal, F4.10 News Gapper, F4.09 Parabolic Long, 30-Minute Pivot | §13.4 "none" | ship only after the owner labels ≥10 each |
| F4.02, F4.08 losses | losses come from outcomes only, never "the stock went down" | archive calls with explicit entry/stop/outcome first; `failed` detections whose stop was the detector's stop second |
| F7.05 breadth tier calls | the tier word is not stored in the wire archive (§13.1 B2) | B2 must land before any regime item is written; until then F7.05 is Learn-only |
| F7.02, F7.03 for 1929 and 1973-74 | index bars start 1974; no breadth before 2008, no AAII before 1987 | 1929 and the first half of 1973-74 can only be authored, not computed; label them as such or drop them from the "computed" claim in §4.8 |
| F6.04-F6.08 Greeks | no live Greeks, chains or IV in the app | author from real past chains frozen by hand; every quote dated; owner reviews the first 20-30 before auto-approve |
| F6.18 flow and dealer positioning | GEX and flow snapshots exist on the Options Flow pages but are not frozen as study items | a `gen_flow.py` that freezes dated prints with their chart |
| F10b.02 short interest, days to cover | no short-interest source in §5.1 | frozen rows from a provider (FMP or Finnhub) or author from named past squeezes |
| F8.01, F12.03, F12.04 | the trade-log vault is 10 trader sections, not 100 trades | the team archive (`wisdom_archive_calls`) fills the gap once outcomes are attached; member journals are opt-in later |
| V.01 house words | the example sentence must be the owner's own prose | the term bank needs a quote-harvest pass over transcripts, Substack and the toolkit before V.01 is written |
| Every F3 pair with a measured edge | the measured-edge study covers 77 patterns; effects are small (largest 0.79% / 5 sessions) | the reveal always shows the number and the sample size; no F3 item claims an edge larger than the study measured |

**One bookkeeping note.** The brief cited the mistake taxonomy at `api/services/journal_service.py`. In this worktree that file does not exist; the 17 mistakes and 15 emotions live in `api/services/journal_two/tag_suggest.py` (`STANDARD_MISTAKES`, `STANDARD_EMOTIONS`), mirrored in `PortfolioSettingsModal.jsx` and `RapidTagFlow.jsx`. F8 and V.12 cite that path.
