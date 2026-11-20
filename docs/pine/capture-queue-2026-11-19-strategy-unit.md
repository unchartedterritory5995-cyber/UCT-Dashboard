# Capture queue: the strategy unit (2026-11-19)

Evidence: `docs/pine/evidence/2026-11-19-strategy-unit/EVIDENCE.md`. Branch `feat/strategy-unit`.

`strategy-decl` is admitted (2026-11-18, #1859): admission is no longer the wall. A member's strategy backtest is
served only where every broker rule it reaches is pinned (`brokerPins.resolved.json`) by a committed TradingView
report capture that grades MATCH, and only on a chart whose history starts at the symbol's listing ([B-START],
`vm.js`, Q-S1n). The rows below are the captures that unlock the most strategies next, community scripts first
(`corpus/committed`, MPL-2.0, so the capture and its source are committed).

Rules for every row:
- tool v3 strategy capture (`tools/vendor_harness/tv_capture.js`, `__uctVH.capture({..., gradeMethod: 'a'})`) WITH the
  Strategy Tester report read (`provenance.report`: the `_reportData` tree, its `trades` and `filledOrders`), the
  Properties read-back (`provenance.strategySettings`), every plot, and the drawn texts. `verify_capture.mjs` refuses
  one without them.
- Inputs and Properties at the script's own defaults: never touch the Properties tab. A read-back that disagrees with
  the source is INCONCLUSIVE.
- From the listing (`startsAtBar0` asserted), except section B, which asks exactly what a deeper chart does.
- On a CLOSED newest bar (after the close or before the open): none of these rows asks for a session in progress.
- **Re-takes, by hand.** Q-SU-1, Q-SU-4, Q-SU-5, Q-SU-7 and Q-SU-STOP-a share their source and chart with a committed
  capture that holds no Strategy Tester report (or, for Q-SU-STOP-a, the very capture being re-asked). The derived
  queue (`evidence_engine.py queue`) counts a target CAPTURED by source sha and chart, so those five read CAPTURED
  there and are taken by hand from this table, as Q-SD1 was (`capture-queue-2026-11-17-strategy-decl.md`). The other
  five read QUEUED.

## A. Community strategies on a chart from its listing

| id | probe | chart | live | what to record | settles | unblocks |
|---|---|---|---|---|---|---|
| Q-SU-1 | `corpus/committed/macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99.pine` | NYSE:RDDT 1D | no | the report, every trade and fill, every plot | a second, closed-bar witness of B-QTY-REVERSE-M0 (a reversal at margins 0), B-ROUND-LEVEL (a short's off-grid exit level) and B-EXIT-NA, today pinned by its in-session capture `macd-shortlong-strategy-is-rddt-1d-2026-11-18` alone | macd-shortlong (served since this unit), every v5 strategy that reverses at the percent-of-equity default |
| Q-SU-2 | `corpus/committed/macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99.pine` | NASDAQ:ALAB 1D | no | the same | the same rules on a second listing (more reversals, more off-grid exit levels) | the same |
| Q-SU-3 | `corpus/committed/stop-loss-and-take-profit-in-example__YlblCbts4x.pine` | NYSE:RDDT 1D | no | the same | grades a backtest this unit serves (21 trades on RDDT 1D): an exit with no `from_entry` re-called on every bar across reversals, its profit and loss in ticks from the position size | stop-loss-and-take-profit (served since this unit) |
| Q-SU-4 | `corpus/committed/tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy.pine` | NYSE:RDDT 1D | no | the same | B-EXIT-QTY: a `qty_percent = 50` exit and a second exit on the same trade (W9-X2's own probe stops at step 1 on a sub-question this script never meets) | tradingview-alerts-to-mt4-mt5-forex (refused today at its report: B-EXIT-QTY unpinned) |
| Q-SU-5 | `corpus/committed/optimized-keltner-channels-sltp-strategy-for-btc__48bc69cf84.pine` | NYSE:RDDT 1D | no | the same | Q-S1k: a `strategy.exit` profit / loss distance that is not a whole number of ticks (1,023.932 ticks on RDDT): the tick TradingView fills it at | optimized-keltner (refused today at its report, Q-S1k) |
| Q-SU-6 | `corpus/committed/vwap-fibo-dev-extensions-strategy__mR2vfyGjUv.pine` | NYSE:RDDT 1D | no | the same, and Margin Long / Margin Short in the Properties read-back | D12b point 4 for its Pine v4 shape (`title, overlay, pyramiding, commission_value`: the shape of the queued `w9-q-s1b-v4-shape-c`), and grades the script | vwap-fibo-dev-extensions (refused today: Q-S1b) |

## B. The deep daily chart: where TradingView's backtest starts (Q-S1n)

The largest wall for members. A strategy run is served only when the chart's history starts at the symbol's listing
and fits the 5,000-bar strategy window (`bars_window.HISTORY_WINDOW_BARS`): every intraday chart and every daily chart
of a symbol listed before about December 2006 (AMEX:SPY, NASDAQ:AAPL, ...) refuses every backtest by name (Q-S1n).
These rows ask where TradingView starts when the chart holds the WHOLE history. If it starts at the listing, a window
that reaches the listing serves every such daily chart (a change to the one constant: ruling D9, the owner's) once the
chart holds the full daily history; if it starts at its first loaded bar, the start depends on the TradingView plan's
bar limit and no deep daily backtest can be served.

| id | probe | chart | live | what to record | settles | unblocks |
|---|---|---|---|---|---|---|
| Q-SU-7 | `corpus/committed/supertrend-strategy__rcRbtoBiKG.pine` | AMEX:SPY 1D, scrolled back until `requestMoreData` stops growing (8,473 bars from the 1993-01-29 listing) | no | the report with `settings.dateRange.backtest.from`, every trade and fill, every plot, `window.chartBarsLoaded` | where TradingView's backtest starts on a daily chart deeper than 5,000 bars | every daily chart of a symbol listed before 2007, once D9 is ruled |
| Q-SU-8 | `corpus/committed/supertrend-strategy__rcRbtoBiKG.pine` | NASDAQ:AAPL 1D, scrolled back the same way (from the 1980-12-12 listing, about 11,500 bars) | no | the same | the same past 10,000 bars (a plan's bar limit) | the same |

## C. The percent-of-equity STOP entry (Q-SU-STOP)

`w9-q-s1a-size-stop-v6-rddt-1d-2026-11-17` witnesses the sizing of a long stop entry at the v6 default (floor(equity /
its level), on all 14 fills; the signal close refuted on all 14; a gap past the level rejected for funds on bar 274),
and our run built on that reading reproduces every fill, size and time. It still DIVERGEs: TradingView lists trade 4
(1,636 x (170.09 - 60.68) = 178,994.76) at a profit of 178,994.77, a cent no reading of ours explains, so the sizing
stays refused by name (Q-S1a) and nine strategies with it.

| id | probe | chart | live | what to record | settles | unblocks |
|---|---|---|---|---|---|---|
| Q-SU-STOP-a | `tools/visual_conformance/probes/w9-q-s1a-size-stop-v6.pine` | NYSE:RDDT 1D | no | the report (trade 4's profit and the cumulative profit beside it), every fill | whether TradingView still lists trade 4 at 178,994.77 (a re-take: the same cent is a property of the run, a different one of the session) | the stop-entry sizing |
| Q-SU-STOP-b | `tools/visual_conformance/probes/w9-q-s1a-size-stop-v6.pine` | NASDAQ:ALAB 1D | no | the same | the same sizing on a second listing, every profit to the cent | the same |
