# Capture queue: Fred RS intraday breadth, beyond RDDT (2026-11-21)

Coordinator ruling 2026-11-20 (the owner's "do it all"). Fred RS's intraday evidence today is RDDT-centric (Q-L12, the
`l12-*` batches; the e85 / e86 live sweeps on RDDT). These rows grade Fred RS on 60 / 30 / 5 on three more symbols and a
short-history name, so the intraday verdict rests on more than one chart.

Same procedure as `docs/pine/capture-queue-2026-09-28.md`: capture from the listing where the chart reaches it, record
each capture's own `capturedAtUTC`, and record the supply our side reads beside each capture (SP:SPX at the chart's
timeframe and at D, the chart's own daily rows, the rating seed), as production serves it right after the capture.
Those supply records carry a vendor's or a store's bars: they are HELD (`store_held.py`: `supplyHeld`, the local held
directory), never committed. The script is Fred RS at its defaults (`docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`,
MPL-2.0, the committed source).

**When.**
- Rows a to d: FINISHED newest bars, on Saturday 2026-11-21 (no session, no forming bar).
- Row e: one row in REGULAR HOURS (Monday 2026-11-23, after the e87 sweep has served the tail-lag fix), where the
  newest 5-minute bar is forming and SP:SPX's newest bars can lag the chart's.

| id | probe | chart | question | live | phase |
|---|---|---|---|---|---|
| Q-FRED-INTRA-a | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` | AMEX:SPY 60, AMEX:SPY 30, AMEX:SPY 5 | an index ETF: the RS line, the rating label and the new-high dot on finished intraday bars | no | |
| Q-FRED-INTRA-b | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` | NYSE:ADT 60, NYSE:ADT 30, NYSE:ADT 5 | a stock whose daily NHDOT capture drew the dot: does the intraday run agree bar for bar? | no | |
| Q-FRED-INTRA-c | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` | NASDAQ:AZTA 60, NASDAQ:AZTA 30, NASDAQ:AZTA 5 | a long-history stock (daily from 1999): the intraday run on a symbol whose daily SPX differs most from TradingView's | no | |
| Q-FRED-INTRA-d | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` | NASDAQ:BGIN 60, NASDAQ:BGIN 30, NASDAQ:BGIN 5 | a short-history name (daily from 2025-10-21): the intraday picture where the daily drawing was withheld | no | |
| Q-FRED-INTRA-e | `docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine` | AMEX:SPY 5 | during regular hours, the newest 5-minute bar forming: is every reply drawn (the tail-lag wait), and does the newest bar's value match? | yes | insession |

**What each answer moves.**
- a to c MATCH (or MATCH_SUBSTITUTED with the SP:SPX supply attributed): Fred RS's intraday verdict holds beyond RDDT.
- d grades the short-history class intraday, beside the daily BGIN withhold under investigation.
- e is the in-session closing read of the 5m tail-lag fix on a second symbol.
