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

One entry stands on (a) and something else in place of (b): it **follows UCT's own reader**. Where the
product already computes an indicator in one place, and no page read states the rule whole, the entry
is the chart formula of that reader, proved equal to it bar for bar by a test that imports the reader
and runs it (`evidence.house`). Pocket Pivot is the first; its section is at the end of this file.

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

(Pocket Pivot was the third held name until later the same day. It is a library entry now: see
"Pocket Pivot: it follows UCT's own reader" at the end of this file.)

These are in the library file under `held`. Each has **no formula at all**. Named alone, each is refused
by name, in any spelling, before any model call, and the refusal is the way forward: describe the rule
in your own words. Named beside the member's own description of the rule, the description is built and
labelled as the member's own formula.

| name | why it has no checked formula yet |
|---|---|
| TTM Squeeze | John Carter's own formula was not confirmed on a page read. The sources that describe it disagree about the channel's range. The Squeeze Momentum Indicator is in the library under its own author's name. |
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

**Acronyms.** A bare two- or three-letter acronym is never a library ALIAS ("OBV", "DMI", "PPO"):
several are real tickers. (Since the ruling below, four entries carry an acronym in a field of
their own, read inside the Create Indicator door only.)

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
| Negative Volume Index | as first entered (the additive form): differs BY DEFINITION. Version 2, below: EQUAL on every bar |
| TRIX (added after this batch, below) | EQUAL on every bar |

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

## The withheld name: a well-known name with no checked formula is built, and not under that name

**What was measured first.** Of 140 well-known indicator names put to the door, 35 reached the
assistant with nothing saying UCT has no formula for them, and were built from its recollection
under the name, as if UCT stood behind it; 93 were refused before any call, including names whose
arithmetic the engine can do.

**The rule (ruling 2026-11-18).** The name catalogue marks 57 names `distinctive`: a coined word or
a person's name for one specific calculation on price and volume (Klinger Volume Oscillator, Schaff
Trend Cycle, Fisher Transform, QQE). For these, and only these:

1. the name is a term of the chart door, so the request reaches the assistant with the rule to
   build what the name is generally understood to compute, to name the indicator and every line by
   what it computes, and to say in plain words what it built;
2. the door refuses a change that writes the name on the chart anyway (a full spelling, its
   abbreviation, or a word that belongs to that name alone, such as "Klinger"): one repair, and
   wrong twice ends in a refusal;
3. the door itself tells the member, on every output, that the name is not in the checked library
   and to check the formula before relying on it;
4. the member's own name for their indicator ("call it Klinger") is theirs to give.

Left as they were: descriptive phrases a member may mean literally, drawing tools and patterns
(Gann Fan, Elliott Wave), chart types (Renko), and anything that needs data a chart formula cannot
read (market breadth). Those keep the unknown-name answer and its way forward. A library name is
the library's. A bare two- or three-letter acronym is never looked up.

**Its words are that name's and no other's.** A withheld name is recognised whole. Its words do
not join the product's vocabulary, so "Fisher" inside any other Title-Case name is still a foreign
word and that other name is still an unknown name.

**Measured before it was turned on**, with no model call, over the requests on file: every request
that fires the rule literally names that indicator (no misread), and no request's answer changed
without one. The counts are in the report to the engine session, not here.

## Two names with two definitions each: what was decided (2026-11-18)

The third capture showed two indicators whose published descriptions and whose TradingView
built-ins are different calculations under one name. Each was decided, and each entry says which.

**Negative Volume Index: it compounds (version 2).** Prior NVI x (1 + the price change) on a
lower-volume day, from 1000. That is Fosback's form as Wikipedia and TA-Lib's documentation state
it, and what TradingView's built-in computes: graded again, the index and its 255-bar EMA are equal
on every bar of both charts. Some references (ChartSchool, TradingView's help page) describe an
additive form; the entry's note says so. Version 1, the additive form, keeps the fingerprint it
shipped with.

**TRIX: TradingView's own form, with the capture as its source.** 10,000 x the one-bar change of a
triple EMA of the logarithm of price: equal to TradingView's built-in on every bar of both charts
(graded at length 15; the entry's default is TradingView's, 18). Every page read describes a
percent change of the triple EMA of price, about a hundredth of that size, and none states a
multiplier. Members compare with what TradingView plots, so the entry follows it, and what the
member is told says exactly that instead of "the definition published by": whose form it follows,
what that form is, and that some references describe another. Only an entry graded equal on every
bar may say it follows a capture (`named_indicators.follows_a_capture`).
"Triple exponential average", TRIX's formal name, is its spelling now.

**Directional Movement Index: the one bar, exactly.** SPY, 2014-04-03 (bar 5333 of 8,509). The
high rose from 189.13 to 189.22 and the low fell from 188.14 to 188.05: both moves are 9 cents.
The four prices are stored exactly as those ticks. Subtracted as binary floating point the up move
is 0.09000000000000341 and the down move 0.08999999999997499, so UCT counts the up move as the
larger and TradingView counts a tie. No engine change was made for it; it is recorded as a known
precision difference, and the entry still says nothing about TradingView.

## The shipped-version ledger

"An entry's maths never changes under the same version" was held by the fingerprint stored in the
library file itself. A library file regenerated with empty fingerprints, which is how the entries
above were written, could therefore move a shipped entry's formula and record the new fingerprint
as if it had always been version 1, and nothing went red. It was found while Ease of Movement and
the Negative Volume Index were being given a second version; each first version's fingerprint was
then pinned by hand.

`api/data/named_indicators_shipped.json` closes it for every entry: each (entry, version) is
recorded once, with its fingerprint, when it ships. The build tool refuses a library whose recorded
version moved, even when the file carries no fingerprint to compare with, and one that lost a
recorded entry or version; `--ship` adds what is new and never rewrites a recorded line; `--check`
fails while a version is unrecorded. Proved by changing a shipped formula through the seed and
watching the build refuse it (`tests/test_named_indicators_ledger.py`).

## Acronyms: four admitted, under four conditions (ruling 2026-11-18)

Inside the Create Indicator door a bare word is an indicator request, so an entry may be named by
its acronym, as its own `acronyms` field (an alias is still never a bare short word):
**OBV, PPO, PVT, KST.**

| condition | how it is held |
|---|---|
| (1) it names exactly one indicator UCT knows by name | each is the initials of its own entry and of no other library entry or name-catalogue row, and is no word of the product's own. The same check refuses ADL (also Advance Decline Line) and DMI (also Dynamic Momentum Index); ADX is the engine's own function word |
| (2) every request on file that uses it reads as that indicator | THE REQUESTS ON FILE COULD NOT SAY. Of 909, one used an admitted acronym, and it was written to test this. So it is watched instead: each build that came from an acronym is its own row of the weekly report, with how often the member's next turn in that conversation removed or rewrote what was built |
| (3) the reply names the indicator in full | the door's own sentence begins "Built to UCT's checked formula for On Balance Volume" (said once for the indicator) |
| (4) a symbol beside it is still the symbol | "OBV of AAPL" names the entry and reads AAPL. The acronym itself is never read as a symbol, even where the same letters are a real ticker (PVT): a patch that reads the symbol PVT for "Add PVT" is refused as a symbol the member never asked for. "PVT.TO" and "XYZ.PVT" are symbols and are left alone |

An acronym names the library's formula and nothing looser: a patch that holds another formula for
"Add OBV" is sent back once and then refused, exactly as for the full name.

## Letters that mean two indicators are a question (ruling 2026-11-18)

**DMI** is the Directional Movement Index and the Dynamic Momentum Index. **ADL** and **AD** are the
Accumulation Distribution Line and the Advance Decline Line. The door neither guesses nor gives the
unknown-name answer. It asks which, with no model call, through the same question registry as "which
kind of moving average", the likeliest meaning first.

| the member answers | what happens |
|---|---|
| the one in the library (Directional Movement Index; Accumulation Distribution Line) | built to the checked formula, in one call |
| a well-known name with no checked formula (Dynamic Momentum Index) | built with the name withheld, as for that name written in full |
| a name UCT does not build (Advance Decline Line: it needs every stock in the market) | that name's own answer and the way forward; the question is not asked again, and nothing is remembered |

The answer is remembered like any other, shown and changeable in Settings ("What DMI means"), used
next time, and said: "Reading DMI as the Directional Movement Index, as you chose before. Name the
other one to change it." Naming either indicator in full is never overridden by the memory.

"AD" is read in capitals only (an "ad" is a word). The letters inside a longer word ("headline") or
as a symbol with a suffix ("ADL.TO") are not the acronym.

**Every clash of initials that touches the library is decided, and a test holds the list:** DMI and
ADL are asked; AO, CC, PP, SMI and TS are not admitted as acronyms at all (nobody writes those
letters for both names), so none of them is ever guessed. A new library entry whose initials clash
with another indicator fails that test until someone decides.

Because "DMI" now means two things, it is no longer a spelling of one row in the name catalogue.

### A defect this work found, and what the instruments gained

Writing the test for "the remembered answer, then a library build" found a live defect in the
remembered-choice path: the door's "as you chose before" sentence has no `output`, and adding it to
an answer that ALREADY carried a note raised, so the member read an internal error. Every earlier
test of that path answered with a patch that carried no note. Fixed in one line (#1822).

So that the two cannot fail to meet again, an evaluation case can now say what the member chose
before (`remembers`) and what the answer must say (`says`). Two cases use them: a remembered kind
beside the assistant's own note, and a remembered acronym followed by a library build. With the
faulty line put back, the case fails.

## In the window: a library indicator's Inputs and read-back (rulings 2026-11-18)

Read in the live window after the library landed. None of it failed a test.

| what a member saw | what it is now |
|---|---|
| KAMA: "Inputs 8", among them "2 plus 1 amount" and "2 divided by (30 plus 1) divisor" | 3: Efficiency length, Fast length, Slow length |
| On Balance Volume: one input, "0 minus Volume amount" | none |
| KAMA's efficiency length was two inputs (it sits in two places), so one could be changed alone | one setting; a change is one patch with one edit per place, applied whole or not at all |
| The Directional Movement Index's length was three inputs | one length for +DI, -DI and ADX |
| KAMA read back as "the running value that starts at close and becomes (the running value so far plus ((((((..." | "a moving average that speeds up when price moves cleanly and slows down when it chops (efficiency length 10, fast length 2, slow length 30)" |

**How the window knows.** It holds the library's public half (`checkedLibrary.json`, generated by
`tools/named_indicators_build.py`; `--check` fails when it is stale). A formula IS a library output
when it has that output's shape: the door's own rule (`output_in`), ported. Nothing is stored on a
saved indicator, so there was nothing to migrate.

**Two implementations of one rule are held together by one list of cases.**
`tests/fixtures/authoring/checked_library_cases.json` (583 cases, written by
`tools/checked_library_cases.py`): every output at its defaults, at other numbers, inside a larger
formula, under and over each range, a fraction where a count is needed, one number in one place and
another in the next, a member's own input driving a setting, and a number that is not a setting
changed. Each case's answer is known by construction. The door and the window must both agree.

**Each output says what it is in one phrase** (`says`, 43 of them, written by a person). The formula
in words is one tap away in the window ("The full formula, in words"), and the Formula tab holds the
formula itself.

**A setting's range is its validity range** (ruling). The formula is what is checked, not each
value, so any value the maths can take is still UCT's checked formula. The ranges were round caps:
a KAMA slow length of 401 was refused for no reason of the maths. Now a count of bars may be as long
as the chart's own history (5,000 bars: a longer one could never have a value); the Bollinger
multiplier keeps TradingView's own input limits (0.001 to 50); the Keltner and Chandelier
multipliers, which TradingView leaves unlimited, take 0.001 to 1000.

**An edited copy stops claiming the name** (ruling). When a change leaves a formula that is no
longer the library's, a title that named the indicator gives way to the name derived from the maths,
and the read-back says "No longer UCT's checked formula for Kaufman Adaptive Moving Average: the
formula was edited." where a title still names it. A title the member chose themselves is kept.

Not built: recognising a SUPERSEDED version (Ease of Movement v1, NVI v1). The library keeps an old
version's fingerprint, not its formula, and those two were live for about an hour with no members.
An indicator saved with one reads as the member's own formula.

## Positive Volume Index

A well-known name the library did not hold, and one a build from scratch does not fit: a running
product from the first bar reaches past the history budget. It is the Negative Volume Index's twin
with the volume test reversed, so it is entered the same way.

| | |
|---|---|
| Formula | `1000 * exp(cum(volume > volume[1] ? ln(close / close[1]) : 0))`, and a 255-period EMA of it as the signal |
| Published definition (tier b) | Fosback's form as the Wikipedia article "Negative volume index" gives it (read 2026-11-18): on a higher-volume period, prior PVI + prior PVI x the price change; otherwise unchanged. The page gives the base as "such as 100" and the signal as a one-year moving average, with no kind named |
| Value check (tier a) | `tests/test_named_indicators_values.py::positive_volume_index`: the step written bar by bar, against the entry's exponential of a running total of logs, on every bar, at the default and at another signal length |
| Capture against TradingView's built-in | EQUAL (run studio-builtins-2026-11-18: SPY daily from its listing, 8,509 bars). The index is equal on all 8,509 bars and its signal on all 8,255 it has a value for, absent on the same bars; the largest relative difference is 1 part in 100 trillion. It settles the two choices this entry took from the Negative Volume Index: it starts at 1000 on the first bar, and its signal is a 255-period EMA (seeded, as TradingView's is, with the average of its first 255 values) |

A day of equal volume leaves it unchanged (volume must be strictly above the bar before, as the capture confirms). The name is no longer in the list of names UCT withholds. With the capture it stands on all three tiers.

## Fisher Transform: offered as a function, on a capture

The 32nd entry, and the first whose formula is several LINKED running values that are
path-dependent by their shape. (It is listed further up among the names UCT withholds: it left
that list by being checked, as a name does.)

| | |
|---|---|
| Formula | `fisher(length)`, and the trigger line `fisher(length)[1]`. The function stands for the whole recurrence (`callExpansions.js::fisherTree`, mirrored on the server): x = where the bar's midpoint (hl2) sits in its range over `length` bars; value = 0.66 x (x - 0.5) + 0.67 x the previous value, then SNAPPED (above 0.99 it becomes 0.999, below -0.99 it becomes -0.999); fisher = 0.5 x ln((1 + value) / (1 - value)) + 0.5 x the previous fisher |
| Published definition (tier b) | Tulip Indicators' page and its source (LGPL v3), read 2026-11-18, citing Ehlers (Stocks & Commodities V.20:11). The page gives the smoothing and the log; the snap is in the source only. TradingView's help page gives only the transform. Another vendor publishes a different form under the same name (0.5 and 0.5 smoothing, a quarter of the log, a 0.9999 cap): this entry is TradingView's |
| Value check (tier a) | `tests/test_named_indicators_values.py::fisher_transform`: the recursion written bar by bar, restarted 300 bars back as the engine holds it, against the entry on every settled bar at two lengths; and the restarted value against the same recursion carried from the first bar (equal to the last digit; a restart of 6 bars is not) |
| Capture against TradingView's built-in | EQUAL AFTER WARM-UP (run studio-builtins-2026-11-18: SPY daily from its listing, 8,509 bars, lengths 9 and 20). Both lines are equal on every bar this entry has a value for: 8,209 of 8,209 at each length, the largest relative difference 3 parts in 10 quadrillion. The trigger is the Fisher line one bar earlier on every bar |

**Why it is a function and not a written-out formula.** The formula language cannot name an
intermediate result, so the snap writes the smoothed value three times and the Fisher line needs it
twice more on the same bar: 401 nodes a line. Written out, the assistant could not produce it (its
answer has a length limit), the view sent with a follow-up request was 49 KB against the 32 KB a
request may carry, and its one length sat in 54 places. As `fisher(9)` it is one node with one
number, as SuperTrend and Parabolic SAR are.

**Why it is offered at all.** The value it feeds back is snapped by a choice on its own value, so by
its shape nothing proves that where it started stops mattering, and Create Indicator refuses that
shape when it is written out by hand (ruling 2026-11-18: several linked running values are built
from a member's words only when they provably settle). This one is offered on evidence instead, per
indicator: the capture above shows the 300-bar restart equal to TradingView's own carried values on
every bar it has one.

**The grade is the grade of one tree.** `tests/fixtures/ast/fisher_graded.json` holds the hash of
the formula tree that was graded at each length. Both builders (the window's and the server's) are
held to it and to each other byte for byte, so the code cannot drift from what was graded. A change
that moves a hash is a new formula and needs a new grade.

**What it costs.** It is recomputed from 300 bars back on every bar, so the first 300 bars of a
chart's history have no value, where TradingView's has one from the first full range. With 300 bars
of restart a length past 659 reaches further back than any formula may, and is refused for that.

No Pine name was added: Pine has no `ta.fisher`, and the translator has no entry for this function.

## Laguerre Filter and Laguerre RSI: offered as functions, on two tiers

The 33rd and 34th entries. (Both are listed further up among the names UCT withholds: they left
that list by being checked, as a name does.)

| | Laguerre Filter | Laguerre RSI |
|---|---|---|
| Formula | `laguerre((high + low) / 2, gamma)`, gamma 0.8 | `laguerreRsi(close, gamma)`, gamma 0.5 |
| What the function stands for | four linked running values (`callExpansions.js::laguerreStage`, mirrored on the server): L0 = (1 - gamma) x source + gamma x the previous L0; L1 = -gamma x L0 + the previous L0 + gamma x the previous L1; L2 and L3 the same, one stage on. The filter is (L0 + 2 L1 + 2 L2 + L3) / 6 | the same four stages; 0.5 + 0.5 x (L0 - L3) / (the sizes of the three gaps between neighbouring stages, added). 0 to 1 |
| Published definition (tier b) | MotiveWave's studies page, read 2026-11-18, crediting Ehlers ("Time Warp - Without Space Travel"). The page writes alpha, the share of the NEW price; this entry writes Ehlers' gamma, the share each stage KEEPS (gamma = 1 - alpha, so the page's default 0.2 is 0.8 here) | the same page: each neighbouring pair's gap goes to cu when the earlier stage is at or above the later one and to cd otherwise; rsi = cu / (cu + cd) |
| Value check (tier a) | `tests/test_named_indicators_values.py::laguerre_filter`: the four stages carried bar by bar from the first bar, against the entry on every settled bar at two gammas | `::laguerre_rsi`: the same stages and the cu and cd sums as published, with their if-branches, against the entry; two bars worked by hand hold the sums to starting from 0 on every bar |
| Capture (tier c) | none, and none is claimed | none, and none is claimed |

**What the published page leaves unsaid, and what this entry takes.** The page does not say that
cu and cd start from 0 on each bar. This entry takes them so: carried from bar to bar they would be
running totals and the result would not be an oscillator. The note on the entry says it.

**Why the RSI is written from the first and last stage.** The three gaps telescope: cu - cd is
L0 - L3, and cu + cd is the sum of the gaps' sizes, so 0.5 + 0.5 x (L0 - L3) / that sum is
cu / (cu + cd), the same number. It reads the stages eight times where the published wording reads
them thirty-six, which would write out three times what a formula may hold. The value check is
written the published way, so it is also the check that the two are the same.

**Why they are functions.** The formula language cannot name an intermediate result, so each stage
writes the stage before it out again: the filter is about 500 nodes and the RSI about 740, and
written the published way the RSI is over two thousand. The assistant cannot write that and a
formula may not hold it. As `laguerreRsi(close, 0.5)` it is one node with one number.

**Why they settle, and how the restart window is sized.** Unlike the Fisher Transform, these need no
per-indicator exception: every stage is a plain-number mix of the four, the shape whose starting
values provably stop mattering (`api/services/running_values.py`). How long that takes depends on
gamma: 27 bars at 0.5, 82 at 0.8, 354 at 0.95, and more than a chart formula may reach from about
0.97. So the function restarts the stages a number of bars back that is sized from gamma (64 bars
up to 0.5, 128 to 0.7, 192 to 0.8, 400 to 0.9, 800 to 0.95), each leaving less than a billionth of
the start at its largest gamma, and declines a gamma above 0.95 with a sentence saying why.
`tests/test_call_expansions_parity.py` holds each window to that rule, with a control.

**What was captured, and what it is evidence of.** TradingView has no Laguerre Filter or Laguerre
RSI of its own, so there is no built-in to grade against and nothing here "matches TradingView's".
A probe written from the published equations was run on TradingView (run studio-laguerre-2026-11-18:
SPY daily from its listing, 8,509 bars; vendor data, not in the repository) and compared with these
trees through this engine: the filter is equal on all 8,317 bars it has a value for to 1 part in a
quadrillion, the RSI on all 8,445 to 2 parts in 100 billion (what a 64-bar restart leaves). With the
restart cut to 20 bars the same comparison is 20% off, and one stage paired against another's plot
disagrees on 8,200 bars, so the comparison can fail. That is TradingView running OUR equations
carried from the first bar: it witnesses this engine's restart, not the equations. It is recorded
as that and the entries carry no capture tier.

**The grade is the grade of one tree.** `tests/fixtures/ast/laguerre_graded.json` holds the hash of
each tree that was compared. Both builders are held to it and to each other byte for byte.

**What it costs.** The first bars of a chart's history, up to the restart window, have no value.

No Pine name was added: Pine has no Laguerre function, and the translator has no entry for these.

## Detrended Price Oscillator: a function because one number is derived from another

The 35th entry. It was left out of slice 3 for one reason: how far back it reads is DERIVED from
its length (half the length, plus one), and a library entry records where each setting's number
sits with no way to say that.

| | |
|---|---|
| Formula | `dpo(close, length)`, length 21. The function writes: the source minus its `length`-bar simple average AS IT STOOD floor(length / 2) + 1 bars ago (`callExpansions.js`, mirrored on the server). An exact closed form over the table, as `roc` and `mom` are; it reads back as its call and has one number in Inputs |
| Whose form it is | TradingView's built-in in its DEFAULT (not centred) form. The entry FOLLOWS that capture (the rule TRIX set: only an entry graded equal on every bar may) |
| Page read (2026-11-18) | StockCharts ChartSchool, "Detrended Price Oscillator (DPO)". It describes the TEXTBOOK form: the average displaced X/2 + 1 periods so that it sits in the middle of its look-back, with the oscillator itself displaced to the left. TradingView's own help article for the indicator could not be fetched (404), so nothing here quotes it |
| Value check (tier a) | `tests/test_named_indicators_values.py::detrended_price_oscillator`: the same arithmetic written out with integer division, against the entry at lengths 21, 20, 14, 15, 2 and 1; a count one off fails |
| Capture (tier c) | EQUAL. Lengths 21 (run builtin2-2026-11-18) and 20 (run builtin3-2026-11-18), Centered off, on SPY daily from its listing (8,509 bars) and RDDT (668): equal on every bar both have a value for, largest relative difference 0 |

**The two forms are different numbers.** The textbook form compares the price half-the-length-plus-one
bars back with today's average and is drawn shifted that many bars into the past (TradingView's
Centered option). The default form compares today's price with the average as it stood that many
bars ago, and is drawn on the bar it is computed on. This entry is the default form: it is what a
member comparing charts will see, and it puts nothing on bars that have already closed.

**The floor is pinned on an odd and an even length.** 21 and 20 both read the average 11 bars back.
Graded through this engine at both, on both charts, and controlled: one bar more or less of
displacement disagrees on all but a handful of 8,478 bars, and the Centered capture disagrees on
every bar.

**Why a function and not a derived place.** Teaching the library that one number is a function of
another would change the build tool, the case generator, the window's Inputs and the door, in two
languages, for one entry. The expansion module already holds exact closed forms that are read back
as their call (ruling 2026-11-18, the route chosen).

No Pine name was added: the translator has no entry for this function.

**Its acronym.** DPO is admitted inside Create Indicator, a fifth beside the four above, under the
same four conditions: it is the initials of this entry's name, of no other indicator UCT knows by
name, and no word of the product's own.

## Stochastic Oscillator: one entry for fast, slow and full, and a question for which

The 36th entry, and the last name on the list slice 3's measurement produced.

| | |
|---|---|
| Formula | %K = `sma(stoch(high, low, close, {K length}), {K smoothing})`; %D = the simple average of %K over `{D smoothing}` bars. K smoothing 1 is the FAST Stochastic, 3 the SLOW one, any other number the FULL one. Defaults 14, 3, 3 |
| Published definition (tier b) | StockCharts ChartSchool, "Stochastic Oscillator (Fast, Slow, and Full)", read 2026-11-18: %K = (close - lowest low) / (highest high - lowest low) x 100 over 14 periods; Fast %D a 3-period simple average of it; Slow smooths %K by 3 first; Full by X. Credited to George C. Lane |
| Value check (tier a) | `tests/test_named_indicators_values.py::stochastic_oscillator`: %K worked from the highs, lows and closes bar by bar, against the entry at the defaults and at (21, 1, 5); the fast %K is the textbook %K itself; with the close written first the same call fails |
| Capture (tier c) | none yet. TradingView's built-in is being captured at (14, 1, 3) and (14, 3, 3); until it is graded the entry says nothing about TradingView |

**Why it had no entry, and what members got.** "Stochastic Oscillator" was already the phrase of the
engine's raw %K function, so the library could not answer it and the request reached the assistant
as a bare function. It then built a Stochastic from recollection, and wrote the bar's fields in
TradingView's order (close first), which this engine reads as a different number on every bar. "Add
the Stochastic" and "a slow stochastic" were recognised by nothing.

**The full name is the library's now.** An entry may declare the engine function it is the indicator
of (`names_function`), and takes a phrase held by that function alone. This is the one case in which
a phrase the lexicon already answers is replaced, and one entry uses it.

**The bare word is never a spelling of it.** "Stochastic" is part of other names (Stochastic RSI,
Stochastic Momentum Index) and of descriptions ("the stochastic of the RSI"); as a spelling of this
entry it would answer all of them. The entry's spellings are its full name and "slow", "fast" and
"full" with it.

**Which one: asked, not assumed.** The slow Stochastic (14, 3, 3) is what members write; the fast one
(14, 1, 3) is TradingView's default. They are different lines. A request that says neither a kind nor
any number, by the full name or by the bare word, is asked "Which Stochastic?" (slow listed first),
with no assistant call. The choice is remembered, used next time, and said each time.

## Pocket Pivot: it follows UCT's own reader (ruling 2026-11-18)

**Why it was held.** The authors' own rules page states the volume rule only. No page read states the
whole rule, so there was no published definition to hold a formula to, and a formula written from
recollection would have gone out under a name it had not earned.

**What changed.** The product already has ONE Pocket Pivot: the Screener's base structure,
`api/services/screener/base_catalog.py::_detect_pocket_pivot` (sourced there to Morales and Kacher). Every
one of its tests is a fact of the bar, so it can be written as a chart formula and the two can be
proved equal. The entry is that formula. There is one authority, the detector; the chart can never
mark a bar the Screener would not.

**The six tests** (the numbers are the detector's own and are not settings):

1. an up day: the close above the close before;
2. the close in the top half of the bar's range (exactly half counts);
3. at least one down day in the 10 sessions before, and volume above the largest volume of those
   down days (equal does not count; a flat day is not a down day; the newest bar is not in the window);
4. the close at or above its 50-day and its 200-day simple averages;
5. not stretched: the low not above the 10-day average;
6. not in a long downtrend: the close above where it closed 105 bars ago.

What the authors leave to judgement (the fundamentals, a constructive base, permission to disregard a
red volume day) is not in the detector and is not in the formula.

**The proof** is `tests/test_library_pocket_pivot.py`. It imports the detector and runs it; nothing in
it restates the rule.

| over | bars compared | bars the detector fires on | bars where the two differ |
|---|---|---|---|
| six random daily walks, every bar from the first | 5,400 | (asserted: at least 20 in three of them) | 0 |
| twenty-four hand-built cases, every bar | each a 260-bar history (one is 199 bars) | 9 fire on the newest bar, 15 do not | 0 |
| SPY daily, the bars of the built-in captures (private; the bars are a vendor's and are not committed) | 8,509 | 101 | 0 |
| RDDT daily, the same | 668 | 1 | 0 |

The hand-built set holds each tie on its own bar: the close exactly at mid-range, volume exactly equal
to the largest down-day volume and one share above it, a down day exactly ten sessions back and one
eleven back, a down day on no volume, a flat day on heavy volume, the low exactly on the 10-day
average, the close exactly where it was 105 bars ago, a bar with no range, and one bar short of the
200-day.

**The set is proved to exercise every test.** The formula is eight conditions joined by "and". With any
one removed, it disagrees with the detector somewhere in the hand-built set; a test asserts that for
each of the eight.

**Deliberate breaks** (each turned the proof red; every file restored):

| the detector, changed so that | caught |
|---|---|
| volume equal to the largest down day passes | yes |
| an unchanged close counts as an up day | yes |
| exactly mid-range fails | yes |
| the 200-day test is dropped | yes |
| the low exactly on the 10-day average fails | yes |
| a close equal to 105 bars ago passes | yes |
| the window is one session longer | yes |
| a flat day counts as a down day | no on the first run: no case held a flat day. Two were added; yes |

and, in a test, each of the detector's three declared numbers moved (the window 10 to 9, the top half
0.5 to 0.6, the downtrend 105 to 100): the proof finds the bars.

**What a member is told.** "Built to UCT's checked formula for Pocket Pivot: it follows UCT's own Pocket
Pivot, the one the Screener's base structures use (Morales and Kacher's volume rule with their stated
conditions), and is equal to it bar for bar." It never says "published by", and it says nothing about
any vendor.

**What it is not.** The Screener's Bar Character column has a label for "an up day whose volume tops
recent selling". That is the volume half alone and was deliberately not named Pocket Pivot there. The
library's entry is the base structure's, with all six tests.

## Names that are UCT's own built-in indicators: answered, with an offer to add (ruling 2026-11-18)

**What a member met.** "Add the RS Rating" was read as a formula to write. The door asked which symbol to
compare with, and the assistant then wrote a ratio under a name that means a rank across every stock. The
RS Rating is one of UCT's own indicators, computed by the server; so is RS Phases. Neither is a formula a
chart can hold.

**The rule.** Such a name is in the library file under `held` with `built_in` {indicator, name, what}. It
has no formula. `indicator` and `name` are the native registry's own id and name, read from the registry's
source by a test, so a rename there fails rather than a member being told to look for a name that is gone.

| the browser | the answer | assistant calls |
|---|---|---|
| accepts an offer AND said it can add that indicator now | answered: what it is, and one button, "Add UCT RS Rating to this chart" | 0 |
| any other (an older tab; a build that does not offer it; a window that cannot write the chart) | told it is one of UCT's own indicators and to look for it in the Indicators list; no button | 0 |

**Only what the build can add is offered.** The window tells the door which of these indicators its own
registry offers right now, by the question the Indicators list itself asks (a definition the live server
does not publish is not offered). The door offers nothing else. The tap asks the same question again before
it writes, never adds a second copy of one already on the chart, and makes the Indicators list's own write.

**An offer names a library built-in or it is nothing.** The answer carries an indicator id. The window acts
on it only when that id is one of the built-in names it shipped with; the name and the button's words are
the window's own. A conversation read back from the session keeps the words and has no button.

**The member's own rule beside the name** ("rs rating: the close divided by SPY over 252 bars") is still
built as their own formula and labelled as theirs.

Deliberate breaks, each turning a test red: seven at the door (an offer to a browser that did not say it
can add it; a browser that does not accept one; a built-in read as an ordinary held name; a record with a
field missing; the two sentences; the bound on what a browser may list) and ten in the window (the tap not
asking again; every built-in listed whether offered or not; a restored offer; a second copy; the door never
told; a window that cannot write saying it can; any kind of action; any registry definition; a taken offer
left on the entry; the offer dropped from the answer).

### Mansfield Relative Strength: where it is today

The first plan was to point this name at the built-in Relative Strength indicator's Mansfield reading. Read
before a word was written: in the build members run, that indicator has no Reading control and no preset,
and no built-in draws Mansfield on a chart. So the name stays held, and its answer says where the number
is: "Mansfield Relative Strength is a Screener column in UCT today (the Screener, under Relative Strength,
as "Mansfield RS"), not a chart line yet", then the member's own words as before. A test holds the label
and the group to the Screener's own. A chart formula was ruled out: it would be a second join beside the
Screener's, and after a missing benchmark bar the two would differ. When a built-in that draws the
Screener's own column exists, the name points at it with the offer above.
