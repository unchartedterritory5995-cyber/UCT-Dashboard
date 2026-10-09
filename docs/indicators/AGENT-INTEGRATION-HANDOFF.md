# UCT Agent ↔ Indicator Intelligence — integration handoff (read-only investigation)

Prepared 2026-10-09 on `feat/indicator-batch2` (after Batch 2). **Nothing here is implemented.**
It supersedes the stale parts of `INTEGRATION-READINESS.md` (§0 below) and keeps its still-true
seams. Architecture (owner, unchanged): **UCT Agent owns conversation, routing, approvals and
cross-product orchestration; Indicator Intelligence owns formula semantics, validation, authoring
and definitions.** The Agent gets no formula engine and no second conversational indicator system.

## 0. What changed since INTEGRATION-READINESS.md

- **Drafts now survive a reload** (Batch 1): sessionStorage `uct.authoring.drafts.v1` (12 h TTL,
  ≤ 8 drafts, undo trimmed to 10), keyed `create:<chartScope(chartId)>` (FNV `c_<8hex>`) or
  `edit:<defId>`; every state carries a lineage `auth_<12hex>`. Still per-tab; nothing outside
  the tab can address a draft. (Gap 2 of the old doc is half-closed.)
- `agentContract.js` no longer exists. Line numbers in the old doc have drifted
  (`openCreateIndicator` is `ChartToolbar.jsx:1251`).
- Stale elsewhere (not ours to fix): `app/src/agent/README.md` still says `widget.remove` is not
  shipped; `CAPABILITY-CONTRACT.md` says 51/60 (golden manifest held **59** at this branch's base; master's Gate C later made 60 a per-request limit); `ai_doors.py`
  still calls `/converse` admin-only (it is admin **or cohort**).

## 1. What the Agent can invoke today

**No indicator capability exists** (`capabilities/chart.js:12-16` says so; `chartSettingsDescriptors.js`
classes `indicatorInstances`, `paneOrder`, `paneSizes`, `paneSeriesOrder`, `overlays`, `infoValues`,
`volumeOverlayIndicators`, `indicators.*` as `owned:indicator`). Indirect contact only:
- `chart.*` commits write the whole chart-settings blob, so `indicatorInstances` rides through
  unchanged; an indicator edit after an Agent write makes that Agent Undo refuse as stale (safe).
- `describeChart` sends no indicator list; `discovery.js` answers "custom indicators: planned".
- Server: no indicator route under `api/services/uct_agent/*`.

## 2. Headless today vs UI-bound

| Already headless (pure / injectable) | UI-bound (needs a seam) |
|---|---|
| `newAuthoringState`, `openAuthoringState`, `applyTurn`, `undo`, `isDirty`, `prepareSave` (`authoring/authoringState.js`) | the turn loop, transcript, ack and save orchestration in `studio/useIndicatorConversation.js` |
| `applyPatch`, `validatePatchShape`, `compactView`, `readback`, `classifyTurn`, `preflight` | `CreateIndicatorPanel.jsx` (mounted only by `ChartToolbar`) |
| `converseBody` / `converseTurn` (never throw, injectable fetch) | preview = StockChart React state (`handleStudioPreview` → `studioPreview` over `csView`) |
| `storeConversation`, `attachConversation`, `armConversationAlerts` (`studio/conversationSave.js`) | `openCreateIndicator` — on the toolbar handle, **not** on ChartWidget's `chartApiById` (the Agent host cannot reach it); takes no seed; does not check access itself |
| `saveReceipt` model, `withPendingInputs`, `previewInstanceFor/Like`, `stripPreview`, session store fns, `instanceControls` writers | `SaveReceipt.jsx` (presentational) |

## 3. Drafts — identity and resume

A draft is `{state, transcript, acked}` under `create:<scope>` / `edit:<defId>`, lineage
`auth_…` (cost telemetry only — never authorization). Resume = `readSession(key)` (memory, else
the sessionStorage mirror marked `recovered`), then the hook drops an edit draft whose
`baseVersion` is stale or a recovered draft that no longer validates.

**For the Agent:** (1) a read-only `listDrafts()` export (key, lineage, defId, baseVersion,
revision, name, savedAt, dirty) — today only key lookup exists; (2) a host opener that opens the
studio on a chart (it then restores that chart's draft itself); (3) accept per-tab scope by
design. The Agent never mutates a draft.

## 4. Referencing saved indicators

- Definition: `defId` (`u_` + 12 hex, server-minted). Each save appends `version`; `rev` bumps
  only when the maths moves. Identity = `ast_hash`, `result_identity` (= hash + `~s2` for
  semantics 2). Share → token → install (recipient's own new id); fork → new id; all owner-scoped.
- Placement: instance `inst:<defId>:<n>` = `{instanceId, defId, defVersion?, inputs, placement?, hidden}`
  in `opts.settings.indicatorInstances`.
- **The Agent references by `defId` + `instanceId` through its short refs, never by name** (names
  are not unique and are model-steerable), and pins `version`/`rev` in a proposal so Apply
  re-validates. Built-ins use native registry ids.

## 5. Preview and save results

- **Preview** returns nothing to a caller; the state-level read-back is
  `readback(working, state, gateCtx)` → `{outputs[{name,label,phrase,sentence}], needsAck, name, …}`.
- **Converse**: `{ok:true, disposition, reply, turn, envelope, not_understood, unavailable,
  cost_usd, attempts, usage}` or `{ok:false, gate, reason, preflight?}` (HTTP 200); 402/403/429.
- **Save**: `POST` / `PUT /{id}` (`base_version`) → `{def_id, version, rev, rev_bumped, migrated,
  notified, ast_hash, repaint, appended}`; 409 `{conflict}`; 422 `{refusal:{gate, plot, guard, …}}`.
  ⚠ `saveUserDefinition` keeps only `detail` and `conflict:true` — **the structured 422 refusal is
  dropped**, so an Agent receipt cannot branch on the gate yet.
- **Receipt model** (`saveOutcomeReceipt.js`): `{status: complete|partial, title, name, version,
  created, items:[{kind, ok, text}]}`.

## 6. Approvals and Undo

- Indicators' undo is a draft-local stack over the working definition; it never touches charts or
  the store. **A save has no undo** (versions append; a rev bump migrates bindings and alerts on
  every chart; alerts arm).
- The Agent's model: propose → Apply → read-back ACK → fingerprint-checked all-or-nothing Undo,
  `boardInSync`, `host.persist()` ACK before Undo is offered.

**Rules for the integration:**
1. **The Agent does not save.** The studio's Save stays the member's approval for anything that
   creates or versions a definition.
2. An Agent indicator kind uses a **fingerprint narrowed to `indicatorInstances`** and an
   instance-level undo patch — not the chart kind's whole-blob restore, which refuses whenever any
   unrelated chart setting moved.
3. Draft Undo and Agent Undo are separate stacks; receipts say which acted.
4. Agent writes go through `instanceControls` (the same writers the dialog uses) with the
   member's definitions installed in that tab.

## 7. Permissions and spend

- `/converse`: paid + (`admin` or the `create-indicator` cohort behind
  `CREATE_INDICATOR_COHORT_ENABLED`) + 40/h per member (per-process) + one turn in flight +
  `cost_guard` + per-member daily cap ($0.75; admin $10). Browser: admin needs
  `uct.feature.createIndicator`; members need the server cohort.
- Agent: paid + admin (`require_admin_dark`), `UCT_AGENT_DAILY_CAP` 300/day, population cap,
  spend on surface `uct_agent`.
- **Spend rule:** the Agent's routing turn is the Agent's cost; every authoring turn stays on
  Indicators' budget, made by the member inside Create Indicator. **The Agent never calls
  `/converse`.** Its `available()` must mirror `createIndicatorAccess && canModifyWithIntelligence`,
  because `openCreateIndicator` does not check access.

## 8. Ownership and missing interfaces

**Indicators provides:** a pure `instancesOf(cs, registry)` summary
(`{instanceId, defId, name, hidden, placement}` — never the `u_studio-preview` instance), an
`instanceFingerprint(cs)`, an optional `seed` for the studio (prefills, never sends), a
`listDrafts()` read, and the structured 422 refusal passed through `saveUserDefinition`.

**Agent provides:** the routing group `indicators` (none exists; the group rail requires one),
the capability declarations, proposal/receipt/Undo plumbing, the host opener binding
(`chartApiById` entry → `openCreateIndicator({defId?, seed?})`), and access-mirroring `available()`.

## 9. Smallest viable milestone (M1 — read + hand-off, no authoring in the Agent)

- **`indicator.list`** (query): each chart's instances with resolved names. Exists: `agent.read()`
  returns `cs` (incl. `indicatorInstances`); `nativeRegistry.getDefinition`.
- **`indicator.openCreate`** (`undo:'none'`, navigation-like): opens Create Indicator on one
  chart, blank or `{defId}` for Modify, optionally seeded. Exists: `openCreateIndicator`,
  `ChartPane.modify(defId)`. Missing: the host path, the access mirror, the seed prefill.

**M2:** `indicator.add` / `indicator.remove` of a saved or built-in definition on one chart via
`addInstance` / `removeInstance`, instance-narrowed fingerprint, exact Undo. Saving, converse
turns and alerts stay in the studio.

## 10. Order and acceptance

1. Indicators: `instancesOf`, `instanceFingerprint`, 422 refusal passthrough.
2. Agent: routing group + `indicator.list`; golden manifest update. **Manifest budget (updated
   after master `e74817ec91`, "Gate C", which landed after this branch's base):** `maxCapabilities`
   60 is now a PER-REQUEST limit and the catalog may register up to 200 (`catalog.maxRegistered`);
   routing packs whole groups under `routingThreshold` 55, and no group may exceed
   `maxGroupSize` 40. So M1 needs an `indicators` routing group small enough to pack beside the
   always-on group — not a freed slot. (On this branch's base the full manifest was 59/60.)
3. Host: `openCreateIndicator` on the `chartApiById` entry; `indicator.openCreate` gated as above.
4. Indicators: the seed prefill (never auto-sends).
5. M2 add/remove with the indicator kind.

**Acceptance:** list equals `indicatorInstances` through the registry and never shows the preview
instance; openCreate is absent from the manifest for a non-cohort member and for an admin without
the flag; it opens `edit:<defId>` or the restored `create:c_…` draft after a reload; a seed fills
the box with **no** `/converse` request and the Agent counter moves by one; add/remove go only
through `instanceControls` with byte-identical output to the library dialog, Undo restores exactly
that instance, refuses after the member edits it, and does **not** refuse after an unrelated theme
change; with the studio open an Agent Apply never persists `u_studio-preview`; manifest rails
(`agentContracts.test.js`, `tests/test_uct_agent_contract.py`, group membership) stay green.

## Risks

- **Routed packing** (above): an `indicators` group must fit beside the always-on group in one request.
- Two chart write paths (StockChart `handleUpdateChartSettings` vs ChartWidget `onOptsChange`);
  the server validates neither `indicatorInstances` nor def ownership.
- **Main Trading has no code guard in `app/src/agent`** — protection is operational
  (`boardInSync`, per-key CAS, the owner's rule).
- Edit drafts are keyed by `defId` only: Modify of one definition from two charts in one tab
  shares a draft.
- The 40/h converse window and the conversation ledger are per-process (not durable).

---

## 11. AGREED M1 INTERFACES (implemented — Indicators, branch `feat/indicator-agent-m1`)

Agreed with the UCT Agent team on 2026-10-09 (their reply confirmed every shape below). This section
supersedes §2/§8 of `AGENT-INTEGRATION-CONTRACT.md` where they differ. The Agent team builds
`indicator.list`, `indicator.openCreate`, the `indicators` routing group and the two `ChartWidget`
adapter lines; Indicators builds nothing on the Agent side.

**`app/src/components/chart/builder/agentSeams.js`** (pure; no React, no network, no writes)

| Export | Contract |
|---|---|
| `instancesOf(cs, registry) → IndicatorSummary[]` | The indicators on ONE chart in stored order. `{instanceId, defId, name, kind: 'builtin'\|'custom', version, hidden, enabled (= !hidden), placement: 'price'\|'pane'}`; plus one `{instanceId:'volume', setting:true}` row for the Volume pane (a chart setting — Agent's `volume.setState` owns it). `name` = `instanceLabel` (the legend's own name). Never the live preview (`u_studio-preview`), a removed tombstone, or an instance whose definition this browser cannot resolve. The classic averages (`ovl:<i>`) are adopted first (`maAdoption`). |
| `instanceFingerprint(cs) → string` | `ii:<count>:<fnv1a>` over ONLY `indicatorInstances` (preview excluded, tombstones kept, canonical key order). Unchanged by theme/timeframe/scale; changes on add/remove/hide/re-parameterise. For M2's instance-scoped Undo. |
| `seedFrom(text) → string\|null`, `SEED_MAX = 600` | Control characters stripped, whitespace folded, trimmed, capped at a word boundary. |
| `INDICATOR_OWNED_TOP_KEYS` | The top-level chart-settings keys Indicators owns; Agent's `OWNED_TOP_KEYS` is held equal by a rail. |

**Opener** — `ChartToolbar` → `StockChart` toolbar API → **`ChartPane` imperative handle** (what the
`chartApiById` entry's `paneRef` reaches):

- `openCreateIndicatorFor({defId?, seed?}) → {ok, reason?: 'access'|'readonly'|'unknown-definition'|'unavailable', prefilled, draft, editing}`
  - checks access itself (admin + `uct.feature.createIndicator`, or the server cohort — the button's own answer);
  - `defId` opens Modify on that saved definition (unknown/foreign → `unknown-definition`, nothing opens);
  - `seed` is placed in the input box only — **no `/converse` request, nothing saved or added**;
  - a draft kept for that chart (or that definition) **wins**: restored as today, seed not applied (`draft: true`);
  - already open on the same target: nothing is typed over the box (`prefilled: false`);
  - Chart Settings closes first (one surface holding Escape).
- `canCreateIndicator() → boolean` — the button's own access answer (use in the capability's `check`).
- The existing `openCreateIndicator(opts) → boolean` is unchanged for its callers and now also checks access.

**Save refusals** — `saveUserDefinition` (`hooks/useUserDefinitions.js`) now also returns `status`,
`refusal {gate, guard, plot, mode, errors?}` on a 422 and `conflictInfo {defId, expectedVersion,
currentVersion}` on a 409 (`conflict: true` unchanged); `storeConversation` carries both through.
Additive: `ok` / `error` / `conflict` are exactly as before.

**Routing (agreed):** group `indicators` (2 actions; group cap 40), words: `\bindicators?\b`,
`\b(rsi|macd|ema|sma|vwap|atr|bollinger|keltner|stochastic|supertrend|regression|correlation|momentum|oscillator|histogram)\b`,
`\b(build|make|create|write|code)\b.*\b(indicator|study|signal|formula)\b`,
`\b(when|whenever|if)\b.*\b(cross(es)?|above|below)\b`. A message matching an indicators word AND a
charts word routes BOTH groups; the hints decide ("colour the candles by trend / when RSI > 70" =
indicators; "colour the candles green" = charts; "compare AAPL to SPY" and "markers" alone = charts).
Budget: 74 → 76 registered (cap 200); max routed request unchanged at 55 (packing is whole-group).

**Not in M1:** `listDrafts()` (named in `docs/agent/PRODUCT-HANDOFFS.md` §9) — the opener's `draft`
answer covers M1; revisit with M2's hand-off work.

## 12. REVIEW: the Agent's `controlDoorCensus` `BULK_BLOB_SITES` entry — ACCEPTED

Entry: `app/src/agent/capabilities/chart.js` (`chart.applyTemplate` / `chart.resetDefaults`, commit
`7a8106dbf1`). Checked independently on 2026-10-09:

- `keepOwned(next, prev)` copies every `OWNED_TOP_KEYS` key from the chart's current blob (deep copy,
  tombstones included) and deletes it from the template when the chart had none — so a whole-blob look
  write can neither stamp nor drop indicator state.
- `OWNED_TOP_KEYS` = `indicatorInstances, indicators, overlays, paneOrder, paneSizes, paneSeriesOrder,
  volumeOverlayIndicators, infoValues` — every indicator-related stored key in `chartDefaults` (searched:
  `paneHeights`, `indicatorAlerts`, `instanceOrder` are runtime names, not stored keys).
- The writes are always proposed first; the preview cannot leak (it lives only in StockChart's view).
- `agent/agentBatch6.test.jsx` asserts it; it passes on the branch.
- **Added by Indicators:** `INDICATOR_OWNED_TOP_KEYS` (owner-declared) and a rail holding the Agent's
  list equal to it, so a key Indicators adds later cannot be silently omitted from `keepOwned`.

Verdict: the entry complies with the ownership rules; no change to it.

## 13. M2 APPROVAL CRITERIA (gate owned by Indicators) — §14 is the final contract and wins where they differ

M2 = the Agent adds or removes a saved or built-in indicator on one chart. Indicators approves it only
when ALL of these hold, each with a failing-first test:

1. **Canonical writers only.** Adds go through `engine/instanceControls.addInstance`, removes through
   `removeInstance` — the same calls the Indicator Library dialog makes — and the result is
   byte-identical to the dialog's for the same input. Indicators registers the Agent's file in the
   door-EIGHT ledger of `controlDoorCensus.test.js`; no other writer of `indicatorInstances` is allowed.
2. **Permissions.** Paid + admin-dark Agent gate, AND the chart is writable (`canManageIndicators`);
   a custom `defId` must be the member's own row (`userDefinitionRows`) or a built-in; a foreign or
   unknown id is refused before any proposal. No cohort / budget change.
3. **Persistence.** The write lands through the chart's one persist path (`ChartWidget` `.agent.commit`
   → `onOptsChange`), `host.persist()` ACKs before Undo is offered, and the stored blob never contains
   `u_studio-preview` (asserted with the studio open).
4. **Stale-state protection.** The proposal pins `instanceFingerprint(cs)` (and the definition
   `version` for a custom add); Apply re-reads and refuses on a mismatch; `boardInSync` applies.
5. **Read-back.** After Apply, `instancesOf` must show exactly the intended change (one instance added
   or one removed, by `instanceId`), or the receipt says it did not land.
6. **Undo.** Exact: add → `removeInstance` of that `instanceId`; remove → the removed instance restored
   byte-identically at its position (tombstone revived, not a new id). Undo refuses when that instance
   changed since; it does NOT refuse after an unrelated chart change (theme, timeframe, scale).
7. **Never saves, never alerts.** No `/api/user-definitions` write, no `/converse`, no alert arm; Main
   Trading untouched in acceptance (fingerprint before/after).
8. **Regression.** Library add/remove, Create Indicator, Modify, legend chips and the Indicators
   suites unchanged; the agent manifest rails and golden updated.

## 14. M2 MUTATION CONTRACT — FINAL (owner decisions 2026-10-09)

**Status: authoritative; Indicators half IMPLEMENTED (§15), Agent half NOT started.** Supersedes §13
where they differ, `AGENT-INTEGRATION-CONTRACT.md` §2–§6, and answers the three open questions in
`docs/agent/M2-M3-PROPOSALS.md` (Agent-owned). Reviewed with the Agent team 2026-10-09 (their
review is folded in below).

**Owner decisions (2026-10-09):**
1. Show/hide is IN M2 and reuses the canonical visibility writer (`setInstanceHidden`).
2. Undo of a removal restores the original instance identity and every dependent reference, through an
   Indicators-owned restore; a restore that cannot be guaranteed exact is refused.
3. The authoritative permission check (`canManageIndicators()`) is implemented first and re-checked at
   execution and at every Undo.
4. Production acceptance runs on `/charts`, ONLY inside a dedicated, isolated, admin-owned **"Agent
   Indicators Acceptance"** workspace — never Main Trading, never Positions, never the Breadth drill board
   (§14.8).

### 14.1 Operations — one chart, one logical indicator per call

| Agent action | Canonical writer (product UI that uses it) | Undo |
|---|---|---|
| add `{defId}` | `addInstance` (Add to Chart → `createFromResult`) | `removeInstance` of the created id (the product's own delete), refused while anything reads it |
| remove `{instanceId}` | `removeInstance` (Chart Settings ✕, legend chip Delete) | `restoreRemoved` — same ids, positions, inputs, dependents |
| setVisible `{instanceId, visible}` | `setInstanceHidden` (Chart Settings eye, legend chip eye) | the recorded `hidden` leaves put back |

A **logical indicator is its group** (`groupMemberIds`: e.g. the three COT panes act as one). Remove and
show/hide act on the whole group; receipts list every member id. Not in M2: inputs, style, placement,
timeframe, duplicate, reorder, definitions, alerts, the Volume setting (Agent's `volume.setState`).

### 14.2 Ownership

| Indicators owns | Agent owns |
|---|---|
| `builder/agentMutations.js` (every function in §15), the writers, the record and restore semantics | Capabilities, routing, chart selection, proposals, member-facing wording, Undo plumbing |
| `canManageIndicators()` on the ChartPane handle | The ChartWidget `.agent` adapter line that exposes it (§15.6) |
| Permission, staleness, persistence verification, revive | Calling plan → apply → commit → persist ACK → confirm, and holding the Undo token |
| The door-EIGHT census entry for `agentMutations.js` | No code that writes `indicatorInstances` or any indicator key except by committing what `apply`/`undo` return |

Never: `/api/user-definitions`, `/converse`, alert APIs, definition edits, the live preview
(`u_studio-preview`), Main Trading. The Agent never edits the returned settings before committing them.

### 14.3 Permission — checked at plan, at apply, at every Undo

- **Indicators:** `ctx.canManage` = `ChartPane.canManageIndicators()` (the toolbar's own predicate:
  the chart has settings and a save path). For `add`, the `defId` must resolve in the registry and, if it
  is a saved definition (`u_` + 12 hex), be in `ctx.ownedDefinitionIds` (the member's own rows).
- **Agent:** its own gate (paid + admin-dark) first; then a FRESH `ctx` for every call — never one cached
  from planning. A loss between plan and apply/undo → `permission-changed`, nothing to write.

### 14.4 Stale-state protection — refused before writing

The plan pins, and apply re-checks against the CURRENT settings:
- the target group's membership and `groupFingerprint` (any edit, hide, remove or revive of the target);
- the target's **dependents** (`dependentsOf`) — a new reader since the proposal would be severed unseen;
- for a custom add, the definition `version`;
- the optional `ctx.boardRevision` (Agent's workspace revision), if the Agent supplies one.

A change elsewhere — theme, timeframe, scale, another indicator — does NOT make a plan stale. The board's
workspace CAS (409) applies to the commit unchanged.

### 14.5 Restoration guarantees

`removeInstance` changes more than the instance: its group becomes tombstones (same ids); other
indicators' `@<id>::<plot>` source inputs and the header's info values that read it are severed (visible
gravestones); the definition's enabled mirror may clear; the list re-sorts; `preset` → `custom`.

- The removal **record** lists every changed leaf (instances keyed by `instanceId`, list order recorded
  separately) in the settings **as the chart reads them back** (stored JSON → `mergeChartSettings`), so a
  reload is never mistaken for a conflict.
- **Restore** succeeds only if every recorded leaf still holds what the removal left there
  (compare-and-swap per leaf); then it writes each prior value back and restores the recorded ids' order.
  Result: the original ids, definition references, ordering, placement, inputs, presentation and every
  severed link — equal by value to the pre-removal settings. Indicators added later are kept (after them).
- Otherwise `restore-conflict` with the first conflicting path, and nothing is written.
- Never simulated by adding a new instance with a new id.

### 14.6 Persistence and receipts

1. `apply` / `undo` return `{cs, pending}`. **Nothing is done yet.**
2. Agent commits `cs` through the chart's one persist path (`.agent.commit({settings: cs})`) and waits for
   `host.persist()` ACK.
3. Agent reads the chart's settings back (`.agent.read().cs`, or the stored board copy) and calls
   `confirmIndicatorMutation(readBack, pending, ctx)`:
   - `confirmed` → the receipt, and (for a mutation) the Undo token;
   - `unconfirmed` → no read-back: report "not confirmed", never success, no Undo;
   - `did-not-land` → the read-back lacks the change (`mismatch.path`): report it, no Undo.
4. A 409 / persist failure → refusal receipt; never a retry that overwrites. A late ACK may be confirmed
   later with the same `pending`.

The Undo token is held in memory only (no Undo after reload of the Agent panel or on another device); it
carries the record and is bound to `chartId`.

### 14.7 Reason codes — see §15.4 (exported as `REASONS`).

### 14.8 Production acceptance (owner decision 4)

- Only on `/charts`, inside a dedicated admin-owned workspace named **Agent Indicators Acceptance**, holding
  only scratch charts/indicators created for the test.
- **Isolation gate — before ANY mutation:** (a) Main Trading fingerprint (sha256 of `/api/auth/preferences`
  `chart_settings`) recorded; (b) the loaded board's active layout id/name is the acceptance workspace, and
  no other layout's row changes during a 2-minute observation with zero mutations; (c) every write observed
  in that window targets the acceptance workspace only. **If isolation cannot be demonstrated, stop** — no
  testing against shared or member data.
- Covers: add, remove, show, hide, persistence and reload, permission re-checks, stale-state refusals,
  receipts, exact Undo preserving ids and dependent references.
- Main Trading fingerprint identical after; cohort OFF; budgets and flags unchanged.

## 15. M2 IMPLEMENTED INTERFACE (Indicators, branch `feat/indicator-agent-m2`)

### 15.1 Module and exports — `app/src/components/chart/builder/agentMutations.js` (pure; no React/network)

| Export | Signature → result |
|---|---|
| `MUTATION_CONTRACT` | `'uct.indicators.mutation/1'` |
| `MUTATION_OPS` | `['add', 'remove', 'setVisible']` |
| `REASONS` | frozen map of reason strings (§15.4) |
| `checkIndicatorPermission(op, args, ctx)` | `{ok:true}` \| refusal |
| `resolveIndicatorTarget(cs, registry, {instanceId?, name?})` | `{ok, instanceId, name}` \| `not-found` \| `ambiguous` (`detail.candidates`) |
| `planIndicatorMutation(cs, request, ctx)` | `{ok:true, plan}` \| refusal — writes nothing |
| `applyIndicatorMutation(cs, plan, ctx)` | `{ok:true, cs, pending}` \| refusal |
| `confirmIndicatorMutation(readBack, pending, ctx)` | `{status:'confirmed', receipt, undo}` \| `{status:'unconfirmed'\|'did-not-land', reason, receipt, mismatch?}` |
| `undoIndicatorMutation(cs, undo, ctx)` | `{ok:true, cs, pending}` \| refusal (confirm it like a mutation; no further Undo) |
| `dependentsOf(cs, ids, registry)` | `[{kind:'source'\|'infoValue', instanceId?, key?, index?, reads, name}]` |
| `groupFingerprint(cs, ids)` | `'gf:<n>:<fnv1a>'` |
| `removeInstanceWithRecord(cs, instanceId, registry)` / `restoreRemoved(cs, record)` | the remove/revive pair |
| `changeRecord(prev, next)` | `{paths:[…]}` (used internally; exported for tests) |

Also: `ChartPane` handle `canManageIndicators() → boolean` (forwarded by `StockChart` from
`ChartToolbar`). M1 exports (`instancesOf`, `instanceFingerprint`, `seedFrom`) are unchanged.

### 15.2 Schemas (JSON-compatible)

```ts
type Ctx = { canManage: boolean; ownedDefinitionIds: string[]; registry: Registry;
             chartId?: string; boardRevision?: string | number }
type Request = { op: 'add'; defId: string }
             | { op: 'remove'; instanceId: string }
             | { op: 'setVisible'; instanceId: string; visible: boolean }
type Dependent = { kind: 'source' | 'infoValue'; instanceId?: string; key?: string; index?: number; reads: string; name: string }
type Plan = { contract: 'uct.indicators.mutation/1'; op: Request['op']; args: object;
              target: { ids: string[]; defId: string };
              pins: { groupFingerprint?: string; dependents?: Dependent[]; defVersion?: number | null };
              preview: { name: string; severs: Dependent[] };       // show `severs` before approval
              boardRevision: string | number | null; instanceFingerprint: string }
type Receipt = { contract: string; op: 'add' | 'remove' | 'setVisible' | 'undo';
                 status: 'confirmed' | 'unconfirmed' | 'did-not-land';
                 instanceIds: string[]; defId: string; name: string | null; chartId: string | null;
                 undoOf?: 'add' | 'remove' | 'setVisible'; visible?: boolean;
                 severed?: Dependent[];   // remove
                 restored?: Dependent[] } // undo of remove
type Refusal = { ok: false; reason: string; detail?: object }
```
`pending` and `undo` are opaque to the Agent: hold them, pass them back, never edit them.

### 15.3 Lifecycle

```
plan(cs, req, ctx)            → show plan.preview (name, severs) → member approves
apply(read().cs, plan, ctx₂)  → commit({settings: cs}) → await persist ACK
confirm(read().cs, pending)   → receipt (+ undo token)  → say exactly what the receipt says
undo(read().cs, undo, ctx₃)   → commit → ACK → confirm   → receipt {op:'undo', undoOf}
```
`ctx₂`, `ctx₃` are re-read at that moment (`canManageIndicators()`, the member's definition rows).

### 15.4 Reason codes (`REASONS`)

`bad-request`, `readonly`, `permission-changed` (detail.was), `unknown-definition`,
`unsupported-definition`, `not-found`, `ambiguous` (detail.candidates), `writer-refused`, `no-change`,
`changed-while-working` (detail.what = `indicator` | `group` | `dependents` | `definition` | `board`),
`restore-conflict` (detail.path), `dependent-exists`, `unconfirmed`, `did-not-land` (mismatch.path).
Agent-side codes stay the Agent's (`protected-layout`, `board-conflict`, `persist-failed`).

### 15.5 Minimal integration (Agent side — illustrative, not implemented here)

```js
import { planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation, undoIndicatorMutation } from '../components/chart/builder/agentMutations'
import * as registry from '../components/chart/engine/nativeRegistry'
const ctx = () => ({ canManage: entry.agent.canManageIndicators(), ownedDefinitionIds: ownIds(), registry, chartId })
const p = planIndicatorMutation(entry.agent.read().cs, { op: 'remove', instanceId }, ctx())
if (!p.ok) return refusalReceipt(p.reason)
// … member approves p.plan.preview …
const a = applyIndicatorMutation(entry.agent.read().cs, p.plan, ctx())
if (!a.ok) return refusalReceipt(a.reason, a.detail)
entry.agent.commit({ settings: a.cs }); await host.persist()
const done = confirmIndicatorMutation(entry.agent.read().cs, a.pending, ctx())
// done.status === 'confirmed' → done.receipt, keep done.undo; otherwise report done.status
```

### 15.6 The one Agent adapter line (ChartWidget `.agent`, Agent-owned)

`canManageIndicators: () => !!paneRef.current?.canManageIndicators?.()` beside `canCreateIndicator`.

### 15.7 Fixtures and evidence

- `builder/agentMutations.test.js` — byte-equality with the UI writers (add = `createFromResult`, remove,
  hide), built-in and saved custom, classic averages, groups, receipts, unconfirmed/did-not-land/late ACK,
  exact Undo (same ids, order, dependents) incl. after a store round trip, unrelated edits, conflict
  refusals, Undo-add with a new reader, permission at plan/apply/undo, staleness (indicator, dependents,
  definition, board, not-found), ambiguity, two charts, no-change, nothing else moves, no network imports.
- `builder/agentPermission.test.jsx` — `canManageIndicators()` equals the Indicator Library's gate.
- Browser: the Add to Chart harness (`add-to-chart-harness.html`, real ChartWidget, persistence writes
  refused) exposes `window.__a2c.api()`; the M2 run (remove → reload → Undo → reload, hide/Undo, add/Undo,
  stale plan, lost write, read-only) is recorded in the release notes for this branch.
