# Bull Flag — Blind Adjudication (Judge 1)

**Method note:** Each case was judged from the chart image (`charts/case_00NN.png`) plus the packet's `neutral_context` (last close, %-of-52w-high/low, SMA10/20/50, ADR%). No pattern-detection source code, detector output, or answer-key file was consulted. The packet's `provenance.detector_version` field (a module/function/commit path) was visible in the raw JSON while reading case data — it is metadata identifying which code *would* run, not a verdict or score, and it was not used to infer whether anything "fired." No score or verdict field was encountered anywhere in the corpus. Verdicts below are independent technical-analysis judgments only.

Rubric applied: (1) sharp/vertical prior pole, (2) tight, shallow, orderly consolidation (not a deep/chaotic retracement, not a full reversal), (3) flag short relative to the pole, (4) volume ideally elevated on the pole / contracting in the flag, (5) explicitly NOT random chop with no pole, NOT a deep disorderly pullback, NOT a slow grind with no pole.

---

## case_0000 — POSITIVE
**Reason:** A long grinding advance (Jan–Aug) accelerates sharply in the final weeks into a fresh high near 23, then price consolidates in a tight band (~21.5–23) for the last ~8–10 bars, staying above all three moving averages and near the 52-week high (95.3%).
**Decisive evidence:** Sharp multi-week thrust from ~17 (Aug 10) to ~23, followed by a tight, mildly downward-drifting consolidation of roughly 8–10 bars that holds well above the rising 10/20/50-day averages (close 22.09 vs sma10 22.24, sma20 21.34, sma50 19.12).
**Context issue:** None — full 160-bar history shown, trend context is clear.
**Geometry issue:** None significant; the flag channel is a bit wide-ish per candle but stays shallow and orderly relative to the size of the pole.

## case_0001 — POSITIVE
**Reason:** After a base near 160 (Oct), price grinds up, spikes to a fresh swing high near 199, and then settles into a tight ~193–197 range for the final ~10 bars — a classic shallow pullback that holds right at the 10-day average.
**Decisive evidence:** Pole from ~183 (early Feb) to a 199 high, then a tight sideways band for the last two weeks; close (194.97) sits almost exactly on sma10 (195.14) and above sma20 (193.36), consistent with a shallow, orderly pause rather than a reversal.
**Context issue:** None.
**Geometry issue:** The very top of the pole includes one spike/wick bar (long upper wick near the 199 high) rather than a clean close at the high — minor, doesn't break the pattern.

## case_0002 — NEGATIVE
**Reason:** The visible history is dominated by a large decline (35→18) followed by a long, choppy, rounded bottoming process (Mar–Aug). The recent uptick at the right edge follows a base, not a sharp bullish pole — there is no fresh vertical advance immediately preceding the current consolidation.
**Decisive evidence:** Price is only 57.5% of its 52-week high; the "flag-like" basing in Jul–Aug sits directly below a large downtrend, not below a sharp up-move — this is a bottoming base, not a bull-flag continuation.
**Context issue:** None.
**Geometry issue:** What consolidation exists is rounded/choppy rather than a tight parallel channel, and it isn't preceded by momentum.

## case_0003 — NEGATIVE
**Reason:** Price topped out near 8 in June, declined sharply to ~4 by August, and the right-edge action is a small bounce off that low, not a continuation flag after an advance.
**Decisive evidence:** Only 62.7% of 52-week high, no sharp pole precedes the current position — the dominant recent move is a decline, and current price sits just above sma20/sma50, consistent with an early bounce, not a flag.
**Context issue:** None.
**Geometry issue:** N/A — no candidate flag geometry exists at the relevant location.

## case_0004 — POSITIVE
**Reason:** A very low-volatility grinder (ADR 1.18%) accelerates from ~13.0 to a fresh high of ~13.85, then pulls back modestly to close at 13.55 — below the 10- and 20-day averages but still above the 50-day and near the 52-week high (97.3%).
**Decisive evidence:** Shallow pullback (~2%, roughly two ADRs) right under the short-term averages while remaining above the 50-day trend and near yearly highs — the classic quantitative signature of a shallow flag pause, scaled to this stock's low volatility.
**Context issue:** Very low ADR makes the "pole" visually unimpressive; the move is modest in absolute terms even though it is meaningful relative to this stock's own volatility.
**Geometry issue:** The consolidation is short (only a handful of bars) — plausible but data is thin.

## case_0005 — NEGATIVE
**Reason:** Long decline from ~12 to below 8, a brief rally to ~10.8 in May–June that fully round-trips back down, and the stock is sitting just 9% above its 52-week low at the right edge.
**Decisive evidence:** The one rally on the chart (May) reversed completely rather than consolidating in a shallow channel — a full round-trip, not a flag. Current price is a weak bounce near the yearly low, with close above sma10 but below sma20/sma50.
**Context issue:** None.
**Geometry issue:** The "flag" candidate (post-spike pullback in May–June) retraces essentially 100% of the pole — disqualifying depth.

## case_0006 — NEGATIVE
**Reason:** A dramatic pole from ~1.0 to ~6.3 (Jul–Oct) is followed by a deep, prolonged decline back to ~2.0–2.8 that lasts months — a blow-off top and reversal, not a flag.
**Decisive evidence:** Price is only 32.6% of its 52-week high and sits well below its 50-day average (2.15 vs 2.45) — the post-pole move retraced the large majority of the advance over an extended period, the opposite of a short, shallow consolidation.
**Context issue:** None.
**Geometry issue:** Retracement depth (~60%+ of the pole) and duration (months, not days/weeks) both disqualify this as a flag.

## case_0007 — POSITIVE
**Reason:** A strong, sustained pole from ~600 to a high near 770 is followed by a tight ~735–770 consolidation over the final ~2 weeks, holding near the 52-week high (94.1%).
**Decisive evidence:** Close (742.83) sits just under sma10 (759.83) but above sma20 (738.18) and well above sma50 (662.17) — a shallow pullback signature right after a steep, sustained thrust, textbook flag geometry.
**Context issue:** None.
**Geometry issue:** None significant — the consolidation is tight and roughly parallel.

## case_0008 — NEGATIVE
**Reason:** A single sharp spike to a high of ~110 is followed by a deep, choppy, multi-week re-basing (110 down to ~90, then chopping 95–105) before the current bounce back near old highs — too deep and too disorderly to call a tight flag.
**Decisive evidence:** The pullback from the spike high retraces roughly 18%, spans several weeks with large mixed-direction candles (not an orderly narrow channel), which fails both the "shallow" and "orderly" flag criteria even though the stock is currently strong (close well above all three MAs).
**Context issue:** None.
**Geometry issue:** Consolidation is wide-ranging and choppy rather than tight/parallel; duration is comparable to or longer than the pole itself.

## case_0009 — NEGATIVE
**Reason:** An eight-month steady grind from ~55 to ~80 with no distinct sharp acceleration-then-pause near the right edge; price is still extending upward into the final bars rather than consolidating.
**Decisive evidence:** Close (76.3) sits well above sma10/20/50 with no intervening pullback of adequate length to qualify as a flag — this is a still-running advance, not a completed pole+flag.
**Context issue:** The stock is only 68.6% of its 52-week high, implying an even higher high exists earlier/outside the visible 160-bar window — full yearly context is not shown.
**Geometry issue:** No consolidation channel is present; at most 1–2 bars of pause at the very end, insufficient to assess.

## case_0010 — NEGATIVE
**Reason:** A choppy, multi-swing topping pattern (two comparable peaks near 37–40 in Feb–Apr) gives way to a broad decline through the summer, and the chart ends in an active downtrend, not a bullish continuation.
**Decisive evidence:** Close (29.81) sits below sma10, sma20, and sma50 (breakdown configuration) — the opposite of the "near highs, shallow pullback" signature a flag requires.
**Context issue:** None.
**Geometry issue:** N/A — the recent structure is a decline, not a consolidation after an advance.

## case_0011 — NEGATIVE
**Reason:** Extremely choppy, whipsaw price action with several large round-trip swings (7→14→7.5→11→7.8→13.5→8.5); the most recent swing is a sharp decline from a February peak, not a shallow flag.
**Decisive evidence:** Close (9.12) is below sma20 and sma50, confirming the latest leg is a decline following a reversal, not a continuation pause.
**Context issue:** None.
**Geometry issue:** N/A — no orderly consolidation is present near the current position.

## case_0012 — AMBIGUOUS-INSUFFICIENT
**Reason:** A genuine pole is visible (~22.5 to a ~29.5 high in Nov), but the pullback into the current close is deeper than a classic shallow flag — roughly half of the pole's gain has been given back.
**Decisive evidence:** Close (25.72) is ~8.7% below sma10 (28.18) and ~9.3% below sma20 (28.35), while sitting just above sma50 (25.57) — consistent with a retracement near/at the boundary of "shallow" vs. "deep" (≈50%+ of the pole erased). Chart resolution at the far-right edge doesn't let me confirm whether this settles into an orderly tight range or continues deeper.
**Context issue:** The image resolution at the extreme right edge makes it hard to count exact bars/tightness of the most recent pullback with confidence.
**Geometry issue:** Retracement depth is borderline (~54% of the pole) — arguably too deep for a "shallow" flag, but not so deep as to call it a clean reversal either.

## case_0013 — NEGATIVE
**Reason:** A long decline from ~16 (Jan) to ~14.5 with a subsequent multi-month rangebound chop; no sharp pole precedes the current flat/declining position.
**Decisive evidence:** Close sits below sma10/20/50 in a very low-ADR (0.94%) name with essentially no directional momentum — a grind/base, not a pole.
**Context issue:** None.
**Geometry issue:** N/A — no pole exists to anchor a flag read.

## case_0014 — NEGATIVE
**Reason:** After choppy action in the 2.5–5 range, an extreme, anomalous single spike (price jumps from ~3.5 to ~8.8 then craters back to ~5.5, accompanied by an outsized one-bar volume spike) is followed by a sustained decline to ~2 by the end of the chart.
**Decisive evidence:** Close (2.01) is well below all three moving averages (sma50 3.25) and only 22.6% of the 52-week high — the dominant recent trend is down, and the isolated spike round-trips almost entirely within a couple of bars, which reads as a data anomaly rather than a tradable pole.
**Context issue:** The single extreme spike bar with an outsized volume print looks like a possible data/corporate-action artifact rather than organic price action — flagging this as a data-quality concern that undermines confident reading of this chart.
**Geometry issue:** No orderly flag is present; the chart ends in an active downtrend.

## case_0015 — POSITIVE
**Reason:** After a sharp decline (100→55) and basing, a strong rally (58→75, including a gap-up day) is followed by a pullback to ~69 that holds above the 50-day average and retraces only about a third of the advance.
**Decisive evidence:** Close (69.4) is below sma10/sma20 (70.6/71.93) but comfortably above sma50 (64.80) — a moderate, not-too-deep retracement (~33% of the pole) consistent with a flag, even though the pullback itself is a bit choppy rather than perfectly tight.
**Context issue:** None.
**Geometry issue:** The consolidation channel is somewhat wide/choppy rather than a crisp parallel channel — a mild ding against "orderly," but not disqualifying.

## case_0016 — POSITIVE
**Reason:** A long uptrend accelerates sharply in mid-February from ~10.3 to ~13.7, then price holds in a tight ~13.2–13.8 band for the final several bars, right at the 52-week high (97.9%).
**Decisive evidence:** Very tight, narrow-range consolidation immediately after the steepest leg of the whole chart; close remains well above sma10/20/50 (13.56 vs 12.49/11.53/10.87), which is expected immediately after a steep pole (the short averages haven't caught up yet) rather than evidence against a flag.
**Context issue:** None.
**Geometry issue:** None significant — this is one of the cleanest, tightest consolidations in the set.

## case_0017 — AMBIGUOUS-INSUFFICIENT
**Reason:** A sharp pole is clearly present (~26 to a ~31 high after months of sideways chop), but only a single sharp down-bar (30.7→28.8) is visible at the very end of the chart before the series ends — not enough bars to judge whether an orderly flag forms or whether this is the start of a deeper reversal.
**Decisive evidence:** Close (29.57) sits almost exactly at sma10 (29.67) and above sma20 (28.96) — consistent with either an early, still-forming shallow flag or a one-day fakeout; the chart simply ends too soon after the pole to tell.
**Context issue:** The chart's last bar cuts off right after the first pullback candle — no multi-bar consolidation is visible yet.
**Geometry issue:** Cannot assess tightness/parallel structure because there is essentially only one post-peak bar to look at.

## case_0018 — NEGATIVE
**Reason:** Choppy multi-swing action across the year with no clean recent pole; the chart ends in an active decline (from ~6 down to ~5.2).
**Decisive evidence:** Close (5.18) sits below sma10/20/50, confirming a downtrend into the most recent bars — the opposite of a flag setup.
**Context issue:** None.
**Geometry issue:** N/A — no bullish pole precedes the current decline.

## case_0019 — AMBIGUOUS-INSUFFICIENT
**Reason:** A clear pole is present (~5.5 to ~6.5 high in the final weeks), but only 2–3 bars of mild pullback are visible before the chart ends — too little to confirm an orderly, sufficiently tight flag has formed.
**Decisive evidence:** Close (6.11) remains ABOVE sma10, sma20, and sma50 (6.036/5.855/5.653) — i.e., price hasn't meaningfully broken back below its own short-term trend yet, which is more consistent with an advance still in progress than an established consolidation.
**Context issue:** Chart ends right at/near the recent high, so the flag (if one is forming) is not yet visible in enough detail.
**Geometry issue:** Cannot assess channel shape — insufficient post-pole bars.

## case_0020 — POSITIVE
**Reason:** Within a longer multi-month recovery (28→40), the most proximate leg (~35 to a ~39.7 high in August) is followed by a shallow pullback to 37.32 over the final few bars.
**Decisive evidence:** Close (37.32) sits just below sma10 (37.58) and above sma20 (36.25), a shallow retracement (~34% of the recent leg) consistent with a flag; sma50 (33.37) confirms the broader trend remains solidly intact underneath.
**Context issue:** The broader chart (Jan–Jul) shows several earlier legs and consolidations of similar shape — this may be one of a series of continuation pauses within a longer recovery rather than an isolated, uniquely clean setup; worth reading in that multi-leg context.
**Geometry issue:** The pullback is short (only a few bars) — plausible but thin evidence for tightness/duration.

## case_0021 — NEGATIVE
**Reason:** A choppy year with two comparable rally/decline cycles (peaks near 174 and 170) ends in a sharp breakdown over the final bars (from the 170s down to ~150).
**Decisive evidence:** Close (154.42) is below sma10, sma20, and sma50 (156.96/160.97/164.55) — a clear breakdown configuration, the opposite of a bullish continuation flag.
**Context issue:** None.
**Geometry issue:** N/A — the recent structure is a decline, not a consolidation.

## case_0022 — NEGATIVE
**Reason:** An extremely low-volatility name (ADR 0.82%) that rounds over (14.3→15.6→14.3) and grinds back up to ~14.8–14.9 with no distinguishable sharp pole anywhere in the visible window.
**Decisive evidence:** Close, sma10, sma20, and sma50 are all clustered within a few cents of each other (14.6–14.82) — essentially flat, no momentum thrust to anchor a flag read.
**Context issue:** None.
**Geometry issue:** N/A — no pole exists.

## case_0023 — POSITIVE
**Reason:** After a multi-month base (32–40), a strong, sustained pole runs from ~38 to a high near 52, and the final ~8–10 bars consolidate tightly in the 50–52.5 range, right at the 52-week high (98.0%).
**Decisive evidence:** Close (51.34) sits just above sma10 (51.18) and sma20 (50.63), and well above sma50 (46.28) — a tight, shallow pause immediately after the steepest part of the whole chart's advance.
**Context issue:** None.
**Geometry issue:** None significant — clean, tight, high-level consolidation.

---

## Summary counts
- POSITIVE: 8 — case_0000, case_0001, case_0004, case_0007, case_0015, case_0016, case_0020, case_0023
- NEGATIVE: 13 — case_0002, case_0003, case_0005, case_0006, case_0008, case_0009, case_0010, case_0011, case_0013, case_0014, case_0018, case_0021, case_0022
- AMBIGUOUS-INSUFFICIENT: 3 — case_0012, case_0017, case_0019
