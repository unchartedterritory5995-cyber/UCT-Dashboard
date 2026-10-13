# WS3: Indicator lifecycle, persistence, and chart/workspace integration

**Audit worktree:** `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13`, at production `84164aee3d`.

**Method:**
- Code reading, cited as `path:line` (frontend paths are under `app/src/`).
- Representative existing tests, run.
- Scratch probes under `app/src/__audit_scratch__/ws3/`. These are NOT committed.
- No browser, no production access.

Docs were used as leads only. Every claim below was checked against the code.

---

## 0. Headline findings

| # | Sev | Finding |
|---|---|---|
| F1 | **P1** (P0 candidate, see §5) | **Several "on/off" doors delete every instance of a definition, and the member's settings with them.** There is no undo. Turning the indicator back on rebuilds a single `legacy:<id>` instance from the legacy mirror. The doors are: the Library dialog row, the right-click Indicators submenu, the Ctrl+I/O/B and Alt+U chords, and the phone "Remove from chart". The settings of any `inst:` instance (the ones the add flows and duplicate create) are lost: period, calculation timeframe, display target, and so on. Two tuned RSIs become one default RSI. Proven by a scratch probe. |
| F2 | **P1** | **Instances disappear silently.** An instance whose definition does not resolve is dropped at paint time, with no member-facing notice. This happens when the definition was deleted, when an edit removed an input the instance had set, when the definition fails today's validation gates, or when the template/layout came from someone else. The record stays in the blob as dead data. Proven by two probes. |
| F3 | **P1** | **There is no undo for any manual indicator action** (add, remove, edit inputs, move, toggle). The toolbar Undo and Ctrl+Z cover drawings only. Agent operations do have exact undo, but it lives in memory only. The broader recovery path is workspace Version History, and only when the workspace document store is armed. |
| F4 | P2 | **A deleted user definition keeps drawing in the current tab until reload,** then vanishes (F2). Installed definitions are never uninstalled when their row disappears. |
| F5 | P2 | **Share links pin the version at mint time.** After the owner edits, the link keeps serving the old version. The UI cannot re-pin it: once a token exists, the SharePanel shows only Copy and "Turn the link off". Re-sharing after a revoke mints a new token, which breaks the old link. A grammar-version bump stops every link working (409 "Ask the owner to re-share"), and the owner has no button to do that. |
| F6 | P2 | **The author is not anonymous in the library.** `public_library` says it returns no author. But each entry's token resolves through `resolve_share`, which returns `author_id` (the internal account id), and installs store it in `origin.author_id`. |
| F7 | P2 | **Inconsistencies between surfaces:** <ul><li>Remove-one (legend, Inspector) versus remove-all (Library, chords, menu, phone).</li><li>Duplicate copies the configuration, but "+ Add another" uses defaults.</li><li>Alerts, About and the header value are in the legend only.</li><li>Visibility, calculation timeframe, Arrange and Appearance are in Settings only.</li><li>The phone sheet has no hide, display, duplicate or arrange.</li></ul> |
| F8 | P2 | **Per-chart scope is plumbed but dead.** `scope` exists, but `instancesForChart` has no production caller. There is no "this chart vs all charts" control and no indicator sync. In MultiChartGrid, cells draw global settings plus the first widget's instances, and the shared modal writes the global blob. |
| F9 | P3 | **Implemented capabilities with no UI:** <ul><li>`setInstancePanePosition` (pane above price)</li><li>`setInstanceDotSize`</li><li>`setPaneSize` and `clearPaneSize` (no numeric resize or reset)</li></ul> Indicator templates are behind `VITE_INDICATOR_TEMPLATES_ENABLED` (off by default). |
| F10 | P3 | **`mergeSettingsOverride` cannot clear an instance field or an input key** (it unions by spreading). It is harmless on today's main write path, which is a full-blob `setPref`. It is a latent trap for `setPrefMerged` and for per-cell overrides. Proven by a probe. |

**What is solid** (verified):
- Instance identity is deterministic, and tombstones reserve ids.
- Two instances of one definition are fully independent.
- Built-in and user-defined instance settings round-trip exactly through serialize → `mergeChartSettings`.
- Duplicate copies the configuration under a new id.
- The chart-settings allow-list currently keeps every `CHART_DEFAULTS` key, and the trap is still real for new keys.
- Definitions are append-only with soft delete and history.
- Edits are revision-checked (409) from both the manual Builder and the Agent.
- Sharing is opt-in, uses 128-bit tokens, and keeps linking and listing as separate consents.

---

## A. Lifecycle step matrix

**Columns:**
- **BI**: a built-in indicator.
- **UD**: a user-defined (formula/Pine) indicator.
- **Agent**: what the UCT Agent can do.
- **Persistence**: where the data lives.

### Create
- **BI:** n/a (built into the registry).
- **UD:** Builder → `saveUserDefinition` POST. The server mints `u_…` (`BuilderSheet.jsx:2068`, `api/routers/user_definitions.py:329`).
- **Agent:** `indicator.draft` → `saveDraft` (`agent/capabilities/indicatorAuthoring.js:726-903`).
- **Persistence:** the SQLite `user_definitions` table. It is append-only (`api/services/user_definitions.py:1584`).
- **Tests:** `test_user_definitions.py`, `agentAuthoring.test.js`.
- **Status:** OK.

### Draft / preview
- **BI:** n/a.
- **UD:** The Builder preview lives only in `csView`. `stripPreview` keeps it out of storage (`StockChart.jsx:5097-5101`).
- **Agent:** Drafts live in memory, plus sessionStorage `uct.authoring.drafts.v1`: at most 8, 12-hour TTL, history trimmed to 10 steps (`authoring/conversationSessions.js:35-46,113-198`).
- **Persistence:** tab-scoped. A draft survives a reload of the same tab. It is lost in a new tab or on another device, and evictions are silent.
- **Tests:** `agentPreview.test.jsx`, `conversationSessions`.
- **Status:** OK. There is a gap: a stale draft is dropped without telling the Agent user (`authoringSession.js:107-110`, ignored at `agentAuthoring.js:218-223`).

### Apply (add to chart)
- **BI:** `addInstance` (default inputs) or `setIndicatorEnabled` (`engine/instanceControls.js:508,315`).
- **UD:** After a create, `addInstance(settings, storedId)` (`BuilderSheet.jsx:2127`).
- **Agent:** `indicator.add`: `addInstance` + `setInstanceInput` (`agentMutations.js:81-109`).
- **Persistence:** `chart_settings.indicatorInstances`, or the widget's own `opts.settings` on /charts (`pages/charts/widgets/ChartWidget.jsx:238-255`).
- **Tests:** `instanceControls.test.js`, `agentMutations.test.js`.
- **Status:** OK.

### Configure / edit instance
- **BI:** `setInstanceInput`, appearance, calculation timeframe, visibility, display target (`instanceControls.js:465,994,1035,1058,866`).
- **UD:** The same writers.
- **Agent:** Inputs on add only. No edit of an existing instance (`agentMutations.js:32`).
- **Persistence:** the instance record.
- **Tests:** `instanceInputSurvivesTheMirror.test.js`, scratch probe.
- **Status:** OK. Each writer edits exactly the named `instanceId`.

### Edit definition
- **BI:** "Create custom copy" (a fork into a formula) (`builder/definitionActions.js:57`).
- **UD:** Builder PUT with `base_version`. The server raises a 409 `SaveConflict` (`BuilderSheet.jsx:2063-2068`; `api/services/user_definitions.py:1800-1803`).
- **Agent:** `saveDraft` (edit) sends `baseVersion` (`builder/conversationSave.js:52-56`).
- **Persistence:** a new version row. When the maths changes, `rev` is bumped and alerts are force-migrated.
- **Tests:** `BuilderSheet.edit.test.jsx`, `test_user_definition_edit_forget.py`.
- **Status:**
  - The edit applies to **every** chart using the definition. `defVersion` on an instance is type-checked only and never pins anything (`engine/instances.js:567-572`).
  - Removing an input silently drops any instance that set it (F2).
  - The Agent's edit-save passes `settings:null`, so the chart instance's input values are not refreshed (`agentAuthoring.js:447`; `conversationSave.js:130-147`).

### Save
- **UD:** append-only. The client installs the **stored** document (`BuilderSheet.jsx:2090-2112`).
- **Agent:** read-back GET, otherwise `SAVED_UNCONFIRMED` (`agentAuthoring.js:402-423`).
- **Persistence:** server.
- **Status:** OK. The draft is cleared before the read-back (`agentAuthoring.js:455-458`).

### Reopen
- **BI:** The Inspector reads the instance (`ChartSettingsModal.jsx:216-239`).
- **UD:** The Builder reopens the stored document.
- **Persistence:** server prefs or the workspace layout; server user definitions.
- **Tests:** `BuilderSheet.paramReopen` and `boolParamReopen` tests.
- **Status:** OK.

### Duplicate instance
- **BI and UD:** `duplicateInstance`: a new id, copying inputs, calculation timeframe, display, presentation and visibility (`instanceControls.js:1088-1121`).
- **Agent:** not supported.
- **Persistence:** blob.
- **Tests:** scratch probe.
- **Status:** OK. "+ Add another" uses defaults instead (inconsistent, F7).

### Duplicate definition
- **BI:** Custom copy through `builtinCopy` (`definitionActions.js:66-83`).
- **UD:** `POST /{id}/fork`, named "(copy)" and recording `meta.forkedFrom` (`api/services/user_definitions.py:2576`).
- **Agent:** not supported.
- **Persistence:** server.
- **Tests:** `builtinForks.parity.test.js`.
- **Status:** OK.

### Share
- **BI:** n/a.
- **UD:** SharePanel. A link is a token pinned to a version and grammar table (`builder/SharePanel.jsx`; `api/services/user_definitions.py:2360`). The library is a separate opt-in (`:2640`).
- **Agent:** not supported.
- **Persistence:** append-only server tables `definition_shares` and `definition_listings`.
- **Tests:** `test_definition_sharing.py`, `test_definition_library.py`, `SharePanel.test.jsx`.
- **Status:** F5 (re-pin impossible from the UI) and F6 (author id exposed).

### Install shared
- **UD:** A copy under a new `u_` id carrying `origin` (`api/services/user_definitions.py:2534`).
- **Persistence:** server.
- **Status:** OK. Access requires a paid plan, although the UI says "Anyone with this link".

### Delete instance
- **BI and UD:** `removeInstance` writes a tombstone and severs dependents (`instanceControls.js:415`).
- **Agent:** `indicator.remove` (with a card), undoable.
- **Persistence:** the tombstone persists in the blob forever (bounded by distinct ids; `instanceShape.js:46-50`).
- **Tests:** `hiddenIsRemovedNotParked`, scratch probe.
- **Status:** No undo in the manual UI. Several doors remove **all** instances (F1).

### Delete definition
- **UD:** A confirmation per row, then a soft-delete tombstone version (`BuilderSheet.jsx:2154-2170`; `api/services/user_definitions.py:2231`). Restore is possible on the server by a PUT over the tombstone (`api/routers/user_definitions.py:579-584`), but **there is no UI** to restore.
- **Agent:** not supported.
- **Persistence:** server.
- **Tests:** `useUserDefinitions.delete.test.js`.
- **Status:** Charts using it go on drawing until reload, then disappear silently (F2, F4). The share link reports "gone".

### Undo
- **BI and UD:** none in the manual UI (the toolbar Undo is drawings only: `StockChart.jsx:6266`).
- **Agent:** in-memory stack of 20 entries, exact or refused (`agentMutations.js:507-532`; `useAgent.js:193,255`). Saves are irreversible.
- **Persistence:** memory only.
- **Tests:** `agentMutations.test.js`.
- **Status:** F3.

### Workspace restore
- Version History (TERM-051) rolls back the whole board (`pages/charts/VersionHistory.jsx`). It needs `WORKSPACE_DOC_STORE_ENABLED` (`api/services/workspace_doc_store.py:81,280`).
- **Persistence:** server.
- **Tests:** `VersionHistory.workspace.test.jsx`, `test_workspace_revision_safety.py`.
- **Status:** I could not verify that it is armed in production.

### Specific verifications

- **Drafts vs saved.** The Builder preview never reaches storage (`StockChart.jsx:5097-5101`). Agent drafts are sessionStorage only. Saves are explicit.
- **Revision pinning.**
  - Definition: append-only versions. An edit sends `base_version`, so a stale edit gets a 409.
  - Instance: `defVersion` is informational only, so there is **no per-chart pinning**. A definition edit changes every chart.
  - Share: pins a version.
- **Editing the correct instance.** All writers key on `instanceId`, and `findInstance` returns live instances only (`instanceControls.js:351`). The Agent refuses ambiguity and never "picks the first" (`agentMutations.js:335-340`). Three exceptions:
  - "remove rsi" with two RSIs returns a misleading NOT_FOUND instead of a "which one?" question (`indicatorEdits.js:282,132`).
  - The Builder's edit + header-value path picks the first instance by `defId` (`BuilderSheet.jsx:2141`).
  - The phone ƒx sheet edits the first live instance unless a chip names one (`MobileIndicatorSheet.jsx:16-19,182-188`).
- **Independence of multiple instances.** Proven by the scratch probe: two RSIs with independent period, calculation timeframe and visibility, which round-trip byte-identically.
- **Persistence across reload.**
  - Chart settings are server prefs (`/api/auth/preferences`, full-blob `setPref`, `StockChart.jsx:5133`). On /charts, each widget's `opts.settings` lives inside `charts_workspace_layout`.
  - localStorage is used only for small conveniences (draw repeat mode) and is not part of indicator state.
  - Agent drafts are in sessionStorage.
- **Formula and visual round-trip.**
  - Scratch: a user-defined instance with inputs and presentation is equal after a reload.
  - Existing tests pass: `savedDocumentRoundTrip.test.js`, `runtimeDocumentRoundTrip.test.js`, `objectPersistence.test.js`, `BuilderSheet.presentationPreserve.test.jsx`.
  - Object-program loss on save is confirm-gated (`BuilderSheet.jsx:2012-2022`).
- **Refining without losing settings.**
  - The legacy-mirror rule keeps a `legacy:` instance's input across a toggle (probe passes for MACD `fastPeriod`).
  - An `inst:` instance's input is lost across a definition-level toggle (F1 probe).
  - A Pine re-paste keeps parameter ids (`builder/paramCarry.js`).
- **Delete semantics.**
  - Instance: a tombstone (hard for the settings; nothing is kept).
  - Definition: a soft tombstone version, so history and pinned reads keep working.
  - Charts that use a deleted definition: kept in the blob, dropped at paint, no notice.
- **Sharing.** It exists, is private by default, and is paid-gated. There are three layers: a link, a library listing, and install as your own copy. See F5 and F6.
- **Duplicate.** Both instance-level and definition-level exist (see the matrix).

---

## B. Integration matrix

These findings come from the code-mapping sub-investigation; I spot-checked them.

### Adding indicators
- **Add via chart settings.** The widget's "Add to Chart" opens ChartSettingsModal on the Indicators add surface, with search autofocused (`pages/charts/widgets/ChartWidget.jsx:750-757`; `ChartSettingsIndicators.jsx:337,1160-1163`).
- **Library search.**
  - It is a case-insensitive **substring** match on name, shortName, id, category and tags (`IndicatorLibraryDialog.jsx:97-106`).
  - It is not fuzzy and has no aliases for technicals. RSI's tags are only `oscillator` and `momentum` (`engine/nativeRegistry.js:353-355`).
  - Synonyms exist only for economic and fundamental rows (`discoveryCatalog.js:1563,1599`).
- **Other entry points:**
  - `Alt+Shift+A` → Library dialog (`StockChart.jsx:8770-8790`).
  - Right-click → Add indicator…, or the Indicators submenu, which toggles (`StockChart.jsx:5738-5752,5813-5835`).
  - The chords Ctrl+I/O/B and Alt+U (`keyboardShortcuts.js:29-34`).
  - The phone ƒx sheet.
  - The Agent.
  - The legend cannot add.

### Configuring and arranging
- **Configure.**
  - The Inspector has inputs, Display, Visibility, Calculation timeframe, Appearance, Duplicate and Remove.
  - The legend chip menu has Show/Hide, Display in ▸, Edit in Indicators…, header value, Modify with UCT Intelligence, Edit formula, Duplicate, Create custom copy, Add alert…, About and Delete (`chart/legend/chipMenu.js:111-243`; wired at `StockChart.jsx:18490-18515`).
- **Visibility.** Chip menu or Inspector switch. Alt+Shift+I hides all. Hidden means remove-and-rebind (`instanceControls.js:369`).
- **Multiple indicators.** No cap on instances. Templates are capped at 25 × 40.
- **Move between panes, onto price, or merge.** "Display in" offers Price, Volume, Own pane and other pane hosts (`engine/displayTarget.js:595-599`). It is available from the legend and the Inspector, not on the phone.
- **Above price.** The writer exists (`instanceControls.js:680`), but **there is no UI**.
- **Reorder.** Settings → Indicators → Arrange (only when there is more than one pane), using ↑/↓ or drag (`ChartSettingsIndicators.jsx:3606-3612,1826,1863`). Not available from the legend or the phone.
- **Resize.** Drag the separator, which persists through `setPaneSizes` (`StockChart.jsx:16561-16620`). No numeric control and no reset.

### Charts, layouts and templates
- **Symbol and timeframe changes.** Instances are not keyed by symbol, so they persist. Per-timeframe visibility and calculation timeframe are supported.
- **Saved layouts.** Workspace templates carry each widget's `opts.settings.indicatorInstances`. Prebuilt layouts and UCT Default reset the instances to `[]` (`ChartsWorkspace.jsx:280-316,2063-2098`).
- **Indicator templates.** Behind a flag that is off by default (`builder/indicatorTemplates.js:66-72`). They are add-only through `addInstanceCopy`. A definition that is not installed is skipped as "unavailable" (`:261-287`).
- **Duplicating a chart widget.** There is no widget duplicate, only "Duplicate layout" (`LayoutDock.jsx:463`). The copies are independent.
- **Applying to multiple charts or workspace-wide.** No UI. `scope` is dead (`engine/alertSets.js:147`, no production caller; `pages/charts/grid/GridChartCell.jsx:406-418` says "inert").
- **Sync between charts.** None for indicators. Only theme apply-all and crosshair sync exist.
- **MultiChartGrid.** One shared modal writes the global blob. Each cell overrides with the first widget's settings, merged by id (`pages/charts/grid/GridChartCell.jsx:169-191`; `instanceShape.js:107-115`). A grid edit can therefore be masked by the widget's copy. Grid chips are inert (`IndicatorChip.jsx:79-81`).

### Mobile and performance
- **Mobile.**
  - The legend popover becomes a bottom sheet and opens on long-press.
  - Settings becomes a single column at ≤620px.
  - The phone ƒx sheet is limited (no hide, Display, duplicate, visibility, timeframe or arrange), and its switch **removes all** instances.
  - The full modal is reachable through More.
- **Performance (code level).**
  - Every write re-sorts the list (`instanceControls.js:291-296`).
  - `displayTargetOptions` is O(n²) or worse when sources are derived (`engine/displayTarget.js:537-546`, recursion to depth 8 with linear `find`, `sourceRef.js:827`), and it runs on every legend-menu render.
  - The binder uses WeakMap memoisation.
  - There is no instance cap.

---

## C. Click counts (desktop /charts widget, from code)

| Flow | Clicks | Path | Notes |
|---|---|---|---|
| Add RSI | **2** | Add to Chart → RSI (Popular) | Ctrl+I = 0 clicks; right-click → Indicators → RSI = 2. The Inspector opens afterwards. |
| RSI length 14→7 | **3 + typing** | Chip → Edit in Indicators… → Period | From the gear: 4+ (the default tab is "price", `ChartSettingsModal.jsx:342`). |
| Move pane / merge / onto price | **3** | Chip → Display in → target | Same from the Inspector Display select. |
| Hide/show | **2** | Chip → Hide | Not available on the phone sheet. |
| Remove one | **2** | Chip → Delete | No confirmation and no undo. |
| Duplicate | **2** | Chip → Duplicate on chart | Not available on the phone. |
| Reorder panes | **4–5** | Gear → Indicators → Arrange → ↑/↓ | Not available from the legend. |
| Resize pane | 1 drag | Separator | No reset. |

**Unnecessary clicks:**
- The gear opens on the "price" tab, not Indicators.
- Reorder is buried behind Arrange.

**Hidden capabilities:**
- Pane-above-price.
- Dot size.
- Numeric pane size and reset.
- Indicator templates (flag-gated).

---

## D. Data-loss and workspace-persistence risks

1. **F1: definition-level off deletes every instance and its configuration.**
   - The deletion: `setIndicatorEnabled(false)` tombstones every live instance of the definition (`instanceControls.js:322-330`).
   - Turning it back on (`:333-344`) revives only `legacy:<id>`, with inputs taken from the mirror. The mirror is written only for a single `legacy:` instance (`:497-503`).
   - The doors that reach this:
     - Library dialog row: `IndicatorLibraryDialog.jsx:186`.
     - Right-click submenu: `StockChart.jsx:5805`.
     - Chords: `StockChart.jsx:8698`.
     - Phone "Remove from chart", through `toggledRow`.
     - The no-instance branch of the Settings row (`ChartSettingsIndicators.jsx:863`), which is correct there.
   - Probe `probe2.audit.test.js`: `inst:rsi:1` with period 7 → off/on → `legacy:rsi` with `inputs:{}`.
2. **F2: silent disappearance.**
   - `normalizeInstances` drops an instance with an unresolved `defId` or an undeclared input key (`engine/instances.js:604-616,706-715`). The `dropped` list has no UI consumer (grep: no production reader of `.dropped` for instances).
   - The blob keeps the dead record, which is good for recovery but invisible to the member.
   - Triggers:
     - deleting a definition;
     - removing an input in an edit (probe);
     - a stricter validation gate (`nativeRegistry.installUserDefinitions` re-runs gates, `:3864-3878`);
     - a layout or template from another member;
     - a runtime kill-list entry.
3. **F4: a deleted definition keeps drawing in the current tab.**
   - `useInstalledUserDefinitions` only installs. A row that disappears is never uninstalled (`hooks/useUserDefinitions.js:368-378`).
   - Even an edit that is fine elsewhere shows stale state across tabs until reload.
4. **Blind full-blob writes.**
   - `setPref('chart_settings', fullBlob)` is last-write-wins across tabs and devices unless the workspace document store is armed (`hooks/usePreferences.js:46-130`). When armed, the second tab gets a 409 and its key is frozen until reload.
   - **Dependency:** confirm `WORKSPACE_DOC_STORE_ENABLED=1` in production. I could not verify it.
5. **F10: the merge cannot clear.**
   - `mergeSettingsOverride` (`instanceShape.js:107-115`) spreads prev and patch, so a key the writer deleted comes back. The writers delete keys to mean "default": calculation timeframe, visibility, placement, presentation.
   - Today it reaches `setPrefMerged` (voice add-only, safe: `hooks/useChartIndicatorBus.js:80`) and grid per-cell overrides.
   - It becomes a real loss the moment any edit path switches to `setPrefMerged`. Probe passes, so the behaviour is confirmed.
6. **Tombstones grow without bound** (one per distinct deleted id; acknowledged at `instanceShape.js:46-50`). New ids are `inst:<def>:<n>` and never reused, so heavy add/remove churn grows the blob. The cap is 4 MB per document (`api/services/workspace_doc_store.py:150`).
7. **Agent edit-save leaves the chart's instance values stale** (`agentAuthoring.js:447`).
8. **Silent draft drop and silent draft eviction** in Agent authoring.
9. **v1→v2 fold.** `chartDefaults.js:832-838` keeps only `kept` plus `removed`, so an instance of an uninstalled `u_` definition in a v1 blob would be destroyed and stamped v2. Exposure is low, because v1 predates user definitions.

---

## E. Gaps with suggested priority

### G1 (P1, P0 candidate): definition-level toggles delete every instance and its configuration
- **Description:** Toggling an indicator off from the Library row, the right-click submenu, a chord or the phone tombstones every instance of it. Toggling it back on brings back one default instance.
- **Evidence:** §D1; probe.
- **Current vs expected:**
  - Current: one click removes N configured instances, with no undo. Re-enabling restores one default instance.
  - Expected: "off" from these doors removes, or toggles, a single named instance, or asks first. Or there is an undo toast. Re-enabling restores the last configuration.
- **Impact:** Members lose tuned studies. A keyboard chord can do it accidentally.
- **Complexity:** M.
- **Dependencies:** none.
- **Regression risk:** M. The legacy mirror and render route depend on this writer (`controlDoorCensus.test.js`).

### G2 (P1): silent disappearance of unresolvable instances
- **Description:** An instance that cannot be drawn simply vanishes.
- **Evidence:** §D2.
- **Expected:** A legend placeholder chip, such as "Indicator unavailable: deleted / changed / not yours", with Remove and Restore actions. Delete-definition should warn "used on N charts".
- **Complexity:** M.
- **Regression risk:** L–M.

### G3 (P1): no undo for manual indicator operations
- **Expected:** An undo toast for remove, toggle and move. Reuse the Agent's exact-undo records (`removeInstanceWithRecord` / `restoreRemoved` in `agentMutations.js`).
- **Complexity:** M.
- **Regression risk:** L.

### G4 (P2): a deleted or changed definition is not uninstalled in open tabs
- **Description:** The tab keeps drawing a definition that no longer exists.
- **Evidence:** §D3.
- **Complexity:** S.
- **Regression risk:** L–M. The 5xx guard must be kept.

### G5 (P2): shared links cannot be re-pinned from the UI
- **Description:** After an edit, the link keeps serving the old version.
- **Evidence:** `SharePanel.jsx:170-200`; `api/services/user_definitions.py:2390-2395`.
- **Expected:** An "Update link to the current version" button, and a stale-version badge.
- **Complexity:** S.

### G6 (P2): share resolve exposes `author_id`
- **Description:** Resolving a share returns the author's internal account id, including for library entries.
- **Evidence:** `api/services/user_definitions.py:2523-2531,2551-2557` versus the library's own claim at `:2756-2762`.
- **Expected:** Omit `author_id` from `resolve`, or hash it. Decide attribution explicitly.
- **Complexity:** S.
- **Regression risk:** L.

### G7 (P2): surface parity
- **Description:** Remove semantics, duplicate versus add-another, and phone feature gaps all differ by surface.
- **Evidence:** §B, F7.
- **Complexity:** M.

### G8 (P2): per-chart scope and apply-to-all
- **Description:** There is no way to choose "this chart" or "all charts", and `scope` is dead code.
- **Evidence:** F8.
- **Complexity:** L.
- **Dependencies:** a product decision.

### G9 (P2): no per-chart version pinning
- **Description:** An edit changes every chart and alert immediately. Optional pinning or "update available" is missing.
- **Evidence:** `engine/instances.js:567-572`.
- **Complexity:** L.

### G10 (P3)
- Expose pane-above-price and pane-size reset.
- Make the gear land on the last tab or the Indicators tab.
- Add search aliases (for example "relative strength", "bollinger", "macd").
- Clean up stale "no caller" comments (`instanceControls.js:504-507`; `StockChart.jsx:117-119,5186-5188`).

### G11 (P3)
- Make `mergeSettingsOverride` honour explicit clears.
- Compact tombstones.
- Fix the Agent's "remove rsi" (two RSIs) message, which returns not-found instead of asking.
- Surface the dropped Agent draft to the user.
- Add an Agent `discardDraft`, which the M3 contract promises (AGENT-M3-CONTRACT.md:128) but the Agent does not expose.

---

## F. Tests run

**Frontend: 24 files, 588 tests, all passed** (vitest, about 80 s). The files:
- `engine/instances.test.js`, `engine/instanceControls.test.js`
- `engine/__tests__/`: `controlDoorCensus`, `enumerationSites`, `hiddenIsRemovedNotParked`, `instanceInputSurvivesTheMirror`, `settingsBlobMigration`, `alertSets`
- `chart/mergeSettingsOverride.test.js`
- `hooks/`: `usePreferences.test.js`, `usePreferences.revision.test.jsx`, `usePreferences.workspaceDoc.test.jsx`, `useUserDefinitions.delete.test.js`
- `builder/`: `BuilderSheet.edit`, `BuilderSheet.savePending`, `BuilderSheet.presentationPreserve`
- `memberPane/`: `savedDocumentRoundTrip`, `runtimeDocumentRoundTrip`
- `builder/`: `objectPersistence`, `agentMutations`, `agentAuthoring`, `SharePanel`
- `pages/charts/boardDocument.test.js`, `agent/agentChartTemplateParity.test.jsx`

**Backend (pytest): 442 passed, 1 failed** (about 289 s). The files:
- `test_user_definitions.py`, `test_definition_sharing.py`, `test_definition_library.py`
- `test_user_definition_edit_forget.py`, `test_user_definitions_auth.py`
- `test_workspace_revision_safety.py`, `test_workspace_doc_store.py`
- `test_charts_layout_service.py`, `test_share_publish_authorization.py`

The failure is not related to indicators: `test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER_…` fails because three screener routers share the sentence "The screener requires a paid plan" (89 unique out of 91).

**Scratch probes: 15 tests, all passing as written** (`app/src/__audit_scratch__/ws3/`):
- `lifecycleRoundTrip.audit.test.js` (14 tests):
  - two-RSI independence and round-trip;
  - duplicate;
  - tombstone id reservation;
  - re-add after remove gives defaults;
  - the `legacy:` mirror survives a toggle;
  - user-defined round-trip;
  - an unresolvable instance is kept in storage but dropped at paint;
  - removing an input drops the instance;
  - the merge cannot clear a field or an input;
  - template copy;
  - allow-list (0 `CHART_DEFAULTS` keys dropped, unknown keys destroyed).
- `probe2.audit.test.js` (1 test): F1, an `inst:` configuration lost on toggle.

---

## G. Browser checks for the lead (up to 10)

1. **F1.** On a /charts widget, add RSI and set its period to 7. Add a second RSI (chip → Duplicate) and set its period to 21. Open the Library (Alt+Shift+A) and click the RSI row; both RSIs should disappear. Click it again, and expect **one** RSI with period 14. Repeat using Ctrl+I.
2. **F2/F4.** Create a formula indicator and add it to a chart. Delete it from the Builder's list. It should still draw in this tab. Reload: it vanishes with no notice. Check that the legend and Settings show nothing about it.
3. **F2 (input removal).** Edit a saved formula that has an input set on a chart (for example, change the period), remove that input in the Builder, and save. The chart instance should vanish silently.
4. **F3.** Remove an indicator from its chip and press Ctrl+Z. Expect nothing to restore (drawings-only undo). Check Version History, if visible, to see whether it can restore the indicator.
5. **F5.** Share a formula and copy the link. Edit and save the formula. Open the link in a second account; it still shows the old version. Confirm the SharePanel offers no "update link".
6. **F6.** In a second account, resolve a library entry's link through the network tab (`GET /api/user-definitions/shared/{token}`). Check whether `author_id` is present.
7. **Multi-tab.** Open /charts in two tabs. Add an indicator in tab A, then change a setting in tab B. Expect either a conflict banner (store armed) or silent loss of tab A's add (store dark).
8. **MultiChartGrid.** Change an RSI period from the grid's settings modal, where the same instance also exists in the first /charts widget. Check whether the grid cell reflects the change.
9. **Mobile (≤620px).** Open the ƒx sheet with two RSIs. Check which one it edits. Check that "Remove from chart" removes both.
10. **Reload round-trip.** Set calculation timeframe W, visibility intraday-only and display "Own pane" on one RSI, and leave a second RSI at defaults. Hard reload. Both should be exactly preserved. Then set the calculation timeframe back to Chart and reload; it should stay at Chart.
