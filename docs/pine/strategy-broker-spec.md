# Strategy broker spec (S1, 2026-10-05)

What TradingView's **broker emulator** does with a `strategy()` script's orders, written down
from TradingView's own text, rule by rule, so that `app/src/components/chart/engine/runtime/broker.js`
can serve exactly the rules the text settles and refuse the rest by name. Owner goal: a strategy
draws "exactly like TradingView", so the broker is TradingView's, not one we invent.

Implementation: `runtime/broker.js` (the emulator), `ast/strategyBroker.js` (declaration and order
arguments), `ast/pineRuntimeFrontend.js` (broker mode, S1 markers), `runtime/vm.js` (`OP.BROKER`, fills
before each bar). Gate: `VITE_PINE_STRATEGY_BROKER_ENABLED` (`engine/strategyBrokerGate.js`), DARK.
Probes for every unsettled rule: `docs/pine/capture-queue-2026-10-05-s1.md`.

## Sources (authority only)

| tag | source | how it was read |
|---|---|---|
| **R4 / R5 / R6** | Pine Script v4 / v5 / v6 **Language Reference** | Extracted 2026-10-04 with the recipe in `docs/pine/pine-reference-extraction.md` (script verbatim into scratch). The recipe's final assembly failed (`a.t is not a function`): TradingView renamed the i18n helper module from `982245` to `383636`; adding that id to the stub made the extraction complete (v6 1,940,474 B, v5 1,822,364 B, v4 529,528 B; loader bundle `63275.fb0f1a3948135aaf4bd5.js`, v6 data chunk `42609.5cfad5ccc2c189932b0a.js`). Every quote below is a reference string verbatim. |
| **M** | Pine Script **User Manual**, "Strategies" page, `https://www.tradingview.com/pine-script-docs/concepts/strategies/` | Fetched 2026-10-04 (HTTP 200, 84,651 B gzip), tags stripped. Section names are the page's own headings. |
| **CAP** | committed vendor captures, `tests/fixtures/vendor/harness/` | 18 captures of 9 `strategy()` scripts. **None plots a broker value** and none carries Strategy Tester data (trades list, net profit): they witness that strategies DRAW like indicators (C50/R1), not any broker rule. No broker rule below is settled by a capture. |

Where the reference and the manual disagree, the rule is **unsettled** (both quoted).

## Settled rules (served)

| id | rule | source |
|---|---|---|
| **B-EXEC** | A default strategy executes once per **closed** bar, history and realtime alike; on an open (forming) bar it has not executed. Served: the VM does not run a broker program on a forming bar (its outputs there are `na`), and `calc_on_every_tick = true` on a forming bar refuses. | M "Altering calculation behavior": "Unless otherwise specified, a strategy script executes strictly once per closed bar, regardless of whether a bar is part of the historical dataset or a new bar from the realtime data feed. If the current bar is open, the strategy waits until the bar closes before updating calculations or placing new orders." R6 `calc_on_every_tick`: "If false, the strategy executes only on the closing tick of each bar". |
| **B-FILL** | Orders placed when the script runs on bar *t* (its close) fill from the **next bar's open** onward; the fills of bar *t+1* happen before the script runs on *t+1*, so broker values the script reads on *t+1* include them. | M "Orders and trades": "By default, the earliest point at which the broker emulator fills an order is on the next available tick ... the next tick on which an order can fill is at the open of the following bar." M "process_orders_on_close": "If the value is false (the default), the earliest point at which the emulator can fill orders created on a bar's closing tick is on the next tick, at the open of the following bar." M "Using strategy information": the stop-loss "one bar after the entry order because it uses strategy.position_avg_price". |
| **B-MARKET** | A market order (no `limit`, no `stop`) fills at the next bar's **open**. `strategy.close` / `strategy.close_all` are market orders. | R5 `strategy.entry`: "it creates a market order that executes on the next tick." M "Market orders": "the broker emulator fills each new order at the open of the following bar." M "strategy.close() and strategy.close_all()": "these commands generate market orders that the broker emulator fills on the next available tick, irrespective of the price." |
| **B-PATH** | Inside a historical bar the price is assumed to move open → high → low → close if the open is closer to the high, open → low → high → close if closer to the low; any price in the range is fillable (no gaps inside a bar). Price orders fill **at their level** where the path reaches it (limit at level or better, stop at level or worse; along a continuous path that is the level). | M "Broker emulator": "If the opening price of a bar is closer to the high than it is to the low, the emulator assumes that the market price moved in this order: open → high → low → close. If ... closer to the low ... open → low → high → close." "When filling price-based orders ... the emulator assumes that no gaps exist inside each chart bar". |
| **B-GAP** | A price order whose level is crossed between one bar's close and the next bar's open fills at that **open**. | M "Broker emulator": "the emulator fills the order at the opening price of the bar following the gap." |
| **B-IMMEDIATE** | A limit placed at a worse price than the market (or a stop at a better one) fills on the next tick - here the next open - "rather than waiting". Served while that open still satisfies the order; otherwise refused (Q-S1e). | M "Limit orders": "When a strategy generates a limit order at a worse value than the current market price ..., the emulator fills the order on the next available tick rather than waiting". M "Stop and stop-limit orders": "If a strategy generates a stop order at a better value than the current market price, it activates the subsequent order without waiting". |
| **B-PYR** | `strategy.entry` orders obey pyramiding: at the limit of open trades in one direction, a further entry in that direction does not execute. Pyramiding 0 and 1 both allow exactly one entry (the reference and the manual name different default numbers for the same behaviour). | R6 `pyramiding`: "If the value is 0, only one entry order in the same direction can be opened, and additional entry orders are rejected ... The default is 0." M "Pyramiding": "The default argument is 1, meaning the strategy can open new positions but cannot add to them ... After the number of open trades ... reaches the pyramiding limit, the strategy does not execute new orders". |
| **B-REVERSE** | An entry against the open position closes the whole position and opens the new size, on one fill. | R5 `strategy.entry`: "if there is an open long position of five shares, an order from this command with a qty of 5 and a direction of strategy.short triggers the sale of 10 shares to close the long position and open a new five-share short position." M "Reversing positions". |
| **B-MODIFY** | An unfilled order with the same id is modified, not duplicated (entry, exit). | R5 `strategy.entry`: "If an unfilled order with the same id exists, a call to this command modifies that order." R5 `strategy.exit`: "If unfilled exit orders with the same id exist, calls to this command modify those orders." |
| **B-CLOSE** | `strategy.close(id)` closes every open trade with that entry id; with none open when it is called, it has no effect. `strategy.close_all()` closes the whole position; with no position, no effect. | R4 `strategy.close`: "If there are no open entries with the specified ID by the moment the command is triggered, the command will not come into effect." R5: "If multiple entries in the position share the same ID, the orders from this command apply to all those entries". M: "Although the script calls strategy.close_all() on every bar, the function creates a new exit order only if the strategy has an open position." |
| **B-EXIT-BIND** | `strategy.exit(id, from_entry, ...)` places a take-profit (`limit` price, or `profit` ticks from the entry price) and/or a stop-loss (`stop` price, or `loss` ticks) for each open trade with entry id `from_entry` at the call, and waits for an unfilled entry with that id; without `from_entry` it covers every open trade **and later ones** until the position closes. The first leg reached fills; the other is cancelled. Exits become live from the trade's fill tick (same bar as the entry fill). | R5 `strategy.exit` (desc, `from_entry`, `profit`, `loss`, remarks): "If the call does not include a from_entry argument, it creates exit orders for all open trades, even the ones opened after the call, until the position closes." "If a call to this command occurs before a created entry order's execution, the strategy waits". M "Partial and multi-level exits": "If a strategy.exit() call generates more than one exit order type for an entry ID, the strategy fills only the first triggered one and automatically cancels the others." M "Adjusting historical bar detail" (MSFT example): the exit fills on the entry's bar when the path reaches it. |
| **B-EXIT-LIFE** | An exit without `from_entry` ends when the position closes; one with `from_entry` ends when its trades are closed. | as B-EXIT-BIND; R4 `strategy.exit`: "If the function strategy.exit is called once, it exits a position only once." |
| **B-EXIT-NA** | An exit call whose every level is `na`, with no exit of that id waiting, places nothing. | R4 `strategy.exit`: "If all the following parameters 'profit', 'limit', 'loss', 'stop', 'trail_points', 'trail_offset' are 'NaN', the command will fail." TradingView's own sample (`stop-loss-and-take-profit-in-example`, corpus, by adolgov) calls such an exit on every flat bar and runs, so "fail" places no order rather than stopping the script. Confirm: Q-S1k. |
| **B-FIFO** | Exits close the **oldest** open trades first (`close_entries_rule = "FIFO"`, the default). Served when the targeted trades ARE the oldest; any other case refuses (Q-S1h). | R5 `strategy.close` remarks: "a strategy.close call exits from the position starting with the first open trade. This behavior applies even if the id value is the entry ID of different open trades." M "Closing a market position". |
| **B-QTY** | An order's size is its `qty`; `qty = na` takes the declaration's default. Fixed: the declared or documented value (v4's unstated value is taken as 1, a hypothesis). **W9-T4:** cash and percent-of-equity are sized when the order is placed, from the signal bar's close: cash `floor(value / (close x pointvalue))`, percent `floor(equity x value / 100 / (close x pointvalue))`, `equity` = `strategy.equity` at that close. This is a HYPOTHESIS (no text states the price or the rounding), unpinned until Q-S1a MATCHes; a price entry, a percent order with trades open, a percent above 100 and a size under one unit refuse (Q-S1a). | R5 `strategy.entry` `qty`: "The default is na, which means that the command uses the default_qty_type and default_qty_value parameters". M "Position sizing". |
| **B-DEFAULTS** | Declaration defaults **per Pine version, from that version's reference**: v4 - `default_qty_type` fixed ("fixed quantity by default", no value stated), `initial_capital` 100000, `margin_long/short` 100; v5 - fixed, `default_qty_value` 1, `initial_capital` 1000000, margin 0; v6 - percent_of_equity, value 100, `initial_capital` 100000, margin 100. Commission, slippage 0 everywhere; `process_orders_on_close` false; `close_entries_rule` "FIFO". | R4/R5/R6 `strategy()` argument texts (e.g. R5 `initial_capital`: "The default is 1000000."; R6: "The default is 100000."; R5 `margin_long`: "The default is 0"; R6: "The default is 100"). M "Commission": "If not specified, the strategy applies no commission". The version split is the reference's; Q-S1b confirms it on the chart. |
| **B-DECL** | A declaration property is served only at a value whose effect is settled: `pyramiding`, fixed `default_qty_*`, `initial_capital`, `margin_*`, `calc_on_every_tick` (history), and the defaults of `process_orders_on_close` (false), `calc_on_order_fills` (false), `use_bar_magnifier` (false), `backtest_fill_limits_assumption` 0, `calc_bars_count` 0, `close_entries_rule` "FIFO", `currency` NONE. Presentation properties are read past. Anything else refuses `runtime:strategy-option`. W9-T5: `commission_type`, `commission_value` (a non-negative literal) and `slippage` (a non-negative whole number of ticks) are READ; a non-zero cost asks its own rule when a fill pays it (section "W9-T5"). | R4/R5/R6 `strategy()`. |
| **B-SIG** | Positional order arguments follow the version's own signature (v4 `strategy.entry(id, long, qty, limit, stop, oca_name, oca_type, comment, when, alert_message)`; v5/v6 `strategy.entry(id, direction, qty, limit, stop, oca_name, oca_type, comment, alert_message, disable_alert)`, and likewise for exit / close / close_all / cancel / cancel_all). Labels (`comment*`, `alert*`, `disable_alert`) change no value. | R4/R5/R6 `syntax` lines. |
| **B-WHEN** | `when` (v4, and still compiled by v5): "The order is placed if condition is 'true'. If condition is 'false', nothing happens (the previously placed order with the same ID is not cancelled)." v6 has no `when` (refused). | R4 `strategy.entry/exit/close` `when`. The v5 reference no longer lists it; Q-S1p confirms v5. |
| **B-DIR** | v4 `long` takes `true` / `strategy.long` for long and `false` / `strategy.short` for short; v5/v6 `direction` takes `strategy.long` / `strategy.short`. | R4 `strategy.entry` `long`; R5 `direction`. |
| **B-VAL** | `position_size` = signed sum of open sizes; `position_avg_price` = size-weighted entry price, `na` when flat; `opentrades` / `closedtrades` counts; `wintrades` / `losstrades` / `eventrades` = closed trades with profit > / < / = 0; `netprofit` = sum of closed profits; `grossprofit` / `grossloss` = sums of the winning / losing closed profits (`grossloss` as a positive amount, the manual's profit factor `grossprofit / grossloss`); `openprofit` = unrealised P/L at the bar's close; `equity` = `initial_capital + netprofit + openprofit`; `netprofit_percent` = netprofit / initial_capital × 100. Currency values are price × size × `syminfo.pointvalue`. `opentrades.size(i)` / `closedtrades.size(i)` are signed. | R6 variable texts (e.g. `strategy.position_avg_price`: "Average entry price of current market position. If the market position is flat, 'NaN' is returned."; `strategy.equity`: "Current equity (strategy.initial_capital + strategy.netprofit + strategy.openprofit)."; `strategy.netprofit_percent`: "...expressed as a percentage of the initial capital"). M "Using strategy information in scripts" (page "Strategies", `https://www.tradingview.com/pine-script-docs/concepts/strategies/`), profit factor verbatim: "the profit factor (the ratio of the gross profit to the gross loss)", computed there as `strategy.grossprofit / strategy.grossloss` (quoted from the live page by the W9-T13a review, 2026-11-08; it is the script-side ratio, equal to the Tester's when commission is 0). |
| **B-MARGIN** | The emulator margin-calls (or cannot fund) a position when Available Funds = Equity − MVS × Margin Ratio falls below zero. Not modelled: any bar where it **could** happen (checked at the bar's worst price for the position, and at every entry fill) refuses (Q-S1i). | M "Margin and leverage" (the algorithm, verbatim steps). R6 `margin_short`: "even with no margin used, short positions *can* be margin called if the loss exceeds available funds." |
| **B-START** | A backtest is path dependent; TradingView runs it from the first bar it loaded. Served only on a run that starts at the symbol's listing (the member door already demands this of every runtime FALLBACK document, `runtimeHistory: 'listing'`); otherwise refused (Q-S1n). | M "Strategy report" / "Broker emulator" (fills on "the available chart data"); RT1's R-W ruling for this lane. |

## Unsettled (refused by name; probe queued)

Each is a `runtime:strategy-unsettled` stop at the bar the run reaches it (only scripts that reach
it stop), or a `runtime:strategy-option` / `runtime:strategy-value` refusal at build.

| probe | rule left open | why open |
|---|---|---|
| Q-S1a | default size other than a stated fixed one: v4 `default_qty_value` unstated; v6 / explicit `strategy.percent_of_equity`, `strategy.cash` (which price sizes it, what rounding) | the references state no value / no formula |
| Q-S1b | the per-version defaults of B-DEFAULTS on the chart (v5's 1,000,000 vs v4/v6's 100,000; v5 margin 0) | reference only, never witnessed |
| Q-S1c | a bar whose open is exactly half-way between high and low, with a price order in range | M names "closer to the high" / "closer to the low" only |
| Q-S1d | two or more orders filling on one tick (a close and an entry placed on one bar; two price orders at one level) | the fill order is not stated |
| Q-S1e | an exit that becomes live already past its level; an immediate order whose next open moved back | "next available tick" for a price already past is not stated |
| Q-S1f | does a reversal end an exit with no `from_entry` ("until the position closes")? | not stated |
| Q-S1g | a price entry triggered at the pyramiding limit: cancelled or kept? | not stated |
| Q-S1h | an exit whose targets are not the oldest trades (FIFO split) | the split is described, not specified |
| Q-S1i | margin call / insufficient funds | liquidation is specified but not modelled here |
| Q-S1j | stop-limit entries | not served |
| Q-S1k | `strategy.exit` with both `profit` and `limit` (or `loss` and `stop`); a tick distance that is not a whole number; an exit re-called with every level `na` while waiting; re-bound to another `from_entry` | R5: "The command ignores this parameter if the limit value is not na" vs M: "it creates orders only at the levels expected to trigger exits first" |
| Q-S1l | a fill at a price off the tick grid (an absolute level like `close * 0.97`): rounded or not? | not stated; served values that do not depend on such a fill are still served |
| Q-S1m | `strategy.opentrades.*(i)` / `closedtrades.*(i)` outside the range | R6 states `na` only for `entry_id` |
| Q-S1n | a run that does not start at the listing | the backtest start bar differs |
| Q-S1o | `calc_on_every_tick = true` with a forming bar | realtime ticks |
| Q-S1p | v5 `when`; a strategy's outputs on the forming bar | B-WHEN carried from R4; B-EXEC from M only |

Not served at all (refused by name at build, `runtime:strategy-option` / `runtime:strategy-value`):
`strategy.risk.max_intraday_loss` / `max_cons_loss_days` / `max_position_size` and every `strategy.risk.*` call that is not v6, top-level and literal (W9-T8 reads the other three, section "W9-T8"), a `strategy.exit` `oca_name` (W9-X3),
bar magnifier, `calc_on_every_history_tick = true`, `backtest_fill_limits_assumption` other than 0 (W9-T6 made `process_orders_on_close` and `calc_on_order_fills` READ: each refuses at run time by its rule until pinned; W9-T7 made `strategy.order`, `trail_*`, partial `qty` / `qty_percent`, entry / order OCA groups and `immediately` READ the same way), `close_entries_rule = "ANY"`,
an account currency, and every `strategy.*` value outside B-VAL (`max_drawdown`, `*_percent` but
`netprofit_percent`, `position_entry_name`, `avg_*`, `max_contracts_held_*`, the per-trade functions
other than `opentrades.entry_price / entry_bar_index / size` and `closedtrades.entry_price / exit_price
/ entry_bar_index / exit_bar_index / size / profit` and (W9-T5) `opentrades.commission` / `closedtrades.commission`).

## Pinned by (W9-T1; vocabulary: `runtime/brokerRules.js`, truth: `runtime/brokerPins.resolved.json`)

Every rule above serves only when `pinned(rule)` is true, asked when a run REACHES it. The committed ledger is empty at T1, so nothing serves; an unpinned rule stops the run `runtime:strategy-unpinned`, naming the rule and its row.

| rule | capture row (design 5.2) | what |
|---|---|---|
| B-EXEC | Q-S1p | a strategy executes once per closed bar; the forming bar is not executed |
| B-FILL | Q-S1-core | orders placed on bar t fill from the next bar, before the script runs on it |
| B-MARKET | Q-S1-core | a market order fills at the next bar open |
| B-PATH | Q-S1-core | the intrabar path open -> near extreme -> far extreme -> close |
| B-GAP | Q-S1-core | a level crossed between bars fills at the next open |
| B-IMMEDIATE | Q-S1e | a price order placed beyond the market fills on the next tick |
| B-PYR | Q-S1-core | pyramiding limits same-direction entries |
| B-REVERSE | Q-S1-core | an entry against the position closes it and opens the new size on one fill |
| B-MODIFY | Q-S1-core | an unfilled order with the same id is modified |
| B-CANCEL | W9-X5 | strategy.cancel / cancel_all remove unfilled orders (row W9-X5, `w9-x5-cancel.pine`, queued on origin/fix/pine-capture-queue-hygiene d1a6cb9fb3) |
| B-CLOSE | Q-S1-core | strategy.close / close_all |
| B-EXIT-BIND | Q-S1-core | strategy.exit binds a bracket to the trades of from_entry |
| B-EXIT-LIFE | Q-S1-core | how long an exit lives |
| B-EXIT-NA | Q-S1-core | an exit with every level na places nothing |
| B-FIFO | Q-S1-core | exits close the oldest trades first |
| B-MARGIN | Q-S1i | the margin check (a margin call is never modelled) |
| B-SIG | Q-S1-core | positional order arguments follow the Pine version's signature |
| B-WHEN | Q-S1p | the `when` argument (v4, and v5) |
| B-DIR | Q-S1-core | strategy.long / strategy.short (v4 `long`) as directions |
| B-QTY | Q-S1a | qty = na takes the declared default size |
| B-DEFAULTS | Q-S1b | the per-version declaration defaults |
| B-VAL | Q-S1-core | the strategy.* values and per-trade reads |
| B-POC | W9-P1 | (W9-T6) `process_orders_on_close`: a market order (entry, close, close_all) placed on bar t fills at t's close, after the script ran on t; the script reads it from t+1 |
| B-POC-PRICE | W9-P1 | (W9-T6) `process_orders_on_close`: a price order placed on bar t gets one attempt at t's close and fills there only if the close meets its level; otherwise it is live from the next open |
| B-POC-PYR | W9-P1 | (W9-T6) `process_orders_on_close` with pyramiding: a close fill that adds to the position |
| B-POC-FILLS | W9-P1b | (W9-T6) `process_orders_on_close` + `calc_on_order_fills`: a close fill re-runs the bar from its start state |
| B-FILLS | W9-P2 | (W9-T6) `calc_on_order_fills` on history: an extra execution on each fill tick (open, path level, extreme); OHLC hold the bar's final values; rolled back; its orders fill from the next tick |
| B-TICK-HIST | W9-P3 | (W9-T6) `calc_on_every_tick` on history: a historical bar executes once, on its close |

W9-T6 r1: the July-2026 Properties defaults (W9-J1) are not a rule. They are part of a precondition on EVERY pin fixture (r2, design 5.1): its settings read-back must show, for the six timing settings, exactly what its own source's `strategy()` declares and the R6 default for the rest (`evidence_engine.py::resolve_pins`, `settings_readback_ok`). Three of the timings above are hypotheses their capture rows grade: B-POC's fill AT the close price and B-FILLS' rollback and final-value prices rest on the User Manual, not on R6 (R6 says only that a market order is executed "before the next bar's open"); B-POC-PRICE's close attempt for every live order is the R6 reading ("an additional attempt to execute orders" names no subset).

| B-TRAIL | W9-X1 | (W9-T7) trailing stop: activation via `trail_price` / `trail_points` beyond the entry, then `trail_offset` ticks behind the best price on the intrabar path |
| B-EXIT-QTY | W9-X2 | (W9-T7) `strategy.exit` `qty` / `qty_percent` and several exit commands on one trade: call-order reservation; a fill closes the reserved part, and that exit id is done with the trade |
| B-CLOSE-QTY | W9-X2 | (W9-T7) `strategy.close` `qty` / `qty_percent`: closes that much of the id's trades, oldest first |
| B-OCA | W9-X3 | (W9-T7) `oca_name` / `oca_type` on `strategy.entry` / `strategy.order`: cancel or reduce the group's other unfilled orders |
| B-ORDER | W9-X4 | (W9-T7) `strategy.order`: no pyramiding limit; against the position it closes its size oldest first, never reverses |
| B-IMMEDIATELY | W9-X4 | (W9-T7) `close` / `close_all` `immediately = true`: filled at the bar close it is placed on |
| B-STOP-LIMIT | Q-S1j | (W9-T7) stop-limit entry / order: the stop places a limit at `limit` |
| B-EXIT-LEVELS | Q-S1k | (W9-T7) `profit` + `limit` (or `loss` + `stop`): v5 keeps the price, v6 the level reached first |
| B-COMM-PCT | W9-K1 | (W9-T5) `strategy.commission.percent`: each fill pays `commission_value` percent of its cash volume |
| B-COMM-CONTRACT | W9-K2 | (W9-T5) `strategy.commission.cash_per_contract`: each fill pays `commission_value` per contract |
| B-COMM-ORDER | W9-K3 | (W9-T5) `strategy.commission.cash_per_order`: each filled order pays `commission_value` |
| B-SLIPPAGE | W9-K4 | (W9-T5) `slippage` ticks: a market order fills that many ticks less favourably |
| B-POC-COST | W9-P1 | (W9-T5) under `process_orders_on_close`: a fill at the close pays its costs there, from the close |
| B-RISK-ALLOW | W9-R1 | (W9-T8) `strategy.risk.allow_entry_in`: a forbidden market `strategy.entry` closes the open position at its fill and opens nothing; flat, it fills nothing |
| B-RISK-DDOWN | W9-R1 | (W9-T8) `strategy.risk.max_drawdown` below its limit changes nothing (the limit possibly reached is a named refusal, not this rule) |
| B-RISK-INTRADAY-ORDERS | W9-R1i | (W9-T8) `strategy.risk.max_intraday_filled_orders` below its limit on every trading day changes nothing (the limit reached is a named refusal) |

## W9-T7: the exit family and the other order kinds (all unpinned)

Each rule is its own row so that pinning Q-S1-core (B-EXIT-BIND, B-CLOSE) never serves a trailing
stop or a partial exit. Text quoted from the v6 Language Reference (R6) unless named. **Everything
the text leaves open is either a HYPOTHESIS behind the rule above (served only once that rule is
pinned) or a named refusal.**

| rule | the reference says | HYPOTHESIS built (graded by the capture row) | refused by name |
|---|---|---|---|
| B-TRAIL | "A trailing stop order activates when the price moves `trail_points` ticks past the entry price or touches the `trail_price` level. Once activated, the stop follows `trail_offset` ticks behind the market price each time the trade's profit reaches a new high." `trail_offset`: "a trailing stop with an initial value `trail_offset` ticks away from that level" | on history the market price is the B-PATH path: the best ratchets to each point the path reaches (the open, then each segment's end), so a bar's favourable extreme moves the stop and the fall after it on the same bar can fill it; a gap through the activation level activates at the open (best = the open); the stop fills at its level, or at the open on a gap | half a trail (no offset, or no activation); `trail_price` and `trail_points` together ("the value expected to activate the stop first"); a stop-loss beside a trail ("places only the order that is supposed to fill first"); an activation not beyond the entry ("creates the trailing stop immediately", starting point unstated); offset or points not a positive whole number of ticks. All W9-X1 |
| B-EXIT-QTY | "Each call to this command reserves a portion of the position ... A second call can close a maximum of 30 contracts, even if its `qty` is 50 and one of its orders executes first." R4: "If the function strategy.exit is called once, it exits a position only once." | a call with no `qty` reserves the whole trade; each call reserves `min(wanted, size - what the other live exits on the trade reserve)`, recomputed on every call of that id; a reservation of 0 places nothing; once an exit id fills part of a trade it is never re-applied to that trade, even when re-called every bar. One full exit alone on a trade is S1's case and asks nothing new | a percent that is not a whole number of units; a partial size bound to more than one trade (per trade or in total); a reservation larger than the trade still holds when it fills. All W9-X2 |
| B-CLOSE-QTY | `qty`: "If specified, the command uses this value instead of `qty_percent`"; `qty_percent`: "The percentage calculation depends on the total size of the open trades with the `id` entry identifier"; remarks: FIFO "starting with the first open trade", "the maximum exit order size still depends on the trades opened by orders with the `id` identifier" | a `qty` above the id's total closes them all; filled at the next open as B-CLOSE | a non-whole percent, and two partial closes of one id on one bar (W9-X2); a closing walk that would reach a trade of another id first (Q-S1h) |
| B-OCA | `strategy.oca.cancel`: "cancels the unfilled order when another order with the same `oca_name` and `oca_type` executes"; `.reduce`: "reduces the unfilled order by that order's size ... reaches 0 ... the same as canceling"; `.none`: "executes independently"; `oca_name` "" = no group | a group is (name, type); the filled order's size reduces the others | `strategy.exit`'s `oca_name` (a reduce group across exit commands) at build, W9-X3 |
| B-ORDER | "not affected by the `pyramiding` parameter"; "does not automatically reverse ... an order from this command with a `qty` of 5 and a `direction` of strategy.short triggers the sale of five shares, which closes the position" | against the position it closes its size oldest first (B-FIFO) | an order larger than the position it meets (does the rest open the other side?); one id used by both `strategy.entry` and `strategy.order`. W9-X4 |
| B-IMMEDIATELY | "the closing order executes on the same tick when the strategy places it, ignoring the strategy properties that restrict execution to the opening tick of the following bar" | on a historical bar that tick is the bar close: filled at the close, stamped with that bar | a `strategy.*` value read later in the same execution (does it see the fill?), W9-X4 |
| B-STOP-LIMIT | "generates a limit order at the `limit` price only after the market price reaches the `stop` value or a worse price" | the limit is live from the stop's tick and fills at its level on the path | the stop already reached at the signal close, and a limit at or beyond the stop (does it fill on the stop's own tick, and where?). Q-S1j |
| B-EXIT-LEVELS | R5 `profit`: "The command ignores this parameter if the limit value is not na"; R6 `profit` / `loss`: "places a take-profit order only at the price level expected to trigger an exit first" | v5: the price wins; v6: the level nearer the entry on that leg's side | the pair in v4 (no v4 text read), Q-S1k |

**Two rulings on the merged T6 + T7 tree (coordinator, 2026-11-08):**
- Several FULL exit commands on one trade keep S1's behaviour (each fills if its level is reached first) while B-EXIT-QTY is unpinned; the reservation reading (a second full exit gets nothing) is taken only once B-EXIT-QTY is pinned. A partial size has no S1 behaviour and always asks B-EXIT-QTY.
  ⛔ **Pinning B-EXIT-QTY CHANGES what an already-served script does** (a second full exit stops filling),
  not only what was refused. Its pin landing therefore takes its OWN `SCRIPT_ENGINE_VERSION` bump (rule 7),
  never batched with a pin that only un-refuses, so the re-translation and the HP-1 digests move for exactly
  that change (integration review N3, 2026-11-08). The S1 behaviour it replaces is witnessed by capture row
  Q-S1-core-2x (`w9-q-s1core-two-exits.pine`, the second-called exit reached first), which joins Q-S1-core's
  fixtures for B-EXIT-BIND (integration review N2).
- The T7 kinds (trailing stop, partial exit or close, OCA, `strategy.order`, stop-limit, `immediately`) were built on the default timing only: under `process_orders_on_close` they stop by name (W9-P1), under `calc_on_order_fills` (W9-P2). No capture combines the two yet.

Left as they were (named refusals; their capture rows gate T7 per the design): Q-S1d (several orders on
one tick, now also an activation or a stop-limit trigger beside another order), Q-S1f (an exit with no
`from_entry` after a reversal), Q-S1g (a price entry at the pyramiding limit), Q-S1h (the FIFO split).
`B-CANCEL` now also cancels `strategy.order` orders and releases exits waiting on them. Its capture row is
W9-X5 (`w9-x5-cancel.pine`), queued on origin/fix/pine-capture-queue-hygiene d1a6cb9fb3 (W9-T5 r1 set the id).

B-START is not a pin rule: Q-S1n is a fact capture that pins nothing. A run is refused `runtime:strategy-start` unless it is told the history window (`bars_window.HISTORY_WINDOW_BARS`, via the run context) and holds no more bars than it.

## W9-T5: costs (all unpinned)

Design section 4 T5 ("the three commission types, slippage, and both at the close under
`process_orders_on_close`"), gated by capture rows W9-K1..K4 and W9-P1. One rule per capture row; the
probes are `tools/visual_conformance/probes/w9-k1-commission-pct.pine`, `-k2-commission-contract`,
`-k3-commission-order`, `-k4-slippage` and `w9-p1-on-close.pine`. Text quoted from the v6 Language
Reference (R6, `_w0-2026-11-02/ref/pine_v6_reference.json`) unless named. **Everything the text leaves open
is either a HYPOTHESIS behind its rule (served only once that rule is pinned) or a named refusal.** A zero
commission and a zero slippage change nothing: every figure keeps its pre-T5 expression (`costOn` /
`slipTicks` false), the census below shows it.

**One commission authority.** `brokerRules.js` `commissionRulesOf(commission)` decides what a figure that
reads a commission rests on: a zero commission, `[COMMISSION_RULE]` (B-DEFAULTS) exactly as before; a
non-zero one, its type's rule (`COMMISSION_TYPE_RULES`), plus B-DEFAULTS when `commission_type` is not
declared (R6 `commission_type`: "The default is strategy.commission.percent"). `broker.js` (the values, the
margin check, equity) and `brokerReport.js` (the report, from the record's `settings.commission`) both ask it.
`COMMISSION_NET_VALUES` gains `strategy.closedtrades.commission` and `strategy.opentrades.commission`.

| rule | the reference says | HYPOTHESIS built (graded by the capture row) | refused by name |
|---|---|---|---|
| B-COMM-PCT | `commission_type`: "strategy.commission.percent for a percentage of the cash volume of the order"; `strategy.commission.percent`: "A percentage of the cash volume of order"; `strategy.closedtrades.commission`: "Returns the sum of entry and exit fees paid in the closed trade"; `strategy.closedtrades.profit`: "reduced by the trade's commissions"; M "Commission" (the live page, 2026-11-08): "With this change, the broker emulator now applies a commission of 1% of the transaction size to each filled order by default." | the fee of a fill is size x fill price x pointvalue x value / 100, charged at the entry fill and at the exit fill, NOT rounded; with a commission, `grossprofit` / `grossloss` and win / loss / even classify and sum NET profits; an open trade's entry fee is paid, so it comes off `openprofit` and `equity` (its exit fee is not counted until it fills); a reversal's one fill charges each trade its own share (the fee is linear in size) | a cash or percent default size under a commission (whether the size allows for the fee); a T7 kind (partial size, `strategy.order`, OCA, trail, stop-limit, `immediately`) under a commission; a fee on a `calc_on_order_fills` extra execution's fill (W9-P2). All W9-K1 unless named |
| B-COMM-CONTRACT | `commission_type`: "strategy.commission.cash_per_contract for currency per contract" | the fee of a fill is size x value, at entry and at exit; the same net-profit readings as B-COMM-PCT | as B-COMM-PCT, row W9-K2 |
| B-COMM-ORDER | `commission_type`: "strategy.commission.cash_per_order for currency per order" | each filled order pays value once, at entry and at exit | ONE order that fills more than one trade (a reversal; a close of several open trades): how the one fee is divided is not stated, W9-K3; as B-COMM-PCT otherwise |
| B-SLIPPAGE | R6 `slippage`: "Slippage expressed in ticks. This value is added to or subtracted from the fill price of market/stop orders to make the fill price less favorable for the strategy. E.g., if syminfo.mintick is 0.01 and `slippage` is set to 5, a long market order will enter at 5 * 0.01 = 0.05 points above the actual price. This setting can also be changed in the strategy's "Settings/Properties" tab. Optional. The default is 0." M "Slippage" (the live page, 2026-11-08): "Because the strategy applies constant slippage to _all_ order fills, some orders can fill _outside_ the candle range in the simulation." | a MARKET fill (entry, close, close_all, a reversal) at an on-grid price moves `slippage` whole ticks against the strategy, a buy up and a sell down; the reversal's close and new trade share the one slipped price; a slipped price may lie outside the bar (the manual) | a STOP order's slippage (a stop entry, a stop-loss): R6 covers it but the W9-K4 probe fills market orders only; a LIMIT order's (a limit entry, a take-profit): R6 says "market/stop orders", the manual "_all_ order fills", so by this spec's own rule (the two disagree) it is unsettled (review W9-T5 B1); a market fill at a price off the tick grid (slipped before or after rounding?); a cash or percent default size under a slippage; a T7 kind under a slippage; a slippage on a `calc_on_order_fills` extra execution's fill (W9-P2). All W9-K4 unless named |
| B-POC-COST | (design T6: "costs are taken at the close") | under `process_orders_on_close` a fill at the close pays its fee and takes its slippage there, from the close price | as above |

Commission paid (the report, `brokerReport.js`): the sum of the closed trades' fees (each one the R6
`strategy.closedtrades.commission`). Served only while no open trade has paid a fee; otherwise refused by name
(`runtime:strategy-report-unstated`, W9-S1): whether the Strategy Tester counts an open trade's entry fee is
not stated. The record (`strategyRecord.js`) now carries `settings.commission` (`{ type, value,
typeDefaulted }`), `settings.slippage` and each trade's `commission` (closed: entry + exit; open: entry so far).

Evidence: `docs/pine/evidence/2026-11-08-w9-t5/` (the census harness; base `30e85eb877` against this lane).

## W9-T8: strategy.risk.* (all unpinned)

Design section 4 T8, gated by capture rows W9-R1 (`w9-r1-risk-allow.pine`, `w9-r1-risk-ddown.pine`, NYSE:RDDT 1D) and
W9-R1i (`w9-r1-risk-intraday.pine`, AMEX:SPY 15, schedulable only after the 15-minute depth read; D4 is not decided).
One rule per probe that CALLS its command. Text quoted from the v6 Language Reference (R6,
`_w0-2026-11-02/ref/pine_v6_reference.json`) and the User Manual (M, "Risk management", the live page
https://www.tradingview.com/pine-script-docs/concepts/strategies/#risk-management, fetched 2026-11-08, HTTP 200, the
section read verbatim from the HTML). **Everything the texts leave open is either a HYPOTHESIS behind its rule (served only
once that rule is pinned) or a named refusal. No halt (a limit reached: cancel, close, stop trading) is served anywhere:
no queued capture is known to reach one.**

**Read like the declaration, not run like an order** (`ast/strategyBroker.js` `readRiskCall`, into `program.broker.risk`).
M: "Strategies can incorporate any number of risk management criteria in any combination. All risk management commands
execute on every tick and order execution event, regardless of any changes to the strategy's calculation behavior. There is
no way to deactivate any of these commands on specific script executions. Irrespective of a risk management command's
location, the command always applies to the strategy unless the programmer removes the call from the code." R6 types every
argument `simple`. Served only in the shape every probe has: Pine v6, at the top level of the script, literal arguments,
one call per command (otherwise `runtime:strategy-option` at build, by name). Beside a risk command, `process_orders_on_close`,
`calc_on_order_fills`, a commission, a slippage and every T7 kind (`strategy.order` included) stop the run by name: no
capture combines them.

| rule | the texts say | HYPOTHESIS built (graded by the capture row) | refused by name |
|---|---|---|---|
| B-RISK-ALLOW | R6: "This function can be used to specify in which market direction the strategy.entry() function is allowed to open positions." R6 example: "Instead of opening a short position with 10 contracts, this command will close long entries." M: "This command overrides the market direction allowed for all calls to the strategy.entry() command. If a user specifies the trade direction with the strategy.risk.allow_entry_in() function (e.g., strategy.direction.long), the strategy enters trades only in that direction. If the script calls an entry command in the opposite direction of an open market position, the strategy generates a market order to close the position without entering a new trade in that direction." | the close is the forbidden entry's own market order, filled where and when the entry would have (the next open), closing every open trade (oldest first), labelled `B-RISK-ALLOW`; a forbidden entry with no position fills nothing; an allowed entry, and `strategy.direction.all`, change nothing | a forbidden PRICE entry (the probe places market entries only); `strategy.order` (both texts name strategy.entry only). All W9-R1 |
| B-RISK-DDOWN | R6: "The purpose of this rule is to determine maximum drawdown. The rule affects the whole strategy. Once the maximum drawdown value is reached, all pending orders are cancelled, all open positions are closed and no new orders can be placed." `value`: "The maximum drawdown value. It is specified either in money (base currency), or in percentage of maximum equity. For % of equity the range of allowed values is from 0 to 100." `type`: "Note: if equity drops down to zero or to a negative and the 'strategy.percent_of_equity' is specified, all pending orders are cancelled, all open positions are closed and no new orders can be placed for good." M: "This command cancels all pending orders, closes any open market position, and stops all additional trade actions after the strategy's drawdown reaches the amount specified in the function call." | below the limit the run is the run without the call | the limit possibly reached, by the WIDEST reading of the texts: equity with open profit at every extreme the path makes (each vertex, each fill level on the path), the peak from the initial capital, a percent taken of the initial capital (smaller than the maximum equity R6 names), reached at `>=`. The halt is never served. W9-R1 |
| B-RISK-INTRADAY-ORDERS | R6: "The purpose of this rule is to determine maximum number of filled orders per 1 day (per 1 bar, if chart resolution is higher than 1 day). The rule affects the whole strategy. Once the maximum number of filled orders is reached, all pending orders are cancelled, all open positions are closed and no new orders can be placed till the end of the current trading session." R6 example comment: "After 10 orders are filled, no more strategy orders will be placed (except for a market order to exit current open market position, if there is any)." M: "This command specifies the maximum number of filled orders per trading day (or per chart bar if the chart's timeframe is higher than "1D"). If the strategy fills more orders than the specified limit, the command cancels all pending orders, closes any open market position, and halts trading activity until the end of the current session." | below the limit on every trading day the run is the run without the call; the trading day of each bar is what the run context states (`ctx.tradingDays`) | a run not told each bar's trading day (the session and exchange time zone: no product caller states it, so on the member door it always refuses); a day whose count REACHES the limit (R6 "is reached" and M "fills more orders than the specified limit" disagree), each trade a fill opens or closes counted once (an upper bound: whether one order filling several trades counts once is not stated). W9-R1i |

Refused at build, not rules (no queued capture calls them; a pure hypothesis is not a rule):
- `strategy.risk.max_intraday_loss`: R6 "The maximum loss value allowed during a day. It is specified either in money (base
  currency), or in percentage of maximum intraday equity (0 -100)." The design names W9-R1i for "the intraday risk
  functions", but its probe calls only `max_intraday_filled_orders`. Follow-up: a probe that calls it (T3b).
- `strategy.risk.max_cons_loss_days`: R6 "The purpose of this rule is to cancel all pending orders, close all open positions
  and stop placing orders after a specified number of consecutive days with losses. The rule affects the whole strategy."
  No capture row (follow-up: a row and a probe, design 5.2).
- `strategy.risk.max_position_size`: R6 "The purpose of this rule is to determine maximum size of a market position. The rule
  affects the following function: strategy.entry(). The 'entry' quantity can be reduced (if needed) to such number of
  contracts/shares/lots/units, so the total position size doesn't exceed the value specified in
  'strategy.risk.max_position_size'. If minimum possible quantity still violates the rule, the order will not be placed."
  No capture row (follow-up as above).

Note on the W9-R1 drawdown probe (`max_drawdown(2, strategy.percent_of_equity)`, fixed size 1, v6 capital 100,000 on RDDT):
a 2% drawdown is 2,000, more than one share of RDDT can lose, so the capture can witness only the below-the-limit branch,
which is all B-RISK-DDOWN serves. A probe that reaches a limit is needed before any halt can be built.

Evidence: `docs/pine/evidence/2026-11-08-w9-t8/` (census; base `6b75450c5e` against this lane; mutants).

## W9-T7-F1: the order log and a trade's exit id (no new rule)

Coordinator ruling (2026-11-08, `strategyRecord.js` `STRATEGY_RECORD_UNSERVED`): T7 built the order kinds, not a log of
them. **F1 adds no emulator semantics and no rule.** The broker (`broker.js`, "THE ORDER LOG") now writes down what it
already does, after it decides: every log line asks no rule and cannot throw, and nothing a fill, a size, a price, a
refusal or a number value reads comes from the log. The census holds that (every lane byte-identical to the base,
`docs/pine/evidence/2026-11-09-w9-t7f1/`).

**The rows** (`record.orders`, one per order the broker held, in placement order, `n` from 1):
`{ n, kind, id, from, side, type, qty, qtyPercent, limit, stop, legs, oca, comment, commentRecorded, legComments,
placedTime, modifiedTime, triggerTime, status, why, endTime, fillTime, fillPrice, fillQty, rule, leg, opened, closed }`.
- `kind`: `entry` / `order` (one per order object; a [B-MODIFY] modification is the same row, `modifiedTime`); `close` /
  `close_all` (one per market close queued, or filled at once under `immediately`); `exit` (one per exit command AND trade
  it is bound to: the bracket it places for that trade, `type: 'bracket'`, `legs: { profit, loss, trailing }` as the levels
  stand). An exit waiting on an unfilled entry has no row yet (R6 `strategy.exit`: "the strategy waits and does not create the
  exit orders until after the entry order executes"); one that MAY cover the trade a reversal opened (Q-S1f) has none.
- `status`: `placed` (still live at `asOfBar`), `filled`, `cancelled` (`why`: `strategy.cancel`, `strategy.cancel_all`,
  `oca-cancel`, `oca-reduce`, `trade-closed`, `nothing-to-close`), `rejected` (`why`: `pyramiding`, [B-PYR] "does not
  execute"; `risk-allow-entry-in`, a forbidden entry with no position to close). `rule`: the fill's rule, as the trade's.
- `opened` / `closed`: the trade numbers the fill opened / closed. **One authority per link**: the broker stamps each trade
  with the row that opened it and each closed trade with the row that closed it; the rows' lists are derived from those.

**A trade's `exitId`** (`strategyRecord.js::exitIdOf`, the one rule the record and `strategy.closedtrades.exit_id` share):
the closing order's id where R6 states it is the exit id: an exit command (`strategy.exit` `id`: "corresponds to an exit ID
in the strategy's trades after an order fills") and `strategy.order` (`id`: "corresponds to an entry or exit ID"). Every
other closing order is named by TradingView itself and no text states the name (`strategy.close` / `close_all` `comment`:
"instead of the automatically generated exit identifier"; a reversing `strategy.entry` id is stated only as an ENTRY id;
the allow_entry_in close): `exitId` is `null`, and reading it refuses by name (W9-V1).

**Comments.** The front end (`ast/strategyBroker.js` `orderArgsOf`) hands the broker a `comment*` label only as a LITERAL
text; a computed one is not lowered (with the broker on, labels were never evaluated, and lowering one could refuse or charge
the run for a value no fill reads): it arrives as `na` and the row says `commentRecorded: false`. `''` is no comment (R6: "If
the value is not an empty string ..."). An exit's filled leg takes its `comment_profit` / `_loss` / `_trailing` when the call
passed one (R6 `comment`: "The command ignores this value if the call includes an argument for a `comment_*` parameter that
applies to the order"), else `comment`.

**The text values** (`BROKER_OPS`, `returns: 'string'`, each asking B-VAL like every per-trade read):
`strategy.opentrades.entry_id`, `.entry_comment`, `strategy.closedtrades.entry_id`, `.entry_comment`, `.exit_id`,
`.exit_comment`, all read off the log. Refused by name: an exit id TradingView generates (above, W9-V1); an order without a
comment (R6 returns `na` only "if there is no entry with this `trade_num`", so whether a missing comment reads `na` or `""`
is not stated, W9-V1); the exit comment of a reversed trade (whether the reversing entry's comment is it is not stated,
W9-V1, the ONE rule `strategyRecord.js::exitLabelUnstated`, which the report's exit signal and the marker label ask too:
r1, review N1); a computed comment (not kept).

**The label a fill shows** (`strategyRecord.js::orderLabelOf`, read by the markers (T12) and the report's trade list
(T13a/T13b)): the order's comment, else its id (R6, every command's `comment`: "the Strategy Tester and the chart show this
text for the order instead of" the id); `null`, and a named refusal, where the record does not know it. The markers still
refuse first by MK-LOOK (W9-MK1) on the member door.

Evidence: `docs/pine/evidence/2026-11-09-w9-t7f1/`.
