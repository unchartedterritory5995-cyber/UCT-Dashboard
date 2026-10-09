# UCT Agent — Capability Contract (v1)

How UCT Agent comes to *know* a product feature, and when it may *do* it. This adopts the
2026-10-08 Charts audit, §F–G, and is implemented as of Batch 4.

## 1. Knowing ≠ doing

| Layer | What it is | Source | Executes? |
|---|---|---|---|
| **Discovery** | What UCT has, what it means, where it lives in the UI | product-owned registries and descriptor tables | **never** |
| **Execution** | What UCT Agent may change | an approved Agent capability (`registerCapability`) with a canonical writer, read-back, honest Undo metadata, and tests | yes, through the existing plan → policy → commit → read back → Undo pipeline |

**Default deny.** New product metadata never becomes executable by itself:
- A new chart setting arrives as **unclassified**, and the completeness rail fails CI until someone classifies it.
- Once classified as `known` it is *described* and *refused*.
- Only an `eligible` row (or a dedicated capability) can be written.

**Forbidden as substitutes for canonical writers:**
- UI clicking or DOM automation;
- unrestricted function invocation;
- model-generated code or URLs;
- raw DB or preference writes.

## 2. Product-owned descriptor tables

**Chart settings** (`app/src/components/chart/chartSettingsDescriptors.js`, v1, owned by Charts):

| `agent` | Meaning | Count (v1) |
|---|---|---|
| `eligible` | `chart.setSetting` may write it. Typed (`bool` / `enum`), validated, written with the Chart Settings dialog's exact shape (`withSetting`), including UI prerequisites (`requires`). | 23 |
| `specialized:<cap>` | Written only by a dedicated capability with its own rules (scale, session, theme, colours, volume…) | 18 |
| `owned:<team>` | Another project owns it. Today that is `owned:indicator`: instances, panes, overlays. | 8 |
| `known` | A real member setting the Agent describes but cannot change yet | 60 |
| `internal` | Bookkeeping or dead data | 5 |

**Rails** (`chartSettingsDescriptors.test.js`, `agentContracts.test.js`):
- Every key that `mergeChartSettings` keeps is classified (exact id, or a `section.*` row for free-form maps).
- An eligible write survives a reload, because the allow-list keeps it.
- The `chart.setSetting` enum equals exactly the eligible rows. No other row is offered.
- Every `specialized:<cap>` names a registered capability.
- The dialog's option lists (`COLOR_MODES`, `TITLE_MODES`, `TEXT_SIZES`, `SWING_SENS`, `EVENT_MARKERS`, `PDL_LINES`) are imported from the table. The dialog and the Agent read one list.

**Promoting a setting to `eligible` requires all of:**
1. its manual writer is a plain field set, or its side effects are reproduced by `withSetting`;
2. any UI prerequisite is expressed in `requires`;
3. it has a label, a section, a UI path and a type;
4. a UI-equivalence test.

**Other domains reuse what the product already has:**

| Domain | Registry |
|---|---|
| Widget types | `widgets/registry.js` |
| Indicators | `engine/defSchema` + `nativeRegistry` (read-only; owned by Indicator Intelligence) |
| Drawings | `drawingSettingsSchema.SCHEMA` |
| Screener fields | `/api/screener/fields` |
| Prefs | `auth.py _CLOSED_VALUES` |

When one of these domains needs execution, it gets the same treatment: an owner-approved classification plus a completeness rail.

## 3. Manifest wire contract v1

**Shared file:** `app/src/agent/contract/manifest.contract.json`.

**Version and entry keys:** manifest version 1. Each entry carries `args`, `domain`, `hints`, `name`, `query`, `reversible`, `risk`, `summary`, `target` and `undo`.

**Limits** (the server constants in `turn.py` must equal these):

| Limit | Value |
|---|---|
| Capabilities | 60 |
| Bytes per capability | 6000 |
| Summary | 400 |
| Hints | 1000 |
| Context bytes | 24000 |
| Ops per turn | 12 |
| Routing threshold | 55 |

**`reversible`** is a policy flag. `false` means the plan is always proposed, never auto-applied.

**`undo`** states what the receipt can honestly offer:
- `exact` means the target kind restores the change.
- `none` means no Undo exists. For example, navigation, or the email-digest switch, which carries an `undoNote` telling the member how to reverse it.
- A target kind marked `undoable: false` may not carry a capability that claims `exact`.

The server forwards both flags to the model as "no Undo" or "permanent -- no Undo". The prompt forbids implying an Undo that does not exist.

**Version skew:** the client sends `manifestVersion`. The server serves an unknown version and logs it; every op is re-validated in the browser anyway.

**Golden manifest:** `app/src/agent/contract/manifest.golden.json`.
- It is the exact Charts manifest. JS fails on any difference; regenerate it with `UPDATE_AGENT_GOLDEN=1` after review.
- `tests/test_uct_agent_contract.py` runs the same file through the server's real `validate_manifest` / `envelope_schema` / `system_prompt` / `args_match`, and checks it against server closed value sets: default timeframe, alert sounds, digest frequency.

**Product drift rails:**

| Agent enum | Must equal |
|---|---|
| chart types | `CHART_TYPE_OPTIONS` |
| timeframes | `NATIVE_TFS` (imported) |
| chart themes | `CHART_THEMES` |
| widget types | `WORKSPACE_MENU_TYPES` |
| default-timeframe options | `pages/Settings.jsx` `TF_OPTIONS` |
| settings sections | `pages/Settings.jsx` `SECTIONS` (source rail) |

The server's prompt may name only the reviewed capabilities `widget.addCharts` and `screener.run` (`tests/test_uct_agent.py`).

## 4. Scaling: relevance-routed manifests (ACTIVE since Batch 5)

**As built (`app/src/agent/routing.js`, `turn.validate_routing`):**
- Groups by capability domain: charts, workspace, lists, screener, alerts, data, settings, agent (always on).
- Selection is deterministic: the member's words, plus the groups of a pending proposal and of the last change. Nothing recognised → the full manifest while it fits the server limit; past the limit, the always-on groups with every other group named.
- The browser sends `routing: {version, groups: [{id, title}], selected}`. The server adds `need_groups` (enum of the withheld ids) to the schema and names the withheld groups in the prompt. If the model sets it, the server returns a plan with NO ops.
- The browser re-asks ONCE (`reroute: true`) with those groups added; the member message is not stored twice and the plumbing envelope is not stored. A second `need_groups` ends with an honest sentence. Nothing executes between the two calls.
- Every op is still validated against the FULL registry in the browser; routing changes only what the model sees.
- Telemetry: `path` = model | routed | reroute; `disposition` = need_groups. Kill switch: localStorage `uct.agent.routing = 0`.
- Rails: every registered capability belongs to exactly one group; the benchmark messages' routed manifests stay under `routingThreshold` (55).

### 4a. Three limits, not one (Batch 6)

| Limit | Value | Where | What it bounds |
|---|---|---|---|
| Registered (catalog) | `catalog.maxRegistered` = 200 | `manifest.contract.json`, `agentContracts.test.js` | everything the browser knows how to do |
| One group | `catalog.maxGroupSize` = 40 | same | so any single group (+ the agent group) always fits one request |
| Per request (server) | `limits.maxCapabilities` = 60 | `turn.MAX_CAPABILITIES` | what one model call may be shown — a request over it is **refused whole** ("sent too many actions for one request, so nothing was planned"), never trimmed |
| Routed budget | `routingThreshold` = 55 | `routing.js` `routeManifest(…, {limit, budget})` | what the browser actually sends |

**Packing** (`routeManifest`): groups go in priority order — always-on, a reroute's requested groups, the groups of a pending proposal and the last change, then the message's own groups (smallest first, so more of a multi-part request fits; when nothing is recognised, catalog order with charts first). A group that would overflow the budget is **not sent and is named** to the model, which can ask for it (`need_groups`). A group is never partially sent. If a reroute's group cannot fit either, the member is told "That touches too many parts of UCT for one request. Try asking for one part at a time." — nothing runs.

The **full** catalog is no longer a valid request once it passes 60 (70 after Batch 6): the kill switch (`uct.agent.routing=0`) still routes when the catalog is over the per-request limit.

### 4a′. The model-facing schema (overnight 2026-10-09)

A request of ≤ `STRICT_OP_VARIANTS_MAX` (10) actions embeds each action's own args schema in the structured-output format; a bigger one sends args as a JSON string (`compact_ops`). Routing made small requests common, which exposed a model-API rule: an `enum` under a UNION `type` (`["string","null"]`) is refused (400). `turn.model_safe_schema()` rewrites such nodes as `anyOf` of single-type enums (same values) in the schema the MODEL sees; validation of the answer still uses the capability's own args. Rail: `test_no_routed_request_sends_an_enum_under_a_union_type` (every routed group). Capability authors may keep writing `type: [T, 'null'] + enum`.

### 4a″. When the model API refuses an embedded schema (production fix 2026-10-09)

Beyond the enum rule above, the API refuses an embedded schema whose strict grammar compiles too large (measured: the 9-action screener group, `screener.run`'s condition objects). No static size or nesting rule separates it reliably (the lists group is also nested and compiles), so `run_turn` retries the FIRST call of a turn ONCE in the compact op shape when the refusal names the schema (*compiled grammar is too large* / *invalid schema*). Compact args are still checked against each capability's own schema (`args_match`); nothing else is retried; one turn, one charge; `usage.schema_fallback` marks it (`e3e48854df`).

### 4c. Drawings: what a receipt may claim

A drawing write lands in the product's drawing store at once, but reaches the member's account only through the tracings sync (a 1.5 s debounced push of `exportTracings()` into `tracings_doc`; no flush on tab close). The receipt and its Undo therefore wait for `host.drawings.confirm(symbol)` — the SERVER's copy of the active Drawing Board's drawings for that symbol equal to the local ones; otherwise the receipt says "not synced yet — keep this tab open" and offers no Undo (the same rule as an unconfirmed board save).

### 4b. Daily cap (Batch 6 Gate A)

`UCT_AGENT_DAILY_CAP` (300) counts `/api/agent/turn` requests per user per **America/New_York** day (`daily_counters`, key scope/subject/day). Refused requests are not counted; a failed model call gives its charge back; a research turn is one charge for its two model calls; a reroute is a second charge. The Batch 5 evening 429 was the cap genuinely reached during the benchmark; the apparent "00:02 ET" reading was a Git Bash clock without tzdata printing UTC. Pinned by `tests/test_uct_agent_daily_cap.py`. No cap or counter was changed.

**Original design notes (Batch 4):**

*(Historical — Batch 4. Superseded by §4a: the catalog may register 200, one request carries ≤ 60.)* The flat manifest was **51 / 60** after Batch 4. `agentContracts.test.js` fails above the **routing threshold of 55**. That forces this design to be activated instead of the server cap being raised. The owner rejected raising the cap.

**Design (activation deferred until it can be proven safe):**

1. **Always send a core set:** query capabilities (`*.list`, `*.state`, `agent.capabilities`) and the capabilities of every target kind present in the request's context.
2. **Domain index.** Each capability has a `domain`. The browser always sends a compact index, one line per domain with its title, to the model, plus the full schemas only for the selected domains.
3. **Selection.** Domains are chosen deterministically from:
   - the member's words, matched against each domain's vocabulary (shared with `discovery.js` topics);
   - the pending proposal's actions;
   - the last outcome's domains.

   Never a model call.
4. **Escape hatch for multi-intent or misses.** The envelope gains `need_domains: [..]`. If the model needs an unselected domain, it says so, and the browser **re-asks once** with those domains added. That costs one more metered turn, and the member sees no partial plan.
5. **Safety:** the browser re-validates every op against the *full* registry, so selection only affects what the model sees and never what is permitted.
6. **Gates before activation:**
   - a replay of the real-model benchmark with routing on shows no loss in first-pass success;
   - multi-intent cases (e.g. "screen → watchlist → charts → alert") stay first-pass;
   - the re-ask rate is measured.

## 5. Model routing (documented only; no change)

Production stays on `claude-haiku-4-5` (`UCT_AGENT_MODEL`) under `UCT_AGENT_DAILY_CAP`. A possible future complexity router would work like this:
- Deterministic signals (op count > 6, more than two domains selected, an image attached, a re-ask) pick a larger model, **only with owner approval** and a per-turn cost budget.
- Fast paths and `agent.capabilities` never call a model.
- Any routing change ships behind a server flag, off by default.

## 6. Cross-project contracts still needed

| Contract | Owner | Shape needed |
|---|---|---|
| Indicator instances | Indicator Intelligence | An Agent-callable write via the pure `instanceControls` writers inside the chart commit; an indicator target kind (list, fingerprint, read-back by instance id + `validateInstance`, Undo = previous `indicatorInstances`); which team owns that kind |
| Create Indicator hand-off | Indicator Intelligence | A headless or prefilled `openCreateIndicator({prompt})` seam; draft ids; cohort and budget rules |
| Drawings | Charts drawing layer | Exported point counts, `validateDrawing(type, points)`, a real-time → display-time helper; Agent Undo by drawing id (the store's undo stack is shared); server persistence decision |
| Screener advanced conditions and sorting | Screener | Flags for logic/grammar and promote; Period Sort as a callable API; a saved-screen revision column |
| Historical datasets | Data / Breadth | A typed as-of query service plus a coverage registry |
| Backtesting | Screener / Research | One canonical engine with a typed strategy spec and reproducible run records |
