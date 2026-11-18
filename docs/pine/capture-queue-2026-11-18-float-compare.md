# Capture queue: do Pine's comparison operators carry a tolerance? (2026-11-18)

Coordinator ruling 2026-11-18 (2), filed with `fix/kill-spy-runtime-diverges`. No engine change until this capture rules.

## Why

`adx-and-di-for-v4` on AMEX:SPY 1D from its 1993 listing (`adx-and-di-for-v4-spy-1d-2026-11-17`) grades DIVERGE on the
runtime lane from bar 5,333 (2014-04-03): DI+ on 360 bars, ADX on 372, first 27.576 (TradingView) against 27.939 (ours).
On that bar:

| | high | low |
|---|---:|---:|
| bar 5,332 (2014-04-02) | 189.13 | 188.14 |
| bar 5,333 (2014-04-03) | 189.22 | 188.05 |

- up move `high - high[1]` = 189.22 - 189.13 = **0.09000000000000341**
- down move `low[1] - low` = 188.14 - 188.05 = **0.08999999999997499**

Both prices are clean two-decimal doubles from TradingView's own bars, and the two moves differ only in their last
binary digits (2.84e-14). Our `up > down` counts +DM. TradingView's lines read as if it counted a tie and gave
neither, and the Wilder smoothing takes about 370 bars to agree again. The library DMI check found the same tie on
the same bar, so there are two independent witnesses.

**The script is NOT killed: the kill is HELD** (coordinator ruling 2026-11-18 (b)). If this capture rules EXACT, the
script is killed then, and the Python rails' canonical sample document moves off it, with a control check per file. If
it rules TOLERANCE, the divergence becomes an engine fix. The divergence shows only on a long SPY history: the RDDT
capture and the older 1,800-bar SPY capture (`adx-and-di-for-v4-spy-1d-2026-10-03`) both MATCH.

## The request

| id | probe | symbol / tf | what to record | unblocks |
|---|---|---|---|---|
| Q-FCMP-1 | `tools/visual_conformance/probes/vw-float-compare-tolerance.pine` (written 2026-11-18; record its sha256 with the capture) | **AMEX:SPY 1D, from the listing** (`history.startsAtBar0` asserted: scroll to the first bar, 1993-01-29) | every plot on every bar; bar 5,333 (2014-04-03) is the tie bar | the adx-and-di-for-v4 kill's `liftWhen`; an engine ruling on float comparison |
| Q-FCMP-2 | the same probe | **NYSE:RDDT 1D**, from the listing | every plot on every bar | the same, on a second symbol |

Inputs at defaults. A line that does not compile is a reading: record the error text and the line.

## What each plot answers

- `F00_bar_index_CONTROL`: the control.
- `F01_sum_eq_point3` and `F02_sum_gt_point3`: `(0.1 + 0.2) == 0.3` and `(0.1 + 0.2) > 0.3`. In IEEE doubles the sum is
  0.30000000000000004, so an exact compare reads 0 and 1.
- `F03_y_gt_x_3e-14` and `F04_y_eq_x_3e-14`: `x = 1.0`, `y = x + 3e-14`. An exact compare reads 1 and 0.
- `F05`-`F07`: `up > down`, `up < down` and `up == down` on every bar, the comparison the DMI makes.
  - On SPY bar 5,333, an exact compare reads F05 = 1, F06 = 0, F07 = 0.
  - A tolerance reads F05 = 0 and F07 = 1.
- `F08_up_minus_down`, `F09_up` and `F10_down`: the raw doubles, so the reading shows what TradingView computed.
- `F11_tie_literals_gt` and `F12_tie_literals_eq`: the same tie written as literals (`189.22 - 189.13` against
  `188.14 - 188.05`) on every bar. This answers the question independently of the bars.

## How it rules

- **Exact:** F02 = 1, F03 = 1, F05 = 1 on bar 5,333, F11 = 1. Pine compares exactly, so the adx divergence has another
  cause and the question reopens. The held kill is then filed.
- **Tolerance:** F01 = 1, F04 = 1, F07 = 1 on bar 5,333, F12 = 1. The engine's comparison operators need TradingView's
  tolerance, read off the F03 / F04 rows (its size bounded by 3e-14). Then the engine is changed, and
  adx-and-di-for-v4 is re-graded.
