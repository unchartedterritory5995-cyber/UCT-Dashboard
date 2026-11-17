# Capture queue — 2026-11-15 CBC-FMT, `calc_bars_count` and `str.tostring` number text

Branch `fix/pine-engine-calcbars-format`. For the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (procedure as `docs/pine/capture-queue-2026-09-28.md`).
CBC-FMT carries the witnessed `calc_bars_count` window (`vw-cs1-calc-bars`,
`vw-wse-calc-bars-bar-index`, and capture session S10's `vw-cbc-history-reads`,
`vw-cbc-mbb-and-input`, `vw-cbc-zero`, `vw-cbc-input-count`) and the witnessed `str.tostring`
rules F1-F9 (`app/src/components/chart/engine/pineTextFormat.js`; S10's `vw-fmt-tie-readings`,
`vw-cs2-label-number-format`). The rows below are what it still withholds or refuses by name.

| id | probe / script | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-CBC1 | `vw-cbc-history-reads.pine` (S10, captured) | NYSE:RDDT 1D from the listing | does a history read inside a `calc_bars_count` window reach bars before the window, and what are `last_bar_index`, `barstate.isfirst` and `ta.cum(1)` there? | ANSWERED by S10 (see the dispositions below): served as printed | nothing: closed |
| Q-CBC3 | `vw-cbc-mbb-and-input.pine` (S10, captured) | NYSE:RDDT 1D from the listing | does `max_bars_back` reach before the window? | ANSWERED by S10: served as printed | nothing: closed |
| Q-CBC4 | `vw-cbc-input-count.pine` (S10, captured) | NYSE:RDDT 1D | is a non-literal `calc_bars_count` accepted? | ANSWERED by S10 (CE10123): refused by name, `pine:calc-bars-count-expr` | nothing: closed |
| Q-CBC5 | `vw-cbc-zero.pine` (S10, captured) | NYSE:RDDT 1D from the listing | is `calc_bars_count = 0` every bar? | ANSWERED by S10 (MATCH): served as no window | nothing: closed |
| Q-FMT1 | `vw-fmt-tie-readings.pine` (S10, captured) | NYSE:RDDT 1D (tick 0.01) | how does `str.tostring` round a decimal tie, a mintick tie, a zero, an exponent, a grouping? | ANSWERED by S10: rules F1-F9, served as printed | nothing: closed |
| Q-CBC2 | `vw-cbc-security.pine`, re-taken with `AMEX:SPY` as its other symbol (S10 tried `NYSE:SPY`, an invalid symbol: not captured) | NYSE:RDDT 1D from the listing | is a `request.security` context inside a windowed script windowed too (its own `var` state and warm-up), or computed on the requested series' full history? | every request in a window is REFUSED by name (`pine:calc-bars-request`), the identity request included | settles whether a windowed request can be served, and how |
| Q-CBC6 | `vw-wse-calc-bars-live-window.pine` (Q-WSE2) | any liquid symbol, 1m, market hours, across new bars | does the initial window stay fixed while realtime bars are appended (the documented rule)? | the newest bar of a windowed run is WITHHELD by name while it may be forming (`pine:calc-bars-forming`, coordinator ruling 2026-11-15); the window is re-taken per run | settles the realtime window and lifts the forming-bar withhold |
| Q-FMT2 | a probe of `str.tostring` corners S10 did not hold: a PATTERN at 1e21 or more, a grouping of a size other than three (`#,##`), a negative value under a literal prefix (`"H (#.##)"`), a NEGATIVE exact tie through `format.mintick` (-0.125), a tie at a non-power-of-ten tick (0.25) | NYSE:RDDT 1D (tick 0.01) | what TradingView prints for each | each WITHHELD by name (`format:magnitude-uncaptured`, `format:grouping-uncaptured`, `format:negative-under-prefix`; a mintick tie returns no text) | settles each corner |

## Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is listed, with this reason, in `rowsNotCaptureQuestions` (dispositions: `DISPOSITIONS` in the engine).

| not a capture | disposition | reason |
|---|---|---|
| Q-CBC1 | closed | S10 `vw-cbc-history-reads-rddt-1d-2026-11-15`: no history read reaches before the window; `last_bar_index` 99, `barstate.isfirst` on the window's first bar, `ta.cum(1)` 1..100 — served as printed |
| Q-CBC3 | closed | S10 `vw-cbc-mbb-and-input-rddt-1d-2026-11-15`: `max_bars_back = 500` does not reach before the window — served as printed |
| Q-CBC4 | closed | S10 `vw-cbc-input-count`: VENDOR_COMPILE_ERROR CE10123 (`calc_bars_count` needs a const int) — refused by name, `pine:calc-bars-count-expr` |
| Q-CBC5 | closed | S10 `vw-cbc-zero-rddt-1d-2026-11-15` (MATCH): `0` computes every bar — served as no window |
| Q-FMT1 | closed | S10 `vw-fmt-tie-readings-rddt-1d-2026-11-15`: all 30 texts; the decimal reading rounds the shortest decimal half up, `format.mintick` rounds `n / tick` in binary, zero is unsigned, the default prints `1e+21`, grouping by three — served as printed |
