# PA3: Indicator visibility, destructive toggles and undo

**Phase A follow-up 3** to the 2026-10-13 Indicators audit (WS3 G1–G3; GAP P0-6, P1-7, P1-8).

- **Worktree:** `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13`.
- **Code base:** production `4a368e80ed` (HEAD `aac74481b1` adds audit docs only).
- **Status:** audit only. No runtime, test or config file was changed.
- **Probes:** two scratch files under `app/src/__audit_scratch__/phaseA-3/`, **21/21 passing**. They are not committed.
- **Existing rails:** six files, **245/245 passing** at HEAD:
  - `controlDoorCensus`, `instanceControls.test`, `perInstanceDoor`, `instanceInputSurvivesTheMirror`;
  - `MobileIndicatorSheet.studies`, `IndicatorLibraryDialog.test`.
- **Paths:** frontend paths are relative to `app/src/` unless they start with `api/`.

---

## 0. Headline

1. **Eight member-facing gestures permanently delete every instance of a definition.** One of them is a menu row labelled **"Hide RSI"**.
   - What is lost: inputs, calculation timeframe, display target, presentation, visibility, the MA-over-RSI link, and header info values.
   - They all end in one writer, `setIndicatorEnabled(cs, defId, false)` (`components/chart/engine/instanceControls.js:324-331`).
   - That writer replaces each live instance with a 2-key tombstone `{instanceId, deleted:true}` (`components/chart/instanceShape.js:53-58`). The tombstone is "minimal on purpose", so nothing can be recovered from the blob.
   - Proven: three RSIs (7/W, 21/W, 50 hidden) become four bare tombstones. Turning RSI back on gives **one** `legacy:rsi` with `inputs:{}`, which is RSI 14 (probe `paths.audit.test.js`, "per-DEFINITION off door").
2. **Three doors were not in the brief's list, and they are worse than the ones it named:**
   - **Right-click on an indicator pane → "Hide RSI"** (`components/StockChart.jsx:5927`) calls `setIndEnabled(key,false)`, i.e. the delete-all writer. The label says Hide; the action is remove-all.
   - **Right-click → Indicators ▸ → MA.** The submenu lists `movingAverage` (it is not in `LIBRARY_HIDDEN_IDS` and has no `quickMenu:false`; `StockChart.jsx:5826-5836`). Unticking it tombstones **every moving average**, including the four default EMA 9/20 and SMA 50/200 (`ovl:0..3`). Probe: 4 → 0.
     - `meta.addOnly` exists to stop exactly this (`engine/nativeRegistry.js:1053-1056`).
     - It is honoured only by the Library row (`IndicatorLibraryDialog.jsx:182-183`) and the phone sheet (`pages/charts/mobile/MobileIndicatorSheet.jsx:212-216`).
   - **Opening a `?state=` share link replaces the recipient's own instance list** with the sender's (`StockChart.jsx:6220-6249`). There is no confirm and no undo.
3. **Whole-blob doors write `indicatorInstances: []` with no tombstones and no record.** These are:
   - Restore Defaults (`components/chart/ChartSettingsModal.jsx:469-473`);
   - the Settings-page presets and reset (`pages/Settings.jsx:542-551`);
   - toolbar presets (`components/chart/ChartToolbar.jsx:296-299`). Every `PRESETS[*]` spreads `CHART_DEFAULTS` (`chartDefaults.js:366-371`).

   Because nothing is tombstoned, a stale union-by-id writer resurrects all of it (probe: 0 → 3). The Agent's own `chart.resetDefaults` **keeps** indicators (`agent/capabilities/chart.js:267,646`), so the button and the Agent disagree.
4. **History.** The rationale for "off kills all" was written on **2026-08-03** (`7d5c37e447`), when only one instance per definition could exist.
   - On **2026-08-07**, `a72a0d8483` ("two instances of one indicator can coexist") said in its own message that *"the reason is gone"*. It did not change the writer, and it re-justified the behaviour in `indicatorRegistry.js:511-514`.
   - The writer's docstring (`instanceControls.js:301-303`) still gives the dead reason.
5. **A hidden-but-kept model needs almost no new data.**
   - The existing `hidden` boolean already removes the series and its pane (`engine/__tests__/hiddenIsRemovedNotParked.test.js`). A hidden source is still computed for a visible dependent (`engine/binder.js:1484-1516`). An info value pointing at a hidden instance already shows "hidden, not computed" instead of being severed (`engine/infoValueResolve.js:141-143`).
   - One optional marker, `hiddenVia:'definition'`, makes "Show" restore *exactly* what "Off" hid. A prototype passes a 200-sequence property test that the shipped toggle fails on 199 of 200 seeds (§7).
6. **Undo can reuse the Agent's record machinery, with one fix.**
   - The Agent's "exact" undo is **value-exact, not byte-exact**: `setAt` rebuilds the revived instance's keys in a different order (probe).
   - The design below records whole instance elements, which makes it byte-exact by construction.
7. **Side findings:**
   - **Grid chords.** Ctrl+I in a MultiChartGrid cell writes the *first widget's* instances into the **global** blob as tombstones. The cell then shows nothing, forever, while the widget still draws them (probe).
   - **Alert orphan sweep.** It counts a tombstone's `instanceId` as a live instance (`api/services/indicator_alert_service.py:1433-1459,1514-1526`), so deleting an alerted indicator never flags its alert (JS port of the walker, probe).
   - **v1→v2 fold.** It discards unresolvable instances outright (`chartDefaults.js:832-838`; probe).

---

## 1. The complete path table

**Legend:**
- Columns (a)–(d) say what happens to (a) the targeted instance, (b) siblings of the same definition, (c) dependents, and (d) the legacy mirror `indicators[defId].enabled`.
- **Dependents** means `'@id::plot'` source inputs (`engine/sourceRef.js:326-333`) and header info values (`engine/infoValues.js:230-243`). **Alerts** are never touched by any client door; they carry their own `params_json` and an optional `instance_id`.
- **Sever** means the source string gains a `!` prefix ("Source unavailable") and the info value gains `severed:true`. Both keep the old text, but nothing un-severs them except an exact undo record.
- **T** means tombstone `{instanceId, deleted:true}`.

### 1A. Doors that destroy settings

| # | Surface · gesture | Writer (path:line) | (a) target | (b) siblings | (c) dependents | (d) mirror | Reversible? | Test that pins it |
|---|---|---|---|---|---|---|---|---|
| D1 | **Indicator Library row** click on a ticked row (desktop dialog) | `IndicatorLibraryDialog.jsx:186` `toggledRow` → `setIndicatorEnabled(!on)` | T (settings gone) | **all T** | all severed | false | No. On rebuilds one default `legacy:<id>` (`instanceControls.js:334-346`) | `IndicatorLibraryDialog.test.jsx`; census "four B4 surfaces" (`controlDoorCensus.test.js:496-540`) |
| D2 | **Right-click → Indicators ▸ → \<name\>** (tick off) | `StockChart.jsx:5803-5808,5835` `setIndEnabled` → `setIndicatorEnabled` | T | **all T** | severed | false | No | census routes (`controlDoorCensus.test.js:542-560`); `stockChartWiring.test.jsx` (14 call sites) |
| D2b | **Right-click → Indicators ▸ → MA** | same, `defId='movingAverage'` | T | **every MA, including the default EMA 9/20 and SMA 50/200** | MA-sourced dependents severed | false | No | none. `addOnly` is not consulted here (probe) |
| D3 | **Right-click on an indicator pane → "Hide \<label\>"** | `StockChart.jsx:5927` `setIndEnabled(key,false)` | T | **all T** | severed | false | No. **The label says Hide.** | none found |
| D4 | **Ctrl+I / Ctrl+O / Ctrl+B / Alt+U** (RSI/MACD/BB/VWAP) | `StockChart.jsx:8695-8699`; chords at `components/chart/keyboardShortcuts.js:29-34` | T | **all T** | severed | false | No | `stockChartWiring.test.jsx:2288,2543,3200,3734` ("Ctrl+I hides…": the word *hides* is in the test name) |
| D4b | Same chords in an **active MultiChartGrid cell** (`pages/charts/grid/GridChartCell.jsx:442` `hotkeysActive`) | same writer on `mergeSettingsOverride(global, firstWidget)` | T, written to **global** | all, including the **widget's own** ids, as T in global | severed | false | No. The cell then collapses the widget's live record to the global T (`instanceShape.js:117-123`), so the cell shows nothing while /charts still draws it (probe) | none |
| D5 | **Phone ƒx sheet**: a Studies switch, or a tap on the name of a row that is off | `MobileIndicatorSheet.jsx:223-227,284,299` `toggledRow` | T | **all T** | severed | false | No | `MobileIndicatorSheet.studies.test.jsx` |
| D6 | **Phone editor → "Remove from chart"**, even when the editor was opened from a specific legend chip | `MobileIndicatorSheet.jsx:437-447` → `toggleStudy` | T | **all T** (ignores `editing.instanceId`) | severed | false | No | none specific |
| D7 | **Restore Defaults** (Chart Settings header, two-click "Confirm?") | `ChartSettingsModal.jsx:469-473` `onChange(CHART_DEFAULTS clone)` | **gone: no T, list = `[]`** | all gone | info values reset with `header`; sources moot | reset to defaults | No. Only Version History, if armed. And not even durable: a stale union writer brings everything back (probe) | census asserts only the *clone* (`controlDoorCensus.test.js:463`) |
| D8 | **Settings page → Preset theme / Reset**; **toolbar Preset buttons** (non-/charts surfaces) | `pages/Settings.jsx:542-551`; `ChartToolbar.jsx:296-299`; presets spread `CHART_DEFAULTS` (`chartDefaults.js:366-371`) | gone (`[]`) | all | reset | reset | No | census `BULK_BLOB_SITES` lists them by name (`controlDoorCensus.test.js:224-240`) |
| D9 | **Chart template apply**: Chart Settings → Templates, right-click → Chart template, Agent `chart.applyTemplate` | `components/chart/chartTemplateApply.js:36-40`; `ChartSettingsModal.jsx:457-461` | **replaced** by the template's list (its tombstones included) | replaced | severed by absence | template's | Click: no. Agent path: proposal + Undo | `agent/agentChartTemplateParity.test.jsx` |
| D10 | **Open Layout / New Layout / prebuilt template** (Layout Dock) | `pages/charts/ChartsWorkspace.jsx:2093-2097` `setPref('chart_settings', …)`; `uctDefaultChartSettings` at `:311-317` stamps `[]` | replaced (board widgets remount with the template's `opts.settings`) | replaced | n/a | replaced | Only Version History (TERM-051), if `WORKSPACE_DOC_STORE_ENABLED` (`api/services/workspace_doc_store.py:81`) | `ChartsWorkspace.previousLayout.test.jsx` |
| D11 | **Opening a `?state=` share link** (on mount) | `StockChart.jsx:6220-6249` (replaces `indicatorInstances`; severs unproven info values with `severInfoValuesForInstanceSwap`) | the recipient's list is **replaced** | replaced | info values severed | merged | No | none found |
| D12 | **v1→v2 settings fold** (a blob with no `settingsVersion`) | `components/chart/chartDefaults.js:832-838` keeps `kept + removed` | an **unresolvable** instance (deleted, uninstalled or refused `u_…`) is **discarded**, and the output is stamped v2 on the next save | — | — | — | No. Low exposure: v1 predates user definitions | none. `settingsBlobMigration.test.js` covers resolvable blobs (probe) |

### 1B. Per-instance doors (non-destructive to siblings)

| # | Surface · gesture | Writer | (a) | (b) | (c) | (d) | Reversible? | Pinned by |
|---|---|---|---|---|---|---|---|---|
| P1 | **Legend chip → Delete** (one click, no confirm; owner ruling 2026-09-14, `3879b73697`, `components/chart/legend/chipMenu.js:89-98,235-240`) | `StockChart.jsx:5166-5168` `removeInstance` | T | kept | **severed** | true while a sibling lives (`instanceControls.js:425-427`) | No (manual) | `perInstanceDoor.test.js:92-107,165` |
| P2 | **Chart Settings → Indicators** row ✕ / Inspector Remove | `components/chart/ChartSettingsIndicators.jsx:858-864` (`removeInstance` when the row has an `instanceId`) | T | kept | severed | as P1 | No | `generatedSettingsRows.test.jsx` |
| P2b | Same ✕ on a row with **no** instance (a legacy projection only) | `ChartSettingsIndicators.jsx:863` `setIndicatorEnabled(false)` | T on `legacy:<id>` (nothing to lose; the inputs live in the mirror) | n/a | — | false | Yes: On rebuilds from the mirror | census |
| P3 | **Legend chip → Hide/Show**; Settings row switch; per-instance dialog eye | `StockChart.jsx:5154-5158`; `ChartSettingsIndicators.jsx:803-807`; `components/chart/IndicatorSettingsDialog.jsx:281` → `setInstanceHidden` | `hidden:true`, everything kept | kept | **kept**; a hidden source still computes for a visible reader (`binder.js:1516`); the info value reads "hidden" (`infoValueResolve.js:141`) | untouched (`instanceControls.js:364-368`) | **Yes**, exactly (probe) | `perInstanceDoor.test.js:85`; `instanceControls.test.js:354` |
| P4 | **Agent `indicator.remove` / `setVisible`** | `components/chart/builder/agentMutations.js:270-276,455-458` | T, or hidden | kept | severed (remove) | as P1 | **Yes**: exact undo, in memory, 20 deep (`agent/useAgent.js:193,255`; `agentMutations.js:507-532`). Value-exact, **not byte-exact** (probe) | `agentMutations.test.js` |
| P5 | `applyRowPatch(row with instanceId, {enabled:false})` | `components/chart/indicatorRegistry.js:937-943` | T | **all T** | severed | false | No | **Latent**: no shipped caller sends `enabled:false` for an instance row today; `setRowVisible` diverts to hide at `ChartSettingsIndicators.jsx:803-808` (probe) |

### 1C. Hide-like doors that are not persisted, or that lose state

| # | Surface | Writer | Effect | Note |
|---|---|---|---|---|
| H1 | **Alt+Shift+I** "hide all indicators" | React state `indicatorsHidden` (`StockChart.jsx:15960,16011`) | session only; nothing is written | It makes the `isIndicatorEnabled` comment "hidden counts as ON because Alt+Shift+I…" (`instanceControls.js:619-621`) **stale**: Alt+Shift+I never writes `hidden` |
| H2 | **Ctrl+M** toggle moving averages | `StockChart.jsx:8915-8935` (writes `hidden` on every MA instance) | non-destructive | **Not exact.** Second press sets `hidden:false` on *all* MAs, including ones the member had hidden individually. It is a hand-rolled list write (bypasses `withInstances`) |
| H3 | Per-instance **Visibility** (timeframes) | `instanceControls.js:1058-1069` | draws only on chosen timeframes | non-destructive |

### 1D. Doors checked and found not to remove anything

- **Symbol or timeframe change:** none of the four `indicatorInstances:` write sites in `StockChart.jsx` (`:6205,6243,6627,8934`) is on a symbol or timeframe path, and instances are not keyed by symbol.
- **Add flows:**
  - Library "+ Add another", Settings Add surface, Duplicate, indicator templates (flag-off, `addInstanceCopy`), voice bus (`hooks/useChartIndicatorBus.js:82`, `enabled:true` only): all **add-only**.
  - ⚠️ `ChartSettingsIndicators.jsx:1247-1256` `revivable` routes a click to `toggledRow` when `legacy:<id>` is *live*, which would be an OFF. It is **unreachable**, because the row is `canAdd = !on` (`:3081-3087`). Its comment, "revives a tombstoned `legacy:<id>` WITH the member's edited period", is **false**: `findInstance` returns live instances only, and a tombstone carries nothing to revive. It is dead code with a misleading comment.
- **MultiChartGrid's shared modal** (`pages/charts/grid/MultiChartGrid.jsx:491-497`) edits the **global** blob only, so per-instance doors behave as P1–P3 there. The trap is D4b.
- **"Clear all":** there is no indicator clear-all; `clearAll` is drawings only (`StockChart.jsx:6266`).

### 1E. Duplicates scenario (the brief's fixture), measured

| Door | inst:rsi:1 (7, W) | inst:rsi:2 (21, W) | inst:rsi:3 (50, hidden) | MA(RSI#1) source | Info value → RSI#2 | After "on" again |
|---|---|---|---|---|---|---|
| D1/D2/D3/D4/D5/D6 | `{inst:rsi:1, deleted}` | `{…deleted}` | `{…deleted}` | `!@inst:rsi:1::rsi` | `severed:true` | **one** `legacy:rsi`, `inputs:{}`; MA stays severed; info stays severed |
| P1 on #1 | T | kept 21/W | kept 50/hidden | severed | kept | n/a |
| P3 on #1 | hidden, 7/W kept | kept | kept | **kept** `@…` | kept | show is byte-identical (probe) |

---

## 2. Probes

`app/src/__audit_scratch__/phaseA-3/` (vitest, `--reporter=dot`, ~3 s).

**`paths.audit.test.js` (16 tests).** Every row in §1 marked "probe".
- Fixture sanity.
- D1 via `setIndicatorEnabled`; D1/D5/D6 via `toggledRow`; P5 via `applyRowPatch`; D2b on the default MAs.
- P1, P3, P4 (Agent undo, value-exact but not byte-exact).
- The same record machinery undoing a definition-level off. This is feasible: 2 recorded paths, `ok:true`.
- D7 resurrection by a stale union; D9 replacement; D4b grid collapse; alert-sweep blindness to tombstones.
- Silent drops kept in the blob but dropped at paint; D12 v1-fold destruction.
- Version skew: all-hidden still reads ON; the raw migrator projects a 4th `legacy:rsi`, and only StockChart's `liveStoredDefIds` filter (`StockChart.jsx:12054-12062`) suppresses it.

**`hideModelPrototype.audit.test.js` (5 tests).** The §3 model and the §4 element record.
- Off/Show on the fixture restores **byte-identical** instances.
- Old-client tolerance of `hiddenVia`.
- Byte-exact undo; refusal of a stale undo.
- The §7 property test: **prototype 0/200 failures; shipped toggle 199/200**. First counterexample: seed 1, trace `["toggle"]`, `lost inst:rsi:1`.

Key outputs, verbatim:

```
after OFF [{"instanceId":"inst:rsi:1","deleted":true},{"instanceId":"inst:rsi:2","deleted":true},{"instanceId":"inst:rsi:3","deleted":true},{"instanceId":"legacy:rsi","deleted":true}]
MA source after OFF !@inst:rsi:1::rsi
after ON [{"instanceId":"legacy:rsi","defId":"rsi","defVersion":1,"inputs":{},"hidden":false}]
right-click lists movingAverage? true addOnly true default live MAs ['ovl:0','ovl:1','ovl:2','ovl:3'] -> live MAs after 0
agent undo byte-identical? false | before {"instanceId":"inst:rsi:1","defId":"rsi",…,"hidden":false,"calculationTimeframe":"W"} | after undo {"instanceId":"inst:rsi:1","calculationTimeframe":"W","defId":"rsi",…}
reset then stale-union: live rsi 3
widget live rsi 3 | cell after chord 0
ids the sweep sees after delete include inst:rsi:1? true
shipped failures 199 / 200; first {"seed":1,"why":"lost inst:rsi:1","trace":["toggle"]}
```

---

## 3. History: why `setIndicatorEnabled(false)` tombstones every instance

The behaviour came in four steps (read-only `git log` and `git blame`):

1. **`313131afaf` (2026-08-02), "fix(prefs): give the instance merge a way to say 'deleted'".** It introduces the tombstone so that a stale grid cell cannot resurrect a delete through union-by-id: *"Reversal is an explicit `deleted: false`, so undoing a delete is a user action rather than a race."* The tombstone is minimal by design: *"a delete must not keep the user's old settings lying around in the blob, and 'undelete restores what you had' is a promise nothing else here makes"* (`instanceShape.js:53-58`).
2. **`7d5c37e447` (2026-08-03 09:10), "feat(engine): the two pure modules Flip B needs".** The origin of the off-branch. Its commit message lists it as a deliberate departure from the brief: *"OFF tombstones EVERY live instance of the definition, not just legacy:<id>. A settings row is per-DEFINITION at v1, so leaving a second instance drawing would make isIndicatorEnabled re-check the box the user just cleared."* At that date `addInstance` existed with **zero callers** (`instanceControls.js:504-507`). No member could hold two instances, so "all" and "the one" meant the same thing.
3. **`a72a0d8483` (2026-08-07), "feat(chart): two instances of one indicator can coexist".** It removes the premise: *"setIndicatorEnabled's docstring blamed the per-definition tombstone on 'a settings row is per-DEFINITION at v1'. The rows are per-instance now … so the reason is gone."* It ships Duplicate and "+ Add another", and it fixes the chip's × to use `removeInstance` ("TASK 4's M5 IS KILLED"). But it **does not touch `instanceControls.js`** (absent from its `--stat`). Instead it writes a new justification into `indicatorRegistry.js:511-514` (blamed to this commit): *"`enabled` STAYS PER-DEFINITION ON EVERY ROW. 'RSI: off' means no RSI — `setIndicatorEnabled` tombstones every live instance, deliberately."* The comment at `StockChart.jsx:5160-5165` ("its kill belongs to the task that ships a second instance") and the one at `:5185-5188` date from this era.
4. **Later patches tried to work around the writer, one surface at a time:**
   - `58f5c72ecf` (2026-09-10) split the Settings row so its switch hides instead (`ChartSettingsIndicators.jsx:786-808`: *"THIS IS THE SPLIT THAT MAKES 'TURN IT OFF' STOP MEANING 'DELETE IT'"*);
   - `1b26a787bf` (2026-09-28) added `addOnly` for Moving Average, in the Library and the phone sheet only;
   - `227d5fa946` and `a5291b69ef` (2026-10-06) added dependent severing to the off-branch, making it *more* destructive;
   - the right-click menus, the chords and the phone "Remove from chart" were never revisited.

**Verdict.** The behaviour was correct for a one-instance world. It became a defect on 2026-08-07, when multi-instance shipped, and it has been re-justified, rather than re-examined, since. Two rationales in the code are now false:
- `instanceControls.js:301-303` ("a settings row is per-DEFINITION at v1");
- `instanceControls.js:619-621` ("Alt+Shift+I … must not uncheck every box"; Alt+Shift+I does not write `hidden`, §1C H1).

---

## 4. Non-destructive hide/show model

### 4.1 Principles

1. **Definition-level "off" means HIDE.**
   - Every live instance of the definition that is currently visible gets `hidden:true` and the marker `hiddenVia:'definition'`.
   - Nothing is tombstoned, and inputs, presentation, placement and calculation timeframe are untouched.
   - Dependents are **not severed**. Today's rules already "suspend" them:
     - a visible MA(RSI) keeps computing off the hidden RSI (`binder.js:1484-1516`, "VISIBILITY IS INK, NOT EXISTENCE");
     - an info value reads "The indicator is hidden" (`infoValueResolve.js:141-143`).
   - Recommendation (owner decision O3): **do not cascade-hide** dependents. This matches the per-instance eye and the shipped rule, and it is reversible for free.
2. **"Show" restores exactly what "off" hid.**
   - It unhides only the instances carrying `hiddenVia:'definition'` and removes the marker.
   - A member's own per-instance hide (no marker) survives the round trip.
   - If no instance carries the marker (for example, every RSI was hidden one by one), Show unhides all of them. The member asked to see RSI.
3. **Removal is explicit and per-instance:** chip Delete, Settings ✕, Inspector Remove, the Agent. Each one goes through `removeInstance` and pushes an undo record (§5).
4. **"Remove all instances of X"** is a separate action, if it exists at all (owner decision O2). If it exists:
   - it lives only in the Chart Settings → Indicators list, in a per-definition overflow menu;
   - it is labelled "Remove all 3 RSI";
   - it pushes one undo record, with a toast. **Undo is the safety net, not a confirm dialog**: the owner removed the chip-Delete confirm on 2026-09-14 (`chipMenu.js:89-98`), and this keeps that taste.

### 4.2 The definition door state machine

The doors are the Library row, the right-click Indicators ▸ submenu, the region "Hide \<label\>", the Ctrl/Alt chords, and the phone Studies switch.

A new reader, `definitionVisibility(cs, defId) → 'absent' | 'shown' | 'hidden'`, is computed over live instances. It returns `shown` if any live instance is visible, `hidden` if live instances exist and all are hidden, and `absent` if there are none. A `partial` flag (some hidden, some shown) is for UI only.

| State | Checkmark / switch | Click / chord | Result |
|---|---|---|---|
| absent | off | **Add** | `addInstance` (a modern `inst:` id, defaults plus `createInputs`), or revive a **live** `legacy:<id>` exactly as today |
| shown (all visible) | ✓ | **Hide** | every visible instance → `hidden:true, hiddenVia:'definition'` |
| shown + partial (some hidden by the member) | ✓ with a small "◐ 2/3" | **Hide** | hides the visible ones; the member-hidden ones keep no marker |
| hidden | ○, with the label "hidden" | **Show** | unhides the `hiddenVia` set; if empty, unhides all |

**Per-door rules:**
- **Library row:**
  - The row click follows the state machine.
  - "+ Add another" stays `addInstance`.
  - A row that is shown or hidden gets a secondary "Remove…" entry that removes all, with undo, if O2 says yes.
  - **Add-only definitions** (`meta.addOnly`, i.e. Moving Average) keep today's add-only rule.
- **Right-click Indicators ▸:**
  - Same as the Library row.
  - For `addOnly` definitions: either exclude the row (as the Library does) or make it a hide/show of all MAs, which is Ctrl+M's meaning. Recommend: hide/show, sharing one writer with Ctrl+M (O4).
- **Right-click pane → "Hide \<label\>":** becomes a real hide of the instance(s) **drawn in that pane**, i.e. `setInstanceHidden` on the pane's live instances, not the definition. This is a straight bug fix.
- **Chords (Ctrl+I/O/B, Alt+U):**
  - Same as the Library row. A chord is fast and easy to fire by accident, so it is the strongest case for hide-not-delete.
  - Show a 6 s toast: "RSI hidden (2) · Undo".
  - In a **grid cell**, the chord must act only on instances the cell's own writer owns: the global blob, not the first widget's override (fixes D4b). Simplest fix: filter the targeted ids to those present in `csBase.indicatorInstances` before writing.
- **Phone sheet:**
  - Studies switch: same state machine.
  - **"Remove from chart"** becomes `removeInstance(editInstanceOf(...).instanceId)` with an undo toast: the instance the editor is showing, not all of them.
- **Settings Indicators list:** already per-instance (hide), so no change.
- **Ctrl+M:** reuse the same writer for `addOnly` averages, so its second press also restores exactly (§1C H2).

### 4.3 Minimal data-model change

- **Required: none.** The `hidden` boolean is validated (`engine/instances.js:628-631`), persisted, union-merged and rendered as "removed from the chart" today.
- **Recommended: one optional instance key, `hiddenVia: 'definition'`.**
  - Absent means a member's per-instance hide, or visible.
  - It is meaningful only when `hidden === true`. This makes it robust to F10 (a union merge cannot delete keys, `instanceShape.js:107-127`): a resurrected marker on a visible instance is inert.
  - Old clients tolerate it, proven by the probe:
    - `validateInstance` does not reject unknown instance keys, so `normalizeInstances` keeps both marked instances;
    - every shipped writer spreads `...i`;
    - the shipped `setInstanceHidden(false)` leaves an inert marker on a now-visible instance;
    - the shipped `duplicateInstance` copies it to a visible copy (`instanceControls.js:1096`), which is also inert. The new `duplicateInstance` should strip it.
- **Zero-schema alternative (O1-b):** Show unhides all hidden instances of the definition. It is simpler, but member-hidden siblings come back. The owner picks.
- **Writer:** change `setIndicatorEnabled`'s off-branch, in one place, to "hide visible live instances + mark".
  - Keep the tombstone path only for the **no-live-instance** case. That is a legacy projection with nothing to lose, and the tombstone still blocks the migrator (`engine/instances.js:420-427`).
  - On-branch: if hidden instances exist, unhide them (per the rule above), and do **not** add.
  - Doing it inside the existing writer fixes D1–D6 at once, keeps the census door list unchanged, and keeps the StockChart.jsx diff to the region-hide line, the chord toast and the grid filter.

### 4.4 The legacy mirror and version skew

- **Mirror rule: `indicators[defId].enabled` keeps meaning "a live instance exists"**, the rule `removeInstance` already uses (`instanceControls.js:408-427`). Hiding never writes the mirror, as `setInstanceHidden` already documents (`:364-368`).
- **Why this is safe.** The mirror's real readers are:
  - the read-time migrator, which a live hidden instance already outranks via `liveStoredDefIds` (`StockChart.jsx:12054-12062`; `chartDefaults.js:798-822`);
  - old-build tabs;
  - un-flipped settings rows;
  - `?indicators=`. **That route is fed by Discord `/chartsettings` prefs, not by the member's blob** (`api/services/discord_chart_prefs.py:1-8,98-100`).

  So a round trip without instances is not a member path any more:
  - share links carry instances (`571d019e59`);
  - presets and reset wipe the mirror anyway.
- **What an old tab does with a hidden-but-kept instance** (all verified):
  - It does not draw it: `pool.js:970` and `binder.js:1516` are shipped behaviour.
  - Its legend shows a hidden chip with an eye (`legendChips` includes hidden instances; `StockChart.jsx:135-139`), so the member can unhide it there.
  - Its Library checkbox reads **ticked**, because `isIndicatorEnabled` counts hidden (probe). One click in the old tab runs the **old** delete-all writer. That is unavoidable for an old bundle, and the window is one deploy cycle. It is mitigated because the bundle hash forces a reload on the next navigation.
  - It does not double-draw. A raw `migrateLegacyToInstances` projects a 4th `legacy:rsi`, but the old StockChart filter suppresses it (probe).
- **`isIndicatorEnabled`** keeps its "exists" meaning, for the migrator and the mirror. The doors switch to `definitionVisibility` for their checkmarks. Without this the toggle would be stuck: a hidden RSI reads "on", so a click would hide again.

---

## 5. Undo for indicator operations

### 5.1 Record format: element-granular, not leaf-granular

- **Reuse:** the Agent's contract (`agentMutations.js:218-254,507-532`). An undo applies only if every recorded location still holds its "after" value; otherwise it is refused with "Can't undo: \<name\> changed since". It is never partial.
- **Change: record whole instance elements**, keyed by `instanceId`, plus the indicator-owned top-level keys:
  - `indicators`, `header`, `volumeOverlayIndicators`, `paneOrder`, `paneSizes`, `preset`, and `overlays` (for averages slots);
  - and the instance **id order**.

  Reverting puts the stored "before" element back verbatim, so the result is **byte-identical**. Prototype: `recordOf` and `undoRecord` in `hideModelPrototype.audit.test.js`.
- **Why the change:** the Agent's leaf `setAt` rebuilt `inst:rsi:1` with reordered keys (probe). Today that is harmless for values, but it breaks any `JSON.stringify` equality (`instanceFingerprint`, digest rails such as `alertSets.test.js`) and the §7 "byte-identical" acceptance.
- **Option:** fix the Agent to the same format and share one module, `chart/engine/indicatorHistory.js`.

### 5.2 Scope, depth and persistence

| Question | Proposal | Why |
|---|---|---|
| **Scope** | Per **chart surface**: the key of the persist sink. That is `widgetId[:tabId]` on /charts (`pages/charts/widgets/ChartWidget.jsx:244-255`), `'global'` for StockChart without `onSettingsPersist` (grid cells, standalone pages). | Settings are per surface. A per-workspace stack would undo a change on a chart the member is not looking at. |
| **Depth** | 50 entries per surface, with redo (cleared on a new op). | The Agent has 20 (`useAgent.js:193`) and drawings 100 per symbol (`drawingsStore.js:31`). 50 covers a session of tuning. |
| **Which ops** | add, remove (one or all), hide/show (instance or definition), duplicate, input edit (one entry per committed field change, with keystroke edits coalesced over 1 s), move/display target, arrange/pane order, Restore Defaults, template/preset apply, share-link apply. | Every row in §1A becomes recoverable. |
| **Persistence across reload** | `sessionStorage`, key `uct.indicators.history.v1:<userId>:<surfaceKey>`. Wrapped in try/catch, 256 KB cap per surface, oldest dropped. Entries carry the `settingsVersion` and refuse to apply across a version change. | Survives a reload of the same tab (the most common "oops, refresh"). It does not leak across tabs, where the exactness check could not be trusted. **Version History** (TERM-051, 30 days or newest 200; `api/services/workspace_doc_store.py:160-167`) stays the durable, cross-device path. |
| **UI** | (1) A toast after every destructive or bulk op: "Removed RSI · Undo", or "RSI hidden (2) · Undo", or "Restored defaults · Undo". (2) An **Undo/Redo** pair in the Indicators panel header. (3) Ctrl+Z, see §5.3. | The owner prefers undo over confirm (`chipMenu.js:89-98`). |

### 5.3 Ctrl+Z, drawing undo and the Agent

- **Today:**
  - Ctrl+Z is a window-level handler in `components/chart/ChartDrawingOverlay.jsx:2754-2759` (`undo?.()`, with `preventDefault`).
  - Drawing history is **per symbol** (`components/chart/drawingsStore.js:255-279`, deduplicated per gesture).
  - Indicators are **per surface**. The two keyspaces never collide in data; they collide only on the key.
- **Proposal: a per-surface "last action" arbiter.**
  - Each history pushes `{kind, at}` to a tiny surface-scoped list. Ctrl+Z pops whichever is newer; Ctrl+Shift+Z or Ctrl+Y redoes symmetrically.
  - This needs `at` timestamps on `drawingsStore` past entries, a one-line change to a **drawing-session file**, so it must be coordinated.
- **Phase-1 fallback**, if the drawing session cannot take that change: Ctrl+Z undoes the indicator op only while its toast is visible, and otherwise falls through to drawings (zero change to drawing code).
- **Agent stack:**
  - Agent ops are already exact and receipted (`useAgent.js:653-672,775-800`).
  - Proposal: one record format, **two entry points**. A confirmed Agent mutation also pushes into the surface stack, labelled "UCT Intelligence: added EMA 20", with the same entry id.
  - Whichever undo runs first marks the entry consumed; the other then answers "already undone".
  - The Agent's protected-layout refusal (`undoProtectionRefusal`) applies to both.
  - Manual undo of an op older than a later Agent op succeeds only if the Agent op did not touch the same elements; otherwise it is refused, never partial.

### 5.4 Concurrency (be candid)

**Within a tab:** exactness is reliable. The check runs against the tab's current `cs`.

**Across tabs, store dark:** `setPref('chart_settings', fullBlob)` is last-write-wins (`hooks/usePreferences.js:262-305`). A tab's SWR cache is not revalidated on focus (5 min dedupe), so an undo in tab B checks against B's **stale** copy, passes, and overwrites tab A's newer write. The undo does not cause this. It is the same hazard every write already has (WS3 §D4). Mitigation:
- route undo writes through `setPrefMerged`'s transform-on-freshest pattern (`usePreferences.js:346-380`);
- and union-merge them. A tombstone-free revert is a plain element write, which the union carries.

**Across tabs, store armed** (`WORKSPACE_DOC_STORE_ENABLED`): a stale tab gets a 409, and its key is frozen until reload. The undo then fails loudly ("This chart changed in another tab — reload to undo"), which is correct.

**Grid cells:** they write the global blob, so their undo key is `'global'`. They must never restore elements that came from the widget override. The D4b filter applies here too.

---

## 6. Silent drops: a visible notice with recovery

### 6.1 What is dropped, where, and what survives

- **Paint-time drop:** `normalizeInstances(...).kept` at `StockChart.jsx:12054,12064`. It rejects:
  - an unknown `defId` (`engine/instances.js:608-616`);
  - an undeclared input key (`:704-715`);
  - an invalid value, a malformed `placement` or a non-boolean `hidden`.
- **The dropped list has no UI reader** (grep: the only `.dropped` readers are unrelated).
- **Records survive in the blob.** At v2, `mergeChartSettings` passes the raw array through (`chartDefaults.js:707`), and every writer spreads the list. The data is recoverable.
  - Exception: the v1 fold (D12). **Fix:** append `dropped` raw records to `kept + removed` at `chartDefaults.js:838`.
- **A worse case than "vanished": substitution.** If the dropped instance's definition still has `indicators[defId].enabled:true`, the dropped instance does not count in `liveStoredDefIds`, so the legacy projection draws a **default** `legacy:<defId>` in its place under the same name (`instances.js:670-690` documents a past instance of this). The notice must suppress the projection for any defId that has a dropped stored record.

### 6.2 The notice

- **Legend placeholder chip**, at the end of the strip: "⚠ 2 indicators can't be shown".
  - It also appears as a muted "Unavailable" group at the bottom of Chart Settings → Indicators, and on the phone ƒx sheet.
  - It opens a popover with one row per dropped record. Each row shows the name (from `display.name`, else the definition name if resolvable, else "Formula u_…"), the reason, and actions.

| Reason class (from `errors[0]`) | Member sentence | Actions |
|---|---|---|
| `definition-missing`: `defId` resolves nothing, **after** `useInstalledUserDefinitions` reports loaded | "This formula was deleted or isn't installed on this account." | **Remove**. **Restore formula** (server PUT over the tombstone, `api/routers/user_definitions.py:579-584`; it needs a UI; see O9). **Keep** |
| `definition-refused`: the definition failed today's gates (`nativeRegistry.installUserDefinitions`) | "This formula no longer passes checks: \<gate sentence\>." | **Open in Builder**. Remove. Keep |
| `input-removed`: an undeclared key | "This indicator's setting \<key\> no longer exists." | **Repair**: strip the unknown keys and keep everything else (one undoable write). Remove |
| `input-invalid` | "\<key\> = \<v\> is out of range (\<min\>–\<max\>)." | **Repair**: clamp to range, or reset that key to its default. Remove |
| `malformed` | "This saved indicator is damaged." | Remove. **Copy details** (for support) |

**Rules:**
- **Timing:** do not evaluate `definition-missing` before user definitions are installed. SWR answers after first paint (`StockChart.jsx:3395-3410`), so evaluating earlier flashes a false notice.
- **"Keep"** dismisses the notice for the session (sessionStorage per surface). The record stays.
- **Remove** writes a tombstone through `removeInstance`'s tombstone path and is undoable. Today `findInstance` refuses a non-normalizing record, so a `removeUnavailable(cs, id)` writer is needed.
- **Repair** is a new writer: `repairInstance(cs, id, registry) → cs`. It rebuilds `inputs` through `checkInstanceInput` (`instanceControls.js:163-175`) and refuses by identity if the result still would not normalize.
- **Delete-definition warning (WS3 G2):** the Builder's delete confirm says "Used on N charts". N comes from walking the workspace layout, like the server's `_walk_instance_ids`, but skipping tombstones.

---

## 7. Migration and compatibility

### 7.1 Members whose instances are already tombstoned

- **From the blob: no.** A tombstone is `{instanceId, deleted:true}` and nothing else (`instanceShape.js:53-58`, probe). Only the id and the definition-free fact of deletion remain. Inputs, presentation and placement are gone.
- **Other sources, partial and owner-gated:**
  1. **Workspace Version History** (`api/services/workspace_doc_store.py`; retention 30 days or newest 200, ceiling 2000).
     - **If and only if** `WORKSPACE_DOC_STORE_ENABLED` has been armed in production, every earlier `chart_settings` and `charts_workspace_layout` write is a full snapshot containing the live records. Not verified (WS3 §D4; no production access).
     - Today the member can restore the **whole board** (`pages/charts/VersionHistory.jsx`).
     - A targeted **"Restore an indicator from history"** tool is feasible: diff versions for a tombstoned id, show its last live record, re-add it under its **own id**, flip `deleted:false` (`instanceShape.js:124-126`), and re-point severed `!@id` sources by stripping `!`.
  2. **Alert rows.** `indicator_alerts.params_json` holds the period and parameters of any instance that had an alert, plus `instance_id` (`api/services/indicator_alert_service.py:328-414`). That is enough to rebuild inputs for alerted instances only. No presentation.
  3. **The legacy mirror** holds inputs only for a sole `legacy:<id>` instance (`instanceControls.js:440-486`). Those are already restored by "on" today.
  4. **Saved chart templates** (`chart_templates` pref) taken before the loss.
- **Recommendation:** no automatic restoration. That would be guessing, and a guessed RSI period is the "draws the wrong thing" failure the engine forbids (`instances.js:559-560`). Offer the Version-History-based tool only if the store is confirmed armed (O8).

### 7.2 Rails that pin the old behaviour and must change

| Test | What it pins today | Change |
|---|---|---|
| `components/chart/engine/instanceControls.test.js:88-120` ("turning one OFF writes a TOMBSTONE", "OFF tombstones EVERY live instance") | the off-branch tombstones | Rewrite: OFF hides and marks the visible instances; OFF with no live instance tombstones `legacy:<id>`; `:100` "survives a re-migration" stays, for the hidden case |
| `instanceControls.test.js:354` ("a HIDDEN instance still counts as enabled — the declutter toggle…") | `isIndicatorEnabled` counts hidden | Keep the assertion, **change the reason** (§3); add the `definitionVisibility` tests |
| `engine/__tests__/perInstanceDoor.test.js:143,165` ("the per-DEFINITION door still tombstones EVERY instance — unchanged contract"; "DIVERGE the moment TWO instances exist") | the delete-all contract | Invert: the definition door hides all and removes none; divergence becomes hide vs remove |
| `engine/__tests__/controlDoorCensus.test.js:496-540` ("an OFF mirror still projected") | OFF ⇒ mirror false ⇒ no projection after an instance-less round trip | Re-scope: definition-level **hide** keeps the mirror true. Keep the assertion for a true removal (last `removeInstance`) |
| `engine/__tests__/stockChartWiring.test.jsx` (14 `setIndicatorEnabled(...false)` sites; "Ctrl+I hides…" `:2288`, `:2543`, `:3200`, "toggling … OFF and back ON never leaves TWO…" `:2003`, `:2570`, `:3237`, `:3734`) | chords delete; off/on gives one series | Keep "never two series"; add "off/on restores RSI(7) and RSI(21)"; "a TOMBSTONE releases the band" (`:2236`) becomes "a hidden instance releases the band" |
| `engine/__tests__/instanceInputSurvivesTheMirror.test.js` (3 sites) | a `legacy:` input survives an off/on through the mirror | It still passes (hide keeps the instance). Add the `inst:` case, which fails today (WS3 `probe2`) |
| `engine/__truth__/p2x.sourceref.truth.test.js` (5 sites), `__tests__/infoValuesPersistence.test.js`, `__truth__/p2.ui.truth.test.js` | the definition-off door severs dependents | Severing stays for **remove**; the definition-off door must leave sources `@…` and info values unsevered |
| `legendFromDefinitions.test.jsx`, `flipB.test.jsx` (3 sites each), `p0.save.truth.test.js`, `pages/charts/mobile/MobileChartsApp.landing.test.jsx` | off drops the chip or series | A hidden chip is listed (already true for per-instance hides) |
| `IndicatorLibraryDialog.test.jsx`, `MobileIndicatorSheet.studies.test.jsx` | the row and switch toggle via `toggledRow` | add the three-state checkmark; "Remove from chart" removes only the edited instance |
| `stockChartWiring` (new) | — | the region "Hide \<label\>" hides only the pane's instances; MA submenu = hide/show all MAs; a grid chord never writes widget ids |

New rails:
- `indicatorHistory.test.js` (record and undo, byte-exact, refusal);
- the property test (§8);
- `unavailableInstances.test.jsx` (the notice, its timing, and projection suppression);
- `chartDefaults` v1-fold keeps dropped records;
- a backend `test_indicator_alert_orphans.py` case: a tombstone counts as missing.

### 7.3 Coordination

- **`StockChart.jsx` is shared** with the chart and drawing sessions. Keep its diff to:
  - (1) the region "Hide \<label\>" line (`:5927`);
  - (2) toast plus undo push in `writeInstance` and `toggleIndicatorById` (`:5150-5152`, `:8695-8699`);
  - (3) the grid-chord filter;
  - (4) the unavailable-chip feed next to `:12064`.
- The writer change lives in `engine/instanceControls.js`, which Indicators owns.
- **`ChartDrawingOverlay.jsx` and `drawingsStore.js` belong to the drawing session.** The Ctrl+Z arbiter needs their sign-off. The phase-1 fallback (toast-scoped Ctrl+Z) needs none.
- **The alert-sweep fix is backend** (`api/services/indicator_alert_service.py:1433-1459`): skip dicts with `deleted is True`. It is a one-line change with its own test. It is independent and can ship first.
- **Agent session:** a shared record module, plus pushing Agent receipts into the surface stack (§5.3).

---

## 8. Test and acceptance plan

### 8.1 Property test (required)

Implemented in scratch as `runProperty`. Promote it to `engine/__tests__/indicatorVisibilityProperty.test.js`.

- **Generator:**
  - a seeded PRNG;
  - fixture: three RSIs (7/W, 21/W, 50 hidden), MACD, MA(RSI#1), and an info value on RSI#2;
  - 25–60 steps per sequence, drawn from definition toggle (rsi/macd/movingAverage), instance hide, instance show, duplicate, explicit remove, remove-all (if O2), input edit, undo and redo;
  - every write round-trips through `mergeChartSettings(JSON.stringify(...))`, i.e. the persisted read.
- **Invariants after every step:**
  1. **No silent loss.** Every instance the member did not explicitly remove is live with the same `inputs`, `calculationTimeframe`, `placement`, `presentation` and `visibility` it had after its last explicit edit.
  2. **Undo is byte-exact.** Undo of step *k* yields `JSON.stringify` equal to the state before *k*. Redo yields the state after *k*.
  3. **No severing without removal.** A source `@id::plot` or an info value pointing at a live (possibly hidden) instance is never `!`-prefixed or `severed`.
  4. **Show restores exactly.** After def-hide then def-show with nothing in between, the instance list is byte-identical. Member-hidden instances stay hidden.
  5. **No double draw.** The StockChart drawn set (migrate, then the `liveStoredDefIds` filter, then normalize) never contains two instances with the same id, and never contains a `legacy:` projection beside a live (even hidden) stored instance of its definition.
  6. **Stale undo is refused, never partial.** Mutate a recorded element out of band, then undo: the blob is unchanged and the reason names the element.
- **Today:** the shipped toggle fails invariant 1 on 199/200 seeds. The prototype passes 200/200 on invariants 1, 2 and 4.

### 8.2 Targeted acceptance (manual, browser, for the lead)

1. Two RSIs (7, 21) plus one hidden RSI(50) on a /charts widget. Ctrl+I → nothing drawn; toast "RSI hidden (2) · Undo". Ctrl+I again → 7 and 21 back, 50 still hidden. Reload between the presses: same result.
2. The same with the Library row, right-click Indicators ▸ RSI, right-click RSI pane → "Hide RSI", and the phone switch.
3. Right-click Indicators ▸ MA → all averages hidden, not deleted. Second click → exactly the previously visible ones.
4. Phone: open RSI(21) from its chip → Remove from chart → only RSI(21) leaves; Undo brings it back with 21.
5. Chip Delete RSI(7) → toast Undo → back as `inst:rsi:1`, with the MA(RSI) source and the info value re-attached.
6. Restore Defaults → Undo → the full indicator set is back. Template apply → Undo. A `?state=` link → the toast offers "Keep my indicators".
7. Grid cell: Ctrl+I → only global instances are affected; the /charts widget and the cell agree after reload.
8. Delete a formula in the Builder → reload → "⚠ 1 indicator can't be shown" → Restore or Remove → Undo.
9. Two tabs, store dark: tab A hides RSI; tab B undoes something older. Document the LWW outcome. Store armed: tab B gets the 409 banner.
10. Old-bundle tab (pin the previous build): it shows hidden chips with eyes; it does not double-draw.

**Ship gates:**
- all rails in §7.2 updated and green;
- the property test at ≥1,000 seeds in CI;
- a pixel-parity gate: hidden = removed (`hiddenIsRemovedNotParked`);
- `engine_two_rsi_instances` unchanged.

---

## 9. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| O1 | Definition-level "off" = **hide** (a) / remove-all with undo (b) / ask each time (c) | **(a)**. Then choose O1-b: exact Show via `hiddenVia` (recommended) vs zero-schema "Show unhides all" |
| O2 | Should "Remove all instances of X" exist? | Yes, but only in the Chart Settings list overflow, with an undo toast and no confirm |
| O3 | On definition-hide, cascade-hide dependents such as MA(RSI)? | **No.** Keep "visibility is ink"; the info value already says "hidden" |
| O4 | Right-click Indicators ▸ MA: hide/show all averages (Ctrl+M parity) or remove the row | hide/show, one writer with Ctrl+M (which also becomes exact) |
| O5 | Undo UI: toast + panel buttons now; Ctrl+Z arbiter with the drawing session later? | Yes. Phase 1 uses toast-scoped Ctrl+Z |
| O6 | Undo persistence: sessionStorage per tab and surface (recommended) vs memory only | sessionStorage, 50 deep |
| O7 | Restore Defaults and presets: keep indicators (match the Agent's `keepOwned`) or keep wiping them (with undo)? | Restore Defaults keeps indicators by default, with a separate "Also remove indicators" checkbox; presets never touch indicators |
| O8 | Is `WORKSPACE_DOC_STORE_ENABLED` armed in production? If so, build "Restore an indicator from history"? | Confirm first (I could not). Build it only if armed |
| O9 | A UI to restore a deleted formula (the server supports it) | Yes, from the unavailable-chip popover |
| O10 | A share link replacing the recipient's indicators | Show a toast with "Undo" / "Keep mine" |
| O11 | Ship the alert-sweep tombstone fix (backend, independent)? | Yes, first |
| O12 | Unify the Agent's undo format (byte-exact) and stack with manual undo | Yes, a shared module, with Agent session sign-off |

**Rollout order (no code is authorised yet):**
1. **S0:** the alert-sweep fix. Region "Hide \<label\>" → a real hide (a one-line bug fix).
2. **S1:** the writer change (off = hide), the three-state reader, the door checkmarks, phone "Remove from chart" → per-instance, the grid-chord filter, the rail updates.
3. **S2:** the history module, toasts, panel undo/redo, toast-scoped Ctrl+Z, and Restore Defaults / template / share-link records.
4. **S3:** the unavailable-instances notice, repair/remove writers, projection suppression, and the v1-fold fix.
5. **S4:** the Ctrl+Z arbiter with the drawing session; Agent unification; the Version History restore tool (O8).
