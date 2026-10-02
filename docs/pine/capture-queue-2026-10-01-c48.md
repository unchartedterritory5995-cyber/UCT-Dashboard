# Capture queue — 2026-10-01 C48, what capture round 3 left refused in the object / call-site / colour area

Branch `pine/c48-captured-objects`. Five probes under `tools/visual_conformance/probes/`, for the parent
session to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new ▸ Indicator**, "Add to chart" binding
gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`). Inputs at defaults (none) on every
probe. A runtime error is itself a reading: record its text and the bar it names.

The mechanisms and the refusals these rows settle are in
`docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C48.

## What round 3 (2026-10-01) settled, and is served

| capture | served |
|---|---|
| `vw-call-site-history-rddt-1d` / `-spy-1d` | a block that runs ONCE: `ta.lowest`, one-argument `ta.highest(n)` read the bar's own low / high, `ta.sma(x, 1)` the value, `ta.cum(x)` the bar's value, `ta.ema` / `ta.rsi` / `ta.atr` / `ta.change` / `ta.stdev` / `ta.sma(x, n ≥ 2)` NaN, a block local `[1]` NaN; in a helper `time_close[k]` / `hlcc4[k]` the chart's, `x[0]` the current value. The PLOT lane refuses a conditional call's history where the block runs after a skipped bar. |
| `vw-colour-components-spy-1d` | the gradient formula exact (3,600 / 3,600 component-bars); equal / `na` bounds; reversed bounds inside; components of an 8-digit literal, an `input.color`, a ternary of colours, a per-bar transparency within 0..100 |
| `vw-input-tf-text-v5-spy-1d` / `-v6-spy-1d` | an `input.timeframe` default prints verbatim under v5 and v6; `timeframe.period` is `D` under v5, `1D` under v6 |
| `vw-int-array-avg-neg-spy-1d` | a float handed to an `int` bar coordinate truncates TOWARD ZERO; a negative bar index is no error |
| `vw-getter-history-spy-1d` | a live getter number prints; `line.get_y1(l)[1]` and a top-level variable's `[1]` are the value one BAR ago; NaN inside the last-bar block; a deleted handle reads `na` |
| `vw-forin-collections-rddt-1d` | `for x in <own list>` walks the LIVE list (push / shift / set); `<family>.all` is a snapshot, positions oldest first; `var … = array.new_label(3)` holds three slots |

## The probes

| probe | capture id | symbol | rows | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| `vw-cond-window-extremes.pine` | `vw-cond-window-extremes-rddt-1d-<date>` and `-spy-1d-<date>` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | X01–X07, E0x, R01 | `ta.highest` / `ta.lowest` in a block that runs on SOME bars are refused by name in both lanes (`fn:conditional-history` in the object lane; the plot lane's `pine:block` gate where the block runs after a skipped bar). Round 3's C01 / C02 / H04 fit NEITHER "the last N bars" NOR "the last N runs". | The source is `bar_index`, so each row prints which bar its answer came from: the window's membership is read off the number. Serve whichever rule X02–X05 show, if one rule fits all of them. |
| `vw-gradient-edges.pine` | `vw-gradient-edges-spy-1d-<date>` | AMEX:SPY 1D | Z, N, B, R, O, U × r / g / b / t | Equal bounds and an `na` bound or value serve r = g = b = 0, t = 100 — **g is an inference** (round 3 printed r, b, t). Reversed bounds with the value between them serve the bottom colour — **g and b are an inference** (round 3 printed r, t). Reversed bounds with the value OUTSIDE them: the colour is held (object lane: not drawn; plot lane: the series colour). | Confirms or corrects the inferred channels; settles the outside-reversed case (O, U rows + the `na()` rows). |
| `vw-getter-history-2.pine` | `vw-getter-history-2-spy-1d-<date>` | AMEX:SPY 1D | J01–J06, K0x | A getter number read back from TWO or more bars ago is held; a scalar's `[2]` is refused; a getter's `[1]` in a block that runs on some bars is served only where the previous BAR also ran it (previous run = previous bar) and held elsewhere; a getter's `[1]` inside a helper called in such a block likewise. | J01 / J02 → serve `[k]` for k ≥ 2; J03 / J06 → the previous run's answer (needs a per-place run history) or the previous bar's; J04 → the block local. |
| `vw-forin-collections-2.pine` | `vw-forin-collections-2-rddt-1d-<date>` | NYSE:RDDT 1D from the listing, after the close | G01–G07, S01–S04, P01 | A body that changes its list by `remove` / `pop` / `unshift` / `insert` / `clear`, reassigns it, or hands it to a helper: `forInRefused: the body changes \`x\`, the list it walks, by more than push / shift / set`. `array.new_box(n, na)`, a non-literal size and a sized list without `var`: `coll:sized`. A position in `<family>.all` is served only for a family none of whose creates was lost or withheld. | G01–G07: the index walk over the live list predicts 3 / 3 / 7 / 7 / 1 passes — serve each member the rows confirm. S01 / S02: the second-argument and the non-`var` forms. S03 / S04: an EMPTY list declared without `var` — this runtime keeps every list across bars (a list declared without `var` is not made anew), which is NOT Pine's rule for a variable; § C48 "found on the way". P01: positions after the collector has evicted. |
| `vw-once-ta-helper.pine` | `vw-once-ta-helper-rddt-1d-<date>` and `-spy-1d-<date>` | NYSE:RDDT 1D; AMEX:SPY 1D, after the close | T01–T06, B01–B06 | `ta.rsi` / `ta.stdev` / `ta.atr` / `ta.change` / `ta.cum` are served in a block that runs once and REFUSED inside a helper called from one (round 3 printed them in the block only). `ta.wma` and every other `ta.*` are refused in both. | T01–T05 equal to B01–B05 → drop the block-only restriction; T06 / B06 → one more call. |

## What is not a capture question

Serving a `ta.*` call, a block local's `[1]` or a helper's history in a block that runs on MANY bars is not
blocked on a capture — round 3 shows the rule (windows count RUNS, `[1]` is the previous run, a call-owned
`bar_index[1]` is the previous run's index, a chart series' `[1]` is the chart's; RDDT C03–C05, H01–H03,
H05, H06: 307 / 307 and 317 / 317). It is blocked on the mechanism: a per-call-site history indexed by
EXECUTIONS, whose "previous run" can lie any number of bars back, which the bounded-window evaluator cannot
hold within `MAX_WINDOW_CAP` / `MAX_RECURRENCE_STEPS`. § C48 states what serving it needs.
