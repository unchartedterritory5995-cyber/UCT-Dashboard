# exec-p1-gaps: Charts P1 gap rows (pl-exec)

Branch `agent/pl/exec-p1-gaps`. The Lead pushes from the main clone. Evidence for everything here is LOCAL / SIMULATED (BROWSER-MOCK-MODEL):
native Windows Node v24, jsdom, scripted plans through the real AgentPanel. Every batch committed its held-out phrasings
(`agentP1GapsHeldOut.test.js`) before any change, and they were never used to tune it.

## Rows

| Row | What | Kind of change | Rail |
|---|---|---|---|
| C1-025 | auto-scale one chart's price axis; a dragged log scale is refused; the refusal offers the walkthrough | capability + StockChart hook | agentP1Gaps |
| C1-035 | a whole compare group (theme / sector / industry) on one chart | capability args | agentP1Gaps |
| C1-036 / C1-038 | take one comparison off / clear them all, through Compare Symbols | tests only | agentP1Gaps |
| C1-080 | one chart theme on every chart | tests only | agentP1Gaps |
| C1-051 / 064 / 070 / 072 | crosshair, legend, event markers, prev-day lines, plus the whole family of on/off and mode settings (52 rows from the descriptor table) | tests only | agentP1GapsSettings |
| C1-007 | a custom timeframe already in the menu (no duplicate added) | tests only | agentP1GapsSettings |
| C1-076 | restore defaults (a proposal first; indicators kept; exact Undo) | tests only | agentP1GapsSettings |
| C1-094 | resize an indicator pane; refusals in percent ("between 4% and 90%") | small Agent-side check | agentP1GapsPanes |
| C1-104 | "toggle X": the chords' visibility rule over EVERY indicator (one-chart board, no model call; asked elsewhere) | fast phrases | agentP1GapsPanes |
| C1-144 | the Position Calculator's entry / stop / target | new capability + StockChart hook | agentP1GapsPosition |

## ⚠ Shared component: StockChart.jsx (C1-025, C1-144)

Both changes are additive. Nothing a member does by hand changes.

- **C1-025:** `getDateMeta` also reports `priceAuto` / `priceScale`, and `onDateNavApi` gains `autoScale` and `restoreScale`.
- **C1-144:**
  - `positionToolRef` mirrors the existing `positionTool` state so the long-lived `getDateMeta` closure can read it, the
    same way `activeToolRef` does.
  - `getDateMeta` also reports `position { open, entry, stop, target }`.
  - `onDateNavApi` gains `setPosition(arg)`, which fills the calculator's three inputs exactly as its own inputs do
    (strings, with `''` meaning empty) and opens or closes its toolbar tool (`activeTool === 'position'`). The same call
    is used for the Undo.
- **ChartPane.jsx:** the `viewDo` allow-list gains `autoScale`, `restoreScale` and `setPosition`.

**The retired Position DRAWING is never made.** `RETIRED_TYPES` keeps it un-placeable. The calculator is a view, so nothing is
saved. Its account size and risk % stay `chart.setSetting positionCalc.*`.

## Bytes

- Compact manifest:
  - C1-025: +58;
  - C1-144: +740 (the new action `chartSetup.setPosition`, in the lazy Agent chunk, not first-open);
  - every other row: 0.
- Routing: `chartSetup.setPosition` is in the chartSetup group, so the NL-1 core does not grow. The group's title gains
  "the Position Calculator (entry / stop / target)", plus one word rule: the calculator named, a trade said by its
  entry / stop / target, or "size a long / this trade".

## C1-144 behaviour

- **Done only on read-back:** the change counts only when the chart reads the calculator back OPEN with exactly those prices.
- **Undo:** puts the previous prices back, and closes the calculator again if it was closed. It is stale once the member
  edits the calculator.
- **Refused:** nothing is asked of the chart and the reason is said, for any of these:
  - a price not above zero;
  - entry = stop;
  - an entry not between stop and target (the panel would show the trade as INVALID);
  - a chart without the hook.
- **No-op:** if the calculator already shows those prices, the receipt says so and the chart is not asked.

## Still owed

- C1-144: regenerate capreg coverage and run the mutation checks on the C1-144 rail. Both are held while the #988 locked
  suite runs.
- One locked full suite on this branch, after C1-144 (cleared by the Lead).
