# Capture queue — 2026-10-11 UIE Phase 3 (M5), an `na` array index (v4) and `na` text

Branch `feat/runtime-hardening-p1`. Two new probes (never compiled here), for CAP3 to run on
the live TradingView rig with `tools/vendor_harness/tv_capture.js`, same procedure as
`docs/pine/capture-queue-2026-09-28.md`.

## Why

UIE Phase 3 M5 took the three runtime-only scripts that stopped on unmeasured Pine:

| script | was | now |
|---|---|---|
| delta-rsi-oscillator-strategy | `array.sum` of an all-`na` array (unmeasured) | served `na` — MEASURED by `vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04` (E03-E06 `na` on 8,477 bars). Graded: **RDDT 1D MATCH** (4 plots, 636 bars) |
| linear-regression-channel | `array.new_color(2)` with no initial value (unmeasured fill) | the fill is held UNREAD (`collections.js::UNFILLED`) — this script never reads it; `array.new_line(3)` holds Pine's `na` handle in a run that owns its drawings. **Next stop: Q-UIE3a** |
| order-blocks | `na` text `+` text (`string alert = na`) | **Q-UIE3b** |

## Q-UIE3

| # | capture | settles |
|---|---|---|
| Q-UIE3a | `tools/visual_conformance/probes/vw-uie3-na-index-v4.pine`, AMEX:SPY **1D**, >= 200 bars | N01-N03: v4 `max(na, 0)`, `round(max(sign(na), 0))`, and `array.get(a, <that>)` — 0 / `na` / a stop |
| Q-UIE3b | `tools/visual_conformance/probes/vw-uie3-na-text.pine`, AMEX:SPY **1D**, >= 200 bars | T01-T04: `na + "x"`, `"x" + na`, `na + na` — `na` or text |

`N00` and `T00` are controls. A runtime error is a reading: record the message and the row.

## What lands when it is captured

- Q-UIE3a: serve exactly what v4 reads for `max` with an `na` operand, and for `array.get` at an
  `na` index (`collections.js::at` stops on every non-integer index today). linear-regression
  then draws, and is graded against a capture of the script itself (none exists yet).
- Q-UIE3b: serve `+` over `na` text as TradingView reads it (`vm.js` `OP.CONCAT` stops on a
  non-string operand today). order-blocks then reaches its drawings.
