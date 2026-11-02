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

| row | what it settles |
|---|---|
| O01/O05 | the levels, bar for bar, from the listing |
| O02/O06 | the first bar: ours is `na` on bar 0 (the published body: `ta.change` is `na` there). If TradingView's built-in reads 0 on bar 0 instead, O02 reads 0 and `O04` differs on its first bars |
| O03/O07 | the built-in against its published reference body: expected 0 on every bar (or `na` together) |
| O04 | the corpus quantity (`atr-support-and-resistance`, `obvEMA = ta.ema(ta.obv, 21)`) |

## W1-B: v4 bare `barssince(cond)`

```pine
//@version=4
study("vw-w1-barssince-v4")
c = close > open
plot(barssince(c), "B01_barssince_v4")
plot(barssince(close > close[1] and volume > volume[1]), "B02_barssince_v4_compound")
```

| row | what it settles |
|---|---|
| B01/B02 | v4's one-argument `barssince` is the same unbounded count as v6 `ta.barssince` (already captured: `r11-barssince-spy-1d-2026-09-11`). Expected identical to the v6 spelling, `na` before the first true bar |

## W1-C: `ta.iii`, `ta.wvad`, `ta.wad`, `ta.cmo`, `ta.cog`

```pine
//@version=6
indicator("vw-w1-volume-osc")
plot(ta.iii, "C01_iii")
plot(ta.iii - ((2 * close - high - low) / (high - low)) * volume, "C02_iii_minus_reference_ZERO")
plot(ta.wvad, "C03_wvad")
plot(ta.wad, "C04_wad")
plot(na(ta.wad) ? -1 : bar_index, "C05_wad_first_bar")
plot(ta.cmo(close, 5), "C06_cmo_5")
plot(ta.cmo(close, 14), "C07_cmo_14")
plot(na(ta.cmo(close, 5)) ? -1 : bar_index, "C08_cmo_first_bar")
plot(ta.cog(close, 10), "C09_cog_10")
plot(na(ta.cog(close, 10)) ? -1 : bar_index, "C10_cog_first_bar")
plot(high == low ? 1 : 0, "C11_flat_bar_marker")
```

| row | what it settles |
|---|---|
| C01-C03 | the per-bar bodies; C11 marks any `high == low` bar, where the division's answer (ours: non-finite, drawn as a gap) is the open question |
| C04/C05 | `wad`'s level and first bar: ours is 0 on bar 0 (both momentum tests are false on `na`), from the listing |
| C06-C08 | `cmo`'s values and its first bar: ours lands on bar `length` (bar 0's `-na` reaches `sm2`) |
| C09/C10 | `cog`'s values and first bar: ours lands on bar `length - 1`; float order is the published loop's |
