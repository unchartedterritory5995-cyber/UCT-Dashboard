# W9-T11-F1 evidence: the chart lane passes a backtest window

Branch `feat/pine-w9-chart-window`, base `origin/feat/pine-engine40-integration` `cac7a4370d`.
DARK: everything new is reached only with `VITE_PINE_STRATEGY_BROKER_ENABLED=1`. No arming, no flag,
no Railway, no `SCRIPT_ENGINE_VERSION` edit.

## The gap (T13b review)
With the broker gate on, a chart showed no backtest. `binder.js` never handed a strategy run
`ctx.historyWindowBars` (only the server route sets it), so every chart strategy run refused
`runtime:strategy-start` and no record was published.

## The rule implemented, and its source
Design 3.4, "The chart": "A broker run takes the most recent `historyWindowBars` of the bars the chart
has loaded, so scroll-back never changes the trades. The value arrives in the run context (T11) from
the server, which reads `bars_window`." Section 9 item 6: the chart lane reads `bars_window` "through
an endpoint". D9: the window stays 5000. D2: the start sentence always shows.

- **Which bars (D9).** `GET /api/pine/history-window` (new, signed-in, plain `def`) answers
  `{"historyWindowBars": bars_window.HISTORY_WINDOW_BARS}`, imported, never restated (added to
  `test_history_window_one_authority.py`). The chart asks it once per tab, only with the gate on
  (`engine/strategyWindow.js`, hook `hooks/useStrategyHistoryWindow.js`); the first good answer is kept
  for the tab. A bad answer or a failed request is NO window (never a default): the run refuses
  `runtime:strategy-start` by name, and the next mount asks again.
- **Who gets it.** `binder.js` forwards the value only to a document stamped `strategy-window` (possible
  only with the gate on), only for the chart's own series (not a framed instance), and keys its memo on
  it. Every other document's ctx and memo key are unchanged. The value is forwarded as held: what is not
  a window is the VM's to refuse (one author).
- **From the listing or not.** Unchanged runtime rules (`runtimeColumns.js::computeStrategyWindow`,
  `vm.js` [B-START]): bars that start at the listing (`historyFromListing`, `listingSeed.js`: daily
  only, exact listing date) and fit the window run; an off-listing series refuses Q-S1n
  (`runtime:strategy-unsettled`) by name until the capture rules otherwise.
- **The window never slides.** A served run always starts at the listing bar, so a new bar appends
  without moving the start or any earlier trade. When the bars exceed the window, the most recent
  window is off the listing and the run refuses Q-S1n instead of trading from a moved start.
- **The stamp.** The record's `window.startDate` / `startSentence` come from
  `strategyRecord.js::startSentenceOf` (the one authority); this lane writes no date or sentence.

## Rails
`engine/__tests__/w9T11F1ChartWindow.test.jsx` (13):
- D9: the test reads `5000` from `api/services/bars_window.py` itself;
- gate off: no request, no window; gate on: one request to `/api/pine/history-window`, the first answer
  fixed for the tab (a later different answer does not move it);
- no default: 0, -1, 1.5, '5000', null, a 500 and a thrown fetch are all no window, then a retry works;
- the hook: gate off null with no request; gate on the server value, `credentials: 'include'`;
- real binder + real member door + real runtime: from the listing inside the window publishes a record
  with `fromListing`, the window, `bars`, `startTime` = bar 0 and the D2 sentence via `startSentenceOf`;
- fixed across bar updates (40, 41, 42 bars): same start, sentence and trades;
- one bar over the window: refuses Q-S1n, nothing published;
- off the listing: refuses Q-S1n by name, nothing published;
- no window (undefined, null, 0, '5000', 1.5): `runtime:strategy-start`, nothing published;
- a window that lands after the bars recomputes the run;
- only the strategy document is handed the window (an indicator's ctx has no such key);
- StockChart (read, the repo's idiom): the hook's value is passed in the `binder.sync` ctx and is in
  that effect's dependency list.

`tests/test_pine_history_window.py` (5): anonymous 401; the value; it follows the constant; plain `def`;
the real app mounts it. `w9T13bReportWire.test.jsx`: the stale "the chart hands no window" comment and
case name updated (the case itself, a ctx with no window, still holds).

## Checks (Node 20.20.2 vitest `--maxWorkers=1` unless stated)
- New rail 14/14. Focused re-run at the tip: the new rail, w9T11Record, w9T13bReportWire,
  strategyReportPanel, binder.test, stockChartWiring: 6 files, 403/403.
- Neighbours: every suite that builds a real binder (72 files) plus the W9 runtime rails, the pane
  suites, StockChart suites and reachable: 124 files, 2469 passed, 4 failed. One was this lane's
  (T11's literal rail caught a "5000" in a comment of `strategyWindow.js`; fixed, now green). The other
  three fail identically on the base code (StockChart.jsx and binder.js swapped back to HEAD, restored,
  cmp OK): `StockChart.focusWarmStep` (wall-clock "after the bell"), `StockChart.firstVisitFraming`,
  `sourcesAreText` (control bytes in `ast/pineRuntimeFrontend.js`, not touched here).
- pytest: the new route 5/5, one-authority 16/16, `test_pine_strategy_backtest` green. The auth-surface,
  async-route and E-3 censuses each fail on the base for routes this lane does not touch
  (`/api/brand/massive-card-logo.png`, `/api/catalysts/pending-deals-internal`, `chart_iq`,
  `trade_exchange_news`, `indicator_alerts`); none names the new route.
- Host parity, Node 24.13.1: HP-1 GREEN 166/166 equal the committed digests.
- Engine bump: none. Translator output, HP-1 digests and served record bytes are unchanged; the new
  path is reached only by a strategy document, which exists only with the gate on.

## Hand mutants (copy, mutate, run, restore by copy, filecmp; tree unchanged after)
Control (comment edit) SURVIVED. 12 of 12 KILLED: binder never forwards; binder forwards to every
document; window not in the binder memo key; fetch ignores the gate; refetch every time; any number
accepted; a failure kept as a window; hook never loads; StockChart drops the ctx key; StockChart drops
the effect dependency; route returns a literal; route unauthenticated.

## Open ruling questions
1. **The window source on the chart.** Built as the design names it (an endpoint reading `bars_window`).
   The route is signed-in only and carries no plan or stage gate of its own (it answers a constant).
   Confirm, or name the gate it should sit behind.
2. **Fixed per tab.** The first good answer is kept for the tab's life, so a deploy that moves D9's
   constant reaches an open tab only on reload. Confirm that "fixed for a chart load" may be "fixed for
   the tab".
3. **Daily only, through `historyFromListing`.** The chart says "from the listing" only for a daily
   series whose bar 0 is the listing date (`listingSeed.js`). Intraday and weekly strategy runs therefore
   always refuse Q-S1n today. The design does not say otherwise; recorded so it is not mistaken for a gap.
4. **Scroll-back on a long history.** A symbol whose daily history exceeds the window (most listed
   stocks) refuses Q-S1n on the chart whatever is loaded, until the Q-S1n capture rules on non-listing
   windows. Only young listings (RDDT-like, method (a)) can show a backtest.

## r1 (review GO-WITH-NOTES @ba89bdc606, dsk/reviews/W9-T11-F1.md)
- **N1, ask only for a chart that holds a strategy; remember a failure briefly.**
  - `StockChart` computes `_holdsStrategyWindow` from the stored instances' definitions. It uses the
    shared reader `strategyWindow.js::isStrategyWindowDefinition` (the binder uses the same reader).
  - `useStrategyHistoryWindow(enabled)` asks only when `enabled` is true and the gate is on. A chart
    of indicators makes no request.
  - A failed ask (a 401, a non-ok answer, a bad payload or a thrown fetch) answers "no window" with
    no request for `FAILURE_RETRY_MS` (60 s). After that, the next ask tries again.
- **N2, the chart's own series only.** Two rails:
  - The product case: a strategy asked for another timeframe is not framed, because
    `calcTimeframeCapability` refuses runtime documents. It runs on the chart's bars and is handed
    the window.
  - The binder rule: a frameable definition stamped `strategy-window` is never handed the window
    when framed. The same document unframed is (the control). The reviewer's K2 now dies.
- **N3, pending, not refused.**
  - The hook reports `pending` while the ask is in flight, and StockChart passes it as
    `ctx.historyWindowPending`.
  - While it is pending, the binder holds a strategy run on the chart's own series: no columns, no
    record, no notice, and the T13b mount renders nothing.
  - When the window lands, the run computes. When the ask fails, pending turns false with no
    window, and the run refuses `runtime:strategy-start` by name.
  - Pending holds only strategy documents: an indicator beside one computes as before. A window
    already in hand wins over a pending flag.

r1 checks (Node 20, `--maxWorkers=1`):
- New rail: 22/22.
- Focused run: 7 files, 418/418. These are the new rail, w9T11Record, w9T13bReportWire,
  strategyReportPanel, binder.test, stockChartWiring and binderCalcFrames.
- Neighbours: 124 files, 2478 passed, 3 failed. The 3 are the same base failures as before
  (focusWarmStep, firstVisitFraming, sourcesAreText).
- HP-1 GREEN 166/166 on Node 24.

r1 mutants (copy, mutate, run, restore by copy, filecmp; tree unchanged after): the control
survived, and all 23 others were killed:
- binder:
  - never forwards the window;
  - forwards it to every document;
  - forwards it to framed instances (K2);
  - window missing from the memo key.
- pending in the binder:
  - never holds;
  - holds every document;
  - holds even when the window is known (killed by the rail added in r1).
- fetch:
  - ignores the gate;
  - refetches every time;
  - accepts any number;
  - keeps a failure as a window;
  - failure not cached;
  - failure cached forever.
- hook:
  - ignores `enabled`;
  - never pending;
  - never loads.
- StockChart:
  - always asks;
  - drops the window ctx key;
  - drops the pending ctx key;
  - drops the effect dependency.
- route:
  - returns a literal;
  - unauthenticated.

## r2 (review GO-WITH-NOTES @2491d183c1)
- **N5, an ask that never settles fails.** `loadStrategyHistoryWindow` races the request against a
  `REQUEST_TIMEOUT_MS` (10 s) timer. When the timer wins:
  - the request is aborted (an `AbortController` signal is passed to fetch);
  - the ask resolves "no window" and is remembered as a failure, the same as a 401;
  - the hook therefore goes pending → not pending with no window, and the run refuses
    `runtime:strategy-start` by name instead of holding forever.

  Rails (fake timers, a fetch that never resolves): still unsettled and not aborted at 9 999 ms;
  at 10 000 ms it resolves null and the signal is aborted; no request is made inside the failure
  period; the hook is pending until 10 s, then not pending; the binder then shows the named
  refusal.
- **N6, a mounted chart asks again.**
  - After a failure, the hook re-asks when `FAILURE_RETRY_MS` (60 s) is over, and again after each
    further failure, with no reload or remount.
  - A retry is quiet: `pending` stays false, so the named refusal stays on screen until a window
    lands, never flickering to an empty pane.
  - Once the window is in hand, nothing more is asked.
  - Rail (fake timers): a 401, then a 500, then 200. The requests come at 0 s, 60 s and 120 s, and
    none comes at 59.999 s. The chart takes the window, is never pending after the first answer,
    and makes no request in the next 180 s.

r2 checks (Node 20, `--maxWorkers=1`):
- New rail: 25/25.
- Neighbours: 124 files, 2482 passed, 3 failed. The 3 are the same base failures as before.
- HP-1 GREEN 166/166 on Node 24.

r2 mutants: the control survived, and all 28 others were killed. These are r1's 22 plus 6 new ones:
- no timeout;
- no abort;
- no signal;
- no retry;
- the retry flips back to pending;
- the retry fires at 0 ms.
