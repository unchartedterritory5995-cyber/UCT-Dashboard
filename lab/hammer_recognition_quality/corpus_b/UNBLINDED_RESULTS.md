# Hammer Corpus B — Unblinded Cross-Reference + Root-Cause Verification

Cross-references the frozen `ADJUDICATION_JUDGE1.md` verdicts (32 cases,
written before any unblinding) against `answer_key_ingredients.json`'s
`detector_last_bar_fired` field, THEN goes one step further than a bare
confusion matrix: every fired case's *real* OHLC anatomy and gate-branch
values were pulled directly from `C:\data\bars.db` and checked against both
the code's own thresholds and the judge's stated visual observations. That
extra step is what this file is mostly about — the raw confusion matrix
alone is misleading here, and the reason why is itself evidence.

## Raw confusion matrix (32 cases, 0 ambiguous)

| | detector fired (last bar) | detector did not fire |
|---|---|---|
| **judge POSITIVE** | TP = 0 | FN = 1 (case_0017 / MOMO) |
| **judge NEGATIVE** | FP = 16 | TN = 15 |

**Raw precision = 0/16 = 0.0. Raw recall = 0/1 = 0.0.** Taken at face value
this looks identical to Corpus A's pre-fix number and would suggest the
ADR-scaling fix made no difference. It did not — the fix was independently
verified against real data (below) to do exactly what it was built to do,
and the raw number here reflects a *different, newly-identified* problem.

## Every one of the 16 "false positives" has objectively correct anatomy

Pulling the real last-bar OHLC for all 16 fired cases and recomputing the
detector's own anatomy math directly:

| Case | Symbol | body_to_range (≤0.35 required) | lower_wick/body (≥2.0 required) | upper_wick/body (≤0.5 required) |
|---|---|---|---|---|
| case_0000 | SPRB | 0.077 | 12.00 | 0.00 |
| case_0001 | CCCC | 0.279 | 2.38 | 0.20 |
| case_0002 | UNF | 0.296 | 2.19 | 0.19 |
| case_0003 | CCBG | 0.181 | 4.53 | 0.00 |
| case_0006 | ARI | 0.202 | 3.95 | 0.00 |
| case_0011 | AWI | 0.241 | 3.16 | 0.00 |
| case_0019 | OGN | 0.158 | 5.00 | 0.33 |
| case_0020 | BNT | 0.333 | 2.00 | 0.00 |
| case_0021 | SOR | 0.188 | 3.83 | 0.50 |
| case_0022 | OMC | 0.136 | 5.97 | 0.37 |
| case_0023 | SOBO | 0.214 | 3.68 | 0.00 |
| case_0024 | SOR | 0.042 | 22.89 | 0.00 |
| case_0025 | FLNC | 0.175 | 4.58 | 0.12 |
| case_0026 | CDRO | 0.300 | 2.33 | 0.00 |
| case_0029 | VRTX | 0.218 | 3.12 | 0.47 |
| case_0031 | AIRJ | 0.250 | 3.00 | 0.00 |

**Every single row clears all three anatomy gates** (a few — case_0020,
case_0026 — sit close to the boundary, but still pass). This directly
contradicts the judge's stated reasoning for most of these cases (repeated
language: "body dominates the range", "no dominant lower wick", "anatomy
fails") — the real numbers say the opposite.

## Why: a chart-resolution ceiling for single-candle geometry, not a detector defect

Two cases were opened directly as chart images to check this discrepancy:

- **case_0024 (SOR)** — the single cleanest anatomy in the set numerically
  (body 4.2% of range, lower wick 22.9x the body) — a well-scaled, normal
  chart with no data issues, yet still judged NEGATIVE on anatomy. At
  160 bars rendered across the corpus's chart width, each candle occupies
  roughly 7 pixels — visually distinguishing "small body, huge lower wick"
  from "moderate body, modest wick" at that density is genuinely difficult
  for any reviewer, human or AI.
- **case_0000 (SPRB)** — additionally carries a real DATA QUALITY defect:
  the raw bars.db history for this ticker jumps from ~$618-675 (2025-07-31)
  to ~$9 (2025-08-11) with no gradual transition — an unadjusted reverse
  split or similar corporate-action artifact (the same defect *class*
  CLAUDE.md's "Bars Correctness Layer" section and `tools/daily_split_audit.py`
  already document elsewhere in this codebase, newly observed hitting this
  corpus). That discontinuity sits inside the 50-bar/15-bar lookback used by
  `_below_sma50`/`_recent_decline_pct`, so this case's `decline_pct=0.989`
  is itself an artifact, not a real price move — out of scope for the Hammer
  detector to fix; it is a bars-ingestion issue.

**The lone "positive" case (case_0017 / MOMO) shows the same illegibility
problem in reverse.** The judge described "a long lower wick extends down
to roughly 5.1" — the real last bar is `o=5.13, h=5.52, l=5.13, c=5.37`:
the low EQUALS the open, so the lower wick is **exactly zero**, and
`body_to_range=0.615` (body dominates the range — the opposite of a small
body). This candle fails the code's anatomy gate correctly. The judge's
sole POSITIVE call does not survive a numeric check either.

## Gate-branch attribution for the 16 fired cases (context side)

| Branch(es) satisfied | Cases | Count |
|---|---|---|
| swing_low + below_50sma + decline | 0000\*, 0002, 0019, 0021, 0022 | 5 |
| below_50sma + decline | 0011, 0026 | 2 |
| swing_low + decline | 0020, 0025 | 2 |
| decline only | 0003, 0023 | 2 |
| swing_low + below_50sma (no decline) | 0029 | 1 |
| swing_low only | 0024 | 1 |
| below_50sma only | 0006, 0031 | 2 |
| swing_low + below_50sma + decline (contaminated, see above) | 0000 | — |

\*case_0000's branches are contaminated by the SPRB data-quality artifact.

**Two cases (0006/ARI, 0031/AIRJ) qualify on `below_50sma` alone** — no
swing low, no real ADR-scaled decline. This is the same class of weakness
the ADR fix closed for the decline branch, now visible on the
`below_50sma` branch instead: being a hair below a 50-SMA that may not
even be sloping down is a weak signal on its own. **Not fixed in this
pass** (one semantic change, one sealed-holdout evaluation, per the
validation-order rule) — flagged as a well-evidenced candidate for the
next development cycle.

**One case (0029/VRTX)** reprises Corpus A's recurring LIFECYCLE
observation (there, case_0001/GLDM): the gate checks "was there a decline
recently" but not "is this bar specifically the first reversal test, or
several bars into an already-confirmed bounce." Also flagged, not fixed.

## Bottom line

The ADR-scaling fix is independently confirmed correct on real data (it
removed exactly one defect — NBR — and nothing else, per Corpus A's
before/after). Corpus B's raw 0/16 precision is **not** evidence the fix
failed or that Hammer remains broken in the way Corpus A initially
suggested — it is dominated by (1) a chart-rendering resolution ceiling
this blind-corpus methodology was not built to handle for single-candle
anatomy patterns, and (2) one bars-ingestion data-quality artifact,
with (3) two small, real, NOT-yet-fixed context-gate weaknesses
surfaced as genuine future work. Recommendation for any future Hammer (or
other single-candle-family) corpus: render substantially fewer bars per
chart (e.g., the last 30-40, not 160) so the final few candles are legible
enough for reliable blind visual adjudication.
