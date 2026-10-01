# Capture queue — 2026-09-30 C34, whose history a conditional call reads

Branch `pine/c34-fn-loops`. One probe, `tools/visual_conformance/probes/vw-fn-series-history.pine`, for the
parent session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md`. Capture id `vw-fn-series-history-rddt-1d-<date>`, NYSE:RDDT 1D from the
listing, inputs at defaults.

The rule and the refusals it settles are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C34 and
`app/src/components/chart/engine/ast/objectFnInline.js` (the C34 section).

| rows | question | what the engine does today | what the capture changes |
|---|---|---|---|
| S01–S06 | does `volume` / `bar_index` / `time` / `hl2` / `hlc3` / `ohlc4` `[k]`, read from a helper called only on the last bar, answer the chart's value `k` bars back (k = 5, 40, 200)? | refused by name: `fn:conditional-history`, "not yet witnessed … (capture `vw-fn-series-history`)" | each series whose three labels equal the chart's own values moves from `CHART_SERIES_UNWITNESSED` to `CHART_SERIES_WITNESSED` |
| S07 | control: `close[k]`, already witnessed on the trend-lines capture | served | must equal the bars, or the capture is not read |
| C01–C04 | the per-call-site rule itself: a body local `x[1]`, a parameter `src[1]`, `ta.sma`, `ta.highest` from a call that has run once | refused (`fn:conditional-history`) | pins what Pine answers (documented: `na` / a one-execution window, unlike plots E01–E04). Serving it needs a per-call-site column, not built |
