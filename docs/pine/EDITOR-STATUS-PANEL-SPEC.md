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
| what a CHART would draw, and which lane draws it | `builder/memberPane/memberPaneDefinition.js::memberPaneDefinition({source})` -> `{ok, reason, guard, lane, notes, requirementTags, definition, rows, translation}` | the same door "Add to chart" and the saved-script upgrade use. `lane === 'runtime'` = per-bar runtime lane, else host lane. ⛔ Asked for EVERY Pine report that is not an engine fault or a foreign language, whatever `report.ok` says: the report is the screener lane's translation, and it refuses a strategy and an objects-only script the chart door draws (`PineEditorStatus.jsx::paneFor`) |
| per output, per consumer: can it run there | `engine/evaluability.js::evaluability(def, key, lane)` for `LANES.CHART`, `LANES.ALERT`, `LANES.SCAN` over the pane document's data plots | the shared P1 gate; its alert answer is held equal to `alert_user_series.py` by `tests/fixtures/ast/p1_evaluability_alert.json` |
| which consumers refuse a requirement tag (`window_dependent`, `occurrence_dependent`) | `closedTable.json::_requirement_tags[tag].refused_by` via `parse.js::TABLE` | the same roster `user_definitions.consumer_refusal` reads; consumer names `alert`, `screener`, `sweep` |
| plots that may be withheld on some charts (code that does not run on every bar, C45/C48) | the pane document's `definition.meta.blockRuns.keys` (`{key, gates: [{why, guard, what}]}`), the stamp the chart's bind reads (`engine/blockRuns.js::blockRunsRefusal`; the server's twin is `api/services/block_runs.py`). The plot is named through `definition.plots` and the pane's `rows`: a row's tree IS its output's tree, so the output (title, `plot(...)` line) is found by identity; a derived colour column is named `colour of <plot>` | data-dependent: the panel says "may be withheld on some charts", never "withheld". Reason = the gate's `why`, verbatim. ⚰️ This read each report output's `_blockRuns`, which is non-enumerable and host-lane only, so it never reached the report and the list could never fill |
| plots that may be withheld on some chart periods (C29) | the pane document's `definition.meta.periodReads.keys` (`{key, names}`) | the bind refuses such a plot on a chart whose period gives a different value. Reason = `engine/periodReads.js::periodReadsRefusalFor(def, key, tf)`, verbatim, on the first period of the stamp's own ladder (`byTf`) that it refuses |
| a SAVED version held by the script engine (#673/#675) | `memberPane/savedScriptUpgrade.js::upgradeKindOf(row) === 'refused'`, the browser's twin of `user_definitions.engine_withheld_reason` | detail = the row's `engine_status.reason`, verbatim; only when the Builder is editing a saved row. ⛔ NOT `scan_refusal.gate === 'withheld'`: the sweep's C45 check (`scan_definition.assert_scannable`) refuses under that same gate |
| the server's answer for screening a saved version | the served row's `scan_refusal` (`routers/user_definitions.py::_stamped`), any gate, when the version is not held | its `detail`, verbatim, on the Screener and Scans rows only |
| a strategy's orders and backtest (missing parts) | `importOutcome` over the chart door's translation notes (`MISSING_PART_CODES`), and the report's own `outcome.missing` | the report's lane refuses a strategy outright and names no parts; the chart door reads it and notes what it leaves out |
| runtime-lane disclosures (what the runtime document does not draw) | `memberPaneDefinition(...).notes` (`{name, note}`) | verbatim. ⛔ A note whose sentence is already listed (a fold note the report's outcome also carries, a withheld paint's disclosure that wraps the paint's own reason) is not listed again: one fact, one item |
| withheld paints (`bgcolor` / `barcolor`) | the chart door's translation, `pane.translation.presentation.paints[].withheld.reason` (paints are carried on the HOST lane only, `pine.js::resolvePaints`); the report's when there is no such translation | verbatim, as a withheld value on the paint's line |

The pure module `builder/editorStatus.js::editorStatus({report, pane, savedRow})` folds these
into one status object. It never throws (a throw becomes the ENGINE FAULT state) and writes
nothing.

## 3. Panel states

| state | when (first match wins) | headline (exact copy) |
|---|---|---|
| `hidden` | flag off, no text, or a non-Pine report | (panel not rendered) |
| `checking` | the editor text differs from the text the shown report was computed on (the 250 ms debounce window) | `Checking your script...` |
| `engine-error` | `outcome.verdict === 'error'` | the `fault` family's sentence: `Our engine could not finish this script. That is on us, not your script.` |
| `not-yet` | no consumer can run anything (`chart`, `alerts`, `screener`, `scans` all no) | `Not yet: <family label of the first blocker>`, the label exactly as section 4 writes it. The blocker is the chart door's refusal guard when it has one, else the first withheld item |
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
6. **What still works**: `What still works: <n> plot(s)` (the visible plots the chart draws) plus
   `and its drawings` when the document draws an object program or paints, or
   `Nothing else runs yet.`
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
`'runtime:*'` guard literal out of `pine.js` and `runtime/*.js` and fails BY NAME for any that
falls to `unknown`, so a new guard must be given a family when it ships.

| family | guards (prefix or exact) | label | Why: |
|---|---|---|---|
| `request` | `pine:request`, `runtime:request*`, `other-symbol:*`, `lower-tf:*` | Data from another symbol or timeframe | This asks for prices from another symbol or timeframe that we cannot supply exactly yet, so the value is withheld rather than guessed. |
| `period` | `bind:period-reads` | Values that depend on the chart's timeframe | This reads the chart's own timeframe. It was translated at one timeframe, so on a chart where that reading differs, the plot is withheld rather than drawn with the other timeframe's value. |
| `strategy` | `pine:strategy-*`, `pine:declaration-strategy`, `runtime:strategy-*` | Strategy orders and backtests | Strategy orders, fills and the backtest do not run here yet. The plots in a strategy can still be drawn. |
| `drawing` | `pine:drawing`, `pine:object-*`, `runtime:object*` | Lines, labels, boxes and tables | We cannot yet make this drawing exactly the way TradingView does, so it is not drawn. |
| `state` | `pine:state`, `pine:reassign`, `pine:history-ref`, `pine:live-bar-state`, `pine:na`, `runtime:history-*`, `runtime:conditional-history`, `runtime:varip`, `runtime:realtime-untold`, `runtime:call-*-state`, `runtime:input-state`, `runtime:function-global-state`, `runtime:chart-clock`, `runtime:clock-zone`, `runtime:na-test` | Values carried from bar to bar | This value depends on what the script remembered on earlier bars, in a way we cannot reproduce exactly yet. |
| `block` | `pine:block` | Code that does not run on every bar | On a chart where this code skips a bar and then runs again, TradingView's value depends on history we do not keep, so that value is withheld on that chart. |
| `collection` | `pine:collection`, `pine:type`, `pine:member`, `pine:vector*`, `pine:tuple`, `runtime:array`, `runtime:udt*`, `runtime:tuple`, `runtime:prop` | Arrays, maps and custom types | Collections and custom types are not computed here yet. |
| `function` | `pine:function`, `pine:function-def`, `runtime:function`, `runtime:recursion`, `runtime:unbound`, `runtime:discarded-value` | Your own functions | This function is written in a way we cannot run exactly yet. |
| `builtin` | `pine:builtin`, `pine:arity`, `pine:named-argument`, `pine:undefined`, `runtime:builtin-args`, `runtime:call-undeclared-builtin-state` | A TradingView built-in we do not compute yet | This built-in is not computed here yet, so anything that reads it is withheld. |
| `library` | `pine:module`, `pine:declaration-library`, `runtime:library` | Imported libraries | This script imports a library we cannot load yet. |
| `input` | `pine:input-kind`, `runtime:member-inputs` | Inputs | This kind of input cannot be offered here yet. |
| `presentation` | `pine:colour-value`, `pine:text-value`, `pine:plot-offset`, `pine:offset-*`, `pine:alert-message`, `pine:paint-pane`, `paint:*`, `runtime:colour`, `runtime:presentation`, `runtime:fill-*`, `runtime:plot-id` | How it is drawn | The value is computed, but this way of drawing it is not supported yet, so it is not drawn rather than drawn differently. |
| `limits` | `pine:window`, `pine:window-dependent`, `pine:budget`, `pine:timeout`, `runtime:limit`, `runtime:time-budget`, `runtime:calc-bars-*`, `runtime:history-start`, `runtime:warmup-never-converges`, `chart:scalar-current-only` | History and compute limits | This needs more history or more computing than a chart here allows, so it is withheld. |
| `language` | `pine:statement`, `pine:operator`, `pine:character`, `pine:cycle`, `pine:roundtrip`, `pine:role-order`, `pine:empty`, `pine:declaration`, `pine:offset-literal`, `pine:chart-only`, `runtime:statement`, `runtime:expression-statement`, `runtime:loop*`, `runtime:switch`, `runtime:block-value`, `runtime:operator`, `runtime:directive`, `runtime:declaration`, `runtime:version`, `runtime:lower`, `runtime:empty`, `runtime:udt-method`, `runtime:call-text-state` | A Pine construct we do not run yet | This line uses a part of the Pine language we cannot run exactly yet. |
| `shape` | `pine:no-output`, `pine:objects-only`, `pine:hidden-only`, `pine:constant-only`, `pine:presentation-only`, `runtime:no-output`, `runtime:object-tree-outputs`, `runtime:withheld-all`, `runtime:nothing-drawn` | Nothing a chart can draw | The script has nothing a chart can draw: no visible plot, or only constant or hidden values. |
| `fault` | `import:internal-error`, `runtime:worker-*`, `runtime:failed`, `runtime:build`, `runtime:unnamed-refusal`, `runtime:not-from-listing`, `runtime:output-map`, `runtime:document` | Engine fault | Our engine could not finish this script. That is on us, not your script. |
| `unverified` | `runtime:killed`, `runtime:not-yet-graded`, `runtime:repaint-unstated` | Switched off or not yet verified | The bar-by-bar engine that could draw this is switched off for this script, or has not yet been checked against TradingView for it, so it is not used. |
| `held` | `engine:withheld` (a saved row whose `upgradeKindOf` is `refused`) | Held by the script engine | Today's script engine has not accepted this saved version, so alerts, screens and scans hold it until it is saved again from the Pine tab. |
| `unknown` | anything else | Not supported yet | This part is not supported yet, so its value is withheld rather than guessed. |

No copy in this table, and no copy the panel writes, contains an em dash.

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

Computed by `editorStatus.js::runsOn(pane, savedRow)` on the PANE document
(`memberPaneDefinition`), because that is the document a chart attach installs and the
saved-script upgrade writes. Shown plots = `definition.plots` that are not `hlines` guides
(the `nativeRegistry.astPlotKey` / `evaluability.dataPlotKeys` predicate) AND are not hidden.
⛔ A hidden row is a `fill` anchor, the anchor `0` an objects-only document carries, or a derived
colour column: no alert watches it and no screen filters on it, so it never answers for a
consumer. (Counted, a table-only script read Alerts `[OK]` off its anchor, and a plot coloured by
a 0/1 condition read Screener `[OK]` off its colour column.)

| consumer | OK when | `[--]` reason (first that applies), always an existing sentence |
|---|---|---|
| chart | `pane.ok` and at least one shown plot is not refused by `evaluability(def, key, LANES.CHART, {})`, or the document draws objects/paints | no document: `pane.reason` verbatim, under the family of `pane.guard`. Every shown plot refused: the first refusal's `evaluability` reason verbatim |
| alerts | some shown plot answers `supported` for `LANES.ALERT`, and no raised requirement tag lists `alert` in `refused_by` | no document: `pane.reason` verbatim. Runtime lane: "Alerts run on the server, which cannot run the bar-by-bar engine yet." Requirement tag: "It uses <calls>, whose value depends on how much history is loaded, so alerts refuse it." No shown plot: the report's screening refusal below, verbatim, when there is one. Else the first plot's `evaluability` reason verbatim |
| screener | some shown plot answers `supported` for `LANES.SCAN`, no raised tag lists `screener` | as alerts (the tag sentence ends "so the screener refuses it"). The report's screening refusal (below) when the chart door answers `ok`. Else the first plot's `evaluability` reason verbatim (`A screen keeps the symbols where a yes/no is true; this output is not a yes/no.`) |
| scans | as screener, with consumer `sweep` | as screener (the tag sentence ends "so scans refuse it") |

**The report's screening refusals.** The report is the screener lane's translation. Its top
refusals `pine:declaration-strategy`, `pine:no-output` and `pine:objects-only`
(`editorStatus.js::SCREENER_LANE_REFUSALS`) are facts about SCREENING: while the chart door answers
`ok` (it draws the strategy's plots, the objects-only script's drawings, the paint-only overlay's
paint), the refusal's message is shown verbatim on the Screener and Scans rows (and on Alerts when
the document has no shown plot), and it is NOT listed as a withheld value. A strategy's orders and
backtest are still listed, from the chart door's own notes (section 2).

**A saved row.** When the Builder is editing a saved row:

* held (`savedScriptUpgrade.upgradeKindOf(row) === 'refused'`, the browser's twin of
  `engine_withheld_reason`): alerts, screener and scans all become `[--]`, family `held`, with the
  row's `engine_status.reason` verbatim under Details. The server lanes hold that stored version
  whatever the editor shows.
* not held, with a served `scan_refusal` (any gate, the sweep's C45 `withheld` included): its
  `detail` verbatim on the Screener and Scans rows only. The Alerts row is not changed.
* the chart row is never changed by a saved row (the chart draws today's translation).

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
* Server-side interpreter (W5): until it lands, a runtime-lane script reads `[--]` for alerts,
  screener and scans, by name.
