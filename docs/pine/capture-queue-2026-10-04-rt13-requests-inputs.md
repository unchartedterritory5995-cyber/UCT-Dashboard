# Capture queue - 2026-10-04 RT13, requests, inputs and the install / builder doors

Branch `pine/rt13-requests-inputs`. One new probe
(`tools/visual_conformance/probes/vw-rt13-requests.pine`, never compiled here), for CAP (the sole
browser user) to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`, same
procedure as `docs/pine/capture-queue-2026-09-28.md`. Plus three corpus captures.

## Why

RT13 serves one door change (the install door's refusal is offered to the runtime lane). The two
scripts it attaches run on the runtime lane, which draws a script for a member only once it is
graded MATCH against a TradingView capture (owner ruling D6, the starter allowlist). Neither has a
capture. The request shapes below are REFUSED by name until a capture settles them.

## Q-RT13

| # | capture | settles |
|---|---|---|
| Q-RT13a | `corpus/committed/mtf-key-levels-support-and-resistance__*.pine` as written, NYSE:RDDT 1D from the listing and AMEX:SPY 1D | the runtime document RT13 attaches (install refused: budget:series 10 > 8); grade with the harness, runtime pane permitted |
| Q-RT13b | `corpus/committed/vwap-fibo-dev-extensions-strategy__*.pine` as written, same two charts | the same (budget:series 9 > 8); a strategy: its plots only, strategy markers are not graded |
| Q-RT13c | the probe as written, NYSE:RDDT 1D | R01/R02: whether `""` as the SYMBOL is the chart's symbol (machine-learning-logistic-regression-v3, `security('', reso, …)`). R05: the barstate offset inside it |
| Q-RT13d | same capture | R03 vs R04: a request at the chart's own symbol and timeframe whose value is a function-local mutable (multiple-mtf-moving-average-xdecow, `runtime:request-with-state`) |
| Q-RT13e | `corpus/committed/pivot-high-low-points__*.pine` as written, NYSE:RDDT 1D | the triangles at `offset = -lb`; today the host document is refused at install (`resolve:window`: `lb + rb + 1` reaches the budget check unfolded) and the runtime lane withholds an offset plot by name |

A runtime error is a reading: record message and row.

## What lands when it is captured

- Q-RT13a / b MATCH: add the script to the starter allowlist candidates (owner ruling D6). A
  DIVERGE is a runtime-lane defect on that script, named by the harness row.
- R01 == R00 on every bar: `requestTargetOf` may read `""` as the chart's symbol (one reader, both
  lanes), beside the timeframe rule that already does. Anything else: keep the refusal.
- R03 == R04 on every bar: an identity request whose value is a frame-local mutable folds to the
  value (the runtime lane's identity fold, before the `request-with-state` check). xdecow's next
  walls are `timeframe.in_seconds` (RT11) and `pine:collection`.
- R05: on historical bars `barstate.ishistory` is true, so R05 == R00 is expected; any other
  answer is a finding.
- Q-RT13e: grades the host fold of a constant window (`lb + rb + 1` with input defaults) if that
  fold is built; the offset rows are the host lane's.
