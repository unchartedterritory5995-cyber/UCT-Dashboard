# W9 "Strategy tester": design and task breakdown

Written 2026-11-05 by a W9 design author (desktop), docs only. No vitest, census, harness or
rig was run for this document.

**Revision r1 (2026-11-05)** answers the independent review NO-GO at `abe065dd80`
(`_resume-2026-11-01/dsk/reviews/W9-DESIGN.md`) under the coordinator's rulings:
- **B1, one history rule (R10).** A strategy run uses W5-T14's 5,000-bar window
  (`_MAX_BARS`), read from that one constant. There is no listing-start rule and no 32,768 cap.
  See section 3.4.
- **B2, gradable captures only.** Pins and grading happen only where TradingView's window and
  ours agree:
  - method (a): a symbol whose first loaded bar is the listing on both sides;
  - method (b): a probe whose entries are restricted to an explicit time range both sides hold.
  See section 5.1. The capture set is recounted in section 5.3.
- **B3, the full S1 FE footprint.** All 12 S1 front-end sites are mapped to their anchors on the
  train tip and against the open W4 lanes (sections 4 T1 and 6). T1 starts from
  `integ/pine-train-2026-11-05` @ `00e2d0dfda`.
- **B4, a probe file for every row.** Every capture row names its probe file, which T3b writes.
  Every answer is read from the chart model; no CSV is used anywhere.
- **B5, pins in the engine identity.** The pin-ledger digest becomes part of the engine identity,
  with a rail (rule 7, task T2).
- **Notes folded in:**
  - T13 is split in two;
  - pyramiding defaults, `process_orders_on_close` interactions and repainting are specified;
  - the magnifier claim is corrected (0 sample scripts);
  - built-ins: 23 of 23 need a sizing rule;
  - the existing strategy-capture path is reused;
  - capture row W9-T1 is renamed W9-MK1;
  - the broker checks its own window;
  - bar identity is checked before rule grading;
  - the record is stamped with its as-of bar;
  - the number schedulable now is stated.

Scope (WAVE-TASKS on branch `docs/pine-parity-programme`, section W9; owner: in scope):
- **W9.1** Broker emulator: fills, slippage, commission, pyramiding, `process_orders_on_close`,
  bar magnifier off/on. Every rule is pinned by captures.
- **W9.2** `strategy.*` read-backs.
- **W9.3** Trade markers on the chart, and the tester report: performance summary and list of
  trades.
- **W9.4** Server-side backtests through W5.

Citations and names:
- Line citations are at `origin/master` **`646dca8cbf`**, except where marked **train**:
  `origin/integ/pine-train-2026-11-05` @ **`00e2d0dfda`**, which is master plus W3, W4-T0,
  W4-T1, W4-T3, W4-T4, W5-T12 and SCORE.
- `FE` = `app/src/components/chart/engine/ast/pineRuntimeFrontend.js`: 11,115 lines on master,
  11,350 on the train.
- `RT/` = `app/src/components/chart/engine/runtime/`.
- `S1` = commit **`34da5eb926`** on `origin/pine/s1-strategy-broker`. It is not on master. Only
  `34da5eb926~1..34da5eb926` is ported: the branch itself carries 166 unrelated wave-18 commits.
- **This doc's tasks are T0 to T15. Other waves' tasks are always prefixed:** `W4-T10`, `W5-T14`.
  Capture rows are `Q-S1x` (S1's ids) or `W9-xx`.

**The goal is the language, not the sample.** Each task implements a broker rule for every
script that meets it. The 70-script sample only ranks the rules.

---

## 0. What the measurements say (read this first)

### 0.1 The population

From `docs/pine/coverage-map.json` (committed; measured 2026-11-02 on master `6272ed7fa3`):

| | count |
|---|---:|
| `strategy()` scripts in the 679-script sample | **70** |
| by population | 25 committed, 23 builtin, 22 reference |
| by Pine version | v6 25, v5 16, v4 20, v2 6, v1 3 |
| transfer fully (production) | **0**: an order-placing strategy never transfers, `tools/pine_coverage/coverage_map.py:368-373` |
| attach on the production door (draws like an indicator, C50) | 14 |
| attach on the runtime-on lane (R1) | 16 |
| W9 production blocks / only-W9-left (upper) / firm | 70 / 40 / 12 (`COVERAGE-MAP-2026-11-02.md` section 6) |
| the programme headline for W9 | +70 upper / +28 firm (`COVERAGE-MAP.md` section 7 phase 7, 10-30, cumulative after phases 1-6) |

The two W9 numbers answer different questions:
- **+40 / +12** counts the scripts for which W9 is the last wave left today;
- **+70 / +28** counts the scripts W9 finishes once W1-W8 have landed.

Plan by +40 / +12 for what W9 alone delivers.

### 0.2 Findings that shape the plan

1. **No strategy is served by the rules S1 settled from text alone. Sizing is the first wall.**
   58 of 70 need a sizing rule that no text settles:
   - 19 declare `percent_of_equity`;
   - 20 are v6 and declare no size. S1 read v6's default as percent-of-equity 100; unconfirmed;
   - 19 are v1-v4 and declare no `default_qty_value`.

   All 23 TradingView built-ins need a sizing rule:
   - 18 are v6 with no size;
   - 3 declare percent;
   - `rob-booker-adx-breakout` is v1 with no quantity value.

   (r0 said 22 of 23 because it counted only the percent wall.) Q-S1a settles all three groups.
2. **S1 built a broker. W9 ports it; it does not restart it.**
   - S1 wrote:
     - `RT/broker.js`, 585 lines;
     - `ast/strategyBroker.js`, 199 lines;
     - `docs/pine/strategy-broker-spec.md`: 22 rules cited to the v4/v5/v6 Language Reference
       and the User Manual, plus 16 unsettled cases (Q-S1a to Q-S1p);
     - a capture queue, one probe (`s1-broker-core.pine`) and a 247-line rail.
   - None of its captures was taken.
   - Its opcode collides: S1's `OP.BROKER = 97` against master's `OBJ_CREATE: 97`,
     `OBJ_UPDATE: 98` and `OBJ_DELETE: 99` (`RT/program.js:270`).
   - Its FE hunk touches 12 sites across the file (T1).
3. **What master does with a strategy today (C50 and R1).**
   - It draws like an indicator.
   - Order calls are skipped. There is one set, `STRATEGY_ORDER_CALLS` (`ast/pine.js:239-242`):
     the host lane reads it at `:25661-25667` and the runtime lane at `FE:8728-8738`.
   - A `strategy.*` value refuses `pine:strategy-call` (`pine.js:893`; rail
     `RT/__tests__/runtimeStrategy.test.js:113-127`).
   - The screener refuses the declaration (`pine.js:256-257`, `:24947`). That refusal is a
     recorded ruling (`strategiesAreRuled.test.js`), and W9 leaves it standing (D7).
4. **The newest census miscounts strategies.**
   - On `origin/fix/pine-w0-census-peel` (11-03, master `6990d63b02`; merged into the train as
     W4-T0), 6 order-placing strategies count as transfers. They are:
     - `optimized-keltner-channels-sltp-strategy-for-btc`;
     - both `tradingview-alerts-to-mt4-mt5-*`;
     - `bollinger-rsi-double-strategy-by-chartart-v11`;
     - `macd-sma-200-strategy-by-chartart`;
     - `ut-bot-strategy`.
   - On the same branch the `[strategy]` bucket falls from 70 to 53, and the
     `strategy.position_size` wall falls from 11 to 0. The review reproduced all of this.
   - Likely cause (a hypothesis): `usage_of` builds `items` against the reference inventory
     (`coverage_map.py:255-346`), and the rebuilt inventory may not list `strategy.entry`.
   - Verified: `coverage_map.py:358` keeps its own order set of 5 names, beside the 13 in
     `pine.js`.
5. **TradingView changed the tester in July 2026** (`builtins-and-adoption.md:264`,
   `pine-version-evolution.md:177`):
   - the strategy report;
   - a Bar detalization menu;
   - Long/Short leverage;
   - Limit order execution and Order execution delay settings;
   - `calc_on_every_history_tick`.
   The Properties dialog can change fills with no change to the source, so every capture reads
   the settings back (5.1).
6. **The screener backtest is an event study, not a trade list.**
   - `api/services/screener/backtest.py` scores forward returns from the next open. It carries
     no position.
   - W5-T15 replays a runtime column under `RUNTIME_HISTORY_LEAD = 500`
     (`screener_backtest.py:483` on its branch).
   - W9.4 is therefore its own route and run shape. It reuses W5's client, admission and
     receipts (3.4).
7. **The history rule (R10) and what it does to parity.**
   - Server lanes use W5-T14's window, `_MAX_BARS = 5000` (`api/services/screener/scan_evaluator.py:230`
     on `origin/feat/pine-w5-t14-scans`). T15 restates it as `MAX_BARS_PER_SYMBOL = 5000`
     (`screener_backtest.py:160` on master).
   - TradingView backtests from its own first loaded bar. That depends on the plan: the
     committed `supertrend-strategy-spy-1d-2026-10-02` loaded **1,800** SPY daily bars, from
     2019-08-06.
   - A broker's trades depend on path, so the two sides agree only where their first bars agree
     (method a) or where the probe's trades cannot depend on bars before an explicit range
     (method b).
   - **NYSE:RDDT 1D satisfies method (a).** Committed `r1-strategy-draws-rddt-1d-2026-10-02`
     records `history.startsAtBar0: true`: 636 bars from the 2024-03-21 listing, under 5,000.
8. **Strategies have been captured before.** `tests/fixtures/vendor/harness/` holds 10
   strategy fixtures (2026-10-02/03). Each carries a `StrategyScript$USER;...` study id, on the
   rig layout `01f1AcIj`, through `tv_capture.js` v2. They are:
   - supertrend, delta-rsi, macd-shortlong, optimized-keltner and tradingview-alerts, each on
     RDDT and SPY;
   - the R1 pair.
   A working strategy-load path therefore exists. T3a starts from it.

---

## 1. Strategy walls ranked

**Measured** 2026-11-05 by a read-only static scan (section 7) of the 70 sources in the 11-02
sample. Engine of record: master `646dca8cbf`, where every `strategy.*` value and the whole
broker refuse.

"Touches" counts the scripts that need the rule. The greedy columns add one rule at a time,
choosing the rule that completes the most only-W9 scripts. The only-W9 set has 40 scripts, with
a firm subset of 12. The greedy counts only the broker side.

| # | wall (a rule the broker must serve, or refuse by name) | touches /70 | greedy complete /70 | only-W9 /40 | firm /12 | pinned by | task |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | sizing: percent of equity (19 declared + 20 by the v6 default) | 39 | 19 | 17 | 1 | Q-S1a | T4 |
| 2 | sizing: v1-v4 default quantity (none stated) | 19 | 31 | 23 | 6 | Q-S1a | T4 |
| 3 | `currency =` (served only when it equals the symbol's currency) | 8 | 35 | 25 | 7 | W9-D2 | T4 |
| 4 | v5 defaults: capital 1,000,000 and margin 0 | 5 | 38 | 27 | 7 | Q-S1b | T4 |
| 5 | `strategy.risk.*` | 6 | 40 | 29 | 8 | W9-R1 | T8 |
| 6 | v5 `when =` | 6 | 42 | 31 | 9 | Q-S1p | T1 |
| 7 | `strategy.order` | 3 | 44 | 33 | 9 | W9-X4 | T7 |
| 8 | OCA groups | 3 | 46 | 35 | 9 | W9-X3 | T7 |
| 9 | trailing exits | 4 | 48 | 36 | 9 | W9-X1 | T7 |
| 10 | commission (non-zero or an input) | 17 | 55 | 36 | 9 | W9-K1..K3 | T5 |
| 11 | partial exits | 6 | 60 | 38 | 11 | W9-X2 | T7 |
| 12 | slippage (non-zero or an input) | 3 | 61 | 38 | 11 | W9-K4 | T5 |
| 13 | partial `strategy.close` | 2 | 62 | 38 | 11 | W9-X2 | T7 |
| 14 | values outside S1's set | 4 | 64 | 38 | 11 | W9-V1 | T10 |
| 15 | `calc_on_every_tick = true` | 2 | 64 | 38 | 11 | Q-S1o (live) | T6 |
| 16 | `process_orders_on_close = true` | 2 | | | | W9-P1, W9-P1b | T6 |
| 17 | `calc_on_order_fills = true` | 1 | | | | W9-P2 | T6 |
| 18 | `close_entries_rule`, `margin_*`, `backtest_fill_limits_assumption` | 1 each | | | | W9-D1, W9-J1 | T4, T6 |
| 19 | `close_all(immediately = true)` | 1 | | | | W9-X4 | T7 |
| 20 | **pyramiding default** (52 of 70 declare no `pyramiding`) | 52 | precondition | | | Q-S1b | T1 |
| 21 | **repaint-class inputs**: `request.security`/`security(` (14 sources), `barstate.isconfirmed` (3), `barstate.islast` (2), `islastconfirmedhistory` (2), `timenow` (1), `lookahead_on` (1); 17 scripts in all | 17 | refused | | | none (rule 11) | T1 |

**S1's core set** is a precondition for every row:
- market, limit and stop entries;
- exit brackets;
- cancel;
- pyramiding above 1;
- S1's 23 values.

Q-S1-core and Q-S1c to Q-S1m pin the core. The ranking is the order in which to take the other
captures. **Bar magnifier: 0 of 70 scripts set `use_bar_magnifier`.** r0 wrongly named one, and
the review's grep confirms 0.

Census against source (11-02 map):

| wall | map | source |
|---|---:|---|
| `strategy.position_size` | 11 | 18 |
| `position_avg_price` | 3 | 16 |
| `opentrades` | 1 | 6 (7 counting the bare word) |

The map counts a wall only where the peel reached it. Non-broker walls belong to other waves:

| wall | scripts | wave |
|---|---:|---|
| `[imperative]` | 15 | W4 |
| `request.security` | 8 | W7 |
| imports | 6 | W8 |
| user functions | 6 | W4 |
| drawing | 4 + 6 | W3 |
| translator | 4 | W1 |
| `ta.barssince` / `ta.valuewhen` / `ta.sar` | 3 / 2 / 1 | W1 |

---

## 2. Rules every W9 task follows

1. **Refuse by name, never a silent wrong value.**
   - A case that no MATCHing capture pins stops the run at the bar that reaches it:
     `runtime:strategy-unpinned`, naming the rule id and the capture row.
   - Unserved options refuse at build: `runtime:strategy-option` / `runtime:strategy-value`.
   - S1's `runtime:strategy-unsettled` stays for cases that both text and captures leave open.
   - A trade list is never shown with a refused trade missing from it.
2. **Every emulator rule is pinned by a capture before it serves a value** (D1), including the 22
   that S1 settled from text.
   - `pinned(ruleId)` is asked **at run time only, never at build**. So a minted runtime
     document never embeds pin state (rule 7).
   - Tests pass an explicit pin set. A grep rail forbids that argument outside `__tests__`, and
     the rail is mutation-proved.
3. **One authority per value.**
   - Fills, positions and trades come only from `RT/broker.js`. There is no Python broker: the
     server runs the same bundle (W5).
   - `strategy.*` values, markers, the report and the server output all read **one** record
     (3.2).
   - Report metrics are computed only in `RT/brokerReport.js` (T13a).
   - The order-call set is `STRATEGY_ORDER_CALLS` (`pine.js:239`), and `coverage_map.py` derives
     from it (T0).
   - Per-version defaults live in one table (`ast/strategyBroker.js`).
   - **The history window is W5-T14's `_MAX_BARS`.** W9 adds no bar constant (3.4).
4. **The C18 object door builds exactly what master builds.**
   - Broker mode is never reachable with `opts.objectDoor === true` (`FE:1101-1105`,
     `RT/runtimeColumns.js:1488, 1582`).
   - One case per W9 capability goes into `RT/__tests__/objectDoorGate.test.js`.
   - measure-pair: 0 C18 verdict diffs unless each is classified.
5. **The stage-1 script (`adx-and-di-for-v4`) and the W2 allowlist do not move.**
   `runtimeAllowlistParity.test.js` is required once W2 merges.
6. **Built dark.**
   - Broker mode sits behind `VITE_PINE_STRATEGY_BROKER_ENABLED` (S1's
     `engine/strategyBrokerGate.js`, a `Dockerfile.web` ARG and a `docs/feature_flags.json`
     entry). It is off by default.
   - Builders never flip flags, touch Railway or arm anything.
   - With the gate off, census, harness and C18 outputs are identical to the base. A gate-off and
     gate-on pair goes in `s1StrategyBroker.test.js`.
7. **Engine identity.**
   - Builders never edit `SCRIPT_ENGINE_VERSION` (`scriptEngineVersion.js:88`, now 5). The
     coordinator bumps it per merge that changes translator output or door outcomes.
   - **A pin landing changes served output, so it IS an engine change. Ruling: the pin-ledger
     digest is part of the engine identity**, not a per-pin `SCRIPT_ENGINE_VERSION` bump:
     - T2 resolves the ledger at build into `RT/brokerPins.resolved.json`. That file holds each
       rule id and its fixtures, kept only when the committed harness verdict is MATCH.
     - `BROKER_PINS_SHA256` is the sha256 of the canonical JSON of that file.
     - It goes into the runtime identity as a new field `broker_pins` beside `runtime_frontend` /
       `runtime_ir`. That covers the W5 request `engine` block (SERVER-RUNTIME-DESIGN 3.2), the
       W5 result-cache key (3.3) and the host-parity digests (2.3).
   - **Why not a bump per pin:**
     - A `SCRIPT_ENGINE_VERSION` bump re-translates every saved script (#610) and invalidates
       every cached result, for a change that alters only broker runs.
     - It couples fixture landings to coordinator merge slots.
     - It is easy to forget, because no code changes.
     - The digest moves on its own and exactly when the served set moves: a pin landing, or a
       fixture regressing to DIVERGE. It invalidates only what that set can change. A broker-free
       document is unaffected in meaning, and its key changes harmlessly.
   - Because `pinned()` is asked at run time (rule 2), stored documents carry no pin state, and
     the identity is the only place pins enter a cache key.
   - **Rail** (T2, `RT/__tests__/brokerPinsIdentity.test.js`): flip one pin in a temporary ledger
     copy and re-resolve. `BROKER_PINS_SHA256` must change, and so must the identity object the
     W5 client sends. Mutation: drop `broker_pins` from the identity, and the rail goes red.
   - **Who may land a pin-only change:** only the coordinator, as its own merge, in merge order,
     carrying the harness verdict commit that justifies it. Pins arm behaviour behind the gate,
     never past it.
   - `RUNTIME_FRONTEND_VERSION` is bumped only if a served shape changes meaning. A new opcode or
     EXPR kind does not.
8. **Ship loop** (WAVE-TASKS section 1):
   - red before, green after;
   - every guard mutation-proved (`mutate.py`; restore from saved bytes, never `git checkout`);
   - independent Opus review GO;
   - measure-pair runtime-on, with every diff classified;
   - deploy-gate pytest and hygiene.
9. **No heavy job outside the lock.** Targeted vitest only, `--maxWorkers=2`.
10. **No builder runs the rig.**
    - Captures are the owner's.
    - Values are read from the chart model (`tv_capture.js`), never pixels, CSV or
      `exportData()`.
11. **Repaint-class inputs refuse broker mode by name** (`runtime:strategy-repaint`) until their
    own wave rules on them. A capture and a later run would otherwise place different orders.
    The refusal covers:
    - `request.security` / `security` with `lookahead_on` or an unconfirmed higher-timeframe
      value (W7 rules);
    - `timenow`;
    - `barstate.isrealtime`, `barstate.islast`, `barstate.islastconfirmedhistory` and
      `barstate.isconfirmed` reaching an order call;
    - `varip`.
    A script that only plots such values still draws (C50/R1).

---

## 3. Architecture

### 3.1 Where the broker runs

- **Runtime lane only.** The host (columnar) lane keeps C50: plots drawn, orders skipped,
  values refused.
- **Per bar, S1's order:**
  1. pending orders fill along the intrabar path (S1's B-PATH);
  2. the script runs on the close and reads values that include those fills;
  3. new orders queue.
  `process_orders_on_close` and `calc_on_order_fills` add steps (T6; their interactions are in
  5.2 W9-P1/P1b).
- **History only.** There is no forming-bar run (B-EXEC).
- **The window is checked by the broker itself** (review N9), not only by the pane option. The
  run context carries `historyWindowBars` (3.4) and the bars handed in.
  - The broker refuses `runtime:strategy-start` when the bars are not that window: more bars
    than the constant, or a gap.
  - It records `startTime` and `fromListing` in the record.
  - The same check runs on the chart, on the server and in tests.
  - `memberPaneDefinition.js:1699` (`runtimeHistory: 'listing'`, set only when `!routed`) stays
    as it is for non-broker documents.

### 3.2 The run's `strategy` record (one source for W9.2, W9.3 and W9.4)

```jsonc
{
  "window":   { "startTime": 1711027800, "fromListing": true, "bars": 636, "historyWindowBars": 5000,
                "asOfBar": 1790947800 },        // newest CONFIRMED bar the record reflects (review N10e)
  "settings": { "version": 5, "initial_capital": 100000, "default_qty": {"type": "fixed", "value": 3},
                "pyramiding": 2, "commission": {"type": "percent", "value": 0}, "slippage": 0,
                "process_orders_on_close": false, "bar_detalization": "off", "currency": "USD" },
  "orders":   [ { "id": "L", "kind": "entry", "dir": "long", "qty": 3, "placedBar": 41, "type": "market",
                  "status": "filled", "fillBar": 42, "fillPrice": 12.34, "rule": "B-MARKET", "comment": null } ],
  "trades":   [ { "n": 1, "entryId": "L", "dir": "long", "qty": 3, "entryBar": 42, "entryPrice": 12.34,
                  "exitId": "XL", "exitBar": 60, "exitPrice": 14.19, "profit": 5.55, "commission": 0,
                  "runUp": null, "drawdown": null } ],
  "equity":   "<column, one value per bar>",
  "refusals": [ { "rule": "B-PATH", "guard": "runtime:strategy-unpinned", "bar": 118, "sentence": "..." } ]
}
```

- `asOfBar` is shown by the markers (T12) and the report (T13b). A member who compares with
  TradingView then compares like for like: the last open trade, open P&L and equity all move on
  every confirmed bar.
- Each fill carries the `rule` that produced it, so a grade DIVERGE names the rule (T2).

### 3.3 The member surfaces (W9.3)

- **Markers:** fills drawn on the price pane, with presentation pinned by W9-MK1.
- **Report:** a panel with three tabs (performance summary, list of trades, properties), plus the
  `asOfBar` stamp. An unpinned metric shows its refusal sentence.
- A run-wide refusal shows the plots (C50) and a report that holds only the refusal.

### 3.4 History, and W9.4 composed with W5

- **One history rule (R10).** Every broker run uses W5-T14's window: the last `_MAX_BARS` (5,000)
  bars of the symbol and timeframe, read from that one constant
  (`api/services/screener/scan_evaluator.py:230` on `origin/feat/pine-w5-t14-scans`).
  - `fromListing` is true only when the window reaches the listing.
  - A run whose window does not reach the listing is **served**, with its start date stated in
    the record and the report. TradingView also starts at its first loaded bar (B-START).
  - It is not refused, and it is graded only by methods (a) and (b) (5.1).
  - There is no 32,768 cap and no listing-start rule. A longer strategy window would be a change
    to `_MAX_BARS` itself, made as an owner decision.
- **How the constant reaches each host:**
  - **Server (T14):** the strategy route imports `scan_evaluator._MAX_BARS` (W5-T14), not T15's
    restatement. It passes the value as `ctx.historyWindowBars` and sends exactly that window of
    bars. T14 adds no bar constant. Rail: the route's window is `scan_evaluator._MAX_BARS` by
    identity (`is`), and a mutation to a literal 5000 elsewhere fails the grep half of the rail.
  - **Chart:** a broker run takes the most recent `historyWindowBars` bars that the chart has
    loaded, so a member's scroll-back never changes a strategy's trades. The value reaches the
    browser in the run context from the same constant, via the bars response that W5 already
    aligns (T11).
  - The chart's own `/api/bars?bars=5000` request is a pre-existing restatement owned by the
    chart lane (section 9, item 6). W9 does not add a third.
- **W9.4 shape:**
  - The W5 service gains `want: "#strategy"`, which returns the record (3.2) as a per-output
    result under profile `backtest`.
  - New route `POST /api/pine/strategy-backtest` (D5). It reuses, by import:
    - W5-T11's client and codec;
    - W5-T12's admission (`runtime_server_lane.admission`, lane `backtest`);
    - W5-T15's 409/503/500 mapping and digest-of-request receipt.
  - The screener backtest stays an event study.
  - A screen that reads a `strategy.*` value under T15's 500-bar lead refuses
    `runtime:strategy-start`, because that lead is not the R10 window. T14 adds that refusal to
    T15's descriptor path.

---

## 4. Tasks

Sizes: S ≤ 1 day, M 2-3 days, L about a week. Model tiers follow AGENT-RULES:
- Sonnet builds from a spec;
- Opus builds engine semantics and does every review;
- Fable only after Opus fails twice;
- Haiku does chores.

**Capture-gated** means the task builds and merges dark first; its rules refuse until pinned.

### T0 Census honesty for strategies | S | Sonnet | no capture

- **Owns:**
  - `tools/pine_coverage/coverage_map.py`: `:358` (`STRATEGY_ORDERS`), `:368-373`, `:670-690`;
  - `tools/pine_coverage/w0/targets.py`: `:56`, `:189`;
  - a new `tests/test_pine_coverage_w9_t0_strategy.py`.
- **Delivers:**
  - Order-placing detection reads the source: a `strategy.<order call>(` regex with comments
    stripped. It is never taken from the reference inventory.
  - The order set derives from `STRATEGY_ORDER_CALLS`, either through a vitest-generated
    `tools/pine_coverage/strategy_order_calls.json` or a parity rail.
  - A `strategyOn` block in `coverage-map.json`, which uses the static walls until gate-on runs
    exist.
  - The `runtime:strategy-*` guards map to W9.
- **Rails:**
  - the 6 strategies of finding 4 never come out `clean`, against an indicator control;
  - set parity.
- **Mutations:**
  - inventory-based detection returns: the 6 transfer again;
  - drop `cancel` from the set: parity goes red.
- **Depends:** none. It edits files that W4-T0 changed, so base it on the train.

### T1 Port S1's broker core, gated and dark | M | Opus | no capture to build

Port the diff `34da5eb926~1..34da5eb926`, never the branch. Start from
`origin/integ/pine-train-2026-11-05` @ `00e2d0dfda`.

- **New files, ported nearly verbatim:**
  - `RT/broker.js`;
  - `ast/strategyBroker.js`;
  - `engine/strategyBrokerGate.js`;
  - `RT/__tests__/s1StrategyBroker.test.js`;
  - `docs/pine/strategy-broker-spec.md`, with a new "pinned by" column;
  - `docs/pine/capture-queue-2026-10-05-s1.md`, which T3b turns into probe files;
  - `s1-broker-core.pine`, which T3b extends.
- **Dropped:** `s1BrokerCensus.measure.test.js` (107 lines). T0's `strategyOn` lane replaces it.
- **RT edits:**

  | file | edit |
  |---|---|
  | `RT/program.js` | `OP` table: **a new opcode after `OBJ_DELETE: 99`**; `brokerOps` / `broker` in `makeProgram`; `BROKER` added to `IMPLEMENTED` |
  | `RT/ir.js` | `EXPR.BROKER` and `brokerCall` (S1 +19) |
  | `RT/lowerIr.js` | one case (S1 +31) |
  | `RT/vm.js` | the fill step before each bar, plus the handler (S1 +48) |
  | `Dockerfile.web` | the ARG |
  | `docs/feature_flags.json` | the entry |

- **FE: S1's 12 sites, with today's anchors** (wave-18 lines are S1's hunk headers):

  | # | S1 site | wave-18 | master | train | open W4 lanes touching the same or adjacent band |
  |---:|---|---:|---:|---:|---|
  | F1 | import list: `brokerCall` plus three new imports | 51-62 | 53-59 | 53-59 | W4-T8 (`:43`), W4-T10 (`:42`), W4-T11 (`:64`): same import block, textual only |
  | F2 | `RUNTIME_REFUSALS`: `runtime:strategy-option` / `-value` (+ `-unpinned`, `-start`, `-repaint` in W9) | 291 | 316 | 316 | W4-T12 / W4-T13 (`:346`, `:364`), W4-T15 (`:347`): adjacent entries |
  | F3 | `buildRuntimeIr`: retry with the broker on `pine:strategy-call` | 1075 | 1074 | 1074 | none |
  | F4 | `buildRuntimeIrLinked` head: `brokerMode`, `brokerDecl` | 1125 | 1203 | 1203 | W4-T10 (`:1225`): adjacent |
  | F5 | `holdsBrokerRead` / `brokerRefusal` helpers, before `holdsObjectCall` | 2198 | 2739 | 2865 | W4-T12 / W4-T13 (`:2660`), W4-T8 (`:2338`): adjacent helpers |
  | F6 | column-planner exclusion `&& !holdsBrokerRead(...)` | 4993 | 5307 | 5459 | W4-T7 / W4-T8 (`hoistCommittedSeries`, `:5157-5163`): about 150 lines away, same planner |
  | F7 | value-name lowering to `brokerCall` (`ORDER_ENUM` neighbourhood) | 5090 | 5425 | 5579 | W4-T7 / W4-T8 (`:5768`), W4-T15 (`:5955`): nearby `lowerExpr` cases |
  | F8 | trade-function lowering at the head of `case 'call'` | 5504 | 5829 | 6006 | **W4-T10 (`:6006`, head of the same `case 'call'`): direct conflict**; W4-T11 (`:6152-6168`): same case |
  | F9 | declaration read and order lowering at R1's skip | 7651 | 8735 | 8913 | W4-T7 / W4-T8 (`:8663-8679`), **W4-T15 (`:8858-8973`, statement forms): overlapping band** |
  | F10 | `orderOnlyChain` bypass | 8082 | — | — | **no counterpart on master or the train**: wave 18's `orderOnlyChain` is gone. T1 must find how the current statement walker skips an `if` whose arms are only order calls, lower it in broker mode, and rail it (`if up` → `strategy.entry` places an order) |
  | F11 | `#symbol` prelude after `lowerStmts(stmts, root, true)` | 9562 | 10691 | 10926 | W4-T12 / W4-T13 / W4-T7 / W4-T8 (`:9976-10262`): adjacent band |
  | F12 | program options `broker: brokerDecl` | 9914 | 11025 | 11260 | **W4-T13 (`:11000`): same options object** |

  The W4 line numbers are each branch's own diff hunks at its merge base, which is older than
  master. They show the region, not a byte offset.

- **Delivers:**
  - S1's emulator, gate off;
  - S1's 23 values, lowered by F7 and F8;
  - per-version signatures (B-SIG) and v4 `when` (B-WHEN). v5 `when` is gated on Q-S1p;
  - the repaint refusal (rule 11);
  - the window check (3.1);
  - the record skeleton.
- **Port changes, and nothing more:**
  - the opcode renumbering;
  - the `pinned()` ask at each `[B-..]` decision, at run time;
  - the anchors;
  - F10;
  - rule 11;
  - the window check.
- **Rails:**
  - S1's suite with a test pin set;
  - gate-off parity with master, using every script in `runtimeStrategy.test.js`;
  - a broker-mode case in `objectDoorGate.test.js`;
  - **the existing opcode rail** `runtimeHardeningP1.test.js:153-158`, reused rather than
    duplicated. Mutation-prove it with the broker opcode set to 97;
  - the repaint refusal, one case per construct;
  - the window refusal.
- **Mutations:**
  - drop the gate check;
  - drop the forming-bar skip;
  - drop `pinned()`;
  - drop rule 11.
- **Engine bump:** no (dark).
- **Depends:** the train.
- **Conflicts:** W4-T7, W4-T8, W4-T10, W4-T11, W4-T12, W4-T13 and W4-T15 (section 6).

### T2 Pin ledger, identity and strategy grader | M | Sonnet | no capture to build

- **Owns:**
  - new `RT/brokerPins.json` (the hand-edited ledger: rule id → fixture ids);
  - `RT/brokerPins.resolved.json` (generated) and `RT/brokerPins.js` (`pinned`,
    `BROKER_PINS_SHA256`);
  - the runtime identity object, one field `broker_pins`, at whichever module W5-T1/W5-T4 define
    it (`runtimeColumns.js` today);
  - `tools/vendor_harness/compare.mjs` (strategy grade);
  - `tools/vendor_harness/evidence_engine.py` (resolve step).
- **Delivers:**
  - rule 7's resolve step, digest and identity field;
  - the strategy grade.
- **The strategy grade:**
  - **Bar identity first.** Before any rule is graded, our bars and the capture's bars must be
    identical to the tick, OHLCV, over the run window. The capture's chart settings must also
    match ours: dividend adjustment, back-adjustment, session RTH/ETH and the time zone (5.1).
    A mismatch is INCONCLUSIVE "bars differ", never a rule DIVERGE.
  - Then compare the plotted `strategy.*` rows and the trade list:
    - prices exact to `syminfo.mintick`;
    - quantities exact;
    - currency exact to 1e-9 relative.
  - A differing fill names its `rule`.
  - Method (b) rows compare only inside the fixture's recorded range.
- **Rails:**
  - a missing fixture fails;
  - a DIVERGE or INCONCLUSIVE fixture does not pin;
  - our refusal against their value is DIVERGE;
  - bars differing gives INCONCLUSIVE;
  - **identity** (rule 7).
- **Mutations:**
  - INCONCLUSIVE counted as MATCH;
  - the bar-identity check skipped;
  - `broker_pins` removed from the identity.
- **Depends:** T1 (rule ids). Coordinates with W5-T1/W5-T4 on the identity object.

### T3a Capture tooling for strategies | M | Sonnet | report reader gated on W9-C0

- **Owns:**
  - `tools/vendor_harness/tv_capture.js` (`__uctVH.strategy()`, `__uctVH._strategyKeys()`);
  - `schema.mjs`, `verify_capture.mjs`, `adapters.mjs`;
  - `batch_capture.py`.
- **Delivers:**
  - **Start from the existing strategy path** (finding 8: the `StrategyScript$USER;` fixtures).
    Find out how those were loaded before adding any `Create new ▸ Strategy` branch.
  - **A settings read-back** into `provenance.strategySettings`:
    - every Properties-tab input, including the July-2026 menus (Bar detalization, Limit order
      execution, Order execution delay, leverage, commission, slippage, currency, margin and
      pyramiding);
    - **and the chart's data settings**: dividend adjustment, back-adjustment, session,
      timezone.
    A strategy capture without them fails `verify_capture`.
  - A method (b) range recorded in `provenance.gradeRange` (`{from, to}` epoch seconds).
  - The report reader after W9-C0: trades, performance and equity from the strategy data
    source.
- **Rails:**
  - schema refuses a strategy capture with no settings;
  - existing captures verify byte-identically.
- **Depends:** W9-C0 for the reader half only.

### T3b Probe files | M | Sonnet | no capture (writes what the rig runs)

- **Owns:** every probe named in 5.2, under `tools/visual_conformance/probes/`, and the queue doc
  `docs/pine/capture-queue-2026-11-XX-w9.md`. The queue doc carries 5.2's rows verbatim, in the
  evidence engine's format.
- **Delivers:**
  - each probe plots 5.1's standard set plus its row's fields;
  - prices fed to the broker are on the tick grid unless the row tests otherwise;
  - method (b) probes gate every order call on `time >= X and time < Y`, use only finite-window
    kernels (`ta.sma`, `ta.highest`, `ta.lowest`) for signals, and state X and Y in a comment and
    in the queue row.
- **Rails:**
  - `evidence_engine.py queue` resolves every W9 row to a source (no NEEDS_PROBE);
  - each method (b) probe contains its range guard on every order call (a grep rail).
- **Depends:** T1 (the spec port). It can run beside T3a.

### T4 Sizing, capital, defaults, currency | M | Opus | gated: Q-S1a, Q-S1b, W9-D1, W9-D2

- **Owns:** the `ast/strategyBroker.js` defaults table and the `RT/broker.js` sizing function.
- **Delivers:**
  - `percent_of_equity` and `cash`: which price sizes the order, and the rounding;
  - the v1-v4 and v6 defaults;
  - v5 capital and margin;
  - `currency` served as identity only;
  - margin at the values W9-D1 witnesses. Margin calls stay refused (Q-S1i, deferred).
- **Rails:**
  - a per-version default against its capture;
  - percent sizing on a bar where the close and the next open differ;
  - whole-unit rounding against fractional rounding.
- **Depends:** T1, T2.

### T5 Costs | S | Sonnet | gated: W9-K1..K4

- **Delivers:**
  - the three commission types on entry and exit;
  - slippage in ticks: which order types slip, and in which direction;
  - **both at the close price under `process_orders_on_close`**, pinned by W9-P1.
- **Rails:** the fixtures vary quantity, so a per-order charge and a per-contract charge
  disagree.
- **Depends:** T1, T2.

### T6 Fill timing | M | Opus | gated: W9-P1, W9-P1b, W9-P2, W9-P3, W9-J1; Q-S1o deferred

- **Owns:** the `RT/vm.js` step order and the `RT/broker.js` fill-timing branch.
- **Delivers:** `process_orders_on_close`, specified as follows (each item pinned by W9-P1 or
  W9-P1b, each refusing until then):
  - A market order or `strategy.close` placed on bar t fills at bar t's close, after the script
    on t.
  - **An exit bracket placed on the POC bar:** whether it is live from that close or from the
    next open.
  - **`position_size` / `position_avg_price` read on the next bar** include a close fill. A read
    on the same bar cannot see it, because the script has already run.
  - **Commission and slippage** are computed at the close price.
  - **POC with pyramiding:** an add placed on the same bar as an open trade fills at the close,
    up to the pyramiding limit.
  - **POC with `calc_on_order_fills`:** the order of the re-run and the close fill.

  It also delivers:
  - `calc_on_order_fills` on history;
  - `calc_on_every_tick` on history, which is expected to have no effect;
  - the July-2026 settings, served only at their defaults (W9-J1);
  - `backtest_fill_limits_assumption`.
- **Rails:** each item above, on a fixture where the two candidate timings give different trades.
- **Depends:** T1, T2.

### T7 Exit family and other order kinds | M | Opus | gated: W9-X1..X4, Q-S1d, f, g, h, j, k

- **Delivers:**
  - trailing exits;
  - partial and multi-level exits;
  - partial close;
  - OCA cancel and reduce;
  - `strategy.order`, which ignores pyramiding and does not reverse;
  - `immediately`;
  - stop-limit orders;
  - the v5 and v6 exit-level rules.
- **Depends:** T1, T2.

### T8 `strategy.risk.*` | S | Sonnet | gated: W9-R1

- **Delivers:** each `strategy.risk.*` function, served only once its row MATCHes. The intraday
  half is pinned by method (b) on `AMEX:SPY 15`.
- **Depends:** T1, T2, T4.

### T9 Bar detalization (bar magnifier) | M | Opus | gated: W9-M1; data (W7.3); deferred (D3)

**0 sample scripts set `use_bar_magnifier`.** The value of T9 is the member-facing Properties
setting, not the sample.

- **Delivers:**
  - lower-timeframe fills as W9-M1 shows;
  - without those bars for the whole window, a refusal by name. It never falls back to B-PATH.
- **Depends:** T6, W7.3, D3, D4.

### T10 The tail of the `strategy.*` read-backs | S | Sonnet | gated per value; W9-V1

S1's 23 values are delivered by T1 (F7 and F8). T10 delivers only:
- the values outside S1's set:
  - `max_drawdown`, `max_runup`;
  - `avg_trade`, `avg_winning_trade`, `avg_losing_trade`;
  - `*_percent`;
  - `max_contracts_held_*`;
  - `position_entry_name`;
  - `opentrades.profit`;
  - `closedtrades.commission`, `closedtrades.max_runup`, `closedtrades.max_drawdown`;
  - `closedtrades.first_index`, together with v6's trim of the oldest trades over 9,000;
  - `margin_liquidation_price`;
  - `account_currency`;
- text values through a label (W3's object lane, on the runtime pane only);
- the `pinned()` asks for each value.

The owned area is the `BROKER_OPS` table in `RT/broker.js` and F7/F8's value lists only.

- **Depends:** T1, T2.

### T11 The record through the run | S | Sonnet | no capture

- **Owns:**
  - `RT/runtimeColumns.js` and `RT/runtimeWorker.js`: carry the record beside the columns;
  - `RT/limits.js`: one trade/order budget;
  - the runtime path of `memberPaneDefinition.js`: read-only pass-through, plus
    `ctx.historyWindowBars` (3.4).
- **Delivers:**
  - the 3.2 schema, frozen;
  - over budget, a refusal by name;
  - gate off: no key.
- **Rails:**
  - schema;
  - the record survives the worker boundary byte-identically;
  - gate off;
  - the window comes from the context, never a literal.
- **Depends:** T1.
- **Conflicts:** W4-T8 (`limits.js`), W4-T13 (`memberPaneDefinition.js`), W5-T1 / W5-T19
  (`runtimeColumns.js`).

### T12 Trade markers | M | Sonnet | gated: W9-MK1

- **Delivers:**
  - markers from the record's fills;
  - the presentation W9-MK1 shows;
  - unpinned presentation drawn as a plain marker with "marker style not yet verified";
  - the `asOfBar` stamp.
- **Rails:** markers equal the fills, one to one.
- **Depends:** T11 and W2 stage 1, before a member sees it.

### T13a Report metrics | M | Opus | gated per metric: W9-S1, W9-S2

- **Owns:** new `RT/brokerReport.js`.
- **Delivers:** pure functions of the record, one per metric:
  - the list-of-trades fields: run-up, drawdown, cumulative profit and %;
  - the performance summary: net and gross profit and loss, commission, buy and hold, maximum
    equity run-up and drawdown, Sharpe, Sortino, profit factor, maximum contracts, open P&L,
    trade counts, percent profitable, averages and ratio, largest win and loss, average bars
    (all, winning, losing), margin calls.
  Each metric is served only once pinned.
- **Rails:**
  - one fixture per metric that tells the candidate formulas apart;
  - an import rail: the module reads the record type only.
- **Depends:** T11.

### T13b Report panel | M | Sonnet | no capture of its own

- **Delivers:**
  - the three-tab panel (3.3), rendering T13a's values or their refusal sentences;
  - the Properties tab from `record.settings` and `record.window`;
  - the `asOfBar` stamp.
- **Rails:** an unpinned metric renders its sentence and never a number.
- **Depends:** T13a.

### T14 Server-side strategy backtests through W5 | M | Opus | no capture of its own

- **Owns:**
  - W5 service handling of `want: "#strategy"` (W5 files, under the coordinator);
  - the record codec in `api/services/pine_runtime_codec.py` (arrives with W5-T11);
  - new `api/routers/pine_strategy_backtest.py` and its auth rail;
  - the refusal added to W5-T15's `_runtime_descriptor` path.
- **Delivers:**
  - 3.4, with **the window imported from W5-T14's `scan_evaluator._MAX_BARS`** and no new bar
    constant;
  - the record digest-equal to the browser's for the same window;
  - refusals mapped through W5-T15's table.
- **Rails:**
  - host parity of the record;
  - the window comes from `_MAX_BARS`, checked by identity plus a grep for a stray 5000;
  - a window that does not reach the listing is served with `fromListing: false` and its start
    stated;
  - auth: route count and plan gate.
- **Depends:** T11; W5-T11, W5-T14 and W5-T15 merged; the W5 service deployed (owner); D5.

### T15 Docs and the ruling's wording | S | Haiku | no capture

- **Delivers:**
  - comment and scorecard wording only in `strategiesAreRuled.test.js` (after D7);
  - the "pinned by" column in the spec, kept current.

### Deferred

- Realtime: `calc_on_every_tick` on a live bar, forming-bar outputs and strategy alerts. These
  wait on W5 Q3 and a feed.
- `calc_on_every_history_tick`: no historical ticks.
- Margin calls (Q-S1i).
- Synthetic chart types: Heikin Ashi mode, Renko and the like.
- Deep backtesting.
- `request.*` (W7) and libraries (W8).

---

## 5. The capture plan

### 5.1 Standing settings for every W9 capture

- **Read from the chart model only.**
  - Plotted rows come through `tv_capture.js`'s plot reader.
  - Trades, the summary and equity come through T3a's reader after W9-C0.
  - Text fields (entry and exit ids, comments) come from a label read through `graphics()`.
  - **No CSV, anywhere.** The S1 rows that read a "trades CSV" are re-specified below with
    plotted or label fields.
- **The standard plotted set (every probe, every bar):**
  - `bar_index` (control);
  - `strategy.position_size`, `position_avg_price`, `opentrades`, `closedtrades`, `netprofit`,
    `equity` and `openprofit`;
  - for the **last three closed trades**: `entry_bar_index`, `exit_bar_index`, `entry_price`,
    `exit_price`, `size`, `profit` and `commission`, as 21 plots.
  - A label on each new close: `closedtrades.entry_id(i)`, `closedtrades.exit_id(i)` and the
    comments.
  Plot values are model doubles, so prices keep full precision. That rebuilds the list of trades
  without the report reader. **W9.1 and W9.2 do not wait on W9-C0.**
- **Settings:** set only in the source. The full Properties tab and the chart's data settings are
  read back (T3a). A disagreement is INCONCLUSIVE.
- **Where TradingView's window and ours agree:**
  - **Method (a): first loaded bar = listing on both sides.** The house chart is **`NYSE:RDDT 1D`**:
    the listing is 2024-03-21, the history is 636 bars, below `_MAX_BARS`, and both sides start
    at the listing (finding 7). The capture asserts
    `window.firstBarTime == listing` and `history.startsAtBar0`.
  - **Method (b): an explicit range.** Every order call is gated on `time >= X and time < Y`, and
    signals use finite-window kernels only, so no trade or equity value depends on bars before
    X. The fixture records `gradeRange`. The capture asserts that TradingView's
    `window.firstBarTime` is at or before `X - warm-up`, and our window must hold the same.
    Used for `AMEX:SPY` rows:
    - `1D`: X = 2023-01-03 09:30 ET, Y = 2025-01-02 09:30 ET. That is inside TradingView's 1,800
      loaded bars (from 2019-08-06) and inside our 5,000.
    - `15`: X and Y inside the last 20 sessions before the capture, recorded per fixture. Our
      15-minute window of 5,000 bars holds about 192 RTH sessions.
  - No other pin or grading chart is used.
- **Market closed** (`newestBarIsForming` false), except the live rows.
- **Account plan** recorded (D4).

### 5.2 The rows

Every probe path is under `tools/visual_conformance/probes/`. **T3b writes every probe marked
(new).** `s1-broker-core.pine` exists on S1 and moves to master with T1. "Std" means the 5.1
standard set.

**A. Spike (owner, rig, read-only; no fixture)**

| row | what | chart | unblocks |
|---|---|---|---|
| W9-C0 | With `s1-broker-core.pine` loaded, a key walk of `mm.dataSources()`. Find the strategy source; list its methods and own properties to depth 2, names and types only. The reader is `__uctVH._strategyKeys()` (T3a). Note where trades, performance and equity sit, and whether they fill before the report panel opens. | `NYSE:RDDT 1D` | T3a reader → W9-S1, W9-S2, block E |

**B. Rule pins: S1's rows**

| row | probe | method / chart | captures | fields read (beyond std) | settles | gates |
|---|---|---|---:|---|---|---|
| Q-S1-core | `s1-broker-core.pine` (extended to std) | (a) `NYSE:RDDT 1D` | 1 | rows N02..N14 | B-FILL, B-MARKET, B-PATH, B-GAP, B-PYR (explicit 2), B-REVERSE, B-MODIFY, B-CLOSE, B-EXIT-*, B-FIFO, B-VAL; W9-J1 settings | T1 |
| Q-S1-core-b | `s1-broker-core-range.pine` (new: core with the range guard) | (b) `AMEX:SPY 1D` | 1 | std inside the range | the same rules on a second symbol; proves method (b) | T1 |
| Q-S1a | (new) `w9-q-s1a-size-v4.pine`, `-v6.pine`, `-v5pct.pine`, `-v5cash.pine`, `-v2.pine` | (a) RDDT 1D | 5 | `opentrades.size(0)` and `position_size` on the fill bar; `equity` and `close` on the signal bar | sizing price, rounding, version defaults | T4 |
| Q-S1b | (new) `w9-q-s1b-defaults-v4.pine`, `-v5.pine`, `-v6.pine`: no properties; **two same-direction entries with different ids on consecutive signals, then an opposite entry** | (a) RDDT 1D | 3 | `initial_capital`, `equity` on bar 0; `opentrades` after each entry; `position_size` after the opposite entry | capital and margin defaults; **the default pyramiding per version**; reversal regardless of pyramiding | T4, T1 |
| Q-S1c | (new) `w9-q-s1c-tie.pine`: plots `open - low == high - open` and enters on the first tie bar on RDDT. If RDDT has none, the row moves to (b) SPY 1D with the range covering the bar | (a) RDDT 1D | 1 | std; entry and exit bars of trade 0 | the path on a tie | T1 |
| Q-S1d | (new) `w9-q-s1d-same-tick.pine` | (a) RDDT 1D | 1 | std; ids by label | same-tick fill order | T1, T7 |
| Q-S1e | (new) `w9-q-s1e-live-past.pine` | (a) RDDT 1D | 1 | std | an exit live already past its level | T1 |
| Q-S1f | (new) `w9-q-s1f-reversal-exit.pine` | (a) RDDT 1D | 1 | std; exit id by label | does a reversal end an exit with no `from_entry` | T7 |
| Q-S1g | (new) `w9-q-s1g-pyr-limit.pine` | (a) RDDT 1D | 1 | `opentrades`; `entry_bar_index` of the last trade | a price entry at the pyramiding limit | T7 |
| Q-S1h | (new) `w9-q-s1h-fifo.pine` | (a) RDDT 1D | 1 | `closedtrades.size(i)` for the last three; `entry_id(i)` by label | the FIFO split | T7 |
| Q-S1i | (new) `w9-q-s1i-funds.pine` | (a) RDDT 1D | 1 | std; exit comment by label (shows "Margin call") | insufficient funds and margin call | deferred |
| Q-S1j | (new) `w9-q-s1j-stop-limit.pine` | (a) RDDT 1D | 1 | std | stop-limit | T7 |
| Q-S1k | (new) `w9-q-s1k-exit-levels.pine` and `-v6.pine` | (a) RDDT 1D | 2 | std | relative against absolute (v5/v6), fractional ticks, an all-na modify | T7 |
| Q-S1l | (new) `w9-q-s1l-off-grid.pine` | (a) RDDT 1D | 1 | `exit_price` of the last trade at full double precision, plus `exit_price / syminfo.mintick` | is an off-grid fill rounded | T1 |
| Q-S1m | (new) `w9-q-s1m-index.pine` | (a) RDDT 1D | 1 | `opentrades.entry_price(5)` with one trade open | out-of-range index | T10 |
| Q-S1n | `s1-broker-core.pine` at two loaded depths | `AMEX:SPY 1D` (fact capture, not a pin) | 2 | std; `window.firstBarTime` | does TradingView start at its first loaded bar (B-START). Confirms that methods (a) and (b) are the only gradable ones | D2 record |
| Q-S1p | (new) `w9-q-s1p-when.pine` (v5 `when =`) | (a) RDDT 1D | 1 | std | v5 `when` | T1 |

**C. Rule pins: new W9 rows**

| row | probe (new) | method / chart | captures | fields read (beyond std) | settles | gates |
|---|---|---|---:|---|---|---|
| W9-D1 | `w9-d1-v6-defaults.pine`, `w9-d1-margin50.pine` | (a) RDDT 1D | 2 | settings read-back; `margin_liquidation_price` | v6 margin and leverage defaults; margin at a stated value | T4 |
| W9-D2 | `w9-d2-currency.pine` | (a) RDDT 1D | 1 | std | identity currency | T4 |
| W9-K1 | `w9-k1-commission-pct.pine` (trades of 1 and 7) | (a) RDDT 1D | 1 | `closedtrades.commission(i)` | percent commission | T5 |
| W9-K2 | `w9-k2-commission-contract.pine` | (a) RDDT 1D | 1 | same | per contract | T5 |
| W9-K3 | `w9-k3-commission-order.pine` | (a) RDDT 1D | 1 | same | per order | T5 |
| W9-K4 | `w9-k4-slippage.pine` (market, stop and limit each way) | (a) RDDT 1D | 1 | entry and exit prices | which orders slip | T5 |
| W9-P1 | `w9-p1-on-close.pine`: `process_orders_on_close = true`; market entry, **an exit bracket placed on the entry's bar**, **a pyramided add** (`pyramiding = 2`), `strategy.close`, commission 0.1% and slippage 2 | (a) RDDT 1D | 1 | std; `position_size` on the fill bar and the next bar; `closedtrades.commission(i)` | POC timing, brackets, pyramiding, costs at the close | T6, T5 |
| W9-P1b | `w9-p1b-on-close-fills.pine`: POC + `calc_on_order_fills = true` | (a) RDDT 1D | 1 | std; a plotted per-bar run counter (`var`) | the re-run order under POC | T6 |
| W9-P2 | `w9-p2-order-fills.pine` | (a) RDDT 1D | 1 | std; run counter | `calc_on_order_fills` on history | T6 |
| W9-P3 | `w9-p3-every-tick-history.pine` | (a) RDDT 1D | 1 | std | `calc_on_every_tick` on history | T6 |
| W9-J1 | rides on Q-S1-core (settings read-back) | (a) RDDT 1D | 0 | July-2026 defaults | the defaults | T6 |
| W9-X1 | `w9-x1-trail.pine` | (a) RDDT 1D | 1 | std | trailing exits | T7 |
| W9-X2 | `w9-x2-partial.pine` | (a) RDDT 1D | 1 | `closedtrades.size(i)` | partial and multi-level exits, partial close | T7 |
| W9-X3 | `w9-x3-oca.pine` (cancel, then reduce) | (a) RDDT 1D | 1 | std; ids by label | OCA | T7 |
| W9-X4 | `w9-x4-order.pine`: `strategy.order` beyond `pyramiding`, `close_all(immediately = true)` | (a) RDDT 1D | 1 | `opentrades` | `strategy.order` ignores pyramiding; immediately | T7 |
| W9-R1 | `w9-r1-risk-allow.pine`, `w9-r1-risk-ddown.pine` | (a) RDDT 1D | 2 | std | `allow_entry_in`, `max_drawdown` | T8 |
| W9-R1i | `w9-r1-risk-intraday.pine` (range guard) | (b) `AMEX:SPY 15` | 1 | std | `max_intraday_loss`, `max_intraday_filled_orders` | T8 |
| W9-M1 | `w9-m1-magnifier-off.pine`, `w9-m1-magnifier-on.pine` | (a) RDDT 1D | 2 | std; settings | which lower timeframe; the fill differences | T9 (deferred, D3/D4) |
| W9-V1 | `w9-v1-values.pine` | (a) RDDT 1D | 1 | every v6 value outside S1's set; `position_entry_name` by label | T10's tail | T10 |
| W9-MK1 | `w9-mk1-markers.pine` (entry and exit comments set) | (a) RDDT 1D | 1 | the strategy source's `graphics()` and `properties().state()` | marker presentation | T12 |
| W9-S1 | Q-S1-core, report reader | (a) RDDT 1D | 1 | the report object (T3a) | summary formulas | T13a |
| W9-S2 | `w9-s2-sharpe.pine` at `risk_free_rate` default and 0 | (a) RDDT 1D (about 31 months) | 2 | the report object | Sharpe and Sortino | T13a |

**D. Live (attended RTH; never batched; deferred with their tasks)**

| row | probe | chart | captures | settles |
|---|---|---|---:|---|
| Q-S1o | `w9-q-s1o-every-tick.pine` (new) | `AMEX:SPY 5` | 1 | forming-bar ticks |
| Q-S1p-live | `s1-broker-core.pine` | `AMEX:SPY 5` | 1 | forming-bar outputs |

**E. Grading (unmodified sources; local evidence for builtin and reference per `LICENSING.md`)**

| row | scripts | method / chart | captures | gated on |
|---|---|---|---:|---|
| W9-G | all 70 strategies at defaults | (a) `NYSE:RDDT 1D` | 70 | the pins each script needs, plus T3a's reader (W9-C0) |

Corpus scripts cannot be edited with a range guard, so grading uses method (a) only. The
existing RDDT strategy fixtures (finding 8) carry no trade data and are re-captured.

### 5.3 Size of the set

| block | captures | schedulable now (once T3b's probes exist) |
|---|---:|---:|
| B: S1 rows | 25 | 24 (Q-S1i deferred) |
| C: new rows | 25 | 23 (W9-M1 ×2 deferred) |
| **rule pins total** | **50** | **47** |
| of which wait on T3a's reader | 3 (W9-S1, W9-S2 ×2) | |
| A: spike | 1 session, no fixture | 1 |
| D: live | 2 | 0 (deferred) |
| E: grading | 70 | after pins and the reader |

Pacing: 30 s throttle, 40 per session. That makes the 47 about **2 sessions**, plus the spike. E
is about 2 sessions later.

**First session:** W9-C0, Q-S1-core, Q-S1-core-b, Q-S1a ×5, Q-S1b ×3 and W9-D2. That is 11
captures. They settle the core, pyramiding defaults, method (b) and walls 1 to 4, which reach 27
of the 40 only-W9 scripts.

---

## 6. What can run in parallel

| task | owns (train anchors) |
|---|---|
| T0 | `coverage_map.py` `:358`, `:368-373`, `:670-690`; `w0/targets.py` `:56`, `:189` |
| T1 | new broker files; `RT/program.js` OP tail, `makeProgram`, `IMPLEMENTED`; `RT/ir.js`; `RT/lowerIr.js` (one case); `RT/vm.js` (bar loop + handler); FE F1-F12 (T1 table) |
| T2 | `RT/brokerPins.*`; the identity field; `compare.mjs`, `evidence_engine.py` |
| T3a | `tv_capture.js`, `schema.mjs`, `verify_capture.mjs`, `adapters.mjs`, `batch_capture.py` |
| T3b | new probes; the new queue doc |
| T4, T5, T7, T8 | `RT/broker.js` functions (sizing, cost step, exits and orders, risk filter); `strategyBroker.js` defaults (T4) |
| T6 | `RT/vm.js` step order; `RT/broker.js` timing branch |
| T9 | `RT/broker.js` path source; lower-TF binding |
| T10 | `BROKER_OPS`; F7 and F8 value lists |
| T11 | `RT/runtimeColumns.js`, `RT/runtimeWorker.js`, `RT/limits.js`, the `memberPaneDefinition.js` runtime path |
| T12 | a new renderer primitive |
| T13a / T13b | `RT/brokerReport.js` / the new panel |
| T14 | W5 service files; `pine_runtime_codec.py`; the new router; W5-T15's descriptor path |
| T15 | `strategiesAreRuled.test.js` (comments); the spec |

**Conflicts that force an order:**

| pair | why | order |
|---|---|---|
| T1 → every W9 engine task | creates the files | T1 first |
| T1 ⟂ W4-T10 | **F8**, the head of `case 'call'`; and `RT/ir.js`, `lowerIr.js`, `vm.js` | merge W4-T10 first, then rebase T1 |
| T1 ⟂ W4-T15 | **F9**: statement-form band `:8858-8973` against R1's skip | W4-T15 first |
| T1 ⟂ W4-T13 | **F12**, the program options object; F2; F11's band | W4-T13 first |
| T1 ⟂ W4-T12 | F2, F5, F11 bands (adjacent) | W4-T12 first, or rebase either way |
| T1 ⟂ W4-T7, W4-T8 | F6 (planner), F9 (`:8663-8679`), F11 band; W4-T8 also edits `ir.js`, `lowerIr.js`, `vm.js`, `limits.js` | W4-T7, then W4-T8, then T1 |
| T1 ⟂ W4-T11 | F1 imports; F8's `case 'call'` (text calls) | W4-T11 first |
| T1 ⟂ W4-T2, W4-T9 | none (`:1738`, `:4543-4751`, `:9674` are clear of F1-F12) | any |
| T11 ⟂ W4-T8 | `RT/limits.js` | W4-T8 first |
| T11 ⟂ W4-T13 | `memberPaneDefinition.js` | W4-T13 first |
| T11 ⟂ W5-T1, W5-T19 | `runtimeColumns.js` | W5 first |
| T2 ⟂ W5-T1, W5-T4 | the engine identity object | W5-T4 first; T2 adds one field |
| T14 ⟂ W5-T11, W5-T14, W5-T15 | codec, `_MAX_BARS`, `screener_backtest.py` | all three first |
| T4 ⟂ T5 ⟂ T7 ⟂ T8 | `RT/broker.js`, different functions | T4, T7, T5, T8 (ranking order) |
| T6 ⟂ T9 | `vm.js` step order | T6 first |
| T10 ⟂ T4..T8 | `BROKER_OPS` against the handlers | rebase, any order |
| T11 → T12, T13a, T14 | the record schema | T11 first |
| T0 ⟂ W4-T0 (merged in the train) | `coverage_map.py` | base T0 on the train |
| T3a ⟂ E (evidence engine) | `batch_capture.py`, `evidence_engine.py` | after E's open PR |

The W4 lanes still open (not in the train): W4-T2, T7, T8, T9, T10, T11, T12, T13, T14 and T15.
T1 waits on the W4 lanes that overlap it, or rebases onto each as it merges. **The cheapest
order is T1 after W4-T10, W4-T13 and W4-T15.**

**Batches** (at most 3 Opus or Fable agents; heavy jobs serialised):
- **Batch 1 (now, no capture):** T0, T2 (against S1's ids), T3a (settings read-back and load
  path), T3b.
- **Batch 2:** T1, once W4-T10, W4-T13 and W4-T15 have merged to the train (or on the train
  tip, accepting the rebases).
- **Batch 3:** T11, T10, T15 (after D7).
- **As captures land:** T4 → T7 → T5 → T8 → T6. Then T12, T13a and T13b.
- **After W5-T11, W5-T14, W5-T15 and the deploy:** T14.
- **After D3 and W7.3:** T9.

---

## 7. How the numbers were taken

- Population and census: `coverage-map.json` at master (2026-11-02, `6272ed7fa3`) and
  `coverage-targets-2026-11-02.json`, read-only.
- Finding 4: `git show origin/fix/pine-w0-census-peel:docs/pine/coverage-map.json`. The review
  reproduced it.
- Walls: a static scan on 2026-11-05 over the 70 sources:
  - committed: `corpus/committed/`;
  - builtin and reference: the local licence-held cache `_resume-2026-11-01/pine-sample/`, not
    committed;
  - comments stripped and argument lists parsed.

  The greedy prefers only-W9 completions. This is a heuristic over text; T0's `strategyOn`
  replaces it. The review recomputed it and matched it.
- r1 additions:
  - repaint-class constructs and `pyramiding =` by regex over the same 70 sources;
  - `use_bar_magnifier` grep: 0;
  - S1 FE sites from `git diff 34da5eb926~1 34da5eb926`, re-anchored by grepping each hunk's
    context line in master's and the train's FE;
  - open W4 lanes from `git diff <merge-base> <branch>` hunk headers on FE and `RT/`;
  - SPY's TradingView depth from the committed `supertrend-strategy-spy-1d-2026-10-02`
    (`window.chartBarsLoaded` 1800);
  - RDDT from `r1-strategy-draws-rddt-1d-2026-10-02` (`history.startsAtBar0`);
  - `_MAX_BARS` from `scan_evaluator.py:230` on `origin/feat/pine-w5-t14-scans`.

---

## 8. Decisions the owner must make

- **D1. Pin-before-serve** for the 22 text-settled rules. Recommended: yes. The first session
  pins most of them.
- **D2. Runs whose window does not reach the listing.** Under R10 they are served with their
  start stated, and graded only by (a) and (b). Should the member-facing report also say "this
  backtest starts on <date>, TradingView may start elsewhere"? Recommended: yes, always.
- **D3. Bar detalization data** (W7.3). No sample script sets it. Recommended: defer T9.
- **D4. The rig account's plan.** Detalization and `calc_on_every_history_tick` are
  Premium-gated.
- **D5. W9.4 product shape:**
  - the route and URL;
  - the plan gate;
  - multi-symbol runs, which cost `symbols × _MAX_BARS`.
- **D6. Arming:** per W2 stage (built-ins whose pins MATCH first), or all at once.
- **D7. The "strategies is a ruling" scorecard wording.** The screener ruling stays.
- **D8. Metrics TradingView computes from data we lack:** show the refusal (recommended) or
  omit the metric.
- **D9. A longer strategy window.** Any wish for more than `_MAX_BARS` is a change to that one
  constant, for every server lane (R10). It is not a W9 parameter.

---

## 9. What I could not determine

1. Where the strategy report lives in the chart model, and whether it fills before the panel
   opens (W9-C0).
2. v6's default sizing (Q-S1a); 20 scripts depend on it.
3. The July-2026 settings' exact semantics: Limit order execution, the Order execution delay
   unit, and the leverage-to-margin mapping. W9-J1 and W9-D1 pin the defaults only.
4. Why the 11-03 census lost 17 strategies from `[strategy]`. The inventory hypothesis is
   unverified. To check it, compare `usage_of(src, inv)["items"]` for `ut-bot-strategy` under
   both references.
5. Whether `bars.db` holds RDDT's full daily history from 2024-03-21. Method (a) needs our
   window to start at the listing too. T2's bar-identity check will show it, and RDDT 1D is
   assumed until then.
6. **Whether the chart lane's `/api/bars?bars=5000` request derives from `_MAX_BARS`.** It
   appears to be a restated literal. It belongs to the chart lane and W5, not W9. W9 only reads
   the window from the run context.
7. How the current statement walker skips an `if` whose arms are only order calls. The site S1
   patched (`orderOnlyChain`) no longer exists (F10).
8. The broker's per-bar cost on the W5 service. W5-T9 should add a strategy case before D5 is
   sized.
9. Whether method (b)'s warm-up assertion holds on TradingView's 15-minute depth for the rig's
   plan (W9-R1i). If it does not, the intraday half of T8 is deferred.
10. Whether S1's 247-line rail passes once ported (T1).
