# Levels dossiers: the page he decides from

One dossier per setup. Each lays out his words, the in-house traders, the brain's template, outside research and the
replay on the bank's examples, then a decision table for Entry, Stop, First trim, Trail and Invalidation. Every
recommendation below is a **recommendation for his decision**, not a ruling. Nothing here ships.

Support: **ruled** = his own ruling · **strong** = his words or several sources agree, and the replay does not disagree ·
**moderate** = in-house and/or outside sources, nothing against · **weak** = one source, not replayed, or in conflict ·
**none** = the sources are silent.

| setup | entry | stop | first trim | trail | invalidation |
|---|---|---|---|---|---|
| [Kicker](kicker.md) | 1 cent over the red day's high, on the Kicker day; 30-min ORB named, not drawn (**ruled**) | Kicker low, at most 3.5% under entry (**ruled**) | 1/3 to 1/2 after 3-5 days, stop to breakeven (moderate) | close under the 20-day EMA (moderate) | Kicker low breaks (strong) |
| [Oops Reversal](oops.md) | buy as it reclaims the prior close (strong) | the Oops day's low (strong) | trim into strength after 3-5 days, stop to breakeven (moderate) | close under the 20-day EMA (weak) | Oops-day low breaks, his words (strong) |
| [Gap Support](gap_support.md) | next day, over the test day's high (moderate) | the test day's low (strong) | a third into the post-gap range high, stop to breakeven (weak) | close under the 20-day EMA (moderate) | a close under the gap-up day's low, his words (strong) |
| [High Volume Edge](hve.md) | day 2 or later, over the HVE close (moderate; not replayed) | the entry day's low, never above the HVE close (weak; not replayed) | a third into the first 3-5 day push (weak) | close under the 20-day EMA (moderate) | the HVE day's low breaks (weak) |
| [Slingshot](slingshot.md) | next day, over the trigger day's high (moderate) | the trigger day's low (strong) | into the next 3-5 day burst (moderate) | close under the 21-day EMA (weak) | trigger low breaks (moderate) |
| [Launchpad](launchpad.md) | the launch day's close (moderate) | the launch day's low (moderate; Manrav stops under the pad) | into the first 3-5 day burst (moderate) | close under the 21-day EMA (moderate) | a close back under the 21 EMA / 50 SMA cluster (moderate) |
| [Bear gap, SHORT](bear_gap.md) | next day, under the gap day's low (weak, placeholder) | over the gap day's high (weak) | none (sources silent) | none (sources silent) | a close back above the prior day's low (weak) |

Every recommended line can be drawn from daily bars, except the Kicker's 30-minute ORB, which the lesson can name but not
draw (no intraday bars for these dates).

## Read before relying on any number

1. **The replay used examples he cut or never graded.** `measure_rules.py` replays every "Yes" example in the bank files.
   Matched against `owner_verdicts.jsonl` by symbol, date and setup:

   | setup | replayed | he kept | he cut | no verdict |
   |---|---:|---:|---:|---:|
   | Kicker | 37 | 16 | 11 | 10 |
   | Oops Reversal | 36 | 26 | 10 | 0 |
   | Gap Support | 40 | 16 | 8 | 16 |
   | High Volume Edge | 56 | 19 | 16 | 21 |
   | Slingshot | 40 | 16 | 10 | 14 |
   | Launchpad | 56 | 28 | 18 | 10 |
   | Bear gap | 39 | 1 | 7 | 31 |

2. **The examples were chosen to work.** The scan rule (log line 23): no close under the setup day's low within 20
   sessions, a gain of about 8-10%. So stops at the setup day's own low look good partly by construction. HVE was exempt
   (log line 124). The Oops examples were also chosen so the Oops-day low never broke (log line 41).
3. **Not replayed:** Williams' Oops entry, the in-house HVE day-2 entries and stops, stops under a base low, and every
   trim and trail. Next step: re-run the replay on the kept examples only, with these added, before he rules on numbers.

## How the recommendations were chosen

- **Entry.** His one entry ruling is a trigger, "OVER previous day high not at mkt close!" (2026-11-02). Where a trigger
  over a line did about as well as the close on his examples, the trigger is recommended (Gap Support, Slingshot). Where
  the close did clearly better and the close is the event in his definition, the close is recommended (Launchpad). He may
  prefer one entry style for every setup.
- **Sell rules.** He deferred them on 2026-11-02 ("We can work on those sell rules later though because its
  complivated"). The trim and trail rows are prepared for that sitting. Two rules recur across sources: trim into the
  first 3-5 day burst and move the stop to breakeven; trail on a close under the 20/21-day EMA.
- **Citations.** "KB" numbers are rows in `docs/study/levels/brain_kb_rules_2026-11-06.json` or
  `brain_kb_2026-11-06.json`. [S#] are sources in `external_research.md`. Verdict-log lines without a date field are
  cited by line number and review pass; the bank lessons date each setup's rulings.

## Flagged for him across setups

- **"Day 1" vs "day 2" for the Kicker.** His words call the Kicker "DAY 1"; `docs/study/levels/README.md` and
  `external_research.md` say "day-2 30-minute opening range" because they count the red day as day 1. Same session, two
  numberings. Not edited here.
- **Bear gap.** He has not yet pinned down what he means; the founding example was cut. It may not even be a short (the
  log calls it a "gap resistance / failed gap" lesson). Its levels wait on his own charts.
- **Manrav weighting.** Manrav's stops are often wider than the replay favours (Launchpad under the pad, Slingshot's 9%
  example, the HVE close). Those are real choices, marked in each dossier.
