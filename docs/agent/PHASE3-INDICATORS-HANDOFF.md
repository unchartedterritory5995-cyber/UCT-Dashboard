# Handoff to Indicators: Undo of an indicator add leaves residue in stored chart settings

**From:** UCT Agent, Phase 3, Workstream 4A (2026-10-30). **Owner of the fix:** Indicators
(`app/src/components/chart/builder/agentMutations.js`, `undoIndicatorMutation`).

The Agent has not changed any Indicators file. It has not built a workaround that writes indicator state around the
mutation interface.

## What happens

The Agent adds an indicator through `planIndicatorMutation` → `applyIndicatorMutation` → `confirmIndicatorMutation`, and
undoes it through `undoIndicatorMutation` with the record the add returned. The chart then draws exactly what it drew
before. The stored settings (`widget.opts.settings`) are not what they were.

**Reproduction.** Use any chart and the Agent panel: "add rsi", then "undo". The same happens with "add the 9 ema", "make
it green", "undo", "undo". It reproduces on master through the Agent panel harness: `app/src/agent/testing/panelHarness`.

### A chart with stored settings

| Field | Before the add | After add → undo |
|---|---|---|
| `indicators.rsi` (the legacy per-def mirror) | absent | `{ "enabled": false }` |
| `indicatorInstances` | `[ovl:0 deleted, ovl:1 deleted, ovl:2 deleted, ovl:3 deleted]` | `[{"instanceId":"inst:rsi:1","deleted":true}, ovl:0…ovl:3 deleted]` (a tombstone for the undone add) |
| `preset` | `"classic"` | `"custom"` |

### A chart with NO stored settings (it draws the defaults)

| Field | Before | After add → undo |
|---|---|---|
| `opts.settings` | absent | the full default settings blob, plus the three rows above |

## Why

`undoIndicatorMutation`, `op === 'add'`, at about line 599 of `agentMutations.js`, takes back an add with
`removeInstanceWithRecord(view, id, registry)`. That is the REMOVE writer, so the undo leaves what a removal leaves:
- a deleted-instance tombstone;
- the legacy `indicators.<defId>.enabled = false` flag;
- the preset marked "custom".

On top of that, `normOf(cs)` writes a chart that stored nothing out as the full defaults.

The other undo ops restore their record exactly:
- `setInputs` and `setVisible` use `revert(view, undo.record)`;
- `remove` uses `restoreRemoved`.

`add` is the one that doesn't.

## Why it matters (measured in the Agent, Phase 3)

1. **Undo is not exact.** A member's stored chart differs after Add → Undo, and the "custom" preset label changes what
   the settings UI shows for the preset.

2. **It blocks other exact Undos that compare stored state.**
   - **Example:** "Make me a workspace with four daily charts for NVDA, AMD, AVGO and MU, and RSI beneath each chart",
     then "undo" × 5.
   - **What went wrong:** the grid's own Undo refused with "Board has changed since I made that change" once the RSI
     adds on the reused chart had been undone.
   - **The Agent's fix (owned and safe):** the grid's staleness check now covers only what the grid writes back on a
     reused chart: its cell, link, ticker and `opts.tf`. Phase 2 had already compared the charts the grid ADDED by what
     they draw.
   - **Still exposed:** any other exact comparison of stored settings meets the same residue.

3. **Repeated round trips accumulate tombstones.** add → undo → add → undo leaves one tombstone per round trip.

## What exact restoration should look like

After `undoIndicatorMutation` of an `add`, the stored settings should be byte-for-byte what they were before the add,
when nothing else changed in between (the group fingerprint already proves that):
- no tombstone for the undone instance;
- no new `indicators.<defId>` mirror entry;
- `preset` unchanged;
- a chart that stored no settings goes back to storing none (or to exactly the same stored value).

A suggested approach, Indicators' call:
- Record the pre-add value of each field the add wrote (`indicatorInstances`, `indicators.<defId>`, `preset`, and
  whether `settings` existed) in the add's undo record.
- On undo, revert those fields with the existing `revert(view, record)`, as `setInputs` and `setVisible` do.
- Keep the remove path for anything that changed since. The group fingerprint already refuses that case with
  `RESTORE_CONFLICT`.

## Regression tests we'd suggest (Indicators-side)

1. On a chart with stored settings, `apply(add rsi)` → `confirm` → `undo` gives `JSON.stringify(settings)` exactly as
   before. That includes the `preset`, `indicators` and `indicatorInstances` arrays.
2. The same on a chart with NO stored settings: `opts.settings` is absent (or exactly as before) after the undo.
3. add → undo → add → undo, twice over, leaves no tombstones and an unchanged preset.
4. Undoing an add after the instance was edited is still refused (`RESTORE_CONFLICT`), unchanged.
5. A moving-average add: "add the 9 ema", then undo. The overlays mirror is unchanged.

**Agent-side, once fixed:** the Agent tests that assert drawn equality after an indicator Undo can be tightened to stored
equality. They are in `agentAcceptanceP2.test.jsx` ("Undo takes it all back: the chart draws exactly what it did"), and
`board.js` `addedChartOpts` notes the residue. The Agent will not change them until Indicators ships the fix.
