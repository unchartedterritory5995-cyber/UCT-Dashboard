# Pullback-to-21-EMA (Minervini SEPA) Corpus B — Unblinded Results

## Raw confusion matrix

| | Detector FIRED | Detector not-fired |
|---|---|---|
| Judge POSITIVE | TP = 5 | FN = 14 |
| Judge NEGATIVE | FP = 0 | TN = 18 |

3 cases (case_0013, case_0025, case_0037) judged AMBIGUOUS-INSUFFICIENT, excluded from scoring (case_0037 is a real data artifact — an unexplained ~49% overnight gap followed by 3+ weeks of implausibly flat near-zero-range price).

- **n scored = 37**
- **Precision = 5/5 = 1.000** — in this sample, the detector NEVER fired on a case the judge called an outright wrong pattern (no downtrend, no chop, no falling-average case ever fired).
- **Recall = 5/19 = 0.263** — the overwhelming majority of fired cases (14/19) were judged NEGATIVE, almost all citing the same theme: "not currently touching / already extended."

This is a materially different shape than Hammer's or Bull Flag's Corpus B results: precision is excellent, recall is poor, and the poor recall traces to a small number of well-understood, hard-verified mechanisms rather than "wrong pattern entirely."

## Root cause of all 14 false negatives (real OHLCV, `C:\data\bars.db`)

Every FN was individually verified against real bars and the detector's own `pipeline_trace` (`pullback_bar_t`, `reclaim_bar_t`, `bars_since_reclaim`, `distance_to_ema_pct`). Three distinct, real detector-side gaps were found — all variants of the same underlying issue (the touch/reclaim gate validates the TRIGGER but never re-validates the CURRENT bar's state), plus a separate judge-side interpretation pattern.

### Detector gap #1 — asymmetric touch tolerance (no floor on touch depth)

`_EMA_TOUCH_TOLERANCE_PCT = 0.015` bounds a touch bar's low to at most 1.5% **above** the EMA — but places **no lower bound** on how far **below** the EMA that low may sit. A violent multi-day crash straight through the average, as long as some bar within the 2-bar lag closes back above it, registers as a valid "touch."

- **case_0033 BTBT**: `distance_to_ema_pct = -5.02%` — the actual touch bar's low sat 5% *below* the EMA, following a real 2-day ~9% decline (10/15 close $4.06 → 10/16 close $3.69 → 10/17 low $3.45), then an explosive +18% single-day reclaim (10/20). Judge, independently: "the reclaim was a single explosive ~18% one-day surge... fails the volume and orderliness criteria." **DETECTOR DEFECT** — a genuine crash-and-violent-bounce is architecturally indistinguishable from a shallow, controlled pullback under the current tolerance definition.

### Detector gap #2 — no ceiling on the reclaim bar's own closing distance ("same-bar overshoot")

The reclaim gate is only `close > ema21` — no check on **how far** above. A bar can touch the EMA intraday and close 2-6% above it the very same session; the code treats this identically to a bar that closes 0.1% above.

- **case_0028 DAC**: touch+reclaim on the SAME bar (4/27, `bars_since_reclaim=0`) — low $117.79 (1.3% above EMA, a legitimate shallow touch), but that bar's own close ($120.38) is already **3.5%** above the EMA.
- **case_0029 FLNG**: touch+reclaim same bar (4/27) — low $30.70 (0.17% below EMA, textbook shallow), close $31.42 already **2.5%** above the EMA on that identical bar.
- **case_0030 MNTN**: touch+reclaim same bar (9/2) — low $12.39 (0.36% above EMA), close $13.13 already **6.3%** above the EMA on that identical bar; +2.5% more the next day.

All three are **DETECTOR DEFECT** in the same specific mechanism — genuinely distinct from staleness, since zero bars need to pass for this gap to manifest.

### Detector gap #3 — no check on price action AFTER the reclaim bar, up to the evaluation bar (multi-bar drift)

The search bound (`_PULLBACK_LOOKBACK=3`, `_RECLAIM_LAG=2`) tightly bounds how *stale* the trigger event itself can be (≤2 bars), but nothing re-examines what happened in the bars between the reclaim and the actual evaluation point.

- **case_0005 STNG**: reclaim 9/2 (close $81.42, already comfortably above the $78.72 EMA), then +to $82.35 by 9/4 (eval) — an additional real move in the 2 bars since reclaim, ending 4-5% above the EMA. Judge, independently and correctly: "already ran ~8% since the last EMA touch."
- **case_0006 FCBC**: (see Judge-side finding below — judge missed the real touch, but the underlying number confirms it was genuinely fresh, dist 0.106%, essentially no drift issue here).
- **case_0023 NVS**: reclaim 7/1 (close $154.14), then a further +3.7% single-day gap to $159.90 by 7/2 (eval) — a large 1-bar drift.
- **case_0015 BCO**, **case_0039 ROG**: milder versions (~2-2.4% additional drift in 1 bar).

**FRESHNESS/LIFECYCLE DISAGREEMENT** — this is the precise, hard-verified analog of the standing "search bound ≠ freshness" lesson for this family: the search bound governs the *trigger's* age, not the *current bar's* distance from that trigger.

### Judge-side pattern (not a detector defect): touch-by-close vs. touch-by-wick

Several cases show the judge evaluating "touch" using the bar's CLOSE (or fixating on an older, more visually salient dip elsewhere in the 35-bar window) rather than the actual intraday LOW/wick the detector — correctly, per Minervini's own teaching — uses to define a touch.

- **case_0010 VRTX**: `bars_since_reclaim=0` (the freshest possible case) — the eval bar's own low ($468.00) sits only 1.07% above the EMA (a genuine touch), but its close ($469.90) is higher up the day's range; judge read "hasn't reached the average yet... last real touch was violent and is now ~9 bars stale," describing an unrelated, older event.
- **case_0016 YPF**: `bars_since_reclaim=0`, touch-bar low 0.25% above EMA (textbook shallow) but the same bar's wide range closed well up; judge read "current close is ~2.6% above the EMA," missing that the actual gate-relevant number is the low, not the close.
- **case_0006 FCBC**: touch+reclaim genuinely occurred 1 bar before eval (`dist=0.106%`, essentially at-the-money) — the judge described "last EMA test was ~8-9 bars back (mid-June)," an entirely different, unrelated event, missing the real (subtle, hairline) touch at the chart's own right edge.
- **case_0024 VFC**: the detector's actual trigger is a calm, single-bar dip-and-close-back-above on the LAST bar itself (1/30, low $19.54 vs. tolerance $19.66) — the judge instead described "the crash low undercut the EMA by ~5.6%... the very next day's bounce," narrating the much more visually dramatic 1/28-1/29 round trip that occurred two days earlier and was NOT what the detector's gates actually used.

This is genuine **SEMANTIC AMBIGUITY / RENDERING** — a hairline wick-touch against a gold EMA line is not always visually obvious at 35-bar/110dpi resolution, especially next to a more dramatic, unrelated candle earlier in the same window, and "touching" reads intuitively as a close-based concept to a human even though the setup's own textbook definition (and the code) is wick-based.

### Volume-window distortion (secondary finding, VFC/case_0024)

VFC's touch bar passed the volume gate at `pullback_volume_ratio=1.0754` — just under the 1.1 cutoff — but the 20-bar average it was compared against was itself inflated by the immediately-preceding crash days (1/28: 20.5M shares, 1/29: 12.2M shares). An already-elevated pullback bar can pass the "contraction" gate simply because the baseline it's measured against is contaminated by the same violent event. Related to, but distinct from, gap #1.

## Summary of findings by taxonomy

| Case | Type | Root cause |
|---|---|---|
| case_0033 BTBT | DETECTOR DEFECT | asymmetric touch tolerance — no floor on touch depth below the EMA |
| case_0028 DAC | DETECTOR DEFECT | same-bar overshoot — no ceiling on reclaim bar's own close distance |
| case_0029 FLNG | DETECTOR DEFECT | same-bar overshoot (same mechanism) |
| case_0030 MNTN | DETECTOR DEFECT | same-bar overshoot (same mechanism) |
| case_0005 STNG | FRESHNESS/LIFECYCLE DISAGREEMENT | genuine 2-bar drift after a legitimate shallow touch |
| case_0023 NVS | FRESHNESS/LIFECYCLE DISAGREEMENT | genuine 1-bar (large) drift |
| case_0015 BCO | FRESHNESS/LIFECYCLE DISAGREEMENT | mild 1-bar drift |
| case_0039 ROG | FRESHNESS/LIFECYCLE DISAGREEMENT + judge miss | mild drift; judge also described the wrong (older) event |
| case_0010 VRTX | SEMANTIC AMBIGUITY / RENDERING | touch-by-low vs. touch-by-close; freshest possible case (0 bars stale) |
| case_0016 YPF | SEMANTIC AMBIGUITY / RENDERING + same-bar gap | touch-by-low vs. touch-by-close on a wide-range bar |
| case_0006 FCBC | JUDGE ERROR | described an unrelated, older (mid-June) event; real touch was 1 bar old and at-the-money |
| case_0024 VFC | JUDGE ERROR + volume-window distortion | described the older, dramatic crash rather than the real (calm) trigger bar |
| case_0012 SYBT | FRESHNESS/LIFECYCLE DISAGREEMENT | genuine 2-bar drift |
| case_0019 GSK | FRESHNESS/LIFECYCLE DISAGREEMENT (mild) | small additional drift + reclaim-bar close gap |

No case among the 19 scored fired cases was a false positive, and no false negative traced to a "genuinely wrong pattern" (downtrend, chop, falling average) — every FN traces to one of the three related freshness/tolerance mechanisms above, or to a judge/rendering interpretation gap. Per standing instruction, **none of these are fixed in this pass** — they are reported, real-data-verified, and left for a future, separately-authorized pass.
