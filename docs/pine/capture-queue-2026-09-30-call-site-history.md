# Capture queue — 2026-09-30 C42, a call site's history past one execution (Q-C31a)

Branch `pine/c42-conditional-calls`. One probe, `tools/visual_conformance/probes/vw-call-site-history.pine`, for the
parent session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md`. Capture id `vw-call-site-history-rddt-1d-<date>`, NYSE:RDDT 1D from the
listing (every execution is then on a loaded bar), inputs at defaults; `vw-call-site-history-spy-1d-<date>` on
AMEX:SPY 1D as a second witness. ⚠️ v6, never compiled on TradingView: if it does not compile, the error names the
line — split that row out and capture the rest.

What is already witnessed (`vw-fn-series-history-rddt-1d-2026-09-30`, `ema-ribbon-…-rddt-1d-2026-09-28`) and
served, and the refusals this probe would settle, are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md`
§ C42 and `app/src/components/chart/engine/ast/objectFnInline.js` (the C42 section).

| rows | question | what the engine does today | what the capture changes |
|---|---|---|---|
| A01, B10 | controls: `ta.highest(high, 10)` on its one run, in a block and in a helper | served: the last bar's own high | must read the last bar's high, or the capture is not read |
| A02–A07, A10, A11, B04, B05 | what `ta.lowest`, `ta.sma`, `ta.ema`, `ta.rsi`, `ta.atr`, `ta.change`, `ta.stdev`, `ta.cum` answer on their FIRST run | `ta.sma(src, n ≥ 2)` served as `na`; every other one refused by name (`pine:block` in a block, `fn:conditional-history` in a helper) | each built-in whose label is read joins `ONE_EXECUTION_WINDOW_IS_SOURCE` (answers its source) or `ONE_EXECUTION_IS_NA`, or gets its own rule |
| A08, B08 | the one-argument `ta.highest(10)` on its one run | refused by name | served if it answers the bar's high |
| A09, B09 | `ta.sma(close, 1)` on its one run — the bar's close, or `na`? | refused by name (only a length above 1 is known `na`) | the length floor of `ONE_EXECUTION_IS_NA` |
| A12 | a BLOCK local `bx[1]` in a block that has run once | read as the every-bar expression one bar back — ⚠️ not witnessed either way | if `NaN`: a block local's history is the block's, and the object lane must read it so (a defect to fix, not a refusal to lift) |
| A13 / B01 | `bar_index[5]` beside `bar_index - 5`, in a block and in a helper | block: the chart's; helper: `na` (witnessed, S02) | B01 repeats S02 with the arithmetic beside it; A13 says whether a BLOCK reads `bar_index[k]` as the chart's (expected) |
| A14 | control: `volume[5]` in a block | served | must equal the bars |
| B02, B03 | `time_close[k]`, `hlcc4[k]` from a helper called once | refused by name (`CHART_SERIES_UNWITNESSED`) | each one equal to the chart's value moves to `CHART_SERIES_WITNESSED`; a `NaN` moves it to `CALL_OWNED_SERIES` |
| B06, B07 | a local `x[0]` and a parameter `src[0]` on the call's one run | refused by name (only an offset above 0 is known `na`) | served as the current value if that is what they read |
| C01–C06 | MANY executions, a block under `close > open`: `ta.highest` / `ta.lowest` / `ta.sma` / `ta.ema`, the block local's `cx[1]`, `bar_index[1]` — plotted on the bars the block runs | a `ta.*` LOCAL there is refused (`condCall`, C31); a `ta.*` written straight into a reassignment of a `var` or into a drawing's argument is still read the every-bar way (named in § C42 as not fixed) | decides whether a window counts EXECUTIONS or BARS — compare with E01–E05. Serving it needs a per-call-site column, not built |
| H01–H06 | the same from a HELPER called under `close > open`: `src[1]`, `x[1]`, `ta.sma`, `ta.highest`, `bar_index[1]`, `volume[1]` | refused (`fn:conditional-history`) | pins the per-call-site rule for many executions; H06 is the chart-series control |
| D01–D03 | every other bar (`bar_index % 2 == 0`): `ta.highest(high, 3)`, `ta.sma(close, 3)`, a local's `dy[1]` | as C | over EXECUTIONS, `D02` on bar b is the mean of `close[b]`, `close[b-2]`, `close[b-4]` and `D03` is `2 × close[b-2]`; over BARS they equal E03 and E05. One capture separates the two on every even bar |
| E01–E06 | the every-bar answers | served | comparison rows |

Still owed from § C31 and not asked here: Q-C31b (a descending and an empty-range `for`).
