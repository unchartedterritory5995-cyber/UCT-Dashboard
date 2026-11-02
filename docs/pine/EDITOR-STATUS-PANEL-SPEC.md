# Pine editor status panel: spec

Programme: Pine full parity (`_resume-2026-11-01/PINE-FULL-PARITY-PLAN.md`, mockups 3.1 to 3.3).
Workstream: EDITOR. Branch `feat/pine-editor-status`. Build flag `VITE_PINE_EDITOR_STATUS`
(default off, ships dark).

## 0. The promise

A Pine author on the Builder's Pine tab sees, for the script in the editor:

1. where it runs (chart, alerts, screener, scans),
2. which engine lane runs it,
3. every value we withhold, on the line that causes it, in plain English,
4. what still works,

and never a silent wrong value. The panel decides nothing. Every fact on it is read from
a reader that already exists and is already the authority for that fact. The panel adds
exactly two things of its own: a plain-English heading per refusal FAMILY (section 4) and
the line mapping (section 6). The engine's own sentence is always shown too, verbatim.

## 1. Where it lives

```
BuilderSheet (Pine tab)
  ImportBox -> PasteBox (PineBox.jsx)
     textarea / CodeEditor            <- per-line marks (lineMarks prop, section 6)
     report: pine-meta, import-outcome, ImportGapNotice, refusal, outputs ...
     PineEditorStatus                 <- NEW, only when VITE_PINE_EDITOR_STATUS === '1'
```

* `builder/editorStatusGate.js::editorStatusEnabled()` is the ONE reader of the flag
  (`=== '1'`, fails closed with no `import.meta.env`), like `memberPaneGate.js`.
* Off: PasteBox renders byte-for-byte what it rendered before; `CodeEditor` receives no
  `lineMarks` prop and dispatches exactly the diagnostics it dispatched before.
* The panel renders only for a Pine report (`report.dialect === 'pine'`). thinkScript, TC2000
  and native formulas keep the I2 four-class verdict (`importVerdict.js`), which owns them.

## 2. Inputs, and the one reader for each fact

| fact | reader (file :: function) | notes |
|---|---|---|
| what the paste translated to, per output, with each refusal `{guard, message, line, column, token}` | `PineBox.jsx::inspectSource` (the report PasteBox already holds) | refusal text verbatim |
| the import verdict (exact / disclosed / partial / unsupported / error) and its `missing` / `semantic` lists | `engine/ast/importOutcome.js::importOutcome` (`report.outcome`) | Pine is passthrough in `importVerdict.js`, so `importOutcome` is Pine's verdict |
| which TradingView built-ins the paste lost (closed allowlist) | `supportLoop/importGaps.js::importGaps` | feeds the support-loop log and dialog |
| what a CHART would draw, and which lane draws it | `builder/memberPane/memberPaneDefinition.js::memberPaneDefinition({source})` -> `{ok, reason, guard, lane, notes, requirementTags, definition}` | the same door "Add to chart" and the saved-script upgrade use. `lane === 'runtime'` = per-bar runtime lane, else host lane |
| per output, per consumer: can it run there | `engine/evaluability.js::evaluability(def, key, lane)` for `LANES.CHART`, `LANES.ALERT`, `LANES.SCAN` over the pane document's data plots | the shared P1 gate; its alert answer is held equal to `alert_user_series.py` by `tests/fixtures/ast/p1_evaluability_alert.json` |
| which consumers refuse a requirement tag (`window_dependent`, `occurrence_dependent`) | `closedTable.json::_requirement_tags[tag].refused_by` via `parse.js::TABLE` | the same roster `user_definitions.consumer_refusal` reads; consumer names `alert`, `screener`, `sweep` |
| plots that may be withheld on some charts (code that does not run on every bar, C45/C48) | each report output's `_blockRuns` gates `{why, guard, what}` (`pine.js`), checked at bind by `engine/blockRuns.js::blockRunsRefusal` and on the server by `api/services/block_runs.py` | data-dependent: the panel says "may be withheld on some charts", never "withheld" |
| a SAVED version held by the script engine (#673/#675) | the served row's `scan_refusal` when `gate === 'withheld'` (`routers/user_definitions.py::_stamped` <- `user_definitions.engine_withheld_reason`) | shown verbatim; only when the Builder is editing a saved row |
| runtime-lane disclosures (what the runtime document does not draw) | `memberPaneDefinition(...).notes` (`{name, note}`) | verbatim |
| withheld paints (`bgcolor` / `barcolor`) | `report.presentation.paints[].withheld.reason` | verbatim |

The pure module `builder/editorStatus.js::editorStatus({report, pane, savedRow})` folds these
into one status object. It never throws (a throw becomes the ENGINE FAULT state) and writes
nothing.

## 3. Panel states

| state | when (first match wins) | headline (exact copy) |
|---|---|---|
| `hidden` | flag off, no text, or a non-Pine report | (panel not rendered) |
| `checking` | the editor text differs from the text the shown report was computed on (the 250 ms debounce window) | `Checking your script...` |
| `engine-error` | `outcome.verdict === 'error'` | `Our engine failed on this script. This is our fault, not your script's, and it has been logged.` |
| `not-yet` | no consumer can run anything (`chart`, `alerts`, `screener`, `scans` all no) | `Not yet: needs <family label of the first blocker>` |
| `runs-withheld` | something runs, and at least one withheld item exists | `Runs, <n> value(s) withheld (not guessed)` |
| `runs-with-notes` | something runs, nothing withheld, but there are disclosed differences or may-be-withheld plots | `Runs, with <n> note(s)` |
| `runs` | everything runs and nothing is withheld or disclosed | `Runs fully` |

Below the headline, always in this order:

1. **Runs on** (section 5): four rows, each `[OK]` / `[--]` / `[~]` with a short reason.
2. **Engine**: `Engine: host (fast path)` or `Engine: runtime (runs bar by bar, chart only)`.
3. **Withheld** list (section 6): one row per item, with a real `Line N` button that moves the
   editor caret to that line, the source line itself, `Why:` the family's plain sentence, and a
   `Details` disclosure holding the engine's own sentence verbatim.
4. **May be withheld on some charts** list (block-runs gates), same row shape.
5. **Notes** (disclosed differences: `outcome.semantic`, runtime-lane `notes`), verbatim.
6. **What still works**: `What still works: <n> plot(s)` plus `and its drawings` when the
   object program draws, or `Nothing else runs yet.`
7. `Tell us you need this` (only when the support-loop report door is on,
   `useReportsConfig().reportsEnabled`): opens the existing `LazyReportMismatchDialog` with
   the same payload `ImportGapNotice` sends (`gapLogPayload(importGaps(report))`). The gap LOG
   (A2) is not duplicated: `ImportGapNotice` stays mounted and still logs once.
8. The policy line: `Anything we cannot compute the way TradingView does is withheld and
   named here, never guessed.`

Verified-vs-TradingView (mockup 3.1, `[i] Verified vs TradingView: yes`) is NOT shown in this
version: no client-side reader of the capture registry exists, and a panel that printed
"verified" without one would be the second source of truth this spec forbids. It is a
follow-up that needs a served, per-script capture verdict.

## 4. Refusal families: plain-English copy

A family is chosen from the guard by `editorStatus.js::familyOf(guard)` (exact names first,
then prefixes). The family supplies a LABEL and a WHY sentence. The engine's sentence is never
replaced, only placed under `Details`. A guard no rule matches falls to `unknown`, which is
honest but generic; the rail `editorStatus.families.test.js` reads every `'pine:*'` and
`'runtime:*'` guard literal out of `pine.js` and `runtime/*.js` and fails BY NAME for any that
falls to `unknown`, so a new guard must be given a family when it ships.

| family | guards (prefix or exact) | label | Why: |
|---|---|---|---|
| `request` | `pine:request`, `runtime:request*`, `other-symbol:*`, `lower-tf:*`, `bind:period-reads` | Data from another symbol or timeframe | This asks for prices from another symbol or timeframe that we cannot supply exactly yet, so the value is withheld rather than guessed. |
| `strategy` | `pine:strategy-*`, `pine:declaration-strategy`, `runtime:strategy-*` | Strategy orders and backtests | Strategy orders, fills and the backtest do not run here yet. The plots in a strategy can still be drawn. |
| `drawing` | `pine:drawing`, `pine:object-*`, `runtime:object*`, `pine:objects-only` | Lines, labels, boxes and tables | We cannot yet make this drawing exactly the way TradingView does, so it is not drawn. |
| `state` | `pine:state`, `pine:reassign`, `pine:history-ref`, `pine:live-bar-state`, `pine:na`, `runtime:history-*`, `runtime:conditional-history`, `runtime:varip`, `runtime:realtime-untold`, `runtime:call-*-state`, `runtime:input-state`, `runtime:function-global-state`, `runtime:chart-clock`, `runtime:clock-zone` | Values carried from bar to bar | This value depends on what the script remembered on earlier bars, in a way we cannot reproduce exactly yet. |
| `block` | `pine:block` | Code that does not run on every bar | On a chart where this code skips a bar and then runs again, TradingView's value depends on history we do not keep, so the plot is withheld on that chart. |
| `collection` | `pine:collection`, `pine:type`, `pine:member`, `pine:vector*`, `pine:tuple`, `runtime:array`, `runtime:udt*`, `runtime:tuple`, `runtime:prop` | Arrays, maps and custom types | Collections and custom types are not computed here yet. |
| `function` | `pine:function`, `pine:function-def`, `runtime:function`, `runtime:recursion`, `runtime:unbound`, `runtime:discarded-value` | Your own functions | This function is written in a way we cannot run exactly yet. |
| `builtin` | `pine:builtin`, `pine:arity`, `pine:named-argument`, `pine:undefined`, `runtime:builtin-args`, `runtime:call-undeclared-builtin-state` | A TradingView built-in we do not compute yet | This built-in is not computed here yet, so anything that reads it is withheld. |
| `library` | `pine:module`, `pine:declaration-library`, `runtime:library` | Imported libraries | This script imports a library we cannot load yet. |
| `input` | `pine:input-kind`, `runtime:member-inputs` | Inputs | This kind of input cannot be offered here yet. |
| `presentation` | `pine:colour-value`, `pine:text-value`, `pine:plot-offset`, `pine:offset-*`, `pine:alert-message`, `paint:*`, `runtime:colour`, `runtime:presentation`, `runtime:fill-*`, `runtime:plot-id` | How it is drawn | The value is computed, but this way of drawing it is not supported yet, so it is not drawn rather than drawn differently. |
| `limits` | `pine:window`, `pine:window-dependent`, `pine:budget`, `pine:timeout`, `runtime:limit`, `runtime:time-budget`, `runtime:calc-bars-*`, `runtime:history-start`, `runtime:warmup-never-converges`, `chart:scalar-current-only` | History and compute limits | This needs more history or more computing than a chart here allows, so it is withheld. |
| `language` | `pine:statement`, `pine:operator`, `pine:character`, `pine:cycle`, `pine:roundtrip`, `pine:role-order`, `pine:empty`, `pine:declaration`, `pine:offset-literal`, `pine:chart-only`, `runtime:statement`, `runtime:expression-statement`, `runtime:loop*`, `runtime:switch`, `runtime:block-value`, `runtime:operator`, `runtime:directive`, `runtime:declaration`, `runtime:version`, `runtime:lower`, `runtime:empty`, `runtime:udt-method`, `runtime:call-text-state` | A Pine construct we do not run yet | This line uses a part of the Pine language we cannot run exactly yet. |
| `shape` | `pine:no-output`, `pine:hidden-only`, `pine:constant-only`, `pine:presentation-only`, `runtime:no-output`, `runtime:object-tree-outputs` | Nothing a chart can draw | The script has nothing a chart can draw: no visible plot, or only constant or hidden values. |
| `fault` | `import:internal-error`, `runtime:worker-*`, `runtime:failed`, `runtime:build`, `runtime:unnamed-refusal`, `runtime:not-from-listing` | Engine fault | Our engine could not finish this script. That is on us, not your script. |
| `held` | (saved row, `scan_refusal.gate === 'withheld'`) | Held by the script engine | Today's script engine has not accepted this saved version, so alerts, screens and scans hold it until it is saved again from the Pine tab. |
| `unknown` | anything else | Not supported yet | This part is not supported yet, so its value is withheld rather than guessed. |

No copy in this table, and no copy the panel writes, contains an em dash.

## 5. "Runs on": derivation

Computed by `editorStatus.js::runsOn(pane, savedRow)` on the PANE document
(`memberPaneDefinition`), because that is the document a chart attach installs and the
saved-script upgrade writes. Data plots = `definition.plots` that are not `hlines` guides
(same predicate as `nativeRegistry.astPlotKey` / `evaluability.dataPlotKeys`).

| consumer | OK when | `[--]` reason (first that applies) |
|---|---|---|
| chart | `pane.ok` and at least one data plot is not refused by `evaluability(def, key, LANES.CHART, {})`, or the document draws objects/paints | `pane.reason` verbatim, under the family of `pane.guard` |
| alerts | some data plot answers `supported` for `LANES.ALERT`, and no raised requirement tag lists `alert` in `refused_by` | runtime lane: "Alerts run on the server, which cannot run the bar-by-bar engine yet." Requirement tag: "It uses <calls>, whose value depends on how much history is loaded, so alerts refuse it." Else the first plot's `evaluability` reason verbatim |
| screener | some data plot answers `supported` for `LANES.SCAN`, no raised tag lists `screener` | runtime lane: "Screens run on the server, which cannot run the bar-by-bar engine yet." Tag: as alerts. No condition plot: "A screen needs a yes/no plot (for example `close > ta.sma(close, 50) ? 1 : 0`)." |
| scans | as screener, with consumer `sweep` | as screener |

Then, when the Builder is editing a saved row whose served `scan_refusal.gate === 'withheld'`,
alerts, screener and scans all become `[--]` with that `detail` verbatim (family `held`): the
server lanes hold that stored version whatever the editor shows. The chart row is not changed
(the chart draws today's translation).

`[~]` (partial) is shown for chart when it draws but something is withheld, and for
alerts/screener/scans when the answer is `supported` with `final: false` the row adds
`(the server re-checks when you save or arm it)`. The panel never says a server lane WILL run
something; `evaluability` is a preflight and the server is the authority.

## 6. Line mapping

`editorStatus.js::lineMarks(status, docText)` turns status items into per-line marks:

* an item's line is, in order: its refusal's `line` (translator, 1-based), else its output's
  `line` (where `plot(...)` was written), else none.
* a line outside `1..lineCount(docText)` is DROPPED, never clamped (a clamped line is a mark on
  the wrong line).
* items with no line are listed in the panel as `This script` and get no mark.
* one mark per line; several items on one line join their messages; the worst severity wins
  (`withheld` > `may-withhold` > `note`).
* marks carry `source: <the text the report was computed on>`. `CodeEditor` applies them only
  while `lineMarks.source === view.state.doc.toString()`, the same stale-text contract as the
  refusal diagnostic (X13). A stale mark is no mark.
* `CodeEditor` renders a mark as a CodeMirror lint diagnostic over the whole line, severity
  `warning` (withheld), `info` (may-withhold, note). The existing single refusal diagnostic is
  unchanged and still `error`.

The `Line N` button in the panel scrolls the editor to that line and places the caret at its
start (`CodeEditor` ref `.view()`), and falls back to the textarea's selection when the
CodeMirror editor has not loaded.

Mutation proof (rail `editorStatus.mapping.test.js`): each of these, removed, turns a named
case red: the out-of-range drop, the refusal-line-over-output-line priority, the severity
merge, the stale-source gate in `CodeEditor`.

## 7. Paste-from-TradingView flow (mockup 3.3)

1. Paste source into the Pine tab (the existing CodeEditor). Pasting a TradingView URL is NOT
   built here: fetching a script from TradingView needs a server fetch path and a licence check
   per script (`docs/pine/LICENSING.md`), which is a separate decision.
2. Within the 250 ms debounce the panel shows `Checking your script...`, then one of
   `Runs fully` / `Runs, N values withheld (not guessed)` / `Runs, with N notes` /
   `Not yet: needs X`.
3. The actions stay the Builder's existing doors (Use this formula, Save, Add to chart from
   the chart). The "Runs on" rows tell the author which of those doors will accept the script
   before they press one; the panel adds no new save path.
4. When anything is withheld, `Tell us you need this` opens the existing support-loop report
   ("Doesn't match TradingView?"), pre-filled with the same allowlisted gap names.

## 8. Mobile and accessibility

* Breakpoints from `styles/breakpoints` via `hooks/useBreakpoint`: on touch (`useIsTouch`,
  <= 1024 px) the panel collapses to one summary row (headline + `Details` button,
  `aria-haspopup="dialog"`) that opens the full panel in `mobile/Sheet` (`variant="auto"`).
  Above 1024 px it renders inline under the editor.
* Every action is a `<button type="button">` with an `aria-label` that names the line
  (`Go to line 14`). Tap targets use `var(--tap-min, 44px)` below 1025 px.
* The headline is `role="status"` (polite), so a screen reader hears the verdict change after a
  paste without focus moving.
* Status words never rely on colour alone: `[OK]`, `[--]`, `[~]` text badges carry the meaning.

## 9. Flag and ledger

* `Dockerfile.web`: `ARG VITE_PINE_EDITOR_STATUS` and the `ENV` mirror line.
* `docs/feature_flags.json::build_flags.VITE_PINE_EDITOR_STATUS`: status `dark`, railway UNSET,
  with the flip precondition (an owner look at the panel on the three mockup scripts on a
  phone and a desktop).

## 10. Not in this version (named, not hidden)

* Verified-vs-TradingView line (needs a served capture verdict per script).
* TradingView URL import (needs a server fetch + licence decision).
* New action buttons (the existing doors are reused).
* Server-side interpreter (W5): until it lands, a runtime-lane script reads `[--]` for alerts,
  screener and scans, by name.
