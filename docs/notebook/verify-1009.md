# Notebook verification, 2026-10-09

The owner asked, after meaning search and voice notes were armed: is everything tested, and
what is left? This records what was then run, on the live site and in a local sandbox, and what
it found. Raw evidence was committed before each summary.

## 1. Live site (production, smoke account)

Tool: `tools/notebook_prod_verify_live.py`. Evidence: `docs/notebook/evidence/verify-1009/live/`.
Every note the run created was removed through the product's own delete and checked gone (404);
the smoke account ended with 0 active notes.

| check | 1280 | 390 |
|---|---|---|
| Long-note Ask (the PLTR question that spans the whole note; fin-walk 8.2, K1) | PASS: 26.35, 24.85, both risks, the final rule, cited, the citation opens the note | PASS, same |
| Meaning search: the PRODUCTION sweep indexed the new notes (314 s after creation); a phrase sharing no word with the note finds it by meaning; plain search finds nothing | PASS, row labelled "Related by meaning" | PASS, same |
| Voice note: upload a recording, transcribe (5.7 s), AI-labelled summary, NVDA and TSLA, the action item, transcript in the saved note | PASS | the sheet opens; every button at least 44 x 44 (`voice-dialog-390-targets.json`) |

Two things to know about the run:

- Attempt 1 hit a 502 four seconds in, during another workstream's deploy swap, and stopped
  before any check. Its three notes were removed by hand (404 each); its log is kept under
  `attempt1-502/`. The tool now retries a 5xx on create and delete.
- The first 390 voice reading was an instrument miss: the walker waited for Transcribe, which
  renders only after a file is chosen. The sheet's buttons were measured separately and the
  walker now measures them itself.

## 2. Local sandbox (items the fin-walk never walked)

Full record: `docs/notebook/verify-1009-sandbox.md`. Evidence: `docs/notebook/evidence/verify-1009/sbx/`.
Every boot read `SANDBOX INTEGRITY: CLEAN` at all four checkpoints; no key appears in the evidence.

| item | result |
|---|---|
| Confirm buttons on top at their centre and the action completes (bulk trash, folder delete, saved-view delete x3, version restore, gallery unpublish), 1280 and 390 | PASS; no floating button covers any of them. Saved-view delete beside an open note does not exist at 390 (the folders panel is hidden there) |
| Sample chart plan: role buttons and Arm alert | PASS; the alert is stored and the panel says so |
| Published page, signed out: bold, italic, heading, list, link, table, task list | PASS, all seven survive |
| Thesis chip sheet on a phone | PASS |
| Ask from a Word file's own preview sheet | PASS, cited to the file |
| Long-note Ask in the browser, twice at each width | PASS |
| Chart block drag | see P2 below |

**Product bugs found, both now fixed:**

- **P1.** Trashing a member's last notes started the first-run tour, which opened over the
  "Moved N notes to the Trash" notice and covered its Undo. Fixed in `27d6289b75`: a member who
  had notes earlier in the visit is not new. Mutation-proved test.
- **P2.** Dragging a block by its grip ("Move this block") failed for any block, not only charts,
  unless the first motion was slow: the grip re-aimed at the block under the pointer, or hid itself,
  before the browser started the drag. A tall chart scrolled up also put the grip off screen.
  Fixed in `1958b48cc8`: a press freezes the grip, and the grip stays in the visible part of the
  block. Re-walked: 6 of 6 grip drags move their block (2 of 6 before). Seven mutation proofs.

Still for a person: a plain mouse drag on the chart's BODY (not its grip) did not move it in the
harness, while Playwright's drag API did. That is ProseMirror's own node drag; one check by hand.

## 3. Full test run on today's master plus these fixes

Six shards, `docs/notebook/gate-runs/verify-1009/2026-10-09T18-52-51.md`: 3,152 test files, 12
tests failed, file count reconciles. **The same 12 fail on clean master** (`c3e95cb643`, run in a
separate worktree): none is caused by this work. Two of them were Notebook's and are now handled:

- `NotebookTour.stage.test.jsx`: red since `2c902624e4` (bisected). One test's save leaked into the
  next test's fake server through the new per-key save queue. Fixed in the test (`27d6289b75`).
- `NotebookTab.publishFolder.test.jsx`: red since F3 (#300). The test expected focus on the
  folder's action button; F3 deliberately moves it to the folder row. Test updated (`0c24343596`).
- `iteratorGlobalFloor.test.js` fails only when `app/dist` is not built; with a build it passes 9/9.

The other nine belong to other workstreams (chart engine, screener reachability, polling,
persistence, formatter and fetch censuses, the symbol-link rail). The Python gate rails: 291
passed; the one failure (`test_gate_shards` read-set coverage) fails the same way on master.

After merging the 8 commits master gained during the run (chart agent only, no shared files), the
changed areas were re-run on the final tree: 55 files, 687 tests, all passed.
