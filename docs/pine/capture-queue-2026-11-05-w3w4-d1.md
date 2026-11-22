# Capture queue: 2026-11-05, W3W4-D1 per-call-site history in the drawing build

Branch `feat/pine-w34-d1-drawing-history`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`.
The breakdown names this row W3N-D1 (four probes `vw-w3n-draw-block-history-{a,b,c,d}.pine`, `NYSE:RDDT 1D` and `AMEX:SPY 1D`).

**Graded 2026-11-15 (lane L4d, engine 63 placeholder), on the s10 captures
`vw-w3n-draw-block-history-{a,b,c,d}-{rddt,spy}-1d-2026-11-15` (local only; digests in
`docs/pine/evidence/2026-11-15-w3n-d1/evidence.json`).** Label `x` in these captures is a RANK into
TradingView's `graphics()._indexes`; it is read through the run's `xmap/<id>.json` sidecar.
- W3N-D1a (sma), W3N-D1b (ema), W3N-D1c (rma): MATCH on both symbols (RDDT 316/316 labels from the
  listing, warm-up `na` included; SPY the newest 501). SERVED in the drawing build.
- W3N-D1d (a block local's `[1]`): DIVERGE. TradingView reads the previous RUN's value (316/316 on
  RDDT); master's drawing build read the every-bar column, the previous BAR (first divergence RDDT
  bar 2: vendor 100.88, ours 92; SPY bar 7580: 808.38 vs 796.54). Now REFUSED by name
  (`runtime:conditional-history`).

(History, before the grade:) Served: nothing. The machinery (the drawing build lowering `ta.sma` / `ta.ema` / `ta.rma` written in a
block that runs on some bars through the plot lane's `servedCondCall`) is built and GATED OFF by
`DRAWING_HISTORY_CAPTURED = false`. The C48 captures pin sma and ema as PLOT values only, and nothing pins
`ta.rma` inside a block, so no capture shows a DRAWING reading the set. Refused by name
(`runtime:conditional-history`) until each row below MATCHes; serve only the rows that MATCH.

One label family per probe on purpose: with `max_labels_count = 500` a probe that drew four labels per UP bar
kept only the last ~125 UP bars on RDDT (308 UP bars), so the first runs, where the warm-up `na` lives, were
collected before the capture. One label per UP bar keeps all 308 RDDT labels. SPY 1D has more than 500 UP bars:
read SPY for steady state only, and pin warm-up on RDDT.

## W3N-D1a: a drawing's y over a per-run sma

```pine
//@version=6
indicator("UCTPROBE_VW_W3N_DRAW_BLOCK_HISTORY_A", overlay = true, max_labels_count = 500)
float p = na
if close > open
    s = ta.sma(close, 3)
    label.new(bar_index, s, "A|" + str.tostring(s))
    p := s
plot(p, "D01_sma3_plot")
plot(bar_index, "D00_bar_index_CONTROL")
```

Settings: defaults, `NYSE:RDDT 1D` from the listing (all history) and `AMEX:SPY 1D`. Fields to read from the
chart model: every label's `x` (bar index), `y` and `text` (one label per UP bar), and the plot columns
`D01_sma3_plot` and `D00_bar_index_CONTROL` per bar. The label y must equal the plot value on every UP bar, with the
first UP bars `na` on RDDT (all 308 labels are kept, so the warm-up is visible).

## W3N-D1b: a drawing's y over a per-run ema

```pine
//@version=6
indicator("UCTPROBE_VW_W3N_DRAW_BLOCK_HISTORY_B", overlay = true, max_labels_count = 500)
float p = na
if close > open
    s = ta.ema(close, 3)
    label.new(bar_index, s, "B|" + str.tostring(s))
    p := s
plot(p, "D02_ema3_plot")
plot(bar_index, "D00_bar_index_CONTROL")
```

Settings: defaults, `NYSE:RDDT 1D` from the listing (all history) and `AMEX:SPY 1D`. Fields to read from the
chart model: every label's `x` (bar index), `y` and `text` (one label per UP bar), and the plot columns
`D02_ema3_plot` and `D00_bar_index_CONTROL` per bar. The label y must equal the plot value on every UP bar, with the
first UP bars `na` on RDDT (all 308 labels are kept, so the warm-up is visible).

## W3N-D1c: a drawing's y over a per-run rma

```pine
//@version=6
indicator("UCTPROBE_VW_W3N_DRAW_BLOCK_HISTORY_C", overlay = true, max_labels_count = 500)
float p = na
if close > open
    s = ta.rma(close, 3)
    label.new(bar_index, s, "C|" + str.tostring(s))
    p := s
plot(p, "D03_rma3_plot")
plot(bar_index, "D00_bar_index_CONTROL")
```

Settings: defaults, `NYSE:RDDT 1D` from the listing (all history) and `AMEX:SPY 1D`. Fields to read from the
chart model: every label's `x` (bar index), `y` and `text` (one label per UP bar), and the plot columns
`D03_rma3_plot` and `D00_bar_index_CONTROL` per bar. The label y must equal the plot value on every UP bar, with the
first UP bars `na` on RDDT (all 308 labels are kept, so the warm-up is visible).

## W3N-D1d: a drawing's y over a per-run blocklocal_x1

```pine
//@version=6
indicator("UCTPROBE_VW_W3N_DRAW_BLOCK_HISTORY_D", overlay = true, max_labels_count = 500)
float p = na
if close > open
    x = close * 2
    label.new(bar_index, x[1], "D|" + str.tostring(x[1]))
    p := x[1]
plot(p, "D04_block_local_x1_plot")
plot(bar_index, "D00_bar_index_CONTROL")
```

Settings: defaults, `NYSE:RDDT 1D` from the listing (all history) and `AMEX:SPY 1D`. Fields to read from the
chart model: every label's `x` (bar index), `y` and `text` (one label per UP bar), and the plot columns
`D04_block_local_x1_plot` and `D00_bar_index_CONTROL` per bar. The label y must equal the plot value on every UP bar, with the
first UP bars `na` on RDDT (all 308 labels are kept, so the warm-up is visible).

| row | probe | what it settles |
|---|---|---|
| W3N-D1a | `vw-w3n-draw-block-history-a.pine` | a drawing's y over a per-run `ta.sma` equals the plot |
| W3N-D1b | `vw-w3n-draw-block-history-b.pine` | the same for `ta.ema` |
| W3N-D1c | `vw-w3n-draw-block-history-c.pine` | the same for `ta.rma`; no capture of any kind exists for rma in a block |
| W3N-D1d | `vw-w3n-draw-block-history-d.pine` | a block local's `[1]` read by a drawing is the previous RUN's value; master draws the previous BAR's today, so this row decides whether that shape is refused |
