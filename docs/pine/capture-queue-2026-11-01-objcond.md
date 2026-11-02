# Capture queue: 2026-11-01, object lane, a `var` filled from a `ta.*` call on some bars

Branch `fix/prod-object-cond-history`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`:
visibility gate, **Create new > Indicator**, the "Add to chart" binding gate,
`__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`. Inputs at defaults.
RDDT 1D from listing and SPY 1D, as `vw-call-site-history-*-2026-10-01`.

The `if` form is settled by `vw-call-site-history` (C01-C04 / D01-D02), and the object lane now
withholds it by name where the block skips and then runs again (`objectColumns.js::withholdBlockRuns`).
The row below is the same value written as a ternary. It is NOT gated, and still draws the every-bar
number.

| row | probe shape | what it settles |
|---|---|---|
| T1 | `var float s = na`, top level `s := close > open ? ta.sma(close, 3) : s`, then `if barstate.islast` / `label.new(bar_index, s, str.tostring(s))`, plus `plot(s)` | Does TradingView evaluate the `ta.sma` in the true arm only on the bars that arm is taken (expected: 149.2033 on RDDT, the `if` form's value, i.e. per-run history), or on every bar (145.7767, what our object lane draws now)? |

Notes:
- T1 belongs to the `?:` arm family that `fix/prod-ternary-history` (C45) stamps for **plots**
  (`armRunGates`, witnessed lazy in v6 by `vw-arm-history`). Neither branch gates the object lane's
  reading of it. If T1 reads 149.2033, the object lane needs the C45 arm stamp read off its trees, the
  way that branch reads it off a plot's tree.
- Our object lane today draws 145.7767 for T1 on RDDT (the every-bar 3-bar mean).
