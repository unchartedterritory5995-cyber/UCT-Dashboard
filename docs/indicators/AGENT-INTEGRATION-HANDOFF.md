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

## 13. M2 APPROVAL CRITERIA (gate owned by Indicators)

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
