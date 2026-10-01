# L14 final gate: classification

- **Gate tree:** `3efb5d92f` = master `4ee0ca6f8` plus the L14 lanes. Clean at start and at end (`2026-10-01T08-42-16.md`).
- **Totals:** 2326 test files; the file count reconciles. 8 tests failed.
- **Verdict:** `NEW_FAILURES` (exit 1), 7 NEW rows; 125 no longer failing.
- **Box:** `lock: FREE`, `load: QUIET` when the gate started at 07:49.

**Result: 2 of the 7 rows were L14's own, both from one cause, fixed in `119349c99`. The other 5 are master's or load.**

## 2 rows: `pages/journal-2-0/lib/offline/f5Freeze.test.js`: OURS, FIXED
- "every frozen call site is still exactly where the freeze says it is" and "every frozen call site still LANDS its revision", both naming `append_financial_fact` in `lib/captureFinancialFact.js`.
- Cause: lane PX's locked-note fix (ruling 149) folded the two fact-insert call sites into a helper, so the exact call text the freeze pins (`/api/j2/notes/${noteId}/facts/${fact.id}/insert`) was gone. The second row follows from the first: the test looks for the settle after the call it could not find.
- The settle was never lost: the helper called `settleNoteWrite(noteId, res)`. No note could fork.
- Fix (`119349c99`): both call sites are back inline, as #259 landed them, with one added branch each (a 423 names the lock).
- Re-run after the fix (`rerun-f5-after-fix.log`): f5Freeze 8, captureFinancialFact 7, doorFamilies.settle 26; 41 of 41 pass.

## 2 rows: `__tests__/entryExcludesChartEngine.test.js`: PRE-EXISTING ON MASTER
The same two rows classified at L12 and L13 (charts, `aada122e0`).

## 2 rows: `lib/context/symbolLinkChannels.test.js`
- "no NEW surface reads a symbol/timeframe param by hand": MASTER'S. Names `testing/panes/paneHarness.jsx`, as at L13. It reproduces alone.
- "POSITIVE CONTROL: the matcher can see a real hand-typed read": LOAD. It passed alone (`rerun-alone-3-files.log`).

## 1 row: `hooks/pollingSites.rail.test.js` > "the wrapper exempts itself by RESOLUTION": LOAD
- In the gate it timed out at 30 s (`shard-1.log`). It passed alone.
- The same file has a master-owned red, already in the baseline's reach: "no NEW bare polling site" names `pages/research/tabs/OptionsChainTab.jsx` (`017f40d938`, not a file L14 touches).

The three `VersionHistory.workspace` rows seen at L10 to L13 did not appear in this run.

## After the gate
One commit changes product code after the gated tree: `119349c99`, one file (`captureFinancialFact.js`), the fix above. The tree was not re-gated for it. Checks run on the tree that carries it:

- vitest, the f5 set: 3 files, 41 tests pass.
- pytest, the rollback chain: 25 pass.

Checks run on the gated tree `3efb5d92f` or its parents (no product file changed between them and it, except as listed):

- pytest: the shared-data guard, census cache, sandbox launcher, tool pins, bridges, DR's five module files and the search rail: 185 pass (on `2c3cbdd0d`).
- pytest: Notebook notes, facts, excerpts, calendar, SLO, smoke rail: 324 of 325 pass on `2c3cbdd0d`; the one red was the scorecard evidence index, fixed by `7da4d36af`.
- pytest: `tests/test_parity_scorecard.py` on `3efb5d92f`: 46 pass. `parity_scorecard.py --verify`: PASS.
- vitest: lane PX 10 files / 100 tests and lane PF 13 files / 98 tests, each on the L14 tree at the time it was picked; lane MX 5 files / 44 tests in its own worktree (`21dacd25d`).

Master was 4 commits ahead of the gated tree's base, with no file in common with the branch. It was not merged again.
