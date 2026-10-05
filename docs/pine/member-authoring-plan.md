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
| A2 | **Persist the Pine source with the document** (e.g. `meta.pineSource` or a sibling column), never used for compute — the trees stay the authority; size accounted in the cap | **O1** | next |
| A3 | Reopen a saved Pine script in the editor (from the indicator library / legend "Edit script") → Update on chart across sessions; rename; delete; version list + restore over `GET /{def_id}/history` | A2 | |
| A4 | "My scripts" panel in the editor: the member's Pine documents, open/duplicate/delete | A2 | |
| A5 | Inputs panel in the editor, bound to the PREVIEW instance (values never rewrite the source), mirroring TradingView's Settings → Inputs | — | |
| A6 | Pine-aware autocomplete + hover docs from `PINE_CALL_SHAPES` / `closedTable.json`; folding (`foldGutter`, already installed); find/replace | **O2** for search | |
| A7 | Runtime-lane authoring: when the pane routes a script to the per-bar lane, say so in the status line; Apply honours the runtime save door's sentences | runtime flags | |
| A8 | Multi-error compile: ask the engine lanes for a "collect all walls" translation mode so the list shows every problem, not the first | engine lanes | |
| A9 | Device + iframe walk (390/820/1200), screenshot evidence, then the rollout decision | A1b | |

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
  loop; confirm.
