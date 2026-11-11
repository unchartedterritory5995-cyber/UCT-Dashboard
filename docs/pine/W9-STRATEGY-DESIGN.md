# W9 "Strategy tester": design and task breakdown
> Status as of 2026-11-07: see docs/pine/W9-DECISIONS-2026-11-07.md / landed lanes. Landed: engines 22-32 and W9-T11/T14/T15.

Written 2026-11-05 by a W9 design author (desktop), docs only. No vitest, census, harness or rig
was run for this document.

**Revision r3 (2026-11-05)** answers the review NO-GO at `77859d00b4` on one blocker, under the
coordinator's ruling:
- **B1, the trade floor applies to TradingView's count only.** The floor is applied to the
  reference (TradingView's captured closed-trade count) and decided from the capture before our
  output is looked at. Our broker's count never selects a symbol and never makes a script
  ungradable.
  - TradingView at or above the floor, with any difference from us: **DIVERGE**.
  - TradingView at or above the floor, equal: **MATCH**.
  - TradingView below the floor: **UNGRADABLE on that symbol**. The script moves to the SPY
    time-range probe, or is listed by name.
  - New rail: a 6-ours-against-2-theirs case grades DIVERGE (T2, 5.2 E).
- **Notes:**
  - (a) The lock rail fails only when the ledger changes without a bump. Non-pin bumps pass.
    Both cases are in the rail spec (rule 7).
  - (b) `snapshot_builder.DEEP_BARS` is NOT folded into `bars_window.HISTORY_WINDOW_BARS`: it is the
    all-time-high lookback and keeps its own literal (ruling R13; 3.4).
  - (c) W5-T11, W5-T14 and W5-T15 are **not** on the train yet. W5-T15 lands through the train
    (`integ/pine-train-2026-11-05`), and T14a builds from the train tip (T14a, section 6).
  - The review's N4: SPY variants use a warm-up of 5x the longest lookback, and any that do not
    converge are named UNGRADABLE.

**Revision r2 (2026-11-05)** answered the delta review NO-GO at `a967e01a14`
(`_resume-2026-11-01/dsk/reviews/W9-DESIGN.md`), under the coordinator's rulings:
- **B1, identity.** No pin field goes into the engine identity. **Each pin-ledger landing takes
  a `SCRIPT_ENGINE_VERSION` bump, in merge order.** `SCRIPT_ENGINE_VERSION` stays the one
  authority, W5's five-field identity is unchanged, and HP-1 digests move only on a bump.
  - Rail: a change to the ledger without a version change fails.
  - See rule 7 and task T2.
- **B2, the window constant.** T14 does not import `scan_evaluator`; the standing E-3 rail
  forbids it. The one constant moves to the neutral module `api/services/bars_window.py`, which
  every user imports.
  - New prerequisite task T14a.
  - Rails: E-3 unchanged, plus a one-authority rail.
  - See 3.4.
- **B3, no vacuous MATCH.** A script that is refused, or whose TradingView capture has fewer than
  **5 closed trades** (r3: the reference's count only), is **UNGRADABLE**, never MATCH. Grading is re-planned on the true RDDT count
  (about 660 bars), with eligible, SPY-probe and ungradable counts given separately (5.2 E, 5.3).
- **Review notes:**
  - N1: anchors moved to train `1b8b4616d8`; every W4 lane is merged, so the W4 conflicts are
    resolved by merge order.
  - N2: method (b) joins on time.
  - N3: Q-S1n moved out of the pins.
  - N4: W9-R1i waits on one depth read.
  - N5: pin state is never stored.

r1 (answering the review at `abe065dd80`) set:
- one history rule;
- the gradable-capture methods (a) and (b);
- the S1 FE map;
- a probe file per row;
- the T13 split;
- the pyramiding, `process_orders_on_close` and repainting specifications;
- the magnifier correction.

Scope (WAVE-TASKS on branch `docs/pine-parity-programme`, section W9; owner: in scope):
- **W9.1** Broker emulator, every rule pinned by captures.
- **W9.2** `strategy.*` read-backs.
- **W9.3** Trade markers and the tester report.
- **W9.4** Server-side backtests through W5.

Citations and names:
- Lines are at `origin/master` **`646dca8cbf`** unless marked **train**:
  `origin/integ/pine-train-2026-11-05` @ **`1b8b4616d8`**. The train holds master plus:
  - W2, W3 and E-LOWS;
  - W4-T0 to W4-T4, W4-T7 to W4-T15, W4-T13S and W4-T17;
  - W5-T12 and SCORE. **W5-T11, W5-T14 and W5-T15 are not on the train at `1b8b4616d8`.** They
    land through it.
- `FE` = `app/src/components/chart/engine/ast/pineRuntimeFrontend.js`: 11,115 lines on master,
  12,310 on the train.
- `RT/` = `app/src/components/chart/engine/runtime/`.
- `SCRIPT_ENGINE_VERSION` (`engine/scriptEngineVersion.js`) is 5 on master (`:88`) and 17 on the
  train (`:102`).
- `S1` = commit **`34da5eb926`**. Only `34da5eb926~1..34da5eb926` is ported.
- This doc's tasks are T0 to T15. Other waves' tasks are always prefixed (`W4-T10`, `W5-T14`).
  Capture rows are `Q-S1x` or `W9-xx`.

**The goal is the language, not the sample.** Each task implements a broker rule for every
script that meets it. The 70 scripts only rank the rules.

---

## 0. What the measurements say (read this first)

### 0.1 The population

From `docs/pine/coverage-map.json` (measured 2026-11-02 on master `6272ed7fa3`):

| | count |
|---|---:|
| `strategy()` scripts in the 679-script sample | **70** |
| by population | 25 committed, 23 builtin, 22 reference |
| by Pine version | v6 25, v5 16, v4 20, v2 6, v1 3 |
| transfer fully (production) | **0**: an order-placing strategy never transfers, `coverage_map.py:368-373` |
| attach on the production door (C50) | 14 |
| attach on the runtime-on lane (R1) | 16 |
| W9 production blocks / only-W9-left (upper) / firm | 70 / 40 / 12 |
| programme headline for W9 | +70 upper / +28 firm (`COVERAGE-MAP.md` section 7 phase 7, cumulative after phases 1-6) |

**+40 / +12** counts the scripts for which W9 is the last wave left today. **+70 / +28** counts
the scripts W9 finishes after W1-W8.

### 0.2 Findings that shape the plan

1. **Sizing is the first wall.** 58 of 70 need a sizing rule that no text settles:
   - 19 declare `percent_of_equity`;
   - 20 are v6 with no declared size (S1 read the default as percent 100; unconfirmed);
   - 19 are v1-v4 with no declared `default_qty_value`.

   All 23 built-ins need one: 18 are v6 with no size, 3 declare percent, and
   `rob-booker-adx-breakout` is v1 with no value. Q-S1a settles all three groups.
2. **S1 built a broker, and W9 ports it.**
   - S1 wrote `RT/broker.js` (585 lines), `ast/strategyBroker.js` (199 lines), a spec with 22
     rules and 16 unsettled cases, a queue, a probe and a 247-line rail.
   - No capture was taken.
   - Its opcode collides with `OBJ_CREATE: 97` (`RT/program.js:270`, master and train).
   - Its FE hunk touches 12 sites (T1).
3. **Master today (C50 and R1).**
   - A strategy draws like an indicator.
   - Order calls are skipped through one set, `STRATEGY_ORDER_CALLS` (`pine.js:239-242`). The
     host lane reads it at `:25661-25667` and the runtime lane at `FE:8728-8738`.
   - Values refuse `pine:strategy-call` (`pine.js:893`; `runtimeStrategy.test.js:113-127`).
   - The screener's refusal is a ruling (`strategiesAreRuled.test.js`) and stays (D7).
4. **The 11-03 census miscounts strategies.** On `fix/pine-w0-census-peel` (now in the train as
   W4-T0), 6 order-placing strategies count as transfers, `[strategy]` falls from 70 to 53, and
   `strategy.position_size` falls from 11 to 0. `coverage_map.py:358` keeps a second order set (5
   names against 13). T0 fixes both.
5. **TradingView changed the tester in July 2026:**
   - the strategy report;
   - Bar detalization;
   - leverage;
   - Limit order execution and Order execution delay;
   - `calc_on_every_history_tick`.
   Every capture reads the settings back (5.1).
6. **The screener backtest is an event study.** W9.4 is its own route; it reuses W5's client,
   admission and receipts (3.4).
7. **History (R10) and parity.**
   - Server lanes use a 5,000-bar window. Today that is `scan_evaluator._MAX_BARS`
     (`scan_evaluator.py:227` on the train) and its restatement `MAX_BARS_PER_SYMBOL`
     (`screener_backtest.py:160` on the train). r2 makes both import the neutral constant (3.4).
   - TradingView backtests from its own first loaded bar: 1,800 SPY daily bars from 2019-08-06 in
     `supertrend-strategy-spy-1d-2026-10-02`.
   - **NYSE:RDDT 1D is method (a).** `r1-strategy-draws-rddt-1d-2026-10-02` has
     `history.startsAtBar0: true` with 636 bars from the 2024-03-21 listing to 2026-10-02:
     **about 660 bars today**, below 5,000.
8. **Strategies have been captured before.** 10 fixtures from 2026-10-02/03 carry
   `StrategyScript$USER;...` ids on the rig layout `01f1AcIj` (`tv_capture.js` v2). T3a starts
   from that load path.

---

## 1. Strategy walls ranked

**Measured** 2026-11-05 by a read-only static scan (section 7) of the 70 sources. Engine of
record: master `646dca8cbf`, where all `strategy.*` values and the broker refuse.

The greedy columns add one rule at a time, the one that completes the most only-W9 scripts. Of
the 40 only-W9 scripts, 12 are firm.

| # | wall | touches /70 | greedy complete /70 | only-W9 /40 | firm /12 | pinned by | task |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | sizing: percent of equity (19 declared + 20 by v6 default) | 39 | 19 | 17 | 1 | Q-S1a | T4 |
| 2 | sizing: v1-v4 default quantity | 19 | 31 | 23 | 6 | Q-S1a | T4 |
| 3 | `currency =` (identity only) | 8 | 35 | 25 | 7 | W9-D2 | T4 |
| 4 | v5 defaults: capital 1,000,000 and margin 0 | 5 | 38 | 27 | 7 | Q-S1b | T4 |
| 5 | `strategy.risk.*` | 6 | 40 | 29 | 8 | W9-R1 | T8 |
| 6 | v5 `when =` | 6 | 42 | 31 | 9 | Q-S1p | T1 |
| 7 | `strategy.order` | 3 | 44 | 33 | 9 | W9-X4 | T7 |
| 8 | OCA groups | 3 | 46 | 35 | 9 | W9-X3 | T7 |
| 9 | trailing exits | 4 | 48 | 36 | 9 | W9-X1 | T7 |
| 10 | commission | 17 | 55 | 36 | 9 | W9-K1..K3 | T5 |
| 11 | partial exits | 6 | 60 | 38 | 11 | W9-X2 | T7 |
| 12 | slippage | 3 | 61 | 38 | 11 | W9-K4 | T5 |
| 13 | partial `strategy.close` | 2 | 62 | 38 | 11 | W9-X2 | T7 |
| 14 | values outside S1's set | 4 | 64 | 38 | 11 | W9-V1 | T10 |
| 15 | `calc_on_every_tick = true` | 2 | 64 | 38 | 11 | Q-S1o (live) | T6 |
| 16 | `process_orders_on_close = true` | 2 | | | | W9-P1, W9-P1b | T6 |
| 17 | `calc_on_order_fills = true` | 1 | | | | W9-P2 | T6 |
| 18 | `close_entries_rule`, `margin_*`, `backtest_fill_limits_assumption` | 1 each | | | | W9-D1, W9-J1 | T4, T6 |
| 19 | `close_all(immediately = true)` | 1 | | | | W9-X4 | T7 |
| 20 | pyramiding default (52 of 70 declare none) | 52 | precondition | | | Q-S1b | T1 |
| 21 | repaint-class inputs (17 scripts; 7 reach an order call) | 17 | refused | | | none (rule 11) | T1 |

- **S1's core set** is a precondition for every row: market, limit and stop entries; brackets;
  cancel; pyramiding above 1; the 23 values. It is pinned by Q-S1-core and Q-S1c to Q-S1m.
- **Bar magnifier:** 0 of 70 scripts set it.
- **Census against source:**

  | wall | map | source |
  |---|---:|---:|
  | `position_size` | 11 | 18 |
  | `position_avg_price` | 3 | 16 |
  | `opentrades` | 1 | 6 |

- **Non-broker walls** belong to other waves:

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
   - An unpinned case stops the run at the bar that reaches it: `runtime:strategy-unpinned`,
     naming the rule and the capture row.
   - An unserved option refuses at build: `runtime:strategy-option` / `runtime:strategy-value`.
   - S1's `runtime:strategy-unsettled` stays.
   - A trade list is never shown with a refused trade missing.
2. **Pin before serve.** Every emulator rule is pinned by a MATCHing capture before it serves,
   including the 22 that S1 settled from text (D1).
   - `pinned(ruleId)` is asked at run time against the committed ledger compiled into the bundle.
   - **A stored runtime document never embeds pin state.** Pins enter served output only through
     the code version, which rule 7 ties to `SCRIPT_ENGINE_VERSION`.
   - Tests pass an explicit pin set. A grep rail forbids that argument outside `__tests__`, and
     the rail is mutation-proved.
3. **One authority per value.**
   - Fills, positions and trades come only from `RT/broker.js`, with no Python broker.
   - One record (3.2) feeds the values, the markers, the report and the server.
   - The report's metrics are computed only in `RT/brokerReport.js`.
   - The order set is `STRATEGY_ORDER_CALLS`.
   - The per-version defaults are one table, `ast/strategyBroker.js`.
   - **The history window is `bars_window.HISTORY_WINDOW_BARS`** (3.4). W9 adds no bar constant.
4. **The C18 object door builds exactly what master builds.**
   - Broker mode is never reachable at `opts.objectDoor === true` (`FE:1101-1105`).
   - One case per capability goes into `objectDoorGate.test.js`.
   - 0 unclassified C18 diffs.
5. **The stage-1 script and the W2 allowlist do not move.** `runtimeAllowlistParity.test.js` is
   required (W2 is in the train).
6. **Built dark.**
   - The gate is `VITE_PINE_STRATEGY_BROKER_ENABLED` (S1's `engine/strategyBrokerGate.js`, a
     Dockerfile ARG and `docs/feature_flags.json`), off by default.
   - Builders never flip flags or touch Railway.
   - With the gate off, census, harness and C18 are identical. Rail: the gate-off/gate-on pair in
     `s1StrategyBroker.test.js`.
7. **Engine version: a pin landing is an engine change, and it takes a `SCRIPT_ENGINE_VERSION`
   bump.**
   - Builders never edit `SCRIPT_ENGINE_VERSION`. The coordinator bumps it, once per merge that
     changes translator output, door outcomes **or the pin ledger**.
   - **The pin ledger lands as its own coordinator merge, in merge order, with a bump.** The
     merge carries:
     - the harness verdict commit that justifies the pin;
     - the regenerated `RT/brokerPins.resolved.json`;
     - the bump;
     - a new `brokerPins.lock.json` entry.
   - **Why a bump per pin** (coordinator ruling, r2):
     - `SCRIPT_ENGINE_VERSION` stays the one authority over "the engine changed".
     - W5's five-field identity (`script_engine`, `runtime_language`, `runtime_frontend`,
       `runtime_ir`, `bundle_sha256`; SERVER-RUNTIME-DESIGN 2.3 on W5) is unchanged, and so are
       its codec, codec-parity fixture and HP-6.
     - HP-1's `expected-digests.json` is regenerated only on a bump, as W5 designed.
     - `bundle_sha256` already moves with the inlined ledger, so the server cache is never stale.
       The bump makes that change visible to every consumer that keys on the version, the browser
       included.
     - The cost: each pin landing re-translates saved scripts once (W5-T17's
       `_awaits_retranslation`, keyed on `SCRIPT_ENGINE_VERSION`, fires; that is correct). The
       train already bumps per merge (now 17). Pins land in batches, one bump per capture
       session's batch, never one per fixture.
   - **Rail** (T2, `RT/__tests__/brokerPinsLock.test.js`):
     - `brokerPins.lock.json` is append-only, `{ "<SCRIPT_ENGINE_VERSION>": "<sha256 of the
       canonical resolved ledger>" }`.
     - The rail computes the sha256 of the committed `brokerPins.resolved.json`.
     - It takes the entry at the **greatest version ≤ `SCRIPT_ENGINE_VERSION`** and asserts
       that entry's sha equals the computed one.
     - **Case 1, a ledger change without a bump: red.** The governing entry (the current version's
       own, or an older one) holds the old sha.
     - **Case 2, a non-pin bump (a W4, W5 or other lane's bump) with no lock edit: green.** The
       governing entry is the last pin landing's, and its sha still equals the unchanged ledger.
       No other lane ever touches W9's lock.
     - **Case 3, a pin landing with a bump and a new entry: green.**
     - **Case 4, an edit to an older entry, or a removed entry: red.** Append-only; the rail keeps
       a committed digest of all older entries.
     - **Case 5, a new entry under a version that is not greater than every existing key: red.**
     - Mutations:
       - change one pin and leave the version and the lock: red (case 1);
       - make the lookup exact-version instead of ≤: case 2 goes red;
       - drop the sha comparison: case 1 goes green, so the rail is red.
   - **Freshness rail:** `brokerPins.resolved.json` is committed, never generated inside the
     Docker build. Resolving it again from the committed verdict files must reproduce it byte for
     byte, so the web and service builds can never resolve different pin sets from one commit.
   - `RUNTIME_FRONTEND_VERSION` is bumped only if a served shape changes meaning.
8. **Ship loop** (WAVE-TASKS section 1):
   - red before, green after;
   - mutation-proved guards;
   - independent Opus review GO;
   - measure-pair with every diff classified;
   - deploy-gate pytest and hygiene.
9. **No heavy job outside the lock.** Targeted vitest only, `--maxWorkers=2`.
10. **No builder runs the rig.** Values come from the chart model only: no pixels, no CSV, no
    `exportData()`.
11. **Repaint-class inputs refuse broker mode by name** (`runtime:strategy-repaint`) until their
    wave rules. The rule covers:
    - `request.security` / `security` with `lookahead_on` or an unconfirmed higher-timeframe
      value;
    - `timenow`;
    - `barstate.isrealtime`, `islast`, `islastconfirmedhistory` and `isconfirmed` reaching an
      order;
    - `varip`.
    Plots still draw.

---

## 3. Architecture

### 3.1 Where the broker runs

- **Runtime lane only.** The host lane keeps C50.
- **Per bar** (S1's order):
  1. pending orders fill along the intrabar path;
  2. the script runs on the close;
  3. new orders queue.

  `process_orders_on_close` and `calc_on_order_fills` add steps (T6).
- **History only.**
- **The broker checks its own window.**
  - The run context carries `historyWindowBars` (3.4).
  - Bars that are not that window (more bars, or a gap) refuse `runtime:strategy-start`.
  - The record carries `startTime` and `fromListing`.
  - The same check runs on the chart, on the server and in tests.
  - `memberPaneDefinition.js:1699` stays as it is for non-broker documents.

### 3.2 The run's `strategy` record (one source for W9.2, W9.3 and W9.4)

```jsonc
{
  "window":   { "startTime": 1711027800, "fromListing": true, "bars": 660, "historyWindowBars": 5000,
                "asOfBar": 1793280600 },          // newest CONFIRMED bar the record reflects
  "settings": { "version": 5, "initial_capital": 100000, "default_qty": {"type": "fixed", "value": 3},
                "pyramiding": 2, "commission": {"type": "percent", "value": 0}, "slippage": 0,
                "process_orders_on_close": false, "bar_detalization": "off", "currency": "USD" },
  "orders":   [ { "id": "L", "kind": "entry", "dir": "long", "qty": 3, "placedTime": 1714656600, "type": "market",
                  "status": "filled", "fillTime": 1714743000, "fillPrice": 12.34, "rule": "B-MARKET", "comment": null } ],
  "trades":   [ { "n": 1, "entryId": "L", "dir": "long", "qty": 3, "entryTime": 1714743000, "entryPrice": 12.34,
                  "exitId": "XL", "exitTime": 1717162200, "exitPrice": 14.19, "profit": 5.55, "commission": 0,
                  "runUp": null, "drawdown": null } ],
  "equity":   "<column, one value per bar>",
  "refusals": [ { "rule": "B-PATH", "guard": "runtime:strategy-unpinned", "time": 1718112600, "sentence": "..." } ]
}
```

- Fills and trades are keyed by **bar time**, not bar index, so a comparison never depends on
  where either side's window starts (review N2).
- `asOfBar` is shown on the markers and in the report.
- `rule` names the decision behind each fill.

### 3.3 The member surfaces (W9.3)

- **Markers:** pinned by W9-MK1.
- **Report:** three tabs plus the `asOfBar` stamp.
- An unpinned metric shows its sentence.
- A run-wide refusal shows the plots and a report that holds only the refusal.

### 3.4 History, and W9.4 composed with W5

- **One constant, in a neutral module.** New `api/services/bars_window.py`:

  ```python
  HISTORY_WINDOW_BARS = 5000   # R10: the server lanes' bars window
  ```

  All of these import it:
  - `scan_evaluator._MAX_BARS = HISTORY_WINDOW_BARS` (the sweep; `scan_evaluator.py:227`, already
    on master and the train). The comment at `:223`, "matching `snapshot_builder._read_daily_bars`",
    becomes true by construction.
  - `screener_backtest.MAX_BARS_PER_SYMBOL = HISTORY_WINDOW_BARS` (`:160`, on master and the
    train). This retires the restatement that `:156-159` explains.
  - **Not `snapshot_builder.DEEP_BARS`** (ruling R13, superseding this section's first draft,
    which folded it in). `DEEP_BARS` (`snapshot_builder.py:669`) is the all-time-high lookback
    behind `dist_ath_pct` / `new_ath`, a different quantity that happens to share the value 5,000.
    Binding it to the window would let a window change (D9) silently redefine "all-time high" on
    every member's screen. It keeps its own named literal; its comment no longer claims to match
    the bars API ceiling (W9-T2), and `bars_window.py`'s docstring names it as NOT this quantity.
  - the T14 route.

  The move is task **T14a**, owned with W5's owner and done before T14.

- **Why not import `scan_evaluator`:** `tests/test_scan_evaluator_off_request_path.py` (E-3, on
  master) is default-deny.
  - Binding the module object trips, even unused.
  - Naming any name outside `_OFF_SWEEP_READS` trips, and `_MAX_BARS` is private.
  - No allowed path to the constant exists, and widening `_OFF_SWEEP_READS` is what that rail
    exists to stop.
- **Rails:**
  - **E-3, unchanged.** T14's router imports `api.services.bars_window` only. It binds no
    `scan_evaluator` module object and names no `scan_evaluator` function, so E-3's census over
    the new route stays green. E-3 asserts the number of handlers it walked, so the new route is
    walked, not skipped. T14's PR quotes that E-3 run.
  - **One authority** (new, T14a: `tests/test_history_window_one_authority.py`). It parses by AST:
    - `scan_evaluator._MAX_BARS`, `screener_backtest.MAX_BARS_PER_SYMBOL` and the T14 route's
      window are each bound to the name `HISTORY_WINDOW_BARS`, imported from
      `api.services.bars_window`;
    - no other assignment of an integer literal `5000` / `5_000` appears in those three modules;
    - `snapshot_builder.DEEP_BARS` stays its own integer literal (R13; rail
      `test_DEEP_BARS_is_a_different_quantity_and_keeps_its_own_literal`);
    - `bars_window.py` holds exactly one assignment.

    Mutations:
    - restore `_MAX_BARS = 5000`: red;
    - give the route a literal: red;
    - bind `DEEP_BARS = HISTORY_WINDOW_BARS`: red (R13);
    - add a second assignment in `bars_window.py`: red.
- **The rule.** Every broker run uses the last `HISTORY_WINDOW_BARS` bars.
  - `fromListing` is true only when the window reaches the listing.
  - A run that does not reach the listing is served with its start stated, and graded only by
    methods (a) and (b).
  - A longer window is a change to the one constant (D9).
- **The chart.**
  - A broker run takes the most recent `historyWindowBars` of the bars the chart has loaded, so
    scroll-back never changes the trades.
  - The value arrives in the run context (T11) from the server, which reads `bars_window`.
  - The chart's `/api/bars?bars=5000` request literal is a pre-existing third copy owned by the
    chart lane, named as a follow-up (section 9). W9 reads only the context.
- **Other 5,000 literals** in the API (alert lanes, render panels, `user_definitions`) belong to
  other lanes. They are out of R10's scope here and are listed for the coordinator, not touched.
- **W9.4 shape:**
  - `want: "#strategy"` on the W5 service returns the record under profile `backtest`.
  - New route `POST /api/pine/strategy-backtest` (D5). It reuses, by import:
    - W5-T11's client and codec;
    - W5-T12's admission;
    - W5-T15's status mapping and receipt.
  - A screen reading a `strategy.*` value under W5-T15's 500-bar lead refuses
    `runtime:strategy-start` (T14).

---

## 4. Tasks

Sizes: S ≤ 1 day, M 2-3 days, L about a week. Models:
- Sonnet builds from a spec;
- Opus builds semantics and does every review;
- Fable only after Opus fails twice;
- Haiku does chores.

**Capture-gated** means the task merges dark and its rules refuse until pinned.

### T0 Census honesty for strategies | S | Sonnet | no capture

- **Owns:**
  - `coverage_map.py`: `:358`, `:368-373`, `:670-690`;
  - `w0/targets.py`: `:56`, `:189`;
  - a new test.
- **Delivers:**
  - order-placing detection from the source;
  - the order set derived from `STRATEGY_ORDER_CALLS`;
  - a `strategyOn` block;
  - the `runtime:strategy-*` guards mapped to W9.
- **Rails:**
  - the 6 strategies of finding 4 never come out `clean`;
  - set parity.
- **Mutations:**
  - inventory-based detection returns;
  - drop `cancel` from the set.
- **Depends:** none; base on the train (W4-T0 is merged there).

### T1 Port S1's broker core, gated and dark | M | Opus | no capture to build

Port `34da5eb926~1..34da5eb926` onto **train `1b8b4616d8`**, or whatever tip the coordinator
names at launch; re-check the anchors then.

- **New files:**
  - `RT/broker.js`;
  - `ast/strategyBroker.js`;
  - `engine/strategyBrokerGate.js`;
  - `s1StrategyBroker.test.js`;
  - the spec, with a "pinned by" column;
  - the S1 queue, which T3b turns into probe files;
  - `s1-broker-core.pine`.
- **Dropped:** `s1BrokerCensus.measure.test.js`.
- **RT edits:**
  - `RT/program.js`: a new opcode after `OBJ_DELETE: 99`; `brokerOps` / `broker` in
    `makeProgram`; `BROKER` added to `IMPLEMENTED`;
  - `RT/ir.js` (+19);
  - `RT/lowerIr.js` (+31);
  - `RT/vm.js` (+48);
  - the Dockerfile ARG and `feature_flags.json`.
- **FE: the 12 sites.** Every W4 lane that touched these bands is now merged into the train, so
  the anchors below already include them.

  | # | site | wave-18 | master | train `1b8b4616d8` |
  |---:|---|---:|---:|---:|
  | F1 | imports: `brokerCall` plus three new imports | 51-62 | 53-59 | 55 |
  | F2 | `RUNTIME_REFUSALS`: `-option`, `-value` (+ `-unpinned`, `-start`, `-repaint`) | 291 | 316 | 318 |
  | F3 | `buildRuntimeIr` retry on `pine:strategy-call` | 1075 | 1074 | 1111 |
  | F4 | `buildRuntimeIrLinked` head: `brokerMode`, `brokerDecl` | 1125 | 1203 | 1240 |
  | F5 | `holdsBrokerRead` / `brokerRefusal`, before `holdsObjectCall` | 2198 | 2739 | 3026 |
  | F6 | column-planner exclusion beside `holdsPineTwin` | 4993 | 5307 | 5920 |
  | F7 | value-name lowering (`ORDER_ENUM` neighbourhood) | 5090 | 5425 | 6040 |
  | F8 | trade-function lowering at the head of `case 'call'` | 5504 | 5829 | 6467 |
  | F9 | declaration read and order lowering at R1's skip | 7651 | 8735 | 9817 |
  | F10 | `orderOnlyChain` bypass | 8082 | — | — (no counterpart: T1 finds how the current walker skips an `if` whose arms are only orders, lowers it in broker mode, and rails it) |
  | F11 | `#symbol` prelude after `lowerStmts(stmts, root, true)` | 9562 | 10691 | 11886 |
  | F12 | program options `broker` | 9914 | 11025 | 12220 |

- **Delivers:**
  - S1's emulator, gate off;
  - the 23 values (F7, F8);
  - B-SIG and v4 `when`;
  - rule 11;
  - the window check;
  - the record skeleton, keyed by bar time.
- **Rails:**
  - S1's suite with a test pin set;
  - gate-off parity;
  - a broker case in `objectDoorGate.test.js`;
  - the existing opcode rail `runtimeHardeningP1.test.js:153-158`, mutation-proved with the
    opcode set to 97;
  - rule 11, per construct;
  - the window refusal;
  - F10's `if`.
- **Mutations:**
  - drop the gate;
  - drop the forming-bar skip;
  - drop `pinned()`;
  - drop rule 11.
- **Engine bump:** none (dark).
- **Depends:** the train tip.

### T2 Pin ledger, lock and strategy grader | M | Sonnet | no capture to build

- **Owns:**
  - `RT/brokerPins.json` (hand-edited: rule → fixture ids);
  - `RT/brokerPins.resolved.json` (committed, generated by the resolve step);
  - `RT/brokerPins.lock.json`;
  - `RT/brokerPins.js` (`pinned`);
  - `RT/__tests__/brokerPinsLock.test.js`;
  - the resolve step in `tools/vendor_harness/evidence_engine.py`;
  - the strategy grade in `tools/vendor_harness/compare.mjs`.
- **Does not own:** the engine identity, W5's codec or HP-6. None of them changes.
- **The resolve step.** A rule is kept with its fixtures only when every committed verdict for
  those fixtures is MATCH. The output is canonical JSON. A freshness rail reproduces it from the
  verdict files.
- **The lock** (rule 7). The coordinator appends one entry per bump that changes the ledger.
- **The strategy grade**, applied in order:
  0. **The reference floor, decided from the capture alone, before our output is read.**
     - TradingView's captured closed-trade count in the graded span is read from the fixture.
     - **Below 5: UNGRADABLE on that symbol** ("the reference has too few trades"). The grader
       stops there, and **our run is never consulted**: our count is not read, compared or
       logged by this step.
     - The routing in 5.2 E (RDDT → SPY variant → named ungradable) uses this verdict only.
     - **Our broker's count never selects a symbol and never makes a script ungradable.**
  1. **Expected refusals.**
     - Our run refused by rule 11, or by another wave's wall, is **EXPECTED-REFUSAL**. It is
       tallied apart from the W9 DIVERGE count.
     - Any other refusal by our run against a TradingView value is DIVERGE.
  2. **Bar identity.** OHLCV must be identical to the tick over the graded span. For method (a)
     that is the whole window; for method (b) it is `[X − warm-up, Y)`. The data settings must
     match (5.1). Otherwise the grade is INCONCLUSIVE "bars differ".
  3. **Signal identity**, method (b) only. The script's own plots must be identical inside
     `[X, Y)`. Otherwise the grade is INCONCLUSIVE "the warm-up has not converged". This catches
     recursive kernels (EMA, RMA) whose seeds differ between the two windows.
  4. **Trades and values**, with the reference at or above the floor.
     - **Trade counts differ: DIVERGE.** For example, the reference closes 6 and we close 2, or
       the reference closes 6 and we close 9. The verdict names the first unmatched fill by time
       and its `rule`.
     - With equal counts, trades and values are compared **joined on bar time, never bar index**
       (on method (b) the indexes differ by a constant). Prices are compared to the tick,
       quantities exactly, currency to 1e-9 relative.
     - All equal: **MATCH**. Any difference: DIVERGE, naming its fill's `rule`.
- **Rails:**
  - a missing fixture fails;
  - a DIVERGE or INCONCLUSIVE fixture does not pin;
  - **reference 6, ours 2: DIVERGE.** This is the coordinator's 6-against-2 rail, with the
    reference at or above the floor;
  - **reference 2, ours 6: UNGRADABLE on that symbol**, and our count is never read. A spy on our
    record's trade accessor asserts it was not called;
  - reference 0, ours 0: UNGRADABLE;
  - reference 4, ours 4: UNGRADABLE;
  - reference 5, ours 5, all equal: MATCH;
  - an EXPECTED-REFUSAL never enters the DIVERGE tally;
  - bars differ gives INCONCLUSIVE;
  - a method (b) fixture offset by 1,000 bars still joins and matches;
  - the lock;
  - freshness.
- **Mutations:**
  - INCONCLUSIVE counted as MATCH;
  - remove the reference floor: the 0/0 fixture MATCHes, red;
  - apply the floor to our count (per side, or to either side): the reference-6/ours-2 fixture
    turns UNGRADABLE, red;
  - read our count in step 0: the accessor spy fires, red;
  - join on index: the offset fixture fails, red;
  - skip bar identity;
  - change the ledger without a bump: the lock is red.
- **Depends:** T1 (rule ids).

### T3a Capture tooling | M | Sonnet | report reader gated on W9-C0

- **Delivers:**
  - start from the existing `StrategyScript$USER;` load path (finding 8);
  - the settings read-back into `provenance.strategySettings`: every Properties input including
    the July-2026 menus, plus dividend adjustment, back-adjustment, session (RTH/ETH) and time
    zone;
  - `provenance.gradeRange` for method (b);
  - the report reader after W9-C0.
- **Rails:**
  - a strategy capture with no settings fails;
  - existing captures verify byte-identically.

### T3b Probe files and grading variants | M | Sonnet | no capture

- **Owns:**
  - every probe in 5.2;
  - the queue doc `docs/pine/capture-queue-2026-11-XX-w9.md`;
  - `tools/vendor_harness/range_guard.py`.
- **Delivers:**
  - Probes: the standard set plus the row's fields. Method (b) probes guard every order call
    with `time >= X and time < Y` and use finite-window signals.
  - **`range_guard.py`:** a deterministic rewrite that adds ` and time >= X and time < Y` to the
    condition of every order call, and wraps an unconditional order call in `if`.
    - It writes the SPY-probe grading variants (5.2 E).
    - The committed corpus variants are files `w9-g-<slug>-spy.pine`.
    - Builtin and reference variants are generated locally from the licence-held cache at
      capture time (local evidence, `LICENSING.md`). Only the generator and the source sha
      recorded in the fixture are committed.
- **Rails:**
  - every W9 queue row resolves to a source (no NEEDS_PROBE);
  - every method (b) probe and variant has the guard on every order call;
  - `range_guard.py` is idempotent;
  - a variant built from a source with no order calls is refused.

### T4 Sizing, capital, defaults, currency | M | Opus | gated: Q-S1a, Q-S1b, W9-D1, W9-D2

- Delivers percent and cash sizing (the sizing price and rounding), the version defaults, v5
  capital and margin, identity currency, and margin at the witnessed values.
- Margin calls are deferred.
- **Depends:** T1, T2.

### T5 Costs | S | Sonnet | gated: W9-K1..K4

- Delivers the three commission types, slippage, and both at the close under
  `process_orders_on_close` (W9-P1).
- **Depends:** T1, T2.

### T6 Fill timing | M | Opus | gated: W9-P1, W9-P1b, W9-P2, W9-P3, W9-J1

`process_orders_on_close`, each item pinned:
- a market order or close placed on bar t fills at t's close;
- a bracket placed on the POC bar is live from that close or from the next open;
- `position_size` reflects the fill from the next bar;
- costs are taken at the close;
- POC with pyramiding;
- POC with `calc_on_order_fills`.

Also:
- `calc_on_order_fills` on history;
- `calc_on_every_tick` on history;
- the July-2026 settings at their defaults;
- `backtest_fill_limits_assumption`.

**Depends:** T1, T2.

### T7 Exit family and other order kinds | M | Opus | gated: W9-X1..X4, Q-S1d, f, g, h, j, k

- Delivers:
  - trailing exits;
  - partial and multi-level exits;
  - partial close;
  - OCA;
  - `strategy.order`, which ignores pyramiding;
  - `immediately`;
  - stop-limit;
  - the v5/v6 exit rule.
- **Depends:** T1, T2.

### T8 `strategy.risk.*` | S | Sonnet | gated: W9-R1, W9-R1i

- The intraday half (`max_intraday_loss`, `max_intraday_filled_orders`) waits on W9-R1i, which
  waits on one depth read (5.1).
- **Depends:** T1, T2, T4.

### T9 Bar detalization | M | Opus | gated: W9-M1; data (W7.3); deferred (D3)

- 0 sample scripts use it.
- It refuses by name without the lower-timeframe bars, and never falls back.

### T10 The tail of the read-backs | S | Sonnet | gated per value; W9-V1

The values outside S1's set, text values through a label, and the `pinned()` asks. It owns
`BROKER_OPS` and F7/F8's value lists.

### T11 The record through the run | S | Sonnet | no capture

- **Owns:**
  - `RT/runtimeColumns.js`, `RT/runtimeWorker.js`;
  - `RT/limits.js` (one budget);
  - the runtime path of `memberPaneDefinition.js`, including `ctx.historyWindowBars`.
- **Rails:**
  - schema;
  - the worker boundary;
  - gate off;
  - the window comes from the context, never a literal.
- **Depends:** T1.
- **Conflicts:** W5-T1, W5-T19 (`runtimeColumns.js`).

### T12 Trade markers | M | Sonnet | gated: W9-MK1

Markers from the record, with the `asOfBar` stamp. **Depends:** T11, W2 stage 1.

### T13a Report metrics | M | Opus | gated per metric: W9-S1, W9-S2

`RT/brokerReport.js`: pure metrics from the record, with one discriminating fixture per metric.
**Depends:** T11.

### T13b Report panel | M | Sonnet | no capture of its own

The three tabs, the refusal sentences and the stamp. **Depends:** T13a.

### T14a One history-window constant | S | Sonnet | no capture (with W5's owner)

- **Owns:**
  - new `api/services/bars_window.py`;
  - the `_MAX_BARS` line in `scan_evaluator.py` (`:227`, train);
  - `screener_backtest.py`: `:156-160`, the `MAX_BARS_PER_SYMBOL` restatement and its comment;
  - the comment on `snapshot_builder.py` `DEEP_BARS` only (its value and literal stay, R13);
  - the comment at `scan_evaluator.py:223`;
  - new `tests/test_history_window_one_authority.py`.
- **Delivers:** 3.4's constant and rails. Behaviour is identical: the value is still 5,000.
- **Rails:**
  - one authority (3.4);
  - E-3 unchanged and green;
  - the existing scan and backtest suites.
- **Engine bump:** none; no translator or door output changes.
- **Base:** the train tip (`origin/integ/pine-train-2026-11-05`). The three constants it binds
  (`scan_evaluator.py:227`, `screener_backtest.py:160`, `snapshot_builder.py:667`) are already
  on master and on the train.
- **Order:**
  - W5-T11, W5-T14 and W5-T15 are not on the train at `1b8b4616d8`. They land through it.
  - W5-T14 edits `scan_evaluator.py`, and W5-T15 edits the `screener_backtest.py:156-163`
    comment.
  - **Merge T14a into the train first, and let those W5 lanes rebase onto it.** If one of them
    lands first, fold T14a into the next train merge rather than waiting.
- **Depends:** none.

### T14 Server-side strategy backtests | M | Opus | no capture of its own

- **Owns:**
  - the W5 service's `#strategy` handling;
  - the record codec in `pine_runtime_codec.py`;
  - new `api/routers/pine_strategy_backtest.py`;
  - the refusal on W5-T15's descriptor path.
- **Delivers:** 3.4. The window is `bars_window.HISTORY_WINDOW_BARS`, imported.
- **Rails:**
  - host parity of the record;
  - **E-3 (`test_scan_evaluator_off_request_path.py`) green with the new route walked**, with
    the walked-handler count quoted;
  - the one-authority rail covers the route;
  - a non-listing window is served with its start;
  - auth.
- **Depends:** T11, T14a, W5-T11, W5-T14, the W5 service deploy, and D5.

### T15 Docs and the ruling's wording | S | Haiku | no capture

Wording in `strategiesAreRuled.test.js` (after D7) and the spec's "pinned by" column.

### Deferred

- realtime;
- `calc_on_every_history_tick`;
- margin calls;
- synthetic chart types;
- deep backtesting;
- W7 `request.*`;
- W8 libraries.

---

## 5. The capture plan

### 5.1 Standing settings

- **Chart model only.**
  - Plots come through `tv_capture.js`.
  - The report comes through T3a after W9-C0.
  - Text comes from labels via `graphics()`.
  - No CSV.
- **The standard plotted set (every probe):**
  - `time` and `bar_index` (control);
  - `position_size`, `position_avg_price`, `opentrades`, `closedtrades`, `netprofit`, `equity`,
    `openprofit`;
  - for the last three closed trades: entry and exit **time** (`entry_time`, `exit_time`),
    entry and exit bar index, entry and exit price, size, profit and commission;
  - a label per close with the ids and comments.
  This rebuilds the trades without the report reader. W9.1 and W9.2 do not wait on W9-C0.
- **Settings:** set in the source only. The Properties tab and the chart data settings are read
  back. A disagreement is INCONCLUSIVE.
- **Method (a):** **`NYSE:RDDT 1D`**, about 660 bars from the 2024-03-21 listing. Both sides
  start at the listing. Each capture asserts `startsAtBar0` and `firstBarTime == listing`.
- **Method (b):** every order call is gated on `time >= X and time < Y`.
  - `gradeRange` is recorded.
  - The capture asserts TradingView's `firstBarTime ≤ X − warm-up`, and our window holds the
    same.
  - Grading joins on time, checks bar identity over `[X − warm-up, Y)` and checks signal
    identity inside `[X, Y)` (T2).
  - **`AMEX:SPY 1D`:** TradingView's 1,800 bars start on 2019-08-06.
    - Probes use X = 2023-01-03, Y = 2025-01-02.
    - Grading variants use **X = TradingView's first bar + 5 × the script's longest lookback**
      and Y = the last closed bar before the capture.
      - For a 200-bar lookback, X is about 2023-08, giving about 820 graded bars.
      - For `footprint-strategy`'s 300, X is about 2025-08, giving about 320 graded bars.
      The 5x warm-up (review N4) gives EMA/RMA-type seeds room to converge to the tick. T2 step 3
      checks that rather than assuming it.
    - A variant whose signals still differ inside `[X, Y)` is **UNGRADABLE by name** ("warm-up does
      not converge"). `trend-following-parabolic-buy-sell-strategy-tradedots` (SAR, which depends
      on its path from bar 0) is expected to land there.
  - **`AMEX:SPY 15`** (W9-R1i only): X and Y within the last 20 sessions. **Schedulable only
    after one depth read** of TradingView's 15-minute history on the rig plan and of ours,
    session recorded. 5,000 ETH 15-minute bars cover far fewer than 192 RTH sessions.
- **Market closed**, except the live rows. The account plan is recorded (D4).

### 5.2 The rows

All probes are under `tools/visual_conformance/probes/`. T3b writes every one marked (new).
"Std" is the standard set.

**A. Spike (owner, rig, read-only)**

| row | what | chart | unblocks |
|---|---|---|---|
| W9-C0 | A depth-2 key walk of the strategy data source (`__uctVH._strategyKeys()`, names and types only) | `NYSE:RDDT 1D` | T3a reader → W9-S1, W9-S2, block E's report fields |

**B. Rule pins: S1's rows**

| row | probe | chart | captures | fields beyond std | settles | gates |
|---|---|---|---:|---|---|---|
| Q-S1-core | `s1-broker-core.pine` (extended) | (a) RDDT 1D | 1 | N02..N14 | B-FILL, B-MARKET, B-PATH, B-GAP, B-PYR, B-REVERSE, B-MODIFY, B-CLOSE, B-EXIT-*, B-FIFO, B-VAL; W9-J1 settings | T1 |
| Q-S1-core-b | `s1-broker-core-range.pine` (new) | (b) SPY 1D | 1 | std, joined on time | the same rules; proves method (b) | T1 |
| Q-S1a | `w9-q-s1a-size-v4.pine`, `-v6`, `-v5pct`, `-v5cash`, `-v2` (new) | (a) | 5 | `opentrades.size(0)`, `position_size` at the fill; `equity` and `close` at the signal | sizing | T4 |
| Q-S1b | `w9-q-s1b-defaults-v4.pine`, `-v5`, `-v6` (new): two same-direction entries, then an opposite entry | (a) | 3 | `initial_capital`, `equity`; `opentrades` per entry; `position_size` after the reversal | capital and margin defaults; default pyramiding per version; reversal | T4, T1 |
| Q-S1c | `w9-q-s1c-tie.pine` (new; moves to (b) SPY if RDDT has no tie bar) | (a) | 1 | trade-0 times | the path on a tie | T1 |
| Q-S1d | `w9-q-s1d-same-tick.pine` (new) | (a) | 1 | ids by label | same-tick order | T1, T7 |
| Q-S1e | `w9-q-s1e-live-past.pine` (new) | (a) | 1 | std | an exit live past its level | T1 |
| Q-S1f | `w9-q-s1f-reversal-exit.pine` (new) | (a) | 1 | exit id by label | reversal against an exit with no `from_entry` | T7 |
| Q-S1g | `w9-q-s1g-pyr-limit.pine` (new) | (a) | 1 | `opentrades` | a price entry at the limit | T7 |
| Q-S1h | `w9-q-s1h-fifo.pine` (new) | (a) | 1 | `closedtrades.size(i)`; `entry_id(i)` by label | the FIFO split | T7 |
| Q-S1i | `w9-q-s1i-funds.pine` (new) | (a) | 1 | exit comment by label | margin call | deferred |
| Q-S1j | `w9-q-s1j-stop-limit.pine` (new) | (a) | 1 | std | stop-limit | T7 |
| Q-S1k | `w9-q-s1k-exit-levels.pine`, `-v6` (new) | (a) | 2 | std | exit levels v5/v6 | T7 |
| Q-S1l | `w9-q-s1l-off-grid.pine` (new) | (a) | 1 | `exit_price` as a full double, and `/ syminfo.mintick` | off-grid rounding | T1 |
| Q-S1m | `w9-q-s1m-index.pine` (new) | (a) | 1 | `opentrades.entry_price(5)` | out-of-range index | T10 |
| Q-S1p | `w9-q-s1p-when.pine` (new) | (a) | 1 | std | v5 `when` | T1 |

**B'. Fact capture (not a pin; review N3)**

| row | probe | chart | captures | settles |
|---|---|---|---:|---|
| Q-S1n | `s1-broker-core.pine` at two loaded depths | `AMEX:SPY 1D` | 2 | whether TradingView starts at its first loaded bar (B-START). It records why only methods (a) and (b) are gradable, and feeds D2's member sentence. It pins no rule and is never graded MATCH. |

**C. Rule pins: new W9 rows** (all probes new; method (a) RDDT 1D unless named)

| row | probe | captures | fields beyond std | settles | gates |
|---|---|---:|---|---|---|
| W9-D1 | `w9-d1-v6-defaults.pine`, `w9-d1-margin50.pine` | 2 | settings; `margin_liquidation_price` | v6 margin and leverage | T4 |
| W9-D2 | `w9-d2-currency.pine` | 1 | std | identity currency | T4 |
| W9-K1 | `w9-k1-commission-pct.pine` | 1 | `closedtrades.commission(i)` | percent | T5 |
| W9-K2 | `w9-k2-commission-contract.pine` | 1 | same | per contract | T5 |
| W9-K3 | `w9-k3-commission-order.pine` | 1 | same | per order | T5 |
| W9-K4 | `w9-k4-slippage.pine` | 1 | prices | slippage | T5 |
| W9-P1 | `w9-p1-on-close.pine`: POC; bracket on the entry bar; pyramided add; close; commission and slippage | 1 | `position_size` on the fill bar and the next bar; commission | POC timing, brackets, pyramiding, costs | T6, T5 |
| W9-P1b | `w9-p1b-on-close-fills.pine`: POC + `calc_on_order_fills` | 1 | run counter | re-run order | T6 |
| W9-P2 | `w9-p2-order-fills.pine` | 1 | run counter | `calc_on_order_fills` | T6 |
| W9-P3 | `w9-p3-every-tick-history.pine` | 1 | std | `calc_on_every_tick` on history | T6 |
| W9-J1 | rides on Q-S1-core | 0 | July-2026 defaults | defaults | T6 |
| W9-X1 | `w9-x1-trail.pine` | 1 | std | trailing | T7 |
| W9-X2 | `w9-x2-partial.pine` | 1 | `closedtrades.size(i)` | partials | T7 |
| W9-X3 | `w9-x3-oca.pine` | 1 | ids by label | OCA | T7 |
| W9-X4 | `w9-x4-order.pine` | 1 | `opentrades` | `strategy.order`, immediately | T7 |
| W9-R1 | `w9-r1-risk-allow.pine`, `w9-r1-risk-ddown.pine` | 2 | std | `allow_entry_in`, `max_drawdown` | T8 |
| W9-R1i | `w9-r1-risk-intraday.pine`, (b) `AMEX:SPY 15` | 1 | std | the intraday risk functions | T8 (after the depth read) |
| W9-M1 | `w9-m1-magnifier-off.pine`, `-on.pine` | 2 | settings | detalization | T9 (deferred) |
| W9-V1 | `w9-v1-values.pine` | 1 | the values outside S1's set; `position_entry_name` by label | T10's tail | T10 |
| W9-MK1 | `w9-mk1-markers.pine` | 1 | the strategy source's `graphics()`, `properties().state()` | marker presentation | T12 |
| W9-S1 | Q-S1-core, report reader | 1 | the report object | summary formulas | T13a |
| W9-S2 | `w9-s2-sharpe.pine` at `risk_free_rate` default and 0 | 2 | the report object | Sharpe and Sortino | T13a |

**D. Live (deferred)**

| row | probe | chart | captures |
|---|---|---|---:|
| Q-S1o | `w9-q-s1o-every-tick.pine` (new) | `AMEX:SPY 5` | 1 |
| Q-S1p-live | `s1-broker-core.pine` | `AMEX:SPY 5` | 1 |

**E. Grading the 70 (unmodified sources on RDDT; `range_guard.py` variants on SPY)**

**The floor is 5 closed trades in TradingView's capture (the reference) within the graded span.**
It is decided from the capture before our output is read (T2 step 0). Five is the smallest count
at which the grade exercises what a broker gets wrong, rather than agreeing by coincidence:
- **0 trades** matches trivially, and is the review's vacuous MATCH.
- **1 trade** cannot test equity compounding. Percent-of-equity sizing, the sizing rule of 39
  scripts, depends on prior closed profit only from the second trade on.
- **5 closed trades** give at least 10 fills (prices, quantities, fill bars), 4 compounding
  sizing steps, and a cumulative-profit column with 5 independent increments. A wrong
  fill-timing, sizing, cost or FIFO rule changes at least one of these. That is a coverage
  argument, not a statistical one.
- A higher floor (10) would push about a third more scripts to the SPY variant and buy no rule
  coverage that 5 lacks.

**The floor is never applied to our count.**
- Reference at or above 5, with any difference from us, including a different trade count:
  **DIVERGE**.
- Reference at or above 5, all equal: **MATCH**.
- Reference below 5: **UNGRADABLE on that symbol**, whatever we did. The script routes to its
  SPY variant, or is named.
- Our broker under-trading or over-trading can therefore never hide a script from grading.

**Classification** (static estimate, 2026-11-05: scan of the 70 sources, section 7):

| class | count | how it is graded | of which also wait on another wave's wall |
|---|---:|---|---:|
| **MATCH-eligible on RDDT 1D**, method (a), unmodified | **49** | as is; about 660 bars | 15 |
| **SPY-probe (expected)**: longest lookback ≥ 150 bars, or long-only with lookback ≥ 100, so TradingView likely closes fewer than 5 trades in the about 460 bars left on RDDT after warm-up | **11** | captured on RDDT first, like every script. Only if **TradingView's** RDDT count is below 5 does it get a `range_guard.py` variant on `AMEX:SPY 1D` (5x-lookback warm-up) | 7 |
| **UNGRADABLE by name** | **10** | never graded; tallied as EXPECTED-REFUSAL or zero-trade | 8 |

The **10 ungradable, by name:**
- **zero trades by their own default date filters**, on any window we hold:
  - `atr-god-strategy-by-tradesmart` (2023-01-01 to 2023-06-24, plus an 18:00-20:00 session that
    a daily bar never meets);
  - `highlow-channel-swing` (to the year 2021);
  - `best-engulfing-ma` (2017 to 2020);
- **refused by rule 11** (barstate or `timenow` reaching an order):
  - `parabolic-sar-strategy`;
  - `machine-learning-lorentzian-classification`;
  - `tradingview-alerts-to-mt4-mt5-strategy-example`;
  - `rsi-trend-reversal`;
  - `swing-parabolic-sar-strategy`;
  - `vwap-trendfollow-strategy-wbburgin`;
  - `take-profit-multi-timeframe`.

The **11 SPY-probe:**
- `72s-strategy-adaptive-hull-moving-average-pt1`;
- `stop-loss-and-take-profit-in-example`;
- `tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto`;
- `vwap-fibo-dev-extensions-strategy`;
- `bollinger-rsi-double-strategy-by-chartart-v11`;
- `footprint-strategy`;
- `golden-cross-sma-200-long-only-moving-average-strategy-by-chartart`;
- `macd-sma-200-strategy-by-chartart`;
- `qqe-mod-ssl-hybrid-waddah-attar-explosion`;
- `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy`;
- `trend-following-parabolic-buy-sell-strategy-tradedots`.

**Graded by W9 alone, today:** 34 RDDT plus 4 SPY = **38**. The other 22 wait on other waves'
walls. The 10 ungradable are listed above.

**Routing uses TradingView's captured count only.** Our broker is never run to choose. The estimate
above sizes rig time and nothing else.
1. Capture all 60 non-ungradable scripts on RDDT 1D.
2. For each, read TradingView's closed-trade count from the capture (T2 step 0):
   - 5 or more: graded on RDDT;
   - fewer than 5: an SPY variant is captured.
3. An SPY variant whose **TradingView** count is still below 5, or whose warm-up does not
   converge, is **UNGRADABLE by name** and is added to the list above.
4. The three measured counts (RDDT-graded, SPY-graded, ungradable) replace this table in the
   queue doc.

### 5.3 Size of the set

| block | captures | schedulable now (once T3b's probes exist) |
|---|---:|---:|
| B: S1 rule pins | 23 | 22 (Q-S1i deferred) |
| C: new rule pins | 25 | 22 (W9-M1 ×2 deferred; W9-R1i after the depth read) |
| **rule pins total** | **48** | **44** |
| of which wait on T3a's reader | 3 (W9-S1, W9-S2 ×2) | |
| B': fact capture Q-S1n | 2 | 2 |
| A: spike | 1 session | 1 |
| D: live | 2 | 0 |
| E: grading | **60 on RDDT** + about **11 SPY variants** (only for scripts whose TradingView count on RDDT is below 5), about 71 in all; the 10 ungradable are not captured | after the pins and the reader; 38 of the 60 are gradable without other waves |

At the evidence-engine pacing (30 s throttle, 40 per session), the 44 + 2 take about **2
sessions** plus the spike. E is about 2 more sessions.

**First session (11 captures):**
- W9-C0;
- Q-S1-core;
- Q-S1-core-b;
- Q-S1a ×5;
- Q-S1b ×3;
- W9-D2.

---

## 6. What can run in parallel

| task | owns |
|---|---|
| T0 | `coverage_map.py` and `w0/targets.py` bands |
| T1 | new broker files; `RT/program.js`, `ir.js`, `lowerIr.js`, `vm.js`; FE F1-F12 |
| T2 | `RT/brokerPins.*` (ledger, resolved, lock, reader, rail); `evidence_engine.py` resolve; `compare.mjs` grade |
| T3a | `tv_capture.js`, `schema.mjs`, `verify_capture.mjs`, `adapters.mjs`, `batch_capture.py` |
| T3b | probes; queue doc; `range_guard.py` |
| T4, T5, T7, T8 | `RT/broker.js` functions; `strategyBroker.js` defaults (T4) |
| T6 | `RT/vm.js` step order; the broker timing branch |
| T9 | the broker path source; the lower-TF binding |
| T10 | `BROKER_OPS`; F7/F8 lists |
| T11 | `runtimeColumns.js`, `runtimeWorker.js`, `limits.js`, `memberPaneDefinition.js` runtime path |
| T12 / T13a / T13b | the renderer primitive / `brokerReport.js` / the panel |
| T14a | `bars_window.py`; `scan_evaluator.py:227`; `screener_backtest.py:156-160`; the new rail |
| T14 | the W5 service; `pine_runtime_codec.py`; the new router; W5-T15's descriptor path |
| T15 | `strategiesAreRuled.test.js` comments; the spec |

**Conflicts that force an order:**

| pair | why | order |
|---|---|---|
| T1 → every W9 engine task | creates the files | T1 first |
| T1 ⟂ W4 lanes | **resolved by merge order.** W4-T2, T7-T15, T13S and T17 are merged into the train, and T1's anchors (F1-F12) are taken after them | T1 on the train tip |
| T11 ⟂ W5-T1, W5-T19 | `runtimeColumns.js` | W5 first |
| T14a ⟂ W5-T14, W5-T15 | `scan_evaluator.py:227`; the `screener_backtest.py:156-163` comment. Both W5 lanes land through the train and are not on it yet | T14a first, built from the train tip; the W5 lanes rebase. If a W5 lane lands first, fold T14a into the next train merge |
| T14 ⟂ W5-T11, T14a | codec, constant | both first |
| T2 ⟂ coordinator bumps | the lock and `SCRIPT_ENGINE_VERSION` | pin merges are the coordinator's, in merge order |
| T4 ⟂ T5 ⟂ T7 ⟂ T8 | `RT/broker.js` | T4, T7, T5, T8 |
| T6 ⟂ T9 | `vm.js` | T6 first |
| T10 ⟂ T4..T8 | `BROKER_OPS` | rebase |
| T11 → T12, T13a, T14 | the schema | T11 first |
| T3a ⟂ E | `batch_capture.py`, `evidence_engine.py` | after E's open PR |

**Batches** (at most 3 Opus or Fable agents; heavy jobs serialised):
- **Batch 1 (now):** T0, T2 (ledger, lock, grader), T3a, T3b, T14a (with W5's owner).
- **Batch 2:** T1 on the train tip.
- **Batch 3:** T11, T10, T15.
- **As captures land:** T4 → T7 → T5 → T8 → T6. Then T12, T13a, T13b.
- **After W5-T11, W5-T14 and the deploy:** T14.
- **After D3:** T9.

---

## 7. How the numbers were taken

- Population and census: `coverage-map.json` (2026-11-02, `6272ed7fa3`) and
  `coverage-targets-2026-11-02.json`.
- Finding 4: the `coverage-map.json` on `fix/pine-w0-census-peel`.
- Walls: a static scan on 2026-11-05 over the 70 sources:
  - committed: `corpus/committed/`;
  - builtin and reference: the licence-held cache `_resume-2026-11-01/pine-sample/`, not
    committed.
  The review recomputed it.
- r1:
  - repaint and pyramiding regexes;
  - the magnifier grep;
  - S1's FE sites from `git diff 34da5eb926~1 34da5eb926`;
  - depths from the committed fixtures.
- r2:
  - **F1-F12** re-anchored by grepping each S1 hunk's context line in the train FE at
    `1b8b4616d8` (12,310 lines);
  - W4 merge state from the review and the train log;
  - E-3's rule read from `tests/test_scan_evaluator_off_request_path.py` on master;
  - the `5000` literals by `git grep` on the train;
  - **the grading classification** by a regex scan per source:
    - the longest integer length found in `ta.*` / moving-average calls and in `input(...)`
      defaults, capped at 1,000;
    - long-only meaning no short entry;
    - the rule 11 and date-filter lists taken from the review's source reading;
    - "waits on another wave" meaning the 11-02 map lists a non-strategy wall.
  - The thresholds (≥ 150, or long-only ≥ 100) are a proxy for "fewer than 5 closed trades in
    about 460 post-warm-up bars". T2's measurement replaces it.

---

## 8. Decisions the owner must make

- **D1.** Pin before serve for the 22 text-settled rules. Recommended.
- **D2.** The member-facing sentence for a window that does not reach the listing: "this backtest
  starts on <date>; TradingView may start elsewhere". Recommended: always shown.
- **D3.** Bar detalization data (W7.3). Recommended: defer T9.
- **D4.** The rig account's plan.
- **D5.** The W9.4 route, its plan gate, and multi-symbol runs (cost `symbols × HISTORY_WINDOW_BARS`).
- **D6.** Arming: per W2 stage, or all at once.
- **D7.** The scorecard wording. The screener ruling stays.
- **D8.** Metrics we cannot compute: show the refusal (recommended).
- **D9.** A longer window is a change to `bars_window.HISTORY_WINDOW_BARS`, for every server lane.
- **D10.** The grading floor: 5 closed trades in TradingView's capture, the reference only
  (5.2 E). Set by coordinator ruling; the owner may move the number.

---

## 9. What I could not determine

1. Where the strategy report lives in the chart model (W9-C0).
2. v6's default sizing (Q-S1a).
3. The July-2026 settings' semantics. Only the defaults are pinned.
4. Why the 11-03 census lost 17 strategies from `[strategy]`.
5. Whether `bars.db` holds RDDT's full daily history from 2024-03-21. T2's bar-identity check
   shows it.
6. **The chart lane's `/api/bars?bars=5000`** looks like a restated third copy of the window. It
   is a follow-up for the chart lane, so that it reads `bars_window` through an endpoint. The
   other 5,000 literals in `api/` (alert lanes, `render_panels`, `user_definitions`) are not
   R10's; the coordinator decides whether they should be. `snapshot_builder.DEEP_BARS` is NOT R10's:
   it is the all-time-high lookback and stays separate (R13, 3.4).
7. How the current statement walker skips an order-only `if` (F10).
8. The broker's cost on the W5 service.
9. TradingView's 15-minute depth on the rig plan (W9-R1i).
10. Whether S1's rail passes once ported.
11. **TradingView's actual closed-trade counts per script.** 5.2 E's 49 / 11 / 10 is a static
    proxy for rig sizing. Routing waits for the RDDT captures, and our broker's counts are never
    used.
