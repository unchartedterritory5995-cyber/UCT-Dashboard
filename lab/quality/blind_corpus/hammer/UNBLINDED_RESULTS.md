# Hammer — Unblinded Cross-Reference (Judge 1)

Cross-references the already-frozen `ADJUDICATION_JUDGE1.md` verdicts against
`answer_key_ingredients.json`'s `detector_candidate_fired` field. Performed
strictly AFTER the judge's verdicts were written — no verdict was revised
after unblinding.

## Confusion matrix (23 non-ambiguous cases; case_0020 AMBIGUOUS-INSUFFICIENT excluded)

| | detector fired | detector did not fire |
|---|---|---|
| **judge POSITIVE** | TP = 0 | FN = 1 (0005) |
| **judge NEGATIVE** | FP = 12 (0000, 0001, 0003, 0006, 0007, 0011, 0014, 0016, 0017, 0021, 0022, 0023) | TN = 10 (0002, 0004, 0008, 0009, 0010, 0012, 0013, 0015, 0018, 0019) |

**Precision = 0/12 = 0.0. Recall = 0/1 = 0.0.** Every one of the detector's 12
fired candidates in this corpus was judged NEGATIVE by an independent,
detector-blind reviewer; its one true positive candidate in the whole 24-case
sample (case_0005) was a miss.

Caveat: single-judge, n=23 (recall denominator n=1 — degenerate, a single case
either way would swing recall by 100 points; treat recall as illustrative only,
not a rate estimate). Precision (0/12) is the more robust signal at this
sample size, and it is unambiguously bad. Not a statistically powered
estimate — a first independent read.

## False positives — diagnosis (NOT fixed), grouped

**CONTEXT (missing/weak downtrend-precondition — 7 of 12, the dominant
failure mode):** case_0003 (strong uptrend, big bullish continuation candle),
case_0006 (mild ~4-5% pullback inside an intact uptrend), case_0007 (choppy
distribution/topping, no orderly downtrend, no nearby support), case_0011
(consolidation near highs after a rally), case_0021 (range-bound chop, not a
downtrend into support), case_0022 (persistent strong uptrend throughout),
case_0023 (moderate pullback inside a longer uptrend). Read: the detector's
downtrend/decline-precondition gate is missing, too permissive, or evaluated
over a window that doesn't actually require a preceding decline into the
firing bar.

**GEOMETRY (small-body / wick-ratio threshold too permissive, or wick-side
not verified — 3 of 12):** case_0000 (fired on a candle with a long UPPER
wick — the anatomical OPPOSITE of a hammer — suggesting the wick check may
not enforce which side the long wick is on), case_0016 (the notable decline
candle is a large-real-body marubozu-like bar, not small-bodied; the actual
last bar is an ordinary green bounce), case_0017 (large real bodies drive the
crash; "small body" requirement apparently not enforced or checked against
the wrong bar).

**HISTORY WINDOW / LIFECYCLE (fired on a stale or unconfirmed candle — 2 of
12):** case_0001 (a real downtrend exists, but the recovery is already
well underway by the last bar — the hammer moment, if any, is several bars in
the past, not current), case_0014 (last bar is still red/declining — mid-move,
not a confirmed reversal candle).

## False negative — diagnosis (NOT fixed)

- **case_0005** (the corpus's one clean, textbook hammer: sharp ~35% decline,
  small body near the top of its range, lower wick ~2-2.5x body, no
  meaningful upper wick) — detector did NOT fire. Judge's own caveat is the
  strongest lead: the candle prints a **fresh low** with no visible prior
  support/swing-low in the 160-bar window. **LOCATION**: if the detector
  requires proximity to an established prior support/swing-low as a firing
  precondition, a breakdown to fresh new lows (rather than a retest) would be
  structurally excluded even though the candle's own anatomy is textbook.

## Bottom line
On this independent sample, Hammer's detector shows **0 true positives and a
12/12 false-positive rate among its fired candidates** — a stark, one-sided
result: nearly every failure traces to a missing or too-weak downtrend/context
precondition, not to the candle-anatomy check (which is itself imperfect but a
secondary contributor here, per the 3 GEOMETRY cases above).

## Standing rules honored
No detector code touched in this pass. The corpus (packets + answer key +
adjudication + this cross-reference) is preserved as EVIDENCE, not tuned
against.
