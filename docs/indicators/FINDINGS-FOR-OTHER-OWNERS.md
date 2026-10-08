# Findings for other workstreams (from the indicator release, 2026-10-08)

Documented, not fixed — neither is in Indicator-owned code.

## 1. React #185 ("Maximum update depth exceeded") under rapid typing — drill board

**Owner:** Breadth drill board / Watchlist (live-data components).

**Reproducer (production, market hours, live data):**
1. `/breadth` → click an *Up 4%+* cell → the drill board opens.
2. Chart settings → Indicators → Create Indicator.
3. Focus the composer and type ~50 characters in one uninterrupted burst (an automated
   `type`; e.g. `Create a table in the top-right showing RSI 14 and EMA 20.`).

**Observed:** 58 `keydown` / 58 `input` events reach the textarea, the console logs
`Minified React error #185` twice (stack: `CreateIndicatorPanel` `onChange` →
`scheduleUpdateOnFiber`), and ONE keystroke's update is lost (`andEMA`). At human speed
(~10 chars/s, chunked) nothing is lost and nothing is logged. Not reproducible locally
without live data (sandbox breadth, same drill board, same burst: 58/58, no error).

**Why it is not the panel:** the panel's `onChange` is a plain `setMessage`; #185 is thrown
wherever the nested-update counter trips, not where the loop lives. The **Watchlist** in the
same drill board threw the same #185 under keyboard pressure (`Watchlists-*.js` →
`BreadthDrillList`), which points at a live-updating component that schedules a sync update
on every commit while live quotes stream.

**Suggested next step for the owner:** reproduce in a dev build during market hours (the
unminified message names the component), or profile commits in the drill board while
typing quickly.

## 2. `breadth_drill_board.widgets[1].opts.settings` is a stale copy

**Owner:** chart-settings persistence / Breadth drill board.

The stored `breadth_drill_board` preference's `widgets[1].opts.settings.indicatorInstances`
still lists instances the member removed in the UI (a duplicate EMA 50, a scratch table)
and instances of definitions that were deleted. After a reload the drill chart does NOT draw
them, so the live settings come from elsewhere; this copy is misleading to anyone (or any
tool) that reads the stored blob as the chart's state. Harmless to members today.
No restructuring was done for this.
