# Capture queue: 2026-11-03, W4-T12 paint typing

Branch `feat/pine-w4-t12-paint`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`.

## P2-F1: a `fill()` plot id chosen by a `?:` whose condition is not a literal

Served today: a condition that is the literal `true` / `false` (the arm is fixed before bar 0, so the
fill spans one plot pair, as if the script had named it). Refused by name (`runtime:fill-target`):
a condition that is an input, a series, or any value known only while the bar runs. A fill's two
outputs are static handles, and what TradingView draws for a plot id chosen per bar (or by an input
the member flips) is not captured.

```pine
//@version=6
indicator("vw-w4t12-fill-ternary", overlay = true)
useA = input.bool(true, "use A")
p1 = plot(close, "P1")
p2 = plot(open, "P2")
p3 = plot(high, "P3")
fill(useA ? p1 : p2, p3, color.new(color.red, 80), "F01_input_choice")
fill(close > open ? p1 : p2, p3, color.new(color.blue, 80), "F02_series_choice")
```

| row | probe | what it settles |
|---|---|---|
| F01 | `vw-w4t12-fill-ternary.pine` | whether an input-chosen plot id compiles on TradingView, and which band it draws at each setting |
| F02 | `vw-w4t12-fill-ternary.pine` | whether a per-bar plot id is accepted at all (if it is a compile error, the refusal is already right) |
