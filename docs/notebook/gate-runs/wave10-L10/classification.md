# Wave 10 L10 gate (run 1): classification

Manifest `2026-09-29T22-55-47.md`: `VERDICT=NEW_FAILURES new=22 no_longer_failing=124 test_files=2227 reconciles=true`,
on tree `5a879a911` (master f00cc9065 + FX/DR-A + DR-C). The box was heavily contended (other sessions'
vitest runs), `--max-workers 2`.

Each NEW file was re-run ALONE on the L10 tree and on a master tree (`notebook-w10-rul`, master b8c151873
+ docs/config only):

| file | L10 alone | master alone | class |
|---|---|---|---|
| sourcesAreText, EvidenceTab.doors, noRegexLookbehind, keyListenerCensus, importer/convert, selectionExport.roundtrip, objectLaneCallSites/DrawerCensus .measure, graphWireFixture, paramSingleTranslation | pass | pass | LOAD (15 s / 60 s timeouts under contention) |
| presentationSingleFormatter | fail | fail | MASTER RED (TERM-057 AbsenceReceipt; fixed by lane MR acd50d5b1) |
| VersionHistory.workspace | fail | fail | MASTER RED (charts, not Notebook) |
| usePreferences.additionsOnly (shard 1) | fail | fail | MASTER RED (fixed by lane MR 342119eb2) |
| **a11y/notebookContrast** | **fail** | pass | **L10 (DR-C): TemplatePicker.module.css contrast, 4 pairs** |
| **tabs/NotebookTab.test.jsx (4 tests)** | **fail** | pass | **L10 (DR-C): duplicate chip/heading text and Preview button names** |

**Verdict: L10 BLOCKS on two DR-C defects.** Sent back to lane DR-C. L10 is re-assembled and re-gated
after the fix, together with lane MR (master reds), the rulings branch, DR-R and DR-F.

Mid-run note: after shard 1 the vitest snapshot `journalGrids.seedParity.test.jsx.snap` read as modified
under core.autocrlf (content == blob). The index entry was refreshed so the end-of-run tree check measures
the source; the root fix (`*.snap text eol=lf`) is on feat/notebook-w10-rulings `9ddf49f2f`.
