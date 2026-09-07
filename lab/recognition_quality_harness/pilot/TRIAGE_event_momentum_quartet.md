# Triage: Event/Momentum Quartet (power_earnings_gap, episodic_pivot, remount, wyckoff_spring)

Rapid, lightweight visual triage. 1-2 sentences of reasoning per case, no deep forensics.
Charts read: `<case>_structure.png` (150 bars, SMA50/200 for family 1-2; 90 bars, SMA10/20/50 for family 3-4) + `<case>_detail.png` (25 bars, SMA10+volume for family 1-2; 45 bars, SMA10/20/50+volume for family 3-4).

---

## FAMILY 1: power_earnings_gap (gap-and-hold)

## case_0000
A: NO — no single large gap-up day visible; detail shows a steady multi-week grind up (18.5→20) with fairly uniform volume, no standout spike day.
B: N/A — without a real gap day there is nothing to "hold."
C: **NEGATIVE**

## case_0001
A: YES — one huge-range day (~98→130+ intraday, low ~125) on volume ~8M vs a ~1-2M baseline (~8x), a clean 25-30%+ gap/expansion.
B: YES — the following ~3 weeks stay in the 130-145 band, never falling back toward the pre-gap 90-99 zone.
C: **POSITIVE**

## case_0002
A: NO — largest volume day (~10M green bar) occurs while price is already flat near 16.25 (after a prior decline/recovery), not on a gap; no 8%+ single-day gap-up is visible.
B: N/A
C: **NEGATIVE**

## case_0003
A: YES — a big green expansion candle (~73→84 range) on volume ~10M vs a ~1-2M baseline (~5-8x), a clean double-digit % gap.
B: YES — subsequent days continue 84→92 and pull back only into the high-80s, staying well clear of the pre-gap 72-76 zone.
C: **POSITIVE**

## case_0004
A: YES — a big green gap/expansion day (~9→13) on volume ~20M vs a ~5-7M baseline (~3-4x), a large gap.
B: WEAK — price holds above the gap (never re-enters pre-gap range) but instead of a tight consolidation it keeps expanding into a second gap-up leg (13→17+) — more "gap and go" than "gap and hold."
C: **POSITIVE** (caveat: consolidation is not tight, it's a continued run)

## case_0005
A: NO — tiny illiquid name (vol ~50-200k), gradual grind 11.2→11.5→11.35 with no discrete gap day.
B: N/A
C: **NEGATIVE**

## case_0006
A: WEAK/NO — the only candidate gap sits at the very left edge of the detail window (no pre-gap context to size it), and the actual volume-spike day in the window (~16M) is a DOWN day, not a gap-up.
B: N/A
C: **AMBIGUOUS-INSUFFICIENT**

**Tally: 3 POSITIVE (0001, 0003, 0004) · 3 NEGATIVE (0000, 0002, 0005) · 1 AMBIGUOUS-INSUFFICIENT (0006)**

---

## FAMILY 2: episodic_pivot (single-bar regime-change breakout)

## case_0000
A: WEAK — price is already grinding up (11.3→12.8) over the prior 5 weeks rather than sitting in a flat base; it's a shallow-uptrend pause, not true sideways.
B: YES — final 3 bars are a violent, high-volume (~10.5M vs ~2.5-5M) breakout closing near its high, clearing the whole recent range.
C: **POSITIVE**

## case_0001
A: WEAK — the prior ~2 weeks are choppy/volatile (large daily ranges 38-42), not a tight flat base.
B: WEAK — the breakout day's volume (~19-23M) is only a modest step up from the ~10-17M baseline, and the move fully round-trips (47→40) within a week, erasing the pivot.
C: **NEGATIVE**

## case_0002
A: YES — a genuine multi-week flat/tight range (~9-10.5) on light volume (150-300k) precedes the move.
B: YES — a big green candle (10.5→13) on volume ~600k (~3x the base) closes strong, clearing the range highs decisively.
C: **POSITIVE**

## case_0003
A: NO — this is a downtrend (168→150 over the window), not a base.
B: NO — no breakout bar; just decline.
C: **NEGATIVE**

## case_0004
A: NO — continuous multi-week grind up (31→42) with no flat consolidation.
B: WEAK — there is a larger green candle mid-sequence but volume isn't a standout spike vs. neighbors, and it's part of a continuous trend, not an emergence from flatness.
C: **NEGATIVE**

## case_0005
A: NO — steady gradual grind (28→30.5) over 3 weeks, no flat base and no violent single bar.
B: NO.
C: **NEGATIVE**

## case_0006
A: YES — ~2.5 weeks tight/flat (21-22) on light volume, and the structure chart shows a multi-month base (18-22) beforehand.
B: YES — a big green candle (23.5→26) on volume ~44M vs a ~5-20M baseline, closing near its high, clearing the whole base.
C: **POSITIVE**

**Tally: 3 POSITIVE (0000, 0002, 0006) · 4 NEGATIVE (0001, 0003, 0004, 0005)**

---

## FAMILY 3: remount (reclaim of a broken key level)

## case_0003
A: NO — after an initial rally the stock chops mostly above its MAs for the rest of the window; no clean multi-week stretch below a key MA.
B: N/A
C: **NEGATIVE**

## case_0000
A: WEAK/YES — roughly 2.5 weeks (mid-to-late Aug) trading below both MAs after topping near 170.
B: AMBIGUOUS — only the very last 1 candle shows a bounce back up; the chart ends immediately after, so there's no way to confirm the reclaim actually holds.
C: **AMBIGUOUS-INSUFFICIENT**

## case_0001
A: YES — a clear ~5-week decline/basing below the MAs (Feb into late March, bottoming ~94).
B: YES — reclaims and then holds above both MAs for nearly a month through late April (98→108+).
C: **POSITIVE**

## case_0002
A: YES — a clean ~7-week decline (130→105) staying below the MAs into late June.
B: YES — reclaims and holds above the MA for the final ~2.5 weeks, climbing steadily to ~117.
C: **POSITIVE**

## case_0004
A: INCONCLUSIVE — the structure chart shows a real ~6-week decline (136→117, Oct-Dec) below the MAs, but then price jumps almost vertically from ~120 to ~170 across what looks like a genuine data gap (no candles plotted in between), which is inconsistent with the name's tiny 0.35% ADR.
B: INCONCLUSIVE — same gap; can't tell if this is a real reclaim vs. a data/corporate-action artifact.
C: **AMBIGUOUS-INSUFFICIENT** (chart looks internally inconsistent — flagging per provenance note rather than forcing a call)

## case_0005
A: YES — clear ~5-6 week decline (49→46) below the MAs from late July into early September.
B: WEAK — only the final 1-2 candles tick up (46→47) toward/through the MA; insufficient bars to confirm the reclaim holds.
C: **AMBIGUOUS-INSUFFICIENT**

## case_0006
A: YES — a long, clean multi-week decline (37.5→31.5) firmly below both MAs.
B: NO — only a tiny 2-3 bar bounce at the very edge of the chart, still hugging/below the MA; no confirmed hold.
C: **NEGATIVE**

**Tally: 2 POSITIVE (0001, 0002) · 2 NEGATIVE (0003, 0006) · 3 AMBIGUOUS-INSUFFICIENT (0000, 0004, 0005)**

---

## FAMILY 4: wyckoff_spring (false-breakdown-then-reclaim)

## case_0000
A: WEAK — there's a ~3-week range (63-67) in early-mid August, but it sits inside a larger multi-month downtrend (79→62), so it's more a pause than a genuine standalone range.
B: YES — a brief dip to ~62 (below the 63-67 floor) for a couple of bars, then a quick reclaim back above 64-65 continuing to 69-70 on rising volume.
C: **AMBIGUOUS-INSUFFICIENT** (mechanically spring-like, but the "range" is questionable)

## case_0001
A: NO — price is declining into the low (209 area), not consolidating in a defined range beforehand.
B: NO — the "undercut" is really a multi-week ~3-week decline (218→209), not a shallow 1-3 bar dip; the subsequent recovery is a slow multi-month grind, not a quick reclaim.
C: **NEGATIVE**

## case_0002
A: YES — a genuine tight range (2.8-2.95) for the first ~3 weeks.
B: NO — the subsequent drop (2.8→2.4) is a deep, multi-week real breakdown (~15%), not a shallow undercut, and the recovery (to ~2.7) never reclaims back above the range's support.
C: **NEGATIVE**

## case_0003
A: NO — persistent downtrend (48→36) throughout, no sideways range at any point.
B: NO.
C: **NEGATIVE**

## case_0004
A: YES — after an initial sharp drop, price consolidates in a genuine ~6-week range (~23-24.3).
B: YES — a brief dip to ~22.2 below the range floor for 2-3 bars, then a quick reclaim back above 23 with volume picking up on the reclaim bars.
C: **POSITIVE**

## case_0005
A: YES — a tight ~3-week range (45.5-48.5) precedes the move.
B: NO — instead of an undercut, price breaks out ABOVE resistance and rallies hard to 55.5; this is a breakout, not a spring.
C: **NEGATIVE**

## case_0006
A: NO — a persistent grinding downtrend (37→34) with no well-defined sideways range.
B: WEAK — a new low into the last few bars with a small 2-bar bounce, but this reads as noise in an ongoing downtrend rather than a defined spring.
C: **NEGATIVE**

**Tally: 1 POSITIVE (0004) · 5 NEGATIVE (0001, 0002, 0003, 0005, 0006) · 1 AMBIGUOUS-INSUFFICIENT (0000)**

---

## Overall summary (28 cases)

| Family | POSITIVE | NEGATIVE | AMBIGUOUS-INSUFFICIENT |
|---|---|---|---|
| power_earnings_gap | 3 | 3 | 1 |
| episodic_pivot | 3 | 4 | 0 |
| remount | 2 | 2 | 3 |
| wyckoff_spring | 1 | 5 | 1 |
| **Total** | **9** | **14** | **5** |
