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

