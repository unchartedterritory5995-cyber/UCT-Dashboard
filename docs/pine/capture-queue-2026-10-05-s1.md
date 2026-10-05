# Capture queue — 2026-10-05, S1 (the strategy broker)

Branch `pine/s1-strategy-broker` (base `integrate/wave18-2026-10-04`). The rules are in
`docs/pine/strategy-broker-spec.md`; every id below is named by the refusal a run stops with
(`runtime:strategy-unsettled`, "... (unsettled: Q-S1x, ...)"). Procedure: `docs/pine/VENDOR-HARNESS.md`
(visibility gate, **Create new ▸ Strategy** for a `strategy()` source, "Add to chart" binding gate,
`__uctVH.capture`), inputs at defaults, Strategy properties at the script's own defaults (do not
touch the Properties tab).

⭐ **Two readings per capture.** (1) the plotted rows, as for every probe; (2) the **Strategy
Tester ▸ List of trades** exported as CSV (Strategy Tester ▸ the export icon, "Export data") and
committed beside the capture JSON as `<capture-id>.trades.csv`: trade #, type, signal, date/time,
price, contracts, profit. The trades list is the broker's own ground truth; the plots witness that
the values a script reads equal it bar for bar.

No market hours needed: every row is read off historical bars of a closed market, except Q-S1o / the
forming-bar half of Q-S1p, which need a session in progress.

## Q-S1-core — the served rules, end to end (grades the broker)

| | |
|---|---|
| probe | `tools/visual_conformance/probes/s1-broker-core.pine` as written (v5, fixed size 3, `pyramiding = 2`, capital 100000, margin 0) |
| chart | **NYSE:RDDT 1D**, full history from the listing (the run must start where ours does, B-START); then **AMEX:SPY 1D** (TradingView's loaded window will not start at the listing: the capture records where it did start, `window.firstBarTime`) |
| read | rows `N02`..`N14` every bar; the trades CSV |
| settles | B-FILL, B-MARKET, B-PATH, B-GAP, B-PYR, B-REVERSE, B-MODIFY, B-CLOSE, B-EXIT-*, B-FIFO (pyramid adds closed by one exit), B-VAL — every row must equal our run of the same file to the cent; a row that differs names the rule that is wrong |

## Probes for the unsettled rules

| id | probe (one small strategy each; v5 unless named; NYSE:RDDT 1D) | read | settles |
|---|---|---|---|
| Q-S1a | `strategy("q", overlay=false)` then one market `strategy.entry("L", strategy.long)` on `bar_index == 50` and `strategy.close("L")` on 80; rows `strategy.position_size`, `strategy.opentrades.size(0)` when open. Run it **four times**: header `//@version=4` (no size declared), `//@version=6` (no size declared), v5 + `default_qty_type = strategy.percent_of_equity, default_qty_value = 100, initial_capital = 100000`, v5 + `default_qty_type = strategy.cash, default_qty_value = 10000` | the size on the fill bar (51) and bar 79; trades CSV "contracts" | v4's unstated fixed value; v6's percent-of-equity default; which price sizes a percent / cash order (bar 50's close vs bar 51's open) and how it rounds (whole shares or fractions) |
| Q-S1b | `strategy("q")` with no properties, rows `strategy.initial_capital`, `strategy.equity` on bar 0, three times: `//@version=4`, `=5`, `=6` | the two numbers | the per-version defaults (100000 / 1000000 / 100000) |
| Q-S1c | find a bar with `open - low == high - open` (`plot(open - low == high - open ? 1 : 0)` on SPY 1D and RDDT 1D first, pick one), place `strategy.entry("L", strategy.long, limit = <bar's low>)` and `strategy.exit("x", "L", limit = <bar's high>)` the bar before | trades CSV: does the entry and the exit both fill on that bar? | the path on a tie |
| Q-S1d | on one bar: an open long, `strategy.close("L")` and `strategy.entry("S", strategy.short, qty = 2)`; on another bar: two `strategy.entry` market orders with different ids, `pyramiding = 2`; and two `strategy.exit` stops at the same price for two trades with different ids | trades CSV order and sizes; `strategy.position_size` the next bar | same-tick fill order |
| Q-S1e | `strategy.entry("L", strategy.long)` with `strategy.exit("x", "L", stop = close * 1.02)` on the same bar (a stop ABOVE the market for a long, already past at activation) | the exit's fill bar and price | an exit live past its level |
| Q-S1f | an exit with NO `from_entry` (`strategy.exit("x", loss = 500)`) called on one bar only, then a reversal `strategy.entry("S", strategy.short)` a few bars later | does `x` fill against the short trade? (trades CSV) | does a reversal end it |
| Q-S1g | `pyramiding = 1`; an open long, then `strategy.entry("L2", strategy.long, stop = close * 1.01)` | does L2 ever fill after the first trade closes? | blocked price entry: cancelled or kept |
| Q-S1h | `pyramiding = 2`, "A" then "B" entries of 5 and 10, `strategy.exit("x", "B", stop = ...)` | trades CSV split | the FIFO split (the manual's own example) |
| Q-S1i | v6 defaults, `strategy.entry("L", strategy.long, qty = 5000)` on SPY | trades CSV: rejected? margin-call rows? | insufficient funds / margin call |
| Q-S1j | `strategy.entry("L", strategy.long, stop = high + 1, limit = high)` | fill bar and price | stop-limit |
| Q-S1k | `strategy.exit("x", "L", profit = 100, limit = <a price 50 ticks away>)`; `strategy.exit("y", "L", profit = 150.5)`; an exit re-called with `stop = na` after one with a level | which level filled; fill price; did the waiting order survive | relative vs absolute; fractional ticks; all-na modify |
| Q-S1l | `strategy.exit("x", "L", stop = close * 0.97)` (an off-grid level) | the fill price in the trades CSV, to every decimal | is an off-grid fill rounded to the tick |
| Q-S1m | `plot(strategy.opentrades.entry_price(5))` with one trade open | the row | out-of-range index |
| Q-S1n | Q-S1-core on **AMEX:SPY 1D** at two different loaded depths (scroll back once and capture again) | do the rows differ between the two | the backtest start bar |
| Q-S1o | Q-S1-core with `calc_on_every_tick = true`, during RTH on SPY 5 | the forming bar's rows | realtime ticks |
| Q-S1p | Q-S1-core's v5 `when` form (`strategy.entry("L", strategy.long, when = up)`), and Q-S1-core during RTH on SPY 5: the rows on the **forming** bar | `when` placed / not placed; forming-bar rows `na` or a value | B-WHEN on v5; B-EXEC on a forming bar |

## Already committed, re-read for S1 (R1's Q-S1a/b)

`r1-strategy-draws-rddt-1d-2026-10-02` and `r1-strategy-draws-indicator-rddt-1d-2026-10-02` are R1's
strategy / indicator pair. They witness C50/R1 (a strategy draws its plots like an indicator) and
were graded in S1 (triage doc, section S1); they read no broker value.
