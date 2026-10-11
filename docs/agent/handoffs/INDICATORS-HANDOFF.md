# UCT Agent ⇄ Indicators — two integration seams (Phase 2.5)

Both changes sit on the Indicators side of an ownership line. The Agent branch
(`feat/agent-intelligence-p2`) does NOT modify any Indicators-owned file; it states what it needs and
what it will do once the Indicators side lands.

---

## 1. Parameterised indicator actions ("add a 20 EMA", "RSI 7", "the 50-day moving average")

**Today.** The Agent changes indicators only through the Indicators interface
`app/src/components/chart/builder/agentMutations.js`:
`MUTATION_OPS = ['add', 'remove', 'setVisible']`. `add` calls
`instanceControls.addInstance(view, defId, registry)` — DEFAULT inputs only (the Moving Average
default is a 5-period SMA). The Agent therefore refuses specific settings honestly (instant path never
matches them; `indicator.add`'s hint tells the model not to plan a default one as if it had them).

**The canonical writer already exists** — the Settings dialog's
`instanceControls.setInstanceInput(cs, instanceId, key, value, registry)`, which validates against
the definition's own declared inputs (`declaredInputs(def)`, `coerce`, `validateInputValue`) and mirrors
the legacy single-instance key.

**Needed from Indicators (`agentMutations.js` only):**

| | Change |
|---|---|
| Interface | either `add` accepting `inputs: {key: value}` (preferred — ONE write, ONE receipt, ONE Undo for "add a 20 EMA"), or a new op `setInputs {instanceId, inputs}` |
| Plan | after `addInstance`, apply each input through `setInstanceInput`; refuse (new reason, e.g. `BAD_INPUT`, with the input name and allowed range/values) if any key is undeclared or invalid — never silently drop one |
| Permission | `checkIndicatorPermission` unchanged (same `canManage` / owned-definition rules) |
| Confirm | `pending.record.paths` include each `inputs.<key>` so the read-back proves the values landed |
| Undo | `add` Undo already removes the instance; for `setInputs`, restore the previous values |
| Preview | `preview.name` from `instanceLabel(def, inst)` so receipts say "EMA 20", not "Moving Average" |
| Discovery | expose each definition's declared inputs (key, type, enum/min/max) to the Agent's catalog read (`indicatorCatalog`) so the model can map "20 EMA" → `movingAverage {period: 20, maType: 'ema'}` without guessing |

**Agent side, after that lands (Agent-owned, ~1 small change):** `indicator.add` gains
`inputs: [{key, value}] | null` (closed-schema-safe list), validated against the exposed declared
inputs before planning; hint updated; golden manifest + tests. No change to the planner, runtime,
receipts or Undo.

---

## 2. Latest-session dollar volume in the Screener (Agent ⇄ Screener parity)

**Today.** The Agent screens "trades over $10M a day" with a SCREEN MEASURE
(`app/src/agent/capabilities/sessionMeasures.js` → `POST /api/agent/session-stats`, the newest session
whose 16:00 ET close has passed, close × volume of that bar). The Screener has only `dollar_vol_30d` (a
30-day average), so a saved screen can't hold the condition: the Agent names it on the "Open in
Screener" link and REFUSES to save such a screen (never a broader one).

**Screener side (ready, tested, reverted):** `docs/agent/handoffs/dollar_vol_1d.screener.patch` —
three screener-owned files:
- `api/services/screener/snapshot_db.py` — `"dollar_vol_1d"` in `COLUMNS`
- `api/services/screener/technicals.py` — `compute_technicals` writes `dollar_vol_1d = close × volume`
  of the newest bar (the same bar as `price`; `None`, never 0, without volume); listed in `_SINGLE_BAR`
- `api/services/screener/filters.py` — `_open_range("dollar_vol_1d", "Dollar Volume (1 day)", "descriptive", "dollar_vol_1d", unit="$")`

**Why it is not applied — the exact seam.** Two partition rails require every screener column to be
DECLARED by the Indicators engine's closed table:
- `tests/test_ast_scalars.py::test_the_scalar_section_PARTITIONS_snapshot_db_COLUMNS_exactly`
- `tests/test_scan_store.py::test_the_screener_COLUMN_SET_still_partitions_into_E1s_frozen_manifest`

both reading `api/services/ast_table.py` (`scalar_names()` / `excluded_columns()`) over
`app/src/components/chart/engine/ast/closedTable.json`.

**Needed from Indicators (one decision, one entry in `closedTable.json`):** either a scalar, shaped like
`dollar_vol_30d`:

```json
"dollar_vol_1d": {
  "source": { "store": "screener_rows", "column": "dollar_vol_1d" },
  "as_of": { "column": "snapshot_date", "grain": "date" },
  "cadence": "nightly",
  "yields": "num",
  "sentence": "the dollar volume traded in the latest session"
}
```

or an entry in the excluded-columns section with its reason. (Whether the `as_of` should be
`bars_asof` rather than `snapshot_date` is the engine's call — the value is that bar's.)

**Order of landing:** Indicators' `closedTable.json` entry → apply the screener patch (both partition
rails then pass) → nightly snapshot rebuild → Agent: map its `dollar_volume_1d` measure to the screener
field when the snapshot carries it, so the link and a saved screen keep the condition.

**Freshness, stated:** the screener value is the snapshot's newest bar (nightly); the Agent's measure
is the newest session whose close has passed. Between 16:00 ET and the nightly rebuild they name
different sessions — the Agent should keep saying which session it used.
