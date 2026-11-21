# Capture queue: A6, a drawing made in one arm of `?:` inside a function (2026-11-20)

Filed for coordinator patrick-2b by the objects agent (roadmap unit `objects`, A6). Probes only: no capture text is
committed.

The runtime lane now serves a drawing made in one arm of a `?:` inside a function body when the call site FIXES the
test before bar 0 (an input, a literal, a caller's parameter its own call site fixes): the copy compiled for that call
site (C35, `frameConsts`) lowers only the arm the value takes, so the arm is taken on every call or on none, exactly as
for a test on the input itself (C47). fibonacci-retracement-mtflog writes `ln := s ? line.new(…) : na` in `f_ret(s, k, c)`
with `s` an `input.bool`. A test that changes every bar keeps the refusal, now naming the parameter: what TradingView draws
from an arm on a per-bar test inside a function is row Q-A6-1.

Probe runs with its inputs at their defaults, on the chart's own symbol, from the listing. A line that does not compile
is a reading: record the error text and the line. Not live. Read after the close.

Probe sha256 (first 16 hex, of the file as committed): `vw-a6-arm-draw-perbar.pine` ac2fd62fb6786106.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-A6-1a | `tools/visual_conformance/probes/vw-a6-arm-draw-perbar.pine` | NYSE:RDDT 1D from the listing | no | every line and label (x1, y1, x2, y2; x, y, text) at the last bar, and every plot on every bar | whether a drawing in an arm of `?:` inside a function is made only on the calls that arm is taken (L01 with the call site's `var` handle and its `line.delete`, B01 kept): then a per-bar test is served as the arm's jump in the drawing build |
| Q-A6-1b | `tools/visual_conformance/probes/vw-a6-arm-draw-perbar.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |
