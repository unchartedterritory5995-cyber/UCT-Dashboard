# Bull Flag Corpus B — Unblinded Cross-Reference + Root-Cause Analysis

Cross-references the frozen `ADJUDICATION_JUDGE1.md` verdicts (40 cases,
written before any unblinding) against `answer_key_ingredients.json`'s
`detector_fired` field, then uses the preserved `pipeline_trace` (a full
gate-by-gate re-run of `detect_bull_flag`'s own internal extraction,
computed at corpus-build time, never shown to the judge) plus direct real
OHLCV re-verification to classify every disagreement's root cause.

## Raw confusion matrix (34 non-ambiguous cases; 6 ambiguous excluded)

| | detector fired | detector did not fire |
|---|---|---|
| **judge POSITIVE** | TP = 8 | FN = 1 (case_0020 / PRNT) |
| **judge NEGATIVE** | FP = 9 | TN = 16 |

**Precision = 8/17 = 0.471. Recall = 8/9 = 0.889.**

6 AMBIGUOUS-INSUFFICIENT cases excluded (case_0003, 0007, 0008, 0028, 0031,
0035) — all genuine toss-ups per the judge's own reasoning (mostly
borderline 50-65% retracements paired with otherwise-supportive structure),
none flagged as data artifacts.

## THE dominant root cause: stale pole-top selection

Of the 9 false positives, **7 show the identical mechanism**, confirmed with
real OHLCV for two of them:

**case_0018 (BHP):** the detector's chosen pole-top is 2026-02-11 at a high
of $75.14. But between then and the evaluation date (2026-02-26), price
climbed to a high of **$82.34 on 2026-02-25** — 9.6% ABOVE the "pole top" —
before a 1-2 day pullback to $81.07. The code's `retrace_pct` is computed as
`(pole_top_price - flag_low) / pole_height`, using only the flag's LOW
against the stale pole-top — it never checks whether the flag's HIGH (or the
current price) has since exceeded the pole-top. So a stock that broke to
fresh highs well past the "pole" and only pulled back slightly at the very
end scores as a textbook-moderate 33% retrace, when the real story (per the
judge, independently: "very strong, accelerating, near-monotonic advance...
no pause exists") is that the pole never stopped.

**case_0030 (CMBT):** identical mechanism. Pole-top selected at 2026-01-30
($13.16 high); price reached **$14.93 on 2026-02-19 or later** (13.5% above
the pole-top) before the small pullback the code scored as a "textbook" 30%
retrace (literally the code's own scoring-formula optimum). Judge,
independently: "no consolidation exists... near-continuous climb."

The same shape (a stale, several-bars-old pole-top with price having since
made fresh highs) is consistent with the judge's write-ups for case_0000,
0010, 0015, 0016, 0025 as well — in each, the judge's independent visual
retrace/duration estimate is dramatically different from (usually much
larger/smaller than) the code's own computed number, always in the
direction of "the code is scoring a narrower or older window than what a
human reads as the current situation."

**Mechanism:** `_candidate_pole_tops` draws only from `detect_pivots`'s
CONFIRMED swing-high pivots (`window=3`, meaning a pivot needs price to roll
over for several bars before it's recognized) — during a strong, still-
accelerating advance with no real pullback yet, there is structurally NO
recent confirmed pivot, so every candidate the code considers is several
bars to a few weeks stale. Combined with the retrace formula never checking
`flag_high` against `pole_top_price`, a stock that kept making new highs
after the stale pole and only paused briefly at the very end can still
satisfy every numeric gate.

**This same mechanism plausibly explains the one false negative too.**
case_0020 (PRNT): the judge identified a pole from ~May 19-29 (a real,
current advance) — but the detector's candidate list (preserved in
`pipeline_trace`) contains NO pole-top after 2026-05-14; `detect_pivots`
had evidently not yet confirmed the judge's later, more relevant peak as of
the June 3 evaluation date. The nearest available (stale) candidate's
resulting retrace (55.21%) narrowly exceeds the 50% ceiling by 5 points —
so the SAME stale-candidate mechanism that inflates false positives here
starves the detector of the one candidate that would have matched the
judge's read, producing a miss instead.

**Classification: DETECTOR DEFECT CANDIDATE (semantic/structural, not a
threshold-tuning issue).** Two independent, precisely-evidenced components:
1. Pole-top candidates can be stale relative to the current tape (a
   `detect_pivots`-confirmation-lag effect).
2. The retrace/depth calculation never verifies the flag's high hasn't
   already exceeded the pole-top price — i.e., never checks that the
   "flag" isn't actually the pole still running.
A minimal proposed correction (**NOT implemented, documented only, per
instruction**): reject a candidate if `flag_high > pole_top_price` (price
has made a fresh high since the chosen pole apex — this is continuation,
not consolidation, regardless of what the retrace math says about the
flag's low). This does not touch any existing threshold constant.

## Other false positives (not part of the stale-pole pattern)

- **case_0017 (KROS):** judge reads a wide, choppy, directionless multi-month
  range with no single sharp advance. Classification: **SEMANTIC AMBIGUITY**
  — plausibly a milder version of the same stale-candidate effect (not
  independently re-verified with raw OHLCV), or a genuine case where the
  code's specific 12-bar slice satisfies gates without representing the
  stock's real character.
- **case_0023 (MCRI):** pole_pct = 10.35%, barely above the 8% floor, but the
  judge reads it as "a gradual recovery bounce, not a sharp advance."
  Classification: **THRESHOLD/DEFINITIONAL GAP** — the pole gate checks only
  cumulative % advance and a bar-count ceiling, with no steepness/velocity
  requirement, so a slow grind spread over close to the 20-bar cap can
  clear "8%+ advance" without looking "sharp" to a human at all. Distinct
  from the stale-pole mechanism above; NOT proposed as a fix here (would be
  threshold-adjacent tuning, explicitly out of scope for this pass).

## Geometry finding (confirmed by direct source read, not by this corpus)

`_try_extract_pattern` builds `upper_pivots`/`lower_pivots` with
`"t": pole_top_idx + 1 + i` — a raw bar INDEX, not a timestamp
(`bull_flag.py` ~lines 167-172). `_build_detection` casts this straight into
`geometry.anchors[].t` (~lines 495-499) with no bar-index-to-timestamp
conversion. This is the identical bar-index-as-timestamp leak already fixed
for 7 sibling `trendline_pair` detectors — confirmed here by static read to
also affect `bull_flag.py`, which is a **separately-pending package** per
standing instruction. **Not touched in this pass.** This is an IDENTITY-
ACCURACY-INDEPENDENT finding: a case can have a perfectly correct pole/flag
identity call and still render a broken trendline overlay on the member-
facing chart, because the anchors feeding `TrendlinePair.jsx` are wrong
regardless of whether the underlying pole/flag identification is right.

## Bottom line

Bull Flag's independent recognition-quality number on real-world data
(precision 0.471, recall 0.889, n=34) is now measured, not asserted, and —
unlike Hammer — the dominant cause of its false positives is a genuine,
precisely-evidenced **detector semantic gap** (stale pole-top selection +
an unchecked flag-high-vs-pole-top comparison), not a corpus or rendering
artifact. No detector code was modified in this pass.
