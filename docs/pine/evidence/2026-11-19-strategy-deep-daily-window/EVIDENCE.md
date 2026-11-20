# The strategy-only daily window: built, gated on the deep-start capture (2026-11-19)

Branch `feat/strategy-deep-daily-window`, stacked on `feat/strategy-unit`. Base `origin/master` `860e30c72a`, engine 87.
NUMBER PENDING (`scriptEngineVersion.js`).

## 1. The ruling

Coordinator ruling (2026-11-19, D9 strategy-only; the owner said "get it all done" and may veto): build a
strategy-only full-history daily window now, gated, so it ships the moment the evidence lands:

- (a) never raise the shared `HISTORY_WINDOW_BARS` (the scan sweep and screener backtest keep theirs); a NAMED second
  constant for strategy runs, railed, `tests/test_history_window_one_authority.py` still the one authority;
- (b) a daily chart running a strategy requests the full daily history from the listing, only in that case;
- (c) the broker run starts at the listing on that window;
- (d) SERVING stays refused by name until Q-SU-7 / Q-SU-8 grade MATCH (TradingView starts a deep daily backtest at the
  listing). If TradingView does not start at the listing, the window follows TradingView's actual start instead.

## 2. What was built

| part | where | what |
|---|---|---|
| the constant | `api/services/bars_window.py` | `STRATEGY_HISTORY_WINDOW_BARS = 12500`, beside the unchanged `HISTORY_WINDOW_BARS = 5000` |
| its one consumer | `api/routers/pine_history_window.py` | `GET /api/pine/history-window` answers `{historyWindowBars: 5000, strategyHistoryWindowBars: 12500}`: the shared field keeps its value and meaning, so a bundle from before reads exactly what it read |
| the chart | `strategyWindow.js`, `hooks/useStrategyHistoryWindow.js`, `StockChart.jsx`, `binder.js`, `runtime/runtimeAsync.js`, `runtime/runtimeColumns.js` | a strategy run takes the strategy window as `historyWindowBars` and the shared one as `listingDepthBars` (from the same answer; an answer with no strategy field is the window as before and no depth) |
| (b) the request | `StockChart.jsx` `_strategyDailyFull` (`strategyWindow.js::strategyNeedsFullDailyHistory`) | a DAILY chart holding a strategy document fetches `fullBarsFor('D')` (12,500) wherever it sits; a standalone daily chart already did (`_deepFirstPaint`); every other chart's request is unchanged |
| (c)+(d) the run | `runtime/vm.js`, `runtime/broker.js`, `runtime/brokerRules.js` | a run from the listing over more bars than `listingDepthBars` asks [B-START-DEEP] (capture row Q-S1n; fixtures Q-SU-7, Q-SU-8), once, before the first bar, dated on the first bar past the depth (ruling D11). The ledger does not pin it: the backtest is refused by name (`runtime:strategy-unpinned`, the plots kept). No depth handed: the window itself, the run exactly as before |
| the evidence lanes | `strategyHarness.js` (the pin lane), `ourSide.js` (the member lane), `strategyArmed.js::chartStrategyWindowOf`, the serve census and audit | method (a) captures from the listing are handed the shared depth, so Q-SU-7 / Q-SU-8 exercise the rule and a MATCH pins it; method (b) never (its time guard makes the start irrelevant, so it is never evidence for or against) |

When Q-SU-7 / Q-SU-8 land: grade them (`strategyGrading.test.js` rows), and if they MATCH, list them under B-START-DEEP
in `brokerPins.json`, resolve, lock at the train's number. If TradingView starts elsewhere, they DIVERGE at their first
trade or the start, the rule stays unpinned, and the window is moved to TradingView's start by a later unit.

## 3. What a member sees

- A daily chart deeper than 5,000 bars (SPY 1D, 8,473 bars from 1993; any symbol listed before about 2007): its backtest
  was refused by name before (Q-S1n: the 5,000-bar window cut it off the listing) and is refused by name now
  ([B-START-DEEP] unpinned); the plots are the same plots (`strategyDeepStart.test.js`, supertrend-strategy on
  SPY: same `plotsDrawn` both ways).
- A daily chart from its listing within 5,000 bars: unchanged everywhere it was served (RDDT: the committed serve
  census, 6 served, every row as before). A daily GRID CELL holding a strategy now fetches its full daily history, so its
  run starts at the listing and is served where it was refused (Q-S1n on a shallow load).
- Intraday: unchanged (never from the listing; Q-S1n).
- Cost (measured for the coordinator, in-process Node, desktop): supertrend-strategy on SPY 1D 144-166 ms at 8,473
  bars against 98-115 ms at 5,000; the worker budget at 8,473 bars is 4,473 ms (`runtimePaneBudgetFor`), the ceiling
  12,000 ms.

## 4. Rails and mutants

Rails: `runtime/__tests__/strategyDeepStart.test.js` (9: the rule, the run, the payload in both server shapes, the
tab's two values from one answer, the census model, the daily-only full request, the chart source, and supertrend on
SPY 1D through the member's product path), `__tests__/w9T11F1ChartWindow.test.jsx` (+1: the served depth rides beside
the window to strategy documents only; the hook answers `depth`), `tests/test_history_window_one_authority.py` (two
assignments; the strategy window's one consumer; equal to the chart's daily depth), `tests/test_pine_history_window.py`
(both fields; each follows its own constant). The committed serve census (`strategyServeCensus.test.js`, now handed
the window the chart hands) is unchanged: 6 served, every row as before.

Each mutant applied to the working tree, its rails run, the file restored from a saved copy (never `git checkout`),
restored byte-equal every time (2026-11-19):

| mutant | what it breaks | result |
|---|---|---|
| D1 `vm.js`: `deepFrom: null` | no run is ever a deep start | RED `strategyDeepStart` (2) |
| D2 `vm.js`: the served depth is always the window | the depth handed is ignored | RED `strategyDeepStart` (2) |
| D3 `broker.js`: the rule is not asked | a deep run is served unwitnessed | RED `strategyDeepStart` (2) |
| D4 `strategyWindow.js`: the window is the shared field only | the strategy window never reaches a run | RED `strategyDeepStart` (2) |
| D5 `StockChart.jsx`: the request drops `_strategyDailyFull` | a grid cell's strategy loads shallow | RED `strategyDeepStart` (1, the source rail) |
| D6 `binder.js`: the depth is not forwarded | the chart's run never asks the rule | RED `w9T11F1ChartWindow` (1) |
| D7 `bars_window.py`: the strategy window 12,000 | the window cuts a full daily load off its listing | RED `test_history_window_one_authority` (1) |
| D8 `pine_history_window.py`: answers the shared window as the strategy window | the endpoint states no second window | RED `test_pine_history_window` (1) |
