# Wave 1 Blind Visual Triage — Dispatch B

Judged purely from `blind_packets.json` (case_id / chart paths / neutral_context) and the
structure + detail PNGs for each case. No other repo file was read.

## FAMILY: flat_base

## case_0000
A: YES — the last ~15-18 bars (Nov04→Dec02) trade in a genuine sideways band roughly 14.3-15.8 after the prior Aug-Oct uptrend, still current at the right edge.
B: MARGINAL — mostly tight, but one sharp single-day whipsaw (Nov18, ~8% round trip down to 14.3 and back) breaks the "no wild swings" bar.
Verdict: POSITIVE

## case_0001
A: YES — after the long Apr-Aug uptrend, price has been chopping in a tightening ~32.5-34.3 band for the final 3 weeks (Aug10-Aug31), closing right in that range.
B: GOOD — low ADR name (2.0%), range is only ~6% wide, no violent single-bar dislocations.
Verdict: POSITIVE

## case_0002
A: NO — the rightmost bars (Mar17-Mar31) are the tail of a huge, still-in-progress uptrend (6→16) capped by a sharp reversal on the final 1-2 candles; nothing flat is happening right now.
B: POOR — large sustained trend plus a violent whipsaw reversal at the very edge.
Verdict: NEGATIVE

## case_0003
A: NO — the last ~10 bars (Mar17-Mar31) show a sharp decline from ~168 to ~145 then a weak bounce; the whole detail window is a volatile downtrend (175→~150), never flat.
B: POOR — large multi-week swings between 140 and 180, no tight band anywhere near the right edge.
Verdict: NEGATIVE

## case_0004
A: YES — after the Feb rally to 8.4, the last ~3 weeks (Mar10-Mar31) hold a tight 7.6-8.0 band, closing at 7.83 right in the middle of it.
B: GOOD — range is only ~5% wide (ADR 3.3%), no violent single-bar breaks.
Verdict: POSITIVE

## case_0005
A: NO — the last ~8 bars are a sharp V-shaped breakout rally (6.2→7.9 on a volume spike) followed by a pullback, not a flat range; the actual base (Feb17-Mar17) is already well behind the current bars.
B: POOR — the "quiet" period ended weeks ago; the right edge is a volatile breakout+pullback.
Verdict: NEGATIVE

## case_0006
A: NO — the right edge (Mar23-Mar31) is a 2-bar sharp rally off a downtrend low followed by an immediate pullback — a whipsaw bounce, not a horizontal base.
B: POOR — sharp reversal candles, not an orderly tight range.
Verdict: NEGATIVE

### flat_base tally
POSITIVE: 3 (case_0000, case_0001, case_0004) · NEGATIVE: 4 (case_0002, case_0003, case_0005, case_0006) · AMBIGUOUS-INSUFFICIENT: 0

---

## FAMILY: wyckoff_upthrust

## case_0000
A: WEAK — the last bar is a huge reversal candle (168→~142) after a strong staircase rally, but there is no genuine horizontal trading range immediately preceding it (just continuous uptrend), so the "poke above resistance" premise is shaky.
B: UNCLEAR — the reversal candle IS the rightmost bar; there are no subsequent bars in either chart to show whether it fakes back into a range or becomes a large decline.
Verdict: AMBIGUOUS-INSUFFICIENT

## case_0001
A: NO — no defined trading range or poke-then-reversal at the right edge; the last bars show a mild pullback from a new high (130→126) inside a continuing recovery uptrend.
B: N/A — mechanical shape absent.
Verdict: NEGATIVE

## case_0002
A: NO — price has held a tight ~60-61.3 band for ~6-7 weeks (since the late-Jul breakout) with no fresh poke-above-then-sharp-reversal visible at the rightmost bars — just continued congestion near the highs.
B: N/A — no reversal event to characterize.
Verdict: NEGATIVE

## case_0003
A: WEAK — the last 2 bars show a rally to a local high (~9.9-10.0) followed by one reversal candle down to ~9.5, but the preceding months are a sustained downtrend/bounce, not a horizontal range.
B: UNCLEAR — no bars after the reversal candle to see whether it's a fake-out or the downtrend's continuation (which the broader multi-month decline would suggest).
Verdict: AMBIGUOUS-INSUFFICIENT

## case_0004
A: NO — the closest thing to a poke-and-reverse (a spike to ~17.3 then decline to ~14) happened roughly 3-4 weeks before the right edge; the current rightmost bars are just quiet congestion (15-16.4), not a fresh event.
B: N/A — stale, not present at the edge.
Verdict: NEGATIVE

## case_0005
A: NO — price is trending steadily upward into new highs at the right edge (no reversal); the large decline in this window happened months earlier and has already fully round-tripped back up.
B: N/A — no reversal at the current moment.
Verdict: NEGATIVE

## case_0006
A: WEAK — same shape as case_0000: a strong staircase rally culminates in one blow-off green candle to a new high (~141) immediately followed by one red reversal candle (→~136-138), but no genuine horizontal range precedes it.
B: UNCLEAR — reversal candle is the rightmost bar in both charts; no follow-through data to judge fake-out vs. large decline.
Verdict: AMBIGUOUS-INSUFFICIENT

### wyckoff_upthrust tally
POSITIVE: 0 · NEGATIVE: 4 (case_0001, case_0002, case_0004, case_0005) · AMBIGUOUS-INSUFFICIENT: 3 (case_0000, case_0003, case_0006)

---

## FAMILY: pullback_to_50sma

## case_0000
A: NO — after the Feb17-24 spike to 1.95, the last ~6 bars are still declining (into, not yet reclaiming, the 50-SMA ~1.48); last_close 1.55 is only marginally above the MA but the candles show no bounce yet, just continued red bars.
B: POOR — the pullback itself is a violent ~20% multi-day drop relative to this name's own volatility.
Verdict: NEGATIVE

## case_0001
A: NO — price has trended steadily upward the entire detail window, staying well clear of the rising 50-SMA (last_close 1.72 vs sma50 1.40, ~23% above); no touch/pullback event is visible at all.
B: N/A — no pullback present.
Verdict: NEGATIVE

## case_0002
A: WEAK — the touch-and-reclaim of the 50-SMA happened ~1.5-2 weeks before the right edge (late May); price has since extended straight up to a new high (44.13 vs sma50 41.02, ~7.6% / ~2.9x ADR away), well past "just bounced."
B: GOOD (for the pullback itself, which was a moderate ~4-8% dip) but freshness fails.
Verdict: NEGATIVE

## case_0003
A: YES — price reclaimed and has held above the 50-SMA since roughly Feb13-20, continuing to new highs into the right edge (fresh-ish, still recent).
B: POOR — the "pullback" that preceded the reclaim was actually a violent ~19% two-day crash straight through the MA (26→21), not a controlled touch.
Verdict: NEGATIVE

## case_0004
A: WEAK — the touch near the 50-SMA (Aug29-Sep02) is roughly 10 bars behind the right edge, with price now moderately extended above it (3.42 vs sma50 3.16, ~8.4% / ~1.8x ADR).
B: POOR — the pullback into that touch was a violent ~15% drop in about 4 days.
Verdict: NEGATIVE

## case_0005
A: YES — the last ~5 bars show a clean pullback from ~24 down to ~22.1 (right at/slightly below the 50-SMA) and a bounce back to close at 23.01, just above sma50 22.29 (~3.3% / <1x ADR) — genuinely fresh.
B: MARGINAL/GOOD — the dip is proportionate to the stock's own volatility (ADR 4.1%) and not a violent dislocation, though the broader chart is choppy.
Verdict: POSITIVE

## case_0006
A: NO — the one real touch of the 50-SMA (May20-27 dip to ~42) is roughly 3 weeks behind the right edge; price has since rallied hard and now sits well above the MA (48.01 vs sma50 44.02, ~9% / ~1.7x ADR) with the last several bars chopping near highs, not pulling back toward it.
B: MARGINAL — the original pullback itself wasn't overly violent, but staleness is the disqualifier.
Verdict: NEGATIVE

### pullback_to_50sma tally
POSITIVE: 1 (case_0005) · NEGATIVE: 6 (case_0000, case_0001, case_0002, case_0003, case_0004, case_0006) · AMBIGUOUS-INSUFFICIENT: 0
