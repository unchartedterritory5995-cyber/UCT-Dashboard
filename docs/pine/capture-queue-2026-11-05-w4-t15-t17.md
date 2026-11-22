# Capture queue: 2026-11-05, W4-T15 function/statement forms and W4-T17 integer-division probes

Added on the landing train (`integ/pine-train-2026-11-05`) because the reviews of W4-T15 (note 1)
and W4-T17 (N1) found these rows only inside the lanes' EVIDENCE.md, and AGENT-RULES says a capture
need is a row in a capture-queue doc. The rows are copied from the evidence, unchanged in meaning.
Same procedure as `docs/pine/capture-queue-2026-09-28.md` and `docs/pine/capture-procedure.md`:
visibility gate, **Create new > Indicator**, the "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`. Inputs at defaults. These rows are for the owner's capture rig.
Nothing on the train runs them.

## W4-T15 (`docs/pine/evidence/2026-11-04-w4-t15/EVIDENCE.md`, "Open captures")

| row | probe | what to capture | what the runtime lane does today |
|---|---|---|---|
| W4-T15-a | `vw-w4-t15-loop-break-value.pine` | the value of a loop that ends via `break` / `continue` | refused by name |
| W4-T15-b | `vw-w4-t15-loop-tail-value.pine` | the value of a loop whose body ends in an `if` chain, a call, or a tuple | kept valueless |
| W4-T15-c | `vw-w4-t15-log-malformed.pine` | `log.*` with a malformed format string (does TradingView stop the script?) | arguments are not evaluated; no chart effect |

W4-T15-c matters only if TradingView raises a runtime error on a malformed `log.*` format string: then
the runtime lane would keep drawing where TradingView stops (review note 2).

## W4-T17 (`docs/pine/evidence/2026-11-03-w4-t17/EVIDENCE.md`)

| row | probe | chart | guards | scripts | what | lane |
|---|---|---|---|---|---|---|
| W4-D1 | `tools/visual_conformance/probes/vw-w4-int-div-window.pine` (+ `-v5`, `-v4`) | AMEX:SPY 1D, NYSE:RDDT 1D | pine:window, pine:offset-literal | hull-moving-average, detrended-price-oscillator, rsi-cyclic-smoothed | int/int as a window length or offset, per version and qualifier | T17 |

The M1-M5 rows of the same lane already live in `capture-queue-2026-10-31-wsc-history.md` (Q1).
