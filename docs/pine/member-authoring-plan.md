# Member Pine authoring — current state, gaps, build plan

Lane A1, 2026-10-04, branch `pine/a1-member-authoring` (from `integrate/wave18-2026-10-04`).

Owner goal (verbatim, 2026-10-04): *"a full pine script coding system for members to create their
own custom indicators and members to be able to fully import all and any tradingview custom
indicator script onto our platform"*. The IMPORT side is driven by the engine lanes (corpus
census). This document is the AUTHORING side: a member writing and editing Pine inside UCT.

Everything below was read from code on this branch, not recalled.

---

## 1. What exists today

### 1.1 The doors a member's Pine passes through

| Door | File | What it answers |
|---|---|---|
| Import tab (paste box) | `app/src/components/chart/builder/PineBox.jsx` (`ImportBox` → `PasteBox`) | Translates for a **screen**: `inspectSource` → `memberInputTranslation(translatePine, …)`, non-strict, one column. Lists every output with the downstream verdict (`evaluateFormula`). |
| Member pane | `builder/memberPane/MemberPane.jsx` + `memberPaneDefinition.js` | Builds the **chart document**: strict host-lane translation, `paneGate`, optional runtime-lane fallback, all drawable rows, objects, paints, disclosures. Renders a preview `ChartPane` and "Add this script to my chart". |
| Pane gate | `engine/ast/paneGate.js` | Pure decision: may this translation be drawn; returns `{ok, reason, guard}` — **no line/column**. |
| Flag: member pane | `engine/memberPaneGate.js` (`VITE_PINE_MEMBER_PANE_ENABLED`) | **Armed in production since 2026-09-19.** |
| Flag: objects-only pane | `engine/objectsOnlyPaneGate.js` (`VITE_PINE_OBJECTS_ONLY_PANE_ENABLED`) | Armed 2026-09-27. |
| Flag: runtime pane | `engine/runtimePaneGate.js` (`VITE_PINE_RUNTIME_PANE_ENABLED` + per-member `PINE_RUNTIME_STAGE`) | Dark. |
| Attach / save | `BuilderSheet.jsx::attachPine` | `validateUserDefinitions` → `saveUserDefinition` (POST) → `installUserDefinitions` → `addInstance` → `onSaved` (the chart host closes the sheet). **Always a create.** |
| Store | `api/routers/user_definitions.py`, `api/services/user_definitions.py` | Append-only versions, `rev` bump + alert migration on a maths change, 64 KiB formula cap, toolkit count cap, `validate_v2` re-checks the compute half. `GET/PUT/DELETE /{def_id}`, `GET /{def_id}/history`, share/list/library routes. |
| Runtime save door | `api/services/runtime_definitions.py` | `PINE_RUNTIME_SAVE_ENABLED` (off), `PINE_RUNTIME_STAGE` (off/admins/all), kill list, starter allowlist, 128 KiB cap; a runtime document carries the Pine in `compute.source`. |
| Test harness door | `engine/__tests__/vendorHarness/ourSide.js::enterMemberDoor` | `memberPaneDefinition` → `installUserDefinitions`; test-only. |

### 1.2 How a member pastes a script today

Chart → Indicators → New → **Import** tab → paste into the box. The box is a CodeMirror 6
editor (lazy chunk, `editor/CodeEditor.jsx`, Pine dialect highlighting from
`editor/languages.js::pineLanguage`), with a hidden textarea fallback. Every 250 ms settle
(`PINE_DEBOUNCE_MS`) re-translates. The member picks a column → the sheet switches to the
Formula tab with that column's formula, and `MemberPane` (fed the pasted text) shows the
whole script on a preview pane with **"Add this script to my chart"**.

### 1.3 What a member sees on refusal

* **Import box:** the screener translation's refusal, verbatim — `Line N, column M`, the
  message, a caret excerpt (`<Refusal>`), `data-guard` naming the gate, and the primary refusal
  marked in CodeMirror's lint gutter (gated on the `source` stamp). Suggested fixes (`suggest`
  + `span`) can be applied with one click.
* **Member pane:** only `built.reason` — one sentence, **no line, no column, no token**, even
  when the translation it came from carries all three.
* ⚠️ The two can disagree: the Import box answers "can a screen read this" and the pane
  answers "can a chart draw this". A member editing in the Import box sees the screener's
  verdict, then the pane may refuse for a different reason.

### 1.4 How saved definitions persist and re-open

* An **ast-lane** Pine document stores the translated trees and the scan formula
  (`compute.source` is the *formula*), not the Pine. **A saved Pine script cannot be reopened as
  Pine.** The Formula tab can reopen its formula (`openForEdit`), which is not the script.
* A **runtime-lane** document stores the Pine (`compute.source`), so it could be reopened — but
  that lane's save door is off.
* Versions exist server-side (`history()`); there is no UI for a Pine script's versions.

### 1.5 Server validation of member-supplied keys (was open)

`user_definitions.save` checked `compute` (`validate_v2`) but **never read `inputs[]`**. A
client could store a key that shadows a table name (both interpreters then raise inside the
alert evaluator), duplicate/illegal keys, an `int` default of `"14"`, or no default. **Closed by
A1** — see §4.

---

## 2. Gaps against a TradingView-like Pine Editor

| TradingView Pine Editor | UCT before A1 | After A1 (dark) | Remaining gap |
|---|---|---|---|
| Editor, syntax highlighting, line numbers | CodeMirror + Pine highlighting in the Import box; no line numbers | Dedicated **Pine Editor** tab, CodeMirror with a numbered gutter (opt-in `lineNumbers` on `CodeEditor`) | Autocomplete is the FORMULA vocabulary (`completions.js`), wrong for Pine (`sma` vs `ta.sma`); no hover docs; no find/replace (`@codemirror/search` not installed — new dependency, O2); folding available in `@codemirror/language` but not wired |
| Compile on edit, errors with line/column in plain words | Screener-lane refusal only | **Pane-door** verdict on every settle, as a problems list: every refusal (de-duplicated across `refusal` / `refusals[]` / per-row), line, column, token, excerpt, verbatim sentence; refused output rows on an accepted script shown as warnings; disclosures as info | The translator stops at its first wall in most scripts, so usually ONE error is listed (engine lanes' call); gate-level refusals ("declares nothing a chart can draw") have no position |
| Errors point at the exact token | Gutter mark in Import box | Gutter mark (primary) + every list item is a button that selects the token in the editor | — |
| "Add to chart" / "Update on chart" | Always-create attach, then the sheet closes | **Add to chart** (create + instance), then **Update on chart** PUTs the same stored definition in place — no second definition, no second instance, sheet stays open; Ctrl/Cmd+Enter applies | Update-in-place is per sheet session only: once the sheet closes there is no way back into the script (needs §1.4 fixed — O1) |
| Save / rename / delete / version | Store supports versions, soft delete, history | unchanged | No "Save without adding to chart", no rename field in the editor, no version list or restore UI |
| Inputs panel | Instance settings dialog on the chart (`IndicatorSettingsDialog`) reads `inputs[]`; Track F `ParamControls` on the Formula tab | unchanged | No in-editor inputs panel bound to the preview |
| Script library ("My scripts") | Starter library (formulas), public library, indicator library dialog | unchanged | No list of a member's own Pine scripts to open in the editor |
| Mobile | `BuilderSheet` is a `Sheet`; CodeMirror wraps lines | Problems rows and Apply reach `--tap-min` at ≤1024; Apply spans the row at ≤640; editor height capped so the list and Apply stay on screen | Not walked on a device or the 390/820/1200 iframes yet (owed) |

---

## 3. Ordered build plan

| # | Increment | Depends on | Status |
|---|---|---|---|
| A1a | Server-side validation of `inputs[]` (fail closed, named field-path errors, all lanes) | — | **DONE** (§4) |
| A1b | Pine Editor tab: CodeMirror + line numbers, pane-door compile on settle, problems list with jump-to-token, preview pane, Add/Update on chart through the attach doors | — | **DONE, dark** (§4) |
| A2 | **Persist the Pine source with the document** (`meta.pineSource`), never used for compute — the trees stay the authority; its own cap | **O1** | **DONE, dark** (§6) |
| A3 | Reopen a saved Pine script in the editor → Update on chart across sessions; rename; delete; version list + restore over `GET /{def_id}/history` | A2 | **DONE, dark** (§6) — from My scripts; "Edit script" from the indicator library and the legend added by A6 (§7) |
| A4 | "My scripts" panel in the editor: the member's Pine documents, open/duplicate/delete | A2 | **DONE, dark** (§6) — open / rename / versions+restore / delete; *Duplicate* added by A6 (§7) |
| A5 | Inputs panel in the editor, bound to the PREVIEW instance (values never rewrite the source), mirroring TradingView's Settings → Inputs | — | **DONE, dark** (§6) |
| A6 | Pine-aware autocomplete + hover docs from `PINE_CALL_SHAPES` / `closedTable.json`; folding (`foldGutter`, already installed); find/replace | O2 ruled: stay on CodeMirror 6, **no new npm dependency** — find/replace (`@codemirror/search`) DEFERRED | **DONE, dark** (§7) — find/replace still deferred |
| A7 | Runtime-lane authoring: when the pane routes a script to the per-bar lane, say so in the status line; Apply honours the runtime save door's sentences | runtime flags | **DONE, dark** (§7) |
| A8 | Multi-error compile: ask the engine lanes for a "collect all walls" translation mode so the list shows every problem, not the first | engine lanes | |
| A9 | Device + iframe walk (390/820/1200), screenshot evidence, then the rollout decision | A1b | **WALKED 2026-10-05** (§7.4) — two defects fixed; rollout decision is the owner's |

---

## 4. What A1 shipped (dark)

* **Flag:** `VITE_PINE_AUTHORING_ENABLED` — read once in
  `app/src/components/chart/engine/pineAuthoringGate.js::pineAuthoringEnabled` as `=== '1'`;
  declared in `docs/feature_flags.json` (`build_flags`, status dark) and
  `docs/frontend_feature_flags.json` (pending); `Dockerfile.web` declares the ARG. Off: the tab
  does not exist and `buildMode` can never be `'editor'` — the sheet is the shipped one. It sits
  on top of `VITE_PINE_MEMBER_PANE_ENABLED`: with that off the editor checks scripts but offers
  no Apply.
* **Editor:** `app/src/components/chart/builder/pineEditor/PineEditor.jsx` (+ `.module.css`) —
  lazy CodeMirror (`lineNumbers`), textarea fallback, 250 ms settle, `memberPaneDefinition`
  compile, problems list, Apply / Update, store refusals verbatim.
* **Diagnostics:** `pineEditor/authoringDiagnostics.js` — pure; collects the pane door's own
  sentences, de-duplicates, orders, stamps each with the text it was measured on.
* **Sheet wiring:** `BuilderSheet.jsx` — `storePine` (the three store doors lifted out of
  `attachPine`, unchanged for it), `applyAuthored` (create, then PUT in place; no `onSaved`, so
  the sheet stays open), the tab, and in editor mode the formula box steps aside and
  `MemberPane` is a preview fed the settled text with no second attach button.
* **Server:** `api/services/definition_inputs.py` — `validate_inputs`, called from
  `user_definitions.save` on every lane before anything is hashed or written.

Rails: `tests/test_definition_inputs.py` (47), `pineEditor/authoringDiagnostics.test.js`,
`pineEditor/PineEditor.test.jsx`, `pineEditor/PineEditor.codemirror.test.jsx`,
`pineEditor/pineEditorDoor.test.jsx`, `engine/__tests__/pineAuthoringGate.test.js`;
`memberPaneGate.test.js`'s importer census now names `PineEditor.jsx` (it consults the gate for
Apply). Mutation-checked (copy/restore): server — save() call, shadow check, key pattern,
duplicate check, default typing; client — Apply-while-pending, de-duplication, create-vs-update,
tab gate, jump selection, pane-flag gate on Apply, the source stamp, the second attach button.

---

## 6. What A2–A5 shipped (dark, branch `pine/a2-authoring-persistence`)

Integrator rulings 2026-10-04: **O1** store the source, private by default, stripped on share/list
unless permissive, server-enforced, fail closed · **O2** CodeMirror 6, no new npm dependency
(find/replace deferred) · **O3** per-member stage `PINE_AUTHORING_STAGE` · **O4** Apply keeps the
sheet open (confirmed).

### 6.1 Server (`api/services/pine_authoring.py`)

* **Field:** `meta.pineSource` (`meta` is ignore-and-preserve in `defSchema`, so no schema change).
  Never compute: `ast_hash`/`treesHash`/`rev` ignore it. Own cap **128 KiB**
  (`PINE_SOURCE_MAX_BYTES`), NOT counted against the formula's 64 KiB or the runtime document's
  128 KiB (a long, commented script must not make small maths unsaveable).
* **`settle_for_save`** (called by `user_definitions.save` and `_save_runtime`): a string is
  size-checked, dropped when the saver's stage does not admit authoring (`pine_source: withheld`
  + the sentence, in the save response), dropped as a duplicate when it equals a runtime/hybrid
  document's own lane source (reopen reads the lane's copy); `null` forgets it; an ABSENT field
  is **carried** from the previous version when the maths did not move (a rename, a colour, any
  read-modify-write that never knew the field) — and regardless of the stage, which gates
  authoring and never deletes; a maths change with no source carries nothing.
* **Stage `PINE_AUTHORING_STAGE`** (off/admins/all; unset/empty/unrecognised = off; missing role =
  member), read per request, `PINE_AUTHORING_MODE_FLAGS` for the flag index, declared dark in
  `docs/feature_flags.json`. Auth payload key `pine_authoring_enabled`
  (`api/routers/auth.py::_pine_authoring_flag`, always a boolean, never raises).
* **Privacy:** every store read is keyed on the caller (unchanged) — another member's id is a 404
  on GET/`?version=`/history/PUT/DELETE/share and never appears in their list. The **list** route
  serves a `pine_source` summary (`{bytes, licence}`) instead of the text (it is read on the chart
  path); `GET /{def_id}` and `/history` serve the text to the owner.
* **Licence (O1):** `for_recipient` — the one door a document leaves its owner by
  (`resolve_share`, which both the preview and `install_share` read) — strips `meta.pineSource`
  unless `corpus_licence.is_permitted` (MPL-2.0/MIT/Apache-2.0 header; imported, never restated),
  stamping `meta.pineSourceWithheld` with the reason; a client-supplied withheld note is dropped.
  ⛔ FAIL CLOSED: an unimportable/raising predicate strips. A **runtime or hybrid** document's
  Pine IS its implementation, so instead of stripping it is **refused** (`ShareRefused('licence')`,
  HTTP 409) at `share`, at `publish` (worded for List) and again at `resolve_share` unless every
  Pine text it carries is permissive. The public library returns no definitions (metadata only),
  and its tokens resolve through the same door.

### 6.2 Client

* **Gate:** `pineAuthoringEnabled()` = build flag `VITE_PINE_AUTHORING_ENABLED === '1'` **AND** the
  per-member latch (`src/lib/pineAuthoringPermission.js`, fed by `AuthContext`, latched per tab,
  nothing latched = not permitted). Still one consumer (`BuilderSheet`).
* **Editor** (`pineEditor/PineEditor.jsx`): Name field (`meta.name`, applied at store time — no
  re-translate per keystroke); **Save** (store, no chart instance) beside **Add/Update on chart**;
  every store write carries `withPineSource(…, settled)` — the settled text the build was made
  from; a `withheld` answer is shown with the server's sentence.
* **My scripts** (`pineEditor/MyScripts.jsx`, pure half `pineScripts.js::pineScriptsOf`): rows the
  store says carry a source; **Open** (`fetchUserDefinition` → editor text, edit target, name,
  stored input values), **Rename** (read row → `meta.name` → PUT through `storePine`), **Versions**
  (`/history`; tombstones and source-less versions labelled) + **Restore** (the old version's
  document stored again as the newest version — append-only — then opened), **Delete** (arms
  first; soft delete; the script's instances leave this chart; the editor stops pointing at it).
* **Inputs** (`pineEditor/InputsPanel.jsx`): `ParamControls` over the preview document with the
  member's values applied by `applyInputValues` → `applyParamEdit` (atomic — a refused value is
  named and the preview keeps the last good values; never half-applied). Values are keyed by the
  input's NAME, so inserting an input never moves an override onto another knob; a value whose
  input disappeared is reported stale and skipped. H10 locks (`built.lockedKnobs`) are listed
  with `knobLockedNote`'s sentence and no control. `MemberPane` takes `inputValues` and installs
  the edited preview; Apply stores the same edited document; the source is never rewritten.
  Reopening reseeds the values from the stored trees (`inputValuesOf`).

### 6.3 Rails and mutation checks

Server `tests/test_pine_authoring_persistence.py` (30). Client
`pineEditor/pineScripts.test.js` (8), `pineEditor/pineEditorPersistence.test.jsx` (10),
`engine/__tests__/pineAuthoringGate.test.js` (stage cases). Mutation-checked (copy/restore, each
reverted): see the A2 lane report — stage gate (server `permitted`, client AND), licence strip
(`for_recipient`), share/list/resolve refusal, carry rule, ownership keying, input-value
atomicity, the source on Apply.

### 6.4 Not done / next

* A6 (Pine autocomplete/hover/folding; find/replace waits on a dependency ruling), A7, A8, A9
  (device + 390/820/1200 iframe walk of the new panels is OWED — not walked).
* An "Edit script" entry from the indicator library / chart legend into the editor (A3's second
  door); "Duplicate" in My scripts.
* Owner decisions: see §5 (O5–O7 added).

## 5. Owner decisions needed

* **O1 — store the member's Pine source.** Required for reopen/edit/version (A2–A4). It puts
  member-pasted third-party source in our DB; `docs/pine/LICENSING.md` governs what we COMMIT,
  not what a member stores for themselves, but a stored script that is later SHARED or LISTED
  publicly redistributes it. Proposed: store it, private to the owner by default, and strip it
  from share/listing payloads unless the script declares an MPL-2.0/MIT/Apache-2.0 header (the
  same predicate as `tools/pine_survey/corpus_licence.py`).
* **O2 — editor library.** CodeMirror 6 is installed and already used (no new dependency for
  A1). Find/replace needs `@codemirror/search` (a new npm dependency → needs a lockfile change,
  which this lane may not make). Monaco is not recommended: several MB, no mobile story.
* **O3 — rollout.** `VITE_PINE_AUTHORING_ENABLED` is a build constant (all members or none).
  Option: pair it with a per-member server permission the way `PINE_RUNTIME_STAGE` does
  (off/admins/all) so admins can use the editor in production first.
* **O4 — Apply does not close the sheet** (unlike `attachPine`). Chosen because an editor is a
  loop; confirm. → **Confirmed 2026-10-04.** O1–O3 ruled the same day (see §6).
* **O5 — runtime/hybrid documents under a non-permissive licence are UNSHAREABLE** (A2 refuses
  rather than strips, because their source is their implementation). Alternative: share a hybrid
  without its `objectsRun` (plots only, no drawings). Not built; say if wanted.
* **O6 — should the Import tab's "Add this script to my chart" also keep the source?** A2 keeps it
  only for documents written from the Pine Editor (the stage-gated authoring surface). → **YES (ruled
  2026-10-04), built by A6** (§7.1); O5 → keep; O7 → yes as built (both ruled 2026-10-04).
* **O7 — what Apply stores for edited inputs.** A5 stores the preview's edited values in the trees
  (the source keeps the author's defaults), and reopening reseeds the panel from them. The
  alternative is preview-only values (Apply always stores the script's defaults).

---

## 7. What A6 / A7 / O6 / A9 shipped (dark, branch `pine/a6-editor-intelligence`)

### 7.1 O6 — the Import tab's attach keeps the source

`MemberPane` hands its attach door the text it BUILT the document from (`onAttach(def, {source})`);
`BuilderSheet.attachPine` stores it with `withPineSource` through the same `storePine` door the
editor uses, behind the same `pineAuthoringEnabled()` gate. The server's rules are the A2 rules
(private, stage-dropped, licence-stripped). Authoring dark ⇒ the posted document is byte-identical
to before. Rail: `pineEditor/importKeepsSource.test.jsx`.

### 7.2 A6 — Pine-aware editing (CodeMirror 6, installed packages only)

* **Vocabulary, derived** (`builder/editor/pineVocabularyDerive.js` → frozen
  `pineVocabulary.json`, 180 rows). WHICH names: the engine's tables — closed-table `functions`
  (via `parse.js::TABLE`), `PINE_CALL_SHAPES`, `PINE_SHORT_FORM`, `BUILTIN_CALL_TREE` and every
  exported built-in tree (`PINE_NAMESPACED_TREE`, `barstate.*`, `timeframe.*`, `syminfo.*`,
  `dayofweek.*`, `math.pi`, output/paint calls, folded `input.*`, the palette), normalised with the
  translator's own rule. HOW each is SPELLED per version: the committed corpus
  (`corpus/committed` + `tests/fixtures/pine_community`, 296 scripts) lexed with the engine's
  `lexPine` — the translator resolves `ta.sma` and `math.sma` alike, so it cannot say which one
  TradingView means. Every spelling must be RESOLVED by the host-lane translator in that version
  (`translatorResolves`). v4 offers `sma(`, v5/v6 `ta.sma(`; v5 and v6 fill each other's gaps, v4
  borrows nothing. `ta.max` is excluded because the engine owns `math.max` (Pine's `ta.max(x)` is a
  different function). Regenerate after a deliberate table/corpus change:
  `UPDATE_PINE_VOCAB=1 npx vitest run src/components/chart/builder/editor/pineVocabulary.test.js`.
* **Completions** (`pineVocabulary.js::pineCompletionSource`): version read from `//@version=` by
  `lexPine`; none inside a comment or string; calls insert their `(`.
* **Hover docs** (`pineHover`): the closed table's own `sentence`, Pine's argument order from the
  measured shape plan (`ta.stoch(close, high, low, period)`) or `PINE_ARG_NAMES`, plus the entry's
  `vendorNote`. No TradingView reference text is restated (the extracted reference JSON is not in
  the repo — `docs/pine/pine-reference-extraction.md`).
* **Folding**: indentation `foldService` + `foldGutter` + `foldKeymap`; bracket matching was already
  on. **Find/replace still deferred** (O2: `@codemirror/search` is not installed).
* `CodeEditor`: dialect `pine` gets all of the above (the Pine Editor AND the Import box); every
  other dialect is unchanged.
* **"Edit script"**: `ChartToolbar` (owner of the one builder sheet) exposes `openPineScript(defId)`
  / `canEditPineScripts()`; the indicator library shows "Edit script" on the member's own Pine rows
  whose code the store kept (`pineScriptsOf`); the legend chip menu shows it for a stored
  (`^u_[0-9a-f]{12}$`) user definition carrying a translator stamp (`recurrenceOrigin` /
  `lane: 'runtime'`). `BuilderSheet editScript={defId, at}` opens it on the Pine Editor tab; the
  store's sentence is shown when it cannot. The gate census now names two consumers
  (`BuilderSheet.jsx`, `ChartToolbar.jsx`).
* **Duplicate** in My scripts: the owner's row read WITH its script, renamed `<name> copy`, stored
  as a NEW definition (create), opened as the edit target; not added to the chart.

### 7.3 A7 — the lane line

`authoringDiagnostics.laneStatus(built)` → the editor's `pine-editor-lane` line: *Drawn by the host
lane* (and whether its drawings come from a per-bar run), *Drawn by the per-bar lane* (with the
outputs it withholds), or *Not drawn: <the door's reason, verbatim>* plus the per-bar lane's own
`runtimeDeclined.why` when it was asked and declined (never repeated when the reason already quotes
it). Apply already renders the store's refusal verbatim (runtime save door included).

### 7.4 A9 — device walk (2026-10-05; local backend, build flags + `PINE_AUTHORING_STAGE=admins` locally)

Walked `/charts` → indicator library → New formula → Pine Editor at 390×844 (touch), 820×1180
(touch) and 1200×900 (desktop): template loaded, saved (My scripts row: Editing / Rename /
Duplicate / Versions / Delete), My scripts expanded, Inputs panel present. Sheet geometry: 390 =
full-width bottom sheet (left 0, width 390); 820 = centred 720 px sheet; 1200 = centred 640 px
modal. Page horizontal overflow 0 at every width.

**Fixed:**
1. **Builder mode tab row** (`BuilderSheet.module.css .modeRow`) — with the Pine Editor tab the six
   tabs overflowed the sheet body at 390 (scrollWidth 513 / client 388; `Screenshot` and `Formula`
   off-screen). It wraps on touch now; re-walk: no overflow.
2. **Inputs panel number field** (`param-input-__uct_param_*`, `ParamControls` inside
   `InputsPanel`) — 32 px tall at 390, 28 px at 820. Raised to `--tap-min` on touch, scoped to the
   Inputs panel.

**Named, not fixed (outside the authoring panels):** the preview chart's own chrome inside the
sheet — its drawing toolbar (`_tools`, an intentional horizontal scroller, 40 px buttons), range
buttons 3M/6M/YTD/1Y/5Y (27–39 px wide), price-scale A/L/% toggles (11 px tall at 820) and the
legend's "Show 2 more indicators" chip (14 px tall); and the Formula tab's plot row "Hide plot 1"
checkbox (13 px), which still renders in editor mode together with the sheet footer's formula
**Save** — two Save buttons on the Pine Editor tab is a UX defect for the editor's owner.

### 7.5 Rails and mutation checks

New: `pineEditor/importKeepsSource.test.jsx` (3), `editor/pineVocabulary.test.js` (13),
`editor/CodeEditor.pine.test.jsx` (4), `pineEditor/editScriptDoors.test.jsx` (10),
`pineEditor/laneStatus.test.jsx` (9). Mutation-checked (copy/restore, each reverted, all KILLED):
O6 source not carried / gate dropped / MemberPane not handing the source; the derivation's
owned-elsewhere rule and translator filter; the version read; the comment guard; the dialect
completion source; the Pine aids compartment; the lane runtime branch / decline de-dupe / lane
render; the editScript gate; Duplicate as a create; the library row's stopPropagation; the toolbar
gate; the chip-menu caps.
