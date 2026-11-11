# Bear gap off the highs (a SHORT): levels dossier

For the owner's ruling. Nothing here ships. This is a short: you sell first and buy back later, so the entry is UNDER a
low and the stop is OVER a high. Terms: **R** = the risk (stop minus entry, for a short); "2R" = a gain twice that risk.
**Gap day** = the day that gaps down. **Gap-fill level** = the prior day's low, the top of the gap. **Cover** = buy back.

## 1. The setup, in his words

From the bank lesson (`docs/study/bank/spot.bear_gaps.json`): "Bear Gap off the Highs: the first true gap down since a
recent top, marked on the gap day itself. It is not Gap Support (a gap up that is later tested) and not a gap inside a
downtrend."

## 2. What he has already ruled

No entry, stop or cover rule. What he has said about the setup itself:
- "Don’t want to do downtrend gaps but will do bear gaps off the highs" (log lines 212 and 216, universe rule 2026-10-27).
- On the first draft examples (sitting of 2026-10-31): "This is more of just an earnings breakdown" (PRIM); "Same more of
  just an earnings breakdown" (CXM); "More of just an earnings breakdown" (MTZ); "Okay this is stupid" (NFLX 2022-01-21,
  the example the finder was built from). One kept: MPWR 2024-10-31, "Good".
- The log records the sitting paused after 8 of 39, and the finder to be rebuilt from one or two of his own charts
  (log lines 293 and 297).

## 3. What the in-house traders do

**Nothing in the knowledge base shorts this setup.** What they say about bear gaps, and about shorting in general:
- Manrav, 2025-03-24 (KB 11083): until a stock reclaims its bearish gap, that gap acts as resistance; unfilled gaps show
  who is in control. Manrav, 2024-04-03 (KB 15418): CRM tagged a bearish gap "to the dot" and was sharply rejected.
- TSDR uses a bear gap overhead as the first trim spot on a LONG: TEM, 2025-01-30 (KB 10001); COHR, 2026-02-19 (KB 10316),
  trim a third there and set the stop at breakeven.
- Short mechanics, from other setups:
  - Manrav, 2024-07-30 (KB 11028): a bearish Oops: short once price drops below the inside day's close, with the day's
    high as the stop.
  - Bracco, 2025-02-19 (KB 10975): a parabolic short: short a break of the opening-range low, add at the opening-range
    low or low of day, target the daily 9 EMA.
  - Bracco, 2024-05-09 (KB 11153): wait for one candle to hold, then short the break of that candle's low, stop above
    its high.
  - Bracco, 2024-05-08 (KB 11151): after a blow-off, low-volume drifting higher was a trap for longs before another leg
    lower.
  - TSDR desk log, 2024-10-20 (KB 9908): a weekly "bearish launchpad" short under $232.10, targets $220 and $213,
    invalidated by a move above the daily 50-day SMA.
- Cautions: Manrav, 2026-09-03 (KB 15695): new traders should stop hunting shorts and train their eyes on longs. TSDR,
  2025-07-29 (KB 11609): "shorting stocks in a mega bull market, must hate money".

## 4. The brain's template

None. The brain has no template for this setup (levels `README.md`).

## 5. Outside research (`external_research.md`)

- No published short rule set for exactly this setup was found. O'Neil treats a stock's "greatest one-day price drop since
  the beginning of the move" as a sell signal for longs [S32, reputable educator citing the originator, excerpt only].
- Short mechanics from a different setup (Qullamaggie's parabolic short): short the opening-range low; stop at the high
  of the day; cover at the 10- and 20-day averages; do not short too early [S1, originator].
- Bulkowski, for 15%+ gap-downs: short near the top of the later bounce, not on the gap day. After such drops the low
  comes about 7 days later (31% under the prior close on average), then a bounce of about 28% over about 23 days (22%
  close the gap), then a further 30% average decline [S35, study/backtest].
- Only 1% of downward breakaway gaps close within a week [S15, study/backtest].

## 6. How the candidates did on the bank's examples (`evidence.md`)

| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| short the gap day's close | over the gap day's high | 39 | 9.0% | 67% | 49% | 33% | 23% | 1.0 | +10.6% |
| short the gap day's close | over the gap-fill level (the prior day's low) | 39 | 26.8% | 10% | 23% | 3% | 0% | 0.6 | -0.0% |
| next day under the gap day's low | over the gap day's high | 19 | 11.9% | 53% | 58% | 26% | 11% | 1.2 | +8.7% |
| next day under the gap day's low | over the gap-fill level (the prior day's low) | 19 | 26.1% | 11% | 26% | 0% | 0% | 0.7 | +0.6% |

"Stop hit" = the first stop was hit at some point in 60 sessions. "+20 sessions" is the short's result (a plus means
price fell).

What this shows, with a large warning:
- **These are not his examples.** The 39 are a first-draft finder's picks: he saw 8, cut 7 (three by name as "earnings
  breakdowns") and kept 1; 31 were never shown. The log calls the whole draft set "earnings collapses straight off a
  top" that miss the lesson (line 293). The numbers describe the setup he rejected.
- Even so: stops over the gap day's high are wide (9.0-11.9%) and are hit on 53-67%; only about half reach 1R. The
  gap-fill stop is so far away (26-27%) that almost nothing reaches 2R. Big gap-down days have very wide ranges.
- Limits as for the other setups: daily bars cannot order the moves inside a day.

## 7. The decisions for him

| line | options (source) | from daily bars? | recommended default, for his decision |
|---|---|---|---|
| Entry | **A** next day, a sell order 1 cent under the gap day's low (evidence; the short mirror of his Kicker trigger; Manrav's short under a level, KB 11028) <br> **B** short the gap day's close (evidence) <br> **C** wait for the bounce, then short the break of a holding candle's low (Bracco KB 11153; Bulkowski [S35]; [S1]'s "not too early") | A yes; B yes; C partly (needs a bounce rule) | **A, as a placeholder only.** Weak: no source shorts this setup, and the evidence is on rejected examples. Hold until his charts arrive. |
| Stop | **A** over the gap day's high (evidence; Qullamaggie's high-of-day stop [S1]; Manrav KB 11028) <br> **B** over the gap-fill level, the prior day's low (evidence) <br> **C** with entry C, over the bounce candle's high (Bracco KB 11153) | all yes | **A**, weakly: the only replayed stop with a usable size, and the in-house and outside short mechanics both use the day's high. |
| First cover | Sources silent for this setup. Nearest: cover at the 10/20-day averages ([S1], parabolic short); target the daily 9 EMA (Bracco KB 10975) | yes, if one is chosen | **No default.** The sources do not cover it. |
| Trail | Sources silent for this setup. | n/a | **No default.** |
| Invalidation | **A** the gap is reclaimed: a close back above the prior day's low (Manrav KB 11083: a bear gap is resistance until reclaimed) <br> **B** a move back above the daily 50-day SMA (TSDR KB 9908, on a different short) | both yes | **A**: Manrav's own reading of a bear gap. |

## 8. Conflicts and open questions for him

1. **What he means is not pinned down.** He called the founding example "stupid" and cut most of what he saw. The finder
   waits on one or two of his own charts. Every line above waits on that.
2. **Is it a short?** The log describes it as a lesson in "gap resistance / failed gap" (log line 216), and the
   in-house traders use bear gaps as resistance and as trim spots on longs. This dossier treats it as a short, as asked.
   He should confirm the lesson's purpose.
3. **Should members be taught to short this at all?** Manrav and TSDR both warn newer traders off shorts.
4. **Gap day or bounce?** His definition marks the gap day; the outside sources say short the later bounce.
