# Capture queue - 2026-10-03 RT10, the runtime lane's walls

Branch `pine/rt10-runtime-walls`. One new probe
(`tools/visual_conformance/probes/vw-rt10-runtime-walls.pine`, never compiled here), for CAP4
(the sole browser user) to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js`,
same procedure as `docs/pine/capture-queue-2026-09-28.md`. Plus one corpus capture.

## Why

RT10 serves three runtime-lane forms graded only against a hand replay and the lane's own
already-served equivalent (no TradingView capture exercises them):

- a pivot over RUNTIME STATE (`ta.pivothigh/low(x, L, R)`, v1-v4 bare spelling) read at the
  confirmation bar, with H1's plateau rule (left tie pivots, right tie does not) and `na` on a
  hole in the window;
- `switch` as a statement (first matching arm runs, bare `=>` otherwise, subject evaluated once);
- an expression's own committed series inside a function frame (`ta.sma(v * volume, n)`,
  `(v + 1)[2]`, `ta.change(v * 2)`), one ring per call site;
- `ta.cum` over runtime state (the columnar `cumCol` rule, on a pane).

`for … in` is graded against C48's capture (`vw-forin-collections-rddt-1d-2026-10-01`) and needs
no new row.

## Q-RT10

| # | capture | settles |
|---|---|---|
| Q-RT10a | the probe as written, NYSE:RDDT **1D** from the listing | rows P01-P04 (pivot over runtime state; P00 is the control) |
| Q-RT10b | same capture | rows S01, S02 (statement switch; S02 = subject evaluated once) |
| Q-RT10c | same capture | rows H01-H03 (frame-local committed series, per call site) |
| Q-RT10e | same capture | row C01 (`ta.cum` over runtime state, holes held) |
| Q-RT10d | `corpus/committed/volume-divergence-by-mm__cvG2Djaryv.pine` as written, NYSE:RDDT 1D and AMEX:SPY 1D | the one corpus script RT10 attaches (runtime lane, pivots over `vol`); grade with the harness, runtime pane permitted |

A runtime error is a reading: record message and row.

## What lands when it is captured

- P01-P04 equal the replay in `rt10PivotOverState.test.js`: the rail cites the capture. A
  difference on a hole bar (`na` in the window) means TradingView's pivot does not propagate `na`
  over runtime state: change `RUNTIME_WINDOW` only, the host column is separately graded.
- S01/S02 differ: the statement switch is wrong (`lowerSwitchStatement`); S02 alone differing means
  TradingView re-evaluates the subject per arm.
- H01-H03 differ: TradingView's history of a function-local expression is not the call site's
  per-bar ring; revert `frameHoist` (one commit).
- Q-RT10d MATCH: add volume-divergence-by-mm to the starter allowlist candidates (owner ruling D6).
