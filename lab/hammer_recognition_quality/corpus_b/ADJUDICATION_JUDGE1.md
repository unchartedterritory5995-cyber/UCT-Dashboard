# Hammer Recognition — Blind Adjudication (Judge 1)

Each case was judged from the chart image (`charts/case_00NN.png`) plus the packet's neutral price/volume context (SMAs, %-of-52w-high/low, ADR%, volume averages) only. No pattern-detector source code, detector output, or answer-key file was read or consulted. The candle evaluated in each case is the rightmost (most recent) bar on the chart.

---

## case_0000 — NEGATIVE
- **Reason**: The rightmost bar is a large red candle continuing an active decline off a small recent rally high; it does not have hammer anatomy.
- **Decisive evidence**: After a bounce to roughly the mid-800s (in the chart's own price units) in early August, a run of red candles pulls price back down to the final bar, which itself spans nearly its full range as body with only a small hint of a lower shadow.
- **Context issue**: Present — there is a real preceding decline into this bar (pullback off the early-August swing high).
- **Geometry/location issue**: Fails — the real body occupies most of the bar's total range; it is not a small body sitting at the top with a dominant lower wick.

## case_0001 — NEGATIVE
- **Reason**: A grinding, shallow pullback within a longer uptrend; the last candle is a small, unremarkable red bar without a dominant lower wick.
- **Decisive evidence**: Price eases from ~4.3 (mid-August peak) down to the last close (3.745, matching `last_close`) over roughly 8-10 bars of gentle chop, not a sharp sell-off; the final bar's range is modest and body-dominant.
- **Context issue**: Weak — this reads as a slow grind/pullback inside an uptrend rather than a clear sharp decline or swing low.
- **Geometry/location issue**: Fails/unclear — no visibly dominant (≥2x body) lower wick; body takes up most of the bar.

## case_0002 — NEGATIVE
- **Reason**: Rightmost bar is a red candle inside a pullback from a recent high within a longer uptrend; body dominates the range.
- **Decisive evidence**: Price declines from ~296 to 273 (`last_close`=275.17) over the last several bars, each a fairly full-bodied red candle; the final bar shows no long lower shadow.
- **Context issue**: Borderline present (a genuine pullback), but not decisive.
- **Geometry/location issue**: Fails — body fills most of the range; not a small-body/long-lower-wick shape.

## case_0003 — NEGATIVE
- **Reason**: Chart is in a strong uptrend at/near 52-week highs (`pct_of_52w_high`=98.2%); the last bar sits at the top of a sharp rally, which disqualifies it on context alone.
- **Decisive evidence**: Price rallies hard from ~40 to ~45 over the final 8-10 bars; the last candle is red at the very top of the move, with what appears to be more upper wick than lower wick.
- **Context issue**: Absent — no preceding decline/swing low; this is the top of an active uptrend.
- **Geometry/location issue**: Fails — if anything the long wick sits on top (opposite of hammer anatomy), not the bottom.

## case_0004 — NEGATIVE
- **Reason**: Strong uptrend continuing into new highs (`pct_of_52w_high`=98.81%); last bar is a large-bodied green candle, not a hammer.
- **Decisive evidence**: Final bar is a tall green candle pushing to new highs of the move, continuing the rally with a large real body.
- **Context issue**: Absent — no decline, this is uptrend continuation at highs.
- **Geometry/location issue**: Fails — large body, not small/near-top-with-long-wick.

## case_0005 — NEGATIVE
- **Reason**: A real decline is in progress (from ~10 to `last_close`=8.92), but the final candle is a small, unremarkable candle without a clearly dominant lower wick.
- **Decisive evidence**: Last two bars are both small-range red candles continuing the slide; no long lower shadow is visible on the final bar relative to its small body.
- **Context issue**: Present — genuine multi-week decline into this bar.
- **Geometry/location issue**: Fails/unclear — body and total range both small; no visible ≥2x lower-wick dominance.

## case_0006 — NEGATIVE
- **Reason**: After an earlier gap-down, price has been flat-consolidating in a narrow band (~6.5-7) for roughly two months; this is range-bound chop, not a fresh decline into the last bar.
- **Decisive evidence**: Weeks of small-bodied candles oscillating tightly around 6.7-7.0 with no directional move immediately preceding the final bar.
- **Context issue**: Absent — flat consolidation, explicitly excluded by the rubric as noise.
- **Geometry/location issue**: N/A given context failure; final bar itself is tiny/indistinct.

## case_0007 — NEGATIVE
- **Reason**: A decline into the high-30s is followed by a green recovery candle, but the recovery candle's body is too large to read as a hammer.
- **Decisive evidence**: Price falls from ~39 to the high-36/low-37 area, then the final bar is a green candle whose body spans a large portion of the day's range (last_close 37.85 vs sma10 37.143, consistent with an active bounce, not a small-bodied hammer).
- **Context issue**: Present — real preceding decline.
- **Geometry/location issue**: Fails — body is not small relative to total range; reads as a bullish continuation/reversal candle rather than a hammer.

## case_0008 — NEGATIVE
- **Reason**: Strong uptrend at/near 52-week highs (`pct_of_52w_high`=99.85%); last bar is a large green candle continuing the rally.
- **Decisive evidence**: Final candle is tall and green, pushing to fresh highs after a steady multi-month climb.
- **Context issue**: Absent — no decline, uptrend continuation at highs.
- **Geometry/location issue**: Fails — large body, not hammer-shaped.

## case_0009 — NEGATIVE
- **Reason**: Price is chopping in a range (~365-400) well after the sharp decline (from ~525 to the ~340 low) already bottomed and bounced weeks earlier; the last bar sits inside that chop, not a fresh decline.
- **Decisive evidence**: The steep decline ended and reversed in early-mid August; since then price has oscillated in a band, with the final bar a modest red candle mid-range.
- **Context issue**: Weak — consolidation/chop rather than a fresh decline or swing low.
- **Geometry/location issue**: Not decisive given the context failure; final bar shows no standout wick structure.

## case_0010 — NEGATIVE
- **Reason**: Price has been range-bound (~84-92) for roughly two months; the last bar is part of a mild recovery inside that chop, not a hammer at a fresh low.
- **Decisive evidence**: Multiple swings within the same band over recent months; last close 90.01 sits mid-to-upper range with sma10/sma20 below it, consistent with ongoing chop/mild recovery, not a sharp reversal candle.
- **Context issue**: Absent — range-bound chop.
- **Geometry/location issue**: Not decisive; no dominant lower wick visible on the final bar.

## case_0011 — NEGATIVE
- **Reason**: After a decline from ~205 to ~180 (Oct-Nov), price has been chopping (~182-190) for weeks; the last bar sits mid-range in that chop, not at a fresh swing low with hammer anatomy.
- **Decisive evidence**: Last close 184.66 with sma10 (185.07) and sma20 (185.36) essentially flat and close by — no sharp move into this bar.
- **Context issue**: Weak — old decline has already based/chopped for weeks; not a fresh decline into this bar.
- **Geometry/location issue**: Final bar appears as a small, unremarkable red candle; no visible dominant lower wick.

## case_0012 — NEGATIVE
- **Reason**: A genuine multi-week decline (from ~1.55 to `last_close`=1.295) is in progress, but the final candle is a small red body without a clearly dominant lower wick.
- **Decisive evidence**: Steady grind lower over the last 10+ bars with mostly small red candles; the final bar continues that pattern rather than showing a sharp intrabar reversal.
- **Context issue**: Present — real decline into this bar.
- **Geometry/location issue**: Fails/unclear — small body, but no visibly long (≥2x) lower wick.

## case_0013 — NEGATIVE
- **Reason**: A pullback from a local high (~19.7) down to `last_close`=17.37 is underway, but the final candle is a large red body, not a small-bodied hammer.
- **Decisive evidence**: sma10 (18.727) sits well above the last close, confirming a sharp several-day drop; the final bar's body appears to span most of its range.
- **Context issue**: Present — real decline into this bar.
- **Geometry/location issue**: Fails — large red body dominates the bar; no small-body/long-lower-wick shape.

## case_0014 — NEGATIVE
- **Reason**: A real decline (from ~13.5 to `last_close`=8.965) has occurred, and price is now consolidating near the recent low, but the final candle is a small, nondescript candle without a clearly dominant lower wick.
- **Decisive evidence**: The last several bars are small-range candles hovering 8.7-9.5 after the sharp decline; the final bar does not stand out with a long lower shadow.
- **Context issue**: Present (decline into the area) though now consolidating near the low.
- **Geometry/location issue**: Fails/unclear — body and range both small; no visible ≥2x lower wick.

## case_0015 — NEGATIVE
- **Reason**: A sharp, accelerating decline (58 → 52.14) culminates in a large red candle at the very right edge — capitulation-style continuation, not a hammer.
- **Decisive evidence**: The final 2-3 bars drop steeply (56→54→52 area); the last bar is a large-range red candle with the body dominating.
- **Context issue**: Present and strong — clear sharp decline, near 52-week low (`pct_above_52w_low`=2.0%).
- **Geometry/location issue**: Fails — large red body dominates; not small-bodied with a long lower wick.

## case_0016 — NEGATIVE
- **Reason**: Price has been chopping in a ~58-65 range for weeks after an earlier decline from ~69.5; the last bar sits inside that chop.
- **Decisive evidence**: Last close 61.89 with no fresh sharp move into the bar; small red candle amid ongoing consolidation.
- **Context issue**: Absent — range-bound chop, not a fresh decline/swing low.
- **Geometry/location issue**: Not decisive; final bar unremarkable.

## case_0017 — POSITIVE
- **Reason**: A clear, sharp preceding decline lands the final bar with a small real body sitting near the top of its range and a long lower wick — clean hammer anatomy at a fresh low.
- **Decisive evidence**: Price drops from roughly 6.0 (mid-August) down through a run of red candles to the 5.3-5.5 area; the final bar's high sits near ~5.5, its body is compressed into the upper portion of the range (open/close roughly 5.35-5.5), and a long lower wick extends down to roughly 5.1 — a lower wick clearly on the order of 2x the body height, with negligible upper wick. `last_close`=5.37 is consistent with a close near the top of a bar whose low reached toward 5.1.
- **Context issue**: Present and strong — clear multi-week decline, price near 52-week low (`pct_above_52w_low`=6.34%).
- **Geometry/location issue**: Passes — small body near the top of the range, dominant lower wick, negligible upper wick.

## case_0018 — NEGATIVE
- **Reason**: The last bar is several sessions into an already-established recovery rally, not an initial reversal candle sitting at a swing low.
- **Decisive evidence**: A run of consecutive green candles carries price from a ~5.85 low up to `last_close`=6.17; the final bar is just one more green candle in that sequence, without a standout long lower wick.
- **Context issue**: Weak for a hammer specifically — the reversal already happened several bars earlier; this bar is continuation, not the turn.
- **Geometry/location issue**: Not decisive; body appears moderate, no dominant lower wick isolated to this bar.

## case_0019 — NEGATIVE
- **Reason**: Since an earlier gap-down, price has chopped in a ~6.8-7.8 band for weeks; the last bar sits inside that chop.
- **Decisive evidence**: Last close 6.97 with sma10/sma20/sma50 all above it (7.15/7.30/7.83), consistent with continued drift inside a range rather than a sharp new decline.
- **Context issue**: Absent — range-bound chop.
- **Geometry/location issue**: Not decisive; final bar unremarkable.

## case_0020 — NEGATIVE
- **Reason**: A pullback from a recent high (~45.5) to `last_close`=42.75 within a longer uptrend, but the final candle appears to be a moderate red body without standout hammer anatomy.
- **Decisive evidence**: Several fairly uniform red candles step price down from the peak to the last close; the final bar does not show a visibly long lower wick relative to its body.
- **Context issue**: Borderline present (a real pullback) but the anatomy fails.
- **Geometry/location issue**: Fails/unclear — body appears to dominate the bar's range.

## case_0021 — NEGATIVE
- **Reason**: Price spikes to a fresh high (~49.5) then the final bar is a large red reversal candle — a rollover at highs, not a hammer at a low.
- **Decisive evidence**: A sharp run-up to ~49.5 is followed immediately by a big red candle closing at `last_close`=46.14, with the body spanning most of the range.
- **Context issue**: Absent — this occurs at a high after a spike up, not after a decline/at a swing low.
- **Geometry/location issue**: Fails — large red body, not small-bodied with dominant lower wick.

## case_0022 — NEGATIVE
- **Reason**: Price has been chopping (~74-79) for weeks after an earlier decline from ~85 already bottomed near 70 and recovered; the last bar sits inside that chop.
- **Decisive evidence**: Last close 76.88 sits mid-band with no fresh sharp decline immediately preceding it.
- **Context issue**: Absent/weak — range-bound chop, not a fresh decline or clean swing low.
- **Geometry/location issue**: Not decisive; final bar is a small, unremarkable candle.

## case_0023 — NEGATIVE
- **Reason**: Chart is in a long uptrend, currently chopping near its highs (~36-38.5); the last bar sits inside that consolidation, not after a decline.
- **Decisive evidence**: Last close 37.05 within a multi-week sideways band near the highs of the move.
- **Context issue**: Absent — sideways chop near highs within an uptrend, not a decline/swing low.
- **Geometry/location issue**: Not decisive; final bar is a small candle with modest wick, insufficient to override the context failure.

## case_0024 — NEGATIVE
- **Reason**: Price has been range-bound (~45-47.5) for weeks; the last bar sits inside that chop without a fresh sharp decline behind it.
- **Decisive evidence**: Last close 46.47 close to sma10 (46.653)/sma20 (46.6275); final bar's body sits centrally in its range without a dominant lower wick.
- **Context issue**: Absent — range-bound chop.
- **Geometry/location issue**: Fails/unclear — no clear ≥2x lower-wick dominance.

## case_0025 — NEGATIVE
- **Reason**: A sharp decline from a recent spike high (~25.7) into the low-20s is real, but the final candle's body is not small relative to its total range and shows wick on both sides, not a clean hammer.
- **Decisive evidence**: After the spike to ~25.7, a red candle with a long lower wick pulls price down toward ~19; the very last bar recovers to `last_close`=21.31 but its own body appears to occupy a large share of its range with a visible upper wick as well as a lower one — more spinning-top than hammer.
- **Context issue**: Present — genuine sharp decline into the area.
- **Geometry/location issue**: Fails/unclear — body not clearly small, upper wick not negligible.

## case_0026 — NEGATIVE
- **Reason**: A real decline from ~9.9 to ~8.65 is followed by a green recovery candle, but the final bar's body does not look small enough relative to a dominant lower wick.
- **Decisive evidence**: Last close 9.11 with a moderate-sized green body and only a modest lower wick visible.
- **Context issue**: Present — real preceding decline.
- **Geometry/location issue**: Fails/unclear — body not clearly small/dominated by a ≥2x lower wick.

## case_0027 — NEGATIVE
- **Reason**: A long-running downtrend continues grinding lower; the final candle is small but does not show a clearly dominant lower wick.
- **Decisive evidence**: Price eases from ~5.9 to `last_close`=4.58 with mostly small-bodied candles; final bar continues the pattern without a standout wick.
- **Context issue**: Present — ongoing decline, near 52-week low (`pct_above_52w_low`=10.23%).
- **Geometry/location issue**: Fails/unclear — no visible ≥2x lower wick relative to body.

## case_0028 — NEGATIVE
- **Reason**: Price is at/near its 52-week low (`pct_above_52w_low`=1.41%) and the last bar is a green bounce candle, but its body is too large to read as a hammer.
- **Decisive evidence**: Final bar rises noticeably off the recent low with a sizable green body, not a small body with a long lower wick.
- **Context issue**: Present and strong — clear preceding decline, at 52-week low.
- **Geometry/location issue**: Fails — body too large/dominant; reads as a bullish continuation candle, not a hammer.

## case_0029 — NEGATIVE
- **Reason**: After a decline from ~500 to `last_close`=430.14, price is chopping (~430-445); the final bar is a small, unremarkable red candle.
- **Decisive evidence**: No sharp fresh move into the final bar; sits within the recent chop band.
- **Context issue**: Weak — decline has already given way to consolidation.
- **Geometry/location issue**: Not decisive; no standout lower wick.

## case_0030 — NEGATIVE
- **Reason**: The final bar is several sessions into an already-established bounce off the ~18 low, not the initial reversal candle.
- **Decisive evidence**: A run of green candles carries price from ~18 to `last_close`=20.27; the final bar is a larger-bodied green candle continuing that rally.
- **Context issue**: Weak for a hammer specifically — the reversal already occurred bars earlier; this is continuation.
- **Geometry/location issue**: Fails — large green body, not small-bodied hammer shape.

## case_0031 — NEGATIVE
- **Reason**: Price has been range-bound (~3.0-3.6) for weeks; the last bar sits inside that chop.
- **Decisive evidence**: Last close 3.14 within the recent sideways band, no fresh sharp decline immediately preceding.
- **Context issue**: Absent — range-bound chop.
- **Geometry/location issue**: Not decisive; final bar is small and unremarkable.

---

## Summary tally

- **POSITIVE**: 1 (case_0017)
- **NEGATIVE**: 31
- **AMBIGUOUS-INSUFFICIENT**: 0

## Summary table

| Case | Verdict |
|------|---------|
| case_0000 | NEGATIVE |
| case_0001 | NEGATIVE |
| case_0002 | NEGATIVE |
| case_0003 | NEGATIVE |
| case_0004 | NEGATIVE |
| case_0005 | NEGATIVE |
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
| case_0017 | POSITIVE |
| case_0018 | NEGATIVE |
| case_0019 | NEGATIVE |
| case_0020 | NEGATIVE |
| case_0021 | NEGATIVE |
| case_0022 | NEGATIVE |
| case_0023 | NEGATIVE |
| case_0024 | NEGATIVE |
| case_0025 | NEGATIVE |
| case_0026 | NEGATIVE |
| case_0027 | NEGATIVE |
| case_0028 | NEGATIVE |
| case_0029 | NEGATIVE |
| case_0030 | NEGATIVE |
| case_0031 | NEGATIVE |
