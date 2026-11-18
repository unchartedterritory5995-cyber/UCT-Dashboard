# The named-indicator library: what each formula was checked against

2026-11-18. The library is `api/data/named_indicators.json`; how it is used is in
`api/services/named_indicators.py`. This file is the evidence behind each entry's `evidence` block.

A named indicator in the library is built to **one** formula. Three kinds of evidence stand behind it.

| tier | what it is | where it lives |
|---|---|---|
| (a) | an independent plain-Python calculation it is held equal to, at its default numbers and at other numbers | `tests/test_named_indicators_values.py` (runs on every change) |
| (b) | who defined it, and the page the definition was read on | each entry's `evidence.published` |
| (c) | TradingView's own built-in indicator, captured and compared bar by bar | this file |

Tiers (a) and (b) are required before the assistant may build a name. Tier (c) exists only where
TradingView ships the indicator as a built-in.

## Tier (c): against TradingView's built-ins

**Method.** One capture session. Each built-in was added from TradingView's Indicators dialog (its
standard library, not a community script) at its default settings, on two daily charts:

- AMEX:SPY, 8,509 bars, from the 1993 listing;
- NYSE:RDDT, 668 bars, from its listing (a short history, to show warm-up).

Every input's value was read back from the chart. All were TradingView's defaults, and all equal the
library's defaults. The library's tree at those numbers was then run through the server's evaluator
(`ast_interpret.interpret`) on the captured bars and compared with TradingView's plotted value on every
bar where both have one. A bar is **equal** within one part in a billion.

The captures are vendor data and are **not** in this repository. `grade_builtins.py` and
`grade_builtins_why.py` are the grading scripts; they need the capture files on the machine that runs
them.

**Result.**

| entry | TradingView built-in | SPY | RDDT | grade |
|---|---|---|---|---|
| Chaikin Money Flow | Chaikin money flow | 8,490 of 8,490 | 649 of 649 | EQUAL |
| Ultimate Oscillator | Ultimate oscillator | 8,481 of 8,481 | 640 of 640 | EQUAL |
| Awesome Oscillator | Awesome oscillator | 8,476 of 8,476 | 635 of 635 | EQUAL |
| Coppock Curve | Coppock curve | 8,486 of 8,486 | 645 of 645 | EQUAL |
| True Strength Index | True strength index | 8,472 of 8,472 | 631 of 631 | EQUAL |
| Vortex Indicator (VI+ and VI-) | Vortex indicator | 8,495 of 8,495 each | 654 of 654 each | EQUAL |
| Choppiness Index | Choppiness index | 8,495 of 8,495 | 654 of 654 | EQUAL |
| Elder Ray (bull + bear) | Bull bear power | 8,497 of 8,497 | 656 of 656 | EQUAL |
| Connors RSI | Connors RSI | 8,378 of 8,407 | 541 of 566 | EQUAL AFTER WARM-UP |
| Chandelier Exit (long and short) | Chandelier exit | 8,202 of 8,487 | 317 of 646 | EQUAL AFTER WARM-UP |
| McGinley Dynamic | McGinley dynamic | 8,201 of 8,209 | 70 of 368 | FORMULA EQUAL, RESTART DIFFERS |

Not TradingView built-ins (community scripts only), so no capture: Kaufman Adaptive Moving Average,
Squeeze Momentum Indicator. They stand on tiers (a) and (b).

### The three that are not equal on every bar, and exactly why

**Connors RSI.** Every unequal bar is between bar 102 and bar 130, on both charts. After bar 130 it is
equal on every bar. The streak inside it is a running value the engine first knows 100 bars in, and its
2-bar RSI needs a few bars more to settle.

**Chandelier Exit.** The unequal bars are one unbroken run from the first bar to about bar 355, and the
difference shrinks on every bar: 2% at bar 27, under a millionth of a percent by bar 355. UCT's ATR is
Wilder's original (the first value is the plain mean of the first true ranges); TradingView's is seeded
one bar earlier. The two converge and never part again. This is the engine's standing ATR convention
(`closedTable.json`, `_functions_atr_convention`), not something particular to this entry.

**McGinley Dynamic.** TradingView's line **is** this formula. Carried from the mean of the first 14
closes, the way TradingView carries it, the recursion equals TradingView's value on all 8,495 SPY bars
and all 654 RDDT bars. UCT does not carry a running value from the first bar; it restarts it 300 bars
back on every bar. That restart is within 3 parts in a billion on SPY (8 bars differ at all) and within
0.015% on RDDT, a young stock in a long rise, where this line is slow to forget where it started. So
the library records the grade and claims nothing about TradingView for this entry, and the door's own
note on the built indicator says a chart computed from the first bar can differ.

### What a member is told

The door adds one sentence to each output built to a library formula.

- EQUAL: "... and equal to TradingView's own on captured charts."
- EQUAL AFTER WARM-UP: "... and equal to TradingView's own after the first bars of captured charts."
- anything else: no mention of TradingView.

## The running-value window (300 bars)

Three library entries read their own previous value. The engine recomputes such a value from a fixed
number of bars back on every bar. `running_witness.pine` is a script of three such values that
TradingView carries from the first bar; it was captured on AMEX:SPY daily (8,509 bars) and graded by
`grade_running_witness.py` at three windows. Bars equal within one part in a billion:

| shape | 100 bars | 300 bars | 900 bars |
|---|---|---|---|
| a McGinley line that divides by 8.4 (settles) | 1.7%, worst 6 millionths | 100% | 100% |
| an up-day streak (a count) | 100% | 100% | 100% |
| a level that only rises since the listing | 54%, worst 40% off | 66%, worst 34% off | 82%, worst 20% off |

What it decided:

- **300 bars is the default.** A settling value of ordinary speed is equal at 300 and not at 100.
- **A count is exact** while the real count is shorter than the window. The longest up streak in 33
  years of SPY is 14.
- **A level carried from the listing cannot be reproduced** at any window the engine allows. This is a
  known limit of a windowed running value. The door says so on every output built from one.

## Slice 2: four more entries (same day)

Double Exponential Moving Average, Triple Exponential Moving Average, Chande Momentum Oscillator and
Stochastic RSI. Each has tier (a) (an independent calculation, at its defaults and at other numbers) and
tier (b) (the pages read are in the entry). Where sources give different default lengths, the entry's
note says which it uses and why (TradingView's built-in default, since that is the chart a member
compares against).

All four are TradingView built-ins and were captured in a second session (the same method, the same
two charts) and graded by `grade_builtins2.py`:

| entry | TradingView built-in | SPY | RDDT | grade |
|---|---|---|---|---|
| Double Exponential Moving Average | Double exponential moving average | 8,493 of 8,493 | 652 of 652 | EQUAL |
| Triple Exponential Moving Average | Triple exponential moving average | 8,485 of 8,485 | 644 of 644 | EQUAL |
| Chande Momentum Oscillator | Chande momentum oscillator | 8,500 of 8,500 | 659 of 659 | EQUAL |
| Stochastic RSI (K and D) | Stochastic RSI | 8,480 and 8,478, all | 639 and 637, all | EQUAL |

**The Detrended Price Oscillator is not in the library yet, and the capture says why it can be.** No
page read states what "length / 2 + 1" bars back means at TradingView's default length of 21. The
capture does: close minus the 21-bar average from **11** bars back equals TradingView's default plot on
all 8,478 bars (10 and 12 match none). So the half is taken as a whole number. The entry waits only on
the library being able to hold a parameter whose number sits in the formula in a derived form.

## Held names: known by name, no checked formula

These are in the library file under `held`. Each has **no formula at all**. Named alone, each is refused
by name, in any spelling, before any model call, and the refusal is the way forward: describe the rule
in your own words. Named beside the member's own description of the rule, the description is built and
labelled as the member's own formula.

| name | why it has no checked formula yet |
|---|---|
| TTM Squeeze | John Carter's own formula was not confirmed on a page read. The sources that describe it disagree about the channel's range. The Squeeze Momentum Indicator is in the library under its own author's name. |
| Pocket Pivot | The authors' rules page states the volume rule only. Whether the day must itself be an up day, and how a down-volume day is defined, were not confirmed on their pages. UCT's own readers use "an up day on more volume than any down day of the prior 10"; a chart formula should be proved equal to that before it is offered under the name. |
| Mansfield Relative Strength | The Screener already has a column of that name; a chart formula for it belongs with the Screener's columns (`chart_twins`), proved equal to that column. |

## The whole-phrase rule for unknown names: measured before it was written

**The gap.** A Title-Case run of words the planner does not know is refused before any model call. But
the rule fired only when *no* word of the run was known, so a name with one ordinary word in it
("Schaff Trend Cycle", "Klinger Volume Oscillator") passed, and reached a model free to improvise.

**The corpus.** 877 distinct requests: the plain-English phrasing corpus (34), every evaluation case's
words (45), the requests of the live rounds (102), the worked examples (5), and 140 indicator ideas each
written five ways (as its plain description, after "Add", after "Add the" in Title Case, mid-sentence in
Title Case, and alone in Title Case).

**What was tried, and what each cost.** New refusals among requests that pass today:

| rule | real requests (186) | Title-Case idea names (138) | what went wrong |
|---|---|---|---|
| any unaccounted word makes the run unknown | 0 | 43 | refuses plain descriptions: "Previous Week High And Low", "Linear Regression Slope" |
| ... except words of the product's own vocabulary | 0 | 15 | still catches sentences typed in capitals |
| ... and only runs of at most four words | 0 | 10 | none of these; but excusing *every* first word of a sentence let every name typed alone through |
| ... and only a closed list of request openers is excused for standing first (**shipped**) | 0 | 10 | the same 10 however they are written |

**The 10.** Chande Momentum Oscillator, Detrended Price Oscillator, Double EMA, Triple EMA, Zero-Lag EMA,
EMA Ribbon, Klinger Volume Oscillator, Minervini Trend Template, TD Sequential Setup Count, and one plain
description ("Median With Interquartile Band", which holds a word the product has never used). Three of
them (Double EMA, Triple EMA, Chande Momentum Oscillator) went into the library in the same change, so
they are built to a checked formula rather than refused.

**Where it applies.** The chart conversation door only (`plan(strict_names=True)`). The Screener door's
planner is unchanged. An unknown name's refusal on the chart door now ends with the way forward:
describe the rule in your own words.

**A request opener is grammar (slice 3).** The same measurement showed the *older* rule refusing
requests it should never have touched. A request that opens with a verb has a capital on the verb, so
"Add Inside bar" read as an indicator called "Add Inside" and was refused before any model call. So did
"Show Weekly pivot points", "Highlight Mondays", "Mark Fridays in blue" and "Add The 10:00 bar marked".
Of 140 indicator ideas written "Add <Idea>", 56 were refused for that reason alone. On the chart door,
an opener standing first in its sentence is now taken off the run before the question "is this a name?"
is asked: those 56 fall to 4 (two held names and two genuine unknown names), and a real name after an
opener is still caught, named without the opener ("Gann Fan", never "Add Gann Fan").

A second option was measured and rejected: treating a *single* capitalised word that nothing accounts
for as an unknown name. Without a dictionary it cannot tell an eponym ("Klinger") from an ordinary word
("Distribution", "Support", "Drawdown"), and it refused 27 more plain "Add <Idea>" requests and one
evaluation case ("... when the sector is Technology"). A single-word proper name stays outside this
rule; the library catches the ones it holds, by lookup.

**"Moving average" (slice 3): a question, never an assumption.** The bare phrase was no phrase of the
chart door, so "Plot the Moving Average" and "Add a 50 day Moving Average" were unknown named
indicators. It is a term now ("moving average", "MA", "DMA").

*Owner ruling, 2026-11-18:* members say which kind they mean ("50 EMA", "a 50 day simple moving
average"); when they do not, the product asks and never assumes. So for a new indicator the door itself
asks "Which kind of moving average?" with the kinds as choices, before any model call: the same
question every time, at no cost. Each choice is a phrase the door reads back as that kind, so the
member's answer builds. A kind named in the request builds without a question. Beside an indicator
already on the chart, the assistant reads the chart under the same rule (ask unless the member's words
or the chart settle it).

Ten first-turn requests on file said only "moving average" or "MA". Three of them are sentences this
repository ships as examples of a request and its build, and all three build simple averages; each now
says "simple" (two house indicators' request sentences and one evaluation case).

**What it does not do.** A name written in lowercase is not a Title-Case run and is not caught by this
rule; a held or library name is caught in any spelling, because it is looked up, not guessed from shape.

## Library slice 3: twelve classics, chosen by a measurement

**The measurement (2026-11-18).** 140 well-known indicator names were put to the chart door as
"Add the <Name>". 93 were refused by name. 35 reached the assistant with no formula of ours behind
the name, so whatever was built came from its own recollection. 12 resolved to a function the engine
already has. Two of the refused names are indicators the ENGINE HAS THE PARTS FOR ("Directional
Movement Index", "Aroon Oscillator"); and the engine's `obvN` and `pvtN` are windowed changes, not
the classic running lines members mean by On Balance Volume and Price Volume Trend.

**The entries.** Aroon (up, down and the oscillator, one entry), Directional Movement Index (+DI,
-DI, ADX), On Balance Volume, Accumulation Distribution Line, Price Volume Trend, Percentage Price
Oscillator, Know Sure Thing, Mass Index, Force Index, Ease of Movement, Negative Volume Index, Ulcer
Index. Each is at tier (a) and (b): an independent calculation written from the published
definition, compared bar by bar at the default numbers and at other numbers written at the entry's
parameter sites (`tests/test_named_indicators_values.py`), and a published definition read on
2026-11-18 (eleven from StockCharts ChartSchool; Price Volume Trend from TradingView's help
center). They were then graded against TradingView's built-ins (the third batch, below).

**What the pages do not state, and how each point was settled** (`tests/test_named_indicators_slice3.py`):

| point | the page | settled by |
|---|---|---|
| Aroon: is the window N bars or N + 1 | not stated; "days since" runs 0 to N | a check: a high set exactly N bars ago still counts and reads 0, so it is this bar and the N before it |
| Aroon: which of two equal highs counts | not stated | a check with two equal highs and two equal lows in one window: the most recent |
| Running totals: where they start | On Balance Volume's page says its level depends on the start | a check: the level moves with the first loaded bar and the bar-to-bar changes do not. Negative Volume Index starts at 1000 on that bar |
| A bar with no range, an unchanged close, unchanged or no volume | stated only for On Balance Volume's unchanged close | a check on bars made to have each: an unchanged close leaves On Balance Volume unchanged; a bar with no range adds 0 to the Accumulation Distribution Line (as Chaikin Money Flow already does here) and reads 0 in Ease of Movement, which UCT writes as distance x range / scaled volume, the same number with no division by the range; a bar with no volume counts as 0 there; volume that is not lower leaves the Negative Volume Index unchanged |
| Know Sure Thing: which rate of change | the page does not restate it | the percent form (x 100), as ChartSchool's own rate-of-change page defines it and as this engine's `roc` is |

**Left out, each for a stated reason.** TRIX: neither page read gives the scale of its percent
change and vendors differ (one uses the logarithm of price), so it waits for a capture. Detrended
Price Oscillator: its displacement is a number derived from the length, which the library cannot
express as a parameter yet. Stochastic: "stochastic oscillator" already names the engine's own %K.

**One spelling, one indicator.** "Triple exponential average" is TRIX's formal name, and it was a
spelling of the Triple Exponential Moving Average. It has been removed: an ambiguous spelling does
not belong in a lookup.

**A check on the checks.** `test_CONTROL_no_reference_accepts_another_outputs_formula` evaluates
every output's formula once and holds it against every reference calculation in the library: only
its own may agree.

**Acronyms.** A bare two- or three-letter acronym is never a library spelling ("OBV", "DMI",
"PPO"): several are real tickers. A request that uses only the acronym is not looked up, and is
counted by the name catalogue as that name, so the weekly report shows how often it happens.

## The third batch: slice 3 against TradingView's built-ins

Run `builtin3-2026-11-18`, graded by `grade_builtins3.py` (beside this file): the same two daily
charts as before (SPY, 8,509 bars; RDDT, 668), TradingView's settings set to each entry's defaults
and read back from its dialog. All twelve are TradingView built-ins. The capture itself is vendor
data and stays out of the repository; only these verdicts are recorded.

| entry | verdict |
|---|---|
| Aroon | EQUAL on every bar (Up and Down; TradingView's built-in draws no oscillator) |
| On Balance Volume | EQUAL on every bar |
| Accumulation Distribution Line | EQUAL on every bar |
| Price Volume Trend | EQUAL on every bar |
| Percentage Price Oscillator | EQUAL on every bar (oscillator, signal, histogram) |
| Know Sure Thing | EQUAL on every bar (both lines) |
| Mass Index | EQUAL on every bar |
| Force Index | EQUAL on every bar |
| Ulcer Index | EQUAL on every bar |
| Ease of Movement | EQUAL on every bar at TradingView's divisor, 10,000 |
| Directional Movement Index | formula equal; ONE rounding tie differs |
| Negative Volume Index | differs BY DEFINITION |

**Ease of Movement: the divisor became a setting (version 2).** Version 1 held ChartSchool's
100,000,000 as a fixed number, and its values were exactly 10,000 times TradingView's: the same
shape at another size. TradingView's dialog has a Divisor, 10,000 by default. It is a setting here
too, with that default, and the entry's first version keeps the fingerprint it shipped with.

**Directional Movement Index: one bar of 8,509.** All three lines are equal on every bar of RDDT,
and -DI on every bar of SPY. On SPY, +DI and ADX part on one bar and need about 400 bars of
Wilder's smoothing to meet again. On that bar the up move and the down move are both 9 cents; in
floating point the up move is larger by 3 parts in 100 trillion. UCT counts it as the larger (the
published rule: the up move counts when it is greater than the down move); TradingView counts the
two as equal and gives neither. The entry therefore says nothing about TradingView. Whether the
engine should compare the two moves as prices (to the tick) is a question for the engine.

**Negative Volume Index: two definitions under one name.** TradingView's built-in compounds: prior
NVI x (1 + the price change) on a lower-volume day, from 1000, and a calculation written that way
is equal to it on every bar. The pages read, TradingView's own help page among them, describe the
additive form (prior NVI + the percent change), and that is what this entry holds. Wikipedia and
TA-Lib's documentation state the compounding form. The entry says nothing about TradingView until
it is decided which form the name should mean here.

**Two indicators the capture informs and the library still leaves out.**
TRIX: TradingView's built-in is 10,000 x the one-bar change of the triple average of the LOGARITHM
of price (equal on every bar when computed that way). Every page read, TradingView's help page
included, describes the percent change of the triple average of price, which is about a hundredth
of that size. Two definitions again, so no entry yet.
Detrended Price Oscillator, length 20: TradingView's uncentred line is the close minus the average
of 11 bars ago (length / 2 + 1), equal on every bar. ChartSchool's is the centred form, which
leaves the last bars blank. It waits for a displacement the library can derive from the length.
