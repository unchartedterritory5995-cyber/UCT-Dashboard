# UCT Indicators — integration-readiness inventory (2026-10-08)

For the UCT Agent project. **Documentation only — nothing here is wired to the Agent**, and
no Agent-owned code was changed (`app/src/agent/README.md`: the registry has no `indicator.*`
capability until this project exposes one). Line numbers are as of `feat/indicator-overnight`
and drift; the function names are the reference.

**Legend.** **STABLE** = a canonical seam with several callers that an integration may build on.
**INTERNAL** = implementation detail; may change without notice. "Server enforces" lists what
holds against a hostile client; everything else is browser-only.

## 1. Start a new authoring draft

| Piece | Where | Class |
|---|---|---|
| HTTP door `POST /api/user-definitions/converse` | `api/routers/user_definitions.py` (`converse`, ~L478) | STABLE |
| Turn service `converse(message, *, user_id, view, authoring, snippets, chart, admin, conversation_id)` → `{ok, disposition, reply, turn, envelope}` or `{ok:false, gate, reason}` | `api/services/definition_conversation.py` (~L1286) | STABLE (server) |
| Client wire `converseTurn({message, state, gateCtx, snippets})` | `builder/authoring/converseClient.js` | STABLE |
| Pure state `newAuthoringState`, `applyTurn(state, patch, ctx)`, `undo`, `isDirty` | `builder/authoring/authoringState.js` (re-exported by `authoring/index.js`) | STABLE |
| React hook `useIndicatorConversation` (preflight, send, save, discard) | `builder/studio/useIndicatorConversation.js` | INTERNAL (UI-bound) |
| Panel `CreateIndicatorPanel`, mounted only by `ChartToolbar` | `builder/studio/CreateIndicatorPanel.jsx` | INTERNAL |

**Server enforces:** `require_paid` (402); `require_create_indicator_access` (admin, or a
member in the `create-indicator` rollout cohort, else 403); 40 proposals/hour/member shared with
`/propose` (per process); daily dollar cap `CONVERSE_USER_CAP_DAILY`; ≤ `MAX_MODEL_CALLS` per
turn; one turn in flight per member; `check_envelope` — the closed patch schema
(`patchSchema.json`, shared with the browser), tree gates, scope bounds, ticker backstops,
input-name checks. The server **stores nothing and applies nothing** during a turn, and the
`view` it is sent is client-supplied (untrusted): the server never reads the stored definition.

## 2. Resume / modify an existing definition

| Piece | Where | Class |
|---|---|---|
| `openCreateIndicator(opts)` on the toolbar's imperative handle — no arg = Create; `{defId}` / `{row}` = Modify (returns `false` for an id the toolbar has not loaded) | `ChartToolbar.jsx` (~L1246); forwarded by `StockChart` toolbarApiRef and `pane/ChartPane.jsx` `modify(defId)` | STABLE for UI callers; needs a mounted, writable toolbar |
| `openAuthoringState(def, {defId, version, lineage})` | `authoringState.js` | STABLE |
| Draft sessions `createKey` / `editKey` / `readSession` / `writeSession` / `clearSession` | `builder/authoring/conversationSessions.js` | INTERNAL — an in-memory Map per tab (≤ 24); drafts do not survive reload and have no id |

**Server enforces on the edit save:** `base_version` → 409 `SaveConflict` (checked inside the
store lock), ownership by `user_id`.

## 3. Validate and preview

| Piece | Where | Class |
|---|---|---|
| `validatePatchShape(patch)` against `patchSchema.json` (`maxOps` 12, `maxOutputs` 8) | `builder/authoring/patchValidate.js` | STABLE |
| `applyPatch(definition, patch, ctx)` — shape → `patch:stale` → questions → ops → naming → final gates; atomic (a refusal returns the input unchanged) | `builder/authoring/applyPatch.js` | STABLE |
| `validateDefinition(def)`; `validateUserDefinitions(rawDefs)`; `prepareSave(state, {draftId})` | `engine/defSchema.js`; `engine/nativeRegistry.js`; `authoringState.js` | STABLE |
| Preview: `installUserDefinitions([def])` under id `u_studio-preview`; `previewInstanceFor`, `withPreviewInstance`, `stripPreview`; `StockChart.handleStudioPreview` | `nativeRegistry.js`; `builder/studio/chartPreview.js` | INTERNAL — ephemeral React state, never persisted, no read-back seam |

## 4. Save a validated definition

| Piece | Where | Class |
|---|---|---|
| `saveUserDefinition(definition, defId|null, telemetry, {previewAcked, baseVersion})` — POST when new, PUT otherwise | `app/src/hooks/useUserDefinitions.js` | STABLE |
| `storeConversation(state, opts)` (prepareSave + save); `attachConversation({...})` (installs, adds the instance only when new); `armConversationAlerts` | `builder/conversationSave.js` | STABLE within authoring |
| Routes: `POST /api/user-definitions`, `PUT /{def_id}`, `GET`, `GET /{def_id}?version=`, `POST /{def_id}/fork`, `DELETE /{def_id}` (soft) | `api/routers/user_definitions.py` | STABLE |
| `user_definitions.save(...)` | `api/services/user_definitions.py` | STABLE (server) |

**Server enforces:** paid plan + limits dependency; id shape `u_` + 12 hex and that the
document's id matches its address; `validate_v2` + presentation validation; 64 KB cap;
`lint_verdict` / `_admit_new_maths` (structured 422 incl. repaint acknowledgement); definition
count cap (50); `rev` bumps only when the maths moves (a paint-only edit keeps `rev`, bumps
`version` — measured on prod 2026-10-08: v2 / rev 1); ownership on every query.
**Not server-checked:** `definition.objects` (the chart-table program) is stored opaque and
interpreted only in the browser; cell text is drawn with `textContent`, never HTML.

## 5. Apply a saved definition to ONE chart

| Piece | Where | Class |
|---|---|---|
| `addInstance(cs, defId, registry) → cs'` (pure; returns `cs` unchanged when refused) | `engine/instanceControls.js` (~L470) — callers: IndicatorLibraryDialog, ChartSettingsIndicators, conversationSave, definitionActions, BuilderSheet, discoveryCatalog, ScanResults | STABLE |
| `setIndicatorEnabled(cs, defId, on, registry)` | same file | STABLE |
| Precondition: the definition is installed in this tab (`useInstalledUserDefinitions`) | `useUserDefinitions.js` | — |
| Persistence: `/charts` widgets store `opts.settings` inside the `charts_workspace_layout` preference; other surfaces write `chart_settings` | `pages/charts/widgets/ChartWidget.jsx`; `pane/useChartSurfaceSettings.js` | INTERNAL (blob shapes) |

**Server enforces:** only that the caller is signed in (`GET/POST /api/auth/preferences`) and
the key is on `_PREFERENCE_KEYS`. It does **not** validate `indicatorInstances`, definition
ownership or input values — those are browser-only (`instanceControls`, `normalizeInstances`).

## 6. Apply the same definition to MANY charts

**Not implemented.** No function applies an indicator across charts/widgets/layouts. The
nearest precedents are layout-wide writers for other features — `applyThemeToAllCharts`,
`applyTfToCharts` (`pages/charts/ChartsWorkspace.jsx`) — which map `layout.widgets` (+ tabs)
through `setLayout` / `scheduleSave`. A many-chart apply should be the same shape: one pure map
of `addInstance` over every chart settings blob, one save.

## 7. Update / remove per-chart instances

All pure `(cs, …) → cs'`, same `cs` when refused, in `engine/instanceControls.js` — **STABLE**:
`setInstanceInput(cs, instanceId, key, value, registry)`, `removeInstance(cs, instanceId,
registry)` (removes group members too), `setInstanceHidden`, `duplicateInstance`,
`setInstanceCalculationTimeframe`, `setInstanceAppearance`, `setInstanceDisplayTarget`,
`setInstanceVisibility`, `setIndicatorInput`. `StockChart.writeInstance` persists only when the
result differs.

## Gaps for an external caller (e.g. UCT Agent)

1. **No headless authoring seam.** The pure parts compose (`newAuthoringState` → `converseTurn` →
   `applyTurn` → `storeConversation`), but only the React hook composes them today.
2. **Drafts are not addressable** — no draft id, per-tab memory only.
3. **No apply-to-many** operation; no indicator target kind in the Agent registry.
4. **Preview has no read-back seam.**
5. **Chart settings are an opaque preference blob**; instance validity and ownership are
   browser-enforced only, so any writer must go through `instanceControls` with the registry
   installed.
6. `/converse` is cohort/admin-gated and shares its budget with `/propose`.
7. No undo receipt / acknowledgement model for indicator writes (the Agent's ACK model).

**Removed from this release:** an overnight prototype `authoring/agentContract.js` (typed
create/modify request → `openCreateIndicator({prompt})` with the member's words prefilled,
import refused by name). It had no caller and the Agent team asked integration to wait; if it
is wanted later it is ~80 lines over gaps 1–2 above, and it never saved on the member's behalf.

## Fundamentals in chart tables (deferred, by design)

- `fund:` point-in-time metrics are `formula_eligible=False`
  (`api/services/fundamentals_pit/catalog.py`, "V1: chart-only") and the formula vocabulary has
  no `fund:` names — **not bypassed**.
- Reusable today: the PIT series wire `[t_eff, v, period_end, method]`
  (`/api/fundamentals/pit/series/{sym}`, `engine/fundamentalSeries.js`), `projectAsOfIndices`
  (`engine/fundamentalAsOf.js` — value and period from the SAME point), `formatFundamentalValue`
  (`engine/fundamentalFormat.js`). The `/charts` FundamentalsWidget reads
  `/api/fundamentals/earnings-table` — provider data with a fiscal label only, **not PIT**.
- **The missing interface:** a table cell that reads a PIT *record*, not a formula series —
  e.g. `{kind:'fund', metric, show:['value','period','filed']}` resolved at the last (or replayed)
  bar via `projectAsOfIndices`, showing "—" with a reason for a gap / stale / missing point.
  It needs (a) a fiscal label per point on the wire (only `period_end` is sent today),
  (b) an `objectRuntime` hook that resolves a `fund:` reference to a record, and (c) a
  sequential Q/Q EPS-growth metric if CAN SLIM's "current quarter" is wanted (unverified that
  one exists). None of it requires making `fund:` formula-eligible.

## Trust boundaries after stabilization (2026-10-08)

**Closed — drawing-program colours.** A stored definition's `objects` program (chart
tables, labels, lines, boxes) may carry only colour literals of one grammar: `#RGB[A]`,
`#RRGGBB[AA]`, numeric `rgb()/rgba()`, and the chart-theme references
`chart.fg_color` / `chart.bg_color[@NN]`. Enforced at three doors:
1. **server save** — `presentation_schema.object_colour_errors`, called by
   `user_definitions.save` on EVERY save, including copies of a stored row (share install,
   fork), which otherwise skip presentation validation; refusal is
   `SaveRefused(presentation, guard=presentation:object-colour)`;
2. **browser load** — `objectProgram.assertColorNode` (reached by `defSchema` validation
   and the object runtime);
3. **CSS sink** — `objectTableDom` writes only `objectColour.isCssColour` values (and
   numeric widths) into style, so even a row stored before the rule draws nothing unsafe.

One fixture (`tests/fixtures/ast/object_colour_cases.json`) holds both lanes to the same
answers, and a test holds the two regexes byte-equal.

**Remaining, pre-existing, documented (not changed here):**
- **Colour-type settings and plot colours** (`inputs[].default` of type `color`, plot /
  paint colour fields) are checked only as non-empty strings in both lanes
  (`defSchema.js` `case 'color'`; `presentation_schema` `_is_str`). They reach legend and
  settings swatch styles. Same class as the gap closed above (a CSS fetch on render, no
  script) and reachable through a shared definition. Remediation: apply the same grammar
  plus `token:<role>` references at save; deferred because these fields have many legacy
  writers (Builder, Pine imports, templates) and need a corpus check first.
- **Chart settings blobs** (`chart_settings`, `charts_workspace_layout`,
  `breadth_drill_board`) are opaque preference values: the server validates neither
  `indicatorInstances`, nor that a `defId` belongs to the member, nor instance input
  values. They are the member's own preferences; a SHARED chart layout carries them to a
  recipient, where `instanceControls` / `normalizeInstances` are the only checks.
  Severity low (own data; shared layouts are explicit); remediation is a server-side
  instance shape check on the layout-share path.
