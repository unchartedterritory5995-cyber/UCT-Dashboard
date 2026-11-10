# Master dfc645ccb3 whole-tree reds (the reference set)

**This is the PASS reference for whole-tree runs at base `dfc645ccb3`. The rule: a head's failing-file set must be a subset of this set, compared by file NAME.**

## Run record (LOCAL, run by pl-exec)
- **Command:** `npx vitest run`, whole tree (no path arguments).
  - It ran from `C:\w\pl-exec-master\app` through `agent_suite_lock.py` at BelowNormal.
  - Install: `C:\w\pl-mc-fw\app\node_modules`, pl-mc-fw's install with the same package-lock.
- **Commit:** master `dfc645ccb3`.
- **Scope:** the whole tree, 4580 test files collected. For comparison, `find app/src -name "*.test.*" | wc -l` gives 4584; vitest did not collect four of those paths. Which four, and why, has not been checked.
- **Totals:**
  - `Test Files  48 failed | 4498 passed | 34 skipped (4580)`
  - `Tests  52 failed | 71048 passed | 243 skipped (71343)`
  - Duration 2358.79 s (39m43s).
- **Raw files** (scratch, not committed):
  - `C:\Users\blake\AppData\Local\Temp\claude\2ef397b80db79bf7\56266831-c770-46eb-8e87-f65def6d19f9\scratchpad\wt_master.txt`
  - the failing-file list: `...\scratchpad\wt_master_failing.txt`
- **Superseded:** this run replaces the earlier pl-teach attempt, which was PARTIAL and INVALID (it died at 4249/4584 with no totals line). Every one of that attempt's 47 names is in the set below. This run adds `presentationSingleFormatter` (timeout) and `study/DrillPlayer`.

## How the columns were filled
- **Category** comes from each file's first failure message in the log.
  - census: a ratchet, census or source-shape rail over the tree.
  - golden: a pinned hash or exact snapshot.
  - timing: a timeout, or a readiness or order race.
  - env: this machine's environment. Examples are a Python bridge that cannot import `conftest` or `tzdata`, no `app/dist` build, a V8 other than the recording one, and source rails reading CRLF-checked-out `.py` files.
  - other: none of the above.
- **Team** is the scope of the newest commit touching the test file at `dfc645ccb3` (`git log -1 dfc645ccb3 -- <file>`). It is the area that owns it, not a person.
- Both columns are a reading of the log, not a verdict on the cause.

| # | Failing file | Category | First failure (abridged) | Team (last commit) |
|---|---|---|---|---|
| 1 | src/__tests__/sourcesAreText.test.js | census | a source contains a NUL/C0 control byte | engine (`fix(engine)`) |
| 2 | src/components/StockChart.firstVisitFraming.test.jsx | other | frame offset 7.84 vs 5.84 expected | chart (`fix(chart)`) |
| 3 | src/components/StockChart.focusWarmStep.test.jsx | timing | "Q1 ready after null ms" | focus (`test(focus)`) |
| 4 | src/components/chart/engine/ast/symbolFoldParity.test.js | env | python: No module named 'tzdata' | pine (`feat(pine-c29)`) |
| 5 | src/components/chart/engine/ast/targetScriptReport.measure.test.js | other | 1 target in target-scripts.json missing on disk | pine (`feat(pine)`) |
| 6 | src/components/chart/engine/runtime/__tests__/hostParity.v8.rail.test.js | env | --check exit not 0 on this V8 | engine runtime (W5-T4) |
| 7 | src/components/chart/engine/useServerColumns.test.jsx | census | StockChart repaint dependency array moved; re-anchor | charts (`fix(charts)`) |
| 8 | src/components/provenance/freshnessAge.test.js | census | a second authority over TERM-006's constants | platform (`feat(platform)`) |
| 9 | src/components/provenance/panelAdoption.ratchet.test.js | census | result surfaces without CoverageLine | screener (`feat(screener)`) |
| 10 | src/components/screener/reachable.test.js | census | modules reachable from no entry point | screener / pine (merge) |
| 11 | src/components/ui/formControls.census.test.js | census | new hand-rolled switch; unnamed controls 0→7 | a11y (`feat(a11y)`) |
| 12 | src/hub/writePathsTransitive.test.js | census | useFlagged toggle: an undeclared cross-module hop | master-red (`fix(master-red)`) |
| 13 | src/lib/context/symbolLinkChannels.test.js | census | new hand-typed deep-link reads (CotRender, journalToolsDoor) | desk (`chore(desk)`) |
| 14 | src/lib/persistence/persistenceManifest.test.js | census | storage-shaped calls unclassified (9) | term-076 (`fix(term-076)`) |
| 15 | src/lib/presentation/dataGrid/dataGridSeed.rail.test.js | census | a hand-rolled grid outside the baseline | terminal (`feat(terminal)`) |
| 16 | src/lib/presentation/handRolledFormatters.census.test.js | census | new hand-rolled formatter file(s) | term-066 (`fix(term-066)`) |
| 17 | src/lib/presentation/presentationSingleFormatter.test.js | timing | Test timed out in 15000ms | research (`fix(research)`) |
| 18 | src/lib/swallowedFetch.census.test.js | census | `.catch(() => null)` sites grew (6) | term-033 (`fix(term-033)`) |
| 19 | src/noRegexLookbehind.test.js | census | 4 product files use a regex lookbehind | notebook (wave 5) |
| 20 | src/pages/Watchlists.entitykeys.test.jsx | golden | flag-off render hash differs | ent-uc2 (`feat(ent-uc2)`) |
| 21 | src/pages/command/keyListenerCensus.test.js | census | raw key listeners 136 vs ceiling 111 | keys (`test(keys)`) |
| 22 | src/pages/command/shortcutRegistry.test.js | census | DrillPlayer mount reasons: 2 pages, 1 expected | web (`perf(web)`) |
| 23 | src/pages/journal-2-0/components/notebook/ChartEmbed.touchTargets.test.js | census | 36 embed buttons not pinned to --tap-min | notebook (waves 12-15) |
| 24 | src/pages/journal-2-0/components/notebook/frozenWorkspace.test.jsx | census | frozen workspace lacks `canOpenCompare` | journal-widgets (`feat(journal-widgets)`) |
| 25 | src/pages/journal-2-0/components/notebook/myTools/VersionHistory.test.jsx | other | restore/name assertions (2 tests) | notebook (`fix(notebook)`) |
| 26 | src/pages/journal-2-0/lib/calloutNode.variant.test.js | env | md_export_bridge.py: `import conftest` fails | notebook (wave 7) |
| 27 | src/pages/journal-2-0/lib/captureContext.test.js | census | capture doors: 2 found, 1 checked | notebook (Wave L) |
| 28 | src/pages/journal-2-0/lib/dateMentionNode.test.js | env | note_tasks_bridge.py: `import conftest` fails | notebook (wave 7) |
| 29 | src/pages/journal-2-0/lib/formula/offlineNeverStoresComputed.test.js | census | production SWRConfigs: App.jsx + lab/main.jsx | screener (`fix(screener)`) |
| 30 | src/pages/journal-2-0/lib/importer/evernoteLinks.test.js | env | regex over notes.py fails on a CRLF checkout | evernote (`test(evernote)`) |
| 31 | src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js | env | format_export_bridge.py: `import conftest` fails | importer (`feat(importer)`) |
| 32 | src/pages/journal-2-0/lib/importer/exportRoundtrip.test.js | env | roundtrip_export_fixture.py driver exit 1 | notebook (wave 7) |
| 33 | src/pages/journal-2-0/lib/importer/fidelityCarryovers.roundtrip.test.js | env | format_export_bridge.py: `import conftest` fails | notebook (wave 8) |
| 34 | src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js | env | app/dist/assets missing (needs a build) | notebook (`fix(notebook)`) |
| 35 | src/pages/journal-2-0/lib/noteBatch.jsonRoundtrip.test.js | env | selection_export_bridge.py: `import conftest` fails | notebook (wave 9) |
| 36 | src/pages/journal-2-0/lib/offline/noteCopy.test.js | env | sentence not found in notes.py (CRLF checkout) | notebook (`perf(notebook)`) |
| 37 | src/pages/journal-2-0/lib/selectionExport.roundtrip.test.js | env | selection_export_bridge.py: `import conftest` fails | importer (`fix(importer)`) |
| 38 | src/pages/journal-2-0/lib/templateLibrary.server.test.js | env | regex over the Python router fails on a CRLF checkout | notebook (`test(notebook)`) |
| 39 | src/pages/journal-2-0/lib/widgetFormula/widgetFormula.lazy.test.js | other | first-open closure entries: 3, 2 expected | notebook (`feat(notebook)`) |
| 40 | src/pages/journal-2-0/rawErrorSurface.test.js | census | raw-error violations | notebook (`fix(notebook)`) |
| 41 | src/pages/study/DrillPlayer.test.jsx | timing | element still in the document after the 1-4 keys and Enter | study (`feat(study)`) |
| 42 | src/pages/terminal/a11y/terminalA11yStatic.test.js | census | unnamed table: agent/AgentResult.jsx:42 | terminal (revert of a revert) |
| 43 | src/pages/terminal/a11y/terminalReachableContrast.test.js | census | --loss/--gain as text; new text under AA | a11y (`test(a11y)`) |
| 44 | src/pages/terminal/formControls.terminal.test.js | census | native select/input remain | ui (`feat(ui)`) |
| 45 | src/pages/terminal/themeColours.rail.test.js | census | hardcoded colours in terminal-mounted code | terminal (`test(terminal)`) |
| 46 | src/styles/tokens.reachable.test.js | census | an alias that re-points an alias target | W3 static sweep |
| 47 | src/surfaces/manifest.test.js | census | routes with no manifest row: notebook/playbook, /admin/rare-preview | notebook (wave 6) |
| 48 | src/utils/jsonFetcher.test.js | census | surfaces hand a non-OK body on as data | jsonFetcher (`test(jsonFetcher)`) |

**Counts:** census 27, env 13, timing 3, golden 1, other 4 (48).
- None of these is in a file teach-keys touches. teach-keys changes the guide's key family and its rails only.
- The timing rows (3, 17, 41) are the ones a head run may flip. Rule: a red that is new against this list, and that looks like a timing failure, gets a solo 5× run against this base, which must stay within 20%.
