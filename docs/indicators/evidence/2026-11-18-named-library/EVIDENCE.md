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

## Names that were held out, and why

| name | why it is not in the library yet |
|---|---|
| TTM Squeeze | John Carter's own formula was not confirmed on a page read. The sources that describe it disagree about the channel's range. The Squeeze Momentum Indicator is in the library under its own author's name. |
| Pocket Pivot | The authors' rules page states the volume rule only. Whether the day must itself be an up day was not confirmed on that page. |
| Mansfield Relative Strength | The Screener already has a column of that name; a chart formula for it belongs with the Screener's columns (`chart_twins`), proved equal to that column. |
