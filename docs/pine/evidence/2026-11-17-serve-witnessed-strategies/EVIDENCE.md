# Serving witnessed strategy backtests: readiness audit and arming (2026-11-17)

Owner ruling of 2026-11-17, delegated to the coordinator and decided: serve the Strategy Tester report for Pine
strategies from the strategy broker emulator (the engine's simulated fills; never a real order, never a brokerage
connection), and only for strategies whose broker rules are witnessed by TradingView Strategy Tester captures (the pin
ledger, `brokerPins.resolved.json`, 41 rules pinned). Every other strategy is refused by name with the open question it
hits.

Base: `origin/master` `1229be0f22`, engine 71. Branch `feat/serve-witnessed-strategy-backtests`.

## 1. The answer

With the strategy broker gate ON, every one of the 70 sampled strategies of the 2026-11-17 coverage map lands in one
of two states, in both admission states measured, and none in a third.

| admission state | served | refused by name | third state |
|---|---|---|---|
| granted (the armed census's condition, `__allowEveryRuntimeScriptForTests`) | **7** | 63 | 0 |
| production (the server's own admission: capability admission on, committed lists) | **0** | 70 | 0 |

- The 7 served are EXACTLY the coverage map's `wouldTransferIfArmed` 7, key for key (no served-not-armed, no
  armed-not-served).
- **Production serves nothing today, gate on or not.** The broker runs only on the per-bar runtime lane, and the
  lane's admission admits no strategy: `capability_admitted` misses `strategy-decl` for all 70 (52 miss only it,
  11 also `request-other`, 7 also a library or another capability). `strategy-decl` has no row in
  `api/data/pine_runtime_allowlist.json`, and the per-script allowlist holds no strategy. The runtime lane is also
  reached only by members `PINE_RUNTIME_STAGE` admits (`admins` today).
- So the 7-of-70 armed census is what the broker and the report serve ONCE admission admits strategies; arming the
  build flag alone serves no report to anyone.

Before the fixes in section 4 the same run had a third state: granted 3 (parabolic-sar-strategy, flawless-victory,
best-engulfing-ma), production 1 (best-engulfing-ma), each a strategy drawn with its backtest silently absent.

## 2. How it was measured

`app/src/components/chart/engine/runtime/__tests__/strategyServe.js::strategyServeOutcome` follows one source through
the product path a member's chart takes, the three Pine flags stubbed on (objects-only pane, runtime pane, strategy
broker): the member door (`memberPaneDefinition`), the install door, the broker run (`computeRuntimeColumns`) on
NYSE:RDDT 1D from the listing (`k-clustering-rddt-1d-2026-09-28`, the census's reference bars) with the window
`HISTORY_WINDOW_BARS` = 5000, the record, `brokerReport.js::strategyReportOf`, and `StrategyReportPanel.jsx` rendered
in jsdom on every tab. It classifies:

- **SERVED**: the door hands the chart a broker document (the strategy window), the run finishes with a record, the
  report is `ok`. Every SERVED metric is re-checked against the committed ledger (the run's `rulesUsed`, B-VAL, the
  commission's rules, and for a percent of a defaulted capital B-DEFAULTS); every trade profit likewise; the trade list
  on the fill rules; the D2 start sentence present; every panel cell a member reads holds a number or a sentence; no
  guard id in the DOM.
- **REFUSED by name**, at the door (`reason`), at the run (the strip's `not drawn on this chart (<guard>): <why>`,
  `nativeRegistry.runtimeRunStopOf`), at the report (`refusals[].sentence`), or "no backtest": the door drew a document
  without the broker and the pane's disclosures (or, for a host document, the import verdict's missing part) name the
  backtest as not run.
- **THIRD**: anything else. The census rails assert there is none.

The 70 sources are the coverage map's sample (`cov-e71` cache: built-in and reference sources stay local, the repo
being public; the 25 committed ones are read from `corpus/committed`). The production state latches the server's own
kill-list read payload and, per source, its own verdict (`runtime_definitions.capability_admitted`, capability
admission on), prepared beside each path. Railway's `PINE_RUNTIME_KILL_LIST` / `PINE_RUNTIME_ALLOWLIST` were not read
(never touch Railway).

```sh
# input (local): keys from docs/pine/coverage-map.json of 2026-11-17 (PR #1645), the server's verdicts per source
python tools/pine_coverage/strategy_serve_input.py <repo> <coverage-map.json> <cov-e71>/rt/census_input.json serve_input.json
# from app/, under the heavy lock
STRATEGY_SERVE_INPUT=serve_input.json STRATEGY_SERVE_OUT=serve_70.jsonl \
  python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --label strat-serve-audit run -- \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/runtime/__tests__/strategyServeAudit.measure.test.js --maxWorkers=1
```

Run: 70 rows x 2 states, 11.5 s of tests. The committed half is the standing rail `strategyServeCensus.test.js`.

## 3. The table

"Granted" is the armed census's condition; "production" is today's admission. A refusal names its guard and, for the
broker, the rule or capture row; the member reads the sentence (guard ids are stripped on screen).

| # | strategy | pop | v | gate on, admission granted (= armed census) | gate on, production admission |
|---|---|---|---|---|---|
| 1 | consecutive-updown-strategy | builtin | 6 | SERVED: 11 metrics shown, 15 withheld by name; 48 trades, 47 profits shown | REFUSED: door: pine:no-output |
| 2 | rsi-strategy | builtin | 6 | SERVED: 11 metrics shown, 15 withheld by name; 13 trades, 12 profits shown | REFUSED: door: pine:no-output |
| 3 | stochastic-slow-strategy | builtin | 6 | SERVED: 11 metrics shown, 15 withheld by name; 27 trades, 26 profits shown | REFUSED: door: pine:no-output |
| 4 | buy-monday-exit-tuesday | committed | 5 | SERVED: 10 metrics shown, 16 withheld by name; 0 trades, 0 profits shown | REFUSED: door: pine:strategy-call |
| 5 | scalping-strategy-with-williams-r-macd-and-sma-1-minute-only | committed | 5 | SERVED: 10 metrics shown, 16 withheld by name; 0 trades, 0 profits shown | REFUSED: door: pine:no-output |
| 6 | supertrend-strategy | committed | 4 | SERVED: 11 metrics shown, 15 withheld by name; 11 trades, 10 profits shown | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 7 | golden-cross-sma-200-long-only-moving-average-strategy-by-chartart | reference | 2 | SERVED: 11 metrics shown, 15 withheld by name; 1 trades, 1 profits shown | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 8 | rsi-vwap-indicator | committed | 4 | REFUSED: door: budget:lookback | REFUSED: door: budget:lookback |
| 9 | atr-god-strategy-by-tradesmart | committed | 5 | REFUSED: door: pine:block | REFUSED: door: pine:block |
| 10 | trend-following-parabolic-buy-sell-strategy-tradedots | reference | 5 | REFUSED: door: pine:function | REFUSED: door: pine:function |
| 11 | optimized-trend-tracker | committed | 4 | REFUSED: door: pine:function-def | REFUSED: door: pine:function-def |
| 12 | technical-ratings-strategy | builtin | 6 | REFUSED: door: pine:module | REFUSED: door: pine:module |
| 13 | heikin-ashi-supertrend | committed | 5 | REFUSED: door: pine:module | REFUSED: door: pine:module |
| 14 | machine-learning-lorentzian-classification | committed | 5 | REFUSED: door: pine:module | REFUSED: door: pine:module |
| 15 | trailing-take-profit-trailing-stop-loss | committed | 6 | REFUSED: door: pine:module | REFUSED: door: pine:module |
| 16 | footprint-strategy | reference | 5 | REFUSED: door: pine:module | REFUSED: door: pine:module |
| 17 | vwap-trendfollow-strategy-wbburgin | reference | 5 | REFUSED: door: pine:module | REFUSED: door: pine:module |
| 18 | bar-updown-strategy | builtin | 6 | REFUSED: door: pine:no-output | REFUSED: door: pine:no-output |
| 19 | bollinger-bands-strategy-directed | builtin | 6 | REFUSED: door: pine:no-output | REFUSED: door: pine:no-output |
| 20 | greedy-strategy | builtin | 6 | REFUSED: door: pine:no-output | REFUSED: door: pine:no-output |
| 21 | camarillastrategyv1 | reference | 2 | REFUSED: door: pine:no-output | REFUSED: door: pine:no-output |
| 22 | dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators | reference | 6 | REFUSED: door: pine:no-output | REFUSED: door: pine:no-output |
| 23 | ai-supertrend-x-pivot-percentile-strategy-presenttrading | committed | 5 | REFUSED: door: pine:request | REFUSED: door: pine:request |
| 24 | multi-timeframe-rsi-buy-sell-strategy-tradedots | committed | 5 | REFUSED: door: pine:request | REFUSED: door: pine:request |
| 25 | take-profit-multi-timeframe | committed | 5 | REFUSED: door: pine:request | REFUSED: door: pine:request |
| 26 | rsi-trend-reversal | reference | 5 | REFUSED: door: pine:request | REFUSED: door: pine:request |
| 27 | strategyrszigzag-pa-strategy-v41 | reference | 1 | REFUSED: door: pine:request | REFUSED: door: pine:request |
| 28 | strategyrszigzag-pa-strategy-v4 | reference | 1 | REFUSED: door: pine:request | REFUSED: door: pine:request |
| 29 | tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy | reference | 4 | REFUSED: door: pine:request | REFUSED: door: pine:request |
| 30 | swing-parabolic-sar-strategy | reference | 4 | REFUSED: door: pine:state | REFUSED: door: pine:state |
| 31 | trendline-breaks-with-multi-fibonacci-supertrend-strategy | reference | 6 | REFUSED: door: pine:state | REFUSED: door: pine:state |
| 32 | 72s-strategy-adaptive-hull-moving-average-pt1 | committed | 4 | REFUSED: door: pine:statement | REFUSED: door: pine:statement |
| 33 | atr-trailing-stoploss-strategy | committed | 4 | REFUSED: door: pine:statement | REFUSED: door: pine:statement |
| 34 | rob-booker-adx-breakout | builtin | 1 | REFUSED: door: pine:strategy-call | REFUSED: door: pine:strategy-call |
| 35 | inside-bar-strategy-w-sl | committed | 4 | REFUSED: door: pine:tuple | REFUSED: door: pine:tuple |
| 36 | qqe-mod-ssl-hybrid-waddah-attar-explosion | reference | 5 | REFUSED: door: pine:window | REFUSED: door: pine:window |
| 37 | parabolic-sar-strategy | builtin | 6 | REFUSED: plots drawn, backtest refused: broker build: runtime:strategy-repaint | REFUSED: door: pine:state |
| 38 | flawless-victory-strategy | committed | 4 | REFUSED: plots drawn, backtest refused: broker build: runtime:strategy-option | REFUSED: door: pine:strategy-call |
| 39 | optimized-keltner-channels-sltp-strategy-for-btc | committed | 4 | REFUSED: plots drawn, backtest refused: runtime lane: runtime:statement | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 40 | pmax-explorer | committed | 4 | REFUSED: plots drawn, backtest refused: runtime lane: runtime:function-global-state | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 41 | tradingview-alerts-to-mt4-mt5-strategy-example | committed | 5 | REFUSED: plots drawn, backtest refused: broker build: runtime:strategy-repaint | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 42 | best-engulfing-ma | reference | 4 | REFUSED: plots drawn, backtest refused: strategy() line not read | REFUSED: plots drawn, backtest refused: strategy() line not read |
| 43 | bollinger-rsi-double-strategy-by-chartart-v11 | reference | 2 | REFUSED: plots drawn, backtest refused: runtime lane: runtime:colour | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 44 | macd-sma-200-strategy-by-chartart | reference | 2 | REFUSED: plots drawn, backtest refused: broker build: runtime:strategy-option | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 45 | ut-bot-strategy | reference | 4 | REFUSED: plots drawn, backtest refused: broker build: runtime:strategy-repaint | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 46 | linear-regression-channel-breakout-strategy | committed | 5 | REFUSED: run: runtime:failed | REFUSED: door: pine:enum-unreadable |
| 47 | macd-shortlong-strategy-for-tradingview-input-optimizer | committed | 5 | REFUSED: run: runtime:strategy-unpinned B-EXIT-NA | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 48 | stop-loss-and-take-profit-in-example | committed | 4 | REFUSED: run: runtime:strategy-unpinned B-EXIT-NA | REFUSED: door: pine:strategy-call |
| 49 | hull-moving-average-crossover-strategy | reference | 2 | REFUSED: run: runtime:strategy-unpinned B-FILLS | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 50 | bollinger-bands-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 51 | channel-breakout-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 52 | inside-bar-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1i | REFUSED: door: pine:no-output |
| 53 | keltner-channels-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 54 | macd-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1i | REFUSED: door: pine:no-output |
| 55 | momentum-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 56 | moving-average-crossover | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1i | REFUSED: door: pine:no-output |
| 57 | outside-bar-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1i | REFUSED: door: pine:no-output |
| 58 | pivot-extension-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1i | REFUSED: door: pine:no-output |
| 59 | pivot-reversal-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 60 | price-channel-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 61 | supertrend-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 62 | two-moving-averages-crossover | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1i | REFUSED: door: pine:no-output |
| 63 | volatility-expansion-close-strategy | builtin | 6 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: door: pine:no-output |
| 64 | highlow-channel-swing | committed | 4 | REFUSED: run: runtime:strategy-unsettled Q-S1b | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 65 | tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto | committed | 4 | REFUSED: run: runtime:strategy-unsettled Q-S1b | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 66 | vwap-fibo-dev-extensions-strategy | committed | 4 | REFUSED: run: runtime:strategy-unsettled Q-S1b | REFUSED: door: budget:series |
| 67 | bollinger-bands-filter | reference | 4 | REFUSED: run: runtime:strategy-unsettled Q-S1b | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |
| 68 | fixed-percent-stop-loss-take-profit | reference | 4 | REFUSED: run: runtime:strategy-unsettled Q-S1e | REFUSED: door: pine:strategy-call |
| 69 | trailing-sl-strategy-quantnomad | reference | 4 | REFUSED: run: runtime:strategy-unsettled Q-S1b | REFUSED: door: pine:timeout |
| 70 | vix-fix-stochrsi-strategy | reference | 2 | REFUSED: run: runtime:strategy-unsettled Q-S1a | REFUSED: plots drawn, backtest refused: admission: not yet graded (strategy-decl) |

Tallies, granted: served 7; run `runtime:strategy-unsettled` Q-S1a 9, Q-S1i 6, Q-S1b 5, Q-S1e 1; run
`runtime:strategy-unpinned` B-EXIT-NA 2, B-FILLS 1; run `runtime:failed` 1 (the script's own `array.get` at index NaN);
no backtest 9 (broker build refused 5: `runtime:strategy-option` / `-repaint`; runtime lane declined 3; `strategy()`
line not read 1); door 30 (`pine:request` 7, `pine:module` 6, `pine:no-output` 5, `pine:statement` 2, `pine:state` 2,
one each of `pine:strategy-call`, `pine:block`, `pine:tuple`, `pine:function-def`, `budget:lookback`, `pine:window`,
`pine:function`). They are the coverage map's armed walls, re-read as what a member sees.

Production: door 55 (`pine:no-output` 23: tester-only strategies, the runtime lane declining them; `pine:request` 7,
`pine:module` 6, `pine:strategy-call` 5, ...), no backtest 15 (14 "not yet graded against TradingView", the admission;
1 `strategy()` line not read).

### What a served report shows

Every served report shows the same metric set, each value from the run's own record:

- **Shown (11, or 10 with no gross loss)**: Total closed trades, Total open trades, Winning / Losing / Break-even trades,
  Net profit, Net profit %, Gross profit, Gross loss, Profit factor, Commission paid. Basis: 9 of them are Strategy
  Tester report slots our grade compares at step 6 on every capture whose report serves them
  (`tools/vendor_harness/strategy_report_slots.json`, PINNED since W9-C0); Net profit % and Break-even trades are the
  B-VAL reference sentences (`strategy.netprofit_percent`, `strategy.eventrades`). Each rests on rules the ledger pins.
- **Withheld by name (15)**: Max drawdown, Max run-up, Buy and hold return, Percent profitable, Average trade, Average
  winning / losing trade, Ratio of average win to average loss, Largest winning / losing trade, Average bars in trades,
  Sharpe and Sortino (`runtime:strategy-report-unstated`, rows W9-S1 / W9-S2), Open profit and Equity
  (`runtime:strategy-report-unrecorded`). Profit factor is withheld (`-undefined`) when there is no gross loss.
- **The trade list**: every trade a row; a closed trade's profit shown, an open trade's profit withheld by name; an
  exit signal TradingView names itself withheld by name (W9-V1).

## 4. Gaps found and fixed

1. **A percent metric on an unasked default** (`brokerReport.js`). Net profit % divides by the initial capital; when
   the script does not state it, the value is the version's default (B-DEFAULTS, Q-S1b), and the run asks B-DEFAULTS
   for the capital only where IT reads it. A run sized by a fixed quantity at declared margins and a declared non-zero
   commission type never does, so the metric was served on a default no rule it asked covers. Now a defaulted capital
   adds B-DEFAULTS to that one metric. Unreachable on today's ledger (B-DEFAULTS is pinned): nothing a member reads
   changes. Rail `runtime/__tests__/w9ServeCapitalRule.test.js`.
2. **A runtime-lane strategy drawn without its broker, in silence** (`memberPaneDefinition.js`
   `runtimeLaneDefinition`). parabolic-sar-strategy and flawless-victory: the broker build refused
   (`runtime:strategy-repaint` on `barstate.isconfirmed`, `runtime:strategy-option` on `currency`), the plain build
   stood, and the pane said only "Drawn bar by bar". The probe now carries the broker build's refusal
   (`runtimeColumns.js::probeRuntimeProgram` `brokerDeclined`) and the document a `Strategy backtest` disclosure naming
   it; with the gate off, the gate is the reason.
3. **The armed route's decline dropped** (`memberPaneDefinition.js`). With the gate on, a host-drawable strategy whose
   broker document is declined keeps its host document; the reason (the runtime lane's decline, or the broker build's
   refusal) was thrown away and the member read only the generic import verdict. The host document now carries the
   `Strategy backtest` disclosure with that reason: in production, "not yet been graded against TradingView".
4. **A strategy whose `strategy()` line the translator does not read** (best-engulfing-ma: a variable title wrapped
   over three lines). The host lane read it as an indicator: no `pine:strategy-chart` note, so neither the pane nor the
   import verdict said its orders and backtest were not run. Present in production today, gate off. The door now
   detects the declaration (`STRATEGY_DECLARATION`, the census's own predicate, now one authority) and adds the
   disclosure: "its `strategy()` line is not one this engine reads, so the script is drawn as an indicator".

The one wording: "This script is a strategy, and its backtest is not run on this chart, so no strategy report is shown
and its orders are not simulated: <why>." Rails `builder/memberPane/strategyBacktestNote.test.js` (S1-S3, two controls).

### Wording review

No member sentence implies real trading. The panel says "strategy report", "this backtest starts on <date> (UTC);
TradingView may start elsewhere", and "how TradingView runs a backtest"; the new disclosure says "simulated". Two
follow-ups, NOT changed here (translator text, ruled elsewhere):

- `pine:strategy-call`'s host sentence ends "which this engine does not simulate". With the gate on that is no longer
  true of the engine, only of the script on this chart. It is what 5 production refusals read (RT1: the member reads
  the host refusal verbatim).
- A tester-only strategy refused at the door reads `pine:no-output`'s screen wording ("offers no plot and no alert
  condition to filter on"), not that its backtest is not run.

### D7: the scorecard wording

`strategyScorecard.js::strategyScorecardWording` is printed by `productScorecard.test.js` and asserted by
`strategiesAreRuled.test.js`; no member surface renders it. What members read is the panel, the strip and the door's
disclosures above. Its last sentence, "Strategy backtests are not served to members yet.", stays TRUE after this PR:
production serves 0 (admission), so `served` stays false and the wording is unchanged.

## 5. Arming

- `Dockerfile.web`: `ARG VITE_PINE_STRATEGY_BROKER_ENABLED=1`. A production build whose Railway variable is ABSENT
  bakes `"1"`; a set variable is passed as the build arg and wins (`0` holds the gate off, and so does an empty value).
  Local and test builds have no Docker ARG and keep the gate's dark default. Precedent for a production default ON
  that Railway overrides: `VITE_SAVED_SCRIPT_UPGRADE` (default ON in its reader). The reader here keeps the repo's
  `=== '1'` convention, so no suite changes polarity; the default lives in the build.
- **Which bundle members load.** Two services build `Dockerfile.web`, each from its OWN Railway variables: `web`
  (`railway.web.json`) and `web-front` (`front/service.json`, the front door that serves `/assets` and the app shell,
  `front/README.md`). Members load `web-front`'s bundle (measured 2026-11-17 by the Studio session: a `VITE_*` set on
  `web` alone changed nothing members load). Both watch `Dockerfile.web`, so this PR rebuilds both and the default
  reaches both, provided the variable is absent on `web-front`. `front/README.md` says its `VITE_*` are Railway
  references to `web`'s (`${{web.VITE_X}}`): a reference to a variable `web` does not have would pass an empty value
  and bake the gate OFF in the members' bundle. Railway is not read from here, so the owner's check below comes first.
  Rails: `test_every_service_that_builds_the_members_bundle_builds_this_dockerfile`,
  `test_no_other_config_builds_the_frontend_from_this_dockerfile`,
  `test_each_frontend_service_bakes_the_gate_from_its_own_variable`.
- `docs/feature_flags.json`: the row is `armed`, with today's ruling, the mechanism and the override.
- Production-shaped build, measured locally (same flags as production web: member pane, objects-only, runtime pane;
  `html2canvas` and `three` externalised in both builds because the shared `node_modules` predates them):

  | build | `VITE_PINE_STRATEGY_BROKER_ENABLED` baked | `bytes.notebook_first_open` | verdict |
  |---|---|---|---|
  | gate on | `"1"` | 2,259,076 B | PASS (budget 2,260,993) |
  | gate off | `""` | 2,259,075 B | PASS |

  (CI's `notebook bytes` job builds with no VITE flags, so it measures the gate-off bundle, as it already does for the
  runtime pane's flag.)
- What the gate reaches in production on the first deploy: no member (the runtime pane is admins-only); for admins, no
  strategy reaches the broker (admission), so every strategy draws as before and, where the armed route declined, its
  pane now names the decline. No report is shown to anyone until `strategy-decl` is admitted.
- **The owner's steps** (Railway is the owner's; nothing here touches it):
  1. Before the deploy, check the variable is ABSENT on both services (read only):
     `railway variables --service web-front --kv` and `railway variables --service web --kv`, looking for
     `VITE_PINE_STRATEGY_BROKER_ENABLED`. Absent on both: nothing to do, the default arms both bundles.
  2. If `web-front` (or `web`) carries it, as a value or a `${{web.VITE_PINE_STRATEGY_BROKER_ENABLED}}` reference,
     either delete it there (`railway variable delete VITE_PINE_STRATEGY_BROKER_ENABLED --service web-front`, then
     `railway redeploy --service web-front --yes`: a delete does not rebuild) or set it to the literal on both
     (`railway variables --set VITE_PINE_STRATEGY_BROKER_ENABLED=1 --service web-front`, the same for `web`).
  3. To hold it off, on both (a build constant, so each rebuilds):
     `railway variables --set VITE_PINE_STRATEGY_BROKER_ENABLED=0 --service web-front` and the same for `web`.
  4. After the deploy, read the members' bundle, not `web`'s: the served `/assets/index-*.js` through
     uctintelligence.com must carry `VITE_PINE_STRATEGY_BROKER_ENABLED:"1"`.

## 6. Engine number

None needed. The report (`brokerReport.js`) is computed at render and never stored. The door's change is a disclosure
(`meta.disclosures`), presentation only: no plot, value, stamp or compute changes, and no committed fixture or digest
holds a strategy document (`tests/fixtures/**` checked). The gate default is a gate change. A host document of a
strategy whose `strategy()` line is not read, saved before this, carries the new disclosure only when a later engine
number re-translates it.

## 7. Mutation proofs (2026-11-17, each restored from a saved copy, never `git checkout`)

| rail | mutant | result |
|---|---|---|
| `w9ServeCapitalRule.test.js` | drop the percent metric's capital rule | RED (the defaulted-capital case) |
| `strategyBacktestNote.test.js` | drop the host path's `notes.push(strategyNote)` | RED S1 x2, S2 |
| | drop the runtime lane's note | RED S3 x2 |
| | drop `brokerDeclined` from `probeRuntimeProgram` | RED S3 (gate on) |
| | stamp the note on every runtime document | RED C1 |
| `strategyServeCensus.test.js` | drop the runtime lane's note | RED granted (flawless-victory third) |
| | an unpinned rule behind every served metric (`rulesBehind`) | RED granted (every served metric named) |
| | the panel prints an empty refusal | RED granted (empty cells named) |
| | the runtime lane skips its not-graded admission | RED production |
| `tests/test_strategy_serve_arming.py` | drop the ARG default | RED x3 |
| | give `VITE_REALTIME_BARS` a default | RED (only-one-default) |
| | ledger row back to `dark` | RED (ledger) |
| | the detector stops naming `strategy-decl` | RED (server admits no strategy) |
| | `front/service.json` builds another Dockerfile | RED (members' bundle; no other config) |
| | `web-front` stops watching `Dockerfile.web` | RED (members' bundle) |
| | the ledger row's `where` drops `web-front` | RED (ledger) |
