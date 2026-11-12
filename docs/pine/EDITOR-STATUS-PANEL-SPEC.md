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
a reader that already exists and is already the authority for that fact, and each consumer
row answers from the lane that consumer ACTUALLY uses (the chart door's own verdict for the chart;
for alerts, screens and scans every stored definition those lanes read, which the report's "Use this
formula" and the Pine tab's attach both write; section 5). The panel adds
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
| what a CHART would draw, and which lane draws it | `builder/memberPane/memberPaneDefinition.js::memberPaneDefinition({source})` -> `{ok, reason, guard, lane, notes, requirementTags, definition, rows, translation, withheld}` (the CHART DOOR) | the same door "Add to chart" and the saved-script upgrade use. `lane === 'runtime'` = per-bar runtime lane, else the strict host lane. ⛔ Asked for EVERY Pine report that is not an engine fault or a foreign language, whatever `report.ok` says (`PineEditorStatus.jsx::paneFor`). ⛔ THE CHART ROW AND THE PER-LINE WITHHELD LIST COME FROM THIS DOOR ALONE (section 5). ⛔ The chart row is the door's OWN verdict (`pane.ok` and its document's rows), never re-asked: an `evaluability(.., LANES.CHART, {})` with a binding context the door did not use refuses every other-symbol read (no chart symbol, no store, no secondary bars: "`AMEX:SPY` is not a listing our bar store holds") that the chart's bind serves |
| Screener and Scans: what a stored definition can screen | every stored definition the screener and the sweep read: My Scans lists each one the server stamps scannable (`components/screener/scanSession.js::scannableScreens` over `routers/user_definitions.py::_stamped`, which runs `scan_definition.assert_scannable` on every stored row). Two doors write one. "Use this formula": the report (`inspectSource`, the screener lane's translation); the box offers its outputs only while `report.ok`, and offers exactly `usable` (a formula, not hidden, `PineBox.jsx::PasteBox`); each is asked `evaluability(doc, key, LANES.SCAN)` over `doc` = those outputs' own trees (`editorStatus.js::reportLane`). The Pine tab's attach: the chart door's host document (`BuilderSheet.jsx::attachPineAs`), asked `evaluability(def, <scan plot>, LANES.SCAN)` (`editorStatus.js::attachScan`). Any yes is a yes | `evaluability` reads only `compute.kind`, the plot keys and each plot's own tree, and the saved document carries exactly those trees (C2D.1: one translation result), so this asks it what it would ask of the saved screen. ⛔ `assert_scannable` walks `compute.ast` ALONE, the plot `compute.scanPlot` names (a one-plot document's one plot): the attach route is a screen exactly when that plot is, never because a later row is a condition. Only an `ast` document (the server refuses a runtime one by its `kind` gate) and only a shown scan plot. ⭐ A number the box's threshold control can make a screen of (`toCondition.js::conditionFrom`; the box shows the control for a formula that does not `yieldsCondition`) stays `[--]` and reads "needs a threshold" |
| Alerts: what the alert lane can arm | every stored definition of the account (`alert_user_series.py::user_catalog` over `user_definitions.list_for_user`). Two doors write one: "Use this formula" (the report lane above, then the Formula tab's save), and the Pine tab's attach (`BuilderSheet.jsx::attachPineAs`, the chart door's document). Each shown plot is asked `evaluability(..., LANES.ALERT)`; any yes is a yes | ⛔ An `alertcondition` reaches alerts through "Use this formula" ONLY: `memberPaneDefinition.js` drops `kind === 'alertcondition'` from `carryable` (ruling D1), and the report offers it as a column. A runtime document is refused by the alert lane's `lane` gate (`compute.kind !== 'ast'`), which `evaluability` already answers |
| screener-lane refusals of single plots | the report's outputs with no formula (`refusal`), or whose formula the formula lane cannot evaluate (`downstream.ok === false`) | named, verbatim, on the Screener and Scans rows (`refused`). ⛔ Never a withheld chart value, never a line mark, never "Tell us": the chart door may draw that plot (`ta.cum`, `barstate.isfirst`, the period anchors are refused by the screener lane at the door and drawn by the chart's host lane) |
| the alert lane's own refusal sentences | `evaluability.js::ALERT_SENTENCE` through `evaluability(..., LANES.ALERT)` | the shared P1 gate; its alert answer is held equal to `alert_user_series.py` by `tests/fixtures/ast/p1_evaluability_alert.json` |
| which consumers refuse a requirement tag (`window_dependent`, `occurrence_dependent`) | `closedTable.json::_requirement_tags[tag].refused_by` via `parse.js::TABLE`; the tags a document raises: `memberPaneDefinition.js::requirementTagsRaised` (the chart door's `requirementTags`; the report lane's document through the same function) | the same roster `user_definitions.consumer_refusal` reads; consumer names `alert`, `screener`, `sweep`. A tag refuses the whole document, as the server's `requirements` gate does |
| plots that may be withheld on some charts (code that does not run on every bar, C45/C48) | the pane document's `definition.meta.blockRuns.keys` (`{key, gates: [{why, guard, what}]}`), the stamp the chart's bind reads (`engine/blockRuns.js::blockRunsRefusal`; the server's twin is `api/services/block_runs.py`). The plot is named through `definition.plots` and the pane's `rows`: a row's tree IS its output's tree, so the output (title, `plot(...)` line) is found by identity; a derived colour column is named `colour of <plot>` | data-dependent: the panel says "may be withheld on some charts", never "withheld". Reason = the gate's `why`, verbatim. ⚰️ This read each report output's `_blockRuns`, which is non-enumerable and host-lane only, so it never reached the report and the list could never fill |
| plots that may be withheld on some chart periods (C29) | the pane document's `definition.meta.periodReads.keys` (`{key, names}`) | the bind refuses such a plot on a chart whose period gives a different value. Reason = `engine/periodReads.js::periodReadsRefusalFor(def, key, tf)`, verbatim, on the first period of the stamp's own ladder (`byTf`) that it refuses |
| a SAVED version held by the script engine (#673/#675) | `editorStatus.js::isHeld`: `memberPane/savedScriptUpgrade.js::upgradeKindOf(row) === 'refused'`, or `upgradeKindOf(row) === 'retranslate'` with `engine_status.status === 'refused'` (an older engine's refusal waiting for today's engine, `user_definitions.py::_awaits_retranslation`). Together the browser's twin of `user_definitions.engine_withheld_reason` | the saved version's OWN line (`editorStatus.js::savedVersion`, `Saved version: Held by the script engine.` + the family's sentence), detail = the row's `engine_status.reason`, verbatim; only when the Builder is editing a saved row. ⛔ Never a row: the rows answer for the editor's text. ⛔ ONLY WHILE THE EDITOR HOLDS THAT VERSION'S OWN SCRIPT (`row.pine_source`, or a runtime document's `compute.source`, equal to the inspected text). ⛔ NOT `scan_refusal.gate === 'withheld'`: the sweep's C45 check (`scan_definition.assert_scannable`) refuses under that same gate |
| the server's answer for screening a saved version | the served row's `scan_refusal` (`routers/user_definitions.py::_stamped`), any gate, when the version is not held | its `detail`, verbatim, on the saved version's OWN line (`Saved version, in screens and scans:`), beside the live rows. ⛔ NEVER on the Screener or Scans row: for a runtime document it is always the `kind` gate, which says nothing about what "Use this formula" would save. ⛔ ONLY WHILE THE EDITOR HOLDS THAT VERSION'S OWN SCRIPT, as above |
| what the chart door draws when it refuses the whole script | the chart door's own translation (`pane.translation`): each refused output, on its line, and its top refusal when that IS the door's refusal (`pane.reason`); else one item for a door refusal that has a guard | a host-lane refusal of one plot refuses the whole script, so the chart withholds every plot because of it. ⛔ A dirty objects-only program is refused for its lost removal while its translation carries `pine:objects-only` (a screening fact): that top refusal is not listed |
| a strategy's orders and backtest, a drawing program that lost a removal (missing parts) | `importOutcome` over the chart door's translation notes (`MISSING_PART_CODES`) and its object program (`assessObjectLoss`) | the report's lane refuses a strategy outright and names no parts; the chart door reads it and notes what it leaves out. ⛔ On the RUNTIME lane the lost removal is a withheld part only where the runtime document's own disclosure carries the same sentence (`objectLoss.js::objectLossNote(loss, {withheld: true})`: it holds the host program back); a runtime document that draws its own drawings (RT5) says nothing about the host program, so nothing is withheld for it |
| runtime-lane disclosures (what the runtime document does not draw) | `memberPaneDefinition(...).notes` (`{name, note}`) | verbatim. ⭐ Its `Not drawn by this pane` disclosure (`RUNTIME_UNDRAWN_KINDS`: a fill between two plots, a horizontal line, candles, bars) is a WITHHELD value per call it names (`editorStatus.js::runtimeUndrawn`), on the line the chart door's translation records for that call (a `fill` / `hline` by its own `pine:chart-only` note, candles and bars by their outputs; a kind it cannot locate is one item for the script), family `presentation` (`runtime:presentation`, the runtime lane's own guard for a presentation call it does not carry), the disclosure the reason. A kind the disclosure does not name is never listed. ⛔ A note whose sentence is already listed (a fold note the report's outcome also carries, a withheld paint's, row's or call's disclosure, the lost-removal sentence) is not listed again: one fact, one item |
| runtime-lane rows the document does not draw | `memberPaneDefinition(...).withheld` (labels) | a withheld value, named by its label, with the document's own disclosure (`<label> is not drawn: ...`) as the reason, on the plot's line where the plot is titled |
| withheld paints (`bgcolor` / `barcolor`) | HOST lane: the chart door's translation, `pane.translation.presentation.paints[].withheld.reason` (`pine.js::resolvePaints`). RUNTIME lane: the runtime document's own disclosure for the paint (`<paint> (line N) is not drawn: ...`); a host record it colours from its own run (`RUNTIME_PAINT_COLOUR_CODES`) is drawn and not listed | verbatim, as a withheld value on the paint's line |
| a level or a band the chart door does not draw (`hline`; a `fill` whose edges it does not carry) | the chart door's own translation notes (`pane.translation.notes`, code `pine:chart-only`) that say so: "`hline` is not drawn on this chart: ...", "`fill` is not drawn: ..." (`pine.js::chartOnlySentence`, host lane; `editorStatus.js::chartDoorUndrawn`) | a withheld value on its line, the note verbatim, family `language` (the note's own code), on EITHER lane: the chart door's document carries no horizontal level (no `levels`), and the runtime document carries none and says nothing of one. A band the door carries says so (`is carried as the band`) and is not listed. ⛔ A call the runtime document's own disclosure names on that line is that disclosure's item (one fact, one item) |

The pure module `builder/editorStatus.js::editorStatus({report, pane, savedRow, inspectedSource})` folds these
into one status object. It never throws (a throw becomes the ENGINE FAULT state) and writes
nothing.

## 3. Panel states

| state | when (first match wins) | headline (exact copy) |
|---|---|---|
| `hidden` | flag off, no text, or a non-Pine report | (panel not rendered) |
| `checking` | the editor text differs from the text the shown report was computed on (the 250 ms debounce window) | `Checking your script...` |
| `engine-error` | `outcome.verdict === 'error'` | the `fault` family's sentence: `Our engine could not finish this script. That is on us, not your script.` |
| `not-yet` | no consumer runs anything (`chart`, `alerts`, `screener`, `scans` all `[--]`, each from its own lane) | `Not yet: <family label of the first blocker>`, the label exactly as section 4 writes it. The blocker is the chart door's refusal guard when it has one, else the first withheld item, else the report's refusal |
| `runs-elsewhere` | the chart door draws nothing, and some other consumer runs | `<where>; the chart cannot draw it yet: <why>`, `<why>` = the family label of the chart door's guard, else the door's own sentence (`pane.reason`). When the door's refusal is its own guard-less `this script declares nothing a chart can draw` (an `alertcondition` alone, ruling D1): `<where>; nothing to draw on a chart`, since nothing is missing there is no "yet". ⛔ NEVER `Not yet` while any consumer runs |
| `runs-withheld` | the chart runs, and at least one withheld item exists | `<where>, <n> value(s) withheld (not guessed)` |
| `runs-with-notes` | the chart runs, nothing withheld, but there are disclosed differences or may-be-withheld plots | `<where>, with <n> note(s)` |
| `runs` | the chart runs, nothing withheld or disclosed | `Runs fully` ONLY when every consumer row runs; else `<where>; not in <what does not>` (`not in screens or scans`), and for screen rows the box's threshold control can satisfy `<what> need a threshold` (`screens and scans need a threshold`) |

`<where>` names what runs, each from its own row: `Runs` (all four), `Runs on the chart`,
`Runs on the chart and in alerts`, `Runs in alerts, screens and scans`. Screener reads
`screens`, Scans `scans`.

Below the headline, always in this order:

1. **Runs on** (section 5): four rows, each `[OK]` / `[--]` / `[~]` with a short reason.
   Then, only while the Builder edits a saved row whose own script the editor holds, the saved
   version's line (`Saved version: Held by the script engine. ...` or `Saved version, in screens
   and scans: <the server's sentence>`), beside the rows and never instead of them.
2. **Engine**: `Engine: host (fast path)` or `Engine: runtime (runs bar by bar, chart only)`.
3. **Withheld** list (section 6): one row per item, with a real `Line N` button that moves the
   editor caret to that line, the source line itself, `Why:` the family's plain sentence, and a
   `Details` disclosure holding the engine's own sentence verbatim.
4. **May be withheld on some charts** list (block-runs gates), same row shape.
5. **Notes** (disclosed differences: `outcome.semantic`, runtime-lane `notes`), verbatim.
   The Screener and Scans rows also carry the screener lane's refusals of single plots
   (`Plots it cannot use: N`, each named with the engine's sentence): never a line mark,
   never counted in the headline, never "Tell us".
6. **What still works**: the union of what each consumer row says runs, each from its own
   lane: `What still works: 2 plots on the chart; RSI and OB in alerts; OB in screens and
   scans.` (the chart's visible plots, `and its drawings` when the document draws an object
   program or paints; then each server consumer's own outputs, consumers with the same list
   sharing one clause), or `Nothing else runs yet.`
7. `Tell us you need this` (only when the support-loop report door is on,
   `useReportsConfig().reportsEnabled`): opens the existing `LazyReportMismatchDialog` with
   the same payload `ImportGapNotice` sends (`gapLogPayload(importGaps(report))`). The gap LOG
   (A2) is not duplicated: `ImportGapNotice` stays mounted and still logs once.
8. The policy line: `Anything we cannot compute the way TradingView does is withheld and
   named here, never guessed.`

The engine-fault state is reachable from the production door. A translator throw on an `auto`
paste becomes `importOutcome.controlledErrorReport`, stamped `formula` (unchanged, so nothing
that renders it moves); `PineBox.jsx::inspectSource` adds `faultDialect: 'pine'` when its own
detector had read the text as Pine, and `usePineEditorStatus` shows the panel for that report.

Verified-vs-TradingView (mockup 3.1, `[i] Verified vs TradingView: yes`) is NOT shown in this
version: no client-side reader of the capture registry exists, and a panel that printed
"verified" without one would be the second source of truth this spec forbids. It is a
follow-up that needs a served, per-script capture verdict.

## 4. Refusal families: plain-English copy

A family is chosen from the guard by `editorStatus.js::familyOf(guard)` (exact names first,
then prefixes). The family supplies a LABEL and a WHY sentence. The engine's sentence is never
replaced, only placed under `Details`. A guard no rule matches falls to `unknown`, which is
honest but generic; the rail `editorStatus.families.test.js` reads every `'pine:*'` and
`'runtime:*'` guard literal out of `pine.js`, `pineRuntimeFrontend.js` and `runtime/*.js` (and the
member door's two files) and fails BY NAME for any that
falls to `unknown`, so a new guard must be given a family when it ships.

| family | guards (prefix or exact) | label | Why: |
|---|---|---|---|
| `request` | `pine:request`, `runtime:request*`, `other-symbol:*`, `lower-tf:*` | Data from another symbol or timeframe | This asks for prices from another symbol or timeframe that we cannot supply exactly yet, so the value is withheld rather than guessed. |
| `period` | `bind:period-reads` | Values that depend on the chart's timeframe | This reads the chart's own timeframe. It was translated at one timeframe, so on a chart where that reading differs, the plot is withheld rather than drawn with the other timeframe's value. |
| `strategy` | `pine:strategy-*`, `pine:declaration-strategy`, `runtime:strategy-*` | Strategy orders and backtests | Strategy orders, fills and the backtest do not run here yet. The plots in a strategy can still be drawn. |
| `drawing` | `pine:drawing`, `pine:enum-na`, `pine:enum-named-call`, `pine:enum-unreadable`, `pine:text-size-points`, `pine:object-*`, `runtime:object*` | Lines, labels, boxes and tables | We cannot yet make this drawing exactly the way TradingView does, so it is not drawn. |
| `state` | `pine:state`, `pine:reassign`, `pine:history-ref`, `pine:live-bar-state`, `pine:na`, `runtime:history-*`, `runtime:conditional-history`, `runtime:varip`, `runtime:realtime-untold`, `runtime:call-*-state`, `runtime:input-state`, `runtime:function-global-state`, `runtime:chart-clock`, `runtime:clock-zone`, `runtime:na-test` | Values carried from bar to bar | This value depends on what the script remembered on earlier bars, in a way we cannot reproduce exactly yet. |
| `block` | `pine:block` | Code that does not run on every bar | On a chart where this code skips a bar and then runs again, TradingView's value depends on history we do not keep, so that value is withheld on that chart. |
| `collection` | `pine:collection`, `pine:type`, `pine:member`, `pine:vector*`, `pine:tuple`, `runtime:array`, `runtime:udt*`, `runtime:tuple`, `runtime:prop` | Arrays, maps and custom types | Collections and custom types are not computed here yet. |
| `function` | `pine:function-def`, `runtime:function`, `runtime:recursion`, `runtime:unbound`, `runtime:discarded-value` | Your own functions | This function is written in a way we cannot run exactly yet. |
| `builtin` | `pine:builtin`, `pine:function`, `pine:arity`, `pine:named-argument`, `pine:undefined`, `runtime:builtin-args`, `runtime:call-undeclared-builtin-state` | A TradingView built-in we do not compute yet | This built-in is not computed here yet, so anything that reads it is withheld. |
| `library` | `pine:module`, `pine:declaration-library`, `runtime:library` | Imported libraries | This script imports a library we cannot load yet. |
| `input` | `pine:input-kind`, `runtime:member-inputs` | Inputs | This kind of input cannot be offered here yet. |
| `presentation` | `pine:colour-value`, `pine:text-value`, `pine:plot-offset`, `pine:offset-*`, `pine:alert-message`, `pine:paint-pane`, `paint:*`, `runtime:colour`, `runtime:presentation`, `runtime:fill-*`, `runtime:plot-id` | How it is drawn | The value is computed, but this way of drawing it is not supported yet, so it is not drawn rather than drawn differently. |
| `limits` | `pine:window`, `pine:window-dependent`, `pine:budget`, `pine:timeout`, `runtime:limit`, `runtime:time-budget`, `runtime:calc-bars-*`, `runtime:history-start`, `runtime:warmup-never-converges`, `chart:scalar-current-only` | History and compute limits | This needs more history or more computing than a chart here allows, so it is withheld. |
| `language` | `pine:statement`, `pine:indent`, `pine:operator`, `pine:character`, `pine:cycle`, `pine:roundtrip`, `pine:role-order`, `pine:empty`, `pine:declaration`, `pine:offset-literal`, `pine:chart-only`, `runtime:statement`, `runtime:expression-statement`, `runtime:loop*`, `runtime:switch`, `runtime:block-value`, `runtime:operator`, `runtime:directive`, `runtime:declaration`, `runtime:version`, `runtime:lower`, `runtime:empty`, `runtime:udt-method`, `runtime:call-text-state`, `runtime:enum` | A Pine construct we do not run yet | This line uses a part of the Pine language we cannot run exactly yet. |
| `shape` | `pine:no-output`, `pine:objects-only`, `pine:hidden-only`, `pine:constant-only`, `pine:presentation-only`, `runtime:no-output`, `runtime:object-tree-outputs`, `runtime:withheld-all`, `runtime:nothing-drawn` | Nothing a chart can draw | The script has nothing a chart can draw: no visible plot, or only constant or hidden values. |
| `fault` | `import:internal-error`, `runtime:worker-*`, `runtime:failed`, `runtime:build`, `runtime:unnamed-refusal`, `runtime:not-from-listing`, `runtime:output-map`, `runtime:document` | Engine fault | Our engine could not finish this script. That is on us, not your script. |
| `unverified` | `runtime:killed`, `runtime:not-yet-graded`, `runtime:repaint-unstated` | Switched off or not yet verified | The bar-by-bar engine that could draw this is switched off for this script, or has not yet been checked against TradingView for it, so it is not used. |
| `held` | `engine:withheld` (a saved row `isHeld` holds, section 2) | Held by the script engine | Today's script engine has not accepted this saved version, so alerts, screens and scans hold it until it is saved again from the Pine tab. |
| `unknown` | anything else | Not supported yet | This part is not supported yet, so its value is withheld rather than guessed. |

No copy in this table, and no copy the panel writes, contains an em dash.

`pine:function` is in `builtin`, not `function`: every one of its throw sites in `pine.js` is
about a TradingView built-in (`time_close`, the period anchors, `time(<tf>, <session>)`, a bare
pre-v5 name, a call whose tuple cannot be carried), and `doorCoverage.js::UNKNOWN_NAME_GUARDS`
groups it with `pine:builtin` and `pine:undefined`. An exact listing beats a glob, in this table
as in `familyOf` (exact before prefix): `runtime:udt-method` and `runtime:call-text-state` are
`language`, `runtime:call-undeclared-builtin-state` is `builtin`, `runtime:history-start` is
`limits`, `pine:offset-literal` is `language`. The rail `editorStatus.families.test.js` PARSES
the guard column of this table and asks `familyOf` for every listed guard (a glob through the
engine's real guard literals it matches, or a probe name when it matches none), so this table and
`FAMILIES` cannot drift.

**Panel-written reasons.** The panel writes a reason of its own only where no engine sentence
exists in the browser, and only a factual one. There are two:

* `It uses <calls>, whose value depends on how much history is loaded, so <alerts refuse it |
  the screener refuses it | scans refuse it>.` (`editorStatus.js::tagSentence`), for a
  requirement tag (`_requirement_tags[tag].refused_by`) that refuses a consumer. The engine's
  sentence for that refusal (`user_definitions.consumer_refusal`) is written on the server at save
  or arm time and has no browser twin; the call names are the manifest's own.
* `Needs a threshold: give <outputs> a comparison (the control above Use this formula) to make it a
  screen.` (`editorStatus.js::thresholdSentence`), on a `[--]` Screener / Scans row whose report-lane
  output is a number the box's own threshold control turns into a condition
  (`toCondition.js::conditionFrom`). The `evaluability` sentence still shows beside it, verbatim;
  the box's control has no sentence of its own that says where it is.

(⚰️ Round 1 also wrote `Alerts / Screens / Scans run on the server, which cannot run the
bar-by-bar engine yet.` for a runtime-lane document. Gone: the alert lane's own sentence for a
runtime document (`evaluability.js::ALERT_SENTENCE.lane`) answers for alerts, and screens answer
from the report, which a runtime-routed chart does not change.)

Three rows are judgements, recorded so they are not re-litigated by accident:
`pine:objects-only` is in `shape`, not `drawing`: it is the screener lane's fact that a script
which DRAWS offers nothing to filter on, and while the chart door draws the script it is shown on
the Screener and Scans rows, never as a withheld drawing. `bind:period-reads` has its own
`period` family: a chart-period read is not data from another symbol. And the runtime lane's
kill switch, its graded-against-TradingView allowlist and an unstatable repaint class share
`unverified`: each declines a lane that is switched off or not yet proven for that script.
(Those three and `runtime:na-test`, `runtime:output-map`, `runtime:document`,
`runtime:withheld-all`, `runtime:nothing-drawn` are `runtimeDeclined.code`s in
`memberPaneDefinition.js`; the member reads the host lane's refusal, but the rail classifies
every literal.)

## 5. "Runs on": derivation

Computed by `editorStatus.js::runsOn(pane, {report})`. ⛔ ONE AUTHORITY PER VALUE: every row
answers from the lane that consumer ACTUALLY uses, by calling that lane's own function, never by
re-deriving (section 2), and for the text in the editor (a saved row changes no row):

* **Chart** = the chart door's OWN verdict (`memberPaneDefinition`): the strict host lane, or the
  runtime lane when it routes. OK exactly when `pane.ok`; never re-asked through `evaluability`
  (section 2). Its shown plots = `definition.plots` that are not `hlines` guides (the
  `nativeRegistry.astPlotKey` / `evaluability.dataPlotKeys` predicate) AND are not hidden. ⛔ A
  hidden row is a `fill` anchor, the anchor `0` an objects-only document carries, or a derived
  colour column: no alert watches it and no screen filters on it, so it never answers for a
  consumer. The per-line withheld list is the chart door's too: a plot is withheld ONLY if the
  chart door withholds it.
* **Screener, Scans** = every stored definition they read: the report lane's (`reportLane`, the
  outputs "Use this formula" offers, `evaluability(doc, key, LANES.SCAN)`) and the chart door's host
  document (the Pine tab's attach; `attachScan`, its scan plot). Any yes is a yes.
* **Alerts** = every stored definition the alert lane reads: the report lane's document (the only
  door an `alertcondition` reaches) and the chart door's host document (the Pine tab's attach),
  each `evaluability(..., LANES.ALERT)`. Any yes is a yes.

| consumer | OK when | `[--]` reason (first that applies), always an existing sentence |
|---|---|---|
| chart | `pane.ok` (the door's own verdict; `[~]` when it withholds anything). Its count = the shown plots; "its drawings" when it draws an object program, paints, or a runtime document's own objects (RT5, `compute.objects`) | no document: `pane.reason` verbatim, under the family of `pane.guard` |
| alerts | a report-lane output, or a shown plot of the chart door's host document, answers `supported` for `LANES.ALERT`, and no raised requirement tag of that document lists `alert` in `refused_by` | the report's refusal (`report.refusal.message`, named by its plot when it is one plot's refusal); the tag sentence (section 4); the first report-lane output's `evaluability` reason; the chart door's tag sentence; its first plot's `evaluability` reason (a runtime document: the alert lane's `lane` sentence); no document: `pane.reason` |
| screener | a report-lane output answers `supported` for `LANES.SCAN` and no raised tag lists `screener`; or the chart door's host document's shown scan plot does, and none of its tags lists `screener` | the report's refusal (`report.refusal.message`, named by its plot when it is one plot's refusal: `OBV: <sentence>`); the tag sentence; else the first output's `evaluability` reason (`A screen keeps the symbols where a yes/no is true; this output is not a yes/no.`); else the attach route's (its tag sentence, or its scan plot's `evaluability` reason). Plus `Needs a threshold` (section 4) where the box's threshold control can make a screen of a number |
| scans | as screener, with consumer `sweep` | as screener (the tag sentence ends "so scans refuse it") |

**The report's refusals are facts about SCREENING.** The report is the screener lane's
translation. Its top refusal (`pine:declaration-strategy`, `pine:no-output`, `pine:objects-only`,
or a plot the lane refuses at the door: `pine:window-dependent` for `ta.cum` and
`barstate.isfirst`, the period anchors) is shown verbatim on the Screener and Scans rows and
never as a withheld value; each refused plot is named there with its own sentence
(`Plots it cannot use`). A strategy's orders and backtest are still listed, from the chart door's
own notes (section 2).

**A saved row.** When the Builder is editing a saved row, ⛔ NO ROW CHANGES: the four rows answer
for the text in the editor (what its doors would save now). The saved version's own facts are its
own line, beside the rows (`editorStatus.js::savedVersion`, `status.saved`), and ⛔ only while the
inspected text IS that version's own script (`row.pine_source`, or a runtime document's
`compute.source`); for any other text they describe a script that is not on screen:

* held (`isHeld`, section 2: `upgradeKindOf` says `refused`, or `retranslate` with a refused
  `engine_status`): `Saved version: Held by the script engine.` with the family's sentence (alerts,
  screens and scans hold that stored version until it is saved again) and the row's
  `engine_status.reason` verbatim under Details.
* not held, with a served `scan_refusal` (any gate, the sweep's C45 `withheld` included):
  `Saved version, in screens and scans: <detail>`, verbatim. A runtime document's is always the
  `kind` gate; the Screener and Scans rows still answer from the report lane (and the attach route).

`[~]` (partial) is shown for chart when it draws but something is withheld, and for
alerts/screener/scans when the answer is `supported` with `final: false` the row adds
`(the server re-checks when you save or arm it)`. The panel never says a server lane WILL run
something; `evaluability` is a preflight and the server is the authority.

## 6. Line mapping

`editorStatus.js::lineMarks(status, docText)` turns status items into per-line marks:

* ⛔ only the CHART door's items are marked (section 5). A screener-lane refusal of a plot the
  chart draws is on the Screener and Scans rows and never on a line.

* an item's line is, in order: its refusal's `line` (the chart door's translation, 1-based),
  else its output's `line` (where `plot(...)` was written), else none.
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
2. Within the 250 ms debounce the panel shows `Checking your script...`, then one of the
   section 3 headlines: `Runs fully` / `<where>, N values withheld (not guessed)` /
   `<where>, with N notes` / `<where>; not in ...` / `<where>; screens and scans need a threshold` /
   `Runs in ...; the chart cannot draw it yet: X` / `Runs in ...; nothing to draw on a chart` /
   `Not yet: X`.
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
* Server-side interpreter (W5): until it lands, a runtime-lane DOCUMENT runs on no server lane
  (the alert lane's `lane` gate refuses it, by its own sentence; the screen lanes by `assert_scannable`'s
  `kind` gate). Screens and alerts still answer from the report lane ("Use this formula"), which a
  runtime-routed chart does not change, and a saved runtime document's served `kind` refusal is shown
  only as the saved version's line, never in their place.
