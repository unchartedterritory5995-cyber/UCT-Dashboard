# Candlestick Pair Triage — bullish_engulfing vs three_white_soldiers

Rapid, lightweight visual triage. Each case judged independently against its own
family rubric using the detail (last ~16 bars, no MAs) + structure (last ~90
bars, with 10/20/50 SMA) chart pair.

---

## FAMILY 1: bullish_engulfing

## case_0000
A: NO — the last two candles at the right edge are green (Apr27) then RED (Apr28, rightmost). That's the reverse of the required red→green sequence; there is no engulfing shape at the edge at all.
B: WEAK — a real decline runs Apr07 (~33) down to the ~26 base, but since A fails outright the context question is moot.
C: **NEGATIVE**

## case_0001
A: WEAK — a genuine red (Jan12) → green (Jan14) engulfing pair exists, but it sits one bar back from the true right edge; the very last candle is a second, trailing green bar rather than the engulfing candle itself.
B: YES — detail chart shows a real pullback (Dec26–Jan02, ~31→~29.8) before the reversal, and structure confirms an established uptrend resuming.
C: **AMBIGUOUS-INSUFFICIENT** (off-by-one alignment to the edge)

## case_0002
A: NO — the last candle (rightmost) is a red, upper-wicked bar sitting after a massive one/two-day green gap-up spike (95→124). Wrong polarity at the edge; this reads as post-spike distribution/rejection, not an engulfing reversal.
B: N/A — moot given A.
C: **NEGATIVE**

## case_0003
A: NO — the final ~6 candles (Apr21–Apr28) are ALL red in a clean, uninterrupted decline; no green candle appears anywhere near the edge.
B: N/A.
C: **NEGATIVE**

## case_0004
A: NO — second-to-last candle is red, but the actual last candle is a doji/near-flat cross, not a clearly-bigger green body. No real engulfing.
B: WEAK — this is a penny stock that crashed from ~$7-9 to ~$1.7-2 months earlier and has been base-building sideways for 3+ months; not an active decline right at this point.
C: **NEGATIVE**

## case_0005
A: YES — clean 2-candle shape at the edge: a small red day (~3.13–3.19) followed by a materially bigger green candle (~3.11–3.27) that opens below the red's close and closes above its open.
B: WEAK — only a 1-day pullback precedes it inside an already-established recovery/uptrend (price already bounced from ~2.57 to ~3.2 before this dip); not a deep decline or fresh swing low.
C: **POSITIVE** (valid textbook shape, if modest reversal context)

## case_0006
A: NO — the last two candles are both red (Apr27, Apr28/last), continuing a decline off the Apr21 swing high (~154); no green reversal candle present.
B: N/A.
C: **NEGATIVE**

### Family 1 tally
POSITIVE: 1 · NEGATIVE: 5 · AMBIGUOUS-INSUFFICIENT: 1

---

## FAMILY 2: three_white_soldiers

## case_0000
A: NO — the right edge (Jun30–Jul11) is dominated by red candles in a steady decline off the Jun26 high (~33.85) down to ~32.7; no marching green sequence near the edge.
B: NO — structure chart shows an extended downtrend from the March high (~39) that is still intact/declining into June; not an accumulation setup.
C: **NEGATIVE**

## case_0001
A: WEAK — a genuinely strong marching green run exists (roughly 6 consecutive green candles, Jan02–Jan08, ~40→47), but the true right edge (Jan12–Jan15) is red-green-red chop, i.e. the pattern already reversed by the time the chart ends.
B: YES — structure shows a multi-month base (34–40) followed by a real breakout to 48; strong, non-climactic context.
C: **AMBIGUOUS-INSUFFICIENT** (real formation, but stale relative to the true edge)

## case_0002
A: NO — a beautiful ~8-bar marching green run does exist (Apr07–Apr17, 8.45→9.5), but it is NOT at the edge; the last 4 bars are choppy alternating colors and the very last candle is red.
B: N/A given A, though structure shows the base of a longer uptrend.
C: **NEGATIVE**

## case_0003
A: NO — the whole visible window is small-bodied and alternates color throughout; no 3-bar marching green sequence anywhere, including at the edge (last 3 = green/red/green).
B: WEAK — structure shows a decline into a August low with a tentative recovery; not disqualifying, but moot given A.
C: **NEGATIVE**

## case_0004
A: NO — the last several candles (Sep01–last) are green/green/red/red, i.e., the run breaks with red candles right at the edge; no 3 consecutive tall green marchers into the close.
B: N/A.
C: **NEGATIVE**

## case_0005
A: YES — a clean, ~5-candle consecutive green marching sequence sits right at the edge (Jan09–last: roughly 53.9→55.2→55.7→56.7→57.5→58.3), each with a sizeable body and modest wicks, each closing higher than the last.
B: YES — immediately preceded by a real 3-day pullback (Jan05–07, 57→53.7) inside an ongoing recovery uptrend; not a climax top, not choppy/fake.
C: **POSITIVE**

## case_0006
A: YES (borderline) — the last 3 candles (Jul08–last) are consecutive tall green bodies with small wicks, marching from ~25.15 up to ~26.1, though the final two candles top out at nearly the same level (weaker "each higher" progression at the very last step).
B: YES — this sits as a bounce/basing attempt off the tail of a long March–June decline (29→25), not a climax top and not obviously choppy/fake for the 3 bars in question.
C: **POSITIVE**

### Family 2 tally
POSITIVE: 2 · NEGATIVE: 4 · AMBIGUOUS-INSUFFICIENT: 1
