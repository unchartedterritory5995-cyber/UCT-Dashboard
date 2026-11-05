VERDICT: GO-WITH-NOTES @1889bbedd7

Delta re-review of docs/pine/W6-BREAKDOWN.md: r1 @1889bbedd7 against the r0 @fd8bbd8e93 I gave
NO-GO. I read only the diff and anything it breaks. All three blockers are closed. One new note,
N-r1-1, is a claim the B3 fix made stale; fix it before T6 is briefed. The method was the same
read-only Python as r0, over the committed 11-03 targets and map (@127a0f1e3c) and the local
runtime-on census.jsonl.

## Blockers from r0

B1 CLOSED. Section 0 finding 1 now has a five-row table; I recomputed it:
- W6 alone: 5 / 4.
- With W4 closed: 14 / 7.
- With W1, W3 and W4 closed: 28 / 10. Recomputed independently from the committed
  `runtimeWaves` memberships (order strategies count W9) plus census `reachedAfterPeel`:
  28 upper, 10 firm. Matches.
- Greedy: 52.
- PLAN: +30 / +11, cited as production lane, 2026-10-30.
The explanation now credits the closed-wave assumption, not the lane. Correct.

The new per-task "+W1, W3, W4" column also checks out:
- T5 = 8 (4): bbwp, ml-ma, range-filter and vp-period are firm; session-tpo, vol-oi-footprint,
  footprint and rsi-kernel are not.
- T6 = 7 (4).
- T7 = 2 (1), T8 = 1 (0), T9 = 5 (0), T2 = 1 (0).
- The single-task rows sum to 24. The other 4 are gaps (T6+T9), momentum-terrain (T6+T7),
  support-resistance-mtf (T8+T11) and sr-zones-feels (T9+T11).
- T6 "+W4" is now 4 (3): atr-god-strategy has been removed.
- The N1 and N2 corrections (1 of 8 `pine:type` scripts is a namespace mis-read; T9 touches 12)
  are folded in correctly.

B2 CLOSED. T3 is split:
- T3a covers the descriptor and every slot flag, including colour, text and drawing,
  `holdsColour` and `markDrawingSlot`.
- T3b covers `exprType` with return-type inference per call site. It handles untyped parameters,
  answers null for recursion and for disagreeing arms, and caches per (function, argument types).
  It covers ternary / if / switch expressions, collection-returning built-ins and method results.
- Total size is now L (M + M). Each half is a zero-diff refactor with mutations.
- The dependents are re-pointed correctly: T3a feeds T7, T8 and T10; T3b feeds T6 and T9. T2,
  T5 and T11 need neither.
- One remaining overlap is listed in the conflict table: T3b reads `defineFunction`
  (FE:9918-10230), which W4 T7, T8, T12, T13 and T15 edit.

B3 CLOSED. Everything is now refused by name until its capture:
- T6: function-body `for … in`, `polyline.all`, the matrix and map walks, and write-through via
  `x` (W6-F1);
- T5: `percentile_linear_interpolation`, text sort, `standardize`, `percentrank`, plus `mode`
  ties, `na` placement in sort, and `join` number formatting (W6-A1).
W6-A1 and W6-F1 now list the matching probe rows. The G-row grading is recorded as INCONCLUSIVE
(`pine:reassign`).

The r0 notes (N4 to N7) are folded in:
- overlaps: T5 ⟂ T7 ⟂ T8, and T3a ⟂ T7 ⟂ T9 on the method-form sites;
- W4 T3 / T4 on `runtimeInputs.js` and `lowerIr.js`;
- the train is pushed, builds start on its tip, and citations are re-derived there;
- the hand port of 794bfb02f3;
- `ALL_FAMILIES` at :1612 and `FOR_IN_LIVE_WITNESSED` at :1615.
The batches respect the new order: T7 after T5, T9 after T3b and T7, T6 after T3b and W4 T15.

## New findings (from the delta)

N-r1-1 (stale claim, fix before T6 is briefed). T6's measure-pair still says "Attach expected:
trendline-pivots-quantvue, order-block-detector-luxalgo". The B3 fix makes the second one false.
In order-block-detector-luxalgo (pine-sample/reference, lines 84-100), the only `for … in` is
inside the function `remove_mitigated(…)`, which T6 item 5 now refuses until W6-F1. Its body
also calls `array.remove` on the arrays the walked `target_array` aliases (ob_btm / ob_top), which
stays refused until the G-rows are graded. Drop it from T6's attach list and keep it on the W6-F1
row. Its T6 count in section 1 is a count of walls moving, not of attaches, and stays valid.
trendline-pivots-quantvue (top level, lines 76 and 98) and market-structure-break-order-block
(top level, lines 163-193) are unaffected.

N-r1-2. The "+W1, W3, W4" column assigns support-resistance-mtf and sr-zones-feels to "two W6
tasks" through T11. T11's wall is W4-labelled (`runtime:loop` without `for-in`). Under the
W4-closed assumption, that wall counts as closed in the wave sets but is still open in the task
plan. That is consistent with the doc's own note that W4-BREAKDOWN never scheduled it; one
sentence in the table footnote would make the double role explicit.
