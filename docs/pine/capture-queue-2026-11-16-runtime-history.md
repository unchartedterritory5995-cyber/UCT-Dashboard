# Capture queue: 2026-11-16, history semantics on the runtime lane

Branch `feat/pine-coverage-runtime-history` (coverage unit "runtime history": the three runtime-lane
refusal codes `runtime:conditional-history`, `runtime:history-dynamic-offset`,
`runtime:history-expression`; evidence `docs/pine/evidence/2026-11-16-runtime-history/EVIDENCE.md`).
Same procedure as `docs/pine/capture-queue-2026-09-28.md`: visibility gate, **Create new > Indicator**,
the "Add to chart" binding gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`.
Inputs at defaults. None of the probes below has been compiled on TradingView: a row that does not
compile names its line, so split it out and capture the rest. A compile error is itself a reading.

## What the runtime lane does now

- A `?:` written before Pine v4 runs both arms on every bar (witnessed, `vw-ternary-arm-legacy-*`);
  `iff` evaluates both arguments (witnessed at v4, `vw-cs2-v4-ternary-lazy` C00). Served.
- A window that keeps its own ring (`sma`, `stdev`, `sum`, `median`, `wma`, `highest`, `lowest`,
  `highestbars`, `lowestbars`) over an EXPRESSION is served wherever the same window over a name is.
- A block or `?:` arm holding history that is not stepped per call site is drawn as on every bar and
  CHECKED as it runs: the first run after a skipped bar stops the run by name
  (`runtime:conditional-history`). Per call site, for any run pattern, the lane still serves only
  `ta.sma` / `ta.ema` / `ta.rma` in a root block and those plus one-argument `ta.change` in a Pine v6
  root arm. Every row below would widen that set, or lift a build refusal that the check cannot.

## Probes

| id | probe | chart | question | what changes on the answer |
|---|---|---|---|---|
| HIST-F1 | `tools/visual_conformance/probes/vw-hist-frac-length.pine` | AMEX:SPY 1D; NYSE:RDDT 1D second | Pine v6: a window LENGTH that is an inexact division of an input (`len / 3` = 13.33, `tlen / 3` = 6.67, `hlen / 2` = 4.5) in `ta.wma`, `ta.ema`, `ta.sma`, `ta.rma`, `ta.highest`, and through a helper parameter (the THMA shape). Which integer window does each R row equal (truncate, round, ceil), or none? | one rule for every function: fold the length by it (`foldConstNode`, T17) and `triangular-hull`, `luxy`, `range-filter-x-hull` lose `runtime:history-dynamic-offset`. A function with its own rule (an `ema` whose alpha takes the fraction) is folded per function. `na` everywhere: the build refusal becomes a run-time stop |
| HIST-F2 | `tools/visual_conformance/probes/vw-hist-frac-length-v5.pine` | AMEX:SPY 1D; NYSE:RDDT 1D second | the same under Pine v5 (F1 `vw-int-div-assign` witnessed that an input int keeps the fraction in v5) | as HIST-F1, for v5 scripts |
| HIST-F3 | `tools/visual_conformance/probes/vw-hist-frac-length-v4.pine` | AMEX:SPY 1D; NYSE:RDDT 1D second | the same under Pine v4, bare spellings, with the HMA helper (`len / 2`, `len` = 9) | `hma-kahlman-trend-trendlines` and `obv-macd-indicator` lose the refusal |
| HIST-F4 | `tools/visual_conformance/probes/vw-hist-frac-length-v3.pine` | AMEX:SPY 1D; NYSE:RDDT 1D second | Pine v3: `wper = (t / 3) - 1` with `t` an input of 25 and of 26, then `sma(x, wper)` (the `range-filter-v1` helper) | `range-filter-v1` loses its only wall |
| HIST-K1 | `tools/visual_conformance/probes/vw-hist-callsite-kernels.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | Pine v6: do `ta.crossover`, `ta.crossunder`, `ta.barssince`, `ta.valuewhen`, `ta.wma`, `ta.cum`, `ta.mom`, `ta.rsi` in an `if close > open` block (B rows) and a `?:` arm (T rows) keep the history of the block's RUNS, as `ta.sma` does (C48)? | per run and equal to this lane's per-invocation step: the function joins `servedCondCall`'s set and is drawn for any run pattern. Anything else: it stays under the every-bar check, and the rule is written down |
| HIST-K2 | `tools/visual_conformance/probes/vw-hist-callsite-kernels-v5.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D second | the same under Pine v5 (with Q-PT1, `vw-arm-history-v5.pine`, this also says whether a v5 arm is lazy for these functions) | as HIST-K1 for v5 scripts (`momentum-based-zigzag`, `support-and-resistance`, `scalping-strategy`) |

Already written by earlier units, still uncaptured, and needed by the same sample scripts (their
rows live in the docs named; listed here so the batch can be ordered, not re-queued):

- `vw-andor-history.pine` and `vw-wsc-h7-v6-shortcircuit.pine` (Q-PT2 / H7 / Q-CT1): the right side
  of a v6 `and` / `or`. Seven sample scripts carry it; it is the only wall of the built-in RSI.
- `vw-w4-int-div-window.pine`, `-v5`, `-v4` (W4-D1): `9 / 2` as a window length and an offset.
- `vw-arm-history-v5.pine` (Q-PT1), `vw-arm-history-v4.pine` (Q-PT3), `vw-arm-history-v3.pine` (Q-PT4).
- `vw-wsc-h5-block-extremes-n.pine` (H5): which bars a `ta.highest` / `ta.lowest` window holds in a
  block. `vw-wsc-h1-window-runs.pine` (H1), `vw-wsc-h2-change-offsets-block.pine` (H2),
  `vw-wsc-h3-atr-rsi-block.pine` (H3), `vw-wsc-h4-block-local-offsets.pine` (H4),
  `vw-wsc-h8-ta-in-loop.pine` (H8), `vw-wsc-h9-expr-history-block.pine` (H9).

## Shapes this unit leaves refused by name, and what would lift each

| shape | refusal | what settles it |
|---|---|---|
| a `ta.*` on the right of a v6 `and` / `or` (7 sample scripts) | `runtime:conditional-history`, at build | Q-PT2 / H7; then the right side is lowered as a jump and CHECKED or stepped per call site, as a `?:` arm is |
| a window length that divides inexactly (`len / 3`, 6 sample scripts) | `runtime:history-dynamic-offset`, at build | HIST-F1 to HIST-F4 |
| history in a `for` / `while` body (`ta.sma(x[i], 50)` per pass) | `runtime:conditional-history`, at build | H8 |
| a branch of a function body decided by a parameter the call site does not fix | `runtime:conditional-history`, at the call | not a capture question: the body compiled per call site with the every-bar check on that branch |
| a block local's or a drawing handle's `[1]` in the DRAWING build (8 sample scripts: `line.delete(sup[1])` in a block) | `runtime:conditional-history`, at build | not a capture question: W3N-D1 row d shows TradingView reads the previous RUN; the drawing build needs a per-call-site ring for a block local |
| a helper parameter that bounds an offset (`for i = 1 to length - 1` / `src[i]`) where the call passes a series and the script declares `max_bars_back` | `runtime:history-dynamic-offset`, at the call | not a capture question: L4b's declared-buffer ring, reached from the call-site refusal |

## Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is listed, with this reason, in `rowsNotCaptureQuestions`.

| not a capture | disposition | reason |
|---|---|---|
| a `ta.*` on the right of a v6 `and` / `or` (7 sample scripts) | superseded | the capture is Q-PT2's own row (`vw-andor-history.pine`, `docs/pine/capture-queue-2026-10-31-prod-ternary.md`) and H7's (`vw-wsc-h7-v6-shortcircuit.pine`) |
| a window length that divides inexactly (`len / 3`, 6 sample scripts) | superseded | the capture is this doc's HIST-F1 to HIST-F4 rows (`vw-hist-frac-length*.pine`) |
| history in a `for` / `while` body (`ta.sma(x[i], 50)` per pass) | superseded | the capture is H8's own row (`vw-wsc-h8-ta-in-loop.pine`, `docs/pine/capture-queue-2026-10-31-wsc-history.md`) |
| a branch of a function body decided by a parameter the call site does not fix | engine-gap | the body compiled per call site with the every-bar check on that branch: a build, not a TradingView reading |
| a block local's or a drawing handle's `[1]` in the DRAWING build (8 sample scripts: `line.delete(sup[1])` in a block) | engine-gap | W3N-D1 row d already shows TradingView reads the previous RUN; the drawing build needs the per-call-site ring (or this unit's every-bar check) for a block local |
| a helper parameter that bounds an offset (`for i = 1 to length - 1` / `src[i]`) where the call passes a series and the script declares `max_bars_back` | engine-gap | L4b's declared-buffer ring, reached from the call-site refusal: a build, not a TradingView reading |
