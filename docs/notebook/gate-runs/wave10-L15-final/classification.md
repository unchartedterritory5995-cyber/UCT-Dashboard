# L15 final gate: classification

- **Gate tree:** `8123e172d` = the L15 lanes merged with master `22f07e1bd`. Clean at start and at end (`2026-10-01T18-04-00.md`).
- **Totals:** 2372 test files; the file count reconciles. 11 tests failed.
- **Verdict:** `NEW_FAILURES` (exit 1), 10 NEW rows; 125 no longer failing.
- **Box:** lock FREE, load BUSY when it started (16 test processes of other sessions).

**Result: 0 of the 10 rows are in a file L15 touches.** `git diff 22f07e1bd HEAD` is empty for `app/src/components/chart`, `app/src/lib/presentation`, `app/src/lib/context`, `app/src/__tests__` and `app/src/testing`, which hold all ten.

## 6 rows: LOAD (pass alone, `rerun-alone-7-files.log`: 6 files passed, 55 of 56 tests)
- `chart/engine/runtime/__tests__/guardProbe.measure.test.js`
- `chart/engine/runtime/__tests__/objectLaneCallSites.measure.test.js`
- `chart/engine/runtime/__tests__/objectLaneCensus.measure.test.js`
- `chart/engine/runtime/__tests__/objectLaneDrawerCensus.measure.test.js`
- `chart/engine/__tests__/flipCGeometry.test.jsx` > production never calls the test override
- `lib/presentation/dataGrid/dataGridSeed.rail.test.js` > a planted new grid fails the census BY NAME

## 4 rows: MASTER'S
- `__tests__/entryExcludesChartEngine.test.js` (2 rows): the same two classified at L12, L13 and L14.
- `lib/context/symbolLinkChannels.test.js` > no NEW surface reads a symbol/timeframe param by hand: names `testing/panes/paneHarness.jsx`, as at L13 and L14.
- `chart/engine/__tests__/objectFnInline.vendor.test.js` > sector-rotation, its lines are withheld: fails alone too. The file came in with master's Pine vendor-harness merge; L15 does not touch it.

## After the gate
Commits after the gated tree change no product code and no test under `app/`:

- the gate evidence and this file;
- the scorecard: nine citations re-pointed (`tools/parity_scorecard.py`) and `parity-scorecard.md` re-written;
- the accessibility reviewer's second re-walk record (docs only).

Python checks run on the tree that carries them (`741e0f6f3`):

- rollback chain, scorecard tests, typing harness tests: 97 passed.
- shared-data guard, census cache, sandbox launcher, tool pins, bridges, notes, facts, excerpts, the search rail: 267 passed.
- `parity_scorecard.py --verify`: PASS (run on the same scorecard commits in a side worktree).

Run on the L15 tree as each lane was picked (vitest, by file): lane PG 3 files / 54 tests; TY5 6 / 52; TY7 8 / 98; AF 12 files, 156 of 157 (the one a cold-start flake that also fails on unchanged code, fixed test-only afterwards, 3 of 3); AF2 with every `src/hub` test 90 files, 1206 of 1207 (the same flake, before its fix); AF3 10 / 104.

Master was 0 commits ahead when this was written.
