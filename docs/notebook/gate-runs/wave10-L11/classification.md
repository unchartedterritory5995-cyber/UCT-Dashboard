# L11 gate: classification

- **Gate tree:** `49f89d066` (clean at start and at end). L11 = L10 `ffed76ec4` + DR-F + LK + FX2 + WK4 + FX3 + WK5 + WK6r1 + FX4 + SC + FX5.
- **Manifest:** `2026-09-30T07-12-36.md`.
- **Totals:** 2238 test files; the file count reconciles. 4 tests failed across 2 files; 31109 passed.
- **Verdict:** `NEW_FAILURES` (exit 1). There are 3 NEW rows, all in one file that L11 does not own.
- **No longer failing:** 125.

## The NEW rows: PRE-EXISTING ON MASTER

All 3 rows are in `src/pages/charts/VersionHistory.workspace.test.jsx`, under the STATE-2 group. They are the same 3 rows already classified in `../wave10-L10-run3/classification.md`.

- **Current master still fails them.** Run alone on master `f40b541c2` (2026-09-30), the file gives **3 failed | 5 passed**, the same 3 names. The log is `vh-master2.log` in the session scratchpad.
- **Not in L11's change set:** `git diff --name-only origin/master...HEAD` touches no VersionHistory or workspace file.
- **Owner:** the charts workstream (TERM-051 `659c9c6f2`). Not fixed here.

## Carry-over to L12
- **What L12 adds:** L12 = `49f89d066` + WK6 `7113bd567` + PC2 `c4850e61e` + GX `fb9e2c84d`. It changes only `tools/`, `tests/` and `docs/`; nothing under `app/` or `api/`.
- **Vitest half:** carries (C0).
- **Python half:** re-run on L12.
