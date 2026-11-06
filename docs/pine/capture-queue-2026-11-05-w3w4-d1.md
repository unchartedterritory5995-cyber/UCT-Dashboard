# Capture queue: 2026-11-05, W3W4-D1 per-call-site history in the drawing build

Branch `feat/pine-w34-d1-drawing-history`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`.
The breakdown names this row W3N-D1 (`vw-w3n-draw-block-history.pine`, `NYSE:RDDT 1D` and `AMEX:SPY 1D`).

Served today: nothing. The machinery (the drawing build lowering `ta.sma` / `ta.ema` / `ta.rma` written in a
block that runs on some bars through the plot lane's `servedCondCall`) is built and GATED OFF by
`DRAWING_HISTORY_CAPTURED = false`. The C48 captures pin sma and ema as PLOT values only, and nothing pins
`ta.rma` inside a block, so no capture shows a DRAWING reading the set. Refused by name
(`runtime:conditional-history`) until each row below MATCHes; serve only the rows that MATCH.

## W3N-D1: a drawing's y over the per-call-site set

```pine
//@version=6
indicator("UCTPROBE_VW_W3N_DRAW_BLOCK_HISTORY", overlay = true, max_labels_count = 500)
float p_sma = na
float p_ema = na
float p_rma = na
float p_x1 = na
if close > open
    s = ta.sma(close, 3)
    e = ta.ema(close, 3)
    r = ta.rma(close, 3)
    x = close * 2
    label.new(bar_index, s, "S|" + str.tostring(s))
    label.new(bar_index, e, "E|" + str.tostring(e))
    label.new(bar_index, r, "R|" + str.tostring(r))
    label.new(bar_index, x[1], "X|" + str.tostring(x[1]))
    p_sma := s
    p_ema := e
    p_rma := r
    p_x1 := x[1]
plot(p_sma, "D01_sma3_plot")
plot(p_ema, "D02_ema3_plot")
plot(p_rma, "D03_rma3_plot")
plot(p_x1, "D04_block_local_x1_plot")
plot(bar_index, "D00_bar_index_CONTROL")
```

Settings: defaults, `NYSE:RDDT 1D` from the listing (all history) and `AMEX:SPY 1D`. Fields to read from the
chart model: every label's `x` (bar index), `y` and `text` (all four labels per UP bar), and the five plot
columns per bar. The label y must equal the plot value of the same expression on every UP bar, with the first
bars `na`.

| row | what it settles |
|---|---|
| D01 | a drawing's y over a per-run `ta.sma` equals the plot (label S) |
| D02 | the same for `ta.ema` (label E) |
| D03 | the same for `ta.rma` (label R); no capture of any kind exists for rma in a block |
| D04 | a block local's `[1]` read by a drawing is the previous RUN's value (label X); refused today |
| D00 | the chart's own bar_index (control) |
