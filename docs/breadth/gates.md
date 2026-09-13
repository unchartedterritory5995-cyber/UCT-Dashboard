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

## C2 chart mechanics (2026-09-13 13:45)

Tree `391818e44` at start and end (C1, the merge of origin/master `2b0b184cd`, and C2's six commits) · wrapper
`scripts/gate_shards.py` blob `2240e9c49` (updated by that merge) · 1,320 test files on disk, reconciles · **9 failing
tests in 8 files, 19,448 passed**.

- **Failing only on C2: none. Failing only on C1: none.** The nine are the same nine, test for test.
- **Named-list rails unchanged:** reachability names only `lib/context/focusDivergence.js`; polling sites names the same
  four files; tap floor names only `CaptureDialog.module.css: .actions`. The new modules `breadth/chartTicks.js`,
  `breadth/chartZoom.js` and `breadth/chartMagnitude.js` are reachable and hold no polling site.
- The file count rose by C2's four new test files and the test files the merge brought in from master.

**Verdict: no new failure.** C2 passes.

---

## Standing notes on reading this gate

**Shard membership is not stable, so only the union is comparable.** `vitest list` ignores `--shard`, and Vitest
partitions by hashing each spec's path — so any change to the test-file SET can move files across shards. A per-shard
table is still worth printing, but a failure appearing in a different shard is a MOVE, not a regression, and re-gating
"only the intersecting shards" after a test file is added or removed is not a valid selection: the intersection is
unknowable without running them. Full gate, or the seam rule below.

**Master moves during a 35-minute gate.** The rule (owner, 2026-09-13), applied to the delta `D` since the gated tree's
merge base: `D` touches no `app/**` and no test file → merge and push, no re-gate · `D` touches them but has no overlap
with this branch's files and nothing of ours imports from `D` → merge, then ONE targeted run of (our test files + `D`'s
test files) by explicit file list · `D` overlaps our files or our imports → merge and re-gate fully · never more than two
consecutive full gates chasing master. Which rule fired, and its file lists, is printed before every push.

**Every baseline failure carries an owner** so the next session does not rediscover it. All of them are master's; none is
this program's to fix.

| Failing test | Owner (last commit on the named file) |
|---|---|
| `ChartDrawingOverlay.surfaces` › entering edit mode is not a resize | charts drawings, `8de4da43b` |
| `builder/EvidenceTab.doors` › the derived importer set is the named pair | evidence builder, `811328eb8` (load-sensitive) |
| `engine/ast/manifestProse` › every key the product reads survives the strip | indicator manifest, `b280131b8` |
| `engine/ast/pine.blindCorpus` › the accepted floor moves one way too | Pine parity, `b1a901970` |
| `screener/reachable` › nothing committed is connected to nothing | S4 context (R-29), `76c62c494` |
| `hooks/pollingSites.rail` › no new bare polling site | four sessions: `d26695853`, `cc195e888`, `611bcf92e`, `22452cff7` |
| `lib/presentation/presentationSingleFormatter` › nothing outside lib/presentation imports formatPercent | S10 presentation, `de9551dd9` (load-sensitive) |
| `ThemeTrackerPage.chartmount` › two mount cases | charts, `7adfdda2b` (load-sensitive) |
| `journal-2-0/lib/importer/convert` › long meeting log (SIZE regime) | Notebook importer, `89dd17d59` (load-sensitive) |
| `journal-2-0/lib/iteratorGlobalFloor` › every built asset is clear | Notebook, `d261d0731` |
| `styles/tapFloor` › no stylesheet declares a finger target on the phone only | Notebook Wave L, `5d3f5f1be` |
| `desk/ArticlesSection.native` › clearing the query brings the full archive back | Desk/UI, `f30842782` (load-sensitive — see C3 below) |

## C3 touch & ARIA (2026-09-13)

Gated three times as master moved. The run that stands is **`47109cc47`** at 16:27 — tree identical at start and end,
wrapper blob `2240e9c49`, **1,323 test files on disk, reconciles**, 10 failing tests in 9 files, 19,468 passed.

**Per-shard table, C3 (`166c161dd`, the run before master's app/** delta) vs the C2 baseline (`391818e44`):**

| shard | baseline | C3 | delta |
|---|---|---|---|
| 1 | 4 | 4 | (empty) |
| 2 | 1 | 1 | (empty) |
| 3 | 2 | 2 | (empty) |
| 4 | 0 | 0 | (empty) |
| 5 | 2 | 2 | (empty) |
| 6 | 0 | 0 | (empty) |

Union 9 vs 9 — none new, none gone. ⚠️ Shard 2's delta is **empty**, not "−AuthContext": `AuthContext.test.jsx` was never
in the C2 baseline. It failed only in the discarded intermediate run at `0af0f66f0`, which is what `3512348c5` addresses.
`reachable.test.js` is baseline, not new.

### The two reds that appeared during C3, and what each one was

**`AuthContext.test.jsx` › 503 on a REFETCH — FIXED (`3512348c5`, D-036).** Direction established before any edit: the
post-restart master delta touched nothing under `app/`; this branch touches no auth file; the test last changed
2026-09-12, before the baseline; Vitest runs `pool: 'forks'` with per-file isolation, so cross-file pollution is not the
mechanism. Green 3/3 alone and again in a re-run of its own shard with the same file list and `--maxWorkers=2`.
Mechanism: the case reads three values and only two were inside the `waitFor` its own ⚰️ comment added; `authTransient`
was read synchronously after `act`, which React 19 can flush in a later Scheduler task. Test-only, own commit,
inverted-expectation control.

**`desk/ArticlesSection.native.test.jsx` › clearing the query brings the full archive back — NOT FIXED, recorded.**
Unchanged since 2026-08-24, absent from this branch's diff and from master's incoming delta. Green 3/3 alone and in a
re-run of its own shard. The failure is a `waitFor` timeout, and that `waitFor` is correctly placed: `test-setup.js`
already configures `asyncUtilTimeout: 4000` against a 250 ms debounce in `ArticlesSection.jsx`, so it had ~16× the
headroom it needed. That is starvation under the full suite, not a misplaced assertion — the class `vite.config.js`
documents at length in its pool-sizing comment. Rewriting it would mean raising a global timeout in another session's
area to hide load, so it is listed above as pre-existing and load-sensitive.

**Named-list rails unchanged:** reachability names only `lib/context/focusDivergence.js`; polling sites the same four
files; tap floor only `CaptureDialog.module.css: .actions` — C3 moved this tab's finger targets to the touch tier and the
app-wide rail's list did not move.

**Seam run (rule 3) after master's final 86-file delta, which touched no `app/**`:** our five test files green (58 tests),
and master's 14 incoming backend test files green (461 passed, 2 skipped). Three errors there are environmental — those
tests mount the real FastAPI app, which serves `app/dist/assets`, and this worktree has never run a frontend build.

**Verdict: no failure attributable to this branch.** C3 merges.
