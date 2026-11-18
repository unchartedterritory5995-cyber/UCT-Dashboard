# `strategy-decl` admission: the evidence asked for, graded, and NOT admitted (2026-11-17)

Ask (coordinator, after #1664's readiness audit): produce the evidence that lets the server admit Pine strategy
declarations, so witnessed strategy backtests reach members; grade the 60 W9 Strategy Tester report captures with the
broker ARMED; admit `strategy-decl` if the evidence meets the rule, otherwise record what is missing and queue it.

Base: `origin/feat/serve-witnessed-strategy-backtests` `d112a95d2c` (#1664, not yet on master: this branch needs its
`strategyServe.js`, `brokerDeclined` and census). Branch `feat/admit-strategy-decl`. Engine 71, unchanged.

## 1. The answer

- **`strategy-decl` is NOT admitted.** `api/data/pine_runtime_allowlist.json` is unchanged and
  `tests/test_strategy_serve_arming.py::test_the_server_admits_no_strategy_today` stays green as it is.
- **The 60 W9 captures, graded on the member's path with the broker armed: 0 MATCH, 0 DIVERGE, 60 INCONCLUSIVE.**
  Not one is evidence. The table is section 4.
- **Even 60 MATCHes would not admit it.** Every one of the 60 is OUR probe (`UCTPROBE_S1_BROKER`, `vw-s1-*`,
  `W9_*`), and the rule needs a COMMUNITY script. The evidence classifier counted 35 of them as community (the `W9_`
  titles); fixed here (section 6), so a strategy capability cannot be admitted on probes alone.
- **The first wall is an engine gap, not a capture.** A member's DAILY chart hands the runtime lane `/api/bars`'s ISO
  date keys, so a strategy run's bar times are dates: the report refuses WHOLE (`runtime:strategy-report-record`) and
  every `strategy.closedtrades.entry_time` read refuses. 29 of the 60 stop on it. It also moves #1664's census: on the
  member's daily bar shape the granted state serves **2 of 70** (not 7) and **2 of 25 committed** (not 3), both
  zero-trade reports (section 5).
- **Served to members today, production column: 0 of 70 sampled, 0 of 25 committed** (unchanged: no admission).
- No engine number (section 8).

## 2. The admission rule as written

`api/services/rollout_gate.py::pine_capability_admission` over the registry row
`api/data/pine_runtime_allowlist.json` `capabilities["strategy-decl"]` (there is none today: "a capability absent from
this registry withholds every script that uses it"). A row admits only when:

1. `admitted: true` and `status: conformant`;
2. its `evidence` holds entries `{capture, script, community, verdict: "MATCH", runtimePane: "on"}` naming **at least 2
   distinct captures of at least 2 DISTINCT scripts** (`script` is the family, `pine_evidence_script`: a probe and its
   `_V2` / `_NEG` variants are one script), **at least one of them a COMMUNITY script** (not one of our probes:
   `PINE_PROBE_PREFIXES`); `PINE_CAPABILITY_MIN_CAPTURES = 2`, `PINE_CAPABILITY_MIN_SCRIPTS = 2`,
   `PINE_CAPABILITY_MIN_COMMUNITY_SCRIPTS = 1`;
3. a `ledger` entry (a licence-held capture graded out of git) counts only while graded at today's engine number;
4. (`obj:*`, `library:*`, `realtime-state` carry extra conditions; `strategy-decl` is none of them.)

Held by `tests/test_pine_capability_admission.py` A8: every evidence id is a real capture in
`docs/pine/vendor-harness/runtime-on/verdicts.json` graded **MATCH** there, its `script` and `community` equal to the
classifier's, its fixture on disk, and its source using the capability (`pine_capabilities.capabilities_of`).
The 2026-11-13 derivation (`docs/pine/evidence/2026-11-13-capability-admission/EVIDENCE.md`) adds that the capture is
**drawn by the runtime lane** (`capabilityAdmission.measure.test.js CAPADMIT_MODE=lanes`). Recorded where: the row's
`evidence` list in the allowlist, each id resolving into the committed runtime-on verdicts.

What "MATCH" means for a strategy since this branch (section 3): its trades and its Strategy Tester report agree too.

## 3. How the harness was armed: one code path

The runtime-on harness (`vendorHarness.corpus.test.js`, `VENDOR_HARNESS_RUNTIME_ON=1`) ran the broker DARK: it stubbed
the objects-only and runtime pane flags and granted the runtime lane's admission, but never the strategy broker's flag,
so every strategy declined `pine:strategy-call` at the door. Production builds the gate ON (`Dockerfile.web` ARG
default, #1664) and members are on the runtime lane (`PINE_RUNTIME_STAGE=all`).

Now, in the runtime-on lane only:

- **The gate's own flag** is stubbed `'1'`, its name read off `strategyBrokerGate.js` (`strategyLane.js::strategyBrokerFlag`),
  next to the two pane flags; the admission stays granted for the run (`__allowEveryRuntimeScriptForTests`). The
  production lane stubs it off (the runtime lane is dark there).
- **Our side is the member's chart, unchanged**: the member door (`memberPaneDefinition`) mints the broker document,
  the install door installs it, `registry.computeFor` runs it, and the binder pass is handed the server's strategy
  window (`ctx.historyWindowBars` = `bars_window.HISTORY_WINDOW_BARS`, as `StockChart` hands `strategyHistoryWindow`).
  The run's record is read back off the product's columns (`ourSide.js::strategyRunOf` -> `runtimeStrategyOf`), the
  report from it on the COMMITTED pin ledger (`brokerReport.js::strategyReportOf`, default pins).
- **Graded with the ONE strategy grade** (`strategyHarness.js::gradeStrategyCapture` -> `compare.mjs::gradeStrategy`),
  its run REPLACED by the product's (`strategyLane.js::strategyLaneRunOf`): trades, fills, report slots, every plotted
  value and drawn text, on TradingView's clock (`recordOnCaptureClock`: each product bar key mapped to the capture's own
  bar time, row for row).
- **Never** the `strategyBroker: true` build option, `brokerPinned` or `runOurBroker` (that is the pin question, every
  rule allowed): railed in the source (SL6).
- **THE FOLD** (`foldStrategyGrade`): where a capture holds a Strategy Tester report, or our door ran a broker document,
  the capture's verdict is the indicator grade AND the strategy grade: MATCH only when both are, DIVERGE when either is,
  INCONCLUSIVE otherwise (a refusal by name, the strategy floor, a report not read). A broker document graded against a
  capture with no report is INCONCLUSIVE: its output was never compared. `verdictWithoutStrategy` keeps the indicator
  grade beside it.
- A report capture whose value rows stop one bar short of its bars (TradingView had not run its newest bar) is graded
  on the bars it ran, on both sides (`strategyRanView`, the strategy grade's own `barsTradingViewRan` rule).
- **The lane proves itself**: a runtime-on run with the broker gate read off at collection, or one that graded strategy
  captures and ran no broker document, fails and writes nothing (`assertStrategyLaneMeasured`); the run records
  `laneEvidence.strategy`.

```sh
# from app/, under the heavy lock; VENDOR_HARNESS_DIR now also takes single capture files, ';'-separated
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR="<the 60 capture files>" VENDOR_HARNESS_OUT=<dir> \
  python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --label stratadmit-final60 run -- \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
```

Lane line of the run: `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 60, host refusals 60) · objects-only
pane ARMED · runtime drew 54, declined 6 · strategy lane: broker gate ON, 60 graded on their trades, 54 broker run(s)`.
Before (the committed 2026-11-13 snapshot), all 60 declined `pine:strategy-call` at the door.

## 4. The 60 W9 Strategy Tester captures

Grades: `grades-w9-60.json` (grades only; every capture is committed under `tests/fixtures/vendor/harness/`). "verdict"
is the folded harness verdict; "indicator" the plots-and-objects grade alone; "strategy" the strategy grade
(`EXPECTED-REFUSAL`: our side declined by name; `UNGRADABLE`: TradingView's report holds fewer trades than the floor).

| tally | n |
|---|---:|
| MATCH | 0 |
| DIVERGE | 0 |
| INCONCLUSIVE | 60 |
| ... a run reads `strategy.closedtrades.entry_time` on daily bars, whose times are dates | 25 |
| ... the report refused whole, its bar times dates (`runtime:strategy-report-record`) | 4 |
| ... a broker rule not pinned (`runtime:strategy-unpinned`: B-STOP-LIMIT 3, B-PYR-PRICE 2, B-EXIT-LEVELS 2, B-POC 2, B-FILLS, B-TRAIL, B-EXIT-QTY) | 12 |
| ... an open question (`runtime:strategy-unsettled`: Q-S1d 6, Q-S1e 2, Q-S1h 2, Q-S1k 2, Q-S1n 1) | 13 |
| ... refused at the door (`strategy.margin_liquidation_price` 2, `runtime:call-undeclared-builtin-state` 2, `runtime:strategy-repaint` 2) | 6 |
| of all 60: the Strategy Tester report not read in the capture (`not-requested`, the pre-`-rpt` twins) | 12 |
| of all 60: TradingView's report under the 5-trade floor (UNGRADABLE whatever we answer) | 10 |
| of all 60: a community script | 0 |

The 4 whose runs finish (w9-g1-v3-properties, w9-q-s1a-size-v2, w9-q-s1a-size-v4, w9-q-s1b-defaults-v4) draw every
plot equal to TradingView's (indicator MATCH) and grade MATCH through step 7 on epoch-second bars
(`docs/pine/vendor-harness/strategy-verdicts/`); on the member's daily bars their report refuses whole. Before the
report-refusal branch of `strategyLaneRunOf`, the same four graded DIVERGE "profit differs" on profits the refused
report never served: SL7 holds that a withheld report is a refusal, never a different answer.

| # | capture | verdict | indicator | strategy | named by |
|---:|---|---|---|---|---|
| 1 | `s1-broker-core-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 2 | `vw-s1-q-s1d-close-reverse-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unsettled` Q-S1d |
| 3 | `vw-s1-q-s1d-close-reverse-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (2 reference trades, floor 5) | run: `runtime:strategy-unsettled` Q-S1d |
| 4 | `vw-s1-q-s1d-two-entries-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unsettled` Q-S1d |
| 5 | `vw-s1-q-s1d-two-entries-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (2 reference trades, floor 5) | run: `runtime:strategy-unsettled` Q-S1d |
| 6 | `vw-s1-q-s1d-two-stops-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unsettled` Q-S1d |
| 7 | `vw-s1-q-s1d-two-stops-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (2 reference trades, floor 5) | run: `runtime:strategy-unsettled` Q-S1d |
| 8 | `vw-s1-q-s1e-stop-past-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unsettled` Q-S1e |
| 9 | `vw-s1-q-s1e-stop-past-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (1 reference trades, floor 5) | run: `runtime:strategy-unsettled` Q-S1e |
| 10 | `vw-s1-q-s1g-blocked-stop-entry-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unpinned` B-PYR-PRICE |
| 11 | `vw-s1-q-s1g-blocked-stop-entry-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (1 reference trades, floor 5) | run: `runtime:strategy-unpinned` B-PYR-PRICE |
| 12 | `vw-s1-q-s1h-fifo-exit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unsettled` Q-S1h |
| 13 | `vw-s1-q-s1h-fifo-exit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (3 reference trades, floor 5) | run: `runtime:strategy-unsettled` Q-S1h |
| 14 | `vw-s1-q-s1j-stop-limit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unpinned` B-STOP-LIMIT |
| 15 | `vw-s1-q-s1j-stop-limit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (1 reference trades, floor 5) | run: `runtime:strategy-unpinned` B-STOP-LIMIT |
| 16 | `vw-s1-q-s1k-fractional-profit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unsettled` Q-S1k |
| 17 | `vw-s1-q-s1k-fractional-profit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (1 reference trades, floor 5) | run: `runtime:strategy-unsettled` Q-S1k |
| 18 | `vw-s1-q-s1k-na-modify-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | door: `pine:strategy-call`, runtime lane `runtime:call-undeclared-builtin-state` |
| 19 | `vw-s1-q-s1k-na-modify-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (1 reference trades, floor 5) | door: `pine:strategy-call`, runtime lane `runtime:call-undeclared-builtin-state` |
| 20 | `vw-s1-q-s1k-profit-and-limit-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: `runtime:strategy-unpinned` B-EXIT-LEVELS |
| 21 | `vw-s1-q-s1k-profit-and-limit-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | UNGRADABLE (1 reference trades, floor 5) | run: `runtime:strategy-unpinned` B-EXIT-LEVELS |
| 22 | `w9-d1-margin50-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | door: `pine:strategy-call`, runtime lane `runtime:strategy-value` (`strategy.margin_liquidation_price`) |
| 23 | `w9-d1-margin50-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | door: `pine:strategy-call`, runtime lane `runtime:strategy-value` (`strategy.margin_liquidation_price`) |
| 24 | `w9-d11-late-first-use-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE (its report was not read: not-requested) | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 25 | `w9-d11-late-first-use-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 26 | `w9-g1-v3-properties-rddt-1d-2026-11-15` | INCONCLUSIVE | MATCH | EXPECTED-REFUSAL | report refused whole, its bar times are dates (`runtime:strategy-report-record`); plots MATCH; MATCH through step 7 on epoch-second bars |
| 27 | `w9-k1-commission-pct-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 28 | `w9-k2-commission-contract-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 29 | `w9-k3-commission-order-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 30 | `w9-k4-slippage-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 31 | `w9-mk1-markers-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 32 | `w9-mk1-markers-rpt-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 33 | `w9-p1-on-close-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: `runtime:strategy-unpinned` B-POC |
| 34 | `w9-p1b-on-close-fills-nv-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: `runtime:strategy-unpinned` B-POC |
| 35 | `w9-p1b-on-close-fills-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | door: `pine:state`, runtime lane `runtime:strategy-repaint` |
| 36 | `w9-p2-order-fills-nv-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: `runtime:strategy-unpinned` B-FILLS |
| 37 | `w9-p2-order-fills-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | door: `pine:state`, runtime lane `runtime:strategy-repaint` |
| 38 | `w9-p3-every-tick-history-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 39 | `w9-q-s1a-size-v2-rddt-1d-2026-11-15` | INCONCLUSIVE | MATCH | EXPECTED-REFUSAL | report refused whole, its bar times are dates (`runtime:strategy-report-record`); plots MATCH; MATCH through step 7 on epoch-second bars |
| 40 | `w9-q-s1a-size-v4-rddt-1d-2026-11-15` | INCONCLUSIVE | MATCH | EXPECTED-REFUSAL | report refused whole, its bar times are dates (`runtime:strategy-report-record`); plots MATCH; MATCH through step 7 on epoch-second bars |
| 41 | `w9-q-s1a-size-v5cash-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 42 | `w9-q-s1a-size-v5pct-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 43 | `w9-q-s1a-size-v6-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 44 | `w9-q-s1b-defaults-v4-rddt-1d-2026-11-15` | INCONCLUSIVE | MATCH | EXPECTED-REFUSAL | report refused whole, its bar times are dates (`runtime:strategy-report-record`); plots MATCH; MATCH through step 7 on epoch-second bars |
| 45 | `w9-q-s1b-defaults-v5-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 46 | `w9-q-s1b-defaults-v6-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 47 | `w9-q-s1e-live-past-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 48 | `w9-q-s1i-short-v6-rddt-1d-2026-11-16` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 49 | `w9-q-s1j-stop-limit-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: `runtime:strategy-unpinned` B-STOP-LIMIT |
| 50 | `w9-q-s1k-exit-levels-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 51 | `w9-q-s1k-exit-levels-v6-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 52 | `w9-q-s1p-when-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 53 | `w9-r1-risk-allow-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 54 | `w9-r1-risk-ddown-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 55 | `w9-r1-risk-intraday-range-spy-15-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: `runtime:strategy-unsettled` Q-S1n |
| 56 | `w9-x1-trail-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: `runtime:strategy-unpinned` B-TRAIL |
| 57 | `w9-x2-partial-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: `runtime:strategy-unpinned` B-EXIT-QTY |
| 58 | `w9-x3-oca-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 59 | `w9-x4-order-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |
| 60 | `w9-x5-cancel-rddt-1d-2026-11-15` | INCONCLUSIVE | INCONCLUSIVE | EXPECTED-REFUSAL | run: reads `strategy.closedtrades.entry_time`, and a daily bar's time is a date (`runtime:strategy-unsettled`) |

## 5. What members are served

| census (`strategyServeAudit.measure.test.js`, gate on) | bars | granted admission | production admission |
|---|---|---:|---:|
| 70 sampled (#1664's run, `serve_70_final`) | epoch seconds (`barsOfCapture`) | 7 | **0** |
| 70 sampled (this run, `STRATEGY_SERVE_BARS=product`) | a member's daily bars (`toProductBars`: ISO date keys) | **2** | **0** |
| 25 committed | epoch seconds | 3 | **0** |
| 25 committed | a member's daily bars | **2** | **0** |

- **Production column (what members are served): 0 of 70, 0 of 25**, either bar shape: `strategy-decl` is not admitted.
- On the member's daily bars the granted state loses every strategy that made a trade: consecutive-updown, rsi-strategy,
  stochastic-slow, supertrend-strategy and golden-cross-chartart refuse their report whole
  (`runtime:strategy-report-record`: "the backtest record is incomplete or in a form this report cannot read, so there
  is no report."). The 2 still served (buy-monday-exit-tuesday, scalping-1-minute) made 0 trades on RDDT 1D, so their
  record holds no bar time. #1664's census and its rail `strategyServeCensus.test.js` hand the run epoch seconds,
  which a member's daily chart does not; this PR does not move that rail (it is #1664's, and the census is right for an
  epoch-second chart), it records the difference.
- `STRATEGY_SERVE_BARS=product` is a new, measure-only switch on `strategyServeAudit.measure.test.js`; unset, the
  audit is the run #1664 measured, byte for byte.
- Supertrend-strategy on NASDAQ:ALAB 1D (Q-SD2's chart): served on epoch-second bars with 13 trades; refused whole on
  the member's daily bars. On RDDT 1D: 11 trades, the same split.

## 6. What is missing, and the queue

`docs/pine/capture-queue-2026-11-17-strategy-decl.md`:

1. **ENGINE GAP (first): a daily chart's strategy run is handed bar DATES.** Until a strategy run on a daily chart
   states its bars as epoch seconds (`broker.js` `timeOf` / `barTimeMs`, the record's `entryTime` / `placedTime`), no
   daily strategy capture can grade MATCH on the member's path, and the report refuses whole for every strategy that
   trades. Then re-grade the 60 runtime-on. That is an engine change (a compute change: an engine number), not this PR.
2. **A COMMUNITY strategy capture WITH its Strategy Tester report.** Q-SD1 supertrend-strategy NYSE:RDDT 1D (its
   2026-10-02 captures hold no report: the queue engine counts that capture CAPTURED by its source sha, so the re-take is
   by hand), Q-SD2 the same on NASDAQ:ALAB 1D (QUEUED). Not AMEX:SPY 1D: a listing deeper than the 5,000-bar strategy
   window runs off its listing and refuses Q-S1n.
3. With 1 and 2: the rule is met by Q-SD1 or Q-SD2 (community) beside any W9 probe that MATCHes (2 scripts, 1
   community). The candidates are the four above, MATCH on epoch-second bars today.
4. The rest of the 60 wait on their own named rows (Q-S1d/e/h/k/n, the unpinned rules) as #1664 lists; the 12
   `not-requested` twins are superseded by their `-rpt` re-takes; 10 `-rpt` captures are under the 5-trade floor and
   can never grade a strategy.

Two findings beside the rule, not changed here:

- **The paint grade reads a run stopped by name as an undrawn paint.** supertrend-strategy-spy-1d-2026-10-02, broker
  armed: the run stops by name (Q-S1n: SPY is deeper than the window), every plot grades INCONCLUSIVE, but its
  `barcolor` grades `notDrawn` -> DIVERGE, because G5 counts a paint withheld only when the strip names that paint. It
  graded INCONCLUSIVE with the broker dark. If the runtime-on snapshot is regenerated with the broker armed, the REACH
  rail will see it.
- The other 22 strategy-declaring captures (`grades-other-22.json`): 4 MATCH (optimized-keltner x2, tradingview-alerts
  strategy-example x2, drawn by the host lane: the runtime lane declined them, so they are evidence for nothing here), 4 DIVERGE (pmax-explorer x2 host-drawn as before,
  r1-strategy-draws as before, supertrend-strategy-spy above), 14 INCONCLUSIVE (9 at the door; 7 broker runs, every one
  on a capture with no report, or stopped by name). The nine 2026-11-15 community strategy captures that DO hold a
  report (atr-god x2, heikin-ashi-supertrend x2, lorentzian, multi-timeframe-rsi, take-profit x2, trailing-tp-sl) are
  all refused at the door (`pine:block`, `pine:module`, `pine:request`).

## 7. The classifier fix

`rollout_gate.PINE_PROBE_PREFIXES` gains `w9_` and `w9-`. The W9 strategy probes are generated by
`tools/vendor_harness/w9_probes.py` into `tools/visual_conformance/probes/w9-*.pine`, titled `W9_<ROW>`; the classifier
read 35 of the 60 W9 captures (every `W9_` title) as COMMUNITY scripts. No admitted row changes: no evidence entry is a
W9 capture. Rails: `test_EVIDENCE_these_captures_are_ours_not_community` (+4 W9 ids) and
`test_EVIDENCE_every_w9_strategy_capture_is_ours` (every `w9-` capture in the runtime-on verdicts, non-vacuous >= 30).

## 8. Engine number

None. No document the member door mints changes and no committed digest moves: the harness and its rails are test
infrastructure (`__tests__/`), `PINE_PROBE_PREFIXES` classifies evidence only (the registry carries its own
`community` flags; no evidence entry changes), the measure switch is measure-only, and the allowlist is untouched. The
engine gap in section 6 WILL need one when it is built.

## 9. Rails and mutation proofs (2026-11-17, each mutant restored from a saved copy, never `git checkout`, byte-equal)

`app/src/components/chart/engine/__tests__/vendorHarness/strategyLane.test.js` (17 tests, SL1..SL7, each with a control):

| mutant | result |
|---|---|
| M1 `PINE_PROBE_PREFIXES` without `w9_` / `w9-` | RED x5 (`test_EVIDENCE_these_captures_are_ours_not_community` x4, `..._every_w9_strategy_capture_is_ours`) |
| M2 the fold ignores the strategy grade | RED x6 (SL1 x2, SL3, SL4 x2, SL7) |
| M3 the ran view never cuts the unrun bar | RED (SL2) |
| M4 our side hands a broker document no window | RED (SL7: the run stops `runtime:strategy-start` instead) |
| M5 the runtime-on lane does not arm the broker (`vendorHarness.corpus.test.js`) | RED x2 ("the lane measured is the lane requested", "prints the table": STRATEGY BROKER IS DARK, nothing written) |
| M6 the lane builds with `strategyBroker: true` | RED (SL6) |
| M7 a report refused whole is compared anyway | RED (SL7: "profit differs") |
| M8 a broker run with no report is not graded | RED (SL3) |
| M9 the lane assertion skips the dark gate | RED (SL5) |

After restore: 17 / 17 green.

## 10. Runs

- runtime-on, the 60 W9 captures: 0 MATCH / 0 DIVERGE / 60 INCONCLUSIVE (`grades-w9-60.json`);
- runtime-on, the 22 other strategy-declaring captures: 4 / 4 / 14 (`grades-other-22.json`);
- serve audit, product daily bars: 70 rows (granted 2 served, production 0) and 25 committed (granted 2, production 0);
  epoch seconds, 25 committed: granted 3, production 0 (equal to `strategyServeCensus.test.js`).
