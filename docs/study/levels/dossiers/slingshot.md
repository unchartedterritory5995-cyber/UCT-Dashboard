# Slingshot: levels dossier

For the owner's ruling. Nothing here ships. Terms: **R** = the risk on a trade (entry minus stop); "2R" = a gain twice
that risk. **The 4-day average of the highs** = a 4-day exponential moving average of each day's high (the gold line on
his Slingshot charts). **Trigger day** = the first close back above it. **EMA / SMA** = exponential / simple moving
average. **PEG** = power (post-) earnings gap.

## 1. The setup, in his words

From the bank lesson (`docs/study/bank/spot.setups.json`, his rulings 2026-10-24/25): "a drive first, usually an earnings
gapper (it is mostly the way into a power earnings gap after its first pause), sometimes a strong rally; THEN a tight
orderly pullback of three to seven sessions, about 5-12% deep, with the closes under the 4-day average of the highs; THEN
the trigger, the first close back above that average, a decisive day that closes near its high and needs no gap."

## 2. What he has already ruled

No entry, stop or sell rule yet. His note on what the setup is for (log lines 161-162, COIN, Slingshot pass 2, undated):
- "Meant to be used to enter PEGS mostly but not"
- then: "Not exclusively to PEGs but still good, I don’t want to keep this"

## 3. What the in-house traders do

**Entries**
- Manrav, 2025-07-13/14 (KB 11544): his scan looks for a 4% gap on above-average volume in the last 25 days; the trigger
  is a close above the 4-day average of the highs after three closes under it, "basically a delayed-reaction or
  pullback-buy setup". His summary slide adds: confirmation is a range break after the cross, ideally after tightness.
- Manrav, 2025-10-05 (KB 11964): shared Scot1and's video: wait for price to trade back above the line rather than buying
  the first pullback day.
- Manrav, 2026-09-14 (KB 12958): instead of buying the dip, the Slingshot identifies strength after the dip.
- UCT team playbook, undated (KB 15877): the close back above the line is the trigger, "often entered intraday on the
  trigger day".

**Stops**
- UCT team playbook (KB 15877): the prior day's low or the low of the day, or the bottom of the recent consolidation.
- Manrav, 2025-11-26 (KB 12088), in a thread on RUN and GEV Slingshots: shares with yesterday's low as the stop (about 9%).

**Trims, adds, trails**
- UCT team playbook (KB 15877): trim into the next 3-5 day burst. Manrav, 2024-06-28 (KB 10985): stocks move in bursts of
  3-5 days; enter at the start of one.
- Adds: Manrav, 2025-08-09 (KB 11726): with the 50-day SMA overhead, start on the Slingshot and add on the 50-day reclaim.
  Manrav, 2025-11-26 (KB 12088): add on a pullback that holds the 50-day.
- Trail: nothing Slingshot-specific. Manrav's RBLX chart, 2025-09-15 (KB 13488), notes the run "rides 8 and 21 EMAs"
  after a Launchpad plus Slingshot.

**Disagreements.** When to buy: his definition and Manrav's scan use the close; the UCT playbook says often intraday on the
trigger day; Manrav's slide wants a range break after the cross. Stop: the day's low, the prior day's low (about 9% in
Manrav's example) or the bottom of the pullback.

## 4. The brain's template

None. The brain has no Slingshot template (levels `README.md`). The UCT team playbook entry above (KB 15877) is the
nearest thing.

## 5. Outside research (`external_research.md`)

- The originator, Scot1and, quoted in a script: "My Slingshot indicator is simply a 4EMA of the highs." It needs prior
  upward momentum, often after an earnings gap [S24, secondary quoting the originator]. That matches his PEG note.
- Stop: usually the low of the Slingshot day, at most the bottom of the consolidation [S24].
- Selling: a portion early in the advance, the rest held on trendlines while the market shows no distribution days [S23,
  originator, in a comment reply].
- His trigger is a "break" of the line, not said to be a close [S23]. No statistics were found.

## 6. How the candidates did on his own examples (`evidence.md`)

| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| the trigger day's close (engine) | the trigger day's low (engine) | 40 | 4.9% | 45% | 88% | 78% | 72% | 5.1 | +12.0% |
| the trigger day's close (engine) | the pullback's low (five sessions) | 40 | 7.0% | 40% | 85% | 78% | 60% | 3.4 | +12.0% |
| next day over the trigger day's high | the trigger day's low (engine) | 33 | 5.7% | 42% | 85% | 79% | 67% | 4.1 | +11.2% |
| next day over the trigger day's high | the pullback's low (five sessions) | 33 | 8.5% | 36% | 85% | 73% | 45% | 2.8 | +10.7% |

"Stop hit" = the first stop was hit at some point in 60 sessions, even after a gain (nothing trails yet).

What this shows:
- The trigger day's low is the better stop with either entry: smaller risk, and more trades reach 3R.
- Buying the close or buying the next day's break of the trigger high come out almost the same (2R on 78% vs 79%). The
  next-day entry costs a slightly wider stop (5.7% vs 4.9%); 7 of the 40 never triggered.
- Limits. Chosen charts, and the scan required each to "work" (no close under the trigger day's low within 20 sessions;
  log line 23), so the trigger-low stop looks good partly by construction. Of the 40 replayed he kept 16, cut 10, and 14
  have no verdict. "The pullback's low" is the lowest low of the trigger day and the four days before it: the script's
  fixed window, not his 3-7 sessions.

## 7. The decisions for him

| line | options (source) | from daily bars? | recommended default, for his decision |
|---|---|---|---|
| Entry | **A** next day, 1 cent over the trigger day's high (Manrav's "range break after the cross", KB 11544; Scot1and's "break" [S23]) <br> **B** the trigger day's close (his definition; Manrav's scan; engine) <br> **C** intraday on the trigger day as price crosses the line (UCT playbook KB 15877) | A yes; B yes; C no (the line moves with the day's own high) | **A.** It matches his Kicker ruling (a trigger over a high, not the close) and Manrav's confirmation, and on his examples it did as well as B. |
| Stop | **A** the trigger day's low (Scot1and [S24]; UCT playbook; engine) <br> **B** the prior day's low (UCT playbook; Manrav KB 12088) <br> **C** the bottom of the pullback (Scot1and's outer limit [S24]; UCT playbook) | all yes | **A.** The originator's usual stop, and the tighter, better-behaved stop on his examples. |
| First trim | **A** trim into the next 3-5 day burst (UCT playbook KB 15877; Manrav KB 10985) <br> **B** sell a portion early, hold the rest on trendlines (Scot1and [S23]) | A yes (the size is his call; [S1] gives 1/3 to 1/2); B partly | **A**: stated by the house playbook and by Manrav. |
| Trail | **A** a close under the 21-day EMA (Manrav KB 13488) <br> **B** a close under the 8-day EMA (same note) <br> **C** trendlines (Scot1and [S23]) | A yes; B yes; C hard to compute | **A**, weakly: one annotated chart, not a stated rule. |
| Invalidation | **A** the trigger day's low breaks (= the stop; [S24]) <br> **B** the bottom of the pullback breaks ([S24]; UCT playbook) | both yes | **A.** No source names a separate "setup over" line. |

## 8. Conflicts and open questions for him

1. **The PEG link.** If the Slingshot is mostly the way into a PEG, should the lesson also show the gap day's low as a
   deeper line? No source says so.
2. **Close, intraday, or next day?** His definition makes the close the trigger; Manrav's slide wants a range break after
   it. Which does the lesson teach as the buy?
3. **The wide stop case.** Manrav's 9% example (KB 12088) is wider than his 3.5% Kicker cap. Should a cap apply here?
4. **Re-run the evidence** on the 16 kept examples, with the pullback measured from its real start.
