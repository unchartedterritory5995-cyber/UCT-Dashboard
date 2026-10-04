# Capture queue — 2026-10-03 RT7, reductions over zero real elements, and `fixnan`

Branch `pine/rt7-runtime-walls`. One new probe
(`tools/visual_conformance/probes/vw-rt7-empty-reduce-fixnan.pine`, never compiled here), for CAP3
(the sole browser user) to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`,
same procedure as `docs/pine/capture-queue-2026-09-28.md`.

## Why

RT7 serves, from `vw-array-na-spy-1d-2026-10-02`: a reduction skips its `na` elements, `array.min`
of an all-`na` array is `na`, `indexof` / `includes` of `na` find nothing, v6 `get(a, -1)` is the
last element. It extends the all-`na` reading to an EMPTY array for `array.max` / `array.min`
(the same zero real elements; wyckoff-accumulation-distribution's RDDT capture shows TradingView
does not stop there and its 12 boxes now agree). It keeps `array.sum` / `array.avg` over zero real
elements a named stop (unmeasured). It serves `fixnan` from the Pine reference's sentence, graded
by a hand replay only.

## Q-RT7

| # | capture | settles |
|---|---|---|
| Q-RT7a | the probe as written, AMEX:SPY **1D**, >= 200 bars | rows E01-E06: empty / all-na reductions (E01/E02 confirm what RT7 serves; E03-E06 are unmeasured) |
| Q-RT7b | same capture | rows F01, F02a, F02b: `fixnan` against the hand replay `rt7Fixnan.test.js` uses |

`E00` and `F00` are controls. A runtime error is a reading: record message and row.

## What lands when it is captured

- E01/E02 `na` on every bar: nothing changes (RT7's rule confirmed). Anything else: revert the
  empty-array arm of `collections.js::realsOf` callers for max/min to the named stop.
- E03-E06: serve exactly what TradingView reads (0, na, or a stop by name) in `realNumbers`.
- F01-F02: if they equal the replay, the rail cites the capture; if not, `fixnanPine` is wrong.
