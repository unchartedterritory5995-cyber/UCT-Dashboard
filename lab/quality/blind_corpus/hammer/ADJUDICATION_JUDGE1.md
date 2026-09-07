# Hammer — Blind Adjudication (Judge 1)

**Method note:** Each case was judged from the chart image (`charts/case_00NN.png`)
plus the packet's neutral price/volume context (SMAs, %-of-52w-high/low, ADR%,
volume averages) only. No pattern-detector source code, detector output, or
`answer_key_ingredients.json` was read or consulted. Each packet's
`provenance.detector_version` block (module/function name + a commit hash) was
visible as routine metadata but carries no verdict, score, or pass/fail signal —
it was not used and did not influence any judgment below. The candle evaluated
in each case is the **rightmost (most recent) bar** on the chart, since that is
the only bar for which "the pattern" is a natural, well-defined question absent
other guidance.

Overall tally: **1 POSITIVE · 1 AMBIGUOUS-INSUFFICIENT · 22 NEGATIVE.**

---

## case_0000 — NEGATIVE
- **Reason:** The last bar is the *opposite* of a hammer — a long **upper** wick with the body sitting low, occurring after a Jan–Feb uptrend, not a downtrend.
- **Decisive evidence:** Final candle spikes from ~95 to a high near 107 then closes back down near ~97; the wick is on top, not the bottom.
- **Context issue:** None — trend is clearly readable, and it's an uptrend/rally into the bar, not a decline.
- **Geometry/location issue:** Wrong wick orientation entirely (shooting-star/inverted shape, not hammer); disqualifying on anatomy alone regardless of context.

## case_0001 — NEGATIVE
- **Reason:** A real downtrend (Feb ~102 → Jun/Jul ~80) is visible, but the recovery off that low is already well underway by the last bar (~88, up ~10% off the low) — the hammer moment, if any, is several bars in the past, not at the chart's current edge.
- **Decisive evidence:** Last bar is an ordinary green candle mid-rally, not a small-bodied/long-lower-wick candle sitting at a fresh low.
- **Context issue:** The qualifying downtrend exists but the candle in question is not the reversal candle — it's already several days into the bounce.
- **Geometry/location issue:** No pronounced lower wick on the terminal candle at this resolution.

## case_0002 — NEGATIVE
- **Reason:** Flat consolidation at/near the 52-week high (pct_of_52w_high 96.6%), essentially no volatility (adr_pct_21d = 0.11%) — no downtrend of any kind precedes the last bar.
- **Decisive evidence:** Price has been pinned between ~50–52 for months with near-doji bars; last bars are tiny and flat.
- **Context issue:** No downtrend/pullback whatsoever — this is a top-of-range plateau.
- **Geometry/location issue:** N/A — context alone disqualifies it.

## case_0003 — NEGATIVE
- **Reason:** Clear, strong uptrend (Jul ~20 → Feb ~32); the final bar is a large bullish continuation candle, not a small-bodied reversal candle.
- **Decisive evidence:** Last candle is a big green body pushing to new highs (~32–33).
- **Context issue:** Uptrend, not downtrend/pullback.
- **Geometry/location issue:** Large real body, no long lower wick — wrong anatomy.

## case_0004 — NEGATIVE
- **Reason:** Only a shallow (~9–10%) pullback within a longer uptrend (120→167 then back to ~150); not a "meaningful" downtrend, and the last candle doesn't show a clearly long lower wick.
- **Decisive evidence:** Last candle is a small green body near ~150–152 with a modest tail, roughly in line with the declining 20/50-day MAs (near ~148–150), but the wick is not visibly ≥2x the body.
- **Context issue:** Borderline — a real pullback exists, but it's shallow relative to the preceding multi-month rally.
- **Geometry/location issue:** Wick length insufficient to confirm hammer anatomy from the chart.

## case_0005 — POSITIVE
- **Reason:** The cleanest hammer candidate in the set. A sharp, unambiguous ~35% decline over 3–4 weeks (mid-Feb ~5.5 → last bar ~3.5) ends on a candle with a small real body near the top of its range and a clearly longer lower wick, minimal upper wick.
- **Decisive evidence:** Last candle: body roughly 3.6–3.7 (red), lower wick extending to roughly 3.42–3.45 (~2–2.5x the body height), essentially flat top (no meaningful upper wick).
- **Context issue:** None — the preceding decline is one of the steepest and cleanest in the whole corpus.
- **Geometry/location issue:** The candle prints a **fresh low**, below anything visible earlier in the 160-bar window (prior low was ~3.85–3.9 back in Jul/Aug) — so there is no evidence this is a retest of an established prior support/swing-low, which is the one rubric element working against it. No next-bar data is available to confirm follow-through.

## case_0006 — NEGATIVE
- **Reason:** A mild pullback within an uptrend (Aug peak ~710 pulling back to ~680–695); not a meaningful downtrend, and the recent red bars look like ordinary bearish bodies rather than hammer shapes.
- **Decisive evidence:** Last 2–3 candles are moderate-sized red bodies, no standout long lower wick.
- **Context issue:** Uptrend still structurally intact; pullback is modest (~4–5%).
- **Geometry/location issue:** No long lower wick visible on the terminal candle.

## case_0007 — NEGATIVE
- **Reason:** A volatile, choppy correction after a blow-off-top-like rally (79 → sharp drop to 63 → bounce to 78 → decline again to ~65–68); no single clean hammer candle, and current price sits in open air with no obvious prior support shelf nearby (the pre-breakout base was well below, around 50–55).
- **Decisive evidence:** Last bar is red, part of a second leg down, without a small-body/long-wick signature.
- **Context issue:** This reads as topping/distribution volatility rather than an orderly downtrend into support.
- **Geometry/location issue:** No visible nearby support level; last candle shape isn't hammer-like.

## case_0008 — NEGATIVE
- **Reason:** Persistent parabolic uptrend for the entire visible window (Jul ~2.8 → Feb ~6.7); no downtrend at any point near the current bar.
- **Decisive evidence:** Last candles are green, pressing to new highs.
- **Context issue:** No downtrend/pullback context at all.
- **Geometry/location issue:** N/A.

## case_0009 — NEGATIVE
- **Reason:** A genuine recent decline exists (~64 → ~53 over several weeks within a broader 50–67 trading range), but the terminal candle is an ordinary small red body without a pronounced long lower wick.
- **Decisive evidence:** Last bar closes near session lows (~53) with only a modest tail.
- **Context issue:** Downtrend is real but the stock is mid-range on the year, not at an obvious floor.
- **Geometry/location issue:** Insufficient wick-to-body ratio to call this a hammer.

## case_0010 — NEGATIVE
- **Reason:** A clear ~30% downtrend from the June peak (~28.5) into the low ~19.5, but the candles grinding into the low are ordinary-sized bodies, not a single decisive long-wick reversal bar.
- **Decisive evidence:** Last several bars show steady, orderly red bodies rather than a hammer spike.
- **Context issue:** None — downtrend context is strong and legitimate.
- **Geometry/location issue:** No standout long lower wick on the final candle.

## case_0011 — NEGATIVE
- **Reason:** Consolidation near multi-month highs after a strong Apr–Aug rally; no downtrend precedes the last bar.
- **Decisive evidence:** Last candles sit flat near ~15.3–15.6, close to the highs.
- **Context issue:** Wrong context — uptrend/consolidation at highs.
- **Geometry/location issue:** N/A.

## case_0012 — NEGATIVE
- **Reason:** A severe prior decline (24 → 14 over ~2 months) is present, but the last several candles are tight, small-bodied consolidation bars near the lows rather than one hammer-shaped reversal bar.
- **Decisive evidence:** Final candle is small and non-descript, part of a flat basing cluster ~14–16.5.
- **Context issue:** None — downtrend context is legitimate and severe.
- **Geometry/location issue:** No standout long lower wick; reads as quiet consolidation, not a hammer signal.

## case_0013 — NEGATIVE
- **Reason:** A sharp decline exists (Aug ~4.4 → ~2.85), but the notable down-day itself has a **large real body** (roughly 3.5→3.4 open/close area with the wick only modestly extending the range further), which disqualifies it as a hammer regardless of the wick. The actual last bar is a small, nondescript consolidation candle near ~3.0.
- **Decisive evidence:** The crash candle's body dominates its range rather than sitting small near the top; not a hammer shape by definition.
- **Context issue:** None — downtrend is real and sharp.
- **Geometry/location issue:** Real body too large on the notable candle; last candle shows no reversal wick.

## case_0014 — NEGATIVE
- **Reason:** A pullback within an uptrend (Aug peak ~26 declining to ~22), but the last bar is still red and part of an ongoing decline, not a reversal candle.
- **Decisive evidence:** Final candle closes near session lows without a long lower wick.
- **Context issue:** Pullback context present, but the decline appears unresolved at the last bar (no bounce yet).
- **Geometry/location issue:** No reversal wick signature.

## case_0015 — NEGATIVE
- **Reason:** The last red candle is a minor pullback within an ongoing, strong uptrend (rally from ~98 to ~120–122), not a candle following a meaningful downtrend.
- **Decisive evidence:** Prior bars are green and climbing steadily into the high; the last bar is a single modest pullback.
- **Context issue:** Wrong context — uptrend continuation, brief profit-taking, not a downtrend/pullback into support.
- **Geometry/location issue:** N/A given the context failure.

## case_0016 — NEGATIVE
- **Reason:** The steep decline (48 → 35.7) is driven by one large bearish marubozu-like candle (open ~43–44, close ~36–37) — a large real body, not a small-bodied hammer — followed by a basing bounce.
- **Decisive evidence:** The notable down-candle's body spans most of its range; no small body sitting near the top with a long wick below.
- **Context issue:** Downtrend context (sharp crash) is real.
- **Geometry/location issue:** Wrong anatomy — large real body disqualifies it; the actual last bar is an ordinary green bounce candle, not itself a hammer.

## case_0017 — NEGATIVE
- **Reason:** A severe late crash (63 → mid-40s) is composed of large bearish real bodies, not a small-bodied hammer.
- **Decisive evidence:** The last two candles are big red bodies with substantial range consumed by the body itself.
- **Context issue:** Downtrend context (crash) is real and clear.
- **Geometry/location issue:** Large real body — fails the "small body" requirement outright.

## case_0018 — NEGATIVE
- **Reason:** Established uptrend for the entire recent chart history (160 ~ up to 195); no downtrend near the last bar.
- **Decisive evidence:** Last candles are green, grinding to new highs.
- **Context issue:** Wrong context — no downtrend/pullback at all.
- **Geometry/location issue:** N/A.

## case_0019 — NEGATIVE
- **Reason:** Current price action is a consolidation near multi-month highs (73–76) after a May–Aug uptrend; no downtrend precedes the last bar.
- **Decisive evidence:** Last candles sit flat/high in the range.
- **Context issue:** Wrong context — uptrend/consolidation at highs, not a downtrend into support.
- **Geometry/location issue:** N/A.

## case_0020 — AMBIGUOUS-INSUFFICIENT
- **Reason:** The downtrend context is about as strong as any case in this corpus (a >75% multi-month decline, ~4.0 → ~0.9), but the current price is compressed into a tiny sliver at the very bottom of the chart's linear y-axis (which still spans up to ~4.0), so individual candle bodies/wicks at the ~0.9–1.0 level cannot be reliably measured from this image.
- **Decisive evidence:** N/A — this is exactly the resolution problem: I can see the price has flattened into a multi-week base near the lows, but cannot confirm whether any specific candle in that base has hammer anatomy (small body, ≥2x lower wick) versus just being a small non-hammer consolidation candle.
- **Context issue:** None — the downtrend is unambiguous and severe.
- **Geometry/location issue:** Chart-resolution/scale limitation — cannot verify body/wick ratio at this price level from the rendered image. Flagging rather than guessing.

## case_0021 — NEGATIVE
- **Reason:** Price is in a broad post-rally trading range (~28–36) chopping sideways since October; the most recent move is a modest pullback (~33→30) within that range, not a clean downtrend, and the last candle is an ordinary-sized red body.
- **Decisive evidence:** Last candle: moderate red body, no pronounced long lower wick.
- **Context issue:** Range-bound chop, not a clear downtrend/pullback into a defined support level.
- **Geometry/location issue:** No standout wick on the terminal candle.

## case_0022 — NEGATIVE
- **Reason:** Persistent, strong uptrend across the entire visible window (~30 → ~80); no downtrend at any point.
- **Decisive evidence:** Last candle is green, near all-time highs on the chart.
- **Context issue:** No downtrend/pullback whatsoever.
- **Geometry/location issue:** N/A.

## case_0023 — NEGATIVE
- **Reason:** A moderate pullback within a longer uptrend (Jan peak ~80 declining to ~70–74); the last candle is an ordinary body without a clearly long lower wick.
- **Decisive evidence:** Recent candles show a grinding pullback toward the rising 50-day MA (~71–72) but no standout hammer shape at the final bar.
- **Context issue:** Pullback context is plausible but modest.
- **Geometry/location issue:** Wick length on the terminal candle insufficient to confirm hammer anatomy.

---

## Summary table

| Case | Verdict |
|---|---|
| case_0000 | NEGATIVE |
| case_0001 | NEGATIVE |
| case_0002 | NEGATIVE |
| case_0003 | NEGATIVE |
| case_0004 | NEGATIVE |
| case_0005 | **POSITIVE** |
| case_0006 | NEGATIVE |
| case_0007 | NEGATIVE |
| case_0008 | NEGATIVE |
| case_0009 | NEGATIVE |
| case_0010 | NEGATIVE |
| case_0011 | NEGATIVE |
| case_0012 | NEGATIVE |
| case_0013 | NEGATIVE |
| case_0014 | NEGATIVE |
| case_0015 | NEGATIVE |
| case_0016 | NEGATIVE |
| case_0017 | NEGATIVE |
| case_0018 | NEGATIVE |
| case_0019 | NEGATIVE |
| case_0020 | AMBIGUOUS-INSUFFICIENT |
| case_0021 | NEGATIVE |
| case_0022 | NEGATIVE |
| case_0023 | NEGATIVE |
