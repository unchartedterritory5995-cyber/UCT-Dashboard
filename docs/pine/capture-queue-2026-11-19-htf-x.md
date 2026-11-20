# Capture queue: htf-candle-footprint-cartel-console again, WITH the x table (2026-11-19)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`: capture from the listing, keep the plotted values as full
float64 text, and record each capture's own `capturedAtUTC`. The corpus file is the probe (`corpus`).

**Why.** Since the vendor harness grades a disclosed partial on what it draws (`compare.mjs::compareObjects`,
coordinator ruling 2026-11-19), htf-candle-footprint-cartel-console's committed captures (RDDT 2026-09-28, SPY
2026-10-03) grade `objects:partial-unpositioned`. Its 3 drawn body boxes pair with TradingView's and agree on every
field those captures hold (top, bottom, extend, border style / width / colour, background, text; its table and cells
too). But both captures predate the x table (`objects.xIndex`) and have no xmap sidecar, so WHERE the boxes sit
(left / right) has never been witnessed. The host lane keeps the script on its known-divergence list for that grade
(`tools/vendor_harness/host_divergence.py`, `UNPOSITIONED`): a withhold is never lifted on a field no capture witnessed.
Only a capture with the x table can lift it.

The `x table` column (`evidence_engine.py` `X_TABLE_HEAD`) keeps the two committed captures from answering these rows:
only a capture that records the x table does.

| id | probe | chart | question | live | phase | x table |
|---|---|---|---|---|---|---|
| Q-HTFX-1a | `corpus/committed/htf-candle-footprint-cartel-console__ca3ff4e904.pine` | NYSE:RDDT 1D from the listing | the boxes' left / right (x, through the recorded x table), beside every field the old capture held | no |  | yes |
| Q-HTFX-1b | `corpus/committed/htf-candle-footprint-cartel-console__ca3ff4e904.pine` | AMEX:SPY 1D from the listing | the same, on a second symbol | no |  | yes |

**What each answer moves.** A production re-grade of BOTH that reads `objects:partial` (each drawn box on the bar
TradingView draws it) lifts the script off `hostKnownDivergence.json` at the next `host_divergence.py --write`. One
that reads DIVERGE (a box on another bar) keeps it listed, now with a drawn difference named.
