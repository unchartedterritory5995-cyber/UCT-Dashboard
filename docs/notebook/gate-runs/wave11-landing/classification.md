# Wave-11 landing gate (e16dfe77e0): classification

- **Tree:** `feat/notebook-w11-landing` at `e16dfe77e0` = 11A + 11B + 11C merged with master. Raw manifest `2026-10-02T01-19-03.md` / `.json` and the six shard logs, committed before this file (`ede13483f5`).
- **Totals:** 2,431 test files; the file count reconciles. `VERDICT=NEW_FAILURES`, 32 new identities, 126 no longer failing (baseline `73a4286d0`, 2026-09-24).
- **Box:** BUSY at the start (another worktree's pytest).

## The 32 new identities

### 20: ENVIRONMENT, not code. The suite never loaded (`Failed to resolve import "axe-core"`)
This worktree's `app/node_modules` was a junction to `notebook-k`'s install, which has no `axe-core`. `app/package.json` pins `axe-core` 4.13.0. Every file that imports the axe harness failed at import:

- `a11y/aiActions`, `axeHarness.contract`, `dialogs`, `graph`, `noteEditor`, `notebookTab`, `panels`, `parts`, `publishFolder`, `settingsCards`, `sharing`, `voiceNote`
- `featureStatus.test.jsx`, `Support.a11y.test.jsx`
- `FolderSidebar.folderActions.test.jsx`, `NoteExportControls.a11y.test.jsx`, `NoteGraphView.test.jsx`, `ResearchHome.a11y.test.jsx`, `ExportDialog.a11y.test.jsx`, `NotebookTour.a11y.test.jsx`

**Fix:** the final landing worktree's junction now points at `notebook-w10-l13`'s install. It has `axe-core` 4.13.0, and its `package.json` and `package-lock.json` are identical to the final branch's. Re-run there: all of these pass (37 files, 404 tests, together with the fixes below).

### 9: REAL, in code the lanes' own scoped runs never reached. Fixed in `2efed06e08`
- `EducationalVideos.test.jsx` (6): 11A's Desk dock reads `AuthContext` itself, and the page's mock exported only `useAuth`. The mock is now partial.
- `lib/swallowedFetch.census.test.js` (1): 11C's `aiActions.js` and 11D's `tradeCanvas.js` each gained one `.catch(() => null)`. Neither was the hazard the census guards; both were rewritten without the idiom.
- `a11y/surfaceCoverage.test.js` (1): 11B's four components had no manifest entry. They now have their own axe recipes in `a11y/formulas.a11y.test.jsx`.
- `a11y/notebookContrast.test.js` (1): 11B's insert and filter buttons showed keyboard focus at 1.1–1.5:1. They now use a 2px accent outline.

Seen only once axe could load (not in this gate's count): `a11y/focusSuppression.test.js`. 11D's canvas card and its text box removed the outline for every focus; they now remove it for mouse focus only. Same commit.

### 3: MASTER'S, the same rows classified at L12–L15
- `__tests__/entryExcludesChartEngine.test.js` (2)
- `chart/engine/__tests__/objectFnInline.vendor.test.js` (1)

None of the three is in a file any wave-11 lane or L16 touches.

## What carries forward
This gate covered 11A–C only. The final landing tree adds 11D, L16, the fixes above and the vendor-row / tool-pin fixes, and it gets its own six-shard gate under `docs/notebook/gate-runs/final-landing/`.
