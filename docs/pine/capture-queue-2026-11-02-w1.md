# Capture queue: 2026-11-02, W1 names and robustness

Branch `feat/pine-w1-names`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`:
visibility gate, **Create new > Indicator**, the "Add to chart" binding gate,
`__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`. Inputs at defaults.
SPY 1D **from the listing** (history `startsAtBar0: true`, as `vw-nvi-pvi-spy-1d-full-2026-09-27`):
every row below is a running total, so only a capture that starts at bar 0 can grade the LEVEL.

Each name below is held today to TradingView's PUBLISHED definition by a reference rail
(`app/src/components/chart/engine/ast/pineW1Builtins.test.js`), not to a capture. A MATCH on
these rows turns REFERENCE into VENDOR; a mismatch means the name goes back to refused by name.

## W1-A: `ta.obv`, `ta.pvt` (levels, pane only)

```pine
//@version=6
indicator("vw-w1-obv-pvt")
plot(ta.obv, "O01_obv")
plot(na(ta.obv) ? -1 : bar_index, "O02_obv_first_bar")
plot(ta.obv - ta.cum(math.sign(ta.change(close)) * volume), "O03_obv_minus_reference_ZERO")
plot(ta.ema(ta.obv, 21), "O04_ema_obv_21")
plot(ta.pvt, "O05_pvt")
plot(na(ta.pvt) ? -1 : bar_index, "O06_pvt_first_bar")
plot(ta.pvt - ta.cum((ta.change(close) / close[1]) * volume), "O07_pvt_minus_reference_ZERO")
```

| row | probe | what it settles |
|---|---|---|
| O01/O05 | `vw-w1-obv-pvt.pine` on AMEX:SPY 1D from the listing | the levels, bar for bar, from the listing |
| O02/O06 | `vw-w1-obv-pvt.pine` on AMEX:SPY 1D from the listing | the first bar: ours is `na` on bar 0 (the published body: `ta.change` is `na` there). If TradingView's built-in reads 0 on bar 0 instead, O02 reads 0 and `O04` differs on its first bars |
| O03/O07 | `vw-w1-obv-pvt.pine` on AMEX:SPY 1D from the listing | the built-in against its published reference body: expected 0 on every bar (or `na` together) |
| O04 | `vw-w1-obv-pvt.pine` on AMEX:SPY 1D from the listing | the corpus quantity (`atr-support-and-resistance`, `obvEMA = ta.ema(ta.obv, 21)`) |

## W1-B: v4 bare `barssince(cond)`

```pine
//@version=4
study("vw-w1-barssince-v4")
c = close > open
plot(barssince(c), "B01_barssince_v4")
plot(barssince(close > close[1] and volume > volume[1]), "B02_barssince_v4_compound")
```

| row | probe | what it settles |
|---|---|---|
| B01/B02 | `vw-w1-barssince-v4.pine` on AMEX:SPY 1D from the listing | v4's one-argument `barssince` is the same unbounded count as v6 `ta.barssince` (already captured: `r11-barssince-spy-1d-2026-09-11`). Expected identical to the v6 spelling, `na` before the first true bar |

## W1-C: `ta.iii`, `ta.wvad`, `ta.wad`, `ta.cmo`, `ta.cog`

```pine
//@version=6
indicator("vw-w1-volume-osc")
plot(ta.iii, "C01_iii")
plot(ta.iii - (2 * close - high - low) / ((high - low) * volume), "C02_iii_minus_reference_ZERO")
plot(ta.wvad, "C03_wvad")
plot(ta.wad, "C04_wad")
plot(na(ta.wad) ? -1 : bar_index, "C05_wad_first_bar")
plot(ta.cmo(close, 5), "C06_cmo_5")
plot(ta.cmo(close, 14), "C07_cmo_14")
plot(na(ta.cmo(close, 5)) ? -1 : bar_index, "C08_cmo_first_bar")
plot(ta.cog(close, 10), "C09_cog_10")
plot(na(ta.cog(close, 10)) ? -1 : bar_index, "C10_cog_first_bar")
plot(high == low ? 1 : 0, "C11_flat_bar_marker")
plot(ta.iii - ((2 * close - high - low) / (high - low)) * volume, "C12_iii_minus_v5_page_body_NONZERO")
plot(volume == 0 ? 1 : 0, "C13_zero_volume_marker")
```

| row | probe | what it settles |
|---|---|---|
| C01-C03 | `vw-w1-volume-osc.pine` on AMEX:SPY 1D from the listing | the per-bar bodies; C11 marks any `high == low` bar and C13 any zero-volume bar, where `ta.iii`'s division by zero (ours: the engine's x / 0 rule, `na`, drawn as a gap) is the open question |
| C02/C12 | `vw-w1-volume-osc.pine` on AMEX:SPY 1D from the listing | which of TradingView's two printed `ta.iii` bodies the built-in computes. Ours since the W1 re-review: the volume DIVIDES (v4 reference; TradingView's exported values in PyneCore's fixture agree on 100 of 100 rows). C02 must read 0 on every bar; C12 (the v5/v6 page's body, volume multiplying) must not |
| C04/C05 | `vw-w1-volume-osc.pine` on AMEX:SPY 1D from the listing | `wad`'s level and first bar: ours is 0 on bar 0 (both momentum tests are false on `na`), from the listing |
| C06-C08 | `vw-w1-volume-osc.pine` on AMEX:SPY 1D from the listing | `cmo`'s values and its first bar: ours lands on bar `length` (bar 0's `-na` reaches `sm2`) |
| C09/C10 | `vw-w1-volume-osc.pine` on AMEX:SPY 1D from the listing | `cog`'s values and first bar: ours lands on bar `length - 1`; float order is the published loop's |

## W1-D: the three running totals in a DRAWING (held until this row)

Since the W1 review (2026-11-02) a table cell or label that prints `ta.obv`, `ta.pvt` or
`ta.wad` (or a v1-v4 bare spelling) is refused by name, `pine:window-dependent`, on every
drawing door (`pine.js::PINE_DRAWING_HELD_SERIES`): the host object pass, the runtime
lane's object door and, since the W1 re-review, a runtime build that draws its own
objects (`objectsInRun`). A pane plot of the level raises the
history-depth disclosure; a drawing raises none, so it would print a number that moves
with where the chart's history starts. Rail: `pineW1DrawingHeld.test.js`.

```pine
//@version=6
indicator("vw-w1-drawing-levels", overlay = true)
var table t = table.new(position.top_right, 1, 3)
if barstate.islast
    table.cell(t, 0, 0, str.tostring(ta.obv))
    table.cell(t, 0, 1, str.tostring(ta.pvt))
    table.cell(t, 0, 2, str.tostring(ta.wad))
```

| row | probe | what it settles |
|---|---|---|
| D01-D03 on RDDT (from the listing) | `vw-w1-drawing-levels.pine` | whether a drawing of the level matches when the chart starts where TradingView's history starts. `multicator-table-rddt` already holds one witness (OBV `-29.984M`) |
| D01-D03 on SPY (not from the listing) | `vw-w1-drawing-levels.pine` | the level TradingView prints where our chart starts later (multicator-table-spy: OBV `10.801B`). Lifting the hold for drawings is an owner decision on these two rows |

`ta.cog` (W1-C): the window it may unroll is the node budget's question, not a cap of its
own. A `ta.cog` whose unrolled tree the budget would refuse (past 32 bars of `close`) is
refused by name, `pine:budget`, at translation.

## W1-E: `ta.cmo` and `ta.cog` on DERIVED sources (W1 re-review, 2026-11-02)

A `close`-only row cannot see two things TradingView's own text or a second witness says
about these two built-ins, and neither is in the published `f_cmo` / `pine_cog` bodies W1
serves (`docs/pine/evidence/2026-11-02-w1/formula-sources.md`):

* PyneCore (`src/pynecore/lib/ta.py::cmo`, "measured on TradingView (probe m548)")
  tests the momentum's sign TOLERANTLY: a momentum within 1e-10 of zero counts as up,
  so a sub-tolerance zig-zag empties both sums and the oscillator is `na`. Ours is the
  published `mom >= 0`, exactly. A real `close` almost never moves by less than 1e-10;
  a derived source (`hlc3`, `close - open`) produces such dust from float rounding.
* TradingView's v5/v6 reference remarks for both say "`na` values in the `source` series
  are ignored". The published bodies, read literally, do not ignore them: in `f_cmo` an
  `na` momentum adds 0.0 to `sm1` and is skipped by `sm2`'s `math.sum`, and in
  `pine_cog` any `na` in the window makes the numerator `na`. Ours is the literal body.
  PyneCore returns `na` on an `na`-momentum bar without advancing either sum (`cmo`),
  and holds the last value and skips the `na` (`cog`). Only a source with an `na` AFTER
  its first value can tell them apart: an `na` only at the start (a warm-up) gives the
  same values either way, since both windows begin after it. On such a source the literal
  `f_cmo` body draws a value on the `na` bar and on the `length` bars after it, and our `cog`
  draws nothing while the `na` is in its window (both seen on a `close` with one `na` bar).

⛔ W1 FIX (coordinator ruling, 2026-11-02): so ours no longer draws that `cmo`. `ta.cmo` is
served only over a source that cannot be `na` after its first value (a price the bar holds,
`open` / `high` / `low` / `close`, one of Pine's means of them, `hl2` / `hlc3` / `ohlc4` /
`hlcc4`, or a number) and is refused by name, `pine:arity`, over any other, computed sources
and `volume` included (`pine.js::cmoSourceCannotGap`; rail `pineW1Builtins.test.js`).

```pine
//@version=6
indicator("vw-w1-cmo-cog-derived")
gappy = bar_index % 50 == 25 ? na : close
plot(ta.cmo(hlc3, 9), "E01_cmo_hlc3_9")
plot(ta.cmo(close - open, 9), "E02_cmo_close_minus_open_9")
plot(ta.cmo(close * 1.1 / 1.1 - close, 9), "E03_cmo_dust_9")
plot(ta.cmo(gappy, 9), "E04_cmo_gappy_9")
plot(na(ta.cmo(gappy, 9)) ? 1 : 0, "E05_cmo_gappy_is_na")
plot(ta.cog(gappy, 10), "E06_cog_gappy_10")
plot(na(ta.cog(gappy, 10)) ? 1 : 0, "E07_cog_gappy_is_na")
plot(ta.cog(hlc3, 10), "E08_cog_hlc3_10")
```

| row | probe | what it settles |
|---|---|---|
| E01-E03 | `vw-w1-cmo-cog-derived.pine` on AMEX:SPY 1D from the listing | the sign test on derived sources: equal to ours on every bar means the published `mom >= 0`; a bar where they differ (E03 most likely: its source is 0 or one rounding step of `close` on every bar, so every momentum is dust) means the tolerant test, and `ta.cmo` goes back to refused by name on derived sources until it is built. Since the W1 fix ours compares on E01 only: E02 and E03 are computed sources, refused by name today, and their rows still settle the sign test for the day that gate widens |
| E04/E05 | `vw-w1-cmo-cog-derived.pine` on AMEX:SPY 1D from the listing | `ta.cmo` over a source with a mid-series `na`. ⛔ Since the W1 fix ours REFUSES it by name (`pine:arity`), so these rows decide whether that refusal can lift, never what we draw: TradingView numbers on bar 25 + 50k and the 9 bars after it that equal the literal body (the rail's `refCmo` over the same source) lift it for the literal body; a TradingView `na` there (E05 = 1) keeps it refused until the reading TradingView computes is built and railed |
| E06/E07 | `vw-w1-cmo-cog-derived.pine` on AMEX:SPY 1D from the listing | `ta.cog` over the same: ours is `na` while the hole is in the window; TradingView's remark says the `na` is ignored. A TradingView number there is a value we fail to draw, never a wrong one |
| E08 | `vw-w1-cmo-cog-derived.pine` on AMEX:SPY 1D from the listing | `ta.cog` on a derived source, values (no `na` expected after warm-up) |
