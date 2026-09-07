# Recognition-Quality Tier-1 Pilot — Scorecard

10 detectors, small bounded real-data corpora (7 cases each, ~3 fired/4
not-fired), lightweight blind judgment (4 grouped dispatches, simplified
2-4-dimension rubrics per family, not the full 8-9-dimension deep-cycle
rubric), cross-referenced against `detector_fired`. **These are thin
samples (n=4-7 scored per detector) — read as directional signal for
triage, not as certified precision/recall.**

## Confusion matrices (raw)

| Detector | TP | FP | FN | TN | Excluded | n scored | Precision | Recall |
|---|---|---|---|---|---|---|---|---|
| bullish_engulfing | 1 | 2 | 0 | 3 | 1 | 6 | 0.333 | 1.000 |
| three_white_soldiers | 2 | 0 | 0 | 4 | 1 | 6 | 1.000 | 1.000 |
| cup_handle | 1 | 1 | 0 | 4 | 1 | 6 | 0.500 | 1.000 |
| head_shoulders | 0 | 1 | 0 | 4 | 2 | 5 | 0.000 | n/a |
| golden_cross | 3 | 0 | 1 | 3 | 0 | 7 | 1.000 | 0.750 |
| vcp | 1 | 2 | 0 | 3 | 1 | 6 | 0.333 | 1.000 |
| power_earnings_gap | 2 | 1 | 1 | 2 | 1 | 6 | 0.667 | 0.667 |
| episodic_pivot | 3 | 0 | 0 | 4 | 0 | 7 | 1.000 | 1.000 |
| remount | 1 | 1 | 1 | 1 | 3 | 4 | 0.500 | 0.500 |
| wyckoff_spring | 1 | 1 | 0 | 4 | 1 | 6 | 0.500 | 1.000 |

## Root-caused disputed cases (real OHLCV, `C:\data\bars.db`)

- **bullish_engulfing case_0000 (BTU, 2026-04-28)** — DETECTOR_DEFECT,
  FRESHNESS_LIFECYCLE. Verified: the detector's reported engulfing pair is
  anchored on 4/24(red)→4/27(green), one bar stale — the true last bar
  (4/28) closed red, reversing the signal, but nothing re-checks this. This
  is the SAME "search bound ≠ freshness" mechanism already proven in Bull
  Flag and Pullback-to-21-EMA, now confirmed in a FOURTH, unrelated
  detector family (single/multi-candle morphology, not structural or
  MA-context). The judge independently found the identical shape in
  three_white_soldiers case_0001 (a real marching-soldiers sequence that
  had already reversed into chop by the window's true edge) without being
  told to look for it.
- **power_earnings_gap case_0002 (SEM, 2026-03-10)** — JUDGE_ERROR, not a
  detector defect. Verified: a genuine, clean 8.5% gap + ~14x volume spike
  (2026-03-03) exists 5 bars before the eval date, INSIDE the rendered
  25-bar detail crop (position 20/25) — the judge missed a real, visible
  signal during rapid triage. Important methodological finding: not every
  apparent Tier-1 FP is a detector problem; fast triage can itself miss a
  real signal on a close call.
- **vcp case_0001 (KROS) / case_0002 (SOXX)** — both FPs matched the
  judge's read of an over-deep/erratic first "contraction" (more like a
  correction or top) rather than genuine progressive tightening. This
  empirically CONFIRMS, independent of and consistent with, an
  already-documented finding sitting in `vcp.py`'s own source comments: a
  separate `base_catalog.py` VCP implementation agrees with this detector
  on only 3% of tickers (744-ticker measurement, pre-existing, not
  discovered by this pilot). Two live systems both claim to detect VCP and
  disagree almost completely — this pilot adds real, empirical evidence
  that at least one of them (this detector) does produce false positives.
- **golden_cross case_0001 (EMD)** — the one FN, plausibly a CORRECT
  rejection, not a defect: the judge's own note ("the actual cross moment
  isn't clearly on-screen — it looks like it already happened before the
  visible window") is consistent with `_MAX_CROSS_AGE=5` deliberately
  declining to fire on an already-established (not fresh) cross. Contrast
  with bullish_engulfing/three_white_soldiers/vcp above: golden_cross's
  design re-checks the CURRENT bar's raw MA relationship (`ma50_now <=
  ma200_now: return []`) rather than only the historical cross event —
  simpler, and structurally immune to the freshness gap the other families
  share.
- **remount case_0006 (FXI)** — FP, plausible but NOT verified this pass:
  the judge's "only a tiny 2-3 bar bounce... no confirmed hold" description
  is consistent with the remount bar sitting near the window's edge, where
  `_FOLLOW_THROUGH_BARS=3`'s check has fewer bars available to fail against
  than intended — a weaker-near-the-edge version of the same freshness
  family, reported as a hypothesis for a future deep pass, not a confirmed
  finding.
- **wyckoff_spring case_0005 (BAM)** — FP, root cause NOT determined this
  pass (judge describes a multi-week decline where a 1-3 bar spring should
  be; could be a genuine range-detection defect or a judge miscue similar
  to the SEM case above). Flagged for follow-up, not concluded either way.
- **head_shoulders** — 0 confirmed TPs across 3 fired cases (2 ambiguous +
  1 clear FP), despite the detector having the most mature freshness
  architecture in the pilot (`_pattern_already_broken`). Root cause not
  determined (n too small, no individual case deep-dived this pass) — the
  SHAPE of the result (zero clean positives) is what's notable, echoing the
  original Hammer program's 0/12 finding closely enough to warrant a real
  deep look before drawing any conclusion.

## Per-detector classification

| Detector | Category | RawConditionLevel | GeometryQuality | Freshness stress result | Major defect? | Tier-1 outcome | Recommended action |
|---|---|---|---|---|---|---|---|
| bullish_engulfing | Candlestick | C (context+quality) | SEMANTIC (2 anchors) | FAILS — confirmed, hard-verified | YES (freshness) | HARD_DEFECT_SUSPECTED | ENHANCE_PRODUCT_INTELLIGENCE |
| three_white_soldiers | Candlestick | C | SEMANTIC (3 anchors) | Same shape independently observed by judge | LIKELY (same family) | HARD_DEFECT_SUSPECTED | ENHANCE_PRODUCT_INTELLIGENCE (bundle w/ engulfing) |
| cup_handle | Classical structural | D (context+quality+currentness) | SEMANTIC, richest in pilot (5 anchors) | PASSES — has `_pattern_already_broken` | Not established this pass | LIKELY_HEALTHY | KEEP_HEALTHY |
| head_shoulders | Classical structural | D | SEMANTIC (neckline) | PASSES architecturally | Empirically 0/3 clean TPs | NEEDS_DEEP_EVALUATION | DEEP_EVALUATION |
| golden_cross | MA/context | D-equivalent (re-checks current state) | MINIMAL-USEFUL (single anchor) | PASSES — best design in pilot | NO | HEALTHY | KEEP_HEALTHY |
| vcp | UCT flagship | D | SEMANTIC (trendline_pair) | PASSES architecturally | YES — empirically confirmed + pre-existing 3%-cross-engine finding | HARD_DEFECT_SUSPECTED | DEEP_EVALUATION (highest priority) |
| power_earnings_gap | Event/gap | D (pending-breakout gate) | Not deeply checked | Not established this pass | NO (apparent FP was a judge miss) | LIKELY_HEALTHY | KEEP_HEALTHY |
| episodic_pivot | Momentum/event | C (no already-broken found) | Not deeply checked | Not established this pass | NO | HEALTHY | KEEP_HEALTHY |
| remount | UCT high-value | D-ish (follow-through gate) | HORIZONTAL_LINE, not deeply checked | Possible edge-weakness, unverified | UNCLEAR | EVALUATION_HARNESS_INADEQUATE (sample too small/ambiguous) | DEFER (build a slightly larger corpus first) |
| wyckoff_spring | UCT high-value | Not fully established | Not deeply checked | Not established this pass | UNCLEAR | NEEDS_DEEP_EVALUATION (thin evidence) | DEEP_EVALUATION |

## Note on "MEMBER VALUE" / "CONTEXT" / "QUALITY" columns

Deliberately not filled in with invented scores. Member-facing value and
context/quality maturity are product judgments the owner is better placed
to make than a 7-case sample; what this pilot CAN say objectively is
captured above (raw-condition level from source, freshness-stress result,
geometry quality, and the empirical confusion matrix). Forcing a numeric
score into those columns would be exactly the "invent a single opaque
composite score" the pass was explicitly told not to do.
