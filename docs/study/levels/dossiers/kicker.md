# Kicker: levels dossier

For the owner's ruling. Nothing here ships. Terms used below: **R** = the risk on a trade (entry minus stop); "2R" means a
gain twice that risk. **ORB** (opening-range breakout) = buying when price rises above the high of the first minutes of
the session (here, the first 30 minutes). **EMA** = exponential moving average (a smoothed average of recent closes).

## 1. The setup, in his words

From the bank lesson (`docs/study/bank/spot.setups.json`, his rulings 2026-10-23/24): "the day before closes red and WEAK
near its low, an almost-failed breakdown with a real body (about 1-5% of price); then the next day gaps up and follows
through with a strong green candle that closes above the red day's high and near its own high, usually on a volume surge.
The sellers from the red day are trapped."

## 2. What he has already ruled

Entry and stop are ruled. Sell rules are deferred by him. All from `owner_verdicts.jsonl`, 2026-11-02:

- "In terms of entry, on a kicker you can buy the opening range break (ORB), or the break of previous day high."
- "entry and stop is not proper. Should be over previous day high or on day 1 kciker ORB on the 30 minute."
- "The entry is supposed to trigger OVER previous day high not at mkt close!"
- "And for the entry man, the entry should 11.05 over THE previous day high. or on DAY 1 of the kciker candle on a 30 min ORB"
  (11.05 is the JBI 2023-12-14 example: a buy order 1 cent over the red day's high, per `docs/study/bank/levels.kicker.json`.)
- Stop: "Under the kicker candle low or entry with a 3.5% stop but we should get these with smaller than 3.5% stop usually"
- Sell rules: "can pause here and ask about trimming and trailing and some sell rules. DOnt need to go 20 sessions out.
  We can work on those sell rules later though because its complivated."
- On the red day (log line 39, Kicker pass 3, undated): "Sellers need to be trapped, so there needs to be like an almost
  failed breakdown vs just a little baby red candle."

So: "previous day" is the red day, and both entries happen on the Kicker day itself. The stop is read as the Kicker's
low when that is within 3.5% of the entry, otherwise 3.5% under the entry (the reading built into `levels.kicker.json`).

## 3. What the in-house traders do

**Entries**
- Manrav, 2025-01-29 (KB 10927): adds two conditions to Bracco's Kicker definition: a close under the 21 EMA the day before,
  and a gap up ABOVE the previous day's high, which he says works better.
- Bracco, 2025-01-29 (KB 10914): an "Oops-style" trap entry from Kell's book: weak close near the low, gap up, then the
  break of the prior day's high puts the sellers offside.
- TSDR desk logs: ARKK "above yest highs, full on Kicker Candle" 2025-06-06 (KB 10110); BBAI watched over yesterday's
  high 2025-08-08 (KB 10158); CEP: a gap over $40, a break of the opening range, then of the previous day's high,
  2025-06-09 (KB 10111). These are the two entries he named.
- TSDR, 2026-01-23 (KB 12294): RDW held its gap and ran from the opening range. A slower intraday entry: a small undercut
  and reclaim of VWAP (the day's volume-weighted average price; intraday only).
- Kell, in the TSDR framework notes, undated (KB 1984): "Method 2": wait for a brief tight pause above the Kicker, buy
  the next push. Tighter stop, more confirmation.
- Bracco, Sunday Scans 2026-02-21 (KB 4415): RIVN Kicker, then an hourly flag breakout, entry $18.8.
- Manrav, 2024-05-22 (KB 10943): ENPH after the gap "became a chase"; wait for a pullback.

**Stops**
- Manrav, 2025-10-13 (KB 15689): UMC, a textbook Kicker, with the 8/21 EMA as the stop.
- TSDR desk log, 2024-11-06 (KB 9923): with a Kicker you could risk to the daily short-term averages.
- No in-house passage names the Kicker candle's low as the stop. Bracco's CRCL buy at $134 (KB 5727) states no stop.

**Trims, adds, trails**
- TSDR, 2025-10-01 (KB 11868): scale out some of the initial risk into the 3-5 day push, then trail the averages as they
  rise up through your entry. (Said on MDB, which he would not call a Kicker.)
- Adds: Bracco, Sunday Scans 2026-02-21 (KB 3206), calls a Kicker followed by an hourly flag breakout a high-conviction
  entry; the template turns that hourly breakout into the add.

**Invalidation**
- Bracco, Sunday Scans 2025-09-14 (KB 6007): his ARKK Kicker position was stopped out by a bearish engulfing candle
  (a red candle that covers the whole prior candle).

**Disagreements.** Stop: Manrav and TSDR risk to the short-term averages; he rules the Kicker low; the template uses the
red day's low. Earnings: TSDR, 2026-05-08 (KB 12584), calls his own entry tactic "a kicker candle on earnings"; his
definition says a Kicker is rarely an earnings day.

## 4. The brain's template ("Kicker Candle")

The template counts the red day as "Day 1" and the Kicker as "Day 2".
- Entry: buy on the Kicker day as the gap holds, typically 9:45-10:00 AM, through the opening-range highs. Or: a tight
  pause after the Kicker, then the next push; or an hourly flag breakout.
- Stop: below the red day's low, or below the Kicker's open (the gap level). Max stop 8%.
- First target: prior resistance. Partial profits when price stretches far above the 9 EMA.
- Trail: the 9 EMA. A bearish engulfing candle after entry can stop you out.
- Invalidation: the Kicker's gap fills; loss of the red day's low; a gap on low volume.
- Hold: days to weeks. Mistake listed: buying the open before 9:45 risks a gap fill.

## 5. Outside research (`external_research.md`)

- Nothing published names a 30-minute opening range. Qullamaggie buys the opening-range high of the first 1-, 5- or
  60-minute candle, with the stop at the day's low, no wider than the stock's average daily range [S1, originator].
- His 3.5% cap sits between Kell's 1-2% initial risk [S9, originator] and O'Neil's 7-8% outer limit [S31, originator].
- Trim and trail (not Kicker-specific): Qullamaggie, "sell 1/3 to 1/2 of the position after 3-5 days", then stop to
  breakeven, trail the rest on the 10- or 20-day average [S1, originator].
- Bulkowski's "near random" kicking statistic is for a stricter candle and should not be attached to his Kicker [S11,
  study/backtest].

## 6. How the candidates did on his own examples (`evidence.md`)

| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| over the red day's high (his ruling) | the Kicker day's low (his ruling) | 37 | 1.7% | 57% | 100% | 97% | 95% | 14.8 | +16.0% |
| over the red day's high (his ruling) | the red day's low | 37 | 4.8% | 38% | 97% | 86% | 73% | 4.6 | +14.8% |
| over the red day's high (his ruling) | Kicker low, at most 3.5% (his ruling) | 37 | 1.7% | 59% | 97% | 92% | 92% | 14.8 | +16.0% |
| the Kicker day's close | the Kicker day's low (his ruling) | 37 | 5.7% | 57% | 81% | 59% | 49% | 2.9 | +12.1% |
| the Kicker day's close | the red day's low | 37 | 8.8% | 38% | 76% | 46% | 27% | 1.9 | +10.8% |
| the Kicker day's close | Kicker low, at most 3.5% (his ruling) | 37 | 3.5% | 62% | 73% | 62% | 51% | 3.0 | +13.2% |

"Stop hit" = the first stop was hit at some point in 60 sessions, even after a gain (nothing trails yet).

What this shows:
- His ruled pair is tight (median risk 1.7%) and reached 2R before the stop on 97% of the examples. But 57% later fell back
  to that stop within 60 sessions: without a sell rule, more than half gave the whole gain back. That is the case for
  sell rules.
- The close entry he rejected is worse on every R column. The red day's low stop is hit less often but costs 4.8% (above
  his cap) and fewer trades reach 3R.
- Limits. These are chosen textbook charts, and the scan that proposed them had to "WORK": no close under the setup
  day's low within 20 sessions and a gain of about 8-10% (log line 23). So a stop at the Kicker's own low looks good
  partly by construction. By the verdict log, of the 37 replayed he kept 16, cut 11 (two earnings gappers, three plain
  breakouts, six others) and 10 have no verdict; the replay used all 37. On a Kicker that gaps over the red day's high,
  the buy order fills at the open, and the 1R count includes the Kicker day's own high, which is why 1R is near 100%.
  The ORB entry cannot be replayed: there are no intraday bars for these dates.
- On the 16 kept Kickers (`levels.kicker.json`), the Kicker-low stop was 0.41% to 2.94% under the fill on 15; only HOOD
  2024-05-17 needed the 3.5% cap. That matches "smaller than 3.5% stop usually".

## 7. The decisions for him

| line | options (source) | from daily bars? | recommended default, for his decision |
|---|---|---|---|
| Entry | **A** buy 1 cent over the red day's high, on the Kicker day (his ruling; Manrav KB 10927; Bracco KB 10914; TSDR KB 10110) <br> **B** break of the Kicker day's first-30-minute high (his ruling; template; TSDR KB 10111) <br> **C** tight pause after the Kicker, buy the next push (Kell KB 1984; template) | A yes; B no (name it, cannot draw it); C partly | **Ruled: A drawn on the chart, B named in the lesson.** His words; A is the one the bars can draw, and it is evidence row 1. |
| Stop | **A** the Kicker's low if within 3.5% of entry, else 3.5% under entry (his ruling) <br> **B** the red day's low (template) <br> **C** under the 8/21 EMA (Manrav KB 15689; TSDR KB 9923) | all yes | **Ruled: A.** 15 of his 16 kept Kickers fit inside 3.5% without the cap. |
| First trim | **A** sell 1/3 to 1/2 after 3-5 days, stop to breakeven ([S1]; TSDR KB 11868) <br> **B** into prior resistance (template) <br> **C** into a stretch above the 9 EMA (template; no size given) | A yes; B needs a resistance rule; C needs a number | **A**, for the sell-rules sitting he deferred: the only trim stated by both an in-house trader and an outside originator. |
| Trail | **A** a close under the 9 EMA (template) <br> **B** a close under the 20-day EMA (TSDR KB 14268, KB 10252; Kell [S9]) <br> **C** a close under the 10-day average (Qullamaggie [S1]) | all yes | **B**, the trail most often named by the in-house traders; A is the tighter option the template gives. |
| Invalidation | **A** a trade under the Kicker's low (= his stop) <br> **B** the Kicker's gap fills (template; the level is not defined there) <br> **C** a bearish engulfing candle the next session (Bracco KB 6007; template) | all yes | **A**: it is his ruled stop, so one line means both "out" and "setup over". |

## 8. Conflicts and open questions for him

1. **Day numbering.** His words call the Kicker "DAY 1". The template, `external_research.md` and the levels `README.md`
   count the red day as day 1, so they say "day-2 ORB". It is the same session; the lesson should use his numbering.
2. **Which 30 minutes?** The workbench drew the ORB as the first regular 30-minute bar (9:30-10:00 ET; `docs/study/RESUME.md`,
   round 4). That is a working reading, not his words. The template says 9:45-10:00. Confirm.
3. **Fill at the open.** When the Kicker gaps above the red day's high (Manrav's preferred version), the buy order fills
   at the open. Is that what he means, or should the lesson wait for the ORB in that case?
4. **The 3.5% cap.** When it applies, the stop sits inside the Kicker day's own range and could be hit the same day.
   Daily bars cannot tell. Should such Kickers be flagged "prefer the ORB" in the lesson?
5. **Earnings.** TSDR's favourite Kicker is an earnings day (KB 12584); his definition says rarely. Recommendation: keep his.
6. **Re-run the evidence** on the 16 kept Kickers only before he relies on the numbers.
