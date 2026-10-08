# Wave 14, perf lane — the Notebook's first-open bytes back under budget, with headroom

Branch `feat/notebook-w14-perf`, base `3c50c50013` (the W14-0 lane record). Task: the promotion
gate `bytes.notebook_first_open` (`tools/notebook_perf_budgets.py`, workflow
`.github/workflows/notebook-bytes.yml`, budget in `docs/notebook/perf-budgets.json`) was RED at
the base. Shrink the first-open closure by at least the overage plus 10 kB for lanes W14-A
(~482 B, a lazily loaded capability preview) and W14-D (a small eager gate). **The budget number
was not touched.**

## 1. Before and after — the gate's own output, verbatim

Both readings: `npm run build` in `app/`, then `python tools/notebook_perf_budgets.py --dist
app/dist` from the repo root, exactly the workflow's two steps.

Before (tree of `3c50c50013`):

```
bytes.notebook_first_open: 2,285,026 B across 66 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: BUDGET BREACH
  BREACH bytes.notebook_first_open: 2,285,026 B > budget 2,260,793 B (+24,233 B over); largest chunks: assets/index-C7n757g6.js 555,369, assets/vendor-react-9O4lRsAt.js 378,369, assets/NotebookFlagGate-DVqelU8L.js 352,057, assets/tiptap-DXLa05pz.js 265,895
```

After (this lane):

```
bytes.notebook_first_open: 2,240,291 B across 66 JS chunks (budget 2,260,793 B, baseline 2,153,137 B)
VERDICT: PASS -- within every budget checked
```

**−44,735 B. Headroom 20,502 B (0.9 %).** The brief quoted 2,283,746 B for the base; this box's
clean build of the same tree read 2,285,026 B (+1,280 B), and that is the number above.

## 2. Attribution — how it was measured

No visualizer is configured in `app/vite.config.js`, so a scratch build (never committed) ran
Vite's own `build()` with a `hidden` sourcemap and a post plugin that recorded, per output chunk,
the MINIFIED bytes each source module maps to, plus Rollup's static module graph
(`importedIds`). The first-open chunk set was taken from the same manifest closure the checker
derives. Mapped bytes covered 2,229,117 B of the 2,285,026 (the rest is chunk glue). For each
candidate the number that matters is the **dominated** bytes: what leaves the closure if that
module's static imports became on-demand (everything reachable only through it).

A second scratch build of the tree before wave 13 (`9d74dc3c15`, the wave-13 plan commit) read
**2,197,489 B**, so wave 13 + its master merges + W14-0 added 87,537 B to the closure. By module
(pre-minify rendered bytes; the minified share is roughly 0.43 of these):

| Source of the growth | Modules (rendered bytes added) | Movable without a behaviour change? |
|---|---|---|
| Terminal batch (master merge into the wave-13 landing) | `pages/terminal/boardModel.js` 28,139 · `functions.js` 18,059 · `parseCommand.js` 9,928 · `grammar.js` 9,429 · `useTerminalLayout.js` 4,299 · `terminalGate.js` 2,505 · `paletteGrammar.js` 1,804 · `TerminalRoutes.jsx` 689 | In the ENTRY chunk (App.jsx / CommandPalette). Not Notebook code; left for the Terminal program — see section 5. |
| 13C-2 earnings prep | `lib/earningsPrepShared.js` 15,889 · `ReportingSoon.jsx` 4,848 (+css 834) · `earningsPrep.js` 1,762 | `ReportingSoon` + `earningsPrep.js`: **moved**. `earningsPrepShared.js` sits in the entry chunk through `notebookTemplates.js` (the catalog's synchronous `build()` calls `buildPrepDoc`): not movable without making `build` async. |
| 13F reviews that write themselves | `lib/reviewDrafts.js` 15,207 | **Moved** (only its flag stays). |
| 13H charts | `components/chart/coarsePointer.js` 9,728 · `widgetEmbedCore.js` +5,056 · `planLevels.js` 1,680 | No: the live embed and the template catalog read them on first paint (~1 kB minified for `coarsePointer`). |
| 13Q-4 roving tabindex | `hooks/useRovingTabIndex.js` 5,912 | No: the Journal's top tab bar renders with it. |
| W14-0 tours | `tourRegistry.js` 4,753 · `tours/index.js` 4,267 · `RegistryToursGate.jsx` 2,189 · `tourRegistryControl.js` 1,004 | Already split by W14-0 (the engine is a `lazyLeaf`); the eager remainder is 2,157 B minified and is the eligibility check itself. Left. |
| 13G-1 research capture | `researchCapture.js` 4,360 · `TranscriptDoors.jsx` 2,876 | No: ~2 kB minified, shared by the slash menu; the sheet itself is already lazy. |
| Everything else | dozens of +4..+3,109 B deltas in already-eager files | No. |

The wave-13 / W14-0 code that could leave without a behaviour change came to ~11 kB minified —
not enough on its own to clear the 24 kB overage, let alone leave 10 kB of room. So the lane also
took the largest on-demand code the Notebook route was paying for: the Journal shell's three
header dialogs, which are pre-wave-13.

Dominated minified bytes of what moved (from the scratch build of the base tree):

| Move | Dominated bytes |
|---|---|
| `JournalLayout.jsx`: `PortfolioSettingsModal` + `NewAccountModal` + `GenerateReportModal` (with `NoTradeWindowsEditor`) | 34,351 |
| `ResearchHome.jsx`: `lib/reviewDrafts.js` (13F) | 6,577 |
| `ResearchHome.jsx`: `ReportingSoon.jsx` + `earningsPrep.js` (13C-2) | 4,176 |
| **Sum (estimate)** | **45,104** |
| **Gate delta (measured)** | **44,735** |

## 3. The moves

All three go through the repo's one lazy helper, `app/src/pages/journal-2-0/lib/lazyChunk.js`.

1. **`JournalLayout.jsx` — the three header dialogs, `lazyChunk`, each in its own
   `<Suspense fallback={null}>`.** Each was already mounted only while its open flag is true
   (`showSettings && settings`, `showNewAccount`, `showReport`), so nothing changes about when it
   shows; its code is fetched on first open instead of before the Journal (and so the Notebook)
   can render. `lazyChunk` (not `lazyLeaf`): none has a boundary of its own, so a second fetch
   failure takes the app's ordinary stale-chunk recovery, as every App route does.
   `ShortcutCheatSheet` stays static: it is always mounted (`open` prop) and its rails find the
   dialog synchronously.
2. **`ResearchHome.jsx` — "Reporting soon" (13C-2), `lazyChunk`, rendered only while
   `earningsPrepEnabled()`.** The flag is read from `lib/earningsPrepShared.js`, which is already
   in the entry chunk. Same pattern 13G-1 used for `PassedSetups`, at the same tree position (the
   second child of every return), so the quiet-to-full flip still keeps the box's state. The box
   still checks its flag itself.
3. **`ResearchHome.jsx` — the review-drafts box (13F) loads `lib/reviewDrafts.js` on its first
   click,** through `importWithOneRetry` (lazyChunk.js's in-place retry). The flag moved to a new
   one-purpose module, **`lib/reviewDraftsFlag.js`** (`REVIEW_DRAFTS_FLAG`,
   `reviewDraftsEnabled`); `reviewDrafts.js` re-exports both, so `CompassReview`, `EODRecap`,
   `InsightsHub` and every `vi.mock('../lib/reviewDrafts')` are unchanged. One authority for the
   flag name, not two. A failed chunk fetch lands in the box's existing catch ("Could not draft
   the daily review — try again."), exactly as a failed draft does. The day / week / month is
   still computed at click time, now by the loaded module's own `todayDayIso` / `mondayOfIso` /
   `thisMonthIso`.

No new component files, so `a11y/notebookSurfaces.js` needed no new entry; no new budget entry
either (the moved code is on-demand, which the checker already excludes by construction).
`NotebookTab.jsx` was not touched, so its dynamic-import list rail
(`tabs/NotebookTab.lazyViews.test.js`) is unchanged.

## 4. Evidence

* Gate, before and after: section 1.
* `npx vitest run src/pages/journal-2-0 src/pages/Support --maxWorkers=2` on this lane's tree,
  verbatim totals: `Test Files  609 passed (609)` · `Tests  7656 passed | 1 skipped (7657)`
  (exit 0, 1306.75 s on a shared box).
* `python -m pytest tests/test_notebook_perf_budgets.py tests/test_notebook_perf_scale_w10.py -q`:
  `47 passed`.

## 5. Open items

* **The Terminal batch in the entry chunk** (~84 kB rendered, roughly 35 kB minified:
  `pages/terminal/boardModel.js`, `functions.js`, `parseCommand.js`, `grammar.js`, ...) is the
  single largest growth since wave 12 and is paid by every route, the Notebook included. It is
  outside this lane (not Notebook code, another program's files). If the Notebook needs more room
  later, that is the next lever, owned by whoever owns `CommandPalette.jsx` / `TerminalRoutes.jsx`.
* `AiActionsPanel.jsx` (wave 11, dark behind `notebook_ai_actions_enabled`) dominates 7,996 B and
  could move the same way as "Reporting soon"; left alone because the headroom target was met
  and its rail (`ResearchHome.aiActions.test.jsx`) asserts synchronously.
