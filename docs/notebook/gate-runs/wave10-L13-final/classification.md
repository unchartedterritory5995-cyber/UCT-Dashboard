# L13 final gate: classification

- **Gate tree:** `8588ad1b1` = L13 merged with origin/master `f912aaa9c`. Clean at start and at end (`2026-09-30T19-01-04.md`).
- **Totals:** 2299 test files; the file count reconciles. 13 tests failed.
- **Verdict:** `NEW_FAILURES` (exit 1), 12 NEW rows; 125 no longer failing.
- **Box:** the gate started on a QUIET reading at 18:03, then three lanes of this session and one foreign vitest ran beside it.

**Result: 0 of the 12 rows come from L13's changes.** Five are load, six are master's and one was the repo's size (fixed here).

## 5 rows: LOAD (pass alone on a quiet box)
All five passed when re-run alone at 20:30 with `load: QUIET` (`rerun-alone-7-files.log`: 5 files passed, 59 of 61 tests):

- `chart/engine/runtime/__tests__/guardProbe.measure.test.js` > groups each guard by message shape
- `chart/engine/runtime/__tests__/objectLaneCallSites.measure.test.js` > prints every script that dies on $GUARD
- `chart/engine/runtime/__tests__/objectLaneDrawerCensus.measure.test.js` > prints the ceiling and the per-guard drawer count
- `lib/presentation/presentationSingleFormatter.test.js` > nothing outside lib/presentation imports formatPercent from S10
- `pages/command/keyListenerCensus.test.js` > NON-VACUITY: it walks the whole tree

None of the five is a file L13 touches.

## 3 rows: `pages/charts/VersionHistory.workspace.test.jsx` (STATE-2): PRE-EXISTING ON MASTER
The same three rows classified at L10, L11 and L12 (`../wave10-L12-final/classification.md`). Charts workstream (TERM-051, `659c9c6f2`). Still red on the later landing tree `fb5a14bf0`.

## 2 rows: `__tests__/entryExcludesChartEngine.test.js`: PRE-EXISTING ON MASTER
The same two rows classified at L12 (chain through `instanceShape.js -> legacyCotGroups.js`, charts `aada122e0`). Still red on `fb5a14bf0`.

## 1 row: `lib/context/symbolLinkChannels.test.js` > no NEW surface reads a symbol/timeframe param by hand: MASTER'S
- The failure names one file: `testing/panes/paneHarness.jsx`.
- That file is the charts workstream's (last touched by `20c58838c` and `8f5d9755b` on master).
- `git diff origin/master HEAD` is empty for both `paneHarness.jsx` and the test file, so master fails it identically.
- Remedy (theirs): route the read through `readChartsLink`, or add the file to `HAND_TYPED_BASELINE` with a reason.

## 1 row: `hub/rule12Paths.test.js` > every HUB_OWNED prefix matches real tracked files: THE REPO'S SIZE, FIXED HERE
- Error: `spawnSync git ENOBUFS`. `git ls-files` printed 1,050,169 bytes on master `f912aaa9c` (1,054,434 on the gate tree), past Node's 1,048,576-byte `execFileSync` default.
- So master is red on it too, and so is every branch from now on.
- Fixed in `dad9c002f` (`maxBuffer: 64 MiB`). Re-run alone: 28 of 28 (`rerun-rule12-after-fix.log`).

## After the gate
Master moved 40 commits during the gate. They share no file with the branch. L13 was merged with it again (`fb5a14bf0`) and checked by `tools/gate_carry_over.py 8588ad1b1 HEAD origin/master`:

- **C1 ok, C3 ok.** C2 (the import graph) could not be evaluated, so the tool's verdict is RE-GATE. It was not re-gated: the gate takes about an hour, and master moved 40 commits during the last run.
- **C4 on the merged tree, run as the tool listed it:**
  - vitest: 28 files, 425 tests, all passed. These are the branch's own test files plus the incoming commits' test files.
  - pytest: 18 files, 598 passed, 2 failed, 2 skipped. Neither failure is in a file L13 touches:
    - `tests/test_gate_shards.py::test_the_read_set_covers_every_root_relative_path_the_suite_reads`: a frontend test on master reads `api/services/workspace_doc_store.py`, which is not in `GATE_READ_PATHS`. Master's (the workspace document store, TERM-021); it reproduces alone.
    - `tests/test_gate_box_lock.py::test_a_bypass_with_NO_reason_is_ignored_and_the_run_is_refused`: passed when re-run alone. It failed in the batch while three lanes were testing on the box.

What this does and does not show: the full suite ran on `8588ad1b1`. On `fb5a14bf0` only the C4 set and the six master-owned files above ran.
