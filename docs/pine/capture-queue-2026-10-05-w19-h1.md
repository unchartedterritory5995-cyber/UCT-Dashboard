# Capture queue — 2026-10-05, W19-H1 (host-lane statements)

Branch `pine/w19-h1-host-statements` (base `integrate/wave18-2026-10-04`, `d488943c20`). What
W19-H1 served and why is in the triage doc, section W19-H1. Procedure: `docs/pine/VENDOR-HARNESS.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture`),
inputs at defaults.

**No corpus script newly attaches in any door state on this branch** (census off / on / runtime
65 / 91 / 120 before and after), so there is no attached script owed a grade. What is owed is
(1) a grade of the one served FORM no capture shows yet, and (2) the probes that would settle what
W19-H1 left refused.

## Served on a capture already on disk (nothing owed)

| served | capture | graded |
|---|---|---|
| the main walk steps over a loop inside an `if` chain (C46's fold) | `vw-loop-in-block-spy-1d-2026-10-02` (Q-C46a, AMEX:SPY 1D, 1,800 bars) | L02 / L03 / L06 / L07 / L08 MATCH through the member door, off and on (`vendorHarness.w19h1LoopInBlock.test.js`); L04 / L05 (the loop's own total, ruling R7) refused by name |

## Probes owed

| id | probe / chart | what it settles | scripts it would move |
|---|---|---|---|
| Q-W19H1a | new probe `vw-w19h1-var-switch`: `var float x = 0.0` / `x := switch` (no subject) with arms `close > open => high`, `close < open => low`, `=> x[1]` (row S01); the same in a branch with NO default arm, `if close > open or close < open` / `y := switch` / `close > open => close + 1` / `close < open => close - 1` (row S02, `na` when no arm runs); a bare-bool arm `bool up = close > open` / `z := switch` / `up => 1` / `=> 0` (row S03); controls `bar_index`, `close`. **AMEX:SPY 1D** (≥ 300 bars) and **NYSE:RDDT 1D** from the listing | `x := switch` on a `var` read as the ternary chain it spells (W19-H1 W2) — served from H2's graded non-`var` reading and the `var` update rule, never captured in this shape | smart-money-breakouts-chartprime (its `TP` / `SL` — the script is still refused: its `TradeisON` latch is `pine:state` on the host lane, by design, and its runtime-lane wall is `Volume.SCR.push()`) |
| Q-W19H1b | new probe `vw-w19h1-vwap-bands`: `[v, u, l] = ta.vwap(hlc3, timeframe.change("D"), 1)` and the same with `2.0`, plus `ta.vwap(hlc3, timeframe.change("D"))` alone and `ta.vwap(hlc3)` as controls; rows `v`, `u`, `l`, `u - v`, `v - l`. **AMEX:SPY 60** (RTH, ≥ 20 sessions) and **AMEX:SPY 1D** with the anchor `timeframe.change("W")` | the band arithmetic of the tuple form of `ta.vwap` (`pine:tuple` — "this engine has no tuple form for `ta.vwap`"). The manual names the parameter (`stdev_mult`) and not the deviation it multiplies (volume-weighted? population?), so it is refused rather than guessed | volume-suite-by-leviathan (its sole engine wall on the host lane after this one is `timeframe.change(<input timeframe>)`, A-TFSECONDS; its lower-timeframe columns stay withheld, R-LTF) |
| Q-W19H1c | not a capture: an owner ruling — see triage § W19-H1 "Owner decision". Whether a refused `alertcondition` (ruling D1: it draws nothing) may leave the rest of a script drawn, with the alert named as not offered | 9 scripts attach in the runtime state when their `alertcondition` lines are removed (scratch probe, 50-library store): candelacharts-equal-highslows-eqheql, delta-imbalance-map-joat, double-topbottom-ultimate-os, moving-averages-as-support-resistance-mtf, mtf-dashboard-pro-rsi-fib-sr-volume-strixedge, multi-timeframe-trend-indicator, rsi-trendlines-with-breakouts-hg, smart-money-breakouts-chartprime, smarter-snr (off state: 3) | each of those 9 — and each would then owe its own capture |

A runtime or compile error is a reading: record the message and the row.
