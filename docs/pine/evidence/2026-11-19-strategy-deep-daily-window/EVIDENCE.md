# The strategy-only daily window: built 2026-11-19, served from the listing 2026-11-20 (Q-SU-7 / Q-SU-8 MATCH)

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

They landed on 2026-11-20 and grade MATCH (section 5): [B-START-DEEP] is pinned by exactly those two, and a member's
deep daily chart is served from its listing.

## 3. What a member sees

- A daily chart deeper than 5,000 bars from its listing (SPY 1D from 1993, AAPL 1D from 1980; any symbol listed before
  about 2007, up to 12,500 bars): its backtest was refused by name (Q-S1n: the 5,000-bar window cut it off the listing)
  and is now SERVED from the listing, as TradingView runs it. The serve census on SPY 1D (8,473 bars from 1993):
  0 -> 5 served of 70, no third state (section 5). Where the chart's bars do not start at the listing, nothing moves:
  Q-S1n, by name, as before.
- A daily chart from its listing within 5,000 bars: unchanged everywhere it was served (RDDT: the committed serve
  census, 6 served, every row as before). A daily GRID CELL holding a strategy now fetches its full daily history, so its
  run starts at the listing and is served where it was refused (Q-S1n on a shallow load).
- Intraday: unchanged (never from the listing; Q-S1n). The Q-S1n sentence now states the bars the chart really holds
  (SPY 15m: "its most recent 6343 bars", where it said 5000: the strategy window no longer cuts that chart first).
- Cost (measured for the coordinator, in-process Node, desktop): supertrend-strategy on SPY 1D 144-166 ms at 8,473
  bars against 98-115 ms at 5,000; the worker budget at 8,473 bars is 4,473 ms (`runtimePaneBudgetFor`), the ceiling
  12,000 ms.

## 4. Rails and mutants

Rails: `runtime/__tests__/strategyDeepStart.test.js` (10: the rule and its two pinning captures, the run, the payload in
both server shapes, the tab's two values from one answer, the census model, the daily-only full request, the chart
source, and supertrend on SPY 1D (Q-SU-7) and AAPL 1D (Q-SU-8) through the member's product path: SERVED, every trade of
TradingView's report; control: the shared window alone refuses it by name, the same plots),
`__tests__/vendorHarness/strategyLane.test.js` SL9 (both captures MATCH through the member door, the run asking
[B-START-DEEP]), `runtime/__tests__/w9ValueReadbacks.test.js` (+1: the float tie, 145.265 down and 62.875 up),
`__tests__/vendorHarness/vendorHarness.b1Paints.test.js` (the two captures' paints pinned, as RDDT's), `__tests__/w9T11F1ChartWindow.test.jsx` (+1: the served depth rides beside
the window to strategy documents only; the hook answers `depth`), `tests/test_history_window_one_authority.py` (two
assignments; the strategy window's one consumer; equal to the chart's daily depth), `tests/test_pine_history_window.py`
(both fields; each follows its own constant). The committed serve census (`strategyServeCensus.test.js`, now handed
the window the chart hands) is unchanged: 6 served, every row as before.

Each mutant applied to the working tree, its rails run, the file restored from a saved copy (never `git checkout`),
restored byte-equal every time (D1-D8 2026-11-19; D1-D6 re-run against the pinned rails and D9-D11 on 2026-11-20 under
the heavy lock, `d059b43731`):

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
| D9 `broker.js`: `roundToTick` takes the `+ 1e-6` back | the float tie rounds up (145.27) | RED `strategyGrading` (deep-aapl verdict), `w9ValueReadbacks` (float quotient), `strategyLane` (SL9) |
| D10 `strategyHarness.js`: no member keys for a daily capture | the pin lane runs AAPL on epoch seconds (0 trades) | RED `strategyGrading` (deep-aapl verdict) |
| D11 `brokerPins.resolved.json`: B-START-DEEP dropped | a deep daily backtest refuses by name again | RED `strategyDeepStart` (3), `strategyLane` SL9 (2) |

(2026-11-20 re-run: D1, D2 and D3 RED 3 in `strategyDeepStart`; D4 RED 2 there, `w9T11F1ChartWindow` green, as before;
D5 RED 1; D6 RED 1 `w9T11F1ChartWindow`.)

## 5. The grades (2026-11-20): Q-SU-7 / Q-SU-8, captured by patrick-54 (PR #2146)

TradingView's Strategy Tester starts at the LISTING when the chart holds the whole history: `settings.dateRange.backtest.from`
is the listing day on both captures (method (a), `history.startsAtBar0`, `requestMoreData` until the chart stopped growing).
The fixtures here are byte-identical to PR #2146's (blob `f5c60019...` SPY, `fbdd9451...` AAPL); #2146 drops them, so they
land with the fixes below.

| row | capture | chart | TradingView | pin lane | member door |
|---|---|---|---|---|---|
| Q-SU-7 | supertrend-strategy-deep-spy-1d-2026-11-19 | AMEX:SPY 1D, 8,511 bars | backtest from 1993-01-29 | MATCH step 7: 75 trades, every fill, 9 report slots, 7 value series bar by bar | MATCH (SL9) |
| Q-SU-8 | supertrend-strategy-deep-aapl-1d-2026-11-19 | NASDAQ:AAPL 1D, 11,572 bars | backtest from 1980-12-12 | MATCH step 7: 60 trades, every fill, 9 report slots, 7 value series bar by bar | MATCH (SL9) |

Both runs exercise B-DEFAULTS, B-DIR, B-FILL, B-MARGIN, B-MARKET, B-QTY, B-REVERSE, B-ROUND, B-SIG, B-START-DEEP,
B-V4-MARGIN0 and B-WHEN; every other rule there is already pinned. Scope: the script's own date filter opens trading in
2018 on both charts, so the deep start is witnessed by the start TradingView states, by every value series equal from the
listing (the supertrend's recursive ATR seeds on bar 0, so a run started anywhere else reads other values for years) and
by every trade; a strategy trading from 1993 is the same broker rules on earlier bars, not a separate witness.

**Where AAPL first differed, and the two fixes.**
1. The pin lane only: 0 trades against TradingView's 59. The lane ran the capture on epoch seconds, and the clock's unit
   gate (`indicators.js::barOpenInstant`) refuses a NUMBER before 1990 (it guards a `YYYYMMDD` int read as seconds), so
   one 1980 bar blanked `time` on every bar and the script's time-windowed orders never fired. A member's daily chart
   hands ISO dates (`/api/bars`), which the date branch reads to TradingView's 09:30 New York instant; the lane now builds
   a daily capture on those keys (`strategyHarness.js`; series, points and fills still keyed by TradingView's epoch
   seconds). Every committed verdict is byte-identical.
2. The broker, [B-ROUND]: then `exitPrice differs at 1650288600`, one trade's fill at 2022-07-08 145.27 against
   TradingView's 145.26. That bar's open is 145.265, and 145.265 / 0.01 = 14526.499999999998: a hair under the half.
   `roundToTick` added `1e-6` (`onTick`'s tolerance) "so a price a float puts a hair under a half tick is the tie it was
   written as"; TradingView's answer is the float's. Surveyed over every committed report capture: 34 fills at an open
   on a half tick; 33 have an exact x.5 quotient and fill UP (62.875, 113.875, 394.475, ...), the one quotient under the
   half fills DOWN. The tolerance is gone; the rule text says so; every committed verdict byte-identical.
   [B-ROUND-MARK] shares the function and stays unpinned, so no served number rides its float tie.

**The ledger.** `brokerPins.json` B-START-DEEP = the two captures; `evidence_engine.py pins` resolves 47 rules,
`brokerPins.resolved.json` sha256 `cbcb5efe09bceb9e81743eaad4b0aa123d19a158582273b198b741030673d2e9`. Lock, at the train:
the same train as `feat/strategy-unit` takes this sha as its entry (in place of `1db04b15...`; `COMMITTED_OLDER_DIGEST`
stays `810f4850...`); a later train appends it under its own number and recomputes `COMMITTED_OLDER_DIGEST`
(`brokerPinsLock.js::olderEntriesDigest`).

**The serve census** (the 70-row sample, `strategyServeAudit.measure.test.js`, the window the chart hands: 12,500 over a
served depth of 5,000; heavy lock, 2026-11-20), against the strategy unit's after-census:

| leg | before (feat/strategy-unit) | after |
|---|---|---|
| RDDT 1D closed / forming | 10 / 10 served | 10 / 10 served, every row identical but its timing |
| SPY 1D (vw-bool-cast, 8,473 bars from 1993) | 0 served (Q-S1n) | **5 served**, no third state |
| SPY 1D (Q-SU-7's bars, 8,511) / AAPL 1D (Q-SU-8's, 11,572) | n/a | 5 / 5 served, no third state |
| SPY 15m, RDDT 60m | 0 / 0 (Q-S1n) | 0 / 0, the same refusals; the Q-S1n sentence states the chart's real bar count |

Served on SPY 1D: supertrend-strategy (73 trades), stop-loss-and-take-profit-in-example (299), golden-cross-sma-200 (15),
buy-monday-exit-tuesday and the 1-minute scalping strategy (0 trades each). The next walls on SPY 1D: [B-ROUND-MARK]
unpinned (7 rows: SPY's closes are off the tick grid, RDDT's are not), `runtime:strategy-unsettled` at the run (11),
Q-S1b at the report (3), and the door refusals every chart shares.
