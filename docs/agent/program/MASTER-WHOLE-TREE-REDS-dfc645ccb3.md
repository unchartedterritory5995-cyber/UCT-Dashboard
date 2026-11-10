# Master dfc645ccb3 whole-tree reds: PARTIAL, INVALID as reference

**Status: PARTIAL, INVALID as reference (run died at 4249/4584, no totals line).**
The final master failing-file list will come from pl-exec's fresh whole-tree run at master dfc645ccb3. Once that list exists, pl-teach adds the owner and category for each file here. Until then, nothing below may be used as the PASS reference ("head failing set ⊆ master failing set").

## Run record (LOCAL)
- Command: `python ..\tools\agent_suite_lock.py run --who pl-teach -- npx vitest run`, run from `C:\w\pl-teach\app` at BelowNormal through the scratchpad `suite.ps1` (4800 s limit).
- Commit: `dfc645ccb3` (detached checkout in C:\w\pl-teach).
- Scope: whole tree (no path arguments).
- Started: 2026-11-10T01:06:13 local (`wholetree.progress`: cpu=68%, node=7).
- Ended: abnormally. The last log write was ~01:38 and the last load sample was 01:37. By 01:42 no vitest process existed under `C:\w\pl-teach\app`. No `END wt-master` line was written. The cause is not proven; the timing matches the stopped pl-teach session's host process tree being torn down.
- Coverage: 4249 unique test files reported, against `find app/src -name "*.test.*" | wc -l` = 4584. 335 files were never reported.
- Totals line: **none**. Vitest's end-of-run failure details were never printed either, so no failure messages exist for any red file.
- Conditions: it ran UNLOCKED after the session stop, because the suite-lock registration was lost. Load was heavy: CPU 96-100% for most of the run, with 13-23 node processes, overlapping AUDIT's #988 suite and pl-auto's browser batch.
- Raw log (not committed, 10 MB, 233105 lines): `C:\Users\blake\AppData\Local\Temp\claude\2ef397b80db79bf7\56266831-c770-46eb-8e87-f65def6d19f9\scratchpad\pl-teach\wt-master-dfc645ccb3-dfc645ccb3.log`, sha256 prefix `dc611ed26ea0f650`.

## Files reported red before the run died (47, names only)
This set is a lower bound: any of the 335 unreported files could also be red.
Nine rows show only skipped tests on a `❯` line, which suggests a suite-level error such as a hook or import failure. The cause can't be confirmed, because the error text was never printed.

| File | Reported counts |
|---|---|
| `src/__tests__/sourcesAreText.test.js` | (2 tests | 1 failed) 682ms |
| `src/components/StockChart.firstVisitFraming.test.jsx` | (3 tests | 1 failed) 1348ms |
| `src/components/StockChart.focusWarmStep.test.jsx` | (4 tests | 1 failed) 9197ms |
| `src/components/chart/engine/ast/symbolFoldParity.test.js` | (10 tests | 3 failed) 338ms |
| `src/components/chart/engine/ast/targetScriptReport.measure.test.js` | (2 tests | 1 failed) 1761ms |
| `src/components/chart/engine/runtime/__tests__/hostParity.v8.rail.test.js` | (9 tests | 1 failed) 6838ms |
| `src/components/chart/engine/useServerColumns.test.jsx` | (8 tests | 1 failed) 47ms |
| `src/components/provenance/freshnessAge.test.js` | (89 tests | 1 failed) 7355ms |
| `src/components/provenance/panelAdoption.ratchet.test.js` | (26 tests | 1 failed) 541ms |
| `src/components/screener/reachable.test.js` | (19 tests | 1 failed) 43821ms |
| `src/components/ui/formControls.census.test.js` | (117 tests | 3 failed) 5816ms |
| `src/hub/writePathsTransitive.test.js` | (10 tests | 1 failed) 72ms |
| `src/lib/context/symbolLinkChannels.test.js` | (8 tests | 1 failed) 3278ms |
| `src/lib/persistence/persistenceManifest.test.js` | (13 tests | 2 failed) 6545ms |
| `src/lib/presentation/dataGrid/dataGridSeed.rail.test.js` | (12 tests | 1 failed) 6875ms |
| `src/lib/presentation/handRolledFormatters.census.test.js` | (15 tests | 1 failed) 2526ms |
| `src/lib/swallowedFetch.census.test.js` | (5 tests | 1 failed) 18ms |
| `src/noRegexLookbehind.test.js` | (6 tests | 1 failed) 2943ms |
| `src/pages/Watchlists.entitykeys.test.jsx` | (3 tests | 1 failed) 136ms |
| `src/pages/command/keyListenerCensus.test.js` | (7 tests | 2 failed) 6905ms |
| `src/pages/command/shortcutRegistry.test.js` | (31 tests | 1 failed) 840ms |
| `src/pages/desk/ArticlesSection.native.test.jsx` | (12 tests | 1 failed) 5492ms |
| `src/pages/journal-2-0/components/notebook/ChartEmbed.touchTargets.test.js` | (8 tests | 1 failed) 18ms |
| `src/pages/journal-2-0/components/notebook/frozenWorkspace.test.jsx` | (4 tests | 1 failed) 52ms |
| `src/pages/journal-2-0/components/notebook/myTools/VersionHistory.test.jsx` | (21 tests | 2 failed) 6378ms |
| `src/pages/journal-2-0/lib/calloutNode.variant.test.js` | (17 tests | 6 skipped) 419ms |
| `src/pages/journal-2-0/lib/captureContext.test.js` | (11 tests | 1 failed) 484ms |
| `src/pages/journal-2-0/lib/dateMentionNode.test.js` | (26 tests | 2 skipped) 381ms |
| `src/pages/journal-2-0/lib/formula/offlineNeverStoresComputed.test.js` | (7 tests | 2 failed) 88ms |
| `src/pages/journal-2-0/lib/importer/evernoteLinks.test.js` | (33 tests | 1 failed) 211ms |
| `src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js` | (13 tests | 13 skipped) 87ms |
| `src/pages/journal-2-0/lib/importer/exportRoundtrip.test.js` | (7 tests | 7 skipped) 106ms |
| `src/pages/journal-2-0/lib/importer/fidelityCarryovers.roundtrip.test.js` | (13 tests | 13 skipped) 91ms |
| `src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js` | (9 tests | 1 failed) 13ms |
| `src/pages/journal-2-0/lib/noteBatch.jsonRoundtrip.test.js` | (3 tests | 3 skipped) 107ms |
| `src/pages/journal-2-0/lib/offline/noteCopy.test.js` | (50 tests | 1 failed) 8745ms |
| `src/pages/journal-2-0/lib/selectionExport.roundtrip.test.js` | (4 tests | 4 skipped) 86ms |
| `src/pages/journal-2-0/lib/templateLibrary.server.test.js` | (7 tests | 1 failed) 15ms |
| `src/pages/journal-2-0/lib/widgetFormula/widgetFormula.lazy.test.js` | (5 tests | 1 failed) 5900ms |
| `src/pages/journal-2-0/rawErrorSurface.test.js` | (8 tests | 1 failed) 652ms |
| `src/pages/terminal/a11y/terminalA11yStatic.test.js` | (18 tests | 1 failed) 3613ms |
| `src/pages/terminal/a11y/terminalReachableContrast.test.js` | (7 tests | 3 failed) 273ms |
| `src/pages/terminal/formControls.terminal.test.js` | (3 tests | 2 failed) 83ms |
| `src/pages/terminal/themeColours.rail.test.js` | (6 tests | 1 failed) 1920ms |
| `src/styles/tokens.reachable.test.js` | (5 tests | 1 failed) 1187ms |
| `src/surfaces/manifest.test.js` | (10 tests | 1 failed) 800ms |
| `src/utils/jsonFetcher.test.js` | (11 tests | 1 failed) 2815ms |

## Owner / category
Deferred: to be added per file (census / golden / timing / other, with the owning team from `git log` of the subject file) against pl-exec's complete master run.
