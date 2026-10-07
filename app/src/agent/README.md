# UCT Agent — capability architecture

UCT Agent TALKS (answers, explains, researches) and DOES (operates UCT). It can
only DO what a **registered capability** allows. The model proposes; UCT
executes through the feature's own canonical writer, reads the result back
(ACK), writes a deterministic receipt, and offers Undo.

```
member text ─► fastPath (capability phrases) ─┐
          └──► /api/agent/turn (manifest + context) ─► envelope
                                                       answer | clarify | unsupported → nothing runs
                                                       apply | propose
                                                            ▼
              executor.planOps  (validate ALL, compose per target, receipt lines)
              policy.decideMode (capability risk / reversibility / breadth)
              runtime.commitPlan (kind.commit → read back → kind.landed) → Undo entry
```

## Files

| File | Role | Knows any feature? |
|---|---|---|
| `capabilities.js` | registry: capabilities, target kinds, context providers, manifest | no |
| `executor.js` / `policy.js` / `runtime.js` | plan, decide, commit/ACK/undo | no |
| `fastPath.js` | control words + capability-contributed phrases | no |
| `useAgent.js` / `AgentPanel.jsx` | conversation + UI | no |
| `api/services/uct_agent/turn.py` | model call; schema + action list built from the manifest | no |
| `capabilities/chart.js` | the chart target kind, context, 9 chart capabilities | charts only |
| `capabilities/workspace.js` | the workspace target kind, widget context, `widget.add` | widgets only |
| `builtins.js` | which capability modules load | one line per module |
| `host.js` | the Charts workspace's binding (chart adapters + visible board) | workspace wiring |

## Adding a capability to an existing target kind

Add one entry to the feature's capability module (e.g. `capabilities/chart.js`):

```js
registerCapability({
  name: 'chart.setSomething',            // stable id, dotted lowercase
  target: 'chart',                       // which target kind it acts on
  summary: 'What it does, one sentence.',
  hints: 'Optional value guidance for the model.',
  args: { type: 'object', properties: { value: { type: 'string', enum: ['a', 'b'] } },
          required: ['value'], additionalProperties: false },   // closed + all required
  risk: 'local',                         // 'confirm' → always proposed, never auto-applied
  reversible: true,                      // false → always proposed
  surfaces: ['charts'], available: (ctx) => /* entitlement / flag / role */ true,
  fast: ({ raw, lower, core }) => null,  // optional: obvious phrasing → args
  async prepare(ops) { return {} },      // optional: lookups before planning (env)
  check(state, args, env) { return null },          // null or a refusal sentence
  apply(state, args, env) { return nextState },     // PURE; same object = no-op
  describe(before, after, args, env) { return 'Changed …' }, // receipt, from state
  noop(before, after) { return 'Already …' },       // optional
})
```

`apply` must produce exactly what the feature's manual control writes (same
keys, same shapes). The chart kind then commits it through the widget's own
`onOptsChange` — the Agent never has its own copy of a feature's write logic.

**Nothing else changes**: the manifest the browser sends now includes it, the
server builds the model's schema and action list from that manifest, the
planner/policy/runtime/undo handle it generically.

## Adding a new feature (new target kind)

1. `registerTargetKind({ name, list, read, stateOf, patch, commit, landed, undoPatch, fingerprint })`
   — `commit` calls the feature's canonical operation; `landed` reads it back;
   `fingerprint` is the revision used for freshness and stale-undo refusal.
2. `registerContextProvider({ key, build(host, refFor) })` — a SMALL description
   of current targets (`refFor(kind, realRef)` mints the short refs the model uses).
3. Register its capabilities as above.
4. Expose the feature's canonical operations on the workspace host (`host.js`)
   if they live in a component (as charts do through `chartApiById`).
5. Add one line to `builtins.js`.

`agentCore.test.js` → "EXTENSIBILITY: example.setSomething" is the executable
proof of this path, and `tests/test_uct_agent.py` proves the server side needs
no change.

## Rules that do not bend

- No capability without a deterministic writer the manual UI also uses.
- No DOM/browser control, no runtime discovery of internal state.
- `available(ctx)` must reflect what this member may do manually; server routes
  behind each writer remain the authority.
- Indicators are owned by Indicator Intelligence; this registry has no
  `indicator.*` or pane capabilities until that project exposes them.

## Decisions recorded

- **`widget.add` adds one widget per turn, only into empty space.** When
  placement would resize other widgets the product shows its own ghost preview
  and waits for the member; the Agent refuses and points to Widgets ▾ rather than
  moving widgets the member did not mention. Undo closes exactly the added widget
  through `handleRemoveWidget` (the manual ✕ path).
- **`widget.remove` is not shipped.** Its undo would have to re-insert the exact
  widget (id, geometry, opts); the product has no canonical writer for that —
  re-adding mints a new id and re-places it. Smallest future fix: a workspace
  "restore widget" operation (insert a given widget object verbatim, through
  setLayout + scheduleSave, honouring the board bound) that the manual product can
  also use (e.g. an "undo close" toast), then register remove with it.
- **`chart.setScale`** relies on StockChart clearing its local A/L/% override
  when the STORED scale changes (railed in `mobileScaleAndVolume.test.jsx`), and
  refuses non-percent while Compare overlays force percent.
