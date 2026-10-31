# Handoff to the UCT Agent: exact stored-state Undo (2026-10-30)

**From:** Indicators, WS3 (PR #517, branch `fix/indicators-exact-undo`).
**Answers:** `docs/agent/PHASE3-INDICATORS-HANDOFF.md` (branch `p3/ws2-workspace`, PR #518).

## What Indicators changed

The change is in `app/src/components/chart/builder/agentMutations.js` only. The call shapes and receipts are unchanged.

- **Undo of add, duplicate and copyFrom** no longer runs the remove writer. It leaves no tombstone and no
  `indicators.<defId>` mirror entry, and the instance id is free again.
- **`preset` is treated as a stamp.** Undo restores it only when the whole chart is then exactly as it was before the
  change. A change the member made since keeps `'custom'`. A preset applied since is kept, and it no longer blocks
  the Undo.
- **Restore point.** Every applied change now carries the settings it was made on. If an Undo arrives with **nothing
  changed since** (`stateFingerprint` of the `cs` handed to Undo equals the token's `stateFingerprintAfter`), those
  settings come back **verbatim**: byte-identical, key order included.
- **The Undo token gains three additive fields:** `stateFingerprintBefore`, `stateFingerprintAfter` and
  `restorePoint`. Tokens stay opaque, so keep holding them as returned.

## The one Agent-side change needed (not made by Indicators)

By default, the restore point is the `cs` the Agent hands to `applyIndicatorMutation`. Today that is the **effective**
settings (`snap.cs`, what the chart draws), not the **stored** pref (`snap.stored`). So:

- When a chart **stores no settings**, the Undo still writes the full effective blob. It cannot return "absent",
  because Indicators is never told the chart stored nothing.
- When a chart's stored blob is not in merged key order, Undo returns the merged form. It is equal, but not
  byte-identical to what was stored.

**Contract.** Pass the chart's stored pref to `applyIndicatorMutation` as an **own property** of `ctx`:
`ctx.storedSettings`. Use `null` when the chart stores nothing.

```js
// app/src/agent/capabilities/indicatorEdits.js, commit(), the apply call only
const step = patch.undo
  ? undoIndicatorMutation(cur.cs, patch.undo, ctx)
  : applyIndicatorMutation(cur.cs, patch.change.plan, { ...ctx, storedSettings: cur.stored ?? null })
```

`cur` is `host.charts.read(chartRef)`. `host.js` already exposes `stored` there.

**What then happens on Undo**, provided nothing changed since:

| Stored before the change | `undoIndicatorMutation` returns | Read-back that confirms it |
|---|---|---|
| `null` (stored nothing) | `{ ok: true, cs: null, pending }` | `confirmIndicatorMutation(null, pending, ctx)` → `confirmed` |
| a blob | `{ ok: true, cs: <that blob, verbatim>, pending }` | the usual read-back |

For the `null` case:

- **`cs: null` is the value to commit.** `ChartWidget`'s `agent.commit({ settings: null })` already stores exactly
  `null`, per its comment: "`settings` present (even null) means store exactly this blob".
- **`persistAndReadBack` needs no change.** It already returns `readBack: null` when `stored` is null, and a
  non-null read-back is answered `did-not-land`.

**If anything changed since the change** (a style edit, another indicator, a preset), Undo does not use the restore
point. It returns the exact merge: only what the change made is taken out, and the later change is kept.

## Tests for the Agent to add or tighten, once the line above lands

1. `agentAcceptanceP2.test.jsx` ("Undo takes it all back: the chart draws exactly what it did"): assert **stored**
   equality, `JSON.stringify(widget.opts.settings)` before vs after, not only drawn equality.
2. A board chart with **no** `opts.settings`: "add rsi", then "undo". Assert `opts.settings` is `null` or absent again,
   and that the receipt says the Undo was confirmed.
3. add → undo → add → undo through the panel harness: the stored settings are unchanged and the same id is reused
   (`inst:rsi:1`).
4. `board.js` `addedChartOpts`: the residue note can be removed.

Indicators-side coverage: `app/src/components/chart/builder/agentMutations.exactUndo.test.js`. Its handoff block is
"Agent Phase 3 handoff — byte-identical stored settings", one test per suggestion (1)–(5) plus (1b), (2b) and (2c).
