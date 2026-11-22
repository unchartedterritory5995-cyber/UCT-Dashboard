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
| `AgentProvider.jsx` / `agentApp.js` | the APP-LEVEL host (W2-C1): one provider in App.jsx (admin + switch, dark otherwise) owning the panel on pages other than /charts, the open state and the cross-page handoff; `useAgentPageHost(surface, host)` is how a page hands its host in (/charts hands its own as `owned`) | no |
| `hosts/pageHosts.js` / `hosts/usePageAgentHosts.js` | each page's binding (screener, breadth, calendar, journal), built from the page's own hooks and doors; one hook call per page | page wiring |

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

### Args tolerance (W1.1 R-01, LT-3 — what the live planner actually sends)

The production planner's args for an action are often a recoverable VARIANT of its
schema (`{"key": "bgMode"}` for `setting`, `{"date": "exit"}`, a `{sort: {field, dir}}`
object for two flat args, a required list left out of a refinement). A capability may
declare, at registration, the variants it accepts — the manifest carries them, and the
server (`turn.normalize_args`) and the registry (`normalizeArgs`, run by every `planOps`)
apply exactly the same rules, log each rule by name and key (never a value), and never
guess: a shape no rule covers still fails `args_match` / `shapeError` as before.

```js
argAliases: { setting: ['key', 'id'] },           // other KEY names (dotted = nested: 'symbols.top': ['symbols.count', 'top'])
coerce:     { sort_dir: { descending: 'desc' } }, // VALUE synonyms for one arg (case-insensitive; a value may be null)
defaults:   { filters: [] },                      // a REQUIRED non-nullable arg the model left out or set null
defaultsWhen: { filters: { mode: ['refine'] } },  // the default ONLY when every named arg holds one of its values
shape:      '{"date":null} to exit replay…',       // ONE exact example, printed under the action's catalog line (≤ limits.maxShape)
```

Schema-driven rules every action gets without declaring anything: a string the schema
types as boolean / number / null (`"false"`, `"90%"`, `"null"`), enum case-folding, a
number whose text is an enum string (`15` → `"15"`), nested objects and `anyOf` branches
property by property, absent nullable args read as null. Keep declarations MINIMAL —
only shapes measured on the live model (tests/test_uct_agent_args_live_shapes.py replays
them); an alias that could change the meaning of a request is not an alias.

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

## Surfaces (W2-C1)

A capability's `surfaces` names the pages it is offered on. `['*']` = every page the Agent is mounted on:
QUERIES that read UCT's own data (stock.*, news.*, breadth.*, guide.*, agent.capabilities, screener.run / runSaved /
state / listSaved, app.open). A WRITE names its page (`['charts']`, `['screener']`, `['journal']`, …): it is offered
only where the page's own writer is on the host. `availableCapabilities(ctx)` filters on `ctx.surface` exactly as
before (`onSurface`), and the fast path claims no phrase of a capability not offered on the host's surface. The
golden manifest pins the Charts surface byte-for-byte.

## Rules that do not bend

- No capability without a deterministic writer the manual UI also uses.
- No DOM/browser control, no runtime discovery of internal state.
- `available(ctx)` must reflect what this member may do manually; server routes
  behind each writer remain the authority.
- Indicators are owned by Indicator Intelligence. The registry has exactly the
  two M1 capabilities they exposed seams for (`capabilities/indicators.js`):
  `indicator.list` (reads `agentSeams.instancesOf` only) and `indicator.openCreate`
  (the ChartPane opener with `seedFrom(request)`; offered only under
  `createIndicatorAccess`; never sends, never saves). No indicator WRITER and no
  pane capability until M2 (`docs/agent/M2-M3-PROPOSALS.md`); plan of record
  `docs/indicators/AGENT-INTEGRATION-HANDOFF.md` §11–13.
- Drawings go through the product's drawing store only (`drawingsStore` writers,
  by symbol + id); Undo is by id, never the store's shared undo; receipts wait for
  the server's `tracings_doc`. Anchored tools wait on PRODUCT-HANDOFFS §11.
- Unattended sessions follow `docs/agent/UNATTENDED-DEVELOPMENT.md` (no remote
  mutations; verify remote state before reporting).

## Decisions recorded

- **`widget.add` adds one widget per turn, only into empty space.** When
  placement would resize other widgets the product shows its own ghost preview
  and waits for the member; the Agent refuses and points to Widgets ▾ rather than
  moving widgets the member did not mention. Undo closes exactly the added widget
  through `handleRemoveWidget` (the manual ✕ path).
- **`widget.remove` shipped in Batch 5** through the board kind's one writer
  (`applyBoard`), whose Undo re-inserts the exact widget object (id, geometry,
  link colour, opts) — the "restore widget" operation this note used to ask for.
  (Until Batch 5 it was not shipped because no such writer existed.)
- **W1.1 repair-a (2026-11-03, live findings LT-1/3/9/10).** `bgMode` (Solid / Gradient,
  the dialog's own control) is an eligible `chart.setSetting` row, so "turn the gradient
  off" is a real setting instead of an id the model invents. On an EMPTY board a model
  plan that put chart ops on a non-chart target becomes one new chart on that symbol
  (`screenEmptyBoardChart`), and "add a daily chart of NVDA to this board" is the fast
  path's new chart. "rename <a protected layout> to …" is refused by NAME before any path
  (`protectedRenameRefusal`), listed or not. A keyboard-run message ("asdf qwer") is a
  server clarify with choices and no model call (`turn.looks_like_nonsense`).
- **`chart.setScale`** relies on StockChart clearing its local A/L/% override
  when the STORED scale changes (railed in `mobileScaleAndVolume.test.jsx`), and
  refuses non-percent while Compare overlays force percent.
