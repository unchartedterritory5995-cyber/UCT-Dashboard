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
tier (b) (the pages read are in the entry). All four are TradingView built-ins; their captures are
queued, and until they are graded the entries carry no capture and claim nothing about TradingView.
Where sources give different default lengths, the entry's note says which it uses and why (TradingView's
built-in default, since that is the chart a member compares against).

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

**What it does not do.** A name written in lowercase is not a Title-Case run and is not caught by this
rule; a held or library name is caught in any spelling, because it is looked up, not guessed from shape.
