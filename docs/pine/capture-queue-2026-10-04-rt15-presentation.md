# Capture queue — 2026-10-04 RT15, presentation, strategies and libraries

Branch `pine/rt15-presentation-libraries`. For the capture lane to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (procedure as `docs/pine/capture-queue-2026-09-28.md`).
⚠️ The probes are not compiled on TradingView yet: if a row does not compile, the error names the line — split it out.

The rules are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § RT15.

## Q-RT15a — the three scripts RT15 attaches (ungraded; the GT allowlist needs a MATCH)

| id | script | chart | what is drawn here today | what the capture settles |
|---|---|---|---|---|
| Q-RT15a1 | `corpus/committed/kernel-channel-backquant__d8c4b7f75c.pine` as published | NYSE:RDDT 1D and AMEX:SPY 1D, full history | runtime document: its plots and fill; the `plotcandle` is `display.none` at its default (`useBarColor = false`) and draws nothing | the grade (plots, fill colour) |
| Q-RT15a2 | `corpus/committed/linear-regression-channel-breakout-strategy__3a1cf28800.pine` as published (a `strategy`) | NYSE:RDDT 1D | runtime document: its drawings; the two order-only `if strategy.position_size …` chains are skipped (RT15 rule 2) | that a strategy's drawings equal the indicator reading (R1's Q-S1 asks the same of plots) |
| Q-RT15a3 | `corpus/committed/volatility-trend-score-backquant__0794882a37.pine` as published | NYSE:RDDT 1D | runtime document: `plot(c.score)`, the trail; `Long Signal` / `Short Signal` withheld (`offset`), the `bgcolor` withheld (`force_overlay`), the candles `display.none` at default | the grade, and the per-bar `coloring` (a `var color … = na`, RT15 rule 3) |

## Q-RT15b — `nz(<colour>)` with no replacement

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-RT15b | `tools/visual_conformance/probes/vw-rt15-colour-nz.pine` rows N01-N03, B01 | NYSE:RDDT 1D from the listing | what `nz(c)` / `nz(c[1])` answers when `c` is `na` (bars 0-9): the colorer values of N01/N02 vs N03's gray; B01 — does the bar keep the chart's colour or turn transparent? | refused by name, `runtime:colour-nz` (its old answer was the packed `0`, `#00000000`). Unblocks `atr-trend-bands-misu` (its only wall after RT15) and `std-filtered-adaptive-exponential-hull-…-loxx` |

## Q-RT15c — a paint `offset` that depends on an input

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-RT15c | `tools/visual_conformance/probes/vw-rt15-paint-offset.pine` (capture twice: input `flag` true, then false) | NYSE:RDDT 1D | is `offset = flag ? -1 : na` drawn at -1 when true and at 0 (or not at all) when `na`? | the host paint record withholds `paint:offset` (non-literal), so `visualizing-displacement-tfo` (a `barcolor`-only script) declines `runtime:withheld-all` |

## Q-RT15d — the gradient form of `fill`

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| Q-RT15d | `tools/visual_conformance/probes/vw-rt15-gradient-fill.pine` rows G01-G05 | NYSE:RDDT 1D | what a capture records for `fill(p1, p2, top_value, bottom_value, top_color, bottom_color)`, and (screenshot at zoom) whether the colour is linear in price between the two values and clipped to the two plots | refused by name, `runtime:fill-gradient` (C44/C48 ruling: withheld until captured). `smoothed-gaussian-trend-filter-algoalpha`'s first wall; `heikin-ashi-true-strength-…-erebor` has two (named arguments) behind `runtime:function-global-state` |

## Not a capture

- **A v5 library imported by a v6 script** (`fx-market-sessions`, `auto-trendlines-tradingfinder-…`,
  `machine-learning-lorentzian-classification__21f5`, `rate-of-change`): Q-L2b stands — TradingView compiles each at
  its own version (`docs/pine/pine-version-evolution.md` Table C lists 24 v5 → v6 differences, several of them silent
  value changes: `color.red`'s value, `and`/`or` laziness, `const int` division, `na` bools). Measured by substitution
  (the script's header set to v5): none of the four would complete — their next walls are `runtime:udt-method`
  (fx-market-sessions), `runtime:history-expression` (auto-trendlines), and `runtime:library` again (lorentzian,
  rate-of-change import a second v5 library). Left refused by name.
- **Every library the four import is in the store** (`boitoki/AwesomeColor/9`, `boitoki/Utilities/11`,
  `TFlab/AlertSenderLibrary_TradingFinder/1`, `jdehorty/MLExtensions/2`, `jdehorty/KernelFunctions/2`,
  `ClassicScott/MyMovingAveragesLibrary/4`, `ClassicScott/MyVolatilityBands/7`): nothing to fetch.
