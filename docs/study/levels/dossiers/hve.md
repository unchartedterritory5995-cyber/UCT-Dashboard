# High Volume Edge: levels dossier

For the owner's ruling. Nothing here ships. Terms: **R** = the risk on a trade (entry minus stop); "2R" = a gain twice
that risk. **HVE day** = the record-volume day. **HVE close / HVC** = that day's closing price, the level he marks.
**EMA** = exponential moving average.

## 1. The setup, in his words

From the bank lesson (`docs/study/bank/spot.setups.json`, his rulings 2026-10-23/25): "an up day on a volume that DWARFS
everything before it, ten times normal and above the prior record, often on a lesser-known name, the start of a new
story ... That day's close is a LEVEL to mark on the chart, the price the biggest participants committed at; price may
trade under it later."

## 2. What he has already ruled

No entry, stop or sell rule yet. His words that bear on the levels:
- "No. Btw, they can go below the HVC that is fine. It is meant to be a major level to mark out on your chart. Again NAVN
  from earlier this year is a good example" (log line 124, CVX, HVE pass 2, undated). The log adds that the "must work"
  rule used to pick examples does not apply to HVE.
- "Just a PEG and HVC. Not a real HVE" (log line 130, RL, undated): an HVE is not any high-volume close.

## 3. What the in-house traders do

**Entries (all after the HVE day, against its close)**
- Manrav, 2024-07-27 (KB 11027): high-volume closes, above all highest-volume-ever candles, are major pivots for entries
  and exits. If day 2 opens above the HVE close, it is a buy with that close as the stop. Give it some room for an
  undercut (his example: a $4 entry with a $3.75 stop). A close near the day's high makes the pivot stronger.
- Manrav, 2025-08-18 (KB 15651): high-volume closes do not always follow through at once, but the HVE close is "a good
  level to risk against". Manrav, 2025-09-15 (KB 11820): study it bar by bar; some act right away, some give delayed
  entries.
- TSDR desk log, 2025-05-22 (KB 10097): on day 2 after earnings, a red-to-green move through the HVC at $10.42: entry
  $10.45, risk to the day-2 low ($9.83), stop a few cents under at $9.80.
- TSDR desk log, 2025-05-13 (KB 10089): OSCR reclaiming 17, its earnings HVC, with 16.20 as the stop.
- TSDR, 2026-01-14 (KB 12270), passing on Ameet Rai: AEVA pulled back to its HVE level for two sessions, held, then ran
  from $15 to $20, a setup "worth sizing into".
- TSDR, Sunday Scans 2025-07-27 (KB 7512): BE's earnings gap down was bought at the HVC ($33.7); he would add with a stop
  under the earnings low.

**Trims, adds, trails**
- TSDR desk log, 2025-08-26 (KB 10171): trimmed part of WULF into its day-3 move while it held the HVE spot; on CIFR,
  trim into strength, then trail the rest. He takes 1-2% losses and lets winners run.
- TSDR desk log, 2025-07-26 (KB 10146): COUR's HVE: planning a breakeven stop.
- Bracco, Sunday Scans 2025-09-07 (KB 7057): WULF held the HVC for several sessions and built a tight flag; "let 20EMA
  guide the position". TSDR desk log, 2025-11-29 (KB 10252): after the trigger, trail the 20 EMA as long as it allows.

**Disagreements.** Manrav's stop is the HVE close; TSDR's is the entry day's low; the engine's is the HVE day's low. And
his own words say price may go below the HVE close, which a stop exactly at that close would not allow.

## 4. The brain's template ("HVC")

The brain has no HVE template. Its "HVC" template is the nearest, though he rules that an HVC and an HVE are different.
- Entry: price takes out the HVC level on volume; or an undercut and reclaim of the HVC; or a tight inside day just under
  it, then the breakout.
- Stop: below the HVC level, below the earnings-gap low, or below a key support. No maximum.
- Trail: under the higher lows; move the stop up to the HVC once price is well above it.
- First target: the next resistance above.
- Invalidation: a close back below the HVC that is not reclaimed; loss of the gap-up low or base low.
- Mistakes: entering before the HVC is taken out; chasing once far above it; a still-falling 200-day SMA.

## 5. Outside research (`external_research.md`)

- TraderLion (the apparent source of the name): on day 2, after price holds a whole number and the "volume support" zone,
  enter as it moves back above the prior day's close, the HVC [S21, reputable educator; the full post came from search
  results].
- TraderLion: stop below the day-1 volume support or the day-1 low; one article also says exit on a close below the HVC
  [S21, excerpt only].
- Gervais, Kaniel and Mingelgrin (2001): unusually high-volume days were followed by higher returns over the next month
  [S22, study]. Their threshold is the top 10% of 50 days, far milder than his 10x record; it says nothing about the
  close holding as a level.
- No published statistic was found for an HVC acting as support.

## 6. How the candidates did on his own examples (`evidence.md`)

| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| the HVE day's close (engine) | the HVE day's low (engine) | 56 | 9.1% | 43% | 84% | 66% | 52% | 3.7 | +14.8% |
| the HVE day's close (engine) | HVE low, at most 3.5% | 56 | 3.5% | 75% | 82% | 66% | 61% | 4.5 | +14.8% |
| next day over the HVE day's high | the HVE day's low (engine) | 38 | 12.1% | 45% | 84% | 50% | 37% | 2.1 | +15.4% |
| next day over the HVE day's high | HVE low, at most 3.5% | 38 | 3.5% | 74% | 82% | 66% | 53% | 3.2 | +16.0% |

"Stop hit" = the first stop was hit at some point in 60 sessions, even after a gain (nothing trails yet).

What this shows:
- The HVE day's own low is a wide stop: a median 9.1%, and 12.1% from the next-day entry. That is above the 8% maximum in
  most of the brain's templates and O'Neil's 7-8% limit [S31].
- Capping it at 3.5% makes the risk small, but 74-75% of those stops are hit. That fits his words: price may trade
  back under the HVE close.
- Buying over the HVE day's high the next day does worse than the close (2R on 50% vs 66%).
- Limits. Chosen charts, but HVE examples were exempt from the "must work" rule (log line 124), so there is less built-in
  bias than for the other setups. Of the 56 replayed he kept 19, cut 16 (six of them as "just a PEG" or a plain HVC),
  and 21 have no verdict. **The entries the in-house traders actually use (day 2 over the HVE close; stop at the HVE close or the day-2 low) were
  not replayed.** That is the biggest gap in this dossier.

## 7. The decisions for him

| line | options (source) | from daily bars? | recommended default, for his decision |
|---|---|---|---|
| Entry | **A** on day 2 or later, buy as price trades above the HVE close (Manrav KB 11027; TSDR KB 10097; TraderLion [S21]; template) <br> **B** the HVE day's close (engine) <br> **C** next day over the HVE day's high | all yes (A fills at the open if it opens above the close, else at the close level) | **A.** Every in-house trader and the outside match buy after the event, against the close he marks. Not yet replayed. |
| Stop | **A** the entry day's low (TSDR KB 10097) <br> **B** under the HVE close, with room for an undercut (Manrav KB 11027; template) <br> **C** the HVE day's low (engine; 9.1-12.1%) <br> **D** C capped at 3.5% (his Kicker cap, borrowed) | all yes; B needs a size for the "room" | **A, but never above the HVE close** (a combination of TSDR's rule and Manrav's level, so a test of the close does not stop you out). Weak support; not replayed. |
| First trim | **A** a third into the first 3-5 day push, stop to breakeven (TSDR KB 10171, KB 10146; [S1]) <br> **B** the next resistance above (template) | A yes; B needs a resistance rule | **A**, the only HVE trim in the in-house notes. |
| Trail | **A** a close under the 20-day EMA (Bracco KB 7057; TSDR KB 10252) <br> **B** raise the stop to the HVE close once well above it (template) | both yes | **A**: two in-house traders, the same average. |
| Invalidation | **A** a close under the HVE close that is not reclaimed (template; [S21]) <br> **B** a break of the HVE day's low (the engine's stop line) <br> **C** none beyond the stop, since he says price may go under the close | all yes | **B.** He says price may go under the close; a break of the whole HVE day is the clearest sign the event has failed. Weak: no source states B as an invalidation. |

## 8. Conflicts and open questions for him

1. **Setup or level?** His words make the HVE a level to mark. Should the lesson teach a fixed entry, or "where to risk
   against" whenever price comes back to the level (the AEVA pattern, KB 12270)?
2. **The stop at the HVE close.** Manrav risks against the close; his own words allow trading under it. How much room?
3. **HVC template.** The brain's only template is for an HVC, which he rules is a different, more common thing.
4. **Replay the day-2 rules** (Manrav's and TSDR's) on the 19 kept examples before ruling. They are computable from daily
   bars.
