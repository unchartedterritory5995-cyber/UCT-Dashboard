# Hammer Corpus B v2 — Unblinded Cross-Reference + Old-vs-New Comparison

Same 32 (symbol, as_of_t) cases as `corpus_b/`, re-rendered with the
two-view harness (morphology: last 16 bars, no MAs; context: last 90 bars,
with MAs) and re-adjudicated by a fresh judge with zero access to the
original verdicts, the detector, or the label-integrity review.

## New confusion matrix (31 non-ambiguous cases; case_0000 excluded)

| | detector fired (last bar) | detector did not fire |
|---|---|---|
| **judge POSITIVE** | TP = 7 | FN = 1 (case_0005) |
| **judge NEGATIVE** | FP = 8 | TN = 15 |

**Precision = 7/15 = 0.467. Recall = 7/8 = 0.875.**

Original Corpus B (same 32 underlying cases, old 160-bar single-view
render): precision 0.0, recall 0.0.

**This is the direct, apples-to-apples measurement of what the render fix
was worth: 0.0 → 0.467 precision, 0.0 → 0.875 recall, on the identical set
of real-world cases, with zero detector code changes between the two
adjudications.**

## case_0000 (SPRB): correctly flagged this time, not silently guessed

Old judge (160-bar view): confidently called NEGATIVE ("large red candle
... spans nearly its full range"), no indication anything was wrong with
the chart. New judge (two-view + explicit invitation to flag internal
inconsistency): AMBIGUOUS-INSUFFICIENT, correctly identifying the
underlying data-quality artifact ("`last_close`=8.2 vs `sma20`=196.33 /
`sma50`=366.87 — an ~40-70x mismatch... consistent with an unadjusted
split or bad data stitch"). This is the harness now doing what a harness
should do with a genuinely bad sample: flag it, not force a confident
wrong answer.

## Per-case comparison — every case whose FINAL VERDICT changed

| Case | Symbol | Old verdict (fired=True cases) | New verdict | Cause |
|---|---|---|---|---|
| case_0000 | SPRB | NEGATIVE (confident, wrong reasoning) | AMBIGUOUS-INSUFFICIENT | DATA QUALITY, now correctly caught |
| case_0001 | CCCC | NEGATIVE (CORPUS LABEL DEFECT) | POSITIVE | RENDERING RESOLUTION |
| case_0002 | UNF | NEGATIVE (CORPUS LABEL DEFECT) | POSITIVE | RENDERING RESOLUTION |
| case_0011 | AWI | NEGATIVE (CORPUS LABEL DEFECT) | POSITIVE | RENDERING RESOLUTION |
| case_0019 | OGN | NEGATIVE (context misread as chop) | POSITIVE | RENDERING RESOLUTION (both dimensions; the narrower 90-bar context view surfaced the real local decline the 160-bar view had smoothed away) |
| case_0022 | OMC | NEGATIVE (CORPUS LABEL DEFECT) | POSITIVE | RENDERING RESOLUTION |
| case_0025 | FLNC | NEGATIVE (CORPUS LABEL DEFECT) | POSITIVE | RENDERING RESOLUTION (new judge itself flags this as a high-ADR name worth a second look — kept as POSITIVE per the letter of the criteria) |
| case_0026 | CDRO | NEGATIVE (AMBIGUOUS, borderline) | POSITIVE (marginal) | RENDERING RESOLUTION, still explicitly marked low-confidence both times |

Every verdict CHANGE is attributable to rendering resolution or (for
case_0000) a genuinely improved harness instruction — none are attributable
to "judge inconsistency" in the sense of an unexplained flip on a clean
case; each has a specific, checkable reason.

## Cases where the verdict did NOT change, but are worth noting

- **10 of the original 16 fired-and-NEGATIVE cases stayed NEGATIVE**, and
  for most, the new judge's stated reasoning is now accurate (matches the
  real OHLC) even though the bottom-line call didn't move — e.g. case_0003
  now correctly cites context (extended uptrend, near 52-week highs) rather
  than a false anatomy claim.
- **Residual estimation noise remains on a small number of cases**, most
  notably **case_0029 (VRTX)**: the new judge calls morphology FAIL
  ("ratio well under 2x"), but the real OHLC gives lower_wick/body = 3.12x
  — a clear PASS by the numeric standard. Context was independently marked
  PRESENT. If morphology had been read correctly here, this case would
  flip to POSITIVE (TP), which would move precision to 8/15 = 0.533. This
  was NOT overridden or relabeled — the frozen verdict stands — but it is
  flagged as the single most significant residual finding and a good
  candidate for a second independent judge if this specific case ever
  matters for a real decision. **case_0023 (SOBO)** shows a similar
  wick-ratio underestimate (judge: ~1.3x; real: 3.68x), but its context was
  independently marked WEAK/ABSENT, so the final verdict is unaffected
  either way.
- These residual misses are real but qualitatively different from the
  original problem: they are isolated per-case estimation imprecision on
  small-dollar-range candles, not a systemic "the image is illegible"
  failure — the same judge correctly read comparably-shaped wicks on most
  other cases (e.g. case_0024/SOR: real ratio 22.9x, judge estimate ~6.5x —
  both comfortably clear "long wick," landing on the same qualitative PASS
  even though the exact multiple was off).

## Bottom line

The render fix is confirmed effective by direct measurement: the SAME 32
real-world cases went from 0.0/0.0 to 0.467/0.875 precision/recall with no
detector changes in between. It is not a perfect oracle — fine numeric
wick-ratio estimation on tight, low-dollar-range candles still shows
occasional real error (documented above, not swept under the rug) — but it
resolves the dominant original failure mode (wholesale illegibility) and
produces a corpus whose verdicts are, overwhelmingly, now defensible
against the real OHLC.
