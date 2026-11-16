# Capture queue: 2026-11-16, the UDT / collections / user-functions coverage unit

Branch `feat/pine-coverage-udt-collections`. Evidence: `docs/pine/evidence/2026-11-16-udt-collections/EVIDENCE.md`.
Procedure: `docs/pine/capture-queue-2026-09-28.md`. The owner runs every capture; no builder opens TradingView.
These probes were not compiled on TradingView when they were written: a compile or runtime error is itself the
reading (record its text and the bar it names).

The split probes for W6-A1, W6-E1, W6-U1 and Q-W19R2a/b (one risky question per file, after run cq1-2026-11-16
read the combined files as one error each) are rows of `docs/pine/capture-queue-2026-11-06-w6.md`, where those
questions already lived. This doc holds the two shapes the unit leaves refused that had no row.

## UDT-G1: a function body reading a mutable global's history

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| UDT-G1 | `tools/visual_conformance/probes/vw-udt-fn-global-history.pine` rows G01, G03-G06 | NYSE:RDDT 1D from the listing | `g[n]` inside a function body for a mutable global `g`: the global's own committed series (its value at the END of an earlier bar) whatever the call site and frame? A `var` counter (G01), a global reassigned AFTER the call (G03), a run-time offset (G04), a function called only on even bars (G05: the previous BAR's value or the previous CALL's?), a plain global reassigned with `:=` (G06) | refused at build by name, `runtime:function-global-state` ("a function body reading a mutable GLOBAL ..."); a plain read of the global is served (C11). Blocks `bolingger-bands-inside-bar-boxes` (with a run-time offset no ring can bound: `runtime:history-dynamic-offset` follows), `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor`, `auto-length-moving-average-trend-signals-zeiierman`, `market-structure-break-order-block` |

## UDT-N1: `array.get` at an `na` index, v6 and v5

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| UDT-N1 | `tools/visual_conformance/probes/vw-udt-na-index-v6.pine` rows N01, N03; `tools/visual_conformance/probes/vw-udt-na-index-v5.pine` row N01 | NYSE:RDDT 1D from the listing | what `array.get(a, na)` answers in v6 and in v5: `na`, the first element, or a runtime error? (v4 is measured: `na`, `vw-uie3-na-index-v4-spy-1d-2026-11-16`) | runtime lane, since the UDT unit: v4 and v6 read `na` and run on (v6 on the witness of `bollinger-band-width-percentile-rddt-1d-2026-11-14`, whose read colours an `na` point, so the v6 VALUE is what this row confirms); v5 stops by name (`array.get: index NaN is outside an array`); the C18 object door keeps master's stop |

## UDT-T1: a user function parameter typed `T[]`

| id | probe | chart | question | engine today |
|---|---|---|---|---|
| UDT-T1 | `tools/visual_conformance/probes/vw-udt-legacy-array-param.pine` rows T01-T02 | NYSE:RDDT 1D from the listing | does v6 compile a parameter typed `float[] a` / `int[] a`, and is it the same parameter as `array<float> a` / `array<int> a`? | refused at build, `runtime:function` ("a parameter this front end cannot read (`[`)"). Moves the first wall only (no script frees on it alone): `smc-structures-and-multi-timeframe-fvg-ma-py` (next: `timeframe.in_seconds`), `divergence-stack-scanner-agpro-series` (next: a `str.tostring` format), `support-and-resistance-step-4` (next: a `label` statement) |
