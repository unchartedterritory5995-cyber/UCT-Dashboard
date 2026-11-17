# A strategy on a member's daily chart records epoch trade times (2026-11-17)

Ask (coordinator, after #1677's finding A): a member's daily chart hands the runtime lane `/api/bars`'s ISO DATE keys
(`t: "2024-03-21"`), so a strategy run's bar times were dates; `brokerReport.js::strategyReportOf` refused the whole
report and every trade-time read refused by name. Find the ONE authority that turns a product bar key into Pine's `time`,
route the broker and the report through it, prove it with a rail, re-run #1664's census on the member's bar shape,
re-grade the 60 W9 report captures runtime-on with the broker armed, and show that no non-strategy output moves.
`strategy-decl` is NOT admitted here (admission is the next unit, after Q-SD1 / Q-SD2).

Base: `origin/feat/admit-strategy-decl` `d49d6ab6c9` (#1677). Branch `feat/strategy-epoch-bar-times`. Engine 71 with a
NUMBER PENDING line (section 8).

## 1. How bar time reaches Pine, lane by lane (before)

| reader | what it read | on a daily product chart |
|---|---|---|
| bare `time`, `time_close`, `hour`, `dayofweek`, the session clock (host lane AND the runtime lane's columns) | `indicators.js::computeClock` -> `barOpenInstant(t, tf)`: an ISO date on D / W / M is 09:30 America/New_York of the bar's first session, unix seconds; a number passes as itself (>= 1990); one unreadable bar blanks the whole series | the instant. `time` is that column x 1000 (`interpret.js`, `objectColumns.js::readTime`) |
| the runtime VM's own clock ops (`OP.READ_CLOCK`, `OP.SESSION`) | `ctx.barTimes` = the raw keys (`runtimeColumns.js`) | `etClockAt('2024-03-21')` is `null` -> `na`; measured: a pure `hour(time)` / `dayofweek(time)` / `ta.vwap` / session test is folded into a COLUMN by the front end and reads 9 / 2 / the vwap / 1 on the keys anyway (probe below) |
| the strategy broker: fills, trades, orders (`broker.js` `timeOf`), `strategy.closedtrades.entry_time` / `exit_time`, `strategy.opentrades.entry_time` (`barTimeMs`) | `ctx.barTimes` = the raw keys | a DATE STRING per trade and order; every trade-time read refused by name (`runtime:strategy-unsettled`, "reads the time of a bar this run was given no time for") |
| the record's window (`strategyRecord.js::strategyRecordOf` `startTime` / `asOfBar`) | the raw keys | `null` (`Number.isFinite` fails) |
| the report (`brokerReport.js::strategyReportOf`) | the record | refused whole, `runtime:strategy-report-record`, its `fields` naming every `orders[i].placedTime` / `fill` |
| the trade markers (`tradeMarkers.js`, `x: time * 1000`, `xloc.bar_time`) | the record, through the same shape check (`strategyRecordShapeErrors`) | not measured here (MK-LOOK is unpinned, so markers refuse by name anyway); the record they read now holds the seconds instants their `x * 1000` expects |

THE AUTHORITY, and its agreement with TradingView: `barOpenInstant` reproduces TradingView's own 1D `time` from the date
alone on every row of `harness/vw-bool-cast-spy-1d-2026-09-28` and `vw-time-session-spy-1d-2026-09-27` (8,000+ rows each,
both DST halves), weekly on 1,758 SPY rows (`ast/sessionClockDailyBars.test.js`, `vendorHarness.c49CapturedClock.test.js`).
On the fixture this PR uses (NYSE:RDDT 1D, `k-clustering-rddt-1d-2026-09-28`, 632 bars) `computeClock(productBars).time`
equals the capture's bar time on all 632 bars.

What the broker received, measured through the member's product path (memberPaneDefinition -> installUserDefinitions ->
computeRuntimeColumns, broker gate on, admission granted, committed pin ledger), supertrend-strategy on RDDT 1D:

| bars handed | trades | first 3 trades (entry, exit) | window.startTime | order 1 placed / filled | report |
|---|---:|---|---|---|---|
| epoch seconds (`barsOfCapture`) | 11 | (1722346200, 1726839000) (1726839000, 1739975400) (1739975400, 1747315800) | 1711027800 | 1722259800 / 1722346200 | ok |
| product ISO dates, BEFORE | 11 | ("2024-07-30", "2024-09-20") ("2024-09-20", "2025-02-19") ("2025-02-19", "2025-05-15") | null | "2024-07-29" / "2024-07-30" | refused whole (`runtime:strategy-report-record`) |
| product ISO dates, AFTER | 11 | (1722346200, 1726839000) (1726839000, 1739975400) (1739975400, 1747315800) | 1711027800 | 1722259800 / 1722346200 | ok |

A synthetic probe (`strategy.closedtrades.entry_time` of the last closed trade, and `time`): epoch 1789392600000 /
1790602200000; product BEFORE the run stopped `runtime:strategy-unsettled`; product AFTER 1789392600000 / 1790602200000.

## 2. The change: one gate, two readers

- `indicators.js::barOpenInstants(bars, tf)` is the unit gate AS ONE FUNCTION: each `t` through `barOpenInstant`, all or
  nothing. `computeClock` now reads its `time` column (and every clock column built on it) from it; the loop it had is
  gone, so there is no second copy of the gate.
- `runtimeColumns.js::brokerBarTimes(rows, tf)` = `barOpenInstants(rows, tf)` as a plain array, or `NaN` on every bar when
  the gate reads none (one unreadable bar blanks `time` on every bar, and so here). `computeRuntimeColumns` hands a
  BROKER run those instants as its `barTimes`, and hands the record the SAME array: the broker's fills / trades / orders,
  `barTimeMs` (x 1000, as `time` is the column x 1000), the record window and the VM's clock ops all read one array,
  derived once per run. The `tf` is the run's own (`ctx.tf`), the one the columnar lane's `computeClock` is handed.
- A run WITHOUT a broker keeps the keys it always had (`runProgram.broker ? brokerBarTimes(rows, tf) : barTimes`):
  non-strategy output cannot move (section 7).
- Harness: `strategyLane.js::recordOnCaptureClock` is gone. It mapped each recorded product KEY onto the capture's bar
  time, which made the grade read TradingView's clock whatever the run recorded; the record is now graded on its OWN
  times, so a run that records a date, or an instant off TradingView's, grades as what it is. (`ourSide.js::strategyRunOf`
  no longer builds `unixOf`.)

## 3. The identity rail and its mutants

`app/src/components/chart/engine/runtime/__tests__/strategyBarTimeIdentity.test.js` (4 tests): supertrend-strategy
(corpus/committed) over NYSE:RDDT 1D (`k-clustering-rddt-1d-2026-09-28`) given as product ISO-date keys and as epoch
seconds, through the member's product path, committed pin ledger:

- control: the two shapes are two shapes (632 ISO strings / 632 integers), same OHLC;
- T1: the record's JSON and the report's JSON are BYTE-IDENTICAL across the shapes, the report is served, the run trades
  (11 > 5);
- T2: every time the record states (window, each trade's entry and exit, each order's placed / modified / triggered /
  filled / ended) is one of the capture's own bar times (TradingView's `time`), and the window starts at the capture's
  first bar: T1 cannot pass by being wrong the same way twice;
- T3: a synthetic `strategy.closedtrades.entry_time` probe draws the same columns on both shapes, its last value the
  record's last closed entry time x 1000, a capture bar time in ms.

`strategyServeCensus.test.js` gains a leg: the granted census over the same 25 committed strategies on the member's
DAILY bars answers script by script as on epoch seconds (same state, door / run / report, guard; same trade count when
served); served = the armed census's 3.

`strategyLane.test.js` SL7 is rewritten: its capture (w9-q-s1a-size-v2) was the real refused report; on the member's
daily bars it now grades MATCH (indicator and strategy). The refused-whole branch is held on that run's own record with
one trade time put back to the date it used to be: EXPECTED-REFUSAL by `runtime:strategy-report-record`, nothing compared.

Each mutant applied to the working tree, the rail run, the file restored from a saved copy (never `git checkout`) and
compared byte for byte (`restored byte-equal: True` for every one).

| mutant | what it breaks | result |
|---|---|---|
| M1 `runtimeColumns.js`: `const runTimes = barTimes` | the broker is handed the KEYS again (the bug) | RED x4: identity T1, T2, T3 and the census rail's daily-bars leg |
| M2 `runtimeColumns.js::brokerBarTimes`: the gate asked with no `tf` | an ISO date is unreadable -> `na` on every bar | RED x3: T1, T2, T3 |
| M3 `indicators.js::barOpenInstants`: each instant 60 s off the open | both shapes wrong THE SAME WAY | RED x2: T2, T3 (T1 stays green: why T2 exists) |
| M4 `runtimeColumns.js`: the record handed the keys, the broker the instants | the record window disagrees with its trades | RED x2: T1, T2 |
| M5 `strategyLane.js`: a report refused whole is compared anyway | the harness grades a withheld report | RED: SL7 "a record the report cannot read ... refuses whole by name" |

Baselines (the same runs, unmutated): identity + strategyLane 22 / 22; identity + census 8 / 8.

## 4. The census on the member's bar shape (#1664's audit, `STRATEGY_SERVE_BARS=product`)

`strategyServeAudit.measure.test.js`, broker gate on, the same input as #1664 / #1677 (the 70 sampled rows and the 25
committed, each with the server's own production-shaped admission answer), reference bars NYSE:RDDT 1D.

| census | bars | granted, before | granted, AFTER | production (what members are served) |
|---|---|---:|---:|---:|
| 70 sampled | epoch seconds (`barsOfCapture`) | 7 (#1664 `serve_70_final`) | **7** | 0 |
| 70 sampled | a member's daily bars (`STRATEGY_SERVE_BARS=product`, ISO keys) | 2 (#1677) | **7** | 0 |
| 25 committed | epoch seconds | 3 | **3** | 0 |
| 25 committed | a member's daily bars | 2 | **3** | 0 |

Row by row (state, where refused, guard, rule; and for a served row its trades, every served metric value, every
withheld metric's guard and the trade list):

- 70 sampled, member's daily bars AFTER vs epoch seconds AFTER: **0 differences** in 70 rows x 2 admission states;
  25 committed: **0 differences**.
- Epoch seconds AFTER vs #1664's own run: **0 differences** (70 and 25): the epoch path is untouched.
- Member's daily bars BEFORE (#1677) vs AFTER: exactly 5 rows move, all `granted`, each from `refused` at the report
  (`runtime:strategy-report-record`) to `served`: consecutive-updown (48 trades), rsi-strategy (13),
  stochastic-slow (27), supertrend-strategy (11), golden-cross-sma-200-chartart (1). Every other row is unchanged.
- Served granted (both shapes): those 5 plus buy-monday-exit-tuesday and scalping-1-minute (0 trades each, as before).
- Production admission: 0 of 70, 0 of 25, both shapes, before and after (`strategy-decl` has no registry row).
- No row is a third state, in any run.

## 5. The 60 W9 Strategy Tester captures, re-graded runtime-on with the broker armed

`VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=<the 60 capture files> vendorHarness.corpus.test.js` (#1677's
strategyLane: the broker gate stubbed on as production builds it, admission granted, the member door's broker document,
`registry.computeFor`, the report on the COMMITTED pin ledger, ONE strategy grade, THE FOLD). Grades:
`grades-w9-60.json` here (grades only; every capture is committed under `tests/fixtures/vendor/harness/`).

Lane line: `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 60, host refusals 60) · objects-only pane ARMED ·
runtime drew 54, declined 6 · strategy lane: broker gate ON, 60 graded on their trades, 54 broker run(s)` (as #1677's).

| tally | before (#1677) | AFTER |
|---|---:|---:|
| MATCH | 0 | **27** |
| DIVERGE | 0 | **0** |
| INCONCLUSIVE | 60 | **33** |

- The 29 #1677 named as stopped by the date gap (25 on `strategy.closedtrades.entry_time`, 4 with the report refused
  whole): **27 now MATCH** on every trade, fill, stated report slot, value series and drawn text, with the trade counts
  TradingView's report states (7 to 40 trades each); 2 do not: `s1-broker-core` now runs past the trade-time read and
  stops by name at the next open question (`runtime:strategy-unsettled`, Q-S1d: two orders fill on one opening tick), and
  `w9-d11-late-first-use` (its non-`-rpt` twin, report not read: `not-requested`) draws every plot equal (indicator
  MATCH) but holds no report to grade its 32 trades against (INCONCLUSIVE, as THE FOLD rules).
- The other 31 are unchanged, row for row (verdict, strategy verdict, refusal guard): Q-S1d / e / h / k / n unsettled 13,
  unpinned rules 12 (B-STOP-LIMIT 3, B-PYR-PRICE 2, B-EXIT-LEVELS 2, B-POC 2, B-FILLS, B-TRAIL, B-EXIT-QTY), refused at
  the door 6; 10 `-rpt` captures under the 5-trade floor stay UNGRADABLE.
- DIVERGE 0: no run that now finishes disagrees with TradingView anywhere, and none was mapped onto TradingView's clock
  (the harness mapping is gone, section 2).

| # | capture | verdict | indicator | strategy | trades ours / TV | before | named by |
|---:|---|---|---|---|---|---|---|
| 1 | `s1-broker-core-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 47 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unsettled`: 2 orders fill on the same opening tick, and the order TradingView fills them in is not stated (unsettled: Q-S1d, docs/pine/capture-queue-2026-10-05-s1 |
| 2 | `vw-s1-q-s1d-close-reverse-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unsettled`: 2 orders fill on the same opening tick, and the order TradingView fills them in is not stated (unsettled: Q-S1d, docs/pine/capture-queue-2026-10-05-s1 |
| 3 | `vw-s1-q-s1d-close-reverse-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 2 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unsettled`: 2 orders fill on the same opening tick, and the order TradingView fills them in is not stated (unsettled: Q-S1d, docs/pine/capture-queue-2026-10-05-s1 |
| 4 | `vw-s1-q-s1d-two-entries-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unsettled`: the entry `A` filled on an opening tick where 1 later entry waits, and what TradingView does with them then is not witnessed (unsettled: Q-S1d, docs/p |
| 5 | `vw-s1-q-s1d-two-entries-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 2 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unsettled`: the entry `A` filled on an opening tick where 1 later entry waits, and what TradingView does with them then is not witnessed (unsettled: Q-S1d, docs/p |
| 6 | `vw-s1-q-s1d-two-stops-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unsettled`: 2 orders sit at the same price 59.21, and the order TradingView fills them in is not stated (unsettled: Q-S1d, docs/pine/capture-queue-2026-10-05-s1.m |
| 7 | `vw-s1-q-s1d-two-stops-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 2 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unsettled`: 2 orders sit at the same price 59.21, and the order TradingView fills them in is not stated (unsettled: Q-S1d, docs/pine/capture-queue-2026-10-05-s1.m |
| 8 | `vw-s1-q-s1e-stop-past-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unsettled`: exit `x` became active at a price already past its level, and where TradingView fills it then is not stated (unsettled: Q-S1e, docs/pine/capture-queue |
| 9 | `vw-s1-q-s1e-stop-past-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 1 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unsettled`: exit `x` became active at a price already past its level, and where TradingView fills it then is not stated (unsettled: Q-S1e, docs/pine/capture-queue |
| 10 | `vw-s1-q-s1g-blocked-stop-entry-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unpinned`: the broker rule B-PYR-PRICE is not pinned by a matching TradingView capture (capture row Q-S1g, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 11 | `vw-s1-q-s1g-blocked-stop-entry-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 1 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unpinned`: the broker rule B-PYR-PRICE is not pinned by a matching TradingView capture (capture row Q-S1g, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 12 | `vw-s1-q-s1h-fifo-exit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unsettled`: an exit targets an open trade that is not the oldest, and TradingView closes the oldest trades first (FIFO) with a split this broker does not model (u |
| 13 | `vw-s1-q-s1h-fifo-exit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 3 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unsettled`: an exit targets an open trade that is not the oldest, and TradingView closes the oldest trades first (FIFO) with a split this broker does not model (u |
| 14 | `vw-s1-q-s1j-stop-limit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unpinned`: the broker rule B-STOP-LIMIT is not pinned by a matching TradingView capture (capture row Q-S1j, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 15 | `vw-s1-q-s1j-stop-limit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 1 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unpinned`: the broker rule B-STOP-LIMIT is not pinned by a matching TradingView capture (capture row Q-S1j, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 16 | `vw-s1-q-s1k-fractional-profit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unsettled`: `strategy.exit` with a distance of 150.5 ticks, not a whole number of ticks (unsettled: Q-S1k, docs/pine/capture-queue-2026-10-05-s1.md) |
| 17 | `vw-s1-q-s1k-fractional-profit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 1 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unsettled`: `strategy.exit` with a distance of 150.5 ticks, not a whole number of ticks (unsettled: Q-S1k, docs/pine/capture-queue-2026-10-05-s1.md) |
| 18 | `vw-s1-q-s1k-na-modify-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `door`: the member door refused the script, so nothing was run |
| 19 | `vw-s1-q-s1k-na-modify-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 1 | INCONCLUSIVE / UNGRADABLE | `door`: the member door refused the script, so nothing was run |
| 20 | `vw-s1-q-s1k-profit-and-limit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `runtime:strategy-unpinned`: the broker rule B-EXIT-LEVELS is not pinned by a matching TradingView capture (capture row Q-S1k, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 21 | `vw-s1-q-s1k-profit-and-limit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE | - / 1 | INCONCLUSIVE / UNGRADABLE | `runtime:strategy-unpinned`: the broker rule B-EXIT-LEVELS is not pinned by a matching TradingView capture (capture row Q-S1k, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 22 | `w9-d1-margin50-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE | - / - | INCONCLUSIVE / INCONCLUSIVE | `door`: the member door refused the script, so nothing was run |
| 23 | `w9-d1-margin50-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | `door`: the member door refused the script, so nothing was run |
| 24 | `w9-d11-late-first-use-rddt-1d-2026-11-16` | INCONCLUSIVE | MATCH | INCONCLUSIVE | 32 / None | INCONCLUSIVE / INCONCLUSIVE | strategy-reference: the report is not-requested |
| 25 | `w9-d11-late-first-use-rpt-rddt-1d-2026-11-16` | MATCH | MATCH | MATCH | 32 / 32 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 26 | `w9-g1-v3-properties-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar |
| 27 | `w9-k1-commission-pct-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 28 | `w9-k2-commission-contract-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 29 | `w9-k3-commission-order-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 30 | `w9-k4-slippage-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 31 | `w9-mk1-markers-rddt-1d-2026-11-16` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 32 | `w9-mk1-markers-rpt-rddt-1d-2026-11-16` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 33 | `w9-p1-on-close-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 23 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unpinned`: the broker rule B-POC is not pinned by a matching TradingView capture (capture row W9-P1, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 34 | `w9-p1b-on-close-fills-nv-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 40 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unpinned`: the broker rule B-POC is not pinned by a matching TradingView capture (capture row W9-P1, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 35 | `w9-p1b-on-close-fills-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | `door`: the member door refused the script, so nothing was run |
| 36 | `w9-p2-order-fills-nv-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 40 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unpinned`: the broker rule B-FILLS is not pinned by a matching TradingView capture (capture row W9-P2, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 37 | `w9-p2-order-fills-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | `door`: the member door refused the script, so nothing was run |
| 38 | `w9-p3-every-tick-history-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 39 | `w9-q-s1a-size-v2-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar |
| 40 | `w9-q-s1a-size-v4-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar |
| 41 | `w9-q-s1a-size-v5cash-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 42 | `w9-q-s1a-size-v5pct-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 43 | `w9-q-s1a-size-v6-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 7 / 7 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 44 | `w9-q-s1b-defaults-v4-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 40 / 40 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar |
| 45 | `w9-q-s1b-defaults-v5-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 40 / 40 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 46 | `w9-q-s1b-defaults-v6-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 31 / 31 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 47 | `w9-q-s1e-live-past-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 48 | `w9-q-s1i-short-v6-rddt-1d-2026-11-16` | MATCH | MATCH | MATCH | 23 / 23 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 49 | `w9-q-s1j-stop-limit-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 19 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unpinned`: the broker rule B-STOP-LIMIT is not pinned by a matching TradingView capture (capture row Q-S1j, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 50 | `w9-q-s1k-exit-levels-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 51 | `w9-q-s1k-exit-levels-v6-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 52 | `w9-q-s1p-when-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 53 | `w9-r1-risk-allow-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 54 | `w9-r1-risk-ddown-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 40 / 40 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 55 | `w9-r1-risk-intraday-range-spy-15-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unsettled`: this strategy's trades depend on the bar its backtest starts from, and this run is not known to start at the symbol's first bar (unsettled: Q-S1n, doc |
| 56 | `w9-x1-trail-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unpinned`: the broker rule B-TRAIL is not pinned by a matching TradingView capture (capture row W9-X1, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 57 | `w9-x2-partial-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | - / 40 | INCONCLUSIVE / EXPECTED-REFUSAL | `runtime:strategy-unpinned`: the broker rule B-EXIT-QTY is not pinned by a matching TradingView capture (capture row W9-X2, docs/pine/W9-STRATEGY-DESIGN.md 5.2) |
| 58 | `w9-x3-oca-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 59 | `w9-x4-order-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 20 / 20 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |
| 60 | `w9-x5-cancel-rddt-1d-2026-11-15` | MATCH | MATCH | MATCH | 22 / 22 | INCONCLUSIVE / EXPECTED-REFUSAL | every trade, fill and stated report slot equal; every value series equal bar by bar; every drawn text equal |

## 6. Would `strategy-decl` meet the admission rule now?

**No.** `strategy-decl` would NOT meet the rule (`rollout_gate.py::pine_capability_admission`: >= 2 captures of >= 2
distinct scripts graded MATCH runtime-on, **at least one a COMMUNITY script**). The 27 MATCHes are 26 distinct scripts,
every one of them OUR probe (`W9_*` / `UCTPROBE_*`, classified as probes since #1677's `PINE_PROBE_PREFIXES` fix): 0
community. The community strategy captures still cannot grade MATCH: the nine 2026-11-15 community captures that hold a
report are refused at the door (`pine:block`, `pine:module`, `pine:request`, re-graded below, unchanged), and
supertrend-strategy's committed captures hold no Strategy Tester report. So admission waits on **Q-SD1 / Q-SD2**
(supertrend-strategy on NYSE:RDDT 1D / NASDAQ:ALAB 1D WITH its report): this PR makes that capture gradeable on the
member's path (supertrend-strategy is SERVED on RDDT 1D daily bars, 11 trades, its record byte-identical to the epoch-second
run), and any one of the 27 W9 MATCHes is then the second script. `api/data/pine_runtime_allowlist.json` is untouched;
`strategy-decl` is NOT admitted.

The other 22 strategy-declaring captures (`grades-other-22.json` here, same run shape): **4 MATCH / 4 DIVERGE / 14
INCONCLUSIVE, every row unchanged from #1677** (verdict, strategy verdict, refusal guard): none of them was stopped by the
date gap (the 9 community captures with a report are refused at the door; the rest are host-drawn, have no report, or stop
by name: supertrend-strategy-spy-1d, Q-S1n).

## 7. Nothing that is not a strategy moves

`time` does not change for any script: `computeClock` reads its instants from `barOpenInstants`, the loop it already
ran, moved into a function (same rule, all or nothing, same `Float64Array`); and a run without a broker is handed the
same `barTimes` array it always was (`runProgram.broker ? brokerBarTimes(rows, tf) : barTimes`). Measured:

- **host parity, `node tools/pine_runtime_host_parity.mjs --host node --check`** (a server bundle built fresh from this
  tree): `HP-1 GREEN: 166/166 cases equal the committed digests`, exit 0. The digests are untouched (engine identity
  unchanged: NUMBER PENDING, no bump).
- **the census on epoch seconds**: 70 sampled and 25 committed, 0 differences from #1664's own run, every row, both
  admission states, every served metric value.
- **the other 22 strategy-declaring captures**: 4 / 4 / 14, every row unchanged (none was stopped by the gap).
- **the focused rails** (one local run, 1,017 tests in 35 files, 0 failures): every `runtime/__tests__/w9*` broker file,
  `s1StrategyBroker`, `w9T14ServerRecord` (the server record fixture: epoch-second bars, byte-equal), `strategyBrokerGate.product`,
  `ast/sessionClockDailyBars` (`barOpenInstant` against TradingView's 1D `time`, 8,000+ rows), `ast/sessionClockParity`,
  `ast/barstate*`, `__tests__/objectBarTime`, `vendorHarness.c49CapturedClock`, `vendorHarness.fxClock`, the strategy
  harness rails (`strategyLane`, `strategyGrade`, `strategyGrading`, `strategyReadbackWitness`, `strategyNewestBarUnrun`),
  plus the two rails above (identity 4 / 4, census 4 / 4).
- **the corpus harness, both lanes, A/B on the non-strategy rows**: this PR's `pine heavy` run (the vendor harness over all
  committed captures, production and runtime-on lanes) against #1677's own run of the same jobs on its head `d49d6ab6c9`
  (run 44138415226), same CI environment; every row whose capture is not a strategy compared (verdict, reason, every plot's
  verdict). The result is posted on the PR (it needs this PR's CI run, after its one push).

## 8. Engine number

NUMBER PENDING (`scriptEngineVersion.js`, the line above `SCRIPT_ENGINE_VERSION = 71`): the broker's served output on a
date-keyed chart changes (a strategy's record and report, its trade-time reads, the VM clock of a broker run). Behind the
strategy broker gate and the runtime lane's capability admission (`strategy-decl` has no registry row), so what a member
is served in production does not change today. The coordinator numbers the train; nothing here bumps it.

## 9. Runs

All local runs under `uct-clips/tools/heavy_lock.py`, one at a time, from `app/` of this tree. Licence-held built-in /
reference sources of the 70-row census stayed in the local sample cache; only grades are committed.

- probe (local, not committed): the bar times the broker receives, before and after (section 1);
- `strategyBarTimeIdentity.test.js` + `strategyLane.test.js` + `strategyServeCensus.test.js`, then mutants M1..M5;
- serve audit `STRATEGY_SERVE_BARS=product` and unset: 70 sampled (`serve_input` of #1664, its committed paths re-pointed
  at this tree, sources byte-equal) and 25 committed;
- runtime-on vendor harness: the 60 W9 report captures (27 / 0 / 33) and the other 22 strategy-declaring captures (4 / 4 / 14);
- `pine_runtime_host_parity.mjs --host node --check`: HP-1 GREEN 166 / 166;
- the focused vitest set above: 1,017 passed, 1 skipped (a measurement file without its env), 0 failed.
