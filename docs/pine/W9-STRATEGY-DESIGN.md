# W9 "Strategy tester": design and task breakdown

Written 2026-11-05 by a W9 design author (desktop), docs only. No vitest, census, harness or
rig was run for this document.

Scope (WAVE-TASKS on branch `docs/pine-parity-programme`, section W9; owner: in scope):
- **W9.1** Broker emulator: fills, slippage, commission, pyramiding, `process_orders_on_close`,
  bar magnifier off/on, every rule pinned by captures.
- **W9.2** `strategy.*` read-backs (`position_size`, `equity`, `openprofit`, ...).
- **W9.3** Trade markers on the chart, and the tester report (performance summary, list of
  trades).
- **W9.4** Server-side backtests through W5.

Citations:
- Line citations are at `origin/master` **`646dca8cbf`** (2026-11-05) unless a branch is named.
- `FE` = `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (11,115 lines).
- `RT/` = `app/src/components/chart/engine/runtime/`.
- `S1` = branch `origin/pine/s1-strategy-broker`, tip `34da5eb926` (2026-10-05). It is **not** on
  master. Its merge base with master is `2e304db425`.
- `T15` = branch `origin/feat/pine-w5-t15-backtest`, tip `8550ef036b`. It is **not** on master.

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
| transfer fully (production) | **0** (by definition: an order-placing strategy never transfers, `tools/pine_coverage/coverage_map.py:367-373`) |
| attach on the production door (draw like an indicator, C50) | 14 |
| attach on the runtime-on lane (R1) | 16 |
| W9 production blocks / only-W9-left (upper) / firm | 70 / 40 / 12 (`COVERAGE-MAP-2026-11-02.md` section 6) |
| the programme's headline for W9 | +70 upper / +28 firm (`COVERAGE-MAP.md` section 7 phase 7, 10-30, cumulative after phases 1-6) |

The two W9 numbers answer different questions. **+40 / +12** counts scripts for which W9 is the
last wave left today. **+70 / +28** counts scripts that W9 finishes once W1-W8 have landed.
Plan by +40 / +12 for what W9 alone delivers.

### 0.2 Six findings that shape the plan

1. **No strategy in the sample can be served by the rules S1 settled from text alone. Sizing
   is the first wall.**
   - A static scan of the 70 sources (section 7) finds that 58 of 70 need a sizing rule no text
     settles:
     - 19 declare `default_qty_type = strategy.percent_of_equity`;
     - 20 are v6 and declare no size, so they take v6's default. S1 read that default as
       percent-of-equity 100 from the v6 reference; no capture has confirmed it;
     - 19 are v1-v4 and declare no `default_qty_value`. The v4 reference says "fixed" and
       states no value.
   - 22 of the 23 TradingView built-in strategies are in the 58.
   - Q-S1a (section 5) settles all three, so it is the most valuable capture in W9.
2. **S1 already built a broker. W9 ports it; it does not restart it.**
   - S1 (`34da5eb926`) wrote:
     - `RT/broker.js` (585 lines): a deterministic per-bar emulator;
     - `ast/strategyBroker.js` (199 lines): the declaration and order arguments per Pine
       version;
     - `docs/pine/strategy-broker-spec.md`: 22 rules cited to the v4/v5/v6 Language Reference
       and the User Manual, plus 16 unsettled cases, Q-S1a to Q-S1p;
     - `docs/pine/capture-queue-2026-10-05-s1.md`;
     - the probe `s1-broker-core.pine`;
     - a 247-line rail.
   - **None of its captures was ever taken.** `tests/fixtures/vendor/harness` holds no `s1-*`
     fixture.
   - It cannot be merged as it stands:
     - its base is wave 18 (2026-10-04), and FE has moved a lot since;
     - **its opcode collides**: S1 used `OP.BROKER = 97`, and master's `RT/program.js` now gives
       97/98/99 to `OBJ_CREATE` / `OBJ_UPDATE` / `OBJ_DELETE`.
   - W9-T1 ports the new files nearly verbatim and re-does the 117-line FE hunk at today's
     anchors.
3. **What master does with a strategy today (C50 and R1, both merged).**
   - A strategy draws like an indicator.
   - Order calls are skipped with a note. The one set is `STRATEGY_ORDER_CALLS`
     (`ast/pine.js:239-242`). The host lane reads it at `:25661-25667`, and the runtime lane
     reads the same set at `FE:8728-8738`.
   - A `strategy.*` value refuses `pine:strategy-call` (`pine.js:893` `NAMESPACE_GUARD`). The
     runtime lane refuses the same way, as rail `RT/__tests__/runtimeStrategy.test.js:113-127`
     shows.
   - The screener refuses the declaration `pine:declaration-strategy` (`pine.js:256-257`,
     `:24947`). `strategiesAreRuled.test.js` records that refusal as a **ruling** ("a backtest
     is not a screen"). W9 leaves the ruling standing for the screener. The scorecard row it
     writes needs an owner sentence (section 8, D7).
4. **The census miscounts strategies on the newest measurement.**
   - Branch `origin/fix/pine-w0-census-peel` (11-03 map, master `6990d63b02`) reports
     `strategy()` **6 transfer**. The 6 are:
     - `optimized-keltner-channels-sltp-strategy-for-btc`;
     - both `tradingview-alerts-to-mt4-mt5-*`;
     - `bollinger-rsi-double-strategy-by-chartart-v11`;
     - `macd-sma-200-strategy-by-chartart`;
     - `ut-bot-strategy`.
   - All 6 call `strategy.entry` (static scan). So by the definition they cannot transfer.
   - On that branch the `[strategy]` bucket falls from 70 to 53, and the
     `strategy.position_size` wall (11 on 11-02) disappears.
   - Likely cause (a hypothesis, not verified):
     - `usage_of` builds `items` against the reference inventory `inv`
       (`coverage_map.py:255-346`);
     - the 11-03 run used `ref_rebuilt.json`;
     - so an `strategy.entry` that the rebuilt inventory does not list never reaches `items`,
       and the check `items & STRATEGY_ORDERS` (`:373`, `:672`) misses it.
   - A second defect, verified: `coverage_map.py:358` keeps its **own** order set (5 names). It
     is a second authority beside `pine.js`'s 13 names, which also include `cancel`,
     `cancel_all` and `strategy.risk.*`.
   - W9-T0 fixes both before any W9 number is quoted from a new map.
5. **TradingView changed the tester in July 2026** (`docs/pine/builtins-and-adoption.md:264`,
   `pine-version-evolution.md:177`):
   - "Strategy Tester" is now the **strategy report**;
   - the "Bar Magnifier" checkbox is now a **Bar detalization** menu, and `use_bar_magnifier`
     only sets its default;
   - margin inputs became **Long/Short leverage**;
   - the Properties tab gained **Limit order execution** and **Order execution delay**;
   - strategies gained `calc_on_every_history_tick` (Premium/Ultimate).
   The Properties dialog can therefore change fills with no change to the source. Every W9
   capture must read those settings back and record them (section 5.1). A capture without them
   is INCONCLUSIVE.
6. **The screener backtest is an event study, not a trade list. Its runtime lead is not
   TradingView's seed.**
   - `api/services/screener/backtest.py` scores forward returns from the next bar's open after
     each signal (rule 2). Nothing in it carries a position.
   - T15 (on its branch) replays a runtime document's column with `RUNTIME_HISTORY_LEAD = 500`
     (`api/routers/screener_backtest.py:483` on T15). It says so itself: "NOT a
     TradingView-equal seed (TV runs from bar 0)".
   - A broker's path depends on history (S1 rule B-START), so a strategy cannot ride that
     lead. W9-T14 is therefore a separate run shape that reuses T15's client, admission and
     receipt idioms (section 3.4).

---

## 1. Strategy walls ranked

**Measured:** 2026-11-05, by a read-only static scan (section 7) of the 70 `strategy()` sources in
the 11-02 sample:
- committed scripts from `corpus/committed/`;
- builtin and reference scripts from the licence-held local sample cache. Those sources are not
  committed.

The scan checks each script against S1's rule set (`strategy-broker-spec.md`). The engine of
record is master `646dca8cbf`. On it **every** `strategy.*` value and the whole broker refuse,
so none of these walls is served today.

"Touches" counts the scripts that need the rule. The greedy columns add one rule at a time, the
one that completes the most scripts first. Those columns count only the broker side: a script
still needs its other waves (W1, W4, W7, W8) before it transfers. The only-W9 set is the 40 in
`coverage-targets-2026-11-02.json` `prodWaves.W9.onlyThisWave`; its firm subset is 12.

| # | wall (a rule the broker must serve, or refuse by name) | touches /70 | greedy: complete /70 | only-W9 done /40 | firm /12 | settled by | task |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | sizing: percent of equity (19 declared, 20 by the v6 default) | 39 | 19 | 17 | 1 | Q-S1a | T4 |
| 2 | sizing: v1-v4 default quantity (none stated) | 19 | 31 | 23 | 6 | Q-S1a | T4 |
| 3 | `currency =` declared (served only when it equals the symbol's currency) | 8 | 35 | 25 | 7 | W9-D2 | T4 |
| 4 | v5 defaults: capital 1,000,000 and margin 0 (when undeclared) | 5 | 38 | 27 | 7 | Q-S1b | T4 |
| 5 | `strategy.risk.*` | 6 | 40 | 29 | 8 | W9-R1 | T8 |
| 6 | v5 `when =` | 6 | 42 | 31 | 9 | Q-S1p | T1 |
| 7 | `strategy.order` | 3 | 44 | 33 | 9 | W9-X4 | T7 |
| 8 | OCA groups (`oca_name`, `strategy.oca.*`) | 3 | 46 | 35 | 9 | W9-X3 | T7 |
| 9 | trailing exits (`trail_points` / `trail_offset` / `trail_price`) | 4 | 48 | 36 | 9 | W9-X1 | T7 |
| 10 | commission (non-zero or an input; three types) | 17 | 55 | 36 | 9 | W9-K1..K3 | T5 |
| 11 | partial exits (`qty`, `qty_percent` other than 100) | 6 | 60 | 38 | 11 | W9-X2 | T7 |
| 12 | slippage (non-zero or an input) | 3 | 61 | 38 | 11 | W9-K4 | T5 |
| 13 | partial `strategy.close` | 2 | 62 | 38 | 11 | W9-X2 | T7 |
| 14 | values outside S1's set (`position_entry_name`, `max_drawdown`, `opentrades.profit`) | 4 | 64 | 38 | 11 | W9-V1 | T10 |
| 15 | `calc_on_every_tick = true` | 2 | 64 | 38 | 11 | Q-S1o (live) | T6 |
| 16 | `process_orders_on_close = true` | 2 | | | | W9-P1 | T6 |
| 17 | `calc_on_order_fills = true` | 1 | | | | W9-P2 | T6 |
| 18 | `close_entries_rule`, `margin_*`, `backtest_fill_limits_assumption` declared | 1 each | | | | W9-D1, W9-J1 | T4, T6 |
| 19 | `strategy.close_all(immediately = true)` | 1 | | | | W9-X4 | T7 |

**S1's core set, served by the emulator once pinned:**
- market, limit and stop entries (17 scripts use a price entry);
- exit brackets: 25 scripts call `strategy.exit`, 7 of them with no `from_entry`;
- cancel (11);
- pyramiding above 1 (7);
- the values `position_size` (18), `position_avg_price` (16), `opentrades` (6),
  `initial_capital` (5), `equity` (5), `netprofit` (4), `openprofit` (3), and 1 each for the
  rest.

**The core set appears in no ranking row because it is a precondition for every row.** All of it
is pinned by Q-S1-core and Q-S1c to Q-S1n. Until those captures MATCH, nothing a broker computes
is served (rule 2 of section 2). The ranking is the order in which to take the **other** captures
once the core is pinned.

**Wall touches against the census (11-02, production lane):**
- `strategy.position_size` is a wall of 11 scripts in the map but is used by 18 sources. The map
  counts it only where the peel reached it.
- `strategy.position_avg_price` 3 (map) against 16 (source); `strategy.opentrades` 1 against 6.
- `pine:strategy-call` is 14 scripts on the runtime-on lane (map section 4, rank 21).
- After T0 the map should agree with the source scan on every strategy row.

Non-broker walls that also stop these 70 scripts (production map) are owned by other waves and
listed so W9 does not claim them:

| wall | scripts | wave |
|---|---:|---|
| `[imperative]` | 15 | W4 |
| `request.security` | 8 | W7 |
| `[imports-libraries]` | 6 | W8 |
| `[user-functions]` | 6 | W4 |
| `[drawing-objects]` (+ object ops) | 4 + 6 | W3 |
| `[translator-robustness]` | 4 | W1 |
| `ta.barssince` / `ta.valuewhen` / `ta.sar` | 3 / 2 / 1 | W1 |

---

## 2. Rules every W9 task follows

1. **Refuse by name, never a silent wrong value.**
   - A broker case that no MATCHing capture pins stops the run at the bar that reaches it:
     guard `runtime:strategy-unpinned`, naming the rule id and the capture row that would pin
     it.
   - A declaration or argument that is never served refuses at build: `runtime:strategy-option`
     or `runtime:strategy-value`, as in S1.
   - S1's `runtime:strategy-unsettled` stays for cases that text **and** captures both leave
     open.
   - A script that never reaches a case is served in full.
   - The member sees the sentence on the pane and in the report. A trade list is never shown
     with a refused trade missing from it.
2. **Every emulator rule is pinned by a capture before it serves a value.** S1 served its 22
   "settled" rules from documentation alone; W9 does not.
   - One authority, `RT/brokerPins.json` (new, owned by T2), maps each rule id (`B-FILL`,
     `B-PATH`, ...) to the fixture or fixtures that witness it. A pin is valid only when that
     fixture's grade in the harness run is MATCH.
   - The broker asks `pinned(ruleId)` at the decision point. An unpinned rule refuses as in
     rule 1.
   - Tests run with an explicit test-only pin set (`makeBroker(cfg, data, { pins })`). Production
     code never passes it.
   - A rail greps that nothing outside `__tests__` passes `pins`. The rail is mutation-proved:
     add such a call and it goes red.
3. **One authority per value.**
   - Fills, positions and trades are computed only by `RT/broker.js`. There is no Python broker:
     the server runs the same JS bundle (W5).
   - `strategy.*` values (W9.2), chart markers (W9.3), the report (W9.3) and the server output
     (W9.4) all read **one** record: the run's `strategy` record (section 3.2). None of them
     recomputes a fill, a profit or a drawdown.
   - Report metrics that are not `strategy.*` variables are computed once, in
     `RT/brokerReport.js` (T13), from that record.
   - The order-call set stays `STRATEGY_ORDER_CALLS` (`pine.js:239`). `coverage_map.py` derives
     its set from it (T0) and stops restating it.
   - Per-version declaration defaults live in one table (`ast/strategyBroker.js`) and are pinned
     by Q-S1a and Q-S1b.
4. **The C18 object door builds exactly what master builds.**
   - Broker mode is reachable only from the runtime pane with the broker gate on, never with
     `opts.objectDoor === true` (`FE:1101-1105`, `RT/runtimeColumns.js:1488, 1582`).
   - At the object door, order calls are still skipped (R1) and values still refuse
     `pine:strategy-call`.
   - Rail: one case per W9 capability in `RT/__tests__/objectDoorGate.test.js`.
   - measure-pair must show **0 C18 verdict diffs** unless a PR says why and classifies each
     one.
5. **The stage-1 script and the W2 allowlist do not move.**
   - `adx-and-di-for-v4` must stay byte-identical.
   - Once W2 has merged, its `runtimeAllowlistParity.test.js` is required on every W9 PR.
6. **Built dark.**
   - The broker sits behind `VITE_PINE_STRATEGY_BROKER_ENABLED` (S1's gate,
     `engine/strategyBrokerGate.js`, `Dockerfile.web` ARG, `docs/feature_flags.json` entry).
     It is off by default. Builders never flip it, never set a Railway variable and never touch
     prod flags.
   - With the gate off, every W9 PR must leave runtime-on census rows, harness verdicts and C18
     probes identical. Rail: a gate-off/gate-on pair in `s1StrategyBroker.test.js`.
7. **Engine version.**
   - Builders never edit `SCRIPT_ENGINE_VERSION` (`engine/scriptEngineVersion.js:88`, now 5).
     The coordinator bumps it once per merge that changes translator output or door outcomes.
     With the gate off, no W9 task should change either.
   - `RUNTIME_FRONTEND_VERSION` is bumped only if an already-served shape changes meaning. A new
     opcode or EXPR kind does not change meaning.
   - Each bump regenerates W5's host-parity digests once W5 T4 has landed.
8. **Ship loop** (WAVE-TASKS section 1):
   - rails red before the change, green after;
   - every new guard mutation-proved (`docs/pine/parity-programme/scripts/mutate.py`): remove
     the guard, a named rail goes red, restore it from saved bytes, never with `git checkout`;
   - independent Opus review GO;
   - measure-pair runtime-on, with every intended diff classified;
   - deploy-gate pytest and hygiene before the final push.
9. **No heavy job outside the lock.** Targeted vitest files only, `--maxWorkers=2`. Census and
   harness runs go through `heavy_lock`.
10. **No builder runs the rig.**
    - Captures are the owner's (EVIDENCE-ENGINE-DESIGN section 4).
    - Builders write probes and queue rows, never sign in and never open TradingView.
    - Values come from the chart model (`tools/vendor_harness/tv_capture.js`), never pixels and
      never `chart.exportData()` (which is plan-gated).

---

## 3. Architecture (what the tasks build toward)

### 3.1 Where the broker runs

- **Runtime lane only.**
  - The host (columnar) lane keeps C50: it draws the plots, skips the orders and refuses the
    values.
  - A strategy whose orders are served goes through the runtime lane, exactly as R1 already
    routes it. The broker cannot live in a columnar plan: fills feed `strategy.*` values back
    into the same bar's script.
- **Per bar, S1's order.**
  1. Fills of orders pending from earlier bars, along the intrabar path. With the Bar
     detalization off this is S1's B-PATH; with it on, T9's lower-timeframe path.
  2. Then the script runs on the bar's close and reads the values that include those fills.
  3. Then the new orders are queued.
  `process_orders_on_close` and `calc_on_order_fills` (T6) add a fill step after the script
  and, for the latter, a re-run.
- **History only.**
  - The VM never runs a broker program on a forming bar (S1 B-EXEC).
  - `calc_on_every_tick` on a forming bar refuses.
  - A broker run must start at the listing (`runtimeHistory: 'listing'`,
    `memberPaneDefinition.js:1699`). Otherwise it refuses
    `runtime:strategy-start` (B-START, Q-S1n).

### 3.2 The run's `strategy` record (one source for W9.2, W9.3 and W9.4)

The run returns this record beside the plot columns. T11 owns the shape; `RT/broker.js` alone
fills it.

```jsonc
{
  "settings": { "version": 5, "initial_capital": 100000, "default_qty": {"type": "fixed", "value": 3},
                "pyramiding": 2, "commission": {"type": "percent", "value": 0}, "slippage": 0,
                "process_orders_on_close": false, "bar_detalization": "off", "currency": "USD" },
  "orders":  [ { "id": "L", "kind": "entry", "dir": "long", "qty": 3, "placedBar": 41, "type": "market",
                 "status": "filled", "fillBar": 42, "fillPrice": 12.34, "comment": null } ],
  "trades":  [ { "n": 1, "entryId": "L", "dir": "long", "qty": 3, "entryBar": 42, "entryPrice": 12.34,
                 "exitId": "XL", "exitBar": 60, "exitPrice": 14.19, "profit": 5.55, "commission": 0,
                 "runUp": null, "drawdown": null } ],          // fields still unpinned stay null, with a refusal
  "equity":  "<column, one value per bar>",
  "refusals": [ { "rule": "B-PATH", "guard": "runtime:strategy-unpinned", "bar": 118, "sentence": "..." } ]
}
```

- The `strategy.*` read-backs (T10) are views of this record at a bar.
- Markers (T12) are its `orders` with a fill.
- The report (T13) is a pure function of the record.
- W9.4 (T14) serialises the record.

### 3.3 The member surfaces (W9.3)

- **Markers:** fills drawn on the price pane, the way TradingView draws strategy orders: an
  arrow at the fill bar and price, with the order id or comment and the signed quantity. The
  exact presentation is pinned by W9-T1 before it ships.
- **Report:** a panel under the chart with three tabs:
  - Performance summary;
  - List of trades;
  - Properties: the settings the run used, including the July-2026 menus, so a member can see
    why a number differs from TradingView's.
  A metric with no pin shows its refusal sentence, never a number.
- A strategy with a run-wide refusal shows the plots (C50, as today) and a report that holds
  only the refusal.

### 3.4 W9.4 composed with W5 and the screener backtest

- W5's service (`SERVER-RUNTIME-DESIGN.md` on T15, section 3.2) already runs the same bundle. So
  the broker is on the server once it is in the bundle.
- The service needs:
  - a `want` key `"#strategy"` that returns the serialised record (3.2) as a per-output result;
  - a profile, `backtest` (existing), for its priority and limits.
- The context must carry `historyFromListing: true`. The bars must start at the symbol's first
  stored bar.
- `bars.n ≤ 32,768` (service cap) and the route's own `MAX_BARS_PER_SYMBOL = 5000`
  (`screener_backtest.py:160`) bound it. A history longer than the cap refuses
  `runtime:strategy-start` by name. It is never truncated: a truncated start is a different
  backtest.
- **A separate route, not a new mode of the screener backtest.**
  - The screener backtest answers "did this screen work across a universe" (forward returns,
    baseline). A strategy answers "what did this strategy do on this symbol" (a trade list and
    equity).
  - The strategy route reuses, by import and not by copy:
    - T15's client and codec (`pine_runtime_client.py`, `pine_runtime_codec.py`);
    - its admission (`runtime_server_lane.admission`, lane `backtest`);
    - its 409/503/500 mapping;
    - the digest-of-request receipt idiom.
  - `POST /api/pine/strategy-backtest` (new router, rail in the `test_screener_backtest_auth.py`
    style). The owner chooses the URL (D5).
- **A strategy as a screen** is a separate question, and the screener's ruling stays.
  - A strategy's **plot** used as a screen column already goes through T15 like any runtime
    document, because C50/R1 draw strategies.
  - A screen that reads a `strategy.*` value would need the full-history rule above, and is
    refused `runtime:strategy-start` under T15's 500-bar lead. T14 adds that refusal to T15's
    path.

---

## 4. Tasks

Sizes: S ≤ 1 day, M 2-3 days, L about a week.

Model tiers follow AGENT-RULES:
- **Sonnet** builds from a precise spec.
- **Opus** builds engine semantics and does every merge-gating review.
- **Fable** only after Opus fails the same task twice.
- **Haiku** does list and log chores.

**Capture-gated** means the task can be built and merged dark before its captures land. Its
rules then refuse `runtime:strategy-unpinned` until the pin is a MATCH. "Gated" never means
"wait to start".

### T0 Census honesty for strategies | S | Sonnet | no capture

- **Owns:**
  - `tools/pine_coverage/coverage_map.py` `:358-373` (`STRATEGY_ORDERS`, `clean`), `:670-690`;
  - `tools/pine_coverage/w0/targets.py` `:56`, `:189`;
  - a new `tests/test_pine_coverage_w9_t0_strategy.py`.
- **Delivers:**
  1. Order-placing detection reads the source. A `strategy.<order call>(` regex over the code,
     comments stripped, joined with a strategy declaration. It never depends on the reference
     inventory, which fixes finding 4.
  2. The order-call set comes from `STRATEGY_ORDER_CALLS`. Either a generated
     `tools/pine_coverage/strategy_order_calls.json` written by a vitest rail that imports
     `pine.js`, or a parity rail that reads both; the builder picks one and says which.
  3. A new `strategyOn` block in `coverage-map.json`:
     - per strategy, the runtime lane's broker verdict (served / `runtime:strategy-*` guard
       plus rule id) once the census can run gate-on;
     - until then, the static walls of section 1, under a tag that says so.
  4. `runtime:strategy-unpinned` / `-option` / `-value` / `-start` map to W9 (`targets.py:56`
     already maps the prefix; the rail pins it).
- **Rails:**
  - the 6 scripts of finding 4 are strategies with orders and never `clean`;
  - a control indicator stays `clean`.
- **Mutations:**
  - restore inventory-based detection: the 6 transfer again (red);
  - drop `cancel` from the derived set: the parity rail goes red.
- **Depends:** coordinate with `fix/pine-w0-census-peel`. Merge after it, or rebase it.

### T1 Port S1's broker core onto master, gated and dark | M | Opus | no capture to build (serves nothing until T2 pins)

- **Owns:**
  - new files: `RT/broker.js`, `ast/strategyBroker.js`, `engine/strategyBrokerGate.js`,
    `RT/__tests__/s1StrategyBroker.test.js`;
  - `RT/program.js` `OP` table (`:40-~300`): **a new opcode after `OBJ_DELETE: 99`**, never 97;
  - `RT/ir.js` (`EXPR.BROKER`, S1 `+19`);
  - `RT/lowerIr.js` (S1 `+31`);
  - `RT/vm.js`: the fill step before each bar and the opcode handler (S1 `+48`);
  - FE broker mode, re-done at today's anchors. The rebuild of a `pine:strategy-call` refusal
    and the declaration read go beside `FE:8728-8747`. The order-argument read goes through
    `ast/strategyBroker.js`;
  - `Dockerfile.web` ARG; `docs/feature_flags.json`;
  - `docs/pine/strategy-broker-spec.md`, ported, with a new "pinned by" column (empty).
- **Delivers:**
  - S1's emulator on master, gate off by default;
  - B-WHEN for v4, with v5 `when` gated by Q-S1p;
  - per-version positional signatures (B-SIG);
  - the `strategy` record, in skeleton form, for T11.
- **Port, don't redesign.** Take `broker.js` and `strategyBroker.js` byte-for-byte, then apply
  only:
  - the opcode renumbering;
  - a `pinned()` hook at each `[B-..]` decision. With T2 not yet merged it returns false, so
    every served rule refuses `runtime:strategy-unpinned` in production builds;
  - FE anchors.
- **Rails:**
  - S1's 247-line suite, ported, run with a test pin set;
  - gate-off parity: same IR, same columns, same diagnostics as master for every script in
    `runtimeStrategy.test.js`;
  - `objectDoorGate.test.js`: a broker-mode case refuses at the door;
  - **opcode uniqueness**: every `OP` value distinct. Mutation: set the broker opcode to 97 and
    the rail goes red.
- **Mutations:**
  - drop the gate check: the gate-off rail goes red;
  - drop the forming-bar skip: the B-EXEC case goes red;
  - drop the `pinned()` ask: the unpinned case serves, red.
- **measure-pair:** gate off, so 0 diffs. A gate-on run is reported but not required.
- **Engine bump:** no (dark).
- **Depends:** none. It conflicts with any W4 task that edits `FE:8700-8760`; at the date of
  writing, none does (W4-BREAKDOWN section 4).

### T2 The pin ledger and the strategy grader | M | Sonnet | no capture to build

- **Owns:**
  - new `RT/brokerPins.json` and `RT/brokerPins.js` (`pinned(ruleId)`);
  - `tools/vendor_harness/compare.mjs`: a strategy grade;
  - `tools/vendor_harness/evidence_engine.py`: the pin check;
  - a new rail `RT/__tests__/brokerPins.test.js`.
- **Delivers:**
  - **Pins:** `{ "B-FILL": ["s1-broker-core-rddt-1d-<date>", ...], ... }`, loaded at build. A
    pin is live only when every fixture it names grades **MATCH** in the latest committed
    harness verdicts. That grade is read from the verdict file, not stored twice.
  - **Strategy grade:** our run of the probe against the capture, row by row. The rows are the
    plotted `strategy.*` values (the S1 probe's `N02..N14`) and, where the capture carries it,
    the trade list.
    - Prices: exact to the tick (`syminfo.mintick`).
    - Quantities: exact.
    - Currency: exact to 1e-9 relative, with no new tolerance.
    - A row that differs names the rule whose decision produced it. The broker logs `rule` per
      fill.
- **Rails:**
  - a pin naming a missing fixture fails;
  - a pin whose fixture is DIVERGE does not pin;
  - one fixture can pin several rules;
  - a refusal in our run against a value in theirs is a DIVERGE, never a MATCH.
- **Mutations:** treat INCONCLUSIVE as MATCH, and the rail goes red.
- **Depends:** T1, for rule ids. It can start in parallel against S1's ids.

### T3 Capture tooling for strategies | M | Sonnet | capture-gated on the W9-C0 spike (owner, rig)

- **Owns:**
  - `tools/vendor_harness/tv_capture.js` (new `__uctVH.strategy()`);
  - `schema.mjs`, `verify_capture.mjs`;
  - `batch_capture.py`: `Create new ▸ Strategy` for a `strategy()` source (EVIDENCE-ENGINE
    section 4.2 today says `Create new > Indicator`), plus a Properties read-back;
  - `tools/vendor_harness/adapters.mjs`.
- **Delivers:**
  - The plotted `strategy.*` rows are **already** captured by the existing plot reader. W9.1 and
    W9.2 pins need nothing new beyond the Create-new branch and the Properties read-back.
  - `__uctVH.strategy()` reads the strategy data source's report object off
    `mm.dataSources()`: list of trades, performance summary, equity. Its property names are
    unknown until W9-C0 enumerates them (section 9).
  - The Properties read-back records every input of the strategy's Properties tab, including
    the July-2026 menus, into the capture's `provenance.strategySettings`. A capture without it
    fails `verify_capture`.
- **Rails:**
  - schema rejects a strategy capture with no settings block;
  - a trades-list row missing a required field fails `verify_capture`;
  - existing non-strategy captures still verify byte-identically.
- **Depends:** W9-C0 for the report reader only. The Create-new and Properties halves need no
  spike.

### T4 Sizing, capital, defaults, currency | M | Opus | capture-gated: Q-S1a, Q-S1b, W9-D1, W9-D2

- **Owns:** `ast/strategyBroker.js` (the defaults table, the only one); `RT/broker.js` (the
  sizing function).
- **Delivers:**
  - `percent_of_equity` and `cash` sizing: which price sizes the order (signal close or fill
    open) and the rounding (whole units or fractions; per symbol type);
  - the v1-v4 unstated default value;
  - the v6 default;
  - the v5 capital and margin defaults;
  - `currency =` served only when it equals the symbol's currency (identity conversion).
    Anything else refuses `runtime:strategy-option` naming the currency;
  - `margin_*` / leverage served only at the values W9-D1 witnesses; margin calls stay refused
    (Q-S1i).
- **Rails:**
  - one per version default against its capture;
  - percent sizing on a bar where the close and the next open differ (the fixture must be able
    to tell the two apart);
  - fractional against whole-unit rounding on a stock.
- **Depends:** T1, T2.

### T5 Costs: commission and slippage | S | Sonnet | capture-gated: W9-K1..K4

- **Owns:** `RT/broker.js` (a cost step at each fill); `ast/strategyBroker.js` (argument read).
- **Delivers:**
  - `commission_type` percent, `cash_per_contract` and `cash_per_order`: charged on entry and
    exit, in `profit`, `netprofit` and `equity`;
  - `slippage` in ticks: on which order types it applies (market and stop; limit is expected not
    to, but the capture decides) and in which direction.
- **Rails:** one per type, each with a fixture whose trades differ in quantity, so a per-order
  charge and a per-contract charge give different numbers.
- **Depends:** T1, T2.

### T6 Fill timing | M | Opus | capture-gated: W9-P1..P3, W9-J1, Q-S1o (live)

- **Owns:** `RT/vm.js` (the step order around the script) and `RT/broker.js`.
- **Delivers:**
  - `process_orders_on_close = true`: fill at the bar's close, after the script;
  - `calc_on_order_fills = true`: the extra script run after a fill, history only;
  - `calc_on_every_tick = true`: history behaviour only;
  - the July-2026 "Order execution delay" and "Limit order execution" settings: served only at
    their default (W9-J1), any other value refusing by name;
  - `backtest_fill_limits_assumption`.
- **Rails:** a fixture where the same-close fill and the next-open fill give different trades,
  and the same for the re-run.
- **Depends:** T1, T2. It conflicts with T9 on `vm.js` (section 6).

### T7 The exit family and other order kinds | M | Opus | capture-gated: W9-X1..X4, Q-S1d, Q-S1f, Q-S1g, Q-S1h, Q-S1j, Q-S1k

- **Owns:** `RT/broker.js`.
- **Delivers:**
  - trailing exits;
  - partial exits (`qty`, `qty_percent`) and multi-level exits;
  - partial `strategy.close`;
  - OCA cancel and reduce;
  - `strategy.order` (no pyramiding check, no reversal);
  - `close_all(immediately = true)`;
  - stop-limit entries;
  - the v6 rule that relative and absolute exit levels both apply (`pine-version-evolution.md`
    row 54) against v5's "absolute wins".
- **Rails:** each per rule, with a two-version fixture for the v5/v6 exit rule.
- **Depends:** T1, T2.

### T8 `strategy.risk.*` | S | Sonnet | capture-gated: W9-R1

- **Owns:** `RT/broker.js` (an order filter before queueing).
- **Delivers:** `allow_entry_in`, `max_intraday_loss`, `max_drawdown`,
  `max_intraday_filled_orders`, `max_cons_loss_days`, `max_position_size`. Each is served only
  once its own row MATCHes.
- **Depends:** T1, T2, T4 (equity terms).

### T9 Bar detalization (bar magnifier) | M | Opus | capture-gated: W9-M1; data-gated (W7.3)

- **Owns:** `RT/broker.js` (the intrabar path source); the runtime binding that supplies
  lower-timeframe bars.
- **Delivers:**
  - with detalization on, fills follow the lower-timeframe bars TradingView uses. W9-M1 pins
    which timeframe each chart timeframe maps to;
  - without those bars for the whole run, the run refuses `runtime:strategy-option`
    ("bar detalization needs <tf> bars from <date>"). It never falls back to B-PATH.
- **Depends:** T1, T2, T6 (`vm.js` order), and the W7.3 lower-TF data contract.
  **Deferred until D3 is answered.**

### T10 `strategy.*` read-backs | M | Sonnet | each value capture-gated by its rule's pin; W9-V1 for those outside S1's set

- **Owns:**
  - FE lowering of `strategy.*` names and per-trade functions to the broker opcode. Today they
    refuse at `pine.js:893`; on the runtime lane they are rebuilt in broker mode by T1's FE
    hook;
  - `RT/broker.js` (`BROKER_OPS` value table, the only one).
- **Delivers:**
  - S1's 23 values;
  - then the rest of v6's list: `max_drawdown`, `max_runup`, `avg_trade`, `avg_winning_trade`,
    `avg_losing_trade`, `*_percent`, `max_contracts_held_*`, `position_entry_name`,
    `opentrades.profit`, `closedtrades.commission` / `max_runup` / `max_drawdown`,
    `closedtrades.first_index`, `margin_liquidation_price`, `account_currency`;
  - each served only when its pin MATCHes.
- **Rails:**
  - values read on the bar after a fill include it (B-FILL);
  - a value read on a fill bar under `process_orders_on_close` (after T6);
  - a text value (`position_entry_name`) through a label (W3's object lane, at the runtime pane
    only).
- **Depends:** T1, T2. Values touching T4-T7 rules wait on those pins and need no code change.

### T11 The `strategy` record through the run | S | Sonnet | no capture

- **Owns:**
  - `RT/runtimeColumns.js`, `RT/runtimeWorker.js`: carry the record beside the columns;
  - the member pane's runtime path in `builder/memberPane/memberPaneDefinition.js`: read-only;
    it passes the record to the chart;
  - `RT/broker.js` (record shape).
- **Delivers:**
  - section 3.2, frozen as a schema;
  - transfer cost bounded: trades and orders are capped by `RT/limits.js`. v6 trims the oldest
    trades over 9,000 (`pine-version-evolution.md` row 53), and that trim is a W9-V1 pin;
  - over the cap: refusal by name.
- **Rails:**
  - schema;
  - the record survives the worker boundary byte-identically;
  - gate off: no record and no key.
- **Depends:** T1.

### T12 Trade markers on the chart | M | Sonnet (renderer) | capture-gated: W9-T1 (presentation)

- **Owns:** a new renderer primitive for strategy fills under `app/src/components/chart/`. The
  path is the builder's to choose next to the existing object renderer; it is named in the PR.
- **Delivers:**
  - markers from the record's filled orders: position, direction, quantity, id or comment;
  - the presentation (arrow style, label text, colours, stacking several fills on one bar) as
    W9-T1 shows;
  - unpinned presentation: positions drawn with a plain marker and the sentence "marker style
    not yet verified". This is the only W9 surface allowed a neutral fallback, because a
    position is a pinned fact and a style is not a value.
- **Rails:** markers equal the record's fills, one to one. Mutation: drop one fill and the rail
  goes red.
- **Depends:** T11. Needs W2 stage 1 before a member sees it.

### T13 The strategy report panel | L | Sonnet (UI) + Opus (metrics) | capture-gated per metric: W9-S1, W9-S2

- **Owns:** new `RT/brokerReport.js` (pure metrics from the record, one authority) and a new
  report panel component beside the chart.
- **Delivers:**
  - **List of trades:** trade #, type, signal, date/time, price, quantity, profit (currency and
    %), cumulative profit, run-up, drawdown.
  - **Performance summary:** net profit, gross profit and loss, commission paid, buy and hold
    return, maximum equity run-up, maximum drawdown, Sharpe, Sortino, profit factor, maximum
    contracts held, open P&L, total, winning and losing trades, percent profitable, average P&L,
    average win and loss and their ratio, largest win and loss, average bars in trades (all,
    winning, losing), margin calls.
  - Each metric is served only once W9-S1/S2 pins its formula. Sharpe and Sortino in particular
    depend on TradingView's period and risk-free rate (`risk_free_rate`) and are unpinned until
    then.
  - The Properties tab shows the run's settings.
- **Rails:**
  - every metric derives from the record (a grep rail: `brokerReport.js` imports nothing from
    `broker.js` but the record type);
  - one fixture per metric that tells the candidate formulas apart.
- **Depends:** T11.

### T14 Server-side strategy backtests through W5 | M | Opus | no capture of its own (serves what T1-T10 pinned)

- **Owns:**
  - the W5 service's `want: "#strategy"` handling (W5's service files, under the coordinator's
    W5 ownership);
  - `api/services/pine_runtime_codec.py`: the record codec;
  - new `api/routers/pine_strategy_backtest.py` and its auth rail;
  - T15's `screener_backtest.py` `_runtime_descriptor` path: a refusal for a strategy value
    under the 500-bar lead.
- **Delivers:**
  - section 3.4;
  - the record as computed on the server, digest-equal to the browser's for the same bars. The
    host-parity rail (W5 2.3) gets strategy cases;
  - refusals mapped through T15's table.
- **Rails:**
  - host parity of the record;
  - the history-from-listing refusal;
  - the no-truncation refusal;
  - auth: route count and plan gate.
- **Depends:** T11; W5 T15 merged; the W5 service deployed (owner, Railway); D5.

### T15 Docs and the ruling's wording | S | Haiku | no capture

- **Owns:**
  - `app/src/components/chart/engine/ast/strategiesAreRuled.test.js` (comment text and the
    scorecard sentence only, after D7);
  - `docs/pine/strategy-broker-spec.md` (the "pinned by" column, filled as pins land).
- **Delivers:** the scorecard reads "strategies: screener refuses by ruling; the chart's strategy
  tester is W9" (wording per D7). No guard changes.
- **Depends:** D7.

### Deferred (not W9 builds)

- **Realtime and forming bars:** `calc_on_every_tick` on a live bar, forming-bar outputs
  (Q-S1o, Q-S1p live half), and strategy alerts (`alert_message`, `{{strategy.*}}`
  placeholders). These need W5's forming-bar decision (Q3) and a live feed. They stay refused.
- **`calc_on_every_history_tick`** (July 2026, Premium/Ultimate): it needs historical tick
  data, which we do not hold. Refused.
- **Margin calls and liquidation** (Q-S1i): refused until a capture shows one. The rule is
  long, and a wrong liquidation corrupts every later trade.
- **Heikin Ashi "mode" and non-standard chart types:** strategy fills on synthetic bars.
  Refused.
- **Deep backtesting and a different date range from the chart:** the report covers the run's
  bars only.
- **`request.*` inside strategies** (8 scripts): W7. **Libraries** (6): W8.

---

## 5. The capture plan

TradingView's tester semantics are vendor behaviour. Every rule above refuses until its row
below MATCHes. Rows follow EVIDENCE-ENGINE-DESIGN section 2.1, so T2 or the coordinator can
paste them as-is into a new `docs/pine/capture-queue-2026-11-XX-w9.md`:
- the row id is the first cell;
- each probe is committed under `tools/visual_conformance/probes/`;
- each chart is an explicit `EXCH:SYM tf`;
- the guards and the scripts the row unblocks are named.

S1's queue doc (`capture-queue-2026-10-05-s1.md`, on the S1 branch) moves to master with T1. Its
row ids are reused, not copied.

### 5.1 Standing settings for every W9 capture

- **Read values from the chart model, never pixels.**
  - The plotted `strategy.*` rows come through `tv_capture.js`'s existing plot reader
    (`metaInfo().plots`, `data()`).
  - The list of trades and the performance summary come through T3's `__uctVH.strategy()`,
    once W9-C0 has located the report object.
  - **No CSV export** in the pipeline. S1's queue asked for "Export data". That is a UI export,
    not the model, and it may be plan-gated like `exportData()`. It stays a manual cross-check
    only, never a fixture.
- **Witness trades through plots wherever possible.** Each probe plots, every bar:
  - `strategy.closedtrades`, `strategy.opentrades`, `position_size`, `position_avg_price`,
    `netprofit`, `equity`, `openprofit`;
  - for the last **three** closed trades (so up to three closes on one bar are seen):
    `entry_bar_index`, `exit_bar_index`, `entry_price`, `exit_price`, `size`, `profit`,
    `commission`.
  That rebuilds the list of trades from plots alone. So **W9.1 and W9.2 do not wait for the
  report reader.** Only W9-S1/S2 (summary metrics with no `strategy.*` variable) need it.
- **Properties:** never touched by hand. Every setting the row tests is in the **source**, so
  the sha256 pins it. The capture reads back the whole Properties tab (T3), including Bar
  detalization, Limit order execution, Order execution delay, leverage, commission, slippage,
  currency and margin, and records it in provenance. A read-back that disagrees with the
  source's declaration is INCONCLUSIVE.
- **Charts:**
  - `NYSE:RDDT 1D`: listed 2024-03; short enough that TradingView surely loads from the listing,
    which satisfies B-START. The capture asserts `window.firstBarTime` equals the listing.
  - `AMEX:SPY 1D`: long history; it witnesses what TradingView does when its loaded window is
    not the listing (Q-S1n).
  - Market closed, so `newestBarIsForming` is false, except the needsLive rows.
- **Account plan:** the capture records the plan the rig is signed in on. Bar detalization and
  `calc_on_every_history_tick` are plan-gated (section 9).

### 5.2 The rows

**A. Spike (owner, rig, read-only; no fixture)**

| row | what | chart | unblocks |
|---|---|---|---|
| W9-C0 | With `s1-broker-core.pine` on the chart, run a read-only key walk of `mm.dataSources()`. Find the strategy source; list its methods and own properties to depth 2, **names and types only, no values**; the reader is committed in T3 as `__uctVH._strategyKeys()`. Note which key holds trades, performance and equity, and whether it fills before the report panel is opened. | `NYSE:RDDT 1D` | T3 report reader → W9-S1, W9-S2 |

**B. Rule pins: the S1 rows (probes on the S1 branch move with T1; `NEEDS_PROBE` where marked)**

| row | probe | chart(s) | captures | settles | guards | gates |
|---|---|---|---:|---|---|---|
| Q-S1-core | `s1-broker-core.pine` (extend to the three-trade plot set of 5.1) | `NYSE:RDDT 1D` from the listing, `AMEX:SPY 1D` | 2 | B-FILL, B-MARKET, B-PATH, B-GAP, B-PYR, B-REVERSE, B-MODIFY, B-CLOSE, B-EXIT-*, B-FIFO, B-VAL | `runtime:strategy-unpinned` | T1 core, T10 core values |
| Q-S1a | `w9-q-s1a-size.pine` (NEEDS_PROBE; S1 row text), five variants as sibling files: `-v4` (no size), `-v6` (no size), `-v5pct` (percent 100, capital 100000), `-v5cash` (cash 10000), `-v2` (no pragma) | `NYSE:RDDT 1D` | 5 | wall 1, wall 2: sizing price, rounding, version defaults | `runtime:strategy-option` | T4 |
| Q-S1b | `w9-q-s1b-defaults.pine`, `-v4` / `-v5` / `-v6` | `NYSE:RDDT 1D` | 3 | capital and margin defaults per version (wall 4) | `runtime:strategy-option` | T4 |
| Q-S1c | as S1 (find a bar with the open equidistant from high and low first) | `AMEX:SPY 1D`, `NYSE:RDDT 1D` | 2 | the path on a tie | `runtime:strategy-unsettled` | T1 |
| Q-S1d | as S1 | `NYSE:RDDT 1D` | 1 | same-tick fill order | same | T1, T7 |
| Q-S1e | as S1 | `NYSE:RDDT 1D` | 1 | an exit live already past its level | same | T1 |
| Q-S1f | as S1 | `NYSE:RDDT 1D` | 1 | does a reversal end an exit with no `from_entry` | same | T7 |
| Q-S1g | as S1 | `NYSE:RDDT 1D` | 1 | a price entry at the pyramiding limit | same | T7 |
| Q-S1h | as S1 | `NYSE:RDDT 1D` | 1 | FIFO split | same | T7 |
| Q-S1i | as S1 | `AMEX:SPY 1D` | 1 | insufficient funds and margin call | same | deferred (refusal wording only) |
| Q-S1j | as S1 | `NYSE:RDDT 1D` | 1 | stop-limit | same | T7 |
| Q-S1k | as S1, plus a `-v6` sibling | `NYSE:RDDT 1D` | 2 | relative against absolute exit levels (v5/v6), fractional ticks, an all-na modify | same | T7 |
| Q-S1l | as S1 | `NYSE:RDDT 1D` | 1 | an off-grid level: rounded or not | same | T1 |
| Q-S1m | as S1 | `NYSE:RDDT 1D` | 1 | out-of-range trade index | same | T10 |
| Q-S1n | Q-S1-core at two loaded depths | `AMEX:SPY 1D` | 2 | the backtest start bar (B-START) | `runtime:strategy-start` | T1, T14 |
| Q-S1p-when | `s1-broker-core-when.pine` (v5 `when =`) | `NYSE:RDDT 1D` | 1 | v5 `when` (wall 6) | `runtime:strategy-option` | T1 |

**C. Rule pins: new W9 rows (all NEEDS_PROBE until T4-T13 write them)**

| row | probe (one small v5 strategy unless named) | chart | captures | settles | gates |
|---|---|---|---:|---|---|
| W9-D1 | `w9-d1-v6-defaults.pine` (v6, no properties: margin 100, leverage) plus `-margin50` (margin_long = 50) | `NYSE:RDDT 1D` | 2 | v6 margin/leverage defaults; margin served at a stated value | T4 |
| W9-D2 | `w9-d2-currency.pine`: `currency = currency.USD` on a USD symbol | `NYSE:RDDT 1D` | 1 | identity currency (wall 3) | T4 |
| W9-K1 | `w9-k1-commission-pct.pine`: `commission_type = strategy.commission.percent, commission_value = 0.1`, trades of 1 and 7 units | `NYSE:RDDT 1D` | 1 | percent commission, entry and exit | T5 |
| W9-K2 | `w9-k2-commission-contract.pine`: `cash_per_contract`, 0.5 | `NYSE:RDDT 1D` | 1 | per-contract | T5 |
| W9-K3 | `w9-k3-commission-order.pine`: `cash_per_order`, 2 | `NYSE:RDDT 1D` | 1 | per-order | T5 |
| W9-K4 | `w9-k4-slippage.pine`: `slippage = 3`, a market, a stop and a limit order each way | `NYSE:RDDT 1D` | 1 | which orders slip, and which way (wall 12) | T5 |
| W9-P1 | `w9-p1-on-close.pine`: `process_orders_on_close = true`, market entries and `strategy.close` | `NYSE:RDDT 1D` | 1 | fill at the close | T6 |
| W9-P2 | `w9-p2-order-fills.pine`: `calc_on_order_fills = true`, a script that reads `position_size` and places a second order after a fill | `NYSE:RDDT 1D` | 1 | the re-run on history | T6 |
| W9-P3 | `w9-p3-every-tick-history.pine`: `calc_on_every_tick = true`, market closed | `NYSE:RDDT 1D` | 1 | `calc_on_every_tick` has no effect on history | T6 |
| W9-J1 | rides on Q-S1-core: the Properties read-back only | (as Q-S1-core) | 0 | the July-2026 defaults: Limit order execution, Order execution delay, Bar detalization | T6 |
| W9-X1 | `w9-x1-trail.pine`: `trail_points` + `trail_offset`; `trail_price` + `trail_offset` | `NYSE:RDDT 1D` | 1 | trailing exits (wall 9) | T7 |
| W9-X2 | `w9-x2-partial.pine`: `qty_percent = 50` take-profit plus a full stop; `strategy.close(qty_percent = 50)` | `NYSE:RDDT 1D` | 1 | partial and multi-level exits, partial close (walls 11, 13) | T7 |
| W9-X3 | `w9-x3-oca.pine`: two entries in `oca_name = "g"`, once with `strategy.oca.cancel` and once with `strategy.oca.reduce` | `NYSE:RDDT 1D` | 1 | OCA (wall 8) | T7 |
| W9-X4 | `w9-x4-order.pine`: `strategy.order` adds beyond `pyramiding`; `strategy.close_all(immediately = true)` | `NYSE:RDDT 1D` | 1 | `strategy.order`, immediately (walls 7, 19) | T7 |
| W9-R1 | `w9-r1-risk.pine`, three siblings: `-allow` (`allow_entry_in(strategy.direction.long)`), `-ddown` (`max_drawdown(5, strategy.percent_of_equity)`), `-intraday` (`max_intraday_loss`, `max_intraday_filled_orders`) | `NYSE:RDDT 1D`; `-intraday` on `AMEX:SPY 15` | 3 | `strategy.risk.*` (wall 5) | T8 |
| W9-M1 | Q-S1-core with `use_bar_magnifier = true`, against the same probe off | `AMEX:SPY 1D` (and `AMEX:SPY 60`) | 2 | which lower timeframe; the fill differences | T9 |
| W9-V1 | `w9-v1-values.pine`: plots every v6 `strategy.*` value outside S1's set, plus `position_entry_name` in a label | `NYSE:RDDT 1D` | 1 | wall 14 and T10's tail | T10 |
| W9-T1 | Q-S1-core's markers: `graphics()` and `properties().state()` of the strategy source (what `tv_capture` already reads), with entry and exit comments set | `NYSE:RDDT 1D` | 1 | marker presentation | T12 |
| W9-S1 | Q-S1-core: the report object (after T3) | `NYSE:RDDT 1D`, `AMEX:SPY 1D` | 2 | performance-summary formulas (drawdown, run-up, profit factor, buy and hold, average bars) | T13 |
| W9-S2 | `w9-s2-sharpe.pine`: a strategy with 24+ months of trades, `risk_free_rate` at its default and at 0 | `AMEX:SPY 1D` | 2 | Sharpe and Sortino period and risk-free handling | T13 |

**D. Live rows (attended, RTH; never batched)**

| row | probe | chart | captures | settles | gates |
|---|---|---|---:|---|---|
| Q-S1o | Q-S1-core with `calc_on_every_tick = true` | `AMEX:SPY 5` | 1 | forming-bar ticks | deferred |
| Q-S1p-live | Q-S1-core | `AMEX:SPY 5` | 1 | forming-bar outputs `na` or a value | deferred |

**E. Grading (after the pins it needs MATCH; local evidence for builtin and reference
populations per `LICENSING.md`)**

| row | scripts | chart | captures | purpose |
|---|---|---|---:|---|
| W9-G-builtin | the 23 TradingView built-in strategies at defaults | `AMEX:SPY 1D` | 23 | parity of the sizing-led batch (22 of 23 need wall 1) |
| W9-G-committed | the 25 committed strategies at defaults | `AMEX:SPY 1D` (or the script's own stated chart) | 25 | parity, committed |
| W9-G-reference | the 22 reference strategies | `AMEX:SPY 1D` | 22 | parity, reference |

**Size of the set:**

| block | captures |
|---|---:|
| B: S1 rule pins (non-live) | 26 |
| C: new rule pins | 25 |
| **rule pins total (batchable)** | **51** |
| D: live, attended | 2 |
| A: spike session | 1 (no fixture) |
| E: grading | 70 |

- At the evidence engine's pacing (30 s throttle, cap 40 per session), the 51 pins take about
  **2 sessions**, plus 1 short spike session.
- Grading takes 2 sessions, and runs only after the pins MATCH.
- The live rows need 1 attended RTH slot.
- **The first session should be:** W9-C0, Q-S1-core ×2, Q-S1a ×5, Q-S1b ×3 and W9-D2 (11
  captures). Those settle the core and walls 1 to 4, which reach 27 of the 40 only-W9 scripts in
  the greedy order.

---

## 6. What can run in parallel

"Region" means a function or line band at `646dca8cbf`, or a named function in a new file.

| task | owns |
|---|---|
| T0 | `tools/pine_coverage/coverage_map.py` `:358-373`, `:670-690`; `w0/targets.py` `:56`, `:189`; new test (no `app/src` engine file) |
| T1 | new `RT/broker.js`, `ast/strategyBroker.js`, `engine/strategyBrokerGate.js`; `RT/program.js` OP table tail; `RT/ir.js` EXPR table; `RT/lowerIr.js` (one case); `RT/vm.js` bar loop + one handler; FE `:8726-8750`; `Dockerfile.web` ARG; `docs/feature_flags.json` |
| T2 | new `RT/brokerPins.*`; `tools/vendor_harness/compare.mjs`, `evidence_engine.py` |
| T3 | `tools/vendor_harness/tv_capture.js`, `schema.mjs`, `verify_capture.mjs`, `adapters.mjs`, `batch_capture.py` |
| T4 | `ast/strategyBroker.js` defaults table; `RT/broker.js` sizing function |
| T5 | `RT/broker.js` cost step |
| T6 | `RT/vm.js` step order; `RT/broker.js` fill-timing branch |
| T7 | `RT/broker.js` exit and order handlers |
| T8 | `RT/broker.js` risk filter |
| T9 | `RT/broker.js` path source; runtime binding (lower-TF bars) |
| T10 | FE value lowering (beside T1's hook); `RT/broker.js` `BROKER_OPS` |
| T11 | `RT/runtimeColumns.js`, `RT/runtimeWorker.js`, `RT/limits.js` (one budget); `memberPaneDefinition.js` runtime path |
| T12 | new renderer primitive (chart components) |
| T13 | new `RT/brokerReport.js`; new report panel |
| T14 | W5 service files; `api/services/pine_runtime_codec.py`; new router; T15's `screener_backtest.py` descriptor path |
| T15 | `strategiesAreRuled.test.js` (comments); `strategy-broker-spec.md` |

**Conflicts that force an order:**

| pair | why | order |
|---|---|---|
| T1 → everything engine | creates the files | T1 first |
| T4 ⟂ T5 ⟂ T7 ⟂ T8 | all edit `RT/broker.js`, in different functions | merge one at a time and rebase. Suggested T4, T7, T5, T8 (the ranking order) |
| T6 ⟂ T9 | both edit `RT/vm.js`'s step order and the broker's path | T6 first |
| T10 ⟂ T4..T8 | `BROKER_OPS` against handlers: disjoint, but the same file | rebase, any order |
| T11 → T12, T13, T14 | the record schema | T11 first |
| T1 ⟂ W4 tasks | FE `:8700-8760` | no W4 task owns it today (W4-BREAKDOWN section 4); recheck at T1 start |
| T11 ⟂ W4 T12/T13 | `memberPaneDefinition.js` | different functions; merge in order |
| T14 ⟂ W5 T15 | `screener_backtest.py` | T14 after T15 merges |
| T0 ⟂ `fix/pine-w0-census-peel` | `coverage_map.py` | the peel first |
| T3 ⟂ E (evidence engine) | `batch_capture.py`, `evidence_engine.py` | E's owner reviews; merge after E's open PR |

**Batches** (at most 3 Opus or Fable agents at once; heavy jobs serialised through the lock):
- **Batch 1 (now, no capture needed):** T0, T1, T2 (against S1's ids), and T3's Create-new and
  Properties halves.
- **Batch 2 (after T1):** T11, T10 (S1-set values), T15 (after D7).
- **Batch 3 (as captures land, in the order of section 1):** T4 → T7 → T5 → T8 → T6. Then T12 and
  T13 once T11 is in. T13's metrics turn on as W9-S1/S2 pin.
- **After W5 T15 and the service deploy:** T14.
- **After D3 and W7.3:** T9.

---

## 7. How the numbers were taken

- **Population and census numbers:** `docs/pine/coverage-map.json` at master (measured 2026-11-02,
  `6272ed7fa3`) and `coverage-targets-2026-11-02.json`, read with read-only Python.
- **The 11-03 contrast (finding 4):** `git show
  origin/fix/pine-w0-census-peel:docs/pine/coverage-map.json` and `COVERAGE-MAP-2026-11-03.md`.
- **The wall ranking (section 1):** a static scan, 2026-11-05, over the 70 sources:
  - committed from `corpus/committed/`;
  - builtin and reference from the local licence-held sample cache
    (`_resume-2026-11-01/pine-sample/`), not committed;
  - `//` comments stripped;
  - the `strategy(` argument list parsed for each declaration property;
  - each `strategy.<name>(` call's argument list parsed for named arguments;
  - S1's rule set used as the "core".
  The greedy runs over the walls outside the core, preferring the rule that completes the most
  only-W9 scripts, then the most of the 70. The scan is a **heuristic over source text**, not the
  engine:
  - a positional argument that sets a level is not counted;
  - an argument from an input counts as "non-zero or input";
  - "no `from_entry`" is taken from the named form or the second positional string.
  T0's `strategyOn` lane replaces it with engine verdicts.
- **Prior-work status:** `git merge-base --is-ancestor` against `origin/master`:
  - `pine/c50-strategies`: on master;
  - `pine/r1-runtime-strategy`: on master;
  - `pine/s1-strategy-broker`: not on master;
  - `feat/pine-w5-t15-backtest`: not on master;
  - `fix/pine-w0-census-peel`: not on master.
- **The opcode collision:** `RT/program.js` OP table on master against S1's
  `case 97 /* OP.BROKER */` in `RT/vm.js`.

---

## 8. Decisions the owner must make

- **D1. Pin-before-serve for text-settled rules.** This design refuses even the 22 rules S1
  settled from TradingView's own documentation until a capture MATCHes (rule 2), as the brief
  asks. The alternative is to serve them dark from text and pin before arming. Recommendation:
  pin-before-serve. The first capture session pins most of them at once.
- **D2. What "matches TradingView" means when TradingView's window is not the listing.**
  TradingView backtests from the first bar it loaded, which depends on plan and history depth.
  We run from our first stored bar. Recommendation:
  - grade parity only where the capture's first bar equals ours (RDDT-style charts);
  - on long histories, the report states its own start date and Q-S1n decides whether any
    TradingView start is reproducible.
- **D3. Bar detalization (magnifier) data.** It needs lower-timeframe bars across the whole
  backtest. Do we hold or buy them (W7.3 data contract)? Until then T9 refuses by name.
  Recommendation: defer T9. Only one sample script (`hull-moving-average-crossover-strategy`)
  sets `use_bar_magnifier`.
- **D4. The rig account's plan.** Bar detalization and `calc_on_every_history_tick` are
  Premium-gated on TradingView. Which plan is the rig on, and may W9-M1 run on it?
- **D5. W9.4 product shape.** Choose:
  - a separate strategy-backtest route (recommended, section 3.4) or a mode of the screener
    backtest;
  - its URL and plan gate;
  - whether a member may backtest a strategy across many symbols (one record per symbol; the
    cost is `symbols × bars from listing`, capped like `max_cells()`).
- **D6. Arming.** The broker gate (`VITE_PINE_STRATEGY_BROKER_ENABLED`) is a build-time flag
  and needs a web build to flip. Arm per W2 stage (allowlisted strategies first, e.g. the
  built-ins whose pins MATCH), or all at once?
- **D7. The "strategies is a ruling" scorecard row.** It stays a ruling for the **screener**.
  Approve the wording that names the chart's strategy tester as W9 scope (T15).
- **D8. Report metrics TradingView computes from data we do not hold.** For example, "Buy and
  hold" over a window that differs from ours, or Sharpe needing a calendar of monthly returns.
  Show them refused by name, or leave them out of the panel? Recommendation: show the refusal,
  as everywhere else.

---

## 9. What I could not determine

1. **Where the strategy report lives in TradingView's chart model.** The property names of the
   trades, performance and equity object on the strategy data source are unknown. This is why
   W9-C0 exists. Whether it fills before the report panel is opened is also unknown. If it does
   not, the capture must open the panel through a CDP click on the rig page, which is still
   model-read and not pixels.
2. **Whether the strategy report's own "Export" is plan-gated**, as `chart.exportData()` is.
   This design does not depend on it.
3. **v6's default sizing.** S1 read percent-of-equity 100 from the v6 reference. 20 sample
   scripts depend on it, and no capture has confirmed it (Q-S1a).
4. **The July-2026 overhaul's exact semantics:**
   - the default and meaning of "Limit order execution";
   - the "Order execution delay" unit;
   - how leverage maps back to `margin_long` / `margin_short`.
   The User Manual text S1 extracted (2026-10-04) still uses the old names. W9-J1 and W9-D1
   settle the defaults only.
5. **Why the 11-03 peel measurement lost 17 strategies from the `[strategy]` bucket.** The
   inventory hypothesis in finding 4 is unverified. To check it, list `usage_of(src, inv)["items"]`
   for `ut-bot-strategy` under both reference files.
6. **Whether the local `bars.db` holds full-listing daily history** for the symbols a member
   would backtest (W9.4, B-START). It was not queried.
7. **The cost of a strategy run on the W5 service.** The broker's per-bar cost has not been
   measured. W5 T9's harness should add a strategy case before D5's multi-symbol shape is
   sized.
8. **Whether any of the 70 scripts' trades are affected by margin calls at their own
   defaults.** That shows only on a capture. W9-G rows that hit one refuse (Q-S1i).
9. **Whether S1's 247-line rail still passes once ported.** It was written against wave-18 FE.
   T1 finds out.
