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

| id | probe | chart | read | settles |
|---|---|---|---|---|
| Q-S1-core | `tools/visual_conformance/probes/s1-broker-core.pine` as written (v5, fixed size 3, `pyramiding = 2`, capital 100000, margin 0) | **NYSE:RDDT 1D**, full history from the listing (the run must start where ours does, B-START); then **AMEX:SPY 1D** (TradingView's loaded window will not start at the listing: the capture records where it did start, `window.firstBarTime`) | rows `N02`..`N14` every bar; the trades CSV | B-FILL, B-MARKET, B-PATH, B-GAP, B-PYR, B-REVERSE, B-MODIFY, B-CLOSE, B-EXIT-*, B-FIFO (pyramid adds closed by one exit), B-VAL — every row must equal our run of the same file to the cent; a row that differs names the rule that is wrong |

## Probes for the unsettled rules

Chart for every row of this table unless the row names its own: NYSE:RDDT 1D (the table header says so; added
2026-11-08 so the queue reads it).

| id | probe (one small strategy each; v5 unless named; NYSE:RDDT 1D) | read | settles |
|---|---|---|---|
| Q-S1a | `vw-s1-q-s1a-v4.pine`, `vw-s1-q-s1a-v6.pine`, `vw-s1-q-s1a-v5pct.pine`, `vw-s1-q-s1a-v5cash.pine` (one file per run): `strategy("q", overlay=false)` then one market `strategy.entry("L", strategy.long)` on `bar_index == 50` and `strategy.close("L")` on 80; rows `strategy.position_size`, `strategy.opentrades.size(0)` when open. Run it **four times**: header `//@version=4` (no size declared), `//@version=6` (no size declared), v5 + `default_qty_type = strategy.percent_of_equity, default_qty_value = 100, initial_capital = 100000`, v5 + `default_qty_type = strategy.cash, default_qty_value = 10000` | the size on the fill bar (51) and bar 79; trades CSV "contracts" | v4's unstated fixed value; v6's percent-of-equity default; which price sizes a percent / cash order (bar 50's close vs bar 51's open) and how it rounds (whole shares or fractions) |
| Q-S1b | `vw-s1-q-s1b-v4.pine`, `vw-s1-q-s1b-v5.pine`, `vw-s1-q-s1b-v6.pine` (one file per run): `strategy("q")` with no properties, rows `strategy.initial_capital`, `strategy.equity` on bar 0, three times: `//@version=4`, `=5`, `=6` | the two numbers | the per-version defaults (100000 / 1000000 / 100000) |
| Q-S1c | find a bar with `open - low == high - open` (`plot(open - low == high - open ? 1 : 0)` on SPY 1D and RDDT 1D first, pick one), place `strategy.entry("L", strategy.long, limit = <bar's low>)` and `strategy.exit("x", "L", limit = <bar's high>)` the bar before | trades CSV: does the entry and the exit both fill on that bar? | the path on a tie |
| Q-S1d | `vw-s1-q-s1d-close-reverse.pine`, `vw-s1-q-s1d-two-entries.pine`, `vw-s1-q-s1d-two-stops.pine` (one file per shape): on one bar: an open long, `strategy.close("L")` and `strategy.entry("S", strategy.short, qty = 2)`; on another bar: two `strategy.entry` market orders with different ids, `pyramiding = 2`; and two `strategy.exit` stops at the same price for two trades with different ids | trades CSV order and sizes; `strategy.position_size` the next bar | same-tick fill order |
| Q-S1e | `vw-s1-q-s1e-stop-past.pine`: `strategy.entry("L", strategy.long)` with `strategy.exit("x", "L", stop = close * 1.02)` on the same bar (a stop ABOVE the market for a long, already past at activation) | the exit's fill bar and price | an exit live past its level |
| Q-S1f | `vw-s1-q-s1f-exit-no-from.pine`: an exit with NO `from_entry` (`strategy.exit("x", loss = 500)`) called on one bar only, then a reversal `strategy.entry("S", strategy.short)` a few bars later | does `x` fill against the short trade? (trades CSV) | does a reversal end it |
| Q-S1g | `vw-s1-q-s1g-blocked-stop-entry.pine`: `pyramiding = 1`; an open long, then `strategy.entry("L2", strategy.long, stop = close * 1.01)` | does L2 ever fill after the first trade closes? | blocked price entry: cancelled or kept |
| Q-S1h | `vw-s1-q-s1h-fifo-exit.pine`: `pyramiding = 2`, "A" then "B" entries of 5 and 10, `strategy.exit("x", "B", stop = ...)` | trades CSV split | the FIFO split (the manual's own example) |
| Q-S1i | `vw-s1-q-s1i-funds.pine` (AMEX:SPY 1D): v6 defaults, `strategy.entry("L", strategy.long, qty = 5000)` on SPY | trades CSV: rejected? margin-call rows? | insufficient funds / margin call |
| Q-S1j | `vw-s1-q-s1j-stop-limit.pine`: `strategy.entry("L", strategy.long, stop = high + 1, limit = high)` | fill bar and price | stop-limit |
| Q-S1k | `vw-s1-q-s1k-profit-and-limit.pine`, `vw-s1-q-s1k-fractional-profit.pine`, `vw-s1-q-s1k-na-modify.pine` (one file per part): `strategy.exit("x", "L", profit = 100, limit = <a price 50 ticks away>)`; `strategy.exit("y", "L", profit = 150.5)`; an exit re-called with `stop = na` after one with a level | which level filled; fill price; did the waiting order survive | relative vs absolute; fractional ticks; all-na modify |
| Q-S1l | `vw-s1-q-s1l-off-grid-stop.pine`: `strategy.exit("x", "L", stop = close * 0.97)` (an off-grid level) | the fill price in the trades CSV, to every decimal | is an off-grid fill rounded to the tick |
| Q-S1m | `vw-s1-q-s1m-index.pine`: `plot(strategy.opentrades.entry_price(5))` with one trade open | the row | out-of-range index |
| Q-S1n | `s1-broker-core.pine` (Q-S1-core) on **AMEX:SPY 1D** at two different loaded depths (scroll back once and capture again) | do the rows differ between the two | the backtest start bar |
| Q-S1o | `vw-s1-core-every-tick.pine`: Q-S1-core with `calc_on_every_tick = true`, during RTH on SPY 5 | the forming bar's rows | realtime ticks |
| Q-S1p | `vw-s1-core-when.pine` (NYSE:RDDT 1D): Q-S1-core's v5 `when` form (`strategy.entry("L", strategy.long, when = up)`), and Q-S1-core during RTH on SPY 5: the rows on the **forming** bar | `when` placed / not placed; forming-bar rows `na` or a value | B-WHEN on v5; B-EXEC on a forming bar |

## Already committed, re-read for S1 (R1's Q-S1a/b)

`r1-strategy-draws-rddt-1d-2026-10-02` and `r1-strategy-draws-indicator-rddt-1d-2026-10-02` are R1's
strategy / indicator pair. They witness C50/R1 (a strategy draws its plots like an indicator) and
were graded in S1 (triage doc, section S1); they read no broker value.

## Not capture questions (queue dispositions, 2026-11-08)

Disposed of by the 2026-11-08 capture-queue hygiene pass (`fix/pine-capture-queue-hygiene`, r1 after review
`dsk/reviews/QUEUE-HYGIENE.md`): the W9 design (`docs/pine/W9-STRATEGY-DESIGN.md` 5.2 B) re-specifies each row
below with a generated `w9-*` probe under the same row id that asks the same question, and that row is the capture.
**Not disposed, and still queued with their own files:** Q-S1-core and Q-S1n (their probe is the W9 rows' own
`s1-broker-core.pine`); Q-S1d (a close and a reversal on one bar, two same-direction entries, two stops at one
price; the W9 probe asks only opposite entries); Q-S1k (profit and limit both given, fractional ticks, an all-`na`
modify; the W9 probes ask only `profit`/`loss` ticks); Q-S1e (an exit placed on the entry's own bar, so it
ACTIVATES already past its level; the W9 probe places it while a position is open, which is B-IMMEDIATE); Q-S1g (a
price entry pending AT the pyramiding limit; the W9 probe never leaves one pending there); Q-S1h (an exit that
names a non-oldest trade, the manual's example; the W9 probe closes the oldest and spills); Q-S1j (the served
stop-limit, limit BELOW the stop; the W9 probe asks the refused limit-beyond-stop case). Each asks what no W9
probe asks, so it stays until a lane folds it into `w9_probes.py` or disposes of it with a reason.

| not a capture | disposition | reason |
|---|---|---|
| Q-S1a | superseded | W9 design 5.2 B re-specifies Q-S1a with generated probes; `capture-queue-2026-11-05-w9.md` Q-S1a (`w9-q-s1a-size-v4/v6/v5pct/v5cash/v2.pine`, NYSE:RDDT 1D) asks the same per-version default sizing and adds v2. The vw-s1 files were never captured |
| Q-S1b | superseded | the same per-version capital defaults are `capture-queue-2026-11-05-w9.md` Q-S1b (`w9-q-s1b-defaults-v4/v5/v6.pine`), which also reads pyramiding and the reversal |
| Q-S1c | superseded | this row never had a probe; `capture-queue-2026-11-05-w9.md` Q-S1c is its probe (`w9-q-s1c-tie.pine`) |
| Q-S1f | superseded | a reversal against an exit with no from_entry: `capture-queue-2026-11-05-w9.md` Q-S1f (`w9-q-s1f-reversal-exit.pine`) |
| Q-S1i | superseded | margin call, deferred by the W9 design: `capture-queue-2026-11-05-w9.md` Q-S1i (`w9-q-s1i-funds.pine`, NYSE:RDDT 1D) is the row; this SPY copy is not taken |
| Q-S1l | superseded | off-grid fill rounding: `capture-queue-2026-11-05-w9.md` Q-S1l (`w9-q-s1l-off-grid.pine`), which also plots the price in mintick units |
| Q-S1m | superseded | an out-of-range trade index: `capture-queue-2026-11-05-w9.md` Q-S1m (`w9-q-s1m-index.pine`) |
| Q-S1o | superseded | realtime ticks on AMEX:SPY 5: `capture-queue-2026-11-05-w9.md` Q-S1o (`w9-q-s1o-every-tick.pine`, section D, live) |
| Q-S1p | superseded | split in `capture-queue-2026-11-05-w9.md`: the v5 `when` half is Q-S1p (`w9-q-s1p-when.pine`, history), the forming-bar half is Q-S1p-live (`s1-broker-core.pine` on AMEX:SPY 5, live) |
