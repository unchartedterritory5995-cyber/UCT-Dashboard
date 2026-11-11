# Launchpad: levels dossier

For the owner's ruling. Nothing here ships. Terms: **R** = the risk on a trade (entry minus stop); "2R" = a gain twice
that risk. **The bundle** = the 8-day, 21-day and 50-day averages bunched together. **Launch day** = the first close
above every average. **EMA / SMA** = exponential / simple moving average. **ATR** = average true range, the stock's
typical daily movement.

## 1. The setup, in his words

From the bank lesson (`docs/study/bank/spot.setups.json`, his rulings 2026-10-23/24): "after a real correction the 8, 21
and 50-day averages chunk up into a tight bundle at or near the 200-day while price lives UNDER and through the bundle for
weeks in a long flat base, dangling and retesting it; the launch is the FIRST bar that closes above every average, the
bundle and the 200-day alike, as they stack into 8 > 21 > 50. It is the convergence and the dangle, not a breakout".

## 2. What he has already ruled

No entry, stop or sell rule yet. His words that bear on the levels (Launchpad passes 2-4, undated log lines; his
Launchpad rulings are dated 2026-10-23/24):
- "Nah, I want it above" (WSM) and "I want it above the MAs" (ADSK): the launch bar must close above every average,
  the 200-day included.
- "Eh, it is more of a VCP or flat base breakout so I would say no to launchpad" (TAN); "Pass, more of a breakout vs a
  launchpad" (MARA).
- "Nah I think I want them to look more like MSTR than this" (GOOGL, log line 84).

## 3. What the in-house traders do

**Entries**
- Manrav, 2025-08-09 (KB 11726): a launch pad is price sitting very close to the 8, 21 and 50 (better with the 200).
  Manrav, 2025-12-21 (KB 12198): he prefers launch pads close to the 200-day SMA.
- Manrav, 2026-02-28 (KB 15494): CRCL: buy close to the launch pad and 50-day SMA to manage risk.
- Manrav, 2024-07-02 (KB 10988): once it pushes through the 50-day with all averages stacked and curling up, the move is
  powerful.
- Bracco, 2025-11-24 (KB 12021): he loves early launchpads, the first one in a base.
- TSDR, Sunday Scans 2025-11-23 (KB 4827): TWLO weekly launchpad: entry over Friday's high, the 20 EMA as the stop.
- UCT team playbook, undated (KB 15867): buy inside the pad, or on the reclaim of the averages or of a high-volume close;
  from below the 50-day, start on a Slingshot and add on the 50-day reclaim.

**Stops**
- Manrav, 2024-05-02 (KB 10935): on a 30-minute launch pad, stop on a break below the pad. Manrav, 2024-07-02 (KB 10988): "the launch pad as
  the stop".
- Manrav, 2025-12-21 (KB 12198): a rule of thumb, "50 SMA buy, 65 EMA stop".
- UCT team playbook (KB 15867): below the launch pad (the base low) or the low of the day; wider below the 50/200.

**Trims, adds, trails**
- Manrav, 2024-06-28 (KB 10985): stocks move in bursts of 3-5 days; enter at the start. UCT playbook (KB 15867): enter
  at the start of a burst and trim into it.
- Adds: Manrav, 2024-10-06 (KB 11169): GEV: the launch pad as the entry, adds on undercut-and-reclaims of the 50/21 with a
  50-day stop, then "move stops on the adds and ride the core".
- Trail: Manrav (KB 11169): once the 21 EMA rises above your entry, treat it as a position trade. Manrav's RBLX chart,
  2025-09-15 (KB 13488): "100% from launch pad, rides 8 and 21 EMAs". TSDR, 2024-10-12 (KB 14268): his trailing stop is
  the daily 9/20 EMA or a 65-minute "bearish launchpad" (the averages stacking downward), which he tested as his sell
  signal, 2024-10-21 (KB 14348).

**Invalidation**
- UCT playbook (KB 15867): a close below the 21 EMA / 50 SMA cluster. A quick break and reclaim is a fake-out.

**Disagreements.** Manrav and the playbook buy inside or near the pad; his definition makes the launch the first close
above every average; TSDR buys over the prior high. Stops range from the launch day's low to under the pad, the 20 EMA
and the 65 EMA.

## 4. The brain's template ("Launchpad")

- Entry: a break above a tight consolidation on explosive volume, 2x average or more.
- Stop: below the consolidation's low. Max stop 8%.
- First target: 10-30% from the breakout, in days.
- Invalidation: the consolidation breaks down on volume.
- Mistakes: entering before volume confirms; mistaking a VCP for a launchpad.
- This template is thin, and its breakout entry conflicts with his "not a breakout".

## 5. Outside research (`external_research.md`)

- Published versions disagree on the averages and are mostly late-base continuations; his is a bottoming setup near the
  200-day. Haber's Stage 1-to-2 framing is the closest [S27, reputable educator, excerpt only].
- Entry: a close above all the averages while they sit within 1-3% of each other [S29, forum/secondary]; or buy above the
  tight range [S28, reputable educator].
- Stop: a close below the converged averages that does not recover, or an undercut of the pivot low [S27, excerpt only].
- Selling: Haber sells at least a third to a half on a second straight close below the 21-day SMA [S27, excerpt only];
  Deepvue sells partial profits into prior highs [S28]. No statistics were found.

## 6. How the candidates did on his own examples (`evidence.md`)

| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| the launch day's close (engine) | the launch day's low | 56 | 3.7% | 41% | 89% | 82% | 68% | 4.5 | +14.5% |
| the launch day's close (engine) | under the bundle: lowest of 8/21/50 less 0.25 ATR (engine) | 56 | 7.4% | 36% | 88% | 64% | 41% | 2.6 | +11.8% |
| next day over the launch day's high | the launch day's low | 48 | 4.6% | 42% | 75% | 73% | 58% | 3.7 | +13.7% |
| next day over the launch day's high | under the bundle: lowest of 8/21/50 less 0.25 ATR (engine) | 48 | 8.1% | 35% | 83% | 58% | 35% | 2.2 | +10.8% |

"Stop hit" = the first stop was hit at some point in 60 sessions, even after a gain (nothing trails yet).

What this shows:
- The launch day's low is the better stop: half the risk of the under-the-bundle stop (3.7% vs 7.4%) and more trades
  reach 2R and 3R. The under-the-bundle row is the nearest replay of Manrav's "stop under the launch pad".
- Here, unlike the Slingshot and Gap Support, the close entry clearly beats the next-day break: 1R on 89% vs 75%, 2R on
  82% vs 73%.
- Limits. Chosen charts, and the scan required each to "work" (no close under the launch day's low within 20 sessions;
  log line 23), so the launch-low stop looks good partly by construction. Of the 56 replayed he kept 28, cut 18 (five as
  plain breakouts), and 10 have no verdict. A stop under the base low was not replayed.

## 7. The decisions for him

| line | options (source) | from daily bars? | recommended default, for his decision |
|---|---|---|---|
| Entry | **A** the launch day's close (his definition; engine; [S29]) <br> **B** next day, 1 cent over the launch day's high (TSDR KB 4827; template; [S28]) <br> **C** inside or near the pad before the launch (Manrav KB 15494, KB 12198; UCT playbook) | all yes | **A.** His definition makes the close the event, and on his examples the next-day entry lost a clear share of the 1R and 2R reach. This differs from his Kicker ruling ("not at mkt close"); if he wants one entry style for every setup, B. |
| Stop | **A** the launch day's low (UCT playbook "or the low of the day") <br> **B** under the bundle / the pad (Manrav KB 10935, KB 10988; UCT playbook; [S27]; engine row) <br> **C** the 65-day EMA (Manrav KB 12198) or the 20-day EMA (TSDR KB 4827) | all yes | **A**: half the risk of B and the best rows on his examples. Manrav, whose notes come first, uses B, so this is a real choice for him. |
| First trim | **A** trim into the first 3-5 day burst (Manrav KB 10985; UCT playbook) <br> **B** partial profits into prior highs ([S28]) <br> **C** 10-30% from the breakout (template) | A yes; B partly; C yes | **A**: Manrav's and the house playbook's. |
| Trail | **A** a close under the 21-day EMA (Manrav KB 11169, KB 13488) <br> **B** two straight closes under the 21-day SMA ([S27]) <br> **C** a 65-minute bearish launchpad (TSDR KB 14348) | A yes; B yes; C no (needs hourly bars) | **A**: Manrav's average, and the 21-day is also Haber's. |
| Invalidation | **A** a close back under the 21 EMA / 50 SMA cluster that is not quickly reclaimed (UCT playbook; [S27]) <br> **B** the base breaks down on volume (template) | both yes | **A**: the house playbook's line, with its fake-out allowance. |

## 8. Conflicts and open questions for him

1. **Launch or earlier?** Manrav and the playbook buy inside the pad; his definition waits for the first close above
   everything. Should the lesson ever show the earlier buy?
2. **Manrav's stop** is under the pad, about twice the risk of the launch day's low on his examples. Which does he want?
3. **The template's breakout entry** conflicts with "not a breakout"; it should not be used.
4. **One entry style?** Recommending the close here, but the next-day break elsewhere, follows the evidence. He may
   prefer one rule everywhere.
5. **Re-run the evidence** on the 28 kept examples only.
