# Adjudication — Dispatch A (shooting_star / hanging_man / bearish_engulfing)

Rapid visual triage, judged purely from the chart PNGs and `neutral_context` numbers in
each family's `blind_packets.json`. No other file in the repo was read. "Rightmost bars"
= present moment.

---

## FAMILY: shooting_star

## case_0000
- A: NO — rightmost bar (last, ~Sep19-22) is a small GREEN candle with short wicks on both
  sides; no small-body/long-upper-wick shape anywhere near the edge.
- B: YES — steady, orderly uptrend May→Sep, close 99.81% of 52w high, textbook "near a
  high" context.
- C: N/A (no shape to size) — for reference, ADR is only 0.133%, an extremely low-vol
  name (~$0.11/day normal range), so even a nominal wick here would barely register.
- Verdict: NEGATIVE — pattern absent at the fresh edge.

## case_0001
- A: NO — rightmost candle is a large-bodied GREEN breakout candle (body ~2.92→3.03,
  modest wicks both sides) — a bullish continuation bar, not a small-body/long-upper-wick
  shape.
- B: WEAK — price is recovering hard off a base but is still only 79.95% of the 52w high
  (well off the high), so "near a high" is a stretch even though momentum is strongly up.
- C: N/A — no candidate shape to size.
- Verdict: NEGATIVE — pattern absent; last bar is a strong bullish breakout, opposite of
  a topping signal.

## case_0002
- A: NO — the rightmost bar is a huge RED candle whose body (≈3.67→4.68) is almost the
  entire day's range with only small wicks on each end (near-marubozu) — this is a big
  bearish body candle, not a small-body/long-upper-wick shooting star.
- B: YES — sharp multi-day rally into a fresh local high immediately precedes this bar.
- C: MATERIAL — range vastly exceeds ADR (8.949%); the candle alone is a ~20%+ move.
- Verdict: NEGATIVE — geometry is wrong (large-body reversal candle, not a shooting star)
  even though context/materiality would have supported a real pattern.

## case_0003
- A: NO — rightmost candle (red, body ≈26.55→27.30) has a long-ish upper wick (~27.9) but
  also a substantial lower wick (~26.05) and a large body — body is not "small," and the
  lower wick is not "little/none," so it fails the shape test.
- B: YES — comes right off a local top near 28.7 (Jun26-30) after a strong run from ~20.
- C: MATERIAL — full range ≈$1.85 vs ADR-implied ≈$1.73 (6.525%) — in line with/slightly
  above a normal day, i.e., a real move, just not shaped like a shooting star.
- Verdict: NEGATIVE — wrong candle shape at the edge.

## case_0004
- A: NO — rightmost candle is GREEN, closing at/near its high with only a small upper
  wick — the opposite of the required small-body-near-the-low/long-upper-wick shape.
- B: YES — close is 99.61% of 52w high, consistent with sitting near the top of its range.
- C: NOT MATERIAL — ADR is a minuscule 0.088% (~$0.07/day); this whole 16-bar window
  barely spans $0.20, so even a genuine shape here would be noise for this name.
- Verdict: NEGATIVE — no shape, and would be immaterial even if one existed.

## case_0005
- A: NO — rightmost candle is RED with a small body near the TOP of its range and a long
  LOWER wick (body ≈12.45-12.53, wick down to ≈12.24) — this is the mirror-image shape
  (hammer/hanging-man-like), not a shooting star.
- B: WEAK — this is a bounce off a multi-month downtrend low, not a move near a
  meaningful high (still only 76.87% of 52w high, below sma200).
- C: MARGINAL — lower wick ≈$0.29 vs ADR-implied ≈$0.29 (2.289%) — about one ADR, but in
  the wrong direction for this pattern.
- Verdict: NEGATIVE — shape is inverted relative to the definition.

## case_0006
- A: WEAK — a genuine shooting-star-shaped candle (small body ~3.95-4.08, long upper wick
  to ~4.57, negligible lower wick) DOES appear, but it is one bar back from the true
  rightmost edge; the actual last bar is a red follow-through candle already confirming
  the reversal (i.e., the signal already played out, price already fell before "now").
- B: YES — sits right after a sharp ~30% rally (Apr23→Apr27) into a fresh local high.
- C: MATERIAL — the upper wick alone (~$0.49) exceeds a full ADR-implied day (9.182% ×
  ~$4 ≈ $0.37).
- Verdict: NEGATIVE — real pattern, but stale by one bar with confirmed follow-through;
  not "live" at the present moment as instructed.

### shooting_star tally
POSITIVE: 0 · NEGATIVE: 7 · AMBIGUOUS-INSUFFICIENT: 0

---

## FAMILY: hanging_man

## case_0000
- A: NO — rightmost candle is RED with a thin body near the top (~33.6-33.65) but the
  wick runs UP to ~33.9, not down — that is a long upper wick with little lower wick,
  which is the opposite of hanging-man geometry (needs long LOWER wick).
- B: YES — comes after a genuine short-term rally (Apr07→Apr29, ~31.5→33.6) even though
  the stock is still well below its 52w high (50.84%) and its sma200 (42.67) — a real
  local-high setup, just not the shape required.
- C: N/A — shape doesn't match, so materiality is moot.
- Verdict: NEGATIVE — wick is on the wrong side.

## case_0001
- A: NO — rightmost candle is a small, roughly symmetric doji/cross (body ~107.35-107.45,
  small wicks both up and down) — no dominant long lower wick.
- B: WEAK — close is 98.54% of 52w high, technically near a high, but the immediate
  run-up is shallow/choppy rather than a clean thrust.
- C: NOT MATERIAL — ADR is only 0.252% (~$0.27/day) on a $107 stock; the wicks present
  are within normal daily noise for this name.
- Verdict: NEGATIVE — no shape, and would be immaterial regardless.

## case_0002
- A: NO — rightmost candle is a large-bodied GREEN continuation candle (body ≈57.7→58.6)
  making a new high with only a small lower wick — body dominates, disqualifying it as a
  "small real body" pattern.
- B: YES — strong sustained uptrend (~42→58.6 since May), essentially at the 52w high
  (99.74%).
- C: N/A — no small-body shape to size.
- Verdict: NEGATIVE — bullish continuation bar, not hanging man.

## case_0003
- A: NO — rightmost candle (red, body ≈92.0-92.9) has its long wick pointing UP to ~94.5
  with only a moderate lower wick to ~91.5 — again the wick is on the wrong side for a
  hanging man (reads more shooting-star-shaped).
- B: YES — close is 94.96% of 52w high after a strong multi-week recovery rally.
- C: MATERIAL — the upper wick alone (~$1.6) is well above ADR-implied (~$3.7 for full
  day at 4.032%, but the shape/direction is wrong regardless).
- Verdict: NEGATIVE — wick asymmetry is inverted.

## case_0004
- A: NO — rightmost candle is a small GREEN body (~118.65-118.9) with modest, fairly
  balanced wicks on both sides — no long lower wick standing out.
- B: WEAK — 91.44% of 52w high, and price sits below sma50/sma200 after a large pullback
  from ~130; the immediate few days show a modest bounce, not a strong fresh push to a
  new high.
- C: NOT MATERIAL — wicks are within ADR-implied normal range (1.271%, ~$1.5/day); nothing
  stands out as an unusual move.
- Verdict: NEGATIVE — no qualifying shape.

## case_0005
- A: NO — rightmost candle is a LARGE green body (≈82.6→85.7) with a genuine long lower
  wick (down to ≈80.2) and small upper wick — the wick orientation is hanging-man-like,
  but the real body is far too large (body ≫ 2× lower wick, when the definition wants a
  SMALL body with the lower wick ≥2x the body) and the candle reads as a strong bullish
  reversal-and-rally bar, not a topping warning.
- B: YES — parabolic rally into a fresh 52w-high close (99.84%), strong recent-uptrend
  context.
- C: MATERIAL — full range ≈$5.7 vs ADR-implied ≈$3.3 (3.823%), a genuinely oversized
  day — but in support of a large bullish (not small-body bearish-warning) candle.
- Verdict: NEGATIVE — body-to-wick ratio fails the definition; directionally this candle
  reads bullish, not as a bearish warning.

## case_0006
- A: NO — rightmost candle is a tiny green doji/cross (~95.3-95.6) with small, roughly
  balanced wicks — no long lower wick.
- B: NO — this stock is in a clear, sustained downtrend (close below sma10/20/50/200,
  pct_above_52w_low only 2.35% — i.e., sitting right at its 52-week LOW). This is the
  opposite of the "after an uptrend, near a high" context the pattern requires.
- C: N/A — no shape, and wrong context regardless.
- Verdict: NEGATIVE — both shape and context fail; this would be a clear-cut false
  positive if it had been flagged (near a 52w low in a downtrend, not near a high).

### hanging_man tally
POSITIVE: 0 · NEGATIVE: 7 · AMBIGUOUS-INSUFFICIENT: 0

---

## FAMILY: bearish_engulfing

## case_0000
- A: YES — last two bars are a genuine small GREEN candle (open≈13.53, close≈13.60)
  immediately followed by a RED candle (open≈13.68, close≈13.50) whose body fully
  contains the prior body on both sides (13.68>13.60 and 13.50<13.53, the latter by only
  ~$0.03) — a real, fresh engulfing right at the edge.
- B: WEAK/YES — not near the 52w high (80.42%), but there is a genuine short local
  rally (~13.1→13.7 over the prior week) into a local top immediately before this bar.
- C: MARGINAL — full range ≈$0.32 / body ≈$0.18 vs ADR-implied ≈$0.59 (4.34%) — real but
  sub-average-day price action, not a standout move.
- Verdict: POSITIVE — geometry, freshness, and a (modest) prior uptrend are all present;
  materiality is the only soft spot.

## case_0001
- A: NO — the big green candle (body ≈13.4→14.35) is followed by a red candle whose body
  (≈14.0→14.28) sits INSIDE the green body (a bearish harami, not an engulfing), and the
  actual rightmost candle is red-after-red (no green immediately precedes it).
- B: YES — strong sustained uptrend, 94.16% of 52w high.
- C: N/A — no qualifying two-candle shape at the edge.
- Verdict: NEGATIVE — reversal candle is contained inside the prior body, not engulfing
  it; and the very last candle isn't preceded by a green candle at all.

## case_0002
- A: NO — same "harami not engulfing" shape: the big green (≈43.35→44.85) is followed by
  a red body (≈44.15→44.5) fully contained inside it, then another red — no green
  immediately precedes the final bar.
- B: YES — strong uptrend, close 95.26% of 52w high.
- C: N/A — no qualifying shape.
- Verdict: NEGATIVE — pattern geometry not satisfied at the edge.

## case_0003
- A: WEAK/NO — near miss: green body (11.60→11.90) is followed by red (open 11.90, close
  ≈11.70); red's open does clear the green's close, but red's close (11.70) sits ABOVE
  the green's open (11.60) by ~$0.10, so the body is not fully engulfed on the low side.
- B: YES — sharp V-shaped recovery rally (~10→12) into a fresh local high.
- C: MARGINAL — range ≈$0.35 / body ≈$0.20 vs ADR-implied ≈$0.44 (3.771%).
- Verdict: NEGATIVE — fails the strict full-engulfment test, though it is a close,
  directionally-real near-miss.

## case_0004
- A: NO — the rightmost (most current) candle is a large GREEN bar (≈12.95→13.30) making
  a new local high — not a bearish candle at all, so no bearish engulfing can be present
  at the edge.
- B: YES — comes off a genuine V-recovery rally, but irrelevant since A fails outright.
- C: N/A.
- Verdict: NEGATIVE — last bar is bullish, not bearish.

## case_0005
- A: NO — a big red candle (open≈34.6, close≈33.3) follows a large green candle
  (open≈34.25, close≈35.05), but the red's open (34.6) is BELOW the green's close
  (35.05), so the top of the green body is not engulfed — fails the strict definition
  despite being a dramatic, fast reversal.
- B: YES — two huge green candles rallied price from ~32.65 to ~35.05 over two days
  immediately before this bar — clear fresh-uptrend context.
- C: MATERIAL — red candle's range (~$1.55) is well above ADR-implied (~$1.04, 3.133%) —
  a genuinely oversized, meaningful reversal day.
- Verdict: NEGATIVE — fails strict engulfment (open side) despite being a materially
  significant, directionally-correct reversal candle; a looser detector would likely
  fire here even though this one is marked by the book.

## case_0006
- A: NO — rightmost candle is a small GREEN candle, not red, so no bearish engulfing can
  close out the sequence at the edge.
- B: NO — this stock is in a clear, sustained downtrend (close below sma10/20/50/200,
  only 13.21% above its 52w low) — wrong context entirely, opposite of "after a recent
  upward move."
- C: N/A.
- Verdict: NEGATIVE — both shape and context fail; near a 52-week low in a downtrend, not
  a bearish-reversal-worthy setup.

### bearish_engulfing tally
POSITIVE: 1 · NEGATIVE: 6 · AMBIGUOUS-INSUFFICIENT: 0

---

## Overall

| Family | POSITIVE | NEGATIVE | AMBIGUOUS |
|---|---|---|---|
| shooting_star | 0 | 7 | 0 |
| hanging_man | 0 | 7 | 0 |
| bearish_engulfing | 1 | 6 | 0 |
| **Total** | **1** | **20** | **0** |

Recurring failure modes observed across all three families:
1. **Wrong-side wick / inverted shape** — several shooting_star and hanging_man
   candidates had the long wick on the opposite side from what the family needs
   (shooting_star case_0005; hanging_man case_0000, case_0003), or a body far too large
   relative to the wick to qualify as "small" (hanging_man case_0002, case_0005).
2. **One-bar staleness** — shooting_star case_0006 had a textbook shape, but it sat one
   bar behind the literal rightmost edge, with the true last bar already showing
   bearish follow-through (the pattern had already resolved, not "live now").
3. **Harami-instead-of-engulfing** — bearish_engulfing case_0001 and case_0002 both show
   a big up-candle followed by a smaller down-candle CONTAINED inside it (inside bar),
   which is a visually similar but geometrically opposite shape to an engulfing pattern.
4. **Near-miss on strict open/close containment** — bearish_engulfing case_0003 and
   case_0005 are close, directionally-correct reversal candles that fail the strict
   "opens above prior close AND closes below prior open" test by a small margin.
5. **Wrong context (downtrend, near 52w low)** — hanging_man case_0006 and
   bearish_engulfing case_0006 both had the shape absent AND sat near a 52-week low in a
   clear downtrend — the opposite of "after an uptrend, near a high."
