# Holdout Adjudication — Currentness Fix (Wave 1)

Rapid visual triage, judged blind from `blind_packets.json` + chart PNGs only.
"Edge" = rightmost bars of the detail chart ("right now").

## FAMILY: shooting_star

## case_0000
- A: NO — rightmost bars are small red/near-doji candles continuing a slide, not a small-body/long-upper-wick shape; nothing shooting-star-shaped sits at the very edge.
- B: NO — structure chart shows an already-established downtrend (72→56) and `pct_above_52w_low`=1.36%; price is at a 52w low, not coming off a recent high.
- C: MARGINAL — last-bar range (~56–58) is roughly at `adr_pct_21d`=2.4%, nothing outsized.
- Verdict: NEGATIVE

## case_0001
- A: WEAK — the reversal candle at the edge is a large-bodied red candle (open~91, close~88.5, wick to 93/86.7); body dominates the range rather than a small body with ≥2x upper wick, so it reads as a bearish reversal candle, not a true shooting star.
- B: YES — strong, clean uptrend into a fresh high (`pct_of_52w_high`=82.85, price far above sma200).
- C: MATERIAL — candle range ~6.3 pts vs `adr_pct_21d`=3.6% is a big, real move.
- Verdict: NEGATIVE (wrong shape despite excellent context)

## case_0002
- A: WEAK/YES — last visible candle shows a small red body near its low with a longer upper wick and little lower wick — a plausible, if not textbook, shooting-star silhouette right at the edge.
- B: YES — local rally off the May/June low into a fresh short-term high right before the candle.
- C: MARGINAL — candle range ≈ `adr_pct_21d`=4.9%, right at the line rather than clearly above it.
- Verdict: AMBIGUOUS-INSUFFICIENT

## case_0003
- A: NO — the rightmost candles are green and still pushing to new highs; no small-body/long-upper-wick candle sits at the edge.
- B: YES — clean uptrend, price near 52w high (90.17%), ascending MA stack.
- C: N/A (shape absent)
- Verdict: NEGATIVE

## case_0004
- A: NO — the reversal at the edge is a violent multi-day crash (huge red bodies, Dec19 candle alone is ~2 pts of real body vs a much smaller wick) — a gap-down/crash pattern, not a small-body/long-wick shooting star.
- B: YES — clear prior rally (12.1→13.5) right before the drop.
- C: MATERIAL (the move is large) but the wrong shape disqualifies it.
- Verdict: NEGATIVE

## case_0005
- A: NO — last candle is a small green body; no shooting-star shape present.
- B: NO — stock is in a confirmed multi-month downtrend, price below all short MAs, not near a high.
- C: N/A
- Verdict: NEGATIVE

## case_0006
- A: WEAK/NO — the closest candidate (a small red doji-ish candle) sits one bar back, not at the very edge, and the rightmost candle is a large green continuation candle.
- B: YES — strong uptrend, price near 52w high (97.56%).
- C: MARGINAL — `adr_pct_21d`=1.79% (low-ADR name); nearby ranges are only ~1x ADR.
- Verdict: NEGATIVE

### shooting_star tally
POSITIVE: 0 · NEGATIVE: 6 · AMBIGUOUS-INSUFFICIENT: 1

---

## FAMILY: hanging_man

## case_0000
- A: YES — rightmost candle is a small green body near the top of its range with a long lower wick reaching well below (body ~10.5–10.7, wick down to ~9.6) and minimal upper wick — a clean, current hanging-man shape.
- B: YES — clear uptrend into the candle (price climbing from ~9.5 to ~10.7 over the prior weeks).
- C: MATERIAL — candle range ≈1.1 pt (~11%) vs `adr_pct_21d`=3.7% is a large, real move.
- Verdict: POSITIVE

## case_0001
- A: NO — rightmost candle is a small red body near its low with only a minor wick; no long-lower-wick/small-body-near-high shape at the edge.
- B: WEAK — broader uptrend exists, but the last several bars are consolidating/declining, not freshly pushing to a new local high.
- C: N/A
- Verdict: NEGATIVE

## case_0002
- A: NO — last candles are small-bodied with minor wicks, no hanging-man geometry.
- B: NO — only a local bounce; 52-week context shows price well below its highs (`pct_of_52w_high`=53.93) and still under the long-term sma200.
- C: N/A
- Verdict: NEGATIVE

## case_0003
- A: NO (stale) — a plausible small-body/long-lower-wick candle (Aug25) appears 2–3 bars back, but price has since made a fresh higher high (Aug26 big green) and pulled back again; the pattern is not live at the current edge.
- B: YES — strong uptrend, near 52w high (92.77%).
- C: N/A — disqualified on freshness.
- Verdict: NEGATIVE

## case_0004
- A: NO — last candle is a small red body with a minor wick; no hanging-man shape.
- B: NO — this is a stock in a downtrend attempting to stabilize/bounce off a low, not an uptrend approaching a high.
- C: N/A
- Verdict: NEGATIVE

## case_0005
- A: NO — the rightmost candle is a large green body continuing the rally, not a small-body reversal candle.
- B: YES — clear short-term uptrend (22→23.5+) into the edge.
- C: N/A — shape absent.
- Verdict: NEGATIVE

## case_0006
- A: WEAK — last candle is red with a modest lower wick (~1.4x body, short of the ≥2x rule of thumb) — a borderline, not clean, hanging-man silhouette.
- B: YES — local bounce/uptrend (21.3→24) heading into the candle.
- C: MARGINAL — range ≈2.5% vs `adr_pct_21d`=2.76%, roughly at ADR.
- Verdict: AMBIGUOUS-INSUFFICIENT

### hanging_man tally
POSITIVE: 1 · NEGATIVE: 5 · AMBIGUOUS-INSUFFICIENT: 1

---

## FAMILY: bearish_engulfing

## case_0000
- A: NO — the rightmost candles are green (rally continuing); the nearest possible pairing (small doji→small red) is too small-bodied to qualify as a real engulfing, and it isn't at the edge anyway.
- B: WEAK — only a local recovery bounce off an Aug low, not a strong uptrend into a high (`pct_of_52w_high`=71.92, price still below sma200).
- C: N/A
- Verdict: NEGATIVE

## case_0001
- A: WEAK/YES — a green candle (~14.05→14.5) is immediately followed by a red candle that opens at/above that close and closes back near 14.1, closely engulfing it — but one additional small green bar follows after, so the pattern is one bar stale rather than sitting at the very last bar.
- B: YES — the green candle marks a fresh local high in the recent recovery rally.
- C: MATERIAL — combined 2-bar range ≈0.4 vs `adr_pct_21d`=2.6% is a real move.
- Verdict: AMBIGUOUS-INSUFFICIENT (real pattern, marginal freshness)

## case_0002
- A: NO (stale) — a clean green→red engulfing pair appears around Jun11–12, but three-plus bars of further chop/decline follow it, so it is well off the current edge.
- B: WEAK — only a local recovery attempt; 52-week context is weak (`pct_of_52w_high`=58.66), not near a high.
- C: N/A — disqualified on freshness.
- Verdict: NEGATIVE

## case_0003
- A: NO — the recent price action is a multi-day grinding decline (several red bodies in a row) rather than a clean 2-candle green→red engulfing at the edge; candidates checked (Dec17-18, Dec22-23) don't show a full engulf.
- B: YES — strong uptrend, price very near 52w high (95.89%), ascending MA stack.
- C: N/A — shape absent.
- Verdict: NEGATIVE (good context, wrong shape)

## case_0004
- A: YES — a small green candle (~11.25→11.35) is engulfed by the next big red candle (~11.35 down to ~11.0); one small red bar follows, giving a one-bar-old but confirmed (follow-through) pattern.
- B: YES — local uptrend (10.5→11.35) into the green candle's high.
- C: MARGINAL — combined range ≈0.35 vs `adr_pct_21d`=4.12%, a bit under 1x ADR.
- Verdict: POSITIVE

## case_0005
- A: WEAK/YES — a small green candle is engulfed by the next red candle two bars from the end, geometrically valid.
- B: NO — this stock is in a severe multi-month downtrend/crash (`pct_of_52w_high`=25.87, `pct_above_52w_low`=5.87, price far below sma200); the "engulfing" sits inside a tiny dead-cat bounce, not a genuine uptrend into a high.
- C: N/A
- Verdict: NEGATIVE (context fails badly)

## case_0006
- A: YES — the last candle (rightmost) is a red body that fully engulfs the prior green candle's body (green ~90.4–91.7; red opens ~91.9, closes ~90.0) — clean and current.
- B: YES — local uptrend/bounce (88.9→91.7) into the green candle's high, though the stock overall is still recovering from a larger prior decline.
- C: MARGINAL — combined range ≈1.9 vs `adr_pct_21d`=3.6%, a bit under 1x ADR.
- Verdict: POSITIVE

### bearish_engulfing tally
POSITIVE: 2 · NEGATIVE: 4 · AMBIGUOUS-INSUFFICIENT: 1

---

## FAMILY: pullback_to_50sma

## case_0000
- A: NO — price has been declining under the 50-MA line for weeks; the last several bars are small candles still below the MA, with no reclaim.
- B: POOR — this reads as a breakdown below the MA, not a shallow controlled pullback-and-bounce.
- Verdict: NEGATIVE

## case_0001
- A: NO — price sits below the declining 50-MA at the edge; a small 2-bar green bounce (Aug21/24) has not yet reclaimed the MA.
- B: POOR — the drop through the MA was sharp (multi-day decline of ~13 pts), not a shallow pullback.
- Verdict: NEGATIVE

## case_0002
- A: NO — an attempted reclaim (mid-May, closing back above the MA for a couple of bars) is rejected by the very last candle, a big red bar that closes back at/under the MA — the reclaim has failed as of the edge.
- B: MARGINAL — the touch/undercut itself was a fast single-day move, not a slow controlled pullback.
- Verdict: NEGATIVE

## case_0003
- A: NO (stale) — the MA was touched once (a sharp one-day spike-down/V-reversal around Jun24) roughly 8-9 bars back; price has since rallied well clear of the MA (~93 vs MA~90.8, +2.4%) and the most recent bars are extended, not freshly off a bounce.
- B: POOR — the touch itself was a violent single-bar spike-and-recover, not a shallow controlled pullback.
- Verdict: NEGATIVE

## case_0004
- A: NO — the most recent bars are a strong breakout far above the MA (price ~29 vs MA ~26.7, roughly +10%); no current touch/reclaim is visible at the edge.
- B: N/A — no current pullback event.
- Verdict: NEGATIVE

## case_0005
- A: WEAK/YES — price undercut the MA around May08 (low ~52.7 vs MA ~54.9), then reclaimed and closed back above it by May11-12, with continued follow-through into the last bar (~57 vs MA~55, now moderately extended).
- B: MARGINAL — the undercut itself was a sharp ~4% one-day plunge against a low-ADR name (`adr_pct_21d`=1.42%, so the drop is ~3x normal daily range) — not a shallow controlled pullback, though the reclaim held and price is confirming higher.
- Verdict: AMBIGUOUS-INSUFFICIENT

## case_0006
- A: NO — the last candle is a large red bar breaking decisively below the MA (close ~43.8-45.1 vs MA ~45.6), the opposite of a reclaim; longer-term price also sits below sma50/sma200.
- B: POOR — this is a breakdown, not a controlled pullback-and-bounce.
- Verdict: NEGATIVE

### pullback_to_50sma tally
POSITIVE: 0 · NEGATIVE: 6 · AMBIGUOUS-INSUFFICIENT: 1

---

## Overall tally (28 cases)
- POSITIVE: 3 (hanging_man case_0000; bearish_engulfing case_0004, case_0006)
- NEGATIVE: 21
- AMBIGUOUS-INSUFFICIENT: 4 (shooting_star case_0002; hanging_man case_0006; bearish_engulfing case_0001; pullback_to_50sma case_0005)
