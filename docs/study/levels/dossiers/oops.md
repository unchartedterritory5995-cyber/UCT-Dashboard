# Oops Reversal: levels dossier

For the owner's ruling. Nothing here ships. Terms: **R** = the risk on a trade (entry minus stop); "2R" = a gain twice
that risk. **EMA** = exponential moving average. **Breakeven stop** = moving the stop up to the entry price.

## 1. The setup, in his words

From the bank lesson (`docs/study/bank/spot.setups.json`, his rulings 2026-10-23/24): "Oops Reversal (scanner version):
opens below the prior close, trades under the prior day's low, then reverses and closes above the prior close." And:
"LOCATION is the main thing ... the Oops-day low must never break afterwards."

## 2. What he has already ruled

No entry, stop or sell rule yet. The nearest thing to a levels ruling is how he picks examples:
- "I want examples where the Low of day on the day of the oops does not break. For reference SHOP on 9/28 is a prime
  example" (log line 41, Oops pass 3, undated; his Oops rulings are dated 2026-10-23/24).
- "Ideally would want to see it follow through to the upside quicker" (log line 43, ANET, undated).

## 3. What the in-house traders do

**Entries**
- Manrav, 2024-07-30 (KB 11028): bullish Oops: go long once price retakes the prior day's close, with the day's low as
  the stop. Works best off inside and double-inside days.
- TSDR, 2025-07-29 (KB 13446) and 2025-06-26 (KB 11504): six steps: open under the prior close, undercut the prior low,
  reclaim the prior low, go red to green over the prior close, reclaim half the prior candle, take out the prior high.
  Steps 5-6 may come on later days. TSDR, 2025-09-22 (KB 11797): any of the trigger steps is a valid entry.
- TSDR, 2025-12-12 (KB 13582): his "Oops- Daily" scan is exactly the owner's version (open under the prior close, a low
  under the open and the prior low, a close over the prior close).
- Manrav, 2026-08-19 (KB 13825), and AtTheAsk, 2025-09-25 (KB 13285), the same slide: the Larry Williams Oops, with
  yesterday's low as the pivot; enter as price bursts back through it. Manrav says he is "flexible with the setup".
- Manrav, 2025-10-05 (KB 11964): takes the Oops on the day without watching intraday charts, but only on a chart with
  structure.
- AmeetRai, X post (KB 16457): take the reclaim of the prior low quickly, or wait for the opening-range break.

**Stops**
- Manrav, 2024-10-29 (KB 15726): stop at the low of the day.
- TSDR, 2026-10-05 (KB 12976): stop at the low of the day or below the pivot candle.
- Manrav, 2025-10-05 (KB 11964): "the prior day's low as the stop". Unclear: if he buys the next morning, that is the
  Oops day's own low; if he buys on the Oops day, it is a higher level that price has already broken.

**Trims, adds, trails**
- Manrav, 2025-05-22 (KB 11386): a swing trader always trims into strength.
- TSDR, 2026-09-01 (KB 12887): he would rather buy an Oops on BE (the ticker), make 8% in a day and sell at
  breakeven 4 days later, for the chance of a 40-80% move. TSDR, 2024-12-13 (KB 14619): always leave one share and set a breakeven stop.
- TSDR, 2026-04-29 (KB 12543): his recipe is hammers, Oops, relative strength, a good market, "then trailing your MAs".
  TSDR, 2026-04-29 (KB 12545): trail at the previous candle's low until there is cushion (said on an "EP", an
  episodic-pivot news-gap chart).
- Manrav, 2024-10-06 (KB 11169): once the 21 EMA rises above your entry, treat it as a position trade. Adds: an Oops on
  the daily as an add point (KB 11169; RBLX "oops, add here", 2025-09-15, KB 13488).

**Disagreements.** Williams' version (open under the prior LOW, buy back through it) versus his and TSDR's (open under
the prior close, close over it). Manrav uses the Williams pivot but calls himself flexible. On the stop, all name the
Oops day's low except Manrav's ambiguous "prior day's low".

## 4. The brain's template ("Oops Reversal")

- Entry: the six-step sequence above; or red to green on a gap-down day; or a break of the prior day's high that lines up
  with a reclaim of the 9/20 EMAs.
- Stop: below the Oops candle's low or the support that set it up. No maximum given. Move to breakeven once in profit
  (Bracco: "stop is breakeven").
- Targets: half of the prior candle first, then the prior candle's high. Under his definition the Oops already closes
  above the prior close, and a "Super Oops" above the prior high, so these targets are often hit on the Oops day itself.
- Invalidation: price breaks the Oops low again; it never reclaims the prior low; a strong downtrend or RED market.
- Hold: hours to days on a daily Oops. Mistakes: buying before the reclaim; not moving the stop to breakeven.
- Also matched: "Red to Green" (stop at the day's low, max 8%, trail the 20 EMA) and "Go Signal" (he ruled the Go Signal a
  separate hourly setup on 2026-10-27, so it is left out here).

## 5. Outside research (`external_research.md`)

- His Oops is not Williams' Oops. Williams needs the open under the prior LOW and buys as price rallies back through it,
  with no close condition; his own "Williams Oops" sub-variant matches it [S2, study/backtest citing the originator].
- Moglen (TraderLion): stop at the day's low, often under 2% risk; after a push of about 3% he raises the stop to just
  under the pivot [S5, reputable educator, excerpt only].
- Williams' famous win rate comes mostly from his exit, the first profitable open. Exiting at the same day's close, one
  stock's Oops was "basically random" [S3, study/backtest]. Out of sample the win rate fell from 88% to 58.9% [S2].
- No swing-length trim or trail rule was found for the Oops.

## 6. How the candidates did on his own examples (`evidence.md`)

| entry | stop | n | risk | stop hit | 1R | 2R | 3R | best R | +20 sessions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| buy stop at the prior close (engine, template) | the Oops day's low (engine, template) | 36 | 2.0% | 53% | 97% | 94% | 86% | 11.1 | +20.1% |
| buy stop at the prior close (engine, template) | Oops low, at most 3.5% | 36 | 2.0% | 53% | 100% | 97% | 86% | 11.1 | +20.1% |
| the Oops day's close | the Oops day's low (engine, template) | 36 | 5.6% | 53% | 72% | 58% | 47% | 2.5 | +12.5% |
| the Oops day's close | Oops low, at most 3.5% | 36 | 3.5% | 67% | 61% | 56% | 50% | 3.1 | +16.1% |

"Stop hit" = the first stop was hit at some point in 60 sessions, even after a gain (nothing trails yet).

What this shows:
- Buying as price reclaims the prior close, with the stop at the Oops low, risks a median 2.0% and reached 2R on 94% of
  his examples. The 3.5% cap changes almost nothing: these stops are already small.
- Waiting for the close nearly triples the risk (5.6%) and cuts the 2R rate to 58%.
- About half (53%) later fell back to the Oops low within 60 sessions. A sell rule decides whether that matters.
- Limits. His examples were picked so the Oops-day low did NOT break on the forward strip (log line 41) and so each
  "worked" (log line 23). The Oops-low stop therefore looks good partly by construction. Of the 36 replayed he kept 26
  and cut 10 (all 36 were used). Daily bars cannot show whether price dipped again after the buy filled at the prior
  close; the replay does not check the stop on the fill day. Williams' entry (back through the prior low) was not
  replayed.

## 7. The decisions for him

| line | options (source) | from daily bars? | recommended default, for his decision |
|---|---|---|---|
| Entry | **A** buy order at the prior close, filled as price reclaims it on the Oops day (Manrav KB 11028; TSDR KB 13446, KB 13582; engine; template) <br> **B** buy as price trades back up through the prior day's low (Williams via [S2]; Manrav KB 13825; AtTheAsk KB 13285; [S5]) <br> **C** the Oops day's close | all yes | **A.** The reclaim of the prior close is the moment his Oops becomes true, Manrav names it, and it is the best evidence row. B fires before his definition is met. |
| Stop | **A** the Oops day's low (Manrav KB 15726, KB 11028; TSDR KB 12976; template; [S5]) <br> **B** the prior day's low (Manrav KB 11964, wording unclear) <br> **C** the Oops low, capped at 3.5% (his Kicker cap, borrowed; no Oops source) | all yes | **A.** Every in-house trader names it, his own example rule is that this low must hold, and the median risk is 2.0%. |
| First trim | **A** trim into strength after 3-5 days and move the stop to breakeven (Manrav KB 11386; TSDR KB 12887, KB 14619; [S1]) <br> **B** at the prior candle's high (template) <br> **C** Williams' first profitable open ([S3]; index futures) | A yes; B yes; C yes | **A.** B is often reached on the Oops day itself; C is a futures day-trade exit. |
| Trail | **A** a close under the 20-day EMA (Red to Green template; TSDR KB 12543) <br> **B** under each previous candle's low until there is cushion (TSDR KB 12545) <br> **C** hold as a position once the 21 EMA rises above entry (Manrav KB 11169) | all yes | **A**, the most-cited swing trail; B is a short-term variant. |
| Invalidation | **A** the Oops day's low breaks (his lesson text; template) <br> **B** a close back under the prior close after triggering (Red to Green template) | all yes | **A**: his own words, "the Oops-day low must never break afterwards". |

## 8. Conflicts and open questions for him

1. **Williams or scanner?** The lesson teaches both versions. Should the entry differ for his "Williams Oops" (buy back
   through the prior low) and his scanner version (buy the reclaim of the prior close)?
2. **Intraday trigger, daily confirmation.** Entry A fills during the day, before the close confirms his definition. If
   price then fails back under the prior close, the trade is on but the setup never formed. Daily bars cannot show this.
   Should the lesson say "the close must confirm, or get out"?
3. **Manrav's "prior day's low"** (KB 11964): worth asking Manrav what he meant.
4. **Selection effect.** Because his examples were chosen for a low that held, the evidence cannot test this stop.
   Re-running on unselected Oops days would.
