# Indicators ⇄ UCT Agent — the two Phase 2.5 seams, landed (contract)

Answer to `docs/agent/handoffs/INDICATORS-HANDOFF.md` (`feat/agent-intelligence-p2` @ `679fd2328c`).
Branch `feat/indicators-agent-seams`, from master `f1c8b64017`. Local commits, not pushed:
`e309bf0d97` (parameterised add) and `29f7c890b6` (`dollar_vol_1d`). Nothing on the Agent branch
was edited.

## 1. Parameterised indicator add

### Interface (`app/src/components/chart/builder/agentMutations.js`, contract `uct.indicators.mutation/1` — unchanged id)

```js
planIndicatorMutation(cs, { op: 'add', defId, inputs: { key: value, … } }, ctx)
```

- `inputs` is OPTIONAL. Absent (or `null`): the add is byte-identical to before (declared defaults).
- Present: ONE write → ONE receipt → ONE Undo. The instance is made by `addInstance`, then every key is
  validated by `instanceControls.checkInstanceInput(def, key, value)` — the SAME rule the settings
  dialog's writer `setInstanceInput` now asks (declared key → coerced to the declared type → the
  definition's own `min`/`max`/`options` via `defSchema.validateInputValue`) — and written by
  `setInstanceInput`. Every requested setting lands or the whole add is refused; nothing is ever
  partly configured and no default is kept in place of a requested value.
- Re-checked at `applyIndicatorMutation` (a tampered plan is refused there too).

### Refusal

```js
{ ok: false, reason: 'bad-input',
  detail: { key: 'period', value: 0, why: '<the validator\'s sentence>',
            input: { key: 'period', type: 'int', label: 'Period', default: 5, min: 1, max: 500 } } }
```

`REASONS.BAD_INPUT === 'bad-input'`. `detail.input` is the declared spec, so the answer can say what IS
allowed. Unknown key → `why` is `"<Indicator> has no setting \"<key>\""`, `input: null`.

### Receipts, preview, read-back, Undo

- `plan.preview.name` is the configured instance's own label (`sourceRef.instanceLabel`), e.g. the
  "EMA 20" the legend shows; `plan.preview.inputs` the values as stored.
- `receipt.inputs` (confirmed add) = the values as STORED after coercion (`"7"` → `7`).
- The pending record's `indicatorInstances` leaf holds the new instance WITH its settings, so
  `confirmIndicatorMutation` is `did-not-land` if the read-back lacks any value.
- Undo of a configured add removes the instance (exact, as before). Permission (`canManage`,
  owned-definition rule) is unchanged.

### Discovery (`app/src/components/chart/indicatorCatalog.js`)

Every catalog row (`catalogRows`, `userCatalogRows`) now carries
`inputs: [{ key, type, label, default, min?, max?, step?, options?: [{value, label}] }]`, read off the
definition's own `inputs` (`instanceControls.inputSpecOf`). Supported types are the definition
schema's: `int`, `float`, `bool`, `string`, `enum` (with `options`), `color`, `source`.

### Examples (all pinned in `agentMutations.inputs.test.js`)

| member says | request |
|---|---|
| "Add a 20 EMA" | `{op:'add', defId:'movingAverage', inputs:{period:20, maType:'ema'}}` |
| "Add RSI with a length of 7" | `{op:'add', defId:'rsi', inputs:{period:7}}` |
| "Add a 200-period simple moving average" | `{op:'add', defId:'movingAverage', inputs:{period:200, maType:'sma'}}` |
| "MACD 8, 21, 5" | `{op:'add', defId:'macd', inputs:{fastPeriod:8, slowPeriod:21, signalPeriod:5}}` |
| "Add RSI" | `{op:'add', defId:'rsi'}` |
| "EMA 0" / "RSI 7.5" / an unknown option | refused `bad-input`, nothing created |

### Agent side (Agent-owned — NOT changed here)

`indicator.add` gains `inputs: [{key, value}] | null` (closed-schema-safe list) → converted to the
`{key: value}` object above; map the member's words onto `catalogRows(...).inputs` (the keys, the
enum `options[].value`s), never invented; surface `bad-input` with `detail.input`'s range/options; the
receipt's `inputs` are the values to read back to the member. The catalog payload grows by each row's
`inputs` — update any golden manifest the Agent pins on that read.

## 2. `dollar_vol_1d` — the latest completed session's dollar volume

### Registry decision

DECLARED as a scalar (`app/src/components/chart/engine/ast/closedTable.json`):

```json
"dollar_vol_1d": {
  "source": { "store": "screener_rows", "column": "dollar_vol_1d" },
  "as_of": { "column": "bars_asof", "grain": "date" },
  "cadence": "nightly", "yields": "num",
  "sentence": "the dollar volume traded in the latest completed session (its close times its volume)"
}
```

Not excluded: it is a number a formula can compare — none of `_scalars_excluded`'s reasons applies.
`as_of` is `bars_asof`, not `snapshot_date` (the handoff draft's guess): the value is computed in
`technicals.compute_technicals` inside `snapshot_builder`'s `if bars:` block, from the same newest bar
as `price` — the bar-derived family `_scalars_as_of` dates by `bars_asof`.

### Canonical definition (one calculation, the Screener's)

`dollar_vol_1d = round(close × volume, 2)` of the row's NEWEST daily bar (`bars_asof`): the same bar
`price` comes from. `None` — never 0 — when that bar has no volume or the close is not positive.
Written nightly by the snapshot build; not part of the live tier (`live_tier.LIVE_COLUMNS` does not
carry it), so during market hours it stays the snapshot's `bars_asof` session while `price` is
overlaid live. A stale row (its `bars_asof` sessions behind) keeps its value, dated by `bars_asof`,
like every other bar-derived column. Distinct from `dollar_vol_30d` (price × 30-day average volume),
which is unchanged.

### Freshness — the two systems name different sessions for a few hours

- Agent (`sessionMeasures` → `/api/agent/session-stats`): the newest session whose 16:00 ET close has
  passed — session T from 16:00 ET.
- Screener: the snapshot's `bars_asof` — session T only after the nightly rebuild; between 16:00 ET and
  the rebuild it is still T−1.

So: map the Agent's `dollar_volume_1d` onto `dollar_vol_1d` ONLY when the row's `bars_asof` equals the
session the Agent measured; otherwise keep stating which session each used (and, when saving a screen,
say the saved screen reads the snapshot's session). Do not claim the two lists are identical across
that window.

### Landing

Applied together on this branch: the closed-table entry AND the Agent's prepared Screener patch
(verbatim — diff checked identical). Either half alone turns both partition rails red
(`test_ast_scalars` partition, `test_scan_store` E1 manifest). Count pins 137 → 138 scalars and
268 → 269 names updated with their reasons; `docs/formulas/GRAMMAR.md` regenerated. After merge: a
nightly snapshot rebuild fills the column; until then it reads NULL on every row.

## Tests

- `agentMutations.inputs.test.js` 18 + `agentMutations.test.js` 31 pass.
- JS engine / builder / agent / pages: 33,716 pass; the six failing files fail identically on clean master.
- Python screener / ast / scan set: every remaining failure also fails on clean master (`3c4bcc7df3`).
