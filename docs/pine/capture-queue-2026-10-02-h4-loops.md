# Capture queue — 2026-10-02 H4, loops on the runtime lane

Branch `pine/h4-loops`. One probe, for CAP2 to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (same procedure as `docs/pine/capture-queue-2026-09-28.md`).
⚠️ Not compiled on TradingView yet: if a row does not compile, the error names the line — split it out.

The rules it would settle are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § H4.

| id | probe | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-H4a | `tools/visual_conformance/probes/vw-h4-loops.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D as a second witness | do the three admitted loop shapes print the values the runtime lane computes: `L1` a weighted running total over a call-site length `a + b`; `L2` a state array seeded by a helper that ends in `if` around a `for`; `L3` a running total bounded by `array.size(array.from(...))` (and `n` itself) | served by the runtime lane only (dark flag `VITE_PINE_RUNTIME_PANE_ENABLED`); each value equals a hand replay of Pine semantics on every RDDT listing bar (`vendorHarness.h4Loops`) — no TradingView witness | a witness for each shape. A disagreement on a row withdraws that row's rule; the na-ness of the first bars (`x[i]` before bar 0 is `na`, so `L1` starts at bar 12 and `L3` at bar 2) is the part most worth reading |

The corpus scripts these shapes unblock (volume-divergence-by-mm, kalman-price-filter-backquant,
nadaraya-watson-rational-quadratic-kernel-non-repainting) all stop next on a wall this probe does
not touch (a per-bar plot colour, `pivotlow` over runtime state), so none of them is a capture
candidate yet.
