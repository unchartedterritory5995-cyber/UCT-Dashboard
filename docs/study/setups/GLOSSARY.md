# Glossary of shared measurable terms (Study setup criteria)

Deliverable 3 of `CRITERIA_PROGRAMME.md`. The 44 dossiers in `research/` propose their rules in section 8, and the same
idea comes out in different words and numbers: "prior trend" is 30% over 65 sessions in one and 25% off the 52-week high
in another; "tight" is closes within 3% in one and a range under 0.85 times the prior range in another; "high volume"
is 1.2x, 1.4x, 1.5x, 2x, 3x or 10x of three different averages. Questions built from different units contradict each
other. This file gives each shared term one canonical definition with its threshold and timeframe, says where it
comes from, shows how every dossier words it, lists the setups that keep a different number and why, and names the
conflicts that still need a ruling.

**How the criteria cards use it.** A criterion in `criteria/NN-slug.json` points at a term with `"glossary": "<id>"`.
The id is the `### <id>` heading below (snake_case). `scripts/study/criteria_lib.py` refuses an id that is not a
heading here. A card that keeps a different number from the canonical one says so in its own `statement` and
`measure`; the glossary lists it under Overrides.

**The rulebook wins.** Where `docs/study/sizing_rule.md` section 9 (the 71 account rules, A1 to F69) settles a term,
that rule is the definition and the glossary says so. Where a dossier's number differs from the rulebook, the
rulebook stands and the difference is recorded as an override or a conflict. `docs/study/TRADE_PLANS.md` (the trims,
the Go Signal, the Kicker ruling) and the course vocabulary already taught in `docs/study/courses/V/*.json` (ATR is
Wilder's 14-day; the opening range is the first 30 minutes of day one; RVOL; distance from a moving average) are the
next authority. Nothing here is a ruling: every "ours" is a proposal for the owner.

**Conventions.** Dossier numbers are `01` to `44` as in `research/`. "Session" is a trading day (see `session`).
Every number is quoted as its dossier states it. Where no dossier gives a number the entry says "no number yet" and
proposes one marked **ours**. Rulebook ids are `A13`, `B26` and so on.

**Counts.** 43 terms. 44 conflicts across dossiers (the full list, ordered by how many units each touches, is the last
section). Read for this file: all 44 dossiers' sections 7 and 8, the rulebook's section 9, `TRADE_PLANS.md`,
`app/src/constants/setupGroups.js`, the V course files. Written 2026-11-09.

---

## The terms

### session

**Canonical definition.** One session is one regular trading day, 9:30 to 16:00 ET; every count in a criterion is in
sessions unless the card says "calendar days". Equivalents used in the cards: 1 week = 5 sessions, 1 month = 21,
3 months = 63, 6 months = 126, 1 year = 252.

**Basis.** Dossier 01 ("'Session' = a trading day"); C33 says "10 trading days"; E58 limits buys to regular hours.
The month equivalents are the dossiers' most common choices (18: 63 sessions for 1 to 3 months; 20: 126 sessions
for 6 months; 05 and 10: 252 for a year). The 21 for one month is ours (06 and 12 both read "at least one month" as
21 sessions).

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "the 65 sessions before it", from Kullamägi's "past 1-3 months" | 65 |
| 04 | "the prior 6 months (about 120 trading days)" | 120 |
| 06 | "the 6 months before it"; the app uses "60 bars at 20% and 120 bars at 30%" | 120 |
| 06, 12 | "at least 1 month" read as "21 sessions" | 21 |
| 18 | "inside the last 63 sessions" for "past 1-3 months" | 63 |
| 20 | "126 sessions (6 months)"; "63 sessions earlier" | 126, 63 |
| 05 | "the first 25 trading days"; "the first 252 sessions (about a year)" | 25, 252 |
| 10 | "the 252 sessions before the trigger" | 252 |
| 07, 11 | B22's "3 days": "without saying trading or calendar days" | open |
| 33 | "15 to 100 trading days" | 15, 100 |

**Overrides.** None. The intraday setups (40, 41, 42, 44) count bars inside the session (see `opening_range` and
`hourly_bar`).

**Conflicts to settle.** Three months is 65 sessions in 01 and 63 in 18; six months is 120 in 04 and 06 and 126 in
20. Ours: 63 and 126 as the shared equivalents; a card that keeps 65 or 120 says so and the question bank treats
them as the same window. B22's "3 days" is settled under `earnings_blackout`.

### atr

**Canonical definition.** ATR is Wilder's 14-session average true range, in price, taken on the session before the one
being judged; "N ATR" means N times that value. The true range includes gaps (high to low, high to the prior close,
low to the prior close, whichever is largest).

**Basis.** The dossiers' most common choice: 11, 12, 13, 17, 19, 22, 27, 28, 31, 32, 34 and 36 all define ATR as
the 14-day average true range. Course V.06 teaches Wilder's ATR "usually over 14 days".

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 11, 12, 13, 17, 19, 28, 31, 32 | "ATR = the 14-day average true range" | 14 |
| 22 | "1.5 times the 14-day ATR" (Kullamägi names no length; 14 is the dossier's choice) | 14 |
| 27 | "at least 1 ATR(14) or 4%, whichever is smaller" | 14 |
| 34, 36 | "2 ATR(14)" | 14 |
| 18 | Reversal Extension: "at least 2 ATR(20) under the 10 EMA" | 20 |
| 38 | "at least 3 ATR(20) under the 50-day SMA" | 20 |
| 21 | "at least 0.75 x the 40-day ATR" (Morales and Kacher) | 40 |
| 39 | Jeff Sun's multiple: "percent over the 50-day SMA divided by the 14-day Wilder ATR as a percent of price" | 14 |
| 06 | ChartMill: a stop "not below 1 times the ATR" | 14 (implied) |

**Overrides.** 38 keeps ATR(20) for the capitulation stretch (Bracco's reading); 18 keeps ATR(20) for Kell's Reversal
Extension; 21 keeps the 40-day ATR because it is the originators' own number for the PEG gap floor.

**Conflicts to settle.** Three lengths are in use (14, 20, 40). Ours: 14 everywhere, except where a card quotes an
originator's own length and says so in the statement.

### adr

**Canonical definition.** ADR is the 20-session average of (high divided by low, minus 1), in percent of price. It
measures the day's range without gaps; ATR includes them.

**Basis.** 18 (Kullamägi: "Record ADR (20-day average of high/low, minus 1)"), 03 ("ADR%: the 20-day average of high
minus low, as a percent of price; the 20-day window is my proposal"), 01 ("its average daily range, over 20 sessions
as my proposal").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "the stock's ADR (its average daily range, over 20 sessions as my proposal)" | 20 |
| 02 | "average daily range (high minus low, as a % of the close)" | no window |
| 03 | "ADR%: the 20-day average of high minus low, as a percent of price" | 20 |
| 09 | "the average daily range is smaller than the 20-session average" | 20 |
| 14 | "more than the stock's average daily range" | no window |
| 18 | "20-day average of high/low, minus 1" | 20 |
| 20 | "within 1x the stock's ADR" | no window |
| 22 | Kullamägi's "1 to 1.5 times ADR/ATR cap", read as "1.5 times the 14-day ATR" | 1.5 ATR |
| 41 | "wider than the stock's average daily range" | no window |

**Overrides.** None.

**Conflicts to settle.** Kullamägi's stop cap is read as 1 ADR by 18 and 20, as 1.5 ATR by 22. Ours: 1 ADR, the
reading of the Qullamaggie dossier (18); see `stop_width`.

### prior_trend

**Canonical definition.** Before a base setup, the pattern's first high (the left-side high) is at least 30% above
the lowest low of the 65 sessions before it, and the close is above the 200-day SMA (B26). A pullback setup needs the
trend, not the measured gain: the order and slope of the averages stand in (see `rising_average`).

**Basis.** 01: the originator's number (IBD, "a prior uptrend of at least 30% in price", stated for all bases), with
source consensus (TraderLion 30%, Kullamägi 30% to 100%+ in 1 to 3 months); the 65-session window is 01's proposal
from Kullamägi's "past 1-3 months". 04 and 06 use the same 30%. The 200-day is B26.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | left-side high "at least 30% above the lowest low of the 65 sessions before it"; options 20% (O'Neil via Bonde), 25% (`flat_base.py`) | 30% / 65 |
| 02 | pole: "a gain of at least 20%" from the lowest low of the 20 sessions before the pole top; 30% an A+ cue | 20% / 20 |
| 03 | pole: "rises at least 90%" within 40 sessions; 100% the A grade | 90% / 40 |
| 04 | "rose at least 30% from its lowest low of the prior 6 months (about 120 trading days)" | 30% / 120 |
| 06 | Trend Template (close above 150 and 200; 150 above 200; 200 higher than 21 sessions ago; 50 above both; within 25% of the 52-week high; at least 30% above the 52-week low, the 2017 book says 25%); first high "at least 30% above the lowest low of the 6 months before it" | 30% / 6 months |
| 07 | the reverse: "a real correction first", the lowest close of the last 60 sessions at least 15% under the highest high of the 60 before | 15% |
| 10 | the reverse: a Stage 4 decline, the 150-day lower than 20 sessions earlier and price under it | n/a |
| 11 | a real advance: "the close was at least 1.5 ATR above the 20 EMA within the prior 10 sessions"; options 30% in 1 to 3 months, a breakout within 2 months | 1.5 ATR |
| 12 | "within 25% of its 52-week high"; 200-day rising for at least 21 sessions; 20 EMA above 50 SMA above 200 SMA; a breakout or gap within 3 months | 25% |
| 18 | "A rise of 30% or more from a low to a later high, both inside the last 63 sessions, made in 3 to 20 sessions" | 30% / 63 |
| 20 | the reverse: neglect, the close before the gap "no more than 25% above its close 126 sessions earlier" | 25% |
| 24 | "Prior trend: none required" | none |
| 33 | the head "at least 25% above the lowest low of the 6 months before the left shoulder" | 25% |
| 36 | form A "up at least 25% in the prior 1-3 months" | 25% |
| 14, 17, 41, 42, 43 | average order and slope (9 above 20; 20 EMA rising; above the 50 and 200) | n/a |

**Overrides.** 02 (the flag's pole is 20%, its own definition), 03 (the HTF pole is 90%), 06 (the Trend Template is
Minervini's and stays as the VCP's own gate), 12 and 36 (25%), 33 (25%), 11, 14, 17, 41, 42, 43 (a pullback is
defined by its averages), 07 and 10 (a correction or a decline comes first), 20 and 24 (neglect or nothing).

**Conflicts to settle.** The number (30 against 25 against 20) and the window (65 against 63 against 120 or 126
against the 52-week high). Ours: 30% over 65 sessions for every base setup, with the Trend Template allowed as an A+
cue on any card; the 25% figures stay where the dossier's originator says 25%.

### base_length

**Canonical definition.** A base or pullback is counted in sessions from the left-side high (the pattern's first high)
to the session before the trigger. Each base setup keeps its own floor and ceiling; the glossary fixes only how to
count.

**Basis.** 01 (IBD and MarketSmith's counting rule, "from the left-side high to the day before the breakout"); the
other dossiers count the same way.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "At least 25 sessions (5 weeks)"; "at most 65 weeks"; option 15 sessions (the owner's examples, Kullamägi 2 weeks) | 25 to 65 weeks |
| 02 | "3 to 15 sessions after the pole top"; 16 to 20 B- at best; more than 20 "not a flag; judge it as a base" | 3 to 15 |
| 03 | "5 to 30 sessions after the pole high. 10 to 25 is ideal" | 5 to 30 |
| 04 | cup "At least 7 weeks including the handle (35 trading days), at most 65 weeks"; handle "At least 5 trading days", over about 22 graded down | 35 to 65 weeks |
| 05 | "At least 10 sessions from the left-side high to the trigger"; options 7, 10, 15 | 10 |
| 06 | "at least 15 sessions (3 weeks)"; no upper limit | 15 |
| 07 | "at least 25 sessions (5 weeks) of closes within 10% of the bundle's middle" | 25 |
| 09 | trigger "at least 15 sessions after the first anchor; best between about 20 and 120" | 15 |
| 10 | "At least 15 sessions from the cycle low to the trigger" | 15 |
| 11 | pullback "2 to 15 sessions from the swing high" | 2 to 15 |
| 12 | "2 to 8 sessions of pullback" | 2 to 8 |
| 14, 17 | "about 2 to 10 sessions" | 2 to 10 |
| 18 | "10 to 40 sessions"; Base n' Break "5 to 15 sessions (1-3 weeks)" | 10 to 40 |
| 31 | "at least 3 consecutive daily closes under the line, and at most 7" | 3 to 7 |
| 32 | "At least 5 consecutive closes under it ... and at most 30" | 5 to 30 |
| 33 | "15 to 100 trading days" | 15 to 100 |
| 35 | "at least 20 sessions" | 20 |

**Overrides.** Every setup keeps its own; these numbers are the pattern's identity.

**Conflicts to settle.** 01's 25 against the owner's 15-session examples (01 question 3). 02's ceiling (15, then
"not a flag" past 20) overlaps 03's 5 to 30 and 18's 10 to 40: the same two to four-week rest can be a flag, an HTF
or a Qullamaggie base. Ours: the pole decides (a 90% pole makes it an HTF, a 20% pole a flag, anything else a base),
and a rest over 20 sessions with no pole is judged as a base, as 02 proposes.

### base_depth

**Canonical definition.** Depth is (highest high minus lowest low) divided by the highest high of the pattern, in
percent, on intraday extremes. Each base setup keeps its own ceiling.

**Alias accepted on the pilot card:** **id:** `depth`. New cards use the heading id.

**Basis.** 01 (IBD and MarketSmith: "from the left-side high to the lowest intraday low, divided by the high"); the
dossiers' most common measurement.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "At most 15%"; "10% or less as the A+ version" | 15% |
| 02 | "at most half of the pole" and "at most 15% below the pole top"; a third and 10% an A+ cue; the app half the pole and 12% | 15% |
| 03 | "at most 25%"; 10% to 20% the A-grade zone | 25% |
| 04 | cup "12% to 33%", 33% to 35% graded down, up to 50% in a bear market; handle "At most 12%", 8% better, about 5% best | 33% |
| 05 | "At most 35%", under 20% for A+; options 20%, 35%, 50% | 35% |
| 06 | first T "10% to 40%"; final T "10% or less"; each T "at most 0.75 times" the previous; never a fall of 60% or more | 40% |
| 07 | "the last 30 closes span no more than 20% of price" (the finder allows 22%) | 20% |
| 09 | lowest low "no more than 35% below the first anchor high" | 35% |
| 10 | cycle low "at least 30% under the 52-week high" (a decline, not a base) | 30% |
| 18 | "25% or less and no more than half of the prior move"; A+ 15% or less; the scanner 15%; the owner's MRAM "roughly 34-42%" | 25% |
| 26 | "the last 20 closes span 15% or less" | 15% |
| 31 | "5% to 12%"; the rule record says 5% to 9% | 12% |
| 33 | head to neckline "5% to 30%" | 30% |
| 35 | range height "6% to 20%" | 20% |

**Overrides.** Every setup keeps its own.

**Conflicts to settle.** 18's 25% cap rejects the owner's "textbook 5 star" MRAM (owner to rule before it is taught).
02's 15% ceiling against 03's 10% to 25% zone: a 20%-deep rest is an HTF only when the pole doubled. 31's 5% to 12%
against the rule record's 5% to 9% (31 question 5). Ours: keep each dossier's number; the boundary cases go to the
owner.

### left_side_high

**Canonical definition.** The left-side high is a base's first high: the highest intraday high of the 100 sessions
before the base, and the base's first week reaches within 3% of it. Every base count (length, depth, prior trend)
starts there. A base can break out below it (a VCP's pivot may sit lower); a flat base cannot.

**Basis.** 01 ("At the left-side high: the highest intraday high of the last 100 sessions [originator: MarketSmith].
The base's first week reaches within 3% of that high [UCT code: `base_catalog.py`]"); 06 for the pivot below it.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "the highest intraday high of the last 100 sessions"; the first week "within 3% of that high" | 100; 3% |
| 04 | the cup is measured "from the left-side high"; "For a cup without a handle: the pivot is the left-side high" | n/a |
| 05 | the IPO high: "the highest high since listing (the IPO high), with no close above that high since it formed" | since listing |
| 06 | "The pivot may sit below the base's left-side high" | n/a |
| 09 | the line starts "at its highest high (the left-side high)" | n/a |
| 10 | "the 52-week high is the highest high of the 252 sessions before the cycle low" | 252 |
| 19 | the anchor: "the highest high of the last 150 sessions, at least 20 sessions old" | 150; 20 |
| 27 | the top: "A 250-session closing high (the top) set within the prior 80 sessions" | 250; 80 |

**Overrides.** 19 and 27 (an anchor or a top is a different idea from a base's first high and keeps its own lookback);
05 (since listing); 10 (the 52-week high).

**Conflicts to settle.** The lookback that makes a high "the" high: 100 (01), 150 (19), 250 or 252 (10, 27). Ours:
100 for a base's left-side high; the anchors and tops keep theirs and a card names which it means.

### pivot

**Canonical definition.** The pivot is the price level whose trade-through is the breakout trigger: the highest
intraday high of the base, or of the pattern's final part where the setup names one (the handle, the final
contraction, the flag's high, the stall's high). The trigger is a trade above it during regular hours (E58), bought at
market (E57); IBD's 10 cents above it is not used.

**Basis.** 01 ("the highest intraday high of the base [originator: MarketSmith]. IBD adds 10 cents; with market orders
the 10 cents does not matter [house rule E57]"); the rulebook (E57, E58); the other base dossiers for their own
pivots.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "the highest intraday high of the base"; the early pivot "a lower ceiling inside the base touched three times" (IBD S3) as a variant | base high |
| 03 | "the highest high of the whole pattern (usually the pole top; if the flag made a higher high, that one). Never a break of a trendline drawn inside the flag" | pattern high |
| 04 | "the highest price in the handle"; a cup without a handle: the left-side high | handle high |
| 05 | "the left-side high (the IPO high). IBD sets the buy point 10 cents above it" | IPO high |
| 06 | "'Pivot' means the high of the final T"; "The pivot may sit below the base's left-side high" | final T high |
| 15 | "the high of the base (short-term resistance)" | base high |
| 18 | "the consolidation high"; Base n' Break "through the pivot into new highs" | consolidation high |
| 16 | the mirror: "close under the low of the stall (the pivot)" | stall low |
| 33 | "the right-shoulder high (for a rounded top, the dome high)" | shoulder high |
| 13, 32 | the detector's "pivot" is the reclaimed line, not a pattern high | the line |

**Overrides.** Every breakout setup names its own pivot; 13 and 32 use the word for a line.

**Conflicts to settle.** None between dossiers; a card names its pivot and says whether it may sit below the
left-side high (06 yes, 01 no).

### ceiling

**Canonical definition.** A ceiling (a flat top) is a level touched by two or more separate highs within 0.5 ATR of
it, the touches at least 5 sessions apart and the first at least 10 sessions before the trigger; three or more
touches is the A+ version. A floor is the mirror.

**Basis.** 01 ("Two or more separate touches of the top, within 0.5 ATR, the first at least 10 sessions back [UCT code:
the lab's frozen flat-top rule]. Three or more taps as the A+ version is my proposal [FUTU '3rd tap', RDDT '3 taps';
Bulkowski's rectangle 'should touch one trendline at least three times']"); the 5-session spacing is 09's and 35's.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "Two or more separate touches of the top, within 0.5 ATR, the first at least 10 sessions back"; three or more A+ | 2 (3); 0.5 ATR; 10 |
| 09 | "At least 2 swing highs on the line to draw it; 3 or more for an A grade. A touch is a swing high within about 0.25 ATR of the line"; "Anchors at least 5 sessions apart" | 2 (3); 0.25 ATR; 5 |
| 35 | "a flat floor touched at least twice (two swing lows within about half an ATR of the range low, at least 5 sessions apart). Three or more touches grade higher" | 2 (3); 0.5 ATR; 5 |
| 01 | the early pivot: IBD's "at least three points along the top" | 3 |

**Overrides.** 09 (0.25 ATR, the scanner's tolerance for a sloping line).

**Conflicts to settle.** The tolerance (0.5 ATR in 01 and 35 against 0.25 ATR in 09) and the spacing (the first touch
10 sessions back in 01 against anchors 5 apart in 09 and 35). Ours: 0.5 ATR for a flat level, 0.25 ATR for a sloping
line, touches 5 sessions apart and the first 10 sessions before the trigger.

### flat_drift

**Canonical definition.** A base is flat when the least-squares line through its closes moves, from start to end, no
more than 10% of the base's average close (two thirds of the 15% depth ceiling). A U shape inside that drift is
allowed.

**Basis.** 01 ("[UCT code: `base_catalog.py` `FLAT_MAX_DRIFT`, derived from IBD's sideways shape]. A U-shaped flat
base is allowed [originator: IBD S1]").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "moves no more than 10% of the base's average close from start to end" | 10% |
| 35 | "No clear slope: the closes drift less than a quarter of the range height" (the app drawing's rule) | quarter of the range |
| 04 | the handle: "a straight line fitted through the handle's daily lows slopes flat or down" | flat or down |
| 02 | the flag: "Sideways or drifting down, with lower or level highs. Not up-sloping" | flat or down |
| 07 | "closes within 10% of the bundle's middle" | 10% |
| 09 | "Not 'wedging up' (rising lows into the line on shrinking volume)" | not up |

**Overrides.** 02, 04 and 09 (flat or down, never up: the flag's and handle's own shape rule), 35 (the range's own
rule).

**Conflicts to settle.** 10% of the average close (01) against a quarter of the range height (35): on a 15%-deep base
the quarter is about 3.75% of price, far stricter. Ours: 01's rule for a base, 35's for a Wyckoff trading range, and
the two cards' lookalike lines say so.

### wide_and_loose

**Canonical definition.** A base has turned wide and loose when the average daily range of its last 10 sessions is
larger than that of its first 10 sessions; the opposite of `tight`. An invalidation before the trigger on a base card;
a grade-down where the dossier says so.

**Basis.** 01 ("the average daily range of the last 10 sessions is larger than that of the base's first 10 sessions
[the test is my proposal; UCT: DAVE 'too lose and wide'; TraderLion: 'Wide and loose bases are a big sign of real
danger.']").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "the average daily range of the last 10 sessions is larger than that of the base's first 10 sessions" (invalidates) | ratio > 1 |
| 02 | "Calling a deep, loose, jagged pullback a flag" (a mistake) | n/a |
| 03 | "IBD lets the daily ranges be loose if the closes are tight, so the test is on closes" | n/a |
| 06 | "A T as deep as, or deeper than, the one before ('wide and loose')" (invalidates) | ratio >= 1 |
| 16 | TraderLion's NVDA chart "labels 'Wide And Loose Price Action' and still marks a Wedge Drop out of it"; "Grade it down (section 9) rather than exclude it" | grade down |

**Overrides.** 06 (each contraction against the one before, the VCP's own test), 16 (a grade-down, not an exclusion).

**Conflicts to settle.** An invalidation (01, 06) against a grade-down (16). Ours: an invalidation on base cards, a
grade-down on the Wedge Drop, as 16 chose.

### base_count

**Canonical definition.** The base count is the number of bases since the last stage reset: a breakout that gained
less than 20% before the next base does not start a new stage, and the count resets to 1 when price undercuts the
prior base's low. First and second bases qualify; a third or later base is graded down, B- at best.

**Basis.** 01 ("First or second base since the last stage reset; a breakout that gained less than 20% before this base
does not count as a new stage; the count resets to 1 when price undercuts the prior base's low [originator: IBD S7;
MarketSmith manual for the 20% step and the reset]"); the grade-down is 04's ("third and later are graded down").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "First or second base since the last stage reset"; "Buying a third or fourth-stage base" a mistake | 2 |
| 04 | "First or second base since the last real correction; third and later are graded down" | 2 |
| 06 | "the first or second base after a correction or a Stage 1 base"; "Buying a third or fourth base late in a long run" a mistake | 2 |
| 02 | "The third flag in a short run without a proper base (the owner's FCEL)" invalidates | 2 flags |
| 03 | "Not late ... the stock was not already up more than 200% in the 6 months before the pole began" | 200% |
| 12 | "The first touch ... a second touch can still be an A or B; a third or later touch is lower grade" | 2 touches |
| 14, 18 | the first pullback; "once you get two Base n' Breaks, you should realize you are late" | 1 (2) |
| 20 | "First EP: no qualifying EP in the prior 126 sessions" | 1 |

**Overrides.** 02 (flags count in a run, not bases), 03 (a percent instead of a count), 12, 14 and 18 (touches and
pullbacks count the same way), 20 (one per 126 sessions).

**Conflicts to settle.** A third base banned (01's mistakes list) against graded down (04, and E50 keeps grading
discretionary). Ours: graded down, not banned.

### tight

**Canonical definition.** A pattern is tight when the average daily range of its last 5 sessions (high minus low, as a
percent of the close) is at most 0.85 times the average daily range of the 10 sessions before them.

**Basis.** Ours, built from the ratio form the dossiers share (02: the flag's range smaller than the pole's; 09: the
last 5 sessions' range smaller than the 20-session average; 15: "the last 5 days' average range under 0.85 times the
average range of the 10 days before, the app's test"; 18: the last 5 sessions' range below the whole consolidation's).
The 0.85 is 15's and the app's. No outside source gives a number: 01 ("IBD gives no number"), 03 ("the sources agree
tight is better but give no number"), 04 ("no number"), 07 (Haber: "tight relative to itself").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "the last 10 sessions' high-to-low range is at most half the base's depth, or the last 3 sessions include an inside day"; the screener's gate a fixed 2.5% daily range | half the depth |
| 02 | "The flag's average daily range ... is smaller than the pole's" | ratio |
| 03 | "In the last 5 sessions before the trigger, the highest close is no more than 10% above the lowest close" | 10% |
| 04 | "the last 5 handle closes sit within about 3% of each other" | 3% |
| 05 | "the last 5 sessions hold no two days of 4% or more in either direction" | 4% |
| 07 | the bundle: "the 8 EMA, 21 EMA and 50 SMA lie within 3% of price of each other" (kept median 1.7%, about 0.6 ATR; option within 1 ATR; Deepvue and StratLab 1-3%) | 3% |
| 09 | "the closes sit within about 5% under the line and the average daily range is smaller than the 20-session average" | 5%, ratio |
| 13, 32 | the quiet day: "an inside day or a day whose range is under 1 ATR" | 1 ATR |
| 15 | "the last 5 days' average range under 0.85 times the average range of the 10 days before" | 0.85 |
| 16 | the stall: "no close is more than 1 ATR from the 10-day EMA" over 3 to 10 sessions | 1 ATR |
| 18 | "the average daily range of the last 5 sessions is below the average of the whole consolidation" | ratio |
| 26 | "the last 20 closes span 15% or less" | 15% |
| 31 | "the pullback's total high-to-low range at most about 1.6 ATR(14); no single red body bigger than about 3.5% of price" | 1.6 ATR |
| 42 | the hourly flag: "The 2 to 5 sessions before hold a range of 10% or less on the hourly chart" | 10% |

**Overrides.** 07 (tightness of the averages, not of price), 03 and 04 (fixed close spreads: the HTF's 10% and the
cup handle's 3% are each pattern's own look), 26 and 42 (a fixed span over a fixed count), 16 and 31 (ATR forms
written for the stall and the Slingshot's pullback), 13 and 32 (the quiet day).

**Conflicts to settle.** The word means a different test in nearly every dossier: a fixed percent (03, 04, 05, 26, 42),
a ratio (02, 09, 15, 18), an ATR cap (13, 16, 31, 32), or half the depth (01). Ours: the 0.85 ratio as the shared
default for every base and flag; a card that keeps a fixed percent or an ATR cap says so, and a question never mixes
two forms on one chart.

### dry_up

**Canonical definition.** Volume dries up when the average daily volume of the pattern's last part (the pullback, the
handle, the final contraction, the second half of a base) is below the 50-session average volume. A grade cue unless
the card makes it a gate.

**Basis.** The dossiers' most common yardstick (06: the final T below the 50-day average; 10, 11, 12, 28 and 35 all
measure against the 50-day average). Cue, not gate: 01 ("Bulkowski's data on volume inside patterns is 'close and
mixed'"), 14 ("in my test quiet pullbacks did worse, not better"), 17 ("Not a gate. No source requires it").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "The second half of the base averages less volume than the first half" (cue) | ratio |
| 02 | "Average volume during the flag is below the pole's average volume. No flag session closes red with volume of 1.5 times its 50-day average or more" | ratio; 1.5x |
| 03 | "Flag average daily volume is below the pole's average. At most 60% of it for an A grade" | 60% |
| 04 | "The handle's average daily volume is below the cup's average daily volume" | ratio |
| 05 | "total volume on up-close days exceeds total volume on down-close days" on the right half | up vs down |
| 06 | "the final T's average daily volume is below the first T's and below the 50-day average, with at least one day in the final T at or under half the 50-day average" (gate) | 50-day; half |
| 10 | down days of the higher-low pullback "below the 50-day average volume" | 50-day |
| 11 | "the average volume of the pullback sessions below the 50-day average volume"; no down day on more than 1.5 times it | 50-day; 1.5x |
| 12 | "Average volume over the pullback days below the 50-day average volume; the touch day not above 1.5x" | 50-day; 1.5x |
| 14 | "No hard volume rule"; a quiet drift a grading cue only | none |
| 16 | the stall: "the up days come on lighter volume than the down days" | up vs down |
| 17 | "Not a gate" | none |
| 27 | "Bounce days average less volume than the gap day, ideally under the 50-day average" | 50-day |
| 28 | "Quiet on the break (at or under the 50-day average), heavier on the reclaim" (booster) | 50-day |
| 29 | "Volume is not required" | none |
| 35 | "Quiet (under 1.0x): the reclaim can be bought. Loud (1.5x or more): wait for the test. Do not use volume as a pass/fail gate" | 1.0x; 1.5x |
| 41 | "A quieter red string ... grading cues only" | none |

**Overrides.** 02, 03 and 04 compare against the pattern's own first part (the pole or the cup), not the 50-day; 05
compares up-days to down-days; 06 keeps a gate with the extra "half the 50-day" day; 35 uses the number to choose the
entry, not to pass or fail.

**Conflicts to settle.** The yardstick (the 50-day average against the pattern's own first part against the prior
day) and gate against cue (06 gates, 14 and 17 measured no edge). Ours: the 50-day average, a cue; 06 keeps its gate
because it is the originator's defining feature.

### volume_surge

**Canonical definition.** A volume surge on a trigger day is volume of at least 1.4 times the 50-session average
volume by the close. Judged during the session as "on pace": the volume so far divided by the share of the session
elapsed, against the same average. A gate only where the card says so; otherwise the A-grade cue.

**Alias accepted on the pilot card:** **id:** `breakout_volume`. New cards use the heading id.

**Basis.** IBD's "at least 40% above average", the most-cited number (01, 03, 04, 05, 06); the 50-day window is 03's
and 04's proposal (AAII's baseline; IBD's column names no window). Cue, not gate: 01 recommends it ("owner: 'Not a big
volume guy'; Kullamägi silent; Bulkowski's study found heavy-volume breakouts failed more") and 06 agrees.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "on pace for at least 1.4 times the 50-day average volume" (recommend grade cue) | 1.4x |
| 03 | "volume at least 40% above its 50-day average" (grades, not gates) | 1.4x |
| 04 | "on pace for at least 40% above the 50-day average by the close" | 1.4x |
| 05 | "at least 1.4 times the average of the base's sessions, leaving out the listing week"; A+ "2 times or more of the 10-day average, or the highest volume of any session after the listing day" | 1.4x; 2x |
| 06 | A+ "at least 1.4 times the 50-day average by the close" | 1.4x |
| 07 | the launch bar "volume above its 50-day average (1.2x or more)"; 2x a grade cue | 1.2x |
| 09 | "at least 1.2 times its 50-day average (A grade: 1.5 times or more)" | 1.2x; 1.5x |
| 13 | "Reclaim-day volume at least the 50-day average volume" | 1.0x |
| 15 | "pop-day volume above the prior day's and above the average of the base days. The 50-day average is not required" | prior day |
| 16 | "trigger-day volume at least the 50-day average; 1.5x or more, or a gap down, is the strong form" (cue) | 1.0x; 1.5x |
| 18 | Wedge Pop "Volume at least the 50-day average"; the breakout "No rule" | 1.0x; none |
| 19 | "not a gate; a grade marker" | none |
| 20 | "at least 3x its 50-day average volume"; "traded its full ADV within the first 30 minutes"; ideal 5x or an HVE | 3x; ADV in 30 min |
| 21 | "at least 1.5x the 50-day average; 3x or more for an A" | 1.5x; 3x |
| 22 | "At least 3 times the 50-day average by the close"; A+ the highest in a year or ever | 3x |
| 23 | stand-in "2x or more the prior 50-day volume (stocks); 1.2x (index ETFs)" | 2x; 1.2x |
| 24 | "About 10x the 50-day average or more ... or at least 2.5x the old record"; a record over the prior 252 sessions | 10x; 2.5x |
| 25 | "volume at least 2x the 50-day average" (K-M 1.5x, Wagner 3x, Morpheus 2-3x) | 2x |
| 26 | "Kicker-day volume at least 1.5 times the 50-day average (judge it by the run rate before the trigger)" | 1.5x |
| 27 | "At least 1.5x the 50-day average on the gap day (2x for an A grade)" | 1.5x; 2x |
| 31 | "No volume surge is needed on the trigger day" (greats 0.9-1.4x) | none |
| 32 | "at least 1.2x the 20-day average (the code); 1.5x or more is an A-grade cue" | 1.2x of 20-day |
| 33 | "1.25x or more of the 50-day average volume is a grading plus" | 1.25x |
| 34 | "Flush-day volume at least 2x the 50-day average" | 2x |
| 36 | "at least 1.5x its 50-day average" | 1.5x |
| 38 | "the day ends at 2x its 50-day average volume or more"; the opening 5 or 15 minutes the heaviest of the run | 2x |
| 39 | "The climax day's volume, and ideally its first 5 to 15 minutes, the highest of the run" | run high |
| 40 | "first-30-minute volume at least 1.5 times its 20-day average for the same window" | 1.5x window |
| 42 | prior move "a gap of 4%+ on 2x average volume" | 2x |
| 44 | "First 5-minute volume at least 2x its 20-day average for that bar"; A+ the ADV within the first 15-30 minutes | 2x bar |
| 17, 28, 29, 30, 43 | no volume rule | none |

**Overrides.** The gap setups keep their own gates (20 and 22: 3x; 25, 34, 38: 2x; 21: 1.5x as the gate, 3x for an
A; 23: 2x); the record-volume setup (24: about 10x or 2.5x the record; 05's "highest since listing" is the same idea
for a young stock); 15 (the prior day and the base days, Kell gives no average); 32 (the code's 20-day average); the
intraday windows (40, 44) measure the window against its own 20-session average; 20, 22 and 44 use "the full ADV in
the first 15 to 30 minutes" as the A+ reading.

**Conflicts to settle.** Three numbers for an ordinary breakout day (1.2x in 07 and 09; 1.4x in 01, 03, 04, 05, 06;
1.5x in 21, 26, 27); gate against cue (gates: 06 A+, 13, 16, 20, 21, 22, 25, 26, 27, 34; cues: 01, 03, 09, 15, 19,
31, 33); the denominator (see `average_volume`). Ours: 1.4x of the 50-day as the shared A-grade cue; the gap and
record setups keep their gates; the intraday reading is "on pace" against the same average.

### average_volume

**Canonical definition.** "Average volume" is the simple 50-session average of daily shares traded, ending the
session before the one being judged. For an intraday window (the first 5 or 30 minutes) it is that window's own
20-session average.

**Basis.** The dossiers' most common choice (01, 03, 04, 06, 09, 11, 12, 13, 16, 20, 21, 22, 25, 26, 27, 28, 31, 34,
36, 38 all say "50-day"); 40 and 44 for the window version.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| most | "the 50-day average" | 50 |
| 05 | "the average of the base's sessions, leaving out the listing week"; A+ against "the 10-day average" | base; 10 |
| 07 | B23 "over 50 days; ... the finder uses 120 sessions" | 50 (120) |
| 12 | the 10-day scanner "measures against the prior 20 bars" | 20 |
| 15 | "above the prior day's and above the average of the base days" | prior day; base |
| 24 | "the 50-day average" and the all-history record; "a record over the prior 252 sessions" | 50; 252 |
| 32 | "1.2x the 20-day average (the code)" | 20 |
| 40 | "its 20-day average for the same window" | 20 (window) |
| 44 | "its 20-day average for that bar" | 20 (bar) |

**Overrides.** 05 (a young listing has no 50-day; the base's own sessions), 15 (Kell's wording names no average), 32
(the code's 20-day), 40 and 44 (the window's own history).

**Conflicts to settle.** 32's 20-day against the 50-day everywhere else. Ours: 50 for every daily reading; 32 moves to
50 (and says that this changes the code's gate), 40 and 44 keep 20 because a window's volume is seasonal.

### liquidity

**Canonical definition.** Price $10 or more at the entry price, and average dollar volume (close times shares) of $20
million or more a day over the 50 sessions before the setup day (B23); the position never more than 1% of the stock's
average daily volume (D42).

**Basis.** The rulebook (B23 "$10 or more that trade at least $20 million a day", D42). B23 names no averaging
window and no date for the price; the 50-session window and "at the entry price" are the dossiers' most common
choices (06, 07, 14: 50-day; 22: the entry price) and ours.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 06 | "50-day average dollar volume $20 million or more ... the 50-day window is my proposal" | 50 |
| 07 | "over 50 days; B23 sets no window, the finder uses 120 sessions" | 50 |
| 11 | "Measure the dollar volume as a 30-day average, as the app's screener does" | 30 |
| 14 | "$20 million traded a day on the 50-day average" | 50 |
| 29 | "at least $20 million traded a day (20-day average)" | 20 |
| 05 | "over the base's sessions, leaving out the first three sessions after listing" | base |
| 20 | "measured on the gap day's own dollar volume"; only 27% of EP-like days pass both tests on the 20-day average before the gap | gap day |
| 22 | "At least $10 at the entry price" (FSLY $9.31 before its gap, $13.49 at the open) | entry |
| 24 | "measured on the 20 sessions after the HVE rather than the 50 before"; 7 of 19 kept charts closed under $10, 12 of 19 under $20M before; the owner exempted HVE from the bank's liquidity cut (2026-11-07) | after |
| 01, 08, 09, 13, 30 | the app's detectors use $2 and $10,000 | floor only |
| 31 | the detector "$5, 100,000 shares" | floor only |
| 10 | Deepvue "$15, 500K shares" ($7.5M a day) | compare |
| 14, 15, 16 | Kell's screen "over $20, over 500,000 shares, $2 to $25 billion market cap" | compare |

**Overrides.** 24 (HVE, pending the owner's exemption, question 5), 20 (EP measured on the gap day, question 5), 05
(the listing's first 3 sessions are left out), 22 (the price at the entry, not before the gap).

**Conflicts to settle.** The window (50 against 30 against 20 against the event day) and the price date (before the
gap against at the entry). Ours: the 50-session average before the setup day and the price at the entry; the HVE and
EP exceptions are owner questions, not glossary overrides.

### leader

**Canonical definition.** A leader has an RS rating of 80 or more and is in one of the strongest groups (C31). A
short's mirror is an RS rating of 20 or less in the weakest groups (D47 through C31). Parabolic and mean-reversion
trades are exempt. "Strongest groups" has no number yet; ours: the top quarter of the app's group ranking.

**Alias accepted on the pilot card:** **id:** `rs_rating`. New cards use the heading id.

**Basis.** The rulebook (C31, confirmed "31, yes unless parabolic or mean reversion"; the short mirror from D47). The
top-quarter reading is 05's ("MSI's 'top 40' of 164 groups is about the top quarter, Stockbee's 'Top 20 ranked
sector'"); 17 offers "a top-fifth group rank" as an example.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01, 02, 03, 04, 08, 09, 11, 12, 17, 19, 25, 26, 31, 37, 40, 41, 42, 43, 44 | "RS rating 80 or more, in a strong group" | 80 |
| 06 | "RS rating 80 or higher. (Minervini's floor is 70.)" | 80 (70) |
| 05 | "RS 80 or more when the RS exists (63+ bars)"; the group "in the top quarter of the app's group ranking" | 80; top quarter |
| 07 | "RS 80+ if C31 applies (question 7)"; Manrav's QUBT launchpad showed RS 31 | open |
| 10 | "RS line (stock divided by SPY) has made a higher low with price, or is above its own 50-day average"; RS 80 waived only if the owner rules | RS line |
| 13, 32 | RS 80 for a 50-day reclaim; a 200-day remount "beaten-down names", question 7 / 6 | open |
| 15 | "held up better than its index during the decline ... ideally an RS rating of 80 or more"; only 16% of the app's pops had 80+, median 42 | 80 (16%) |
| 18 | "RS rating 80 or more. A+ when the stock is in the top 2% of liquid stocks by gain over 1, 3 or 6 months" | 80; top 2% |
| 20, 22 | neglected stocks have a middling RS before the gap; question 6 / 8 | open |
| 23 | the short "RS 20 or less (C31 mirror), unless the owner rules it mean reversion" | 20 |
| 24 | "Likely conflict" (median 26% off the 52-week high); question 6 | open |
| 28, 29 | "RS names" (Bracco); whether the washout version is mean reversion, question 5 / 4 | 80 (open) |
| 33 | a stock in a topping pattern "has often lost relative strength"; owner question | open |
| 34, 36, 38, 39 | exempt by C31's words | exempt |

**Overrides.** 34, 36, 38 and 39 (exempt by C31). The pending requests for an exemption (05, 07, 10, 13, 15, 20, 22,
24, 28, 29, 32, 33) are owner decisions, listed in `DECISIONS.md`, not glossary overrides.

**Conflicts to settle.** "Strongest groups" has no number in C31 (05 reads it as the top quarter, 17 offers the top
fifth): ours, the top quarter, pending the owner. Which RS: 14 and 42 used a 63-session proxy and found the owner's
own calls under 80 (ZETA 58, BIDU 68, META 69, ZS 77); the app's one-year rating is the rulebook's number; ours: the
app's rating, and a card never grades on the proxy.

### above_200

**Canonical definition.** A long's close on the setup day, and the price at the entry, are above the 200-day simple
moving average; a short's are below it. The only exceptions are the parabolic long and the parabolic short (B26, a
hard rule).

**Basis.** The rulebook (B26: "no longs below the 200-day simple moving average, unless it is a parabolic long; shorts
only below the 200-day, never above it unless it is a parabolic short"; "200SMA is hardened rule yes").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01, 02, 37 | price above the 50-day and the 200-day, the 50-day above the 200-day | 200 and 50 |
| 06 | Minervini's Trend Template: above the 150-day and 200-day, 150 above 200 | 150, 200 |
| 10 | Version H "Close above the 200-day SMA"; Version W (Weinstein's) lives under it and "fails both named examples" | H above |
| 13 | "200-day reclaim: the reclaim close is above the 200-day (true by definition). 50-day reclaim: the close is above the 200-day too" | the cross |
| 20, 21, 22 | the gap "may carry it there"; a gap that opens under and closes over is an owner question (20 Q7, 21 Q9, 22 Q6) | open |
| 24 | "the trade (not the HVE day) must be above the 200-day SMA" (5 of 19 kept had the prior close under it) | the trade |
| 26 | "the red day's close is above the 200-day SMA" (applying it to the red day's close rather than the entry is a reading, question 9) | red day |
| 30 | "the Oops-day close and the prior close are both above the 200-day SMA" | both |
| 05, 37, 43, 29 | a young listing has no 200-day (E53 sets no IPO rule); 05 Q3, 43 Q11, 29 FIGR | none yet |
| 12 | a 200-day pullback is not taught stand-alone; the 200-day is "the line where longs stop" | n/a |
| 09, 14, 15, 35 | the classic versions under the 200-day (reversal breaks, crossbacks after deep corrections, half the app's pops, the accumulation spring) are excluded | excluded |
| 16, 27, 33, 35 | the classic shorts above the 200-day (the Wedge Drop at a top, the bear gap off highs, the H&S neckline break, the UTAD) are excluded; 70% of Wedge Drops and 61% of bear gaps sit above it | excluded |
| 34 | 72% of the app's capitulation fires are below; covered only if Capitulation is ruled the Parabolic Long (Q1) | open |
| 36 | Connors' version obeys it; Bracco's crash longs and his SOXL short do not unless they pass the burst | open |
| 38, 39 | the named exception; 39: "Every five-star example sat 87% to 622% above the 200-day" | exempt |

**Overrides.** 38 and 39 (B26's own exception); 34 if the owner rules it the Parabolic Long; 27 Version P (the day-2
gap down, pending question 5 because it lacks the climax-day gap); 36's short above the 200-day only as a parabolic
short.

**Conflicts to settle.** A gap day that opens under the 200-day and closes over it (13, 20, 21, 22, 24): ours, the
close counts, so the trade is allowed once the gap day has closed above the line. A stock with no 200-day yet (05, 29,
37, 43): no number yet; ours, the 50-day SMA stands in until 200 sessions exist, pending the owner. 26's reading (the
red day's close) against the entry price: ours, both must hold. Whether a 200-day remount that slips back under the
line before the stop forces an exit (13): the owner's call, A4 says the stop is the exit.

### rising_average

**Canonical definition.** An average is rising when its value today is higher than its value N sessions ago, with
N = 20 for the 200-day SMA, 10 for the 50-day SMA and 5 for the 20-day EMA. "Flat or rising" allows an equal value.

**Basis.** The dossiers' most common choices: the 200-day against 20 sessions ago (01, 09, 11, 14, 19, 30, 32), the
50-day against 10 sessions ago (02, 11, 12, 29), the 20 EMA against 5 sessions ago (14, 42, 43). The 20-EMA window is
the split one (11 and 12 use 10), so the 5 is ours.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "The 200-day is not lower than 20 sessions ago" (ftb4; Weinstein's rising 30-week) | 200 / 20 |
| 02 | "a rising 50-day SMA (higher than 10 sessions ago)"; the indexes "above a rising 20-day EMA" | 50 / 10 |
| 06 | "200-day higher than 21 sessions ago" (the "at least 1 month" reading) | 200 / 21 |
| 09 | "The 200-day is flat or rising (higher than 20 sessions earlier)" | 200 / 20 |
| 10 | Stage 4: "the 150-day SMA (30-week line) was lower than 20 sessions earlier"; flattening: "the 50-day no more than 1% lower than 10 sessions ago" | 150 / 20; 50 / 10, 1% |
| 11 | "the 200-day SMA not lower than 20 sessions earlier"; "the 50-day SMA higher than 10 sessions earlier"; "The 20 EMA rising: higher than 10 sessions earlier" | 200/20, 50/10, 20/10 |
| 12 | "200-day SMA rising for at least 21 sessions"; "20 EMA above its value 10 sessions ago; 50 SMA above its value 10 sessions ago" | 200/21, 20/10, 50/10 |
| 13 | "The line today is no lower than its value 10 sessions ago minus 0.5 ATR (flat or rising)"; A grade "the 200-day is above its value 20 sessions ago" (11 of 16 named reclaim days fail it) | 10, 0.5 ATR; 200/20 |
| 14 | "Prefer the 200-day rising (higher than 20 sessions ago)"; "the 20-day EMA higher than 5 sessions earlier" (Chart IQ's slope) | 200/20; 20/5 |
| 19 | "the 200-day is higher than 20 sessions ago"; the AVWAP "fell less than 0.5 ATR over the 10 sessions before" | 200/20 |
| 26 | "the 50-day SMA is flat or rising over the last 20 sessions (the red day's value at least 99.5% of its value 20 sessions earlier)" | 50 / 20, 99.5% |
| 27 | Version R "the 200-day is flat or falling" | 200 / falling |
| 29 | "The 50-day SMA today is at or above its value 10 sessions ago" | 50 / 10 |
| 30 | "Prefer a rising 200-day (its value higher than 20 sessions ago)" | 200 / 20 |
| 32 | "the 200-day is higher than it was 20 sessions ago (the drawing's gate)" | 200 / 20 |
| 41 | "the 20-day EMA rising" | no number |
| 42 | "the 20-day EMA higher than 5 sessions ago" (code G0) | 20 / 5 |
| 43 | "Rising 20-day EMA (today's value above the value 5 sessions ago)" | 20 / 5 |
| 44 | "above a rising 200-day SMA" | no number |

**Overrides.** 13 (the 0.5 ATR tolerance, written for a line that was just lost), 10 (the 1% flattening test, the 4B-'s
own idea), 26 (the 99.5% tolerance from the finders).

**Conflicts to settle.** The 20 EMA over 5 against 10 sessions (14, 42, 43 against 11, 12): ours, 5. The 200-day over
20 against 21 sessions (06, 12): ours, 20, the two are the same month.

### ma_stack

**Canonical definition.** The averages are stacked for a long when the close is above the 50-day SMA and the 200-day
SMA and the 50-day is above the 200-day. The 20 EMA above the 50-day is the extra line on the pullback and crossback
cards. The full fast stack (9 or 10 above 20 above 50 above 200) is a grade cue, not a gate. A short's stack is the
mirror.

**Basis.** 01, 02, 37 and 41 (close above the 50 and 200, the 50 above the 200: B26 plus the dossiers' proposal); 11
and 12 (the 20 EMA above the 50 SMA, Keller's "proper order"); the cue reading is 07's (the owner's 2026-10-23 ruling:
"the full stack is not required") and 08's ("Do not require the full 8 > 21 > 50 stack: the owner's examples often
lack it and my test found no benefit").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "price above the 50-day and the 200-day, and the 50-day above the 200-day" | 50 > 200 |
| 02 | the same, with "a rising 50-day SMA" | 50 > 200 |
| 03 | "above a rising 10-day and a rising 21-day EMA"; above the 200 and the 50 | 10, 21, 50, 200 |
| 06 | the Trend Template: "50-day above the 150-day and 200-day" | 50 > 150 > 200 |
| 07 | "8 > 21 > 50 on the launch day or within the next 3 sessions. Not required beforehand" | cue |
| 08 | "Do not require the full 8 > 21 > 50 stack" | cue |
| 10 | Version H "above every average, the 'remounted all MAs' read" | all |
| 11 | "The 20 EMA above the 50-day SMA, and the 50-day SMA higher than 10 sessions earlier" | 20 > 50 |
| 12 | "20 EMA above 50 SMA above 200 SMA" | 20 > 50 > 200 |
| 13 | "Best when the reclaim puts price above all the averages (20, 50, 200)" | cue |
| 14 | "9-day EMA above the 20-day EMA, and the 20-day EMA higher than 5 sessions earlier" | 9 > 20 |
| 18 | Kell: "Up cycle = the 10 EMA above the 20 EMA, both rising" | 10 > 20 |
| 37 | "close above the 50-day and the 200-day, with the 50-day above the 200-day" | 50 > 200 |
| 41 | "prior day's close above the 50-day SMA, the 50-day above the 200-day, and the 20-day EMA rising" | 50 > 200 |
| 42 | "Price above the 200-day SMA and the 50-day SMA" | 50, 200 |
| 34 | the reverse: "Price below the 5-day, 9 EMA and 20 EMA" | below |
| 11, 14 | the unsigned "9EMA>20EMA>50SMA>200SMA" is "a checklist for the indexes, not a stock rule" | index |

**Overrides.** 06 (the Trend Template, Minervini's own), 11, 12, 14 and 18 (the fast pair is their gate, measured by
their dossiers), 34 (the reverse, a capitulation sits under every fast average).

**Conflicts to settle.** Whether the fast pair is a gate (11, 12, 14, 18) or a cue (07, 08). Ours: the long order
(close above the 50 above the 200) is the gate on every long card; the fast pair gates only the pullback and crossback
cards; everywhere else it is a cue.

### stop_margin

**Canonical definition.** The stop sits a few cents beyond the reference low (or beyond the reference high for a
short), never exactly on it (A3, F62). No number yet. Ours: $0.03, the amount the dossiers' own replays used.

**Alias accepted on the pilot card:** **id:** `stop_day_low`. New cards use the heading id.

**Basis.** The rulebook (A3: "a few cents under the day's low or the prior day's low"; F62: "a few cents under the
day's low, not exactly on it", "62, yes"). The $0.03 is from 16 ("stop $0.03 over the trigger day's high") and 23
("$0.03 beyond the day's extreme"), the only dossiers that put a number on it.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 16, 23 | the replays' stop "$0.03" beyond the extreme | $0.03 |
| 03 | the trigger "at least a cent over the high" | $0.01 (trigger) |
| 26 | "a cent over the red day's high"; "a few cents under the Kicker day's low" | $0.01; cents |
| 41 | HOOD "4c under" the pivot candle's low | $0.04 |
| 10 | "Not on a round number: a few cents under it" (GTA at x.99 / x.49; Bulkowski "by 7 cents") | 7 cents |
| 08 | the app "stops exactly at the low" (to be changed) | 0 |
| 25, 32 | the scanner "1.5% under"; `remount.py` "1.5% under an older low" (rejected) | 1.5% |
| 29 | VoSI "1-2% below the line" (rejected for the house default) | 1-2% |
| 21, 22 | Morales and Kacher's "2-3% porosity" / "1-3% under the gap-day low" (rejected: "No porosity") | 1-3% |
| 11, 17 | the scanners' "21 EMA minus 1 ATR" / "low minus 1 ATR" (rejected) | 1 ATR |

**Overrides.** None. The rejected variants (porosity, ATR buffers, the exact low) are recorded so a card never
revives them.

**Conflicts to settle.** None between dossiers; the gap is the number, and the $0.03 is ours.

### stop_width

**Canonical definition.** The honest stop usually sits within about 3% of the entry (A13). A wider stop is allowed:
the size shrinks so the account risk is unchanged (A5), and if even that does not fit, the trade is skipped (A3). A
card may name its own skip line; where it does not, ours: skip when the honest stop is wider than one ADR.

**Basis.** The rulebook (A13 "the stop usually sits within about 3% of the buy", confirmed "3, yes"; A3 "if the honest
stop does not fit the risk, skip the trade"; A5). The ADR skip line is Kullamägi's ("stop should not be wider than the
ATR or ADR of the stock"), the most common second test in the dossiers (01, 02, 03, 06, 14, 18, 20, 41).

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | skip "If that stop is more than the stock's ADR ... below the entry, or more than 3% below it" | 3% or ADR |
| 02 | "If the honest stop is wider than the stock's average daily range or about 5%, skip or wait" | 5% or ADR |
| 03 | "if that is more than one average daily range (ADR%) ... skip the trade" | 1 ADR |
| 05 | options 3% (A13), 8% (MSI), none; "Recommend (b): skip the trade if the honest stop is more than 8%" | 8% |
| 07 | "skip the trade if the honest stop is more than 6% under the entry"; Haber 3% ("the entry isn't there yet"), TraderLion "within 3-5%" | 6% |
| 08 | "the stop distance ... at most 1 ATR(14) ... and ideally within about 3%" | 1 ATR |
| 10 | "Options for X: 3% (A13), 5%, 8%" | open |
| 13, 43 | the brain template's "family max 8.0%" conflicts; A13 wins | 8% (not ours) |
| 14 | "more than about 3% ... size down ... more than 5% or more than the stock's average daily range as a skip" (Kell's own "1-2%") | 5% or ADR |
| 18 | "no wider than the stock's ADR; if it is wider, skip"; between 3% and ADR "take it with the size the stop allows" | ADR |
| 20 | day 1 only when the stop "is within 3% (A13) and within 1x the stock's ADR" | 3% and 1 ADR |
| 22 | "If that stop is more than 1.5 times the 14-day ATR from the entry, skip" | 1.5 ATR |
| 24 | "How wide is too wide is his call (question 4)"; the close entry a median 19.9% | open |
| 26 | "under the Kicker day's low, or 3.5% under the entry if that is closer" (the owner's ruling); "His cap is 3.5%, not 3%" | 3.5% |
| 29, 30 | more than about 3%: size down or skip; 30 lets an A+ take it at smaller size | 3% |
| 31 | "When the default stop is wider than 3% ... take it, and let the size shrink. If it is wider than about 6.5% ... skip" | 6.5% |
| 35 | "3% to 5% only at a lower grade ... over 5%, skip" | 5% |
| 36, 38 | "If the honest stop is more than about 8% away, skip; between 3% and 8%, size down" (38) | 8% |
| 39 | "Expect it wider than 3%: median about 4% from a VWAP entry"; the size shrinks under A5 | no cap |
| 40 | "3% or less from the fill; 3.5% maximum on a Kicker" | 3%, 3.5% |
| 41 | "Skip if the stop is more than 3% away or wider than the stock's average daily range" | 3% or ADR |
| 23 | "a median of about 7% from the intraday trigger and 11% to 12% from the close"; "skip or size down" | none fit |

**Overrides.** 26 and 40 (3.5% on a Kicker, the owner's own number), 38 and 36 (8%), 05 (8%, pending question 8),
31 (6.5%), 07 (6%), 35 (5%), 02 and 14 (5% or the ADR), 22 (1.5 ATR, see `adr`).

**Conflicts to settle.** The most split term in the dossiers: is A13's 3% a cap, a target or a description (07 Q2,
18 Q3, 24 Q4, 10 Q4, 05 Q8, 31 Q6)? Ours: a description, as A13's "usually" says; A5 does the sizing; the ADR is the
shared skip line; each setup's wider cap stands where the dossier gives one. The owner confirms.

### chase_limit

**Canonical definition.** Never buy more than 4% above the buy point (C28; a short never more than 4% under it). The
buy point is the trigger level the card names (the pivot, the opening-range high, the prior close, the reclaimed
level), not the base pivot when the trigger is an intraday level.

**Basis.** The rulebook (C28: "never buy more than 4% above the buy point", "28, make it 4%"; chasing costs size, not
risk). The buy-point rule is the dossiers' most common choice (20, 21, 22, 40, 44: the opening-range high; 30, 42, 43:
the prior close; 28, 29: the level; 26: the red day's high).

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | MarketSmith "The Pivot Range is 0% to 5% above the pivot point"; the house 4% wins | 4 (5) |
| 04, 05 | IBD's buy zone 5%; "Ours is tighter; use 4%" | 4 (5) |
| 06 | Minervini "a few percentage points" | 4 |
| 07 | the buy point: the launch close (if it were the top of the averages, 15 of 26 kept launches closed more than 4% above it); question 13 | launch close |
| 09 | "Do not buy more than 4% above the line's value that day, or more than 1.5 ATR above it, whichever is smaller" | 4% or 1.5 ATR |
| 13 | a reclaim close 2 ATR over the line can already be more than 4% over it; the buy point the line (A) or the prior day's high (B), question 9 | line / high |
| 15 | if it opens above the pivot "buy at the open if the gap is no more than 4% above the pivot" | pivot |
| 19 | the drawing's "no more than 1 ATR above the line" is a similar idea | 1 ATR |
| 20, 22, 40, 44 | "the ORH (or the delayed trigger)"; 21 "the opening range high or the prior high, not the base pivot" | ORH |
| 24 | "no buy more than 4% over the HVC" | HVC |
| 25 | the test day's close (A) or its high (C) | close / high |
| 26 | "if the Kicker opens more than 4% above the red day's high, skip A and use B" | red high |
| 28 | "Not more than 4% above the broken low" | the level |
| 29 | "no more than 4% over L" | the level |
| 30, 42, 43 | "no buy more than 4% above c1" / the prior close | prior close |
| 32 | the line (A) / the quiet day's high (B), question 7 | line / high |
| 33 | "not more than 4% above the right-shoulder high; on a gap past that, wait for a retest" | shoulder high |
| 35 | "the old range low", owner to confirm (question 4) | range low |
| 39 | "skip if the price is already more than 4% under the VWAP break" | VWAP break |

**Overrides.** 09 adds the 1.5 ATR cap (the scanner's); 26 switches to the other entry instead of skipping; 13, 19 and
32 carry ATR distances from the line as grade cues beside the 4%.

**Conflicts to settle.** The buy point on gap setups (the base pivot would make every gap a chase; 21 measured the
open 4%+ over the prior 50-day high in 26-54% of gaps): ours, the card's trigger level, as above. The ATR caps (09,
13, 19) beside the 4%: ours, grade cues, never a second gate. IBD's 5% is settled by C28.

### stretched

**Canonical definition.** Too stretched to buy: the entry price is more than 10% above the 10-day simple moving average
(C29). C29 does not apply to a short. The rulebook does not say which 10-day average; no number yet; ours: the 10-day
SMA.

**Basis.** The rulebook (C29: "skip a long that is more than 10% above its 10-day average", "29, yes"; A14: read "how
far it is stretched above its averages"). The SMA is ours: "average" with no qualifier in the rulebook, and the
200-day in B26 is explicitly simple.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 08 | CRCL "9.7% over the 10-day SMA (passes) but 10.2% over a 10-day EMA (fails), so the owner should say which average C29 means" | SMA or EMA |
| 07 | MSTR "closed 10.2% to 13.1% over its 10-day (by the reading used)"; question 8 | 10% |
| 20 | "At the open, 65% of 10%+ gaps were already more than 10% over the 10-day; at the close 71-86%"; question 3 | 10% |
| 21 | at the gap-day close 33% of earnings gaps, 55% of strong-close ones, 64% of "leader PEGs" are over the line; the pause buy is usually allowed | 10% |
| 22 | 32.5% of earnings gaps and 16 of his 18 named gaps closed more than 10% above the 10-day; question 3 | 10% |
| 24 | "The HVE close sits a median 41% over the 10-day EMA"; day-2 reclaims a median 24-28% over; question 3 | 10% (EMA) |
| 37 | MXL "about 41% over its 10-day", FIG "about 12.5%" | 10% |
| 29 | MXL's post-earnings undercut "40.9% over its 10-day average"; question 9 | 10% |
| 40, 44 | gap-day ORBs and drives often open more than 10% over; 44: 27% of the app's fires | 10% |
| 16 | the top: "about 4% or more over the 10-day for an index"; "a close at least 2.5 ATR over the 20-day EMA in the last 20 sessions" | 4%; 2.5 ATR |
| 18 | Exhaustion Extension: index "4-5% above the daily 10 EMA"; stock "a close 10% or more above the 10-day" (borrowed from C29) | 4-5%; 10% |
| 39 | the prior close "10%+ above the 9-day EMA, 40%+ above the 50-day SMA, and 10+ on Jeff Sun's ATR multiple" | 10%, 40%, 10x |
| 11 | not extended from the line: "The close is no more than 1 ATR above the 20 EMA" (three owner examples fail it on the hold session) | 1 ATR |
| 13, 32 | the remount day "no more than 2 ATR above the line" | 2 ATR |
| 19 | the reclaim day's close "0.3 to 1.0 ATR above the AVWAP" | 1 ATR |
| 34, 36 | the stretch down: "a close at least 3 ATR under the 50-day SMA" (index); 2 ATR(14) from the prior close; a close under the lower Bollinger band (20, 2); RSI(2) under 5 | 3 ATR; 2 ATR |

**Overrides.** 34, 36, 38 (the setups that need a stretch down; C29 cannot bind), 39 (a short; C29 does not apply),
16 and 18 (Kell's extension numbers, taught as his). The gap-day setups (05, 07, 20, 21, 22, 24, 26, 29, 37, 40, 44)
ask for an exemption; that is an owner decision, not a glossary override.

**Conflicts to settle.** SMA against EMA (08; the course's distance-from-average lesson does not fix it either): ours,
the SMA. The gap-day exemption (eleven dossiers): ours, C29 as written until the owner rules, with the pause and
day-2 entries taught as the way in.

### opening_range

**Canonical definition.** The opening range is the high and low of the first 30-minute bar of regular trading, 9:30 to
10:00 ET. An opening-range break (ORB) is a trade one cent through that high (or low) after 10:00. The 5-minute
opening range is a named variant, always written "5-minute ORH", never the plain term.

**Basis.** The owner's Kicker ruling (`TRADE_PLANS.md`: "the day-1 30-minute opening-range break"); course V.05
("Ours is the 30-minute opening range on day one"; "A break of day one's 30-minute range"); B20 uses the same bar for
the gap rule; 40 ("the first 30-minute candle ... Other windows (5 or 15 minutes) only if the owner approves them").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 40 | "the high and low of the first 30 minutes of regular trading, 9:30 to 10:00 ET" | 30 min |
| 26 | entry B "the high of the first 30-minute bar (9:30 to 10:00 ET)"; "the exact window is question 2" | 30 min |
| 06 | "if the stock opens above the pivot, a market order when it takes out the opening-range high" | unnamed |
| 18 | "the opening-range high of the first 5-minute bar (1-minute or 60-minute also allowed)" | 5 min |
| 20 | "After the first 5-minute candle (or the first 30 minutes for a slower start)" | 5 or 30 |
| 21 | "over the 5-minute or 30-minute opening range high" | 5 or 30 |
| 22 | "the first 5 or 30-minute high; Kullamägi also uses 1 and 60 minutes" | 5 or 30 |
| 27 | Version P "the 2 or 5-minute low, as in Bracco's main post; the 30-minute low as a slower option" | 2 or 5 |
| 36 | "the next session's opening-range high or first green 5-minute candle" | 5 min |
| 38 | "the first 5-minute bar that closes back above the session VWAP"; alternative "a break of the opening-range high" | 5 min |
| 39 | Kullamägi's "a break of the 1 or 5-minute opening range low" | 1 or 5 |
| 44 | "the first 5-minute bar's high (the 5-minute ORH)"; options 1, 2, 5, 30; "Recommendation: 5-minute ORH, with the 30-minute ORB as the slow version" | 5 min |
| 34 | "a break of the opening range high" | unnamed |

**Overrides.** 44 (the 5-minute ORH, from Zarattini's measurement and SMB's drive), 38 and 39 (Bracco's 5-minute bars
and VWAP), 27 Version P (2 or 5 minutes), 18 (Kullamägi's first 5-minute bar).

**Conflicts to settle.** 44 recommends the 5-minute range as the default and 40 the 30-minute (44 question 3, 40
question 1). Ours: "opening range" with no qualifier means the 30-minute bar, the owner's own term; every 5-minute
use is written "5-minute ORH" so a question can never mean both.

### hourly_bar

**Canonical definition.** An hourly candle is a clock-aligned 60-minute bar: 9:30 to 10:00, then 10:00 to 11:00, and
so on; "the first or second hourly candle" ends at 11:00. A 30-minute candle is one half of it.

**Basis.** 42's proposal ("Recommend clock-aligned 60-minute bars (9:30-10:00, then 10:00-11:00), the default on most
platforms and the bars on his review screen"; question 3); 41 for 30-minute candles.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 42 | "clock-aligned 60-minute bars"; "the same session can pass on one chart and fail on another (section 4.4)" | 60 |
| 41 | "at least 2 red 30-minute candles in a row"; the pivot candle the first green one | 30 |
| 14 | Kell: "buying support on the daily chart via a breakout on the 65 Min chart" | 65 |
| 16 | Kell: "Try to get In on the 65 minute" | 65 |
| 18 | "Hourly and 15-minute charts are for timing entries" (Kell) | 65 (his) |
| 11 | "an hourly candle holds and the next hourly bar takes out its high" | unnamed |
| 13, 32 | "the owner often times the entry on the hourly" | unnamed |

**Overrides.** The Kell lessons (14, 16, 18) name 65 minutes as his.

**Conflicts to settle.** 60 against 65 (42 against 14, 16, 18): ours, 60, clock-aligned, for every house rule; Kell's
65 is named as his and never used in a house question.

### earnings_reaction_day

**Canonical definition.** The earnings reaction day is the first regular session after a quarterly report (a report
after the close the day before, or before the open that day). A gap on that day is an earnings gap, judged as a PEG,
an EP or a news gapper by its size and volume. It is never a Kicker, and on ordinary big volume it is a PEG, not an
HVE.

**Basis.** 21 (the PEG day: "the first regular session after it"); 20; 22; 26 (the owner's rulings: "An earnings-day
gap is an earnings gapper"; "Calling an earnings-day gap a Kicker (GRMN, TSN and eight more cut)"); 24 ("Earnings on
ordinary big volume is a PEG, not an HVE. [UCT ruling]").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 20 | "a named surprise released after the close or before the open" | n/a |
| 21 | "the PEG day is the first regular session after it" | n/a |
| 23 | "the report day if before the open, the next day if after the close" | n/a |
| 24 | 17% of owner-definition HVE days were earnings days; "earnings so big the volume is extreme" is an HVE | n/a |
| 26 | "neither the red day nor the Kicker day is an earnings report day (within the bank's 3-day window)"; the owner kept VTRS and IMAX, both earnings days ("rarely earnings") | ban (open) |
| 30 | "An earnings-day Oops is allowed but grades lower" (MATX "meh") | lower grade |
| 31 | the drive "an earnings gap, the open 5% or more over the prior close on the report day or the session after" | n/a |
| 25 | "Earnings or major news preferred, not required" | n/a |
| 19 | the anchor "the day of the most recent earnings gap up" | n/a |

**Overrides.** 24 (an earnings day with record volume is an HVE), 30 (allowed at a lower grade).

**Conflicts to settle.** 26 bans the Kicker on an earnings day outright while the owner kept two earnings-day
Kickers (VTRS, IMAX): ours, the ban stands for the drafts and the two examples go to the owner. 21 keeps a non-earnings
news gap out of the PEG unless the owner rules otherwise (the INTC note).

### earnings_blackout

**Canonical definition.** No new buy, and no new short, in the 3 sessions before a scheduled report; hold through a
report only if the trade is up 5R (B22). Ours: sessions, not calendar days.

**Basis.** The rulebook (B22: "No new buys in the 3 days before an earnings report; hold through a report only if the
trade is up 5R", "22 change it to 3 days and only hold if up 5R"). Trading days are ours; B22 does not say.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 07 | "B22 says 'the 3 days before an earnings report' without saying trading or calendar days" | open |
| 11 | "B22 says '3 days'; trading days or calendar days is not stated, so ask" | open |
| 09, 14, 20, 29, 31 | "No report due in the next 3 sessions" | 3 sessions |
| 26 | "within the bank's 3-day window" | 3 |
| 21 | the app's Power Earnings Gap starter scan "lists stocks before a report" (names up to 7 days before) | conflict |
| 10 | Deepvue's NFLX "4B- entry" came one to two sessions before the report, so B22 blocks it | example |
| 37 | Manrav's UMC note "named earnings eight calendar days out" | example |
| 29 | adds "no pending buyout or deal" ("My hard rule, as soon as there is buyout stuff I take it off my list") | n/a |
| 16, 23, 27 | mirrored for shorts | 3 |

**Overrides.** None.

**Conflicts to settle.** Trading against calendar days (07, 11): ours, 3 trading sessions, pending the owner.

### gap

**Canonical definition.** A gap is the open against the prior close, in percent of the prior close. The house
"catalyst gap" is an open at least 4% above the prior close on at least 2 times the 50-session average volume (the Gap
Support scanner's numbers, carried into the bank's wording of the owner's definition). A "true gap" (a window) also
needs the whole day above the prior day's high (or below its low). Each gap setup keeps its own floor; the floor is
what names the setup.

**Basis.** 25 ("the scanner's numbers and true-gap test, carried into the bank's wording of his definition; he has not
stated a number himself"); 19 reuses it for the earnings-gap anchor; 42 ("a gap of 4%+ on 2x average volume").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 20 | EP "the open is at least 10% above the prior close"; options 4% (the app), 8% (the 2010 scan, Chart IQ), 10%; over 25% graded down (Bonde's 2024 number 20%) | 10% |
| 21 | PEG "opens at least 4% over the prior close AND at least 0.75 x the 40-day ATR over it"; options 4, 8, 10; 10%+ an A cue | 4% + 0.75 ATR |
| 22 | "The open is at least 4% above the prior close. Prefer 8% or more; 10% or more for an A+" | 4% |
| 23 | stand-in "open 4% or more under the prior close on 2x ... (stocks); 1% or more on 1.2x (index ETFs)"; the app's Chart IQ 5% | 4%; 1% |
| 25 | "the open at least 4% over the prior close, the whole day above the prior day's high (a true gap), volume at least 2x"; his posts also call 2-3% gaps "gap support" (question 13); over 30% a lower grade | 4% |
| 26 | the Kicker day "opens at least 1.5% above the red day's close" (kept minimum 1.71%; "very good" at 1.75%) | 1.5% |
| 27 | the bear gap: "The open is under the prior close by at least 1 ATR(14) or 4%, whichever is smaller, and the gap is not filled that day"; stricter "full window" option | 1 ATR or 4% |
| 31 | drive (a): an earnings gap "the open 5% or more over the prior close"; (b) "a close more than 4% over the prior close on volume above its 50-day average" | 5%; 4% |
| 37 | "within 15 sessions of a 4% gap on at least 1.5 times the 50-day volume" | 4% |
| 43 | the A version "opens at least 0.7% below the prior close"; "Gap ceiling. About 4% for the normal version" | 0.7%; 4% |
| 44 | "Opens at least 1% above the prior close (the app's floor). A+ when it opens above the prior day's high" | 1% |
| 07 | the launch "opens no more than 6% above the prior close ... A bigger gap is a different setup (Kicker, earnings gap)" | 6% ceiling |
| 19 | the reclaim day "did not open more than 0.5 ATR above it (a gap over the line is a gap setup)" | 0.5 ATR ceiling |
| 15 | "buy at the open if the gap is no more than 4% above the pivot" | 4% |
| 39 | "The climax day opens above the prior close. Required. A gap of 5%+ is stronger" | any; 5% |
| 34, 36, 38 | the burst boxes count "2 consecutive opening gaps down" | any |

**Overrides.** Every gap setup keeps its floor; 27 (the ATR-or-percent rule, the only one that scales with volatility),
21 (the ATR floor, the originators'), 26, 43 and 44 (small gaps that name their own setups).

**Conflicts to settle.** The same earnings gap is an EP at 10%, a news gapper at 4% and a PEG at 4% plus 0.75 ATR:
ours, the floor names the setup, as 20 proposes (4% to 10% is a PEG or gapper, 10% and over an EP), and the three
cards say so in their lookalikes. 23's Chart IQ 5% against the 4% stand-in: ours, 4%. 25's 2-3% "gap support" posts
against its 4% rule: the owner's question 13.

### gap_fill

**Canonical definition.** A gap up is filled when price trades back to the prior close (the overnight gap). For a true
gap the window closes when price trades back to the prior day's high (a gap down: the prior day's low). "The gap
holds" means neither has happened. A long gap setup is void once its gap fills before the entry; a card says which of
the two spots it means.

**Basis.** 20, 22 and 26 (the prior close); 25 (the prior day's high as "the gap-fill spot"); 27 (the window's edges).

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 20 | "never trades back to the prior close (no fill)"; "The gap fills (a trade back to the prior close) on day 1" | prior close |
| 22 | "does not trade back to it" (the prior day's close) | prior close |
| 26 | "never trades back down to the red day's close (the gap holds)"; "the Kicker day trades back to the red day's close before it triggers (the gap filled)" | prior close |
| 25 | "No close at or under the gap-fill spot (the prior day's high) since the gap day"; a fill that reclaims the gap-up low "graded B- at best" | prior day's high, on a close |
| 27 | "For a full window, from the gap day's high (bottom edge) up to the prior day's low (top edge); for an overnight gap that is not a full window, up to the prior close"; "A close above the top edge fills the gap" | window edge, on a close |
| 43 | big gaps rarely fill the same day: "23% for 4-8%, 11% for 8%+; Bulkowski 23% for 3%+" | n/a |
| 38, 39 | the day-2 entry "while the gap stays unfilled" | prior close |

**Overrides.** 25 and 27 use the window's edge and a close because they trade the later retest of the zone.

**Conflicts to settle.** The prior close (20, 22, 26) against the prior day's high (25): both right for different
gaps. Ours: a card names the spot; a trade-through fills an overnight gap on day one, a close fills a window later.

### close_position

**Canonical definition.** Close position (DCR) is (close minus low) divided by (high minus low) of the session, from 0
to 1. A strong close is 0.5 or more; the top quarter (0.75 or more) is the A-grade cue. Each setup may set its own
floor and says so.

**Basis.** The dossiers' most common floor (20, 21, 22, 24, 25, 29, 32, 35: the upper half); the top quarter from 21
("A grade in the top quarter") and 23 ("closes in the top 25% of the range"); Duncan's "50% floor, 75% ideal" via 24.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 07 | the launch bar "the close in the top 35% of the day's range (0.65 or higher)" (ALLE at 0.65) | 0.65 |
| 08 | "prefer a close in the upper half of the inside day's range" (cue) | 0.5 |
| 13, 32 | the reclaim day "in the upper half of its range" | 0.5 |
| 15 | the pop day "in the top 40% of its range" | 0.6 |
| 16 | the drop day "close in the lower 40% of the day's range" | 0.4 (short) |
| 20 | "closes in the upper half of its range"; the Model Book's "top 25%" a grading cue | 0.5 |
| 21 | "in the top half of its range (DCR 0.5+); A grade in the top quarter" | 0.5; 0.75 |
| 22 | "closes in the upper half of its range"; "A close in the lower half is a B-; a red close is not this setup" | 0.5 |
| 23 | grade-up "closes in the top 25% of the range" | 0.75 |
| 24 | "in the upper half of the day's range (DCR 0.5 or more); 0.7 or more preferred"; "a strong close is NOT required" (CRBU 0.35 kept, COMP 0.41) | 0.5 (cue) |
| 25 | the test day "closes in the upper half of its range (a lower wick or a hammer)" | 0.5 |
| 26 | the Kicker day "in the top 20% of its range" (kept 81% to 100%); the red day "in the lowest 35% of its range" | 0.8; 0.35 |
| 29 | option B "closes in the top half of its range (DCR 0.5 or more)" | 0.5 |
| 30 | "a close in the top 10% of the range" a plus | 0.9 (cue) |
| 31 | the trigger day "closes in the top 30% of its range (DCR 0.7 or more)" (greats 0.78 to 0.99, QCOM 0.65) | 0.7 |
| 34 | the bounce "closes in its lower third" is the early warning | 0.33 |
| 35 | the reclaim day "in the upper half of its range" | 0.5 |
| 41 | the pivot candle "closes in the upper half of its range" (30-minute) | 0.5 |
| 44 | the drive day "closes below its open or in the bottom third of its range" has failed | 0.33 |

**Overrides.** 26 (0.8), 31 (0.7), 07 (0.65), 15 (0.6): each is the setup's own gate; 24 (a cue, by the owner's
words).

**Conflicts to settle.** None between dossiers beyond the per-setup floors. Ours: 0.5 as the default "strong close",
and a card that gates above it names its number.

### reclaim_window

**Canonical definition.** After an undercut of a level, the stock must close back above the level within 3 sessions,
counting the undercut session as the first; a same-session reclaim is the best grade. Longer than that is a breakdown,
and a stay of 5 closes or more under the level is a remount, not a reclaim.

**Basis.** The dossiers' most common choice (01, 05, 23, 28, 29, 34: 3 sessions); Sperandeo's "three to five days"
for an intermediate 2B and Turtle Soup's same day or Plus One, via 28.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 01 | "If price reclaims the low within 3 sessions, it is a U&R setup instead" | 3 |
| 05 | the IPO price: "A brief undercut that closes back above in 1 to 3 sessions is a U&R, graded B" | 3 |
| 11 | the one-day shakeout: "closes under it by no more than 0.5 ATR and the next session closes back above it" | 1 |
| 12 | "An undercut below the line is allowed only if the same day or the next day closes back above it" | 1 |
| 23 | "closes back above the pre-news close within 3 sessions" | 3 |
| 28 | "A close back above the prior low on the break day or within the next 3 sessions. Same day or next day is the better grade" | 3 |
| 29 | "Price closes back above L the same session or within the next 3; no more than 3 closes under L" | 3 |
| 34 | "Within 3 sessions after the flush day, a session trades below the flush low and then back above it" | 3 |
| 35 | "It closes back above the old range low the same day (one-bar), or the next day (two-bar). Later than that: not this setup" | 2 |
| 13, 32 | a remount needs "At least 5 consecutive closes" under the line first | 5+ |

**Overrides.** 35 (two days, the Wyckoff reading), 11 and 12 (the next session, a pullback shakeout rather than a
level).

**Conflicts to settle.** 3 against 2 against 1. And a gap: 29 allows "no more than 3 closes under L" while 32 needs
"at least 5", so a stay of 4 closes belongs to neither setup. Ours: the U&R family runs to 4 closes under the level,
the remount starts at 5 (the code's number, used in three places).

### remount

**Canonical definition.** To remount a line (an average, a level, VWAP) is to close back above it after price had
closed under it. The Remount setup is the case where the line was lost for at least 5 consecutive closes; fewer
closes under the line is an undercut and reclaim, an Oops, or a pullback shakeout (see `reclaim_window`).

**Basis.** 13 and 32 ("At least 5 consecutive closes below the line right before the reclaim day [UCT code: the member
check, `remount` and `draw:remount` all use 5]"; "Fewer than 5 is a U&R, Oops or pullback"); the owner's word for it
(13: "Remount (the owner's word)").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 13 | "At least 5 consecutive closes below the line"; "a brief undercut-and-rally of setups 11 and 12, not this setup" | 5+ |
| 32 | "At least 5 consecutive closes under it ... and at most 30"; "Calling a 1 to 4 day dip under the line a 'remount' (it is a pullback)" a mistake | 5 to 30 |
| 29 | the U&R: "no more than 3 closes under L ... Longer is a Remount (setup 32)" | up to 3 |
| 12 | the MAU&R: "An undercut below the line is allowed only if the same day or the next day closes back above it"; Bracco's "shakeout below 20ema and remount" | 1 |
| 11 | "undercut and reclaim"; a one-day shakeout closes back above the next session | 1 |
| 35 | the spring: UCT's "Shakeout below the 20EMA and remount" | 1 to 2 |
| 02 | the trigger "as price remounts the 9 and 20 EMAs" (a verb) | n/a |
| 40, 43 | "a VWAP remount" as an intraday entry (a verb) | n/a |
| 10 | Version H "the 'remounted all MAs' read" (a verb) | n/a |

**Overrides.** None; the verb is free on every card, the setup name is 13's and 32's.

**Conflicts to settle.** The 4-close gap between 29's "no more than 3" and 32's "at least 5" (conflict 21 under
`reclaim_window`). Ours: the U&R family runs to 4 closes, the Remount starts at 5.

### inside_day

**Canonical definition.** An inside day has a high below the prior day's high and a low above the prior day's low
(strict: a tie on either side does not count). It is the "quiet day" that arms a pause entry.

**Basis.** 08 ("Recommend strict for teaching, because it is the originator's"; Crabel, Bulkowski, the screener's
single "Inside Day"); the ties option is Brooks's and the scanners'.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 08 | "today's high is below yesterday's high and today's low is above yesterday's low"; options strict or "ties allowed (Brooks, our scanners, the screener's inside runs)"; a double inside day "two inside days in a row" | strict |
| 01 | "the last 3 sessions include an inside day" (the tightness test) | n/a |
| 13, 32 | the quiet day: "an inside day, or a day whose range is under 1 ATR" | or 1 ATR |
| 20, 21, 22 | the pause: "an inside day or tight day, then a break of its high" | n/a |
| 30 | scenario B: the inside day's low trades first, then the reclaim | n/a |
| 43 | "an orderly pullback, flag, inside day or higher low in the last 1 to 5 sessions" | n/a |

**Overrides.** 13 and 32 (the 1 ATR range as the alternative quiet day).

**Conflicts to settle.** Strict against ties (08: ties "did not do worse", "a choice for clarity, not for edge"; the
scanners allow ties). Ours: strict.

### red_to_green

**Canonical definition.** A red-to-green move: after trading below the prior day's official close, the stock trades at
least one cent above it during regular hours. The line is the prior close, never the day's open or VWAP. Green to red
is the mirror.

**Basis.** 43 (source consensus; the owner: "take out previous day close", 2026-11-01); `TRADE_PLANS.md` (the Go
Signal's entry: "the prior close when it traded that session (red to green)").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 43 | "trades at least one cent above it"; the A version "opens at least 0.7% below the prior close"; options the prior close (recommended) or the day's open | prior close |
| 42 | the Go Signal: "an hourly candle closes back above the prior close by the end of the second hourly candle" (a close, not a touch; question 4) | hourly close |
| 30 | the Oops: "price trades back above c1 AFTER the day has traded below l1. A touch of c1 before the undercut is not a trigger" | prior close |
| 11 | trigger A: "trades back above it (red to green; entry = the prior close)" | prior close |
| 20, 21 | the pause buy: "a red-to-green move through the prior close (the house 'Red to Green' entry trigger, SET.06)" | prior close |
| 23 | the long: "a market order when price trades back over the prior close (red to green) on the news day" | prior close |
| 25 | option D: "a red-to-green" on the test day | prior close |
| 44 | the mirror: the U-Turn is a different setup (the parabolic short) | n/a |

**Overrides.** 42 (an hourly close, not a trade-through), 30 (the undercut of the prior low must come first).

**Conflicts to settle.** Trade-through (43, 30) against an hourly close (42): ours, as each card says; the plain term
with no qualifier means the trade-through.

### touch

**Canonical definition.** A session touches a line (an average or a level) when its low is within 0.25 ATR above the
line or up to 1 ATR below it, and it closes at or above the line.

**Basis.** 11 and 12 ("the app's v5 lab thresholds, tuned on traders' calls": "within 0.25 ATR above to 1 ATR below
the 20 EMA"; "within 1 ATR under to 0.25 ATR over the line"); 09 reuses 0.25 ATR for a trendline touch.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 08 | "at the rising 10 or 20-day (within about 1 ATR of the 21 EMA)" | 1 ATR |
| 09 | "A touch is a swing high within about 0.25 ATR of the line" | 0.25 ATR |
| 11 | "The session's low comes within 0.25 ATR above to 1 ATR below the 20 EMA"; a close under by no more than 0.5 ATR reclaimed next session | 0.25 / 1 ATR |
| 12 | "within 1 ATR under to 0.25 ATR over the line" | 0.25 / 1 ATR |
| 14 | "between the 9-day EMA and about 1% under the 20-day EMA" (Chart IQ: a low up to 2% above the 20 EMA) | 1% |
| 17 | "low at or below that day's EMA and high at or above it"; option "a low within 0.25 ATR above the line" | 0 (0.25 ATR) |
| 18 | Kell's crossback: "the day's low within 1% of either, or an undercut of the 20 EMA that closes back above it" | 1% |
| 25 | the test day "reaches the gap-up low (within 0.25 ATR above it) or undercuts it by up to 5%" | 0.25 ATR / 5% |
| 26 | the red day's close "within 1.5 ATR of the 21-day EMA or the 50-day SMA" | 1.5 ATR |
| 30 | the Oops-day low "within 0.5 ATR of the rising 21-day EMA or 50-day SMA" | 0.5 ATR |
| 35 | a floor touch "two swing lows within about half an ATR of the range low" | 0.5 ATR |
| 41 | "'At' = the low within 1% above the level, or undercutting it" | 1% |
| 42 | "The session low reaches one of these, no more than about 3% under it" | 3% under |
| 43 | "the low before the cross is within 1% of the prior day's 9-day EMA, 20-day EMA, 50-day or 200-day SMA" | 1% |

**Overrides.** 26 (1.5 ATR is a location test for the red day, not a touch), 25 (the 5% undercut is the gap's own
tolerance), 42 (3% under, an hourly setup), 41 and 43 (1%, intraday setups where ATR is coarse).

**Conflicts to settle.** 0.25, 0.5, 1 and 1.5 ATR, 1% and 3% all mean "at the line" somewhere. Ours: the 11 and 12
band for every daily pullback; the intraday setups keep 1%; a question never shows two tolerances on one chart.

### swing_low

**Canonical definition.** A swing low is a session low with no lower low in the 5 sessions on each side; a swing high
is the mirror.

**Basis.** 28 ("'Swing low' = a daily low with no lower low in the 5 sessions on each side (the definition my check
used)"); 33 (swing highs "each higher than the 5 bars on either side").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 28 | "no lower low in the 5 sessions on each side" | 5 |
| 33 | "three swing highs (each higher than the 5 bars on either side)"; "the app uses 3-bar swings" | 5 (app 3) |
| 29 | "a swing low (under the 3 lows before it, not above the 3 after it) that price then bounced at least 5% off" | 3 |
| 09 | a touch "a swing high within about 0.25 ATR of the line" | unnamed |
| 11, 12 | "the highest high of the last 11 sessions" as the swing high | 11-session high |
| 17 | "the newly formed swing low: the lowest low from the touch session through the trigger session" | window |

**Overrides.** 11, 12 and 17 (a window high or low, not a swing).

**Conflicts to settle.** 5 against 3 (28, 33 against 29 and the app). Ours: 5.

### parabolic_burst

**Canonical definition.** Bracco's parabolic burst, as B26 defines it: a 3 to 5 day final leg with three straight up
days, two straight overnight gap ups, two of three days of range expansion, two days of rising volume, and a gap up
on the climax day; "the more boxes checked, the stronger". The parabolic long is the mirror, a burst down. Ours: the
climax-day gap is required and 3 of the other 4 boxes make the full-size grade.

**Basis.** The rulebook (B26 and D47, from Bracco's "The Parabolic Short"; the mirror confirmed "1, yes"). The
required gap and the 3-of-4 are 39's ("Need 3 of 4 for a full-size grade"; "The climax day opens above the prior
close. Required") and 38's ("Box 5 is required for the main version").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 39 | boxes (a) 3+ straight up closes, (b) 2+ straight overnight gap ups, (c) 2 of the last 3 days the gain beat the day before, (d) volume up 2 days in a row; "Need 3 of 4 for a full-size grade; 2 of 4 only with exceptional extension"; the climax gap required | 3 of 4 + gap |
| 38 | the mirror; "Box 5 is required for the main version"; "Two down days can stand in for three if range and ATR expand sharply" | gap + boxes |
| 34 | "At least 3 of these 5" (the gap down "on the climax day or the next morning") | 3 of 5 |
| 36 | "Recommend counting them like Bracco's stars, not requiring one" | count |
| 27 | Version P "lacks the climax-day gap up that his main setup requires"; whether B26's exception covers it is question 5 | no gap |
| 03 | adds "and the climax day closed below its open" | extra test |
| 16 | the Wedge Drop "comes days or weeks later, back at the averages"; the exception should not cover it | not covered |
| 22, 24, 44 | "not the 3rd to 5th day of a straight-up burst"; "not on day 3-5 of a parabolic burst" | avoid |
| 18 | Kullamägi's numbers "50-100%+ for large caps, 3-5+ up days" taught as his version | his |

**Overrides.** 34 (3 of 5, with the gap allowed the next morning), 27 Version P (pending the owner), 03 (its extra
close-below-open test for a pole that ended in a burst).

**Conflicts to settle.** How many boxes, and whether the climax gap is mandatory (27 against 38 and 39; 34's 3 of 5
against 39's 3 of 4 plus the gap). The rulebook gives no count. Ours as above; the owner confirms, and 27 Version P
waits on question 5.

### time_stop

**Canonical definition.** A trade still under 1R after 10 trading days is sold (C33).

**Basis.** The rulebook (C33: "a trade still under 1R after 10 trading days is sold, freeing the money", "33, yes").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| most | "Under 1R after 10 trading days, sell" | 10 |
| 17 | Raschke's faster version "no progress in 5 sessions, out"; measured as "still under +1R at the close of the 5th session"; question 7 | 5 (option) |
| 20 | "Bonde used 5 days. Ours is looser" | 5 (his) |
| 02 | Edwards and Magee's three-week limit "sits well" with C33 | 15 |
| 31 | the playbook: "A trigger that fades to flat by day 20 was not a Slingshot worth keeping" | 20 (playbook) |
| 34 | "if 1R is not reached within 3 sessions, sell"; "The rulebook's 10-day time stop (C33) is the fallback"; question 6 | 3 |
| 36 | "if there is no close back above the flush day's high within 3 sessions, sell"; "C33's 10 days stays as the outer limit"; question 5 | 3 |
| 38 | "Out at the close of the third session if the trade is under 1R"; question 5 | 3 |
| 39 | "if the 9 EMA is not reached within 3 sessions of entry, cover" | 3 |
| 30 | "possibly tighter for this setup (question 9)" | open |

**Overrides.** 34, 36, 38 and 39 propose 3 sessions, the 1 to 3 day life of a snap back (pending the owner); 17's 5
is an option only.

**Conflicts to settle.** 10 against 3 against 5. Ours: C33 stands as the outer limit on every card; the mean-reversion
family's 3 sessions is one pending override, decided once for all four.

### trail

**Canonical definition.** Sell a third at 3R and a third at 5R, move the stop to breakeven between 2R and 5R, and
trail the last third on a close under the 10-day average for a fast mover or the 21-day for a steadier one; a trim
level the day opens past is taken at the open (B19, E51, E52, F63).

**Basis.** The rulebook (B19, E51, E52, F63); `TRADE_PLANS.md` ("sell a third at 3R (B19, the hard rule), a third at
5R (E51), and trail the last third (E52 ...)").

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| most | the house defaults, unchanged | 3R, 5R, 10/21 |
| 11 | "keep the initial stop until the 20 EMA has risen above the entry; then breakeven and trail the 20 EMA close; once the 50-day SMA passes the entry, the trail may move to the 50-day"; question 10 | start later |
| 07 | "sell on a close under the 21-day EMA (E52, the 'steadier' trail)" (Manrav: "rides 8 and 21 EMAs") | 21 |
| 13 | "the 21-day for a fresh 200-day remount (an earlier-stage, steadier name)" | 21 |
| 03, 17, 20, 24, 26 | the 10-day (a fast mover by definition); 20 switches to the 21-day "only after it builds its first base" | 10 |
| 25 | the first trim "a third at the post-gap high or 3R, whichever is higher"; question 5 | post-gap high |
| 34 | "under each higher daily low until price closes back above the 10-day; after that, sell on a close below the 10-day" | higher lows |
| 36 | Option 2 "sell at least a third at the first test of the target average (the 20-day SMA or 20 EMA for longs ...)"; "Recommend Option 2 for this setup only"; question 4 | 20-day target |
| 38 | "Sell two thirds at the first touch of the 9 EMA or at 3R, whichever comes first; trail the last third under each prior day's low" | 9 EMA |
| 39 | "Cover at the daily 9 EMA"; "These replace the default 3R/5R trims and the 10/21-day trail for this setup"; question 6 | 9 EMA |
| 02, 21, 42, 43 | the owner's own habit "the 20 EMA"; 42: "which the 21-day matches" | 20 EMA |
| 18 | Kullamägi "10 or 20-day, first close below"; "sell 1/3 to 1/2 after 3-5 days" taught as his | his |

**Overrides.** 38 and 39 (D47 names the 9-day average as the parabolic short's target), 36 (pending question 4), 11
(the start of the trail for a buy made at the line), 25 (pending question 5), 34 (the higher-low trail until the
10-day is regained).

**Conflicts to settle.** The owner's own 20 EMA against E52's 21-day (see `fast_averages`); when the trail starts for
a buy at the line (11 question 10). Ours: E52 as written, with the 21-day taught as the 20 EMA.

### fast_averages

**Canonical definition.** The fast averages the courses name are the 20-day EMA (the owner's line) and the 50-day
SMA, with the 10-day average for fast movers and the 9-day EMA as a cue. The 21-day in E52 and the scanners is the
same line as the 20 EMA for teaching; the 200-day is always the simple average (B26).

**Basis.** 11 ("The 20-day EMA. [UCT: the owner and the Model Book say 20; originator: Raschke's 20-period EMA] The
21-day is the same line for teaching purposes (section 4.5)"); 12 ("Recommend A with 20 EMA and 50 SMA because UCT's
writers say '20EMA' and '50SMA' almost every time and SET.02 already teaches those lines"); 14 and 18 (the house 9/20
pair, Kell's 10/20); setupGroups.js names no averages.

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| 11 | "The 20-day EMA"; "if the owner prefers 21 for consistency with E52 and the scanners, change the word everywhere at once"; question 3 | 20 EMA |
| 12 | options A the Study stack "9 EMA, 20 EMA, 50 SMA, with the 10-day for fast leaders"; B the scanners' "10 EMA, 21 EMA, 50 SMA"; "rule E52's trail names a '10-day' and a '21-day' average and does not say which kind"; question 1 | 20 EMA, 50 SMA |
| 02 | "the rising 21-day EMA" (the app's judged check); the owner "let 20EMA guide the position" | 21 EMA |
| 03 | "a rising 10-day and a rising 21-day EMA" | 10, 21 EMA |
| 07 | the bundle "the 8 EMA, 21 EMA and 50 SMA (see question 5 for the 9/20/50 option; the numbers barely change)" | 8, 21, 50 |
| 08 | "the 21-day EMA rising"; "within about 1 ATR of the 21 EMA" | 21 EMA |
| 14 | "Teach the 9/20 pair and say Kell uses 10/20" | 9, 20 EMA |
| 15 | "the 10 and 20-day EMAs. [originator] (Option: our 9/20 EMA. Question 1.)" | 10, 20 EMA |
| 16 | "10/20 EMA (Kell); 9/20 (Model Book); 9/21 (app v3); 10/21 (house trail)"; "10/20 for the trigger ... Trail on the house 10/21" | 10, 20 |
| 17 | "20 EMA (Raschke, owner); 20 SMA (Woods, Capital.com); 21 EMA (our other scanners)"; recommend 20 EMA | 20 EMA |
| 18 | "(a) Kell's 10/20 EMA; (b) the house 9/20 EMA ... Recommend (a) for Kell lessons"; question 6 | 10/20 (Kell) |
| 26 | "within 1.5 ATR of the 21-day EMA or the 50-day SMA" | 21 EMA |
| 30 | "within 0.5 ATR of the rising 21-day EMA or 50-day SMA"; the trail "under the 10-day SMA" | 21 EMA; 10 SMA |
| 31 | the trail "a close under the 10-day EMA" | 10 EMA |
| 34 | "below the 5-day, 9 EMA and 20 EMA" | 5, 9, 20 |
| 38, 39 | the target "the daily 9 EMA" (Kullamägi's 10 and 20-day the outside alternative) | 9 EMA |
| 41 | "the rising 10 or 20-day EMA (the 8, 9 and 21 are fine)" | 10, 20 EMA |
| 42, 43 | "the 20-day EMA"; "the prior day's 9-day EMA, 20-day EMA, 50-day or 200-day SMA" | 20 EMA |
| 44 | the Nasdaq "above its rising 10 and 20 period moving average" (the owner's words) | 10, 20 |

**Overrides.** The Kell lessons (14, 15, 16, 18) name 10/20 as his; 07's 8/21/50 bundle (TraderLion's); 38 and 39's
9 EMA target (D47).

**Conflicts to settle.** 20 against 21, and 9 against 10, across twenty dossiers (11 Q3, 12 Q1, 15 Q1, 18 Q6, and the
E52 wording). Ours: the 20 EMA wherever the house speaks, "21-day" only when quoting E52 or a scanner, one sentence
in the course saying they are the same line, and the 10-day SMA for the fast trail and C29.

### market_reading

**Canonical definition.** The app's market reading decides how much the account trades: Green, full risk per grade
and up to 10 positions; Yellow, smaller and fewer; Orange, only A+ setups; Red, mostly cash plus shorts below the
200-day (B18, F65, D46). A guide, not a hard cap (A10).

**Basis.** The rulebook (B18 "there is a market filter for sure"; F65; D46; A10).

**How the dossiers vary.**

| Dossier | Their wording | Their number |
|---|---|---|
| most | "Green full; Yellow smaller and fewer; Orange A+ only; Red mostly cash and shorts" | F65 |
| 02, 11, 12 | the leading index "above a rising 20 EMA" as a second filter; 11 question 7 "whether this is a gate or a guide" | index 20 EMA |
| 14 | "the Nasdaq is not below its 20-day EMA, or a market Wedge Pop has just happened"; cutting Orange is the dossier's own; the QQQ filter "made little difference on its own" | index 20 EMA |
| 44 | the Nasdaq "trending higher above a rising 10 and 20 period moving average" (the owner's "WHEN" test) | index 10/20 |
| 07 | the finder's "worked" rate "was the same with SPY in an uptrend, a downtrend or mixed (24%, 24%, 25%)" | no edge |
| 16 | the short "The market reading is Orange or Red"; QQQ under its 50-day "the only regime with an edge" | Orange, Red |
| 27 | Version R "a Red or Orange reading"; the app's events "did worse when SPY was under its 200-day" | Orange, Red |
| 34 | "Capitulations happen in Orange and Red markets by nature"; question 7 | Orange, Red (long) |
| 36 | "A mean-reversion long there breaks D46 unless it is ruled an exception"; question 11 | Orange, Red (long) |
| 38 | "The best cases come in Orange or Red readings"; question 6 | Orange, Red (long) |
| 39 | "the market filter must allow this short in Green"; SPY above its 200-day for 92% of proxy events; question 10 | Green (short) |
| 20, 22 | Bonde: the market plays "no role"; the owner: EPs "the first longs to try as a correction ends" | guide |
| 25 | K-M: "highly dependent on the health of the general market" | guide |

**Overrides.** 34, 36 and 38 (longs in Orange or Red, pending 34 Q7, 36 Q11, 38 Q6), 39 (a short in Green, pending
Q10), 16 and 27 (shorts in Orange and Red, inside D46).

**Conflicts to settle.** The index-20-EMA habit as a gate or a guide (11, 12, 14); the mean-reversion and parabolic
setups against F65's reading. Ours: F65 as written; the index 20 EMA a grade cue; the four exceptions decided once
for the family.

---

## Conflicts across dossiers

The full list in one place, ordered by how many units each conflict would touch (a unit is one setup card). Where
two dossiers cannot both be right, the line names them and gives the resolution marked ours. "Units" counts the
cards whose criteria carry the term; the rulebook rules apply to every card, so a conflict inside a rulebook term
touches all 44.

| # | Conflict | Dossiers that split | Units | Resolution (ours) |
|---|---|---|---|---|
| 1 | `stop_width`: is A13's "about 3%" a cap, a target or a description, and what is the skip line (3%, 3.5%, 5%, 6%, 6.5%, 8%, 1 ATR, 1.5 ATR, one ADR)? | 01, 02, 03, 05, 07, 08, 10, 14, 18, 20, 22, 24, 26, 31, 35, 36, 38, 39, 40, 41; the brain template's 8% in 13 and 43 | 44 | A description; A5 sizes; the shared skip line is one ADR; a card's wider cap stands where its dossier names one; the owner confirms |
| 2 | `earnings_blackout`: B22's "3 days" as trading or calendar days | 07, 11 ask; 09, 14, 20, 29, 31 assume sessions | 44 | 3 trading sessions |
| 3 | `stretched`: which 10-day average C29 means (SMA or EMA) | 08 (CRCL passes on one, fails on the other); 07, 24, 30, 31 read it three ways | 44 | the 10-day SMA |
| 4 | `liquidity`: B23's averaging window (50, 30, 20 sessions, the event day) and the price date (before the gap or at the entry) | 05, 06, 07, 11, 14, 20, 22, 24, 29 | 44 | 50 sessions before the setup day; the price at the entry; HVE and EP exceptions are owner questions |
| 5 | `leader`: "strongest groups" has no number in C31 | 05 (top quarter), 17 (top fifth as an example) | 44 | the top quarter of the app's group ranking, pending the owner |
| 6 | `average_volume`: the denominator of every volume multiple (50-day against 20-day against the pattern's own sessions) | 32 (20-day), 05, 15 (own sessions), 12 (prior 20 bars), 40 and 44 (window) against the rest | 40 | 50 sessions for daily readings; the window's own 20 for intraday bars; 32 moves to 50 |
| 7 | `fast_averages`: 20 against 21 EMA, 9 against 10 EMA, and which kind E52 means | 02, 03, 07, 08, 11, 12, 13, 14, 15, 16, 17, 18, 26, 30, 31, 34, 36, 41, 42, 43 | 20 | 20 EMA for the house, 21 only when quoting E52 or a scanner, one sentence that they are the same line; the 10-day SMA for the fast trail |
| 8 | `rising_average`: the window for "rising" (200-day over 20 or 21 sessions; 20 EMA over 5 or 10) | 06, 12 (21); 11, 12 (20 EMA over 10) against 14, 42, 43 (5); 13 and 26 add tolerances | 16 | 200-day over 20, 50-day over 10, 20 EMA over 5 |
| 9 | `tight`: a fixed percent, a ratio, an ATR cap or half the depth | 01, 03, 04, 05, 26, 42 (fixed); 02, 09, 15, 18 (ratio); 13, 16, 31, 32 (ATR) | 15 | the 0.85 ratio as the default; a card that keeps another form says so |
| 10 | `volume_surge`: the breakout-day number (1.2x, 1.4x, 1.5x) | 07, 09 (1.2); 01, 03, 04, 05, 06 (1.4); 21, 26, 27 (1.5) | 15 | 1.4x of the 50-day as the A-grade cue |
| 11 | `leader`: pending exemptions from RS 80 (young listings, launchpads, 4B-, 200-day remounts, pops, neglected gappers, HVE, 2B and U&R washouts, failed tops) | 05, 06, 07, 10, 13, 15, 20, 22, 23, 24, 28, 29, 32, 33 | 14 | C31 as written; each exemption is an owner decision in `DECISIONS.md` |
| 12 | `dry_up`: the yardstick (50-day, the pattern's own first part, up against down days) and gate against cue | 06 (gate) against 14, 17 (cue); 02, 03, 04 (own part); 05, 16 (up against down) | 14 | the 50-day average, a cue; 06 keeps its gate |
| 13 | `touch`: the tolerance for "at the line" (0.25, 0.5, 1, 1.5 ATR; 1%; 3%) | 08, 09, 11, 12, 14, 17, 18, 25, 26, 30, 35, 41, 42, 43 | 13 | 0.25 ATR above to 1 ATR below for daily pullbacks; 1% for the intraday setups |
| 14 | `close_position`: the floor for a "strong close" (0.5, 0.6, 0.65, 0.7, 0.8; cue or gate) | 07, 15, 24, 26, 31 against the upper-half majority | 12 | 0.5 default; a card names its own floor |
| 15 | `stretched`: C29 on gap-day and record-volume entries (65% to 86% of EP opens, 16 of 18 named gappers, a median 41% for HVE) | 05, 07, 20, 21, 22, 24, 26, 29, 37, 40, 44 | 12 | C29 as written until the owner rules; the pause and day-2 entries are the way in |
| 16 | `opening_range`: 30 minutes (the Kicker ruling) against the 5-minute range (44's recommended default) | 40, 26 (30) against 44, 18, 38, 39, 27 (5 or less); 20, 21, 22 allow both | 11 | "opening range" means 30 minutes; the 5-minute form is always written "5-minute ORH" |
| 17 | `chase_limit`: the buy point on gap and reclaim setups, and ATR caps beside the 4% | 07, 09, 13, 19, 20, 21, 22, 25, 32, 35 | 10 | the card's trigger level; the ATR caps are grade cues |
| 18 | `prior_trend`: the number (30, 25, 20) and the window (65, 63, 120, 126, the 52-week high) | 01, 02, 03, 04, 06, 12, 18, 33, 36; 07 and 10 want a decline first | 10 | 30% over 65 sessions for bases; the Trend Template an A+ cue |
| 19 | `market_reading`: the index-20-EMA filter as a gate or a guide; longs in Orange or Red and shorts in Green for the mean-reversion and parabolic family | 02, 11, 12, 14 (index); 16, 27, 34, 36, 38, 39 (regime) | 10 | F65 as written; the index 20 EMA a grade cue; the family's exceptions decided once |
| 20 | `gap`: the floor that names the setup (4%, 4% + 0.75 ATR, 5%, 8%, 10%; 1 ATR or 4%) | 20 (10), 21 (4 + ATR), 22 (4), 23 (4; Chart IQ 5), 25 (4; posts 2-3), 27, 31, 43, 19 | 9 | the floor names the setup: 4% to 10% a PEG or gapper, 10% and over an EP; 23 at 4%; 25's posts to the owner |
| 21 | `reclaim_window`: 3 against 2 against 1 session, and the 4-close gap between the U&R (up to 3) and the remount (from 5) | 01, 05, 23, 28, 29, 34 (3); 35 (2); 11, 12 (1); 13, 32 (5) | 9 | 3 sessions; the U&R family runs to 4 closes, the remount starts at 5 |
| 22 | `trail`: setup-specific trails and targets (the 9 EMA, the 20-day, the post-gap high, higher lows, a later start) | 07, 11, 13, 24, 25, 34, 36, 38, 39 | 9 | E52 as written; 38 and 39 keep the 9 EMA by D47; 11, 25, 36 pending |
| 23 | `session`: the month equivalents (63 against 65; 120 against 126) | 01, 04, 06 against 18, 20; 05, 10 (252) | 7 | 63 and 126; a card keeps its dossier's number and names it |
| 24 | `time_stop`: 10 days (C33) against 3 sessions (the snap backs) against 5 (Raschke, Bonde) | 34, 36, 38, 39 (3); 17, 20 (5); 30 (open) | 7 | C33 the outer limit; the 3-session override decided once for the family |
| 25 | `parabolic_burst`: the box count and whether the climax gap is mandatory | 39 (3 of 4 plus the gap), 38 (gap required), 34 (3 of 5), 27 (no gap), 03, 16 | 6 | the climax gap required plus 3 of the other 4; 27 Version P waits on its question 5 |
| 26 | `above_200`: a gap day that opens under the 200-day and closes over it | 13, 20, 21, 22, 24, 26 | 6 | the close counts |
| 27 | `ma_stack`: the fast pair (9 or 10 above 20, 20 above 50) as a gate or a cue | 11, 12, 14, 18 (gate) against 07, 08 (cue) | 6 | the long order (close above the 50 above the 200) gates every long card; the fast pair gates only the pullback and crossback cards |
| 28 | `above_200`: a stock with no 200-day yet (E53 sets no IPO rule) | 05, 29, 37, 43; 06 (the scanner passes automatically under 200 bars) | 5 | the 50-day SMA stands in until 200 sessions exist, pending the owner |
| 29 | `volume_surge`: the intraday "on pace" reading (the full ADV in 15 to 30 minutes; 1.5x the window's average; 2x the bar's average) | 20, 22, 26, 40, 44 | 5 | on pace against the 50-day average for the day; the window tests (40, 44) are the ORB's and the drive's own gates |
| 30 | `gap_fill`: the fill spot (the prior close against the prior day's high) and trade-through against a close | 20, 22, 26 against 25, 27 | 5 | the card names the spot; a trade-through on day one, a close for a later window |
| 31 | `base_length`: the flag's ceiling (15, then "not a flag" past 20) against the HTF's 5 to 30 and the Qullamaggie base's 10 to 40; the flat base's 25 against the owner's 15 | 01, 02, 03, 05, 18 | 5 | the pole decides; over 20 sessions with no pole is a base; 01's 25 to the owner |
| 32 | `base_depth`: the boundaries (18's 25% against the owner's MRAM at 34-42%; 02's 15% against 03's 25%; 31's 5-12 against the record's 5-9) | 01, 02, 03, 18, 31 | 5 | keep each dossier's number; the three boundary cases to the owner |
| 33 | `atr`: 14 against 20 against 40 sessions | 18, 21, 38 against the 14-day majority | 4 | 14, except where a card quotes the originator's own length |
| 34 | `hourly_bar`: 60 clock-aligned against Kell's 65 | 42 against 14, 16, 18 | 4 | 60; Kell's 65 named as his |
| 35 | `swing_low`: 5 sessions each side against 3 | 28, 33 against 29 and the app | 4 | 5 |
| 36 | `left_side_high`: the lookback that makes a high the base's first high or an anchor (100, 150, 250, 252) | 01 against 19, 27, 10 | 4 | 100 for a base's left-side high; anchors and tops keep theirs and the card names which |
| 37 | `adr`: Kullamägi's stop cap read as 1 ADR or 1.5 ATR | 18, 20 against 22 | 3 | 1 ADR |
| 38 | `red_to_green`: a trade-through against an hourly close | 30, 43 against 42 | 3 | as each card says; the plain term means the trade-through |
| 39 | `ceiling`: the touch tolerance (0.5 against 0.25 ATR) and the spacing (the first touch 10 sessions back against anchors 5 apart) | 01, 35 against 09 | 3 | 0.5 ATR for a flat level, 0.25 ATR for a sloping line; touches 5 apart, the first 10 before the trigger |
| 40 | `wide_and_loose`: an invalidation against a grade-down | 01, 06 against 16 | 3 | an invalidation on base cards; a grade-down on the Wedge Drop |
| 41 | `earnings_reaction_day`: the Kicker's outright earnings-day ban against the owner's kept VTRS and IMAX | 26; 21 (a non-earnings news gap as a PEG) | 2 | the ban stands for the drafts; the two examples to the owner |
| 42 | `base_count`: a third base banned against graded down | 01 against 04 (06 both ways) | 2 | graded down, B- at best, not banned |
| 43 | `flat_drift`: 10% of the average close against a quarter of the range height | 01 against 35 | 2 | 01's rule for a base, 35's for a Wyckoff range; the lookalike lines say so |
| 44 | `inside_day`: strict against ties | 08 against the scanners | 1 | strict |

**Gaps, not conflicts** (no dossier gives a number; the glossary proposes one marked ours): `stop_margin` ($0.03),
`leader`'s "strongest groups" (the top quarter), `stretched`'s kind of 10-day average (SMA), `above_200` with no
200-day (the 50-day stands in), `earnings_blackout`'s day type (sessions), `hourly_bar`'s length (60 minutes).

**What this glossary could not resolve on its own.** Every "ours" above is a proposal; the five that change what a
member is taught the most, and that need the owner before the pilot card is final, are: the stop-width skip line
(conflict 1), the 20 against 21 EMA wording (7), C29 on gap-day entries (15), the opening-range window (16) and the
RS 80 exemptions (11). The `average_volume` fix in 32 (the code's 20-day gate) is a code change, not a docs change, and
is only noted here. The pilot card's four alias ids (`depth`, `breakout_volume`, `rs_rating`, `stop_day_low`) are
accepted so it validates; the next cards use the heading ids.
