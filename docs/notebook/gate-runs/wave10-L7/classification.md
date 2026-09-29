# Wave 10 L7 gate: classification

Gate manifest: `2026-09-29T17-45-37.md` / `.json` (this directory). Verdict line:
`VERDICT=NEW_FAILURES exit=1 new=2 no_longer_failing=125 ... test_files=2201 tests_failed=3 reconciles=true`.
Gated tree: `98f79630522008ec28b46aefe1f85024f85abc89` (L6 + WK2 walk fixes).

## The two NEW rows: inherited from master, not L7's

Both rows are in one file, `app/src/lib/presentation/presentationSingleFormatter.test.js`
("the S8 provenance family formats nothing of its own"):

- "no file in it calls a locale formatter in CODE"
- "none of these files contains a regex literal the stripper cannot model"

Both assertions name `app/src/components/provenance/AbsenceReceipt.jsx` (vitest output,
run alone on the landing tree: `Tests 2 failed | 10 passed (12)`).

Why this is not L7's:

1. The test is a static scan of `app/src/components/provenance/` (its `S8_DIR`).
   `git diff --stat origin/master HEAD -- app/src/components/provenance app/src/lib/presentation`
   is **empty**. The scanned files and the test itself are byte-identical to master, so the
   scan returns the same answer on master.
2. `AbsenceReceipt.jsx` was added by `600319474` "feat(catalysts): why isn't X here as a
   shared S8 receipt (TERM-057)", a Terminal-workstream commit that is an ancestor of
   `origin/production`.
3. L7's `app/` diff against master is three CSS modules and
   `app/src/pages/journal-2-0/a11y/targetFloors.test.js`. None of them is in the S8 family.

**Owner of the red:** the Terminal workstream (TERM-057). Reported, not fixed here: the
Notebook lane does not edit `components/provenance/`.

## No longer failing: 125

The baseline predates many master fixes. These rows are the baseline going stale, not
something L7 did. The gate's `reconciles=true` shows the file count matches, so no shard
silently stopped running.

## Carry-over to the landing tree

`git merge-tree --write-tree HEAD origin/master` at `3fb184cdf` gives the tree
`98f79630522008ec28b46aefe1f85024f85abc89`, the gated tree exactly (C0 IDENTICAL). L6
landed as a squash of the same content, so the merge changes nothing.

## Python (C4-Python, on the landing tree)

`tests/test_notebook_proof_walk.py tests/test_notebook_rollback_chain.py
tests/test_authdb_archive_restore.py tests/test_authdb_restore_drill.py
tests/test_restore_drill_unknowns.py`: **83 passed** (270.71 s).
