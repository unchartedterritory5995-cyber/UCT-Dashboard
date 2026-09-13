# Breadth → Data Charts — frontend gate records

Each merge is gated with `python scripts/gate_shards.py --shards 6` on a clean tree and judged against the failing set
measured on the tree it started from. A merge passes when it adds no failing test and every named-list rail still names
the same files. A name that differs is re-run alone before it is classified. Manifests stay local (scratchpad); the
failing sets are copied here. Test names only — no member data (D-018).

---

## Baseline — before C1 (2026-09-13 11:03)

Tree `5091a81cf` at start and end · wrapper `scripts/gate_shards.py` blob `7164d491f` · 1,309 test files on disk,
reconciles · **12 failing tests in 11 files, 19,339 passed**. The branch touched nothing under `app/`
(`git diff --name-only f4fc5d1c1 5091a81cf -- app` is empty), so every entry is master's. None is this program's to fix.

| Failing test (file › case) | What it names | Owner (last commit on the named file) | Kind |
|---|---|---|---|
| `components/chart/ChartDrawingOverlay.surfaces.test.jsx` › entering edit mode is not a resize | — | charts drawings, `8de4da43b` | rail red |
| `components/chart/builder/EvidenceTab.doors.test.js` › the derived importer set is the named pair | — | evidence builder, `811328eb8` | load (15 s timeout) |
| `components/chart/engine/ast/manifestProse.test.js` › every key the product reads survives the strip | — | indicator manifest, `b280131b8` | rail red |
| `components/chart/engine/ast/pine.blindCorpus.test.js` › the accepted floor moves one way too | — | Pine parity, `b1a901970` | rail red |
| `components/screener/reachable.test.js` › nothing committed is connected to nothing | `lib/context/focusDivergence.js` | S4 context (R-29), `76c62c494` | rail red |
| `hooks/pollingSites.rail.test.js` › no new bare polling site | `components/chart/useBoundDrawingAlerts.js` (charts `d26695853`), `floor2/hooks/useFloor.js` (community `cc195e888`), `hooks/useFilingWatch.js` (S7 `611bcf92e`), `hooks/useWatchlistIntelligence.js` (Seam 8 `22452cff7`) | four sessions | rail red |
| `lib/presentation/presentationSingleFormatter.test.js` › nothing outside lib/presentation imports formatPercent | — | S10 presentation, `de9551dd9` | load (15 s timeout) |
| `pages/ThemeTrackerPage.chartmount.test.jsx` › passes stored=null with no onStore | — | charts, `7adfdda2b` | load-sensitive (~4 s) |
| `pages/ThemeTrackerPage.chartmount.test.jsx` › selecting a holding mounts ChartPane | — | charts, `7adfdda2b` | load-sensitive (~4 s) |
| `pages/journal-2-0/lib/importer/convert.test.js` › long meeting/daily-notes log (SIZE regime) | — | Notebook importer, `89dd17d59` | load-sensitive |
| `pages/journal-2-0/lib/iteratorGlobalFloor.test.js` › every built asset is clear | — | Notebook, `d261d0731` | rail red |
| `styles/tapFloor.test.js` › no stylesheet declares a finger target on the phone only | `journal-2-0/components/notebook/CaptureDialog.module.css: .actions` | Notebook Wave L, `5d3f5f1be` | rail red |

## C1 honest states (2026-09-13 12:41)

Tree `32f480a77` at start and end · same wrapper blob · 1,314 test files on disk (the baseline's 1,309 plus C1's five
new files), reconciles · **9 failing tests in 8 files, 19,382 passed**.

- **Failing only on C1: none.** Nine failing tests are in both sets.
- **Failing only in the baseline: three**, each a load timeout, each passing when run alone on the C1 tree (3 files,
  35/35): `EvidenceTab.doors` (15 s timeout in the baseline), `presentationSingleFormatter` (15 s timeout),
  `importer/convert` SIZE regime. C1 touches none of their files.
- **Named-list rails unchanged:** reachability names only `lib/context/focusDivergence.js`; polling sites names the
  same four files; tap floor names only `CaptureDialog.module.css: .actions`. The new modules
  `breadth/sessionDates.js` and `breadth/chartLoadError.js` are reachable and hold no polling site.
- A mid-development combined run also timed out the polling rail's "wrapper exempts itself" case (30 s); alone it
  passed in 6.4 s, and it passed in this gate.

**Verdict: no new failure.** C1 passes.
