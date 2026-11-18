# Capture queue: the evidence `strategy-decl` admission needs (2026-11-17)

Evidence: `docs/pine/evidence/2026-11-17-admit-strategy-decl/EVIDENCE.md`. Branch `feat/admit-strategy-decl`.

`strategy-decl` (a `strategy()` declaration) is admitted by capability only on the rule every capability meets
(`api/services/rollout_gate.py::pine_capability_admission`): at least 2 captures of 2 DISTINCT scripts, at least one a
COMMUNITY script, each graded MATCH by the runtime-on harness and drawn by the run. Since 2026-11-17 the runtime-on
harness runs the strategy broker armed the way production arms it, and a strategy capture grades MATCH there only
when its trades and its Strategy Tester report agree too (`strategyLane.js`, THE FOLD). None of the 60 W9 report
captures does (0 MATCH, 0 DIVERGE, 60 INCONCLUSIVE), every one of them is our own probe, and no community strategy
capture holds a report the member's run could be graded against.

Rules for every row below:
- tool v3 strategy capture (`tools/vendor_harness/tv_capture.js`, `__uctVH.capture({..., gradeMethod: 'a'})`) WITH the
  Strategy Tester report read (`provenance.report`), its Properties read-back (`provenance.strategySettings`), from the
  listing (`startsAtBar0` asserted). `verify_capture.mjs` refuses one without them.
- Method (a) only, on a listing of fewer than 5,000 daily bars: a member's strategy run takes the most recent
  `bars_window.HISTORY_WINDOW_BARS` (5,000) bars, so a listing deeper than that (AMEX:SPY 1D) is cut, runs off its
  listing and refuses by name (Q-S1n), and grades nothing.
- Not before the engine row below lands: until then every daily strategy run on the member's path refuses its report
  whole, so a capture taken today grades INCONCLUSIVE whatever it holds.

## A. The community strategy captures

| row | probe | chart | captures | settles | gates | live |
|---|---|---|---:|---|---|---|
| Q-SD1 | `corpus/committed/supertrend-strategy__rcRbtoBiKG.pine` (SuperTrend STRATEGY, KivancOzbilgic) | NYSE:RDDT 1D | 1 | the first COMMUNITY strategy graded on its trades and report: the member's run on RDDT 1D from the listing publishes a record of 11 trades (the strategy floor is 5), every rule it uses pinned; its committed 2026-10-02 captures hold no Strategy Tester report | strategy-decl | no |
| Q-SD2 | `corpus/committed/supertrend-strategy__rcRbtoBiKG.pine` | NASDAQ:ALAB 1D | 1 | a second listing-start chart of the same script (one script: it adds a capture, not a script) | strategy-decl | no |

## B. What the rows above wait on

| row | probe | what it settles |
|---|---|---|
| strategy run bar dates | no probe: engine gap (see below) | a daily chart's strategy run must state its bars as epoch seconds before any daily strategy capture can grade MATCH on the member's path |
| built-in strategies | no probe: TradingView built-ins (see below) | a second community script, if one is wanted beside Q-SD1 |

## C. Not capture questions (queue dispositions)

Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is listed,
with this reason, in `rowsNotCaptureQuestions`.

| not a capture | disposition | reason |
|---|---|---|
| strategy run bar dates | engine-gap | a member's daily chart hands the runtime lane `/api/bars`'s ISO date keys (`t: "2024-03-21"`), and the broker records those as its bar times: `strategyReportOf` then refuses the WHOLE report (`runtime:strategy-report-record`, its `trades[].entryTime` / `orders[].placedTime` checks) and every `strategy.closedtrades.entry_time` / `exit_time` read refuses (`broker.js` `barTimeMs`). Measured: 25 of the 60 W9 captures stop on the second; the 4 whose runs finish (w9-g1-v3-properties, w9-q-s1a-size-v2, -v4, w9-q-s1b-defaults-v4, each MATCH through step 7 on epoch-second bars) on the first; and the serve census on the member's daily bar shape serves 2 of the 70 sampled strategies granted, not 7 (the 5 that made trades lose their report). What closes it is a build that hands a strategy run the bar's opening instant in epoch seconds on a daily chart (an engine number), then a runtime-on re-grade of the W9 report captures; no TradingView reading settles it. BUILT 2026-11-17 (`feat/strategy-epoch-bar-times`, engine number pending): a broker run is handed each bar's opening instant from the gate `time` reads (`runtimeColumns.js::brokerBarTimes` over `indicators.js::barOpenInstants`); the re-grade and the census are in `docs/pine/evidence/2026-11-17-strategy-epoch-bar-times/EVIDENCE.md` |
| built-in strategies | builtin | the TradingView built-in strategies (RSI Strategy, Consecutive Up/Down, Stochastic Slow): a second community script the coverage map counts served when armed; a built-in's source is not committed (the repo is public), so its capture is licence-held and graded through the evidence ledger (`evidence_ledger.py`), never a file here. Not needed for the rule once Q-SD1 grades MATCH beside any W9 probe that MATCHes |
