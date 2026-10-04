# Capture queue - 2026-10-03 H6, `ta.obv`'s level and the state walls with no capture

Branch `pine/h6-host-state-udt`. For CAP3 (the sole browser user) to run on the live
TradingView rig with `tools/vendor_harness/tv_capture.js`, same procedure as
`docs/pine/capture-queue-2026-09-28.md`. A compile failure or runtime error is a
reading: record the message and the row.

## Why

- H6 serves `ta.obv` on the host lane as Pine's reference definition and grades it
  against multicator-table's two printed cells (RDDT "-29.984M" from the listing; SPY
  "10.801B" off it, withheld here as `cum:window`). Those are LAST-BAR texts rounded to
  a thousand. Bar 0 (`na` here, by `cum`'s measured rule) and the per-bar level are
  not witnessed.
- The H2 state walls whose scripts the runtime lane also declines have NO capture, so
  neither lane can be graded on them: smoothed-gaussian-trend-filter-algoalpha (S-a,
  runtime `runtime:fill-gradient`), smc-structures-and-multi-timeframe-fvg-ma-py (S-c,
  runtime `pine:input-kind`), ema-92150-vwap-macd-rsi-pro-v6 (S-e `varip`),
  bolingger-bands-inside-bar-boxes and inside-bar-boxes (R-d `varip`),
  neural-network-buy-and-sell-signals (S-f, runtime `runtime:history-expression`),
  williams-fractal-trailing-stops (R-f, runtime `pine:text-value`).

## Q-H6

| # | capture | settles |
|---|---|---|
| Q-H6a | `vw-h6-obv-level.pine`, NYSE:RDDT **1D**, full history (from the listing, `startsAtBar0`) | O01 on every bar incl. bar 0 (`na` or 0?); O03 = 0 proves `ta.obv` IS the reference definition bar for bar; O04/O05 the unchanged-close term. O00 is the control |
| Q-H6b | `vw-h6-obv-level.pine`, AMEX:SPY **1D**, the WHOLE history from 1993 (`startsAtBar0`) | the same on a second listing, and SPY's level from its listing - the bars that would let a full-history SPY chart draw it |
| Q-H6c | the seven corpus scripts above, each NYSE:RDDT **1D** from the listing, default inputs | a capture per script, so the runtime lane's next run and any host admission can be graded instead of argued |

## What lands when it is captured

- Q-H6a/b: if O01 is `na` on bar 0 and O03 is 0 everywhere else, nothing changes (the
  host lane already answers that); if bar 0 reads 0, `obvLevelTree` gains `nz(…, 0)` on
  bar 0 only, pinned by the capture. A full-history SPY capture becomes the second
  from-the-listing OBV witness in `vendorHarness.h6Obv`.
- Q-H6c: each script is graded on the runtime lane first (it owns the S-a/S-c/S-f/R-f
  shapes, H2); the host lane admits a shape only where its columnar answer equals the
  capture from the listing.
