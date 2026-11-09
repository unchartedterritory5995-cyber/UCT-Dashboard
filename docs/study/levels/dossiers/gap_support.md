# Gap Support: levels dossier

For the owner's ruling. Nothing here ships. Terms: **R** = the risk on a trade (entry minus stop); "2R" = a gain twice
that risk. **Test day** = the later day that pulls back to the gap and is defended. **Gap-fill spot** = the prior day's
high before the gap (where the gap would be fully closed). **EMA / SMA** = exponential / simple moving average.

## 1. The setup, in his words

From the bank lesson (`docs/study/bank/spot.setups.json`, his rulings 2026-10-26/27): "a stock that is not in a downtrend
gaps up at least 4% on twice its normal volume and holds the gap; days or weeks later it pulls back to the GAP-UP DAY'S
LOW and buyers defend it. The best examples hold that low and keep the gap open; a slight breach that closes back above
it is still good; a fill down to the gap-fill spot (the prior day's high) that reclaims the low is a lesser example, and a
breach that does not reclaim is a failed gap."

## 2. What he has already ruled

No entry, stop or sell rule yet. His definition rulings that bear on the levels:
- "That’s good but I want the gap up low to hold or be slightly breached instead of the gap fill spot btw" (log line
  185, TWLO, pass 2, undated). The log's note on that chart: it breached the gap-up low by a few percent, and he kept it
  as good.
- "Prefer holding open gap vs filling gap btw" (log line 225, UBER, pass 2, undated).
- "A lot of the are more PEGs but also gap support / Never really tested gap support / Just a PEG" (log line 209,
  definition ruling 2026-10-26): the gap day is a PEG (post-earnings gap); Gap Support is a LATER test.

## 3. What the in-house traders do

**Entries (all on the test day)**
- TSDR, Sunday Scans 2025-06-15 (KB 7823): ARKK gapping down into its open bullish gap was a reasonable entry around $61,
  with a low-of-day stop.
- TSDR desk log, 2025-05-18 (KB 10093): four days grinding back into the bull gap and the averages: "Undercut $39.8 and
  reclaim low is a buy with LOD stop." (LOD = low of day.)
- TSDR desk log, 2024-10-17 (KB 9905): bought PDD shares at $123.67, stop at the low of day (50 SMA plus gap support).
- TSDR desk log, 2025-05-21 (KB 10096): OSCR at earnings gap support, the 20 EMA and an anchored VWAP; low-of-day risk
  "is logical".
- TSDR, Sunday Scans 2026-02-21 (KB 5042): DDOG holding the gap-up low; enter on an hourly red-to-green early in the week.
- TSDR, 2026-06-01 (KB 12645): shakes into the gap that hold on day 1 or 2 have been common and often give tighter risk.
- Bracco, Sunday Scans 2025-08-17 (KB 7369): SMH: an undercut and hold of the 20 EMA and the $288.60 bull gap would be
  an awesome entry.
- Manrav, X 2026-08-23 (KB 17825): AMZN bouncing off a double-bottom pivot plus the bullish gap, a confluence zone. His only
  Gap Support passage; it names no levels.
- Chartmaster, 2026-07-30 (KB 15381): DELL tested its gap-support line twice, weeks apart, and bounced each time. This
  matches his "days or weeks later".

**Stops.** Every in-house example uses the low of the test day.

**Trims, adds, trails.** No Gap-Support-specific trim or trail in the in-house passages. AtTheAsk, 2026-09-09 (KB 12968):
after buying a 30-minute pivot at gap support he moved his stop to breakeven. As a general practice, TSDR, 2026-02-19
(KB 10316): trim a third at the first resistance and set the stop at breakeven.

**Disagreements.** The traders buy during the test day, intraday. The template also allows waiting for a hold candle the
next day. Manrav, whose names the owner uses, says almost nothing about this setup.

## 4. The brain's template ("Open Bull Gap Support")

- Entry: a dip into the gap zone with a quick reclaim, intraday or by the daily close (the "GO SIGNAL"); or a move back
  into the gap confirmed by a hold candle the next day; or an inside day tightening just above the gap.
- Stop: the low of the entry candle, or below the bottom of the open gap zone. Max stop 8%.
- Tighten: once above the prior range highs, to the latest inside day's low or the 20 EMA.
- Trail: the 20 EMA on growth names, the 50 SMA on larger or extended names. A close back below the gap is a stop.
- First target: the prior range highs or the breakout pivot above the consolidation. Add on a breakout above the range.
- Invalidation: the gap closes on a closing basis; heavy selling through gap support with no reclaim; the sector ETF
  losing its own gap or 50 SMA.

## 5. Outside research (`external_research.md`)

- Kacher/Morales use the gap day's intraday low as the line. Within five days of the gap an undercut of 1-2.5% is
  allowed; from day 6 on, a break of the low is a sell [S13, reputable educator]. This conflicts with his weeks-later
  retest with a slight breach.
- Wagner, on later pullbacks: a buy stop over a tight inside day, over a two-day high, or over the high of the day that
  tests and holds the 10-day [S17, reputable educator].
- Bulkowski tested the Kacher-Morales rules (buying the gap, stop on a close under the gap-day low): average gain 1.2% to
  3.1%, about 28-32% winners, "I don't recommend this setup" [S14, study/backtest]. That test bought the gap day, not a
  later retest. He also calls gaps "places of weak support or resistance" [S15].
- Trail, in Bulkowski's reading of Kacher-Morales: sell on a break of the 10-day after seven weeks, else the 50-day [S14].

## 6. How the candidates did on his own examples (`evidence.md`)

| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| the test day's close (engine) | the test day's low (template) | 40 | 4.4% | 58% | 100% | 95% | 88% | 6.3 | +14.7% |
| the test day's close (engine) | under the gap-up day's low (his definition) | 22 | 2.9% | 68% | 95% | 82% | 73% | 6.2 | +10.7% |
| the test day's close (engine) | the gap top, the gap filled (engine) | 29 | 6.5% | 52% | 90% | 69% | 55% | 3.6 | +14.0% |
| next day over the test day's high | the test day's low (template) | 31 | 6.2% | 48% | 100% | 94% | 84% | 4.3 | +12.4% |
| next day over the test day's high | under the gap-up day's low (his definition) | 19 | 4.0% | 58% | 95% | 89% | 74% | 5.5 | +12.0% |
| next day over the test day's high | the gap top, the gap filled (engine) | 22 | 8.3% | 41% | 95% | 77% | 41% | 2.6 | +12.3% |

"Stop hit" = the first stop was hit at some point in 60 sessions, even after a gain (nothing trails yet).

What this shows:
- The test day's low is the best-behaved stop with either entry: 2R on 94-95% of the examples.
- A stop just under the gap-up day's low is tighter (2.9-4.0%) but is hit more often (58-68%). That fits his own words:
  the "slight breach" he calls good is exactly what stops it out.
- The gap-fill stop is wide (6.5-8.3%) and has the weakest 3R. Waiting for the next day's break costs a wider stop (6.2%
  vs 4.4%), with about the same 2R rate and the fewest stop-outs (48%).
- Limits. Chosen charts, and the scan required each to "work" after the test day (no close under its low within 20
  sessions; log line 23), so the test-day-low stop looks good partly by construction. Of the 40 replayed he kept 16, cut
  8, and 16 have no verdict. The script finds "the gap" itself (the latest 4%+ gap over the prior high within 60
  sessions), which may not be the gap he meant, and puts "under the gap-up day's low" at 1% under it (its choice, not
  his). Those rows apply to only 19-29 examples.

## 7. The decisions for him

| line | options (source) | from daily bars? | recommended default, for his decision |
|---|---|---|---|
| Entry | **A** next day, 1 cent over the test day's high (Wagner [S17]; template's next-day hold candle) <br> **B** the test day's close (engine; evidence row 1) <br> **C** the undercut and reclaim of the gap-up low, intraday on the test day (TSDR KB 10093; template's GO SIGNAL) | A yes; B yes; C only roughly (a buy order at the gap-up low, filled on a day that dipped under it and closed above) | **A.** It matches his only entry ruling (a trigger OVER a high, "not at mkt close") and Wagner's rule. On his examples it reached 2R about as often as B (94% vs 95%), with a wider stop. If he accepts a close entry here, B. |
| Stop | **A** the test day's low (template; TSDR KB 7823, KB 10093, KB 9905) <br> **B** just under the gap-up day's low (his line) <br> **C** the gap-fill spot (engine) | all yes | **A.** It sits under the "slight breach" he accepts, and every in-house example uses it. |
| First trim | **A** a third into the top of the range since the gap, stop to breakeven (template's first target; TSDR KB 10316 as general practice) <br> **B** 1/3 to 1/2 after 3-5 days, stop to breakeven ([S1]) | both yes | **A**, the setup-specific target; support is thin (template only). |
| Trail | **A** a close under the 20-day EMA (template, growth names) <br> **B** a close under the 50-day SMA (template, larger names; [S14]) | both yes | **A**, with B for large caps if he wants two speeds. |
| Invalidation | **A** a daily close under the gap-up day's low (his definition: "a breach that does not reclaim is a failed gap") <br> **B** a close back below the gap (template) <br> **C** any break of the gap-day low from day 6 on ([S13]) | all yes | **A**: his own words. |

## 8. Conflicts and open questions for him

1. **How slight is "slightly breached"?** TWLO went a few percent under and he kept it. Confirm that the stop should sit
   under the test day's low, not under the gap-up low.
2. **Weeks later vs five days.** Kacher/Morales allow an undercut only in the first five days [S13]; his retests come
   days or weeks later. Keep his.
3. **Close vs trigger entry.** He rejected a close entry for the Kicker. Does the same apply here (entry A), or is the
   test day's close acceptable (entry B, smaller stop)?
4. **Bulkowski's poor result** [S14] tested buying the gap day, which he calls a PEG, not Gap Support. It does not test
   his setup, but it is a caution against treating the gap low as strong support on its own.
5. **Re-run the evidence** on the 16 kept examples, with the gap he meant marked by hand.
