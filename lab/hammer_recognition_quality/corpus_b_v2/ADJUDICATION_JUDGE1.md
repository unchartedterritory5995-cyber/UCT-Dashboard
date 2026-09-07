# Hammer Recognition — Blind Adjudication (Judge 1)

**Method note:** Each case was judged from two chart images — a morphology view (last ~16 bars, no moving averages) and a context view (last ~90 bars, with moving averages) — plus the packet's neutral price/volume context (SMAs, %-of-52w-high/low, ADR%, volume averages) only. No pattern-detector source code, detector output, or any prior adjudication file was read or consulted. The candidate bar in each case is the rightmost bar on both images, marked by a neutral gray dashed vertical line.

---

## case_0000

- **Morphology**: UNCLEAR — The morphology image is essentially unreadable: only two candles render near the top of the plot (~$600-670) and the remaining ~14 bars collapse to flat slivers near the bottom of the price axis. This is not a legible candle shape at all.
- **Context**: UNCLEAR — Same problem on the context chart: the SMA lines suddenly plunge from ~$600 to ~$200 near the right edge, and `neutral_context` shows `last_close=8.2` while `sma20=196.33` and `sma50=366.87` — an ~40-70x mismatch between the current price and its own recent moving averages.
- **Final verdict**: AMBIGUOUS-INSUFFICIENT
- **Notes**: This is a textbook internal-inconsistency / data-artifact case (per the packet's own provenance warning): the price series appears to jump by an order of magnitude within the lookback window with no gradual transition, consistent with an unadjusted split or a bad data stitch. The rendered candles are not usable for a morphology or context call, so this is flagged rather than guessed.

## case_0001

- **Morphology**: PASS — The candidate (rightmost, green) has a small body (~3.72-3.745) sitting at the top of its range, a lower wick extending to ~3.65 (roughly 2.5-3x the body height), and negligible upper wick (body top ≈ high).
- **Context**: PRESENT — The context chart shows a clear ~1-week decline into the candidate, from ~4.2 (Aug 26) down to ~3.7 (candidate day). `last_close` (3.745) sits below sma10/20/50 (3.93/3.99/3.91), consistent with a genuine short-term pullback rather than chop.
- **Final verdict**: POSITIVE
- **Notes**: None.

## case_0002

- **Morphology**: PASS — Small body (~273.3-275.0) at the top of the bar's range, long lower wick down to ~269.5 (roughly 2-3x body), essentially no upper wick (body top ≈ high).
- **Context**: PRESENT — A month-long pullback from the late-July peak (~300) down to ~275 by the candidate day is clearly visible on the context chart; `last_close` (275.17) sits below sma10/20/50 (281.5/285.1/284.0).
- **Final verdict**: POSITIVE
- **Notes**: None.

## case_0003

- **Morphology**: UNCLEAR — Small body (~44.85-45.05) with a long lower wick to ~43.15 (ratio ~8.5x, easily passes), but the upper wick (~45.05 to ~45.65, ≈0.6) is not negligible — it is roughly 3x the body itself, which does not satisfy "little or no upper shadow."
- **Context**: ABSENT — The context chart shows a strong multi-week rally into the candidate (from ~41 on Dec 3 to ~45.7 on Dec 15-16), with only a single sharp down day right before the candidate. `pct_of_52w_high=98.2` and `last_close` above all SMAs confirm the stock is extended near highs in an uptrend, not bottoming after a decline.
- **Final verdict**: NEGATIVE
- **Notes**: Classic "hammer shape appearing inside an uptrend" — the context disqualifies it even setting aside the imperfect upper wick.

## case_0004

- **Morphology**: FAIL — The candidate's body (~60.5-60.85) is not small relative to its range, and it has roughly balanced upper (~0.3) and lower (~0.35) wicks — a spinning-top-like shape, not a hammer (lower wick nowhere near 2x the body).
- **Context**: ABSENT — Context chart shows a steady uptrend from ~57 (Aug) to ~61 (Dec), with `last_close` (60.54) above all SMAs and `pct_of_52w_high=98.81` — extended near highs, no preceding decline.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0005

- **Morphology**: PASS — Small body (~8.80-8.93) with a very long lower wick down to ~8.08 (~5.5x body), negligible upper wick. Strong hammer shape.
- **Context**: PRESENT — Clear ~1-week decline from ~10 (Apr 17) down to ~8.8 by the candidate day; `last_close` (8.92) sits below sma10/20/50 (9.44/9.49/9.26).
- **Final verdict**: POSITIVE
- **Notes**: One of the cleanest hammers in the set.

## case_0006

- **Morphology**: PASS (marginal) — Small body (~6.87-6.90) with a lower wick to ~6.80 (ratio ~2.3x, just over the threshold), negligible upper wick.
- **Context**: WEAK — The broader context chart shows a sharp multi-month crash (from ~11 to ~7) that ended well before the visible morphology window; the last 16 bars themselves are range-bound chop between ~6.78-6.95 with no clear directional move into the candidate. `pct_above_52w_low=7.0` puts it near a multi-month base, but the immediate pre-candidate action is noise, not a fresh decline.
- **Final verdict**: NEGATIVE
- **Notes**: Sits near a post-crash base, but the immediate 16-bar window is chop, not a decline — matches the "range-bound chop is not valid context" rule.

## case_0007

- **Morphology**: FAIL — The candidate is a small green body (~37.55-37.85) with only minor wicks on either side — no dominant lower tail (well under 2x body).
- **Context**: WEAK — There is a real decline earlier in the window (39.3 on Aug 14 down to ~36.35 on Aug 29), but the candidate occurs 4-5 days into a recovery rally off that low, not at the reversal point itself.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0008

- **Morphology**: FAIL — The candidate is a large green body (~38.7-39.2), not a small body — this is a breakout/continuation candle, not remotely hammer-shaped.
- **Context**: ABSENT — Context chart shows a sustained uptrend from ~33 (mid-April) to ~39 (Aug), with the candidate itself a strong breakout bar — no preceding decline.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0009

- **Morphology**: FAIL — Small red body (~366.5-368) with only a modest lower wick to ~364.5 (ratio ~1.3x) — falls short of the ~2x threshold.
- **Context**: PRESENT — A genuine ~3-week decline from ~410 (Aug 12) down to ~367 by the candidate day is visible; `last_close` (366.7) sits below sma10/20/50 (371.0/381.7/381.0).
- **Final verdict**: NEGATIVE
- **Notes**: Good context, insufficient candle anatomy.

## case_0010

- **Morphology**: FAIL — Body occupies the lower-middle of the range (~88.6-90.0) with a longer UPPER wick (to ~91.3, ≈1.3) than lower wick (to ~88.15, ≈0.45) — this is the opposite shape from a hammer.
- **Context**: ABSENT — Context chart shows chop/rally rather than decline; `last_close` (90.01) sits above sma10/20/50 (88.7/87.9/87.8).
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0011

- **Morphology**: PASS — Small red body (~184.7-185.2) at the top of its range, lower wick to ~183.0 (ratio ~3.4x), negligible upper wick.
- **Context**: PRESENT — A clear 3-4 day decline (from ~189.7 on Dec 14 down to ~183 on the candidate day) sits within a broader Oct-Nov correction (peak 205 → trough ~180); `last_close` is below sma10/sma20 and well below sma50.
- **Final verdict**: POSITIVE
- **Notes**: None.

## case_0012

- **Morphology**: FAIL — The candidate is a small, plain red body (~1.295-1.335) continuing the decline, with no dominant lower wick.
- **Context**: PRESENT — A ~2-week decline from ~1.55 (Aug 24 peak) down to ~1.3 by the candidate is clearly visible (~16% drop).
- **Final verdict**: NEGATIVE
- **Notes**: Good context, no hammer shape on the candle itself.

## case_0013

- **Morphology**: FAIL — The candidate is a large red body (~17.4-17.95), not a small body, with a modest lower wick (~0.45x body) — reads as a strong down day, not a hammer.
- **Context**: PRESENT — A sharp ~1-week decline from ~20 (Apr 23) down to 17.4 by the candidate is visible.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0014

- **Morphology**: FAIL — The candidate's body (~8.65-9.0) shows no dominant lower wick; if anything the visible wick sits above the body, not below.
- **Context**: PRESENT (strong) — A clean ~6-week, ~35% decline from ~13.2 (mid-July) down to ~8.6 by the candidate; `pct_above_52w_low=99.22` (essentially at a fresh 52-week low) and `last_close` well below all SMAs.
- **Final verdict**: NEGATIVE
- **Notes**: Textbook "great context, wrong candle shape" trap — exactly the failure mode the project's prior evidence file warns about (context alone should never stand in for morphology).

## case_0015

- **Morphology**: FAIL — Small red body (~52.0-52.35) with only a modest lower wick to ~51.55 (ratio ~1.3x) — short of the ~2x bar despite sitting at the bottom of a sharp decline.
- **Context**: PRESENT (strong) — A steep multi-month decline (from ~65 in Dec to ~52 by the candidate), accelerating into the final days; `pct_above_52w_low=2.0` — essentially at the 52-week low.
- **Final verdict**: NEGATIVE
- **Notes**: Another "context is compelling, candle anatomy is not" case.

## case_0016

- **Morphology**: PASS — Small red body (~61.9-62.3) at the top of its range, lower wick to ~61.05 (ratio ~2.1-2.5x), negligible upper wick.
- **Context**: WEAK — The broader context chart is a multi-week uptrend (from ~58 in late March/early April to ~64 by Apr 27); the candidate follows only a 2-day pullback (64.2 → 61.9, ~3.6%) inside that uptrend, not a genuine decline.
- **Final verdict**: NEGATIVE
- **Notes**: Hammer-shaped candle inside an ongoing uptrend — matches the "not valid context" rule even though the anatomy itself is clean.

## case_0017

- **Morphology**: FAIL — The candidate's body (~5.15-5.37) has an upper wick to ~5.52 (≈0.15) that is larger than its lower wick to ~5.10 (≈0.05) — the long wick is on top, the opposite of a hammer.
- **Context**: PRESENT — A sharp decline into the candidate (from ~5.8 with chop, down to ~5.1 on the prior day) is visible.
- **Final verdict**: NEGATIVE
- **Notes**: Opposite-shape disqualification overrides the otherwise-good context.

## case_0018

- **Morphology**: FAIL — At this small price scale the candidate's body (~6.17-6.20) and lower wick (~6.135) give a ratio of roughly ~1.2x — short of the 2x bar, and the body is not obviously dominated by a tail.
- **Context**: ABSENT — Context chart shows a steady uptrend from ~5.97 (Nov 24) to ~6.2 by the candidate, with only a single-day pullback beforehand; `pct_of_52w_high=84.06` and no real preceding decline.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0019

- **Morphology**: PASS (strong) — Small body (~6.95-7.02) with a long lower wick to ~6.65 (ratio ~4-5x), negligible upper wick.
- **Context**: PRESENT (strong) — A clear ~3-week decline from ~7.85 (Nov 28) down to ~7.0 by the candidate; `last_close` (6.97) well below sma10/20/50 (7.15/7.30/7.83).
- **Final verdict**: POSITIVE
- **Notes**: One of the strongest genuine hammers in the set — clean anatomy plus a clean preceding decline.

## case_0020

- **Morphology**: FAIL — The candidate is a small plain green body (~42.65-42.85) continuing the prior day's move, with no dominant lower wick.
- **Context**: WEAK — Only a modest 2-3 day pullback (43.25 → 42.2, recovering to 42.85) sits within a longer consolidation range; `last_close` sits near sma50, not clearly oversold.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0021

- **Morphology**: FAIL — The candidate is a tiny, roughly symmetric doji/cross-shaped candle (small wicks on both sides) following a large red decline day — it does not show a dominant lower wick.
- **Context**: PRESENT — A fresh decline from ~48.5 (Dec 11) down to ~46 by the candidate (sharp on the prior day) is visible.
- **Final verdict**: NEGATIVE
- **Notes**: Good context, but the candle itself reads as a doji, not a hammer.

## case_0022

- **Morphology**: PASS — Small-to-medium body (~76.5-77.05) with a long lower wick to ~74.8 (ratio ~3.1x), negligible upper wick.
- **Context**: PRESENT — A ~1-week decline from ~79 (Apr 20) down to ~76 by the candidate is visible, itself part of a choppier multi-week range; `last_close` sits below sma10/sma50 and near sma20.
- **Final verdict**: POSITIVE
- **Notes**: None.

## case_0023

- **Morphology**: FAIL — Small red body (~37.05-37.35) with a lower wick to ~36.65 (ratio ~1.3x) — short of the 2x bar.
- **Context**: WEAK/ABSENT — The recent action is range-bound chop between ~36.9-39 with no sustained directional move into the candidate; `pct_of_52w_high=94.95` — the stock is near 52-week highs, not bottoming after a decline.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0024

- **Morphology**: PASS (strong) — Small body (~46.4-46.5) with a long lower wick to ~45.75 (ratio ~6.5x), negligible upper wick.
- **Context**: WEAK — The visible 16-bar window is largely choppy/range-bound (roughly 45.75-47.85) with only a shallow 2-3 day dip immediately before the candidate, not a sustained decline; sma10/20/50 (46.65/46.63/46.22) are all clustered tightly around `last_close` (46.47), indicating a flat/rangebound stock rather than a clear downtrend.
- **Final verdict**: NEGATIVE
- **Notes**: Clean anatomy undermined by chop-like context — a case where morphology alone should not carry the verdict.

## case_0025

- **Morphology**: PASS — Small body (~20.6-21.15) with a long lower wick to ~18.6 (ratio ~3.6x), negligible upper wick.
- **Context**: PRESENT — Despite the stock being in a much larger multi-month uptrend (up several hundred percent per `pct_above_52w_low=515.9`), there is a genuine, sharp ~1-week decline immediately before the candidate (from ~24.7 on Dec 11 down through the candidate's wick low of 18.6, roughly -24%).
- **Final verdict**: POSITIVE
- **Notes**: High-ADR (10.8%) name — flagged as a case worth a second look given the extreme volatility could make ordinary noise look like a large wick, but by the letter of the criteria (real local decline + real hammer anatomy) it qualifies.

## case_0026

- **Morphology**: PASS (marginal) — Small body (~8.98-9.12) with a lower wick to ~8.7 (ratio ~2x), negligible upper wick.
- **Context**: PRESENT — A fresh 2-3 day decline (from ~9.15 on Aug 29 down to ~8.55 by Sep 2, ~6.5%) precedes the candidate's recovery.
- **Final verdict**: POSITIVE
- **Notes**: Ratio is right at the threshold — a lower-confidence pass, but the shape and context both point the same direction.

## case_0027

- **Morphology**: FAIL — The candidate's body (~4.40-4.57) has an upper wick to ~4.68 but essentially no lower wick — the opposite of a hammer.
- **Context**: PRESENT — Part of a long multi-month decline (from ~7.3 in April down to ~4.5), with the stock near 52-week lows (`pct_above_52w_low=10.23`).
- **Final verdict**: NEGATIVE
- **Notes**: Opposite-shape disqualification.

## case_0028

- **Morphology**: FAIL — The candidate is a small plain green body (~7.12-7.19) with no dominant lower wick.
- **Context**: PRESENT — A sustained ~2-month decline (~7.8 to ~7.1) with the final weeks accelerating into the candidate.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0029

- **Morphology**: FAIL — Small red body (~430.5-431.8) with only a modest lower wick — ratio well under 2x, and the candle is still a down-close bar without a clear reversal tail.
- **Context**: PRESENT — A clean ~2-week staircase decline from ~449 (Apr 15) down to ~430 by the candidate.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0030

- **Morphology**: FAIL — The candidate is a large green body (~19.15-20.6), not a small body — a breakout/continuation candle.
- **Context**: ABSENT — Context chart shows a recovery rally through August (18 → 20.5), not a decline.
- **Final verdict**: NEGATIVE
- **Notes**: None.

## case_0031

- **Morphology**: FAIL — Small red body (~3.15-3.30) with only a shallow lower wick to ~3.05 (ratio well under 2x).
- **Context**: WEAK — The immediate window is chop between ~3.0-3.3 rather than a clear decline; `last_close` sits between sma20 and sma50.
- **Final verdict**: NEGATIVE
- **Notes**: None.

---

## Summary tally

- **POSITIVE**: 8 (case_0001, case_0002, case_0005, case_0011, case_0019, case_0022, case_0025, case_0026)
- **NEGATIVE**: 23
- **AMBIGUOUS-INSUFFICIENT**: 1 (case_0000 — likely data artifact / price discontinuity)

## Summary table

| Case | Morphology | Context | Final Verdict |
|---|---|---|---|
| case_0000 | UNCLEAR | UNCLEAR | AMBIGUOUS-INSUFFICIENT |
| case_0001 | PASS | PRESENT | POSITIVE |
| case_0002 | PASS | PRESENT | POSITIVE |
| case_0003 | UNCLEAR | ABSENT | NEGATIVE |
| case_0004 | FAIL | ABSENT | NEGATIVE |
| case_0005 | PASS | PRESENT | POSITIVE |
| case_0006 | PASS | WEAK | NEGATIVE |
| case_0007 | FAIL | WEAK | NEGATIVE |
| case_0008 | FAIL | ABSENT | NEGATIVE |
| case_0009 | FAIL | PRESENT | NEGATIVE |
| case_0010 | FAIL | ABSENT | NEGATIVE |
| case_0011 | PASS | PRESENT | POSITIVE |
| case_0012 | FAIL | PRESENT | NEGATIVE |
| case_0013 | FAIL | PRESENT | NEGATIVE |
| case_0014 | FAIL | PRESENT | NEGATIVE |
| case_0015 | FAIL | PRESENT | NEGATIVE |
| case_0016 | PASS | WEAK | NEGATIVE |
| case_0017 | FAIL | PRESENT | NEGATIVE |
| case_0018 | FAIL | ABSENT | NEGATIVE |
| case_0019 | PASS | PRESENT | POSITIVE |
| case_0020 | FAIL | WEAK | NEGATIVE |
| case_0021 | FAIL | PRESENT | NEGATIVE |
| case_0022 | PASS | PRESENT | POSITIVE |
| case_0023 | FAIL | WEAK/ABSENT | NEGATIVE |
| case_0024 | PASS | WEAK | NEGATIVE |
| case_0025 | PASS | PRESENT | POSITIVE |
| case_0026 | PASS | PRESENT | POSITIVE |
| case_0027 | FAIL | PRESENT | NEGATIVE |
| case_0028 | FAIL | PRESENT | NEGATIVE |
| case_0029 | FAIL | PRESENT | NEGATIVE |
| case_0030 | FAIL | ABSENT | NEGATIVE |
| case_0031 | FAIL | WEAK | NEGATIVE |
