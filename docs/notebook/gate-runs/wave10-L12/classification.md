# L12 gate: classification

- **Gate tree:** `f8167220c` (clean at start and at end). L12 = L11 `49f89d066` + WK6 + PC2 + GX + WK7 + OP + the `--surface-deadline` flag + evidence + **TY** (`e1999ca5f`, the only change under `app/`).
- **Manifest:** `2026-09-30T10-29-04.md`.
- **Totals:** 2240 test files; the file count reconciles. 5 tests failed.
- **Verdict:** `NEW_FAILURES` (exit 1), 4 NEW rows; 125 no longer failing.

## 3 rows: `src/pages/charts/VersionHistory.workspace.test.jsx` (STATE-2): PRE-EXISTING ON MASTER
These are the same 3 rows classified in `../wave10-L11/classification.md`. They fail alone on master `f40b541c2`, and L12 touches no charts or workspace file.

## 1 row: `src/components/chart/engine/ast/pineStrictCensus.test.js > strict census`: PRE-EXISTING ON MASTER (the test sits at its timeout)

- **What fails:** a 15 000 ms timeout (`Test timed out in 15000ms`), not an assertion.
- **Measured alone, same box, 2026-09-30:**

| tree | runs | result |
|---|---|---|
| L12 `f8167220c` | 3 | failed each time: 17.3 / 17.7 / 17.7 s |
| L11 `62607879e` | 2 | failed each time: 17.6 / 17.5 s |
| master `f40b541c2` | first 2 | passed (tests 14.78 s on one) |
| master `f40b541c2` | a later 2 | **failed** (16.3 / 17.2 s) |
| trial merge of L12 onto master | 3 | failed (16.6 / 16.1 s on the warm runs) |

- **Reading:** the census runs 15-17.5 s against its own 15 s limit on every tree measured, **including master**. It passes or fails with box load; master's earlier pass was a lucky draw under the line.
- **Not L12's doing:**
  - L12 changes no file this test reads: `pine.js`, `pineRuntimeFrontend.js` and the five fixture corpora under `tests/fixtures/` are identical to master's;
  - no vitest config, setup or package file differs.
- **Classification:** PRE-EXISTING on master. It belongs to the Pine workstream, whose test sits at its own timeout.
- **Not banked as permitted breakage.** It is recorded here as a master red to report, not as a waived slot.

## Carry-over
None needed; this gate ran on the full landing tree.
