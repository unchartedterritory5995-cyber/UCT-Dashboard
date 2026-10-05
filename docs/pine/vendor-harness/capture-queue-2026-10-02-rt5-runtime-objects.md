# Capture queue — 2026-10-02 RT5, the runtime lane's own drawings (Q-RT5a)

Branch `pine/rt5-runtime-objects`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`
(visibility gate, **Create new ▸ Indicator**, "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`). Nothing RT5 serves is waiting on this capture: both rows
are REFUSED by name today, and the capture is what would let either be served.

| # | capture | settles | what it would move |
|---|---|---|---|
| Q-RT5a | `tools/visual_conformance/probes/vw-rt5-arm-draw-block-history.pine` on NYSE:RDDT 1D (from the listing), defaults | **T01/T02**: a `label.new` in the THEN arm of `?:` is made only on the bars that arm is taken (label count = UP bars; the handle is `na` elsewhere). **B01**: a block local's `[1]` inside a global `if` is the previous EXECUTION's value (the previous UP bar's `bar_index`), not the previous bar's and not `na` | T01/T02 → the drawing build may lower a drawing arm as `if` (the host lane's G7 equivalence, O1) instead of refusing `runtime:object-op`; B01 → a per-site ring for block locals instead of `runtime:conditional-history` |
| Q-RT5b | `corpus/committed/renko-candles-overlay__d76a18d49e.pine` on NYSE:RDDT 1D (from the listing), defaults | the lines, labels and bricks (boxes) TradingView holds, and the labels' text (`str.tostring(up)`, the tick-derived `num`) | the one script RT5 newly attaches (census 86 -> 87) gets a vendor verdict |

What is already witnessed and is NOT asked again here:

* `vw-call-site-history-spy-1d-2026-10-01` (C48): inside a global block, `ta.*` keeps a per-site
  history (C01..C04, D01/D02 diverge from the every-bar plots), `bar_index[k]` and the chart's own
  series are the chart's (A13, A14, C06); a block local's `[1]` is not the previous bar's (C05).
* `vw-fn-series-history-rddt-1d-2026-09-30` (C34/C42): inside a function body, `bar_index[k]` is the
  call site's (S02 NaN), the chart's series are the chart's (S01, S03..S07), a parameter's and a
  local's `[1]` are the call site's (C01, C02).
