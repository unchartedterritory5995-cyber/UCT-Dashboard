# Capture queue — L2 (step 74), 2026-10-02

Lane L2 admitted user-function default parameter values in the runtime lane and a tab
as one indent level. The defaults are graded MATCH on Q-L1 (`vw-library-import-rddt-1d-2026-10-02`,
`vendorHarness.capRound4.test.js`). One corpus script now attaches through the runtime lane
with the 50 production libraries loaded and has **no capture of its own**:

| id | script (probe) | symbol / tf | what it settles | blocked on it |
|---|---|---|---|---|
| Q-L2a | `corpus/committed/rolling-vwap__043320bb57.pine` (the corpus file IS the probe; imports `PineCoders/ConditionalAverages/2`) | NYSE:RDDT 1D and AMEX:SPY 5 | whether the 7 plots the runtime lane draws (with the library linked) agree with TradingView bar for bar; the library's `while`-loop export `totalForTimeWhen` and its defaulted parameters are the constructs under test | the member door attach of `rolling-vwap` (runtime state, store loaded) is ungraded until then |
| Q-L2b | **no probe** — a v6 script importing a v5 library (`boitoki/AwesomeColor/9` from `fx-market-sessions`) | any | not a value question: TradingView compiles each at its own version. Recorded so a reader does not queue it; the wall (`pine:module` / `runtime:library`, "written in Pine v5 and this script in v6") stays refused until a lane compiles a library under its own version's rules | 4 scripts: `fx-market-sessions`, `auto-trendlines-tradingfinder`, `machine-learning-lorentzian-classification__21f5`, `rate-of-change` |
