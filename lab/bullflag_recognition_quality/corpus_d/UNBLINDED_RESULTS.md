# Bull Flag Corpus D — Unblinded Results (final, small, bounded holdout)

Built after the owner reviewed Corpus C's findings and authorized investigating
two specific hard-semantic defects. Neither was implemented as code (see the
final closure report for the source-grounded reasoning: both require a
"pre-move reference range" primitive that does not exist anywhere in
`bull_flag.py` or its primitives — inventing one was out of scope per the
owner's own STOP-and-report instruction). The detector is therefore byte-
identical to Corpus C's (`git diff fb4538bc2 -- bull_flag.py` = empty). This
corpus's role is the final general check: surface any remaining MAJOR, hard,
objectively-provable defect, or confirm the family is ready to close.

## Raw confusion matrix (Corpus D only — kept semantically separate from B/C)

| | Detector FIRED | Detector not-fired |
|---|---|---|
| Judge POSITIVE | TP = 2 | FN = 1 |
| Judge NEGATIVE | FP = 0 | TN = 5 |

6 of 14 cases (case_0001, 0003, 0008, 0011, 0012, 0013) were judged
AMBIGUOUS-INSUFFICIENT and excluded from scoring — a markedly higher rate
(43%) than Corpus B (15%) or Corpus C (4%), reflecting this small sample's
composition (several cases landed with only 1-4 bars of post-pole history,
genuinely too little to call).

- **n scored = 8** (14 total − 6 ambiguous)
- **Precision = 2/2 = 1.000**
- **Recall = 2/3 = 0.667**

Kept strictly separate from Corpus B (0.700/0.778, n=34) and Corpus C
(0.500/0.667, n=25). With n=8 scored, this precision figure is thin evidence
(zero FPs out of only 2 fired-and-scored cases) and should not be read as
"the detector reached 100% precision" — it reflects that half this corpus's
fired candidates landed in AMBIGUOUS rather than a clean FP, not that false
positives stopped occurring.

## Root cause of every non-clean-agreement case

### False Negative — case_0010 ARLO (as_of 2025-06-26)

Judge: POSITIVE — "a genuine pole followed by a reasonably orderly,
moderately-proportioned, multi-week consolidation that remains intact,"
noting "one volume bar spikes mid-flag... a minor imperfection, not
disqualifying." Detector: both extraction attempts for this ticker
(pole-top candidates at idx388 and idx393) were rejected on the pre-existing,
unrelated `volume_not_contracted` gate (ratios 1.38 and 1.63 — flag volume
38-63% ABOVE pole volume). Real bars (`C:\data\bars.db`) confirm this is not
a single-day artifact: **every one of the 6 flag bars** carries volume at or
above the pole's 1.09M average (1.12M, 2.74M, 1.43M, 1.51M, 1.80M, 2.07M) —
volume never meaningfully contracted at any point during the consolidation.
**This is a second, independently-confirmed instance of the same SEMANTIC
AMBIGUITY already documented for VTRS in Corpus C**: a human reviewer,
working from the price/volume chart, can read a clean-looking price
geometry as "the pattern" and under-weight a volume panel that, examined
bar-by-bar, never actually contracted. Not a new defect — confirms an
already-reported residual limitation (hard-gate-vs-soft-score design
question for volume), unrelated to either of this pass's two candidate
fixes.

### AMBIGUOUS-INSUFFICIENT (fired candidates, excluded from scoring) — 4 of 6 fired cases

- **case_0001 SN** — flag_count=3 (the bare minimum), retrace=0.171 (shallow
  end). Judge: TOO_SHALLOW + TOO_SHORT + AMBIGUOUS.
- **case_0003 USLM** — flag_count=4, retrace=0.307. Judge: WEAK flag
  structure ("only 2 candles of pullback" by their read), TOO_SHORT +
  AMBIGUOUS.
- **case_0012 KBR** — flag_count=4, confidence 80.09 (high). Judge: WEAK flag
  structure (choppy, direction resumed upward), AMBIGUOUS.

  These 3 are a third confirmed cluster of the already-documented **short-flag
  (3-4 bar) visual-ambiguity pattern** first identified in Corpus C (3 of 6
  Corpus-C FPs also had exactly a 4-bar flag). 3 of Corpus D's 6 fired
  candidates (half) hit this same pattern — a numerically-valid, minimum-
  duration flag that a human reviewer consistently reads as "too little
  data to confirm," not a clean call either way.

- **case_0011 CORT** — flag_count=11 (not short), but `parallel_score=0.576`
  — barely above the 0.55 floor. Judge: WEAK flag structure ("large choppy
  swings" rather than a tight channel), WEAK direction (mixed). Confirms the
  already-documented **marginal-parallel-score ambiguity** pattern (GGN,
  Corpus C, parallel_score=0.67) at an even more marginal value.

**No new detector defect was found in Corpus D.** Every disagreement maps
cleanly onto a category already identified and reported in Corpus C
(volume-contraction-vs-clean-geometry disagreement; short-flag ambiguity;
marginal-parallel-score ambiguity). None of the 6 negatives (all true
negatives — PH/TRV/USLM/SPRY/G, spanning ordinary chop, a stock still mid-
pole, and an outright downtrend) were disputed by the judge at all.
