# The strategy unit: three more community backtests served, on readings committed captures witness (2026-11-19)

Base: `origin/master` `860e30c72a`, engine 87. Branch `feat/strategy-unit`. NUMBER PENDING (`scriptEngineVersion.js`).

Ask (coordinator patrick-2b, owner's "get it all done"): strategy backtests reach members for every strategy the
evidence allows, as fast as honesty permits. Serve only what a reference sentence states or a committed TradingView
capture grades MATCH; refuse the rest by name; never approximate; never take away a correct picture.

## 1. Where things stood at engine 87

- **The daily-chart bar-time gap is fixed**: #1686 (`feat/strategy-epoch-bar-times`, engine 72 train). A broker run is
  handed each bar's opening instant (`runtimeColumns.js::brokerBarTimes` over `indicators.js::barOpenInstants`);
  rail `strategyBarTimeIdentity.test.js`.
- **`strategy-decl` is admitted** (#1859, engine 77, stamped 78): `api/data/pine_runtime_allowlist.json` row
  `admitted: true, status: conformant`, evidence supertrend-strategy on NYSE:RDDT 1D and NASDAQ:ALAB 1D (community,
  corpus/committed, MPL-2.0) and our probe W9-Q-S1p, each MATCH runtime-on. The admission rule (>= 2 captures of
  >= 2 scripts, >= 1 community) is met; admission is no longer the wall.
- [B-EXEC] is pinned (#1899 / #1902, engine 80): an in-session chart is served as of its last closed bar. The route's
  forming flag reaches the run (#1914, engine 81). `request-other` is admitted (#2016), and the census re-latched (#2058).
- 42 broker rules pinned (`brokerPins.resolved.json`).

### The serve census at engine 87, on the member's bar shapes

`strategyServeAudit.measure.test.js` over the coverage map's 70 sampled strategies (25 committed, 45 built-in or
reference sources read from the local sample cache, never committed), broker gate on, each source's own production
admission answer from the server at engine 87 (`tools/pine_coverage/strategy_serve_input.py`: 62 of 70 admitted by
capability). New measure switches (this branch): `STRATEGY_SERVE_REFERENCE` (another committed capture's bars, its own
timeframe and symbol, the exchange spelled as our store spells it), `STRATEGY_SERVE_FORMING=1`,
`STRATEGY_SERVE_FROM_LISTING=product` (the product's own listing rule, `listingSeed.historyFromListingOf`). The baseline
ran on an archive of `860e30c72a` (`git archive`, not a worktree) under the heavy lock.

| chart a member opens | bars | granted served | production served | third |
|---|---|---:|---:|---:|
| NYSE:RDDT 1D, closed, from its 2024 listing | 632 | 7 | 7 | 0 |
| NYSE:RDDT 1D, in session (newest bar forming) | 632 | 7 | 7 | 0 |
| AMEX:SPY 1D from its 1993 listing (deeper than the 5,000-bar window) | 8,473 | 0 | 0 | 0 |
| AMEX:SPY 15 (intraday) | 6,343 | 0 | 0 | 0 |
| NYSE:RDDT 60 (intraday) | 4,417 | 0 | 0 | 0 |

The 7 served: consecutive-updown, rsi-strategy, stochastic-slow (built-ins), buy-monday-exit-tuesday,
scalping-1-minute, supertrend-strategy (committed), golden-cross-sma-200 (reference). On SPY 1D and every intraday chart
every broker run refuses `runtime:strategy-unsettled` Q-S1n ([B-START]: a backtest is served only from the listing; a
5,000-bar window cuts SPY off it, and `historyFromListingOf` is daily-only): 32 runs each, 22 at the run, 10 at the
report with the plots kept (SPY 15: 22 + 9 and one `runtime:chart-clock`). The other refusals, the same on every chart:
door 29 (`pine:request` 7, `pine:module` 6, `pine:no-output` 5, `pine:statement` 2, `pine:state` 2, one each of
`pine:strategy-call`, `pine:block`, `pine:tuple`, `pine:function-def`, `budget:lookback`, `pine:window`, `pine:function`),
no-backtest 9 (`runtime:strategy-repaint` 3, `runtime:strategy-option` 2, the runtime lane's decline 3, a `strategy()`
line not read 1). On RDDT 1D the broker walls behind: Q-S1a 9 (8 at the run: seven percent-of-equity STOP entries and a
percent entry while trades are open; 1 at the report), Q-S1i 6 (margin-call sub-questions), Q-S1b 5 (v4 margin
shapes), B-EXIT-NA 2, Q-S1k 1, Q-S1e 1, `runtime:failed` 1 (the script's own `array.get` at index NaN).

## 2. What this unit serves, and the captures that witness it

Each reading below is witnessed by a committed TradingView report capture that grades MATCH (every trade, fill,
stated report slot and value series) once the broker reads it, and by no text. Each is a rule of its own in
`brokerRules.js`, pinned in `brokerPins.json` by its capture, so the ledger stays self-correcting
(`evidence_engine.resolve_pins`: any later committed row that exercises the rule and is not MATCH un-pins it).

| rule | reading | witness (committed, report ok) | grade before -> after |
|---|---|---|---|
| B-V4-MARGIN0 (extended, ruling D12b point 4) | a Pine v4 `strategy()` of the argument set `title, shorttitle, overlay` or `title, overlay, commission_type, commission_value, default_qty_value, initial_capital`, no margin stated, runs at margins 0 (`ast/strategyBroker.js` V4_MARGIN0_SHAPES) | w9-q-s1b-v4-shape-a-rddt-1d-2026-11-17 and w9-q-s1b-v4-shape-b-rddt-1d-2026-11-17: TradingView read back Margin Long 0 and Margin Short 0 on each | EXPECTED-REFUSAL step 1 -> MATCH step 7 (40 trades each) |
| B-MARGIN-ZERO | at a margin of 0 for the position's direction nothing is margin-called or refused: an equity below zero is carried | w9-q-s1b-v4-shape-b: equity down to -201,004.80 on a 1,000 account (20,000 shares a trade), the report's `marginCalls` 0, all 40 trades run on | (part of the above) |
| B-QTY-REVERSE-M0 | a market `strategy.entry` against every open trade at the percent-of-equity default 100 and MARGINS 0 fills the open size plus floor(strategy.equity at the signal close, the open trades' profit included, / that close), and no funds check rejects it | macd-shortlong-strategy-is-rddt-1d-2026-11-18 (community, corpus/committed, MPL-2.0; v5, capital 1,000, 100% of equity, margins read back 0): its 9 reversals, e.g. bar 88: 19 + floor(1,211.28 / 62.36) = 38; bar 385: 27 x 212.02 = 5,724.54 is past the 5,497.18 it was sized from, and TradingView fills it | DIVERGE step 1 (Q-S1a) -> MATCH step 7 (17 trades, every fill, 9 slots, 6 value series) |
| B-ROUND-LEVEL | a SHORT's `strategy.exit` level off the tick grid that the bar's path reaches fills at the first tick past it in the direction of travel: its stop-loss (a buy stop) the tick above, its take-profit (a buy limit) the tick below | the same capture: stops 115.9543 -> 115.96, 175.7283 -> 175.73, 203.6309 -> 203.64 (the nearest tick would be 115.95, 203.63); limits 50.376 -> 50.37, 138.672 -> 138.67 (the nearest would be 50.38) | (the same) |
| B-EXIT-NA | an exit with every level `na` places nothing (already a named rule, now pinned) | the same capture: its `TP/SL Long` exit with both levels `na` on every long | (the same) |

**Not served, and why.** A percent-of-equity STOP entry (Q-S1a; nine sampled strategies stop there):
`w9-q-s1a-size-stop-v6-rddt-1d-2026-11-17` witnesses floor(equity / its stop level) on all 14 fills (the signal close
refuted on all 14; on bar 274 a stop placed at 113.96 meets an open of 115.03 and 2,387 x 115.03 does not fit the
272,053.09 it was sized from, and TradingView fills nothing, then or later). Built on that reading, our run reproduces
every fill, size and time and still DIVERGEs at step 4: TradingView lists trade 4 (1,636 x (170.09 - 60.68) =
178,994.76) at 178,994.77. No reading of ours explains the cent (its run-up 207,788.36 and drawdown 5,660.56 use 60.68
exactly; a float32 price difference explains it but contradicts w9-q-s1a-size-v5pct and w9-q-s1b-v4-shape-b), and a
DIVERGE whose difference is a profit alone un-pins every rule it exercised (ruling D11 point 5). So the sizing is not
built: the stop entry stays refused by name, as before, and the off-grid ENTRY level stays unrounded (B-ROUND-LEVEL
names a short's exits only). The capture rows that ask again: `capture-queue-2026-11-19-strategy-unit.md` Q-SU-STOP.

## 3. Nothing else moves

- `strategyGrading.test.js` over all 56 committed report captures: exactly the three verdict files above move; every
  other verdict is byte-identical (UPDATE_STRATEGY_VERDICTS=1 rewrote only line endings elsewhere).
- `evidence_engine.py pins`: 42 -> 46 pinned rules (B-EXIT-NA, B-MARGIN-ZERO, B-QTY-REVERSE-M0, B-ROUND-LEVEL added;
  B-V4-MARGIN0 gains its two shape captures); `pins --check` PASS. No pinned rule lost.
- The vocabulary 60 -> 63 rules (B-ROUND-LEVEL, B-QTY-REVERSE-M0, B-MARGIN-ZERO), each with its capture row.
- Every new branch is reached only by a strategy run on its own shape: margins 0 with a negative equity, a
  percent-of-equity reversal at margins 0, an off-grid short exit level, a v4 declaration of one of the two shapes.
  Before this unit each of those runs stopped by name (Q-S1i, Q-S1a, Q-S1b), or, for an off-grid short exit, filled
  at the raw level with the trade marked off the grid, every read of it and every figure resting on it withheld by
  name (Q-S1l). Nothing that was served moves: what was refused is now served where the captures witness it.

### The serve census after this unit (the same 70, the same five charts)

Run on an archive of this branch's commit `848327bab6` under the heavy lock; compared row by row with the baseline
(state, place, guard, rule; for a row served in both, its trade count and every served metric value).

| chart | granted served | production served | rows that moved | third |
|---|---:|---:|---|---:|
| NYSE:RDDT 1D, closed | 7 -> **10** | 7 -> **10** | +highlow-channel-swing (was Q-S1b), +macd-shortlong (was B-EXIT-NA, 15 trades), +stop-loss-and-take-profit (was B-EXIT-NA, 21 trades); tradingview-alerts-forex refused by another name (Q-S1b -> `runtime:strategy-unpinned` B-EXIT-QTY) | 0 |
| NYSE:RDDT 1D, in session | 7 -> **10** | 7 -> **10** | the same four | 0 |
| AMEX:SPY 1D from 1993 | 0 -> 0 | 0 -> 0 | none | 0 |
| AMEX:SPY 15 | 0 -> 0 | 0 -> 0 | none | 0 |
| NYSE:RDDT 60 | 0 -> 0 | 0 -> 0 | none | 0 |

Every row served before is served after with the same trades and every served metric value equal. The committed
standing rail `strategyServeCensus.test.js` (25 committed) is re-measured with it: `ARMED_COMMITTED` 3 -> 6, closed, in
session and one bar stale after a lost flag; its "admission is a door, not a pin" control now names B-EXIT-QTY
(tradingview-alerts-forex), and `tests/test_strategy_serve_arming.py` holds the same.

## 4. The lock (the train's act)

`brokerPins.resolved.json` sha256 `1db04b152271aaacbba6ed4b10f1f15b2dba6d40d563b299c275b97280d72b74` (46 rules). With
the train's number N:
- append `"N": "1db04b152271aaacbba6ed4b10f1f15b2dba6d40d563b299c275b97280d72b74"` to `brokerPins.lock.json`;
- set `COMMITTED_OLDER_DIGEST` in `brokerPinsLock.test.js` to
  `810f4850c9a1cf9f74b0c1d56ce1f5a4b3f545b3686c1885e6856c72b8da27fa` (the older entries 17, 60, 66, 68, 80).

Computed with `brokerPinsLock.js` (`olderEntriesDigest`; `checkLock` with the entry appended: ok). Until then
`brokerPinsLock.test.js` "the committed ledger, lock and engine version agree" is red by design
(`ledger-changed-without-a-lock-entry`), as at #1899. The runtime-on harness snapshot moves too when it is next
regenerated at the train's number: macd-shortlong-strategy-is, w9-q-s1b-v4-shape-a and -b grade MATCH there.

## 5. Mutation proofs

Each mutant applied to the archive of `848327bab6` (the strategy-verdict files read through a junction to the worktree,
unchanged), its rails run, the file restored from a saved copy (never `git checkout`), restored byte-equal every time.
M1 and M8's census leg were re-run after `api/data` was added to the archive (the first run's census leg could not read
the kill list and failed for that reason; the re-run fails on the served set).

| mutant | what it breaks | result |
|---|---|---|
| M1 `strategyBroker.js`: drop shape a from V4_MARGIN0_SHAPES | the shorttitle shape refuses Q-S1b again | RED `w9ValueReadbacks` (2), `strategyGrading` shape-a (1), `strategyServeCensus` (5) |
| M2 `broker.js`: no [B-MARGIN-ZERO] branch | a negative equity at margin 0 stops Q-S1i | RED `strategyWitnessedReadings` (1), `strategyGrading` shape-b (1) |
| M3 `broker.js`: [B-QTY-REVERSE-M0] at a margin of 7 | the margin-0 reversal refuses Q-S1a | RED `strategyWitnessedReadings` (2), `strategyGrading` macd-shortlong-is (1) |
| M4 `broker.js`: an off-grid exit level rounds to the nearest tick | 115.9543 fills at 115.95, not 115.96 | RED `strategyWitnessedReadings` (3), `strategyGrading` macd-shortlong-is (1) |
| M5 `broker.js`: rounding served for a long's exits too | a sell level rounds unwitnessed | RED `strategyWitnessedReadings` (1) |
| M6 `broker.js`: no check that the tick lies on the bar's path | a tick past the bar's extreme fills | RED `strategyWitnessedReadings` (1) |
| M7 `broker.js`: the margin-0 reversal carries the funds check | bar 385's reversal is rejected | RED `strategyWitnessedReadings` (1), `strategyGrading` macd-shortlong-is (1) |
| M8 `strategyServeCensus.test.js`: stop-loss-and-take-profit dropped from ARMED_COMMITTED | the census no longer matches what is served | RED `strategyServeCensus` (5) |

## 6. Runs

- Baseline census (archive of `860e30c72a`) and after census (archive of `848327bab6`), 70 rows x 2 admission states x
  5 charts, heavy lock; `docs/pine/coverage-map.json` keys, `cov-e71` sources (local).
- `strategyGrading.test.js` all 56 committed report captures: 3 verdict files moved (macd-shortlong-is, shape-a,
  shape-b), every other byte-identical.
- Remote (`tools/remote_tests.py`, `remote tests` run 44671361019, 4 shards) on `848327bab6`: the whole
  `runtime/__tests__` directory, the strategy harness rails, `strategiesAreRuled`, `strategyBacktestNote`,
  `pendingNumbers`, and `tests/test_strategy_serve_arming.py`, `tests/test_broker_pins_resolve.py`,
  `tests/test_pine_capability_admission.py`. Red: `brokerPinsLock` (by design until the train's lock entry, section 4),
  `strategyDisarmedTaint` and the D7 count in `w9T5Costs` / `w9T8Risk`, all three fixed in `ec8e8e190d` and
  `81d9054933` (the RDDT macd-shortlong case is served now; 42 -> 46). pytest green.
- `evidence_engine.py pins --check` PASS; `queue --check` PASS; `refusal_codes.py --check` ok (no new guard).
