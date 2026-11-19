# An up day is a close above the previous close: evidence

**The ruling (owner, 2026-11-18).** An up DAY is a close above the PREVIOUS close; a down day is a
close below it. That is how the common up/down volume ratio counts days. A close above its own
OPEN is an up BAR, a green candle.

**What it changed.** Before it, the house set held both meanings: the distribution day and the
follow-through day compared the close with the previous close, while two indicators compared it
with the open. Those two are re-derived as version 2:

| house indicator | version 1 | version 2 |
|---|---|---|
| Up/Down Volume Ratio (50) | volume on days that closed above the open, over volume on days that closed below it | volume on days that closed above the previous close, over volume on days that closed below it |
| Volume with 50 Average | blue / pink when the bar closed above / below its open on volume 40% above average | blue / pink when the day closed above / below the previous close on volume 40% above average |

Nothing else in either definition moved: the plots, colours, levels, shading and settings are the
same, and only the labels derived from the formula follow it. `before_after.py` is how that is
known: it rebuilds version 1 from version 2 by putting that one comparison back, and
`tests/test_house_up_day.py` holds that the rewrite changes these two and nothing else.

## Before and after, on committed bars

Bars: `tests/fixtures/alerts/replay_bars.json` → `spy_daily`, 400 daily bars, 2024-12-30 to
2026-08-05. Both versions are evaluated by the server's own evaluator. The numbers below are
`before_after.json`, recomputed by the test on every run.

**The day itself.** Of the 399 days that have a previous close, the two definitions disagree on
**76** (19%).

| | close vs open | close vs previous close |
|---|---|---|
| up days | 212 | 222 |
| down days | 186 | 177 |

**Up/Down Volume Ratio (50).**

| | version 1 | version 2 |
|---|---|---|
| bars with a value | 351 | 351 |
| mean of the ratio | 1.0229 | 1.1285 |
| the newest bar | 1.1060 | 1.0557 |
| bars shaded (ratio above 1.2) | 47 | 112 |

The ratio differs on all 351 bars that have one; the largest single difference is 0.7061. The
shading differs on 79 bars.

**Volume with 50 Average.** The surge colouring differs on 4 bars (a surge day that closed above
its open but below the previous close, or the reverse). The counts happen to be equal: 8 up
surges and 21 down surges in both versions.

## What happens to a member's copy

Adding a house indicator makes the member's own definition under their own id. A new house
version never rewrites it: a member who added version 1 keeps an indicator that computes the
version 1 way, under "Your indicators", theirs to change or delete. The same holds for a fork or
a share made from such a copy.

One thing in the product had to change for that to be true in the UCT tab, and it shipped as
its own change beside this one. A copy was recognised as "the house one, unchanged" by
`compute.fn`, which is the FIRST line's formula only. For Volume with 50 Average the first line
is `volume` in both versions, so a version 1 copy would have been taken for version 2 and put
on the chart instead of the new definition. A copy is recognised by its whole maths
(`compute.treesHash` too). The same fix separates "Relative Strength vs SPY" from "RS New High
vs SPY", which share a first line: a member holding one got it again when adding the other.

Not built: a notice on an older copy that a newer house version exists. Not measured: whether
any account on production holds a copy of either (the synthetic accounts leave none).

## The version rule

`app/src/components/chart/house/houseVersions.json` lists every version of every house
indicator, oldest first, by its whole-maths fingerprint. A house indicator's maths never changes
under the same version: a change is a new entry with the next version and the reason, and the
definition's own `version` moves with it. The test fails on maths that moved without one.

## The engine number

Does not apply. `scriptEngineVersion.js` governs what the TRANSLATOR writes for an unchanged
script. No engine file is touched here: the house definitions are data, built by the authoring
engine from the same patches with one comparison changed; the other code change is the UCT tab's
copy recognition. Nothing rides an engine train.

## To recompute

```sh
python docs/indicators/evidence/2026-11-18-up-day/before_after.py            # print
python docs/indicators/evidence/2026-11-18-up-day/before_after.py --write    # rewrite before_after.json
```
