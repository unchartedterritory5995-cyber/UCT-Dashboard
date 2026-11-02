# Capture queue - 2026-10-05 W19-R1, runtime history, windows and user frames

Branch `pine/w19-r1-history-frames` (base `integrate/wave18-2026-10-04`, `d488943c20`). Two new
probes (`tools/visual_conformance/probes/vw-w19r1-series-length.pine`,
`tools/visual_conformance/probes/vw-w19r1-hma-state.pine`, never compiled here) and one corpus
capture, for the capture lane to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js`, same procedure as `docs/pine/capture-round-5-runbook.md`.

## Why

W19-R1 SERVES on the runtime lane:

- `ta.hma` (v1-v4 `hma`) over a runtime series - a function parameter, a `var`, an expression -
  as the columnar lane computes it (`wma(2 * wma(x, floor(n/2)) - wma(x, n), round(sqrt(n)))`,
  `interpret.js::hullSpans` the one authority), wherever the call runs on every evaluation of its
  statement (inside a function: of the frame). Graded against TradingView's own
  `hma-close20-2026-09-06` (SPY 1D, 2,009 bars past the warm-up) and the column on the same bars.
- a `?:` inside a function whose test reads only parameters its call site fixed: one arm per call
  site, the other never lowered (C47's `switch` rule). momentum-based-zigzag's `moving_average`.

And REFUSES by name, unsettled:

- a SERIES window length (`runtime:history-dynamic-offset`): market-structure-break-order-block
  (`ta.lowest(nz(since > 0 ? since : 1, 1))`), zigzag-multi-time-frame-with-fibonacci-retracement
  (`highestbars(high, nz(len, 1))`). Q-RT12a was taken in CAP5 (S1-7 / S2-5) and stopped on bar 0 at
  its L04 row (`ta.lowest(low, lenNa)`, RE10001 "It must be > 0"), so it settled ONE fact (a 0 / `na`
  length stops the script - served: a fixed length below 1 refuses by name) and erased every other
  row. Measured by substitution: with the two lengths fixed, BOTH scripts attach (runtime state,
  objects in the run) - this is their only wall.
- `ta.hma` in one arm of a `?:` the call site does not fix, or on the right of `and` / `or`
  (`runtime:call-windowed-state`, "in one arm of `?:`"): the Hull's own series would be kept on
  every evaluation, where Pine keeps a built-in's series only on the evaluations that reach it.

## Q-W19R1

| # | capture | settles |
|---|---|---|
| Q-W19R1a | `vw-w19r1-series-length.pine` as written, NYSE:RDDT **1D** from the listing, and AMEX:SPY 1D (full history) | rows S01-S08 (series window length without the `na` row that stopped Q-RT12a; S00 / S07b are the controls). A runtime error on S03 or S08 is the reading - record the row and bar. |
| Q-W19R1b | `vw-w19r1-hma-state.pine` as written, same symbols | H01 / H02 equal H00's Hull (served); H03 / H04 - a Hull over a source with `na` holes (the lanes disagree, see below); H05 - a Hull in one arm (refused) |
| Q-W19R1c | `corpus/committed/momentum-based-zigzag__38d39d2d6c.pine` as written, NYSE:RDDT 1D and AMEX:SPY 1D | the corpus script W19-R1 attaches (runtime lane, objects in the run: `label.new` on GoLong / GoShort). Plots + labels. |

## What lands when it is captured

- S01-S06 answer the window over the last `len` bars (shorter at the listing): serve a series length
  on the runtime lane as a ring sized to the run's bar count (bounded by `max_bars_back` /
  `runtime/limits.js`); then market-structure-break-order-block and
  zigzag-multi-time-frame-with-fibonacci-retracement attach (measured by substitution, W19-R1 §1).
  A runtime error on S03 / S08 means the lane must stop the run by name at that bar instead.
- H03 / H04: the columnar `FN.hma` windows its two inner `wma`s with the default `na` policy
  (`rolling`, PROPAGATE) while the runtime lane's composition uses the vendor-pinned `ta.wma` rule
  (FFILL, first answer on the n-th finite input). On a source with interior `na` they can differ.
  Whichever TradingView matches, the other lane is changed to it (`hullSpans` already shared).
- H05 equal to `ta.hma` sampled on the up bars: the arm refusal can be lifted (the hoisted series
  is then right); different: it stays refused.
- Q-W19R1c MATCH: add momentum-based-zigzag to the starter allowlist candidates (owner ruling D6).

## Not queued here

- optimized-trend-tracker (wall map: R1 alone) - measured by substitution, its chain is longer than
  R1: `src[zxLag]` (a frame local from `length / 2` and `round`, refused by the H4 `/` rule) ->
  `Tsf_Func` ends in a binding the frame cannot return -> `if mav == "SMA"` blocks with history ->
  20 `security()` calls on symbols we do not hold (EURUSD, XAUUSD, ...) -> a strategy. Data we do not
  hold is an owner decision; no capture moves it.
- strong-start-rvol-dashboard (the owner's acceptance script): `calcDaily(simple int N)` inside
  `request.security` stops on `N` (the shared frame's refusal; a request does not specialise), then
  on `calcDaily` called inside `if showCorner` / the watchlist `for` (`runtime:conditional-history`),
  then on a request whose symbol comes from the pasted list (other symbols' data). W19-R1 §3.
