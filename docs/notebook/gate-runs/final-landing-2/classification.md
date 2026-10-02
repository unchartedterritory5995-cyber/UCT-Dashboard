# Final landing re-gate (31bbb08d05): classification

- **Tree:** `feat/notebook-final-landing` at `31bbb08d05` (L16 + 11A-D + every integration fix). The tree hash is identical at start and end; 2,445 test files, and the count reconciles.
- **Box:** lock FREE and load QUIET at start (04:12).
- **Verdict:** `NEW_FAILURES`, 2 new identities, 126 no longer failing. Both are master's.

## The 2 rows: MASTER'S
- `__tests__/entryExcludesChartEngine.test.js`: the entry chunk and `NotebookSurface.jsx` both reach the chart engine through `hooks/usePreferences.js` -> `components/chart/instanceShape.js` -> `components/chart/engine/legacyCotGroups.js`.
- The same import chain is on `origin/master` (`usePreferences.js:3`, `instanceShape.js:26`), and `git diff origin/master...HEAD` is empty for all three paths. It is the same pair classified at L12, L13, L14 and L15.

## The first final gate (0c91010595)
That gate's 7 new identities were these 2 plus 5 of ours, fixed in `31bbb08d05`:
- the Screener capture button's name collided with the hub's `/screener/i` lookup;
- L16's `ScreenerEmbed` adopted the provenance panel (the baseline was banked);
- 11D's `tradeCanvas` had no export round-trip fixture (fixture added, table regenerated).

**Result: no failure in this tree belongs to this branch.**
