# L10 gate run 3: classification

- **Gate tree:** `ffed76ec4` (clean at start and at end).
- **Manifest:** `2026-09-30T02-47-51.md`.
- **Totals:** 2235 test files; the file count reconciles. 5 tests failed across 3 files; 31040 passed.
- **Verdict:** `NEW_FAILURES` (exit 1). There are 3 NEW rows, and all 3 are in one file that L10 does not own.
- **Earlier runs:**
  - Run 1 is classified in `../wave10-L10/classification.md`.
  - Run 2 was VOID. It hit TREE_DRIFT from a bug in the gate tool itself, fixed in `ffed76ec4`. Its manifest is `../wave10-L10/INVALID-2026-09-30T01-11-37.md`.

## The NEW rows: PRE-EXISTING ON MASTER, and not this branch's

All 3 rows are in `src/pages/charts/VersionHistory.workspace.test.jsx`, under the STATE-2 group:

- corrupt stored layout
- a deliberate member action still writes
- the held notice can be dismissed

**Classification:** I ran the file alone, same command, on two trees:

| tree | result |
|---|---|
| L10 `ffed76ec4` | 3 failed, the same 3 names |
| master `706f89b83` | 3 failed, the same 3 names |

- **Logs:** the session scratchpad, `vh-l10.log` and `vh-master.log`.
- **Not in L10's change set:** `git diff --name-only origin/master...HEAD` touches no VersionHistory or workspace file.
- **Where the file came from:** master, via TERM-051 (`659c9c6f2`, 2026-09-29) and TERM-021 (`ea93f1528`). That is the charts workstream.
- **Why the baseline doesn't list it:** the adopted baseline is master `73a4286d0` (2026-09-24), which predates this file.
- **Owner:** the charts workstream (TERM-051). Not fixed here.

## Python rails on the landing tree

The landing tree is `b3d4448ec` = L10 + the rulings scorecard fix (`d2bc0e042`, `55c765367`).

- `tools/parity_scorecard.py --verify` gives **VERIFY: PASS**, checked against `d2bc0e042`.
- Run on tests/test_parity_scorecard.py, test_parity_scorecard_evernote_fold.py, test_gate_shards.py and test_gate_carry_over.py, the totals were **1 failed, 174 passed, 2 skipped**.
- The 1 failure is `test_the_read_set_covers_every_root_relative_path_the_suite_reads`. It flags `api/services/workspace_doc_store.py`, which is read by the charts `VersionHistory.keyLabels.test.js`.
- **That failure is PRE-EXISTING on master:** the same test on master `706f89b83` gives `1 failed`, same path. It has the same owner as above.

## Carry-over from the gate tree to the landing tree

- **What the merge brought:** `tools/parity_scorecard.py` and `docs/notebook/parity-scorecard.md` only.
- **Vitest half:** carries (C0). No file the vitest gate reads changed.
- **Python half:** re-run on the landing tree, above.
