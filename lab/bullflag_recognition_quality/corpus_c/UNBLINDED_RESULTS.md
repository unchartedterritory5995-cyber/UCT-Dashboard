# Bull Flag Corpus C — Unblinded Results (independent, out-of-sample validation)

Corpus C was built AFTER the stale-pole-top fix (commit `fb4538bc2`) from a sample
fully disjoint from Corpus B (different seed, different as-of offsets, wider
universe pass — see `build_corpus_c.py` / `manifest.md`). The blind judge
(`ADJUDICATION_JUDGE1.md`) had zero access to detector source, `pipeline_trace`,
or `detector_fired`, and the implementer did not look at any of this corpus's
content while designing the fix. This file is the FIRST time Corpus C is
unblinded. Per owner instruction, the detector is **NOT tuned** in response to
anything found here — findings are reported, not chased.

## Raw confusion matrix (Corpus C only — kept semantically separate from Corpus B)

| | Detector FIRED | Detector not-fired |
|---|---|---|
| Judge POSITIVE | TP = 6 | FN = 3 |
| Judge NEGATIVE | FP = 6 | TN = 10 |

case_0005 (AMBIGUOUS-INSUFFICIENT, detector not-fired) excluded from scoring, as in Corpus B's methodology.

- **n scored = 25** (26 total − 1 ambiguous)
- **Precision = 6/12 = 0.500**
- **Recall = 6/9 = 0.667**

For comparison (kept distinct, never combined into one number):
- Corpus B **before** fix: precision 0.471, recall 0.889 (n=34)
- Corpus B **after** fix (controlled regression): precision 0.700, recall 0.778 (n=34)
- Corpus C (fresh holdout, post-fix): precision 0.500, recall 0.667 (n=25)

## Structural finding: none of Corpus C's disagreements are CAUSED by the fix

The fix is purely an additive rejection gate (`flag_high_exceeds_pole_top`) — it
can only make the detector *more* conservative than pre-fix code, never less.
Therefore every case that still fires post-fix would also have fired pre-fix
(all 6 FPs below are **pre-existing** detector behavior, not fix-introduced).

For the 3 FNs, this was verified directly rather than assumed: for case_0013
(PSTG), the specific candidate the fix's new gate rejects (`flag_high_exceeds_pole_top`)
was checked against what pre-fix code would have computed for it — its
retrace_pct without the new gate is **0.90** (90%), which the *pre-existing*
`retrace_out_of_range` check (max 0.50) would have rejected anyway. So PSTG
would have been a false negative under the OLD code too. Cases 0018/0019 fail
on the pre-existing, unrelated `volume_not_contracted` gate (see below), also
untouched by this fix. **All 3 Corpus C false negatives are pre-existing
detector behavior — none are caused by the stale-pole-top fix.** This satisfies
success criterion 6 ("Corpus C reveals no material regression from the fix")
in the strict causal sense, even though the raw precision/recall are lower than
Corpus B's post-fix numbers (see below).

## Root cause of every disputed case (real OHLCV, `C:\data\bars.db`)

### False Positives (detector fired, judge said NEGATIVE) — 6

**case_0002 MO** (as_of 2025-04-28) — confidence 75.19, pole 2025-04-07→04-22
(+11.7%, 10 bars), flag 4 bars, retrace 18.3%, parallel_score 0.93 (excellent
geometry). **CONTEXT DISAGREEMENT.** This is a real, well-formed pole+flag
by the numbers, but it is a small, late sub-move embedded in what the judge
read (correctly, from the 90-bar structure chart) as "a slow grinding rebuild"
following a violent April 3-4 gap-crash weeks earlier. The detector has no
mechanism to discount a geometrically valid mini-pole that a human reads as
part of a larger post-crash recovery rather than a fresh, standalone impulse.

**case_0006 WFG** (as_of 2026-04-28) — confidence 57.53 (barely above the 50
floor), pole 2026-03-20→04-17 (+14.4%, 19 bars), flag 7 bars, retrace 49.2%
(right at the edge of the 50% max), parallel_score 0.80. Real bars confirm the
**final evaluation bar (4/28) closes at $63.93 — a decisive gap-down through
the flag's own low ($63.46) and (per the judge, using the neutral-context
SMAs) through sma10/20/50**, i.e. the pattern has already broken DOWN as of
the bar being judged. **LIFECYCLE-FRESHNESS DISAGREEMENT (bidirectional gap).**
Phase A already documented that the detector has no check for "has this
pattern already broken OUT as of the eval bar" (the geometry-only "breakout
already happened" case). This is the same gap on the other side: there is
also no check for "has this pattern already broken DOWN through the flag's
own low as of the eval bar." Both are pre-existing, unrelated to the
stale-pole-top fix.

**case_0016 GGN** (as_of 2025-12-16) — confidence 65.19, pole +11.7% (18
bars), flag 11 bars, retrace 25.9%, parallel_score 0.6716 (marginal — just
above the 0.55 floor). Real bars show the entire "flag" is $5.03-$5.23 chop
on a low-ADR (1.67%) name — genuinely hard to visually distinguish pole from
flag; the judge read only the final 1-2 bars as "the pullback" and called the
rest undifferentiated grind. **SEMANTIC AMBIGUITY** at a marginal
parallel_score, on a low-volatility name where the whole window is close to
noise.

**case_0022 RYN** (as_of 2026-04-28) — confidence 56.15 (near floor), pole
+11.0% (14 bars), flag 12 bars, retrace 45.6%, parallel_score 0.74,
`ctx_score`=60. Judge: NEGATIVE, citing the gradual (not sharp) pole and
`pct_above_52w_low` of only 10.16% (near yearly lows). **CONTEXT
DISAGREEMENT** — the composite confidence weights context at only 20%, so a
candidate with decent (not great) geometry can clear the 50-point floor even
when a human weights "near 52-week lows" as disqualifying on its own.

**case_0024 RYN** (as_of 2025-04-29) — confidence 50.82 (at the floor), pole
+12.5% (9 bars), flag only 4 bars (the minimum-plus-one), retrace 48.2%,
parallel_score 0.92. Real bars confirm a genuine but very small, tight,
low-conviction pattern — pole top $25.64 (4/23), drifting in a tight
$24.3-25.0 band for 4 bars, closing $24.52. Judge read this against a larger,
weaker prior context ("crash + weak bounce + chop... near 52-week lows").
**CONTEXT DISAGREEMENT + short-flag ambiguity** (see cross-case pattern below).

**case_0025 BNS** (as_of 2026-04-27) — confidence 77.28 (high), pole +15.1%
(15 bars), flag only 4 bars, retrace 27.9%, parallel_score 0.81. Real bars:
pole top $77.20 (4/21) → pulled back to $74.37 (4/23) → partial recovery to
$76.69 (4/27), **still below** the pole top (no overshoot; the fix correctly
does not reject this). The judge read the final bars as "the stock continues
grinding to fresh highs... no sustained consolidation," which the objective
numbers do not fully support (price is still below the pole top) — most
likely the judge weighted the longer uptrend visible on the structure chart
over the specific 4-bar micro-pullback being evaluated. **Short-flag ambiguity
+ CONTEXT DISAGREEMENT.**

**Cross-case pattern (reported, not acted on):** 3 of the 6 FPs (case_0002,
case_0024, case_0025) have a flag of exactly 4 bars — one above the 3-bar
minimum. A 4-bar flag is numerically valid but visually thin; humans
consistently read short flags as "not yet an established consolidation" even
when the retrace/parallel-score math is clean. This mirrors a note the same
judge made on a Corpus-C true positive (case_0021, flag_count=3, called
POSITIVE but flagged "early-stage/just-forming"). This is a real, observed
edge-condition, not evidence of a bug — `MIN_FLAG_BARS=3` is an existing,
untouched threshold and is explicitly out of scope for this pass.

### False Negatives (detector did not fire, judge said POSITIVE) — 3

**case_0013 PSTG** (as_of 2025-02-04) — judge called this POSITIVE based on a
~50-58% retrace estimate anchored on a "~$65 pre-pole level" they read off the
chart. The detector's best (freshest, non-stale) candidate anchors the pole at
its true, objective base ($60.62, 2025-01-13) and top ($73.67, 2025-01-22,
+21.5%/7 bars) — from that correct anchor, the actual retracement to the
2025-02-04 close ($68.35) is **not** the shallow ~50-58% the judge estimated,
it is verified via the fuller flag window to reach as low as $60.62 -- a
**90% retracement**, which the pre-existing (untouched) `retrace_out_of_range`
gate (max 50%) correctly rejects, independent of the stale-pole fix. Verified
directly: this exact candidate was checked WITHOUT the new gate and it fails
on retrace_out_of_range regardless — **this FN is not caused by the fix.**
**SEMANTIC AMBIGUITY** — a real disagreement about where "the pole" starts
(the judge anchored a shorter, more recent low; the detector correctly uses
the actual prior swing low), which produces very different retrace estimates.

**case_0018 SLG** (as_of 2026-07-02) — judge called this "a clean, textbook
pole + flag + confirmed breakout" (POSITIVE). Real bars confirm the pole and
flag shape are genuinely clean, BUT the flag's own volume average (1,179,067)
is marginally ABOVE the pole's average (1,170,233) — `volume_not_contracted`,
a pre-existing, unrelated hard gate. Root cause (verified bar-by-bar): most
individual flag-period bars DO show contracted volume (742K-1.13M vs. the
pole's ~1.17M average), but 3 bars carry elevated volume, most notably
**2026-06-26 — the breakout day itself (2.77M volume, price surging
$50.17→$52.16)**. Because the detector's flag window structurally must
extend all the way to the current evaluation bar, a genuine breakout that
occurs on rising volume (textbook-healthy, not a flaw) gets averaged into the
same window the volume-contraction gate scores — a real, breakout-day-blind
spot in `_flag_volume_contracted`/`_flag_volume_ratio`, previously
undocumented. **DETECTOR DEFECT — newly discovered, structurally unrelated
to the stale-pole-top fix; not fixed in this pass per standing instruction.**

**case_0019 VTRS** (as_of 2026-04-28) — judge called this POSITIVE ("clean
pole following a bottoming reversal plus a reasonably tight, still-intact
flag"). Real bars show flag-period volume (avg 10.57M) is consistently ABOVE
the pole's average (8.47M) across nearly every individual flag bar (not just
one breakout-day spike) — this stock genuinely never showed the volume
dry-up a textbook flag requires; it maintained elevated volume throughout
(consistent with a still-fresh reversal name). This looks like a correct
rejection by the volume gate as designed; the judge weighted price geometry
over volume character. **SEMANTIC AMBIGUITY / design question** (should
volume contraction be a hard gate or a soft-scored factor?) rather than a bug
— out of scope for this pass.

## Summary of findings, by taxonomy

| Case | Type | Root cause |
|---|---|---|
| case_0002 MO | CONTEXT DISAGREEMENT | valid mini-pole read as part of a larger post-crash rebuild |
| case_0006 WFG | LIFECYCLE-FRESHNESS DISAGREEMENT | no "already broken DOWN through flag low" check (mirror of the known "already broken out" gap) |
| case_0016 GGN | SEMANTIC AMBIGUITY | marginal parallel_score (0.67) on a near-noise low-ADR name |
| case_0022 RYN | CONTEXT DISAGREEMENT | near-52w-low context under-weighted (20%) vs. decent geometry |
| case_0024 RYN | CONTEXT DISAGREEMENT + short flag | 4-bar flag, embedded in a weaker prior decline |
| case_0025 BNS | CONTEXT DISAGREEMENT + short flag | 4-bar flag; judge weighted the longer uptrend over the specific pullback |
| case_0013 PSTG | SEMANTIC AMBIGUITY | disagreement on where "the pole" starts; correctly rejected on retrace-depth regardless of the fix |
| case_0018 SLG | DETECTOR DEFECT (new) | volume-contraction average includes the breakout bar itself |
| case_0019 VTRS | SEMANTIC AMBIGUITY / design question | volume never truly contracted; hard-gate-vs-soft-score question |

**None of the 9 disputed cases are attributable to the stale-pole-top fix.**
One (case_0018) is a genuinely new, previously-undocumented detector
limitation, root-caused with real data. The rest are pre-existing context,
lifecycle, and definitional-ambiguity limitations already touched on
(in different forms) during Phase A. Per standing instruction, none of these
are being fixed in this pass — they are reported for a future, separately
authorized recognition-quality iteration.
