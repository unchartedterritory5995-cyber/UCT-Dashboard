# Corpus B — Label Integrity Review

For every one of the 32 original Corpus B cases, the real last-bar OHLC was
pulled directly from `C:\data\bars.db` (read-only) and independently
recomputed: `body_to_range`, `lower_wick/body`, `upper_wick/body`, candle
direction. These are pure arithmetic on the stored price data — not the
detector's output, not a re-run of `detect_hammer`. Each case's original
judge (`ADJUDICATION_JUDGE1.md`) verdict is then checked ONLY against
whether the *specific anatomical claims the judge wrote down* are
consistent with these real numbers. The detector's own boolean result is
never used as the standard here — a case can be (and several are) genuinely
correctly rejected by the judge for a real reason while still describing
the wrong anatomy; that is still flagged below, because the description
is what a corpus's "ground truth" needs to be defensible.

Classification used: **VALID GOLD LABEL** (stated anatomy claims are
consistent with the real numbers, whether or not the final verdict agrees
with the detector) / **AMBIGUOUS** (case sits close enough to a threshold
that reasonable readers could differ, or the judge appropriately hedged)
/ **CORPUS LABEL DEFECT** (a specific factual claim about the candle's
shape is objectively contradicted by the real OHLC).

## Fired cases (16) — real anatomy vs. judge's stated claims

| Case | Symbol | body_to_range | lw/body | uw/body | Judge's anatomy claim | Classification |
|---|---|---|---|---|---|---|
| case_0000 | SPRB | 0.077 | 12.00 | 0.00 | "body spans nearly its full range" | **DEFECT** (+ data-quality: unadjusted-split window) |
| case_0001 | CCCC | 0.279 | 2.38 | 0.20 | "body takes up most of the bar" | **DEFECT** |
| case_0002 | UNF | 0.296 | 2.19 | 0.19 | "fairly full-bodied... no long lower shadow" | **DEFECT** |
| case_0003 | CCBG | 0.181 | 4.53 | 0.00 | "body spans most of its range" | **DEFECT** |
| case_0006 | ARI | 0.202 | 3.95 | 0.00 | "not decisive; unremarkable" (hedged) | VALID |
| case_0011 | AWI | 0.241 | 3.16 | 0.00 | "no visible dominant lower wick" | **DEFECT** |
| case_0019 | OGN | 0.158 | 5.00 | 0.33 | "unremarkable" (hedged on anatomy; context read disputable but not a factual anatomy claim) | VALID |
| case_0020 | BNT | 0.333 | 2.00 | 0.00 | "no visibly long lower wick" | AMBIGUOUS (both ratios sit exactly at the code's threshold, not comfortably past it) |
| case_0021 | SOR (Dec) | 0.188 | 3.83 | 0.50 | "body spanning most of the range" | **DEFECT** |
| case_0022 | OMC | 0.136 | 5.97 | 0.37 | "no standout wick structure" | **DEFECT** |
| case_0023 | SOBO | 0.214 | 3.68 | 0.00 | "modest wick, insufficient" | **DEFECT** (mild — a 3.68x wick is not "modest") |
| case_0024 | SOR (Sep) | 0.042 | 22.89 | 0.00 | "no standout lower wick" | **DEFECT** (most extreme contradiction in the set) |
| case_0025 | FLNC | 0.175 | 4.58 | 0.12 | "more spinning-top than hammer... visible upper wick" | **DEFECT** |
| case_0026 | CDRO | 0.300 | 2.33 | 0.00 | "moderate body, only a modest wick" | AMBIGUOUS (both ratios pass but not dramatically) |
| case_0029 | VRTX | 0.218 | 3.12 | 0.47 | "larger-bodied... no dominant wick isolated to this bar" | **DEFECT** on anatomy (the separate lifecycle point — continuation vs. first reversal — is a legitimate, distinct observation, not an anatomy defect) |
| case_0031 | AIRJ | 0.250 | 3.00 | 0.00 | "small and unremarkable" (hedged) | VALID |

**Fired-case tally: 10 DEFECT, 3 AMBIGUOUS, 3 VALID.**

## Not-fired cases (16) — real anatomy vs. judge's stated claims

All 16 genuinely fail the code's anatomy gate on the real numbers (either
body too large, or upper wick too large — i.e., a spinning-top/doji shape,
not a hammer). The check here is whether the judge's *specific reason*
matches which gate actually fails.

| Case | Symbol | body_to_range | lw/body | uw/body | Real failure reason | Judge's claim | Classification |
|---|---|---|---|---|---|---|---|
| case_0004 | KIE | 0.402 | 0.93 | 0.56 | body too large | "large red body dominates" | VALID |
| case_0005 | SUPV | 0.467 | 0.86 | 0.29 | body too large, wick too small | "small... no dominant wick" (verdict right, "small" imprecise) | VALID (net-correct) |
| case_0007 | FIBK | 0.694 | 0.18 | 0.26 | body too large | "body too large" | VALID |
| case_0008 | FXI | 0.815 | 0.11 | 0.11 | body too large | "large body, not hammer-shaped" | VALID |
| case_0009 | ISRG | 0.176 | 3.13 | 1.57 | upper wick too large (real disqualifier) | "no standout wick structure" (misses the real reason, verdict still right) | VALID (net-correct, reasoning incomplete) |
| case_0010 | BIDU | 0.546 | 0.43 | 0.40 | body too large | "no dominant lower wick" | VALID |
| case_0012 | RDZN | 0.700 | 0.43 | 0.00 | body too large | "small red body" (verdict right, "small" wrong) | AMBIGUOUS (description off, verdict correct) |
| case_0013 | AEO | 0.559 | 0.33 | 0.46 | body too large | "large red body dominates" | VALID |
| case_0014 | LUNR | 0.524 | 0.37 | 0.54 | body too large | "small, nondescript" (verdict right, "small" wrong) | AMBIGUOUS |
| case_0015 | RLI | 0.099 | 5.29 | 3.79 | upper wick too large (real disqualifier) | "large-range red candle with the body dominating" | **DEFECT** (body is 9.9% of range — small, not dominating) |
| case_0016 | TEX | 0.154 | 3.48 | 2.00 | upper wick too large (real disqualifier) | "not decisive" (hedged) | VALID |
| case_0017 | MOMO | 0.615 | 0.00 | 0.62 | body too large, ZERO lower wick | "small body... long lower wick extends to ~5.1" | **DEFECT** (the FN — real low equals real open; the claimed lower wick does not exist) |
| case_0018 | USA | 0.500 | 1.00 | 0.00 | body too large / wick insufficient | "without standout long lower wick" | VALID |
| case_0027 | VIR | 0.704 | 0.00 | 0.42 | body too large, zero wick | "without standout wick" | VALID |
| case_0028 | PML | 0.889 | 0.12 | 0.00 | body too large | "sizable green body" | VALID |
| case_0030 | ELMD | 0.882 | 0.00 | 0.13 | body too large | "larger-bodied green candle" | VALID |

**Not-fired-case tally: 2 DEFECT (case_0015, case_0017/the FN), 2 AMBIGUOUS (minor description looseness, net-correct verdict), 12 VALID.**

## Totals across all 32 cases

- **CORPUS LABEL DEFECT: 12** (10 of the 16 fired cases, 2 of the 16
  not-fired cases — including the sole "positive" case, case_0017).
- **AMBIGUOUS: 5** (3 fired, 2 not-fired).
- **VALID GOLD LABEL: 15** (3 fired, 12 not-fired).

**No verdicts were changed.** This review only classifies whether the
*stated evidence* for each verdict is defensible — it does not re-adjudicate
or overwrite `ADJUDICATION_JUDGE1.md` or `UNBLINDED_RESULTS.md`, which
remain exactly as originally frozen.

## Reading the pattern

Defects concentrate overwhelmingly in cases requiring the judge to
distinguish a genuinely SMALL body + long wick from a larger one (10 of 12
defects are exactly this) — precisely the fine-grained geometric judgment
a 160-bar/~7px-per-candle image cannot support. Cases where the correct
call only needed a coarse "is the body obviously huge" read (most of the
not-fired set) came back clean. This is the direct evidentiary basis for
concluding the render resolution, not judge competence or detector logic,
is the dominant cause — see `corpus_b_v2/` for the fix and its
re-adjudication.
