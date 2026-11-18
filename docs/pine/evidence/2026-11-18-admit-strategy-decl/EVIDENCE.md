# `strategy-decl` admitted at engine 77 (2026-11-18)

This follows `docs/pine/evidence/2026-11-17-admit-strategy-decl/EVIDENCE.md`, which recorded the evidence that day and did NOT admit. The coordinator ruled the conditions on 2026-11-18. The governing rule is the owner's: **an admission must never take away what a member sees today.**

Lineage:
- Filed at engine 77: master f5def8bc3c, train e77 = #1833 (the stand-in run draws what no broker value reaches) + #1831 + #1824.
- Re-measured at **engine 78**: master 239c84a903, train e78 = #1858 (tolerant compare), #1847, #1773 (RS newest bar), #1853, with #1885 (the supply-behind-capture grader rule) also on master.
- The merge took the evidence ledger as the union of both sides' rows, in file order: master's 18, then this branch's 2. REACH's report was regenerated, never hand-merged.

## 1. The answer

- **`strategy-decl` is admitted.** `api/data/pine_runtime_allowlist.json` `capabilities["strategy-decl"]` is `admitted: true`, `status: conformant`.
- The A8 rule needs at least 2 captures of at least 2 distinct scripts, at least 1 of them community, each MATCH with the runtime pane on, at the current engine, and drawn by the runtime lane. The evidence:

  | capture | script | community | runtime-on verdict (engine 77) |
  |---|---|---|---|
  | `supertrend-strategy-rddt-1d-2026-11-17` (Q-SD1, packet c6a8904fe026) | SuperTrend STRATEGY | yes (corpus/committed, MPL-2.0) | MATCH: all 9 items agree; strategy MATCH at step 7 |
  | `supertrend-strategy-alab-1d-2026-11-17` (Q-SD2, packet ce79d3c77c33) | SuperTrend STRATEGY | yes | MATCH: all 9 items agree; strategy MATCH at step 7 |
  | `w9-q-s1p-when-rddt-1d-2026-11-15` | W9_Q_S1P_WHEN | no (probe) | MATCH: all 37 items agree; strategy MATCH at step 8 |

  Q-SD1 and Q-SD2 were filed through `evidence_engine` (grade, packet, promote) at engine 77. Their ledger rows have `scriptEngineVersion: 77`.
- **Served on a member's daily bars** (`strategyServeAudit.measure.test.js`, `STRATEGY_SERVE_BARS=product`):
  - **7 of 70 sampled**: consecutive-updown, rsi-strategy, stochastic-slow, buy-monday-exit-tuesday, scalping-strategy-with-williams-r-macd-and-sma-1-minute-only, supertrend-strategy, golden-cross-sma-200.
  - **3 of 25 committed**: buy-monday-exit-tuesday, scalping-…-1-minute-only, supertrend-strategy.
  - Every other strategy is refused by name, at the door, its run, its report, or no-backtest. There is no third state.
  - ⚠️ **These counts are for a chart whose newest bar is CLOSED** (the audit's `newestBarIsForming: false`). Corrected after the 2026-11-18 production check:
    while the newest daily bar is FORMING (in session), the served count is **0** until the rule [B-EXEC] is pinned.
    Each of the three is refused by name, `runtime:strategy-unpinned` [B-EXEC], and keeps its plots.
    The census rail now measures that chart too, and derives its expectation from the pins production reads (`strategyServeCensus.test.js`).

## 2. Nothing a member sees is taken away

`runtime/__tests__/strategyDisarmSuperset.measure.test.js` measures, at engine 77 on a member's daily bars, by identity (plot key/label, cross-checked by style/ordinal; paint kind/ordinal). It covers 228 rows:
- the 70 sampled strategies, on NYSE:RDDT from its listing and on SPY not from it;
- the 88 corpus strategy captures, on their own charts.

| | drawn today | drawn admitted | lost |
|---|---:|---:|---:|
| all rows | 172 | 1,137 | **0** (both identities) |

- supertrend-strategy on SPY daily keeps its seven plots and its bar colour (`strategyRefusalKeepsPlots.test.js`).
- macd-shortlong keeps its six MACD plots; its backtest is refused at the report (B-EXIT-NA).
- stop-loss-and-take-profit is refused at its run: all three of its plots draw `strategy.position_avg_price` (`strategyServeCensus.test.js`).

## 3. Both snapshots regenerated at engine 78, every move accounted

Both snapshots were regenerated over `tests/fixtures/vendor` at engine 78. The licence-held `supertrend-kivancozbilgic-rddt-1d-2026-10-02` was graded from the local capture store and written with its repository path, as before. Counts are by capture id.

| lane | committed ids | regenerated ids | identical | same verdict, record changed | verdict moves | new captures |
|---|---:|---:|---:|---:|---:|---:|
| production | 866 | 935 | 789 | 76 | 1 | 69 (60 INCONCLUSIVE, 7 DIVERGE, 2 MATCH) |
| runtime-on | 866 | 935 | 776 | 55 | 35 | 69 (14 MATCH, 3 MATCH_SUBSTITUTED, 48 INCONCLUSIVE, 4 DIVERGE) |

No capture is gone. The new ones were committed after the snapshots were last derived (engine 68).
- The production lane's 7 new DIVERGE rows are RS Rating captures. Each diverges only on drawing objects this lane already withholds by name (`pine:object-removal-lost`). Their plots are served, MATCH_SUBSTITUTED since #1885 / #1773.
- The host known-divergence derivation (`tools/vendor_harness/host_divergence.py --write`) therefore leaves `hostKnownDivergence.json` unchanged: 28 listed, no script added or dropped. Only its rendering `docs/pine/capture-queue-2026-11-17-host-known-divergence.md` restates the RS Rating count. **RS Rating is not listed.**

Every verdict move, by reason:

| moves | lane | rows | why |
|---|---|---|---|
| 27 INCONCLUSIVE -> MATCH | runtime-on | the W9 strategy probes (w9-d11-late-first-use-rpt, w9-g1-v3-properties, w9-k1..k4, w9-mk1 and -rpt, w9-p3-every-tick-history, w9-q-s1a-size v2 / v4 / v5cash / v5pct / v6, w9-q-s1b-defaults v4 / v5 / v6, w9-q-s1e-live-past, w9-q-s1i-short-v6, w9-q-s1k-exit-levels and -v6, w9-q-s1p-when, w9-r1-risk-allow / -ddown, w9-x3-oca, w9-x4-order, w9-x5-cancel) | the engine-68 snapshot graded every strategy with the broker DARK (declined `pine:strategy-call` at the door). The runtime-on lane has armed the broker since d49d6ab6c9, and each now grades its trades: strategy MATCH at step 7 / 8 on pinned rules |
| 4 MATCH -> INCONCLUSIVE | runtime-on | macd-shortlong-strategy-for-tradingview-input-optimizer RDDT / SPY, tradingview-alerts-to-mt4-mt5-forex RDDT / SPY | the same arming. A broker document graded against a capture with NO Strategy Tester report is INCONCLUSIVE by the fold (SL3). Every plot still agrees ("all N items agree", `verdictWithoutStrategy` MATCH), and §2 shows no member loss |
| 1 DIVERGE -> INCONCLUSIVE | runtime-on | r1-strategy-draws-rddt-1d-2026-10-02 | #1803 (b): graded on the bars TradingView's strategy ran (the ABSENT newest row cut). Its plots agree, and it has no report |
| 2 INCONCLUSIVE -> MATCH | runtime-on | vw-udt-legacy-array-param, vw-w6-forin-fn-two-sites | engine 69 (#1469, imp): `type[]` parameters (b140273575), and a `for … in` in a function body |
| 1 INCONCLUSIVE -> MATCH | both | supertrend-kivancozbilgic-rddt-1d-2026-10-02 (licence-held) | engine 75 (#1788): its one uncompared item was the fill anchor, now drawn |

## 3b. RS Rating weekly at engine 78

At engine 77, `rs-rating-fred6724-w-nvda-1w-2026-11-17` differed on 267 bars:
- the forming week;
- 266 settled weeks, by 2.2e-6 to 7.6e-3 relative. The first was bar 5, 1999-02-22: TradingView 0.10843211775433953 against ours 0.10842949274543663.

At engine 78 with #1885, the grade reads those 266 bars as **MATCH_SUBSTITUTED**: "every one a value on a date where UCT's SPX (FMP ^GSPC, the server's PRIMARY …)" differs from the supply recorded beside the capture. #1773 holds the newest bar INCONCLUSIVE by name. `w-rddt-1w` reads MATCH_SUBSTITUTED on all 139 settled weeks.

## 4. REACH, re-derived with the broker armed

The flag is stubbed ON as the production build arms it (`Dockerfile.web` `ARG VITE_PINE_STRATEGY_BROKER_ENABLED=1`), in `capabilityAdmission.measure.test.js` and in `capabilityEvidenceLane.test.js`. REACH was re-derived in three steps (`capability_admission.py input`, the door in admission mode, `report`).

- 77 admitted captures use `strategy-decl`.
- **MATCH -> DIVERGE: none** (and MATCH_SUBSTITUTED -> DIVERGE: none).
- **Runtime-lane DIVERGE stops at engine 78: 1, `vw-deadband-ticks-brk-a-1d-2026-09-28`** (WITHHELD_WHOLE, as before).
- At engine 77 there were 2 stops. The second, now healed, is kept below for the record:
  - `vw-deadband-ticks-brk-a-1d-2026-09-28`: WITHHELD_WHOLE, as before.
  - `adx-and-di-for-v4-spy-1d-2026-11-17`: a **HELD kill**. It is an indicator, unrelated to strategy-decl, and members see this divergence today with or without the admission.
    - It diverges from bar 5,333 (2014-04-03). There, up move 189.22 - 189.13 = 0.09000000000000341 and down move 188.14 - 188.05 = 0.08999999999997499 differ only in their last binary digits.
    - It is held on the ONE kill list: `api/data/pine_runtime_killlist.json`, `status: "pending"`, `expires: "2026-11-21"`. It is not served (`runtime_definitions.committed_kills` skips it). Its liftWhen is the Q-FCMP ruling (`docs/pine/capture-queue-2026-11-18-float-compare.md`).
    - The REACH and RT1 rails accept its one named capture, re-proved from its record, only until `expires`. Past that date they are red on their own.
- **The held kill is LIFTED** on its own liftWhen: Q-FCMP ruled TOLERANCE (packet 56330c15e071), engine 78 (#1858) compares within 1e-10, and `adx-and-di-for-v4-spy-1d-2026-11-17` grades **MATCH** on the runtime-on lane. The entry is removed from `api/data/pine_runtime_killlist.json`, and its README line records the lift.
  - The held-kill mechanism stays: `status: pending`, `kill_entry_is_served`, the expiry, and the REACH acceptance.
  - Its rails now show the rule on a synthetic held entry, because the committed list holds none.
- `fvg-trend-spy-1d-2026-11-17`, `inside-bar-boxes-spy-1d-2026-11-17` and `trend-targets-algoalpha-spy-1d-2026-11-17` are no longer stops. Since #1842 the paint grade excuses a bar our side withholds inside the run's own curtain.

## 5. Rails

- `tests/test_strategy_serve_arming.py`: `test_the_server_admits_exactly_the_census_list` replaces `test_the_server_admits_no_strategy_today`. It parses `strategyServeCensus.test.js` `SERVER_ADMITS`. `test_CONTROL_admission_is_a_door_not_a_pin` checks that a strategy whose rule is unpinned is still refused by name.
- `tests/test_pine_capability_admission.py`:
  - the admitted list now includes `strategy-decl`;
  - RT1 holds a held kill to its evidence and its expiry;
  - REACH accepts a held kill's capture until its expiry;
  - `test_REACH_a_held_kill_is_one_named_stop_until_its_expiry_and_nothing_else`.
- `strategyServeCensus.test.js`: production admission with `strategy-decl` admitted serves exactly the 3 committed strategies the armed census counts. The control names both refusal places, by the same guard and rule.
- `strategyGrading.test.js` `STRATEGY_CAPTURE_ROWS` gains Q-SD1 / Q-SD2. `vendorHarness.b1Paints.test.js` pins their paints. Their strategy verdict files are under `docs/pine/vendor-harness/strategy-verdicts/`.
- `evidence_engine.py pins --check` and `queue --check`: PASS.
