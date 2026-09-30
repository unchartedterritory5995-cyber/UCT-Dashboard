# L12 final gate: classification

- **Gate tree:** `30c69950d` = L12 merged with origin/master (which includes the #257 L10 squash `8eb7f008b`). Clean at start and at end.
- **Totals:** 2296 test files; the file count reconciles. 6 tests failed.
- **Verdict:** `NEW_FAILURES` (exit 1), 5 NEW rows; 125 no longer failing.

## 3 rows: `src/pages/charts/VersionHistory.workspace.test.jsx` (STATE-2): PRE-EXISTING ON MASTER
These are the same rows classified at L11 and L12 (`../wave10-L11/`, `../wave10-L12/`), from the charts workstream (TERM-051).

## 2 rows: `src/__tests__/entryExcludesChartEngine.test.js`: PRE-EXISTING ON MASTER (charts workstream)
The two rows:
- "the entry chunk does not statically reach the chart engine";
- "NotebookSurface.jsx: no components/chart/engine/ module on its static closure".

**Classification:**
- **The test is new.** It came from master (`ae60a34b3`, the wave-3 integration re-apply), so no earlier Notebook gate could run it.
- **Current master fails it too.** Run alone on origin/master `61b8b8f6c` (2026-09-30): **2 failed | 5 passed**, the same 2 names (log `ece-master.log`, session scratchpad). L12 gives the same result.
- **The chain the test prints (on master):** `main.jsx → App.jsx → components/Layout.jsx → hooks/usePreferences.js → components/chart/instanceShape.js → components/chart/engine/legacyCotGroups.js` (then → `groupBars.js`, `cotFollow.js`).
- **Who owns each edge:**
  - The `usePreferences.js → instanceShape.js` import is old: `bce58e94a`, 2026-08-05.
  - The edge into the engine, `instanceShape.js → legacyCotGroups.js`, is new in `aada122e0`, "fix(chart): migrate legacy COT pane groups". That is the charts workstream.
- **Not from the L10 squash:** it touches none of `usePreferences.js`, `instanceShape.js` or `legacyCotGroups.js`. Its only file beside them is `usePreferences.additionsOnly.test.js`.
- **Owner:** the charts workstream. The test's own remedy is a dynamic `import()` at the edge nearest the always-mounted shell. Not fixed here: it is not a Notebook file, and it is another workstream's in-flight change.
- **Consequence to report:** until the charts team fixes it, every route, the Notebook included, loads those three chart-engine modules in the entry chunk. The Notebook's bytes budget check (`notebook-bytes.yml`, promotion-gating) is the production-side guard for the Notebook route.
